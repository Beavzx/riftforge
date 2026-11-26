# Riftforge torch-side review (model / train / infer / export / setup)

Reviewer: independent read-through plus numpy-only execution. Torch code was **not executed** (no torch in the sandbox).
What I ran:
- `pytest python/tests`: 9/9 pass. `unittest discover`: 4/4 pass.
- `scripts/smoke.sh --backend mock`, run against a copy of `config/smoke.yaml` (runsDir `/tmp/rfrev/runs`, port 47950): ALL PASS, 12 games, 734 positions.
- numpy checks on those real shards (`/tmp/rfrev/scripts/inspect.py`):
  - dims G=167, F=108, A=152, P=12, n_roles=12, card table 1105x154 all match `schema.json`.
  - nE ranges 42..73 and nA ranges 2..24.
  - No pointer index is >= nE. No pointer has role 0 with a valid index. No card index is negative or >= nRows.
  - pi always has length nA, sums to 1 and is >= 0. z is in {+1, -1}. All features are finite. Padded log-softmax CE is finite.
- `/tmp/rfrev/scripts/srv.py`: a backend that raises kills `Server.batcher` (and with it the whole server). Also confirms the collate edge case in finding 8.

Findings are ranked from most to least severe. Severity tags: **crash** / **silent-wrong** / **minor**.

---

## 1. silent-wrong: eval results and gating are pinned to step N, but the games are played by whatever "latest" is
`python/riftzero/launch.py:267-276`, `python/riftzero/torch_backend.py:20,54`, `tools/train-eval.ts:46`, `python/riftzero/elo.py:39-48`

`maybe_eval` starts `train-eval.ts --step N`. The network side plays on **slot 0 = latest.pt**, and the server hot-reloads that slot every `reloadEverySec` (20 s). The trainer keeps publishing `latest.pt` every `ckptEverySteps` while eval runs (16 games x 3 opponents at fullSims 64 takes a long time). So:
- Games in one eval mix step N, N+500, ... but every row in `elo.csv` is labelled `step N`.
- With gating on, `record_eval` promotes `step_N.pt` to `best.pt` because "latest" beat best. The weights that actually won may have been N+500, so best can become a checkpoint that never passed the gate.
- Without gating, the doc says "best = latest evaluated", which is also only approximately true.

Fix: pin the evaluated weights in their own slot.
```python
# checkpoints.py
def pin_eval(run_dir, step: int) -> None:
    d = ckpt_dir(run_dir)
    atomic_copy(d / f"step_{step}.pt", d / "eval.pt")

# torch_backend.py
class TorchBackend:
    name = "torch"
    n_slots = 3
    SLOT_FILES = ((0, "latest.pt"), (1, "best.pt"), (2, "eval.pt"))
    ...
        self.slot_steps: dict[int, int] = {}
    def maybe_reload(self) -> None:
        for slot, fname in self.SLOT_FILES:
            ...
            self.models[slot] = m; self.mtimes[fname] = mt; self.slot_steps[slot] = step
            if slot == 0:
                self.step = step

# mock_backend.py
    n_slots = 3

# infer_server.py stats_writer: add
                         slotSteps=getattr(self.backend, "slot_steps", {}),

# launch.py maybe_eval, before creating the eval Child (torch backend only):
        if self.backend != "mock":
            pin_eval(self.rd, step)
            t = time.time()
            while time.time() - t < 3 * float(self.cfg["inference"]["reloadEverySec"]) + 15:
                ok = True
                for p in self.r["servers"]["ports"]:
                    try:
                        s = json.loads((self.rd / "servers" / f"s{p}.json").read_text())
                        ok &= int(s.get("slotSteps", {}).get("2", -1)) == step
                    except (OSError, ValueError):
                        ok = False
                if ok:
                    break
                time.sleep(1)
            else:
                self.say(f"servers did not load eval.pt for step {step}; skipping this eval"); self.last_eval_step = step; return
```
(The wait loop blocks `supervise` for at most about a minute. Alternatively, make it a small state machine.)
```ts
// tools/train-eval.ts
const SLOT_EVAL = 2;
const mineSlot = (ev as InferenceClient).nSlots >= 3 ? SLOT_EVAL : SLOT_LATEST;
const mine = new SearchAgent('latest', env, ev, cfg.evalSearch, caps, { record: false, noise: false, slot: mineSlot, rng });
```
In `elo.record_eval`, promote from `eval.pt` rather than `step_N.pt` (see finding 4).

## 2. silent-wrong: a missing GPU falls back to CPU silently, and the smoke test still says "ready for a real run"
`python/riftzero/train.py:101-103`, `python/riftzero/torch_backend.py:33-34`, `python/riftzero/smoke.py:52-63`, `scripts/setup.sh:61-63`

On WSL the most likely first-run failure is `torch.cuda.is_available() == False`: a CPU wheel, a stale driver, or no `wsl --shutdown` after a driver update. Every layer only warns:
- `setup.sh` prints WARN and exits 0.
- The trainer and the inference server print a WARNING into `runs/<name>/logs/*.log` and carry on, on CPU.
- `smoke.py` checks steps, checkpoints and hot reload. All of these pass on CPU with the tiny model, so it prints "ALL CHECKS PASSED — ready for a real run".

The real run then trains and serves on the 9800X3D's CPU while competing with 14 workers, and nothing on the console says so.

Fix: fail by default and let the smoke test assert the device.
```python
# config.py DEFAULTS: "train": {..., "allowCpu": False}, "inference": {..., "allowCpu": False}
# train.py, replacing lines 102-103
    if dev.type == "cpu":
        if not tc.get("allowCpu", False):
            raise SystemExit("[train] CUDA is not available to PyTorch (check nvidia-smi in WSL and that torch is a cu128 build: "
                             "python -c 'import torch;print(torch.__version__, torch.version.cuda)'). Set train.allowCpu: true to force CPU.")
        print("[train] WARNING: training on CPU", flush=True)
# torch_backend.py, in the else branch
        else:
            if not inf.get("allowCpu", False):
                raise RuntimeError("CUDA not available to PyTorch; set inference.allowCpu: true to serve on CPU")
            self.device = torch.device("cpu")
# infer_server.py stats_writer: add  device=str(getattr(self.backend, "device", "cpu")),
# smoke.py (torch branch)
        devs = [json.loads(p.read_text()).get("device", "?") for p in srv]
        check("inference servers run on CUDA", bool(devs) and all(d.startswith("cuda") for d in devs), f"({devs})")
```
Also make `setup.sh` treat "CUDA not available" as `sys.exit(1)` (FAIL), not a WARN.

## 3. crash: any exception in `backend.infer` kills the inference server, and with it the whole run
`python/riftzero/infer_server.py:87-94`

`batcher()` has no try/except. A single failed batch kills the coroutine; examples are a transient CUDA OOM (the trainer shares the 16 GB card; inference is capped at 30 %) or a collate error such as finding 8. `asyncio.gather` re-raises and the server process exits. `Launcher.supervise` then sees the server dead and ABORTs the entire run. The requests in the failed batch never get an answer. I reproduced this with a raising backend (`/tmp/rfrev/scripts/srv.py`: "server gather ended with: RuntimeError").

Fix: contain per-batch failures, drop the affected connections so those workers fail fast and get restarted, and re-raise only on repeated failures (which is what a poisoned CUDA context looks like).
```python
            for slot, group in by_slot.items():
                obs = [g[0] for g in group]
                try:
                    results = await loop.run_in_executor(None, self.backend.infer, obs) if self.backend.name != "mock" else self.backend.infer(obs)
                except Exception as e:
                    self.stats["errors"] = self.stats.get("errors", 0) + 1
                    print(f"[infer] batch of {len(obs)} (slot {slot}) failed: {e!r}", flush=True)
                    if self.stats["errors"] > 20:
                        raise
                    for _, w in group:
                        try:
                            w.close()      # the worker's client fails all waiters -> worker exits(3) -> launcher restarts it
                        except Exception:
                            pass
                    continue
                for (o, w), (value, logits) in zip(group, results):
                    ...
```

## 4. silent-wrong: if the prefetch thread dies, the trainer hangs forever (STOP ignored, final checkpoint lost)
`python/riftzero/train.py:59-69, 189, 231-232`

`Prefetcher.run` has no exception handling. If `make_batch` raises once, for example on a malformed or edge-case frame (finding 8), the daemon thread dies. The main loop then blocks in `self.q.get()` with no timeout. From then on:
- No steps are taken, and no error is printed in the trainer log.
- The STOP file is never re-checked.
- On shutdown the launcher waits 300 s and then SIGTERMs. The signal handler only sets a flag, and the main thread stays blocked in `get()`, so it gets SIGKILLed. Up to `ckptEverySteps` steps of training are lost.

Fix:
```python
class Prefetcher:
    def __init__(...):
        ...
        self.error: BaseException | None = None
    def run(self):
        try:
            while not self.stop:
                ...
        except BaseException as e:
            self.error = e
            raise
    def get(self, timeout: float = 1.0):
        try:
            return self.q.get(timeout=timeout)
        except queue.Empty:
            if self.error is not None or not self.t.is_alive():
                raise RuntimeError(f"prefetch thread died: {self.error!r}") from self.error
            return None

# main loop
        bt = pre.get()
        if bt is None:
            continue
        b = batch_to_torch(bt, dev)
```
Also wrap the `while` loop in `try: ... finally:` so the final `save_checkpoint` runs on an exception too.

## 5. silent-wrong: no guard for a non-finite loss or gradient; one bad step poisons weights that are then published to self-play
`python/riftzero/train.py:193-201`

Nothing checks `loss` or the grad norm. If a NaN or inf ever appears, AdamW writes NaNs into every parameter. Possible sources are a bad feature value (inf in a frame), an fp16 overflow (finding 7) or a corrupt shard. The next checkpoint (latest.pt) is hot-loaded by the servers, MCTS then gets NaN priors and values, and every new shard carries garbage. Because z comes from game results, the loss curve goes NaN but nothing stops the run. I found no NaN source in the current data (all features finite, the masking is correct), so this is a safeguard. It is cheap, though, and the failure mode is a silently destroyed run.

Fix:
```python
        loss = loss_pi + vw * loss_v
        opt.zero_grad(set_to_none=True)
        if not torch.isfinite(loss):
            bad_steps += 1
            print(f"[train] non-finite loss ({loss_pi.item()}, {loss_v.item()}); batch skipped ({bad_steps})", flush=True)
            if bad_steps > 10:
                raise SystemExit("[train] repeated non-finite loss; stopping without publishing")
            continue
        loss.backward()
        gn = torch.nn.utils.clip_grad_norm_(model.parameters(), clip)
        if not torch.isfinite(gn):
            opt.zero_grad(set_to_none=True); bad_steps += 1
            continue
        opt.step()
```
(Initialise `bad_steps = 0` before the loop.)

## 6. crash (conditional): gating promotes a step file that may already have been pruned
`python/riftzero/elo.py:39-41`

With `eval.gating.enabled: true`, `promote_best(run_dir, step)` copies `step_{step}.pt` **without** the existence check used in the non-gating branch (line 47). If eval takes longer than `keepCheckpoints x ckptEverySteps` steps, `save_checkpoint` has already unlinked that file. `shutil.copyfile` then raises `FileNotFoundError`, which propagates out of `Launcher.supervise` into `shutdown()`, and the run stops. This is unlikely with `train.yaml` (30 x 500 steps), but easy to hit with small `keepCheckpoints`, as in smoke-like configs with gating turned on.

Fix (pairs with finding 1):
```python
def promote_best(run_dir, step: int) -> None:
    d = ckpt_dir(run_dir)
    src = d / f"step_{step}.pt"
    if not src.exists():
        src = d / "eval.pt"          # pinned copy of the evaluated weights (finding 1)
    if not src.exists():
        print(f"[elo] step_{step}.pt is gone; best not promoted", flush=True); return
    atomic_copy(src, d / "best.pt")
    (d / "best_step.txt").write_text(str(step))
```

## 7. minor: `ampDtype: fp16` trains without a GradScaler
`python/riftzero/train.py:32, 107, 191-200`

The config offers `fp16` (`bf16 | fp16 | fp32`), but there is no `torch.amp.GradScaler`. With fp16 autocast, small gradients underflow to 0 and training quietly stalls. On the 5070 Ti, bf16 is right, but the option should be either correct or rejected.
```python
scaler = torch.amp.GradScaler("cuda", enabled=(amp is torch.float16))
...
scaler.scale(loss).backward()
scaler.unscale_(opt)
torch.nn.utils.clip_grad_norm_(model.parameters(), clip)
scaler.step(opt); scaler.update()
```
Alternatively: `if tc.get("ampDtype") == "fp16": raise SystemExit("train.ampDtype fp16 is not supported; use bf16")`. The fp16 inference dtype is fine.

## 8. minor (latent crash): `collate_obs` takes F/A/P as 0 when the first observation has 0 entities or 0 options
`python/riftzero/dataset.py:239-241` (and `python/riftzero/wire.py:88`)

`F = obs[0].entities.shape[1] if obs[0].n_e else 0` is unnecessary: `parse_obs` reshapes to `(n_e, F)` using the header's F, which the TS writer always sets, so `shape[1]` is correct even when `n_e == 0`. When `obs[0].n_e == 0`, F becomes 0 and the next observation with entities fails with "could not broadcast (k,108) into (k,0)" (reproduced). The same applies to A/P with `n_a == 0`. In the inference server this is a crash (finding 3), and in the trainer it is a hang (finding 4). Current data always has n_e >= 42 and n_a >= 2, so this is latent.
```python
    G = obs[0].global_.shape[0]
    F = obs[0].entities.shape[1]
    A = obs[0].actions.shape[1]
    P = obs[0].ptr_idx.shape[1]
```
For the test helper `wire.pack_obs`, use `F, A, P = o.entities.shape[1], o.actions.shape[1], o.ptr_idx.shape[1]`.

## 9. minor: `setup.sh` venv and torch detection
`scripts/setup.sh:46-56, 59-73`

- (a) Broken venv on re-run. On stock Ubuntu without `python3-venv`, `python3 -m venv .venv` fails *after* creating `.venv/bin/python` (ensurepip is missing). The user installs `python3-venv` and re-runs the script. `[ -x .venv/bin/python ]` is true, so the venv is not recreated, and `pip install --upgrade pip` dies with "No module named pip" (stdout is sent to /dev/null).
- (b) A wrong torch is never replaced. `if ! python -c 'import torch'` keeps any torch already in the venv, such as a CPU wheel or an older cu12.4 build without sm_120.
- (c) The GPU check fails before its own warning. On a build without sm_120, `x @ x` raises "no kernel image" before the friendly arch warning is printed, and `set -e` turns that into a bare traceback.
```bash
if [ ! -x .venv/bin/python ] || ! .venv/bin/python -m pip --version >/dev/null 2>&1; then
  rm -rf .venv
  "$PY" -m venv .venv || fail "could not create .venv (sudo apt-get install -y python3-venv)"
fi
VPY="$ROOT/.venv/bin/python"
"$VPY" -m pip install --upgrade pip >/dev/null
if ! "$VPY" -c 'import sys, torch; v = tuple(int(x) for x in (torch.version.cuda or "0.0").split(".")[:2]); sys.exit(0 if v >= (12, 8) else 1)' >/dev/null 2>&1; then
  echo "== installing PyTorch (CUDA 12.8+) from $TORCH_INDEX (large download)"
  "$VPY" -m pip install --upgrade --force-reinstall torch --index-url "$TORCH_INDEX"
fi
```
In the heredoc, check `cap in arch` (or a `compute_XY` entry with XY <= the device's) **before** the matmul, `sys.exit(1)` with the reinstall hint, and wrap the matmul in try/except that prints the same hint. The index URL `https://download.pytorch.org/whl/cu128` itself is correct for Blackwell sm_120 (torch >= 2.7).

## 10. minor: `--set key=1e-4` produces a string, which is then passed to Node unconverted
`python/riftzero/launch.py:42`

PyYAML (YAML 1.1) parses `1e-4` and `2e3` as **strings** (verified: `yaml.safe_load('1e-4') == '1e-4'`). The Python trainer casts with `float()`, so the docstring's own example `--set train.lr=1e-4` happens to work. However, `search.*`, `caps.*` and `target.*` go to Node verbatim through `resolved.json` as strings (for example `--set target.pointsShaping=1e-1`), where `+` concatenates.
```python
def _scalar(v: str):
    x = yaml.safe_load(v)
    if isinstance(x, str):
        for conv in (int, float):
            try:
                return conv(x)
            except ValueError:
                pass
    return x
...
        cur[parts[-1]] = _scalar(v)
```

## 11. minor: the prefetcher fills its queue from a nearly empty window
`python/riftzero/train.py:62`

The prefetcher samples as soon as `len(window) > 0`. The first 4 training batches (queue depth) are therefore drawn with replacement from the first shard or two, roughly a few hundred positions duplicated into 4x256 samples. That happens long before `minPositions` is reached, and those batches are consumed first. The effect is small, but the fix is trivial.
```python
    def __init__(self, window, batch_size, max_entities, min_len: int, depth: int = 4): ...; self.min_len = min_len
    ...
            recs = self.window.sample(self.bs) if len(self.window) >= self.min_len else None
# main(): Prefetcher(window, int(tc["batchSize"]), schema.max_entities, int(tc["minPositions"]))
```

## 12. minor (perf, EPYC profile): random indexing into a `deque` is O(n)
`python/riftzero/dataset.py:184, 216-218`

`deque.__getitem__` walks blocks. Measured here: 0.9 ms per batch for 200k/256 (fine at home), but **64 ms** per batch for 2M/1024 (the `train-epyc.yaml` window). On top of that, `make_batch` takes about 40 ms per 1024-batch, all on one GIL-bound thread. Replace it with a list ring buffer:
```python
        self.buf: list[Record] = []
        self._head = 0
    def _push(self, recs):
        for r in recs:
            if len(self.buf) < self.capacity:
                self.buf.append(r)
            else:
                self.buf[self._head] = r
                self._head = (self._head + 1) % self.capacity
# refresh(): self._push(recs) instead of self.buf.extend(recs)
```

---

## Checked and found correct (no action needed)
- **Shapes and dtypes against the schema.** Frames carry G/F/A/P in the header. `riftzero/schema.py` reads `global.dim`, `entity.dim`, `action.dim`, `maxPtrs`, `ptrRoles` (12), `cards.nRows`/`staticDim` and `cardStaticFile` exactly as `tools/train-schema.ts` writes them. The card table size is checked. The embedding has nRows+512 rows, indices >= rows map to "unknown" (1), and the static-feature buffer is non-persistent and refilled from the run's table.
- **Shard format** (`shards.ts` and `dataset.read_shard`) and **RFO1/RFR1/HELLO/ACK** match byte for byte. The tag slot is bits 24-31 and the id is bits 0-23. Results are sliced to `logits[i, :n_a]`. The server groups each batch by slot.
- **Masking.** The global token is never padded, so attention never sees an all-masked row. Padded actions are `-inf` in float32 after the `.float()` cast. The loss does `log_softmax`, then `masked_fill(0)`, then multiplies by zero-padded pi: no NaN in the forward or backward pass. Options with no pointers pool to 0 via `clamp(min=1)`. Pointers with role > 0 and idx -1 use the learned "unknown" vector. Pointers past truncated entities become -1.
- **Value perspective.** Observations are encoded for `actor` (mcts.evaluate), z is assigned per `p.actor` (`assignOutcome`), and MCTS backs up `valuesFor(actor, v)`. This is consistent. The tanh head with MSE against z in [-1, 1] is fine.
- **Autocast/bf16 dtype mixing** in the pointer path (fp32 LayerNorm output + bf16 linears, with `unknown.to(dtype)`) is safe. TF32 settings are fine. The autocast call with `dtype=None, enabled=False` on CPU is valid.
- **Checkpoints.** tmp + `os.replace` for step/latest/best; loads use `map_location="cpu"` and `weights_only=False` explicitly (required on torch >= 2.6). On resume, the model config comes from the checkpoint, and optimizer and LambdaLR state are restored after `.to(dev)`. `initFrom` correctly resets the optimizer. The `seen_shards`/`preseen` accounting is right (also covered by a test).
- There is **no DataLoader or multiprocessing**, so the usual WSL fork/shm problems don't apply. Children run in their own sessions, so Ctrl-C reaches only the launcher.
- **ONNX export.** Dynamic axes cover B, nE and nA on every input and output. Traced sizes are dynamic under the TorchScript tracer. `ptr_idx` and `card_idx` are int64 as documented.
- **Config keys.** Every key Python reads exists in `DEFAULTS` (`initFrom` is read with `.get`). No YAML key in train/smoke/epyc is missing from `DEFAULTS`.

## Risks I could not verify without torch (worth watching during the first smoke run)
- **Exporter version.** `export.py` uses `torch.onnx.export(..., dynamo=False)`, the TorchScript exporter, which is deprecated since torch 2.9. `setup.sh` installs the newest torch unpinned. If export fails on the installed version, either pin torch in setup (for example `torch>=2.7,<2.10`) or switch to `dynamo=True` with `dynamic_shapes`.
- **MHA fast path during export.** If the export ever fails with `aten::_transformer_encoder_layer_fwd` not supported, the eval-mode MHA fast path was taken. Wrap the export in `torch.backends.mha.set_fastpath_enabled(False)` (torch >= 2.2).
- **`train.compile: true` on WSL** needs `gcc` and `python3-dev` (Triton/Inductor), and libcuda found at `/usr/lib/wsl/lib`. `setup.sh` checks neither. The default is `false`.
- **TF32 flags on torch >= 2.9.** `torch.backends.cuda.matmul.allow_tf32` raises deprecation warnings there (the new API is `fp32_precision`). This is harmless.

---

## Review fixes (agent/fix)

Every finding was checked against the code before it was fixed. All were confirmed.

| # | verdict | fix | test (runs here) |
|---|---|---|---|
| 1 | confirmed | Eval plays a **pinned** checkpoint. The launcher copies `step_N.pt` to `ckpt/eval.pt` (`checkpoints.pin_eval`) and waits, without blocking supervision, until every server reports slot 2 loaded at step N (`launch.servers_serving`; the server stats now carry `slotSteps`). If that doesn't happen within 3×reloadEverySec+30 s the eval is skipped. Only then does it start `train-eval.ts`, whose network plays slot 2 (`client.evalSlot`; falls back to slot 0 on an old server). The torch and mock backends have 3 slots (latest/best/eval). Gating promotes from `eval.pt`. | `test_pin_eval_and_promote_from_pinned`, `test_servers_serving_checks_every_port`; TS `eval plays the pinned slot 2; requests are routed by slot` |
| 2 | confirmed | `train.allowCpu` / `inference.allowCpu` (default false): the trainer exits and the server refuses to start without CUDA, each with a fix hint. `setup.sh` FAILs when CUDA isn't usable. Smoke (torch) asserts `trainer runs on CUDA` (from metrics `device`) and `inference servers run on CUDA` (server stats `device`). | `test_cpu_fallback_off_by_default` (the torch paths themselves can't run here) |
| 3 | confirmed | Per-batch containment in `Server.batcher`. A CUDA OOM is retried on halves of the batch (recursively, calling `backend.on_oom()` = `empty_cache`). Any other failure answers each request in that batch with a new **RFE1 error frame**, the client rejects only those requests (`InferenceError`), and the connection stays up. 50 failed batches in a row make the server exit. The **launcher restarts a dead server** (`inference.maxServerRestarts`, 5 per 10 min) instead of aborting. MCTS no longer swallows `InferenceError` as a dropped simulation. A worker whose connection closed now exits 3 so it gets restarted (before, `playGame` turned "connection closed" into error games and the worker spun through them). | `test_server_answers_errors_and_keeps_serving`, `test_server_splits_batch_on_out_of_memory`; TS `a failed batch rejects only its requests`, `client reports a lost server`, `an inference error inside a simulation propagates`; manual end to end: `kill -9` of the mock server mid-run → server restarted, workers exited 3 and restarted, games 5 → 15 |
| 4 | confirmed | `Prefetcher` moved to `dataset.py` (numpy, testable). It records thread exceptions and `get(timeout)` returns None or raises `prefetch thread died`, so the main loop re-checks STOP. The trainer loop is wrapped in `try/finally`: the final checkpoint is saved on errors too (but not after a #5 abort). | `test_prefetcher_reports_a_dead_thread` |
| 5 | confirmed | A non-finite loss or gradient norm skips the step and is logged and counted (`skipped_steps` in metrics). `train.maxBadSteps` (10) **in a row** raises SystemExit **without publishing** a checkpoint (`BadStepGuard`). | `test_bad_step_guard_needs_consecutive_failures` (the torch loop can't run here) |
| 6 | confirmed | `promote_best` prefers `eval.pt` when it holds the step, else `step_N.pt`. If neither exists it logs and returns False instead of raising. `record_eval` stores the real outcome in `promoted`. | `test_gating_with_pruned_checkpoint_does_not_crash`, `test_pin_eval_and_promote_from_pinned` |
| 7 | confirmed | `torch.amp.GradScaler("cuda", enabled=fp16)`: scale/backward, unscale before clipping, `scaler.step`, `scaler.update`. A no-op for bf16 and fp32. | — (torch) |
| 8 | confirmed | `collate_obs` and `wire.pack_obs` take F/A/P from the arrays (header-shaped), not 0 when the first observation is empty. | `test_collate_first_obs_empty` |
| 9 | confirmed (a, b, c) | `setup.sh`/`setup.ps1` recreate a venv without a working pip. torch must be CUDA ≥ 12.8 **and** within the pin `torch>=2.7.1,<2.11` (now in `python/requirements.txt`); otherwise it is force-reinstalled from the cu128 index and re-checked. The GPU check (`python/riftzero/torch_check.py --gpu`) tests arch support (`sm_XY` or PTX ≤ cap) **before** the matmul, wraps the matmul, and exits 1 with a hint. The logic moved from heredocs into `torch_check.py`. | `test_torch_check_helpers`; `bash -n scripts/setup.sh` |
| 10 | confirmed | `launch._scalar`: YAML parse, then int/float for strings like `1e-4` / `2e3`. | `test_set_values_become_numbers` |
| 11 | confirmed | `Prefetcher(min_len=train.minPositions)` doesn't sample before the window is full enough. | `test_prefetcher_waits_for_min_len` |
| 12 | confirmed, done | `ReplayWindow` is a list ring buffer (O(1) indexing). Sampling 1024 from 200k is under 10 ms per batch (asserted). | `test_replay_window_ring_buffer` |
| ONNX risk | addressed, **untested here** | `export.py` tries `torch.onnx.export(dynamo=True, dynamic_shapes=…)` first, falls back to TorchScript (`dynamo=False`) with `torch.backends.mha.set_fastpath_enabled(False)`, and records the exporter used in the .json. It then runs `onnx.checker`, plus an onnxruntime output comparison when that is installed. | — (torch) |

Also: tests no longer use fixed ports (`server.test.ts` takes a free port; smoke picks a free base port, `--port` and
`--runs-dir` options). No `tools/zz-*` leftovers existed.

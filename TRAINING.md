# Training a Riftbound AI with Riftforge

Everything is driven by one config file and five commands: **setup → smoke → start → status → stop**. The run keeps
itself going (restarts crashed workers, publishes checkpoints, runs evaluation matches) until you stop it. Starting it
again resumes where it stopped.

```
scripts/setup.sh                 # once
scripts/smoke.sh                 # 2-3 minutes: proves the whole pipeline works on your machine
scripts/start.sh                 # the real run (config/train.yaml) — leave it running
scripts/status.sh --watch        # in a second terminal
scripts/stop.sh                  # clean stop (or Ctrl-C in the start terminal)
```

All of these are thin wrappers around `python -m riftzero.<command>` (the logic lives in `python/riftzero/`), so
they behave the same on Linux, WSL2 and Windows. Windows-native equivalents are `scripts\*.ps1`.

---

## 0. On Windows: use WSL2 (recommended, supported route)

CUDA works inside WSL2 through the normal **Windows** NVIDIA driver. Native Windows is best-effort only (the `.ps1`
scripts exist, but WSL2 is what is tested).

1. **Put the project inside the WSL filesystem**, not on `C:`. In an Ubuntu (WSL) terminal:
   ```bash
   mkdir -p ~/riftforge && cd ~/riftforge
   unzip /mnt/c/Users/<you>/Downloads/riftforge.zip -d .     # or git clone ...
   ```
   Work in `~/riftforge`, **not** `/mnt/c/...`: file I/O on `/mnt/c` is very slow, and `npm install`, the training
   shards and the checkpoints all suffer from it. `setup.sh` warns you if the repo is under `/mnt/`.
2. **GPU check**: run `nvidia-smi` inside WSL. It must list the RTX 5070 Ti. It comes from the Windows driver, so
   **never install a Linux NVIDIA driver inside WSL**. If it fails, update the driver on Windows, then run
   `wsl --shutdown` in PowerShell and reopen Ubuntu.
3. **Give WSL enough CPU and RAM**: create or edit `%UserProfile%\.wslconfig` on Windows:
   ```ini
   [wsl2]
   memory=24GB
   processors=16
   ```
   then `wsl --shutdown` and reopen. WSL's default memory cap is too small for 14 workers plus the replay buffer.
4. **Prerequisites inside Ubuntu**: `sudo apt-get update && sudo apt-get install -y python3 python3-venv unzip`, and
   Node 22: `curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs`.
5. **Editor / Claude Code**: from the repo folder in WSL run `code .`. VS Code opens through the *WSL* extension, so
   its terminal, Claude Code and all tools run inside WSL next to the files.
6. **TensorBoard** started in WSL (`.venv/bin/tensorboard --logdir runs`) is reachable from the Windows browser at
   <http://localhost:6006>. WSL forwards localhost.

## 1. Setup (once)

```bash
scripts/setup.sh
```
It checks Node ≥ 22 and runs `npm install`. It creates `.venv`, or recreates it if it's broken (for example created
before `python3-venv` was installed). It installs PyTorch from the CUDA 12.8 index, in the range pinned in
`python/requirements.txt` (`torch>=2.7.1,<2.11`). RTX 50-series (Blackwell, `sm_120`) needs CUDA 12.8+ builds, so a CPU or
older-CUDA torch already in the venv is replaced. It also installs numpy, pyyaml, tensorboard and onnx. Then it
checks that each GPU's architecture is supported by the installed build *before* running a bf16 matmul on it, and on
WSL it checks the points above. **If CUDA is not usable, setup fails** with a fix hint. Re-running it is safe.

## 2. Smoke test (2–3 minutes)

```bash
scripts/smoke.sh
```
It runs `config/smoke.yaml` on a free port: a tiny model, 2 workers and 8 simulations per move, for about 150 seconds.
Then it checks that games finished and shards were written and read back. It also checks that the trainer took
steps **on CUDA** and published checkpoints, that the inference servers run **on CUDA** and hot-reloaded a trained
checkpoint, and that an eval match ran. Every line should say `PASS`. If not, read `runs/smoke/logs/*.log`.
(`scripts/smoke.sh --backend mock` tests the plumbing without the GPU. `--runs-dir /tmp/x` puts the throwaway run
elsewhere.)

The trainer and the inference server **refuse to run on the CPU** (instead of quietly crawling along) unless you set
`train.allowCpu: true` / `inference.allowCpu: true`.

## 3. Start the real run

```bash
scripts/start.sh                                   # config/train.yaml (home PC profile)
scripts/start.sh --config config/train-epyc.yaml   # the 128-core box
scripts/start.sh --set search.fullSims=32 --name home-2   # any config value can be overridden
```
Keep the terminal open (or run inside `tmux`). Startup order: schema export, trainer (writes checkpoint 0),
inference server, workers. Everything for a run lives in `runs/<name>/`:

| path | what |
|---|---|
| `logs/` | launch, trainer, server, eval and per-worker logs |
| `ckpt/` | `step_N.pt`, `latest.pt` (what self-play uses), `best.pt`, `eval.pt` (the checkpoint being evaluated) |
| `shards/` | self-play training data (`.rfs`); old files are deleted past `train.keepShardFiles` |
| `metrics.jsonl`, `tb/` | trainer metrics (TensorBoard: `.venv/bin/tensorboard --logdir runs`) |
| `elo.csv`, `eval/` | evaluation matches |
| `status.json`, `workers/`, `servers/` | live counters (what `status.sh` shows) |
| `errors/` | games where the engine threw (discarded; repro seeds for bug reports) |

## 4. Watch it

```bash
scripts/status.sh --watch
```
It shows games per hour, positions, trainer step and losses, the inference batch size, and the latest eval with an
Elo-vs-SearchAI history. What to look at:
- **Elo vs SearchAI** is the main number. The hand-built SearchAI is the yardstick, and the net starts far below
  it (a random network loses nearly every game).
- **loss_value** should fall below about 0.9 within the first day. Around 1.0 means the value head has learnt
  nothing yet.
- **policy entropy** should fall slowly. If it drops to about 0 in the first hours, the run has collapsed: lower
  `train.lr`.
- **reuse** sits near `train.maxSampleReuse` (4) when the trainer is waiting for self-play, which is normal.
- **timeouts** are a high share of games early (the caps are 60 turns, annealing to 40) and should fall as play
  becomes purposeful.
- **skipped_steps** (in metrics.jsonl) counts training steps skipped for a non-finite loss or gradient. A few are
  harmless. 10 in a row stop the trainer **without** publishing those weights (the last good `latest.pt` stays).

Each eval plays one fixed checkpoint: the launcher copies `step_N.pt` to `ckpt/eval.pt`, waits until the inference
servers have loaded it (slot 2), and only then starts the matches. The `elo.csv` row for step N is therefore exactly
step N's weights, even though the trainer keeps publishing newer checkpoints meanwhile. Gating promotes that same
file.

If an inference server crashes (e.g. a CUDA out-of-memory error it couldn't recover from by splitting the batch),
the launcher restarts it and the workers reconnect on their own. Only more than `inference.maxServerRestarts` (5)
crashes in 10 minutes stop the run.

## 5. Stop / resume

Ctrl-C in the start terminal, or `scripts/stop.sh` from anywhere. Workers stop, the trainer saves a final checkpoint,
and everything exits within about a minute. Run `scripts/start.sh` again with the same config/name to resume from
`latest.pt` and the shards on disk. Use a new `run.name` for a fresh run. If the encoder schema changes
(an engine/encoder update that changes features), the trainer refuses to resume and tells you to start a new run.

## 6. First run on the home PC: is scaling up worth it?

Goal: in 1–3 days, find out whether the network is clearly learning, before moving to the EPYC box.

1. `scripts/smoke.sh` should be all `PASS`.
2. `scripts/start.sh` with the defaults: 4 meta decks (Azir, Vex, Rek'Sai, Kai'Sa), small model, 64/16
   simulations, `env: factored`.
3. After about 30 minutes the trainer starts stepping (it waits for 10,000 positions). Evals run every 3 checkpoints,
   about every 2–3 hours.
4. **Decision after 24–72 h**, from the `vs searchai` rows of `elo.csv` (or the status history line):
   - **Elo vs SearchAI is climbing steadily** (e.g. −600 → −300 → −100 over the first day or two): the setup works
     and is compute-bound. The EPYC box will get there roughly 7–10× faster. Scale up.
   - **It has crossed 0** (beats SearchAI): stronger than the existing AI on these decks. Scale up and widen the deck
     pool.
   - **Flat for 12+ hours after the first eval**, or `loss_value` stuck at about 1.0: don't scale yet. Check
     `errors/`, lower `train.lr` (1e-4), raise `search.fullSims` (96), and ask Claude to look at `metrics.jsonl` and
     `elo.csv`.
5. Every eval is only 16 games per opponent, so a single row is noisy (±150 Elo). Judge the trend across several
   evals, not one result.

## 7. Fine-tune a matchup

To practise one matchup (your deck against what your friend plays), start a *new* run from the best general model:

```yaml
# config/matchup.yaml  (copy config/train.yaml, then change:)
run: { name: matchup-vex }
decks: { mode: matchup, me: decks/my-deck.json, opponents: [02-vex.json] }
train: { initFrom: runs/home-1/ckpt/best.pt, lr: 1.0e-4, warmupSteps: 100, minPositions: 5000 }
```
`scripts/start.sh --config config/matchup.yaml`. Deck files are the meta-deck JSON format or a bare `DeckList`
(`legend`, `champion`, `main`, `runes`, `battlefields`). Overnight is usually enough to specialise.

## 8. Export and use the network

```bash
scripts/export.sh --run runs/home-1 --which best     # → runs/home-1/export/riftnet-best.onnx (+ schema files)
```
The coach/review tools and in-game sparring use the trained net through `src/ai/selfplay/nn-evaluator.ts`
(`NNCoach.connect({ port })` → `analyse(state, player)`: every option ranked with win %, visits and the improved
policy). It talks to an inference server, so run one for the checkpoint you want:
```bash
PYTHONPATH=python .venv/bin/python -m riftzero.infer_server --run runs/home-1 --port 47000
```
(slot 1 = `best.pt`). The ONNX file is for running the net without Python later (e.g. in the browser game). Export uses the newer
`torch.export`-based exporter (`dynamo=True`) and falls back to the older TorchScript one. If `onnxruntime` is
installed (`.venv/bin/pip install onnxruntime`), the exported file's outputs are compared with PyTorch's. *Not yet
run on a real checkpoint: try it once after the first run, and report any error.*

## 9. Throughput and resources (estimates)

Measured in the development sandbox (a shared 2-vCPU cloud VM, mock network): **about 13 ms of engine work per
search simulation**. 87% of that is the rules engine itself (`getLegalActions` + `applyAction`), not the search or
the network. A self-play game has about 160 decisions. With the default playout cap (25% × 64 sims, 75% × 16 sims =
28 on average) that is about 4,500 simulations, or about 60 s of CPU per game on that VM.

| | home PC: 9800X3D + 1× 5070 Ti | EPYC 9754 + 2–4× 5070 Ti |
|---|---|---|
| per-core engine speed vs sandbox | ~1.3–1.5× (Zen 5, high clock, V-Cache) | ~0.9× |
| self-play workers | 14 (16 threads − 2) ≈ 10 core-equivalents (SMT) | 120 |
| search | 64 / 16 sims | 96 / 24 sims |
| games / hour | ~800–1,000 | ~4,000–5,000 |
| training positions / day | ~0.8–1.0 M | ~4–5 M |
| trainer steps / day (reuse 4) | ~12–15 k (batch 256) | ~16–20 k (batch 1024) |
| GPU inference load | ~1–1.5 k evals/s (GPU mostly idle) | ~8–10 k evals/s (2 servers per GPU) |
| RAM | ~10 GB (6 GB replay window + workers) | ~70–80 GB (2 M-position window) |
| disk | ~15 GB shards (capped by keepShardFiles) + <1 GB checkpoints | ~85 GB shards + a few GB checkpoints |

Each position is about 30 KB on disk and in RAM. The bottleneck on both machines is the CPU (the engine), not the
GPU. To go faster: more workers, a lower `search.fastSims`, or engine speed-ups (caching the legal-action lists,
cheaper state clones).

## 10. Troubleshooting

| symptom | fix |
|---|---|
| smoke/trainer/server: `CUDA is not available to PyTorch` | `nvidia-smi` inside WSL; after a Windows driver update run `wsl --shutdown`; then `scripts/setup.sh` (it replaces a CPU torch) |
| `inference server error: ...` in errors/ | that request's batch failed (logged in `logs/server-*.log`); the game is dropped and the run continues |
| `SCHEMA MISMATCH` in a worker log | workers and model use different encoder versions. Use a new run name, or don't mix code versions |
| `port 47000 is in use` | another run is still active (`scripts/status.sh`), or set `inference.basePort` |
| `no kernel image is available` / sm_120 warning | your torch build predates Blackwell: reinstall from the cu128 index |
| out of GPU memory | lower `inference.memoryFraction` / `inference.maxBatch` / `train.batchSize`, or a smaller `model.size` |
| WSL killed / out of RAM | raise `memory=` in `.wslconfig`; lower `train.replayPositions` or `selfplay.workers` |
| a worker keeps restarting | `runs/<name>/logs/worker-NNN.log`; engine errors go to `errors/` (the game is dropped, the run continues) |
| very slow everything on WSL | the repo is under `/mnt/c`: move it to `~/riftforge` |
| eval takes hours | lower `eval.gamesPerOpponent`, drop `bot` from `eval.opponents`, or set `eval.searchAi` budgets lower |

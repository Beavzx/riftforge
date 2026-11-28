"""Trainer: learns from the self-play shards, publishes checkpoints the inference servers hot-reload.

    python -m riftzero.train --run runs/<name>

Loop: refresh the replay window from runs/<name>/shards → sample a minibatch → loss = policy cross-entropy against
the search policy + valueWeight × MSE(value, z) → AdamW step. A step is only taken while the number of samples trained
stays below train.maxSampleReuse × positions generated (so the trainer can't overfit a small buffer while self-play
catches up). Checkpoints every train.ckptEverySteps; resumes from ckpt/latest.pt; stops cleanly (final checkpoint) on
SIGINT/SIGTERM or when runs/<name>/STOP appears, and on errors (try/finally).
Safety: refuses to run without CUDA unless train.allowCpu; a non-finite loss or gradient skips the step, and
train.maxBadSteps (10) in a row stop the trainer without publishing a checkpoint; fp16 uses a GradScaler.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import signal
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as Fn

from .checkpoints import ckpt_dir, list_steps, promote_best
from .dataset import BadStepGuard, Prefetcher, ReplayWindow, make_batch
from .model import RiftNet, batch_to_torch, count_params, forward_batch, model_config
from .schema import load_schema
from .infer_server import is_oom

MAX_OOM_IN_ROW = 30   # ~13 min of back-off: a real leak, not a transient peak

AMP = {"bf16": torch.bfloat16, "fp16": torch.float16, "fp32": None}


def lr_lambda(tc: dict):
    warm, total, sched, floor = int(tc["warmupSteps"]), int(tc["totalSteps"]), tc["schedule"], float(tc["minLrFrac"])

    def f(step: int) -> float:
        if step < warm:
            return (step + 1) / max(1, warm)
        if sched == "constant":
            return 1.0
        t = min(1.0, (step - warm) / max(1, total - warm))
        return floor + (1 - floor) * 0.5 * (1 + math.cos(math.pi * t))
    return f


def held_out_score(model, recs, max_entities, dev, amp) -> dict | None:
    """Loss on held-out games (whole shard files that never entered the replay window): the honest value / policy
    loss. The training loss is measured on positions the net has already trained on, and can fall by memorising games."""
    if len(recs) < 512:
        return None
    V, Z, CE = [], [], []
    was = model.training
    model.eval()
    try:
        with torch.no_grad(), torch.autocast(dev.type, dtype=amp, enabled=amp is not None):
            for i in range(0, len(recs), 256):
                b = batch_to_torch(make_batch(recs[i:i + 256], max_entities), dev)
                v, lg = forward_batch(model, b)
                lp = Fn.log_softmax(lg.float(), dim=-1).masked_fill(~b["action_mask"], 0.0)
                CE.append((-(b["pi"] * lp).sum(-1)).cpu()); V.append(v.float().cpu()); Z.append(b["z"].cpu())
    except Exception as e:
        if not is_oom(e):
            raise
        return None
    finally:
        model.train(was)
    V, Z, CE = torch.cat(V), torch.cat(Z), torch.cat(CE)
    corr = float(torch.corrcoef(torch.stack([V, Z]))[0, 1]) if V.std() > 0 and Z.std() > 0 else 0.0
    return {"held_v_mse": float(((V - Z) ** 2).mean()), "held_v_corr": corr, "held_pi_ce": float(CE.mean()), "held_n": len(recs)}


def save_checkpoint(run_dir: Path, model, opt, sched, state: dict, keep: int) -> None:
    d = ckpt_dir(run_dir)
    step = state["step"]
    ck = {"model": model.state_dict(), "model_cfg": model.cfg, "schema_hash": model.cfg["schema_hash"], "step": step,
          "optimizer": opt.state_dict(), "scheduler": sched.state_dict(), "state": state, "time": time.time()}
    tmp = d / f"step_{step}.pt.tmp"
    torch.save(ck, tmp)
    os.replace(tmp, d / f"step_{step}.pt")
    tmp2 = d / "latest.pt.tmp"
    torch.save(ck, tmp2)
    os.replace(tmp2, d / "latest.pt")
    (d / "step.txt").write_text(str(step))
    (d / "seen_shards.json").write_text(json.dumps(sorted(state.get("seen_shards", []))))
    for s in list_steps(run_dir)[:-keep] if keep > 0 else []:
        try:
            (d / f"step_{s}.pt").unlink()
        except OSError:
            pass


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", required=True)
    ap.add_argument("--max-steps", type=int, default=None, help="stop after this many steps (smoke tests)")
    args = ap.parse_args(argv)
    run_dir = Path(args.run).resolve()
    cfg = json.loads((run_dir / "config.json").read_text())
    tc, mc = cfg["train"], cfg["model"]
    schema = load_schema(run_dir)
    dev = torch.device(f"cuda:{tc['gpu']}" if torch.cuda.is_available() else "cpu")
    if dev.type == "cpu":
        if not tc.get("allowCpu", False):
            raise SystemExit("[train] CUDA is not available to PyTorch. Check `nvidia-smi` (inside WSL) and that torch is a CUDA 12.8+ "
                             "build: .venv/bin/python -c 'import torch; print(torch.__version__, torch.version.cuda, torch.cuda.is_available())'. "
                             "Re-run scripts/setup.sh to repair it. To deliberately train on CPU set train.allowCpu: true.")
        print("[train] WARNING: training on CPU (train.allowCpu is set)", flush=True)
    else:
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True
    amp = AMP.get(tc.get("ampDtype", "bf16")) if dev.type == "cuda" else None
    # fp16 autocast needs loss scaling (small gradients underflow otherwise); bf16/fp32 don't
    scaler = torch.amp.GradScaler("cuda", enabled=(amp is torch.float16))
    torch.manual_seed(int(cfg["run"]["seed"]))

    d = ckpt_dir(run_dir)
    latest = d / "latest.pt"
    init_from = tc.get("initFrom")
    state = {"step": 0, "samples": 0, "positions_seen": 0, "seen_shards": []}
    if latest.exists():
        ck = torch.load(latest, map_location="cpu", weights_only=False)
        if int(ck["schema_hash"]) != schema.schema_hash:
            raise SystemExit(f"[train] checkpoint schema {ck['schema_hash']} != run schema {schema.schema_hash}: the encoder changed. "
                             f"Start a new run (run.name) — or initFrom an old run only after re-checking compatibility.")
        model = RiftNet(ck["model_cfg"], schema.card_static)
        model.load_state_dict(ck["model"])
        state.update(ck.get("state", {}))
        print(f"[train] resumed from step {state['step']}", flush=True)
    else:
        if init_from:
            ck = torch.load(init_from, map_location="cpu", weights_only=False)
            if int(ck["schema_hash"]) != schema.schema_hash:
                raise SystemExit(f"[train] initFrom {init_from}: schema {ck['schema_hash']} != run schema {schema.schema_hash}")
            model = RiftNet(ck["model_cfg"], schema.card_static)
            model.load_state_dict(ck["model"])
            print(f"[train] initialised from {init_from} (step {ck.get('step')}); optimizer reset", flush=True)
        else:
            model = RiftNet(model_config(schema, mc.get("size", "small"), **{k: mc.get(k) for k in ("d_model", "layers", "heads", "ff")}), schema.card_static)
        ck = None
    model.to(dev)
    print(f"[train] model {model.cfg['size']} d={model.cfg['d_model']} L={model.cfg['layers']} params={count_params(model)/1e6:.2f}M on {dev}", flush=True)
    opt = torch.optim.AdamW(model.parameters(), lr=float(tc["lr"]), weight_decay=float(tc["weightDecay"]), betas=(0.9, 0.99))
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lr_lambda(tc))
    if ck is not None and "optimizer" in ck and latest.exists():
        opt.load_state_dict(ck["optimizer"])
        sched.load_state_dict(ck["scheduler"])
        # the checkpoint's optimizer carries the lr / weight decay it was started with: the config wins on resume
        lr0, wd0 = float(tc["lr"]), float(tc["weightDecay"])
        old = (sched.base_lrs[0], opt.param_groups[0]["weight_decay"])
        sched.base_lrs = [lr0 for _ in opt.param_groups]
        for g in opt.param_groups:
            g["initial_lr"], g["weight_decay"] = lr0, wd0
            g["lr"] = lr0 * lr_lambda(tc)(sched.last_epoch)
        if old != (lr0, wd0):
            print(f"[train] config overrides checkpoint optimizer: lr {old[0]:g} -> {lr0:g}, weight decay {old[1]:g} -> {wd0:g}", flush=True)
    fwd_model = torch.compile(model) if tc.get("compile") else model

    if not latest.exists():
        save_checkpoint(run_dir, model, opt, sched, state, int(tc["keepCheckpoints"]))
        promote_best(run_dir, 0)
        print("[train] wrote initial checkpoint step 0 (latest + best)", flush=True)

    window = ReplayWindow(run_dir / "shards", int(tc["replayPositions"]), schema.schema_hash, seed=int(cfg["run"]["seed"]),
                          preseen=set(state.get("seen_shards", [])), holdout_every=int(tc.get("holdoutEvery", 0)))
    window.total_positions = int(state.get("positions_seen", 0))
    pre = Prefetcher(window, int(tc["batchSize"]), schema.max_entities, min_len=int(tc["minPositions"]))
    guard = BadStepGuard(int(tc.get("maxBadSteps", 10)))

    tb = None
    try:
        from torch.utils.tensorboard import SummaryWriter
        tb = SummaryWriter(str(run_dir / "tb"))
    except Exception:
        print("[train] tensorboard not available; logging to metrics.jsonl only", flush=True)
    metrics = open(run_dir / "metrics.jsonl", "a", encoding="utf-8")

    stop = {"flag": False}

    def on_signal(*_):
        stop["flag"] = True
    signal.signal(signal.SIGINT, on_signal)
    try:
        signal.signal(signal.SIGTERM, on_signal)
    except (AttributeError, ValueError):
        pass

    bs, reuse = int(tc["batchSize"]), float(tc["maxSampleReuse"])
    # samples allowed = reuse x positions, counted from where maxSampleReuse last changed (`reuse_s0` = the samples that
    # do not count): lowering it mid-run then trains at the new rate on new data instead of idling until positions catch up
    if float(state.get("reuse_cfg", -1)) != reuse:   # new run, older checkpoint, or a changed setting
        s0 = max(0, int(state["samples"] - reuse * int(state.get("positions_seen", 0))))
        if s0 > 0:
            print(f"[train] maxSampleReuse {state.get('reuse_cfg', '?')} -> {reuse:g}: reuse budget restarts from here", flush=True)
        state["reuse_cfg"], state["reuse_s0"] = reuse, s0
    vw, clip = float(tc["valueWeight"]), float(tc["gradClip"])
    last_refresh, last_log_t, last_log_samples = 0.0, time.time(), state["samples"]
    acc = {"loss": 0.0, "pi": 0.0, "v": 0.0, "ent": 0.0, "n": 0}
    max_steps = args.max_steps
    steps_this_run = 0
    oom_in_row = 0
    held: dict = {}
    print(f"[train] waiting for {tc['minPositions']} positions before training", flush=True)
    publish = True   # final checkpoint on exit (not after a non-finite abort: those weights must not reach self-play)
    try:
        while not stop["flag"] and not (run_dir / "STOP").exists():
            now = time.time()
            if now - last_refresh > 10:
                with pre.lock:
                    window.refresh()
                state["positions_seen"] = window.total_positions
                state["seen_shards"] = sorted(window.seen)
                last_refresh = now
            if len(window) < int(tc["minPositions"]) or state["samples"] - state["reuse_s0"] + bs > reuse * max(1, window.total_positions):
                time.sleep(1.0)
                continue
            nb = pre.get()          # raises if the prefetch thread died; None = not ready yet (re-check STOP)
            if nb is None:
                continue
            oom = None
            try:
                b = batch_to_torch(nb, dev)
                model.train()
                with torch.autocast(dev.type, dtype=amp, enabled=amp is not None):
                    value, logits = forward_batch(fwd_model, b)
                logp = Fn.log_softmax(logits.float(), dim=-1).masked_fill(~b["action_mask"], 0.0)
                loss_pi = -(b["pi"] * logp).sum(-1).mean()
                loss_v = Fn.mse_loss(value.float(), b["z"])
                loss = loss_pi + vw * loss_v
                opt.zero_grad(set_to_none=True)
                finite = bool(torch.isfinite(loss))
                if finite:
                    scaler.scale(loss).backward()
            except Exception as e:
                # the trainer shares the card with the inference servers: a transient out-of-memory (epyc-1 2026-11-28
                # 03:33, during an eval) skips this batch instead of ending the run. Weights are untouched (no step yet).
                if not is_oom(e):
                    raise
                oom = str(e).splitlines()[0][:160]
            if oom is not None:   # cleanup outside the except block: the traceback holds the forward's activations
                oom_in_row += 1
                b = value = logits = logp = loss_pi = loss_v = loss = None
                opt.zero_grad(set_to_none=True)
                if dev.type == "cuda":
                    torch.cuda.empty_cache()
                print(f"[train] CUDA out of memory; batch skipped ({oom_in_row} in a row): {oom}", flush=True)
                if oom_in_row >= MAX_OOM_IN_ROW:
                    raise SystemExit(f"[train] {oom_in_row} out-of-memory batches in a row: stopping (checkpoint saved).")
                time.sleep(min(30.0, 2.0 * oom_in_row))
                continue
            oom_in_row = 0
            if not finite:
                print(f"[train] non-finite loss (policy {loss_pi.item()}, value {loss_v.item()}); batch skipped "
                      f"({guard.in_row + 1} in a row)", flush=True)
                if guard.bad():
                    publish = False
                    raise SystemExit(f"[train] {guard.in_row} non-finite steps in a row: stopping WITHOUT publishing a checkpoint. "
                                     "Last good weights: ckpt/latest.pt. Check metrics.jsonl / recent shards.")
                continue
            scaler.unscale_(opt)
            gn = torch.nn.utils.clip_grad_norm_(model.parameters(), clip)
            if not torch.isfinite(gn) and not scaler.is_enabled():
                opt.zero_grad(set_to_none=True)
                print(f"[train] non-finite gradient norm; step skipped ({guard.in_row + 1} in a row)", flush=True)
                if guard.bad():
                    publish = False
                    raise SystemExit("[train] repeated non-finite gradients: stopping WITHOUT publishing a checkpoint.")
                continue
            scaler.step(opt)        # with fp16 the scaler itself skips steps with inf/nan gradients
            scaler.update()
            sched.step()
            guard.good()
            state["step"] += 1
            state["samples"] += bs
            steps_this_run += 1
            with torch.no_grad():
                p = logp.exp()
                ent = -(p * logp).sum(-1).mean()
            acc["loss"] += loss.item(); acc["pi"] += loss_pi.item(); acc["v"] += loss_v.item(); acc["ent"] += ent.item(); acc["n"] += 1
            step = state["step"]
            if step % int(tc["logEverySteps"]) == 0:
                dt = time.time() - last_log_t
                row = {"t": time.time(), "step": step, "loss": acc["loss"] / acc["n"], "loss_policy": acc["pi"] / acc["n"],
                       "loss_value": acc["v"] / acc["n"], "policy_entropy": acc["ent"] / acc["n"], "lr": sched.get_last_lr()[0],
                       "buffer": len(window), "positions_seen": window.total_positions, "samples": state["samples"],
                       "samples_per_s": (state["samples"] - last_log_samples) / max(1e-6, dt),
                       "reuse": (state["samples"] - state["reuse_s0"]) / max(1, window.total_positions), "skipped_steps": guard.total,
                       "grad_norm": float(gn), "device": str(dev), **held}
                metrics.write(json.dumps(row) + "\n"); metrics.flush()
                if tb:
                    for k, v in row.items():
                        if k not in ("t", "step", "device", "held_n"):
                            tb.add_scalar(f"train/{k}", v, step)
                print(f"[train] step {step} loss {row['loss']:.4f} (pi {row['loss_policy']:.4f} v {row['loss_value']:.4f}) "
                      f"buffer {len(window)} reuse {row['reuse']:.2f}", flush=True)
                acc = {"loss": 0.0, "pi": 0.0, "v": 0.0, "ent": 0.0, "n": 0}
                last_log_t, last_log_samples = time.time(), state["samples"]
            if step % int(tc["ckptEverySteps"]) == 0:
                with pre.lock:
                    recs = list(window.held)
                held = held_out_score(model, recs, schema.max_entities, dev, amp) or held
                if held:
                    print(f"[train] held-out games ({held['held_n']} positions): value mse {held['held_v_mse']:.3f} "
                          f"(corr {held['held_v_corr']:.2f}), policy CE {held['held_pi_ce']:.3f}", flush=True)
                save_checkpoint(run_dir, model, opt, sched, state, int(tc["keepCheckpoints"]))
                window.prune_files(int(tc.get("keepShardFiles", 0)))
            if max_steps and steps_this_run >= max_steps:
                break
    finally:
        pre.close()
        if publish:
            save_checkpoint(run_dir, model, opt, sched, state, int(tc["keepCheckpoints"]))
            print(f"[train] stopped at step {state['step']} (checkpoint saved)", flush=True)
        metrics.close()
        if tb:
            tb.close()


if __name__ == "__main__":
    main()

"""Trainer: learns from the self-play shards, publishes checkpoints the inference servers hot-reload.

    python -m riftzero.train --run runs/<name>

Loop: refresh the replay window from runs/<name>/shards → sample a minibatch → loss = policy cross-entropy against
the search policy + valueWeight × MSE(value, z) → AdamW step. A step is only taken while the number of samples trained
stays below train.maxSampleReuse × positions generated (so the trainer can't overfit a small buffer while self-play
catches up). Checkpoints every train.ckptEverySteps; resumes from ckpt/latest.pt; stops cleanly (final checkpoint) on
SIGINT/SIGTERM or when runs/<name>/STOP appears.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import queue
import signal
import threading
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as Fn

from .checkpoints import ckpt_dir, list_steps, promote_best
from .dataset import ReplayWindow, make_batch
from .model import RiftNet, batch_to_torch, count_params, forward_batch, model_config
from .schema import load_schema

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


class Prefetcher:
    """Builds minibatches on a background thread (numpy collation overlaps the GPU step)."""

    def __init__(self, window: ReplayWindow, batch_size: int, max_entities: int, depth: int = 4):
        self.window, self.bs, self.me = window, batch_size, max_entities
        self.q: queue.Queue = queue.Queue(maxsize=depth)
        self.lock = threading.Lock()
        self.stop = False
        self.t = threading.Thread(target=self.run, daemon=True)
        self.t.start()

    def run(self):
        while not self.stop:
            with self.lock:
                recs = self.window.sample(self.bs) if len(self.window) else None
            if recs is None:
                time.sleep(0.5)
                continue
            self.q.put(make_batch(recs, self.me))

    def get(self):
        return self.q.get()


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
        print("[train] WARNING: CUDA not available, training on CPU (only useful for smoke tests)", flush=True)
    else:
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True
    amp = AMP.get(tc.get("ampDtype", "bf16")) if dev.type == "cuda" else None
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
    fwd_model = torch.compile(model) if tc.get("compile") else model

    if not latest.exists():
        save_checkpoint(run_dir, model, opt, sched, state, int(tc["keepCheckpoints"]))
        promote_best(run_dir, 0)
        print("[train] wrote initial checkpoint step 0 (latest + best)", flush=True)

    window = ReplayWindow(run_dir / "shards", int(tc["replayPositions"]), schema.schema_hash, seed=int(cfg["run"]["seed"]),
                          preseen=set(state.get("seen_shards", [])))
    window.total_positions = int(state.get("positions_seen", 0))
    pre = Prefetcher(window, int(tc["batchSize"]), schema.max_entities)

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
    vw, clip = float(tc["valueWeight"]), float(tc["gradClip"])
    last_refresh, last_log_t, last_log_samples = 0.0, time.time(), state["samples"]
    acc = {"loss": 0.0, "pi": 0.0, "v": 0.0, "ent": 0.0, "n": 0}
    max_steps = args.max_steps
    steps_this_run = 0
    print(f"[train] waiting for {tc['minPositions']} positions before training", flush=True)
    while not stop["flag"] and not (run_dir / "STOP").exists():
        now = time.time()
        if now - last_refresh > 10:
            with pre.lock:
                window.refresh()
            state["positions_seen"] = window.total_positions
            state["seen_shards"] = sorted(window.seen)
            last_refresh = now
        if len(window) < int(tc["minPositions"]) or state["samples"] + bs > reuse * max(1, window.total_positions):
            time.sleep(1.0)
            continue
        b = batch_to_torch(pre.get(), dev)
        model.train()
        with torch.autocast(dev.type, dtype=amp, enabled=amp is not None):
            value, logits = forward_batch(fwd_model, b)
        logp = Fn.log_softmax(logits.float(), dim=-1).masked_fill(~b["action_mask"], 0.0)
        loss_pi = -(b["pi"] * logp).sum(-1).mean()
        loss_v = Fn.mse_loss(value.float(), b["z"])
        loss = loss_pi + vw * loss_v
        opt.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), clip)
        opt.step()
        sched.step()
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
                   "reuse": state["samples"] / max(1, window.total_positions)}
            metrics.write(json.dumps(row) + "\n"); metrics.flush()
            if tb:
                for k, v in row.items():
                    if k not in ("t", "step"):
                        tb.add_scalar(f"train/{k}", v, step)
            print(f"[train] step {step} loss {row['loss']:.4f} (pi {row['loss_policy']:.4f} v {row['loss_value']:.4f}) "
                  f"buffer {len(window)} reuse {row['reuse']:.2f}", flush=True)
            acc = {"loss": 0.0, "pi": 0.0, "v": 0.0, "ent": 0.0, "n": 0}
            last_log_t, last_log_samples = time.time(), state["samples"]
        if step % int(tc["ckptEverySteps"]) == 0:
            save_checkpoint(run_dir, model, opt, sched, state, int(tc["keepCheckpoints"]))
            window.prune_files(int(tc.get("keepShardFiles", 0)))
        if max_steps and steps_this_run >= max_steps:
            break
    pre.stop = True
    save_checkpoint(run_dir, model, opt, sched, state, int(tc["keepCheckpoints"]))
    print(f"[train] stopped at step {state['step']} (checkpoint saved)", flush=True)
    metrics.close()
    if tb:
        tb.close()


if __name__ == "__main__":
    main()

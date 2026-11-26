"""Torch inference backend for infer_server.py: serves slot 0 = latest.pt, slot 1 = best.pt, reloading newer files."""
from __future__ import annotations

import os
import time
from pathlib import Path

import numpy as np
import torch

from .checkpoints import ckpt_dir
from .dataset import collate_obs
from .model import build_from_checkpoint, forward_batch

DTYPES = {"bf16": torch.bfloat16, "fp16": torch.float16, "fp32": None}


class TorchBackend:
    name = "torch"
    n_slots = 2

    def __init__(self, run_dir: Path, schema, cfg: dict, gpu: int | None):
        inf = cfg["inference"]
        self.schema = schema
        self.dir = ckpt_dir(run_dir)
        if torch.cuda.is_available():
            self.device = torch.device(f"cuda:{gpu if gpu is not None else inf['gpus'][0]}")
            frac = float(inf.get("memoryFraction") or 0)
            if 0 < frac < 1:
                torch.cuda.set_per_process_memory_fraction(frac, self.device)
            torch.backends.cuda.matmul.allow_tf32 = True
        else:
            self.device = torch.device("cpu")
            print("[infer] WARNING: CUDA not available, serving on CPU (slow)", flush=True)
        self.amp = DTYPES.get(inf.get("dtype", "bf16")) if self.device.type == "cuda" else None
        self.models: dict[int, torch.nn.Module] = {}
        self.mtimes: dict[str, float] = {}
        self.step = 0
        t0 = time.time()
        while not (self.dir / "latest.pt").exists():
            if time.time() - t0 > 600:
                raise RuntimeError(f"no checkpoint appeared in {self.dir} within 10 minutes (is the trainer running?)")
            time.sleep(1)
        self.maybe_reload()

    def _load(self, path: Path):
        ck = torch.load(path, map_location="cpu", weights_only=False)
        if int(ck.get("schema_hash", -1)) != self.schema.schema_hash:
            raise RuntimeError(f"{path.name}: model schema {ck.get('schema_hash')} != run schema {self.schema.schema_hash}")
        m = build_from_checkpoint(ck, self.schema.card_static).to(self.device).eval()
        return m, int(ck.get("step", 0))

    def maybe_reload(self) -> None:
        for slot, fname in ((0, "latest.pt"), (1, "best.pt")):
            p = self.dir / fname
            if not p.exists():
                continue
            mt = p.stat().st_mtime
            if self.mtimes.get(fname) == mt:
                continue
            m, step = self._load(p)
            self.models[slot] = m          # atomic reference swap; in-flight batches finish on the old model
            self.mtimes[fname] = mt
            if slot == 0:
                self.step = step
            print(f"[infer] slot {slot} <- {fname} (step {step})", flush=True)

    @torch.inference_mode()
    def infer(self, batch):
        slot = batch[0].slot
        model = self.models.get(slot)
        if model is None:
            model = self.models[0]
        b = collate_obs(batch)
        t = {k: torch.from_numpy(v).to(self.device, non_blocking=True) for k, v in b.items() if k != "n_actions"}
        with torch.autocast(self.device.type, dtype=self.amp, enabled=self.amp is not None):
            value, logits = forward_batch(model, t)
        value = value.float().cpu().numpy()
        logits = logits.float().cpu().numpy()
        return [(float(value[i]), logits[i, : o.n_a]) for i, o in enumerate(batch)]

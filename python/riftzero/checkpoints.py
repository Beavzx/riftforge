"""Checkpoint files of a run (runs/<name>/ckpt/). No torch import at module level.

  step_<N>.pt   full checkpoint (model + optimizer + scheduler + counters), kept for the last train.keepCheckpoints
  latest.pt     copy of the newest step_<N>.pt (what inference slot 0 serves)
  best.pt       the best model so far (eval gating; equals the first checkpoint until gating promotes another)
  step.txt      newest step number (workers read it for cap annealing)
All writes go to a temporary name first and are renamed into place, so readers never see half a file.
"""
from __future__ import annotations

import os
import re
import shutil
from pathlib import Path


def ckpt_dir(run_dir: str | Path) -> Path:
    d = Path(run_dir) / "ckpt"
    d.mkdir(parents=True, exist_ok=True)
    return d


def list_steps(run_dir: str | Path) -> list[int]:
    out = []
    for p in ckpt_dir(run_dir).glob("step_*.pt"):
        m = re.match(r"step_(\d+)\.pt$", p.name)
        if m:
            out.append(int(m.group(1)))
    return sorted(out)


def atomic_copy(src: Path, dst: Path) -> None:
    tmp = dst.with_name(dst.name + ".tmp")
    shutil.copyfile(src, tmp)
    os.replace(tmp, dst)


def promote_best(run_dir: str | Path, step: int) -> None:
    d = ckpt_dir(run_dir)
    atomic_copy(d / f"step_{step}.pt", d / "best.pt")
    (d / "best_step.txt").write_text(str(step))


def best_step(run_dir: str | Path) -> int | None:
    p = ckpt_dir(run_dir) / "best_step.txt"
    return int(p.read_text().strip()) if p.exists() else None

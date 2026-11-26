"""Checkpoint files of a run (runs/<name>/ckpt/). No torch import at module level.

  step_<N>.pt   full checkpoint (model + optimizer + scheduler + counters), kept for the last train.keepCheckpoints
  latest.pt     copy of the newest step_<N>.pt (what inference slot 0 serves)
  best.pt       the best model so far (eval gating; equals the first checkpoint until gating promotes another)
  eval.pt       the checkpoint being evaluated, pinned (inference slot 2) so an eval plays one fixed set of weights
                while the trainer keeps publishing latest.pt; eval_step.txt holds its step
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


def pin_eval(run_dir: str | Path, step: int) -> None:
    """Copy step_<step>.pt to eval.pt (served as slot 2) for an evaluation of exactly that checkpoint."""
    d = ckpt_dir(run_dir)
    atomic_copy(d / f"step_{step}.pt", d / "eval.pt")
    (d / "eval_step.txt").write_text(str(step))


def eval_step(run_dir: str | Path) -> int | None:
    p = ckpt_dir(run_dir) / "eval_step.txt"
    return int(p.read_text().strip()) if p.exists() else None


def has_weights(run_dir: str | Path, step: int) -> bool:
    d = ckpt_dir(run_dir)
    return (eval_step(run_dir) == step and (d / "eval.pt").exists()) or (d / f"step_{step}.pt").exists()


def promote_best(run_dir: str | Path, step: int) -> bool:
    """Make the weights of `step` the best model. Prefers the pinned eval.pt when it holds that step (those are the
    weights that were evaluated), else step_<step>.pt. Returns False (and changes nothing) if neither exists any more."""
    d = ckpt_dir(run_dir)
    src = None
    if eval_step(run_dir) == step and (d / "eval.pt").exists():
        src = d / "eval.pt"
    elif (d / f"step_{step}.pt").exists():
        src = d / f"step_{step}.pt"
    if src is None:
        print(f"[ckpt] weights of step {step} are gone (pruned); best.pt not changed", flush=True)
        return False
    atomic_copy(src, d / "best.pt")
    (d / "best_step.txt").write_text(str(step))
    return True


def best_step(run_dir: str | Path) -> int | None:
    p = ckpt_dir(run_dir) / "best_step.txt"
    return int(p.read_text().strip()) if p.exists() else None

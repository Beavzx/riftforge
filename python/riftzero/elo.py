"""Eval bookkeeping: turn tools/train-eval.ts results into runs/<name>/elo.csv rows and apply gating."""
from __future__ import annotations

import csv
import json
import math
from pathlib import Path

from .checkpoints import best_step, has_weights, promote_best

FIELDS = ["time", "step", "opponent", "games", "wins", "losses", "draws", "errors", "score", "elo_diff", "elo_lo", "elo_hi", "best_step", "promoted"]


def elo_from_score(s: float, n: int) -> float:
    if n <= 0:
        return 0.0
    eps = 0.5 / n
    s = min(1 - eps, max(eps, s))
    return 400.0 * math.log10(s / (1 - s))


def elo_interval(s: float, n: int, z: float = 1.96) -> tuple[float, float]:
    if n <= 0:
        return (0.0, 0.0)
    se = math.sqrt(max(1e-9, s * (1 - s)) / n)
    return elo_from_score(s - z * se, n), elo_from_score(s + z * se, n)


def record_eval(run_dir: str | Path, result_file: str | Path, gating: dict) -> list[dict]:
    run_dir = Path(run_dir)
    res = json.loads(Path(result_file).read_text())
    step = int(res["step"])
    rows = []
    promoted = False
    bstep = best_step(run_dir)
    for r in res["results"]:
        n = r["wins"] + r["losses"] + r["draws"]
        lo, hi = elo_interval(r["score"], n)
        if r["opponent"] == "best" and gating.get("enabled") and n > 0 and r["score"] >= float(gating.get("threshold", 0.55)):
            promoted = promote_best(run_dir, step)
        rows.append({"time": res["time"], "step": step, "opponent": r["opponent"], "games": r["games"], "wins": r["wins"],
                     "losses": r["losses"], "draws": r["draws"], "errors": r["errors"], "score": round(r["score"], 4),
                     "elo_diff": round(elo_from_score(r["score"], n), 1), "elo_lo": round(lo, 1), "elo_hi": round(hi, 1),
                     "best_step": bstep, "promoted": promoted and r["opponent"] == "best"})
    # without gating, "best" simply follows the latest evaluated checkpoint
    if not gating.get("enabled") and has_weights(run_dir, step):
        promote_best(run_dir, step)
    path = run_dir / "elo.csv"
    new = not path.exists()
    with open(path, "a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        if new:
            w.writeheader()
        for row in rows:
            w.writerow(row)
    return rows


def read_elo(run_dir: str | Path) -> list[dict]:
    p = Path(run_dir) / "elo.csv"
    if not p.exists():
        return []
    with open(p, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))

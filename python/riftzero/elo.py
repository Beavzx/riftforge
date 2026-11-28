"""Eval bookkeeping: turn tools/train-eval.ts results into runs/<name>/elo.csv rows and apply gating."""
from __future__ import annotations

import csv
import json
import math
from pathlib import Path

from .checkpoints import best_step, has_weights, promote_best

FIELDS = ["time", "step", "opponent", "games", "wins", "losses", "draws", "timeouts", "errors", "score", "elo_diff", "elo_lo", "elo_hi", "best_step", "promoted"]


def _elo(p: float, n: int) -> float:
    eps = 0.5 / (n + 1)                      # the most extreme score n games can show (see elo_from_score)
    p = min(1 - eps, max(eps, p))
    return 400.0 * math.log10(p / (1 - p))


def elo_from_score(s: float, n: int) -> float:
    """Elo difference for score s over n games, with a half-game prior: (s*n + 0.5) / (n + 1). Keeps 0/n and n/n
    finite and, unlike clamping s to [0.5/n, 1 - 0.5/n], doesn't turn a single lost game into exactly 0 Elo."""
    if n <= 0:
        return 0.0
    return _elo((s * n + 0.5) / (n + 1), n)


def wilson(s: float, n: int, z: float = 1.96) -> tuple[float, float]:
    """Wilson score interval for a score / win rate s over n games (0..1; (0, 1) when n = 0)."""
    if n <= 0:
        return (0.0, 1.0)
    z2 = z * z
    centre = (s + z2 / (2 * n)) / (1 + z2 / n)
    half = z * math.sqrt(max(0.0, s * (1 - s)) / n + z2 / (4 * n * n)) / (1 + z2 / n)
    return centre - half, centre + half


def elo_interval(s: float, n: int, z: float = 1.96) -> tuple[float, float]:
    """Wilson score interval, in Elo. The Wald interval (s ± z*sqrt(s(1-s)/n)) has zero width at 0/n and n/n, which
    is exactly what early evals vs SearchAI look like."""
    if n <= 0:
        return (0.0, 0.0)
    a, b = wilson(s, n, z)
    lo, hi = _elo(a, n), _elo(b, n)
    e = elo_from_score(s, n)
    return min(lo, e), max(hi, e)


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
                     "losses": r["losses"], "draws": r["draws"], "timeouts": r.get("timeouts", ""), "errors": r["errors"], "score": round(r["score"], 4),
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

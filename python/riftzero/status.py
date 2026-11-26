"""Show how a run is doing.

    python -m riftzero.status [--run runs/<name> | --config config/train.yaml] [--watch]
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from .config import REPO_ROOT, load_config, run_dir
from .elo import read_elo


def tail_jsonl(p: Path, n: int = 1) -> list[dict]:
    if not p.exists():
        return []
    with open(p, "rb") as f:
        f.seek(0, 2)
        size = f.tell()
        f.seek(max(0, size - 64 * 1024))
        lines = f.read().decode("utf-8", "replace").splitlines()
    out = []
    for l in lines[-n:]:
        try:
            out.append(json.loads(l))
        except ValueError:
            pass
    return out


def fmt_dur(s: float) -> str:
    s = int(s)
    return f"{s // 86400}d {s % 86400 // 3600}h {s % 3600 // 60}m" if s >= 86400 else f"{s // 3600}h {s % 3600 // 60}m {s % 60}s"


def show(rd: Path) -> None:
    st = json.loads((rd / "status.json").read_text()) if (rd / "status.json").exists() else {}
    alive = (rd / "run.pid").exists()
    print(f"run {rd.name}  ({'RUNNING' if alive and st.get('state') == 'running' else st.get('state', 'not started')})  {rd}")
    if st:
        sp = st["selfplay"]
        age = time.time() - st["updated"]
        print(f"  uptime {fmt_dur(st['uptimeSec'])}  (status {age:.0f}s old)  backend {st['backend']}")
        print(f"  workers {st['workersAlive']}/{st['workers']} alive, {st['workerRestarts']} restarts")
        print(f"  self-play: {sp['games']} games ({st['gamesPerSec']*3600:.0f}/h), {sp['positions']} positions, "
              f"timeouts {sp['timeouts']}, errors {sp['errors']}, rollbacks {sp['rollbacks']}, sims/decision "
              f"{sp['sims'] / max(1, sp['decisions']):.1f}")
    m = tail_jsonl(rd / "metrics.jsonl")
    if m:
        m = m[-1]
        print(f"  trainer: step {m['step']}  loss {m['loss']:.4f} (policy {m['loss_policy']:.4f}, value {m['loss_value']:.4f})  "
              f"entropy {m['policy_entropy']:.3f}  lr {m['lr']:.2e}  buffer {m['buffer']}  reuse {m['reuse']:.2f}  "
              f"{m['samples_per_s']:.0f} samples/s")
    elif st.get("backend") != "mock":
        print("  trainer: no training steps yet (waiting for train.minPositions)")
    servers = sorted((rd / "servers").glob("s*.json")) if (rd / "servers").exists() else []
    for p in servers:
        try:
            s = json.loads(p.read_text())
            print(f"  server {p.stem[1:]}: {s['requests']} requests, avg batch {s['avgBatch']:.1f}, model step {s.get('step', 0)}, clients {s['clients']}")
        except (OSError, ValueError, KeyError):
            pass
    rows = read_elo(rd)
    if rows:
        last_step = rows[-1]["step"]
        print(f"  eval @ step {last_step}:")
        for r in rows:
            if r["step"] == last_step:
                print(f"    vs {r['opponent']:<9} {r['wins']}-{r['losses']}-{r['draws']}  score {float(r['score']):.3f}  "
                      f"Elo {float(r['elo_diff']):+.0f} [{float(r['elo_lo']):+.0f}, {float(r['elo_hi']):+.0f}]")
        hist = [r for r in rows if r["opponent"] == "searchai"]
        if len(hist) > 1:
            print("  Elo vs SearchAI over time: " + "  ".join(f"{r['step']}:{float(r['elo_diff']):+.0f}" for r in hist[-8:]))
    errs = sorted((rd / "errors").glob("*.jsonl")) if (rd / "errors").exists() else []
    n_err = sum(sum(1 for _ in open(p, encoding="utf-8", errors="replace")) for p in errs)
    if n_err:
        print(f"  {n_err} game errors logged in {rd / 'errors'} (engine bugs; games are discarded)")


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", default=None)
    ap.add_argument("--config", default=str(REPO_ROOT / "config" / "train.yaml"))
    ap.add_argument("--watch", action="store_true")
    a = ap.parse_args(argv)
    rd = Path(a.run).resolve() if a.run else run_dir(load_config(a.config))
    while True:
        show(rd)
        if not a.watch:
            break
        time.sleep(15)
        print()


if __name__ == "__main__":
    main()

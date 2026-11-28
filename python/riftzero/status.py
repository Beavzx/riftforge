"""Show how a run is doing.

    python -m riftzero.status [--run runs/<name> | --config config/train.yaml] [--watch] [--matchups]
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from .config import REPO_ROOT, load_config, run_dir
from .elo import read_elo, wilson

OPPONENT_WINDOWS_H = (6, 24)
FIXED_OPPONENTS = ("best", "bot", "searchai")


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


def short(deck: str) -> str:
    return deck.removeprefix("home-")


def selfplay_matchups(rd: Path) -> dict[str, list[int]]:
    """Per deck pairing over the whole run, summed over the worker stats files: "a vs b" -> [a wins, b wins, draws]."""
    tot: dict[str, list[int]] = {}
    for p in sorted((rd / "workers").glob("w*.json")) if (rd / "workers").exists() else []:
        try:
            for k, v in (json.loads(p.read_text()).get("matchups") or {}).items():
                t = tot.setdefault(k, [0, 0, 0])
                for i in range(3):
                    t[i] += v[i]
        except (OSError, ValueError):
            continue
    return tot


def jsonl_since(p: Path, cutoff: float, block: int = 1 << 16) -> list[dict]:
    """Rows of an append-only JSONL file whose times only grow, with t >= cutoff, oldest first. Reads backwards from the
    end and stops at the first older row, so a long run's file isn't read in full every refresh."""
    rows: list[dict] = []
    try:
        f = open(p, "rb")
    except OSError:
        return rows
    with f:
        f.seek(0, 2)
        pos, tail, done = f.tell(), b"", False
        while pos > 0 and not done:
            n = min(block, pos)
            pos -= n
            f.seek(pos)
            parts = (f.read(n) + tail).split(b"\n")
            tail = parts.pop(0) if pos > 0 else b""    # may start mid-line: completed by the next (earlier) block
            for line in reversed(parts):
                if not line.strip():
                    continue
                try:
                    r = json.loads(line)
                except ValueError:
                    continue    # a line being written right now
                t = r.get("t") if isinstance(r, dict) else None
                if not isinstance(t, (int, float)):
                    continue
                if t < cutoff:
                    done = True
                    break
                rows.append(r)
    rows.reverse()
    return rows


def opponent_stats(rd: Path, now: float | None = None, windows=OPPONENT_WINDOWS_H) -> dict:
    """Self-play games against fixed opponents (selfplay.opponents), from runs/<name>/workers/wNNN-opponents.jsonl,
    over the last `windows` hours: {"now", "windows": [6, 24], "byOpponent": {opp: {"6": row, "24": row}}}.
    row = games (wins + losses + draws; errors excluded), wins, losses, draws (timeouts included, as in eval),
    timeouts, errors, rate = (wins + draws / 2) / games (the eval score), lo / hi = its 95% Wilson interval, avgTurns."""
    now = time.time() if now is None else now
    d = rd / "workers"
    rows: list[dict] = []
    for p in sorted(d.glob("w*-opponents.jsonl")) if d.exists() else []:
        rows += jsonl_since(p, now - max(windows) * 3600)
    by: dict[str, dict] = {}
    for h in windows:
        t0 = now - h * 3600
        acc: dict[str, dict] = {}
        for r in rows:
            if not (t0 <= r["t"] <= now):
                continue
            a = acc.setdefault(str(r.get("opp")), {"wins": 0, "losses": 0, "draws": 0, "timeouts": 0, "errors": 0, "turns": 0})
            res = r.get("result")
            if res == "win":
                a["wins"] += 1
            elif res == "loss":
                a["losses"] += 1
            elif res in ("draw", "timeout"):
                a["draws"] += 1
                a["timeouts"] += res == "timeout"
            else:
                a["errors"] += 1
                continue
            a["turns"] += int(r.get("turns") or 0)
        for opp, a in acc.items():
            n = a["wins"] + a["losses"] + a["draws"]
            rate = (a["wins"] + 0.5 * a["draws"]) / n if n else None
            lo, hi = wilson(rate, n) if n else (None, None)
            turns = a.pop("turns")
            by.setdefault(opp, {})[str(h)] = {**a, "games": n, "rate": rate, "lo": lo, "hi": hi, "avgTurns": turns / n if n else None}
    for opp in by.values():      # every window present for every opponent seen (zeros where none fell in it)
        for h in windows:
            opp.setdefault(str(h), {"wins": 0, "losses": 0, "draws": 0, "timeouts": 0, "errors": 0, "games": 0,
                                    "rate": None, "lo": None, "hi": None, "avgTurns": None})
    order = {k: i for i, k in enumerate(FIXED_OPPONENTS)}
    return {"now": now, "windows": list(windows), "byOpponent": dict(sorted(by.items(), key=lambda kv: order.get(kv[0], 99)))}


def show_opponents(rd: Path) -> None:
    st = opponent_stats(rd)
    if not st["byOpponent"]:
        return
    print("  training games vs fixed opponents (score = (W + D/2) / games, 95% range):")
    for opp, w in st["byOpponent"].items():
        parts = []
        for h in st["windows"]:
            r = w[str(h)]
            parts.append(f"{h}h " + (f"{100 * r['rate']:.0f}% [{100 * r['lo']:.0f}-{100 * r['hi']:.0f}] {r['wins']}-{r['losses']}-{r['draws']} (n={r['games']})"
                                     if r["games"] else "no games"))
        print(f"    vs {opp:<9} " + "   ".join(parts))


def show_matchups(rd: Path, detail: bool) -> None:
    mu = selfplay_matchups(rd)
    if not mu:
        return
    deck: dict[str, list[int]] = {}   # non-mirror games: [wins, games]
    for k, (a, b, d) in mu.items():
        x, y = k.split(" vs ")
        if x == y:
            continue
        deck.setdefault(x, [0, 0]); deck.setdefault(y, [0, 0])
        deck[x][0] += a; deck[y][0] += b
        deck[x][1] += a + b + d; deck[y][1] += a + b + d
    if deck:
        print("  self-play deck win % (non-mirror, both sides the same net): " + "  ".join(
            f"{short(n)} {100 * w / max(1, g):.0f}% (n={g})" for n, (w, g) in sorted(deck.items(), key=lambda kv: -kv[1][0] / max(1, kv[1][1]))))
    if detail:
        for k, (a, b, d) in sorted(mu.items()):
            x, y = k.split(" vs ")
            print(f"    {short(x):>12} vs {short(y):<12} {a}-{b}-{d}" + (f"  ({100 * a / max(1, a + b + d):.0f}%)" if x != y else "  (mirror)"))


def show_eval_by_deck(rd: Path, step: str) -> None:
    p = rd / "eval" / f"step-{step}.json"
    try:
        res = json.loads(p.read_text())["results"]
    except (OSError, ValueError, KeyError):
        return
    per: dict[str, list[int]] = {}
    for r in res:
        for k, (w, l, d) in (r.get("byMatchup") or {}).items():
            t = per.setdefault(k.split(" vs ")[0], [0, 0, 0])
            t[0] += w; t[1] += l; t[2] += d
    if per:
        print("    net's deck, all opponents: " + "  ".join(f"{short(n)} {w}-{l}-{d}" for n, (w, l, d) in sorted(per.items())))


def show(rd: Path, detail: bool = False) -> None:
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
    show_matchups(rd, detail)
    show_opponents(rd)
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
                to = f" ({r['timeouts']} timeouts)" if r.get("timeouts") not in (None, "", "0") else ""
                print(f"    vs {r['opponent']:<9} {r['wins']}-{r['losses']}-{r['draws']}{to}  score {float(r['score']):.3f}  "
                      f"Elo {float(r['elo_diff']):+.0f} [{float(r['elo_lo']):+.0f}, {float(r['elo_hi']):+.0f}]")
        show_eval_by_deck(rd, last_step)
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
    ap.add_argument("--matchups", action="store_true", help="also list every self-play deck pairing")
    a = ap.parse_args(argv)
    rd = Path(a.run).resolve() if a.run else run_dir(load_config(a.config))
    while True:
        show(rd, a.matchups)
        if not a.watch:
            break
        time.sleep(15)
        print()


if __name__ == "__main__":
    main()

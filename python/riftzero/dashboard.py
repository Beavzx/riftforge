"""Live training dashboard for one run: Elo per eval opponent, losses, throughput, deck and matchup results, and the
training games against fixed opponents (selfplay.opponents).

    python -m riftzero.dashboard [--run runs/<name> | --config config/train.yaml] [--port 8050] [--host 127.0.0.1]
    scripts/dashboard.sh                  # then open http://localhost:8050 (from Windows too: WSL forwards localhost)

It only reads the run's files (status.json, metrics.jsonl, elo.csv, eval/, workers/, servers/), so it can run while
the training runs, after it stopped, or on a copied run directory. The page (dashboard.html next to this file, no
external assets) fetches /api/data every 30 s. It listens on 127.0.0.1 only by default; to watch a remote machine
(e.g. the EPYC box), forward the port with `ssh -L 8050:localhost:8050 <host>` instead of opening it to the network.
"""
from __future__ import annotations

import argparse
import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .config import load_config, run_dir, REPO_ROOT
from .elo import read_elo
from .status import opponent_stats, selfplay_matchups

PAGE = Path(__file__).with_name("dashboard.html")
METRIC_KEYS = ("t", "step", "loss", "loss_policy", "loss_value", "policy_entropy", "lr", "positions_seen",
               "skipped_steps", "grad_norm", "samples_per_s", "reuse", "buffer", "held_v_mse", "held_v_corr", "held_pi_ce")
MAX_METRIC_POINTS = 3000


def _json(p: Path):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def read_metrics(rd: Path) -> list[dict]:
    p = rd / "metrics.jsonl"
    if not p.exists():
        return []
    rows = []
    with open(p, encoding="utf-8", errors="replace") as f:
        for line in f:
            try:
                m = json.loads(line)
            except ValueError:
                continue   # a line being written right now
            rows.append({k: m.get(k) for k in METRIC_KEYS})
    if len(rows) > MAX_METRIC_POINTS:   # keep the page light on long runs; always keep the newest row
        stride = -(-len(rows) // MAX_METRIC_POINTS)
        last = rows[-1]
        rows = rows[::stride]
        if rows[-1] is not last:
            rows.append(last)
    return rows


def read_evals(rd: Path) -> list[dict]:
    out = []
    for r in read_elo(rd):
        try:
            out.append({"step": int(r["step"]), "time": int(float(r["time"])), "opponent": r["opponent"],
                        "games": int(r["games"]), "wins": int(r["wins"]), "losses": int(r["losses"]),
                        "draws": int(r["draws"]), "errors": int(r["errors"]),
                        "timeouts": int(r["timeouts"]) if r.get("timeouts") not in (None, "") else None,
                        "score": float(r["score"]), "elo": float(r["elo_diff"]),
                        "lo": float(r["elo_lo"]), "hi": float(r["elo_hi"])})
        except (KeyError, ValueError, TypeError):
            continue
    return out


def _jsonl(p: Path) -> list[dict]:
    out = []
    try:
        with open(p, encoding="utf-8", errors="replace") as f:
            for line in f:
                try:
                    out.append(json.loads(line))
                except ValueError:
                    continue   # a line being written right now
    except OSError:
        pass
    return out


def _opp_cost(rd: Path, before_step: int) -> dict:
    """Measured seconds per game for each eval opponent, from the newest finished eval with progress lines before
    `before_step` (best games cost about twice the others). Falls back to equal weights."""
    d = rd / "eval"
    for p in sorted(d.glob("progress-*.jsonl"), key=lambda q: int(q.stem.split("-")[1]), reverse=True):
        step = int(p.stem.split("-")[1])
        if step >= before_step:
            continue
        rows = _jsonl(p)
        start = next((r for r in rows if r.get("start")), None)
        if not start or not any(r.get("done") for r in rows):
            continue
        # per shard, a game's cost is the time since the shard's previous game (or the start)
        last: dict = {}
        cost: dict = {}
        for r in rows:
            if not r.get("game"):
                continue
            sh = r.get("shard", 0)
            prev = last.get(sh, start["t"])
            cost.setdefault(r["opp"], []).append(max(0.0, r["t"] - prev))
            last[sh] = r["t"]
        if cost:
            return {o: sum(v) / len(v) for o, v in cost.items()}
    return {}


def eval_schedule(rd: Path, cfg: dict, evals: list[dict], metrics: list[dict]) -> dict:
    """The "Next eval" tile: the eval in progress (games done, ETA from measured pace weighted by each opponent's
    measured cost per game) or, if none, which step is evaluated next and when the trainer gets there."""
    now = time.time()
    d = rd / "eval"
    every = int((cfg.get("train") or {}).get("ckptEverySteps") or 500) * int((cfg.get("eval") or {}).get("everyCheckpoints") or 3)
    out: dict = {"every": every}
    progs = sorted(d.glob("progress-*.jsonl"), key=lambda q: int(q.stem.split("-")[1])) if d.exists() else []
    steps_seen = [int(p.stem.split("-")[1]) for p in progs] + [e["step"] for e in evals]
    # the launcher pins ckpt/eval.pt for every eval it starts, finished or not: its next eval is that step + every
    try:
        steps_seen.append(int((rd / "ckpt" / "eval_step.txt").read_text().strip()))
    except (OSError, ValueError):
        pass
    for p in reversed(progs):
        step = int(p.stem.split("-")[1])
        rows = _jsonl(p)
        start = next((r for r in rows if r.get("start")), None)
        if not start or any(r.get("done") for r in rows) or (d / f"step-{step}.json").exists():
            continue
        last_t = max(r.get("t", 0) for r in rows)
        if now - last_t > 3 * 3600:      # no game finished for 3 h: killed or hung, not running
            continue
        opps, games = start.get("opponents") or [], int(start.get("games") or 0)
        done = [r for r in rows if r.get("game")]
        by_opp = {o: sum(1 for r in done if r.get("opp") == o) for o in opps}
        cost = _opp_cost(rd, step)
        w = {o: cost.get(o, 1.0) for o in opps}
        total_w = sum(w[o] * games for o in opps)
        done_w = sum(w[o] * by_opp[o] for o in opps)
        elapsed = now - start["t"]
        eta = elapsed * (total_w - done_w) / done_w if done_w > 0 else None
        out["running"] = {"step": step, "started": start["t"], "elapsed": elapsed, "done": len(done),
                          "total": games * len(opps), "byOpponent": by_opp, "gamesPerOpponent": games,
                          "eta": eta, "weighted": bool(cost)}
        break
    last_step = max(steps_seen) if steps_seen else 0
    nxt = last_step + every if steps_seen else every
    out["nextStep"] = nxt
    cur = metrics[-1]["step"] if metrics else 0
    recent = [m for m in metrics if m.get("t") and m["t"] >= metrics[-1]["t"] - 3600] if metrics else []
    rate = (recent[-1]["step"] - recent[0]["step"]) / max(1.0, recent[-1]["t"] - recent[0]["t"]) * 3600 if len(recent) > 1 else None
    out["trainerStep"], out["stepsPerHour"] = cur, rate
    out["startsIn"] = max(0.0, (nxt - cur) / rate * 3600) if rate else None
    # how long the last finished eval took (progress lines), for "results about ... after it starts"
    for p in reversed(progs):
        rows = _jsonl(p)
        start = next((r for r in rows if r.get("start")), None)
        fin = next((r for r in rows if r.get("done")), None)
        if start and fin:
            out["lastDuration"] = fin["t"] - start["t"]
            break
    return out


def collect(rd: Path) -> dict:
    """Everything the page shows, as one JSON document."""
    cfg = _json(rd / "config.json") or {}
    resolved = _json(rd / "resolved.json") or {}
    evals = read_evals(rd)
    latest = None
    if evals:
        step = evals[-1]["step"]
        res = _json(rd / "eval" / f"step-{step}.json") or {}
        latest = {"step": step, "byOpponent": {r["opponent"]: r.get("byMatchup") or {} for r in res.get("results", [])}}
    servers = []
    for p in sorted((rd / "servers").glob("s*.json")) if (rd / "servers").exists() else []:
        s = _json(p)
        if s:
            servers.append({"port": p.stem[1:], "avgBatch": s.get("avgBatch"), "requests": s.get("requests"),
                            "step": s.get("step"), "clients": s.get("clients")})
    errs = sorted((rd / "errors").glob("*.jsonl")) if (rd / "errors").exists() else []
    n_err = 0
    for p in errs:
        with open(p, encoding="utf-8", errors="replace") as f:
            n_err += sum(1 for _ in f)
    tr, ev = cfg.get("train", {}), cfg.get("eval", {})
    metrics = read_metrics(rd)
    return {
        "run": rd.name, "now": time.time(), "running": (rd / "run.pid").exists(),
        "status": _json(rd / "status.json"),
        "decks": [Path(p).stem for p in (resolved.get("decks") or {}).get("pool", [])],
        "config": {"ckptEverySteps": tr.get("ckptEverySteps"), "evalEveryCheckpoints": ev.get("everyCheckpoints"),
                   "minPositions": tr.get("minPositions"), "gamesPerOpponent": ev.get("gamesPerOpponent"),
                   "modelSize": (cfg.get("model") or {}).get("size")},
        "metrics": metrics, "evals": evals, "evalLatest": latest,
        "evalSchedule": eval_schedule(rd, cfg, evals, metrics),
        "matchups": selfplay_matchups(rd), "servers": servers, "errorGames": n_err,
        "opponents": {**opponent_stats(rd), "weights": (resolved.get("opponents") or {}).get("weights")},
    }


def make_handler(rd: Path):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            path = self.path.split("?", 1)[0]
            if path in ("/", "/index.html"):
                body, ctype = PAGE.read_bytes(), "text/html; charset=utf-8"
            elif path == "/api/data":
                body, ctype = json.dumps(collect(rd)).encode("utf-8"), "application/json"
            else:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):   # quiet: the page polls every 30 s
            pass
    return Handler


def main(argv=None):
    ap = argparse.ArgumentParser(description="live training dashboard")
    ap.add_argument("--run", default=None, help="run directory (default: the config's run)")
    ap.add_argument("--config", default=str(REPO_ROOT / "config" / "train.yaml"))
    ap.add_argument("--port", type=int, default=8050)
    ap.add_argument("--host", default="127.0.0.1", help="127.0.0.1 = this machine only (use ssh -L for remote)")
    a = ap.parse_args(argv)
    rd = Path(a.run).resolve() if a.run else run_dir(load_config(a.config))
    srv = ThreadingHTTPServer((a.host, a.port), make_handler(rd))
    print(f"[dashboard] {rd}\n[dashboard] open http://localhost:{a.port}   (Ctrl-C to stop; training is not affected)", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()


if __name__ == "__main__":
    main()

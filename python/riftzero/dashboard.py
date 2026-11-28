"""Live training dashboard for one run: win rate against the rules bot (the near-term yardstick), held-out value loss,
Elo against the fixed eval opponents, whether each eval beats the previous checkpoint, losses, throughput, the
training games against fixed opponents (selfplay.opponents), deck and matchup results, change markers and the
machine's temperatures.

    python -m riftzero.dashboard [--run runs/<name> | --config config/train.yaml] [--port 8050] [--host 127.0.0.1]
                                 [--thermal-log ~/thermal-guard.log]
    scripts/dashboard.sh                  # then open http://localhost:8050 (from Windows too: WSL forwards localhost)

It only reads files: the run's status.json, metrics.jsonl, elo.csv, eval/, workers/, servers/ and events.jsonl (one
JSON line per change or incident, drawn as markers on the step charts; format in TRAINING.md), plus the thermal
guard's log (~/thermal-guard.sh writes a sensor line every minute; a missing log just means no readings). So it can
run while the training runs, after it stopped, or on a copied run directory. The page (dashboard.html next to this
file, no external assets) fetches /api/data every 30 s. It listens on 127.0.0.1 only by default; to watch a remote
machine (e.g. the EPYC box), forward the port with `ssh -L 8050:localhost:8050 <host>` instead of opening it to the
network.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .config import load_config, run_dir, REPO_ROOT
from .elo import read_elo, wilson
from .status import opponent_stats, selfplay_matchups

PAGE = Path(__file__).with_name("dashboard.html")
METRIC_KEYS = ("t", "step", "loss", "loss_policy", "loss_value", "policy_entropy", "lr", "positions_seen",
               "skipped_steps", "grad_norm", "samples_per_s", "reuse", "buffer", "held_v_mse", "held_v_corr", "held_pi_ce")
MAX_METRIC_POINTS = 3000
VALUE_FLOOR = 0.67          # held-out value MSE left by outcome randomness alone (epyc-1 offline A/B, 2026-11-28)
EVENT_KINDS = ("change", "incident")
MAX_EVENTS = 200
# ~/thermal-guard.sh writes one line a minute: "<guard time> sensors@<sensor time> ddr5_max=N cpu=N m2=N", sometimes
# followed by " WARNING: ..." or " LIMIT CROSSED: ...". It stops the run at these limits (°C). A reading within
# THERMAL_WARN_MARGIN of a limit shows amber.
THERMAL_LIMITS = {"ddr5": 80, "cpu": 90, "m2": 78}
THERMAL_WARN_MARGIN = 5
GUARD_STALE_S = 180         # the guard writes every 60 s, so 3 minutes without a line means it isn't running
SENSORS_STALE_S = 300       # the guard itself warns when the sensor block is older than this
_GUARD_LINE = re.compile(r"^(\S+) sensors@(\S*) ddr5_max=(\d*) cpu=(\d*) m2=(\d*)\s*(.*)$")


def default_thermal_log() -> Path:
    return Path(os.environ.get("HOME") or Path.home()) / "thermal-guard.log"


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
        e = out[-1]
        n = e["wins"] + e["losses"] + e["draws"]
        e["scoreLo"], e["scoreHi"] = wilson(e["score"], n) if n else (None, None)   # 95% range of the score (win %)
        try:
            e["bestStep"] = int(r.get("best_step") or "")   # which checkpoint "best" was during this eval
        except ValueError:
            e["bestStep"] = None
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


def read_events(rd: Path) -> list[dict]:
    """runs/<name>/events.jsonl: one {t, step, label, kind} per line (kind "change" or "incident"), appended by hand
    when the run's setup changes or something goes wrong. Lines without a label are skipped; an unknown kind counts
    as a change. Sorted by step (lines without one last), then time. A missing file means no events."""
    out = []
    for r in _jsonl(rd / "events.jsonl"):
        if not isinstance(r, dict) or not str(r.get("label") or "").strip():
            continue
        try:
            step = int(r["step"]) if r.get("step") is not None else None
        except (TypeError, ValueError):
            step = None
        try:
            t = float(r["t"]) if r.get("t") is not None else None
        except (TypeError, ValueError):
            t = None
        kind = r.get("kind") if r.get("kind") in EVENT_KINDS else "change"
        out.append({"t": t, "step": step, "label": str(r["label"]).strip(), "kind": kind})
    out.sort(key=lambda e: (e["step"] is None, e["step"] or 0, e["t"] or 0))
    return out[-MAX_EVENTS:]


def _iso(s: str) -> float | None:
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def read_health(path: Path | None, now: float | None = None) -> dict:
    """The Health tile, from the newest line of the thermal guard's log. Always {"path", "exists", "limits"}; when a
    line parses also "guardT", "guardAge", "sensorsT", "sensorsAge", "running" (a line within GUARD_STALE_S),
    "sensorsStale", "temps": {ddr5, cpu, m2: {"c", "limit", "level": ok | warn | crit | unknown}} and "alert" (the
    guard's WARNING / LIMIT CROSSED text on its newest reading, or None). A sensor that reads 0 or blank is unknown:
    that is what the guard prints when it finds no such sensor."""
    now = time.time() if now is None else now
    path = Path(path) if path is not None else default_thermal_log()
    out: dict = {"path": str(path), "exists": path.is_file(), "limits": THERMAL_LIMITS}
    if not out["exists"]:
        return out
    try:
        with open(path, "rb") as f:
            f.seek(0, os.SEEK_END)
            f.seek(max(0, f.tell() - 8192))
            tail = f.read().decode("utf-8", errors="replace").splitlines()
    except OSError:
        out["exists"] = False
        return out
    parsed = [m for m in (_GUARD_LINE.match(line.strip()) for line in tail) if m and _iso(m.group(1)) is not None]
    if not parsed:
        return out
    newest = parsed[-1]
    gt, st = _iso(newest.group(1)), _iso(newest.group(2))
    temps = {}
    for key, raw in zip(("ddr5", "cpu", "m2"), newest.group(3, 4, 5)):
        c, lim = int(raw) if raw else 0, THERMAL_LIMITS[key]
        level = "unknown" if c <= 0 else "crit" if c >= lim else "warn" if c >= lim - THERMAL_WARN_MARGIN else "ok"
        temps[key] = {"c": c if c > 0 else None, "limit": lim, "level": level}
    alerts = [m.group(6).strip() for m in parsed if m.group(1) == newest.group(1) and m.group(6).strip()]
    out.update({"guardT": gt, "guardAge": now - gt, "sensorsT": st, "sensorsAge": now - st if st is not None else None,
                "running": now - gt < GUARD_STALE_S, "sensorsStale": st is None or now - st > SENSORS_STALE_S,
                "temps": temps, "alert": "; ".join(alerts) or None})
    return out


def _ema_last(vals: list[float], w: float = 0.9) -> float | None:
    """Last value of the page's debiased exponential smoothing (the charts' "smoothed" line)."""
    acc = wsum = 0.0
    for v in vals:
        acc, wsum = acc * w + (1 - w) * v, wsum * w + (1 - w)
    return acc / wsum if wsum else None


_Q_EVENT = re.compile(r"value ?target|valueTargetQ", re.I)


def value_summary(metrics: list[dict], value_target_q: float = 0.0, events: list[dict] | None = None) -> dict:
    """The "Value loss, unseen games" tile: the newest held-out measurement (held_v_mse / held_v_corr / held_pi_ce are
    logged at each checkpoint and repeated on the rows after it), the step it was first logged at, the previous
    measurement, and the smoothed training value loss for contrast.
    value_target_q: train.valueTargetQ from the run's config. When it is > 0 the training loss is measured against
    (1 - q) z + q * search value, an easier target, so it drops and can't be compared across the change; the
    held-out loss is always scored against z. "qSinceStep" is the newest events.jsonl line whose label names the value
    target ("value target" / "valueTargetQ"), or None if no such line exists."""
    held: list[dict] = []     # one entry per measurement, i.e. wherever the logged value changes
    for r in metrics:
        if r.get("held_v_mse") is None:
            continue
        if not held or held[-1]["v_mse"] != r["held_v_mse"]:
            held.append({"step": r.get("step"), "v_mse": r["held_v_mse"], "v_corr": r.get("held_v_corr"),
                         "pi_ce": r.get("held_pi_ce")})
    train = [r["loss_value"] for r in metrics if r.get("loss_value") is not None]
    q_events = [e for e in events or [] if e.get("step") is not None and _Q_EVENT.search(e.get("label", ""))]
    return {"held": held[-1] if held else None, "heldPrev": held[-2] if len(held) > 1 else None,
            "heldCount": len(held), "trainSmoothed": _ema_last(train), "floor": VALUE_FLOOR,
            "valueTargetQ": value_target_q, "qSinceStep": q_events[-1]["step"] if value_target_q and q_events else None}


def bot_summary(evals: list[dict], opponents: dict) -> dict:
    """The hero tile: the newest eval vs the rules bot (and the one before), plus the training games vs the bot over
    the last 24 h and 6 h (opponent_stats rows: rate, 95% lo / hi, games, W-L-D; None if the bot never played)."""
    ev = [e for e in evals if e["opponent"] == "bot"]
    by = (opponents.get("byOpponent") or {}).get("bot") or {}
    return {"eval": ev[-1] if ev else None, "evalPrev": ev[-2] if len(ev) > 1 else None,
            "training": by.get("24"), "training6": by.get("6")}


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


def collect(rd: Path, thermal_log: Path | None = None) -> dict:
    """Everything the page shows, as one JSON document. thermal_log: the guard's log (default ~/thermal-guard.log)."""
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
    opponents = {**opponent_stats(rd), "weights": (resolved.get("opponents") or {}).get("weights")}
    events = read_events(rd)
    try:
        q = float(tr.get("valueTargetQ") or 0.0)
    except (TypeError, ValueError):
        q = 0.0
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
        "opponents": opponents, "events": events, "health": read_health(thermal_log),
        "valueSummary": value_summary(metrics, q, events), "botSummary": bot_summary(evals, opponents),
    }


def make_handler(rd: Path, thermal_log: Path | None = None):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            path = self.path.split("?", 1)[0]
            if path in ("/", "/index.html"):
                body, ctype = PAGE.read_bytes(), "text/html; charset=utf-8"
            elif path == "/api/data":
                body, ctype = json.dumps(collect(rd, thermal_log)).encode("utf-8"), "application/json"
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
    ap.add_argument("--thermal-log", default=None, help="thermal guard log for the Health tile (default $HOME/thermal-guard.log)")
    a = ap.parse_args(argv)
    rd = Path(a.run).resolve() if a.run else run_dir(load_config(a.config))
    srv = ThreadingHTTPServer((a.host, a.port), make_handler(rd, Path(a.thermal_log).expanduser() if a.thermal_log else None))
    print(f"[dashboard] {rd}\n[dashboard] open http://localhost:{a.port}   (Ctrl-C to stop; training is not affected)", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()


if __name__ == "__main__":
    main()

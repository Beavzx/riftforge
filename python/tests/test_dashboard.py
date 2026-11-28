"""riftzero.dashboard: the /api/data document from a run directory, and the HTTP server."""
import json
import sys
import threading
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from riftzero.dashboard import collect, make_handler, read_metrics  # noqa: E402
from riftzero.elo import FIELDS  # noqa: E402


def fake_run(rd: Path) -> Path:
    (rd / "workers").mkdir(parents=True)
    (rd / "eval").mkdir()
    (rd / "config.json").write_text(json.dumps({"train": {"ckptEverySteps": 500, "minPositions": 10000},
                                                "eval": {"everyCheckpoints": 3, "gamesPerOpponent": 16}, "model": {"size": "small"}}))
    (rd / "resolved.json").write_text(json.dumps({"decks": {"pool": ["/x/decks/home-azir.json", "/x/decks/home-vex.json"]}}))
    (rd / "status.json").write_text(json.dumps({"state": "running", "updated": 1.0, "uptimeSec": 60, "workers": 14,
                                                "workersAlive": 14, "gamesPerSec": 0.2, "selfplay": {"games": 3, "positions": 120}}))
    lines = [json.dumps({"t": 100.0 + i, "step": 10 * i, "loss": 2.0, "loss_policy": 1.2, "loss_value": 0.9, "policy_entropy": 1.4,
                         "positions_seen": 1000 + i, "extra": "ignored"}) for i in range(5)]
    (rd / "metrics.jsonl").write_text("\n".join(lines) + "\n{partial line")
    (rd / "workers" / "w000.json").write_text(json.dumps({"matchups": {"home-azir vs home-vex": [3, 1, 0]}}))
    (rd / "workers" / "w001.json").write_text(json.dumps({"matchups": {"home-azir vs home-vex": [1, 1, 1]}}))
    row = dict(zip(FIELDS, ["1", "1500", "searchai", "16", "2", "14", "0", "1", "0", "0.125", "-338.0", "-500", "-150", "0", "False"]))
    (rd / "elo.csv").write_text(",".join(FIELDS) + "\n" + ",".join(row[f] for f in FIELDS) + "\n")
    (rd / "eval" / "step-1500.json").write_text(json.dumps({"step": 1500, "results": [
        {"opponent": "searchai", "byMatchup": {"home-azir vs home-vex": [1, 7, 0], "home-vex vs home-azir": [1, 7, 0]}}]}))
    return rd


def test_collect(tmp_path):
    d = collect(fake_run(tmp_path / "home-1"))
    json.dumps(d)   # serialisable
    assert d["run"] == "home-1" and d["decks"] == ["home-azir", "home-vex"]
    assert len(d["metrics"]) == 5 and "extra" not in d["metrics"][0]          # partial last line skipped
    assert d["matchups"] == {"home-azir vs home-vex": [4, 2, 1]}               # summed over workers
    e = d["evals"][0]
    assert (e["step"], e["opponent"], e["wins"], e["losses"], e["timeouts"], e["elo"]) == (1500, "searchai", 2, 14, 1, -338.0)
    assert d["evalLatest"]["step"] == 1500 and "home-azir vs home-vex" in d["evalLatest"]["byOpponent"]["searchai"]
    assert d["config"]["ckptEverySteps"] == 500


def test_collect_on_a_run_that_has_not_started(tmp_path):
    rd = tmp_path / "empty"
    rd.mkdir()
    d = collect(rd)
    assert d["metrics"] == [] and d["evals"] == [] and d["evalLatest"] is None and d["status"] is None


def test_metrics_downsampled_keeps_newest(tmp_path, monkeypatch):
    import riftzero.dashboard as dash
    monkeypatch.setattr(dash, "MAX_METRIC_POINTS", 10)
    (tmp_path / "metrics.jsonl").write_text("\n".join(json.dumps({"step": i}) for i in range(101)))
    rows = read_metrics(tmp_path)
    assert len(rows) <= 11 and rows[0]["step"] == 0 and rows[-1]["step"] == 100


def test_server_serves_page_and_data(tmp_path):
    rd = fake_run(tmp_path / "home-1")
    srv = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(rd))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        base = f"http://127.0.0.1:{srv.server_address[1]}"
        page = urllib.request.urlopen(base + "/").read().decode()
        assert "<title>Riftforge training</title>" in page
        data = json.loads(urllib.request.urlopen(base + "/api/data").read())
        assert data["run"] == "home-1"
    finally:
        srv.shutdown()
        srv.server_close()


def test_eval_schedule_running_eta_weighted_by_measured_opponent_cost(tmp_path):
    """Next-eval tile: a running eval's ETA uses each opponent's seconds per game from the previous eval's progress lines
    (best games cost twice the others here), and the next eval is the newest evaluated step + every."""
    import time as _t
    from riftzero.dashboard import eval_schedule
    rd = tmp_path / "run"
    (rd / "eval").mkdir(parents=True)
    (rd / "ckpt").mkdir()
    cfg = {"train": {"ckptEverySteps": 500}, "eval": {"everyCheckpoints": 12}}
    # finished eval at step 6000: one shard, searchai 10 s/game, best 20 s/game, bot 10 s/game
    t0 = 1000.0
    rows = [{"t": t0, "start": True, "games": 2, "opponents": ["searchai", "best", "bot"], "procs": 1}]
    t = t0
    for opp, c in (("searchai", 10), ("best", 20), ("bot", 10)):
        for k in range(2):
            t += c
            rows.append({"t": t, "game": True, "opp": opp, "k": k, "shard": 0})
    rows.append({"t": t, "done": True})
    (rd / "eval" / "progress-6000.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))
    (rd / "ckpt" / "eval_step.txt").write_text("12000")
    # running eval at step 12000: started 40 s ago, both searchai games done (2 × 10 of 80 weighted units)
    now = _t.time()
    run = [{"t": now - 40, "start": True, "games": 2, "opponents": ["searchai", "best", "bot"], "procs": 1},
           {"t": now - 30, "game": True, "opp": "searchai", "k": 0, "shard": 0},
           {"t": now - 20, "game": True, "opp": "searchai", "k": 1, "shard": 0}]
    (rd / "eval" / "progress-12000.jsonl").write_text("".join(json.dumps(r) + "\n" for r in run))
    metrics = [{"t": now - 3600, "step": 10000}, {"t": now, "step": 12400}]
    s = eval_schedule(rd, cfg, [], metrics)
    r = s["running"]
    assert r["step"] == 12000 and r["done"] == 2 and r["total"] == 6 and r["weighted"]
    # 20 of 80 weighted units done in 40 s → 120 s left (a plain game count would say 80 s)
    assert abs(r["eta"] - 120) < 2
    assert s["nextStep"] == 18000 and s["lastDuration"] == 80
    assert abs(s["stepsPerHour"] - 2400) < 1 and abs(s["startsIn"] - (18000 - 12400) / 2400 * 3600) < 2


def test_opponent_stats_windows_score_and_interval(tmp_path):
    """Training games vs fixed opponents (workers/wNNN-opponents.jsonl): per opponent over the last 6 h and 24 h,
    draws and timeouts count half, errors are left out, older lines are ignored, every worker's file is summed."""
    from riftzero.status import jsonl_since, opponent_stats
    from riftzero.elo import wilson
    rd = tmp_path / "run"
    (rd / "workers").mkdir(parents=True)
    now, h = 1_000_000.0, 3600.0

    def line(t, opp, result, turns=20, seat=0):
        return json.dumps({"t": t, "opp": opp, "seat": seat, "result": result, "turns": turns, "ms": 1000})
    w0 = [line(now - 30 * h, "bot", "win"),                                       # older than 24 h: ignored
          line(now - 20 * h, "bot", "loss"), line(now - 20 * h, "bot", "loss"),   # in the 24 h window only
          line(now - 2 * h, "bot", "win", turns=10), line(now - 1 * h, "bot", "timeout", turns=61),
          line(now - 1 * h, "searchai", "loss"), line(now - 0.5 * h, "bot", "error")]
    w1 = [line(now - 12 * h, "best", "draw"), line(now - 3 * h, "bot", "win", turns=30, seat=1)]
    (rd / "workers" / "w000-opponents.jsonl").write_text("\n".join(w0) + "\n" + '{"t": 999999, "opp": "bo')   # line being written
    (rd / "workers" / "w001-opponents.jsonl").write_text("\n".join(w1) + "\n")
    (rd / "workers" / "w000.json").write_text("{}")             # the worker stats file is not an opponents file
    s = opponent_stats(rd, now=now)
    assert s["windows"] == [6, 24] and list(s["byOpponent"]) == ["best", "bot", "searchai"]
    b6, b24 = s["byOpponent"]["bot"]["6"], s["byOpponent"]["bot"]["24"]
    assert (b6["wins"], b6["losses"], b6["draws"], b6["timeouts"], b6["errors"], b6["games"]) == (2, 0, 1, 1, 1, 3)
    assert abs(b6["rate"] - 2.5 / 3) < 1e-9 and abs(b6["avgTurns"] - (10 + 61 + 30) / 3) < 1e-9
    assert (b6["lo"], b6["hi"]) == wilson(2.5 / 3, 3) and 0 < b6["lo"] < b6["rate"] < b6["hi"] <= 1
    assert (b24["wins"], b24["losses"], b24["draws"], b24["games"]) == (2, 2, 1, 5) and abs(b24["rate"] - 0.5) < 1e-9
    # best: one draw 12 h ago → an empty 6 h row (no rate), 0.5 over 24 h
    assert s["byOpponent"]["best"]["6"]["games"] == 0 and s["byOpponent"]["best"]["6"]["rate"] is None
    assert s["byOpponent"]["best"]["24"]["rate"] == 0.5
    assert s["byOpponent"]["searchai"]["6"]["rate"] == 0.0 and s["byOpponent"]["searchai"]["6"]["hi"] > 0.3
    # the backwards reader returns what a full read would, across block boundaries
    big = rd / "workers" / "w002-opponents.jsonl"
    big.write_text("".join(line(now - 48 * h + i * 60, "bot", "win") + "\n" for i in range(3000)))
    want = [r for r in map(json.loads, big.read_text().splitlines()) if r["t"] >= now - 24 * h]
    assert jsonl_since(big, now - 24 * h, block=777) == want and len(want) > 1000
    assert opponent_stats(tmp_path / "missing", now=now)["byOpponent"] == {}


def test_collect_includes_opponents(tmp_path):
    import time as _t
    rd = fake_run(tmp_path / "home-1")
    (rd / "resolved.json").write_text(json.dumps({"decks": {"pool": []}, "opponents": {"weights": {"self": 0.9, "best": 0, "bot": 0.1, "searchai": 0}}}))
    (rd / "workers" / "w000-opponents.jsonl").write_text(json.dumps({"t": _t.time() - 60, "opp": "bot", "seat": 1, "result": "loss", "turns": 22}) + "\n")
    d = collect(rd)
    json.dumps(d)
    assert d["opponents"]["weights"]["bot"] == 0.1
    assert d["opponents"]["byOpponent"]["bot"]["6"]["losses"] == 1


def _elo_rows(rd: Path, rows: list[list[str]]) -> None:
    (rd / "elo.csv").write_text(",".join(FIELDS) + "\n" + "".join(",".join(r) + "\n" for r in rows))


def test_read_events_sorted_tolerant_and_in_collect(tmp_path):
    """runs/<name>/events.jsonl: change markers. Missing file = none; lines without a label or not JSON are skipped;
    an unknown kind counts as a change; sorted by step (no step last), then time."""
    from riftzero.dashboard import read_events
    rd = fake_run(tmp_path / "home-1")
    assert read_events(rd) == [] and collect(rd)["events"] == []
    lines = [{"t": 300.0, "step": 900, "label": "Restart", "kind": "change"},
             {"t": 200.0, "step": 900, "label": "Crash: OOM", "kind": "incident"},
             {"t": 100.0, "step": 50, "label": " lr 3e-4 -> 2e-4 ", "kind": "tweak"},
             {"t": 50.0, "label": "no step"},
             {"t": 60.0, "step": 70, "label": ""},            # no label: skipped
             {"t": 70.0, "step": "x", "label": "bad step"}]   # step not a number: kept, without a step
    (rd / "events.jsonl").write_text("".join(json.dumps(r) + "\n" for r in lines) + "not json\n" + '{"t": 1, "st')
    ev = read_events(rd)
    assert [e["label"] for e in ev] == ["lr 3e-4 -> 2e-4", "Crash: OOM", "Restart", "no step", "bad step"]
    assert ev[0] == {"t": 100.0, "step": 50, "label": "lr 3e-4 -> 2e-4", "kind": "change"}
    assert ev[1]["kind"] == "incident" and ev[3]["step"] is None and ev[4]["step"] is None
    assert collect(rd)["events"] == ev


def _guard_line(t: float, sensors_age: float, ddr="60", cpu="65", m2="39", extra="") -> str:
    from datetime import datetime, timezone
    def iso(x):
        return datetime.fromtimestamp(x, timezone.utc).isoformat(timespec="seconds")
    return f"{iso(t)} sensors@{iso(t - sensors_age)} ddr5_max={ddr} cpu={cpu} m2={m2}{(' ' + extra) if extra else ''}\n"


def test_read_health_fresh_stale_missing(tmp_path):
    """Health tile from ~/thermal-guard.log: newest line, colour level per sensor against the guard's limits
    (DDR5 80, CPU 90, M.2 78; amber within 5 °C), "running" only if the newest line is under 3 minutes old."""
    from riftzero.dashboard import read_health
    now = 1_795_890_000.0
    log = tmp_path / "thermal-guard.log"
    missing = read_health(tmp_path / "nope.log", now=now)
    assert missing["exists"] is False and "temps" not in missing and missing["path"].endswith("nope.log")
    log.write_text("garbage\n")
    assert read_health(log, now=now)["exists"] is True and "guardT" not in read_health(log, now=now)
    # fresh: older lines are ignored, the newest one counts; a half-written last line is skipped
    log.write_text(_guard_line(now - 600, 60, ddr="84") + _guard_line(now - 30, 58) + "2026-11-28T18:2")
    h = read_health(log, now=now)
    assert h["running"] and not h["sensorsStale"] and h["alert"] is None
    assert abs(h["guardAge"] - 30) < 1e-6 and abs(h["sensorsAge"] - 88) < 1e-6
    assert {k: (v["c"], v["level"]) for k, v in h["temps"].items()} == {"ddr5": (60, "ok"), "cpu": (65, "ok"), "m2": (39, "ok")}
    # levels: warn within 5 °C of the limit, crit at it; 0 / blank = unknown (the guard found no sensor)
    log.write_text(_guard_line(now - 30, 58, ddr="76", cpu="90", m2="0"))
    t = read_health(log, now=now)["temps"]
    assert (t["ddr5"]["level"], t["cpu"]["level"], t["m2"]["level"], t["m2"]["c"]) == ("warn", "crit", "unknown", None)
    log.write_text(_guard_line(now - 30, 58, cpu=""))
    assert read_health(log, now=now)["temps"]["cpu"] == {"c": None, "limit": 90, "level": "unknown"}
    # guard stopped: the newest line is 10 minutes old
    log.write_text(_guard_line(now - 600, 58))
    h = read_health(log, now=now)
    assert h["running"] is False and h["sensorsStale"] is True
    # guard running but the sensor log is old: its WARNING line follows the plain one, with the same guard time
    line = _guard_line(now - 20, 400)
    log.write_text(line + _guard_line(now - 20, 400, extra="WARNING: sensor log is 400s old"))
    h = read_health(log, now=now)
    assert h["running"] and h["sensorsStale"] and h["alert"] == "WARNING: sensor log is 400s old"
    # collect passes the configured path through
    rd = fake_run(tmp_path / "home-1")
    assert collect(rd, thermal_log=log)["health"]["path"] == str(log)
    assert collect(rd, thermal_log=tmp_path / "nope.log")["health"]["exists"] is False


def test_value_summary_held_out_tile(tmp_path):
    """"Value loss, unseen games": newest held-out measurement (logged at a checkpoint, repeated on later rows), the
    step it first appeared, the previous one, and the smoothed training loss for contrast; None without held-out data."""
    from riftzero.dashboard import value_summary
    rd = fake_run(tmp_path / "home-1")
    vs = collect(rd)["valueSummary"]
    assert vs["held"] is None and vs["heldPrev"] is None and vs["floor"] == 0.67 and abs(vs["trainSmoothed"] - 0.9) < 1e-9
    rows = [{"step": 10, "loss_value": 0.5}, {"step": 20, "loss_value": 0.5, "held_v_mse": 0.80, "held_v_corr": 0.5, "held_pi_ce": 1.3},
            {"step": 30, "loss_value": 0.5, "held_v_mse": 0.80, "held_v_corr": 0.5, "held_pi_ce": 1.3},
            {"step": 40, "loss_value": 0.5, "held_v_mse": 0.74, "held_v_corr": 0.54, "held_pi_ce": 1.24},
            {"step": 50, "loss_value": 0.5, "held_v_mse": 0.74, "held_v_corr": 0.54, "held_pi_ce": 1.24}]
    vs = value_summary(rows)
    assert vs["held"] == {"step": 40, "v_mse": 0.74, "v_corr": 0.54, "pi_ce": 1.24}
    assert vs["heldPrev"]["step"] == 20 and vs["heldPrev"]["v_mse"] == 0.80 and vs["heldCount"] == 2
    assert abs(vs["trainSmoothed"] - 0.5) < 1e-9
    assert value_summary([])["trainSmoothed"] is None
    # through collect: read from metrics.jsonl
    (rd / "metrics.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))
    assert collect(rd)["valueSummary"]["held"]["v_mse"] == 0.74
    # blended value target (train.valueTargetQ): the training loss isn't comparable across the change; the step it
    # started comes from the newest events.jsonl line naming the value target
    assert vs["valueTargetQ"] == 0.0 and vs["qSinceStep"] is None
    events = [{"step": 30, "label": "value target 0.9z+0.1q"}, {"step": 45, "label": "Value target 0.75 z + 0.25 q"},
              {"step": 48, "label": "lr change"}]
    assert value_summary(rows, 0.25, events)["qSinceStep"] == 45
    assert value_summary(rows, 0.25, [])["qSinceStep"] is None and value_summary(rows, 0.0, events)["qSinceStep"] is None
    cfg = json.loads((rd / "config.json").read_text())
    cfg["train"]["valueTargetQ"] = 0.25
    (rd / "config.json").write_text(json.dumps(cfg))
    (rd / "events.jsonl").write_text(json.dumps({"t": 1.0, "step": 45, "label": "15% fixed opponents, value target 0.75z+0.25q", "kind": "change"}) + "\n")
    vs = collect(rd)["valueSummary"]
    assert vs["valueTargetQ"] == 0.25 and vs["qSinceStep"] == 45


def test_bot_hero_and_previous_checkpoint_scores(tmp_path):
    """Hero tile: newest eval vs the bot (+ the one before) and the last-24-h training games vs the bot. Every eval
    row carries its score's 95% Wilson range and which checkpoint "best" was."""
    import time as _t
    from riftzero.elo import wilson
    rd = fake_run(tmp_path / "home-1")
    assert collect(rd)["botSummary"] == {"eval": None, "evalPrev": None, "training": None, "training6": None}
    _elo_rows(rd, [["1", "3000", "bot", "40", "7", "33", "0", "0", "0", "0.175", "-260", "-407", "-131", "1500", "False"],
                   ["1", "3000", "best", "40", "26", "14", "0", "0", "0", "0.65", "105", "-3", "218", "1500", "False"],
                   ["2", "6000", "bot", "40", "11", "28", "1", "1", "0", "0.2875", "-160", "-280", "-50", "3000", "False"],
                   ["2", "6000", "best", "40", "13", "27", "0", "0", "0", "0.325", "-124", "-240", "-14", "", "False"]])
    now = _t.time()
    games = ((60, "win"), (120, "loss"), (180, "loss"), (10 * 3600, "loss"), (11 * 3600, "draw"))
    (rd / "workers" / "w000-opponents.jsonl").write_text("".join(
        json.dumps({"t": now - dt, "opp": "bot", "seat": 0, "result": res, "turns": 12}) + "\n" for dt, res in games))
    d = collect(rd)
    json.dumps(d)
    b = d["botSummary"]
    assert b["eval"]["step"] == 6000 and b["eval"]["score"] == 0.2875 and b["evalPrev"]["step"] == 3000
    assert (b["eval"]["scoreLo"], b["eval"]["scoreHi"]) == wilson(0.2875, 40)
    assert b["training"]["games"] == 5 and abs(b["training"]["rate"] - 1.5 / 5) < 1e-9 and b["training6"]["games"] == 3
    best = [e for e in d["evals"] if e["opponent"] == "best"]
    assert [e["bestStep"] for e in best] == [1500, None] and best[1]["scoreLo"] < 0.325 < best[1]["scoreHi"] < 0.5

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

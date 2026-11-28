"""numpy-only tests for the riftzero runtime (no torch needed). Run: PYTHONPATH=python pytest python/tests -q"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "python"))

from riftzero import wire  # noqa: E402
from riftzero.config import DEFAULTS, load_config, resolve  # noqa: E402
from riftzero.dataset import ReplayWindow, collate, make_batch, read_shard  # noqa: E402
from riftzero.elo import elo_from_score, elo_interval, record_eval, read_elo  # noqa: E402
from riftzero.schema import load_schema  # noqa: E402

NODE = shutil.which("node")


def fake_obs(n_e=5, n_a=3, G=7, F=4, A=6, P=2, tag=0x01000005):
    rng = np.random.default_rng(0)
    return wire.Obs(tag=tag, player=1, n_e=n_e, n_a=n_a, global_=rng.normal(size=G).astype(np.float32),
                    entities=rng.normal(size=(n_e, F)).astype(np.float32), card_idx=np.arange(n_e, dtype=np.int32),
                    actions=rng.normal(size=(n_a, A)).astype(np.float32), ptr_idx=np.array([[0, -1]] * n_a, np.int32),
                    ptr_role=np.ones((n_a, P), np.int32), ptr_val=np.zeros((n_a, P), np.float32))


def test_wire_roundtrip():
    o = fake_obs()
    buf = wire.pack_obs(o, shash=1234)
    assert wire.obs_frame_bytes(buf) == len(buf)
    p = wire.parse_obs(buf, expect_hash=1234)
    assert p.slot == 1 and p.tag & 0xFFFFFF == 5 and p.n_e == 5 and p.n_a == 3
    np.testing.assert_array_equal(p.entities, o.entities)
    np.testing.assert_array_equal(p.ptr_idx, o.ptr_idx)
    with pytest.raises(ValueError):
        wire.parse_obs(buf, expect_hash=999)
    tag, v, logits, extra = wire.parse_result(wire.pack_result(77, 0.5, np.array([1, 2, 3], np.float32)))
    assert tag == 77 and v == 0.5 and list(logits) == [1, 2, 3] and extra.size == 0


def test_collate_pads_and_masks():
    a, b = fake_obs(n_e=5, n_a=3), fake_obs(n_e=2, n_a=4)
    batch = collate([wire.pack_obs(a, 1), wire.pack_obs(b, 1)])
    assert batch["entities"].shape == (2, 5, 4) and batch["actions"].shape == (2, 4, 6)
    assert batch["entity_mask"].sum(1).tolist() == [5, 2] and batch["action_mask"].sum(1).tolist() == [3, 4]
    # a pointer into a row that doesn't exist in the (truncated) batch becomes "unknown"
    t = collate([wire.pack_obs(a, 1)], max_entities=0 + 1)
    assert (t["ptr_idx"][0, :, 0] == 0).all()


@pytest.mark.skipif(NODE is None or not (ROOT / "node_modules" / "tsx").exists(), reason="node + tsx needed")
def test_typescript_shard_reads_in_python(tmp_path):
    r = subprocess.run([NODE, "--import", "tsx", str(ROOT / "tests/ai/selfplay/_make_shard.ts"), str(tmp_path)], cwd=ROOT,
                       capture_output=True, text=True, timeout=300)
    assert r.returncode == 0, r.stderr
    info = json.loads(r.stdout.strip().splitlines()[-1])
    schema = load_schema(tmp_path)
    shards = list((tmp_path / "shards").glob("*.rfs"))
    assert len(shards) == 1
    recs = read_shard(shards[0], schema.schema_hash)
    assert len(recs) == info["positions"]
    assert [len(x.pi) for x in recs] == info["nA"]
    assert all(abs(x.pi.sum() - 1) < 1e-5 for x in recs) and {x.z for x in recs} == {1.0, -1.0}
    b = make_batch(recs, schema.max_entities)
    assert b["entities"].shape[2] == schema.F and b["actions"].shape[2] == schema.A and b["ptr_idx"].shape[2] == schema.P
    assert b["pi"].shape == b["action_mask"].shape
    assert np.allclose((b["pi"] * b["action_mask"]).sum(1), 1)
    assert b["card_idx"].max() < schema.card_rows
    w = ReplayWindow(tmp_path / "shards", 100, schema.schema_hash)
    assert w.refresh() == info["positions"] and w.refresh() == 0
    w2 = ReplayWindow(tmp_path / "shards", 100, schema.schema_hash, preseen={shards[0].name})
    assert w2.refresh() == 0 and len(w2) == info["positions"]   # resumed: loaded but not counted again


def test_config_resolution(tmp_path):
    cfg_file = ROOT / "config" / "train.yaml"
    cfg = load_config(cfg_file, {"run": {"runsDir": str(tmp_path)}})
    r = resolve(cfg)
    assert r["env"]["kind"] == "factored"
    assert r["workers"]["count"] >= 1
    assert all(Path(p).is_file() for p in r["decks"]["pool"])
    assert r["caps"]["maxTurns"] == 60 and r["caps"]["maxActions"] == 1500 and r["caps"]["maxMainPerTurn"] == 40
    assert r["evalSearch"]["fullProb"] == 1.0
    for f in ("train-epyc.yaml", "smoke.yaml"):
        rr = resolve(load_config(ROOT / "config" / f, {"run": {"runsDir": str(tmp_path)}}))
        assert rr["servers"]["ports"]


def test_elo_and_gating(tmp_path):
    assert elo_from_score(0.5, 10) == 0
    assert elo_from_score(1.0, 10) > 400
    (tmp_path / "ckpt").mkdir()
    (tmp_path / "ckpt" / "step_100.pt").write_bytes(b"x")
    res = tmp_path / "r.json"
    res.write_text(json.dumps({"step": 100, "time": 0, "results": [
        {"opponent": "best", "games": 10, "wins": 7, "losses": 3, "draws": 0, "errors": 0, "score": 0.7},
        {"opponent": "searchai", "games": 10, "wins": 4, "losses": 6, "draws": 0, "errors": 0, "score": 0.4}]}))
    rows = record_eval(tmp_path, res, {"enabled": True, "threshold": 0.55})
    assert rows[0]["promoted"] and (tmp_path / "ckpt" / "best.pt").exists()
    assert len(read_elo(tmp_path)) == 2


def test_elo_extreme_scores():
    # found in the first GPU smoke run: a 0-1 eval was recorded as +0.0 Elo with a [0, 0] interval
    assert elo_from_score(0.0, 1) < -100 and elo_from_score(1.0, 1) > 100
    assert elo_from_score(0.0, 16) < elo_from_score(1 / 16, 16) < elo_from_score(0.5, 16) == 0
    lo, hi = elo_interval(0.0, 16)          # all losses: the interval must not collapse to a point
    assert lo <= elo_from_score(0.0, 16) < hi and hi - lo > 200
    lo, hi = elo_interval(1.0, 16)
    assert lo < elo_from_score(1.0, 16) <= hi and hi - lo > 200
    lo, hi = elo_interval(0.5, 16)
    assert lo < 0 < hi and abs(lo + hi) < 1e-6


def _write_shard(path, n, z, shash=7):
    """A minimal .rfs shard (read_shard does not parse the observation frame)."""
    import struct as st
    from riftzero.dataset import SHARD_MAGIC
    out = bytearray(st.pack("<4I", SHARD_MAGIC, 1, shash, 0))
    for _ in range(n):
        body = st.pack("<I", 3) + b"obs" + st.pack("<ffI", z, 0.0, 2) + np.array([0.5, 0.5], "<f4").tobytes()
        out += st.pack("<I", len(body)) + body
    path.write_bytes(bytes(out))


def test_replay_window_holds_out_whole_files_never_trained_on(tmp_path):
    import zlib
    d = tmp_path / "shards"; d.mkdir()
    names = [f"w{i:03d}-1-00000.rfs" for i in range(40)]
    for i, nm in enumerate(names):
        _write_shard(d / nm, 5, 1.0 if i % 2 else -1.0)
    held_names = {nm for nm in names if zlib.crc32(nm.encode()) % 4 == 0}
    assert 0 < len(held_names) < len(names)
    w = ReplayWindow(d, 10_000, 7, holdout_every=4)
    n = w.refresh()
    assert n == 5 * (len(names) - len(held_names)) == len(w)       # held-out positions never enter the window...
    assert len(w.held) == 5 * len(held_names) and w.held_files == len(held_names)
    # ...and files from before a resume (possibly trained on) are never used as held-out games
    w2 = ReplayWindow(d, 10_000, 7, holdout_every=4, preseen=set(names))
    w2.refresh()
    assert len(w2) == 5 * len(names) and len(w2.held) == 0

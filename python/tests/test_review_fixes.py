"""Regression tests for the torch-side review fixes (docs/agents/review-torch.md). numpy only."""
from __future__ import annotations

import asyncio
import json
import struct
import sys
import time
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "python"))

from riftzero import wire  # noqa: E402
from riftzero.checkpoints import eval_step, pin_eval, promote_best  # noqa: E402
from riftzero.config import DEFAULTS  # noqa: E402
from riftzero.dataset import BadStepGuard, Prefetcher, Record, ReplayWindow, collate  # noqa: E402
from riftzero.elo import record_eval  # noqa: E402
from riftzero.infer_server import Server, is_oom  # noqa: E402
from riftzero.launch import _scalar, parse_set, servers_serving  # noqa: E402
from riftzero.mock_backend import MockBackend  # noqa: E402
from riftzero.torch_check import arch_supported, cuda_ok, version_in_spec  # noqa: E402


def obs(n_e=4, n_a=3, G=5, F=6, A=7, P=2, tag=1):
    return wire.Obs(tag=tag, player=0, n_e=n_e, n_a=n_a, global_=np.ones(G, np.float32), entities=np.ones((n_e, F), np.float32),
                    card_idx=np.full(n_e, 2, np.int32), actions=np.ones((n_a, A), np.float32), ptr_idx=np.zeros((n_a, P), np.int32),
                    ptr_role=np.ones((n_a, P), np.int32), ptr_val=np.zeros((n_a, P), np.float32))


def rec(n_a=3, i=0) -> Record:
    return Record(frame=wire.pack_obs(obs(n_a=n_a, tag=i), 1), z=1.0, q=0.0, pi=np.full(n_a, 1 / n_a, np.float32))


# ---- 1 / 6: eval pinning, promotion from the pinned file, pruned checkpoints ------------------------------------
def test_pin_eval_and_promote_from_pinned(tmp_path):
    d = tmp_path / "ckpt"; d.mkdir()
    (d / "step_500.pt").write_bytes(b"weights-500")
    pin_eval(tmp_path, 500)
    assert (d / "eval.pt").read_bytes() == b"weights-500" and eval_step(tmp_path) == 500
    (d / "step_500.pt").unlink()               # pruned while the eval ran
    assert promote_best(tmp_path, 500)          # still promotable: from eval.pt
    assert (d / "best.pt").read_bytes() == b"weights-500"
    assert not promote_best(tmp_path, 999)      # no weights at all: no exception, nothing changed
    assert (d / "best.pt").read_bytes() == b"weights-500"


def test_gating_with_pruned_checkpoint_does_not_crash(tmp_path):
    (tmp_path / "ckpt").mkdir()
    res = tmp_path / "r.json"
    res.write_text(json.dumps({"step": 300, "time": 0, "results": [
        {"opponent": "best", "games": 10, "wins": 9, "losses": 1, "draws": 0, "errors": 0, "score": 0.9}]}))
    rows = record_eval(tmp_path, res, {"enabled": True, "threshold": 0.55})
    assert rows[0]["promoted"] is False and not (tmp_path / "ckpt" / "best.pt").exists()


def test_servers_serving_checks_every_port(tmp_path):
    (tmp_path / "servers").mkdir()
    (tmp_path / "servers" / "s1.json").write_text(json.dumps({"slotSteps": {"2": 500}}))
    assert not servers_serving(tmp_path, [1, 2], 2, 500)        # second server hasn't written stats
    (tmp_path / "servers" / "s2.json").write_text(json.dumps({"slotSteps": {"2": 0}}))
    assert not servers_serving(tmp_path, [1, 2], 2, 500)        # second server still on old weights
    (tmp_path / "servers" / "s2.json").write_text(json.dumps({"slotSteps": {"2": 500}}))
    assert servers_serving(tmp_path, [1, 2], 2, 500)


# ---- 2: CPU fallback is opt-in --------------------------------------------------------------------------------
def test_cpu_fallback_off_by_default():
    assert DEFAULTS["train"]["allowCpu"] is False and DEFAULTS["inference"]["allowCpu"] is False


# ---- 3: inference server survives failing batches ---------------------------------------------------------------
async def _roundtrip(backend: MockBackend, frames: list[bytes], max_batch: int) -> list[bytes]:
    srv = Server(backend, schema_hash=1, max_batch=max_batch, timeout_ms=20, reload_every=999, stats_path=None)
    server = await asyncio.start_server(srv.handle, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    task = asyncio.create_task(srv.batcher())
    try:
        r, w = await asyncio.open_connection("127.0.0.1", port)
        w.write(wire.with_length(wire.pack_hello(1)))
        (n,) = struct.unpack("<I", await r.readexactly(4)); await r.readexactly(n)   # ACK
        out = []
        for batch in frames:   # each entry: frames sent together
            for f in batch:
                w.write(wire.with_length(f))
            await w.drain()
            for _ in batch:
                (n,) = struct.unpack("<I", await r.readexactly(4))
                out.append(await r.readexactly(n))
        w.close()
        return out
    finally:
        task.cancel(); server.close()


def test_server_answers_errors_and_keeps_serving():
    be = MockBackend(fail_first=1)
    f = wire.pack_obs(obs(tag=7), 1)
    out = asyncio.run(_roundtrip(be, [[f], [wire.pack_obs(obs(tag=8), 1)]], max_batch=8))
    tag, msg = wire.parse_error(out[0])
    assert tag == 7 and "injected failure" in msg
    tag2, value, logits, _ = wire.parse_result(out[1])
    assert tag2 == 8 and logits.shape == (3,)


def test_server_splits_batch_on_out_of_memory():
    be = MockBackend(oom_above=2)
    frames = [wire.pack_obs(obs(tag=i), 1) for i in range(1, 9)]
    out = asyncio.run(_roundtrip(be, [frames], max_batch=8))
    tags = sorted(struct.unpack_from("<4I", o, 0)[1] for o in out)
    assert tags == list(range(1, 9))
    assert all(struct.unpack_from("<I", o, 0)[0] == wire.RES_MAGIC for o in out), "every request answered with a result"
    assert be.calls > 1
    assert is_oom(RuntimeError("CUDA out of memory. Tried to allocate 2 GiB"))


def test_is_oom_covers_cublas_handle_allocation_failure():
    # epyc-1 2026-11-28 00:50: not retried, so ~3,600 self-play games failed in 40 s
    assert is_oom(RuntimeError("CUDA error: CUBLAS_STATUS_ALLOC_FAILED when calling `cublasCreate(handle)`"))
    assert is_oom(RuntimeError("cuDNN error: CUDNN_STATUS_ALLOC_FAILED"))
    assert not is_oom(RuntimeError("CUDA error: an illegal memory access was encountered"))


# ---- 4 / 11: prefetcher ----------------------------------------------------------------------------------------
class _Win:
    def __init__(self, recs): self.recs = recs
    def __len__(self): return len(self.recs)
    def sample(self, n): return [self.recs[i % len(self.recs)] for i in range(n)]


def test_prefetcher_reports_a_dead_thread():
    bad = Record(frame=b"\x00" * 64, z=0, q=0, pi=np.ones(1, np.float32))   # not an RFO1 frame -> make_batch raises
    pre = Prefetcher(_Win([bad]), 4, None, min_len=1)
    deadline = time.time() + 5
    with pytest.raises(RuntimeError, match="prefetch thread died"):
        while time.time() < deadline:
            pre.get(timeout=0.2)
    pre.close()


def test_prefetcher_waits_for_min_len():
    win = _Win([rec(i=i) for i in range(3)])
    pre = Prefetcher(win, 4, None, min_len=10)
    assert pre.get(timeout=0.6) is None           # below min_len: no batch, no blocking forever
    win.recs += [rec(i=i) for i in range(10)]
    b = None
    for _ in range(20):
        b = pre.get(timeout=0.3)
        if b is not None:
            break
    assert b is not None and b["pi"].shape[0] == 4
    pre.close()


# ---- 5: non-finite step guard -----------------------------------------------------------------------------------
def test_bad_step_guard_needs_consecutive_failures():
    g = BadStepGuard(3)
    assert not g.bad() and not g.bad()
    g.good()
    assert not g.bad() and not g.bad() and g.bad()
    assert g.total == 5


# ---- 8: collate when the first observation has no entities / options ------------------------------------------
def test_collate_first_obs_empty():
    frames = [wire.pack_obs(obs(n_e=0, n_a=0), 1), wire.pack_obs(obs(n_e=4, n_a=3), 1)]
    b = collate(frames)
    assert b["entities"].shape == (2, 4, 6) and b["actions"].shape == (2, 3, 7) and b["ptr_idx"].shape == (2, 3, 2)
    assert b["entity_mask"].sum(1).tolist() == [0, 4]


# ---- 9: setup.sh torch checks ---------------------------------------------------------------------------------
def test_torch_check_helpers():
    spec = "torch>=2.7.1,<2.11"
    assert version_in_spec("2.7.1+cu128", spec) and version_in_spec("2.10.0", spec)
    assert not version_in_spec("2.6.0+cu124", spec) and not version_in_spec("2.11.0", spec) and not version_in_spec("2.7.0", spec)
    assert cuda_ok("12.8") and cuda_ok("13.0") and not cuda_ok("12.4") and not cuda_ok(None)
    assert arch_supported(120, ["sm_90", "sm_100", "sm_120"])
    assert not arch_supported(120, ["sm_80", "sm_86", "sm_90"])
    assert arch_supported(120, ["sm_90", "compute_90"])        # PTX JIT for newer archs


# ---- 10: --set numbers -------------------------------------------------------------------------------------------
def test_set_values_become_numbers():
    assert _scalar("1e-4") == 1e-4 and isinstance(_scalar("2e3"), float) and _scalar("32") == 32
    assert _scalar("true") is True and _scalar("bf16") == "bf16" and _scalar("[1, 2]") == [1, 2]
    assert parse_set(["target.pointsShaping=1e-1"]) == {"target": {"pointsShaping": 0.1}}


# ---- 12: ring buffer --------------------------------------------------------------------------------------------
def test_replay_window_ring_buffer(tmp_path):
    w = ReplayWindow(tmp_path, capacity=5)
    w._push([rec(i=i) for i in range(8)])
    assert len(w) == 5
    tags = sorted(wire.parse_obs(r.frame).tag for r in w.buf)
    assert tags == [3, 4, 5, 6, 7]                 # the newest 5 kept
    big = ReplayWindow(tmp_path, capacity=200_000)
    r0 = rec()
    big.buf = [r0] * 200_000
    t = time.perf_counter()
    for _ in range(20):
        big.sample(1024)
    assert (time.perf_counter() - t) / 20 < 0.01, "sampling should be O(batch), not O(buffer)"

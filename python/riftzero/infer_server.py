"""Batched inference server for the Node self-play workers.

    python -m riftzero.infer_server --run runs/<name> --port 47000 [--gpu 0] [--backend torch|mock]

Protocol: see wire.py. Requests from all connections are pooled and evaluated in dynamic batches (up to
inference.maxBatch, waiting at most inference.batchTimeoutMs for a batch to fill). Model slots: 0 = latest checkpoint,
1 = best checkpoint, 2 = the pinned eval checkpoint (missing slots fall back to latest). The torch backend reloads
newer checkpoints every inference.reloadEverySec, so workers never need restarting when the trainer publishes weights.

Failures are contained per batch: a CUDA out-of-memory error is retried on halves of the batch (down to single
requests); any other failure answers each affected request with an RFE1 error frame (the client rejects just that
request) and the server keeps serving. Only MAX_CONSECUTIVE_FAILURES failed batches in a row (a poisoned CUDA context)
make it exit — the launcher then restarts it.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import struct
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .schema import load_schema
from .wire import (ACK_OK, ACK_PROTO_MISMATCH, ACK_SCHEMA_MISMATCH, HELLO_MAGIC, PROTO_VERSION, pack_ack, pack_error,
                   pack_result, parse_obs, with_length)

MAX_CONSECUTIVE_FAILURES = 50


def is_oom(e: BaseException) -> bool:
    """CUDA out of memory, including cuBLAS/cuDNN failing to allocate a handle or workspace (epyc-1 2026-11-28 00:50:
    `CUBLAS_STATUS_ALLOC_FAILED when calling cublasCreate(handle)` was not retried and failed ~3,600 games in 40 s)."""
    msg = str(e).lower()
    return ("out of memory" in msg or "status_alloc_failed" in msg or type(e).__name__ == "OutOfMemoryError")


class Server:
    def __init__(self, backend, schema_hash: int, max_batch: int, timeout_ms: float, reload_every: float, stats_path: Path | None):
        self.backend = backend
        self.schema_hash = schema_hash
        # every GPU forward runs on this one thread: each thread that runs a CUDA matmul creates its own cuBLAS handle and
        # workspace outside the memoryFraction cap, and the default pool adds threads whenever a reload holds the idle one
        self.gpu_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="infer-gpu")
        self.max_batch = max_batch
        self.timeout = timeout_ms / 1000.0
        self.reload_every = reload_every
        self.queue: asyncio.Queue = asyncio.Queue()
        self.stats = {"requests": 0, "batches": 0, "clients": 0, "rejected": 0, "started": time.time(), "pid": os.getpid(),
                      "failedBatches": 0, "failedRequests": 0, "oomSplits": 0}
        self.consecutive_failures = 0
        self.stats_path = stats_path

    async def handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        try:
            hello = await self._read_frame(reader)
            magic, version, shash, client_id = struct.unpack_from("<4I", hello, 0)
            if magic != HELLO_MAGIC or version != PROTO_VERSION:
                writer.write(with_length(pack_ack(ACK_PROTO_MISMATCH, self.schema_hash, self.backend.n_slots)))
                await writer.drain(); writer.close(); self.stats["rejected"] += 1
                print(f"[infer] rejected client {client_id}: protocol {version} != {PROTO_VERSION}", flush=True)
                return
            if shash != self.schema_hash:
                writer.write(with_length(pack_ack(ACK_SCHEMA_MISMATCH, self.schema_hash, self.backend.n_slots)))
                await writer.drain(); writer.close(); self.stats["rejected"] += 1
                print(f"[infer] REJECTED client {client_id}: SCHEMA MISMATCH worker {shash} != model {self.schema_hash}", flush=True)
                return
            writer.write(with_length(pack_ack(ACK_OK, self.schema_hash, self.backend.n_slots)))
            self.stats["clients"] += 1
            while True:
                frame = await self._read_frame(reader)
                await self.queue.put((parse_obs(frame), writer))
        except (asyncio.IncompleteReadError, ConnectionError):
            pass
        finally:
            try:
                writer.close()
            except Exception:
                pass

    @staticmethod
    async def _read_frame(reader: asyncio.StreamReader) -> bytes:
        (n,) = struct.unpack("<I", await reader.readexactly(4))
        return await reader.readexactly(n)

    async def batcher(self):
        loop = asyncio.get_running_loop()
        while True:
            items = [await self.queue.get()]
            deadline = loop.time() + self.timeout
            while len(items) < self.max_batch:
                left = deadline - loop.time()
                if left <= 0:
                    break
                try:
                    items.append(await asyncio.wait_for(self.queue.get(), left))
                except asyncio.TimeoutError:
                    break
            while len(items) < self.max_batch and not self.queue.empty():
                items.append(self.queue.get_nowait())
            by_slot: dict[int, list] = {}
            for it in items:
                by_slot.setdefault(it[0].slot, []).append(it)
            for slot, group in by_slot.items():
                obs = [g[0] for g in group]
                try:
                    results = await self._infer(obs, loop)
                    self.consecutive_failures = 0
                except Exception as e:  # contain it: answer these requests with errors, keep serving
                    self.stats["failedBatches"] += 1
                    self.stats["failedRequests"] += len(obs)
                    self.consecutive_failures += 1
                    print(f"[infer] batch of {len(obs)} (slot {slot}) failed ({self.consecutive_failures} in a row): {e!r}", flush=True)
                    msg = f"{type(e).__name__}: {e}"
                    for o, w in group:
                        try:
                            w.write(with_length(pack_error(o.tag, msg)))
                        except Exception:
                            pass
                    if self.consecutive_failures >= MAX_CONSECUTIVE_FAILURES:
                        raise RuntimeError(f"{self.consecutive_failures} consecutive failed batches; exiting so the launcher restarts the server") from e
                    continue
                for (o, w), (value, logits) in zip(group, results):
                    try:
                        w.write(with_length(pack_result(o.tag, value, logits)))
                    except Exception:
                        pass
            self.stats["requests"] += len(items)
            self.stats["batches"] += 1

    async def _infer(self, obs: list, loop):
        """backend.infer, retrying CUDA out-of-memory on halves of the batch."""
        try:
            if self.backend.name == "mock":
                return self.backend.infer(obs)
            return await loop.run_in_executor(self.gpu_pool, self.backend.infer, obs)
        except Exception as e:
            if not is_oom(e) or len(obs) <= 1:
                raise
            self.stats["oomSplits"] += 1
            getattr(self.backend, "on_oom", lambda: None)()
            mid = len(obs) // 2
            print(f"[infer] out of memory on a batch of {len(obs)}; retrying as {mid} + {len(obs) - mid}", flush=True)
            return (await self._infer(obs[:mid], loop)) + (await self._infer(obs[mid:], loop))

    async def reloader(self):
        loop = asyncio.get_running_loop()
        while True:
            await asyncio.sleep(self.reload_every)
            try:
                await loop.run_in_executor(None, self.backend.maybe_reload)
            except Exception as e:  # keep serving the old weights
                print(f"[infer] reload failed: {e}", flush=True)

    async def stats_writer(self, every: float = 5.0):
        while True:
            await asyncio.sleep(every)
            if self.stats_path:
                s = dict(self.stats, updated=time.time(), avgBatch=self.stats["requests"] / max(1, self.stats["batches"]),
                         backend=self.backend.name, step=getattr(self.backend, "step", 0),
                         device=str(getattr(self.backend, "device", "?")),
                         slotSteps={str(k): v for k, v in getattr(self.backend, "slot_steps", {}).items()})
                tmp = self.stats_path.with_suffix(".tmp")
                tmp.write_text(json.dumps(s))
                os.replace(tmp, self.stats_path)


def make_backend(kind: str, run_dir: Path, schema, cfg: dict, gpu: int | None, args=None):
    if kind == "mock":
        from .mock_backend import MockBackend
        return MockBackend(slot_value=bool(getattr(args, "mock_slot_value", False)), fail_first=int(getattr(args, "mock_fail_first", 0) or 0),
                           oom_above=int(getattr(args, "mock_oom_above", 0) or 0))
    from .torch_backend import TorchBackend  # imports torch
    return TorchBackend(run_dir, schema, cfg, gpu)


async def amain(args):
    run_dir = Path(args.run).resolve()
    schema = load_schema(run_dir)
    cfg = json.loads((run_dir / "config.json").read_text())
    inf = cfg["inference"]
    backend = make_backend(args.backend or inf["backend"], run_dir, schema, cfg, args.gpu, args)
    (run_dir / "servers").mkdir(exist_ok=True)
    srv = Server(backend, schema.schema_hash, int(inf["maxBatch"]), float(inf["batchTimeoutMs"]), float(inf["reloadEverySec"]),
                 run_dir / "servers" / f"s{args.port}.json")
    server = await asyncio.start_server(srv.handle, args.host or inf["host"], args.port)
    print(f"[infer] {backend.name} backend serving schema {schema.schema_hash} on {args.host or inf['host']}:{args.port}", flush=True)
    async with server:
        await asyncio.gather(server.serve_forever(), srv.batcher(), srv.reloader(), srv.stats_writer(args.stats_every))


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", required=True)
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--host", default=None)
    ap.add_argument("--gpu", type=int, default=None)
    ap.add_argument("--backend", choices=["torch", "mock"], default=None)
    ap.add_argument("--stats-every", type=float, default=5.0)
    ap.add_argument("--mock-slot-value", action="store_true", help=argparse.SUPPRESS)
    ap.add_argument("--mock-fail-first", type=int, default=0, help=argparse.SUPPRESS)
    ap.add_argument("--mock-oom-above", type=int, default=0, help=argparse.SUPPRESS)
    args = ap.parse_args(argv)
    try:
        asyncio.run(amain(args))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    sys.exit(main())

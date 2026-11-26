"""Batched inference server for the Node self-play workers.

    python -m riftzero.infer_server --run runs/<name> --port 47000 [--gpu 0] [--backend torch|mock]

Protocol: see wire.py. Requests from all connections are pooled and evaluated in dynamic batches (up to
inference.maxBatch, waiting at most inference.batchTimeoutMs for a batch to fill). Model slots: 0 = latest checkpoint,
1 = best checkpoint (falls back to latest). The torch backend reloads newer checkpoints every inference.reloadEverySec,
so workers never need restarting when the trainer publishes new weights.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import struct
import sys
import time
from pathlib import Path

from .schema import load_schema
from .wire import (ACK_OK, ACK_PROTO_MISMATCH, ACK_SCHEMA_MISMATCH, HELLO_MAGIC, PROTO_VERSION, pack_ack, pack_result,
                   parse_obs, with_length)


class Server:
    def __init__(self, backend, schema_hash: int, max_batch: int, timeout_ms: float, reload_every: float, stats_path: Path | None):
        self.backend = backend
        self.schema_hash = schema_hash
        self.max_batch = max_batch
        self.timeout = timeout_ms / 1000.0
        self.reload_every = reload_every
        self.queue: asyncio.Queue = asyncio.Queue()
        self.stats = {"requests": 0, "batches": 0, "clients": 0, "rejected": 0, "started": time.time(), "pid": os.getpid()}
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
                results = await loop.run_in_executor(None, self.backend.infer, obs) if self.backend.name != "mock" else self.backend.infer(obs)
                for (o, w), (value, logits) in zip(group, results):
                    try:
                        w.write(with_length(pack_result(o.tag, value, logits)))
                    except Exception:
                        pass
            self.stats["requests"] += len(items)
            self.stats["batches"] += 1

    async def reloader(self):
        loop = asyncio.get_running_loop()
        while True:
            await asyncio.sleep(self.reload_every)
            try:
                await loop.run_in_executor(None, self.backend.maybe_reload)
            except Exception as e:  # keep serving the old weights
                print(f"[infer] reload failed: {e}", flush=True)

    async def stats_writer(self):
        while True:
            await asyncio.sleep(5)
            if self.stats_path:
                s = dict(self.stats, updated=time.time(), avgBatch=self.stats["requests"] / max(1, self.stats["batches"]),
                         backend=self.backend.name, step=getattr(self.backend, "step", 0))
                tmp = self.stats_path.with_suffix(".tmp")
                tmp.write_text(json.dumps(s))
                os.replace(tmp, self.stats_path)


def make_backend(kind: str, run_dir: Path, schema, cfg: dict, gpu: int | None):
    if kind == "mock":
        from .mock_backend import MockBackend
        return MockBackend()
    from .torch_backend import TorchBackend  # imports torch
    return TorchBackend(run_dir, schema, cfg, gpu)


async def amain(args):
    run_dir = Path(args.run).resolve()
    schema = load_schema(run_dir)
    cfg = json.loads((run_dir / "config.json").read_text())
    inf = cfg["inference"]
    backend = make_backend(args.backend or inf["backend"], run_dir, schema, cfg, args.gpu)
    (run_dir / "servers").mkdir(exist_ok=True)
    srv = Server(backend, schema.schema_hash, int(inf["maxBatch"]), float(inf["batchTimeoutMs"]), float(inf["reloadEverySec"]),
                 run_dir / "servers" / f"s{args.port}.json")
    server = await asyncio.start_server(srv.handle, args.host or inf["host"], args.port)
    print(f"[infer] {backend.name} backend serving schema {schema.schema_hash} on {args.host or inf['host']}:{args.port}", flush=True)
    async with server:
        await asyncio.gather(server.serve_forever(), srv.batcher(), srv.reloader(), srv.stats_writer())


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", required=True)
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--host", default=None)
    ap.add_argument("--gpu", type=int, default=None)
    ap.add_argument("--backend", choices=["torch", "mock"], default=None)
    args = ap.parse_args(argv)
    try:
        asyncio.run(amain(args))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    sys.exit(main())

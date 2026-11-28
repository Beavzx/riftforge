"""Replay data: read .rfs shards written by the Node workers (src/ai/selfplay/shards.ts), keep a sliding window
of the most recent positions in memory, and build padded numpy minibatches. numpy only (torch not needed).

Shard file:  u32[4] header = 0x31534652 "RFS1" | version | schemaHash | workerId
Record:      u32 recBytes | u32 obsBytes | RFO1 frame | f32 z | f32 q | u32 nA | f32 pi[nA]
"""
from __future__ import annotations

import os
import zlib
import queue
import struct
import threading
import time
from collections import deque
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .wire import parse_obs

SHARD_MAGIC = 0x31534652


@dataclass
class Record:
    frame: bytes      # RFO1 observation frame
    z: float          # outcome target
    q: float          # search value
    pi: np.ndarray    # policy target (nA,)


def read_shard(path: str | Path, expect_hash: int | None = None) -> list[Record]:
    data = Path(path).read_bytes()
    if len(data) < 16:
        return []
    magic, version, shash, _wid = struct.unpack_from("<4I", data, 0)
    if magic != SHARD_MAGIC:
        raise ValueError(f"{path}: not a .rfs shard")
    if expect_hash is not None and shash != expect_hash:
        raise ValueError(f"{path}: schema hash {shash} != run schema {expect_hash} (shard from another encoder version)")
    out: list[Record] = []
    off = 16
    while off + 4 <= len(data):
        (rec,) = struct.unpack_from("<I", data, off)
        end = off + 4 + rec
        if end > len(data):
            break  # truncated tail (should not happen: shards are published by rename)
        k = off + 4
        (ob,) = struct.unpack_from("<I", data, k); k += 4
        frame = data[k:k + ob]; k += ob
        z, q, n_a = struct.unpack_from("<ffI", data, k); k += 12
        pi = np.frombuffer(data, dtype="<f4", count=n_a, offset=k).copy()
        out.append(Record(frame=frame, z=z, q=q, pi=pi))
        off = end
    return out


class ReplayWindow:
    """The newest `capacity` positions from runs/<name>/shards/*.rfs (FIFO).

    Stored in a list used as a ring buffer: O(1) random access for sampling (a deque is O(n) per index, ~64 ms per
    1024-sample batch at the EPYC profile's 2M positions).
    """

    def __init__(self, shard_dir: str | Path, capacity: int, schema_hash: int | None = None, seed: int = 0,
                 preseen: set[str] | None = None, holdout_every: int = 0, holdout_keep: int = 4096):
        """`preseen`: shard names already counted before a resume — loaded into the window but not counted again.
        `holdout_every` N > 0: one new shard file in N (by a hash of its name) never enters the window; its newest
        `holdout_keep` positions are kept in `held` to measure loss on games the net was not trained on. Whole files are
        held out, not single positions: positions of one game share z, so a held-out position whose game is in the
        window would let a memorising value head look good."""
        self.preseen = set(preseen or ())
        self.holdout_every = int(holdout_every)
        self.held: deque[Record] = deque(maxlen=int(holdout_keep))
        self.held_files = 0
        self.dir = Path(shard_dir)
        self.capacity = capacity
        self.schema_hash = schema_hash
        self.buf: list[Record] = []
        self._head = 0  # next slot to overwrite once full (= the oldest record)
        self.seen: set[str] = set()
        self.total_positions = 0
        self.rng = np.random.default_rng(seed)

    def refresh(self) -> int:
        """Load shards that appeared since the last call. Returns the number of new positions."""
        if not self.dir.exists():
            return 0
        files = sorted((p for p in self.dir.glob("*.rfs") if p.name not in self.seen), key=lambda p: p.stat().st_mtime)
        cap_files = 4 * max(1, self.capacity // 50)
        if len(files) > cap_files:  # a big backlog (resume): only the newest files can fit in the window anyway
            for p in files[:-cap_files]:
                self.seen.add(p.name)
            files = files[-cap_files:]
        n = 0
        for p in files:
            self.seen.add(p.name)
            try:
                recs = read_shard(p, self.schema_hash)
            except ValueError as e:
                print(f"[dataset] skipping {p.name}: {e}", flush=True)
                continue
            if self.is_holdout(p.name):
                self.held.extend(recs)
                self.held_files += 1
                continue
            self._push(recs)
            if p.name not in self.preseen:
                n += len(recs)
        self.total_positions += n
        return n

    def is_holdout(self, name: str) -> bool:
        """Held-out file? Only files new to this trainer process (not `preseen`): older ones may have been trained on."""
        return self.holdout_every > 0 and name not in self.preseen and zlib.crc32(name.encode()) % self.holdout_every == 0

    def _push(self, recs: list[Record]) -> None:
        cap = self.capacity
        for r in recs:
            if len(self.buf) < cap:
                self.buf.append(r)
            else:
                self.buf[self._head] = r
                self._head = (self._head + 1) % cap

    def __len__(self) -> int:
        return len(self.buf)

    def sample(self, batch_size: int) -> list[Record]:
        idx = self.rng.integers(0, len(self.buf), size=batch_size)
        return [self.buf[i] for i in idx]

    def prune_files(self, keep_files: int) -> None:
        """Delete the oldest shard files beyond `keep_files` (data is already in memory)."""
        files = sorted(self.dir.glob("*.rfs"), key=lambda p: p.stat().st_mtime)
        for p in files[:-keep_files] if keep_files > 0 else []:
            try:
                os.remove(p)
            except OSError:
                pass


class Prefetcher:
    """Builds training minibatches on a background thread (numpy collation overlaps the GPU step).

    Sampling starts only once the window holds `min_len` positions (so the first batches aren't duplicates of the
    first shard). If the thread dies, get() raises instead of blocking forever.
    """

    def __init__(self, window: ReplayWindow, batch_size: int, max_entities: int | None, min_len: int = 1, depth: int = 4):
        self.window, self.bs, self.me, self.min_len = window, batch_size, max_entities, max(1, min_len)
        self.q: queue.Queue = queue.Queue(maxsize=depth)
        self.lock = threading.Lock()
        self.stop = False
        self.error: BaseException | None = None
        self.t = threading.Thread(target=self.run, daemon=True)
        self.t.start()

    def run(self):
        try:
            while not self.stop:
                with self.lock:
                    recs = self.window.sample(self.bs) if len(self.window) >= self.min_len else None
                if recs is None:
                    time.sleep(0.2)
                    continue
                b = make_batch(recs, self.me)
                while not self.stop:
                    try:
                        self.q.put(b, timeout=0.5)
                        break
                    except queue.Full:
                        pass
        except BaseException as e:  # noqa: BLE001 — reported to the consumer by get()
            self.error = e

    def get(self, timeout: float = 1.0):
        """A batch, or None if none was ready within `timeout`. Raises if the prefetch thread died."""
        try:
            return self.q.get(timeout=timeout)
        except queue.Empty:
            if self.error is not None or not self.t.is_alive():
                raise RuntimeError(f"prefetch thread died: {self.error!r}") from self.error
            return None

    def close(self):
        self.stop = True


class BadStepGuard:
    """Counts consecutive non-finite training steps; tells the trainer to abort after `limit` in a row."""

    def __init__(self, limit: int = 10):
        self.limit, self.in_row, self.total = limit, 0, 0

    def bad(self) -> bool:
        """Record a skipped step. Returns True when the run must stop."""
        self.in_row += 1
        self.total += 1
        return self.in_row >= self.limit

    def good(self) -> None:
        self.in_row = 0


def collate(frames: list[bytes], max_entities: int | None = None) -> dict[str, np.ndarray]:
    """Pad a list of RFO1 frames into a batch (numpy). Same layout the model and the inference server use."""
    return collate_obs([parse_obs(f) for f in frames], max_entities)


def collate_obs(obs: list, max_entities: int | None = None) -> dict[str, np.ndarray]:
    """Pad parsed observations (wire.Obs) into a batch."""
    B = len(obs)
    # parse_obs shapes every array from the frame header (G, F, A, P), so shape[1] is right even for 0 rows
    G = obs[0].global_.shape[0]
    F = obs[0].entities.shape[1]
    A = obs[0].actions.shape[1]
    P = obs[0].ptr_idx.shape[1]
    nE = max(1, max(o.n_e for o in obs))
    if max_entities:
        nE = min(nE, max_entities)
    nA = max(1, max(o.n_a for o in obs))
    b = {
        "global": np.zeros((B, G), np.float32),
        "entities": np.zeros((B, nE, F), np.float32),
        "card_idx": np.zeros((B, nE), np.int64),
        "entity_mask": np.zeros((B, nE), bool),
        "actions": np.zeros((B, nA, A), np.float32),
        "action_mask": np.zeros((B, nA), bool),
        "ptr_idx": np.full((B, nA, P), -1, np.int64),
        "ptr_role": np.zeros((B, nA, P), np.int64),
        "ptr_val": np.zeros((B, nA, P), np.float32),
        "n_actions": np.zeros((B,), np.int64),
    }
    for i, o in enumerate(obs):
        e = min(o.n_e, nE)
        b["global"][i] = o.global_
        b["entities"][i, :e] = o.entities[:e]
        b["card_idx"][i, :e] = o.card_idx[:e]
        b["entity_mask"][i, :e] = True
        a = o.n_a
        b["actions"][i, :a] = o.actions
        b["action_mask"][i, :a] = True
        pi = o.ptr_idx.astype(np.int64)
        pi[pi >= e] = -1  # pointers into truncated rows become "unknown"
        b["ptr_idx"][i, :a] = pi
        b["ptr_role"][i, :a] = o.ptr_role
        b["ptr_val"][i, :a] = o.ptr_val
        b["n_actions"][i] = a
    return b


def make_batch(records: list[Record], max_entities: int | None = None) -> dict[str, np.ndarray]:
    b = collate([r.frame for r in records], max_entities)
    nA = b["actions"].shape[1]
    pi = np.zeros((len(records), nA), np.float32)
    for i, r in enumerate(records):
        pi[i, : r.pi.shape[0]] = r.pi
    b["pi"] = pi
    b["z"] = np.array([r.z for r in records], np.float32)
    b["q"] = np.array([r.q for r in records], np.float32)
    return b

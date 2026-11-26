"""RFO1 / RFR1 wire format (mirror of src/ai/encode/wire.ts). numpy only.

On a byte stream every frame is preceded by a little-endian u32 byte length (excluding the length word).

Observation frame "RFO1", header = 11 x u32:
    magic | version | schemaHash | tag | player | nE | nA | G | F | A | P
    f32 global[G] | f32 entities[nE*F] | i32 cardIdx[nE] | f32 actions[nA*A]
    | i32 ptrIdx[nA*P] | i32 ptrRole[nA*P] | f32 ptrVal[nA*P]
Result frame "RFR1", header = 4 x u32:
    magic | tag | nA | nExtra
    f32 value | f32 logits[nA] | f32 extra[nExtra]
"""
from __future__ import annotations

import struct
from dataclasses import dataclass
from typing import BinaryIO, Iterator, Optional

import numpy as np

OBS_MAGIC = 0x314F4652  # b"RFO1"
RES_MAGIC = 0x31524652  # b"RFR1"
OBS_HEADER_WORDS = 11
RES_HEADER_WORDS = 4

_f32 = np.dtype("<f4")
_i32 = np.dtype("<i4")
_u32 = np.dtype("<u4")


@dataclass
class ObsFrame:
    tag: int
    player: int
    version: int
    schema_hash: int
    global_: np.ndarray    # (G,) f32
    entities: np.ndarray   # (nE, F) f32
    card_idx: np.ndarray   # (nE,) i32
    actions: np.ndarray    # (nA, A) f32
    ptr_idx: np.ndarray    # (nA, P) i32, -1 = no entity row
    ptr_role: np.ndarray   # (nA, P) i32, 0 = unused slot
    ptr_val: np.ndarray    # (nA, P) f32

    @property
    def n_entities(self) -> int:
        return self.entities.shape[0]

    @property
    def n_actions(self) -> int:
        return self.actions.shape[0]


def decode_obs(buf: bytes | bytearray | memoryview, expected_hash: Optional[int] = None) -> ObsFrame:
    """Decode one RFO1 frame (without its length prefix). Arrays are copies (safe to keep)."""
    mv = memoryview(buf)
    hdr = np.frombuffer(mv, dtype=_u32, count=OBS_HEADER_WORDS)
    magic, version, shash, tag, player, ne, na, G, F, A, P = (int(x) for x in hdr)
    if magic != OBS_MAGIC:
        raise ValueError(f"bad obs magic {magic:#x}")
    if expected_hash is not None and shash != expected_hash:
        raise ValueError(f"schema hash {shash} != expected {expected_hash}: regenerate python/riftnet/schema.json")
    off = OBS_HEADER_WORDS * 4

    def take(dtype: np.dtype, n: int, shape: tuple) -> np.ndarray:
        nonlocal off
        a = np.frombuffer(mv, dtype=dtype, count=n, offset=off).reshape(shape).copy()
        off += 4 * n
        return a

    g = take(_f32, G, (G,))
    ent = take(_f32, ne * F, (ne, F))
    cidx = take(_i32, ne, (ne,))
    act = take(_f32, na * A, (na, A))
    pidx = take(_i32, na * P, (na, P))
    prole = take(_i32, na * P, (na, P))
    pval = take(_f32, na * P, (na, P))
    if off != len(mv):
        raise ValueError(f"obs frame length mismatch: parsed {off} of {len(mv)} bytes")
    return ObsFrame(tag, player, version, shash, g, ent, cidx, act, pidx, prole, pval)


def encode_obs(f: ObsFrame) -> bytes:
    """Inverse of decode_obs (useful for tests / replay buffers)."""
    ne, F = f.entities.shape
    na, A = f.actions.shape
    P = f.ptr_idx.shape[1] if f.ptr_idx.ndim == 2 else 0
    hdr = np.array([OBS_MAGIC, f.version, f.schema_hash, f.tag, f.player, ne, na, f.global_.shape[0], F, A, P], dtype=_u32)
    parts = [hdr, f.global_.astype(_f32), f.entities.astype(_f32), f.card_idx.astype(_i32), f.actions.astype(_f32),
             f.ptr_idx.astype(_i32), f.ptr_role.astype(_i32), f.ptr_val.astype(_f32)]
    return b"".join(p.tobytes() for p in parts)


def encode_result(tag: int, value: float, logits: np.ndarray, extra: Optional[np.ndarray] = None) -> bytes:
    logits = np.asarray(logits, dtype=_f32).ravel()
    extra = np.zeros(0, dtype=_f32) if extra is None else np.asarray(extra, dtype=_f32).ravel()
    hdr = np.array([RES_MAGIC, tag, logits.shape[0], extra.shape[0]], dtype=_u32)
    return hdr.tobytes() + np.array([value], dtype=_f32).tobytes() + logits.tobytes() + extra.tobytes()


def decode_result(buf: bytes | bytearray | memoryview) -> tuple[int, float, np.ndarray, np.ndarray]:
    magic, tag, na, nx = struct.unpack_from("<4I", buf, 0)
    if magic != RES_MAGIC:
        raise ValueError(f"bad result magic {magic:#x}")
    v = np.frombuffer(buf, dtype=_f32, count=1 + na + nx, offset=16)
    return tag, float(v[0]), v[1:1 + na].copy(), v[1 + na:].copy()


def with_length(frame: bytes) -> bytes:
    return struct.pack("<I", len(frame)) + frame


def iter_frames(stream: BinaryIO) -> Iterator[bytes]:
    """Yield length-prefixed frames from a binary stream until EOF."""
    while True:
        h = stream.read(4)
        if not h:
            return
        if len(h) < 4:
            raise EOFError("truncated length prefix")
        (n,) = struct.unpack("<I", h)
        body = stream.read(n)
        if len(body) < n:
            raise EOFError("truncated frame")
        yield body


def split_frames(buf: bytes) -> list[bytes]:
    """Split a buffer of length-prefixed frames."""
    out, off = [], 0
    while off < len(buf):
        (n,) = struct.unpack_from("<I", buf, off)
        out.append(buf[off + 4: off + 4 + n])
        off += 4 + n
    return out

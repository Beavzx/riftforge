"""Binary wire format shared with the Node workers (src/ai/encode/wire.ts, src/ai/selfplay/client.ts).

Stream framing: u32 little-endian byte length, then the frame.
Frames (all little-endian, 4-byte aligned):
  HELLO (client)  u32[4]  0x31484652 "RFH1" | proto version | schemaHash | clientId
  ACK   (server)  u32[4]  0x31414652 "RFA1" | status 0 ok / 1 schema mismatch / 2 protocol mismatch | server schemaHash | nSlots
  OBS   (client)  "RFO1": header u32[11] = magic | encoderVersion | schemaHash | tag | player | nE | nA | G | F | A | P
                  f32 global[G] | f32 entities[nE*F] | i32 cardIdx[nE] | f32 actions[nA*A] | i32 ptrIdx[nA*P]
                  | i32 ptrRole[nA*P] | f32 ptrVal[nA*P]
  RESULT (server) "RFR1": header u32[4] = magic | tag | nA | nExtra ; f32 value | f32 logits[nA] | f32 extra[nExtra]
tag bits 0-23 = request id, bits 24-31 = model slot (0 = latest, 1 = best).
"""
from __future__ import annotations

import struct
from dataclasses import dataclass

import numpy as np

HELLO_MAGIC = 0x31484652
ACK_MAGIC = 0x31414652
OBS_MAGIC = 0x314F4652
RES_MAGIC = 0x31524652
PROTO_VERSION = 1
OBS_HEADER_WORDS = 11
RES_HEADER_WORDS = 4

ACK_OK, ACK_SCHEMA_MISMATCH, ACK_PROTO_MISMATCH = 0, 1, 2


@dataclass
class Obs:
    tag: int
    player: int
    n_e: int
    n_a: int
    global_: np.ndarray   # (G,) f32
    entities: np.ndarray  # (nE, F) f32
    card_idx: np.ndarray  # (nE,) i32
    actions: np.ndarray   # (nA, A) f32
    ptr_idx: np.ndarray   # (nA, P) i32
    ptr_role: np.ndarray  # (nA, P) i32
    ptr_val: np.ndarray   # (nA, P) f32
    schema_hash: int = 0

    @property
    def slot(self) -> int:
        return (self.tag >> 24) & 0xFF


def parse_obs(buf: bytes | memoryview, expect_hash: int | None = None) -> Obs:
    mv = memoryview(buf)
    hdr = np.frombuffer(mv, dtype="<u4", count=OBS_HEADER_WORDS)
    if int(hdr[0]) != OBS_MAGIC:
        raise ValueError(f"bad observation magic {int(hdr[0]):#x}")
    magic, version, shash, tag, player, n_e, n_a, G, F, A, P = (int(x) for x in hdr)
    if expect_hash is not None and shash != expect_hash:
        raise ValueError(f"schema hash {shash} != expected {expect_hash}")
    off = OBS_HEADER_WORDS * 4

    def take(dtype: str, n: int, shape=None):
        nonlocal off
        a = np.frombuffer(mv, dtype=dtype, count=n, offset=off)
        off += 4 * n
        return a.reshape(shape) if shape is not None else a

    return Obs(
        tag=tag, player=player, n_e=n_e, n_a=n_a,
        global_=take("<f4", G),
        entities=take("<f4", n_e * F, (n_e, F)),
        card_idx=take("<i4", n_e),
        actions=take("<f4", n_a * A, (n_a, A)),
        ptr_idx=take("<i4", n_a * P, (n_a, P)),
        ptr_role=take("<i4", n_a * P, (n_a, P)),
        ptr_val=take("<f4", n_a * P, (n_a, P)),
        schema_hash=shash,
    )


def obs_frame_bytes(buf: bytes | memoryview) -> int:
    hdr = np.frombuffer(memoryview(buf), dtype="<u4", count=OBS_HEADER_WORDS)
    _, _, _, _, _, n_e, n_a, G, F, A, P = (int(x) for x in hdr)
    return 4 * (OBS_HEADER_WORDS + G + n_e * F + n_e + n_a * A + 3 * n_a * P)


def pack_obs(o: Obs, shash: int, version: int = 1) -> bytes:
    """Python-side writer (tests / tools). Mirrors packObs in wire.ts."""
    G, F, A, P = o.global_.shape[0], o.entities.shape[1] if o.n_e else 0, o.actions.shape[1] if o.n_a else 0, o.ptr_idx.shape[1] if o.n_a else 0
    hdr = np.array([OBS_MAGIC, version, shash, o.tag, o.player, o.n_e, o.n_a, G, F, A, P], dtype="<u4")
    parts = [hdr.tobytes(), o.global_.astype("<f4").tobytes(), o.entities.astype("<f4").tobytes(), o.card_idx.astype("<i4").tobytes(),
             o.actions.astype("<f4").tobytes(), o.ptr_idx.astype("<i4").tobytes(), o.ptr_role.astype("<i4").tobytes(), o.ptr_val.astype("<f4").tobytes()]
    return b"".join(parts)


def pack_result(tag: int, value: float, logits: np.ndarray, extra: np.ndarray | None = None) -> bytes:
    extra = np.zeros(0, dtype="<f4") if extra is None else np.asarray(extra, dtype="<f4")
    logits = np.asarray(logits, dtype="<f4")
    return struct.pack("<4I", RES_MAGIC, tag & 0xFFFFFFFF, logits.shape[0], extra.shape[0]) + struct.pack("<f", float(value)) + logits.tobytes() + extra.tobytes()


def parse_result(buf: bytes) -> tuple[int, float, np.ndarray, np.ndarray]:
    magic, tag, n_a, n_x = struct.unpack_from("<4I", buf, 0)
    if magic != RES_MAGIC:
        raise ValueError("bad result magic")
    f = np.frombuffer(buf, dtype="<f4", offset=16, count=1 + n_a + n_x)
    return tag, float(f[0]), f[1:1 + n_a].copy(), f[1 + n_a:].copy()


def pack_hello(shash: int, client_id: int = 0) -> bytes:
    return struct.pack("<4I", HELLO_MAGIC, PROTO_VERSION, shash, client_id)


def pack_ack(status: int, shash: int, n_slots: int) -> bytes:
    return struct.pack("<4I", ACK_MAGIC, status, shash, n_slots)


def with_length(frame: bytes) -> bytes:
    return struct.pack("<I", len(frame)) + frame

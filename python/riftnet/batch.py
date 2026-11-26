"""Collate decoded RFO1 frames into padded numpy batches (convert with torch.from_numpy on the GPU side)."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Sequence

import numpy as np

from .wire import ObsFrame


@dataclass
class Batch:
    global_: np.ndarray      # (B, G) f32
    entities: np.ndarray     # (B, E, F) f32, E = max entities in the batch (or pad_entities)
    card_idx: np.ndarray     # (B, E) i64, 0 = pad
    entity_mask: np.ndarray  # (B, E) bool, True = real row
    actions: np.ndarray      # (B, A_max, A) f32
    action_mask: np.ndarray  # (B, A_max) bool
    ptr_idx: np.ndarray      # (B, A_max, P) i64, -1 -> no entity (gather from a learned "unknown" row)
    ptr_role: np.ndarray     # (B, A_max, P) i64, 0 = unused slot
    ptr_val: np.ndarray      # (B, A_max, P) f32
    tags: np.ndarray         # (B,) i64
    players: np.ndarray      # (B,) i64


def collate(frames: Sequence[ObsFrame], pad_entities: Optional[int] = None, pad_actions: Optional[int] = None) -> Batch:
    B = len(frames)
    if B == 0:
        raise ValueError("empty batch")
    G = frames[0].global_.shape[0]
    F = frames[0].entities.shape[1]
    A = frames[0].actions.shape[1]
    P = frames[0].ptr_idx.shape[1]
    E = max(pad_entities or 0, max(f.n_entities for f in frames))
    NA = max(pad_actions or 0, max(f.n_actions for f in frames), 1)
    out = Batch(
        global_=np.zeros((B, G), np.float32), entities=np.zeros((B, E, F), np.float32),
        card_idx=np.zeros((B, E), np.int64), entity_mask=np.zeros((B, E), bool),
        actions=np.zeros((B, NA, A), np.float32), action_mask=np.zeros((B, NA), bool),
        ptr_idx=np.full((B, NA, P), -1, np.int64), ptr_role=np.zeros((B, NA, P), np.int64), ptr_val=np.zeros((B, NA, P), np.float32),
        tags=np.zeros(B, np.int64), players=np.zeros(B, np.int64),
    )
    for b, f in enumerate(frames):
        ne, na = f.n_entities, f.n_actions
        out.global_[b] = f.global_
        out.entities[b, :ne] = f.entities
        out.card_idx[b, :ne] = f.card_idx
        out.entity_mask[b, :ne] = True
        out.actions[b, :na] = f.actions
        out.action_mask[b, :na] = True
        out.ptr_idx[b, :na] = f.ptr_idx
        out.ptr_role[b, :na] = f.ptr_role
        out.ptr_val[b, :na] = f.ptr_val
        out.tags[b] = f.tag
        out.players[b] = f.player
    return out

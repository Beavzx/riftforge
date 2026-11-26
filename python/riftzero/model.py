"""RiftNet: entity-set transformer with a value head and a pointer policy head.

Input (one decision, see dataset.collate / wire.py):
  global   (B, G)         game-level features (points, phase, pending decision, battlefields, ...)
  entities (B, nE, F)     one row per object the player can see (+ unseen-card count rows), dynamic features
  card_idx (B, nE)        card embedding row (0 pad, 1 unknown) — static card features are looked up from it too
  actions  (B, nA, A)     one row per option of the decision
  ptr_*    (B, nA, P)     pointers from each option to entity rows (-1 = hidden/unknown), with a role and a value
Output:
  value  (B,)      expected outcome for the player to act, in [-1, 1]
  logits (B, nA)   one score per option (padding = -inf)

Architecture: entity tokens = proj(dynamic) + proj(card embedding) + proj(static card features); a global token;
a pre-norm transformer encoder over [global, entities]; value = MLP(global token); each option = proj(option features)
+ mean over its pointers of (entity output | learned "unknown") + role embedding + value projection, combined with the
global token in an MLP that outputs the logit.
"""
from __future__ import annotations

import math

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as Fn

SIZES = {
    "tiny":   dict(d_model=64,  layers=2, heads=4, ff=128),
    "small":  dict(d_model=128, layers=4, heads=4, ff=384),
    "medium": dict(d_model=256, layers=6, heads=8, ff=768),
    "large":  dict(d_model=384, layers=8, heads=8, ff=1536),
}

# spare embedding rows so new cards added to cards.json later don't change the model's shape
CARD_ROW_HEADROOM = 512


def model_config(schema, size: str = "small", **over) -> dict:
    if size not in SIZES:
        raise ValueError(f"unknown model size {size}; one of {list(SIZES)}")
    c = dict(SIZES[size])
    c.update({k: v for k, v in over.items() if v is not None})
    c.update(size=size, G=schema.G, F=schema.F, A=schema.A, P=schema.P, n_roles=schema.n_roles,
             static_dim=schema.static_dim, card_rows=schema.card_rows + CARD_ROW_HEADROOM, schema_hash=schema.schema_hash)
    return c


class RiftNet(nn.Module):
    def __init__(self, cfg: dict, card_static: np.ndarray | None = None, dropout: float = 0.0):
        super().__init__()
        self.cfg = dict(cfg)
        d, rows = cfg["d_model"], cfg["card_rows"]
        self.card_emb = nn.Embedding(rows, d)
        nn.init.normal_(self.card_emb.weight, std=0.02)
        static = torch.zeros(rows, cfg["static_dim"])
        if card_static is not None:
            self.set_card_static(card_static, static)
        self.register_buffer("card_static", static, persistent=False)
        self.static_proj = nn.Linear(cfg["static_dim"], d)
        self.ent_proj = nn.Linear(cfg["F"], d)
        self.glob_proj = nn.Sequential(nn.Linear(cfg["G"], d), nn.GELU(), nn.Linear(d, d))
        layer = nn.TransformerEncoderLayer(d, cfg["heads"], cfg["ff"], dropout, batch_first=True, norm_first=True, activation="gelu")
        self.encoder = nn.TransformerEncoder(layer, cfg["layers"], enable_nested_tensor=False)
        self.norm = nn.LayerNorm(d)
        self.value_head = nn.Sequential(nn.Linear(d, d), nn.GELU(), nn.Linear(d, 1))
        self.act_proj = nn.Linear(cfg["A"], d)
        self.role_emb = nn.Embedding(cfg["n_roles"], d)
        self.ptr_val = nn.Linear(1, d)
        self.unknown = nn.Parameter(torch.zeros(d))
        self.policy_head = nn.Sequential(nn.LayerNorm(d), nn.Linear(d, d), nn.GELU(), nn.Linear(d, 1))

    @staticmethod
    def set_card_static(table: np.ndarray, out: torch.Tensor | None = None) -> torch.Tensor:
        t = torch.as_tensor(np.asarray(table, np.float32))
        if out is None:
            return t
        if t.shape[0] > out.shape[0]:
            raise ValueError(f"card table has {t.shape[0]} rows but the model only {out.shape[0]}: train a new model")
        out[: t.shape[0]] = t
        return out

    def load_card_static(self, table: np.ndarray) -> None:
        self.set_card_static(table, self.card_static.data)

    def forward(self, global_, entities, card_idx, entity_mask, actions, action_mask, ptr_idx, ptr_role, ptr_val):
        B, nE, _ = entities.shape
        nA = actions.shape[1]
        rows = self.card_emb.num_embeddings
        cidx = torch.where(card_idx < rows, card_idx, torch.ones_like(card_idx))
        ent = self.ent_proj(entities) + self.card_emb(cidx) + self.static_proj(self.card_static[cidx])
        g = self.glob_proj(global_).unsqueeze(1)
        x = torch.cat([g, ent], dim=1)
        pad = torch.cat([torch.zeros(B, 1, dtype=torch.bool, device=x.device), ~entity_mask], dim=1)
        h = self.norm(self.encoder(x, src_key_padding_mask=pad))
        hg, he = h[:, 0], h[:, 1:]
        value = torch.tanh(self.value_head(hg).squeeze(-1))

        # pointers: gather entity outputs (flat index), unknown embedding for -1
        P = ptr_idx.shape[2]
        valid = ptr_idx >= 0
        flat = (torch.arange(B, device=x.device).view(B, 1, 1) * nE + ptr_idx.clamp(min=0)).reshape(-1)
        gathered = he.reshape(B * nE, -1).index_select(0, flat).view(B, nA, P, -1)
        gathered = torch.where(valid.unsqueeze(-1), gathered, self.unknown.to(gathered.dtype).view(1, 1, 1, -1))
        msg = gathered + self.role_emb(ptr_role) + self.ptr_val(ptr_val.unsqueeze(-1))
        used = (ptr_role > 0).to(msg.dtype).unsqueeze(-1)
        pooled = (msg * used).sum(2) / used.sum(2).clamp(min=1.0)
        a = self.act_proj(actions) + pooled + hg.unsqueeze(1)
        logits = self.policy_head(a).squeeze(-1).float()
        logits = logits.masked_fill(~action_mask, float("-inf"))
        return value.float(), logits


def batch_to_torch(b: dict, device) -> dict:
    keys = ["global", "entities", "card_idx", "entity_mask", "actions", "action_mask", "ptr_idx", "ptr_role", "ptr_val"]
    out = {k: torch.from_numpy(b[k]).to(device, non_blocking=True) for k in keys}
    for k in ("pi", "z", "q"):
        if k in b:
            out[k] = torch.from_numpy(b[k]).to(device, non_blocking=True)
    return out


def forward_batch(model: RiftNet, t: dict):
    return model(t["global"], t["entities"], t["card_idx"], t["entity_mask"], t["actions"], t["action_mask"],
                 t["ptr_idx"], t["ptr_role"], t["ptr_val"])


def build_from_checkpoint(ck: dict, card_static: np.ndarray) -> RiftNet:
    m = RiftNet(ck["model_cfg"], card_static)
    m.load_state_dict(ck["model"])
    return m


def count_params(m: nn.Module) -> int:
    return sum(p.numel() for p in m.parameters())

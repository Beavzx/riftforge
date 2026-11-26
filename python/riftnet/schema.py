"""Encoder schema + static card table (written by `tsx tools/encode-schema.ts`)."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))


@dataclass
class Schema:
    raw: dict
    schema_hash: int
    max_entities: int
    max_ptrs: int
    global_dim: int
    entity_dim: int
    action_dim: int
    static_dim: int
    n_card_rows: int
    ptr_roles: list
    global_names: list
    entity_names: list
    action_names: list
    static_names: list
    card_ids: list
    _table: Optional[np.ndarray] = field(default=None, repr=False)

    def index(self, kind: str, name: str) -> int:
        """Column of a named feature: kind in {'global', 'entity', 'action', 'static'}."""
        names = {"global": self.global_names, "entity": self.entity_names, "action": self.action_names, "static": self.static_names}[kind]
        return names.index(name)

    def card_table(self) -> np.ndarray:
        """(n_card_rows, static_dim) float32; row = card index (0 pad, 1 unknown, 2.. cards)."""
        if self._table is None:
            path = os.path.join(HERE, self.raw["cards"].get("tableFile", "card_table.f32"))
            t = np.fromfile(path, dtype="<f4")
            self._table = t.reshape(self.n_card_rows, self.static_dim)
        return self._table

    def load_text_embeddings(self, path: str) -> np.ndarray:
        """Optional hook: {dim, vectors: {cardId: [...]}} json -> (n_card_rows, dim) matrix aligned to card indices."""
        with open(path) as f:
            d = json.load(f)
        m = np.zeros((self.n_card_rows, d["dim"]), dtype=np.float32)
        first = self.raw["cards"]["firstCardIdx"]
        for i, cid in enumerate(self.card_ids):
            v = d["vectors"].get(cid)
            if v is not None:
                m[first + i] = v
        return m


def load_schema(path: Optional[str] = None) -> Schema:
    with open(path or os.path.join(HERE, "schema.json")) as f:
        s = json.load(f)
    c = s["cards"]
    return Schema(
        raw=s, schema_hash=int(s["schemaHash"]), max_entities=s["maxEntities"], max_ptrs=s["maxPtrs"],
        global_dim=s["global"]["dim"], entity_dim=s["entity"]["dim"], action_dim=s["action"]["dim"],
        static_dim=c["staticDim"], n_card_rows=c["nRows"], ptr_roles=list(s["ptrRoles"]),
        global_names=s["global"]["names"], entity_names=s["entity"]["names"], action_names=s["action"]["names"],
        static_names=c["staticNames"], card_ids=c.get("ids", []),
    )

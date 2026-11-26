"""Encoder schema of a run (written by tools/train-schema.ts into runs/<name>/)."""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np


@dataclass
class Schema:
    raw: dict
    schema_hash: int
    G: int
    F: int
    A: int
    P: int
    n_roles: int
    max_entities: int
    card_rows: int
    static_dim: int
    card_static: np.ndarray  # (card_rows, static_dim) f32

    @property
    def ptr_roles(self) -> list[str]:
        return self.raw["ptrRoles"]


def load_schema(run_dir: str | Path) -> Schema:
    run_dir = Path(run_dir)
    raw = json.loads((run_dir / "schema.json").read_text())
    rows, dim = raw["cards"]["nRows"], raw["cards"]["staticDim"]
    table = np.fromfile(run_dir / raw.get("cardStaticFile", "card_static.f32"), dtype="<f4")
    if table.size != rows * dim:
        raise ValueError(f"card_static.f32 has {table.size} floats, expected {rows}x{dim}")
    return Schema(
        raw=raw, schema_hash=int(raw["schemaHash"]),
        G=raw["global"]["dim"], F=raw["entity"]["dim"], A=raw["action"]["dim"], P=raw["maxPtrs"],
        n_roles=len(raw["ptrRoles"]), max_entities=raw["maxEntities"],
        card_rows=rows, static_dim=dim, card_static=table.reshape(rows, dim),
    )

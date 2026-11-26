"""Export a checkpoint to ONNX (for the browser game / coach without Python).

    python -m riftzero.export --run runs/<name> [--which best|latest|step_12000] [--out runs/<name>/export/riftnet.onnx]

Inputs (dynamic batch B, entities nE, options nA): global (B,G) f32, entities (B,nE,F) f32, card_idx (B,nE) i64,
entity_mask (B,nE) bool, actions (B,nA,A) f32, action_mask (B,nA) bool, ptr_idx/ptr_role (B,nA,P) i64, ptr_val (B,nA,P) f32.
Outputs: value (B,) in [-1,1] for the player to act, logits (B,nA). Also writes a .json with the schema hash and dims.
"""
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

import torch

from .checkpoints import ckpt_dir
from .model import build_from_checkpoint
from .schema import load_schema

NAMES = ["global", "entities", "card_idx", "entity_mask", "actions", "action_mask", "ptr_idx", "ptr_role", "ptr_val"]


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", required=True)
    ap.add_argument("--which", default="best")
    ap.add_argument("--out", default=None)
    ap.add_argument("--opset", type=int, default=17)
    a = ap.parse_args(argv)
    run_dir = Path(a.run).resolve()
    schema = load_schema(run_dir)
    src = ckpt_dir(run_dir) / (a.which if a.which.endswith(".pt") else f"{a.which}.pt")
    ck = torch.load(src, map_location="cpu", weights_only=False)
    model = build_from_checkpoint(ck, schema.card_static).eval()
    B, nE, nA = 2, 8, 4
    G, F, A, P = schema.G, schema.F, schema.A, schema.P
    dummy = (torch.zeros(B, G), torch.zeros(B, nE, F), torch.ones(B, nE, dtype=torch.long), torch.ones(B, nE, dtype=torch.bool),
             torch.zeros(B, nA, A), torch.ones(B, nA, dtype=torch.bool), torch.full((B, nA, P), -1, dtype=torch.long),
             torch.zeros(B, nA, P, dtype=torch.long), torch.zeros(B, nA, P))
    out = Path(a.out) if a.out else run_dir / "export" / f"riftnet-{src.stem}.onnx"
    out.parent.mkdir(parents=True, exist_ok=True)
    dyn = {"global": {0: "B"}, "entities": {0: "B", 1: "nE"}, "card_idx": {0: "B", 1: "nE"}, "entity_mask": {0: "B", 1: "nE"},
           "actions": {0: "B", 1: "nA"}, "action_mask": {0: "B", 1: "nA"}, "ptr_idx": {0: "B", 1: "nA"},
           "ptr_role": {0: "B", 1: "nA"}, "ptr_val": {0: "B", 1: "nA"}, "value": {0: "B"}, "logits": {0: "B", 1: "nA"}}
    torch.onnx.export(model, dummy, str(out), input_names=NAMES, output_names=["value", "logits"], dynamic_axes=dyn,
                      opset_version=a.opset, dynamo=False)
    meta = {"schemaHash": schema.schema_hash, "step": ck.get("step"), "model_cfg": ck["model_cfg"], "inputs": NAMES,
            "outputs": ["value", "logits"]}
    out.with_suffix(".json").write_text(json.dumps(meta, indent=1))
    shutil.copyfile(run_dir / "schema.json", out.parent / "schema.json")
    shutil.copyfile(run_dir / "card_static.f32", out.parent / "card_static.f32")
    print(f"[export] {src.name} (step {ck.get('step')}) -> {out}")


if __name__ == "__main__":
    main()

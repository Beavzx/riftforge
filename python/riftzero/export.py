"""Export a checkpoint to ONNX (for the browser game / coach without Python).

    python -m riftzero.export --run runs/<name> [--which best|latest|step_12000] [--out runs/<name>/export/riftnet.onnx]

Inputs (dynamic batch B, entities nE, options nA): global (B,G) f32, entities (B,nE,F) f32, card_idx (B,nE) i64,
entity_mask (B,nE) bool, actions (B,nA,A) f32, action_mask (B,nA) bool, ptr_idx/ptr_role (B,nA,P) i64, ptr_val (B,nA,P) f32.
Outputs: value (B,) in [-1,1] for the player to act, logits (B,nA). Also writes a .json with the schema hash and dims.

Exporter: tries the new torch.export-based exporter first (torch.onnx.export(dynamo=True) with dynamic shapes; the
TorchScript exporter is deprecated since torch 2.9), and falls back to the TorchScript exporter (dynamo=False) with
the MHA fast path disabled. `--exporter dynamo|torchscript` forces one. If onnx / onnxruntime are installed, the
file is checked and its outputs are compared with PyTorch's. NOTE: untested in the development sandbox (no torch
there); run it once after the first real checkpoint.
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


def verify(path: Path, model, dummy) -> None:
    """Structural check with onnx and a numeric comparison with onnxruntime, when those are installed."""
    try:
        import onnx
        onnx.checker.check_model(str(path))
    except ImportError:
        return
    try:
        import onnxruntime as ort
    except ImportError:
        print("[export] onnx structure OK (install onnxruntime to also compare outputs)")
        return
    sess = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    feeds = {n: t.numpy() for n, t in zip(NAMES, dummy) if n in {i.name for i in sess.get_inputs()}}
    v, lg = sess.run(["value", "logits"], feeds)
    with torch.no_grad():
        tv, tl = model(*dummy)
    dv = float(abs(v - tv.numpy()).max())
    finite = torch.isfinite(tl)
    dl = float(abs(lg[finite.numpy()] - tl[finite].numpy()).max()) if finite.any() else 0.0
    print(f"[export] onnxruntime check: max |value diff| {dv:.2e}, max |logit diff| {dl:.2e}")
    if dv > 1e-3 or dl > 1e-2:
        raise SystemExit("[export] ONNX outputs differ from PyTorch — do not use this file")


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", required=True)
    ap.add_argument("--which", default="best")
    ap.add_argument("--out", default=None)
    ap.add_argument("--opset", type=int, default=18)
    ap.add_argument("--exporter", choices=["auto", "dynamo", "torchscript"], default="auto")
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
    used = None
    errors = []
    if a.exporter in ("auto", "dynamo"):
        try:
            Dim = torch.export.Dim
            Bd, nEd, nAd = Dim("B", min=1, max=65536), Dim("nE", min=1, max=4096), Dim("nA", min=1, max=4096)
            shapes = {"global_": {0: Bd}, "entities": {0: Bd, 1: nEd}, "card_idx": {0: Bd, 1: nEd}, "entity_mask": {0: Bd, 1: nEd},
                      "actions": {0: Bd, 1: nAd}, "action_mask": {0: Bd, 1: nAd}, "ptr_idx": {0: Bd, 1: nAd},
                      "ptr_role": {0: Bd, 1: nAd}, "ptr_val": {0: Bd, 1: nAd}}
            torch.onnx.export(model, dummy, str(out), input_names=NAMES, output_names=["value", "logits"],
                              dynamic_shapes=shapes, opset_version=a.opset, dynamo=True)
            used = "dynamo"
        except Exception as e:  # noqa: BLE001
            errors.append(f"dynamo exporter: {type(e).__name__}: {str(e)[:400]}")
            print(f"[export] dynamo exporter failed ({type(e).__name__}); {'falling back to TorchScript' if a.exporter == 'auto' else 'giving up'}")
    if used is None and a.exporter in ("auto", "torchscript"):
        try:
            if hasattr(torch.backends, "mha"):   # the eval-mode MHA fast path op has no ONNX symbolic
                torch.backends.mha.set_fastpath_enabled(False)
            torch.onnx.export(model, dummy, str(out), input_names=NAMES, output_names=["value", "logits"], dynamic_axes=dyn,
                              opset_version=min(a.opset, 17), dynamo=False)
            used = "torchscript"
        except Exception as e:  # noqa: BLE001
            errors.append(f"torchscript exporter: {type(e).__name__}: {str(e)[:400]}")
    if used is None:
        raise SystemExit("[export] ONNX export failed:\n  " + "\n  ".join(errors))
    verify(out, model, dummy)
    meta = {"schemaHash": schema.schema_hash, "step": ck.get("step"), "model_cfg": ck["model_cfg"], "inputs": NAMES,
            "outputs": ["value", "logits"], "exporter": used, "torch": torch.__version__}
    out.with_suffix(".json").write_text(json.dumps(meta, indent=1))
    shutil.copyfile(run_dir / "schema.json", out.parent / "schema.json")
    shutil.copyfile(run_dir / "card_static.f32", out.parent / "card_static.f32")
    print(f"[export] {src.name} (step {ck.get('step')}) -> {out}  [{used} exporter]")


if __name__ == "__main__":
    main()

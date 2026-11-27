#!/usr/bin/env bash
# Thin wrapper: python -m riftzero.launch with the repo's venv (all logic lives in python/riftzero). Pass any options through.
set -euo pipefail
cd "$(dirname "$0")/.."
PY=.venv/bin/python; [ -x "$PY" ] || PY=python3
# Variable-size batches fragment PyTorch's CUDA cache (the trainer reserved 4 GB for a 1.5 GB working set on the
# EPYC's 8 GB card, beside 2 inference servers). Expandable segments keep reserved ≈ in use. Inherited by the trainer
# and inference servers; set PYTORCH_CUDA_ALLOC_CONF yourself to override.
export PYTORCH_CUDA_ALLOC_CONF="${PYTORCH_CUDA_ALLOC_CONF:-expandable_segments:True}"
PYTHONPATH="$(pwd)/python${PYTHONPATH:+:$PYTHONPATH}" exec "$PY" -m riftzero.launch "$@"

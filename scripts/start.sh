#!/usr/bin/env bash
# Thin wrapper: python -m riftzero.launch with the repo's venv (all logic lives in python/riftzero). Pass any options through.
set -euo pipefail
cd "$(dirname "$0")/.."
PY=.venv/bin/python; [ -x "$PY" ] || PY=python3
PYTHONPATH="$(pwd)/python${PYTHONPATH:+:$PYTHONPATH}" exec "$PY" -m riftzero.launch "$@"

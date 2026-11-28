#!/usr/bin/env bash
# Thin wrapper: python -m riftzero.dashboard with the repo's venv. Then open http://localhost:8050 (Windows browsers
# reach it too: WSL forwards localhost). Options: --run runs/<name>, --config <yaml>, --port N, --host H,
# --thermal-log <path> (Health tile; default ~/thermal-guard.log).
set -euo pipefail
cd "$(dirname "$0")/.."
PY=.venv/bin/python; [ -x "$PY" ] || PY=python3
PYTHONPATH="$(pwd)/python${PYTHONPATH:+:$PYTHONPATH}" exec "$PY" -m riftzero.dashboard "$@"

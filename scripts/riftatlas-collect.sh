#!/usr/bin/env bash
# One low-rate RiftAtlas public-replay collection run (tools/riftatlas/collect.py; stdlib Python only).
# Output and log go to ~/riftatlas-replays/ (outside the repo). Options pass through, e.g. --max 10, --check-token.
# Scheduling (every 4 hours) is documented in docs/data-sources.md; this script does not install anything.
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
DATA="${RIFTATLAS_DATA:-$HOME/riftatlas-replays}"
mkdir -p "$DATA" && chmod 700 "$DATA"
PY=python3; [ -x .venv/bin/python ] && PY=.venv/bin/python
"$PY" tools/riftatlas/collect.py --data-dir "$DATA" "$@" 2>&1 | tee -a "$DATA/collect.log"
exit "${PIPESTATUS[0]}"

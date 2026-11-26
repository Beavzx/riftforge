#!/bin/sh
# META-SIM: run a simulation tool on a frozen copy of the sources (other agents edit src/ concurrently; a
# half-edited file would crash or skew a long run). Copies src/, tools/, tests/fixtures, data/ (incl. meta-decks)
# into $SNAP once src/tools typecheck, then runs the tool there; tools/meta-sim.ts writes results back into this
# tree via META_OUT.
#   sh tools/meta-sim-snapshot.sh tools/meta-sim.ts --decks 20 --games 100 --workers 2
#   REUSE_SNAP=1 sh tools/meta-sim-snapshot.sh tools/ai-bench.ts --games 200
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SNAP=${SNAP:-/tmp/riftforge-meta-snap}
if [ -z "$REUSE_SNAP" ]; then
  (cd "$ROOT" && npx tsc -p . >/tmp/meta-tsc.log 2>&1) || true
  if grep -qE "^(src|tools)/" /tmp/meta-tsc.log; then echo "src/tools typecheck failed; not snapshotting (see /tmp/meta-tsc.log)"; exit 2; fi
  rm -rf "$SNAP"; mkdir -p "$SNAP/tests" "$SNAP/data"
  cp -r "$ROOT/src" "$ROOT/tools" "$SNAP/"
  cp -r "$ROOT/tests/fixtures" "$SNAP/tests/"
  cp "$ROOT"/data/*.json "$SNAP/data/"
  cp -r "$ROOT/data/meta-decks" "$SNAP/data/"
  cp "$ROOT/package.json" "$ROOT/tsconfig.json" "$SNAP/"
  ln -s "$ROOT/node_modules" "$SNAP/node_modules"
  (cd "$ROOT" && (cat src/engine/*.ts src/cards/*.ts src/cards/scripts/*.ts 2>/dev/null | sha1sum | cut -c1-12) > "$SNAP/.snapshot-id")
  date -u +%Y-%m-%dT%H:%M:%SZ >> "$SNAP/.snapshot-id"
fi
TOOL=$1; shift
cd "$SNAP" && META_OUT="$ROOT" node --import tsx "$TOOL" "$@"

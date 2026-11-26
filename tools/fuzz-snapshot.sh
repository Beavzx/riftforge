#!/bin/sh
# Fuzz a frozen copy of the sources (other agents edit src/ concurrently; a half-edited file would show up as
# spurious failures). Copies src/, tools/, tests/fixtures, data/*.json into $SNAP once it typechecks, then runs
# tools/fuzz.ts there with repros/report written back into this tree.
#   sh tools/fuzz-snapshot.sh --games 3000 --seed 5000 --workers 2 --minutes 8
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SNAP=${SNAP:-/tmp/riftforge-fuzz-snap}
if [ -z "$REUSE_SNAP" ]; then
  (cd "$ROOT" && npx tsc -p . >/tmp/fuzz-tsc.log 2>&1) || true
  if grep -qE "^(src|tools)/" /tmp/fuzz-tsc.log; then echo "src/tools typecheck failed; not snapshotting (see /tmp/fuzz-tsc.log)"; exit 2; fi
  rm -rf "$SNAP"; mkdir -p "$SNAP/tests" "$SNAP/data"
  cp -r "$ROOT/src" "$ROOT/tools" "$SNAP/"
  cp -r "$ROOT/tests/fixtures" "$SNAP/tests/"
  cp "$ROOT"/data/*.json "$SNAP/data/"
  cp "$ROOT/package.json" "$ROOT/tsconfig.json" "$SNAP/"
  ln -s "$ROOT/node_modules" "$SNAP/node_modules"
fi
cd "$SNAP" && FUZZ_OUT="$ROOT" node --import tsx tools/fuzz.ts "$@"

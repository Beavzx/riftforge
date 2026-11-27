#!/usr/bin/env bash
# PERF: run the golden traces in parallel and write/compare a baseline.
#   tools/perf-golden.sh record <out.jsonl>        # e.g. on the unmodified engine
#   tools/perf-golden.sh check  <baseline.jsonl>   # after a change: every hash must match
# Env: SP (self-play games, default 64), EG (engine games, default 600), J (parallel processes, default 8).
set -euo pipefail
cd "$(dirname "$0")/.."
SP=${SP:-64}; EG=${EG:-600}; J=${J:-8}
mode=$1; file=$2
tmp=$(mktemp -d)
jobs=()
step=$(( (SP + J - 1) / J )); for ((a=0; a<SP; a+=step)); do jobs+=("selfplay $a $(( a+step < SP ? a+step : SP ))"); done
step=$(( (EG + J - 1) / J )); for ((a=0; a<EG; a+=step)); do jobs+=("engine $a $(( a+step < EG ? a+step : EG ))"); done
t0=$(date +%s.%N)
printf '%s\n' "${jobs[@]}" | xargs -P "$J" -I{} sh -c 'node --import tsx tools/perf-golden.ts {} > "$0/$(echo {} | tr " " _).jsonl"' "$tmp"
t1=$(date +%s.%N)
cat "$tmp"/*.jsonl | node -e '
  const rows = require("fs").readFileSync(0, "utf8").trim().split("\n").map(JSON.parse);
  rows.sort((a, b) => a.mode.localeCompare(b.mode) || a.i - b.i);
  for (const r of rows) console.log(JSON.stringify(r));' > "$tmp/all.jsonl"
sum() { node -e '
  const rows = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map(JSON.parse);
  for (const m of ["selfplay", "engine"]) { const r = rows.filter(x => x.mode === m); const ms = r.reduce((a, x) => a + x.ms, 0);
    console.log(`${m}: ${r.length} games, ${(ms / 1000).toFixed(1)} s total game time, ${(ms / Math.max(1, r.length)).toFixed(0)} ms/game`); }' "$1"; }
echo "wall $(echo "$t1 - $t0" | bc) s"
sum "$tmp/all.jsonl"
if [ "$mode" = record ]; then cp "$tmp/all.jsonl" "$file"; echo "baseline written: $file"
else
  node -e '
    const fs = require("fs"); const load = f => new Map(fs.readFileSync(f, "utf8").trim().split("\n").map(JSON.parse).map(r => [r.mode + ":" + r.i, r]));
    const a = load(process.argv[1]), b = load(process.argv[2]); let bad = 0;
    for (const [k, r] of a) { const s = b.get(k); if (!s || s.hash !== r.hash) { bad++; if (bad <= 15) console.log("MISMATCH", k, r.hash, s?.hash, JSON.stringify(s ?? {}).slice(0, 160)); } }
    if (a.size !== b.size) { console.log("count differs", a.size, b.size); bad++; }
    console.log(bad ? `FAIL: ${bad} mismatches` : `OK: all ${a.size} hashes match`); process.exit(bad ? 1 : 0);' "$file" "$tmp/all.jsonl"
fi
rm -rf "$tmp"

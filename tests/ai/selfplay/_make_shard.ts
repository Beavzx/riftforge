// Test helper for python/tests: writes a small .rfs shard (encoded sample positions, made-up targets) + schema files.
//   node --import tsx tests/ai/selfplay/_make_shard.ts <outDir>
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { getLegalActions } from '../../../src/engine/index.ts';
import { encodeActions, encodeObservation } from '../../../src/ai/encode/index.ts';
import { ShardWriter, type Position } from '../../../src/ai/selfplay/shards.ts';
import { samplePositions } from './_util.ts';

const out = process.argv[2];
mkdirSync(join(out, 'shards'), { recursive: true });
const pos: Position[] = samplePositions(21, 12, 3).map((g, i) => {
  const p = g.pending!.player; const legal = getLegalActions(g, p); const obs = encodeObservation(g, p); const acts = encodeActions(g, p, legal, obs);
  const pi = new Float32Array(acts.n).fill(1 / acts.n);
  return { obs, acts, actor: p, policy: pi, q: 0.25, z: i % 2 ? 1 : -1 };
});
const w = new ShardWriter(join(out, 'shards'), 1, 1);
w.addGame(pos);
spawnSync(process.execPath, ['--import', 'tsx', join(import.meta.dirname, '../../../tools/train-schema.ts'), '--out', out], { stdio: 'inherit' });
console.log(JSON.stringify({ positions: pos.length, nA: pos.map(p => p.acts.n), nE: pos.map(p => p.obs.nEntities) }));

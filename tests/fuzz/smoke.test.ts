// Fast interaction-fuzz smoke (FUZZ agent): 40 games with fixed seeds, random legal decks from the whole card pool,
// mixed policies (random / chaos / heuristic bot), invariants after every action (tools/fuzz-lib.ts).
// Hard failures (crash, deadlock, invariant, input mutation, nondeterminism, view leak) fail the test, except
// signatures already filed as engine bugs (tests/fuzz-repros/*.json with triage.status "filed").
// FUZZ_SMOKE_GAMES / FUZZ_SMOKE_SEED override the count / first seed. Full runs: node --import tsx tools/fuzz.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSpec, playFuzzGame, signature, sigHash, DEFAULT_CHECKS, type Repro } from '../../tools/fuzz-lib.ts';

const dir = join(dirname(fileURLToPath(import.meta.url)), '../fuzz-repros');
const filed = new Set<string>(existsSync(dir)
  ? readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('_')).map(f => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Repro)
    .filter(r => r.triage?.status === 'filed' || r.triage?.status === 'wontfix').map(r => r.hash)
  : []);

const N = Number(process.env.FUZZ_SMOKE_GAMES ?? 40);
const S = Number(process.env.FUZZ_SMOKE_SEED ?? 910000);

test(`fuzz smoke: ${N} whole-pool games without crashes, deadlocks or invariant violations`, () => {
  const bad: string[] = [];
  let ended = 0, steps = 0;
  for (let s = S; s < S + N; s++) {
    const r = playFuzzGame(makeSpec(s), { ...DEFAULT_CHECKS, maxSteps: 3000, probeIllegal: 0.15, probeLegal: 0.1, enumCheck: 0.03, jsonCheck: 0.03, viewCheck: 0.05 });
    steps += r.steps;
    if (r.winner !== null) ended++;
    if (r.failure && !filed.has(sigHash(signature(r.failure)))) bad.push(`seed ${s} step ${r.failure.step}: ${r.failure.kind}: ${r.failure.message} [${(r.failure.cards ?? []).join(', ')}]\n${r.failure.stack?.split('\n').slice(0, 4).join('\n') ?? ''}`);
  }
  assert.deepEqual(bad, [], bad.join('\n\n'));
  assert.ok(ended >= N * 0.8, `only ${ended}/${N} games ended (${steps} actions)`);
});

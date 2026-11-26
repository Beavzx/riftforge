import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyAction, getLegalActions } from '../../../src/engine/index.ts';
import { EngineEnv, RollbackError, type Choices } from '../../../src/ai/selfplay/env.ts';
import { FactoredEnv } from '../../../src/ai/selfplay/factored-env.ts';
import { UniformEvaluator } from '../../../src/ai/selfplay/evaluator.ts';
import { assignOutcome, EngineBotAgent, playGame, SearchAgent } from '../../../src/ai/selfplay/game.ts';
import { DEFAULT_CAPS, DEFAULT_SEARCH } from '../../../src/ai/selfplay/config.ts';
import { loadDeckFile } from '../../../src/ai/selfplay/decks.ts';
import { SHARD_MAGIC, ShardWriter } from '../../../src/ai/selfplay/shards.ts';
import { chooseAction } from '../../../src/engine/index.ts';
import { makeRng } from '../../../src/engine/rng.ts';
import { unpackObs } from '../../../src/ai/encode/index.ts';
import type { GameState } from '../../../src/engine/types.ts';
import { samplePositions } from './_util.ts';

const D = join(import.meta.dirname, '../../../data/meta-decks/');
const decks = [loadDeckFile(D + '01-azir.json'), loadDeckFile(D + '02-vex.json')] as [ReturnType<typeof loadDeckFile>, ReturnType<typeof loadDeckFile>];
const fast = { ...DEFAULT_SEARCH, fullSims: 4, fastSims: 2, fullProb: 0.5, maxConsidered: 4 };

test('a full mock self-play game (factored env) completes and records valid positions; shards round-trip', async () => {
  const env = new FactoredEnv(); const rng = makeRng(4);
  const agent = new SearchAgent('nn', env, new UniformEvaluator(), fast, DEFAULT_CAPS, { record: true, noise: true, rng });
  const r = await playGame({ env, agents: [agent, agent], decks, seed: 77, firstPlayer: 0, caps: DEFAULT_CAPS });
  assert.notEqual(r.status, 'error', r.error);
  assert.ok(r.decisions > 10);
  const pos = assignOutcome(agent.positions, r, 0, 0.2);
  assert.ok(pos.length > 0);
  for (const p of pos) {
    assert.equal(p.policy.length, p.acts.n);
    assert.ok(Math.abs(p.policy.reduce((a, b) => a + b, 0) - 1) < 1e-4);
    assert.ok(p.z! >= -1 && p.z! <= 1);
    if (r.winner !== null) assert.equal(Math.abs(p.z!), 1);
  }
  const dir = mkdtempSync(join(tmpdir(), 'rfs-'));
  try {
    const w = new ShardWriter(dir, 3, 1); w.addGame(pos);
    const files = readdirSync(dir).filter(f => f.endsWith('.rfs'));
    assert.equal(files.length, 1, 'shard published (renamed from .tmp)');
    const buf = readFileSync(join(dir, files[0]));
    assert.equal(buf.readUInt32LE(0), SHARD_MAGIC);
    let off = 16, n = 0;
    while (off < buf.length) {
      const rec = buf.readUInt32LE(off), ob = buf.readUInt32LE(off + 4);
      const frame = new Uint8Array(buf.buffer.slice(buf.byteOffset + off + 8, buf.byteOffset + off + 8 + ob));
      const o = unpackObs(frame);
      const nA = buf.readUInt32LE(off + 8 + ob + 8);
      assert.equal(nA, o.nA); assert.equal(nA, pos[n].acts.n);
      off += 4 + rec; n++;
    }
    assert.equal(n, pos.length);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('engine bots play through the factored env (eval path)', async () => {
  const env = new FactoredEnv(); const rng = makeRng(8);
  const nn = new SearchAgent('nn', env, new UniformEvaluator(), fast, DEFAULT_CAPS, { record: false, noise: false, rng });
  const bot = new EngineBotAgent('bot', (g, p) => chooseAction(g, p));
  const r = await playGame({ env, agents: [nn, bot], decks, seed: 12, firstPlayer: 1, caps: { ...DEFAULT_CAPS, maxTurns: 25 } });
  assert.notEqual(r.status, 'error', r.error);
});

test('game loop masks a rolled-back option and drops its recorded position', async () => {
  // the search itself already avoids options that roll back inside its simulations, so drive the loop with an agent
  // that always takes the last option (the first is usually endTurn) and "records" every pick
  const seen = new Set<string>();
  class Env extends EngineEnv {
    step(s: GameState, i: number, ch: Choices): GameState {
      const k = ch.keys[i];
      if (s.pending?.kind === 'mainAction' && !seen.has(k) && !k.includes('"endTurn"') && !k.includes('"pass"')) { seen.add(k); throw new RollbackError(k); }
      return super.step(s, i, ch);
    }
  }
  let recorded = 0, dropped = 0;
  const first = { name: 'last', choose: async (_e: unknown, _s: unknown, _a: unknown, ch: Choices) => { recorded++; return ch.n - 1; }, rolledBack: () => { dropped++; recorded--; } };
  const r = await playGame({ env: new Env(), agents: [first, first], decks, seed: 5, firstPlayer: 0, caps: { ...DEFAULT_CAPS, maxTurns: 10 } });
  assert.notEqual(r.status, 'error', r.error);
  assert.ok((r.rollbacks ?? 0) > 0, 'some picks rolled back');
  assert.equal(dropped, r.rollbacks, 'every rolled-back pick was reported to the agent');
  assert.equal(recorded, r.decisions - (r.rollbacks ?? 0));
});

test('factored env: determinisation replays a partial sub-choice', () => {
  const env = new FactoredEnv({ maxFlatMoveUnits: 1 }); const rng = makeRng(5);   // factor every multi-unit move
  let found = 0;
  for (const g0 of samplePositions(11, 60, 5)) {
    let s = env.root(g0);
    const actor = env.actor(s)!;
    let ch = env.choices(s, actor);
    // walk into a multi-step decision if this one has a non-final option
    const k = ch.n > 1 ? ch.keys.findIndex(key => !key.startsWith('{')) : -1;
    if (k < 0) continue;
    try { s = env.step(s, k, ch); } catch { continue; }
    if (!s.path.length) continue;
    const d = env.determinize(s, actor, rng);
    assert.deepEqual(d.path, s.path);
    assert.deepEqual(env.choices(d, actor).keys.length > 0, true);
    found++;
  }
  assert.ok(found > 0, 'found multi-step factored decisions to replay');
});

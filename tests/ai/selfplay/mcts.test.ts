import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EngineEnv, RollbackError, type Choices, type SearchEnv } from '../../../src/ai/selfplay/env.ts';
import { FactoredEnv } from '../../../src/ai/selfplay/factored-env.ts';
import { UniformEvaluator, type EvalRequest } from '../../../src/ai/selfplay/evaluator.ts';
import { InferenceError } from '../../../src/ai/selfplay/client.ts';
import { Mcts } from '../../../src/ai/selfplay/mcts.ts';
import { DEFAULT_CAPS, DEFAULT_SEARCH, maxTurnsAt, timeoutValues } from '../../../src/ai/selfplay/config.ts';
import { makeRng } from '../../../src/engine/rng.ts';
import type { GameState } from '../../../src/engine/types.ts';
import { samplePositions } from './_util.ts';

const positions = samplePositions(5, 6);

for (const algorithm of ['gumbel', 'puct'] as const) {
  for (const kind of ['engine', 'factored'] as const) {
    test(`${algorithm}/${kind}: search returns a valid choice and a normalised policy`, async () => {
      const env: SearchEnv<any> = kind === 'engine' ? new EngineEnv() : new FactoredEnv();
      const mcts = new Mcts(env, new UniformEvaluator(0, 0.3), { ...DEFAULT_SEARCH, algorithm }, DEFAULT_CAPS);
      assert.ok(positions.length >= 4, 'enough sample positions');
      for (const g of positions) {
        const s = env.root(g); const actor = env.actor(s)!;
        const ch = env.choices(s, actor);
        if (ch.n < 2) continue;
        const r = await mcts.search(s, actor, ch, { sims: 16, noise: true, rng: makeRng(3), moveNumber: 0 });
        assert.ok(r.choice >= 0 && r.choice < ch.n);
        assert.equal(r.policy.length, ch.n);
        const sum = r.policy.reduce((a, b) => a + b, 0);
        assert.ok(Math.abs(sum - 1) < 1e-4, `policy sums to ${sum}`);
        assert.ok(r.policy.every(p => p >= 0 && Number.isFinite(p)));
        assert.ok(r.sims > 0 && r.sims <= 16, `sims ${r.sims}`);
        const visits = r.visits.reduce((a, b) => a + b, 0);
        assert.ok(visits <= r.sims);
        assert.ok(r.value >= -1 && r.value <= 1);
        assert.equal(r.acts.n, ch.n);
      }
    });
  }
}

test('search is deterministic for a seed', async () => {
  const env = new FactoredEnv();
  const g = positions[2];
  const run = async () => {
    const mcts = new Mcts(env, new UniformEvaluator(0, 0.3), DEFAULT_SEARCH, DEFAULT_CAPS);
    const s = env.root(g); const a = env.actor(s)!;
    return mcts.search(s, a, env.choices(s, a), { sims: 12, noise: true, rng: makeRng(9) });
  };
  const [a, b] = [await run(), await run()];
  assert.equal(a.choice, b.choice);
  assert.deepEqual(Array.from(a.visits), Array.from(b.visits));
});

/** An env whose option with key `bad` always rolls back. */
class RollbackEnv extends EngineEnv {
  constructor(private bad: (ch: Choices) => string | undefined) { super(); }
  step(s: GameState, i: number, ch: Choices): GameState {
    if (ch.keys[i] === this.bad(ch)) throw new RollbackError(ch.keys[i]);
    return super.step(s, i, ch);
  }
}

test('a rolled-back root option is masked: never chosen, no policy mass', async () => {
  const g = positions[0];
  let badKey: string | undefined;
  const env = new RollbackEnv(ch => badKey && ch.keys.includes(badKey) ? badKey : undefined);
  const s = env.root(g); const actor = env.actor(s)!; const ch = env.choices(s, actor);
  // make the bad option the one the uniform prior + jitter would like most: just ban every option but the last
  for (let k = 0; k < ch.n - 1; k++) {
    badKey = ch.keys[k];
    const mcts = new Mcts(env, new UniformEvaluator(0, 0), DEFAULT_SEARCH, DEFAULT_CAPS);
    const r = await mcts.search(s, actor, ch, { sims: 24, noise: false, rng: makeRng(1) });
    assert.notEqual(ch.keys[r.choice], badKey, 'rolled-back option chosen');
    assert.equal(r.policy[k], 0, 'rolled-back option kept policy mass');
  }
});

test('caps: maxTurns annealing and timeout values', () => {
  const caps = { ...DEFAULT_CAPS, maxTurns: 60, maxTurnsAnneal: { to: 40, startStep: 100, endStep: 200 } };
  assert.equal(maxTurnsAt(caps, 0), 60); assert.equal(maxTurnsAt(caps, 150), 50); assert.equal(maxTurnsAt(caps, 999), 40);
  const v = timeoutValues([6, 2], 8, 0.2);
  assert.ok(Math.abs(v[0] - 0.1) < 1e-9 && Math.abs(v[1] + 0.1) < 1e-9);
  assert.deepEqual(timeoutValues([3, 3], 8, 0.2).slice(0, 2), [0, 0]);
});

test('an inference error inside a simulation propagates (not swallowed as a dropped simulation)', async () => {
  class Failing extends UniformEvaluator {
    async evaluate(req: EvalRequest) { if (this.count >= 3) throw new InferenceError('boom'); return super.evaluate(req); }
  }
  const env = new EngineEnv();
  const g = positions[1]; const s = env.root(g); const actor = env.actor(s)!;
  const mcts = new Mcts(env, new Failing(), DEFAULT_SEARCH, DEFAULT_CAPS);
  await assert.rejects(mcts.search(s, actor, env.choices(s, actor), { sims: 32, noise: false, rng: makeRng(1) }), InferenceError);
});

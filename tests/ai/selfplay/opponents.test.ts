// Fixed opponents in self-play (src/ai/selfplay/opponents.ts, config selfplay.opponents).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { FactoredEnv } from '../../../src/ai/selfplay/factored-env.ts';
import { UniformEvaluator } from '../../../src/ai/selfplay/evaluator.ts';
import { assignOutcome, playGame, SearchAgent } from '../../../src/ai/selfplay/game.ts';
import { DEFAULT_CAPS, DEFAULT_SEARCH, opponentWeights } from '../../../src/ai/selfplay/config.ts';
import { loadDeckFile, type NamedDeck } from '../../../src/ai/selfplay/decks.ts';
import { encodeRecord, type Position } from '../../../src/ai/selfplay/shards.ts';
import { drawOpponent, netResult, opponentMix, playTrainingGame, type OpponentKind } from '../../../src/ai/selfplay/opponents.ts';
import { makeRng } from '../../../src/engine/rng.ts';
import type { PlayerId } from '../../../src/engine/types.ts';

const D = join(import.meta.dirname, '../../../data/meta-decks/');
const decks: [NamedDeck, NamedDeck] = [loadDeckFile(D + '01-azir.json'), loadDeckFile(D + '02-vex.json')];
const fast = { ...DEFAULT_SEARCH, fullSims: 4, fastSims: 2, fullProb: 0.5, maxConsidered: 4 };
const caps = { ...DEFAULT_CAPS, maxTurns: 30 };
const MIX = { weights: { self: 0.85, best: 0.05, bot: 0.05, searchai: 0.05 } };

const hashPositions = (ps: Position[]) => { const h = createHash('sha256'); for (const p of ps) h.update(encodeRecord(p)); return h.digest('hex'); };

async function game(kind: OpponentKind, netSeat: PlayerId | null, rngSeed: number, seed: number, firstPlayer: PlayerId = 0) {
  return playTrainingGame({ env: new FactoredEnv(), ev: new UniformEvaluator(), search: fast, caps, rng: makeRng(rngSeed), decks, seed, firstPlayer,
    kind, netSeat, pointsShaping: 0, searchAiOptions: { turnNodes: 40, replanNodes: 20, turnBudget: 100 } });
}

test('weights: defaults are pure self-play; a missing self takes the rest; bad weights throw (same rules as config.py)', () => {
  assert.deepEqual(opponentWeights(undefined), { self: 1, best: 0, bot: 0, searchai: 0 });
  assert.deepEqual(opponentWeights({ weights: {} }), { self: 1, best: 0, bot: 0, searchai: 0 });
  const w = opponentWeights({ weights: { bot: 0.1 } });
  assert.ok(Math.abs(w.self - 0.9) < 1e-12 && Math.abs(w.bot - 0.1) < 1e-12);
  assert.deepEqual(opponentWeights({ weights: { self: 2, bot: 2 } }), { self: 0.5, best: 0, bot: 0.5, searchai: 0 });
  for (const bad of [{ searchAI: 0.1 }, { bot: -1 }, { bot: 0.7, best: 0.6 }, { self: 0 }, { bot: Number.NaN }])
    assert.throws(() => opponentWeights({ weights: bad as never }));
});

test('weights {self: 1} change nothing: no random number drawn, and the game is the one the old code played', async () => {
  for (const c of [undefined, null, {}, { weights: null }, { weights: { self: 1 } }, { weights: { self: 1, bot: 0 } }]) {
    const m = opponentMix(c as never);
    assert.deepEqual(m.kinds, ['self']);
    const a = makeRng(3), b = makeRng(3);
    for (let i = 0; i < 20; i++) assert.deepEqual(drawOpponent(m, a), { kind: 'self', netSeat: null });
    assert.equal(a(), b(), 'the rng stream is untouched');
  }
  // the old worker path: one recording SearchAgent on both seats, playGame, assignOutcome
  for (const seed of [21, 22]) {
    const rng = makeRng(seed * 7), env = new FactoredEnv();
    const agent = new SearchAgent('nn', env, new UniformEvaluator(), fast, caps, { record: true, noise: true, rng });
    const r0 = await playGame({ env, agents: [agent, agent], decks, seed, firstPlayer: 1, caps });
    const old = assignOutcome(agent.positions, r0, 0, caps.timeoutShaping);
    const g = await game('self', null, seed * 7, seed, 1);
    assert.equal(g.netSeat, null);
    const { ms: _a, ...a } = r0, { ms: _b, ...b } = g.r;
    assert.deepEqual(b, a);
    assert.equal(g.positions.length, old.length);
    assert.equal(hashPositions(g.positions), hashPositions(old));
    assert.equal(g.sims, agent.sims);
  }
});

test('opponent choice is deterministic per seed and follows the weights', () => {
  const m = opponentMix(MIX);
  const seq = (s: number) => { const r = makeRng(s); return Array.from({ length: 300 }, () => drawOpponent(m, r)); };
  assert.deepEqual(seq(11), seq(11));
  assert.notDeepEqual(seq(11), seq(12));
  const n = 20000, r = makeRng(5), count: Record<string, number> = {}, seats = [0, 0];
  for (let i = 0; i < n; i++) {
    const d = drawOpponent(m, r);
    count[d.kind] = (count[d.kind] ?? 0) + 1;
    if (d.kind === 'self') assert.equal(d.netSeat, null); else seats[d.netSeat!]++;
  }
  for (const [k, w] of Object.entries(MIX.weights)) assert.ok(Math.abs(count[k] / n - w) < 0.01, `${k}: ${count[k] / n} vs ${w}`);
  assert.ok(Math.abs(seats[0] / (seats[0] + seats[1]) - 0.5) < 0.05, 'the net sits in either seat');
  // a single non-self kind: still no kind draw, only the seat
  const only = opponentMix({ weights: { bot: 1, self: 0 } }), a = makeRng(9), b = makeRng(9);
  const d = drawOpponent(only, a);
  assert.equal(d.kind, 'bot'); assert.equal(d.netSeat, b() < 0.5 ? 0 : 1); assert.equal(a(), b());
});

test('a game vs a fixed opponent records only the net\'s positions, z from the net\'s side; same seed = same game', async () => {
  const seen = new Set<string>();
  for (const [kind, netSeat, seed] of [['bot', 1, 31], ['bot', 0, 32], ['searchai', 0, 33], ['best', 1, 34]] as [OpponentKind, PlayerId, number][]) {
    const g = await game(kind, netSeat, seed, seed, (seed % 2) as PlayerId);
    assert.notEqual(g.r.status, 'error', g.r.error ?? '');
    assert.equal(g.kind, kind); assert.equal(g.netSeat, netSeat);
    assert.ok(g.positions.length > 0, 'the net recorded positions');
    const res = netResult(g.r, netSeat);
    seen.add(res);
    const diff = Math.max(-1, Math.min(1, (g.r.points[netSeat] - g.r.points[1 - netSeat]) / g.r.victoryScore));
    for (const p of g.positions) {
      assert.equal(p.actor, netSeat, 'only the net\'s decisions are recorded');
      if (res === 'win') assert.equal(p.z, 1);
      else if (res === 'loss') assert.equal(p.z, -1);
      else assert.ok(Math.abs(p.z! - caps.timeoutShaping * diff) < 1e-6, 'timeout: shaped point difference from the net\'s side');
    }
    // a fixed opponent's decisions are played but not recorded: fewer positions than decisions in the game
    assert.ok(g.positions.length < g.r.decisions);
    if (kind === 'bot' || kind === 'searchai') assert.ok(g.sims > 0);
    const again = await game(kind, netSeat, seed, seed, (seed % 2) as PlayerId);
    assert.equal(again.r.turns, g.r.turns); assert.equal(again.r.winner, g.r.winner); assert.equal(again.r.actions, g.r.actions);
    assert.equal(hashPositions(again.positions), hashPositions(g.positions));
  }
  assert.ok(seen.has('win') || seen.has('loss'), `some game was decided (results: ${[...seen].join(', ')})`);
});

test('netResult reads the result from the net\'s seat', () => {
  const base = { turns: 9, actions: 9, decisions: 9, points: [3, 8], victoryScore: 8, decks: ['a', 'b'] as [string, string], ms: 1 };
  assert.equal(netResult({ ...base, winner: 1, status: 'ok' }, 1), 'win');
  assert.equal(netResult({ ...base, winner: 1, status: 'ok' }, 0), 'loss');
  assert.equal(netResult({ ...base, winner: null, status: 'timeout' }, 0), 'timeout');
  assert.equal(netResult({ ...base, winner: null, status: 'ok' }, 0), 'draw');
  assert.equal(netResult({ ...base, winner: null, status: 'error' }, 0), 'error');
});

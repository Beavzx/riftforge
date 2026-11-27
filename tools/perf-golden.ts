// PERF: golden traces + benchmark for engine speed work. Any optimisation must leave every hash unchanged.
//
//   node --import tsx tools/perf-golden.ts selfplay <from> <to>   # self-play games (factored env + Gumbel search,
//                                                                 # uniform evaluator): hash of every recorded position
//   node --import tsx tools/perf-golden.ts engine <from> <to>     # fuzz games (random decks from the whole pool,
//                                                                 # random/chaos/bot policies): hash of state, events,
//                                                                 # legal actions and both players' views after EVERY action
// Output: one JSON line per game {mode, i, hash, ms, ...}. tools/perf-golden.sh runs ranges in parallel and diffs.
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createGame, applyAction, getLegalActions, getView } from '../src/engine/index.ts';
import type { GameState } from '../src/engine/types.ts';
import { makeRng } from '../src/engine/rng.ts';
import { FactoredEnv } from '../src/ai/selfplay/factored-env.ts';
import { SearchAgent, playGame, assignOutcome } from '../src/ai/selfplay/game.ts';
import { UniformEvaluator } from '../src/ai/selfplay/evaluator.ts';
import { DEFAULT_SEARCH, DEFAULT_CAPS } from '../src/ai/selfplay/config.ts';
import { encodeRecord } from '../src/ai/selfplay/shards.ts';
import { loadDeckFile, type NamedDeck } from '../src/ai/selfplay/decks.ts';
import { ROOT, makeSpec, setupOf, playFuzzGame, NO_CHECKS } from './fuzz-lib.ts';

/** JSON with sorted object keys (insertion order is not semantics). Top-level card db is skipped (immutable input). */
function canon(x: unknown, top = false): string {
  if (x === null || typeof x !== 'object') return JSON.stringify(x) ?? 'null';
  if (Array.isArray(x)) return '[' + x.map(v => (v === undefined || typeof v === 'function' ? 'null' : canon(v))).join(',') + ']';
  const o = x as Record<string, unknown>;
  const keys = Object.keys(o).filter(k => o[k] !== undefined && typeof o[k] !== 'function' && !(top && k === 'cards')).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canon(o[k])).join(',') + '}';
}
const stateKey = (g: GameState) => canon(g, true);
const OFF = Number(process.env.GOLDEN_OFFSET ?? 0);   // seed offset for extra golden sets

function decks(): NamedDeck[] {
  const home = readdirSync(join(ROOT, 'decks')).filter(f => f.endsWith('.json')).sort().map(f => loadDeckFile(join(ROOT, 'decks', f)));
  const meta = readdirSync(join(ROOT, 'data/meta-decks')).filter(f => /^\d+-.*\.json$/.test(f)).sort().map(f => loadDeckFile(join(ROOT, 'data/meta-decks', f)));
  return [...home, ...meta];
}

async function selfplayGame(i: number) {
  const all = decks();
  const env = new FactoredEnv();
  const rng = makeRng(9000 + OFF + i);
  const search = { ...DEFAULT_SEARCH, fullSims: 16, fastSims: 8, fullProb: 0.5, maxConsidered: 8 };
  const agent = new SearchAgent('nn', env, new UniformEvaluator(0, 0.3), search, DEFAULT_CAPS, { record: true, noise: true, rng });
  const d: [NamedDeck, NamedDeck] = [all[i % all.length], all[(i * 7 + 3) % all.length]];
  const t0 = performance.now();
  const r = await playGame({ env, agents: [agent, agent], decks: d, seed: 1000 + OFF + i, firstPlayer: (i % 2) as 0 | 1, caps: DEFAULT_CAPS });
  const ms = performance.now() - t0;
  const h = createHash('sha256');
  const { ms: _ms, error, ...res } = r;
  h.update(canon({ ...res, error: error?.split('\n')[0] }));
  const pos = assignOutcome(agent.positions, r, 0, 0.2);
  for (const p of pos) h.update(encodeRecord(p));
  return { mode: 'selfplay', i, hash: h.digest('hex').slice(0, 20), ms: Math.round(ms), status: r.status, decisions: r.decisions, positions: pos.length, sims: agent.sims, err: error?.split('\n')[0] };
}

function engineGame(i: number) {
  const spec = makeSpec(50000 + OFF + i);
  const t0 = performance.now();
  const fr = playFuzzGame(spec, NO_CHECKS);
  const playMs = performance.now() - t0;
  const h = createHash('sha256');
  h.update(canon({ winner: fr.winner, turns: fr.turns, steps: fr.steps, failure: fr.failure ? { kind: fr.failure.kind, msg: fr.failure.message?.split('\n')[0] } : null, actions: fr.actions }));
  let g: GameState = createGame(setupOf(spec));
  const seen = (s: GameState) => {
    h.update(stateKey(s));
    for (const v of [0, 1] as const) h.update(canon(getView(s, v)));
    if (s.pending) h.update(canon(getLegalActions(s, s.pending.player)));
  };
  seen(g);
  let applied = 0;
  for (const a of fr.actions) {
    let r;
    try { r = applyAction(g, a); } catch (e) { h.update('throw:' + (e as Error).message.split('\n')[0]); break; }
    h.update(canon(r.events));
    g = r.state; applied++;
    seen(g);
  }
  return { mode: 'engine', i, hash: h.digest('hex').slice(0, 20), ms: Math.round(playMs), actions: fr.actions.length, applied, failure: fr.failure?.kind ?? null };
}

const [mode, from, to] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? 1)];
for (let i = from; i < to; i++) {
  const out = mode === 'selfplay' ? await selfplayGame(i) : mode === 'engine' ? engineGame(i) : (() => { throw new Error(`mode ${mode}?`); })();
  process.stdout.write(JSON.stringify(out) + '\n');
}

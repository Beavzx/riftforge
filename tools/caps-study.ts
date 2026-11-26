// FUZZ agent: game-length distribution vs the sim caps (maxTurns 40, maxActions 4000, maxMainPerTurn 80) to choose
// RL self-play caps. Not part of the test suite.
//   node --import tsx tools/caps-study.ts ai 40      SearchAI vs SearchAI (low budget) via sim-lib.playGame, caps lifted
//   node --import tsx tools/caps-study.ts random 100 uniform-random legal actions, caps lifted
import { createGame, applyAction, getLegalActions } from '../src/engine/index.ts';
import { makeRng } from '../src/engine/rng.ts';
import type { GameState } from '../src/engine/types.ts';
import { cardDb, loadMetaDecks, playGame } from './sim-lib.ts';

const mode = process.argv[2] ?? 'random';
const N = Number(process.argv[3] ?? 20);
const decks = loadMetaDecks();
const rows: { turns: number; actions: number; maxMain: number; winner: number | null; status: string; ms: number }[] = [];

function randomGame(seed: number, a: number, b: number) {
  const rng = makeRng(seed * 31 + 7);
  let g: GameState = createGame({ seed, cardDb: cardDb(), battlefieldSelection: 'random', firstPlayer: 0, enforceBanlist: false,
    players: [{ name: 'A', deck: decks[a].deck }, { name: 'B', deck: decks[b].deck }] });
  let actions = 0, main = 0, maxMain = 0, turn = g.turn;
  const t0 = performance.now();
  while (g.winner === null && g.turn <= 200 && actions < 20000) {
    if (g.turn !== turn) { turn = g.turn; main = 0; }
    const d = g.pending!;
    const legal = getLegalActions(g, d.player).filter(x => x.type !== 'concede');
    if (!legal.length) break;
    if (!d.inStep && d.kind === 'mainAction') maxMain = Math.max(maxMain, ++main);
    g = applyAction(g, legal[Math.floor(rng() * legal.length)]).state;
    actions++;
  }
  return { turns: g.turn, actions, maxMain, winner: g.winner, status: g.winner === null ? 'unfinished' : 'ok', ms: performance.now() - t0 };
}

for (let i = 0; i < N; i++) {
  const a = i % decks.length, b = (i * 7 + 3) % decks.length;
  if (mode === 'ai') {
    const lite = { kind: 'ai' as const, opts: { maxNodes: 120, turnNodes: 600, replanNodes: 200, turnBudget: 1500 } };
    const o = playGame({ seed: 5000 + i, decks: [decks[a].deck, decks[b].deck], policies: [lite, lite], maxTurns: 200, maxActions: 20000, maxMainPerTurn: 1000, checkEvery: 0 });
    rows.push({ turns: o.turns, actions: o.actions, maxMain: -1, winner: o.winner, status: o.status, ms: o.ms });
  } else rows.push(randomGame(9000 + i, a, b));
  process.stderr.write(`${i + 1}/${N} turns=${rows[i].turns} actions=${rows[i].actions} ${rows[i].status}\n`);
}
const q = (xs: number[], p: number) => { const s = [...xs].sort((u, v) => u - v); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const T = rows.map(r => r.turns), A = rows.map(r => r.actions), M = rows.map(r => r.maxMain).filter(x => x >= 0);
console.log(JSON.stringify({
  mode, games: N, finished: rows.filter(r => r.winner !== null).length, voidOrUnfinished: rows.filter(r => r.winner === null).map(r => r.status),
  turns: { p50: q(T, 0.5), p90: q(T, 0.9), p99: q(T, 0.99), max: Math.max(...T) },
  actions: { p50: q(A, 0.5), p90: q(A, 0.9), p99: q(A, 0.99), max: Math.max(...A) },
  maxMainPerTurn: M.length ? { p50: q(M, 0.5), p90: q(M, 0.9), max: Math.max(...M) } : 'n/a (sim-lib)',
  wouldHit: { turns40: T.filter(t => t > 40).length, actions4000: A.filter(x => x >= 4000).length, main80: M.filter(x => x > 80).length },
  avgMsPerGame: Math.round(rows.reduce((s, r) => s + r.ms, 0) / N),
}, null, 1));

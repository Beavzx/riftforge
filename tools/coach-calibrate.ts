// COACH: calibrate the hand-tuned evaluation (src/ai/eval.ts) to a win probability.
// Plays SearchAI vs SearchAI over the meta decks (seats swapped), records evaluate(g, decider) at the deciders' quiet
// decisions (main phase and chain/showdown windows) together with the final result, fits p(win) = sigmoid(a + b*eval)
// on 70% of the games, reports held-out quality, then refits on all games and writes data/coach-calibration.json.
//
//   node --import tsx tools/coach-calibrate.ts [--games 100] [--seed 1] [--out data/coach-calibration.json] [--dump rows.json]
//   node --import tsx tools/coach-calibrate.ts --from rows.json          # refit from saved rows
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createGame, applyAction, getLegalActions } from '../src/engine/index.ts';
import type { GameState, PlayerId } from '../src/engine/types.ts';
import { SearchAI, evaluate } from '../src/ai/index.ts';
import { planFor } from '../src/ai/plans/index.ts';
import { cardDb, loadMetaDecks, ROOT } from './sim-lib.ts';

const args = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };

export interface Row { game: number; turn: number; eval: number; won: number; /** decider is the turn player */ mine: number }

function playAndRecord(seed: number, gameIdx: number, dA: number, dB: number): Row[] | null {
  const decks = loadMetaDecks();
  let g: GameState = createGame({ seed, cardDb: cardDb(), battlefieldSelection: 'random', firstPlayer: 0, enforceBanlist: false,
    players: [{ name: 'A', deck: decks[dA].deck }, { name: 'B', deck: decks[dB].deck }] });
  const ais = [new SearchAI({ seed: seed * 2 + 1 }), new SearchAI({ seed: seed * 2 + 2 })];
  const rows: { turn: number; eval: number; p: PlayerId; mine: number }[] = [];
  let lastKey = '';
  for (let i = 0; i < 4000 && g.winner === null && g.turn <= 40; i++) {
    const d = g.pending;
    if (!d) return null;
    const p = d.player;
    if (!d.inStep && (d.kind === 'mainAction' || d.kind === 'chainResponse' || d.kind === 'showdownAction')) {
      // one row per (turn, player, decision kind): consecutive decisions in a turn are strongly correlated
      const key = `${g.turn}|${p}|${d.kind}`;
      if (key !== lastKey) { lastKey = key; rows.push({ turn: g.turn, eval: evaluate(g, p, undefined, { plan: planFor(g, p) }), p, mine: g.activePlayer === p ? 1 : 0 }); }
    }
    let a = null;
    try { a = ais[p].choose(g, p); } catch { a = null; }
    if (!a) { const legal = getLegalActions(g, p); a = legal.find(x => x.type === 'pass' || x.type === 'endTurn') ?? legal[0]; }
    if (!a) return null;
    try { g = applyAction(g, a).state; } catch { return null; }
  }
  if (g.winner === null) return null;   // draws / caps are excluded
  return rows.map(r => ({ game: gameIdx, turn: r.turn, eval: r.eval, won: r.p === g.winner ? 1 : 0, mine: r.mine }));
}

// ---------------------------------------------------------------- logistic regression (Newton / IRLS, 1 feature)
const sig = (z: number) => 1 / (1 + Math.exp(-z));
// feature: log-compressed evaluation (src/ai/coach/winprob.ts feature()); wins/losses (±1e5) only appear at the very end
export const SCALE = 20;
let LINEAR = false;
const clipEval = (e: number) => LINEAR ? Math.max(-200, Math.min(200, e)) : Math.sign(e) * Math.log1p(Math.abs(Math.max(-500, Math.min(500, e))) / SCALE);

export function fitLogistic(rows: Row[], l2 = 1e-3): { a: number; b: number } {
  let a = 0, b = 0.05;
  for (let it = 0; it < 50; it++) {
    let ga = 0, gb = 0, haa = l2, hab = 0, hbb = l2;
    for (const r of rows) {
      const x = clipEval(r.eval), p = sig(a + b * x), wgt = p * (1 - p);
      ga += p - r.won; gb += (p - r.won) * x;
      haa += wgt; hab += wgt * x; hbb += wgt * x * x;
    }
    gb += l2 * b; ga += l2 * a;
    const det = haa * hbb - hab * hab;
    if (!det) break;
    const da = (hbb * ga - hab * gb) / det, db = (haa * gb - hab * ga) / det;
    a -= da; b -= db;
    if (Math.abs(da) + Math.abs(db) < 1e-9) break;
  }
  return { a, b };
}

function auc(ps: number[], ys: number[]): number {
  const idx = ps.map((p, i) => i).sort((i, j) => ps[i] - ps[j]);
  let rank = 0, pos = 0, sumPos = 0;
  for (let k = 0; k < idx.length; k++) { rank = k + 1; if (ys[idx[k]]) { pos++; sumPos += rank; } }
  const neg = ys.length - pos;
  return pos && neg ? (sumPos - pos * (pos + 1) / 2) / (pos * neg) : 0.5;
}

export function metrics(rows: Row[], c: { a: number; b: number }) {
  const ps = rows.map(r => sig(c.a + c.b * clipEval(r.eval)));
  const ys = rows.map(r => r.won);
  const eps = 1e-6;
  const ll = -ps.reduce((s, p, i) => s + (ys[i] ? Math.log(Math.max(eps, p)) : Math.log(Math.max(eps, 1 - p))), 0) / rows.length;
  const base = ys.reduce((s, y) => s + y, 0) / ys.length;
  const bll = -ys.reduce((s, y) => s + (y ? Math.log(base) : Math.log(1 - base)), 0) / ys.length;
  const brier = ps.reduce((s, p, i) => s + (p - ys[i]) ** 2, 0) / rows.length;
  const acc = ps.reduce((s, p, i) => s + ((p >= 0.5 ? 1 : 0) === ys[i] ? 1 : 0), 0) / rows.length;
  const edges = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0001];
  const bins = edges.slice(0, -1).map((lo, k) => {
    const hi = edges[k + 1];
    const sel = ps.map((p, i) => [p, ys[i]]).filter(([p]) => p >= lo && p < hi);
    return { lo, hi: Math.min(1, hi), n: sel.length, predicted: sel.length ? sel.reduce((s, [p]) => s + p, 0) / sel.length : 0, observed: sel.length ? sel.reduce((s, [, y]) => s + y, 0) / sel.length : 0 };
  }).filter(b => b.n > 0);
  return { n: rows.length, logLoss: ll, baselineLogLoss: bll, brier, accuracy: acc, auc: auc(ps, ys), bins };
}

function main() {
  let rows: Row[] = [];
  const from = arg('from');
  if (from) rows = JSON.parse(readFileSync(from, 'utf8'));
  else {
    const games = Number(arg('games', '100')), seed0 = Number(arg('seed', '1'));
    const nDecks = loadMetaDecks().length;
    let done = 0, skipped = 0;
    const t0 = performance.now();
    for (let i = 0; i < games; i++) {
      const s = seed0 * 100000 + i;
      const dA = (i * 7) % nDecks, dB = (i * 11 + 3) % nDecks;
      const r = i % 2 ? playAndRecord(s, i, dB, dA) : playAndRecord(s, i, dA, dB);
      if (r) { rows.push(...r); done++; } else skipped++;
      if ((i + 1) % 10 === 0) console.error(`[calibrate] ${i + 1}/${games} games, ${rows.length} rows, ${skipped} skipped, ${((performance.now() - t0) / 1000).toFixed(0)}s`);
    }
    const dump = arg('dump');
    if (dump) writeFileSync(dump, JSON.stringify(rows));
    console.error(`[calibrate] ${done} decided games, ${skipped} draws/errors`);
  }
  const gameIds = [...new Set(rows.map(r => r.game))].sort((x, y) => x - y);
  const testSet = new Set(gameIds.filter((_, i) => i % 10 >= 7));   // 30% of games held out
  const train = rows.filter(r => !testSet.has(r.game)), test = rows.filter(r => testSet.has(r.game));
  // reference: a plain linear logistic on the clipped evaluation
  LINEAR = true;
  const linHeld = metrics(test, fitLogistic(train));
  LINEAR = false;
  const cTrain = fitLogistic(train);
  const held = metrics(test, cTrain);
  const cAll = fitLogistic(rows);
  const out = {
    a: cAll.a, b: cAll.b, transform: 'log1p', scale: SCALE,
    linearReference: { heldOutLogLoss: linHeld.logLoss, heldOutBrier: linHeld.brier },
    games: gameIds.length, rows: rows.length,
    heldOut: { games: testSet.size, fitOnTrain: cTrain, ...held },
    policy: 'SearchAI (default options) vs SearchAI, meta decks, seats alternated; one row per (turn, player, decision kind)',
    date: new Date().toISOString().slice(0, 10),
    note: 'p(win) = 1/(1+exp(-(a + b*f(eval)))), f(x) = sign(x)*ln(1+|x|/scale), eval = src/ai/eval.ts evaluate() from the deciding player. A coarse calibration of a heuristic, not a learned value.',
  };
  const outPath = arg('out', join(ROOT, 'data/coach-calibration.json'))!;
  writeFileSync(outPath, JSON.stringify(out, null, 1) + '\n');
  console.log(JSON.stringify({ a: out.a, b: out.b, games: out.games, rows: out.rows, heldOut: { ...held, bins: undefined } }, null, 1));
  console.log('held-out calibration bins (predicted -> observed, n):');
  for (const b of held.bins) console.log(`  ${b.lo.toFixed(1)}-${b.hi.toFixed(1)}: ${b.predicted.toFixed(2)} -> ${b.observed.toFixed(2)}  (n=${b.n})`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('coach-calibrate.ts')) main();

// AI-CORE: SPSA self-play tuning of the evaluation weights (src/ai/eval.ts EvalWeights).
// One invocation = one SPSA iteration (fits an 8-minute chunk): perturb all tuned weights by ±c·scale, play
// new-AI(w+) vs new-AI(w-) on --games random meta pairs (both seats, training seeds), estimate the gradient from the
// score difference, update and save the state. Validate on held-out seeds with tools/ai-bench.ts --w ... --vs legacy.
//   sh tools/meta-sim-snapshot.sh tools/ai-tune.ts --state data/ai-tune/state.json --games 40 [--reset]
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadMetaDecks, runParallel, type GameRun } from './sim-lib.ts';
import { makeRng } from '../src/engine/rng.ts';
import { DEFAULT_WEIGHTS, type EvalWeights } from '../src/ai/eval.ts';

const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : (process.argv[i + 1]?.startsWith('--') || process.argv[i + 1] === undefined ? 'true' : process.argv[i + 1]); };
const file = arg('state', 'data/ai-tune/state.json')!;
const games = +(arg('games', '40')!), workers = +(arg('workers', '2')!);
const OUT = process.env.META_OUT ? `${process.env.META_OUT}/${file}` : file;

// tuned weights and their scales (perturbation c·scale, step a·scale)
const TUNE: Partial<Record<keyof EvalWeights, number>> = {
  might: 0.4, unitBase: 0.4, cost: 0.3, card: 0.4, cardCost: 0.08, rune: 0.5, runeNow: 0.2, hidden: 0.5, reactReady: 0.5,
  projOpp: 0.25, projMine: 0.25, projWin: 20, defend: 0.2, mightBf: 0.3, ctl: 0.5, urgency: 1,
};

interface State { iter: number; w: Partial<EvalWeights>; history: { iter: number; plus: number; games: number; delta: Record<string, number> }[] }
let st: State = existsSync(OUT) && arg('reset') !== 'true' ? JSON.parse(readFileSync(OUT, 'utf8')) : { iter: 0, w: {}, history: [] };
const cur = (k: keyof EvalWeights) => st.w[k] ?? DEFAULT_WEIGHTS[k];

const k = st.iter + 1;
const c = 0.5 / Math.pow(k, 0.101), a = 1.0 / Math.pow(k + 5, 0.602);
const r = makeRng(1000 + k);
const delta: Record<string, number> = {};
const wPlus: Partial<EvalWeights> = {}, wMinus: Partial<EvalWeights> = {};
for (const [name, scale] of Object.entries(TUNE) as [keyof EvalWeights, number][]) {
  const d = r() < 0.5 ? -1 : 1;
  delta[name] = d;
  wPlus[name] = Math.max(0, cur(name) + c * scale * d);
  wMinus[name] = Math.max(0, cur(name) - c * scale * d);
}
const decks = loadMetaDecks();
const jobs: (GameRun & { plusSeat: 0 | 1 })[] = [];
for (let i = 0; jobs.length < games; i++) {
  const A = decks[Math.floor(r() * decks.length)], B = decks[Math.floor(r() * decks.length)];
  for (const plusSeat of [0, 1] as const) {
    const P = { kind: 'ai' as const, opts: { weights: wPlus } }, M = { kind: 'ai' as const, opts: { weights: wMinus } };
    jobs.push({ seed: 7_000_000 + k * 1000 + i, decks: [A.deck, B.deck], deckNames: [A.file, B.file], plusSeat, policies: plusSeat === 0 ? [P, M] : [M, P] });
  }
}
let plus = 0, n = 0;
const t0 = Date.now();
await runParallel(jobs, workers, (job, out) => {
  if (out.status === 'void') return;
  n++;
  if (out.winner === null) plus += 0.5; else if (out.winner === job.plusSeat) plus++;
});
const diff = (plus / Math.max(1, n)) * 2 - 1;     // in [-1, 1]
for (const [name, scale] of Object.entries(TUNE) as [keyof EvalWeights, number][]) {
  const g = diff / (2 * c * delta[name]);          // gradient estimate in units of `scale`
  st.w[name] = Math.max(0, +(cur(name) + a * scale * g).toFixed(4));
}
st.iter = k;
st.history.push({ iter: k, plus: +(plus / Math.max(1, n)).toFixed(3), games: n, delta });
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(st, null, 1));
console.log(`iter ${k}: w+ scored ${(100 * plus / Math.max(1, n)).toFixed(1)}% of ${n} games (c ${c.toFixed(3)}, a ${a.toFixed(3)}), ${((Date.now() - t0) / 1000).toFixed(0)}s`);
console.log('weights:', Object.entries(st.w).map(([k2, v]) => `${k2}=${v}`).join(','));

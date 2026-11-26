// AI-CORE: mechanic-usage metrics for one piloted deck (definition of "can pilot", criterion 3).
//   sh tools/meta-sim-snapshot.sh tools/ai-metrics.ts --only 01-azir --games 40 [--vs legacy|bot|ai] [--noplans] [--json f]
// The tested deck (new AI) plays random meta opponents (both seats). Per game averages: cards played by name, legend
// activations, hides / plays from hiding, tokens made, attachments (Equip + Weaponmaster), cards drawn, runes at the
// first decision of own turns 1..10 (after channelling), points; plus winrate.
import { writeFileSync } from 'node:fs';
import { loadMetaDecks, runParallel, wilson, type GameRun, type PolicySpec, type SeatMetrics } from './sim-lib.ts';
import { makeRng } from '../src/engine/rng.ts';

const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : (process.argv[i + 1]?.startsWith('--') || process.argv[i + 1] === undefined ? 'true' : process.argv[i + 1]); };
const games = +(arg('games', '40')!), workers = +(arg('workers', '2')!), seed = +(arg('seed', '1')!);
const vs = (arg('vs', 'ai') as 'bot' | 'legacy' | 'ai');
const all = loadMetaDecks();
const mine = all.filter(d => d.file.startsWith(arg('only') ?? '01-azir'));
const opps = all.filter(d => !arg('opp') || arg('opp')!.split(',').some(o => d.file.startsWith(o)));
if (!mine.length) throw new Error('--only: no such deck');
const opts = arg('noplans') === 'true' ? { usePlans: false } : {};
const oppSpec: PolicySpec = vs === 'bot' ? { kind: 'bot' } : vs === 'legacy' ? { kind: 'legacy' } : { kind: 'ai' };
const r = makeRng(seed);
const jobs: (GameRun & { aiSeat: 0 | 1 })[] = [];
for (let i = 0; jobs.length < games; i++) {
  const a = mine[Math.floor(r() * mine.length)], b = opps[Math.floor(r() * opps.length)];
  for (const aiSeat of [0, 1] as const) {
    const me: PolicySpec = { kind: 'ai', opts };
    jobs.push({ seed: seed * 100000 + i, metrics: true, decks: aiSeat === 0 ? [a.deck, b.deck] : [b.deck, a.deck], deckNames: aiSeat === 0 ? [a.file, b.file] : [b.file, a.file], aiSeat,
      policies: aiSeat === 0 ? [me, oppSpec] : [oppSpec, me] });
  }
}
const ms: SeatMetrics[] = [];
let w = 0, n = 0, turns = 0;
await runParallel(jobs, workers, (job, out, done) => {
  if (out.status === 'void' || !out.metrics) return;
  n++; turns += out.turns;
  if (out.winner === job.aiSeat) w++; else if (out.winner === null) w += 0.5;
  ms.push(out.metrics[job.aiSeat]);
  if (done % 10 === 0) process.stdout.write(`  ${done}/${jobs.length}\n`);
});
const avg = (f: (m: SeatMetrics) => number) => ms.reduce((t, m) => t + f(m), 0) / Math.max(1, ms.length);
const plays: Record<string, number> = {}, toks: Record<string, number> = {};
for (const m of ms) { for (const [k, v] of Object.entries(m.plays)) plays[k] = (plays[k] ?? 0) + v; for (const [k, v] of Object.entries(m.tokens)) toks[k] = (toks[k] ?? 0) + v; }
const [lo, hi] = wilson(w, n);
const runes = Array.from({ length: 10 }, (_, i) => { const xs = ms.filter(m => m.runesByTurn.length > i).map(m => m.runesByTurn[i]); return xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : '-'; });
const out = {
  deck: mine.map(d => d.file), vs, games: n, score: w / Math.max(1, n), ci: [lo, hi], avgTurns: turns / Math.max(1, n),
  perGame: { legendUses: avg(m => m.legendUses), hides: avg(m => m.hides), playedFromHidden: avg(m => m.playedFromHidden), attachments: avg(m => m.equips), cardsDrawn: avg(m => m.cardsDrawn), points: avg(m => m.points) },
  tokensPerGame: Object.fromEntries(Object.entries(toks).map(([k, v]) => [k, +(v / Math.max(1, n)).toFixed(2)])),
  playsPerGame: Object.fromEntries(Object.entries(plays).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, +(v / Math.max(1, n)).toFixed(2)])),
  runesAtOwnTurnStart: runes,
};
console.log(`${out.deck.join(',')} vs ${vs}: score ${(100 * out.score).toFixed(1)}% [${(100 * lo).toFixed(1)}, ${(100 * hi).toFixed(1)}] over ${n} games, ${out.avgTurns.toFixed(1)} turns`);
console.log('per game:', Object.entries(out.perGame).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', '));
console.log('tokens/game:', JSON.stringify(out.tokensPerGame));
console.log('runes in play at the first decision of own turns 1..10 (after channelling):', runes.join(' '));
console.log('plays/game:', Object.entries(out.playsPerGame).map(([k, v]) => `${k} ${v}`).join(', '));
if (arg('json')) writeFileSync(arg('json')!, JSON.stringify(out, null, 1));

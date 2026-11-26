// AI-CORE: strength benchmark of the search AI (src/ai) against an opponent policy: the legacy AI (src/ai/legacy, the
// pre-AI-CORE search), the engine heuristic bot (src/engine/bot.ts) or another configuration of the new AI.
//   sh tools/meta-sim-snapshot.sh tools/ai-bench.ts --games 200 --vs legacy [--only 01-azir] [--opp 02-vex] [--mirror]
//   flags: --vs legacy|bot|ai   --games N (total, both seats)   --seed S   --workers W   --noplans   --oppnoplans
//          --turn N --replan N --budget N (turn-plan node budgets)   --beam N --depth N --k0 N --k N --reply N
//          --me legacy|bot (benchmark another policy as the tested side, e.g. the legacy-vs-bot baseline)
//          --respond (opponent bot answers chain/showdown windows inside the planner's lookahead)
//          --w k=v,... (weights of the tested AI)   --ow k=v,... (weights of the opponent AI when --vs ai)
//          --json file (summary + per-game results, for paired A/B comparisons)
// Deck pairs are drawn from data/meta-decks (random pairs; --only fixes the tested AI's deck, --opp the opponent's;
// --mirror = same deck). Every pair is played twice with the same seed, swapping seats. Reports the tested AI's score
// (draws = half) with a 95% Wilson CI, by deck, and CPU cost.
import { writeFileSync } from 'node:fs';
import { loadMetaDecks, runParallel, wilson, type GameRun, type PolicySpec } from './sim-lib.ts';
import { makeRng } from '../src/engine/rng.ts';
import type { SearchOptions } from '../src/ai/index.ts';

const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : (process.argv[i + 1]?.startsWith('--') || process.argv[i + 1] === undefined ? 'true' : process.argv[i + 1]); };
const games = +(arg('games', '200')!), workers = +(arg('workers', '2')!), seed = +(arg('seed', '1')!);
const mirror = arg('mirror') === 'true';
const vs = (arg('vs', 'bot') as 'bot' | 'legacy' | 'ai');
const num = (k: string) => arg(k) === undefined ? undefined : +arg(k)!;
const clean = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
const weights = (s?: string) => s ? Object.fromEntries(s.split(',').map(kv => { const [k, v] = kv.split('='); return [k, +v]; })) : undefined;
const opts: SearchOptions = clean({
  maxNodes: num('nodes'), settleCap: num('settle'), inStepCandidates: num('instep'), responseCandidates: num('resp'),
  turnNodes: num('turn'), replanNodes: num('replan'), turnBudget: num('budget'),
  planner: Object.keys(clean({ beam: num('beam'), depth: num('depth'), k0: num('k0'), k: num('k'), replyTop: num('reply') })).length ? clean({ beam: num('beam'), depth: num('depth'), k0: num('k0'), k: num('k'), replyTop: num('reply') }) : undefined,
  weights: weights(arg('w')), usePlans: arg('noplans') === 'true' ? false : undefined,
  respondInSettle: arg('respond') === undefined ? undefined : arg('respond') !== 'false',
  legacyEval: arg('legacyeval') === 'true' ? true : undefined,
});
const oppOpts: SearchOptions = clean({ weights: weights(arg('ow')), usePlans: arg('oppnoplans') === 'true' ? false : undefined });
const all = loadMetaDecks();
const pick = (s?: string) => { const l = s?.split(','); return all.filter(d => !l || l.some(o => d.file.startsWith(o))); };
const mine = pick(arg('only')), theirs = pick(arg('opp'));
const r = makeRng(seed);
const oppSpec: PolicySpec = vs === 'bot' ? { kind: 'bot' } : vs === 'legacy' ? { kind: 'legacy' } : { kind: 'ai', opts: oppOpts };
const jobs: (GameRun & { aiSeat: 0 | 1; deck: string; oppDeck: string })[] = [];
for (let i = 0; jobs.length < games; i++) {
  const a = mine[Math.floor(r() * mine.length)], b = mirror ? a : theirs[Math.floor(r() * theirs.length)];
  for (const aiSeat of [0, 1] as const) {
    const me: PolicySpec = arg('me') === 'legacy' ? { kind: 'legacy' } : arg('me') === 'bot' ? { kind: 'bot' } : { kind: 'ai', opts };
    jobs.push({ seed: seed * 100000 + i, decks: aiSeat === 0 ? [a.deck, b.deck] : [b.deck, a.deck], deckNames: aiSeat === 0 ? [a.file, b.file] : [b.file, a.file], aiSeat, deck: a.file, oppDeck: b.file,
      policies: aiSeat === 0 ? [me, oppSpec] : [oppSpec, me] });
  }
}
const t0 = Date.now();
const byKind: Record<string, number[]> = {};
const byDeck: Record<string, [number, number]> = {};
let cpuMs = 0;
let w = 0, l = 0, dr = 0, v = 0, aiMs = 0, oppMs = 0, aiDec = 0, gameMs = 0, firstW = 0, decided = 0, aiErr = 0, aiNodes = 0, aiSearched = 0, turns = 0;
const perGame: { seed: number; deck: string; oppDeck: string; aiSeat: number; winner: number | null; status: string; turns: number; points: number[] }[] = [];
const res = await runParallel(jobs, workers, (job, out, done) => {
  perGame.push({ seed: job.seed, deck: job.deck, oppDeck: job.oppDeck, aiSeat: job.aiSeat, winner: out.winner, status: out.status, turns: out.turns, points: out.points });
  // partial results survive a timeout (the final summary overwrites this)
  if (arg('json')) try { writeFileSync(arg('json')!, JSON.stringify({ partial: true, games: perGame })); } catch { /* ignore */ }
  if (out.status === 'void') v++;
  else {
    const e = byDeck[job.deck] ??= [0, 0];
    e[1]++;
    turns += out.turns;
    if (out.winner === null) { dr++; e[0] += 0.5; }
    else { decided++; if (out.winner === 0) firstW++; if (out.winner === job.aiSeat) { w++; e[0]++; } else l++; }
  }
  const st = out.aiStats?.[job.aiSeat]; if (st) { aiMs += st.ms; aiDec += st.decisions; aiErr += st.errors; aiNodes += st.nodes; aiSearched += st.searched; for (const [k, x] of Object.entries((st as { byKind?: Record<string, number[]> }).byKind ?? {})) { const e = byKind[k] ??= [0, 0, 0]; x.forEach((y, i) => e[i] += y); } }
  const so = out.aiStats?.[1 - job.aiSeat]; if (so) oppMs += so.ms;
  gameMs += out.ms; cpuMs += out.cpuMs ?? 0;
  if (done % 20 === 0) process.stdout.write(`  ${done}/${jobs.length}: AI ${w}-${l}-${dr} (void ${v})  ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
});
const n = w + l + dr;
const score = w + dr / 2;
const [lo, hi] = wilson(score, n);
const pct = (x: number) => (100 * x).toFixed(1);
console.log(`\n${arg("me") ?? "new AI"} (opts ${JSON.stringify(opts)}) vs ${vs}${vs === 'ai' ? ' ' + JSON.stringify(oppOpts) : ''} (${mirror ? 'mirror' : `decks ${arg('only') ?? 'all'} vs ${arg('opp') ?? 'all'}`}): ${w}-${l}-${dr} (+${v} void) of ${jobs.length}`);
console.log(`score ${pct(score / Math.max(1, n))}%  95% CI [${pct(lo)}, ${pct(hi)}]`);
console.log(`seat 0 (first player) won ${pct(firstW / Math.max(1, decided))}% of decided games; avg ${(turns / Math.max(1, n)).toFixed(1)} turns`);
console.log(`AI: ${aiDec} decisions, ${aiSearched} searched, ${(aiNodes / Math.max(1, aiSearched)).toFixed(1)} nodes/search, ${aiErr} search errors`);
console.log(`avg game ${(gameMs / jobs.length / 1000).toFixed(2)}s wall, ${(cpuMs / jobs.length / 1000).toFixed(2)}s CPU; tested AI ${(aiMs / jobs.length / 1000).toFixed(2)}s/game wall (${(aiMs / Math.max(1, aiDec)).toFixed(1)} ms/decision), opponent ${(oppMs / jobs.length / 1000).toFixed(2)}s/game; wall ${((Date.now() - t0) / 1000).toFixed(0)}s`);
for (const [k, x] of Object.entries(byKind).sort((a, b) => b[1][2] - a[1][2])) console.log(`  ${k.padEnd(18)} searches ${x[0]}  nodes/search ${(x[1] / x[0]).toFixed(1)}  ms/search ${(x[2] / x[0]).toFixed(0)}  total ${(x[2] / 1000).toFixed(0)}s`);
if (Object.keys(byDeck).length > 1) for (const [k, [s, m]] of Object.entries(byDeck).sort()) { const [a, b] = wilson(s, m); console.log(`  ${k.padEnd(18)} ${s}/${m}  ${pct(s / m)}% [${pct(a)}, ${pct(b)}]`); }
const voids = res.map((o, i) => ({ o, i })).filter(x => x.o.status === 'void');
for (const { o, i } of voids.slice(0, 10)) console.log(`  VOID job ${i} seed ${jobs[i].seed} ${o.error?.kind}: ${o.error?.message.slice(0, 160)}`);
if (arg('json')) writeFileSync(arg('json')!, JSON.stringify({ opts, vs, oppOpts, w, l, dr, v, score: score / Math.max(1, n), ci: [lo, hi], byDeck, cpuPerGame: cpuMs / jobs.length / 1000, at: new Date().toISOString(), games: perGame }, null, 1));

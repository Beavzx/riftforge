// META-SIM: round-robin meta simulation of the tournament decks in data/meta-decks.
//   node --import tsx tools/meta-sim.ts --decks 20 --games 100 --workers 2 --seed 1
//   sh tools/meta-sim-snapshot.sh tools/meta-sim.ts --decks 20 --games 100     (recommended: frozen sources)
// Options:
//   --decks N          use the N best-placed decks (default 20) | --only 01-azir,04-rek-sai  (file prefixes)
//   --games G          games per pair (even; both seat orders get G/2 each, same seeds), default 20
//   --policy ai|bot    pilot for both seats (default ai = src/ai search AI)
//   --nodes/--cands/--instep/--resp/--settle   search AI budget overrides (see src/ai/search.ts)
//   --tag NAME         output data/meta-sim/NAME.json (default "results"); docs/meta-sim.md is written unless --no-doc
//   --resume           skip games already recorded in the output file (same tag/seed/decks); progress is saved every
//                      20 s and on SIGTERM/SIGINT, so a long run can be done in chunks (e.g. `timeout 590 ... --resume`)
//   --max-turns T      turn cap (default 40): longer games are recorded as timeouts (= draws)
//   --pairs K          only K random pairs of the round robin (timing samples)
//   --report           only regenerate docs/meta-sim.md from data/meta-sim/<tag>.json
// Bo1, official 1v1 setup: each deck brings its 3 battlefields, one of each is picked at random (CR 485.3,
// battlefieldSelection 'random'); seat 0 goes first, and every seed is played with both seat orders, so each deck
// goes first in exactly half of its games. Engine exceptions / invariant failures void the game (not counted) and are
// listed with a repro (data/meta-sim/repros/<sig>.json: seed, decks, policies, action log).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { loadMetaDecks, runParallel, wilson, ROOT, type GameRun, type GameOutcome, type PolicySpec } from './sim-lib.ts';

const OUT = process.env.META_OUT ?? ROOT;
const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : (process.argv[i + 1] === undefined || process.argv[i + 1].startsWith('--') ? 'true' : process.argv[i + 1]); };
const num = (k: string) => arg(k) === undefined ? undefined : +arg(k)!;

interface GameRec { i: number; j: number; k: number; first: 'i' | 'j'; seed: number; w: 'i' | 'j' | 'd' | 'v'; turns: number; actions: number; ms: number; cpu?: number; pts: [number, number]; err?: string; rollbacks?: number; gaps?: number }
interface Results {
  meta: { date: string; seed: number; games: number; policy: string; aiOpts: Record<string, number>; maxTurns: number; workers: number; snapshot?: string; wallSec: number; decks: { file: string; placing: number; player: string; legend: string; source: string }[] };
  games: GameRec[];
  voids: { sig: string; kind: string; message: string; count: number; example: { i: number; j: number; seed: number; first: string; repro: string } }[];
  gaps?: { sig: string; kind: string; prompt: string; count: number; example: { i: number; j: number; seed: number; first: string; step: number } }[];
}

function hashSeed(...xs: number[]): number {
  let h = 2166136261;
  for (const x of xs) { h ^= x; h = Math.imul(h, 16777619) >>> 0; h ^= h >>> 13; }
  return (h >>> 0) % 1_000_000_007;
}

async function main(): Promise<void> {
  const all = loadMetaDecks().sort((a, b) => a.placing - b.placing);
  const only = arg('only')?.split(',');
  const decks = only ? all.filter(d => only.some(o => d.file.startsWith(o))) : all.slice(0, +(arg('decks', '20')!));
  const G = Math.max(2, 2 * Math.ceil(+(arg('games', '20')!) / 2));
  const seed = +(arg('seed', '1')!), workers = +(arg('workers', '2')!), maxTurns = +(arg('max-turns', '40')!);
  const policy = (arg('policy', 'ai') === 'bot' ? 'bot' : 'ai') as 'ai' | 'bot';
  const aiOpts = Object.fromEntries(Object.entries({ maxNodes: num('nodes'), maxCandidates: num('cands'), inStepCandidates: num('instep'), responseCandidates: num('resp'), settleCap: num('settle') }).filter(([, v]) => v !== undefined)) as Record<string, number>;
  const tag = arg('tag', 'results')!;
  const outFile = join(OUT, 'data/meta-sim', `${tag}.json`);
  mkdirSync(join(OUT, 'data/meta-sim/repros'), { recursive: true });
  const pol: PolicySpec = policy === 'ai' ? { kind: 'ai', opts: aiOpts } : { kind: 'bot' };
  let snapshot: string | undefined;
  try { snapshot = readFileSync(join(process.cwd(), '.snapshot-id'), 'utf8').replace(/\s+/g, ' ').trim(); } catch { /* not a snapshot */ }

  if (arg('report') === 'true') {
    const res = JSON.parse(readFileSync(outFile, 'utf8')) as Results;
    writeFileSync(join(OUT, 'docs/meta-sim.md'), report(res, tag));
    console.log(summaryText(res));
    return;
  }
  const prev: Results | null = arg('resume') === 'true' && existsSync(outFile) ? JSON.parse(readFileSync(outFile, 'utf8')) : null;
  const done = new Set((prev?.games ?? []).map(g => `${g.i}|${g.j}|${g.k}|${g.first}|${g.seed}`));
  const recs: GameRec[] = prev ? prev.games.slice() : [];
  const voidMap = new Map<string, Results['voids'][number]>((prev?.voids ?? []).map(v => [v.sig, v]));
  const gapMap = new Map<string, NonNullable<Results['gaps']>[number]>((prev?.gaps ?? []).map(v => [v.sig, v]));

  type Job = GameRun & { i: number; j: number; k: number; first: 'i' | 'j' };
  const jobs: Job[] = [];
  let pairList: [number, number][] = [];
  for (let i = 0; i < decks.length; i++) for (let j = i + 1; j < decks.length; j++) pairList.push([i, j]);
  if (arg('pairs')) {
    let h = seed >>> 0;
    const rnd = () => { h = hashSeed(h, 77); return h / 1_000_000_007; };
    for (let x = pairList.length - 1; x > 0; x--) { const y = Math.floor(rnd() * (x + 1)); [pairList[x], pairList[y]] = [pairList[y], pairList[x]]; }
    pairList = pairList.slice(0, +arg('pairs')!);
  }
  for (const [i, j] of pairList) for (let k = 0; k < G / 2; k++) {
    const s = hashSeed(seed, i, j, k);
    for (const first of ['i', 'j'] as const) {
      if (done.has(`${i}|${j}|${k}|${first}|${s}`)) continue;
      const [a, b] = first === 'i' ? [decks[i], decks[j]] : [decks[j], decks[i]];
      jobs.push({ i, j, k, first, seed: s, decks: [a.deck, b.deck], deckNames: [a.file, b.file], policies: [pol, pol], maxTurns });
    }
  }
  const pairs = pairList.length;
  console.log(`meta-sim: ${decks.length} decks, ${pairs} pairs x ${G} games = ${pairs * G} games (${jobs.length} to play), policy ${policy} ${JSON.stringify(aiOpts)}, ${workers} workers${snapshot ? `, snapshot ${snapshot}` : ''}`);
  const t0 = Date.now();
  let lastSave = Date.now(), n = 0;
  const save = (final: boolean) => {
    const res: Results = {
      meta: { date: new Date().toISOString(), seed, games: G, policy, aiOpts, maxTurns, workers, snapshot, wallSec: Math.round((prev?.meta.wallSec ?? 0) + (Date.now() - t0) / 1000),
        decks: decks.map(d => ({ file: d.file, placing: d.placing, player: d.player, legend: d.legendName, source: d.source })) },
      games: recs, voids: [...voidMap.values()].sort((a, b) => b.count - a.count), gaps: [...gapMap.values()].sort((a, b) => b.count - a.count),
    };
    writeFileSync(outFile, JSON.stringify(res));
    if (final && arg('no-doc') !== 'true') writeFileSync(join(OUT, 'docs/meta-sim.md'), report(res, tag));
    return res;
  };
  // save progress on interruption (timeouts / Ctrl-C), so the run can continue with --resume
  for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => { save(false); console.log(`\ninterrupted: ${recs.length} games saved to ${outFile} (continue with --resume)`); process.exit(130); });
  await runParallel(jobs, workers, (job, out: GameOutcome) => {
    n++;
    const w = out.status === 'void' ? 'v' : out.winner === null ? 'd' : (out.winner === 0) === (job.first === 'i') ? 'i' : 'j';
    const rec: GameRec = { i: job.i, j: job.j, k: job.k, first: job.first, seed: job.seed, w, turns: out.turns, actions: out.actions, ms: Math.round(out.ms), cpu: out.cpuMs !== undefined ? Math.round(out.cpuMs) : undefined,
      pts: (job.first === 'i' ? [out.points[0], out.points[1]] : [out.points[1], out.points[0]]) as [number, number] };
    if (out.rollbacks?.length) rec.rollbacks = out.rollbacks.length;
    if (out.enumGaps?.length) {
      rec.gaps = out.enumGaps.length;
      for (const gp of out.enumGaps) {
        const key = `gap|${gp.kind}|${gp.prompt}`;
        const h = createHash('sha1').update(key).digest('hex').slice(0, 10);
        const e = gapMap.get(h);
        if (e) e.count++;
        else gapMap.set(h, { sig: h, kind: gp.kind, prompt: gp.prompt, count: 1, example: { i: job.i, j: job.j, seed: job.seed, first: job.first, step: gp.step } });
      }
    }
    if (out.status === 'void' && out.error) {
      const sig = `${out.error.kind}|${out.error.message.replace(/\bo\d+\b/g, 'oN').replace(/\d+/g, 'N').slice(0, 160)}`;
      const h = createHash('sha1').update(sig).digest('hex').slice(0, 10);
      rec.err = h;
      const v = voidMap.get(h);
      if (v) v.count++;
      else {
        const file = `data/meta-sim/repros/${h}.json`;
        writeFileSync(join(OUT, file), JSON.stringify({ sig, error: out.error, setup: { seed: job.seed, decks: job.deckNames, battlefieldSelection: 'random', firstPlayer: 0, policies: out.repro?.policies, aiOpts }, actions: out.repro?.actions ?? [] }));
        voidMap.set(h, { sig: h, kind: out.error.kind, message: out.error.message.slice(0, 300), count: 1, example: { i: job.i, j: job.j, seed: job.seed, first: job.first, repro: file } });
      }
    }
    recs.push(rec);
    if (n % 25 === 0 || n === jobs.length) {
      const el = (Date.now() - t0) / 1000;
      process.stdout.write(`  ${n}/${jobs.length} games, ${el.toFixed(0)}s, ${(el / n).toFixed(2)}s/game wall, ETA ${((jobs.length - n) * el / n / 60).toFixed(1)} min, voids ${recs.filter(r => r.w === 'v').length}\n`);
    }
    if (Date.now() - lastSave > 20000) { save(false); lastSave = Date.now(); }
  });
  const res = save(true);
  console.log(summaryText(res));
}

// ---------------------------------------------------------------- report

interface DeckStat { w: number; l: number; d: number; v: number }
function stats(res: Results) {
  const N = res.meta.decks.length;
  const deck: DeckStat[] = Array.from({ length: N }, () => ({ w: 0, l: 0, d: 0, v: 0 }));
  const mat: DeckStat[][] = Array.from({ length: N }, () => Array.from({ length: N }, () => ({ w: 0, l: 0, d: 0, v: 0 })));
  let firstW = 0, decided = 0, turns = 0, actions = 0, ms = 0, cpu = 0, played = 0, timeouts = 0, voids = 0, rollbacks = 0;
  for (const g of res.games) {
    const A = mat[g.i][g.j], B = mat[g.j][g.i];
    if (g.w === 'v') { A.v++; B.v++; deck[g.i].v++; deck[g.j].v++; voids++; continue; }
    played++; turns += g.turns; actions += g.actions; ms += g.ms; cpu += g.cpu ?? g.ms; rollbacks += g.rollbacks ?? 0;
    if (g.w === 'd') { A.d++; B.d++; deck[g.i].d++; deck[g.j].d++; timeouts++; continue; }
    const win = g.w === 'i' ? g.i : g.j, lose = g.w === 'i' ? g.j : g.i;
    mat[win][lose].w++; mat[lose][win].l++; deck[win].w++; deck[lose].l++;
    decided++; if (g.w === g.first) firstW++;
  }
  return { N, deck, mat, firstW, decided, turns, actions, ms, cpu, played, timeouts, voids, rollbacks };
}

const pct = (x: number) => (100 * x).toFixed(1);
const score = (s: DeckStat) => { const n = s.w + s.l + s.d; return { n, p: n ? (s.w + s.d / 2) / n : NaN, ci: wilson(s.w + s.d / 2, n) }; };

function summaryText(res: Results): string {
  const st = stats(res);
  const order = [...Array(st.N).keys()].sort((a, b) => (score(st.deck[b]).p || 0) - (score(st.deck[a]).p || 0));
  const lines = order.map(i => { const s = score(st.deck[i]); return `  ${res.meta.decks[i].file.padEnd(22)} ${pct(s.p).padStart(5)}%  [${pct(s.ci[0])}, ${pct(s.ci[1])}]  ${st.deck[i].w}-${st.deck[i].l}-${st.deck[i].d}${st.deck[i].v ? ` (${st.deck[i].v} void)` : ''}`; });
  const fp = wilson(st.firstW, st.decided);
  return [`played ${st.played} (+${st.voids} void), timeouts ${st.timeouts}, avg ${(st.turns / Math.max(1, st.played)).toFixed(1)} turns / ${(st.actions / Math.max(1, st.played)).toFixed(0)} actions / ${(st.ms / Math.max(1, st.played) / 1000).toFixed(2)}s wall / ${(st.cpu / Math.max(1, st.played) / 1000).toFixed(2)}s CPU per game`,
    `first player won ${pct(st.firstW / Math.max(1, st.decided))}% [${pct(fp[0])}, ${pct(fp[1])}] of decided games`, ...lines].join('\n');
}

function report(res: Results, tag: string): string {
  const st = stats(res);
  const d = res.meta.decks;
  const order = [...Array(st.N).keys()].sort((a, b) => (score(st.deck[b]).p || 0) - (score(st.deck[a]).p || 0));
  const short = (i: number) => `${d[i].placing}. ${d[i].legend.split(',')[0]}`;
  const L: string[] = [];
  L.push(`# Meta simulation${tag !== 'results' ? ` (${tag})` : ''}`, '');
  if (tag !== 'results') L.push(`> Sample run "${tag}" (${st.N} decks), not the full 20-deck round robin. Full run: \`sh tools/meta-sim-snapshot.sh tools/meta-sim.ts --decks 20 --games 100 --workers 2\`.`, '');
  L.push(`Generated by \`tools/meta-sim.ts\` on ${res.meta.date.slice(0, 16)}Z. Do not edit by hand. Raw data: \`data/meta-sim/${tag}.json\`.`, '');
  L.push(`- Decks: ${st.N} (docs/meta-decks.md), round robin, ${res.meta.games} games per pair (each deck goes first in half), Bo1 with random battlefields (CR 485.3).`);
  L.push(`- Pilots: ${res.meta.policy === 'ai' ? `search AI (src/ai, options ${JSON.stringify(res.meta.aiOpts)})` : 'baseline heuristic bot (src/engine/bot.ts)'} on both sides; seed ${res.meta.seed}; turn cap ${res.meta.maxTurns} (timeout = draw).`);
  if (res.meta.snapshot) L.push(`- Engine snapshot: ${res.meta.snapshot}.`);
  L.push(`- Games played: ${st.played} (+${st.voids} void), timeouts ${st.timeouts}; avg length ${(st.turns / Math.max(1, st.played)).toFixed(1)} turns, ${(st.actions / Math.max(1, st.played)).toFixed(0)} actions, ${(st.cpu / Math.max(1, st.played) / 1000).toFixed(2)} s CPU (${(st.ms / Math.max(1, st.played) / 1000).toFixed(2)} s wall) per game; total wall ${(res.meta.wallSec / 60).toFixed(0)} min on ${res.meta.workers} workers.`);
  const cpuPer = st.cpu / Math.max(1, st.played) / 1000;
  L.push(`- Cost model: at ${cpuPer.toFixed(2)} s CPU per game, a full 20-deck run (190 pairs) needs ${(190 * 100 * cpuPer / 3600).toFixed(1)} CPU-hours at 100 games/pair (${(190 * 100 * cpuPer / 3600 / 2).toFixed(1)} h on 2 free cores), ${(190 * 40 * cpuPer / 3600 / 2).toFixed(1)} h at 40/pair.`);
  const fp = wilson(st.firstW, st.decided);
  L.push(`- First-player advantage: the player going first won **${pct(st.firstW / Math.max(1, st.decided))}%** of decided games (95% CI ${pct(fp[0])}-${pct(fp[1])}%).`);
  if (st.rollbacks) L.push(`- Engine rollbacks of enumerated-legal actions (engine bug guard, see docs/dsl-requests.md): ${st.rollbacks}.`);
  L.push('', 'Winrates are draws-as-half; CIs are 95% Wilson intervals. With identical pilots for every deck these measure how well each list performs *under this AI*, not under expert humans.', '');
  L.push('## Overall', '', '| Rank | Deck | Player | Winrate | 95% CI | W-L-D | Void |', '|---|---|---|---|---|---|---|');
  order.forEach((i, r) => { const s = score(st.deck[i]); L.push(`| ${r + 1} | ${short(i)} (\`${d[i].file}\`) | ${d[i].player} | **${pct(s.p)}%** | ${pct(s.ci[0])}-${pct(s.ci[1])} | ${st.deck[i].w}-${st.deck[i].l}-${st.deck[i].d} | ${st.deck[i].v} |`); });
  // by legend
  const byLegend = new Map<string, DeckStat>();
  for (let i = 0; i < st.N; i++) { const k = d[i].legend; const e = byLegend.get(k) ?? { w: 0, l: 0, d: 0, v: 0 }; e.w += st.deck[i].w; e.l += st.deck[i].l; e.d += st.deck[i].d; e.v += st.deck[i].v; byLegend.set(k, e); }
  L.push('', '## By legend (all lists of that legend pooled; a game between two lists of the same legend counts for both)', '', '| Legend | Lists | Winrate | 95% CI |', '|---|---|---|---|');
  for (const [k, e] of [...byLegend.entries()].sort((a, b) => score(b[1]).p - score(a[1]).p)) { const s = score(e); L.push(`| ${k} | ${d.filter(x => x.legend === k).length} | ${pct(s.p)}% | ${pct(s.ci[0])}-${pct(s.ci[1])} |`); }
  L.push('', '## Matchup matrix', '', 'Row deck\'s winrate against the column deck (games per cell in the raw data).', '');
  L.push('| vs | ' + order.map(j => `${d[j].placing}`).join(' | ') + ' |', '|---|' + order.map(() => '---').join('|') + '|');
  for (const i of order) L.push(`| **${short(i)}** | ` + order.map(j => { if (i === j) return '-'; const s = score(st.mat[i][j]); return s.n ? `${Math.round(100 * s.p)}` : ''; }).join(' | ') + ' |');
  L.push('', '## Engine failures (void games)', '');
  if (!res.voids.length) L.push('None.');
  else {
    L.push('| Sig | Kind | Games | Message | Example repro |', '|---|---|---|---|---|');
    for (const v of res.voids) L.push(`| ${v.sig} | ${v.kind} | ${v.count} | ${v.message.replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 200)} | \`${v.example.repro}\` (${d[v.example.i].file} vs ${d[v.example.j].file}, seed ${v.example.seed}, ${v.example.first === 'i' ? d[v.example.i].file : d[v.example.j].file} first) |`);
  }
  L.push('', '## Engine enumeration gaps (game continued)', '', 'Decisions where `getLegalActions` returned nothing although the decision\'s validator accepts an answer (the harness found one by brute force).', '');
  if (!res.gaps?.length) L.push('None.');
  else {
    L.push('| Sig | Kind | Times | Prompt | Example (replay to step) |', '|---|---|---|---|---|');
    for (const v of res.gaps) L.push(`| ${v.sig} | ${v.kind} | ${v.count} | ${v.prompt.replace(/\|/g, '/')} | ${d[v.example.i].file} vs ${d[v.example.j].file}, seed ${v.example.seed}, ${v.example.first === 'i' ? d[v.example.i].file : d[v.example.j].file} first, step ${v.example.step} |`);
  }
  L.push('');
  // META-AUDIT: the hand-written "## AI notes" section (and anything after it) survives regeneration
  try {
    const old = readFileSync(join(OUT, 'docs/meta-sim.md'), 'utf8');
    const at = old.indexOf('\n## AI notes');
    if (at >= 0) L.push(old.slice(at + 1).trimEnd(), '');
  } catch { /* no previous report */ }
  return L.join('\n');
}

main().catch(e => { console.error(e); process.exit(1); });

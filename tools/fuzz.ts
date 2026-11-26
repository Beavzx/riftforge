// Interaction fuzz CLI (FUZZ agent).
//   node --import tsx tools/fuzz.ts --games 2000 --seed 1 --workers 2 --minutes 8
//   node --import tsx tools/fuzz.ts --report            (regenerate docs/fuzz-report.md from tests/fuzz-repros)
//   node --import tsx tools/fuzz.ts --recheck           (re-run every saved repro, update its "still fails" flag)
// Plays random legal games from the whole card pool across worker_threads, checks invariants after every
// action (tools/fuzz-lib.ts), minimises each new failure signature and saves it to tests/fuzz-repros/<hash>.json
// as soon as it is found. Runs append a summary to tests/fuzz-repros/_runs.json.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, makeSpec, playFuzzGame, minimize, signature, sigHash, isSoft, reproFails, reproFailsKind, DEFAULT_CHECKS, type Repro, type Failure } from './fuzz-lib.ts';

// FUZZ_OUT: write repros/report into another tree (used when fuzzing a snapshot of the sources, tools/fuzz-snapshot.sh)
const OUT = process.env.FUZZ_OUT ?? ROOT;
const REPRO_DIR = join(OUT, 'tests/fuzz-repros');
const RUNS = join(REPRO_DIR, '_runs.json');
const REPORT = join(OUT, 'docs/fuzz-report.md');

interface WorkerIn { w: number; k: number; seed: number; games: number; deadline: number; known: string[]; denseRatio: number; minimizeMs: number; heavy: boolean }
type Msg =
  | { t: 'game'; seed: number; steps: number; turns: number; winner: number | null; ms: number; sigs: { sig: string; kind: string; soft: boolean; cards: string[] }[]; stats: Record<string, number> }
  | { t: 'repro'; repro: Repro }
  | { t: 'done'; w: number };

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? 'true' : v;
}

export function loadRepros(): Repro[] {
  if (!existsSync(REPRO_DIR)) return [];
  return readdirSync(REPRO_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_')).map(f => JSON.parse(readFileSync(join(REPRO_DIR, f), 'utf8')) as Repro);
}

function saveRepro(rp: Repro): void {
  mkdirSync(REPRO_DIR, { recursive: true });
  const file = join(REPRO_DIR, `${rp.hash}.json`);
  if (existsSync(file)) {
    const old = JSON.parse(readFileSync(file, 'utf8')) as Repro;
    // keep the smaller reproduction and the triage notes
    const better = rp.actions.length < old.actions.length ? rp : old;
    writeFileSync(file, JSON.stringify({ ...better, triage: old.triage ?? better.triage, count: (old.count ?? 1) + 1 }, null, 1));
    return;
  }
  writeFileSync(file, JSON.stringify({ ...rp, count: 1 }, null, 1));
}

// ---------------------------------------------------------------- worker

function workerMain(inp: WorkerIn): void {
  const known = new Set(inp.known);
  for (let i = inp.w; i < inp.games; i += inp.k) {
    if (Date.now() > inp.deadline) break;
    const seed = inp.seed + i;
    let spec;
    try { spec = makeSpec(seed, inp.denseRatio); } catch (e) { parentPort!.postMessage({ t: 'game', seed, steps: 0, turns: 0, winner: null, ms: 0, sigs: [{ sig: `deckgen|${(e as Error).message}|`, kind: 'deckgen', soft: false, cards: [] }], stats: {} }); continue; }
    // --heavy: every check on every step (slow; finds rarer purity / redaction issues)
    const r = playFuzzGame(spec, inp.heavy ? { ...DEFAULT_CHECKS, probeIllegal: 1, probeLegal: 0.6, enumCheck: 0.3, jsonCheck: 0.5, viewCheck: 1 } : DEFAULT_CHECKS);
    const all: Failure[] = [...r.soft, ...(r.failure ? [r.failure] : [])];
    parentPort!.postMessage({ t: 'game', seed, steps: r.steps, turns: r.turns, winner: r.winner, ms: r.ms, stats: r.stats,
      sigs: all.map(f => ({ sig: signature(f), kind: f.kind, soft: isSoft(f) || f !== r.failure, cards: f.cards ?? [] })) } satisfies Msg);
    for (const f of all) {
      const h = sigHash(signature(f));
      if (known.has(h)) continue;
      known.add(h);
      if (['long-game'].includes(f.kind)) continue;
      try { parentPort!.postMessage({ t: 'repro', repro: minimize(r, f, inp.minimizeMs) } satisfies Msg); }
      catch (e: unknown) { parentPort!.postMessage({ t: "game", seed, steps: 0, turns: 0, winner: null, ms: 0, stats: {}, sigs: [{ sig: `minimize-throw|${(e as Error).message}|`, kind: 'fuzzer', soft: true, cards: [] }] }); }
    }
  }
  parentPort!.postMessage({ t: 'done', w: inp.w } satisfies Msg);
}

// ---------------------------------------------------------------- main

async function runMain(): Promise<void> {
  const games = Number(arg('games', '1000'));
  const seed = Number(arg('seed', String(1 + Math.floor(Math.random() * 1e6))));
  const k = Number(arg('workers', '2'));
  const minutes = Number(arg('minutes', '8'));
  const denseRatio = Number(arg('dense', '0.4'));
  const minimizeMs = Number(arg('minimize-ms', '40000'));
  const deadline = Date.now() + minutes * 60000;
  const known = loadRepros().map(r => r.hash);
  const t0 = Date.now();
  const bySig = new Map<string, { kind: string; soft: boolean; n: number; cards: Set<string>; seeds: number[] }>();
  let played = 0, steps = 0, turns = 0, ended = 0, newRepros = 0;
  const stats: Record<string, number> = {};
  const file = fileURLToPath(import.meta.url);
  await new Promise<void>(resolve => {
    let live = k;
    for (let w = 0; w < k; w++) {
      const wk = new Worker(file, { workerData: { w, k, seed, games, deadline, known, denseRatio, minimizeMs, heavy: !!arg('heavy') } satisfies WorkerIn, execArgv: process.execArgv });
      wk.on('message', (m: Msg) => {
        if (m.t === 'game') {
          played++; steps += m.steps; turns += m.turns; if (m.winner !== null) ended++;
          for (const [kk, v] of Object.entries(m.stats)) stats[kk] = (stats[kk] ?? 0) + v;
          for (const s of m.sigs) {
            const e = bySig.get(s.sig) ?? { kind: s.kind, soft: s.soft, n: 0, cards: new Set<string>(), seeds: [] };
            e.n++; s.cards.forEach(c => e.cards.add(c)); if (e.seeds.length < 5) e.seeds.push(m.seed);
            bySig.set(s.sig, e);
          }
          if (played % 50 === 0) process.stdout.write(`  ${played} games, ${bySig.size} signatures, ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
        } else if (m.t === 'repro') { saveRepro(m.repro); newRepros++; process.stdout.write(`  NEW ${m.repro.hash} ${m.repro.kind}: ${m.repro.message.slice(0, 120)} [${m.repro.cards.join(', ')}] (${m.repro.actions.length} actions)\n`); }
        else if (m.t === 'done') { if (--live === 0) resolve(); }
      });
      wk.on("error", (e: Error) => { process.stdout.write(`worker ${w} crashed: ${e.stack}\n`); if (--live === 0) resolve(); });
    }
  });
  const run = {
    date: new Date().toISOString(), seed, games: played, workers: k, seconds: Math.round((Date.now() - t0) / 1000), steps, turns, ended, newRepros, stats,
    signatures: [...bySig.entries()].map(([sig, e]) => ({ hash: sigHash(sig), sig, kind: e.kind, soft: e.soft, games: e.n, cards: [...e.cards].slice(0, 12), seeds: e.seeds })).sort((a, b) => b.games - a.games),
  };
  mkdirSync(REPRO_DIR, { recursive: true });
  const runs = existsSync(RUNS) ? JSON.parse(readFileSync(RUNS, 'utf8')) as unknown[] : [];
  runs.push(run);
  writeFileSync(RUNS, JSON.stringify(runs, null, 1));
  console.log(`\n${played} games (${ended} finished, ${steps} actions, avg ${(turns / Math.max(1, played)).toFixed(1)} turns) in ${run.seconds}s; ${bySig.size} signatures, ${newRepros} new repros`);
  for (const s of run.signatures) console.log(`  ${String(s.games).padStart(5)}  ${s.hash} ${s.soft ? '(soft) ' : ''}${s.sig.slice(0, 150)}`);
  writeReport();
}

// ---------------------------------------------------------------- report

interface RunRec { date: string; seed: number; games: number; seconds: number; steps: number; ended: number; signatures: { hash: string; games: number }[] }

export function writeReport(): void {
  const repros = loadRepros();
  const runs = existsSync(RUNS) ? JSON.parse(readFileSync(RUNS, 'utf8')) as RunRec[] : [];
  const totalGames = runs.reduce((s, r) => s + r.games, 0);
  const totalSec = runs.reduce((s, r) => s + r.seconds, 0);
  const seen: Record<string, number> = {};
  for (const r of runs) for (const s of r.signatures) seen[s.hash] = (seen[s.hash] ?? 0) + s.games;
  const last = runs[runs.length - 1];
  const lines: string[] = [];
  lines.push('# Fuzz report (interaction fuzzer)', '');
  lines.push('Generated by `node --import tsx tools/fuzz.ts` (see tools/fuzz-lib.ts for the invariants). Do not edit by hand:', 'triage notes live in each repro\'s `triage` field (tests/fuzz-repros/<hash>.json).', '');
  lines.push(`- Total: **${totalGames} games** over ${runs.length} runs, ${(totalSec / 60).toFixed(0)} worker-minutes wall time (${runs.reduce((s, r) => s + r.steps, 0)} actions).`);
  if (last) lines.push(`- Last run: ${last.date.slice(0, 16)} seed ${last.seed}, ${last.games} games, ${last.ended} ended normally, ${last.signatures.length} distinct signatures.`);
  lines.push(`- Repros on disk: ${repros.length} (${repros.filter(r => r.triage?.status === 'fixed').length} fixed, ${repros.filter(r => r.triage?.status === 'filed').length} filed as engine bugs, ${repros.filter(r => !r.triage || r.triage.status === 'open').length} open).`, '');
  lines.push('Invariants checked after every action: no exception; a pending decision unless the game is over, and only for that player;',
    'every enumerated action applies without throwing (sampled), malformed/illegal wire-shaped actions are rejected by validateAction AND',
    'applyAction (EngineError) without mutating the input; validateAction vs getLegalActions agree for playCard/activate/hide (sampled);',
    'zone/object consistency (tests/fixtures/invariants.ts + structural checks); chain items reference existing sources; showdown/focus/priority',
    'coherence; points only drop with a pointsLost event; pools empty at end of turn; JSON purity + JSON round-trip re-application (sampled);',
    'getView redaction (hidden cardIds, log entries naming hidden objects); determinism (replay of the full action log); turn cap 60.', '');
  const groups: Record<string, Repro[]> = {};
  for (const r of repros) { const o = r.triage?.owner ?? 'untriaged'; (groups[o] ??= []).push(r); }
  const order = ['engine', 'script', 'data', 'fuzzer', 'unknown', 'untriaged'];
  for (const o of order) {
    const rs = groups[o];
    if (!rs?.length) continue;
    lines.push(`## ${o === 'engine' ? 'Engine bugs (filed in docs/dsl-requests.md "From FUZZ")' : o === 'script' ? 'Card-script bugs' : o === 'data' ? 'Data issues' : o === 'fuzzer' ? 'Fuzzer false positives' : o === 'untriaged' ? 'Untriaged' : 'Unknown'}`, '');
    rs.sort((a, b) => (a.triage?.ref ?? 'zz').localeCompare(b.triage?.ref ?? 'zz', undefined, { numeric: true }) || (seen[b.hash] ?? 0) - (seen[a.hash] ?? 0));
    for (const r of rs) {
      const t = r.triage;
      lines.push(`### ${t?.ref ? t.ref + ' ' : ''}${r.kind}: ${r.message.slice(0, 160).replace(/\|/g, '/')}`);
      lines.push(`- repro: \`tests/fuzz-repros/${r.hash}.json\` (${r.actions.length} actions${r.probe ? ' + probe' : ''}, ${r.minimized.deckCards} distinct deck cards after shrinking); seen in ${seen[r.hash] ?? r.count ?? 1} games; status: **${t?.status ?? 'open'}**`);
      if (r.cards.length) lines.push(`- cards: ${r.cards.join(', ')}`);
      if (r.stack) { const fr = r.stack.split('\n').find(l => /src\//.test(l)); if (fr) lines.push(`- at: \`${fr.trim().replace(/^at /, '').replace(/.*\/(src\/)/, '$1')}\``); }
      if (t?.note) lines.push(`- ${t.note}`);
      lines.push('');
    }
  }
  lines.push('## Engine findings without a repro file', '',
    '- **F-2** chain item ids (`play.ts newItemId`) and `event.batch` (`events.ts batchSeq/lastType`) come from module-level counters, so',
    '  they differ between a game, its replay and a JSON round-trip; the fuzzer masks exactly these two fields when comparing states',
    '  (`setMaskEngineCounters(false)` in tools/fuzz-lib.ts shows the diffs in almost every game).',
    '- **F-5** hidden objects keep ids assigned in deck-list order (copies of a card get consecutive ids); getView ships the whole `cards` map.',
    '- **F-6** `ctx.becomeUnit` doesn\'t detach attached gear (worked around in Lady of Clockwork; repro d09ae46bc6 above).',
    '', 'Details and proposed fixes: docs/dsl-requests.md, "From FUZZ".', '');
  writeFileSync(REPORT, lines.join('\n'));
  console.log(`wrote ${REPORT}`);
}

function recheck(): void {
  for (const r of loadRepros()) {
    let f: Failure | null = null, err = '';
    try { f = reproFails(r) ?? reproFailsKind(r); } catch (e) { err = (e as Error).message; }
    console.log(`${r.hash} ${(r.triage?.status ?? 'open').padEnd(6)} ${f ? 'FAILS ' : err ? 'ERROR ' : 'passes'} ${r.kind}: ${r.message.slice(0, 100)} ${err}`);
  }
}

/** --triage <hash> <owner> <status> <ref|-> <note...> : record a triage verdict in a repro file. */
function triage(): void {
  const i = process.argv.indexOf('--triage');
  const [hash, owner, status, ref, ...note] = process.argv.slice(i + 1);
  const file = join(REPRO_DIR, `${hash}.json`);
  const rp = JSON.parse(readFileSync(file, 'utf8')) as Repro;
  rp.triage = { owner: owner as never, status: status as never, note: note.join(' '), ...(ref && ref !== '-' ? { ref } : {}) };
  writeFileSync(file, JSON.stringify(rp, null, 1));
  console.log(`${hash}: ${owner}/${status} ${ref} ${rp.triage.note}`);
}

if (!isMainThread) workerMain(workerData as WorkerIn);
else if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (arg('report')) writeReport();
  else if (arg('recheck')) recheck();
  else if (arg('triage')) triage();
  else runMain().catch(e => { console.error(e); process.exit(1); });
}

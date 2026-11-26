// META-SIM: shared game runner for tools/ai-bench.ts and tools/meta-sim.ts.
// One Bo1 game: random battlefields (official 1v1: each deck brings 3, one of each is picked at random, CR 485.3),
// seat 0 goes first (callers swap seats to balance), per-seat policies. Engine exceptions / invariant failures /
// stalls void the game and return a repro (seed + decks + action log) instead of crashing the run.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGame, applyAction, getLegalActions, validateAction } from '../src/engine/index.ts';
import type { Action, CardDef, CardId, DeckList, GameState, PlayerId } from '../src/engine/types.ts';
import { SearchAI, fastPolicy, type SearchOptions } from '../src/ai/index.ts';
import { SearchAI as LegacyAI } from '../src/ai/legacy/index.ts';
import { checkInvariants } from '../tests/fixtures/invariants.ts';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let DB: Record<CardId, CardDef> | null = null;
export function cardDb(): Record<CardId, CardDef> { return DB ??= JSON.parse(readFileSync(join(ROOT, 'data/cards.json'), 'utf8')); }

export interface MetaDeckFile { file: string; placing: number; player: string; legendName: string; source: string; deck: DeckList }
export function loadMetaDecks(): MetaDeckFile[] {
  const dir = join(ROOT, 'data/meta-decks');
  return readdirSync(dir).filter(f => /^\d+-.*\.json$/.test(f)).sort().map(f => ({ ...JSON.parse(readFileSync(join(dir, f), 'utf8')), file: f }));
}

export type PolicyName = 'bot' | 'ai' | 'legacy';   // legacy = the pre-AI-CORE search AI (src/ai/legacy)
export interface PolicySpec { kind: PolicyName; opts?: SearchOptions }

export interface GameOutcome {
  winner: PlayerId | null;        // seat index, null = draw / void
  status: 'ok' | 'timeout' | 'void';
  turns: number; actions: number; ms: number; points: number[];
  firstPlayer: PlayerId;
  error?: { kind: string; message: string; step: number; turn: number; pending?: string; cards?: string[] };
  repro?: { seed: number; decks: [string, string]; policies: [PolicyName, PolicyName]; actions: Action[] };
  aiStats?: { decisions: number; searched: number; nodes: number; errors: number; ms: number }[];
  rollbacks?: { turn: number; card?: string; reason: string }[];
  /** decisions where getLegalActions was empty but a valid answer existed (engine enumeration gap; game continued) */
  enumGaps?: { turn: number; kind: string; prompt: string; step: number }[];
  /** CPU ms of the thread that played the game */
  cpuMs?: number;
  /** AI-CORE (tools/ai-metrics.ts): per-seat mechanic counts, when GameRun.metrics is set */
  metrics?: SeatMetrics[];
}

export interface SeatMetrics { plays: Record<string, number>; legendUses: number; hides: number; playedFromHidden: number; tokens: Record<string, number>; equips: number; runesByTurn: number[]; points: number; cardsDrawn: number }

export interface GameRun {
  seed: number;
  decks: [DeckList, DeckList];
  deckNames?: [string, string];
  policies: [PolicySpec, PolicySpec];
  maxTurns?: number;          // default 40 -> timeout (draw)
  maxActions?: number;        // default 4000
  maxMainPerTurn?: number;    // default 80 main-phase actions per turn, then the turn is ended
  checkEvery?: number;        // invariant check interval in actions (default 25; 0 = off)
  /** AI-CORE: collect per-seat mechanic metrics from the log (tools/ai-metrics.ts) */
  metrics?: boolean;
}

type CpuFn = (prev?: NodeJS.CpuUsage) => NodeJS.CpuUsage;
const threadCpu: CpuFn | undefined = (process as unknown as { threadCpuUsage?: CpuFn }).threadCpuUsage?.bind(process);

/** playGame + per-thread CPU time (process.threadCpuUsage, Node >= 22.19; falls back to wall time). */
export function playGame(run: GameRun): GameOutcome {
  const c0 = threadCpu?.();
  const out = playGameInner(run);
  if (c0 && threadCpu) { const c = threadCpu(c0); out.cpuMs = (c.user + c.system) / 1000; }
  return out;
}

function playGameInner(run: GameRun): GameOutcome {
  const t0 = performance.now();
  const actions: Action[] = [];
  const maxTurns = run.maxTurns ?? 40, maxActions = run.maxActions ?? 4000, maxMain = run.maxMainPerTurn ?? 80, every = run.checkEvery ?? 25;
  const ais = run.policies.map((p, i) => p.kind === 'ai' ? new SearchAI({ ...(p.opts ?? {}), seed: run.seed * 2 + i + 1 }) : p.kind === 'legacy' ? new LegacyAI({ ...(p.opts ?? {}), seed: run.seed * 2 + i + 1 }) as unknown as SearchAI : null);
  const names = run.deckNames ?? ['A', 'B'];
  const fail = (g: GameState | null, kind: string, message: string): GameOutcome => ({
    winner: null, status: 'void', turns: g?.turn ?? 0, actions: actions.length, ms: performance.now() - t0, points: g ? g.players.map(p => p.points) : [0, 0],
    firstPlayer: 0,
    error: { kind, message: message.slice(0, 400), step: actions.length, turn: g?.turn ?? 0, pending: g?.pending ? `${g.pending.kind}: ${g.pending.prompt}` : undefined,
      cards: g?.pending?.source && g.objects[g.pending.source] ? [g.cards[g.objects[g.pending.source].cardId]?.name ?? '?'] : undefined },
    repro: { seed: run.seed, decks: names, policies: [run.policies[0].kind, run.policies[1].kind], actions }, rollbacks, enumGaps,
    aiStats: ais.map(a => a ? { ...a.stats } : { decisions: 0, searched: 0, nodes: 0, errors: 0, ms: 0 }),
  });
  let g: GameState;
  try {
    g = createGame({ seed: run.seed, cardDb: cardDb(), battlefieldSelection: 'random', firstPlayer: 0, enforceBanlist: false,
      players: [{ name: names[0], deck: run.decks[0] }, { name: names[1], deck: run.decks[1] }] });
  } catch (e) { return fail(null, 'create-throw', (e as Error).message); }
  let mainThisTurn = 0, lastTurn = g.turn;
  const runesAt: number[][] = [];
  // engine bug guard: an enumerated action that rolls back ("Action undone: ...") leaves the state unchanged, so a
  // deterministic policy would pick it forever. Such actions are banned for the rest of the turn and counted.
  let banned = new Set<string>();
  const rollbacks: { turn: number; card?: string; reason: string }[] = [];
  const enumGaps: { turn: number; kind: string; prompt: string; step: number }[] = [];
  while (g.winner === null) {
    if (g.turn > maxTurns) {
      return { winner: null, status: 'timeout', turns: g.turn, actions: actions.length, ms: performance.now() - t0, points: g.players.map(p => p.points), firstPlayer: g.firstPlayer, rollbacks, enumGaps,
        aiStats: ais.map(a => a ? { ...a.stats } : { decisions: 0, searched: 0, nodes: 0, errors: 0, ms: 0 }) };
    }
    if (actions.length >= maxActions) return fail(g, 'action-cap', `no winner after ${maxActions} actions (turn ${g.turn})`);
    const d = g.pending;
    if (!d) return fail(g, 'no-pending', 'no pending decision and no winner');
    if (g.turn !== lastTurn) { lastTurn = g.turn; mainThisTurn = 0; banned = new Set(); if (run.metrics) runesAt.push(g.players.map(p => p.runesInPlay.length)); }
    const p = d.player;
    let a: Action | null;
    try {
      if (!d.inStep && d.kind === 'mainAction' && ++mainThisTurn > maxMain) a = { type: 'endTurn', player: p };
      else a = ais[p] ? ais[p]!.choose(g, p) : fastPolicy(g, p);
    } catch (e) { return fail(g, 'policy-throw', (e as Error).stack ?? String(e)); }
    if (!a) {
      let legal: Action[] = [];
      try { legal = getLegalActions(g, p); } catch (e) { return fail(g, 'legal-throw', (e as Error).message); }
      if (!legal.length) {
        // engine enumeration gap (MS-5): search the decision's own option space for an answer its validator accepts
        const fb = fallbackAnswer(g, d);
        if (!fb) return fail(g, 'no-legal-actions', `no legal actions for pending ${d.kind}`);
        enumGaps.push({ turn: g.turn, kind: d.kind, prompt: d.prompt.slice(0, 80), step: actions.length });
        a = fb;
      } else a = legal[0];
    }
    if (banned.has(JSON.stringify(a))) {
      const legal = getLegalActions(g, p).filter(x => !banned.has(JSON.stringify(x)));
      a = legal.find(x => x.type === 'endTurn' || x.type === 'pass') ?? legal[0] ?? a;
    }
    const err = validateAction(g, a);
    if (err) {
      const legal = getLegalActions(g, p);
      const alt = legal.find(x => validateAction(g, x) === null && !banned.has(JSON.stringify(x)));
      if (!alt) return fail(g, 'no-valid-action', `no enumerated action validates for ${d.kind}: ${err}`);
      a = alt;
    }
    try {
      const r = applyAction(g, a); actions.push(a);
      const rb = r.events.find(e => e.type === 'rollback');
      if (rb) { banned.add(JSON.stringify(a)); const ob = (a as { obj?: string }).obj; rollbacks.push({ turn: g.turn, card: ob && g.objects[ob] ? g.cards[g.objects[ob].cardId]?.name : undefined, reason: String(rb.reason) }); }
      g = r.state;
    }
    catch (e) { actions.push(a); return fail(g, 'apply-throw', ((e as Error).message ?? String(e)) + ' @ ' + ((e as Error).stack ?? '').split('\n').slice(1, 3).join(' ').trim()); }
    if (every && actions.length % every === 0) {
      let inv: string[];
      try { inv = checkInvariants(g); } catch (e) { return fail(g, 'invariant-throw', (e as Error).message); }
      if (inv.length) return fail(g, 'invariant', inv[0]);
    }
  }
  return { winner: g.winner, status: 'ok', turns: g.turn, actions: actions.length, ms: performance.now() - t0, points: g.players.map(p => p.points), firstPlayer: g.firstPlayer, rollbacks, enumGaps,
    aiStats: ais.map(a => a ? { ...a.stats } : { decisions: 0, searched: 0, nodes: 0, errors: 0, ms: 0 }), metrics: run.metrics ? seatMetrics(g, runesAt) : undefined };
}

/** AI-CORE: mechanic counts per seat from the game log (plays by card, legend activations, hides, tokens, equips, runes). */
function seatMetrics(g: GameState, runesAt: number[][]): SeatMetrics[] {
  return g.players.map(pl => {
    const m: SeatMetrics = { plays: {}, legendUses: 0, hides: 0, playedFromHidden: 0, tokens: {}, equips: 0, runesByTurn: [], points: pl.points, cardsDrawn: 0 };
    const legendName = g.cards[g.objects[pl.legend]?.cardId]?.name ?? '?';
    const me = pl.name + ' ';
    for (const e of g.log) {
      if (!e.text.startsWith(me)) continue;
      const t = e.text.slice(me.length);
      let r: RegExpExecArray | null;
      if ((r = /^plays (.+?)( to | from |$| \()/.exec(t))) { m.plays[r[1]] = (m.plays[r[1]] ?? 0) + 1; if (/ from hiding/.test(t)) m.playedFromHidden++; }
      else if (t.startsWith(`uses ${legendName}`)) m.legendUses++;
      else if (t.startsWith('hides a card')) m.hides++;
      else if ((r = /^creates a (.+?) token/.exec(t))) m.tokens[r[1]] = (m.tokens[r[1]] ?? 0) + 1;
      else if ((r = /^draws (\d+)/.exec(t))) m.cardsDrawn += +r[1];
    }
    // runes at the start of each of this player's turns (index = own turn number - 1)
    m.runesByTurn = runesAt.filter((_, i) => (i % g.players.length) === ((pl.id - g.firstPlayer + g.players.length) % g.players.length)).map(x => x[pl.id]);
    for (const e of g.log) if (e.player === pl.id && / is attached to /.test(e.text)) m.equips++;
    return m;
  });
}

/** Brute-force a valid 'choose' answer (sizes min..max, at most 5000 validator calls). */
function fallbackAnswer(g: GameState, d: NonNullable<GameState['pending']>): Action | null {
  const ids = (d.options ?? []).map(o => o.id);
  const min = d.min ?? 1, max = Math.min(d.max ?? 1, ids.length);
  let budget = 5000;
  const pick: string[] = [];
  let found: Action | null = null;
  const rec = (start: number, k: number): void => {
    if (found || budget <= 0) return;
    if (pick.length === k) { budget--; const a: Action = { type: 'choose', player: d.player, optionIds: [...pick] }; if (validateAction(g, a) === null) found = a; return; }
    for (let i = start; i < ids.length && !found && budget > 0; i++) { pick.push(ids[i]); rec(i + 1, k); pick.pop(); }
  };
  for (let k = Math.max(0, min); k <= max && !found; k++) rec(0, k);
  return found;
}

/** Wilson score interval for k successes out of n (95% by default). */
export function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const ph = k / n, d = 1 + z * z / n;
  const c = ph + z * z / (2 * n), r = z * Math.sqrt(ph * (1 - ph) / n + z * z / (4 * n * n));
  return [Math.max(0, (c - r) / d), Math.min(1, (c + r) / d)];
}

// ---------------------------------------------------------------- parallel runner

import { Worker } from 'node:worker_threads';

/** Run jobs on `workers` worker threads; calls onResult as games finish. Results are returned in job order. */
export async function runParallel<J extends GameRun>(jobs: J[], workers: number, onResult?: (job: J, out: GameOutcome, done: number) => void): Promise<GameOutcome[]> {
  const results: GameOutcome[] = new Array(jobs.length);
  if (!jobs.length) return results;
  if (workers <= 0) {
    // in-process (sequential): lets callers measure process CPU time per game
    for (let i = 0; i < jobs.length; i++) {
      const out = playGame(jobs[i]);
      results[i] = out; onResult?.(jobs[i], out, i + 1);
    }
    return results;
  }
  let next = 0, done = 0;
  const file = join(ROOT, 'tools/sim-worker.ts');
  await new Promise<void>((resolve, reject) => {
    const n = Math.max(1, Math.min(workers, jobs.length));
    let live = n;
    for (let w = 0; w < n; w++) {
      const wk = new Worker(file, { execArgv: ['--import', 'tsx'] });
      const feed = () => { if (next < jobs.length) { const id = next++; wk.postMessage({ id, run: jobs[id] }); } else { wk.postMessage('stop'); } };
      wk.on('message', (m: { id: number; out: GameOutcome }) => { results[m.id] = m.out; done++; onResult?.(jobs[m.id], m.out, done); feed(); });
      wk.on('error', e => reject(e));
      wk.on('exit', () => { if (--live === 0) resolve(); });
      feed();
    }
  });
  return results;
}

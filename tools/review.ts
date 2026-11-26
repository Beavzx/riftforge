// COACH: move-by-move game review.
//
//   node --import tsx tools/review.ts game.json [--player 0] [--budget low|medium|high] [--top 5] [--out review]
//   node --import tsx tools/review.ts --sim 42 [--decks 01-azir.json,02-vex.json] [--you bot|ai] [--opp ai|bot] ...
//
// Input: a game record (src/net/record.ts, exported from the game menu: "Export game record (for review)"). Also
// accepted: tools/fuzz repro files ({ spec, actions }) and { seed, decks, actions } objects (decks = DeckLists or
// data/meta-decks file names). --sim plays a fresh game (default: heuristic bot as "you" vs SearchAI) and reviews it.
//
// The game is replayed exactly (the engine is deterministic). At each decision of the reviewed player with more than
// one real option, src/ai/coach/analyse.ts scores the candidates (always including the move that was played); the
// cost of a move = estimated win probability of the best candidate minus that of the move played. Writes
// <out>.json (everything) and <out>.md (a summary meant to be read, or pasted into a chat with Claude).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createGame, applyAction, getLegalActions } from '../src/engine/index.ts';
import type { Action, DeckList, GameSetup, GameState, PlayerId } from '../src/engine/types.ts';
import { SearchAI, fastPolicy } from '../src/ai/index.ts';
import { analyse, handReads, calibration, type Analysis, type AnalyseOptions, type HandReads } from '../src/ai/coach/index.ts';
import { isMana } from '../src/ai/core/policy.ts';
import { RECORD_FORMAT, newRecord, finishRecord, type GameRecord } from '../src/net/record.ts';
import { cardDb, ROOT } from './sim-lib.ts';

export const BUDGETS: Record<string, AnalyseOptions> = {
  low: { determinizations: 1, contNodes: 30, maxCandidates: 6, handSamples: 0, pvOpponentSteps: 4 },
  medium: { determinizations: 2, contNodes: 50, maxCandidates: 8, handSamples: 0, pvOpponentSteps: 6 },
  high: { determinizations: 4, contNodes: 120, maxCandidates: 12, handSamples: 0, pvOpponentSteps: 8 },
};
const HAND_SAMPLES: Record<string, number> = { low: 100, medium: 200, high: 400 };

function loadDeckFile(name: string): DeckList {
  return JSON.parse(readFileSync(join(ROOT, 'data/meta-decks', name), 'utf8')).deck as DeckList;
}

/** Accept a GameRecord, a fuzz repro, or { seed, decks, actions }. */
export function normalizeRecord(x: unknown): GameRecord {
  const o = x as Record<string, unknown>;
  if (o.format === RECORD_FORMAT) return o as unknown as GameRecord;
  const spec = (o.spec ?? o) as Record<string, unknown>;
  const actions = (o.actions ?? spec.actions) as Action[] | undefined;
  if (typeof spec.seed !== 'number' || !Array.isArray(spec.decks) || !Array.isArray(actions)) throw new Error('not a game record: need { format: "riftforge-game/1", setup, actions } or { seed, decks, actions }');
  const decks = (spec.decks as (DeckList | string)[]).map(d => typeof d === 'string' ? loadDeckFile(d.endsWith('.json') ? d : `${d}.json`) : d);
  const setup: Omit<GameSetup, 'cardDb'> = {
    seed: spec.seed, players: decks.map((deck, i) => ({ name: `P${i}`, deck })),
    battlefieldSelection: (spec.battlefieldSelection as 'random' | 'choose' | undefined) ?? 'random',
    firstPlayer: (spec.firstPlayer as PlayerId | undefined) ?? 0, enforceBanlist: false,
    ...(spec.manualPay ? { manualPay: spec.manualPay as boolean[] } : {}),
    ...(spec.validateDecks !== undefined ? { validateDecks: spec.validateDecks as boolean } : {}),
  };
  return { format: RECORD_FORMAT, setup, actions, source: 'sim' };
}

/** Play a fresh game for --sim and return its record. */
export function simulate(seed: number, decks: [string, string], you: 'bot' | 'ai', opp: 'bot' | 'ai'): GameRecord {
  const setup: GameSetup = { seed, cardDb: cardDb(), battlefieldSelection: 'random', firstPlayer: 0, enforceBanlist: false,
    players: [{ name: `You (${decks[0].replace(/^\d+-|\.json$/g, '')})`, deck: loadDeckFile(decks[0]) }, { name: `Opponent (${decks[1].replace(/^\d+-|\.json$/g, '')})`, deck: loadDeckFile(decks[1]) }] };
  let g = createGame(setup);
  const rec = newRecord(setup, 'sim', 0);
  const pol = [you, opp].map((k, i) => k === 'ai' ? new SearchAI({ seed: seed * 2 + i + 1 }) : null);
  for (let i = 0; i < 4000 && g.winner === null && g.turn <= 40; i++) {
    const p = g.pending!.player;
    let a = pol[p] ? pol[p]!.choose(g, p) : fastPolicy(g, p);
    if (!a) { const legal = getLegalActions(g, p); a = legal.find(x => x.type === 'pass' || x.type === 'endTurn') ?? legal[0]; }
    g = applyAction(g, a!).state;
    rec.actions.push(a!);
  }
  return finishRecord(rec, g);
}

export interface ReviewedDecision {
  index: number; turn: number; kind: string; prompt: string;
  played: { label: string; winProb: number; score: number } | null;
  best: { label: string; winProb: number; score: number } | null;
  /** best.winProb - played.winProb (0 when the played move is the best) */
  cost: number;
  winProbBefore: number;
  candidates: { label: string; winProb: number; score: number; spread: number; played?: boolean; invalid?: boolean }[];
  situation: string;
  expectedLine: { by: string; label: string; turn: number }[];
  handReads?: HandReads | null;
  note?: string;
}

export interface Review {
  game: { names: string[]; legends: string[]; winner: PlayerId | null; turns: number; points: number[]; player: PlayerId; actions: number };
  settings: { budget: string; options: AnalyseOptions; calibration: { a: number; b: number; heldOutLogLoss?: number; baselineLogLoss?: number } };
  stats: { analysed: number; skipped: number; best: number; averageCost: number; costOver5: number; costOver10: number; ms: number };
  decisions: ReviewedDecision[];
  mistakes: ReviewedDecision[];
  winProbByTurn: { turn: number; winProb: number }[];
}

export function review(rec: GameRecord, player: PlayerId, budget = 'medium', top = 5, log: (s: string) => void = () => {}): Review {
  const t0 = performance.now();
  const opts = { ...(BUDGETS[budget] ?? BUDGETS.medium) };
  let g: GameState = createGame({ ...rec.setup, cardDb: cardDb() } as GameSetup);
  const legendOf = (p: number) => g.cards[g.objects[g.players[p].legend]?.cardId]?.name ?? '?';
  const legends = g.players.map((_, i) => legendOf(i));
  const decisions: ReviewedDecision[] = [];
  const states = new Map<number, GameState>();
  const winByTurn = new Map<number, number>();
  let skipped = 0;
  for (let i = 0; i < rec.actions.length; i++) {
    const a = rec.actions[i];
    const d = g.pending;
    if (d && d.player === player && g.winner === null && a.player === player && a.type !== 'concede' && a.type !== 'cancel' && !isMana(a) && d.kind !== 'payment') {
      const legal = getLegalActions(g, player).filter(x => x.type !== 'cancel' && x.type !== 'concede' && !isMana(x));
      if (legal.length > 1 || (legal.length === 1 && JSON.stringify(legal[0]) !== JSON.stringify(a))) {
        const an: Analysis = analyse(g, player, { ...opts, include: [a], seed: 1000 + i });
        if (!an.trivial) {
          const played = an.candidates.find(c => c.included) ?? null;
          const best = an.best;
          const cost = played && best && !played.invalid ? Math.max(0, best.winProb - played.winProb) : 0;
          if (!d.inStep && d.kind === 'mainAction' && !winByTurn.has(g.turn)) winByTurn.set(g.turn, an.winProbNow);
          decisions.push({
            index: i, turn: g.turn, kind: d.kind, prompt: d.prompt,
            played: played ? { label: played.label, winProb: played.winProb, score: played.score } : null,
            best: best ? { label: best.label, winProb: best.winProb, score: best.score } : null,
            cost, winProbBefore: an.winProbNow,
            candidates: an.candidates.map(c => ({ label: c.label, winProb: c.winProb, score: c.score, spread: c.spread, ...(c.included ? { played: true } : {}), ...(c.invalid ? { invalid: true } : {}) })),
            situation: an.situation, expectedLine: an.expectedLine,
            ...(played ? {} : { note: 'the move played could not be scored (engine refused it in the sampled worlds)' }),
          });
          states.set(i, g);
          log(`[review] action ${i}/${rec.actions.length} turn ${g.turn} ${d.kind}: cost ${(100 * cost).toFixed(1)}% (${an.ms.toFixed(0)} ms)`);
        } else skipped++;
      }
    }
    try { g = applyAction(g, a).state; } catch (e) { throw new Error(`record does not replay: action ${i} (${JSON.stringify(a)}) was refused: ${(e as Error).message}`); }
  }
  // the top mistakes get a hand read (the opponent's possible hand at that moment)
  const mistakes = decisions.filter(d => d.cost > 0.005).sort((x, y) => y.cost - x.cost).slice(0, top);
  for (const m of mistakes) { const st = states.get(m.index); if (st) m.handReads = handReads(st, player, HAND_SAMPLES[budget] ?? 200, 7 + m.index); }
  const c = calibration() as { a: number; b: number; heldOut?: { logLoss?: number; baselineLogLoss?: number } };
  const costs = decisions.map(d => d.cost);
  return {
    game: { names: rec.names ?? rec.setup.players.map(p => p.name), legends, winner: g.winner as PlayerId | null, turns: g.turn, points: g.players.map(p => p.points), player, actions: rec.actions.length },
    settings: { budget, options: opts, calibration: { a: c.a, b: c.b, heldOutLogLoss: c.heldOut?.logLoss, baselineLogLoss: c.heldOut?.baselineLogLoss } },
    stats: {
      analysed: decisions.length, skipped, best: decisions.filter(d => d.cost <= 0.005).length,
      averageCost: costs.length ? costs.reduce((s, v) => s + v, 0) / costs.length : 0,
      costOver5: costs.filter(x => x > 0.05).length, costOver10: costs.filter(x => x > 0.10).length, ms: performance.now() - t0,
    },
    decisions, mistakes,
    winProbByTurn: [...winByTurn.entries()].sort((x, y) => x[0] - y[0]).map(([turn, winProb]) => ({ turn, winProb })),
  };
}

const pct = (x: number) => `${(100 * x).toFixed(0)}%`;
const pct1 = (x: number) => `${(100 * x).toFixed(1)}%`;

export function toMarkdown(r: Review): string {
  const P = r.game.player, Q = 1 - P;
  const you = r.game.names[P] ?? `P${P}`, opp = r.game.names[Q] ?? `P${Q}`;
  const res = r.game.winner === null ? 'no result' : r.game.winner === P ? 'you won' : 'you lost';
  const L: string[] = [];
  L.push(`# Game review: ${you} (${r.game.legends[P]}) vs ${opp} (${r.game.legends[Q]})`);
  L.push('');
  L.push(`Result: ${res}, ${r.game.points[P]}-${r.game.points[Q]} on turn ${r.game.turns}. Reviewed from ${you}'s side, ${r.stats.analysed} decisions analysed (budget "${r.settings.budget}", ${(r.stats.ms / 1000).toFixed(0)} s).`);
  L.push('');
  L.push(`Win chances are the bot's estimate: a hand-tuned evaluation mapped to a probability by a logistic fit on bot-vs-bot games. Treat gaps under ~3% as noise and the opponent's cards in an "expected line" as guesses (sampled from their decklist).`);
  L.push('');
  L.push('## Overview');
  L.push('');
  L.push(`- Moves matching the bot's top choice: ${r.stats.best}/${r.stats.analysed}`);
  L.push(`- Average estimated cost per decision: ${pct1(r.stats.averageCost)}`);
  L.push(`- Decisions costing more than 5%: ${r.stats.costOver5}; more than 10%: ${r.stats.costOver10}`);
  if (r.winProbByTurn.length) {
    L.push('');
    L.push(`Estimated win chance at the start of your turns: ${r.winProbByTurn.map(x => `T${x.turn} ${pct(x.winProb)}`).join(', ')}`);
  }
  L.push('');
  L.push('## Biggest mistakes');
  if (!r.mistakes.length) L.push('', 'None found above 0.5%: every move matched (or nearly matched) the bot\'s choice.');
  r.mistakes.forEach((m, k) => {
    L.push('');
    L.push(`### ${k + 1}. Turn ${m.turn}, ${m.kind}${m.prompt ? `: "${m.prompt}"` : ''} (cost ${pct1(m.cost)})`);
    L.push('');
    L.push('Situation:');
    L.push('```');
    L.push(m.situation);
    L.push('```');
    L.push(`- You played: **${m.played?.label ?? '?'}** (estimated win chance ${m.played ? pct(m.played.winProb) : '?'})`);
    L.push(`- Bot preferred: **${m.best?.label ?? '?'}** (${m.best ? pct(m.best.winProb) : '?'})`);
    const others = m.candidates.filter(c => !c.invalid).slice(0, 6);
    if (others.length > 2) {
      L.push('- All options considered:');
      for (const c of others) L.push(`  - ${pct(c.winProb)} ${c.label}${c.played ? ' (played)' : ''}`);
    }
    if (m.expectedLine.length) {
      L.push('- Bot\'s expected line after its move:');
      for (const s of m.expectedLine.slice(0, 12)) L.push(`  - T${s.turn} ${s.by === 'you' ? 'you' : 'opp'}: ${s.label}`);
    }
    if (m.handReads) {
      const cats = m.handReads.categories.filter(c => c.pAtLeastOne > 0.05).map(c => `${c.category} ${pct(c.pAtLeastOne)}`).join(', ');
      const cards = m.handReads.cards.slice(0, 5).map(c => `${c.name} ${pct(c.pAtLeastOne)}`).join(', ');
      L.push(`- Opponent's ${m.handReads.handSize}-card hand (from their decklist): ${cats || 'no tracked categories'}. Most likely cards: ${cards || 'n/a'}.`);
    }
  });
  L.push('');
  L.push('## All analysed decisions');
  L.push('');
  L.push('| Turn | Decision | You played | Bot preferred | Cost |');
  L.push('|---|---|---|---|---|');
  for (const d of r.decisions) {
    const same = d.cost <= 0.005;
    L.push(`| ${d.turn} | ${d.kind} | ${(d.played?.label ?? '?').replace(/\|/g, '/')} | ${same ? '(same)' : (d.best?.label ?? '?').replace(/\|/g, '/')} | ${same ? '' : pct1(d.cost)} |`);
  }
  L.push('');
  L.push('## Talking it through');
  L.push('');
  L.push('Paste this file (or one mistake section) into a chat with Claude and ask, for example: "Why is the bot\'s move better here?", "What was I missing about their hand?", or "Is there a pattern in my mistakes?".');
  return L.join('\n') + '\n';
}

function main() {
  const args = process.argv.slice(2);
  const arg = (k: string, d?: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
  const budget = arg('budget', 'medium')!;
  if (!BUDGETS[budget]) throw new Error(`--budget must be one of ${Object.keys(BUDGETS).join(', ')}`);
  const top = Number(arg('top', '5'));
  let rec: GameRecord;
  const sim = arg('sim');
  if (sim !== undefined) {
    const decks = (arg('decks', '01-azir.json,02-vex.json')!).split(',') as [string, string];
    rec = simulate(Number(sim), decks, (arg('you', 'bot') as 'bot' | 'ai'), (arg('opp', 'ai') as 'bot' | 'ai'));
    const save = arg('save-record');
    if (save) writeFileSync(save, JSON.stringify(rec));
  } else {
    const file = args.find(a => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'));
    if (!file) { console.error('usage: tools/review.ts <game.json> [--player 0|1] [--budget low|medium|high] [--top 5] [--out review]  |  --sim <seed> [--decks a.json,b.json]'); process.exit(2); }
    rec = normalizeRecord(JSON.parse(readFileSync(file, 'utf8')));
  }
  const player = Number(arg('player', String(rec.you ?? 0))) as PlayerId;
  const out = arg('out', 'review')!;
  const r = review(rec, player, budget, top, s => console.error(s));
  writeFileSync(`${out}.json`, JSON.stringify(r, null, 1));
  writeFileSync(`${out}.md`, toMarkdown(r));
  console.log(`wrote ${out}.json and ${out}.md: ${r.stats.analysed} decisions, ${r.mistakes.length} mistakes listed, ${(r.stats.ms / 1000).toFixed(0)} s`);
}

if (process.argv[1]?.endsWith('review.ts')) main();

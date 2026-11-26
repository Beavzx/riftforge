// COACH: explain a decision. For the pending decision of player p, score EVERY sensible candidate the same way the
// search AI does (src/ai/search.ts + src/ai/core/planner.ts), but keep the whole ranking instead of only the winner:
//  - each candidate is applied in K determinized worlds (src/ai/determinize.ts: hidden cards resampled from the known
//    decklist minus seen cards), settled to the next quiet point (bot answers for both sides' response windows) and,
//    when it is still p's own main phase, followed by a turn plan (planTurn) that finds the best continuation;
//  - the score is the planner's "end the turn here" evaluation (src/ai/eval.ts), averaged over the K worlds (the
//    same worlds for every candidate, so differences are not dominated by sampling noise), and mapped to a win
//    probability with the logistic calibration (src/ai/coach/winprob.ts);
//  - the expected line replays the best candidate's continuation in the first world, then lets the heuristic bot play
//    the opponent's next turn (the opponent's cards there are SAMPLED, not known);
//  - hand reads aggregate many determinizations (src/ai/coach/handreads.ts).
// analyse() never mutates its input and never touches a SearchAI instance, so it does not change how the AI plays.
import type { Action, Decision, GameState, PlayerId } from '../../engine/types.ts';
import { applyAction, getLegalActions, validateAction } from '../../engine/index.ts';
import { makeRng } from '../../engine/rng.ts';
import { determinize } from '../determinize.ts';
import { evaluate, DEFAULT_WEIGHTS, WIN, type EvalWeights } from '../eval.ts';
import { planFor } from '../plans/index.ts';
import type { DeckPlan } from '../plans/types.ts';
import { makeCtx } from '../core/ctx.ts';
import { stateSig } from '../core/hash.ts';
import { planTurn, PLANNER_DEFAULTS, type PlannerOpts } from '../core/planner.ts';
import { mainCandidates, topMain, inStepCandidates, settle, fastPolicy, isMana, keyOf, improvePayment, type Budget } from '../core/policy.ts';
import { labelAction, describeSituation } from './labels.ts';
import { handReads, type HandReads } from './handreads.ts';
import { winProb } from './winprob.ts';

export interface AnalyseOptions {
  /** determinized worlds per candidate (default 2) */
  determinizations?: number;
  /** engine-step budget of the continuation turn plan per candidate per world (default 50) */
  contNodes?: number;
  /** max settle steps after a candidate (default 40) */
  settleCap?: number;
  /** candidates scored (default 8; the moves in `include` are always added) */
  maxCandidates?: number;
  /** actions that must be scored even if the candidate filter would drop them (e.g. the move actually played) */
  include?: Action[];
  /** determinizations for the hand read (default 200; 0 = skip) */
  handSamples?: number;
  /** opponent actions shown in the expected line (default 6) */
  pvOpponentSteps?: number;
  seed?: number;
  weights?: Partial<EvalWeights>;
  usePlans?: boolean;
}

export interface CandidateResult {
  action: Action;
  label: string;
  /** mean evaluation over the worlds (eval units, higher = better for p) */
  score: number;
  /** calibrated win probability for p */
  winProb: number;
  /** standard deviation of the score over the worlds */
  spread: number;
  /** per-world scores */
  worlds: number[];
  /** engine steps spent on this candidate (all worlds) */
  nodes: number;
  /** this is (one of) the action(s) passed in `include` */
  included?: boolean;
  /** the engine refused the line in every world (unpayable, undone): not a real option */
  invalid?: boolean;
}

export interface LineStep { by: 'you' | 'opponent'; label: string; turn: number }

export interface Analysis {
  player: PlayerId;
  turn: number;
  decision: { kind: string; prompt: string; inStep: boolean };
  /** readable position summary from p's point of view */
  situation: string;
  /** evaluation and win probability of the position as it stands */
  evalNow: number;
  winProbNow: number;
  /** ranked, best first */
  candidates: CandidateResult[];
  best: CandidateResult | null;
  /** best candidate's expected continuation in the first world (opponent cards there are sampled) */
  expectedLine: LineStep[];
  handReads: HandReads | null;
  /** nothing to analyse (no or one option, payment-only decision...) */
  trivial: boolean;
  nodes: number;
  ms: number;
}

const DEFAULTS = { determinizations: 2, contNodes: 50, settleCap: 40, maxCandidates: 8, handSamples: 200, pvOpponentSteps: 6, seed: 1, usePlans: true };

/** A key that ignores the payment plan and object identity of identical copies (same card, same zone). */
export function looseKey(g: GameState, a: Action): string {
  const cid = (id: string) => { const o = g.objects[id]; return o ? `${o.cardId}@${o.zone}${o.battlefieldIndex ?? ''}` : id; };
  switch (a.type) {
    case 'playCard': return `play|${cid(a.obj)}|${a.destination ?? ''}|${a.mode ?? ''}|${a.x ?? ''}|${a.hidden ? 1 : 0}`;
    case 'activate': return `act|${cid(a.obj)}|${a.abilityIndex}|${g.objects[a.obj]?.exhausted ? 1 : 0}`;
    case 'hide': return `hide|${cid(a.obj)}|${a.battlefieldIndex}`;
    case 'move': return `move|${[...a.units].sort().join(',')}|${a.to}`;
    case 'choose': return `choose|${[...a.optionIds].sort().join(',')}`;
    case 'assignDamage': return `dmg|${JSON.stringify(Object.entries(a.assignment).filter(([, n]) => n > 0).sort())}`;
    default: return a.type;
  }
}

function candidatesFor(g: GameState, p: PlayerId, d: Decision, legal: Action[], k: number, plan: DeckPlan | null): Action[] {
  const ctx = plan ? makeCtx(g, p) : null;
  if (!d.inStep && d.kind === 'mainAction') {
    const cands = mainCandidates(g, p, legal, plan, ctx);
    const top = topMain(cands, Math.max(1, k - 1)).map(c => c.a);
    const end = legal.find(a => a.type === 'endTurn');
    return [...top, ...(end ? [end] : [])];
  }
  if (d.inStep) return inStepCandidates(g, d, legal, k, plan, ctx);
  // response windows: pass + the plays (payment improved like the search AI does), cheapest copies deduplicated
  const seen = new Set<string>();
  const out: Action[] = [];
  const pass = legal.find(a => a.type === 'pass');
  if (pass) { out.push(pass); seen.add(looseKey(g, pass)); }
  for (const a0 of legal) {
    if (a0.type === 'pass' || isMana(a0)) continue;
    const key = looseKey(g, a0);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a0.type === 'playCard' || a0.type === 'activate' ? improvePayment(g, p, a0) : a0);
    if (out.length >= k) break;
  }
  return out;
}

interface Step { sig?: string; a: Action }
interface WorldScore { v: number; nodes: number; invalid: boolean; steps: Step[] }

function scoreInWorld(det: GameState, a: Action, p: PlayerId, plan: DeckPlan | null, w: EvalWeights, po: PlannerOpts, o: typeof DEFAULTS): WorldScore {
  const d = det.pending!;
  const budget: Budget = { nodes: 1e9 };
  const start = budget.nodes;
  const sigOf = (g: GameState) => stateSig(g, p);
  // "end the turn here": the planner scores the state before ending (src/ai/core/planner.ts root node)
  if (a.type === 'endTurn' && !d.inStep && d.kind === 'mainAction') return { v: evaluate(det, p, w, { plan }), nodes: 0, invalid: false, steps: [{ a }] };
  let g: GameState;
  try {
    let r = applyAction(det, a); budget.nodes--;
    if (r.events.some(e => e.type === 'rollback') && (a.type === 'playCard' || a.type === 'hide' || a.type === 'activate') && a.payment) {
      r = applyAction(det, { ...a, payment: undefined } as Action); budget.nodes--;   // refused explicit payment: auto-pay
    }
    if (r.events.some(e => e.type === 'rollback')) return { v: -WIN, nodes: start - budget.nodes, invalid: true, steps: [] };
    g = r.state;
  } catch { return { v: -WIN, nodes: start - budget.nodes, invalid: true, steps: [] }; }
  const st = settle(g, p, { cap: o.settleCap, oppResponds: true, meResponds: true, plan }, budget, sigOf);
  if (!st.ok) return { v: -WIN, nodes: start - budget.nodes, invalid: true, steps: [] };
  const steps: Step[] = [{ a }, ...st.mine];
  const g2 = st.g;
  if (g2.winner !== null) return { v: g2.winner === p ? WIN : -WIN, nodes: start - budget.nodes, invalid: false, steps };
  const pd = g2.pending;
  if (pd && !pd.inStep && pd.kind === 'mainAction' && pd.player === p) {
    const cb: Budget = { nodes: o.contNodes };
    const tp = planTurn(g2, p, plan, w, cb, po);
    budget.nodes -= o.contNodes - cb.nodes;
    return { v: tp.score, nodes: start - budget.nodes, invalid: false, steps: [...steps, ...tp.steps] };
  }
  return { v: evaluate(g2, p, w, { plan }), nodes: start - budget.nodes, invalid: false, steps };
}

/** Replay a candidate's planned steps in one world and continue into the opponent's next turn with the bot. */
function expectedLine(det: GameState, p: PlayerId, steps: Step[], oppSteps: number, unseen: Set<string>): LineStep[] {
  const out: LineStep[] = [];
  let g = det;
  const queue = steps.slice();
  let oppShown = 0;
  let seenOppTurn = det.activePlayer !== p;
  for (let i = 0; i < 300 && g.winner === null; i++) {
    const d = g.pending;
    if (!d) break;
    if (g.activePlayer !== p) seenOppTurn = true;
    // stop when our next turn begins (after the opponent's turn)
    if (i > 0 && seenOppTurn && g.activePlayer === p) break;
    let a: Action | null = null;
    if (d.player === p) {
      // follow the planned line while the world matches it (state signature), else the quick bot
      while (queue.length && !a) {
        const s = queue[0];
        if (s.sig && s.sig !== stateSig(g, p)) { queue.length = 0; break; }
        queue.shift();
        if (validateAction(g, s.a) === null) a = s.a;
      }
      a ??= fastPolicy(g, p);
    } else a = fastPolicy(g, d.player);
    if (!a) break;
    const label = labelAction(g, a, d), turn = g.turn;
    try { const r = applyAction(g, a); if (r.events.some(e => e.type === 'rollback')) break; g = r.state; } catch { break; }
    if (a.type === 'pass' || isMana(a)) continue;
    if (d.player === p) {
      // a card we only have in this sampled world (drawn from our reshuffled deck) is a guess too
      const obj = a.type === 'playCard' || a.type === 'hide' || a.type === 'activate' ? a.obj : null;
      out.push({ by: 'you', label: obj && unseen.has(obj) ? `${label} (card drawn in this sample)` : label, turn });
    }
    else { out.push({ by: 'opponent', label: label + ' (sampled)', turn }); if (++oppShown >= oppSteps) break; }
  }
  return out;
}

export function analyse(state: GameState, p: PlayerId, opts: AnalyseOptions = {}): Analysis {
  const t0 = performance.now();
  const o = { ...DEFAULTS, ...opts } as typeof DEFAULTS & AnalyseOptions;
  const w: EvalWeights = { ...DEFAULT_WEIGHTS, ...(opts.weights ?? {}) };
  const d = state.pending;
  const plan = o.usePlans ? planFor(state, p) : null;
  const evalNow = evaluate(state, p, w, { plan });
  const base: Analysis = {
    player: p, turn: state.turn, decision: { kind: d?.kind ?? 'none', prompt: d?.prompt ?? '', inStep: !!d?.inStep },
    situation: describeSituation(state, p), evalNow, winProbNow: winProb(evalNow), candidates: [], best: null, expectedLine: [],
    handReads: null, trivial: true, nodes: 0, ms: 0,
  };
  if (!d || d.player !== p || state.winner !== null) return { ...base, ms: performance.now() - t0 };
  const legal = getLegalActions(state, p).filter(a => a.type !== 'cancel' && a.type !== 'concede');
  const strategic = legal.filter(a => !isMana(a));
  const include = (o.include ?? []).filter(a => a.type !== 'cancel' && a.type !== 'concede' && validateAction(state, a) === null);
  if (strategic.length + include.filter(isMana).length <= 1 || d.kind === 'payment') {
    const only = legal[0];
    const cands = only ? [{ action: only, label: labelAction(state, only, d), score: evalNow, winProb: winProb(evalNow), spread: 0, worlds: [], nodes: 0 }] : [];
    return { ...base, candidates: cands, best: cands[0] ?? null, ms: performance.now() - t0 };
  }
  // candidate set: the AI's own candidates + the included moves (matched loosely, e.g. a different but equivalent payment)
  let cands = candidatesFor(state, p, d, legal, o.maxCandidates, plan);
  const keys = new Set(cands.map(a => looseKey(state, a)));
  const inclKeys = new Set(include.map(a => looseKey(state, a)));
  for (const a of include) if (!keys.has(looseKey(state, a))) { cands.push(a); keys.add(looseKey(state, a)); }
  cands = cands.filter((a, i) => cands.findIndex(b => keyOf(b) === keyOf(a)) === i);

  const po: PlannerOpts = { ...PLANNER_DEFAULTS, oppResponds: true, replyTop: 0 };
  const rng = makeRng(o.seed);
  const worlds: GameState[] = [];
  for (let k = 0; k < o.determinizations; k++) { try { worlds.push(determinize(state, p, rng)); } catch { /* skip */ } }
  if (!worlds.length) worlds.push(state);
  let nodes = 0;
  const firstSteps = new Map<string, Step[]>();
  const results: CandidateResult[] = cands.map(a => {
    const ws: number[] = []; let n = 0, bad = 0;
    worlds.forEach((det, k) => {
      const r = scoreInWorld(det, a, p, plan, w, po, o);
      n += r.nodes; if (r.invalid) bad++; else ws.push(r.v);
      if (k === 0) firstSteps.set(keyOf(a), r.steps);
    });
    nodes += n;
    const mean = ws.length ? ws.reduce((s, v) => s + v, 0) / ws.length : -WIN;
    const sd = ws.length > 1 ? Math.sqrt(ws.reduce((s, v) => s + (v - mean) ** 2, 0) / (ws.length - 1)) : 0;
    const res: CandidateResult = { action: a, label: labelAction(state, a, d), score: mean, winProb: winProb(mean), spread: sd, worlds: ws, nodes: n };
    if (inclKeys.has(looseKey(state, a))) res.included = true;
    if (bad === worlds.length) res.invalid = true;
    return res;
  });
  results.sort((x, y) => (x.invalid ? 1 : 0) - (y.invalid ? 1 : 0) || y.score - x.score);
  const best = results.find(r => !r.invalid) ?? null;
  const unseen = new Set(state.players[p].mainDeck);
  const line = best ? expectedLine(worlds[0], p, firstSteps.get(keyOf(best.action)) ?? [{ a: best.action }], o.pvOpponentSteps, unseen) : [];
  const reads = o.handSamples > 0 ? handReads(state, p, o.handSamples, o.seed + 17) : null;
  return { ...base, candidates: results, best, expectedLine: line, handReads: reads, trivial: false, nodes, ms: performance.now() - t0 };
}

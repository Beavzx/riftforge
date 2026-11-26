// META-SIM AI / AI-CORE: the search AI. Old version (1-ply + greedy settling): src/ai/legacy/search.ts.
//
// Main phase (own turn): TURN-LEVEL PLANNING (src/ai/core/planner.ts). On a quiet main-phase decision the AI
// determinizes the state (src/ai/determinize.ts: the opponent's hidden cards are resampled from their public decklist
// minus seen cards, own deck order and RNG resampled) and beam-searches over sequences of its own actions (each settled
// to the next quiet point; deck-plan combo lines as macro-moves; transpositions merged), scoring every reachable
// "end the turn here" state with the evaluation (src/ai/eval.ts) + deck-plan adjustments. The best line (with the AI's
// own in-step answers) is cached and replayed while the real game matches the prediction (state signatures); any
// deviation (an opponent response, a draw, a random effect) triggers a re-plan, within a per-turn node budget.
// Response windows (chain / showdown, also on the opponent's turn): pass vs the best few responses, each settled and
// evaluated. In-step decisions not covered by the line: plan targeting + a small search.
// Deck plans (src/ai/plans, docs/ai-plans.md) are looked up by legend; everything is bounded by engine-step budgets, so
// runs are deterministic for a given seed (no wall-clock cutoffs unless `maxMs` is set).
import type { Action, Decision, GameState, PlayerId } from '../engine/types.ts';
import { applyAction, getLegalActions, validateAction } from '../engine/index.ts';
import { makeRng } from '../engine/rng.ts';
import { determinize } from './determinize.ts';
import { evaluate, DEFAULT_WEIGHTS, WIN, setEvalOverride, type EvalWeights } from './eval.ts';
import { evaluate as legacyEvaluate } from './legacy/eval.ts';
import { planFor } from './plans/index.ts';
import type { DeckPlan } from './plans/types.ts';
import { makeCtx } from './core/ctx.ts';
import { stateSig } from './core/hash.ts';
import { planTurn, PLANNER_DEFAULTS, describe, type PlannerOpts, type PlanStep } from './core/planner.ts';
import { improvePayment, fastPolicy, mulliganChoice, inStepCandidates, quickInStep, settle, actingCard, cost, keyOf, isMana, type Budget } from './core/policy.ts';

export { fastPolicy };

export interface SearchOptions {
  /** (legacy option, unused by the turn planner) */
  maxCandidates?: number;
  /** engine steps budget per searched non-main decision (responses, in-step choices) */
  maxNodes?: number;
  /** max settle steps per candidate */
  settleCap?: number;
  /** (legacy) determinizations per decision */
  samples?: number;
  /** optional wall-clock cap per decision (makes runs timing-dependent; off by default) */
  maxMs?: number;
  weights?: Partial<EvalWeights>;
  seed?: number;
  /** max candidates for in-step decisions (targets, cards, damage, ...) */
  inStepCandidates?: number;
  /** max candidates in chain/showdown response windows (pass + the best plays) */
  responseCandidates?: number;
  /** while settling, let the heuristic bot answer the opponent's chain/showdown windows */
  respondInSettle?: boolean;
  /** engine-step budget of the first turn plan / of a re-plan / of the whole turn */
  turnNodes?: number;
  replanNodes?: number;
  turnBudget?: number;
  /** turn planner options (beam, depth, candidates, light reply, ...) */
  planner?: Partial<PlannerOpts>;
  /** use the deck plans (default true) */
  usePlans?: boolean;
  /** replay the cached turn line while the game follows it (default true; false = re-plan at every main decision) */
  replay?: boolean;
  /** experiments: use the legacy evaluation (src/ai/legacy/eval.ts) instead of the new one */
  legacyEval?: boolean;
}

export interface SearchStats {
  decisions: number; searched: number; nodes: number; errors: number; ms: number;
  byKind?: Record<string, [number, number, number]>;
  plans?: number; replays?: number; deviations?: number;
}

type Opts = Required<Omit<SearchOptions, 'maxMs' | 'weights' | 'seed' | 'planner'>> & SearchOptions;
const DEF: Omit<Opts, 'planner'> = {
  maxCandidates: 6, maxNodes: 30, settleCap: 12, samples: 1, inStepCandidates: 3, responseCandidates: 3, respondInSettle: true,
  turnNodes: 130, replanNodes: 60, turnBudget: 340, usePlans: true, replay: true, legacyEval: false,
};

interface Line { steps: PlanStep[]; idx: number; turn: number }

export class SearchAI {
  readonly o: Opts;
  readonly po: PlannerOpts;
  readonly w: EvalWeights;
  readonly stats: SearchStats = { decisions: 0, searched: 0, nodes: 0, errors: 0, ms: 0, plans: 0, replays: 0, deviations: 0 };
  private rng: () => number;
  private line: Line | null = null;
  private noImprove: Set<string> = new Set();
  private turnSpent = { turn: -1, nodes: 0 };
  /** debugging hook: called with every turn plan / searched decision */
  trace?: (t: { turn: number; kind: string; best: Action | null; line?: string; score?: number; cands?: { a: Action; v: number }[]; end?: number | null }) => void;
  constructor(opts: SearchOptions = {}) {
    this.o = { ...DEF, ...opts } as Opts;
    this.w = { ...DEFAULT_WEIGHTS, ...(opts.weights ?? {}) };
    this.po = { ...PLANNER_DEFAULTS, oppResponds: this.o.respondInSettle, ...(opts.planner ?? {}) };
    this.rng = makeRng(opts.seed ?? 1);
  }

  choose(state: GameState, p: PlayerId): Action | null {
    const d = state.pending;
    if (!d || d.player !== p || state.winner !== null) return null;
    const t0 = performance.now();
    this.stats.decisions++;
    if (this.o.legacyEval) setEvalOverride((g, q) => legacyEvaluate(g, q));
    try { return this.decide(state, p, d); }
    finally { this.stats.ms += performance.now() - t0; if (this.o.legacyEval) setEvalOverride(null); }
  }

  private plan(g: GameState, p: PlayerId): DeckPlan | null { return this.o.usePlans ? planFor(g, p) : null; }

  /** the cached line's answer for this exact (visible) state, if the game still follows the line */
  private follow(g: GameState, p: PlayerId): Action | null {
    const L = this.line;
    if (!L || !this.o.replay || L.turn !== g.turn || L.idx >= L.steps.length) return null;
    const sig = stateSig(g, p);
    const undone = (g.ex.memo?.__rolledBack as string[] | undefined) ?? [];
    for (let j = L.idx; j < Math.min(L.steps.length, L.idx + 3); j++) {
      if (L.steps[j].sig !== sig) continue;
      const a = L.steps[j].a;
      if (validateAction(g, a) !== null || undone.includes(JSON.stringify(a))) break;
      L.idx = j + 1;
      this.stats.replays!++;
      return a;
    }
    this.stats.deviations!++;
    this.line = null;
    return null;
  }

  private decide(g: GameState, p: PlayerId, d: Decision): Action | null {
    const all = getLegalActions(g, p).filter(a => a.type !== 'cancel');
    if (all.length === 0) return null;
    // never re-pick an action the engine just undone (the state is unchanged, so a deterministic pick would loop)
    const undone = new Set((g.ex.memo?.__rolledBack as string[] | undefined) ?? []);
    const undoneObjs = new Set([...undone].map(x => { try { return (JSON.parse(x) as { obj?: string }).obj; } catch { return undefined; } }).filter(Boolean));
    const legal0 = undone.size ? all.filter(a => !undone.has(JSON.stringify(a))) : all;
    const legal = legal0.length ? legal0 : all;
    this.noImprove = undoneObjs as Set<string>;
    const plan = this.plan(g, p);
    const ch = (ids: string[]): Action => ({ type: 'choose', player: p, optionIds: ids });
    if (d.inStep) {
      if (d.kind === 'payment') return ch(['auto']);
      if (d.kind === 'mulligan') { const a = ch(mulliganChoice(g, d, plan)); return validateAction(g, a) === null ? a : legal[0]; }
      const f = this.follow(g, p);
      if (f) return f;
      if (d.kind === 'chooseMode' && (d.options ?? []).some(x => x.id === 'first')) return ch(['first']);
      if (d.kind === 'chooseBattlefield' || d.kind === 'orderTriggers' || d.kind === 'chooseOrder') return fastPolicy(g, p);
      if (legal.length === 1) return legal[0];
      const ctx = plan ? makeCtx(g, p) : null;
      const k = (d.kind === 'chooseTargets' || d.kind === 'chooseCards') && (d.hint === 'harm' || d.hint === 'help') ? Math.min(2, this.o.inStepCandidates) : this.o.inStepCandidates;
      const cands = inStepCandidates(g, d, legal, k, plan, ctx);
      if (cands.length <= 1) return cands[0] ?? quickInStep(g, p, plan, ctx) ?? legal[0];
      return this.searchSimple(g, p, d, cands, plan, null);
    }
    if (d.kind === 'mainAction') return this.mainDecision(g, p, legal, plan);
    // chain / showdown response windows
    const f = this.follow(g, p);
    if (f) return f;
    if (d.kind === 'chainResponse' && g.chain.length && g.chain[g.chain.length - 1].controller === p) {
      const pass = legal.find(a => a.type === 'pass');
      if (pass) return pass;
    }
    const pass = legal.find(a => a.type === 'pass') ?? null;
    const ctx = plan?.respond ? makeCtx(g, p) : null;
    let rest = legal.filter(a => a.type !== 'pass' && !isMana(a)).map(a0 => {
      const a = this.noImprove.has((a0 as { obj?: string }).obj ?? '') ? a0 : improvePayment(g, p, a0);
      let s = a.type === 'playCard' ? cost(g, a.obj) : a.type === 'activate' ? 1 : 0;
      if (plan?.respond && ctx) { try { const r = plan.respond(a, actingCard(g, a), d, ctx); if (r !== undefined) s = r < 0 ? -1e9 : s + 10 * r; } catch { /* ignore */ } }
      return { a, s };
    }).filter(x => x.s > -1e8).sort((x, y) => y.s - x.s).map(x => x.a);
    // identical responses (two copies of a card) are evaluated once
    const seen = new Set<string>();
    rest = rest.filter(a => { const k = a.type === 'playCard' ? `${g.objects[a.obj]?.cardId}|${a.destination ?? ''}` : keyOf(a); if (seen.has(k)) return false; seen.add(k); return true; });
    if (!rest.length) return pass ?? legal[0];
    const cands = [...(pass ? [pass] : []), ...rest.slice(0, Math.max(1, this.o.responseCandidates - (pass ? 1 : 0)))];
    return this.searchSimple(g, p, d, cands, plan, pass);
  }

  // ------------------------------------------------------------ main phase: turn plans

  private mainDecision(g: GameState, p: PlayerId, legal: Action[], plan: DeckPlan | null): Action | null {
    const f = this.follow(g, p);
    if (f) return f;
    if (legal.length === 1) return legal[0];
    if (this.turnSpent.turn !== g.turn) this.turnSpent = { turn: g.turn, nodes: 0 };
    const left = this.o.turnBudget - this.turnSpent.nodes;
    const first = !this.line && this.turnSpent.nodes === 0;
    let nodes = Math.min(first ? this.o.turnNodes : this.o.replanNodes, left);
    let po = this.po;
    if (nodes < 20) { nodes = 20; po = { ...po, depth: 2, beam: 1, k0: 4, k: 3, replyTop: 0 }; }   // budget spent: cheap re-plan
    const t0 = performance.now();
    let det: GameState;
    try { det = determinize(g, p, this.rng); } catch { this.stats.errors++; return fastPolicy(g, p); }
    const budget: Budget = { nodes };
    const tp = planTurn(det, p, plan, this.w, budget, po, () => determinize(g, p, this.rng));
    const used = nodes - budget.nodes;
    this.turnSpent.nodes += used;
    this.stats.nodes += used; this.stats.searched++; this.stats.plans!++;
    const bk = (this.stats.byKind ??= {});
    const e = (bk['turnPlan'] ??= [0, 0, 0]); e[0]++; e[1] += used; e[2] += performance.now() - t0;
    this.line = { steps: tp.steps, idx: 0, turn: g.turn };
    const a = this.follow(g, p);
    if (this.trace) this.trace({ turn: g.turn, kind: 'turnPlan', best: a, line: tp.best, score: tp.score });
    if (a) return a;
    this.stats.errors++;
    return fastPolicy(g, p);
  }

  // ------------------------------------------------------------ responses / in-step: 1-ply + settle

  private searchSimple(g: GameState, p: PlayerId, d: Decision, cands: Action[], plan: DeckPlan | null, tieBreak: Action | null): Action | null {
    this.stats.searched++;
    const t0 = performance.now();
    const budget: Budget = { nodes: this.o.maxNodes };
    let det: GameState;
    try { det = determinize(g, p, this.rng); } catch { this.stats.errors++; return fastPolicy(g, p); }
    const scores: { a: Action; v: number }[] = [];
    for (const a of cands) {
      if (budget.nodes <= 0 || (this.o.maxMs && performance.now() - t0 > this.o.maxMs)) { scores.push({ a, v: -1e9 }); continue; }
      scores.push({ a, v: this.scoreOne(det, a, p, plan, budget) + (tieBreak && keyOf(a) === keyOf(tieBreak) ? 0.05 : 0) });
    }
    let best: Action | null = null, bestV = -Infinity;
    for (const s of scores) if (s.v > bestV) { bestV = s.v; best = s.a; }
    const used = this.o.maxNodes - budget.nodes;
    this.stats.nodes += used;
    const kindKey = d.kind + (d.inStep ? '*' : '');
    const bk = (this.stats.byKind ??= {});
    const e = (bk[kindKey] ??= [0, 0, 0]); e[0]++; e[1] += used; e[2] += performance.now() - t0;
    if (this.trace) this.trace({ turn: g.turn, kind: d.kind, best, cands: scores, end: null });
    if (!best || validateAction(g, best) !== null) { this.stats.errors++; return fastPolicy(g, p); }
    // a response changes the course of our own planned turn: drop the line
    if (best.type !== 'pass' && !d.inStep) this.line = null;
    return best;
  }

  private scoreOne(det: GameState, a: Action, p: PlayerId, plan: DeckPlan | null, budget: Budget): number {
    let g: GameState;
    try {
      const r = applyAction(det, a); budget.nodes--;
      if (r.events.some(e => e.type === 'rollback')) return -1e7;
      g = r.state;
    } catch { this.stats.errors++; return -1e8; }
    const st = settle(g, p, { cap: this.o.settleCap, oppResponds: this.o.respondInSettle, meResponds: true, plan }, budget, () => '');
    if (!st.ok) return -1e7;                       // the line was undone by the engine (e.g. an unpayable explicit payment)
    const v = evaluate(st.g, p, this.w, { plan });
    return v >= WIN ? WIN : v;
  }
}

/** Convenience: a stateless-looking policy function. */
export function makeSearchPolicy(opts: SearchOptions = {}): { choose: (g: GameState, p: PlayerId) => Action | null; ai: SearchAI } {
  const ai = new SearchAI(opts);
  return { choose: (g, p) => ai.choose(g, p), ai };
}

export { describe };

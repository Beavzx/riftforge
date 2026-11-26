// META-SIM AI: per-decision search.
//
// For the pending decision of player p:
//   1. determinize the state (src/ai/determinize.ts: no peeking at hidden cards / deck order / future RNG),
//   2. enumerate candidate answers (legal actions, plus kill-maximising damage assignments), pruned to K by a
//      cheap prior,
//   3. for each candidate: apply it, then "settle" the game with the fast heuristic policy (src/engine/bot.ts)
//      for every player until the next main-phase decision (chains, showdowns, combats, triggers resolved),
//   4. evaluate the settled state with src/ai/eval.ts and pick the best.
// "End turn" is evaluated statically on the current state (the evaluation is turn-neutral: it scores holds,
// board and resources as they stand at the end of our turn), so playing on is preferred only when it improves
// the position. Everything is bounded by a node budget (engine applyAction calls), so runs are deterministic
// for a given seed (no wall-clock cutoffs unless `maxMs` is set).
import type { Action, Decision, GameState, ObjId, PlayerId } from '../../engine/types.ts';
import { applyAction, getLegalActions, validateAction, chooseAction } from '../../engine/index.ts';
import { chars, isUnit } from '../../engine/chars.ts';
import { unitsAtLoc } from '../../engine/actions.ts';
import { validateAssignment, type AssignTarget } from '../../engine/showdown.ts';
import { makeRng } from '../../engine/rng.ts';
import { determinize } from './determinize.ts';
import { evaluate, unitValue, DEFAULT_WEIGHTS, WIN, type EvalWeights } from './eval.ts';

export interface SearchOptions {
  /** max candidates evaluated per decision */
  maxCandidates?: number;
  /** engine steps budget per decision (applyAction calls incl. settling) */
  maxNodes?: number;
  /** max settle steps per candidate */
  settleCap?: number;
  /** determinizations per decision (scores are averaged) */
  samples?: number;
  /** optional wall-clock cap per decision (makes runs timing-dependent; off by default) */
  maxMs?: number;
  weights?: Partial<EvalWeights>;
  seed?: number;
  /** max candidates for in-step decisions (targets, cards, damage, ...) */
  inStepCandidates?: number;
  /** max candidates in chain/showdown response windows (pass + the most expensive plays) */
  responseCandidates?: number;
  /** while settling, let the heuristic bot answer chain/showdown windows (default true; false = everyone passes: cheaper, but reaction-heavy decks never get their combat tricks in the lookahead) */
  respondInSettle?: boolean;
}

export interface SearchStats { decisions: number; searched: number; nodes: number; errors: number; ms: number; byKind?: Record<string, [number, number, number]> }

const DEF: Required<Omit<SearchOptions, 'maxMs' | 'weights' | 'seed'>> = { maxCandidates: 6, maxNodes: 40, settleCap: 12, samples: 1, inStepCandidates: 3, responseCandidates: 3, respondInSettle: true };

// ---------------------------------------------------------------- fast policy (rollouts)

/** Baseline heuristic bot with a safety net (the bot can occasionally propose an invalid answer). */
export function fastPolicy(g: GameState, pl: PlayerId): Action | null {
  let a: Action | null = null;
  try { a = chooseAction(g, pl); } catch { a = null; }
  a = fixAttachChoice(g, pl, a);
  if (a && validateAction(g, a) === null) return a;
  const legal = getLegalActions(g, pl);
  return legal.find(x => x.type === 'pass' || x.type === 'endTurn') ?? legal[0] ?? null;
}

/**
 * META-AUDIT: "choose an Equipment to attach (or none)" (Weaponmaster, CR 821). The baseline bot takes the most valuable
 * Equipment, which moves an Equipment off a unit that already wears it (often from a unit at a battlefield onto a fresh
 * token at base) and pays its [C] again for nothing. Take the best *unattached* Equipment, or none.
 */
function fixAttachChoice(g: GameState, pl: PlayerId, a: Action | null): Action | null {
  const d = g.pending;
  if (!a || !d || !d.inStep || d.player !== pl || d.kind !== 'chooseTargets' || (d.min ?? 1) !== 0 || !/Weaponmaster/i.test(d.prompt)) return a;
  const opts = (d.options ?? []).map(o => o.id).filter(id => g.objects[id]);
  const free = opts.filter(id => !g.objects[id].attachedTo).sort((x, y) => cost(g, y) - cost(g, x));
  return { type: 'choose', player: pl, optionIds: free.length ? [free[0]] : [] };
}

const isQuiet = (d: Decision | null) => !d || (!d.inStep && d.kind === 'mainAction');

// ---------------------------------------------------------------- mulligan & simple heuristics

function cost(g: GameState, id: ObjId): number {
  try { const c = chars(g, id); return (c.energy ?? 0) + (c.power ?? 0); } catch { return 0; }
}

function mulliganChoice(g: GameState, d: Decision): string[] {
  const opts = d.options ?? [];
  const max = d.max ?? 2;
  const cheap = opts.filter(o => cost(g, o.id) <= 2 && safeType(g, o.id) === 'Unit').length;
  const scored = opts.map(o => {
    const c = cost(g, o.id);
    let bad = c >= 5 ? 3 + c : c === 4 ? (cheap ? 0 : 2) : 0;
    if (safeType(g, o.id) !== 'Unit' && c >= 4) bad += 1;
    return { id: o.id, bad };
  }).filter(x => x.bad > 0).sort((a, b) => b.bad - a.bad);
  return scored.slice(0, max).map(x => x.id);
}

function safeType(g: GameState, id: ObjId): string { try { return chars(g, id).type; } catch { return '?'; } }

// ---------------------------------------------------------------- candidates

function priorMain(g: GameState, p: PlayerId, a: Action): number {
  switch (a.type) {
    case 'playCard': {
      const c = cost(g, a.obj);
      return 20 + c * 2 + (a.destination !== undefined && a.destination !== 'base' ? 1 : 0);
    }
    case 'activate': return a.abilityIndex >= 950 ? -100 : 15;
    case 'hide': return 8;
    case 'move': {
      if (a.to === 'base') return 2 - a.units.length;
      const b = g.battlefields[a.to];
      if (!b) return -50;
      if (b.scoredThisTurnBy.includes(p) && b.controller === p) return -5;
      let mine = 0, theirs = 0;
      for (const u of unitsAtLoc(g, a.to)) { const m = safeMight(g, u); if (g.objects[u].controller === p) mine += m; else theirs += m; }
      for (const u of a.units) mine += safeMight(g, u);
      const ctl = b.controller === p;
      let s = ctl ? 3 : 18;
      if (theirs === 0) s += 10 - a.units.length * 2;
      else s += mine > theirs ? 14 - a.units.length : mine === theirs ? 2 : -6 - a.units.length;
      // leaving a battlefield we control undefended is costly
      for (const u of a.units) { const from = g.objects[u]?.battlefieldIndex; if (g.objects[u]?.zone === 'battlefield' && from !== undefined && g.battlefields[from]?.controller === p) s -= 4; }
      return s;
    }
    default: return 0;
  }
}

function safeMight(g: GameState, id: ObjId): number { try { return Math.max(0, chars(g, id).might ?? 0); } catch { return 0; } }

function keyOf(a: Action): string { return JSON.stringify(a); }

function mainCandidates(g: GameState, p: PlayerId, legal: Action[], k: number): Action[] {
  const pool = legal.filter(a => a.type !== 'endTurn' && !(a.type === 'activate' && a.abilityIndex >= 950));
  // identical options (two copies of the same card to the same place) are evaluated once
  const sig = (a: Action) => a.type === 'playCard' ? `play|${g.objects[a.obj]?.cardId}|${a.destination ?? ''}|${g.objects[a.obj]?.zone}`
    : a.type === 'hide' ? `hide|${g.objects[a.obj]?.cardId}|${a.battlefieldIndex}` : keyOf(a);
  const seen = new Set<string>();
  const uniq = pool.filter(a => { const s = sig(a); if (seen.has(s)) return false; seen.add(s); return true; });
  const scored = uniq.map(a => ({ a, s: priorMain(g, p, a) })).sort((x, y) => y.s - x.s);
  // budget split: card plays / activations, and moves (best 2 per battlefield + best retreat), so attacks are
  // always considered next to deployments
  // activated abilities (legend, gear) are few and often free value: always consider them
  const acts = scored.filter(x => x.a.type === 'activate').slice(0, 3);
  const plays = scored.filter(x => x.a.type === 'playCard' || x.a.type === 'hide');
  const moves = scored.filter(x => x.a.type === 'move');
  const out: Action[] = [];
  const perDest = new Map<string, number>();
  const moveOut: Action[] = [];
  for (const { a } of moves) {
    if (a.type !== 'move') continue;
    const key = String(a.to);
    const n = perDest.get(key) ?? 0;
    if (n >= (a.to === 'base' ? 1 : 2)) continue;
    perDest.set(key, n + 1);
    moveOut.push(a);
  }
  const nMoves = Math.min(moveOut.length, Math.max(2, Math.floor(k / 2)));
  out.push(...acts.map(x => x.a));
  out.push(...moveOut.slice(0, nMoves));
  for (const { a } of plays) { if (out.length >= k) break; out.push(a); }
  for (const a of moveOut.slice(nMoves)) { if (out.length >= k) break; out.push(a); }
  return out;
}

/** Kill-maximising damage assignments (respecting the engine's validator), tried in addition to its suggestions. */
function damageCandidates(g: GameState, d: Decision): Action[] {
  const ts = (d.data?.targets ?? []) as AssignTarget[];
  const total = (d.data?.total ?? 0) as number;
  const out: Record<ObjId, number>[] = [];
  const value = (id: ObjId) => (g.objects[id] && isUnitSafe(g, id) ? unitValue(g, id) : 1);
  const orders: AssignTarget[][] = [
    [...ts].sort((a, b) => (a.groups[0] - b.groups[0]) || (value(b.obj) / Math.max(1, b.lethal ?? 99)) - (value(a.obj) / Math.max(1, a.lethal ?? 99))),
    [...ts].sort((a, b) => (a.groups[0] - b.groups[0]) || value(b.obj) - value(a.obj)),
    [...ts].sort((a, b) => (a.groups[0] - b.groups[0]) || ((a.lethal ?? 99) - (b.lethal ?? 99))),
  ];
  for (const ord of orders) {
    const a: Record<ObjId, number> = {};
    let left = total;
    // first pass: lethal to as many as possible in order, skipping ones we cannot finish (if the validator allows)
    for (const t of ord) { if (t.lethal === null || left <= 0) continue; if (t.lethal <= left) { a[t.obj] = t.lethal; left -= t.lethal; } }
    if (left > 0) { const f = ord.find(t => t.lethal !== null && !(t.obj in a)) ?? ord.find(t => t.lethal !== null) ?? ord[0]; if (f) a[f.obj] = (a[f.obj] ?? 0) + left; }
    out.push(a);
  }
  return out.filter(a => validateAssignment(ts, total, a) === null).map(a => ({ type: 'assignDamage', player: d.player, assignment: a }) as Action);
}

function isUnitSafe(g: GameState, id: ObjId): boolean { try { return isUnit(g, id); } catch { return false; } }

function inStepCandidates(g: GameState, d: Decision, legal: Action[], k: number): Action[] {
  let cands = legal.slice();
  // META-AUDIT: Weaponmaster never moves an Equipment that is already attached (seen: Brutalizer passed along four new
  // Sand Soldiers, paying [C] each time, for no gain)
  if (d.kind === 'chooseTargets' && /Weaponmaster/i.test(d.prompt)) {
    const ok = cands.filter(a => a.type === 'choose' && a.optionIds.every(id => !g.objects[id]?.attachedTo));
    if (ok.length) cands = ok;
  }
  if (d.kind === 'assignDamage') cands = [...cands, ...damageCandidates(g, d)];
  const seen = new Set<string>();
  cands = cands.filter(a => { const key = keyOf(a); if (seen.has(key)) return false; seen.add(key); return true; });
  if (cands.length <= k) return cands;
  // prune: the baseline bot's answer + the best by a hint-based prior (harm enemies / help friends)
  const p = d.player;
  const sign = d.hint === 'harm' ? -1 : d.hint === 'help' ? 1 : 0;
  const optVal = (id: string): number => {
    const o = g.objects[id];
    if (!o) return 0;
    const v = isUnitSafe(g, id) ? unitValue(g, id) : 1 + cost(g, id) * 0.5;
    return (o.controller === p ? 1 : -1) * sign * v;
  };
  const prior = (a: Action) => a.type === 'choose' ? a.optionIds.reduce((t, id) => t + optVal(id), 0) : 0;
  const bot = fastPolicy(g, d.player);
  const out: Action[] = bot ? [bot] : [];
  for (const a of cands.map(a => ({ a, s: prior(a) })).sort((x, y) => y.s - x.s).map(x => x.a)) {
    if (out.length >= k) break;
    if (!out.some(x => keyOf(x) === keyOf(a))) out.push(a);
  }
  // META-AUDIT: an optional choice ("or none", "up to") always keeps "choose nothing" as a candidate
  const none = (d.min ?? 1) === 0 ? cands.find(a => a.type === 'choose' && a.optionIds.length === 0) : undefined;
  if (none && !out.some(x => keyOf(x) === keyOf(none))) out.push(none);
  return out;
}

// ---------------------------------------------------------------- the searcher

export class SearchAI {
  readonly o: Required<Omit<SearchOptions, 'maxMs' | 'weights' | 'seed'>> & SearchOptions;
  readonly stats: SearchStats = { decisions: 0, searched: 0, nodes: 0, errors: 0, ms: 0 };
  private rng: () => number;
  /** debugging hook: called with every searched decision's candidate scores */
  trace?: (t: { turn: number; kind: string; end: number | null; cands: { a: Action; v: number }[]; best: Action | null }) => void;
  constructor(opts: SearchOptions = {}) {
    this.o = { ...DEF, ...opts, weights: { ...DEFAULT_WEIGHTS, ...(opts.weights ?? {}) } };
    this.rng = makeRng(opts.seed ?? 1);
  }

  choose(state: GameState, p: PlayerId): Action | null {
    const d = state.pending;
    if (!d || d.player !== p || state.winner !== null) return null;
    const t0 = performance.now();
    this.stats.decisions++;
    try { return this.decide(state, p, d); }
    finally { this.stats.ms += performance.now() - t0; }
  }

  private decide(g: GameState, p: PlayerId, d: Decision): Action | null {
    const legal = getLegalActions(g, p).filter(a => a.type !== 'cancel');
    if (legal.length === 0) return null;
    const ch = (ids: string[]): Action => ({ type: 'choose', player: p, optionIds: ids });
    if (d.inStep) {
      if (d.kind === 'payment') return ch(['auto']);
      if (d.kind === 'mulligan') { const a = ch(mulliganChoice(g, d)); return validateAction(g, a) === null ? a : legal[0]; }
      if (d.kind === 'chooseMode' && (d.options ?? []).some(x => x.id === 'first')) return ch(['first']);
      if (d.kind === 'chooseBattlefield') return fastPolicy(g, p);
    }
    let cands: Action[];
    let staticEnd: Action | null = null;
    if (d.inStep) {
      if (d.kind === 'orderTriggers' || d.kind === 'chooseOrder') return fastPolicy(g, p);
      const k = (d.kind === 'chooseTargets' || d.kind === 'chooseCards') && (d.hint === 'harm' || d.hint === 'help') ? Math.min(2, this.o.inStepCandidates) : this.o.inStepCandidates;
      cands = inStepCandidates(g, d, legal, k);
    }
    else if (d.kind === 'mainAction') {
      staticEnd = legal.find(a => a.type === 'endTurn') ?? null;
      cands = mainCandidates(g, p, legal, this.o.maxCandidates);
    } else {
      // chain / showdown responses: pass + every play/activation (minus mana abilities)
      cands = legal.filter(a => !(a.type === 'activate' && a.abilityIndex >= 950));
      // responding to our own chain item (we hold priority after playing it) is rarely right: just pass
      if (d.kind === 'chainResponse' && g.chain.length && g.chain[g.chain.length - 1].controller === p) {
        const pass = legal.find(a => a.type === 'pass');
        if (pass) return pass;
      }
      const pass = cands.find(a => a.type === 'pass');
      const k = this.o.responseCandidates;
      if (cands.length > k) {
        const rest = cands.filter(a => a !== pass).map(a => ({ a, s: a.type === 'playCard' ? cost(g, a.obj) : a.type === 'activate' ? 1 : 0 })).sort((x, y) => y.s - x.s).map(x => x.a);
        cands = [...(pass ? [pass] : []), ...rest.slice(0, k - 1)];
      }
    }
    if (cands.length + (staticEnd ? 1 : 0) <= 1) return cands[0] ?? staticEnd ?? legal[0];
    this.stats.searched++;
    const t0 = performance.now();
    const n0 = this.stats.nodes;
    const kindKey = d.kind + (d.inStep ? '*' : '');
    try { return this.searchBest(g, p, cands, staticEnd); }
    finally {
      const bk = (this.stats.byKind ??= {});
      const e = (bk[kindKey] ??= [0, 0, 0]); e[0]++; e[1] += this.stats.nodes - n0; e[2] += performance.now() - t0;
    }
  }

  private searchBest(g: GameState, p: PlayerId, cands: Action[], staticEnd: Action | null): Action | null {
    const t0 = performance.now();
    const budget = { nodes: this.o.maxNodes };
    const total = new Map<Action, number>();
    let endScore = 0;
    const samples = Math.max(1, this.o.samples);
    for (let s = 0; s < samples; s++) {
      let det: GameState;
      try { det = determinize(g, p, this.rng); } catch { this.stats.errors++; return fastPolicy(g, p); }
      if (staticEnd) endScore += evaluate(det, p, this.o.weights as EvalWeights) + 0.01;
      for (const a of cands) {
        if (budget.nodes <= 0 || (this.o.maxMs && performance.now() - t0 > this.o.maxMs)) { total.set(a, (total.get(a) ?? 0) - 1e9); continue; }
        total.set(a, (total.get(a) ?? 0) + this.score(det, a, p, budget));
      }
    }
    let best: Action | null = staticEnd, bestS = staticEnd ? endScore / samples : -Infinity;
    for (const a of cands) { const v = (total.get(a) ?? -1e9) / samples; if (v > bestS) { bestS = v; best = a; } }
    if (this.trace) this.trace({ turn: g.turn, kind: g.pending!.kind, end: staticEnd ? endScore / samples : null, cands: cands.map(a => ({ a, v: (total.get(a) ?? -1e9) / samples })), best });
    if (!best) return fastPolicy(g, p);
    // the determinized answer must be valid in the real state (it always is for public choices)
    if (validateAction(g, best) !== null) { this.stats.errors++; return fastPolicy(g, p); }
    return best;
  }

  private score(det: GameState, a: Action, p: PlayerId, budget: { nodes: number }): number {
    let g: GameState;
    try {
      const r = applyAction(det, a); budget.nodes--; this.stats.nodes++;
      if (r.events.some(e => e.type === 'rollback')) return -1e7;     // engine refused it (state unchanged)
      g = r.state;
    } catch { this.stats.errors++; return -1e8; }
    const startTurn = g.turn;
    for (let i = 0; i < this.o.settleCap && g.winner === null && !isQuiet(g.pending); i++) {
      const pd = g.pending!;
      const pl = pd.player;
      const b: Action | null = !pd.inStep && !this.o.respondInSettle ? { type: 'pass', player: pl } : fastPolicy(g, pl);
      if (!b) break;
      try { g = applyAction(g, b).state; budget.nodes--; this.stats.nodes++; }
      catch { this.stats.errors++; break; }
    }
    void startTurn;
    const v = evaluate(g, p, this.o.weights as EvalWeights);
    return v >= WIN ? WIN : v;
  }
}

/** Convenience: a stateless-looking policy function. */
export function makeSearchPolicy(opts: SearchOptions = {}): { choose: (g: GameState, p: PlayerId) => Action | null; ai: SearchAI } {
  const ai = new SearchAI(opts);
  return { choose: (g, p) => ai.choose(g, p), ai };
}

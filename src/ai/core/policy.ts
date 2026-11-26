// AI-CORE: candidate generation, priors, cheap in-step answers, combo-step matching, and settling (playing a state
// forward to the next quiet point with cheap policies). Used by the turn planner (planner.ts) and SearchAI.
import type { Action, Decision, GameState, ObjId, PlayerId } from '../../engine/types.ts';
import { applyAction, getLegalActions, validateAction, chooseAction } from '../../engine/index.ts';
import { chars, isUnit, hasKw, kwVal } from '../../engine/chars.ts';
import { unitsAtLoc } from '../../engine/actions.ts';
import { validateAssignment, type AssignTarget } from '../../engine/showdown.ts';
import { victoryScore } from '../../engine/rules.ts';
import { autoPay, addSources, validatePlan, type Purpose } from '../../engine/payment.ts';
import { playCostOf } from '../../engine/testkit.ts';
import { hideCosts } from '../../engine/play.ts';
import { unitValue } from '../eval.ts';
import { cardInfo, makeCtx } from './ctx.ts';
import type { CardInfo, ChoiceRule, DeckPlan, PlanCtx, StepMatch } from '../plans/types.ts';

export interface Budget { nodes: number }

export function cost(g: GameState, id: ObjId): number {
  try { const c = chars(g, id); return (c.energy ?? 0) + (c.power ?? 0); } catch { return 0; }
}
export function safeMight(g: GameState, id: ObjId): number { try { return Math.max(0, chars(g, id).might ?? 0); } catch { return 0; } }
function safeType(g: GameState, id: ObjId): string { try { return chars(g, id).type; } catch { return '?'; } }
function isUnitSafe(g: GameState, id: ObjId): boolean { try { return isUnit(g, id); } catch { return false; } }
export const keyOf = (a: Action): string => JSON.stringify(a);
export const isMana = (a: Action) => a.type === 'activate' && a.abilityIndex >= 950;

/** the acting card of an action (for plan hooks) */
export function actingCard(g: GameState, a: Action): CardInfo | null {
  const id = a.type === 'playCard' || a.type === 'activate' || a.type === 'hide' ? a.obj : a.type === 'move' ? a.units[0] : a.type === 'choose' ? a.optionIds[0] : undefined;
  return id && g.objects[id] ? cardInfo(g, id) : null;
}

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

/** Weaponmaster (CR 821): take the best *unattached* Equipment, or none (never move one off a unit for [C] again). */
function fixAttachChoice(g: GameState, pl: PlayerId, a: Action | null): Action | null {
  const d = g.pending;
  if (!a || !d || !d.inStep || d.player !== pl || d.kind !== 'chooseTargets' || (d.min ?? 1) !== 0 || !/Weaponmaster/i.test(d.prompt)) return a;
  const opts = (d.options ?? []).map(o => o.id).filter(id => g.objects[id]);
  const free = opts.filter(id => !g.objects[id].attachedTo).sort((x, y) => cost(g, y) - cost(g, x));
  return { type: 'choose', player: pl, optionIds: free.length ? [free[0]] : [] };
}

export const isQuiet = (d: Decision | null) => !d || (!d.inStep && d.kind === 'mainAction');

// ---------------------------------------------------------------- mulligan

export function mulliganChoice(g: GameState, d: Decision, plan: DeckPlan | null): string[] {
  const opts = d.options ?? [];
  const max = d.max ?? 2;
  const cheap = opts.filter(o => cost(g, o.id) <= 2 && safeType(g, o.id) === 'Unit').length;
  let planScores: Record<ObjId, number | undefined> = {};
  if (plan?.mulligan) {
    try {
      const ctx = makeCtx(g, d.player);
      planScores = plan.mulligan(opts.map(o => cardInfo(g, o.id)).filter((x): x is CardInfo => !!x), ctx) ?? {};
    } catch { planScores = {}; }
  }
  const scored = opts.map(o => {
    const ps = planScores[o.id];
    if (ps !== undefined) return { id: o.id, bad: -ps };
    const c = cost(g, o.id);
    let bad = c >= 5 ? 3 + c : c === 4 ? (cheap ? 0 : 2) : 0;
    if (safeType(g, o.id) !== 'Unit' && c >= 4) bad += 1;
    return { id: o.id, bad };
  }).filter(x => x.bad > 0).sort((a, b) => b.bad - a.bad);
  return scored.slice(0, max).map(x => x.id);
}

// ---------------------------------------------------------------- payment

const purposeOk = (only: string | undefined, purpose: Purpose) => !only || only.split('|').some(o => o === purpose || (o === 'unitOrGear' && (purpose === 'unit' || purpose === 'gear')) || (o === 'unitOrUnitAbility' && purpose === 'unit'));

/**
 * The engine's auto-payment recycles a rune for a power cost before it considers free exhaust-only Add abilities
 * (Kai'Sa's legend "[T]: Add [A], only for spells", Gold tokens). For a card play that would recycle runes, build an
 * explicit payment plan that uses such Add sources instead (validated with the engine's own plan validator).
 * Returns the action unchanged when nothing is saved.
 */
export function improvePayment(g: GameState, p: PlayerId, a: Action): Action {
  if ((a.type !== 'playCard' && a.type !== 'hide') || a.payment || (a.type === 'playCard' && a.hidden)) return a;
  const o = g.objects[a.obj];
  if (!o || o.zone === 'facedown') return a;
  try {
    const t = safeType(g, a.obj);
    const purpose: Purpose = a.type === 'hide' ? 'hide' : t === 'Spell' ? 'spell' : t === 'Unit' ? 'unit' : t === 'Gear' ? 'gear' : 'other';
    if (purpose === 'other') return a;
    // optional / additional costs chosen later in the play (Repeat, Flow, "you may pay ... as an additional cost") would
    // not be covered by a plan made for the base cost: leave those to the engine's auto-payment
    const def = g.cards[o.cardId];
    if (a.type === 'playCard' && (def?.keywords?.some(k => /^(Repeat|Flow|Empower)/.test(k)) || /additional cost/i.test(def?.text ?? ''))) return a;
    // a spell that may target a [Deflect] unit pays extra power chosen at targeting time: leave it to auto-payment
    if (a.type === 'playCard' && t === 'Spell' && allUnitsSafe(g).some(u => hasKw(g, u, 'Deflect'))) return a;
    let rc: ReturnType<typeof playCostOf>;
    if (a.type === 'hide') {
      const hc = hideCosts(g, p, a.obj);
      if (hc.length !== 1) return a;           // several alternative costs: the engine asks; leave it
      rc = hc[0];
    } else rc = playCostOf(g, p, a.obj, { dest: (a.destination ?? 'base') as never });
    if (!rc || !rc.power.length) return a;
    const base = autoPay(g, p, rc, purpose);
    if (!base || base.recycles === 0 || base.plan.other) return a;
    const adds = addSources(g, p, a.obj).filter(x => purposeOk(x.only, purpose) && (x.ab.cost.extra ?? []).every(e => (e as { self?: boolean }).self) && x.power.length > 0);
    if (!adds.length) return a;
    let best: { plan: NonNullable<Extract<Action, { type: 'playCard' }>['payment']>; rec: number } | null = null;
    const sets: typeof adds[] = adds.map(x => [x]);
    if (adds.length > 1 && base.recycles > 1) sets.push(adds.slice(0, 2));
    for (const set of sets) {
      const pw = set.reduce((t2, x) => t2 + x.power.length, 0), en = set.reduce((t2, x) => t2 + x.energy, 0);
      const recycle = base.plan.recycle.slice(0, Math.max(0, base.recycles - pw));
      const exhaust = base.plan.exhaust.slice(0, Math.max(0, base.plan.exhaust.length - en));
      const addDomains: Record<string, string> = {};
      for (const x of set) if (x.powerDoms.some(d => d)) addDomains[x.key] = (x.powerDoms.find(d => d) as string[])[0];
      const plan = { exhaust, recycle, other: { abilities: set.map(x => x.key), addDomains } };
      if (validatePlan(g, p, rc, purpose, plan) !== null) continue;
      if (!best || recycle.length < best.rec) best = { plan, rec: recycle.length };
    }
    if (!best || best.rec >= base.recycles) return a;
    const b: Action = { ...a, payment: best.plan };
    return validateAction(g, b) === null ? b : a;
  } catch { return a; }
}

// ---------------------------------------------------------------- main-phase candidates

export interface Cand { a: Action; prior: number; combo?: number }

function sideMight(g: GameState, bf: number, p: PlayerId, mine: boolean, attack: boolean): number {
  let m = 0;
  for (const u of unitsAtLoc(g, bf)) {
    const o = g.objects[u];
    if ((o.controller === p) !== mine || o.stunned) continue;
    m += safeMight(g, u) + (attack ? kwVal(g, u, 'Assault') : kwVal(g, u, 'Shield'));
  }
  return m;
}

/** core prior of a main-phase action */
export function priorMain(g: GameState, p: PlayerId, a: Action): number {
  switch (a.type) {
    case 'playCard': {
      const c = cost(g, a.obj);
      return 20 + c * 2 + (a.destination !== undefined && a.destination !== 'base' ? 1 : 0);
    }
    case 'activate': return a.abilityIndex >= 950 ? -100 : 15;
    case 'hide': return 6;
    case 'move': {
      if (a.to === 'base') return 2 - a.units.length;
      const b = g.battlefields[a.to];
      if (!b) return -50;
      if (b.scoredThisTurnBy.includes(p) && b.controller === p) return -5;
      const theirs = sideMight(g, a.to, p, false, false);
      let mine = sideMight(g, a.to, p, true, true);
      for (const u of a.units) mine += safeMight(g, u) + kwVal(g, u, 'Assault');
      const ctl = b.controller === p;
      let s = ctl ? 3 : 18;
      if (theirs === 0) s += 10 - a.units.length * 2;
      else s += mine > theirs ? 14 - a.units.length : mine === theirs ? 2 : -6 - a.units.length;
      if (!ctl && !b.scoredThisTurnBy.includes(p) && g.players[p].points + 1 >= victoryScore(g) && (theirs === 0 || mine > theirs)) s += 30;
      for (const u of a.units) { const from = g.objects[u]?.battlefieldIndex; if (g.objects[u]?.zone === 'battlefield' && from !== undefined && g.battlefields[from]?.controller === p) s -= 4; }
      return s;
    }
    default: return 0;
  }
}

/**
 * Group moves the engine does not enumerate (it lists single-unit moves): for each battlefield, (a) the cheapest set of
 * ready base units (by Might, Tank first) that beats the defenders, (b) all ready base units. Validated.
 */
function groupMoves(g: GameState, p: PlayerId, singles: Action[]): Action[] {
  const movers = new Map<number | 'base', ObjId[]>();
  for (const a of singles) if (a.type === 'move' && a.units.length === 1) { const l = movers.get(a.to) ?? []; l.push(a.units[0]); movers.set(a.to, l); }
  const out: Action[] = [];
  for (const [to, units] of movers) {
    if (to === 'base' || units.length < 2) continue;
    const fromBase = units.filter(u => g.objects[u]?.zone === 'base');
    if (fromBase.length < 2) continue;
    const theirs = sideMight(g, to, p, false, false);
    const mineThere = sideMight(g, to, p, true, true);
    const sorted = [...fromBase].sort((x, y) => (safeMight(g, y) + kwVal(g, y, 'Assault')) - (safeMight(g, x) + kwVal(g, x, 'Assault')));
    const groups: ObjId[][] = [sorted];
    if (theirs > 0) {
      const pick: ObjId[] = []; let m = mineThere;
      for (const u of sorted) { pick.push(u); m += safeMight(g, u) + kwVal(g, u, 'Assault'); if (m > theirs + 1) break; }
      if (pick.length >= 2 && pick.length < sorted.length) groups.push(pick);
    } else if (sorted.length > 2) groups.push(sorted.slice(0, 2));
    for (const grp of groups) {
      const a: Action = { type: 'move', player: p, units: grp, to };
      if (validateAction(g, a) === null) out.push(a);
    }
  }
  return out;
}

/** Pick the best battlefield to hide a card (one we control, not threatened), one candidate per card. */
function hideCands(g: GameState, p: PlayerId, legal: Action[]): Action[] {
  const best = new Map<string, { a: Action; s: number }>();
  for (const a of legal) {
    if (a.type !== 'hide') continue;
    const cid = g.objects[a.obj]?.cardId ?? a.obj;
    const theirs = sideMight(g, a.battlefieldIndex, p, false, false);
    const mine = sideMight(g, a.battlefieldIndex, p, true, false);
    const s = mine - theirs;
    const cur = best.get(cid);
    if (!cur || s > cur.s) best.set(cid, { a, s });
  }
  return [...best.values()].map(x => x.a);
}

/**
 * Main-phase candidates: activations (non-mana), card plays (deduplicated by card + destination), hides (one per
 * card), single + group moves. Ordered by core prior + plan prior; the planner takes the top K per depth.
 */
export function mainCandidates(g: GameState, p: PlayerId, legal: Action[], plan: DeckPlan | null, ctx: PlanCtx | null): Cand[] {
  const d = g.pending!;
  const pool = legal.filter(a => a.type !== 'endTurn' && !isMana(a) && a.type !== 'hide');
  const sig = (a: Action) => a.type === 'playCard' ? `play|${g.objects[a.obj]?.cardId}|${a.destination ?? ''}|${g.objects[a.obj]?.zone}|${a.hidden ? 1 : 0}`
    : a.type === 'activate' ? `act|${g.objects[a.obj]?.cardId}|${a.abilityIndex}|${g.objects[a.obj]?.zone}|${g.objects[a.obj]?.exhausted}` : keyOf(a);
  const seen = new Set<string>();
  const uniq = pool.filter(a => { const s = sig(a); if (seen.has(s)) return false; seen.add(s); return true; });
  const moves = uniq.filter(a => a.type === 'move');
  const all = [...uniq, ...groupMoves(g, p, moves), ...(plan?.hide?.never?.length || true ? hideCands(g, p, legal) : [])];
  const out: Cand[] = [];
  for (const a0 of all) {
    const a = a0.type === 'playCard' || a0.type === 'hide' ? improvePayment(g, p, a0) : a0;
    let s = priorMain(g, p, a);
    if (a.type === 'hide') {
      const c = cardInfo(g, a.obj);
      if (c && plan?.hide?.never?.includes(c.name)) continue;
      if (c && plan?.hide?.hideValue && ctx) s += 2 * (plan.hide.hideValue(c, a.battlefieldIndex, ctx) ?? 0);
    }
    if (plan?.prior && ctx) { try { s += plan.prior(a, actingCard(g, a), d, ctx) ?? 0; } catch { /* plan bug: ignore */ } }
    out.push({ a, prior: s });
  }
  return out.sort((x, y) => y.prior - x.prior);
}

/** Choose the top K main candidates with a split: activations, plays/hides, moves (best 2 per destination). */
export function topMain(cands: Cand[], k: number): Cand[] {
  const acts = cands.filter(c => c.a.type === 'activate').slice(0, 3);
  const plays = cands.filter(c => c.a.type === 'playCard' || c.a.type === 'hide');
  const perDest = new Map<string, number>();
  const moves: Cand[] = [];
  for (const c of cands) {
    if (c.a.type !== 'move') continue;
    const key = String(c.a.to);
    const n = perDest.get(key) ?? 0;
    if (n >= (c.a.to === 'base' ? 1 : 2)) continue;
    perDest.set(key, n + 1); moves.push(c);
  }
  const nMoves = Math.min(moves.length, Math.max(2, Math.floor(k / 2)));
  const out: Cand[] = [...acts, ...moves.slice(0, nMoves)];
  for (const c of plays) { if (out.length >= k) break; out.push(c); }
  for (const c of moves.slice(nMoves)) { if (out.length >= k) break; out.push(c); }
  return out.slice(0, Math.max(k, acts.length + Math.min(2, nMoves)));
}

// ---------------------------------------------------------------- in-step answers

/** Kill-maximising damage assignments (respecting the engine's validator). */
export function damageCandidates(g: GameState, d: Decision): Action[] {
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
    for (const t of ord) { if (t.lethal === null || left <= 0) continue; if (t.lethal <= left) { a[t.obj] = t.lethal; left -= t.lethal; } }
    if (left > 0) { const f = ord.find(t => t.lethal !== null && !(t.obj in a)) ?? ord.find(t => t.lethal !== null) ?? ord[0]; if (f) a[f.obj] = (a[f.obj] ?? 0) + left; }
    out.push(a);
  }
  return out.filter(a => validateAssignment(ts, total, a) === null).map(a => ({ type: 'assignDamage', player: d.player, assignment: a }) as Action);
}

/** best single option of a yes/no / mode decision by the plan's prior/target hooks (null when the plan has no opinion) */
export function planOptionPick(g: GameState, d: Decision, plan: DeckPlan, ctx: PlanCtx): Action | null {
  let best: Action | null = null, bestS = -Infinity, any = false;
  for (const o2 of d.options ?? []) {
    const a: Action = { type: 'choose', player: d.player, optionIds: [o2.id] };
    let s = 0;
    try {
      const t = plan.target?.(null, o2.id, d, ctx); if (t !== undefined) { s += t; any = true; }
      const pr = plan.prior?.(a, null, d, ctx); if (pr !== undefined) { s += pr; any = true; }
    } catch { /* ignore */ }
    if (s > bestS && validateAction(g, a) === null) { bestS = s; best = a; }
  }
  return any ? best : null;
}

function ruleMatches(r: ChoiceRule, d: Decision): boolean {
  if (r.kind && r.kind !== d.kind) return false;
  if (r.prompt) { const re = typeof r.prompt === 'string' ? new RegExp(r.prompt, 'i') : r.prompt; if (!re.test(d.prompt)) return false; }
  return true;
}

/** per-option score for a choose decision: plan choice rules > plan target hook > core harm/help prior */
export function optionScorer(g: GameState, d: Decision, plan: DeckPlan | null, ctx: PlanCtx | null, rules?: ChoiceRule[]): ((id: string) => number) & { none?: boolean } {
  const p = d.player;
  const sign = d.hint === 'harm' ? -1 : d.hint === 'help' ? 1 : 0;
  const prompt = d.prompt.toLowerCase();
  const costly = /discard|recycle|kill a friendly|spend|banish .*your|sacrifice/.test(prompt);
  const rule = rules?.find(r => ruleMatches(r, d));
  const core = (id: string): number => {
    const o = g.objects[id];
    if (!o) return 0;
    const v = isUnitSafe(g, id) ? unitValue(g, id) : 1 + cost(g, id) * 0.5;
    if (sign) return (o.controller === p ? 1 : -1) * sign * v;
    if (costly) return -v;
    return o.controller === p ? v * 0.2 : v * 0.1;
  };
  const f = ((id: string) => {
    const info = g.objects[id] && ctx ? ctx.info(id) : null;
    let s = core(id);
    if (rule?.pick && ctx) { try { s += 10 * (rule.pick(info, id, d, ctx) ?? 0); } catch { /* ignore */ } }
    if (plan?.target && ctx) { try { s += plan.target(info, id, d, ctx) ?? 0; } catch { /* ignore */ } }
    if (/weaponmaster/.test(prompt) && o(g, id)?.attachedTo) s -= 50;
    return s;
  }) as ((id: string) => number) & { none?: boolean };
  f.none = !!rule?.none;
  return f;
}
const o = (g: GameState, id: string) => g.objects[id];

/**
 * Cheap answer to one of p's in-step decisions (no search): plan rules / targeting / core priors; validated, with the
 * bot as fallback. `rules` = the active combo's choice rules.
 */
export function quickInStep(g: GameState, p: PlayerId, plan: DeckPlan | null, ctx: PlanCtx | null, rules?: ChoiceRule[]): Action | null {
  const d = g.pending!;
  const ch = (ids: string[]): Action => ({ type: 'choose', player: p, optionIds: ids });
  // yes/no and mode decisions: the plan's opinion (prior on the choose action, or target(null, optionId)) decides
  if ((d.kind === 'optional' || d.kind === 'confirm' || d.kind === 'chooseMode') && (plan?.prior || plan?.target) && ctx && !rules?.some(r => ruleMatches(r, d))) {
    const pick = planOptionPick(g, d, plan, ctx);
    if (pick) return pick;
  }
  if (d.kind === 'payment') return ch(['auto']);
  if (d.kind === 'chooseMode' && (d.options ?? []).some(x => x.id === 'first')) return ch(['first']);
  if (d.kind === 'assignDamage') return damageCandidates(g, d)[0] ?? fastPolicy(g, p);
  if (d.kind === 'chooseTargets' || d.kind === 'chooseCards' || d.kind === 'chooseUnitsToMove' || (d.kind === 'optional' && rules?.some(r => ruleMatches(r, d)))) {
    const opts = (d.options ?? []).map(x => x.id);
    const sc = optionScorer(g, d, plan, ctx, rules);
    const min = d.min ?? 1, max = Math.min(d.max ?? 1, opts.length);
    if (d.kind === 'optional') {
      const a = ch([sc.none ? (opts.find(x => x === 'no') ?? opts[opts.length - 1]) : (opts.find(x => x === 'yes') ?? opts[0])]);
      return validateAction(g, a) === null ? a : fastPolicy(g, p);
    }
    const hasRule = !!rules?.some(r => ruleMatches(r, d)) || !!plan?.target;
    if (!hasRule) return fastPolicy(g, p);
    if (sc.none && min === 0) { const a = ch([]); if (validateAction(g, a) === null) return a; }
    const ranked = opts.map(id => ({ id, s: sc(id) })).sort((a, b) => b.s - a.s);
    let n = min;
    if (max > min) n = Math.max(min, Math.min(max, ranked.filter(x => x.s > 0).length));
    const a = ch(ranked.slice(0, n).map(x => x.id));
    if (validateAction(g, a) === null) return a;
    return fastPolicy(g, p);
  }
  return fastPolicy(g, p);
}

/** Candidate answers for a searched in-step decision (bot answer + best by option scores + "none" when optional). */
export function inStepCandidates(g: GameState, d: Decision, legal: Action[], k: number, plan: DeckPlan | null, ctx: PlanCtx | null): Action[] {
  let cands = legal.slice();
  if (d.kind === 'chooseTargets' && /Weaponmaster/i.test(d.prompt)) {
    const ok = cands.filter(a => a.type === 'choose' && a.optionIds.every(id => !g.objects[id]?.attachedTo));
    if (ok.length) cands = ok;
  }
  if (d.kind === 'assignDamage') cands = [...damageCandidates(g, d), ...cands];
  const seen = new Set<string>();
  cands = cands.filter(a => { const key = keyOf(a); if (seen.has(key)) return false; seen.add(key); return true; });
  if (cands.length <= k) return cands;
  const sc = optionScorer(g, d, plan, ctx);
  const prior = (a: Action) => a.type === 'choose' ? a.optionIds.reduce((t, id) => t + sc(id), 0) : 0;
  const out: Action[] = [];
  const q = quickInStep(g, d.player, plan, ctx);
  if (q) out.push(q);
  const bot = fastPolicy(g, d.player);
  if (bot && !out.some(x => keyOf(x) === keyOf(bot))) out.push(bot);
  for (const a of cands.map(a => ({ a, s: prior(a) })).sort((x, y) => y.s - x.s).map(x => x.a)) {
    if (out.length >= k) break;
    if (!out.some(x => keyOf(x) === keyOf(a))) out.push(a);
  }
  const none = (d.min ?? 1) === 0 ? cands.find(a => a.type === 'choose' && a.optionIds.length === 0) : undefined;
  if (none && !out.some(x => keyOf(x) === keyOf(none))) out.push(none);
  return out;
}

// ---------------------------------------------------------------- combo steps

function cardMatches(g: GameState, id: ObjId, m: StepMatch['card'], p: PlayerId, ctx: PlanCtx): boolean {
  if (m === undefined) return true;
  if (m === 'legend') return id === g.players[p].legend;
  const c = cardInfo(g, id);
  if (!c) return false;
  if (typeof m === 'string') return c.name === m || `${c.name}, ${c.subtitle ?? ''}` === m;
  if (Array.isArray(m)) return m.includes(c.name);
  try { return m(c, ctx); } catch { return false; }
}

/** legal actions matching a combo step (best first) */
export function matchStep(g: GameState, p: PlayerId, legal: Action[], st: StepMatch, ctx: PlanCtx): Action[] {
  const out: { a: Action; s: number }[] = [];
  const scoreOf = (a: Action) => { try { return st.score ? st.score(a, actingCard(g, a), ctx) : priorMain(g, p, a); } catch { return 0; } };
  if (st.do === 'pass' || st.do === 'endTurn') { const a = legal.find(x => x.type === (st.do === 'pass' ? 'pass' : 'endTurn')); return a ? [a] : []; }
  for (const a of legal) {
    if (st.do === 'play' && a.type === 'playCard') {
      if (!cardMatches(g, a.obj, st.card, p, ctx)) continue;
      if (st.to === 'base' && a.destination !== undefined && a.destination !== 'base') continue;
      if (st.to === 'battlefield' && (a.destination === undefined || a.destination === 'base')) continue;
      if (typeof st.to === 'number' && a.destination !== st.to) continue;
      out.push({ a, s: scoreOf(a) });
    } else if (st.do === 'activate' && a.type === 'activate' && !isMana(a)) {
      if (!cardMatches(g, a.obj, st.card, p, ctx)) continue;
      if (st.ability !== undefined && a.abilityIndex !== st.ability) continue;
      out.push({ a, s: scoreOf(a) });
    } else if (st.do === 'hide' && a.type === 'hide') {
      if (!cardMatches(g, a.obj, st.card, p, ctx)) continue;
      if (typeof st.to === 'number' && a.battlefieldIndex !== st.to) continue;
      out.push({ a, s: scoreOf(a) });
    } else if (st.do === 'move' && a.type === 'move' && a.units.length === 1) {
      if (st.to === 'base' && a.to !== 'base') continue;
      if (st.to === 'battlefield' && a.to === 'base') continue;
      if (typeof st.to === 'number' && a.to !== st.to) continue;
      if (!cardMatches(g, a.units[0], st.card, p, ctx)) continue;
      let act: Action = a;
      if (st.units && a.to !== 'base') {
        // add every other unit that can make the same move (and fits the filter)
        const extra = legal.filter(x => x.type === 'move' && x.to === a.to && x.units.length === 1 && x.units[0] !== a.units[0]).map(x => (x as { units: ObjId[] }).units[0])
          .filter(u => st.units === 'ready' || st.units === 'all' ? true : (() => { const c = cardInfo(g, u); try { return !!c && (st.units as (c: CardInfo, ctx: PlanCtx) => boolean)(c, ctx); } catch { return false; } })());
        if (extra.length) { const grp: Action = { type: 'move', player: p, units: [a.units[0], ...extra], to: a.to }; if (validateAction(g, grp) === null) act = grp; }
      }
      out.push({ a: act, s: scoreOf(act) });
    }
  }
  return out.sort((x, y) => y.s - x.s).map(x => x.a);
}

// ---------------------------------------------------------------- settle

export interface SettleOpts {
  cap: number;
  /** opponent answers chain/showdown windows with the bot (true) or always passes (false: cheaper) */
  oppResponds: boolean;
  /** my own showdown windows (combat tricks) answered by the bot */
  meResponds: boolean;
  plan: DeckPlan | null;
  rules?: ChoiceRule[];
}

export interface SettleResult { g: GameState; mine: { sig: string; a: Action }[]; ok: boolean; turnOver: boolean; recycled: number }

/**
 * Play forward from g (after one of p's actions) until p's next quiet main-phase decision, the end of p's turn (the
 * opponent's main phase), or the game's end. p's own answers are recorded (with the decision signature) so a planned
 * line can be replayed in the real game.
 */
export function settle(g: GameState, p: PlayerId, so: SettleOpts, budget: Budget, sigOf: (g: GameState) => string): SettleResult {
  const mine: { sig: string; a: Action }[] = [];
  let recycled = 0;
  for (let i = 0; i < so.cap && g.winner === null; i++) {
    const d = g.pending;
    if (!d) break;
    if (!d.inStep && d.kind === 'mainAction') return { g, mine, ok: true, turnOver: d.player !== p, recycled };
    const pl = d.player;
    let a: Action | null;
    if (pl === p) {
      if (d.inStep) a = quickInStep(g, p, so.plan, so.plan ? makeCtx(g, p) : null, so.rules);
      else if (d.kind === 'chainResponse' && g.chain.length && g.chain[g.chain.length - 1].controller === p) a = { type: 'pass', player: p };
      else a = so.meResponds ? fastPolicy(g, p) : { type: 'pass', player: p };
      if (a) mine.push({ sig: sigOf(g), a });
    } else {
      a = d.inStep || so.oppResponds ? fastPolicy(g, pl) : { type: 'pass', player: pl };
    }
    if (!a) break;
    const before = g.players[p].runesInPlay.length;
    try {
      const r = applyAction(g, a); budget.nodes--;
      if (r.events.some(e => e.type === 'rollback')) return { g, mine, ok: false, turnOver: false, recycled };
      g = r.state;
    } catch { return { g, mine, ok: false, turnOver: false, recycled }; }
    recycled += Math.max(0, before - g.players[p].runesInPlay.length);
  }
  // cap reached: keep the line (the state is evaluated as it stands; the rest is answered live)
  return { g, mine, ok: true, turnOver: g.winner !== null, recycled };
}

export { hasKw };
function allUnitsSafe(g: GameState): ObjId[] { try { return Object.keys(g.objects).filter(id => { const o = g.objects[id]; return (o.zone === 'base' || o.zone === 'battlefield') && isUnitSafe(g, id); }); } catch { return []; } }

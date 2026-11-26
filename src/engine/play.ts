// Playing cards (CR 349-359), activating abilities (376-381, 398-406), hiding (421, 811),
// countering (425). The full process runs inside one replay unit: choices are asked with ask(),
// and an illegal play throws Rollback which restores the pre-play state (CR 358).
import type { Action, ChainItem, GameEvent, GameState, ObjId, PlayerId, PaymentPlan, Domain } from './types.ts';
import type { CardScript, Ability, ActivatedAbility, CostModAbility, Destination, Mode, PlayRuleAbility, SpellAbility, TargetSpec, PlayPermissionAbility, AsPlayAbility } from './abilities.ts';
import { chars, isUnit, isGear, abilitySources, allAbilities, keywordAbilities, abilityByIndex, keywordCost, keywordCosts, playGrants, onBoard, hasKw, dependenciesMet, abilityController } from './chars.ts';
import { getScript, getDelayed } from '../cards/registry.ts';
import { makeCtx, Ctx, PENDING_EXTRA } from './context.ts';
import { ask, chooseOptions, chooseOne, chooseNumber, askYesNo, Rollback, registerValidator } from './ask.ts';
import { moveToZone, setLocation, facedownAt, locOf, isBattlefieldCard, type Loc } from './state.ts';
import { emit, abilityKey, oncePerTurnOk, markUsed } from './events.ts';
import { candidatesFor, deflectCost, emitTargeted, legalTarget, chooseGroup } from './targets.ts';
import { resolveCost, addCosts, autoPay, canAfford, validatePlan, executePayment, choosePayment, canPayNonResource, payNonResource, costLabel, abilityPurpose, type ResolvedCost, type Purpose } from './payment.ts';
import { maybeContest, unitsAtLoc, exhaust, empower as doEmpower, attach as doAttach, canEnterBattlefield, toTrash } from './actions.ts';
import { ruleApplies, ruleSum, ruleCosts } from './rules.ts';
import { addResources as addResourcesFn, recycle as recycleFn } from './actions.ts';
import { log, cardName, nextPlayer, isOpponent } from './util.ts';
import { bonusDamageFor } from './replace.ts';

// ---------------- timing ----------------

export type Window = 'main' | 'showdown' | 'chain';

/** Which discretionary-action window the player is in, if any. */
export function currentWindow(g: GameState, p: PlayerId): Window | null {
  if (g.winner !== null || g.phase === 'gameOver') return null;
  if (g.pending && g.pending.inStep) return null;
  if (g.chain.length > 0) return g.priority === p ? 'chain' : null;
  // an open showdown can coexist with pending turn tasks (showdown in the Ending Phase, RJ#1317)
  if (g.showdown && g.showdown.stage === 'open') return g.showdown.focus === p ? 'showdown' : null;
  if (g.ex.tasks.length > 0) return null;
  if (g.showdown) return null;
  if (g.phase === 'action' && g.activePlayer === p && g.ex.staged.length === 0) return 'main';
  return null;
}

export type Timing = 'normal' | 'action' | 'reaction';

function timingRank(t: Timing): number { return t === 'reaction' ? 2 : t === 'action' ? 1 : 0; }
export function maxTiming(a: Timing, b: Timing): Timing { return timingRank(a) >= timingRank(b) ? a : b; }

export function timingAllows(t: Timing, w: Window): boolean {
  if (w === 'main') return true;
  if (w === 'showdown') return t === 'action' || t === 'reaction';
  return t === 'reaction';
}

function playRules(g: GameState, p: PlayerId, self?: ObjId): { src: ObjId | null; ab: PlayRuleAbility; controller: PlayerId; data?: Record<string, unknown>; delayedId?: string }[] {
  const out: { src: ObjId | null; ab: PlayRuleAbility; controller: PlayerId; data?: Record<string, unknown>; delayedId?: string }[] = [];
  // the card being played: its own playRule abilities work from the zone it is played from
  if (self && g.objects[self] && !(g.objects[self].zone === 'base' || g.objects[self].zone === 'battlefield')) {
    for (const ab of getScript(g.objects[self].cardId)?.abilities ?? []) if (ab.kind === 'playRule' && dependenciesMet(g, self, ab)) out.push({ src: self, ab, controller: p });
  }
  for (const src of abilitySources(g)) for (const r of allAbilities(g, src)) if (r.ability.kind === 'playRule') out.push({ src: r.viaHost ?? src, ab: r.ability, controller: abilityController(g, r.viaHost ?? src) });
  for (const d of g.ex.delayed) { const ab = getDelayed(d.key); if (ab?.kind === 'playRule') out.push({ src: d.source, ab, controller: d.controller, data: d.data, delayedId: d.id }); }
  void p;
  return out;
}

/** Does a play rule apply to plays by player p? (its controller's, or anyone's with anyPlayer — B8-9) */
function ruleFor(r: { ab: PlayRuleAbility; controller: PlayerId }, p: PlayerId): boolean { return r.controller === p || !!r.ab.anyPlayer; }

/** Base timing of a card being played (keywords + play rules). */
export function cardTiming(g: GameState, p: PlayerId, id: ObjId, opts: { fromHidden?: boolean; dest?: Destination } = {}): Timing {
  const c = chars(g, id);
  let t: Timing = c.keywords.has('Reaction') ? 'reaction' : c.keywords.has('Action') ? 'action' : 'normal';
  if (opts.fromHidden) t = 'reaction';                                     // CR 811
  if (c.keywords.has('Quick-Draw')) t = 'reaction';                          // CR 819
  if (typeof opts.dest === 'number' && c.keywords.has('Ambush') && unitsAtLoc(g, opts.dest).some(u => g.objects[u].controller === p)) {
    t = maxTiming(t, 'reaction');                                            // CR 822
  }
  for (const r of playRules(g, p, id)) {
    if (!ruleFor(r, p)) continue;
    const ctx = makeCtx(g, r.src ?? '', r.controller, { data: r.data });
    if (!r.ab.applies(ctx, id)) continue;
    if (r.ab.grantsTiming) t = maxTiming(t, r.ab.grantsTiming);
    // B4-2: "may be played to ... as if with Ambush" — Reaction timing when played there
    if (r.ab.ambush && typeof opts.dest === 'number' && r.ab.ambush(ctx, id, opts.dest)) t = maxTiming(t, 'reaction');
  }
  return t;
}

// ---------------- sources and destinations ----------------

export type PlayVia = 'hand' | 'champion' | 'hidden' | 'flow' | 'permission';

export interface PlayOption { obj: ObjId; via: PlayVia; permission?: PlayPermissionAbility }

function spellAbility(g: GameState, id: ObjId): SpellAbility | undefined {
  const s = getScript(chars(g, id).copyOf ?? g.objects[id].cardId);
  return s?.abilities.find(a => a.kind === 'spell') as SpellAbility | undefined;
}

function permissionsFor(g: GameState, p: PlayerId, id: ObjId): PlayPermissionAbility[] {
  const o = g.objects[id];
  const s = getScript(o.cardId);
  const out: PlayPermissionAbility[] = [];
  for (const ab of s?.abilities ?? []) {
    if (ab.kind !== 'playFrom' || ab.zone !== o.zone) continue;
    if (!dependenciesMet(g, id, ab)) continue;
    const ctx = makeCtx(g, id, p);
    if (ab.condition && !ab.condition(ctx)) continue;
    out.push(ab);
  }
  return out;
}

/** Every card the player could try to play from any zone (before timing / cost checks). */
export function playOptions(g: GameState, p: PlayerId): PlayOption[] {
  const pl = g.players[p];
  const out: PlayOption[] = [];
  for (const id of pl.hand) { out.push({ obj: id, via: 'hand' }); for (const perm of permissionsFor(g, p, id)) out.push({ obj: id, via: 'permission', permission: perm }); }
  for (const id of pl.championZone) out.push({ obj: id, via: 'champion' });
  for (const id in g.objects) {
    const o = g.objects[id];
    if (o.zone === 'facedown' && o.controller === p && o.hiddenTurn !== undefined && o.hiddenTurn < g.turn) out.push({ obj: id, via: 'hidden' });
  }
  for (const id of pl.trash) {
    const c = g.cards[g.objects[id].cardId];
    // B7-5: Flow (printed or granted) needs a cost to be playable
    if (c.type === 'Spell' && hasKw(g, id, 'Flow') && keywordCost(g, id, 'Flow')) out.push({ obj: id, via: 'flow' });
    for (const perm of permissionsFor(g, p, id)) out.push({ obj: id, via: 'permission', permission: perm });
  }
  for (const id of pl.banishment) for (const perm of permissionsFor(g, p, id)) out.push({ obj: id, via: 'permission', permission: perm });
  for (const id of pl.trash) if (ruleApplies(g, 'canPlayFromTrash', p, id)) out.push({ obj: id, via: 'permission', permission: { kind: 'playFrom', zone: 'trash' } });
  for (const perm of g.ex.playPermissions) {
    const o = g.objects[perm.obj];
    if (!o || perm.player !== p || (o.epoch ?? 0) !== perm.epoch || o.zone === 'chain' || o.zone === 'base' || o.zone === 'battlefield') continue;
    out.push({ obj: perm.obj, via: 'permission', permission: { kind: 'playFrom', zone: o.zone as 'trash', cost: perm.ignoreCost ? { energy: 0, power: [] } : undefined } });
  }
  return out;
}

/** Legal destinations for a permanent being played (CR 355.3). */
export function destinations(g: GameState, p: PlayerId, id: ObjId, via: PlayVia): Destination[] {
  const o = g.objects[id];
  const c = chars(g, id);
  if (c.type !== 'Unit' && c.type !== 'Gear') return [];
  const out = new Set<Destination>();
  if (via === 'hidden') {
    // a hidden permanent is played to its battlefield (CR 811) — or wherever a one-off play rule for this very object allows
    // (effect plays, B7-3); general permissions ("friendly units may be played to open battlefields", Miss Fortune, Buccaneer)
    // don't apply to it (RJ#5744, T144)
    out.add(o.battlefieldIndex!);
    for (const r of playRules(g, p, id)) {
      if (!r.ab.extraDestinations || !ruleFor(r, p) || (!r.ab.hiddenToo && (r.data as { obj?: ObjId } | undefined)?.obj !== id)) continue;
      const ctx = makeCtx(g, r.src ?? '', r.controller, { data: r.data });
      if (r.ab.applies(ctx, id)) for (const d of r.ab.extraDestinations(ctx, id)) if (d === 'base' || canEnterBattlefield(g, d, p)) out.add(d);
    }
    return [...out].filter(d => !ruleApplies(g, 'cantPlay', id, p, d));
  }
  if (c.type === 'Unit') {
    out.add('base');
    g.battlefields.forEach((b, i) => { if (b.controller === p && canEnterBattlefield(g, i, p)) out.add(i); });
    if (c.keywords.has('Ambush')) g.battlefields.forEach((_, i) => { if (unitsAtLoc(g, i).some(u => g.objects[u].controller === p) && canEnterBattlefield(g, i, p)) out.add(i); });
  } else {
    if (c.keywords.has('Deploy')) g.battlefields.forEach((_, i) => out.add(i));
    else out.add('base');
  }
  for (const r of playRules(g, p, id)) {
    if (!ruleFor(r, p)) continue;
    const ctx = makeCtx(g, r.src ?? '', r.controller, { data: r.data });
    if (!r.ab.applies(ctx, id)) continue;
    if (r.ab.extraDestinations) for (const d of r.ab.extraDestinations(ctx, id)) if (d === 'base' || canEnterBattlefield(g, d, p)) out.add(d);
    if (r.ab.ambush && c.type === 'Unit') g.battlefields.forEach((_, i) => { if (canEnterBattlefield(g, i, p) && r.ab.ambush!(ctx, id, i)) out.add(i); });
    // N6 / B8-19: a destination reachable by paying a play rule's additional cost (Dragon Roost)
    const ad = suppressRuleDest ? null : r.ab.additionalCost?.destination?.(ctx, id);
    if (ad !== undefined && ad !== null && (ad === 'base' || canEnterBattlefield(g, ad, p))) out.add(ad);
  }
  return [...out].filter(d => !ruleApplies(g, 'cantPlay', id, p, d));
}

/** Play-rule additional costs offered for this play (N6 / B8-11 / B8-19). `onlyFor` = the destination that needs it. */
export function ruleAdditionalCosts(g: GameState, p: PlayerId, id: ObjId): { cost: ResolvedCost; label: string; key: string; dest: Destination | null; discount?: { energy?: number; power?: number }; src: ObjId | null; controller: PlayerId }[] {
  const out: ReturnType<typeof ruleAdditionalCosts> = [];
  for (const r of playRules(g, p, id)) {
    const ac = r.ab.additionalCost;
    if (!ac || !ruleFor(r, p)) continue;
    const ctx = makeCtx(g, r.src ?? '', r.controller, { data: r.data });
    if (!r.ab.applies(ctx, id)) continue;
    const dest = ac.destination ? ac.destination(ctx, id) : null;
    const rc = resolveCost(ac.cost, chars(g, id).domains);
    // non-resource parts of a rule's cost ("exhaust me and three friendly units") act for the rule's source, paid by the player
    if (rc.extra?.length && r.src) {
      const src = r.src;
      const own = () => makeCtx(g, src, p);
      rc.extra = rc.extra.map(x => ({ ...x, canPay: () => x.canPay(own()), pay: () => x.pay(own()) }));
    }
    out.push({ cost: rc, label: ac.label ?? 'Pay an additional cost', key: ac.key ?? 'paidRuleCost', dest, discount: ac.discount, src: r.src, controller: r.controller });
  }
  return out;
}

/** Destinations reachable without paying a play rule's destination cost. */
function freeDestinations(g: GameState, p: PlayerId, id: ObjId, via: PlayVia): Destination[] {
  const all = destinations(g, p, id, via);
  const costly = new Set(ruleAdditionalCosts(g, p, id).map(x => x.dest).filter(d => d !== null));
  if (!costly.size) return all;
  // a destination is "costly" only if it isn't legal otherwise
  const saved = all.filter(d => !costly.has(d));
  const otherwise = withoutRuleDest(g, p, id, via);
  return all.filter(d => saved.includes(d) || otherwise.includes(d));
}
function withoutRuleDest(g: GameState, p: PlayerId, id: ObjId, via: PlayVia): Destination[] {
  suppressRuleDest = true;
  try { return destinations(g, p, id, via); } finally { suppressRuleDest = false; }
}
let suppressRuleDest = false;

// ---------------- costs ----------------

type CostScope = NonNullable<CostModAbility['scope']>;
/** ref/src: which ability on which object produced it (transient, to recognise a hit when the costs are recomputed) */
interface ModHit { e: number; pw: number; min?: number; delayedId?: string; either?: { energy?: number; power?: number }[]; optional?: string; choice?: number; declined?: boolean; ref?: unknown; src?: ObjId | null }

/** Cost modifications that apply to object `id` (being played / whose ability is used) for a scope. */
export function costMods(g: GameState, p: PlayerId, id: ObjId, scope: CostScope = 'play', item?: ChainItem, info: { dest?: Destination; from?: string } = {}): ModHit[] {
  const out: ModHit[] = [];
  // a legality probe without targets is evaluated as "no play in progress" (optimistic: optional choices assumed made)
  if (item?.choices.probe && !item.targets.length) item = undefined;
  const consider = (src: ObjId | null, ab: CostModAbility, controller: PlayerId, data?: Record<string, unknown>, delayedId?: string) => {
    if ((ab.scope ?? 'play') !== scope) return;
    const ctx = makeCtx(g, src ?? id, controller, { data: { ...(data ?? {}) }, item });
    ctx.data.payer = p;
    // B8-17 / B1: where the card is being played to, and the zone it is played from
    ctx.data.dest = info.dest ?? item?.choices.dest;
    ctx.data.from = info.from ?? item?.choices.from ?? g.objects[id]?.zone;
    if (ab.applies(ctx, id)) out.push({ e: ab.energy ?? 0, pw: ab.power ?? 0, min: ab.minEnergy, delayedId, either: ab.either, optional: ab.optional, ref: ab, src });
  };
  for (const src of abilitySources(g)) {
    const so = g.objects[src];
    if (!getScript(so.cardId) && !so.modifiers.some(m => m.grants?.length)) continue;
    for (const r of allAbilities(g, src)) if (r.ability.kind === 'costMod' && !r.ability.selfOnly) consider(r.viaHost ?? src, r.ability, abilityController(g, r.viaHost ?? src));
  }
  const s = getScript(g.objects[id].cardId);
  for (const ab of s?.abilities ?? []) if (ab.kind === 'costMod' && ab.selfOnly && dependenciesMet(g, id, ab)) consider(id, ab, p);
  for (const d of g.ex.delayed) { const ab = getDelayed(d.key); if (ab?.kind === 'costMod' && d.controller === p) consider(d.source, ab, d.controller, d.data, d.id); }
  return out;
}

/** consume one use of delayed abilities that were applied ("the next unit you play costs ...") */
export function consumeDelayed(g: GameState, ids: (string | undefined)[]): void {
  for (const id of ids) {
    if (!id) continue;
    const d = g.ex.delayed.find(x => x.id === id);
    if (!d || d.uses === undefined) continue;
    d.uses--;
    if (d.uses <= 0) g.ex.delayed = g.ex.delayed.filter(x => x.id !== id);
  }
}

export function applyMods(c: ResolvedCost, mods0: ModHit[]): ResolvedCost {
  // either-discounts use the chosen option (default: the first); declined optional discounts don't apply
  const mods = mods0.filter(m => !m.declined).map(m => (m.either?.length ? { ...m, e: m.either[m.choice ?? 0].energy ?? 0, pw: m.either[m.choice ?? 0].power ?? 0 } : m));
  const r: ResolvedCost = { ...c, power: [...c.power] };
  // increases first, then discounts (CR 356)
  for (const m of mods) { if (m.e > 0) r.energy += m.e; for (let i = 0; i < m.pw; i++) r.power.push('any'); }
  for (const m of mods) {
    if (m.e < 0) r.energy = Math.max(Math.min(r.energy, m.min ?? 0), r.energy + m.e);   // "to a minimum of N" never raises a cost
    for (let i = 0; i < -m.pw; i++) {
      const k = r.power.indexOf('any');
      if (k >= 0) r.power.splice(k, 1); else if (r.power.length) r.power.pop();
    }
  }
  return r;
}

/** The base cost of a play before modifications. */
function basePlayCost(g: GameState, opt: PlayOption): ResolvedCost {
  const id = opt.obj;
  const c = chars(g, id);
  const doms = c.domains;
  if (opt.via === 'hidden') return { energy: 0, power: [] };
  if (opt.via === 'flow') return resolveCost(keywordCost(g, id, 'Flow'), doms);
  if (opt.via === 'permission' && opt.permission?.cost) return resolveCost(opt.permission.cost, doms);
  return { energy: c.energy ?? 0, power: resolveCost({ power: new Array(c.power ?? 0).fill('C') }, doms).power };
}

/** Total cost before optional additional costs and Deflect. */
export function playCost(g: GameState, p: PlayerId, opt: PlayOption, item?: ChainItem, hits?: ModHit[], info: { dest?: Destination; from?: string } = {}, add?: ResolvedCost): ResolvedCost {
  const id = opt.obj;
  const c = chars(g, id);
  const doms = c.domains;
  let base: ResolvedCost;
  if (opt.via === 'hidden') base = { energy: 0, power: [] };
  else if (opt.via === 'flow') base = resolveCost(keywordCost(g, id, 'Flow'), doms);
  else if (opt.via === 'permission' && opt.permission?.cost) base = resolveCost(opt.permission.cost, doms);
  else base = { energy: c.energy ?? 0, power: resolveCost({ power: new Array(c.power ?? 0).fill('C') }, doms).power };
  const ms = costMods(g, p, id, 'play', item, info);
  if (hits) hits.push(...ms);
  return applyMods(add ? addCosts(base, add) : base, ms);
}

/** BASICS BX-4 (PlayerView.costs): the current cost of playing a card from hand / the champion zone, or null if it can't be computed. */
export function effectivePlayCost(g: GameState, p: PlayerId, id: ObjId): ResolvedCost | null {
  const o = g.objects[id];
  if (!o) return null;
  try {
    const c = playCost(g, p, { obj: id, via: o.zone === 'championZone' ? 'champion' : 'hand' });
    return { energy: c.energy, power: c.power };
  } catch { return null; }
}

export function purposeOf(g: GameState, id: ObjId): Purpose {
  const t = chars(g, id).type;
  return t === 'Spell' ? 'spell' : t === 'Unit' ? 'unit' : t === 'Gear' ? 'gear' : 'other';
}

function accelerateCost(g: GameState, p: PlayerId, id: ObjId): ResolvedCost {
  const s = getScript(g.objects[id].cardId);
  const base = s?.costs?.Accelerate ? resolveCost(s.costs.Accelerate, chars(g, id).domains) : resolveCost({ energy: 1, power: ['C'] }, chars(g, id).domains);
  return applyMods(base, costMods(g, p, id, 'additional'));
}

// ---------------- legality (enumeration helpers) ----------------

/**
 * Can every mandatory choice group be filled in some consistent way (F-3a, R-5)? Groups are tried in order with the earlier
 * picks visible (ctx.targets, as when choosing), so "X and another friendly unit" with one friendly unit is not playable.
 * Bounded search: up to 6 candidates per group.
 */
export function hasLegalTargets(g: GameState, ctx: Ctx, specs: TargetSpec[] | undefined, from = 0, chosen0: ObjId[][] = []): boolean {
  const list = specs ?? [];
  if (from >= list.length) return true;
  const saved = ctx.targets;
  let budget = 200;
  const rec = (i: number, chosen: ObjId[][]): boolean => {
    if (i === list.length) return true;
    if (--budget < 0) return true;                       // give up optimistically on huge searches
    const s = list[i];
    ctx.targets = chosen;
    const cands = candidatesFor(g, ctx, s);
    const min = s.min ?? 1;
    if (min > 0 && cands.length < min) return false;
    if (min === 0 && rec(i + 1, [...chosen, []])) return true;
    if (min > 1) return rec(i + 1, [...chosen, cands.slice(0, min)]);
    for (const c of cands.slice(0, 6)) if (rec(i + 1, [...chosen, [c]])) return true;
    return false;
  };
  try { return rec(from, chosen0); } finally { ctx.targets = saved; }
}

function modesAvailable(g: GameState, ctx: Ctx, modes: Mode[]): Mode[] {
  return modes.filter(m => (!m.condition || m.condition(ctx)) && hasLegalTargets(g, ctx, m.targets));
}

/** All cost variants for a play: either-discount choices (optional discounts assumed taken). */
function costVariants(g: GameState, p: PlayerId, opt: PlayOption, item?: ChainItem, dest?: Destination, add?: ResolvedCost): ResolvedCost[] {
  const hits: ModHit[] = [];
  playCost(g, p, opt, item, hits, { dest });
  const eithers = hits.map((h, i) => (h.either?.length ? i : -1)).filter(i => i >= 0).slice(0, 3);
  // CR 356 (RJ#9237/#2734): mandatory additional costs (Deflect, destination costs) are added before the cost modifications
  const total0 = add ? addCosts(basePlayCost(g, opt), add) : basePlayCost(g, opt);
  const base = (choices: number[]) => {
    const hs = hits.map((h, i) => (eithers.includes(i) ? { ...h, choice: choices[eithers.indexOf(i)] } : h));
    return applyMods(total0, hs);
  };
  if (!eithers.length) return [applyMods(total0, hits)];
  const out: ResolvedCost[] = [];
  const rec = (k: number, acc: number[]) => {
    if (k === eithers.length) { out.push(base(acc)); return; }
    for (let c = 0; c < (hits[eithers[k]].either!.length); c++) rec(k + 1, [...acc, c]);
  };
  rec(0, []);
  return out;
}

function probeItem(g: GameState, p: PlayerId, id: ObjId, targets: ObjId[][], dest?: Destination): ChainItem {
  return { id: 'probe', kind: 'spell', source: id, controller: p, targets, choices: { dest, from: g.objects[id]?.zone, probe: true }, pending: true };
}

/** Can the player pay for this play in at least one legal way (incl. discounts that need a choice)? */
function affordablePlay(g: GameState, p: PlayerId, opt: PlayOption, dest: Destination | undefined, firstGroup: ObjId[] | null, needRule: ResolvedCost | null): boolean {
  const id = opt.obj;
  const purpose = purposeOf(g, id);
  const c = chars(g, id);
  const sc = getScript(c.copyOf ?? g.objects[id].cardId);
  const optional = [...(sc?.additionalCosts ?? []).filter(a => a.optional && a.discount).map(a => ({ cost: resolveCost(a.cost, c.domains), discount: a.discount! })),
    ...ruleAdditionalCosts(g, p, id).filter(r => r.dest === null && r.discount).map(r => ({ cost: r.cost, discount: r.discount! }))];
  const ok = (total: ResolvedCost): boolean => {
    if ((!total.extra?.length || canPayNonResource(g, p, id, total)) && canAfford(g, p, { energy: total.energy, power: total.power }, purpose)) return true;
    for (const o of optional) {
      const with_ = applyMods(addCosts(total, o.cost), [{ e: o.discount.energy ?? 0, pw: o.discount.power ?? 0 }]);
      if ((!with_.extra?.length || canPayNonResource(g, p, id, with_)) && canAfford(g, p, { energy: with_.energy, power: with_.power }, purpose)) return true;
    }
    return false;
  };
  // F-3b: with a mandatory first target group, only costs with a real first pick count (Deflect, target discounts)
  if (!firstGroup) for (const v of costVariants(g, p, opt, probeItem(g, p, id, [], dest), dest, needRule ?? undefined)) if (ok(v)) return true;
  // B7-8: discounts that depend on the chosen targets
  if (firstGroup) for (const t of firstGroup.slice(0, 16)) {
    const item = probeItem(g, p, id, [[t]], dest);
    const defl = deflectCost(g, p, [t]);
    const add = addCosts(needRule ?? { energy: 0, power: [] }, { energy: 0, power: new Array(defl).fill('any') });
    for (const v of costVariants(g, p, opt, item, dest, add)) if (ok(v)) return true;
  }
  return false;
}

/** Can p legally start playing this card now (timing, destination, targets, min cost)? */
export function canPlay(g: GameState, p: PlayerId, opt: PlayOption, dest?: Destination): boolean {
  const w = currentWindow(g, p);
  if (!w) return false;
  const id = opt.obj;
  const o = g.objects[id];
  if (!o) return false;
  const c = chars(g, id);
  if (c.type !== 'Unit' && c.type !== 'Gear' && c.type !== 'Spell') return false;
  const isPerm = c.type !== 'Spell';
  if (!isPerm && ruleApplies(g, 'cantPlay', id, p, null)) return false;
  const sc = getScript(c.copyOf ?? o.cardId);
  for (const ac of sc?.additionalCosts ?? []) if (!ac.optional) { const rc = resolveCost(ac.cost, c.domains); if (rc.extra?.length && !canPayNonResource(g, p, id, rc)) return false; }
  let dests: Destination[] = [];
  if (isPerm) {
    dests = destinations(g, p, id, opt.via);
    if (dest !== undefined) { if (!dests.includes(dest)) return false; dests = [dest]; }
    dests = dests.filter(d => timingAllows(cardTiming(g, p, id, { fromHidden: opt.via === 'hidden', dest: d }), w));
    if (dests.length === 0) return false;
  } else if (!timingAllows(cardTiming(g, p, id, { fromHidden: opt.via === 'hidden' }), w)) return false;
  const ctx = makeCtx(g, id, p);
  if (opt.via === 'hidden') ctx.data.hiddenHere = o.battlefieldIndex;
  const sp = spellAbility(g, id);
  let firstGroup: ObjId[] | null = null;
  if (sp) {
    if (sp.playIf && !sp.playIf(ctx)) return false;
    if (sp.modes) { if (modesAvailable(g, ctx, sp.modes).length < (sp.chooseModes ?? 1)) return false; }
    else {
      if (!hasLegalTargets(g, ctx, sp.targets)) return false;
      if (sp.targets?.[0] && !sp.targets[0].pick && sp.targets[0].kind !== 'destination' && (sp.targets[0].min ?? 1) > 0) firstGroup = candidatesFor(g, ctx, sp.targets[0]);
    }
  }
  if (isPerm) {
    const free = freeDestinations(g, p, id, opt.via);
    const ruleCosts = ruleAdditionalCosts(g, p, id);
    return dests.some(d => affordablePlay(g, p, opt, d, null, free.includes(d) ? null : (ruleCosts.find(r => r.dest === d)?.cost ?? null)));
  }
  return affordablePlay(g, p, opt, undefined, firstGroup, null);
}

// ---------------- the play process ----------------

/** Chain item ids are derived from the state only (replays must reproduce them exactly). */
export function newItemId(g: GameState): string {
  const n = (g.ex.counts.__itemSeq ?? 0) + 1;
  g.ex.counts.__itemSeq = n;
  return `c${g.timestamp + 1}_${n}`;
}

function chooseTargetsFor(g: GameState, ctx: Ctx, p: PlayerId, specs: TargetSpec[] | undefined, costFn: ((targets: ObjId[][], add?: ResolvedCost) => ResolvedCost) | null, purpose: Purpose, prefix = '', opts: { rollbackIfEmpty?: boolean } = {}): { targets: ObjId[][]; splits: Record<string, Record<ObjId, number>> } {
  const targets: ObjId[][] = [];
  const splits: Record<string, Record<ObjId, number>> = {};
  const prevTargets = ctx.targets;
  ctx.targets = targets;           // earlier groups are visible to later filters (ctx.target(0) while choosing group 1)
  (specs ?? []).forEach((spec, i) => {
    let cands = candidatesFor(g, ctx, spec);
    // CR 355.16: don't offer choices that make the play impossible to pay for (Deflect, target-dependent cost changes)
    if (costFn && !spec.pick && spec.kind !== 'destination') {
      const already = targets.map(x => [...x]);
      // if the play isn't affordable yet even without this choice, it relies on a discount offered later (an optional additional
      // cost after targets: Starry-Eyed Songstress's "[2] less"; canPlay counted it) — then only drop choices that raise the cost
      // (FUZZ d2d4803d9e recurrence, seed 737526)
      const base = costFn(already, { energy: 0, power: new Array(deflectCost(g, p, already.flat())).fill('any') });
      const baseOk = canAfford(g, p, base, purpose);
      cands = cands.filter(id => {
        const trial = [...already, [id]];
        const extra = deflectCost(g, p, trial.flat());
        const tc = costFn(trial, { energy: 0, power: new Array(extra).fill('any') });
        if (canAfford(g, p, tc, purpose)) return true;
        return !baseOk && tc.energy <= base.energy && tc.power.length <= base.power.length;
      });
    }
    // CR 355.16: don't offer a pick after which the later required groups can't be filled (F-3a)
    if (i + 1 < (specs ?? []).length && cands.length > 1) {
      const already = targets.map(x => [...x]);
      const ok = cands.filter(c => hasLegalTargets(g, ctx, specs, i + 1, [...already, [c]]));
      ctx.targets = targets;
      if (ok.length) cands = ok;
    }
    // R-5 (CR 355.17, 358.5): a required choice that can't be made makes the play illegal
    if ((spec.min ?? 1) > 0 && cands.length === 0 && opts.rollbackIfEmpty) throw new Rollback('a required target is no longer available');
    let maxT = spec.max ?? 1;
    if (spec.splitAmount !== undefined) {
      const amt = typeof spec.splitAmount === 'function' ? spec.splitAmount(ctx) : spec.splitAmount;
      // CR 715.3: Bonus Damage raises the amount to split, which can raise the number of eligible recipients (Volibear + Annie: 6)
      const bonus = amt > 0 ? Math.max(0, ...cands.map(id => bonusDamageFor(g, { type: 'damage', obj: id, amount: amt, source: ctx.self, player: p, combat: false }))) : 0;
      maxT = Math.min(maxT, amt + bonus);
    }
    const min = Math.min(spec.min ?? 1, cands.length), max = Math.min(maxT, cands.length);
    let ids: ObjId[] = [];
    if (cands.length > 0 && max > 0) {
      const check = spec.sameLocation ? 'sameLocation' : spec.maxTotalMight !== undefined || spec.sameController ? 'groupRules' : undefined;
      ids = chooseGroup(g, p, spec, spec.prompt ?? (spec.kind === 'destination' ? 'Choose a destination' : `Choose target${max > 1 ? 's' : ''}`),
        cands, id => ctx.labelOf(id), min, max,
        { source: ctx.self, hint: spec.hint, data: check ? { check, maxTotalMight: spec.maxTotalMight, sameController: spec.sameController } : undefined });
    }
    targets.push(ids);
    void prefix;
    for (const id of ids) if (!spec.pick && spec.kind !== 'destination' && g.objects[id]) emitTargeted(g, id, p, ctx.self);
  });
  ctx.targets = prevTargets.length ? prevTargets : targets;
  return { targets, splits };
}

/** B4-11 data-only group constraints: total Might ≤ N, all with the same controller. */
registerValidator('groupRules', (g, d, a) => {
  if (a.type !== 'choose') return 'expected choose';
  const max = d.data?.maxTotalMight as number | undefined;
  if (max !== undefined) { const tot = a.optionIds.reduce((s, id) => s + Math.max(0, chars(g, id).might ?? 0), 0); if (tot > max) return `total Might must be ${max} or less`; }
  if (d.data?.sameController && new Set(a.optionIds.map(id => g.objects[id]?.controller)).size > 1) return 'all choices must have the same controller';
  return null;
});

registerValidator('sameLocation', (g, d, a) => {
  if (a.type !== 'choose') return 'expected choose';
  const locs = new Set(a.optionIds.map(id => { const l = locOf(g, id); return l === 'base' ? `b${g.objects[id].controller}` : String(l); }));
  return locs.size <= 1 ? null : 'all choices must be at the same location';
});

registerValidator('payment', (g, d, a) => {
  if (a.type !== 'choose') return 'expected choose';
  if (a.optionIds.length === 1 && a.optionIds[0] === 'auto') return null;
  if (a.optionIds.length === 1 && a.optionIds[0] === 'manual') {
    const cost = d.data!.cost as ResolvedCost;
    if (!a.data) return 'manual payment needs a PaymentPlan in data';
    return validatePlan(g, d.player, cost, d.data!.purpose as Purpose, a.data as PaymentPlan, { exclude: d.data!.exclude as ObjId | undefined });
  }
  return 'choose auto or manual (with a PaymentPlan in data)';
});

/** Pay resources: manual plan from the action, a 'payment' decision, or auto-pay. Throws Rollback if impossible. */
function payResources(g: GameState, p: PlayerId, cost: ResolvedCost, purpose: Purpose, plan: PaymentPlan | undefined, source: ObjId, exclude?: ObjId): void {
  if (cost.energy === 0 && cost.power.length === 0) return;
  if (plan) {
    const err = validatePlan(g, p, cost, purpose, plan, { exclude });
    if (err) throw new Rollback(`invalid payment: ${err}`);
    executePayment(g, p, cost, purpose, plan);
    return;
  }
  const auto = autoPay(g, p, cost, purpose, { exclude });
  if (!auto) throw new Rollback(`cannot pay ${costLabel(cost)}`);
  executePayment(g, p, cost, purpose, choosePayment(g, p, cost, purpose, auto, source, { exclude }));
}

function deflectFor(g: GameState, p: PlayerId, targets: ObjId[][], specs: (TargetSpec | undefined)[]): number {
  const ids: ObjId[] = [];
  targets.forEach((grp, i) => { if (!specs[i]?.pick) ids.push(...grp); });
  return deflectCost(g, p, ids);
}

/** How an effect-play pays: full cost, free, Energy ignored (Power still paid), reduced, or a replacement cost. */
export type EffectCostMode = 'full' | 'free' | 'noEnergy' | { reduce: number; power?: number } | { pay: import('./abilities.ts').CostSpec };

interface PlayProcOpts {
  dest?: Destination; plan?: PaymentPlan; mode?: string; ignoreCost?: boolean; byEffect?: boolean;
  costMode?: EffectCostMode; destinations?: Destination[]; leaveTo?: 'banish' | 'recycle' | 'hand'; noAdditional?: boolean;
}

function effectBaseCost(g: GameState, p: PlayerId, opt: PlayOption, mode: EffectCostMode, item?: ChainItem, add?: ResolvedCost): ResolvedCost {
  if (mode === 'free') return { energy: 0, power: [] };
  const c = chars(g, opt.obj);
  if (typeof mode === 'object' && 'pay' in mode) return resolveCost(mode.pay, c.domains);
  const full = playCost(g, p, { ...opt, via: opt.via === 'hidden' ? 'hand' : opt.via }, item, undefined, {}, add);
  if (mode === 'noEnergy') return { ...full, energy: 0 };
  if (typeof mode === 'object' && 'reduce' in mode) {
    const r: ResolvedCost = { ...full, energy: Math.max(0, full.energy - mode.reduce), power: [...full.power] };
    for (let i = 0; i < (mode.power ?? 0) && r.power.length; i++) { const k = r.power.indexOf('any'); r.power.splice(k >= 0 ? k : 0, 1); }
    return r;
  }
  return full;
}

function playProcess(g: GameState, p: PlayerId, opt: PlayOption, po: PlayProcOpts): void {
  const id = opt.obj;
  const o = g.objects[id];
  const c = chars(g, id);
  const isPerm = c.type === 'Unit' || c.type === 'Gear';
  const fromZone = o.zone;
  const fromHidden = opt.via === 'hidden';
  const hiddenBf = fromHidden ? o.battlefieldIndex : undefined;
  const wasEmpty = g.chain.length === 0;
  const purpose = purposeOf(g, id);
  const costMode: EffectCostMode = po.costMode ?? (po.ignoreCost ? 'free' : 'full');
  const byEffect = !!po.byEffect;
  const grants = playGrants(g, id);       // keywords granted while being played (consumed on finalize)
  // R-13 ("can't" beats "can"): "can't be played" restrictions apply to plays by effects too
  if (!isPerm && ruleApplies(g, 'cantPlay', id, p, null)) throw new Rollback("that card can't be played");
  { const sp0 = spellAbility(g, id); if (sp0?.playIf && !sp0.playIf(makeCtx(g, id, p))) throw new Rollback("that card can't be played now"); }

  // destination (CR 355.2)
  let dest: Destination | undefined;
  let ruleCostNeeded: ReturnType<typeof ruleAdditionalCosts>[number] | null = null;
  if (isPerm) {
    let ds: Destination[];
    if (po.destinations?.length) ds = po.destinations.filter(d => (d === 'base' || canEnterBattlefield(g, d, p)) && !ruleApplies(g, 'cantPlay', id, p, d));   // B7-3, R-13
    else {
      const all = destinations(g, p, id, opt.via);
      const w = currentWindow(g, p);
      ds = byEffect ? all : all.filter(d => w && timingAllows(cardTiming(g, p, id, { fromHidden, dest: d }), w));
    }
    if (po.dest !== undefined) {
      if (!ds.includes(po.dest)) throw new Rollback('illegal destination');
      dest = po.dest;
      // VEN-FAQ (Dragon Roost; RJ#12173, T182): an effect's location and a play rule whose optional additional cost plays the card
      // elsewhere are competing location requirements — the player picks one (paying that cost for the other location)
      if (byEffect && !po.noAdditional) {
        const fixed = po.dest;
        const alts = ruleAdditionalCosts(g, p, id).filter(r => r.dest !== null && r.dest !== fixed && ds.includes(r.dest) && canAfford(g, p, r.cost, purpose) && (!r.cost.extra?.length || canPayNonResource(g, p, id, r.cost)));
        if (alts.length) {
          const lbl = (d: Destination) => d === 'base' ? 'Base' : cardName(g, g.battlefields[d].objId);
          const pick = chooseOne(g, p, 'chooseDestination', `Play ${c.name} to`, [{ id: String(fixed), label: lbl(fixed) }, ...alts.map(a => ({ id: String(a.dest), label: `${lbl(a.dest!)} (${a.label})` }))], { source: id });
          const alt = alts.find(a => String(a.dest) === pick);
          if (alt) { dest = alt.dest!; ruleCostNeeded = alt; }
        }
      }
    }
    else if (ds.length === 0) throw new Rollback('no legal destination');
    else if (ds.length === 1) dest = ds[0];
    else {
      const r = chooseOne(g, p, 'chooseDestination', `Play ${c.name} to`, ds.map(d => ({ id: String(d), label: d === 'base' ? 'Base' : cardName(g, g.battlefields[d].objId) })), { source: id });
      dest = r === 'base' ? 'base' : Number(r);
    }
    if (!po.destinations?.length && !freeDestinations(g, p, id, opt.via).includes(dest!)) ruleCostNeeded = ruleAdditionalCosts(g, p, id).find(r => r.dest === dest) ?? null;
  }

  // 1. move to the chain as a pending item (CR 354)
  moveToZone(g, id, 'chain', { controller: p });
  g.objects[id].controller = p;
  const item: ChainItem = { id: newItemId(g), kind: 'spell', source: id, controller: p, targets: [], choices: { dest, from: fromZone }, pending: true, label: c.name, fromHidden, viaFlow: opt.via === 'flow', from: fromZone, leaveTo: po.leaveTo };
  g.chain.push(item);

  const ctx = makeCtx(g, id, p, { item });
  if (fromHidden) ctx.data.hiddenHere = hiddenBf;

  // 2. choices: as-play, optional costs decided before targets, modes, targets
  const script = getScript(c.copyOf ?? g.objects[id].cardId);
  PENDING_EXTRA.delete(item.id);
  for (const ab of script?.abilities ?? []) if (ab.kind === 'asPlay') (ab as AsPlayAbility).effect(ctx);
  // B3-4: an "as you play" effect may set the destination ("If you do, I enter there")
  if (isPerm && ctx.data.__destination !== undefined) { const d = ctx.data.__destination as Destination; if (d === 'base' || (typeof d === 'number' && g.battlefields[d])) { if (dest !== undefined && dest !== d) ctx.data.__chosenDest = dest; dest = d; item.choices.dest = d; item.choices.keepsDestination = true; } delete ctx.data.__destination; }
  const costNow = (targets: ObjId[][] = item.targets, add?: ResolvedCost): ResolvedCost => {
    const probe = { ...item, targets };
    if (costMode === 'full') return playCost(g, p, opt, probe, undefined, { dest }, add);
    if (typeof costMode === 'object' && 'reduce' in costMode) return effectBaseCost(g, p, opt, costMode, probe, add);
    const b = effectBaseCost(g, p, opt, costMode, probe);
    return add ? addCosts(b, add) : b;
  };
  const extraDiscounts: ModHit[] = [];
  // `noAdditional` = "ignoring any and all costs" (Bone Skewer): CR 356 step 2 still adds the chosen optional additional costs, then
  // step 5 makes the total 0 — so optional ones may be chosen for free and count as paid (RJ#10266, ENGINE-9); mandatory ones
  // are not paid (RJ#12433)
  const allFree = !!po.noAdditional;
  const additional = (script?.additionalCosts ?? []).filter(ac => !allFree || ac.optional);
  let extraCost: ResolvedCost = { energy: 0, power: [] };
  const offerAdditional = (ac: NonNullable<CardScript['additionalCosts']>[number]) => {
    if (allFree) {
      if (!askYesNo(g, p, `${ac.label ?? `Pay ${costLabel(resolveCost(ac.cost, c.domains))} as an additional cost`}? (all costs are ignored: free)`, id)) return;
      if (ac.keepsDestination) item.choices.keepsDestination = true;
      ctx.data[ac.key ?? 'paidAdditional'] = true;
      return;
    }
    let rc = resolveCost(ac.cost, c.domains);
    if (ac.optional) {
      rc = applyMods(rc, costMods(g, p, id, 'additional'));
      const disc = ac.discount ? [{ e: ac.discount.energy ?? 0, pw: ac.discount.power ?? 0 }] : [];
      const nonRes = rc.extra?.length ? canPayNonResource(g, p, id, rc) : true;
      if (!nonRes || !canAfford(g, p, applyMods(addCosts(addCosts(costNow(), extraCost), rc), disc), purpose)) return;
      // F-3c / CR 355.16: don't offer "no" when declining makes the play unpayable (the discount is then required)
      const withoutOk = costMode === 'free' || canAfford(g, p, applyMods(addCosts(costNow(), extraCost), extraDiscounts), purpose);
      if (withoutOk && !askYesNo(g, p, `${ac.label ?? `Pay ${costLabel(rc)} as an additional cost`}?`, id)) return;
    }
    extraCost = addCosts(extraCost, rc);
    if (ac.discount) extraDiscounts.push({ e: ac.discount.energy ?? 0, pw: ac.discount.power ?? 0 });
    if (ac.keepsDestination) item.choices.keepsDestination = true;
    ctx.data[ac.key ?? 'paidAdditional'] = true;
  };
  for (const ac of additional) if (ac.beforeTargets) offerAdditional(ac);   // B1-13

  const sp = spellAbility(g, id);
  const specs: (TargetSpec | undefined)[] = [];
  const costFn = costMode === 'free' ? null : (t: ObjId[][], add?: ResolvedCost) => applyMods(costNow(t, add ? addCosts(extraCost, add) : extraCost), extraDiscounts);
  if (sp) {
    if (sp.modes) {
      const avail = modesAvailable(g, ctx, sp.modes);
      const n = Math.min(sp.chooseModes ?? 1, avail.length);
      if (n === 0) throw new Rollback('no mode can be chosen');
      let picked: string[];
      if (po.mode && avail.some(m => m.id === po.mode) && n === 1) picked = [po.mode];
      else picked = chooseOptions(g, p, 'chooseMode', `${c.name}: choose ${n === 1 ? 'one' : n}`, avail.map(m => ({ id: m.id, label: m.label })), n, n, { source: id });
      item.mode = picked.join(',');
      for (const mid of picked) {
        const m = avail.find(x => x.id === mid)!;
        const r = chooseTargetsFor(g, ctx, p, m.targets, costFn ? t => costFn([...item.targets, ...t]) : null, purpose, `${mid}:`, { rollbackIfEmpty: true });
        item.choices[`targets:${mid}`] = r.targets;
        (m.targets ?? []).forEach(s2 => specs.push(s2));
        item.targets.push(...r.targets);
      }
    } else {
      const r = chooseTargetsFor(g, ctx, p, sp.targets, costFn, purpose, '', { rollbackIfEmpty: true });
      item.targets = r.targets;
      (sp.targets ?? []).forEach(s2 => specs.push(s2));
    }
  }
  item.targetEpochs = item.targets.map(grp => grp.map(t => g.objects[t]?.epoch ?? 0));

  // 3. total cost with the choices known (CR 356): base cost + additional costs (Deflect, script/rule additional costs,
  // Accelerate, Repeat), then increases, then discounts on that total (RJ#9237 Vex + Deflect, RJ#2734 Void Rush + Repeat)
  const hits: ModHit[] = [];
  const defl = deflectFor(g, p, item.targets, specs);
  const deflAdd: ResolvedCost = { energy: 0, power: new Array(defl).fill('any') };
  let base: ResolvedCost;
  let mods: ModHit[] = [];
  const reduceMode = typeof costMode === 'object' && 'reduce' in costMode ? costMode : null;
  if (costMode === 'full' || reduceMode) {
    playCost(g, p, opt, item, hits, { dest });
    // B8-6 "[1] or [A] less": ask when both choices matter; B8-10 optional discounts: ask
    for (const h of hits) {
      if (h.optional && !askYesNo(g, p, h.optional, id)) h.declined = true;
      if (h.either && h.either.length > 1 && !h.declined) {
        const pre = applyMods(addCosts(basePlayCost(g, opt), deflAdd), hits.filter(x => x !== h));
        const useful = h.either.map((e, i) => ({ i, ok: (e.energy ? pre.energy > 0 : true) && (e.power ? pre.power.length > 0 : true) })).filter(x => x.ok);
        if (useful.length > 1) h.choice = Number(chooseOne(g, p, 'chooseMode', 'Which cost reduction?', useful.map(u => ({ id: String(u.i), label: h.either![u.i].energy ? `[${-(h.either![u.i].energy!)}] less` : `[A] less` })), { source: id }));
        else if (useful.length === 1) h.choice = useful[0].i;
      }
    }
    base = basePlayCost(g, opt);
    mods = reduceMode ? [...hits, { e: -reduceMode.reduce, pw: -(reduceMode.power ?? 0) }] : hits;
  } else base = effectBaseCost(g, p, opt, costMode, item);
  // the additional costs (mandatory, and optional ones once chosen) are summed in `add`; total() applies the modifications
  let add: ResolvedCost = { energy: 0, power: [] };
  const total = (more?: ResolvedCost): ResolvedCost => applyMods(addCosts(base, more ? addCosts(add, more) : add), [...mods, ...extraDiscounts]);
  if (ctx.data.__extraCost) add = addCosts(add, resolveCost(ctx.data.__extraCost as import('./abilities.ts').CostSpec, c.domains));
  const sideExtra = PENDING_EXTRA.get(item.id); PENDING_EXTRA.delete(item.id);
  if (sideExtra?.length) add = addCosts(add, { energy: 0, power: [], extra: sideExtra });
  // Deflect (CR 809): a mandatory additional cost
  if (defl > 0) add = addCosts(add, deflAdd);
  // additional costs from the script (mandatory / optional), then from play rules
  for (const ac of additional) if (!ac.beforeTargets) offerAdditional(ac);
  add = addCosts(add, extraCost);
  if (ruleCostNeeded) { add = addCosts(add, ruleCostNeeded.cost); ctx.data[ruleCostNeeded.key] = true; }
  if (!po.noAdditional) for (const rc of ruleAdditionalCosts(g, p, id)) {
    if (rc.dest !== null) continue;
    const nonRes = rc.cost.extra?.length ? canPayNonResource(g, p, id, rc.cost) : true;
    const disc = rc.discount ? [{ e: rc.discount.energy ?? 0, pw: rc.discount.power ?? 0 }] : [];
    if (!nonRes || !canAfford(g, p, applyMods(total(rc.cost), disc), purpose)) continue;
    const withoutOk = canAfford(g, p, total(), purpose);   // F-3c
    if (withoutOk && !askYesNo(g, p, `${rc.label}?`, id)) continue;
    add = addCosts(add, rc.cost);
    extraDiscounts.push(...disc);
    ctx.data[rc.key] = true;
  }

  // optional additional costs: Accelerate (units), Repeat (spells) — printed or granted
  // keywords it had where it was played from (modifiers given in hand) or has now (play grants, chain statics)
  const kNow = chars(g, id).keywords;
  const kws = { has: (k: string) => c.keywords.has(k as never) || kNow.has(k as never) };
  if (allFree && c.type === 'Unit' && kws.has('Accelerate')) {
    if (askYesNo(g, p, 'Accelerate (enter ready)? (all costs are ignored: free)', id)) item.choices.accelerate = true;
  } else if (c.type === 'Unit' && kws.has('Accelerate')) {
    const acc = accelerateCost(g, p, id);
    if (canAfford(g, p, total(acc), purpose) && askYesNo(g, p, `Pay ${costLabel(acc)} for Accelerate (enter ready)?`, id)) {
      add = addCosts(add, acc); item.choices.accelerate = true;
    }
  }
  if (kws.has('Repeat')) {
    // B5-5: each Repeat cost may be paid once
    const list = keywordCosts(g, id, 'Repeat');
    for (const rc0 of list) {
      // all costs ignored (allFree): the Repeat may still be chosen, at 0 (CR 356 step 5)
      const rr: ResolvedCost = allFree ? { energy: 0, power: [] } : applyMods(resolveCost(rc0, c.domains), costMods(g, p, id, 'repeat'));
      const nonRes = rr.extra?.length ? canPayNonResource(g, p, id, rr) : true;
      if (!nonRes || !canAfford(g, p, total(rr), purpose)) break;
      if (!askYesNo(g, p, allFree ? `Repeat${list.length > 1 ? ` (${(item.repeat ?? 0) + 1} of ${list.length})` : ''}? (all costs are ignored: free)` : `Pay ${costLabel(rr)} to Repeat${list.length > 1 ? ` (${(item.repeat ?? 0) + 1} of ${list.length})` : ''}?`, id)) break;
      add = addCosts(add, rr); item.repeat = (item.repeat ?? 0) + 1;
      // CR 820.2 / 820.2.a (RJ#92a, #193): the repeated execution's choices are made now, in Make Choices; Deflect is paid for
      // each of them (SFD-FAQ "Falling Star, Icathian Rain, and Deflect")
      const rspecs = specs.filter((s2): s2 is TargetSpec => !!s2);
      if (rspecs.length) {
        const r = chooseTargetsFor(g, ctx, p, rspecs, costMode === 'free' ? null : (_t, more) => total(more), purpose, 'Repeat: ');
        item.choices[`repeatTargets:${item.repeat}`] = { targets: r.targets, epochs: r.targets.map(grp => grp.map(t => g.objects[t]?.epoch ?? 0)) };
        const rd = deflectFor(g, p, r.targets, rspecs);
        if (rd > 0) add = addCosts(add, { energy: 0, power: new Array(rd).fill('any') });
      }
    }
    // RJ#5435: modifications that depend on what is chosen ("spells that choose me cost [1] less") also see the Repeat
    // executions' choices: add the ones that apply now and didn't before (a second Irelia, Graceful)
    if (item.repeat && (costMode === 'full' || reduceMode)) {
      const again: ModHit[] = [];
      playCost(g, p, opt, item, again, { dest });
      for (const h of again) {
        if (hits.some(x => x.ref === h.ref && x.src === h.src) || h.optional) continue;
        if (h.either && h.either.length > 1) {
          // AUTO-AUDIT E5: pick the "[1] or [A] less" reduction that still reduces something, as the first pass does (ask if both do)
          const pre = applyMods(addCosts(base, add), [...mods, ...extraDiscounts]);
          const useful = h.either.map((e, i) => ({ i, ok: (e.energy ? pre.energy > 0 : true) && (e.power ? pre.power.length > 0 : true) })).filter(x => x.ok);
          if (useful.length > 1) h.choice = Number(chooseOne(g, p, 'chooseMode', 'Which cost reduction?', useful.map(u => ({ id: String(u.i), label: h.either![u.i].energy ? `[${-(h.either![u.i].energy!)}] less` : `[A] less` })), { source: id }));
          else h.choice = useful[0]?.i ?? 0;
        }
        hits.push(h); if (mods !== hits) mods.push(h);
      }
    }
  }
  const cost = total();
  item.choices.playData = ctx.data;

  // 4. pay (energy/power first, then other costs: CR 357)
  item.choices.paid = { energy: cost.energy, power: cost.power.length };
  if (cost.energy || cost.power.length || cost.extra?.length) {
    const resPart: ResolvedCost = { energy: cost.energy, power: cost.power };
    payResources(g, p, resPart, purpose, po.plan, id);
    for (const x of cost.extra ?? []) { if (x.pay(ctx) === false) throw new Rollback(`could not pay ${x.label}`); }
  }

  // 5. legality check (CR 358): the destination must still be legal (e.g. Ambush needs a friendly unit there)
  if (isPerm && dest !== undefined && !byEffect && opt.via !== 'hidden' && !item.choices.keepsDestination && !po.destinations) {
    const still = destinations(g, p, id, opt.via);
    if (!still.includes(dest)) throw new Rollback('the chosen location is no longer legal');
  }

  // 6. finalize (CR 359)
  item.pending = false;
  consumeDelayed(g, [...hits.filter(h => !h.declined).map(h => h.delayedId), ...grants.delayedIds]);
  if (opt.via === 'permission') g.ex.playPermissions = g.ex.playPermissions.filter(x => x.obj !== id);
  const pl = g.players[p];
  g.ex.playedThisTurn[p] = [...(g.ex.playedThisTurn[p] ?? []), id];
  g.ex.counts[`played:${p}`] = (g.ex.counts[`played:${p}`] ?? 0) + 1;
  if (c.type === 'Spell') {
    g.ex.counts[`spells:${p}`] = (g.ex.counts[`spells:${p}`] ?? 0) + 1;
    g.ex.counts[`maxSpellEnergy:${p}`] = Math.max(g.ex.counts[`maxSpellEnergy:${p}`] ?? 0, cost.energy);
    g.ex.counts[`spellEnergy:${p}`] = (g.ex.counts[`spellEnergy:${p}`] ?? 0) + cost.energy;
  }
  if (typeof dest === 'number') g.ex.counts[`playedToBf:${p}`] = (g.ex.counts[`playedToBf:${p}`] ?? 0) + 1;
  const paid = item.choices.paid;
  log(g, p, `${pl.name} plays ${c.name}${fromHidden ? ' from hiding' : ''}${dest !== undefined ? (dest === 'base' ? ' to base' : ' to ' + cardName(g, g.battlefields[dest].objId)) : ''}`, [id, ...item.targets.flat().filter(t => g.objects[t])]);

  if (isPerm) {
    g.chain = g.chain.filter(x => x.id !== item.id);
    const entry: DeferredPlay = { p, id, dest: dest!, accelerate: !!item.choices.accelerate, playData: ctx.data, fromHidden, cardType: c.type, from: fromZone, paid, byEffect, qts: g.timestamp };
    // CR 354.4 / 158.3 (RJ#117, #6683, #9227): a permanent played while a spell or ability resolves waits until that
    // resolution finishes; it can't see the rest of that effect (Karma vs Reinforce's recycle, Diana vs Heedless Resurrection)
    const waiting = g.ex.memo.__resolving ? (g.ex.memo.__deferredPlays as DeferredPlay[] | undefined) : undefined;
    if (waiting && byEffect) { waiting.push(entry); log(g, p, `${c.name} enters when ${g.ex.memo.__resolvingLabel ?? 'the effect'} finishes`); }
    else finishPermanentPlay(g, entry);
    // RJ#11052 (CR 337.2, 339.1, 346.1, 347.2.a): a permanent played into an empty chain during a showdown is a chain item that
    // finalizes and resolves at once — the passes in succession start over and focus passes, as after any played card's chain
    if (wasEmpty && !byEffect && g.showdown && g.showdown.stage === 'open') { g.showdown.focus = nextPlayer(g, p); g.showdown.passes = []; }
  } else {
    if (wasEmpty) g.ex.chainOpener = { player: p, byTrigger: false };
    // CR 420.4.a.1: "when you play a spell" triggers when play completes by resolution (see chain.ts)
    item.choices.playEvent = { type: 'play', obj: id, player: p, cardType: 'Spell', fromHidden, from: fromZone, item: item.id, paid, byEffect };
    emit(g, { type: 'spellFinalized', obj: id, player: p, fromHidden, from: fromZone, item: item.id, playData: ctx.data, paid, byEffect });
  }
  if (!byEffect) {
    // CR 337 / 338.1.a.5: after finalizing, the controller of the newest chain item gets priority
    g.priority = g.chain.length ? g.chain[g.chain.length - 1].controller : null;
    g.ex.passes = [];
  }
  g.ex.dirty = true;
}

/** Handle a top-level playCard action (validated). */
export function playCardAction(g: GameState, a: Extract<Action, { type: 'playCard' }>): void {
  const p = a.player;
  const opts = playOptions(g, p).filter(o => o.obj === a.obj);
  const dest = a.destination;
  const opt = opts.find(o => canPlay(g, p, o, dest)) ?? opts[0];
  if (!opt) throw new Rollback('card cannot be played');
  playProcess(g, p, opt, { dest, plan: a.payment, mode: a.mode });
}

export interface EffectPlayOpts {
  ignoreCost?: boolean; free?: boolean;
  /** how the cost is paid (default: free; 'full' = normal cost incl. modifiers) */
  cost?: EffectCostMode;
  destination?: Destination;
  /** allowed destinations for a permanent (bypasses the usual location rules, B7-3) */
  destinations?: Destination[];
  /** "then banish / recycle it" (B7-4) */
  then?: 'banish' | 'recycle' | 'hand';
  /** "ignoring any and all costs": no optional additional costs (Accelerate, Repeat, ...) */
  noAdditional?: boolean;
}

/** The card's current play cost (with the choices made so far) plus `delta` is affordable (see ctx.playAffordableWith). */
export function playAffordableWith(g: GameState, p: PlayerId, id: ObjId, item: ChainItem | undefined, delta: { energy?: number; power?: number }): boolean {
  if (!g.objects[id]) return false;
  const opt: PlayOption = { obj: id, via: item?.fromHidden ? 'hidden' : item?.viaFlow ? 'flow' : 'hand' };
  const c = applyMods(playCost(g, p, opt, item), [{ e: delta.energy ?? 0, pw: delta.power ?? 0 }]);
  return canAfford(g, p, c, purposeOf(g, id));
}

/** Could an effect play this card with these options (type, cost, and the given destinations if any)? */
export function canPlayByEffect(g: GameState, p: PlayerId, id: ObjId, opts: EffectPlayOpts = {}): boolean {
  const o = g.objects[id];
  if (!o) return false;
  const c = chars(g, id);
  if (!(c.type === 'Unit' || c.type === 'Gear' || c.type === 'Spell')) return false;
  // a permanent with fixed destinations: at least one must be allowed (play restrictions such as Perched Grimwyrm's "only to a
  // battlefield you conquered this turn", entry limits) — as playProcess filters them (RJ#3497)
  const fixed = opts.destinations?.length ? opts.destinations : opts.destination !== undefined ? [opts.destination] : null;
  if (fixed && (c.type === 'Unit' || c.type === 'Gear') && !fixed.some(d => (d === 'base' || canEnterBattlefield(g, d, p)) && !ruleApplies(g, 'cantPlay', id, p, d))) return false;
  const mode: EffectCostMode = opts.cost ?? ((opts.ignoreCost ?? opts.free ?? true) ? 'free' : 'full');
  if (mode === 'free') return true;
  const cost = effectBaseCost(g, p, { obj: id, via: o.zone === 'facedown' ? 'hidden' : 'hand' }, mode);
  return canAfford(g, p, cost, purposeOf(g, id)) && (!cost.extra?.length || canPayNonResource(g, p, id, cost));
}

/** Play a card as part of an effect ("play it, ignoring its cost", "play me for [A]"). No timing restrictions. */
export function playCardByEffect(g: GameState, p: PlayerId, id: ObjId, opts: EffectPlayOpts = {}): boolean {
  const o = g.objects[id];
  if (!o) return false;
  const c = chars(g, id);
  if (!(c.type === 'Unit' || c.type === 'Gear' || c.type === 'Spell')) return false;
  const opt: PlayOption = { obj: id, via: o.zone === 'facedown' ? 'hidden' : 'hand' };
  const mode: EffectCostMode = opts.cost ?? ((opts.ignoreCost ?? opts.free ?? true) ? 'free' : 'full');
  if (mode !== 'free') {
    const cost = effectBaseCost(g, p, opt, mode);
    if (!canAfford(g, p, cost, purposeOf(g, id)) || (cost.extra?.length && !canPayNonResource(g, p, id, cost))) return false;
  }
  // a failed effect-play leaves the card where it was (CR 358.5)
  const fromZone = o.zone, fromBf = o.battlefieldIndex, owner = o.owner;
  const arr = fromZone === 'hand' ? g.players[owner].hand : fromZone === 'trash' ? g.players[owner].trash : fromZone === 'banishment' ? g.players[owner].banishment : fromZone === 'mainDeck' ? g.players[owner].mainDeck : null;
  const pos = arr ? arr.indexOf(id) : -1;
  const chainLen = g.chain.length;
  try {
    playProcess(g, p, opt, { dest: opts.destination, costMode: mode, byEffect: true, destinations: opts.destinations, leaveTo: opts.then, noAdditional: opts.noAdditional });
  } catch (e) {
    if (e instanceof Rollback) {
      g.chain = g.chain.slice(0, chainLen);
      if (g.objects[id] && g.objects[id].zone === 'chain') moveToZone(g, id, fromZone, { bf: fromBf, position: pos >= 0 ? pos : 'bottom' });
      log(g, p, `could not play ${c.name}: ${e.reason}`);
      return false;
    }
    throw e;
  }
  return true;
}

/** qts: g.timestamp when it was played — triggers queued at or before it were met first (CR 340 step 1, RJ#8175) */
interface DeferredPlay { p: PlayerId; id: ObjId; dest: Destination; accelerate: boolean; playData: Record<string, unknown>; fromHidden: boolean; cardType: string; from: string; paid: unknown; byEffect: boolean; qts?: number }

function finishPermanentPlay(g: GameState, e: DeferredPlay): void {
  enterBoard(g, e.p, e.id, e.dest, { accelerate: e.accelerate, playData: e.playData, fromHidden: e.fromHidden });
  emit(g, { type: 'play', obj: e.id, player: e.p, cardType: e.cardType, fromHidden: e.fromHidden, from: e.from, loc: e.dest, playData: e.playData, paid: e.paid, byEffect: e.byEffect });
}

/** chain.ts resolveTop: start collecting permanents played by the resolving item (CR 354.4). */
export function beginResolving(g: GameState, label: string, itemId?: string): void {
  g.ex.memo.__resolving = true; g.ex.memo.__resolvingLabel = label; g.ex.memo.__deferredPlays = []; g.ex.memo.__deferredTokenPlays = [];
  if (itemId) g.ex.memo.__resolvingItem = itemId;
}
/** chain.ts resolveTop: the resolution finished — the permanents it played enter the board now, in the order played. */
export function endResolving(g: GameState): void {
  const list = (g.ex.memo.__deferredPlays as DeferredPlay[] | undefined) ?? [];
  const toks = (g.ex.memo.__deferredTokenPlays as GameEvent[] | undefined) ?? [];
  delete g.ex.memo.__resolving; delete g.ex.memo.__resolvingLabel; delete g.ex.memo.__deferredPlays; delete g.ex.memo.__resolvingItem;
  delete g.ex.memo.__deferredTokenPlays;
  // tokens played during the resolution (actions.ts createTokenRaw): their play events now, in the order played, after the
  // spell's own play completed (RJ#5092); tokens that shared a batch still do, and a reflexive item that joined a token's batch
  // (SF2-2: "Play … Then do this", ordered with the token's Weaponmaster, RJ#10519) moves with it
  if (toks.length) {
    const remap = new Map<number, number>();
    let prev: number | undefined;
    for (const ev of toks) {
      const prov = ev.__prov as number; delete ev.__prov;
      if (prov !== prev) g.ex.memo.__batchType = undefined;   // a new batch, as when it was played
      prev = prov;
      emit(g, ev);
      remap.set(prov, g.ex.memo.__batch as number);
    }
    const q = g.triggerQueue as { seq?: number; batch?: number; ts: number; event: GameEvent }[];
    const moved = q.filter(t => t.seq === undefined && t.event.type === '__reflexive' && t.batch !== undefined && remap.has(t.batch));
    for (const t of moved) { t.batch = remap.get(t.batch!); t.ts = ++g.timestamp; q.splice(q.indexOf(t), 1); q.push(t); }   // after the tokens' triggers
  }
  // CR 340 step 1 (RJ#8175): pending items finalize in the order they were added — a trigger met during this resolution before
  // the permanent was played (Vanguard Helm for Baited Hook's kill) finalizes first, so the play (and every later one) waits
  // in the enter queue until chain.ts finalizeTriggers has placed those triggers
  const queue = g.triggerQueue as { ts: number }[];
  const waiting = (g.ex.memo.__enterQueue as DeferredPlay[] | undefined) ?? [];
  for (const e of list) {
    if (!enterable(g, e)) continue;
    if (waiting.length || queue.some(t => t.ts <= (e.qts ?? -1))) waiting.push(e);
    else finishPermanentPlay(g, e);
  }
  if (waiting.length) g.ex.memo.__enterQueue = waiting;
}
function enterable(g: GameState, e: DeferredPlay): boolean {
  return g.objects[e.id]?.zone === 'chain' && !g.chain.some(c => c.kind === 'spell' && c.source === e.id);
}
/**
 * chain.ts finalizeTriggers: let the waiting permanent plays enter whose earlier triggers (queued at or before them) are no longer
 * waiting to be placed (`placedBefore(qts)`: is any trigger with ts <= qts still unplaced?). `all` lets the rest enter.
 */
export function enterWaitingPlays(g: GameState, stillWaiting: (qts: number) => boolean, all = false): void {
  const waiting = (g.ex.memo.__enterQueue as DeferredPlay[] | undefined) ?? [];
  while (waiting.length && (all || !stillWaiting(waiting[0].qts ?? -1))) {
    const e = waiting.shift()!;
    if (enterable(g, e)) finishPermanentPlay(g, e);
  }
  if (!waiting.length) delete g.ex.memo.__enterQueue;
}
/** A permanent played by the resolving effect that hasn't entered yet (CR 354.4)? */
export function isDeferredPlay(g: GameState, id: ObjId): boolean {
  return (!!(g.ex.memo.__deferredPlays as DeferredPlay[] | undefined)?.some(e => e.id === id) || !!(g.ex.memo.__enterQueue as DeferredPlay[] | undefined)?.some(e => e.id === id))
    && g.objects[id]?.zone === 'chain';
}

/** A permanent enters the board (CR 359.2). */
export function enterBoard(g: GameState, p: PlayerId, id: ObjId, dest: Destination, opts: { accelerate?: boolean; playData?: Record<string, unknown>; fromHidden?: boolean } = {}): void {
  const c = chars(g, id);
  moveToZone(g, id, dest === 'base' ? 'base' : 'battlefield', { bf: dest === 'base' ? undefined : dest, controller: p, keepState: false });
  const o = g.objects[id];
  o.controller = p;
  o.enteredThisTurn = true;
  o.playedFromHidden = !!opts.fromHidden;
  let ready = c.type !== 'Unit';            // CR 143.4 units enter exhausted; gear ready (147)
  if (opts.accelerate) ready = true;
  const script = getScript(o.cardId);
  const ctx = makeCtx(g, id, p, { data: opts.playData ?? {} });
  if (script?.entersReady === true || (typeof script?.entersReady === 'function' && script.entersReady(ctx))) ready = true;
  if (opts.playData?.entersReady) ready = true;
  for (const r of playRules(g, p)) {
    if (!r.ab.entersReady || r.controller !== p) continue;
    const rc = makeCtx(g, r.src ?? '', r.controller, { data: r.data });
    if (!r.ab.applies(rc, id)) continue;
    // RJ#12904 (house, RJ adopted; CR 369.3/372): when an "as you play me" effect redirected the entry (Baron Nashor → Baron Pit),
    // its controller may apply an "enter ready" rule for the location chosen first (The Exile) — always the better order
    const chosen = opts.playData?.__chosenDest as Destination | undefined;
    const readyFor = (d: Destination) => typeof r.ab.entersReady === 'function' && r.ab.entersReady(rc, id, d);
    if (r.ab.entersReady === true || readyFor(dest) || (chosen !== undefined && chosen !== dest && readyFor(chosen))) { ready = true; consumeDelayed(g, [r.delayedId]); }
  }
  if (script?.entersExhausted) ready = false;
  o.exhausted = !ready;
  if (typeof dest === 'number' && c.type === 'Unit') maybeContest(g, dest, p);
  emit(g, { type: 'enter', obj: id, player: p, loc: dest });
  g.ex.dirty = true;
}

/** Do the controller's "enters ready" play rules apply to this (token) unit? */
export function tokenEntersReady(g: GameState, p: PlayerId, id: ObjId, dest: Destination): boolean {
  for (const r of playRules(g, p)) {
    if (!r.ab.entersReady || r.controller !== p) continue;
    const rc = makeCtx(g, r.src ?? '', r.controller, { data: r.data });
    if (!r.ab.applies(rc, id)) continue;
    if (r.ab.entersReady === true || (typeof r.ab.entersReady === 'function' && r.ab.entersReady(rc, id, dest))) return true;
  }
  return false;
}

// ---------------- Equip costs ----------------

/**
 * The Equip cost of `gear` as if Equip were activated choosing `unit` (CR 821.1.c.2): printed/granted Equip cost with 'equip'
 * cost modifiers. `minusA` (Weaponmaster, CR 821.1.c.3): one [A] less if the cost contains [A]; otherwise paid in full.
 */
export function equipCostFor(g: GameState, p: PlayerId, gear: ObjId, unit: ObjId, opts: { minusA?: boolean } = {}): ResolvedCost | null {
  const spec = keywordCost(g, gear, 'Equip');
  if (!spec) return null;
  const probe: ChainItem = { id: 'probe', kind: 'ability', source: gear, controller: p, targets: [[unit]], choices: { probe: true, equipTarget: unit }, pending: true, abilityIndex: 900 };
  const base = resolveCost(spec, chars(g, gear).domains);
  if (opts.minusA) {
    const i = (spec.power ?? []).indexOf('A');
    if (i >= 0) { const k = base.power.indexOf('any'); if (k >= 0) base.power.splice(k, 1); }
  }
  return applyMods(base, costMods(g, p, gear, 'equip', probe));
}

// ---------------- standard move costs (B1-8 / B2-2) ----------------

/** Applied costs for a standard move ("Opponents must pay [1][A] to move units here"); null if none. */
export function standardMoveCost(g: GameState, p: PlayerId, units: ObjId[], to: Loc): ResolvedCost | null {
  const rcs = ruleCosts(g, 'moveCost', p, units, to);
  if (!rcs.length) return null;
  let total: ResolvedCost = { energy: 0, power: [] };
  for (const r of rcs) total = addCosts(total, resolveCost(r.cost, []));
  return total;
}
export function canPayStandardMove(g: GameState, p: PlayerId, units: ObjId[], to: Loc): boolean {
  const c = standardMoveCost(g, p, units, to);
  if (!c) return true;
  return canAfford(g, p, { energy: c.energy, power: c.power }, 'other') && (!c.extra?.length || canPayNonResource(g, p, units[0], c));
}
/** Pay the applied cost of a standard move (before the units are exhausted). */
export function payStandardMove(g: GameState, p: PlayerId, units: ObjId[], to: Loc, plan?: PaymentPlan): void {
  const c = standardMoveCost(g, p, units, to);
  if (!c) return;
  // RAD-FAQ (Gravity Field): the mover may decline to pay; then the move doesn't happen
  if (!askYesNo(g, p, `Pay ${costLabel(c)} to move there? (No cancels the move)`, units[0])) throw new Rollback('move cost not paid');
  if (c.energy || c.power.length) payResources(g, p, { energy: c.energy, power: c.power }, 'other', plan, units[0]);
  const ctx = makeCtx(g, units[0], p);
  for (const x of c.extra ?? []) if (x.pay(ctx) === false) throw new Rollback(`could not pay ${x.label}`);
}

// ---------------- activated abilities ----------------

export interface ActOption { obj: ObjId; index: number; ab: ActivatedAbility }

function abilityTiming(ab: ActivatedAbility): Timing {
  return ab.timing ?? (ab.isAdd ? 'reaction' : 'normal');
}

/** CR 381 / 145: activated abilities default to the controller's turn in an open state (not showdown). */
export function activatableAbilities(g: GameState, p: PlayerId): ActOption[] {
  const out: ActOption[] = [];
  const w = currentWindow(g, p);
  if (!w) return out;
  for (const id in g.objects) {
    const o = g.objects[id];
    const isBf = isBattlefieldCard(g, id);
    if (o.zone === 'runePool') {
      if (o.controller !== p) continue;
      for (const r of keywordAbilities(g, id)) if (r.ability.kind === 'activated' && canActivate(g, p, { obj: id, index: r.index, ab: r.ability }, w)) out.push({ obj: id, index: r.index, ab: r.ability });
      continue;
    }
    if (!(o.zone === 'base' || o.zone === 'battlefield' || o.zone === 'legendZone')) continue;
    const refs = [...allAbilities(g, id), ...keywordAbilities(g, id)];
    for (const r of refs) {
      const ab = r.ability;
      if (ab.kind !== 'activated') continue;
      const self = r.viaHost ?? id;
      const owner = isBf ? (g.battlefields.find(b => b.objId === id)?.controller ?? g.activePlayer) : g.objects[self].controller;
      if (!(owner === p || (isBf && ab.anyPlayer))) continue;
      if (isBf && ab.anyPlayer && g.activePlayer !== p) continue;
      if (canActivate(g, p, { obj: id, index: r.index, ab }, w)) out.push({ obj: id, index: r.index, ab });
    }
  }
  return out;
}

/** F-1: may p use this object's activated ability at all (its controller; battlefield controller / anyPlayer; own runes)? */
function mayUseAbility(g: GameState, p: PlayerId, a: ActOption): boolean {
  const o = g.objects[a.obj];
  if (!o) return false;
  if (o.zone === 'runePool') return o.controller === p;
  const isBf = isBattlefieldCard(g, a.obj);
  if (isBf) {
    const owner = g.battlefields.find(b => b.objId === a.obj)?.controller ?? g.activePlayer;
    if (!(owner === p || a.ab.anyPlayer)) return false;
    return !(a.ab.anyPlayer && g.activePlayer !== p);
  }
  const self = abilityByIndex(g, a.obj, a.index)?.viaHost ?? a.obj;
  return g.objects[self]?.controller === p;
}

export function canActivate(g: GameState, p: PlayerId, a: ActOption, w = currentWindow(g, p)): boolean {
  if (!w) return false;
  if (!mayUseAbility(g, p, a)) return false;
  const ab = a.ab;
  const t = abilityTiming(ab);
  if (!timingAllows(t, w)) return false;
  if (t === 'normal' && g.activePlayer !== p) return false;
  if (ab.isAdd && w !== 'main') {
    // Add abilities can be used any time costs are paid; as a standalone action only with priority
  }
  const o = g.objects[a.obj];
  const self = o.attachedTo && ab.section === 'effect' ? o.attachedTo : a.obj;
  const key = `act:${a.index}`;
  if (!oncePerTurnOk(g, self, key, ab.oncePerTurn)) return false;
  if (ab.anyPlayer && !oncePerTurnOk(g, null, `${a.obj}:${a.index}:p${p}:t${g.turn}`, 1)) return false;
  const ctx = makeCtx(g, self, p);
  ctx.abilitySource = a.obj;
  if (ab.condition && !ab.condition(ctx)) return false;
  // CR 827 "use only if not Empowered"; Radiance: multi-empower cards may activate even at max (does nothing)
  if (a.index === 901) {
    const max = getScript(o.cardId)?.maxEmpower ?? 1;
    if (max <= 1 && (o.empowered ?? 0) >= 1) return false;
  }
  if (a.index === 900) {
    if (!ctx.friendlyUnits(u => ctx.ctrl(u) === p).length) return false;
  }
  if (ab.modes) { if (modesAvailable(g, ctx, ab.modes).filter(m => !ab.modesOncePerTurn || !ctx.remembered(`mode:act${a.index}:${m.id}`, a.obj)).length === 0) return false; }
  else if (!hasLegalTargets(g, ctx, ab.targets)) return false;
  const cost = applyMods(resolveCost(ab.cost, chars(g, a.obj).domains), costMods(g, p, a.obj, a.index === 900 ? 'equip' : a.index === 901 ? 'empower' : 'ability'));
  if (!canPayNonResource(g, p, self, cost)) return false;
  return canAfford(g, p, { energy: cost.energy, power: cost.power }, abilityPurpose(g, a.obj), { exclude: a.obj });
}

export function activateAction(g: GameState, a: Extract<Action, { type: 'activate' }>): void {
  const p = a.player;
  const ref = abilityByIndex(g, a.obj, a.abilityIndex);
  if (!ref || ref.ability.kind !== 'activated') throw new Rollback('no such ability');
  activateProcess(g, p, a.obj, a.abilityIndex, ref.ability, a.payment);
}

function activateProcess(g: GameState, p: PlayerId, objId: ObjId, index: number, ab: ActivatedAbility, plan?: PaymentPlan): void {
  const o = g.objects[objId];
  const self = o.attachedTo && ab.section === 'effect' ? o.attachedTo : objId;
  const wasEmpty = g.chain.length === 0;
  const srcType = chars(g, objId).type;
  const key = index === 900 ? 'builtin:Equip' : index === 901 ? 'builtin:Empower' : abilityKey(g, objId, index, ab);
  const item: ChainItem = { id: newItemId(g), kind: 'ability', source: self, controller: p, abilityIndex: index, abilityKey: key, targets: [], choices: {}, pending: true, label: `${cardName(g, objId)}: ${ab.label ?? ab.text ?? 'ability'}`, isAdd: !!ab.isAdd };
  if (!ab.isAdd) g.chain.push(item);
  const ctx = makeCtx(g, self, p, { item });
  ctx.abilitySource = objId;
  let cost = applyMods(resolveCost(ab.cost, chars(g, objId).domains), costMods(g, p, objId, index === 900 ? 'equip' : index === 901 ? 'empower' : 'ability'));
  const specs: (TargetSpec | undefined)[] = [];
  if (index === 900) {
    // Equip: choose a unit you control (target)
    const spec: TargetSpec = { kind: 'unit', prompt: `Equip ${cardName(g, objId)} to`, hint: 'help', filter: (c, id) => c.ctrl(id) === p && id !== objId };
    const r = chooseTargetsFor(g, ctx, p, [spec], () => cost, abilityPurpose(g, objId));
    item.targets = r.targets; specs.push(spec);
    ctx.data.equipTarget = r.targets[0]?.[0];      // B2-12: cost parts can read the chosen unit
  } else if (ab.modes) {
    const avail = modesAvailable(g, ctx, ab.modes).filter(m => !ab.modesOncePerTurn || !ctx.remembered(`mode:act${index}:${m.id}`, objId));
    if (!avail.length) throw new Rollback('no mode can be chosen');
    const mid = chooseOne(g, p, 'chooseMode', 'Choose one', avail.map(m => ({ id: m.id, label: m.label })), { source: objId });
    item.mode = mid;
    if (ab.modesOncePerTurn) ctx.remember(`mode:act${index}:${mid}`, objId);
    const m = avail.find(x => x.id === mid)!;
    const r = chooseTargetsFor(g, ctx, p, m.targets, () => cost, abilityPurpose(g, objId), `${mid}:`);
    item.targets = r.targets; item.choices[`targets:${mid}`] = r.targets; Object.assign(item.choices, r.splits);
    (m.targets ?? []).forEach(s => specs.push(s));
  } else {
    const r = chooseTargetsFor(g, ctx, p, ab.targets, () => cost, abilityPurpose(g, objId));
    item.targets = r.targets; Object.assign(item.choices, r.splits);
    (ab.targets ?? []).forEach(s => specs.push(s));
  }
  item.targetEpochs = item.targets.map(grp => grp.map(t => g.objects[t]?.epoch ?? 0));
  const defl = deflectFor(g, p, item.targets, specs);
  if (defl > 0) cost = addCosts(cost, { energy: 0, power: new Array(defl).fill('any') });
  // pay: resources first, then exhaust/other (CR 357)
  payResources(g, p, { energy: cost.energy, power: cost.power }, abilityPurpose(g, objId), plan, objId, objId);
  if (cost.exhaustSelf) { if (g.objects[self].exhausted) throw new Rollback('already exhausted'); exhaust(g, [self], p); }
  for (const x of cost.extra ?? []) if (x.pay(ctx) === false) throw new Rollback(`could not pay ${x.label}`);
  if (index === 951) recycleFn(g, [objId]);
  markUsed(g, self, `act:${index}`);
  if (ab.anyPlayer) markUsed(g, null, `${objId}:${index}:p${p}:t${g.turn}`);
  item.pending = false;
  item.choices.playData = ctx.data;
  log(g, p, `${g.players[p].name} uses ${item.label}`, [objId, ...item.targets.flat().filter(t => g.objects[t])]);
  emit(g, { type: 'activated', obj: objId, player: p, index, isAdd: !!ab.isAdd, cardType: g.cards[o.cardId]?.type, cardId: o.cardId, sourceType: srcType });
  if (ab.isAdd) {
    // CR 429.2: resolves immediately, priority/focus don't pass
    runAbilityEffect(g, item);
    // CR 337.2 + 339.1: it was still an item added to the chain, so the passes in sequence start over (RJ#552)
    if (g.chain.length) g.ex.passes = [];
    // BASICS (CR 347.2.a, as RJ#11052 for permanents): in an open showdown it is still "doing something" — the passes in
    // succession start over (an earlier pass no longer counts); focus stays (CR 346.1: a chain started by an Add ability)
    else if (g.showdown && g.showdown.stage === 'open') g.showdown.passes = [];
    g.ex.dirty = true;
    return;
  }
  if (wasEmpty) g.ex.chainOpener = { player: p, byTrigger: false };
  g.priority = g.chain[g.chain.length - 1].controller;
  g.ex.passes = [];
  g.ex.dirty = true;
}

/** Build the ctx for a chain item at resolution: targets filtered to still-legal ones (CR 359.3.e). */
export function ctxForItem(g: GameState, item: ChainItem, specs: (TargetSpec | undefined)[]): Ctx {
  const ctx = makeCtx(g, item.source, item.controller, { item, event: item.event, data: (item.choices.playData as Record<string, unknown>) ?? (item.choices.data as Record<string, unknown>) ?? {} });
  if (item.abilitySource) ctx.abilitySource = item.abilitySource;   // SF-2
  ctx.mode = item.mode;
  ctx.x = item.x;
  // R-14: group i is re-validated seeing the (validated) earlier groups only, as when it was chosen
  const out: ObjId[][] = [];
  ctx.targets = out;
  item.targets.forEach((grp, i) => {
    out.push(grp.filter((t, k) => {
      if (g.chain.some(c => c.id === t)) return true;
      if (specs[i]?.kind === 'destination') return legalTarget(g, ctx, specs[i]!, t);   // R-2
      const o = g.objects[t];
      if (!o) return false;
      if ((item.targetEpochs?.[i]?.[k] ?? o.epoch ?? 0) !== (o.epoch ?? 0)) return false;   // became a new object
      const spec = specs[i];
      if (!spec) return true;
      return legalTarget(g, ctx, spec, t);
    }));
  });
  ctx.targets = out;
  return ctx;
}

export function runAbilityEffect(g: GameState, item: ChainItem): void {
  const idx = item.abilityIndex ?? -1;
  if (idx === 950) { addResourcesFn(g, item.controller, 1, [], undefined, item.source); return; }
  if (idx === 951) {
    const d = g.cards[g.objects[item.source].cardId]?.domains[0];
    addResourcesFn(g, item.controller, 0, [d && d !== 'Colorless' ? d : 'any'], undefined, item.source);
    return;
  }
  if (idx === 900) {
    const ctx = ctxForItem(g, item, [{ kind: 'unit' }]);
    const u = ctx.target(0);
    if (u && g.objects[item.source] && onBoard(g, item.source) && g.objects[u].controller === item.controller) doAttach(g, item.source, u);
    return;
  }
  if (idx === 901) {
    const max = getScript(g.objects[item.source]?.cardId ?? '')?.maxEmpower ?? 1;
    doEmpower(g, item.source, max);
    return;
  }
  const ref = abilityByIndex(g, item.source, idx) ?? (item.abilityKey ? undefined : undefined);
  let ab: Ability | undefined = ref?.ability;
  if (!ab && item.abilityKey) ab = abilityFromKeyLocal(g, item.abilityKey);
  if (!ab || ab.kind !== 'activated') return;
  let specs: (TargetSpec | undefined)[] = ab.targets ?? [];
  let effect = ab.effect;
  if (ab.modes && item.mode) { const m = ab.modes.find(x => x.id === item.mode); if (m) { specs = m.targets ?? []; effect = m.effect; } }
  const ctx = ctxForItem(g, item, specs);
  if (ref?.viaHost) ctx.abilitySource = item.source;
  effect(ctx);
}

import { abilityFromKey as abilityFromKeyLocal } from './events.ts';

// ---------------- hiding ----------------

export function hideTargets(g: GameState, p: PlayerId): number[] {
  return g.battlefields.map((b, i) => i).filter(i => {
    if (g.battlefields[i].controller !== p) return false;
    const n = Object.values(g.objects).filter(o => o.zone === 'facedown' && o.battlefieldIndex === i).length;
    return n < 1 + ruleSum(g, 'extraHide', p, i);
  });
}

/** Hide costs (CR 811): [A], plus alternatives from play rules (Swift Scout "[1] instead"), each with 'hide' cost mods. */
export function hideCosts(g: GameState, p: PlayerId, id: ObjId): ResolvedCost[] {
  const alts: ResolvedCost[] = [{ energy: 0, power: ['any'] }];
  for (const r of playRules(g, p, id)) {
    if (!r.ab.hideCost || !ruleFor(r, p)) continue;      // (hideCost filters by itself; `applies` is for plays)
    const ctx = makeCtx(g, r.src ?? id, r.controller, { data: r.data });
    const c = r.ab.hideCost(ctx, id);
    if (c) alts.push(resolveCost(c, chars(g, id).domains));
  }
  const mods = costMods(g, p, id, 'hide');
  const out: ResolvedCost[] = [];
  for (const a of alts) {
    const m = applyMods(a, mods);
    if (!out.some(x => x.energy === m.energy && x.power.join() === m.power.join())) out.push(m);
  }
  return out;
}

export function canHide(g: GameState, p: PlayerId, id: ObjId, bf: number): boolean {
  if (currentWindow(g, p) !== 'main') return false;
  const o = g.objects[id];
  // CR 811.1.b: "While this card is in your hand or in your Champion Zone" (RJ#3920)
  if (!o || !(o.zone === 'hand' || o.zone === 'championZone') || o.owner !== p) return false;
  if (!hasKwInHand(g, id, 'Hidden')) return false;
  if (!hideTargets(g, p).includes(bf)) return false;
  return hideCosts(g, p, id).some(c => canAfford(g, p, c, 'hide'));
}

function hasKwInHand(g: GameState, id: ObjId, kw: string): boolean { return chars(g, id).keywords.has(kw); }

export function hideAction(g: GameState, a: Extract<Action, { type: 'hide' }>): void {
  const p = a.player;
  const opts = hideCosts(g, p, a.obj).filter(c => canAfford(g, p, c, 'hide'));
  let cost = opts[0] ?? { energy: 0, power: ['any'] };
  if (opts.length > 1) {
    const k = chooseOne(g, p, 'chooseMode', 'Hide: pay which cost?', opts.map((c, i) => ({ id: String(i), label: costLabel(c) || 'Free' })), { source: a.obj });
    cost = opts[Number(k)];
  }
  // used-up "the next card you hide" style modifiers
  consumeDelayed(g, costMods(g, p, a.obj, 'hide').map(h => h.delayedId));
  payResources(g, p, cost, 'hide', a.payment, a.obj);
  moveToZone(g, a.obj, 'facedown', { bf: a.battlefieldIndex, controller: p });
  const o = g.objects[a.obj];
  o.controller = p;
  o.hiddenTurn = g.turn;
  log(g, p, `${g.players[p].name} hides a card at ${cardName(g, g.battlefields[a.battlefieldIndex].objId)}`);
  emit(g, { type: 'hide', obj: a.obj, player: p, bf: a.battlefieldIndex });
  g.ex.dirty = true;
}

// ---------------- countering ----------------

/** A delayed "then recycle / banish it" for a spell on the chain (helpers/B7 afterChain, replacing its leaving the chain). */
function leaveChainDelayed(g: GameState, id: ObjId): boolean {
  const ep = g.objects[id]?.epoch ?? 0;
  return g.ex.delayed.some(d => d.key === 'B7:afterChain' && (d.data as { obj?: ObjId; epoch?: number }).obj === id && (d.data as { epoch?: number }).epoch === ep);
}

export function counterItem(g: GameState, itemId: string, by: PlayerId, opts: { toHand?: boolean } = {}): boolean {
  const i = g.chain.findIndex(c => c.id === itemId);
  if (i < 0) return false;
  if (ruleApplies(g, 'cantBeCountered', itemId, g.chain[i].source)) { log(g, by, `${g.chain[i].label} can't be countered`); return false; }
  const item = g.chain[i];
  g.chain.splice(i, 1);
  if (item.kind === 'spell' && g.objects[item.source]?.zone === 'chain') {
    // CR 391.3.a "then banish / recycle it" (Flow, Fizz) replaces the spell leaving the chain however it leaves, so it also wins
    // over Abandon's "return it to hand instead of the trash" in either replacement order (CR 373; RJ#11158, as RJ#11990)
    if (item.viaFlow || item.choices.banishAfter || item.leaveTo === 'banish') moveToZone(g, item.source, 'banishment');
    else if (item.leaveTo === 'recycle') recycleFn(g, [item.source]);
    else if (opts.toHand && !leaveChainDelayed(g, item.source)) moveToZone(g, item.source, 'hand');
    else toTrash(g, item.source);
  }
  log(g, by, `${item.label ?? 'item'} is countered`);
  emit(g, { type: 'counter', item: itemId, source: item.source, player: by, controller: item.controller });
  return true;
}

export { isOpponent, setLocation, dependenciesMet, isUnit, isGear };

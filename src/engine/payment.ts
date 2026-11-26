// Costs (CR 201-206, 356-357) and resource payment: auto-payer + manual plan validation.
// Basic runes: [T]: Add [1]  and  Recycle this: Add [C] (its domain). A rune may do both
// (exhaust first, then recycle), so energy and power choices never conflict.
import type { Domain, GameState, ObjId, PlayerId, PaymentPlan, RestrictedResource } from './types.ts';
import type { CostSpec, PowerSym, ActivatedAbility } from './abilities.ts';
import { chars, allAbilities, onBoard, isUnit } from './chars.ts';
import { exhaust, recycle, addResources } from './actions.ts';
import { makeCtx } from './context.ts';
import { emit } from './events.ts';
import { log, cardName } from './util.ts';
import { ask } from './ask.ts';

export type PowerReq = Domain[] | 'any';
export interface ResolvedCost { energy: number; power: PowerReq[]; exhaustSelf?: boolean; extra?: CostSpec['extra'] }
/** What a payment is for (restricted resources check it): playing a card, or an activated ability by source type. */
export type Purpose = 'spell' | 'unit' | 'gear' | 'ability' | 'unitAbility' | 'gearAbility' | 'legendAbility' | 'hide' | 'other';

export function resolvePower(syms: PowerSym[] | undefined, cardDomains: Domain[]): PowerReq[] {
  const doms = cardDomains.filter(d => d !== 'Colorless');
  return (syms ?? []).map(s => (s === 'A' ? 'any' : s === 'C' ? (doms.length ? [...doms] : 'any') : [s]));
}

export function resolveCost(c: CostSpec | null | undefined, cardDomains: Domain[]): ResolvedCost {
  return { energy: c?.energy ?? 0, power: resolvePower(c?.power, cardDomains), exhaustSelf: c?.exhaustSelf, extra: c?.extra ?? [] };
}

export function costLabel(c: ResolvedCost): string {
  const parts: string[] = [];
  if (c.energy) parts.push(String(c.energy));
  for (const p of c.power) parts.push(p === 'any' ? 'A' : p.map(d => d[0]).join('/'));
  if (c.exhaustSelf) parts.push('T');
  for (const x of c.extra ?? []) parts.push(x.label);
  return parts.length ? parts.join(' ') : 'free';
}

// ---------- resource model ----------

interface PowerUnit { domain: Domain | 'any'; src: string; doms?: Domain[] }   // src: 'pool:<Domain>' | 'r:<runeId>' | 'x:<i>' | 'add:<key>'

let payingState: GameState | null = null;
/**
 * Spending restrictions ("Use only to play spells"...). `only` values: 'spell', 'unit', 'gear', 'unitOrGear',
 * 'ability' (any activated ability), 'unitOrUnitAbility', 'gearOrGearAbility', 'showdown' (only during showdowns).
 * Several can be combined with '|'.
 */
function restrictionOk(r: RestrictedResource, purpose: Purpose): boolean {
  return r.only.split('|').some(o => {
    switch (o) {
      case 'spell': return purpose === 'spell';
      case 'unit': return purpose === 'unit';
      case 'gear': return purpose === 'gear';
      case 'unitOrGear': return purpose === 'unit' || purpose === 'gear';
      case 'ability': return purpose === 'ability' || purpose === 'unitAbility' || purpose === 'gearAbility' || purpose === 'legendAbility';
      case 'unitOrUnitAbility': return purpose === 'unit' || purpose === 'unitAbility';
      case 'gearOrGearAbility': return purpose === 'gear' || purpose === 'gearAbility';
      case 'showdown': return !!payingState?.showdown;
      default: return true;
    }
  });
}

function matches(req: PowerReq, u: PowerUnit): boolean {
  if (u.doms) return req === 'any' || u.doms.some(d => req.includes(d));   // [C] of a multi-domain source: any one of its domains
  if (u.domain === 'any') return true;
  return req === 'any' || req.includes(u.domain);
}

/** Bipartite matching of requirements to units; units are tried in the given (preference) order. */
function matchPower(reqs: PowerReq[], units: PowerUnit[]): number[] | null {
  const owner: number[] = new Array(units.length).fill(-1);
  // specific requirements first
  const order = reqs.map((_, i) => i).sort((a, b) => (reqs[a] === 'any' ? 1 : 0) - (reqs[b] === 'any' ? 1 : 0));
  const tryAssign = (ri: number, seen: boolean[]): boolean => {
    for (let ui = 0; ui < units.length; ui++) {
      if (seen[ui] || !matches(reqs[ri], units[ui])) continue;
      seen[ui] = true;
      if (owner[ui] === -1 || tryAssign(owner[ui], seen)) { owner[ui] = ri; return true; }
    }
    return false;
  };
  for (const ri of order) if (!tryAssign(ri, new Array(units.length).fill(false))) return null;
  const res: number[] = new Array(reqs.length).fill(-1);
  owner.forEach((ri, ui) => { if (ri >= 0) res[ri] = ui; });
  return res;
}

/**
 * rules-decisions #66 tie-break: how much the player wants to keep a rune of each domain — the power symbols of that domain on the
 * cards in hand and in the champion zone (a multi-domain card's [C] counts for each of its domains in equal parts), minus the runes
 * of that domain in play; also [C]/domain power in keyword costs and in activated-ability costs on the board (ENGINE-9). Lower = recycled first. Only orders runes the Pareto rules leave open (same readiness).
 */
function domainKeepScore(g: GameState, p: PlayerId): Partial<Record<string, number>> {
  const pl = g.players[p];
  const sc: Partial<Record<string, number>> = {};
  const need = (doms0: Domain[], n: number) => {
    const doms = doms0.filter(d => d !== 'Colorless');
    if (n > 0) for (const d of doms) sc[d] = (sc[d] ?? 0) + n / doms.length;
  };
  // [C] in printed keyword costs (Equip [C], Accelerate [1][C], …): count with the card's domains
  const kwC = (c: { keywordCosts?: Record<string, string> }) => Object.values(c.keywordCosts ?? {}).reduce((s, x) => s + (x.match(/\[C\]/g)?.length ?? 0), 0);
  for (const id of [...pl.hand, ...pl.championZone]) {
    const c = g.cards[g.objects[id]?.cardId];
    if (c) need(c.domains, (c.power ?? 0) + kwC(c));
  }
  // gear on the board with a keyword cost still to pay (Equip of unattached Equipment)
  for (const id of pl.base) {
    const o = g.objects[id]; const c = o && g.cards[o.cardId];
    if (c && c.type === 'Gear' && !o.attachedTo) need(c.domains, kwC(c));
  }
  // (ENGINE-9, ENGINE-8 OPEN 2) [C] / domain power in the costs of activated abilities of my objects on the board (units, gear,
  // legend): "[2][C]: …", "[C], [T]: …". Add abilities and the rune abilities don't count; [A] fits any domain, so it doesn't either.
  for (const id in g.objects) {
    const o = g.objects[id];
    if (o.controller !== p || !(o.zone === 'base' || o.zone === 'battlefield' || o.zone === 'legendZone')) continue;
    if (pl.runesInPlay.includes(id)) continue;
    let doms: Domain[] | null = null;
    for (const r of allAbilities(g, id)) {
      const ab = r.ability;
      if (ab.kind !== 'activated' || ab.isAdd || !ab.cost?.power?.length) continue;
      for (const s of ab.cost.power) {
        if (s === 'A') continue;
        if (s === 'C') need(doms ??= chars(g, id).domains, 1);
        else need([s as Domain], 1);
      }
    }
  }
  for (const r of pl.runesInPlay) { const d = g.cards[g.objects[r].cardId].domains[0]; if (d && d !== 'Colorless') sc[d] = (sc[d] ?? 0) - 1; }
  return sc;
}

interface AddSource { key: string; obj: ObjId; index: number; energy: number; power: (Domain | 'any')[]; powerDoms: (Domain[] | null)[]; only?: string; ab: ActivatedAbility }

/** Add abilities usable during payment (CR 429.3): activated, isAdd, no resource cost. */
export function addSources(g: GameState, p: PlayerId, exclude?: ObjId): AddSource[] {
  const out: AddSource[] = [];
  for (const id in g.objects) {
    const o = g.objects[id];
    if (o.controller !== p || id === exclude) continue;
    if (!(o.zone === 'base' || o.zone === 'battlefield' || o.zone === 'legendZone')) continue;
    for (const r of allAbilities(g, id)) {
      const ab = r.ability;
      if (ab.kind !== 'activated' || !ab.isAdd || !ab.produces) continue;
      if ((ab.cost.energy ?? 0) > 0 || (ab.cost.power ?? []).length > 0) continue;
      if (ab.cost.exhaustSelf && o.exhausted) continue;
      const ctx = makeCtx(g, id, p);
      if (ab.condition && !ab.condition(ctx)) continue;
      if (ab.cost.extra && !ab.cost.extra.every(x => x.canPay(ctx))) continue;
      const doms = chars(g, id).domains;
      const req = resolvePower(ab.produces.power, doms);
      const power = req.map(r => (r === 'any' ? 'any' : r[0]));
      const powerDoms = req.map(r => (r !== 'any' && r.length > 1 ? r : null));
      out.push({ key: `${id}:${r.index}`, obj: id, index: r.index, energy: ab.produces.energy ?? 0, power, powerDoms, only: ab.produces.only, ab });
    }
  }
  return out;
}

export interface PlanResult { plan: PaymentPlan; recycles: number; exhausts: number }

/** Pool power in spending order: domain power before universal power (AUTO-AUDIT AP-3 — keep the [A] that pays anything). */
function poolEntries(pw: Partial<Record<string, number>>): [string, number | undefined][] {
  return Object.entries(pw).sort((a, b) => Number(a[0] === 'Colorless') - Number(b[0] === 'Colorless'));
}

function planWith(g: GameState, p: PlayerId, cost: ResolvedCost, purpose: Purpose, adds: AddSource[], excludeRunes: Set<ObjId>): PlanResult | null {
  const pl = g.players[p];
  // pool power units
  const units: PowerUnit[] = [];
  for (const r of pl.poolRestricted) if (r.kind === 'power' && restrictionOk(r, purpose)) for (let i = 0; i < r.amount; i++) units.push({ domain: (r.domain ?? 'any') as Domain | 'any', src: 'x' });
  for (const [d, n] of poolEntries(pl.pool.power)) for (let i = 0; i < (n ?? 0); i++) units.push({ domain: d === 'Colorless' ? 'any' : (d as Domain), src: 'pool' });
  for (const a of adds) if (!a.only || restrictionOk({ kind: 'power', amount: 1, only: a.only }, purpose)) a.power.forEach((d, i) => units.push({ domain: d, src: `add:${a.key}`, doms: a.powerDoms[i] ?? undefined }));
  const poolCount = units.length;
  const runes = pl.runesInPlay.filter(r => !excludeRunes.has(r));
  const runeDomain = (r: ObjId): Domain | 'any' => { const d = g.cards[g.objects[r].cardId].domains[0]; return d && d !== 'Colorless' ? d : 'any'; };
  // recycle preference: exhausted runes first (#19); then (rules-decisions #66 tie-break, a UX default) the domain the cards in
  // hand need least relative to the runes of it in play, so the domain the hand needs most is kept
  const keep = domainKeepScore(g, p);
  const runeCount = (d: Domain | 'any') => runes.filter(r => runeDomain(r) === d).length;
  const expendable = (a: ObjId, b: ObjId) => (keep[runeDomain(a)] ?? 0) - (keep[runeDomain(b)] ?? 0)
    || runeCount(runeDomain(b)) - runeCount(runeDomain(a));       // equal need: keep the last rune of a domain
  const runeOrder = [...runes].sort((a, b) => Number(g.objects[b].exhausted) - Number(g.objects[a].exhausted) || expendable(a, b));
  for (const r of runeOrder) units.push({ domain: runeDomain(r), src: 'r:' + r });
  const m = matchPower(cost.power, units);
  if (!m) return null;
  // minimise recycles: matchPower tries units in order, pool first, so runes are only used when needed
  const recycleIds = m.filter(ui => ui >= poolCount).map(ui => units[ui].src.slice(2));
  // which domain each multi-domain [C] Add was matched to
  const addDomains: Record<string, string> = {};
  m.forEach((ui, ri) => { const u = units[ui]; if (u.doms && u.src.startsWith('add:')) { const rq = cost.power[ri]; addDomains[u.src.slice(4)] = rq === 'any' ? u.doms[0] : (u.doms.find(d => rq.includes(d)) ?? u.doms[0]); } });
  // energy
  let energyAvail = pl.pool.energy;
  for (const r of pl.poolRestricted) if (r.kind === 'energy' && restrictionOk(r, purpose)) energyAvail += r.amount;
  for (const a of adds) if (!a.only || restrictionOk({ kind: 'energy', amount: 1, only: a.only }, purpose)) energyAvail += a.energy;
  let need = Math.max(0, cost.energy - energyAvail);
  const exhaustIds: ObjId[] = [];
  const ready = runes.filter(r => !g.objects[r].exhausted);
  // runes exhausted for energy: the recycled ones first, then the most expendable domain (a later [A] recycles exhausted runes
  // first, #19 — so the domain the hand needs stays ready and in play)
  const readyPref = [...ready].sort((a, b) => Number(recycleIds.includes(b)) - Number(recycleIds.includes(a)) || expendable(a, b));
  for (const r of readyPref) { if (need <= 0) break; exhaustIds.push(r); need--; }
  if (need > 0) return null;
  // a ready rune the plan recycles is exhausted first: its [1] goes to the pool (which lasts through the phase, CR 316.1) instead
  // of being lost with the rune — never worse, since the rune leaves play anyway (rules-decisions #65). Manual plans unchanged.
  for (const r of recycleIds) if (!g.objects[r].exhausted && !exhaustIds.includes(r)) exhaustIds.push(r);
  return { plan: { exhaust: exhaustIds, recycle: recycleIds, other: adds.length ? { abilities: adds.map(a => a.key), addDomains } : undefined }, recycles: recycleIds.length, exhausts: exhaustIds.length };
}

/** Find a payment for the resource part of a cost (energy + power). Returns null if impossible. */
export function autoPay(g: GameState, p: PlayerId, cost: ResolvedCost, purpose: Purpose, opts: { exclude?: ObjId; excludeRunes?: ObjId[] } = {}): PlanResult | null {
  return autoPayPlain(g, p, cost, purpose, opts) ?? withConverter(g, p, cost, purpose, opts);
}

/** Ready converter Adds of the player (abilities with `convert`, cost [T] only): Ancient Henge. */
function converters(g: GameState, p: PlayerId, exclude?: ObjId): { key: string; obj: ObjId; ab: ActivatedAbility }[] {
  const out: { key: string; obj: ObjId; ab: ActivatedAbility }[] = [];
  for (const id in g.objects) {
    const o = g.objects[id];
    if (o.controller !== p || id === exclude || o.exhausted) continue;
    if (!(o.zone === 'base' || o.zone === 'battlefield' || o.zone === 'legendZone')) continue;
    for (const r of allAbilities(g, id)) {
      const ab = r.ability;
      if (ab.kind !== 'activated' || ab.convert !== 'energyToAny' || !ab.cost.exhaustSelf) continue;
      if ((ab.cost.energy ?? 0) > 0 || (ab.cost.power ?? []).length > 0 || (ab.cost.extra ?? []).length > 0) continue;
      const ctx = makeCtx(g, id, p);
      if (ab.condition && !ab.condition(ctx)) continue;
      out.push({ key: `${id}:${r.index}`, obj: id, ab });
    }
  }
  return out;
}

/** The cost left once a converter turned n Energy into n [A]: n more Energy, n fewer [A] symbols. */
function convertedCost(cost: ResolvedCost, n: number): ResolvedCost {
  const power = [...cost.power];
  for (let k = 0; k < n; k++) { const i = power.lastIndexOf('any'); if (i >= 0) power.splice(i, 1); }
  return { ...cost, energy: cost.energy + n, power };
}

/**
 * RJ#7770 (ENGINE-9; CR 429.3 Add abilities while paying, 430): when nothing else pays the cost, use one ready converter (Ancient
 * Henge): pay n Energy to it for n universal power, the least n that works. The plan records it as `other.convert` {key, n}.
 */
function withConverter(g: GameState, p: PlayerId, cost: ResolvedCost, purpose: Purpose, opts: { exclude?: ObjId; excludeRunes?: ObjId[] }): PlanResult | null {
  const na = cost.power.filter(x => x === 'any').length;
  if (na === 0) return null;
  const cv = converters(g, p, opts.exclude);
  if (!cv.length) return null;
  for (let n = 1; n <= na; n++) {
    const r = autoPayPlain(g, p, convertedCost(cost, n), purpose, { ...opts, exclude: opts.exclude });
    if (r) return { ...r, plan: { ...r.plan, other: { ...(r.plan.other ?? {}), convert: { key: cv[0].key, n } } } };
  }
  return null;
}

function autoPayPlain(g: GameState, p: PlayerId, cost: ResolvedCost, purpose: Purpose, opts: { exclude?: ObjId; excludeRunes?: ObjId[] } = {}): PlanResult | null {
  payingState = g;
  const ex = new Set(opts.excludeRunes ?? []);
  const base = planWith(g, p, cost, purpose, [], ex);
  if (base && base.recycles === 0) return base;
  if (cost.energy === 0 && cost.power.length === 0) return { plan: { exhaust: [], recycle: [] }, recycles: 0, exhausts: 0 };
  // AUTO-AUDIT AP-2: only sources whose resources this purpose may spend
  const adds = addSources(g, p, opts.exclude).filter(a => !a.only || restrictionOk({ kind: 'energy', amount: 1, only: a.only }, purpose));
  // B2-14: Add abilities whose costs only affect the source (Gold-like) are preferred; others are a last resort
  const weight = (a: AddSource) => (a.ab.cost.extra ?? []).reduce((s, x) => s + (x.self ? 1 : 10), 0);
  const sorted = [...adds].sort((a, b) => weight(a) - weight(b));
  // drop activated sources the plan doesn't need (AP-2: Lux / Seal of Focus exhausted for nothing)
  const prune = (used: AddSource[], r: PlanResult): PlanResult => {
    let cur = used, best = r;
    for (const a of [...used].reverse()) {
      const without = cur.filter(x => x !== a);
      const r2 = planWith(g, p, cost, purpose, without, ex);
      if (r2 && r2.recycles <= best.recycles) { cur = without; best = r2; }
    }
    return best;
  };
  if (base) {
    // AP-1: a free Add (exhaust-only, no other cost, not a unit) that replaces a recycle is strictly better — the rune stays in play
    // and the source readies next turn (e.g. Seal of Rage for [Fury] instead of recycling a Fury rune)
    const free = sorted.filter(a => weight(a) === 0 && !(a.ab.cost.extra?.length) && a.ab.cost.exhaustSelf && !isUnit(g, a.obj));
    let best = base;
    for (let k = 1; k <= Math.min(3, free.length); k++) {
      const r = planWith(g, p, cost, purpose, free.slice(0, k), ex);
      if (r && r.recycles < best.recycles) best = prune(free.slice(0, k), r);
    }
    return best;
  }
  // try add sources, cheapest (exhaust-only) first, up to 3 of them
  for (let k = 1; k <= Math.min(3, sorted.length); k++) {
    const r = planWith(g, p, cost, purpose, sorted.slice(0, k), ex);
    if (r) return prune(sorted.slice(0, k), r);
  }
  return null;
}

export function canAfford(g: GameState, p: PlayerId, cost: ResolvedCost, purpose: Purpose, opts: { exclude?: ObjId; excludeRunes?: ObjId[] } = {}): boolean {
  return autoPay(g, p, cost, purpose, opts) !== null;
}

/** Validate a manual payment plan. Returns error or null. */
export function validatePlan(g: GameState, p: PlayerId, cost: ResolvedCost, purpose: Purpose, plan: PaymentPlan, opts: { exclude?: ObjId } = {}): string | null {
  payingState = g;
  const cv = plan.other?.convert as { key: string; n: number } | undefined;
  if (cv) {
    if (!converters(g, p, opts.exclude).some(c => c.key === cv.key)) return 'converter not usable';
    if (!(cv.n > 0) || cv.n > cost.power.filter(x => x === 'any').length) return 'bad converter amount';
    const { convert: _c, ...rest } = plan.other as Record<string, unknown>;
    return validatePlan(g, p, convertedCost(cost, cv.n), purpose, { ...plan, other: rest }, opts);
  }
  const pl = g.players[p];
  const ex = new Set(plan.exhaust), rc = new Set(plan.recycle);
  if (ex.size !== plan.exhaust.length || rc.size !== plan.recycle.length) return 'duplicate rune in plan';
  for (const r of [...ex, ...rc]) if (!pl.runesInPlay.includes(r)) return `${r} is not your rune in play`;
  for (const r of ex) if (g.objects[r].exhausted) return `${r} is already exhausted`;
  const keys = ((plan.other?.abilities as string[] | undefined) ?? []);
  if (new Set(keys).size !== keys.length) return 'duplicate add ability in plan';
  const adds = addSources(g, p, opts.exclude).filter(a => keys.includes(a.key));
  if (adds.length !== keys.length) return 'unknown add ability in plan';
  const r = planAddDomains(g, p, cost, purpose, plan, adds);
  if (typeof r === 'string') return r;
  // energy an Add makes for something else ("Use only to play spells") can't pay this cost (as planWith)
  let energy = pl.pool.energy + ex.size + adds.reduce((s, a) => s + (!a.only || restrictionOk({ kind: 'energy', amount: 1, only: a.only }, purpose) ? a.energy : 0), 0);
  for (const r of pl.poolRestricted) if (r.kind === 'energy' && restrictionOk(r, purpose)) energy += r.amount;
  if (energy < cost.energy) return 'plan does not cover the energy cost';
  return null;
}

/**
 * Match a plan's produced power to the cost (pool, Adds, recycled runes). A multi-domain [C] Add counts for any of its domains
 * (AUTO-AUDIT F-6); the domain it is matched to is returned per Add key (a domain the plan names in addDomains is kept if it fits).
 * Returns an error string if the power cost isn't covered.
 */
function planAddDomains(g: GameState, p: PlayerId, cost: ResolvedCost, purpose: Purpose, plan: PaymentPlan, adds: AddSource[]): Record<string, string> | string {
  const pl = g.players[p];
  const named = (plan.other?.addDomains as Record<string, string> | undefined) ?? {};
  const units: PowerUnit[] = [];
  for (const r of pl.poolRestricted) if (r.kind === 'power' && restrictionOk(r, purpose)) for (let i = 0; i < r.amount; i++) units.push({ domain: (r.domain ?? 'any') as Domain | 'any', src: 'x' });
  for (const [d, n] of poolEntries(pl.pool.power)) for (let i = 0; i < (n ?? 0); i++) units.push({ domain: d === 'Colorless' ? 'any' : (d as Domain), src: 'pool' });
  for (const a of adds) {
    if (a.only && !restrictionOk({ kind: 'power', amount: 1, only: a.only }, purpose)) continue;
    a.power.forEach((d, i) => {
      const doms = a.powerDoms[i];
      const fixed = doms && named[a.key] && doms.includes(named[a.key] as Domain) ? [named[a.key] as Domain] : doms;
      units.push({ domain: d, src: `add:${a.key}`, doms: fixed ?? undefined });
    });
  }
  for (const r of new Set(plan.recycle)) { const d = g.cards[g.objects[r].cardId].domains[0]; units.push({ domain: d && d !== 'Colorless' ? d : 'any', src: 'r:' + r }); }
  const m = matchPower(cost.power, units);
  if (!m) return 'plan does not cover the power cost';
  const out: Record<string, string> = { ...named };
  m.forEach((ui, ri) => { const u = units[ui]; if (u.doms && u.src.startsWith('add:')) { const rq = cost.power[ri]; out[u.src.slice(4)] = rq === 'any' ? u.doms[0] : (u.doms.find(d => rq.includes(d)) ?? u.doms[0]); } });
  return out;
}

/** AUTO-AUDIT E1: every Add source this payment may use, for the payment Decision's panel ({key, obj, label}). */
export function paymentAdds(g: GameState, p: PlayerId, purpose: Purpose, exclude?: ObjId): { key: string; obj: ObjId; label: string }[] {
  payingState = g;
  return addSources(g, p, exclude)
    .filter(a => !a.only || restrictionOk({ kind: 'energy', amount: 1, only: a.only }, purpose))
    .map(a => ({ key: a.key, obj: a.obj, label: `${cardName(g, a.obj)}: ${a.ab.label ?? a.ab.text ?? 'Add'}` }));
}

/**
 * The plan to execute for a payment (A-1 / AUTO-AUDIT E2): the auto-pay plan, or — when the player chose "choose runes when paying"
 * (`manualPay`) and the cost needs resources — a 'payment' Decision with the auto-pay plan preselected (`data.suggested`) and every
 * usable Add source listed (`data.adds`). Used by plays, activations, hiding, trigger costs and Deflect, costs paid during a
 * resolution (ctx.pay) and token Accelerate.
 */
export function choosePayment(g: GameState, p: PlayerId, cost: ResolvedCost, purpose: Purpose, auto: PlanResult, source?: ObjId, opts: { exclude?: ObjId; prompt?: string } = {}): PaymentPlan {
  if (!g.ex.manualPay?.[p] || (cost.energy === 0 && cost.power.length === 0)) return auto.plan;
  const res = { energy: cost.energy, power: cost.power };   // (Decision data must stay serializable: no extra-cost functions)
  const a = ask(g, { kind: 'payment', player: p, prompt: opts.prompt ?? `Pay ${costLabel(res)}`, source: source || undefined,
    options: [{ id: 'auto', label: 'Auto-pay' }, { id: 'manual', label: 'Choose runes' }], min: 1, max: 1,
    data: { validator: 'payment', cost: res, purpose, suggested: auto.plan, adds: paymentAdds(g, p, purpose, opts.exclude), ...(opts.exclude ? { exclude: opts.exclude } : {}) } });
  if (a.type === 'choose' && a.optionIds[0] === 'manual' && a.data) return a.data as PaymentPlan;
  return auto.plan;
}

/** Execute a plan: produce resources then spend the cost from the pool. */
export function executePayment(g: GameState, p: PlayerId, cost: ResolvedCost, purpose: Purpose, plan: PaymentPlan): void {
  payingState = g;
  const pl = g.players[p];
  const keys = ((plan.other?.abilities as string[] | undefined) ?? []);
  // a manual plan may leave out which domain a multi-domain [C] Add makes: take the one the match needs (F-6)
  const planned = addSources(g, p).filter(a => keys.includes(a.key));
  const doms0 = planned.some(a => a.powerDoms.some(x => x)) ? planAddDomains(g, p, cost, purpose, plan, planned) : {};
  const addDoms = typeof doms0 === 'string' ? ((plan.other?.addDomains as Record<string, string> | undefined) ?? {}) : doms0;
  for (const k of keys) {
    const a = addSources(g, p).find(x => x.key === k);
    if (!a) continue;
    const ctx = makeCtx(g, a.obj, p);
    const srcChars = chars(g, a.obj);
    const was = { cardId: g.objects[a.obj]?.cardId, cardType: srcChars.type };   // (the source may be killed as the cost: Gold)
    ctx.data.__srcDomains = srcChars.domains;
    const ad = addDoms[k];
    if (ad) ctx.data.__domain = ad;
    if (a.ab.cost.exhaustSelf) exhaust(g, [a.obj], p);
    for (const x of a.ab.cost.extra ?? []) x.pay(ctx);
    a.ab.effect(ctx);
    emit(g, { type: 'activated', obj: a.obj, player: p, isAdd: true, cardId: was.cardId, cardType: was.cardType, sourceType: was.cardType });
  }
  for (const r of plan.exhaust) { exhaust(g, [r], p); addResources(g, p, 1, [], undefined, r); }
  for (const r of plan.recycle) {
    const d = g.cards[g.objects[r].cardId].domains[0];
    recycle(g, [r]);
    addResources(g, p, 0, [d && d !== 'Colorless' ? d : 'any'], undefined, r);
  }
  // RJ#7770: a converter (Ancient Henge) is activated with the produced resources: exhaust it, pay n Energy, Add n [A]
  const cv = plan.other?.convert as { key: string; n: number } | undefined;
  const conv = cv ? converters(g, p).find(c => c.key === cv.key) : undefined;
  if (cv && conv) {
    const cd = g.objects[conv.obj]?.cardId;
    exhaust(g, [conv.obj], p);
    spendFromPool(g, p, { energy: cv.n, power: [] }, purpose);
    g.ex.counts[`energySpent:${p}`] = (g.ex.counts[`energySpent:${p}`] ?? 0) + cv.n;
    addResources(g, p, 0, new Array(cv.n).fill('any'), undefined, conv.obj);
    log(g, p, `${cardName(g, conv.obj)}: pay ${cv.n} Energy, add ${cv.n} [A]`);
    emit(g, { type: 'activated', obj: conv.obj, player: p, isAdd: true, cardId: cd, cardType: chars(g, conv.obj).type, sourceType: chars(g, conv.obj).type });
  }
  spendFromPool(g, p, cost, purpose);
  // B4-5: amounts spent this turn
  g.ex.counts[`energySpent:${p}`] = (g.ex.counts[`energySpent:${p}`] ?? 0) + cost.energy;
  g.ex.counts[`powerSpent:${p}`] = (g.ex.counts[`powerSpent:${p}`] ?? 0) + cost.power.length;
  if (cost.energy || cost.power.length) log(g, p, `${pl.name} pays ${costLabel(cost)}`);
}

function spendFromPool(g: GameState, p: PlayerId, cost: ResolvedCost, purpose: Purpose): void {
  const pl = g.players[p];
  // energy: restricted first
  let e = cost.energy;
  for (const r of pl.poolRestricted) {
    if (e <= 0) break;
    if (r.kind !== 'energy' || !restrictionOk(r, purpose)) continue;
    const t = Math.min(e, r.amount); r.amount -= t; e -= t;
  }
  pl.pool.energy -= e;
  if (pl.pool.energy < 0) pl.pool.energy = 0;
  // power: build units from restricted + pool, match, then consume
  const units: (PowerUnit & { ref: RestrictedResource | Domain })[] = [];
  for (const r of pl.poolRestricted) if (r.kind === 'power' && restrictionOk(r, purpose)) for (let i = 0; i < r.amount; i++) units.push({ domain: (r.domain ?? 'any') as Domain | 'any', src: 'x', ref: r });
  for (const [d, n] of poolEntries(pl.pool.power)) for (let i = 0; i < (n ?? 0); i++) units.push({ domain: d === 'Colorless' ? 'any' : (d as Domain), src: 'pool', ref: d as Domain });
  const m = matchPower(cost.power, units);
  if (m) for (const ui of m) {
    const u = units[ui];
    if (typeof u.ref === 'string') pl.pool.power[u.ref] = (pl.pool.power[u.ref] ?? 1) - 1;
    else u.ref.amount -= 1;
  }
  pl.poolRestricted = pl.poolRestricted.filter(r => r.amount > 0);
  for (const k of Object.keys(pl.pool.power) as Domain[]) if (!pl.pool.power[k]) delete pl.pool.power[k];
}

/** Non-resource parts of a cost: exhaust self + extra costs. */
export function canPayNonResource(g: GameState, p: PlayerId, src: ObjId, cost: ResolvedCost): boolean {
  if (cost.exhaustSelf) { const o = g.objects[src]; if (!o || o.exhausted) return false; }
  const ctx = makeCtx(g, src, p);
  return (cost.extra ?? []).every(x => x.canPay(ctx));
}

/** `data` (SF-5): the paying item's data, so a cost can pass what it paid to the effect (pay.killFriendly's killedForCost*) */
export function payNonResource(g: GameState, p: PlayerId, src: ObjId, cost: ResolvedCost, data?: Record<string, unknown>): boolean {
  if (cost.exhaustSelf) { if (g.objects[src]?.exhausted) return false; exhaust(g, [src], p); }
  const ctx = makeCtx(g, src, p, data ? { data } : {});
  for (const x of cost.extra ?? []) { if (x.pay(ctx) === false) return false; }
  return true;
}

export function addCosts(a: ResolvedCost, b: ResolvedCost): ResolvedCost {
  return { energy: a.energy + b.energy, power: [...a.power, ...b.power], exhaustSelf: a.exhaustSelf || b.exhaustSelf, extra: [...(a.extra ?? []), ...(b.extra ?? [])] };
}
export { onBoard };

/** Payment purpose for an activated ability, by the type of its source (B8-7). */
export function abilityPurpose(g: GameState, src: ObjId): Purpose {
  const o = g.objects[src];
  if (!o) return 'ability';
  if (o.zone === 'legendZone') return 'legendAbility';
  const t = chars(g, src).type;
  return t === 'Unit' ? 'unitAbility' : t === 'Gear' ? 'gearAbility' : 'ability';
}

// Riftforge card-script DSL. See docs/dsl-guide.md for how to script a card.
//
// A script is { id, text, abilities } (CardScript). Abilities are built with the constructors below;
// effects are functions (ctx: Ctx) => void. Use the E.* combinators for common effects, or write the
// effect imperatively with ctx.* (see src/engine/context.ts for the full Ctx API).
import type {
  Ability, ActivatedAbility, AsPlayAbility, CardScript, CostModAbility, CostSpec, Dependency, Effect, ExtraCost, Mode,
  MovePermissionAbility, PlayPermissionAbility, PlayRuleAbility, PowerSym, ReplacementAbility, RuleAbility, RuleName,
  SpellAbility, StaticAbility, StaticMods, TargetSpec, TriggeredAbility, TargetKind, ZoneSel, Destination,
} from '../engine/abilities.ts';
import type { Ctx } from '../engine/context.ts';
import type { GameEvent, ObjId, PlayerId, Domain } from '../engine/types.ts';
import { registerScript, registerGrant, registerDelayed } from './registry.ts';
import { parseCost } from '../engine/keywords.ts';

export type { Ctx, Effect, TargetSpec, CardScript, Ability, CostSpec, GameEvent, ObjId, PlayerId };
type Loc = 'base' | number;

// =====================================================================================
// Scripts
// =====================================================================================

export interface ScriptOpts {
  keywords?: string[];
  costs?: CardScript['costs'];
  maxEmpower?: number;
  entersReady?: CardScript['entersReady'];
  additionalCosts?: CardScript['additionalCosts'];
}

/** Define and register a card script. `text` must be the card's effective text (cards.json `text`). */
export function card(id: string, text: string, abilities: Ability[], opts: ScriptOpts = {}): CardScript {
  const s: CardScript = { id, text, abilities, ...opts };
  registerScript(s);
  return s;
}

// =====================================================================================
// Costs
// =====================================================================================

/** Parse "[1][C]", "[A][A]", "[2], [T]" etc. Extra (non-resource) costs can be appended. */
export function cost(s = '', ...extra: ExtraCost[]): CostSpec {
  const c = s ? parseCost(s) : { energy: 0, power: [] as PowerSym[] };
  if (!c) throw new Error(`dsl.cost: cannot parse "${s}"`);
  if (extra.length) c.extra = extra;
  return c;
}

/** Non-resource cost parts (CR 204). */
export const pay = {
  discard(n = 1): ExtraCost {
    return { label: `Discard ${n}`, canPay: ctx => ctx.hand().filter(h => h !== ctx.self).length >= n, pay: ctx => ctx.discard(n).length === n };
  },
  killSelf(): ExtraCost { return { label: 'Kill this', self: true, canPay: ctx => ctx.onBoard(ctx.abilitySource ?? ctx.self), pay: ctx => { const s = ctx.abilitySource ?? ctx.self; if (!ctx.onBoard(s)) return false; ctx.kill(s); return true; } }; },   // CR 203.2: paid even if the kill is replaced
  banishSelf(): ExtraCost { return { label: 'Banish this', self: true, canPay: ctx => !!ctx.obj(ctx.abilitySource ?? ctx.self), pay: ctx => ctx.banish(ctx.abilitySource ?? ctx.self).length === 1 }; },
  recycleSelf(): ExtraCost { return { label: 'Recycle this', self: true, canPay: () => true, pay: ctx => ctx.recycle(ctx.abilitySource ?? ctx.self).length === 1 }; },
  spendXp(n: number): ExtraCost { return { label: `Spend ${n} XP`, canPay: ctx => ctx.xp() >= n, pay: ctx => ctx.spendXp(n) }; },
  spendBuff(of: 'self' | 'friendly' = 'self'): ExtraCost {
    return of === 'self'
      ? { label: 'Spend my buff', canPay: ctx => ctx.isBuffed(ctx.self), pay: ctx => ctx.spendBuff(ctx.self) }
      : { label: 'Spend a buff', canPay: ctx => ctx.friendlyUnits(u => ctx.isBuffed(u)).length > 0, pay: ctx => { const u = ctx.chooseCards(ctx.friendlyUnits(x => ctx.isBuffed(x)), 1, 1, 'Spend a buff from')[0]; return !!u && ctx.spendBuff(u); } };
  },
  disempowerSelf(): ExtraCost { return { label: 'Disempower this', canPay: ctx => ctx.isEmpowered(ctx.abilitySource ?? ctx.self), pay: ctx => ctx.disempower(ctx.abilitySource ?? ctx.self) }; },
  /** exhaust another friendly permanent/unit matching filter */
  exhaustFriendly(filter: (ctx: Ctx, id: ObjId) => boolean = (c, id) => c.isUnit(id), label = 'Exhaust a friendly unit'): ExtraCost {
    const cands = (ctx: Ctx) => [...ctx.friendlyUnits(), ...ctx.gear(g => ctx.isFriendly(g))].filter(id => id !== (ctx.abilitySource ?? ctx.self) && !ctx.isExhausted(id) && ctx.ctrl(id) === ctx.controller && filter(ctx, id));
    return { label, canPay: ctx => cands(ctx).length > 0, pay: ctx => { const u = ctx.chooseCards(cands(ctx), 1, 1, label)[0]; if (!u) return false; ctx.exhaust(u); return true; } };
  },
  /** includeSelf (RJ#6900): the source may pay with itself (Malzahar: exhaust, then kill himself — CR 357 costs in any order) */
  killFriendly(filter: (ctx: Ctx, id: ObjId) => boolean = (c, id) => c.isUnit(id), label = 'Kill a friendly unit', o: { includeSelf?: boolean } = {}): ExtraCost {
    const cands = (ctx: Ctx) => [...ctx.friendlyUnits(), ...ctx.gear(g => ctx.isFriendly(g))].filter(id => (o.includeSelf || id !== ctx.self) && ctx.ctrl(id) === ctx.controller && filter(ctx, id));
    return { label, canPay: ctx => cands(ctx).length > 0, pay: ctx => { const u = ctx.chooseCards(cands(ctx), 1, 1, label)[0]; if (!u) return false; ctx.data.killedForCost = u; ctx.data.killedForCostEnergy = ctx.energyCost(u); ctx.data.killedForCostPower = ctx.powerCost(u); ctx.kill(u); return true; } };   // CR 203.2: paid even if the kill is replaced (The Boss, RJ#10651)
  },
  recycleFromTrash(n: number, filter: (ctx: Ctx, id: ObjId) => boolean = () => true): ExtraCost {
    const cands = (ctx: Ctx) => ctx.trash().filter(id => id !== ctx.self && filter(ctx, id));
    return { label: `Recycle ${n} from your trash`, canPay: ctx => cands(ctx).length >= n, pay: ctx => ctx.recycle(ctx.chooseCards(cands(ctx), n, n, `Recycle ${n} from your trash`)).length === n };
  },
  banishFromTrash(n: number, filter: (ctx: Ctx, id: ObjId) => boolean = () => true): ExtraCost {
    const cands = (ctx: Ctx) => ctx.trash().filter(id => id !== ctx.self && filter(ctx, id));
    return { label: `Banish ${n} from your trash`, canPay: ctx => cands(ctx).length >= n, pay: ctx => ctx.banish(ctx.chooseCards(cands(ctx), n, n, `Banish ${n} from your trash`)).length === n };
  },
  returnFriendlyToHand(filter: (ctx: Ctx, id: ObjId) => boolean = (c, id) => c.isUnit(id)): ExtraCost {
    const cands = (ctx: Ctx) => ctx.friendlyUnits(u => u !== ctx.self && ctx.ctrl(u) === ctx.controller && filter(ctx, u));
    return { label: 'Return a friendly unit to hand', canPay: ctx => cands(ctx).length > 0, pay: ctx => { const u = ctx.chooseCards(cands(ctx), 1, 1, 'Return to hand')[0]; return !!u && ctx.returnToHand(u).length === 1; } };
  },
  custom(label: string, canPay: (ctx: Ctx) => boolean, payFn: (ctx: Ctx) => boolean | void): ExtraCost { return { label, canPay, pay: payFn }; },
};

// =====================================================================================
// Filters & target specs
// =====================================================================================

export type Filter = (ctx: Ctx, id: ObjId) => boolean;

/** Composable object filters. */
export const F = {
  /** R-2 destination filter: a location the unit chosen in group i can be moved to (use with T.destination) */
  moveDestFor: (i = 0): Filter => (c, id) => c.validMoveDest(c.target(i), c.destOf(id)),
  /** R-2 destination filter on the location a destination choice stands for: F.dest((c, l) => typeof l === 'number') */
  dest: (pred: (c: Ctx, l: Loc) => boolean): Filter => (c, id) => { const l = c.destOf(id); return l !== null && pred(c, l); },
  any: (() => true) as Filter,
  enemy: ((c, id) => c.isEnemy(id)) as Filter,
  friendly: ((c, id) => c.isFriendly(id)) as Filter,
  youControl: ((c, id) => c.obj(id)?.controller === c.controller) as Filter,
  other: ((c, id) => id !== c.self) as Filter,
  self: ((c, id) => id === c.self) as Filter,
  unit: ((c, id) => c.isUnit(id)) as Filter,
  gear: ((c, id) => c.isGear(id)) as Filter,          // incl. Gear Units (additionalTypes, SF-1) and gear that became units
  equipment: ((c, id) => c.isEquipment(id)) as Filter,
  spell: ((c, id) => c.type(id) === 'Spell') as Filter,
  atBattlefield: ((c, id) => c.atBattlefield(id)) as Filter,
  atBase: ((c, id) => c.loc(id) === 'base') as Filter,
  here: ((c, id) => c.isHere(id)) as Filter,
  /** at the battlefield given by ctx.data.there (set by the script) */
  there: ((c, id) => c.loc(id) === c.data.there) as Filter,
  inCombat: ((c, id) => !!c.obj(id)?.combatRole) as Filter,
  attacking: ((c, id) => c.isAttacking(id)) as Filter,
  defending: ((c, id) => c.isDefending(id)) as Filter,
  stunned: ((c, id) => c.isStunned(id)) as Filter,
  exhausted: ((c, id) => c.isExhausted(id)) as Filter,
  ready: ((c, id) => !c.isExhausted(id)) as Filter,
  buffed: ((c, id) => c.isBuffed(id)) as Filter,
  damaged: ((c, id) => c.damage(id) > 0) as Filter,
  token: ((c, id) => c.isToken(id)) as Filter,
  nonToken: ((c, id) => !c.isToken(id)) as Filter,
  champion: ((c, id) => c.isChampion(id)) as Filter,
  mighty: ((c, id) => c.isMighty(id)) as Filter,
  empowered: ((c, id) => c.isEmpowered(id)) as Filter,
  equipped: ((c, id) => c.attachments(id).length > 0) as Filter,
  facedown: ((c, id) => c.obj(id)?.zone === 'facedown') as Filter,
  mightAtMost: (n: number): Filter => (c, id) => c.might(id) <= n,
  mightAtLeast: (n: number): Filter => (c, id) => c.might(id) >= n,
  mightLessThan: (ref: (ctx: Ctx) => number): Filter => (c, id) => c.might(id) < ref(c),
  costAtMost: (n: number): Filter => (c, id) => c.energyCost(id) <= n,
  powerAtMost: (n: number): Filter => (c, id) => c.powerCost(id) <= n,
  tag: (...tags: string[]): Filter => (c, id) => tags.some(t => c.hasTag(id, t)),
  domain: (d: Domain): Filter => (c, id) => c.domains(id).includes(d),
  keyword: (kw: string): Filter => (c, id) => c.has(id, kw),
  named: (name: string): Filter => (c, id) => c.name(id) === name,
  at: (loc: (ctx: Ctx) => Loc | null): Filter => (c, id) => { const l = loc(c); return l !== null && c.loc(id) === l; },
  notChosen: (key = 'chosen'): Filter => (c, id) => !((c.data[key] as ObjId[] | undefined) ?? []).includes(id),
  and: (...fs: Filter[]): Filter => (c, id) => fs.every(f => f(c, id)),
  or: (...fs: Filter[]): Filter => (c, id) => fs.some(f => f(c, id)),
  not: (f: Filter): Filter => (c, id) => !f(c, id),
};

/** anyLocation: the group's text makes the Hidden "here" restriction impossible ("at a different location"; CR 811.1.d.2-.4) */
export interface TOpts { prompt?: string; min?: number; max?: number; hint?: 'harm' | 'help' | 'neutral'; zones?: ZoneSel[]; pick?: boolean; sameLocation?: boolean; split?: number | ((ctx: Ctx) => number); anyLocation?: boolean }

function spec(kind: TargetKind, filters: Filter[], o: TOpts = {}): TargetSpec {
  return {
    kind, prompt: o.prompt, min: o.min, max: o.max, hint: o.hint, zones: o.zones, pick: o.pick, sameLocation: o.sameLocation,
    splitAmount: o.split, ...(o.anyLocation ? { anyLocation: true } : {}), filter: filters.length ? (ctx, id) => filters.every(f => f(ctx, id)) : undefined,
  };
}

/** Target specs. T.unit(F.enemy, F.atBattlefield) etc. Pass options as the last argument. */
export const T = {
  unit: (...a: (Filter | TOpts)[]) => spec('unit', a.filter(x => typeof x === 'function') as Filter[], (a.find(x => typeof x === 'object') as TOpts) ?? {}),
  gear: (...a: (Filter | TOpts)[]) => spec('gear', a.filter(x => typeof x === 'function') as Filter[], (a.find(x => typeof x === 'object') as TOpts) ?? {}),
  permanent: (...a: (Filter | TOpts)[]) => spec('permanent', a.filter(x => typeof x === 'function') as Filter[], (a.find(x => typeof x === 'object') as TOpts) ?? {}),
  battlefield: (...a: (Filter | TOpts)[]) => spec('battlefield', a.filter(x => typeof x === 'function') as Filter[], (a.find(x => typeof x === 'object') as TOpts) ?? {}),
  rune: (...a: (Filter | TOpts)[]) => spec('rune', a.filter(x => typeof x === 'function') as Filter[], (a.find(x => typeof x === 'object') as TOpts) ?? {}),
  legend: (...a: (Filter | TOpts)[]) => spec('legend', a.filter(x => typeof x === 'function') as Filter[], (a.find(x => typeof x === 'object') as TOpts) ?? {}),
  /**
   * R-2 (CR 355.4): a move destination chosen as the spell/ability is played or the trigger goes on the chain. Choices are
   * "loc:base" and battlefield card ids; filters get that id (ctx.destOf(id) gives the Loc). Read it with ctx.destination(i).
   * Not a target: no Deflect, no "chosen" events. Typical: T.destination(D.movable(0)) after the unit group 0.
   */
  destination: (...a: (Filter | TOpts)[]) => spec('destination', a.filter(x => typeof x === 'function') as Filter[], { prompt: 'Choose a destination', ...((a.find(x => typeof x === 'object') as TOpts) ?? {}) }),
  /** a spell or ability on the chain (filter receives the chain item id) */
  chainItem: (...a: (Filter | TOpts)[]) => spec('chainItem', a.filter(x => typeof x === 'function') as Filter[], (a.find(x => typeof x === 'object') as TOpts) ?? {}),
  /** cards in non-board zones: T.card({ zones: ['trash'] }, F.unit) */
  card: (...a: (Filter | TOpts)[]) => spec('card', a.filter(x => typeof x === 'function') as Filter[], (a.find(x => typeof x === 'object') as TOpts) ?? {}),
  upTo: (n: number, s: TargetSpec): TargetSpec => ({ ...s, min: 0, max: n }),
  exactly: (n: number, s: TargetSpec): TargetSpec => ({ ...s, min: n, max: n }),
  anyNumber: (s: TargetSpec): TargetSpec => ({ ...s, min: 0, max: 99 }),
};

// =====================================================================================
// References (what an effect acts on)
// =====================================================================================

/** 0,1,.. = chosen target group; 'self' = this object; or a function returning ids. */
export type Ref = number | 'self' | 'host' | ((ctx: Ctx) => ObjId | ObjId[] | undefined | null);

export function resolveRef(ctx: Ctx, r: Ref): ObjId[] {
  if (typeof r === 'number') return ctx.targetsOf(r).filter(id => ctx.exists(id) || ctx.g.chain.some(c => c.id === id));
  if (r === 'self') return ctx.exists(ctx.self) ? [ctx.self] : [];
  if (r === 'host') { const h = ctx.obj(ctx.abilitySource ?? ctx.self)?.attachedTo; return h ? [h] : ctx.exists(ctx.self) ? [ctx.self] : []; }
  const v = r(ctx);
  return v == null ? [] : Array.isArray(v) ? v : [v];
}

export type Num = number | ((ctx: Ctx) => number);
export const num = (ctx: Ctx, n: Num): number => (typeof n === 'function' ? n(ctx) : n);

/** Common references */
export const R = {
  target: (i = 0): Ref => i,
  self: 'self' as Ref,
  /** the unit this gear is attached to (effect text) */
  host: 'host' as Ref,
  /** the object of the triggering event */
  eventObj: ((ctx: Ctx) => ctx.event?.obj as ObjId | undefined) as Ref,
  all: (f: Filter): Ref => ctx => ctx.units(u => f(ctx, u)),
  allGear: (f: Filter): Ref => ctx => ctx.gear(u => f(ctx, u)),
  enemiesHere: ((ctx: Ctx) => ctx.units(u => ctx.isEnemy(u) && ctx.isHere(u))) as Ref,
  friendliesHere: ((ctx: Ctx) => ctx.units(u => ctx.isFriendly(u) && ctx.isHere(u))) as Ref,
  stored: (key: string): Ref => ctx => ctx.data[key] as ObjId | ObjId[] | undefined,
};

// =====================================================================================
// Effects
// =====================================================================================

type Dur = 'endOfTurn' | 'endOfCombat' | 'permanent' | 'whileSource';

export const E = {
  seq: (...effects: Effect[]): Effect => ctx => { for (const e of effects) e(ctx); },
  noop: (() => {}) as Effect,
  deal: (n: Num, r: Ref): Effect => ctx => { const amt = num(ctx, n); if (amt > 0) ctx.deal(amt, resolveRef(ctx, r)); },
  /** damage split chosen at play time: target group i with T.unit({split: N, max: N}) */
  dealSplit: (i = 0): Effect => ctx => { ctx.dealSplit(i); },
  kill: (r: Ref): Effect => ctx => { ctx.kill(resolveRef(ctx, r)); },
  banish: (r: Ref): Effect => ctx => { ctx.banish(resolveRef(ctx, r)); },
  recycle: (r: Ref): Effect => ctx => { ctx.recycle(resolveRef(ctx, r)); },
  returnToHand: (r: Ref): Effect => ctx => { ctx.returnToHand(resolveRef(ctx, r)); },
  recall: (r: Ref): Effect => ctx => ctx.recall(resolveRef(ctx, r)),
  draw: (n: Num = 1, who?: (ctx: Ctx) => PlayerId): Effect => ctx => { ctx.draw(num(ctx, n), who ? who(ctx) : ctx.controller); },
  discard: (n: Num = 1, who?: (ctx: Ctx) => PlayerId): Effect => ctx => { ctx.discard(num(ctx, n), who ? who(ctx) : ctx.controller); },
  channel: (n: Num = 1, exhausted = false): Effect => ctx => { ctx.channel(num(ctx, n), exhausted); },
  ready: (r: Ref): Effect => ctx => ctx.ready(resolveRef(ctx, r)),
  exhaust: (r: Ref): Effect => ctx => ctx.exhaust(resolveRef(ctx, r)),
  stun: (r: Ref): Effect => ctx => ctx.stun(resolveRef(ctx, r)),
  buff: (r: Ref): Effect => ctx => { for (const id of resolveRef(ctx, r)) ctx.buff(id); },
  heal: (r: Ref): Effect => ctx => ctx.heal(resolveRef(ctx, r)),
  might: (r: Ref, n: Num, dur: Dur = 'endOfTurn'): Effect => ctx => ctx.giveMight(resolveRef(ctx, r), num(ctx, n), dur),
  /** -N Might to a minimum of `floor` (snapshotted, CR 477.3.b) */
  mightMin: (r: Ref, n: Num, floor = 1, dur: Dur = 'endOfTurn'): Effect => ctx => {
    for (const id of resolveRef(ctx, r)) { const m = ctx.might(id); const d = Math.min(num(ctx, n), Math.max(0, m - floor)); if (d > 0) ctx.giveMight(id, -d, dur); }
  },
  keyword: (r: Ref, kw: string | string[], dur: Dur = 'endOfTurn'): Effect => ctx => ctx.giveKeyword(resolveRef(ctx, r), kw, dur),
  grant: (r: Ref, key: string, dur: Dur = 'endOfTurn'): Effect => ctx => ctx.grant(resolveRef(ctx, r), key, dur),
  /** R-2: move the unit chosen in group `unit` to the destination chosen in group `dest` (if still a legal move) */
  moveToChosen: (unit = 0, dest = 1): Effect => ctx => { const u = ctx.target(unit), d = ctx.destination(dest); if (u && d !== null && ctx.validMoveDest(u, d)) ctx.move(u, d); },   // a "can't move" rule negates it in ctx.move
  move: (r: Ref, to: Loc | ((ctx: Ctx) => Loc | null | undefined)): Effect => ctx => { const d = typeof to === 'function' ? to(ctx) : to; if (d !== null && d !== undefined) ctx.move(resolveRef(ctx, r), d); },
  token: (name: string, o: { count?: Num; at?: Loc | ((ctx: Ctx) => Loc | null | undefined); ready?: boolean; exhausted?: boolean; might?: number } = {}): Effect => ctx => {
    const at = typeof o.at === 'function' ? o.at(ctx) : o.at;
    const ids = ctx.createToken(name, at ?? 'base', { count: num(ctx, o.count ?? 1), exhausted: o.ready ? false : o.exhausted, might: o.might });
    ctx.data.tokens = ids;
  },
  points: (n: Num = 1, who?: (ctx: Ctx) => PlayerId): Effect => ctx => { ctx.scorePoint(who ? who(ctx) : ctx.controller, num(ctx, n)); },
  add: (energy: number, power: (Domain | 'any')[] = [], only?: string): Effect => ctx => ctx.add(energy, power, only),
  predict: (n: Num = 1): Effect => ctx => ctx.predict(num(ctx, n)),
  burn: (n: Num, who?: (ctx: Ctx) => PlayerId): Effect => ctx => { ctx.burn(num(ctx, n), who ? who(ctx) : ctx.controller); },
  xp: (n: Num = 1): Effect => ctx => ctx.gainXp(num(ctx, n)),
  empower: (r: Ref = 'self', max = 1): Effect => ctx => { for (const id of resolveRef(ctx, r)) ctx.empower(id, max); },
  disempower: (r: Ref = 'self'): Effect => ctx => { for (const id of resolveRef(ctx, r)) ctx.disempower(id); },
  counter: (r: Ref = 0): Effect => ctx => { for (const id of resolveRef(ctx, r)) ctx.counter(id); },
  attach: (gear: Ref, unit: Ref): Effect => ctx => { const g = resolveRef(ctx, gear)[0], u = resolveRef(ctx, unit)[0]; if (g && u) ctx.attach(g, u); },
  takeControl: (r: Ref): Effect => ctx => { for (const id of resolveRef(ctx, r)) ctx.takeControl(id); },
  fight: (a: Ref, b: Ref): Effect => ctx => { const x = resolveRef(ctx, a)[0], y = resolveRef(ctx, b)[0]; if (x && y) ctx.fight(x, y); },
  prevent: (r: Ref, n: number | 'all', dur: 'endOfTurn' | 'endOfCombat' = 'endOfTurn'): Effect => ctx => { for (const id of resolveRef(ctx, r)) ctx.prevent(id, n, dur); },
  /** "you may X": asks yes/no then runs */
  may: (prompt: string, then: Effect, otherwise?: Effect): Effect => ctx => { if (ctx.may(prompt)) { ctx.data.did = true; then(ctx); } else { ctx.data.did = false; otherwise?.(ctx); } },
  /** "you may pay COST to X" */
  mayPay: (c: CostSpec, prompt: string, then: Effect): Effect => ctx => { if (ctx.mayPay(c, prompt)) { ctx.data.paid = true; then(ctx); } },
  when: (cond: (ctx: Ctx) => boolean, then: Effect, otherwise?: Effect): Effect => ctx => { if (cond(ctx)) then(ctx); else otherwise?.(ctx); },
  forEach: (ids: (ctx: Ctx) => ObjId[], f: (ctx: Ctx, id: ObjId) => void): Effect => ctx => { for (const id of ids(ctx)) f(ctx, id); },
  repeat: (n: Num, e: Effect): Effect => ctx => { const k = num(ctx, n); for (let i = 0; i < k; i++) e(ctx); },
  /** choose an object on resolution (not at play time) and store it in ctx.data[key] */
  chooseNow: (s: TargetSpec, key = 'chosen'): Effect => ctx => { ctx.data[key] = ctx.choose(s); },
  /** "choose one" made on resolution */
  chooseOne: (modes: { label: string; effect: Effect; if?: (ctx: Ctx) => boolean }[]): Effect => ctx => {
    const avail = modes.map((m, i) => ({ ...m, id: String(i) })).filter(m => !m.if || m.if(ctx));
    if (!avail.length) return;
    const id = ctx.chooseMode(avail.map(m => ({ id: m.id, label: m.label })));
    avail.find(m => m.id === id)!.effect(ctx);
  },
  /**
   * Look at (or reveal) the top N cards, pick up to `max` matching `filter`, do `pick` with them,
   * and put the rest at the bottom (recycle), in the trash, or back on top.
   */
  lookTop: (n: Num, o: { reveal?: boolean; filter?: Filter; min?: number; max?: number; prompt?: string; pick: 'hand' | 'play' | 'playFree' | 'banish' | 'trash' | ((ctx: Ctx, ids: ObjId[]) => void); rest?: 'recycle' | 'trash' | 'top' | 'keep' }): Effect => ctx => {
    const ids = o.reveal ? ctx.revealTop(num(ctx, n)) : ctx.lookTop(num(ctx, n));
    const cands = ids.filter(id => !o.filter || o.filter(ctx, id));
    const picked = ctx.chooseCards(cands, o.min ?? 0, o.max ?? 1, o.prompt ?? 'Choose');
    ctx.data.picked = picked;
    if (typeof o.pick === 'function') o.pick(ctx, picked);
    else for (const id of picked) {
      if (o.pick === 'hand') { if (!o.reveal) ctx.reveal([id]); ctx.toHand(id); }
      else if (o.pick === 'play') ctx.play(id, { ignoreCost: false });
      else if (o.pick === 'playFree') ctx.play(id, { ignoreCost: true });
      else if (o.pick === 'banish') ctx.banish(id);
      else if (o.pick === 'trash') ctx.recycle([]), ctx.burn(0), moveTo(ctx, id, 'trash');
    }
    const rest = ids.filter(id => !picked.includes(id) && ctx.obj(id)?.zone === 'mainDeck');
    if (o.rest === 'trash') for (const id of rest) moveTo(ctx, id, 'trash');
    else if (o.rest === 'top' || o.rest === 'keep') { /* stay */ }
    else ctx.recycle(rest);
  },
  log: (text: string): Effect => ctx => ctx.log(text),
};

function moveTo(ctx: Ctx, id: ObjId, zone: 'trash'): void {
  // trash directly from the deck (not a burn): used by look/reveal effects
  if (zone === 'trash') { const o = ctx.obj(id); if (o) { ctx.toDeck(id, 'top'); ctx.burn(1, o.owner); } }
}

// =====================================================================================
// Conditions
// =====================================================================================

export const C = {
  myTurn: (ctx: Ctx) => ctx.isMyTurn(),
  notMyTurn: (ctx: Ctx) => !ctx.isMyTurn(),
  inShowdown: (ctx: Ctx) => ctx.inShowdown(),
  inCombat: (ctx: Ctx) => !!ctx.obj(ctx.self)?.combatRole,
  atBattlefield: (ctx: Ctx) => typeof ctx.loc(ctx.self) === 'number',
  atBase: (ctx: Ctx) => ctx.loc(ctx.self) === 'base',
  attacking: (ctx: Ctx) => ctx.isAttacking(ctx.self),
  defending: (ctx: Ctx) => ctx.isDefending(ctx.self),
  empowered: (ctx: Ctx) => ctx.isEmpowered(ctx.self),
  mighty: (ctx: Ctx) => ctx.isMighty(ctx.self),
  buffed: (ctx: Ctx) => ctx.isBuffed(ctx.self),
  alone: (ctx: Ctx) => { const h = ctx.here(); return h !== null && ctx.unitsAt(h, u => u !== ctx.self && ctx.isFriendly(u)).length === 0; },
  paidAdditional: (ctx: Ctx) => !!ctx.data.paidAdditional,
  showedOff: (ctx: Ctx) => !!ctx.data.shownOff,
  playedFromHidden: (ctx: Ctx) => !!ctx.obj(ctx.self)?.playedFromHidden || !!ctx.item?.fromHidden,
  legion: (ctx: Ctx) => ctx.playedThisTurn().some(id => id !== ctx.self),
  level: (n: number) => (ctx: Ctx) => ctx.xp() >= n,
  nearVictory: (within = 3) => (ctx: Ctx) => ctx.g.victoryScore - ctx.points() <= within,
  controls: (f: Filter, n = 1) => (ctx: Ctx) => [...ctx.units(), ...ctx.gear()].filter(id => ctx.ctrl(id) === ctx.controller && f(ctx, id)).length >= n,
  targetIs: (f: Filter, i = 0) => (ctx: Ctx) => { const t = ctx.target(i); return !!t && f(ctx, t); },
  not: (c: (ctx: Ctx) => boolean) => (ctx: Ctx) => !c(ctx),
  and: (...cs: ((ctx: Ctx) => boolean)[]) => (ctx: Ctx) => cs.every(c => c(ctx)),
  or: (...cs: ((ctx: Ctx) => boolean)[]) => (ctx: Ctx) => cs.some(c => c(ctx)),
};

/** Dependent-keyword gates (CR 726) for `requires`. */
export const dep = {
  legion: (): Dependency => ({ kind: 'legion' }),
  level: (n: number): Dependency => ({ kind: 'level', n }),
  empowered: (n?: number): Dependency => ({ kind: 'empowered', n }),
  mighty: (): Dependency => ({ kind: 'mighty' }),
  custom: (test: (ctx: Ctx) => boolean): Dependency => ({ kind: 'custom', test }),
};

// =====================================================================================
// Ability constructors
// =====================================================================================

interface Common { text?: string; requires?: Dependency[]; section?: 'rules' | 'effect'; activeIn?: Ability['activeIn'] }

/** Spell resolution. */
export function spell(effect: Effect, o: Common & { targets?: TargetSpec[]; playIf?: (ctx: Ctx) => boolean } = {}): SpellAbility {
  return { kind: 'spell', effect, ...o };
}
/** Modal spell ("Choose one —"). */
export function spellModes(modes: Mode[], o: Common & { choose?: number; playIf?: (ctx: Ctx) => boolean } = {}): SpellAbility {
  return { kind: 'spell', modes, chooseModes: o.choose ?? 1, text: o.text, requires: o.requires, playIf: o.playIf };
}
export function mode(id: string, label: string, effect: Effect, targets?: TargetSpec[], condition?: (ctx: Ctx) => boolean): Mode {
  return { id, label, effect, targets, condition };
}

export interface TrigOpts extends Common {
  targets?: TargetSpec[];
  /** R-1 bulleted modes (chosen when the trigger goes on the chain) */
  modes?: Mode[];
  chooseModes?: number;
  modesOncePerTurn?: boolean;
  /** "When one or more ...": at most once per batch of simultaneous events */
  oncePerBatch?: boolean;
  /** resolve immediately (no chain), like Add abilities */
  immediate?: boolean;
  optional?: boolean | string;
  cost?: CostSpec;
  /** who makes the leading `optional` choice and pays `cost` on finalize ("they may pay [1] to ..."); default: the controller */
  payer?: (ctx: Ctx) => PlayerId;
  oncePerTurn?: number;
  /**
   * Trigger condition — "When X, if Y, do Z" (CR 383.2.a.1): checked only when the event happens. If false, the ability doesn't
   * trigger at all (nothing goes on the chain). Not re-checked on resolution (Sona example).
   */
  if?: (ctx: Ctx) => boolean;
  /**
   * Effect condition — "When X, do Z if Y" / "... Then if Y, ..." where the card text puts the condition in the effect: the
   * ability always triggers and Y is checked only on resolution (Loose Cannon, CR 383.2.a.1 example).
   */
  ifOnResolve?: (ctx: Ctx) => boolean;
  isAdd?: boolean;
  /** leading "you may" choice as an up-to first group: choosing nothing removes the trigger (default from the text, CR 383.3.a) */
  mayChoose?: boolean;
  /** SF2-1: checked as the item is finalized (before "you may"); false → removed */
  offerIf?: (ctx: Ctx) => boolean;
}

/** Generic triggered ability: when(event(s), match, effect, opts). match(ev, ctx) -> boolean. */
export function when(event: string | string[], match: ((ev: GameEvent, ctx: Ctx) => boolean) | null, effect: Effect, o: TrigOpts = {}): TriggeredAbility {
  const { if: cond, ifOnResolve, ...rest } = o;
  const eff: Effect = ifOnResolve ? (ctx => { if (ifOnResolve(ctx)) effect(ctx); }) : effect;
  return { kind: 'triggered', on: { event, match: match ?? undefined }, effect: eff, condition: cond, ...rest };
}

const isSelf = (ev: GameEvent, ctx: Ctx) => ev.obj === ctx.self;
const mine = (ev: GameEvent, ctx: Ctx) => ev.player === ctx.controller;
const atHere = (ev: GameEvent, ctx: Ctx) => { const h = ctx.here(); return typeof h === 'number' && ev.bf === h; };

/** Event matchers for `when` */
export const on = {
  self: isSelf,
  mine,
  opponents: (ev: GameEvent, ctx: Ctx) => typeof ev.player === 'number' && ctx.isOpponent(ev.player as PlayerId),
  here: atHere,
  /** object of the event is friendly / enemy */
  friendlyObj: (ev: GameEvent, ctx: Ctx) => typeof ev.obj === 'string' && ctx.isFriendly(ev.obj),
  enemyObj: (ev: GameEvent, ctx: Ctx) => typeof ev.obj === 'string' && ctx.isEnemy(ev.obj),
  and: (...ms: ((ev: GameEvent, ctx: Ctx) => boolean)[]) => (ev: GameEvent, ctx: Ctx) => ms.every(m => m(ev, ctx)),
};

/** "When you play me" */
export const onPlay = (effect: Effect, o: TrigOpts = {}) => when('play', isSelf, effect, o);
/** "When you play me" restricted to being played to a battlefield */
export const onPlayToBattlefield = (effect: Effect, o: TrigOpts = {}) => when('play', (ev, ctx) => ev.obj === ctx.self && typeof ev.loc === 'number', effect, o);
/** [Deathknell] — when I die (queued before I leave the board) */
export const deathknell = (effect: Effect, o: TrigOpts = {}) => ({ ...when('die', isSelf, effect, o), deathknell: true } as TriggeredAbility);
export const onAttack = (effect: Effect, o: TrigOpts = {}) => when('attack', isSelf, effect, o);
export const onDefend = (effect: Effect, o: TrigOpts = {}) => when('defend', isSelf, effect, o);
/** "When I attack or defend" */
export const onCombatRole = (effect: Effect, o: TrigOpts = {}) => when(['attack', 'defend'], isSelf, effect, o);
/** "When I conquer" — I was at the battlefield my controller conquered */
export const onConquer = (effect: Effect, o: TrigOpts = {}) => when('conquer', (ev, ctx) => ev.player === ctx.controller && (ev.units as ObjId[] | undefined ?? []).includes(ctx.self), effect, o);
export const onHold = (effect: Effect, o: TrigOpts = {}) => when('hold', (ev, ctx) => ev.player === ctx.controller && (ev.units as ObjId[] | undefined ?? []).includes(ctx.self), effect, o);
/** "When you conquer" (any battlefield) / "When you conquer here" (battlefield scripts: use onConquerHere) */
export const whenYouConquer = (effect: Effect, o: TrigOpts = {}) => when('conquer', mine, effect, o);
export const whenYouHold = (effect: Effect, o: TrigOpts = {}) => when('hold', mine, effect, o);
export const onConquerHere = (effect: Effect, o: TrigOpts = {}) => when('conquer', (ev, ctx) => ev.player === ctx.controller && ev.bf === ctx.bfIndex(), effect, o);
export const onHoldHere = (effect: Effect, o: TrigOpts = {}) => when('hold', (ev, ctx) => ev.player === ctx.controller && ev.bf === ctx.bfIndex(), effect, o);
export const onDefendHere = (effect: Effect, o: TrigOpts = {}) => when('playerDefend', (ev, ctx) => ev.player === ctx.controller && ev.bf === ctx.bfIndex(), effect, o);
export const onAttackHere = (effect: Effect, o: TrigOpts = {}) => when('playerAttack', (ev, ctx) => ev.player === ctx.controller && ev.bf === ctx.bfIndex(), effect, o);
/** "When I move" (optionally: to a battlefield) */
export const onMove = (effect: Effect, o: TrigOpts & { toBattlefield?: boolean } = {}) => when('move', (ev, ctx) => ev.obj === ctx.self && (!o.toBattlefield || typeof ev.to === 'number'), effect, o);
/** "When you play a spell / unit / card matching filter" (not this card) */
/** "When you play a [filter]". The card itself counts unless the text says "another" (R-8): pass { self: true } to include it. */
export const whenYouPlay = (filter: Filter, effect: Effect, o: TrigOpts & { self?: boolean } = {}) => {
  const { self, ...rest } = o;
  return when('play', (ev, ctx) => ev.player === ctx.controller && (self || ev.obj !== ctx.self) && !!ctx.obj(ev.obj as ObjId) && filter(ctx, ev.obj as ObjId), effect, rest);
};
export const whenOpponentPlays = (filter: Filter, effect: Effect, o: TrigOpts = {}) => when('play', (ev, ctx) => typeof ev.player === 'number' && ctx.isOpponent(ev.player as PlayerId) && !!ctx.obj(ev.obj as ObjId) && filter(ctx, ev.obj as ObjId), effect, o);
/** start of your turn phases */
export const atStartOfBeginning = (effect: Effect, o: TrigOpts = {}) => when('beginningPhase', mine, effect, o);
export const atStartOfMain = (effect: Effect, o: TrigOpts = {}) => when('mainStart', mine, effect, o);
export const atEndOfTurn = (effect: Effect, o: TrigOpts = {}) => when('endOfTurn', mine, effect, o);
export const atEndOfEachTurn = (effect: Effect, o: TrigOpts = {}) => when('endOfTurn', null, effect, o);
/** "When a friendly/enemy unit dies" (filter evaluated on the dying object's LKI-time state) */
export const whenUnitDies = (filter: Filter, effect: Effect, o: TrigOpts = {}) => when('die', (ev, ctx) => ev.obj !== ctx.self && !!ctx.obj(ev.obj as ObjId) && ctx.isUnit(ev.obj as ObjId) && filter(ctx, ev.obj as ObjId), effect, o);

export interface ActOpts extends Common {
  timing?: 'normal' | 'action' | 'reaction';
  targets?: TargetSpec[];
  modes?: Mode[];
  modesOncePerTurn?: boolean;
  oncePerTurn?: number;
  /** "Use only if ..." */
  if?: (ctx: Ctx) => boolean;
  label?: string;
  anyPlayer?: boolean;
}
/** Activated ability "COST: EFFECT" */
export function activated(c: CostSpec | string, effect: Effect, o: ActOpts = {}): ActivatedAbility {
  const { if: cond, ...rest } = o;
  return { kind: 'activated', cost: typeof c === 'string' ? cost(c) : c, effect, condition: cond, ...rest };
}
/** Mana ability "COST: [Add] ..." (no chain; usable during payment). */
export function mana(c: CostSpec | string, produces: { energy?: number; power?: PowerSym[]; only?: string }, o: ActOpts = {}): ActivatedAbility {
  const domainsOf = (ctx: Ctx) => ctx.domains(ctx.abilitySource ?? ctx.self).filter(d => d !== 'Colorless') as Domain[];
  const effect: Effect = ctx => {
    const doms = domainsOf(ctx);
    // [C] on a multi-domain source: the domain the auto-payer matched, else the player picks one (CR 135.2.e.6.c)
    const pickC = (): Domain | 'any' => {
      if (!doms.length) return 'any';
      if (doms.length === 1) return doms[0];
      const d = ctx.data.__domain as Domain | undefined;
      if (d && doms.includes(d)) return d;
      return ctx.chooseMode(doms.map(x => ({ id: x, label: x })), 'Add power of which domain?') as Domain;
    };
    const power = (produces.power ?? []).map(p => (p === 'A' ? 'any' : p === 'C' ? pickC() : p)) as (Domain | 'any')[];
    ctx.add(produces.energy ?? 0, power, produces.only);
  };
  const { if: cond, ...rest } = o;
  return { kind: 'activated', cost: typeof c === 'string' ? cost(c) : c, effect, isAdd: true, produces, timing: 'reaction', condition: cond, ...rest };
}

/** Static/continuous ability (layers). affects: 'self' or a filter over board objects. */
export function statik(affects: 'self' | Filter, mods: StaticMods | ((ctx: Ctx, id: ObjId) => StaticMods), o: Common & { if?: (ctx: Ctx) => boolean } = {}): StaticAbility {
  const { if: cond, ...rest } = o;
  return { kind: 'static', affects: affects === 'self' ? 'self' : (ctx, id) => affects(ctx, id), mods, condition: cond, ...rest };
}
/** "I have +N Might" (N may be a function) */
export const selfMight = (n: Num, o: Common & { if?: (ctx: Ctx) => boolean } = {}) => statik('self', ctx => ({ might: num(ctx, n) }), o);
/** "I have [Keyword]" (conditional) */
export const selfKeyword = (kw: string | string[], o: Common & { if?: (ctx: Ctx) => boolean } = {}) => statik('self', { keywords: Array.isArray(kw) ? kw : [kw] }, o);
/** "Other friendly units have +N Might / keyword" */
export const anthem = (filter: Filter, mods: StaticMods | ((ctx: Ctx, id: ObjId) => StaticMods), o: Common & { if?: (ctx: Ctx) => boolean } = {}) => statik(filter, mods, o);

export function replacement(event: string | string[], match: (ev: GameEvent, ctx: Ctx) => boolean, apply: (ev: GameEvent, ctx: Ctx) => GameEvent | null, o: Common & { optional?: boolean | string; oncePerTurn?: number; bonus?: (ev: GameEvent, ctx: Ctx) => number; noDamage?: boolean } = {}): ReplacementAbility {
  return { kind: 'replacement', event, match, apply, ...o };
}
/** "If this/[filter] would die, instead ..." helper. `instead` runs the replacement actions; return value: replace with nothing. */
export function wouldDie(filter: Filter, instead: (ctx: Ctx, id: ObjId) => void, o: Common & { optional?: boolean | string; oncePerTurn?: number } = {}): ReplacementAbility {
  return replacement('die', (ev, ctx) => !!ctx.obj(ev.obj as ObjId) && filter(ctx, ev.obj as ObjId), (ev, ctx) => { instead(ctx, ev.obj as ObjId); return null; }, o);
}

export function costMod(applies: (ctx: Ctx, playedId: ObjId) => boolean, delta: { energy?: number; power?: number; minEnergy?: number }, o: Common & { selfOnly?: boolean; scope?: CostModAbility['scope'] } = {}): CostModAbility {
  return { kind: 'costMod', applies, energy: delta.energy, power: delta.power, minEnergy: delta.minEnergy, ...o };
}
/** "I cost [N] less if/for each ..." */
export const selfCost = (delta: (ctx: Ctx) => { energy?: number; power?: number }, o: Common = {}): CostModAbility =>
  ({ kind: 'costMod', selfOnly: true, applies: () => true, get energy() { return 0; }, ...o, ...dynamicDelta(delta) } as unknown as CostModAbility);

function dynamicDelta(delta: (ctx: Ctx) => { energy?: number; power?: number }) {
  // costMod values are static numbers; for dynamic discounts use selfCostDyn below
  void delta; return {};
}

/** Dynamic self cost change: evaluated each time the cost is computed. */
export function selfCostDyn(delta: (ctx: Ctx) => { energy?: number; power?: number }, o: Common = {}): CostModAbility {
  const ab: CostModAbility = { kind: 'costMod', selfOnly: true, applies: (ctx) => { const d = delta(ctx); ab.energy = d.energy ?? 0; ab.power = d.power ?? 0; return (d.energy ?? 0) !== 0 || (d.power ?? 0) !== 0; }, ...o };
  return ab;
}
/** Dynamic cost change for other cards: delta(ctx, playedId). */
export function costModDyn(delta: (ctx: Ctx, playedId: ObjId) => { energy?: number; power?: number; minEnergy?: number } | null, o: Common & { scope?: CostModAbility['scope'] } = {}): CostModAbility {
  const ab: CostModAbility = { kind: 'costMod', applies: (ctx, id) => { const d = delta(ctx, id); if (!d) return false; ab.energy = d.energy ?? 0; ab.power = d.power ?? 0; ab.minEnergy = d.minEnergy; return true; }, ...o };
  return ab;
}

export function playFrom(zone: PlayPermissionAbility['zone'], o: Common & { cost?: CostSpec; if?: (ctx: Ctx) => boolean } = {}): PlayPermissionAbility {
  const { if: cond, ...rest } = o;
  return { kind: 'playFrom', zone, condition: cond, ...rest };
}
export function movePermission(allows: MovePermissionAbility['allows'], o: Common = {}): MovePermissionAbility {
  return { kind: 'movePermission', allows, ...o };
}
export function playRule(applies: (ctx: Ctx, playedId: ObjId) => boolean, o: Common & Omit<PlayRuleAbility, 'kind' | 'applies'> = {}): PlayRuleAbility {
  return { kind: 'playRule', applies, ...o };
}
/** Engine rule hook (see RuleName in engine/abilities.ts) */
export function rule(name: RuleName, applies?: (ctx: Ctx, ...args: any[]) => boolean, value?: RuleAbility['value'], o: Common = {}): RuleAbility {
  return { kind: 'rule', rule: name, applies, value, ...o };
}
/** "As you play this" choices (Show Off, name a tag, X costs). Data stored in ctx.data is kept. */
export function asPlay(effect: Effect, o: Common = {}): AsPlayAbility {
  return { kind: 'asPlay', effect, ...o };
}
/** [Show Off] a <filter>: as you play, may reveal/pick a matching card; sets ctx.data.shownOff */
export function showOff(filter: Filter, prompt = 'Show off?'): AsPlayAbility {
  return asPlay(ctx => { ctx.showOff(id => filter(ctx, id), prompt); }, { text: 'Show Off' });
}

// =====================================================================================
// Grants and delayed abilities
// =====================================================================================

/**
 * Reflexive item (CR 387): "Do this: ...". Register at module level; inside an effect call ctx.reflexive(key, data) —
 * a new item goes on the chain after the current resolution (its targets/modes chosen then, CR 388).
 */
export function reflexiveAbility(key: string, ab: TriggeredAbility | (Omit<TriggeredAbility, 'kind' | 'on'> & { kind?: 'triggered' })): string {
  return registerDelayed(key, { on: { event: '__reflexive' }, ...ab, kind: 'triggered' } as TriggeredAbility);
}

/** Bonus Damage (CR 712): each instance of damage that matches deals N more. */
export function bonusDamage(applies: (ctx: Ctx, ev: GameEvent) => boolean, n: Num = 1, text = 'Bonus Damage'): ReplacementAbility {
  return { ...replacement('damage', (ev, ctx) => applies(ctx, ev), (ev, ctx) => ({ ...ev, amount: Number(ev.amount) + num(ctx, n) }), { text }), bonus: (_ev, ctx) => num(ctx, n) };
}

/** Register an ability that effects can give to objects: ctx.grant(id, key, duration). */
export function grantable(key: string, ab: Ability): string { return registerGrant(key, ab); }

/** Register a delayed ability (CR 389) created with ctx.delay(key, data, expires, uses). ctx.data = data. */
export function delayedAbility(key: string, ab: Ability): string { return registerDelayed(key, ab); }

// Common delayed abilities
/** "Kill it at end of turn": ctx.delay(D.killAtEnd, { obj }) */
export const D = {
  killAtEnd: delayedAbility('core:killAtEnd', when('endOfTurn', null, ctx => { const id = ctx.data.obj as ObjId; if (ctx.exists(id) && (ctx.obj(id).epoch ?? 0) === ctx.data.epoch) ctx.kill(id); })),
  /** "Units you play this turn enter ready": ctx.delay(D.unitsEnterReady, {}, 'endOfTurn') */
  unitsEnterReady: delayedAbility('core:unitsEnterReady', playRule((ctx, id) => ctx.isUnit(id), { entersReady: true })),
  /** "The next unit you play this turn enters ready": ctx.delay(D.nextUnitReady, {}, 'endOfTurn', 1) */
  nextUnitReady: delayedAbility('core:nextUnitReady', playRule((ctx, id) => ctx.isUnit(id), { entersReady: true })),
  /** "The next spell/unit you play this turn costs [N] less": ctx.delay(D.nextCostsLess, { energy: -N, power: 0, type: 'Spell' }, 'endOfTurn', 1) */
  nextCostsLess: delayedAbility('core:nextCostsLess', costModDyn((ctx, id) => (ctx.data.type && ctx.type(id) !== ctx.data.type) ? null : { energy: Number(ctx.data.energy ?? 0), power: Number(ctx.data.power ?? 0) })),
  /** "Return control at end of turn": ctx.delay(D.returnControlAtEnd, { obj, to }) */
  returnControlAtEnd: delayedAbility('core:returnControlAtEnd', when('endOfTurn', null, ctx => { const id = ctx.data.obj as ObjId; if (ctx.exists(id)) { ctx.takeControl(id, ctx.data.to as PlayerId); if (ctx.data.recall) ctx.recall(id); } })),
};

/** Helper to make ctx.delay(...) of D.killAtEnd with epoch tracking */
export function killAtEndOfTurn(ctx: Ctx, id: ObjId): void { ctx.delay(D.killAtEnd, { obj: id, epoch: ctx.obj(id)?.epoch ?? 0 }, 'endOfTurn'); }

export type { Destination };

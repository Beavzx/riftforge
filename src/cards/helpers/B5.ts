// Helpers for batch B5 (removal / interaction). Owned by scripting agent B5.
// Only public DSL / ctx APIs are used. Anything that would be better done by the engine is listed in
// docs/dsl-requests.md (B5 section).
import type { Ctx, ObjId, PlayerId, TargetSpec, CostSpec, GameEvent } from '../dsl.ts';
import { T, type Filter } from '../dsl.ts';
import type { ChainItem } from '../../engine/types.ts';
import { makeCtx } from '../../engine/context.ts';

type Loc = 'base' | number;

// ---------------------------------------------------------------------------------------------
// Cross-group target constraints ("another unit", "an enemy unit there", "total Might 4 or less")
// ---------------------------------------------------------------------------------------------

/**
 * Objects already chosen as targets earlier in the CURRENT play of this card (DSL request B5-1).
 * The engine emits a `targeted` event after each target group while a card is being played
 * (the chain item is still pending), so a later group's filter can see the earlier picks.
 * Returns [] outside that window (canPlay checks, trigger finalisation, Repeat re-choices,
 * "make new choices"): callers fall back to a looser filter and re-check on resolution.
 */
export function priorPicks(ctx: Ctx): ObjId[] {
  // the engine exposes the earlier groups in ctx.targets while choosing, re-validating and remaking choices (R-14, F-3a)
  return ctx.targets.flat();
}

/** true while a card's targets are being chosen during its play (priorPicks is meaningful) */
export function choosingOnPlay(ctx: Ctx): boolean { return !!ctx.item?.pending; }

/** filter: not one of the objects chosen earlier for this card */
export const notPrior: Filter = (ctx, id) => !priorPicks(ctx).includes(id);

/**
 * "Any number of units with total Might N or less" as a series of single-pick groups.
 * Group k may only pick if groups 0..k-1 each picked one (so declining ends the selection).
 * `sameLocation`: all picks share the first pick's location.
 */
export function totalMightGroups(groups: number, maxTotal: number, filters: Filter[], o: { sameLocation?: boolean; prompt?: string; hint?: 'harm' | 'help' } = {}): TargetSpec[] {
  const specs: TargetSpec[] = [];
  for (let k = 0; k < groups; k++) {
    const f: Filter = (ctx, id) => {
      if (!filters.every(x => x(ctx, id))) return false;
      if (ctx.might(id) > maxTotal) return false;
      if (!choosingOnPlay(ctx)) return true;
      const prior = priorPicks(ctx);
      if (prior.length < k || prior.includes(id)) return false;
      const sum = prior.reduce((s, p) => s + (ctx.exists(p) ? ctx.might(p) : 0), 0);
      if (sum + ctx.might(id) > maxTotal) return false;
      if (o.sameLocation && prior.length && !ctx.sameLocation(prior[0], id)) return false;
      return true;
    };
    specs.push(T.upTo(1, T.unit(f, { prompt: `${o.prompt ?? 'Choose a unit'} (${k + 1}${k === 0 ? '' : ', or none to stop'})`, hint: o.hint ?? 'harm' })));
  }
  return specs;
}

/** All still-legal targets of the given groups, without duplicates (in choice order). */
export function allTargets(ctx: Ctx, groups: number[]): ObjId[] {
  const out: ObjId[] = [];
  for (const i of groups) for (const id of ctx.targetsOf(i)) if (!out.includes(id) && ctx.exists(id)) out.push(id);
  return out;
}

/** Resolution-time guard for total-Might choices that were not validated (Repeat / new choices). */
export function capTotalMight(ctx: Ctx, ids: ObjId[], maxTotal: number, sameLocation = false): ObjId[] {
  const out: ObjId[] = [];
  let sum = 0;
  for (const id of ids) {
    if (sameLocation && out.length && !ctx.sameLocation(out[0], id)) continue;
    const m = ctx.might(id);
    if (sum + m > maxTotal) continue;
    sum += m; out.push(id);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Chain items (counterspells, spell control)
// ---------------------------------------------------------------------------------------------

export function itemOf(ctx: Ctx, id: string): ChainItem | undefined { return ctx.g.chain.find(c => c.id === id); }

/** chain-item filter: a spell (not an ability) */
export const isSpellItem: Filter = (ctx, id) => itemOf(ctx, id)?.kind === 'spell';

/** chain-item filter: controlled by an opponent */
export const enemyItem: Filter = (ctx, id) => { const it = itemOf(ctx, id); return !!it && ctx.isOpponent(it.controller); };

/** printed (current) Energy / Power cost of a spell item's card */
export function itemEnergy(ctx: Ctx, id: string): number { const it = itemOf(ctx, id); return it && ctx.exists(it.source) ? ctx.energyCost(it.source) : 0; }
export function itemPower(ctx: Ctx, id: string): number { const it = itemOf(ctx, id); return it && ctx.exists(it.source) ? ctx.powerCost(it.source) : 0; }

/**
 * Objects an item "chooses" (its targets) that still count as chosen: objects that left the board
 * (became new objects) don't count (UNL-FAQ #11, rules-tests T192).
 */
export function chosenBy(ctx: Ctx, id: string): ObjId[] {
  const it = itemOf(ctx, id);
  if (!it) return [];
  const out: ObjId[] = [];
  it.targets.forEach((grp, i) => grp.forEach((t, k) => {
    const o = ctx.obj(t);
    if (!o) return;
    if ((it.targetEpochs?.[i]?.[k] ?? o.epoch ?? 0) !== (o.epoch ?? 0)) return;
    out.push(t);
  }));
  // Repeat executions' choices are made when the spell is played (CR 820.2; principle 4): the spell chooses them too (RJ#9655)
  for (const key of Object.keys(it.choices).filter(x => x.startsWith('repeatTargets:'))) {
    const rt = it.choices[key] as { targets?: ObjId[][]; epochs?: number[][] } | undefined;
    (rt?.targets ?? []).forEach((grp, i) => grp.forEach((t, k) => {
      const o = ctx.obj(t);
      if (!o || (rt?.epochs?.[i]?.[k] ?? o.epoch ?? 0) !== (o.epoch ?? 0) || out.includes(t)) return;
      out.push(t);
    }));
  }
  return out;
}

/** friendly (to ctx.controller) units/gear on the board among ids */
export function friendlyPermanents(ctx: Ctx, ids: ObjId[]): ObjId[] {
  return ids.filter(t => ctx.onBoard(t) && (ctx.isUnit(t) || ctx.isGear(t)) && ctx.isFriendly(t));
}

/** "You may make new choices for it": only asked when the item has choices to remake. */
export function gainControlOfSpell(ctx: Ctx, id: string): boolean {
  const it = itemOf(ctx, id);
  if (!it) return false;
  const hasChoices = it.targets.some(g => g.length > 0);
  const remake = hasChoices && ctx.may(`Make new choices for ${it.label ?? 'the spell'}?`);
  return ctx.takeControlOfItem(id, remake);
}

// ---------------------------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------------------------

export function bfIndexOf(ctx: Ctx, bfObj: ObjId | undefined): number | undefined {
  if (!bfObj) return undefined;
  const i = ctx.g.battlefields.findIndex(b => b.objId === bfObj);
  return i >= 0 ? i : undefined;
}


// ---------------------------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------------------------

export function unitsControlledBy(ctx: Ctx, p: PlayerId, f?: (id: ObjId) => boolean): ObjId[] {
  return ctx.units(u => ctx.ctrl(u) === p && (!f || f(u)));
}
export function gearControlledBy(ctx: Ctx, p: PlayerId): ObjId[] {
  return ctx.gear(x => ctx.ctrl(x) === p);
}

/** "Each player kills one of their X": every player picks one in turn order, then all die together. */
export function eachPlayerKillsOne(ctx: Ctx, of: (p: PlayerId) => ObjId[], what: string, players?: PlayerId[]): ObjId[] {
  const chosen: ObjId[] = [];
  const performers: Record<ObjId, PlayerId> = {};
  ctx.eachPlayer(p => {
    if (players && !players.includes(p)) return;
    const c = ctx.chooseCards(of(p), 1, 1, `Kill one of your ${what}`, p);
    chosen.push(...c);
    for (const id of c) performers[id] = p;
  });
  // each player performs their own kill (simultaneously): "you kill" sees that player (CR 429.5, OGN-FAQ; DECISIONS #3618 B)
  return ctx.kill(chosen, performers);
}

// ---------------------------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------------------------

/** "you control a facedown card" */
export function controlsFacedown(ctx: Ctx, p: PlayerId = ctx.controller): boolean {
  for (const id in ctx.g.objects) { const o = ctx.g.objects[id]; if (o.zone === 'facedown' && o.controller === p) return true; }
  return false;
}

/** play-data of the event that put a "when you play me" trigger on the chain (additional costs paid etc.) */
export function playData(ctx: Ctx): Record<string, unknown> {
  return ((ctx.event as GameEvent | undefined)?.playData as Record<string, unknown> | undefined) ?? {};
}

/** largest k (<= cap) such that `base` + k extra power symbols `sym` is payable now */
export function maxExtraPower(ctx: Ctx, base: CostSpec, sym: 'C' | 'A', cap = 12): number {
  for (let k = cap; k > 0; k--) if (ctx.canPay({ energy: base.energy ?? 0, power: [...(base.power ?? []), ...new Array(k).fill(sym)] })) return k;
  return 0;
}

/** fight: both must still be on the board (CR 359.3.e: an instruction about two objects needs both) */
export function fightIfBoth(ctx: Ctx, a: ObjId | undefined, b: ObjId | undefined): void {
  if (!(a && b && a !== b && ctx.onBoard(a) && ctx.onBoard(b))) return;
  // CR 418.6.b.3: when a spell/ability names units as the damage source ("we deal damage equal to our Mights"), the units are the
  // source, not the spell or ability (RJ#2602). Marked for the duration so "spell and ability damage" effects can tell.
  ctx.g.ex.turnFacts[UNIT_SOURCED] = 1;
  try { ctx.fight(a, b); } finally { delete ctx.g.ex.turnFacts[UNIT_SOURCED]; }
}
/** Set while damage named as dealt by units (fights) is being dealt. */
export const UNIT_SOURCED = 'B5:unitSourcedDamage';
export function unitSourcedDamage(ctx: Ctx): boolean { return !!ctx.g.ex.turnFacts[UNIT_SOURCED] || !!ctx.event?.unitDealt;
}

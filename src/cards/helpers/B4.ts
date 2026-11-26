// Helpers for batch B4 (combat / board / movement). Owned by scripting agent B4.
// Everything here is built on public DSL / ctx APIs. Where the engine lacks a primitive, the local
// workaround is described next to it and an entry is filed in docs/dsl-requests.md.
import { type Ctx } from '../../engine/context.ts';
import type { GameEvent, ObjId, PlayerId } from '../../engine/types.ts';
import type { CostSpec, Dependency } from '../../engine/abilities.ts';
import { ruleApplies } from '../../engine/rules.ts';
import { dep, type Filter } from '../dsl.ts';

export type Loc = 'base' | number;

// ------------------------------------------------------------------------------------------------
// Locations
// ------------------------------------------------------------------------------------------------

/** All locations a unit could be sent to: its controller's base and every battlefield. */
export function allLocs(ctx: Ctx): Loc[] { return ['base', ...ctx.battlefields()]; }

/** "Open" battlefield: unoccupied and uncontrolled (CR 170.11). */
export function isOpen(ctx: Ctx, bf: number): boolean {
  return ctx.bfController(bf) === null && ctx.unitsAt(bf).length === 0;
}
export function openBattlefields(ctx: Ctx): number[] { return ctx.battlefields().filter(b => isOpen(ctx, b)); }

/** "Occupied enemy battlefield": controlled by an opponent of ctx.controller, with a unit there. */
export function isOccupiedEnemy(ctx: Ctx, bf: number): boolean {
  const c = ctx.bfController(bf);
  return c !== null && ctx.isOpponent(c) && ctx.unitsAt(bf).length > 0;
}

/** Location of a unit as a comparable key ('base' is per controller). */
export function locKey(ctx: Ctx, id: ObjId): string | null {
  const l = ctx.loc(id);
  if (l === null) return null;
  return l === 'base' ? `b${ctx.ctrl(id)}` : String(l);
}
export function sameLoc(ctx: Ctx, a: ObjId, b: ObjId): boolean {
  const x = locKey(ctx, a), y = locKey(ctx, b);
  return x !== null && x === y;
}
/** Filter: not at the same location as this ability's source. */
export const notHere: Filter = (c, id) => !c.isHere(id);

/** Can ctx's controller move this unit from where it is to `to` (move prohibitions only; effect moves ignore Ganking). */
export function canMoveTo(ctx: Ctx, unit: ObjId, to: Loc): boolean {
  const from = ctx.loc(unit);
  if (from === null || from === to) return false;
  return !ruleApplies(ctx.g, 'cantMove', unit, from, to, ctx.controller);   // the mover is ctx's controller
}

// ------------------------------------------------------------------------------------------------
// Battlefield abilities: CR 190.6 says they are controlled by the battlefield's controller (or the
// turn player if uncontrolled). The engine currently uses the battlefield card's owner as the
// controller of its triggers (requested in docs/dsl-requests.md), so B4 battlefield scripts match
// on the real controller and make their choices on resolution through asPlayer().
// ------------------------------------------------------------------------------------------------

export function bfAbilityController(ctx: Ctx): PlayerId {
  const i = ctx.bfIndex();
  return ctx.g.battlefields[i]?.controller ?? ctx.g.activePlayer;
}

// ------------------------------------------------------------------------------------------------
// Combat
// ------------------------------------------------------------------------------------------------

/** "Alone": no other friendly unit at its location (CR 740 / rules-spec §17). */
export function aloneAt(ctx: Ctx, id: ObjId): boolean {
  const l = ctx.loc(id);
  if (l === null) return false;
  const me = ctx.ctrl(id);
  return ctx.unitsAt(l, u => u !== id && ctx.ctrl(u) === me, me).length === 0;
}

/** "One on one": it is alone and there is exactly one enemy unit at its location, which is also alone. */
export function oneOnOne(ctx: Ctx, id: ObjId): boolean {
  const l = ctx.loc(id);
  if (typeof l !== 'number' || !aloneAt(ctx, id)) return false;
  const me = ctx.ctrl(id);
  const enemies = ctx.unitsAt(l, u => ctx.g.objects[u].controller !== me);
  return enemies.length === 1 && aloneAt(ctx, enemies[0]);
}

/** Was this unit part of the current combat (designated attacker or defender at some point)? */
export function wasInCombat(ctx: Ctx, id: ObjId): boolean {
  const c = ctx.g.ex.combat;
  return !!c && (c.attackers.includes(id) || c.defenders.includes(id));
}

/**
 * "When I win a combat": combatResult names my controller as winner and I'm still at that battlefield
 * (units inherit their controller's result; Nidalee: "I win if I remain after combat").
 */
export function iWonCombat(ev: GameEvent, ctx: Ctx): boolean {
  return ev.type === 'combatResult' && ev.winner === ctx.controller && typeof ev.bf === 'number'
    && ctx.loc(ctx.self) === ev.bf && wasInCombat(ctx, ctx.self);
}


// ------------------------------------------------------------------------------------------------
// Per-turn counters (g.ex.counts is cleared at the start of every turn)
// ------------------------------------------------------------------------------------------------

/**
 * Count moves of a unit this turn. Called from a trigger's match (once per move event of that unit), so
 * the count is part of the deterministic game state. `tag` separates counters of different abilities.
 */
export function bumpMoves(ctx: Ctx, tag: string, id: ObjId): number {
  return ctx.bump(`B4:mv:${tag}:${id}#${ctx.obj(id)?.epoch ?? 0}`);
}

/**
 * Is this move event the first of its batch (several units moved by one move/effect are emitted
 * back to back with the same destination, mover and kind)? Used for "when an opponent moves to ...".
 */
export function firstOfMoveBatch(ctx: Ctx, ev: GameEvent): boolean {
  const evs = ctx.g.ex.lastEvents;
  const i = evs.indexOf(ev);
  if (i <= 0) return true;
  const prev = evs[i - 1];
  return !(prev.type === 'move' && prev.to === ev.to && prev.player === ev.player && prev.how === ev.how);
}

/** Power spent this turn by a player, any payment (Sivir; engine counter `powerSpent:<p>`, dsl-requests B4 #5). */
export function powerSpentThisTurn(ctx: Ctx, p: PlayerId = ctx.controller): number {
  return ctx.count(`powerSpent:${p}`);
}
/** Most Energy paid to play one spell this turn (Prepared Neophyte; engine counter `maxSpellEnergy:<p>`). */
export function maxEnergySpentOnSpell(ctx: Ctx, p: PlayerId = ctx.controller): number {
  return ctx.count(`maxSpellEnergy:${p}`);
}

// ------------------------------------------------------------------------------------------------
// Optional costs on triggers
// ------------------------------------------------------------------------------------------------

/**
 * Event matcher wrapper for optional-cost triggers ("you may pay X to ..."): the trigger isn't offered
 * when X can't be paid when the event happens (checked in the match, i.e. once per event).
 */
export function ifCanPay(c: CostSpec, m: (ev: GameEvent, ctx: Ctx) => boolean) {
  return (ev: GameEvent, ctx: Ctx) => m(ev, ctx) && ctx.canPay(c);
}
void dep; export type { Dependency };

// ------------------------------------------------------------------------------------------------
// Tags among your units (Ivern / Daisy!)
// ------------------------------------------------------------------------------------------------

export const IVERN_TAGS = ['Bird', 'Cat', 'Dog', 'Poro'] as const;
export function tagsAmongYourUnits(ctx: Ctx): string[] {
  const units = ctx.units(u => ctx.ctrl(u) === ctx.controller);
  return IVERN_TAGS.filter(t => units.some(u => ctx.hasTag(u, t)));
}

/** Players' points can be scored by an effect ("you score 1 point"). */
export function score(ctx: Ctx, p: PlayerId = ctx.controller, n = 1): void { ctx.scorePoint(p, n); }

// ------------------------------------------------------------------------------------------------
// "While I'm [Mighty], I have ..." (Fiora, Victorious)
// ------------------------------------------------------------------------------------------------

/**
 * Is `id` Mighty, evaluated from inside one of its own static abilities ("While I'm [Mighty], I have ...")?
 * B4-8: while a static ability is evaluated, nested characteristic queries skip only that static, so ctx.might() already includes
 * every other static (anthems, War Camp) but not the keywords this static grants. CR 478.4 (Fiora, Victorious example; RJ#39, #128,
 * DECISIONS principle 8): the unit's own conditional Shield never keeps it Mighty — at 4 Might she has no keywords.
 */
export function mightyFromOwnStatic(ctx: Ctx, id: ObjId = ctx.self): boolean {
  return (ctx.might(id) ?? 0) >= 5;
}

/**
 * Choose on resolution without the Hidden "here" restriction (CR 811.1.d) — for play effects whose own text
 * explicitly reaches another location (Evelynn, Entrancing; Tideturner). Card text beats the general rule.
 */
export function chooseIgnoringHidden(ctx: Ctx, spec: import('../../engine/abilities.ts').TargetSpec): ObjId[] {
  if (ctx.data.hiddenHere !== undefined) delete ctx.data.hiddenHere;
  if (ctx.data.hiddenSrc !== undefined) { delete ctx.data.hiddenSrc; delete ctx.data.hiddenAt; delete ctx.data.hiddenSrcEpoch; }
  return ctx.choose(spec);
}

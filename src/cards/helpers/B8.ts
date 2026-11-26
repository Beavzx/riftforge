// Helpers for batch B8 (legends / battlefields / rules). Owned by scripting agent B8.
//
// Local implementations of things the DSL doesn't offer yet (see docs/dsl-requests.md, entries "B8-*").
// They only use public ctx APIs plus a few read-mostly engine helpers; each one notes what it stands in for.
import { Ctx } from '../../engine/context.ts';
import { when, type Filter, type TrigOpts } from '../dsl.ts';
import type { Effect, CostModAbility } from '../../engine/abilities.ts';
import type { GameEvent, ObjId, PlayerId } from '../../engine/types.ts';
import { allAbilities, dependenciesMet, attachedTo } from '../../engine/chars.ts';
import { abilityKey, abilityFromKey, type QueuedTrigger } from '../../engine/events.ts';
import { moveToZone } from '../../engine/state.ts';
import { victoryScore } from '../../engine/rules.ts';
import { keywordConquerTriggers } from '../../engine/builtin.ts';

// ---------------------------------------------------------------------------------------------
// Acting as another player
// ---------------------------------------------------------------------------------------------

/** The player of the triggering event (conquer / hold / score / play / playerDefend ...). */
export const evPlayer = (ctx: Ctx): PlayerId => ctx.event!.player as PlayerId;

/** Controller of this battlefield (null = uncontrolled). Only for battlefield scripts. */
export const bfCtl = (ctx: Ctx): PlayerId | null => ctx.bfController(ctx.bfIndex());

/** Player's own turn number (1 = their first turn). Counts the current turn if it is theirs. */
export function turnNumberOf(ctx: Ctx, p: PlayerId): number {
  return ctx.g.players[p].turnsTaken + (ctx.g.activePlayer === p ? 1 : 0);
}

export const victory = (ctx: Ctx): number => victoryScore(ctx.g);

// ---------------------------------------------------------------------------------------------
// Battlefield triggers that work for whichever player conquers / holds / defends here
// ---------------------------------------------------------------------------------------------

type BfEff = (ctx: Ctx) => void;

function hereTrigger(type: string, effect: BfEff, extra?: (ev: GameEvent, ctx: Ctx) => boolean, o: TrigOpts = {}) {
  // CR 190.6 / 190.6.d: "you" on a battlefield is its controller — "when you attack/defend here" needs a controller (RJ#7862)
  const ctlOnly = type === 'playerDefend' || type === 'playerAttack';
  return when(type, (ev, ctx) => ev.bf === ctx.bfIndex() && typeof ev.player === 'number' && (!ctlOnly || ctx.g.battlefields[ev.bf as number]?.controller === ev.player) && (!extra || extra(ev, ctx.as(ev.player as PlayerId))),
    ctx => effect(ctx.as(evPlayer(ctx))), o);
}
/** "When you conquer here" — "you" is the conquering player. */
export const conquerHere = (effect: BfEff, extra?: (ev: GameEvent, ctx: Ctx) => boolean, o: TrigOpts = {}) => hereTrigger('conquer', effect, extra, o);
/** "When you hold here" — "you" is the holding player. */
export const holdHere = (effect: BfEff, extra?: (ev: GameEvent, ctx: Ctx) => boolean, o: TrigOpts = {}) => hereTrigger('hold', effect, extra, o);
/** "When you defend here" — "you" is the defending player, who must be this battlefield's controller: on an uncontrolled
 *  battlefield "you" refers to no one (CR 190.6, 190.6.d; RJ#7862 surprise defence). */
export const defendHere = (effect: BfEff, extra?: (ev: GameEvent, ctx: Ctx) => boolean, o: TrigOpts = {}) =>
  hereTrigger('playerDefend', effect, (ev, ctx) => ctx.bfController(ctx.bfIndex()) === ev.player && (!extra || extra(ev, ctx)), o);
/** "When you score here". */
export const scoreHere = (effect: BfEff, extra?: (ev: GameEvent, ctx: Ctx) => boolean, o: TrigOpts = {}) => hereTrigger('score', effect, extra, o);

// ---------------------------------------------------------------------------------------------
// Per-turn memory
// ---------------------------------------------------------------------------------------------

/** Per-turn flag for this object (and an extra key, e.g. a player). Cleared at the start of each turn. */
export function usedThisTurn(ctx: Ctx, key: string, obj: ObjId = ctx.self): boolean {
  return !!ctx.g.ex.usage[`B8:${obj}#${ctx.obj(obj)?.epoch ?? 0}:${key}`];
}
export function markThisTurn(ctx: Ctx, key: string, obj: ObjId = ctx.self): void {
  ctx.g.ex.usage[`B8:${obj}#${ctx.obj(obj)?.epoch ?? 0}:${key}`] = 1;
}
/** True the first time it is called this turn for (obj, key); marks it. */
export function firstThisTurn(ctx: Ctx, key: string, obj: ObjId = ctx.self): boolean {
  if (usedThisTurn(ctx, key, obj)) return false;
  markThisTurn(ctx, key, obj);
  return true;
}
/** Per-turn numeric facts (g.ex.turnFacts is cleared each turn). */
export function fact(ctx: Ctx, key: string): number { return Number(ctx.g.ex.turnFacts[`B8:${key}`] ?? 0); }
export function setFact(ctx: Ctx, key: string, v: number): void { ctx.g.ex.turnFacts[`B8:${key}`] = v; }

/**
 * A triggered ability used only as an event listener: `fn` runs (deterministically) when the event is
 * emitted and nothing goes on the chain. Used to keep bookkeeping the engine doesn't track yet.
 */
export function listen(events: string | string[], fn: (ev: GameEvent, ctx: Ctx) => void, o: { text?: string } = {}) {
  return when(events, (ev, ctx) => { fn(ev, ctx); return false; }, () => {}, { text: o.text ?? '(bookkeeping)' });
}

// ---------------------------------------------------------------------------------------------
// Cost helpers
// ---------------------------------------------------------------------------------------------

/** "reduced by [n], to a minimum of [1]": the energy discount actually applicable to a card. */
export function discountMin1(ctx: Ctx, id: ObjId, n: number): number {
  const e = ctx.energyCost(id);
  return Math.max(0, Math.min(n, e - 1));
}

/**
 * "[1] or [A] less": the engine has no either/or discount (B8-6), so take [1] off the Energy when there is
 * Energy to reduce, otherwise one Power.
 */
export function oneOrA(energy: number): { energy?: number; power?: number } {
  return energy > 0 ? { energy: -1 } : { power: -1 };
}
/**
 * "[1] or [A] less" as an either-discount (DECISIONS #13375, RJ#13375/#13317): the payer chooses which component is reduced
 * (engine play.ts `either` / `modVariants`). `energyOf` returns null when it doesn't apply; with no Energy to reduce it is [A] less.
 * Supported scopes: 'play', 'additional', 'repeat'.
 */
export function costModOneOrA(energyOf: (ctx: Ctx, playedId: ObjId) => number | null, o: { scope?: CostModAbility['scope']; text?: string } = {}): CostModAbility {
  const ab: CostModAbility = { kind: 'costMod', applies: (ctx, id) => {
    const e = energyOf(ctx, id);
    if (e === null) return false;
    if (e > 0) { ab.energy = -1; ab.power = 0; ab.either = [{ energy: -1 }, { power: -1 }]; } else { ab.energy = 0; ab.power = -1; ab.either = undefined; }
    return true;
  }, ...o };
  return ab;
}

/** Targets chosen so far by the chain item being paid for (cost modifiers see them on the second pass). */
export function itemTargets(ctx: Ctx): ObjId[] {
  const it = ctx.item;
  if (!it) return [];
  // RJ#5435: the Repeat executions' choices (made when played, CR 820.2) are choices of the same spell
  const rep = Object.keys(it.choices).filter(k => k.startsWith('repeatTargets:')).flatMap(k => ((it.choices[k] as { targets?: ObjId[][] }).targets ?? []).flat());
  return [...it.targets.flat(), ...rep].filter(id => !!ctx.obj(id));
}

/** The player paying a cost inside a costMod (set by the engine). */
export const payer = (ctx: Ctx): PlayerId => ctx.data.payer as PlayerId;

// ---------------------------------------------------------------------------------------------
// Zone helpers (B8-3: no ctx API to move a card to the trash / champion zone / legend zone)
// ---------------------------------------------------------------------------------------------

export function putInTrash(ctx: Ctx, id: ObjId): void { if (ctx.obj(id)) moveToZone(ctx.g, id, 'trash'); }
export function putInChampionZone(ctx: Ctx, id: ObjId): void { if (ctx.obj(id)) moveToZone(ctx.g, id, 'championZone'); }
export function putInLegendZone(ctx: Ctx, id: ObjId, p: PlayerId): void { if (ctx.obj(id)) moveToZone(ctx.g, id, 'legendZone', { controller: p }); }
export function setAside(ctx: Ctx, id: ObjId): void { if (ctx.obj(id)) moveToZone(ctx.g, id, 'setAside'); }

/** The Chosen Champion object of a player (created right after the legend at setup). */
export function chosenChampion(ctx: Ctx, p: PlayerId): ObjId {
  const legend = ctx.g.players[p].legend;
  return `o${Number(legend.slice(1)) + 1}`;
}
/** CR 103.3.a.3: any Champion Unit with the Chosen Champion's name counts as your Chosen Champion (RJ#7080) — p's such cards in
 *  their trash. */
export function chosenChampionsInTrash(ctx: Ctx, p: PlayerId): ObjId[] {
  const orig = ctx.g.objects[chosenChampion(ctx, p)];
  if (!orig) return [];
  const name = ctx.g.cards[orig.cardId]?.name;
  return ctx.g.players[p].trash.filter(id => { const o = ctx.g.objects[id]; const d = o && ctx.g.cards[o.cardId]; return !!d && d.name === name && d.type === 'Unit'; });
}

// ---------------------------------------------------------------------------------------------
// Reckoner's Arena: "activate the conquer effects of units here" (B8-4)
// ---------------------------------------------------------------------------------------------

/** Queue the conquer-triggered abilities of `units` as if `p` had conquered battlefield `bf`. */
export function activateConquerEffects(ctx: Ctx, units: ObjId[], bf: number, p: PlayerId): number {
  const g = ctx.g;
  const ev: GameEvent = { type: 'conquer', player: p, bf, units: [...units], activatedBy: ctx.self };
  let n = 0;
  for (const u of units) {
    if (!g.objects[u]) continue;
    // SCRIPT-FIX (RJ#1341): the unit's conquer effects include the effect text of its attached Equipment, and with Skyfall of
    // Areion attached its hold effects are conquer effects too (queued with a hold-type event so their matchers apply)
    const gear = attachedTo(g, u);
    const skyfall = gear.some(x => g.objects[x]?.cardId === 'sfd-030-221');
    for (const src of [u, ...gear]) {
      for (const r of allAbilities(g, src)) {
        const ab = r.ability;
        if (ab.kind !== 'triggered' || ab.isAdd || ab.immediate) continue;          // Add-speed bookkeeping listeners aren't effects
        if (src !== u && r.viaHost !== u) continue;                                 // only Equipment effect text (the unit's)
        const evs = Array.isArray(ab.on.event) ? ab.on.event : [ab.on.event];
        const asType = evs.includes('conquer') ? 'conquer' : skyfall && evs.includes('hold') ? 'hold' : null;
        if (!asType) continue;
        if (!dependenciesMet(g, src, ab)) continue;
        const e2: GameEvent = asType === 'conquer' ? ev : { ...ev, type: 'hold' };
        const self = r.viaHost ?? u;
        const c = new Ctx(g, self, g.objects[self].controller, e2);
        c.abilitySource = src;
        if (ab.on.match && !ab.on.match(e2, c)) continue;
        if (ab.condition && !ab.condition(c)) continue;
        const qt: QueuedTrigger = { source: self, key: (r as { key?: string }).key ?? abilityKey(g, src, r.index, ab), controller: g.objects[self].controller, event: e2, ts: ++g.timestamp };
        (g.triggerQueue as QueuedTrigger[]).push(qt);
        n++;
      }
    }
    // keyword conquer effects (Hunt — "When I conquer or hold", CR 823; RJ#10797)
    for (const qt of keywordConquerTriggers(g, u, ev, g.objects[u].controller)) { (g.triggerQueue as QueuedTrigger[]).push(qt); n++; }
  }
  return n;
}

/** Is this queued trigger a Deathknell ability? */
export function isDeathknell(ctx: Ctx, qt: QueuedTrigger): boolean {
  const ab = abilityFromKey(ctx.g, qt.key) as { deathknell?: boolean } | undefined;
  return qt.event.type === 'die' && !!ab?.deathknell;
}

export type { QueuedTrigger, Filter, Effect };

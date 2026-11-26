// Helpers owned by scripting batch B1 (empower / XP / level / costs). Built only on public DSL / ctx APIs.
// Where the engine lacks a primitive, the local stand-in is documented here and requested in docs/dsl-requests.md.
import { asPlay, pay, type Ctx, type ObjId, type PlayerId, type Ability, type CostSpec } from '../dsl.ts';
import type { CostModAbility, ExtraCost, Dependency } from '../../engine/abilities.ts';
import type { GameEvent } from '../../engine/types.ts';
import { getScript } from '../registry.ts';
import { victoryScore } from '../../engine/rules.ts';

type Scope = NonNullable<CostModAbility['scope']>;

// ------------------------------------------------------------------------------------------------
// Cost modifiers
// ------------------------------------------------------------------------------------------------

/**
 * Dynamic self cost change with a scope ('play' | 'empower' | ...) and an optional energy floor
 * ("to a minimum of [1]"). delta returns negative numbers for discounts.
 */
export function selfCostB1(delta: (ctx: Ctx) => { energy?: number; power?: number }, o: { scope?: Scope; minEnergy?: number; requires?: Dependency[]; text?: string } = {}): CostModAbility {
  const ab: CostModAbility = {
    kind: 'costMod', selfOnly: true, scope: o.scope, minEnergy: o.minEnergy, requires: o.requires, text: o.text,
    applies: ctx => { const d = delta(ctx); ab.energy = d.energy ?? 0; ab.power = d.power ?? 0; return (d.energy ?? 0) !== 0 || (d.power ?? 0) !== 0; },
  };
  return ab;
}

// ------------------------------------------------------------------------------------------------
// Non-resource cost parts
// ------------------------------------------------------------------------------------------------

export const payB1 = {
  /** Return a friendly gear to its owner's hand */
  returnFriendlyGear(): ExtraCost {
    const cands = (ctx: Ctx) => ctx.gear(g => ctx.ctrl(g) === ctx.controller && g !== ctx.self);
    return pay.custom('Return a friendly gear to its owner\'s hand', ctx => cands(ctx).length > 0, ctx => {
      const g = ctx.chooseCards(cands(ctx), 1, 1, 'Return a friendly gear to its owner\'s hand')[0];
      return !!g && ctx.returnToHand(g).length === 1;
    });
  },
  /** Exhaust your legend */
  exhaustLegend(): ExtraCost {
    return pay.custom('Exhaust your legend', ctx => { const l = ctx.legend(); return !!l && ctx.exists(l) && !ctx.isExhausted(l); }, ctx => { const l = ctx.legend(); if (!l || ctx.isExhausted(l)) return false; ctx.exhaust(l); return true; });
  },
  /** Discard a spell */
  discardSpell(): ExtraCost {
    const cands = (ctx: Ctx) => ctx.hand().filter(h => h !== ctx.self && ctx.type(h) === 'Spell');
    return pay.custom('Discard a spell', ctx => cands(ctx).length > 0, ctx => {
      const c = ctx.chooseCards(cands(ctx), 1, 1, 'Discard a spell')[0];
      return !!c && ctx.discardCards([c]).length === 1;
    });
  },
  /** A gate that makes an optional additional cost available only while cond holds */
  onlyIf(label: string, cond: (ctx: Ctx) => boolean): ExtraCost {
    return pay.custom(label, cond, () => true);
  },
};

export function costOf(s: CostSpec): CostSpec { return s; }

// ------------------------------------------------------------------------------------------------
// "If you paid the additional cost" (spell ctx.data or the play event's playData for triggers)
// ------------------------------------------------------------------------------------------------

export function paidB1(key = 'paidAdditional') {
  return (ctx: Ctx): boolean => {
    if (ctx.data[key]) return true;
    const pd = ctx.event?.playData as Record<string, unknown> | undefined;
    return !!pd?.[key];
  };
}

// ------------------------------------------------------------------------------------------------
// Empower
// ------------------------------------------------------------------------------------------------

/** Empower an object, respecting "can be Empowered up to N times" (script maxEmpower). */
export function empowerB1(ctx: Ctx, id: ObjId | undefined | null): boolean {
  if (!id || !ctx.exists(id)) return false;
  const max = getScript(ctx.obj(id).cardId)?.maxEmpower ?? 1;
  return ctx.empower(id, max);
}

/** Who empowered the object of an 'empower' event: ev.player if the engine provides it, else the
 * controller of the chain item being resolved/played, else the object's controller. */
export function empowererOf(ctx: Ctx, ev: GameEvent): PlayerId | undefined {
  if (typeof ev.player === 'number') return ev.player as PlayerId;
  const top = ctx.g.chain[ctx.g.chain.length - 1];
  if (top) return top.controller;
  const o = ctx.obj(ev.obj as ObjId);
  return o?.controller;
}

/** Board objects + legends that are Empowered and controlled by the player */
export function empoweredThingsOf(ctx: Ctx, p: PlayerId = ctx.controller): ObjId[] {
  const out: ObjId[] = [];
  for (const id in ctx.g.objects) {
    const o = ctx.g.objects[id];
    if (o.controller !== p || !(o.empowered ?? 0)) continue;
    if (o.zone === 'base' || o.zone === 'battlefield' || o.zone === 'legendZone') out.push(id);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
// Per-turn facts. Local stand-ins read this turn's game log (deterministic game state) until the
// engine exposes counters (docs/dsl-requests.md: xpGained / conquered / holdPoints counts).
// ------------------------------------------------------------------------------------------------

function thisTurnLog(ctx: Ctx, p: PlayerId) {
  return ctx.g.log.filter(e => e.turn === ctx.g.turn && e.player === p);
}

export function xpGainedThisTurn(ctx: Ctx, p: PlayerId = ctx.controller): boolean {
  const c = ctx.g.ex.counts[`xpGained:${p}`];
  if (c !== undefined) return c > 0;
  const name = ctx.g.players[p].name;
  return thisTurnLog(ctx, p).some(e => e.text.startsWith(`${name} gains `) && / XP \(\d+\)$/.test(e.text));
}

export function conqueredThisTurn(ctx: Ctx, p: PlayerId = ctx.controller): number {
  const c = ctx.g.ex.counts[`conquered:${p}`];
  if (c !== undefined) return c;
  const name = ctx.g.players[p].name;
  return thisTurnLog(ctx, p).filter(e => e.text.startsWith(`${name} conquers `)).length;
}

export function holdPointsThisTurn(ctx: Ctx, p: PlayerId = ctx.controller): number {
  const c = ctx.g.ex.counts[`holdPoints:${p}`];
  if (c !== undefined) return c;
  const name = ctx.g.players[p].name;
  let n = 0;
  for (const e of thisTurnLog(ctx, p)) {
    const m = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} gains (\\d+) points? \\(hold\\)`).exec(e.text);
    if (m) n += Number(m[1]);
  }
  return n;
}

// ------------------------------------------------------------------------------------------------
// Misc
// ------------------------------------------------------------------------------------------------

/** "an opponent's score is within 3 points of the Victory Score" */
export function oppNearVictory(ctx: Ctx, within = 3): boolean {
  const vs = victoryScore(ctx.g);
  return ctx.opponents().some(p => vs - ctx.points(p) <= within);
}

/** Open battlefield (CR 170.11.c): no units there and no controller. */
export function isOpenBattlefield(ctx: Ctx, bf: number): boolean {
  return ctx.bfController(bf) === null && ctx.unitsAt(bf).length === 0;
}

/** units / gear in the combat that just ended (or is in progress) */
export function inCurrentCombat(ctx: Ctx, id: ObjId): boolean {
  const c = ctx.g.ex.combat;
  return !!c && (c.attackers.includes(id) || c.defenders.includes(id));
}

/** Was the currently resolving (top) chain item choosing this object? */
export function chosenByResolvingItem(ctx: Ctx, id: ObjId): boolean {
  const top = ctx.g.chain[ctx.g.chain.length - 1];
  if (!top) return false;
  return top.targets.flat().includes(id);
}

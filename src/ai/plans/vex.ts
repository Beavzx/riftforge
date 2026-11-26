// PILOT-B plan for Vex, Gloomist (02-vex, 16-vex). Game plan + sources: docs/ai-pilots/vex.md. Interface: docs/ai-plans.md.
// Also exports small helpers shared by PILOT-B's other plans (evelynn, irelia, kennen, ezreal).
import type { Action, Decision } from '../../engine/types.ts';
import type { CardInfo, DeckPlan, PlanCtx } from './types.ts';

// ------------------------------------------------------------------------------------------ shared helpers (PILOT-B)

export const isHidden = (c: CardInfo | null | undefined): boolean => !!c && c.keywords.some(k => k === 'Hidden');
export const isUnit = (c: CardInfo | null | undefined): boolean => !!c && (c.type === 'Unit' || c.type === 'Token');
export const cost = (c: CardInfo | null | undefined): number => (c ? c.energy + c.power : 0);
/** my turn's main phase (not a chain / showdown window) */
export const mainPhase = (d: Decision): boolean => !d.inStep && d.kind === 'mainAction';
/** response window on the opponent's turn or in a showdown */
export const responseWindow = (d: Decision): boolean => !d.inStep && (d.kind === 'chainResponse' || d.kind === 'showdownAction');
/** the top chain item is the opponent's */
export const oppOnChain = (ctx: PlanCtx): boolean => { const t = ctx.g.chain[ctx.g.chain.length - 1]; return !!t && t.controller !== ctx.me; };
/**
 * How much the opponent's top chain item is worth countering (0 = nothing to counter): its cost, more when it chooses
 * one of my units (champions / key units most), less for cheap cantrips. Counters (Defy, Not So Fast, Abandon, Hard
 * Bargain) are only worth spending on a threat >= ~3.
 */
export function chainThreat(ctx: PlanCtx, key: string[] = []): number {
  const t = ctx.g.chain[ctx.g.chain.length - 1];
  if (!t || t.controller === ctx.me || t.isAdd) return 0;
  const src = ctx.g.objects[t.source];
  const def = src ? ctx.g.cards[src.cardId] : undefined;
  let v = def ? (def.energy ?? 0) + (def.power ?? 0) * 1.5 : 1;
  if (t.kind !== 'spell') v *= 0.6;
  for (const grp of t.targets ?? []) for (const id of grp) {
    const o = ctx.g.objects[id];
    if (!o || o.controller !== ctx.me) continue;
    const c = ctx.info(id);
    if (!c || c.type !== 'Unit') continue;
    v += 1 + (c.champion || key.includes(c.name) ? 2.5 : 0) + c.might * 0.2;
  }
  return v;
}
/**
 * Hold race: when both players hold a battlefield, the player who is not ahead loses the race unless they break the
 * opponent's hold (seen in mirrors: seat 1 lost 8-7 at turn 15-17 without ever attacking). Penalise each battlefield the
 * opponent controls while we are not ahead, so conquering it is worth more than sitting.
 */
// Tried in Vex / Kennen (k = 3): identical results over 40-45 paired mirror games, so it is not wired in (kept for reference).
export function raceBonus(ctx: PlanCtx, k = 3): number {
  const theirs = ctx.g.battlefields.filter(b => b.controller === ctx.opp).length;
  if (!theirs) return 0;
  const behind = ctx.myPoints <= ctx.oppPoints + (ctx.myTurn ? 0 : 1);
  return behind ? -k * theirs : 0;
}
/** combat tricks: only useful on a unit in the current fight */
export const PUMPS = ['Punch First', "Hold 'Em", 'Discipline', 'Defiant Dance', 'En Garde', 'Twilight Shroud'];
/** battlefield of the current showdown / combat, if any */
export const fightBf = (ctx: PlanCtx): number | undefined => ctx.g.showdown?.battlefieldIndex ?? ctx.g.ex.combat?.bf;
/**
 * Targeting for "+N Might this turn" / "-N Might this turn" prompts: buff my units in the fight, shrink enemy units in
 * the fight; anything else is wasted. Returns undefined for other prompts.
 */
export function pumpTarget(opt: CardInfo | null, d: Decision, ctx: PlanCtx): number | undefined {
  if (!opt) return undefined;
  const plus = /Give (a|another|a friendly) (friendly )?unit \+\d+ Might/i.test(d.prompt);
  const minus = /Give (a|another) unit -\d+ Might/i.test(d.prompt);
  if (!plus && !minus) return undefined;
  const bf = fightBf(ctx);
  const inFight = bf !== undefined && opt.zone === 'battlefield' && opt.battlefield === bf;
  const mine = opt.controller === ctx.me;
  if (plus) return mine ? (bf === undefined ? 0 : inFight ? 4 + opt.might * 0.1 : -6) : -8;
  return !mine ? (bf === undefined ? 0 : inFight ? 4 + opt.might * 0.2 : -6) : -8;
}
/**
 * Targeting for harmful effects that may choose any unit (Rebuke / Gust bounce, Back Off stun, Wages of Pain / Singularity
 * damage): never my own unit (seen: Rebuke returning our freshly played Astral Heron), the most valuable enemy first.
 */
export function harmTarget(opt: CardInfo | null, d: Decision, ctx: PlanCtx): number | undefined {
  if (!opt || opt.type !== 'Unit') return undefined;
  if (!/^(Return a unit at a battlefield|Stun a unit|Deal \d+ to (a unit|each of up to two units))/i.test(d.prompt)) return undefined;
  if (opt.controller === ctx.me) return -8;
  return 2 + opt.might * 0.4 + (opt.champion ? 1.5 : 0) + (opt.attachments.length ? 1 : 0);
}
/** prior for a combat trick cast in the main phase outside a fight (wasted) */
export const pumpPrior = (card: CardInfo | null, ctx: PlanCtx): number | undefined =>
  card && PUMPS.includes(card.name) && fightBf(ctx) === undefined ? -6 : undefined;
/** extra turns queued (Time Warp): the core evaluation does not see them */
// (now a core eval term `extraTurn`, docs/ai-requests.md DONE; kept as 0 so the plans' bonus hooks stay unchanged)
export const extraTurnBonus = (_ctx: PlanCtx): number => 0;
/** a combat / showdown is going on at bf (or any battlefield when bf is undefined) */
export const fighting = (ctx: PlanCtx, bf?: number): boolean => {
  const s = ctx.g.showdown; const c = ctx.g.ex.combat;
  if (bf === undefined) return !!s || !!c;
  return (s?.battlefieldIndex === bf) || (c?.bf === bf);
};
/** yes/no optional prompt helper: score for option ids 'yes' / 'no' */
export const yesNo = (id: string, yes: number): number | undefined => (id === 'yes' ? yes : id === 'no' ? -yes : undefined);
/** battlefields I control */
export const myBfs = (ctx: PlanCtx): number[] => ctx.g.battlefields.map((_, i) => i).filter(i => ctx.controllerOf(i) === ctx.me);
/** does a facedown card of mine sit at bf */
export const myFacedownAt = (ctx: PlanCtx, bf: number): boolean => ctx.board.some(c => c.zone === 'facedown' && c.battlefield === bf);
/**
 * End-of-turn reserve for reactions: the cheapest reaction in hand that we could actually cast with our runes (energy +
 * power both come from runes). Nothing to reserve when none is castable (e.g. Star-Crossed on turn 2).
 */
export function reserveFor(ctx: PlanCtx, names: string[], value: number): { energy: number; value: number; forCards: string[] } | undefined {
  const held = ctx.hand.filter(c => names.includes(c.name) && c.energy + c.power <= ctx.runes);
  if (!held.length) return undefined;
  const e = Math.min(...held.map(c => c.energy + c.power));
  return { energy: Math.max(1, Math.min(3, e)), value, forCards: held.map(c => c.name) };
}
/** keep-score table for mulligans: name -> score (>0 keep, <0 send back); default by cost */
export function mulliganTable(table: Record<string, number>, hand: CardInfo[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of hand) out[c.obj] = table[c.name] ?? (cost(c) <= 3 ? 1 : cost(c) >= 6 ? -4 : -1);
  return out;
}
/** value of keeping a card in hand (for discard choices: discard the lowest) */
export function keepValue(c: CardInfo | null, table: Record<string, number>, ctx: PlanCtx): number {
  if (!c) return 0;
  const base = table[c.name] ?? 2;
  // a card we cannot cast for many turns is worth less early
  const castable = cost(c) <= ctx.runes + 1 ? 0 : -Math.min(3, (cost(c) - ctx.runes) * 0.5);
  const dup = ctx.hand.filter(h => h.name === c.name).length > 1 ? -0.5 : 0;
  return base + castable + dup;
}
export const isDiscardPrompt = (d: Decision): boolean => /discard/i.test(d.prompt) && !/opponent|they discard/i.test(d.prompt);
/** acting object of an action, as the core passes it ('choose' -> first chosen object) */
export const actName = (card: CardInfo | null): string => card?.name ?? '';
export const playsFromFacedown = (a: Action, card: CardInfo | null): boolean => a.type === 'playCard' && card?.zone === 'facedown';

// ------------------------------------------------------------------------------------------ Vex

const REACTIONS = ['Defy', 'Gust', 'Discipline', 'Not So Fast', 'Abandon', 'Star-Crossed', 'Janna'];
const KEEP: Record<string, number> = {
  'Steel Paws': 4, 'Bedeviling Stranger': 4, 'Scuttle Crab': 4, 'Sneaky Deckhand': 3, 'Tornado Warrior': 3, 'Reckless Innovator': 3,
  'Evelynn': 3, 'Pyke': 2, 'Defy': 2, 'Gust': 2, 'Discipline': 2, 'Switcheroo': 1, 'Back Off': 1, 'Boots of Swiftness': 0,
  'Edge of Night': 0, 'Janna': 0, 'Not So Fast': 0, 'Abandon': -1, 'The Good Stuff': -1, 'Rebuke': -2, 'Star-Crossed': -2,
  'Blitzcrank': -3, 'Astral Heron': -4, 'Kharox': -5, 'Baron Nashor': -6,
};
const HAND_VALUE: Record<string, number> = { ...KEEP, 'Astral Heron': 3, 'Baron Nashor': 2, 'Kharox': 2, 'Vex': 5, 'Switcheroo': 3, 'Defy': 3 };

/** Vex, Apathetic is at a battlefield (stun lock is on) */
const vexAtBf = (ctx: PlanCtx) => ctx.board.some(c => c.name === 'Vex' && c.zone === 'battlefield');

export const plan: DeckPlan = {
  id: 'vex',
  legends: ['Vex'],
  author: 'PILOT-B 2026-11-26',

  mulligan: (hand) => mulliganTable(KEEP, hand),

  prior: (a, card, d, ctx) => {
    if (mainPhase(d)) {
      if (a.type === 'playCard' && card) {
        const pp = pumpPrior(card, ctx); if (pp !== undefined) return pp;
        if (card.name === 'Vex' && vexAtBf(ctx)) return -1;                                                  // a second Vex adds no lock
        if (card.name === 'Vex' && a.destination !== undefined && a.destination !== 'base') return 4;      // stun lock from a battlefield
        if (card.name === 'Vex') return 1;
        if (playsFromFacedown(a, card)) return 1;
        if (card.name === 'The Good Stuff') return typeof a.destination === 'number' && ctx.controllerOf(a.destination) === ctx.me ? 3 : -4;
        if (card.name === 'Astral Heron' && typeof a.destination === 'number') return 2;
        if (card.name === 'Steel Paws' && ctx.turn <= 4) return 1.5;
        if (card.name === 'Scuttle Crab') return 1;
      }
      if (a.type === 'hide') return 2;
      // Steel Paws' Empower [7] late: a 7-Might holder
      if (a.type === 'activate' && card?.name === 'Steel Paws') return 1;
    }
    return undefined;
  },

  target: (opt, id, d, ctx) => {
    const p = d.prompt;
    const pt = pumpTarget(opt, d, ctx); if (pt !== undefined) return pt;
    const ht = harmTarget(opt, d, ctx); if (ht !== undefined) return ht;
    if (/Gloomist/.test(p)) return yesNo(id, 8);                     // always draw on hold (legend has no other use)
    if (/Startipped Peak/.test(p)) return yesNo(id, 5);
    if (/Tornado Warrior: empower/.test(p)) return yesNo(id, 4);
    if (/Empower something here/.test(p) && opt) {
      if (opt.controller !== ctx.me) return -8;
      if (opt.name === 'Steel Paws') return 8;                       // +7 Might
      if (opt.name === 'Kharox') return 7;                           // Burn 3 + reanimate
      return 0;
    }
    if (/Swap the Mights/.test(p) && opt) {
      // swap our weakest with their strongest at the same battlefield
      return opt.controller === ctx.me ? 4 - opt.might : opt.might;
    }
    if (isDiscardPrompt(d) && opt && opt.controller === ctx.me) return -keepValue(opt, HAND_VALUE, ctx);
    return undefined;
  },

  respond: (a, card, d, ctx) => {
    if (a.type === 'pass') return undefined;
    const n = actName(card);
    if (['Defy', 'Not So Fast', 'Abandon'].includes(n)) return chainThreat(ctx, ['Vex', 'Steel Paws', 'Astral Heron']) >= 3 ? 4 : -1;
    if (card?.zone === 'facedown') return fighting(ctx, card.battlefield) ? 3 : -1;   // reveal only in a fight there (else it keeps its value)
    if (['Gust', 'Discipline', 'Star-Crossed', 'Janna', 'Switcheroo', 'Back Off', 'Rebuke'].includes(n)) return fighting(ctx) || oppOnChain(ctx) ? 2 : -0.5;
    return undefined;
  },

  hide: {
    hideValue: (c, bf, ctx) => {
      let v = 0;
      switch (c.name) {
        case 'Switcheroo': v = 3.4; break;
        case 'Tornado Warrior': v = ctx.unitsAt(bf, 'me').some(u => u.name === 'Steel Paws' || u.name === 'Kharox') ? 4.2 : 2.8; break;
        case 'Back Off': v = 3; break;
        case 'Bedeviling Stranger': v = 2.4; break;
        case 'Pyke': v = 2.4; break;
        case 'Evelynn': v = 2.6; break;
        case 'Edge of Night': v = 2.6; break;
        default: v = isHidden(c) ? 2 : 0;
      }
      if (ctx.battlefields[bf] === "Bandle Scouts' Academy") v += 1.2;     // the Gold token refunds the [A]
      return v;
    },
  },

  resources: {
    reserve: ctx => reserveFor(ctx, REACTIONS, 2),
  },

  eval: {
    // holding is the plan (and the core projection over-rates retreating a lone holder: docs/ai-requests.md)
    weights: { ctl: 4 },
    cardValue: (c, ctx) => {
      if (c.name === 'Vex' && c.zone === 'battlefield') return ctx.board.filter(b => b.name === 'Vex' && b.zone === 'battlefield' && b.obj < c.obj).length ? 0 : 3;   // stun lock (once)
      if (c.name === 'Steel Paws' && c.zone !== 'hand' && c.might >= 7) return 1;
      if (c.name === 'The Good Stuff' && c.zone === 'battlefield' && c.battlefield !== undefined && ctx.controllerOf(c.battlefield) === ctx.me) return 1;
      return undefined;
    },
    bonus: ctx => (vexAtBf(ctx) ? 0.5 : 0) + extraTurnBonus(ctx),
  },
};

// PILOT-A: deck plan for Sett, The Boss (13-sett). Game plan + sources: docs/ai-pilots/sett.md.
// Body/Order buffs: buffed units that The Boss saves (pay [A], exhaust: recall instead of dying), Sett, Kingpin (+1 per
// buffed friendly unit at his battlefield, Tank) at the key battlefield, combat tricks (Punch First +5, Call to Glory
// free by spending a buff), Faefolk pulls an enemy unit into our fight.
import type { Action, Decision } from '../../engine/types.ts';
import type { CardInfo, DeckPlan, PlanCtx } from './types.ts';
import { dmgFromPrompt, damageTargetScore } from './kaisa.ts';

const CHEAP = new Set(['Irresistible Faefolk', 'Pit Rookie', 'Trifarian Captain', 'Pillaged Armory', 'Showstopper']);
const AMBUSH = new Set(['Nidalee', 'Rengar', 'Vi']);
const isSett = (c: CardInfo | null | undefined) => !!c && c.type === 'Unit' && c.tags.includes('Sett');
const buffed = (ctx: PlanCtx, c: CardInfo) => !!ctx.g.objects[c.obj]?.counters?.buff;
const myUnits = (ctx: PlanCtx) => ctx.board.filter(c => c.type === 'Unit');

function mulligan(hand: CardInfo[]): Record<string, number | undefined> {
  const out: Record<string, number> = {};
  const units = hand.filter(c => c.type === 'Unit' && c.energy <= 3).length;
  let amb = 0;
  for (const c of hand) {
    let s = 0.5;
    if (CHEAP.has(c.name)) s = 3.5;
    else if (c.name === 'Kinkou Initiate' || c.name === 'First Mate' || c.name === 'Fiora') s = 2;
    else if (isSett(c)) s = 2;
    else if (c.name === 'Punch First' || c.name === 'Call to Glory') s = units >= 2 ? 1.5 : -0.5;
    else if (AMBUSH.has(c.name)) s = ++amb === 1 ? 0 : -2;
    else if (c.name === 'Ruin Runner') s = -2;
    else if (c.name === 'Rampage') s = units ? 0 : -1.5;
    out[c.obj] = s;
  }
  return out;
}

function prior(a: Action, card: CardInfo | null, d: Decision, ctx: PlanCtx): number | undefined {
  if (a.type === 'playCard' && card && !d.inStep) {
    if (card.name === 'Pit Rookie') return myUnits(ctx).some(u => !buffed(ctx, u)) ? 3 : -1;
    if (card.name === 'Showstopper') return ctx.unitsAt('base', 'me').length ? 2 : -6;
    if (isSett(card)) return 2 + Math.min(3, myUnits(ctx).filter(u => buffed(ctx, u)).length);
    if (card.name === 'Pillaged Armory') return myUnits(ctx).length ? 2 : -1;
    if (card.name === 'Punch First' || card.name === 'Call to Glory') return -1;          // tricks: in combat (search)
    if (card.type === 'Unit' && card.energy <= 3) return ctx.turn <= 8 ? 2 : 1;
  }
  if (a.type === 'choose' && d.inStep) {
    if (/The Boss: pay \[A\]/i.test(d.prompt)) return a.optionIds.includes('yes') ? 5 : 0;
    if (/spend a buff to draw/i.test(d.prompt)) return 0;
  }
  return undefined;
}

function target(opt: CardInfo | null, _id: string, d: Decision, ctx: PlanCtx): number | undefined {
  if (!opt) return undefined;
  if (/Buff another friendly unit|Buff a friendly unit/i.test(d.prompt) && opt.controller === ctx.me) {
    // a unit holds one buff: an unbuffed unit at (or going to) a battlefield, Sett's battlefield-mates first
    const sett = ctx.board.find(c => isSett(c));
    return (buffed(ctx, opt) ? -3 : 2) + (isSett(opt) ? 1.5 : 0) + (sett && sett.battlefield !== undefined && opt.battlefield === sett.battlefield ? 1 : 0) + opt.might * 0.2;
  }
  if (/Spend a buff from/i.test(d.prompt) && opt.controller === ctx.me) {
    const sett = ctx.board.find(c => isSett(c));
    return (sett && opt.battlefield !== undefined && opt.battlefield === sett.battlefield ? -2 : 1) + (opt.zone === 'base' ? 1 : 0);
  }
  if (/move an enemy unit to that battlefield/i.test(d.prompt) && opt.controller !== ctx.me) return 2 - opt.might * 0.3 + (opt.champion ? 1 : 0);
  if (/Choose an enemy unit/i.test(d.prompt) && opt.controller !== ctx.me) return 1 + opt.might * 0.5 + (opt.champion ? 2 : 0);
  if (/Choose a friendly unit/i.test(d.prompt) && opt.controller === ctx.me) return opt.might;
  const dmg = dmgFromPrompt(d, opt, ctx);
  if (dmg !== null && opt.type === 'Unit' && d.hint !== 'help') return damageTargetScore(opt, dmg, ctx, d);
  return undefined;
}

function respond(a: Action, card: CardInfo | null, d: Decision, _ctx: PlanCtx): number | undefined {
  if (a.type !== 'playCard' || !card) return undefined;
  if (AMBUSH.has(card.name)) return d.kind === 'showdownAction' ? 2.5 : 1;
  if (card.name === 'Call to Glory' || card.name === 'Punch First') return d.kind === 'showdownAction' ? 2.5 : -1;
  return undefined;
}

export const plan: DeckPlan = {
  id: 'sett',
  legends: ['Sett'],
  author: 'PILOT-A 2026-11-26',
  mulligan,
  prior,
  target,
  respond,
  combos: [
    {
      name: 'unit -> Pit Rookie (buff it)',
      when: ctx => ctx.myTurn && ctx.count('Pit Rookie', 'hand') > 0 && !myUnits(ctx).some(u => !buffed(ctx, u)),
      steps: [
        { do: 'play', card: (c: CardInfo) => c.type === 'Unit' && c.name !== 'Pit Rookie' && c.energy <= 3 },
        { do: 'play', card: 'Pit Rookie' },
      ],
    },
    {
      name: 'Showstopper the best base unit into a battlefield',
      when: ctx => ctx.myTurn && ctx.count('Showstopper', 'hand') > 0 && ctx.unitsAt('base', 'me').length > 0,
      steps: [{ do: 'play', card: 'Showstopper' }],
      choices: [{ prompt: /Buff a friendly unit in your base/i, pick: (opt: CardInfo | null) => opt ? opt.might + (isSett(opt) ? 3 : 0) : 0 }],
    },
  ],
  resources: {
    runeValue: 1.4,
    recycleCost: (forCard, ctx) => (ctx.runeDeckSize <= 1 ? 0 : forCard && forCard.type === 'Spell' ? 0.4 : 0.7),
    // keep [A] (a rune) + The Boss ready when a buffed unit is exposed
    reserve: ctx => myUnits(ctx).some(u => buffed(ctx, u) && u.zone === 'battlefield') && !ctx.legend.exhausted ? { energy: 1, value: 1.5 } : undefined,
  },
  eval: {
    cardValue: (c, ctx) => {
      if (c.type === 'Unit' && c.zone !== 'hand' && buffed(ctx, c)) return 0.8 + (!ctx.legend.exhausted ? 0.6 : 0);   // a save is available
      if (isSett(c) && c.zone === 'battlefield') return 1;
      return undefined;
    },
  },
};

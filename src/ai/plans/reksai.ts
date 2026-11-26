// PILOT-A: deck plan for Rek'Sai, Void Burrower (04/05/17-rek-sai). Game plan + sources: docs/ai-pilots/reksai.md.
// Fury/Order conquest aggro: cheap units take battlefields early, every conquest exhausts the legend to reveal 2 and play
// one (Breacher gives it Accelerate), Undertitan's +2 team pump is the alpha turn, removal clears blockers.
import type { Action, Decision } from '../../engine/types.ts';
import type { CardInfo, DeckPlan, PlanCtx } from './types.ts';
import { dmgFromPrompt, damageTargetScore } from './kaisa.ts';

const TWO_DROPS = new Set(['Inferna', 'Carrion Dredger', 'Trifarian Captain', 'Concert Poster']);
const REACTION_UNITS = new Set(['Inferna', 'Rengar', 'Grim Apothecary']);
const FODDER = (c: CardInfo) => c.isToken || c.name === 'Carrion Dredger' || c.name === 'Hunting Dog' || c.name === 'Concert Poster';
const isRek = (c: CardInfo | null | undefined) => !!c && c.type === 'Unit' && c.tags.includes("Rek'Sai");

function mulligan(hand: CardInfo[]): Record<string, number | undefined> {
  const out: Record<string, number> = {};
  const cheap = hand.filter(c => TWO_DROPS.has(c.name) || c.name === 'Faithful Manufactor').length;
  let titan = 0;
  for (const c of hand) {
    let s = 0.5;
    if (TWO_DROPS.has(c.name)) s = 4;
    else if (c.name === 'Faithful Manufactor' || c.name === 'Bilgewater Tracker' || c.name === 'Hunting Dog' || c.name === 'Shimmering Swimmer') s = 2.5;
    else if (c.name === 'Noxus Hopeful') s = cheap ? 2 : 0;
    else if (isRek(c)) s = 2;
    else if (c.name === 'Falling Star' || c.name === 'Cull the Weak' || c.name === 'Blood Rush' || c.name === 'Cleave') s = 1;
    else if (c.name === 'Undertitan') s = ++titan === 1 && cheap >= 2 ? 0.2 : -2;
    else if (c.name === 'Imperial Decree' || c.name === 'Ferrous Forerunner') s = -2.5;
    out[c.obj] = s;
  }
  return out;
}

const enemyUnits = (ctx: PlanCtx) => ctx.oppBoard.filter(c => c.type === 'Unit');
const myUnits = (ctx: PlanCtx) => ctx.board.filter(c => c.type === 'Unit');

function prior(a: Action, card: CardInfo | null, d: Decision, ctx: PlanCtx): number | undefined {
  if (a.type === 'playCard' && card && !d.inStep) {
    if (card.name === 'Noxus Hopeful') return ctx.playedThisTurn.length ? 3 : -3;
    if (card.name === 'Undertitan') return myUnits(ctx).filter(u => !u.exhausted).length >= 2 ? 4 : -1;
    if (card.name === 'Cull the Weak') {
      const e = enemyUnits(ctx).length;
      const fodder = ctx.board.some(c => c.type === 'Unit' && FODDER(c));
      return e >= 1 && e <= 2 && fodder ? 4 : e === 0 ? -8 : -2;
    }
    if (card.name === 'Imperial Decree') return enemyUnits(ctx).length >= 3 ? 1 : -4;
    if (card.name === 'Cleave' || card.name === 'Blood Rush') return -1;         // only while attacking: search decides
    if (TWO_DROPS.has(card.name) || card.type === 'Unit' && card.energy <= 3) return ctx.turn <= 8 ? 2 : 1;
  }
  if (a.type === 'choose' && d.inStep) {
    if (/Void Burrower: exhaust me/i.test(d.prompt)) return a.optionIds.includes('yes') ? 4 : 0;
    if (/Concert Poster|play a 1 \[S\] Recruit/i.test(d.prompt)) return a.optionIds.includes('yes') ? 1.5 : 0;
  }
  return undefined;
}

function target(opt: CardInfo | null, _id: string, d: Decision, ctx: PlanCtx): number | undefined {
  if (/You may banish one and play it/i.test(d.prompt)) {
    if (!opt) return undefined;
    return (opt.type === 'Unit' ? 2 + opt.might : 1) + opt.energy * 0.3 + (opt.name === 'Undertitan' ? 3 : 0);
  }
  if (/Kill a friendly unit or gear|Kill one of your/i.test(d.prompt) && opt && opt.controller === ctx.me) {
    return FODDER(opt) ? 3 - opt.might * 0.2 : -2 - opt.might - (opt.champion ? 4 : 0);
  }
  if (opt && opt.type === 'Unit') {
    const dmg = dmgFromPrompt(d, opt, ctx);
    if (dmg !== null && d.hint !== 'help') return damageTargetScore(opt, dmg, ctx, d);
    if (/Assault/i.test(d.prompt) && opt.controller === ctx.me) return (opt.zone === 'battlefield' ? 2 : 0) + (opt.exhausted ? -2 : 1);
  }
  return undefined;
}

function respond(a: Action, card: CardInfo | null, d: Decision, _ctx: PlanCtx): number | undefined {
  if (a.type !== 'playCard' || !card) return undefined;
  if (REACTION_UNITS.has(card.name)) return d.kind === 'showdownAction' ? 2.5 : 1;
  if (card.name === 'Cleave' || card.name === 'Blood Rush') return d.kind === 'showdownAction' ? 2 : -1;
  return undefined;
}

export const plan: DeckPlan = {
  id: 'reksai',
  legends: ["Rek'Sai"],
  author: 'PILOT-A 2026-11-26',
  mulligan,
  prior,
  target,
  respond,
  combos: [
    {
      name: 'Undertitan (+2 to the others) -> attack with everyone',
      when: ctx => ctx.myTurn && ctx.count('Undertitan', 'hand') > 0 && myUnits(ctx).some(u => !u.exhausted && !u.stunned),
      steps: [
        { do: 'play', card: 'Undertitan' },
        { do: 'move', to: 'battlefield', units: 'ready', card: (c: CardInfo) => c.type === 'Unit' && !c.exhausted && c.name !== 'Undertitan' },
      ],
    },
    {
      name: 'Cull the Weak (we sacrifice a token) -> attack',
      when: ctx => ctx.myTurn && ctx.count('Cull the Weak', 'hand') > 0 && ctx.board.some(c => c.type === 'Unit' && FODDER(c)) && enemyUnits(ctx).length >= 1 && enemyUnits(ctx).length <= 2,
      steps: [
        { do: 'play', card: 'Cull the Weak' },
        { do: 'move', to: 'battlefield', units: 'ready', card: (c: CardInfo) => c.type === 'Unit' && !c.exhausted, optional: true },
      ],
      choices: [{ prompt: /Kill one of your/i, pick: (opt: CardInfo | null) => opt ? (FODDER(opt) ? 3 : -3 - opt.might) : 0 }],
    },
    {
      name: 'cheap card -> Noxus Hopeful (Legion)',
      when: ctx => ctx.myTurn && ctx.count('Noxus Hopeful', 'hand') > 0 && !ctx.playedThisTurn.length,
      steps: [
        { do: 'play', card: (c: CardInfo) => c.name !== 'Noxus Hopeful' && c.energy <= 2 },
        { do: 'play', card: 'Noxus Hopeful' },
      ],
    },
  ],
  resources: {
    runeValue: 1.3,
    recycleCost: (forCard, ctx) => {
      if (ctx.runeDeckSize <= 1) return 0;
      if (forCard && forCard.type === 'Spell') return 0.3;
      if (forCard && isRek(forCard)) return 0.6;
      return 0.7;
    },
    // no energy reserve for Inferna / Rengar: watched games held 2-3 units in hand for many turns; this deck deploys
  },
  eval: {
    cardValue: (c, ctx) => {
      if (c.obj === ctx.legend.obj && !c.exhausted) return 0.5;    // a conquest will reveal
      if (isRek(c) && c.zone !== 'hand') return 0.8;
      return undefined;
    },
  },
};

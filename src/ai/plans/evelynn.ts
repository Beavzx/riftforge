// PILOT-B plan for Evelynn, Agony's Embrace (03-evelynn, 15-evelynn). Game plan + sources: docs/ai-pilots/evelynn.md.
// Core loop: hide a Hidden card at a battlefield we control, next turn play it from face down on OUR turn (free card +
// legend draw), hide another. Body tricks / Rengar Ambush / Vex stun win the fights.
import type { DeckPlan, PlanCtx } from './types.ts';
import { harmTarget, pumpPrior, pumpTarget, extraTurnBonus, chainThreat, isHidden, isUnit, cost, mainPhase, oppOnChain, fighting, yesNo, mulliganTable, keepValue, isDiscardPrompt, actName,
  playsFromFacedown, reserveFor } from './vex.ts';

const KEEP: Record<string, number> = {
  'Bedeviling Stranger': 4, 'Gutter Guardian': 4, 'Pyke': 3, 'Tornado Warrior': 3, 'Evelynn': 4, 'Kinkou Initiate': 3,
  'Reckless Innovator': 3, 'Ezreal': 3, 'Momentary Companion': 2, 'Vex': 2, 'Gust': 2, 'Punch First': 1, "Hold 'Em": 1,
  'Switcheroo': 1, 'Edge of Night': 1, 'Boots of Swiftness': 0, 'Tail-Cloaked Matriarch': 0, 'Fizz': 0, 'Abandon': 0,
  'Rebuke': -1, 'The Good Stuff': -1, 'Rampage': -1, 'Star-Crossed': -2, "K'Sante": -2, 'Rengar': -2, 'Ruin Runner': -4,
};
const HAND_VALUE: Record<string, number> = { ...KEEP, 'Rengar': 4, "K'Sante": 2.5, 'Ruin Runner': 2, 'Punch First': 3, 'Rampage': 3, 'Star-Crossed': 2 };
const REACTIONS = ['Gust', 'Star-Crossed', 'Abandon', 'Rengar'];

/** do I have a facedown card that can be played this turn (hidden on an earlier turn) */
/** the legend's once-per-turn draw is still available */
const legendDrawUnused = (ctx: PlanCtx) => !(ctx.g.ex.playedThisTurn[ctx.me] ?? []).some(id => !!ctx.g.objects[id]?.playedFromHidden);

export const plan: DeckPlan = {
  id: 'evelynn',
  legends: ['Evelynn'],
  author: 'PILOT-B 2026-11-26',

  mulligan: (hand) => mulliganTable(KEEP, hand),

  prior: (a, card, d, ctx) => {
    if (mainPhase(d)) {
      if (playsFromFacedown(a, card)) return 5;              // free card + legend draw: do it first
      if (a.type === 'hide') return 3;
      if (a.type === 'playCard' && card) {
        const pp = pumpPrior(card, ctx); if (pp !== undefined) return pp;
        if (card.name === 'Rampage') return 0.5;
        if (card.name === 'Vex' && typeof a.destination === 'number') return 3;
        if (card.name === 'Gutter Guardian') return 1;
      }
    }
    return undefined;
  },

  target: (opt, id, d, ctx) => {
    const p = d.prompt;
    const ht = harmTarget(opt, d, ctx); if (ht !== undefined) return ht;
    const pt = pumpTarget(opt, d, ctx); if (pt !== undefined) return pt;
    if (/Startipped Peak/.test(p)) return yesNo(id, 5);
    if (/Show off a card with \[Hidden\]/.test(p)) return opt ? 4 : undefined;            // +[A]: always show off
    if (/Tornado Warrior: empower/.test(p)) return yesNo(id, 4);
    if (/Empower something here/.test(p) && opt) return opt.controller !== ctx.me ? -8 : opt.name === 'Tail-Cloaked Matriarch' ? 8 : 0;
    if (/Matriarch: play a unit from your trash/.test(p)) return yesNo(id, 5);
    if (/Choose a unit in your trash/.test(p) && opt) return cost(opt) + (isHidden(opt) ? 0.5 : 0);
    if (/move an enemy unit at a different location to my battlefield/.test(p) && opt) {
      // pull a lone defender off a battlefield (opens it), or the weakest unit into our units
      const bf = opt.battlefield;
      const alone = bf !== undefined && ctx.unitsAt(bf, 'opp').length === 1;
      return (alone ? 3 : 0) + Math.max(0, 4 - opt.might) * 0.5;
    }
    if (/Swap the Mights/.test(p) && opt) return opt.controller === ctx.me ? 4 - opt.might : opt.might;
    if (/Pay \[C\] as an additional cost \(\+2 Might\)/.test(p)) return undefined;     // search decides
    if (isDiscardPrompt(d) && opt && opt.controller === ctx.me) return -keepValue(opt, HAND_VALUE, ctx);
    return undefined;
  },

  respond: (a, card, d, ctx) => {
    if (a.type === 'pass') return undefined;
    const n = actName(card);
    if (card?.zone === 'facedown') {
      // revealing on the opponent's turn only loots: do it when it wins / prevents a fight
      return fighting(ctx, card.battlefield) ? 3 : -1;
    }
    if (n === 'Rengar') return fighting(ctx) ? 4 : -1;
    if (n === 'Abandon') return chainThreat(ctx, ['Rengar', 'Vex']) >= 3 ? 4 : -1;
    if (['Gust', 'Star-Crossed', 'Punch First', "Hold 'Em", 'Switcheroo', 'Rampage', 'Rebuke'].includes(n)) return fighting(ctx) || oppOnChain(ctx) ? 2 : -0.5;
    return undefined;
  },

  hide: {
    hideValue: (c, bf, ctx) => {
      if (!isHidden(c)) return 0;
      // a facedown card that is already playable on our own turn while the legend's draw is unused: its value is in
      // PLAYING it now (free card + draw), so holding it is worth little
      const hidTurn = ctx.g.objects[c.obj]?.hiddenTurn;
      if (c.zone === 'facedown' && ctx.myTurn && hidTurn !== undefined && hidTurn < ctx.turn && legendDrawUnused(ctx)) return 0.3;
      // next turn: a free card + the legend's draw
      let v = 3.4 + Math.min(3, cost(c)) * 0.35;
      if (c.name === 'Evelynn') v += 1;                       // pull on our turn
      if (c.name === 'Momentary Companion') v -= 0.8;
      if (c.name === 'Tornado Warrior' && ctx.unitsAt(bf, 'me').some(u => u.name === 'Tail-Cloaked Matriarch')) v += 1.5;
      if (c.zone !== 'facedown' && ctx.battlefields[bf] === "Bandle Scouts' Academy") v += 1.2;
      return v;
    },
  },

  resources: {
    reserve: ctx => reserveFor(ctx, REACTIONS, 1.5),
  },

  eval: {
    // holding is the plan (and the core projection over-rates retreating a lone holder: docs/ai-requests.md)
    weights: { ctl: 3 },
    bonus: ctx => extraTurnBonus(ctx),
    cardValue: (c, ctx) => {
      if (c.name === 'Vex' && c.zone === 'battlefield') return 2.5;
      if (isUnit(c) && c.name === 'Rengar' && c.zone === 'hand' && ctx.readyRunes >= 6) return 1;
      return undefined;
    },
  },
};

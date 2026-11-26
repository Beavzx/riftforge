// PILOT-B plan for Irelia, Blade Dancer (09-irelia, 20-irelia). Game plan + sources: docs/ai-pilots/irelia.md.
// Irelia, Fervent (Deflect, +1 whenever chosen/readied) is the threat; cheap spells on her trigger the legend's ready
// ([A]) for a second attack / to defend; after a conquer pay [1] to ready the legend. Counters protect her.
import type { DeckPlan, PlanCtx } from './types.ts';
import { harmTarget, pumpPrior, pumpTarget, extraTurnBonus, chainThreat, cost, mainPhase, oppOnChain, fighting, yesNo, mulliganTable, keepValue, isDiscardPrompt, actName, reserveFor, isHidden } from './vex.ts';

const KEEP: Record<string, number> = {
  'Scuttle Crab': 4, 'Tideturner': 4, 'Reckless Innovator': 3, 'Guardian Angel': 3, 'Vex': 2, 'Defiant Dance': 2, 'Defy': 2,
  'Discipline': 2, 'En Garde': 1, 'Find Your Center': 2, 'Charm': 1, 'Gust': 1, 'Edge of Night': 1, 'Ride the Wind': 0,
  'Not So Fast': 0, 'Switcheroo': 0, 'Twilight Shroud': 0, 'Flash': -1, 'Abandon': 0, 'Boots of Swiftness': -1,
  'The Good Stuff': -1, 'Rebuke': -2, 'Star-Crossed': -2, 'Astral Heron': -4,
};
const HAND_VALUE: Record<string, number> = { ...KEEP, 'Astral Heron': 3, 'Defy': 3, 'Defiant Dance': 3, 'Not So Fast': 2.5, 'Irelia': 6 };
const REACTIONS = ['Defy', 'Not So Fast', 'Defiant Dance', 'Discipline', 'En Garde', 'Gust', 'Abandon', 'Star-Crossed', 'Flash'];

const ireliaOnBoard = (ctx: PlanCtx) => ctx.board.find(c => c.name === 'Irelia' && (c.zone === 'battlefield' || c.zone === 'base'));
/**
 * Blade Dancer's "ready the chosen unit" ([A] + exhaust the legend): worth it when the unit can attack again this turn
 * (our turn, exhausted, a battlefield we don't control), or for Irelia's +1 in a fight. The chosen unit is a target of
 * our top chain item. Returns the yes-score (value minus the rune's cost).
 */
function readyWorth(ctx: PlanCtx): number {
  const late = ctx.runeDeckSize <= 2;
  const price = late ? 0.4 : 1.8;
  const top = [...ctx.g.chain].reverse().find(c => c.controller === ctx.me);
  const ids = (top?.targets ?? []).flat().filter(id => ctx.g.objects[id]?.controller === ctx.me);
  let best = -1;
  for (const id of ids) {
    const u = ctx.info(id);
    if (!u || u.type !== 'Unit' || (u.zone !== 'base' && u.zone !== 'battlefield')) continue;
    let v = 0;
    if (u.name === 'Irelia' && fighting(ctx)) v += 1.5;
    if (ctx.myTurn && u.exhausted && !fighting(ctx) && ctx.g.battlefields.some((b, i) => b.controller !== ctx.me && !(u.zone === 'battlefield' && u.battlefield === i))) v += 3 + u.might * 0.3;
    best = Math.max(best, v);
  }
  return best - price;
}

export const plan: DeckPlan = {
  id: 'irelia',
  legends: ['Irelia'],
  author: 'PILOT-B 2026-11-26',

  mulligan: (hand) => mulliganTable(KEEP, hand),

  prior: (a, card, d, ctx) => {
    if (mainPhase(d) && a.type === 'playCard' && card) {
      // a cheap spell on an exhausted unit in the main phase is the legend's ready line (Discipline also draws)
      const readyLine = !ctx.legend.exhausted && ctx.board.some(c => c.type === 'Unit' && c.exhausted) && ['Discipline', 'En Garde', 'Defiant Dance'].includes(card.name);
      const pp = pumpPrior(card, ctx); if (pp !== undefined && !readyLine) return pp;
      if (card.name === 'Irelia') return ctx.readyRunes >= 6 ? 3 : 1.5;        // with mana left for protection
      if (card.name === 'Guardian Angel' && ireliaOnBoard(ctx)) return 2;
      if (card.name === 'Find Your Center') return 1;
    }
    if (mainPhase(d) && a.type === 'hide') return 1.5;
    if (mainPhase(d) && a.type === 'move' && card?.name === 'Irelia' && a.to !== 'base') return 1;
    return undefined;
  },

  target: (opt, id, d, ctx) => {
    const p = d.prompt;
    const ht = harmTarget(opt, d, ctx); if (ht !== undefined) return ht;
    if (/Pay \[1\] to ready Blade Dancer/.test(p)) return yesNo(id, ctx.hand.length ? 4 : 1);
    if (/Exhaust Blade Dancer and pay \[A\] to ready that unit/.test(p)) {
      return yesNo(id, readyWorth(ctx));
    }
    if (/Equip Guardian Angel|Equip Boots|Equip Edge|Attach Edge of Night/.test(p) && opt) return opt.name === 'Irelia' ? 5 : opt.might * 0.3;
    const pt = pumpTarget(opt, d, ctx);
    if (pt !== undefined) return pt + (pt > 0 && opt?.name === 'Irelia' ? 1.5 : 0);   // +1 more on Irelia (and the legend may ready her)
    if (/Targon's Peak/.test(p)) return 2;
    if (/Abandoned Hall/.test(p) && opt) return opt.controller === ctx.me ? 2 : -2;
    if (/Sunken Temple/.test(p)) return yesNo(id, 3);
    if (/Swap the Mights/.test(p) && opt) return opt.controller === ctx.me ? 4 - opt.might : opt.might;
    if (/swap|choose a unit you control at another location/i.test(p) && opt && opt.name === 'Irelia') return 2;
    if (isDiscardPrompt(d) && opt && opt.controller === ctx.me) return -keepValue(opt, HAND_VALUE, ctx);
    return undefined;
  },

  respond: (a, card, d, ctx) => {
    if (a.type === 'pass') return undefined;
    const n = actName(card);
    if (['Defy', 'Not So Fast', 'Abandon'].includes(n)) return chainThreat(ctx, ['Irelia', 'Astral Heron', 'Vex']) >= 3 ? (ireliaOnBoard(ctx) ? 5 : 3) : -1;
    if (card?.zone === 'facedown') return fighting(ctx, card.battlefield) ? 3 : -1;
    if (['Defiant Dance', 'Discipline', 'En Garde', 'Gust', 'Star-Crossed', 'Flash', 'Switcheroo', 'Ride the Wind', 'Rebuke', 'Twilight Shroud'].includes(n))
      return fighting(ctx) || oppOnChain(ctx) ? 2.5 : -0.5;
    return undefined;
  },

  hide: {
    hideValue: (c, bf, ctx) => {
      if (!isHidden(c)) return 0;
      if (c.name === 'Tideturner') return 2.6;
      if (c.name === 'Switcheroo') return 3;
      if (c.name === 'Edge of Night') return 2.4;
      void bf; void ctx;
      return 1.5;
    },
  },

  resources: {
    reserve: ctx => {
      const r = reserveFor(ctx, REACTIONS, ireliaOnBoard(ctx) ? 2.5 : 1.5);
      return r;
    },
    recycleCost: (forCard, ctx) => (ctx.runeDeckSize <= 2 ? 0.2 : forCard?.name === 'Irelia' ? 0.5 : 1),
  },

  eval: {
    // holding is the plan (and the core projection over-rates retreating a lone holder: docs/ai-requests.md)
    weights: { ctl: 2 },
    bonus: ctx => extraTurnBonus(ctx),
    cardValue: (c, ctx) => {
      if (c.name === 'Irelia' && (c.zone === 'battlefield' || c.zone === 'base')) return 2 + c.attachments.length * 0.8;
      // Guardian Angel saves its bearer once (kill this instead, heal, recall): worth more than its +1
      if (c.name === 'Guardian Angel' && c.attachedTo) return ctx.info(c.attachedTo)?.name === 'Irelia' ? 3 : 1.5;
      if (c.name === 'Vex' && c.zone === 'battlefield') return 2.5;
      void ctx; void cost;
      return undefined;
    },
  },
};

// PILOT-B plan for Kennen, Heart of the Tempest (11-kennen). Game plan + sources: docs/ai-pilots/kennen.md.
// Engine: play cards from anywhere but the hand (champion zone, facedown, trash via Flow / Fizz / Matriarch) to empower
// the legend, spend it as Assault 2 on the attacker; Seal of Discord pays the power costs.
import type { DeckPlan, PlanCtx } from './types.ts';
import { harmTarget, extraTurnBonus, chainThreat, isHidden, cost, mainPhase, oppOnChain, fighting, yesNo, mulliganTable, keepValue, isDiscardPrompt, actName, reserveFor, isUnit } from './vex.ts';

const KEEP: Record<string, number> = {
  'Trifarian Captain': 4, 'Seal of Discord': 4, 'Bedeviling Stranger': 3, 'Tideturner': 3, 'Traveling Merchant': 3, 'Lightning Rush': 3,
  'Tornado Warrior': 3, 'Reckless Innovator': 3, 'Fizz': 1, 'Gust': 1, 'Edge of Night': 1, 'Switcheroo': 0, 'Ride the Wind': 0,
  'Tail-Cloaked Matriarch': 0, 'Deathgrip': -1, 'Hard Bargain': -1, 'Last Rites': -2, 'Star-Crossed': -2, 'Kharox': -5,
};
const HAND_VALUE: Record<string, number> = { ...KEEP, 'Kharox': 2.5, 'Tail-Cloaked Matriarch': 3, 'Ride the Wind': 2.5, 'Star-Crossed': 2.5, 'Kennen': 6 };
const REACTIONS = ['Gust', 'Hard Bargain', 'Deathgrip', 'Star-Crossed'];

const empowered = (ctx: PlanCtx) => !!ctx.g.objects[ctx.legend.obj]?.empowered;
const units = (ctx: PlanCtx) => ctx.board.filter(c => isUnit(c) && (c.zone === 'base' || c.zone === 'battlefield'));

export const plan: DeckPlan = {
  id: 'kennen',
  legends: ['Kennen', 'ven-155-166'],   // the legend's first tag is 'Yordle' (legendKey), so register its card id too
  author: 'PILOT-B 2026-11-26',

  mulligan: (hand) => mulliganTable(KEEP, hand),

  prior: (a, card, d, ctx) => {
    if (!mainPhase(d)) return undefined;
    if (a.type === 'playCard' && card) {
      if (card.zone === 'facedown' || card.zone === 'trash' || card.zone === 'championZone') return empowered(ctx) ? 1.5 : 3.5;   // empowers the legend
      if (card.name === 'Seal of Discord') return ctx.turn <= 6 ? 3 : 1;
      if (card.name === 'Lightning Rush') return 1.5;
      if (card.name === 'Trifarian Captain') return 1;
    }
    if (a.type === 'hide') return 2;
    // Assault 2 only matters for an attacker: use it in the showdown of our attack (respond), not in the main phase
    if (a.type === 'activate' && card?.obj === ctx.legend.obj) return -4;
    if (a.type === 'activate' && card?.name === 'Tail-Cloaked Matriarch') return ctx.g.players[ctx.me].trash.length ? 1.5 : -2;
    return undefined;
  },

  target: (opt, id, d, ctx) => {
    const p = d.prompt;
    const ht = harmTarget(opt, d, ctx); if (ht !== undefined) return ht;
    if (/Give a unit \[Assault 2\]/.test(p) && opt) {
      if (opt.controller !== ctx.me) return -10;
      // the attacker (Assault only counts while attacking)
      return ctx.g.ex.combat?.attackers.includes(opt.obj) ? 6 + opt.might * 0.2 : -6;
    }
    if (/You may choose a card and draw it/.test(p) && opt) {
      // Lightning Rush: take the best card (units / Seals early), the rest is trash fuel
      const early = ctx.runes <= 5;
      return (HAND_VALUE[opt.name] ?? 2) + (early && cost(opt) <= 3 ? 1 : 0) + (opt.name === 'Lightning Rush' ? -1.5 : 0);
    }
    if (/Give a spell in your trash \[Flow\]/.test(p) && opt) {
      const castable = cost(opt) <= ctx.readyRunes ? 2 : -1;
      return castable + (({ 'Ride the Wind': 3, 'Star-Crossed': 2.5, 'Switcheroo': 2, 'Lightning Rush': 1.5, 'Gust': 1.5 } as Record<string, number>)[opt.name] ?? 0);
    }
    if (/Matriarch: play a unit from your trash/.test(p)) return yesNo(id, 5);
    if (/Choose a unit in your trash/.test(p) && opt) return cost(opt) + (opt.name === 'Trifarian Captain' ? 1 : 0) + (isHidden(opt) ? 0.3 : 0);
    if (/play a spell .* from your trash/.test(p) && opt) return ({ 'Lightning Rush': 3, 'Gust': 2, 'Switcheroo': 2, 'Ride the Wind': 2.5, 'Deathgrip': 1, 'Hard Bargain': 0.5 } as Record<string, number>)[opt.name] ?? 1;
    if (/Tornado Warrior: empower/.test(p)) return yesNo(id, 4);
    if (/Empower something here/.test(p) && opt) return opt.controller !== ctx.me ? -8 : opt.name === 'Tail-Cloaked Matriarch' ? 8 : opt.name === 'Kharox' ? 7 : opt.obj === ctx.legend.obj ? 3 : 0;
    if (/Detach Edge of Night/.test(p)) return yesNo(id, -1);
    if (/Swap the Mights/.test(p) && opt) return opt.controller === ctx.me ? 4 - opt.might : opt.might;
    if (isDiscardPrompt(d) && opt && opt.controller === ctx.me) return -keepValue(opt, HAND_VALUE, ctx);
    return undefined;
  },

  respond: (a, card, d, ctx) => {
    if (a.type === 'pass') return undefined;
    const n = actName(card);
    // legend: Assault 2 to our attacker in the showdown of our attack
    if (a.type === 'activate' && card?.obj === ctx.legend.obj) {
      const c = ctx.g.ex.combat;
      return c && c.attackers.some(id => ctx.g.objects[id]?.controller === ctx.me) ? 5 : -1;
    }
    if (n === 'Hard Bargain') return chainThreat(ctx, ['Tail-Cloaked Matriarch']) >= 3.5 ? 3.5 : -1;
    if (card?.zone === 'facedown') return fighting(ctx, card.battlefield) ? 3 : -1;
    if (['Gust', 'Star-Crossed', 'Deathgrip', 'Switcheroo', 'Ride the Wind'].includes(n)) return fighting(ctx) || oppOnChain(ctx) ? 2 : -0.5;
    return undefined;
  },

  hide: {
    hideValue: (c, bf, ctx) => {
      if (!isHidden(c)) return 0;
      const hidTurn = ctx.g.objects[c.obj]?.hiddenTurn;
      if (c.zone === 'facedown' && ctx.myTurn && hidTurn !== undefined && hidTurn < ctx.turn && !empowered(ctx)) return 0.5;   // play it now: empower
      // free card + an empower next turn; one hide per turn is plenty while runes are short (each hide recycles a rune)
      let v = 2 + Math.min(3, c.energy) * 0.3;
      if (ctx.board.some(b => b.zone === 'facedown' && b.battlefield !== bf)) v -= 0.8;
      if (c.name === 'Tornado Warrior' && ctx.unitsAt(bf, 'me').some(u => u.name === 'Tail-Cloaked Matriarch')) v += 1.5;
      if (ctx.board.some(b => b.name === 'Seal of Discord' && !b.exhausted)) v += 0.6;   // Seal pays the [A]
      return v;
    },
  },

  resources: {
    reserve: ctx => reserveFor(ctx, REACTIONS, 1.2),
    // every [A]/[C] spend recycles a rune: early that delays the whole curve (seen: 5 runes on turn 10)
    recycleCost: (forCard, ctx) => (ctx.runeDeckSize <= 2 ? 0.2 : forCard?.name === 'Kennen' ? 0.3 : ctx.runes <= 5 ? 2.2 : 1.5),
  },

  eval: {
    // holding is the plan (and the core projection over-rates retreating a lone holder: docs/ai-requests.md)
    weights: { ctl: 4 },
    bonus: ctx => extraTurnBonus(ctx),
    cardValue: (c, ctx) => {
      if (c.obj === ctx.legend.obj) return empowered(ctx) ? (ctx.g.ex.combat ? 1.5 : 4) : 0;   // keep the Assault for an attack
      if (c.name === 'Seal of Discord' && c.zone !== 'hand') return 1.2;
      return undefined;
    },
  },
};

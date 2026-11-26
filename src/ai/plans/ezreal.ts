// PILOT-B plan for Ezreal, Prodigal Explorer (12-ezreal). Game plan + sources: docs/ai-pilots/ezreal.md.
// Removal-control: trade cheap removal for their units, draw with the legend after two enemy choices per turn, win with
// Thousand-Tailed Watcher (+Bellows Breath), Fizz recasting Wages of Pain, Temporal Breach replaying Watcher.
import type { DeckPlan, PlanCtx } from './types.ts';
import { harmTarget, extraTurnBonus, chainThreat, cost, mainPhase, oppOnChain, fighting, yesNo, mulliganTable, keepValue, isDiscardPrompt, actName, reserveFor, isHidden } from './vex.ts';

const KEEP: Record<string, number> = {
  'Stupefy': 4, 'Wages of Pain': 4, 'Bellows Breath': 3, 'Gust': 3, 'Bewitching Spirit': 3, 'Fizz': 3, 'Deadly Flourish': 2,
  'Pack of Wonders': 1, 'Hard Bargain': 1, 'The List': 0, 'Vex': 1, 'The Good Stuff': 0, 'Treasure Trove': -1, 'Sprite Fountain': -1,
  'Temporal Breach': -1, 'Star-Crossed': -1, 'Thousand-Tailed Watcher': -2, 'Singularity': -4,
};
const HAND_VALUE: Record<string, number> = { ...KEEP, 'Thousand-Tailed Watcher': 5, 'Singularity': 3, 'Temporal Breach': 2.5, 'Star-Crossed': 2.5, 'Ezreal': 5 };
const REACTIONS = ['Stupefy', 'Gust', 'Hard Bargain', 'Star-Crossed'];
const REMOVAL = new Set(['Wages of Pain', 'Deadly Flourish', 'Bellows Breath', 'Stupefy', 'Singularity', 'Gust', 'Star-Crossed']);

const watcherOnBoard = (ctx: PlanCtx) => ctx.board.some(c => c.name === 'Thousand-Tailed Watcher' && c.zone !== 'hand');

export const plan: DeckPlan = {
  id: 'ezreal',
  legends: ['Ezreal'],
  author: 'PILOT-B 2026-11-26',

  mulligan: (hand) => mulliganTable(KEEP, hand),

  prior: (a, card, d, ctx) => {
    // the legend draw (Reaction speed, only legal after two enemy choices this turn): always take it
    if (a.type === 'activate' && card?.obj === ctx.legend.obj) return 6;
    if (!mainPhase(d)) return undefined;
    if (a.type === 'playCard' && card) {
      if (card.name === 'Ezreal' && card.zone === 'championZone') return 2;
      if (card.name === 'Thousand-Tailed Watcher') return ctx.oppBoard.some(c => c.type === 'Unit') ? 2 : 0.5;
      if (card.name === 'Temporal Breach') return watcherOnBoard(ctx) ? 2 : ctx.oppBoard.some(c => c.attachments.length > 0) ? 0 : -5;
      // develop bodies early: the deck needs units to contest battlefields while removal trades
      if ((card.name === 'Bewitching Spirit' || card.name === 'Fizz' || card.name === 'Vex') && ctx.turn <= 10) return 2;
      if (card.name === 'Bellows Breath') return ctx.oppBoard.filter(c => c.type === 'Unit').length >= 2 ? 1 : -2;
      if (card.name === 'Treasure Trove') return 0.5;
    }
    if (a.type === 'hide') return 1.5;
    if (a.type === 'activate' && card?.name === 'Pack of Wonders') return 0.5;
    return undefined;
  },

  target: (opt, id, d, ctx) => {
    const p = d.prompt;
    const ht = harmTarget(opt, d, ctx); if (ht !== undefined) return ht;
    if (/Deal 1 to up to three units/.test(p) && opt) {
      if (opt.controller === ctx.me) return -10;
      const dmg = ctx.g.objects[opt.obj]?.damage ?? 0;
      return 1 + (opt.might - dmg <= 1 ? 4 : 0);           // kills (Watcher's -3 puts units at 1)
    }
    if (/Repeat\?/.test(p) && d.source && /Bellows/.test(ctx.info(d.source)?.name ?? '')) return yesNo(id, ctx.runeDeckSize <= 2 ? 0.5 : -1.5);
    if (/Pay .*Repeat|repeat/i.test(p) && /Bellows/.test(p)) return undefined;
    if (/Banish a unit, then its owner plays it/.test(p) && opt) {
      if (opt.controller === ctx.me) return opt.name === 'Thousand-Tailed Watcher' ? 8 : opt.name === 'Bewitching Spirit' || opt.name === 'Ezreal' ? 3 : -1;
      return opt.attachments.length * 2 + (opt.might > (ctx.g.cards[opt.cardId]?.might ?? 0) ? 2 : -1);
    }
    if (/play a spell .* from your trash/.test(p) && opt) return ({ 'Wages of Pain': 4, 'Bellows Breath': 3, 'Stupefy': 2, 'Gust': 2, 'Hard Bargain': 1, 'Temporal Breach': 1.5 } as Record<string, number>)[opt.name] ?? 0.5;
    if (/Return another friendly gear|Return another friendly/.test(p) && opt) {
      // Pack of Wonders: rebuy a value body / Treasure Trove (leaves the board: draw + rune)
      return ({ 'Treasure Trove': 5, 'Fizz': 3, 'Bewitching Spirit': 3, 'Ezreal': 2.5, 'Thousand-Tailed Watcher': 2, 'The Good Stuff': 1 } as Record<string, number>)[opt.name] ?? -1;
    }
    if (/choose a player|Choose a player/.test(p)) return id === String(ctx.opp) || (opt && opt.controller === ctx.opp) ? 5 : -5;   // Bewitching Spirit
    if (/Accelerate/.test(p) && d.source && ctx.info(d.source)?.name === 'Thousand-Tailed Watcher') return undefined;
    if (isDiscardPrompt(d) && opt && opt.controller === ctx.me) return -keepValue(opt, HAND_VALUE, ctx);
    return undefined;
  },

  respond: (a, card, d, ctx) => {
    if (a.type === 'pass') return undefined;
    if (a.type === 'activate' && card?.obj === ctx.legend.obj) return 6;
    const n = actName(card);
    if (n === 'Hard Bargain') return chainThreat(ctx, ['Thousand-Tailed Watcher']) >= 3.5 ? 3.5 : -1;
    if (card?.zone === 'facedown') return fighting(ctx, card.battlefield) || oppOnChain(ctx) ? 2.5 : -1;
    if (REMOVAL.has(n) || n === 'Switcheroo') return fighting(ctx) || oppOnChain(ctx) ? 2.5 : 0;
    return undefined;
  },

  hide: {
    hideValue: (c, bf, ctx) => {
      if (!isHidden(c)) return 0;
      void bf;
      if (c.name === 'Wages of Pain') return 2.8;
      if (c.name === 'Temporal Breach') return watcherOnBoard(ctx) ? 3 : 1.5;
      return 1.5;
    },
  },

  resources: {
    reserve: ctx => reserveFor(ctx, REACTIONS, 1.8),
    // a recycled rune delays the curve while the rune deck lasts: spend power only on the cards that need it
    // (seen: two Fizz + a hide in one turn took the deck from 4 runes to 1 on turn 9 while the opponent had 7-9)
    recycleCost: (forCard, ctx) => ctx.runeDeckSize <= 2 ? 0.2
      : forCard && ['Thousand-Tailed Watcher', 'Singularity'].includes(forCard.name) ? 0.5
      : ctx.runes <= 5 ? 2.6 : 1.8,
  },

  eval: {
    // holding is the plan (and the core projection over-rates retreating a lone holder: docs/ai-requests.md)
    weights: { ctl: 2 },
    bonus: ctx => extraTurnBonus(ctx),
    cardValue: (c, ctx) => {
      if (c.name === 'Thousand-Tailed Watcher' && c.zone === 'hand') return 1;
      if (c.name === 'Treasure Trove' && c.zone !== 'hand') return 1;
      void ctx; void cost; void yesNo;
      return undefined;
    },
  },
};

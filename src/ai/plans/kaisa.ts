// PILOT-A: deck plan for Kai'Sa, Daughter of the Void (06/07/18/23-kai-sa). Game plan + sources: docs/ai-pilots/kaisa.md.
// Fury/Mind spell control: cheap units contest early, removal (Hextech Ray, Falling Star, Void Seeker, Bellows Breath)
// trades for their key units, the legend's spell-only [A] pays one power per turn cycle instead of a rune, Thousand-Tailed
// Watcher (-3 to every enemy) swings a battlefield, Time Warp closes at 6+ points.
import type { Action, Decision } from '../../engine/types.ts';
import type { CardInfo, DeckPlan, PlanCtx } from './types.ts';

const CHEAP_UNITS = new Set(['Plundering Poro', 'Watchful Sentry', 'Lecturing Yordle', 'Bilgewater Tracker', 'Card Sharp']);
const REMOVAL = new Set(['Hextech Ray', 'Falling Star', 'Void Seeker', 'Bellows Breath', 'Get Excited!', 'Lost to the Sands', 'Sky Splitter', 'Singularity', 'Icathian Rain']);
const REACTIONS = new Set(['Stupefy', 'Smoke Screen']);
const ACTIONS = new Set(['Hextech Ray', 'Void Seeker', 'Bellows Breath', 'Get Excited!', 'Lost to the Sands', 'Sky Splitter']);
const BIG = new Set(['Time Warp', 'The Empyrean', 'Thousand-Tailed Watcher', 'Singularity', 'Icathian Rain', 'Sky Splitter', 'Ferrous Forerunner']);

const isKaisa = (c: CardInfo | null | undefined) => !!c && c.type === 'Unit' && c.tags.includes("Kai'Sa");
const spellWithPower = (c: CardInfo) => c.type === 'Spell' && c.power >= 1;
const heldBattlefields = (ctx: PlanCtx) => ctx.battlefields.filter((_, i) => ctx.controllerOf(i) === ctx.me).length;
const enemyUnitsOnBf = (ctx: PlanCtx) => ctx.oppBoard.filter(c => c.type === 'Unit' && c.zone === 'battlefield').length;
const voidGateAt = (ctx: PlanCtx, bf: number | undefined) => bf !== undefined && ctx.battlefields[bf] === 'Void Gate';

/** Damage a "Deal N" prompt deals to this option (Void Gate +1). */
export function dmgFromPrompt(d: Decision, opt: CardInfo | null, ctx: PlanCtx): number | null {
  const m = /Deal (\d+)/i.exec(d.prompt);
  if (!m) return null;
  return +m[1] + (opt && opt.zone === 'battlefield' && voidGateAt(ctx, opt.battlefield) ? 1 : 0);
}

/**
 * Objects I already chose earlier in the same play (multi-target spells such as Falling Star "Deal 3 to a unit (2 of 2)"),
 * from the core's ctx.chosenThisPlay.
 */
export function chosenEarlier(ctx: PlanCtx): string[] {
  return ctx.chosenThisPlay ?? [];
}

/** Value of hitting an enemy unit with `dmg` damage: a kill is worth the unit, chip damage little. */
export function damageTargetScore(opt: CardInfo, dmg: number, ctx: PlanCtx, d?: Decision): number {
  if (opt.controller === ctx.me) return -4 - opt.might;
  // a second instance on a unit the first instance already kills is wasted (same damage per instance assumed)
  const prior = d && /\(\d+ of \d+\)/.test(d.prompt) ? chosenEarlier(ctx).filter(x => x === opt.obj).length : 0;
  const left = Math.max(0, opt.might - prior * dmg - (ctx.g.objects[opt.obj]?.damage ?? 0));
  if (prior && left <= 0) return -2;
  const kill = left <= dmg;
  const worth = 1 + opt.might * 0.8 + (opt.energy + opt.power) * 0.3 + (opt.champion ? 2 : 0) + (opt.zone === 'battlefield' ? 1 : 0) + opt.attachments.length;
  return kill ? worth : 0.2 * Math.min(dmg, opt.might);
}

function mulligan(hand: CardInfo[]): Record<string, number | undefined> {
  const out: Record<string, number> = {};
  const cheap = hand.filter(c => CHEAP_UNITS.has(c.name)).length;
  let star = 0;
  for (const c of hand) {
    let s = 0.5;
    if (CHEAP_UNITS.has(c.name)) s = 4;
    else if (c.name === 'Hextech Ray' || c.name === 'Stupefy') s = 3;
    else if (c.name === 'Falling Star') s = ++star === 1 ? 2 : -0.5;
    else if (c.name === 'Noxus Hopeful') s = cheap ? 2 : 0.5;
    else if (isKaisa(c)) s = 1.5;
    else if (c.name === 'Smoke Screen' || c.name === 'Bellows Breath' || c.name === 'Void Seeker') s = 1;
    else if (BIG.has(c.name)) s = c.name === 'Thousand-Tailed Watcher' && !hand.some(x => x !== c && x.name === c.name) ? -1 : -3;
    out[c.obj] = s;
  }
  return out;
}

function prior(a: Action, card: CardInfo | null, d: Decision, ctx: PlanCtx): number | undefined {
  if (a.type === 'activate' && card && card.obj === ctx.legend.obj) {
    // the spell-only [A]: worth it only right before a spell with a power cost we can cast now
    const castable = ctx.hand.some(c => spellWithPower(c) && c.energy <= ctx.readyRunes);
    return castable ? 4 : -6;
  }
  if (a.type === 'playCard' && card && !d.inStep) {
    if (card.name === 'Noxus Hopeful') return ctx.playedThisTurn.length ? 3 : -3;
    if (card.name === 'Time Warp') return ctx.myPoints >= 5 || heldBattlefields(ctx) >= 2 ? 6 : -4;
    if (card.name === 'Thousand-Tailed Watcher') return enemyUnitsOnBf(ctx) ? 4 : 1;
    if (CHEAP_UNITS.has(card.name)) return ctx.turn <= 8 ? 2 : 0.5;
    if (isKaisa(card)) return 2;
    if (card.name === 'Sky Splitter') return Math.max(...ctx.board.filter(c => c.type === 'Unit').map(c => c.might), 0) >= 5 ? 2 : -3;
  }
  if (a.type === 'choose' && d.inStep && /Accelerate/i.test(d.prompt)) return a.optionIds.includes('yes') ? -0.5 : 0;
  return undefined;
}

function target(opt: CardInfo | null, _id: string, d: Decision, ctx: PlanCtx): number | undefined {
  if (!opt || opt.type !== 'Unit') return undefined;
  const dmg = dmgFromPrompt(d, opt, ctx);
  if (dmg !== null && d.hint !== 'help') return damageTargetScore(opt, dmg, ctx, d);
  if (/-4|-1 \[S\]|-1 \[M\]/.test(d.prompt) && opt.controller !== ctx.me) return 1 + opt.might * 0.5;
  if (/Banish a unit, then its owner plays it/i.test(d.prompt)) {
    // Temporal Breach: own unit with a play effect (Watcher / Empyrean / Tracker) or an enemy at Rockfall Path
    if (opt.controller === ctx.me) return ['Thousand-Tailed Watcher', 'The Empyrean', 'Bilgewater Tracker', 'Lecturing Yordle'].includes(opt.name) ? 4 : -2;
    return opt.zone === 'battlefield' && ctx.battlefields[opt.battlefield ?? -1] === 'Rockfall Path' ? 3 + opt.might : -1;
  }
  return undefined;
}

function respond(a: Action, card: CardInfo | null, d: Decision, ctx: PlanCtx): number | undefined {
  if (a.type === 'activate' && card && card.obj === ctx.legend.obj) {
    const castable = ctx.hand.some(c => spellWithPower(c) && (REACTIONS.has(c.name) || (d.kind === 'showdownAction' && ACTIONS.has(c.name))) && c.energy <= ctx.readyRunes);
    return castable ? 2 : -5;
  }
  if (a.type !== 'playCard' || !card) return undefined;
  if (REACTIONS.has(card.name) || ACTIONS.has(card.name)) return d.kind === 'showdownAction' ? 2.5 : 1;
  if (card.name === 'Temporal Breach' && card.zone === 'facedown') return 2;
  return undefined;
}

const kaisaPlayable = (ctx: PlanCtx) => ctx.g.players[ctx.me].championZone.length > 0 || ctx.count(c => isKaisa(c), 'hand') > 0;
const killValue = (_a: Action, c: CardInfo | null) => c ? (REMOVAL.has(c.name) ? 2 : 0) + c.power : 0;

export const plan: DeckPlan = {
  id: 'kaisa',
  legends: ["Kai'Sa"],
  author: 'PILOT-A 2026-11-26',
  mulligan,
  prior,
  target,
  respond,
  combos: [
    {
      name: 'legend [A] -> a spell with a power cost',
      when: ctx => ctx.myTurn && !ctx.legend.exhausted && ctx.hand.some(c => spellWithPower(c)),
      steps: [
        { do: 'activate', card: 'legend' },
        { do: 'play', card: (c: CardInfo) => spellWithPower(c), score: killValue },
      ],
    },
    {
      name: 'Watcher (-3) -> attack',
      when: ctx => ctx.myTurn && ctx.count('Thousand-Tailed Watcher', 'hand') > 0 && enemyUnitsOnBf(ctx) > 0,
      steps: [
        { do: 'play', card: 'Thousand-Tailed Watcher' },
        { do: 'move', to: 'battlefield', units: 'ready', card: (c: CardInfo) => c.type === 'Unit' && !c.exhausted },
      ],
    },
    {
      name: 'cheap card -> Noxus Hopeful (Legion)',
      when: ctx => ctx.myTurn && ctx.count('Noxus Hopeful', 'hand') > 0 && !ctx.playedThisTurn.length,
      steps: [
        { do: 'play', card: (c: CardInfo) => c.name !== 'Noxus Hopeful' && c.energy <= 2 && c.type !== 'Spell' || c.name === 'Stupefy' },
        { do: 'play', card: 'Noxus Hopeful' },
      ],
    },
    {
      name: 'legend [A] -> Time Warp',
      when: ctx => ctx.myTurn && !ctx.legend.exhausted && ctx.count('Time Warp', 'hand') > 0 && (ctx.myPoints >= 5 || heldBattlefields(ctx) >= 1),
      steps: [
        { do: 'activate', card: 'legend' },
        { do: 'play', card: 'Time Warp' },
      ],
    },
    // Accelerate answers inside plain planner moves come from the engine bot (always pays): offer both versions
    {
      name: "Kai'Sa, Survivor without Accelerate",
      when: (ctx: PlanCtx) => ctx.myTurn && kaisaPlayable(ctx),
      steps: [{ do: 'play' as const, card: (c: CardInfo) => isKaisa(c) }],
      choices: [{ prompt: /Accelerate/i, kind: 'optional' as const, none: true }],
    },
    {
      name: "Kai'Sa, Survivor with Accelerate -> attack",
      when: (ctx: PlanCtx) => ctx.myTurn && kaisaPlayable(ctx) && ctx.readyRunes >= 6,
      steps: [{ do: 'play' as const, card: (c: CardInfo) => isKaisa(c), to: 'base' as const }, { do: 'move' as const, card: (c: CardInfo) => isKaisa(c), to: 'battlefield' as const }],
      choices: [{ prompt: /Accelerate/i, kind: 'optional' as const, pick: () => 1 }],
    },
  ],
  resources: {
    runeValue: 1.4,
    recycleCost: (forCard, ctx) => {
      if (ctx.runeDeckSize <= 1) return 0;
      if (!forCard) return 0.8;
      if (forCard.type === 'Spell') return REMOVAL.has(forCard.name) ? 0.2 : 0.5;
      if (forCard.type === 'Unit') return isKaisa(forCard) || forCard.name === 'Thousand-Tailed Watcher' ? 1.0 : 0.6;
      return 0.6;
    },
    reserve: ctx => {
      const r = ctx.hand.filter(c => REACTIONS.has(c.name) || c.name === 'Hextech Ray' || c.name === 'Void Seeker');
      if (!r.length) return undefined;
      return { energy: Math.min(...r.map(c => c.energy)), value: 1.2, forCards: r.map(c => c.name) };
    },
  },
  hide: {
    never: ['Time Warp', 'Falling Star', 'Hextech Ray', 'Stupefy', 'Smoke Screen'],
    hideValue: (c, bf, ctx) => c.name === 'Temporal Breach' && ctx.controllerOf(bf) === ctx.me ? (ctx.battlefields[bf] === 'Rockfall Path' ? 2.5 : 1.5) : 0,
  },
  eval: {
    cardValue: (c, ctx) => {
      if (c.zone === 'hand') {
        if (c.name === 'Time Warp') return ctx.myPoints >= 5 ? 2 : -0.5;
        if (c.name === 'Thousand-Tailed Watcher') return 0.8;
        return undefined;
      }
      if (c.obj === ctx.legend.obj && !c.exhausted && ctx.myTurn && ctx.hand.some(h => spellWithPower(h) && (REACTIONS.has(h.name) || ACTIONS.has(h.name)))) return 0.6;
      if (isKaisa(c) && c.zone === 'battlefield') return 0.8;      // conquers draw
      return undefined;
    },
  },
};

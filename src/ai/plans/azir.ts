// PILOT-A: deck plan for Azir, Emperor of the Sands (01/08/10/14-azir). Game plan + sources: docs/ai-pilots/azir.md.
// Core idea: exactly one Equipment per turn -> legend [1],[T] Sand Soldier -> Weaponmaster picks up an UNATTACHED
// Equipment -> Soldiers contest both battlefields; Azir, Sovereign attacks pulling every token in; Arise! with 3+
// Equipment; Guards! / Hidden Blade / Back Off hidden at a battlefield we hold; Defy kept open. Power ([C]) recycles a
// rune, so [C] is only spent when it buys board now (early) and freely once the rune deck is empty (late).
import type { Action, Decision } from '../../engine/types.ts';
import type { CardInfo, DeckPlan, PlanCtx } from './types.ts';

const isEquip = (c: CardInfo | null | undefined) => !!c && c.type === 'Gear' && c.tags.includes('Equipment');
const isSoldier = (c: CardInfo | null | undefined) => !!c && c.name === 'Sand Soldier';
const isAzir = (c: CardInfo | null | undefined) => !!c && c.type === 'Unit' && c.tags.includes('Azir');
const isMine = (c: CardInfo | null | undefined, ctx: PlanCtx) => !!c && c.controller === ctx.me;
const HIDDEN = ['Guards!', 'Hidden Blade', 'Back Off', 'Kennen'];

/** Equipment value as a Weaponmaster / Equip pickup (Might it adds, plus keyword value). */
function equipWorth(name: string, ctx: PlanCtx): number {
  switch (name) {
    case 'B.F. Sword': return 4.5;
    case 'Brutalizer': return 2.2;                       // its +2 only counts the turn it is attached: a fresh (exhausted) Soldier can't use it
    case "Doran's Shield": return 3;                      // +1 and Tank
    case 'Hand Hammer': return 2.5;
    case 'Soul Sword': return 2.2;
    case 'Eye of the Herald': return 1.6;                 // +0, Recruit when its bearer moves
    default: return 1.5;
  }
}

const equipmentPlayedThisTurn = (ctx: PlanCtx) => ctx.playedThisTurn.some(n => EQUIP_NAMES.has(n));
const EQUIP_NAMES = new Set(["Doran's Shield", 'Eye of the Herald', 'Soul Sword', 'Brutalizer', 'Hand Hammer', 'B.F. Sword']);
const equipCount = (ctx: PlanCtx) => ctx.count(c => isEquip(c));
const freeEquipCount = (ctx: PlanCtx) => ctx.count(c => isEquip(c) && !c.attachedTo);
/** recycling is ~free once the rune deck is (nearly) empty: the rune comes back with the next channel */
const lateRunes = (ctx: PlanCtx) => ctx.runeDeckSize <= 1;
const legendReady = (ctx: PlanCtx) => !ctx.legend.exhausted;

/** an enemy unit worth a Hidden Blade (it draws them 2): 4+ Might, a champion, or 2+ Equipment/buffs */
const bigEnemy = (ctx: PlanCtx) => ctx.oppBoard.some(c => c.type === 'Unit' && c.zone === 'battlefield' && (c.might >= 4 || c.champion));

function enemyCanContest(ctx: PlanCtx, bf: number): boolean {
  // the opponent has units at this battlefield or units at base (mobile next turn)
  return ctx.unitsAt(bf, 'opp').length > 0 || ctx.oppBoard.some(c => c.type === 'Unit' && c.zone === 'base');
}

// ------------------------------------------------------------------------------------------------ mulligan

function mulligan(hand: CardInfo[]): Record<string, number | undefined> {
  const out: Record<string, number> = {};
  const cheapEq = hand.filter(c => isEquip(c) && c.energy <= 1).length;
  const anyEq = hand.filter(isEquip).length;
  let arise = 0, guards = 0;
  for (const c of hand) {
    let s = 1;
    if (isEquip(c)) {
      s = c.energy <= 1 ? 5 : c.energy === 2 ? (cheapEq ? 3 : 2) : 0.5;   // any Equipment enables the legend; B.F. Sword is a fine turn-3/4 play
    } else if (c.name === 'Arise!') s = ++arise === 1 && anyEq >= 2 ? 0.5 : -3;
    else if (c.name === 'Guards!') s = ++guards === 1 ? 2 : -0.5;
    else if (c.name === 'Defy' || c.name === 'Discipline') s = 2.5;
    else if (c.name === 'Battle Preparations') s = anyEq ? 1.5 : -0.5;
    else if (isAzir(c)) s = anyEq ? 2 : -1;
    else if (c.name === 'Vi') s = -2;
    else if (c.name === 'Hidden Blade' || c.name === 'Back Off' || c.name === 'Deathgrip') s = cheapEq ? 0.8 : -1;
    else if (c.energy >= 5) s = -2;
    out[c.obj] = s;
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ priors

function prior(a: Action, card: CardInfo | null, d: Decision, ctx: PlanCtx): number | undefined {
  if (a.type === 'playCard' && card && !d.inStep && d.kind === 'mainAction') {
    if (isEquip(card)) {
      const playedEq = equipmentPlayedThisTurn(ctx);
      const eqLeftInHand = ctx.count(c => isEquip(c) && c.obj !== card.obj, 'hand');
      if (!playedEq) {
        // the legend trigger: cheapest Equipment first early, keep [1] for the Soldier
        let s = 6 - (ctx.runes <= 4 ? card.energy : 0);
        if (!legendReady(ctx)) s -= 4;
        if (card.name === 'B.F. Sword' && ctx.runes < 6) s -= 2;
        return s;
      }
      // second Equipment this turn: only worth it with spare energy and another Equipment kept for next turn
      return lateRunes(ctx) || eqLeftInHand >= 1 ? -1 : -4;
    }
    if (card.name === 'Arise!') return equipCount(ctx) >= 3 ? 6 + equipCount(ctx) : equipCount(ctx) <= 1 ? -20 : -8;   // Arise! for 1-2 Soldiers wastes the bomb
    if (isAzir(card)) return 3;
    if (card.name === 'Guards!' && ctx.myTurn) return -1;        // better hidden (free later) or held as a Reaction
    if (card.name === 'Back Off' && !ctx.oppBoard.some(c => c.type === 'Unit' && c.zone === 'battlefield')) return -4;   // a stun at base does nothing
  }
  if (a.type === 'activate' && card && card.obj === ctx.legend.obj && a.abilityIndex < 950) return 8;
  if (a.type === 'activate' && card && isEquip(card) && a.abilityIndex === 900) {
    // Equip [C]: moving an attached Equipment is churn
    if (card.attachedTo) return -8;
    return lateRunes(ctx) ? 1 : -0.5;
  }
  if (a.type === 'move' && card && isAzir(card) && typeof a.to === 'number') {
    const tokens = ctx.board.filter(c => c.isToken && c.type === 'Unit').length;
    return ctx.controllerOf(a.to) === ctx.me ? -2 : 3 + Math.min(4, tokens);
  }
  if (a.type === 'hide' && card) {
    if (card.name === 'Arise!' || isEquip(card)) return -10;
  }
  if (a.type === 'choose' && d.inStep) {
    const ids = a.optionIds;
    if (/Accelerate/i.test(d.prompt)) return ids.includes('yes') ? -1 : 0;      // search decides; don't pay [C] lightly
    if (/Guards!: pay \[C\]/i.test(d.prompt)) return ids.includes('yes') ? (ctx.myTurn ? 0.5 : -3) : 0;
    if (/Hall of Legends/i.test(d.prompt)) return ids.includes('yes') ? (equipmentPlayedThisTurn(ctx) ? 3 : -2) : 0;
  }
  return undefined;
}

// ------------------------------------------------------------------------------------------------ targets

/**
 * Equipment already chosen by another Weaponmaster trigger waiting on the chain (Arise! / several Soldiers at once: the
 * Equipment is chosen as each trigger goes on the chain, so every trigger would otherwise pick the same unattached
 * B.F. Sword and pass it along, paying [C] each time).
 */
function claimedByWeaponmaster(ctx: PlanCtx): Set<string> {
  const out = new Set<string>();
  for (const it of ctx.g.chain) {
    if (it.controller !== ctx.me || !/Weaponmaster/i.test(it.label ?? '')) continue;
    for (const ts of it.targets) for (const t of ts) out.add(t);
  }
  return out;
}

function weaponmasterPick(opt: CardInfo | null, id: string, ctx: PlanCtx): number {
  if (!opt || !isEquip(opt)) return -1;
  if (opt.attachedTo) return -10;                                     // never pull an Equipment off a unit using it
  if (claimedByWeaponmaster(ctx).has(id)) return -10;
  return equipWorth(opt.name, ctx);
}

function target(opt: CardInfo | null, id: string, d: Decision, ctx: PlanCtx): number | undefined {
  if (/Weaponmaster/i.test(d.prompt)) return opt && isEquip(opt) ? weaponmasterPick(opt, id, ctx) : undefined;
  if (/Move any number of your token units/i.test(d.prompt)) {
    if (!opt || !isMine(opt, ctx)) return undefined;
    if (opt.zone === 'battlefield' && opt.battlefield !== undefined && ctx.controllerOf(opt.battlefield) === ctx.me) {
      // the last defender of a battlefield we hold stays unless the attack needs it
      const others = ctx.unitsAt(opt.battlefield, 'me').filter(u => u.obj !== opt.obj).length;
      return others ? 2 : enemyCanContest(ctx, opt.battlefield) ? -1 : 1.5;
    }
    return 3 + opt.might * 0.3;
  }
  if (/Ready up to two of the Sand Soldiers/i.test(d.prompt)) return opt ? 2 + opt.might : undefined;
  if (/Attach an Equipment you control|choose a unit to attach|Equip/i.test(d.prompt) && opt) {
    if (isEquip(opt)) return opt.attachedTo ? -6 : equipWorth(opt.name, ctx);
    if (opt.type === 'Unit' && isMine(opt, ctx)) return (isAzir(opt) ? 2 : 0) + (opt.zone === 'battlefield' ? 1 : 0) + (opt.exhausted ? (opt.zone === 'base' ? -3 : -1) : 0.5)
      - opt.attachments.length * 1.5;   // spread Equipment: a second one on an exhausted base Soldier does nothing this turn
  }
  if (/^Stun /i.test(d.prompt) && opt && opt.type === 'Unit' && opt.controller !== ctx.me) {
    return opt.zone === 'base' ? -3 : 1 + opt.might * 0.5;                // a stun only matters in a combat at a battlefield
  }
  if (/Kill a unit at a battlefield/i.test(d.prompt) && opt && opt.type === 'Unit') {
    if (opt.controller === ctx.me) return -10;
    return opt.might * 0.8 + (opt.champion ? 3 : 0) + opt.attachments.length * 1.5 - 3;          // they draw 2
  }
  if (/Deathgrip|Kill a friendly unit/i.test(d.prompt) && opt) {
    if (isMine(opt, ctx)) return isSoldier(opt) ? 2 - opt.attachments.length * 2 : isAzir(opt) ? -8 : -2;
  }
  return undefined;
}

// ------------------------------------------------------------------------------------------------ responses

function respond(a: Action, card: CardInfo | null, d: Decision, ctx: PlanCtx): number | undefined {
  if (a.type !== 'playCard' || !card) return undefined;
  const fromFacedown = card.zone === 'facedown';
  if (card.name === 'Defy') return ctx.g.chain.some(i => i.controller === ctx.opp) ? 4 : -1;
  if (card.name === 'Guards!') return fromFacedown || !ctx.myTurn ? 3 : undefined;
  // Hidden Blade gives its controller 2 cards: only for a unit worth more than that
  if (card.name === 'Hidden Blade') return bigEnemy(ctx) ? (fromFacedown ? 3 : 2) : -1;
  if (card.name === 'Back Off') return fromFacedown ? 2.5 : d.kind === 'showdownAction' ? 2 : undefined;
  if (card.name === 'Discipline' || card.name === 'Battle Preparations' || card.name === 'Deathgrip') return d.kind === 'showdownAction' ? 2 : 0.5;
  if (card.name === 'Vi' || card.name === 'Kennen') return 2;
  return undefined;
}

// ------------------------------------------------------------------------------------------------ combos

const weaponmasterRule = { prompt: /Weaponmaster/i, pick: (opt: CardInfo | null, id: string, _d: Decision, ctx: PlanCtx) => weaponmasterPick(opt, id, ctx) };
const tokensJoinRule = { prompt: /Move any number of your token units/i, pick: (opt: CardInfo | null, id: string, d: Decision, ctx: PlanCtx) => target(opt, id, d, ctx) ?? 1 };
const ariseReadyRule = { prompt: /Ready up to two/i, pick: (opt: CardInfo | null) => opt ? 2 + opt.might : 0 };
const choices = [weaponmasterRule, tokensJoinRule, ariseReadyRule];

const cheapestEquipFirst = (_a: Action, c: CardInfo | null, ctx: PlanCtx) => c ? (ctx.runes <= 5 ? -c.energy : c.might + (c.name === 'B.F. Sword' ? 2 : 0)) : 0;
const azirPlayable = (ctx: PlanCtx) => ctx.g.players[ctx.me].championZone.length > 0 || ctx.count(c => isAzir(c), 'hand') > 0;
const canLegend = (ctx: PlanCtx) => ctx.myTurn && legendReady(ctx) && !equipmentPlayedThisTurn(ctx) && ctx.count(c => isEquip(c), 'hand') > 0;

export const plan: DeckPlan = {
  id: 'azir',
  legends: ['Azir'],
  author: 'PILOT-A 2026-11-26',
  mulligan,
  prior,
  priorWeight: 0.25,
  target,
  respond,
  combos: [
    {
      name: 'one Equipment -> legend Sand Soldier (Weaponmaster pickup)',
      when: canLegend,
      steps: [
        { do: 'play', card: c => isEquip(c), score: cheapestEquipFirst },
        { do: 'activate', card: 'legend' },
      ],
      choices,
    },
    {
      name: 'one Equipment -> legend Soldier -> Azir attacks with every token',
      when: ctx => canLegend(ctx) && ctx.board.some(c => isAzir(c) && !c.exhausted && !c.stunned),
      steps: [
        { do: 'play', card: c => isEquip(c), score: cheapestEquipFirst },
        { do: 'activate', card: 'legend' },
        { do: 'move', card: c => isAzir(c), to: 'battlefield' },
      ],
      choices,
    },
    {
      name: 'Azir attacks with every token',
      when: ctx => ctx.myTurn && ctx.board.some(c => isAzir(c) && !c.exhausted && !c.stunned) && ctx.board.some(c => c.isToken && c.type === 'Unit'),
      steps: [{ do: 'move', card: c => isAzir(c), to: 'battlefield' }],
      choices,
    },
    {
      name: 'Equipment -> legend Soldier -> Arise!',
      when: ctx => canLegend(ctx) && ctx.count('Arise!', 'hand') > 0 && equipCount(ctx) >= 2,
      steps: [
        { do: 'play', card: c => isEquip(c), score: cheapestEquipFirst },
        { do: 'activate', card: 'legend', optional: true },
        { do: 'play', card: 'Arise!' },
      ],
      choices,
    },
    // Accelerate answers inside plain planner moves come from the engine bot (always "yes"): offer both versions
    {
      name: 'Azir, Sovereign without Accelerate',
      when: ctx => ctx.myTurn && azirPlayable(ctx),
      steps: [{ do: 'play', card: c => isAzir(c) }],
      choices: [{ prompt: /Accelerate/i, kind: 'optional', none: true }],
    },
    {
      name: 'Azir, Sovereign with Accelerate -> attack with every token',
      when: ctx => ctx.myTurn && azirPlayable(ctx) && ctx.board.some(c => c.isToken && c.type === 'Unit') && ctx.readyRunes >= 6,
      steps: [{ do: 'play', card: c => isAzir(c), to: 'base' }, { do: 'move', card: c => isAzir(c), to: 'battlefield' }],
      choices: [{ prompt: /Accelerate/i, kind: 'optional', pick: () => 1 }, tokensJoinRule, weaponmasterRule],
    },
    {
      name: 'Arise! (3+ Equipment)',
      when: ctx => ctx.myTurn && ctx.count('Arise!', 'hand') > 0 && equipCount(ctx) >= 3,
      steps: [{ do: 'play', card: 'Arise!' }],
      choices,
    },
  ],
  resources: {
    runeValue: 1.5,
    // A rune recycled while the rune deck still has cards is missing from EVERY later turn until all 12 are out (the
    // deck channels 2 a turn either way): about runeDeckSize / 2 rune-turns. Watched games: T1 attach + hide + Charm +
    // Defy left Azir on 3 runes at own turn 7 vs 9 for Kai'Sa. Price each [C]/[A] spend by those lost rune-turns.
    recycleCost: (forCard, ctx) => {
      if (lateRunes(ctx)) return 0;
      const lost = 0.9 * ctx.runeDeckSize / 2;                 // ~4.5 on turn 1, ~2 by own turn 4, 0 once the deck is out
      if (!forCard) return 0.8 * lost;
      if (forCard.obj === ctx.legend.obj || isEquip(forCard) || isSoldier(forCard)) return 0.6 * lost;   // Weaponmaster / Equip [C]
      if (forCard.name === 'Guards!') return 0.9 * lost;                            // hide [A] or the ready [C]
      if (isAzir(forCard)) return 1.0 * lost;                                       // Accelerate
      if (forCard.name === 'Hidden Blade' || forCard.name === 'Back Off') return 0.8 * lost;
      if (forCard.name === 'Defy' || forCard.name === 'Arise!') return 0.4 * lost;  // countering their key spell / the bomb
      return 1.0 * lost;
    },
    reserve: ctx => {
      const names = ctx.hand.map(c => c.name);
      if (names.includes('Defy') && ctx.oppBoard.length) return { energy: 1, value: 1.5, forCards: ['Defy'] };
      if (names.includes('Discipline') || names.includes('Battle Preparations')) return { energy: 2, value: 1.0, forCards: ['Discipline', 'Battle Preparations'] };
      return undefined;
    },
  },
  hide: {
    never: ['Arise!', 'Defy', 'Discipline', 'Battle Preparations', 'Deathgrip', 'Salvage', 'Charm'],
    // defence a facedown card adds in the projection: Guards! = a 2-Might Soldier that picks up the best free Equipment
    defense: (c, _bf, ctx) => {
      if (c.name === 'Guards!') return 2 + Math.max(0, ...ctx.board.filter(e => isEquip(e) && !e.attachedTo).map(e => e.might + (e.name === "Doran's Shield" ? 1 : 0)));
      if (c.name === 'Hidden Blade') return 3;
      if (c.name === 'Back Off') return 2;
      if (c.name === 'Kennen') return 2;
      return undefined;
    },
    hideValue: (c, bf, ctx) => {
      if (!HIDDEN.includes(c.name)) return 0;
      const held = ctx.controllerOf(bf) === ctx.me;
      if (!held) return 0;
      const threat = enemyCanContest(ctx, bf) ? 1 : 0.4;
      // a facedown card already sits at that battlefield (one per battlefield): the hide action itself is illegal then
      switch (c.name) {
        case 'Guards!': return 2.5 * threat;
        case 'Hidden Blade': return (bigEnemy(ctx) ? 1.5 : 0.5) * threat;      // only worth it against a real threat
        case 'Back Off': return 1.0 * threat;
        case 'Kennen': return 0.8 * threat;
        default: return 0;
      }
    },
  },
  eval: {
    cardValue: (c, ctx) => {
      if (c.zone === 'hand') {
        if (c.name === 'Arise!') return equipCount(ctx) >= 3 ? 1 : 2;               // keep it until it makes 3+ Soldiers
        if (isEquip(c)) {
          // one Equipment in hand is tomorrow's legend trigger; extra copies only wait (watched: two Eye of the Herald
          // held all game while 2-4 runes went unused every turn) — on the board they are Weaponmaster / Arise! fuel
          const first = ctx.hand.filter(h => isEquip(h)).sort((a, b) => a.energy - b.energy)[0];
          return first && first.obj === c.obj ? 0.4 : -0.5;
        }
        return undefined;
      }
      if (c.zone === 'facedown') {
        // a hidden defender the core projection does not see: Guards! is a free 2-Might Soldier (+ Weaponmaster pickup)
        // at that battlefield on the opponent's turn
        const held = c.battlefield !== undefined && ctx.controllerOf(c.battlefield) === ctx.me;
        if (!held) return 0;
        const threat = c.battlefield !== undefined && enemyCanContest(ctx, c.battlefield);
        if (c.name === 'Guards!') return (threat ? 1 : 0.5) + Math.min(2, freeEquipCount(ctx)) * 0.3;   // + hideValue + hide.defense
        return 0;
      }
      if (c.zone !== 'base' && c.zone !== 'battlefield') return undefined;
      if (isSoldier(c) && c.attachments.length) return 0.6;
      if (isAzir(c)) return 1 + Math.min(4, ctx.board.filter(x => x.isToken && x.type === 'Unit').length) * 0.4;
      if (isEquip(c) && !c.attachedTo) return 0.5 + (ctx.count('Arise!', 'hand') ? 0.5 : 0);   // Arise! fuel / Weaponmaster pickup
      return undefined;
    },
    bonus: ctx => (freeEquipCount(ctx) > 0 && ctx.count('Arise!', 'hand') > 0 ? 0.2 : 0),
  },
};

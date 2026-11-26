// Batch B8 card scripts: legends, battlefields, rules-modifying statics, replacement effects, resource
// abilities and bespoke "weird" cards. Owned by scripting agent B8. Helpers: src/cards/helpers/B8.ts.
// Engine gaps are listed in docs/dsl-requests.md (entries "B8-*"); cards that still need one say so below.
import {
  card, spell, when, onPlay, onHold, activated, mana, statik, selfMight, anthem, replacement, costModDyn, playRule,
  movePermission, rule, grantable, delayedAbility, atStartOfBeginning, atStartOfMain, atEndOfTurn, whenYouConquer,
  whenYouPlay, reflexiveAbility, cost, pay, dep, E, T, F, R, D, killAtEndOfTurn, type Ctx, type Filter,
} from '../dsl.ts';
import type { GameEvent, ObjId, PlayerId } from '../../engine/types.ts';
import { abilityByIndex, keywordCost } from '../../engine/chars.ts';
import { getScript } from '../registry.ts';
import { evPlayer, bfCtl, turnNumberOf, victory, conquerHere, holdHere, defendHere, scoreHere, usedThisTurn,
  markThisTurn, firstThisTurn, fact, setFact, listen, discountMin1, oneOrA, itemTargets, payer, putInTrash,
  putInChampionZone, putInLegendZone, setAside, chosenChampion, chosenChampionsInTrash, activateConquerEffects, isDeathknell, type QueuedTrigger,
} from '../helpers/B8.ts';

// ---------------------------------------------------------------------------------------------
// shared bits
// ---------------------------------------------------------------------------------------------

const unitsHere: Filter = (c, id) => c.isUnit(id) && c.isHere(id);
const isGearCard = (c: Ctx, id: ObjId) => c.isGear(id) && !c.isUnit(id);
/** "I'm at a battlefield" for units */
const atBf = (ctx: Ctx) => ctx.atBattlefield(ctx.self);
/** exhausted runes of the controller */
const exhaustedRunes = (ctx: Ctx) => ctx.runes().filter(r => ctx.isExhausted(r));
/** "ready up to 2 runes" (a real choice when more than 2 are exhausted) */
function readyUpTo2Runes(ctx: Ctx): void {
  const ex = exhaustedRunes(ctx);
  if (!ex.length) return;
  const ids = ex.length <= 2 ? ex : ctx.chooseCards(ex, 0, 2, 'Ready up to 2 runes');
  ctx.ready(ids);
}
const notExhausted = (ctx: Ctx) => !ctx.isExhausted(ctx.self);
const isOpp = (ctx: Ctx, p: unknown) => typeof p === 'number' && ctx.isOpponent(p as PlayerId);
const friendlyPlayer = (ctx: Ctx, p: unknown) => typeof p === 'number' && !ctx.isOpponent(p as PlayerId);
/**
 * An optional cost change decided while `id` is being played: asked once (with the chain item known) and
 * remembered on the item / play data; legality checks without an item assume "yes".
 */
function askOnItem(ctx: Ctx, id: ObjId, key: string, ask: () => boolean): boolean {
  const it = ctx.item;
  // FUZZ (F-script): legality probes (play.ts probeItem, choices.probe) may carry targets; never ask or write state there
  if (!it || it.source !== id || it.choices.probe) return true;
  if (typeof it.choices[key] === 'boolean') return it.choices[key] as boolean;
  const v = ask();
  it.choices[key] = v;
  ctx.g.ex.turnFacts[`B8:${key}:${id}`] = v;
  return v;
}

// =============================================================================================
// Units with rules-modifying statics
// =============================================================================================

// Noxus Saboteur — opponents' hidden cards here can't be revealed, so they can't be played from facedown here.
card('ogn-018-298', "Your opponents' [Hidden] cards can't be revealed here.", [
  rule('cantPlay', (ctx, id: ObjId, p: PlayerId) => {
    const o = ctx.obj(id);
    return !!o && o.zone === 'facedown' && ctx.isOpponent(p) && ctx.loc(id) === ctx.here() && ctx.atBattlefield(ctx.self);
  }, undefined, { text: "Opponents' hidden cards here can't be revealed" }),
]);

// Brynhir Thundersong
const brynhirLock = delayedAbility('B8:brynhir:lock', rule('cantPlay', (ctx, _id: ObjId, p: PlayerId) => ctx.isOpponent(p), undefined, { text: "Opponents can't play cards this turn" }));
card('ogn-026-298', "When you play me, opponents can't play cards this turn.", [
  onPlay(ctx => ctx.delay(brynhirLock, {}, 'endOfTurn'), { text: "Opponents can't play cards this turn" }),
]);

// Mageseeker Warden
card('ogn-070-298', "While I'm at a battlefield, opponents can only play units to their base.\nWhile I'm at a battlefield, spells and abilities can't ready enemy units and gear.", [
  rule('cantPlay', (ctx, id: ObjId, p: PlayerId, dest: number | 'base' | null) => atBf(ctx) && ctx.isOpponent(p) && ctx.isUnit(id) && dest !== null && dest !== 'base',
    undefined, { text: 'Opponents can only play units to their base' }),
  // unit tokens too (RJ#3977): an opponent's unit token played to a battlefield isn't played (not redirected to base)
  replacement('createToken', (ev, ctx) => {
    const d = ctx.g.cards[String(ev.cardId)];
    return atBf(ctx) && typeof ev.player === 'number' && ctx.isOpponent(ev.player as PlayerId) && typeof ev.loc === 'number' && !!d && (d.type === 'Unit' || d.might !== null);
  }, () => null, { text: 'Opponents can only play unit tokens to their base' }),
  // by === null is the Awaken Phase (not a spell or ability)
  rule('cantReady', (ctx, id: ObjId, by: PlayerId | null) => atBf(ctx) && by !== null && ctx.isEnemy(id) && (ctx.isUnit(id) || ctx.isGear(id)),
    undefined, { text: "Spells and abilities can't ready enemy units and gear" }),
]);

// Eager Apprentice
card('ogn-084-298', "While I'm at a battlefield, the Energy costs for spells you play is reduced by [1], to a minimum of [1].", [
  costModDyn((ctx, id) => {
    if (!atBf(ctx) || payer(ctx) !== ctx.controller || !ctx.isSpell(id)) return null;
    // RJ#9301 (CR 356): the minimum applies to the total cost (incl. Repeat), enforced by the engine
    return { energy: -1, minEnergy: 1 };
  }, { text: 'Your spells cost [1] less (minimum [1])' }),
]);

// Time Warp
card('ogn-122-298', "Take a turn after this one. Banish this.", [
  spell(ctx => { ctx.extraTurn(ctx.controller); ctx.banishAfterResolve(); }),
]);

// Herald of Scales
card('ogn-140-298', "Your Dragons' Energy costs are reduced by [2], to a minimum of [1].", [
  costModDyn((ctx, id) => {
    if (payer(ctx) !== ctx.controller || !ctx.hasTag(id, 'Dragon')) return null;
    // each copy's "to a minimum of [1]" applies to the cost as it stands then (engine minEnergy, applied in turn) — four Heralds on an
    // 8-Energy Dragon: 6, 4, 2, 1 (RJ#3600b; principle 10 passive minimum)
    return ctx.energyCost(id) > 1 ? { energy: -2, minEnergy: 1 } : null;
  }, { text: 'Your Dragons cost [2] less (minimum [1])' }),
]);

// Kayn, Unleashed
card('ogn-189-298', "[Ganking]\nIf I have moved twice this turn, I don't take damage.", [
  // moves counted by the engine (GameObject.movesThisTurn, reset each turn and on a zone change)
  replacement('damage', (ev, ctx) => ev.obj === ctx.self && ctx.movesThisTurn(ctx.self) >= 2, () => null, { text: "I don't take damage (moved twice)", noDamage: true }),
]);

// Possession
card('ogn-203-298', "[Action]\nChoose an enemy unit at a battlefield. Take control of it and recall it.", [
  spell(ctx => { const t = ctx.target(0); if (!t) return; ctx.takeControl(t); ctx.recall(t); },
    { targets: [T.unit(F.enemy, F.atBattlefield, { hint: 'harm', prompt: 'Choose an enemy unit at a battlefield' })] }),
]);

// Symbol of the Solari — a tie = every attacker and defender would die after combat damage. Only units at that battlefield are
// recalled (Origins FAQ ruling, data audit follow-up): the replacement applies to the deaths of combatants there, nothing else moves.
const solariKey = (ctx: Ctx) => `solari:${ctx.self}:${ctx.g.ex.combat?.bf}`;
card('ogn-227-298', "If a combat where you are the attacker ends in a tie, recall ALL units instead.", [
  replacement('die', (ev, ctx) => {
    const c = ctx.g.ex.combat, sd = ctx.g.showdown;
    if (!c || !sd || !sd.isCombat || sd.stage !== 'closing' || sd.attacker !== ctx.controller) return false;
    const id = ev.obj as ObjId;
    if (ctx.loc(id) !== c.bf || !ctx.obj(id)?.combatRole) return false;
    if (fact(ctx, solariKey(ctx))) return true;
    const here = ctx.unitsAt(c.bf, u => !!ctx.obj(u).combatRole);
    const atk = here.filter(u => ctx.obj(u).combatRole === 'attacker'), def = here.filter(u => ctx.obj(u).combatRole === 'defender');
    return atk.length > 0 && def.length > 0 && here.every(u => ctx.lethallyDamaged(u));
  }, (ev, ctx) => { setFact(ctx, solariKey(ctx), 1); return { ...ev, type: 'recall', heal: true }; }, { text: 'Tie: recall all units instead' }),
  // the other tie: both sides still have units after combat damage (OGN-FAQ "What does it mean for combat to be a 'tie?'"; RJ#3123)
  rule('tieRecallAll', (ctx, attacker: PlayerId) => attacker === ctx.controller, undefined, { text: 'Tie with units left on both sides: recall all units' }),
]);

// Karthus, Eternal
card('ogn-236-298', "Your [Deathknell] effects trigger an additional time.", [
  rule('extraTriggers', (ctx, qt: QueuedTrigger) => qt.controller === ctx.controller && isDeathknell(ctx, qt), 1, { text: 'Deathknell triggers an additional time' }),
]);

// =============================================================================================
// Legends
// =============================================================================================

// Daughter of the Void — [C] on a two-domain legend: the engine's Add produces the first domain (B8-7).
card('ogn-247-298', "[T]: [Reaction] — [Add] [A]. Use only to play spells.", [
  // data audit: the printed symbol on this multi-domain card is [A] (any power), not [C]
  mana('[T]', { power: ['A'], only: 'spell' }, { text: 'Add [A] (spells only)' }),
]);

// Relentless Storm
card('ogn-249-298', "When you play a [Mighty] unit, you may exhaust me to channel 1 rune exhausted.", [
  when('play', (ev, ctx) => ev.player === ctx.controller && ctx.exists(ev.obj as ObjId) && ctx.isUnit(ev.obj as ObjId) && ctx.isMighty(ev.obj as ObjId) && notExhausted(ctx),
    E.channel(1, true), { optional: 'Exhaust Relentless Storm to channel 1 rune exhausted?', cost: cost('[T]'), text: 'Channel 1 rune exhausted' }),
]);

// Loose Cannon
card('ogn-251-298', "At start of your Beginning Phase, draw 1 if you have one or fewer cards in your hand.", [
  // CR 383.2.a.1 (Loose Cannon is the rules' example): the hand size is part of the effect — always triggers, checked on resolution
  atStartOfBeginning(E.draw(1), { ifOnResolve: ctx => ctx.hand().length <= 1, text: 'Draw 1 (one or fewer cards in hand)' }),
]);

// Hand of Noxus
card('ogn-253-298', "[T]: [Reaction], [Legion] — [Add] [1].", [
  mana('[T]', { energy: 1 }, { requires: [dep.legion()], text: 'Add [1] (Legion)' }),
]);

// Nine-Tailed Fox
card('ogn-255-298', "When an enemy unit attacks a battlefield you control, give it -1 [S] this turn, to a minimum of 1 [S].", [
  when('attack', (ev, ctx) => ctx.exists(ev.obj as ObjId) && ctx.isEnemy(ev.obj as ObjId) && typeof ev.bf === 'number' && ctx.controls(ev.bf as number),
    E.mightMin(R.eventObj, 1, 1), { text: 'Give the attacker -1 [S] (minimum 1)' }),
]);

// Blind Monk
card('ogn-257-298', "[1], [T]: Buff a friendly unit.", [
  activated('[1], [T]', E.buff(0), { targets: [T.unit(F.friendly, { hint: 'help', prompt: 'Buff a friendly unit' })], text: 'Buff a friendly unit' }),
]);

// Unforgiven
card('ogn-259-298', "[2], [E]: Move a friendly unit to or from its base.", [
  activated('[2], [E]', ctx => {
    E.moveToChosen(0, 1)(ctx);
  }, { targets: [T.unit(F.friendly, { hint: 'help', prompt: 'Move a friendly unit to or from its base' }),
    // R-2 (CR 355.4): chosen as the ability is activated; from its base -> a battlefield, otherwise -> its base
    T.destination(F.moveDestFor(0), F.dest((c, l) => (c.loc(c.target(0)!) === 'base') === (typeof l === 'number')), { prompt: 'Move it to' })], text: 'Move a friendly unit to or from its base' }),
]);

// Radiant Dawn — "one or more": once per event batch (the stun events of one instruction count once; each Repeat execution is
// its own batch, RJ#6584 / DECISIONS principle 7).
card('ogn-261-298', "When you stun one or more enemy units, buff a friendly unit.", [
  when('stun', (ev, ctx) => ev.player === ctx.controller && ctx.exists(ev.obj as ObjId) && ctx.isEnemy(ev.obj as ObjId),
    E.buff(0), { oncePerBatch: true, targets: [T.unit(F.friendly, { hint: 'help', prompt: 'Buff a friendly unit' })], text: 'Buff a friendly unit' }),
]);

// Swift Scout — the alternative hide cost is an engine play rule (hideCost, B8-8).
const isTeemo = (ctx: Ctx, id: ObjId) => ctx.owner(id) === ctx.controller && ctx.isUnit(id) && ctx.hasTag(id, 'Teemo');
const teemoCands = (ctx: Ctx) => [
  ...ctx.g.players[ctx.controller].championZone.filter(id => ctx.hasTag(id, 'Teemo')),
  ...ctx.units(u => isTeemo(ctx, u)),
];
card('ogn-263-298', "You may pay [1] to hide a card with [Hidden] instead of [A].\n[1], [T]: Put a Teemo unit you own into your hand from your Champion Zone or the board.", [
  activated('[1], [T]', ctx => {
    const c = teemoCands(ctx);
    const id = ctx.chooseCards(c, 1, 1, 'Put a Teemo unit you own into your hand')[0];
    if (!id) return;
    if (ctx.onBoard(id)) ctx.returnToHand(id); else ctx.toHand(id);
  }, { if: ctx => teemoCands(ctx).length > 0, text: 'Put a Teemo unit you own into your hand' }),
  playRule(() => false, { hideCost: () => ({ energy: 1 }), text: 'You may pay [1] to hide a card with [Hidden] instead of [A].' }),
]);

// Bounty Hunter
card('ogn-267-298', "[T]: Give a unit [Ganking] this turn.", [
  activated('[T]', E.keyword(0, 'Ganking'), { targets: [T.unit({ hint: 'help', prompt: 'Give a unit [Ganking] this turn' })], text: 'Give a unit [Ganking] this turn' }),
]);

// The Boss
card('ogn-269-298', "If a buffed unit you control would die, you may pay [A], exhaust me, and spend its buff to heal it, exhaust it, and recall it instead.\nWhen you conquer, ready me.", [
  replacement('die', (ev, ctx) => {
    const id = ev.obj as ObjId;
    return ctx.exists(id) && ctx.isUnit(id) && ctx.ctrl(id) === ctx.controller && ctx.isBuffed(id) && notExhausted(ctx) && ctx.canPay(cost('[A]'));   // [A]: data audit (multi-domain card)
  }, (ev, ctx) => {
    const id = ev.obj as ObjId;
    if (!ctx.pay(cost('[A]'))) return ev;
    ctx.exhaust(ctx.self);
    ctx.spendBuff(id);
    ctx.heal(id); ctx.exhaust(id); ctx.recall(id);
    return null;
  }, { optional: 'The Boss: pay [A], exhaust The Boss and spend the buff to save that unit?', text: 'Save a buffed unit' }),
  whenYouConquer(E.ready('self'), { text: 'Ready me' }),
]);

// Dark Child, Starter
card('ogs-017-024', "At the end of your turn, ready up to 2 runes.", [
  // RJ#239 DECIDED: any player's runes (no "your"); rulings sweep: the runes are targets chosen as the trigger goes on the chain
  atEndOfTurn(ctx => { ctx.ready(ctx.targetsOf(0).filter(r => ctx.isExhausted(r))); },
    { targets: [T.upTo(2, T.rune((c, id) => c.isExhausted(id), { hint: 'help', prompt: 'Ready up to 2 runes (any player\'s)' }))], text: 'Ready up to 2 runes' }),
]);

// Wuju Bladesman, Starter
const defendsAlone: Filter = (c, id) => {
  if (!c.isUnit(id) || !c.isFriendly(id) || !c.isDefending(id)) return false;
  const l = c.loc(id);
  return l !== null && c.unitsAt(l, u => u !== id && c.ctrl(u) === c.ctrl(id)).length === 0;
};
card('ogs-019-024', "While a friendly unit defends alone, it gets +2 [S].", [
  anthem(defendsAlone, { might: 2 }, { text: 'A friendly unit defending alone gets +2 [S]' }),
]);

// Lady of Luminosity, Starter
card('ogs-021-024', "When you play a spell that costs [5] or more, draw 1.", [
  whenYouPlay((c, id) => c.isSpell(id) && c.energyCost(id) >= 5, E.draw(1), { text: 'Draw 1' }),
]);

// Might of Demacia, Starter
card('ogs-023-024', "When you conquer, if you have 4+ units at that battlefield, draw 2.", [
  whenYouConquer(E.draw(2), { if: ctx => typeof ctx.event?.bf === 'number' && ctx.unitsAt(ctx.event.bf as number, u => ctx.ctrl(u) === ctx.controller).length >= 4, text: 'Draw 2' }),
]);

// Coalesced Energy
card('rad-016-167', "At the end of your turn, recycle all your runes, then channel 4 runes exhausted.", [
  atEndOfTurn(ctx => { ctx.recycle([...ctx.runes()]); ctx.channel(4, true); }, { text: 'Recycle all your runes, then channel 4 exhausted' }),
]);

// Firebrand Raider — other units of its controller enter ready via a play rule; units entering for other
// players (and tokens) are readied as they enter (B8-9: play rules only apply to their controller's plays).
card('rad-019-167', "I enter ready.\nWhen you play me, ready all enemy units.\nOther units enter ready.\nUnits don't ready during the Awaken Phase.", [
  onPlay(E.ready(R.all(F.enemy)), { text: 'Ready all enemy units' }),
  playRule((ctx, id) => id !== ctx.self && ctx.isUnit(id), { entersReady: true, text: 'Other units enter ready' }),
  when('enter', (ev, ctx) => {
    const id = ev.obj as ObjId;
    if (id === ctx.self || !ctx.exists(id) || !ctx.isUnit(id) || !ctx.isExhausted(id)) return false;
    return ev.player !== ctx.controller || !!ev.token;
  }, ctx => { const id = ctx.event!.obj as ObjId; if (ctx.exists(id)) ctx.obj(id).exhausted = false; }, { isAdd: true, text: 'Other units enter ready' }),
  rule('noAwakenReady', (ctx, id: ObjId) => ctx.isUnit(id), undefined, { text: "Units don't ready during the Awaken Phase" }),
], { entersReady: true });

// Orianna, Mechanical Marvel — "you may": asked while the gear is being played (the legality check assumes yes).
const oriannaOk = (ctx: Ctx) => atBf(ctx) && !usedThisTurn(ctx, 'gear');
card('rad-068-167', "Once each turn, while I'm at a battlefield, you may pay [1][A] less to play a gear.", [
  costModDyn((ctx, id) => {
    if (!oriannaOk(ctx) || payer(ctx) !== ctx.controller || !isGearCard(ctx, id) || (ctx.energyCost(id) === 0 && ctx.powerCost(id) === 0)) return null;
    return askOnItem(ctx, id, `orianna:${ctx.self}`, () => ctx.may(`Orianna: pay [1][A] less to play ${ctx.name(id)}? (once each turn)`)) ? { energy: -1, power: -1 } : null;
  }, { text: 'Once each turn: you may pay [1][A] less for a gear' }),
  listen('play', (ev, ctx) => {
    const id = ev.obj as ObjId;
    if (ev.player !== ctx.controller || ev.token || !ctx.exists(id) || !isGearCard(ctx, id) || !oriannaOk(ctx)) return;
    if (ctx.g.ex.turnFacts[`B8:orianna:${ctx.self}:${id}`] === true) markThisTurn(ctx, 'gear');
  }),
]);

// Seraphic Wyvern
card('rad-092-167', "If you would channel runes, channel that many runes plus 1 exhausted rune instead.", [
  replacement('channelRunes', (ev, ctx) => ev.player === ctx.controller, ev => ({ ...ev, extraExhausted: Number(ev.extraExhausted ?? 0) + 1 }), { text: 'Channel 1 additional exhausted rune' }),
]);

// Boy Who Shattered Time — Empower comes from the keyword data ("[1], [T]").
const ekkoNextUnit = delayedAbility('B8:ekko:next', when('play', (ev, ctx) => ev.player === ctx.controller && !ev.token && ctx.exists(ev.obj as ObjId) && ctx.isUnit(ev.obj as ObjId),
  ctx => { const id = ctx.event!.obj as ObjId; if (ctx.onBoard(id)) killAtEndOfTurn(ctx, id); }, { text: 'Kill me at end of turn' }));
card('rad-139-167', "[Empower] — [1], [T]\nDisempower me, [T]: Reduce the cost of the next unit you play this turn by [2][A] and give it \"Kill me at end of turn.\"", [
  activated(cost('[T]', pay.disempowerSelf()), ctx => {
    ctx.delay(D.nextCostsLess, { energy: -2, power: -1, type: 'Unit' }, 'endOfTurn', 1);
    ctx.delay(ekkoNextUnit, {}, 'endOfTurn', 1);
  }, { text: 'Next unit costs [2][A] less and dies at end of turn' }),
]);

// Iron Revenant
card('rad-143-167', "[Reaction][>] Banish a unit or gear from your trash, [T]: [Add] [A]. Spend this Power only to play units or gear.", [
  mana(cost('[T]', pay.banishFromTrash(1, (c, id) => c.type(id) === 'Unit' || c.type(id) === 'Gear')), { power: ['A'], only: 'unitOrGear' }, { text: 'Add [A] (units or gear only)' }),
]);

// Lady of Clockwork
const clockworkMark = (ctx: Ctx) => Number(ctx.self.slice(1));
card('rad-145-167', "At the start of your Main Phase, you may pay [1] to choose a friendly gear. It becomes a unit gear with Might equal to its Energy cost until you choose another gear with me.", [
  // RULINGS: CR 383.3.b / 403.2 — "you may pay [1] to choose a friendly gear": the [1] is the base cost and the gear a target,
  // both handled as the trigger goes on the chain
  atStartOfMain(ctx => {
    const g = ctx.target(0);
    if (!g || !ctx.onBoard(g) || !ctx.isGear(g)) return;
    for (const id in ctx.g.objects) {
      const o = ctx.g.objects[id];
      if (o.counters.clockwork === clockworkMark(ctx)) { delete o.counters.clockwork; ctx.stopBeingUnit(id); }
    }
    const m = ctx.energyCost(g);
    // FUZZ: units can never be attached — an attached gear that becomes a unit detaches (CR 143.5, 435.1.h)
    if (ctx.obj(g).attachedTo) ctx.detach(g);
    ctx.becomeUnit(g, m);
    ctx.obj(g).counters.clockwork = clockworkMark(ctx);
  }, {
    optional: 'Lady of Clockwork: pay [1] to choose a friendly gear?', cost: cost('[1]'),
    targets: [T.permanent(F.friendly, (c, id) => c.isGear(id) && c.obj(id).counters.clockwork !== clockworkMark(c), { prompt: 'Choose a friendly gear: it becomes a unit', hint: 'help' })],
    text: 'Pay [1]: a friendly gear becomes a unit',
  }),
]);

// Pride of Nazumah
const assaultEqShield = grantable('B8:nazumah:assault', statik('self', ctx => { const n = ctx.kw(ctx.self, 'Shield'); return n > 0 ? { keywords: [`Assault ${n}`] } : {}; }, { text: 'I have [Assault] equal to my [Shield]' }));
card('rad-147-167', "[1], [T]: Give a friendly unit \"I have [Assault] equal to my [Shield]\" this turn.", [
  activated('[1], [T]', E.grant(0, assaultEqShield), { targets: [T.unit(F.friendly, { hint: 'help', prompt: 'Give a friendly unit "Assault equal to Shield"' })], text: 'Give a friendly unit "[Assault] equal to my [Shield]"' }),
]);

// The Exile
card('rad-149-167', "Units you play to battlefields you control enter ready.", [
  playRule((ctx, id) => ctx.isUnit(id), { entersReady: (ctx, _id, dest) => typeof dest === 'number' && ctx.controls(dest), text: 'Units played to your battlefields enter ready' }),
]);

// Starry-Eyed Songstress — an engine play-rule optional additional cost with a discount (B8-11): legality knows about it
const songUnits = (ctx: Ctx) => ctx.units(u => ctx.ctrl(u) === ctx.controller && !ctx.isExhausted(u) && u !== ctx.self);
const songCost = pay.custom('Exhaust me and three friendly units',
  ctx => notExhausted(ctx) && songUnits(ctx).length >= 3,
  ctx => { const us = ctx.chooseCards(songUnits(ctx), 3, 3, 'Starry-Eyed Songstress: exhaust three friendly units'); ctx.exhaust([ctx.self, ...us]); return us.length === 3; });
card('rad-151-167', "As an additional cost to play a spell, you may exhaust me and three friendly units to reduce the cost of that spell by [2].", [
  playRule((ctx, id) => ctx.isSpell(id), {
    additionalCost: { cost: cost('', songCost), discount: { energy: -2 }, key: 'songstress', label: 'Starry-Eyed Songstress: exhaust it and three friendly units to reduce the cost by [2]' },
    text: 'As an additional cost to play a spell, you may exhaust me and three friendly units to reduce the cost of that spell by [2].',
  }),
]);

// Agony's Embrace
card('rad-153-167', "Once each turn, when you play a card from face down, draw 1. Then, if it's not your turn, discard 1.", [
  when('play', (ev, ctx) => ev.player === ctx.controller && !!ev.fromHidden, ctx => { ctx.draw(1); if (!ctx.isMyTurn()) ctx.discard(1); }, { oncePerTurn: 1, text: 'Draw 1 (discard 1 if not your turn)' }),
]);

// Exemplar of Demacia
card('rad-155-167', "When you play a gear with [Deploy], you may exhaust me and pay [A] to move a friendly unit to that battlefield.", [
  when('play', (ev, ctx) => ev.player === ctx.controller && typeof ev.loc === 'number' && ctx.exists(ev.obj as ObjId) && isGearCard(ctx, ev.obj as ObjId) && ctx.has(ev.obj as ObjId, 'Deploy') && notExhausted(ctx),
    ctx => { const u = ctx.target(0); if (u) ctx.move(u, ctx.event!.loc as number); },
    { optional: 'Exhaust Exemplar of Demacia and pay [A] to move a friendly unit there?', cost: cost('[A][T]'), targets: [T.unit(F.friendly, (c, id) => c.loc(id) !== c.event?.loc, { hint: 'help', prompt: 'Move a friendly unit to that battlefield' })], text: 'Move a friendly unit to that battlefield' }),
]);

// Purifier
const myEquipOn = (c: Ctx, id: ObjId) => c.attachments(id).filter(g => c.isEquipment(g) && c.ctrl(g) === c.controller).length;
card('sfd-183-221', "Your Equipment each give [Assault].", [
  anthem((c, id) => c.isUnit(id) && myEquipOn(c, id) > 0, (c, id) => ({ keywords: [`Assault ${myEquipOn(c, id)}`] }), { text: 'Your Equipment each give [Assault]' }),
]);

// Glorious Executioner
card('sfd-185-221', "When you win a combat, draw 1.", [
  when('combatResult', (ev, ctx) => ev.winner === ctx.controller, E.draw(1), { text: 'Draw 1' }),
]);

// Fire Below the Mountain — gear abilities can't be told apart from other abilities by the payer (B8-7).
card('sfd-189-221', "[T]: [Reaction] — [Add] [A]. Use only to play gear or use gear abilities.", [
  mana('[T]', { power: ['A'], only: 'gear' }, { text: 'Add [A] (gear only)' }),
]);

// Blade Dancer
card('sfd-195-221', "When you choose a friendly unit, you may exhaust me and pay [A] to ready it.\nWhen you conquer, you may pay [1] to ready me.", [
  when('targeted', (ev, ctx) => ev.player === ctx.controller && ctx.exists(ev.obj as ObjId) && ctx.isUnit(ev.obj as ObjId) && ctx.isFriendly(ev.obj as ObjId) && notExhausted(ctx),
    ctx => { const u = ctx.event!.obj as ObjId; if (ctx.onBoard(u)) ctx.ready(u); },
    { optional: 'Exhaust Blade Dancer and pay [A] to ready that unit?', cost: cost('[A][T]'), text: 'Ready the chosen unit' }),
  whenYouConquer(E.ready('self'), { optional: 'Pay [1] to ready Blade Dancer?', cost: cost('[1]'), text: 'Ready me' }),
]);

// Prodigal Explorer — every chosen enemy unit/gear counts (RJ#2744 / RJ#92a house ruling, lead decision).
const explorerKey = (ctx: Ctx) => `explorer:${ctx.controller}`;
card('sfd-199-221', "[T]: [Reaction] — Draw 1. Use only if you've chosen enemy units and/or gear twice this turn with spells or unit abilities.", [
  activated('[T]', E.draw(1), { timing: 'reaction', if: ctx => fact(ctx, explorerKey(ctx)) >= 2, text: 'Draw 1' }),
  listen('targeted', (ev, ctx) => {
    if (ev.player !== ctx.controller) return;
    const t = ev.obj as ObjId, src = ev.source as ObjId;
    if (!ctx.exists(t) || !ctx.isEnemy(t) || !(ctx.isUnit(t) || ctx.isGear(t)) || !ctx.exists(src)) return;
    const srcIsSpell = ctx.obj(src).zone === 'chain' && ctx.isSpell(src);
    const srcIsUnit = ctx.onBoard(src) && ctx.isUnit(src);
    if (!srcIsSpell && !srcIsUnit) return;
    // RJ#2744 / RJ#92a DECIDED (house ruling): each enemy unit / gear chosen counts (one spell choosing two enemies = twice)
    setFact(ctx, explorerKey(ctx), fact(ctx, explorerKey(ctx)) + 1);
  }),
]);

// Chem-Baroness — the extra [1] is added right after the Gold's ability (B8-12: no Add replacement).
card('sfd-201-221', "When you or an ally hold, you may exhaust me to play a Gold gear token exhausted.\nWhile your score is within 3 points of the Victory Score, your Gold [Add] an additional [1].", [
  when('hold', (ev, ctx) => friendlyPlayer(ctx, ev.player) && notExhausted(ctx), E.token('Gold', { exhausted: true }),
    { optional: 'Exhaust Chem-Baroness to play a Gold gear token exhausted?', cost: cost('[T]'), text: 'Play a Gold gear token exhausted' }),
  listen('die', (ev, ctx) => {
    const l = ev.lki as { name?: string; controller?: PlayerId; isToken?: boolean } | undefined;
    if (l?.name === 'Gold' && l.isToken && l.controller === ctx.controller) ctx.g.ex.turnFacts[`B8:gold:${ev.obj}`] = 1;
  }),
  when('add', (ev, ctx) => ev.player === ctx.controller && typeof ev.source === 'string' && !!ctx.g.ex.turnFacts[`B8:gold:${ev.source}`]
      && (ctx.g.ex.turnFacts[`B8:gold:${ev.source}`] = 2) === 2 && victory(ctx) - ctx.points() <= 3,
    ctx => ctx.add(1), { isAdd: true, text: 'Your Gold adds an additional [1]' }),
]);

// Grand Duelist
card('sfd-205-221', "When one of your units becomes [Mighty], you may exhaust me to channel 1 rune exhausted.", [
  when('becameMighty', (ev, ctx) => ctx.exists(ev.obj as ObjId) && ctx.ctrl(ev.obj as ObjId) === ctx.controller && notExhausted(ctx),
    E.channel(1, true), { optional: 'Exhaust Grand Duelist to channel 1 rune exhausted?', cost: cost('[T]'), text: 'Channel 1 rune exhausted' }),
]);

// Virtuoso — "spent [4] or more" is read as the spell's Energy cost (0 if played from hiding): B8-13.
const virtuosoSpells = (ctx: Ctx) => ctx.banishedWithThis().filter(id => ctx.g.cards[ctx.obj(id).cardId]?.type === 'Spell');
card('unl-181-219', "When you play a spell, if you spent [4] or more, you may banish it. Then, if there are four spells banished with me, put each in its trash, channel 4 runes, and draw 1.", [
  // RULINGS: "spent [4] or more" = Energy actually paid for that play (play event `paid`), not the printed cost
  when('play', (ev, ctx) => ev.player === ctx.controller && ev.cardType === 'Spell' && ctx.exists(ev.obj as ObjId) && Number(((ev as { paid?: { energy?: number } } | undefined)?.paid?.energy) ?? 0) >= 4, ctx => {
    const s = ctx.event!.obj as ObjId;
    if (!ctx.exists(s) || ctx.obj(s).zone !== 'trash' || !ctx.may(`Virtuoso: banish ${ctx.name(s)}?`)) return;
    ctx.banish(s);
    const all = virtuosoSpells(ctx);
    if (all.length >= 4) { for (const id of all) putInTrash(ctx, id); ctx.channel(4); ctx.draw(1); }
  }, { text: 'Banish the spell; at four, channel 4 and draw 1' }),
]);

// Pridestalker
card('unl-183-219', "When you play a unit, give a unit +1 [S] this turn.", [
  whenYouPlay(F.unit, E.might(0, 1), { targets: [T.unit({ hint: 'help', prompt: 'Give a unit +1 [S] this turn' })], text: 'Give a unit +1 [S] this turn' }),
]);

// Piltover Enforcer — the engine's excess record (conquer event `excess`: damage assigned beyond lethal in that combat)
card('unl-187-219', "When you conquer, if you assigned 3 or more excess damage, you may exhaust me to ready a unit.", [
  whenYouConquer(E.ready(0), { if: ctx => Number(ctx.event?.excess ?? 0) >= 3, optional: 'Exhaust Piltover Enforcer to ready a unit?', cost: cost('[T]'), targets: [T.unit({ hint: 'help', prompt: 'Ready a unit' })], text: 'Ready a unit' }),
]);

// Gloomist
card('unl-193-219', "When you or an ally hold, you may exhaust me to draw 1.", [
  when('hold', (ev, ctx) => friendlyPlayer(ctx, ev.player) && notExhausted(ctx), E.draw(1), { optional: 'Exhaust Gloomist to draw 1?', cost: cost('[T]'), text: 'Draw 1' }),
]);

// Green Father
card('unl-195-219', "When you conquer or hold, you may exhaust me to replace that battlefield with a Brush battlefield token.", [
  // no "not a Brush" condition (not in its text): a Brush may be Brushed (UNL-FAQ, DECISIONS #9356; RJ#9853 swap back, then re-Brush)
  when(['conquer', 'hold'], (ev, ctx) => ev.player === ctx.controller && typeof ev.bf === 'number' && notExhausted(ctx),
    ctx => { ctx.replaceBattlefield(ctx.event!.bf as number, 'Brush'); },
    { optional: 'Exhaust Green Father to replace that battlefield with Brush?', cost: cost('[T]'), text: 'Replace that battlefield with Brush' }),
]);

// Scorn of the Moon — usable only during showdowns (B8-7: no "only during showdowns" spending restriction).
card('unl-197-219', "[Reaction][>] [T]: [Add] [1]. Spend this Energy only during showdowns.", [
  mana('[T]', { energy: 1 }, { if: ctx => ctx.inShowdown(), text: 'Add [1] (showdowns only)' }),
]);

// Deceiver
// "It" = every token the (possibly replacement-modified) play produced: Zilean, Time Mage's additional copy too (official UNL-FAQ,
// CR 375; DECISIONS #9917, RJ#9917) — one choice of the unit to copy, applied to each
const deceiverToks = (ctx: Ctx): ObjId[] => ((ctx.data.toks as { id: ObjId; epoch: number }[] | undefined) ?? [])
  .filter(x => ctx.onBoard(x.id) && (ctx.obj(x.id).epoch ?? 0) === x.epoch).map(x => x.id);
const deceiverCopy = reflexiveAbility('B8:deceiver:copy', {
  targets: [T.unit((c, id) => { const ts = deceiverToks(c); return ts.length > 0 && !ts.includes(id) && c.loc(id) === c.loc(ts[0]); }, { prompt: 'The Reflection becomes a copy of another unit there', hint: 'neutral' })],
  effect: ctx => {
    const of = ctx.target(0);
    for (const tok of deceiverToks(ctx)) {
      if (of) ctx.becomeCopy(tok, of);
      ctx.giveKeyword(tok, 'Temporary', 'permanent');
    }
  },
  text: 'Deceiver: it becomes a copy of another unit there; give it [Temporary]',
});
card('unl-199-219', "When you conquer or hold, you may discard 1 and exhaust me to play a ready Reflection unit token there. Then do this: It becomes a copy of another unit there. Give it [Temporary].", [
  when(['conquer', 'hold'], (ev, ctx) => ev.player === ctx.controller && typeof ev.bf === 'number' && notExhausted(ctx) && ctx.hand().length > 0, ctx => {
    const bf = ctx.event!.bf as number;
    const made = ctx.createToken('Reflection', bf, { exhausted: false });
    const tok = made[0];
    if (!tok) return;
    // RJ#10484 / CR 388-389: "Then do this:" is its own reflexive chain item (players may respond while the token is 0 Might);
    // the unit to copy is chosen as that item is finalized
    ctx.reflexive(deceiverCopy, { toks: made.map(id => ({ id, epoch: ctx.obj(id)?.epoch ?? 0 })), bf });
  }, { optional: 'Discard 1 and exhaust Deceiver to play a Reflection there?', cost: cost('[T]', pay.discard(1)), text: 'Play a Reflection copy there' }),
]);

// Butcher of the Sands — "activated abilities of units" can't be told apart (B8-7): units only.
card('ven-141-166', "[Reaction][>] [A][A], [T]: [Add] [2]. Spend this Energy only to play units or activated abilities of units.", [
  mana('[A][A], [T]', { energy: 2, only: 'unit' }, { text: 'Add [2] (units only)' }),
]);

// Curator of the Sands
const curatorEffect = { optional: 'Exhaust Curator of the Sands to ready up to 2 runes?', cost: cost('[T]'), text: 'Ready up to 2 runes' };
card('ven-145-166', "When you play a unit, gear, or activated ability with Energy cost [7] or more, you may exhaust me to ready up to 2 runes.", [
  when('play', (ev, ctx) => ev.player === ctx.controller && !ev.token && ctx.exists(ev.obj as ObjId) && (ctx.isUnit(ev.obj as ObjId) || ctx.isGear(ev.obj as ObjId)) && ctx.energyCost(ev.obj as ObjId) >= 7 && notExhausted(ctx),
    readyUpTo2Runes, curatorEffect),
  when('activated', (ev, ctx) => {
    if (ev.player !== ctx.controller || ev.isAdd || !ctx.exists(ev.obj as ObjId) || !notExhausted(ctx)) return false;
    const ref = abilityByIndex(ctx.g, ev.obj as ObjId, Number(ev.index));
    return !!ref && ref.ability.kind === 'activated' && (ref.ability.cost.energy ?? 0) >= 7;
  }, readyUpTo2Runes, curatorEffect),
]);

// Eye of Twilight
card('ven-147-166', "[Action][>] [T]: Give a friendly unit [Tank] this turn.", [
  activated('[T]', E.keyword(0, 'Tank'), { timing: 'action', targets: [T.unit(F.friendly, { hint: 'help', prompt: 'Give a friendly unit [Tank] this turn' })], text: 'Give a friendly unit [Tank] this turn' }),
]);

// =============================================================================================
// Hostile Takeover / Neeko / misc units
// =============================================================================================

card('sfd-202-221', "[Hidden]\nTake control of an enemy unit at a battlefield. Ready it.\nLose control of that unit and recall it at end of turn.", [
  spell(ctx => {
    const t = ctx.target(0);
    if (!t) return;
    const from = ctx.ctrl(t);
    ctx.takeControl(t);
    ctx.ready(t);
    ctx.delay(D.returnControlAtEnd, { obj: t, to: from, recall: true }, 'endOfTurn');
  }, { targets: [T.unit(F.enemy, F.atBattlefield, { hint: 'harm', prompt: 'Take control of an enemy unit at a battlefield' })] }),
]);

// Neeko, Blending In — the extra legends come from DeckList.extraLegends (deck validation of them: B8-14).
const neekoLeave = delayedAbility('B8:neeko:leave', when('leaveBoard', (ev, ctx) => ev.obj === ctx.data.neeko, ctx => {
  const l = ctx.data.legend as ObjId;
  if (ctx.exists(l) && ctx.obj(l).zone === 'legendZone') setAside(ctx, l);
  ctx.g.ex.delayed = ctx.g.ex.delayed.filter(d => !(d.key === neekoLeave && d.data.neeko === ctx.data.neeko && d.data.legend === l));
}, { text: 'Neeko left the board: remove that legend' }));
card('rad-167-167', "If Neeko is in your deck, choose up to 3 different legends in addition to your starting legend.\nWhen you play me, choose one of those Legends and add it to your Legend Zone while I'm on the board.", [
  onPlay(ctx => {
    const cands = (ctx.g.ex.extraLegends[ctx.controller] ?? []).filter(id => ctx.exists(id) && ctx.obj(id).zone === 'setAside');
    if (!cands.length || !ctx.onBoard(ctx.self)) return;
    const l = ctx.chooseCards(cands, 1, 1, 'Choose a legend to add to your Legend Zone')[0];
    if (!l) return;
    putInLegendZone(ctx, l, ctx.controller);
    ctx.delay(neekoLeave, { neeko: ctx.self, legend: l }, 'never');
  }, { text: 'Add one of your extra legends to your Legend Zone' }),
]);

// Minotaur Reckoner — the engine checks cantMove both for standard-move legality and for moves by effects.
card('sfd-014-221', "Units can't move to base.", [
  rule('cantMove', (_ctx, _u: ObjId, _from: unknown, to: unknown) => to === 'base', undefined, { text: "Units can't move to base" }),
]);

// Tianna Crownguard
card('sfd-060-221', "[Deflect]\nWhile I'm at a battlefield, opponents can't gain points.", [
  rule('cantGainPoints', (ctx, p: PlayerId) => atBf(ctx) && ctx.isOpponent(p), undefined, { text: "Opponents can't gain points" }),
]);

// Ruin Runner
card('sfd-105-221', "I can't be chosen by enemy spells and abilities.", [
  statik('self', { cantBeChosenByEnemy: true }, { text: "I can't be chosen by enemy spells and abilities" }),
]);

// Irelia, Graceful
card('sfd-141-221', "Your spells that choose me cost [1] or [A] less.", [
  costModDyn((ctx, id) => (payer(ctx) === ctx.controller && ctx.isSpell(id) && itemTargets(ctx).includes(ctx.self) ? oneOrA(ctx.energyCost(id)) : null), { text: 'Your spells that choose me cost [1] or [A] less' }),
]);

// Vex, Cheerless
card('sfd-146-221', "While I'm in combat, friendly spells cost [1][A] less to a minimum of [1], and enemy spells cost [1][A] more.", [
  costModDyn((ctx, id) => {
    if (!ctx.obj(ctx.self)?.combatRole || !ctx.inCombat() || !ctx.isSpell(id)) return null;
    if (ctx.isOpponent(payer(ctx))) return { energy: 1, power: 1 };
    return { energy: -discountMin1(ctx, id, 1), power: -1 };
  }, { text: 'Friendly spells cost [1][A] less, enemy spells [1][A] more' }),
]);

// Ezreal, Prodigy — optional additional costs: Accelerate / script optional costs ('additional') and Repeat.
function optionalCostEnergy(ctx: Ctx, id: ObjId): number {
  const s = getScript(ctx.obj(id).cardId);
  const opt = s?.additionalCosts?.find(a => a.optional);
  if (opt) return opt.cost.energy ?? 0;
  return s?.costs?.Accelerate ? (s.costs.Accelerate.energy ?? 0) : 1;   // Accelerate: [1][C]
}
card('sfd-149-221', "When you play me, discard 1, then draw 2.\nOptional additional costs you pay cost [1] or [A] less.", [
  onPlay(ctx => { ctx.discard(1); ctx.draw(2); }, { text: 'Discard 1, then draw 2' }),
  costModDyn((ctx, id) => (payer(ctx) === ctx.controller ? oneOrA(optionalCostEnergy(ctx, id)) : null), { scope: 'additional', text: 'Optional additional costs cost [1] or [A] less' }),
  costModDyn((ctx, id) => (payer(ctx) === ctx.controller ? oneOrA(((ctx.item?.choices.grantedRepeat as { energy?: number } | undefined) ?? keywordCost(ctx.g, id, 'Repeat'))?.energy ?? 0) : null), { scope: 'repeat', text: 'Repeat costs cost [1] or [A] less' }),
]);

// Alpha Wildclaw
card('unl-057-219', "[Tank]\nYour units here with less Might than me can't be chosen by enemy spells and abilities.", [
  anthem((c, id) => id !== c.self && c.isUnit(id) && c.ctrl(id) === c.controller && c.isHere(id) && c.might(id) < c.might(c.self), { cantBeChosenByEnemy: true },
    { text: "Your units here with less Might than me can't be chosen by enemies" }),
]);

// Zilean, Time Mage
card('unl-086-219', "Once each turn, if you would play a token unit while I'm at a battlefield, you may play that token and an additional copy of it instead.", [
  replacement('createToken', (ev, ctx) => {
    const d = ctx.g.cards[String(ev.cardId)];
    return ev.player === ctx.controller && atBf(ctx) && !!d && (d.type === 'Unit' || d.might !== null);
  }, ev => ({ ...ev, copies: Number(ev.copies ?? 1) + 1 }), { optional: 'Zilean: play an additional copy of that token?', oncePerTurn: 1, text: 'Play an additional copy of the token' }),
]);

// Blue Sentinel
const sentinelAdd = delayedAbility('B8:sentinel:add', when('mainStart', (ev, ctx) => ev.player === ctx.controller,
  ctx => ctx.add(0, ['any']), { isAdd: true, text: 'Add [A]' }));
card('unl-087-219', "[Shield 2]\nYour hold effects for holding here trigger an additional time.\nWhen I hold, [Add] [A] at the start of your next Main Phase.", [
  rule('extraTriggers', (ctx, qt: QueuedTrigger) => {
    const ev = qt.event;
    if (ev.type !== 'hold' || ev.player !== ctx.controller || ev.bf !== ctx.here() || !atBf(ctx)) return false;
    // "for holding here": a hold effect that Skyfall of Areion made fire for a conquest is not for holding (RJ#12659/#12660, ENGINE-9)
    if (ev.fromType === 'conquer') return false;
    const src = qt.source;
    const isBfCard = !!src && ctx.g.battlefields.some(b => b.objId === src);
    return qt.controller === ctx.controller || isBfCard;
  }, 1, { text: 'Your hold effects here trigger an additional time' }),
  onHold(ctx => ctx.delay(sentinelAdd, {}, 'never', 1), { text: '[Add] [A] at the start of your next Main Phase' }),
]);

// LeBlanc, Everywhere at Once
card('unl-090-219', "[Backline]\nYour [Temporary] effects at my battlefield don't trigger.", [
  rule('noTemporary', (ctx, u: ObjId) => atBf(ctx) && ctx.exists(u) && ctx.ctrl(u) === ctx.controller && ctx.loc(u) === ctx.loc(ctx.self), undefined, { text: "Your [Temporary] effects here don't trigger" }),
]);

// Determined Sentry
card('unl-111-219', "I can't move to base.", [
  rule('cantMove', (ctx, u: ObjId, _from: unknown, to: unknown) => u === ctx.self && to === 'base', undefined, { text: "I can't move to base" }),
]);

// Maduli the Gatekeeper
const enemyMightAt = (ctx: Ctx, bf: number) => ctx.unitsAt(bf, u => ctx.isEnemy(u)).reduce((s, u) => s + ctx.might(u), 0);
const maduliDests = (ctx: Ctx) => ctx.battlefields().filter(bf => bf !== ctx.loc(ctx.self) && ctx.unitsAt(bf, u => ctx.isEnemy(u)).length > 0 && ctx.might(ctx.self) > enemyMightAt(ctx, bf));
card('unl-144-219', "I can't be readied.\n[C]: Move me to an occupied enemy battlefield if my Might is greater than the total Might of enemy units there.", [
  rule('cantReady', (ctx, id: ObjId) => id === ctx.self, undefined, { text: "I can't be readied" }),
  activated('[C]', ctx => {
    const bf = ctx.destination(0);
    if (typeof bf === 'number' && ctx.canMoveTo(ctx.self, bf)) ctx.move(ctx.self, bf);
  }, { if: ctx => maduliDests(ctx).length > 0, text: 'Move me to an occupied enemy battlefield',
    // R-2 (CR 355.4): the destination is chosen as the ability is activated; the Might condition is checked again on resolution
    targets: [T.destination(F.dest((c, l) => typeof l === 'number' && maduliDests(c).includes(l)), { prompt: 'Move Maduli to' })] }),
]);

// Dune Surfer
card('ven-004-166', "You ignore [Tank] while assigning combat damage here.", [
  rule('ignoreTank', (ctx, assigner: PlayerId, bf: number) => assigner === ctx.controller && ctx.loc(ctx.self) === bf, undefined, { text: 'You ignore [Tank] here' }),
]);

// Esteemed Hierophant
card('ven-025-166', "While you control 7 or more runes, prevent all damage that enemy spells and abilities would deal to me.", [
  replacement('damage', (ev, ctx) => ev.obj === ctx.self && !ev.combat && isOpp(ctx, ev.player) && ctx.runes().length >= 7, () => null, { text: 'Prevent damage from enemy spells and abilities' }),
]);

// Ol' Poro — engine cantPlay rule on the card itself (checked for every play, also by effects: R-13)
card('ven-029-166', "I can't be played on your first, second, or third turns.", [
  rule('cantPlay', (ctx, id: ObjId) => id === ctx.self && ctx.isMyTurn() && turnNumberOf(ctx, ctx.controller) <= 3, undefined, { text: "I can't be played on your first, second, or third turns." }),
]);

// Sandstone Chimera
card('ven-036-166', "While I'm at a battlefield, players only channel 1 rune at the start of their Channel Phase.", [
  rule('channelCount', () => true, ctx => (atBf(ctx) ? 1 : 2), { text: 'Players channel only 1 rune in their Channel Phase' }),
]);

// Otterpus
card('ven-053-166', "If a player would score 1 point from conquering or holding during their first or second turn, they draw 1 instead.", [
  replacement('score', (ev, ctx) => (ev.how === 'conquer' || ev.how === 'hold') && ctx.g.activePlayer === ev.player && turnNumberOf(ctx, ev.player as PlayerId) <= 2,
    ev => ({ ...ev, type: 'draw', n: 1 }), { text: 'Draw 1 instead of scoring (first or second turn)' }),
]);

// Spiderling — the deck rule is read by the engine's deck validation ("any number of cards named").
card('ven-097-166', "[Hidden]\nI have +1 [S] for each other unit you control here with my name.\nYour deck can have any number of cards named Spiderling.", [
  selfMight(ctx => { const h = ctx.here(); return h === null ? 0 : ctx.unitsAt(h, u => u !== ctx.self && ctx.ctrl(u) === ctx.controller && ctx.name(u) === ctx.name(ctx.self)).length; },
    { text: '+1 [S] for each other Spiderling you control here' }),
]);

// Fallen Feline
const felineLock = delayedAbility('B8:feline:lock', rule('cantPlay', (ctx, id: ObjId, p: PlayerId) => {
  const f = ctx.data.obj as ObjId;
  if (!ctx.exists(f) || (ctx.obj(f).epoch ?? 0) !== ctx.data.epoch || !ctx.atBattlefield(f)) return false;
  return ctx.isOpponent(p) && ctx.isSpell(id) && ctx.name(id) === ctx.data.name;
}, undefined, { text: "Opponents can't play spells with the named name" }));
card('ven-132-166', "When you play me, name a spell.\nWhile I'm at a battlefield, opponents can't play spells with that name.", [
  onPlay(ctx => {
    const name = ctx.nameCard(cid => ctx.g.cards[cid].type === 'Spell', 'Name a spell');
    if (!name) return;
    ctx.log(`names ${name}`);
    ctx.delay(felineLock, { obj: ctx.self, epoch: ctx.obj(ctx.self)?.epoch ?? 0, name }, 'never');
  }, { text: 'Name a spell' }),
]);

// =============================================================================================
// Battlefields
// =============================================================================================

card('ogn-276-298', "Increase the points needed to win the game by 1.", [
  rule('victoryScoreDelta', undefined, 1, { text: '+1 to the Victory Score' }),
]);

card('ogn-277-298', "When a unit moves from here, give it +1 [S] this turn.", [
  when('move', (ev, ctx) => ev.from === ctx.bfIndex() && ctx.exists(ev.obj as ObjId), E.might(R.eventObj, 1), { text: 'The unit gets +1 [S] this turn' }),
]);

card('ogn-278-298', "You may hide an additional card here.", [
  rule('extraHide', (ctx, _p: PlayerId, bf: number) => bf === ctx.bfIndex(), 1, { text: 'You may hide an additional card here' }),
]);

card('ogn-279-298', "When you defend here, choose a unit. It gains [Shield 2] this combat.", [
  // RULINGS sweep / CR 403.2, 355.5: the unit is a target chosen as the trigger goes on the chain
  defendHere(ctx => { const u = ctx.target(0); if (u) ctx.giveKeyword(u, 'Shield 2', 'endOfCombat'); }, undefined,
    { targets: [T.unit({ hint: 'help', prompt: 'Choose a unit: it gains [Shield 2] this combat' })], text: 'A unit gains [Shield 2] this combat' }),
]);

card('ogn-280-298', "When you hold here, draw 1.", [
  holdHere(ctx => ctx.draw(1), undefined, { text: 'Draw 1' }),
]);

card('ogn-281-298', "When you hold here, you may return your Chosen Champion from your trash to your Champion Zone if it is empty.", [
  // any copy with the Chosen Champion's name counts (CR 103.3.a.3; RJ#7080); the leading "you may" is decided as the trigger is
  // chained (principle 11) and the copy is picked on resolution (several copies are identical)
  holdHere(ctx => {
    if (ctx.g.players[ctx.controller].championZone.length > 0) return;
    const copies = chosenChampionsInTrash(ctx, ctx.controller);
    const ch = copies.length > 1 ? ctx.chooseCards(copies, 1, 1, 'Return which copy of your Chosen Champion?')[0] : copies[0];
    if (ch) putInChampionZone(ctx, ch);
  }, undefined, {
    optional: 'Hallowed Tomb: return your Chosen Champion from your trash to your Champion Zone?',
    offerIf: ctx => ctx.g.players[ctx.controller].championZone.length === 0 && chosenChampionsInTrash(ctx, ctx.controller).length > 0,
    text: 'Return your Chosen Champion to your Champion Zone',
  }),
]);

const monasteryBuffed = (ctx: Ctx) => ctx.units(u => ctx.isBuffed(u) && ctx.ctrl(u) === ctx.controller);
card('ogn-282-298', "When you conquer here, you may spend a buff to draw 1.", [
  // RULINGS sweep / CR 383.3.b: spending the buff is the trigger's base cost, paid as it goes on the chain (the conqueror
  // controls the battlefield by then, so the trigger and its cost are theirs)
  conquerHere(ctx => { ctx.draw(1); }, undefined, {
    optional: 'Monastery of Hirana: spend a buff to draw 1?',
    cost: cost('', pay.custom('Spend a buff', c => monasteryBuffed(c).length > 0, c => {
      const u = c.chooseCards(monasteryBuffed(c), 1, 1, 'Spend a buff from')[0];
      return !!u && c.spendBuff(u);
    })),
    text: 'You may spend a buff to draw 1',
  }),
]);

card('ogn-283-298', "When you hold here, buff a unit here.", [
  // RULINGS sweep / CR 403.2, 355.5: the unit is a target chosen as the trigger goes on the chain
  holdHere(ctx => { const u = ctx.target(0); if (u) ctx.buff(u); }, undefined, { targets: [T.unit(F.here, { hint: 'help', prompt: 'Buff a unit here' })], text: 'Buff a unit here' }),
]);

const firstBeginning = (ev: GameEvent, ctx: Ctx) => typeof ev.player === 'number' && ctx.g.players[ev.player as PlayerId].turnsTaken === 0;
card('ogn-284-298', "At the start of each player's first Beginning Phase, that player channels 1 rune.", [
  when('beginningPhase', firstBeginning, ctx => ctx.as(evPlayer(ctx)).channel(1), { text: 'That player channels 1 rune' }),
]);

card('ogn-286-298', "When you hold here, activate the conquer effects of units here.", [
  holdHere(ctx => { activateConquerEffects(ctx, ctx.unitsAt(ctx.bfIndex(), u => ctx.ctrl(u) === ctx.controller), ctx.bfIndex(), ctx.controller); }, undefined, { text: 'Activate the conquer effects of units here' }),
]);

card('ogn-287-298', "When you conquer here, you must recycle one of your runes.", [
  conquerHere(ctx => { const r = ctx.chooseCards(ctx.runes(), 1, 1, 'Recycle one of your runes')[0]; if (r) ctx.recycle(r); }, undefined, { text: 'Recycle one of your runes' }),
]);

card('ogn-288-298', "When you hold here, you may channel 1 rune exhausted.", [
  // RJ#1451 / CR 383.3.a: the leading "you may" is decided as the trigger goes on the chain; declining removes it
  holdHere(ctx => { ctx.channel(1, true); }, undefined, { optional: 'Startipped Peak: channel 1 rune exhausted?', text: 'You may channel 1 rune exhausted' }),
]);

const targonReady = delayedAbility('B8:targon:ready', when('endOfTurn', null, readyUpTo2Runes, { text: 'Ready up to 2 runes' }));
card('ogn-289-298', "When you conquer here, ready up to 2 runes at the end of this turn.", [
  conquerHere(ctx => ctx.delay(targonReady, {}, 'endOfTurn', 1), undefined, { text: 'Ready up to 2 runes at the end of this turn' }),
]);

card('ogn-290-298', "At the start of each player's first Beginning Phase, that player gains 1 point.", [
  when('beginningPhase', firstBeginning, ctx => { ctx.as(evPlayer(ctx)).gainPoints(1); }, { text: 'That player gains 1 point' }),
]);

card('ogn-291-298', "When you conquer here, look at the top two cards of your Main Deck. You may recycle one or both of them. Put those you don't back in any order.", [
  conquerHere(ctx => {
    const top = ctx.lookTop(2);
    if (!top.length) return;
    const rec = ctx.chooseCards(top, 0, top.length, 'Recycle any of these cards (the rest go back on top)');
    if (rec.length) ctx.recycle(rec);
    const rest = top.filter(id => !rec.includes(id));
    if (rest.length === 2) {
      const first = ctx.chooseCards(rest, 1, 1, 'Choose the card to put on top')[0];
      const second = rest.find(id => id !== first)!;
      ctx.toDeck(second, 'top'); ctx.toDeck(first, 'top');
    }
  }, undefined, { text: 'Look at the top two cards; recycle any; reorder the rest' }),
]);

card('ogn-292-298', "When a player chooses a friendly unit here with a spell for the first time each turn, they draw 1.", [
  when('targeted', (ev, ctx) => {
    const u = ev.obj as ObjId, src = ev.source as ObjId, p = ev.player as PlayerId;
    if (typeof p !== 'number' || !ctx.exists(u) || !ctx.isUnit(u) || ctx.loc(u) !== ctx.bfIndex()) return false;
    if (ctx.as(p).isEnemy(u)) return false;
    if (!ctx.exists(src) || ctx.obj(src).zone !== 'chain' || !ctx.isSpell(src)) return false;
    return firstThisTurn(ctx, `p${p}`);
  }, ctx => ctx.as(evPlayer(ctx)).draw(1), { text: 'They draw 1' }),
]);

card('ogn-293-298', "When you hold here, if you have 7+ units here, you win the game.", [
  // "When you hold here, if ..." is a trigger condition (CR 383.2.a.1): with fewer units nothing goes on the chain (RJ#10451)
  holdHere(ctx => ctx.winGame(ctx.controller, 'The Grand Plaza'),
    (_ev, ctx) => ctx.unitsAt(ctx.bfIndex(), u => ctx.ctrl(u) === ctx.controller).length >= 7, { text: 'Win the game with 7+ units here' }),
]);

card('ogn-294-298', "Units here have +1 [S].", [
  anthem(unitsHere, { might: 1 }, { text: 'Units here have +1 [S]' }),
]);

card('ogn-295-298', "Units can't move from here to base.", [
  rule('cantMove', (ctx, _u: ObjId, from: unknown, to: unknown) => from === ctx.bfIndex() && to === 'base', undefined, { text: "Units can't move from here to base" }),
]);

card('ogn-296-298', "Spells and abilities deal 1 Bonus Damage to units here.", [
  // spells and abilities only: not combat damage, not damage a spell names units as dealing (Challenge, CR 418.6.b.3; RJ#8373)
  replacement('damage', (ev, ctx) => !ev.combat && !ev.unitDealt && ctx.exists(ev.obj as ObjId) && ctx.loc(ev.obj as ObjId) === ctx.bfIndex(), ev => ({ ...ev, amount: Number(ev.amount) + 1 }), { text: '1 Bonus Damage to units here', bonus: () => 1 }),
]);

card('ogn-297-298', "Units here have [Ganking].", [
  anthem(unitsHere, { keywords: ['Ganking'] }, { text: 'Units here have [Ganking]' }),
]);

card('ogn-298-298', "When you conquer here, discard 1, then draw 1.", [
  conquerHere(ctx => { ctx.discard(1); ctx.draw(1); }, undefined, { text: 'Discard 1, then draw 1' }),
]);

card('rad-158-167', "[A][A]: Draw 1. Each player may use this ability once on their turn.", [
  activated('[A][A]', E.draw(1), { anyPlayer: true, text: 'Draw 1' }),
]);

card('rad-160-167', "When you hold here, if your Rune Deck is empty, you score 1 point.", [
  holdHere(ctx => { if (ctx.g.players[ctx.controller].runeDeck.length === 0) ctx.scorePoint(ctx.controller, 1); }, undefined, { text: 'Score 1 point if your Rune Deck is empty' }),
]);

card('rad-161-167', "When you defend here, choose a unit you control here. Give it [Tank] this combat.", [
  // RULINGS sweep / CR 403.2, 355.5: the unit is a target chosen as the trigger goes on the chain (by the battlefield's
  // controller, the defending player)
  defendHere(ctx => { const u = ctx.target(0); if (u) ctx.giveKeyword(u, 'Tank', 'endOfCombat'); }, undefined,
    { targets: [T.unit(F.youControl, F.here, { hint: 'help', prompt: 'Give a unit you control here [Tank] this combat' })], text: 'A unit you control here gets [Tank] this combat' }),
]);

// Firelights' Hideout — the keyword is put on the player's unit cards in hand / Champion Zone / facedown
// (and on cards drawn later this turn) and taken off again when the next unit is played (B8-16).
const fhNote = 'B8:firelights';
function fhGrant(ctx: Ctx, ids: ObjId[]): void {
  for (const id of ids) {
    const o = ctx.obj(id);
    if (!o || !ctx.isUnit(id) || o.modifiers.some(m => m.note === fhNote)) continue;
    ctx.giveKeyword(id, 'Accelerate', 'endOfTurn');
    const m = o.modifiers[o.modifiers.length - 1];
    if (m) m.note = fhNote;
  }
}
function fhUnitCards(ctx: Ctx, p: PlayerId): ObjId[] {
  const pl = ctx.g.players[p];
  const fd = Object.values(ctx.g.objects).filter(o => o.zone === 'facedown' && o.controller === p).map(o => o.id);
  return [...pl.hand, ...pl.championZone, ...fd];
}
const fhNext = delayedAbility('B8:firelights:next', when(['play', 'draw', 'returnToHand'], (ev, ctx) => {
  if (ctx.data.done) return false;
  if (ev.type === 'play') {
    // RULINGS: a unit token is a unit (CR 185.2.d), so playing one uses up "the next unit you play this turn"
    if (ev.player !== ctx.controller || !ctx.exists(ev.obj as ObjId) || !ctx.isUnit(ev.obj as ObjId)) return false;
    ctx.data.done = true;
    for (const id in ctx.g.objects) { const o = ctx.g.objects[id]; if (o.modifiers.some(m => m.note === fhNote)) o.modifiers = o.modifiers.filter(m => m.note !== fhNote); }
    return false;
  }
  const id = ev.obj as ObjId;
  if (ctx.exists(id) && ctx.obj(id).zone === 'hand' && ctx.owner(id) === ctx.controller) fhGrant(ctx, [id]);
  return false;
}, () => {}, { text: '(next unit has Accelerate)' }));
card('rad-162-167', "When you conquer here, the next unit you play this turn has [Accelerate].", [
  conquerHere(ctx => { fhGrant(ctx, fhUnitCards(ctx, ctx.controller)); ctx.delay(fhNext, {}, 'endOfTurn'); }, undefined, { text: 'The next unit you play this turn has [Accelerate]' }),
]);

// Hunters' Circle — uses the play destination the engine passes to cost modifiers (ctx.data.dest).
card('rad-163-167', "For each player, the first unit or gear they play here on their turn costs [1] less.", [
  costModDyn((ctx, id) => {
    const p = payer(ctx);
    if (ctx.data.dest !== ctx.bfIndex() || ctx.g.activePlayer !== p || !(ctx.isUnit(id) || ctx.isGear(id))) return null;
    if (usedThisTurn(ctx, `p${p}`)) return null;
    return { energy: -1 };
  }, { text: 'The first unit or gear each player plays here on their turn costs [1] less' }),
  listen('play', (ev, ctx) => { if (ev.loc === ctx.bfIndex() && !ev.token && ctx.g.activePlayer === ev.player) markThisTurn(ctx, `p${ev.player}`); }),
]);

card('rad-164-167', "Champion units here have +1 [S].", [
  anthem((c, id) => unitsHere(c, id) && c.isChampion(id), { might: 1 }, { text: 'Champion units here have +1 [S]' }),
]);

card('rad-165-167', "For each player, the first time they play a unit or gear here each turn, they [Predict].", [
  when('play', (ev, ctx) => ev.loc === ctx.bfIndex() && typeof ev.player === 'number' && ctx.exists(ev.obj as ObjId) && (ctx.isUnit(ev.obj as ObjId) || ctx.isGear(ev.obj as ObjId)) && firstThisTurn(ctx, `p${ev.player}`),
    ctx => ctx.as(evPlayer(ctx)).predict(1), { text: 'That player predicts' }),
]);

card('rad-166-167', "When you conquer here, you may discard 1 and channel 1 rune exhausted.", [
  // principle 11 (CR 383.3.a-b): the leading "you may" (and its cost) is decided as the trigger is chained (ENGINE-6)
  conquerHere(ctx => { if (ctx.discard(1).length) ctx.channel(1, true); }, undefined, { payer: evPlayer, optional: 'Discard 1 and channel 1 rune exhausted?', offerIf: ctx => ctx.as(evPlayer(ctx)).hand().length > 0, text: 'You may discard 1 and channel 1 rune exhausted' }),
]);

// Forge of the Fluft
const fluftAttach = grantable('B8:fluft:attach', activated('[T]', ctx => {
  const g = ctx.target(0), u = ctx.target(1);
  if (g && u) ctx.attach(g, u);
}, { targets: [T.gear(F.equipment, F.youControl, { prompt: 'Choose an Equipment you control', hint: 'help' }), T.unit(F.youControl, { prompt: 'Attach it to a unit you control', hint: 'help' })], text: 'Attach an Equipment you control to a unit you control' }));
card('sfd-208-221', "While you control this battlefield, friendly legends have \"[T]: Attach an Equipment you control to a unit you control.\"", [
  statik((c, id) => { const p = bfCtl(c); return p !== null && c.obj(id)?.zone === 'legendZone' && !c.as(p).isOpponent(c.ctrl(id)); }, { grants: [fluftAttach] }, { text: 'Friendly legends have "[T]: Attach an Equipment..."' }),
]);

card('sfd-209-221', "Players can't score here until their third turn.", [
  rule('cantScore', (ctx, p: PlayerId, bf: number) => bf === ctx.bfIndex() && turnNumberOf(ctx, p) < 3, undefined, { text: "Players can't score here until their third turn" }),
]);

card('sfd-210-221', "When you conquer here, you may pay [1] to ready your legend.", [
  // MA-6 (CR 383.3.a-b, DECISIONS principle 11): the "you may pay [1]" is decided and paid as the trigger goes on the chain
  conquerHere(ctx => { const l = ctx.legend(); if (ctx.exists(l)) ctx.ready(l); }, undefined, {
    offerIf: ctx => { const l = ctx.legend(); return ctx.exists(l) && ctx.isExhausted(l); },
    optional: 'Hall of Legends: pay [1] to ready your legend?', cost: cost('[1]'), text: 'You may pay [1] to ready your legend' }),
]);

card('sfd-211-221', "While you control this battlefield, friendly [Repeat] costs cost [1] less.", [
  costModDyn(ctx => { const p = bfCtl(ctx); return p !== null && !ctx.as(p).isOpponent(payer(ctx)) ? { energy: -1 } : null; }, { scope: 'repeat', text: 'Friendly [Repeat] costs cost [1] less' }),
]);

card('sfd-213-221', "While you control this battlefield, the first friendly non-token gear played each turn costs [1] less.", [
  costModDyn((ctx, id) => {
    const p = bfCtl(ctx);
    if (p === null || payer(ctx) !== p || !isGearCard(ctx, id) || ctx.isToken(id)) return null;
    const before = ctx.playedThisTurn(p).filter(x => x !== id && ctx.exists(x) && ctx.g.cards[ctx.obj(x).cardId]?.type === 'Gear' && !ctx.isToken(x));
    return before.length === 0 ? { energy: -1 } : null;
  }, { text: 'The first friendly non-token gear each turn costs [1] less' }),
]);

card('sfd-214-221', "When you hold here, you may pay [A][A][A][A] to score 1 point.", [
  // principle 11 (CR 383.3.a-b): the leading "may pay" is decided and paid as the trigger is chained (ENGINE-6, as RJ#12403)
  holdHere(ctx => ctx.scorePoint(ctx.controller, 1), undefined, { payer: evPlayer, optional: 'Power Nexus: pay [A][A][A][A] to score 1 point?', cost: cost('[A][A][A][A]'), text: 'You may pay [A][A][A][A] to score 1 point' }),
]);

card('sfd-216-221', "Units can't be played here.", [
  rule('cantPlay', (ctx, id: ObjId, _p: PlayerId, dest: unknown) => dest === ctx.bfIndex() && ctx.isUnit(id), undefined, { text: "Units can't be played here" }),
  // RJ#10713 / #6500: unit tokens played here by abilities aren't played either (the instruction does nothing)
  rule('cantPlayToken', (ctx, id: ObjId, _p: PlayerId, dest: unknown) => dest === ctx.bfIndex() && ctx.isUnit(id), undefined, { text: "Unit tokens can't be played here" }),
]);

card('sfd-217-221', "When you conquer here, draw 1 for each other battlefield you or allies control.", [
  conquerHere(ctx => { const n = ctx.battlefields().filter(b => b !== ctx.bfIndex() && ctx.bfController(b) !== null && !ctx.isOpponent(ctx.bfController(b)!)).length; if (n) ctx.draw(n); }, undefined, { text: 'Draw 1 for each other battlefield you control' }),
]);

card('sfd-218-221', "When you conquer here with one or more [Mighty] units, you may pay [1] to draw 1.", [
  // MA-6: the "you may pay [1]" is decided and paid as the trigger goes on the chain (CR 383.3.a-b)
  conquerHere(ctx => { ctx.draw(1); },
    (ev, ctx) => ((ev.units as ObjId[] | undefined) ?? []).some(u => ctx.exists(u) && ctx.isMighty(u)), { optional: 'Sunken Temple: pay [1] to draw 1?', cost: cost('[1]'), text: 'You may pay [1] to draw 1' }),
]);

card('sfd-219-221', "When you hold here, each player channels 1 rune exhausted.", [
  holdHere(ctx => ctx.eachPlayer(p => { ctx.channel(1, true, p); }), undefined, { text: 'Each player channels 1 rune exhausted' }),
]);

card('unl-205-219', "When a player plays a spell, they may give a unit they control here +1 [S] this turn.", [
  when('play', (ev, ctx) => ev.cardType === 'Spell' && typeof ev.player === 'number' && ctx.unitsAt(ctx.bfIndex(), u => ctx.ctrl(u) === ev.player).length > 0, ctx => {
    const c = ctx.as(evPlayer(ctx));
    const u = c.choose(T.unit(F.youControl, F.here, { min: 0, max: 1, hint: 'help', prompt: 'You may give a unit you control here +1 [S] this turn' }))[0];
    if (u) c.giveMight(u, 1);
  }, { text: 'They may give a unit they control here +1 [S]' }),
]);

card('unl-206-219', "If a unit here would die during combat, its controller may pay [A][A][A] to heal it, exhaust it, and recall it instead.", [
  replacement('die', (ev, ctx) => {
    const id = ev.obj as ObjId;
    return !!ctx.g.ex.combat && ctx.exists(id) && ctx.isUnit(id) && ctx.loc(id) === ctx.bfIndex() && ctx.as(ctx.ctrl(id)).canPay(cost('[A][A][A]'));
  }, (ev, ctx) => {
    const id = ev.obj as ObjId;
    const c = ctx.as(ctx.ctrl(id));
    if (!c.mayPay(cost('[A][A][A]'), `Altar of Blood: pay [A][A][A] to save ${ctx.name(id)}?`)) return ev;
    c.heal(id); c.exhaust(id); c.recall(id);
    return null;
  }, { text: 'Pay [A][A][A] to save the unit' }),
]);

card('unl-208-219', "Units here with [Temporary] have [Shield].", [
  anthem((c, id) => unitsHere(c, id) && c.has(id, 'Temporary'), { keywords: ['Shield'] }, { text: 'Units here with [Temporary] have [Shield]' }),
]);

const gardensXp = grantable('B8:gardens:xp', activated('[T]', ctx => ctx.gainXp(1), { text: 'Gain 1 XP' }));
card('unl-213-219', "Units here have \"[T]: Gain 1 XP.\"", [
  anthem(unitsHere, { grants: [gardensXp] }, { text: 'Units here have "[T]: Gain 1 XP."' }),
]);

const rippersOwner = (ctx: Ctx): PlayerId => (ctx.event!.lki as { owner: PlayerId }).owner;
card('unl-214-219', "When a unit here is returned to a player's hand, that player may pay [1] to channel 1 rune exhausted.", [
  when('returnToHand', (ev, ctx) => (ev.lki as { loc?: unknown } | undefined)?.loc === ctx.bfIndex(), ctx => {
    ctx.as(rippersOwner(ctx)).channel(1, true);
  }, {
    // principle 11 (CR 383.3.a-b): the leading "may pay" is decided and paid as the trigger is chained (ENGINE-6, as RJ#12403) — by "that player"
    payer: rippersOwner, optional: "Ripper's Bay: pay [1] to channel 1 rune exhausted?", cost: cost('[1]'),
    text: 'That player may pay [1] to channel 1 rune exhausted',
  }),
]);

card('unl-215-219', "The first time a player plays a non-token unit here each turn, they may move another unit they control here to its base.", [
  when('play', (ev, ctx) => ev.loc === ctx.bfIndex() && !ev.token && typeof ev.player === 'number' && ctx.exists(ev.obj as ObjId) && ctx.isUnit(ev.obj as ObjId) && firstThisTurn(ctx, `p${ev.player}`), ctx => {
    const u = ctx.target(0);
    if (u && ctx.onBoard(u) && ctx.loc(u) === ctx.bfIndex()) ctx.as(evPlayer(ctx)).move(u, 'base');
  }, {
    // the leading "may" and the unit are decided as the trigger is chained (CR 383.3.a, 355.5; principle 11; RJ#10879);
    // choosing none removes it. The chooser is the player who played the unit ("they", RJ#12439), not the battlefield's controller.
    payer: evPlayer,
    targets: [T.upTo(1, T.unit((c: Ctx, id: ObjId) => id !== c.event?.obj && c.loc(id) === c.bfIndex() && c.ctrl(id) === c.event?.player, { prompt: 'You may move another unit you control here to its base' }))],
    mayChoose: true,
    text: 'They may move another unit they control here to base',
  }),
]);

// The Academy — the granted Repeat is offered right after the spell is played (B8-18: no keyword-cost grants).
const academyRepeat = delayedAbility('B8:academy:repeat', when('spellFinalized', (ev, ctx) => ev.player === ctx.controller, ctx => {
  const ev = ctx.event!;
  const sp = ev.obj as ObjId;
  const item = ctx.g.chain.find(c => c.id === ev.item);
  if (!item || !ctx.exists(sp)) return;
  const base = cost(`[${ctx.energyCost(sp)}]${'[C]'.repeat(ctx.powerCost(sp))}`);
  const label = `[${ctx.energyCost(sp)}]${'[C]'.repeat(ctx.powerCost(sp))}`;
  if (ctx.canPay(base, sp) && ctx.may(`The Academy: pay ${label} to repeat ${ctx.name(sp)}?`) && ctx.pay(base, sp)) item.repeat = (item.repeat ?? 0) + 1;
}, { isAdd: true, text: 'The Academy: [Repeat] equal to its base cost' }));
card('unl-216-219', "When you hold here, give your next spell this turn [Repeat] equal to its base cost.", [
  holdHere(ctx => ctx.delay(academyRepeat, {}, 'endOfTurn', 1), undefined, { text: 'Your next spell this turn has [Repeat] equal to its base cost' }),
]);

card('unl-218-219', "When a player plays a unit here, they may pay [1] to [Buff] it.", [
  when('play', (ev, ctx) => ev.loc === ctx.bfIndex() && typeof ev.player === 'number' && ctx.exists(ev.obj as ObjId) && ctx.isUnit(ev.obj as ObjId), ctx => {
    const u = ctx.event!.obj as ObjId;
    if (ctx.onBoard(u)) ctx.as(evPlayer(ctx)).buff(u);
  }, {
    // the leading "may pay [1]" is decided and paid by the playing player as the trigger is chained (CR 383.3.a-b, principle 11;
    // RJ#12403): a response that removes the unit leaves the [1] spent; declining removes the trigger
    payer: evPlayer, optional: 'Valley of Idols: pay [1] to buff the unit played here?', cost: cost('[1]'),
    offerIf: ctx => ctx.onBoard(ctx.event!.obj as ObjId) && !ctx.isBuffed(ctx.event!.obj as ObjId),
    text: 'They may pay [1] to buff it',
  }),
]);

const vaultsTax = delayedAbility('B8:vaults:tax', costModDyn((ctx, id) => (ctx.isUnit(id) && !ctx.isToken(id) ? { energy: 1 } : null), { text: 'Your non-token units cost [1] more this turn' }));
card('unl-219-219', "When you hold here, your non-token units cost [1] more to play this turn.", [
  holdHere(ctx => ctx.delay(vaultsTax, {}, 'endOfTurn'), undefined, { text: 'Your non-token units cost [1] more this turn' }),
]);

card('unl-t01', "Units can move here from anywhere.", [
  movePermission((ctx, _u, _from, to) => to === ctx.bfIndex(), { text: 'Units can move here from anywhere' }),
]);

const brushTags = ['Bird', 'Cat', 'Dog', 'Poro', 'Ivern'];
card('unl-t03', "Bird, Cat, Dog, Poro, and Ivern units here have +1 [S].\nWhen you score here, you may replace this with the battlefield it replaced.", [
  anthem((c, id) => unitsHere(c, id) && brushTags.some(t => c.hasTag(id, t)), { might: 1 }, { text: 'Bird, Cat, Dog, Poro and Ivern units here have +1 [S]' }),
  // principle 11 (CR 383.3.a-b): the leading "you may" (and its cost) is decided as the trigger is chained (ENGINE-6)
  scoreHere(ctx => { if (ctx.obj(ctx.self)?.counters.replaced !== undefined) ctx.swapBackBattlefield(ctx.bfIndex()); }, undefined, { payer: evPlayer, optional: 'Replace Brush with the battlefield it replaced?', offerIf: ctx => ctx.obj(ctx.self)?.counters.replaced !== undefined, text: 'You may swap back to the replaced battlefield' }),
]);

// Dragon Roost — the play rule belongs to the battlefield's controller (the turn player while uncontrolled),
// so an opponent of the controller can't use it yet (B8-19: "any player" play rules).
card('ven-157-166', "Any player may pay [A][A] as an additional cost to play a Dragon. If they do, they play it to this battlefield.", [
  // engine play-rule additional cost bound to a destination (N6 / B8-11 / B8-19), usable by any player
  playRule((ctx, id) => ctx.isUnit(id) && ctx.hasTag(id, 'Dragon'), {
    anyPlayer: true,
    additionalCost: { cost: cost('[A][A]'), label: 'Pay [A][A] to play it to Dragon Roost', key: 'dragonRoost', destination: ctx => ctx.bfIndex() },
    text: 'Any player may pay [A][A] as an additional cost to play a Dragon. If they do, they play it to this battlefield.',
  }),
]);

card('ven-158-166', "Players ignore [Deflect] while paying for spells and abilities choosing something here.", [
  // SF-6 / RJ#11769, #11783: "while paying for spells and abilities choosing something here" — the whole Deflect tax of a
  // payment is ignored when any of its chosen objects is here (or is this battlefield)
  rule('ignoreDeflect', (ctx, _chooser: PlayerId, target: ObjId, all?: ObjId[]) =>
    (all ?? [target]).some(x => x === ctx.self || (ctx.exists(x) && ctx.loc(x) === ctx.bfIndex())), undefined, { text: 'Ignore [Deflect] while paying for choices here' }),
]);

card('ven-159-166', "Units here with [Tank] have +1 [S].", [
  anthem((c, id) => unitsHere(c, id) && c.has(id, 'Tank'), { might: 1 }, { text: 'Units here with [Tank] have +1 [S]' }),
]);

card('ven-160-166', "During showdowns here, cards with [Reaction] cost [A] more to play.", [
  costModDyn((ctx, id) => {
    if (ctx.g.showdown?.battlefieldIndex !== ctx.bfIndex()) return null;
    const hidden = !!ctx.item?.fromHidden || ctx.obj(id)?.zone === 'facedown';
    // RJ#11862: an Ambush unit being played to a battlefield with its player's units has [Reaction] (CR 822.1.b)
    const p = (ctx.data.payer as PlayerId | undefined) ?? ctx.controller, dest = ctx.data.dest as 'base' | number | undefined;
    return ctx.has(id, 'Reaction') || hidden || ctx.playTiming(id, p, dest) === 'reaction' ? { power: 1 } : null;
  }, { text: 'Cards with [Reaction] cost [A] more during showdowns here' }),
]);

// Piltovan Forge — mana abilities aren't counted as "played" gear abilities.
const forgeKey = (p: PlayerId) => `forge:${p}`;
card('ven-161-166', "While you control this battlefield, the first friendly gear activated ability played each turn costs [1] less.", [
  costModDyn((ctx, id) => { const p = bfCtl(ctx); return p !== null && payer(ctx) === p && ctx.isGear(id) && ctx.ctrl(id) === p && fact(ctx, forgeKey(p)) === 0 ? { energy: -1 } : null; },
    { scope: 'ability', text: 'The first friendly gear ability each turn costs [1] less' }),
  listen('activated', (ev, ctx) => { if (!ev.isAdd && ctx.exists(ev.obj as ObjId) && ctx.isGear(ev.obj as ObjId) && typeof ev.player === 'number') setFact(ctx, forgeKey(ev.player as PlayerId), fact(ctx, forgeKey(ev.player as PlayerId)) + 1); }),
]);

card('ven-162-166', "When you conquer here, if you control 4 or fewer runes, you may pay [1] to draw 1.", [
  // principle 11 (CR 383.3.a-b): the leading "may pay" is decided and paid as the trigger is chained (ENGINE-6, as RJ#12403); the rune count is a trigger condition (checked when conquering only, rules-decisions #36)
  conquerHere(ctx => ctx.draw(1), (_ev, ctx) => ctx.runes().length <= 4, { payer: evPlayer, optional: 'Protective Sands: pay [1] to draw 1?', cost: cost('[1]'), text: 'You may pay [1] to draw 1' }),
]);

card('ven-163-166', "[Empower] costs of your units here cost [1] or [A] less.", [
  costModDyn((ctx, id) => (ctx.isUnit(id) && ctx.loc(id) === ctx.bfIndex() && ctx.ctrl(id) === payer(ctx) ? oneOrA(keywordCost(ctx.g, id, 'Empower')?.energy ?? 0) : null),
    { scope: 'empower', text: '[Empower] costs of your units here cost [1] or [A] less' }),
], { keywords: [] });

card('ven-164-166', "Each spell that chooses one or more units here that are friendly to it costs [A] less.", [
  costModDyn((ctx, id) => {
    if (!ctx.isSpell(id)) return null;
    const c = ctx.as(payer(ctx));
    return itemTargets(ctx).some(t => c.isUnit(t) && c.loc(t) === ctx.bfIndex() && c.isFriendly(t)) ? { power: -1 } : null;
  }, { text: 'Spells choosing friendly units here cost [A] less' }),
]);

card('ven-166-166', "When combat starts here, the attacker and defender each [Add] [1].", [
  when('combatStart', (ev, ctx) => ev.bf === ctx.bfIndex(), ctx => {
    for (const p of [ctx.event!.attacker, ctx.event!.defender]) if (typeof p === 'number') ctx.as(p as PlayerId).add(1);
  }, { isAdd: true, text: 'The attacker and defender each [Add] [1]' }),
]);


// Batch B5 card scripts (removal / interaction: damage, kill, counter, bounce, fight, spell control).
// Owned by scripting agent B5. Helpers: src/cards/helpers/B5.ts. Tests: tests/cards/B5/.
import {
  card, spell, spellModes, mode, onPlay, onPlayToBattlefield, deathknell, onAttack, onConquer, onMove, when, activated,
  statik, selfKeyword, replacement, rule, asPlay, showOff, selfCostDyn, playRule, delayedAbility, reflexiveAbility, cost, pay, dep, E, T, F, on,
  type Ctx, type ObjId, type PlayerId, type Filter,
} from '../dsl.ts';
import type { PowerSym } from '../../engine/abilities.ts';
import { anyDamageLethal } from '../../engine/rules.ts';
import {
  priorPicks, notPrior, totalMightGroups, allTargets, capTotalMight, itemOf, isSpellItem, enemyItem,
  itemEnergy, itemPower, chosenBy, friendlyPermanents, gainControlOfSpell, bfIndexOf, unitsControlledBy, gearControlledBy, eachPlayerKillsOne, controlsFacedown, playData, maxExtraPower, fightIfBoth, unitSourcedDamage,
} from '../helpers/B5.ts';

// =====================================================================================
// Shared target specs / small helpers
// =====================================================================================

const harm = { hint: 'harm' as const };
const unitAtBf = (prompt: string, ...f: Filter[]) => T.unit(F.atBattlefield, ...f, { prompt, hint: 'harm' });
const enemyUnit = (prompt: string, ...f: Filter[]) => T.unit(F.enemy, ...f, { prompt, hint: 'harm' });
const friendlyUnit = (prompt: string, ...f: Filter[]) => T.unit(F.friendly, ...f, { prompt, hint: 'help' });
const aSpell = (prompt = 'Choose a spell', ...f: Filter[]) => T.chainItem(isSpellItem, ...f, { prompt, hint: 'harm' });

/** "Deal N to <target 0>" */
const dealT = (n: number) => (ctx: Ctx) => { const t = ctx.target(0); if (t) ctx.deal(n, t); };
/** "Kill <target 0>" */
const killT = (ctx: Ctx) => { const t = ctx.target(0); if (t) ctx.kill(t); };
/** "Return <target 0> to its owner's hand" */
const bounceT = (ctx: Ctx) => { const t = ctx.target(0); if (t) ctx.returnToHand(t); };
/** "Counter <target 0>" */
const counterT = (ctx: Ctx) => { const t = ctx.target(0); if (t) ctx.counter(t); };
/** units at battlefield index bf matching f */
const unitsAtBf = (ctx: Ctx, bf: number | undefined, f: (id: ObjId) => boolean = () => true) => bf === undefined ? [] : ctx.unitsAt(bf, f);
/** "if this kills it": lethal damage is marked (incl. "any amount of your damage is enough", DSL request B5-14) */
const killedBy = (ctx: Ctx, t: ObjId) => ctx.lethallyDamaged(t) || (ctx.onBoard(t) && ctx.damage(t) > 0 && anyDamageLethal(ctx.g, t));

// =====================================================================================
// Delayed abilities (registered once at module level)
// =====================================================================================

/** Unyielding Spirit: prevent all non-combat (spell and ability) damage this turn */
// RJ#2602 / CR 418.6.b.3: damage the text says units deal (fights) is not spell or ability damage
const PREVENT_SPELL_DAMAGE = delayedAbility('B5:preventSpellAbilityDamage', replacement('damage', (ev, ctx) => !ev.combat && !unitSourcedDamage(ctx), ev => ({ ...ev, amount: 0 }), { text: 'Prevent all spell and ability damage this turn' }));

/** Imperial Decree: "When any unit takes damage this turn, kill it." */
const DECREE_KILL = delayedAbility('B5:imperialDecree', when('damage', (ev, ctx) => typeof ev.obj === 'string' && ctx.onBoard(ev.obj), ctx => {
  const id = ctx.event?.obj as ObjId | undefined;
  if (id && ctx.onBoard(id)) ctx.kill(id);
}, { text: 'Imperial Decree: kill the damaged unit' }));

/** Noxian Guillotine: "Kill it the next time it takes damage this turn." (uses = 1) */
const GUILLOTINE = delayedAbility('B5:guillotine', when('damage', (ev, ctx) => ev.obj === ctx.data.obj && (ctx.obj(ev.obj as ObjId)?.epoch ?? -1) === ctx.data.epoch, ctx => {
  const id = ctx.data.obj as ObjId;
  if (ctx.onBoard(id) && (ctx.obj(id).epoch ?? 0) === ctx.data.epoch) ctx.kill(id);
}, { text: 'Noxian Guillotine: kill it' }));

/** Smite: "If it would die this turn, banish it instead." */
const SMITE = delayedAbility('B5:smite', replacement('die', (ev, ctx) => ev.obj === ctx.data.obj && (ctx.obj(ev.obj as ObjId)?.epoch ?? -1) === ctx.data.epoch, (ev, ctx) => {
  ctx.banish(ev.obj as ObjId);
  return null;
}, { text: 'Smite: banish it instead' }));

/** Siphoning Strike: "When it dies this turn, channel 1 rune exhausted." (uses = 1) */
const SIPHON = delayedAbility('B5:siphon', when('die', (ev, ctx) => ev.obj === ctx.data.obj && (ctx.obj(ev.obj as ObjId)?.epoch ?? -1) === ctx.data.epoch, ctx => {
  ctx.channel(1, true);
}, { text: 'Siphoning Strike: channel 1 rune exhausted' }));

/** Lilting Lullaby: "Its controller can't play spells this turn." */
const NO_SPELLS = delayedAbility('B5:noSpells', rule('cantPlay', (ctx, cardObj: ObjId, player: PlayerId) => player === ctx.data.p && ctx.exists(cardObj) && ctx.type(cardObj) === 'Spell', undefined, { text: "Can't play spells this turn" }));

/** Decree of Rage: "This can't be countered." (registered as the card is played; active while it's on the chain) */
const UNCOUNTERABLE = delayedAbility('B5:uncounterable', rule('cantBeCountered', (ctx, itemId: string) => itemOf(ctx, itemId)?.source === ctx.data.obj, undefined, { text: "This can't be countered" }));

/**
 * Reflexive "play this again for [A]" after the spell finished resolving (Dancing Grenade, Death from Below).
 * data: { obj, epoch (on the chain), p (who may play it), zone? (required zone, e.g. 'trash') }
 */
const REPLAY = delayedAbility('B5:replayForA', when('spellResolved', (ev, ctx) => ev.obj === ctx.data.obj && (ctx.obj(ev.obj as ObjId)?.epoch ?? -1) === Number(ctx.data.epoch) + 1, ctx => {
  const id = ctx.data.obj as ObjId;
  const p = ctx.data.p as PlayerId;
  const o = ctx.obj(id);
  if (!o || o.zone === 'chain' || o.zone === 'base' || o.zone === 'battlefield') return;
  if (ctx.data.zone && o.zone !== ctx.data.zone) return;
  const pc = ctx.as(p);
  const c = cost('[A]');
  if (!pc.canPay(c, id)) return;
  if (!pc.may(`Play ${ctx.name(id)} again for [A]?`)) return;
  if (!pc.pay(c, id)) return;
  pc.play(id, { ignoreCost: true });
}, { text: 'You may play this again for [A]' }));
// No longer scheduled (Dancing Grenade replays inside its own resolution, RJ#13328); kept registered so a saved game that
// still holds one of these delayed entries resolves it as before.
void REPLAY;

// =====================================================================================
// ORIGINS (ogn)
// =====================================================================================

// Disintegrate
const DISINTEGRATE_DRAW = reflexiveAbility('B5:disintegrate:draw', { effect: E.draw(1), text: 'Disintegrate: draw 1' });
card('ogn-005-298', "[Action]\nDeal 3 to a unit at a battlefield. If this kills it, do this: draw 1.", [
  spell(ctx => {
    const t = ctx.target(0);
    if (!t) return;
    ctx.deal(3, t);
    // RJ#8002 / CR 387-389: "do this: draw 1" is a reflexive item with its own chain entry (players may respond)
    if (killedBy(ctx, t)) ctx.reflexive(DISINTEGRATE_DRAW);
  }, { targets: [unitAtBf('Deal 3 to a unit at a battlefield')] }),
]);

// Get Excited!
card('ogn-008-298', "[Action]\nDiscard 1. Deal its Energy cost as damage to a unit at a battlefield.", [
  spell(ctx => {
    const d = ctx.discard(1)[0];
    const n = d ? ctx.energyCost(d) : 0;          // (Ignore its Power cost.)
    const t = ctx.target(0);
    if (t && n > 0) ctx.deal(n, t);
  }, { targets: [unitAtBf('Deal the discarded card\'s Energy cost to a unit at a battlefield')] }),
]);

// Hextech Ray
card('ogn-009-298', "[Action]\nDeal 3 to a unit at a battlefield.", [
  spell(dealT(3), { targets: [unitAtBf('Deal 3 to a unit at a battlefield')] }),
]);

// Sky Splitter
card('ogn-014-298', "[Action]\nThis spell's Energy cost is reduced by the highest Might among units you control.\nDeal 5 to a unit at a battlefield.", [
  selfCostDyn(ctx => {
    const m = Math.max(0, ...ctx.units(u => ctx.ctrl(u) === ctx.controller).map(u => ctx.might(u)));
    return { energy: -m };
  }, { text: 'Energy cost reduced by the highest Might among units you control' }),
  spell(dealT(5), { targets: [unitAtBf('Deal 5 to a unit at a battlefield')] }),
]);

// Thermo Beam
card('ogn-022-298', "[Action]\nKill all gear.", [
  spell(ctx => { ctx.kill(ctx.gear()); }),
]);

// Void Seeker
card('ogn-024-298', "[Action]\nDeal 4 to a unit at a battlefield. Draw 1.", [
  spell(E.seq(dealT(4), E.draw(1)), { targets: [unitAtBf('Deal 4 to a unit at a battlefield')] }),
]);

// Falling Star
// RULINGS: Spiritforged FAQ ("Falling Star, Icathian Rain, and Deflect"): two "Deal 3 to a unit." instructions; all targets are
// chosen up front and may be the same or different units (data/cards.json fixed by DATA).
card('ogn-029-298', "Deal 3 to a unit.\nDeal 3 to a unit.", [
  spell(ctx => { for (let i = 0; i < 2; i++) { const t = ctx.target(i); if (t) ctx.deal(3, t); } },
    { targets: [0, 1].map(i => T.unit({ prompt: `Deal 3 to a unit (${i + 1} of 2)`, ...harm })) }),
]);

// Shakedown
card('ogn-033-298', "[Reaction]\nChoose an enemy unit. Deal 6 to it unless its controller has you draw 2.", [
  spell(ctx => {
    const t = ctx.target(0);
    if (!t) return;
    const owner = ctx.ctrl(t);
    if (ctx.mayFor(owner, `Shakedown: let ${ctx.g.players[ctx.controller].name} draw 2 to prevent 6 damage to ${ctx.name(t)}?`)) ctx.draw(2);
    else ctx.deal(6, t);
  }, { targets: [enemyUnit('Choose an enemy unit (6 damage unless its controller lets you draw 2)')] }),
]);

// Volibear, Furious
card('ogn-041-298', "[Deflect 2]\nWhen I attack, deal 5 damage split among any number of enemy units here.", [
  onAttack(ctx => {
    ctx.dealSplit(0, 5);    // CR 715.3: Bonus Damage raises the pool (RJ#5474)
  }, { targets: [T.unit(F.enemy, F.here, { min: 0, max: 99, split: 5, prompt: 'Deal 5 damage split among any number of enemy units here', hint: 'harm' })], text: 'When I attack, deal 5 damage split among any number of enemy units here.' }),   // "any number" includes none (CR 355.13, RJ#7855)
]);

// Defy
card('ogn-045-298', "[Reaction]\nCounter a spell that costs no more than [4] and no more than [A].", [
  spell(counterT, { targets: [aSpell('Counter a spell that costs no more than [4] and no more than [A]', (c, id) => itemEnergy(c, id) <= 4 && itemPower(c, id) <= 1)] }),
]);

// Adaptatron
card('ogn-056-298', "When I conquer, you may kill a gear. If you do, buff me.", [
  onConquer(ctx => {
    const t = ctx.target(0);
    if (t && ctx.kill(t).length) ctx.buff(ctx.self);
  }, { optional: 'Adaptatron: kill a gear to buff me?', targets: [T.gear({ prompt: 'Kill a gear', ...harm })], text: 'When I conquer, you may kill a gear. If you do, buff me.' }),
]);

// Wind Wall
card('ogn-064-298', "[Reaction]\nCounter a spell.", [
  spell(counterT, { targets: [aSpell('Counter a spell')] }),
]);

// Caitlyn, Patrolling
card('ogn-068-298', "I must be assigned combat damage last.\n[T]: Deal damage equal to my Might to a unit at a battlefield. Use this ability only while I'm at a battlefield.", [
  // "assigned combat damage last" is exactly the Backline damage-assignment rule (CR 826)
  selfKeyword('Backline', { text: 'I must be assigned combat damage last.' }),
  activated('[T]', ctx => { const t = ctx.target(0); if (t) ctx.deal(ctx.might(ctx.self), t); },
    { targets: [unitAtBf('Deal damage equal to my Might to a unit at a battlefield')], if: ctx => ctx.atBattlefield(ctx.self), text: '[T]: Deal damage equal to my Might to a unit at a battlefield.' }),
]);

// Yasuo, Remorseful
card('ogn-076-298', "When I attack, deal damage equal to my Might to an enemy unit here.", [
  onAttack(ctx => { const t = ctx.target(0); if (t) ctx.deal(ctx.might(ctx.self), t); },
    { targets: [enemyUnit('Deal damage equal to my Might to an enemy unit here', F.here)], text: 'When I attack, deal damage equal to my Might to an enemy unit here.' }),
]);

// Mystic Reversal
card('ogn-080-298', "[Reaction]\nGain control of a spell. You may make new choices for it.", [
  spell(ctx => { const t = ctx.target(0); if (t) gainControlOfSpell(ctx, t); }, { targets: [aSpell('Gain control of a spell')] }),
]);

// Falling Comet
card('ogn-085-298', "[Action]\nDeal 6 to a unit at a battlefield.", [
  spell(dealT(6), { targets: [unitAtBf('Deal 6 to a unit at a battlefield')] }),
]);

// Riptide Rex
card('ogn-092-298', "When you play me, deal 6 to an enemy unit at a battlefield.", [
  onPlay(dealT(6), { targets: [enemyUnit('Deal 6 to an enemy unit at a battlefield', F.atBattlefield)], text: 'When you play me, deal 6 to an enemy unit at a battlefield.' }),
]);

// Retreat
card('ogn-104-298', "[Reaction]\nReturn a friendly unit to its owner's hand. Its owner channels 1 rune exhausted.", [
  spell(ctx => {
    const t = ctx.target(0);
    if (!t) return;
    const owner = ctx.owner(t);
    ctx.returnToHand(t);
    ctx.channel(1, true, owner);
  }, { targets: [friendlyUnit('Return a friendly unit to its owner\'s hand')] }),
]);

// Singularity
card('ogn-105-298', "Deal 6 to each of up to two units.", [
  spell(ctx => { ctx.deal(6, ctx.targetsOf(0)); }, { targets: [T.upTo(2, T.unit({ prompt: 'Deal 6 to each of up to two units', ...harm }))] }),
]);

// Unchecked Power
card('ogn-123-298', "Exhaust all friendly units, then deal 12 to all units at battlefields.", [
  spell(ctx => {
    ctx.exhaust(ctx.friendlyUnits());
    ctx.deal(12, ctx.units(u => ctx.atBattlefield(u)));
  }),
]);

// Cannon Barrage
card('ogn-127-298', "[Reaction]\nDeal 2 to all enemy units in combat.", [
  spell(ctx => { ctx.deal(2, ctx.enemyUnits(u => !!ctx.obj(u).combatRole)); }),
]);

// Challenge
card('ogn-128-298', "[Action]\nChoose a friendly unit and an enemy unit. They deal damage equal to their Mights to each other.", [
  spell(ctx => fightIfBoth(ctx, ctx.target(0), ctx.target(1)), { targets: [friendlyUnit('Choose a friendly unit'), enemyUnit('Choose an enemy unit')] }),
]);

// Crackshot Corsair
card('ogn-130-298', "When I attack, deal 1 to an enemy unit here.", [
  onAttack(dealT(1), { targets: [enemyUnit('Deal 1 to an enemy unit here', F.here)], text: 'When I attack, deal 1 to an enemy unit here.' }),
]);

// Flurry of Blades
card('ogn-133-298', "[Reaction]\nDeal 1 to all units at battlefields.", [
  spell(ctx => { ctx.deal(1, ctx.units(u => ctx.atBattlefield(u))); }),
]);

// Unyielding Spirit
card('ogn-145-298', "[Reaction]\nPrevent all spell and ability damage this turn.", [
  spell(ctx => { ctx.delay(PREVENT_SPELL_DAMAGE, {}, 'endOfTurn'); }),
]);

// Anivia, Primal
card('ogn-148-298', "When I attack, deal 3 to all enemy units here.", [
  onAttack(ctx => { ctx.deal(3, ctx.enemyUnits(u => ctx.isHere(u))); }, { text: 'When I attack, deal 3 to all enemy units here.' }),
]);

// Carnivorous Snapvine
card('ogn-149-298', "When you play me, choose an enemy unit at a battlefield. We deal damage equal to our Mights to each other.", [
  onPlay(ctx => fightIfBoth(ctx, ctx.self, ctx.target(0)), { targets: [enemyUnit('Choose an enemy unit at a battlefield to fight', F.atBattlefield)], text: 'When you play me, choose an enemy unit at a battlefield. We deal damage equal to our Mights to each other.' }),
]);

// Gust
card('ogn-169-298', "[Reaction]\nReturn a unit at a battlefield with 3 [S] or less to its owner's hand.", [
  spell(bounceT, { targets: [unitAtBf('Return a unit at a battlefield with 3 Might or less to its owner\'s hand', F.mightAtMost(3))] }),
]);

// Rebuke
card('ogn-172-298', "[Action]\nReturn a unit at a battlefield to its owner's hand.", [
  spell(bounceT, { targets: [unitAtBf('Return a unit at a battlefield to its owner\'s hand')] }),
]);

// Acceptable Losses
card('ogn-179-298', "[Action]\nEach player kills one of their gear.", [
  spell(ctx => { eachPlayerKillsOne(ctx, p => gearControlledBy(ctx, p), 'gear'); }),
]);

// Zaunite Bouncer
card('ogn-188-298', "When you play me, return another unit at a battlefield to its owner's hand.", [
  onPlay(bounceT, { targets: [T.unit(F.atBattlefield, F.other, { prompt: 'Return another unit at a battlefield to its owner\'s hand' })], text: "When you play me, return another unit at a battlefield to its owner's hand." }),
]);

// Kog'Maw, Caustic
card('ogn-190-298', "[Deathknell] — Deal 4 to all units at my battlefield.", [
  deathknell(ctx => {
    const lki = ctx.event?.lki as { loc?: 'base' | number } | undefined;
    const bf = lki?.loc;
    if (typeof bf !== 'number') return;           // died in a base: no battlefield
    ctx.deal(4, ctx.unitsAt(bf));
  }, { text: 'Deathknell — Deal 4 to all units at my battlefield.' }),
]);

// Cruel Patron
card('ogn-208-298', "As an additional cost to play me, kill a friendly unit.", [], {
  additionalCosts: [{ cost: cost('', pay.killFriendly()), label: 'Kill a friendly unit' }],
});

// Cull the Weak
card('ogn-209-298', "Each player kills one of their units.", [
  spell(ctx => { eachPlayerKillsOne(ctx, p => unitsControlledBy(ctx, p), 'units'); }),
]);

// Hidden Blade
card('ogn-213-298', "[Hidden]\n[Action]\nKill a unit at a battlefield. Its controller draws 2.", [
  spell(ctx => {
    const t = ctx.target(0);
    if (!t) return;                                // illegal target: the linked draw is ignored too (T170)
    const p = ctx.ctrl(t);
    ctx.kill(t);
    ctx.draw(2, p);                                // still draws if the kill was prevented/replaced (T169/T171)
  }, { targets: [unitAtBf('Kill a unit at a battlefield (its controller draws 2)')] }),
]);

// Imperial Decree
card('ogn-221-298', "[Action]\nWhen any unit takes damage this turn, kill it.", [
  spell(ctx => { ctx.delay(DECREE_KILL, {}, 'endOfTurn'); }),
]);

// Salvage
card('ogn-224-298', "[Action]\nYou may kill up to one gear. Draw 1.", [
  spell(ctx => { ctx.kill(ctx.targetsOf(0)); ctx.draw(1); }, { targets: [T.upTo(1, T.gear({ prompt: 'You may kill up to one gear', ...harm }))] }),
]);

// Solari Chief
card('ogn-225-298', "When you play me, choose an enemy unit. If it is stunned, kill it. Otherwise, stun it.", [
  onPlay(ctx => {
    const t = ctx.target(0);
    if (!t) return;
    if (ctx.isStunned(t)) ctx.kill(t); else ctx.stun(t);
  }, { targets: [enemyUnit('Choose an enemy unit (stunned: kill it, otherwise: stun it)')], text: 'When you play me, choose an enemy unit. If it is stunned, kill it. Otherwise, stun it.' }),
]);

// Vengeance
card('ogn-229-298', "Kill a unit.", [
  spell(killT, { targets: [T.unit({ prompt: 'Kill a unit', ...harm })] }),
]);

// Commander Ledros
card('ogn-231-298', "As you play me, you may kill any number of friendly units as an additional cost. Reduce my cost by [C] for each killed this way.\n[Deflect]\n[Ganking]", [
  asPlay(ctx => {
    const cands = ctx.friendlyUnits(u => u !== ctx.self && ctx.ctrl(u) === ctx.controller);
    if (!cands.length) return;
    // CR 355.16 / F-3c: at least as many as needed to make him affordable
    let min = 0;
    while (min < cands.length && !ctx.playAffordableWith({ power: -min })) min++;
    const ids = ctx.chooseCards(cands, min, cands.length, 'Commander Ledros: kill any number of friendly units (each reduces my cost by [C])');
    if (!ids.length) return;
    ctx.data.ledrosKill = ids;
    if (ctx.item) ctx.item.choices.ledrosN = ids.length;
    // Killed right away (an unaffordable play is rolled back as a whole). Not via ctx.addPlayCost({extra}), which would
    // store functions in the play data (DSL request B6-4).
    ctx.kill(ids);
  }, { text: 'As you play me, you may kill any number of friendly units as an additional cost.' }),
  // While the play is being checked (no chain item yet) assume the best case so the card is offered;
  // during the play the actual number of killed units is used (an unaffordable play is rolled back).
  selfCostDyn(ctx => {
    const n = ctx.item ? Number(ctx.item.choices.ledrosN ?? 0) : ctx.friendlyUnits(u => u !== ctx.self && ctx.ctrl(u) === ctx.controller).length;
    return { power: -n };
  }, { text: 'Reduce my cost by [C] for each killed this way.' }),
]);

// Harnessed Dragon
card('ogn-234-298', "When you play me, kill an enemy unit.", [
  onPlay(killT, { targets: [enemyUnit('Kill an enemy unit')], text: 'When you play me, kill an enemy unit.' }),
]);

// King's Edict
card('ogn-237-298', "Starting with the next player, each other player chooses a unit you don't control that hasn't been chosen for this spell. Kill those units.", [
  spell(ctx => {
    const me = ctx.controller;
    const chosen: ObjId[] = [];
    ctx.eachPlayer(p => {
      const pick = ctx.chooseFor(p, T.unit((c, id) => c.ctrl(id) !== me && !chosen.includes(id), { prompt: "King's Edict: choose a unit its caster doesn't control (it will be killed)", hint: 'harm' }));
      chosen.push(...pick);
    }, { startWithNext: true, others: true });
    ctx.kill(chosen);
  }),
]);

// Divine Judgment
card('ogn-244-298', "Each player chooses 2 units, 2 gear, 2 runes, and 2 cards in their hands. Recycle the rest.", [
  // RJ#4173 / #990 / #1766 / #4192 (DECISIONS, house): units, gear and runes may be any player's (no "your" in the text; with
  // fewer than 2 of your own you choose others' to reach 2), hand cards are the player's own; players choose in turn order and
  // everything nobody chose is recycled
  spell(ctx => {
    const all = (pick: (p: PlayerId) => ObjId[]) => ctx.g.players.flatMap(pl => pick(pl.id));
    const types: [string, () => ObjId[]][] = [
      ['units', () => all(p => unitsControlledBy(ctx, p))],
      ['gear', () => all(p => gearControlledBy(ctx, p).filter(id => !ctx.isUnit(id)))],
      ['runes', () => all(p => [...ctx.runes(p)])],
    ];
    const kept = new Set<ObjId>();
    const rest: ObjId[] = [];
    ctx.eachPlayer(p => {
      for (const [what, ids] of types) for (const id of ctx.chooseCards(ids(), 2, 2, `Divine Judgment: choose 2 ${what} to keep`, p)) kept.add(id);
      const hand = [...ctx.hand(p)];
      const keepHand = ctx.chooseCards(hand, 2, 2, 'Divine Judgment: choose 2 cards in your hand to keep', p);
      rest.push(...hand.filter(id => !keepHand.includes(id)));
    });
    for (const [, ids] of types) rest.push(...ids().filter(id => !kept.has(id)));
    ctx.recycle(rest);
  }),
]);

// Icathian Rain (Kai'Sa)
// RULINGS: Spiritforged FAQ: six "Deal 2 to a unit." instructions, targets chosen up front (data fixed by DATA).
card('ogn-248-298', "Deal 2 to a unit.\nDeal 2 to a unit.\nDeal 2 to a unit.\nDeal 2 to a unit.\nDeal 2 to a unit.\nDeal 2 to a unit.", [
  spell(ctx => { for (let i = 0; i < 6; i++) { const t = ctx.target(i); if (t) ctx.deal(2, t); } },
    { targets: [0, 1, 2, 3, 4, 5].map(i => T.unit({ prompt: `Deal 2 to a unit (${i + 1} of 6)`, ...harm })) }),
]);

// Stormbringer (Volibear)
card('ogn-250-298', "Choose a friendly unit in your base. Deal damage equal to its Might to all enemy units at a battlefield, then move your unit there.", [
  spell(ctx => {
    const u = ctx.target(0);
    const bf = bfIndexOf(ctx, ctx.target(1));
    if (!u || bf === undefined) return;
    ctx.deal(ctx.might(u), unitsAtBf(ctx, bf, id => ctx.isEnemy(id)));   // the spell deals it
    if (ctx.onBoard(u)) ctx.move(u, bf);
  }, { targets: [friendlyUnit('Choose a friendly unit in your base', F.atBase, F.youControl), T.battlefield({ prompt: 'Choose a battlefield' })] }),
]);

// Noxian Guillotine (Darius)
card('ogn-254-298', "[Action]\nChoose a unit. Kill it the next time it takes damage this turn.\n[Legion] — Kill it now instead.", [
  spell(ctx => {
    const t = ctx.target(0);
    if (!t) return;
    const legion = ctx.playedThisTurn().some(id => id !== ctx.self);
    if (legion) ctx.kill(t);
    else ctx.delay(GUILLOTINE, { obj: t, epoch: ctx.obj(t).epoch ?? 0 }, 'endOfTurn', 1);
  }, { targets: [T.unit({ prompt: 'Choose a unit (killed the next time it takes damage this turn)', ...harm })] }),
]);

// Fox-Fire (Ahri)
card('ogn-256-298', "[Hidden]\n[Action]\nKill any number of units at a battlefield with total Might 4 or less.", [
  spell(ctx => {
    const ids = allTargets(ctx, [0, 1, 2, 3, 4, 5]);
    // the total is re-checked on resolution with current Mights (targets are re-validated, CR 359.3.e). If the targets no longer
    // fit together, the caster chooses a subgroup at one battlefield with total Might 4 or less (DECISIONS #3312, principle 21)
    const fits = ids.length > 0 && ids.every(id => ctx.onBoard(id) && ctx.atBattlefield(id) && ctx.sameLocation(ids[0], id)) && ids.reduce((s, id) => s + ctx.might(id), 0) <= 4;
    if (fits) { ctx.kill(ids); return; }
    // CR 355.11.b / 355.11.b.1: a legal subset of the original targets (still at one battlefield) that includes the maximum
    // number of targets possible for it — the caster keeps choosing while another original target still fits
    const pick: ObjId[] = [];
    let left = 4;
    for (;;) {
      const cands = ids.filter(id => !pick.includes(id) && ctx.onBoard(id) && ctx.atBattlefield(id) && ctx.might(id) <= left && (!pick.length || ctx.sameLocation(pick[0], id)));
      if (!cands.length) break;
      const u = ctx.chooseCards(cands, 1, 1, `Fox-Fire: choose a unit to kill (total Might 4 or less; ${left} left)`)[0];
      if (!u) break;
      pick.push(u); left -= ctx.might(u);
    }
    ctx.kill(pick);
  }, { targets: totalMightGroups(6, 4, [F.atBattlefield], { sameLocation: true, prompt: 'Kill units at one battlefield (total Might 4 or less)' }) }),
]);

// Dragon's Rage (Lee Sin)
const dragonsRageMoved = (ctx: Ctx) => { const u = ctx.data.u as ObjId | undefined; return u && ctx.onBoard(u) && (ctx.obj(u).epoch ?? 0) === ctx.data.epoch ? u : undefined; };
const dragonsRageFight = reflexiveAbility('B5:dragonsRage:fight', {
  // "at its destination": the move destination fixed when the spell was played (CR 355.4), not where the unit is now (RJ#640)
  targets: [T.unit(F.enemy, (c, id) => { const u = dragonsRageMoved(c); return !!u && id !== u && (c.data.to !== undefined ? c.loc(id) === c.data.to : c.sameLocation(id, u)); }, { prompt: 'Choose another enemy unit at its destination', hint: 'harm' })],
  effect: ctx => fightIfBoth(ctx, dragonsRageMoved(ctx), ctx.target(0)),
  text: "Dragon's Rage: they deal damage equal to their Mights to each other",
});
card('ogn-258-298', "Move an enemy unit. Then do this: Choose another enemy unit at its destination. They deal damage equal to their Mights to each other.", [
  spell(ctx => {
    // R-2 (CR 355.4, RJ#1516): the destination is chosen as the spell is played; already there -> no move, no fight
    const u = ctx.target(0), to = ctx.destination(1);
    if (!u || to === null || !ctx.canMoveTo(u, to)) return;
    ctx.move(u, to);
    if (!ctx.onBoard(u)) return;
    // RJ#3961 / CR 387-389: "Then do this:" is a reflexive item; its "choose another enemy unit" is a target (Deflect applies)
    ctx.reflexive(dragonsRageFight, { u, epoch: ctx.obj(u).epoch ?? 0, to });
  }, { targets: [enemyUnit('Move an enemy unit'), T.destination(F.moveDestFor(0), { prompt: 'Move it to' })] }),
]);

// Last Breath (Yasuo)
card('ogn-260-298', "[Action]\nReady a friendly unit. It deals damage equal to its Might to an enemy unit at a battlefield.", [
  spell(ctx => {
    const u = ctx.target(0), e = ctx.target(1);
    if (!u) return;
    ctx.ready(u);
    // the readied unit deals the damage (CR 418.6.b.3; RJ#1999): not spell damage for Unyielding Spirit / Bonus Damage
    if (e && ctx.onBoard(u)) ctx.dealEach([{ id: e, amount: ctx.might(u) }], u, { unitDealt: true });
  }, { targets: [friendlyUnit('Ready a friendly unit'), enemyUnit('It deals damage equal to its Might to an enemy unit at a battlefield', F.atBattlefield)] }),
]);

// Bullet Time (Miss Fortune) — "Pay any amount of [C]" is part of the resolution text: the amount is chosen and
// paid as the spell resolves; the battlefield is chosen as it is played.
card('ogn-268-298', "[Action]\nPay any amount of [A] to deal that much damage to all enemy units at a battlefield.", [
  spell(ctx => {
    const bf = bfIndexOf(ctx, ctx.target(0));
    if (bf === undefined) return;
    // [A]: data audit (the printed symbol on this multi-domain card is any power)
    const max = maxExtraPower(ctx, {}, 'A');
    const x = max > 0 ? ctx.chooseNumber(0, max, 'Bullet Time: pay how much [A]?') : 0;
    if (x <= 0 || !ctx.pay({ power: new Array(x).fill('A') as PowerSym[] })) return;
    ctx.deal(x, unitsAtBf(ctx, bf, id => ctx.isEnemy(id)));
  }, { targets: [T.battlefield({ prompt: 'Deal damage to all enemy units at a battlefield' })] }),
]);

// =====================================================================================
// PROVING GROUNDS (ogs)
// =====================================================================================

// Firestorm
card('ogs-002-024', "Deal 3 to all enemy units at a battlefield.", [
  spell(ctx => { const bf = bfIndexOf(ctx, ctx.target(0)); ctx.deal(3, unitsAtBf(ctx, bf, id => ctx.isEnemy(id))); },
    { targets: [T.battlefield({ prompt: 'Deal 3 to all enemy units at a battlefield' })] }),
]);

// Incinerate
card('ogs-003-024', "[Action]\nDeal 2 to a unit at a battlefield.", [
  spell(dealT(2), { targets: [unitAtBf('Deal 2 to a unit at a battlefield')] }),
]);

// Gentlemen's Duel
card('ogs-008-024', "[Action]\nGive a friendly unit +3 [S] this turn. Then choose an enemy unit. They deal damage equal to their Mights to each other.", [
  spell(ctx => {
    const u = ctx.target(0);
    if (!u) return;
    ctx.giveMight(u, 3, 'endOfTurn');
    const e = ctx.choose(T.unit(F.enemy, { prompt: 'Choose an enemy unit', hint: 'harm' }))[0];
    fightIfBoth(ctx, u, e);
  }, { targets: [friendlyUnit('Give a friendly unit +3 Might this turn')] }),
]);

// Blast of Power
card('ogs-012-024', "[Action]\nKill a unit at a battlefield.", [
  spell(killT, { targets: [unitAtBf('Kill a unit at a battlefield')] }),
]);

// Tibbers (Annie)
card('ogs-018-024', "When you play me, deal 3 to all units at battlefields.", [
  onPlay(ctx => { ctx.deal(3, ctx.units(u => ctx.atBattlefield(u))); }, { text: 'When you play me, deal 3 to all units at battlefields.' }),
]);

// Final Spark (Lux)
card('ogs-022-024', "[Action]\nDeal 8 to a unit.", [
  spell(dealT(8), { targets: [T.unit({ prompt: 'Deal 8 to a unit', ...harm })] }),
]);

// =====================================================================================
// RADIANCE (rad)
// =====================================================================================

// Bilgewater Tracker
card('rad-003-167', "When you play me, deal 1 to each of up to 2 units.", [
  onPlay(ctx => { ctx.deal(1, ctx.targetsOf(0)); }, { targets: [T.upTo(2, T.unit({ prompt: 'Deal 1 to each of up to 2 units', ...harm }))], text: 'When you play me, deal 1 to each of up to 2 units.' }),
]);

// Scorched Earth
card('rad-006-167', "[Action]\nDeal 5 damage split among units at a single battlefield.", [
  spell(ctx => {
    const ids = ctx.targetsOf(0).filter(id => ctx.onBoard(id));
    if (!ids.length) return;
    const loc = ctx.loc(ids[0]);
    const sp = ctx.split(0);    // includes Bonus Damage (CR 715.3)
    ctx.dealEach(Object.entries(sp).filter(([id]) => ids.includes(id) && ctx.loc(id) === loc).map(([id, amount]) => ({ id, amount })), ctx.self, { noBonus: true });
  }, { targets: [T.unit(F.atBattlefield, { min: 1, max: 99, split: 5, sameLocation: true, prompt: 'Deal 5 damage split among units at a single battlefield', hint: 'harm' })] }),
]);

// Lost to the Sands
card('rad-013-167', "[Action]\nChoose one —\n- Deal 4 to a unit at a battlefield.\n- Kill a gear.", [
  spellModes([
    mode('deal', 'Deal 4 to a unit at a battlefield', dealT(4), [unitAtBf('Deal 4 to a unit at a battlefield')]),
    mode('gear', 'Kill a gear', killT, [T.gear({ prompt: 'Kill a gear', ...harm })]),
  ]),
]);

// Shimmering Swimmer
card('rad-014-167', "You may kill a friendly unit or gear as an additional cost to play me.\nWhen you play me, if you paid the additional cost, deal 2 to a unit.", [
  onPlay(dealT(2), { if: ctx => !!playData(ctx).paidAdditional, targets: [T.unit({ prompt: 'Deal 2 to a unit', ...harm })], text: 'When you play me, if you paid the additional cost, deal 2 to a unit.' }),
], {
  additionalCosts: [{ cost: cost('', pay.killFriendly((c, id) => c.isUnit(id) || c.isGear(id), 'Kill a friendly unit or gear')), optional: true, label: 'Kill a friendly unit or gear as an additional cost' }],
});

// Mordekaiser, Twice Slain
card('rad-020-167', "[Accelerate]\n[Assault 3]\nOnce each turn, if I would die, you may kill a friendly unit to heal me, exhaust me, and recall me instead.", [
  replacement('die', (ev, ctx) => ev.obj === ctx.self && ctx.friendlyUnits(u => u !== ctx.self && ctx.ctrl(u) === ctx.controller).length > 0, (ev, ctx) => {
    const cands = ctx.friendlyUnits(u => u !== ctx.self && ctx.ctrl(u) === ctx.controller);
    const u = ctx.chooseCards(cands, 1, 1, 'Mordekaiser: kill a friendly unit to save me')[0];
    if (!u) return ev;
    ctx.kill(u);
    ctx.heal(ctx.self); ctx.exhaust(ctx.self); ctx.recall(ctx.self);
    return null;
  }, { optional: 'Mordekaiser would die: kill a friendly unit to heal, exhaust and recall him instead?', oncePerTurn: 1, text: 'Once each turn, if I would die, you may kill a friendly unit to heal me, exhaust me, and recall me instead.' }),
]);

// Hush
card('rad-041-167', "[Reaction]\nCounter a spell with Power cost [A][A] or more.", [
  spell(counterT, { targets: [aSpell('Counter a spell with Power cost [A][A] or more', (c, id) => itemPower(c, id) >= 2)] }),
]);

// Parallel Convergence
card('rad-051-167', "As an additional cost to play this, return a friendly unit to its owner's hand.\nDeal 5 to a unit at a battlefield.", [
  spell(dealT(5), { targets: [unitAtBf('Deal 5 to a unit at a battlefield')] }),
], {
  additionalCosts: [{ cost: cost('', pay.returnFriendlyToHand()), label: 'Return a friendly unit to its owner\'s hand' }],
});

// Improvised Projectile
card('rad-056-167', "[Action]\nChoose a friendly gear. Deal damage equal to its Energy cost to a unit at a battlefield.", [
  spell(ctx => {
    const gear = ctx.target(0), t = ctx.target(1);
    if (!gear || !t) return;
    const n = ctx.energyCost(gear);
    if (n > 0) ctx.deal(n, t);
  }, { targets: [T.gear(F.friendly, { prompt: 'Choose a friendly gear', hint: 'neutral' }), unitAtBf('Deal damage equal to its Energy cost to a unit at a battlefield')] }),
]);

// Supernova
card('rad-059-167', "Deal 10 to a unit. Draw 2.", [
  spell(E.seq(dealT(10), E.draw(2)), { targets: [T.unit({ prompt: 'Deal 10 to a unit', ...harm })] }),
]);

// Armored Tusker
card('rad-078-167', "[Shield 3]\n[Tank]\nWhen I move, you may deal damage equal to my [Shield] to a unit at a battlefield.", [
  onMove(ctx => { const t = ctx.target(0); const n = ctx.kw(ctx.self, 'Shield'); if (t && n > 0) ctx.deal(n, t); },
    { optional: 'Armored Tusker moved: deal damage equal to its Shield to a unit at a battlefield?', targets: [unitAtBf('Deal damage equal to my Shield to a unit at a battlefield')], text: 'When I move, you may deal damage equal to my [Shield] to a unit at a battlefield.' }),
]);

// Avalanche
card('rad-079-167', "Deal 3 to all units in bases.", [
  spell(ctx => { ctx.deal(3, ctx.units(u => ctx.loc(u) === 'base')); }),
]);

// Primordial Roar
card('rad-082-167', "[Show Off] a unit.\nIf you showed off a unit, deal damage equal to that unit's Might to a unit.", [
  showOff(F.unit, 'Show off a unit (reveal one from hand or pick a friendly unit)?'),
  spell(ctx => {
    if (!ctx.data.shownOff) return;
    const t = ctx.target(0);
    const n = Number(ctx.data.shownOffMight ?? 0);
    if (t && n > 0) ctx.deal(n, t);
  }, { targets: [T.unit({ prompt: 'Deal damage equal to the shown-off unit\'s Might to a unit', ...harm })] }),
], { keywords: ['Show Off'] });

// Stalwart Goatherd
card('rad-083-167', "[Shield 2]\nWhen you play me, you may kill a gear with Energy cost [4] or less.", [
  onPlay(killT, { optional: 'Stalwart Goatherd: kill a gear with Energy cost 4 or less?', targets: [T.gear(F.costAtMost(4), { prompt: 'Kill a gear with Energy cost [4] or less', ...harm })], text: 'When you play me, you may kill a gear with Energy cost [4] or less.' }),
]);

// Dune Devourer
card('rad-125-167', "You may kill a friendly unit as an additional cost to play me. If you do, I cost [2] less.\n[Deflect]", [
  // While the play is only being checked, assume the discount if it could be taken (so the card is offered);
  // during the play the discount is part of the optional additional cost below.
  selfCostDyn(ctx => (!ctx.item && ctx.friendlyUnits(u => u !== ctx.self && ctx.ctrl(u) === ctx.controller).length > 0 ? { energy: -2 } : {}), { text: 'If you do, I cost [2] less.' }),
], {
  additionalCosts: [{ cost: { energy: -2, power: [], extra: [pay.killFriendly()] }, optional: true, label: 'Kill a friendly unit to have me cost [2] less' }],
});

// Mournful Spirit
card('rad-126-167', "[Deathknell][>] You may kill a unit or gear here.", [
  deathknell(killT, { optional: 'Mournful Spirit: kill a unit or gear here?', targets: [T.permanent(F.here, { prompt: 'Kill a unit or gear here', ...harm })], text: 'Deathknell — You may kill a unit or gear here.' }),
]);

// Mordekaiser, Dominating
// (only offered when a card can be discarded: the engine would ask first and then drop the trigger, DSL requests B1-15 / B3-12)
const mordeOpts = { optional: 'Mordekaiser: discard 1 to kill a unit or gear?', cost: cost('', pay.discard(1)), targets: [T.permanent({ prompt: 'Kill a unit or gear', ...harm })], requires: [dep.custom(ctx => ctx.hand().length > 0)] };
card('rad-137-167', "When you play me or when I attack, you may discard 1 to kill a unit or gear.", [
  onPlay(killT, { ...mordeOpts, text: 'When you play me, you may discard 1 to kill a unit or gear.' }),
  onAttack(killT, { ...mordeOpts, text: 'When I attack, you may discard 1 to kill a unit or gear.' }),
]);

// Realm of Death (Mordekaiser)
card('rad-144-167', "Give an enemy unit -2 [S] this turn and a friendly unit +2 [S] this turn. They deal damage equal to their Mights to each other.", [
  spell(ctx => {
    const e = ctx.target(0), f = ctx.target(1);
    if (e) ctx.giveMight(e, -2, 'endOfTurn');
    if (f) ctx.giveMight(f, 2, 'endOfTurn');
    fightIfBoth(ctx, f, e);
  }, { targets: [enemyUnit('Give an enemy unit -2 Might this turn'), friendlyUnit('Give a friendly unit +2 Might this turn')] }),
]);

// Ntofo Strikes (K'Sante)
card('rad-148-167', "[Action]\nGive a friendly unit [Shield 2] this turn, then deal damage equal to its [Shield] to an enemy unit.", [
  spell(ctx => {
    const u = ctx.target(0), e = ctx.target(1);
    if (!u) return;
    ctx.giveKeyword(u, 'Shield 2', 'endOfTurn');
    const n = ctx.kw(u, 'Shield');
    if (e && n > 0) ctx.deal(n, e);
  }, { targets: [friendlyUnit('Give a friendly unit [Shield 2] this turn'), enemyUnit('Deal damage equal to its Shield to an enemy unit')] }),
]);

// =====================================================================================
// SPIRITFORGED (sfd)
// =====================================================================================

// Detonate
card('sfd-005-221', "Kill a gear. Its controller draws 2.", [
  spell(ctx => { const t = ctx.target(0); if (!t) return; const p = ctx.ctrl(t); ctx.kill(t); ctx.draw(2, p); },
    { targets: [T.gear({ prompt: 'Kill a gear (its controller draws 2)', ...harm })] }),
]);

// Blast Corps Cadet
card('sfd-013-221', "You may pay [1][C] as an additional cost to play me.\nWhen you play me, if you paid the additional cost, deal 2 to a unit at a battlefield.", [
  onPlay(dealT(2), { if: ctx => !!playData(ctx).paidAdditional, targets: [unitAtBf('Deal 2 to a unit at a battlefield')], text: 'When you play me, if you paid the additional cost, deal 2 to a unit at a battlefield.' }),
], {
  additionalCosts: [{ cost: cost('[1][C]'), optional: true, label: 'Pay [1][C] as an additional cost' }],
});

// Sudden Storm
card('sfd-017-221', "[Hidden]\n[Action]\nDeal 2 to a unit at a battlefield. If it's attacking, deal 4 to it instead.", [
  spell(ctx => { const t = ctx.target(0); if (t) ctx.deal(ctx.isAttacking(t) ? 4 : 2, t); }, { targets: [unitAtBf('Deal 2 to a unit at a battlefield (4 if it\'s attacking)')] }),
]);

// Piercing Light
card('sfd-023-221', "[Repeat] [2][C]\nDeal 2 to a unit at a battlefield, then deal 2 to up to one other unit.", [
  spell(ctx => {
    const a = ctx.target(0), b = ctx.target(1);
    if (a) ctx.deal(2, a);
    if (b && b !== a) ctx.deal(2, b);
  }, { targets: [unitAtBf('Deal 2 to a unit at a battlefield'), T.upTo(1, T.unit(notPrior, { prompt: 'Deal 2 to up to one other unit', ...harm }))] }),
]);

// Disarming Rake
card('sfd-032-221', "When you play me, you may kill a gear.", [
  onPlay(killT, { optional: 'Disarming Rake: kill a gear?', targets: [T.gear({ prompt: 'Kill a gear', ...harm })], text: 'When you play me, you may kill a gear.' }),
]);

// Not So Fast
card('sfd-045-221', "[Reaction]\nCounter an enemy spell or ability that chooses a friendly unit or gear.", [
  spell(counterT, { targets: [T.chainItem(enemyItem, (c, id) => friendlyPermanents(c, chosenBy(c, id)).length > 0, { prompt: 'Counter an enemy spell or ability that chooses a friendly unit or gear', hint: 'harm' })] }),
]);

// Rocket Barrage — the mode is implied by the chosen object (a unit in a base: deal 4; a gear: kill it), so that a
// Repeat may make a different choice (the engine's Repeat keeps the first mode; DSL request B5-3).
card('sfd-077-221', "[Repeat] [4][C]\nChoose one —\n- Deal 4 to a unit in a base.\n- Kill a gear.", [
  spell(ctx => {
    const t = ctx.target(0);
    if (!t) return;
    if (ctx.isUnit(t)) ctx.deal(4, t); else ctx.kill(t);
  }, { targets: [T.permanent((c, id) => (c.isUnit(id) && c.loc(id) === 'base') || (c.isGear(id) && !c.isUnit(id)), { prompt: 'Choose one — a unit in a base (deal 4 to it) or a gear (kill it)', hint: 'harm' })] }),
]);

// Bellows Breath
card('sfd-080-221', "[Action]\n[Repeat] [1][C]\nDeal 1 to up to three units at the same location.", [
  spell(ctx => {
    const ids = ctx.targetsOf(0).filter(id => ctx.onBoard(id));
    // the same-location requirement is enforced when chosen. If the targets ended up at different locations (moved in
    // response), the controller picks one location and only the targets there are dealt damage (RJ#9125/#7422 house ruling)
    const locs = [...new Set(ids.map(id => ctx.loc(id)).filter((l): l is NonNullable<typeof l> => l !== null))];
    const at = locs.length > 1 ? ctx.chooseLocation(locs, 'Bellows Breath: its targets are now at different locations — deal 1 to those at') : locs[0];
    ctx.deal(1, ids.filter(id => ctx.loc(id) === at));
  }, { targets: [T.upTo(3, T.unit({ sameLocation: true, prompt: 'Deal 1 to up to three units at the same location', hint: 'harm' }))] }),
]);

// Marching Orders
card('sfd-114-221', "[Action]\n[Repeat] [3]\nChoose a friendly unit anywhere and an enemy unit at a battlefield. They deal damage equal to their Mights to each other.", [
  spell(ctx => fightIfBoth(ctx, ctx.target(0), ctx.target(1)), { targets: [friendlyUnit('Choose a friendly unit anywhere'), enemyUnit('Choose an enemy unit at a battlefield', F.atBattlefield)] }),
]);

// Sivir, Ambitious — excess combat damage is recorded while it is dealt (DSL request B5-4)
// (sivirKey removed: Sivir uses the B4 excess-assignment bookkeeping)
card('sfd-120-221', "[Deflect 2]\nWhen I conquer after an attack, if you assigned 5 or more excess damage to enemy units, you may deal that much to an enemy unit.", [
  // RULINGS: "assigned … excess damage" = damage assigned beyond lethal (engine excess record from the damage assignment, ctx.excessDamage),
  // not damage dealt after prevention
  when('conquer', (ev, ctx) => ev.player === ctx.controller && ((ev.units as ObjId[] | undefined) ?? []).includes(ctx.self) && ctx.isAttacking(ctx.self), ctx => {
    const n = ctx.excessDamage();
    const t = ctx.target(0);
    if (t && n > 0) ctx.deal(n, t);
  }, {
    if: ctx => ctx.excessDamage() >= 5,
    optional: 'Sivir: deal the excess damage to an enemy unit?',
    targets: [enemyUnit('Deal the excess damage to an enemy unit')],
    text: 'When I conquer after an attack, if you assigned 5 or more excess damage to enemy units, you may deal that much to an enemy unit.',
  }),
]);

// Beast Below
card('sfd-132-221', "When you play me, return another friendly unit and an enemy unit to their owners' hands.", [
  onPlay(ctx => { ctx.returnToHand([ctx.target(0), ctx.target(1)].filter((x): x is ObjId => !!x)); },
    { targets: [T.unit(F.friendly, F.other, { prompt: 'Return another friendly unit to its owner\'s hand' }), enemyUnit('Return an enemy unit to its owner\'s hand')], text: "When you play me, return another friendly unit and an enemy unit to their owners' hands." }),
]);

// Factory Recall
card('sfd-135-221', "[Action]\nReturn a gear to its owner's hand.", [
  spell(bounceT, { targets: [T.gear({ prompt: 'Return a gear to its owner\'s hand' })] }),
]);

// Hard Bargain
card('sfd-136-221', "[Reaction]\n[Repeat] [2]\nCounter a spell unless its controller pays [2].", [
  spell(ctx => {
    const t = ctx.target(0);
    const it = t ? itemOf(ctx, t) : undefined;
    if (!t || !it) return;
    if (ctx.mayPayFor(it.controller, cost('[2]'), `Hard Bargain: pay [2] so ${it.label ?? 'your spell'} isn't countered?`)) return;
    ctx.counter(t);
  }, { targets: [aSpell('Counter a spell unless its controller pays [2]')] }),
]);

// Downwell
card('sfd-147-221', "Return all units and gear to their owners' hands.", [
  spell(ctx => { ctx.returnToHand([...new Set([...ctx.units(), ...ctx.gear()])]); }),
]);

// Sandshifter
card('sfd-158-221', "When you play me, kill an enemy unit with 3 [S] or less.", [
  onPlay(killT, { targets: [enemyUnit('Kill an enemy unit with 3 Might or less', F.mightAtMost(3))], text: 'When you play me, kill an enemy unit with 3 [S] or less.' }),
]);

// Zaun Punk
card('sfd-160-221', "You may kill a friendly gear as an additional cost to play me.\nWhen you play me, if you paid the additional cost, kill a gear.", [
  onPlay(killT, { if: ctx => !!playData(ctx).paidAdditional, targets: [T.gear({ prompt: 'Kill a gear', ...harm })], text: 'When you play me, if you paid the additional cost, kill a gear.' }),
], {
  additionalCosts: [{ cost: cost('', pay.killFriendly((c, id) => c.isGear(id) && !c.isUnit(id), 'Kill a friendly gear')), optional: true, label: 'Kill a friendly gear as an additional cost' }],
});

// Deathgrip
card('sfd-163-221', "[Reaction]\nKill a friendly unit. If you do, give +[M] equal to its Might to another friendly unit this turn.\nDraw 1.", [
  spell(ctx => {
    const k = ctx.target(0), o = ctx.target(1);
    if (k) {
      const m = ctx.might(k);
      if (ctx.kill(k).length && o && o !== k && m > 0) ctx.giveMight(o, m, 'endOfTurn');
    }
    ctx.draw(1);
  }, { targets: [friendlyUnit('Kill a friendly unit'), T.unit(F.friendly, notPrior, { prompt: 'Give +Might equal to its Might to another friendly unit', hint: 'help' })] }),
]);

// Drag Under
const fromNonHand = (ctx: Ctx): boolean => {
  const o = ctx.obj(ctx.self);
  if (!o) return false;
  if (o.zone !== 'chain') return o.zone !== 'hand';
  const it = ctx.item ?? ctx.g.chain.find(c => c.source === ctx.self && c.pending);
  if (!it) return false;
  return !!it.fromHidden || !!it.viaFlow || ctx.g.ex.playPermissions.some(p => p.obj === ctx.self);
};
card('sfd-164-221', "[Action]\nI cost [2] less to play from anywhere other than your hand.\nKill a unit at a battlefield.", [
  selfCostDyn(ctx => (fromNonHand(ctx) ? { energy: -2 } : {}), { text: 'I cost [2] less to play from anywhere other than your hand.' }),
  spell(killT, { targets: [unitAtBf('Kill a unit at a battlefield')] }),
]);

// Arcane Shift (Ezreal)
card('sfd-200-221', "[Action]\nBanish a friendly unit, then its owner plays it, ignoring its cost. Deal 3 to an enemy unit at a battlefield. Banish this.", [
  spell(ctx => {
    const u = ctx.target(0), e = ctx.target(1);
    if (u) {
      const owner = ctx.owner(u);
      if (ctx.banish(u).length) ctx.as(owner).play(u, { ignoreCost: true });
    }
    if (e) ctx.deal(3, e);
    ctx.banishAfterResolve();
  }, { targets: [friendlyUnit('Banish a friendly unit (its owner plays it again)'), enemyUnit('Deal 3 to an enemy unit at a battlefield', F.atBattlefield)] }),
]);

// Riposte (Fiora)
card('sfd-206-221', "[Reaction]\nChoose a friendly unit and a spell. Counter that spell and give that unit +[S] equal to that spell's Energy cost this turn.", [
  spell(ctx => {
    const u = ctx.target(0), s = ctx.target(1);
    if (!s) return;
    const n = itemEnergy(ctx, s);
    ctx.counter(s);
    if (u && n > 0) ctx.giveMight(u, n, 'endOfTurn');
  }, { targets: [friendlyUnit('Choose a friendly unit'), aSpell('Counter a spell')] }),
]);

// =====================================================================================
// UNLEASHED (unl)
// =====================================================================================

// Mischievous Marai
card('unl-003-219', "[Hidden]\nWhen you play me to a battlefield, deal 2 to an enemy unit here.", [
  onPlayToBattlefield(dealT(2), { targets: [enemyUnit('Deal 2 to an enemy unit here', F.here)], text: 'When you play me to a battlefield, deal 2 to an enemy unit here.' }),
]);

// Smite
card('unl-007-219', "[Action]\nDeal 3 to a unit at a battlefield. If it would die this turn, banish it instead.", [
  spell(ctx => {
    const t = ctx.target(0);
    if (!t) return;
    ctx.delay(SMITE, { obj: t, epoch: ctx.obj(t).epoch ?? 0 }, 'endOfTurn');
    ctx.deal(3, t);
  }, { targets: [unitAtBf('Deal 3 to a unit at a battlefield (banished if it would die this turn)')] }),
]);

// Monster Harpoon
card('unl-014-219', "[Action]\nDeal 2 to a unit at a battlefield. If you control a facedown card, deal 4 to it instead.", [
  spell(ctx => { const t = ctx.target(0); if (t) ctx.deal(controlsFacedown(ctx) ? 4 : 2, t); }, { targets: [unitAtBf('Deal 2 to a unit at a battlefield (4 if you control a facedown card)')] }),
]);

// Dancing Grenade
const grenadeKey = (id: ObjId) => `B5:grenadeHits:${id}`;
card('unl-020-219', "Deal 2 to a unit. Its controller may play this spell again for [A]. If they do, this deals 1 additional Bonus Damage for each time this spell has dealt damage this turn.", [
  spell(ctx => {
    const t = ctx.target(0);
    if (!t) return;
    const p = ctx.ctrl(t);
    const bonus = ctx.count(grenadeKey(ctx.self));
    const dealt = ctx.deal(2 + bonus, t);
    if (Object.values(dealt).some(n => n > 0)) ctx.bump(grenadeKey(ctx.self));
    // RJ#13328: the replay is part of this spell's own resolution — the target's controller decides (and pays [A]) while the
    // grenade is still on the chain, and it is played again from there: it never reaches the trash during the loop (same
    // object, so the damage count accumulates). resolveTop keeps a spell on the chain when it was replayed (chain.ts).
    const pc = ctx.as(p);
    const c = cost('[A]');
    if (ctx.obj(ctx.self)?.zone !== 'chain' || !pc.canPay(c, ctx.self)) return;
    if (!pc.may(`Play ${ctx.name(ctx.self)} again for [A]?`)) return;
    if (!pc.pay(c, ctx.self)) return;
    pc.play(ctx.self, { ignoreCost: true });
  }, { targets: [T.unit({ prompt: 'Deal 2 to a unit', ...harm })] }),
]);

// Katarina, Reckless
card('unl-023-219', "When you hide a card, ready me.\nWhen you play a card from face down, deal 2 to an enemy unit.", [
  when('hide', on.mine, E.ready('self'), { text: 'When you hide a card, ready me.' }),
  when('play', (ev, ctx) => ev.player === ctx.controller && !!ev.fromHidden, dealT(2), { targets: [enemyUnit('Deal 2 to an enemy unit')], text: 'When you play a card from face down, deal 2 to an enemy unit.' }),
]);

// Xerath, Freed
card('unl-026-219', "[C], [T]: Deal 3 to a unit. Use this ability only while I'm at a battlefield.", [
  activated('[C], [T]', dealT(3), { targets: [T.unit({ prompt: 'Deal 3 to a unit', ...harm })], if: ctx => ctx.atBattlefield(ctx.self), text: '[C], [T]: Deal 3 to a unit.' }),
]);

// Ruined Rex
card('unl-067-219', "[Deathknell][>] Deal 4 to an enemy unit.", [
  deathknell(dealT(4), { targets: [enemyUnit('Deal 4 to an enemy unit')], text: 'Deathknell — Deal 4 to an enemy unit.' }),
]);

// Crescent Strike
card('unl-072-219', "[Action]\nChoose a battlefield and an enemy unit there. Deal 4 to that unit and 1 to each other enemy unit there.", [
  spell(ctx => {
    const bf = bfIndexOf(ctx, ctx.target(0));
    if (bf === undefined) return;
    const u = ctx.target(1);
    const main = u && ctx.loc(u) === bf ? u : undefined;
    const others = unitsAtBf(ctx, bf, id => ctx.isEnemy(id) && id !== main);
    ctx.dealEach([...(main ? [{ id: main, amount: 4 }] : []), ...others.map(id => ({ id, amount: 1 }))]);
  }, {
    targets: [
      T.battlefield((c, id) => { const i = bfIndexOf(c, id); return i !== undefined && c.unitsAt(i, u => c.isEnemy(u)).length > 0; }, { prompt: 'Choose a battlefield with an enemy unit' }),
      T.unit(F.enemy, F.atBattlefield, (c, id) => { const p = priorPicks(c)[0]; const i = bfIndexOf(c, p); return i === undefined || c.loc(id) === i; }, { prompt: 'Choose an enemy unit there (deal 4)', hint: 'harm' }),
    ],
  }),
]);

// Repulse
const repulseOk = (ctx: Ctx, itemId: string, friendly: ObjId | undefined) => {
  const fr = friendlyPermanents(ctx, chosenBy(ctx, itemId)).filter(id => ctx.isUnit(id));
  return friendly ? fr.length === 1 && fr[0] === friendly : fr.length === 1 && ctx.atBattlefield(fr[0]);
};
card('unl-106-219', "[Reaction]\nChoose a friendly unit at a battlefield. Counter an enemy spell or ability that chooses it and no other friendly unit.", [
  spell(ctx => {
    const u = ctx.target(0), it = ctx.target(1);
    if (u && it && repulseOk(ctx, it, u)) ctx.counter(it);
  }, {
    targets: [
      friendlyUnit('Choose a friendly unit at a battlefield', F.atBattlefield),
      T.chainItem(enemyItem, (c, id) => repulseOk(c, id, priorPicks(c)[0]), { prompt: 'Counter an enemy spell or ability that chooses it and no other friendly unit', hint: 'harm' }),
    ],
  }),
]);

// Clash of Giants
card('unl-110-219', "Choose two units. They deal damage equal to their Mights to each other.", [
  spell(ctx => { const [a, b] = ctx.targetsOf(0); fightIfBoth(ctx, a, b); }, { targets: [T.exactly(2, T.unit({ prompt: 'Choose two units', ...harm }))] }),
]);

// Elder Dragon — "choose up to one enemy unit at each location": one optional group per battlefield and per base
const elderGroups = [
  ...[0, 1, 2, 3, 4, 5].map(i => T.upTo(1, T.unit(F.enemy, (c, id) => c.loc(id) === i, { prompt: 'Choose up to one enemy unit at this battlefield', hint: 'harm' }))),
  ...[0, 1, 2, 3].map(p => T.upTo(1, T.unit(F.enemy, F.atBase, (c, id) => c.ctrl(id) === p, { prompt: 'Choose up to one enemy unit in this base', hint: 'harm' }))),
];
card('unl-118-219', "Any amount of your damage is enough to kill enemy units.\nWhen you play me, choose up to one enemy unit at each location. Deal 1 to them.", [
  rule('anyDamageLethal', (ctx, dealer: PlayerId, unit: ObjId) => dealer === ctx.controller && ctx.isEnemy(unit), undefined, { text: 'Any amount of your damage is enough to kill enemy units.' }),
  onPlay(ctx => { ctx.deal(1, allTargets(ctx, elderGroups.map((_, i) => i))); }, { targets: elderGroups, text: 'When you play me, choose up to one enemy unit at each location. Deal 1 to them.' }),
]);

// Star-Crossed
card('unl-128-219', "[Reaction]\nReturn a friendly unit and an enemy unit to their owners' hands.", [
  spell(ctx => { ctx.returnToHand([ctx.target(0), ctx.target(1)].filter((x): x is ObjId => !!x)); },
    { targets: [friendlyUnit('Return a friendly unit to its owner\'s hand'), enemyUnit('Return an enemy unit to its owner\'s hand')] }),
]);

// Abandon
card('unl-131-219', "[Reaction]\nCounter a spell. Return it to its owner's hand instead of putting it in their trash.\n[Predict].", [
  spell(ctx => {
    const t = ctx.target(0);
    const it = t ? itemOf(ctx, t) : undefined;
    if (t && it) {
      if (it.viaFlow) {
        // a spell played with Flow is banished when it leaves the chain (rules-tests T159)
        const src = it.source;
        if (ctx.counter(t) && ctx.exists(src) && ctx.obj(src).zone === 'trash') ctx.banish(src);
      } else ctx.counterReturn(t);
    }
    ctx.predict(1);
  }, { targets: [aSpell('Counter a spell (it returns to its owner\'s hand)')] }),
]);

// Heedless Resurrection
const heedlessFits = (ctx: Ctx, id: ObjId, lim: { e: number; p: number }) => ctx.energyCost(id) <= lim.e && ctx.powerCost(id) <= lim.p;
const heedlessKillable = (ctx: Ctx) => {
  const dead = ctx.trash().filter(id => ctx.type(id) === 'Unit');
  return ctx.units(u => ctx.ctrl(u) === ctx.controller && u !== ctx.self && dead.some(t => heedlessFits(ctx, t, { e: ctx.energyCost(u), p: ctx.powerCost(u) })));
};
card('unl-142-219', "[Reaction]\nAs an additional cost to play this, kill a friendly unit.\nPlay a unit from your trash that costs no more Energy and no more Power than the killed unit, ignoring its cost.", [
  // RULINGS sweep / CR 355.5: the trash unit is a target chosen as the spell is played. The friendly unit to kill is picked first,
  // as you play (it is killed in the payment step after Energy/Power, CR 357, as for Atakhan), so the target's limit is known.
  // Only friendly units for which some trash unit qualifies are offered (CR 355.16-17: the target is mandatory).
  asPlay(ctx => {
    const u = ctx.chooseCards(heedlessKillable(ctx), 1, 1, 'Heedless Resurrection: kill a friendly unit (additional cost)')[0];
    if (!u) return;
    ctx.data.heedless = { e: ctx.energyCost(u), p: ctx.powerCost(u) };
    ctx.addPlayCost({ energy: 0, power: [], extra: [{ label: `Kill ${ctx.name(u)}`, canPay: c => c.onBoard(u), pay: c => { if (!c.onBoard(u)) return false; c.data.heedlessKilled = c.kill(u).length > 0; return true; } }] });   // CR 203.2: paid even if replaced
  }, { text: 'As an additional cost to play this, kill a friendly unit.' }),
  spell(ctx => {
    const t = ctx.target(0);
    // RJ#10371 (as Baited Hook, DECISIONS #4295): a kill replaced (Zhonya's) leaves no killed unit to compare against → nothing
    if (ctx.data.heedlessKilled === false) return;
    if (t && ctx.obj(t)?.zone === 'trash') ctx.play(t, { ignoreCost: true });
  }, {
    playIf: ctx => heedlessKillable(ctx).length > 0,
    targets: [T.card({ zones: ['trash'], prompt: 'Play a unit from your trash (no more Energy and Power than the killed unit), ignoring its cost' },
      (c, id) => c.owner(id) === c.controller && c.type(id) === 'Unit' && (() => {
        const lim = c.data.heedless as { e: number; p: number } | undefined;
        return lim ? heedlessFits(c, id, lim) : heedlessKillable(c).length > 0;
      })())],
  }),
]);

// Soul Harvest
card('unl-159-219', "Kill a unit at a battlefield with 3 [S] or less.", [
  spell(killT, { targets: [unitAtBf('Kill a unit at a battlefield with 3 Might or less', F.mightAtMost(3))] }),
]);

// Stalking Wolf — the destination is chosen before costs are paid; the engine re-checks it afterwards (CR 358), so the
// killed unit's battlefield is kept legal by a one-off play rule for this card ("even if you don't have other units there").
const WOLF_DEST = delayedAbility('B5:stalkingWolfDest', playRule((ctx, id) => id === ctx.data.obj && (ctx.obj(id)?.epoch ?? -1) === ctx.data.epoch, {
  extraDestinations: ctx => [ctx.data.bf as number],
  text: 'You may Ambush me to its battlefield',
}));
const wolfFood: Filter = (c, id) => c.isUnit(id) && id !== c.self && c.ctrl(id) === c.controller && ['Bird', 'Cat', 'Dog', 'Poro'].some(t => c.hasTag(id, t));
card('unl-166-219', "[Ambush]\nAs an additional cost to play me, kill a Bird, Cat, Dog, or Poro you control. You may [Ambush] me to its battlefield, even if you don't have other units there.", [], {
  additionalCosts: [{
    cost: cost('', pay.custom('Kill a Bird, Cat, Dog, or Poro you control', ctx => ctx.units(u => wolfFood(ctx, u)).length > 0, ctx => {
      const u = ctx.chooseCards(ctx.units(x => wolfFood(ctx, x)), 1, 1, 'Kill a Bird, Cat, Dog, or Poro you control')[0];
      if (!u) return false;
      const loc = ctx.loc(u);
      if (typeof loc === 'number') ctx.delay(WOLF_DEST, { obj: ctx.self, epoch: ctx.obj(ctx.self).epoch ?? 0, bf: loc }, 'endOfTurn');
      ctx.kill(u);
      return true;
    })),
    label: 'Kill a Bird, Cat, Dog, or Poro you control',
  }],
});

// Sacrifice
card('unl-173-219', "[Reaction]\nAs an additional cost to play this, kill a friendly [Mighty] unit.\nDraw 2 and channel 1 rune exhausted.", [
  spell(E.seq(E.draw(2), E.channel(1, true))),
], {
  additionalCosts: [{ cost: cost('', pay.killFriendly((c, id) => c.isUnit(id) && c.isMighty(id), 'Kill a friendly Mighty unit')), label: 'Kill a friendly Mighty unit' }],
});

// Shard of Undoing
card('unl-174-219', "The first time a friendly unit dies during your Beginning Phase each turn, each opponent must kill one of their units.", [
  when('die', (ev, ctx) => ctx.g.phase === 'beginning' && ctx.isMyTurn() && typeof ev.obj === 'string' && ctx.isFriendly(ev.obj) && ctx.isUnit(ev.obj), ctx => {
    eachPlayerKillsOne(ctx, p => unitsControlledBy(ctx, p), 'units', ctx.opponents());
  }, { oncePerTurn: 1, text: 'The first time a friendly unit dies during your Beginning Phase each turn, each opponent must kill one of their units.' }),
]);

// The Ruination
card('unl-180-219', "Kill all units.", [
  spell(ctx => { ctx.kill(ctx.units()); }),
]);

// Curtain Call (Jhin) — "[Repeat] — [1] / [A] / [1][A]": each extra cost is offered as the card is played
// (the engine supports one Repeat cost; DSL request B5-5). Extra executions choose a mode not chosen yet and its target.
interface CCMode { id: string; label: string; spec?: import('../dsl.ts').TargetSpec; run: (ctx: Ctx, t?: ObjId) => void }
const ccModes: CCMode[] = [
  { id: 'draw', label: 'Draw 1', run: ctx => { ctx.draw(1); } },
  { id: 'bf2', label: 'Deal 2 to a unit at a battlefield', spec: unitAtBf('Deal 2 to a unit at a battlefield'), run: (ctx, t) => { if (t) ctx.deal(2, t); } },
  { id: 'base3', label: 'Deal 3 to a unit at a base', spec: T.unit(F.atBase, { prompt: 'Deal 3 to a unit at a base', ...harm }), run: (ctx, t) => { if (t) ctx.deal(3, t); } },
  { id: 'minus4', label: 'Give a unit at a battlefield -4 Might this turn', spec: unitAtBf('Give a unit at a battlefield -4 Might this turn'), run: (ctx, t) => { if (t) ctx.giveMight(t, -4, 'endOfTurn'); } },
];
const CC_REPEAT = [cost('[1]'), cost('[A]'), cost('[1][A]')];
const CC_LABEL = ['[1]', '[A]', '[1][A]'];
card('unl-182-219', "[Repeat] — [1] / [A] / [1][A]\nChoose one you haven't already chosen —\n- Draw 1.\n- Deal 2 to a unit at a battlefield.\n- Deal 3 to a unit at a base.\n- Give a unit at a battlefield -4 [S] this turn.", [
  asPlay(ctx => {
    let energy = ctx.energyCost(ctx.self);
    let power: PowerSym[] = [];
    let n = 0;
    CC_REPEAT.forEach((c, i) => {
      const next = { energy: energy + (c.energy ?? 0), power: [...power, ...(c.power ?? [])] };
      if (!ctx.canPay(next)) return;
      if (!ctx.may(`Curtain Call: pay ${CC_LABEL[i]} to repeat?`)) return;
      energy = next.energy; power = next.power; n++;
      ctx.addPlayCost(c);
    });
    ctx.data.repeats = n;
  }, { text: '[Repeat] — [1] / [A] / [1][A]' }),
  spellModes(ccModes.map(m => mode(m.id, m.label, ctx => {
    m.run(ctx, ctx.target(0));
    const used = [m.id];
    for (let r = 0; r < Number(ctx.data.repeats ?? 0); r++) {
      const avail = ccModes.filter(x => !used.includes(x.id) && (!x.spec || ctx.units(u => ctx.isLegalTarget(x.spec!, u)).length > 0));
      if (!avail.length) break;
      const id = ctx.chooseMode(avail.map(x => ({ id: x.id, label: x.label })), "Curtain Call (repeat): choose one you haven't already chosen");
      used.push(id);
      const x = avail.find(y => y.id === id)!;
      x.run(ctx, x.spec ? ctx.choose(x.spec)[0] : undefined);
    }
  }, m.spec ? [m.spec] : undefined))),
], { keywords: ['Repeat'] });

// Death from Below (Pyke) — CR 387-389 / RULINGS B5: "do this: You may play this from your trash for [A]" is a one-time
// reflexive item, put on the chain after the spell has gone to the trash; its "you may" is decided as it goes on the chain
// (offered only if [A] can be paid), opponents may respond (e.g. remove the card from the trash), and it is played on resolution.
const deathFromBelowReplay = reflexiveAbility('B5:deathFromBelow:replay', {
  offerIf: ctx => ctx.canPay(cost('[A]')),          // SF2-1: offered only if [A] can be paid as it goes on the chain
  optional: 'Death from Below: play it from your trash for [A]?',
  effect: ctx => {
    const o = ctx.obj(ctx.self);
    if (!o || o.zone !== 'trash' || (o.epoch ?? 0) !== Number(ctx.data.epoch) + 1) return;   // still the card that just resolved
    ctx.play(ctx.self, { cost: { pay: cost('[A]') } });
  },
  text: 'Death from Below: you may play this from your trash for [A]',
});
card('unl-186-219', "Kill a unit at a battlefield. Then, if it had 3 [M] or less, do this: You may play this from your trash for [A].", [
  spell(ctx => {
    const t = ctx.target(0);
    if (!t) return;
    const m = ctx.might(t);
    ctx.kill(t);
    if (m <= 3) ctx.reflexive(deathFromBelowReplay, { epoch: ctx.obj(ctx.self).epoch ?? 0 });
  }, { targets: [unitAtBf('Kill a unit at a battlefield')] }),
]);

// Lilting Lullaby (Lillia)
card('unl-190-219', "[Reaction]\nCounter a spell. Its controller can't play spells this turn.", [
  spell(ctx => {
    const t = ctx.target(0);
    const it = t ? itemOf(ctx, t) : undefined;
    if (!t || !it) return;
    const p = it.controller;
    ctx.counter(t);
    ctx.delay(NO_SPELLS, { p }, 'endOfTurn');
  }, { targets: [aSpell('Counter a spell (its controller can\'t play spells this turn)')] }),
]);

// Dusk Rose Lab (battlefield) — "you" is the player whose Beginning Phase it is, if they control this battlefield
const duskRoseUnits = (ctx: Ctx) => ctx.unitsAt(ctx.bfIndex(), u => ctx.ctrl(u) === ctx.controller);
card('unl-209-219', "At the start of your Beginning Phase, you may kill a unit you control here to draw 1.", [
  // RULINGS sweep / CR 383.3.b: the kill is the trigger's base cost, paid as it goes on the chain (the trigger belongs to the
  // battlefield's controller, whose Beginning Phase it is)
  when('beginningPhase', (ev, ctx) => ctx.bfController(ctx.bfIndex()) === ev.player && ev.player === ctx.controller, ctx => {
    ctx.as(ctx.event!.player as PlayerId).draw(1);
  }, {
    optional: 'Dusk Rose Lab: kill a unit you control here to draw 1?',
    cost: cost('', pay.custom('Kill a unit you control here', c => duskRoseUnits(c).length > 0, c => {
      const u = c.chooseCards(duskRoseUnits(c), 1, 1, 'Kill a unit you control here')[0];
      return !!u && c.kill(u).length === 1;
    })),
    text: 'At the start of your Beginning Phase, you may kill a unit you control here to draw 1.',
  }),
]);

// Frozen Fortress (battlefield)
card('unl-212-219', "At the start of each player's Beginning Phase, deal 1 to each unit here.", [
  when('beginningPhase', null, ctx => { ctx.deal(1, ctx.unitsAt(ctx.bfIndex())); }, { text: "At the start of each player's Beginning Phase, deal 1 to each unit here." }),
]);

// =====================================================================================
// VENDETTA (ven)
// =====================================================================================

// Brittle Steel
card('ven-003-166', "Kill a gear.\n[Flow] [4][C]", [
  spell(killT, { targets: [T.gear({ prompt: 'Kill a gear', ...harm })] }),
]);

// Ruthless Strike
card('ven-008-166', "[Action]\nAs an additional cost to play this, you may discard 1.\nDeal 3 to a unit at a battlefield. If you paid the additional cost, deal 5 to it instead.", [
  spell(ctx => { const t = ctx.target(0); if (t) ctx.deal(ctx.data.paidAdditional ? 5 : 3, t); }, { targets: [unitAtBf('Deal 3 to a unit at a battlefield (5 if you discarded)')] }),
], {
  additionalCosts: [{ cost: cost('', pay.discard(1)), optional: true, label: 'Discard 1 as an additional cost' }],
});

// Consuming Curse
card('ven-010-166', "[Action]\nDeal 2 to a unit at a battlefield. This deals 1 Bonus Damage for each card with this name in your trash.", [
  spell(ctx => {
    const t = ctx.target(0);
    if (!t) return;
    const name = ctx.name(ctx.self);
    const bonus = ctx.trash().filter(id => ctx.name(id) === name).length;
    ctx.deal(2 + bonus, t);
  }, { targets: [unitAtBf('Deal 2 (+1 per Consuming Curse in your trash) to a unit at a battlefield')] }),
]);

// Decree of Rage
card('ven-015-166', "[Action]\nThis can't be countered.\nDeal 4 to an enemy Calm unit.", [
  asPlay(ctx => { ctx.delay(UNCOUNTERABLE, { obj: ctx.self }, 'endOfTurn'); }, { text: "This can't be countered." }),
  spell(dealT(4), { targets: [enemyUnit('Deal 4 to an enemy Calm unit', F.domain('Calm'))] }),
]);

// Morgana, Vindictive
card('ven-017-166', "[Ambush]\nWhen you play me, deal damage to a unit equal to the damage marked on it.", [
  onPlay(ctx => { const t = ctx.target(0); if (t && ctx.damage(t) > 0) ctx.deal(ctx.damage(t), t); },
    { targets: [T.unit({ prompt: 'Deal damage to a unit equal to the damage marked on it', ...harm })], text: 'When you play me, deal damage to a unit equal to the damage marked on it.' }),
]);

// Crumbling Sands
card('ven-039-166', "[Reaction]\nCounter a spell if an opponent has played another spell this turn.", [
  spell(ctx => {
    const t = ctx.target(0);
    const it = t ? itemOf(ctx, t) : undefined;
    if (!t || !it) return;
    const other = ctx.opponents().some(o => ctx.playedThisTurn(o).some(id => id !== it.source && id !== ctx.self && ctx.exists(id) && ctx.type(id) === 'Spell'));
    if (other) ctx.counter(t);
  }, { targets: [aSpell('Counter a spell (if an opponent has played another spell this turn)')] }),
]);

// Sky Cruiser
const discardGear = pay.custom('Discard a gear',
  ctx => ctx.hand().some(id => id !== ctx.self && ctx.type(id) === 'Gear'),
  ctx => { const g = ctx.chooseCards(ctx.hand().filter(id => id !== ctx.self && ctx.type(id) === 'Gear'), 1, 1, 'Discard a gear')[0]; return !!g && ctx.discardCards([g]).length === 1; });
card('ven-060-166', "Discard a gear, [1], [T]: Deal 4 to a unit at a battlefield.", [
  activated(cost('[1], [T]', discardGear), dealT(4), { targets: [unitAtBf('Deal 4 to a unit at a battlefield')], text: 'Discard a gear, [1], [T]: Deal 4 to a unit at a battlefield.' }),
]);

// Noxian Demolitionist
card('ven-080-166', "When I conquer, you may kill a gear with Energy cost no more than my Might.", [
  onConquer(killT, { optional: 'Noxian Demolitionist: kill a gear with Energy cost no more than my Might?', targets: [T.gear((c, id) => c.energyCost(id) <= c.might(c.self), { prompt: 'Kill a gear with Energy cost no more than my Might', ...harm })], text: 'When I conquer, you may kill a gear with Energy cost no more than my Might.' }),
]);

// Rampage
card('ven-083-166', "As you play this, you may pay [C] as an additional cost.\nChoose a friendly unit and an enemy unit. If you paid the additional cost, give the friendly unit +2 [S] this turn. They deal damage equal to their Mights to each other.", [
  spell(ctx => {
    const f = ctx.target(0), e = ctx.target(1);
    if (f && ctx.data.paidAdditional) ctx.giveMight(f, 2, 'endOfTurn');
    fightIfBoth(ctx, f, e);
  }, { targets: [friendlyUnit('Choose a friendly unit'), enemyUnit('Choose an enemy unit')] }),
], {
  additionalCosts: [{ cost: cost('[C]'), optional: true, label: 'Pay [C] as an additional cost (+2 Might)' }],
});

// Cataclysmic Duel
card('ven-090-166', "Each player chooses a unit they control. Kill the rest.", [
  spell(ctx => {
    const keep: ObjId[] = [];
    ctx.eachPlayer(p => { keep.push(...ctx.chooseFor(p, T.unit(F.youControl, { prompt: 'Cataclysmic Duel: choose a unit you control to keep', hint: 'help' }))); });
    ctx.kill(ctx.units(u => !keep.includes(u)));
  }),
]);

// Wind and Ghosts
card('ven-106-166', "[Action]\nChoose a unit at a battlefield. If it has 3 [S] or less, banish it. Otherwise, return it to its owner's hand.", [
  spell(ctx => { const t = ctx.target(0); if (!t) return; if (ctx.might(t) <= 3) ctx.banish(t); else ctx.returnToHand(t); },
    { targets: [unitAtBf('Choose a unit at a battlefield (3 Might or less: banish it; otherwise return it to hand)')] }),
]);

// Decree of Discord
card('ven-107-166', "Return any number of enemy Order units with total Might 5 or less to their owners' hands.", [
  spell(ctx => {
    const ids = allTargets(ctx, [0, 1, 2, 3, 4, 5]);
    ctx.returnToHand(capTotalMight(ctx, ids, 5));
  }, { targets: totalMightGroups(6, 5, [F.enemy, F.domain('Order')], { prompt: 'Return enemy Order units (total Might 5 or less)' }) }),
]);

// Decree of Unity
card('ven-131-166', "Kill an enemy Chaos unit or gear.", [
  spell(killT, { targets: [T.permanent(F.enemy, F.domain('Chaos'), { prompt: 'Kill an enemy Chaos unit or gear', ...harm })] }),
]);

// Shuriken Flip (Akali)
card('ven-140-166', "Deal 2 to up to one enemy unit at a battlefield, then move a friendly unit.\n[Flow] [3][A]", [
  // RULINGS sweep / CR 355.5: the friendly unit is a target chosen as the spell is played; R-2 (CR 355.4): so is its destination
  spell(ctx => {
    const t = ctx.target(0);
    if (t) ctx.deal(2, t);
    E.moveToChosen(1, 2)(ctx);
  }, { targets: [
    T.upTo(1, enemyUnit('Deal 2 to up to one enemy unit at a battlefield', F.atBattlefield)),
    T.unit(F.friendly, F.youControl, { prompt: 'Move a friendly unit', hint: 'help' }),
    T.destination(F.moveDestFor(1), { prompt: 'Move it to' }),
  ] }),
]);

// Siphoning Strike (Nasus)
card('ven-146-166', "Deal 4 to a unit at a battlefield. If you control 7 or more runes, deal 7 to it instead. When it dies this turn, channel 1 rune exhausted.", [
  spell(ctx => {
    const t = ctx.target(0);
    if (!t) return;
    ctx.deal(ctx.runes().length >= 7 ? 7 : 4, t);
    ctx.delay(SIPHON, { obj: t, epoch: ctx.obj(t).epoch ?? 0 }, 'endOfTurn', 1);
  }, { targets: [unitAtBf('Deal 4 (7 with 7+ runes) to a unit at a battlefield')] }),
]);

// Rebuttal (Mel)
card('ven-152-166', "[Reaction]\nChoose a spell with Energy cost no more than [4]. You may pay [A]. If you do, gain control of it and you may make new choices for it. Otherwise, counter it.", [
  spell(ctx => {
    const t = ctx.target(0);
    if (!t) return;
    if (ctx.mayPay(cost('[A]'), 'Rebuttal: pay [A] to gain control of the spell (otherwise it is countered)?')) gainControlOfSpell(ctx, t);
    else ctx.counter(t);
  }, { targets: [aSpell('Choose a spell with Energy cost no more than [4]', (c, id) => itemEnergy(c, id) <= 4)] }),
]);

// Public Execution (Ambessa)
card('ven-154-166', "Choose a friendly unit. Kill an enemy unit with less Might than it.\n[Flow] [5][A][A]", [
  spell(ctx => {
    const f = ctx.target(0), e = ctx.target(1);
    if (!f || !e) return;
    if (ctx.might(e) < ctx.might(f)) ctx.kill(e);
  }, {
    targets: [
      friendlyUnit('Choose a friendly unit'),
      T.unit(F.enemy, (c, id) => {
        const f = priorPicks(c)[0];
        if (f && c.exists(f)) return c.might(id) < c.might(f);
        return c.friendlyUnits().some(u => c.might(u) > c.might(id));
      }, { prompt: 'Kill an enemy unit with less Might than it', hint: 'harm' }),
    ],
  }),
]);

void statik; void mode;

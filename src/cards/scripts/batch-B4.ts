// Batch B4 card scripts (combat / board / movement). Owned by scripting agent B4.
// Keywords in cards.json `keywords` (Tank, Assault N, Shield N, Deflect, Ganking, Ambush, Hidden, Accelerate,
// Vision, Disarm, Backline, Repeat, Flow, Deploy, Action, Reaction) are engine keywords and need no code.
import {
  card, spell, spellModes, mode, when, onPlay, onPlayToBattlefield, deathknell, onAttack, onDefend, onCombatRole,
  onConquer, onHold, onMove, activated, statik, selfMight, selfKeyword, replacement, wouldDie, selfCostDyn, playRule,
  rule, asPlay, grantable, delayedAbility, E, T, F, C, R, cost, pay, type Ctx, type Filter,
} from '../dsl.ts';
import type { GameEvent, ObjId, PlayerId } from '../../engine/types.ts';
import type { TargetSpec } from '../../engine/abilities.ts';
import { getScript } from '../registry.ts';
import { deflectCost } from '../../engine/targets.ts';
import {
  allLocs, isOpen, openBattlefields, isOccupiedEnemy, notHere, canMoveTo, bfAbilityController,
  aloneAt, oneOnOne, wasInCombat, iWonCombat, bumpMoves, firstOfMoveBatch,
  powerSpentThisTurn, maxEnergySpentOnSpell, ifCanPay, IVERN_TAGS, tagsAmongYourUnits, mightyFromOwnStatic, chooseIgnoringHidden, type Loc,
} from '../helpers/B4.ts';

// ------------------------------------------------------------------------------------------------
// shared bits
// ------------------------------------------------------------------------------------------------

const enemyHere = (o: { prompt?: string; hint?: 'harm' | 'help' } = {}) => T.unit(F.enemy, F.here, { hint: o.hint ?? 'harm', prompt: o.prompt });
const self = (ev: GameEvent, ctx: Ctx) => ev.obj === ctx.self;
const myBf = (ctx: Ctx): number | null => { const l = ctx.loc(ctx.self); return typeof l === 'number' ? l : null; };
const friendlyGearHere = (ctx: Ctx, f: Filter = () => true) => ctx.gear(g => ctx.isFriendly(g) && ctx.isHere(g) && f(ctx, g));
const enemiesHere = (ctx: Ctx, f: (id: ObjId) => boolean = () => true) => ctx.units(u => ctx.isEnemy(u) && ctx.isHere(u) && f(u));
const otherYoursHere = (ctx: Ctx) => { const l = ctx.loc(ctx.self); return l === null ? [] : ctx.unitsAt(l, u => u !== ctx.self && ctx.ctrl(u) === ctx.controller); };

/** "You may play me to <somewhere>": a play rule on the card itself, active while it's in hand. */
const selfDest = (dests: (ctx: Ctx) => Loc[], text: string) =>
  playRule((ctx, id) => id === ctx.self, { extraDestinations: ctx => dests(ctx), activeIn: ['hand'], text });

/** Granted "I can't move this turn" (no mover info from the engine yet: blocks every move; see dsl-requests). */
const CANT_MOVE = grantable('B4:cantMoveThisTurn', rule('cantMove', (ctx, unit: ObjId, _from: unknown, _to: unknown, mover?: PlayerId) =>
  unit === ctx.self && (mover === undefined || mover === ctx.controller), undefined, { text: "Can't move this turn" }));

/** "The next time it would die this turn, heal it, exhaust it, and recall it instead." (data: {obj, epoch}) */
const NEXT_DEATH_RECALL = delayedAbility('B4:nextDeathRecall', replacement('die',
  (ev, ctx) => ev.obj === ctx.data.obj && (ctx.obj(ev.obj as ObjId)?.epoch ?? 0) === ctx.data.epoch,
  (ev, ctx) => { const id = ev.obj as ObjId; ctx.heal(id); ctx.exhaust(id); ctx.recall(id); ctx.data.__consume = true; return null; },
  { text: 'The next time it would die this turn, heal it, exhaust it, and recall it instead' }));
const saveNextDeath = (ctx: Ctx) => { const t = ctx.target(0); if (t) ctx.delay(NEXT_DEATH_RECALL, { obj: t, epoch: ctx.obj(t)?.epoch ?? 0 }, 'endOfTurn'); };

/** Cataclysm: "Opponents can't play spells this turn." */
const OPPONENTS_NO_SPELLS = delayedAbility('B4:opponentsNoSpells', rule('cantPlay', (ctx, card: ObjId, player: PlayerId) =>
  ctx.isOpponent(player) && ctx.type(card) === 'Spell', undefined, { text: "Opponents can't play spells this turn" }));

/** Iascylla: "at the start of your next Main Phase, you may move an enemy unit to this battlefield." (data: {bf}) */
const IASCYLLA_PULL = delayedAbility('B4:iascyllaPull', when('mainStart', (ev, ctx) => ev.player === ctx.controller,
  ctx => { const t = ctx.target(0); if (t) ctx.move(t, ctx.data.bf as number); },
  { targets: [T.upTo(1, T.unit(F.enemy, (c, id) => c.loc(id) !== c.data.bf, { prompt: 'Iascylla: you may move an enemy unit to her battlefield', hint: 'harm' }))], text: 'Iascylla: you may move an enemy unit to this battlefield' }));

// ================================================================================================
// OGN
// ================================================================================================

// Magma Wurm
card('ogn-011-298', 'Other friendly units enter ready.', [
  playRule((ctx, id) => id !== ctx.self && ctx.isUnit(id), { entersReady: true, text: 'Other friendly units enter ready.' }),
]);

// Raging Soul
card('ogn-019-298', "If you've discarded a card this turn, I have [Assault] and [Ganking].", [
  selfKeyword(['Assault', 'Ganking'], { if: ctx => ctx.count(`discard:${ctx.controller}`) > 0 }),
]);

// Draven, Showboat
card('ogn-028-298', 'My Might is increased by your points.', [
  selfMight(ctx => ctx.points()),
]);

// Tryndamere, Barbarian
card('ogn-034-298', 'When I conquer after an attack, if you assigned 5 or more excess damage to enemy units, you score 1 point.', [
  // engine excess record: damage assigned beyond lethal in the combat damage assignment (ctx.excessDamage)
  onConquer(E.points(1), { if: ctx => ctx.isAttacking(ctx.self) && ctx.excessDamage() >= 5, text: 'Score 1 point (5+ excess damage)' }),
]);

// Vayne, Hunter
card('ogn-035-298', "[Assault 3]\nIf an opponent controls a battlefield, I enter ready.\nWhen I conquer, you may pay [1] to return me to my owner's hand.", [
  when('conquer', ifCanPay(cost('[1]'), (ev, ctx) => ev.player === ctx.controller && ((ev.units as ObjId[]) ?? []).includes(ctx.self)),
    E.returnToHand('self'), { optional: "Pay [1] to return Vayne to her owner's hand?", cost: cost('[1]'), text: "Pay [1]: return me to my owner's hand" }),
], { entersReady: ctx => ctx.battlefields().some(b => { const c = ctx.bfController(b); return c !== null && ctx.isOpponent(c); }) });

// Kai'Sa, Survivor
card('ogn-039-298', '[Accelerate]\nWhen I conquer, draw 1.', [
  onConquer(E.draw(1), { text: 'When I conquer, draw 1.' }),
]);

// Charm
card('ogn-043-298', 'Move an enemy unit.', [
  // R-2 (CR 355.4): the destination is chosen as the spell is played
  spell(E.moveToChosen(0, 1), { targets: [T.unit(F.enemy, { hint: 'harm', prompt: 'Charm: choose an enemy unit to move' }), T.destination(F.moveDestFor(0), { prompt: 'Move it to' })] }),
]);

// Rune Prison
card('ogn-050-298', '[Action]\nStun a unit.', [
  spell(E.stun(0), { targets: [T.unit({ hint: 'harm', prompt: 'Stun a unit' })] }),
]);

// Solari Shieldbearer
card('ogn-051-298', 'When you play me, stun a unit.', [
  onPlay(E.stun(0), { targets: [T.unit({ hint: 'harm', prompt: 'Stun a unit' })], text: 'Stun a unit' }),
]);

// Mask of Foresight
card('ogn-060-298', 'When a friendly unit attacks or defends alone, give it +1 [S] this turn.', [
  when(['attack', 'defend'], (ev, ctx) => typeof ev.obj === 'string' && ctx.isFriendly(ev.obj) && ctx.isUnit(ev.obj) && aloneAt(ctx, ev.obj),
    E.might(R.eventObj, 1), { text: 'Give it +1 [S] this turn' }),
]);

// Wizened Elder
card('ogn-065-298', "While I'm buffed, I have an additional +1 [S].", [
  selfMight(1, { if: C.buffed }),
]);

// Ahri, Alluring
card('ogn-066-298', 'When I hold, you score 1 point.', [
  onHold(E.points(1), { text: 'Score 1 point' }),
]);

// Blitzcrank, Impassive
card('ogn-067-298', "[Tank]\nWhen you play me to a battlefield, you may move an enemy unit to here.\nWhen I hold, return me to my owner's hand.", [
  // RJ#8283: "here" is his location on resolution; in base, a unit moved into a base its controller doesn't own goes to its own
  // base (OGN-FAQ, riftlens /rules/move/); gone from the board → nothing
  onPlayToBattlefield(ctx => { const t = ctx.target(0), l = ctx.onBoard(ctx.self) ? ctx.loc(ctx.self) : null; if (t && l !== null) ctx.move(t, l); },
    { targets: [T.upTo(1, T.unit(F.enemy, notHere, { hint: 'harm', prompt: 'You may move an enemy unit to Blitzcrank' }))], text: 'You may move an enemy unit to here' }),
  onHold(E.returnToHand('self'), { text: "Return me to my owner's hand" }),
]);

// Zhonya's Hourglass
card('ogn-077-298', '[Hidden]\nIf a friendly unit would die, kill this instead. Heal that unit, exhaust it, and recall it.', [
  // FUZZ: F.other — when the Hourglass is itself a unit (e.g. made a unit gear by Lady of Clockwork) "kill this
  // instead" re-entered its own replacement forever (stack overflow); it can't replace its own death with itself
  wouldDie(F.and(F.friendly, F.unit, F.other), (ctx, id) => { ctx.kill(ctx.self); ctx.heal(id); ctx.exhaust(id); ctx.recall(id); },
    { text: 'If a friendly unit would die, kill this instead. Heal that unit, exhaust it, and recall it.' }),
]);

// Heimerdinger, Inventor: the [T] abilities of other friendly legends/units/gear are granted to him (registered
// lazily as grantable abilities keyed by card and ability index, so the same key always maps to the same ability).
function heimerGrants(ctx: Ctx): string[] {
  const keys: string[] = [];
  const srcs: ObjId[] = [ctx.legend(ctx.controller), ...ctx.units(), ...ctx.gear()];
  for (const id of srcs) {
    if (!id || id === ctx.self || !ctx.obj(id) || ctx.obj(id).controller !== ctx.controller) continue;
    const s = getScript(ctx.cardIdOf(id));
    s?.abilities.forEach((ab, i) => {
      if (ab.kind !== 'activated' || !ab.cost.exhaustSelf || (ab.section ?? 'rules') !== 'rules') return;
      const key = `B4:heimer:${s.id}:${i}`;
      grantable(key, ab);
      if (!keys.includes(key)) keys.push(key);
    });
  }
  return keys;
}
card('ogn-111-298', 'I have all [T] abilities of all friendly legends, units, and gear.', [
  statik('self', ctx => ({ grants: heimerGrants(ctx) }), { text: 'I have all [T] abilities of all friendly legends, units, and gear.' }),
]);

// Ahri, Inquisitive
card('ogn-119-298', 'When I attack or defend, give an enemy unit here -2 [S] this turn, to a minimum of 1 [S].', [
  onCombatRole(E.mightMin(0, 2, 1), { targets: [enemyHere({ prompt: 'Give an enemy unit here -2 [S] (minimum 1)' })], text: 'Give an enemy unit here -2 [S] this turn, minimum 1' }),
]);

// Bilgewater Bully
card('ogn-125-298', "While I'm buffed, I have [Ganking].", [
  selfKeyword('Ganking', { if: C.buffed }),
]);

// Dune Drake
card('ogn-131-298', 'When I attack, give me +2 [M] this turn if there is a ready enemy unit here.', [
  onAttack(E.when(ctx => enemiesHere(ctx, u => !ctx.isExhausted(u)).length > 0, E.might('self', 2)), { text: '+2 [S] if there is a ready enemy unit here' }),
]);

// Stormclaw Ursine
card('ogn-137-298', '[Tank]\nWhen you play me, channel 1 rune exhausted.', [
  onPlay(E.channel(1, true), { text: 'Channel 1 rune exhausted' }),
]);

// Qiyana, Victorious
card('ogn-155-298', '[Deflect]\nWhen I conquer, draw 1 or channel 1 rune exhausted.', [
  onConquer(E.chooseOne([{ label: 'Draw 1', effect: E.draw(1) }, { label: 'Channel 1 rune exhausted', effect: E.channel(1, true) }]), { text: 'Draw 1 or channel 1 rune exhausted' }),
]);

// Volibear, Imposing: one trigger per opponent move (a group of units moved together counts once)
card('ogn-158-298', '[Shield 3]\n[Tank]\nWhen an opponent moves to a battlefield other than mine, draw 1.', [
  // RJ#8279 / #2574 (DECISIONS, house): "other than mine" needs him at a battlefield — in base he doesn't draw
  when('move', (ev, ctx) => typeof ev.to === 'number' && typeof ctx.loc(ctx.self) === 'number' && ev.to !== ctx.loc(ctx.self) && typeof ev.player === 'number'
    && ctx.isOpponent(ev.player as PlayerId) && !!ctx.obj(ev.obj as ObjId) && ctx.ctrl(ev.obj as ObjId) === ev.player && firstOfMoveBatch(ctx, ev),
  E.draw(1), { text: 'An opponent moved to a battlefield other than mine: draw 1' }),
]);

// Warwick, Hunter
card('ogn-159-298', 'I enter ready.\nWhen I attack, kill all damaged enemy units here.', [
  onAttack(ctx => { ctx.kill(enemiesHere(ctx, u => ctx.damage(u) > 0)); }, { text: 'Kill all damaged enemy units here' }),
], { entersReady: true });

// Deadbloom Predator
card('ogn-161-298', '[Deflect]\nYou may play me to an occupied enemy battlefield.', [
  selfDest(ctx => ctx.battlefields().filter(b => isOccupiedEnemy(ctx, b)), 'You may play me to an occupied enemy battlefield.'),
]);

// Miss Fortune, Captain: "something" = any exhausted unit, gear, rune or legend other than her
const somethingElseExhausted: TargetSpec = {
  kind: 'any', zones: ['board', 'runes', 'legends'], min: 0, max: 1, hint: 'help', prompt: 'You may ready something else that is exhausted',
  filter: (c, id) => id !== c.self && c.isExhausted(id),
};
card('ogn-162-298', "[Accelerate]\n[Ganking]\nThe first time I move each turn, you may ready something else that's exhausted.", [
  when('move', (ev, ctx) => ev.obj === ctx.self && bumpMoves(ctx, 'mfCaptain', ctx.self) === 1, E.ready(0),
    { targets: [somethingElseExhausted], text: 'First move this turn: you may ready something else' }),
]);

// Fight or Flight
card('ogn-168-298', '[Hidden]\n[Action]\nMove a unit from a battlefield to its base.', [
  spell(E.move(0, 'base'), { targets: [T.unit(F.atBattlefield, { prompt: 'Move a unit from a battlefield to its base' })] }),
]);

// Sai Scout
card('ogn-174-298', '[Vision]\nYou may play me to an open battlefield.', [
  selfDest(openBattlefields, 'You may play me to an open battlefield.'),
]);

// Sneaky Deckhand
card('ogn-176-298', 'You may play me to an open battlefield.', [
  selfDest(openBattlefields, 'You may play me to an open battlefield.'),
]);

// Stealthy Pursuer
card('ogn-177-298', 'When a friendly unit moves from my location, I may be moved with it.', [
  when('move', (ev, ctx) => {
    const u = ev.obj as ObjId;
    if (u === ctx.self || !ctx.obj(u) || !ctx.isFriendly(u) || !ctx.isUnit(u)) return false;
    const mine = ctx.loc(ctx.self);
    return mine !== null && ev.from === mine && (mine !== 'base' || ctx.ctrl(u) === ctx.controller);
  }, ctx => {
    // "with it" = the friend's location on resolution; friend gone from the board → no move (house, DECISIONS #2839/#8377, principle 17)
    const u = ctx.event!.obj as ObjId;
    if (!ctx.onBoard(u)) return;
    const to = ctx.loc(u) as Loc;
    if (to !== null && ctx.onBoard(ctx.self) && ctx.loc(ctx.self) !== to) ctx.move(ctx.self, to);
  },
  { optional: 'Move Stealthy Pursuer with it?', text: 'I may be moved with it' }),
]);

// Traveling Merchant
card('ogn-185-298', 'When I move, discard 1, then draw 1.', [
  onMove(E.seq(E.discard(1), E.draw(1)), { text: 'Discard 1, then draw 1' }),
]);

// Maddened Marauder
card('ogn-191-298', '[Tank]\nWhen you play me, move a unit from a battlefield to its base.', [
  onPlay(E.move(0, 'base'), { targets: [T.unit(F.atBattlefield, { prompt: 'Move a unit from a battlefield to its base' })], text: 'Move a unit from a battlefield to its base' }),
]);

// Miss Fortune, Buccaneer
card('ogn-193-298', 'You may play me to an open battlefield.\nFriendly units may be played to open battlefields.', [
  selfDest(openBattlefields, 'You may play me to an open battlefield.'),
  playRule((ctx, id) => ctx.isUnit(id), { extraDestinations: ctx => openBattlefields(ctx), text: 'Friendly units may be played to open battlefields.' }),
]);

// Tideturner
const tideturnerSpec = T.upTo(1, T.unit(F.youControl, F.other, notHere, { prompt: 'You may choose a unit you control at another location to swap with', hint: 'neutral', anyLocation: true }));
card('ogn-199-298', '[Hidden]\nWhen you play me, you may choose a unit you control at another location. Move me to its location and it to my original location.', [
  onPlay(ctx => {
    // CR 811.1.d.3 (Tideturner example): its "at another location" can never be met here, so the target is chosen freely
    // (anyLocation) as the trigger goes on the chain; the fallback only covers items made without that choice.
    const t = ctx.target(0) ?? (ctx.data.hiddenHere !== undefined ? chooseIgnoringHidden(ctx, tideturnerSpec)[0] : undefined);
    if (t && ctx.onBoard(ctx.self)) ctx.swapLocations(ctx.self, t);
  }, { targets: [tideturnerSpec], mayChoose: true, text: 'Swap locations with a unit you control' }),
]);

// Yasuo, Windrider
card('ogn-205-298', '[Ganking]\nThe third time I move in a turn, you score 1 point.', [
  when('move', (ev, ctx) => ev.obj === ctx.self && bumpMoves(ctx, 'yasuo', ctx.self) === 3, E.points(1), { text: 'Third move this turn: score 1 point' }),
]);

// Fiora, Victorious
card('ogn-232-298', "While I'm [Mighty], I have [Deflect], [Ganking], and [Shield].", [
  selfKeyword(['Deflect', 'Ganking', 'Shield'], { if: ctx => mightyFromOwnStatic(ctx) }),
]);

// Leona, Determined
card('ogn-238-298', '[Shield]\nWhen I attack, stun an enemy unit here.', [
  onAttack(E.stun(0), { targets: [enemyHere({ prompt: 'Stun an enemy unit here' })], text: 'Stun an enemy unit here' }),
]);

// Sett, Kingpin
card('ogn-240-298', '[Tank]\nI get +1 [S] for each buffed friendly unit at my battlefield.', [
  selfMight(ctx => { const l = myBf(ctx); return l === null ? 0 : ctx.unitsAt(l, u => ctx.isFriendly(u) && ctx.isBuffed(u)).length; }),
]);

// Zenith Blade, Leona
card('ogn-262-298', "[Action]\nStun an enemy unit at a battlefield. You may move a friendly unit to that enemy unit's battlefield.", [
  spell(ctx => {
    const t = ctx.target(0);
    if (!t) return;
    ctx.stun(t);
    const f = ctx.target(1), l = ctx.loc(t);
    // RJ#5998b (DECISIONS #5998 full reading, principle 4): the friendly unit was chosen when played; "you may" is decided now.
    // A unit already at that battlefield just stays (no question, no move).
    if (f && typeof l === 'number' && ctx.loc(f) !== l && ctx.may(`Zenith Blade: move ${ctx.name(f)} to ${ctx.name(ctx.bfCard(l))}?`)) ctx.move(f, l);
  }, {
    // RJ#5998 (CR 355.13; cf. OGN-ERR Salvage "You may kill a gear" → "up to one gear"): "you may" isn't "up to" — the friendly unit
    // is a required choice, so a friendly unit is needed to play it
    playIf: ctx => ctx.friendlyUnits().length > 0,
    targets: [T.unit(F.enemy, F.atBattlefield, { hint: 'harm', prompt: 'Stun an enemy unit at a battlefield' }), T.unit(F.friendly, { prompt: "Choose a friendly unit (you may move it to that enemy unit's battlefield on resolution)", hint: 'neutral' })],
  }),
]);

// Reaver's Row (battlefield)
card('ogn-285-298', 'When you defend here, you may move a friendly unit here to base.', [
  // CR 190.6 ("you" = the battlefield's controller), 403.2 / RJ#2678: the unit is chosen as the trigger goes on the chain
  when('playerDefend', (ev, ctx) => ev.bf === ctx.bfIndex() && ctx.g.battlefields[ctx.bfIndex()]?.controller === ev.player && ev.player === bfAbilityController(ctx), ctx => {
    const u = ctx.target(0);
    if (u && ctx.loc(u) === ctx.bfIndex()) ctx.move(u, 'base');
  }, { targets: [T.upTo(1, T.unit(F.friendly, F.here, { prompt: "Reaver's Row: you may move a friendly unit here to base", hint: 'help' }))], text: 'You may move a friendly unit here to base' }),
]);

// ================================================================================================
// OGS
// ================================================================================================

// Master Yi, Meditative
card('ogs-004-024', 'While you have 8+ runes, I have +4 [S].', [
  selfMight(4, { if: ctx => ctx.runes().length >= 8 }),
]);

// Master Yi, Honed
card('ogs-009-024', '[Ganking]\nI enter ready.', [], { entersReady: true });

// Flash
card('ogs-011-024', '[Reaction]\nMove up to 2 friendly units to base.', [
  // RJ#1127 (DECISIONS #1127, principle 25): units already in base are valid choices (CR 355.9); they just don't move (CR 355.4.a
  // restricts only a chosen destination) — "when chosen" effects (Jae Medarda) still apply
  spell(E.move(0, 'base'), { targets: [T.upTo(2, T.unit(F.friendly, { prompt: 'Move up to 2 friendly units to base', hint: 'help' }))] }),
]);

// Vanguard Attendant
card('ogs-016-024', 'I enter ready.', [], { entersReady: true });

// Highlander, Yi
card('ogs-020-024', '[Reaction]\nChoose a friendly unit. The next time it would die this turn, heal it, exhaust it, and recall it instead.', [
  spell(saveNextDeath, { targets: [T.unit(F.friendly, { hint: 'help', prompt: 'Choose a friendly unit' })] }),
]);

// ================================================================================================
// RAD
// ================================================================================================

// Entrenched Boar: the choice is made as it's played; entering ready grants it "can't move this turn"
card('rad-026-167', "You may have me enter ready. If you do, I can't move this turn.", [
  asPlay(ctx => { ctx.data.boarReady = ctx.may("Have Entrenched Boar enter ready? (It can't move this turn.)"); }, { text: 'You may have me enter ready' }),
], { entersReady: ctx => { if (!ctx.data.boarReady) return false; ctx.grant(ctx.self, CANT_MOVE, 'endOfTurn'); return true; } });

// Stoic Ferryman
card('rad-031-167', '[Shield 3]\nWhen you play me to a battlefield, you may move another unit you control here to your base.', [
  onPlayToBattlefield(E.move(0, 'base'), { targets: [T.upTo(1, T.unit(F.youControl, F.other, F.here, { prompt: 'You may move another unit you control here to your base', hint: 'help' }))], text: 'You may move another unit you control here to your base' }),
]);

// Orianna, Exquisite
card('rad-042-167', "[Shield]\nI don't deal combat damage unless there's a friendly gear here.", [
  rule('noCombatDamage', (ctx, unit: ObjId) => unit === ctx.self && friendlyGearHere(ctx).length === 0),
]);

// K'Sante, Dauntless
card('rad-045-167', '[Shield]\nWhen I attack or defend, double the [Shield] of a unit you control here this turn.', [
  onCombatRole(ctx => { const t = ctx.target(0); if (!t) return; const n = ctx.kw(t, 'Shield'); if (n > 0) ctx.giveKeyword(t, `Shield ${n}`, 'endOfTurn'); },
    { targets: [T.unit(F.youControl, F.here, { prompt: 'Double the [Shield] of a unit you control here', hint: 'help' })], text: 'Double the [Shield] of a unit you control here' }),
]);

// Overloaded Traveler
card('rad-072-167', "While there's a friendly gear with [Deploy] at my battlefield, I have +1 [S].", [
  selfMight(1, { if: ctx => myBf(ctx) !== null && friendlyGearHere(ctx, (c, g) => c.has(g, 'Deploy')).length > 0 }),
]);

// Sneaky Zeebles
card('rad-076-167', 'When I conquer, [Add] [A].', [
  onConquer(E.add(0, ['any']), { isAdd: true, text: 'Add [A]' }),
]);

// Wrath of the Freljord
card('rad-077-167', 'I enter ready.\n[Shield 3]', [], { entersReady: true });

// Cataclysm
card('rad-084-167', "Opponents can't play spells this turn.\nMove a friendly unit to an occupied enemy battlefield.", [
  spell(ctx => {
    ctx.delay(OPPONENTS_NO_SPELLS, {}, 'endOfTurn');
    E.moveToChosen(0, 1)(ctx);
  }, { targets: [T.unit(F.friendly, { prompt: 'Move a friendly unit to an occupied enemy battlefield', hint: 'neutral' }),
    T.destination(F.moveDestFor(0), F.dest((c, l) => typeof l === 'number' && isOccupiedEnemy(c, l)), { prompt: 'Move it to an occupied enemy battlefield' })] }),   // R-2
]);

// Graves, Blasting Through
card('rad-085-167', "When I attack or defend, deal damage equal to my Might to all enemy units here.\nI don't deal combat damage.", [
  onCombatRole(ctx => { ctx.deal(ctx.might(ctx.self), enemiesHere(ctx)); }, { text: 'Deal damage equal to my Might to all enemy units here' }),
  rule('noCombatDamage', (ctx, unit: ObjId) => unit === ctx.self),
]);

// K'Sante, Courageous
card('rad-086-167', '[Accelerate]\n[Shield 2]\nWhen I hold, channel 1 rune.', [
  onHold(E.channel(1), { text: 'Channel 1 rune' }),
]);

// Jarvan IV, Martial Paragon
card('rad-091-167', 'Your gear with [Deploy] have [Action].\nWhen I conquer, if there is a friendly gear with [Deploy] here, channel 1 rune exhausted.', [
  playRule((ctx, id) => ctx.isGear(id) && ctx.has(id, 'Deploy'), { grantsTiming: 'action', text: 'Your gear with [Deploy] have [Action].' }),
  onConquer(E.channel(1, true), { if: ctx => friendlyGearHere(ctx, (c, g) => c.has(g, 'Deploy')).length > 0, text: 'Channel 1 rune exhausted' }),
]);

// Siren's Song
card('rad-098-167', '[Reaction]\nMove an enemy unit that moved this turn.', [
  spell(E.moveToChosen(0, 1), { targets: [T.unit(F.enemy, (c, id) => !!c.obj(id).movedThisTurn, { hint: 'harm', prompt: 'Move an enemy unit that moved this turn' }), T.destination(F.moveDestFor(0), { prompt: 'Move it to' })] }),   // R-2
]);

// Demon Shade
card('rad-102-167', '[Hidden]\nChoose a friendly unit, then choose one —\n- Move it to an open battlefield.\n- Give it [Ganking] this turn if there are no open battlefields.', [
  spellModes([
    mode('move', 'Move it to an open battlefield', E.moveToChosen(0, 1),
      [T.unit(F.friendly, { prompt: 'Choose a friendly unit', hint: 'help' }), T.destination(F.moveDestFor(0), F.dest((c, l) => typeof l === 'number' && isOpen(c, l)), { prompt: 'Move it to an open battlefield' })]),   // R-2
    mode('gank', 'Give it [Ganking] this turn if there are no open battlefields', ctx => { const t = ctx.target(0); if (t && openBattlefields(ctx).length === 0) ctx.giveKeyword(t, 'Ganking'); },
      [T.unit(F.friendly, { prompt: 'Choose a friendly unit', hint: 'help' })]),
  ]),
]);

// Evelynn, In Control
card('rad-109-167', '[Disarm]\nWhen I hold, if you control a facedown card here, score 1 point.', [
  onHold(E.points(1), { if: ctx => { const l = myBf(ctx); if (l === null) return false; const fd = ctx.facedownAt(l); return !!fd && ctx.ctrl(fd) === ctx.controller; }, text: 'Score 1 point (facedown card here)' }),
]);

// Angler Wyrm: the chosen opponent picks one of their units that can legally move (RAD FAQ #15) and moves it
card('rad-113-167', '[Deflect]\n[T]: Choose an opponent. They must move a unit they control to my battlefield.', [
  activated('[T]', ctx => {
    const l = myBf(ctx);
    if (l === null) return;
    const opp = ctx.chooseOpponent();
    const them = ctx.as(opp);
    const cands = them.units(u => them.ctrl(u) === opp && canMoveTo(them, u, l));
    const u = them.chooseCards(cands, 1, 1, `Angler Wyrm: move a unit you control to ${ctx.name(ctx.bfCard(l))}`)[0];
    if (u) them.move(u, l);
  }, { text: 'Choose an opponent. They must move a unit they control to my battlefield.' }),
]);

// Steadfast Outrider
card('rad-128-167', '[Tank]\nWhile there are 2 or more other friendly units and/or gear at my battlefield, I have +2 [S].', [
  selfMight(2, { if: ctx => { const l = myBf(ctx); if (l === null) return false; return ctx.unitsAt(l, u => u !== ctx.self && ctx.isFriendly(u)).length + friendlyGearHere(ctx).length >= 2; } }),
]);

// Jarvan IV, Royal Heir
card('rad-133-167', '[Assault]\n[Tank]\nWhen I attack, you may move a unit you control to my battlefield.', [
  onAttack(ctx => { const t = ctx.target(0), l = myBf(ctx); if (t && l !== null) ctx.move(t, l); },
    { targets: [T.upTo(1, T.unit(F.youControl, F.other, notHere, { prompt: 'You may move a unit you control to my battlefield', hint: 'neutral' }))], text: 'You may move a unit you control to my battlefield' }),
]);

// Demacian Standard (Deploy gear)
card('rad-156-167', "[Deploy]\nWhen one or more friendly units attack here, give one of them +2 [S] this turn.\nWhen you hold here, you may return this to its owner's hand.", [
  // each time one or more friendly units gain the Attacker designation here, also later in the combat (RJ#12994, ENGINE-9)
  when('unitsAttack', (ev, ctx) => ev.player === ctx.controller && ev.bf === myBf(ctx), E.might(0, 2),
    { targets: [T.unit(F.friendly, F.attacking, F.here, { prompt: 'Give one of the attacking units +2 [S]', hint: 'help' })], text: 'Give one of them +2 [S] this turn' }),
  when('hold', (ev, ctx) => ev.player === ctx.controller && ev.bf === myBf(ctx), E.returnToHand('self'),
    { optional: "Return Demacian Standard to its owner's hand?", text: "You may return this to its owner's hand" }),
]);

// ================================================================================================
// SFD
// ================================================================================================

// Eager Drakehound
card('sfd-006-221', 'I enter ready.', [], { entersReady: true });

// Perched Grimwyrm (a hand-zone restriction: see dsl-requests B4 #1)
const conqueredThisTurn = (ctx: Ctx, p: PlayerId, bf: number) => ((ctx.g.ex.turnFacts[`conquered:${p}`] as number[] | undefined) ?? []).includes(bf);
card('sfd-015-221', 'Play me only to a battlefield you conquered this turn.', [
  rule('cantPlay', (ctx, cardObj: ObjId, player: PlayerId, dest: Loc | null) => cardObj === ctx.self && !(typeof dest === 'number' && conqueredThisTurn(ctx, player, dest)),
    undefined, { activeIn: ['hand'], text: 'Play me only to a battlefield you conquered this turn.' }),
]);

// Rengar, Pouncing
card('sfd-025-221', "[Reaction]\n[Assault 2]\nI can be played to a battlefield you're attacking.", [
  selfDest(ctx => { const sd = ctx.g.showdown; return sd?.isCombat && sd.attacker === ctx.controller ? [sd.battlefieldIndex] : []; }, "I can be played to a battlefield you're attacking."),
]);

// Dunebreaker
card('sfd-027-221', 'If you have two or fewer cards in your hand, I enter ready.\nWhen I hold, draw 2.', [
  onHold(E.draw(2), { text: 'Draw 2' }),
], { entersReady: ctx => ctx.hand().length <= 2 });

// Lucian, Gunslinger
card('sfd-028-221', '[Assault]\nWhen I attack, deal damage equal to my [Assault] to an enemy unit here.', [
  onAttack(ctx => { const t = ctx.target(0); if (t) ctx.deal(ctx.kw(ctx.self, 'Assault'), t); },
    { targets: [enemyHere({ prompt: 'Deal damage equal to my [Assault] to an enemy unit here' })], text: 'Deal damage equal to my [Assault] to an enemy unit here' }),
]);

// Emperor's Divide
card('sfd-043-221', '[Hidden]\n[Action]\nMove any number of friendly units at a battlefield to their base.', [
  spell(E.move(0, 'base'), { targets: [T.anyNumber(T.unit(F.friendly, F.atBattlefield, { sameLocation: true, prompt: 'Move any number of friendly units at one battlefield to their base', hint: 'help' }))] }),
]);

// Stellacorn Herder
card('sfd-048-221', 'When I move, draw 1.', [
  onMove(E.draw(1), { text: 'Draw 1' }),
]);

// Janna, Savior
card('sfd-053-221', '[Reaction]\nWhen you play me, heal your units here, then move up to one enemy unit from here to its base.', [
  onPlay(ctx => {
    const l = ctx.loc(ctx.self);
    if (l !== null) ctx.heal(ctx.unitsAt(l, u => ctx.ctrl(u) === ctx.controller));
    const t = ctx.target(0);
    if (t) ctx.move(t, 'base');
  }, { targets: [T.upTo(1, T.unit(F.enemy, F.here, F.atBattlefield, { prompt: 'Move up to one enemy unit from here to its base', hint: 'harm' }))], text: 'Heal your units here, then move up to one enemy unit from here to its base' }),
]);

// Ezreal, Dashing
card('sfd-082-221', "When I attack or defend, deal damage equal to my Might to an enemy unit here.\nI don't deal combat damage.\n[C]: [Action] — Move me to your base.", [
  onCombatRole(ctx => { const t = ctx.target(0); if (t) ctx.deal(ctx.might(ctx.self), t); },
    { targets: [enemyHere({ prompt: 'Deal damage equal to my Might to an enemy unit here' })], text: 'Deal damage equal to my Might to an enemy unit here' }),
  rule('noCombatDamage', (ctx, unit: ObjId) => unit === ctx.self),
  activated('[C]', ctx => { if (ctx.onBoard(ctx.self)) ctx.move(ctx.self, 'base'); }, { timing: 'action', text: 'Move me to your base' }),
]);

// Dauntless Vanguard
card('sfd-093-221', 'You may play me to an occupied enemy battlefield.', [
  selfDest(ctx => ctx.battlefields().filter(b => isOccupiedEnemy(ctx, b)), 'You may play me to an occupied enemy battlefield.'),
]);

// Direwing
card('sfd-094-221', 'I enter ready if you control another Dragon.', [], {
  entersReady: ctx => [...ctx.units(), ...ctx.gear()].some(id => id !== ctx.self && ctx.ctrl(id) === ctx.controller && ctx.hasTag(id, 'Dragon')),
});

// Fiora, Peerless
card('sfd-110-221', 'When I attack or defend one on one, double my Might this combat.', [
  when(['attack', 'defend'], (ev, ctx) => ev.obj === ctx.self && oneOnOne(ctx, ctx.self), ctx => { if (ctx.onBoard(ctx.self)) ctx.doubleMight(ctx.self, 'endOfCombat'); },
    { text: 'One on one: double my Might this combat' }),
]);

// Corrupt Enforcer
card('sfd-123-221', 'When I move to a battlefield, discard 1.\nWhen I win a combat, draw 1.', [
  onMove(E.discard(1), { toBattlefield: true, text: 'Discard 1' }),
  when('combatResult', iWonCombat, E.draw(1), { text: 'Won a combat: draw 1' }),
]);

// Fae Porter
card('sfd-125-221', 'When I move to a battlefield, you may pay [C] to move a unit you control to the same battlefield.', [
  when('move', ifCanPay(cost('[C]'), (ev, ctx) => ev.obj === ctx.self && typeof ev.to === 'number'),
    ctx => { const t = ctx.target(0); if (t) ctx.move(t, ctx.event!.to as number); },
    { optional: 'Pay [C] to move a unit you control to the same battlefield?', cost: cost('[C]'),
      targets: [T.unit(F.youControl, F.other, (c, id) => c.loc(id) !== c.event?.to, { prompt: 'Move a unit you control to the same battlefield', hint: 'neutral' })], text: 'Pay [C]: move a unit you control here' }),
]);

// Loyal Pup
card('sfd-126-221', 'When you defend at a battlefield, you may move me there.', [
  when('playerDefend', (ev, ctx) => ev.player === ctx.controller && typeof ev.bf === 'number' && ctx.loc(ctx.self) !== ev.bf,
    ctx => { if (ctx.onBoard(ctx.self)) ctx.move(ctx.self, ctx.event!.bf as number); }, { optional: 'Move Loyal Pup to the defended battlefield?', text: 'You may move me there' }),
]);

// Overzealous Fan
card('sfd-128-221', 'When I defend, you may kill me to move an attacking unit to its base.', [
  onDefend(E.move(0, 'base'), { optional: 'Kill Overzealous Fan to move an attacking unit to its base?', cost: cost('', pay.killSelf()),
    targets: [T.unit(F.attacking, { prompt: 'Move an attacking unit to its base', hint: 'harm' })], text: 'Kill me: move an attacking unit to its base' }),
]);

// Temptation
card('sfd-129-221', "[Repeat] [2]\nMove an enemy unit to a location where there's a unit with the same controller.", [
  spell(ctx => {
    E.moveToChosen(0, 1)(ctx);
  }, { targets: [T.unit(F.enemy, { hint: 'harm', prompt: 'Move an enemy unit' }),
    T.destination(F.moveDestFor(0), F.dest((c, l) => { const t = c.target(0); if (!t) return false; const k = c.ctrl(t); return c.unitsAt(l, u => u !== t && c.ctrl(u) === k, k).length > 0; }),
      { prompt: 'Move it to a location with another unit it shares a controller with' })] }),   // R-2
]);

// Ancient Warmonger
card('sfd-131-221', '[Accelerate]\nI have [Assault] equal to the number of enemy units here.', [
  statik('self', ctx => { const n = enemiesHere(ctx).length; return n > 0 ? { keywords: [`Assault ${n}`] } : {}; }),
]);

// Sivir, Mercenary
card('sfd-143-221', "[Accelerate]\nIf you've spent at least [A][A] this turn, I have +2 [S] and [Ganking].", [
  statik('self', { might: 2, keywords: ['Ganking'] }, { if: ctx => powerSpentThisTurn(ctx) >= 2 }),
]);

// Draven, Audacious
card('sfd-148-221', '[Deflect]\nThe first time I win a combat each turn, you score 1 point.\nWhen I die in combat, choose an opponent. They score 1 point.', [
  when('combatResult', iWonCombat, E.points(1), { oncePerTurn: 1, text: 'First combat won this turn: score 1 point' }),
  when('die', (ev, ctx) => ev.obj === ctx.self && !!(ev.lki as { combatRole?: string } | undefined)?.combatRole,
    ctx => { ctx.scorePoint(ctx.chooseOpponent('Draven died in combat: choose an opponent to score 1 point'), 1); }, { text: 'Died in combat: an opponent scores 1 point' }),
]);

// Soraka, Wanderer ("I must be assigned combat damage last" = Backline, CR 826)
card('sfd-173-221', 'I must be assigned combat damage last.\nIf another unit you control here would die, if it has less Might than me, instead heal it, exhaust it, and recall it.', [
  selfKeyword('Backline'),
  wouldDie(F.and(F.unit, F.youControl, F.other, F.here, (c, id) => c.might(id) < c.might(c.self)), (ctx, id) => { ctx.heal(id); ctx.exhaust(id); ctx.recall(id); },
    { text: 'Heal it, exhaust it, and recall it instead' }),
]);

// Azir, Sovereign
card('sfd-177-221', '[Accelerate]\nWhen I attack, you may move any number of your token units to this battlefield.', [
  onAttack(ctx => { const l = myBf(ctx); if (l !== null) ctx.move(ctx.targetsOf(0), l); },
    // META-AUDIT: hint 'help' (was 'neutral'): with a neutral hint the bots answered "any number" with the minimum, none,
    // so Azir never brought his Sand Soldiers into the attack
    { targets: [T.anyNumber(T.unit(F.youControl, F.token, notHere, { prompt: 'Move any number of your token units to this battlefield', hint: 'help' }))], text: 'Move any number of your token units here' }),
]);

// ================================================================================================
// UNL
// ================================================================================================

// Prepared Neophyte
card('unl-004-219', "If you've spent [4] or more to play a spell this turn, I have +4 [S].", [
  selfMight(4, { if: ctx => maxEnergySpentOnSpell(ctx) >= 4 }),
]);

// Towering Pairofant
card('unl-008-219', '[Assault]\nIf a unit died this turn, I enter ready.', [], {
  entersReady: ctx => ctx.g.players.some(p => ctx.count(`unitsDied:${p.id}`) > 0),
});

// Grim Apothecary
card('unl-021-219', "[Ambush]\nWhen you play me, you may return a friendly unit at a battlefield to its owner's hand.", [
  onPlay(E.returnToHand(0), { targets: [T.upTo(1, T.unit(F.friendly, F.atBattlefield, { prompt: "You may return a friendly unit at a battlefield to its owner's hand", hint: 'neutral' }))], text: 'You may return a friendly unit at a battlefield to hand' }),
]);

// Jhin, Murderous Artist
card('unl-022-219', '[Deflect]\n[Ganking]\nWhen I move, [Add] [1][A].', [
  onMove(E.add(1, ['any']), { isAdd: true, text: 'Add [1][A]' }),
]);

// Shadow Watcher (engine counter unitsDiedBeginning:<p>, dsl-requests B4 #4)
card('unl-037-219', 'If a friendly unit died during your Beginning Phase this turn, I enter ready.', [], {
  entersReady: ctx => ctx.count(`unitsDiedBeginning:${ctx.controller}`) > 0,
});

// Iascylla
card('unl-050-219', 'When I hold, at the start of your next Main Phase, you may move an enemy unit to this battlefield.', [
  onHold(ctx => { const l = myBf(ctx); if (l !== null) ctx.delay(IASCYLLA_PULL, { bf: l }, 'never', 1); }, { text: 'At the start of your next Main Phase, you may move an enemy unit here' }),
]);

// Tricksy Tentacles: the units are chosen as the spell is played, one at a time (each pick must keep the same
// controller and a total Might of 8 or less); Deflect of the chosen enemies is added to the cost.
card('unl-054-219', 'Move any number of enemy units with the same controller and a total Might of 8 or less to a single location.', [
  asPlay(ctx => {
    const picked: ObjId[] = [];
    let total = 0;
    let owner: PlayerId | null = null;
    for (;;) {
      const ok = (c: Ctx, id: ObjId) => c.isEnemy(id) && !picked.includes(id) && (owner === null || c.ctrl(id) === owner) && total + c.might(id) <= 8;
      const pick = ctx.choose(T.upTo(1, T.unit(ok, { prompt: `Choose an enemy unit to move (total Might ${total}/8), or none to stop`, hint: 'harm' })));
      if (!pick.length) break;
      picked.push(pick[0]); total += ctx.might(pick[0]); owner = ctx.ctrl(pick[0]);
    }
    ctx.data.tentacles = picked.map(id => [id, ctx.obj(id).epoch ?? 0]);
    // R-2 (CR 355.4): the single destination is chosen as the spell is played
    if (picked.length) {
      const locs = allLocs(ctx).filter(l => picked.some(u => ctx.validMoveDest(u, l)));
      if (locs.length) ctx.data.tentaclesDest = ctx.chooseLocation(locs, 'Move them to a single location');
    }
    const defl = deflectCost(ctx.g, ctx.controller, picked);
    if (defl > 0) ctx.addPlayCost({ power: new Array(defl).fill('A') });
  }, { text: 'Choose enemy units with the same controller and total Might 8 or less' }),
  spell(ctx => {
    const ids = ((ctx.data.tentacles as [ObjId, number][] | undefined) ?? [])
      .filter(([id, ep]) => ctx.onBoard(id) && (ctx.obj(id).epoch ?? 0) === ep && ctx.isEnemy(id)).map(([id]) => id);
    const dest = ctx.data.tentaclesDest as Loc | undefined;
    if (!ids.length || dest === undefined) return;
    const movers = ids.filter(u => ctx.canMoveTo(u, dest));
    if (movers.length) ctx.move(movers, dest);
  }),
]);

// Vex, Mocking
card('unl-055-219', '[Shield]\n[Tank]\nWhen you [Stun] an enemy unit at a battlefield, you may move me to that battlefield.', [
  when('stun', (ev, ctx) => ev.player === ctx.controller && typeof ev.obj === 'string' && ctx.isEnemy(ev.obj) && typeof ctx.loc(ev.obj) === 'number' && ctx.loc(ev.obj) !== ctx.loc(ctx.self),
    ctx => { const l = ctx.loc(ctx.event!.obj as ObjId); if (typeof l === 'number' && ctx.onBoard(ctx.self)) ctx.move(ctx.self, l); },
    { optional: 'Move Vex to the stunned unit’s battlefield?', text: 'You may move me to that battlefield' }),
]);

// Vilemaw
card('unl-060-219', "[Ambush]\nEnemy units here with less Might than me don't deal combat damage.\nWhen I hold, draw 1.", [
  rule('noCombatDamage', (ctx, unit: ObjId) => ctx.isEnemy(unit) && ctx.isHere(unit) && ctx.might(unit) < ctx.might(ctx.self)),
  onHold(E.draw(1), { text: 'Draw 1' }),
]);

// Icevale Archer
card('unl-065-219', 'When I attack, you may pay [1] to give a unit here -1 [S] this turn.', [
  when('attack', ifCanPay(cost('[1]'), self), E.might(0, -1), { optional: 'Pay [1] to give a unit here -1 [S] this turn?', cost: cost('[1]'),
    targets: [T.unit(F.here, { prompt: 'Give a unit here -1 [S] this turn', hint: 'harm' })], text: 'Pay [1]: a unit here gets -1 [S]' }),
]);

// Chakram Dancer
card('unl-071-219', '[Ambush]\nWhen you play me, give your other units here [Shield] this turn.', [
  onPlay(ctx => { ctx.giveKeyword(otherYoursHere(ctx), 'Shield'); }, { text: 'Give your other units here [Shield] this turn' }),
]);

// Petal Pixie
card('unl-076-219', 'I have +1 [S] for each of your units with [Temporary] at my battlefield.', [
  selfMight(ctx => { const l = myBf(ctx); return l === null ? 0 : ctx.unitsAt(l, u => ctx.ctrl(u) === ctx.controller && ctx.has(u, 'Temporary')).length; }),
]);

// Call to Battle
card('unl-101-219', 'Move a unit you control to a battlefield you control. Then, choose an opponent. They move a unit they control to the same battlefield.', [
  spell(ctx => {
    const t = ctx.target(0), d = ctx.destination(1);
    if (!t || typeof d !== 'number') return;
    if (ctx.canMoveTo(t, d)) ctx.move(t, d);
    const opp = ctx.chooseOpponent();
    const them = ctx.as(opp);
    const u = them.chooseCards(them.units(x => them.ctrl(x) === opp && canMoveTo(them, x, d)), 1, 1, `Call to Battle: move a unit you control to ${ctx.name(ctx.bfCard(d))}`)[0];
    if (u) them.move(u, d);
  }, { targets: [T.unit(F.youControl, { prompt: 'Move a unit you control to a battlefield you control', hint: 'neutral' }),
    T.destination(F.moveDestFor(0), F.dest((c, l) => typeof l === 'number' && c.controls(l)), { prompt: 'Move it to a battlefield you control' })] }),   // R-2
]);

// Imposing Challenger
card('unl-105-219', 'When I move, you may move an enemy unit here with less Might than me to a different battlefield.', [
  onMove(E.moveToChosen(0, 1),
    { targets: [T.upTo(1, T.unit(F.enemy, F.here, (c, id) => c.might(id) < c.might(c.self), { prompt: 'You may move an enemy unit here with less Might than me', hint: 'harm' })),
      T.destination(F.moveDestFor(0), F.dest((_c, l) => typeof l === 'number'), { prompt: 'Move it to a different battlefield' })],   // R-2
      text: 'You may move a weaker enemy unit here to a different battlefield' }),
]);

// Irresistible Faefolk
card('unl-112-219', 'When I move to a battlefield, you may move an enemy unit to that battlefield.', [
  when('move', (ev, ctx) => ev.obj === ctx.self && typeof ev.to === 'number', ctx => { const t = ctx.target(0); if (t) ctx.move(t, ctx.event!.to as number); },
    { targets: [T.upTo(1, T.unit(F.enemy, (c, id) => c.loc(id) !== c.event?.to, { prompt: 'You may move an enemy unit to that battlefield', hint: 'harm' }))], text: 'You may move an enemy unit to that battlefield' }),
]);

// Nidalee, Cat Form ("I win if I remain after combat")
card('unl-114-219', '[Ambush]\nWhen I win a combat, draw 1.', [
  when('combatResult', iWonCombat, E.draw(1), { text: 'Won a combat: draw 1' }),
]);

// Rengar, Trophy Hunter: extra Ambush destinations (the Reaction timing that Ambush gives there needs an engine hook)
card('unl-120-219', "[Ambush]\nI can [Ambush] to a battlefield where there are enemy units, even if you don't have units there.", [
  // engine play rule (B4-2): Ambush destination + Reaction timing there, from the card itself while it is in hand
  playRule((ctx, id) => id === ctx.self, { ambush: (ctx, _id, bf) => ctx.unitsAt(bf, u => ctx.isEnemy(u)).length > 0, text: 'I can [Ambush] to a battlefield where there are enemy units.' }),
]);

// Isolate
card('unl-124-219', "Move an enemy unit from a battlefield to its base. Then, if there's an enemy unit alone at that battlefield, draw 1.", [
  spell(ctx => {
    const t = ctx.target(0);
    if (!t) return;
    const l = ctx.loc(t);
    ctx.move(t, 'base');
    if (typeof l === 'number' && ctx.unitsAt(l, u => ctx.isEnemy(u)).some(u => aloneAt(ctx, u))) ctx.draw(1);
  }, { targets: [T.unit(F.enemy, F.atBattlefield, { hint: 'harm', prompt: 'Move an enemy unit from a battlefield to its base' })] }),
]);

// Blast Cone
card('unl-133-219', 'When you play this, you may move an enemy unit.\nWhen you move an enemy unit, you may exhaust this to [Stun] it.', [
  onPlay(E.moveToChosen(0, 1), { targets: [T.upTo(1, T.unit(F.enemy, { prompt: 'You may move an enemy unit', hint: 'harm' })), T.upTo(1, T.destination(F.moveDestFor(0), { prompt: 'Move it to' }))], text: 'You may move an enemy unit' }),   // R-2
  when('move', (ev, ctx) => ev.player === ctx.controller && typeof ev.obj === 'string' && ctx.isEnemy(ev.obj) && ctx.isUnit(ev.obj) && !ctx.isExhausted(ctx.self),
    ctx => { ctx.stun(ctx.event!.obj as ObjId); }, { optional: 'Exhaust Blast Cone to stun the moved enemy unit?', cost: cost('[T]'), text: 'Exhaust this: stun it' }),
]);

// Existential Dread
card('unl-134-219', "[Action]\n[Repeat] [2]\n[Stun] an attacking enemy unit. If it's already stunned, return it to its owner's hand instead.", [
  spell(ctx => { const t = ctx.target(0); if (!t) return; if (ctx.isStunned(t)) ctx.returnToHand(t); else ctx.stun(t); },
    { targets: [T.unit(F.enemy, F.attacking, { hint: 'harm', prompt: 'Stun an attacking enemy unit' })] }),
]);

// Sinister Poro
card('unl-137-219', 'When I attack, you may pay [1] to move an enemy unit here to its base.', [
  when('attack', ifCanPay(cost('[1]'), self), E.move(0, 'base'), { optional: 'Pay [1] to move an enemy unit here to its base?', cost: cost('[1]'),
    targets: [enemyHere({ prompt: 'Move an enemy unit here to its base' })], text: 'Pay [1]: move an enemy unit here to its base' }),
]);

// Evelynn, Entrancing
card('unl-141-219', '[Hidden]\n[Backline]\nWhen you play me from face down on your turn, you may move an enemy unit at a different location to my battlefield.', [
  // always played from hiding: the card's "at a different location" overrides the "here" restriction (CR 811.1.d), so the
  // unit is chosen on resolution with that restriction lifted
  when('play', (ev, ctx) => ev.obj === ctx.self && !!ev.fromHidden && ctx.isMyTurn(), ctx => {
    const l = myBf(ctx);
    if (l === null) return;
    const t = chooseIgnoringHidden(ctx, T.upTo(1, T.unit(F.enemy, notHere, { prompt: 'You may move an enemy unit at a different location to my battlefield', hint: 'harm' })))[0];
    if (t) ctx.move(t, l);
  }, { text: 'You may move an enemy unit to my battlefield' }),
]);

// Vex, Apathetic
card('unl-150-219', "[Deflect]\nWhen an opponent plays a unit while I'm at a battlefield, [Stun] it. They can't move it this turn.", [
  when('play', (ev, ctx) => typeof ev.player === 'number' && ctx.isOpponent(ev.player as PlayerId) && typeof ev.obj === 'string' && !!ctx.obj(ev.obj) && ctx.isUnit(ev.obj) && myBf(ctx) !== null,
    ctx => { const u = ctx.event!.obj as ObjId; if (!ctx.onBoard(u)) return; ctx.stun(u); ctx.grant(u, CANT_MOVE, 'endOfTurn'); }, { text: "Stun it. They can't move it this turn." }),
]);

// Black Rose Dignitary
card('unl-152-219', '[Assault]\n[Deathknell][>] Channel 1 rune exhausted.', [
  deathknell(E.channel(1, true), { text: 'Deathknell — Channel 1 rune exhausted.' }),
]);

// Crimson Pigeons
card('unl-154-219', "I have +2 [S] while I'm attacking with another unit.", [
  selfMight(2, { if: ctx => ctx.isAttacking(ctx.self) && ctx.units(u => u !== ctx.self && ctx.isFriendly(u) && ctx.isAttacking(u)).length > 0 }),
]);

// Atakhan: the optional additional cost (kill a friendly unit) is chosen as he's played; the discount is applied to the
// play cost from that choice. While enumerating legal plays (no choice yet) the best possible discount is assumed.
const atakhanDiscount = (ctx: Ctx): { energy: number; power: number } => {
  const chosen = ctx.item?.choices.atakhan as { e: number; p: number } | undefined;
  if (chosen) return { energy: -chosen.e, power: -chosen.p };
  if (ctx.item) return { energy: 0, power: 0 };
  const cands = ctx.units(u => u !== ctx.self && ctx.ctrl(u) === ctx.controller);
  return { energy: -Math.max(0, ...cands.map(u => ctx.energyCost(u))), power: -Math.max(0, ...cands.map(u => ctx.powerCost(u))) };
};
card('unl-170-219', 'You may kill a friendly unit as an additional cost to play me. If you do, I cost [1] less for each Energy it costs and [Y] less for each Power it costs.\n[Ganking]\nWhen I attack, the defender must kill one of their units here.', [
  asPlay(ctx => {
    let cands = ctx.units(u => u !== ctx.self && ctx.ctrl(u) === ctx.controller);
    if (!cands.length) return;
    // CR 355.16 / F-3c: if he's only affordable with the discount, "none" (and too-cheap units) aren't offered
    const need = !ctx.playAffordableWith();
    if (need) cands = cands.filter(u => ctx.playAffordableWith({ energy: -ctx.energyCost(u), power: -ctx.powerCost(u) }));
    const u = ctx.chooseCards(cands, need ? 1 : 0, 1, 'Atakhan: you may kill a friendly unit as an additional cost (choose none to skip)')[0];
    if (!u) return;
    const e = ctx.energyCost(u), p = ctx.powerCost(u);
    if (ctx.item) ctx.item.choices.atakhan = { e, p };
    ctx.data.paidAdditional = true;
    // RULINGS: Radiance FAQ (Atakhan / Mordekaiser) + CR 357 — Energy and Power are paid before other costs, so the unit is
    // chosen now but killed in the payment step, after the resources (extra parts live in a step-local table, B6-4 DONE)
    ctx.addPlayCost({ energy: 0, power: [], extra: [{ label: `Kill ${ctx.name(u)}`, canPay: c => c.onBoard(u),
      // CR 203.2 / principle 22: the cost is paid even if the death is replaced (Mordekaiser, Twice Slain saving himself)
      pay: c => { if (!c.onBoard(u)) return false; c.kill(u); return true; } }] });
  }, { text: 'You may kill a friendly unit as an additional cost' }),
  selfCostDyn(atakhanDiscount, { text: '[1] less per Energy and [Y] less per Power of the killed unit' }),
  onAttack(ctx => {
    const def = ctx.g.showdown?.defender;
    const l = myBf(ctx);
    if (def === undefined || l === null) return;
    const them = ctx.as(def);
    const u = them.chooseCards(ctx.unitsAt(l, x => ctx.ctrl(x) === def), 1, 1, 'Atakhan: kill one of your units here')[0];
    if (u) them.kill(u);
  }, { text: 'The defender must kill one of their units here' }),
]);

// Galio, Indefatigable
card('unl-171-219', "[Deflect]\n[Tank]\nI don't deal combat damage.", [
  rule('noCombatDamage', (ctx, unit: ObjId) => unit === ctx.self),
]);

// Tactical Retreat
card('unl-175-219', '[Reaction]\nChoose a friendly unit. The next time it would die this turn, heal it, exhaust it, and recall it instead.', [
  spell(saveNextDeath, { targets: [T.unit(F.friendly, { hint: 'help', prompt: 'Choose a friendly unit' })] }),
]);

// Vi, Peacekeeper
card('unl-176-219', '[Ambush]\nWhen I attack, [Stun] an enemy unit here.', [
  onAttack(E.stun(0), { targets: [enemyHere({ prompt: 'Stun an enemy unit here' })], text: 'Stun an enemy unit here' }),
]);

// Ivern, Friend to All: the tag chosen as he's played is stored on the object when he enters (counter b4IvernTag)
card('unl-177-219', 'As you play me, choose Bird, Cat, Dog, or Poro. I gain that tag.\nWhen I conquer or hold, score 1 point if your units have all of the following tags among them — Bird, Cat, Dog, and Poro.', [
  asPlay(ctx => { ctx.data.ivernTag = ctx.chooseMode(IVERN_TAGS.map(t => ({ id: t, label: t })), 'Ivern: choose Bird, Cat, Dog, or Poro'); }, { text: 'Choose Bird, Cat, Dog, or Poro' }),
  statik('self', ctx => { const i = ctx.obj(ctx.self)?.counters.b4IvernTag; return i ? { tags: [IVERN_TAGS[i - 1]] } : {}; }),
  when(['conquer', 'hold'], (ev, ctx) => ev.player === ctx.controller && ((ev.units as ObjId[]) ?? []).includes(ctx.self),
    ctx => { if (tagsAmongYourUnits(ctx).length === IVERN_TAGS.length) ctx.scorePoint(ctx.controller, 1); }, { text: 'Score 1 point if your units have Bird, Cat, Dog and Poro' }),
], {
  entersReady: ctx => {
    const i = IVERN_TAGS.indexOf(ctx.data.ivernTag as typeof IVERN_TAGS[number]);
    if (i >= 0 && ctx.obj(ctx.self)) { ctx.obj(ctx.self).counters.b4IvernTag = i + 1; ctx.g.ex.dirty = true; }
    return false;
  },
});

// Shadow
card('unl-194-219', 'If you play me to a battlefield, I enter ready.\n[Action][>] [1][A], [T]: [Stun] an enemy unit attacking here.', [
  activated(cost('[1][A], [T]'), E.stun(0), { timing: 'action', targets: [T.unit(F.enemy, F.attacking, F.here, { hint: 'harm', prompt: 'Stun an enemy unit attacking here' })], text: 'Stun an enemy unit attacking here' }),
], { entersReady: ctx => typeof ctx.loc(ctx.self) === 'number' });

// Daisy!
card('unl-196-219', 'I enter ready.\nReduce my cost by [1] for each of the following tags among your units — Bird, Cat, Dog, and Poro.\nWhen I attack while your units have all 4 tags, [Stun] an enemy unit here.', [
  selfCostDyn(ctx => ({ energy: -tagsAmongYourUnits(ctx).length }), { text: '[1] less for each of Bird, Cat, Dog, Poro among your units' }),
  when('attack', (ev, ctx) => ev.obj === ctx.self && tagsAmongYourUnits(ctx).length === IVERN_TAGS.length, E.stun(0),
    { targets: [enemyHere({ prompt: 'Stun an enemy unit here' })], text: 'Stun an enemy unit here' }),
], { entersReady: true });

// Void Assault (the friendly unit moves first, so it applies Contested: you're the attacker)
card('unl-202-219', 'Move a friendly unit, then move an enemy unit.', [
  // R-2: both destinations are chosen as it is played (each move re-checked on resolution)
  spell(E.seq(E.moveToChosen(0, 1), E.moveToChosen(2, 3)),
    { targets: [T.unit(F.friendly, { prompt: 'Move a friendly unit', hint: 'neutral' }), T.destination(F.moveDestFor(0), { prompt: 'Move it to' }),
      T.unit(F.enemy, { prompt: 'Then move an enemy unit', hint: 'harm' }), T.destination(F.moveDestFor(2), { prompt: 'Move it to' })] }),
]);

// Amateur Recital (battlefield)
card('unl-207-219', 'When you hold here, you may move a unit at a battlefield to its base.', [
  // the unit is chosen as the trigger goes on the chain (a target: Deflect applies, refusable; none chosen removes the trigger)
  // (CR 355.5, 383.3.a; DECISIONS principles 4, 11; RJ#9448). The trigger's controller is the battlefield's controller = the holder.
  when('hold', (ev, ctx) => ev.bf === ctx.bfIndex() && ev.player === bfAbilityController(ctx), ctx => {
    const u = ctx.target(0);
    if (u && ctx.onBoard(u)) ctx.move(u, 'base');
  }, { targets: [T.upTo(1, T.unit(F.atBattlefield, { prompt: 'Amateur Recital: you may move a unit at a battlefield to its base' }))], text: 'You may move a unit at a battlefield to its base' }),
]);

// ================================================================================================
// VEN
// ================================================================================================

// Baccai Reaper
card('ven-009-166', 'When I attack, you may pay [C] to give me [Assault 2] this turn.', [
  when('attack', ifCanPay(cost('[C]'), self), E.keyword('self', 'Assault 2'), { optional: 'Pay [C] to give Baccai Reaper [Assault 2] this turn?', cost: cost('[C]'), text: 'Pay [C]: [Assault 2] this turn' }),
]);

// Shadow Assassin
card('ven-013-166', 'I enter ready if you have a card with my name in your trash.', [], {
  entersReady: ctx => ctx.trash().some(id => ctx.name(id) === ctx.name(ctx.self)),
});

// Eclipse Dragon
card('ven-016-166', '[Accelerate]\nWhen I move, if you control 4 or fewer runes, draw 1.', [
  onMove(E.draw(1), { if: ctx => ctx.runes().length <= 4, text: 'Draw 1 (4 or fewer runes)' }),
]);

// Renekton, Rage Fueled
card('ven-019-166', '[Accelerate]\nWhen I attack, if you control 4 or fewer runes, deal 2 to all enemy units here.', [
  onAttack(ctx => { ctx.deal(2, enemiesHere(ctx)); }, { if: ctx => ctx.runes().length <= 4, text: 'Deal 2 to all enemy units here (4 or fewer runes)' }),
]);

// Twilight Reveler
card('ven-020-166', 'When I attack, ready another friendly unit.', [
  onAttack(E.ready(0), { targets: [T.unit(F.friendly, F.other, { prompt: 'Ready another friendly unit', hint: 'help' })], text: 'Ready another friendly unit' }),
]);

// Affectionate Poro: damage events are observed by the same trigger's matcher (never triggers on them)
card('ven-024-166', "When a combat that I was in ends, if I haven't been dealt damage this turn, draw 1.", [
  when(['combatEnd', 'damage'], (ev, ctx) => {
    if (ev.type === 'damage') { if (ev.obj === ctx.self) ctx.remember('B4:damaged'); return false; }
    return wasInCombat(ctx, ctx.self);
  }, E.draw(1), { if: ctx => !ctx.remembered('B4:damaged'), text: "Draw 1 (I wasn't dealt damage this turn)" }),
]);

// Shen, Scourge of Shadows
card('ven-042-166', 'When I hold, if there is exactly one other unit you control here, draw 1.', [
  onHold(E.draw(1), { if: ctx => otherYoursHere(ctx).length === 1, text: 'Draw 1' }),
]);

// Swain, Visionary
const playedKinds = (ctx: Ctx) => {
  const kinds = new Set<string>();
  for (const id of ctx.playedThisTurn()) {
    const o = ctx.g.objects[id];
    if (!o || o.isToken) continue;           // tokens cease to exist when they leave the board
    const d = ctx.g.cards[o.cardId];
    kinds.add(d?.type ?? '');
    for (const t of d?.additionalTypes ?? []) kinds.add(t);   // Patched Porobot is a unit and a gear (CR 178.3; RJ#12166)
  }
  return kinds;
};
card('ven-065-166', "[Vision]\nWhen I conquer, if you've played a non-token unit, a non-token gear, and a spell this turn, you score 1 point.", [
  onConquer(E.points(1), { if: ctx => { const k = playedKinds(ctx); return k.has('Unit') && k.has('Gear') && k.has('Spell'); }, text: 'Score 1 point' }),
]);

// Repair Specialist
card('ven-076-166', 'I have [Assault] equal to the number of gear you control.', [
  statik('self', ctx => { const n = ctx.gear(g => ctx.ctrl(g) === ctx.controller).length; return n > 0 ? { keywords: [`Assault ${n}`] } : {}; }),
]);

// Corrupted Dragon
card('ven-091-166', 'If your score is not within 3 points of the Victory Score, I enter ready.\nWhen I attack, you may move any number of enemy units here each with 5 [S] or less to their base.', [
  onAttack(E.move(0, 'base'), { targets: [T.anyNumber(T.unit(F.enemy, F.here, F.mightAtMost(5), { prompt: 'Move any number of enemy units here with 5 [S] or less to their base', hint: 'harm' }))], text: 'Move enemy units here with 5 [S] or less to their base' }),
], { entersReady: C.not(C.nearVictory(3)) });

// Minah Swiftfoot
card('ven-111-166', 'When I move to a battlefield, choose one —\n- Each player discards 1.\n- Each player draws 1.', [
  // R-1 (CR 403.2): the mode is chosen as the trigger goes on the chain
  onMove(E.noop, {
    toBattlefield: true,
    modes: [
      mode('discard', 'Each player discards 1', ctx => ctx.eachPlayer(p => { ctx.discard(1, p); })),
      mode('draw', 'Each player draws 1', ctx => ctx.eachPlayer(p => { ctx.draw(1, p); })),
    ],
    text: 'Each player discards 1 or each player draws 1',
  }),
]);

// Ocean Drake
card('ven-115-166', "You may play me to an open battlefield.\nWhen you play me, you may return a non-Dragon unit to its owner's hand.", [
  selfDest(openBattlefields, 'You may play me to an open battlefield.'),
  onPlay(E.returnToHand(0), { targets: [T.upTo(1, T.unit((c, id) => !c.hasTag(id, 'Dragon'), { prompt: "You may return a non-Dragon unit to its owner's hand" }))], text: 'You may return a non-Dragon unit to hand' }),
]);

// Kennen, Keeper of Balance
const kennenStun = { optional: 'Pay [2] to stun a unit?', cost: cost('[2]'), targets: [T.unit({ prompt: 'Stun a unit', hint: 'harm' as const })], text: 'Pay [2]: stun a unit' };
card('ven-135-166', "[Hidden]\nWhen you play me or I attack, you may pay [2] to [Stun] a unit.\nWhile there's a stunned enemy unit here, I have +2 [S].", [
  when('play', ifCanPay(cost('[2]'), self), E.stun(0), kennenStun),
  when('attack', ifCanPay(cost('[2]'), self), E.stun(0), kennenStun),
  selfMight(2, { if: ctx => enemiesHere(ctx, u => ctx.isStunned(u)).length > 0 }),
]);

// Shen, Leader of the Kinkou Order
card('ven-138-166', '[Shield]\nWhen I hold, if there is exactly one other unit you control here, you score 1 point.', [
  onHold(E.points(1), { if: ctx => otherYoursHere(ctx).length === 1, text: 'Score 1 point' }),
]);

// Shadow Dash
card('ven-148-166', 'Move an enemy unit to a battlefield where you have units. If you have exactly two units there, they each get +1 [S] this turn.\n[Flow] [5][A][A]', [
  spell(ctx => {
    const t = ctx.target(0), d = ctx.destination(1);
    if (!t || typeof d !== 'number' || !ctx.canMoveTo(t, d)) return;
    ctx.move(t, d);
    const mine = ctx.unitsAt(d, u => ctx.ctrl(u) === ctx.controller);
    if (mine.length === 2) ctx.giveMight(mine, 1);
  }, { targets: [T.unit(F.enemy, { hint: 'harm', prompt: 'Move an enemy unit to a battlefield where you have units' }),
    T.destination(F.moveDestFor(0), F.dest((c, l) => typeof l === 'number' && c.unitsAt(l, u => c.ctrl(u) === c.controller).length > 0), { prompt: 'Move it to a battlefield where you have units' })] }),   // R-2
]);


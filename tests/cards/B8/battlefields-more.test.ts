// B8 battlefields (Radiance, Spiritforged, Unleashed, Vengeance) and battlefield tokens.
import { test } from 'node:test';
import {
  assert, game, setBf, setLegend, moveIn, endTurn, put, runes, handCard, resolveAll, zoneOf, setController, yes, no, choose, act, play,
  activate, onlyRunes, expectPending, optIds, might, hasKw, kwVal, getLegalActions, exhaustRunes, readyCount, pass,
} from './b8-util.ts';
import type { GameState, ObjId, PlayerId } from '../../../src/engine/types.ts';

function setupHold(cardId: string, bf = 1, unitCard = 't-u2'): { g: GameState; u: ObjId } {
  let g = game();
  setBf(g, bf, cardId);
  setController(g, bf, 0);
  const u = put(g, 0, unitCard, bf);
  g = endTurn(g);
  g = endTurn(g);
  return { g, u };
}
const canPlayTo = (g: GameState, p: PlayerId, obj: ObjId, dest?: number | 'base') =>
  getLegalActions(g, p).some(a => a.type === 'playCard' && a.obj === obj && (dest === undefined || a.destination === dest));
const runesLeft = (g: GameState, p: PlayerId) => g.players[p].runesInPlay.length;

test('Black Market: any player may pay [A][A] to draw 1, once on their own turn', () => {
  let g = game();
  const bm = setBf(g, 1, 'rad-158-167');          // owned by P1, uncontrolled
  const h = g.players[0].hand.length;
  assert.ok(getLegalActions(g, 0).some(a => a.type === 'activate' && a.obj === bm));
  g = activate(g, 0, bm);
  g = resolveAll(g);
  assert.equal(g.players[0].hand.length, h + 1);
  runes(g, 0, 2);
  assert.ok(!getLegalActions(g, 0).some(a => a.type === 'activate' && a.obj === bm), 'once per turn');
  g = endTurn(g);
  runes(g, 1, 2);
  assert.ok(getLegalActions(g, 1).some(a => a.type === 'activate' && a.obj === bm), 'the other player on their turn');
});

test('Cosmic Vista: holding with an empty Rune Deck scores 1 more point', () => {
  for (const empty of [true, false]) {
    let g = game();
    setBf(g, 1, 'rad-160-167');
    setController(g, 1, 0);
    put(g, 0, 't-u2', 1);
    g = endTurn(g);
    if (empty) g.players[0].runeDeck = [];
    g = endTurn(g);
    g = resolveAll(g);
    assert.equal(g.players[0].points, empty ? 2 : 1);
  }
});

test('Durand Memorial: the defender gives a unit they control here Tank this combat', () => {
  let g = game({ firstPlayer: 1 });
  setBf(g, 0, 'rad-161-167');
  setController(g, 0, 0);
  const d1 = put(g, 0, 't-u1', 0), d2 = put(g, 0, 't-u3', 0);
  const a = put(g, 1, 't-u2', 'base');
  g = act(g, { type: 'move', player: 1, units: [a], to: 0 });
  for (let i = 0; i < 6 && g.pending?.kind !== 'chooseTargets'; i++) g = resolveAll(g);
  expectPending(g, 'chooseTargets', /Tank/);
  assert.equal(g.pending!.player, 0);
  assert.deepEqual(optIds(g).sort(), [d1, d2].sort(), 'only units you control here');
  g = choose(g, d1);
  // RULINGS sweep / CR 403.2: chosen as the trigger goes on the chain, Tank given on resolution
  assert.deepEqual(g.chain.at(-1)?.targets, [[d1]]);
  g = resolveAll(g);
  expectPending(g, 'assignDamage');
  assert.ok(hasKw(g, d1, 'Tank'));
  assert.equal(g.pending!.player, 1);
  assert.throws(() => act(g, { type: 'assignDamage', player: 1, assignment: { [d2]: 2 } }), /Tank first/, 'Tank must be assigned lethal damage first');
  g = act(g, { type: 'assignDamage', player: 1, assignment: { [d1]: 1, [d2]: 1 } });
  g = resolveAll(g);
  assert.equal(zoneOf(g, d1), 'trash');
  assert.equal(hasKw(g, d2, 'Tank'), false);
});

test("Firelights' Hideout: the next unit you play this turn has Accelerate (only that one)", () => {
  let g = game();
  setBf(g, 1, 'rad-162-167');
  const u1 = handCard(g, 0, 't-u2'), u2 = handCard(g, 0, 't-u2');
  assert.equal(hasKw(g, u1, 'Accelerate'), false);
  g = moveIn(g, 0, 1).g;
  assert.ok(hasKw(g, u1, 'Accelerate') && hasKw(g, u2, 'Accelerate'));
  runes(g, 0, 6, 'rad-r01');
  g = play(g, 0, u1, 'base');
  expectPending(g, 'optional', /Accelerate/);
  g = yes(g);
  g = resolveAll(g);
  assert.equal(g.objects[u1].exhausted, false, 'entered ready');
  assert.equal(hasKw(g, u2, 'Accelerate'), false, 'only the next unit');
});

test("Hunters' Circle: the first unit or gear each player plays here on their turn costs [1] less", () => {
  let g = game();
  setBf(g, 1, 'rad-163-167');
  setController(g, 1, 0);
  put(g, 0, 't-u1', 1);
  onlyRunes(g, 0, 1);
  const u = handCard(g, 0, 't-u2'), v = handCard(g, 0, 't-u2');
  assert.ok(canPlayTo(g, 0, u, 1), '2 -> 1 here');
  assert.ok(!canPlayTo(g, 0, u, 'base'), 'full price elsewhere');
  g = play(g, 0, u, 1);
  g = resolveAll(g);
  onlyRunes(g, 0, 1);
  assert.ok(!canPlayTo(g, 0, v, 1), 'only the first one each turn');
});

test('Packed Amphitheater: champion units here have +1', () => {
  const g = game();
  setBf(g, 1, 'rad-164-167');
  const c = put(g, 0, 'b8-champ', 1), n = put(g, 0, 't-u3', 1), b = put(g, 0, 'b8-champ', 'base');
  assert.equal(might(g, c), 4); assert.equal(might(g, n), 3); assert.equal(might(g, b), 3);
});

test('Rakelstake: the first unit or gear a player plays here each turn makes them Predict', () => {
  let g = game();
  setBf(g, 1, 'rad-165-167');
  setController(g, 1, 0);
  put(g, 0, 't-u1', 1);
  runes(g, 0, 6);
  const top = g.players[0].mainDeck[0];
  g = play(g, 0, handCard(g, 0, 't-u2'), 1);
  g = resolveAll(g);
  expectPending(g, 'chooseCards', /Predict/);
  g = choose(g, top);
  assert.equal(g.players[0].mainDeck.at(-1), top, 'recycled');
  g = resolveAll(g);
  g = play(g, 0, handCard(g, 0, 't-u2'), 1);
  g = resolveAll(g);
  assert.equal(g.pending?.kind, 'mainAction', 'only the first time each turn');
});

test('Ruined Monastery: conquering may discard 1 to channel 1 rune exhausted', () => {
  for (const ans of ['yes', 'no']) {
    let g = game();
    setBf(g, 1, 'rad-166-167');
    const n = runesLeft(g, 0), h = g.players[0].hand.length;
    g = moveIn(g, 0, 1).g;
    expectPending(g, 'optional', /discard 1/i);
    g = ans === 'yes' ? yes(g) : no(g);
    // the leading "you may" is decided as the trigger is chained (principle 11); the discard happens on resolution
    if (ans === 'yes') { g = resolveAll(g); expectPending(g, 'chooseCards', /Discard/); g = choose(g, g.pending!.options![0].id); g = resolveAll(g); }
    assert.equal(runesLeft(g, 0), n + (ans === 'yes' ? 1 : 0));
    assert.equal(g.players[0].hand.length, h - (ans === 'yes' ? 1 : 0));
    if (ans === 'yes') assert.equal(g.objects[g.players[0].runesInPlay.at(-1)!].exhausted, true);
  }
});

test('Forge of the Fluft: while you control it, your legend has "[T]: Attach an Equipment you control to a unit you control"', () => {
  let g = game();
  setBf(g, 1, 'sfd-208-221');
  const legend = g.players[0].legend;
  const sword = put(g, 0, 'b8-sword', 'base'), u = put(g, 0, 't-u2', 'base');
  const legendAct = () => getLegalActions(g, 0).filter(a => a.type === 'activate' && a.obj === legend);
  assert.equal(legendAct().length, 0, 'not while uncontrolled');
  setController(g, 1, 0);
  put(g, 0, 't-u1', 1);
  const acts = legendAct();
  assert.equal(acts.length, 1);
  g = act(g, acts[0]);
  expectPending(g, 'chooseTargets', /unit you control/);
  g = choose(g, u);
  g = resolveAll(g);
  assert.equal(g.objects[sword].attachedTo, u);
  assert.equal(g.objects[legend].exhausted, true);
  assert.equal(legendAct().length, 0);
  setController(g, 1, 1);
  assert.equal(getLegalActions(g, 1).filter(a => a.type === 'activate' && a.obj === legend).length, 0);
});

test("Forgotten Monument: players can't score here until their third turn", () => {
  let g = game();
  setBf(g, 1, 'sfd-209-221');
  g = moveIn(g, 0, 1).g;
  assert.equal(g.battlefields[1].controller, 0, 'control is still established');
  assert.equal(g.players[0].points, 0, 'turn 1: no conquer');
  g = endTurn(g); g = resolveAll(g);   // P1 turn 2
  g = endTurn(g); g = resolveAll(g);   // P0 turn 3 (their 2nd): hold gives nothing
  assert.equal(g.players[0].points, 0);
  g = endTurn(g); g = resolveAll(g);   // P1
  g = endTurn(g); g = resolveAll(g);   // P0 turn 5 (their 3rd): hold scores
  assert.equal(g.players[0].points, 1);
});

test('Hall of Legends: conquering may pay [1] to ready your legend', () => {
  let g = game();
  setBf(g, 1, 'sfd-210-221');
  const l = g.players[0].legend;
  g.objects[l].exhausted = true;
  g = moveIn(g, 0, 1).g;
  expectPending(g, 'optional', /ready your legend/);
  g = resolveAll(yes(g));          // MA-6: paid as the trigger goes on the chain, ready on resolution
  assert.equal(g.objects[l].exhausted, false);
  assert.equal(readyCount(g, 0), 1, 'paid [1]');
});

test('Marai Spire: while you control it, your Repeat costs cost [1] less', () => {
  let g = game();
  setBf(g, 1, 'sfd-211-221');
  setController(g, 1, 0);
  put(g, 0, 't-u1', 1);
  exhaustRunes(g, 0);
  runes(g, 0, 2);
  const h = g.players[0].hand.length;
  g = play(g, 0, handCard(g, 0, 'b8-repeat'));
  expectPending(g, 'optional', /Pay 1 to Repeat/);
  g = yes(g);
  g = resolveAll(g);
  assert.equal(g.players[0].hand.length, h + 2, 'drew twice');
});

test('Marai Spire: an opponent-controlled Spire does not help you', () => {
  let g = game();
  setBf(g, 1, 'sfd-211-221');
  setController(g, 1, 1);
  put(g, 1, 't-u1', 1);
  exhaustRunes(g, 0);
  runes(g, 0, 2);
  g = play(g, 0, handCard(g, 0, 'b8-repeat'));
  assert.equal(g.pending?.kind === 'optional' && /Repeat/.test(g.pending.prompt), false, 'Repeat [2] not affordable');
});

test("Ornn's Forge: the first friendly non-token gear each turn costs [1] less", () => {
  let g = game();
  setBf(g, 1, 'sfd-213-221');
  setController(g, 1, 0);
  put(g, 0, 't-u1', 1);
  exhaustRunes(g, 0);
  runes(g, 0, 1);
  const g1 = handCard(g, 0, 'b8-gear'), g2 = handCard(g, 0, 'b8-gear');
  assert.ok(canPlayTo(g, 0, g1));
  g = play(g, 0, g1, 'base');
  g = resolveAll(g);
  runes(g, 0, 1);
  assert.equal(canPlayTo(g, 0, g2), false, 'second gear costs full');
});

test('Power Nexus: holding may pay [A][A][A][A] to score 1 point', () => {
  let g = game();
  setBf(g, 1, 'sfd-214-221');
  setController(g, 1, 0);
  put(g, 0, 't-u2', 1);
  g = endTurn(g);
  runes(g, 0, 4);
  g = endTurn(g);
  g = resolveAll(g);
  expectPending(g, 'optional', /score 1 point/);
  g = yes(g);
  g = resolveAll(g);   // paid as the trigger is chained, scored on resolution (principle 11)
  assert.equal(g.players[0].points, 2);
});

test("Rockfall Path: units can't be played here", () => {
  const g = game();
  setBf(g, 1, 'sfd-216-221');
  setController(g, 1, 0); setController(g, 0, 0);
  put(g, 0, 't-u1', 1); put(g, 0, 't-u1', 0);
  runes(g, 0, 4);
  const u = handCard(g, 0, 't-u2');
  assert.equal(canPlayTo(g, 0, u, 1), false);
  assert.equal(canPlayTo(g, 0, u, 0), true);
  assert.equal(canPlayTo(g, 0, u, 'base'), true);
});

test('Seat of Power: conquering draws 1 for each other battlefield you control', () => {
  let g = game();
  setBf(g, 1, 'sfd-217-221');
  setController(g, 0, 0);
  put(g, 0, 't-u1', 0);
  const h = g.players[0].hand.length;
  g = moveIn(g, 0, 1).g;
  g = resolveAll(g);
  assert.equal(g.players[0].hand.length, h + 1);
});

test('Sunken Temple: conquering with a Mighty unit may pay [1] to draw 1; without one, nothing', () => {
  let g = game();
  setBf(g, 1, 'sfd-218-221');
  const h = g.players[0].hand.length;
  g = moveIn(g, 0, 1, 't-u5').g;
  expectPending(g, 'optional', /draw 1/);
  g = resolveAll(yes(g));          // MA-6: paid as the trigger goes on the chain, draw on resolution
  assert.equal(g.players[0].hand.length, h + 1);
  let g2 = game();
  setBf(g2, 1, 'sfd-218-221');
  g2 = moveIn(g2, 0, 1, 't-u2').g;
  assert.equal(g2.pending?.kind, 'mainAction');
});

test('The Papertree: holding here makes each player channel 1 rune exhausted', () => {
  let { g } = setupHold('sfd-219-221');
  const p1 = runesLeft(g, 1);
  g = resolveAll(g);
  assert.equal(runesLeft(g, 1), p1 + 1);
  assert.equal(g.objects[g.players[1].runesInPlay.at(-1)!].exhausted, true);
});

test('Abandoned Hall: when a player plays a spell, they may give a unit they control here +1', () => {
  let g = game();
  setBf(g, 1, 'unl-205-219');
  setController(g, 1, 0);
  const u = put(g, 0, 't-u2', 1);
  put(g, 1, 't-u2', 'base');
  runes(g, 0, 2);
  g = play(g, 0, handCard(g, 0, 'b8-s1'));
  g = resolveAll(g);
  expectPending(g, 'chooseTargets', /\+1/);
  assert.equal(g.pending!.min, 0);
  g = choose(g, u);
  assert.equal(might(g, u), 3);
});

test('Altar of Blood: a unit dying here in combat may be saved by its controller for [A][A][A]', () => {
  let g = game();
  setBf(g, 1, 'unl-206-219');
  setController(g, 1, 1);
  const d = put(g, 1, 't-u2', 1);
  runes(g, 1, 3);
  const a = put(g, 0, 't-u5', 'base');
  g = act(g, { type: 'move', player: 0, units: [a], to: 1 });
  for (let i = 0; i < 6 && g.pending?.kind !== 'optional'; i++) g = resolveAll(g);
  expectPending(g, 'optional', /Altar of Blood/);
  assert.equal(g.pending!.player, 1);
  g = yes(g);
  g = resolveAll(g);
  assert.equal(zoneOf(g, d), 'base');
  assert.equal(g.objects[d].exhausted, true);
  assert.equal(g.objects[d].damage, 0);
});

test('Black Flame Altar: units here with Temporary have Shield', () => {
  const g = game();
  setBf(g, 1, 'unl-208-219');
  const t = put(g, 0, 't-temp', 1), n = put(g, 0, 't-u2', 1);
  assert.equal(kwVal(g, t, 'Shield'), 1);
  assert.equal(hasKw(g, n, 'Shield'), false);
});

test('Gardens of Becoming: units here have "[T]: Gain 1 XP"', () => {
  let g = game();
  setBf(g, 1, 'unl-213-219');
  setController(g, 1, 0);
  const u = put(g, 0, 't-u2', 1), b = put(g, 0, 't-u2', 'base');
  const acts = getLegalActions(g, 0).filter(a => a.type === 'activate' && (a.obj === u || a.obj === b));
  assert.equal(acts.length, 1);
  g = act(g, acts[0]);
  g = resolveAll(g);
  assert.equal(g.players[0].xp, 1);
  assert.equal(g.objects[u].exhausted, true);
});

test("Ripper's Bay: when a unit here returns to hand, that player may pay [1] to channel 1 exhausted", () => {
  let g = game();
  setBf(g, 1, 'unl-214-219');
  const e = put(g, 1, 't-u2', 1);
  runes(g, 1, 1);
  runes(g, 0, 2);
  g = play(g, 0, handCard(g, 0, 'b8-bounce'));
  if (g.pending?.kind === 'chooseTargets') g = choose(g, e);
  g = resolveAll(g);
  expectPending(g, 'optional', /channel 1 rune exhausted/);
  assert.equal(g.pending!.player, 1);
  g = yes(g);
  g = resolveAll(g);   // paid as the trigger is chained, channelled on resolution (principle 11)
  assert.equal(runesLeft(g, 1), 2);
});

test('Star Spring: the first non-token unit a player plays here each turn may send another of their units here to base', () => {
  let g = game();
  setBf(g, 1, 'unl-215-219');
  setController(g, 1, 0);
  const old = put(g, 0, 't-u1', 1);
  runes(g, 0, 6);
  g = play(g, 0, handCard(g, 0, 't-u2'), 1);
  g = resolveAll(g);
  expectPending(g, 'chooseTargets', /base/);   // chosen as the trigger is chained (principle 11; RJ#10879)
  assert.equal(g.pending!.min, 0);
  g = resolveAll(choose(g, old));
  assert.equal(zoneOf(g, old), 'base');
  g = resolveAll(g);
  g = play(g, 0, handCard(g, 0, 't-u2'), 1);
  g = resolveAll(g);
  assert.equal(g.pending?.kind, 'mainAction', 'only the first time each turn');
});

test('The Academy: holding gives your next spell this turn Repeat equal to its base cost', () => {
  let { g } = setupHold('unl-216-219');
  g = resolveAll(g);
  onlyRunes(g, 0, 2);
  const h = g.players[0].hand.length;
  g = play(g, 0, handCard(g, 0, 'b8-hideable'));
  expectPending(g, 'optional', /The Academy: pay \[1\]/);
  g = yes(g);
  g = resolveAll(g);
  assert.equal(g.players[0].hand.length, h + 2, 'the draw happened twice');
  assert.equal(readyCount(g, 0), 0, 'paid [1] + [1]');
  onlyRunes(g, 0, 2);
  g = play(g, 0, handCard(g, 0, 'b8-hideable'));
  assert.notEqual(g.pending?.kind, 'optional', 'only the next spell');
});

test('Valley of Idols: a player playing a unit here may pay [1] to buff it', () => {
  let g = game();
  setBf(g, 1, 'unl-218-219');
  setController(g, 1, 0);
  put(g, 0, 't-u1', 1);
  runes(g, 0, 3);
  const u = handCard(g, 0, 't-u2');
  g = play(g, 0, u, 1);
  g = resolveAll(g);
  expectPending(g, 'optional', /buff/);
  g = yes(g);
  // the [1] is paid as the trigger is chained (principle 11, RJ#12403); the buff happens on resolution
  g = resolveAll(g);
  assert.equal(g.objects[u].counters.buff, 1);
});

test('Vaults of Helia: after holding here your non-token units cost [1] more this turn', () => {
  let { g } = setupHold('unl-219-219');
  g = resolveAll(g);
  exhaustRunes(g, 0);
  runes(g, 0, 2);
  const u2 = handCard(g, 0, 't-u2'), u1 = handCard(g, 0, 't-u1');
  assert.equal(canPlayTo(g, 0, u2, 'base'), false);
  assert.equal(canPlayTo(g, 0, u1, 'base'), true);
  g = endTurn(g);
  exhaustRunes(g, 1); runes(g, 1, 2);
  assert.equal(canPlayTo(g, 1, handCard(g, 1, 't-u2'), 'base'), true, 'only you, only this turn');
});

test('Baron Pit: units can move here from anywhere (but not out to other battlefields)', () => {
  const g = game();
  setBf(g, 1, 'unl-t01');
  setController(g, 0, 0);
  const u = put(g, 0, 't-u2', 0);
  assert.ok(getLegalActions(g, 0).some(a => a.type === 'move' && a.units.length === 1 && a.units[0] === u && a.to === 1));
  const v = put(g, 0, 't-u2', 1);
  assert.ok(!getLegalActions(g, 0).some(a => a.type === 'move' && a.units.includes(v) && a.to === 0));
});

test('Brush: Bird/Cat/Dog/Poro/Ivern units here have +1; scoring here may swap back to the replaced battlefield', () => {
  let g = game();
  const orig = setBf(g, 1, 'ogn-280-298');
  setLegend(g, 0, 'unl-195-219');                 // Green Father makes the Brush
  const cat = put(g, 0, 'b8-cat', 'base');
  g = act(g, { type: 'move', player: 0, units: [cat], to: 1 });
  g = resolveAll(g);
  expectPending(g, 'optional', /Brush/);
  g = yes(g);
  g = resolveAll(g);
  const brush = g.battlefields[1].objId;
  assert.equal(g.objects[brush].cardId, 'unl-t03');
  assert.equal(zoneOf(g, orig), 'banishment');
  assert.equal(might(g, cat), 3, 'Cat +1 in Brush');
  g = endTurn(g); g = endTurn(g);                // P0 holds the Brush
  g = resolveAll(g);
  // Green Father (readied) may also trigger on the Brush hold — a Brush may be Brushed (DECISIONS #9356); decline it here
  for (let i = 0; i < 6 && g.pending?.kind === 'optional' && /Green Father/.test(g.pending.prompt ?? ''); i++) { g = act(g, { type: 'choose', player: g.pending.player, optionIds: ['no'] }); g = resolveAll(g); }
  if (g.pending?.kind === 'orderTriggers') { g = act(g, { type: 'choose', player: g.pending.player, optionIds: g.pending.options!.map(o => o.id) }); g = resolveAll(g); }
  for (let i = 0; i < 6 && g.pending?.kind === 'optional' && /Green Father/.test(g.pending.prompt ?? ''); i++) { g = act(g, { type: 'choose', player: g.pending.player, optionIds: ['no'] }); g = resolveAll(g); }
  expectPending(g, 'optional', /Replace Brush/);
  g = yes(g);
  g = resolveAll(g);
  assert.equal(g.battlefields[1].objId, orig);
  assert.equal(g.objects[orig].zone, 'battlefield');
  assert.equal(might(g, cat), 2);
});

test('Dragon Roost: a player may pay [A][A] extra to play a Dragon here', () => {
  let g = game();
  setBf(g, 1, 'ven-157-166');
  onlyRunes(g, 0, 5);
  const d = handCard(g, 0, 'b8-dragon'), u = handCard(g, 0, 't-u2');
  assert.ok(canPlayTo(g, 0, d, 1), 'a Dragon may go to the (uncontrolled) Roost');
  assert.equal(canPlayTo(g, 0, u, 1), false, 'other units may not');
  g = play(g, 0, d, 1);
  g = resolveAll(g);
  assert.equal(g.objects[d].battlefieldIndex, 1);
  assert.equal(g.players[0].runesInPlay.length, 3, '[5] + [A][A]: two runes recycled');
});

test('Dragon Roost: an opponent of its controller can use it too', () => {
  const g = game();
  setBf(g, 1, 'ven-157-166');
  setController(g, 1, 1); put(g, 1, 't-u1', 1);
  onlyRunes(g, 0, 7);
  assert.ok(canPlayTo(g, 0, handCard(g, 0, 'b8-dragon'), 1));
});

test('Heisho: players ignore Deflect for spells choosing something here', () => {
  let g = game();
  setBf(g, 1, 'ven-158-166');
  const t = put(g, 1, 't-deflect', 1), t2 = put(g, 1, 't-deflect', 'base');
  onlyRunes(g, 0, 1);
  const n = runesLeft(g, 0);
  g = play(g, 0, handCard(g, 0, 'b8-zap'));
  // the Deflect 2 unit at base would cost [1][A][A] (unaffordable): only the one at Heisho is offered (auto-chosen)
  if (g.pending?.kind === 'chooseTargets') { assert.ok(!optIds(g).includes(t2)); g = choose(g, t); }
  g = resolveAll(g);
  assert.equal(g.objects[t].damage, 1);
  assert.equal(g.objects[t2].damage, 0);
  assert.equal(runesLeft(g, 0), n, 'no Deflect tax paid (no rune recycled)');
});

test('Kinkou Temple: units here with Tank have +1', () => {
  const g = game();
  setBf(g, 1, 'ven-159-166');
  const t = put(g, 0, 't-tank', 1), n = put(g, 0, 't-u2', 1);
  assert.equal(might(g, t), 4); assert.equal(might(g, n), 2);
});

test('Mystic Vortex: during showdowns here, Reaction cards cost [A] more', () => {
  for (const vortex of [true, false]) {
    let g = game();
    if (vortex) setBf(g, 1, 'ven-160-166');
    const u = put(g, 0, 't-u2', 'base');
    g = act(g, { type: 'move', player: 0, units: [u], to: 1 });
    expectPending(g, 'showdownAction');
    g.players[0].runesInPlay.forEach(r => { g.objects[r].exhausted = true; });
    runes(g, 0, 1);
    const n = runesLeft(g, 0);
    g = play(g, 0, handCard(g, 0, 'b8-react'));
    assert.equal(runesLeft(g, 0), vortex ? n - 1 : n, vortex ? 'paid [1][A]: a rune recycled' : 'paid [1]');
  }
});

test('Piltovan Forge: the first friendly gear ability each turn costs [1] less', () => {
  let g = game();
  setBf(g, 1, 'ven-161-166');
  setController(g, 1, 0);
  put(g, 0, 't-u1', 1);
  const g1 = put(g, 0, 'b8-gearab', 'base'), g2 = put(g, 0, 'b8-gearab', 'base');
  exhaustRunes(g, 0); runes(g, 0, 1);
  const h = g.players[0].hand.length;
  assert.ok(getLegalActions(g, 0).some(a => a.type === 'activate' && a.obj === g1));
  g = activate(g, 0, g1);
  g = resolveAll(g);
  assert.equal(g.players[0].hand.length, h + 1);
  runes(g, 0, 1);
  assert.equal(getLegalActions(g, 0).some(a => a.type === 'activate' && a.obj === g2), false, 'second costs full [2]');
});

test('Protective Sands: conquering with 4 or fewer runes may pay [1] to draw 1; 5+ runes nothing', () => {
  let g = game();
  setBf(g, 1, 'ven-162-166');
  const h = g.players[0].hand.length;
  g = moveIn(g, 0, 1).g;
  expectPending(g, 'optional', /draw 1/);
  g = resolveAll(yes(g));          // MA-6: paid as the trigger goes on the chain, draw on resolution
  assert.equal(g.players[0].hand.length, h + 1);
  let g2 = game();
  setBf(g2, 1, 'ven-162-166');
  runes(g2, 0, 3);
  g2 = moveIn(g2, 0, 1).g;
  assert.equal(g2.pending?.kind, 'mainAction');
});

test('Risen Altar: Empower costs of your units here cost [1] less', () => {
  let g = game();
  setBf(g, 1, 'ven-163-166');
  setController(g, 1, 0);
  const u = put(g, 0, 'b8-emp', 1), b = put(g, 0, 'b8-emp', 'base');
  exhaustRunes(g, 0); runes(g, 0, 1);
  const acts = getLegalActions(g, 0).filter(a => a.type === 'activate' && a.abilityIndex === 901);
  assert.deepEqual(acts.map(a => (a as { obj: string }).obj), [u], 'Empower [2] -> [1] here only');
  g = act(g, acts[0]);
  g = resolveAll(g);
  assert.equal(g.objects[u].empowered, 1);
  assert.equal(hasKw(g, g.battlefields[1].objId, 'Empower'), false, 'the battlefield itself has no Empower keyword');
  void b;
});

test('Sandswept Tomb: a spell choosing a friendly unit here costs [A] less', () => {
  for (const here of [true, false]) {
    let g = game();
    setBf(g, 1, 'ven-164-166');
    const u = put(g, 0, 't-u2', here ? 1 : 'base');
    exhaustRunes(g, 0);
    runes(g, 0, 1, 'rad-r01');
    const n = runesLeft(g, 0);
    g = play(g, 0, handCard(g, 0, 'b8-pumpA'));
    if (g.pending?.kind === 'chooseTargets') g = choose(g, u);
    g = resolveAll(g);
    assert.equal(might(g, u), 3);
    assert.equal(runesLeft(g, 0), here ? n : n - 1, here ? 'only [1] paid' : '[1][C] paid (a rune recycled)');
  }
});

test('Threshold of the Gray: when combat starts here, attacker and defender each add [1]', () => {
  let g = game();
  setBf(g, 1, 'ven-166-166');
  setController(g, 1, 1);
  put(g, 1, 't-u2', 1);
  const a = put(g, 0, 't-u2', 'base');
  g = act(g, { type: 'move', player: 0, units: [a], to: 1 });
  expectPending(g, 'showdownAction');
  assert.equal(g.players[0].pool.energy, 1);
  assert.equal(g.players[1].pool.energy, 1);
  void pass; void no;
});

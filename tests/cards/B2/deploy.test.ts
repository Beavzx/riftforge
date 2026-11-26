// B2: Deploy gear.
import { test } from 'node:test';
import {
  game, mana, run, play, playNew, put, handCard, zoneOf, assert, expectDecision, atMain, setController, handSize, act,
  hasKw, kwVal, canMove, getLegalActions, clearRunes,
} from './util.ts';
import type { GameState, ObjId } from '../../../src/engine/types.ts';

const endTurn = (g: GameState) => run(act(g, { type: 'endTurn', player: g.pending!.player }));

test('Deploy (engine keyword): playable to any battlefield, not to base; not recalled; killed when an opponent holds there', () => {
  let g = game();
  mana(g, 0, 3, 'Chaos');      // The Good Stuff is Chaos (data audit table C)
  setController(g, 1, 1);
  put(g, 1, 't-u2', 1);
  const gs = handCard(g, 0, 'rad-106-167');      // The Good Stuff
  const dests = getLegalActions(g, 0).filter(a => a.type === 'playCard' && a.obj === gs).map(a => (a as { destination?: unknown }).destination);
  assert.deepEqual(dests.sort(), [0, 1], 'any battlefield (even enemy-controlled), never base');
  for (let i = 0; i < 4; i++) handCard(g, 0, 't-u1');
  g = run(play(g, 0, gs, { destination: 1 }), [g.players[0].hand.find(x => x !== gs)!]);
  assert.equal(zoneOf(g, gs), 'battlefield', 'unattached Deploy gear stays at the battlefield');
  g = endTurn(g);                                 // player 1 holds battlefield 1 in their Beginning Phase
  assert.equal(zoneOf(g, gs), 'trash', 'killed when an opponent holds here');
});

test('Banner of Conquest: friendly units here have Assault', () => {
  let g = game();
  mana(g, 0, 1, 'Fury');
  setController(g, 0, 0);
  const here = put(g, 0, 't-u2', 0);
  const away = put(g, 0, 't-u2', 'base');
  const enemyHere = put(g, 1, 't-u2', 1);
  g = run(playNew(g, 0, 'rad-002-167', { destination: 0 })[0]);
  assert.ok(hasKw(g, here, 'Assault'));
  assert.ok(!hasKw(g, away, 'Assault') && !hasKw(g, enemyHere, 'Assault'));
});

test('Detonation Amplifier: may kill another friendly unit or gear to draw 1', () => {
  let g = game();
  mana(g, 0, 4, 'Chaos');
  const fodder = put(g, 0, 't-u1', 'base');
  const hand = handSize(g, 0);
  let d: ObjId;
  [g, d] = playNew(g, 0, 'rad-017-167', { destination: 0 });
  g = run(g, 'yes');
  assert.equal(zoneOf(g, fodder), 'trash');
  assert.equal(handSize(g, 0), hand + 1);
  assert.equal(zoneOf(g, d), 'battlefield');
});

test('Detonation Amplifier: friendly Deathknell effects here trigger an additional time (not elsewhere)', () => {
  let g = game();
  mana(g, 0, 2);
  setController(g, 0, 0);
  put(g, 0, 'rad-017-167', 0);
  const dkHere = put(g, 0, 'ts-dk', 0);
  let hand = handSize(g, 0);
  g = run(play(g, 0, handCard(g, 0, 'ts-bolt')));
  assert.equal(zoneOf(g, dkHere), 'trash');
  assert.equal(handSize(g, 0), hand + 2, 'Deathknell: draw 1, twice');
  setController(g, 1, 0);
  const dkAway = put(g, 0, 'ts-dk', 1);
  hand = handSize(g, 0);
  g = run(play(g, 0, handCard(g, 0, 'ts-bolt')));
  assert.equal(handSize(g, 0), hand + 1, 'not here: once');
});

test('Detonation Amplifier: declining keeps the unit', () => {
  let g = game();
  mana(g, 0, 4, 'Chaos');
  const fodder = put(g, 0, 't-u1', 'base');
  g = run(playNew(g, 0, 'rad-017-167', { destination: 0 })[0], 'no');
  assert.equal(zoneOf(g, fodder), 'base');
});

test('Blossoming Dreamroot: when you win a combat here, draw 1', () => {
  let g = game();
  setController(g, 0, 1);
  put(g, 0, 'rad-024-167', 0);
  put(g, 1, 't-u1', 0);
  const atk = put(g, 0, 't-u5', 'base');
  const hand = handSize(g, 0);
  g = run(act(g, { type: 'move', player: 0, units: [atk], to: 0 }));
  assert.equal(g.battlefields[0].controller, 0, 'won and conquered');
  assert.equal(handSize(g, 0), hand + 1);
});

test('Hunting Blind: may move an enemy unit here; friendly units here have Shield 2', () => {
  let g = game();
  mana(g, 0, 4, 'Calm', 'Calm');
  const e = put(g, 1, 't-u3', 'base');
  put(g, 1, 't-u2', 'base');
  let hb: ObjId;
  [g, hb] = playNew(g, 0, 'rad-044-167', { destination: 1 });
  g = run(g, 'yes', e);
  assert.equal(g.objects[e].battlefieldIndex, 1);
  const mine = put(g, 0, 't-u2', 1);
  assert.equal(kwVal(g, mine, 'Shield'), 2);
  assert.ok(!hasKw(g, e, 'Shield'));
  void hb;
});

test('Gravity Field: an opponent must pay [1][A] to move units there (once per move); unaffordable moves are illegal', () => {
  let g = game();
  mana(g, 0, 5, 'Calm');
  const gf = put(g, 0, 'rad-062-167', 1);
  g = endTurn(g);
  clearRunes(g, 1);
  const a = put(g, 1, 't-u1', 'base'), b = put(g, 1, 't-u2', 'base');
  // can't pay: the move isn't legal (engine moveCost rule, B2-2)
  assert.ok(!canMove(g, 1, a, 1));
  assert.ok(canMove(g, 1, a, 0), 'other battlefields are unaffected');
  // pays once for both units
  mana(g, 1, 2);
  assert.ok(canMove(g, 1, a, 1));
  // declining cancels the move
  let h = act(g, { type: 'move', player: 1, units: [a, b], to: 1 });
  expectDecision(h, 'optional', 1);
  h = run(h, 'no');
  assert.equal(zoneOf(h, a), 'base');
  assert.equal(h.objects[a].exhausted, false, 'the whole move was undone');
  h = run(act(g, { type: 'move', player: 1, units: [a, b], to: 1 }), 'yes');
  assert.equal(h.objects[a].battlefieldIndex, 1);
  assert.equal(h.objects[b].battlefieldIndex, 1);
  // one rune exhausted for [1] and recycled for [A]: paid exactly once for both units
  assert.equal(h.players[1].runesInPlay.length, 1);
  assert.equal(h.players[1].runesInPlay.filter(r => !h.objects[r].exhausted).length, 1);
  void gf;
});

test('Gravity Field: own units move freely; Deathknell draws 1', () => {
  let g = game();
  mana(g, 0, 1);
  const gf = put(g, 0, 'rad-062-167', 1);
  const u = put(g, 0, 't-u2', 'base');
  g = run(act(g, { type: 'move', player: 0, units: [u], to: 1 }));
  assert.equal(g.objects[u].battlefieldIndex, 1);
  const mz = put(g, 0, 'ogn-113-298', 'base');
  const hand = handSize(g, 0);
  g = run(act(g, { type: 'activate', player: 0, obj: mz, abilityIndex: 0 }), gf);
  assert.equal(zoneOf(g, gf), 'trash');
  assert.equal(handSize(g, 0), hand + 1);
});

test('Pillaged Armory: buff a friendly unit when played and when you conquer here', () => {
  let g = game();
  mana(g, 0, 1, 'Calm');
  const u = put(g, 0, 't-u2', 'base');
  g = run(playNew(g, 0, 'rad-073-167', { destination: 0 })[0]);
  assert.equal(g.objects[u].counters.buff, 1);
  const v = put(g, 0, 't-u2', 'base');
  g = run(act(g, { type: 'move', player: 0, units: [v], to: 0 }), v);
  assert.equal(g.battlefields[0].controller, 0);
  assert.equal(g.objects[v].counters.buff, 1, 'conquer: buffed the unbuffed unit');
});

test('Portable Portal: may pay [C] to ready a unit here; friendly units here have Ganking', () => {
  let g = game();
  mana(g, 0, 2, 'Body', 'Body');
  setController(g, 0, 0);
  const u = put(g, 0, 't-u2', 0, { ready: false });
  g = run(playNew(g, 0, 'rad-087-167', { destination: 0 })[0], 'yes');
  assert.equal(g.objects[u].exhausted, false);
  assert.ok(hasKw(g, u, 'Ganking'));
  assert.ok(canMove(g, 0, u, 1), 'Ganking: battlefield to battlefield');
});

test('The Good Stuff: discard 1 then draw 3; when you hold here, return it to hand', () => {
  let g = game();
  mana(g, 0, 3, 'Chaos');      // The Good Stuff is Chaos
  setController(g, 0, 0);
  put(g, 0, 't-u2', 0);
  const junk = handCard(g, 0, 't-u1');
  let gs: ObjId;
  [g, gs] = playNew(g, 0, 'rad-106-167', { destination: 0 });
  g = run(g);
  assert.equal(zoneOf(g, junk), 'trash');
  assert.equal(handSize(g, 0), 3);
  g = endTurn(endTurn(g));
  assert.equal(zoneOf(g, gs), 'hand', 'held: returned to hand');
});

test('Bushwhack Trap: while you control this battlefield you may hide an additional card here', () => {
  let g = game();
  mana(g, 0, 3);
  setController(g, 0, 0);
  put(g, 0, 't-u2', 0);
  put(g, 0, 'rad-108-167', 0);
  const h1 = handCard(g, 0, 't-hidden'), h2 = handCard(g, 0, 't-hidden');
  g = run(act(g, { type: 'hide', player: 0, obj: h1, battlefieldIndex: 0 }));
  assert.ok(getLegalActions(g, 0).some(a => a.type === 'hide' && a.obj === h2 && a.battlefieldIndex === 0), 'a second card may be hidden here');
  g = run(act(g, { type: 'hide', player: 0, obj: h2, battlefieldIndex: 0 }));
  assert.equal(zoneOf(g, h2), 'facedown');
  assert.ok(!getLegalActions(g, 0).some(a => a.type === 'hide' && a.battlefieldIndex === 0), 'no third');
});

test('Dockside Lock-Up: banishes a unit here on play; when you hold here, may kill it to play that card for free', () => {
  let g = game();
  mana(g, 0, 6, 'Order', 'Order');
  setController(g, 0, 0);
  const mine = put(g, 0, 't-u2', 0);
  const e = put(g, 1, 't-u5', 1);
  setController(g, 1, 1);
  let dl: ObjId;
  [g, dl] = playNew(g, 0, 'rad-136-167', { destination: 0 });
  g = run(g);                      // the only unit here is mine: auto-chosen (mandatory)
  assert.equal(zoneOf(g, mine), 'banishment');
  void e; void dl;
});

test('Dockside Lock-Up: hold -> kill it to play the banished enemy unit under your control, ignoring its cost', () => {
  let g = game();
  mana(g, 0, 6, 'Order', 'Order');
  setController(g, 0, 0);
  put(g, 0, 't-u2', 0);
  const e = put(g, 1, 't-u5', 0);
  let dl: ObjId;
  [g, dl] = playNew(g, 0, 'rad-136-167', { destination: 0 });
  g = run(g, e);
  assert.equal(zoneOf(g, e), 'banishment');
  g = endTurn(endTurn(g));
  // start of turn: hold trigger
  expectDecision(g, 'optional', 0);
  g = run(g, 'yes', 'base');
  assert.equal(zoneOf(g, dl), 'trash');
  assert.equal(zoneOf(g, e), 'base');
  assert.equal(g.objects[e].controller, 0);
});

test('The Ball: when played (and when moved), choose: draw 1, or deal 2 to enemy units here', () => {
  let g = game();
  mana(g, 0, 5, 'Calm');
  setController(g, 1, 1);
  const e1 = put(g, 1, 't-u2', 1), e2 = put(g, 1, 't-u3', 1);
  let ball: ObjId;
  [g, ball] = playNew(g, 0, 'rad-146-167', { destination: 1 });
  g = run(g);
  // R-1 (CR 403.2): the mode is chosen as the trigger goes on the chain (the trigger is not on the chain yet)
  assert.deepEqual(expectDecision(g, 'chooseMode', 0).sort(), ['deal', 'draw']);
  assert.equal(g.chain.filter(c => !c.pending).length, 0);
  g = act(g, { type: 'choose', player: 0, optionIds: ['deal'] });
  assert.equal(zoneOf(g, e1), 'battlefield', 'dealt on resolution');
  g = run(g);
  assert.equal(zoneOf(g, e1), 'trash');
  assert.equal(g.objects[e2].damage, 2);
  assert.ok(hasKw(g, ball, 'Ganking'));
  atMain(g);
});

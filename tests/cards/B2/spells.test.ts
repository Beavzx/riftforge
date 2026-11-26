// B2: spells, the Grandmaster at Arms legend and the Veiled Temple battlefield.
import { test } from 'node:test';
import {
  game, mana, run, play, put, handCard, zoneOf, assert, expectDecision, atMain, setController, handSize, m, act, attachNow,
  activate, canActivate, canPlay, setBattlefieldCard, hasKw, getLegalActions,
} from './util.ts';
import type { GameState } from '../../../src/engine/types.ts';

const endTurn = (g: GameState) => run(act(g, { type: 'endTurn', player: g.pending!.player }));

test('Angle Shot (Reaction): attach an Equipment to a unit with the same controller, then draw 1', () => {
  let g = game();
  mana(g, 0, 2);
  const u = put(g, 0, 't-u2', 'base');
  const eq = put(g, 0, 'sfd-161-221', 'base');
  const enemyU = put(g, 1, 't-u3', 'base');
  const enemyEq = put(g, 1, 'sfd-095-221', 'base');
  const hand = handSize(g, 0);
  g = play(g, 0, handCard(g, 0, 'sfd-011-221'));
  assert.deepEqual(expectDecision(g, 'chooseTargets', 0).sort(), [u, enemyU].sort());
  g = run(g, u);                        // the Equipment choice is then limited to the same controller: only eq (auto)
  assert.equal(g.objects[eq].attachedTo, u);
  assert.equal(handSize(g, 0), hand + 1);
  assert.equal(g.objects[enemyEq].attachedTo, undefined);
});

test('Angle Shot: detach an attached Equipment from that unit; works on enemy pairs too', () => {
  let g = game();
  mana(g, 0, 4);
  const eu = put(g, 1, 't-u3', 'base');
  const eq1 = put(g, 1, 'sfd-095-221', 'base');
  const eq2 = put(g, 1, 'sfd-161-221', 'base');
  attachNow(g, eq1, eu);
  put(g, 0, 't-u2', 'base');
  g = play(g, 0, handCard(g, 0, 'sfd-011-221'));
  // player 0's unit has no Equipment with the same controller, so the enemy unit is the only legal unit (auto)
  assert.deepEqual(expectDecision(g, 'chooseTargets', 0).sort(), [eq1, eq2].sort(), 'Equipment with the same controller');
  g = run(g, eq1);
  assert.equal(g.objects[eq1].attachedTo, undefined, 'detached');
  assert.equal(m(g, eu), 3);
});

test('Strike Down: an equipped friendly unit deals its Might to an enemy unit, then detach an Equipment from it', () => {
  let g = game();
  mana(g, 0, 3, 'Body');
  const u = put(g, 0, 't-u2', 'base');
  const sw = put(g, 0, 'sfd-161-221', 'base');
  attachNow(g, sw, u);
  put(g, 0, 't-u1', 'base');                    // not equipped: not a legal first choice
  const e = put(g, 1, 't-u5', 'base');
  assert.ok(canPlay(g, 0, handCard(g, 0, 'ts-pump')));
  const sd = handCard(g, 0, 'sfd-107-221');
  g = run(play(g, 0, sd));                       // both choices have a single legal option
  assert.equal(zoneOf(g, e), 'trash', '5 damage from a 5-Might unit');
  assert.equal(g.objects[sw].attachedTo, undefined);
  assert.equal(m(g, u), 2);
});

test('Strike Down: needs an equipped friendly unit', () => {
  const g = game();
  mana(g, 0, 3, 'Body');
  put(g, 0, 't-u2', 'base');
  put(g, 1, 't-u5', 'base');
  assert.ok(!canPlay(g, 0, handCard(g, 0, 'sfd-107-221')));
});

test('Relentless Pursuit: move a friendly unit, may attach an Equipment, and it gains "When I conquer, you may move me to my base" this turn', () => {
  let g = game();
  mana(g, 0, 2, 'Body');
  const u = put(g, 0, 't-u2', 'base');
  const sw = put(g, 0, 'sfd-161-221', 'base');
  put(g, 1, 'sfd-033-221', 'base');              // enemy Equipment: not offered
  g = play(g, 0, handCard(g, 0, 'sfd-184-221'));
  g = run(g);
  // RULINGS (CR 355.5): the Equipment is chosen as the spell is played
  assert.deepEqual(expectDecision(g, 'chooseTargets', 0), [sw]);
  g = run(g, sw);
  const dests = expectDecision(g, 'chooseDestination', 0);
  assert.deepEqual(dests.sort(), ['0', '1']);
  g = run(g, '0');
  assert.equal(g.objects[sw].attachedTo, u);
  // it was moved into an empty battlefield: showdown -> conquer -> the granted trigger
  expectDecision(g, 'optional', 0);
  g = run(g, 'yes');
  assert.equal(g.players[0].points, 1, 'conquered');
  assert.equal(zoneOf(g, u), 'base', 'moved back to base');
  assert.equal(g.objects[sw].attachedTo, u, 'the Equipment came along');
});

test('Relentless Pursuit: the granted ability lasts only this turn', () => {
  let g = game();
  mana(g, 0, 2, 'Body');
  const u = put(g, 0, 't-u2', 'base');
  g = run(play(g, 0, handCard(g, 0, 'sfd-184-221')), '1');
  g = run(g, 'no');
  assert.equal(g.objects[u].battlefieldIndex, 1);
  g = endTurn(endTurn(g));
  assert.ok(!g.objects[u].modifiers.some(x => x.grants?.length), 'expired');
});

test('Dragon Form: a unit\'s base Might becomes 5 this turn (modifiers still apply); Flow from trash', () => {
  let g = game();
  mana(g, 0, 6);
  const u = put(g, 0, 't-u1', 'base');
  g = run(play(g, 0, handCard(g, 0, 'ts-pump')));
  assert.equal(m(g, u), 3);
  g = run(play(g, 0, handCard(g, 0, 'ven-116-166')));
  assert.equal(m(g, u), 7, 'base 5 + 2');
  g = endTurn(endTurn(g));
  assert.equal(m(g, u), 1);
  const df = put(g, 0, 'ven-116-166', 'trash');
  mana(g, 0, 3);
  assert.ok(canPlay(g, 0, df), '[Flow] [3]');
  g = run(play(g, 0, df));
  assert.equal(zoneOf(g, df), 'banishment');
});

test('Grandmaster at Arms: [1], [T]: attach a detached Equipment you control to a unit you control', () => {
  let g = game();
  mana(g, 0, 1);
  const leg = g.players[0].legend;
  g.objects[leg].cardId = 'sfd-193-221';
  const u = put(g, 0, 't-u2', 'base');
  const sw = put(g, 0, 'sfd-161-221', 'base');
  g = run(activate(g, 0, leg, 0));
  assert.equal(g.objects[sw].attachedTo, u);
  assert.equal(g.objects[leg].exhausted, true);
  assert.equal(g.players[0].runesInPlay.filter(r => !g.objects[r].exhausted).length, 0);
});

test('Grandmaster at Arms: [T]: move an attached Equipment you control to another unit you control', () => {
  let g = game();
  const leg = g.players[0].legend;
  g.objects[leg].cardId = 'sfd-193-221';
  const a = put(g, 0, 't-u2', 'base'), b = put(g, 0, 't-u3', 'base');
  const sw = put(g, 0, 'sfd-161-221', 'base');
  attachNow(g, sw, a);
  assert.ok(!canActivate(g, 0, leg, 0), 'no detached Equipment / no energy');
  g = run(activate(g, 0, leg, 1), b);
  assert.equal(g.objects[sw].attachedTo, b);
  assert.equal(m(g, a), 2);
  assert.equal(m(g, b), 6);
});

test('Veiled Temple: when you conquer here, you may ready a friendly gear and detach it if it is an Equipment', () => {
  let g = game();
  setBattlefieldCard(g, 0, 'sfd-221-221');
  const u = put(g, 0, 't-u2', 'base');
  const sw = put(g, 0, 'sfd-161-221', 'base');
  attachNow(g, sw, u);
  g.objects[sw].exhausted = true;
  put(g, 0, 'ogn-098-298', 'base', { ready: false });
  g = act(g, { type: 'move', player: 0, units: [u], to: 0 });
  g = run(g);
  const opts = expectDecision(g, 'chooseTargets', 0);
  assert.equal(opts.length, 2);
  g = run(g, sw, 'yes');
  assert.equal(g.objects[sw].exhausted, false);
  assert.equal(g.objects[sw].attachedTo, undefined);
});

test('Veiled Temple: the conquering player makes the choices, even on the opponent\'s battlefield', () => {
  let g = game();
  const bfOwner = g.objects[g.battlefields[0].objId].controller;
  setBattlefieldCard(g, 0, 'sfd-221-221');
  g = endTurn(g);
  const p = (1 - bfOwner) as 0 | 1;
  if (g.pending!.player !== p) g = endTurn(g);
  const conqueror = g.pending!.player;
  const u = put(g, conqueror, 't-u2', 'base');
  const gear = put(g, conqueror, 'ogn-098-298', 'base', { ready: false });
  g = run(act(g, { type: 'move', player: conqueror, units: [u], to: 0 }));
  expectDecision(g, 'chooseTargets', conqueror);
  g = run(g, gear);
  assert.equal(g.objects[gear].exhausted, false);
  atMain(g, conqueror);
  void hasKw; void getLegalActions;
});

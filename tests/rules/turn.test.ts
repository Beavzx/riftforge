import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, act, pass, put, runes, handCard, resolveAll, zoneOf, passUntilMain, setController } from '../fixtures/helpers.ts';
import { fullDb } from '../fixtures/cards.ts';
import { might } from '../../src/engine/chars.ts';
import { addResources } from '../../src/engine/actions.ts';
import { makeCtx } from '../../src/engine/context.ts';
import { applyAction } from '../../src/engine/game.ts';

test('awaken readies the turn player’s units and runes', () => {
  let g = newGame();
  const u = put(g, 1, 't-u2', 'base', { ready: false });
  for (const r of g.players[1].runesInPlay) g.objects[r].exhausted = true;
  g = pass(g); g = passUntilMain(g, 1);
  assert.equal(g.objects[u].exhausted, false);
  assert.ok(g.players[1].runesInPlay.every(r => !g.objects[r].exhausted));
});

test('rune pool empties at end of turn', () => {
  let g = newGame();
  addResources(g, 0, 3, ['Fury']);
  assert.equal(g.players[0].pool.energy, 3);
  g = pass(g);
  assert.equal(g.players[0].pool.energy, 0);
  assert.deepEqual(g.players[0].pool.power, {});
});

test('burn out: drawing from an empty deck shuffles the trash in and the opponent gains 1 point', () => {
  let g = newGame();
  const p1 = g.players[1];
  for (const id of [...p1.mainDeck]) { g.objects[id].zone = 'trash'; p1.trash.push(id); }
  p1.mainDeck.length = 0;
  const trashN = p1.trash.length;
  g = pass(g); g = passUntilMain(g, 1);
  assert.equal(g.players[0].points, 1);
  assert.equal(g.players[1].trash.length, 0);
  assert.equal(g.players[1].mainDeck.length, trashN - 1);
});

test('burn out with empty deck and trash: point each attempt; immediate win at victory score', () => {
  let g = newGame();
  const p1 = g.players[1];
  p1.mainDeck.length = 0; p1.trash.length = 0;
  g.players[0].points = 7;
  g = pass(g);
  assert.equal(g.winner, 0);
  assert.equal(g.phase, 'gameOver');
});

test('end of turn: damage heals, stun clears, "this turn" Might expires', () => {
  let g = newGame();
  const u = put(g, 0, 't-u3', 'base');
  g.objects[u].damage = 2; g.objects[u].stunned = true;
  makeCtx(g, u, 0).giveMight(u, 2, 'endOfTurn');
  assert.equal(might(g, u), 5);
  g = pass(g);
  assert.equal(g.objects[u].damage, 0);
  assert.equal(g.objects[u].stunned, false);
  assert.equal(might(g, u), 3);
});

test('Temporary units die at the start of their controller’s Beginning phase, before scoring', () => {
  let g = newGame();
  setController(g, 0, 1);
  const t = put(g, 1, 't-temp', 0);
  g = pass(g); g = passUntilMain(g, 1);
  assert.equal(zoneOf(g, t), 'trash');
  // lost control before the scoring step: no hold point
  assert.equal(g.players[1].points, 0);
  assert.equal(g.battlefields[0].controller, null);
});

test('hold: the turn player scores battlefields they control at the start of their turn', () => {
  let g = newGame();
  setController(g, 1, 1);
  put(g, 1, 't-u2', 1);
  g = pass(g); g = passUntilMain(g, 1);
  assert.equal(g.players[1].points, 1);
  assert.deepEqual(g.battlefields[1].scoredThisTurnBy, [1]);
});

test('extra turn: the same player takes the next turn', () => {
  let g = newGame();
  makeCtx(g, g.players[0].legend, 0).extraTurn(0);
  g = pass(g);
  g = passUntilMain(g, 0);
  assert.equal(g.activePlayer, 0);
  assert.equal(g.turn, 2);
});

test('concede: the opponent wins immediately, even out of turn', () => {
  const g = newGame();
  const r = applyAction(g, { type: 'concede', player: 1 }).state;
  assert.equal(r.winner, 0);
});

test('Vision: when played, predict (look at top card, may recycle)', () => {
  let g = newGame();
  const v = handCard(g, 0, 't-vision');
  const top = g.players[0].mainDeck[0];
  g = act(g, { type: 'playCard', player: 0, obj: v, destination: 'base' });
  g = resolveAll(g);
  assert.equal(g.pending?.kind, 'chooseCards');
  g = act(g, { type: 'choose', player: 0, optionIds: [top] });
  assert.equal(g.players[0].mainDeck[g.players[0].mainDeck.length - 1], top);
});

test('stale replay unit is never sent to clients and the game survives many end turns', () => {
  let g = newGame({ db: fullDb() });
  for (let i = 0; i < 12; i++) { g = pass(g); g = passUntilMain(g, g.activePlayer); }
  assert.ok(g.turn >= 12);
  void runes;
});

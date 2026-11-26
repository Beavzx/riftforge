import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, act, pass, passUntilMain } from '../fixtures/helpers.ts';
import { getLegalActions } from '../../src/engine/game.ts';

test('game starts at first player main phase with 4 cards drawn + 1', () => {
  const g = newGame();
  assert.equal(g.pending?.kind, 'mainAction');
  assert.equal(g.pending?.player, 0);
  assert.equal(g.players[0].hand.length, 5);
  assert.equal(g.players[1].hand.length, 4);
  assert.equal(g.players[0].runesInPlay.length, 2);
  assert.equal(g.battlefields.length, 2);
});

test('end turn passes to the other player who channels 3', () => {
  let g = newGame();
  g = pass(g);
  g = passUntilMain(g, 1);
  assert.equal(g.activePlayer, 1);
  assert.equal(g.players[1].runesInPlay.length, 3);
  assert.equal(g.players[1].hand.length, 5);
  const legal = getLegalActions(g, 1);
  assert.ok(legal.length > 1);
});

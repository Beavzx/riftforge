// BASICS findings (docs/basics-findings.md): one named scenario per rules bug the matrix found, through the public API.
import { test } from 'node:test';
import { assert, P0, P1, act, getLegalActions } from '../conformance/harness.ts';
import { momentBase } from './matrix.ts';

test('BX-1 (CR 347.2.a, 346.1): an Add ability used in an open showdown restarts the passes in succession; focus stays', () => {
  // P0 moved to an empty battlefield, played an Action, it resolved, P1 passed: P0 has focus and P0's pass would end it
  let g = structuredClone(momentBase('showdownLast').g);
  assert.deepEqual(g.showdown!.passes, [P1]);
  g = act(g, { type: 'activate', player: P0, obj: g.players[P0].runesInPlay[0], abilityIndex: 950 });
  assert.equal(g.showdown!.focus, P0, 'focus does not pass after an Add ability (CR 346.1)');
  assert.deepEqual(g.showdown!.passes, [], 'doing something: the earlier pass no longer counts');
  assert.equal(g.players[P0].pool.energy, 1);
  g = act(g, { type: 'pass', player: P0 });
  assert.ok(g.showdown, 'the showdown goes on: P1 gets focus again');
  assert.equal(g.pending?.kind, 'showdownAction');
  assert.equal(g.pending?.player, P1);
  assert.ok(getLegalActions(g, P1).some(a => a.type === 'pass'));
  g = act(g, { type: 'pass', player: P1 });
  assert.equal(g.showdown, null, 'now both passed in succession: the showdown ends');
});

test('BX-1b: the same on the opponent\'s turn (P1 moved, P1 passed, P0 taps a rune for energy, then passes)', () => {
  let g = structuredClone(momentBase('oppShowdownFocus').g);
  g = act(g, { type: 'activate', player: P0, obj: g.players[P0].runesInPlay[0], abilityIndex: 951 });
  assert.equal(g.showdown!.focus, P0);
  g = act(g, { type: 'pass', player: P0 });
  assert.ok(g.showdown && g.pending?.player === P1, 'P1 gets focus again before the showdown ends');
});

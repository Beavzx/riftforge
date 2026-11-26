// B2: behaviours that need engine/DSL support (see docs/dsl-requests.md, section B2). Scripted as far as possible.
import { test } from 'node:test';
import { game, mana, run, put, assert, activate, EQUIP, m, act, attachNow, canMove, clearRunes } from './util.ts';
import { chars } from '../../../src/engine/chars.ts';

test('Shady Spectacles: the equipped unit takes the copied unit\'s Might', () => {
  let g = game();
  mana(g, 0, 1, 'Order');
  const u = put(g, 0, 't-u1', 'base');
  const model = put(g, 0, 't-u5', 'base');
  const ss = put(g, 0, 'ven-137-166', 'base');
  g = run(activate(g, 0, ss, EQUIP), u);
  assert.equal(chars(g, u).name, chars(g, model).name);
  assert.equal(m(g, u), 5);
});

test('Svellsongur: copied static abilities apply twice (Ornn: +2 Might per friendly gear)', () => {
  const g = game();
  const ornn = put(g, 0, 'sfd-085-221', 'base');
  const sv = put(g, 0, 'sfd-059-221', 'base');
  attachNow(g, sv, ornn);
  // 1 friendly gear (Svellsongur itself): 4 + 1 (own text) + 1 (copied text)
  assert.equal(m(g, ornn), 6);
});

test('Gravity Field: an unaffordable move to it is not offered as a legal action', () => {
  let g = game();
  put(g, 0, 'rad-062-167', 1);
  g = run(act(g, { type: 'endTurn', player: 0 }));
  clearRunes(g, 1);
  const a = put(g, 1, 't-u1', 'base');
  assert.ok(!canMove(g, 1, a, 1));
});

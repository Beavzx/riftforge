// META-AUDIT: MS-5 — Switcheroo ("two units at the same battlefield") with no valid pair / with too many options.
import { test } from 'node:test';
import { game, mana, run, play, canPlay, put, handCard, assert, M, getLegalActions, noRunes } from '../B3/util.ts';

const SWITCHEROO = 'sfd-145-221';

test('MS-5a: Switcheroo is not playable when no battlefield has two units', () => {
  const g = game();
  noRunes(g, 0);
  mana(g, 0, 2, 'Chaos', 'Chaos');
  put(g, 1, 't-u2', 0);
  put(g, 1, 't-u5', 1);
  const s = handCard(g, 0, SWITCHEROO);
  assert.equal(canPlay(g, 0, s), false, 'one unit per battlefield: no pair to swap');
  put(g, 1, 't-u4', 0);
  assert.equal(canPlay(g, 0, s), true, 'a pair at battlefield 0');
});

test('MS-5a: only units that have a partner at their battlefield are offered', () => {
  let g = game();
  noRunes(g, 0);
  mana(g, 0, 2, 'Chaos', 'Chaos');
  const a = put(g, 1, 't-u2', 0), b = put(g, 1, 't-u5', 0);
  const lone = put(g, 1, 't-u4', 1);
  g = play(g, 0, handCard(g, 0, SWITCHEROO));
  // the only valid pair is chosen automatically (the lone unit at battlefield 1 is not an option)
  assert.notEqual(g.pending!.kind, 'chooseTargets');
  g = run(g);
  assert.equal(M(g, a), 5);
  assert.equal(M(g, b), 2);
});

test('MS-5b: with more options than the enumeration cap, getLegalActions still lists same-battlefield pairs', () => {
  let g = game();
  noRunes(g, 0);
  mana(g, 0, 2, 'Chaos', 'Chaos');
  // 7 units at each battlefield: C(14,2) = 91 > 64 combinations, "first k" would mix battlefields only if ordered so
  for (let i = 0; i < 7; i++) { put(g, 1, 't-u2', 0); put(g, 1, 't-u3', 1); }
  g = play(g, 0, handCard(g, 0, SWITCHEROO));
  assert.equal(g.pending!.kind, 'chooseTargets');
  const legal = getLegalActions(g, 0);
  assert.ok(legal.length > 0, 'a valid pair is enumerated');
  assert.ok(legal.some(a => a.type === 'choose' && a.optionIds.length === 2), 'pairs, not singletons');
});

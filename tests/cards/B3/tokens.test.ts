// B3: token definitions, token-making basics, script text coverage.
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { getScript } from '../../../src/cards/registry.ts';
import { game, mana, run, expectDecision, play, tokens, tokensAt, put, handCard, zoneOf, setController, assert, real, M, kw, noRunes, getLegalActions, canPlay, act } from './util.ts';

const batches = JSON.parse(readFileSync(new URL('../../../data/card-batches.json', import.meta.url), 'utf8'));
const B3: string[] = batches.batches[2].cards.map((c: { id: string } | string) => (typeof c === 'string' ? c : c.id));

test('every B3 card has a script whose text equals cards.json text', () => {
  assert.equal(B3.length, 130);
  for (const id of B3) {
    const s = getScript(id);
    assert.ok(s, `missing script for ${id}`);
    assert.equal(s!.text, real[id].text, `text mismatch for ${id}`);
  }
  assert.equal(getScript('unl-t05')?.text, real['unl-t05'].text);
});

test('Gold token: kill this, exhaust: add [A] — pays a power cost mid-payment and ceases to exist', () => {
  let g = game();
  noRunes(g, 0);
  const gold = put(g, 0, 'unl-t05', 'base');
  g.objects[gold].isToken = true;
  mana(g, 0, 2);
  const calm = handCard(g, 0, 't-calm2'); // 2 energy + Calm power
  assert.ok(canPlay(g, 0, calm), 'Gold pays the Calm power');
  g = play(g, 0, calm, { destination: 'base' });
  assert.equal(zoneOf(g, gold), 'gone', 'token ceased to exist');
  assert.equal(zoneOf(g, calm), 'base');
});

test('Gold token: exhausted Gold cannot pay', () => {
  const g = game();
  noRunes(g, 0);
  const gold = put(g, 0, 'unl-t05', 'base', { ready: false });
  g.objects[gold].isToken = true;
  mana(g, 0, 2);
  const calm = handCard(g, 0, 't-calm2');
  assert.ok(!canPlay(g, 0, calm));
});

test('Faithful Manufactor: play a 1 Might Recruit here (exhausted, Recruit tag)', () => {
  let g = game();
  setController(g, 0, 0);
  mana(g, 0, 3);
  const c = handCard(g, 0, 'ogn-211-298');
  g = play(g, 0, c, { destination: 0 });
  g = run(g);
  const r = tokensAt(g, 0, 'Recruit', 0);
  assert.equal(r.length, 1);
  assert.equal(M(g, r[0]), 1);
  assert.equal(g.objects[r[0]].exhausted, true);
  assert.ok(g.objects[r[0]].isToken);
});

test('Recruit the Vanguard: four Recruits, each to a location of your choice (base or a battlefield you control)', () => {
  let g = game();
  setController(g, 0, 0);
  mana(g, 0, 6);
  const s = handCard(g, 0, 'ogs-015-024');
  assert.ok(kw(g, s, 'Action'));
  g = play(g, 0, s);
  g = run(g);
  const opts = expectDecision(g, 'chooseDestination', 0);
  assert.deepEqual(opts.sort(), ['0', 'base']);
  g = run(g, 'base', '0', '0', 'base');
  assert.equal(tokensAt(g, 0, 'Recruit', 'base').length, 2);
  assert.equal(tokensAt(g, 0, 'Recruit', 0).length, 2);
});

test('Recruit the Vanguard: with no controlled battlefield all four go to base without asking', () => {
  let g = game();
  mana(g, 0, 6);
  g = play(g, 0, handCard(g, 0, 'ogs-015-024'));
  g = run(g);
  assert.equal(g.pending?.kind, 'mainAction');
  assert.equal(tokensAt(g, 0, 'Recruit', 'base').length, 4);
});

test('Sprite Call: a ready 3 Might Sprite with Temporary; it dies at the start of your next Beginning Phase', () => {
  let g = game();
  mana(g, 0, 3);
  g = play(g, 0, handCard(g, 0, 'ogn-094-298'));
  g = run(g);
  const [s] = tokens(g, 0, 'Sprite');
  assert.ok(s);
  assert.equal(g.objects[s].exhausted, false);
  assert.equal(M(g, s), 3);
  assert.ok(kw(g, s, 'Temporary'));
  g = act(g, { type: 'endTurn', player: 0 });
  g = run(g);
  assert.equal(zoneOf(g, s), 'base', 'survives the opponent turn');
  g = act(g, { type: 'endTurn', player: 1 });
  g = run(g);
  assert.equal(zoneOf(g, s), 'gone', 'killed at the start of my Beginning Phase');
});

test('tokens do not satisfy Legion (Vanguard Captain): only a played card does', () => {
  let g = game();
  setController(g, 0, 0);
  put(g, 0, 't-u1', 0); // keeps control of battlefield 0 through cleanups
  mana(g, 0, 6, 'Order');
  g = play(g, 0, handCard(g, 0, 'ogn-094-298')); // spell: a card -> enables Legion
  g = run(g, 'base');
  const vc = handCard(g, 0, 'ogn-218-298');
  g = play(g, 0, vc, { destination: 0 });
  g = run(g);
  assert.equal(tokensAt(g, 0, 'Recruit', 0).length, 2, 'Legion on: two Recruits here');

  let h = game();
  setController(h, 0, 0);
  mana(h, 0, 3, 'Order');
  const vc2 = handCard(h, 0, 'ogn-218-298');
  // a token played this turn (Sprite) is not a card
  const leg = getLegalActions(h, 0);
  void leg;
  h.ex.playedThisTurn[0] = [put(h, 0, 'unl-t07', 'base')];
  h.objects[h.ex.playedThisTurn[0][0]].isToken = true;
  h = play(h, 0, vc2, { destination: 0 });
  h = run(h);
  assert.equal(tokens(h, 0, 'Recruit').length, 0, 'a played token does not enable Legion');
});

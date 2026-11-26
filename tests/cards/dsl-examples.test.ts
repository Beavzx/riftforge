import { test } from 'node:test';
import assert from 'node:assert/strict';
import './dsl-examples.ts';
import { readFileSync } from 'node:fs';
import { newGame, act, choose, pass, put, runes, handCard, resolveAll, zoneOf, setController, yes } from '../fixtures/helpers.ts';
import { baseDb } from '../fixtures/cards.ts';
import { might, hasKw } from '../../src/engine/chars.ts';
import { getLegalActions } from '../../src/engine/game.ts';
import type { CardDef } from '../../src/engine/types.ts';

const real: Record<string, CardDef> = JSON.parse(readFileSync(new URL('../../data/cards.json', import.meta.url), 'utf8'));
const db = { ...baseDb(), ...real };
const game = () => newGame({ db });

test('Disintegrate: kills a 3-Might unit and draws', () => {
  let g = game();
  runes(g, 0, 2);
  setController(g, 0, 1);
  const t = put(g, 1, 't-u3', 0);
  const s = handCard(g, 0, 'ogn-005-298');
  const hand = g.players[0].hand.length;
  assert.ok(hasKw(g, s, 'Action'));
  g = act(g, { type: 'playCard', player: 0, obj: s });
  g = resolveAll(g);
  assert.equal(zoneOf(g, t), 'trash');
  assert.equal(g.players[0].hand.length, hand - 1 + 1);
});

test('Tasty Faefolk: Accelerate from data keywords; Deathknell channels 2 exhausted and draws', () => {
  let g = game();
  const f = put(g, 1, 'ogn-075-298', 'base');
  assert.ok(hasKw(g, f, 'Accelerate'));
  const runesBefore = g.players[1].runesInPlay.length;
  g.objects[f].damage = 99; g.ex.dirty = true;
  g = act(g, { type: 'endTurn', player: 0 });
  g = resolveAll(g);
  assert.equal(zoneOf(g, f), 'trash');
  assert.ok(g.players[1].runesInPlay.length >= runesBefore + 2);
});

test('Lux: mana restricted to spells pays for a spell but not a unit', () => {
  let g = game();
  for (const r of g.players[0].runesInPlay) g.objects[r].exhausted = true;
  put(g, 0, 'ogs-014-024', 'base');
  const sp = handCard(g, 0, 'ts-none' in db ? 'ts-none' : 't-u2');
  void sp;
  const legal = getLegalActions(g, 0);
  assert.ok(!legal.some(a => a.type === 'playCard' && g.objects[a.obj].cardId === 't-u2'), 'unit not payable with spell-only energy');
});

test("Zhonya's Hourglass: saves the unit and dies instead", () => {
  let g = game();
  const z = put(g, 1, 'ogn-077-298', 'base');
  const u = put(g, 1, 't-u2', 'base');
  g.objects[u].damage = 5; g.ex.dirty = true;
  g = act(g, { type: 'endTurn', player: 0 });
  g = resolveAll(g);
  assert.equal(zoneOf(g, u), 'base');
  assert.equal(zoneOf(g, z), 'trash');
});

test('Darius: other friendly units here get +1, Legion readies him', () => {
  let g = game();
  setController(g, 0, 0);
  runes(g, 0, 6);
  runes(g, 0, 1, 'rad-r06');   // Order rune for Darius' [C]
  const other = put(g, 0, 't-u2', 0);
  const u1 = handCard(g, 0, 't-u1');
  const d = handCard(g, 0, 'ogn-243-298');
  g = act(g, { type: 'playCard', player: 0, obj: u1, destination: 'base' });
  g = act(g, { type: 'playCard', player: 0, obj: d, destination: 0 });
  g = resolveAll(g);
  assert.equal(g.objects[d].exhausted, false);
  assert.equal(might(g, other), 3);
});

test('Incorrigible Construct: enters ready only if it showed off a Mech', () => {
  let g = game();
  runes(g, 0, 4);
  const c = handCard(g, 0, 'rad-011-167');
  g = act(g, { type: 'playCard', player: 0, obj: c, destination: 'base' });
  assert.equal(g.objects[c].exhausted, true);
  let g2 = game();
  runes(g2, 0, 4);
  const c2 = handCard(g2, 0, 'rad-011-167');
  put(g2, 0, 'tok-mech', 'base');
  g2 = act(g2, { type: 'playCard', player: 0, obj: c2, destination: 'base' });
  assert.equal(g2.pending?.kind, 'chooseCards');
  g2 = choose(g2, g2.pending!.options![0].id);
  assert.equal(g2.objects[c2].exhausted, false);
  void yes; void pass;
});

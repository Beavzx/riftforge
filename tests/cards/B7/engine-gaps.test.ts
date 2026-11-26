// B7 behaviours that touch engine limits. Tests marked todo need engine support (filed in docs/dsl-requests.md):
// each describes the correct behaviour and will pass once the hook exists.
import { test } from 'node:test';
import { game, mana, stack, play, drive, none, objOpt, put, zoneOf, act, endTurn, handCard, assert, pendingIs, setController, db } from './_util.ts';
import { card, spell, E } from '../../../src/cards/dsl.ts';
import { getLegalActions } from '../../../src/engine/game.ts';
type G = import('./_util.ts').GameState;
const canPlayNow = (g: G, p: number, id: string) => getLegalActions(g, p as 0 | 1).some(a => a.type === 'playCard' && a.obj === id);

// a test-only spell that reveals with the generic DSL effect (as other batches' cards do)
db['t-b7-reveal'] = { id: 't-b7-reveal', name: 'B7 Reveal Probe', type: 'Spell', supertypes: [], tags: [], domains: ['Fury'], energy: 0, power: 0, might: null, keywords: [], text: 'Reveal the top 2 cards of your Main Deck. You may put one into your hand.', set: 'test', rarity: 'Common' };
card('t-b7-reveal', 'Reveal the top 2 cards of your Main Deck. You may put one into your hand.', [spell(E.lookTop(2, { reveal: true, pick: 'hand', max: 1 }))]);

test('Nocturne: engine look effects (Vision / Predict) offer the banish-and-play option', () => {
  let g = game(); mana(g, 0, 1, 'Fury'); mana(g, 0, 1, 'Chaos');
  const [n] = stack(g, 0, 'ogn-194-298');
  g = play(g, 0, 't-vision', { dest: 'base' }).g;
  pendingIs(g, 'optional', 0);
  g = drive(g, 'yes', 'yes');
  assert.notEqual(zoneOf(g, n), 'mainDeck');
});

test('Void Hatchling: also applies to reveals made by generic DSL effects', () => {
  let g = game();
  put(g, 0, 'sfd-018-221', 'base');
  const [junk] = stack(g, 0, 't-u1', 't-u2', 't-u3');
  g = play(g, 0, 't-b7-reveal').g;
  pendingIs(g, 'chooseCards', 0);
  assert.equal(g.pending!.options!.length, 1, 'first a private look at the top card only');
  g = drive(g, objOpt(junk));
});

test('Last Caress: the next unit can be played to any battlefield even from face down', () => {
  let g = game(); mana(g, 0, 1, 'Chaos'); setController(g, 0, 0);
  put(g, 0, 't-u1', 0);
  const hid = handCard(g, 0, 't-hidden');
  g = act(g, { type: 'hide', player: 0, obj: hid, battlefieldIndex: 0 });
  g = endTurn(g); g = endTurn(g);
  mana(g, 0, 2, 'Chaos');
  g = play(g, 0, 'rad-154-167').g;
  g = drive(act(g, { type: 'playCard', player: 0, obj: hid, destination: 1 }));
  assert.equal(g.objects[hid].battlefieldIndex, 1);
});

test('Akali: the banished card can only be played until your next Ending Phase', () => {
  let g = game(); setController(g, 0, 0);
  const ak = put(g, 0, 'rad-015-167', 'base');
  g = drive(act(g, { type: 'move', player: 0, units: [ak], to: 0 }));
  const [top] = stack(g, 0, 't-u2');
  g.objects[ak].exhausted = false;
  g = drive(act(g, { type: 'move', player: 0, units: [ak], to: 'base' }));
  assert.equal(zoneOf(g, top), 'banishment');
  g = endTurn(g); g = endTurn(g);
  mana(g, 0, 2, 'Fury');
  assert.ok(!canPlayNow(g, 0, top));
});

test('Kennen: the Flow permission ends with the turn', () => {
  let g = game(); mana(g, 0, 8, 'Chaos');
  stack(g, 0, 't-u1', 't-u2');
  const r = play(g, 0, 'ven-113-166', { dest: 'base' });
  g = r.g;
  const sp = put(g, 0, 'ogn-183-298', 'trash');
  g.objects[r.id].exhausted = false;
  g = drive(act(g, { type: 'move', player: 0, units: [r.id], to: 0 }));
  g = endTurn(g); g = endTurn(g);
  mana(g, 0, 2, 'Chaos');
  assert.ok(!canPlayNow(g, 0, sp));
});

test('Jhin: a [4]-cost spell played from hiding (spent [0]) does not enable him', () => {
  let g = game(); mana(g, 0, 1, 'Mind'); setController(g, 0, 0);
  put(g, 0, 't-u1', 0);
  const cp = handCard(g, 0, 'ogn-083-298');
  g = act(g, { type: 'hide', player: 0, obj: cp, battlefieldIndex: 0 });
  g = endTurn(g); g = endTurn(g);
  g = drive(act(g, { type: 'playCard', player: 0, obj: cp }));
  for (const x of g.players[0].runesInPlay) g.objects[x].exhausted = false;
  const j = handCard(g, 0, 'unl-089-219');
  mana(g, 0, 1, 'Mind');
  assert.ok(!canPlayNow(g, 0, j));
  void none;
});

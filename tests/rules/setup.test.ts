import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, getView, getLegalActions } from '../../src/engine/game.ts';
import { validateDeck } from '../../src/engine/deck.ts';
import { baseDb, deck } from '../fixtures/cards.ts';
import { newGame, choose, pass, passUntilMain } from '../fixtures/helpers.ts';

const db = baseDb();

test('deck validation: fixture deck is legal', () => {
  assert.deepEqual(validateDeck(deck(), db), []);
});
test('deck validation: fewer than 40 cards (champion included)', () => {
  const d = deck(); d.main = d.main.slice(0, 38);
  assert.ok(validateDeck(d, db).some(p => p.code === 'main.size'));
});
test('deck validation: more than 3 copies of a name', () => {
  const d = deck(); d.main[0] = d.main[1] = d.main[2] = d.main[3] = 't-u1';
  assert.ok(validateDeck(d, db).some(p => p.code === 'copies'));
});
test('deck validation: card outside domain identity, champion tag mismatch, runes != 12, duplicate battlefields', () => {
  const d = deck({ runes: new Array(11).fill('t-rune-fury'), battlefields: ['t-bf1', 't-bf1', 't-bf2'] });
  const dd = { ...db, 't-mind': { ...db['t-u1'], id: 't-mind', name: 'Mindy', domains: ['Mind' as const] }, 't-champ2': { ...db['t-champ'], id: 't-champ2', tags: ['Other'] } };
  d.main[0] = 't-mind';
  d.champion = 't-champ2';
  const codes = validateDeck(d, dd).map(p => p.code);
  assert.ok(codes.includes('identity'));
  assert.ok(codes.includes('champion.tag'));
  assert.ok(codes.includes('runes.size'));
  assert.ok(codes.includes('battlefields.duplicate'));
});
test('deck validation: ban list only when enforced', () => {
  const d = deck();
  assert.deepEqual(validateDeck(d, db, { banlist: [] }), []);
  assert.ok(validateDeck(d, db, { banlist: ['Tester'] }).some(p => p.code === 'banned'));
});
test('createGame rejects illegal decks', () => {
  const d = deck(); d.main = d.main.slice(0, 10);
  assert.throws(() => createGame({ seed: 1, cardDb: db, players: [{ name: 'A', deck: d }, { name: 'B', deck: deck({}, 3) }] }));
});

test('setup: battlefield choice decisions (hidden), coin flip winner chooses to go first or second', () => {
  let g = createGame({ seed: 5, cardDb: db, players: [{ name: 'A', deck: deck() }, { name: 'B', deck: deck({}, 3) }] });
  assert.equal(g.pending?.kind, 'chooseBattlefield');
  assert.equal(g.pending?.player, 0);
  // the opponent's view shows no options
  assert.equal(getView(g, 1).pending?.options, undefined);
  // the chooser sees its own battlefield candidates
  const v0 = getView(g, 0);
  for (const o of g.pending!.options!) assert.notEqual(v0.state.objects[o.id].cardId, 'hidden');
  g = choose(g, g.pending!.options![1].id);
  assert.equal(g.pending?.kind, 'chooseBattlefield');
  assert.equal(g.pending?.player, 1);
  assert.equal(g.battlefields.length, 0, 'not revealed until both chose');
  g = choose(g, g.pending!.options![0].id);
  assert.equal(g.battlefields.length, 2);
  assert.equal(g.pending?.kind, 'chooseMode');
  const chooser = g.pending!.player;
  g = choose(g, 'second');
  assert.equal(g.firstPlayer, chooser === 0 ? 1 : 0);
  assert.equal(g.pending?.kind, 'mulligan');
  assert.equal(g.pending?.player, g.firstPlayer);
});

test('setup: previous loser chooses play order', () => {
  const g = createGame({ seed: 5, cardDb: db, battlefieldSelection: 'random', previousLoser: 1, players: [{ name: 'A', deck: deck() }, { name: 'B', deck: deck({}, 3) }] });
  assert.equal(g.pending?.kind, 'chooseMode');
  assert.equal(g.pending?.player, 1);
});

test('mulligan: replace up to two cards, set-aside cards go to the bottom', () => {
  let g = newGame({ mulligan: true });
  assert.equal(g.pending?.kind, 'mulligan');
  const hand = [...g.players[0].hand];
  assert.equal(hand.length, 4);
  g = choose(g, hand[0], hand[1]);
  const deckEnd = g.players[0].mainDeck.slice(-2);
  assert.deepEqual([...deckEnd].sort(), [hand[0], hand[1]].sort());
  assert.equal(g.players[0].hand.length, 4);
  assert.ok(!g.players[0].hand.includes(hand[0]));
  assert.equal(g.pending?.kind, 'mulligan');
  g = choose(g);                     // player 1 keeps
  assert.equal(g.pending?.kind, 'mainAction');
});

test('mulligan max is 2 cards', () => {
  const g = newGame({ mulligan: true });
  const hand = g.players[0].hand;
  assert.throws(() => applyAction(g, { type: 'choose', player: 0, optionIds: hand.slice(0, 3) }));
});

test('first turn: first player channels 2 and draws; second player channels 3 on their first turn only', () => {
  let g = newGame();
  assert.equal(g.players[0].runesInPlay.length, 2);
  assert.equal(g.players[0].hand.length, 5);
  g = pass(g); g = passUntilMain(g, 1);
  assert.equal(g.players[1].runesInPlay.length, 3);
  g = pass(g); g = passUntilMain(g, 0);
  assert.equal(g.players[0].runesInPlay.length, 4);
  g = pass(g); g = passUntilMain(g, 1);
  assert.equal(g.players[1].runesInPlay.length, 5);
});

test('getView hides opponent hand, deck order and engine internals', () => {
  const g = newGame();
  const v = getView(g, 1);
  // HIDDEN-IDS: hidden objects appear under opaque aliases, never their engine ids
  for (const id of g.players[0].hand) assert.equal(v.state.objects[id], undefined);
  assert.equal(v.state.players[0].hand.length, g.players[0].hand.length);
  for (const id of v.state.players[0].hand) assert.equal(v.state.objects[id].cardId, 'hidden');
  for (const id of g.players[1].hand) assert.notEqual(v.state.objects[id].cardId, 'hidden');
  for (const id of g.players[1].mainDeck) assert.equal(v.state.objects[id], undefined);
  for (const id of v.state.players[1].mainDeck) assert.equal(v.state.objects[id].cardId, 'hidden');
  assert.equal(v.state.seed, 0, 'the seed (which fixes every shuffle) is not shipped');
  assert.equal(v.state.ex.unit, null);
  assert.deepEqual(v.legal, []);
  assert.ok(getView(g, 0).legal.length > 0);
});
void getLegalActions;

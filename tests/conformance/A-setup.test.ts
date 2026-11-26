// docs/rules-tests.md §A — Setup and deck legality (T001-T012)
import { test } from 'node:test';
import { validateDeck } from '../../src/engine/index.ts';
import { fixtureDb } from '../fixtures/conformance/cards.ts';
import { assert, newGame, legalDeck, pend, choose, expectPending, S0, legal, P0, P1, getView, toMainOf, nextTurn, validateAction } from './harness.ts';

const db = fixtureDb();
const problems = (d: ReturnType<typeof legalDeck>) => validateDeck(d, db, { battlefields: 3 });
/** legal deck with some main-deck cards replaced */
function deckWith(cards: string[], o: Parameters<typeof legalDeck>[0] = {}) {
  const d = legalDeck(o);
  d.main = [...cards, ...d.main.slice(cards.length)];
  return d;
}

/** T001/T002 test the mulligan itself, not its order (T003): skip P1's mulligan if it comes first. */
function toP0Mulligan(g: ReturnType<typeof newGame>) {
  if (g.pending?.kind === 'mulligan' && g.pending.player === P1) g = choose(g);
  return g;
}

test('T001 — Opening hand size and mulligan of 2', () => {
  let g = toP0Mulligan(newGame({ mulligan: true, firstPlayer: P1 }));
  expectPending(g, 'mulligan', P0);
  const pl = () => g.players[0];
  assert.equal(pl().hand.length, 4);
  const deckBefore = pl().mainDeck.length;
  assert.equal(deckBefore, 39 - 4);
  const [c1, c2] = pl().hand;
  g = choose(g, c1, c2);
  assert.equal(pl().hand.length, 4);
  assert.ok(!pl().hand.includes(c1) && !pl().hand.includes(c2), 'mulliganed cards left the hand');
  assert.equal(pl().mainDeck.length, deckBefore, 'deck size unchanged');
  const bottom2 = pl().mainDeck.slice(-2);
  assert.deepEqual([...bottom2].sort(), [c1, c2].sort(), 'mulliganed cards are the bottom two cards');
});

test('T002 — Mulligan limit', () => {
  const g = toP0Mulligan(newGame({ mulligan: true, firstPlayer: P1 }));
  expectPending(g, 'mulligan', P0);
  const h = g.players[0].hand;
  assert.notEqual(validateAction(g, { type: 'choose', player: P0, optionIds: h.slice(0, 3) }), null, 'mulligan of 3 rejected');
  assert.equal(validateAction(g, { type: 'choose', player: P0, optionIds: [] }), null, 'mulligan of 0 allowed');
  assert.equal(validateAction(g, { type: 'choose', player: P0, optionIds: h.slice(0, 2) }), null, 'mulligan of 2 allowed');
});

test('T003 — Mulligan order', () => {
  let g = newGame({ mulligan: true, firstPlayer: P0 });
  expectPending(g, 'mulligan', P0, 'first decision after setup');
  assert.equal(g.turn, 0, 'no turn has started yet');
  g = choose(g);
  expectPending(g, 'mulligan', P1, 'second mulligan');
  assert.equal(g.turn, 0, 'turn 1 Awaken has not happened before both mulligans');
  g = choose(g);
  expectPending(g, 'mainAction', P0);
  assert.equal(g.turn, 1);
});

test('T004 — Second player\'s extra rune (1v1)', () => {
  let g = newGame({ firstPlayer: P0 });
  expectPending(g, 'mainAction', P0);
  assert.equal(g.players[0].runesInPlay.length, 2, 'P0 after first channel');
  g = nextTurn(g);
  expectPending(g, 'mainAction', P1);
  assert.equal(g.players[1].runesInPlay.length, 3, 'P1 after first channel');
  g = nextTurn(g);
  expectPending(g, 'mainAction', P0);
  assert.equal(g.players[0].runesInPlay.length, 4, 'P0 turn 2');
  g = nextTurn(g);
  assert.equal(g.players[1].runesInPlay.length, 5, 'P1 turn 2');
});

test('T005 — First player draws on turn 1 in 1v1', () => {
  const g = newGame({ firstPlayer: P0 });
  expectPending(g, 'mainAction', P0);
  assert.equal(g.players[0].hand.length, 5);
});

test('T006 — Chosen champion starts in champion zone and is playable', () => {
  const g0 = newGame({ firstPlayer: P0 });
  const champ = g0.players[0].championZone[0];
  assert.ok(champ, 'champion zone has the chosen champion');
  assert.equal(g0.objects[champ].cardId, 'cf-champ');
  assert.equal(g0.objects[champ].zone, 'championZone');
  assert.ok(!g0.players[0].hand.includes(champ) && !g0.players[0].mainDeck.includes(champ));
  const g = S0();
  const c = g.players[0].championZone[0];
  assert.ok(legal(g, P0, 'playCard').some(a => a.type === 'playCard' && a.obj === c), 'champion playable from champion zone when affordable');
});

test('T007 — Deck validation: 3-copy limit includes champion', () => {
  const d = deckWith(['cf-champ', 'cf-champ', 'cf-champ']);
  const ps = problems(d);
  assert.ok(ps.some(p => /cop/i.test(p.code + p.message)), `expected a copy-limit problem, got ${JSON.stringify(ps)}`);
  assert.equal(problems(deckWith(['cf-champ', 'cf-champ'])).length, 0, '3 total copies (incl. champion) is legal');
});

test('T008 — Deck validation: domain identity', () => {
  assert.ok(problems(deckWith(['cf-calmbody'])).length > 0, 'Calm/Body card invalid in Fury/Chaos');
  assert.equal(problems(deckWith(['cf-colorless'])).length, 0, 'Colorless card valid');
  assert.equal(problems(deckWith(['cf-furychaos'])).length, 0, 'Fury/Chaos card valid');
  assert.ok(problems(deckWith(['cf-furymind'])).length > 0, 'Fury/Mind card invalid');
});

test('T009 — Deck validation: champion must match legend tag and be a Champion unit', () => {
  assert.ok(problems(legalDeck({ champion: 'cf-signature' })).length > 0, 'Signature card cannot be the chosen champion');
  assert.ok(problems(legalDeck({ champion: 'cf-other-champ' })).length > 0, 'champion of another tag cannot be chosen');
  assert.equal(problems(legalDeck({ champion: 'cf-champ2' })).length, 0, 'other champion unit of the same tag is fine');
});

test('T010 — Deck validation: rune deck exactly 12; battlefields exactly 3 distinct names; signature ≤ 3; main ≥ 40; sideboard ≤ 10', () => {
  const base = legalDeck();
  assert.equal(problems(base).length, 0, 'baseline deck legal');
  assert.ok(problems({ ...base, runes: base.runes.slice(0, 11) }).length > 0, '11 runes');
  assert.ok(problems({ ...base, runes: [...base.runes, 'cf-rune-fury'] }).length > 0, '13 runes');
  assert.ok(problems({ ...base, battlefields: ['cf-bf-a', 'cf-bf-b'] }).length > 0, '2 battlefields');
  assert.ok(problems({ ...base, battlefields: ['cf-bf-a', 'cf-bf-a', 'cf-bf-b'] }).length > 0, 'duplicate battlefield names');
  assert.ok(problems(deckWith(['cf-sig1', 'cf-sig2', 'cf-sig3', 'cf-sig4'])).length > 0, '4 signature cards');
  assert.equal(problems(deckWith(['cf-sig1', 'cf-sig2', 'cf-sig3'])).length, 0, '3 signature cards ok');
  assert.ok(problems({ ...base, main: base.main.slice(0, 38) }).length > 0, '39 cards incl. champion');
  assert.ok(problems({ ...base, sideboard: new Array(11).fill('cf-v1') }).length > 0, 'sideboard of 11');
  // each violation reported separately
  const all = problems({ ...base, runes: base.runes.slice(0, 11), battlefields: ['cf-bf-a', 'cf-bf-a'], main: ['cf-sig1', 'cf-sig2', 'cf-sig3', 'cf-sig4', ...base.main.slice(0, 34)], sideboard: new Array(11).fill('cf-v2') });
  const codes = new Set(all.map(p => p.code));
  assert.ok(codes.size >= 5, `expected >=5 distinct problems (runes, battlefields x2, signatures, main size, sideboard), got ${[...codes].join(', ')}`);
});

test('T011 — Deck validation: Unique', () => {
  assert.ok(problems(deckWith(['cf-unique', 'cf-unique'])).length > 0, '2x Unique invalid');
  assert.equal(problems(deckWith(['cf-unique'])).length, 0, '1x Unique valid');
});

test('T012 — Battlefield selection (match mode)', () => {
  let g = newGame({ firstPlayer: P0, battlefieldChoice: 'choose' });
  let d = pend(g);
  assert.equal(d.kind, 'chooseBattlefield');
  assert.equal(d.options?.length, 3, 'choose 1 of own 3');
  const p0First = d.player;
  const pick0 = d.options![0].id;
  g = choose(g, pick0);
  d = pend(g);
  assert.equal(d.kind, 'chooseBattlefield');
  assert.notEqual(d.player, p0First, 'the other player chooses next');
  assert.equal(g.battlefields.length, 0, 'choices hidden: nothing revealed before both chose');
  const v = getView(g, d.player);
  assert.equal(v.state.objects[pick0], undefined, 'first choice is not visible to the other player (not even its id: HIDDEN-IDS)');
  g = choose(g, d.options![1].id);
  g = toMainOf(g, P0);
  assert.equal(g.battlefields.length, 2);
  assert.ok(g.battlefields.every(b => b.controller === null), 'both start uncontrolled');
  assert.deepEqual(g.battlefields.map(b => b.owner).sort(), [0, 1], 'owner recorded');
  assert.ok(g.battlefields.some(b => b.objId === pick0));
});


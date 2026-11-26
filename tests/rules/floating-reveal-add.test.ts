// User question 2026-11-26: floating energy from Undertitan's "As I'm revealed from your deck, [Add] [2]".
import { test } from 'node:test';
import { assert, S0, put, hand, play, pass, setRunes, P0, zone, pend, answer, readyRunes, exhaustedRunes } from '../conformance/harness.ts';

test('Undertitan revealed by Void Rush: [Add] [2] floats in the pool and is spent first when Undertitan is played', () => {
  let g = S0();
  setRunes(g, P0, 5, 'order');
  put(g, P0, 'V(1)', 'deckTop');
  const ut = put(g, P0, 'Undertitan', 'deckTop');
  g = play(g, P0, hand(g, P0, 'Void Rush'));               // 2 + [C]: exhaust 2, recycle one of the exhausted
  assert.equal(g.players[0].runesInPlay.length, 4);
  assert.equal(readyRunes(g, P0), 3);
  g = pass(g); if (!pend(g).inStep) g = pass(g);
  assert.equal(pend(g).kind, 'chooseCards');
  assert.equal(g.players[0].pool.energy, 2, 'revealed: 2 Energy floating before any choice');
  g = answer(g, { may: [true, true, true], cards: [[ut]], dest: 'base' });
  assert.equal(zone(g, ut), 'base');
  // Undertitan 6+[O] reduced by 2 → 4+[O]: 2 floating + exhaust 2 ready + recycle the already-exhausted rune
  assert.equal(g.players[0].pool.energy, 0);
  assert.equal(g.players[0].runesInPlay.length, 3);
  assert.equal(readyRunes(g, P0), 1, 'one rune still ready — the best possible payment');
  assert.equal(exhaustedRunes(g, P0), 2);
});

test('Undertitan revealed but not played: its 2 Energy stays floating for later plays this phase', () => {
  let g = S0();
  setRunes(g, P0, 5, 'order');
  const v = put(g, P0, 'V(1)', 'deckTop');
  put(g, P0, 'Undertitan', 'deckTop');
  g = play(g, P0, hand(g, P0, 'Void Rush'));
  g = pass(g); if (!pend(g).inStep) g = pass(g);
  g = answer(g, { may: [false, false], cards: [[]] });
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = answer(g, { may: [false], cards: [[]] });
  assert.equal(g.players[0].pool.energy, 2, 'still floating after Void Rush resolved');
  const c = hand(g, P0, 'V(2)');
  const before = readyRunes(g, P0);
  g = play(g, P0, c, { dest: 'base' });
  assert.equal(zone(g, c), 'base');
  assert.equal(readyRunes(g, P0), before, 'paid entirely from the floating 2 — no rune exhausted');
  void v;
});

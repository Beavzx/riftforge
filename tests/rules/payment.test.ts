import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, act, choose, yes, no, put, runes, handCard, resolveAll, zoneOf, setController } from '../fixtures/helpers.ts';
import { fullDb } from '../fixtures/cards.ts';
import { autoPay, validatePlan, resolveCost, executePayment } from '../../src/engine/payment.ts';
import { getLegalActions, createGame } from '../../src/engine/game.ts';
import { baseDb, deck } from '../fixtures/cards.ts';
import type { GameState } from '../../src/engine/types.ts';

function clearRunes(g: GameState, p: 0 | 1) { for (const r of [...g.players[p].runesInPlay]) { g.players[p].runesInPlay.splice(g.players[p].runesInPlay.indexOf(r), 1); delete g.objects[r]; } }

test('auto-pay: energy from exhausting runes, power from recycling a matching rune', () => {
  const g = newGame();
  clearRunes(g, 0);
  const [f1, f2] = runes(g, 0, 2, 't-rune-fury');
  const [c1] = runes(g, 0, 1, 't-rune-calm');
  const plan = autoPay(g, 0, { energy: 2, power: [['Calm']] }, 'unit')!;
  assert.ok(plan);
  assert.deepEqual(plan.plan.recycle, [c1]);
  assert.equal(plan.plan.exhaust.length, 2);
  // the recycled rune is preferred for exhausting too (it leaves anyway)
  assert.ok(plan.plan.exhaust.includes(c1));
  void f1; void f2;
});

test('auto-pay: a rune can be exhausted for energy and then recycled for power', () => {
  const g = newGame();
  clearRunes(g, 0);
  const [c] = runes(g, 0, 1, 't-rune-calm');
  const plan = autoPay(g, 0, { energy: 1, power: [['Calm']] }, 'unit')!;
  assert.deepEqual(plan.plan.exhaust, [c]);
  assert.deepEqual(plan.plan.recycle, [c]);
  executePayment(g, 0, { energy: 1, power: [['Calm']] }, 'unit', plan.plan);
  assert.equal(g.objects[c].zone, 'runeDeck');
  assert.equal(g.players[0].runeDeck[g.players[0].runeDeck.length - 1], c);
  assert.equal(g.players[0].pool.energy, 0);
});

test('auto-pay: prefers recycling exhausted runes; fails when the domain is missing', () => {
  const g = newGame();
  clearRunes(g, 0);
  const [a, b] = runes(g, 0, 2, 't-rune-calm');
  g.objects[b].exhausted = true;
  const plan = autoPay(g, 0, { energy: 0, power: [['Calm']] }, 'unit')!;
  assert.deepEqual(plan.plan.recycle, [b]);
  assert.equal(autoPay(g, 0, { energy: 0, power: [['Mind']] }, 'unit'), null);
  assert.ok(autoPay(g, 0, { energy: 0, power: ['any'] }, 'unit'));
  void a;
});

test('manual payment plan validation', () => {
  const g = newGame();
  clearRunes(g, 0);
  const [f, c] = [runes(g, 0, 1, 't-rune-fury')[0], runes(g, 0, 1, 't-rune-calm')[0]];
  const cost = resolveCost({ energy: 1, power: ['C'] }, ['Calm']);
  assert.equal(validatePlan(g, 0, cost, 'unit', { exhaust: [f], recycle: [c] }), null);
  assert.match(validatePlan(g, 0, cost, 'unit', { exhaust: [f], recycle: [f] })!, /power/);
  g.objects[f].exhausted = true;
  assert.match(validatePlan(g, 0, cost, 'unit', { exhaust: [f], recycle: [c] })!, /exhausted/);
});

test('playCard with an explicit payment plan; an invalid plan rolls the play back', () => {
  let g = newGame();
  clearRunes(g, 0);
  const [f1, f2] = runes(g, 0, 2, 't-rune-fury');
  const c = runes(g, 0, 1, 't-rune-calm')[0];
  const card = handCard(g, 0, 't-calm2');
  const bad = act(g, { type: 'playCard', player: 0, obj: card, destination: 'base', payment: { exhaust: [f1], recycle: [f2] } });
  assert.equal(zoneOf(bad, card), 'hand');
  assert.ok(bad.log[bad.log.length - 1].text.startsWith('Action undone'));
  g = act(g, { type: 'playCard', player: 0, obj: card, destination: 'base', payment: { exhaust: [f1, f2], recycle: [c] } });
  assert.equal(zoneOf(g, card), 'base');
  assert.equal(zoneOf(g, c), 'runeDeck');
});

test('manualPay: a payment decision offers auto or a manual plan', () => {
  const db = baseDb();
  let g = createGame({ seed: 1, cardDb: db, includeAllCards: true, firstPlayer: 0, skipMulligan: true, skipShuffle: true, battlefieldSelection: 'random', manualPay: [true, false],
    players: [{ name: 'A', deck: deck() }, { name: 'B', deck: deck({}, 3) }] });
  const card = handCard(g, 0, 't-u2');
  g = act(g, { type: 'playCard', player: 0, obj: card, destination: 'base' });
  assert.equal(g.pending?.kind, 'payment');
  assert.ok(g.pending?.data?.suggested);
  const runesIds = g.players[0].runesInPlay;
  assert.throws(() => act(g, { type: 'choose', player: 0, optionIds: ['manual'], data: { exhaust: [runesIds[0]], recycle: [] } }));
  g = act(g, { type: 'choose', player: 0, optionIds: ['manual'], data: { exhaust: runesIds.slice(0, 2), recycle: [] } });
  assert.equal(zoneOf(g, card), 'base');
});

test('unaffordable cards are not legal', () => {
  const g = newGame();
  const big = handCard(g, 0, 't-u5');
  assert.ok(!getLegalActions(g, 0).some(a => a.type === 'playCard' && a.obj === big));
  runes(g, 0, 3);
  assert.ok(getLegalActions(g, 0).some(a => a.type === 'playCard' && a.obj === big));
});

test('Accelerate: optional [1][C]; if paid the unit enters ready', () => {
  let g = newGame();
  runes(g, 0, 2);
  const u = handCard(g, 0, 't-accel');
  g = act(g, { type: 'playCard', player: 0, obj: u, destination: 'base' });
  assert.equal(g.pending?.kind, 'optional');
  g = yes(g);
  assert.equal(g.objects[u].exhausted, false);
  let h = newGame();
  const u2 = handCard(h, 0, 't-accel');
  h = act(h, { type: 'playCard', player: 0, obj: u2, destination: 'base' });   // only 2 runes: accelerate not affordable -> not offered
  assert.equal(h.objects[u2].exhausted, true);
});

test('Deflect: choosing an enemy unit with Deflect 2 costs 2 more power; unaffordable targets are not offered', () => {
  let g = newGame({ db: fullDb() });
  const d = put(g, 1, 't-deflect', 'base');
  const other = put(g, 1, 't-u1', 'base');
  const zap = handCard(g, 0, 'ts-zap');
  clearRunes(g, 0); runes(g, 0, 1);
  g = act(g, { type: 'playCard', player: 0, obj: zap });
  // 1 rune: 1 energy + at most 1 recycle -> can't pay 2 extra power: only `other` offered (auto-chosen)
  assert.equal(g.chain[0].targets[0][0], other);
  let h = newGame({ db: fullDb() });
  runes(h, 0, 3);
  const d2 = put(h, 1, 't-deflect', 'base');
  put(h, 1, 't-u1', 'base');
  const zap2 = handCard(h, 0, 'ts-zap');
  const before = h.players[0].runesInPlay.length;
  h = act(h, { type: 'playCard', player: 0, obj: zap2 });
  h = choose(h, d2);
  assert.equal(h.players[0].runesInPlay.length, before - 2, 'two runes recycled for the Deflect tax');
  void d; void yes; void no; void resolveAll; void setController;
});

// docs/rules-tests.md §D — Chain and priority (T049-T060)
import { test } from 'node:test';
import {
  assert, S0, put, hand, cast, play, pass, passN, expectPending, legal, canPlayNow, control, setRunes, act, actEv, EventLog,
  P0, P1, BF_A, mightOf, zone, resolveChain, pend, answer, optionIds, chainSources,
} from './harness.ts';

test('T049 — Priority after play goes to the player who played (may add alongside)', () => {
  let g = S0();
  const v = put(g, P1, 'V(3)', 'base');
  const zr = hand(g, P0, 'ZapR');
  [g] = cast(g, P0, 'ZapM', { targets: [[v]] });
  expectPending(g, 'chainResponse', P0, 'P0 has priority first');
  assert.ok(canPlayNow(g, P0, zr), 'P0 may respond to their own spell');
  g = pass(g);
  expectPending(g, 'chainResponse', P1);
});

test('T050 — Both pass → top resolves', () => {
  let g = S0();
  const a = put(g, P1, 'V(5)', 'base');
  const b = put(g, P0, 'V(5)', 'base');
  [g] = cast(g, P0, 'ZapM', { targets: [[a]] });
  g = pass(g);
  [g] = cast(g, P1, 'ZapR', { targets: [[b]] });
  expectPending(g, 'chainResponse', P1, 'priority to the controller of the newest item');
  g = pass(g);
  expectPending(g, 'chainResponse', P0);
  g = pass(g);
  assert.equal(g.chain.length, 1, 'ZapR resolved');
  assert.equal(g.objects[b].damage, 2);
  expectPending(g, 'chainResponse', P0, 'priority to the controller of the newest remaining item');
  g = pass(g);
  expectPending(g, 'chainResponse', P1);
  g = pass(g);
  assert.equal(g.chain.length, 0);
  assert.equal(g.objects[a].damage, 2);
});

test('T051 — Last-in first-out', () => {
  let g = S0();
  const A = put(g, P1, 'V(5)', 'base'), B = put(g, P1, 'V(6)', 'base'), C = put(g, P1, 'V(7)', 'base');
  const log = new EventLog();
  [g] = cast(g, P0, 'ZapM', { targets: [[A]] });
  g = pass(g);
  [g] = cast(g, P1, 'ZapR', { targets: [[B]] });
  g = pass(g);                                  // P1 passes -> P0
  [g] = cast(g, P0, 'ZapR', { targets: [[C]] });
  g = log.passAll(g);
  const order = log.of('damage').map(e => e.obj);
  assert.deepEqual(order, [C, B, A]);
});

test('T052 — Action can\'t respond', () => {
  let g = S0();
  const v = put(g, P1, 'V(5)', 'base');
  const a0 = hand(g, P0, 'ZapA');
  const a1 = hand(g, P1, 'ZapA');
  [g] = cast(g, P0, 'ZapM', { targets: [[v]] });
  assert.ok(!canPlayNow(g, P0, a0), 'P0 cannot play an Action on the chain');
  g = pass(g);
  assert.ok(!canPlayNow(g, P1, a1), 'P1 cannot play an Action on the chain');
});

test('T053 — Reaction abilities during payment', () => {
  let g = S0();
  setRunes(g, P0, 1);
  const gold = put(g, P0, 'Gold', 'base');
  const c = hand(g, P0, 'CalmDraw');              // [1][G]: rune for [1], Gold for [A]
  assert.ok(canPlayNow(g, P0, c));
  g = play(g, P0, c);
  assert.equal(zone(g, c), 'chain');
  assert.equal(g.chain.length, 1, 'no chain item for the Gold / rune Add abilities');
  assert.ok(!g.objects[gold], 'Gold was used mid-payment');
  expectPending(g, 'chainResponse', P0);
});

test('T054 — Add abilities don\'t pass priority', () => {
  let g = S0();
  const v = put(g, P1, 'V(5)', 'base');
  const r = actEv(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'ZapM') });
  g = answer(r.state, { targets: [[v]] }, P0);
  assert.equal(g.chain.length, 1, 'only the spell is on the chain');
  expectPending(g, 'chainResponse', P0, 'exhausting runes did not hand priority to P1');
});

test('T055 — Cleanup between chain items', () => {
  let g = S0();
  const v = put(g, P1, 'V(2)', BF_A);
  control(g, BF_A, P1);
  let zm: string;
  [g, zm] = cast(g, P0, 'ZapM', { targets: [[v]] });
  [g] = cast(g, P0, 'ZapR', { targets: [[v]] });   // holding priority
  g = passN(g, 2);
  assert.equal(zone(g, v), 'trash', 'cleanup after ZapR killed V(2)');
  assert.equal(g.chain.length, 1);
  g = resolveChain(g);
  assert.equal(zone(g, zm), 'trash', 'ZapM resolves doing nothing, goes to trash');
  assert.ok(g.ex.playedThisTurn[0].includes(zm), 'still counts as played');
});

test('T056 — No cleanup during resolution', () => {
  let g = S0();
  const v = put(g, P1, 'V(3)', 'base');
  [g] = cast(g, P0, 'Zap3Pump3', { targets: [[v]] });
  g = resolveChain(g);
  assert.equal(zone(g, v), 'base', 'unit survives');
  assert.equal(mightOf(g, v), 6);
  assert.equal(g.objects[v].damage, 3);
});

test('T057 — Triggers created during resolution wait', () => {
  let g = S0();
  const dk = put(g, P1, 'DK(1)', 'base');
  const h0 = g.players[0].hand.length, h1 = g.players[1].hand.length;
  [g] = cast(g, P0, 'KillDraw', { targets: [[dk]] });
  g = passN(g, 2);
  assert.equal(g.players[0].hand.length, h0 + 1 - 0, 'the spell finished (P0 drew)');
  assert.equal(g.players[1].hand.length, h1, 'Deathknell has not resolved yet');
  assert.equal(g.chain.length, 1, 'Deathknell trigger waits on the chain');
  assert.equal(g.chain[0].kind, 'trigger');
  g = resolveChain(g);
  assert.equal(g.players[1].hand.length, h1 + 1, 'then Deathknell resolves');
});

test('T058 — Priority holder in a closed state on opponent\'s turn', () => {
  let g = S0();
  const v = put(g, P1, 'V(5)', 'base');
  const w = put(g, P0, 'V(5)', 'base');
  [g] = cast(g, P0, 'ZapM', { targets: [[v]] });
  g = pass(g);
  [g] = cast(g, P1, 'ZapR', { targets: [[w]] });
  expectPending(g, 'chainResponse', P1, 'P1 holds priority after their Reaction finalizes');
});

test('T059 — Turn player\'s simultaneous triggers order', () => {
  let g = S0();
  const w0 = put(g, P0, 'DeathWatch', 'base');
  const w1 = put(g, P1, 'DeathWatch', 'base');
  const v = put(g, P1, 'V(1)', 'base');
  [g] = cast(g, P0, 'ZapM', { targets: [[v]] });
  g = passN(g, 2);
  assert.equal(zone(g, v), 'trash');
  assert.equal(g.chain.length, 2);
  assert.deepEqual(g.chain.map(c => c.controller), [0, 1], 'P0\'s trigger first (bottom), P1\'s second → P1\'s resolves first');
  assert.deepEqual(chainSources(g), [w0, w1]);
});

test('T060 — Order own simultaneous triggers', () => {
  let g = S0();
  const a = put(g, P0, 'DeathWatch', 'base');
  const b = put(g, P0, 'DeathWatch2', 'base');
  const v = put(g, P1, 'V(1)', 'base');
  [g] = cast(g, P0, 'ZapM', { targets: [[v]] });
  g = passN(g, 2);
  const d = pend(g);
  assert.ok(d.inStep, `expected an ordering decision, got ${d.kind}`);
  assert.equal(d.player, 0);
  const ids = optionIds(g);
  assert.equal(ids.length, 2, 'both triggers offered');
  // choose DeathWatch2's trigger to go on the chain first
  const optB = d.options!.find(o => o.objIds?.includes(b))!;
  g = act(g, { type: 'choose', player: P0, optionIds: d.max && d.max > 1 ? [optB.id, d.options!.find(o => o !== optB)!.id] : [optB.id] });
  if (g.pending?.inStep) g = act(g, { type: 'choose', player: P0, optionIds: [g.pending.options![0].id] });
  assert.deepEqual(chainSources(g), [b, a], 'chosen order respected (first chosen = bottom = resolves last)');
  assert.equal(d.kind, 'orderTriggers', 'decision kind per spec §8.2 / decision catalogue');
});

void legal;

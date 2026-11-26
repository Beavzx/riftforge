// docs/rules-tests.md §E — Movement, contested, showdowns (T061-T075)
import { test } from 'node:test';
import {
  assert, S0, put, hand, cast, play, pass, passN, expectPending, legal, canPlayNow, control, act, move, moveDests, playDests,
  P0, P1, BF_A, BF_B, zone, locOf, resolveChain, pend, answer, rejects, EventLog,
} from './harness.ts';

test('T061 — Standard move costs exhaust', () => {
  let g = S0();
  const u = put(g, P0, 'V(2)', 'base');
  const x = put(g, P0, 'V(2)', 'base', { ready: false });
  assert.deepEqual(moveDests(g, P0, x), [], 'an exhausted unit can\'t standard-move');
  g = move(g, P0, [u], BF_A);
  assert.equal(locOf(g, u), BF_A);
  assert.equal(g.objects[u].exhausted, true);
});

test('T062 — Group move with mixed origins', () => {
  let g = S0();
  const v = put(g, P0, 'V(1)', 'base');
  const gk = put(g, P0, 'Ganker(1)', BF_A);
  control(g, BF_A, P0);
  const plain = put(g, P0, 'V(1)', BF_A);
  assert.notEqual(rejects(g, { type: 'move', player: P0, units: [v, plain], to: BF_B }), null, 'without Ganking the BF-A unit can\'t join');
  const log = new EventLog();
  g = log.act(g, { type: 'move', player: P0, units: [v, gk], to: BF_B });
  assert.equal(locOf(g, v), BF_B);
  assert.equal(locOf(g, gk), BF_B);
  assert.equal(log.of('move').length, 2, 'both arrive together (one move action)');
  assert.equal(g.showdown?.battlefieldIndex, BF_B, 'a single showdown at BF-B after the one cleanup');
});

test('T063 — No battlefield-to-battlefield without Ganking', () => {
  const g = S0();
  const v = put(g, P0, 'V(2)', BF_A);
  control(g, BF_A, P0);
  assert.deepEqual(moveDests(g, P0, v), ['base']);
});

test('T064 — No standard move during a showdown or chain', () => {
  let g = S0();
  const a = put(g, P0, 'V(2)', 'base');
  const b = put(g, P0, 'V(2)', 'base');
  const w = put(g, P1, 'V(5)', 'base');
  let c = g;
  [c] = cast(c, P0, 'ZapM', { targets: [[w]] });
  expectPending(c, 'chainResponse', P0);
  assert.equal(legal(c, P0, 'move').length, 0, 'no move while a chain exists');
  g = move(g, P0, [a], BF_A);
  expectPending(g, 'showdownAction', P0);
  assert.equal(legal(g, P0, 'move').length, 0, 'no move during a showdown');
  void b;
});

test('T065 — Moving to an empty uncontrolled battlefield → non-combat showdown, mover has focus', () => {
  let g = S0();
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_A);
  assert.equal(g.battlefields[BF_A].contested, true);
  assert.equal(g.battlefields[BF_A].contestedBy, 0);
  assert.ok(g.showdown, 'showdown started');
  assert.equal(g.showdown!.battlefieldIndex, BF_A);
  assert.equal(g.showdown!.isCombat, false);
  assert.equal(g.showdown!.focus, 0);
  assert.equal(g.chain.length, 0, 'Showdown Open');
  expectPending(g, 'showdownAction', P0);
});

function t065(): { g: ReturnType<typeof S0>; u: string } {
  let g = S0();
  const u = put(g, P0, 'V(3)', 'base');
  g = move(g, P0, [u], BF_A);
  return { g, u };
}

test('T066 — Showdown ends when both pass; conquer', () => {
  let { g } = t065();
  g = pass(g);
  expectPending(g, 'showdownAction', P1);
  g = pass(g);
  assert.equal(g.showdown, null, 'showdown ended');
  assert.equal(g.battlefields[BF_A].controller, 0);
  assert.equal(g.players[0].points, 1);
  assert.ok(g.battlefields[BF_A].scoredThisTurnBy.includes(0));
  expectPending(g, 'mainAction', P0);
});

test('T067 — Focus passes after a played spell resolves', () => {
  let { g, u } = t065();
  [g] = cast(g, P0, 'PumpA', { targets: [[u]] });
  g = passN(g, 2);
  assert.equal(g.chain.length, 0);
  expectPending(g, 'showdownAction', P1, 'focus moved to P1');
  assert.equal(g.showdown!.focus, 1);
  g = pass(g);
  expectPending(g, 'showdownAction', P0, 'focus back to P0');
  g = pass(g);
  assert.equal(g.showdown, null, 'all players passed in sequence (P1 then P0): showdown ends');
  assert.equal(g.battlefields[BF_A].controller, 0);
});

test('T068 — "All passed in sequence" requires a full round after the last action', () => {
  let { g, u } = t065();
  g = pass(g);
  expectPending(g, 'showdownAction', P1);
  [g] = cast(g, P1, 'ZapA', { targets: [[u]] });
  g = passN(g, 2);
  expectPending(g, 'showdownAction', P0, 'focus to P0; showdown not over');
  assert.ok(g.showdown);
  g = pass(g);
  assert.ok(g.showdown, 'still not over after P0\'s pass');
  g = pass(g);
  assert.equal(g.showdown, null);
});

test('T069 — Opponent responds in a non-combat showdown and removes the mover', () => {
  let { g, u } = t065();
  g = pass(g);
  [g] = cast(g, P1, 'KillA', { targets: [[u]] });
  g = passN(g, 2);
  assert.equal(zone(g, u), 'trash');
  expectPending(g, 'showdownAction', P0);
  g = passN(g, 2);
  assert.equal(g.showdown, null);
  assert.equal(g.battlefields[BF_A].controller, null, 'stays uncontrolled');
  assert.equal(g.players[0].points + g.players[1].points, 0, 'no conquer');
  assert.equal(g.battlefields[BF_A].contested, false, 'contested removed');
});

test('T070 — Moving to a battlefield you control: nothing happens', () => {
  let g = S0();
  put(g, P0, 'V(2)', BF_A);
  control(g, BF_A, P0);
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_A);
  assert.equal(g.battlefields[BF_A].contested, false);
  assert.equal(g.showdown, null);
  expectPending(g, 'mainAction', P0);
});

test('T071 — Leaving your battlefield loses control at next cleanup', () => {
  let g = S0();
  const u = put(g, P0, 'V(2)', BF_A);
  control(g, BF_A, P0);
  g = move(g, P0, [u], 'base');
  assert.equal(g.battlefields[BF_A].controller, null);
  assert.equal(g.players[1].points, 0);
});

test('T072 — Ambush unit joins a showdown', () => {
  let { g } = t065();
  const amb = hand(g, P1, 'Ambusher(3)');
  g = pass(g);
  expectPending(g, 'showdownAction', P1);
  assert.ok(!playDests(g, P1, amb).includes(BF_A), 'P1 cannot Ambush where they have no units');
  // combat variant: P1 has a unit at BF-A
  let h = S0();
  put(h, P1, 'V(1)', BF_A);
  control(h, BF_A, P1);
  const amb2 = hand(h, P1, 'Ambusher(3)');
  const a = put(h, P0, 'V(2)', 'base');
  h = move(h, P0, [a], BF_A);
  expectPending(h, 'showdownAction', P0);
  assert.equal(h.showdown?.isCombat, true);
  h = pass(h);
  expectPending(h, 'showdownAction', P1);
  assert.ok(playDests(h, P1, amb2).includes(BF_A), 'P1 can Ambush into the combat as a Reaction');
});

test('T073 — Spell moves an enemy into your battlefield → combat', () => {
  let g = S0();
  put(g, P0, 'V(3)', BF_A);
  control(g, BF_A, P0);
  const e = put(g, P1, 'V(2)', 'base');
  [g] = cast(g, P0, 'Charm', { targets: [[e]] });
  g = passN(g, 2);
  g = answer(g, { locations: [BF_A] }, P0);
  g = resolveChain(g);
  assert.equal(locOf(g, e), BF_A);
  assert.ok(g.showdown?.isCombat, 'combat started');
  assert.equal(g.showdown!.attacker, 1, 'P1 (whose unit applied contested) is the attacker');
  assert.equal(g.showdown!.defender, 0);
  assert.equal(g.objects[e].combatRole, 'attacker');
});

test('T074 — Recall is not a move', () => {
  let g = S0();
  put(g, P1, 'V(5)', BF_A, { stunned: true });
  control(g, BF_A, P1);
  const m = put(g, P0, 'MoveDraw(2)', 'base');
  const h0 = g.players[0].hand.length;
  g = move(g, P0, [m], BF_A);
  g = resolveChain(g);                              // "When I move" trigger from the real move
  const h1 = g.players[0].hand.length;
  assert.equal(h1, h0 + 1, 'the standard move triggered once');
  for (let i = 0; i < 10 && g.showdown; i++) g = pend(g).inStep ? g : pass(g);
  assert.equal(locOf(g, m), 'base', 'recalled by combat cleanup');
  g = resolveChain(g);
  assert.equal(g.players[0].hand.length, h1, 'recall did not trigger "When I move"');
});

test('T075 — Vilemaw\'s Lair blocks moving to base; recall ignores it', () => {
  // MoveR on it does nothing (negated)
  let g = S0({ bfA: 'cf-bf-lair' });
  const u = put(g, P0, 'V(2)', BF_A);
  control(g, BF_A, P0);
  const g0 = g;
  [g] = cast(g, P0, 'MoveR', { targets: [[u]] });
  g = resolveChain(g);
  assert.equal(locOf(g, u), BF_A, 'MoveR negated');
  // recall from combat cleanup ignores the Lair
  let h = S0({ bfA: 'cf-bf-lair' });
  put(h, P1, 'V(5)', BF_A, { stunned: true });
  control(h, BF_A, P1);
  const a = put(h, P0, 'V(2)', 'base');
  h = move(h, P0, [a], BF_A);
  for (let i = 0; i < 10 && h.showdown; i++) h = pass(h);
  assert.equal(locOf(h, a), 'base', 'attacker recalled to base despite the Lair');
  // standard move to base is not a legal action
  assert.ok(!moveDests(g0, P0, u).includes('base'), 'standard move to base not offered');
  assert.notEqual(rejects(g0, { type: 'move', player: P0, units: [u], to: 'base' }), null, 'standard move to base rejected');
});

void canPlayNow; void play;

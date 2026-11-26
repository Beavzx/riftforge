// docs/rules-tests.md §G — Scoring, final point, winning (T099-T112)
import { test } from 'node:test';
import {
  assert, S0, put, hand, cast, play, pass, passN, expectPending, control, act, move, clearDeck, fillTrash, nextTurn, endTurn,
  P0, P1, BF_A, BF_B, zone, locOf, resolveChain, pend, answer, passAll, EventLog, validateAction, type GameState,
} from './harness.ts';

test('T099 — Hold at start of turn', () => {
  let g = S0({ tp: P1 });
  put(g, P0, 'HoldDraw(2)', BF_A);
  control(g, BF_A, P0);
  const h0 = g.players[0].hand.length;
  g = nextTurn(g);
  expectPending(g, 'mainAction', P0);
  assert.equal(g.players[0].points, 1, 'hold → +1 point');
  assert.equal(g.players[0].hand.length, h0 + 1 + 1, '"when I hold" trigger fired (+1) and the draw-phase draw (+1)');
});

test('T100 — Score each battlefield once per turn', () => {
  let g = S0();
  const a = put(g, P0, 'V(2)', 'base');
  const b = put(g, P0, 'V(2)', 'base');
  put(g, P0, 'ConquerDraw(3)', 'base', { ready: false });
  g = move(g, P0, [a], BF_A);
  g = passN(g, 2);
  assert.equal(g.players[0].points, 1, 'first conquer');
  [g] = cast(g, P0, 'MoveR', { targets: [[a]] });
  g = resolveChain(g);
  assert.equal(locOf(g, a), 'base');
  assert.equal(g.battlefields[BF_A].controller, null, 'lost control at the next cleanup');
  const log = new EventLog();
  g = log.act(g, { type: 'move', player: P0, units: [b], to: BF_A });
  g = log.passAll(g);
  assert.equal(g.battlefields[BF_A].controller, 0, 'establishes control again');
  assert.equal(g.players[0].points, 1, 'second establishment is not a conquer: no point');
  assert.equal(log.of('conquer').length, 0, 'no "when you conquer" triggers');
});

test('T101 — Final point via conquer requires scoring every battlefield', () => {
  let g = S0();
  g.players[0].points = 7;
  const u = put(g, P0, 'ConquerDraw(3)', 'base');
  const h0 = g.players[0].hand.length;
  const log = new EventLog();
  g = log.act(g, { type: 'move', player: P0, units: [u], to: BF_A });
  g = log.passAll(g);
  g = resolveChain(g);
  assert.equal(g.battlefields[BF_A].controller, 0);
  assert.equal(g.players[0].points, 7, 'stays at 7');
  assert.equal(log.of('conquer').length, 1, 'conquer triggers still fire');
  assert.equal(g.players[0].hand.length, h0 + 2, 'draws 1 instead of the point (+1 from the conquer trigger)');
  assert.equal(g.winner, null);
});

test('T102 — Final point when both scored', () => {
  let g = S0({ tp: P1 });
  g.players[0].points = 6;
  put(g, P0, 'V(1)', BF_B);
  control(g, BF_B, P0);
  g = nextTurn(g);
  expectPending(g, 'mainAction', P0);
  assert.equal(g.players[0].points, 7, 'hold BF-B');
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_A);
  g = passN(g, 2);
  assert.equal(g.players[0].points, 8);
  assert.equal(g.winner, 0, 'wins at the next cleanup');
});

test('T103 — Final point via hold is not restricted', () => {
  let g = S0({ tp: P1 });
  g.players[0].points = 7;
  put(g, P0, 'V(1)', BF_A);
  control(g, BF_A, P0);
  g = endTurn(g, P1);
  assert.equal(g.players[0].points, 8);
  assert.equal(g.winner, 0);
});

test('T104 — Card points not restricted', () => {
  let g = S0();
  g.players[0].points = 7;
  [g] = cast(g, P0, 'Score1');
  g = passN(g, 2);
  assert.equal(g.players[0].points, 8);
  assert.equal(g.winner, 0);
});

test('T105 — Win requires strictly more points', () => {
  let g = S0();
  g.players[0].points = 7;
  g.players[1].points = 7;
  clearDeck(g, P0);
  fillTrash(g, P0, 1);
  [g] = cast(g, P0, 'DrawThenScore');            // draw → burn out (P1 → 8), then P0 scores → 8
  g = passN(g, 2);
  assert.equal(g.players[0].points, 8);
  assert.equal(g.players[1].points, 8);
  assert.equal(g.winner, null, 'no winner while tied');
  expectPending(g, 'mainAction', P0, 'game continues');
  [g] = cast(g, P0, 'Score1');
  g = passN(g, 2);
  assert.equal(g.winner, 0, 'a single leader at ≥8 wins');
});

test('T106 — Win checked at cleanup', () => {
  let g = S0();
  g.players[0].points = 7;
  const h0 = g.players[0].hand.length;
  [g] = cast(g, P0, 'ScoreThenDraw');
  g = passN(g, 2);
  assert.equal(g.winner, 0);
  assert.equal(g.players[0].hand.length, h0 + 1, 'the rest of the spell (draw) happened before the win check');
});

test('T107 — Points can\'t go below 0', () => {
  let g = S0();
  put(g, P0, 'LoseWatch', 'base');
  const h0 = g.players[0].hand.length;
  const log = new EventLog();
  [g] = cast(g, P0, 'OppLose1');
  g = log.passAll(g);
  assert.equal(g.players[1].points, 0);
  assert.equal(log.of('pointsLost').length, 0);
  assert.equal(g.players[0].hand.length, h0, '"when a player loses points" doesn\'t trigger');
});

test('T108 — Hidden unit defends a battlefield on the opponent\'s turn', () => {
  let g = S0({ tp: P1 });
  const v1 = put(g, P0, 'V(1)', BF_A);
  control(g, BF_A, P0);
  const hid = put(g, P0, 'HidU(3)', { facedown: BF_A, hiddenTurn: g.turn - 1 });
  const atk = put(g, P1, 'V(2)', 'base');
  g = move(g, P1, [atk], BF_A);
  assert.ok(g.showdown?.isCombat);
  expectPending(g, 'showdownAction', P1);
  g = pass(g);
  expectPending(g, 'showdownAction', P0);
  assert.equal(validateAction(g, { type: 'playCard', player: P0, obj: hid, destination: BF_A }), null, 'playable from facedown');
  const runesBefore = g.players[0].runesInPlay.filter(r => !g.objects[r].exhausted).length;
  g = play(g, P0, hid, { dest: BF_A });
  assert.equal(locOf(g, hid), BF_A);
  assert.equal(g.players[0].runesInPlay.filter(r => !g.objects[r].exhausted).length, runesBefore, 'cost ignored');
  assert.equal(g.objects[hid].combatRole, 'defender', 'next cleanup gives it the Defender designation');
  for (let i = 0; i < 6 && !pend(g).inStep; i++) g = pass(g);
  const d = expectPending(g, 'assignDamage', P1, 'attacker assigns first');
  assert.equal((d.data as { total: number }).total, 2, 'P1 total 2');
  const v = (a: Record<string, number>) => validateAction(g, { type: 'assignDamage', player: P1, assignment: a });
  assert.equal(v({ [v1]: 1, [hid]: 1 }), null);
  assert.equal(v({ [hid]: 2 }), null);
  assert.notEqual(v({ [v1]: 2 }), null, 'excess on a lethal unit while another can still receive damage');
  const log = new EventLog();
  g = log.act(g, { type: 'assignDamage', player: P1, assignment: { [hid]: 2 } });
  g = log.passAll(g);
  const toAtk = log.of('damage').filter(e => e.obj === atk).reduce((s, e) => s + Number(e.amount), 0);
  assert.equal(toAtk, 4, 'P0 total 4 (exhausted units still deal damage)');
  assert.equal(zone(g, atk), 'trash');
  assert.equal(g.battlefields[BF_A].controller, 0, 'defender wins');
  assert.equal(g.players[0].points, 0, 'no conquer (already controlled)');
});

test('T109 — Defender conquers when the battlefield was uncontrolled', () => {
  let g = S0({ tp: P1 });
  const v4 = hand(g, P0, 'V(4)');
  const dr = hand(g, P0, 'DropR');
  const atk = put(g, P1, 'V(2)', 'base');
  g = move(g, P1, [atk], BF_A);
  expectPending(g, 'showdownAction', P1);
  assert.equal(g.showdown!.isCombat, false);
  g = pass(g);
  expectPending(g, 'showdownAction', P0);
  g = play(g, P0, dr);
  g = passN(g, 2);
  g = answer(g, { cards: [[v4]], battlefields: [BF_A] }, P0);
  g = resolveChain(g);
  assert.equal(locOf(g, v4), BF_A, 'V(4) put at BF-A');
  assert.ok(g.showdown?.isCombat, 'becomes a combat showdown');
  assert.equal(g.showdown!.attacker, 1, 'P1 attacker (applied contested)');
  assert.equal(g.showdown!.defender, 0);
  for (let i = 0; i < 8 && g.showdown && !pend(g).inStep; i++) g = pass(g);
  g = passAll(g);
  assert.equal(zone(g, atk), 'trash');
  assert.equal(locOf(g, v4), BF_A);
  assert.equal(g.battlefields[BF_A].controller, 0, 'P0 establishes control');
  assert.equal(g.players[0].points, 1, 'conquer during P1\'s turn');
});

test('T110 — Burn out with empty deck AND empty trash loses the game', () => {
  let g = S0();
  clearDeck(g, P0);
  g.players[1].points = 3;
  [g] = cast(g, P0, 'Draw1M');
  g = passN(g, 2);
  assert.equal(g.players[1].points, 8, 'burn out repeats until P1 has 8');
  assert.equal(g.winner, 1, 'P1 wins immediately');
});

test('T110b — Burn out with a non-empty trash', () => {
  let g = S0();
  clearDeck(g, P0);
  put(g, P0, 'V(1)', 'deckTop');
  fillTrash(g, P0, 4);
  const h0 = g.players[0].hand.length;
  [g] = cast(g, P0, 'Draw3M');
  g = passN(g, 2);
  assert.equal(g.players[1].points, 1);
  assert.equal(g.players[0].hand.length, h0 + 3);
  assert.equal(g.players[0].mainDeck.length, 2);
});

test('T111 — Burn out with cards in trash', () => {
  let g = S0();
  clearDeck(g, P0);
  fillTrash(g, P0, 10);
  const h0 = g.players[0].hand.length;
  [g] = cast(g, P0, 'Draw2M');
  g = passN(g, 2);
  assert.equal(g.players[1].points, 1);
  assert.equal(g.players[0].hand.length, h0 + 2);
  assert.equal(g.players[0].mainDeck.length, 8);
});

test('T112 — Look/reveal beyond deck size doesn\'t burn out', () => {
  let g = S0();
  clearDeck(g, P0);
  put(g, P0, 'V(1)', 'deckTop');
  [g] = cast(g, P0, 'Predict2M');
  g = passN(g, 2);
  const d = pend(g);
  if (d.inStep) {
    assert.equal(d.options?.length, 1, 'looks at the 1 card');
    g = act(g, { type: 'choose', player: P0, optionIds: [] });
  }
  assert.equal(g.players[1].points, 0, 'no burn out');
  assert.equal(g.players[0].mainDeck.length, 1);
});

void BF_B as unknown as GameState;

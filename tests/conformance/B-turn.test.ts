// docs/rules-tests.md §B — Turn structure, runes and pool (T013-T030)
import { test } from 'node:test';
import {
  assert, S0, put, hand, cast, play, pend, pass, endTurn, nextTurn, expectPending, legal, canPlayNow, playDests, control, setRunes,
  clearDeck, fillTrash, mod, act, addRunes, actEv, EventLog, yes, P0, P1, BF_A, BF_B, mightOf, readyRunes, exhaustedRunes, zone, locOf,
  setBattlefieldCard, validateAction, resolveChain,
} from './harness.ts';

test('T013 — Awaken readies everything', () => {
  let g = S0();
  const u1 = put(g, P1, 'V(2)', 'base', { ready: false });
  const g1 = put(g, P1, 'Sword', 'base', { ready: false });
  setRunes(g, P1, 6, 'fury', false);
  g.objects[g.players[1].legend].exhausted = true;
  const u0 = put(g, P0, 'V(2)', 'base', { ready: false });
  g = nextTurn(g);
  expectPending(g, 'mainAction', P1);
  assert.equal(g.objects[u1].exhausted, false, 'P1 unit ready');
  assert.equal(g.objects[g1].exhausted, false, 'P1 gear ready');
  assert.equal(exhaustedRunes(g, P1), 0, 'P1 runes ready');
  assert.equal(g.objects[g.players[1].legend].exhausted, false, 'P1 legend ready');
  assert.equal(g.objects[u0].exhausted, true, 'P0 exhausted objects stay exhausted');
});

test('T014 — Channel enters ready', () => {
  let g = S0();
  setRunes(g, P1, 0);
  g = nextTurn(g);
  assert.equal(g.players[1].runesInPlay.length, 2);
  assert.equal(readyRunes(g, P1), 2, 'channeled runes are ready');
});

test('T015 — Rune deck empty', () => {
  let g = S0({ tp: P1, runeDeck: [1, 6] });
  g = nextTurn(g);
  expectPending(g, 'mainAction', P0);
  assert.equal(g.players[0].runesInPlay.length, 7, 'channels the 1 remaining rune');
  assert.equal(g.players[1].points, 0, 'no penalty');
  let h = S0({ tp: P1, runeDeck: [0, 6] });
  h = nextTurn(h);
  expectPending(h, 'mainAction', P0);
  assert.equal(h.players[0].runesInPlay.length, 6, 'nothing channeled');
});

test('T016 — Rune abilities', () => {
  const g = S0();
  setRunes(g, P0, 1);
  const r = g.players[0].runesInPlay[0];
  const acts = legal(g, P0, 'activate').filter(a => a.type === 'activate' && a.obj === r);
  assert.ok(acts.length >= 2, 'rune has two activatable Add abilities');
  let s = act(g, acts[0]);
  s = act(s, legal(s, P0, 'activate').find(a => a.type === 'activate' && a.obj === r)!);
  assert.deepEqual(s.players[0].pool, { energy: 1, power: { Fury: 1 } });
  assert.equal(s.players[0].runeDeck[s.players[0].runeDeck.length - 1], r, 'rune at bottom of rune deck');
  assert.equal(s.players[0].runesInPlay.length, 0);
});

test('T017 — Recycle an exhausted rune', () => {
  const g = S0();
  const rs = setRunes(g, P0, 3);
  const [r4] = addRunes(g, P0, 1, 'fury', false);       // an exhausted Fury rune
  const c = hand(g, P0, 'Cost3R');                      // costs [3][R]
  const plan = { exhaust: rs, recycle: [r4] };
  assert.equal(validateAction(g, { type: 'playCard', player: P0, obj: c, destination: 'base', payment: plan }), null, 'manual plan recycling the exhausted rune is valid');
  const s2 = act(g, { type: 'playCard', player: P0, obj: c, destination: 'base', payment: plan });
  assert.equal(zone(s2, c), 'base');
  assert.equal(s2.players[0].runeDeck[s2.players[0].runeDeck.length - 1], r4, 'the exhausted rune was recycled to the bottom');
  assert.ok(canPlayNow(g, P0, c), 'auto-pay also finds a payment using the exhausted rune for power');
});

test('T018 — Pool empties at start of Main phase', () => {
  let g = S0({ tp: P1, bfA: 'cf-bf-holdadd' });
  put(g, P0, 'V(1)', BF_A);
  control(g, BF_A, P0);
  const r = actEv(g, { type: 'endTurn', player: P1 });
  g = r.state;
  expectPending(g, 'mainAction', P0);
  assert.ok(r.events.some(e => e.type === 'add' && e.player === 0 && e.energy === 1), 'hold trigger added 1 energy during the Beginning phase');
  assert.equal(g.players[0].pool.energy, 0, 'pool empty when the Main phase starts');
});

test('T019 — Pool empties at end of turn', () => {
  let g = S0();
  const v = put(g, P1, 'V(3)', BF_A);
  control(g, BF_A, P1);
  put(g, P1, 'BeginMay', 'base');
  [g] = cast(g, P0, 'ZapM', { targets: [[v]] });
  g = pass(g);                                   // P0 passes
  expectPending(g, 'chainResponse', P1);
  [g] = cast(g, P1, 'AddR');
  g = resolveChain(g);
  assert.equal(g.players[1].pool.energy, 2, 'P1 added 2 energy during P0\'s turn');
  g = endTurn(g, P0);
  // P1's "start of Beginning phase" optional trigger gives an observation point after P0's expiration step
  expectPending(g, 'optional', P1);
  assert.equal(g.players[1].pool.energy, 0, 'P1 pool emptied at the end of P0\'s turn');
});

test('T020 — Draw from empty deck in draw phase = burn out then draw', () => {
  let g = S0({ tp: P1 });
  clearDeck(g, P0);
  fillTrash(g, P0, 5);
  g = nextTurn(g);
  expectPending(g, 'mainAction', P0);
  assert.equal(g.players[1].points, 1, 'opponent gains 1 point');
  assert.equal(g.players[0].hand.length, 1, 'P0 draws 1');
  assert.equal(g.players[0].mainDeck.length, 4);
  assert.equal(g.players[0].trash.length, 0);
});

test('T021 — Damage heals at end of every turn', () => {
  let g = S0();
  const u = put(g, P1, 'V(4)', 'base', { damage: 2 });
  g = nextTurn(g);
  assert.equal(g.objects[u].damage, 0);
});

test('T022 — "This turn" effects expire after end-of-turn triggers', () => {
  let g = S0();
  const u = put(g, P0, 'V(2)', 'base');
  mod(g, u, { might: 3, duration: 'endOfTurn' });
  put(g, P0, 'EOTBurn', 'base');
  assert.equal(mightOf(g, u), 5);
  const log = new EventLog();
  g = log.act(g, { type: 'endTurn', player: P0 });
  g = log.passAll(g);
  const dmg = log.of('damage').filter(e => e.obj === u);
  assert.equal(dmg.length, 1, 'end-of-turn trigger saw Might 5 and dealt damage');
  assert.equal(dmg[0].amount, 4);
  assert.ok(!log.of('die').some(e => e.obj === u), 'unit (Might 5, 4 damage) survives');
  assert.equal(zone(g, u), 'base');
  assert.equal(mightOf(g, u), 2, 'this-turn bonus expired');
  assert.equal(g.objects[u].damage, 0, 'healed');
});

test('T023 — Stun clears at end of turn', () => {
  let g = S0();
  const u = put(g, P1, 'V(2)', 'base');
  [g] = cast(g, P0, 'StunA', { targets: [[u]] });
  g = resolveChain(g);
  assert.equal(g.objects[u].stunned, true);
  g = nextTurn(g);
  expectPending(g, 'mainAction', P1);
  assert.ok(!g.objects[u].stunned, 'not stunned during P1\'s turn');
});

test('T024 — Main phase ends only by declaring end of turn', () => {
  let g = S0();
  const v = hand(g, P0, 'V(1)');
  expectPending(g, 'mainAction', P0);
  g = play(g, P0, v, { dest: 'base' });
  expectPending(g, 'mainAction', P0, 'still P0\'s main phase after an action');
  const h = S0();
  setRunes(h, P0, 0);
  expectPending(h, 'mainAction', P0, 'with nothing affordable, still waits for endTurn');
  assert.ok(legal(h, P0).some(a => a.type === 'endTurn'));
});

test('T025 — Only TP may act in Neutral Open', () => {
  const g = S0();
  hand(g, P1, 'ZapR');
  put(g, P0, 'V(2)', 'base');
  assert.deepEqual(legal(g, P1), [], 'P1 has no legal actions');
  assert.equal(validateAction(g, { type: 'concede', player: P1 }), null, 'concede is always allowed');
  assert.notEqual(validateAction(g, { type: 'pass', player: P1 }), null);
});

test('T026 — Turn order alternates; turn counter', () => {
  let g = S0();
  const t = g.turn;
  const h1 = g.players[1].hand.length;
  const r1 = g.players[1].runesInPlay.length;
  g = nextTurn(g);
  expectPending(g, 'mainAction', P1);
  assert.equal(g.activePlayer, 1);
  assert.equal(g.turn, t + 1);
  assert.equal(g.players[1].hand.length, h1 + 1, 'P1 drew');
  assert.equal(g.players[1].runesInPlay.length, r1 + 2, 'P1 channeled 2');
  g = nextTurn(g);
  assert.equal(g.activePlayer, 0);
});

test('T027 — Units enter exhausted, gear enters ready', () => {
  let g = S0();
  let u: string, s: string;
  [g, u] = cast(g, P0, 'V(2)', { dest: 'base' });
  assert.equal(zone(g, u), 'base');
  assert.equal(g.objects[u].exhausted, true, 'unit enters exhausted');
  [g, s] = cast(g, P0, 'Sword', { dest: 'base' });
  assert.equal(zone(g, s), 'base');
  assert.equal(g.objects[s].exhausted, false, 'gear enters ready');
});

test('T028 — Unit play location', () => {
  const g = S0();
  put(g, P0, 'V(1)', BF_A);
  control(g, BF_A, P0);
  const v = hand(g, P0, 'V(2)');
  assert.deepEqual(playDests(g, P0, v).sort(), [0, 'base'].sort() as never, 'base and BF-A only');
  assert.notEqual(validateAction(g, { type: 'playCard', player: P0, obj: v, destination: BF_B }), null, 'not BF-B');
});

test('T029 — Gear location', () => {
  const g = S0();
  put(g, P0, 'V(1)', BF_A);
  control(g, BF_A, P0);
  const s = hand(g, P0, 'Sword');
  assert.deepEqual(playDests(g, P0, s), ['base']);
  assert.notEqual(validateAction(g, { type: 'playCard', player: P0, obj: s, destination: BF_A }), null);
});

test('T030 — Concede any time', () => {
  let g = S0();
  const v = put(g, P1, 'V(3)', 'base');
  [g] = cast(g, P0, 'ZapM', { targets: [[v]] });
  g = pass(g);
  expectPending(g, 'chainResponse', P1);
  assert.equal(validateAction(g, { type: 'concede', player: P0 }), null);
  g = act(g, { type: 'concede', player: P0 });
  assert.equal(g.winner, 1);
  assert.equal(g.phase, 'gameOver');
});

void yes; void canPlayNow; void locOf; void setBattlefieldCard; void pend;

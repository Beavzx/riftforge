// docs/rules-tests.md §C — Playing cards, costs, timing (T031-T048)
import { test } from 'node:test';
import {
  assert, S0, put, hand, cast, play, pass, passN, endTurn, expectPending, legal, canPlayNow, control, setRunes, addRunes, act,
  move, P0, P1, BF_A, BF_B, mightOf, readyRunes, exhaustedRunes, zone, resolveChain, validateAction, answer, pend, nextTurn,
} from './harness.ts';

test('T031 — Cost payment: energy + power', () => {
  const g = S0();
  const rs = setRunes(g, P0, 4);
  const c = hand(g, P0, 'Cost3R');
  // both plans described by the CR are legal
  assert.equal(validateAction(g, { type: 'playCard', player: P0, obj: c, destination: 'base', payment: { exhaust: rs.slice(0, 3), recycle: [rs[3]] } }), null, 'exhaust 3 + recycle the 4th');
  assert.equal(validateAction(g, { type: 'playCard', player: P0, obj: c, destination: 'base', payment: { exhaust: rs, recycle: [rs[0]] } }), null, 'exhaust 4 then recycle an exhausted one');
  // auto-pay
  const s = play(g, P0, c, { dest: 'base' });
  assert.equal(zone(s, c), 'base');
  assert.equal(s.players[0].runesInPlay.length, 3, '1 rune recycled');
  assert.equal(s.players[0].runeDeck.length, 7);
  // Lead decision (rules-decisions #31): both plans are legal; auto-pay recycles an already-exhausted rune,
  // which leaves the player one more READY rune than the spec's example plan — strictly better, so the spec line is superseded.
  assert.equal(exhaustedRunes(s, P0), 2, 'auto-pay: exhaust 3, recycle one of the exhausted runes, 1 rune stays ready');
  assert.equal(readyRunes(s, P0), 1);
});

test('T031b — auto-pay exhausts a ready rune before recycling it (rules-decisions #65): the [1] floats in the pool', () => {
  let g = S0();
  setRunes(g, P0, 4);
  const seal = hand(g, P0, 'Seal of Rage');           // [0][R]: power only
  g = play(g, P0, seal, { dest: 'base' });
  assert.equal(zone(g, seal), 'base');
  assert.equal(g.players[0].runesInPlay.length, 3, 'one rune recycled for [R]');
  assert.equal(g.players[0].pool.energy, 1, 'its energy was taken first and floats in the pool (CR 316.1)');
  assert.equal(readyRunes(g, P0), 3, 'the other runes are untouched');
  const v1 = hand(g, P0, 'V(1)');
  g = play(g, P0, v1, { dest: 'base' });
  assert.equal(zone(g, v1), 'base');
  assert.equal(g.players[0].pool.energy, 0, 'the follow-up [1] card used the floating energy');
  assert.equal(readyRunes(g, P0), 3, 'no other rune exhausted');
});

test('T032 — Can\'t pay → can\'t play', () => {
  const g = S0();
  const c = hand(g, P0, 'V(7)');
  assert.ok(!canPlayNow(g, P0, c));
  assert.notEqual(validateAction(g, { type: 'playCard', player: P0, obj: c, destination: 'base' }), null);
});

test('T033 — Power of the wrong domain can\'t pay', () => {
  const g = S0();
  const c = hand(g, P0, 'CalmDraw');           // [1][G]
  assert.ok(!canPlayNow(g, P0, c), 'Fury runes cannot pay [G]');
  put(g, P0, 'Gold', 'base');
  assert.ok(canPlayNow(g, P0, c), 'Gold token [A] can pay [G]');
});

test('T034 — [C] on a multi-domain card', () => {
  const mk = (d: 'fury' | 'chaos' | 'mind') => { const g = S0(); setRunes(g, P0, 3, d); const c = hand(g, P0, 'FuryChaosDraw'); return canPlayNow(g, P0, c); };
  assert.ok(mk('fury'), 'payable with Fury');
  assert.ok(mk('chaos'), 'payable with Chaos');
  assert.ok(!mk('mind'), 'not with Mind');
});

test('T035 — Main-speed spell timing', () => {
  let g = S0();
  const v = put(g, P1, 'V(3)', 'base');
  const z = hand(g, P0, 'ZapM');
  assert.ok(canPlayNow(g, P0, z), 'playable in Neutral Open main phase');
  // on the chain
  let c = S0();
  const vc = put(c, P1, 'V(3)', 'base');
  const zc = hand(c, P0, 'ZapM');
  [c] = cast(c, P0, 'ZapA', { targets: [[vc]] });
  expectPending(c, 'chainResponse', P0);
  assert.ok(!canPlayNow(c, P0, zc), 'not in response on the chain');
  // in a showdown
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_A);
  expectPending(g, 'showdownAction', P0);
  assert.ok(!canPlayNow(g, P0, z), 'not during a showdown');
  // on P1's turn
  let h = S0({ tp: P1 });
  const zh = hand(h, P0, 'ZapM');
  put(h, P0, 'V(2)', 'base');
  assert.ok(!canPlayNow(h, P0, zh), 'not on P1\'s turn');
  void v; void h; h = h;
});

test('T036 — Action spell timing', () => {
  let g = S0();
  put(g, P1, 'V(3)', 'base');
  const za = hand(g, P0, 'ZapA');
  const zb = hand(g, P1, 'ZapA');
  assert.ok(canPlayNow(g, P0, za), 'Neutral Open (TP)');
  const u = put(g, P0, 'V(3)', 'base');
  g = move(g, P0, [u], BF_A);
  expectPending(g, 'showdownAction', P0);
  assert.ok(canPlayNow(g, P0, za), 'Showdown Open by the focus holder (TP)');
  g = pass(g);
  expectPending(g, 'showdownAction', P1);
  assert.ok(canPlayNow(g, P1, zb), 'Showdown Open by the focus holder (non-TP)');
  // not as a chain response
  [g] = cast(g, P1, 'ZapA', { targets: [[u]] });
  const d = pend(g);
  assert.equal(d.kind, 'chainResponse');
  assert.ok(!canPlayNow(g, d.player, d.player === 0 ? za : zb), 'not as a chain response (Closed)');
});

test('T037 — Reaction spell timing', () => {
  // Neutral Open by the TP
  let g = S0();
  const v1 = put(g, P1, 'V(3)', 'base');
  const r0 = hand(g, P0, 'ZapR');
  const r1 = hand(g, P1, 'ZapR');
  assert.ok(canPlayNow(g, P0, r0), 'Neutral Open by the TP');
  // chain response on the opponent's turn
  [g] = cast(g, P0, 'ZapM', { targets: [[v1]] });
  g = pass(g);
  expectPending(g, 'chainResponse', P1);
  assert.ok(canPlayNow(g, P1, r1), 'as a chain response on the opponent\'s turn');
  // chain response on own turn
  let h = S0();
  const w = put(h, P1, 'V(3)', 'base');
  const rh = hand(h, P0, 'ZapR');
  [h] = cast(h, P0, 'ZapM', { targets: [[w]] });
  expectPending(h, 'chainResponse', P0);
  assert.ok(canPlayNow(h, P0, rh), 'as a chain response on own turn');
  // in a showdown with focus
  let s = S0();
  const rs = hand(s, P0, 'ZapR');
  const u = put(s, P0, 'V(2)', 'base');
  s = move(s, P0, [u], BF_A);
  expectPending(s, 'showdownAction', P0);
  assert.ok(canPlayNow(s, P0, rs), 'in a showdown with focus');
});

test('T038 — Reaction in opponent\'s ending step', () => {
  let g = S0();
  put(g, P0, 'EOTDraw', 'base');
  put(g, P0, 'V(3)', 'base');
  const r1 = hand(g, P1, 'ZapR');
  g = endTurn(g, P0);
  expectPending(g, 'chainResponse', P0, 'end-of-turn trigger on the chain; its controller has priority');
  g = pass(g);
  expectPending(g, 'chainResponse', P1);
  assert.ok(canPlayNow(g, P1, r1), 'P1 may play ZapR in response in the ending step');
  // without a chain in the ending step P1 never gets priority
  let h = S0();
  hand(h, P1, 'ZapR');
  h = endTurn(h, P0);
  const d = pend(h);
  assert.equal(d.kind, 'mainAction', 'no decision for P1 during P0\'s ending step');
  assert.equal(d.player, 1);
  assert.equal(h.activePlayer, 1);
});

test('T039 — Units resolve immediately, can\'t be responded to', () => {
  let g = S0();
  let u: string;
  [g, u] = cast(g, P0, 'V(3)', { dest: 'base' });
  expectPending(g, 'mainAction', P0, 'no chainResponse for the unit itself');
  assert.equal(zone(g, u), 'base');
  assert.equal(g.chain.length, 0);
});

test('T040 — Play trigger of a unit can be responded to', () => {
  let g = S0();
  const v = put(g, P1, 'V(2)', BF_A);
  control(g, BF_A, P1);
  const mr = hand(g, P1, 'MoveR');
  const cr = hand(g, P1, 'CounterR');
  let u: string;
  [g, u] = cast(g, P0, 'PlayDeal2', { dest: 'base', targets: [[v]] });
  assert.equal(zone(g, u), 'base', 'the unit is on the board');
  assert.equal(g.chain.length, 1, 'the play trigger is on the chain');
  assert.equal(g.chain[0].kind, 'trigger');
  expectPending(g, 'chainResponse', P0);
  g = pass(g);
  expectPending(g, 'chainResponse', P1, 'P1 gets priority and may respond');
  assert.ok(!canPlayNow(g, P1, cr), 'CounterR can\'t counter an ability');
  g = play(g, P1, mr, { targets: [[v]] });
  g = resolveChain(g);
  assert.equal(zone(g, v), 'trash', 'damage still dealt at base (2 damage kills V(2))');
});

test('T041 — Spell on the chain: opponent responds', () => {
  let g = S0();
  const v = put(g, P1, 'V(2)', BF_A);
  control(g, BF_A, P1);
  const pa = hand(g, P1, 'PumpA');
  const pr = hand(g, P1, 'PumpR');
  [g] = cast(g, P0, 'ZapM', { targets: [[v]] });
  g = pass(g);
  expectPending(g, 'chainResponse', P1);
  assert.notEqual(validateAction(g, { type: 'playCard', player: P1, obj: pa }), null, 'PumpA rejected in a Closed state');
  g = play(g, P1, pr, { targets: [[v]] });
  expectPending(g, 'chainResponse', P1);
  g = passN(g, 2);
  assert.equal(g.chain.length, 1, 'PumpR resolved');
  assert.equal(mightOf(g, v), 5);
  g = resolveChain(g);
  assert.equal(zone(g, v), 'battlefield', 'V(2) survives');
  assert.equal(mightOf(g, v), 5);
  assert.equal(g.objects[v].damage, 2);
});

test('T042 — Illegal target on resolution (all targets) → nothing', () => {
  let g = S0();
  const v = put(g, P1, 'V(3)', BF_A);
  control(g, BF_A, P1);
  const mr = hand(g, P1, 'MoveR');
  let k: string;
  [g, k] = cast(g, P0, 'KillA', { targets: [[v]] });
  g = pass(g);
  g = play(g, P1, mr, { targets: [[v]] });
  g = resolveChain(g);
  assert.equal(zone(g, v), 'base', 'target survived at base');
  assert.equal(zone(g, k), 'trash', 'KillA goes to trash');
  assert.ok(g.ex.playedThisTurn[0].includes(k), 'KillA still counts as played');
});

test('T043 — Partial illegal targets', () => {
  let g = S0();
  const x = put(g, P1, 'V(3)', 'base');
  const y = put(g, P1, 'V(2)', 'base');
  const zr = hand(g, P1, 'ZapR');
  [g] = cast(g, P0, 'UpTo2Zap', { targets: [[x, y]] });
  g = pass(g);
  g = play(g, P1, zr, { targets: [[y]] });
  g = resolveChain(g);
  assert.equal(zone(g, y), 'trash', 'Y left the board');
  assert.equal(g.objects[x].damage, 2, 'X takes 2');
  expectPending(g, 'mainAction', P0);
});

test('T044 — Target that changed zones and came back is a new object', () => {
  let g = S0();
  const u = put(g, P1, 'V(3)', 'base');
  const br = hand(g, P1, 'BounceReplay');
  [g] = cast(g, P0, 'ZapM', { targets: [[u]] });
  g = pass(g);
  g = play(g, P1, br, { targets: [[u]] });
  g = resolveChain(g);
  assert.equal(zone(g, u), 'base', 'U was replayed');
  assert.equal(g.objects[u].damage, 0, 'ZapM did nothing to the new U');
});

test('T045 — Countered spell: no refund, not played', () => {
  let g = S0();
  const v = put(g, P1, 'V(3)', 'base');
  put(g, P0, 'SpellWatcher', 'base');
  const l = hand(g, P0, 'LegionDraw');
  const cr = hand(g, P1, 'CounterR');
  let z: string;
  [g, z] = cast(g, P0, 'ZapM', { targets: [[v]] });
  // P0 passes (possibly over own triggers) until P1 can respond
  for (let i = 0; i < 6 && !(g.pending?.kind === 'chainResponse' && g.pending.player === 1); i++) g = pass(g);
  expectPending(g, 'chainResponse', P1);
  const zItem = g.chain.find(c => c.source === z)!;
  g = play(g, P1, cr, { targets: [[zItem.id]] });
  g = resolveChain(g);
  assert.equal(zone(g, z), 'trash', 'countered ZapM in P0\'s trash');
  assert.equal(g.objects[v].damage, 0);
  assert.equal(exhaustedRunes(g, P0), 1, 'P0\'s resources stay spent (no refund)');
  const hBefore = g.players[0].hand.length;                  // LegionDraw only, if no SpellWatcher draw
  g = play(g, P0, l, { dest: 'base' });
  g = resolveChain(g);
  assert.equal(g.players[0].hand.length, hBefore - 1 + 1, 'Legion active: the countered card was finalized this turn (draw 1)');
  assert.equal(hBefore, 1, '"when you play a spell" did NOT trigger for the countered spell (no SpellWatcher draw)');
});

test('T046 — Optional additional cost: Accelerate', () => {
  // total cost with Accelerate = [3] + [1][R] = [4][R]: 4 energy + 1 Fury power
  let g = S0();
  setRunes(g, P0, 5);
  let a: string;
  [g, a] = cast(g, P0, 'Accel(3)', { dest: 'base', may: [true] });
  assert.equal(zone(g, a), 'base');
  assert.equal(g.objects[a].exhausted, false, 'enters ready');
  assert.equal(g.players[0].runeDeck.length, 7, 'exactly 1 rune recycled for [R]');
  const exhaustedOrRecycled = exhaustedRunes(g, P0) + 1;
  assert.ok(exhaustedOrRecycled >= 4, '4 energy paid');
  // boundary: with 3 runes the Accelerate option ([4][R]) is not affordable / not offered
  let t = S0();
  setRunes(t, P0, 3);
  const c = hand(t, P0, 'Accel(3)');
  t = act(t, { type: 'playCard', player: P0, obj: c, destination: 'base' });
  assert.ok(!(t.pending?.kind === 'optional'), 'Accelerate not offered when [4][R] is unaffordable');
  assert.equal(zone(t, c), 'base');
  assert.equal(t.objects[c].exhausted, true);
  // without Accelerate: [3], exhausted
  let h = S0();
  setRunes(h, P0, 5);
  let b: string;
  [h, b] = cast(h, P0, 'Accel(3)', { dest: 'base', may: [false] });
  assert.equal(h.objects[b].exhausted, true, 'without Accelerate: exhausted');
  assert.equal(exhaustedRunes(h, P0), 3, 'paid [3]');
  assert.equal(h.players[0].runeDeck.length, 6, 'no power paid');
});

test('T047 — Cost floor', () => {
  let g = S0();
  setRunes(g, P0, 0);
  put(g, P0, 'Discount2', 'base');
  put(g, P0, 'Discount1', 'base');
  const v = hand(g, P0, 'V(2)');
  assert.ok(canPlayNow(g, P0, v), 'cost [0]: playable with no runes');
  g = play(g, P0, v, { dest: 'base' });
  assert.equal(zone(g, v), 'base');
});

test('T048 — Cost of a token is 0 for "cost" checks', () => {
  let g = S0();
  const gold = put(g, P1, 'Gold', 'base');
  const pp = hand(g, P0, 'Pickpocket');
  g = act(g, { type: 'playCard', player: P0, obj: pp, destination: 'base' });
  // optional trigger; then the target choice: Gold must be offered
  g = answer(g, { may: [true] }, P0);
  const d = pend(g);
  if (d.kind === 'chooseTargets') {
    assert.ok((d.options ?? []).some(o => o.id === gold), 'Gold is a legal choice');
    g = answer(g, { targets: [[gold]] }, P0);
  }
  g = resolveChain(g);
  assert.ok(!g.objects[gold], 'P1\'s Gold killed (token ceases to exist)');
  const mine = g.players[0].base.filter(id => g.objects[id].cardId === 'cf-gold');
  assert.equal(mine.length, 1, 'P0 plays a Gold token');
  assert.equal(g.objects[mine[0]].exhausted, true, 'exhausted');
});

void addRunes; void BF_B; void nextTurn;

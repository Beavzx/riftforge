// docs/rules-tests.md §J — Keywords (T133-T167)
import { test } from 'node:test';
import {
  assert, S0, put, hand, cast, play, pass, passN, expectPending, control, act, move, mod, nextTurn, endTurn, EventLog, setRunes,
  P0, P1, BF_A, BF_B, zone, locOf, mightOf, hasKeyword, kwValue, resolveChain, passAll, pend, answer, yes, no, choose,
  legal, canPlayNow, playDests, moveDests, validateAction, rejects, activate, readyRunes, exhaustedRunes, optionIds, attackSetup,
  type GameState, type ObjId,
} from './harness.ts';

const runeDeck = (g: GameState, p: number) => g.players[p].runeDeck.length;
function toDamage(g: GameState, log?: EventLog): GameState {
  for (let i = 0; i < 30; i++) {
    const d = g.pending;
    if (!d || d.inStep || (d.kind !== 'showdownAction' && d.kind !== 'chainResponse')) return g;
    g = log ? log.pass(g) : pass(g);
  }
  return g;
}
const suggested = (g: GameState) => (pend(g).data as { suggested: Record<ObjId, number> }).suggested;

test('T133 — Accelerate with domainless unit', () => {
  let g = S0();
  setRunes(g, P0, 3, 'mind');                      // domainless unit: Accelerate power is [A]
  let u: string;
  [g, u] = cast(g, P0, 'AccelColorless(2)', { dest: 'base', may: [true] });
  assert.equal(g.objects[u].exhausted, false, 'Accelerate paid with Mind power');
});

test('T134 — Accelerate entering ready doesn\'t trigger "becomes ready"', () => {
  let g = S0();
  put(g, P0, 'ReadyWatch', 'base');
  const h0 = g.players[0].hand.length;
  let u: string;
  [g, u] = cast(g, P0, 'Accel(2)', { dest: 'base', may: [true] });
  g = resolveChain(g);
  assert.equal(g.objects[u].exhausted, false);
  assert.equal(g.players[0].hand.length, h0, '"when a unit becomes ready" did not fire');
});

test('T135 — Assault stacking', () => {
  const g0 = S0();
  put(g0, P1, 'V(9)', BF_A, { stunned: true });
  control(g0, BF_A, P1);
  const a = put(g0, P0, 'Assault(1,1)', 'base');
  mod(g0, a, { addKeywords: ['Assault 2'], layer: 2 });
  const g = move(g0, P0, [a], BF_A);
  assert.equal(g.objects[a].combatRole, 'attacker');
  assert.equal(mightOf(g, a), 4, '1 + Assault 1 + Assault 2');
});

test('T136 — Shield only while defending', () => {
  const { g, atk } = attackSetup(['Shield(2,2)'], ['V(9)'], { defOpts: [{ stunned: true }] });
  assert.equal(mightOf(g, atk[0]), 2);
});

test('T137 — Deflect tax', () => {
  // single target: [1] + [A]
  let g = S0();
  const d = put(g, P1, 'Deflect(3,1)', BF_A);
  control(g, BF_A, P1);
  const rd = runeDeck(g, P0);
  [g] = cast(g, P0, 'ZapM', { targets: [[d]] });
  assert.equal(runeDeck(g, P0), rd + 1, 'one rune recycled for the [A] tax');
  // two targets incl. the Deflect unit: +[A] once
  let h = S0();
  const d2 = put(h, P1, 'Deflect(3,1)', BF_A);
  const o2 = put(h, P1, 'V(3)', BF_A);
  control(h, BF_A, P1);
  const rd2 = runeDeck(h, P0);
  [h] = cast(h, P0, 'TwoZap', { targets: [[d2, o2]] });
  assert.equal(runeDeck(h, P0), rd2 + 1, 'tax charged once');
  // P1's own spell targeting it: no tax
  let k = S0();
  const d3 = put(k, P1, 'Deflect(3,1)', BF_A);
  control(k, BF_A, P1);
  const w = put(k, P1, 'V(5)', 'base');
  [k] = cast(k, P0, 'ZapM', { targets: [[w]] });
  k = pass(k);
  const rd3 = runeDeck(k, P1);
  [k] = cast(k, P1, 'ZapR', { targets: [[d3]] });
  assert.equal(runeDeck(k, P1), rd3, 'no tax for its controller');
});

test('T138 — Deflect stacks; Heisho ignores', () => {
  let g = S0();
  const d = put(g, P1, 'DeflectDouble(2)', BF_A);
  control(g, BF_A, P1);
  assert.equal(kwValue(g, d, 'Deflect'), 3, 'Deflect + Deflect 2 = Deflect 3');
  const rd = runeDeck(g, P0);
  [g] = cast(g, P0, 'ZapM', { targets: [[d]] });
  assert.equal(runeDeck(g, P0), rd + 3, 'tax [A][A][A]');
  let h = S0({ bfA: 'cf-bf-heisho' });
  const e = put(h, P1, 'DeflectDouble(2)', BF_A);
  control(h, BF_A, P1);
  const rd2 = runeDeck(h, P0);
  [h] = cast(h, P0, 'ZapM', { targets: [[e]] });
  assert.equal(runeDeck(h, P0), rd2, 'no tax at Heisho');
});

test('T139 — Ganking route', () => {
  const g = S0();
  const gk = put(g, P0, 'Ganker(2)', BF_A);
  control(g, BF_A, P0);
  assert.deepEqual(moveDests(g, P0, gk).sort(), [BF_B, 'base'].sort() as never);
});

test('T140 — Hide: cost, location, once per battlefield', () => {
  let g = S0();
  setRunes(g, P0, 1);
  put(g, P0, 'V(1)', BF_A);
  control(g, BF_A, P0);
  const h = hand(g, P0, 'HidU(2)');
  const h2 = hand(g, P0, 'HidU(3)');
  assert.notEqual(validateAction(g, { type: 'hide', player: P0, obj: h, battlefieldIndex: BF_B }), null, 'can\'t hide at an uncontrolled battlefield');
  assert.equal(validateAction(g, { type: 'hide', player: P0, obj: h, battlefieldIndex: BF_A }), null);
  g = act(g, { type: 'hide', player: P0, obj: h, battlefieldIndex: BF_A });
  assert.equal(zone(g, h), 'facedown');
  assert.equal(g.players[0].runesInPlay.length, 0, '[A]: one rune recycled');
  setRunes(g, P0, 2);
  assert.notEqual(validateAction(g, { type: 'hide', player: P0, obj: h2, battlefieldIndex: BF_A }), null, 'only one facedown card per battlefield');
  // not during a showdown
  let s = S0();
  put(s, P0, 'V(1)', BF_A);
  control(s, BF_A, P0);
  const hh = hand(s, P0, 'HidU(2)');
  const m = put(s, P0, 'V(1)', 'base');
  s = move(s, P0, [m], BF_B);
  expectPending(s, 'showdownAction', P0);
  assert.notEqual(validateAction(s, { type: 'hide', player: P0, obj: hh, battlefieldIndex: BF_A }), null, 'can\'t hide during a showdown');
});

test('T141 — Hidden card can\'t be played the turn it was hidden', () => {
  let g = S0();
  put(g, P0, 'V(1)', BF_A);
  control(g, BF_A, P0);
  const h = hand(g, P0, 'HidU(2)');
  g = act(g, { type: 'hide', player: P0, obj: h, battlefieldIndex: BF_A });
  assert.ok(!canPlayNow(g, P0, h), 'no play action the same turn');
  g = nextTurn(g);
  expectPending(g, 'mainAction', P1);
  const w = put(g, P0, 'V(5)', 'base');
  [g] = cast(g, P1, 'ZapM', { targets: [[w]] });
  g = pass(g);
  expectPending(g, 'chainResponse', P0);
  assert.ok(canPlayNow(g, P0, h, BF_A), 'on P1\'s next turn it may be played as a Reaction');
});

test('T142 — Hidden card playable on opponent\'s turn without a chain? (showdown)', () => {
  let g = S0({ tp: P1 });
  put(g, P0, 'V(1)', BF_A);
  control(g, BF_A, P0);
  const h = put(g, P0, 'HidU(2)', { facedown: BF_A });
  assert.deepEqual(legal(g, P0), [], 'P1\'s Neutral Open: P0 has no priority');
  const a = put(g, P1, 'V(3)', 'base');
  g = move(g, P1, [a], BF_A);
  expectPending(g, 'showdownAction', P1);
  g = pass(g);
  expectPending(g, 'showdownAction', P0);
  assert.ok(canPlayNow(g, P0, h, BF_A), 'P0 (focus, Showdown Open) may play it');
});

test('T143 — Hidden spell targets restricted to that battlefield', () => {
  let g = S0({ tp: P1 });
  const a = put(g, P0, 'V(1)', BF_A);
  const b = put(g, P0, 'V(2)', BF_A);
  control(g, BF_A, P0);
  const hz = put(g, P0, 'HidZap', { facedown: BF_A });
  const e = put(g, P1, 'V(3)', 'base');
  [g] = cast(g, P1, 'ZapM', { targets: [[e]] });
  g = pass(g);
  expectPending(g, 'chainResponse', P0);
  assert.ok(canPlayNow(g, P0, hz));
  const s = act(g, { type: 'playCard', player: P0, obj: hz });
  const d = pend(s);
  assert.equal(d.kind, 'chooseTargets');
  assert.deepEqual(optionIds(s).sort(), [a, b].sort(), 'only units at BF-A (not the unit in a base)');
  // with no unit at BF-A it can't be played from facedown
  let k = S0({ tp: P1 });
  put(k, P0, 'Gold', BF_A);
  control(k, BF_A, P0);
  const hz2 = put(k, P0, 'HidZap', { facedown: BF_A });
  const e2 = put(k, P1, 'V(3)', 'base');
  [k] = cast(k, P1, 'ZapM', { targets: [[e2]] });
  k = pass(k);
  assert.ok(!canPlayNow(k, P0, hz2), 'no legal target at BF-A → can\'t be played from facedown');
});

test('T144 — Hidden permanent must be played to that battlefield', () => {
  let g = S0({ tp: P1 });
  put(g, P0, 'V(1)', BF_A);
  control(g, BF_A, P0);
  put(g, P0, 'V(1)', BF_B);
  control(g, BF_B, P0);
  const h = put(g, P0, 'HidU(2)', { facedown: BF_A });
  const e = put(g, P1, 'V(5)', 'base');
  [g] = cast(g, P1, 'ZapM', { targets: [[e]] });
  g = pass(g);
  assert.deepEqual(playDests(g, P0, h), [BF_A], 'destination forced to BF-A');
});

test('T145 — Playing a Hidden card normally from hand', () => {
  let g = S0();
  put(g, P0, 'V(1)', BF_A);
  control(g, BF_A, P0);
  const h = hand(g, P0, 'HidU(2)');
  assert.deepEqual(playDests(g, P0, h).sort(), [BF_A, 'base'].sort() as never, 'no location restriction');
  g = play(g, P0, h, { dest: 'base' });
  assert.equal(exhaustedRunes(g, P0), 2, 'pays full cost');
});

test('T146 — Hidden card trashed if you lose control', () => {
  let g = S0({ tp: P1 });
  put(g, P0, 'V(1)', BF_A);
  control(g, BF_A, P0);
  const fd = put(g, P0, 'HidU(2)', { facedown: BF_A });
  const a = put(g, P1, 'V(3)', 'base');
  g = move(g, P1, [a], BF_A);
  for (let i = 0; i < 10 && g.showdown && !pend(g).inStep; i++) g = pass(g);
  assert.equal(g.battlefields[BF_A].controller, 1);
  assert.equal(zone(g, fd), 'trash');
});

test('T147 — Legion', () => {
  let g = S0();
  const l1 = hand(g, P0, 'LegionDraw');
  const h0 = g.players[0].hand.length;
  g = play(g, P0, l1, { dest: 'base' });
  g = resolveChain(g);
  assert.equal(g.players[0].hand.length, h0 - 1, 'first card of the turn → no draw');
  // another card finalized (even if countered) → draw
  let c = S0();
  const v = put(c, P1, 'V(5)', 'base');
  const cr = hand(c, P1, 'CounterR');
  [c] = cast(c, P0, 'ZapM', { targets: [[v]] });
  c = pass(c);
  c = play(c, P1, cr, { targets: [[c.chain[0].id]] });
  c = resolveChain(c);
  const l2 = hand(c, P0, 'LegionDraw');
  const h1 = c.players[0].hand.length;
  c = play(c, P0, l2, { dest: 'base' });
  c = resolveChain(c);
  assert.equal(c.players[0].hand.length, h1 - 1 + 1, 'Legion active after a countered card');
  // a token played / an activated ability doesn't enable it
  let t = S0();
  const av = put(t, P0, 'AvianLike(2)', 'base');
  const tgt = put(t, P0, 'V(1)', 'base');
  t = activate(t, P0, av, 0, { targets: [[tgt]] });
  t = resolveChain(t);
  const l3 = hand(t, P0, 'LegionDraw');
  const h2 = t.players[0].hand.length;
  t = play(t, P0, l3, { dest: 'base' });
  t = resolveChain(t);
  assert.equal(t.players[0].hand.length, h2 - 1, 'activated ability does not enable Legion');
});

test('T148 — Tank ordering among multiple Tanks', () => {
  let { g, def } = attackSetup(['V(5)'], ['Tank(3)', 'Tank(3)', 'V(1)']);
  g = toDamage(g);
  expectPending(g, 'assignDamage', P0);
  const [t1, t2, v] = def;
  const ok = (a: Record<string, number>) => validateAction(g, { type: 'assignDamage', player: P0, assignment: a });
  assert.equal(ok({ [t1]: 3, [t2]: 2 }), null);
  assert.equal(ok({ [t1]: 2, [t2]: 3 }), null);
  assert.notEqual(ok({ [t1]: 3, [t2]: 1, [v]: 1 }), null, 'V(1) gets 0 until both Tanks are lethal');
});

test('T149 — Temporary dies before scoring', () => {
  let g = S0({ tp: P1 });
  const t = put(g, P0, 'Temp(3)', BF_A);
  control(g, BF_A, P0);
  g = nextTurn(g);
  expectPending(g, 'mainAction', P0);
  assert.equal(zone(g, t), 'trash', 'Temporary killed at the start of the Beginning phase');
  assert.equal(g.battlefields[BF_A].controller, null, 'control lost before scoring');
  assert.equal(g.players[0].points, 0, 'no hold point');
});

test('T150 — Vision', () => {
  let g = S0();
  const top = g.players[0].mainDeck[0];
  [g] = cast(g, P0, 'Vision(1)', { dest: 'base' });
  if (pend(g).kind === 'chainResponse') g = passN(g, 2);
  const d = pend(g);
  assert.ok(d.inStep, `Vision asks (look at top card, may recycle), got ${d.kind}`);
  assert.equal(d.player, 0);
  assert.deepEqual(optionIds(g), [top]);
  assert.equal(d.min ?? 0, 0, 'recycling is optional');
  g = choose(g, top);
  g = resolveChain(g);
  assert.equal(g.players[0].mainDeck[g.players[0].mainDeck.length - 1], top, 'recycled to the bottom');
});

function equipped(): { g: GameState; s: ObjId; u: ObjId } {
  let g = S0();
  const s = put(g, P0, 'Sword', 'base');
  const u = put(g, P0, 'V(2)', BF_A);
  control(g, BF_A, P0);
  g = activate(g, P0, s, 900, { targets: [[u]] });
  g = resolveChain(g);
  return { g, s, u };
}

test('T151 — Equip', () => {
  const { g, s, u } = equipped();
  assert.equal(mightOf(g, u), 4);
  assert.equal(g.objects[s].attachedTo, u);
  assert.equal(locOf(g, s), BF_A, 'Sword located at BF-A');
  assert.ok(!legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === s), 'Equip no longer activatable');
});

test('T152 — Equipped unit dies', () => {
  let { g, s, u } = equipped();
  [g] = cast(g, P0, 'KillA', { targets: [[u]] });
  g = resolveChain(g);
  assert.equal(zone(g, u), 'trash');
  assert.equal(g.objects[s].attachedTo, undefined);
  assert.equal(locOf(g, s), 'base', 'recalled at the cleanup');
  put(g, P0, 'V(1)', 'base');
  assert.ok(legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === s), 'can be equipped again');
});

test('T153 — Quick-Draw', () => {
  let { g, atk, def } = attackSetup(['V(2)'], ['V(3)']);
  const ax = hand(g, P0, 'SpinAxe');
  g = pass(g);
  [g] = cast(g, P1, 'PumpA', { targets: [[def[0]]] });     // put something on the chain
  g = pass(g);
  expectPending(g, 'chainResponse', P0);
  assert.ok(canPlayNow(g, P0, ax), 'Quick-Draw: playable as a Reaction');
  g = play(g, P0, ax, { dest: 'base' });
  g = answer(g, { cards: [[atk[0]]], targets: [[atk[0]]] }, P0);
  g = resolveChain(g);
  assert.equal(g.objects[ax].attachedTo, atk[0], 'attached by its play effect (no Equip cost)');
  assert.equal(mightOf(g, atk[0]), 5, 'V(2) + 3');
});

test('T154 — Weaponmaster cost reduction', () => {
  // R-10 (CR 821.1.c, 403.2): the Equipment is chosen (chooseTargets, optional) as the trigger goes on the chain
  // Equip [1]: pay [1] to move the Sword from A onto B
  const setup = (sword: string) => {
    const g = S0();
    const a = put(g, P0, 'V(2)', 'base');
    const s = put(g, P0, sword, 'base');
    g.objects[s].attachedTo = a; g.ex.attachCount = (g.ex.attachCount ?? 0) + 1;
    return { g, a, s };
  };
  let { g, s } = setup('Sword');
  let b: string;
  const r0 = readyRunes(g, P0);
  [g, b] = cast(g, P0, 'Weaponmaster(2)', { dest: 'base' });
  const r1 = readyRunes(g, P0);
  g = answer(g, { may: [true], cards: [[s]], targets: [[s]] }, P0);
  g = resolveChain(g);
  g = answer(g, { may: [true], cards: [[s]], targets: [[s]] }, P0);
  assert.equal(g.objects[s].attachedTo, b, 'Sword moved onto B');
  assert.equal(r1 - readyRunes(g, P0), 1, 'paid [1]');
  void r0;
  // Equip [A]: reattach is free
  let h = setup('SwordA');
  let b2: string;
  [h.g, b2] = cast(h.g, P0, 'Weaponmaster(2)', { dest: 'base' });
  const rd = h.g.players[0].runeDeck.length, rr = readyRunes(h.g, P0);
  h.g = answer(h.g, { may: [true], cards: [[h.s]], targets: [[h.s]] }, P0);
  h.g = resolveChain(h.g);
  h.g = answer(h.g, { may: [true], cards: [[h.s]], targets: [[h.s]] }, P0);
  assert.equal(h.g.objects[h.s].attachedTo, b2);
  assert.equal(h.g.players[0].runeDeck.length, rd, 'free: no power paid');
  assert.equal(readyRunes(h.g, P0), rr, 'free: no energy paid');
  // may decline
  let k = setup('Sword');
  [k.g] = cast(k.g, P0, 'Weaponmaster(2)', { dest: 'base' });
  k.g = answer(k.g, { may: [false], cards: [[]], targets: [[]] }, P0);
  k.g = resolveChain(k.g);
  k.g = answer(k.g, { may: [false], cards: [[]], targets: [[]] }, P0);
  assert.equal(k.g.objects[k.s].attachedTo, k.a, 'declined: stays where it is');
});

test('T155 — Repeat', () => {
  let g = S0();
  put(g, P0, 'SpellWatcher', 'base');
  const x = put(g, P1, 'V(5)', 'base');
  const y = put(g, P1, 'V(6)', 'base');
  const h0 = g.players[0].hand.length;
  const rp = hand(g, P0, 'RepeatZap');
  g = play(g, P0, rp, { targets: [[x]], may: [true] });
  const log = new EventLog();
  g = log.passAll(g);
  expectPending(g, 'chooseTargets', P0, 'Repeat: second target chosen anew');
  g = log.choose(g, y);
  g = log.passAll(g);
  g = resolveChain(g);
  const dmg = log.of('damage');
  assert.equal(g.objects[x].damage, 1, 'first instance');
  assert.equal(g.objects[y].damage, 1, 'second instance, target chosen anew');
  assert.equal(dmg.filter(e => e.obj === x || e.obj === y).length, 2, 'two separate damage instances');
  assert.equal(g.players[0].hand.length, h0 + 1, '"when you play a spell" triggers once (RepeatZap left the hand, one draw)');
});

test('T156 — Ambush location requirements', () => {
  // (a) legal destinations: base, battlefields P0 controls, battlefields where P0 has units
  const g = S0();
  put(g, P0, 'V(1)', BF_A);
  control(g, BF_A, P0);
  const amb = hand(g, P0, 'Ambusher(3)');
  assert.deepEqual(playDests(g, P0, amb).sort(), [BF_A, 'base'].sort() as never, 'no units at BF-B → not offered');
  const h = S0();
  put(h, P0, 'V(1)', BF_B);                         // P0 has a unit at a battlefield they don't control
  put(h, P1, 'V(1)', BF_B);
  control(h, BF_B, P1);
  const amb2 = hand(h, P0, 'Ambusher(3)');
  assert.ok(playDests(h, P0, amb2).includes(BF_B), 'battlefield where P0 has ≥1 unit is offered');
  // (b) INFERENCE: P0's only unit there is killed paying an additional cost → play undone
  const k = S0();
  const only = put(k, P0, 'V(1)', BF_B);
  put(k, P1, 'V(1)', BF_B);
  control(k, BF_B, P1);
  const ap = hand(k, P0, 'AmbushPatron(3)');
  let s = act(k, { type: 'playCard', player: P0, obj: ap, destination: BF_B });
  s = answer(s, { cards: [[only]] }, P0);
  assert.equal(zone(s, ap), 'hand', 'play undone (Check Legality fails)');
  assert.equal(locOf(s, only), BF_B, 'the killed-for-cost unit is restored');
});

test('T157 — Hunt and Level', () => {
  let g = S0();
  let s1: string;
  [g, s1] = cast(g, P0, 'ScorchLike(2)', { dest: 'base' });
  assert.equal(g.objects[s1].exhausted, true);
  assert.equal(mightOf(g, s1), 2);
  g.objects[s1].exhausted = false;
  g = move(g, P0, [s1], BF_A);
  g = passN(g, 2);
  g = resolveChain(g);
  assert.equal(g.players[0].xp, 2, 'Hunt 2 on conquer');
  let s2: string;
  [g, s2] = cast(g, P0, 'ScorchLike(2)', { dest: 'base' });
  assert.equal(g.objects[s2].exhausted, true, 'at 2 XP still exhausted');
  g.players[0].xp = 3;
  let s3: string;
  [g, s3] = cast(g, P0, 'ScorchLike(2)', { dest: 'base' });
  assert.equal(g.objects[s3].exhausted, false, 'at 3 XP enters ready');
  assert.equal(mightOf(g, s3), 3, '+1 Might');
  g.players[0].xp = 2;
  assert.equal(mightOf(g, s3), 2, 'below 3 XP the bonus is gone');
});

test('T158 — Empower / Empowered', () => {
  let g = S0();
  const p = put(g, P0, 'PoroLike(2)', 'base');
  const c = hand(g, P0, 'V(1)');
  assert.ok(legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === p && a.abilityIndex === 901), 'Empower activatable');
  g = activate(g, P0, p, 901, { cards: [[c]] });
  g = resolveChain(g);
  assert.equal(zone(g, c), 'trash', 'discarded 1');
  assert.ok((g.objects[p].empowered ?? 0) > 0, 'Empowered');
  assert.equal(mightOf(g, p), 3);
  hand(g, P0, 'V(1)');
  assert.ok(!legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === p && a.abilityIndex === 901), 'can\'t activate again while Empowered');
  [g] = cast(g, P0, 'BounceM', { targets: [[p]] });
  g = resolveChain(g);
  assert.equal(zone(g, p), 'hand');
  assert.ok(!g.objects[p].empowered, 'returning to hand clears Empowered');
});

test('T159 — Flow', () => {
  let g = S0();
  const bs = put(g, P0, 'BrittleLike', 'trash');
  const gear = put(g, P1, 'Sword', 'base');
  assert.ok(canPlayNow(g, P0, bs), 'playable from trash for [4][C]');
  g = play(g, P0, bs, { targets: [[gear]] });
  assert.equal(g.players[0].runeDeck.length, 7, '[C] paid');
  g = resolveChain(g);
  assert.equal(zone(g, gear), 'trash');
  assert.equal(zone(g, bs), 'banishment', 'banished after resolution, not trashed');
  // countered → banished
  let h = S0();
  const bs2 = put(h, P0, 'BrittleLike', 'trash');
  const gear2 = put(h, P1, 'Sword', 'base');
  const cr = hand(h, P1, 'CounterR');
  h = play(h, P0, bs2, { targets: [[gear2]] });
  h = pass(h);
  h = play(h, P1, cr, { targets: [[h.chain[0].id]] });
  h = resolveChain(h);
  assert.equal(zone(h, bs2), 'banishment', 'countered Flow card is banished');
});

test('T160 — Deploy', () => {
  let g = S0();
  put(g, P1, 'V(1)', BF_B);
  control(g, BF_B, P1);
  const bn = hand(g, P0, 'BannerLike');
  const ds = playDests(g, P0, bn);
  assert.ok(ds.includes(BF_A), 'uncontrolled empty battlefield');
  assert.ok(ds.includes(BF_B), 'enemy battlefield');
  g = play(g, P0, bn, { dest: BF_B });
  g = resolveChain(g);
  assert.equal(locOf(g, bn), BF_B, 'stays there through cleanups');
  assert.equal(g.battlefields[BF_B].contested, false, 'not a unit → doesn\'t contest');
  assert.equal(g.showdown, null);
  g = nextTurn(g);                                  // P1 holds BF-B
  assert.equal(zone(g, bn), 'trash', 'opponent holds → Banner dies');
});

test('T161 — Disarm', () => {
  const g0 = S0();
  const e = put(g0, P1, 'V(5)', BF_A);
  control(g0, BF_A, P1);
  const c = put(g0, P0, 'ChronoLike(3)', 'base');
  mod(g0, c, { addKeywords: ['Disarm 1'], layer: 2 });
  let g = move(g0, P0, [c], BF_A);
  g = answer(g, { targets: [[e]] }, P0);           // target choice (auto if only one enemy there)
  const disarms = g.chain.filter(i => i.source === c && i.kind === 'trigger');
  assert.equal(disarms.length, 1, 'two Disarm sources on one unit → one trigger');
  assert.deepEqual(disarms[0].targets, [[e]], 'targets an enemy unit there');
  g = resolveChain(g);
  assert.equal(mightOf(g, e), 2, 'combined value: −3 this turn');
});

test('T162 — Show Off', () => {
  let g = S0();
  const mech = hand(g, P0, 'Mech(2)');
  const c = hand(g, P0, 'ConstructLike(3)');
  g = act(g, { type: 'playCard', player: P0, obj: c, destination: 'base' });
  const d = pend(g);
  assert.equal(d.kind, 'chooseCards', 'may show off a Mech');
  assert.ok(optionIds(g).includes(mech));
  g = choose(g, mech);
  assert.equal(g.objects[c].exhausted, false, 'enters ready');
  // a facedown card can't be shown off
  let h = S0();
  put(h, P0, 'V(1)', BF_A);
  control(h, BF_A, P0);
  put(h, P0, 'Mech(2)', { facedown: BF_A });
  const c2 = hand(h, P0, 'ConstructLike(3)');
  h = act(h, { type: 'playCard', player: P0, obj: c2, destination: 'base' });
  assert.ok(!(h.pending?.inStep), 'no show-off choice');
  assert.equal(h.objects[c2].exhausted, true);
});

test('T163 — Buff max 1', () => {
  let g = S0();
  const v = put(g, P0, 'V(2)', 'base', { buff: true });
  [g] = cast(g, P0, 'BuffM', { targets: [[v]] });
  g = resolveChain(g);
  assert.equal(mightOf(g, v), 3, 'buffing a buffed unit does nothing');
  const av = put(g, P0, 'AvianLike(2)', 'base');
  g = activate(g, P0, av, 0, { targets: [[v]] });
  g = resolveChain(g);
  assert.equal(mightOf(g, v), 5, 'Avian: already buffed → +2 this turn instead');
});

test('T164 — Stun can\'t be re-applied', () => {
  let g = S0();
  put(g, P0, 'StunWatch', 'base');
  const s = put(g, P1, 'V(2)', 'base', { stunned: true });
  const h0 = g.players[0].hand.length;
  [g] = cast(g, P0, 'StunA', { targets: [[s]] });
  g = resolveChain(g);
  assert.equal(g.players[0].hand.length, h0, 'no "when you stun" trigger');
  const t = put(g, P1, 'V(2)', 'base');
  [g] = cast(g, P0, 'StunA', { targets: [[t]] });
  g = resolveChain(g);
  assert.equal(g.players[0].hand.length, h0 + 1, 'fixture sanity: stunning an unstunned unit triggers');
});

test('T165 — Predict 2', () => {
  let g = S0();
  const [t1, t2] = g.players[0].mainDeck;
  [g] = cast(g, P0, 'Predict2M');
  g = passN(g, 2);
  const d = pend(g);
  assert.equal(d.player, 0);
  assert.deepEqual(optionIds(g).sort(), [t1, t2].sort(), 'shows top 2');
  assert.equal(d.min ?? 0, 0);
  g = choose(g);                                   // recycle none
  const o = pend(g);
  assert.ok(o.inStep, 'order decision for the rest');
  g = choose(g, t2);
  assert.deepEqual(g.players[0].mainDeck.slice(0, 2), [t2, t1], 'chosen order on top');
});

test('T166 — Burn', () => {
  let g = S0();
  const [a, b] = g.players[0].mainDeck;
  [g] = cast(g, P0, 'Burn2M');
  g = passN(g, 2);
  assert.equal(zone(g, a), 'trash');
  assert.equal(zone(g, b), 'trash');
  // with 1 card: burn 1, burn out, burn 1 more
  let h = S0();
  for (const id of h.players[0].mainDeck.slice(1)) delete h.objects[id];
  h.players[0].mainDeck = h.players[0].mainDeck.slice(0, 1);
  const only = h.players[0].mainDeck[0];
  [h] = cast(h, P0, 'Burn2M');
  h = passN(h, 2);
  assert.equal(h.players[1].points, 1, 'burn out');
  assert.equal(zone(h, only), 'trash', 'the first burned card was shuffled back and burned again');
  assert.equal(h.players[0].mainDeck.length, 0);
});

test('T167 — Gold token', () => {
  let g = S0();
  setRunes(g, P0, 1);
  const gold = put(g, P0, 'Gold', 'base');
  const c = hand(g, P0, 'CalmDraw');
  g = play(g, P0, c);
  assert.equal(zone(g, c), 'chain', 'paid using Gold mid-payment');
  assert.ok(!g.objects[gold], 'the Gold token ceased to exist');
  assert.ok(!g.players[0].trash.includes(gold), 'not in trash');
});

void yes; void no; void endTurn; void hasKeyword; void rejects; void suggested;

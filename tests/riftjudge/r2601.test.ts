// Rift Judge verification, range r2601 (question ids 2601-3900). One test per question; see
// docs/riftjudge/r2601.md for the log. Real cards are used where the question names them.
import { test } from 'node:test';
import {
  assert, S0, put, hand, cast, play, pass, passN, expectPending, control, act, move, mod, nextTurn, endTurn, EventLog, setRunes,
  P0, P1, BF_A, BF_B, zone, locOf, mightOf, resolveChain, passAll, pend, answer, choose, legal, canPlayNow, playDests,
  validateAction, readyRunes, optionIds, chainLabels, attackSetup, cid, realCard, setBattlefieldCard, addRunes, fundAll, hasKeyword, rejects, newGame, clearDeck, fillTrash, getView, kwValue as kwValueOf, moveDests,
  type GameState, type ObjId, type PlayerId,
} from '../conformance/harness.ts';
import { putF } from './r2601-fixtures.ts';
import { withTokens, drive as driveAns, unitsNamed } from './r11701.helpers.ts';
import { playCostOf, attachNow } from '../../src/engine/testkit.ts';
import { chars } from '../../src/engine/chars.ts';
import { validateDeck, createGame } from '../../src/engine/index.ts';
import { fixtureDb } from '../fixtures/conformance/cards.ts';
import { legalDeck } from '../conformance/harness.ts';

import { settle, setLegend, stackTop, drive } from './r2601-fixtures.ts';
const handN = (g: GameState, p: PlayerId) => g.players[p].hand.length;
const clearTrash = (g: GameState, p: PlayerId) => { for (const id of g.players[p].trash) delete g.objects[id]; g.players[p].trash = []; g.timestamp++; };

// ---------------------------------------------------------------------------------------------
test('RJ#2601 "When you play me" is a trigger; player orders it with "when you play another unit"', () => {
  let g = S0();
  putF(g, P0, 'rjf-otherplay', 'base');
  const u = putF(g, P0, 'rjf-selfplay', 'hand');
  g = act(g, { type: 'playCard', player: P0, obj: u, destination: 'base' });
  g = answer(g, {}, P0);
  const d = pend(g);
  assert.equal(d.kind, 'orderTriggers');
  assert.equal(d.player, P0);
  assert.equal(d.options!.length, 2);
  assert.equal(zone(g, u), 'base', 'the unit is already in play when its play trigger fires');
  const h = handN(g, P0);
  g = choose(g, d.options![0].id);
  if (pend(g).kind === 'orderTriggers') g = choose(g, pend(g).options![0].id);
  g = settle(g);
  assert.equal(handN(g, P0), h + 2);
});

test('RJ#2602 Snapvine: Deflect is paid for its target; Unyielding Spirit does not prevent the unit-sourced damage', () => {
  let h = S0();
  fundAll(h, P0); fundAll(h, P1);
  const e2 = put(h, P1, 'V(3)', BF_A);
  control(h, BF_A, P1);
  [h] = cast(h, P0, 'Unyielding Spirit');
  h = settle(h);
  const sv = hand(h, P0, 'Carnivorous Snapvine');
  h = play(h, P0, sv, { dest: 'base', targets: [[e2]] });
  h = settle(h);
  assert.equal(zone(h, e2), 'trash', '6 damage from Snapvine (CR 418.6.b.3: the units are the source, not the ability)');
  assert.equal(h.objects[sv].damage, 3);
  // Deflect: the trigger choosing an enemy Deflect unit asks for the Deflect tax
  let k = S0();
  fundAll(k, P0);
  const d = put(k, P1, 'Deflect(3,1)', BF_A); control(k, BF_A, P1);
  k = play(k, P0, hand(k, P0, 'Carnivorous Snapvine'), { dest: 'base' });
  assert.ok(/Deflect/.test(pend(k).prompt), 'Deflect payment offered for the trigger');
  k = drive(k, x => (pend(x).kind === 'optional' ? ['yes'] : null));
  assert.equal(zone(k, d), 'trash');
});

test('RJ#2603 Pirate\'s Haven: +1 Might to units readied in Awaken / by effects; not to units entering ready (Accelerate)', () => {
  let g = S0({ tp: P1 });
  put(g, P0, "Pirate's Haven", 'base');
  const u = put(g, P0, 'V(2)', 'base', { ready: false });
  g = nextTurn(g);
  assert.equal(g.activePlayer, P0);
  assert.equal(mightOf(g, u), 3, 'readied in Awaken: +1');
  let a: ObjId;
  [g, a] = cast(g, P0, 'Accel(2)', { dest: 'base', may: [true] });
  g = settle(g);
  assert.equal(g.objects[a].exhausted, false, 'entered ready');
  assert.equal(mightOf(g, a), 2, 'entering ready is not "readying"');
});

test('RJ#2604 Damage is healed at end of combat even when no unit dies', () => {
  let { g, atk, def } = attackSetup(['V(3)'], ['V(5)'], { defOpts: [{ stunned: true }] });
  g = settle(g);
  assert.equal(zone(g, atk[0]), 'base', 'attacker recalled (defender survived)');
  assert.equal(locOf(g, def[0]), BF_A);
  assert.equal(g.objects[def[0]].damage, 0, 'defender healed after combat');
});

test('RJ#2606 Loose Cannon: trigger goes on the chain regardless of hand size; condition checked on resolution', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0);
  setLegend(g, P0, 'Loose Cannon');
  hand(g, P0, 'AddR'); hand(g, P0, 'AddR');
  g = endTurn(g, P1);
  for (let i = 0; i < 10 && !(pend(g).kind === 'chainResponse' && g.chain.length); i++) g = act(g, legal(g, pend(g).player)[0]);
  assert.ok(g.chain.length >= 1, 'Loose Cannon trigger is on the chain with 2 cards in hand');
  expectPending(g, 'chainResponse', P0);
  // P0 empties their hand in response
  for (const id of [...g.players[P0].hand]) { g = act(g, { type: 'playCard', player: P0, obj: id }); g = answer(g, {}, P0); }
  assert.equal(handN(g, P0), 0);
  g = resolveChain(g);
  // SCRIPT-FIX: the Draw Phase follows right after the Beginning Phase chain empties, so 1 (Loose Cannon) + 1 (Draw Phase)
  assert.equal(handN(g, P0), 2, 'drew 1 on resolution (0 cards then), then the Draw Phase draw');
});

test('RJ#2608 Dazzling Aurora: additional costs (Cruel Patron) still apply; unpayable -> not played, stays banished', () => {
  let g = S0();
  put(g, P0, 'Dazzling Aurora', 'base');
  const f = put(g, P0, 'V(1)', 'base');
  const [cp] = stackTop(g, P0, 'Cruel Patron');
  g = endTurn(g, P0);
  g = answer(g, { targets: [[f]] }, P0);
  g = settle(g);
  assert.equal(zone(g, f), 'trash', 'the friendly unit was killed as the additional cost');
  assert.ok(['base', 'battlefield'].includes(zone(g, cp)), 'Patron played');
  let h = S0();
  put(h, P0, 'Dazzling Aurora', 'base');
  const [cp2] = stackTop(h, P0, 'Cruel Patron');
  h = endTurn(h, P0);
  h = settle(h);
  assert.equal(zone(h, cp2), 'banishment', 'no friendly unit to kill: Patron can\'t be played and stays banished (Aurora banishes first)');
});

test('RJ#2609 Zenith Blade moving a friendly unit from The Dreaming Tree chooses it -> draw', () => {
  let g = S0();
  fundAll(g, P0);
  setBattlefieldCard(g, BF_A, 'The Dreaming Tree');
  control(g, BF_A, P0);
  const f = put(g, P0, 'V(2)', BF_A);
  const e = put(g, P1, 'V(2)', BF_B);
  control(g, BF_B, P1);
  const h0 = handN(g, P0);
  const zb = hand(g, P0, 'Zenith Blade');
  g = play(g, P0, zb, { targets: [[f]] }); // the only enemy unit at a battlefield is auto-chosen
  g = settle(g);
  if (g.pending?.kind === 'optional') g = settle(act(g, { type: 'choose', player: P0, optionIds: ['yes'] }));   // RJ#5998b: move? on resolution
  assert.equal(locOf(g, f), BF_B);
  assert.equal(zone(g, e), 'trash', 'stunned defender lost the combat');
  assert.equal(handN(g, P0), h0 + 1, 'Zenith Blade added then played (net 0), +1 Dreaming Tree draw');
});

test('RJ#2610 Stacked Deck looking at three Nocturnes: all three may be played', () => {
  let g = S0();
  fundAll(g, P0);
  const ns = stackTop(g, P0, 'Nocturne, Horrifying', 'Nocturne, Horrifying', 'Nocturne, Horrifying');
  [g] = cast(g, P0, 'Stacked Deck');
  g = settle(g);
  for (let i = 0; i < 20; i++) {
    const d = g.pending!;
    if (d.kind === 'optional') g = choose(g, 'yes');
    else if (d.kind === 'chooseDestination') g = choose(g, 'base');
    else if (d.inStep) g = act(g, legal(g, d.player)[0]);
    else if (d.kind === 'chainResponse') g = pass(g);
    else break;
  }
  for (const n of ns) assert.equal(zone(g, n), 'base', 'each Nocturne was banished and played for [A]');
});

test('RJ#2611 Both players may bring the same battlefield; both stay in play', () => {
  let g = newGame({ battlefieldChoice: 'choose', p1: { battlefields: ['cf-bf-a', 'cf-bf-d', 'cf-bf-e'] } });
  for (let i = 0; i < 4 && g.pending && g.pending.kind === 'chooseBattlefield'; i++) {
    const d = g.pending; g = act(g, { type: 'choose', player: d.player, optionIds: [d.options!.find(o => /BF-A/.test(o.label))!.id] });
  }
  assert.deepEqual(g.battlefields.map(b => g.cards[g.objects[b.objId].cardId].name), ['BF-A', 'BF-A']);
});

test('RJ#2613 The Boss can save (recall) a buffed unit that is already in base', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  setLegend(g, P0, 'The Boss');
  const u = put(g, P0, 'V(1)', 'base', { buff: true }); // 2 Might with the buff
  g = endTurn(g, P0);
  g = settle(g);
  [g] = cast(g, P1, 'ZapM', { targets: [[u]] });
  g = settle(g);
  g = answer(g, { may: [true] }, P0);
  g = settle(g);
  assert.equal(zone(g, u), 'base', 'healed, exhausted and recalled (to the base it is already in)');
  assert.equal(g.objects[u].damage, 0);
  assert.equal(g.objects[u].exhausted, true);
  assert.equal(g.objects[u].counters.buff ?? 0, 0);
});

test('RJ#2615 A hidden Teemo is played for [0]: its power cost is not paid either', () => {
  let g = S0();
  control(g, BF_A, P0);
  const t = put(g, P0, 'Teemo, Strategist', { facedown: BF_A });
  setRunes(g, P0, 0);
  assert.ok(canPlayNow(g, P0, t), 'playable from facedown with no runes at all');
  g = act(g, { type: 'playCard', player: P0, obj: t });
  g = settle(g);
  assert.equal(locOf(g, t), BF_A);
});

test('RJ#2616 Passing in a showdown does not lock you out: after the opponent\'s En Garde resolves you may still play Cleave', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const a = put(g, P0, 'V(2)', 'base');
  put(g, P1, 'V(2)', 'base');
  const eg = hand(g, P1, 'En Garde');
  const cl = hand(g, P0, 'Cleave');
  g = move(g, P0, [a], BF_A);
  expectPending(g, 'showdownAction', P0);
  g = pass(g);
  expectPending(g, 'showdownAction', P1);
  g = play(g, P1, eg, { targets: [[g.players[P1].base[0]]] });
  g = resolveChain(g);
  for (let i = 0; i < 4 && !(pend(g).kind === 'showdownAction' && pend(g).player === P0); i++) g = pass(g);
  expectPending(g, 'showdownAction', P0);
  assert.ok(canPlayNow(g, P0, cl), 'P0 may act again');
});

test('RJ#2617 Exhaust a rune for energy, then recycle the same rune to pay a Seal; the energy stays in the pool', () => {
  let g = S0();
  const rs = setRunes(g, P0, 1, 'fury');
  const ab = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === rs[0])!;
  g = act(g, ab);
  assert.equal(g.players[P0].pool.energy, 1);
  const s = hand(g, P0, 'Seal of Rage');
  g = act(g, { type: 'playCard', player: P0, obj: s, payment: { exhaust: [], recycle: [rs[0]] } });
  assert.equal(zone(g, s), 'base');
  assert.equal(g.players[P0].pool.energy, 1, 'energy still in the pool');
  const v = hand(g, P0, 'V(1)');
  assert.ok(canPlayNow(g, P0, v), 'leftover energy pays a 1-cost unit');
});

test('RJ#2618 A battlefield can be contested several times a turn, but scored only once', () => {
  let g = S0();
  const d = put(g, P1, 'V(3)', BF_A);
  control(g, BF_A, P1);
  const a1 = put(g, P0, 'V(1)', 'base');
  g = settle(move(g, P0, [a1], BF_A));
  assert.equal(zone(g, a1), 'trash', 'first contest lost');
  const a2 = put(g, P0, 'V(5)', 'base');
  g = settle(move(g, P0, [a2], BF_A));
  assert.equal(zone(g, d), 'trash');
  assert.equal(g.players[P0].points, 1, 'conquered');
  // P1 retakes it (setup) and P0 conquers it again the same turn: no second point
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const a3 = put(g, P0, 'V(5)', 'base');
  g = settle(move(g, P0, [a3], BF_A));
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[P0].points, 1, 'no second score for the same battlefield this turn');
});

test('RJ#2620 Several Immortal Phoenixes in the trash each trigger from one spell kill', () => {
  let g = S0();
  fundAll(g, P0);
  const ph = [put(g, P0, 'Immortal Phoenix', 'trash'), put(g, P0, 'Immortal Phoenix', 'trash')];
  const e = put(g, P1, 'V(1)', BF_A);
  control(g, BF_A, P1);
  [g] = cast(g, P0, 'KillA', { targets: [[e]] });
  for (let i = 0; i < 30; i++) {
    const d = g.pending!;
    if (d.kind === 'optional') g = choose(g, 'yes');
    else if (d.kind === 'chooseDestination') g = choose(g, 'base');
    else if (d.inStep) g = act(g, legal(g, d.player)[0]);
    else if (d.kind === 'chainResponse') g = pass(g);
    else break;
  }
  for (const p of ph) assert.equal(zone(g, p), 'base', 'both Phoenixes played from the trash');
});

test('RJ#2612 Smoke Screen to 1 Might, then Assault 2 still adds: 3 Might while attacking', () => {
  let g = S0();
  fundAll(g, P0);
  const u = put(g, P0, 'Assault(4,2)', 'base');
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'Smoke Screen', { targets: [[u]] });
  g = settle(g);
  assert.equal(mightOf(g, u), 1);
  g = move(g, P0, [u], BF_A);
  assert.equal(mightOf(g, u), 3, '1 + Assault 2 while attacking');
});

test('RJ#2621 Baited Hook: the unit played ignoring its cost may still pay Accelerate and enter ready', () => {
  let g = S0();
  fundAll(g, P0);
  const hook = put(g, P0, 'Baited Hook', 'base');
  const f = put(g, P0, 'V(2)', 'base');
  const [ac] = stackTop(g, P0, 'Accel(3)');
  const ab = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === hook)!;
  g = act(g, ab);
  for (let i = 0; i < 20; i++) {
    const d = g.pending!;
    if (d.kind === 'chooseTargets') g = choose(g, f);
    else if (d.kind === 'chooseCards') g = choose(g, ac);
    else if (d.kind === 'optional') g = choose(g, 'yes');
    else if (d.kind === 'chooseDestination') g = choose(g, 'base');
    else if (d.inStep) g = act(g, legal(g, d.player)[0]);
    else if (d.kind === 'chainResponse') g = pass(g);
    else break;
  }
  assert.equal(zone(g, f), 'trash');
  assert.equal(zone(g, ac), 'base');
  assert.equal(g.objects[ac].exhausted, false, 'Accelerate paid: enters ready');
});

test('RJ#2624 A hidden unit played from facedown enters exhausted', () => {
  let g = S0();
  control(g, BF_A, P0);
  const t = put(g, P0, 'HidU(2)', { facedown: BF_A });
  g = act(g, { type: 'playCard', player: P0, obj: t });
  g = settle(g);
  assert.equal(locOf(g, t), BF_A);
  assert.equal(g.objects[t].exhausted, true);
});

test('RJ#2625 Immortal Phoenix killed by your own spell may be played from the trash; killed in combat it may not', () => {
  let g = S0();
  fundAll(g, P0);
  const ph = put(g, P0, 'Immortal Phoenix', 'base');
  [g] = cast(g, P0, 'Vengeance', { targets: [[ph]] });
  g = settle(g);
  assert.equal(pend(g).kind, 'optional', 'Phoenix in the trash sees its own spell death');
  g = choose(g, 'yes');
  g = answer(g, { dest: 'base' }, P0);
  g = settle(g);
  assert.equal(zone(g, ph), 'base');
  // combat death: no trigger
  let { g: h, atk } = attackSetup(['Immortal Phoenix'], ['V(9)']);
  fundAll(h, P0);
  h = settle(h);
  assert.equal(zone(h, atk[0]), 'trash');
  assert.notEqual(pend(h).kind, 'optional');
});

test('RJ#2626 Smoke Screen snapshots the reduction: 3 Might -> 1, then +5 -> 6', () => {
  let g = S0();
  fundAll(g, P0);
  const u = put(g, P0, 'V(3)', 'base');
  [g] = cast(g, P0, 'Smoke Screen', { targets: [[u]] });
  g = settle(g);
  assert.equal(mightOf(g, u), 1);
  mod(g, u, { might: 5 });
  assert.equal(mightOf(g, u), 6);
});

test('RJ#2628 Spell counters cannot counter a unit being played', () => {
  let g = S0();
  fundAll(g, P1);
  const cr = hand(g, P1, 'CounterR');
  const v = hand(g, P0, 'V(2)');
  g = act(g, { type: 'playCard', player: P0, obj: v, destination: 'base' });
  if (g.chain.length) {
    g = pass(g);
    expectPending(g, 'chainResponse', P1);
    assert.equal(canPlayNow(g, P1, cr), false, 'no spell on the chain to counter');
  } else assert.equal(zone(g, v), 'base', 'unit entered without being a counterable spell');
});

test('RJ#2629 An exhausted unit at a battlefield still defends', () => {
  let { g, atk, def } = attackSetup(['V(3)'], ['V(3)'], { defOpts: [{ ready: false }] });
  g = settle(g);
  assert.equal(zone(g, atk[0]), 'trash', 'the exhausted defender dealt combat damage');
  assert.equal(zone(g, def[0]), 'trash');
});

test('RJ#2630 Darius, Trifarian gets +2 only after Challenge (his 2nd card) resolves: both 5-Might units die', () => {
  let g = S0();
  fundAll(g, P0);
  const dar = put(g, P0, 'Darius, Trifarian', BF_B);
  control(g, BF_B, P0);
  const e = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'V(0)', { dest: 'base' });
  g = settle(g);
  [g] = cast(g, P0, 'Challenge', { targets: [[dar], [e]] });
  g = settle(g);
  g = answer(g, {}, P0); g = settle(g);
  assert.equal(zone(g, e), 'trash');
  assert.equal(zone(g, dar), 'trash', 'Darius was still 5 Might when Challenge dealt damage');
});

test('RJ#2632 Grand Strategem gives token units +5 too', () => {
  let g = S0();
  fundAll(g, P0);
  const t = put(g, P0, 'V(1)', 'base', { token: true });
  [g] = cast(g, P0, 'Grand Strategem');
  g = settle(g);
  assert.equal(mightOf(g, t), 6);
});

test('RJ#2633 Bullet Time: a rune exhausted for its energy can be recycled for [C] during resolution', () => {
  let g = S0();
  const rs = setRunes(g, P0, 3, 'chaos');
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const bt = hand(g, P0, 'Bullet Time');
  g = act(g, { type: 'playCard', player: P0, obj: bt, payment: { exhaust: [rs[0]], recycle: [] } });
  g = answer(g, { targets: [[g.battlefields[BF_A].objId]] }, P0);
  g = resolveChain(g);
  for (let i = 0; i < 6 && pend(g).inStep; i++) {
    const d = pend(g);
    if (d.kind === 'chooseNumber' || d.kind === 'chooseX') { const o = d.options!.reduce((m, x) => (Number(x.id) > Number(m.id) ? x : m)); g = choose(g, o.id); }
    else g = act(g, legal(g, d.player)[0]);
  }
  g = settle(g);
  assert.equal(zone(g, e), 'trash', '3 damage: all three runes (incl. the exhausted one) recycled for [C]');
});

test('RJ#2635 Flame Chompers: "you may pay [C]" is the trigger\'s base cost, decided when it goes on the chain (official CR 383.3.a/b)', () => {
  let g = S0();
  fundAll(g, P0);
  const fc = put(g, P0, 'Flame Chompers', 'hand');
  const ds = putF(g, P0, 'rjf-discard1', 'hand');
  g = act(g, { type: 'playCard', player: P0, obj: ds });
  g = resolveChain(g);
  g = answer(g, { cards: [[fc]] }, P0);
  assert.equal(zone(g, fc), 'trash');
  const d = pend(g);
  assert.ok(d.inStep && (d.kind === 'optional' || d.kind === 'payment'), `pay/decline offered at finalization, got ${d.kind}`);
  assert.equal(g.chain.filter(c => c.source === fc).length === 0 || g.chain.some(c => c.source === fc && (c as { pending?: boolean }).pending !== false), true);
  g = choose(g, d.kind === 'optional' ? 'no' : d.options![d.options!.length - 1].id);
  assert.equal(g.chain.length, 0, 'declined: removed, as if it never triggered');
  assert.equal(zone(g, fc), 'trash');
});

test('RJ#2636 Lux, Crownguard\'s spell-only [2] can be split over two spells', () => {
  let g = S0();
  setRunes(g, P0, 0);
  const lux = put(g, P0, 'Lux, Crownguard', 'base');
  const ab = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === lux)!;
  g = act(g, ab);
  const v = put(g, P1, 'V(5)', 'base');
  const s1 = hand(g, P0, 'ZapM'), s2 = hand(g, P0, 'ZapM');
  g = play(g, P0, s1, { targets: [[v]] }); g = resolveChain(g);
  g = play(g, P0, s2, { targets: [[v]] }); g = resolveChain(g);
  assert.equal(zone(g, s1), 'trash'); assert.equal(zone(g, s2), 'trash');
  assert.equal(g.objects[v].damage, 4);
});

test('RJ#2637 A stun lasts the whole turn, across showdowns/combats', () => {
  let { g, def } = attackSetup(['V(3)'], ['V(5)'], { defOpts: [{ stunned: true }] });
  g = settle(g);
  assert.equal(g.objects[def[0]].stunned, true, 'still stunned after the first combat');
  const a2 = put(g, P0, 'V(1)', 'base');
  g = settle(move(g, P0, [a2], BF_A));
  assert.equal(g.objects[a2].damage, 0, 'the stunned defender deals no damage in the second combat');
  assert.equal(zone(g, a2), 'base');
});

test('RJ#2639 No response window when Dazzling Aurora (a gear) is played; its end-of-turn trigger can be responded to', () => {
  let g = S0();
  fundAll(g, P0);
  const au = hand(g, P0, 'Dazzling Aurora');
  stackTop(g, P0, 'V(1)');
  g = act(g, { type: 'playCard', player: P0, obj: au });
  assert.equal(zone(g, au), 'base', 'permanents resolve immediately');
  expectPending(g, 'mainAction', P0);
  g = endTurn(g, P0);
  for (let i = 0; i < 6 && !g.chain.length && pend(g).inStep; i++) g = act(g, legal(g, pend(g).player)[0]);
  assert.ok(g.chain.length >= 1);
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  expectPending(g, 'chainResponse', P1, 'opponent may respond to the trigger');
});

test('RJ#2640 Reduced Might lowers both the damage it takes to kill a unit and the combat damage it deals', () => {
  const g0 = S0();
  const d = put(g0, P1, 'V(3)', BF_A); control(g0, BF_A, P1);
  const a = put(g0, P0, 'V(5)', 'base');
  mod(g0, a, { might: -3 });
  let g = settle(move(g0, P0, [a], BF_A));
  assert.equal(zone(g, a), 'trash', '3 damage kills a 2-Might unit');
  assert.equal(zone(g, d), BF_A === 0 ? 'battlefield' : 'battlefield');
  assert.equal(locOf(g, d), BF_A, 'defender survives 2 damage');
});

test('RJ#2642 "Damaged" means marked damage, not reduced Might (Warwick)', () => {
  let g = S0();
  const w = put(g, P0, 'Warwick', 'base');
  const lowered = put(g, P1, 'V(5)', BF_A);
  const hurt = put(g, P1, 'V(9)', BF_A, { damage: 1 });
  put(g, P1, 'V(9)', BF_A);
  control(g, BF_A, P1);
  mod(g, lowered, { might: -2 });
  g = move(g, P0, [w], BF_A);
  for (let i = 0; i < 6 && g.chain.length; i++) g = g.pending!.inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(zone(g, hurt), 'trash', 'damaged enemy killed');
  assert.equal(locOf(g, lowered), BF_A, 'reduced Might alone is not damaged');
});

test('RJ#2643 Traveling Merchant\'s move trigger still resolves if the Merchant is killed in response', () => {
  let g = S0();
  fundAll(g, P1);
  const m = put(g, P0, 'Traveling Merchant', 'base');
  const c = put(g, P0, 'V(1)', 'hand');
  const k = putF(g, P1, 'rjf-killr', 'hand');
  g = move(g, P0, [m], BF_A);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = act(g, legal(g, pend(g).player)[0]);
  assert.ok(g.chain.some(x => x.source === m), 'move trigger on the chain');
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  assert.ok(canPlayNow(g, P1, k));
  g = play(g, P1, k, { targets: [[m]] }); g = pass(g); g = pass(g);
  assert.equal(zone(g, m), 'trash');
  const h = handN(g, P0);
  for (let i = 0; i < 10 && g.chain.length; i++) { const d = pend(g); g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g); }
  assert.equal(zone(g, c), 'trash', 'discarded');
  assert.equal(handN(g, P0), h, 'discard 1, draw 1');
});

test('RJ#2646 A hold ability (Ahri, Alluring) can score the winning point', () => {
  let g = S0({ tp: P1 });
  const ah = put(g, P0, 'Ahri, Alluring', BF_A);
  control(g, BF_A, P0);
  g.players[P0].points = 6;
  g = endTurn(g, P1);
  for (let i = 0; i < 20 && g.winner == null && g.pending; i++) { const d = pend(g); g = d.inStep ? act(g, legal(g, d.player)[0]) : d.kind === 'mainAction' ? g : pass(g); if (d.kind === 'mainAction') break; }
  void ah;
  assert.equal(g.winner, P0, 'hold point (7) + Ahri (8)');
});

test('RJ#2647 King\'s Edict does not target and the opponent chooses: Deflect is not paid', () => {
  const spent = (card: string) => {
    let g = S0();
    fundAll(g, P0);
    const d = put(g, P1, card, BF_A); control(g, BF_A, P1);
    const ke = hand(g, P0, "King's Edict");
    const before = g.players[P0].runesInPlay.length;
    g = act(g, { type: 'playCard', player: P0, obj: ke });
    g = settle(g);
    const dd = pend(g);
    if (dd.inStep) { assert.equal(dd.player, P1, 'the opponent chooses'); g = act(g, legal(g, P1)[0]); }
    g = settle(g);
    assert.equal(zone(g, d), 'trash');
    return before - readyRunes(g, P0);
  };
  assert.equal(spent('Deflect(3,2)'), spent('V(3)'), 'no Deflect tax');
});

test('RJ#2649 Lux, Illuminated checks the spell\'s cost, not the reduced amount paid (Eager Apprentice)', () => {
  let g = S0();
  fundAll(g, P0);
  const lux = put(g, P0, 'Lux, Illuminated', 'base');
  put(g, P0, 'Eager Apprentice', BF_A); control(g, BF_A, P0);
  const m0 = mightOf(g, lux)!;
  [g] = cast(g, P0, 'Sprite Burst');
  g = drive(g);
  assert.equal(mightOf(g, lux), m0 + 3);
});

test('RJ#2652 Nocturne works with reveal effects too (Teemo, Strategist reveals the top 5)', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0);
  const t = put(g, P0, 'Teemo, Strategist', BF_A); control(g, BF_A, P0);
  const [n] = stackTop(g, P0, 'Nocturne, Horrifying');
  const a = put(g, P1, 'V(3)', 'base');
  g = move(g, P1, [a], BF_A);
  let sawOffer = false;
  g = drive(g, h => { const d = h.pending!; if (d.kind === 'optional' && /Nocturne|banish/i.test(d.prompt)) { sawOffer = true; return ['yes']; } if (d.kind === 'optional') return ['yes']; if (d.kind === 'chooseDestination') return ['base']; return null; });
  assert.ok(sawOffer, 'banish-and-play offered on reveal');
  assert.equal(zone(g, n), 'base');
  void t;
});

test('RJ#2654 Stupefy making existing damage lethal is not "killing with a spell" (Immortal Phoenix does not trigger)', () => {
  let g = S0();
  fundAll(g, P0);
  put(g, P0, 'Immortal Phoenix', 'trash');
  const e = put(g, P1, 'V(3)', BF_A, { damage: 2 }); control(g, BF_A, P1);
  [g] = cast(g, P0, 'Stupefy', { targets: [[e]] });
  g = settle(g);
  assert.equal(zone(g, e), 'trash');
  assert.notEqual(pend(g).kind, 'optional', 'no Phoenix trigger: the cleanup killed it, not the spell');
});

test('RJ#2655 Revealing more cards than the deck holds does not burn out', () => {
  let g = S0({ tp: P1, deck: [1, 20] });
  fundAll(g, P0);
  put(g, P0, 'Teemo, Strategist', BF_A); control(g, BF_A, P0);
  const a = put(g, P1, 'V(3)', 'base');
  const p1pts = g.players[P1].points;
  g = move(g, P1, [a], BF_A);
  g = drive(g);
  assert.equal(g.players[P1].points, p1pts + (g.battlefields[BF_A].controller === P1 ? 1 : 0), 'no burn-out point for the opponent');
  assert.equal(g.winner ?? null, null);
});

test('RJ#2656 A unit at 0 Might with no damage does not die', () => {
  let g = S0();
  const u = put(g, P0, 'V(2)', 'base');
  [g] = cast(g, P0, 'GiveMinus3', { targets: [[u]] });
  g = settle(g);
  assert.ok((mightOf(g, u) ?? 0) <= 0);
  assert.equal(zone(g, u), 'base');
});

test('RJ#2657 Pirate\'s Haven: "readying" an already-ready unit gives nothing', () => {
  let g = S0();
  put(g, P0, "Pirate's Haven", 'base');
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  [g] = cast(g, P0, 'RideTheWindLike', { targets: [[u]] });
  g = settle(g);
  assert.equal(zone(g, u), 'base');
  assert.equal(mightOf(g, u), 2);
  const x = put(g, P0, 'V(2)', BF_A, { ready: false });
  [g] = cast(g, P0, 'RideTheWindLike', { targets: [[x]] });
  g = settle(g);
  assert.equal(mightOf(g, x), 3, 'control: an exhausted unit readied gets +1');
});

test('RJ#2659 Herald of the Arcane (Viktor legend) has no [Action]: not usable during a showdown', () => {
  let g = S0();
  fundAll(g, P0);
  const lg = setLegend(g, P0, 'Herald of the Arcane');
  assert.ok(legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === lg), 'usable in the open main phase');
  const a = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [a], BF_A);
  expectPending(g, 'showdownAction', P0);
  assert.ok(!legal(g, P0, 'activate').some(a2 => a2.type === 'activate' && a2.obj === lg), 'not during the showdown');
});

test('RJ#2660 Viktor, Leader triggers once per unit that dies, even simultaneously', () => {
  let g = S0();
  fundAll(g, P0);
  put(g, P0, 'Viktor, Leader', 'base');
  put(g, P0, 'V(1)', 'base'); put(g, P0, 'V(2)', 'base');
  [g] = cast(g, P0, 'Avalanche');
  g = drive(g);
  const recruits = g.players[P0].base.filter(id => g.cards[g.objects[id].cardId].name === 'Recruit');
  assert.equal(recruits.length, 2);
});

test('RJ#2663 A hidden card left at a battlefield its controller no longer controls is trashed at cleanup', () => {
  let g = S0();
  const u = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const hc = put(g, P1, 'HidZap', { facedown: BF_A });
  [g] = cast(g, P0, 'Charm', { targets: [[u]], dest: 'base', locations: ['base'] });
  g = drive(g, h => (pend(h).kind === 'chooseDestination' ? ['base'] : null));
  assert.equal(zone(g, u), 'base');
  assert.equal(zone(g, hc), 'trash');
});

test('RJ#2664 Zhonya\'s Hourglass: the saved unit still deals its combat damage', () => {
  const g0 = S0();
  put(g0, P1, "Zhonya's Hourglass", 'base');
  const d = put(g0, P1, 'V(3)', BF_A); control(g0, BF_A, P1);
  const a = put(g0, P0, 'V(3)', 'base');
  let g = drive(move(g0, P0, [a], BF_A));
  assert.equal(zone(g, a), 'trash', 'attacker took 3 from the saved defender');
  assert.equal(zone(g, d), 'base', 'defender healed, exhausted, recalled');
});

test('RJ#2665 No standard moves into a battlefield during a showdown', () => {
  let g = S0();
  const a = put(g, P0, 'V(2)', 'base');
  put(g, P0, 'V(2)', 'base');
  put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [a], BF_A);
  expectPending(g, 'showdownAction', P0);
  assert.equal(legal(g, P0, 'move').length, 0);
});

test('RJ#2666 Fox-Fire fizzles if its target is pumped past the total-Might limit', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const e = put(g, P1, 'V(4)', BF_A); control(g, BF_A, P1);
  const pr = hand(g, P1, 'PumpR');
  [g] = cast(g, P0, 'Fox-Fire, Ahri', { targets: [[e]] });
  if (pend(g).kind === 'chooseTargets') g = choose(g, e);
  g = pass(g);
  g = play(g, P1, pr, { targets: [[e]] });
  g = drive(g);
  assert.equal(locOf(g, e), BF_A, 'not killed');
});

test('RJ#2667 No end-of-turn priority window: the opponent gets no reaction window when the turn just ends', () => {
  let g = S0();
  fundAll(g, P1);
  hand(g, P1, 'DrawR');
  g = endTurn(g, P0);
  const seen: string[] = [];
  for (let i = 0; i < 10 && !(pend(g).kind === 'mainAction'); i++) { seen.push(`${pend(g).kind}:${pend(g).player}`); g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g); }
  assert.equal(pend(g).kind, 'mainAction'); assert.equal(pend(g).player, P1);
  assert.deepEqual(seen.filter(s => s === 'chainResponse:1'), [], 'no priority for P1 at the end of P0\'s turn');
});

test('RJ#2668 Units can be played only to base unless you control a battlefield', () => {
  const g = S0();
  fundAll(g, P0);
  const v = hand(g, P0, 'V(2)');
  assert.deepEqual(playDests(g, P0, v).filter(d => d !== 'base'), []);
  control(g, BF_A, P0);
  assert.ok(playDests(g, P0, v).includes(BF_A));
});

test('RJ#2673 The Boss spending Sett, Brawler\'s buff does not activate his "Spend my buff: +4"', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  setLegend(g, P0, 'The Boss');
  const s = put(g, P0, 'Sett, Brawler', 'base', { buff: true });
  const m0 = mightOf(g, s)!;
  g = endTurn(g, P0); g = settle(g);
  g.objects[s].damage = m0 - 1; g.timestamp++;
  [g] = cast(g, P1, 'ZapM', { targets: [[s]] });
  g = drive(g, h => (pend(h).kind === 'optional' ? ['yes'] : null));
  assert.equal(zone(g, s), 'base');
  assert.equal(g.objects[s].counters.buff ?? 0, 0, 'buff spent by The Boss');
  assert.equal(mightOf(g, s), m0 - 1, 'no +4: only the buff\'s +1 is gone');
});

test('RJ#2674 Wraith of Echoes does not see its own death, nor deaths simultaneous with it (CR 383.2.c.2)', () => {
  for (const others of [0, 1]) {
    let g = S0();
    fundAll(g, P0);
    put(g, P0, 'Wraith of Echoes', 'base', { damage: 4 });
    for (let i = 0; i < others; i++) put(g, P0, 'V(1)', 'base');
    const h0 = handN(g, P0);
    [g] = cast(g, P0, 'Avalanche');
    g = drive(g);
    assert.equal(handN(g, P0), h0, `no draw (others=${others})`);
  }
});

test('RJ#2675 Dazzling Aurora with no unit in the deck: finds nothing, recycles everything, no burn out', () => {
  let g = S0();
  put(g, P0, 'Dazzling Aurora', 'base');
  clearDeck(g, P0);
  stackTop(g, P0, 'ZapM', 'ZapM', 'DrawR');
  g = endTurn(g, P0);
  g = drive(g);
  assert.equal(g.players[P0].mainDeck.length, 3, 'all revealed cards recycled back');
  assert.equal(g.players[P1].points, 0, 'no burn out');
  assert.equal(g.players[P0].banishment.length, 0);
});

test('RJ#2678 Leona attacking at Reaver\'s Row: Leona\'s stun target is chosen before the defender decides Reaver\'s Row', () => {
  let g = S0();
  setBattlefieldCard(g, BF_A, "Reaver's Row");
  const e1 = put(g, P1, 'V(2)', BF_A), e2 = put(g, P1, 'V(2)', BF_A);
  control(g, BF_A, P1);
  const le = put(g, P0, 'Leona, Determined', 'base');
  g = move(g, P0, [le], BF_A);
  const order: string[] = [];
  for (let i = 0; i < 8 && pend(g).inStep; i++) {
    const d = pend(g);
    order.push(`${d.kind}:P${d.player}`);
    // P1 uses Reaver's Row (moves e2): choosing no unit would decline it and remove the trigger (CR 383.3.a)
    g = d.kind === 'chooseTargets' && d.player === P0 ? choose(g, e1) : d.kind === 'chooseTargets' && d.options?.some(o => o.id === e2) ? choose(g, e2) : act(g, legal(g, d.player)[0]);
  }
  const iLeona = order.indexOf('chooseTargets:P0');
  const iRow = order.findIndex(s => s.endsWith(':P1'));
  assert.ok(iLeona >= 0 && iRow > iLeona, `order: ${order.join(', ')}`);
  assert.equal(g.chain.length, 2);
  assert.equal(g.objects[g.chain[g.chain.length - 1].source]?.cardId, g.objects[g.battlefields[BF_A].objId].cardId, 'defender\'s trigger on top: resolves first');
});

test('RJ#2679 Heimerdinger, Inventor copying Garbage Grabber must pay all its costs', () => {
  let g = S0();
  fundAll(g, P0);
  put(g, P0, 'Garbage Grabber', 'base');
  const hm = put(g, P0, 'Heimerdinger, Inventor', 'base');
  clearTrash(g, P0);
  fillTrash(g, P0, 2);
  const heimAct = (h: GameState) => legal(h, P0, 'activate').filter(a => a.type === 'activate' && a.obj === hm);
  assert.equal(heimAct(g).length, 0, 'only 2 cards in trash: can\'t pay "Recycle 3 from your trash"');
  fillTrash(g, P0, 1);
  assert.equal(heimAct(g).length, 1);
  const h0 = handN(g, P0);
  g = act(g, heimAct(g)[0]);
  g = drive(g, h => (pend(h).kind === 'chooseCards' ? pend(h).options!.slice(0, 3).map(o => o.id) : null));
  assert.equal(handN(g, P0), h0 + 1);
  assert.equal(g.objects[hm].exhausted, true);
  assert.equal(g.players[P0].trash.length, 0);
});

test('RJ#2681 Nine-Tailed Fox does not choose (no Deflect); Ahri, Inquisitive chooses and must pay Deflect', () => {
  // Nine-Tailed Fox: P1 has no runes, attacker has Deflect 2: still gets -1
  let g = S0();
  setLegend(g, P1, 'Nine-Tailed Fox');
  setRunes(g, P1, 0);
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'Deflect(9,2)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 6 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(mightOf(g, a), 8, 'Nine-Tailed Fox applied without paying Deflect');
  // Ahri, Inquisitive defending with no runes: can't pay Deflect 2 -> no -2
  let h = S0();
  setRunes(h, P1, 0);
  put(h, P1, 'Ahri, Inquisitive', BF_A); control(h, BF_A, P1);
  const b = put(h, P0, 'Deflect(9,2)', 'base');
  h = move(h, P0, [b], BF_A);
  for (let i = 0; i < 6 && h.chain.length; i++) h = pend(h).inStep ? act(h, legal(h, pend(h).player)[0]) : pass(h);
  assert.equal(mightOf(h, b), 9, 'Ahri, Inquisitive could not pay Deflect');
});

test('RJ#2683 Relentless Storm triggers on playing a Mighty unit; killing the unit in response does not stop it', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  setLegend(g, P0, 'Relentless Storm');
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const kr = putF(g, P1, 'rjf-killr', 'hand');
  const sv = hand(g, P0, 'Carnivorous Snapvine');
  g = act(g, { type: 'playCard', player: P0, obj: sv, destination: 'base' });
  for (let i = 0; i < 8 && pend(g).inStep; i++) { const d = pend(g); g = d.kind === 'optional' ? choose(g, 'yes') : act(g, legal(g, d.player)[0]); }
  assert.equal(g.chain.length, 2, 'both triggers on the chain');
  const r1 = g.players[P0].runesInPlay.length;
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  g = play(g, P1, kr, { targets: [[sv]] });
  g = drive(g);
  assert.equal(zone(g, sv), 'trash');
  assert.equal(g.players[P0].runesInPlay.length, r1 + 1, 'channelled a rune anyway');
});

test('RJ#2685 Gemcraft Seer: each token played gets its own Vision trigger', () => {
  let g = S0();
  fundAll(g, P0);
  put(g, P0, 'Gemcraft Seer', 'base');
  [g] = cast(g, P0, 'Rousing Display');
  let n = 0;
  g = drive(g, h => { const d = pend(h); if (/Vision|recycle/i.test(d.prompt)) n++; return null; });
  const vis = g.log.filter(l => /Trigger: .*Vision|Vision/.test(l.text) && /Trigger/.test(l.text)).length;
  assert.ok(vis >= 2 || n >= 2, `two Vision triggers (log ${vis}, prompts ${n})`);
});

test('RJ#2687 Teemo, Strategist\'s defend trigger resolves before combat damage and can kill the attacker', () => {
  let g = S0({ tp: P1 });
  const t = put(g, P0, 'Teemo, Strategist', BF_A); control(g, BF_A, P0);
  stackTop(g, P0, 'HidZap', 'HidZap', 'HidZap', 'V(1)', 'V(1)');
  const a = put(g, P1, 'V(3)', 'base');
  g = move(g, P1, [a], BF_A);
  g = drive(g);
  assert.equal(zone(g, a), 'trash', '3 Hidden cards revealed: 3 damage to the attacker');
  assert.equal(g.objects[t].damage, 0, 'the dead attacker dealt no combat damage');
});

test('RJ#2688 Brynhir Thundersong: the opponent may respond to its play trigger', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const dr = hand(g, P1, 'DrawR');
  const b = hand(g, P0, 'Brynhir Thundersong');
  g = act(g, { type: 'playCard', player: P0, obj: b, destination: 'base' });
  assert.equal(zone(g, b), 'base', 'the unit itself does not wait on the chain');
  assert.equal(g.chain.length, 1);
  g = pass(g);
  expectPending(g, 'chainResponse', P1);
  assert.ok(canPlayNow(g, P1, dr), 'reaction allowed before the trigger resolves');
});

test('RJ#2689 Sona, Harmonious\'s end-of-turn trigger uses the chain and can be responded to', () => {
  let g = S0();
  fundAll(g, P1);
  const dr = hand(g, P1, 'DrawR');
  put(g, P0, 'Sona, Harmonious', BF_A); control(g, BF_A, P0);
  g = endTurn(g, P0);
  for (let i = 0; i < 6 && !g.chain.length && pend(g).inStep; i++) g = act(g, legal(g, pend(g).player)[0]);
  assert.ok(g.chain.length >= 1);
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  expectPending(g, 'chainResponse', P1);
  assert.ok(canPlayNow(g, P1, dr));
});

test('RJ#2690 Damage from Snapvine\'s fight stays marked until end of turn', () => {
  let g = S0();
  fundAll(g, P0);
  const e = put(g, P1, 'V(8)', BF_A); control(g, BF_A, P1);
  const sv = hand(g, P0, 'Carnivorous Snapvine');
  g = play(g, P0, sv, { dest: 'base' });
  g = drive(g);
  assert.equal(g.objects[e].damage, 6, 'enemy keeps 6 damage');
  assert.equal(g.pending!.kind, 'mainAction');
  assert.equal(zone(g, sv), 'trash', 'Snapvine took 8');
});

test('RJ#2692 The Boss saving a buffed defender: combat damage is all dealt first, the attacker still dies', () => {
  let g = S0();
  fundAll(g, P1);
  setLegend(g, P1, 'The Boss');
  const d = put(g, P1, 'V(3)', BF_A, { buff: true }); control(g, BF_A, P1);
  const a = put(g, P0, 'V(4)', 'base');
  g = move(g, P0, [a], BF_A);
  g = drive(g, h => (pend(h).kind === 'optional' ? ['yes'] : null));
  assert.equal(zone(g, a), 'trash');
  assert.equal(zone(g, d), 'base', 'saved: healed, exhausted, recalled');
  assert.equal(g.objects[d].damage, 0);
});

test('RJ#2694 Reaver\'s Row moves only one friendly unit', () => {
  let g = S0();
  setBattlefieldCard(g, BF_A, "Reaver's Row");
  const u1 = put(g, P1, 'V(5)', BF_A), u2 = put(g, P1, 'V(5)', BF_A);
  control(g, BF_A, P1);
  const a = put(g, P0, 'V(1)', 'base');
  g = move(g, P0, [a], BF_A);
  let maxSeen = 0;
  g = drive(g, h => { const d = pend(h); if (d.kind === 'chooseTargets' && d.player === P1) { maxSeen = Math.max(maxSeen, (d as { max?: number }).max ?? 1); return [u1]; } if (d.kind === 'optional') return ['yes']; return null; });
  assert.equal([u1, u2].filter(u => zone(g, u) === 'base').length, 1);
  assert.ok(rejectsTwo(), 'cannot pick two');
  function rejectsTwo() { return maxSeen <= 1; }
});

test('RJ#2695 Teemo, Strategist chooses its target (and pays Deflect) when the trigger goes on the chain', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0);
  put(g, P0, 'Teemo, Strategist', BF_A); control(g, BF_A, P0);
  stackTop(g, P0, 'HidZap', 'V(1)', 'V(1)', 'V(1)', 'V(1)');
  const a = put(g, P1, 'Deflect(3,1)', 'base');
  g = move(g, P1, [a], BF_A);
  const before = readyRunes(g, P0) + 0;
  for (let i = 0; i < 6 && pend(g).inStep; i++) g = act(g, legal(g, pend(g).player)[0]);
  assert.ok(g.chain.length >= 1);
  assert.equal(readyRunes(g, P0), before - 1, 'Deflect [1] paid as the trigger is put on the chain');
});

// RJ#2696 DECIDED (docs/riftjudge/DECISIONS.md): MATCH — the log's "OUTDATED" was a misread. CR 1.5 811.1.d.3: a play effect of a
// permanent played from facedown must choose its targets at the battlefield it was played to (Blastcone Fae is the CR's own
// example); 811.1.d.3.a: "If the unit is no longer on the board when the play effect attempts to resolve, the play effect will not
// be able to reference the information of where the unit was played from, and it will mistarget." So RJ is right: no -2.
test('RJ#2696 Blastcone Fae played from facedown: its play effect targets only units at its battlefield, and mistargets if the Fae is killed in response (CR 811.1.d.3/.3.a)', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  control(g, BF_A, P0);
  const fae = put(g, P0, 'Blastcone Fae', { facedown: BF_A });
  const here = put(g, P0, 'V(5)', BF_A);
  const away = put(g, P1, 'V(5)', BF_B); control(g, BF_B, P1);
  const kr = putF(g, P1, 'rjf-killr', 'hand');
  g = act(g, { type: 'playCard', player: P0, obj: fae });
  for (let i = 0; i < 4 && g.pending?.inStep && g.pending.kind !== 'chooseTargets'; i++) g = act(g, legal(g, g.pending.player)[0]);
  assert.ok(!optionIds(g).includes(away), 'a unit at another battlefield is not a legal target (811.1.d.3)');
  g = answer(g, { targets: [[here]] }, P0);
  assert.ok(g.chain.length >= 1);
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  g = play(g, P1, kr, { targets: [[fae]] });
  g = drive(g);
  assert.equal(zone(g, fae), 'trash');
  assert.equal(mightOf(g, here), 5, 'source gone on resolution → mistarget, no -2 (811.1.d.3.a)');
});

test('RJ#2700 Multiple Assault instances add up', () => {
  let g = S0();
  fundAll(g, P0);
  const u = put(g, P0, 'Assault(4,2)', 'base');
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'Cleave', { targets: [[u]] });
  g = settle(g);
  g = move(g, P0, [u], BF_A);
  assert.equal(mightOf(g, u), 9, '4 + Assault 2 + Assault 3');
});

test('RJ#2698 Block given during the combat showdown: Shield 3 applies at once to the defender', () => {
  let { g, def } = attackSetup(['V(4)'], ['V(2)']);
  fundAll(g, P1);
  const bl = hand(g, P1, 'Block');
  g = pass(g);
  expectPending(g, 'showdownAction', P1);
  g = play(g, P1, bl, { targets: [[def[0]]] });
  g = resolveChain(g);
  assert.equal(mightOf(g, def[0]), 5, '2 + Shield 3 while defending');
});

test('RJ#2699 Kayn (moved twice, takes no damage) attacking an 8-Might Tryndamere survives and is recalled to base', () => {
  let g = S0();
  const k = put(g, P0, 'Kayn, Unleashed', 'base');
  const t = put(g, P1, 'Tryndamere, Barbarian', BF_B); control(g, BF_B, P1);
  g = settle(move(g, P0, [k], BF_A));          // move 1: conquers the open battlefield
  g = drive(g);
  assert.equal(locOf(g, k), BF_A);
  g.objects[k].exhausted = false; g.timestamp++;  // (setup) readied by an effect
  g = move(g, P0, [k], BF_B);                   // move 2 (Ganking): attacks Tryndamere
  g = drive(g);
  assert.equal(zone(g, k), 'base', 'no damage taken; defender survived -> attacker recalled');
  assert.equal(g.objects[k].damage, 0);
  assert.equal(locOf(g, t), BF_B);
});

test('RJ#2704 A Seal adds power only: it cannot pay an Energy cost', () => {
  const g = S0();
  setRunes(g, P0, 0);
  put(g, P0, 'Seal of Rage', 'base');
  const v = hand(g, P0, 'V(1)');
  const s2 = hand(g, P0, 'Seal of Rage');
  assert.equal(canPlayNow(g, P0, v), false, '[1] energy can\'t be paid by the Seal');
  assert.equal(canPlayNow(g, P0, s2), true, 'a 0-energy, 1-power card can');
});

test('RJ#2705 A countered spell is not "played" (no "when you play a spell" trigger); a counter can\'t target itself (CR 355.9)', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  put(g, P0, 'SpellWatcher', 'base');
  const solo = hand(g, P0, 'CounterR');
  assert.equal(canPlayNow(g, P0, solo), false, 'no other spell: nothing to target (it can\'t choose itself)');
  const v = put(g, P1, 'V(5)', 'base');
  const cr = hand(g, P1, 'CounterR');
  [g] = cast(g, P0, 'ZapM', { targets: [[v]] });
  g = pass(g);
  g = play(g, P1, cr, { targets: [[g.chain[0].source]] });
  const h = handN(g, P0);
  g = drive(g);
  assert.equal(g.objects[v].damage, 0, 'countered');
  assert.equal(handN(g, P0), h, 'SpellWatcher did not draw for the countered ZapM');
});

test('RJ#2706 Icathian Rain: all six targets are chosen when it is played, before anyone can respond', () => {
  let g = S0();
  fundAll(g, P0);
  const es = [put(g, P1, 'V(9)', 'base'), put(g, P1, 'V(9)', 'base')];
  const ir = hand(g, P0, 'Icathian Rain, Kai\'Sa');
  g = act(g, { type: 'playCard', player: P0, obj: ir });
  let n = 0;
  while (pend(g).inStep && pend(g).kind === 'chooseTargets' && n < 10) { g = choose(g, es[n % 2]); n++; }
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = act(g, legal(g, pend(g).player)[0]);
  assert.equal(n, 6, 'six target choices made at play time');
  expectPending(g, 'chainResponse', P0);
  g = drive(g);
  assert.equal(g.objects[es[0]].damage + g.objects[es[1]].damage, 12);
});

test('RJ#2708 A revealed hidden spell can be countered; a revealed hidden unit cannot', () => {
  let g = S0();
  fundAll(g, P1);
  control(g, BF_A, P0); control(g, BF_B, P0);
  const hz = put(g, P0, 'HidZap', { facedown: BF_A });
  const hu = put(g, P0, 'HidU(2)', { facedown: BF_B });
  put(g, P0, 'V(1)', BF_B); // keep control of BF-B
  const v = put(g, P0, 'V(5)', BF_A); // hidden spell targets must be at its battlefield (CR 811.1.d)
  const cr = hand(g, P1, 'CounterR');
  g = act(g, { type: 'playCard', player: P0, obj: hz });
  g = answer(g, { targets: [[v]] }, P0);
  g = pass(g);
  assert.ok(canPlayNow(g, P1, cr), 'hidden spell is a spell on the chain');
  g = drive(g);
  g = act(g, { type: 'playCard', player: P0, obj: hu });
  assert.equal(locOf(g, hu), BF_B, 'hidden unit resolves immediately');
  assert.ok(!g.chain.length || !canPlayNow(g, P1, cr));
});

test('RJ#2710 Recruit the Vanguard during an attack: tokens can\'t go to the battlefield you attack but don\'t control', () => {
  let { g } = attackSetup(['V(2)'], ['V(9)']);
  withTokens(g);
  fundAll(g, P0);
  const rv = hand(g, P0, 'Recruit the Vanguard');
  g = act(g, { type: 'playCard', player: P0, obj: rv });
  const offered: string[] = [];
  g = drive(g, h => { const d = pend(h); if (d.kind === 'chooseDestination') { offered.push(...d.options!.map(o => o.id)); return ['base']; } return null; });
  assert.ok(!offered.includes(String(BF_A)), `BF-A not offered (${offered.join(',')})`);
  const recruits = Object.values(g.objects).filter(o => o.controller === P0 && g.cards[o.cardId]?.name === 'Recruit' && (o.zone === 'base' || o.zone === 'battlefield'));
  assert.equal(recruits.length, 4);
  assert.ok(recruits.every(r => r.zone === 'base'));
});

test('RJ#2712 At 6 points, holding both battlefields scores 2 and wins (final point rule only restricts conquer)', () => {
  let g = S0({ tp: P1 });
  put(g, P0, 'V(1)', BF_A); put(g, P0, 'V(1)', BF_B);
  control(g, BF_A, P0); control(g, BF_B, P0);
  g.players[P0].points = 6;
  g = endTurn(g, P1);
  g = drive(g);
  assert.equal(g.winner, P0);
});

test('RJ#2713 Ahri, Inquisitive\'s "-2 to a minimum of 1" on a 1-Might unit is snapshotted: Siphon Power then makes it 2', () => {
  let { g, def } = attackSetup(['Ahri, Inquisitive'], ['V(1)']);
  fundAll(g, P1);
  for (let i = 0; i < 6 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(mightOf(g, def[0]), 1);
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  const sp = hand(g, P1, 'Siphon Power, Viktor');
  g = play(g, P1, sp, { targets: [[g.battlefields[BF_A].objId]] });
  g = resolveChain(g);
  assert.equal(mightOf(g, def[0]), 2);
});

test('RJ#2714 Singularity: "each of up to two units" can\'t hit the same unit twice', () => {
  let g = S0();
  fundAll(g, P0);
  const e = put(g, P1, 'V(12)', 'base');
  const sg = hand(g, P0, 'Singularity');
  g = act(g, { type: 'playCard', player: P0, obj: sg });
  const d = pend(g);
  assert.equal(d.kind, 'chooseTargets');
  assert.ok(rejects(g, { type: 'choose', player: P0, optionIds: [e, e] }) !== null, 'same unit twice rejected');
  g = choose(g, e);
  g = drive(g);
  assert.equal(g.objects[e].damage, 6);
});

test('RJ#2716 Blind Fury reveals Final Spark but its only target has Deflect you can\'t pay: not played (stays banished)', () => {
  let g = S0();
  setRunes(g, P0, 0);
  g.players[P0].pool = { energy: 4, power: { Fury: 2 } } as GameState['players'][0]['pool'];
  const e = put(g, P1, 'Deflect(3,1)', BF_A); control(g, BF_A, P1);
  const [fs] = stackTop(g, P1, 'Final Spark, Lux');
  [g] = cast(g, P0, 'Blind Fury');
  g = drive(g);
  assert.equal(locOf(g, e), BF_A, 'no damage dealt');
  assert.equal(g.objects[e].damage, 0);
  assert.equal(zone(g, fs), 'banishment');
});

test('RJ#2717 Reactions can be chained back-to-back; Actions can\'t be added to a chain', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0);
  const a = put(g, P1, 'V(2)', 'base');
  const mine = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const r1 = hand(g, P0, 'DrawR'), r2 = hand(g, P0, 'DrawR'), pa = hand(g, P0, 'PumpA');
  g = move(g, P1, [a], BF_A);
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  g = play(g, P0, r1);
  expectPending(g, 'chainResponse', P0);
  assert.ok(canPlayNow(g, P0, r2), 'second Reaction on top of the first');
  assert.ok(!canPlayNow(g, P0, pa), 'no Action while the chain is open');
  void mine;
});

test('RJ#2718 Thousand-Tailed Watcher\'s -3 (min 1) is fixed; when Lee Sin, Centered\'s +2 then goes away the unit is at 0', () => {
  let g = S0();
  fundAll(g, P0);
  const ls = put(g, P1, 'Lee Sin, Centered', BF_A);
  const u = put(g, P1, 'V(2)', BF_A, { buff: true });
  control(g, BF_A, P1);
  assert.equal(mightOf(g, u), 5);
  [g] = cast(g, P0, 'Thousand-Tailed Watcher', { dest: 'base' });
  g = drive(g);
  assert.equal(mightOf(g, u), 2);
  [g] = cast(g, P0, 'Vengeance', { targets: [[ls]] });
  g = drive(g);
  assert.equal(zone(g, ls), 'trash');
  assert.equal(mightOf(g, u), 0);
  assert.equal(locOf(g, u), BF_A, 'no damage: survives at 0');
});

test('RJ#2719 Sett, Brawler: the buff is spent as the cost when activating; +4 follows', () => {
  let g = S0();
  const s = put(g, P0, 'Sett, Brawler', 'base', { buff: true });
  const m0 = mightOf(g, s)!;
  const ab = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === s)!;
  g = act(g, ab);
  assert.equal(g.objects[s].counters.buff ?? 0, 0, 'buff spent on activation');
  g = drive(g);
  assert.equal(mightOf(g, s), m0 - 1 + 4);
});

test('RJ#2721 Unforgiven (Yasuo legend) moves one unit on its own; it can\'t be combined with a standard move', () => {
  let g = S0();
  const lg = setLegend(g, P0, 'Unforgiven');
  const a = put(g, P0, 'V(2)', 'base');
  const b = put(g, P0, 'V(2)', 'base');
  put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const ab = legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === lg)!;
  g = act(g, ab);
  g = answer(g, { targets: [[a]], battlefields: [BF_A], locations: [BF_A] }, P0);
  for (let i = 0; i < 6 && g.chain.length; i++) g = pend(g).inStep ? answer(g, { battlefields: [BF_A], locations: [BF_A] }, P0) : pass(g);
  assert.equal(locOf(g, a), BF_A);
  assert.equal(locOf(g, b), 'base');
  assert.equal(legal(g, P0, 'move').length, 0, 'combat showdown already under way: b can\'t join');
});

test('RJ#2722 Charm still resolves after Flash moves its target to base; its destination was chosen on play (CR 355.4)', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  const fl = hand(g, P1, 'Flash');
  const ch = put(g, P0, 'ogn-043-298', 'hand');
  g = act(g, { type: 'playCard', player: P0, obj: ch });
  const kinds: string[] = [];
  for (let i = 0; i < 6 && pend(g).inStep; i++) {
    const d = pend(g); kinds.push(d.kind);
    g = d.kind === 'chooseTargets' ? choose(g, u) : act(g, { type: 'choose', player: d.player, optionIds: [String(BF_B)] });
  }
  assert.ok(kinds.some(k => k === 'chooseDestination' || k === 'chooseBattlefield'), `destination chosen on play (${kinds.join(',')})`);
  g = pass(g);
  g = play(g, P1, fl, { targets: [[u]] });
  g = drive(g);
  assert.equal(locOf(g, u), BF_B, 'Charm resolved: moved from base to the chosen BF-B');
});

test('RJ#2724 Get Excited!: discard happens on resolution even if the target became illegal', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const c = hand(g, P0, 'V(3)');
  const mr = hand(g, P1, 'MoveR');
  const ge = hand(g, P0, 'Get Excited!');
  g = act(g, { type: 'playCard', player: P0, obj: ge });
  g = answer(g, { targets: [[u]] }, P0);
  assert.equal(zone(g, c), 'hand', 'no discard yet: not a cost');
  g = pass(g);
  g = play(g, P1, mr, { targets: [[u]] });
  g = drive(g, h => (pend(h).kind === 'chooseCards' ? [c] : null));
  assert.equal(zone(g, u), 'base');
  assert.equal(g.objects[u].damage, 0);
  assert.equal(zone(g, c), 'trash', 'still discarded');
});

test('RJ#2726 Sky Splitter as the 2nd card with only Darius, Trifarian: costs 8-5 = 3 (his +2 comes after)', () => {
  let g = S0();
  fundAll(g, P0);
  const d = put(g, P0, 'Darius, Trifarian', 'base');
  [g] = cast(g, P0, 'V(0)', { dest: 'base' });
  g = drive(g);
  const ss = hand(g, P0, 'Sky Splitter');
  const c = playCostOf(g, P0, ss);
  assert.equal(c?.energy, 3);
  void d;
});

test('RJ#2729 Mulliganed cards are not revealed to the opponent', () => {
  let g = newGame({ mulligan: true, firstPlayer: P1 });
  if (g.pending?.kind === 'mulligan' && g.pending.player === P1) g = choose(g);
  const [c1, c2] = g.players[P0].hand;
  g = choose(g, c1, c2);
  const v = getView(g, P1);
  for (const c of [c1, c2]) {
    const o = v.state.objects[c] as { cardId?: string } | undefined;
    assert.ok(!o || !o.cardId || o.cardId !== g.objects[c].cardId || /hidden|unknown/i.test(String(o.cardId)), 'card identity hidden from P1');
  }
});

test('RJ#2730 Cull the Weak can be played with no units on the board (it chooses nothing when played)', () => {
  let g = S0();
  fundAll(g, P0);
  const cw = hand(g, P0, 'Cull the Weak');
  assert.ok(canPlayNow(g, P0, cw));
  const e = put(g, P1, 'V(2)', 'base');
  g = play(g, P0, cw);
  g = drive(g);
  assert.equal(zone(g, cw), 'trash');
  assert.equal(zone(g, e), 'trash', 'only P1 had a unit; P1 kills it');
});

test('RJ#2733 Between two triggered items on the chain, players may react after the first resolves', () => {
  let g = S0();
  fundAll(g, P1);
  hand(g, P1, 'DrawR');
  putF(g, P0, 'rjf-otherplay', 'base');
  const u = putF(g, P0, 'rjf-selfplay', 'hand');
  g = act(g, { type: 'playCard', player: P0, obj: u, destination: 'base' });
  while (pend(g).kind === 'orderTriggers') g = choose(g, pend(g).options![0].id);
  assert.equal(g.chain.length, 2);
  g = pass(g); g = pass(g);
  assert.equal(g.chain.length, 1, 'first resolved');
  assert.equal(pend(g).kind, 'chainResponse', 'priority again before the second resolves');
  const p1 = g.players[P1].hand[0];
  for (let i = 0; i < 2 && pend(g).player !== P1; i++) g = pass(g);
  assert.ok(canPlayNow(g, P1, p1));
});

test('RJ#2734 Void Rush\'s [2] reduction applies after Blood Rush\'s Repeat cost: repeated Blood Rush costs 0', () => {
  let g = S0();
  setRunes(g, P0, 0);
  g.players[P0].pool = { energy: 2, power: { Fury: 1, Chaos: 1, Mind: 1, Calm: 1, Body: 1, Order: 1 } } as GameState['players'][0]['pool'];
  const u = put(g, P0, 'V(1)', 'base');
  const [br] = stackTop(g, P0, 'Blood Rush', 'V(1)');
  [g] = cast(g, P0, 'Void Rush');
  g = drive(g, h => {
    const d = pend(h);
    if (d.kind === 'chooseCards') return [br];
    if (d.kind === 'optional') return ['yes'];
    if (d.kind === 'chooseTargets') return [u];
    return null;
  });
  assert.equal(zone(g, br), 'trash');
  assert.equal(kwValueOf(g, u, 'Assault'), 4, 'Assault 2 twice (repeated for free)');
});

test('RJ#2735 An enemy unit moved by my effect into my battlefield makes its controller the attacker, who gets focus first', () => {
  let g = S0();
  put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(2)', 'base');
  [g] = cast(g, P0, 'Charm', { targets: [[e]] });
  g = pass(g); g = pass(g);
  g = answer(g, { locations: [BF_A], dest: BF_A }, P0);
  for (let i = 0; i < 6 && pend(g).inStep; i++) g = act(g, legal(g, pend(g).player)[0]);
  assert.equal(locOf(g, e), BF_A);
  expectPending(g, 'showdownAction', P1, 'contesting player (P1) is the attacker with focus');
});

test('RJ#2736 A unit kept alive by Darius, Executioner\'s +1 survives combat damage even as Darius dies in the same combat', () => {
  const g0 = S0();
  const dar = put(g0, P1, 'Darius, Executioner', BF_A);
  const r = put(g0, P1, 'V(1)', BF_A);
  control(g0, BF_A, P1);
  const a = put(g0, P0, 'V(7)', 'base');
  let g = move(g0, P0, [a], BF_A);
  for (let i = 0; i < 20; i++) {
    const d = g.pending!;
    if (d.kind === 'assignDamage') { g = act(g, d.player === P0 ? { type: 'assignDamage', player: P0, assignment: { [dar]: 6, [r]: 1 } } : legal(g, d.player)[0]); continue; }
    if (d.kind === 'mainAction') break;
    g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  assert.equal(zone(g, dar), 'trash');
  assert.equal(locOf(g, r), BF_A, 'healed in the combat cleanup before losing the +1 could matter');
  assert.equal(g.objects[r].damage, 0);
});

test('RJ#2739 Fox-Fire ("any number") can be played choosing zero units', () => {
  let g = S0();
  fundAll(g, P0);
  put(g, P0, 'SpellWatcher', 'base');
  const ff = hand(g, P0, 'Fox-Fire, Ahri');
  assert.ok(canPlayNow(g, P0, ff), 'no units at any battlefield, still playable');
  const h = handN(g, P0);
  g = act(g, { type: 'playCard', player: P0, obj: ff });
  g = drive(g, x => (pend(x).kind === 'chooseTargets' ? [] : null));
  assert.equal(zone(g, ff), 'trash');
  assert.equal(handN(g, P0), h - 1 + 1, 'played: "when you play a spell" drew 1');
});

test('RJ#2741 The Arena\'s Greatest: its trigger in the opponent\'s Beginning Phase can be responded to', () => {
  let g = S0();
  fundAll(g, P0);
  const dr = hand(g, P0, 'DrawR');
  setBattlefieldCard(g, BF_A, "The Arena's Greatest");
  g.players[P1].turnsTaken = 0;
  g = endTurn(g, P0);
  for (let i = 0; i < 6 && !g.chain.length && pend(g).inStep; i++) g = act(g, legal(g, pend(g).player)[0]);
  assert.ok(g.chain.length >= 1, 'trigger on the chain');
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  expectPending(g, 'chainResponse', P0);
  assert.ok(canPlayNow(g, P0, dr));
  g = drive(g);
  assert.equal(g.players[P1].points, 1);
});

test('RJ#2743 Treasure Trove: both its "Kill this" ability and its leave-the-board trigger use the chain', () => {
  let g = S0();
  fundAll(g, P0);
  const tt = put(g, P0, 'Treasure Trove', 'base');
  const ab = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === tt)!;
  g = act(g, ab);
  g = answer(g, {}, P0);
  assert.equal(g.chain.length, 1, 'kill ability on the chain');
  g = pass(g);
  expectPending(g, 'chainResponse', P1, 'respond to the ability');
  g = pass(g);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = act(g, legal(g, pend(g).player)[0]);
  assert.equal(zone(g, tt), 'trash');
  assert.equal(g.chain.length, 1, 'leave-the-board trigger on a new chain');
  g = pass(g);
  expectPending(g, 'chainResponse', P1, 'respond to the trigger');
});

test('RJ#2744 Prodigal Explorer: one Singularity choosing two enemy units satisfies "chosen ... twice this turn"', () => {
  let g = S0();
  fundAll(g, P0);
  const lg = setLegend(g, P0, 'Prodigal Explorer');
  const e1 = put(g, P1, 'V(9)', 'base'), e2 = put(g, P1, 'V(9)', 'base');
  const canLegend = (h: GameState) => legal(h, P0, 'activate').some(a => a.type === 'activate' && a.obj === lg);
  assert.equal(canLegend(g), false);
  const sg = hand(g, P0, 'Singularity');
  g = act(g, { type: 'playCard', player: P0, obj: sg });
  g = choose(g, e1, e2);
  g = drive(g);
  assert.ok(canLegend(g), 'two enemy units chosen by one spell');
});

test('RJ#2745 Charming an opponent\'s Traveling Merchant moves it, so its "When I move" triggers (for its controller)', () => {
  let g = S0();
  const m = put(g, P1, 'Traveling Merchant', 'base');
  const c = put(g, P1, 'V(1)', 'hand');
  [g] = cast(g, P0, 'Charm', { targets: [[m]] });
  g = pass(g); g = pass(g);
  g = answer(g, { locations: [BF_A], dest: BF_A }, P0);
  g = drive(g, h => (pend(h).kind === 'chooseCards' && pend(h).player === P1 ? [c] : null));
  assert.equal(locOf(g, m), BF_A);
  assert.equal(zone(g, c), 'trash', 'P1 discarded (then drew)');
});

test('RJ#2746 A stunned Yasuo, Remorseful\'s "When I attack" still deals its damage (stun only stops combat damage)', () => {
  let g = S0();
  const y = put(g, P0, 'Yasuo, Remorseful', 'base', { stunned: true });
  const e = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  assert.ok(moveDests(g, P0, y).includes(BF_A), 'a stunned unit can still move');
  g = move(g, P0, [y], BF_A);
  g = drive(g);
  assert.equal(zone(g, e), 'trash', '6 trigger damage');
});

test('RJ#2747 Dazzling Aurora playing Deadbloom Predator may put it at an occupied enemy battlefield', () => {
  let g = S0();
  put(g, P0, 'Dazzling Aurora', 'base');
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const [db] = stackTop(g, P0, 'Deadbloom Predator');
  g = endTurn(g, P0);
  let offered: string[] = [];
  g = drive(g, h => { const d = pend(h); if (d.kind === 'chooseDestination' && d.player === P0) { offered = d.options!.map(o => o.id); return d.options!.some(o => o.id === String(BF_A)) ? [String(BF_A)] : null; } return null; });
  assert.ok(offered.includes(String(BF_A)), `enemy battlefield offered (${offered.join(',')})`);
  assert.equal(locOf(g, db) === BF_A || zone(g, db) === 'trash', true);
});

test('RJ#2749 No window after combat damage to save a unit: lethal-damaged units die before anyone can act', () => {
  let { g, atk, def } = attackSetup(['V(3)'], ['V(3)']);
  fundAll(g, P1);
  hand(g, P1, 'MoveR');
  g = pass(g); g = pass(g); // both pass the combat showdown -> damage
  for (let i = 0; i < 4 && pend(g).kind === 'assignDamage'; i++) g = act(g, legal(g, pend(g).player)[0]);
  assert.equal(zone(g, atk[0]), 'trash');
  assert.equal(zone(g, def[0]), 'trash', 'died with no priority window after damage');
});

test('RJ#2751 Temporary\'s kill trigger uses the chain (reactions allowed); saved by Zhonya\'s it is still Temporary next turn', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P1);
  const dr = hand(g, P1, 'DrawR');
  const t = put(g, P0, 'Temp(2)', 'base');
  put(g, P0, "Zhonya's Hourglass", 'base');
  g = endTurn(g, P1);
  for (let i = 0; i < 6 && !g.chain.length && pend(g).inStep; i++) g = act(g, legal(g, pend(g).player)[0]);
  assert.ok(g.chain.length >= 1, 'Temporary trigger on the chain');
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  expectPending(g, 'chainResponse', P1);
  assert.ok(canPlayNow(g, P1, dr));
  g = drive(g);
  assert.equal(zone(g, t), 'base', 'Zhonya\'s saved it');
  assert.ok(hasKeyword(g, t, 'Temporary'), 'still Temporary');
});

test('RJ#2752 Confront + Deadbloom Predator played to an occupied enemy battlefield: enters ready, can move back to base after combat', () => {
  let g = S0();
  fundAll(g, P0);
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'Confront');
  g = drive(g);
  const db = hand(g, P0, 'Deadbloom Predator');
  g = act(g, { type: 'playCard', player: P0, obj: db, destination: BF_A });
  assert.equal(g.objects[db].exhausted, false, 'entered ready');
  g = drive(g);
  assert.equal(locOf(g, db), BF_A);
  assert.ok(moveDests(g, P0, db).includes('base'), 'ready survivor may move to base');
});

test('RJ#2754 Gust then Possession on an enemy Darius, Trifarian: he sees Possession as his new controller\'s second card (+2, readied)', () => {
  let g = S0();
  fundAll(g, P0);
  const d = put(g, P1, 'Darius, Trifarian', BF_A, { ready: false }); control(g, BF_A, P1);
  const s = put(g, P1, 'V(2)', BF_B); control(g, BF_B, P1);
  [g] = cast(g, P0, 'Gust', { targets: [[s]] });
  g = drive(g);
  [g] = cast(g, P0, 'Possession', { targets: [[d]] });
  g = drive(g);
  assert.equal(zone(g, d), 'base');
  assert.equal(g.objects[d].controller, P0);
  assert.equal(mightOf(g, d), 7, 'his trigger saw Possession (played on resolution, CR 420.4.a.1) as the second card');
  assert.equal(g.objects[d].exhausted, false, 'card text "ready me" (RJ says exhausted — contradicts the trigger it says fires)');
});

test('RJ#2755 Two Zhonya\'s Hourglass, one unit dies: only one replaces the death and is trashed; the other stays', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P1);
  const z1 = put(g, P0, "Zhonya's Hourglass", 'base'), z2 = put(g, P0, "Zhonya's Hourglass", 'base');
  const a = put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const k = putF(g, P1, 'rjf-killr', 'hand');
  g = play(g, P1, k, { targets: [[a]] });
  for (let i = 0; i < 10; i++) { const d = g.pending!; if (d.inStep) g = choose(g, d.options![0].id); else if (d.kind === 'chainResponse') g = pass(g); else break; }
  assert.equal(locOf(g, a), 'base', 'saved (recalled)');
  assert.deepEqual([zone(g, z1), zone(g, z2)].sort(), ['base', 'trash'], 'exactly one Hourglass used');
});

test('RJ#2756 Immortal Phoenix trigger mid-showdown after the defender\'s last unit there died: the defender still controls the battlefield, so it may be played there', () => {
  let { g, atk, def } = attackSetup(['V(2)'], ['V(1)']);
  fundAll(g, P0); fundAll(g, P1);
  const ph = put(g, P1, 'Immortal Phoenix', 'trash');
  const k1 = putF(g, P1, 'rjf-killr', 'hand');
  const k0 = putF(g, P0, 'rjf-killr', 'hand');
  g = pass(g);
  g = play(g, P1, k1, { targets: [[atk[0]]] });
  g = pass(g); g = pass(g);
  g = answer(g, { may: [true] }, P1); // pay [1][C] when the trigger is finalized (CR 383.3.b)
  if (pend(g).player === P1) g = pass(g);
  g = play(g, P0, k0, { targets: [[def[0]]] });
  let offered: string[] = [];
  g = drive(g, h => { const d = pend(h); if (d.kind === 'chooseDestination') { offered = d.options!.map(o => o.id); return [String(BF_A)]; } return d.kind === 'optional' ? ['yes'] : null; });
  assert.equal(zone(g, def[0]), 'trash');
  assert.ok(offered.includes(String(BF_A)), `BF-A offered (${offered.join(',')}): control is not lost during a showdown there (CR 323 step 4, 190.4)`);
  assert.equal(locOf(g, ph), BF_A);
});

test('RJ#2759 Kayn: standard move + conquer, Ride the Wind into combat, recalled without conquering: still ready and may move again', () => {
  let g = S0();
  fundAll(g, P0);
  const k = put(g, P0, 'Kayn, Unleashed', 'base');
  const e = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [k], BF_B); g = drive(g);
  assert.equal(g.objects[k].exhausted, true, 'standard move exhausts');
  [g] = cast(g, P0, 'Ride the Wind', { targets: [[k]], dest: BF_A, locations: [BF_A] });
  g = drive(g, h => (pend(h).kind === 'chooseDestination' ? [String(BF_A)] : null));
  assert.equal(locOf(g, e), BF_A);
  assert.equal(locOf(g, k), 'base', 'recalled after a combat without conquering');
  assert.equal(g.objects[k].exhausted, false, 'move effects and recall do not exhaust');
  assert.ok(moveDests(g, P0, k).includes(BF_A));
});

test('RJ#2761 Challenge (Action) may target an enemy unit in its base; not playable on the opponent\'s turn outside a showdown', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const f = put(g, P0, 'V(4)', 'base');
  const e = put(g, P1, 'V(3)', 'base');
  g = play(g, P0, hand(g, P0, 'Challenge'), { targets: [[f], [e]] });
  g = drive(g);
  assert.equal(zone(g, e), 'trash', 'enemy unit in base was a legal target');
  assert.equal(g.objects[f].damage, 3);
  let h = S0({ tp: P1 });
  fundAll(h, P0);
  put(h, P0, 'V(4)', 'base'); put(h, P1, 'V(3)', 'base');
  assert.equal(canPlayNow(h, P0, hand(h, P0, 'Challenge')), false, 'Action: not on the opponent\'s turn without a showdown');
});

test('RJ#2763 Yasuo, Remorseful with Svellsongur: two attack triggers, each deals 6 (his Might), may hit different units', () => {
  let g = S0();
  fundAll(g, P0);
  const y = put(g, P0, 'Yasuo, Remorseful', 'base');
  attachNow(g, put(g, P0, 'Svellsongur', 'base'), y);
  const e1 = put(g, P1, 'V(6)', BF_A), e2 = put(g, P1, 'V(6)', BF_A);
  control(g, BF_A, P1);
  g = move(g, P0, [y], BF_A);
  let n = 0;
  for (let i = 0; i < 8 && g.pending?.inStep; i++) { const d = g.pending!; const pick = d.options!.find(o => o.id === (n === 0 ? e1 : e2)); if (pick) n++; g = choose(g, pick?.id ?? d.options![0].id); }
  assert.equal(g.chain.length, 2, 'two triggers');
  for (let i = 0; i < 6 && g.chain.length; i++) g = pass(g);
  assert.equal(zone(g, e1), 'trash');
  assert.equal(zone(g, e2), 'trash', 'second trigger also dealt 6');
});

test('RJ#2766 Ride the Wind moves a unit battlefield-to-battlefield without Ganking and does not exhaust it', () => {
  let g = S0();
  fundAll(g, P0);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  assert.equal(moveDests(g, P0, u).includes(BF_B), false, 'no Ganking: standard move cannot go BF to BF');
  [g] = cast(g, P0, 'Ride the Wind', { targets: [[u]], dest: BF_B, locations: [BF_B] });
  g = drive(g, h => (pend(h).kind === 'chooseDestination' ? [String(BF_B)] : null));
  assert.equal(locOf(g, u), BF_B);
  assert.equal(g.objects[u].exhausted, false);
});

test('RJ#2768 2-Might unit at Trifarian War Camp (+1) given -2 (Frigid Touch): 1 Might', () => {
  let g = S0({ bfA: 'Trifarian War Camp' });
  fundAll(g, P0);
  const u = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  assert.equal(mightOf(g, u), 3);
  g = play(g, P0, hand(g, P0, 'Frigid Touch'), { may: [false], targets: [[u]] });
  g = drive(g, h => (pend(h).kind === 'optional' ? ['no'] : null));
  assert.equal(mightOf(g, u), 1);
});

test('RJ#2769 The Boss (Sett legend): "When you conquer, ready me" readies the exhausted legend on a conquer of an empty battlefield', () => {
  let g = S0();
  const lg = setLegend(g, P0, 'The Boss');
  g.objects[lg].exhausted = true;
  const s = put(g, P0, 'Sett, Brawler', 'base', { ready: false });
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_B); g = drive(g);
  assert.equal(g.players[P0].points, 1, 'conquered');
  assert.equal(g.objects[lg].exhausted, false, 'legend readied');
  assert.equal(g.objects[s].exhausted, true, 'only the legend itself readies');
});

test('RJ#2770 Wuju Bladesman (Master Yi legend): "defends alone" +2 applies only in combat; outside combat the unit has its printed Might', () => {
  let g = S0();
  setLegend(g, P1, 'Wuju Bladesman');
  const d = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  assert.equal(mightOf(g, d), 3, 'not defending outside combat');
  const a = put(g, P0, 'V(1)', 'base');
  g = move(g, P0, [a], BF_A);
  assert.equal(mightOf(g, d), 5, 'defends alone: +2');
});

test('RJ#2772 Void Gate: Thousand-Tailed Watcher\'s -3 Might is not damage, so no bonus damage is dealt', () => {
  let g = S0({ bfA: 'Void Gate' });
  fundAll(g, P0);
  const e = put(g, P1, 'V(4)', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'Thousand-Tailed Watcher', { dest: 'base', may: [false] });
  g = drive(g, h => (pend(h).kind === 'optional' ? ['no'] : null));
  assert.equal(mightOf(g, e), 1);
  assert.equal(g.objects[e].damage ?? 0, 0, 'no bonus damage');
  assert.equal(locOf(g, e), BF_A);
});

test('RJ#2773 Super Mega Death Rocket! whose target was Retreated to hand does nothing; no new target', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const e = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const mine = put(g, P0, 'V(5)', 'base');
  g = play(g, P0, hand(g, P0, 'Super Mega Death Rocket!, Jinx'), { targets: [[e]] });
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'Retreat'), { targets: [[e]] });
  g = drive(g);
  assert.equal(zone(g, e), 'hand');
  assert.equal(g.objects[mine].damage ?? 0, 0, 'not redirected');
  assert.equal(zone(g, mine), 'base');
});

test('RJ#2774 Zenith Blade joins a non-combat showdown at an open battlefield: the first mover is the attacker; a stun tie lets the defender conquer', () => {
  let g = S0();
  fundAll(g, P1);
  const a = put(g, P0, 'V(5)', 'base');
  const d = put(g, P1, 'V(2)', 'base');
  g = move(g, P0, [a], BF_A);
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'Zenith Blade, Leona'), {});
  if (g.pending?.kind === 'chooseTargets') g = act(g, { type: 'choose', player: P1, optionIds: [d] });   // (a sole friendly unit is auto-chosen)
  g = pass(g); g = pass(g);
  if (g.pending?.kind === 'optional') g = act(g, { type: 'choose', player: P1, optionIds: ['yes'] });   // RJ#5998b: move? on resolution
  expectPending(g, 'showdownAction', P0, 'combat: P0 (applied Contested) is the attacker with focus');
  g = drive(g);
  assert.equal(locOf(g, a), 'base', 'surviving attacker recalled');
  assert.equal(locOf(g, d), BF_A);
  assert.equal(g.players[P1].points, 1, 'defender established control: conquer');
});

test('RJ#2777 Raging Soul\'s Assault/Ganking from discarding lasts only for the current turn', () => {
  let g = S0();
  const s = put(g, P0, 'Raging Soul', 'base');
  hand(g, P0, 'V(1)');
  const d = putF(g, P0, 'rjf-discard1', 'hand');
  g = play(g, P0, d, {});
  g = drive(g, h => (pend(h).kind === 'chooseCards' ? [pend(h).options![0].id] : null));
  assert.equal(hasKeyword(g, s, 'Ganking'), true);
  g = nextTurn(g);
  assert.equal(hasKeyword(g, s, 'Ganking'), false, 'next turn: no longer');
  assert.equal(hasKeyword(g, s, 'Assault'), false);
});

test('RJ#2779 Iron Ballista (no Action/Reaction) cannot be activated on the opponent\'s turn, even in their showdown', () => {
  let g = S0({ tp: P1 });
  const b = put(g, P0, 'Iron Ballista', 'base');
  const u = put(g, P1, 'V(2)', 'base');
  g = move(g, P1, [u], BF_A);
  g = pass(g);
  expectPending(g, 'showdownAction', P0);
  assert.equal(legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === b), false);
  const h = S0(); const b2 = put(h, P0, 'Iron Ballista', 'base'); put(h, P1, 'V(2)', BF_A);
  assert.ok(legal(h, P0, 'activate').some(a => a.type === 'activate' && a.obj === b2), 'control: usable on own turn');
});

test('RJ#2780 Yasuo, Remorseful attacks a lone 2-Might defender; Ride the Wind brings Mindsplitter in: Yasuo dies, defender keeps control, no point', () => {
  let g = S0();
  fundAll(g, P1);
  const y = put(g, P0, 'Yasuo, Remorseful', 'base');
  const p = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const m = put(g, P1, 'Mindsplitter', 'base');
  const rw = hand(g, P1, 'Ride the Wind');
  g = move(g, P0, [y], BF_A);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = act(g, legal(g, pend(g).player)[0]);
  assert.equal(g.chain.length, 1, 'Yasuo\'s attack trigger');
  g = pass(g);
  assert.equal(canPlayNow(g, P1, rw), false, 'nuance: Ride the Wind is an Action — not in response to the trigger (CR 358.4)');
  g = pass(g);
  assert.equal(zone(g, p), 'trash');
  g = pass(g); // attacker passes focus
  assert.ok(canPlayNow(g, P1, rw), 'with focus the defender may play it');
  g = play(g, P1, rw, { targets: [[m]], dest: BF_A, locations: [BF_A] });
  g = drive(g, h => (pend(h).kind === 'chooseDestination' ? [String(BF_A)] : null));
  assert.equal(zone(g, y), 'trash');
  assert.equal(locOf(g, m), BF_A);
  assert.equal(g.players[P1].points, 0, 'no conquer: P1 controlled it throughout');
});

test('RJ#2782 Leaving a battlefield already conquered this turn and retaking it is not a second conquer (no point)', () => {
  let g = S0();
  fundAll(g, P0);
  const u1 = put(g, P0, 'V(2)', 'base'), u2 = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u1], BF_B); g = drive(g);
  assert.equal(g.players[P0].points, 1);
  g = play(g, P0, hand(g, P0, 'Flash'), { targets: [[u1]] });
  g = drive(g);
  assert.equal(locOf(g, u1), 'base');
  g = move(g, P0, [u2], BF_B); g = drive(g);
  assert.equal(locOf(g, u2), BF_B);
  assert.equal(g.players[P0].points, 1, 'already scored this battlefield this turn: no conquer');
});

test('RJ#2787 Super Mega Death Rocket! discarded by Zaun Warrens\' conquer trigger was not in the trash at the conquer: it does not return', () => {
  let g = S0({ bfB: 'Zaun Warrens' });
  fundAll(g, P0);
  const r = hand(g, P0, 'Super Mega Death Rocket!, Jinx');
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_B);
  let offered = false;
  g = drive(g, h => { const d = pend(h); if (d.kind === 'optional') { offered = true; return ['yes']; } return d.kind === 'chooseCards' && d.options!.some(o => o.id === r) ? [r] : null; });
  assert.equal(g.players[P0].points, 1);
  assert.equal(offered, false, 'no Rocket trigger');
  assert.equal(zone(g, r), 'trash');
});

test('RJ#2788 Lady of Luminosity: Promising Future countered by Wind Wall never counts as played, so no draw', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  setLegend(g, P0, 'Lady of Luminosity');
  const pf = hand(g, P0, 'Promising Future');
  g = play(g, P0, pf, {});
  const h = handN(g, P0);
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'Wind Wall'), { targets: [[pf]] });
  g = drive(g);
  assert.equal(zone(g, pf), 'trash');
  assert.equal(handN(g, P0), h, 'countered: no Lux draw (CR 420.4.a.1)');
});

test('RJ#2789 Noxian Guillotine\'s delayed kill on combat damage is replaced by Zhonya\'s Hourglass: the unit survives (healed, recalled)', () => {
  let g = S0();
  fundAll(g, P0);
  const z = put(g, P1, "Zhonya's Hourglass", 'base');
  const d = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(2)', 'base');
  g = play(g, P0, hand(g, P0, 'Noxian Guillotine, Darius'), { targets: [[d]] });
  g = drive(g);
  assert.equal(locOf(g, d), BF_A, 'no Legion: delayed kill');
  g = move(g, P0, [a], BF_A);
  g = drive(g, h => (pend(h).kind === 'optional' ? ['yes'] : null));
  assert.equal(zone(g, z), 'trash', 'Hourglass replaced the death');
  assert.equal(zone(g, d), 'base');
  assert.equal(g.objects[d].damage ?? 0, 0, 'healed');
});

test('RJ#2790 Tideturner (played to base) swapping with Ember Monk at a battlefield: control is kept and the facedown card there stays', () => {
  let g = S0();
  fundAll(g, P0);
  const m = put(g, P0, 'Ember Monk', BF_A); control(g, BF_A, P0);
  const hc = put(g, P0, 'HidU(2)', { facedown: BF_A });
  const t = hand(g, P0, 'Tideturner');
  g = act(g, { type: 'playCard', player: P0, obj: t, destination: 'base' });
  g = drive(g, h => (pend(h).options?.some(o => o.id === m) ? [m] : null));
  assert.equal(locOf(g, t), BF_A);
  assert.equal(locOf(g, m), 'base');
  assert.equal(zone(g, hc), 'facedown', 'no cleanup mid-resolution: hidden card kept');
  assert.equal(g.battlefields[BF_A].controller, P0);
});

test('RJ#2792 Hidden Here to Help plays Blitzcrank at my other battlefield in response to Anivia\'s attack trigger; hooked Anivia\'s trigger hits units there, then a second combat (new attack trigger) follows', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0);
  const big = put(g, P0, 'V(9)', BF_A); control(g, BF_A, P0);
  const small = put(g, P0, 'V(2)', BF_B); control(g, BF_B, P0);
  const hth = put(g, P0, 'Here to Help', { facedown: BF_B });
  const bl = hand(g, P0, 'Blitzcrank, Impassive');
  const an = put(g, P1, 'Anivia, Primal', 'base');
  g = move(g, P1, [an], BF_A);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = act(g, legal(g, pend(g).player)[0]);
  assert.equal(g.chain.length, 1, 'Anivia\'s attack trigger');
  g = pass(g);
  assert.ok(canPlayNow(g, P0, hth), 'hidden card: Reaction timing');
  g = act(g, { type: 'playCard', player: P0, obj: hth });
  g = drive(g, h => {
    const d = pend(h);
    if (d.options?.some(o => o.id === bl)) return [bl];
    if (d.options?.some(o => o.id === an)) return [an];
    if (d.kind === 'chooseBattlefield' || d.kind === 'chooseDestination') return [String(BF_B)];
    return d.kind === 'optional' ? ['yes'] : null;
  });
  assert.equal(locOf(g, an), BF_B, 'hooked');
  assert.equal(g.objects[big].damage ?? 0, 0, 'original trigger checks "here" on resolution: BF-A units untouched');
  assert.equal(zone(g, small), 'trash', 'original trigger dealt 3 at BF-B');
  assert.equal(zone(g, bl), 'trash', 'Blitzcrank took 3 + 3: Anivia attacked again in the second combat');
  assert.equal(g.players[P1].points, 1);
});

test('RJ#2797 Retreat on a token: the token ceases to exist, its owner still channels 1 rune exhausted', () => {
  let g = S0();
  withTokens(g);
  fundAll(g, P0);
  const t = put(g, P0, 'ven-t04', BF_A); control(g, BF_A, P0);
  const runes = g.players[P0].runesInPlay.length;
  g = play(g, P0, hand(g, P0, 'Retreat'), { targets: [[t]] });
  g = drive(g);
  assert.ok(!g.objects[t] || g.objects[t].zone !== 'hand', 'token does not stay in hand');
  assert.equal(g.players[P0].runesInPlay.length, runes + 1, 'owner channelled 1 rune');
});

test('RJ#2798 Recruit at Trifarian War Camp (2) hit by Thousand-Tailed Watcher: 1; later Discipline +2: 3 (snapshotted -1)', () => {
  let g = S0({ bfA: 'Trifarian War Camp' });
  withTokens(g);
  fundAll(g, P0); fundAll(g, P1);
  const t = put(g, P1, 'ven-t04', BF_A); control(g, BF_A, P1);
  assert.equal(mightOf(g, t), 2);
  [g] = cast(g, P0, 'Thousand-Tailed Watcher', { dest: 'base', may: [false] });
  g = drive(g, h => (pend(h).kind === 'optional' ? ['no'] : null));
  assert.equal(mightOf(g, t), 1);
  g = play(g, P0, hand(g, P0, 'Discipline'), { targets: [[t]] });
  g = drive(g);
  assert.equal(mightOf(g, t), 3, 'CR 479.4.b: the -3 to a min of 1 on 2 Might generated -1');
});

test('RJ#2801 Guardian Angel\'s recall of Apprentice Smith is not a move: no "When I move" reveal', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P1);
  const s = put(g, P0, 'Apprentice Smith', BF_A); control(g, BF_A, P0);
  attachNow(g, put(g, P0, 'Guardian Angel', BF_A), s);
  const [top] = stackTop(g, P0, 'Guardian Angel');
  const h = handN(g, P0);
  g = play(g, P1, putF(g, P1, 'rjf-killr', 'hand'), { targets: [[s]] });
  g = drive(g, x => (pend(x).kind === 'optional' ? ['yes'] : null));
  assert.equal(zone(g, s), 'base', 'saved and recalled');
  assert.equal(zone(g, top), 'mainDeck', 'no reveal/draw');
  assert.equal(handN(g, P0), h);
});

test('RJ#2803 Annie, Fiery\'s Bonus Damage does not make Stupefy (no damage) deal damage', () => {
  let g = S0();
  fundAll(g, P0);
  put(g, P0, 'Annie, Fiery', 'base');
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  g = play(g, P0, hand(g, P0, 'Stupefy'), { targets: [[e]] });
  g = drive(g);
  assert.equal(mightOf(g, e), 2);
  assert.equal(g.objects[e].damage ?? 0, 0);
});

test('RJ#2804 A token returned to hand (Gust) ceases to exist; it does not die ("when a friendly unit dies" does not trigger)', () => {
  let g = S0({ tp: P1 });
  withTokens(g);
  fundAll(g, P1);
  const c = put(g, P0, 'Spectral Centaur', 'base');
  const t = put(g, P0, 'ven-t04', BF_A); control(g, BF_A, P0);
  const m = mightOf(g, c);
  g = play(g, P1, hand(g, P1, 'Gust'), { targets: [[t]] });
  g = drive(g);
  assert.ok(!g.objects[t] || !['base', 'battlefield', 'hand', 'trash'].includes(g.objects[t].zone), 'token gone');
  assert.equal(mightOf(g, c), m, 'no death trigger');
});

test('RJ#2805 A battlefield scored by holding this turn cannot be conquered again the same turn (leave and retake: no point)', () => {
  let g = S0({ tp: P1 });
  const u1 = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const u2 = put(g, P0, 'V(2)', 'base');
  g = nextTurn(g);
  assert.equal(g.activePlayer, P0);
  assert.equal(g.players[P0].points, 1, 'hold');
  fundAll(g, P0);
  g = play(g, P0, hand(g, P0, 'Flash'), { targets: [[u1]] });
  g = drive(g);
  g = move(g, P0, [u2], BF_A); g = drive(g);
  assert.equal(locOf(g, u2), BF_A);
  assert.equal(g.players[P0].points, 1, 'no conquer');
});

test('RJ#2807 On my own turn I may play a hidden card in response to my Temporary unit\'s start-of-turn kill trigger', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0);
  const t = put(g, P0, 'Temp(2)', BF_A); control(g, BF_A, P0);
  const hc = put(g, P0, 'HidU(2)', { facedown: BF_A });
  g = endTurn(g, P1);
  for (let i = 0; i < 6 && !g.chain.length && pend(g).inStep; i++) g = act(g, legal(g, pend(g).player)[0]);
  assert.equal(g.activePlayer, P0);
  assert.ok(g.chain.length >= 1, 'Temporary trigger on the chain');
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  assert.equal(zone(g, t), 'battlefield', 'Sprite still there');
  assert.ok(canPlayNow(g, P0, hc), 'hidden card playable in response on my own turn');
});

test('RJ#2808 Accelerate is only a play-time cost: an exhausted Accelerate unit on the board has no ability to ready itself', () => {
  const g = S0();
  fundAll(g, P0);
  const a = put(g, P0, 'Accel(2)', 'base', { ready: false });
  assert.equal(legal(g, P0, 'activate').some(x => x.type === 'activate' && x.obj === a), false);
});

test('RJ#2809 3-player FFA: a battlefield with a combat in progress is an invalid destination for a non-participant\'s move (Ride the Wind)', async () => {
  const { createGame } = await import('../../src/engine/index.ts');
  const { fixtureDb } = await import('../fixtures/conformance/cards.ts');
  const { legalDeck } = await import('../conformance/harness.ts');
  let g = createGame({ seed: 3, cardDb: fixtureDb(), firstPlayer: P0, skipMulligan: true, battlefieldSelection: 'random', includeAllCards: true, mode: 'ffa',
    players: [0, 1, 2].map(i => ({ name: `P${i}`, deck: legalDeck() })) });
  const P2 = 2 as PlayerId;
  put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(3)', 'base');
  const c = put(g, P2, 'V(3)', BF_B); control(g, BF_B, P2);
  fundAll(g, P2);
  const rw = hand(g, P2, 'Ride the Wind');
  g = move(g, P0, [a], BF_A);
  g = pass(g); g = pass(g);
  expectPending(g, 'showdownAction', P2);
  g = act(g, { type: 'playCard', player: P2, obj: rw });
  let offered: string[] = [];
  g = drive(g, h => { const d = pend(h); if (d.kind === 'chooseDestination' && d.player === P2) { offered = d.options!.map(o => o.id); return ['base']; } return null; });
  assert.ok(offered.length > 0, 'destination asked');
  assert.ok(!offered.includes(String(BF_A)), `combat battlefield not offered (${offered.join(',')})`);
  assert.notEqual(locOf(g, c), BF_A);
});

test('RJ#2810 Sigil of the Storm: exhaust a rune for energy, then recycle that rune to the conquer trigger — the energy stays in the pool', () => {
  let g = S0();
  setBattlefieldCard(g, BF_A, 'Sigil of the Storm');
  const r = g.players[P0].runesInPlay[0];
  const tap = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === r)!;
  g = act(g, tap);
  assert.equal(g.players[P0].pool.energy, 1);
  const u = put(g, P0, 'V(1)', 'base');
  g = move(g, P0, [u], BF_A);
  g = drive(g, h => (pend(h).options?.some(o => o.id === r) ? [r] : null));
  assert.equal(g.players[P0].points, 1);
  assert.equal(zone(g, r), 'runeDeck', 'the tapped rune was recycled');
  assert.equal(g.players[P0].pool.energy, 1, 'floating energy kept');
});

test('RJ#2813 A hidden Hidden Blade at battlefield B can be played during a showdown at A, but may only choose units at B', () => {
  let { g, def } = attackSetup(['V(3)'], ['V(3)']);
  fundAll(g, P0);
  const mine = put(g, P0, 'V(2)', BF_B); control(g, BF_B, P0);
  const hb = put(g, P0, 'Hidden Blade', { facedown: BF_B });
  expectPending(g, 'showdownAction', P0);
  assert.ok(canPlayNow(g, P0, hb));
  g = act(g, { type: 'playCard', player: P0, obj: hb });
  const d = pend(g);
  const opts = d.kind === 'chooseTargets' ? d.options!.map(o => o.id) : [];
  assert.ok(!opts.includes(def[0]), 'unit at A not choosable (CR 811.1.d.3)');
  if (d.kind === 'chooseTargets') assert.ok(opts.includes(mine));
  else assert.ok(g.chain.some(c => JSON.stringify(c).includes(mine)) && !g.chain.some(c => JSON.stringify(c).includes(def[0])), 'auto-chosen: the only unit at B');
});

test('RJ#2815 Reaver\'s Row moves the lone defender (Nocturne) to base: the defender keeps control during combat and may still play hidden Teemo there', () => {
  let g = S0({ bfA: "Reaver's Row" });
  fundAll(g, P1);
  const n = put(g, P1, 'Nocturne, Horrifying', BF_A); control(g, BF_A, P1);
  const t = put(g, P1, 'Teemo, Strategist', { facedown: BF_A });
  const m = put(g, P0, 'Traveling Merchant', 'base');
  g = move(g, P0, [m], BF_A);
  let played = false;
  for (let i = 0; i < 30; i++) {
    const x = pend(g);
    if (x.kind === 'mainAction') break;
    if (x.inStep) { const ids = x.kind === 'optional' ? ['yes'] : x.options?.some(o => o.id === n) ? [n] : null; g = ids ? act(g, { type: 'choose', player: x.player, optionIds: ids }) : act(g, legal(g, x.player)[0]); continue; }
    if (!played && x.kind === 'showdownAction' && x.player === P1 && locOf(g, n) === 'base') {
      assert.equal(g.battlefields[BF_A].controller, P1, 'still controlled mid-combat');
      assert.equal(zone(g, t), 'facedown', 'hidden card kept');
      assert.ok(canPlayNow(g, P1, t));
      g = act(g, { type: 'playCard', player: P1, obj: t }); played = true; continue;
    }
    g = pass(g);
  }
  assert.ok(played, 'Teemo was played from hidden after Nocturne left');
  assert.equal(locOf(g, n), 'base');
});

test('RJ#2816 Twisted Fate, Gambler revealing a Fury rune: the attack-trigger damage kills defenders before combat damage, so they deal none back', () => {
  let g = S0();
  const rd = g.players[P0].runeDeck;
  assert.ok(g.cards[g.objects[rd[0]].cardId].domains.includes('Fury'), 'top rune is Fury');
  const tf = put(g, P0, 'Twisted Fate, Gambler', 'base');
  const d1 = put(g, P1, 'V(2)', BF_A), d2 = put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [tf], BF_A);
  g = drive(g, h => (pend(h).options?.some(o => o.id === d1) ? [d1] : null));
  assert.equal(zone(g, d1), 'trash'); assert.equal(zone(g, d2), 'trash');
  assert.equal(locOf(g, tf), BF_A);
  assert.equal(g.objects[tf].damage ?? 0, 0, 'no combat damage back');
  assert.equal(g.players[P0].points, 1);
});

test('RJ#2819 Tibbers\' 3 damage stays until a combat cleanup (or end of turn); a combat at one battlefield heals units everywhere', () => {
  let g = S0();
  fundAll(g, P0);
  const far = put(g, P1, 'V(5)', BF_B); control(g, BF_B, P1);
  const d = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'Tibbers, Annie', { dest: 'base' });
  g = drive(g);
  assert.equal(g.objects[far].damage, 3, 'damage persists');
  const a = put(g, P0, 'V(1)', 'base');
  g = move(g, P0, [a], BF_A);
  g = drive(g);
  assert.equal(locOf(g, d), BF_A);
  assert.equal(g.objects[far].damage ?? 0, 0, 'combat cleanup healed all units, also at the other battlefield');
});

test('RJ#2822 The Harrowing playing an Accelerate unit (Thousand-Tailed Watcher): Accelerate may be paid — in full, [1][C] (only the base Energy cost is ignored)', () => {
  let g = S0();
  fundAll(g, P0);
  const w = put(g, P0, 'Thousand-Tailed Watcher', 'trash');
  const h = hand(g, P0, 'The Harrowing');
  const n0 = g.log.length;
  g = act(g, { type: 'playCard', player: P0, obj: h });
  let asked = false;
  g = drive(g, x => { const d = pend(x); if (d.options?.some(o => o.id === w)) return [w]; if (d.kind === 'optional') { asked = true; return ['yes']; } return null; });
  assert.ok(asked, 'Accelerate offered');
  assert.equal(zone(g, w), 'base');
  assert.equal(g.objects[w].exhausted, false, 'entered ready');
  const pays = g.log.slice(n0).map(l => l.text).filter(t => /^P0 pays/.test(t));
  // ENGINE-2: the effect play's cost is paid in one payment after the choices (CR 357): the Watcher's power cost + Accelerate
  assert.deepEqual(pays, ['P0 pays 6 C C', 'P0 pays 1 M M'], 'Harrowing; Watcher\'s power cost + Accelerate [1][C] incl. its energy (CR 356 order: ignore base cost, then add additional costs; CR 805.1.b)');
});

test('RJ#2826 Blood Rush + Repeat on the same unit: Assault stacks (Assault 4) and lasts this turn only', () => {
  let g = S0();
  fundAll(g, P0);
  const u = put(g, P0, 'V(2)', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Blood Rush') });
  g = drive(g, h => { const d = pend(h); if (d.kind === 'optional') return ['yes']; return d.options?.some(o => o.id === u) ? [u] : null; });
  assert.equal(kwValueOf(g, u, 'Assault'), 4);
  g = nextTurn(g);
  assert.equal(kwValueOf(g, u, 'Assault'), 0);
});

test('RJ#2829 Heimerdinger, Inventor has each friendly [T] ability (legend + gear); each use pays its own cost incl. exhausting him, so one exhaust = one ability', () => {
  let g = S0();
  withTokens(g);
  fundAll(g, P0);
  const hm = put(g, P0, 'Heimerdinger, Inventor', 'base');
  put(g, P0, 'Iron Ballista', 'base');
  setLegend(g, P0, 'Herald of the Arcane');
  const e = put(g, P1, 'V(9)', BF_A);
  const heimer = (h: GameState) => legal(h, P0, 'activate').filter(a => a.type === 'activate' && a.obj === hm);
  assert.equal(heimer(g).length, 2, 'two gained [T] abilities');
  const outs = heimer(g).map(a => drive(act(g, a), h => (pend(h).options?.some(o => o.id === e) ? [e] : null)));
  assert.ok(outs.some(h => h.objects[e].damage === 2), 'Ballista\'s ability used by Heimerdinger');
  assert.ok(outs.some(h => h.objects[e].damage !== 2), 'the legend\'s ability is the other one');
  for (const h of outs) {
    assert.equal(h.objects[hm].exhausted, true);
    assert.equal(heimer(h).length, 0, 'no second activation without readying');
  }
});

test('RJ#2832 Dr. Mundo, Expert\'s Might rises as each spell resolves into the trash, mid-chain', () => {
  let g = S0();
  fundAll(g, P0);
  clearTrash(g, P0);
  const m = put(g, P0, 'Dr. Mundo, Expert', 'base');
  const e = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  assert.equal(mightOf(g, m), 6);
  g = play(g, P0, hand(g, P0, 'Stupefy'), { targets: [[e]] });
  g = play(g, P0, hand(g, P0, 'Stupefy'), { targets: [[e]] });
  assert.equal(g.chain.length, 2);
  for (let i = 0; i < 4 && g.chain.length === 2; i++) g = pass(g);
  assert.equal(g.chain.length, 1, 'one Stupefy resolved, one still on the chain');
  assert.equal(mightOf(g, m), 7, 'already +1');
  g = drive(g);
  assert.equal(mightOf(g, m), 8);
});

test('RJ#2837 Thousand-Tailed Watcher at Trifarian War Camp: 1-Might unit ends at 1, 4-Might unit at 2', () => {
  let g = S0({ bfA: 'Trifarian War Camp' });
  fundAll(g, P0);
  const a = put(g, P1, 'V(1)', BF_A), b = put(g, P1, 'V(4)', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'Thousand-Tailed Watcher', { dest: 'base', may: [false] });
  g = drive(g, h => (pend(h).kind === 'optional' ? ['no'] : null));
  assert.equal(mightOf(g, a), 1);
  assert.equal(mightOf(g, b), 2);
});

test('RJ#2838 Not So Fast cannot counter Downwell or Thermo Beam (they choose nothing)', () => {
  for (const sp of ['Downwell', 'Thermo Beam']) {
    let g = S0();
    fundAll(g, P0); fundAll(g, P1);
    put(g, P1, 'V(1)', 'base'); put(g, P1, 'Iron Ballista', 'base');
    const ns = hand(g, P1, 'Not So Fast');
    [g] = cast(g, P0, sp);
    assert.equal(g.chain.length, 1, sp);
    g = pass(g);
    expectPending(g, 'chainResponse', P1);
    assert.equal(canPlayNow(g, P1, ns), false, sp);
  }
});

// RJ#2839 — AMBIGUOUS → DECIDED (house, DECISIONS #2839; RJ#8377 agrees): Stealthy Pursuer's "When a friendly unit moves from my
// location, I may be moved with it" is a triggered ability (CR 383 "When" wording; no errata/FAQ), not a passive: the friend moves first,
// Pursuer's trigger goes on the chain (players may respond); "with it" = the friend's location on resolution, so Gusting it stops the move.
test('RJ#2839 (house) Stealthy Pursuer is a trigger: the opponent may Gust the moved unit in response, and then Pursuer is not moved', () => {
  let g = S0();
  fundAll(g, P1, 2);
  const sp = put(g, P0, 'Stealthy Pursuer', 'base');
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_A);
  if (pend(g).kind === 'optional') g = choose(g, 'yes');
  assert.equal(locOf(g, u), BF_A, 'the friend has already moved');
  assert.equal(locOf(g, sp), 'base', 'Pursuer has not moved yet (its trigger is on the chain)');
  assert.ok(g.chain.some(c => c.source === sp), 'Pursuer trigger on the chain');
  if (pend(g).player !== P1) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Gust'), { targets: [[u]] });
  g = resolveChain(g);
  if (pend(g).kind === 'optional') g = choose(g, 'yes');
  g = resolveChain(g);
  assert.equal(zone(g, u), 'hand');
  assert.equal(locOf(g, sp), 'base');
});

test('RJ#2841 A hidden Switcheroo cannot be Defied: Defy checks the printed cost ([2] + 2 power), not the [0] paid from hidden', () => {
  let g = S0();
  fundAll(g, P1);
  const a = put(g, P0, 'V(1)', BF_A), b = put(g, P0, 'V(4)', BF_A); control(g, BF_A, P0);
  const sw = put(g, P0, 'Switcheroo', { facedown: BF_A });
  const df = hand(g, P1, 'Defy');
  g = act(g, { type: 'playCard', player: P0, obj: sw });
  g = answer(g, { targets: [[a, b]] }, P0);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = act(g, legal(g, pend(g).player)[0]);
  assert.equal(g.chain.length, 1);
  g = pass(g);
  expectPending(g, 'chainResponse', P1);
  assert.equal(canPlayNow(g, P1, df), false);
});

test('RJ#2845 A buffed unit with Orb of Regret\'s -1 saved by Zhonya\'s Hourglass keeps both (the -1 still ends this turn)', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P1);
  put(g, P0, "Zhonya's Hourglass", 'base');
  const u = put(g, P0, 'V(3)', BF_A, { buff: true }); control(g, BF_A, P0);
  const orb = put(g, P1, 'Orb of Regret', 'base');
  g = act(g, legal(g, P1, 'activate').find(a => a.type === 'activate' && a.obj === orb)!);
  g = drive(g, h => (pend(h).options?.some(o => o.id === u) ? [u] : null));
  assert.equal(mightOf(g, u), 3, '3 +1 buff -1');
  g = play(g, P1, putF(g, P1, 'rjf-killr', 'hand'), { targets: [[u]] });
  g = drive(g, h => (pend(h).kind === 'optional' ? ['yes'] : null));
  assert.equal(zone(g, u), 'base');
  assert.equal(g.objects[u].counters.buff ?? 0, 1, 'buff kept');
  assert.equal(mightOf(g, u), 3, '-1 kept');
  g = nextTurn(g);
  assert.equal(mightOf(g, u), 4, '-1 expired at end of turn');
});

test('RJ#2846 Yasuo, Remorseful\'s attack trigger may choose a non-Tank unit even with a Tank defending (Tank only affects combat damage assignment)', () => {
  let g = S0();
  const y = put(g, P0, 'Yasuo, Remorseful', 'base');
  const tank = put(g, P1, 'Sett, Kingpin', BF_A), o = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [y], BF_A);
  const d = pend(g);
  assert.equal(d.kind, 'chooseTargets');
  assert.ok(d.options!.some(x => x.id === o) && d.options!.some(x => x.id === tank));
  g = choose(g, o);
  for (let i = 0; i < 4 && g.chain.length; i++) g = pass(g);
  assert.equal(zone(g, o), 'trash');
});

test('RJ#2847 Mask of Foresight: a unit attacking alone twice in a turn (second time via Ride the Wind) gets +1 each combat: +2 total', () => {
  let g = S0();
  fundAll(g, P0);
  put(g, P0, 'Mask of Foresight', 'base');
  const u = put(g, P0, 'V(3)', 'base');
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  g = move(g, P0, [u], BF_A); g = drive(g);
  assert.equal(locOf(g, u), BF_A);
  assert.equal(mightOf(g, u), 4);
  [g] = cast(g, P0, 'Ride the Wind', { targets: [[u]], dest: BF_B, locations: [BF_B] });
  g = drive(g, h => (pend(h).kind === 'chooseDestination' ? [String(BF_B)] : null));
  assert.equal(locOf(g, u), BF_B);
  assert.equal(mightOf(g, u), 5, '+1 per combat');
});

test('RJ#2848 Malzahar, Fanatic\'s "Kill a friendly unit or gear" cost cannot kill enemy gear', () => {
  let g = S0();
  const m = put(g, P0, 'Malzahar, Fanatic', 'base');
  const eg = put(g, P1, 'Iron Ballista', 'base');
  const fg = put(g, P0, 'Iron Ballista', 'base');
  const fu = put(g, P0, 'V(1)', 'base');
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === m)!);
  const d = pend(g);
  if (d.inStep && d.options) {
    assert.ok(!d.options.some(o => o.id === eg), 'enemy gear not offered');
    assert.ok(d.options.some(o => o.id === fg) && d.options.some(o => o.id === fu));
    g = act(g, { type: 'choose', player: P0, optionIds: [fg] });
  }
  g = drive(g);
  assert.equal(zone(g, eg), 'base');
  assert.equal(zone(g, fg), 'trash');
});

test('RJ#2849 A unit may be played directly to a battlefield you control (it still enters exhausted, like any played unit)', () => {
  let g = S0();
  fundAll(g, P0);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const u = hand(g, P0, 'V(2)');
  assert.ok(playDests(g, P0, u).map(String).includes(String(BF_A)));
  assert.ok(!playDests(g, P0, u).map(String).includes(String(BF_B)), 'not to an uncontrolled battlefield');
  g = act(g, { type: 'playCard', player: P0, obj: u, destination: BF_A });
  g = drive(g);
  assert.equal(locOf(g, u), BF_A);
  assert.equal(g.objects[u].exhausted, true);
});

test('RJ#2851 Tideturner played from hidden may swap with a non-Ganking unit at the other battlefield', () => {
  let g = S0();
  fundAll(g, P0);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const far = put(g, P0, 'V(2)', BF_B); control(g, BF_B, P0);
  const t = put(g, P0, 'Tideturner', { facedown: BF_A });
  g = act(g, { type: 'playCard', player: P0, obj: t });
  g = drive(g, h => (pend(h).options?.some(o => o.id === far) ? [far] : null));
  assert.equal(locOf(g, t), BF_B);
  assert.equal(locOf(g, far), BF_A);
});

test('RJ#2856 Reaver\'s Row ("When you defend here") triggers once per combat; a unit swapped in by hidden Tideturner does not retrigger it', () => {
  let g = S0({ bfA: "Reaver's Row" });
  fundAll(g, P1);
  put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const sub = put(g, P1, 'V(6)', 'base');
  const t = put(g, P1, 'Tideturner', { facedown: BF_A });
  const a = put(g, P0, 'V(3)', 'base');
  let rows = 0;
  const isRow = (h: GameState) => /Reaver/.test(pend(h).prompt ?? '');
  g = move(g, P0, [a], BF_A);
  let played = false;
  for (let i = 0; i < 40; i++) {
    const x = pend(g);
    if (x.kind === 'mainAction') break;
    if (x.inStep) {
      if (isRow(g)) { rows++; g = act(g, { type: 'choose', player: x.player, optionIds: x.kind === 'optional' ? ['no'] : [] }); continue; }
      const ids = x.options?.some(o => o.id === sub) ? [sub] : null;
      g = ids ? act(g, { type: 'choose', player: x.player, optionIds: ids }) : act(g, legal(g, x.player)[0]);
      continue;
    }
    if (!played && x.kind === 'showdownAction' && x.player === P1) { g = act(g, { type: 'playCard', player: P1, obj: t }); played = true; continue; }
    g = pass(g);
  }
  assert.ok(played);
  assert.equal(locOf(g, sub), BF_A, 'swapped in');
  assert.equal(rows, 1, 'Reaver\'s Row asked once');
});

test('RJ#2859 Charm an exhausted enemy unit into my battlefield: it stays exhausted, attacks, and if it wins its controller conquers (scores)', () => {
  let g = S0();
  fundAll(g, P0);
  const e = put(g, P1, 'V(5)', 'base', { ready: false });
  const mine = put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  [g] = cast(g, P0, 'Charm', { targets: [[e]] });
  g = drive(g, h => (pend(h).kind === 'chooseDestination' || pend(h).kind === 'chooseBattlefield' ? [String(BF_A)] : null));
  assert.equal(zone(g, mine), 'trash');
  assert.equal(locOf(g, e), BF_A);
  assert.equal(g.objects[e].exhausted, true, 'kept its state');
  assert.equal(g.players[P1].points, 1, 'conquer on my turn');
});

test('RJ#2863 Removing a +2 Equipment (Thermo Beam kills Doran\'s Blade) from a damaged unit: it dies once damage >= its new Might', () => {
  let g = S0();
  fundAll(g, P0);
  const u = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  attachNow(g, put(g, P1, "Doran's Blade", BF_A), u);
  assert.equal(mightOf(g, u), 4);
  g.objects[u].damage = 3;
  const z = put(g, P1, 'V(1)', 'base', { ready: false });
  g = play(g, P0, hand(g, P0, 'Thermo Beam'), {});
  g = drive(g);
  assert.equal(zone(g, u), 'trash', '3 damage vs 2 Might');
  assert.equal(zone(g, z), 'base');
});

test('RJ#2868 Monastery of Hirana: the buff spent may come from a friendly unit in base', () => {
  let g = S0({ bfA: 'Monastery of Hirana' });
  const b = put(g, P0, 'V(1)', 'base', { buff: true });
  const u = put(g, P0, 'V(2)', 'base');
  const h = handN(g, P0);
  g = move(g, P0, [u], BF_A);
  g = drive(g, x => { const d = pend(x); if (d.kind === 'optional') return ['yes']; return d.options?.some(o => o.id === b) ? [b] : null; });
  assert.equal(g.players[P0].points, 1);
  assert.equal(g.objects[b].counters.buff ?? 0, 0, 'base unit\'s buff spent');
  assert.equal(handN(g, P0), h + 1);
});

test('RJ#2869 Baited Hook playing Karma, Channeler: Karma is played only after Hook finishes (incl. its recycle), so her "when you recycle" does not see it', () => {
  let g = S0();
  fundAll(g, P0);
  const hook = put(g, P0, 'Baited Hook', 'base');
  const v = put(g, P0, 'V(5)', 'base');
  const [k] = stackTop(g, P0, 'Karma, Channeler', 'V(1)', 'V(1)', 'V(1)', 'V(1)');
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === hook)!);
  const n0 = g.log.length;
  g = drive(g, h => { const d = pend(h); if (d.options?.some(o => o.id === v)) return [v]; if (d.options?.some(o => o.id === k)) return [k]; return d.kind === 'optional' ? ['yes'] : null; });
  assert.equal(zone(g, k), 'base');
  const log = g.log.slice(n0).map(l => l.text);
  assert.ok(!log.some(t => /Trigger: Karma: When you recycle/.test(t)), `no recycle trigger: ${log.join(' | ')}`);
});

test('RJ#2870 Possession (control change + recall) does not reset Yasuo, Windrider\'s move count: his new controller\'s next move is the third', () => {
  let g = S0();
  fundAll(g, P0, 6);
  const y = put(g, P1, 'Yasuo, Windrider', BF_A); control(g, BF_A, P1);
  for (const dest of [BF_B, BF_A]) {
    [g] = cast(g, P0, 'Charm', { targets: [[y]] });
    g = drive(g, h => (['chooseDestination', 'chooseBattlefield'].includes(pend(h).kind) ? [String(dest)] : null));
  }
  assert.equal(locOf(g, y), BF_A, 'moved twice');
  [g] = cast(g, P0, 'Possession', { targets: [[y]] });
  g = drive(g);
  assert.equal(g.objects[y].controller, P0);
  assert.equal(g.players[P0].points, 0);
  g = move(g, P0, [y], BF_B); g = drive(g);
  assert.equal(g.players[P0].points, 2, 'conquer of BF-B + Yasuo\'s third move this turn');
});

test('RJ#2874 Find Your Center with an empty rune deck: draw 1 only (no "draw instead" clause)', () => {
  let g = S0();
  fundAll(g, P0);
  for (const id of g.players[P0].runeDeck) delete g.objects[id];
  g.players[P0].runeDeck = [];
  const fy = hand(g, P0, 'Find Your Center');
  const h = handN(g, P0);
  g = play(g, P0, fy, {});
  g = drive(g);
  assert.equal(handN(g, P0), h - 1 + 1);
});

test('RJ#2876 Activating Hand of Noxus (Darius legend) is not playing a card: a following Legion card (Noxian Guillotine) is not Legion-active', () => {
  let g = S0();
  fundAll(g, P0);
  const lg = setLegend(g, P0, 'Hand of Noxus');
  const e = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const ab = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === lg);
  if (ab) { g = act(g, ab); g = drive(g); }
  g = play(g, P0, hand(g, P0, 'Noxian Guillotine, Darius'), { targets: [[e]] });
  g = drive(g);
  assert.equal(locOf(g, e), BF_A, 'no Legion: not killed now');
});

test('RJ#2877 Retreat my Darius, Trifarian to hand, then replay him as my second card: he enters and is readied with +2', () => {
  let g = S0();
  fundAll(g, P0);
  const d = put(g, P0, 'Darius, Trifarian', BF_A); control(g, BF_A, P0);
  g = play(g, P0, hand(g, P0, 'Retreat'), { targets: [[d]] });
  g = drive(g);
  assert.equal(zone(g, d), 'hand');
  g = act(g, { type: 'playCard', player: P0, obj: d, destination: 'base' });
  g = drive(g);
  assert.equal(zone(g, d), 'base');
  assert.equal(g.objects[d].exhausted, false);
  assert.equal(mightOf(g, d), 7);
});

test('RJ#2879 Soaring Scout recycled by Divine Judgment does not die: no Deathknell', () => {
  let g = S0();
  fundAll(g, P0);
  const sc = put(g, P0, 'Soaring Scout', 'base');
  const k1 = put(g, P0, 'V(1)', 'base'), k2 = put(g, P0, 'V(2)', 'base');
  [g] = cast(g, P0, 'Divine Judgment');
  g = drive(g, h => {
    const d = pend(h);
    if (d.kind !== 'chooseCards') return null;
    const ids = d.options!.map(o => o.id);
    if (ids.includes(sc)) return [k1, k2];      // (any player's units may be chosen, RJ#4173: P1 keeps the same two)
    return ids.slice(0, 2);
  });
  assert.equal(zone(g, sc), 'mainDeck', 'recycled');
  const runesNow = g.players[P0].runesInPlay.length;
  assert.equal(runesNow, 2, 'kept 2 runes, no Deathknell channel');
});

test('RJ#2881 Deadbloom Predator played to an occupied enemy battlefield starts the combat at once: no window to move other units in first', () => {
  let g = S0();
  fundAll(g, P0);
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const other = put(g, P0, 'V(3)', 'base');
  const db = hand(g, P0, 'Deadbloom Predator');
  g = act(g, { type: 'playCard', player: P0, obj: db, destination: BF_A });
  for (let i = 0; i < 6 && pend(g).inStep; i++) g = act(g, legal(g, pend(g).player)[0]);
  assert.notEqual(pend(g).kind, 'mainAction', 'combat/showdown under way');
  assert.equal(legal(g, P0, 'move').some(a => a.type === 'move' && a.units.includes(other)), false, 'no standard move now');
});

test('RJ#2883 Two Eager Apprentices at battlefields: spell Energy costs reduced by [2] (stacks), to a minimum of [1]', () => {
  const g = S0();
  fundAll(g, P0);
  put(g, P0, 'Eager Apprentice', BF_A); put(g, P0, 'Eager Apprentice', BF_A); control(g, BF_A, P0);
  const pf = hand(g, P0, 'Promising Future');
  const st = hand(g, P0, 'Stupefy');
  assert.equal(playCostOf(g, P0, pf)!.energy, 3, '5 - 1 - 1');
  assert.equal(playCostOf(g, P0, st)!.energy, 1, 'minimum [1]');
});

test('RJ#2885 Noxian Drummer (3) at Trifarian War Camp is 4 Might: not a legal Gust target', () => {
  let g = S0({ bfA: 'Trifarian War Camp' });
  fundAll(g, P0);
  const d = put(g, P1, 'Noxian Drummer', BF_A); control(g, BF_A, P1);
  const small = put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  const gu = hand(g, P0, 'Gust');
  assert.equal(mightOf(g, d), 4);
  assert.ok(canPlayNow(g, P0, gu));
  g = act(g, { type: 'playCard', player: P0, obj: gu });
  const d0 = pend(g);
  if (d0.kind === 'chooseTargets') assert.ok(!d0.options!.some(o => o.id === d) && d0.options!.some(o => o.id === small));
  else { g = drive(g); assert.equal(zone(g, small), 'hand'); }
  assert.equal(locOf(g, d), BF_A);
});

test('RJ#2888 Orb of Regret (no Action/Reaction) cannot be activated in a showdown on the opponent\'s turn', () => {
  let g = S0({ tp: P1 });
  const orb = put(g, P0, 'Orb of Regret', 'base');
  const u = put(g, P1, 'V(2)', 'base');
  g = move(g, P1, [u], BF_A);
  g = pass(g);
  expectPending(g, 'showdownAction', P0);
  assert.equal(legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === orb), false);
});

test('RJ#2890 Unyielding Spirit does not prevent Challenge damage (the units deal it, not the spell)', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const f = put(g, P0, 'V(4)', 'base');
  const e = put(g, P1, 'V(3)', 'base');
  [g] = cast(g, P0, 'Unyielding Spirit'); // prevents all spell and ability damage this turn
  g = settle(g);
  g = play(g, P0, hand(g, P0, 'Challenge'), { targets: [[f], [e]] });
  g = drive(g);
  assert.equal(zone(g, e), 'trash');
  assert.equal(g.objects[f].damage, 3);
});

test('RJ#2892 Gust whose target is pumped above 3 Might in response (En Garde) does nothing', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  g = play(g, P0, hand(g, P0, 'Gust'), { targets: [[u]] });
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'En Garde'), { targets: [[u]] });
  g = drive(g);
  assert.ok((mightOf(g, u) ?? 0) > 3);
  assert.equal(locOf(g, u), BF_A, 'not returned');
});

test('RJ#2893 Wuju Bladesman: Reaver\'s Row moves one of two defenders out; the remaining one defends alone and gets +2 before damage', () => {
  let g = S0({ bfA: "Reaver's Row" });
  setLegend(g, P1, 'Wuju Bladesman');
  const keep = put(g, P1, 'V(3)', BF_A), out = put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(4)', 'base');
  g = move(g, P0, [a], BF_A);
  g = drive(g, h => { const d = pend(h); if (d.kind === 'optional') return ['yes']; return d.options?.some(o => o.id === out) ? [out] : null; });
  assert.equal(locOf(g, out), 'base');
  assert.equal(zone(g, a), 'trash', '5-Might lone defender killed the 4-Might attacker');
  assert.equal(locOf(g, keep), BF_A);
});

test('RJ#2894 Lone Tasty Faefolk dies in combat: in response to its Deathknell its controller may still play the hidden Zhonya\'s there (to base) — both benefit', () => {
  let g = S0();
  const f = put(g, P1, 'Tasty Faefolk', BF_A); control(g, BF_A, P1);
  const z = put(g, P1, "Zhonya's Hourglass", { facedown: BF_A });
  const a = put(g, P0, 'V(9)', 'base');
  const r0 = g.players[P1].runesInPlay.length;
  g = move(g, P0, [a], BF_A);
  let played = false;
  for (let i = 0; i < 30; i++) {
    const x = pend(g);
    if (x.kind === 'mainAction') break;
    if (x.inStep) { g = act(g, legal(g, x.player)[0]); continue; }
    if (!played && x.player === P1 && zone(g, f) === 'trash' && g.chain.length && canPlayNow(g, P1, z)) { g = act(g, { type: 'playCard', player: P1, obj: z }); played = true; continue; }
    g = pass(g);
  }
  assert.ok(played, 'hidden Zhonya\'s playable while the Deathknell is on the chain');
  assert.equal(zone(g, z), 'base');
  assert.equal(g.players[P1].runesInPlay.length, r0 + 2, 'Deathknell channelled 2');
});

test('RJ#2895 Portal Rescue on a token: it ceases to exist once banished, so nothing is played back', () => {
  let g = S0();
  withTokens(g);
  fundAll(g, P0);
  const t = put(g, P0, 'ven-t04', BF_A); control(g, BF_A, P0);
  const before = Object.values(g.objects).filter(o => o.controller === P0 && g.cards[o.cardId]?.name === 'Recruit' && (o.zone === 'base' || o.zone === 'battlefield')).length;
  g = play(g, P0, hand(g, P0, 'Portal Rescue'), { targets: [[t]] });
  g = drive(g);
  const after = Object.values(g.objects).filter(o => o.controller === P0 && g.cards[o.cardId]?.name === 'Recruit' && (o.zone === 'base' || o.zone === 'battlefield')).length;
  assert.equal(before, 1);
  assert.equal(after, 0, 'no token played back');
});

test('RJ#2896 Cleave countered by Defy, my Defy counters their Defy: Cleave resolves', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P0, 'V(2)', 'base');
  const cl = hand(g, P0, 'Cleave');
  g = act(g, { type: 'playCard', player: P0, obj: cl }); // the only unit is auto-chosen
  if (pend(g).kind === 'chooseTargets') g = choose(g, u);
  g = pass(g);
  const d1 = hand(g, P1, 'Defy');
  g = act(g, { type: 'playCard', player: P1, obj: d1 });
  if (pend(g).kind === "chooseTargets") { const o = pend(g).options!; g = choose(g, (o.find(x => x.id === cl) ?? o.find(x => /Cleave/.test(x.label)) ?? o[0]).id); }
  g = pass(g);
  const d0 = hand(g, P0, 'Defy');
  g = act(g, { type: 'playCard', player: P0, obj: d0 });
  if (pend(g).kind === "chooseTargets") { const o = pend(g).options!; g = choose(g, (o.find(x => x.id === d1) ?? o.find(x => /Defy/.test(x.label)) ?? o[0]).id); }
  assert.equal(g.chain.length, 3);
  g = drive(g);
  assert.equal(zone(g, d1), 'trash');
  assert.ok(!g.log.some(l => /Cleave.*countered|countered.*Cleave/i.test(l.text)), 'Cleave not countered');
  assert.ok(g.log.some(l => /Resolving Cleave/.test(l.text)), 'Cleave resolved');
});

test('RJ#2899 Blitzcrank played to a battlefield: the opponent may react to his play trigger before their unit is dragged in', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(2)', BF_B); control(g, BF_B, P1);
  const kr = putF(g, P1, 'rjf-killr', 'hand');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Blitzcrank, Impassive'), destination: BF_A });
  for (let i = 0; i < 10 && !(pend(g).kind === 'chainResponse' && pend(g).player === P1); i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    g = act(g, { type: 'choose', player: d.player, optionIds: d.kind === 'optional' ? ['yes'] : o.includes(e) ? [e] : [o[0]] });
  }
  expectPending(g, 'chainResponse', P1);
  assert.ok(g.chain.length >= 1, 'the hook trigger is on the chain');
  assert.equal(locOf(g, e), BF_B, 'not moved yet');
  assert.ok(canPlayNow(g, P1, kr), 'a Reaction may be played in response');
});

test('RJ#2902 Hidden Consult the Past (no targets) can be played when the opponent attacks a different battlefield', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const cp = put(g, P0, 'Consult the Past', { facedown: BF_A });
  put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
  const a = put(g, P1, 'V(5)', 'base');
  g = move(g, P1, [a], BF_B);
  for (let i = 0; i < 6 && pend(g).player !== P0; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(canPlayNow(g, P0, cp), 'playable from BF-A during the combat at BF-B');
  const h = handN(g, P0);
  g = play(g, P0, cp, {});
  g = resolveChain(g);
  assert.equal(handN(g, P0), h + 2);
});

test('RJ#2904 Hidden Fight or Flight played from a battlefield can only choose a unit at that battlefield', () => {
  let h = S0({ tp: P1 });
  put(h, P0, 'V(1)', BF_A); control(h, BF_A, P0);
  const ff2 = put(h, P0, 'Fight or Flight', { facedown: BF_A });
  const atk = put(h, P1, 'V(3)', 'base');
  const away2 = put(h, P1, 'V(3)', BF_B); control(h, BF_B, P1);
  h = move(h, P1, [atk], BF_A);
  for (let i = 0; i < 6 && pend(h).player !== P0; i++) h = pend(h).inStep ? act(h, legal(h, pend(h).player)[0]) : pass(h);
  assert.ok(canPlayNow(h, P0, ff2));
  h = act(h, { type: 'playCard', player: P0, obj: ff2 });
  const d = pend(h);
  if (d.kind === 'chooseTargets') {
    assert.ok(!d.options!.some(o => o.id === away2), 'unit at the other battlefield is not a legal target');
    assert.ok(d.options!.some(o => o.id === atk));
  }
  h = drive(h, x => (optionIds(x).includes(atk) ? [atk] : null));
  assert.equal(zone(h, atk), 'base');
  assert.equal(locOf(h, away2), BF_B);
});

test('RJ#2905 Targon\'s Peak: the opponent may react to the conquer trigger and to the delayed end-of-turn ready; runes are readied anyway', () => {
  let g = S0({ bfA: "Targon's Peak" });
  fundAll(g, P1);
  for (const r of g.players[P0].runesInPlay) g.objects[r].exhausted = true;
  g.timestamp++;
  g = move(g, P0, [put(g, P0, 'V(1)', 'base')], BF_A);
  let sawConquer = false;
  for (let i = 0; i < 10 && g.pending?.kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'chainResponse' && d.player === P1 && g.chain.length) sawConquer = true;
    g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  assert.ok(sawConquer, 'P1 had priority with the conquer trigger on the chain');
  g = endTurn(g, P0);
  let sawEnd = false;
  for (let i = 0; i < 12 && g.activePlayer === P0; i++) {
    const d = pend(g);
    if (d.kind === 'chainResponse' && d.player === P1 && g.chain.length) sawEnd = true;
    g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: (d.options ?? []).slice(0, 2).map(o => o.id) }) : pass(g);
  }
  assert.ok(sawEnd, 'P1 had priority with the delayed ready on the chain at end of turn');
  assert.equal(g.players[P0].runesInPlay.filter(r => !g.objects[r].exhausted).length, 2, 'two runes readied');
});

test('RJ#2907 Unchecked Power with all friendly units already exhausted: still deals 12 to all units at battlefields', () => {
  let g = S0();
  fundAll(g, P0, 9);
  const f = put(g, P0, 'V(2)', 'base', { ready: false });
  const e = put(g, P1, 'V(6)', BF_A); control(g, BF_A, P1);
  assert.ok(canPlayNow(g, P0, hand(g, P0, 'Unchecked Power')));
  [g] = cast(g, P0, 'Unchecked Power');
  g = drive(g);
  assert.equal(zone(g, e), 'trash');
  assert.equal(zone(g, f), 'base', 'base unit unaffected');
});

test('RJ#2908 Reaver\'s Row moves my lone Traveling Merchant to base; discarding Flame Chompers, I may play it to Reaver\'s Row during the combat', () => {
  let g = S0({ bfA: "Reaver's Row", tp: P0 });
  fundAll(g, P1);
  const tm = put(g, P1, 'Traveling Merchant', BF_A); control(g, BF_A, P1);
  const fc = put(g, P1, 'Flame Chompers', 'hand');
  const a = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [a], BF_A);
  let dests: ('base' | number)[] = [];
  for (let i = 0; i < 30 && zone(g, fc) !== 'battlefield' && g.pending?.kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    if (d.kind === 'optional') { g = choose(g, 'yes'); continue; }
    if (o.includes(tm)) { g = choose(g, tm); continue; }
    if (o.includes(fc)) { g = choose(g, fc); continue; }
    if (o.includes(String(BF_A))) { dests = o.map(x => (x === 'base' ? 'base' : Number(x))); g = choose(g, String(BF_A)); continue; }
    g = act(g, legal(g, d.player)[0]);
  }
  assert.equal(locOf(g, tm), 'base');
  assert.equal(locOf(g, fc), BF_A, `Chompers played to Reaver's Row (dests offered: ${dests})`);
});

test('RJ#2909 Guardian Angel and Zhonya\'s Hourglass both able to replace one death: only one is used', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P1);
  const z = put(g, P0, "Zhonya's Hourglass", 'base');
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const ga = put(g, P0, 'Guardian Angel', BF_A);
  attachNow(g, ga, u);
  g = play(g, P1, putF(g, P1, 'rjf-killr', 'hand'), { targets: [[u]] });
  g = drive(g, x => (pend(x).kind === 'optional' ? ['yes'] : null));
  assert.equal(zone(g, u), 'base', 'saved and recalled');
  assert.deepEqual([zone(g, z), zone(g, ga)].filter(x => x === 'trash').length, 1, 'exactly one replacement consumed');
});

test('RJ#2901 Retreat on a unit at The Dreaming Tree countered by Defy: the Tree draw still happens', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  setBattlefieldCard(g, BF_A, 'The Dreaming Tree');
  const f = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const rt = hand(g, P0, 'Retreat');
  const h0 = handN(g, P0);
  g = play(g, P0, rt, { targets: [[f]] });
  for (let i = 0; i < 4 && pend(g).player !== P1; i++) g = pass(g);
  const df = hand(g, P1, 'Defy');
  g = act(g, { type: 'playCard', player: P1, obj: df });
  if (pend(g).kind === 'chooseTargets') g = choose(g, (pend(g).options!.find(o => o.id === rt) ?? pend(g).options![0]).id);
  g = drive(g);
  assert.equal(zone(g, rt), 'trash');
  assert.equal(locOf(g, f), BF_A, 'Retreat countered');
  assert.equal(handN(g, P0), h0 - 1 + 1, 'Tree draw resolved');
});

test('RJ#2911 A second card can\'t be hidden over an existing hidden card; once the first is played, a new one can be hidden there', () => {
  let g = S0();
  fundAll(g, P0);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const old = put(g, P0, 'Consult the Past', { facedown: BF_A });
  const nw = hand(g, P0, 'Consult the Past');
  const canHide = (x: GameState) => legal(x, P0, 'hide').some(a => a.type === 'hide' && a.obj === nw && a.battlefieldIndex === BF_A);
  assert.equal(canHide(g), false, 'one hidden card per battlefield');
  g = play(g, P0, old, {});
  g = resolveChain(g);
  assert.equal(zone(g, old), 'trash');
  assert.equal(canHide(g), true, 'slot free again');
});

test('RJ#2914 Dragon\'s Rage can move an enemy unit to a location with no other enemy unit: it moves, nothing is dealt', () => {
  let g = S0();
  fundAll(g, P0, 5);
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const dr = hand(g, P0, "Dragon's Rage");
  assert.ok(canPlayNow(g, P0, dr));
  g = play(g, P0, dr, { targets: [[e]] });
  g = drive(g, x => (optionIds(x).includes('base') ? ['base'] : null));
  assert.equal(zone(g, e), 'base');
  assert.equal(g.objects[e].damage, 0);
  assert.equal(zone(g, dr), 'trash');
});

test('RJ#2919 Unlicensed Armory (no Reaction) can\'t be used in response to the opponent\'s kill spell on their turn', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0); fundAll(g, P1);
  const ar = put(g, P0, 'Unlicensed Armory', 'base');
  const ar2 = hand(g, P0, 'Unlicensed Armory');
  hand(g, P0, 'V(1)');
  const u = put(g, P0, 'V(2)', 'base');
  g = play(g, P1, putF(g, P1, 'rjf-killr', 'hand'), { targets: [[u]] });
  if (pend(g).player === P1) g = pass(g);
  expectPending(g, 'chainResponse', P0);
  assert.equal(legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === ar), false, 'ability not usable');
  assert.equal(canPlayNow(g, P0, ar2), false, 'gear not playable as a Reaction');
  const k = S0(); fundAll(k, P0);
  const ark = put(k, P0, 'Unlicensed Armory', 'base'); hand(k, P0, 'V(1)'); put(k, P0, 'V(2)', 'base');
  assert.ok(legal(k, P0, 'activate').some(a => a.type === 'activate' && a.obj === ark), 'control: usable on my own open turn');
});

test('RJ#2921 Here to Help from hidden: the unit from hand is chosen on resolution; the opponent reacts without knowing it', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0);
  put(g, P0, 'V(2)', BF_B); control(g, BF_B, P0);
  const hth = put(g, P0, 'Here to Help', { facedown: BF_B });
  const u = hand(g, P0, 'V(3)');
  g = move(g, P1, [put(g, P1, 'V(1)', 'base')], BF_B);
  for (let i = 0; i < 4 && pend(g).player !== P0; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  g = act(g, { type: 'playCard', player: P0, obj: hth });
  for (let i = 0; i < 3 && !(pend(g).kind === 'chainResponse' && pend(g).player === P1); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  expectPending(g, 'chainResponse', P1);
  assert.equal(zone(g, u), 'hand', 'nothing chosen yet while the opponent may respond');
  g = pass(g);
  const d = pend(g);
  assert.ok(d.inStep && d.player === P0 && d.options!.some(o => o.id === u), 'unit picked during resolution');
  g = choose(g, u);
  g = drive(g, x => (optionIds(x).includes(String(BF_B)) ? [String(BF_B)] : null));
  assert.equal(locOf(g, u), BF_B);
});

test('RJ#2924 Relentless Storm (triggered, no colon) works on a Mighty unit Dazzling Aurora plays at the end of the turn', () => {
  let g = S0();
  setLegend(g, P0, 'Relentless Storm');
  put(g, P0, 'Dazzling Aurora', 'base');
  const [m] = stackTop(g, P0, 'V(5)');
  const r0 = g.players[P0].runesInPlay.length;
  g = endTurn(g, P0);
  for (let i = 0; i < 20 && g.activePlayer === P0; i++) { const d = pend(g); g = d.inStep ? (d.kind === 'optional' ? choose(g, 'yes') : act(g, legal(g, d.player)[0])) : pass(g); }
  assert.equal(zone(g, m), 'base', 'Aurora played the Mighty unit');
  assert.equal(g.players[P0].runesInPlay.length, r0 + 1, 'Relentless Storm channelled 1');
});

test('RJ#2925 Stupefy\'s "to a minimum of 1" is computed on resolution: a buffed 1-Might unit drops to 1, then to 0 when the buff is gone', () => {
  let g = S0();
  fundAll(g, P0);
  const u = put(g, P1, 'V(1)', BF_A, { buff: true }); control(g, BF_A, P1);
  assert.equal(mightOf(g, u), 2);
  g = play(g, P0, hand(g, P0, 'Stupefy'), { targets: [[u]] });
  g = drive(g);
  assert.equal(mightOf(g, u), 1);
  g.objects[u].counters.buff = 0; g.timestamp++;
  assert.equal(mightOf(g, u), 0, 'snapshotted -1 (CR 479.4.b)');
  assert.equal(zone(g, u), 'battlefield');
});

test('RJ#2926 Unforgiven moving an exhausted Traveling Merchant: its "When I move" triggers, and it attacks the occupied battlefield', () => {
  let g = S0();
  fundAll(g, P0);
  const lg = setLegend(g, P0, 'Unforgiven');
  const tm = put(g, P0, 'Traveling Merchant', 'base', { ready: false });
  hand(g, P0, 'V(1)');
  const e = put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  g = act(g, legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === lg)!);
  g = answer(g, { targets: [[tm]], battlefields: [BF_A], locations: [BF_A] }, P0);
  const n0 = g.log.length;
  g = drive(g, x => (optionIds(x).includes(String(BF_A)) ? [String(BF_A)] : null));
  assert.ok(g.log.slice(n0).some(l => /Traveling Merchant/.test(l.text) && /[Tt]rigger/.test(l.text)), 'move trigger');
  assert.equal(zone(g, e), 'trash', 'combat happened');
  assert.equal(g.battlefields[BF_A].controller, P0);
});

test('RJ#2929 Ride the Wind out of a combat into another: the first combat ends, its cleanup heals the unit, it fights the second at full health', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const a = put(g, P0, 'V(6)', 'base');
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const d2 = put(g, P1, 'V(5)', BF_B); control(g, BF_B, P1);
  const zap = hand(g, P1, 'ZapA');
  const rw = hand(g, P0, 'Ride the Wind');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 6 && !(pend(g).kind === 'showdownAction' && pend(g).player === P1); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  g = play(g, P1, zap, { targets: [[a]] });
  g = resolveChain(g);
  assert.equal(g.objects[a].damage, 2);
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  g = play(g, P0, rw, { targets: [[a]] });
  g = drive(g, x => (optionIds(x).includes(String(BF_B)) ? [String(BF_B)] : null));
  assert.equal(zone(g, d2), 'trash', '6 damage kills the 5');
  assert.equal(locOf(g, a), BF_B, 'healed before the second combat: 5 damage < 6 Might');
});

test('RJ#2932 Unchecked Power does not choose its victims: no Deflect tax for an enemy Deflect unit', () => {
  let g = S0();
  fundAll(g, P0, 9);
  const d = put(g, P1, 'Deflect(3,2)', BF_A); control(g, BF_A, P1);
  const up = hand(g, P0, 'Unchecked Power');
  g = act(g, { type: 'playCard', player: P0, obj: up });
  let askedDeflect = false;
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const x = pend(g);
    if (/Deflect/.test(x.prompt)) askedDeflect = true;
    g = x.inStep ? act(g, legal(g, x.player)[0]) : pass(g);
  }
  assert.equal(askedDeflect, false);
  assert.equal(zone(g, d), 'trash');
});

test('RJ#2934 Vision stacks: with two Gemcraft Seers a played unit has two Vision instances (two triggers)', () => {
  let g = S0();
  fundAll(g, P0);
  put(g, P0, 'Gemcraft Seer', 'base'); put(g, P0, 'Gemcraft Seer', 'base');
  stackTop(g, P0, 'V(1)', 'V(1)', 'V(1)');
  const n0 = g.log.length;
  [g] = cast(g, P0, 'V(2)', { dest: 'base' });
  let prompts = 0;
  g = drive(g, h => { if (/Vision|recycle/i.test(pend(h).prompt)) prompts++; return null; });
  const trig = g.log.slice(n0).filter(l => /Trigger/.test(l.text) && /Vision/.test(l.text)).length;
  void prompts;
  assert.equal(trig, 2, `two Vision triggers: ${g.log.slice(n0).map(l => l.text).join(' | ')}`);
});

test('RJ#2939 Yasuo, Remorseful\'s attack trigger choosing Deadbloom Predator owes the Deflect tax (paying it recycles a rune; PATCH-1 lets it be refused)', () => {
  let g = S0();
  fundAll(g, P0);
  const y = put(g, P0, 'Yasuo, Remorseful', 'base');
  const db = put(g, P1, 'Deadbloom Predator', BF_A); control(g, BF_A, P1);
  const r0 = g.players[P0].runesInPlay.length;
  g = move(g, P0, [y], BF_A);
  let asked = false;
  g = drive(g, x => { if (/Deflect/.test(pend(x).prompt)) { asked = true; return pend(x).kind === 'optional' ? ['yes'] : null; } return null; });
  assert.ok(asked, 'Deflect payment asked for the trigger');
  assert.equal(g.players[P0].runesInPlay.length, r0 - 1, 'one rune recycled for [A]');
  assert.equal(g.objects[db].damage >= 6 || zone(g, db) === 'trash', true, 'trigger dealt its damage');
});

test('RJ#2943 Two The Arena\'s Greatest in play: each triggers, so a player gains 2 points at their first Beginning Phase', () => {
  let g = S0();
  setBattlefieldCard(g, BF_A, "The Arena's Greatest");
  setBattlefieldCard(g, BF_B, "The Arena's Greatest");
  g.players[P1].turnsTaken = 0;
  g = endTurn(g, P0);
  g = drive(g);
  assert.equal(g.activePlayer, P1);
  assert.equal(g.players[P1].points, 2);
});

test('RJ#2946 Float energy from runes in response to Ekko\'s Deathknell ("ready your runes"): keep it and tap the readied runes again', () => {
  let g = S0();
  const rs = setRunes(g, P0, 3, 'fury');
  const ek = put(g, P0, 'ogn-110-298', 'base');
  g = play(g, P0, putF(g, P0, 'rjf-killr', 'hand'), { targets: [[ek]] });
  for (let i = 0; i < 6 && !(g.chain.some(c => c.source === ek) && pend(g).player === P0 && !pend(g).inStep); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(g.chain.some(c => c.source === ek), 'Deathknell on the chain');
  for (const r of rs) {
    if (g.objects[r].exhausted) continue;
    for (const ab of legal(g, P0, 'activate').filter(a => a.type === 'activate' && a.obj === r)) {
      const t = act(g, ab);
      if (t.players[P0].runesInPlay.includes(r)) { g = t; break; } // exhaust for energy, not recycle
    }
  }
  const floated = g.players[P0].pool.energy;
  assert.ok(floated >= 2, 'floated the remaining runes');
  g = resolveChain(g);
  assert.equal(zone(g, ek), 'mainDeck', 'Ekko recycled');
  assert.equal(g.players[P0].pool.energy, floated, 'floated energy kept');
  assert.equal(g.players[P0].runesInPlay.filter(r => !g.objects[r].exhausted).length, 3, 'runes readied: tap again');
});

test('RJ#2949 During my showdown at an open battlefield, the opponent Ride the Winds a unit to the other open battlefield: after my showdown, theirs follows and they conquer (score) on my turn', () => {
  let g = S0();
  fundAll(g, P1);
  const y = put(g, P0, 'V(2)', 'base');
  const w = put(g, P1, 'V(2)', 'base');
  g = move(g, P0, [y], BF_A);
  for (let i = 0; i < 4 && !(pend(g).kind === 'showdownAction' && pend(g).player === P1); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  expectPending(g, 'showdownAction', P1);
  g = play(g, P1, hand(g, P1, 'Ride the Wind'), { targets: [[w]] });
  g = drive(g, x => (optionIds(x).includes(String(BF_B)) ? [String(BF_B)] : null));
  assert.equal(locOf(g, w), BF_B);
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.battlefields[BF_B].controller, P1);
  assert.equal(g.players[P0].points, 1);
  assert.equal(g.players[P1].points, 1, 'conquered on the opponent\'s turn');
});

test('RJ#2953 Playing Yasuo, Windrider is not a move: after being played, his third move (not second) scores', () => {
  let g = S0();
  fundAll(g, P0, 12);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const y = hand(g, P0, 'Yasuo, Windrider');
  g = act(g, { type: 'playCard', player: P0, obj: y, destination: BF_A });
  g = drive(g);
  assert.equal(locOf(g, y), BF_A);
  for (const dest of ['base', BF_A] as const) {
    g = play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[y]] });
    g = drive(g, x => (optionIds(x).includes(String(dest)) ? [String(dest)] : null));
    assert.equal(locOf(g, y), dest);
  }
  assert.equal(g.players[P0].points, 0, 'two moves so far (playing him was not one)');
  g = move(g, P0, [y], 'base'); g = drive(g);
  assert.equal(g.players[P0].points, 1, 'third move scores');
});

test('RJ#2954 Moving into an empty battlefield is not an attack: Mask of Foresight does not trigger', () => {
  let g = S0();
  put(g, P0, 'Mask of Foresight', 'base');
  const u = put(g, P0, 'V(2)', 'base');
  const n0 = g.log.length;
  g = move(g, P0, [u], BF_A);
  assert.equal(g.chain.length, 0, 'no attack trigger');
  g = drive(g);
  assert.ok(!g.log.slice(n0).some(l => /Mask of Foresight/.test(l.text) && /Trigger/.test(l.text)));
  assert.equal(g.battlefields[BF_A].controller, P0);
});

test('RJ#2955 Gust in response to Teemo (Scout)\'s "When you play me, +3" returns him to hand before he grows', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const t = hand(g, P0, 'ogn-197-298');
  g = act(g, { type: 'playCard', player: P0, obj: t, destination: BF_A });
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = act(g, legal(g, pend(g).player)[0]);
  assert.equal(g.chain.length, 1, 'play trigger on the chain');
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Gust'), { targets: [[t]] });
  g = drive(g);
  assert.equal(zone(g, t), 'hand');
});

test('RJ#2956 Defiant Dance needs two different units on the board to be played', () => {
  const g = S0();
  fundAll(g, P0);
  const u = put(g, P0, 'V(2)', 'base');
  const dd = hand(g, P0, 'Defiant Dance');
  assert.equal(canPlayNow(g, P0, dd), false, 'only one unit');
  put(g, P1, 'V(2)', 'base');
  assert.equal(canPlayNow(g, P0, dd), true, 'two units');
  void u;
});

test('RJ#2962 Switcheroo choosing an enemy Deflect unit owes the Deflect tax; a friendly Deflect unit does not', () => {
  const run = (enemy: boolean) => {
    let g = S0();
    fundAll(g, P0);
    const mine = put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
    const d = put(g, enemy ? P1 : P0, 'Deflect(4,1)', BF_A);
    if (enemy) put(g, P1, 'V(1)', BF_A);
    g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Switcheroo') });
    let asked = false;
    for (let i = 0; i < 10 && pend(g).inStep; i++) {
      const x = pend(g);
      if (/Deflect/.test(x.prompt)) asked = true;
      const o = optionIds(g);
      g = x.kind === 'chooseTargets' && o.includes(mine) && o.includes(d) ? act(g, { type: 'choose', player: P0, optionIds: [mine, d] }) : x.kind === 'chooseTargets' && o.includes(d) ? choose(g, d) : x.kind === 'chooseTargets' && o.includes(mine) ? choose(g, mine) : act(g, legal(g, x.player)[0]);
    }
    void asked;
    const it = g.chain.find(c => c.label === 'Switcheroo')!;
    assert.deepEqual([...it.targets[0]].sort(), [mine, d].sort());
    return (it.choices as { paid: { power: number } }).paid.power;
  };
  assert.equal(run(true), 3, 'enemy Deflect: [2] + [A] tax');
  assert.equal(run(false), 2, 'own Deflect unit: no tax');
});

test('RJ#2965 Conquering The Candlelit Sanctum with Void Burrower (Rek\'Sai legend): both conquer triggers go on the chain and I order them', () => {
  let g = S0({ bfA: 'The Candlelit Sanctum' });
  setLegend(g, P0, 'Void Burrower');
  stackTop(g, P0, 'V(1)', 'V(1)', 'V(1)');
  g = move(g, P0, [put(g, P0, 'V(2)', 'base')], BF_A);
  let ordered = false;
  for (let i = 0; i < 12 && !ordered && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'orderTriggers') { ordered = true; assert.equal(d.player, P0); assert.equal(d.options!.length, 2); break; }
    g = d.inStep ? (d.kind === 'optional' ? choose(g, 'yes') : act(g, legal(g, d.player)[0])) : pass(g);
  }
  assert.ok(ordered, 'controller orders the two conquer triggers');
});

test('RJ#2967 Incinerate ("a unit at a battlefield") whose target Flashes to base in response deals nothing', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const inc = hand(g, P0, 'Incinerate');
  g = play(g, P0, inc, { targets: [[u]] });
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Flash'), { targets: [[u]] });
  g = drive(g);
  assert.equal(zone(g, u), 'base');
  assert.equal(g.objects[u].damage ?? 0, 0);
  assert.equal(zone(g, inc), 'trash');
});

test('RJ#2972 Targon\'s Peak triggers on conquer only, not on hold', () => {
  let g = S0({ bfA: "Targon's Peak", tp: P1 });
  put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const n0 = g.log.length;
  g = endTurn(g, P1);
  g = drive(g);
  assert.equal(g.activePlayer, P0);
  assert.equal(g.players[P0].points, 1, 'held');
  assert.ok(!g.log.slice(n0).some(l => /Targon/.test(l.text) && /Trigger/.test(l.text)), 'no Targon\'s Peak trigger');
});

test('RJ#2974 Viktor (ogn-246) makes a Recruit when a Sprite token dies to Temporary', () => {
  let g = S0({ tp: P1 });
  withTokens(g);
  put(g, P0, 'ogn-246-298', 'base');
  put(g, P0, 'unl-t07', 'base');
  const recruits = (x: GameState) => Object.values(x.objects).filter(o => o.controller === P0 && x.cards[o.cardId]?.name === 'Recruit' && ['base', 'battlefield'].includes(o.zone)).length;
  assert.equal(recruits(g), 0);
  g = endTurn(g, P1);
  g = drive(g);
  assert.equal(g.activePlayer, P0);
  assert.equal(recruits(g), 1, 'Sprite died at the start of my turn: +1 Recruit');
});

test('RJ#2979 A combat Deathknell resolves after the combat cleanup heals units (Ruined Rex\'s 4 does not stack on the combat damage)', () => {
  let { g, atk, def } = attackSetup(['V(7)'], ['Ruined Rex']);
  g = drive(g, x => (optionIds(x).includes(atk[0]) ? [atk[0]] : null));
  assert.equal(zone(g, def[0]), 'trash');
  assert.equal(locOf(g, atk[0]), BF_A, 'healed 6 combat damage before the Deathknell\'s 4: survives');
  assert.equal(g.objects[atk[0]].damage, 4, 'Deathknell damage stays marked');
  assert.equal(g.battlefields[BF_A].controller, P0, 'conquered after the Deathknell');
});

test('RJ#2983 Teemo (Scout) played from hidden at Trifarian War Camp is not Mighty when played (his +3 is a later trigger): no Relentless Storm', () => {
  let g = S0({ bfA: 'Trifarian War Camp', tp: P1 });
  setLegend(g, P0, 'Relentless Storm');
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const t = put(g, P0, 'ogn-197-298', { facedown: BF_A });
  g = move(g, P1, [put(g, P1, 'V(1)', 'base')], BF_A);
  for (let i = 0; i < 6 && !(pend(g).player === P0 && !pend(g).inStep); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(canPlayNow(g, P0, t));
  const n0 = g.log.length;
  g = act(g, { type: 'playCard', player: P0, obj: t });
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = pend(g).kind === 'optional' ? choose(g, 'yes') : act(g, legal(g, pend(g).player)[0]);
  assert.ok(!g.log.slice(n0).some(l => /Relentless Storm/.test(l.text)), 'no Relentless Storm trigger');
  g = resolveChain(g);
  assert.ok((mightOf(g, t) ?? 0) >= 5, 'Mighty only after his trigger resolves');
});

test('RJ#2984 Switcheroo whose enemy target is swapped to the other battlefield by a hidden Tideturner does nothing', () => {
  let g = S0();
  fundAll(g, P0);
  const x = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  const tt = put(g, P1, 'Tideturner', { facedown: BF_B });
  const m = put(g, P0, 'V(1)', 'base');
  g = move(g, P0, [m], BF_A);
  for (let i = 0; i < 4 && !(pend(g).kind === 'showdownAction' && pend(g).player === P0); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  const sw = hand(g, P0, 'Switcheroo');
  g = act(g, { type: 'playCard', player: P0, obj: sw });
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = pend(g).kind === 'chooseTargets' ? act(g, { type: 'choose', player: P0, optionIds: [m, x] }) : act(g, legal(g, pend(g).player)[0]);
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  assert.ok(canPlayNow(g, P1, tt));
  g = act(g, { type: 'playCard', player: P1, obj: tt });
  for (let i = 0; i < 6 && pend(g).inStep; i++) { const d = pend(g); g = d.kind === 'optional' ? choose(g, 'yes') : optionIds(g).includes(x) ? choose(g, x) : act(g, legal(g, d.player)[0]); }
  for (let i = 0; i < 6 && g.chain.length > 1; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(locOf(g, x), BF_B, 'swapped away');
  assert.equal(g.chain.length, 1, 'only Switcheroo left');
  g = pass(g); if (g.chain.length && pend(g).kind === 'chainResponse') g = pass(g);
  assert.equal(mightOf(g, m), 1, 'no swap of Mights');
  assert.equal(mightOf(g, x), 5);
});

test('RJ#2987 Singularity taken with Mystic Reversal ("up to two"): new choices may be zero units, so nothing is dealt', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0, 8); fundAll(g, P1, 9);
  const a = put(g, P0, 'V(3)', 'base'), b = put(g, P0, 'V(3)', 'base');
  [g] = cast(g, P1, 'Singularity', { targets: [[a, b]] });
  const sg = g.chain[0].source;
  if (pend(g).player === P1) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Mystic Reversal'), { targets: [[sg]] });
  let retargeted = 0;
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    if (d.kind === 'optional') { g = choose(g, 'yes'); continue; }
    if (d.kind === 'chooseTargets') { retargeted++; g = act(g, { type: 'choose', player: d.player, optionIds: [] }); continue; }
    g = act(g, legal(g, d.player)[0]);
  }
  assert.ok(retargeted >= 1, 'new choices were offered');
  assert.equal(zone(g, sg), 'trash');
  assert.equal(g.objects[a].damage ?? 0, 0);
  assert.equal(g.objects[b].damage ?? 0, 0);
});

test('RJ#2989 Crackshot Corsair killed by a hidden Hidden Blade in response to her attack trigger: the 1 damage is not dealt', () => {
  let g = S0();
  const d = put(g, P1, 'V(4)', BF_A); control(g, BF_A, P1);
  const hb = put(g, P1, 'Hidden Blade', { facedown: BF_A });
  const c = put(g, P0, 'Crackshot Corsair', 'base');
  const o = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [c, o], BF_A);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = optionIds(g).includes(d) ? choose(g, d) : act(g, legal(g, pend(g).player)[0]);
  assert.ok(g.chain.some(x => x.source === c), 'attack trigger on the chain');
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  g = play(g, P1, hb, { targets: [[c]] });
  for (let i = 0; i < 10 && g.chain.length; i++) { const dd = pend(g); g = dd.inStep ? act(g, legal(g, dd.player)[0]) : pass(g); }
  assert.equal(zone(g, c), 'trash');
  assert.equal(g.objects[d].damage ?? 0, 0, 'no damage: "here" can\'t be determined');
});

test('RJ#2992 One Weaponmaster instance attaches one Equipment, not several', () => {
  let g = S0();
  fundAll(g, P0, 8);
  const e1 = put(g, P0, "Doran's Blade", 'base'), e2 = put(g, P0, "Doran's Blade", 'base');
  const vp = hand(g, P0, 'Veteran Poro');
  g = play(g, P0, vp, { dest: 'base' });
  g = drive(g, x => { const d = pend(x); if (d.kind === 'optional') return ['yes']; const o = optionIds(x); if (o.includes(e1)) return [e1]; if (o.includes(e2)) return [e2]; return null; });
  const att = [e1, e2].filter(e => g.objects[e].attachedTo === vp).length;
  assert.equal(att, 1);
});

test('RJ#2997 Counter Strike on the defender prevents its combat damage: it survives and the surviving attacker is recalled', () => {
  let { g, atk, def } = attackSetup(['V(5)'], ['V(2)']);
  fundAll(g, P1);
  for (let i = 0; i < 4 && !(pend(g).kind === 'showdownAction' && pend(g).player === P1); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  g = play(g, P1, hand(g, P1, 'Counter Strike'), { targets: [[def[0]]] });
  g = drive(g);
  assert.equal(locOf(g, def[0]), BF_A, 'defender survives');
  assert.equal(zone(g, atk[0]), 'base', 'attacker recalled');
  assert.equal(g.battlefields[BF_A].controller, P1);
});

test('RJ#2998 Cleave played on a unit already attacking: Assault 3 applies at once', () => {
  let { g, atk } = attackSetup(['V(2)'], ['V(9)']);
  fundAll(g, P0);
  for (let i = 0; i < 4 && !(pend(g).kind === 'showdownAction' && pend(g).player === P0); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  g = play(g, P0, hand(g, P0, 'Cleave'), { targets: [[atk[0]]] });
  g = resolveChain(g);
  assert.equal(mightOf(g, atk[0]), 5);
});

test('RJ#3003 / RJ#3021 (AMBIGUOUS, house = RJ#3021) Facebreaker after one target moves away (Flash): the spell does nothing — both must still be at the same battlefield', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const mine = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(2)', BF_A);
  g = play(g, P0, hand(g, P0, 'Facebreaker'), { targets: [[mine], [e]] });
  if (pend(g).inStep && pend(g).kind === 'chooseTargets') g = act(g, { type: 'choose', player: P0, optionIds: [mine, e] });
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Flash'), { targets: [[e]] });
  g = drive(g);
  assert.equal(zone(g, e), 'base');
  assert.equal(!!g.objects[mine].stunned, false, 'friendly target no longer "at the same battlefield" as an enemy target: not stunned');
  assert.equal(!!g.objects[e].stunned, false);
});

test('RJ#3009 Rumble, Hotheaded can recycle a token unit for his conquer trigger', () => {
  let g = S0();
  withTokens(g);
  fundAll(g, P0, 10);
  const r = put(g, P0, 'sfd-026-221', 'base');
  const tok = put(g, P0, 'ven-t04', 'base');
  const mm = put(g, P0, 'Mega-Mech', 'trash');
  g = move(g, P0, [r], BF_A);
  let offered = false;
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    if (o.includes(tok)) offered = true;
    const pick = d.kind === 'optional' ? 'yes' : o.includes(tok) ? tok : o.includes(mm) ? mm : o.includes('base') ? 'base' : o[0];
    g = act(g, { type: 'choose', player: d.player, optionIds: [pick] });
  }
  void offered; // the token is the only candidate: auto-picked
  assert.ok(!g.objects[tok] || !['base', 'battlefield'].includes(g.objects[tok].zone), 'token recycled (ceases to exist)');
  assert.ok(['base', 'battlefield'].includes(zone(g, mm)), 'Mech played');
});

test('RJ#3012 A unit with "When I conquer" that dies during the showdown does not trigger when its side conquers afterwards', () => {
  let g = S0();
  withTokens(g);
  fundAll(g, P1);
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const poro = put(g, P0, 'Plundering Poro', 'base');
  const big = put(g, P0, 'V(5)', 'base');
  g = move(g, P0, [poro, big], BF_A);
  for (let i = 0; i < 4 && !(pend(g).kind === 'showdownAction' && pend(g).player === P1); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  g = play(g, P1, putF(g, P1, 'rjf-killr', 'hand'), { targets: [[poro]] });
  g = drive(g);
  assert.equal(zone(g, poro), 'trash');
  assert.equal(g.battlefields[BF_A].controller, P0, 'conquered');
  const gold = Object.values(g.objects).filter(o => o.controller === P0 && g.cards[o.cardId]?.name === 'Gold' && ['base', 'battlefield'].includes(o.zone)).length;
  assert.equal(gold, 0, 'no Gold token');
  let h = S0(); withTokens(h);
  put(h, P1, 'V(1)', BF_A); control(h, BF_A, P1);
  h = move(h, P0, [put(h, P0, 'Plundering Poro', 'base'), put(h, P0, 'V(5)', 'base')], BF_A);
  h = drive(h, x => (pend(x).kind === 'optional' ? ['yes'] : null));
  assert.equal(Object.values(h.objects).filter(o => o.controller === P0 && h.cards[o.cardId]?.name === 'Gold' && ['base', 'battlefield'].includes(o.zone)).length, 1, 'control: surviving Poro makes Gold');
});

test('RJ#3013 Karthus: the doubled Deathknell triggers go on the chain together; players may respond before each resolves', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P1);
  put(g, P0, 'Karthus, Eternal', 'base');
  const dk = put(g, P0, 'DK(2)', 'base');
  g = play(g, P1, putF(g, P1, 'rjf-killr', 'hand'), { targets: [[dk]] });
  for (let i = 0; i < 8 && !g.chain.some(c => c.source === dk); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = act(g, legal(g, pend(g).player)[0]);
  assert.equal(g.chain.filter(c => c.source === dk).length, 2, 'both on the chain at once');
  let windows = 0;
  for (let i = 0; i < 8 && g.chain.length; i++) { const d = pend(g); if (d.kind === 'chainResponse' && d.player === P1) windows++; g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g); }
  assert.ok(windows >= 2, 'the opponent gets priority before each of them resolves');
});

test('RJ#3016 The Boss saving a unit keeps its this-turn debuff (Smoke Screen): same object, not healed of Might changes', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  setLegend(g, P1, 'The Boss');
  const d = put(g, P1, 'V(5)', BF_A, { buff: true }); control(g, BF_A, P1);
  g = play(g, P0, hand(g, P0, 'Smoke Screen'), { targets: [[d]] });
  g = drive(g);
  assert.equal(mightOf(g, d), 2, '6 - 4');
  g = move(g, P0, [put(g, P0, 'V(3)', 'base')], BF_A);
  g = drive(g, h => (pend(h).kind === 'optional' ? ['yes'] : null));
  assert.equal(zone(g, d), 'base', 'saved and recalled');
  assert.equal(mightOf(g, d), 1, 'buff spent, Smoke Screen\'s -4 still applies this turn');
});

test('RJ#3023 Baited Hook killing a Sprite token (3) still plays a unit with Might up to 4 (looks back at the token)', () => {
  let g = S0();
  withTokens(g);
  fundAll(g, P0);
  const hook = put(g, P0, 'Baited Hook', 'base');
  const sp = put(g, P0, 'unl-t07', 'base');
  const [v4] = stackTop(g, P0, 'V(4)', 'V(1)', 'V(1)', 'V(1)', 'V(1)');
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === hook)!);
  g = drive(g, h => { const d = pend(h); if (d.options?.some(o => o.id === sp)) return [sp]; if (d.options?.some(o => o.id === v4)) return [v4]; return d.kind === 'optional' ? ['yes'] : null; });
  assert.ok(!g.objects[sp] || !['base', 'battlefield'].includes(g.objects[sp].zone), 'token killed');
  assert.equal(zone(g, v4), 'base', 'unit with Might 4 played');
});

test('RJ#3028 A standard move does not "choose" the unit: Blade Dancer (Irelia legend) does not trigger', () => {
  let g = S0();
  fundAll(g, P0);
  setLegend(g, P0, 'Blade Dancer');
  const u = put(g, P0, 'V(2)', 'base');
  const n0 = g.log.length;
  g = move(g, P0, [u], BF_A);
  assert.ok(!g.pending || g.pending.kind !== 'optional', 'no Blade Dancer prompt');
  g = drive(g);
  assert.ok(!g.log.slice(n0).some(l => /Blade Dancer/.test(l.text) && !/Ready me/.test(l.text)), 'no "choose" trigger (only its separate conquer clause)');
});

test('RJ#3036 Hidden Zhonya\'s flipped in response to Charm saves the unit when it then dies at the other battlefield (OGN-FAQ: saves a friendly unit dying anywhere)', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P1);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const z = put(g, P0, "Zhonya's Hourglass", { facedown: BF_A });
  put(g, P1, 'V(9)', BF_B); control(g, BF_B, P1);
  g = play(g, P1, hand(g, P1, 'Charm'), { targets: [[u]], locations: [BF_B], battlefields: [BF_B] });
  for (let i = 0; i < 4 && pend(g).player !== P0; i++) g = pend(g).inStep ? answer(g, { locations: [BF_B], battlefields: [BF_B] }) : pass(g);
  assert.ok(canPlayNow(g, P0, z), 'hidden Zhonya\'s playable in response');
  g = play(g, P0, z, {});
  g = drive(g, x => (optionIds(x).includes(String(BF_B)) ? [String(BF_B)] : null));
  assert.equal(zone(g, z), 'trash', 'Hourglass used');
  assert.equal(zone(g, u), 'base', 'unit dying at BF-B was saved and recalled');
});

test('RJ#3037 Moving an Assault unit into an empty battlefield is not an attack: no Assault bonus in that showdown', () => {
  let g = S0();
  const u = put(g, P0, 'Assault(2,2)', 'base');
  g = move(g, P0, [u], BF_A);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = act(g, legal(g, pend(g).player)[0]);
  assert.ok(g.showdown, 'showdown under way');
  assert.equal(mightOf(g, u), 2, 'no attacker designation: Assault inactive');
});

test('RJ#3041 Defender moved out by Reaver\'s Row and Ride the Wind-ed back in: it keeps the battlefield, but already controlling it is no conquer (no point)', () => {
  let g = S0({ bfA: "Reaver's Row" });
  fundAll(g, P1);
  const k = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [a], BF_A);
  let rode = false;
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.inStep) { g = d.kind === 'optional' ? choose(g, 'yes') : optionIds(g).includes(k) ? choose(g, k) : optionIds(g).includes(String(BF_A)) ? choose(g, String(BF_A)) : act(g, legal(g, d.player)[0]); continue; }
    if (!rode && d.kind === 'showdownAction' && d.player === P1 && zone(g, k) === 'base') { g = play(g, P1, hand(g, P1, 'Ride the Wind'), { targets: [[k]] }); rode = true; continue; }
    g = pass(g);
  }
  assert.ok(rode, 'Ride the Wind played during the combat');
  assert.equal(locOf(g, k), BF_A);
  assert.equal(g.battlefields[BF_A].controller, P1);
  assert.equal(g.players[P1].points, 0, 'no conquer: P1 controlled it all along (CR 468 task 3/4)');
});

test('RJ#3043 Flash in response to Traveling Merchant\'s move trigger (after an enemy Charm): the Merchant moves again and triggers a second time', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0); fundAll(g, P1);
  const tm = put(g, P0, 'Traveling Merchant', 'base');
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  g = play(g, P1, hand(g, P1, 'Charm'), { targets: [[tm]], locations: [BF_A], battlefields: [BF_A] });
  for (let i = 0; i < 6 && !(g.chain.some(c => c.source === tm) && pend(g).player === P0 && !pend(g).inStep); i++) g = pend(g).inStep ? (optionIds(g).includes(String(BF_A)) ? choose(g, String(BF_A)) : act(g, legal(g, pend(g).player)[0])) : pass(g);
  assert.equal(locOf(g, tm), BF_A);
  assert.ok(g.chain.some(c => c.source === tm), 'first move trigger on the chain');
  const n0 = g.log.length;
  g = play(g, P0, hand(g, P0, 'Flash'), { targets: [[tm]] });
  for (let i = 0; i < 20 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(zone(g, tm), 'base');
  const trig = g.log.slice(n0).filter(l => /Resolving Traveling Merchant/.test(l.text)).length;
  assert.equal(trig, 2, 'both move triggers resolve');
});

test('RJ#3044 Mystic Reversal on the Wind Wall countering my Flash: I control Wind Wall but the chain order is unchanged — Flash is still countered', () => {
  let g = S0();
  fundAll(g, P0, 10); fundAll(g, P1, 6);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const fl = hand(g, P0, 'Flash');
  g = play(g, P0, fl, { targets: [[u]] });
  const flItem = g.chain[0].id;
  if (pend(g).player === P0) g = pass(g);
  const ww = hand(g, P1, 'Wind Wall');
  g = play(g, P1, ww, { targets: [[flItem]] });
  if (pend(g).player === P1) g = pass(g);
  const wwItem = g.chain.find(c => c.source === ww)!.id;
  g = play(g, P0, hand(g, P0, 'Mystic Reversal'), { targets: [[wwItem]] });
  for (let i = 0; i < 30 && g.chain.length; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    g = d.kind === 'optional' ? choose(g, 'no') : optionIds(g).includes(flItem) ? choose(g, flItem) : act(g, legal(g, d.player)[0]);
  }
  assert.equal(locOf(g, u), BF_A, 'Flash countered: the unit did not move');
  assert.equal(zone(g, fl), 'trash');
});

test('RJ#3045 Reinforce reveals Nocturne (banished on look) and Blitzcrank: Nocturne is played before the combat Blitzcrank\'s pull starts, and fights in it', () => {
  let g = S0();
  fundAll(g, P0, 12);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(2)', BF_B); control(g, BF_B, P1);
  const [noc, bl] = stackTop(g, P0, 'Nocturne, Horrifying', 'Blitzcrank, Impassive', 'V(1)', 'V(1)', 'V(1)');
  [g] = cast(g, P0, 'Reinforce');
  let nocBeforeCombat = false;
  for (let i = 0; i < 40 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (g.showdown?.isCombat && !nocBeforeCombat) nocBeforeCombat = locOf(g, noc) === BF_A;
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    g = d.kind === 'optional' ? choose(g, 'yes') : o.includes(bl) ? choose(g, bl) : o.includes(noc) ? choose(g, noc) : o.includes(e) ? choose(g, e) : o.includes(String(BF_A)) ? choose(g, String(BF_A)) : act(g, legal(g, d.player)[0]);
  }
  assert.equal(locOf(g, bl), BF_A, 'Blitzcrank played to my battlefield');
  assert.equal(locOf(g, noc), BF_A, 'Nocturne played there');
  assert.ok(nocBeforeCombat, 'Nocturne was there when the combat began');
  assert.equal(zone(g, e), 'trash', 'pulled enemy killed');
});

test('RJ#3047 Yasuo, Windrider Portal-Rescued after two moves is a new object: his move count restarts (next move does not score)', () => {
  let g = S0();
  fundAll(g, P0, 14);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const y = put(g, P0, 'Yasuo, Windrider', BF_A);
  for (const dest of ['base', BF_A] as const) {
    g = play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[y]] });
    g = drive(g, x => (optionIds(x).includes(String(dest)) ? [String(dest)] : null));
  }
  assert.equal(g.players[P0].points, 0);
  g = play(g, P0, hand(g, P0, 'Portal Rescue'), { targets: [[y]] });
  g = drive(g);
  const y2 = zone(g, y) === 'base' ? y : g.players[P0].base.find(id => g.cards[g.objects[id].cardId]?.name === 'Yasuo')!;
  assert.ok(y2, 'Yasuo back in base');
  g = play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[y2]] });
  g = drive(g, x => (optionIds(x).includes(String(BF_A)) ? [String(BF_A)] : null));
  assert.equal(locOf(g, y2), BF_A);
  assert.equal(g.players[P0].points, 0, 'first move of the new object: no point');
});

test('RJ#3058 Thousand-Tailed Watcher on a 2-Might unit: snapshotted -1 (to 1); defending alone with Wuju Bladesman it is 3', () => {
  let g = S0();
  fundAll(g, P0, 10);
  const u = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  put(g, P1, 'Wuju Bladesman', 'base');
  [g] = cast(g, P0, 'Thousand-Tailed Watcher', { dest: 'base', may: [false] });
  g = settle(g);
  assert.equal(mightOf(g, u), 1, '-3 to a minimum of 1 on a 2-Might unit = -1');
  const a = put(g, P0, 'V(5)', 'base');
  g = move(g, P0, [a], BF_A);
  assert.ok(g.showdown?.isCombat, 'combat staged');
  assert.equal(mightOf(g, u), 3, 'defends alone: 2 - 1 + 2');
});

test('RJ#3059 Conquer one battlefield, then Ride the Wind the unit to the other open one: 2 points', () => {
  let g = S0();
  fundAll(g, P0);
  const v = put(g, P0, 'Vi, Destructive', 'base');
  g = move(g, P0, [v], BF_A); g = drive(g);
  assert.equal(g.players[P0].points, 1);
  [g] = cast(g, P0, 'Ride the Wind', { targets: [[v]], dest: BF_B, locations: [BF_B] });
  g = drive(g, h => (pend(h).kind === 'chooseDestination' ? [String(BF_B)] : null));
  assert.equal(locOf(g, v), BF_B);
  assert.equal(g.players[P0].points, 2, 'one point per battlefield conquered');
});

test('RJ#3070 Ezreal Dashing\'s defend trigger: hidden Switcheroo responds and the trigger uses his swapped Might; Switcheroo from hand (Action) cannot respond', () => {
  let g = S0();
  fundAll(g, P1, 6);
  const ez = put(g, P1, 'Ezreal, Dashing', BF_A); control(g, BF_A, P1);
  const sw = put(g, P1, 'Switcheroo', { facedown: BF_A });
  const a = put(g, P0, 'V(6)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 6 && !g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(g.chain.length, 'Ezreal\'s defend trigger on the chain');
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  assert.ok(canPlayNow(g, P1, sw), 'hidden card: Reaction timing');
  g = play(g, P1, sw, { targets: [[ez, a]] });
  g = settle(g);
  assert.equal(zone(g, a), 'trash', 'Ezreal (now 6) deals 6 to the attacker (now 3)');
  // from hand, attacking: Action can't be added to the chain
  let k = S0();
  fundAll(k, P0, 6);
  const ez2 = put(k, P0, 'Ezreal, Dashing', 'base');
  put(k, P1, 'V(6)', BF_A); control(k, BF_A, P1);
  const sw2 = hand(k, P0, 'Switcheroo');
  k = move(k, P0, [ez2], BF_A);
  for (let i = 0; i < 6 && !k.chain.length; i++) k = pend(k).inStep ? act(k, legal(k, pend(k).player)[0]) : pass(k);
  assert.ok(k.chain.length, 'attack trigger on the chain');
  for (let i = 0; i < 3 && pend(k).player !== P0; i++) k = pass(k);
  assert.equal(pend(k).player, P0);
  assert.equal(canPlayNow(k, P0, sw2), false, 'Switcheroo from hand is an Action: not in response');
});

test('RJ#3071 Kayn (moved twice: no damage) loses nothing but can\'t clear the defenders: recalled to base still exhausted', () => {
  let g = S0();
  const k = put(g, P0, 'Kayn, Unleashed', 'base');
  put(g, P1, 'V(8)', BF_B); control(g, BF_B, P1);
  g = settle(move(g, P0, [k], BF_A)); g = drive(g);
  g.objects[k].exhausted = false; g.timestamp++;
  g = move(g, P0, [k], BF_B);
  g = drive(g);
  assert.equal(zone(g, k), 'base');
  assert.equal(g.objects[k].damage, 0);
  assert.equal(g.objects[k].exhausted, true, 'recall keeps the exhausted state from the gank');
});

test('RJ#3072 Smoke Screen on Carnivorous Snapvine in response to its play trigger lowers the damage it deals', () => {
  let g = S0();
  fundAll(g, P0, 10); fundAll(g, P1, 4);
  const e = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const sv = hand(g, P0, 'Carnivorous Snapvine');
  g = play(g, P0, sv, { dest: 'base', targets: [[e]] });
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Smoke Screen'), { targets: [[sv]] });
  g = settle(g);
  assert.equal(zone(g, e), 'battlefield');
  assert.equal(g.objects[e].damage, 2, 'Snapvine at 2 Might deals 2');
  assert.equal(zone(g, sv), 'trash', 'the 5-Might enemy kills the shrunken Snapvine');
});

test('RJ#3073 Stormbringer\'s battlefield emptied in response: no damage, the chosen unit still moves there', () => {
  let g = S0(); fundAll(g, P0, 8); fundAll(g, P1, 4);
  const v = put(g, P0, 'V(5)', 'base');
  const k = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'Stormbringer, Volibear', { targets: [[g.battlefields[BF_A].objId]] });
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = choose(g, pend(g).options![0].id);
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  g = play(g, P1, putF(g, P1, 'rjf-killr', 'hand'), { targets: [[k]] });
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) { const d = pend(g); g = d.inStep ? choose(g, d.options![0].id) : pass(g); }
  assert.equal(zone(g, k), 'trash');
  assert.equal(locOf(g, v), BF_A, 'the friendly unit still moved');
});

test('RJ#3085 Smoke Screen on Yasuo, Remorseful in response to his attack trigger: the damage uses his Might on resolution (6 - 4 = 2)', () => {
  let g = S0();
  fundAll(g, P1, 4);
  const y = put(g, P0, 'Yasuo, Remorseful', 'base');
  const e = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [y], BF_A);
  for (let i = 0; i < 6 && !g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(g.chain.length, 'attack trigger on the chain');
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Smoke Screen'), { targets: [[y]] });
  for (let i = 0; i < 10 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(mightOf(g, y), 2);
  assert.equal(g.objects[e].damage, 2, 'trigger dealt 2 (Might read on resolution)');
});

test('RJ#3086 Power from a Seal can pay the [A] cost to hide a card', () => {
  let g = S0();
  setRunes(g, P0, 0);
  const seal = put(g, P0, 'Seal of Rage', 'base');
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const hb = hand(g, P0, 'Hidden Blade');
  const h = legal(g, P0, 'hide').find(a => a.type === 'hide' && a.obj === hb && (a as { battlefieldIndex?: number }).battlefieldIndex === BF_A);
  assert.ok(h, 'hide offered with only a Seal to pay');
  g = act(g, h!);
  for (let i = 0; i < 5 && pend(g).inStep; i++) g = act(g, legal(g, pend(g).player)[0]);
  assert.equal(zone(g, hb), 'facedown');
  assert.equal(g.objects[seal].exhausted, true, 'the Seal paid');
});

test('RJ#3091 Thousand-Tailed Watcher vs Trifarian War Camp: 6 → 3, 2 → 1; moved off the Camp afterwards a Recruit drops to 0; reduced first then moved on: +1', () => {
  let g = S0({ bfA: 'Trifarian War Camp' });
  fundAll(g, P0, 12);
  const r = put(g, P1, 'V(1)', BF_A), big = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const far = put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  assert.equal(mightOf(g, big), 6);
  [g] = cast(g, P0, 'Thousand-Tailed Watcher', { dest: 'base', may: [false] });
  g = drive(g, h => (pend(h).kind === 'optional' ? ['no'] : null));
  assert.equal(mightOf(g, big), 3);
  assert.equal(mightOf(g, r), 1);
  g = play(g, P0, hand(g, P0, 'Fight or Flight'), { targets: [[r]] });
  g = drive(g);
  assert.equal(zone(g, r), 'base');
  assert.equal(mightOf(g, r), 0, 'snapshotted -1 stays; War Camp +1 gone');
  g = play(g, P0, hand(g, P0, 'Charm'), { targets: [[far]] });
  g = drive(g, h => (optionIds(h).includes(String(BF_A)) ? [String(BF_A)] : null));
  assert.equal(locOf(g, far), BF_A);
  assert.equal(mightOf(g, far), 2, 'reduced to 1 first, then +1 at the Camp');
});

test('RJ#3092 (MISMATCH-RJ) unbuffed Cithria of Cloudfield + Wildclaw Shaman: the buff spend is paid when Wildclaw\'s trigger is finalized, before Cithria\'s buff resolves — Wildclaw gets nothing', () => {
  let g = S0(); fundAll(g, P0);
  const c = put(g, P0, 'Cithria of Cloudfield', 'base');
  const w = hand(g, P0, 'Wildclaw Shaman');
  g = act(g, { type: 'playCard', player: P0, obj: w, destination: 'base' });
  for (let i = 0; i < 30; i++) {
    const d = g.pending; if (!d || d.kind === 'mainAction') break;
    if (d.inStep) {
      if (d.kind === 'orderTriggers') { const o = d.options!.find(x => /Cithria/.test(x.label ?? '')) ?? d.options![0]; g = choose(g, o.id); continue; }
      if (d.kind === 'optional') { g = choose(g, 'yes'); continue; }
      if (optionIds(g).includes(c)) { g = choose(g, c); continue; }
      g = act(g, legal(g, d.player)[0]); continue;
    }
    g = pass(g);
  }
  assert.equal(g.objects[c].counters.buff ?? 0, 1, 'Cithria buffed by her trigger');
  assert.equal(g.objects[w].counters.buff ?? 0, 0, 'Wildclaw not buffed (no buff to spend at finalization)');
  assert.equal(g.objects[w].exhausted, true, 'Wildclaw not readied');
});

test('RJ#3095 Draven, Vanquisher\'s "When I attack or defend, you may pay [C]: +2" fires once per attack: +2 once', () => {
  let g = S0();
  fundAll(g, P0, 10);
  const d = put(g, P0, 'Draven, Vanquisher', 'base');
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [d], BF_A);
  let offers = 0;
  for (let i = 0; i < 30 && g.showdown?.isCombat && !g.pending?.kind.startsWith('assign'); i++) {
    const p = pend(g);
    if (p.kind === 'optional') { offers++; g = choose(g, 'yes'); continue; }
    if (p.inStep) { g = act(g, legal(g, p.player)[0]); continue; }
    if (!g.chain.length) break;
    g = pass(g);
  }
  assert.equal(offers, 1, 'one trigger, one payment');
  assert.equal(mightOf(g, d), 6, '4 + 2');
});

test('RJ#3103 Rumble, Hotheaded recycling a unit at Trifarian War Camp reduces the Mech by its current Might (incl. the Camp\'s +1)', () => {
  let g = S0({ bfB: 'Trifarian War Camp' });
  const r = put(g, P0, 'Rumble, Hotheaded', 'base');
  const u = put(g, P0, 'V(2)', BF_B); control(g, BF_B, P0);
  const mm = put(g, P0, 'Mega-Mech', 'trash');
  for (const x of g.players[P0].runesInPlay) g.objects[x].exhausted = true;
  g.players[P0].pool.energy = 4; g.timestamp++;
  assert.equal(mightOf(g, u), 3);
  g = move(g, P0, [r], BF_A);
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    const pick = d.kind === 'optional' ? 'yes' : o.includes(u) ? u : o.includes(mm) ? mm : o.includes('base') ? 'base' : o[0];
    g = act(g, { type: 'choose', player: d.player, optionIds: [pick] });
  }
  assert.ok(['base', 'battlefield'].includes(zone(g, mm)), `Mega-Mech (7) played for 7 - 3 = 4 (${zone(g, mm)})`);
});

test('RJ#3104 Yone, Blademaster attacks Reaver\'s Row; the lone defender moves itself to base: Yone conquers, but the battlefield was controlled (no damage)', () => {
  let g = S0({ bfA: "Reaver's Row" });
  const y = put(g, P0, 'Yone, Blademaster', 'base');
  const d = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const b = put(g, P1, 'V(9)', 'base');
  g = move(g, P0, [y], BF_A);
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const p = pend(g);
    if (!p.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    g = choose(g, p.kind === 'optional' ? 'yes' : o.includes(d) ? d : o.includes(b) ? b : o[0]);
  }
  assert.equal(zone(g, d), 'base', 'defender moved to base by Reaver\'s Row');
  assert.equal(g.battlefields[BF_A].controller, P0, 'Yone conquered');
  assert.equal(g.objects[b].damage ?? 0, 0, 'not "a battlefield that was uncontrolled": no trigger');
});

test('RJ#3108 Nine-Tailed Fox (Ahri legend) and a defending Ahri, Inquisitive trigger together: the defender orders them', () => {
  let g = S0();
  setLegend(g, P1, 'Nine-Tailed Fox');
  put(g, P1, 'Ahri, Inquisitive', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(9)', 'base');
  g = move(g, P0, [a], BF_A);
  let ordered = false;
  for (let i = 0; i < 20 && g.showdown?.isCombat && pend(g).kind !== 'assignDamage'; i++) {
    const d = pend(g);
    if (d.kind === 'orderTriggers') { ordered = d.player === P1 && d.options!.length === 2; }
    if (d.inStep) { g = act(g, legal(g, d.player)[0]); continue; }
    if (!g.chain.length) break;
    g = pass(g);
  }
  assert.ok(ordered, 'P1 orders the two simultaneous triggers');
  assert.equal(mightOf(g, a), 6, '-1 and -2');
});

test('RJ#3112 Charm can\'t move an enemy unit to my base: "base" is its own base', () => {
  let g = S0();
  fundAll(g, P0);
  const e = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  g = play(g, P0, hand(g, P0, 'Charm'), { targets: [[e]] });
  let opts: string[] = [];
  g = drive(g, h => { const o = optionIds(h); if (o.includes('base')) { opts = o; return ['base']; } return null; });
  assert.ok(opts.every(o => o === 'base' || /^\d+$/.test(o)), `destinations: ${opts}`);
  assert.equal(zone(g, e), 'base');
  assert.ok(g.players[P1].base.includes(e), 'in its own (P1) base');
  assert.ok(!g.players[P0].base.includes(e));
});

test('RJ#3118 Gust: the mover into an open battlefield can be Gusted in the showdown before it conquers; moving to my own held battlefield gives no window; a Gusted token ceases to exist', () => {
  let g = S0();
  fundAll(g, P1);
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_A);
  assert.ok(g.showdown, 'showdown at the open battlefield');
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  assert.equal(pend(g).player, P1);
  g = play(g, P1, hand(g, P1, 'Gust'), { targets: [[u]] });
  g = drive(g);
  assert.equal(zone(g, u), 'hand');
  assert.notEqual(g.battlefields[BF_A].controller, P0, 'no conquer');
  // own battlefield: no showdown, straight back to my main phase
  let k = S0();
  put(k, P0, 'V(1)', BF_A); control(k, BF_A, P0);
  const w = put(k, P0, 'V(2)', 'base');
  k = move(k, P0, [w], BF_A);
  assert.ok(!k.showdown && !k.chain.length);
  assert.equal(pend(k).kind, 'mainAction');
  assert.equal(pend(k).player, P0);
  // token
  let t = S0();
  withTokens(t); fundAll(t, P1);
  const tok = put(t, P0, 'ven-t04', BF_A); control(t, BF_A, P0);
  t = nextTurn(t);
  t = play(t, P1, hand(t, P1, 'Gust'), { targets: [[tok]] });
  t = drive(t);
  assert.ok(!t.objects[tok] || !['hand', 'base', 'battlefield'].includes(zone(t, tok)), `token gone (${zone(t, tok)})`);
  assert.ok(!t.players[P0].hand.includes(tok));
});

test('RJ#3121 a card drawn by my Discipline mid-chain (Wind Wall) can be played on the opponent\'s Discipline still on the chain', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const a = put(g, P0, 'V(2)', 'base'), b = put(g, P1, 'V(2)', 'base');
  const [ww] = stackTop(g, P1, 'Wind Wall');
  g = play(g, P0, hand(g, P0, 'Discipline'), { targets: [[a]] });
  const theirs = g.chain[0].id;
  if (pend(g).player === P0) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Discipline'), { targets: [[b]] });
  for (let i = 0; i < 4 && g.chain.length === 2; i++) g = pass(g);
  assert.equal(g.chain.length, 1, 'my Discipline resolved');
  assert.ok(g.players[P1].hand.includes(ww), 'drew Wind Wall');
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  assert.ok(canPlayNow(g, P1, ww));
  g = play(g, P1, ww, { targets: [[theirs]] });
  g = settle(g);
  assert.equal(mightOf(g, a), 2, 'their Discipline countered');
  assert.equal(mightOf(g, b), 4);
});

test('RJ#3123 a combat "tie" includes both sides still having units (OGN-FAQ: neither OR both have units left): Symbol of the Solari recalls the surviving defender too', () => {
  let { g, atk, def } = attackSetup(['V(3)'], ['V(4)'], { defOpts: [{ stunned: true }] });
  put(g, P0, 'Symbol of the Solari', 'base');
  g = settle(g);
  g = drive(g);
  assert.equal(zone(g, atk[0]), 'base', 'attacker recalled');
  assert.equal(zone(g, def[0]), 'base', 'tie with both sides left: all units recalled');
});

test('RJ#3125 buffed Fiora, Victorious (5, Mighty) defending vs Ahri, Inquisitive\'s -2: the Deflect tax is owed when targeted; she ends at 3, not Mighty, no Shield or Deflect', () => {
  let g = S0();
  fundAll(g, P0, 8);
  const f = put(g, P1, 'Fiora, Victorious', BF_A, { buff: true }); control(g, BF_A, P1);
  const ah = put(g, P0, 'Ahri, Inquisitive', 'base');
  assert.ok(hasKeyword(g, f, 'Deflect'), 'Mighty: Deflect');
  g = move(g, P0, [ah], BF_A);
  let deflectAsked = false;
  for (let i = 0; i < 20 && g.showdown?.isCombat && pend(g).kind !== 'assignDamage'; i++) {
    const d = pend(g);
    if (d.inStep) {
      if (/Deflect/.test(d.prompt ?? '')) deflectAsked = true;
      g = d.kind === 'optional' ? choose(g, 'yes') : optionIds(g).includes(f) ? choose(g, f) : act(g, legal(g, d.player)[0]);
      continue;
    }
    if (!g.chain.length) break;
    g = pass(g);
  }
  assert.ok(deflectAsked, 'Deflect tax for choosing Mighty Fiora');
  assert.equal(mightOf(g, f), 3, '4 + 1 buff - 2; her own Shield never keeps her Mighty (CR 478.4)');
  assert.equal(hasKeyword(g, f, 'Shield'), false);
  assert.equal(hasKeyword(g, f, 'Deflect'), false);
});

test('RJ#3127 Sett, Kingpin (6 with a buffed ally) takes 5 combat damage; the ally dies: the combat cleanup heals Sett before his Might drops — he survives', () => {
  let { g, atk, def } = attackSetup(['V(9)'], ['Sett, Kingpin', 'Tank(3)'], { defOpts: [{}, { buff: true }] });
  const [sett, ally] = def;
  assert.equal(mightOf(g, sett), 6);
  for (let i = 0; i < 20 && pend(g).kind !== 'assignDamage'; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  const d = pend(g);
  assert.equal(d.player, P0);
  g = act(g, { type: 'assignDamage', player: P0, assignment: { [ally]: 4, [sett]: 5 } });
  g = settle(g); g = drive(g);
  assert.equal(zone(g, ally), 'trash');
  assert.equal(zone(g, sett), 'battlefield', 'healed in the same combat cleanup');
  assert.equal(g.objects[sett].damage ?? 0, 0);
  assert.equal(zone(g, atk[0]), 'trash', 'the 9-Might attacker took 10');
});

test('RJ#3130 playing a second copy of a card (Traveling Merchant, a champion unit) replaces nothing: both stay in play', () => {
  let g = S0();
  fundAll(g, P0, 12);
  const a = put(g, P0, 'Traveling Merchant', 'base');
  const b = hand(g, P0, 'Traveling Merchant');
  g = play(g, P0, b, { dest: 'base' }); g = drive(g);
  assert.equal(zone(g, a), 'base'); assert.equal(zone(g, b), 'base');
  const j1 = put(g, P0, 'Jinx, Rebel', 'base');
  const j2 = hand(g, P0, 'Jinx, Rebel');
  g = play(g, P0, j2, { dest: 'base' }); g = drive(g);
  assert.equal(zone(g, j1), 'base'); assert.equal(zone(g, j2), 'base');
});

test('RJ#3132 Bullet Time can always be Defied: its printed cost ([1], no power) is checked; the [A] amount is paid only on resolution', () => {
  let g = S0();
  fundAll(g, P0, 8); fundAll(g, P1);
  const e = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const bt = hand(g, P0, 'Bullet Time');
  g = play(g, P0, bt, { targets: [[g.battlefields[BF_A].objId]] });
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = act(g, legal(g, pend(g).player)[0]);
  if (pend(g).player === P0) g = pass(g);
  const df = hand(g, P1, 'Defy');
  assert.ok(canPlayNow(g, P1, df));
  g = play(g, P1, df, { targets: [[g.chain.find(c => c.source === bt)!.id]] });
  g = settle(g);
  assert.equal(zone(g, bt), 'trash');
  assert.equal(g.objects[e].damage ?? 0, 0, 'countered');
});

test('RJ#3139 Get Excited! on the chain, Gust my Flame Chompers back to hand in response: Get Excited discards it on resolution (3 damage) and Chompers can be played again', () => {
  let g = S0();
  fundAll(g, P0, 12);
  const fc = put(g, P0, 'Flame Chompers', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(5)', BF_B); control(g, BF_B, P1);
  for (const id of g.players[P0].hand) delete g.objects[id];
  g.players[P0].hand = []; g.timestamp++;
  g = play(g, P0, hand(g, P0, 'Get Excited!'), { targets: [[e]] });
  if (pend(g).player !== P0) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Gust'), { targets: [[fc]] });
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    g = choose(g, d.kind === 'optional' ? 'yes' : o.includes(fc) ? fc : o.includes('base') ? 'base' : o[0]);
  }
  assert.equal(g.objects[e].damage, 3, 'discarded Chompers\' Energy cost (3) dealt');
  assert.ok(['base', 'battlefield'].includes(zone(g, fc)), `Chompers played again (${zone(g, fc)})`);
});

test('RJ#3141 Baited Hook (errata: banish, then play) finds Cruel Patron with no friendly unit left to kill: it can\'t be played and doesn\'t return to the deck top or hand', () => {
  let g = S0(); fundAll(g, P0);
  const v = put(g, P0, 'V(5)', 'base');
  const hook = put(g, P0, 'Baited Hook', 'base');
  const [cp] = stackTop(g, P0, 'Cruel Patron', 'V(9)', 'V(9)', 'V(9)', 'V(9)');
  g = act(g, { type: 'activate', player: P0, obj: hook, abilityIndex: 0 });
  g = drive(g, h => {
    const o = optionIds(h);
    if (o.includes(v)) return [v];
    if (o.includes(cp)) return [cp];
    if (pend(h).kind === 'optional') return ['yes'];
    return null;
  });
  assert.equal(zone(g, v), 'trash');
  assert.ok(!['base', 'battlefield', 'hand'].includes(zone(g, cp)), `Patron not played (${zone(g, cp)})`);
  assert.notEqual(g.players[P0].mainDeck?.[0] ?? null, cp, 'not back on top of the deck');
});

test('RJ#3144 Ride the Wind: unit and destination are declared as it is played; then I get priority, then the opponent', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P0, 'V(2)', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Ride the Wind') });
  const kinds: string[] = [];
  for (let i = 0; i < 6 && pend(g).inStep; i++) {
    const d = pend(g); kinds.push(d.kind);
    g = d.kind === 'chooseTargets' ? choose(g, u) : optionIds(g).includes(String(BF_B)) ? choose(g, String(BF_B)) : act(g, legal(g, d.player)[0]);
  }
  assert.ok(kinds.some(k => k === 'chooseDestination' || k === 'chooseBattlefield'), `destination chosen on play (${kinds.join(',')})`);
  expectPending(g, 'chainResponse', P0);
  g = pass(g);
  expectPending(g, 'chainResponse', P1);
  g = pass(g);
  assert.equal(locOf(g, u), BF_B);
});

test('RJ#3156 Blind Fury in a showdown plays the opponent\'s Time Warp: the showdown finishes normally; the extra turn comes after this turn', () => {
  let g = S0();
  fundAll(g, P0, 12);
  const u = put(g, P0, 'V(2)', 'base');
  const [tw] = stackTop(g, P1, 'Time Warp');
  g = move(g, P0, [u], BF_A);
  assert.ok(g.showdown);
  g = play(g, P0, hand(g, P0, 'Blind Fury'));
  g = drive(g, h => (optionIds(h).includes(tw) ? [tw] : pend(h).kind === 'optional' ? ['yes'] : null));
  assert.equal(zone(g, tw), 'banishment', 'Time Warp played (then banished)');
  assert.equal(g.activePlayer, P0);
  assert.equal(g.battlefields[BF_A].controller, P0, 'showdown finished and conquered this turn');
  g = nextTurn(g);
  assert.equal(g.activePlayer, P0, 'extra turn');
  g = nextTurn(g);
  assert.equal(g.activePlayer, P1);
});

test('RJ#3158 Ravenbloom Student\'s +1 per spell stacks: three spells in a turn, +3', () => {
  let g = S0();
  fundAll(g, P0, 12);
  const s = put(g, P0, 'Ravenbloom Student', 'base');
  const m0 = mightOf(g, s)!;
  const e = put(g, P1, 'V(9)', 'base');
  for (let i = 0; i < 3; i++) { [g] = cast(g, P0, 'ZapM', { targets: [[e]] }); g = settle(g); g = drive(g); }
  assert.equal(mightOf(g, s), m0 + 3);
});

test('RJ#3166 "this turn" effects (Discipline) are still active while Dazzling Aurora\'s end-of-turn trigger resolves', () => {
  let g = S0();
  fundAll(g, P0);
  put(g, P0, 'Dazzling Aurora', 'base');
  const u = put(g, P0, 'V(2)', 'base');
  stackTop(g, P0, 'V(1)');
  g = play(g, P0, hand(g, P0, 'Discipline'), { targets: [[u]] }); g = settle(g);
  assert.equal(mightOf(g, u), 4);
  g = endTurn(g, P0);
  let seen: number | null = null;
  for (let i = 0; i < 20 && g.activePlayer === P0; i++) {
    if (g.chain.length && seen === null) seen = mightOf(g, u);
    const d = pend(g);
    g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  assert.equal(seen, 4, 'Aurora trigger on the chain while the +2 is still there');
  assert.equal(mightOf(g, u), 2, 'expired afterwards');
});

test('RJ#3176 Flame Chompers played by its discard trigger costs only the [C] power, not its 3 Energy', () => {
  let g = S0();
  for (const x of g.players[P0].runesInPlay) g.objects[x].exhausted = true;
  g.players[P0].pool = { energy: 2, power: { Fury: 1 } }; g.timestamp++;
  const fc = put(g, P0, 'Flame Chompers', 'hand');
  const e = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  for (const id of g.players[P0].hand.filter(x => x !== fc)) delete g.objects[id];
  g.players[P0].hand = [fc]; g.timestamp++;
  g = play(g, P0, put(g, P0, 'Get Excited!', 'hand'), { targets: [[e]] });
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    g = choose(g, d.kind === 'optional' ? 'yes' : o.includes(fc) ? fc : o.includes('base') ? 'base' : o[0]);
  }
  assert.equal(g.objects[e].damage, 3);
  assert.equal(zone(g, fc), 'base', 'played with 0 Energy left, paying only [C]');
});

test('RJ#3179 Overt Operation spending no buffs still buffs all friendly units', () => {
  let g = S0();
  fundAll(g, P0, 10);
  const a = put(g, P0, 'V(2)', 'base'), b = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  g = play(g, P0, hand(g, P0, 'Overt Operation'));
  g = drive(g, h => (pend(h).kind === 'optional' ? ['no'] : pend(h).kind === 'chooseTargets' || pend(h).kind === 'chooseCards' ? [] : null));
  assert.equal(g.objects[a].counters.buff ?? 0, 1);
  assert.equal(g.objects[b].counters.buff ?? 0, 1);
});

test('RJ#3183 Falling Star choosing the same Deflect unit (Pouty Poro) twice pays Deflect twice: [2][2] + [A][A]', () => {
  let g = S0(); fundAll(g, P0);
  const poro = put(g, P1, 'Pouty Poro', BF_A); control(g, BF_A, P1);
  const n0 = g.players[P0].runesInPlay.length;
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Falling Star') });
  g = answer(g, { targets: [[poro], [poro]] }, P0);
  for (let i = 0; i < 6 && pend(g).inStep; i++) g = act(g, legal(g, pend(g).player)[0]);
  assert.equal(pend(g).kind, 'chainResponse');
  assert.equal(n0 - g.players[P0].runesInPlay.length, 4, 'recycled 2 for the spell\'s power + 1 per Deflect choice');
  g = settle(g);
  assert.equal(zone(g, poro), 'trash');
});

test('RJ#3195 Hidden Blade\'s kill replaced by The Boss (recall): the unit\'s controller still draws 2', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  setLegend(g, P1, 'The Boss');
  const u = put(g, P1, 'V(3)', BF_A, { buff: true }); control(g, BF_A, P1);
  const h1 = handN(g, P1);
  g = play(g, P0, hand(g, P0, 'Hidden Blade'), { targets: [[u]] });
  g = drive(g, h => (pend(h).kind === 'optional' ? ['yes'] : null));
  assert.equal(zone(g, u), 'base', 'saved: recalled');
  assert.equal(handN(g, P1), h1 + 2, 'its controller drew 2');
});

test('RJ#3205 The Dreaming Tree\'s draw (triggered by choosing my unit there with Challenge) still resolves when the Challenge is Defied', () => {
  let g = S0({ bfA: 'The Dreaming Tree' });
  fundAll(g, P0); fundAll(g, P1);
  const f = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(2)', BF_B); control(g, BF_B, P1);
  const ch = hand(g, P0, 'Challenge');
  const h0 = handN(g, P0);
  g = play(g, P0, ch, { targets: [[f], [e]] });
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = act(g, legal(g, pend(g).player)[0]);
  assert.ok(g.chain.length >= 2, `Challenge + Dreaming Tree trigger on the chain (${g.chain.length})`);
  for (let i = 0; i < 4 && pend(g).player !== P1; i++) g = pass(g);
  const chItem = g.chain.find(c => c.source === ch);
  assert.ok(chItem, 'Challenge still on the chain');
  g = play(g, P1, hand(g, P1, 'Defy'), { targets: [[chItem!.id]] });
  g = settle(g);
  assert.equal(zone(g, ch), 'trash');
  assert.equal(g.objects[e].damage ?? 0, 0, 'Challenge countered');
  assert.equal(handN(g, P0), h0 - 1 + 1, 'Challenge left the hand; Dreaming Tree still drew 1');
});

// ---- cycle 2026-11-26 (resume 3206) ------------------------------------------------------------
test('RJ#3206 the Chosen Champion, played from the Champion Zone and killed, goes to the trash (not back to the Champion Zone)', () => {
  let g = S0(); fundAll(g, P0, 8);
  const ch = g.players[P0].championZone[0];
  assert.ok(ch, 'a chosen champion in the Champion Zone');
  g = drive(play(g, P0, ch, { dest: 'base' }));
  assert.equal(zone(g, ch), 'base');
  g = settle(play(g, P0, putF(g, P0, 'rjf-killr', 'hand'), { targets: [[ch]] }));
  assert.equal(zone(g, ch), 'trash');
  assert.equal(g.players[P0].championZone.length, 0);
});

test('RJ#3208 a spell that chooses a target needs a legal target to be played; a spell that chooses nothing does not', () => {
  const g = S0(); fundAll(g, P0);
  const k = putF(g, P0, 'rjf-killr', 'hand');
  for (const id of [...g.players[P0].base]) delete g.objects[id];
  g.players[P0].base = []; g.timestamp++;
  assert.equal(canPlayNow(g, P0, k), false, 'no unit anywhere: Kill a unit can\'t be played');
  assert.equal(canPlayNow(g, P0, hand(g, P0, 'Salvage')), true, '"up to one gear" needs no target');
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  assert.equal(canPlayNow(g, P0, k), true);
});

test('RJ#3211 Baited Hook kills a unit and plays Spectral Matron: Matron (entering after Hook finishes) can play the killed unit from the trash', () => {
  let g = S0(); fundAll(g, P0);
  const v = put(g, P0, 'V(3)', 'base');
  const hook = put(g, P0, 'Baited Hook', 'base');
  const [sm] = stackTop(g, P0, 'Spectral Matron');
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === hook)!);
  g = answer(g, { targets: [[v]] }, P0);
  g = drive(g, h => {
    const o = optionIds(h);
    if (o.includes(sm)) return [sm];
    if (o.includes(v)) return [v];
    if (pend(h).kind === 'optional') return ['yes'];
    return null;
  });
  assert.ok(['base', 'battlefield'].includes(zone(g, sm)), 'Matron played');
  assert.equal(zone(g, v), 'base', 'the unit killed by Hook was played back by Matron');
});

test('RJ#3217 (MISMATCH-RJ) a spell played by Kai\'Sa, Evolutionary\'s conquer trigger goes on the chain and the opponent may respond to it (CR 337.4)', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  g.players[P0].points = 3;
  const sp = putF(g, P0, 'rjf-killr', 'trash');
  const e = put(g, P1, 'V(2)', BF_B); control(g, BF_B, P1);
  const k = put(g, P0, "Kai'Sa, Evolutionary", 'base');
  let p1Window = false;
  g = move(g, P0, [k], BF_A);
  for (let i = 0; i < 40 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep && d.player === P1 && g.chain.some(c => c.source === sp)) p1Window = true;
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    g = choose(g, d.kind === 'optional' ? 'yes' : o.includes(sp) ? sp : o.includes(e) ? e : o[0]);
  }
  assert.equal(zone(g, e), 'trash', 'the trash spell resolved');
  assert.ok(p1Window, 'the opponent had priority while the played spell was on the chain');
});

test('RJ#3219 Viktor, Innovator Retreated on the opponent\'s turn: no Recruit (he is not on the board when Retreat\'s play completes); Stupefy played instead: Recruit', () => {
  const run = (spell: 'Retreat' | 'Stupefy') => {
    let g = S0({ tp: P1 }); fundAll(g, P0);
    const vk = put(g, P0, 'Viktor, Innovator', 'base');
    const e = put(g, P1, 'V(4)', 'base');
    g.pending = { kind: 'mainAction', player: P1, prompt: '', inStep: false }; g.timestamp++;
    g = settle(play(g, P1, putF(g, P1, 'rjf-killr', 'hand'), { targets: [[e]] }), 0);
    for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
    g = play(g, P0, hand(g, P0, spell), { targets: [[vk]] });
    g = drive(g);
    return g.players[P0].base.filter(id => g.cards[g.objects[id].cardId].name === 'Recruit').length;
  };
  assert.equal(run('Retreat'), 0);
  assert.equal(run('Stupefy'), 1);
});

test('RJ#3222 Vex, Cheerless in combat + Irelia, Graceful: the player orders the discounts, so Discipline on Irelia costs 0 (Vex to its minimum [1], then Irelia -[1])', () => {
  let g = S0(); fundAll(g, P0);
  const vx = put(g, P0, 'Vex, Cheerless', 'base'), ir = put(g, P0, 'Irelia, Graceful', 'base');
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const d = hand(g, P0, 'Discipline');
  g = move(g, P0, [vx, ir], BF_A);
  for (let i = 0; i < 8 && !canPlayNow(g, P0, d); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  const r0 = readyRunes(g, P0);
  g = play(g, P0, d, { targets: [[ir]] });
  assert.ok(g.chain.some(c => c.source === d), 'Discipline on the chain');
  assert.equal(r0 - readyRunes(g, P0), 0, 'paid nothing');
});

test('RJ#3226 Salvage chooses its gear as it is played: choosing my gear lets me Not So Fast it', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const gear = put(g, P1, 'Baited Hook', 'base');
  const nsf = hand(g, P1, 'Not So Fast');
  const sv = hand(g, P0, 'Salvage');
  g = act(g, { type: 'playCard', player: P0, obj: sv });
  for (let i = 0; i < 6 && pend(g).inStep; i++) { const o = optionIds(g); g = choose(g, pend(g).kind === 'optional' ? 'yes' : o.includes(gear) ? gear : o[0]); }
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  const item = g.chain.find(c => c.source === sv)!;
  assert.ok(item, 'Salvage on the chain');
  g = play(g, P1, nsf, { targets: [[item.id]] });
  g = settle(g);
  assert.equal(zone(g, sv), 'trash');
  assert.equal(zone(g, gear), 'base', 'countered: the gear survives');
});

test('RJ#3232 recycling from the trash: the player chooses which cards (the trash is unordered)', () => {
  let g = S0();
  const gg = put(g, P0, 'Garbage Grabber', 'base');
  const t = [put(g, P0, 'V(1)', 'trash'), put(g, P0, 'V(2)', 'trash'), put(g, P0, 'V(3)', 'trash'), put(g, P0, 'V(4)', 'trash')];
  g = act(g, { type: 'activate', player: P0, obj: gg, abilityIndex: 0 });
  g = answer(g, { cards: [[t[1], t[2], t[3]]] }, P0);
  g = settle(g);
  assert.deepEqual(g.players[P0].trash, [t[0]], 'the unchosen (oldest) card stays');
});

test('RJ#3236 Captain Farron\'s Assault applies only to friendly units at his location; a unit that moves away loses it', () => {
  let g = S0();
  put(g, P0, 'Captain Farron', BF_A); control(g, BF_A, P0);
  const u = put(g, P0, 'V(2)', BF_A);
  assert.ok(hasKeyword(g, u, 'Assault'));
  g = move(g, P0, [u], 'base');
  g = settle(g);
  assert.equal(locOf(g, u), 'base');
  assert.ok(!hasKeyword(g, u, 'Assault'), 'passive: gone once he is elsewhere');
});

test('RJ#3243 Monastery of Hirana: combat damage is healed before the conquer, so spending the 6-Might unit\'s buff (now 5 Might, 5 damage taken) does not kill it', () => {
  let { g, atk } = attackSetup(['V(5)'], ['V(5)'], { atkOpts: [{ buff: true }] });
  setBattlefieldCard(g, BF_A, 'Monastery of Hirana');
  const h0 = handN(g, P0);
  g = drive(g, h => (pend(h).kind === 'optional' ? ['yes'] : optionIds(h).includes(atk[0]) ? [atk[0]] : null));
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.objects[atk[0]].counters.buff ?? 0, 0, 'buff spent');
  assert.equal(locOf(g, atk[0]), BF_A, 'survives at 5 Might, healed');
  assert.equal(handN(g, P0), h0 + 1);
});

test('RJ#3247 Teemo, Strategist (errata: "choose an enemy unit here") defending vs Deadbloom Predator: one choice, Deflect paid once however many Hidden cards hit', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0); fundAll(g, P1, 8);
  put(g, P0, 'Teemo, Strategist', BF_A); control(g, BF_A, P0);
  stackTop(g, P0, 'HidZap', 'HidZap', 'HidZap', 'V(1)', 'V(1)');
  const dp = put(g, P1, 'Deadbloom Predator', 'base');
  const n0 = g.players[P0].runesInPlay.length;
  g = move(g, P1, [dp], BF_A);
  let deflectAsks = 0;
  g = drive(g, h => { const d = pend(h); if (d.kind === 'optional') { if (/Deflect/.test(d.prompt)) deflectAsks++; return ['yes']; } return null; });
  assert.equal(deflectAsks, 1, 'one Deflect payment for the one choice');
  assert.equal(n0 - g.players[P0].runesInPlay.length, 1, 'one rune recycled');
});

test('RJ#3249 Sett, Brawler\'s +4 needs his own "Spend my buff" ability: Call to Glory spending his buff gives only its own +3', () => {
  let g = S0(); fundAll(g, P0);
  const s = put(g, P0, 'Sett, Brawler', 'base', { buff: true });
  const m0 = mightOf(g, s)!;
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Call to Glory') });
  for (let i = 0; i < 8 && pend(g).inStep; i++) { const o = optionIds(g); g = choose(g, pend(g).kind === 'optional' ? 'yes' : o.includes(s) ? s : o[0]); }
  g = settle(g);
  assert.equal(g.objects[s].counters.buff ?? 0, 0, 'his buff was spent for Call to Glory');
  assert.equal(mightOf(g, s), m0 - 1 + 3, 'buff gone (-1), +3 from the spell, no +4');
});

test('RJ#3250 Unyielding Spirit played in response: a Reaction damage spell played on top resolves first and deals its damage; the damage spell under it is prevented', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P1, 'V(3)', 'base');
  g = play(g, P0, hand(g, P0, 'ZapM'), { targets: [[u]] });
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Unyielding Spirit'));
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  g = play(g, P0, hand(g, P0, 'ZapR'), { targets: [[u]] });
  g = settle(g);
  assert.equal(zone(g, u), 'base');
  assert.equal(g.objects[u].damage, 2, 'ZapR (top) dealt 2; ZapM (under Unyielding Spirit) prevented');
});

test('RJ#3252 Ahri, Alluring killed with her hold trigger on the chain: the trigger still resolves and scores', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1);
  const ah = put(g, P0, 'Ahri, Alluring', BF_A); control(g, BF_A, P0);
  const k = putF(g, P1, 'rjf-killr', 'hand');
  g = endTurn(g, P1);
  for (let i = 0; i < 20 && !g.chain.some(c => c.source === ah); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(g.chain.some(c => c.source === ah), 'hold trigger on the chain');
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  g = play(g, P1, k, { targets: [[ah]] });
  g = settle(g);
  assert.equal(zone(g, ah), 'trash');
  assert.equal(g.players[P0].points, 2, 'hold point + Ahri\'s point');
});

test('RJ#3259 Promising Future: my Salvage (played first, finalized while the opponent\'s Vanguard Armory is still pending) can\'t choose that Armory', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 8); fundAll(g, P1, 8);
  const sv = put(g, P0, 'Salvage', 'deckTop');
  const va = put(g, P1, 'Vanguard Armory', 'deckTop');
  g.pending = { kind: 'mainAction', player: P1, prompt: '', inStep: false }; g.timestamp++;
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Promising Future') });
  let offeredArmory: boolean | null = null;
  for (let i = 0; i < 40 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const ids = optionIds(g);
    if (ids.includes(sv)) { g = choose(g, sv); continue; }
    if (ids.includes(va) && d.player === P1 && d.kind !== 'chooseTargets') { g = choose(g, va); continue; }
    if (d.player === P0 && d.kind === 'chooseTargets') { offeredArmory = !!offeredArmory || ids.includes(va); g = act(g, legal(g, d.player)[0]); continue; }
    g = d.kind === 'optional' ? choose(g, 'yes') : act(g, legal(g, d.player)[0]);
  }
  assert.equal(zone(g, sv), 'trash', 'Salvage played');
  assert.equal(zone(g, va), 'base', 'Armory played and survives');
  assert.notEqual(offeredArmory, true, 'Salvage chose (up to one gear) when played: the Armory was not on the board yet');
});

test('RJ#3262 during a showdown at one battlefield, an Action spell may target a unit at another battlefield', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'V(2)', 'base');
  const e = put(g, P1, 'V(2)', BF_B); control(g, BF_B, P1);
  g = move(g, P0, [u], BF_A);
  assert.ok(g.showdown, 'showdown at BF_A');
  g = play(g, P0, hand(g, P0, 'ZapA'), { targets: [[e]] });
  g = settle(g);
  assert.equal(zone(g, e), 'trash');
});

test('RJ#3263 Promising Future: the opponent plays Brynhir Thundersong off it (first); my card from it is still played', () => {
  let g = S0(); fundAll(g, P0, 8);
  const mine = put(g, P0, 'V(2)', 'deckTop');
  const bt = put(g, P1, 'Brynhir Thundersong', 'deckTop');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Promising Future') });
  for (let i = 0; i < 40 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const ids = optionIds(g);
    g = ids.includes(mine) ? choose(g, mine) : ids.includes(bt) ? choose(g, bt) : ids.includes('base') ? choose(g, 'base') : d.kind === 'optional' ? choose(g, 'yes') : act(g, legal(g, d.player)[0]);
  }
  assert.equal(zone(g, bt), 'base', 'Brynhir played');
  assert.ok(['base', 'battlefield'].includes(zone(g, mine)), `my card was still played (${zone(g, mine)})`);
  assert.equal(canPlayNow(g, P0, hand(g, P0, 'ZapM')), false, 'afterwards I can\'t play cards this turn');
});

test('RJ#3271 both sides can survive combat: a stunned defender deals nothing (RJ), and so does prevented damage; the surviving attackers are recalled', () => {
  // stun (RJ#2604 setup)
  let { g, atk, def } = attackSetup(['V(3)'], ['V(5)'], { defOpts: [{ stunned: true }] });
  g = settle(g);
  assert.equal(zone(g, atk[0]), 'base'); assert.equal(locOf(g, def[0]), BF_A);
  // prevention (no stun): the attacker survives too
  let h = S0(); fundAll(h, P0);
  const a = put(h, P0, 'V(3)', 'base');
  const d = put(h, P1, 'V(5)', BF_A); control(h, BF_A, P1);
  h = settle(play(h, P0, hand(h, P0, 'KiBarrierLike'), { targets: [[a]] }));
  h = drive(move(h, P0, [a], BF_A));
  assert.equal(zone(h, a), 'base', 'attacker survived (damage prevented) and was recalled');
  assert.equal(locOf(h, d), BF_A);
});

test('RJ#3272 three Viktor, Innovator: one card played on the opponent\'s turn makes three Recruits', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0);
  for (let i = 0; i < 3; i++) put(g, P0, 'Viktor, Innovator', 'base');
  const e = put(g, P1, 'V(4)', 'base');
  g.pending = { kind: 'mainAction', player: P1, prompt: '', inStep: false }; g.timestamp++;
  g = play(g, P1, putF(g, P1, 'rjf-killr', 'hand'), { targets: [[e]] });
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  g = drive(play(g, P0, hand(g, P0, 'Stupefy'), { targets: [[e]] }));
  assert.equal(g.players[P0].base.filter(id => g.cards[g.objects[id].cardId].name === 'Recruit').length, 3);
});

test('RJ#3278 at 6, I conquer B (7), then attack A; the defender Rides the Wind out of A: I conquer A too (every battlefield scored this turn) and win', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0);
  g.players[P1].points = 6; g.players[P0].points = 7;
  const big = put(g, P0, 'V(9)', BF_A); control(g, BF_A, P0);
  const u1 = put(g, P1, 'V(2)', 'base'), u2 = put(g, P1, 'V(2)', 'base');
  g.pending = { kind: 'mainAction', player: P1, prompt: '', inStep: false }; g.timestamp++;
  g = drive(move(g, P1, [u1], BF_B));
  assert.equal(g.players[P1].points, 7);
  g = move(g, P1, [u2], BF_A);
  for (let i = 0; i < 4 && !(pend(g).player === P0 && !pend(g).inStep); i++) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[big]], locations: [BF_B] });
  g = drive(g, h => (optionIds(h).includes(String(BF_B)) ? [String(BF_B)] : null));
  assert.equal(g.winner, P1, 'conquered A as well: 8 with both battlefields scored');
});

test('RJ#3280 Experimental Hexplate ("I am a Mech") adds the Mech tag; the unit keeps its own tags', () => {
  const g = S0();
  const u = put(g, P0, 'Viktor, Innovator', 'base');
  const hp = put(g, P0, 'Experimental Hexplate', 'base');
  attachNow(g, hp, u);
  const tags = chars(g, u).tags;
  assert.ok(tags.includes('Mech'));
  assert.ok(tags.includes('Viktor') && tags.includes('Zaun'), `kept (${tags.join(',')})`);
});

test('RJ#3290 rune deck domain identity follows the Champion Legend (Fury/Chaos): a Calm rune is illegal, a Chaos rune is fine', () => {
  const db = fixtureDb();
  const runes = (r: string) => { const d = legalDeck(); d.runes = [...new Array(11).fill('cf-rune-fury'), r]; return validateDeck(d, db, { battlefields: 3 }); };
  assert.equal(runes('cf-rune-chaos').length, 0);
  assert.ok(runes('cf-rune-calm').length > 0);
});

test('RJ#3293 Sprite Mother: the Sprite token is played ready ("here"); Sprite Mother may be played to a battlefield I control', () => {
  let g = S0(); fundAll(g, P0, 8);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const sm = hand(g, P0, 'Sprite Mother');
  assert.ok(playDests(g, P0, sm).includes(BF_A), 'controlled battlefield is a legal destination');
  g = drive(play(g, P0, sm, { dest: 'base' }));
  const sp = g.players[P0].base.find(id => g.cards[g.objects[id].cardId].name === 'Sprite');
  assert.ok(sp, 'Sprite played here (base)');
  assert.equal(g.objects[sp!].exhausted, false, 'ready');
  assert.ok(moveDests(g, P0, sp!).length > 0, 'can move this turn');
});

test('RJ#3304 Kinkou Monk ("buff up to two other friendly units") can\'t pick the same unit twice: Lee Sin, Ascetic gets one buff', () => {
  let g = S0(); fundAll(g, P0, 8);
  const ls = put(g, P0, 'Lee Sin, Ascetic', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Kinkou Monk'), destination: 'base' });
  let rejectedDup = false;
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    if (d.kind === 'chooseTargets' && optionIds(g).includes(ls)) {
      rejectedDup = rejects(g, { type: 'choose', player: d.player, optionIds: [ls, ls] }) !== null;
      g = choose(g, ls); continue;
    }
    g = act(g, legal(g, d.player)[0]);
  }
  assert.ok(rejectedDup, 'the same unit twice is not a legal choice');
  assert.equal(g.objects[ls].counters.buff ?? 0, 1);
});

test('RJ#3305 Wuju Bladesman (Master Yi legend) "defends alone +2" doesn\'t apply outside combat: a spell on the chain sees base Might; only a staged-and-begun combat makes it a defender', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0);
  setLegend(g, P0, 'Wuju Bladesman');
  const d = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  assert.equal(mightOf(g, d), 3, 'alone at a battlefield, not defending');
  const a = put(g, P1, 'V(1)', 'base');
  g.pending = { kind: 'mainAction', player: P1, prompt: '', inStep: false }; g.timestamp++;
  const z = put(g, P1, 'ZapA', 'hand');
  for (const x of g.players[P1].runesInPlay) g.objects[x].exhausted = false;
  g = play(g, P1, z, { targets: [[d]] });
  assert.equal(mightOf(g, d), 3, 'still 3 while the spell is on the chain');
  g = settle(g);
  assert.equal(g.objects[d].damage, 2);
  g = move(g, P1, [a], BF_A);
  for (let i = 0; i < 6 && !g.objects[d].combatRole; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(g.objects[d].combatRole, 'defender in the combat');
  assert.equal(mightOf(g, d), 5, 'defending alone: +2');
});

test('RJ#3309 Cull the Weak doesn\'t choose: the opponent\'s only unit, Deadbloom Predator (Deflect), adds no cost and is killed by its controller', () => {
  let g = S0(); fundAll(g, P0);
  const dp = put(g, P1, 'Deadbloom Predator', BF_A); control(g, BF_A, P1);
  const n0 = g.players[P0].runesInPlay.length;
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Cull the Weak') });
  for (let i = 0; i < 6 && pend(g).inStep; i++) g = act(g, legal(g, pend(g).player)[0]);
  assert.equal(n0 - g.players[P0].runesInPlay.length, 1, 'only Cull\'s own [C] recycled, no Deflect');
  g = settle(g);
  for (let i = 0; i < 4 && pend(g).inStep; i++) { assert.equal(pend(g).player, P1, 'its controller chooses'); g = act(g, legal(g, P1)[0]); g = settle(g); }
  assert.equal(zone(g, dp), 'trash');
});

test('RJ#3311 Lee Sin, Ascetic: "[T]: Buff me" again after another effect readies him (he can have any number of buffs)', () => {
  let g = S0(); fundAll(g, P0);
  const ls = put(g, P0, 'Lee Sin, Ascetic', 'base');
  const tap = () => { g = settle(act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === ls)!)); g = drive(g); };
  tap();
  assert.equal(g.objects[ls].counters.buff, 1);
  assert.ok(!legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === ls), 'exhausted');
  g.objects[ls].exhausted = false; g.timestamp++;   // readied by another effect
  tap();
  assert.equal(g.objects[ls].counters.buff, 2);
});

test('RJ#3312 (AMBIGUOUS, house = RJ) Fox-Fire\'s targets pumped past total Might 4: on resolution the caster chooses which subgroup (total 4 or less) dies', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const a = put(g, P1, 'V(1)', BF_A), b = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Fox-Fire, Ahri') });
  g = choose(g, a); g = choose(g, b);
  for (let i = 0; i < 6 && pend(g).inStep; i++) g = act(g, { type: 'choose', player: pend(g).player, optionIds: [] });
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'PumpR'), { targets: [[a]] });   // a: 4, b: 3 → total 7
  let offered = false;
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    if (d.player === P0 && optionIds(g).includes(b)) { offered = true; g = choose(g, b); continue; }
    g = act(g, legal(g, d.player)[0]);
  }
  assert.ok(offered, 'the caster chooses the subgroup');
  assert.equal(zone(g, b), 'trash'); assert.equal(locOf(g, a), BF_A);
});

test('RJ#3313 Tibbers\' "When you play me" damage is an ability: Annie, Fiery adds 1 Bonus Damage (4 to each unit at battlefields)', () => {
  let g = S0(); fundAll(g, P0, 12);
  put(g, P0, 'Annie, Fiery', 'base');
  const e = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  g = drive(play(g, P0, hand(g, P0, 'Tibbers'), { dest: 'base' }));
  assert.equal(g.objects[e].damage, 4);
});

test('RJ#3316 playing a card is not discarding it: Flame Chompers played from hand gets no "when you discard me" trigger', () => {
  let g = S0(); fundAll(g, P0);
  const fc = hand(g, P0, 'Flame Chompers');
  const n0 = g.log.length;
  g = drive(play(g, P0, fc, { dest: 'base' }));
  assert.equal(zone(g, fc), 'base');
  assert.ok(!g.log.slice(n0).some(l => /Trigger: Flame Chompers/.test(l.text)), 'no discard trigger');
});

// DECIDED (DECISIONS #3319, ADJUDICATOR-3): RJ#3319 ("design intent, rules not finalized") not adopted — Karma's trigger is added (and
// finalized, choosing its unit) before the deferred play of the banished unit (CR 337 order added, principle 5, rules-decisions #51).
test('RJ#3319 (AMBIGUOUS → house: RJ not adopted) Promising Future recycling (Karma, Channeler) and playing my banished unit: Karma\'s buff can\'t go on that unit (its trigger chooses before the unit enters)', () => {
  let g = S0(); fundAll(g, P0, 8);
  put(g, P0, 'Karma, Channeler', 'base');
  const u = put(g, P0, 'V(3)', 'deckTop');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Promising Future') });
  let offered = false;
  for (let i = 0; i < 40 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const ids = optionIds(g);
    if (d.kind === 'chooseTargets' && ids.includes(u)) { offered = true; g = choose(g, u); continue; }
    if (d.kind === 'chooseCards' && ids.includes(u)) { g = choose(g, u); continue; }
    g = ids.includes('base') ? choose(g, 'base') : d.kind === 'optional' ? choose(g, 'yes') : act(g, legal(g, d.player)[0]);
  }
  assert.ok(!offered, 'the unit played off Promising Future is not yet on the board when Karma\'s trigger chooses');
  assert.equal(zone(g, u), 'base', 'the banished unit was played');
  assert.equal(g.objects[u].counters.buff ?? 0, 0);
});

test('RJ#3319b Promising Future recycles "the rest" as one instruction: Karma, Channeler ("one or more cards") triggers once, not once per card', () => {
  let g = S0(); fundAll(g, P0, 8);
  put(g, P0, 'Karma, Channeler', 'base');
  const n0 = g.log.length;
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Promising Future') });
  g = drive(g, h => (pend(h).kind === 'chooseDestination' ? ['base'] : null));
  const trig = g.log.slice(n0).filter(l => /^Trigger: Karma/.test(l.text)).length;
  assert.equal(trig, 1, 'one Karma trigger (RJ#4034: recycling several cards at once triggers once)');
});

test('RJ#3323 Party Favors in FFA: two opponents choose Runes → each channels 1, and I channel 1 per such player (2)', async () => {
  const { createGame } = await import('../../src/engine/index.ts');
  let g = createGame({ seed: 3, cardDb: fixtureDb(), firstPlayer: P0, skipMulligan: true, battlefieldSelection: 'random', includeAllCards: true, mode: 'ffa',
    players: [0, 1, 2].map(i => ({ name: `P${i}`, deck: legalDeck() })) });
  fundAll(g, P0, 6);
  const runes = () => [0, 1, 2].map(p => g.players[p].runesInPlay.length);
  const r0 = runes();
  const pf = hand(g, P0, 'Party Favors');
  g = act(g, { type: 'playCard', player: P0, obj: pf });
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const rune = (d.options ?? []).find(o => /rune/i.test(o.label));
    g = d.player !== P0 && rune ? choose(g, rune.id) : act(g, legal(g, d.player)[0]);
  }
  const r1 = runes();
  assert.equal(zone(g, pf), 'trash');
  assert.deepEqual([r1[0] - r0[0], r1[1] - r0[1], r1[2] - r0[2]], [2, 1, 1], 'Party Favors costs only Energy: rune counts change by channelling alone');
});

test('RJ#3327 moving into an enemy battlefield in batches: a trade (both die) scores nothing; a second unit moved in then conquers and scores', () => {
  let { g, atk } = attackSetup(['V(3)'], ['V(3)']);
  g = settle(g);
  assert.equal(zone(g, atk[0]), 'trash');
  assert.equal(g.players[P0].points, 0, 'trading alone does not conquer');
  assert.equal(g.battlefields[BF_A].controller, null);
  const t = put(g, P0, 'V(1)', 'base');
  g = drive(move(g, P0, [t], BF_A));
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[P0].points, 1);
});

test('RJ#3328 Void Seeker needs a unit at a battlefield to choose; with none it can\'t be played just to draw', () => {
  const g = S0(); fundAll(g, P0);
  const vs = hand(g, P0, 'Void Seeker');
  assert.equal(canPlayNow(g, P0, vs), false);
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  assert.equal(canPlayNow(g, P0, vs), true);
});

test('RJ#3329 Sett, Brawler can spend the buff from his play trigger at once (the ability needs no [T]/ready)', () => {
  let g = S0(); fundAll(g, P0, 8);
  const s = hand(g, P0, 'Sett, Brawler');
  g = drive(play(g, P0, s, { dest: 'base' }));
  assert.equal(g.objects[s].counters.buff, 1);
  assert.equal(g.objects[s].exhausted, true, 'entered exhausted');
  const ab = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === s);
  assert.ok(ab, '"Spend my buff" is usable while exhausted');
  g = drive(settle(act(g, ab!)));
  assert.equal(mightOf(g, s), 4 + 4);
});

test('RJ#3336 (MISMATCH-RJ) my only unit at my attacked battlefield is killed mid-showdown (Hextech Ray): I still control it (CR 323.5), so Sprite Call may put its Sprite there', () => {
  let { g, def } = attackSetup(['V(2)'], ['V(1)']);
  fundAll(g, P0); fundAll(g, P1);
  const sc = hand(g, P1, 'Sprite Call');
  if (pend(g).player === P1) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Hextech Ray'), { targets: [[def[0]]] });
  for (let i = 0; i < 4 && g.chain.length; i++) g = pass(g);
  assert.equal(zone(g, def[0]), 'trash');
  assert.ok(g.showdown, 'showdown still on');
  expectPending(g, 'showdownAction', P1, 'focus passed to the defender');
  assert.equal(g.battlefields[BF_A].controller, P1, 'still controlled during the showdown there');
  let offered: string[] = [];
  g = play(g, P1, sc);
  g = drive(g, h => { const d = pend(h); if (d.kind === 'chooseDestination') { offered = d.options!.map(o => o.id); return [String(BF_A)]; } return null; });
  assert.ok(offered.includes(String(BF_A)), `BF-A offered (${offered.join(',')})`);
});

test('RJ#3341 Gust on Stalwart Poro; a Reaction raises it above 3 Might in response: Gust resolves with no effect (checked on resolution)', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const p = put(g, P1, 'Stalwart Poro', BF_A); control(g, BF_A, P1);
  g = play(g, P0, hand(g, P0, 'Gust'), { targets: [[p]] });
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  g = play(g, P1, hand(g, P1, 'PumpR'), { targets: [[p]] });
  g = settle(g);
  assert.equal(locOf(g, p), BF_A, 'not returned');
});

test('RJ#3343 Malzahar, Fanatic\'s [Action] [Add] ability can\'t be used in the Beginning Phase (e.g. while a hold trigger is on the chain)', () => {
  let g = S0({ tp: P1 });
  const mz = put(g, P0, 'Malzahar, Fanatic', 'base');
  put(g, P0, 'V(1)', 'base');
  put(g, P0, 'Ahri, Alluring', BF_A); control(g, BF_A, P0);
  g = endTurn(g, P1);
  for (let i = 0; i < 20 && !g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(g.chain.length, 'hold trigger on the chain in my Beginning Phase');
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  assert.ok(!legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === mz), 'not usable now');
});

test('RJ#3344 Stealthy Pursuer joins the move into an enemy battlefield: two attackers, so Mask of Foresight ("attacks alone") gives no +1', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'Mask of Foresight', 'base');
  const sp = put(g, P0, 'Stealthy Pursuer', 'base');
  const u = put(g, P0, 'V(2)', 'base');
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [u], BF_A);
  for (let i = 0; i < 12 && !g.objects[u].combatRole; i++) { const d = pend(g); g = d.inStep ? (d.kind === 'optional' ? choose(g, 'yes') : act(g, legal(g, d.player)[0])) : pass(g); }
  assert.equal(locOf(g, sp), BF_A, 'Pursuer moved with it');
  assert.ok(g.objects[u].combatRole, 'combat begun');
  assert.equal(mightOf(g, u), 2, 'not alone: no Mask buff');
});

test('RJ#3345 Assault does nothing in a non-combat showdown (no attackers)', () => {
  let g = S0();
  const f = put(g, P0, 'Captain Farron', 'base');
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [f, u], BF_A);
  assert.ok(g.showdown, 'non-combat showdown');
  assert.ok(hasKeyword(g, u, 'Assault'));
  assert.equal(mightOf(g, u), 2);
});

test('RJ#3350 the once-per-turn scoring limit is per player: the opponent conquers a battlefield on my turn (Charmed there), then I conquer it too and score', () => {
  let g = S0(); fundAll(g, P0);
  const e = put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  put(g, P1, 'V(1)', BF_B);
  const big = put(g, P0, 'V(5)', 'base');
  [g] = cast(g, P0, 'Charm', { targets: [[e]] });
  g = drive(g, h => (['chooseDestination', 'chooseBattlefield'].includes(pend(h).kind) ? [String(BF_A)] : null));
  assert.equal(g.battlefields[BF_A].controller, P1, 'the opponent conquered A on my turn');
  assert.equal(g.players[P1].points, 1);
  g = drive(move(g, P0, [big], BF_A));
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[P0].points, 1, 'I still score A this turn');
});

test('RJ#3356 Call to Glory spending the buff of a damaged unit (7 Might with 6 damage) drops it to 6: it dies in the next cleanup', () => {
  let g = S0(); fundAll(g, P0);
  const sona = put(g, P0, 'V(6)', 'base', { buff: true, damage: 6 });
  const shen = put(g, P0, 'V(2)', 'base');
  assert.equal(mightOf(g, sona), 7);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Call to Glory') });
  for (let i = 0; i < 8 && pend(g).inStep; i++) {
    const d = pend(g); const o = optionIds(g);
    g = choose(g, d.kind === 'optional' ? 'yes' : d.kind === 'chooseTargets' && o.includes(shen) ? shen : o.includes(sona) ? sona : o[0]);
  }
  assert.equal(g.objects[sona]?.counters.buff ?? 0, 0, 'buff spent as the cost');
  g = settle(g);
  assert.equal(zone(g, sona), 'trash');
  assert.equal(mightOf(g, shen), 5);
});

test('RJ#3362 Fiora, Peerless with Svellsongur attached defending one on one: two doubling triggers, so her Might is quadrupled', () => {
  let g = S0({ tp: P1 });
  const f = put(g, P0, 'Fiora, Peerless', BF_A); control(g, BF_A, P0);
  attachNow(g, put(g, P0, 'Svellsongur', 'base'), f);
  const m0 = mightOf(g, f)!;
  g = move(g, P1, [put(g, P1, 'V(1)', 'base')], BF_A);
  for (let i = 0; i < 14 && (g.chain.length || pend(g).inStep || !g.showdown); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(mightOf(g, f), m0 * 4);
});

test('RJ#3364 Retreat ("a friendly unit") can\'t choose an enemy unit', () => {
  let g = S0(); fundAll(g, P0);
  const m1 = put(g, P0, 'V(2)', BF_A), m2 = put(g, P0, 'V(2)', 'base'); control(g, BF_A, P0);
  const e = put(g, P1, 'V(2)', BF_B); control(g, BF_B, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Retreat') });
  const o = optionIds(g);
  assert.ok(o.includes(m1) && o.includes(m2), 'friendly units offered');
  assert.ok(!o.includes(e), 'enemy unit not offered');
});

test('RJ#3366 Singularity on my buffed unit; my hidden Hidden Blade on it in response, The Boss saves it: I still draw 2, then Singularity kills it in base', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  setLegend(g, P0, 'The Boss');
  const u = put(g, P0, 'V(1)', BF_A, { buff: true }); control(g, BF_A, P0);
  const hb = put(g, P0, 'Hidden Blade', { facedown: BF_A });
  g = play(g, P1, hand(g, P1, 'Singularity'), { targets: [[u]] });
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  const h0 = handN(g, P0);
  g = play(g, P0, hb, { targets: [[u]] });
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) { const d = pend(g); g = d.inStep ? (d.kind === 'optional' ? choose(g, 'yes') : act(g, legal(g, d.player)[0])) : pass(g); }
  assert.equal(handN(g, P0), h0 + 2, 'Hidden Blade\'s draw still happens');
  assert.equal(zone(g, u), 'trash', 'Singularity resolves on the recalled unit');
});

test('RJ#3368 Carnivorous Snapvine and the chosen enemy deal damage to each other simultaneously: both can die', () => {
  let g = S0(); fundAll(g, P0);
  const e = put(g, P1, 'V(6)', BF_A); control(g, BF_A, P1);
  const sv = hand(g, P0, 'Carnivorous Snapvine');
  g = settle(play(g, P0, sv, { dest: 'base', targets: [[e]] }));
  assert.equal(zone(g, e), 'trash');
  assert.equal(zone(g, sv), 'trash');
});

test('RJ#3369 Held a battlefield at the start of my turn, moved off and back: no conquer point (already scored this turn)', () => {
  let g = S0({ tp: P1 });
  const u1 = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const u2 = put(g, P0, 'V(2)', 'base');
  g = nextTurn(g);
  assert.equal(g.players[P0].points, 1, 'hold point');
  g = drive(move(g, P0, [u1], 'base'));
  g = drive(move(g, P0, [u2], BF_A));
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[P0].points, 1, 'no second point from A this turn');
});

test('RJ#3374 (MISMATCH-RJ) Draw 4 with 3 cards in the deck: draw 3, then Burn Out (trash shuffled in, opponent +1), then draw the 4th (CR 432)', () => {
  let g = S0(); fundAll(g, P0);
  clearDeck(g, P0);
  for (let i = 0; i < 3; i++) put(g, P0, 'V(1)', 'deckTop');
  fillTrash(g, P0, 5);
  const h0 = handN(g, P0);
  [g] = cast(g, P0, 'Progress Day');
  g = settle(g);
  assert.equal(handN(g, P0), h0 + 4, 'all four drawn');
  assert.equal(g.players[P1].points, 1, 'the burn-out point (RJ: "you do not perform a burn out")');
});

test('RJ#3375 Blitzcrank\'s play trigger choosing an enemy Deflect unit asks for the Deflect cost', () => {
  let g = S0(); fundAll(g, P0, 6);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const d = put(g, P1, 'Deflect(3,1)', BF_B); control(g, BF_B, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Blitzcrank'), destination: BF_A });
  const prompts: string[] = [];
  for (let i = 0; i < 12 && (pend(g).inStep || g.chain.length); i++) {
    const x = pend(g); prompts.push(x.prompt ?? '');
    if (!x.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    g = choose(g, x.kind === 'optional' ? 'yes' : o.includes(d) ? d : o[0]);
  }
  assert.ok(prompts.some(p => /Deflect/.test(p)), `Deflect payment asked (${prompts.join(' | ')})`);
});

test('RJ#3376 Ride the Wind during a showdown on the opponent\'s turn into an open battlefield: I conquer and score; on my turn I hold it and score again', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0);
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P1, [put(g, P1, 'V(1)', 'base')], BF_A);
  for (let i = 0; i < 5 && !(pend(g).player === P0 && pend(g).kind === 'showdownAction'); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  expectPending(g, 'showdownAction', P0);
  g = play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[u]], dest: BF_B, locations: [BF_B] });
  g = drive(g, h => (['chooseDestination', 'chooseBattlefield'].includes(pend(h).kind) ? [String(BF_B)] : null));
  assert.equal(g.battlefields[BF_B].controller, P0);
  assert.equal(g.players[P0].points, 1, 'conquered B on the opponent\'s turn');
  g = nextTurn(g);
  assert.equal(g.activePlayer, P0);
  assert.equal(g.players[P0].points, 2, 'held B on my turn');
});

test('RJ#3378 Cleave on a 2-Might unit, Gust on it in response: it returns to hand and Cleave resolves with no effect', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const cl = hand(g, P0, 'Cleave');
  g = play(g, P0, cl, { targets: [[u]] });
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Gust'), { targets: [[u]] });
  g = settle(g);
  assert.equal(zone(g, u), 'hand');
  assert.equal(zone(g, cl), 'trash');
  assert.equal(g.chain.length, 0);
});

test('RJ#3380 Udyr\'s "Spend my buff" ability has no Action/Reaction: usable in my open main phase, not during a showdown', () => {
  let g = S0(); fundAll(g, P0);
  const ud = put(g, P0, 'ogn-157-298', 'base', { buff: true });
  const can = (x: GameState) => legal(x, P0, 'activate').some(a => a.type === 'activate' && a.obj === ud);
  assert.ok(can(g), 'open state, my turn');
  g = move(g, P0, [put(g, P0, 'V(1)', 'base')], BF_A);
  assert.ok(g.showdown, 'non-combat showdown');
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = act(g, legal(g, pend(g).player)[0]);
  expectPending(g, 'showdownAction', P0);
  assert.ok(!can(g), 'not usable in a showdown');
});

test('RJ#3385 Opponent Charms my only unit from my battlefield into theirs (I lose A); I Ride the Wind it back: I conquer A and score', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  put(g, P1, 'V(5)', BF_B); control(g, BF_B, P1);
  g = play(g, P1, hand(g, P1, 'Charm'), { targets: [[u]], dest: BF_B, locations: [BF_B] });
  for (let i = 0; i < 20 && !(pend(g).player === P0 && pend(g).kind === 'showdownAction'); i++) {
    const d = pend(g);
    g = d.inStep ? (['chooseDestination', 'chooseBattlefield'].includes(d.kind) ? choose(g, String(BF_B)) : act(g, legal(g, d.player)[0])) : pass(g);
  }
  assert.equal(locOf(g, u), BF_B, 'charmed into B');
  expectPending(g, 'showdownAction', P0);
  g = play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[u]], dest: BF_A, locations: [BF_A] });
  g = drive(g, h => (['chooseDestination', 'chooseBattlefield'].includes(pend(h).kind) ? [String(BF_A)] : null));
  assert.equal(locOf(g, u), BF_A);
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[P0].points, 1, 'conquered A');
});

test('RJ#3387 Altar to Unity\'s hold trigger plays the Recruit token exhausted (normal play rules)', () => {
  let g = S0({ tp: P1, bfA: 'Altar to Unity' });
  withTokens(g);
  put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const before = new Set(g.players[P0].base);
  g = nextTurn(g);
  const rec = g.players[P0].base.filter(id => !before.has(id) && g.cards[g.objects[id].cardId].name === 'Recruit');
  assert.equal(rec.length, 1);
  assert.equal(g.objects[rec[0]].exhausted, true);
});

test('RJ#3389 Miss Fortune (Accelerate) is paid as energy plus power: 5+1 energy and [C][C] Body power; with one Body rune Accelerate can\'t be paid', () => {
  for (const body of [2, 1]) {
    let g = S0();
    setRunes(g, P0, 6, 'fury'); addRunes(g, P0, body, 'body');
    const mf = hand(g, P0, 'ogn-162-298');
    g = settle(play(g, P0, mf, { dest: 'base', may: [true] }));
    assert.equal(zone(g, mf), 'base');
    assert.equal(g.objects[mf].exhausted, body < 2, body === 2 ? 'Accelerate paid: enters ready' : 'only one Body power: no Accelerate');
  }
});

test('RJ#3391 Gust in response before Ravenbloom Student\'s spell trigger resolves: she is still 2 Might, so Gust can choose her and returns her', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const rb = put(g, P1, 'Ravenbloom Student', BF_A); control(g, BF_A, P1);
  g = play(g, P1, hand(g, P1, 'Cleave'), { targets: [[rb]] });
  for (let i = 0; i < 6 && pend(g).player !== P0; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(g.chain.length, 'something still on the chain');
  assert.equal(mightOf(g, rb), 2);
  const gu = hand(g, P0, 'Gust');
  assert.ok(canPlayNow(g, P0, gu));
  g = settle(play(g, P0, gu, { targets: [[rb]] }));
  assert.equal(zone(g, rb), 'hand');
});

test('RJ#3392 Charm on my unit at the battlefield with my hidden Tideturner: Tideturner can\'t choose that unit (same location)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const an = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const bu = put(g, P0, 'V(1)', 'base');
  const t = put(g, P0, 'Tideturner', { facedown: BF_A });
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Charm') });
  for (let i = 0; i < 6 && pend(g).inStep; i++) { const d = pend(g); g = choose(g, d.kind === 'chooseTargets' ? an : d.options!.some(o => o.id === 'base') ? 'base' : d.options![0].id); }
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  g = act(g, { type: 'playCard', player: P0, obj: t });
  const seen: string[] = [];
  for (let i = 0; i < 6 && pend(g).inStep; i++) { const d = pend(g); seen.push(...(d.options ?? []).map(o => o.id)); g = act(g, legal(g, d.player)[0]); }
  assert.ok(!seen.includes(an), 'the unit sharing Tideturner\'s location is not offered');
  assert.ok(seen.includes(bu), 'a unit at another location is');
});

test('RJ#3393 Vayne attacking (Assault 3 → 5) takes 4 from Void Seeker, then Ride the Wind to an empty battlefield: no longer attacking, 2 Might with 4 damage — she dies', () => {
  let { g, atk } = attackSetup(['Vayne'], ['V(6)']);
  fundAll(g, P0); fundAll(g, P1);
  const v = atk[0];
  assert.equal(mightOf(g, v), 5);
  let rode = false, sought = false;
  for (let i = 0; i < 30 && !rode; i++) {
    const d = pend(g);
    if (d.inStep) { g = act(g, legal(g, d.player)[0]); continue; }
    if (d.kind === 'showdownAction' && d.player === P1 && !sought && !g.chain.length) { g = play(g, P1, hand(g, P1, 'Void Seeker'), { targets: [[v]] }); sought = true; continue; }
    if (d.kind === 'showdownAction' && d.player === P0 && sought && !g.chain.length) { g = play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[v]], dest: BF_B, locations: [BF_B] }); rode = true; continue; }
    g = pass(g);
  }
  assert.ok(sought && rode, 'both spells played');
  for (let i = 0; i < 8 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(zone(g, v), 'trash');
});

test('RJ#3396 Baited Hook can\'t be activated with no friendly unit; if its unit is Gusted in response the top 5 are still looked at and recycled, but nothing is played', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const hook = put(g, P0, 'Baited Hook', 'base');
  const canHook = (x: GameState) => legal(x, P0, 'activate').some(a => a.type === 'activate' && (a as { obj?: ObjId }).obj === hook);
  assert.ok(!canHook(g), 'no friendly unit: can\'t be activated');
  const vic = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const top = stackTop(g, P0, 'V(2)', 'V(1)', 'V(1)', 'V(1)', 'V(1)');
  assert.ok(canHook(g));
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && (a as { obj?: ObjId }).obj === hook)!);
  g = answer(g, { targets: [[vic]] }, P0);
  if (pend(g).player === P0) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Gust'), { targets: [[vic]] });
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    g = d.kind === 'optional' ? choose(g, 'yes') : optionIds(g).includes(top[0]) ? choose(g, top[0]) : act(g, legal(g, d.player)[0]);
  }
  assert.equal(zone(g, vic), 'hand');
  assert.equal(zone(g, top[0]), 'mainDeck', 'not played');
  const deck = g.players[P0].mainDeck;
  assert.ok(top.every(t => deck.indexOf(t) >= deck.length - 5), 'the five looked-at cards were recycled to the bottom');
});

test('RJ#3407 Charm ignores standard-move limits: an exhausted enemy unit moves battlefield to battlefield without Ganking', () => {
  let g = S0(); fundAll(g, P0);
  const e = put(g, P1, 'V(1)', BF_B, { ready: false }); control(g, BF_B, P1);
  put(g, P1, 'V(1)', BF_B);
  put(g, P0, 'V(5)', BF_A); control(g, BF_A, P0);
  [g] = cast(g, P0, 'Charm', { targets: [[e]] });
  g = drive(g, h => (['chooseDestination', 'chooseBattlefield'].includes(pend(h).kind) ? [String(BF_A)] : null));
  assert.notEqual(locOf(g, e), BF_B, 'moved');
  assert.ok(locOf(g, e) === BF_A || zone(g, e) === 'trash', 'to A (and dies in the combat there)');
});

test('RJ#3409 A stunned unit moved to an empty battlefield still conquers it', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'V(2)', 'base', { stunned: true });
  [g] = cast(g, P0, 'Ride the Wind', { targets: [[u]], dest: BF_A, locations: [BF_A] });
  g = drive(g, h => (['chooseDestination', 'chooseBattlefield'].includes(pend(h).kind) ? [String(BF_A)] : null));
  assert.equal(locOf(g, u), BF_A);
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[P0].points, 1);
});

test('RJ#3417 Possession on an enemy Deadbloom Predator: it is recalled to my base (not played), so its "play me to an occupied enemy battlefield" never applies', () => {
  let g = S0(); fundAll(g, P0);
  const dp = put(g, P1, 'Deadbloom Predator', BF_A); control(g, BF_A, P1);
  put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Possession') });
  g = drive(g, h => (optionIds(h).includes(dp) ? [dp] : pend(h).kind === 'optional' ? ['yes'] : null));
  assert.equal(zone(g, dp), 'base');
  assert.equal(g.objects[dp].controller, P0);
  assert.ok(g.players[P0].base.includes(dp));
});

test('RJ#3419 Mageseeker Warden at a battlefield: the opponent can\'t play Deadbloom Predator to an occupied enemy battlefield (only to base)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1, 6);
  put(g, P0, 'Mageseeker Warden', BF_A); control(g, BF_A, P0);
  put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
  const dp = hand(g, P1, 'Deadbloom Predator');
  const ds = playDests(g, P1, dp);
  assert.ok(ds.includes('base'));
  assert.ok(!ds.includes(BF_A) && !ds.includes(BF_B), `only base (${ds.join(',')})`);
});

test('RJ#3421 Arcane Shift on my attacker during combat: the battlefield I\'m attacking isn\'t mine, so the unit can\'t be replayed there', () => {
  let { g, atk, def } = attackSetup(['V(3)'], ['V(5)']);
  fundAll(g, P0, 8);
  for (let i = 0; i < 6 && !(pend(g).kind === 'showdownAction' && pend(g).player === P0 && !g.chain.length); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Arcane Shift') });
  let dests: string[] | null = null;
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    if (d.kind === 'chooseDestination') dests = o;
    g = choose(g, o.includes(atk[0]) ? atk[0] : o.includes(def[0]) ? def[0] : o.includes('base') ? 'base' : o[0]);
  }
  assert.ok(!dests || !dests.includes(String(BF_A)), `BF-A not offered (${dests})`);
  assert.equal(zone(g, atk[0]), 'base', 'replayed to base (the only legal destination)');
});

test('RJ#3435 Dragon\'s Rage moves an enemy into my Nine-Tailed Fox battlefield: the spell (and its reflexive part) fully resolves first; Fox\'s -1 applies only when the combat begins', () => {
  let g = S0(); fundAll(g, P0);
  setLegend(g, P0, 'Nine-Tailed Fox');
  const mine = put(g, P0, 'V(4)', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(4)', BF_B); control(g, BF_B, P1);
  put(g, P1, 'V(1)', BF_B);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, "Dragon's Rage") });
  const seen: number[] = [];
  for (let i = 0; i < 25 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g); const o = optionIds(g);
    if (g.chain.length && locOf(g, e) === BF_A) seen.push(mightOf(g, e)!);
    if (!d.inStep) { g = pass(g); continue; }
    g = choose(g, o.includes(e) ? e : o.includes(String(BF_A)) ? String(BF_A) : o[0]);
  }
  assert.ok(seen.length && seen.every(m => m === 4), `full Might while Dragon's Rage resolves (${seen})`);
  assert.equal(zone(g, e), 'trash', 'attacked at 3 into a 4');
  assert.equal(zone(g, mine), 'battlefield');
});

test('RJ#3436 Pack of Wonders\' [E] ability (no Reaction) can\'t be used in a showdown, only in my open main phase', () => {
  let g = S0();
  const pw = put(g, P0, 'Pack of Wonders', 'base');
  put(g, P0, 'V(1)', 'base');
  const can = (x: GameState) => legal(x, P0, 'activate').some(a => a.type === 'activate' && a.obj === pw);
  assert.ok(can(g));
  g = move(g, P0, [put(g, P0, 'V(1)', 'base')], BF_A);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = act(g, legal(g, pend(g).player)[0]);
  expectPending(g, 'showdownAction', P0);
  assert.ok(!can(g));
});

test('RJ#3440 Challenge at Void Gate: the units deal the damage, not the spell, so no Bonus Damage to my unit there', () => {
  let g = S0({ bfA: 'Void Gate' }); fundAll(g, P0);
  const mine = put(g, P0, 'V(6)', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(5)', BF_B); control(g, BF_B, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Challenge') });
  g = drive(g, h => { const o = optionIds(h); return o.includes(mine) ? [mine] : o.includes(e) ? [e] : null; });
  assert.equal(zone(g, e), 'trash');
  assert.equal(zone(g, mine), 'battlefield');
  assert.equal(g.objects[mine].damage, 5, 'exactly the enemy\'s Might (no +1)');
});

test('RJ#3444 Brazen Buccaneer can be played with only 4 energy by discarding a card (cost is determined while playing)', () => {
  let g = S0();
  setRunes(g, P0, 4, 'fury');
  const fodder = hand(g, P0, 'V(1)');
  const bb = hand(g, P0, 'Brazen Buccaneer');
  assert.ok(canPlayNow(g, P0, bb), 'offered with 4 energy');
  g = act(g, { type: 'playCard', player: P0, obj: bb, destination: 'base' });
  for (let i = 0; i < 8 && pend(g).inStep; i++) { const d = pend(g); const o = optionIds(g); g = choose(g, d.kind === 'optional' ? 'yes' : o.includes(fodder) ? fodder : o[0]); }
  g = settle(g);
  assert.equal(zone(g, bb), 'base');
  assert.equal(zone(g, fodder), 'trash');
});

test('RJ#3450 Opponent moves into an open battlefield; in the showdown I Zenith Blade (stun it, move my unit there): I conquer and score on their turn, then hold on mine', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0);
  const mine = put(g, P0, 'V(3)', 'base');
  const e = put(g, P1, 'V(2)', 'base');
  g = move(g, P1, [e], BF_A);
  for (let i = 0; i < 5 && !(pend(g).player === P0 && pend(g).kind === 'showdownAction'); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  expectPending(g, 'showdownAction', P0);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Zenith Blade') });
  g = drive(g, h => { const d = pend(h); const o = optionIds(h); return d.kind === 'optional' ? ['yes'] : o.includes(e) ? [e] : o.includes(mine) ? [mine] : null; });
  assert.equal(zone(g, e), 'trash', 'the stunned unit dealt nothing and died');
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[P0].points, 1, 'conquered on the opponent\'s turn');
  g = nextTurn(g);
  assert.equal(g.players[P0].points, 2, 'held on my turn');
});

test('RJ#3454 Showstopper can only choose a friendly unit in base', () => {
  let g = S0(); fundAll(g, P0);
  const atBf = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const b1 = put(g, P0, 'V(2)', 'base'), b2 = put(g, P0, 'V(2)', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Showstopper') });
  const o = optionIds(g);
  assert.ok(o.includes(b1) && o.includes(b2));
  assert.ok(!o.includes(atBf));
});

test('RJ#3460 Darius attacks, my 2nd card (Facebreaker) readies him (+2); he survives but loses the combat: recalled to base, still ready', () => {
  let g = S0(); fundAll(g, P0);
  g = play(g, P0, hand(g, P0, 'V(1)'), { dest: 'base' }); g = settle(g);
  const big = put(g, P1, 'V(8)', BF_A), small = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const dar = put(g, P0, 'ogn-027-298', 'base'), ally = put(g, P0, 'V(1)', 'base');
  g = move(g, P0, [dar, ally], BF_A);
  for (let i = 0; i < 6 && !(pend(g).kind === 'showdownAction' && pend(g).player === P0 && !g.chain.length); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(g.objects[dar].exhausted, true, 'exhausted by the move');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Facebreaker') });
  for (let i = 0; i < 6 && pend(g).inStep; i++) { const o = optionIds(g); g = choose(g, o.includes(ally) ? ally : o.includes(big) ? big : o[0]); }
  for (let i = 0; i < 6 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(mightOf(g, dar), 7);
  assert.equal(g.objects[dar].exhausted, false, 'readied by his trigger');
  g = drive(g, h => { const d = pend(h); if (d.kind === 'assignDamage') return null; return null; });
  assert.ok(zone(g, big) === 'battlefield', 'the stunned 8 survives');
  assert.equal(zone(g, dar), 'base', 'recalled');
  assert.equal(g.objects[dar].exhausted, false, 'recall keeps him ready');
});

test('RJ#3459 Eager Apprentice and Sky Splitter\'s own reduction stack: 8 - 3 (highest Might) - 1 = 4', () => {
  const g = S0(); fundAll(g, P0);
  put(g, P0, 'Eager Apprentice', BF_A); control(g, BF_A, P0);
  const ss = hand(g, P0, 'Sky Splitter');
  assert.equal(playCostOf(g, P0, ss)?.energy, 4);
});

// ENGINE-5: split — one Ezreal reducing the granted Repeat is unambiguous (the Repeat Temporal Portal grants is an optional
// additional cost; Portal now prices it with Repeat-cost modifications, context.ts grantedRepeatCost). Two Ezreals stacking
// on each Repeat ([0]) vs RJ's 4 (one reduction per Repeat) was AMBIGUOUS — decided by DECISIONS #3472 ([0] each; ENGINE-6).
const rj3472 = (cases: readonly (readonly [number, number])[]) => {
  for (const [n, total] of cases) {
    let g = S0(); fundAll(g, P0, 3); fundAll(g, P1);
    for (let i = 0; i < n; i++) put(g, P0, 'Ezreal, Prodigy', 'base');
    const tp = put(g, P0, 'Temporal Portal', 'base');
    g = settle(act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === tp)!));
    const u = putF(g, P0, 'rjf-selfplay', 'hand');
    g = act(g, { type: 'playCard', player: P0, obj: u, destination: 'base' });
    for (let i = 0; i < 4 && pend(g).inStep; i++) g = act(g, legal(g, pend(g).player)[0]);
    for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
    [g] = cast(g, P1, 'DrawR');
    for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
    const runes0 = readyRunes(g, P0);
    g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Hard Bargain') });
    let reps = 0;
    for (let i = 0; i < 8 && pend(g).inStep; i++) {
      const d = pend(g);
      if (d.kind === 'optional') { if (/repeat/i.test(d.prompt)) reps++; g = choose(g, 'yes'); continue; }
      g = choose(g, d.options![0].id);
    }
    assert.equal(reps, 2, 'two Repeat instances offered');
    assert.equal(runes0 - readyRunes(g, P0), total, `${n} Ezreal: total ${total}`);
  }};
test('RJ#3472 Ezreal, Prodigy also reduces the Repeat granted by Temporal Portal: Hard Bargain with both Repeats costs [2]+[1]+[1] with one Ezreal', () => rj3472([[1, 4]]));
// DECISIONS #3472: each Ezreal reduces every optional additional cost you pay, the granted Repeat included (RJ's 4 → MISMATCH-RJ).
test('RJ#3472 (DECISIONS #3472, MISMATCH-RJ) two Ezreals: Hard Bargain with both Repeats costs [2]+[0]+[0] (each Ezreal reduces each Repeat; RJ: 4)', () => rj3472([[2, 2]]));

test('RJ#3475 Thermo Beam ("Kill all gear") kills a face-up Zhonya\'s Hourglass in base, not a hidden one at a battlefield', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const up = put(g, P1, "Zhonya's Hourglass", 'base');
  const hid = put(g, P1, "Zhonya's Hourglass", { facedown: BF_A });
  [g] = cast(g, P0, 'Thermo Beam');
  g = settle(g);
  assert.equal(zone(g, up), 'trash');
  assert.equal(zone(g, hid), 'facedown');
});

test('RJ#3483 Singularity can\'t choose the same unit twice (no 12 damage): duplicates are rejected; one unit takes 6', () => {
  let g = S0(); fundAll(g, P0);
  const a = put(g, P1, 'V(9)', BF_A); put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Singularity') });
  expectPending(g, 'chooseTargets', P0);
  const dup = rejects(g, { type: 'choose', player: P0, optionIds: [a, a] });
  if (dup === null) {
    const h = settle(act(g, { type: 'choose', player: P0, optionIds: [a, a] }));
    assert.equal(h.objects[a].damage, 6, 'a duplicate choice counts once');
  }
  g = settle(choose(g, a));
  assert.equal(g.objects[a].damage, 6);
  assert.equal(zone(g, a), 'battlefield');
});

test('RJ#3489 Solari Shrine (no Reaction tag) still triggers on the opponent\'s turn when I kill a stunned enemy unit', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const sh = put(g, P0, 'Solari Shrine', 'base');
  const e = put(g, P1, 'V(2)', BF_A, { stunned: true }); control(g, BF_A, P1);
  [g] = cast(g, P1, 'DrawR');
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  const kr = putF(g, P0, 'rjf-killr', 'hand');
  const h0 = handN(g, P0);
  g = play(g, P0, kr, { targets: [[e]] });
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) { const d = pend(g); g = d.inStep ? (d.kind === 'optional' ? choose(g, 'yes') : act(g, legal(g, d.player)[0])) : pass(g); }
  assert.equal(zone(g, e), 'trash');
  assert.equal(g.objects[sh].exhausted, true, 'Shrine exhausted');
  assert.equal(handN(g, P0), h0 - 1 + 1, 'played the kill (-1), drew 1 (+1)');
});

test('RJ#3491 hidden Blastcone Fae played next to Ember Monk: order Blastcone on top, its -2 resolves (Monk 2), then Gust the Monk before its +2 resolves', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const m = put(g, P0, 'Ember Monk', BF_A); control(g, BF_A, P0);
  const bf = put(g, P0, 'Blastcone Fae', { facedown: BF_A });
  [g] = cast(g, P1, 'DrawR');
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  g = act(g, { type: 'playCard', player: P0, obj: bf });
  for (let i = 0; i < 6 && pend(g).inStep; i++) {
    const d = pend(g);
    if (d.kind === 'orderTriggers') { const monkFirst = d.options!.find(o => /Ember Monk/.test(o.label)) ?? d.options![0]; g = choose(g, monkFirst.id); continue; }
    g = choose(g, optionIds(g).includes(m) ? m : optionIds(g)[0]);
  }
  for (let i = 0; i < 6 && mightOf(g, m) !== 2; i++) g = pass(g);
  assert.equal(mightOf(g, m), 2, 'Blastcone\'s -2 resolved first');
  assert.ok(g.chain.some(c => /Ember Monk/.test(JSON.stringify(c))), 'Monk\'s +2 still on the chain');
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  g = settle(play(g, P0, hand(g, P0, 'Gust'), { targets: [[m]] }));
  assert.equal(zone(g, m), 'hand');
});

test('RJ#3495 Draven, Audacious with Svellsongur: Deflect 2; winning a combat scores 1 + 1 (copied text), conquering adds 1', () => {
  let g = S0();
  const d = put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const dr = put(g, P0, 'sfd-148-221', 'base');
  attachNow(g, put(g, P0, 'Svellsongur', 'base'), dr);
  assert.equal(kwValueOf(g, dr, 'Deflect'), 2);
  g = drive(move(g, P0, [dr], BF_A));
  assert.equal(zone(g, d), 'trash');
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[P0].points, 3);
});

test('RJ#3496 Fortified Position: Cannon Barrage in response to the defend trigger kills the 2-Might defender before it gains Shield 2', () => {
  let g = S0({ bfA: 'Fortified Position' }); fundAll(g, P0);
  const d = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(5)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 6 && !(g.chain.some(c => /Fortified/.test(JSON.stringify(c))) && !pend(g).inStep && pend(g).player === P0); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(g.chain.some(c => /Fortified/.test(JSON.stringify(c))), 'defend trigger on the chain');
  assert.equal(mightOf(g, d), 2);
  g = play(g, P0, hand(g, P0, 'Cannon Barrage'));
  for (let i = 0; i < 6 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(zone(g, d), 'trash');
});

test('RJ#3497 Here to Help ("a battlefield you control"): Perched Grimwyrm ("only to a battlefield you conquered this turn") is not a legal choice for a battlefield I merely hold', () => {
  let g = S0(); fundAll(g, P0, 12);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const pg = hand(g, P0, 'Perched Grimwyrm');
  const v = hand(g, P0, 'V(2)');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Here to Help') });
  const seen: string[][] = [];
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    if (o.includes(v)) seen.push(o);
    g = choose(g, o.includes(v) ? v : d.kind === 'optional' ? 'yes' : o.includes(String(BF_A)) ? String(BF_A) : o[0]);
  }
  assert.ok(seen.length, 'asked for a unit');
  for (const o of seen) assert.ok(!o.includes(pg), 'Grimwyrm not offered');
  assert.equal(zone(g, pg), 'hand');
  assert.equal(locOf(g, v), BF_A);
});

test('RJ#3502 Hextech Ray with only one rune (its own cost) can\'t choose an enemy Deflect unit: the Deflect tax must be payable', () => {
  let g = S0(); setRunes(g, P0, 1, 'fury');
  const df = put(g, P1, 'Deflect(3,1)', BF_A), plain = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const ray = hand(g, P0, 'Hextech Ray');
  assert.ok(canPlayNow(g, P0, ray), 'Ray itself is affordable');
  g = act(g, { type: 'playCard', player: P0, obj: ray });
  for (let i = 0; i < 4 && pend(g).inStep; i++) {
    const o = optionIds(g);
    if (o.includes(df)) assert.ok(rejects(g, { type: 'choose', player: P0, optionIds: [df] }) !== null, 'choosing the Deflect unit is rejected');
    g = choose(g, o.includes(plain) ? plain : o[0]);
  }
  g = settle(g);
  assert.equal(zone(g, plain), 'trash', 'the only affordable target (auto-chosen) took 3');
  assert.equal(g.objects[df].damage, 0);
});

test('RJ#3503 Yasuo, Remorseful attacking a lone enemy Deflect unit: his trigger asks for the Deflect cost; declining it removes the trigger, paying it deals the damage', () => {
  for (const payIt of [true, false]) {
    let g = S0(); fundAll(g, P0);
    const df = put(g, P1, 'Deflect(3,1)', BF_A); control(g, BF_A, P1);
    const y = put(g, P0, 'ogn-076-298', 'base');
    g = move(g, P0, [y], BF_A);
    let asked = false;
    for (let i = 0; i < 6 && pend(g).inStep && pend(g).player === P0; i++) {
      const d = pend(g);
      if (d.kind === 'optional') { if (/Deflect/.test(d.prompt)) asked = true; g = choose(g, payIt ? 'yes' : 'no'); continue; }
      g = choose(g, optionIds(g).includes(df) ? df : optionIds(g)[0]);
    }
    assert.ok(asked, 'Deflect cost offered');
    if (!payIt) { assert.ok(!chainLabels(g).some(x => /Yasuo/.test(x)), 'declined: trigger gone'); assert.ok(g.showdown?.isCombat); continue; }
    for (let i = 0; i < 6 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
    assert.equal(zone(g, df), 'trash', '6 damage dealt');
  }
});

test('RJ#3507 Traveling Merchant\'s move trigger resolves before the showdown: the opponent\'s Hextech Ray (Action) can\'t be played until then; killing him afterwards doesn\'t undo the loot', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const tm = put(g, P0, 'Traveling Merchant', 'base');
  hand(g, P0, 'V(1)');
  const ray = hand(g, P1, 'Hextech Ray');
  const h0 = handN(g, P0), tr0 = g.players[P0].trash.length;
  g = move(g, P0, [tm], BF_A);
  assert.ok(chainLabels(g).some(x => /Merchant/.test(x)), 'move trigger on the chain');
  for (let i = 0; i < 6 && g.chain.length; i++) {
    const d = pend(g);
    if (d.inStep) { g = act(g, legal(g, d.player)[0]); continue; }
    if (d.player === P1) assert.ok(!canPlayNow(g, P1, ray), 'Action can\'t respond to the trigger');
    g = pass(g);
  }
  assert.equal(g.players[P0].trash.length, tr0 + 1, 'discarded 1');
  assert.equal(handN(g, P0), h0, 'discard 1, draw 1');
  for (let i = 0; i < 4 && !(pend(g).kind === 'showdownAction' && pend(g).player === P1); i++) g = pass(g);
  assert.ok(canPlayNow(g, P1, ray), 'Ray playable in the showdown');
  g = settle(play(g, P1, ray, { targets: [[tm]] }));
  assert.equal(zone(g, tm), 'trash');
  assert.equal(handN(g, P0), h0);
});

test('RJ#3510 two Vi, Destructive: one recycle pays one activation; only the activated Vi gets +1', () => {
  let g = S0();
  const v1 = put(g, P0, 'ogn-036-298', 'base'), v2 = put(g, P0, 'ogn-036-298', 'base');
  fillTrash(g, P0, 1);
  const a = legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === v1)!;
  assert.ok(a, 'Vi can activate');
  g = settle(act(g, a));
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = settle(act(g, legal(g, pend(g).player)[0]));
  assert.equal(mightOf(g, v1), 4);
  assert.equal(mightOf(g, v2), 3);
});

test('RJ#3514 Retreat on my damaged 4-Might unit; the opponent\'s Stupefy (-1) in response kills it first: Retreat fizzles, no rune channelled', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P0, 'V(4)', 'base', { damage: 3 });
  const r0 = g.players[P0].runesInPlay.length;
  g = play(g, P0, hand(g, P0, 'Retreat'), { targets: [[u]] });
  for (let i = 0; i < 3 && !(pend(g).player === P1 && !pend(g).inStep); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  g = play(g, P1, hand(g, P1, 'Stupefy'), { targets: [[u]] });
  g = settle(g);
  assert.equal(zone(g, u), 'trash');
  assert.equal(g.players[P0].runesInPlay.length, r0, 'no rune channelled');
});

test('RJ#3518 Dragon\'s Rage moves a lone enemy unit to my battlefield: no other enemy there, nothing to choose; a combat follows with the moved unit\'s controller attacking', () => {
  let g = S0(); fundAll(g, P0, 4); fundAll(g, P1);
  const x = put(g, P1, 'V(3)', 'base');
  const mine = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  g = play(g, P0, hand(g, P0, "Dragon's Rage"), { targets: [[x]], locations: [BF_A] });
  for (let i = 0; i < 12 && g.chain.length; i++) {
    const d = pend(g);
    if (d.inStep) { const o = optionIds(g); assert.ok(!o.includes(mine), 'my unit is not an "enemy unit" choice'); g = choose(g, d.kind === 'chooseDestination' ? String(BF_A) : o[0]); continue; }
    g = pass(g);
  }
  assert.equal(locOf(g, x), BF_A);
  assert.equal(g.objects[x].damage, 0, 'no exchange');
  assert.ok(g.showdown?.isCombat, 'combat at my battlefield');
  assert.equal(g.showdown?.attacker, P1, 'the moved unit\'s controller attacks (CR 466.2.c.1)');
});

test('RJ#3522 the lone defender is killed in the combat showdown (no combat damage dealt): the combat cleanup still heals the attacker\'s earlier damage', () => {
  let g = S0(); fundAll(g, P0);
  const d = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(4)', 'base', { damage: 2 });
  const other = put(g, P1, 'V(5)', 'base', { damage: 1 });
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 6 && !(pend(g).kind === 'showdownAction' && pend(g).player === P0 && !g.chain.length); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(g.showdown?.isCombat);
  g = play(g, P0, putF(g, P0, 'rjf-killr', 'hand'), { targets: [[d]] });
  g = drive(g);
  assert.equal(g.activePlayer, P0, 'still my turn');
  assert.equal(zone(g, d), 'trash');
  assert.equal(g.battlefields[BF_A].controller, P0, 'conquered');
  assert.equal(g.objects[a].damage, 0, 'healed in the combat cleanup');
  assert.equal(g.objects[other].damage, 0, 'all units heal, not just combatants');
});

test('RJ#3527 a 3-Might attacker vs a stunned 5-Might defender: no damage to the attacker, the defender survives; tie → attacker recalled, defender keeps the battlefield; damage cleared', () => {
  let g = S0();
  const d = put(g, P1, 'V(5)', BF_A, { stunned: true }); control(g, BF_A, P1);
  const a = put(g, P0, 'V(3)', 'base');
  g = drive(move(g, P0, [a], BF_A));
  assert.equal(zone(g, d), 'battlefield');
  assert.equal(locOf(g, a), 'base', 'recalled');
  assert.equal(g.battlefields[BF_A].controller, P1);
  assert.equal(g.objects[d].damage, 0);
  assert.equal(g.objects[a].damage, 0);
});

test('RJ#3528 The Boss saves a buffed unit by spending its buff: it didn\'t die, so Vanguard Helm ("when a buffed friendly unit dies") gives no buff', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  setLegend(g, P0, 'The Boss');
  put(g, P0, 'Vanguard Helm', 'base');
  const u = put(g, P0, 'V(1)', 'base', { buff: true });
  const other = put(g, P0, 'V(2)', 'base');
  g = endTurn(g, P0);
  g = settle(g);
  [g] = cast(g, P1, 'ZapM', { targets: [[u]] });
  g = settle(g);
  g = answer(g, { may: [true] }, P0);
  g = settle(g);
  assert.equal(zone(g, u), 'base');
  assert.equal(g.objects[u].counters.buff ?? 0, 0, 'buff spent');
  assert.equal(g.objects[other].counters.buff ?? 0, 0, 'no Vanguard Helm buff');
});

// RJ#3529: RJ says the Deflect cost must be paid because Teemo's trigger is mandatory. PATCH-1: "Players can now refuse Deflect costs
// incurred by triggered abilities. This will result in the triggered ability failing to finalize on the chain." (DECISIONS #8074)
test('RJ#3529 (MISMATCH-RJ) Teemo, Strategist defending vs a lone Deadbloom Predator: the target is mandatory, but the Deflect cost may be refused — the trigger then fails to finalize', () => {
  for (const payIt of [true, false]) {
    let g = S0({ tp: P1 }); fundAll(g, P0);
    put(g, P0, 'Teemo, Strategist', BF_A); control(g, BF_A, P0);
    stackTop(g, P0, 'HidZap', 'V(1)', 'V(1)', 'V(1)', 'V(1)');
    const dp = put(g, P1, 'Deadbloom Predator', 'base');
    g = move(g, P1, [dp], BF_A);
    const before = readyRunes(g, P0);
    let asked = false;
    for (let i = 0; i < 6 && pend(g).inStep && pend(g).player === P0; i++) {
      const d = pend(g);
      if (d.kind === 'optional') { if (/Deflect/.test(d.prompt)) asked = true; g = choose(g, payIt ? 'yes' : 'no'); continue; }
      g = choose(g, optionIds(g).includes(dp) ? dp : optionIds(g)[0]);
    }
    assert.ok(asked, 'refusable Deflect cost offered');
    assert.equal(chainLabels(g).some(x => /Teemo/.test(x)), payIt);
    assert.equal(readyRunes(g, P0), payIt ? before - 1 : before);
  }
});

test('RJ#3532 Discipline\'s +2 lasts the whole turn: the unit survives combat with damage, is healed, and still has +2 afterwards', () => {
  let g = S0(); fundAll(g, P0);
  const a = put(g, P0, 'V(3)', 'base');
  [g] = cast(g, P0, 'Discipline', { targets: [[a]] });
  g = settle(g);
  assert.equal(mightOf(g, a), 5);
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  g = drive(move(g, P0, [a], BF_A));
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.objects[a].damage, 0, 'healed');
  assert.equal(mightOf(g, a), 5, 'still +2 this turn');
});

test('RJ#3537 Tideturner played to the location of Traveling Merchant can\'t swap with it ("a unit … at another location"): no move, no Merchant loot', () => {
  let g = S0(); fundAll(g, P0);
  const tm = put(g, P0, 'Traveling Merchant', 'base');
  hand(g, P0, 'V(1)');
  const tt = hand(g, P0, 'Tideturner');
  const h0 = handN(g, P0);
  g = act(g, { type: 'playCard', player: P0, obj: tt, destination: 'base' });
  for (let i = 0; i < 10 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    assert.ok(!optionIds(g).includes(tm), 'Merchant (same location) is not a choice');
    g = act(g, legal(g, d.player)[0]);
  }
  assert.equal(zone(g, tm), 'base');
  assert.equal(handN(g, P0), h0 - 1, 'only Tideturner left the hand; no discard/draw');
});

test('RJ#3541 a 1-Might unit at Trifarian War Camp (+1 → 2) hit by Thousand-Tailed Watcher (-3, min 1): ends at 1', () => {
  let g = S0({ bfA: 'Trifarian War Camp', tp: P1 }); fundAll(g, P1, 4);
  const t = put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  assert.equal(mightOf(g, t), 2);
  g = play(g, P1, hand(g, P1, 'Thousand-Tailed Watcher'), { dest: 'base' });
  if (pend(g).kind === 'optional') g = choose(g, 'no');
  g = settle(g);
  assert.equal(mightOf(g, t), 1);
});

test('RJ#3545 lethal damage counts marked damage: a 3-Might defender with 2 damage needs only 1 more; the rest (4) can go to the other defender — both die', () => {
  let g = S0();
  const d1 = put(g, P1, 'V(3)', BF_A, { damage: 2 }), d2 = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(5)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 12 && !(pend(g).kind === 'assignDamage' && pend(g).player === P0); i++) {
    const d = pend(g);
    if (d.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: d.player, assignment: (d.data as { suggested: Record<ObjId, number> }).suggested }); continue; }
    g = d.inStep ? choose(g, optionIds(g)[0]) : pass(g);
  }
  assert.equal(pend(g).kind, 'assignDamage');
  assert.equal(rejects(g, { type: 'assignDamage', player: P0, assignment: { [d1]: 1, [d2]: 4 } } as never), null, '1 is lethal for the damaged unit');
  g = settle(act(g, { type: 'assignDamage', player: P0, assignment: { [d1]: 1, [d2]: 4 } }));
  assert.equal(zone(g, d1), 'trash');
  assert.equal(zone(g, d2), 'trash');
});

test('RJ#3546 at 7 points with no battlefield, conquering one draws at once (not the winning point); conquering the other later that turn wins', () => {
  let g = S0(); fundAll(g, P0); g.players[P0].points = 7;
  const a = put(g, P0, 'V(2)', 'base'), b = put(g, P0, 'V(2)', 'base');
  const h0 = handN(g, P0);
  g = drive(move(g, P0, [a], BF_A));
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[P0].points, 7);
  assert.equal(handN(g, P0), h0 + 1, 'drew immediately');
  g = drive(move(g, P0, [b], BF_B));
  assert.equal(g.winner, P0, 'both battlefields scored this turn: the 8th point wins');
});

test('RJ#3557 Convergent Mutation on Ravenbloom Student (2) matching Teemo, Scout at 4 (after his +3 resolved): Mutation resolves first (4), then the Student\'s spell trigger (+1) → 5', () => {
  let g = S0(); fundAll(g, P0);
  const rb = put(g, P0, 'Ravenbloom Student', 'base');
  const tm = put(g, P0, 'ogn-197-298', 'base'); mod(g, tm, { might: 3 });
  assert.equal(mightOf(g, tm), 4);
  g = drive(play(g, P0, hand(g, P0, 'Convergent Mutation'), { targets: [[rb]] }), gg => gg.pending!.kind === 'chooseTargets' ? [tm] : null);
  assert.equal(mightOf(g, rb), 5);
  assert.equal(mightOf(g, tm), 4);
});

test('RJ#3559 Teemo, Strategist Gusted while his defend trigger is on the chain: it still resolves — the top 5 are revealed and recycled, but no damage is dealt ("here" is gone)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const t = put(g, P0, 'Teemo, Strategist', BF_A); control(g, BF_A, P0);
  const top = stackTop(g, P0, 'HidZap', 'V(1)', 'V(1)', 'V(1)', 'V(1)');
  const a = put(g, P1, 'V(5)', 'base');
  g = move(g, P1, [a], BF_A);
  for (let i = 0; i < 6 && pend(g).inStep; i++) g = act(g, legal(g, pend(g).player)[0]);
  assert.ok(chainLabels(g).some(x => /Teemo/.test(x)));
  for (let i = 0; i < 4 && pend(g).player !== P1; i++) g = pass(g);
  g = settle(play(g, P1, hand(g, P1, 'Gust'), { targets: [[t]] }));
  assert.equal(zone(g, t), 'hand');
  assert.equal(g.objects[a].damage, 0, 'no damage');
  const md = g.players[P0].mainDeck;
  assert.ok(md.indexOf(top[0]) >= md.length - 5, 'revealed cards recycled to the bottom');
});

test('RJ#3562 both at 7 with empty decks, I play Invert Timelines: I draw (burn out) first — with nothing to reshuffle my burn outs repeat and the opponent wins; with a discarded hand to reshuffle each burns out once → 8–8, play continues (CR 432.3, 194.2)', () => {
  for (const withHands of [false, true]) {
    let g = S0(); fundAll(g, P0);
    for (const p of [P0, P1]) { g.players[p].points = 7; clearDeck(g, p); clearTrash(g, p); for (const id of g.players[p].hand) delete g.objects[id]; g.players[p].hand = []; }
    if (withHands) for (const p of [P0, P1]) for (let i = 0; i < 4; i++) hand(g, p, 'V(1)');
    g = settle(play(g, P0, hand(g, P0, 'Invert Timelines')));
    if (!withHands) { assert.equal(g.winner, P1, 'the caster burns out repeatedly: the opponent wins'); continue; }
    assert.equal(g.players[P0].points, 8);
    assert.equal(g.players[P1].points, 8);
    assert.equal(g.winner ?? null, null, 'tied: no winner yet');
  }
});

test('RJ#3571 Harnessed Dragon killed in response to its play trigger: the trigger still kills the chosen enemy unit', () => {
  let g = S0(); fundAll(g, P0, 4); fundAll(g, P1);
  const e = put(g, P1, 'V(3)', 'base');
  const hd = hand(g, P0, 'Harnessed Dragon');
  g = act(g, { type: 'playCard', player: P0, obj: hd, destination: 'base' });
  for (let i = 0; i < 6 && pend(g).inStep; i++) { const d = pend(g); g = d.kind === 'optional' ? choose(g, 'no') : choose(g, optionIds(g).includes(e) ? e : optionIds(g)[0]); }
  for (let i = 0; i < 4 && !(pend(g).player === P1 && !pend(g).inStep && chainLabels(g).some(x => /trigger:Harnessed/.test(x))); i++) g = pass(g);
  assert.ok(chainLabels(g).some(x => /trigger:Harnessed/.test(x)), 'play trigger on the chain');
  g = settle(play(g, P1, putF(g, P1, 'rjf-killr', 'hand'), { targets: [[hd]] }));
  assert.equal(zone(g, hd), 'trash');
  assert.equal(zone(g, e), 'trash', 'the kill still happens');
});

test('RJ#3573 Dragon\'s Rage: one of the two units is killed before the "do this" exchange resolves — the survivor takes no damage', () => {
  let g = S0(); fundAll(g, P0, 4); fundAll(g, P1);
  const x = put(g, P1, 'V(3)', 'base');
  const y = put(g, P1, 'V(4)', BF_A); control(g, BF_A, P1);
  g = play(g, P0, hand(g, P0, "Dragon's Rage"), { targets: [[x]], locations: [BF_A] });
  for (let i = 0; i < 10 && !(g.chain.length && !pend(g).inStep && pend(g).player === P1 && locOf(g, x) === BF_A); i++) {
    const d = pend(g);
    if (d.inStep) { const o = optionIds(g); g = choose(g, o.includes(y) ? y : d.kind === 'chooseDestination' ? String(BF_A) : o[0]); continue; }
    g = pass(g);
  }
  assert.equal(locOf(g, x), BF_A, 'moved; the exchange is on the chain');
  g = settle(play(g, P1, putF(g, P1, 'rjf-killr', 'hand'), { targets: [[x]] }));
  assert.equal(zone(g, x), 'trash');
  assert.equal(g.objects[y].damage, 0, 'a unit no longer on the board deals no damage');
});

test('RJ#3576 floating energy in the rune pool persists through a combat (and its special cleanup) until the end of the turn', () => {
  let g = S0();
  g.players[P0].pool.energy = 2; g.timestamp++;
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  g = drive(move(g, P0, [put(g, P0, 'V(3)', 'base')], BF_A));
  assert.equal(g.battlefields[BF_A].controller, P0, 'combat happened');
  assert.equal(g.activePlayer, P0);
  assert.equal(g.players[P0].pool.energy, 2, 'still floating');
});

test('RJ#3578 "4+" means 4 or more: Might of Demacia ("if you have 4+ units at that battlefield, draw 2") draws with 5 units too', () => {
  for (const n of [3, 4, 5]) {
    let g = S0(); setLegend(g, P0, 'Might of Demacia');
    const us: ObjId[] = []; for (let i = 0; i < n; i++) us.push(put(g, P0, 'V(1)', 'base'));
    const h0 = handN(g, P0);
    g = drive(move(g, P0, us, BF_A), gg => (pend(gg).kind === 'optional' ? ['yes'] : null));
    assert.equal(g.battlefields[BF_A].controller, P0);
    assert.equal(handN(g, P0), h0 + (n >= 4 ? 2 : 0), `${n} units`);
  }
});

test('RJ#3581 a stunned unit moving into an empty battlefield still conquers it (stun only stops combat damage)', () => {
  let g = S0();
  const u = put(g, P0, 'V(2)', 'base', { stunned: true });
  g = drive(move(g, P0, [u], BF_A));
  assert.equal(locOf(g, u), BF_A);
  assert.equal(g.battlefields[BF_A].controller, P0);
});

test('RJ#3589 Nine-Tailed Fox triggers once per attacking unit: two attackers each get -1', () => {
  let g = S0(); setLegend(g, P1, 'Nine-Tailed Fox');
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const a1 = put(g, P0, 'V(3)', 'base'), a2 = put(g, P0, 'V(4)', 'base');
  g = move(g, P0, [a1, a2], BF_A);
  for (let i = 0; i < 10 && (g.chain.length || pend(g).inStep); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(mightOf(g, a1), 2);
  assert.equal(mightOf(g, a2), 3);
});

test('RJ#3590 after moving my only unit away from a battlefield I held, I lose it and can\'t play a unit there', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const nu = hand(g, P0, 'V(2)');
  assert.ok(playDests(g, P0, nu).includes(BF_A), 'playable there while held');
  g = drive(move(g, P0, [u], 'base'));
  assert.equal(g.battlefields[BF_A].controller ?? null, null, 'control lost');
  assert.ok(!playDests(g, P0, nu).includes(BF_A));
});

test('RJ#3594 Reaver\'s Row moving defending Miss Fortune, Captain to base is her first move this turn: she may ready something else', () => {
  let g = S0({ bfA: "Reaver's Row", tp: P1 });
  const mf = put(g, P0, 'ogn-162-298', BF_A); control(g, BF_A, P0);
  const ex = put(g, P0, 'V(1)', 'base', { ready: false });
  const a = put(g, P1, 'V(2)', 'base');
  g = move(g, P1, [a], BF_A);
  let readyAsked = false;
  for (let i = 0; i < 30 && !(zone(g, mf) === 'base' && !g.chain.length && !pend(g).inStep); i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    if (d.kind === 'optional') { g = choose(g, 'yes'); continue; }
    if (o.includes(ex)) { readyAsked = true; g = choose(g, ex); continue; }
    g = choose(g, o.includes(mf) ? mf : o[0]);
  }
  assert.equal(zone(g, mf), 'base', 'moved by the Row');
  assert.ok(readyAsked, 'her first-move trigger offered a ready');
  assert.equal(g.objects[ex].exhausted, false);
});

const rj3600 = (cases: readonly (readonly [number, number])[]) => {
  for (const [n, cost] of cases) {
    const g = S0(); fundAll(g, P0);
    for (let i = 0; i < n; i++) put(g, P0, 'Herald of Scales', 'base');
    const d = hand(g, P0, 'Eclipse Dragon');
    assert.equal(playCostOf(g, P0, d)?.energy, cost, `${n} Heralds`);
  }
};
test('RJ#3600 three Herald of Scales stack: a Dragon\'s Energy cost is reduced by [2] per copy (8 → 6 with one, → 2 with three)', () => rj3600([[1, 6], [3, 2]]));
test('RJ#3600b four Herald of Scales: each reduction is "to a minimum of [1]" — Eclipse Dragon costs [1], not [0]', () => rj3600([[4, 1]]));

test('RJ#3603 Convergent Mutation\'s template unit killed in response: the spell resolves without effect', () => {
  for (const kill of [false, true]) {
    let g = S0(); fundAll(g, P0); fundAll(g, P1);
    const tgt = put(g, P0, 'V(2)', 'base'), tpl = put(g, P0, 'V(5)', 'base');
    g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Convergent Mutation') });
    for (let i = 0; i < 4 && pend(g).inStep; i++) { const o = optionIds(g); g = choose(g, i === 0 && o.includes(tgt) ? tgt : o.includes(tpl) ? tpl : o[0]); }
    for (let i = 0; i < 3 && !(pend(g).player === P1 && !pend(g).inStep); i++) g = pass(g);
    if (kill) g = play(g, P1, putF(g, P1, 'rjf-killr', 'hand'), { targets: [[tpl]] });
    g = settle(g);
    assert.equal(mightOf(g, tgt), kill ? 2 : 5, kill ? 'no Might value to copy' : 'control: copies 5');
  }
});

test('RJ#3604 Strike Down: Angle Shot detaches the unit\'s only Equipment in response — it is no longer "an equipped friendly unit", no damage', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const wa = put(g, P0, "Warmog's Armor", 'base'); attachNow(g, wa, u);
  const e = put(g, P1, 'V(9)', BF_B); control(g, BF_B, P1);
  [g] = cast(g, P0, 'Strike Down', { targets: [[u], [e]] });
  for (let i = 0; i < 3 && !(pend(g).player === P1 && !pend(g).inStep); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Angle Shot') });
  for (let i = 0; i < 6 && pend(g).inStep; i++) { const o = optionIds(g); g = choose(g, o.includes(u) ? u : o.includes(wa) ? wa : o.find(x => /detach/i.test(x)) ?? o[o.length - 1]); }
  for (let i = 0; i < 6 && g.objects[wa].attachedTo; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(g.objects[wa].attachedTo, undefined, 'detached by Angle Shot');
  g = settle(g);
  assert.equal(g.objects[e].damage, 0, 'Strike Down deals nothing');
});

test('RJ#3609 on the opponent\'s turn, with focus in their combat showdown I may play an Action (Hextech Ray) but not a plain spell (Super Mega Death Rocket!)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const a = put(g, P1, 'V(4)', 'base');
  const ray = hand(g, P0, 'Hextech Ray'), smdr = hand(g, P0, 'Super Mega Death Rocket!');
  g = move(g, P1, [a], BF_A);
  for (let i = 0; i < 8 && !(pend(g).kind === 'showdownAction' && pend(g).player === P0 && !g.chain.length); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(pend(g).kind, 'showdownAction');
  assert.ok(canPlayNow(g, P0, ray), 'Action with focus');
  assert.ok(!canPlayNow(g, P0, smdr), 'no-keyword spell: own turn, outside showdowns only');
});

test('RJ#3611 Wuju Bladesman\'s +2 (passive) on a lone defending Stalwart Poro ends as soon as a hidden Pakaa Cub is played there (no longer alone)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0);
  setLegend(g, P0, 'Wuju Bladesman');
  const po = put(g, P0, 'Stalwart Poro', BF_A); control(g, BF_A, P0);
  const cub = put(g, P0, 'Pakaa Cub', { facedown: BF_A });
  const base = mightOf(g, po)!;
  g = move(g, P1, [put(g, P1, 'V(9)', 'base')], BF_A);
  for (let i = 0; i < 8 && !(pend(g).kind === 'showdownAction' && pend(g).player === P0 && !g.chain.length) && !(pend(g).player === P0 && !pend(g).inStep); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  const alone = mightOf(g, po)!;
  assert.ok(alone >= base + 2, `+2 while defending alone (${base} → ${alone})`);
  g = act(g, { type: 'playCard', player: P0, obj: cub });
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = act(g, legal(g, pend(g).player)[0]);
  assert.equal(locOf(g, cub), BF_A);
  assert.equal(mightOf(g, po), alone - 2, 'not alone any more: +2 gone at once');
});

test('RJ#3613 Guerilla Warfare: the trash cards to return are chosen when it is played (before anyone can respond); with none in the trash it is still playable ("up to")', () => {
  let g = S0(); fundAll(g, P0);
  const h1 = put(g, P0, 'Pakaa Cub', 'trash'), h2 = put(g, P0, 'HidZap', 'trash');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Guerilla Warfare') });
  const d = pend(g);
  assert.ok(d.inStep && d.player === P0, 'choice during the play');
  assert.ok(optionIds(g).includes(h1) && optionIds(g).includes(h2));
  g = settle(act(g, { type: 'choose', player: P0, optionIds: [h1, h2] }));
  assert.equal(zone(g, h1), 'hand'); assert.equal(zone(g, h2), 'hand');
  const k = S0(); fundAll(k, P0);
  assert.ok(canPlayNow(k, P0, hand(k, P0, 'Guerilla Warfare')), 'playable with no Hidden card in the trash');
});

// RJ#3615: main answer (the Sand Soldier is played to the Dais) MATCH. RJ's aside ("you lose control in the cleanup, a showdown
// follows, you retake it without conquering") → MISMATCH-RJ per DECISIONS #4383/#8134: while the Dais trigger and the token's play
// are on the chain the turn is Closed (CR 309.1), so control is never lost (CR 323.5).
test('RJ#3615 Emperor\'s Dais: returning my only unit there for the cost, the Sand Soldier is still played to the Dais; I keep control, 1 conquer point only', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  setBattlefieldCard(g, BF_A, "Emperor's Dais");
  const u = put(g, P0, 'V(2)', 'base');
  g = driveAns(move(g, P0, [u], BF_A), ['yes', [u]]);
  assert.ok(g.players[P0].hand.includes(u), 'returned for the cost');
  assert.deepEqual(unitsNamed(g, 'Sand Soldier').map(s => locOf(g, s)), [BF_A]);
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[P0].points, 1, 'no second conquer');
});

// RJ#3618 (Immortal Phoenix situations). DECISIONS principle 3 (CR 429.5; OGN-FAQ "What does it mean to 'kill a unit with a spell?'").
const phoenixAfter = (setup: (g: GameState) => { g: GameState; pick: ObjId[] }) => {
  let g = S0(); fundAll(g, P0, 8);
  const ph = put(g, P0, 'Immortal Phoenix', 'trash');
  const r = setup(g); g = r.g;
  let offered = false;
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.inStep) {
      if (d.kind === 'optional') { if (/Phoenix|\[1\]/.test(d.prompt ?? '')) offered = true; g = choose(g, 'yes'); continue; }
      const o = optionIds(g); const p = r.pick.find(x => o.includes(x)); g = p ? choose(g, p) : choose(g, ...d.options!.slice(0, Math.max(d.min ?? 1, 1)).map(x => x.id)); continue;
    }
    g = pass(g);
  }
  return { g, triggered: offered || g.log.some(l => /Trigger: Immortal Phoenix/.test(l.text)), ph };
};
test('RJ#3618 (D) Stormbringer: its damage kills enemy units in the cleanup right after it resolves → Immortal Phoenix triggers', () => {
  const { triggered } = phoenixAfter(g => {
    const mine = put(g, P0, 'V(3)', 'base');
    put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
    return { g: act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Stormbringer') }), pick: [mine, String(BF_A) as ObjId] };
  });
  assert.ok(triggered);
});
test('RJ#3618 (E) Last Breath: the readied unit deals the damage (like Challenge) → no Phoenix trigger (OGN-FAQ; RJ "unclear")', () => {
  const { g, triggered } = phoenixAfter(g => {
    const mine = put(g, P0, 'V(5)', BF_A); control(g, BF_A, P0);
    const e = put(g, P1, 'V(2)', BF_B); control(g, BF_B, P1);
    return { g: act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Last Breath') }), pick: [mine, e] };
  });
  assert.ok(g.players[P1].trash.length >= 1, 'enemy killed');
  assert.ok(!triggered);
});
// (B) DECIDED by ADJUDICATOR-5 (DECISIONS #3618 B, MISMATCH-RJ — reverses the range agent's "RJ adopted"): the official FAQ attached
// to CR 429.5 lists "Another player is instructed to kill a unit by a spell you control (e.g., your Cull the Weak, if you don't kill
// any of your own units with it)" as NOT you killing a unit with a spell. CR 429.5.b names the spell, not the player; the player who
// performs the Kill is responsible (mirror of #4019). So my Cull the Weak with no unit of my own → no Phoenix trigger.
test('RJ#3618 (B, MISMATCH-RJ — official FAQ) my Cull the Weak with no unit of my own: the opponent kills theirs → not "you kill a unit with a spell", no Phoenix trigger', () => {
  const { g, triggered } = phoenixAfter(g => {
    const theirs = put(g, P1, 'V(1)', 'base');
    return { g: act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Cull the Weak') }), pick: [theirs] };
  });
  assert.ok(g.players[P1].trash.length >= 1, 'their unit died');
  assert.ok(!triggered, 'the opponent performed the kill — I did not kill a unit with a spell');
});

test('RJ#3620 Forgotten Monument before my third turn: no scoring at all, so Plundering Poro\'s "When I conquer" doesn\'t trigger (no Gold)', () => {
  for (const third of [false, true]) {
    let g = withTokens(S0({ bfA: 'Forgotten Monument' }));
    g.players[P0].turnsTaken = third ? 2 : 1; g.timestamp++;
    const pp = put(g, P0, 'Plundering Poro', 'base');
    g = drive(move(g, P0, [pp], BF_A));
    assert.equal(g.battlefields[BF_A].controller, P0, 'control gained');
    assert.equal(g.players[P0].points, third ? 1 : 0);
    const gold = Object.values(g.objects).filter(o => g.cards[o.cardId]?.name === 'Gold' && o.zone === 'base').length;
    assert.equal(gold, third ? 1 : 0, third ? 'third turn: conquer → Gold' : 'no Gold token');
  }
});

test('RJ#3629 Cull the Weak doesn\'t choose: killing my Irelia, Fervent with it fires no "When you choose me" trigger', () => {
  let g = S0(); fundAll(g, P0, 6);
  const ir = put(g, P0, 'sfd-057-221', 'base');
  put(g, P1, 'V(1)', 'base');
  [g] = cast(g, P0, 'Cull the Weak');
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.inStep) { const o = optionIds(g); g = choose(g, o.includes(ir) ? ir : o[0]); continue; }
    g = pass(g);
  }
  assert.equal(zone(g, ir), 'trash');
  assert.ok(!g.log.some(l => /Trigger: Irelia/.test(l.text)), 'no choose trigger');
});

test('RJ#3634 The Grand Plaza: Recruit tokens are units, so they count toward the 7+ units held there (win)', () => {
  let g = withTokens(S0({ tp: P1 })); setBattlefieldCard(g, BF_A, 'The Grand Plaza');
  for (let i = 0; i < 7; i++) put(g, P0, i < 4 ? 'Recruit' : 'V(1)', BF_A);
  control(g, BF_A, P0);
  g = drive(endTurn(g, P1));
  assert.equal(g.winner, P0, '4 Recruits + 3 other units = 7 units');
});

test('RJ#3637 Caitlyn (must be assigned combat damage last) given Tank: the assigning player picks which applies (CR 467.2.c.8)', () => {
  const g0 = S0({ tp: P0 });
  const cait = put(g0, P1, 'ogn-068-298', BF_A); const v = put(g0, P1, 'V(2)', BF_A); control(g0, BF_A, P1);
  mod(g0, cait, { addKeywords: ['Tank'], layer: 2 });
  const a = put(g0, P0, 'V(4)', 'base');
  let g = move(g0, P0, [a], BF_A);
  for (let i = 0; i < 30 && pend(g).kind !== 'assignDamage'; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(pend(g).kind, 'assignDamage'); assert.equal(pend(g).player, P0);
  const ok = (m: Record<ObjId, number>) => validateAction(g, { type: 'assignDamage', player: P0, assignment: m });
  assert.equal(ok({ [cait]: 3, [v]: 1 }), null, 'Caitlyn treated as Tank: lethal to her first');
  assert.equal(ok({ [v]: 2, [cait]: 2 }), null, 'Caitlyn treated as "last": lethal to the other unit first');
});

// RJ#3646 (aside MISMATCH-RJ): RJ says Falling Comet (whose 6 damage was marked earlier) is "responsible" for the kill when Stupefy
// later makes it lethal. CR 429.5.c attributes a cleanup kill to the spell that resolved immediately before and dealt the damage; the
// OGN-FAQ excludes "marking damage with a spell, then the unit dying later in the turn" (DECISIONS principle 3). Neither counts.
test('RJ#3646 7-Might unit with 6 damage (my earlier Falling Comet) dies when Stupefy makes it 6; neither spell "killed it" — no Immortal Phoenix trigger', () => {
  let g = S0(); fundAll(g, P0, 12);
  const e = put(g, P1, 'V(7)', BF_A); control(g, BF_A, P1);
  const ph = put(g, P0, 'Immortal Phoenix', 'trash');
  g = settle(play(g, P0, hand(g, P0, 'Falling Comet'), { targets: [[e]] }));
  assert.equal(g.objects[e].damage, 6); assert.equal(zone(g, e), 'battlefield');
  g = play(g, P0, hand(g, P0, 'Stupefy'), { targets: [[e]] });
  let offered = false;
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) { if (pend(g).kind === 'optional') { offered = true; g = choose(g, 'no'); continue; } g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g); }
  assert.equal(zone(g, e), 'trash', 'dies in the cleanup after Stupefy');
  assert.ok(!offered && !g.log.some(l => /Trigger: Immortal Phoenix/.test(l.text)), 'no Phoenix trigger');
  assert.equal(zone(g, ph), 'trash');
});

test('RJ#3652 Reinforce\'s [5] reduction is lost when the unit returns to hand (Pack of Wonders): replaying it costs its full Energy', () => {
  let g = S0(); fundAll(g, P0, 12);
  for (let i = 0; i < 4; i++) put(g, P0, 'V(1)', 'deckTop');
  const u = put(g, P0, 'V(5)', 'deckTop');
  const pw = put(g, P0, 'Pack of Wonders', 'base');
  g = play(g, P0, hand(g, P0, 'Reinforce'));
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const p = pend(g);
    if (!p.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    g = o.includes(u) ? choose(g, u) : p.kind === 'optional' ? choose(g, 'yes') : o.includes('base') ? choose(g, 'base') : act(g, legal(g, p.player)[0]);
  }
  assert.equal(zone(g, u), 'base', 'played by Reinforce');
  g = act(g, { type: 'activate', player: P0, obj: pw, abilityIndex: 0 });
  if (pend(g).kind === 'chooseTargets') g = choose(g, u);
  g = settle(g);
  assert.equal(zone(g, u), 'hand');
  assert.equal(playCostOf(g, P0, u)?.energy, 5, 'normal cost from hand');
});

test('RJ#3658 Tryndamere, Barbarian moving to an empty battlefield conquers without an attack: only the conquer point', () => {
  let g = S0();
  const t = put(g, P0, 'ogn-034-298', 'base');
  g = drive(move(g, P0, [t], BF_A));
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[P0].points, 1, 'no bonus point (no attack, no excess damage)');
});

test('RJ#3680 hidden Here to Help plays Ember Monk: the Monk enters after Here to Help\'s play completed, so he gets no +2 for it', () => {
  let g = S0(); fundAll(g, P0, 8);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const hth = put(g, P0, 'Here to Help', { facedown: BF_A });
  const monk = hand(g, P0, 'Ember Monk');
  g = act(g, { type: 'playCard', player: P0, obj: hth });
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    if (d.kind === 'optional') { g = choose(g, 'yes'); continue; }
    const ids = optionIds(g);
    g = ids.includes(monk) ? choose(g, monk) : ids.includes(String(BF_A)) ? choose(g, String(BF_A)) : act(g, legal(g, d.player)[0]);
  }
  assert.equal(locOf(g, monk), BF_A, 'Ember Monk played to the battlefield');
  assert.equal(mightOf(g, monk), 4, 'no +2');
});

// RJ#3694: CR 322 "If an event occurs during a Cleanup that qualifies for a Cleanup, another Cleanup will occur immediately after the
// first completes" (riftlens /rules/cleanups/, read 2026-11-26) — no chain item finalizes or resolves in between (CR 320), so Sett,
// Kingpin can't stay alive into a priority window once his buffed allies have died (RJ's "zombie until the chain resolves" → MISMATCH-RJ).
test('RJ#3694 Stormbringer (Volibear, Furious 9) kills Sett, Kingpin\'s buffed allies; Sett (10 → 7 with 9 damage) dies in the immediately repeated cleanup, before any window; the opponent still gets a window before Volibear conquers', () => {
  let g = S0(); fundAll(g, P0, 12);
  const s = put(g, P1, 'Sett, Kingpin', BF_A); control(g, BF_A, P1);
  const al = [0, 1, 2].map(() => put(g, P1, 'V(1)', BF_A));
  for (const x of [s, ...al]) g.objects[x].counters = { ...(g.objects[x].counters ?? {}), buff: 1 };
  g.ex.dirty = true; g.timestamp++;
  assert.equal(mightOf(g, s), 10);
  const v = put(g, P0, 'Volibear, Furious', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Stormbringer') });
  let p1Window = false, settAliveAtWindow = false;
  for (let i = 0; i < 40 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.inStep) { const o = optionIds(g); g = o.includes(v) ? choose(g, v) : o.includes(String(BF_A)) ? choose(g, String(BF_A)) : act(g, legal(g, d.player)[0]); continue; }
    if (d.player === P1 && locOf(g, v) === BF_A) { p1Window = true; if (zone(g, s) === 'battlefield') settAliveAtWindow = true; }
    g = pass(g);
  }
  assert.ok(p1Window, 'the opponent gets a window (e.g. for Hidden Blade) after Volibear arrives');
  assert.ok(!settAliveAtWindow, 'Sett is already dead by then');
  assert.equal(zone(g, s), 'trash');
  assert.equal(g.battlefields[BF_A].controller, P0); assert.equal(g.players[P0].points, 1);
});

test('RJ#3694b (DECISIONS #3694) Stormbringer + Volibear vs Sett, Kingpin: combat begins in the FIRST cleanup (CR 323.8/323.12, Sett still there), so Volibear\'s "When I attack" triggers; the repeated cleanup (CR 322) kills Sett before any priority; Volibear wins the combat and conquers', () => {
  let g = S0(); fundAll(g, P0, 12);
  const s = put(g, P1, 'Sett, Kingpin', BF_A); control(g, BF_A, P1);
  const al = [0, 1, 2].map(() => put(g, P1, 'V(1)', BF_A));
  for (const x of [s, ...al]) g.objects[x].counters = { ...(g.objects[x].counters ?? {}), buff: 1 };
  g.ex.dirty = true; g.timestamp++;
  const v = put(g, P0, 'Volibear, Furious', 'base');
  const n0 = g.log.length;
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Stormbringer') });
  let attackTrig = false, settAliveAtWindow = false;
  for (let i = 0; i < 40 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (chainLabels(g).some(x => /Volibear/.test(x))) { attackTrig = true; if (zone(g, s) === 'battlefield') settAliveAtWindow = true; }
    if (d.inStep) { const o = optionIds(g); g = o.includes(v) ? choose(g, v) : o.includes(String(BF_A)) ? choose(g, String(BF_A)) : act(g, legal(g, d.player)[0]); continue; }
    g = pass(g);
  }
  const lt = g.log.slice(n0).map(l => l.text).join('\n');
  assert.ok(attackTrig || /Resolving Volibear/.test(lt), 'Volibear\'s "When I attack" triggered');
  assert.ok(/Combat at BF-A/.test(lt), 'a combat (not a plain showdown) was fought');
  assert.ok(!settAliveAtWindow, 'Sett died in the repeated cleanup, before the trigger could be responded to');
  assert.equal(zone(g, s), 'trash');
  assert.equal(g.battlefields[BF_A].controller, P0); assert.equal(g.players[P0].points, 1);
});

test('RJ#3703 Void Gate works whoever controls it: my Icathian Rain on a unit at the opponent\'s Void Gate deals 6 × 3', () => {
  let g = S0(); fundAll(g, P0, 12); setBattlefieldCard(g, BF_A, 'Void Gate');
  const e = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1); mod(g, e, { might: 20, duration: 'permanent' });
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Icathian Rain, Kai\'Sa') });
  for (let n = 0; n < 10 && pend(g).inStep && pend(g).kind === 'chooseTargets'; n++) g = choose(g, e);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = act(g, legal(g, pend(g).player)[0]);
  g = drive(g);
  assert.equal(g.objects[e].damage, 18);
});

test('RJ#3717 Ahri, Inquisitive vs a lone Wielder of Water: Wielder is 4 (passive) when Ahri\'s -2 resolves → 2; Ahri wins whoever attacks', () => {
  for (const ahriAttacks of [true, false]) {
    const g0 = S0({ tp: P0 });
    const [atkCard, defCard] = ahriAttacks ? ['ogn-119-298', 'Wielder of Water'] : ['Wielder of Water', 'ogn-119-298'];
    const d = put(g0, P1, defCard, BF_A); control(g0, BF_A, P1);
    const a = put(g0, P0, atkCard, 'base');
    const ahri = ahriAttacks ? a : d, ww = ahriAttacks ? d : a;
    let g = move(g0, P0, [a], BF_A);
    for (let i = 0; i < 40 && pend(g).kind !== 'mainAction'; i++) {
      const p = pend(g);
      if (p.kind === 'assignDamage') { g = act(g, legal(g, p.player)[0]); continue; }
      if (p.inStep) { const o = optionIds(g); g = choose(g, o.includes(ww) ? ww : o[0]); continue; }
      g = pass(g);
    }
    assert.equal(zone(g, ww), 'trash', `Wielder dies (Ahri ${ahriAttacks ? 'attacks' : 'defends'})`);
    assert.equal(zone(g, ahri), 'battlefield', 'Ahri survives');
    assert.equal(g.objects[ahri].damage, 0, 'healed after combat');
  }
});

test('RJ#3720 Ahri, Inquisitive Gusted in response to her attack trigger: no "here" any more, the -2 does nothing', () => {
  let g = S0({ tp: P0 }); fundAll(g, P1);
  const d = put(g, P1, 'V(4)', BF_A); control(g, BF_A, P1);
  const ahri = put(g, P0, 'ogn-119-298', 'base');
  g = move(g, P0, [ahri], BF_A);
  for (let i = 0; i < 10 && !(g.chain.length && !pend(g).inStep && pend(g).player === P1); i++) g = pend(g).inStep ? choose(g, optionIds(g).includes(d) ? d : optionIds(g)[0]) : pass(g);
  assert.ok(g.chain.length, 'Ahri\'s attack trigger is on the chain');
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Gust') });
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) { const p = pend(g); if (p.kind === 'assignDamage') { g = act(g, legal(g, p.player)[0]); continue; } g = p.inStep ? choose(g, optionIds(g).includes(ahri) ? ahri : optionIds(g)[0]) : pass(g); }
  assert.equal(zone(g, ahri), 'hand');
  assert.equal(mightOf(g, d), 4, 'no -2');
});

test('RJ#3725 Angle Shot detaches Eye of the Herald in response to its granted move trigger: the trigger still resolves and the Recruit is played where the unit is', () => {
  let g = withTokens(S0()); fundAll(g, P1);
  const u = put(g, P0, 'V(2)', 'base');
  const eye = put(g, P0, 'Eye of the Herald', 'base');
  attachNow(g, eye, u);
  g = move(g, P0, [u], BF_A);
  for (let i = 0; i < 10 && !(g.chain.length && !pend(g).inStep && pend(g).player === P1); i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.ok(g.chain.length, 'the move trigger is on the chain');
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Angle Shot') });
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const p = pend(g);
    if (!p.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    g = o.includes(u) ? choose(g, u) : o.includes(eye) ? choose(g, eye) : p.options?.some(x => /detach/i.test(x.label)) ? choose(g, p.options!.find(x => /detach/i.test(x.label))!.id) : act(g, legal(g, p.player)[0]);
  }
  assert.notEqual(g.objects[eye].attachedTo, u, 'Eye detached');
  assert.equal(unitsNamed(g, 'Recruit').filter(id => locOf(g, id) === BF_A).length, 1, 'Recruit played at the unit\'s battlefield');
});

// RJ#3740 nuance MISMATCH-RJ: the leading "you may" of a trigger is decided when it is finalized; declining removes it (CR 383.3.a,
// DECISIONS principle 11) — RJ says a declined Soulgorger / Spectral Matron trigger still sits on the chain to be responded to.
test('RJ#3740 Spectral Matron with no unit in my trash: nothing goes on the chain; with one, declining also leaves nothing to respond to', () => {
  for (const withUnit of [false, true]) {
    let g = S0(); fundAll(g, P0, 8); clearTrash(g, P0);
    const v = withUnit ? put(g, P0, 'V(2)', 'trash') : null;
    g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Spectral Matron'), destination: 'base' } as never);
    if (withUnit) { assert.ok(pend(g).inStep && optionIds(g).includes(v!), 'the trash unit is offered'); g = act(g, { type: 'choose', player: P0, optionIds: [] }); }
    assert.equal(g.chain.length, 0, withUnit ? 'declined: trigger removed' : 'no legal unit: no trigger');
    assert.equal(pend(g).kind, 'mainAction');
    if (v) assert.equal(zone(g, v), 'trash');
  }
});

test('RJ#3744 Immortal Phoenix (Assault 2) attacks Reaver\'s Row; the lone defender is moved to base: Phoenix stays an attacker at 5, so Gust can\'t choose it; it conquers', () => {
  let g = S0({ bfA: "Reaver's Row" }); fundAll(g, P1);
  const ph = put(g, P0, 'Immortal Phoenix', 'base');
  const d = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const gust = hand(g, P1, 'Gust');
  g = move(g, P0, [ph], BF_A);
  let checked = false;
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const p = pend(g);
    if (p.kind === 'assignDamage') { g = act(g, legal(g, p.player)[0]); continue; }
    if (!p.inStep) {
      if (!checked && zone(g, d) === 'base' && p.player === P1) { checked = true; assert.equal(mightOf(g, ph), 5, 'still an attacker'); assert.equal(canPlayNow(g, P1, gust), false, 'Gust has no target'); }
      g = pass(g); continue;
    }
    g = choose(g, p.kind === 'optional' ? 'yes' : optionIds(g).includes(d) ? d : optionIds(g)[0]);
  }
  assert.ok(checked, 'the opponent had a window after the defender left');
  assert.equal(g.battlefields[BF_A].controller, P0);
});

test('RJ#3745 4-player FFA: only the last player in turn order channels a third rune on their first turn (CR 489.7)', () => {
  let g = createGame({ seed: 4, cardDb: fixtureDb(), mode: 'ffa', firstPlayer: P0, skipMulligan: true, battlefieldSelection: 'random', includeAllCards: true,
    players: [0, 1, 2, 3].map(i => ({ name: `P${i}`, deck: legalDeck({}, [0, 1, 2].map(k => `cf-bf-${'abcdef'[(i + k) % 6]}`)) })) } as never);
  const runes: number[] = [];
  for (let turn = 0; turn < 4; turn++) {
    for (let i = 0; i < 20 && g.pending?.kind !== 'mainAction'; i++) g = g.pending!.inStep ? act(g, legal(g, g.pending!.player)[0]) : act(g, { type: 'pass', player: g.pending!.player });
    const p = g.pending!.player as PlayerId;
    assert.equal(p, turn as PlayerId);
    runes.push(g.players[p].runesInPlay.length);
    g = endTurn(g, p);
  }
  assert.deepEqual(runes, [2, 2, 2, 3]);
});

test('RJ#3750 Pit Rookie Gusted in response to its play trigger: the chosen friendly unit is still buffed', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const f = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const pr = hand(g, P0, 'Pit Rookie');
  g = act(g, { type: 'playCard', player: P0, obj: pr, destination: BF_A } as never);
  for (let i = 0; i < 10 && !(g.chain.length && !pend(g).inStep && pend(g).player === P1); i++) g = pend(g).inStep ? choose(g, optionIds(g).includes(f) ? f : optionIds(g)[0]) : pass(g);
  assert.ok(g.chain.length, 'the buff trigger is on the chain');
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Gust') });
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) g = pend(g).inStep ? choose(g, optionIds(g).includes(pr) ? pr : optionIds(g)[0]) : pass(g);
  assert.equal(zone(g, pr), 'hand');
  assert.equal(g.objects[f].counters?.buff ?? 0, 1, 'buffed');
});

test('RJ#3768 Fortified Position\'s "When you defend here" triggers once per combat: Shen, Kinkou played in mid-combat gets no second trigger (Shield 2 only from his own text)', () => {
  let g = S0({ bfA: 'Fortified Position' }); fundAll(g, P1, 4);
  const d = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(6)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) g = pend(g).inStep ? choose(g, optionIds(g).includes(d) ? d : optionIds(g)[0]) : pass(g);
  assert.equal(mightOf(g, d), 4, 'the defender got Shield 2 from the opening trigger');
  if (pend(g).player !== P1) g = pass(g);
  const sh = hand(g, P1, 'Shen, Kinkou');
  g = play(g, P1, sh, { dest: BF_A });
  g = answer(g, { locations: [BF_A] }, P1);
  assert.equal(locOf(g, sh), BF_A);
  assert.ok(!g.chain.some(c => /Fortified/.test(JSON.stringify(c))), 'no new Fortified Position trigger');
  assert.equal(mightOf(g, sh), 5, '3 + his own Shield 2 only');
});

test('RJ#3784 Last Breath can choose an already-ready friendly unit: it still deals its Might to the enemy unit', () => {
  let g = S0(); fundAll(g, P0, 6);
  const f = put(g, P0, 'V(3)', 'base');
  const e = put(g, P1, 'V(4)', BF_A); control(g, BF_A, P1);
  assert.equal(g.objects[f].exhausted ?? false, false);
  g = play(g, P0, hand(g, P0, 'Last Breath'), { targets: [[f], [e]] });
  g = resolveChain(g);
  assert.equal(g.objects[e].damage, 3);
});

test('RJ#3789 Reinforce can play a unit costing more than [5]: Magma Wurm (8) costs 3 Energy + its Power', () => {
  const run = (funds: number) => {
    let g = S0(); fundAll(g, P0, funds);
    for (let i = 0; i < 4; i++) put(g, P0, 'V(1)', 'deckTop');
    const w = put(g, P0, 'Magma Wurm', 'deckTop');
    g = play(g, P0, hand(g, P0, 'Reinforce'));
    const before = g.players[P0].runesInPlay.filter(r => !g.objects[r].exhausted).length;
    const rIn = g.players[P0].runesInPlay.length;
    for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
      const p = pend(g);
      if (!p.inStep) { g = pass(g); continue; }
      const o = optionIds(g);
      g = o.includes(w) ? choose(g, w) : p.kind === 'optional' ? act(g, { type: 'choose', player: p.player, optionIds: [/recycle/i.test(p.prompt) ? 'no' : 'yes'] }) : o.includes('base') ? choose(g, 'base') : act(g, legal(g, p.player)[0]);
    }
    const after = g.players[P0].runesInPlay.filter(r => !g.objects[r].exhausted).length;
    return { zone: zone(g, w), exhausted: before - after, recycled: rIn - g.players[P0].runesInPlay.length };
  };
  const r = run(4);
  assert.equal(r.zone, 'base', 'Wurm played');
  assert.equal(r.exhausted, 3, '8 - 5 = 3 Energy paid');
  assert.equal(r.recycled, 1, 'its Power paid as normal');
});

test('RJ#3823 Imperial Decree also applies to a unit played after it resolved: damaged later that turn, it is killed', () => {
  let g = S0(); fundAll(g, P0, 15);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  g = settle(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Imperial Decree') } as never));
  const u = hand(g, P0, 'V(9)');
  g = settle(act(g, { type: 'playCard', player: P0, obj: u, destination: BF_A } as never));
  assert.equal(locOf(g, u), BF_A, 'played after the Decree');
  g = settle(play(g, P0, hand(g, P0, 'Hextech Ray'), { targets: [[u]] }));
  assert.equal(zone(g, u), 'trash', '3 damage on a 9-Might unit: killed by the Decree');
});

test('RJ#3872 Hostile Takeover chooses its unit: an enemy Ruin Runner can\'t be taken (unplayable with it as the only enemy unit at a battlefield)', () => {
  const g = S0(); fundAll(g, P0, 8);
  put(g, P1, 'Ruin Runner', BF_A); control(g, BF_A, P1);
  const ht = hand(g, P0, 'Hostile Takeover');
  assert.equal(canPlayNow(g, P0, ht), false);
  put(g, P1, 'V(2)', BF_A);
  assert.equal(canPlayNow(g, P0, ht), true, 'sanity: playable with another enemy unit there');
});

test('RJ#3873 Defy can counter Siphon Power ([2], one Power of its split Mind/Order cost)', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const sp = hand(g, P0, 'Siphon Power');
  g = play(g, P0, sp);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = choose(g, optionIds(g).includes(String(BF_A)) ? String(BF_A) : optionIds(g)[0]);
  assert.equal(zone(g, sp), 'chain');
  if (pend(g).player === P0) g = pass(g);
  const defy = hand(g, P1, 'Defy');
  assert.ok(canPlayNow(g, P1, defy), 'Defy legal against Siphon Power');
  g = settle(play(g, P1, defy, { targets: [[sp]] }));
  assert.equal(zone(g, sp), 'trash');
  assert.equal(mightOf(g, u), 2, 'countered: no +1');
});

test('RJ#3874 moving a unit to a battlefield I already control starts no showdown: I keep acting at once', () => {
  let g = S0();
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const u = put(g, P0, 'V(2)', 'base');
  const n = g.log.length;
  g = move(g, P0, [u], BF_A);
  assert.equal(locOf(g, u), BF_A);
  assert.equal(pend(g).kind, 'mainAction');
  assert.equal(pend(g).player, P0);
  assert.ok(!g.log.slice(n).some(l => /[Ss]howdown/.test(l.text)), 'no showdown');
});

test('RJ#3888 a controlled battlefield is not a base: Unforgiven (Yasuo legend, "to or from its base") can\'t move a unit from one battlefield to another', () => {
  let g = S0(); fundAll(g, P0);
  setLegend(g, P0, 'Unforgiven');
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const l = g.players[P0].legend;
  const ab = legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === l);
  assert.ok(ab, 'Unforgiven activatable');
  g = act(g, ab!);
  const seen: string[] = [];
  for (let i = 0; i < 8 && locOf(g, u) === BF_A; i++) {
    const e = pend(g);
    if (!e.inStep) { g = pass(g); continue; }
    const o = optionIds(g); seen.push(...o);
    if (o.includes(u)) { g = act(g, { type: 'choose', player: e.player, optionIds: [u] }); continue; }
    assert.ok(!o.includes(String(BF_B)), `no battlefield-to-battlefield destination (${o})`);
    g = act(g, { type: 'choose', player: e.player, optionIds: [o.includes('base') ? 'base' : o[0]] });
  }
  assert.ok(!seen.includes(String(BF_B)), `BF_B never offered (${seen})`);
  assert.equal(locOf(g, u), 'base', 'the only move is back to base');
});

test('RJ#3892 Nine-Tailed Fox (Ahri legend) triggers for each attacker, again for an enemy unit that joins the combat later (Ride the Wind in the showdown)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1);
  setLegend(g, P0, 'Nine-Tailed Fox');
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const a1 = put(g, P1, 'V(3)', 'base');
  const a2 = put(g, P1, 'V(4)', 'base');
  g = move(g, P1, [a1], BF_A);
  for (let i = 0; i < 8 && g.chain.length; i++) { const d = pend(g); g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g); }
  assert.equal(mightOf(g, a1), 2, 'first attacker -1');
  if (pend(g).player !== P1) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Ride the Wind'), { targets: [[a2]] });
  const sawA2 = () => locOf(g, a2) === BF_A;
  for (let i = 0; i < 16 && !(sawA2() && !g.chain.length); i++) {
    const d = pend(g);
    if (d.inStep) { const o = optionIds(g); g = act(g, { type: 'choose', player: d.player, optionIds: [o.includes(String(BF_A)) ? String(BF_A) : o[0]] }); continue; }
    g = pass(g);
  }
  assert.equal(locOf(g, a2), BF_A, 'joined the combat');
  assert.equal(mightOf(g, a2), 3, 'the Fox triggered for the unit that joined later');
});

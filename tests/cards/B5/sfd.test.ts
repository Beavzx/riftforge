// B5 tests: Spiritforged
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  game, mana, rich, run, answer, expectDecision, cast, play, canPlay, respond, toPriority, moveTo, dmg, handSize, M, put, handCard,
  zoneOf, setController, hasKw, noRunes, act, activate, pass,
} from './util.ts';

// ---------------- Detonate ----------------
test('Detonate: kill a gear; its controller draws 2', () => {
  let g = game(); rich(g, 0);
  const gear = put(g, 1, 'ts-gold', 'base');
  const h1 = handSize(g, 1);
  g = run(cast(g, 0, 'sfd-005-221').g);
  assert.equal(zoneOf(g, gear), 'trash');
  assert.equal(handSize(g, 1), h1 + 2);
});

// ---------------- Blast Corps Cadet ----------------
test('Blast Corps Cadet: pay [1][C] extra to deal 2 to a unit at a battlefield', () => {
  let g = game(); rich(g, 0);
  const e = put(g, 1, 't-u2', 0);
  g = run(cast(g, 0, 'sfd-013-221', { destination: 'base' }).g, 'yes');
  assert.equal(zoneOf(g, e), 'trash');
});
test('Blast Corps Cadet: not paid -> no trigger', () => {
  let g = game(); rich(g, 0);
  const e = put(g, 1, 't-u2', 0);
  g = run(cast(g, 0, 'sfd-013-221', { destination: 'base' }).g, 'no');
  assert.equal(dmg(g, e), 0);
});

// ---------------- Sudden Storm ----------------
test('Sudden Storm: 2 to a unit at a battlefield, 4 if it is attacking', () => {
  let g = game(); rich(g, 1);
  const atk = put(g, 0, 't-u4', 'base');
  const def = put(g, 1, 't-u1', 0);
  const ss = handCard(g, 1, 'sfd-017-221');
  g = moveTo(g, 0, [atk], 0);
  g = toPriority(g, 1);
  g = run(play(g, 1, ss), atk);
  assert.equal(zoneOf(g, atk), 'trash');
  void def;
  let g2 = game(); rich(g2, 0);
  const t = put(g2, 1, 't-u5', 0);
  g2 = run(cast(g2, 0, 'sfd-017-221').g);
  assert.equal(dmg(g2, t), 2);
});

// ---------------- Piercing Light ----------------
test('Piercing Light: 2 to a unit at a battlefield and 2 to up to one other unit; Repeat re-chooses', () => {
  let g = game(); rich(g, 0);
  const a = put(g, 1, 't-u2', 0), b = put(g, 1, 't-u2', 'base'), c = put(g, 1, 't-u2', 1), d = put(g, 1, 't-u2', 'base');
  g = play(g, 0, handCard(g, 0, 'sfd-023-221'));
  g = answer(g, a);
  const opts = expectDecision(g, 'chooseTargets', 0);
  assert.ok(!opts.includes(a), 'the second unit must be another unit');
  g = answer(g, b);
  expectDecision(g, 'optional', 0);                  // Repeat?
  g = run(g, 'yes', c, d);
  for (const u of [a, b, c, d]) assert.equal(zoneOf(g, u), 'trash');
});
test('Piercing Light: the second unit is optional', () => {
  let g = game(); rich(g, 0);
  const a = put(g, 1, 't-u3', 0), b = put(g, 1, 't-u3', 'base');
  g = run(cast(g, 0, 'sfd-023-221').g, [], 'no');   // a is the only unit at a battlefield (auto)
  assert.equal(dmg(g, a), 2);
  assert.equal(dmg(g, b), 0);
  assert.ok(hasKw(g, a, 'Repeat') === false);
});

// ---------------- Disarming Rake ----------------
test('Disarming Rake: when played, may kill a gear', () => {
  let g = game(); rich(g, 0);
  const gear = put(g, 1, 'ts-sword', 'base');
  g = run(cast(g, 0, 'sfd-032-221', { destination: 'base' }).g, 'yes');
  assert.equal(zoneOf(g, gear), 'trash');
  let g2 = game(); rich(g2, 0);
  const gear2 = put(g2, 1, 'ts-sword', 'base');
  g2 = run(cast(g2, 0, 'sfd-032-221', { destination: 'base' }).g, 'no');
  assert.equal(zoneOf(g2, gear2), 'base');
});

// ---------------- Not So Fast ----------------
test('Not So Fast: counters an enemy spell that chooses a friendly unit', () => {
  let g = game(); rich(g, 0); rich(g, 1);
  const mine = put(g, 1, 't-u4', 'base');
  const fs = handCard(g, 0, 'ogs-022-024');
  const nsf = handCard(g, 1, 'sfd-045-221');
  g = play(g, 0, fs);
  g = toPriority(g, 1);
  assert.equal(canPlay(g, 1, nsf), true);
  g = run(play(g, 1, nsf));
  assert.equal(zoneOf(g, mine), 'base');
  assert.equal(dmg(g, mine), 0);
});
test('Not So Fast: counters an enemy activated ability that chooses a friendly unit; not spells choosing enemies', () => {
  let g = game(); rich(g, 1); setController(g, 0, 0);
  const pinger = put(g, 0, 'ts-pinger', 0);
  const mine = put(g, 1, 't-u1', 1);
  const nsf = handCard(g, 1, 'sfd-045-221');
  g = activate(g, 0, pinger);
  if (g.pending?.kind === 'chooseTargets') g = answer(g, mine);
  g = toPriority(g, 1);
  g = run(play(g, 1, nsf));
  assert.equal(zoneOf(g, mine), 'battlefield');
  // a spell that only chooses P0's own unit can't be countered by P1's Not So Fast
  let g2 = game(); rich(g2, 0); rich(g2, 1);
  const own = put(g2, 0, 't-u4', 'base');
  const fs = handCard(g2, 0, 'ogs-022-024');
  const nsf2 = handCard(g2, 1, 'sfd-045-221');
  g2 = toPriority(play(g2, 0, fs), 1);
  assert.equal(canPlay(g2, 1, nsf2), false);
  void own;
});

// ---------------- Rocket Barrage ----------------
test('Rocket Barrage: deal 4 to a unit in a base or kill a gear; Repeat may choose the other', () => {
  let g = game(); rich(g, 0); mana(g, 0, 2, 'Mind');
  const u = put(g, 1, 't-u4', 'base'), gear = put(g, 1, 'ts-gold', 'base'), bfu = put(g, 1, 't-u1', 0);
  g = play(g, 0, handCard(g, 0, 'sfd-077-221'));
  const opts = expectDecision(g, 'chooseTargets', 0);
  assert.ok(opts.includes(u) && opts.includes(gear) && !opts.includes(bfu));
  g = run(g, u, 'yes', gear);
  assert.equal(zoneOf(g, u), 'trash');
  assert.equal(zoneOf(g, gear), 'trash');
});

// ---------------- Bellows Breath ----------------
test('Bellows Breath: 1 to up to three units at the same location; Repeat [1][C]', () => {
  let g = game(); rich(g, 0);
  const a = put(g, 1, 't-u1', 0), b = put(g, 1, 't-u1', 0), c = put(g, 1, 't-u1', 1), d = put(g, 1, 't-u2', 1);
  g = play(g, 0, handCard(g, 0, 'sfd-080-221'));
  assert.throws(() => act(g, { type: 'choose', player: 0, optionIds: [a, c] }), /same location/);
  g = run(g, [a, b], 'yes', [c, d]);
  assert.equal(zoneOf(g, a), 'trash'); assert.equal(zoneOf(g, b), 'trash'); assert.equal(zoneOf(g, c), 'trash');
  assert.equal(dmg(g, d), 1);
});

// ---------------- Marching Orders ----------------
test('Marching Orders: a friendly unit anywhere fights an enemy unit at a battlefield', () => {
  let g = game(); rich(g, 0);
  const f = put(g, 0, 't-u4', 'base'), e = put(g, 1, 't-u3', 0);
  put(g, 1, 't-u3', 'base');                         // base enemy not legal
  g = run(cast(g, 0, 'sfd-114-221').g, 'no');
  assert.equal(zoneOf(g, e), 'trash');
  assert.equal(dmg(g, f), 3);
});

// ---------------- Sivir, Ambitious ----------------
test('Sivir: conquering after an attack with 5+ excess damage lets her deal that much to an enemy unit', () => {
  let g = game();
  const s = put(g, 0, 'sfd-120-221', 'base');         // 7 Might
  const d = put(g, 1, 't-u1', 0);                     // 1 Might: 6 excess
  const other = put(g, 1, 't-u5', 'base');
  g = moveTo(g, 0, [s], 0);
  g = run(g);
  expectDecision(g, 'optional', 0);
  g = run(g, 'yes');
  assert.equal(zoneOf(g, d), 'trash');
  assert.equal(zoneOf(g, other), 'trash');            // 6 damage
  assert.equal(g.battlefields[0].controller, 0);
  assert.ok(hasKw(g, s, 'Deflect'));
});
test('Sivir: less than 5 excess -> no trigger', () => {
  let g = game();
  const s = put(g, 0, 'sfd-120-221', 'base');
  const d = put(g, 1, 't-u3', 0);                     // 4 excess
  const other = put(g, 1, 't-u5', 'base');
  g = run(moveTo(g, 0, [s], 0));
  assert.equal(zoneOf(g, d), 'trash');
  assert.equal(dmg(g, other), 0);
  assert.equal(g.battlefields[0].controller, 0);
});

// ---------------- Beast Below ----------------
test('Beast Below: returns another friendly unit and an enemy unit', () => {
  let g = game(); rich(g, 0);
  const f = put(g, 0, 't-u2', 0), e = put(g, 1, 't-u5', 1);
  const r = cast(g, 0, 'sfd-132-221', { destination: 'base' });
  g = run(r.g);
  assert.equal(zoneOf(g, f), 'hand');
  assert.equal(zoneOf(g, e), 'hand');
  assert.ok(g.players[1].hand.includes(e));
  assert.equal(zoneOf(g, r.id), 'base');
});

// ---------------- Factory Recall ----------------
test('Factory Recall: returns a gear to its owner\'s hand', () => {
  let g = game(); rich(g, 0);
  const gear = put(g, 1, 'ts-sword', 'base');
  g = run(cast(g, 0, 'sfd-135-221').g);
  assert.equal(zoneOf(g, gear), 'hand');
});

// ---------------- Hard Bargain ----------------
test("Hard Bargain: countered unless its controller pays [2]", () => {
  let g = game(); rich(g, 0); rich(g, 1);
  const t = put(g, 1, 't-u5', 0);
  const comet = handCard(g, 0, 'ogn-085-298');
  const hb = handCard(g, 1, 'sfd-136-221');
  g = respond(play(g, 0, comet), 1, hb);
  g = run(g, 'no');                                   // P1 declines Repeat
  expectDecision(g, 'optional', 0);                   // P0: pay [2]?
  g = run(g, 'no');
  assert.equal(dmg(g, t), 0);
  assert.equal(zoneOf(g, comet), 'trash');
});
test('Hard Bargain: paying [2] keeps the spell', () => {
  let g = game(); rich(g, 0); rich(g, 1);
  const t = put(g, 1, 't-u5', 0);
  const comet = handCard(g, 0, 'ogn-085-298');
  const hb = handCard(g, 1, 'sfd-136-221');
  g = run(respond(play(g, 0, comet), 1, hb), 'no', 'yes');
  assert.equal(zoneOf(g, t), 'trash');
});
test('Hard Bargain: no [2] available -> not even asked', () => {
  let g = game(); rich(g, 1);
  noRunes(g, 0); mana(g, 0, 5, 'Mind');
  const t = put(g, 1, 't-u5', 0);
  const comet = handCard(g, 0, 'ogn-085-298');
  const hb = handCard(g, 1, 'sfd-136-221');
  g = run(respond(play(g, 0, comet), 1, hb), 'no');
  assert.equal(dmg(g, t), 0);
});

// ---------------- Downwell ----------------
test('Downwell: returns all units and gear to their owners\' hands', () => {
  let g = game(); rich(g, 0); mana(g, 0, 2, 'Chaos');
  const a = put(g, 0, 't-u1', 'base'), b = put(g, 1, 't-u5', 0), c = put(g, 1, 'ts-sword', 'base');
  g = run(cast(g, 0, 'sfd-147-221').g);
  for (const x of [a, b, c]) assert.equal(zoneOf(g, x), 'hand');
});

// ---------------- Sandshifter ----------------
test('Sandshifter: kills an enemy unit with 3 Might or less', () => {
  let g = game(); rich(g, 0);
  const small = put(g, 1, 't-u3', 'base'); const big = put(g, 1, 't-u4', 'base');
  g = run(cast(g, 0, 'sfd-158-221', { destination: 'base' }).g);
  assert.equal(zoneOf(g, small), 'trash');
  assert.equal(zoneOf(g, big), 'base');
});

// ---------------- Zaun Punk ----------------
test('Zaun Punk: kill a friendly gear as an additional cost to kill a gear', () => {
  let g = game(); rich(g, 0);
  const mine = put(g, 0, 'ts-gold', 'base'), theirs = put(g, 1, 'ts-sword', 'base');
  g = run(cast(g, 0, 'sfd-160-221', { destination: 'base' }).g, 'yes');
  assert.equal(zoneOf(g, mine), 'trash');
  assert.equal(zoneOf(g, theirs), 'trash');           // only gear left: auto-chosen
});
test('Zaun Punk: not paid -> nothing', () => {
  let g = game(); rich(g, 0);
  const mine = put(g, 0, 'ts-gold', 'base'), theirs = put(g, 1, 'ts-sword', 'base');
  g = run(cast(g, 0, 'sfd-160-221', { destination: 'base' }).g, 'no');
  assert.equal(zoneOf(g, mine), 'base');
  assert.equal(zoneOf(g, theirs), 'base');
});

// ---------------- Deathgrip ----------------
test('Deathgrip: kill a friendly unit; another friendly unit gets its Might; draw 1', () => {
  let g = game(); rich(g, 0);
  const k = put(g, 0, 't-u4', 'base'), o = put(g, 0, 't-u2', 'base');
  const h = handSize(g, 0);
  g = play(g, 0, handCard(g, 0, 'sfd-163-221'));
  g = answer(g, k);                                   // then o is the only other friendly unit
  g = run(g);
  assert.equal(zoneOf(g, k), 'trash');
  assert.equal(M(g, o), 6);
  assert.equal(handSize(g, 0), h + 1);
});
// RULINGS (docs/rulings.md, R-5): "another friendly unit" is a mandatory target chosen as it is played (CR 355.5); with no legal
// choice the play fails the legality check (CR 355.17, 358.1, 358.5). SFD-FAQ Janna, Savior: errata to "up to one" "so the heal
// works without enemies present" — i.e. a missing mandatory target stops the whole card. Best call (no Deathgrip-specific ruling).
test('Deathgrip: with a single friendly unit it can\'t be played (no other friendly unit to choose)', () => {
  const g = game(); rich(g, 0);
  const k = put(g, 0, 't-u4', 'base');
  const d = handCard(g, 0, 'sfd-163-221');
  // F-3a: target groups are checked jointly, so it isn't even offered
  assert.equal(canPlay(g, 0, d), false);
  assert.equal(zoneOf(g, k), 'base');
});

// ---------------- Drag Under ----------------
test('Drag Under: costs [2] less when played from somewhere other than the hand', () => {
  let g = game();
  noRunes(g, 0); mana(g, 0, 3, 'Order');              // 3 energy + Order: enough only with the discount
  const e = put(g, 1, 't-u5', 0);
  const inHand = handCard(g, 0, 'sfd-164-221');
  assert.equal(canPlay(g, 0, inHand), false);
  const inTrash = put(g, 0, 'sfd-164-221', 'trash');
  g.ex.playPermissions.push({ obj: inTrash, epoch: g.objects[inTrash].epoch ?? 0, player: 0, until: 'endOfTurn', turn: g.turn });
  assert.equal(canPlay(g, 0, inTrash), true);
  g = run(play(g, 0, inTrash));
  assert.equal(zoneOf(g, e), 'trash');
});

// ---------------- Arcane Shift ----------------
test('Arcane Shift: banish a friendly unit, its owner replays it for free; 3 to an enemy at a battlefield; banish this', () => {
  let g = game(); rich(g, 0);
  const f = put(g, 0, 'ogn-092-298', 'base', { ready: false });   // Riptide Rex: replaying it triggers again
  const e = put(g, 1, 't-u3', 1), e2 = put(g, 1, 't-u5', 0);
  const r = cast(g, 0, 'sfd-200-221');
  // enemy at a battlefield: e. Rex's play trigger is finalized after the cleanup (R-16, CR 334.2): e is already dead,
  // so e2 is its only legal target and is chosen automatically
  g = run(r.g, e);
  // Riptide Rex play trigger: 6 to an enemy unit at a battlefield (e is dead, e2 remains)
  assert.equal(zoneOf(g, f), 'base');
  assert.equal(zoneOf(g, e), 'trash');
  assert.equal(zoneOf(g, e2), 'trash');
  assert.equal(zoneOf(g, r.id), 'banishment');
});

// ---------------- Riposte ----------------
test('Riposte: counter a spell and give a friendly unit +Might equal to its Energy cost', () => {
  let g = game(); rich(g, 0); rich(g, 1);
  const f = put(g, 1, 't-u2', 'base');
  const comet = handCard(g, 0, 'ogn-085-298');        // 5 energy
  const t = put(g, 1, 't-u3', 0);
  const rp = handCard(g, 1, 'sfd-206-221');
  g = run(respond(play(g, 0, comet), 1, rp), f);
  assert.equal(dmg(g, t), 0);
  assert.equal(zoneOf(g, comet), 'trash');
  assert.equal(M(g, f), 7);
});

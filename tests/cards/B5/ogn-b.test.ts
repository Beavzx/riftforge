// B5 tests: Origins, part B (kill effects, each-player choices, signature spells)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  game, mana, rich, run, answer, expectDecision, cast, play, canPlay, respond, toPriority, moveTo, dmg, handSize, M, put, handCard,
  zoneOf, setController, hasKw, noRunes, act, find,
} from './util.ts';

// ---------------- Acceptable Losses ----------------
test('Acceptable Losses: each player chooses one of their gear; all chosen die', () => {
  let g = game(); rich(g, 0);
  const m1 = put(g, 0, 'ts-sword', 'base'), m2 = put(g, 0, 'ts-gold', 'base');
  const t1 = put(g, 1, 'ts-gold', 'base');
  g = run(cast(g, 0, 'ogn-179-298').g);
  expectDecision(g, 'chooseCards', 0);
  g = run(g, m2);                                   // P1 has one gear: auto-chosen
  assert.equal(zoneOf(g, m2), 'trash');
  assert.equal(zoneOf(g, m1), 'base');
  assert.equal(zoneOf(g, t1), 'trash');
});

// ---------------- Cull the Weak ----------------
test('Cull the Weak: each player kills one of their units (opponent chooses theirs)', () => {
  let g = game(); rich(g, 0);
  const a = put(g, 0, 't-u1', 'base');
  const b1 = put(g, 1, 't-u2', 'base'), b2 = put(g, 1, 't-u5', 0);
  g = run(cast(g, 0, 'ogn-209-298').g);
  expectDecision(g, 'chooseCards', 1);              // P0's single unit auto-chosen, P1 chooses
  g = run(g, b1);
  assert.equal(zoneOf(g, a), 'trash');
  assert.equal(zoneOf(g, b1), 'trash');
  assert.equal(zoneOf(g, b2), 'battlefield');
});

// ---------------- Zaunite Bouncer ----------------
test('Zaunite Bouncer: returns another unit at a battlefield (not itself)', () => {
  let g = game(); rich(g, 0); setController(g, 0, 0);
  const e = put(g, 1, 't-u5', 1);
  const r = cast(g, 0, 'ogn-188-298', { destination: 0 });
  g = run(r.g);                                     // Bouncer itself (at bf 0) isn't a legal choice
  assert.equal(zoneOf(g, e), 'hand');
  assert.equal(zoneOf(g, r.id), 'battlefield');
});

// ---------------- Kog'Maw, Caustic ----------------
test("Kog'Maw: Deathknell deals 4 to all units at his battlefield", () => {
  let g = game(); rich(g, 0);
  const k = put(g, 1, 'ogn-190-298', 0);
  const a = put(g, 1, 't-u4', 0), b = put(g, 0, 't-u5', 0), far = put(g, 0, 't-u2', 1);
  g = run(cast(g, 0, 'ogs-022-024').g, k);
  assert.equal(zoneOf(g, k), 'trash');
  assert.equal(zoneOf(g, a), 'trash');
  assert.equal(dmg(g, b), 4);
  assert.equal(dmg(g, far), 0);
});
test("Kog'Maw: dying in a base deals nothing", () => {
  let g = game(); rich(g, 0);
  const k = put(g, 1, 'ogn-190-298', 'base');
  const a = put(g, 1, 't-u4', 'base');
  g = run(cast(g, 0, 'ogs-022-024').g, k);
  assert.equal(zoneOf(g, k), 'trash');
  assert.equal(dmg(g, a), 0);
});

// ---------------- Cruel Patron ----------------
test('Cruel Patron: needs a friendly unit to kill as an additional cost', () => {
  let g = game(); rich(g, 0);
  const p = handCard(g, 0, 'ogn-208-298');
  assert.equal(canPlay(g, 0, p), false);
  const fodder = put(g, 0, 't-u1', 'base');
  assert.equal(canPlay(g, 0, p), true);
  g = run(play(g, 0, p, { destination: 'base' }));
  assert.equal(zoneOf(g, fodder), 'trash');
  assert.equal(zoneOf(g, p), 'base');
});
test('Cruel Patron: the kill can be its only unit at a battlefield it is played to (UNL-FAQ #5)', () => {
  let g = game(); rich(g, 0); setController(g, 0, 0);
  const r = put(g, 0, 't-u1', 0);
  const p = handCard(g, 0, 'ogn-208-298');
  g = run(play(g, 0, p, { destination: 0 }));
  assert.equal(zoneOf(g, r), 'trash');
  assert.equal(g.objects[p].battlefieldIndex, 0);
  assert.equal(g.battlefields[0].controller, 0);
});

// ---------------- Hidden Blade ----------------
test('Hidden Blade: kills a unit at a battlefield; its controller draws 2', () => {
  let g = game(); rich(g, 0);
  const t = put(g, 1, 't-u5', 0);
  const h1 = handSize(g, 1);
  g = run(cast(g, 0, 'ogn-213-298').g);
  assert.equal(zoneOf(g, t), 'trash');
  assert.equal(handSize(g, 1), h1 + 2);
});
test('Hidden Blade: target moved to base before resolution -> no kill and no draw (VEN-FAQ #34b)', () => {
  let g = game(); rich(g, 0); rich(g, 1);
  const t = put(g, 1, 't-u5', 0);
  const blade = handCard(g, 0, 'ogn-213-298');
  const ret = handCard(g, 1, 'ogn-104-298');          // Retreat returns it to hand instead (target illegal)
  const h1 = handSize(g, 1);
  g = run(respond(play(g, 0, blade), 1, ret));
  assert.equal(zoneOf(g, t), 'hand');
  assert.equal(handSize(g, 1), h1 - 1 + 1);           // Retreat left the hand, the unit came back; no draws
});
test('Hidden Blade: can be hidden and played from face down later as a reaction', () => {
  let g = game(); rich(g, 0); setController(g, 0, 0);
  put(g, 0, 't-u2', 0);
  const blade = handCard(g, 0, 'ogn-213-298');
  assert.ok(hasKw(g, blade, 'Hidden'));
  g = act(g, { type: 'hide', player: 0, obj: blade, battlefieldIndex: 0 });
  assert.equal(zoneOf(g, blade), 'facedown');
  g = run(act(g, { type: 'endTurn', player: 0 }));
  // P1's turn: P1 attacks battlefield 0; P0 plays the hidden blade for free as a reaction
  const atk = put(g, 1, 't-u3', 'base');
  rich(g, 1);
  g = moveTo(g, 1, [atk], 0);
  g = toPriority(g, 0);
  assert.equal(canPlay(g, 0, blade), true);
  g = run(play(g, 0, blade), atk);                    // choices restricted to units here
  assert.equal(zoneOf(g, atk), 'trash');
});

// ---------------- Imperial Decree ----------------
test('Imperial Decree: any unit that takes damage this turn dies', () => {
  let g = game(); rich(g, 0);
  const a = put(g, 1, 't-u5', 0), b = put(g, 0, 't-u5', 'base');
  g = run(cast(g, 0, 'ogn-221-298').g);
  g = run(cast(g, 0, 'ogn-133-298').g);              // Flurry of Blades: 1 to units at battlefields
  assert.equal(zoneOf(g, a), 'trash');
  assert.equal(zoneOf(g, b), 'base');
});
test('Imperial Decree: expires at the end of the turn', () => {
  let g = game(); rich(g, 0);
  const a = put(g, 1, 't-u5', 0);
  g = run(cast(g, 0, 'ogn-221-298').g);
  g = run(act(g, { type: 'endTurn', player: 0 }));
  rich(g, 1);
  g = run(cast(g, 1, 'ogn-133-298').g);
  assert.equal(dmg(g, a), 1);
  assert.equal(zoneOf(g, a), 'battlefield');
});

// ---------------- Salvage ----------------
test('Salvage: may kill up to one gear, then draw 1', () => {
  let g = game(); rich(g, 0);
  const gear = put(g, 1, 'ts-gold', 'base');
  const h = handSize(g, 0);
  g = run(cast(g, 0, 'ogn-224-298').g, gear);
  assert.equal(zoneOf(g, gear), 'trash');
  assert.equal(handSize(g, 0), h + 1);               // +1 Salvage put in hand, -1 played, +1 draw
  let g2 = game(); rich(g2, 0);
  const gear2 = put(g2, 1, 'ts-gold', 'base');
  const h2 = handSize(g2, 0);
  g2 = run(cast(g2, 0, 'ogn-224-298').g, []);
  assert.equal(zoneOf(g2, gear2), 'base');
  assert.equal(handSize(g2, 0), h2 + 1);
});

// ---------------- Solari Chief ----------------
test('Solari Chief: stuns an unstunned enemy, kills a stunned one', () => {
  let g = game(); rich(g, 0);
  const e = put(g, 1, 't-u3', 'base');
  g = run(cast(g, 0, 'ogn-225-298', { destination: 'base' }).g);
  assert.equal(g.objects[e].stunned, true);
  assert.equal(zoneOf(g, e), 'base');
  g = run(cast(g, 0, 'ogn-225-298', { destination: 'base' }).g);
  assert.equal(zoneOf(g, e), 'trash');
});

// ---------------- Vengeance / Blast of Power ----------------
test('Vengeance: kill any unit', () => {
  let g = game(); rich(g, 0);
  const e = put(g, 1, 't-u5', 'base');
  g = run(cast(g, 0, 'ogn-229-298').g);
  assert.equal(zoneOf(g, e), 'trash');
});
test('Blast of Power: kill a unit at a battlefield (base units are not legal)', () => {
  let g = game(); rich(g, 0);
  const e = put(g, 1, 't-u5', 'base');
  const s = handCard(g, 0, 'ogs-012-024');
  assert.equal(canPlay(g, 0, s), false);
  const f = put(g, 1, 't-u5', 1);
  g = run(play(g, 0, s));
  assert.equal(zoneOf(g, f), 'trash');
  assert.equal(zoneOf(g, e), 'base');
});

// ---------------- Commander Ledros ----------------
test('Commander Ledros: kill friendly units as an additional cost, each reducing the cost by [C]', () => {
  let g = game();
  noRunes(g, 0);
  mana(g, 0, 6, 'Fury'); mana(g, 0, 2, 'Order');     // 8 energy available, but only 2 Order power (needs 4)
  const a = put(g, 0, 't-u1', 'base'), b = put(g, 0, 't-u1', 'base'), c = put(g, 0, 't-u2', 'base');
  const l = handCard(g, 0, 'ogn-231-298');
  assert.equal(canPlay(g, 0, l), true);
  g = play(g, 0, l, { destination: 'base' });
  expectDecision(g, 'chooseCards', 0);
  g = run(g, [a, b]);
  assert.equal(zoneOf(g, l), 'base');
  assert.equal(zoneOf(g, a), 'trash');
  assert.equal(zoneOf(g, b), 'trash');
  assert.equal(zoneOf(g, c), 'base');
  assert.ok(hasKw(g, l, 'Deflect') && hasKw(g, l, 'Ganking'));
});
test('Commander Ledros: killing too few to afford it is not offered (CR 355.16)', () => {
  let g = game();
  noRunes(g, 0);
  mana(g, 0, 6, 'Fury'); mana(g, 0, 2, 'Order');
  const a = put(g, 0, 't-u1', 'base'); put(g, 0, 't-u1', 'base');
  const l = handCard(g, 0, 'ogn-231-298');
  g = play(g, 0, l, { destination: 'base' });
  // killing only 1 would leave 3 Order needed with 2 available -> both must be killed (chosen automatically)
  assert.equal(zoneOf(g, a), 'trash');
  void l;
});

// ---------------- Harnessed Dragon ----------------
test('Harnessed Dragon: when played, kills an enemy unit', () => {
  let g = game(); rich(g, 0); mana(g, 0, 2, 'Order');
  const e = put(g, 1, 't-u5', 'base');
  put(g, 0, 't-u1', 'base');
  g = run(cast(g, 0, 'ogn-234-298', { destination: 'base' }).g);
  assert.equal(zoneOf(g, e), 'trash');
});

// ---------------- King's Edict ----------------
test("King's Edict: the opponent chooses one of their own units; it is killed", () => {
  let g = game(); rich(g, 0);
  const mine = put(g, 0, 't-u5', 'base');
  const a = put(g, 1, 't-u1', 'base'), b = put(g, 1, 't-u5', 0);
  g = run(cast(g, 0, 'ogn-237-298').g);
  const opts = expectDecision(g, 'chooseTargets', 1);
  assert.ok(!opts.includes(mine));
  g = run(g, a);
  assert.equal(zoneOf(g, a), 'trash');
  assert.equal(zoneOf(g, b), 'battlefield');
  assert.equal(zoneOf(g, mine), 'base');
});

// ---------------- Divine Judgment ----------------
test('Divine Judgment: each player keeps 2 units, 2 gear, 2 runes, 2 cards in hand; the rest are recycled', () => {
  let g = game(); mana(g, 0, 7, 'Order'); mana(g, 0, 2, 'Fury');
  const u = [put(g, 0, 't-u1', 'base'), put(g, 0, 't-u2', 'base'), put(g, 0, 't-u3', 0)];
  const o = put(g, 1, 't-u4', 'base');                    // P1: one unit (kept automatically)
  const dj = handCard(g, 0, 'ogn-244-298');
  g = play(g, 0, dj);
  g = run(g);
  // P0: units, gear (none), runes, hand
  expectDecision(g, 'chooseCards', 0);
  g = answer(g, [u[0], u[2]]);
  const r0 = g.players[0].runesInPlay;
  g = answer(g, [r0[0], r0[1]]);
  const h0 = g.players[0].hand;
  g = answer(g, [h0[0], h0[1]]);
  // P1 (RJ#4173 house ruling: units/gear/runes may be any player's): units [o, u0], runes the same two, then 2 cards in hand
  expectDecision(g, 'chooseCards', 1);
  g = answer(g, [o, u[0]]);
  g = answer(g, [r0[0], r0[1]]);
  const h1 = g.players[1].hand;
  g = run(g, [h1[0], h1[1]]);
  assert.equal(zoneOf(g, u[1]), 'mainDeck');
  assert.equal(zoneOf(g, u[0]), 'base');
  assert.equal(zoneOf(g, o), 'base');
  assert.equal(g.players[0].runesInPlay.length, 2);
  assert.equal(g.players[0].hand.length, 2);
  assert.equal(g.players[1].hand.length, 2);
});

// ---------------- Stormbringer ----------------
test('Stormbringer: a unit in my base deals its Might to all enemy units at a battlefield, then moves there', () => {
  let g = game(); rich(g, 0);
  const v = put(g, 0, 't-u4', 'base');
  const e1 = put(g, 1, 't-u3', 1), e2 = put(g, 1, 't-u4', 1), mineThere = put(g, 0, 't-u2', 1), safe = put(g, 1, 't-u5', 0);
  const bf1 = g.battlefields[1].objId;
  g = run(cast(g, 0, 'ogn-250-298').g, bf1);         // unit auto-chosen, then the battlefield
  assert.equal(zoneOf(g, e1), 'trash');
  assert.equal(zoneOf(g, e2), 'trash');
  assert.equal(dmg(g, safe), 0);
  assert.equal(dmg(g, mineThere), 0);
  assert.equal(g.objects[v].battlefieldIndex, 1);
});
test('Stormbringer: only units in my base can be chosen', () => {
  let g = game(); rich(g, 0);
  put(g, 0, 't-u4', 0);
  const s = handCard(g, 0, 'ogn-250-298');
  assert.equal(canPlay(g, 0, s), false);
});

// ---------------- Noxian Guillotine ----------------
test('Noxian Guillotine: kills the unit the next time it takes damage this turn', () => {
  let g = game(); rich(g, 0);
  const t = put(g, 1, 't-u5', 0);
  g = run(cast(g, 0, 'ogn-254-298').g);
  assert.equal(zoneOf(g, t), 'battlefield');
  g = run(cast(g, 0, 'ogn-133-298').g);              // 1 damage
  assert.equal(zoneOf(g, t), 'trash');
});
test('Noxian Guillotine: Legion — kill it now instead', () => {
  let g = game(); rich(g, 0);
  const t = put(g, 1, 't-u5', 'base');
  g = run(cast(g, 0, 't-u1', { destination: 'base' }).g);
  g = run(cast(g, 0, 'ogn-254-298').g, t);
  assert.equal(zoneOf(g, t), 'trash');
});
test('Noxian Guillotine: no damage this turn -> survives into the next turn', () => {
  let g = game(); rich(g, 0);
  const t = put(g, 1, 't-u5', 0);
  g = run(cast(g, 0, 'ogn-254-298').g);
  g = run(act(g, { type: 'endTurn', player: 0 }));
  rich(g, 1);
  g = run(cast(g, 1, 'ogn-133-298').g);
  assert.equal(zoneOf(g, t), 'battlefield');
});

// ---------------- Fox-Fire ----------------
test('Fox-Fire: kill units at one battlefield with total Might 4 or less', () => {
  let g = game(); rich(g, 0);
  const a = put(g, 1, 't-u1', 0), b = put(g, 1, 't-u3', 0), c = put(g, 1, 't-u2', 0), far = put(g, 1, 't-u1', 1);
  const ff = handCard(g, 0, 'ogn-256-298');
  g = play(g, 0, ff);
  expectDecision(g, 'chooseTargets', 0);
  g = answer(g, b);                                     // 3 Might chosen
  const opts = expectDecision(g, 'chooseTargets', 0);
  assert.ok(opts.includes(a), '1-Might unit still fits');
  assert.ok(!opts.includes(c), '2-Might unit would exceed 4');
  assert.ok(!opts.includes(far), 'other battlefield not allowed');
  g = answer(g, a);
  g = run(g);                                           // nothing else fits: no more questions
  assert.equal(zoneOf(g, a), 'trash');
  assert.equal(zoneOf(g, b), 'trash');
  assert.equal(zoneOf(g, c), 'battlefield');
  assert.equal(zoneOf(g, far), 'battlefield');
});
test('Fox-Fire: choosing none ends the selection', () => {
  let g = game(); rich(g, 0);
  const a = put(g, 1, 't-u1', 0), b = put(g, 1, 't-u1', 0);
  g = play(g, 0, handCard(g, 0, 'ogn-256-298'));
  g = answer(g, a, []);
  g = run(g);
  assert.equal(zoneOf(g, a), 'trash');
  assert.equal(zoneOf(g, b), 'battlefield');
});

// ---------------- Dragon's Rage ----------------
test("Dragon's Rage: move an enemy unit, then it fights another enemy unit at its destination", () => {
  let g = game(); rich(g, 0);
  const m = put(g, 1, 't-u4', 'base');
  const other = put(g, 1, 't-u3', 1);
  put(g, 1, 't-u2', 0);
  g = run(cast(g, 0, 'ogn-258-298').g, m);
  expectDecision(g, 'chooseDestination', 0);
  g = run(g, '1');                                       // the other enemy at bf 1 is auto-chosen
  assert.equal(g.objects[m].battlefieldIndex, 1);
  assert.equal(zoneOf(g, other), 'trash');
  assert.equal(dmg(g, m), 3);
});

// ---------------- Last Breath ----------------
test('Last Breath: ready a friendly unit; it deals its Might to an enemy unit at a battlefield', () => {
  let g = game(); rich(g, 0);
  const f = put(g, 0, 't-u4', 'base', { ready: false });
  const e = put(g, 1, 't-u4', 0);
  g = run(cast(g, 0, 'ogn-260-298').g);
  assert.equal(g.objects[f].exhausted, false);
  assert.equal(zoneOf(g, e), 'trash');
  assert.equal(dmg(g, f), 0);                            // one-way damage
});

// ---------------- Bullet Time ----------------
test('Bullet Time: on resolution pay X [A] to deal X to all enemy units at the chosen battlefield', () => {
  let g = game();
  noRunes(g, 0);
  mana(g, 0, 1, 'Fury'); mana(g, 0, 3, 'Body');
  const a = put(g, 1, 't-u3', 0), b = put(g, 1, 't-u2', 0), mine = put(g, 0, 't-u1', 'base'), far = put(g, 1, 't-u1', 1);
  g = play(g, 0, handCard(g, 0, 'ogn-268-298'));
  g = answer(g, g.battlefields[0].objId);
  g = run(g);
  const nums = expectDecision(g, 'chooseNumber', 0);
  // [A] (data audit: the printed symbol is any power): every rune left can be recycled for it, including the two exhausted
  // starting runes and the one exhausted for the card's energy -> up to 6
  assert.deepEqual(nums, ['0', '1', '2', '3', '4', '5', '6']);
  g = run(g, '3');
  assert.equal(zoneOf(g, a), 'trash');
  assert.equal(zoneOf(g, b), 'trash');
  assert.equal(dmg(g, mine), 0);
  assert.equal(dmg(g, far), 0);
});
test('Bullet Time: paying 0 deals nothing', () => {
  let g = game(); rich(g, 0);
  const a = put(g, 1, 't-u3', 0);
  g = run(cast(g, 0, 'ogn-268-298').g, g.battlefields[0].objId, '0');
  assert.equal(dmg(g, a), 0);
});

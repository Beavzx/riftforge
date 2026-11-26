// B5 tests: Vendetta
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  game, mana, rich, run, answer, expectDecision, cast, play, canPlay, respond, toPriority, moveTo, dmg, handSize, M, put, handCard,
  zoneOf, setController, hasKw, noRunes, act, activate, canActivate,
} from './util.ts';

// ---------------- Brittle Steel ----------------
test('Brittle Steel: kill a gear; Flow from the trash, then banished', () => {
  let g = game(); rich(g, 0);
  const g1 = put(g, 1, 'ts-sword', 'base'), g2 = put(g, 1, 'ts-gold', 'base');
  const bs = handCard(g, 0, 'ven-003-166');
  g = run(play(g, 0, bs), g1);
  assert.equal(zoneOf(g, g1), 'trash');
  assert.equal(zoneOf(g, bs), 'trash');
  assert.ok(hasKw(g, bs, 'Flow'));
  g = run(play(g, 0, bs));                              // from the trash for [4][C]; g2 is the only gear
  assert.equal(zoneOf(g, g2), 'trash');
  assert.equal(zoneOf(g, bs), 'banishment');
});

// ---------------- Ruthless Strike ----------------
test('Ruthless Strike: 3 damage, or 5 if I discarded as an additional cost', () => {
  let g = game(); rich(g, 0);
  const t = put(g, 1, 't-u5', 0);
  g = run(cast(g, 0, 'ven-008-166').g, 'no');
  assert.equal(dmg(g, t), 3);
  let g2 = game(); rich(g2, 0);
  const t2 = put(g2, 1, 't-u5', 0);
  const h = handSize(g2, 0);
  g2 = run(cast(g2, 0, 'ven-008-166').g, 'yes', g2.players[0].hand[0]);
  assert.equal(zoneOf(g2, t2), 'trash');
  assert.equal(handSize(g2, 0), h - 1);
});

// ---------------- Consuming Curse ----------------
test('Consuming Curse: +1 bonus damage per Consuming Curse in my trash', () => {
  let g = game(); rich(g, 0);
  put(g, 0, 'ven-010-166', 'trash'); put(g, 0, 'ven-010-166', 'trash');
  put(g, 1, 'ven-010-166', 'trash');                   // opponent's trash doesn't count
  const t = put(g, 1, 't-u5', 0);
  g = run(cast(g, 0, 'ven-010-166').g);
  assert.equal(dmg(g, t), 4);
});

// ---------------- Decree of Rage ----------------
test("Decree of Rage: can't be countered; 4 to an enemy Calm unit", () => {
  let g = game(); rich(g, 0); rich(g, 1);
  const calm = put(g, 1, 't-calm2', 'base'), fury = put(g, 1, 't-u5', 'base');
  const dr = handCard(g, 0, 'ven-015-166');
  const ww = handCard(g, 1, 'ogn-064-298');            // Wind Wall
  g = run(respond(play(g, 0, dr), 1, ww));
  assert.equal(zoneOf(g, calm), 'trash');
  assert.equal(dmg(g, fury), 0);
});
test('Decree of Rage: needs an enemy Calm unit', () => {
  const g = game(); rich(g, 0);
  put(g, 1, 't-u5', 'base');
  assert.equal(canPlay(g, 0, handCard(g, 0, 'ven-015-166')), false);
});

// ---------------- Morgana, Vindictive ----------------
test('Morgana: when played, deals damage to a unit equal to the damage marked on it', () => {
  let g = game(); rich(g, 0);
  const t = put(g, 1, 't-u5', 'base', { damage: 3 });
  const r = cast(g, 0, 'ven-017-166', { destination: 'base' });
  g = run(r.g, t);
  assert.equal(zoneOf(g, t), 'trash');                  // 3 + 3 >= 5
  assert.ok(hasKw(g, r.id, 'Ambush'));
});

// ---------------- Crumbling Sands ----------------
test('Crumbling Sands: counters only if an opponent has played another spell this turn', () => {
  let g = game(); rich(g, 0); rich(g, 1);
  const t = put(g, 1, 't-u5', 0);
  const comet = handCard(g, 0, 'ogn-085-298');
  const cs = handCard(g, 1, 'ven-039-166');
  g = run(respond(play(g, 0, comet), 1, cs));
  assert.equal(zoneOf(g, t), 'trash', 'first spell of the turn: not countered');
  let g2 = game(); rich(g2, 0); rich(g2, 1);
  const t2 = put(g2, 1, 't-u5', 0);
  const a = handCard(g2, 0, 'ogn-224-298');             // Salvage first (draw 1)
  const comet2 = handCard(g2, 0, 'ogn-085-298');
  const cs2 = handCard(g2, 1, 'ven-039-166');
  g2 = run(play(g2, 0, a));
  g2 = run(respond(play(g2, 0, comet2), 1, cs2));
  assert.equal(dmg(g2, t2), 0);
  assert.equal(zoneOf(g2, comet2), 'trash');
});

// ---------------- Sky Cruiser ----------------
test('Sky Cruiser: discard a gear, [1], [T]: 4 to a unit at a battlefield', () => {
  let g = game(); rich(g, 0);
  const sc = put(g, 0, 'ven-060-166', 'base');
  const t = put(g, 1, 't-u4', 0);
  assert.equal(canActivate(g, 0, sc), false);            // no gear in hand
  const gear = handCard(g, 0, 'ts-sword');
  g = run(activate(g, 0, sc));
  assert.equal(zoneOf(g, gear), 'trash');
  assert.equal(zoneOf(g, t), 'trash');
  assert.equal(g.objects[sc].exhausted, true);
});

// ---------------- Noxian Demolitionist ----------------
test('Noxian Demolitionist: when it conquers, may kill a gear with Energy cost <= its Might', () => {
  let g = game();
  const d = put(g, 0, 'ven-080-166', 'base');            // 1 Might
  const cheap = put(g, 1, 'ts-sword', 'base'), pricey = put(g, 1, 'unl-174-219', 'base');
  g = run(moveTo(g, 0, [d], 0), 'yes');
  assert.equal(zoneOf(g, cheap), 'trash');
  assert.equal(zoneOf(g, pricey), 'base');
});

// ---------------- Rampage ----------------
test('Rampage: optional [C] gives the friendly unit +2 before they fight', () => {
  let g = game(); rich(g, 0);
  const f = put(g, 0, 't-u3', 'base'), e = put(g, 1, 't-u5', 'base');
  g = run(cast(g, 0, 'ven-083-166').g, 'yes');
  assert.equal(zoneOf(g, e), 'trash');
  assert.equal(zoneOf(g, f), 'trash');                   // 5 Might, took 5
});
test('Rampage: without paying, plain fight', () => {
  let g = game(); rich(g, 0);
  const f = put(g, 0, 't-u4', 'base'), e = put(g, 1, 't-u5', 'base');
  g = run(cast(g, 0, 'ven-083-166').g, 'no');
  assert.equal(dmg(g, e), 4);
  assert.equal(zoneOf(g, f), 'trash');
});

// ---------------- Cataclysmic Duel ----------------
test('Cataclysmic Duel: each player keeps one unit they control; the rest die', () => {
  let g = game(); rich(g, 0); mana(g, 0, 2, 'Body');
  const a = put(g, 0, 't-u1', 'base'), b = put(g, 0, 't-u5', 0);
  const c = put(g, 1, 't-u2', 'base'), d = put(g, 1, 't-u3', 1);
  g = run(cast(g, 0, 'ven-090-166').g, b, c);
  assert.equal(zoneOf(g, a), 'trash');
  assert.equal(zoneOf(g, b), 'battlefield');
  assert.equal(zoneOf(g, c), 'base');
  assert.equal(zoneOf(g, d), 'trash');
});

// ---------------- Wind and Ghosts ----------------
test('Wind and Ghosts: banish a unit with 3 Might or less, otherwise return it', () => {
  let g = game(); rich(g, 0);
  const small = put(g, 1, 't-u3', 0);
  g = run(cast(g, 0, 'ven-106-166').g);
  assert.equal(zoneOf(g, small), 'banishment');
  let g2 = game(); rich(g2, 0);
  const big = put(g2, 1, 't-u4', 0);
  g2 = run(cast(g2, 0, 'ven-106-166').g);
  assert.equal(zoneOf(g2, big), 'hand');
});

// ---------------- Decree of Discord ----------------
test('Decree of Discord: return enemy Order units with total Might 5 or less', () => {
  let g = game(); rich(g, 0);
  const o1 = put(g, 1, 'rad-125-167', 'base');          // Dune Devourer (Order, 7) — too big
  const o2 = put(g, 1, 'ogn-208-298', 'base');          // Cruel Patron (Order, 6) — too big
  const o3 = put(g, 1, 'rad-126-167', 0);               // Mournful Spirit (Order, 1)
  const o4 = put(g, 1, 'ogn-225-298', 'base');          // Solari Chief (Order, 4)
  const fury = put(g, 1, 't-u1', 'base');
  g = play(g, 0, handCard(g, 0, 'ven-107-166'));
  let opts = expectDecision(g, 'chooseTargets', 0);
  assert.ok(opts.includes(o3) && opts.includes(o4) && !opts.includes(o1) && !opts.includes(o2) && !opts.includes(fury));
  g = answer(g, o4);
  opts = expectDecision(g, 'chooseTargets', 0);
  assert.deepEqual(opts, [o3]);
  g = run(g, o3);
  assert.equal(zoneOf(g, o3), 'hand');
  assert.equal(zoneOf(g, o4), 'hand');
  assert.equal(zoneOf(g, o1), 'base');
});

// ---------------- Decree of Unity ----------------
test('Decree of Unity: kill an enemy Chaos unit or gear', () => {
  let g = game(); rich(g, 0);
  const chaos = put(g, 1, 'ogn-188-298', 'base');       // Zaunite Bouncer (Chaos)
  put(g, 1, 't-u5', 'base');
  put(g, 0, 'ogn-188-298', 'base');                    // my own Chaos unit is not legal
  g = run(cast(g, 0, 'ven-131-166').g);
  assert.equal(zoneOf(g, chaos), 'trash');
});

// ---------------- Shuriken Flip ----------------
test('Shuriken Flip: 2 to up to one enemy at a battlefield, then move a friendly unit', () => {
  let g = game(); rich(g, 0);
  const e = put(g, 1, 't-u2', 0);
  const f = put(g, 0, 't-u1', 'base');
  g = run(cast(g, 0, 'ven-140-166').g, e);
  expectDecision(g, 'chooseDestination', 0);            // f is the only friendly unit
  g = run(g, '1');
  assert.equal(zoneOf(g, e), 'trash');
  assert.equal(g.objects[f].battlefieldIndex, 1);
  assert.ok(hasKw(g, f, 'Flow') === false);
});

// ---------------- Siphoning Strike ----------------
test('Siphoning Strike: 4 damage (7 with 7+ runes); when it dies this turn, channel 1 rune exhausted', () => {
  let g = game(); noRunes(g, 0);
  mana(g, 0, 4, 'Calm');                                 // 2 + 4 = 6 runes
  const t = put(g, 1, 't-u4', 0);
  const before = g.players[0].runesInPlay.length;
  g = run(cast(g, 0, 'ven-146-166').g);
  assert.equal(zoneOf(g, t), 'trash');
  assert.equal(g.players[0].runesInPlay.length, before + 1);
  let g2 = game(); rich(g2, 0);                          // 14 runes
  const t2 = put(g2, 1, 't-u5', 0), t3 = put(g2, 1, 't-u5', 0);
  g2 = run(cast(g2, 0, 'ven-146-166').g, t2);
  assert.equal(zoneOf(g2, t2), 'trash');
  void t3;
});

// ---------------- Rebuttal ----------------
test('Rebuttal: pay [A] to gain control of the spell (and remake choices), otherwise counter it', () => {
  let g = game(); rich(g, 0); rich(g, 1);
  const mine = put(g, 1, 't-u3', 'base'), theirs = put(g, 0, 't-u3', 'base');
  const fs = handCard(g, 0, 'ogn-029-298');              // Falling Star: 2 energy
  const rb = handCard(g, 1, 'ven-152-166');
  g = answer(play(g, 0, fs), mine, mine);                // Falling Star: two instructions
  g = run(respond(g, 1, rb), 'yes', 'yes', theirs, theirs);
  assert.equal(zoneOf(g, theirs), 'trash');
  assert.equal(dmg(g, mine), 0);
});
test('Rebuttal: not paying counters it; spells over [4] energy are not legal', () => {
  let g = game(); rich(g, 0); rich(g, 1);
  const mine = put(g, 1, 't-u3', 'base');
  const fs = handCard(g, 0, 'ogn-029-298');
  const rb = handCard(g, 1, 'ven-152-166');
  g = play(g, 0, fs);                                    // only one unit: auto-chosen
  g = run(respond(g, 1, rb), 'no');
  assert.equal(dmg(g, mine), 0);
  assert.equal(zoneOf(g, fs), 'trash');
  let g2 = game(); rich(g2, 0); rich(g2, 1);
  put(g2, 1, 't-u3', 0);
  const comet = handCard(g2, 0, 'ogn-085-298');
  const rb2 = handCard(g2, 1, 'ven-152-166');
  g2 = toPriority(play(g2, 0, comet), 1);
  assert.equal(canPlay(g2, 1, rb2), false);
});

// ---------------- Public Execution ----------------
test('Public Execution: kill an enemy unit with less Might than the chosen friendly unit', () => {
  let g = game(); rich(g, 0);
  const f = put(g, 0, 't-u4', 'base'), small = put(g, 0, 't-u1', 'base');
  const e3 = put(g, 1, 't-u3', 'base'), e4 = put(g, 1, 't-u4', 'base');
  g = play(g, 0, handCard(g, 0, 'ven-154-166'));
  // CR 355.16: the 1-Might unit isn't offered (no enemy has less Might), so f is chosen automatically; e3 is then the
  // only legal enemy (auto); e4 is not < 4
  assert.deepEqual(g.chain[g.chain.length - 1].targets, [[f], [e3]]);
  void small;
  g = run(g);
  assert.equal(zoneOf(g, e3), 'trash');
  assert.equal(zoneOf(g, e4), 'base');
  void small;
});
test('Public Execution: if the friendly unit shrinks before resolution the kill fails', () => {
  let g = game(); rich(g, 0); rich(g, 1);
  const f = put(g, 0, 't-u4', 'base'), e = put(g, 1, 't-u3', 'base');
  const pe = handCard(g, 0, 'ven-154-166');
  const ff = handCard(g, 1, 'ogn-029-298');              // Falling Star on my unit: 3 damage doesn't change Might...
  void ff;
  g = play(g, 0, pe);                                    // f and e are the only legal choices: auto
  // shrink: P1 responds with Realm of Death? use a direct modifier instead (test setup)
  g.objects[f].modifiers.push({ source: null, layer: 3, duration: 'endOfTurn', might: -2, timestamp: ++g.timestamp });
  g = run(g);
  assert.equal(zoneOf(g, e), 'base');
});

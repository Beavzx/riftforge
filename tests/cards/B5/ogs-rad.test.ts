// B5 tests: Proving Grounds + Radiance
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  game, mana, rich, run, answer, expectDecision, cast, play, canPlay, respond, toPriority, moveTo, dmg, handSize, M, put, handCard,
  zoneOf, setController, hasKw, noRunes, act,
} from './util.ts';

// ---------------- Firestorm ----------------
test('Firestorm: 3 to all enemy units at a chosen battlefield', () => {
  let g = game(); rich(g, 0);
  const a = put(g, 1, 't-u3', 1), b = put(g, 1, 't-u4', 1), mine = put(g, 0, 't-u2', 'base'), other = put(g, 1, 't-u1', 0);
  const r = cast(g, 0, 'ogs-002-024');
  const opts = expectDecision(r.g, 'chooseTargets', 0);
  assert.equal(opts.length, 2);
  g = run(r.g, g.battlefields[1].objId);
  assert.equal(zoneOf(g, a), 'trash');
  assert.equal(dmg(g, b), 3);
  assert.equal(dmg(g, mine), 0);
  assert.equal(dmg(g, other), 0);
});

// ---------------- Incinerate ----------------
test('Incinerate: 2 to a unit at a battlefield', () => {
  let g = game(); rich(g, 0);
  const a = put(g, 1, 't-u3', 1);
  g = run(cast(g, 0, 'ogs-003-024').g);
  assert.equal(dmg(g, a), 2);
});

// ---------------- Gentlemen's Duel ----------------
test("Gentlemen's Duel: +3 to a friendly unit, then it fights an enemy unit chosen on resolution", () => {
  let g = game(); rich(g, 0);
  const f = put(g, 0, 't-u2', 'base');
  const e1 = put(g, 1, 't-u4', 'base'), e2 = put(g, 1, 't-u1', 0);
  g = run(cast(g, 0, 'ogs-008-024').g);
  expectDecision(g, 'chooseTargets', 0);           // the enemy is chosen on resolution
  g = run(g, e1);
  assert.equal(M(g, f), 5);
  assert.equal(zoneOf(g, e1), 'trash');
  assert.equal(dmg(g, f), 4);
  assert.equal(zoneOf(g, e2), 'battlefield');
});

// ---------------- Tibbers ----------------
test('Tibbers: when played, 3 to all units at battlefields (including himself)', () => {
  let g = game(); rich(g, 0); setController(g, 0, 0);
  const a = put(g, 1, 't-u3', 1), b = put(g, 0, 't-u5', 0), c = put(g, 1, 't-u3', 'base');
  const r = cast(g, 0, 'ogs-018-024', { destination: 0 });
  g = run(r.g);
  assert.equal(zoneOf(g, a), 'trash');
  assert.equal(dmg(g, b), 3);
  assert.equal(dmg(g, r.id), 3);
  assert.equal(dmg(g, c), 0);
});

// ---------------- Bilgewater Tracker ----------------
test('Bilgewater Tracker: 1 to each of up to 2 units', () => {
  let g = game(); rich(g, 0);
  const a = put(g, 1, 't-u1', 'base'), b = put(g, 1, 't-u2', 0), c = put(g, 1, 't-u2', 0);
  g = run(cast(g, 0, 'rad-003-167', { destination: 'base' }).g, [a, b]);
  assert.equal(zoneOf(g, a), 'trash');
  assert.equal(dmg(g, b), 1);
  assert.equal(dmg(g, c), 0);
});

// ---------------- Scorched Earth ----------------
test('Scorched Earth: 5 damage split among units at a single battlefield', () => {
  let g = game(); rich(g, 0);
  const a = put(g, 1, 't-u3', 0), b = put(g, 1, 't-u2', 0), far = put(g, 1, 't-u2', 1);
  g = play(g, 0, handCard(g, 0, 'rad-006-167'));
  expectDecision(g, 'chooseTargets', 0);
  assert.throws(() => act(g, { type: 'choose', player: 0, optionIds: [a, far] }), /same location/);
  g = run(g, [a, b], '3');
  assert.equal(zoneOf(g, a), 'trash');
  assert.equal(zoneOf(g, b), 'trash');
  assert.equal(dmg(g, far), 0);
});

// ---------------- Lost to the Sands ----------------
test('Lost to the Sands: mode 1 deals 4 at a battlefield, mode 2 kills a gear', () => {
  let g = game(); rich(g, 0);
  const u = put(g, 1, 't-u5', 0), gear = put(g, 1, 'ts-gold', 'base');
  g = run(cast(g, 0, 'rad-013-167').g, 'deal');
  assert.equal(dmg(g, u), 4);
  g = run(cast(g, 0, 'rad-013-167').g, 'gear');
  assert.equal(zoneOf(g, gear), 'trash');
});
test('Lost to the Sands: the gear mode is unavailable without gear', () => {
  let g = game(); rich(g, 0);
  const u = put(g, 1, 't-u5', 0);
  g = run(cast(g, 0, 'rad-013-167').g);              // only one mode available: chosen automatically
  assert.equal(dmg(g, u), 4);
});

// ---------------- Shimmering Swimmer ----------------
test('Shimmering Swimmer: paying the optional kill deals 2 to a unit', () => {
  let g = game(); rich(g, 0);
  const fodder = put(g, 0, 'ts-gold', 'base');
  const e = put(g, 1, 't-u2', 'base');
  const r = cast(g, 0, 'rad-014-167', { destination: 'base' });
  expectDecision(r.g, 'optional', 0);
  g = run(r.g, 'yes', e);                             // the only friendly gear is auto-chosen
  assert.equal(zoneOf(g, fodder), 'trash');
  assert.equal(zoneOf(g, e), 'trash');
});
test('Shimmering Swimmer: without the additional cost no damage trigger', () => {
  let g = game(); rich(g, 0);
  put(g, 0, 'ts-gold', 'base');
  const e = put(g, 1, 't-u2', 'base');
  g = run(cast(g, 0, 'rad-014-167', { destination: 'base' }).g, 'no');
  assert.equal(dmg(g, e), 0);
  assert.equal(g.chain.length, 0);
});

// ---------------- Mordekaiser, Twice Slain ----------------
test('Mordekaiser: if he would die, may kill a friendly unit to heal, exhaust and recall instead (once a turn)', () => {
  let g = game(); rich(g, 0); rich(g, 0);
  const m = put(g, 1, 'rad-020-167', 0);
  const f1 = put(g, 1, 't-u1', 'base'), f2 = put(g, 1, 't-u1', 'base');
  g = run(cast(g, 0, 'ogs-022-024').g, m);
  expectDecision(g, 'optional', 1);
  g = run(g, 'yes', f1);
  assert.equal(zoneOf(g, m), 'base');
  assert.equal(dmg(g, m), 0);
  assert.equal(g.objects[m].exhausted, true);
  assert.equal(zoneOf(g, f1), 'trash');
  // second time this turn: he dies
  g = run(cast(g, 0, 'ogs-022-024').g, m);
  assert.equal(zoneOf(g, m), 'trash');
  assert.equal(zoneOf(g, f2), 'base');
  assert.ok(hasKw(g, m, 'Accelerate') && hasKw(g, m, 'Assault'));
});
test('Mordekaiser: declining lets him die; no friendly unit -> no offer', () => {
  let g = game(); rich(g, 0);
  const m = put(g, 1, 'rad-020-167', 0);
  put(g, 1, 't-u1', 'base');
  g = run(cast(g, 0, 'ogs-022-024').g, m, 'no');
  assert.equal(zoneOf(g, m), 'trash');
  let g2 = game(); rich(g2, 0);
  const m2 = put(g2, 1, 'rad-020-167', 0);
  g2 = run(cast(g2, 0, 'ogs-022-024').g);
  assert.equal(zoneOf(g2, m2), 'trash');
});

// ---------------- Parallel Convergence ----------------
test('Parallel Convergence: return a friendly unit as an additional cost; 5 to a unit at a battlefield', () => {
  let g = game(); rich(g, 0);
  const p = handCard(g, 0, 'rad-051-167');
  const e = put(g, 1, 't-u5', 0);
  assert.equal(canPlay(g, 0, p), false);            // no friendly unit to return
  const f = put(g, 0, 't-u2', 'base');
  g = run(play(g, 0, p));
  assert.equal(zoneOf(g, f), 'hand');
  assert.equal(zoneOf(g, e), 'trash');
});

// ---------------- Improvised Projectile ----------------
test('Improvised Projectile: damage equal to a friendly gear\'s Energy cost', () => {
  let g = game(); rich(g, 0);
  const gear = put(g, 0, 'unl-174-219', 'base');     // Shard of Undoing, Energy 6
  const e = put(g, 1, 't-u5', 0);
  g = run(cast(g, 0, 'rad-056-167').g);
  assert.equal(zoneOf(g, e), 'trash');
  assert.equal(zoneOf(g, gear), 'base');
});

// ---------------- Supernova ----------------
test('Supernova: 10 to a unit, draw 2', () => {
  let g = game(); rich(g, 0); mana(g, 0, 1, 'Order');
  const e = put(g, 1, 't-u5', 'base');
  const h = handSize(g, 0);
  g = run(cast(g, 0, 'rad-059-167').g);
  assert.equal(zoneOf(g, e), 'trash');
  assert.equal(handSize(g, 0), h + 2);
});

// ---------------- Armored Tusker ----------------
test('Armored Tusker: when it moves, may deal damage equal to its Shield to a unit at a battlefield', () => {
  let g = game();
  const t = put(g, 0, 'rad-078-167', 'base');
  const e = put(g, 1, 't-u3', 0);
  assert.ok(hasKw(g, t, 'Tank'));
  g = moveTo(g, 0, [t], 1);
  g = run(g);
  expectDecision(g, 'optional', 0);
  g = run(g, 'yes');                                 // e is the only unit at a battlefield other than Tusker? Tusker too
  if (g.pending?.kind === 'chooseTargets') g = run(g, e);
  assert.equal(zoneOf(g, e), 'trash');
});
test('Armored Tusker: may decline', () => {
  let g = game();
  const t = put(g, 0, 'rad-078-167', 'base');
  const e = put(g, 1, 't-u3', 0);
  g = run(moveTo(g, 0, [t], 1), 'no');
  assert.equal(dmg(g, e), 0);
});

// ---------------- Avalanche ----------------
test('Avalanche: 3 to all units in bases (both players)', () => {
  let g = game(); rich(g, 0);
  const a = put(g, 0, 't-u3', 'base'), b = put(g, 1, 't-u4', 'base'), c = put(g, 1, 't-u1', 0);
  g = run(cast(g, 0, 'rad-079-167').g);
  assert.equal(zoneOf(g, a), 'trash');
  assert.equal(dmg(g, b), 3);
  assert.equal(dmg(g, c), 0);
});

// ---------------- Primordial Roar ----------------
test('Primordial Roar: show off a unit from hand; deal its Might to a unit', () => {
  let g = game(); rich(g, 0);
  const show = handCard(g, 0, 't-u4');
  const e = put(g, 1, 't-u5', 'base');
  g = play(g, 0, handCard(g, 0, 'rad-082-167'));
  expectDecision(g, 'chooseCards', 0);
  g = run(g, show);
  assert.equal(dmg(g, e), 4);
  assert.equal(zoneOf(g, show), 'hand');
});
test('Primordial Roar: without showing off, no damage', () => {
  let g = game(); rich(g, 0);
  for (const id of [...g.players[0].hand]) { g.players[0].hand.splice(g.players[0].hand.indexOf(id), 1); delete g.objects[id]; }
  const e = put(g, 1, 't-u5', 'base');
  g = run(cast(g, 0, 'rad-082-167').g);              // nothing to show off -> not asked
  assert.equal(dmg(g, e), 0);
});

// ---------------- Stalwart Goatherd ----------------
test('Stalwart Goatherd: may kill a gear with Energy cost 4 or less', () => {
  let g = game(); rich(g, 0);
  const cheap = put(g, 1, 'ts-sword', 'base'), pricey = put(g, 1, 'unl-174-219', 'base');
  const r = cast(g, 0, 'rad-083-167', { destination: 'base' });
  g = run(r.g, 'yes');                                // the 6-cost gear isn't a legal choice
  assert.equal(zoneOf(g, cheap), 'trash');
  assert.equal(zoneOf(g, pricey), 'base');
  assert.ok(hasKw(g, r.id, 'Shield'));
});

// ---------------- Dune Devourer ----------------
test('Dune Devourer: kill a friendly unit to have it cost [2] less', () => {
  let g = game();
  noRunes(g, 0);
  mana(g, 0, 4, 'Fury'); mana(g, 0, 1, 'Order');     // 5 energy: only enough with the discount
  const f = put(g, 0, 't-u1', 'base');
  const d = handCard(g, 0, 'rad-125-167');
  assert.equal(canPlay(g, 0, d), true);
  g = play(g, 0, d, { destination: 'base' });
  // only enough with the discount: the kill is required, not offered (CR 355.16 / F-3c)
  g = run(g);
  assert.equal(zoneOf(g, f), 'trash');
  assert.equal(zoneOf(g, d), 'base');
  assert.ok(hasKw(g, d, 'Deflect'));
});
test('Dune Devourer: without a friendly unit it costs full price', () => {
  let g = game();
  noRunes(g, 0);
  mana(g, 0, 4, 'Fury'); mana(g, 0, 1, 'Order');
  const d = handCard(g, 0, 'rad-125-167');
  assert.equal(canPlay(g, 0, d), false);
  mana(g, 0, 2, 'Fury');
  assert.equal(canPlay(g, 0, d), true);
  g = run(play(g, 0, d, { destination: 'base' }));
  assert.equal(zoneOf(g, d), 'base');
});

// ---------------- Mournful Spirit ----------------
test('Mournful Spirit: Deathknell — may kill a unit or gear at its location', () => {
  let g = game(); rich(g, 0);
  const s = put(g, 1, 'rad-126-167', 0);
  const e = put(g, 0, 't-u5', 0), far = put(g, 0, 't-u5', 1);
  g = run(cast(g, 0, 'ogs-022-024').g, s);
  expectDecision(g, 'optional', 1);
  g = run(g, 'yes');                                  // only e is here now
  assert.equal(zoneOf(g, e), 'trash');
  assert.equal(zoneOf(g, far), 'battlefield');
});

// ---------------- Mordekaiser, Dominating ----------------
test('Mordekaiser, Dominating: when played, may discard 1 to kill a unit or gear', () => {
  let g = game(); rich(g, 0); mana(g, 0, 2, 'Order');
  const e = put(g, 1, 't-u5', 'base');
  const r = cast(g, 0, 'rad-137-167', { destination: 'base' });
  const h = handSize(r.g, 0);
  g = run(r.g, 'yes', e);
  expectDecision(g, 'chooseCards', 0);                // discard choice (cost)
  g = run(g, g.players[0].hand[0]);
  assert.equal(zoneOf(g, e), 'trash');
  assert.equal(handSize(g, 0), h - 1);
});
test('Mordekaiser, Dominating: also when he attacks; no cards in hand -> no trigger', () => {
  let g = game();
  const m = put(g, 0, 'rad-137-167', 'base');
  const e = put(g, 1, 't-u1', 1), gear = put(g, 1, 'ts-gold', 'base');
  g = run(moveTo(g, 0, [m], 1), 'yes', gear, g.players[0].hand[0]);
  assert.equal(zoneOf(g, gear), 'trash');
  assert.equal(zoneOf(g, e), 'trash');                // combat
  let g2 = game();
  for (const id of [...g2.players[0].hand]) { g2.players[0].hand.splice(g2.players[0].hand.indexOf(id), 1); delete g2.objects[id]; }
  const m2 = put(g2, 0, 'rad-137-167', 'base');
  put(g2, 1, 't-u1', 1); const gear2 = put(g2, 1, 'ts-gold', 'base');
  g2 = run(moveTo(g2, 0, [m2], 1));                   // nothing to discard: not even offered
  assert.equal(zoneOf(g2, gear2), 'base');
});

// ---------------- Realm of Death ----------------
test('Realm of Death: enemy -2, friendly +2, then they fight', () => {
  let g = game(); rich(g, 0); mana(g, 0, 1, 'Order');
  const e = put(g, 1, 't-u5', 'base'), f = put(g, 0, 't-u2', 'base');
  g = run(cast(g, 0, 'rad-144-167').g);
  assert.equal(M(g, f), 4);
  assert.equal(dmg(g, f), 3);                         // the enemy had 3 Might after -2
  assert.equal(zoneOf(g, e), 'trash');
});

// ---------------- Ntofo Strikes ----------------
test('Ntofo Strikes: give Shield 2, then deal damage equal to its Shield', () => {
  let g = game(); rich(g, 0);
  const f = put(g, 0, 't-shield', 'base');           // already Shield 2 -> total 4
  const e = put(g, 1, 't-u5', 'base');
  g = run(cast(g, 0, 'rad-148-167').g);
  assert.equal(dmg(g, e), 4);
  void f;
});

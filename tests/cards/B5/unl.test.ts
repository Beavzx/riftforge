// B5 tests: Unleashed
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  game, mana, rich, run, answer, expectDecision, cast, play, canPlay, respond, toPriority, moveTo, dmg, handSize, M, put, handCard,
  zoneOf, setController, hasKw, noRunes, act, activate, canActivate, getLegalActions,
} from './util.ts';
import type { GameState } from '../../../src/engine/types.ts';

const setBattlefield = (g: GameState, bf: number, cardId: string) => { g.objects[g.battlefields[bf].objId].cardId = cardId; };

// ---------------- Mischievous Marai ----------------
test('Mischievous Marai: played to a battlefield, deals 2 to an enemy unit there', () => {
  let g = game(); rich(g, 0); setController(g, 0, 0);
  put(g, 0, 't-u1', 0);
  const e = put(g, 1, 't-u2', 'base');
  const r = cast(g, 0, 'unl-003-219', { destination: 0 });
  g = run(r.g);
  assert.equal(dmg(g, e), 0, 'enemy in base is not here');
  assert.ok(hasKw(g, r.id, 'Hidden'));
  let g2 = game(); rich(g2, 0); setController(g2, 0, 0);
  put(g2, 0, 't-u1', 0);
  const e2 = put(g2, 1, 't-u2', 'base');
  g2 = run(cast(g2, 0, 'unl-003-219', { destination: 'base' }).g);
  assert.equal(dmg(g2, e2), 0, 'played to base: no trigger');
});
test('Mischievous Marai (with Katarina): from face down to a contested battlefield deals 2 to an enemy there', () => {
  let g = game(); rich(g, 0); setController(g, 0, 0);
  const keep = put(g, 0, 't-u3', 0);
  const kat = put(g, 0, 'unl-023-219', 'base', { ready: false });
  const marai = handCard(g, 0, 'unl-003-219');
  g = act(g, { type: 'hide', player: 0, obj: marai, battlefieldIndex: 0 });
  // Katarina: when you hide a card, ready me
  g = run(g);
  assert.equal(g.objects[kat].exhausted, false);
  g = run(act(g, { type: 'endTurn', player: 0 }));
  g = run(act(g, { type: 'endTurn', player: 1 }));
  assert.equal(g.activePlayer, 0);
  const e1 = put(g, 1, 't-u2', 0);                    // an enemy arrives at battlefield 0
  const e2 = put(g, 1, 't-u2', 'base');
  rich(g, 0);
  g = play(g, 0, marai);
  // Marai's trigger (enemy here) and Katarina's trigger (any enemy unit): order, then targets
  g = run(g, ...orderAndTargets(g, e1, e2));
  assert.equal(zoneOf(g, e1), 'trash');
  assert.equal(zoneOf(g, e2), 'trash');
  void keep;
});
/** answers for: [order triggers?] then the two target choices (Marai -> e1 is auto, Katarina -> e2) */
function orderAndTargets(g: GameState, e1: string, e2: string): string[] {
  const out: string[] = [];
  if (g.pending?.kind === 'chooseOrder' || g.pending?.kind === 'orderTriggers') out.push(g.pending.options![0].id);   // Katarina's first
  void e1;
  out.push(e2);
  return out;
}

// ---------------- Smite ----------------
test('Smite: 3 damage; if it would die this turn it is banished instead', () => {
  let g = game(); rich(g, 0);
  const t = put(g, 1, 't-u3', 0);
  g = run(cast(g, 0, 'unl-007-219').g);
  assert.equal(zoneOf(g, t), 'banishment');
});
test('Smite: a surviving unit killed later this turn is banished too', () => {
  let g = game(); rich(g, 0);
  const t = put(g, 1, 't-u5', 0);
  g = run(cast(g, 0, 'unl-007-219').g);
  assert.equal(dmg(g, t), 3);
  g = run(cast(g, 0, 'ogn-229-298').g);              // Vengeance (only unit: auto)
  assert.equal(zoneOf(g, t), 'banishment');
});

// ---------------- Monster Harpoon ----------------
test('Monster Harpoon: 2, or 4 if I control a facedown card', () => {
  let g = game(); rich(g, 0); setController(g, 0, 0);
  put(g, 0, 't-u1', 0);
  const t = put(g, 1, 't-u5', 1);
  g = run(cast(g, 0, 'unl-014-219').g, t);
  assert.equal(dmg(g, t), 2);
  const hb = handCard(g, 0, 'ogn-213-298');
  g = act(g, { type: 'hide', player: 0, obj: hb, battlefieldIndex: 0 });
  g = run(cast(g, 0, 'unl-014-219').g, t);
  assert.equal(zoneOf(g, t), 'trash');
});

// ---------------- Dancing Grenade ----------------
test('Dancing Grenade: 2 damage; the target\'s controller may replay it for [A] with growing bonus damage', () => {
  let g = game(); rich(g, 0); rich(g, 1);
  const mine = put(g, 0, 't-u5', 'base');
  const theirs = put(g, 1, 't-u5', 'base');
  const dg = handCard(g, 0, 'unl-020-219');
  g = play(g, 0, dg);
  g = answer(g, theirs);
  g = run(g);
  assert.equal(dmg(g, theirs), 2);
  expectDecision(g, 'optional', 1);                   // P1 may play it again for [A]
  g = run(g, 'yes', mine);
  assert.equal(dmg(g, mine), 3);                      // 2 + 1 bonus (dealt damage once before)
  expectDecision(g, 'optional', 0);
  g = run(g, 'yes', theirs);
  assert.equal(zoneOf(g, theirs), 'trash');           // 2 + 2 bonus = 4 more
  expectDecision(g, 'optional', 1);
  g = run(g, 'no');
  assert.equal(zoneOf(g, dg), 'trash');
});

// ---------------- Katarina, Reckless ----------------
test('Katarina: hiding a card readies her', () => {
  let g = game(); rich(g, 0); setController(g, 0, 0);
  put(g, 0, 't-u1', 0);
  const k = put(g, 0, 'unl-023-219', 'base', { ready: false });
  g = run(act(g, { type: 'hide', player: 0, obj: handCard(g, 0, 'ogn-213-298'), battlefieldIndex: 0 }));
  assert.equal(g.objects[k].exhausted, false);
});

// ---------------- Xerath ----------------
test('Xerath: [C], [T]: 3 to a unit, only while at a battlefield', () => {
  let g = game(); rich(g, 0); setController(g, 0, 0);
  const x = put(g, 0, 'unl-026-219', 'base');
  const e = put(g, 1, 't-u3', 'base');
  assert.equal(canActivate(g, 0, x), false);
  const x2 = put(g, 0, 'unl-026-219', 0);
  g = run(activate(g, 0, x2), e);
  assert.equal(zoneOf(g, e), 'trash');
  assert.equal(g.objects[x2].exhausted, true);
  void x;
});

// ---------------- Ruined Rex ----------------
test('Ruined Rex: Deathknell deals 4 to an enemy unit', () => {
  let g = game(); rich(g, 0);
  const rex = put(g, 1, 'unl-067-219', 'base');
  const mine = put(g, 0, 't-u4', 'base');
  g = run(cast(g, 0, 'ogs-022-024').g, rex);
  assert.equal(zoneOf(g, rex), 'trash');
  assert.equal(zoneOf(g, mine), 'trash');
});

// ---------------- Crescent Strike ----------------
test('Crescent Strike: 4 to the chosen enemy and 1 to each other enemy there', () => {
  let g = game(); rich(g, 0);
  const a = put(g, 1, 't-u4', 1), b = put(g, 1, 't-u2', 1), c = put(g, 1, 't-u1', 0), mine = put(g, 0, 't-u2', 'base');
  g = play(g, 0, handCard(g, 0, 'unl-072-219'));
  g = answer(g, g.battlefields[1].objId);
  const opts = expectDecision(g, 'chooseTargets', 0);
  assert.ok(!opts.includes(c), 'the unit must be at the chosen battlefield');
  g = run(g, a);
  assert.equal(zoneOf(g, a), 'trash');
  assert.equal(dmg(g, b), 1);
  assert.equal(dmg(g, c), 0);
  assert.equal(dmg(g, mine), 0);
});

// ---------------- Repulse ----------------
test('Repulse: counters an enemy spell that chooses my unit and no other friendly unit', () => {
  let g = game(); rich(g, 0); rich(g, 1);
  const mine = put(g, 1, 't-u3', 0);
  const comet = handCard(g, 0, 'ogn-085-298');
  const rep = handCard(g, 1, 'unl-106-219');
  g = run(respond(play(g, 0, comet), 1, rep));
  assert.equal(dmg(g, mine), 0);
  assert.equal(zoneOf(g, comet), 'trash');
});
test('Repulse: not when the spell also chooses another friendly unit', () => {
  let g = game(); rich(g, 0); rich(g, 1);
  const a = put(g, 1, 't-u5', 0), b = put(g, 1, 't-u5', 'base');
  const sing = handCard(g, 0, 'ogn-105-298');          // Singularity: up to two units
  const rep = handCard(g, 1, 'unl-106-219');
  g = toPriority(answer(play(g, 0, sing), [a, b]), 1);
  assert.equal(canPlay(g, 1, rep), false);
});

// ---------------- Clash of Giants ----------------
test('Clash of Giants: two units deal their Mights to each other', () => {
  let g = game(); rich(g, 0);
  const a = put(g, 1, 't-u3', 'base'), b = put(g, 1, 't-u5', 0);
  g = run(cast(g, 0, 'unl-110-219').g);               // exactly two units exist: auto-chosen
  assert.equal(zoneOf(g, a), 'trash');
  assert.equal(dmg(g, b), 3);
});

// ---------------- Elder Dragon ----------------
test('Elder Dragon: up to one enemy unit at each location takes 1, and any of my damage kills enemies', () => {
  let g = game(); noRunes(g, 0); mana(g, 0, 8, 'Fury'); mana(g, 0, 4, 'Body');
  const a = put(g, 1, 't-u5', 0), b = put(g, 1, 't-u5', 1), c = put(g, 1, 't-u5', 'base'), d = put(g, 1, 't-u5', 'base');
  const mine = put(g, 0, 't-u1', 'base');
  const r = cast(g, 0, 'unl-118-219', { destination: 'base' });
  g = run(r.g, a, b, c);
  assert.equal(zoneOf(g, a), 'trash');
  assert.equal(zoneOf(g, b), 'trash');
  assert.equal(zoneOf(g, c), 'trash');
  assert.equal(zoneOf(g, d), 'base');
  assert.equal(zoneOf(g, mine), 'base');
});
test('Elder Dragon: my own units are not affected by the lethal rule', () => {
  let g = game(); rich(g, 0);
  put(g, 0, 'unl-118-219', 'base');
  const mine = put(g, 0, 't-u5', 'base');
  g = run(cast(g, 0, 'ogn-029-298').g, mine);          // Falling Star 3 on my own unit
  assert.equal(zoneOf(g, mine), 'base');
});

// ---------------- Star-Crossed ----------------
test('Star-Crossed: returns a friendly unit and an enemy unit', () => {
  let g = game(); rich(g, 0);
  const f = put(g, 0, 't-u1', 'base'), e = put(g, 1, 't-u5', 0);
  g = run(cast(g, 0, 'unl-128-219').g);
  assert.equal(zoneOf(g, f), 'hand');
  assert.equal(zoneOf(g, e), 'hand');
});

// ---------------- Abandon ----------------
test('Abandon: counter a spell, it returns to its owner\'s hand; predict', () => {
  let g = game(); rich(g, 0); rich(g, 1);
  const t = put(g, 1, 't-u3', 0);
  const comet = handCard(g, 0, 'ogn-085-298');
  const ab = handCard(g, 1, 'unl-131-219');
  g = run(respond(play(g, 0, comet), 1, ab));
  expectDecision(g, 'chooseCards', 1);               // predict: may recycle the top card
  g = run(g, []);
  assert.equal(zoneOf(g, comet), 'hand');
  assert.equal(dmg(g, t), 0);
});
test("Abandon: vs Decree of Rage (can't be countered) it only predicts (VEN-FAQ #5)", () => {
  let g = game(); rich(g, 0); rich(g, 1);
  const t = put(g, 1, 't-u3', 'base');
  g.objects[t].cardId = 't-calm2';
  const dr = handCard(g, 0, 'ven-015-166');
  const ab = handCard(g, 1, 'unl-131-219');
  g = run(respond(play(g, 0, dr), 1, ab), []);
  assert.equal(zoneOf(g, t), 'trash');
  assert.equal(zoneOf(g, dr), 'trash');
});
test('Abandon: a Flow-played spell is banished, not returned (rules-tests T159)', () => {
  let g = game(); rich(g, 0); rich(g, 1);
  const gear = put(g, 1, 'ts-sword', 'base');
  const bs = put(g, 0, 'ven-003-166', 'trash');      // Brittle Steel, Flow [4][C]
  const ab = handCard(g, 1, 'unl-131-219');
  g = run(respond(play(g, 0, bs), 1, ab), []);
  assert.equal(zoneOf(g, bs), 'banishment');
  assert.equal(zoneOf(g, gear), 'base');
});

// ---------------- Heedless Resurrection ----------------
test('Heedless Resurrection: kill a friendly unit; play a unit from my trash costing no more, for free', () => {
  let g = game(); rich(g, 0);
  const k = put(g, 0, 't-u4', 'base');
  const cheap = put(g, 0, 't-u3', 'trash'), pricey = put(g, 0, 't-u5', 'trash');
  const k2 = put(g, 0, 't-u3', 'base');
  const small = put(g, 0, 't-u1', 'base');          // no trash unit costs no more than this one: not offered for the kill
  const mid = put(g, 0, 't-u4', 'trash');
  g = play(g, 0, handCard(g, 0, 'unl-142-219'));
  // RULINGS sweep / CR 355.5: as it is played — first the unit to kill (additional cost), then the trash unit (a target)
  assert.deepEqual(expectDecision(g, 'chooseCards', 0).sort(), [k, k2].sort());
  g = act(g, { type: 'choose', player: 0, optionIds: [k] });
  const opts = expectDecision(g, 'chooseTargets', 0);
  assert.deepEqual(opts.sort(), [cheap, mid].sort(), 'only units costing no more than the killed unit');
  void pricey;
  g = act(g, { type: 'choose', player: 0, optionIds: [cheap] });
  assert.equal(zoneOf(g, k), 'trash', 'killed while playing (cost), before resolution');
  assert.equal(zoneOf(g, cheap), 'trash', 'still in the trash until resolution');
  g = run(g);
  assert.equal(zoneOf(g, cheap), 'base');
  assert.equal(zoneOf(g, small), 'base');
  assert.equal(zoneOf(g, k2), 'base');
});
test('Heedless Resurrection: not playable without a friendly unit', () => {
  const g = game(); rich(g, 0);
  const h = handCard(g, 0, 'unl-142-219');
  assert.equal(canPlay(g, 0, h), false);
});

// ---------------- Soul Harvest ----------------
test('Soul Harvest: kill a unit at a battlefield with 3 Might or less', () => {
  let g = game(); rich(g, 0);
  const s = put(g, 1, 't-u3', 0); put(g, 1, 't-u4', 0); put(g, 1, 't-u1', 'base');
  g = run(cast(g, 0, 'unl-159-219').g);
  assert.equal(zoneOf(g, s), 'trash');
});

// ---------------- Stalking Wolf ----------------
test('Stalking Wolf: kill a Poro you control as an additional cost; Ambush to its battlefield even if alone', () => {
  let g = game(); rich(g, 0); rich(g, 1);
  const poro = put(g, 0, 'ven-029-166', 1);            // Ol' Poro at battlefield 1 (controlled by nobody)
  const wolf = handCard(g, 0, 'unl-166-219');
  assert.ok(hasKw(g, wolf, 'Ambush'));
  // P1's turn: P0 ambushes in response to a P1 spell
  g = run(act(g, { type: 'endTurn', player: 0 }));
  const e = put(g, 1, 't-u2', 'base');
  const ray = handCard(g, 1, 'ogn-133-298');          // Flurry of Blades (hits battlefields)
  g = play(g, 1, ray);
  g = toPriority(g, 0);
  assert.equal(canPlay(g, 0, wolf), true);
  g = run(play(g, 0, wolf, { destination: 1 }));
  assert.equal(zoneOf(g, poro), 'trash');
  assert.equal(g.objects[wolf].battlefieldIndex, 1);
  void e;
});
test('Stalking Wolf: no Bird/Cat/Dog/Poro -> cannot be played', () => {
  const g = game(); rich(g, 0);
  put(g, 0, 't-u2', 'base');
  const w = handCard(g, 0, 'unl-166-219');
  assert.equal(canPlay(g, 0, w), false);
});

// ---------------- Sacrifice ----------------
test('Sacrifice: kill a friendly Mighty unit; draw 2 and channel 1 rune exhausted', () => {
  let g = game(); rich(g, 0);
  const s = handCard(g, 0, 'unl-173-219');
  put(g, 0, 't-u4', 'base');
  assert.equal(canPlay(g, 0, s), false);
  const big = put(g, 0, 't-u5', 'base');
  const h = handSize(g, 0), r = g.players[0].runesInPlay.length;
  g = run(play(g, 0, s));
  assert.equal(zoneOf(g, big), 'trash');
  assert.equal(handSize(g, 0), h - 1 + 2);
  assert.equal(g.players[0].runesInPlay.length, r + 1);
});

// ---------------- Shard of Undoing ----------------
test('Shard of Undoing: first friendly death in my Beginning Phase -> each opponent kills one of their units', () => {
  let g = game();
  put(g, 1, 'unl-174-219', 'base');
  const temp = put(g, 1, 't-temp', 'base');            // Temporary: dies at the start of P1's Beginning Phase
  const a = put(g, 0, 't-u2', 'base'), b = put(g, 0, 't-u3', 'base');
  g = act(g, { type: 'endTurn', player: 0 });
  g = run(g);
  expectDecision(g, 'chooseCards', 0);
  g = run(g, b);
  assert.equal(zoneOf(g, temp), 'trash');
  assert.equal(zoneOf(g, b), 'trash');
  assert.equal(zoneOf(g, a), 'base');
});
test('Shard of Undoing: deaths outside my Beginning Phase do nothing', () => {
  let g = game(); rich(g, 0);
  put(g, 0, 'unl-174-219', 'base');
  const f = put(g, 0, 't-u1', 'base');
  const e = put(g, 1, 't-u1', 'base');
  g = run(cast(g, 0, 'ogn-229-298').g, f);
  assert.equal(zoneOf(g, e), 'base');
});

// ---------------- The Ruination ----------------
test('The Ruination: kill all units', () => {
  let g = game(); rich(g, 0); mana(g, 0, 1, 'Order');
  const a = put(g, 0, 't-u1', 'base'), b = put(g, 1, 't-u5', 0), gear = put(g, 1, 'ts-sword', 'base');
  g = run(cast(g, 0, 'unl-180-219').g);
  assert.equal(zoneOf(g, a), 'trash'); assert.equal(zoneOf(g, b), 'trash');
  assert.equal(zoneOf(g, gear), 'base');
});

// ---------------- Curtain Call ----------------
test('Curtain Call: pay repeat costs as it is played; each execution picks a mode not chosen yet', () => {
  let g = game(); rich(g, 0);
  const a = put(g, 1, 't-u2', 0), b = put(g, 1, 't-u3', 'base');
  const h = handSize(g, 0);
  g = play(g, 0, handCard(g, 0, 'unl-182-219'));
  expectDecision(g, 'optional', 0);                   // pay [1]?
  g = answer(g, 'yes', 'no', 'yes');                  // pay [1] and [1][A]: two repeats
  expectDecision(g, 'chooseMode', 0);
  g = answer(g, 'bf2');                               // first: 2 to a (auto target)
  g = run(g);
  const modes = expectDecision(g, 'chooseMode', 0);
  assert.ok(!modes.includes('bf2'));
  g = run(g, 'base3', 'draw');                        // 3 to b (auto), then draw 1
  assert.equal(zoneOf(g, a), 'trash');
  assert.equal(zoneOf(g, b), 'trash');
  assert.equal(handSize(g, 0), h + 1);
});
test('Curtain Call: without repeats it is a single mode', () => {
  let g = game(); rich(g, 0);
  const a = put(g, 1, 't-u5', 0);
  g = run(cast(g, 0, 'unl-182-219').g, 'no', 'no', 'no', 'minus4');
  assert.equal(M(g, a), 1);
  assert.ok(hasKw(g, a, 'Repeat') === false);
});

// ---------------- Death from Below ----------------
test('Death from Below: killing a unit with 3 Might or less lets me replay it from my trash for [A]', () => {
  let g = game(); rich(g, 0);
  const a = put(g, 1, 't-u3', 0), b = put(g, 1, 't-u2', 1);
  const dfb = handCard(g, 0, 'unl-186-219');
  g = play(g, 0, dfb);
  g = run(answer(g, a));
  expectDecision(g, 'optional', 0);
  g = run(g, 'yes');                                   // b is the only unit at a battlefield now
  assert.equal(zoneOf(g, a), 'trash');
  assert.equal(zoneOf(g, b), 'trash');
  g = run(g, 'no');
  assert.equal(zoneOf(g, dfb), 'trash');
});
test('Death from Below: a bigger unit gives no replay', () => {
  let g = game(); rich(g, 0);
  const a = put(g, 1, 't-u4', 0);
  g = run(cast(g, 0, 'unl-186-219').g);
  assert.equal(zoneOf(g, a), 'trash');
  assert.equal(g.pending?.kind, 'mainAction');
});

// ---------------- Lilting Lullaby ----------------
test("Lilting Lullaby: counter a spell; its controller can't play spells this turn", () => {
  let g = game(); rich(g, 0); rich(g, 1); mana(g, 1, 1, 'Calm', 'Mind');
  const t = put(g, 1, 't-u3', 0);
  const comet = handCard(g, 0, 'ogn-085-298');
  const ll = handCard(g, 1, 'unl-190-219');
  g = run(respond(play(g, 0, comet), 1, ll));
  assert.equal(dmg(g, t), 0);
  const ray = handCard(g, 0, 'ogn-009-298');
  assert.equal(canPlay(g, 0, ray), false);
  const unit = handCard(g, 0, 't-u1');
  assert.equal(canPlay(g, 0, unit), true);             // units are fine
});

// ---------------- Dusk Rose Lab ----------------
test('Dusk Rose Lab: at the start of my Beginning Phase, may kill a unit I control here to draw 1', () => {
  let g = game();
  setBattlefield(g, 0, 'unl-209-219');
  setController(g, 0, 1);
  const u = put(g, 1, 't-u2', 0);
  const h = handSize(g, 1);
  g = act(g, { type: 'endTurn', player: 0 });
  g = run(g);
  expectDecision(g, 'optional', 1);
  g = run(g, 'yes');
  assert.equal(zoneOf(g, u), 'trash');
  assert.equal(handSize(g, 1), h + 2);                // + Lab draw + draw step
});
test('Dusk Rose Lab: not if I do not control it', () => {
  let g = game();
  setBattlefield(g, 0, 'unl-209-219');
  const u = put(g, 1, 't-u2', 0);
  g = run(act(g, { type: 'endTurn', player: 0 }));
  assert.equal(zoneOf(g, u), 'battlefield');
});

// ---------------- Frozen Fortress ----------------
test("Frozen Fortress: at the start of each player's Beginning Phase, 1 to each unit here", () => {
  let g = game();
  setBattlefield(g, 0, 'unl-212-219');
  setController(g, 0, 1);
  const a = put(g, 1, 't-u1', 0), b = put(g, 1, 't-u3', 0), c = put(g, 1, 't-u1', 1);
  g = run(act(g, { type: 'endTurn', player: 0 }));
  assert.equal(zoneOf(g, a), 'trash');
  assert.equal(dmg(g, b), 1);
  assert.equal(dmg(g, c), 0);
  // P1's battlefield 0 was held (1 point) after the damage: units died before scoring
  assert.equal(g.battlefields[0].controller, 1);
});

// B6 scenario tests: Radiance (rad).
import { test } from 'node:test';
import {
  game, addRunes, exhaustRunes, play, playObj, playHere, activate, moveUnits, attackInto, endTurn, drive, doAct, put, handCard, M, buffs, ready, pendingIds,
  assert, hasKw, kwVal, zoneOf, setController, legalPlay, legalActivate, act,
} from './_h.ts';

test('Brawl: Assault equal to its Might this turn', () => {
  let g = game();
  addRunes(g, 0, 4, 'Chaos');
  const a = put(g, 0, 't-u3', 'base');
  ({ g } = play(g, 0, 'rad-004-167', undefined));
  assert.equal(kwVal(g, a, 'Assault'), 3);
  g = endTurn(g);
  assert.equal(kwVal(g, a, 'Assault'), 0);
});

test('War Scout: Accelerate; when played give a unit +2', () => {
  let g = game();
  exhaustRunes(g, 0);
  addRunes(g, 0, 5, 'Fury');
  const a = put(g, 0, 't-u2', 'base');
  const r = play(g, 0, 'rad-008-167', 'base', 'yes', a);
  g = r.g;
  assert.equal(ready(g, r.id), true, 'Accelerate paid');
  assert.equal(M(g, a), 4);
});

test('Iridescent Avian: [T] buff a unit; if already buffed, +2 this turn instead', () => {
  let g = game();
  const av = put(g, 0, 'rad-027-167', 'base');
  const a = put(g, 0, 't-u2', 'base');
  g = activate(g, 0, av, 0, a);
  assert.equal(buffs(g, a), 1);
  assert.equal(M(g, a), 3);
  g.objects[av].exhausted = false;
  g = activate(g, 0, av, 0, a);
  assert.equal(buffs(g, a), 1);
  assert.equal(M(g, a), 5);
});

test('Sanctum Conservator: ready me when you play a card with Energy cost 7+', () => {
  let g = game();
  addRunes(g, 0, 14);
  const s = put(g, 0, 'rad-030-167', 'base', { ready: false });
  ({ g } = play(g, 0, 't-u5', 'base'));
  assert.equal(ready(g, s), false);
  ({ g } = play(g, 0, 't-b6-unit7', 'base'));
  assert.equal(ready(g, s), true);
});

test('Battle Preparations: +2; if you showed off a gear, ready up to 2 runes', () => {
  let g = game();
  exhaustRunes(g, 0);
  const rs = addRunes(g, 0, 2, 'Calm');
  const gear = put(g, 0, 't-b6-gear2', 'base');
  const a = put(g, 0, 't-u2', 'base');
  const bp = handCard(g, 0, 'rad-032-167');
  assert.ok(hasKw(g, bp, 'Reaction'));
  g = playObj(g, 0, bp, undefined, [gear], rs);
  assert.equal(M(g, a), 4);
  assert.ok(rs.every(r => ready(g, r)), 'paid runes readied again');
  // without showing off: no rune choice
  let h = game();
  exhaustRunes(h, 0);
  const r2 = addRunes(h, 0, 2, 'Calm');
  const b = put(h, 0, 't-u2', 'base');
  h = playObj(h, 0, handCard(h, 0, 'rad-032-167'), undefined);
  assert.equal(M(h, b), 4);
  assert.ok(r2.every(r => !ready(h, r)));
});

test("Hunker Down: ready a friendly unit; it can't move this turn; draw 1", () => {
  let g = game();
  addRunes(g, 0, 2, 'Calm');
  const a = put(g, 0, 't-u2', 'base', { ready: false });
  const hand = g.players[0].hand.length;
  ({ g } = play(g, 0, 'rad-034-167', undefined));
  assert.equal(ready(g, a), true);
  assert.equal(g.players[0].hand.length, hand + 1);
  assert.throws(() => act(g, { type: 'move', player: 0, units: [a], to: 0 }), /illegal move/, "can't move this turn");
  g = endTurn(g); g = endTurn(g);
  g = moveUnits(g, 0, [a], 0);
  assert.equal(zoneOf(g, a), 'battlefield', 'next turn it can');
});

test('Ahri, Confident: Disarm on attack reduces an enemy here -> +1 to Ahri', () => {
  let g = game();
  const ahri = put(g, 0, 'rad-038-167', 'base');
  assert.equal(kwVal(g, ahri, 'Disarm'), 1);
  const e = put(g, 1, 't-u3', 0);
  g = attackInto(g, 0, [ahri], 0);
  assert.equal(M(g, e), 2, 'Disarm -1');
  assert.equal(M(g, ahri), 5, 'Ahri +1');
});

test('Ahri: reductions of enemies elsewhere or by the opponent do not count', () => {
  let g = game();
  const ahri = put(g, 0, 'rad-038-167', 0);
  setController(g, 0, 0);
  const e = put(g, 1, 't-u3', 1);
  ({ g } = play(g, 0, 't-b6-shrink', undefined, e));
  assert.equal(M(g, e), 2);
  assert.equal(M(g, ahri), 4);
});

test('Riven, Broken Blade: when exhausted choose a mode not chosen this turn', () => {
  let g = game();
  const rv = put(g, 0, 'rad-043-167', 'base');
  const e = put(g, 1, 't-u2', 1);
  // R-1 (CR 403.2, rulings B6): every mode not chosen this turn is offered as the trigger goes on the chain, buffed or not
  g = moveUnits(g, 0, [rv], 0);
  assert.deepEqual(pendingIds(g).sort(), ['buff', 'ready', 'stun']);
  g = drive(g, 'buff');
  assert.equal(buffs(g, rv), 1);
  // exhaust again (already exhausted -> no event); ready + exhaust via test spell
  g.objects[rv].exhausted = false;
  g = playObj(g, 0, handCard(g, 0, 't-b6-exhaust3'), undefined, [rv]);
  assert.deepEqual(pendingIds(g).sort(), ['ready', 'stun']);
  g = drive(g, 'stun');   // the only enemy unit is chosen automatically
  assert.equal(buffs(g, rv), 0);
  assert.equal(g.objects[e].stunned, true);
  g.objects[rv].exhausted = false; g.objects[rv].counters.buff = 1;
  g = playObj(g, 0, handCard(g, 0, 't-b6-exhaust3'), undefined, [rv]);
  assert.equal(ready(g, rv), true, 'only "ready" left: chosen automatically');
  assert.equal(buffs(g, rv), 0);
  // next turn: "spend my buff to ready me" without a buff does nothing on resolution (and still counts as chosen)
  let h = game();
  const rv2 = put(h, 0, 'rad-043-167', 'base');
  put(h, 1, 't-u2', 1);
  h = moveUnits(h, 0, [rv2], 0);
  h = drive(h, 'ready');
  assert.equal(ready(h, rv2), false);
  h.objects[rv2].exhausted = false;
  h = playObj(h, 0, handCard(h, 0, 't-b6-exhaust3'), undefined, [rv2]);
  assert.deepEqual(pendingIds(h).sort(), ['buff', 'stun']);
});

test('Resplendent Rostrum: [T] draw 1 + channel 1 exhausted; when it becomes exhausted give a friendly unit +3', () => {
  let g = game();
  const r = put(g, 0, 'rad-046-167', 'base');
  const a = put(g, 0, 't-u2', 'base');
  const h = g.players[0].hand.length, n = g.players[0].runesInPlay.length;
  g = activate(g, 0, r, 0);
  assert.equal(g.players[0].hand.length, h + 1);
  assert.equal(g.players[0].runesInPlay.length, n + 1);
  assert.equal(M(g, a), 5);
});

test('High Note: -X where X = exhausted units you control', () => {
  let g = game();
  addRunes(g, 0, 4, 'Mind');
  put(g, 0, 't-u1', 'base', { ready: false }); put(g, 0, 't-u1', 'base', { ready: false }); put(g, 0, 't-u1', 'base');
  put(g, 1, 't-u1', 1, { ready: false });
  const e = put(g, 1, 't-u5', 0);
  ({ g } = play(g, 0, 'rad-048-167', undefined, e));
  assert.equal(M(g, e), 3);
});

test("Piltovan Guidebot: may set its base Might to the played card's Energy cost this turn", () => {
  let g = game();
  addRunes(g, 0, 14);
  const p = put(g, 0, 'rad-057-167', 'base');
  ({ g } = play(g, 0, 't-b6-unit7', 'base', 'yes'));
  assert.equal(M(g, p), 7);
  ({ g } = play(g, 0, 't-u1', 'base', 'no'));
  assert.equal(M(g, p), 7, 'declined');
  g.objects[p].counters.buff = 1; g.ex.dirty = true;
  assert.equal(M(g, p), 8, 'buffs still add on top of base Might');
  g = endTurn(g);
  assert.equal(M(g, p), 4);
});

test('Riptide Mage: an enemy unit -3 (no minimum)', () => {
  let g = game();
  exhaustRunes(g, 0);
  addRunes(g, 0, 5, 'Mind');
  const e = put(g, 1, 't-u2', 0);
  ({ g } = play(g, 0, 'rad-058-167', 'base', 'no'));
  assert.equal(M(g, e), -1, 'true value kept below 0 (CR 143.2)');
  assert.equal(zoneOf(g, e), 'battlefield', 'no damage: does not die');
});

test('Seraphine, Inspiring: exhausting 3+ friendly units at once may draw 1, once each turn', () => {
  let g = game();
  const s = put(g, 0, 'rad-065-167', 'base');
  assert.equal(kwVal(g, s, 'Disarm'), 2);
  const us = [put(g, 0, 't-u1', 'base'), put(g, 0, 't-u1', 'base'), put(g, 0, 't-u1', 'base')];
  const h = g.players[0].hand.length;
  g = moveUnits(g, 0, us.slice(0, 2), 0);
  assert.equal(g.players[0].hand.length, h, 'two units: no trigger');
  g = playObj(g, 0, handCard(g, 0, 't-b6-exhaust3'), undefined, [s, us[2], put(g, 0, 't-u1', 'base')], 'yes');
  assert.equal(g.players[0].hand.length, h + 1);
  const more = [put(g, 0, 't-u1', 'base'), put(g, 0, 't-u1', 'base'), put(g, 0, 't-u1', 'base')];
  g = moveUnits(g, 0, more, 1);
  assert.equal(g.players[0].hand.length, h + 1, 'only once each turn');
});

test('Spirit of the Forge: return a friendly gear as an additional cost -> ready me and +[gear cost]', () => {
  let g = game();
  addRunes(g, 0, 7, 'Mind');
  const gear = put(g, 0, 't-b6-gear5', 'base');
  const r = play(g, 0, 'rad-066-167', 'base', 'yes');
  g = r.g;
  assert.equal(zoneOf(g, gear), 'hand');
  assert.equal(ready(g, r.id), true);
  assert.equal(M(g, r.id), 9);
  // not paid
  addRunes(g, 0, 7, 'Mind');
  put(g, 0, 't-b6-gear2', 'base');
  const r2 = play(g, 0, 'rad-066-167', 'base', 'no');
  g = r2.g;
  assert.equal(ready(g, r2.id), false);
  assert.equal(M(g, r2.id), 4);
});

test("Hold 'Em: costs [2] less after you played a unit or gear to a battlefield this turn", () => {
  let g = game();
  exhaustRunes(g, 0);
  setController(g, 0, 0);
  addRunes(g, 0, 2, 'Body');
  const a = put(g, 0, 't-u2', 'base');
  const he = handCard(g, 0, 'rad-070-167');
  assert.equal(legalPlay(g, 0, he), false, 'costs 3');
  const u = handCard(g, 0, 't-u1');
  g = playObj(g, 0, u, 0);
  assert.ok(legalPlay(g, 0, he), 'now costs 1');
  g = playObj(g, 0, he, undefined, a);
  assert.equal(M(g, a), 5);
});

test('Elnuk Herd: +3 to a friendly unit; recycled if played from face down', () => {
  let g = game();
  addRunes(g, 0, 8, 'Fury');
  setController(g, 0, 0);
  const a = put(g, 0, 't-u2', 'base');
  const h = put(g, 0, 't-u1', 0);
  let r = play(g, 0, 'rad-081-167', 'base', a);
  g = r.g;
  assert.equal(M(g, a), 5);
  assert.equal(zoneOf(g, r.id), 'base');
  // from face down: the play effect chooses a friendly unit at the battlefield it was played to (CR 811.1.d.3)
  const e = handCard(g, 0, 'rad-081-167');
  g = doAct(g, { type: 'hide', player: 0, obj: e, battlefieldIndex: 0 });
  g = endTurn(g); g = endTurn(g);
  g = playObj(g, 0, e, 0, h);
  assert.equal(zoneOf(g, e), 'mainDeck');
  assert.equal(M(g, h), 4);
});

test('Evelynn, Consuming: Ambush; ready me and +1 when you play a card from face down', () => {
  let g = game();
  addRunes(g, 0, 4);
  setController(g, 0, 0);
  const ev = put(g, 0, 'rad-090-167', 0, { ready: false });
  assert.ok(hasKw(g, ev, 'Ambush'));
  const h = handCard(g, 0, 't-b6-hunit');
  g = doAct(g, { type: 'hide', player: 0, obj: h, battlefieldIndex: 0 });
  g = endTurn(g); g = endTurn(g);
  g.objects[ev].exhausted = true;
  g = playObj(g, 0, h, 0);
  assert.equal(ready(g, ev), true);
  assert.equal(M(g, ev), 6);
});

test("Lulu, Whimsical: when I move, may have another unit's base Might become 4", () => {
  let g = game();
  const l = put(g, 0, 'rad-110-167', 'base');
  const e = put(g, 1, 't-u1', 1), f = put(g, 0, 't-u2', 'base');
  g = moveUnits(g, 0, [l], 0, 'yes', e);
  assert.equal(M(g, e), 4);
  assert.equal(M(g, f), 2);
  let h = game();
  const l2 = put(h, 0, 'rad-110-167', 'base');
  const e2 = put(h, 1, 't-u1', 1);
  h = moveUnits(h, 0, [l2], 0, 'no');
  assert.equal(M(h, e2), 1);
});

test('Riven, Deserter: +1 when another friendly unit becomes exhausted; exhaust a friendly unit: ready a unit (once per turn)', () => {
  let g = game();
  const rv = put(g, 0, 'rad-114-167', 'base');
  const a = put(g, 0, 't-u2', 'base'), b = put(g, 0, 't-u2', 'base', { ready: false });
  g = activate(g, 0, rv, 1, b, a);
  assert.equal(ready(g, a), false);
  assert.equal(ready(g, b), true);
  assert.equal(M(g, rv), 6, 'a became exhausted');
  assert.equal(legalActivate(g, 0, rv, 1), false, 'once each turn');
  g = moveUnits(g, 0, [b], 0);
  assert.equal(M(g, rv), 7);
});

test('For Demacia!: friendly units at the chosen battlefield get Shield 2 this turn', () => {
  let g = game();
  addRunes(g, 0, 3, 'Order');
  const a = put(g, 0, 't-u2', 0), b = put(g, 0, 't-u2', 1);
  ({ g } = play(g, 0, 'rad-117-167', undefined, g.battlefields[0].objId));
  assert.equal(kwVal(g, a, 'Shield'), 2);
  assert.equal(kwVal(g, b, 'Shield'), 0);
});

test('Herald of the Emperor: a friendly unit\'s base Might becomes 5 this turn', () => {
  let g = game();
  addRunes(g, 0, 5, 'Order');
  const a = put(g, 0, 't-u1', 'base');
  g.objects[a].counters.buff = 1;
  const r = play(g, 0, 'rad-118-167', 'base', a);
  g = r.g;
  assert.equal(M(g, a), 6, 'base 5 + buff');
  g = endTurn(g);
  assert.equal(M(g, a), 2);
});

test('One-Two Punch: buff a friendly unit and stun an enemy unit', () => {
  let g = game();
  addRunes(g, 0, 3);
  const a = put(g, 0, 't-u2', 'base'), e = put(g, 1, 't-u2', 0);
  ({ g } = play(g, 0, 'rad-121-167', undefined));
  assert.equal(buffs(g, a), 1);
  assert.equal(g.objects[e].stunned, true);
});

test('Demacian Illuminators: several friendly units dying at once trigger once', () => {
  let g = game();
  const d = put(g, 0, 'rad-131-167', 'base');
  const a = put(g, 0, 't-u1', 'base'), b = put(g, 0, 't-u1', 'base');
  g.objects[a].damage = 5; g.objects[b].damage = 5; g.ex.dirty = true;
  g = doAct(g, { type: 'playCard', player: 0, obj: handCard(g, 0, 't-b6-spell1') });
  assert.equal(zoneOf(g, a), 'trash');
  assert.equal(buffs(g, d), 1, 'only one trigger, buffing the remaining friendly unit');
  assert.equal(g.pending?.kind, 'mainAction');
});

test('Raucous Anthem: ready your units and give them +3', () => {
  let g = game();
  addRunes(g, 0, 8, 'Order');
  const a = put(g, 0, 't-u2', 'base', { ready: false }), e = put(g, 1, 't-u2', 0, { ready: false });
  ({ g } = play(g, 0, 'rad-134-167', undefined));
  assert.equal(ready(g, a), true);
  assert.equal(M(g, a), 5);
  assert.equal(ready(g, e), false);
  assert.equal(M(g, e), 2);
});

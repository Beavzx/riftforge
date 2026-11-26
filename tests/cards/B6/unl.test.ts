// B6 scenario tests: Unleashed (unl).
import { test } from 'node:test';
import {
  game, addRunes, exhaustRunes, play, playObj, playHere, activate, moveUnits, attackInto, endTurn, drive, doAct, resolveChain, put, handCard, M, buffs, ready, pendingIds,
  assert, hasKw, kwVal, zoneOf, setController, legalActivate, act,
} from './_h.ts';

test('Arena Kingpin: enters ready; [T]: a unit +3', () => {
  let g = game();
  addRunes(g, 0, 5, 'Fury');
  const r = play(g, 0, 'unl-001-219', 'base');
  g = r.g;
  assert.equal(ready(g, r.id), true);
  const a = put(g, 0, 't-u1', 'base');
  g = activate(g, 0, r.id, 0, a);
  assert.equal(M(g, a), 4);
  assert.equal(ready(g, r.id), false);
});

test('Revna the Lorekeeper: ready me when you play a spell you spent [4]+ on', () => {
  let g = game();
  addRunes(g, 0, 8);
  const rv = put(g, 0, 'unl-005-219', 'base', { ready: false });
  assert.ok(hasKw(g, rv, 'Ganking'));
  ({ g } = play(g, 0, 't-b6-spell1', undefined));
  assert.equal(ready(g, rv), false);
  ({ g } = play(g, 0, 't-b6-spell4', undefined));
  assert.equal(ready(g, rv), true);
});

test('Upstage Comedy: ready a unit; Repeat [2] readies another', () => {
  let g = game();
  exhaustRunes(g, 0);
  addRunes(g, 0, 4, 'Fury');
  const a = put(g, 0, 't-u1', 'base', { ready: false }), b = put(g, 0, 't-u1', 'base', { ready: false });
  ({ g } = play(g, 0, 'unl-009-219', undefined, a, 'yes', b));
  assert.equal(ready(g, a), true);
  assert.equal(ready(g, b), true);
});

test('Vault Breaker: Assault 2 and Ganking this turn', () => {
  let g = game();
  addRunes(g, 0, 2, 'Fury');
  const a = put(g, 0, 't-u1', 'base');
  ({ g } = play(g, 0, 'unl-010-219', undefined));
  assert.equal(kwVal(g, a, 'Assault'), 2);
  assert.ok(hasKw(g, a, 'Ganking'));
});

test('Lord Broadmane: your other units here get Assault this turn', () => {
  let g = game();
  addRunes(g, 0, 6, 'Fury');
  const a = put(g, 0, 't-u1', 'base'), b = put(g, 0, 't-u1', 0), e = put(g, 1, 't-u1', 1);
  const r = play(g, 0, 'unl-012-219', 'base');
  g = r.g;
  assert.ok(hasKw(g, r.id, 'Ambush'));
  assert.equal(kwVal(g, a, 'Assault'), 1);
  assert.equal(kwVal(g, b, 'Assault'), 0);
  assert.equal(kwVal(g, e, 'Assault'), 0);
  assert.equal(kwVal(g, r.id, 'Assault'), 0);
});

test('Inviolus Vox: when I conquer, give a friendly unit +8', () => {
  let g = game();
  const v = put(g, 0, 'unl-027-219', 'base');
  const a = put(g, 0, 't-u1', 'base');
  g = moveUnits(g, 0, [v], 0, a);
  assert.equal(g.battlefields[0].controller, 0);
  assert.equal(M(g, a), 9);
});

test('Pyke, Dockside Butcher: pay [C] extra -> ready me and +2', () => {
  let g = game();
  exhaustRunes(g, 0);
  addRunes(g, 0, 4, 'Fury');
  const r = play(g, 0, 'unl-028-219', 'base', 'yes');
  g = r.g;
  assert.ok(hasKw(g, r.id, 'Hidden') && hasKw(g, r.id, 'Ganking'));
  assert.equal(ready(g, r.id), true);
  assert.equal(M(g, r.id), 4);
});

test('Red Brambleback: conquer effects here trigger an additional time (incl. its own buff)', () => {
  let g = game();
  const rb = put(g, 0, 'unl-029-219', 'base');
  const v = put(g, 0, 'unl-027-219', 'base');
  const a = put(g, 0, 't-u1', 'base'), b = put(g, 0, 't-u1', 'base');
  assert.ok(hasKw(g, rb, 'Accelerate'));
  // order the four triggers (2 Brambleback + 2 Vox), then targets for each
  g = act(g, { type: 'move', player: 0, units: [rb, v], to: 0 });
  g = drive(g);
  let guard = 0, nb = 0;
  while (g.pending?.inStep && guard++ < 20) {
    const d = g.pending;
    if (d.kind === 'orderTriggers' || d.kind === 'chooseOrder') { g = drive(g, d.options![0].id); continue; }
    if (d.kind === 'chooseTargets' && /Buff/.test(d.prompt)) { g = drive(g, nb++ ? b : a); continue; }
    if (d.kind === 'chooseTargets') { g = drive(g, a); continue; }
    break;
  }
  g = drive(g);
  assert.equal(buffs(g, a), 1);
  assert.equal(buffs(g, b), 1);
  assert.equal(M(g, a), 1 + 1 + 16, 'Vox triggered twice');
});


test('Vi, Hotheaded: [2][C] double my Might this turn; Deflect', () => {
  let g = game();
  exhaustRunes(g, 0);
  addRunes(g, 0, 3, 'Fury');
  const v = put(g, 0, 'unl-030-219', 'base');
  assert.ok(hasKw(g, v, 'Deflect'));
  g = activate(g, 0, v, 0);
  assert.equal(M(g, v), 6);
});

test('Enthusiastic Promoter: when I hold, buff all units here', () => {
  let g = game();
  setController(g, 0, 0);
  const p = put(g, 0, 'unl-043-219', 0), a = put(g, 0, 't-u1', 0);
  assert.ok(hasKw(g, p, 'Backline'));
  g = endTurn(g); g = endTurn(g);
  assert.equal(g.activePlayer, 0);
  assert.equal(buffs(g, p), 1);
  assert.equal(buffs(g, a), 1);
});

test('Friendship: +1 for each of Bird, Cat, Dog, Poro among your units', () => {
  let g = game();
  addRunes(g, 0, 2, 'Calm');
  const a = put(g, 0, 't-b6-bird', 'base');
  put(g, 0, 't-b6-cat', 'base'); put(g, 0, 't-b6-cat', 'base'); put(g, 1, 't-b6-dog', 0);
  ({ g } = play(g, 0, 'unl-046-219', undefined, a));
  assert.equal(M(g, a), 3, 'Bird + Cat (enemy Dog does not count, two Cats count once)');
});

test('Nami, Headstrong: paid [C] -> stun an enemy unit', () => {
  let g = game();
  exhaustRunes(g, 0);
  addRunes(g, 0, 4, 'Calm');
  const e = put(g, 1, 't-u2', 1);
  ({ g } = play(g, 0, 'unl-052-219', 'base', 'yes'));
  assert.equal(g.objects[e].stunned, true);
  const e2 = put(g, 1, 't-u2', 1);
  addRunes(g, 0, 4, 'Calm');
  ({ g } = play(g, 0, 'unl-052-219', 'base', 'no'));
  assert.ok(!g.objects[e2].stunned, 'not paid: no stun');
});

test('Nami, Headstrong: when I hold, the next unit you play this turn is readied and buffed', () => {
  let g = game();
  setController(g, 0, 0);
  put(g, 0, 'unl-052-219', 0);
  g = endTurn(g); g = endTurn(g);
  addRunes(g, 0, 4);
  let u = play(g, 0, 't-u1', 'base');
  g = u.g;
  assert.equal(ready(g, u.id), true);
  assert.equal(buffs(g, u.id), 1);
  u = play(g, 0, 't-u1', 'base');
  g = u.g;
  assert.equal(ready(g, u.id), false, 'only the next one');
  assert.equal(buffs(g, u.id), 0);
});

test('Yuumi, Magical Cat: on attack, another unit of yours here gets +3 and Tank', () => {
  let g = game();
  const y = put(g, 0, 'unl-056-219', 'base'), a = put(g, 0, 't-u2', 'base');
  put(g, 1, 't-u1', 0);
  g = attackInto(g, 0, [y, a], 0);
  assert.equal(M(g, a), 5);
  assert.ok(hasKw(g, a, 'Tank'));
});

test('Moonlight Affliction: -10', () => {
  let g = game();
  addRunes(g, 0, 7, 'Mind');
  const e = put(g, 1, 't-u5', 0);
  ({ g } = play(g, 0, 'unl-066-219', undefined));
  assert.equal(M(g, e), -5);
});

test('Spectral Centaur: +2 when another friendly unit dies', () => {
  let g = game();
  const c = put(g, 0, 'unl-068-219', 'base');
  const a = put(g, 0, 't-u1', 'base'), e = put(g, 1, 't-u1', 0);
  g.objects[a].damage = 3; g.objects[e].damage = 3; g.ex.dirty = true;
  g = doAct(g, { type: 'playCard', player: 0, obj: handCard(g, 0, 't-b6-spell1') });
  assert.equal(M(g, c), 7);
});

test('Turn to Dust: give a gear Temporary', () => {
  let g = game();
  addRunes(g, 0, 2, 'Mind');
  const gear = put(g, 1, 't-b6-gear2', 'base');
  ({ g } = play(g, 0, 'unl-070-219', undefined));
  assert.ok(hasKw(g, gear, 'Temporary'));
  g = endTurn(g);
  assert.equal(zoneOf(g, gear), 'trash');
});

test('Hwei, Brooding Painter: when I move draw 1, discard 1, then act on the discarded type', () => {
  for (const [disc, check] of [['t-u1', 'unit'], ['t-b6-gear2', 'gear'], ['t-b6-spell1', 'spell']] as const) {
    let g = game();
    const h = put(g, 0, 'unl-080-219', 'base');
    const card = handCard(g, 0, disc);
    const rs = addRunes(g, 0, 2); for (const r of rs) g.objects[r].exhausted = true;
    const hand = g.players[0].hand.length;
    g = moveUnits(g, 0, [h], 0, card, ...(check === 'gear' ? [rs] : []));
    assert.equal(zoneOf(g, card), 'trash');
    if (check === 'unit') assert.equal(M(g, h), 8);
    if (check === 'gear') assert.ok(rs.every(r => ready(g, r)));
    if (check === 'spell') assert.equal(g.players[0].hand.length, hand + 1);
    if (check !== 'unit') assert.equal(M(g, h), 5);
  }
});

test('Gentle Gemdragon: ready up to 2 runes when you play it or another Dragon', () => {
  let g = game();
  exhaustRunes(g, 0);
  const rs = addRunes(g, 0, 8, 'Body');
  ({ g } = play(g, 0, 'unl-104-219', 'base', rs.slice(0, 2)));
  assert.equal(rs.filter(r => ready(g, r)).length, 2);
  ({ g } = play(g, 0, 't-b6-dragon', 'base', rs.slice(2, 4)));
  assert.equal(rs.filter(r => ready(g, r)).length, 2, 'paid 2, readied 2');
  ({ g } = play(g, 0, 't-u1', 'base'));
  assert.equal(g.pending?.kind, 'mainAction');
});

test('Diana, No Longer Human: +2 when you play a spell; Ambush', () => {
  let g = game();
  addRunes(g, 0, 2);
  const d = put(g, 0, 'unl-149-219', 'base');
  assert.ok(hasKw(g, d, 'Ambush'));
  ({ g } = play(g, 0, 't-b6-spell1', undefined));
  assert.equal(M(g, d), 5);
});

test('Heroic Charge: friendly +1 and stun an enemy unit at its location', () => {
  let g = game();
  addRunes(g, 0, 3, 'Order');
  const a = put(g, 0, 't-u3', 'base');
  const e1 = put(g, 1, 't-u2', 0), e2 = put(g, 1, 't-u2', 1);
  g = attackInto(g, 0, [a], 0);
  assert.equal(g.pending?.kind, 'showdownAction');
  g = doAct(g, { type: 'playCard', player: 0, obj: handCard(g, 0, 'unl-155-219') });
  void e2;
  assert.ok(g.objects[e1].stunned || zoneOf(g, e1) === 'trash');
  assert.ok(!g.objects[e2].stunned, 'enemy elsewhere not chosen');
});

test('Heroic Charge: the enemy choice is limited to the friendly unit\'s location', () => {
  let g = game();
  addRunes(g, 0, 3, 'Order');
  const a = put(g, 0, 't-u3', 'base'), b = put(g, 0, 't-u3', 1);
  const e1 = put(g, 1, 't-u2', 0), e2 = put(g, 1, 't-u2', 0);
  g = attackInto(g, 0, [a], 0);
  g = act(g, { type: 'playCard', player: 0, obj: handCard(g, 0, 'unl-155-219') });
  // CR 355.16: b (no enemy at its location) isn't offered, so a is chosen automatically
  g = resolveChain(g);
  assert.deepEqual(pendingIds(g).sort(), [e1, e2].sort());
  void b;
  g = resolveChain(g, e2);
  assert.equal(g.objects[e2].stunned, true);
  assert.equal(M(g, a), 4);
  void b;
});

test('Moonfall: move up to one enemy unit to a battlefield where you have units, then enemies there -2', () => {
  let g = game();
  addRunes(g, 0, 4, 'Mind');
  setController(g, 0, 0);
  const f = put(g, 0, 't-u5', 0);
  const e = put(g, 1, 't-u4', 1);
  g = act(g, { type: 'playCard', player: 0, obj: handCard(g, 0, 'unl-198-219') });
  g = resolveChain(g, [e]);
  assert.equal(g.objects[e].battlefieldIndex, 0);
  assert.equal(M(g, e), 2);
  assert.equal(M(g, f), 5);
});

test('Lord Broadmane: Ambush — played as a Reaction to a battlefield where you have units; other units there get Assault', () => {
  let g = game();
  addRunes(g, 0, 6, 'Fury');
  const a = put(g, 0, 't-u3', 'base'), b = put(g, 0, 't-u1', 'base');
  put(g, 1, 't-u2', 0);
  g = attackInto(g, 0, [a], 0);
  assert.equal(g.pending?.kind, 'showdownAction');
  const lb = handCard(g, 0, 'unl-012-219');
  assert.ok(getLegalActionsFor(g, 0).some(x => x.type === 'playCard' && x.obj === lb && x.destination === 0), 'Ambush: playable to the battlefield mid-showdown');
  g = act(g, { type: 'playCard', player: 0, obj: lb, destination: 0 });
  g = resolveChain(g);
  assert.equal(zoneOf(g, lb), 'battlefield');
  assert.equal(kwVal(g, a, 'Assault'), 1);
  assert.equal(kwVal(g, b, 'Assault'), 0, 'units elsewhere are not "here"');
});
import { getLegalActions as getLegalActionsFor } from './_h.ts';

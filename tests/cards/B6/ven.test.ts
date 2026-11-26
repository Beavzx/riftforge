// B6 scenario tests: Vendetta (ven).
import { test } from 'node:test';
import {
  game, addRunes, exhaustRunes, play, playObj, playHere, activate, moveUnits, attackInto, endTurn, drive, doAct, resolveChain, put, handCard, M, buffs, ready, pendingIds,
  assert, hasKw, kwVal, zoneOf, setController, legalPlay, legalActivate, act, getLegalActions,
} from './_h.ts';

test('Forsaken Baccai: +1 at the start of your Beginning Phase if you control fewer runes than an opponent', () => {
  let g = game();
  const b = put(g, 0, 'ven-005-166', 'base');
  g = endTurn(g);
  addRunes(g, 1, 5);
  g = endTurn(g);
  assert.equal(g.activePlayer, 0);
  assert.ok(g.players[0].runesInPlay.length < g.players[1].runesInPlay.length);
  assert.equal(M(g, b), 3);
  // equal or more runes: nothing
  let h = game();
  const b2 = put(h, 0, 'ven-005-166', 'base');
  addRunes(h, 0, 6);
  h = endTurn(h); h = endTurn(h);
  assert.equal(M(h, b2), 2);
});

test('Oasis Raider: +2 and Ganking this turn when behind on runes', () => {
  let g = game();
  const o = put(g, 0, 'ven-006-166', 0);
  setController(g, 0, 0);
  g = endTurn(g);
  addRunes(g, 1, 5);
  g = endTurn(g);
  assert.equal(M(g, o), 6);
  assert.ok(hasKw(g, o, 'Ganking'));
  g = endTurn(g);
  assert.ok(!hasKw(g, o, 'Ganking'));
});

test('Field Musicians: when played, give a unit +3', () => {
  let g = game();
  addRunes(g, 0, 4, 'Calm');
  const a = put(g, 0, 't-u1', 'base');
  ({ g } = play(g, 0, 'ven-026-166', 'base', a));
  assert.equal(M(g, a), 4);
});

test('Resonating Strike: move a unit you control to a battlefield you control (from elsewhere) and +2', () => {
  let g = game();
  addRunes(g, 0, 4, 'Calm');
  setController(g, 0, 0);
  const keep = put(g, 0, 't-u1', 0);
  const a = put(g, 0, 't-u2', 'base');
  const s = handCard(g, 0, 'ven-034-166');
  assert.ok(hasKw(g, s, 'Hidden') && hasKw(g, s, 'Reaction'));
  // bf 0 is the only battlefield you control and the unit already there is excluded: both choices are forced
  g = playObj(g, 0, s, undefined);
  assert.equal(g.objects[a].battlefieldIndex, 0);
  assert.equal(M(g, a), 4);
  assert.equal(M(g, keep), 1);
});

test("Akali, Silent: can't be chosen by enemy spells unless in combat; +2 when moving to a battlefield", () => {
  let g = game();
  const ak = put(g, 0, 'ven-038-166', 'base');
  g = moveUnits(g, 0, [ak], 0);
  assert.equal(M(g, ak), 6);
  g = endTurn(g);
  addRunes(g, 1, 2);
  const shrink = handCard(g, 1, 't-b6-shrink');
  assert.equal(legalPlay(g, 1, shrink), false, 'not in combat: not choosable');
  // in combat she can be chosen
  const atk = put(g, 1, 't-u5', 'base');
  g = attackInto(g, 1, [atk], 0);
  assert.equal(g.pending?.kind, 'showdownAction');
  const legalNow = getLegalActions(g, g.pending!.player).some(x => x.type === 'playCard' && x.obj === shrink);
  if (g.pending!.player === 1) assert.ok(legalNow);
  else { g = act(g, { type: 'pass', player: 0 }); assert.ok(getLegalActions(g, 1).some(x => x.type === 'playCard' && x.obj === shrink)); }
});

test('Decree of Focus: only a friendly unit in combat with an enemy Fury unit can be chosen', () => {
  let g = game();
  addRunes(g, 0, 2, 'Calm');
  const a = put(g, 0, 't-u3', 'base');
  const s = handCard(g, 0, 'ven-040-166');
  assert.equal(legalPlay(g, 0, s), false);
  put(g, 1, 't-b6-fury3', 0);
  g = attackInto(g, 0, [a], 0);
  g = act(g, { type: 'playCard', player: 0, obj: s });
  g = resolveChain(g);
  assert.equal(M(g, a), 7);
});

test('Decree of Focus: a friendly unit being chosen by an enemy Fury spell can be chosen', () => {
  let g = game();
  addRunes(g, 0, 4, 'Calm');
  addRunes(g, 1, 2);
  const a = put(g, 0, 't-u3', 'base');
  // P0 opens the chain; P1 responds with a Fury spell on a; P0 responds with the Decree
  g = act(g, { type: 'playCard', player: 0, obj: handCard(g, 0, 't-b6-spell1') });
  g = act(g, { type: 'pass', player: 0 });
  const zap = handCard(g, 1, 't-b6-fury-zap');
  g = act(g, { type: 'playCard', player: 1, obj: zap });
  assert.equal(g.pending?.player, 1);   // target chosen automatically (only unit)
  g = act(g, { type: 'pass', player: 1 });
  const s = handCard(g, 0, 'ven-040-166');
  assert.ok(getLegalActions(g, 0).some(x => x.type === 'playCard' && x.obj === s));
  g = act(g, { type: 'playCard', player: 0, obj: s });
  g = drive(g);
  assert.equal(M(g, a), 7);
  assert.equal(g.objects[a].damage, 1);
});

test('Mesmerize: choose one — return a friendly unit, or an enemy unit -2', () => {
  let g = game();
  addRunes(g, 0, 4, 'Mind');
  const a = put(g, 0, 't-u2', 'base'), e = put(g, 1, 't-u3', 0);
  ({ g } = play(g, 0, 'ven-052-166', undefined, 'shrink'));
  assert.equal(M(g, e), 1);
  ({ g } = play(g, 0, 'ven-052-166', undefined, 'return'));
  assert.equal(zoneOf(g, a), 'hand');
});

test('Decree of Insight: enemy Body unit -5; Deflect is ignored while paying', () => {
  let g = game();
  exhaustRunes(g, 0);
  addRunes(g, 0, 1, 'Mind');
  const e = put(g, 1, 't-b6-bodydeflect', 0);
  put(g, 1, 't-b6-fury3', 0);
  const n = g.players[0].runesInPlay.length;
  ({ g } = play(g, 0, 'ven-061-166', undefined));
  assert.equal(M(g, e), 1);
  assert.equal(g.players[0].runesInPlay.length, n, 'no rune recycled for Deflect');
});

test('Fretful Feline: +2 whenever I become ready (Awaken included)', () => {
  let g = game();
  const f = put(g, 0, 'ven-071-166', 'base', { ready: false });
  g = endTurn(g); g = endTurn(g);
  assert.equal(M(g, f), 7);
});

test('Jayce, Hammer in Hand: when I become ready choose Assault 2 / Deflect 2 / Ganking this turn', () => {
  let g = game();
  addRunes(g, 0, 2);
  const j = put(g, 0, 'ven-088-166', 'base', { ready: false });
  ({ g } = play(g, 0, 'unl-009-219', undefined, 'no', 'Deflect 2'));
  assert.equal(kwVal(g, j, 'Deflect'), 2);
  g = endTurn(g);
  assert.equal(kwVal(g, j, 'Deflect'), 0);
});

test('Reluctant Leader: +2 when you play another unit', () => {
  let g = game();
  addRunes(g, 0, 2);
  const l = put(g, 0, 'ven-121-166', 'base');
  ({ g } = play(g, 0, 't-u1', 'base'));
  assert.equal(M(g, l), 5);
});

test("Hungry Wolf: [C] ready me +1; only if you've chosen an enemy unit this turn, once each turn", () => {
  let g = game();
  exhaustRunes(g, 0);
  addRunes(g, 0, 3, 'Order');
  const w = put(g, 0, 'ven-125-166', 'base', { ready: false });
  const e = put(g, 1, 't-u2', 0);
  assert.equal(legalActivate(g, 0, w), false, 'no enemy chosen yet');
  ({ g } = play(g, 0, 't-b6-shrink', undefined, e));
  assert.ok(legalActivate(g, 0, w));
  g = activate(g, 0, w, 0);
  assert.equal(ready(g, w), true);
  assert.equal(M(g, w), 5);
  g.objects[w].exhausted = true;
  assert.equal(legalActivate(g, 0, w), false, 'once each turn');
  g = endTurn(g); g = endTurn(g);
  assert.equal(legalActivate(g, 0, w), false, 'new turn: nothing chosen yet');
});

test('Dominus: double a unit\'s Might and give it "[A][A]: Ready me." this turn', () => {
  let g = game();
  addRunes(g, 0, 8, 'Body');
  const a = put(g, 0, 't-u3', 'base', { ready: false });
  ({ g } = play(g, 0, 'ven-142-166', undefined));
  assert.equal(M(g, a), 6);
  const acts = getLegalActions(g, 0).filter(x => x.type === 'activate' && x.obj === a);
  assert.equal(acts.length, 1);
  g = doAct(g, acts[0]);
  assert.equal(ready(g, a), true);
  g = endTurn(g); g = endTurn(g);
  assert.equal(getLegalActions(g, 0).filter(x => x.type === 'activate' && x.obj === a).length, 0, 'granted ability ends');
});

test('Acceleration Gate: ready up to 4 units, gear and/or runes, all chosen as it is played', () => {
  let g = game();
  exhaustRunes(g, 0);
  const rs = addRunes(g, 0, 4, 'Mind');
  const a = put(g, 0, 't-u1', 'base', { ready: false }), b = put(g, 0, 't-u1', 'base', { ready: false });
  const gear = put(g, 0, 't-b6-gear2', 'base', { ready: false });
  g = act(g, { type: 'playCard', player: 0, obj: handCard(g, 0, 'ven-150-166') });
  // RULINGS (CR 355.5): one target group of up to 4 among units, gear and runes, chosen before costs are paid
  assert.equal(g.pending?.kind, 'chooseTargets');
  assert.equal(g.pending?.max, 4);
  assert.ok(rs.every(r => pendingIds(g).includes(r)), 'ready runes are offered (they may be exhausted to pay for it)');
  g = drive(g, [a, gear, rs[0], rs[1]]);
  assert.equal(ready(g, a), true);
  assert.equal(ready(g, gear), true);
  assert.equal(ready(g, b), false);
  assert.equal(ready(g, rs[0]) && ready(g, rs[1]), true, 'the chosen runes were readied after paying');
});

void playObj; void playHere; void buffs; void drive;

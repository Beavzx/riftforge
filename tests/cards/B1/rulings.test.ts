// RULINGS agent: tests encoding researched rulings for B1 cards (see docs/rulings.md).
import { test } from 'node:test';
import {
  assert, game, setRunes, put, handCard, playAct, answer, isAsking, resolveAll, zoneOf, setController, legend, optionIds, xp, setXp,
  resolveCombat, act, pass,
} from './_util.ts';
import type { GameState, ObjId } from './_util.ts';

const emp = (g: GameState, id: ObjId) => g.objects[id].empowered ?? 0;

// CR 355.16 / 355.17 / 358.1: with no enemy unit of 3 Might or less at a battlefield, declining the optional XP cost would
// leave "Choose an enemy unit" without a legal choice, so the 5 XP must be spent (it is not offered as a choice).
test('RULING unl-140 Conscription: only big enemies — the 5 XP cost is paid, not declinable', () => {
  let g = game();
  setRunes(g, 0, { Chaos: 7 });
  setXp(g, 0, 5);
  const big = put(g, 1, 't-u5', 0);
  g = playAct(g, 0, handCard(g, 0, 'unl-140-219'));
  assert.equal(isAsking(g, 'optional'), false, 'no option to decline');
  g = resolveAll(g);
  assert.equal(g.objects[big].controller, 0);
  assert.equal(zoneOf(g, big), 'base');
  assert.equal(xp(g, 0), 0);
});

// CR 355.14.c: the number of recipients can't exceed the damage available when it is played (the unit's Might).
// CR 355.14.h: if there is less damage than targets on resolution, the controller picks which ones stay targets.
test('RULING unl-192 Alpha Strike: recipients limited to Might; on resolution the controller drops extra targets', () => {
  let g = game();
  setRunes(g, 0, { Calm: 2, Body: 2 });
  const f = put(g, 0, 't-u2', 'base');
  const e1 = put(g, 1, 't-u2', 0), e2 = put(g, 1, 't-u2', 1), e3 = put(g, 1, 't-u2', 1);
  g = playAct(g, 0, handCard(g, 0, 'unl-192-219'));
  assert.equal(g.pending!.max, 2, 'at most 2 recipients for 2 Might');
  g = answer(g, 'chooseTargets', e1, e2);
  // shrink the source in response: only 1 damage left
  g.objects[f].cardId = 't-u1'; g.ex.dirty = true;
  g = resolveAll(g);
  assert.ok(isAsking(g, 'chooseCards'));
  g = answer(g, 'chooseCards', e2);
  g = resolveAll(g);
  assert.equal(g.objects[e2].zone === 'trash' || g.objects[e2].damage === 1, true);
  assert.equal(g.objects[e1].damage ?? 0, 0);
  void e3;
});

// Origins FAQ / CR: tokens are not cards, so playing a token is never "playing a card from anywhere other than your hand".
test('RULING ven-155 Heart of the Tempest: token plays do not empower it', () => {
  let g = game();
  const l = legend(g, 0, 'ven-155-166');
  setRunes(g, 0, { Order: 6 });
  g = playAct(g, 0, handCard(g, 0, 'ogs-015-024'));   // Recruit the Vanguard from hand: plays four Recruit tokens
  for (let i = 0; i < 8 && isAsking(g); i++) g = answer(g, null, optionIds(g)[0]);
  g = resolveAll(g);
  for (let i = 0; i < 8 && isAsking(g); i++) { g = answer(g, null, optionIds(g)[0]); g = resolveAll(g); }
  assert.equal(emp(g, l), 0);
});

// CR 468.3.c: only units still at the battlefield inherit their controller's combat result.
test('RULING unl-095 Grim Resolve: a unit moved away from the battlefield before the result does not "win"', () => {
  let g = game();
  setRunes(g, 0, { Body: 2 });
  const u = put(g, 0, 't-u1', 'base'), v = put(g, 0, 't-u3', 'base');
  setController(g, 0, 1);
  const e = put(g, 1, 't-u1', 0);
  g = playAct(g, 0, handCard(g, 0, 'unl-095-219'));
  if (isAsking(g, 'chooseTargets')) g = answer(g, 'chooseTargets', u);
  g = resolveAll(g);
  g = act(g, { type: 'move', player: 0, units: [u, v], to: 0 });
  // stop in the combat showdown and take u out of the battlefield (as a "move to base" Action would)
  for (let i = 0; i < 10 && !(g.showdown && g.chain.length === 0); i++) g = pass(g);
  assert.ok(g.showdown, 'combat showdown open');
  g.objects[u].zone = 'base'; delete (g.objects[u] as { battlefieldIndex?: number }).battlefieldIndex; g.objects[u].combatRole = undefined as never; g.ex.dirty = true;
  g = resolveCombat(g, 0);
  assert.equal(zoneOf(g, e), 'trash', 'P0 won the combat with v');
  assert.equal(xp(g, 0), 0, 'u was not at the battlefield, so it did not win');
});

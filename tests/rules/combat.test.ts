import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, act, choose, pass, put, runes, handCard, resolveAll, zoneOf, setController, passUntilMain } from '../fixtures/helpers.ts';
import { fullDb } from '../fixtures/cards.ts';
import { getLegalActions, applyAction } from '../../src/engine/game.ts';
import { might } from '../../src/engine/chars.ts';
import { validateAssignment, assignTargets } from '../../src/engine/showdown.ts';
import type { GameState } from '../../src/engine/types.ts';
import { makeCtx } from '../../src/engine/context.ts';

const game = () => newGame({ db: fullDb() });
/** pass every showdown/chain decision (both players) until a main action or in-step decision */
const settle = (g: GameState) => resolveAll(g, 20);

test('move to an empty uncontrolled battlefield: non-combat showdown, then conquer (+1 point)', () => {
  let g = game();
  const u = put(g, 0, 't-u2', 'base');
  g = act(g, { type: 'move', player: 0, units: [u], to: 0 });
  assert.equal(g.objects[u].exhausted, true, 'standard move exhausts');
  assert.equal(g.battlefields[0].contested, true);
  assert.equal(g.showdown?.isCombat, false);
  g = settle(g);
  assert.equal(g.battlefields[0].controller, 0);
  assert.equal(g.battlefields[0].contested, false);
  assert.equal(g.players[0].points, 1);
});

test('moving to a battlefield you control does not contest it', () => {
  let g = game();
  setController(g, 0, 0);
  put(g, 0, 't-u1', 0);
  const u = put(g, 0, 't-u2', 'base');
  g = act(g, { type: 'move', player: 0, units: [u], to: 0 });
  assert.equal(g.battlefields[0].contested, false);
  assert.equal(g.showdown, null);
  assert.equal(g.pending?.kind, 'mainAction');
});

test('attack into a defended battlefield: attacker wins and conquers', () => {
  let g = game();
  setController(g, 0, 1);
  const d = put(g, 1, 't-u2', 0);
  const a = put(g, 0, 't-u4', 'base');
  g = act(g, { type: 'move', player: 0, units: [a], to: 0 });
  assert.equal(g.showdown?.isCombat, true);
  assert.equal(g.showdown?.attacker, 0);
  assert.equal(g.objects[a].combatRole, 'attacker');
  assert.equal(g.objects[d].combatRole, 'defender');
  g = settle(g);
  assert.equal(zoneOf(g, d), 'trash');
  assert.equal(zoneOf(g, a), 'battlefield');
  assert.equal(g.objects[a].damage, 0, 'healed after combat');
  assert.equal(g.battlefields[0].controller, 0);
  assert.equal(g.players[0].points, 1);
  assert.equal(g.objects[a].combatRole, undefined);
});

test('both sides survive: attackers are recalled, defender keeps control, no points', () => {
  let g = game();
  setController(g, 0, 1);
  const d = put(g, 1, 't-u5', 0);
  const a = put(g, 0, 't-u2', 'base');
  makeCtx(g, a, 0).prevent(a, 'all');
  g = act(g, { type: 'move', player: 0, units: [a], to: 0 });
  g = settle(g);
  assert.equal(zoneOf(g, a), 'base');
  assert.equal(zoneOf(g, d), 'battlefield');
  assert.equal(g.battlefields[0].controller, 1);
  assert.equal(g.players[0].points, 0);
});

test('both sides die: battlefield becomes uncontrolled, nobody conquers', () => {
  let g = game();
  setController(g, 0, 1);
  const d = put(g, 1, 't-u3', 0);
  const a = put(g, 0, 't-u3', 'base');
  g = act(g, { type: 'move', player: 0, units: [a], to: 0 });
  g = settle(g);
  assert.equal(zoneOf(g, a), 'trash');
  assert.equal(zoneOf(g, d), 'trash');
  assert.equal(g.battlefields[0].controller, null);
  assert.equal(g.players[0].points + g.players[1].points, 0);
});

test('defender wins: defender keeps control without scoring', () => {
  let g = game();
  setController(g, 0, 1);
  put(g, 1, 't-u4', 0);
  const a = put(g, 0, 't-u2', 'base');
  g = act(g, { type: 'move', player: 0, units: [a], to: 0 });
  g = settle(g);
  assert.equal(zoneOf(g, a), 'trash');
  assert.equal(g.battlefields[0].controller, 1);
  assert.equal(g.players[1].points, 0);
});

test('damage assignment: Tank must receive lethal first', () => {
  let g = game();
  setController(g, 0, 1);
  const tank = put(g, 1, 't-tank', 0);      // 3 might Tank
  const other = put(g, 1, 't-u1', 0);
  const a1 = put(g, 0, 't-u2', 'base'), a2 = put(g, 0, 't-u2', 'base');
  g = act(g, { type: 'move', player: 0, units: [a1, a2], to: 0 });
  g = settle(g);
  assert.equal(g.pending?.kind, 'assignDamage');
  assert.equal(g.pending?.player, 0);
  assert.throws(() => applyAction(g, { type: 'assignDamage', player: 0, assignment: { [other]: 1, [tank]: 2 } }), /exactly 4/);
  assert.throws(() => applyAction(g, { type: 'assignDamage', player: 0, assignment: { [other]: 2, [tank]: 2 } }), /ordering/);
  g = act(g, { type: 'assignDamage', player: 0, assignment: { [tank]: 3, [other]: 1 } });
  if (g.pending?.kind === 'assignDamage') g = act(g, { type: 'assignDamage', player: 1, assignment: g.pending.data!.suggested as Record<string, number> });
  g = settle(g);
  assert.equal(zoneOf(g, tank), 'trash');
  assert.equal(zoneOf(g, other), 'trash');
});

test('assignment validator: lethal before moving on, no overkill unless all lethal, Backline last, Tank+Backline either', () => {
  const ts = [
    { obj: 'a', lethal: 3, groups: [1] }, { obj: 'b', lethal: 3, groups: [1] }, { obj: 'c', lethal: 3, groups: [1] },
  ];
  assert.equal(validateAssignment(ts, 5, { a: 3, b: 2 }), null);
  assert.notEqual(validateAssignment(ts, 5, { a: 2, b: 1, c: 2 }), null);
  assert.notEqual(validateAssignment(ts, 5, { a: 5 }), null, 'no overkill while others lack lethal');
  assert.equal(validateAssignment(ts, 10, { a: 4, b: 3, c: 3 }), null, 'excess anywhere once all are lethal');
  const tb = [{ obj: 'x', lethal: 2, groups: [2] }, { obj: 'y', lethal: 2, groups: [1] }];
  assert.notEqual(validateAssignment(tb, 2, { x: 2 }), null, 'Backline last');
  assert.equal(validateAssignment(tb, 2, { y: 2 }), null);
  const both = [{ obj: 'cait', lethal: 2, groups: [0, 2] }, { obj: 'n', lethal: 2, groups: [1] }];
  assert.equal(validateAssignment(both, 2, { cait: 2 }), null);
  assert.equal(validateAssignment(both, 2, { n: 2 }), null);
});

test('lethal accounts for damage already marked this turn', () => {
  const g = game();
  const u = put(g, 1, 't-u3', 0);
  g.objects[u].damage = 2;
  assert.equal(assignTargets(g, [u])[0].lethal, 1);
});

test('Assault and Shield apply only while attacking / defending', () => {
  let g = game();
  setController(g, 0, 1);
  const s = put(g, 1, 't-shield', 0);     // 2 + Shield 2
  const a = put(g, 0, 't-assault', 'base');  // 2 + Assault 2
  assert.equal(might(g, a), 2);
  g = act(g, { type: 'move', player: 0, units: [a], to: 0 });
  assert.equal(might(g, a), 4);
  assert.equal(might(g, s), 4);
  g = settle(g);
  assert.equal(zoneOf(g, a), 'trash');
  assert.equal(zoneOf(g, s), 'trash');
});

test('stunned units deal no combat damage', () => {
  let g = game();
  setController(g, 0, 1);
  const d = put(g, 1, 't-u5', 0);
  g.objects[d].stunned = true;
  const a = put(g, 0, 't-u2', 'base');
  g = act(g, { type: 'move', player: 0, units: [a], to: 0 });
  g = settle(g);
  assert.equal(zoneOf(g, a), 'base', 'survived (recalled)');
  assert.equal(g.objects[d].damage, 0);
});

test('final point: conquering at 7 without having scored the other battlefield draws a card instead', () => {
  let g = game();
  g.players[0].points = 7;
  const u = put(g, 0, 't-u2', 'base');
  const hand = g.players[0].hand.length;
  g = act(g, { type: 'move', player: 0, units: [u], to: 0 });
  g = settle(g);
  assert.equal(g.battlefields[0].controller, 0);
  assert.equal(g.players[0].points, 7);
  assert.equal(g.players[0].hand.length, hand + 1);
  assert.equal(g.winner, null);
});

test('final point: conquering at 7 after scoring the other battlefield this turn wins', () => {
  let g = game();
  g.players[0].points = 6;
  setController(g, 1, 0);
  put(g, 0, 't-u1', 1);
  // simulate: p0's turn; end turn then on p0's next turn hold bf1 (6->7) then conquer bf0
  g = pass(g); g = passUntilMain(g, 1);
  g = pass(g); g = passUntilMain(g, 0);
  assert.equal(g.players[0].points, 7);
  const u = put(g, 0, 't-u2', 'base');
  g = act(g, { type: 'move', player: 0, units: [u], to: 0 });
  g = settle(g);
  assert.equal(g.winner, 0);
});

test('each battlefield can be scored only once per turn', () => {
  let g = game();
  const u = put(g, 0, 't-u2', 'base');
  const v = put(g, 0, 't-ganker', 'base');
  g = act(g, { type: 'move', player: 0, units: [u], to: 0 });
  g = settle(g);
  assert.equal(g.players[0].points, 1);
  g.objects[u].exhausted = false;
  g = act(g, { type: 'move', player: 0, units: [u], to: 'base' });
  assert.equal(g.battlefields[0].controller, null);
  g = act(g, { type: 'move', player: 0, units: [v], to: 0 });
  g = settle(g);
  assert.equal(g.battlefields[0].controller, 0);
  assert.equal(g.players[0].points, 1, 'no second point');
});

test('Ganking allows battlefield-to-battlefield moves; others can’t', () => {
  const g = game();
  setController(g, 0, 0);
  const gk = put(g, 0, 't-ganker', 0), plain = put(g, 0, 't-u2', 0);
  const legal = getLegalActions(g, 0).filter(a => a.type === 'move');
  assert.ok(legal.some(a => a.type === 'move' && a.units.length === 1 && a.units[0] === gk && a.to === 1));
  assert.ok(!legal.some(a => a.type === 'move' && a.units.includes(plain) && a.to === 1));
});

test('exhausted units cannot standard move; multi-unit moves are one action', () => {
  const g = game();
  const a = put(g, 0, 't-u1', 'base', { ready: false });
  const b = put(g, 0, 't-u1', 'base'), c = put(g, 0, 't-u1', 'base');
  const legal = getLegalActions(g, 0).filter(x => x.type === 'move');
  assert.ok(!legal.some(x => x.type === 'move' && x.units.includes(a)));
  assert.ok(legal.some(x => x.type === 'move' && x.units.length === 2 && x.units.includes(b) && x.units.includes(c)));
});

test('control is lost when your last unit leaves a battlefield', () => {
  let g = game();
  setController(g, 0, 0);
  const u = put(g, 0, 't-u1', 0);
  g = act(g, { type: 'move', player: 0, units: [u], to: 'base' });
  assert.equal(g.battlefields[0].controller, null);
});

test('Disarm: when it attacks, an enemy unit there gets -X Might this turn', () => {
  let g = game();
  setController(g, 0, 1);
  const d = put(g, 1, 't-u3', 0);
  const a = put(g, 0, 't-disarm', 'base');   // 3 might, Disarm 2
  g = act(g, { type: 'move', player: 0, units: [a], to: 0 });
  g = settle(g);
  assert.equal(zoneOf(g, d), 'trash');
  assert.equal(zoneOf(g, a), 'battlefield', 'took only 1 damage');
});

test('Hunt: conquering gains XP', () => {
  let g = game();
  const h = put(g, 0, 't-hunt', 'base');
  g = act(g, { type: 'move', player: 0, units: [h], to: 0 });
  g = settle(g);
  assert.equal(g.players[0].xp, 2);
});

test('conquer trigger (When I conquer) fires', () => {
  let g = game();
  const c = put(g, 0, 'ts-conq', 'base');
  const hand = g.players[0].hand.length;
  g = act(g, { type: 'move', player: 0, units: [c], to: 0 });
  g = settle(g);
  assert.equal(g.players[0].hand.length, hand + 1);
});

test('a reaction during combat can change the outcome (pump the defender)', () => {
  let g = game();
  setController(g, 0, 1);
  const d = put(g, 1, 't-u3', 0);
  runes(g, 1, 1);
  const pump = handCard(g, 1, 'ts-zap');   // reaction: deal 2 to attacker
  const a = put(g, 0, 't-u4', 'base');
  g = act(g, { type: 'move', player: 0, units: [a], to: 0 });
  g = pass(g);                    // attacker (focus) passes
  g = act(g, { type: 'playCard', player: 1, obj: pump });
  if (g.pending?.kind === 'chooseTargets') g = choose(g, a);
  g = settle(g);
  assert.equal(zoneOf(g, a), 'trash');
  assert.equal(zoneOf(g, d), 'trash');
});

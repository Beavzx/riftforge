import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, act, choose, pass, put, runes, handCard, resolveAll, zoneOf, setController, passUntilMain } from '../fixtures/helpers.ts';
import { fullDb } from '../fixtures/cards.ts';
import { getLegalActions, validateAction } from '../../src/engine/game.ts';

const game = () => newGame({ db: fullDb() });

test('a normal-speed card cannot be played on the opponent’s turn or in response', () => {
  let g = game();
  const z = handCard(g, 0, 'ts-zap');
  const mod = handCard(g, 1, 'ts-modal');
  const t = put(g, 0, 't-u2', 'base');
  g = act(g, { type: 'playCard', player: 0, obj: z });
  if (g.pending?.kind === 'chooseTargets') g = choose(g, t);
  g = pass(g);
  assert.equal(g.pending?.player, 1);
  assert.ok(validateAction(g, { type: 'playCard', player: 1, obj: mod }) !== null);
});

test('priority: after playing, the player keeps priority; resolving needs both to pass; LIFO', () => {
  let g = game();
  runes(g, 0, 2);
  const t = put(g, 1, 't-u5', 'base');
  const z1 = handCard(g, 0, 'ts-zap');
  const p1 = handCard(g, 0, 'ts-pump');
  g = act(g, { type: 'playCard', player: 0, obj: z1 });
  if (g.pending?.kind === 'chooseTargets') g = choose(g, t);
  assert.equal(g.pending?.kind, 'chainResponse');
  assert.equal(g.pending?.player, 0);
  // Action speed pump can't be played while the chain exists (needs Reaction)
  assert.ok(validateAction(g, { type: 'playCard', player: 0, obj: p1 }) !== null);
  g = pass(g);
  assert.equal(g.pending?.player, 1);
  g = pass(g);
  assert.equal(g.chain.length, 0);
  assert.equal(g.objects[t].damage, 2);
});

test('Action spells can be played during a showdown by the focus holder', () => {
  let g = game();
  setController(g, 0, null);
  const u = put(g, 0, 't-u2', 'base');
  const pump = handCard(g, 1, 'ts-pump');
  runes(g, 1, 1);
  put(g, 1, 't-u2', 'base');
  g = act(g, { type: 'move', player: 0, units: [u], to: 0 });
  assert.equal(g.pending?.kind, 'showdownAction');
  assert.equal(g.pending?.player, 0);
  g = pass(g);
  assert.equal(g.pending?.player, 1);
  assert.ok(getLegalActions(g, 1).some(a => a.type === 'playCard' && a.obj === pump));
  g = pass(g);
  // all passed -> showdown ends -> conquer
  assert.equal(g.battlefields[0].controller, 0);
  assert.equal(g.players[0].points, 1);
});

test('showdown focus passes after a chain started by a played card resolves', () => {
  let g = game();
  const u = put(g, 0, 't-u2', 'base');
  const pump = handCard(g, 0, 'ts-pump');
  g = act(g, { type: 'move', player: 0, units: [u], to: 0 });
  g = act(g, { type: 'playCard', player: 0, obj: pump });
  if (g.pending?.kind === 'chooseTargets') g = choose(g, u);
  g = resolveAll(g, 2);           // both pass on the chain
  assert.equal(g.chain.length, 0);
  assert.equal(g.pending?.kind, 'showdownAction');
  assert.equal(g.pending?.player, 1, 'focus moved to the opponent');
});

test('units can only be played to base or battlefields you control', () => {
  const g = game();
  setController(g, 1, 0);
  put(g, 0, 't-u1', 1);
  const u = handCard(g, 0, 't-u2');
  const dests = getLegalActions(g, 0).filter(a => a.type === 'playCard' && a.obj === u).map(a => (a as { destination?: unknown }).destination);
  assert.deepEqual(dests.sort(), [1, 'base'].sort());
});

test('Hidden: hide for [A]; can’t play it the same turn; next turn it plays free as a Reaction, only to that battlefield', () => {
  let g = game();
  setController(g, 0, 0);
  put(g, 0, 't-u1', 0);
  const h = handCard(g, 0, 't-hidden');
  const hide = getLegalActions(g, 0).find(a => a.type === 'hide' && a.obj === h);
  assert.ok(hide);
  g = act(g, hide!);
  assert.equal(g.objects[h].zone, 'facedown');
  assert.ok(!getLegalActions(g, 0).some(a => a.type === 'playCard' && a.obj === h));
  // opponent's turn: p0 can respond with the hidden card when p1 plays something
  g = pass(g); g = passUntilMain(g, 1);
  const z = handCard(g, 1, 'ts-drawer');
  g = act(g, { type: 'playCard', player: 1, obj: z, destination: 'base' });
  g = pass(g);   // p1 passes priority on its own trigger
  assert.equal(g.pending?.player, 0);
  const play = getLegalActions(g, 0).find(a => a.type === 'playCard' && a.obj === h);
  assert.ok(play, 'hidden card playable as a reaction');
  const energy = g.players[0].runesInPlay.filter(r => !g.objects[r].exhausted).length;
  g = act(g, play!);
  assert.equal(g.objects[h].zone, 'battlefield');
  assert.equal(g.objects[h].battlefieldIndex, 0);
  assert.equal(g.players[0].runesInPlay.filter(r => !g.objects[r].exhausted).length, energy, 'free');
});

test('Hidden card is discarded when its battlefield is no longer controlled by its controller', () => {
  let g = game();
  setController(g, 0, 0);
  const u = put(g, 0, 't-u1', 0);
  const h = handCard(g, 0, 't-hidden');
  g = act(g, getLegalActions(g, 0).find(a => a.type === 'hide' && a.obj === h)!);
  g = act(g, { type: 'move', player: 0, units: [u], to: 'base' });
  assert.equal(g.battlefields[0].controller, null);
  assert.equal(zoneOf(g, h), 'trash');
});

test('Ambush: play a unit as a Reaction to a battlefield where you have units', () => {
  let g = game();
  setController(g, 1, 1);
  put(g, 1, 't-u2', 1);
  const amb = handCard(g, 1, 't-ambush');
  runes(g, 1, 2);
  const a = put(g, 0, 't-u3', 'base');
  g = act(g, { type: 'move', player: 0, units: [a], to: 1 });
  // combat at bf 1: p0 has focus first
  assert.equal(g.pending?.kind, 'showdownAction');
  g = pass(g);
  const pl = getLegalActions(g, 1).filter(x => x.type === 'playCard' && x.obj === amb);
  assert.ok(pl.some(x => (x as { destination?: unknown }).destination === 1));
  g = act(g, pl.find(x => (x as { destination?: unknown }).destination === 1)!);
  assert.equal(g.objects[amb].battlefieldIndex, 1);
  assert.equal(g.objects[amb].combatRole, 'defender');
});

test('end turn is only legal in the main phase window; pass is used elsewhere', () => {
  const g = game();
  assert.equal(validateAction(g, { type: 'endTurn', player: 0 }), null);
  assert.notEqual(validateAction(g, { type: 'endTurn', player: 1 }), null);
});

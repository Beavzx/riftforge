// SCRIPT-FIX: the Round 2 timing sweep of docs/rulings.md ("Sweep: resolution-time choices that break the general timing rule").
// Costs at the start of a trigger's effect are paid as it goes on the chain (CR 383.3.b); specific objects are chosen when
// a spell / ability is played or a trigger goes on the chain (CR 355.5, 403.2). Each test stops right after the choice and
// checks that the cost is already paid / the choice recorded while the item is still on the chain, then resolves it.
// (Other cards of the sweep are covered in their batch tests: Forge of the Future, Hexplosive Minefield (B3); Heedless
// Resurrection (B5); Monastery of Hirana, Fortified Position, Durand Memorial (B8); Profiteer (B1); Gust Monk (B7); Edge of
// Night, Azir, Cursed Sarcophagus (B2).)
import { test } from 'node:test';
import {
  game, mana, run, play, playNew, activate, put, handCard, zoneOf, assert, expectDecision, setController, handSize, m, act,
  hideAt, setBattlefieldCard,
} from './B2/util.ts';
import type { GameState, ObjId } from '../../src/engine/types.ts';

const choose = (g: GameState, ...ids: string[]) => act(g, { type: 'choose', player: g.pending!.player, optionIds: ids });
const endTurn = (g: GameState) => run(act(g, { type: 'endTurn', player: g.pending!.player }));
const onChain = (g: GameState) => g.chain.filter(c => !c.pending).length;

test('Ziggs, Explosive: "you may kill a friendly gear" is paid as the defend trigger goes on the chain', () => {
  let g = game();
  setController(g, 0, 1);
  const z = put(g, 1, 'rad-112-167', 0);
  const gear = put(g, 1, 'ogn-242-298', 'base');
  const a = put(g, 0, 't-u5', 'base');
  const base = m(g, z)!;
  g = run(act(g, { type: 'move', player: 0, units: [a], to: 0 }));
  expectDecision(g, 'optional', 1);
  g = choose(g, 'yes');                                   // the only friendly gear: killed as the cost, no question
  assert.equal(zoneOf(g, gear), 'trash', 'gear killed while the trigger goes on the chain');
  assert.ok(onChain(g) >= 1);
  assert.equal(m(g, z), base, '+2 only on resolution');
  g = run(g);
  assert.equal(zoneOf(g, a), 'trash', '4 + 2 Ziggs kills the 5-Might attacker');
});

test('Ziggs, Explosive: no friendly gear — the trigger is not offered', () => {
  let g = game();
  setController(g, 0, 1);
  put(g, 1, 'rad-112-167', 0);
  const a = put(g, 0, 't-u2', 'base');
  g = run(act(g, { type: 'move', player: 0, units: [a], to: 0 }));
  assert.notEqual(g.pending?.kind, 'optional');
});

test('Rumble, Hotheaded: the recycle is paid on the chain; the Mech is played on resolution, cheaper by the recycled Might', () => {
  let g = game();
  const r = put(g, 0, 'sfd-026-221', 'base');
  const ally = put(g, 0, 't-u2', 'base'), other = put(g, 0, 't-u1', 'base');
  const fc = put(g, 0, 'sfd-065-221', 'trash');         // Forecaster: Mech, [2]
  g = run(act(g, { type: 'move', player: 0, units: [r], to: 0 }));
  expectDecision(g, 'optional', 0);
  g = choose(g, 'yes');
  assert.deepEqual(expectDecision(g, 'chooseCards', 0).sort(), [ally, other].sort());
  g = choose(g, ally);
  assert.equal(zoneOf(g, ally), 'mainDeck', 'recycled as the trigger goes on the chain');
  assert.equal(zoneOf(g, fc), 'trash');
  g = run(g, 'base');
  assert.equal(zoneOf(g, fc), 'base', '[2] - 2 Might = free');
});

test("Emperor's Dais: [1] + returning a unit here are paid on the chain; the Sand Soldier comes on resolution", () => {
  let g = game();
  setBattlefieldCard(g, 0, 'sfd-207-221');
  mana(g, 0, 1);
  const a = put(g, 0, 't-u2', 'base'), b = put(g, 0, 't-u2', 'base');
  g = run(act(g, { type: 'move', player: 0, units: [a, b], to: 0 }));
  expectDecision(g, 'optional', 0);
  g = choose(g, 'yes');
  g = choose(g, a);
  assert.equal(zoneOf(g, a), 'hand', 'returned as the cost');
  assert.equal(g.players[0].runesInPlay.filter(x => !g.objects[x].exhausted).length, 0, '[1] paid');
  const soldiers = (gg: GameState) => Object.values(gg.objects).filter(o => o.isToken && o.zone === 'battlefield' && gg.cards[o.cardId]?.name === 'Sand Soldier').length;
  assert.equal(soldiers(g), 0);
  g = run(g);
  assert.equal(soldiers(g), 1);
});

test('Wildclaw Shaman: spending a buff is the play trigger\'s cost; buff + ready on resolution', () => {
  let g = game();
  mana(g, 0, 3, 'Body');
  const bu = put(g, 0, 't-u2', 'base');
  g.objects[bu].counters.buff = 1;
  let w: ObjId;
  [g, w] = playNew(g, 0, 'ogn-147-298');
  g = run(g);
  expectDecision(g, 'optional', 0);
  g = choose(g, 'yes');
  assert.equal(g.objects[bu].counters.buff ?? 0, 0, 'buff spent on the chain');
  assert.ok(!(g.objects[w].counters.buff), 'not buffed yet');
  g = run(g);
  assert.equal(g.objects[w].counters.buff, 1);
  assert.equal(g.objects[w].exhausted, false);
});

test('Dusk Rose Lab: the kill is paid as the Beginning Phase trigger goes on the chain; draw on resolution', () => {
  let g = game();
  setBattlefieldCard(g, 0, 'unl-209-219');
  setController(g, 0, 0);
  const u = put(g, 0, 't-u2', 0);
  g = endTurn(g);
  g = endTurn(g);
  expectDecision(g, 'optional', 0);
  const h = handSize(g, 0);
  g = choose(g, 'yes');
  assert.equal(zoneOf(g, u), 'trash', 'killed as the cost');
  assert.equal(handSize(g, 0), h);
  g = run(g);
  assert.ok(handSize(g, 0) >= h + 1);
});

test('Shadow Order Disciple: [Burn 1] is paid as the move trigger goes on the chain; +1 on resolution', () => {
  let g = game();
  const d = put(g, 0, 'ven-095-166', 'base');
  const top = put(g, 0, 't-u4', 'deckTop');
  g = run(act(g, { type: 'move', player: 0, units: [d], to: 0 }));
  expectDecision(g, 'optional', 0);
  g = choose(g, 'yes');
  assert.equal(zoneOf(g, top), 'trash', 'burned as the cost');
  assert.equal(m(g, d), 2);
  g = run(g);
  assert.equal(m(g, d), 3);
});

test('Navori Fighting Pit: the unit to buff is chosen as the hold trigger goes on the chain', () => {
  let g = game();
  setBattlefieldCard(g, 0, 'ogn-283-298');
  setController(g, 0, 0);
  const a = put(g, 0, 't-u2', 0), b = put(g, 0, 't-u1', 0);
  g = endTurn(g); g = endTurn(g);
  assert.deepEqual(expectDecision(g, 'chooseTargets', 0).sort(), [a, b].sort());
  g = choose(g, b);
  assert.deepEqual(g.chain.at(-1)?.targets, [[b]]);
  g = run(g);
  assert.equal(g.objects[b].counters.buff, 1);
  assert.ok(!g.objects[a].counters.buff);
});

test('Shuriken Flip: the friendly unit to move is a target chosen as the spell is played', () => {
  let g = game();
  mana(g, 0, 1, 'Calm');
  const e = put(g, 1, 't-u1', 0);
  const f1 = put(g, 0, 't-u2', 'base'), f2 = put(g, 0, 't-u3', 'base');
  [g] = playNew(g, 0, 'ven-140-166');
  expectDecision(g, 'chooseTargets', 0);
  g = choose(g, e);
  assert.deepEqual(expectDecision(g, 'chooseTargets', 0).sort(), [f1, f2].sort(), 'friendly unit chosen while playing');
  g = choose(g, f1);
  expectDecision(g, 'chooseDestination', 0);              // R-2 (CR 355.4): its destination too
  g = choose(g, '1');
  assert.equal(g.chain.at(-1)?.kind, 'spell');
  assert.deepEqual(g.chain.at(-1)?.targets, [[e], [f1], [g.battlefields[1].objId]]);
  g = run(g);
  assert.equal(zoneOf(g, e), 'trash');
  assert.equal(g.objects[f1].battlefieldIndex, 1);
});

test('Chronobreak: the units to banish are chosen as it is played (after X), not on resolution', () => {
  let g = game();
  mana(g, 0, 4);
  const a = put(g, 0, 't-u2', 'base'), b = put(g, 0, 't-u3', 'base'), c = put(g, 0, 't-u1', 'base');
  [g] = playNew(g, 0, 'rad-140-167');
  expectDecision(g, 'chooseNumber', 0);
  g = choose(g, '1');
  assert.deepEqual(expectDecision(g, 'chooseTargets', 0).sort(), [a, b, c].sort());
  assert.ok(g.chain.at(-1)?.pending, 'still being played');
  g = choose(g, b);
  g = run(g);
  assert.equal(zoneOf(g, b), 'base', 'banished and played back');
  assert.equal(g.objects[b].exhausted, true, 'a new object (enters exhausted)');
  assert.equal(zoneOf(g, a), 'base');
});

test('Pack of Wonders: the facedown card is a target chosen as the ability is activated', () => {
  let g = game();
  setController(g, 0, 0); setController(g, 1, 0);
  const p = put(g, 0, 'ogn-181-298', 'base');
  put(g, 0, 't-u1', 0); put(g, 0, 't-u1', 1);
  const f0 = hideAt(g, 0, 't-hidden', 0), f1 = hideAt(g, 0, 't-hidden', 1);
  g = activate(g, 0, p, 0);
  g = choose(g, 'facedown');
  assert.deepEqual(expectDecision(g, 'chooseTargets', 0).sort(), [f0, f1].sort());
  g = choose(g, f1);
  g = run(g);
  assert.equal(zoneOf(g, f1), 'hand');
  assert.equal(zoneOf(g, f0), 'facedown');
});

void play; void handCard;

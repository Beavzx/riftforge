// Card-script DSL tests using hand-made cards in tests/fixtures/scripts.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, act, choose, yes, no, pass, put, runes, handCard, resolveAll, zoneOf, setController, find } from '../fixtures/helpers.ts';
import { fullDb } from '../fixtures/cards.ts';
import { might, hasKw } from '../../src/engine/chars.ts';
import { getLegalActions } from '../../src/engine/game.ts';
import type { GameState } from '../../src/engine/types.ts';

function game(): GameState { return newGame({ db: fullDb() }); }

test('spell with a target: Bolt deals 3 to a unit at a battlefield', () => {
  let g = game();
  setController(g, 0, 1);
  const enemy = put(g, 1, 't-u3', 0);
  const myBase = put(g, 0, 't-u3', 'base');
  const bolt = handCard(g, 0, 'ts-bolt');
  g = act(g, { type: 'playCard', player: 0, obj: bolt });
  // only the battlefield unit is a legal target -> auto-chosen (single option)
  assert.equal(g.pending?.kind, 'chainResponse');
  assert.equal(g.pending?.player, 0);   // CR 338.1.a.5: the controller of the newest item gets priority first
  g = pass(g); // I pass
  g = pass(g); // opp passes -> resolve
  assert.equal(zoneOf(g, enemy), 'trash');
  assert.equal(zoneOf(g, myBase), 'base');
  assert.equal(zoneOf(g, bolt), 'trash');
});

test('reaction counterspell counters the spell; countered card goes to trash', () => {
  let g = game();
  const target = put(g, 1, 't-u2', 'base');
  const zap = handCard(g, 0, 'ts-zap');
  const ctr = handCard(g, 1, 'ts-counter');
  runes(g, 1, 3);
  g = act(g, { type: 'playCard', player: 0, obj: zap });
  if (g.pending?.kind === 'chooseTargets') g = choose(g, target);
  assert.equal(g.pending?.kind, 'chainResponse');
  g = pass(g);                       // p0 passes priority to p1
  g = act(g, { type: 'playCard', player: 1, obj: ctr });
  assert.equal(g.chain.length, 2);
  g = resolveAll(g);
  assert.equal(g.chain.length, 0);
  assert.equal(g.objects[target].damage, 0);
  assert.equal(zoneOf(g, zap), 'trash');
  assert.equal(zoneOf(g, ctr), 'trash');
});

test('modal spell: choose a mode, then targets', () => {
  let g = game();
  const t = put(g, 1, 't-u2', 'base');
  const m = handCard(g, 0, 'ts-modal');
  g = act(g, { type: 'playCard', player: 0, obj: m });
  assert.equal(g.pending?.kind, 'chooseMode');
  g = choose(g, 'ping');
  if (g.pending?.kind === 'chooseTargets') g = choose(g, t);   // single legal target is auto-chosen
  g = resolveAll(g);
  assert.equal(g.objects[t].damage, 1);
});

test('split damage is divided as chosen', () => {
  let g = game();
  runes(g, 0, 2);
  const a = put(g, 1, 't-u3', 'base'), b = put(g, 1, 't-u3', 'base');
  const s = handCard(g, 0, 'ts-split');
  g = act(g, { type: 'playCard', player: 0, obj: s });
  g = choose(g, a, b);
  g = resolveAll(g);
  assert.equal(g.pending?.kind, 'chooseNumber');   // the division is chosen on resolution (CR 355.14)
  g = choose(g, '3');
  g = resolveAll(g);
  assert.equal(zoneOf(g, a), 'trash');
  assert.equal(g.objects[b].damage, 1);
});

test('Repeat: paying the repeat cost executes the effect twice with new choices', () => {
  let g = game();
  runes(g, 0, 2);
  const a = put(g, 1, 't-u1', 'base'), b = put(g, 1, 't-u1', 'base');
  const s = handCard(g, 0, 'ts-repeat');
  g = act(g, { type: 'playCard', player: 0, obj: s });
  g = choose(g, a);
  assert.equal(g.pending?.kind, 'optional');
  g = yes(g);
  g = resolveAll(g);
  // second execution asks a new target
  assert.equal(g.pending?.kind, 'chooseTargets');
  g = choose(g, b);
  g = resolveAll(g);
  assert.equal(zoneOf(g, a), 'trash');
  assert.equal(zoneOf(g, b), 'trash');
});

test('Flow: a spell in the trash can be played for its Flow cost, then it is banished', () => {
  let g = game();
  const f = put(g, 0, 'ts-flow', 'trash');
  const hand0 = g.players[0].hand.length;
  const legal = getLegalActions(g, 0);
  assert.ok(legal.some(a => a.type === 'playCard' && a.obj === f));
  g = act(g, { type: 'playCard', player: 0, obj: f });
  g = resolveAll(g);
  assert.equal(zoneOf(g, f), 'banishment');
  assert.equal(g.players[0].hand.length, hand0 + 1);
  assert.equal(g.players[0].runesInPlay.filter(r => g.objects[r].exhausted).length, 2);
});

test('when you play me: draw', () => {
  let g = game();
  const d = handCard(g, 0, 'ts-drawer');
  const before = g.players[0].hand.length;
  g = act(g, { type: 'playCard', player: 0, obj: d, destination: 'base' });
  assert.equal(g.chain.length, 1);
  g = resolveAll(g);
  assert.equal(g.players[0].hand.length, before - 1 + 1);
  assert.equal(zoneOf(g, d), 'base');
  assert.equal(g.objects[d].exhausted, true);
});

test('deathknell triggers when the unit dies', () => {
  let g = game();
  const dk = put(g, 1, 'ts-dk', 'base');
  const zap = handCard(g, 0, 'ts-zap');
  const opp = g.players[1].hand.length;
  g = act(g, { type: 'playCard', player: 0, obj: zap });
  if (g.pending?.kind === 'chooseTargets') g = choose(g, dk);
  g = resolveAll(g);
  assert.equal(zoneOf(g, dk), 'trash');
  assert.equal(g.players[1].hand.length, opp + 1);
});

test('anthem static: other friendly units get +1 Might, not self, not enemies', () => {
  const g = game();
  const cap = put(g, 0, 'ts-anthem', 'base');
  const mine = put(g, 0, 't-u2', 'base');
  const theirs = put(g, 1, 't-u2', 'base');
  assert.equal(might(g, cap), 2);
  assert.equal(might(g, mine), 3);
  assert.equal(might(g, theirs), 2);
});

test('Legion: dependent ability active only after playing another card this turn', () => {
  let g = game();
  const l = handCard(g, 0, 'ts-legion');
  const u1 = handCard(g, 0, 't-u1');
  runes(g, 0, 2);
  g = act(g, { type: 'playCard', player: 0, obj: u1, destination: 'base' });
  g = act(g, { type: 'playCard', player: 0, obj: l, destination: 'base' });
  assert.equal(might(g, l), 4);
});

test('activated ability with exhaust cost goes on the chain and resolves', () => {
  let g = game();
  setController(g, 0, 1);
  const p = put(g, 0, 'ts-pinger', 'base');
  const e = put(g, 1, 't-u1', 0);
  const legal = getLegalActions(g, 0);
  const a = legal.find(x => x.type === 'activate' && x.obj === p);
  assert.ok(a);
  g = act(g, a!);
  assert.equal(g.objects[p].exhausted, true);
  g = resolveAll(g);
  assert.equal(zoneOf(g, e), 'trash');
  assert.ok(!getLegalActions(g, 0).some(x => x.type === 'activate' && x.obj === p));
});

test('triggers on other plays: when you play a spell', () => {
  let g = game();
  const w = put(g, 0, 'ts-spellwatch', 'base');
  const t = put(g, 1, 't-u3', 'base');
  const zap = handCard(g, 0, 'ts-zap');
  g = act(g, { type: 'playCard', player: 0, obj: zap });
  if (g.pending?.kind === 'chooseTargets') g = choose(g, t);
  g = resolveAll(g);
  assert.equal(might(g, w), 2);
});

test('replacement: would die -> heal, exhaust, recall instead', () => {
  let g = game();
  setController(g, 1, 1);
  const guard = put(g, 1, 'ts-guard', 'base');
  const ally = put(g, 1, 't-u2', 1);
  const zap = handCard(g, 0, 'ts-zap');
  g = act(g, { type: 'playCard', player: 0, obj: zap });
  g = choose(g, ally);
  g = resolveAll(g);
  assert.equal(zoneOf(g, ally), 'base');
  assert.equal(g.objects[ally].damage, 0);
  assert.equal(g.objects[ally].exhausted, true);
  assert.equal(zoneOf(g, guard), 'base');
});

test('token creation: Recruit token to base', () => {
  let g = game();
  const r = handCard(g, 0, 'ts-recruiter');
  g = act(g, { type: 'playCard', player: 0, obj: r, destination: 'base' });
  g = resolveAll(g);
  const toks = Object.values(g.objects).filter(o => o.isToken && o.controller === 0);
  assert.equal(toks.length, 1);
  assert.equal(g.cards[toks[0].cardId].name, 'Recruit');
});

test('equip: attaching gives its Might bonus; detaches when the unit dies and gear is recalled', () => {
  let g = game();
  setController(g, 0, 0);
  const sword = put(g, 0, 'ts-sword', 'base');
  const u = put(g, 0, 't-u2', 0);
  const legal = getLegalActions(g, 0);
  const eq = legal.find(a => a.type === 'activate' && a.obj === sword);
  assert.ok(eq, 'equip available');
  g = act(g, eq!);
  g = resolveAll(g);
  assert.equal(g.objects[sword].attachedTo, u);
  assert.equal(might(g, u), 4);
  assert.equal(g.objects[sword].battlefieldIndex, 0);
  // kill the unit
  const zap = handCard(g, 1, 'ts-zap'); void zap;
  g.objects[u].damage = 10; g.ex.dirty = true;
  g = act(g, { type: 'endTurn', player: 0 });
  assert.equal(zoneOf(g, u), 'trash');
  assert.equal(g.objects[sword].attachedTo, undefined);
  assert.equal(zoneOf(g, sword), 'base');
});

test('mana ability usable by the auto-payer (Gold: kill this, exhaust: add any power)', () => {
  let g = game();
  // no runes; a 1-energy card needs energy, Gold only gives power -> not payable; a power-only cost is payable
  for (const r of [...g.players[0].runesInPlay]) { g.objects[r].exhausted = true; }
  const gold = put(g, 0, 'ts-gold', 'base');
  const calm = handCard(g, 0, 't-calm2'); // 2 energy + 1 calm
  assert.ok(!getLegalActions(g, 0).some(a => a.type === 'playCard' && a.obj === calm));
  runes(g, 0, 2, 't-rune-fury');
  // now: energy from 2 new fury runes, calm power from Gold (any)
  const ok = getLegalActions(g, 0).some(a => a.type === 'playCard' && a.obj === calm);
  assert.ok(ok);
  g = act(g, { type: 'playCard', player: 0, obj: calm, destination: 'base' });
  assert.equal(zoneOf(g, gold), 'trash');
  assert.equal(zoneOf(g, calm), 'base');
});

test('rule hook: opponents cannot gain points', () => {
  let g = game();
  put(g, 0, 'ts-shield-all', 'base');
  setController(g, 0, 1);
  put(g, 1, 't-u1', 0);
  g = act(g, { type: 'endTurn', player: 0 });
  // player 1 holds battlefield 0 at their beginning phase, but can't gain the point
  assert.equal(g.players[1].points, 0);
});

test('delayed trigger: kill it at end of turn', () => {
  let g = game();
  const t = put(g, 1, 't-u3', 'base');
  const s = handCard(g, 0, 'ts-kill-later');
  g = act(g, { type: 'playCard', player: 0, obj: s });
  if (g.pending?.kind === 'chooseTargets') g = choose(g, t);
  g = resolveAll(g);
  assert.equal(zoneOf(g, t), 'base');
  g = act(g, { type: 'endTurn', player: 0 });
  g = resolveAll(g);
  assert.equal(zoneOf(g, t), 'trash');
});

test('at end of your turn trigger', () => {
  let g = game();
  put(g, 0, 'ts-endturn', 'base');
  const n = g.players[0].hand.length;
  g = act(g, { type: 'endTurn', player: 0 });
  g = resolveAll(g);
  assert.equal(g.players[0].hand.length, n + 1);
});

test('Bomb token (synthetic) with Deploy: dies -> deals 2 to an enemy there', () => {
  let g = game();
  const maker = handCard(g, 0, 'ts-bomb-maker');
  const e = put(g, 1, 't-u2', 0);
  setController(g, 0, 1);
  g = act(g, { type: 'playCard', player: 0, obj: maker });
  g = resolveAll(g);
  if (g.pending?.kind === 'chooseBattlefield') g = choose(g, '0');
  g = resolveAll(g);
  const bomb = find(g, 'tok-bomb', 0)[0];
  assert.ok(bomb, 'bomb created');
  assert.equal(g.objects[bomb].battlefieldIndex, 0);
  assert.ok(hasKw(g, bomb, 'Deploy'));
  // kill the bomb via a zap from p1? simpler: direct kill through engine action
  const { kill } = await_import();
  kill(g, [bomb]); g.ex.dirty = true;
  g = act(g, { type: 'endTurn', player: 0 });
  g = resolveAll(g);
  assert.equal(zoneOf(g, e), 'trash');
});

import * as Actions from '../../src/engine/actions.ts';
function await_import() { return Actions; }

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, act, choose, yes, no, pass, put, runes, handCard, resolveAll, zoneOf, setController } from '../fixtures/helpers.ts';
import { fullDb, unit } from '../fixtures/cards.ts';
import { might, hasKw, chars, kwVal } from '../../src/engine/chars.ts';
import { makeCtx } from '../../src/engine/context.ts';
import { addModifier, kill, buff, stun } from '../../src/engine/actions.ts';
import { card, onPlay, when, E, T, F, statik, replacement, rule, dep, selfMight, whenUnitDies, wouldDie } from '../../src/cards/dsl.ts';
import type { CardDef } from '../../src/engine/types.ts';

// extra scripted test cards for this file
const extra: Record<string, CardDef> = {
  'tl-two-triggers': unit('tl-two-triggers', 1, 1, { text: 'When you play me, draw 1. When you play me, deal 1 to a unit.' }),
  'tl-may': unit('tl-may', 1, 1, { text: 'When you play me, you may draw 1.' }),
  'tl-target': unit('tl-target', 1, 1, { text: 'When you play me, stun an enemy unit at a battlefield.' }),
  'tl-once': unit('tl-once', 1, 1, { text: 'Once each turn, when a friendly unit dies, draw 1.' }),
  'tl-iff': unit('tl-iff', 1, 1, { text: 'When you play me, if you have 3 or more points, draw 2.' }),
  'tl-shield-a': unit('tl-shield-a', 1, 1, { text: 'If a friendly unit would be dealt damage, prevent 1 of it.' }),
  'tl-double': unit('tl-double', 1, 1, { text: 'Damage dealt to enemy units is doubled.' }),
  'tl-tanker': unit('tl-tanker', 1, 1, { text: 'Friendly units with 3 or more Might have [Tank].' }),
  'tl-level': unit('tl-level', 1, 1, { text: '[Level 3][>] I have +3 [S].' }),
  'tl-skipdraw': unit('tl-skipdraw', 1, 1, { text: 'Skip your Draw Phase.' }),
  'tl-save': unit('tl-save', 1, 1, { text: 'If another friendly unit would die, you may recall it instead.' }),
};
card('tl-two-triggers', extra['tl-two-triggers'].text, [onPlay(E.draw(1), { text: 'draw 1' }), onPlay(E.deal(1, 0), { text: 'deal 1', targets: [T.unit(F.enemy)] })]);
card('tl-may', extra['tl-may'].text, [onPlay(E.draw(1), { optional: 'Draw 1?' })]);
card('tl-target', extra['tl-target'].text, [onPlay(E.stun(0), { targets: [T.unit(F.enemy, F.atBattlefield)] })]);
card('tl-once', extra['tl-once'].text, [whenUnitDies(F.friendly, E.draw(1), { oncePerTurn: 1 })]);
card('tl-iff', extra['tl-iff'].text, [onPlay(E.draw(2), { if: ctx => ctx.points() >= 3 })]);
card('tl-shield-a', extra['tl-shield-a'].text, [replacement('damage', (ev, ctx) => ctx.isFriendly(ev.obj as string), ev => ({ ...ev, amount: Number(ev.amount) - 1 }))]);
card('tl-double', extra['tl-double'].text, [replacement('damage', (ev, ctx) => ctx.isEnemy(ev.obj as string), ev => ({ ...ev, amount: Number(ev.amount) * 2 }))]);
card('tl-tanker', extra['tl-tanker'].text, [statik(F.and(F.friendly, F.unit, (c, id) => c.might(id) >= 3), { keywords: ['Tank'] })]);
card('tl-level', extra['tl-level'].text, [selfMight(3, { requires: [dep.level(3)] })]);
card('tl-skipdraw', extra['tl-skipdraw'].text, [rule('skipDraw', (ctx, p) => p === ctx.controller)]);
card('tl-save', extra['tl-save'].text, [wouldDie(F.and(F.friendly, F.other, F.unit), (ctx, id) => ctx.recall(id), { optional: 'Recall it instead?' })]);
void when;

const game = () => newGame({ db: { ...fullDb(), ...extra } });

test('layers: set Might (layer 1) then arithmetic; increases before decreases; timestamp order', () => {
  const g = game();
  const u = put(g, 0, 't-u3', 'base');
  addModifier(g, u, { source: null, duration: 'endOfTurn', might: -5 });
  addModifier(g, u, { source: null, duration: 'endOfTurn', might: 1 });
  assert.equal(might(g, u), -1, 'true value kept below zero');
  addModifier(g, u, { source: null, duration: 'endOfTurn', setMight: 6 });
  assert.equal(might(g, u), 2, 'set 6, then +1 -5');
});

test('buff: +1 Might, at most one buff per unit', () => {
  const g = game();
  const u = put(g, 0, 't-u2', 'base');
  assert.equal(buff(g, u), true);
  assert.equal(buff(g, u), false);
  assert.equal(might(g, u), 3);
});

test('granted keywords via statics are computed through layers and depend on Might', () => {
  const g = game();
  put(g, 0, 'tl-tanker', 'base');
  const big = put(g, 0, 't-u3', 'base'), small = put(g, 0, 't-u2', 'base');
  assert.ok(hasKw(g, big, 'Tank'));
  assert.ok(!hasKw(g, small, 'Tank'));
  makeCtx(g, small, 0).giveMight(small, 1);
  assert.ok(hasKw(g, small, 'Tank'));
});

test('summing keywords: Assault instances add up; removed keywords disappear', () => {
  const g = game();
  const u = put(g, 0, 't-assault', 'base');
  makeCtx(g, u, 0).giveKeyword(u, 'Assault 3');
  assert.equal(kwVal(g, u, 'Assault'), 5);
  makeCtx(g, u, 0).removeKeyword(u, 'Assault');
  assert.equal(kwVal(g, u, 'Assault'), 0);
});

test('copy effect: an object becomes a copy of another card’s copyable traits', () => {
  const g = game();
  const u = put(g, 0, 't-u1', 'base');
  makeCtx(g, u, 0).becomeCopy(u, 't-tank');
  const c = chars(g, u);
  assert.equal(c.name, 't-tank');
  assert.ok(c.keywords.has('Tank'));
});

test('leaving the board makes a new object: modifiers, damage and buffs are gone', () => {
  const g = game();
  const u = put(g, 0, 't-u2', 'base');
  buff(g, u); makeCtx(g, u, 0).giveMight(u, 3, 'permanent'); g.objects[u].damage = 1;
  const ep = g.objects[u].epoch;
  makeCtx(g, u, 0).returnToHand(u);
  assert.equal(g.objects[u].modifiers.length, 0);
  assert.equal(g.objects[u].counters.buff, undefined);
  assert.equal(g.objects[u].damage, 0);
  assert.notEqual(g.objects[u].epoch, ep);
});

test('Level: dependent ability active only with enough XP', () => {
  const g = game();
  const u = put(g, 0, 'tl-level', 'base');
  assert.equal(might(g, u), 1);
  g.players[0].xp = 3;
  assert.equal(might(g, u), 4);
});

test('two simultaneous triggers from the same controller: player orders them', () => {
  let g = game();
  const e = put(g, 1, 't-u3', 'base');
  const u = handCard(g, 0, 'tl-two-triggers');
  g = act(g, { type: 'playCard', player: 0, obj: u, destination: 'base' });
  assert.equal(g.pending?.kind, 'orderTriggers');
  const first = g.pending!.options![0].id;
  g = choose(g, first);
  assert.equal(g.chain.length, 2);
  g = resolveAll(g);
  assert.equal(g.objects[e].damage, 1);
});

test('optional trigger ("you may") can be declined at finalization', () => {
  let g = game();
  const u = handCard(g, 0, 'tl-may');
  const hand = g.players[0].hand.length;
  g = act(g, { type: 'playCard', player: 0, obj: u, destination: 'base' });
  assert.equal(g.pending?.kind, 'optional');
  g = no(g);
  assert.equal(g.chain.length, 0);
  assert.equal(g.players[0].hand.length, hand - 1);
});

test('a trigger without legal targets is removed', () => {
  let g = game();
  const u = handCard(g, 0, 'tl-target');
  g = act(g, { type: 'playCard', player: 0, obj: u, destination: 'base' });
  assert.equal(g.chain.length, 0);
  assert.equal(g.pending?.kind, 'mainAction');
});

test('once per turn trigger fires only once', () => {
  const g = game();
  put(g, 0, 'tl-once', 'base');
  const a = put(g, 0, 't-u1', 'base'), b = put(g, 0, 't-u1', 'base');
  const hand = g.players[0].hand.length;
  kill(g, [a]); kill(g, [b]);
  // both deaths queue it, but only one can be put on the chain this turn
  let h = act(g, { type: 'endTurn', player: 0 });
  h = resolveAll(h);
  assert.equal(h.players[0].hand.length, hand + 1);
});

test('intervening if: the trigger does nothing unless the condition holds', () => {
  let g = game();
  const u = handCard(g, 0, 'tl-iff');
  g = act(g, { type: 'playCard', player: 0, obj: u, destination: 'base' });
  assert.equal(g.chain.length, 0);
  let h = game();
  h.players[0].points = 3;
  const v = handCard(h, 0, 'tl-iff');
  const n = h.players[0].hand.length;
  h = act(h, { type: 'playCard', player: 0, obj: v, destination: 'base' });
  h = resolveAll(h);
  assert.equal(h.players[0].hand.length, n - 1 + 2);
});

test('replacement effects modify damage; multiple apply in the affected controller’s chosen order', () => {
  let g = game();
  put(g, 1, 'tl-shield-a', 'base');   // p1: friendly damage -1
  put(g, 0, 'tl-double', 'base');     // p0: enemy damage x2
  const t = put(g, 1, 't-u5', 'base');
  const zap = handCard(g, 0, 'ts-zap');
  g = act(g, { type: 'playCard', player: 0, obj: zap });
  if (g.pending?.kind === 'chooseTargets') g = choose(g, t);
  g = resolveAll(g);
  assert.equal(g.pending?.kind, 'chooseOrder');
  assert.equal(g.pending?.player, 1, 'affected object’s controller orders');
  // apply prevention first: (2-1)*2 = 2 ; doubling first: 2*2-1 = 3
  // (labels are "<source name>: <text>" since ENGINE-2; identify the option by its source object)
  const prevId = g.pending!.options!.find(o => g.objects[o.objIds?.[0] ?? '']?.cardId === 'tl-shield-a')!.id;
  g = choose(g, prevId);
  g = resolveAll(g);
  assert.equal(g.objects[t].damage, 2);
});

test('optional replacement: may recall instead of dying', () => {
  let g = game();
  put(g, 1, 'tl-save', 'base');
  setController(g, 0, 1);
  const u = put(g, 1, 't-u2', 0);
  const zap = handCard(g, 0, 'ts-zap');
  g = act(g, { type: 'playCard', player: 0, obj: zap });
  g = choose(g, u);
  g = resolveAll(g);
  assert.equal(g.pending?.kind, 'optional');
  g = yes(g);
  assert.equal(zoneOf(g, u), 'base');
  assert.equal(g.objects[u].damage, 2, 'recall keeps damage');
});

test('rule hook: skip draw phase', () => {
  let g = game();
  put(g, 1, 'tl-skipdraw', 'base');
  const n = g.players[1].hand.length;
  g = pass(g);
  g = resolveAll(g);
  assert.equal(g.players[1].hand.length, n);
});

test('stun is binary and doesn’t retrigger', () => {
  const g = game();
  const u = put(g, 0, 't-u2', 'base');
  stun(g, [u]); stun(g, [u]);
  assert.equal(g.ex.lastEvents.filter(e => e.type === 'stun').length, 1);
});

test('control change: a unit taken at a battlefield contests it', () => {
  let g = game();
  setController(g, 0, 1);
  const u = put(g, 1, 't-u2', 0);
  makeCtx(g, u, 0).takeControl(u, 0);
  assert.equal(g.objects[u].controller, 0);
  assert.equal(g.battlefields[0].contestedBy, 0);
  g.ex.dirty = true;
  g = act(g, { type: 'endTurn', player: 0 });
  void runes;
});

// B8 legends (Origins + Origins starter legends).
import { test } from 'node:test';
import {
  assert, game, setBf, setLegend, moveIn, endTurn, put, runes, onlyRunes, handCard, resolveAll, zoneOf, setController, yes, no, choose, act, play,
  activate, expectPending, optIds, might, hasKw, getLegalActions, exhaustRunes, readyCount,
} from './b8-util.ts';
import { moveToZone } from '../../../src/engine/state.ts';
import type { GameState, ObjId, PlayerId } from '../../../src/engine/types.ts';

const canPlay = (g: GameState, p: PlayerId, obj: ObjId) => getLegalActions(g, p).some(a => a.type === 'playCard' && a.obj === obj);
const canAct = (g: GameState, p: PlayerId, obj: ObjId, idx?: number) => getLegalActions(g, p).some(a => a.type === 'activate' && a.obj === obj && (idx === undefined || a.abilityIndex === idx));

test('Daughter of the Void: [T]: Add [C], only for spells', () => {
  const g = game();
  setLegend(g, 0, 'ogn-247-298');
  onlyRunes(g, 0, 0);
  const s = handCard(g, 0, 'b8-s-pow'), u = handCard(g, 0, 'b8-u-pow');
  assert.equal(canPlay(g, 0, s), true, 'a 0+[Fury] spell is payable with the legend');
  assert.equal(canPlay(g, 0, u), false, 'a unit is not');
  let g2 = play(g, 0, s);
  g2 = resolveAll(g2);
  assert.equal(g2.objects[g2.players[0].legend].exhausted, true);
});

test('Relentless Storm: playing a Mighty unit may exhaust it to channel 1 rune exhausted', () => {
  let g = game();
  setLegend(g, 0, 'ogn-249-298');
  runes(g, 0, 6);
  const n = g.players[0].runesInPlay.length;
  g = play(g, 0, handCard(g, 0, 't-u2'), 'base');
  g = resolveAll(g);
  assert.equal(g.pending?.kind, 'mainAction', 'not Mighty: no trigger');
  g = play(g, 0, handCard(g, 0, 't-u5'), 'base');
  g = resolveAll(g);
  expectPending(g, 'optional', /channel 1 rune/);
  g = resolveAll(yes(g));
  assert.equal(g.players[0].runesInPlay.length, n + 1);
  assert.equal(g.objects[g.players[0].runesInPlay.at(-1)!].exhausted, true);
  assert.equal(g.objects[g.players[0].legend].exhausted, true);
});

test('Loose Cannon: at the start of your Beginning Phase, draw 1 if you have 0-1 cards in hand', () => {
  for (const keep of [1, 3]) {
    let g = game();
    setLegend(g, 0, 'ogn-251-298');
    for (const id of [...g.players[0].hand].slice(keep)) moveToZone(g, id, 'trash');
    g = endTurn(g);
    g = endTurn(g);
    g = resolveAll(g);
    assert.equal(g.players[0].hand.length, keep + 1 + (keep <= 1 ? 1 : 0));
  }
});

test('Hand of Noxus: [T]: Add [1] only with Legion (after playing a card this turn)', () => {
  let g = game();
  setLegend(g, 0, 'ogn-253-298');
  onlyRunes(g, 0, 0);
  const u = handCard(g, 0, 't-u1');
  assert.equal(canPlay(g, 0, u), false, 'no Legion yet');
  g = play(g, 0, handCard(g, 0, 'b8-s0'));
  g = resolveAll(g);
  assert.equal(canPlay(g, 0, u), true);
  g = play(g, 0, u, 'base');
  assert.equal(zoneOf(g, u), 'base');
  assert.equal(g.objects[g.players[0].legend].exhausted, true);
});

test('Nine-Tailed Fox: an enemy unit attacking your battlefield gets -1 (to a minimum of 1)', () => {
  let g = game({ firstPlayer: 1 });
  setLegend(g, 0, 'ogn-255-298');
  setController(g, 0, 0);
  put(g, 0, 't-u5', 0);
  const a3 = put(g, 1, 't-u3', 'base'), a1 = put(g, 1, 't-u1', 'base');
  g = act(g, { type: 'move', player: 1, units: [a3, a1], to: 0 });
  // AUTO-AUDIT F-4 (ENGINE-7): the Fox's two instances (one per attacker) are ordered by their controller
  assert.equal(g.pending?.kind, 'orderTriggers');
  assert.equal(g.pending?.player, 0);
  g = choose(g, g.pending!.options![0].id);
  for (let i = 0; i < 5 && g.pending?.kind !== 'showdownAction'; i++) g = resolveAll(g);
  assert.equal(might(g, a3), 2);
  assert.equal(might(g, a1), 1, 'minimum 1');
});

test('Blind Monk: [1], [T]: Buff a friendly unit', () => {
  let g = game();
  setLegend(g, 0, 'ogn-257-298');
  const u = put(g, 0, 't-u2', 'base');
  put(g, 1, 't-u2', 'base');
  g = activate(g, 0, g.players[0].legend);
  g = resolveAll(g);
  assert.equal(g.objects[u].counters.buff, 1);
  assert.equal(might(g, u), 3);
  assert.equal(canAct(g, 0, g.players[0].legend), false, 'exhausted');
});

test('Unforgiven: [2], [E]: move a friendly unit from base to a battlefield, or back to base', () => {
  let g = game();
  setLegend(g, 0, 'ogn-259-298');
  const u = put(g, 0, 't-u2', 'base', { ready: false });
  runes(g, 0, 2);
  g = activate(g, 0, g.players[0].legend);
  g = resolveAll(g);
  expectPending(g, 'chooseDestination');          // R-2: chosen as the ability is activated
  g = choose(g, '1');
  g = resolveAll(g);
  assert.equal(g.objects[u].battlefieldIndex, 1, 'moved even though exhausted');
  g = endTurn(g); g = endTurn(g); g = resolveAll(g);
  g = activate(g, 0, g.players[0].legend);
  g = resolveAll(g);
  assert.equal(zoneOf(g, u), 'base');
});

test('Radiant Dawn: stunning one or more enemy units buffs a friendly unit (once per stun)', () => {
  let g = game();
  setLegend(g, 0, 'ogn-261-298');
  const f = put(g, 0, 't-u2', 'base');
  const e1 = put(g, 1, 't-u2', 'base'), e2 = put(g, 1, 't-u2', 'base');
  runes(g, 0, 2);
  g = play(g, 0, handCard(g, 0, 'b8-stun2'));
  g = choose(g, e1, e2);
  g = resolveAll(g);
  assert.ok(g.objects[e1].stunned && g.objects[e2].stunned);
  assert.equal(g.objects[f].counters.buff, 1);
  assert.equal(g.log.filter(l => l.text.startsWith('Trigger: Radiant Dawn')).length, 1, 'one trigger for two stuns');
});

test('Radiant Dawn: stunning only a friendly unit does nothing', () => {
  let g = game();
  setLegend(g, 0, 'ogn-261-298');
  const f = put(g, 0, 't-u2', 'base');
  g = play(g, 0, handCard(g, 0, 'b8-stun2'));
  g = choose(g, f);
  g = resolveAll(g);
  assert.equal(g.objects[f].counters.buff ?? 0, 0);
});

test('Swift Scout: [1], [T]: put a Teemo unit you own into your hand from the Champion Zone or the board', () => {
  let g = game();
  setLegend(g, 0, 'ogn-263-298');
  const ch = g.players[0].championZone[0];
  g.objects[ch].cardId = 'b8-teemo';
  const onBoard = put(g, 0, 'b8-teemo', 'base');
  g = resolveAll(activate(g, 0, g.players[0].legend, 0));
  expectPending(g, 'chooseCards', /Teemo/);
  g = choose(g, ch);
  g = resolveAll(g);
  assert.equal(zoneOf(g, ch), 'hand');
  assert.equal(zoneOf(g, onBoard), 'base');
});

test('Swift Scout: no Teemo, no ability', () => {
  const g = game();
  setLegend(g, 0, 'ogn-263-298');
  assert.equal(canAct(g, 0, g.players[0].legend), false);
});

test('Swift Scout: hide a card for [1] instead', () => {
  let g = game();
  setLegend(g, 0, 'ogn-263-298');
  setController(g, 1, 0); put(g, 0, 't-u1', 1);
  const [r] = onlyRunes(g, 0, 1, 'rad-r03');            // hiding normally costs a Power (recycle the rune)
  const h = handCard(g, 0, 't-hidden');
  g = act(g, { type: 'hide', player: 0, obj: h, battlefieldIndex: 1 });
  expectPending(g, 'chooseMode', /Hide/);
  assert.deepEqual((g.pending!.options ?? []).map(o => o.label), ['A', '1']);
  g = choose(g, '1');
  assert.equal(zoneOf(g, h), 'facedown');
  assert.equal(zoneOf(g, r), 'runePool', 'paid [1] (exhaust), not a recycled Power');
});

test('Bounty Hunter: [T]: give a unit Ganking this turn', () => {
  let g = game();
  setLegend(g, 0, 'ogn-267-298');
  const u = put(g, 0, 't-u2', 'base');
  g = activate(g, 0, g.players[0].legend);
  g = resolveAll(g);
  assert.ok(hasKw(g, u, 'Ganking'));
  g = endTurn(g);
  assert.equal(hasKw(g, u, 'Ganking'), false);
});

test('The Boss: a buffed unit that would die may be saved for [C] (exhaust legend, spend buff, heal, exhaust, recall)', () => {
  let g = game();
  setLegend(g, 0, 'ogn-269-298');
  runes(g, 0, 1, 'rad-r04');
  setController(g, 1, 0);
  const u = put(g, 0, 't-u2', 1);
  g.objects[u].counters.buff = 1;
  g.objects[u].damage = 9; g.ex.dirty = true;
  g = endTurn(g);
  expectPending(g, 'optional', /The Boss/);
  g = yes(g);
  g = resolveAll(g);
  assert.equal(zoneOf(g, u), 'base');
  assert.equal(g.objects[u].counters.buff ?? 0, 0);
  assert.equal(g.objects[u].damage, 0);
  assert.equal(g.objects[g.players[0].legend].exhausted, true);
});

test('The Boss: declining lets the unit die; unbuffed units are not offered', () => {
  let g = game();
  setLegend(g, 0, 'ogn-269-298');
  runes(g, 0, 1, 'rad-r04');
  const u = put(g, 0, 't-u2', 'base'), v = put(g, 0, 't-u2', 'base');
  g.objects[u].counters.buff = 1;
  g.objects[u].damage = 9; g.objects[v].damage = 9; g.ex.dirty = true;
  g = endTurn(g);
  expectPending(g, 'optional', /The Boss/);
  g = no(g);
  g = resolveAll(g);
  assert.equal(zoneOf(g, u), 'trash');
  assert.equal(zoneOf(g, v), 'trash');
});

test('The Boss: when you conquer, ready me', () => {
  let g = game();
  setLegend(g, 0, 'ogn-269-298');
  g.objects[g.players[0].legend].exhausted = true;
  g = moveIn(g, 0, 1).g;
  g = resolveAll(g);
  assert.equal(g.objects[g.players[0].legend].exhausted, false);
});

test('Dark Child: at the end of your turn, ready up to 2 runes', () => {
  let g = game();
  setLegend(g, 0, 'ogs-017-024');
  runes(g, 0, 1);
  exhaustRunes(g, 0);
  runes(g, 1, 1);
  const theirs = g.players[1].runesInPlay[0];
  g.objects[theirs].exhausted = true;
  g = endTurn(g);
  // targets chosen as the trigger goes on the chain; any player's runes (RJ#239 DECIDED: no "your")
  expectPending(g, 'chooseTargets', /Ready up to 2 runes/);
  assert.ok(optIds(g).includes(theirs), "an opponent's rune is offered");
  const mine = optIds(g).filter(id => id !== theirs).slice(0, 2);
  g = choose(g, ...mine);
  g = resolveAll(g);
  assert.equal(readyCount(g, 0), 2);
});

test('Wuju Bladesman: a friendly unit defending alone gets +2', () => {
  let g = game({ firstPlayer: 1 });
  setLegend(g, 0, 'ogs-019-024');
  setController(g, 0, 0);
  const d = put(g, 0, 't-u2', 0);
  const a = put(g, 1, 't-u3', 'base');
  assert.equal(might(g, d), 2);
  g = act(g, { type: 'move', player: 1, units: [a], to: 0 });
  for (let i = 0; i < 5 && g.pending?.kind !== 'showdownAction'; i++) g = resolveAll(g);
  assert.equal(might(g, d), 4);
  g = resolveAll(g);
  assert.equal(zoneOf(g, a), 'trash');
  assert.equal(zoneOf(g, d), 'battlefield');
});

test('Wuju Bladesman: not alone, no bonus', () => {
  let g = game({ firstPlayer: 1 });
  setLegend(g, 0, 'ogs-019-024');
  setController(g, 0, 0);
  const d = put(g, 0, 't-u2', 0); put(g, 0, 't-u1', 0);
  const a = put(g, 1, 't-u3', 'base');
  g = act(g, { type: 'move', player: 1, units: [a], to: 0 });
  for (let i = 0; i < 5 && g.pending?.kind !== 'showdownAction'; i++) g = resolveAll(g);
  assert.equal(might(g, d), 2);
});

test('Lady of Luminosity: playing a spell that costs [5]+ draws 1', () => {
  let g = game();
  setLegend(g, 0, 'ogs-021-024');
  runes(g, 0, 8);
  const u = put(g, 0, 't-u2', 'base');
  let h = g.players[0].hand.length;
  g = play(g, 0, handCard(g, 0, 'b8-pump5'));
  g = resolveAll(g);
  assert.equal(g.players[0].hand.length, h + 1);
  h = g.players[0].hand.length;
  g = play(g, 0, handCard(g, 0, 'b8-pump'));
  g = resolveAll(g);
  assert.equal(g.players[0].hand.length, h);
  void u;
});

test('Might of Demacia: conquering with 4+ units there draws 2; 3 units draw nothing', () => {
  for (const n of [4, 3]) {
    let g = game();
    setLegend(g, 0, 'ogs-023-024');
    const us = Array.from({ length: n }, () => put(g, 0, 't-u1', 'base'));
    const h = g.players[0].hand.length;
    g = act(g, { type: 'move', player: 0, units: us, to: 1 });
    g = resolveAll(g);
    assert.equal(g.players[0].hand.length, h + (n >= 4 ? 2 : 0));
  }
});

void setBf; void no;

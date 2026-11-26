// B8 units, spells and gear with rules-modifying abilities.
import { test } from 'node:test';
import {
  assert, game, setBf, setLegend, moveIn, endTurn, put, runes, onlyRunes, handCard, resolveAll, zoneOf, setController, yes, no, choose, act, play,
  activate, expectPending, optIds, might, hasKw, getLegalActions, readyCount, mkObj, find,
} from './b8-util.ts';
import { moveToZone } from '../../../src/engine/state.ts';
import type { GameState, ObjId, PlayerId } from '../../../src/engine/types.ts';

const canPlay = (g: GameState, p: PlayerId, obj: ObjId, dest?: number | 'base') =>
  getLegalActions(g, p).some(a => a.type === 'playCard' && a.obj === obj && (dest === undefined || a.destination === dest));
const runesLeft = (g: GameState, p: PlayerId) => g.players[p].runesInPlay.length;
const exhaustedRunes = (g: GameState, p: PlayerId) => g.players[p].runesInPlay.filter(r => g.objects[r].exhausted).length;

function hidden(g: GameState, p: PlayerId, cardId: string, bf: number): ObjId {
  const id = handCard(g, p, cardId);
  moveToZone(g, id, 'facedown', { bf, controller: p });
  g.objects[id].hiddenTurn = 0;
  return id;
}

test("Noxus Saboteur: opponents' hidden cards here can't be played (revealed); elsewhere they can", () => {
  let g = game({ firstPlayer: 1 });
  setController(g, 1, 1); setController(g, 0, 1);
  put(g, 0, 'ogn-018-298', 1);
  const here = hidden(g, 1, 'b8-hideable', 1), there = hidden(g, 1, 'b8-hideable', 0);
  assert.equal(canPlay(g, 1, here), false);
  assert.equal(canPlay(g, 1, there), true);
});

test("Brynhir Thundersong: after it's played, opponents can't play cards this turn", () => {
  let g = game();
  runes(g, 0, 8); runes(g, 1, 3);
  const react = handCard(g, 1, 'b8-react');
  g = play(g, 0, handCard(g, 0, 'ogn-026-298'), 'base');
  g = resolveAll(g);
  g = play(g, 0, handCard(g, 0, 'b8-s1'));
  assert.equal(g.pending?.kind, 'chainResponse');
  g = act(g, { type: 'pass', player: 0 });
  assert.equal(g.pending?.player, 1);
  assert.equal(canPlay(g, 1, react), false);
  g = resolveAll(g);
  g = endTurn(g);
  assert.equal(canPlay(g, 1, react), true, 'next turn');
});

test('Mageseeker Warden: at a battlefield, opponents can only play units to their base', () => {
  let g = game();
  put(g, 0, 'ogn-070-298', 1);
  g = endTurn(g);
  setController(g, 0, 1); put(g, 1, 't-u1', 0);
  runes(g, 1, 4);
  const u = handCard(g, 1, 't-u2');
  assert.equal(canPlay(g, 1, u, 0), false);
  assert.equal(canPlay(g, 1, u, 'base'), true);
});

test("Mageseeker Warden: spells and abilities can't ready enemy units (the Awaken Phase still does)", () => {
  let g = game();
  put(g, 0, 'ogn-070-298', 1);
  const mine = put(g, 0, 't-u2', 'base', { ready: false });
  const theirs = put(g, 1, 't-u2', 'base', { ready: false });
  runes(g, 0, 2);
  g = play(g, 0, handCard(g, 0, 'b8-readyall'));
  g = resolveAll(g);
  assert.equal(g.objects[mine].exhausted, false);
  assert.equal(g.objects[theirs].exhausted, true);
  g = endTurn(g);
  assert.equal(g.objects[theirs].exhausted, false, 'Awaken readies it');
});

test('Eager Apprentice: at a battlefield, your spells cost [1] less (minimum [1])', () => {
  let g = game();
  put(g, 0, 'ogn-084-298', 1);
  onlyRunes(g, 0, 1);
  assert.equal(canPlay(g, 0, handCard(g, 0, 'b8-s2')), true, '2 -> 1');
  assert.equal(canPlay(g, 0, handCard(g, 0, 'b8-s1')), true);
  onlyRunes(g, 0, 0);
  assert.equal(canPlay(g, 0, handCard(g, 0, 'b8-s1')), false, '1 stays 1');
  let g2 = game();
  put(g2, 0, 'ogn-084-298', 'base');
  onlyRunes(g2, 0, 1);
  assert.equal(canPlay(g2, 0, handCard(g2, 0, 'b8-s2')), false, 'not at base');
  void g;
});

test('Time Warp: take a turn after this one; Time Warp is banished', () => {
  let g = game();
  runes(g, 0, 12, 'rad-r03');
  const tw = handCard(g, 0, 'ogn-122-298');
  g = play(g, 0, tw);
  g = resolveAll(g);
  assert.equal(zoneOf(g, tw), 'banishment');
  g = endTurn(g);
  assert.equal(g.activePlayer, 0, 'extra turn');
  g = endTurn(g);
  assert.equal(g.activePlayer, 1);
});

test("Herald of Scales: your Dragons cost [2] less (minimum [1])", () => {
  const g = game();
  put(g, 0, 'ogn-140-298', 'base');
  onlyRunes(g, 0, 3);
  assert.ok(canPlay(g, 0, handCard(g, 0, 'b8-dragon')), '5 -> 3');
  onlyRunes(g, 0, 1);
  assert.ok(canPlay(g, 0, handCard(g, 0, 'b8-cheapdragon')), '2 -> 1');
  assert.equal(canPlay(g, 0, handCard(g, 0, 't-u2')), false, 'non-Dragons unchanged');
  onlyRunes(g, 1, 3);
  assert.equal(canPlay(g, 1, handCard(g, 1, 'b8-dragon')), false, "opponents' Dragons unchanged");
});

test("Kayn, Unleashed: after moving twice this turn he doesn't take damage", () => {
  let g = game();
  setController(g, 0, 0); put(g, 0, 't-u1', 0);
  const k = put(g, 0, 'ogn-189-298', 'base');
  assert.ok(hasKw(g, k, 'Ganking'));
  runes(g, 0, 4);
  g = act(g, { type: 'move', player: 0, units: [k], to: 0 });
  g = resolveAll(g);
  g = play(g, 0, handCard(g, 0, 'b8-zap')); g = choose(g, k); g = resolveAll(g);
  assert.equal(g.objects[k].damage, 1, 'moved once: takes damage');
  g.objects[k].exhausted = false;
  g = act(g, { type: 'move', player: 0, units: [k], to: 1 });
  g = resolveAll(g);
  g = play(g, 0, handCard(g, 0, 'b8-zap')); g = choose(g, k); g = resolveAll(g);
  assert.equal(g.objects[k].damage, 1, 'moved twice: no more damage');
});

test('Possession: take control of an enemy unit at a battlefield and recall it', () => {
  let g = game();
  const e = put(g, 1, 't-u3', 1);
  put(g, 1, 't-u3', 'base');
  runes(g, 0, 8, 'rad-r05');
  g = play(g, 0, handCard(g, 0, 'ogn-203-298'));
  g = resolveAll(g);
  assert.equal(g.objects[e].controller, 0);
  assert.equal(zoneOf(g, e), 'base');
  assert.ok(g.players[0].base.includes(e));
});

test('Symbol of the Solari: a tie in a combat you attack recalls all units instead of killing them', () => {
  let g = game();
  put(g, 0, 'ogn-227-298', 'base');
  setController(g, 1, 1);
  const d = put(g, 1, 't-u2', 1);
  const { g: g2, u: a } = moveIn(g, 0, 1, 't-u2');
  g = resolveAll(g2);
  assert.equal(zoneOf(g, a), 'base');
  assert.equal(zoneOf(g, d), 'base');
  assert.equal(g.objects[a].damage, 0);
  assert.ok(g.players[1].base.includes(d));
});

test('Symbol of the Solari: the tie recall applies only to units at that battlefield (Origins FAQ ruling)', () => {
  let g = game();
  put(g, 0, 'ogn-227-298', 'base');
  setController(g, 1, 1); setController(g, 0, 0);
  const d = put(g, 1, 't-u2', 1);
  const mineElsewhere = put(g, 0, 't-u1', 0);
  const { g: g2, u: a } = moveIn(g, 0, 1, 't-u2');
  g = resolveAll(g2);
  assert.equal(zoneOf(g, a), 'base');
  assert.equal(zoneOf(g, d), 'base');
  assert.equal(zoneOf(g, mineElsewhere), 'battlefield', 'a unit at another battlefield stays');
  assert.equal(g.objects[mineElsewhere].battlefieldIndex, 0);
});

test('Symbol of the Solari: no effect when you are the defender, or when it is not a tie', () => {
  let g = game({ firstPlayer: 1 });
  put(g, 0, 'ogn-227-298', 'base');
  setController(g, 0, 0);
  const d = put(g, 0, 't-u2', 0);
  const { g: g2, u: a } = moveIn(g, 1, 0, 't-u2');
  g = resolveAll(g2);
  assert.equal(zoneOf(g, a), 'trash'); assert.equal(zoneOf(g, d), 'trash');
  let h = game();
  put(h, 0, 'ogn-227-298', 'base');
  setController(h, 1, 1);
  const d2 = put(h, 1, 't-u1', 1);
  h = resolveAll(moveIn(h, 0, 1, 't-u3').g);
  assert.equal(zoneOf(h, d2), 'trash', 'one side survives: normal death');
});

test('Karthus, Eternal: your Deathknell effects trigger an additional time', () => {
  let g = game();
  put(g, 0, 'ogn-236-298', 'base');
  const dk = put(g, 0, 'b8-dk', 'base');
  const h = g.players[0].hand.length;
  g.objects[dk].damage = 5; g.ex.dirty = true;
  g = endTurn(g);
  g = resolveAll(g);
  assert.equal(g.players[0].hand.length, h + 2);
});

test('Karthus, Eternal: enemy Deathknells are not doubled', () => {
  let g = game();
  put(g, 0, 'ogn-236-298', 'base');
  const dk = put(g, 1, 'b8-dk', 'base');
  const h = g.players[1].hand.length;
  g.objects[dk].damage = 5; g.ex.dirty = true;
  g = act(g, { type: 'endTurn', player: 0 });
  g = resolveAll(g);
  assert.equal(g.players[1].hand.length, h + 1 + 1, 'one Deathknell draw + Draw Phase');
});

test('Coalesced Energy: at the end of your turn recycle all your runes, then channel 4 exhausted', () => {
  let g = game();
  put(g, 0, 'rad-016-167', 'base');
  runes(g, 0, 3);
  g = endTurn(g);
  g = resolveAll(g);
  assert.equal(runesLeft(g, 0), 4);
  assert.equal(exhaustedRunes(g, 0), 4, 'channelled exhausted');
});

test('Firebrand Raider: enters ready, readies enemies, other units enter ready, no Awaken readying', () => {
  let g = game();
  runes(g, 0, 8);
  const e = put(g, 1, 't-u2', 'base', { ready: false });
  const fr = handCard(g, 0, 'rad-019-167');
  g = play(g, 0, fr, 'base');
  g = resolveAll(g);
  assert.equal(g.objects[fr].exhausted, false);
  assert.equal(g.objects[e].exhausted, false);
  const u = handCard(g, 0, 't-u1');
  g = play(g, 0, u, 'base'); g = resolveAll(g);
  assert.equal(g.objects[u].exhausted, false, 'other units enter ready');
  g.objects[u].exhausted = true;
  g = endTurn(g); g = endTurn(g); g = resolveAll(g);
  assert.equal(g.objects[u].exhausted, true, "units don't ready in the Awaken Phase");
});

test('Firebrand Raider: opponents\' units and tokens enter ready too', () => {
  let g = game();
  put(g, 0, 'rad-019-167', 'base');
  runes(g, 0, 2);
  g = play(g, 0, handCard(g, 0, 'b8-recruits'));
  g = resolveAll(g);
  const rec = Object.values(g.objects).find(o => o.isToken && o.controller === 0)!;
  assert.equal(rec.exhausted, false);
  g = endTurn(g);
  runes(g, 1, 3);
  const eu = handCard(g, 1, 't-u2');
  g = play(g, 1, eu, 'base'); g = resolveAll(g);
  assert.equal(g.objects[eu].exhausted, false);
});

test('Orianna, Mechanical Marvel: once each turn at a battlefield, a gear costs [1][A] less', () => {
  let g = game();
  setController(g, 1, 0);
  put(g, 0, 'rad-068-167', 1);
  onlyRunes(g, 0, 1);
  const g1 = handCard(g, 0, 'b8-gear'), g2 = handCard(g, 0, 'b8-gear');
  assert.ok(canPlay(g, 0, g1), '2 -> 1');
  g = play(g, 0, g1, 'base'); g = resolveAll(g);
  runes(g, 0, 1);
  assert.equal(canPlay(g, 0, g2), false, 'once each turn');
  const h = game();
  put(h, 0, 'rad-068-167', 'base');
  onlyRunes(h, 0, 1);
  assert.equal(canPlay(h, 0, handCard(h, 0, 'b8-gear')), false, 'not at base');
});

test('Orianna, Mechanical Marvel: the discount is optional (saving it for a later gear)', () => {
  let g = game();
  put(g, 0, 'rad-068-167', 1);
  onlyRunes(g, 0, 4);
  g = play(g, 0, handCard(g, 0, 'b8-gear'), 'base');
  expectPending(g, 'optional', /Orianna/);
  g = resolveAll(no(g));
  assert.equal(readyCount(g, 0), 2, 'paid the full [2]');
  g = play(g, 0, handCard(g, 0, 'b8-gear'), 'base');
  expectPending(g, 'optional', /Orianna/);
  g = resolveAll(yes(g));
  assert.equal(readyCount(g, 0), 1, 'paid [1]');
  assert.equal(g.players[0].runesInPlay.length, 4, 'no Power needed (the [A] part was not on the cost)');
});

test('Seraphic Wyvern: channel that many runes plus 1 exhausted rune', () => {
  let g = game();
  put(g, 0, 'rad-092-167', 'base');
  const n = runesLeft(g, 0);
  g = endTurn(g); g = endTurn(g); g = resolveAll(g);
  assert.equal(runesLeft(g, 0), n + 3);
  assert.equal(exhaustedRunes(g, 0), 1);
});

test('Seraphic Wyvern: with one rune left in the deck, that one is channelled (RAD-FAQ #2)', () => {
  let g = game();
  put(g, 0, 'rad-092-167', 'base');
  g = endTurn(g);
  g.players[0].runeDeck = g.players[0].runeDeck.slice(0, 1);
  const n = runesLeft(g, 0);
  g = endTurn(g); g = resolveAll(g);
  assert.equal(runesLeft(g, 0), n + 1);
  assert.equal(g.players[0].runeDeck.length, 0);
});

test("Neeko, Blending In: play her to add one of your extra legends to the Legend Zone while she's on the board", () => {
  let g = game();
  const l1 = mkObj(g, 'ogn-267-298', 0, 'setAside'), l2 = mkObj(g, 'ogn-257-298', 0, 'setAside');
  g.ex.extraLegends[0] = [l1, l2];
  runes(g, 0, 8);
  const n = handCard(g, 0, 'rad-167-167');
  g = play(g, 0, n, 'base');
  g = resolveAll(g);
  expectPending(g, 'chooseCards', /legend/i);
  g = choose(g, l1);
  g = resolveAll(g);
  assert.equal(zoneOf(g, l1), 'legendZone');
  assert.equal(zoneOf(g, l2), 'setAside');
  assert.ok(getLegalActions(g, 0).some(a => a.type === 'activate' && a.obj === l1), "the extra legend's ability is usable");
  g.objects[n].damage = 9; g.ex.dirty = true;
  g = endTurn(g);
  g = resolveAll(g);
  assert.equal(zoneOf(g, n), 'trash');
  assert.equal(zoneOf(g, l1), 'setAside', 'removed when Neeko leaves the board');
});

test('Minotaur Reckoner: units (any) can\'t move to base', () => {
  let g = game();
  put(g, 1, 'sfd-014-221', 'base');
  setController(g, 1, 0);
  const u = put(g, 0, 't-u2', 1);
  assert.ok(!getLegalActions(g, 0).some(a => a.type === 'move' && a.units.includes(u) && a.to === 'base'), 'not offered');
  assert.throws(() => act(g, { type: 'move', player: 0, units: [u], to: 'base' }), /illegal move/);
  // moves by effect are negated too (Unforgiven moves a friendly unit to its base: base stays a valid destination, VEN-FAQ #33)
  setLegend(g, 0, 'ogn-259-298');
  runes(g, 0, 2);
  g = resolveAll(activate(g, 0, g.players[0].legend));
  assert.equal(g.objects[u].battlefieldIndex, 1, 'effect move negated');
});

test("Tianna Crownguard: at a battlefield, opponents can't gain points (conquer still happens)", () => {
  let g = game({ firstPlayer: 1 });
  put(g, 0, 'sfd-060-221', 0);
  setBf(g, 1, 'ogn-298-298');
  assert.ok(hasKw(g, find(g, 'sfd-060-221')[0], 'Deflect'));
  g = moveIn(g, 1, 1).g;
  assert.equal(g.battlefields[1].controller, 1);
  assert.equal(g.players[1].points, 0);
  expectPending(g, 'chooseCards', /Discard/);    // Zaun Warrens' conquer trigger still fires
});

test('Tianna Crownguard: at base she does nothing', () => {
  let g = game({ firstPlayer: 1 });
  put(g, 0, 'sfd-060-221', 'base');
  g = moveIn(g, 1, 1).g;
  assert.equal(g.players[1].points, 1);
});

test("Ruin Runner: can't be chosen by enemy spells", () => {
  const g = game();
  const rr = put(g, 1, 'sfd-105-221', 'base');
  runes(g, 0, 2);
  assert.equal(canPlay(g, 0, handCard(g, 0, 'b8-zap')), false, 'no legal target');
  put(g, 1, 't-u1', 'base');
  let g2 = play(g, 0, handCard(g, 0, 'b8-zap'));
  g2 = resolveAll(g2);
  assert.equal(g2.objects[rr].damage, 0);
});

test('Irelia, Graceful: your spells that choose her cost [1] less', () => {
  for (const onIrelia of [true, false]) {
    let g = game();
    const ir = put(g, 0, 'sfd-141-221', 'base'), other = put(g, 0, 't-u2', 'base');
    onlyRunes(g, 0, 1);
    g = play(g, 0, handCard(g, 0, 'b8-pump'));
    g = choose(g, onIrelia ? ir : other);
    g = resolveAll(g);
    assert.equal(readyCount(g, 0), onIrelia ? 1 : 0);
  }
});

test('Vex, Cheerless: in combat, friendly spells cost [1][A] less (min [1]) and enemy spells [1][A] more', () => {
  let g = game();
  setController(g, 1, 1);
  put(g, 1, 't-u3', 1);
  onlyRunes(g, 1, 2);
  const vex = put(g, 0, 'sfd-146-221', 'base');
  g = act(g, { type: 'move', player: 0, units: [vex], to: 1 });
  expectPending(g, 'showdownAction');
  onlyRunes(g, 0, 1);
  const s = handCard(g, 0, 'b8-action2');
  assert.ok(canPlay(g, 0, s), '[2] -> [1]');
  g = play(g, 0, s);
  assert.equal(readyCount(g, 0), 0);
  g = act(g, { type: 'pass', player: 0 });
  g = act(g, { type: 'pass', player: 1 });
  expectPending(g, 'showdownAction');
  assert.equal(g.pending?.player, 1);
  assert.equal(canPlay(g, 1, handCard(g, 1, 'b8-action2')), false, 'enemy: [2] -> [3][A]');
  assert.equal(canPlay(g, 1, handCard(g, 1, 'b8-zap-action')), true, 'enemy: [1] -> [2][A] (2 runes: exhaust 2, recycle 1)');
});

test('Ezreal, Prodigy: when played, discard 1 then draw 2', () => {
  let g = game();
  runes(g, 0, 4, 'rad-r05');
  const hand = [...g.players[0].hand];
  g = play(g, 0, handCard(g, 0, 'sfd-149-221'), 'base');
  g = resolveAll(g);
  expectPending(g, 'chooseCards', /Discard 1/);
  g = choose(g, hand[0]);
  g = resolveAll(g);
  assert.equal(g.players[0].hand.length, hand.length - 1 + 2);
});

test('Ezreal, Prodigy: optional additional costs (and Repeat) cost [1] less', () => {
  let g = game();
  put(g, 0, 'sfd-149-221', 'base');
  onlyRunes(g, 0, 2);
  const u = handCard(g, 0, 'b8-optcost');
  g = play(g, 0, u, 'base');
  expectPending(g, 'optional', /draw on play/i);
  g = resolveAll(yes(g));
  assert.equal(readyCount(g, 0), 0, 'paid 2 + 0');
  onlyRunes(g, 0, 2);
  g = play(g, 0, handCard(g, 0, 'b8-repeat'));
  expectPending(g, 'optional', /Pay 1 to Repeat/);
  let h = game();
  onlyRunes(h, 0, 2);
  h = play(h, 0, handCard(h, 0, 'b8-optcost'), 'base');
  assert.notEqual(h.pending?.kind, 'optional', 'without Ezreal the optional cost [1] is unaffordable');
});

test('Hostile Takeover: take control of an enemy unit at a battlefield and ready it; it returns and is recalled at end of turn', () => {
  let g = game();
  const e = put(g, 1, 't-u3', 1, { ready: false });
  runes(g, 0, 7, 'rad-r03');
  const ht = handCard(g, 0, 'sfd-202-221');
  assert.ok(hasKw(g, ht, 'Hidden'));
  g = play(g, 0, ht);
  g = resolveAll(g);
  assert.equal(g.objects[e].controller, 0);
  assert.equal(g.objects[e].exhausted, false);
  g = endTurn(g);
  g = resolveAll(g);
  assert.equal(g.objects[e].controller, 1);
  assert.equal(zoneOf(g, e), 'base');
  assert.ok(g.players[1].base.includes(e));
});

test("Alpha Wildclaw: your units here with less Might can't be chosen by enemies", () => {
  const g = game();
  const w = put(g, 1, 'unl-057-219', 1), small = put(g, 1, 't-u2', 1), atBase = put(g, 1, 't-u2', 'base');
  assert.ok(hasKw(g, w, 'Tank'));
  runes(g, 0, 2);
  let g2 = play(g, 0, handCard(g, 0, 'b8-zap'));
  const opts = optIds(g2);
  assert.ok(!opts.includes(small));
  assert.ok(opts.includes(w) && opts.includes(atBase));
  g2 = choose(g2, atBase);
  void g2;
});

test('Zilean, Time Mage: once each turn at a battlefield, you may play an additional copy of a unit token', () => {
  let g = game();
  setController(g, 1, 0);
  put(g, 0, 'unl-086-219', 1);
  runes(g, 0, 3);
  g = play(g, 0, handCard(g, 0, 'b8-recruits'));
  g = resolveAll(g);
  expectPending(g, 'optional', /Zilean/);
  g = resolveAll(yes(g));
  const count = () => Object.values(g.objects).filter(o => o.isToken && o.controller === 0).length;
  assert.equal(count(), 2);
  g = play(g, 0, handCard(g, 0, 'b8-recruits'));
  g = resolveAll(g);
  assert.equal(count(), 3, 'once each turn');
});

test('Zilean, Time Mage: declining plays only one; at base nothing', () => {
  let g = game();
  put(g, 0, 'unl-086-219', 1);
  runes(g, 0, 2);
  g = play(g, 0, handCard(g, 0, 'b8-recruits'));
  g = resolveAll(g);
  g = resolveAll(no(g));
  assert.equal(Object.values(g.objects).filter(o => o.isToken).length, 1);
  let h = game();
  put(h, 0, 'unl-086-219', 'base');
  runes(h, 0, 2);
  h = resolveAll(play(h, 0, handCard(h, 0, 'b8-recruits')));
  assert.equal(h.pending?.kind, 'mainAction');
});

test('Blue Sentinel: your hold effects here trigger an additional time; when it holds, [Add] [A] at your next Main Phase', () => {
  let g = game();
  setBf(g, 1, 'ogn-280-298');
  setController(g, 1, 0);
  const s = put(g, 0, 'unl-087-219', 1);
  assert.ok(hasKw(g, s, 'Shield'));
  g = endTurn(g); g = endTurn(g);
  const h = g.players[0].hand.length;
  for (let i = 0; i < 6 && g.pending?.kind !== 'mainAction'; i++) g = resolveAll(g.pending?.kind === 'orderTriggers' || g.pending?.kind === 'chooseOrder' ? choose(g, g.pending.options![0].id) : g);
  assert.equal(g.pending?.kind, 'mainAction');
  assert.equal(g.players[0].hand.length, h + 2 + 1, 'Grove twice + Draw Phase');
  assert.equal(g.players[0].pool.power.Colorless ?? 0, 2, "Sentinel's own hold effect also triggered twice");
});

test('LeBlanc: your Temporary units at her battlefield are not killed', () => {
  let g = game();
  setController(g, 1, 0);
  put(g, 0, 'unl-090-219', 1);
  const t1 = put(g, 0, 't-temp', 1), t2 = put(g, 0, 't-temp', 'base');
  g = endTurn(g); g = endTurn(g); g = resolveAll(g);
  assert.equal(zoneOf(g, t1), 'battlefield');
  assert.equal(zoneOf(g, t2), 'trash');
});

test("Determined Sentry: it can't move to base", () => {
  let g = game();
  setController(g, 1, 0);
  const s = put(g, 0, 'unl-111-219', 1), o = put(g, 0, 't-u1', 1);
  assert.throws(() => act(g, { type: 'move', player: 0, units: [s, o], to: 'base' }), /illegal move/);
  g = act(g, { type: 'move', player: 0, units: [o], to: 'base' });
  g = resolveAll(g);
  assert.equal(g.objects[s].battlefieldIndex, 1);
  assert.equal(zoneOf(g, o), 'base', 'other units can');
});

test("Maduli the Gatekeeper: can't be readied; [C]: move to an occupied enemy battlefield with less total enemy Might", () => {
  let g = game();
  const m = put(g, 0, 'unl-144-219', 'base', { ready: false });
  put(g, 1, 't-u5', 1);
  runes(g, 0, 2, 'rad-r05');
  g = play(g, 0, handCard(g, 0, 'b8-readyall'));
  g = resolveAll(g);
  assert.equal(g.objects[m].exhausted, true, "can't be readied");
  g = activate(g, 0, m, 1);
  g = resolveAll(g);
  assert.equal(g.objects[m].battlefieldIndex, 1);
});

test('Maduli the Gatekeeper: not if the enemies there have as much Might', () => {
  const g = game();
  const m = put(g, 0, 'unl-144-219', 'base');
  put(g, 1, 't-u5', 1); put(g, 1, 't-u1', 1);
  runes(g, 0, 2, 'rad-r05');
  assert.equal(getLegalActions(g, 0).some(a => a.type === 'activate' && a.obj === m), false);
});

test('Dune Surfer: you ignore Tank while assigning combat damage here', () => {
  let g = game();
  setController(g, 1, 1);
  const tank = put(g, 1, 't-tank', 1), small = put(g, 1, 't-u1', 1);
  const ds = put(g, 0, 'ven-004-166', 'base');
  g = act(g, { type: 'move', player: 0, units: [ds], to: 1 });
  for (let i = 0; i < 5 && g.pending?.kind !== 'assignDamage'; i++) g = resolveAll(g);
  expectPending(g, 'assignDamage');
  g = act(g, { type: 'assignDamage', player: 0, assignment: { [small]: 1, [tank]: 2 } });
  g = resolveAll(g);
  assert.equal(zoneOf(g, small), 'trash');
});

test('Esteemed Hierophant: with 7+ runes, damage from enemy spells to it is prevented', () => {
  for (const n of [7, 6]) {
    let g = game();
    const h = put(g, 1, 'ven-025-166', 'base');
    g.players[1].runesInPlay.forEach(r => { g.objects[r].zone = 'runeDeck'; });
    g.players[1].runesInPlay = [];
    runes(g, 1, n);
    runes(g, 0, 2);
    g = play(g, 0, handCard(g, 0, 'b8-zap'));
    if (g.pending?.kind === 'chooseTargets') g = choose(g, h);
    g = resolveAll(g);
    assert.equal(g.objects[h].damage, n >= 7 ? 0 : 1);
  }
});

test("Ol' Poro: can't be played on your first three turns", () => {
  const g = game();
  runes(g, 0, 4);
  const p = handCard(g, 0, 'ven-029-166');
  assert.equal(canPlay(g, 0, p), false);
  g.players[0].turnsTaken = 3;
  assert.equal(canPlay(g, 0, p), true, 'fourth turn');
});

test('Sandstone Chimera: at a battlefield, players channel only 1 rune in their Channel Phase', () => {
  let g = game();
  put(g, 0, 'ven-036-166', 1);
  const n = runesLeft(g, 0);
  g = endTurn(g); g = endTurn(g); g = resolveAll(g);
  assert.equal(runesLeft(g, 0), n + 1);
});

test('Otterpus: scoring 1 point in your first or second turn draws 1 instead', () => {
  let g = game();
  put(g, 1, 'ven-053-166', 'base');
  const h = g.players[0].hand.length;
  g = moveIn(g, 0, 1).g;
  assert.equal(g.players[0].points, 0);
  assert.equal(g.players[0].hand.length, h + 1);
  let g2 = game();
  put(g2, 1, 'ven-053-166', 'base');
  g2.players[0].turnsTaken = 2;
  g2 = moveIn(g2, 0, 1).g;
  assert.equal(g2.players[0].points, 1, 'third turn: scores');
});

test('Spiderling: +1 for each other unit you control here named Spiderling', () => {
  const g = game();
  const a = put(g, 0, 'ven-097-166', 1), b = put(g, 0, 'ven-097-166', 1), c = put(g, 0, 'ven-097-166', 'base');
  put(g, 1, 'ven-097-166', 1);
  assert.equal(might(g, a), 2); assert.equal(might(g, b), 2); assert.equal(might(g, c), 1);
  assert.ok(hasKw(g, a, 'Hidden'));
});

test('Spiderling: decks may hold any number of Spiderlings', async () => {
  const { validateDeck } = await import('../../../src/engine/deck.ts');
  const { db } = await import('./b8-util.ts');
  const deck = { legend: 'ogn-251-298', champion: 'ogn-189-298', main: new Array(39).fill('ven-097-166'), runes: new Array(12).fill('rad-r05'), battlefields: ['ogn-280-298', 'ogn-282-298', 'ogn-283-298'] };
  assert.equal(validateDeck(deck, db).filter(p => p.code === 'copies').length, 0);
});

test("Fallen Feline: name a spell; while it's at a battlefield, opponents can't play spells with that name", () => {
  let g = game();
  setController(g, 1, 0); put(g, 0, 't-u1', 1);
  runes(g, 0, 4, 'rad-r06');
  const f = handCard(g, 0, 'ven-132-166');
  g = play(g, 0, f, 1);
  g = resolveAll(g);
  expectPending(g, 'chooseMode', /Name a spell/);
  g = choose(g, 'Zap');
  g = resolveAll(g);
  g = endTurn(g);
  runes(g, 1, 3);
  assert.equal(canPlay(g, 1, handCard(g, 1, 'b8-zap')), false);
  assert.equal(canPlay(g, 1, handCard(g, 1, 'b8-pump')), true);
  g.objects[f].zone = 'base'; delete g.objects[f].battlefieldIndex; g.players[0].base.push(f);
  assert.equal(canPlay(g, 1, handCard(g, 1, 'b8-zap')), true, 'not while it is at base');
});

void yes;

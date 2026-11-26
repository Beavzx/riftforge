// B4: conditional self-Might / self-keyword statics, enters-ready conditions, cost changes.
import { test } from 'node:test';
import {
  assert, game, put, runes, handCard, setController, play, mightOf, hasKw, kwVal, tagsOf, answer, pend, settle, move,
  domainRunes, drainRunes, resolveAll, getLegalActions, act, optIds, choose, zoneOf, loc,
} from './_util.ts';
import { discard, kill } from '../../../src/engine/actions.ts';

test('Magma Wurm: other friendly units enter ready, Wurm itself and enemy units do not', () => {
  let g = game();
  put(g, 0, 'ogn-011-298', 'base');
  runes(g, 0, 2);
  const u = handCard(g, 0, 't-u2');
  g = play(g, 0, u, 'base');
  g = resolveAll(g);
  assert.equal(g.objects[u].exhausted, false);
  // without the Wurm: enters exhausted
  let h = game();
  runes(h, 0, 2);
  const v = handCard(h, 0, 't-u2');
  h = play(h, 0, v, 'base');
  assert.equal(h.objects[v].exhausted, true);
  // the Wurm itself enters exhausted
  let k = game();
  runes(k, 0, 8); domainRunes(k, 0, 1, 'Fury');
  const w = handCard(k, 0, 'ogn-011-298');
  k = play(k, 0, w, 'base');
  assert.equal(k.objects[w].exhausted, true);
});

test('Raging Soul: Assault and Ganking only after you discarded a card this turn', () => {
  const g = game();
  const s = put(g, 0, 'ogn-019-298', 'base');
  assert.equal(hasKw(g, s, 'Assault'), false);
  assert.equal(hasKw(g, s, 'Ganking'), false);
  discard(g, 0, [g.players[0].hand[0]]);
  assert.equal(hasKw(g, s, 'Assault'), true);
  assert.equal(hasKw(g, s, 'Ganking'), true);
  // the opponent discarding doesn't count
  const g2 = game();
  const s2 = put(g2, 0, 'ogn-019-298', 'base');
  discard(g2, 1, [g2.players[1].hand[0]]);
  assert.equal(hasKw(g2, s2, 'Ganking'), false);
});

test('Draven, Showboat: Might increased by your points', () => {
  const g = game();
  const d = put(g, 0, 'ogn-028-298', 'base');
  assert.equal(mightOf(g, d), 3);
  g.players[0].points = 4; g.players[1].points = 2;
  assert.equal(mightOf(g, d), 7);
});

test('Wizened Elder: +1 more while buffed; Bilgewater Bully: Ganking while buffed', () => {
  const g = game();
  const e = put(g, 0, 'ogn-065-298', 'base');
  const b = put(g, 0, 'ogn-125-298', 'base');
  assert.equal(mightOf(g, e), 4);
  assert.equal(hasKw(g, b, 'Ganking'), false);
  g.objects[e].counters.buff = 1; g.objects[b].counters.buff = 1;
  assert.equal(mightOf(g, e), 6);
  assert.equal(hasKw(g, b, 'Ganking'), true);
});

test('Fiora, Victorious: Deflect, Ganking and Shield only while Mighty', () => {
  const g = game();
  const f = put(g, 0, 'ogn-232-298', 'base');
  for (const k of ['Deflect', 'Ganking', 'Shield']) assert.equal(hasKw(g, f, k), false);
  g.objects[f].counters.buff = 1;            // 5 Might
  for (const k of ['Deflect', 'Ganking', 'Shield']) assert.equal(hasKw(g, f, k), true, k);
});

test('Fiora, Victorious: Mighty through another static ability (anthem) also counts', () => {
  const g = game();
  const f = put(g, 0, 'ogn-232-298', 'base');
  put(g, 1, 'ts-anthem', 'base');            // enemy anthem: no
  assert.equal(hasKw(g, f, 'Ganking'), false);
  put(g, 0, 'ts-anthem', 'base');            // other friendly units have +1
  assert.equal(mightOf(g, f), 5);
  assert.equal(hasKw(g, f, 'Ganking'), true);
});

test('Sett, Kingpin: +1 for each buffed friendly unit at his battlefield (incl. himself), nothing at base', () => {
  const g = game();
  setController(g, 0, 0);
  const s = put(g, 0, 'ogn-240-298', 0);
  const a = put(g, 0, 't-u2', 0);
  const b = put(g, 0, 't-u2', 1);
  const e = put(g, 1, 't-u2', 0);
  g.objects[a].counters.buff = 1; g.objects[b].counters.buff = 1; g.objects[e].counters.buff = 1;
  assert.equal(mightOf(g, s), 6);           // 5 + a
  g.objects[s].counters.buff = 1;
  assert.equal(mightOf(g, s), 8);           // 5 + buff + a + self
  const s2 = put(g, 0, 'ogn-240-298', 'base');
  put(g, 0, 't-u1', 'base', {}); g.objects[s2].counters.buff = 1;
  assert.equal(mightOf(g, s2), 6);          // base: no battlefield bonus
  assert.ok(hasKw(g, s, 'Tank'));
});

test('Master Yi, Meditative: +4 while you have 8+ runes', () => {
  const g = game();
  const y = put(g, 0, 'ogs-004-024', 'base');
  const have = g.players[0].runesInPlay.length;
  runes(g, 0, 7 - have);
  assert.equal(mightOf(g, y), 4);
  runes(g, 0, 1);
  assert.equal(mightOf(g, y), 8);
});

test('enters ready: Master Yi Honed, Vanguard Attendant, Wrath of the Freljord, Eager Drakehound, Warwick', () => {
  for (const [id, dom] of [['ogs-009-024', 'Body'], ['ogs-016-024', 'Order'], ['rad-077-167', 'Body'], ['sfd-006-221', 'Fury'], ['ogn-159-298', 'Body']] as const) {
    let g = game();
    runes(g, 0, 10); domainRunes(g, 0, 2, dom);
    const u = handCard(g, 0, id);
    g = play(g, 0, u, 'base');
    g = settle(g);
    assert.equal(g.objects[u].zone, 'base', id);
    assert.equal(g.objects[u].exhausted, false, id);
  }
  const g = game();
  assert.ok(hasKw(g, put(g, 0, 'ogs-009-024', 'base'), 'Ganking'));
  assert.equal(kwVal(g, put(g, 0, 'rad-077-167', 'base'), 'Shield'), 3);
});

test('Overloaded Traveler: +1 while a friendly Deploy gear is at its battlefield', () => {
  const g = game();
  setController(g, 0, 0);
  const t = put(g, 0, 'rad-072-167', 0);
  assert.equal(mightOf(g, t), 2);
  put(g, 1, 'rad-156-167', 0);                 // enemy Deploy gear: no
  assert.equal(mightOf(g, t), 2);
  put(g, 0, 'rad-156-167', 1);                 // other battlefield: no
  assert.equal(mightOf(g, t), 2);
  put(g, 0, 'rad-156-167', 0);
  assert.equal(mightOf(g, t), 3);
});

test('Steadfast Outrider: +2 with 2+ other friendly units and/or gear at its battlefield', () => {
  const g = game();
  setController(g, 0, 0);
  const o = put(g, 0, 'rad-128-167', 0);
  put(g, 0, 't-u1', 0);
  assert.equal(mightOf(g, o), 3);
  put(g, 0, 'rad-156-167', 0);
  assert.equal(mightOf(g, o), 5);
  const o2 = put(g, 0, 'rad-128-167', 'base');
  put(g, 0, 't-u1', 'base'); put(g, 0, 't-u1', 'base');
  assert.equal(mightOf(g, o2), 3);           // base is not a battlefield
});

test('Ancient Warmonger: Assault equal to the number of enemy units here', () => {
  const g = game();
  const w = put(g, 0, 'sfd-131-221', 0);
  assert.equal(kwVal(g, w, 'Assault'), 0);
  put(g, 1, 't-u1', 0); put(g, 1, 't-u2', 0); put(g, 1, 't-u2', 1);
  assert.equal(kwVal(g, w, 'Assault'), 2);
  assert.ok(hasKw(g, w, 'Accelerate'));
});

test('Repair Specialist: Assault equal to the number of gear you control', () => {
  const g = game();
  const r = put(g, 0, 'ven-076-166', 'base');
  assert.equal(kwVal(g, r, 'Assault'), 0);
  put(g, 0, 't-gold', 'base'); put(g, 0, 't-gold', 'base'); put(g, 1, 't-gold', 'base');
  assert.equal(kwVal(g, r, 'Assault'), 2);
});

test('Petal Pixie: +1 for each of your Temporary units at her battlefield', () => {
  const g = game();
  setController(g, 0, 0);
  const p = put(g, 0, 'unl-076-219', 0);
  put(g, 0, 't-temp', 0); put(g, 0, 't-temp', 0); put(g, 1, 't-temp', 0); put(g, 0, 't-temp', 'base');
  assert.equal(mightOf(g, p), 4);
});

test('Crimson Pigeons: +2 only while attacking with another unit', () => {
  const g = game();
  const p = put(g, 0, 'unl-154-219', 0);
  const q = put(g, 0, 't-u1', 0);
  assert.equal(mightOf(g, p), 3);
  g.objects[p].combatRole = 'attacker';
  assert.equal(mightOf(g, p), 3);
  g.objects[q].combatRole = 'attacker';
  assert.equal(mightOf(g, p), 5);
});

test('Kennen: +2 while there is a stunned enemy unit here', () => {
  const g = game();
  const k = put(g, 0, 'ven-135-166', 0);
  const e = put(g, 1, 't-u2', 0);
  const far = put(g, 1, 't-u2', 1);
  g.objects[far].stunned = true;
  assert.equal(mightOf(g, k), 2);
  g.objects[e].stunned = true;
  assert.equal(mightOf(g, k), 4);
});

test('Sivir, Mercenary: +2 and Ganking once you spent [A][A] this turn', () => {
  let g = game();
  const s = put(g, 0, 'sfd-143-221', 'base');
  assert.equal(mightOf(g, s), 4);
  assert.equal(hasKw(g, s, 'Ganking'), false);
  // Zenith Blade costs [3] + 2 power
  runes(g, 0, 3); domainRunes(g, 0, 2, 'Calm');
  const e = put(g, 1, 't-u2', 0);
  const z = handCard(g, 0, 'ogn-262-298');
  g = play(g, 0, z);
  if (pend(g).kind === 'chooseTargets' && optIds(g).includes(e)) g = choose(g, e);
  if (pend(g).kind === 'chooseTargets') g = choose(g);
  g = resolveAll(g);
  assert.equal(mightOf(g, s), 6);
  assert.equal(hasKw(g, s, 'Ganking'), true);
});

test('Prepared Neophyte: +4 after spending [4]+ on a spell this turn', () => {
  let g = game();
  const n = put(g, 0, 'unl-004-219', 'base');
  const f = put(g, 0, 't-u2', 'base');
  assert.equal(mightOf(g, n), 1);
  runes(g, 0, 4); domainRunes(g, 0, 1, 'Calm');
  const h = handCard(g, 0, 'ogs-020-024');      // Highlander Yi, [4]
  g = play(g, 0, h);
  if (pend(g).kind === 'chooseTargets') g = choose(g, f);
  g = resolveAll(g);
  assert.equal(mightOf(g, n), 5);
});

test('Dunebreaker: enters ready only with two or fewer cards in hand', () => {
  let g = game();
  runes(g, 0, 7); domainRunes(g, 0, 1, 'Fury');
  g.players[0].hand = [];
  const d = handCard(g, 0, 'sfd-027-221');
  handCard(g, 0, 't-u1'); handCard(g, 0, 't-u1');
  g = play(g, 0, d, 'base');
  assert.equal(g.objects[d].exhausted, false);
  let h = game();
  runes(h, 0, 7); domainRunes(h, 0, 1, 'Fury');
  const d2 = handCard(h, 0, 'sfd-027-221');      // hand has 4 others
  h = play(h, 0, d2, 'base');
  assert.equal(h.objects[d2].exhausted, true);
});

test('Direwing: enters ready only if you control another Dragon', () => {
  let g = game();
  runes(g, 0, 7);
  put(g, 0, 'sfd-006-221', 'base');            // Eager Drakehound (Dragon)
  const d = handCard(g, 0, 'sfd-094-221');
  g = play(g, 0, d, 'base');
  assert.equal(g.objects[d].exhausted, false);
  let h = game();
  runes(h, 0, 7);
  put(h, 1, 'sfd-006-221', 'base');            // enemy Dragon doesn't count
  const d2 = handCard(h, 0, 'sfd-094-221');
  h = play(h, 0, d2, 'base');
  assert.equal(h.objects[d2].exhausted, true);
});

test('Towering Pairofant: enters ready if any unit died this turn', () => {
  let g = game();
  runes(g, 0, 6);
  const p = handCard(g, 0, 'unl-008-219');
  g = play(g, 0, p, 'base');
  assert.equal(g.objects[p].exhausted, true);
  let h = game();
  runes(h, 0, 6);
  const victim = put(h, 1, 't-u1', 'base');
  kill(h, [victim]);
  const p2 = handCard(h, 0, 'unl-008-219');
  h = play(h, 0, p2, 'base');
  assert.equal(zoneOf(h, victim), 'trash');
  assert.equal(h.objects[p2].exhausted, false);
});

test('Shadow Assassin: enters ready if a card with its name is in your trash', () => {
  let g = game();
  runes(g, 0, 5);
  put(g, 0, 'ven-013-166', 'trash');
  const a = handCard(g, 0, 'ven-013-166');
  g = play(g, 0, a, 'base');
  assert.equal(g.objects[a].exhausted, false);
  let h = game();
  runes(h, 0, 5);
  put(h, 1, 'ven-013-166', 'trash');           // opponent's trash doesn't count
  const a2 = handCard(h, 0, 'ven-013-166');
  h = play(h, 0, a2, 'base');
  assert.equal(h.objects[a2].exhausted, true);
});

test('Corrupted Dragon: enters ready unless your score is within 3 of the Victory Score', () => {
  let g = game();
  runes(g, 0, 10); domainRunes(g, 0, 2, 'Body');
  const d = handCard(g, 0, 'ven-091-166');
  g = play(g, 0, d, 'base');
  assert.equal(g.objects[d].exhausted, false);
  let h = game();
  h.players[0].points = 5;                    // 8 - 5 = 3: within 3
  runes(h, 0, 10); domainRunes(h, 0, 2, 'Body');
  const d2 = handCard(h, 0, 'ven-091-166');
  h = play(h, 0, d2, 'base');
  assert.equal(h.objects[d2].exhausted, true);
});

test('Vayne, Hunter: enters ready if an opponent controls a battlefield; Assault 3', () => {
  let g = game();
  runes(g, 0, 4); domainRunes(g, 0, 1, 'Fury');
  setController(g, 1, 1);
  const v = handCard(g, 0, 'ogn-035-298');
  g = play(g, 0, v, 'base');
  assert.equal(g.objects[v].exhausted, false);
  assert.equal(kwVal(g, v, 'Assault'), 3);
  let h = game();
  runes(h, 0, 4); domainRunes(h, 0, 1, 'Fury');
  setController(h, 1, 0);                      // you control one: no
  const v2 = handCard(h, 0, 'ogn-035-298');
  h = play(h, 0, v2, 'base');
  assert.equal(h.objects[v2].exhausted, true);
});

test('Shadow: enters ready only when played to a battlefield', () => {
  let g = game();
  runes(g, 0, 6);
  setController(g, 0, 0);
  put(g, 0, 't-u1', 0);
  const s = handCard(g, 0, 'unl-194-219');
  g = play(g, 0, s, 0);
  assert.equal(loc(g, s), 0);
  assert.equal(g.objects[s].exhausted, false);
  const s2 = handCard(g, 0, 'unl-194-219');
  g = play(g, 0, s2, 'base');
  assert.equal(g.objects[s2].exhausted, true);
});

test('Daisy!: enters ready; costs [1] less for each of Bird, Cat, Dog, Poro among your units', () => {
  let g = game();
  const have = g.players[0].runesInPlay.length;
  runes(g, 0, 5 - have); domainRunes(g, 0, 2, 'Order');   // 7 runes (2 Order): 7 energy, Daisy costs [9]
  const d = handCard(g, 0, 'unl-196-219');
  assert.ok(!getLegalActions(g, 0).some(a => a.type === 'playCard' && a.obj === d), 'needs 9 energy + 2 power without tags');
  put(g, 0, 'unl-137-219', 'base');            // Sinister Poro (Poro)
  put(g, 0, 'sfd-006-221', 'base');            // Eager Drakehound (Dog)
  put(g, 1, 'unl-154-219', 'base');            // enemy Bird doesn't count
  assert.ok(getLegalActions(g, 0).some(a => a.type === 'playCard' && a.obj === d), 'discount 2');
  g = play(g, 0, d, 'base');
  assert.equal(g.objects[d].zone, 'base');
  assert.equal(g.objects[d].exhausted, false);
  assert.equal(g.players[0].runesInPlay.filter(r => !g.objects[r].exhausted).length, 0);
});

test('Entrenched Boar: may enter ready; if it does it cannot move this turn', () => {
  let g = game();
  runes(g, 0, 2);
  const b = handCard(g, 0, 'rad-026-167');
  g = play(g, 0, b, 'base');
  g = answer(g, 'optional', 'yes');
  assert.equal(g.objects[b].exhausted, false);
  setController(g, 0, 0);
  assert.ok(!getLegalActions(g, 0).some(a => a.type === 'move' && a.units.includes(b)), 'cannot move this turn');
  // declined: enters exhausted (normal)
  let h = game();
  runes(h, 0, 2);
  const b2 = handCard(h, 0, 'rad-026-167');
  h = play(h, 0, b2, 'base');
  h = answer(h, 'optional', 'no');
  assert.equal(h.objects[b2].exhausted, true);
  // next turn it can move again
  g = settle(act(g, { type: 'endTurn', player: 0 }), 0);
  assert.equal(g.activePlayer, 0);
  assert.ok(getLegalActions(g, 0).some(a => a.type === 'move' && a.units.includes(b)), 'can move next turn');
  void move; void drainRunes;
});

test('Ivern: gains the chosen tag; scores on conquer/hold only with Bird, Cat, Dog and Poro among your units', () => {
  let g = game();
  runes(g, 0, 6); domainRunes(g, 0, 1, 'Order');
  const iv = handCard(g, 0, 'unl-177-219');
  g = play(g, 0, iv, 'base');
  assert.equal(pend(g).kind, 'chooseMode');
  assert.deepEqual(optIds(g), ['Bird', 'Cat', 'Dog', 'Poro']);
  g = choose(g, 'Cat');
  g = resolveAll(g);
  assert.ok(tagsOf(g, iv).includes('Cat'));
  assert.ok(tagsOf(g, iv).includes('Ivern'));
  // hold with only Cat + Poro: no point
  setController(g, 0, 0);
  g.objects[iv].zone = 'battlefield'; g.objects[iv].battlefieldIndex = 0; g.players[0].base = g.players[0].base.filter(x => x !== iv);
  put(g, 0, 'unl-137-219', 'base');           // Poro
  g = settle(act(g, { type: 'endTurn', player: 0 }), 0);
  assert.equal(g.players[0].points, 1);       // hold point only
  // add Bird and Dog: hold scores the bonus point
  put(g, 0, 'unl-154-219', 'base');           // Bird
  put(g, 0, 'sfd-006-221', 'base');           // Dog
  g = settle(act(g, { type: 'endTurn', player: 0 }), 0);
  assert.equal(g.players[0].points, 3);
});

test('Soraka, Wanderer: must be assigned combat damage last (Backline)', () => {
  const g = game();
  assert.ok(hasKw(g, put(g, 0, 'sfd-173-221', 'base'), 'Backline'));
  void drainRunes;
});

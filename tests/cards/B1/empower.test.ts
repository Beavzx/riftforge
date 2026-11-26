// B1: Vendetta cards — Empower / Disempower / Empowered.
import { test } from 'node:test';
import {
  assert, game, setRunes, readyRunes, put, handCard, playAct, answer, isAsking, resolveAll, zoneOf, canPlayNow, setController,
  hand, legend, m, attack, resolveCombat, optionIds, hasKw, kwVal, nextTurn, xp, abilities, activate, putFacedown, act, EMPOWER, settle, resolveChain,
  type GameState, type ObjId, type PlayerId,
} from './_util.ts';
import { makeCtx } from '../../../src/engine/context.ts';
import { chars } from '../../../src/engine/chars.ts';

function empower(g: GameState, p: PlayerId, obj: ObjId): GameState {
  assert.ok(abilities(g, p, obj).includes(EMPOWER), 'Empower is activatable');
  g = activate(g, p, obj, EMPOWER);
  return resolveAll(g);
}
const emp = (g: GameState, id: ObjId) => g.objects[id].empowered ?? 0;

test('ven-001 Baccai Sandspinner: Empower [5], [3] less with 4 or fewer runes; Empowered: Deflect + Assault 2', () => {
  let g = game();
  setRunes(g, 0, { Fury: 4 });
  const u = put(g, 0, 'ven-001-166', 'base');
  assert.equal(hasKw(g, u, 'Deflect'), false);
  g = empower(g, 0, u);
  assert.equal(readyRunes(g, 0), 2, 'paid [2]');
  assert.ok(hasKw(g, u, 'Deflect') && kwVal(g, u, 'Assault') === 2);
  assert.equal(abilities(g, 0, u).includes(EMPOWER), false, 'only if not Empowered');
  let h = game();
  setRunes(h, 0, { Fury: 5 });
  const u2 = put(h, 0, 'ven-001-166', 'base');
  h = empower(h, 0, u2);
  assert.equal(readyRunes(h, 0), 0, 'paid [5] with 5 runes');
});

test('ven-007 Punching Poro: Empower — Discard 1; Empowered: +1', () => {
  let g = game();
  g.players[0].hand = [];
  const u = put(g, 0, 'ven-007-166', 'base');
  assert.equal(abilities(g, 0, u).includes(EMPOWER), false, 'nothing to discard');
  const c = handCard(g, 0, 't-u1');
  g = activate(g, 0, u, EMPOWER);
  g = resolveAll(g);
  assert.equal(zoneOf(g, c), 'trash');
  assert.equal(emp(g, u), 1);
  assert.equal(m(g, u), 3);
});

test('ven-014 Shadow Fiend: Empower [2][C]; Empowered: Assault 3', () => {
  let g = game();
  setRunes(g, 0, { Fury: 2 });
  const u = put(g, 0, 'ven-014-166', 'base');
  g = empower(g, 0, u);
  assert.equal(kwVal(g, u, 'Assault'), 3);
  assert.equal(g.players[0].runesInPlay.length, 1, '[C] paid by recycling a Fury rune');
});

test('ven-018 Rage Amplifier: your units +1, +2 instead while Empowered', () => {
  let g = game();
  setRunes(g, 0, { Fury: 7 });
  const ra = put(g, 0, 'ven-018-166', 'base');
  const u = put(g, 0, 't-u2', 'base'), e = put(g, 1, 't-u2', 0);
  g.ex.dirty = true;
  assert.equal(m(g, u), 3); assert.equal(m(g, e), 2);
  g = empower(g, 0, ra);
  assert.equal(m(g, u), 4);
});

test('ven-021 Akali: when she moves, may deal 1 (2 if Empowered) to a unit at a battlefield she moved to/from; Empowered +1', () => {
  let g = game();
  setRunes(g, 0, { Fury: 3 });
  setController(g, 0, 0);
  const a = put(g, 0, 'ven-021-166', 0);
  const f = put(g, 0, 't-u5', 0), far = put(g, 0, 't-u5', 'base');
  g = empower(g, 0, a);
  assert.equal(m(g, a), 4);
  g = act(g, { type: 'move', player: 0, units: [a], to: 'base' });
  g = answer(g, 'optional', 'yes');                   // only the unit at the battlefield she left is eligible
  assert.equal(isAsking(g, 'chooseTargets'), false);
  g = resolveAll(g);
  assert.equal(g.objects[f].damage, 2);
  assert.equal(g.objects[far].damage, 0);
});

test('ven-021 Akali: declining deals nothing', () => {
  let g = game();
  const a = put(g, 0, 'ven-021-166', 'base');
  g = act(g, { type: 'move', player: 0, units: [a], to: 1 });
  g = resolveCombat(g, 0);
  g = answer(g, 'optional', 'no');
  g = resolveCombat(g, 0);
  assert.equal(g.objects[a].damage, 0);
});

test('ven-028 Mournful Witness: empowered when a combat it was in ends; Empowered +2', () => {
  let g = game();
  const w = put(g, 0, 'ven-028-166', 'base');
  setController(g, 0, 1);
  put(g, 1, 't-u1', 0);
  g = attack(g, 0, [w], 0);
  assert.equal(emp(g, w), 1);
  assert.equal(m(g, w), 4);
});

test('ven-030 Serene Ascetic: Empower [3]; Empowered: Deflect + Shield 3', () => {
  let g = game();
  setRunes(g, 0, { Calm: 3 });
  const u = put(g, 0, 'ven-030-166', 'base');
  g = empower(g, 0, u);
  assert.ok(hasKw(g, u, 'Deflect')); assert.equal(kwVal(g, u, 'Shield'), 3);
});

test('ven-031 Twilight Shroud: +1 and untargetable by enemies this turn; Flow [2] from trash, then banished', () => {
  let g = game();
  setRunes(g, 0, { Calm: 2 });
  const u = put(g, 0, 't-u2', 'base');
  const s = put(g, 0, 'ven-031-166', 'trash');
  assert.ok(canPlayNow(g, 0, s), 'Flow from trash');
  g = playAct(g, 0, s);
  g = resolveAll(g);
  assert.equal(m(g, u), 3);
  assert.equal(chars(g, u).cantBeChosenByEnemy, true);
  assert.equal(zoneOf(g, s), 'banishment');
  assert.equal(readyRunes(g, 0), 0);
});

test('ven-032 Frostcoat Mother: Empower [12], [1] less per rune you control; Empowered +3', () => {
  let g = game();
  setRunes(g, 0, { Calm: 6 });
  const u = put(g, 0, 'ven-032-166', 'base');
  g = empower(g, 0, u);
  assert.equal(readyRunes(g, 0), 0, 'paid [6]');
  assert.equal(m(g, u), 6);
  let h = game();
  setRunes(h, 0, { Calm: 5 });
  const u2 = put(h, 0, 'ven-032-166', 'base');
  assert.equal(abilities(h, 0, u2).includes(EMPOWER), false, '[7] with 5 runes');
});

test('ven-035 Sanction: empower a unit until end of turn, or disempower one until end of turn', () => {
  let g = game();
  setRunes(g, 0, { Calm: 8 });
  const a = put(g, 0, 'ven-043-166', 'base');     // Steel Paws: +7 while Empowered
  const b = put(g, 1, 'ven-043-166', 0);
  g.objects[b].empowered = 1;
  const s1 = handCard(g, 0, 'ven-035-166');
  g = playAct(g, 0, s1);
  g = answer(g, 'chooseMode', 'empower');
  g = answer(g, 'chooseTargets', a);
  g = resolveAll(g);
  assert.equal(emp(g, a), 1); assert.equal(m(g, a), 7);
  const s2 = handCard(g, 0, 'ven-035-166');
  g = playAct(g, 0, s2);
  g = answer(g, 'chooseMode', 'disempower');
  assert.deepEqual(optionIds(g).sort(), [a, b].sort(), 'only Empowered units');
  g = answer(g, 'chooseTargets', b);
  g = resolveAll(g);
  assert.equal(emp(g, b), 0);
  g = act(g, { type: 'endTurn', player: 0 });
  g = settle(g);
  assert.equal(emp(g, a), 0, 'disempowered at end of turn');
  assert.equal(emp(g, b), 1, 'empowered again at end of turn');
});

test('ven-037 Tomb-Raider Barbara: with 7+ runes, disempower an Empowered enemy gear or kill it', () => {
  let g = game();
  setRunes(g, 0, { Calm: 7 });
  const g1 = put(g, 1, 'ven-018-166', 'base');
  g.objects[g1].empowered = 1;
  const b = handCard(g, 0, 'ven-037-166');
  g = playAct(g, 0, b, 'base'); g = resolveAll(g);
  assert.equal(zoneOf(g, g1), 'base'); assert.equal(emp(g, g1), 0);
  const b2 = handCard(g, 0, 'ven-037-166');
  setRunes(g, 0, { Calm: 7 });
  g = playAct(g, 0, b2, 'base'); g = resolveAll(g);
  assert.equal(zoneOf(g, g1), 'trash');
  // fewer than 7 runes: no effect
  let h = game();
  setRunes(h, 0, { Calm: 6 });
  const g2 = put(h, 1, 'ven-018-166', 'base');
  const b3 = handCard(h, 0, 'ven-037-166');
  h = playAct(h, 0, b3, 'base'); h = resolveAll(h);
  assert.equal(zoneOf(h, g2), 'base');
});

test('ven-043 Steel Paws: Empower [7]; Empowered +7; Deflect', () => {
  let g = game();
  setRunes(g, 0, { Calm: 7 });
  const u = put(g, 0, 'ven-043-166', 'base');
  assert.equal(m(g, u), 0);
  g = empower(g, 0, u);
  assert.equal(m(g, u), 7);
  assert.ok(hasKw(g, u, 'Deflect'));
});

test("ven-045 Helm of Suppression: opponents' spells cost [1] more, [1][A] more while Empowered", () => {
  let g = game();
  const helm = put(g, 1, 'ven-045-166', 'base');
  setRunes(g, 0, { Calm: 1 });
  put(g, 0, 't-u2', 'base');
  const s = handCard(g, 0, 'unl-031-219');          // Combat Experience [1]
  assert.equal(canPlayNow(g, 0, s), false);
  setRunes(g, 0, { Calm: 2 });
  assert.ok(canPlayNow(g, 0, s));
  g = playAct(g, 0, s); g = resolveAll(g);
  assert.equal(g.players[0].runesInPlay.length, 2);
  g.objects[helm].empowered = 1;
  setRunes(g, 0, { Calm: 2 });
  const s2 = handCard(g, 0, 'unl-031-219');
  g = playAct(g, 0, s2); g = resolveAll(g);
  assert.equal(g.players[0].runesInPlay.length, 1, '[A] paid by recycling a rune');
  // own spells unaffected
  let h = game();
  put(h, 0, 'ven-045-166', 'base');
  setRunes(h, 0, { Calm: 1 });
  put(h, 0, 't-u2', 'base');
  assert.ok(canPlayNow(h, 0, handCard(h, 0, 'unl-031-219')));
});

test('ven-046 Nasus: Empowered — when he conquers, you score 1 point; Deflect 2', () => {
  let g = game();
  const n = put(g, 0, 'ven-046-166', 'base');
  g.objects[n].empowered = 1;
  assert.equal(kwVal(g, n, 'Deflect'), 2);
  setController(g, 0, 1);
  put(g, 1, 't-u1', 0);
  g = attack(g, 0, [n], 0);
  assert.equal(g.players[0].points, 2);
});

test('ven-047 Apprentice Mage: Predict 2 when it becomes Empowered; Empowered +1', () => {
  let g = game();
  setRunes(g, 0, { Mind: 2 });
  const u = put(g, 0, 'ven-047-166', 'base');
  g = activate(g, 0, u, EMPOWER);
  g = resolveAll(g);
  assert.ok(isAsking(g, 'chooseCards'), 'Predict 2');
  assert.equal(optionIds(g).length, 2);
  g = answer(g, 'chooseCards', ...optionIds(g));
  g = resolveAll(g);
  assert.equal(m(g, u), 4);
});

test('ven-050 Grumpy Rockbear: Empower [12] less [1] per rune; Empowered: Deflect + Shield 3', () => {
  let g = game();
  setRunes(g, 0, { Mind: 6 });
  const u = put(g, 0, 'ven-050-166', 'base');
  g = empower(g, 0, u);
  assert.equal(readyRunes(g, 0), 0);
  assert.ok(hasKw(g, u, 'Deflect')); assert.equal(kwVal(g, u, 'Shield'), 3);
});

test('ven-054 Questionable Tome: Empower — [T]; Disempower this, [1], [T]: Draw 1', () => {
  let g = game();
  setRunes(g, 0, { Mind: 1 });
  const t = put(g, 0, 'ven-054-166', 'base');
  assert.equal(abilities(g, 0, t).filter(i => i !== EMPOWER).length, 0, 'not Empowered yet');
  g = empower(g, 0, t);
  assert.equal(g.objects[t].exhausted, true);
  g.objects[t].exhausted = false;
  const [idx] = abilities(g, 0, t).filter(i => i !== EMPOWER);
  const h0 = hand(g, 0).length;
  g = activate(g, 0, t, idx); g = resolveAll(g);
  assert.equal(hand(g, 0).length, h0 + 1);
  assert.equal(emp(g, t), 0);
});

test('ven-055 Applied Researchers: Empowered — your spells cost [1][A] less, to a minimum of [1]', () => {
  let g = game();
  setRunes(g, 0, { Mind: 2 });
  const r = put(g, 0, 'ven-055-166', 'base');
  const s = handCard(g, 0, 'sfd-087-221');           // Premonition [2][B][B][B]
  assert.equal(canPlayNow(g, 0, s), false);
  g.objects[r].empowered = 1; g.ex.dirty = true;
  assert.ok(canPlayNow(g, 0, s), '[1][B][B]');
  setRunes(g, 0, {});
  put(g, 0, 't-u2', 'base');
  assert.equal(canPlayNow(g, 0, handCard(g, 0, 'unl-031-219')), false, 'minimum [1]');
});

test('ven-057 Covert Informant: Empowered — draw 1 when it moves', () => {
  for (const e of [0, 1]) {
    let g = game();
    const u = put(g, 0, 'ven-057-166', 'base');
    g.objects[u].empowered = e;
    const h0 = hand(g, 0).length;
    g = act(g, { type: 'move', player: 0, units: [u], to: 1 });
    g = resolveCombat(g, 0);
    assert.equal(hand(g, 0).length, h0 + e);
  }
});

test('ven-059 Shock Blast: [2] less if you control something Empowered; deal 4 to a unit at a battlefield', () => {
  let g = game();
  setRunes(g, 0, { Mind: 1 });
  const e = put(g, 1, 't-u4', 0);
  const s = handCard(g, 0, 'ven-059-166');
  assert.equal(canPlayNow(g, 0, s), false);
  const mine = put(g, 0, 't-u1', 'base');
  g.objects[mine].empowered = 1;
  assert.ok(canPlayNow(g, 0, s));
  g = playAct(g, 0, s);
  g = resolveAll(g);
  assert.equal(zoneOf(g, e), 'trash');
  assert.ok(hasKw(g, s, 'Action'));
});

test('ven-062 Hextech Formula: enters exhausted; [T]: empower another gear', () => {
  let g = game();
  setRunes(g, 0, { Mind: 2 });
  const hf = handCard(g, 0, 'ven-062-166');
  const other = put(g, 1, 'ven-018-166', 'base');
  g = playAct(g, 0, hf, 'base'); g = resolveAll(g);
  assert.equal(g.objects[hf].exhausted, true);
  assert.equal(abilities(g, 0, hf).length, 0);
  g.objects[hf].exhausted = false;
  const [idx] = abilities(g, 0, hf);
  g = activate(g, 0, hf, idx); g = resolveAll(g);
  assert.equal(emp(g, other), 1);
  assert.equal(emp(g, hf), 0);
});

test('ven-064 Plaza Guardian: [1] less for each gear you control; Deflect', () => {
  let g = game();
  setRunes(g, 0, { Mind: 8 });
  const pg = handCard(g, 0, 'ven-064-166');
  assert.equal(canPlayNow(g, 0, pg), false);
  put(g, 0, 'ven-018-166', 'base'); put(g, 0, 'ven-054-166', 'base'); put(g, 1, 'ven-054-166', 'base');
  assert.ok(canPlayNow(g, 0, pg));
  g = playAct(g, 0, pg, 'base'); g = resolveAll(g);
  assert.equal(readyRunes(g, 0), 0);
  assert.ok(hasKw(g, pg, 'Deflect'));
});

test("ven-069 Mel: draw 1 when played; Empowered — your spells can't be countered", () => {
  let g = game();
  setRunes(g, 0, { Mind: 6 });
  const mel = handCard(g, 0, 'ven-069-166');
  const h0 = hand(g, 0).length;
  g = playAct(g, 0, mel, 'base'); g = resolveAll(g);
  assert.equal(hand(g, 0).length, h0 - 1 + 1);
  g.objects[mel].empowered = 1;
  const s = handCard(g, 0, 'sfd-087-221');
  g = playAct(g, 0, s);
  const item = g.chain[g.chain.length - 1];
  assert.equal(makeCtx(g, g.players[1].legend, 1).counter(item.id), false);
  g.objects[mel].empowered = 0;
  assert.equal(makeCtx(g, g.players[1].legend, 1).counter(item.id), true);
});

test('ven-069 Mel: Empowered — -[S] from your spells that choose a unit gives an additional -1', () => {
  let g = game();
  setRunes(g, 0, { Mind: 3 });
  const mel = put(g, 0, 'ven-069-166', 'base');
  g.objects[mel].empowered = 1;
  const e = put(g, 1, 't-u5', 0);
  g = playAct(g, 0, handCard(g, 0, 'unl-063-219'));   // Eclipse -4
  g = answer(g, 'chooseTargets', e);
  g = settle(g);
  assert.equal(m(g, e), 0);
});

test('ven-070 Brutal Hunter: Empowered +2 and Ganking', () => {
  const g = game();
  const u = put(g, 0, 'ven-070-166', 'base');
  g.objects[u].empowered = 1;
  assert.equal(m(g, u), 6); assert.ok(hasKw(g, u, 'Ganking'));
});

test('ven-072 Guttural Roar: +2, or +4 if the unit is Empowered', () => {
  for (const e of [0, 1]) {
    let g = game();
    setRunes(g, 0, { Body: 2 });
    const u = put(g, 0, 't-u1', 'base');
    g.objects[u].empowered = e;
    g = playAct(g, 0, handCard(g, 0, 'ven-072-166'));
    g = resolveAll(g);
    assert.equal(m(g, u), e ? 5 : 3);
  }
});

test('ven-074 Legion Marauder: Empower — [1] or [C]; Empowered +1', () => {
  let g = game();
  setRunes(g, 0, { Fury: 1 });
  const u = put(g, 0, 'ven-074-166', 'base');
  assert.deepEqual(abilities(g, 0, u), [EMPOWER], 'only the [1] option with a non-Body rune');
  setRunes(g, 0, { Body: 1 });
  const opts = abilities(g, 0, u);
  assert.equal(opts.length, 2);
  const cIdx = opts.find(i => i !== EMPOWER)!;
  g = activate(g, 0, u, cIdx); g = resolveAll(g);
  assert.equal(emp(g, u), 1);
  assert.equal(g.players[0].runesInPlay.length, 0, '[C] paid by recycling the Body rune');
  assert.equal(m(g, u), 3);
  assert.equal(abilities(g, 0, u).length, 0);
});

test('ven-077 Tools of Empire: [T]: +2 this turn, +4 if this is Empowered', () => {
  for (const e of [0, 1]) {
    let g = game();
    const t = put(g, 0, 'ven-077-166', 'base');
    g.objects[t].empowered = e;
    const u = put(g, 0, 't-u1', 'base');
    const [idx] = abilities(g, 0, t).filter(i => i !== EMPOWER);
    g = activate(g, 0, t, idx);
    if (isAsking(g, 'chooseTargets')) g = answer(g, 'chooseTargets', u);
    g = resolveAll(g);
    assert.equal(m(g, u), e ? 5 : 3);
  }
});

test('ven-078 Baccai Witherclaw: Empowered +2; Empowered Deathknell channels 2 runes exhausted', () => {
  let g = game();
  const w = put(g, 0, 'ven-078-166', 'base');
  g.objects[w].empowered = 1; g.ex.dirty = true;
  assert.equal(m(g, w), 6);
  setRunes(g, 0, { Order: 2 });
  const r0 = g.players[0].runesInPlay.length;
  const k = put(g, 1, 't-u5', 'base');
  void k;
  g.objects[w].damage = 10;
  g = act(g, { type: 'endTurn', player: 0 });
  g = resolveAll(g);
  assert.equal(zoneOf(g, w), 'trash');
  assert.ok(g.players[0].runesInPlay.length >= r0 + 2, 'channelled 2');
  // not Empowered: nothing
  let h = game();
  const w2 = put(h, 0, 'ven-078-166', 'base');
  const r1 = h.players[0].runesInPlay.length;
  h.objects[w2].damage = 10;
  h = act(h, { type: 'endTurn', player: 0 });
  h = resolveAll(h);
  assert.equal(zoneOf(h, w2), 'trash');
  assert.equal(h.players[0].runesInPlay.length, r1);
});

test('ven-079 Dame the Despoiler: Empowered — on attack, Might rises to the chosen unit\'s, then +1', () => {
  let g = game();
  const d = put(g, 0, 'ven-079-166', 'base');
  g.objects[d].empowered = 1;
  setController(g, 0, 1);
  const e = put(g, 1, 't-u5', 0), e2 = put(g, 1, 'ven-043-166', 0);
  g.objects[e2].empowered = 1;          // Steel Paws 7 (Deflect: choosing it costs [A])
  setRunes(g, 0, { Body: 1 });
  g = act(g, { type: 'move', player: 0, units: [d], to: 0 });
  g = resolveCombat(g, 0);
  assert.ok(optionIds(g).includes(d) && optionIds(g).includes(e));
  g = answer(g, 'chooseTargets', e2);
  g = answer(g, 'optional', 'yes');      // CR 405.2: a trigger's Deflect cost may be declined (RJ#5262)
  assert.equal(g.players[0].runesInPlay.length, 0, 'Deflect paid');
  g = resolveChain(g);
  assert.equal(m(g, d), 8);
});

test('ven-081 Onslaught: +6 this turn; Flow [4]', () => {
  let g = game();
  setRunes(g, 0, { Body: 4 });
  const u = put(g, 0, 't-u1', 'base');
  g = playAct(g, 0, handCard(g, 0, 'ven-081-166'));
  g = resolveAll(g);
  assert.equal(m(g, u), 7);
  const s = put(g, 0, 'ven-081-166', 'trash');
  setRunes(g, 0, { Body: 4 });
  assert.ok(canPlayNow(g, 0, s));
});

test('ven-082 Profiteer: may disempower something you control to empower a legend, unit, or gear', () => {
  let g = game();
  setRunes(g, 0, { Body: 4 });
  const mine = put(g, 0, 't-u1', 'base');
  g.objects[mine].empowered = 1;
  const l = g.players[0].legend;
  const p = handCard(g, 0, 'ven-082-166');
  g = playAct(g, 0, p, 'base'); g = resolveAll(g);
  g = answer(g, 'optional', 'yes');
  g = resolveAll(g);
  assert.ok(optionIds(g).includes(l));
  g = answer(g, 'chooseTargets', l);
  // RULINGS sweep / CR 383.3.b: the disempower is paid as the trigger goes on the chain, before it resolves
  assert.equal(emp(g, mine), 0, 'disempowered as the cost');
  assert.equal(emp(g, l), 0, 'not yet empowered');
  g = resolveAll(g);
  assert.equal(emp(g, mine), 0);
  assert.equal(emp(g, l), 1);
  // nothing Empowered: no question
  let h = game();
  setRunes(h, 0, { Body: 4 });
  const p2 = handCard(h, 0, 'ven-082-166');
  h = playAct(h, 0, p2, 'base'); h = resolveAll(h);
  assert.equal(isAsking(h), false);
});

test("ven-084 Ambessa (Body): Empowered — +3 and can't be dealt damage unless in combat", () => {
  let g = game();
  const a = put(g, 0, 'ven-084-166', 'base');
  makeCtx(g, a, 1).deal(2, a);
  assert.equal(g.objects[a].damage, 2);
  g.objects[a].damage = 0;
  g.objects[a].empowered = 1; g.ex.dirty = true;
  assert.equal(m(g, a), 7);
  makeCtx(g, a, 1).deal(2, a);
  assert.equal(g.objects[a].damage, 0);
  setController(g, 0, 1);
  put(g, 1, 't-u3', 0);
  g = attack(g, 0, [a], 0);
  assert.ok(g.log.some(e => /deals 3 to Ambessa/.test(e.text)), 'combat damage is dealt while in combat');
});

test('ven-086 Gangplank: Empowered — a spell that chooses him and would stun him gives +3 instead', () => {
  let g = game();
  setRunes(g, 0, { Calm: 1 });
  const gp = put(g, 0, 'ven-086-166', 'base');
  put(g, 0, 't-u1', 'base');
  g.objects[gp].empowered = 1;
  const kb = handCard(g, 0, 'rad-028-167');           // Ki Burst
  g = playAct(g, 0, kb);
  if (isAsking(g, 'chooseTargets')) g = answer(g, 'chooseTargets', gp);
  if (isAsking(g, 'chooseCards')) g = answer(g, 'chooseCards', optionIds(g).find(x => x !== gp)!);
  g = resolveAll(g);
  assert.equal(!!g.objects[gp].stunned, false);
  assert.equal(m(g, gp), 9);
  // not Empowered: stunned normally
  let h = game();
  setRunes(h, 0, { Calm: 1 });
  const gp2 = put(h, 0, 'ven-086-166', 'base');
  const other = put(h, 0, 't-u1', 'base');
  h = playAct(h, 0, handCard(h, 0, 'rad-028-167'));
  if (isAsking(h, 'chooseTargets')) h = answer(h, 'chooseTargets', gp2);
  if (isAsking(h, 'chooseCards')) h = answer(h, 'chooseCards', other);
  h = resolveAll(h);
  assert.equal(h.objects[gp2].stunned, true);
});

// RULINGS: Vendetta Rules FAQ (Gangplank, Naval) — the -[M] given by a spell that chooses him is replaced by +3 [M] this turn
test('ven-086 Gangplank: Empowered — -[M] from a spell that chooses him becomes +3', () => {
  let g = game();
  setRunes(g, 0, { Mind: 3 });
  const gp = put(g, 0, 'ven-086-166', 'base');
  g.objects[gp].empowered = 1;
  g = playAct(g, 0, handCard(g, 0, 'unl-063-219'));   // Eclipse -4 (only unit: auto-chosen)
  g = settle(g);
  assert.equal(m(g, gp), 9);
});

test('ven-092 Renekton: [1]: +1 this turn; empowered when his Might becomes 10+; Empowered: Deflect + Ganking', () => {
  let g = game();
  setRunes(g, 0, { Body: 2 });
  const r = put(g, 0, 'ven-092-166', 'base');
  makeCtx(g, r, 0).giveMight(r, 4);
  g.triggerQueue.length = 0;
  assert.equal(m(g, r), 8);
  const [idx] = abilities(g, 0, r);
  g = activate(g, 0, r, idx); g = resolveAll(g);
  assert.equal(m(g, r), 9); assert.equal(emp(g, r), 0);
  g = activate(g, 0, r, idx); g = resolveAll(g);
  assert.equal(m(g, r), 10); assert.equal(emp(g, r), 1);
  assert.ok(hasKw(g, r, 'Deflect') && hasKw(g, r, 'Ganking'));
});

test('ven-093 Kinkou Lifeblade: Empower [2]; Empowered +1 and Ganking', () => {
  let g = game();
  setRunes(g, 0, { Chaos: 2 });
  const u = put(g, 0, 'ven-093-166', 'base');
  g = empower(g, 0, u);
  assert.equal(m(g, u), 5); assert.ok(hasKw(g, u, 'Ganking'));
});

test('ven-096 Shadowblade Lurker: [2] less for each card with its name in your trash', () => {
  let g = game();
  setRunes(g, 0, { Chaos: 1 });
  const s = handCard(g, 0, 'ven-096-166');
  put(g, 0, 'ven-096-166', 'trash');
  assert.equal(canPlayNow(g, 0, s), false);
  put(g, 0, 'ven-096-166', 'trash');
  put(g, 1, 'ven-096-166', 'trash');                 // opponent's trash doesn't count
  assert.ok(canPlayNow(g, 0, s));
});

test('ven-099 Tornado Warrior: played from face down, may empower something here until end of turn', () => {
  let g = game();
  setController(g, 0, 0);
  const mine = put(g, 0, 'ven-043-166', 0);           // Steel Paws
  const tw = putFacedown(g, 0, 'ven-099-166', 0);
  g = playAct(g, 0, tw);
  g = resolveAll(g);
  g = answer(g, 'optional', 'yes');
  g = answer(g, 'chooseTargets', mine);
  g = resolveAll(g);
  assert.equal(emp(g, mine), 1);
  assert.equal(m(g, mine), 7);
  g = act(g, { type: 'endTurn', player: 0 });
  g = resolveAll(g);
  assert.equal(emp(g, mine), 0);
  assert.ok(hasKw(g, tw, 'Hidden'));
});

test('ven-099 Tornado Warrior: played from hand, no trigger', () => {
  let g = game();
  setRunes(g, 0, { Chaos: 3 });
  put(g, 0, 't-u1', 'base');
  const tw = handCard(g, 0, 'ven-099-166');
  g = playAct(g, 0, tw, 'base'); g = resolveAll(g);
  assert.equal(isAsking(g), false);
});

test('ven-104 Tail-Cloaked Matriarch: when Empowered, may play a cheap unit from your trash to base for free', () => {
  let g = game();
  setRunes(g, 0, { Chaos: 3 });
  const tc = put(g, 0, 'ven-104-166', 'base');
  const ok = put(g, 0, 't-u3', 'trash'), big = put(g, 0, 't-u4', 'trash'), opp = put(g, 1, 't-u1', 'trash');
  g = activate(g, 0, tc, EMPOWER);
  g = resolveAll(g);
  g = answer(g, 'optional', 'yes');                   // the only eligible unit is chosen automatically
  assert.equal(isAsking(g, 'chooseTargets'), false);
  g = resolveAll(g);
  assert.equal(zoneOf(g, big), 'trash'); assert.equal(zoneOf(g, opp), 'trash');
  assert.equal(zoneOf(g, ok), 'base');
  assert.equal(g.objects[ok].controller, 0);
});

test('ven-110 Mel (Chaos): Empower — Discard a spell; when Empowered, banish an enemy unit at a battlefield with 3 or less', () => {
  let g = game();
  g.players[0].hand = [];
  const mel = put(g, 0, 'ven-110-166', 'base');
  handCard(g, 0, 't-u1');
  assert.equal(abilities(g, 0, mel).includes(EMPOWER), false, 'no spell to discard');
  const sp = handCard(g, 0, 'sfd-087-221');
  const e = put(g, 1, 't-u3', 0), big = put(g, 1, 't-u4', 0);
  g = activate(g, 0, mel, EMPOWER);
  g = resolveAll(g);
  assert.equal(zoneOf(g, sp), 'trash');
  assert.equal(zoneOf(g, e), 'banishment');
  assert.equal(zoneOf(g, big), 'battlefield');
});

test('ven-119 Keeper of Law: [2][C] less if you control a battlefield with exactly two units', () => {
  let g = game();
  setRunes(g, 0, { Order: 3 });
  const k = handCard(g, 0, 'ven-119-166');
  assert.equal(canPlayNow(g, 0, k), false);
  setController(g, 0, 0);
  put(g, 0, 't-u1', 0); put(g, 0, 't-u1', 0);
  assert.ok(canPlayNow(g, 0, k));
  put(g, 0, 't-u1', 0);
  assert.equal(canPlayNow(g, 0, k), false, 'three units');
});

test('ven-120 Masa: pay [C] to stun an enemy unit at a battlefield', () => {
  let g = game();
  setRunes(g, 0, { Order: 5 });
  const e = put(g, 1, 't-u3', 0);
  const ms = handCard(g, 0, 'ven-120-166');
  g = playAct(g, 0, ms, 'base');
  g = answer(g, 'optional', 'yes');
  g = resolveAll(g);
  assert.equal(g.objects[e].stunned, true);
  let h = game();
  setRunes(h, 0, { Order: 5 });
  const e2 = put(h, 1, 't-u3', 0);
  h = playAct(h, 0, handCard(h, 0, 'ven-120-166'), 'base');
  h = answer(h, 'optional', 'no');
  h = resolveAll(h);
  assert.equal(!!h.objects[e2].stunned, false);
});

test('ven-122 Solari Sunhawk: Empowered +1 and Deflect 2', () => {
  let g = game();
  setRunes(g, 0, { Order: 2 });
  const u = put(g, 0, 'ven-122-166', 'base');
  g = empower(g, 0, u);
  assert.equal(m(g, u), 4); assert.equal(kwVal(g, u, 'Deflect'), 2);
});

test('ven-124 Escaped Grayback: Empower — Kill a friendly unit; Empowered +2', () => {
  let g = game();
  const u = put(g, 0, 'ven-124-166', 'base');
  assert.equal(abilities(g, 0, u).includes(EMPOWER), false, 'no other friendly unit');
  const f = put(g, 0, 't-u1', 'base');
  g = activate(g, 0, u, EMPOWER);
  g = resolveAll(g);
  assert.equal(zoneOf(g, f), 'trash');
  assert.equal(m(g, u), 5);
});

test('ven-127 Lacerate: disempower an Empowered unit, then kill it if it has 3 or less', () => {
  let g = game();
  setRunes(g, 0, { Order: 3 });
  const a = put(g, 1, 'ven-043-166', 0);              // Steel Paws 0 (+7 Empowered)
  g.objects[a].empowered = 1;
  g = playAct(g, 0, handCard(g, 0, 'ven-127-166'));
  if (isAsking(g, 'chooseTargets')) g = answer(g, 'chooseTargets', a);
  g = resolveAll(g);
  assert.equal(zoneOf(g, a), 'trash', 'disempowered to 0, then killed');
  let h = game();
  setRunes(h, 0, { Order: 3 });
  const b = put(h, 1, 't-u4', 0);
  h.objects[b].empowered = 1;
  h = playAct(h, 0, handCard(h, 0, 'ven-127-166'));
  if (isAsking(h, 'chooseTargets')) h = answer(h, 'chooseTargets', b);
  h = resolveAll(h);
  assert.equal(zoneOf(h, b), 'battlefield');
  assert.equal(emp(h, b), 0);
});

test('ven-130 Aurok General: Empowered — your Empowered units have +2 (including itself)', () => {
  const g = game();
  const ag = put(g, 0, 'ven-130-166', 'base');
  const a = put(g, 0, 't-u1', 'base'), b = put(g, 0, 't-u1', 'base'), e = put(g, 1, 't-u1', 0);
  g.objects[a].empowered = 1; g.objects[e].empowered = 1;
  g.ex.dirty = true;
  assert.equal(m(g, a), 1);
  g.objects[ag].empowered = 1; g.ex.dirty = true;
  assert.equal(m(g, ag), 7); assert.equal(m(g, a), 3); assert.equal(m(g, b), 1); assert.equal(m(g, e), 1);
});

test('ven-133 Glowstone: Disempower, [T]: a chosen player gains control of it and recalls it; end of your turn: kill it and deal 5 to your units', () => {
  let g = game();
  const gs = put(g, 0, 'ven-133-166', 'base');
  g.objects[gs].empowered = 1;
  const mine = put(g, 0, 't-u5', 'base'), theirs = put(g, 1, 't-u5', 0);
  const [idx] = abilities(g, 0, gs).filter(i => i !== EMPOWER);
  g = activate(g, 0, gs, idx);
  g = resolveAll(g);
  g = answer(g, 'chooseOpponent', '1');
  g = resolveAll(g);
  assert.equal(g.objects[gs].controller, 1);
  assert.equal(zoneOf(g, gs), 'base');
  g = nextTurn(g);                                    // P0's end of turn: not P1's turn
  assert.equal(zoneOf(g, gs), 'base');
  g = act(g, { type: 'endTurn', player: 1 });
  g = resolveAll(g);
  assert.equal(zoneOf(g, gs), 'trash');
  assert.equal(zoneOf(g, theirs), 'trash');
  assert.equal(zoneOf(g, mine), 'base');
});

test('ven-134 Kayle: can be Empowered three times; +2 per Empowered; at three: Deflect 3 + Ganking', () => {
  let g = game();
  setRunes(g, 0, { Order: 9 });
  const k = put(g, 0, 'ven-134-166', 'base');
  g = empower(g, 0, k);
  assert.equal(m(g, k), 5); assert.equal(hasKw(g, k, 'Ganking'), false);
  g = empower(g, 0, k);
  g = empower(g, 0, k);
  assert.equal(emp(g, k), 3);
  assert.equal(m(g, k), 9);
  assert.equal(kwVal(g, k, 'Deflect'), 3); assert.ok(hasKw(g, k, 'Ganking'));
  assert.equal(abilities(g, 0, k).includes(EMPOWER), false);
});

test('ven-134 Kayle: disempowering her removes one Empowered status', () => {
  const g = game();
  const k = put(g, 0, 'ven-134-166', 'base');
  g.objects[k].empowered = 3;
  makeCtx(g, k, 0).disempower(k);
  assert.equal(emp(g, k), 2);
});

test('ven-136 Ambessa (Order): Empowered — Assault 2; on attack kill an enemy unit here with less Might', () => {
  let g = game();
  const a = put(g, 0, 'ven-136-166', 'base');
  g.objects[a].empowered = 1;
  setController(g, 0, 1);
  const s = put(g, 1, 't-u4', 0), b = put(g, 1, 'ven-043-166', 0);
  g.objects[b].empowered = 1;                         // 7 Might: not killable
  assert.equal(kwVal(g, a, 'Assault'), 2);
  g = act(g, { type: 'move', player: 0, units: [a], to: 0 });
  g = resolveCombat(g, 0);
  if (isAsking(g, 'chooseTargets')) { assert.ok(!optionIds(g).includes(b)); g = answer(g, 'chooseTargets', s); }
  g = resolveCombat(g, 0);
  assert.equal(zoneOf(g, s), 'trash');
});

test('ven-139 Rogue Assassin: [Action] [T] on your turn: move a friendly unit in a showdown to base, ready it if Empowered', () => {
  let g = game();
  const l = legend(g, 0, 'ven-139-166');
  g.objects[l].empowered = 1;
  const u = put(g, 0, 't-u2', 'base');
  g = act(g, { type: 'move', player: 0, units: [u], to: 1 });   // empty battlefield: showdown
  assert.equal(g.pending?.kind, 'showdownAction');
  const idx = abilities(g, 0, l).filter(i => i !== EMPOWER);
  assert.equal(idx.length, 1);
  g = activate(g, 0, l, idx[0]);
  g = resolveAll(g);
  assert.equal(zoneOf(g, u), 'base');
  assert.equal(g.objects[u].exhausted, false);
});

test('ven-143 Master of Shadows: empowered when you banish a card you own; [Action] Disempower, [T]: discard 1, draw 1', () => {
  let g = game();
  const l = legend(g, 0, 'ven-143-166');
  setRunes(g, 0, { Body: 4 });
  put(g, 0, 't-u1', 'base');
  const s = put(g, 0, 'ven-081-166', 'trash');       // Onslaught via Flow: banished after resolving
  g = playAct(g, 0, s);
  g = resolveAll(g);
  assert.equal(zoneOf(g, s), 'banishment');
  assert.equal(emp(g, l), 1);
  const [idx] = abilities(g, 0, l);
  const h0 = hand(g, 0).length;
  g = activate(g, 0, l, idx);
  g = resolveAll(g);
  g = answer(g, 'chooseCards', hand(g, 0)[0]);
  g = resolveAll(g);
  assert.equal(hand(g, 0).length, h0);
  assert.equal(emp(g, l), 0);
});

test('ven-149 Defender of Tomorrow: [1], [T]: ready a gear; Empowered: [1], [T]: ready 2 gear', () => {
  let g = game();
  const l = legend(g, 0, 'ven-149-166');
  setRunes(g, 0, { Mind: 1 });
  const g1 = put(g, 0, 'ven-054-166', 'base', { ready: false }), g2 = put(g, 0, 'ven-018-166', 'base', { ready: false });
  let idx = abilities(g, 0, l).filter(i => i !== EMPOWER);
  assert.equal(idx.length, 1);
  g = activate(g, 0, l, idx[0]);
  g = answer(g, 'chooseTargets', g1);
  g = resolveAll(g);
  assert.equal(g.objects[g1].exhausted, false);
  g.objects[l].exhausted = false; g.objects[g1].exhausted = true; g.objects[l].empowered = 1;
  setRunes(g, 0, { Mind: 1 });
  idx = abilities(g, 0, l).filter(i => i !== EMPOWER);
  assert.equal(idx.length, 2);
  g = activate(g, 0, l, idx[1]);
  g = answer(g, 'chooseTargets', g1, g2);
  g = resolveAll(g);
  assert.equal(g.objects[g1].exhausted, false); assert.equal(g.objects[g2].exhausted, false);
});

test("ven-151 Soul's Reflection: empowered when you empower something else; Disempower, [T]: -2 to a unit at a battlefield", () => {
  let g = game();
  const l = legend(g, 0, 'ven-151-166');
  setRunes(g, 0, { Mind: 2 });
  const u = put(g, 0, 'ven-047-166', 'base');         // Apprentice Mage, Empower [2]
  g = activate(g, 0, u, EMPOWER);
  g = settle(g);
  assert.equal(emp(g, u), 1);
  assert.equal(emp(g, l), 1);
  const e = put(g, 1, 't-u3', 0);
  const [idx] = abilities(g, 0, l);
  g = activate(g, 0, l, idx);
  g = resolveAll(g);
  assert.equal(m(g, e), 1);
  assert.equal(emp(g, l), 0);
});

test('ven-151 Soul\'s Reflection: an opponent empowering their own unit does not trigger it', () => {
  let g = game();
  const l = legend(g, 0, 'ven-151-166');
  const u = put(g, 1, 'ven-047-166', 'base');
  g = nextTurn(g);
  setRunes(g, 1, { Mind: 2 });
  g = activate(g, 1, u, EMPOWER);
  g = settle(g);
  assert.equal(emp(g, u), 1);
  assert.equal(emp(g, l), 0);
});

test('ven-153 Matriarch of War: empowered when you empower something else; Disempower, [A], [T]: ready a unit', () => {
  let g = game();
  const l = legend(g, 0, 'ven-153-166');
  setRunes(g, 0, { Order: 3 });
  const u = put(g, 0, 'ven-122-166', 'base', { ready: false });   // Sunhawk, Empower [2]
  g = activate(g, 0, u, EMPOWER);
  g = resolveAll(g);
  assert.equal(emp(g, l), 1);
  const [idx] = abilities(g, 0, l);
  g = activate(g, 0, l, idx);
  if (isAsking(g, 'chooseTargets')) g = answer(g, 'chooseTargets', u);
  g = resolveAll(g);
  assert.equal(g.objects[u].exhausted, false);
  assert.equal(emp(g, l), 0);
});

test('ven-155 Heart of the Tempest: empowered when you play a card from anywhere but hand; [Action] Disempower, [T]: Assault 2', () => {
  let g = game();
  const l = legend(g, 0, 'ven-155-166');
  setRunes(g, 0, { Body: 8 });
  const u = put(g, 0, 't-u1', 'base');
  g = playAct(g, 0, handCard(g, 0, 'ven-081-166'));  // from hand: nothing
  g = resolveAll(g);
  assert.equal(emp(g, l), 0);
  g = playAct(g, 0, put(g, 0, 'ven-081-166', 'trash'));  // Flow from trash
  g = resolveAll(g);
  assert.equal(emp(g, l), 1);
  const [idx] = abilities(g, 0, l);
  g = activate(g, 0, l, idx);
  g = resolveAll(g);
  assert.equal(kwVal(g, u, 'Assault'), 2);
  assert.equal(emp(g, l), 0);
});

void xp; void chars;

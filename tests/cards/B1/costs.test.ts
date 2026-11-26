// B1: Origins / Radiance / Spiritforged cards — additional costs and self cost modifiers.
import { test } from 'node:test';
import {
  assert, game, setRunes, readyRunes, put, handCard, playAct, answer, isAsking, resolveAll, zoneOf, canPlayNow, setController,
  tryAct, hand, legend, m, attack, optionIds, hasKw, kwVal, nextTurn,
} from './_util.ts';

test('ogn-002 Brazen Buccaneer: optional discard reduces the cost by [2]', () => {
  let g = game();
  setRunes(g, 0, { Fury: 4 });
  const other = handCard(g, 0, 't-u1');
  const b = handCard(g, 0, 'ogn-002-298');
  assert.ok(canPlayNow(g, 0, b), 'playable with 4 runes thanks to the optional discount');
  g = playAct(g, 0, b, 'base');
  // CR 355.16 / F-3c: only affordable with the discount, so the optional cost is required (not offered as a choice)
  g = answer(g, 'chooseCards', other);
  g = resolveAll(g);
  assert.equal(zoneOf(g, b), 'base');
  assert.equal(zoneOf(g, other), 'trash');
  assert.equal(readyRunes(g, 0), 0);
});

test('ogn-002 Brazen Buccaneer: declining the discard costs the full [6]', () => {
  let g = game();
  setRunes(g, 0, { Fury: 6 });
  const other = handCard(g, 0, 't-u1');
  const b = handCard(g, 0, 'ogn-002-298');
  g = playAct(g, 0, b, 'base');
  g = answer(g, 'optional', 'no');
  g = resolveAll(g);
  assert.equal(zoneOf(g, b), 'base');
  assert.equal(zoneOf(g, other), 'hand');
  assert.equal(readyRunes(g, 0), 0);
  // with only 4 runes, declining makes the play impossible: rolled back
  let h = game();
  setRunes(h, 0, { Fury: 4 });
  handCard(h, 0, 't-u1');
  const b2 = handCard(h, 0, 'ogn-002-298');
  h = playAct(h, 0, b2, 'base');
  // CR 355.16 / F-3c: declining would make the play impossible, so "no" isn't offered — the discard is required
  assert.notEqual(h.pending?.kind, 'optional');
  void tryAct;
});

test('ogn-012 Noxus Hopeful: Legion — costs [2] less after another card was played', () => {
  let g = game();
  setRunes(g, 0, { Fury: 3 });
  const n = handCard(g, 0, 'ogn-012-298');
  assert.equal(canPlayNow(g, 0, n), false, '4 cost without Legion');
  const u = handCard(g, 0, 't-u1');
  g = playAct(g, 0, u, 'base');
  g = resolveAll(g);
  assert.ok(canPlayNow(g, 0, n));
  g = playAct(g, 0, n, 'base');
  g = resolveAll(g);
  assert.equal(zoneOf(g, n), 'base');
  assert.equal(readyRunes(g, 0), 0);
});

test('ogn-044 Clockwork Keeper: pay [C] to draw 1; decline draws nothing', () => {
  for (const pay of [true, false]) {
    let g = game();
    setRunes(g, 0, { Calm: 3 });
    const k = handCard(g, 0, 'ogn-044-298');
    const h0 = hand(g, 0).length;
    g = playAct(g, 0, k, 'base');
    g = answer(g, 'optional', pay ? 'yes' : 'no');
    g = resolveAll(g);
    assert.equal(zoneOf(g, k), 'base');
    assert.equal(hand(g, 0).length, h0 - 1 + (pay ? 1 : 0));
    assert.equal(g.players[0].runesInPlay.length, pay ? 2 : 3, '[C] is paid by recycling a Calm rune');
  }
});

test('ogn-044 Clockwork Keeper: the additional cost is not offered when [C] is unaffordable', () => {
  let g = game();
  setRunes(g, 0, { Fury: 3 });
  const k = handCard(g, 0, 'ogn-044-298');
  g = playAct(g, 0, k, 'base');
  assert.equal(isAsking(g, 'optional'), false);
  g = resolveAll(g);
  assert.equal(zoneOf(g, k), 'base');
});

test('ogn-047 Find Your Center: [2] less when an opponent is near victory; draws and channels exhausted', () => {
  let g = game();
  setRunes(g, 0, { Calm: 1 });
  const s = handCard(g, 0, 'ogn-047-298');
  assert.equal(canPlayNow(g, 0, s), false);
  g.players[1].points = g.victoryScore - 3;
  assert.ok(canPlayNow(g, 0, s));
  const h0 = hand(g, 0).length, r0 = g.players[0].runesInPlay.length;
  g = playAct(g, 0, s);
  g = resolveAll(g);
  assert.equal(hand(g, 0).length, h0 - 1 + 1);
  assert.equal(g.players[0].runesInPlay.length, r0 + 1);
  const newRune = g.players[0].runesInPlay[g.players[0].runesInPlay.length - 1];
  assert.equal(g.objects[newRune].exhausted, true);
  assert.ok(hasKw(g, s, 'Action'));
});

test('ogn-048 Meditation: exhausting a friendly unit draws 2, otherwise 1', () => {
  for (const pay of [true, false]) {
    let g = game();
    setRunes(g, 0, { Calm: 2 });
    const u = put(g, 0, 't-u2', 'base');
    const s = handCard(g, 0, 'ogn-048-298');
    const h0 = hand(g, 0).length;
    g = playAct(g, 0, s);
    g = answer(g, 'optional', pay ? 'yes' : 'no');
    g = resolveAll(g);
    assert.equal(hand(g, 0).length, h0 - 1 + (pay ? 2 : 1));
    assert.equal(g.objects[u].exhausted, pay);
  }
});

test('ogn-048 Meditation: no ready friendly unit -> no offer, draws 1 (Reaction keyword)', () => {
  let g = game();
  setRunes(g, 0, { Calm: 2 });
  const s = handCard(g, 0, 'ogn-048-298');
  assert.ok(hasKw(g, s, 'Reaction'));
  const h0 = hand(g, 0).length;
  g = playAct(g, 0, s);
  assert.equal(isAsking(g, 'optional'), false);
  g = resolveAll(g);
  assert.equal(hand(g, 0).length, h0);
});

test('ogn-144 Spoils of War: [2] less if an enemy unit died this turn; draws 2', () => {
  let g = game();
  setRunes(g, 0, { Body: 3 });
  const s = handCard(g, 0, 'ogn-144-298');
  assert.equal(canPlayNow(g, 0, s), false);
  g.ex.counts['unitsDied:0'] = 1;     // a friendly death doesn't count
  assert.equal(canPlayNow(g, 0, s), false);
  g.ex.counts['unitsDied:1'] = 1;
  assert.ok(canPlayNow(g, 0, s));
  const h0 = hand(g, 0).length;
  g = playAct(g, 0, s);
  g = resolveAll(g);
  assert.equal(hand(g, 0).length, h0 - 1 + 2);
  setRunes(g, 0, { Body: 2 });
  assert.equal(canPlayNow(g, 0, handCard(g, 0, 'ogn-144-298')), true, '[2][O] after the discount');
});

test('ogn-195 Rhasa the Sunderer: [1] less per card in your trash', () => {
  let g = game();
  setRunes(g, 0, { Chaos: 4 });
  const r = handCard(g, 0, 'ogn-195-298');
  assert.equal(canPlayNow(g, 0, r), false);
  for (let i = 0; i < 6; i++) put(g, 0, 't-u1', 'trash');
  assert.ok(canPlayNow(g, 0, r));
  g = playAct(g, 0, r, 'base');
  g = resolveAll(g);
  assert.equal(zoneOf(g, r), 'base');
  assert.equal(readyRunes(g, 0), 0);
});

test('rad-028 Ki Burst: exhausting a friendly unit is mandatory; stuns a unit', () => {
  let g = game();
  setRunes(g, 0, { Calm: 1 });
  const s = handCard(g, 0, 'rad-028-167');
  const e = put(g, 1, 't-u3', 0);
  assert.equal(canPlayNow(g, 0, s), false, 'no friendly unit to exhaust');
  const u = put(g, 0, 't-u2', 'base');
  assert.ok(canPlayNow(g, 0, s));
  g = playAct(g, 0, s);
  if (isAsking(g, 'chooseTargets')) g = answer(g, 'chooseTargets', e);
  g = resolveAll(g);
  assert.equal(g.objects[e].stunned, true);
  assert.equal(g.objects[u].exhausted, true);
});

test('rad-029 Life from Stone: mandatory exhaust, draw 1 and channel 1 exhausted', () => {
  let g = game();
  setRunes(g, 0, { Calm: 1 });
  const u = put(g, 0, 't-u2', 'base');
  const u2 = put(g, 0, 't-u1', 'base');
  const s = handCard(g, 0, 'rad-029-167');
  const h0 = hand(g, 0).length, r0 = g.players[0].runesInPlay.length;
  g = playAct(g, 0, s);
  g = answer(g, 'chooseCards', u2);
  g = resolveAll(g);
  assert.equal(g.objects[u2].exhausted, true);
  assert.equal(g.objects[u].exhausted, false);
  assert.equal(hand(g, 0).length, h0);
  assert.equal(g.players[0].runesInPlay.length, r0 + 1);
});

test('rad-061 Ekko: must return a friendly unit to hand; has Ganking', () => {
  let g = game();
  setRunes(g, 0, { Mind: 3 });
  const e = handCard(g, 0, 'rad-061-167');
  assert.equal(canPlayNow(g, 0, e), false, 'no friendly unit to return');
  const u = put(g, 0, 't-u2', 'base');
  g = playAct(g, 0, e, 'base');
  g = resolveAll(g);
  assert.equal(zoneOf(g, e), 'base');
  assert.equal(zoneOf(g, u), 'hand');
  assert.ok(hasKw(g, e, 'Ganking'));
});

test('rad-075 Skystrike Squadron: returning a friendly gear reduces the cost by [2]; Deflect', () => {
  let g = game();
  setRunes(g, 0, { Body: 3 });
  const s = handCard(g, 0, 'rad-075-167');
  assert.equal(canPlayNow(g, 0, s), false);
  const gear = put(g, 0, 'unl-109-219', 'base');
  assert.ok(canPlayNow(g, 0, s));
  g = playAct(g, 0, s, 'base');
  // CR 355.16 / F-3c: only affordable with the discount, so the optional cost is required (not offered as a choice)
  g = resolveAll(g);
  assert.equal(zoneOf(g, s), 'base');
  assert.equal(zoneOf(g, gear), 'hand');
  assert.equal(kwVal(g, s, 'Deflect'), 1);
});

test('rad-080 Bloodscent Swarm: [2] less for each battlefield conquered this turn', () => {
  let g = game();
  setRunes(g, 0, { Body: 6 });
  const s = handCard(g, 0, 'rad-080-167');
  assert.equal(canPlayNow(g, 0, s), false);
  const a = put(g, 0, 't-u3', 'base');
  setController(g, 0, 1);
  put(g, 1, 't-u1', 0);
  g = attack(g, 0, [a], 0);
  assert.equal(g.battlefields[0].controller, 0);
  assert.ok(canPlayNow(g, 0, s));
  g = playAct(g, 0, s, 'base');
  g = resolveAll(g);
  assert.equal(zoneOf(g, s), 'base');
  assert.equal(readyRunes(g, 0), 0);
});

test('rad-122 Party Crasher: [1] less per exhausted unit you control; Tank', () => {
  let g = game();
  setRunes(g, 0, { Order: 8 });
  const s = handCard(g, 0, 'rad-122-167');
  assert.equal(canPlayNow(g, 0, s), false);
  put(g, 0, 't-u1', 'base', { ready: false });
  put(g, 1, 't-u1', 'base', { ready: false });    // enemy exhausted units don't count
  assert.ok(canPlayNow(g, 0, s));
  g = playAct(g, 0, s, 'base');
  g = resolveAll(g);
  assert.equal(readyRunes(g, 0), 0);
  assert.ok(hasKw(g, s, 'Tank'));
});

test('sfd-010 Void Drone: [2] less from anywhere other than hand (legality)', () => {
  const g = game();
  setRunes(g, 0, { Fury: 1 });
  const d = handCard(g, 0, 'sfd-010-221');
  assert.equal(canPlayNow(g, 0, d), false);
});

test('sfd-010 Void Drone: played by an effect from the deck it costs [1]', async () => {
  const { makeCtx } = await import('../../../src/engine/context.ts');
  const g = game();
  setRunes(g, 0, { Fury: 1 });
  const d = put(g, 0, 'sfd-010-221', 'deckTop');
  const ok = makeCtx(g, d, 0).play(d, { ignoreCost: false, destination: 'base' });
  assert.ok(ok);
  assert.equal(zoneOf(g, d), 'base');
});

test('sfd-012 Battering Ram: [1] less per card played this turn, to a minimum of [1]', () => {
  let g = game();
  setRunes(g, 0, { Fury: 6 });
  for (let i = 0; i < 5; i++) { const u = handCard(g, 0, 't-u1'); g = playAct(g, 0, u, 'base'); g = resolveAll(g); }
  assert.equal(readyRunes(g, 0), 1);
  const r = handCard(g, 0, 'sfd-012-221');
  assert.ok(canPlayNow(g, 0, r));
  g = playAct(g, 0, r, 'base');
  g = resolveAll(g);
  assert.equal(zoneOf(g, r), 'base');
  assert.equal(readyRunes(g, 0), 0, 'cost floored at [1], not [0]');
});

test('sfd-039 Royal Entourage: ready or exhaust a legend (choice of legend and of mode)', () => {
  let g = game();
  setRunes(g, 0, { Calm: 4 });
  const oppLegend = g.players[1].legend;
  const r = handCard(g, 0, 'sfd-039-221');
  g = playAct(g, 0, r, 'base');
  g = resolveAll(g);
  g = answer(g, 'chooseTargets', oppLegend);
  g = resolveAll(g);
  g = answer(g, 'chooseMode', 'exhaust');
  g = resolveAll(g);
  assert.equal(g.objects[oppLegend].exhausted, true);
});

test('sfd-044 Legion Quartermaster: must return a friendly gear', () => {
  let g = game();
  setRunes(g, 0, { Calm: 3 });
  const q = handCard(g, 0, 'sfd-044-221');
  assert.equal(canPlayNow(g, 0, q), false);
  const gear = put(g, 0, 'unl-109-219', 'base');
  g = playAct(g, 0, q, 'base');
  g = resolveAll(g);
  assert.equal(zoneOf(g, q), 'base');
  assert.equal(zoneOf(g, gear), 'hand');
});

test('sfd-055 Needlessly Large Yordle: [2][C] less per point scored from holding this turn', () => {
  let g = game();
  setRunes(g, 0, { Calm: 9 });
  const y = handCard(g, 0, 'sfd-055-221');
  assert.equal(canPlayNow(g, 0, y), false, 'needs [10]');
  // hold: P1 controls BF0 with a unit; their turn starts -> hold scores
  setController(g, 0, 1);
  put(g, 1, 't-u2', 0);
  const y1 = handCard(g, 1, 'sfd-055-221');
  g = nextTurn(g);
  assert.equal(g.activePlayer, 1);
  assert.equal(g.players[1].points, 1);
  setRunes(g, 1, { Calm: 7 });
  assert.equal(canPlayNow(g, 1, y1), false, '[8] needed after one hold point');
  setRunes(g, 1, { Calm: 8 });
  assert.ok(canPlayNow(g, 1, y1), '[8][C][C] after one hold point');
  g = playAct(g, 1, y1, 'base');
  g = resolveAll(g);
  assert.equal(zoneOf(g, y1), 'base');
  assert.equal(readyRunes(g, 1), 0);
  assert.equal(g.players[1].runesInPlay.length, 6, 'two Calm runes recycled for [C][C]');
  assert.equal(kwVal(g, y1, 'Shield'), 5);
  assert.ok(hasKw(g, y1, 'Tank'));
});

test('sfd-079 Bard: exhausting the legend moves any number of units to an open battlefield', () => {
  let g = game();
  setRunes(g, 0, { Mind: 5 });
  const l = g.players[0].legend;
  const a = put(g, 0, 't-u1', 'base'), b = put(g, 0, 't-u2', 'base');
  const bard = handCard(g, 0, 'sfd-079-221');
  g = playAct(g, 0, bard, 'base');
  g = answer(g, 'optional', 'yes');
  assert.equal(g.objects[l].exhausted, true);
  // RULINGS (CR 355.4 / 355.5 / 403.2): destination and units are chosen as the play trigger goes on the chain
  const bf1 = g.battlefields[1].objId;
  assert.ok(isAsking(g, 'chooseTargets'));
  assert.ok(optionIds(g).includes(bf1));
  g = answer(g, 'chooseTargets', bf1);
  assert.deepEqual(optionIds(g).sort(), [a, b, bard].sort());
  g = answer(g, 'chooseTargets', a, bard);
  assert.ok(g.chain.length > 0, 'choices were made before the trigger resolves');
  g = resolveAll(g);
  assert.equal(g.objects[a].battlefieldIndex, 1);
  assert.equal(g.objects[bard].zone, 'battlefield');
  assert.equal(zoneOf(g, b), 'base');
});

test('sfd-079 Bard: without paying, nothing moves; with a legend already exhausted it is not offered', () => {
  let g = game();
  setRunes(g, 0, { Mind: 5 });
  const bard = handCard(g, 0, 'sfd-079-221');
  g = playAct(g, 0, bard, 'base');
  g = answer(g, 'optional', 'no');
  g = resolveAll(g);
  assert.equal(isAsking(g), false);
  assert.equal(zoneOf(g, bard), 'base');
  let h = game();
  setRunes(h, 0, { Mind: 5 });
  h.objects[h.players[0].legend].exhausted = true;
  const bard2 = handCard(h, 0, 'sfd-079-221');
  h = playAct(h, 0, bard2, 'base');
  assert.equal(isAsking(h, 'optional'), false);
});

test('sfd-087 Premonition: draw 3', () => {
  let g = game();
  setRunes(g, 0, { Mind: 5 });
  const s = handCard(g, 0, 'sfd-087-221');
  const h0 = hand(g, 0).length;
  g = playAct(g, 0, s);
  g = resolveAll(g);
  assert.equal(hand(g, 0).length, h0 - 1 + 3);
});

test('sfd-103 Jaull-Fish: [2] less per Mighty unit you control; Accelerate', () => {
  let g = game();
  setRunes(g, 0, { Body: 5 });
  const j = handCard(g, 0, 'sfd-103-221');
  assert.equal(canPlayNow(g, 0, j), false);
  put(g, 0, 't-u5', 'base');
  put(g, 1, 't-u5', 'base');
  assert.ok(canPlayNow(g, 0, j));
  g = playAct(g, 0, j, 'base');
  if (isAsking(g, 'optional')) g = answer(g, 'optional', 'no');
  g = resolveAll(g);
  assert.equal(zoneOf(g, j), 'base');
  assert.equal(readyRunes(g, 0), 0);
  assert.ok(hasKw(g, j, 'Accelerate'));
});

test('sfd-106 Show of Strength: draw 1 for each of your Mighty units', () => {
  let g = game();
  setRunes(g, 0, { Body: 3 });
  put(g, 0, 't-u5', 'base'); put(g, 0, 't-u5', 'base'); put(g, 0, 't-u4', 'base'); put(g, 1, 't-u5', 'base');
  const s = handCard(g, 0, 'sfd-106-221');
  const h0 = hand(g, 0).length;
  g = playAct(g, 0, s);
  g = resolveAll(g);
  assert.equal(hand(g, 0).length, h0 - 1 + 2);
});

void legend; void m;

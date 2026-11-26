import { test } from 'node:test';
import { game, mana, stack, play, drive, opt, none, objOpt, hand, trash, deckTop, deckBottom, put, zoneOf, act, endTurn, handCard, assert, pendingIs, noInStep, setController, hasKw, might } from './_util.ts';
import { getLegalActions } from '../../../src/engine/game.ts';
type G = import('./_util.ts').GameState;
const canPlayNow = (g: G, p: number, id: string) => getLegalActions(g, p as 0 | 1).some(a => a.type === 'playCard' && a.obj === id);
const toBase = (g: G) => (g.pending?.kind === 'chooseDestination' ? drive(g, 'base') : g);

test('Blind Fury (ogn-025): the opponent reveals their top card; you banish it and play it for free under your control', () => {
  let g = game(); mana(g, 0, 6, 'Fury');
  const [top] = stack(g, 1, 't-u5');
  g = play(g, 0, 'ogn-025-298').g;
  g = toBase(g);
  assert.equal(zoneOf(g, top), 'base');
  assert.equal(g.objects[top].controller, 0); assert.equal(g.objects[top].owner, 1);
});

test('Drakehound Packmaster (rad-018): reveals the top of each opponent deck; a spell is played for free (targets chosen by you)', () => {
  let g = game(); mana(g, 0, 11, 'Fury');
  const [top] = stack(g, 1, 'ogn-114-298');   // Progress Day: draw 4 (for the player who plays it)
  const h = hand(g, 0).length;
  g = play(g, 0, 'rad-018-167', { dest: 'base' }).g;
  assert.equal(hand(g, 0).length, h + 4);
  assert.equal(zoneOf(g, top), 'trash');
  assert.ok(g.players[1].trash.includes(top), "goes to its owner's trash");
});

test('Reinforce (ogn-062): may banish a unit among the top 5 and play it for [5] less; recycle the rest', () => {
  let g = game(); mana(g, 0, 5, 'Calm');
  const [a, big, c] = stack(g, 0, 'ogn-083-298', 'ogn-038-298', 't-u1', 't-u2', 't-u3');
  g = play(g, 0, 'ogn-062-298').g;
  pendingIs(g, 'chooseCards');
  assert.ok(!g.pending!.options!.some(o => o.objIds![0] === big), 'Kadregrin costs [4][R][R] after the discount: not affordable');
  g = drive(g, objOpt(c));
  g = toBase(g);
  assert.equal(zoneOf(g, c), 'base');
  assert.ok(deckBottom(g, 0, 4).includes('ogn-083-298'));
  void a;
});

test('Wild Claw (ven-089): banish a unit/gear among the top 5, play it for [5] less, then you may Empower it', () => {
  let g = game(); mana(g, 0, 9, 'Body');
  const [x, kx] = stack(g, 0, 't-u1', 'ven-114-166', 't-u2', 't-u3', 't-u4');   // Kharox E6
  g = play(g, 0, 'ven-089-166', {}, objOpt(kx)).g;
  g = toBase(g);
  assert.equal(zoneOf(g, kx), 'base');
  pendingIs(g, 'optional', 0);
  g = drive(g, 'yes');
  assert.ok(g.objects[kx].empowered);
  void x;
});

test('Baited Hook (ogn-242): kill a friendly unit; may banish a unit with Might up to 1 more among the top 5 and play it free', () => {
  let g = game(); mana(g, 0, 2, 'Order');
  const hook = put(g, 0, 'ogn-242-298', 'base');
  const v = put(g, 0, 't-u2', 'base');
  const [u3, u4] = stack(g, 0, 't-u3', 't-u4', 't-u1', 'ogn-083-298', 't-u2');
  g = act(g, { type: 'activate', player: 0, obj: hook, abilityIndex: 0 });
  g = drive(g);
  assert.equal(zoneOf(g, v), 'trash');
  pendingIs(g, 'chooseCards', 0);
  const offered = g.pending!.options!.map(o => g.objects[o.objIds![0]].cardId).sort();
  assert.deepEqual(offered, ['t-u1', 't-u2', 't-u3']);
  g = toBase(drive(g, objOpt(u3)));
  assert.equal(zoneOf(g, u3), 'base');
  assert.ok(g.objects[hook].exhausted);
  void u4;
});

test('Dazzling Aurora (ogn-160): at end of turn reveal until a unit, banish it and play it for free; recycle the rest', () => {
  let g = game();
  put(g, 0, 'ogn-160-298', 'base');
  const [s1, s2, u] = stack(g, 0, 'ogn-083-298', 'ogn-114-298', 't-u5');
  g = act(g, { type: 'endTurn', player: 0 });
  g = toBase(drive(g));
  assert.equal(g.objects[u].zone, 'base');
  assert.equal(zoneOf(g, s1), 'mainDeck'); assert.equal(zoneOf(g, s2), 'mainDeck');
});

test("Rek'Sai (sfd-170): when attacking, may reveal 2, banish one and play it paying its cost; a unit may go here", () => {
  let g = game(); mana(g, 0, 2, 'Order');
  const rk = put(g, 0, 'sfd-170-221', 'base');
  put(g, 1, 't-u1', 0); setController(g, 0, 1);
  const [u, s] = stack(g, 0, 't-u2', 'ogn-083-298');
  g = drive(act(g, { type: 'move', player: 0, units: [rk], to: 0 }));
  pendingIs(g, 'optional', 0);
  g = drive(g, 'yes');
  pendingIs(g, 'chooseCards');
  assert.deepEqual(g.pending!.options!.map(o => o.objIds![0]), [u], 'Consult the Past (E4) is not affordable');
  g = drive(g, objOpt(u));
  pendingIs(g, 'chooseDestination');
  assert.ok(g.pending!.options!.some(o => o.id === '0'), 'may be played here');
  g = drive(g, '0');
  assert.equal(g.objects[u].zone, 'battlefield'); assert.equal(g.objects[u].battlefieldIndex, 0);
  assert.equal(zoneOf(g, s), 'mainDeck');
});

test('Void Burrower (sfd-187, legend): when you conquer, may exhaust it to reveal 2, banish one and play it', () => {
  let g = game(); mana(g, 0, 2, 'Fury');
  const leg = g.players[0].legend;
  g.objects[leg].cardId = 'sfd-187-221';
  const u = put(g, 0, 't-u1', 'base');
  const [a] = stack(g, 0, 't-u2', 't-u3');
  g = drive(act(g, { type: 'move', player: 0, units: [u], to: 0 }));
  pendingIs(g, 'optional', 0);
  g = toBase(drive(g, 'yes', objOpt(a)));
  assert.equal(zoneOf(g, a), 'base');
  assert.ok(g.objects[leg].exhausted);
});

test('Void Rush (sfd-188): reveal 2, may banish one and play it for [2] less; draw the others', () => {
  let g = game(); mana(g, 0, 4, 'Fury');
  const [a, b] = stack(g, 0, 't-u4', 't-u3');
  g = toBase(play(g, 0, 'sfd-188-221', {}, objOpt(a)).g);
  assert.equal(zoneOf(g, a), 'base'); assert.equal(zoneOf(g, b), 'hand');
  g = game(); mana(g, 0, 3, 'Fury');
  const [c, d] = stack(g, 0, 't-u4', 't-u3');
  g = play(g, 0, 'sfd-188-221', {}, none).g;
  assert.equal(zoneOf(g, c), 'hand'); assert.equal(zoneOf(g, d), 'hand');
});

test('Promising Future (ogn-115): each player banishes one of their top 5; starting with the next player each plays it ignoring Energy', () => {
  let g = game(); mana(g, 0, 6, 'Mind');
  const [mine] = stack(g, 0, 't-u5', 't-u1', 't-u1', 't-u1', 't-u1');
  const [theirs] = stack(g, 1, 't-u4', 't-u1', 't-u1', 't-u1', 't-u1');
  g = play(g, 0, 'ogn-115-298').g;
  pendingIs(g, 'chooseCards', 0);
  g = drive(g, objOpt(mine));
  pendingIs(g, 'chooseCards', 1);
  g = drive(g, objOpt(theirs));
  g = toBase(g); g = toBase(g);
  assert.equal(zoneOf(g, mine), 'base'); assert.equal(g.objects[mine].controller, 0);
  assert.equal(zoneOf(g, theirs), 'base'); assert.equal(g.objects[theirs].controller, 1);
  assert.ok(g.log.findIndex(l => /Bob plays t-u4/.test(l.text)) < g.log.findIndex(l => /Alice plays t-u5/.test(l.text)), 'next player first');
});

test('Portal Rescue (ogn-102): banish a friendly unit, its owner plays it to their base (a new object: damage gone, ready state reset)', () => {
  let g = game(); mana(g, 0, 4, 'Mind'); setController(g, 0, 0);
  const u = put(g, 0, 't-u3', 0, { damage: 2 });
  g = play(g, 0, 'ogn-102-298').g;
  assert.equal(zoneOf(g, u), 'base'); assert.equal(g.objects[u].damage, 0);
});

test('Thrill of the Hunt (unl-184): banish a friendly unit; its owner plays it to any battlefield', () => {
  let g = game(); mana(g, 0, 3, 'Fury');
  const u = put(g, 0, 't-u3', 'base');
  g = play(g, 0, 'unl-184-219').g;
  pendingIs(g, 'chooseBattlefield', 0);
  g = drive(g, '1');
  assert.equal(g.objects[u].zone, 'battlefield'); assert.equal(g.objects[u].battlefieldIndex, 1);
});

test('Temporal Breach (ven-066): banish a unit; its owner plays it back to the same location', () => {
  let g = game(); mana(g, 0, 3, 'Mind');
  const e = put(g, 1, 't-u3', 1, { damage: 2 }); setController(g, 1, 1);
  g = play(g, 0, 'ven-066-166').g;
  assert.equal(g.objects[e].zone, 'battlefield'); assert.equal(g.objects[e].battlefieldIndex, 1);
  assert.equal(g.objects[e].controller, 1); assert.equal(g.objects[e].damage, 0);
});

test('Chronobreak (rad-140): pay X Power; banish X of your units and their owners play them back (same location or base, you choose the order)', () => {
  let g = game(); mana(g, 0, 4, 'Fury'); setController(g, 0, 0);
  const a = put(g, 0, 't-u2', 0, { damage: 1 }), b = put(g, 0, 't-u3', 'base', { damage: 1 });
  g = play(g, 0, 'rad-140-167').g;
  pendingIs(g, 'chooseNumber', 0);
  g = drive(g, '2', objOpt(b));        // order: b first (then a, auto)
  pendingIs(g, 'chooseDestination', 0);
  g = drive(g, '0');                   // a goes back to the battlefield
  assert.equal(g.objects[a].zone, 'battlefield'); assert.equal(g.objects[b].zone, 'base');
  assert.equal(g.objects[a].damage, 0); assert.equal(g.objects[b].damage, 0);
  assert.equal(g.players[0].runesInPlay.length, 2, 'two runes recycled for [A][A]');
});

test('Ava Achiever (ogn-107): attacking, may pay [C] to play a [Hidden] card from hand for free; a unit enters here', () => {
  let g = game(); mana(g, 0, 1, 'Mind');
  const ava = put(g, 0, 'ogn-107-298', 'base');
  put(g, 1, 't-u1', 0); setController(g, 0, 1);
  const tm = handCard(g, 0, 'ogn-121-298');   // Teemo (Hidden unit)
  g = drive(act(g, { type: 'move', player: 0, units: [ava], to: 0 }));
  pendingIs(g, 'optional', 0);   // the leading "you may pay [C]" is decided as the trigger goes on the chain (principle 11)
  g = drive(g, 'yes');
  if (g.pending?.kind === 'chooseCards') g = drive(g, objOpt(tm));
  assert.equal(g.objects[tm].zone, 'battlefield'); assert.equal(g.objects[tm].battlefieldIndex, 0);
});

test('Transpositionist (rad-115): return a friendly unit; may play a unit with less Might from hand for free', () => {
  let g = game(); mana(g, 0, 2, 'Chaos');
  const tp = put(g, 0, 'rad-115-167', 'base');
  const big = put(g, 0, 't-u4', 'base');
  g = act(g, { type: 'activate', player: 0, obj: tp, abilityIndex: 0 });
  g = drive(g, objOpt(big));
  pendingIs(g, 'chooseCards', 0);
  const offered = g.pending!.options!.map(o => g.objects[o.objIds![0]].cardId).sort();
  assert.deepEqual(offered, ['t-u1', 't-u2', 't-u3']);
  g = toBase(drive(g, opt('t-u3')));
  assert.equal(zoneOf(g, big), 'hand');
  assert.ok(g.players[0].base.some(id => g.objects[id].cardId === 't-u3'));
});

test('Here to Help (sfd-111): may play a unit from hand to a battlefield you control for [3] less', () => {
  let g = game(); mana(g, 0, 4, 'Body'); setController(g, 0, 0);
  put(g, 0, 't-u1', 0);
  const u5 = handCard(g, 0, 't-u5');
  g = play(g, 0, 'sfd-111-221', {}, objOpt(u5)).g;
  assert.equal(g.objects[u5].zone, 'battlefield'); assert.equal(g.objects[u5].battlefieldIndex, 0);
  // no controlled battlefield: nothing
  g = game(); mana(g, 0, 3, 'Body');
  g = play(g, 0, 'sfd-111-221').g;
  noInStep(g);
});

test('Jayce (sfd-084): may kill a friendly gear; then one gear (Energy <= 7) can be played this turn ignoring its Energy cost', () => {
  let g = game(); mana(g, 0, 4, 'Mind');
  const old = put(g, 0, 'ogn-242-298', 'base');
  const aurora = handCard(g, 0, 'ogn-160-298');   // E9: too expensive for the discount
  const scope = handCard(g, 0, 'rad-064-167');    // E2
  g = play(g, 0, 'sfd-084-221', { dest: 'base' }, objOpt(old)).g;
  assert.equal(zoneOf(g, old), 'trash');
  for (const r of g.players[0].runesInPlay) g.objects[r].exhausted = true;
  assert.ok(canPlayNow(g, 0, scope));
  assert.ok(!canPlayNow(g, 0, aurora));
  g = drive(act(g, { type: 'playCard', player: 0, obj: scope }));
  assert.equal(zoneOf(g, scope), 'base');
  const scope2 = handCard(g, 0, 'rad-064-167');
  assert.ok(!canPlayNow(g, 0, scope2), 'only once');
});

test('Jayce: declining the kill gives no discount', () => {
  let g = game(); mana(g, 0, 4, 'Mind');
  put(g, 0, 'ogn-242-298', 'base');
  const scope = handCard(g, 0, 'rad-064-167');
  g = play(g, 0, 'sfd-084-221', { dest: 'base' }, none).g;
  for (const r of g.players[0].runesInPlay) g.objects[r].exhausted = true;
  assert.ok(!canPlayNow(g, 0, scope));
});

test('Last Caress (rad-154): the next unit you play can go to any battlefield and gets buffed; only the next one', () => {
  let g = game(); mana(g, 0, 8, 'Chaos');
  g = play(g, 0, 'rad-154-167').g;
  const u = handCard(g, 0, 't-u2');
  g = drive(act(g, { type: 'playCard', player: 0, obj: u, destination: 1 }));
  assert.equal(g.objects[u].battlefieldIndex, 1);
  assert.ok(g.objects[u].counters.buff);
  const u2 = handCard(g, 0, 't-u1');
  assert.throws(() => act(g, { type: 'playCard', player: 0, obj: u2, destination: 0 }));
  g = drive(act(g, { type: 'playCard', player: 0, obj: u2, destination: 'base' }));
  assert.ok(!g.objects[u2].counters.buff);
});

test('Akali (rad-015): first move each turn adds [1][A]; second move banishes the top card, playable until your next Ending Phase', () => {
  let g = game(); setController(g, 0, 0);
  const ak = put(g, 0, 'rad-015-167', 'base');
  g = drive(act(g, { type: 'move', player: 0, units: [ak], to: 0 }));
  assert.equal(g.players[0].pool.energy, 1);
  const [top] = stack(g, 0, 't-u2');
  g.objects[ak].exhausted = false;
  g = drive(act(g, { type: 'move', player: 0, units: [ak], to: 'base' }));
  assert.equal(zoneOf(g, top), 'banishment');
  mana(g, 0, 2, 'Fury');
  assert.ok(canPlayNow(g, 0, top));
  g = drive(act(g, { type: 'playCard', player: 0, obj: top, destination: 'base' }));
  assert.equal(zoneOf(g, top), 'base');
});
void deckTop; void trash; void hasKw; void might; void endTurn;

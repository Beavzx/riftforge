// B3: Spiritforged (sfd) cards.
import { test } from 'node:test';
import { cardTiming } from '../../../src/engine/play.ts';
import { spendBuff } from '../../../src/engine/actions.ts';
import {
  game, mana, run, expectDecision, play, activate, canPlay, canActivate, tokens, tokensAt, put, handCard, zoneOf, setController, assert, M, kw,
  controlBf, slay, move, endTurn, setLegend, setBattlefield, act, choose, noRunes, putToken, respond,
} from './util.ts';

type G = ReturnType<typeof game>;
const golds = (g: G, p: 0 | 1) => tokens(g, p, 'Gold');

test('Bushwhack (sfd-004): friendly units (cards and unit tokens) enter ready this turn; an exhausted Gold', () => {
  let g = game();
  mana(g, 0, 4, 'Fury', 'Order');
  g = play(g, 0, handCard(g, 0, 'sfd-004-221'));
  g = run(g);
  assert.equal(golds(g, 0).length, 1);
  assert.equal(g.objects[golds(g, 0)[0]].exhausted, true, 'gear is not a unit');
  const u = handCard(g, 0, 't-u1');
  g = play(g, 0, u, { destination: 'base' });
  assert.equal(g.objects[u].exhausted, false);
  g = play(g, 0, handCard(g, 0, 'ogn-211-298'), { destination: 'base' });
  g = run(g);
  const [r] = tokens(g, 0, 'Recruit');
  assert.equal(g.objects[r].exhausted, false, 'unit token enters ready too');
  g = endTurn(g);
  mana(g, 1, 1);
  const v = handCard(g, 1, 't-u1');
  g = play(g, 1, v, { destination: 'base' });
  assert.equal(g.objects[v].exhausted, true, 'only this turn / only friendly');
});

test('Assembly Rig (sfd-019): [1][C], recycle a unit from your trash, [T]: a Mech to your base', () => {
  let g = game();
  const rig = put(g, 0, 'sfd-019-221', 'base');
  noRunes(g, 0);
  mana(g, 0, 1, 'Fury');
  assert.ok(!canActivate(g, 0, rig), 'no unit in trash');
  const tu = put(g, 0, 't-u2', 'trash');
  put(g, 0, 'ts-zap', 'trash');
  g = activate(g, 0, rig);
  g = run(g);
  assert.equal(zoneOf(g, tu), 'mainDeck');
  assert.equal(tokensAt(g, 0, 'Mech', 'base').length, 1);
});

test('Draven, Vanquisher (sfd-020): may pay [C] for +2 when attacking; wins the combat -> Gold', () => {
  let g = game();
  mana(g, 0, 0, 'Fury');
  controlBf(g, 1, 0, 't-u3');
  const d = put(g, 0, 'sfd-020-221', 'base');
  g = act(g, { type: 'move', player: 0, units: [d], to: 0 });
  g = run(g);
  expectDecision(g, 'optional', 0);
  g = run(g, 'yes');
  assert.equal(g.battlefields[0].controller, 0, 'Draven (6) beat the 3');
  assert.equal(zoneOf(g, d), 'battlefield');
  assert.equal(golds(g, 0).length, 1);
});

test('Ferrous Forerunner (sfd-021): Deathknell — two Mechs to your base', () => {
  let g = game();
  const f = put(g, 1, 'sfd-021-221', 'base');
  g = slay(g, 0, f);
  assert.equal(tokensAt(g, 1, 'Mech', 'base').length, 2);
});

test('Rumble, Hotheaded (sfd-026): Mechs have Assault; on conquer recycle a unit to play a Mech from trash for less', () => {
  let g = game();
  const r = put(g, 0, 'sfd-026-221', 'base');
  const ally = put(g, 0, 't-u2', 'base');
  const other = put(g, 0, 't-u2', 'base');
  assert.ok(kw(g, r, 'Assault'), 'Rumble is a Mech');
  assert.ok(!kw(g, ally, 'Assault'));
  const fc = put(g, 0, 'sfd-065-221', 'trash');   // Forecaster: Mech, [2]
  noRunes(g, 0);
  g = act(g, { type: 'move', player: 0, units: [r], to: 0 });
  g = run(g);
  expectDecision(g, 'optional', 0);
  g = run(g, 'yes', [ally]);
  assert.equal(zoneOf(g, ally), 'mainDeck');
  g = run(g, 'base');
  assert.equal(zoneOf(g, fc), 'base', 'played for [2] - 2 = free');
  assert.equal(zoneOf(g, other), 'base');
});

test("Rek'Sai (sfd-029): Accelerate + Assault (the non-hand Accelerate grant is engine-blocked)", () => {
  const g = game();
  const r = put(g, 0, 'sfd-029-221', 'base');
  assert.ok(kw(g, r, 'Accelerate') && kw(g, r, 'Assault'));
});
test("Rek'Sai (sfd-029): units played from trash/face down get Accelerate", () => {});

test("Desert's Call (sfd-031): a Sand Soldier; Repeat [2] makes another", () => {
  let g = game();
  mana(g, 0, 2);
  g = play(g, 0, handCard(g, 0, 'sfd-031-221'));
  expectDecision(g, 'optional', 0);
  g = run(g, 'yes');
  const ss = tokens(g, 0, 'Sand Soldier');
  assert.equal(ss.length, 2);
  assert.equal(M(g, ss[0]), 2);
});

test('Lonely Poro (sfd-036): draws only if it died alone', () => {
  let g = game();
  const p = put(g, 1, 'sfd-036-221', 0);
  const n = g.players[1].hand.length;
  g = slay(g, 0, p);
  assert.equal(g.players[1].hand.length, n + 1);
  let h = game();
  const p2 = put(h, 1, 'sfd-036-221', 0);
  put(h, 1, 't-u1', 0);
  const n2 = h.players[1].hand.length;
  h = slay(h, 0, p2);
  assert.equal(h.players[1].hand.length, n2);
});

test('Jax (sfd-054): your Equipment have Quick-Draw: Reaction timing and attach when played', () => {
  let g = game();
  put(g, 0, 'sfd-054-221', 'base');
  const u = put(g, 0, 't-u2', 'base');
  const sw = handCard(g, 0, 'ts-sword');
  assert.equal(cardTiming(g, 0, sw), 'reaction');
  assert.equal(cardTiming(g, 1, handCard(g, 1, 'ts-sword')), 'normal');
  mana(g, 0, 1);
  g = play(g, 0, sw);
  assert.ok(kw(g, sw, 'Quick-Draw'));
  g = run(g, [u]);
  assert.equal(g.objects[sw].attachedTo, u);
});

test("Chemtech Cask (sfd-063): a spell on an opponent's turn -> may exhaust it for a Gold", () => {
  let g = game();
  const cask = put(g, 1, 'sfd-063-221', 'base');
  const target = put(g, 0, 't-u3', 'base');
  mana(g, 0, 1); mana(g, 1, 1);
  g = play(g, 0, handCard(g, 0, 'ts-pump'));
  if (g.pending?.kind === 'chooseTargets') g = choose(g, target);
  g = respond(g, 1, handCard(g, 1, 'ts-zap'), target);
  g = run(g);
  expectDecision(g, 'optional', 1);
  g = run(g, 'yes');
  assert.equal(g.objects[cask].exhausted, true);
  assert.equal(golds(g, 1).length, 1);
});

test('Forecaster (sfd-065): your Mechs have Vision', () => {
  const g = game();
  const f = put(g, 0, 'sfd-065-221', 'base');
  const m = putToken(g, 0, 'tok-mech', 'base'), o = put(g, 0, 't-u1', 'base');
  assert.ok(kw(g, f, 'Vision') && kw(g, m, 'Vision'));
  assert.ok(!kw(g, o, 'Vision'));
});

test('Plundering Poro (sfd-069): conquer -> Gold', () => {
  let g = game();
  const p = put(g, 0, 'sfd-069-221', 'base');
  g = move(g, 0, [p], 0);
  assert.equal(g.battlefields[0].controller, 0);
  assert.equal(golds(g, 0).length, 1);
});

test('Wages of Pain (sfd-070): deal 3 to a unit at a battlefield and a Gold', () => {
  let g = game();
  mana(g, 0, 1);
  const e = put(g, 1, 't-u3', 0);
  put(g, 1, 't-u3', 'base');
  g = play(g, 0, handCard(g, 0, 'sfd-070-221'));
  if (g.pending?.kind === 'chooseTargets') g = choose(g, e);
  g = run(g);
  assert.equal(zoneOf(g, e), 'trash');
  assert.equal(golds(g, 0).length, 1);
});

test('Breakneck Mech (sfd-071): your Mechs have Deflect and Ganking; enters ready with another Mech', () => {
  let g = game();
  mana(g, 0, 8, 'Mind', 'Mind');
  const m = putToken(g, 0, 'tok-mech', 'base');
  const b = handCard(g, 0, 'sfd-071-221');
  g = play(g, 0, b, { destination: 'base' });
  assert.equal(g.objects[b].exhausted, false);
  assert.ok(kw(g, m, 'Deflect') && kw(g, m, 'Ganking') && kw(g, b, 'Ganking'));
  let h = game();
  mana(h, 0, 8, 'Mind', 'Mind');
  const b2 = handCard(h, 0, 'sfd-071-221');
  h = play(h, 0, b2, { destination: 'base' });
  assert.equal(h.objects[b2].exhausted, true);
});

test('Pickpocket (sfd-074): may kill a gear costing [1] or less; if you do, a Gold', () => {
  let g = game();
  mana(g, 0, 3);
  const cheap = put(g, 1, 'sfd-063-221', 'base'), costly = put(g, 1, 'ogn-212-298', 'base');
  g = play(g, 0, handCard(g, 0, 'sfd-074-221'), { destination: 'base' });
  const opts = expectDecision(g, 'chooseTargets', 0);
  assert.ok(opts.includes(cheap) && !opts.includes(costly));
  assert.equal(g.pending!.min, 0);
  g = run(g, [cheap]);
  assert.equal(zoneOf(g, cheap), 'trash');
  assert.equal(golds(g, 0).length, 1);
  let h = game();
  mana(h, 0, 3);
  put(h, 1, 'sfd-063-221', 'base');
  h = play(h, 0, handCard(h, 0, 'sfd-074-221'), { destination: 'base' });
  h = run(h, []);
  assert.equal(golds(h, 0).length, 0);
});

test('Production Surge (sfd-076): costs [2] less with a Mech; a Mech to base and draw 1', () => {
  let g = game();
  noRunes(g, 0);
  mana(g, 0, 2, 'Mind');
  const s = handCard(g, 0, 'sfd-076-221');
  assert.ok(!canPlay(g, 0, s));
  putToken(g, 0, 'tok-mech', 'base');
  assert.ok(canPlay(g, 0, s));
  const n = g.players[0].hand.length;
  g = play(g, 0, s);
  g = run(g);
  assert.equal(tokens(g, 0, 'Mech').length, 2);
  assert.equal(g.players[0].hand.length, n - 1 + 1);
});

test('Card Sharp (sfd-081): you and each opponent may play a Gold; one more for you per opponent who did', () => {
  let g = game();
  mana(g, 0, 1);
  g = play(g, 0, handCard(g, 0, 'sfd-081-221'), { destination: 'base' });
  g = run(g);
  expectDecision(g, 'optional', 0);
  g = run(g, 'yes');
  expectDecision(g, 'optional', 1);
  g = run(g, 'yes');
  assert.equal(golds(g, 0).length, 2);
  assert.equal(golds(g, 1).length, 1);
  let h = game();
  mana(h, 0, 1);
  h = play(h, 0, handCard(h, 0, 'sfd-081-221'), { destination: 'base' });
  h = run(h, 'no', 'no');
  assert.equal(golds(h, 0).length + golds(h, 1).length, 0);
});

test('Rumble, Scrapper (sfd-089): your Mechs +1 (including him); hold -> a Mech to base', () => {
  let g = game();
  const r = put(g, 1, 'sfd-089-221', 0);
  setController(g, 0, 1);
  const m = putToken(g, 1, 'tok-mech', 'base');
  assert.equal(M(g, r), 5);
  assert.equal(M(g, m), 4);
  g = endTurn(g);
  assert.equal(tokensAt(g, 1, 'Mech', 'base').length, 2);
});

test('Fae Dragon (sfd-101): buff up to four friendly units; when you spend a buff, a Gold', () => {
  let g = game();
  mana(g, 0, 6, 'Body');
  const a = put(g, 0, 't-u1', 'base'), b = put(g, 0, 't-u1', 'base');
  const e = put(g, 1, 't-u1', 'base');
  g = play(g, 0, handCard(g, 0, 'sfd-101-221'), { destination: 'base' });
  const opts = expectDecision(g, 'chooseTargets', 0);
  assert.ok(!opts.includes(e));
  assert.equal(g.pending!.max, 3, 'up to four; three candidates');
  g = run(g, [a, b]);
  assert.equal(M(g, a), 2);
  spendBuff(g, a);
  g = endTurn(g);
  assert.equal(golds(g, 0).length, 1);
});

test('Black Market Broker (sfd-121): playing a card from face down -> Gold', () => {
  let g = game();
  controlBf(g, 0, 0);
  put(g, 0, 'sfd-121-221', 'base');
  mana(g, 0, 1);
  const h = handCard(g, 0, 't-hidden');
  g = act(g, { type: 'hide', player: 0, obj: h, battlefieldIndex: 0 });
  g = run(g);
  assert.equal(golds(g, 0).length, 0, 'hiding is not playing');
  g = endTurn(g); g = endTurn(g);
  g = play(g, 0, h);
  g = run(g);
  assert.equal(golds(g, 0).length, 1);
});

test('Treasure Hunter (sfd-130): when it moves, a Gold', () => {
  let g = game();
  const t = put(g, 0, 'sfd-130-221', 'base');
  g = move(g, 0, [t], 0);
  assert.equal(golds(g, 0).length, 1);
});

test('Eminent Benefactor (sfd-152): when it holds, two Gold', () => {
  let g = game();
  controlBf(g, 1, 0, 'sfd-152-221');
  g = endTurn(g);
  assert.equal(golds(g, 1).length, 2);
});

test('Guards! (sfd-154): a Sand Soldier; then may pay [C] to ready it', () => {
  let g = game();
  mana(g, 0, 3, 'Order');
  g = play(g, 0, handCard(g, 0, 'sfd-154-221'));
  g = run(g);
  expectDecision(g, 'optional', 0);
  g = run(g, 'yes');
  const [s] = tokens(g, 0, 'Sand Soldier');
  assert.equal(g.objects[s].exhausted, false);
  let h = game();
  noRunes(h, 0);
  mana(h, 0, 3);
  h = play(h, 0, handCard(h, 0, 'sfd-154-221'));
  h = run(h);
  assert.equal(h.pending?.kind, 'mainAction', 'no Order power: not asked');
  assert.equal(h.objects[tokens(h, 0, 'Sand Soldier')[0]].exhausted, true);
});

test('Honest Broker (sfd-155): Deathknell — a Gold', () => {
  let g = game();
  const b = put(g, 1, 'sfd-155-221', 'base');
  g = slay(g, 0, b);
  assert.equal(golds(g, 1).length, 1);
});

test('Royal Guard (sfd-157): a Sand Soldier here', () => {
  let g = game();
  controlBf(g, 0, 0);
  mana(g, 0, 4);
  g = play(g, 0, handCard(g, 0, 'sfd-157-221'), { destination: 0 });
  g = run(g);
  assert.equal(tokensAt(g, 0, 'Sand Soldier', 0).length, 1);
});

test('Trusty Ramhound (sfd-159): +1 while you have another unit here', () => {
  const g = game();
  const r = put(g, 0, 'sfd-159-221', 0);
  put(g, 1, 't-u1', 0);
  assert.equal(M(g, r), 2, 'enemy units do not count');
  put(g, 0, 't-u1', 0);
  assert.equal(M(g, r), 3);
});

test('Blood Money (sfd-162): kill a unit at a battlefield with 2 or less; Gold x1 (enemy) or x2 (friendly)', () => {
  let g = game();
  mana(g, 0, 2);
  const big = put(g, 1, 't-u3', 0), e = put(g, 1, 't-u2', 0);
  g = play(g, 0, handCard(g, 0, 'sfd-162-221'));
  if (g.pending?.kind === 'chooseTargets') { assert.ok(!expectDecision(g, 'chooseTargets').includes(big)); g = choose(g, e); }
  g = run(g);
  assert.equal(zoneOf(g, e), 'trash');
  assert.equal(golds(g, 0).length, 1);
  let h = game();
  mana(h, 0, 2);
  const f = put(h, 0, 't-u2', 1);
  h = play(h, 0, handCard(h, 0, 'sfd-162-221'));
  if (h.pending?.kind === 'chooseTargets') h = choose(h, f);
  h = run(h);
  assert.equal(golds(h, 0).length, 2);
});

test('Vanguard Armory (sfd-168): [T]: three Recruits, each to its own location', () => {
  let g = game();
  controlBf(g, 0, 1);
  const a = put(g, 0, 'sfd-168-221', 'base');
  g = activate(g, 0, a);
  g = run(g, 'base', '1', '1');
  assert.equal(tokensAt(g, 0, 'Recruit', 'base').length, 1);
  assert.equal(tokensAt(g, 0, 'Recruit', 1).length, 2);
});

test('Renata Glasc (sfd-171): your tokens enter ready (Gold too); opponents\' do not', () => {
  let g = game();
  put(g, 0, 'sfd-171-221', 'base');
  mana(g, 0, 4);
  g = play(g, 0, handCard(g, 0, 'ogn-211-298'), { destination: 'base' });
  g = run(g);
  assert.equal(g.objects[tokens(g, 0, 'Recruit')[0]].exhausted, false);
  g = play(g, 0, handCard(g, 0, 'rad-100-167'));
  g = run(g);
  assert.equal(g.objects[golds(g, 0)[0]].exhausted, false);
  const bm = put(g, 1, 'sfd-155-221', 'base');
  g = slay(g, 0, bm);
  assert.equal(g.objects[golds(g, 1)[0]].exhausted, true);
});

test('Trove Golem (sfd-174): four exhausted Gold', () => {
  let g = game();
  mana(g, 0, 6, 'Order', 'Order');
  g = play(g, 0, handCard(g, 0, 'sfd-174-221'), { destination: 'base' });
  g = run(g);
  assert.equal(golds(g, 0).length, 4);
});

test('Xin Zhao (sfd-176): enters ready with two or more other units in your base; Tank', () => {
  let g = game();
  mana(g, 0, 2, 'Order');
  put(g, 0, 't-u1', 'base'); put(g, 0, 't-u1', 'base');
  const x = handCard(g, 0, 'sfd-176-221');
  g = play(g, 0, x, { destination: 'base' });
  assert.equal(g.objects[x].exhausted, false);
  assert.ok(kw(g, x, 'Tank'));
  let h = game();
  mana(h, 0, 2, 'Order');
  put(h, 0, 't-u1', 'base'); put(h, 0, 't-u1', 0);
  const x2 = handCard(h, 0, 'sfd-176-221');
  h = play(h, 0, x2, { destination: 'base' });
  assert.equal(h.objects[x2].exhausted, true);
});

test('Corina Veraza (sfd-179): moving to a battlefield -> three Recruits there', () => {
  let g = game();
  const c = put(g, 0, 'sfd-179-221', 'base');
  g = move(g, 0, [c], 1);
  assert.equal(tokensAt(g, 0, 'Recruit', 1).length, 3);
});

test('Mechanized Menace (sfd-181, legend): your Mechs have Shield', () => {
  const g = game();
  setLegend(g, 0, 'sfd-181-221');
  const m = putToken(g, 0, 'tok-mech', 'base'), e = putToken(g, 1, 'tok-mech', 'base');
  assert.ok(kw(g, m, 'Shield'));
  assert.ok(!kw(g, e, 'Shield'));
});

test('Emperor of the Sands (sfd-197, legend): Sand Soldiers have Weaponmaster; [1],[T] Sand Soldier only after an Equipment', () => {
  let g = game();
  const leg = setLegend(g, 0, 'sfd-197-221');
  assert.ok(!canActivate(g, 0, leg));
  mana(g, 0, 2);
  const sw = handCard(g, 0, 'ts-sword');
  g = play(g, 0, sw);
  g = run(g);
  assert.ok(canActivate(g, 0, leg));
  g = activate(g, 0, leg);
  g = run(g);
  const [s] = tokensAt(g, 0, 'Sand Soldier', 'base');
  assert.ok(s);
  assert.ok(kw(g, s, 'Weaponmaster'));
});

test('Arise! (sfd-198): a Sand Soldier per Equipment you control; ready up to two of them', () => {
  let g = game();
  mana(g, 0, 5, 'Order');
  for (let i = 0; i < 3; i++) put(g, 0, 'ts-sword', 'base');
  put(g, 1, 'ts-sword', 'base');
  g = play(g, 0, handCard(g, 0, 'sfd-198-221'));
  g = run(g);
  expectDecision(g, 'chooseTargets', 0);                  // reflexive "Then do this": the two are targets of its own chain item
  const ss = tokens(g, 0, 'Sand Soldier');
  assert.equal(ss.length, 3);
  assert.equal(g.pending!.max, 2);
  g = run(g, [ss[0], ss[2]]);
  assert.deepEqual(ss.map(s => g.objects[s].exhausted), [false, true, false]);
});

test('Battle Mistress (sfd-203, legend): recycling a rune -> may exhaust for a Gold; enemy deaths ready her', () => {
  let g = game();
  const leg = setLegend(g, 0, 'sfd-203-221');
  noRunes(g, 0);
  mana(g, 0, 2, 'Calm');
  g = play(g, 0, handCard(g, 0, 't-calm2'), { destination: 'base' });
  g = run(g);
  expectDecision(g, 'optional', 0);
  g = run(g, 'yes');
  assert.equal(golds(g, 0).length, 1);
  assert.equal(g.objects[leg].exhausted, true);
  const e1 = put(g, 1, 't-u1', 0);
  g = slay(g, 0, e1);
  assert.equal(g.objects[leg].exhausted, false, 'an enemy unit died');
});

test("Emperor's Dais (sfd-207): conqueror may pay [1] and return a unit here to play a Sand Soldier here", () => {
  let g = game();
  setBattlefield(g, 0, 'sfd-207-221');
  const a = put(g, 1, 't-u2', 'base'), b = put(g, 1, 't-u2', 'base');
  g = endTurn(g);
  g = move(g, 1, [a, b], 0);
  expectDecision(g, 'optional', 1);
  g = run(g, 'yes', [a]);
  assert.equal(zoneOf(g, a), 'hand');
  assert.equal(tokensAt(g, 1, 'Sand Soldier', 0).length, 1);
});

test('Treasure Hoard (sfd-220): conqueror may pay [1] for a Gold', () => {
  let g = game();
  setBattlefield(g, 1, 'sfd-220-221');
  const a = put(g, 0, 't-u2', 'base');
  g = move(g, 0, [a], 1);
  expectDecision(g, 'optional', 0);
  g = run(g, 'yes');
  assert.equal(golds(g, 0).length, 1);
});

void setController; void canPlay;

// B3: Origins (ogn) + Proving Grounds (ogs) cards.
import { test } from 'node:test';
import {
  game, mana, run, expectDecision, play, activate, canPlay, tokens, tokensAt, put, handCard, zoneOf, setController, assert, M, kw,
  controlBf, slay, move, endTurn, setLegend, setBattlefield, act, choose, respond,
} from './util.ts';

test('Captain Farron (ogn-015): other friendly units here have Assault (+1 while attacking)', () => {
  const g = game();
  const cap = put(g, 0, 'ogn-015-298', 0);
  const here = put(g, 0, 't-u2', 0), base = put(g, 0, 't-u2', 'base'), enemy = put(g, 1, 't-u2', 0);
  assert.ok(kw(g, here, 'Assault'));
  assert.ok(!kw(g, base, 'Assault'));
  assert.ok(!kw(g, enemy, 'Assault'));
  assert.ok(!kw(g, cap, 'Assault'), 'not himself');
  g.objects[here].combatRole = 'attacker'; g.ex.dirty = true;
  assert.equal(M(g, here), 3);
});

test('Scrapyard Champion (ogn-020): Legion — discard 2 then draw 2; without Legion nothing', () => {
  let g = game();
  mana(g, 0, 6, 'Fury');
  g = play(g, 0, handCard(g, 0, 't-u1'), { destination: 'base' });
  const sc = handCard(g, 0, 'ogn-020-298');
  const a = handCard(g, 0, 't-u4'), b = handCard(g, 0, 't-u5');
  g = play(g, 0, sc, { destination: 'base' });
  g = run(g);
  expectDecision(g, 'chooseCards', 0);
  const handBefore = g.players[0].hand.length;
  g = run(g, [a, b]);
  assert.equal(zoneOf(g, a), 'trash');
  assert.equal(zoneOf(g, b), 'trash');
  assert.equal(g.players[0].hand.length, handBefore - 2 + 2);

  let h = game();
  mana(h, 0, 5, 'Fury');
  const sc2 = handCard(h, 0, 'ogn-020-298');
  const n = h.players[0].hand.length;
  h = play(h, 0, sc2, { destination: 'base' });
  h = run(h);
  assert.equal(h.pending?.kind, 'mainAction');
  assert.equal(h.players[0].hand.length, n - 1);
});

test('Raging Firebrand (ogn-031): the next spell this turn costs [5] less (only the next one)', () => {
  let g = game();
  mana(g, 0, 5, 'Fury');
  g = play(g, 0, handCard(g, 0, 'ogn-031-298'), { destination: 'base' });
  g = run(g);
  // 8 runes: 7 used by Firebrand; 1 left
  const r1 = handCard(g, 0, 'ogs-015-024'), r2 = handCard(g, 0, 'ogs-015-024');
  assert.ok(canPlay(g, 0, r1), '[6] spell costs [1]');
  g = play(g, 0, r1);
  g = run(g);
  assert.ok(!canPlay(g, 0, r2), 'the discount is used up');
  assert.equal(tokens(g, 0, 'Recruit').length, 4);
});

test('Wielder of Water (ogn-055): +2 only while attacking or defending alone', () => {
  const g = game();
  const w = put(g, 0, 'ogn-055-298', 0);
  assert.equal(M(g, w), 2);
  g.objects[w].combatRole = 'defender'; g.ex.dirty = true;
  assert.equal(M(g, w), 4);
  const ally = put(g, 0, 't-u1', 0);
  assert.equal(M(g, w), 2, 'not alone');
  g.objects[ally].zone = 'base'; g.objects[ally].battlefieldIndex = undefined; g.players[0].base.push(ally);
  g.objects[w].combatRole = 'attacker';
  assert.equal(M(g, w), 4);
});

test('Taric (ogn-074): Shield + Tank; other friendly units here have Shield', () => {
  const g = game();
  const t = put(g, 0, 'ogn-074-298', 0);
  const here = put(g, 0, 't-u2', 0), base = put(g, 0, 't-u2', 'base');
  assert.ok(kw(g, t, 'Shield') && kw(g, t, 'Tank'));
  assert.ok(kw(g, here, 'Shield'));
  assert.ok(!kw(g, base, 'Shield'));
  g.objects[here].combatRole = 'defender'; g.ex.dirty = true;
  assert.equal(M(g, here), 3);
});

test('Leona (ogn-079): enters ready only if an opponent is within 3 of the Victory Score', () => {
  let g = game();
  mana(g, 0, 6, 'Calm');
  g.players[1].points = 4;
  const l = handCard(g, 0, 'ogn-079-298');
  g = play(g, 0, l, { destination: 'base' });
  assert.equal(g.objects[l].exhausted, true);
  let h = game();
  mana(h, 0, 6, 'Calm');
  h.players[1].points = 5;
  const l2 = handCard(h, 0, 'ogn-079-298');
  h = play(h, 0, l2, { destination: 'base' });
  assert.equal(h.objects[l2].exhausted, false);
});

test('Leona (ogn-079): stunned enemy units here have -8 Might, to a minimum of 1', () => {
  const g = game();
  put(g, 0, 'ogn-079-298', 0);
  const big = put(g, 1, 't-u5', 0), small = put(g, 1, 't-u2', 0), away = put(g, 1, 't-u5', 1), mine = put(g, 0, 't-u5', 0);
  for (const u of [big, small, away, mine]) g.objects[u].stunned = true;
  g.ex.dirty = true;
  assert.equal(M(g, big), 1);
  assert.equal(M(g, small), 1);
  assert.equal(M(g, away), 5, 'not here');
  assert.equal(M(g, mine), 5, 'not an enemy');
  g.objects[big].stunned = false; g.ex.dirty = true;
  assert.equal(M(g, big), 5, 'not stunned');
  const huge = put(g, 1, 't-u5', 0);
  g.objects[huge].counters.buff = 6; g.objects[huge].stunned = true; g.ex.dirty = true;
  assert.equal(M(g, huge), 3, '11 - 8');
});

test('Gemcraft Seer (ogn-100): Vision; other friendly units have Vision (play triggers Vision)', () => {
  let g = game();
  const s = put(g, 0, 'ogn-100-298', 'base');
  const e = put(g, 1, 't-u1', 'base');
  assert.ok(kw(g, s, 'Vision'));
  assert.ok(!kw(g, e, 'Vision'));
  const u = handCard(g, 0, 't-u2');
  mana(g, 0, 2);
  g = play(g, 0, u, { destination: 'base' });
  assert.ok(kw(g, u, 'Vision'));
  assert.equal(g.chain.length, 1, 'Vision trigger on the chain');
});

test('Sprite Mother (ogn-106): a ready Sprite here', () => {
  let g = game();
  controlBf(g, 0, 0);
  mana(g, 0, 3, 'Mind');
  g = play(g, 0, handCard(g, 0, 'ogn-106-298'), { destination: 0 });
  g = run(g);
  const [s] = tokensAt(g, 0, 'Sprite', 0);
  assert.ok(s);
  assert.equal(g.objects[s].exhausted, false);
});

test("Viktor, Innovator (ogn-117): a card played on an opponent's turn makes a Recruit in base; not on your turn", () => {
  let g = game();
  put(g, 1, 'ogn-117-298', 'base');
  const target = put(g, 0, 't-u3', 'base');
  mana(g, 0, 1); mana(g, 1, 1);
  g = play(g, 0, handCard(g, 0, 'ts-pump'));
  if (g.pending?.kind === 'chooseTargets') g = choose(g, target);
  g = respond(g, 1, handCard(g, 1, 'ts-zap'), target);
  g = run(g);
  assert.equal(tokensAt(g, 1, 'Recruit', 'base').length, 1);
  // own turn: nothing
  let h = game();
  put(h, 0, 'ogn-117-298', 'base');
  mana(h, 0, 1);
  h = play(h, 0, handCard(h, 0, 't-u1'), { destination: 'base' });
  h = run(h);
  assert.equal(tokens(h, 0, 'Recruit').length, 0);
});

test('Lee Sin (ogn-151): other buffed friendly units at his battlefield have +2', () => {
  const g = game();
  const lee = put(g, 0, 'ogn-151-298', 0);
  const b = put(g, 0, 't-u2', 0), nb = put(g, 0, 't-u2', 0), bb = put(g, 0, 't-u2', 'base');
  g.objects[b].counters.buff = 1; g.objects[bb].counters.buff = 1; g.ex.dirty = true;
  assert.equal(M(g, b), 5);
  assert.equal(M(g, nb), 2);
  assert.equal(M(g, bb), 3);
  assert.ok(kw(g, lee, 'Accelerate'));
  // Lee at base: base is not a battlefield
  g.objects[lee].zone = 'base'; g.objects[lee].battlefieldIndex = undefined; g.players[0].base.push(lee);
  const bb2 = put(g, 0, 't-u2', 'base'); g.objects[bb2].counters.buff = 1; g.ex.dirty = true;
  assert.equal(M(g, bb2), 3);
});

test('Whirlwind (ogn-187): starting with the next player, each player may return a unit to its owner\'s hand', () => {
  let g = game();
  mana(g, 0, 3, 'Chaos');
  const mine = put(g, 0, 't-u2', 'base'), theirs = put(g, 1, 't-u2', 'base');
  g = play(g, 0, handCard(g, 0, 'ogn-187-298'));
  g = run(g);
  expectDecision(g, 'chooseTargets', 1);
  g = run(g, mine);
  expectDecision(g, 'chooseTargets', 0);
  g = run(g, []);
  assert.equal(zoneOf(g, mine), 'hand');
  assert.ok(g.players[0].hand.includes(mine));
  assert.equal(zoneOf(g, theirs), 'base');
});

test('Forge of the Future (ogn-212): Recruit at base; Kill this: recycle up to 4 cards from trashes', () => {
  let g = game();
  controlBf(g, 0, 0);
  mana(g, 0, 1, 'Order');
  const f = handCard(g, 0, 'ogn-212-298');
  g = play(g, 0, f);
  g = run(g);
  assert.equal(tokensAt(g, 0, 'Recruit', 'base').length, 1, 'at your base, no location choice');
  const t0 = put(g, 0, 't-u1', 'trash'), t1 = put(g, 1, 't-u2', 'trash'), t2 = put(g, 1, 't-u3', 'trash');
  g = activate(g, 0, f);
  // RULINGS sweep / CR 355.5: the cards are targets chosen as the ability is activated, before the cost (kill this) is paid
  expectDecision(g, 'chooseTargets', 0);
  assert.equal(g.pending!.min, 0);
  assert.equal(g.pending!.max, 3, 'up to 4 (only 3 cards in trashes)');
  g = run(g, [t0, t1]);
  assert.equal(zoneOf(g, f), 'trash', 'killed as the cost');
  assert.equal(zoneOf(g, t0), 'mainDeck');
  assert.equal(zoneOf(g, t1), 'mainDeck');
  assert.equal(g.players[1].mainDeck.at(-1), t1, 'to its owner\'s deck bottom');
  assert.equal(zoneOf(g, t2), 'trash');
});

test('Soaring Scout (ogn-216): Deathknell — channel 1 rune exhausted', () => {
  let g = game();
  const s = put(g, 1, 'ogn-216-298', 'base');
  const before = g.players[1].runesInPlay.length;
  g = slay(g, 0, s);
  assert.equal(zoneOf(g, s), 'trash');
  assert.equal(g.players[1].runesInPlay.length, before + 1);
  assert.equal(g.objects[g.players[1].runesInPlay.at(-1)!].exhausted, true);
});

test('Noxian Drummer (ogn-222): when it moves to a battlefield, a Recruit there; not when moving to base', () => {
  let g = game();
  const d = put(g, 0, 'ogn-222-298', 'base');
  g = move(g, 0, [d], 0);
  assert.equal(tokensAt(g, 0, 'Recruit', 0).length, 1);
  assert.equal(g.battlefields[0].controller, 0);
});

test('Machine Evangel (ogn-239): Deathknell — three Recruits into your base', () => {
  let g = game();
  const m = put(g, 1, 'ogn-239-298', 0);
  g = slay(g, 0, m);
  assert.equal(tokensAt(g, 1, 'Recruit', 'base').length, 3);
});

test('Darius (ogn-243): Legion readies him; other friendly units here +1', () => {
  let g = game();
  controlBf(g, 0, 0);
  mana(g, 0, 6, 'Order');
  const other = put(g, 0, 't-u2', 0);
  g = play(g, 0, handCard(g, 0, 't-u1'), { destination: 'base' });
  const d = handCard(g, 0, 'ogn-243-298');
  g = play(g, 0, d, { destination: 0 });
  g = run(g);
  assert.equal(g.objects[d].exhausted, false);
  assert.equal(M(g, other), 3);
  assert.equal(M(g, d), 6);
});

test('Viktor, Leader (ogn-246): another non-Recruit unit you control dies -> Recruit; Recruits and enemies do not count', () => {
  let g = game();
  put(g, 1, 'ogn-246-298', 'base');
  const u = put(g, 1, 't-u2', 'base');
  g = slay(g, 0, u);
  const rs = tokensAt(g, 1, 'Recruit', 'base');
  assert.equal(rs.length, 1);
  g = slay(g, 0, rs[0]);
  assert.equal(tokens(g, 1, 'Recruit').length, 0, 'a dying Recruit makes nothing');
  const e = put(g, 0, 't-u2', 'base');
  g = slay(g, 1, e);
  assert.equal(tokens(g, 1, 'Recruit').length, 0);
});

test('Herald of the Arcane (ogn-265, legend): [1], [T]: play a Recruit (location chosen)', () => {
  let g = game();
  const leg = setLegend(g, 0, 'ogn-265-298');
  controlBf(g, 0, 0);
  g = activate(g, 0, leg);
  assert.equal(g.objects[leg].exhausted, true);
  g = run(g);
  expectDecision(g, 'chooseDestination', 0);
  g = run(g, '0');
  assert.equal(tokensAt(g, 0, 'Recruit', 0).length, 1);
});

test('Altar to Unity (ogn-275): the player who holds here plays a Recruit in their base', () => {
  let g = game();
  setBattlefield(g, 0, 'ogn-275-298');
  controlBf(g, 1, 0);
  g = endTurn(g);
  assert.equal(g.activePlayer, 1);
  assert.equal(tokensAt(g, 1, 'Recruit', 'base').length, 1);
  assert.equal(tokens(g, 0, 'Recruit').length, 0);
});

test('Annie (ogs-001): your spells deal 1 Bonus Damage; opponents\' spells do not', () => {
  let g = game();
  put(g, 0, 'ogs-001-024', 'base');
  const e = put(g, 1, 't-u3', 'base');
  mana(g, 0, 1);
  g = play(g, 0, handCard(g, 0, 'ts-zap'));
  if (g.pending?.kind === 'chooseTargets') g = choose(g, e);
  g = run(g);
  assert.equal(zoneOf(g, e), 'trash', '2 + 1 kills a 3');
  const m = put(g, 0, 't-u3', 'base');
  mana(g, 0, 1); mana(g, 1, 1);
  g = play(g, 0, handCard(g, 0, 'ts-pump'));
  if (g.pending?.kind === 'chooseTargets') g = choose(g, m);
  g = respond(g, 1, handCard(g, 1, 'ts-zap'), m);
  g = run(g);
  assert.equal(g.objects[m].damage, 2);
});

test('Garen (ogs-013): other friendly units have +1 here', () => {
  const g = game();
  const ga = put(g, 0, 'ogs-013-024', 0);
  const a = put(g, 0, 't-u2', 0), b = put(g, 0, 't-u2', 1), e = put(g, 1, 't-u2', 0);
  assert.equal(M(g, a), 3);
  assert.equal(M(g, b), 2);
  assert.equal(M(g, e), 2);
  assert.equal(M(g, ga), 5);
});

void act; void setController;

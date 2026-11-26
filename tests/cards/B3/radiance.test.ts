// B3: Radiance (rad) cards.
import { test } from 'node:test';
import { cardTiming } from '../../../src/engine/play.ts';
import {
  game, mana, run, expectDecision, play, activate, canPlay, canActivate, tokens, tokensAt, put, handCard, zoneOf, setController, assert, M, kw,
  controlBf, slay, move, endTurn, setLegend, setBattlefield, act, choose, noRunes, putToken,
} from './util.ts';

const bombs = (g: ReturnType<typeof game>, p: 0 | 1) => tokens(g, p, 'Bomb');
const golds = (g: ReturnType<typeof game>, p: 0 | 1) => tokens(g, p, 'Gold');

test('Amateur Demolitionist (rad-001): play a Bomb (Deploy gear) to a battlefield of your choice', () => {
  let g = game();
  mana(g, 0, 2, 'Chaos');
  g = play(g, 0, handCard(g, 0, 'rad-001-167'), { destination: 'base' });
  g = run(g);
  assert.deepEqual(expectDecision(g, 'chooseBattlefield', 0).sort(), ['0', '1']);
  g = run(g, '1');
  const [b] = bombs(g, 0);
  assert.equal(g.objects[b].battlefieldIndex, 1);
  assert.ok(kw(g, b, 'Deploy'));
  assert.equal(g.battlefields[1].controller, null, 'a gear does not contest');
});

test('Rally for War (rad-007): three Recruits at an occupied enemy battlefield; unplayable without one', () => {
  let g = game();
  mana(g, 0, 2, 'Fury');
  const rally = handCard(g, 0, 'rad-007-167');
  assert.ok(!canPlay(g, 0, rally), 'no occupied enemy battlefield');
  controlBf(g, 1, 0, 't-u1');
  setController(g, 1, 1); // controlled but empty: not occupied
  g = play(g, 0, rally);
  g = run(g);
  // three Recruits arrive and fight the 1 Might defender: one Recruit dies, the defender dies, Recruits conquer
  assert.equal(tokensAt(g, 0, 'Recruit', 0).length, 2);
  assert.equal(g.battlefields[0].controller, 0);
});

test('Antagonistic Apparatus (rad-009): enters ready; a ready Mech here', () => {
  let g = game();
  controlBf(g, 0, 0);
  mana(g, 0, 7);
  const a = handCard(g, 0, 'rad-009-167');
  g = play(g, 0, a, { destination: 0 });
  assert.equal(g.objects[a].exhausted, false);
  g = run(g);
  const [m] = tokensAt(g, 0, 'Mech', 0);
  assert.ok(m);
  assert.equal(g.objects[m].exhausted, false);
  assert.equal(M(g, m), 3);
});

test('Incorrigible Construct (rad-011): Show Off a Mech -> enters ready; otherwise exhausted', () => {
  let g = game();
  mana(g, 0, 4);
  const c = handCard(g, 0, 'rad-011-167');
  g = play(g, 0, c, { destination: 'base' });
  assert.equal(g.objects[c].exhausted, true);
  let h = game();
  mana(h, 0, 4);
  const mech = putToken(h, 0, 'tok-mech', 'base');
  const c2 = handCard(h, 0, 'rad-011-167');
  h = play(h, 0, c2, { destination: 'base' });
  expectDecision(h, 'chooseCards', 0);
  assert.equal(h.pending!.min, 0, 'showing off is optional');
  h = choose(h, mech);
  assert.equal(h.objects[c2].exhausted, false);
});

test('Whirling Twirligig (rad-022): three token abilities with their costs', () => {
  let g = game();
  const w = put(g, 0, 'rad-022-167', 'base');
  mana(g, 0, 0);
  g = activate(g, 0, w, 0);
  g = run(g);
  const [gold] = golds(g, 0);
  assert.ok(gold);
  assert.equal(g.objects[gold].exhausted, true, 'Gold played exhausted');
  g.objects[w].exhausted = false;
  g = activate(g, 0, w, 1);       // kill a friendly gear (only the Gold qualifies: not itself)
  g = run(g);
  assert.equal(zoneOf(g, gold), 'gone');
  assert.equal(tokens(g, 0, 'Recruit').length, 1);
  g.objects[w].exhausted = false;
  const [rec] = tokens(g, 0, 'Recruit');
  g = activate(g, 0, w, 2);
  g = run(g);
  assert.equal(zoneOf(g, rec), 'gone', 'killed a friendly unit as the cost');
  assert.equal(tokens(g, 0, 'Mech').length, 1);
  g.objects[w].exhausted = false;
  assert.ok(!canActivate(g, 0, w, 1), 'no other friendly gear to kill');
});

test('Ziggs, Short-Fused (rad-023): plays a Bomb; abilities of friendly gear deal 1 Bonus Damage (Bomb: 2+1)', () => {
  let g = game();
  mana(g, 0, 4, 'Fury', 'Chaos');
  g = play(g, 0, handCard(g, 0, 'rad-023-167'), { destination: 'base' });
  g = run(g, '0');
  const [b] = bombs(g, 0);
  assert.equal(g.objects[b].battlefieldIndex, 0);
  const e = put(g, 1, 't-u3', 0);
  g = play(g, 0, handCard(g, 0, 'rad-142-167'));      // Hexplosive Minefield: kill the Bomb
  g = run(g, [b]);
  assert.equal(zoneOf(g, e), 'trash', 'Bomb dealt 3 (2 + 1 Bonus)');
});

test('Watchful Curator (rad-037): your gear have Deflect (not units, not enemy gear)', () => {
  const g = game();
  put(g, 0, 'rad-037-167', 'base');
  const mine = put(g, 0, 'ogn-212-298', 'base'), theirs = put(g, 1, 'ogn-212-298', 'base'), u = put(g, 0, 't-u1', 'base');
  assert.ok(kw(g, mine, 'Deflect'));
  assert.ok(!kw(g, theirs, 'Deflect'));
  assert.ok(!kw(g, u, 'Deflect'));
});

test('Ephemeral Ward (rad-039): your units +2; when you play a unit, kill this', () => {
  let g = game();
  const w = put(g, 0, 'rad-039-167', 'base');
  const u = put(g, 0, 't-u2', 'base'), e = put(g, 1, 't-u2', 'base');
  assert.equal(M(g, u), 4);
  assert.equal(M(g, e), 2);
  mana(g, 0, 1);
  g = play(g, 0, handCard(g, 0, 't-u1'), { destination: 'base' });
  g = run(g);
  assert.equal(zoneOf(g, w), 'trash');
  assert.equal(M(g, u), 2);
});

test('Heartening Soul (rad-040): readies a friendly legend; friendly legends gain "[T]: +3 to a unit"', () => {
  let g = game();
  const leg = g.players[0].legend;
  g.objects[leg].exhausted = true;
  mana(g, 0, 6, 'Calm');
  const hs = handCard(g, 0, 'rad-040-167');
  g = play(g, 0, hs, { destination: 'base' });
  g = run(g);
  assert.equal(g.objects[leg].exhausted, false, 'legend readied');
  assert.ok(!canActivate(g, 1, g.players[1].legend), 'enemy legend has no such ability');
  const u = put(g, 0, 't-u2', 'base');
  g = activate(g, 0, leg);
  if (g.pending?.kind === 'chooseTargets') g = choose(g, u);
  g = run(g);
  assert.equal(M(g, u), 5);
  assert.equal(g.objects[leg].exhausted, true);
});

test('Industrious Mechsmith (rad-049): a Mech here', () => {
  let g = game();
  mana(g, 0, 4);
  g = play(g, 0, handCard(g, 0, 'rad-049-167'), { destination: 'base' });
  g = run(g);
  assert.equal(tokensAt(g, 0, 'Mech', 'base').length, 1);
});

test('Resource Extractor (rad-052): end of your turn, if you control its battlefield, a Gold', () => {
  let g = game();
  controlBf(g, 0, 0);
  put(g, 0, 'rad-052-167', 0);
  put(g, 0, 'rad-052-167', 1);
  g = endTurn(g);
  assert.equal(golds(g, 0).length, 1, 'only the one at the controlled battlefield');
  g = endTurn(g);
  assert.equal(golds(g, 0).length, 1, 'not at the end of the opponent turn');
});

test('Clanging Sentry (rad-055): your Mechs have Disarm', () => {
  const g = game();
  put(g, 0, 'rad-055-167', 'base');
  const m = putToken(g, 0, 'tok-mech', 'base'), o = put(g, 0, 't-u2', 'base'), em = putToken(g, 1, 'tok-mech', 'base');
  assert.ok(kw(g, m, 'Disarm'));
  assert.ok(!kw(g, o, 'Disarm'));
  assert.ok(!kw(g, em, 'Disarm'));
});

test("Kai'Sa (rad-063): Disarm; while she is in a showdown your spells have Reaction", () => {
  const g = game();
  const k = put(g, 0, 'rad-063-167', 0);
  assert.ok(kw(g, k, 'Disarm'));
  const s = handCard(g, 0, 'ogs-015-024');   // an [Action] spell
  assert.equal(cardTiming(g, 0, s), 'action');
  g.showdown = { battlefieldIndex: 0, focus: 0, passes: [], isCombat: false };
  assert.equal(cardTiming(g, 0, s), 'reaction');
  assert.equal(cardTiming(g, 1, handCard(g, 1, 'ogs-015-024')), 'action', 'only your spells');
  g.showdown = { battlefieldIndex: 1, focus: 0, passes: [], isCombat: false };
  assert.equal(cardTiming(g, 0, s), 'action', 'showdown elsewhere');
});

test('Disposal Expert (rad-093): enters ready only if you control no other units; Disarm 2', () => {
  let g = game();
  mana(g, 0, 4);
  const d = handCard(g, 0, 'rad-093-167');
  g = play(g, 0, d, { destination: 'base' });
  assert.equal(g.objects[d].exhausted, false);
  assert.equal(g.objects[d] && kw(g, d, 'Disarm'), true);
  let h = game();
  mana(h, 0, 4);
  put(h, 0, 't-u1', 'base');
  const d2 = handCard(h, 0, 'rad-093-167');
  h = play(h, 0, d2, { destination: 'base' });
  assert.equal(h.objects[d2].exhausted, true);
});

test('Explosimian (rad-094): when it holds, three Bombs to a single battlefield', () => {
  let g = game();
  controlBf(g, 1, 0, 'rad-094-167');
  g = endTurn(g);
  expectDecision(g, 'chooseBattlefield', 1);
  g = run(g, '1');
  const bs = bombs(g, 1);
  assert.equal(bs.length, 3);
  assert.ok(bs.every(b => g.objects[b].battlefieldIndex === 1));
});

test('Satchel Charge (rad-096): move a friendly unit, then a Bomb to a battlefield', () => {
  let g = game();
  mana(g, 0, 2, 'Chaos');
  const u = put(g, 0, 't-u2', 'base');
  g = play(g, 0, handCard(g, 0, 'rad-096-167'));
  g = run(g);
  assert.deepEqual(expectDecision(g, 'chooseDestination', 0).sort(), ['0', '1'], 'not its own location');
  g = run(g, '1');
  assert.equal(g.objects[u].battlefieldIndex, 1);
  expectDecision(g, 'chooseBattlefield', 0);
  g = run(g, '0');
  assert.equal(g.objects[bombs(g, 0)[0]].battlefieldIndex, 0);
});

test("The Waters' Wage (rad-100): one exhausted Gold; three ready Gold if played from face down on your turn", () => {
  let g = game();
  mana(g, 0, 1);
  g = play(g, 0, handCard(g, 0, 'rad-100-167'));
  g = run(g);
  assert.equal(golds(g, 0).length, 1);
  assert.equal(g.objects[golds(g, 0)[0]].exhausted, true);

  let h = game();
  controlBf(h, 0, 0);
  mana(h, 0, 1);
  const w = handCard(h, 0, 'rad-100-167');
  h = act(h, { type: 'hide', player: 0, obj: w, battlefieldIndex: 0 });
  h = run(h);
  h = endTurn(h);
  h = endTurn(h);
  assert.equal(h.activePlayer, 0);
  h = play(h, 0, w);
  h = run(h);
  const gs = golds(h, 0);
  assert.equal(gs.length, 3);
  assert.ok(gs.every(x => !h.objects[x].exhausted));
});

test("An Offer You Can't Refuse (rad-101): kill a gear; its controller plays an exhausted Gold", () => {
  let g = game();
  mana(g, 0, 2);
  const gear = put(g, 1, 'ogn-212-298', 'base');
  g = play(g, 0, handCard(g, 0, 'rad-101-167'));
  if (g.pending?.kind === 'chooseTargets') g = choose(g, gear);
  g = run(g);
  assert.equal(zoneOf(g, gear), 'trash');
  assert.equal(golds(g, 1).length, 1);
  assert.equal(golds(g, 0).length, 0);
});

test('Reckless Innovator (rad-105): when it becomes exhausted, choose Gold or pay [C] to draw', () => {
  let g = game();
  mana(g, 0, 0, 'Chaos');
  const r = put(g, 0, 'rad-105-167', 'base');
  assert.ok(kw(g, r, 'Accelerate'));
  g = move(g, 0, [r], 0);
  assert.equal(g.objects[r].exhausted, true);
  // R-1 (CR 403.2): the mode is chosen as the trigger goes on the chain; the [C] is paid (or declined) on resolution
  const opts = expectDecision(g, 'chooseMode', 0);
  assert.deepEqual(opts.sort(), ['draw', 'gold']);
  const hand = g.players[0].hand.length;
  g = run(g, 'draw', 'yes');
  assert.equal(g.players[0].hand.length, hand + 1);
  // can't pay [C]: both modes are still offered (rulings B3); the draw is skipped on resolution
  let h = game();
  noRunes(h, 0);
  const r2 = put(h, 0, 'rad-105-167', 'base');
  h = move(h, 0, [r2], 0);
  expectDecision(h, 'chooseMode', 0);
  const hand2 = h.players[0].hand.length;
  h = run(h, 'draw');
  assert.equal(h.players[0].hand.length, hand2);
  assert.equal(golds(h, 0).length, 0);
  let k = game();
  const r3 = put(k, 0, 'rad-105-167', 'base');
  k = move(k, 0, [r3], 0, 'gold');
  assert.equal(golds(k, 0).length, 1);
});

test('Ziggs, Explosive (rad-112): [1],[T] Bomb; when he defends, may kill a friendly gear for +2', () => {
  let g = game();
  const z = put(g, 0, 'rad-112-167', 'base');
  g = activate(g, 0, z, 0);
  g = run(g, '0');
  assert.equal(bombs(g, 0).length, 1);

  let h = game();
  controlBf(h, 1, 0);
  const z2 = put(h, 1, 'rad-112-167', 0);
  const gear = put(h, 1, 'ogn-212-298', 'base');
  const atk = put(h, 0, 't-u5', 'base');
  h = move(h, 0, [atk], 0);
  expectDecision(h, 'optional', 1);
  h = run(h, 'yes');
  assert.equal(zoneOf(h, gear), 'trash');
  assert.ok(M(h, z2) === 6 || zoneOf(h, z2) !== 'battlefield');
});

test('Concert Poster (rad-116): Deploy; may pay [1] for a Recruit on play and when you conquer here', () => {
  let g = game();
  mana(g, 0, 2);
  const p = handCard(g, 0, 'rad-116-167');
  g = play(g, 0, p, { destination: 1 });
  assert.equal(g.objects[p].battlefieldIndex, 1);
  g = run(g);
  expectDecision(g, 'optional', 0);
  g = run(g, 'yes');
  assert.equal(tokensAt(g, 0, 'Recruit', 'base').length, 1);
  const u = put(g, 0, 't-u2', 'base');
  g = move(g, 0, [u], 1);
  expectDecision(g, 'optional', 0);
  g = run(g, 'no');
  assert.equal(tokens(g, 0, 'Recruit').length, 1, 'declined');
  assert.equal(g.battlefields[1].controller, 0);
});

test('Hunting Dog (rad-119): Deathknell — a Bird with Deflect to your base', () => {
  let g = game();
  const d = put(g, 1, 'rad-119-167', 0);
  g = slay(g, 0, d);
  const [b] = tokensAt(g, 1, 'Bird', 'base');
  assert.ok(b);
  assert.ok(kw(g, b, 'Deflect'));
  assert.equal(M(g, b), 1);
});

test('Rousing Display (rad-127): two Recruits; four if you showed off a [7]+ card', () => {
  let g = game();
  mana(g, 0, 5);
  const big = handCard(g, 0, 'rad-040-167');
  g = play(g, 0, handCard(g, 0, 'rad-127-167'));
  expectDecision(g, 'chooseCards', 0);
  g = run(g, [big]);
  assert.equal(tokensAt(g, 0, 'Recruit', 'base').length, 4);
  let h = game();
  mana(h, 0, 5);
  handCard(h, 0, 'rad-040-167');
  h = play(h, 0, handCard(h, 0, 'rad-127-167'));
  h = run(h, []);
  assert.equal(tokensAt(h, 0, 'Recruit', 'base').length, 2);
});

test('Heimerdinger (rad-132): while at a battlefield, you may play a Mech instead of a unit token', () => {
  let g = game();
  controlBf(g, 0, 0);
  put(g, 0, 'rad-132-167', 0);
  mana(g, 0, 3);
  g = play(g, 0, handCard(g, 0, 'ogn-211-298'), { destination: 'base' });
  g = run(g);
  expectDecision(g, 'optional', 0);
  g = run(g, 'yes');
  assert.equal(tokensAt(g, 0, 'Mech', 'base').length, 1, 'same location (base)');
  assert.equal(tokens(g, 0, 'Recruit').length, 0);
  // decline
  mana(g, 0, 3);
  g = play(g, 0, handCard(g, 0, 'ogn-211-298'), { destination: 'base' });
  g = run(g, 'no');
  assert.equal(tokens(g, 0, 'Recruit').length, 1);
  // at base: no replacement
  let h = game();
  put(h, 0, 'rad-132-167', 'base');
  mana(h, 0, 3);
  h = play(h, 0, handCard(h, 0, 'ogn-211-298'), { destination: 'base' });
  h = run(h);
  assert.equal(h.pending?.kind, 'mainAction');
  assert.equal(tokens(h, 0, 'Recruit').length, 1);
});

test('Seraphine (rad-138): Recruit on play and when she becomes exhausted; +1 per other exhausted unit', () => {
  let g = game();
  mana(g, 0, 5, 'Order');
  const s = handCard(g, 0, 'rad-138-167');
  g = play(g, 0, s, { destination: 'base' });
  g = run(g);
  const rs = tokensAt(g, 0, 'Recruit', 'base');
  assert.equal(rs.length, 1);
  assert.equal(M(g, s), 1 + 1, 'the exhausted Recruit counts');
  const e = put(g, 1, 't-u1', 'base', { ready: false });
  assert.equal(M(g, s), 2, 'enemy units do not count');
  g.objects[s].exhausted = false;
  g = move(g, 0, [s], 0);
  assert.equal(tokens(g, 0, 'Recruit').length, 2);
  void e;
});

test('Hexplosives Expert (rad-141, legend): [1][A], [T]: a Bomb', () => {
  let g = game();
  const leg = setLegend(g, 0, 'rad-141-167');
  noRunes(g, 0);
  assert.ok(!canActivate(g, 0, leg));
  mana(g, 0, 2);
  g = activate(g, 0, leg);
  g = run(g, '1');
  assert.equal(bombs(g, 0).length, 1);
});

test('Hexplosive Minefield (rad-142): kill chosen Bombs; at end of turn that many Bombs to one battlefield', () => {
  let g = game();
  mana(g, 0, 1, 'Chaos');
  const b1 = putToken(g, 0, 'tok-bomb', 0), b2 = putToken(g, 0, 'tok-bomb', 1), b3 = putToken(g, 0, 'tok-bomb', 1);
  const victim = put(g, 1, 't-u5', 1);
  for (const b of [b1, b2, b3]) g.objects[b].isToken = true;
  g = play(g, 0, handCard(g, 0, 'rad-142-167'));
  // RULINGS sweep / CR 355.5: the Bombs are targets chosen as the spell is played
  expectDecision(g, 'chooseTargets', 0);
  assert.equal(g.pending!.min, 0);
  g = run(g, [b1, b2], '0');       // + order the two Bomb triggers
  assert.equal(bombs(g, 0).length, 0, 'b1, b2 killed; b3 killed by b2 ("kill your other Bombs there")');
  assert.equal(g.objects[victim].damage, 4, 'b2 and then b3 dealt 2 each');
  g = endTurn(g, '0');
  assert.equal(bombs(g, 0).filter(b => g.objects[b].battlefieldIndex === 0).length, 2);
});

test('Encore (rad-152): choose two — deal 2 + two Recruits; +1 to up to two + look at 2 draw 1', () => {
  let g = game();
  mana(g, 0, 2, 'Mind');
  const e = put(g, 1, 't-u2', 'base');
  g = play(g, 0, handCard(g, 0, 'rad-152-167'));
  expectDecision(g, 'chooseMode', 0);
  assert.equal(g.pending!.min, 2);
  g = choose(g, 'deal', 'recruits');
  if (g.pending?.kind === 'chooseTargets') g = choose(g, e);
  g = run(g);
  assert.equal(zoneOf(g, e), 'trash');
  assert.equal(tokens(g, 0, 'Recruit').length, 2);

  let h = game();
  mana(h, 0, 2, 'Order');
  const a = put(h, 0, 't-u2', 'base'), b = put(h, 0, 't-u2', 'base');
  const top = h.players[0].mainDeck.slice(0, 2);
  h = play(h, 0, handCard(h, 0, 'rad-152-167'));
  h = choose(h, 'pump', 'look');
  h = choose(h, a, b);
  h = run(h);
  expectDecision(h, 'chooseCards', 0);
  h = run(h, [top[1]]);
  assert.equal(M(h, a), 3);
  assert.equal(M(h, b), 3);
  assert.equal(zoneOf(h, top[1]), 'hand');
  assert.equal(h.players[0].mainDeck.at(-1), top[0], 'the other is recycled');
  // RULINGS: "draw 1" from the looked-at cards is a draw (a draw event, so "when you draw" abilities see it), not a plain move
  const name = h.cards[h.objects[top[1]].cardId].name;
  assert.ok(h.log.some(l => /draws/.test(l.text) && l.text.includes(name)), 'the kept card was drawn');
});

test("Bandle Scouts' Academy (rad-157): hiding a card here makes an exhausted Gold", () => {
  let g = game();
  setBattlefield(g, 1, 'rad-157-167');
  controlBf(g, 0, 1);
  mana(g, 0, 1);
  const hid = handCard(g, 0, 'rad-100-167');
  g = act(g, { type: 'hide', player: 0, obj: hid, battlefieldIndex: 1 });
  g = run(g);
  assert.equal(golds(g, 0).length, 1);
});

test('Black Rose Sanctum (rad-159): first non-token unit of each player to die here each turn -> Recruit for them', () => {
  let g = game();
  setBattlefield(g, 0, 'rad-159-167');
  const t = putToken(g, 0, 'ven-t04', 0), a = put(g, 0, 't-u2', 0), b = put(g, 0, 't-u2', 0);
  g.objects[t].isToken = true;
  g = slay(g, 0, t);
  assert.equal(tokensAt(g, 0, 'Recruit', 'base').length, 0, 'a token dying does not count');
  g = slay(g, 0, a);
  assert.equal(tokensAt(g, 0, 'Recruit', 'base').length, 1);
  g = slay(g, 0, b);
  assert.equal(tokensAt(g, 0, 'Recruit', 'base').length, 1, 'only the first each turn');
  const c = put(g, 1, 't-u2', 0);
  g = slay(g, 0, c);
  assert.equal(tokensAt(g, 1, 'Recruit', 'base').length, 1, 'each player has their own first time');
  const away = put(g, 1, 't-u2', 1);
  g = slay(g, 0, away);
  assert.equal(tokensAt(g, 1, 'Recruit', 'base').length, 1, 'dying elsewhere does not count');
});

void setController;

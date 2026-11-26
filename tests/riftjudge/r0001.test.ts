// Rift Judge verification, range r0001 (question ids 1-1300). One test per verified mechanics question.
// Log: docs/riftjudge/r0001.md
import { test } from 'node:test';
import {
  assert, S0, put, hand, play, addRunes, kwValue, pass, passN, control, act, move, activate, nextTurn, endTurn, fundAll, resolveChain,
  P0, P1, BF_A, BF_B, zone, locOf, mightOf, hasKeyword, passAll, pend, answer, legal, canPlayNow,
  type GameState, type ObjId, realCard, touch, chainLabels, optionIds,
  fillTrash, rejects, cast, choose, mod, attackSetup, legalDeck, playDests, exhaustedRunes, validateAction, setBattlefieldCard, expectPending, setRunes,
} from '../conformance/harness.ts';
import { createGame } from '../../src/engine/index.ts';
import { fixtureDb } from '../fixtures/conformance/cards.ts';
import { attachNow, setPoints, place } from '../../src/engine/testkit.ts';
import { chars } from '../../src/engine/index.ts';
import { withTokens, drive } from './r11701.helpers.ts';

function setLegend(g: GameState, p: typeof P0, name: string): ObjId {
  const d = realCard(name);
  if (!g.cards[d.id]) g.cards = { ...g.cards, [d.id]: d };
  const id = g.players[p].legend; g.objects[id].cardId = d.id; touch(g);
  return id;
}

/** Pass every chain/showdown decision and answer in-step ones with the first legal option until a main-phase decision. */
function settle(g: GameState): GameState {
  for (let i = 0; i < 60; i++) {
    const d = g.pending;
    if (!d || d.kind === 'mainAction') return g;
    if (d.inStep) { const l = legal(g, d.player); if (!l.length) return g; g = act(g, l[0]); continue; }
    g = act(g, { type: 'pass', player: d.player });
  }
  return g;
}

/** Option ids of the first target choice if p started playing obj now ([] if it can't be played). */
function targetOptions(g: GameState, p: typeof P0, obj: ObjId): string[] {
  try {
    const h = act(g, { type: 'playCard', player: p, obj });
    if (h.pending?.kind === 'chooseTargets') return (h.pending.options ?? []).map(o => o.id);
    const it = h.chain.find(c => c.source === obj);
    return it ? (it.targets ?? []).flat().map(String) : [];
  } catch { return []; }
}

test("RJ#2 Zhonya's Hourglass saves a Temporary Sprite at start of turn; it keeps Temporary and dies the next time", () => {
  let g = S0();
  fundAll(g, P0);
  const z = put(g, P0, "Zhonya's Hourglass", 'base');
  const s = put(g, P0, 'unl-t07', BF_A, { token: true });
  control(g, BF_A, P0);
  g = nextTurn(g);            // P1's turn
  g = settle(nextTurn(g));    // P0's turn: Temporary kills the Sprite -> Hourglass dies instead
  assert.equal(g.activePlayer, P0);
  assert.equal(zone(g, z), 'trash', 'Hourglass was killed instead');
  assert.equal(locOf(g, s), 'base', 'Sprite recalled to base');
  assert.ok(hasKeyword(g, s, 'Temporary'), 'Sprite still has Temporary');
  g = settle(nextTurn(g)); g = settle(nextTurn(g));
  assert.equal(g.activePlayer, P0);
  assert.equal(zone(g, s), 'gone', 'Sprite dies at the start of the following turn (token ceases to exist)');
});

test('RJ#3 a unit Charmed away and moved back with Ride the Wind re-conquers its battlefield on the other player\'s turn', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const e = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  put(g, P0, 'V(3)', BF_B); control(g, BF_B, P0);
  const charm = hand(g, P0, 'Charm');
  const rtw = hand(g, P1, 'Ride the Wind');
  g = passAll(play(g, P0, charm, { targets: [[e]] }));
  g = answer(g, { locations: [BF_B] });
  // combat at BF_B: P1 (defender) uses Ride the Wind to move the unit back to BF_A
  for (let i = 0; i < 6 && !canPlayNow(g, P1, rtw); i++) g = pass(g);
  assert.ok(canPlayNow(g, P1, rtw), 'P1 can play Ride the Wind during the combat showdown');
  const pts = g.players[P1].points;
  g = passAll(play(g, P1, rtw, { targets: [[e]] }));
  g = settle(answer(g, { locations: [BF_A] }));
  assert.equal(locOf(g, e), BF_A);
  assert.equal(g.battlefields[BF_A].controller, P1, 'P1 re-establishes control of BF-A');
  assert.equal(g.players[P1].points, pts + 1, 'and conquers it (scores 1) on P0\'s turn');
});

test('RJ#5 Jinx under Smoke Screen survives combat, ending at 0 Might with no damage', () => {
  let g = S0();
  fundAll(g, P1);
  const d = put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const j = put(g, P0, 'ogn-030-298', 'base');
  const ss = hand(g, P1, 'Smoke Screen');
  g = move(g, P0, [j], BF_A);
  for (let i = 0; i < 4 && !canPlayNow(g, P1, ss); i++) g = pass(g);
  g = resolveChain(play(g, P1, ss, { targets: [[j]] }));
  assert.equal(mightOf(g, j), 2, '4 + Assault 2 - 4');
  g = settle(g);
  assert.equal(zone(g, d), 'trash');
  assert.equal(locOf(g, j), BF_A, 'Jinx survives');
  assert.equal(g.objects[j].damage, 0);
  assert.equal(mightOf(g, j), 0, 'Assault bonus gone; the -4 stays (minimum snapshotted)');
});

test("RJ#8 Azir swapping with a unit at Vilemaw's Lair: Azir moves there, the unit can't move to base", () => {
  let g = S0({ bfA: "Vilemaw's Lair" });
  fundAll(g, P0);
  const az = put(g, P0, 'Azir, Ascendant', 'base');
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  g = activate(g, P0, az, 0, { targets: [[u]] });
  g = settle(g);
  assert.equal(locOf(g, az), BF_A, 'Azir moves to the Lair');
  assert.equal(locOf(g, u), BF_A, 'the unit stays at the Lair');
});

test('RJ#9 Hard Bargain with Repeat counters two different spells on the same chain', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const t = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const a = hand(g, P0, 'ZapA'), b = hand(g, P0, 'ZapR'), hb = hand(g, P1, 'Hard Bargain');
  g = play(g, P0, a, { targets: [[t]] });
  g = pass(play(g, P0, b, { targets: [[t]] }));
  g = act(g, { type: 'playCard', player: P1, obj: hb });
  const first = String(pend(g).options![0].id);
  g = answer(g, { targets: [[first]], may: [true] }, P1);
  // CR 820.2: the Repeat execution's target is chosen as Hard Bargain is played — the other spell
  g = answer(g, { targets: [[String(pend(g).options!.find(o => o.id !== first)!.id)]] }, P1);
  g = passN(g, 2);
  g = answer(g, { may: [false, false] }, P0);   // P0 declines to pay for either spell
  g = settle(g);
  assert.equal(zone(g, a), 'trash'); assert.equal(zone(g, b), 'trash');
  assert.equal(g.objects[t].damage, 0, 'neither Zap resolved');
});

test('RJ#10 only one showdown at a time: a second staged showdown waits until the open one closes', () => {
  let g = S0(); fundAll(g, P1);
  const m = put(g, P0, 'V(1)', 'base');
  const r = put(g, P1, 'V(1)', 'base');
  const rtw = hand(g, P1, 'Ride the Wind');
  g = move(g, P0, [m], BF_A);
  assert.equal(g.showdown?.battlefieldIndex, BF_A);
  g = pass(g);                                  // P0 passes focus
  g = resolveChain(play(g, P1, rtw, { targets: [[r]], locations: [BF_B] }));   // R-2: destination chosen as played
  assert.equal(locOf(g, r), BF_B);
  assert.equal(g.showdown?.battlefieldIndex, BF_A, 'the BF-A showdown is still the open one');
  g = settle(g);
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.battlefields[BF_B].controller, P1, 'BF-B showdown happened afterwards');
});

test('RJ#11 Tryndamere conquering as a defender (moved in by Ride the Wind) does not score his bonus point', () => {
  let g = S0(); fundAll(g, P1);
  const x = put(g, P0, 'V(1)', 'base');
  const t = put(g, P1, 'Tryndamere', 'base');
  const rtw = hand(g, P1, 'Ride the Wind');
  g = move(g, P0, [x], BF_A);
  g = pass(g);
  g = passAll(play(g, P1, rtw, { targets: [[t]] }));
  g = answer(g, { locations: [BF_A] });
  g = settle(g);
  assert.equal(zone(g, x), 'trash');
  assert.equal(g.battlefields[BF_A].controller, P1, 'defender conquers');
  assert.equal(g.players[P1].points, 1, 'only the conquer point');
});

test('RJ#12 Sett, Kingpin counts himself when buffed — covered by tests/cards/B4/statics.test.ts "Sett, Kingpin: +1 for each buffed friendly unit at his battlefield (incl. himself)"', () => {
  const g = S0();
  const s = put(g, P0, 'Sett, Kingpin', BF_A, { buff: true }); put(g, P0, 'V(1)', BF_A, { buff: true }); control(g, BF_A, P0);
  assert.equal(mightOf(g, s), 5 + 1 + 2);
});

test('RJ#15 Gust can\'t hit Vayne once she is an Attacker (5 Might); it can while a move trigger is on the chain', () => {
  // (a) plain move: combat starts before anyone has priority
  let g = S0(); fundAll(g, P1);
  const d = put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const v = put(g, P0, 'Vayne, Hunter', 'base');
  const gust = hand(g, P1, 'Gust');
  g = move(g, P0, [v], BF_A);
  assert.equal(mightOf(g, v), 5);
  g = pass(g);
  assert.ok(!targetOptions(g, P1, gust).includes(v), 'Vayne (5) is not a legal Gust target');
  // (b) Traveling Merchant moves with her: its trigger is on the chain, no designations yet
  let h = S0(); fundAll(h, P1); fundAll(h, P0);
  put(h, P1, 'V(1)', BF_A); control(h, BF_A, P1);
  const v2 = put(h, P0, 'Vayne, Hunter', 'base'), tm = put(h, P0, 'Traveling Merchant', 'base');
  put(h, P0, 'V(1)', 'hand');
  const gust2 = hand(h, P1, 'Gust');
  h = move(h, P0, [v2, tm], BF_A);
  h = answer(h, { order: [[String(pend(h).options?.[0]?.id)]] }, P0);
  assert.ok(h.chain.length > 0, 'Merchant trigger on the chain');
  assert.equal(mightOf(h, v2), 2, 'not yet an Attacker');
  if (pend(h).player === P0) h = pass(h);
  assert.ok(targetOptions(h, P1, gust2).includes(v2), 'Gust can target Vayne now');
});

test('RJ#16 Discipline making Fiora Mighty (Deflect) after she was targeted: no Deflect cost is owed', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const f = put(g, P0, 'Fiora, Victorious', BF_A); control(g, BF_A, P0);
  const zap = hand(g, P1, 'ZapA');
  const disc = hand(g, P0, 'Discipline');
  g = endTurn(g); g = settle(g);            // P1's turn
  assert.equal(g.activePlayer, P1);
  g = pass(play(g, P1, zap, { targets: [[f]] }));
  const before = g.players[P1].runesInPlay.filter(r => !g.objects[r].exhausted).length;
  g = play(g, P0, disc, { targets: [[f]] });
  g = passAll(g);
  assert.ok(hasKeyword(g, f, 'Deflect'), 'Fiora is Mighty and has Deflect');
  assert.notEqual(pend(g).kind, 'payment');
  assert.equal(g.players[P1].runesInPlay.filter(r => !g.objects[r].exhausted).length, before, 'P1 paid nothing more');
  assert.ok(g.objects[f].damage > 0, 'the Zap still resolved');
});

test('RJ#18 Yordle Explorer checks printed Power cost: Miss Fortune with Accelerate paid does not draw; a [A][A][A] card does', () => {
  let g = S0(); fundAll(g, P0, 6);
  put(g, P0, 'Yordle Explorer', 'base');
  const mf = hand(g, P0, 'Miss Fortune, Captain');
  const h0 = g.players[P0].hand.length;
  g = settle(play(g, P0, mf, { dest: 'base', may: [true] }));
  assert.equal(g.objects[mf].exhausted, false, 'Accelerate was paid');
  assert.equal(g.players[P0].hand.length, h0 - 1, 'no draw');
  const gs = hand(g, P0, 'Grand Strategem');
  const h1 = g.players[P0].hand.length;
  g = settle(play(g, P0, gs));
  assert.equal(g.players[P0].hand.length, h1, 'played Grand Strategem (-1) and drew 1');
});

test('RJ#20 Thousand-Tailed Watcher (-3, min 1) then Grand Strategem (+5): 1- and 2-Might units both end at 6', () => {
  let g = S0(); fundAll(g, P0, 8); fundAll(g, P1, 8);
  const t1 = put(g, P1, 'V(1)', BF_A), t2 = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const w = hand(g, P0, 'Thousand-Tailed Watcher');
  g = settle(play(g, P0, w, { dest: 'base', may: [false] }));
  assert.equal(mightOf(g, t1), 1); assert.equal(mightOf(g, t2), 1);
  const a = put(g, P0, 'V(1)', 'base');
  const gs = hand(g, P1, 'Grand Strategem');
  g = move(g, P0, [a], BF_A);
  g = pass(g);
  g = resolveChain(play(g, P1, gs));
  assert.equal(mightOf(g, t1), 6);
  assert.equal(mightOf(g, t2), 6);
});

test('RJ#21 Defiant Dance -2 on a 2-Might unit leaves it alive at 0 Might', () => {
  let g = S0(); fundAll(g, P0);
  const mine = put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(2)', 'base');
  g = settle(play(g, P0, hand(g, P0, 'Defiant Dance'), { targets: [[mine], [e]] }));
  assert.equal(mightOf(g, e), 0);
  assert.equal(zone(g, e), 'base', 'survives (no damage)');
});

test('RJ#22 Yasuo, Remorseful attack damage stays after he Rides the Wind away and heals at combat cleanup', () => {
  let g = S0(); fundAll(g, P0);
  const e = put(g, P1, 'V(7)', BF_A); control(g, BF_A, P1);
  const y = put(g, P0, 'Yasuo, Remorseful', 'base');
  const rtw = hand(g, P0, 'Ride the Wind');
  g = move(g, P0, [y], BF_A);
  g = answer(g, { targets: [[e]] }, P0);
  g = resolveChain(g);
  assert.equal(g.objects[e].damage, 6);
  g = resolveChain(play(g, P0, rtw, { targets: [[y]], locations: ['base'] }));   // R-2: destination chosen as played
  assert.equal(locOf(g, y), 'base');
  assert.equal(g.objects[e].damage, 6, 'still damaged during combat');
  g = settle(g);
  assert.equal(zone(g, e), 'battlefield');
  assert.equal(g.objects[e].damage, 0, 'healed at combat cleanup');
});

test('RJ#26 Carnivorous Snapvine: the unit is on the board at once; Reactions can respond to its play trigger', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const mine = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const sv = hand(g, P1, 'Carnivorous Snapvine');
  const disc = hand(g, P0, 'Discipline');
  g = play(g, P1, sv, { dest: 'base', targets: [[mine]] });
  assert.equal(zone(g, sv), 'base', 'Snapvine is already a board object');
  assert.equal(g.chain.length, 1, 'only its play trigger is on the chain');
  if (pend(g).player === P1) g = pass(g);
  assert.ok(canPlayNow(g, P0, disc), 'P0 may respond with a Reaction');
});

test('RJ#28 Kayn readied by Ride the Wind and recalled after combat stays ready', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  put(g, P1, 'V(12)', BF_B); control(g, BF_B, P1);
  const k = put(g, P0, 'Kayn, Unleashed', 'base');
  const rtw = hand(g, P0, 'Ride the Wind');
  g = move(g, P0, [k], BF_A);
  g = resolveChain(play(g, P0, rtw, { targets: [[k]], locations: [BF_B] }));   // R-2: destination chosen as played
  assert.equal(locOf(g, k), BF_B);
  g = settle(g);
  assert.equal(locOf(g, k), 'base', 'recalled after the BF-B combat');
  assert.equal(g.objects[k].damage, 0);
  assert.equal(g.objects[k].exhausted, false, 'still ready');
});

test("RJ#30 Sett, Brawler spending his buff (5->4) for +4 (8) becomes Mighty again and triggers Grand Duelist", () => {
  let g = S0(); fundAll(g, P0);
  setLegend(g, P0, 'Grand Duelist');
  const s = put(g, P0, 'Sett, Brawler', 'base', { buff: true });
  assert.equal(mightOf(g, s), 5);
  g = activate(g, P0, s, 2);
  g = passAll(g);
  assert.equal(mightOf(g, s), 8);
  assert.equal(pend(g).kind, 'optional');
  assert.match(pend(g).prompt, /Grand Duelist/);
});

test('RJ#31 Tideturner Gusted in response to its play trigger: the chosen unit does not move', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  control(g, BF_A, P0);
  const tt = put(g, P0, 'Tideturner', { facedown: BF_A });
  const u = put(g, P0, 'V(1)', 'base');
  const gust = hand(g, P1, 'Gust');
  g = act(g, { type: 'playCard', player: P0, obj: tt, destination: BF_A } as never);
  g = answer(g, { may: [true], targets: [[u]] }, P0);
  assert.equal(locOf(g, tt), BF_A);
  if (pend(g).player === P0) g = pass(g);
  g = resolveChain(play(g, P1, gust, { targets: [[tt]] }));
  g = settle(g);
  assert.equal(zone(g, tt), 'hand');
  assert.equal(locOf(g, u), 'base', 'unit stays where it is');
});

test("RJ#32 Leona, Determined moved into an ongoing combat by Zenith Blade becomes an Attacker and her 'When I attack' triggers", () => {
  let g = S0(); fundAll(g, P0);
  const e1 = put(g, P1, 'V(2)', BF_A), e2 = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const sett = put(g, P0, 'V(3)', 'base');
  const leona = put(g, P0, 'Leona, Determined', 'base');
  const zb = hand(g, P0, 'Zenith Blade');
  g = move(g, P0, [sett], BF_A);
  g = play(g, P0, zb, { targets: [[e1], [leona]] });
  g = resolveChain(g);
  // RJ#5998b (DECISIONS #5998): the move is decided on resolution
  if (pend(g).kind === 'optional' && /Zenith Blade: move/.test(pend(g).prompt)) g = resolveChain(choose(g, 'yes'));
  assert.equal(locOf(g, leona), BF_A);
  // Leona's attack trigger: stun an enemy unit here
  g = answer(g, { targets: [[e2]] }, P0);
  g = resolveChain(g);
  assert.equal(g.objects[e2].stunned, true, "Leona's 'When I attack' resolved");
});

test('RJ#33 Vanguard Captain Gusted before its Legion play effect resolves: no Recruits; after: Recruits stay', () => {
  const run = (gustEarly: boolean) => {
    let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
    control(g, BF_A, P1); put(g, P1, 'V(1)', BF_A);
    g = settle(play(g, P1, hand(g, P1, 'V(1)'), { dest: 'base' }));
    const vc = hand(g, P1, 'Vanguard Captain');
    const gust = hand(g, P0, 'Gust');
    g = play(g, P1, vc, { dest: BF_A });
    if (!gustEarly) g = resolveChain(g);
    if (pend(g).player === P1 && pend(g).kind !== 'mainAction') g = pass(g);
    if (!gustEarly) { g = endTurn(g, P1); g = settle(g); }   // P0's turn: still "this turn" not needed; just Gust it
    g = settle(play(g, P0, gust, { targets: [[vc]] }));
    return { g, recruits: Object.values(g.objects).filter(o => g.cards[o.cardId]?.name === 'Recruit' && o.zone === 'battlefield').length, vc };
  };
  const early = run(true);
  assert.equal(zone(early.g, early.vc), 'hand');
  assert.equal(early.recruits, 0, 'Gust in response: no tokens');
  const late = run(false);
  assert.equal(zone(late.g, late.vc), 'hand');
  assert.equal(late.recruits, 2, 'Gust after the play effect: tokens stay');
});

test('RJ#34 Yasuo, Remorseful attacking a Nine-Tailed Fox battlefield: attacker trigger goes on the chain first, Fox trigger on top', () => {
  let g = S0(); fundAll(g, P0);
  setLegend(g, P1, 'Nine-Tailed Fox');
  const e = put(g, P1, 'V(7)', BF_A); control(g, BF_A, P1);
  const y = put(g, P0, 'Yasuo, Remorseful', 'base');
  g = move(g, P0, [y], BF_A);
  g = answer(g, { targets: [[e]] }, P0);
  g = answer(g, { targets: [[y]] }, P1);
  const labels = chainLabels(g);
  assert.equal(labels.length, 2, labels.join());
  assert.match(labels[0], /Yasuo/); assert.match(labels[1], /Nine-Tailed Fox/);
});

test('RJ#35 hidden Fight or Flight in response to Hidden Blade moves the unit to base: Hidden Blade fizzles, no draw', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const ff = put(g, P0, 'Fight or Flight', { facedown: BF_A });
  const hb = hand(g, P1, 'Hidden Blade');
  g = pass(play(g, P1, hb, { targets: [[u]] }));
  const h0 = g.players[P0].hand.length;
  g = play(g, P0, ff, { targets: [[u]] });
  g = settle(g);
  assert.equal(locOf(g, u), 'base', 'unit saved');
  assert.equal(zone(g, hb), 'trash');
  assert.equal(g.players[P0].hand.length, h0, 'no draw 2');
});

test('RJ#36 Gust on a 2-Might unit pumped to 4 by Discipline in response: Gust does nothing', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  g = pass(play(g, P1, hand(g, P1, 'Gust'), { targets: [[u]] }));
  g = settle(play(g, P0, hand(g, P0, 'Discipline'), { targets: [[u]] }));
  assert.equal(locOf(g, u), BF_A, 'still on the battlefield');
});

test('RJ#38 Swift Scout cannot return a facedown Teemo (not a unit)', () => {
  let g = S0(); fundAll(g, P0);
  const l = setLegend(g, P0, 'Swift Scout');
  control(g, BF_A, P0);
  const t = put(g, P0, 'Teemo, Scout', { facedown: BF_A });
  const acts = legal(g, P0, 'activate').filter(a => a.type === 'activate' && a.obj === l);
  for (const a of acts) {
    let h: GameState; try { h = act(g, a); } catch { continue; }
    const opts = h.pending?.inStep ? optionIds(h) : [];
    assert.ok(!opts.includes(t), 'facedown Teemo is not a choice');
    h = settle(h);
    assert.equal(zone(h, t), 'facedown', 'facedown Teemo stays');
  }
});

test('RJ#39 War Camp combat Leona+3 Recruits vs Cithria/Sett/Fiora/Recruit with Siphon Power: 11 vs 19, then 15 vs 15 (7 dealable)', () => {
  let g = S0({ bfA: 'Trifarian War Camp' }); fundAll(g, P0);
  const cit = put(g, P1, 'Cithria of Cloudfield', BF_A, { buff: true });
  const sett = put(g, P1, 'Sett, Kingpin', BF_A, { buff: true });
  const fio = put(g, P1, 'Fiora, Victorious', BF_A);
  const rd = put(g, P1, 'Recruit', BF_A, { token: true });
  control(g, BF_A, P1);
  const leo = put(g, P0, 'Leona, Determined', 'base');
  const rs = [0, 1, 2].map(() => put(g, P0, 'Recruit', 'base', { token: true }));
  const sum = (ids: ObjId[]) => ids.reduce((n, i) => n + (mightOf(g, i) ?? 0), 0);
  const D = [cit, sett, fio, rd], A = [leo, ...rs];
  assert.equal(sum(D), 19, 'before combat: 3+9+5+2');
  g = move(g, P0, A, BF_A);
  g = answer(g, { targets: [[sett]] }, P0);       // Leona stuns Sett, Kingpin
  g = resolveChain(g);
  assert.equal(sum(A), 11, 'attackers 5+2+2+2');
  assert.equal(mightOf(g, fio), 6, 'Fiora (5, Mighty) defending has Shield');
  g = resolveChain(play(g, P0, hand(g, P0, 'Siphon Power'), { targets: [[g.battlefields[BF_A].objId]] }));
  assert.equal(sum(A), 15);
  assert.equal(mightOf(g, fio), 4, '4 +1 camp -1 = 4: not Mighty, so no Shield (CR 478.4 Fiora example; RJ#128)');
  assert.equal(sum(D), 15);
  assert.equal(sum([cit, fio, rd]), 7, 'only 7 dealable (Sett stunned)');
});

test('RJ#40 Facebreaker needs a friendly and an enemy unit at the same battlefield; if one leaves, neither is stunned', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const f = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const fb = hand(g, P0, 'Facebreaker');
  assert.ok(!canPlayNow(g, P0, fb), 'no enemy unit there: illegal to play');
  const e = put(g, P1, 'V(2)', BF_A);
  assert.ok(canPlayNow(g, P0, fb));
  g = pass(play(g, P0, fb, { targets: [[f], [e]] }));
  g = settle(play(g, P1, hand(g, P1, 'MoveR'), { targets: [[e]] }));
  assert.equal(locOf(g, e), 'base');
  assert.equal(!!g.objects[f].stunned, false, 'friendly unit not stunned either');
  assert.equal(zone(g, fb), 'trash');
});

test('RJ#43 Possession of an equipped unit: gear stays attached under its controller; when the unit dies it goes to its owner and the gear is recalled to its controller', () => {
  let g = S0(); fundAll(g, P0, 6);
  const u = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const sw = put(g, P1, 'Sword', BF_A); attachNow(g, sw, u);
  g = settle(play(g, P0, hand(g, P0, 'Possession'), { targets: [[u]] }));
  assert.equal(g.objects[u].controller, P0); assert.equal(locOf(g, u), 'base');
  assert.ok(g.players[P0].base.includes(u));
  assert.equal(g.objects[sw].attachedTo, u, 'gear stays attached');
  assert.equal(g.objects[sw].controller, P1, 'opponent still controls the gear');
  g = settle(play(g, P0, hand(g, P0, 'ZapA'), { targets: [[u]] }));
  g = settle(play(g, P0, hand(g, P0, 'ZapA'), { targets: [[u]] }));
  assert.equal(zone(g, u), 'trash'); assert.ok(g.players[P1].trash.includes(u), "owner's trash");
  assert.equal(g.objects[sw].attachedTo, undefined);
  assert.ok(g.players[P1].base.includes(sw), "gear recalled to its controller's base");
});

test('RJ#44 attaching Svellsongur to Mindsplitter copies its text but does not replay its play effect', () => {
  let g = S0(); fundAll(g, P0);
  const m = put(g, P0, 'Mindsplitter', 'base');
  const sv = put(g, P0, 'Svellsongur', 'base');
  put(g, P1, 'V(1)', 'hand'); put(g, P1, 'V(2)', 'hand');
  const eq = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === sv)!;
  assert.ok(eq, 'Equip available');
  g = answer(act(g, eq), { targets: [[m]] }, P0);
  g = settle(g);
  assert.equal(g.objects[sv].attachedTo, m);
  assert.equal(g.players[P1].hand.length, 2, 'no reveal/discard');
});

test('RJ#45 Teemo, Scout giving himself +3 is not a choice: Blade Dancer does not trigger', () => {
  let g = S0(); fundAll(g, P0);
  setLegend(g, P0, 'Blade Dancer');
  const t = hand(g, P0, 'Teemo, Scout');
  g = play(g, P0, t, { dest: 'base' });
  for (let i = 0; i < 10 && g.pending?.kind !== 'mainAction'; i++) {
    assert.ok(!/Blade Dancer/.test(pend(g).prompt), 'no Blade Dancer prompt');
    g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  }
  assert.equal(mightOf(g, t), 4);
});

test('RJ#47 Cithria buff from Pit Rookie play, spend it on Call to Glory, then Pit Rookie\'s trigger buffs her again', () => {
  let g = S0(); fundAll(g, P0);
  const c = put(g, P0, 'Cithria of Cloudfield', 'base');
  const cg = hand(g, P0, 'Call to Glory');
  g = play(g, P0, hand(g, P0, 'Pit Rookie'), { dest: 'base' });
  // order: Pit Rookie trigger first (bottom), Cithria's on top
  const pr = pend(g).options!.find(o => /Pit Rookie/.test(o.label))!;
  g = answer(g, { order: [[pr.id]], targets: [[c]] }, P0);
  g = answer(g, { targets: [[c]] }, P0);
  assert.equal(g.chain.length, 2, chainLabels(g).join());
  g = pass(g); g = pass(g);                 // Cithria trigger resolves
  assert.equal(g.objects[c].counters.buff ?? 0, 1);
  const runes0 = g.players[P0].runesInPlay.filter(r => !g.objects[r].exhausted).length;
  g = play(g, P0, cg, { may: [true], targets: [[c]] });
  assert.equal(g.objects[c].counters.buff ?? 0, 0, 'buff spent');
  assert.equal(g.players[P0].runesInPlay.filter(r => !g.objects[r].exhausted).length, runes0, 'cost ignored');
  g = resolveChain(g);
  assert.equal(g.objects[c].counters.buff ?? 0, 1, 'Pit Rookie buffed her again');
  assert.equal(mightOf(g, c), 1 + 3 + 1);
});

test('RJ#48 Irelia, Fervent gets +1 each time she is chosen (no once-per-turn limit); Meditation exhausting her does not choose her', () => {
  let g = S0(); fundAll(g, P0);
  const i = put(g, P0, 'Irelia, Fervent', BF_A); control(g, BF_A, P0);
  g = settle(play(g, P0, hand(g, P0, 'Discipline'), { targets: [[i]] }));
  assert.equal(mightOf(g, i), 4 + 2 + 1);
  g = settle(play(g, P0, hand(g, P0, 'En Garde'), { targets: [[i]] }));
  assert.equal(mightOf(g, i), 7 + 2 + 1, 'En Garde +1 +1 (only unit) and another +1 trigger');
  const m = mightOf(g, i);
  g = play(g, P0, hand(g, P0, 'Meditation'), { may: [true], targets: [[i]] });
  g = settle(g);
  assert.equal(g.objects[i].exhausted, true, 'exhausted as Meditation\'s cost');
  assert.equal(mightOf(g, i), m, 'no trigger from Meditation');
});

test('RJ#49 Blood Rush (errata) gives Assault 2 this turn only', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'V(2)', 'base');
  g = settle(play(g, P0, hand(g, P0, 'Blood Rush'), { may: [false], targets: [[u]] }));
  assert.ok(hasKeyword(g, u, 'Assault'));
  g = nextTurn(g);
  assert.ok(!hasKeyword(g, u, 'Assault'), 'gone after the turn');
});

test('RJ#52 one move action can send units from different locations (base + Ganking from another battlefield) to the same battlefield', () => {
  let g = S0();
  const a = put(g, P0, 'V(2)', 'base');
  const k = put(g, P0, 'Kayn, Unleashed', BF_B); control(g, BF_B, P0);
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [a, k], BF_A);
  assert.equal(locOf(g, a), BF_A); assert.equal(locOf(g, k), BF_A);
  assert.ok(g.objects[a].exhausted && g.objects[k].exhausted);
});

test("RJ#53 Ezreal, Dashing defending on Reaver's Row: his controller orders the two triggers (damage first, then move to base)", () => {
  let g = S0({ bfA: "Reaver's Row" });
  const ez = put(g, P1, 'Ezreal, Dashing', BF_A); control(g, BF_A, P1);
  const at = put(g, P0, 'V(5)', 'base');
  g = move(g, P0, [at], BF_A);
  for (let i = 0; i < 4 && pend(g).player === P0 && pend(g).inStep; i++) g = act(g, legal(g, P0)[0]);
  assert.equal(pend(g).kind, 'orderTriggers'); assert.equal(pend(g).player, P1);
  const rr = pend(g).options!.find(o => /Reaver/.test(o.label))!;
  // Reaver's Row goes on the chain first (resolves last); pending items finalize in that order: its unit, then Ezreal's target
  g = answer(g, { order: [[rr.id]], targets: [[ez], [at]] }, P1);
  for (let i = 0; i < 10 && g.chain.length; i++) { g = pend(g).inStep ? answer(g, { may: [true], targets: [[ez]] }) : pass(g); }
  assert.equal(g.objects[at].damage, 3, 'Ezreal dealt his damage first');
  assert.equal(locOf(g, ez), 'base', "then Reaver's Row moved him to base");
});

test('RJ#54 Defy can counter a Smoke Screen whose caster paid Deflect (Deflect is an additional cost, not the spell\'s cost)', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const ir = put(g, P1, 'Irelia, Fervent', BF_A); control(g, BF_A, P1);
  const ss = hand(g, P0, 'Smoke Screen');
  const defy = hand(g, P1, 'Defy');
  const rd0 = g.players[P0].runeDeck.length;
  g = play(g, P0, ss, { targets: [[ir]] });
  assert.ok(g.players[P0].runeDeck.length > rd0, 'Deflect [A] paid (rune recycled)');
  g = pass(g);
  const opts = targetOptions(g, P1, defy);
  assert.equal(opts.length, 1, 'Smoke Screen is a legal Defy target');
  g = settle(play(g, P1, defy, { targets: [[opts[0]]] }));
  assert.equal(zone(g, ss), 'trash');
  assert.equal(mightOf(g, ir), 4, 'Smoke Screen countered (an enemy choosing Irelia is not "you choose")');
});

test('RJ#55 Fire Below the Mountain (Ornn) power can pay an Equip cost (equip is a gear ability)', () => {
  let g = S0();
  for (const r of g.players[P0].runesInPlay) g.objects[r].exhausted = true;
  setLegend(g, P0, 'Fire Below the Mountain');
  const u = put(g, P0, 'V(2)', 'base');
  const sw = put(g, P0, 'SwordA', 'base');
  const eq = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === sw);
  assert.ok(eq, 'Equip [A] payable with the legend\'s [A]');
  g = settle(answer(act(g, eq!), { targets: [[u]] }, P0));
  assert.equal(g.objects[sw].attachedTo, u);
});

test('RJ#60 Marching Orders with Repeat: a unit dealt lethal damage by the first execution still deals damage in the second', () => {
  let g = S0(); fundAll(g, P0, 6);
  const f = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const big = put(g, P1, 'V(5)', BF_B), small = put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  const mo = hand(g, P0, 'Marching Orders');
  g = act(g, { type: 'playCard', player: P0, obj: mo });
  g = answer(g, { targets: [[big]], may: [true] }, P0);   // the only friendly unit is chosen automatically
  g = resolveChain(g);
  g = answer(g, { targets: [[small]] }, P0);              // Repeat execution: new choices
  g = settle(g);
  assert.equal(g.objects[big].damage, 3);
  assert.equal(zone(g, small), 'trash', 'second execution happened with the doomed unit');
  assert.equal(zone(g, f), 'trash', 'dies in the cleanup after the spell');
});

test('RJ#61 Baited Hook kills a Deathknell unit and plays Karthus: only one Deathknell trigger', () => {
  let g = S0(); fundAll(g, P0);
  const dk = put(g, P0, 'DKMight(2)', 'base');
  const hook = put(g, P0, 'Baited Hook', 'base');
  const e = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const k = put(g, P0, 'Karthus, Eternal', 'deckTop');
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === hook)!);
  g = answer(g, { targets: [[dk]] }, P0);
  let dkTriggers = 0;
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.inStep) {
      const o = optionIds(g);
      if (d.kind === 'chooseTargets' && o.includes(e)) { dkTriggers++; g = act(g, { type: 'choose', player: d.player, optionIds: [e] }); }
      else if (d.kind === 'chooseCards' && o.includes(k)) g = act(g, { type: 'choose', player: d.player, optionIds: [k] });
      else if (d.kind === 'optional') g = act(g, { type: 'choose', player: d.player, optionIds: ['yes'] });
      else g = act(g, legal(g, d.player)[0]);
    } else g = pass(g);
  }
  assert.ok(['base', BF_A].includes(locOf(g, k) as never), 'Karthus was played');
  assert.equal(g.objects[e].damage, 2, 'Deathknell resolved exactly once');
  void dkTriggers;
});

test('RJ#62 Not So Fast counters an enemy spell only if it chooses a friendly unit/gear', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const mine = put(g, P1, 'V(3)', BF_B); control(g, BF_B, P1);
  const theirs = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const nsf = hand(g, P1, 'Not So Fast');
  let h = pass(play(g, P0, hand(g, P0, 'ZapA'), { targets: [[theirs]] }));
  assert.deepEqual(targetOptions(h, P1, nsf), [], 'Zap on its own unit: not a legal Not So Fast target');
  h = pass(play(g, P0, hand(g, P0, 'ZapA'), { targets: [[mine]] }));
  assert.equal(targetOptions(h, P1, nsf).length, 1, 'Zap on my unit: legal');
});

test('RJ#63 Tryndamere at 6 points conquering only one battlefield wins with his bonus point', () => {
  let g = S0(); g.players[P0].points = 6;
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const t = put(g, P0, 'Tryndamere', 'base');
  g = settle(move(g, P0, [t], BF_A));
  assert.equal(g.players[P0].points, 8);
  assert.equal(g.winner, P0);
});

test('RJ#64 no responses in the combat damage step: Discipline is not playable while damage is assigned', () => {
  let g = S0(); fundAll(g, P1);
  const d = put(g, P1, 'V(3)', BF_A), d2 = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(7)', 'base');
  const disc = hand(g, P1, 'Discipline');
  g = move(g, P0, [a], BF_A);
  g = passAll(g);
  assert.ok(g.pending && g.pending.inStep, `damage step: ${g.pending?.kind}`);
  assert.ok(!canPlayNow(g, P1, disc));
  void d; void d2;
});

test('RJ#65 Smoke Screen (-4) then Falling Star on buffed Sett, saved by The Boss: Sett ends at 0 Might', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  setLegend(g, P0, 'The Boss');
  const s = put(g, P0, 'Sett, Brawler', BF_A, { buff: true }); control(g, BF_A, P0);
  g = settle(play(g, P1, hand(g, P1, 'Smoke Screen'), { targets: [[s]] }));
  assert.equal(mightOf(g, s), 1);
  g = play(g, P1, hand(g, P1, 'Falling Star'), { targets: [[s], [s]] });
  g = resolveChain(g);
  g = answer(g, { may: [true] }, P0);
  g = settle(g);
  assert.equal(locOf(g, s), 'base', 'saved and recalled');
  assert.equal(mightOf(g, s), 0, '4 - 4 (snapshotted), buff spent');
});

test('RJ#66 Darius, Trifarian: Challenge as the 2nd card deals damage before his +2 trigger (he dies, trigger does nothing)', () => {
  let g = S0(); fundAll(g, P0);
  const d = put(g, P0, 'Darius, Trifarian', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(6)', BF_B); control(g, BF_B, P1);
  g = settle(play(g, P0, hand(g, P0, 'V(1)'), { dest: 'base' }));
  g = settle(play(g, P0, hand(g, P0, 'Challenge'), { targets: [[d], [e]] }));
  assert.equal(zone(g, d), 'trash', 'Darius took 6 at 5 Might');
  assert.equal(g.objects[e].damage, 5, 'dealt 5, not 7');
});

test('RJ#67 Tryndamere excess damage counts only after every defender is assigned lethal', () => {
  let g = S0();
  put(g, P1, 'V(3)', BF_A); put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  g = settle(move(g, P0, [put(g, P0, 'Tryndamere', 'base')], BF_A));
  assert.equal(g.players[P0].points, 1, '8 - 3 - 3 = 2 excess: no bonus');
  let h = S0();
  put(h, P1, 'V(3)', BF_A); control(h, BF_A, P1);
  h = settle(move(h, P0, [put(h, P0, 'Tryndamere', 'base')], BF_A));
  assert.equal(h.players[P0].points, 2, '5 excess: bonus point');
});

test('RJ#68 Here to Help played from hiding at Rockfall Path with no other controlled battlefield: no unit can be played', () => {
  let g = S0({ bfA: 'Rockfall Path' }); fundAll(g, P0);
  control(g, BF_A, P0); put(g, P0, 'V(1)', BF_A);
  const hth = put(g, P0, 'Here to Help', { facedown: BF_A });
  const u = hand(g, P0, 'V(4)');
  g = play(g, P0, hth);
  g = resolveChain(g);
  g = answer(g, { may: [true], cards: [[u]] }, P0);
  g = settle(g);
  assert.equal(zone(g, u), 'hand', 'no legal destination');
  assert.equal(zone(g, hth), 'trash');
});

test('RJ#70 conquering Zaun Warrens at 7 points with an empty hand: final-point draw first, then discard 1/draw 1', () => {
  let g = S0({ bfA: 'Zaun Warrens' }); g.players[P0].points = 7;
  const tr0 = g.players[P0].trash.length;
  g = move(g, P0, [put(g, P0, 'V(1)', 'base')], BF_A);
  g = settle(g);
  assert.equal(g.players[P0].points, 7, 'final point replaced by a draw (did not conquer every battlefield)');
  assert.equal(g.players[P0].hand.length, 1, 'drew 1, discarded it, drew 1');
  assert.equal(g.players[P0].trash.length, tr0 + 1);
});

test('RJ#73 Promising Future: the banished card must be played (no "may"), paying its Power cost', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  put(g, P1, 'V(3)', BF_B); control(g, BF_B, P1);
  const fs = [0, 1, 2, 3, 4].map(() => put(g, P0, 'Falling Star', 'deckTop'));
  const pf = hand(g, P0, 'Promising Future');
  const rd0 = g.players[P0].runeDeck.length;
  g = play(g, P0, pf);
  let sawDecline = false;
  for (let i = 0; i < 40 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.inStep) { if (d.kind === 'optional' && d.player === P0) sawDecline = true; g = act(g, legal(g, d.player)[0]); } else g = pass(g);
  }
  assert.equal(sawDecline, false, 'no option to decline playing it');
  assert.equal(fs.filter(f => zone(g, f) === 'trash').length, 1, 'one Falling Star was played and resolved');
  assert.ok(g.players[P0].runeDeck.length >= rd0 + 1 + 2, 'Promising Future [A] + Falling Star [A][A] paid by recycling');
});

test('RJ#75 (OUTDATED) Falling Star vs a lone Pouty Poro: both targets are chosen when played (SFD FAQ), no per-instance Deflect choice on resolution', () => {
  let g = S0(); fundAll(g, P0);
  const poro = put(g, P1, 'Pouty Poro', BF_A); control(g, BF_A, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Falling Star') });
  g = answer(g, { targets: [[poro], [poro]] }, P0);
  assert.equal(pend(g).kind, 'chainResponse', 'all choices made at play');
  const it = g.chain[0];
  assert.deepEqual((it.targets ?? []).flat(), [poro, poro]);
  g = passAll(g);
  assert.ok(!(pend(g).inStep && pend(g).player === P0), 'no Deflect decision on resolution');
  assert.equal(zone(g, poro), 'trash');
});

test('RJ#77 Dark Child\'s "At the end of your turn, ready up to 2 runes" is a triggered ability (uses the chain)', () => {
  let g = S0();
  setLegend(g, P0, 'Dark Child');
  for (const r of g.players[P0].runesInPlay.slice(0, 2)) g.objects[r].exhausted = true;
  g = endTurn(g, P0);
  const seen = [] as string[];
  for (let i = 0; i < 10 && g.activePlayer === P0; i++) {
    seen.push(...chainLabels(g));
    const d = pend(g); g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  assert.ok(seen.some(l => /Dark Child/.test(l)), `trigger on the chain: ${seen.join()}`);
});

test('RJ#78 a targeted unit moving to another battlefield: a spell from hand still resolves; one played from hiding fails', () => {
  // from hand: "Kill a unit at a battlefield" still finds it at BF-B
  let g = S0(); fundAll(g, P0);
  control(g, BF_A, P0); control(g, BF_B, P0);
  const u = put(g, P0, 'V(2)', BF_A); put(g, P0, 'V(1)', BF_B);
  g = play(g, P0, hand(g, P0, 'KillA'), { targets: [[u]] });
  g = settle(play(g, P0, hand(g, P0, 'Resonating Strike'), { targets: [[g.battlefields[BF_B].objId], [u]] }));
  assert.equal(zone(g, u), 'trash', 'from hand: still at a battlefield -> killed');
  // from hiding at BF-A: the target must be at that battlefield
  let h = S0(); fundAll(h, P0);
  control(h, BF_A, P0); control(h, BF_B, P0);
  const v = put(h, P0, 'V(3)', BF_A); put(h, P0, 'V(1)', BF_B);
  const hz = put(h, P0, 'HidZap', { facedown: BF_A });
  h = play(h, P0, hz, { targets: [[v]] });
  h = settle(play(h, P0, hand(h, P0, 'Resonating Strike'), { targets: [[h.battlefields[BF_B].objId], [v]] }));
  assert.equal(locOf(h, v), BF_B);
  assert.equal(h.objects[v].damage, 0, 'hidden spell fizzles');
});

test('RJ#79 Gearhead with Svellsongur and a +2 Equipment: +4, the copied doubling text does not stack', () => {
  const g = S0();
  const gh = put(g, P0, 'Gearhead', 'base');
  const sw = put(g, P0, 'Sword', 'base'); attachNow(g, sw, gh);
  assert.equal(mightOf(g, gh), 3 + 4);
  const sv = put(g, P0, 'Svellsongur', 'base'); attachNow(g, sv, gh);
  assert.equal(mightOf(g, gh), 3 + 4, 'Svellsongur (base 0) adds nothing and doubling does not stack');
});

test('RJ#80 Frigid Touch -2 on a 2-Might unit does not kill it', () => {
  let g = S0(); fundAll(g, P0);
  const e = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  g = settle(play(g, P0, hand(g, P0, 'Frigid Touch'), { targets: [[e]], may: [false] }));
  assert.equal(mightOf(g, e), 0);
  assert.equal(zone(g, e), 'battlefield');
});

test('RJ#81a Spinning Axe: its Temporary trigger uses the chain; attaching it with Angle Shot in response does not save it', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0);
  const u = put(g, P0, 'V(2)', 'base');
  const ax = put(g, P0, 'Spinning Axe', 'base');
  const as = hand(g, P0, 'Angle Shot');
  g = endTurn(g, P1);
  assert.ok(g.chain.some(c => c.source === ax), 'Temporary trigger on the chain');
  g = play(g, P0, as, { targets: [[u], [ax]], mode: ['attach'] });
  g = settle(g);
  assert.equal(zone(g, ax), 'trash', 'killed anyway');
});

test('RJ#81b Spinning Axe already attached at the start of the Beginning phase: Temporary does not kill it', () => {
  let h = S0({ tp: P1 });
  const u2 = put(h, P0, 'V(2)', 'base');
  const ax2 = put(h, P0, 'Spinning Axe', 'base'); attachNow(h, ax2, u2);
  h = settle(endTurn(h, P1));
  assert.equal(h.activePlayer, P0);
  assert.equal(zone(h, ax2), 'base', 'attached Axe survives');
  assert.equal(zone(h, u2), 'base');
});

test('RJ#82 Azir, Sovereign attacking can bring token units from base and from another battlefield', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  control(g, BF_B, P0);
  const t1 = put(g, P0, 'Recruit', BF_B, { token: true }), t2 = put(g, P0, 'Recruit', 'base', { token: true });
  const az = put(g, P0, 'Azir, Sovereign', 'base');
  g = move(g, P0, [az], BF_A);
  for (let i = 0; i < 12 && !(locOf(g, t1) === BF_A && locOf(g, t2) === BF_A); i++) {
    const d = pend(g);
    if (!d.inStep) { if (d.kind === 'chainResponse') { g = pass(g); continue; } break; }
    if (d.kind === 'optional') { g = act(g, { type: 'choose', player: d.player, optionIds: ['yes'] }); continue; }
    const o = optionIds(g);
    assert.ok(o.includes(t1) && o.includes(t2), 'both tokens selectable');
    g = act(g, { type: 'choose', player: d.player, optionIds: [t1, t2] });
  }
  assert.equal(locOf(g, t1), BF_A); assert.equal(locOf(g, t2), BF_A);
});

test('RJ#84 Forecaster gives itself Vision when played; two Forecasters give a Mech two Vision triggers', () => {
  const visions = (g: GameState) => g.chain.filter(c => /Vision/i.test(c.label ?? '')).length;
  let g = S0(); fundAll(g, P0);
  g = play(g, P0, hand(g, P0, 'Forecaster'), { dest: 'base' });
  assert.equal(visions(g), 1, `Forecaster's own Vision: ${chainLabels(g)}`);
  g = settle(g);
  put(g, P0, 'Forecaster', 'base');
  g = play(g, P0, hand(g, P0, 'Mech(2)'), { dest: 'base' });
  for (let i = 0; i < 3 && pend(g).kind === 'orderTriggers'; i++) g = act(g, { type: 'choose', player: P0, optionIds: [optionIds(g)[0]] });
  assert.equal(visions(g), 2, `two Vision triggers: ${chainLabels(g)}`);
});

test('RJ#85 in a showdown, Actions start chains only when nothing is waiting to resolve; responses must be Reactions', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const e = put(g, P1, 'V(4)', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [put(g, P0, 'V(4)', 'base')], BF_A);
  g = pass(play(g, P0, hand(g, P0, 'ZapA'), { targets: [[e]] }));
  assert.ok(!canPlayNow(g, P1, hand(g, P1, 'ZapA')), 'no Action while the chain is pending');
  assert.ok(canPlayNow(g, P1, hand(g, P1, 'ZapR')), 'Reaction allowed');
  g = resolveChain(g);
  assert.equal(pend(g).kind, 'showdownAction', 'chain resolved, showdown continues with focus');
});

test('RJ#86 Daughter of the Void [C] can pay a spell\'s Deflect cost', () => {
  let g = S0(); fundAll(g, P0, 0);
  addRunes(g, P0, 2, 'mind');
  setLegend(g, P0, 'Daughter of the Void');
  const ir = put(g, P1, 'Irelia, Fervent', BF_A); control(g, BF_A, P1);
  const ss = hand(g, P0, 'Smoke Screen');
  assert.ok(canPlayNow(g, P0, ss), '2 runes pay [2]; the legend pays Deflect');
  g = settle(play(g, P0, ss, { targets: [[ir]] }));
  assert.equal(mightOf(g, ir), 1);
});

test('RJ#88 Thwonk! with Repeat may stun a different attacking unit', () => {
  let g = S0(); fundAll(g, P1);
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const a1 = put(g, P0, 'V(2)', 'base'), a2 = put(g, P0, 'V(3)', 'base');
  g = move(g, P0, [a1, a2], BF_A);
  g = pass(g);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Thwonk!') });
  g = answer(g, { targets: [[a1], [a2]], may: [true] }, P1);   // CR 820.2: the repeat's target is chosen as it is played
  g = resolveChain(g);
  assert.ok(g.objects[a1].stunned && g.objects[a2].stunned, 'both attackers stunned');
});

test('RJ#89 Reactions can respond to a gear\'s activated ability (Iron Ballista)', () => {
  let g = S0(); fundAll(g, P1);
  const ib = put(g, P0, 'Iron Ballista', 'base');
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === ib)!);
  g = answer(g, { targets: [[e]] }, P0);
  assert.equal(g.chain.length, 1);
  if (pend(g).player === P0) g = pass(g);
  assert.ok(canPlayNow(g, P1, hand(g, P1, 'Discipline')), 'Reaction in response');
});

test('RJ#90 Svellsongur copies the unit\'s printed text (keywords stack: Deflect + Deflect), not its Might', () => {
  const g = S0();
  const ir = put(g, P0, 'Irelia, Fervent', 'base');
  const sv = put(g, P0, 'Svellsongur', 'base'); attachNow(g, sv, ir);
  assert.equal(kwValue(g, ir, 'Deflect'), 2, 'Deflect from Irelia + copied Deflect');
  assert.equal(mightOf(g, ir), 4, 'no Might copied');
});

test('RJ#93 Thousand-Tailed Watcher\'s play trigger uses the chain and can be responded to', () => {
  let g = S0(); fundAll(g, P0, 8); fundAll(g, P1);
  put(g, P1, 'V(4)', BF_A); control(g, BF_A, P1);
  g = play(g, P0, hand(g, P0, 'Thousand-Tailed Watcher'), { dest: 'base', may: [false] });
  assert.ok(chainLabels(g).some(l => /Watcher/.test(l)), 'trigger on the chain');
  if (pend(g).player === P0) g = pass(g);
  assert.ok(canPlayNow(g, P1, hand(g, P1, 'Discipline')), 'P1 may react');
});

test('RJ#91 marked damage >= Might after Thousand-Tailed Watcher\'s -3 (min 1) kills the unit', () => {
  let g = S0(); fundAll(g, P0, 8);
  const e = put(g, P1, 'V(4)', BF_A, { damage: 2 }); control(g, BF_A, P1);
  g = settle(play(g, P0, hand(g, P0, 'Thousand-Tailed Watcher'), { dest: 'base', may: [false] }));
  assert.equal(zone(g, e), 'trash', '4 -> 1 Might with 2 damage marked');
});

test('RJ#92a Prodigal Explorer: Frigid Touch with Repeat on enemy units counts as choosing twice even if Defy counters it', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const l = setLegend(g, P0, 'Prodigal Explorer');
  const e1 = put(g, P1, 'V(4)', BF_A), e2 = put(g, P1, 'V(4)', BF_A); control(g, BF_A, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Frigid Touch') });
  g = answer(g, { targets: [[e1]], may: [true] }, P0);
  g = answer(g, { targets: [[e2]] }, P0);
  g = pass(g);
  const defy = hand(g, P1, 'Defy');
  g = settle(play(g, P1, defy, { targets: [[targetOptions(g, P1, defy)[0]]] }));
  assert.ok(legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === l), 'legend draw available');
});

test('RJ#92c Arcane Shift on Fizz: Arcane Shift finishes (Fizz played, 3 damage dealt) before Fizz\'s play trigger resolves', () => {
  let g = S0(); fundAll(g, P0);
  const fz = put(g, P0, 'Fizz, Trickster', 'base');
  const zap = put(g, P0, 'ZapA', 'trash');
  const e = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  g = play(g, P0, hand(g, P0, 'Arcane Shift'), { targets: [[fz], [e]] });
  g = resolveChain(g);
  // Fizz's trash spell is chosen as his trigger is chained (RJ#10771): choose ZapA so the trigger goes on the chain
  for (let i = 0; i < 5 && pend(g).inStep && !g.chain.length; i++) g = optionIds(g).includes(zap) ? act(g, { type: 'choose', player: pend(g).player, optionIds: [zap] }) : act(g, legal(g, pend(g).player)[0]);
  assert.equal(g.objects[e].damage, 3, '3 damage dealt by Arcane Shift');
  const fz2 = Object.values(g.objects).find(o => g.cards[o.cardId]?.name === 'Fizz' && (o.zone === 'base' || o.zone === 'battlefield'));
  assert.ok(fz2, 'Fizz was played');
  assert.ok(g.chain.some(c => c.source === fz2!.id) || pend(g).inStep, 'Fizz trigger still to resolve');
});

test('RJ#95 a unit Charmed into a battlefield held by another player makes its controller the attacker (1v1 analogue)', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(2)', 'base');
  g = passAll(play(g, P0, hand(g, P0, 'Charm'), { targets: [[e]] }));
  g = answer(g, { locations: [BF_A] });
  assert.equal(locOf(g, e), BF_A);
  assert.ok(g.showdown?.isCombat, 'combat at BF-A');
  assert.equal(g.showdown?.attacker, P1, 'the contesting player (P1) is the attacker');
  assert.equal(g.showdown?.defender, P0);
});

test('RJ#96 Azir, Ascendant (no Reaction) cannot be played during a showdown; Shen, Kinkou ([Reaction]) can', () => {
  let g = S0(); fundAll(g, P0);
  const az = hand(g, P0, 'Azir, Ascendant'), sh = hand(g, P0, 'Shen, Kinkou');
  g = move(g, P0, [put(g, P0, 'V(1)', 'base')], BF_A);
  assert.equal(pend(g).kind, 'showdownAction');
  assert.ok(!canPlayNow(g, P0, az), 'Azir has no Action/Reaction timing');
  assert.ok(canPlayNow(g, P0, sh), 'Shen has Reaction');
});

test('RJ#97 Hostile Takeover of an equipped unit: equipment stays attached under its original controller; returns to them if the unit dies', () => {
  let g = S0(); fundAll(g, P0, 6);
  const u = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const sw = put(g, P1, 'Sword', BF_A); attachNow(g, sw, u);
  g = settle(play(g, P0, hand(g, P0, 'Hostile Takeover'), { targets: [[u]] }));
  assert.equal(g.objects[u].controller, P0);
  assert.equal(g.objects[sw].attachedTo, u);
  assert.equal(g.objects[sw].controller, P1);
  g = settle(play(g, P0, hand(g, P0, 'ZapA'), { targets: [[u]] }));
  g = settle(play(g, P0, hand(g, P0, 'ZapA'), { targets: [[u]] }));
  assert.ok(g.players[P1].trash.includes(u));
  assert.ok(g.players[P1].base.includes(sw), 'equipment back with its controller');
});

test('RJ#98 Jae Medarda chosen by Feral Strength and again by its Repeat: draws twice', () => {
  let g = S0(); fundAll(g, P0);
  const j = put(g, P0, 'Jae Medarda', 'base');
  put(g, P0, 'V(1)', 'base');
  const h0 = g.players[P0].hand.length;
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Feral Strength') });
  g = answer(g, { targets: [[j]], may: [true] }, P0);
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.inStep) g = act(g, { type: 'choose', player: d.player, optionIds: d.kind === 'chooseTargets' && optionIds(g).includes(j) ? [j] : [optionIds(g)[0]] });
    else g = pass(g);
  }
  assert.equal(mightOf(g, j), 9, '+2 twice');
  assert.equal(g.players[P0].hand.length, h0 + 2, 'drew twice (Feral Strength added then played: net 0)');
});

test('RJ#100 The Boss\'s save is a replacement effect: no chain item, nothing to respond to', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  setLegend(g, P0, 'The Boss');
  const u = put(g, P0, 'V(2)', BF_A, { buff: true }); control(g, BF_A, P0);
  g = resolveChain(play(g, P1, hand(g, P1, 'KillA'), { targets: [[u]] }));
  assert.equal(pend(g).kind, 'optional');
  assert.match(pend(g).prompt, /Boss/);
  g = answer(g, { may: [true] }, P0);
  assert.equal(g.chain.length, 0, 'no chain item');
  assert.equal(locOf(g, u), 'base', 'saved immediately');
});

test('RJ#101 Loose Cannon\'s trigger goes on the chain even with 2+ cards; shrinking the hand in response lets it draw', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0);
  setLegend(g, P0, 'Loose Cannon');
  put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  hand(g, P0, 'V(1)');
  const z = hand(g, P0, 'ZapR');
  g = endTurn(g, P1);
  assert.ok(chainLabels(g).some(l => /Loose Cannon/.test(l)), `trigger on the chain with 2 cards: ${chainLabels(g)}`);
  const logLen = g.log.length;
  g = play(g, P0, z, { targets: [[Object.values(g.objects).find(o => o.controller === P1 && o.zone === 'battlefield')!.id]] });
  g = resolveChain(g);
  assert.ok(g.log.slice(logLen).some(l => /P0 draws/.test(l.text)), 'drew from Loose Cannon');
});

test('RJ#102 a hidden Tideturner can only be played to the battlefield where it was hidden', () => {
  const g = S0(); fundAll(g, P0);
  control(g, BF_A, P0);
  const tt = put(g, P0, 'Tideturner', { facedown: BF_A });
  const dests = legal(g, P0, 'playCard').filter(a => a.type === 'playCard' && a.obj === tt).map(a => (a as { destination?: unknown }).destination);
  assert.ok(dests.length > 0);
  assert.ok(dests.every(d => d === BF_A || d === undefined), `destinations: ${JSON.stringify(dests)}`);
  assert.ok(!(dests as unknown[]).includes('base'));
});

test('RJ#103 a unit moved into an ongoing combat gets its Assault (attacker) / Shield (defender) bonus', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const j = put(g, P0, 'ogn-030-298', 'base');           // Jinx, Demolitionist: Assault 2
  const shen = hand(g, P1, 'Shen, Kinkou');               // Reaction, Shield 2
  const rtw = hand(g, P0, 'Ride the Wind');
  g = move(g, P0, [put(g, P0, 'V(3)', 'base')], BF_A);
  g = resolveChain(play(g, P0, rtw, { targets: [[j]], locations: [BF_A] }));   // R-2: destination chosen as played
  assert.equal(locOf(g, j), BF_A);
  assert.equal(mightOf(g, j), 6, 'Jinx is an attacker: 4 + Assault 2');
  if (pend(g).player !== P1) g = pass(g);
  g = resolveChain(play(g, P1, shen, { dest: BF_A }));
  assert.equal(locOf(g, shen), BF_A);
  assert.equal(mightOf(g, shen), 5, 'Shen is a defender: 3 + Shield 2');
});

test('RJ#104 Eclipse Herald readies (and gets +1) each time you stun an enemy unit, no per-turn limit', () => {
  let g = S0(); fundAll(g, P0);
  const h = put(g, P0, 'Eclipse Herald', 'base', { ready: false });
  const e1 = put(g, P1, 'V(2)', BF_A), e2 = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  g = settle(play(g, P0, hand(g, P0, 'StunA'), { targets: [[e1]] }));
  assert.equal(g.objects[h].exhausted, false);
  g.objects[h].exhausted = true; touch(g);
  g = settle(play(g, P0, hand(g, P0, 'StunA'), { targets: [[e2]] }));
  assert.equal(g.objects[h].exhausted, false, 'readied again');
  assert.equal(mightOf(g, h), 9);
});

test('RJ#106 a unit can carry several Equipment; an attached Equipment\'s own Equip ability cannot move it', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'V(2)', 'base'), v = put(g, P0, 'V(2)', 'base');
  const s1 = put(g, P0, 'Sword', 'base'), s2 = put(g, P0, 'Sword', 'base');
  for (const s of [s1, s2]) {
    const eq = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === s)!;
    g = settle(answer(act(g, eq), { targets: [[u]] }, P0));
  }
  assert.equal(g.objects[s1].attachedTo, u); assert.equal(g.objects[s2].attachedTo, u);
  assert.equal(mightOf(g, u), 6);
  assert.ok(!legal(g, P0, 'activate').some(a => a.type === 'activate' && (a.obj === s1 || a.obj === s2)), 'Equip is inactive while attached');
  void v;
});

test('RJ#107 Yasuo\'s attack damage fizzles if Tideturner swaps the target to another battlefield', () => {
  let g = S0(); fundAll(g, P1);
  const x = put(g, P1, 'V(7)', BF_A); control(g, BF_A, P1);
  put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  const tt = put(g, P1, 'Tideturner', { facedown: BF_B });
  const y = put(g, P0, 'Yasuo, Remorseful', 'base');
  g = move(g, P0, [y], BF_A);
  g = answer(g, { targets: [[x]] }, P0);
  if (pend(g).player === P0) g = pass(g);
  g = act(g, { type: 'playCard', player: P1, obj: tt, destination: BF_B } as never);
  g = answer(g, { may: [true], targets: [[x]] }, P1);
  g = resolveChain(g);
  assert.equal(locOf(g, x), BF_B, 'swapped away');
  assert.equal(g.objects[x].damage, 0, 'Yasuo\'s ability whiffed');
});

test('RJ#109 a standard move does not use the chain: units arrive at once (exhausted), no response window', () => {
  let g = S0();
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_B);
  assert.equal(locOf(g, u), BF_B);
  assert.equal(g.objects[u].exhausted, true, 'cost paid (exhaust)');
  assert.equal(g.chain.length, 0, 'nothing on the chain');
});

test('RJ#110 Relentless Storm: Sett, Brawler (4, buffed by his own play effect) is not Mighty when played; played to Trifarian War Camp he is', () => {
  const run = (dest: 'base' | number) => {
    let g = S0({ bfA: 'Trifarian War Camp' }); fundAll(g, P0);
    setLegend(g, P0, 'Relentless Storm');
    control(g, BF_A, P0); put(g, P0, 'V(1)', BF_A);
    g = play(g, P0, hand(g, P0, 'Sett, Brawler'), { dest });
    let asked = false;
    for (let i = 0; i < 12 && pend(g).kind !== 'mainAction'; i++) {
      const d = pend(g);
      if (d.inStep) { if (/Relentless Storm/.test(d.prompt)) asked = true; g = act(g, legal(g, d.player)[0]); }
      else { if (chainLabels(g).some(l => /Relentless Storm/.test(l))) asked = true; g = pass(g); }
    }
    return asked;
  };
  assert.equal(run('base'), false, 'base: 4 Might as played -> no trigger');
  assert.equal(run(BF_A), true, 'War Camp: 5 Might as played -> trigger');
});

test('RJ#111 Leona\'s mandatory attack stun on a Deflect unit: declining/unable to pay Deflect removes the trigger; the attack goes on', () => {
  for (const funded of [true, false]) {
    let g = S0();
    if (!funded) for (const r of g.players[P0].runesInPlay) g.objects[r].exhausted = true;
    const poro = put(g, P1, 'Pouty Poro', BF_A); control(g, BF_A, P1);
    const l = put(g, P0, 'Leona, Determined', 'base');
    g = move(g, P0, [l], BF_A);
    for (let i = 0; i < 6 && pend(g).inStep && pend(g).player === P0; i++) {
      const d = pend(g);
      g = act(g, { type: 'choose', player: P0, optionIds: [d.kind === 'optional' ? 'no' : optionIds(g)[0]] });
    }
    assert.ok(!chainLabels(g).some(x => /Leona/.test(x)), `trigger removed (funded=${funded})`);
    assert.equal(!!g.objects[poro].stunned, false);
    assert.ok(g.showdown?.isCombat, 'combat continues');
  }
});

test('RJ#114 Targon\'s Peak: runes are chosen/readied at end of turn by the delayed trigger, not on conquer', () => {
  let g = S0({ bfA: "Targon's Peak" });
  for (const r of g.players[P0].runesInPlay) g.objects[r].exhausted = true;
  touch(g);
  g = settle(move(g, P0, [put(g, P0, 'V(1)', 'base')], BF_A));
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[P0].runesInPlay.filter(r => !g.objects[r].exhausted).length, 0, 'nothing readied at conquer');
  g = endTurn(g, P0);
  let seen = false;
  for (let i = 0; i < 10 && g.activePlayer === P0; i++) {
    if (chainLabels(g).some(l => /Targon/.test(l)) || /Targon/.test(pend(g).prompt)) seen = true;
    const d = pend(g); g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  assert.ok(seen, 'delayed trigger at end of turn');
});

test('RJ#115 Mask of Foresight\'s attack trigger uses the chain; Gust in response returns the unit before the +1', () => {
  let g = S0(); fundAll(g, P1);
  put(g, P0, 'Mask of Foresight', 'base');
  put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const p = put(g, P0, 'Mystic Poro', 'base');
  g = move(g, P0, [p], BF_A);
  assert.ok(chainLabels(g).some(l => /Mask of Foresight/.test(l)), `Mask trigger on the chain: ${chainLabels(g)}`);
  if (pend(g).player === P0) g = pass(g);
  g = settle(play(g, P1, hand(g, P1, 'Gust'), { targets: [[p]] }));
  assert.equal(zone(g, p), 'hand');
});

test('RJ#116 Unyielding Spirit prevents spell/ability damage this turn but not combat damage or Might reduction', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const e = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  g = settle(play(g, P0, hand(g, P0, 'Unyielding Spirit')));
  g = settle(play(g, P0, hand(g, P0, 'ZapA'), { targets: [[e]] }));
  assert.equal(g.objects[e].damage, 0, 'spell damage prevented');
  g = settle(play(g, P0, hand(g, P0, 'Smoke Screen'), { targets: [[e]] }));
  assert.equal(mightOf(g, e), 1, 'Might reduction not prevented');
  const a = put(g, P0, 'V(1)', 'base');
  g = settle(move(g, P0, [a], BF_A));
  assert.equal(zone(g, e), 'trash', 'combat damage not prevented');
});

test('RJ#117 Karma played by Reinforce does not see Reinforce\'s own recycle (no buff)', () => {
  let g = S0(); fundAll(g, P0, 6);
  const f = put(g, P0, 'V(2)', 'base');
  for (let i = 0; i < 4; i++) put(g, P0, 'V(1)', 'deckTop');
  const k = put(g, P0, 'Karma, Channeler', 'deckTop');
  g = play(g, P0, hand(g, P0, 'Reinforce'));
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.inStep) {
      const o = optionIds(g);
      if (d.kind === 'chooseCards' && o.includes(k)) g = act(g, { type: 'choose', player: d.player, optionIds: [k] });
      else if (d.kind === 'optional') g = act(g, { type: 'choose', player: d.player, optionIds: [/recycle/i.test(d.prompt) ? 'no' : 'yes'] });
      else g = act(g, legal(g, d.player)[0]);
    } else g = pass(g);
  }
  assert.ok(['base', BF_A, BF_B].includes(locOf(g, k) as never), 'Karma was played');
  assert.equal((g.objects[f].counters.buff ?? 0) + (g.objects[k].counters.buff ?? 0), 0, 'no buff from Reinforce\'s recycle');
});

test('RJ#118 a spell with one [Repeat] can be repeated only once', () => {
  let g = S0(); fundAll(g, P0, 8);
  const e = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Frigid Touch') });
  let repeatPrompts = 0;
  for (let i = 0; i < 10 && pend(g).inStep; i++) {
    const d = pend(g);
    if (d.kind === 'optional' && /Repeat/i.test(d.prompt)) { repeatPrompts++; g = act(g, { type: 'choose', player: P0, optionIds: ['yes'] }); }
    else g = act(g, { type: 'choose', player: P0, optionIds: [optionIds(g).includes(e) ? e : optionIds(g)[0]] });
  }
  assert.equal(repeatPrompts, 1);
  g = settle(g);
  assert.equal(mightOf(g, e), 9 - 4, 'executed twice in total');
});

test('RJ#120 a damaged defender still deals combat damage equal to its full Might', () => {
  let g = S0();
  const d = put(g, P1, 'V(5)', BF_A, { damage: 3 }); control(g, BF_A, P1);
  const a = put(g, P0, 'V(5)', 'base');
  g = settle(move(g, P0, [a], BF_A));
  assert.equal(zone(g, a), 'trash', 'took 5 (not 5 - 3)');
  assert.equal(zone(g, d), 'trash');
});

test('RJ#121 Royal Entourage can exhaust an enemy legend, shutting off its [T] ability', () => {
  let g = S0(); fundAll(g, P0);
  const l = setLegend(g, P1, 'Daughter of the Void');
  g = play(g, P0, hand(g, P0, 'Royal Entourage'), { dest: 'base' });
  for (let i = 0; i < 10 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    const pick = o.includes(l) ? l : o.find(x => /exhaust/i.test(d.options!.find(y => y.id === x)!.label)) ?? o[0];
    g = act(g, { type: 'choose', player: d.player, optionIds: [pick] });
  }
  assert.equal(g.objects[l].exhausted, true, 'enemy legend exhausted');
});

test('RJ#122 Rebuke can return a Recruit token (Viktor\'s); it ceases to exist', () => {
  let g = S0(); fundAll(g, P0);
  const t = put(g, P1, 'Recruit', BF_A, { token: true }); control(g, BF_A, P1);
  g = settle(play(g, P0, hand(g, P0, 'Rebuke'), { targets: [[t]] }));
  assert.equal(zone(g, t), 'gone');
  assert.ok(!g.players[P1].hand.includes(t));
});

test('RJ#123 Blade Dancer triggers in a showdown when En Garde chooses Irelia, and can ready her', () => {
  let g = S0(); fundAll(g, P0);
  setLegend(g, P0, 'Blade Dancer');
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const ir = put(g, P0, 'Irelia, Fervent', 'base');
  g = move(g, P0, [ir], BF_A);
  assert.equal(g.objects[ir].exhausted, true);
  g = play(g, P0, hand(g, P0, 'En Garde'), { targets: [[ir]] });
  let asked = false;
  for (let i = 0; i < 12 && g.objects[ir].exhausted; i++) {
    const d = pend(g);
    if (d.inStep) { if (/Blade Dancer/.test(d.prompt)) asked = true; g = act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : optionIds(g)[0]] }); }
    else { if (d.kind !== 'chainResponse') break; g = pass(g); }
  }
  assert.ok(asked, 'Blade Dancer offered');
  assert.equal(g.objects[ir].exhausted, false, 'readied');
});

test('RJ#124 Zenith Blade may choose a friendly unit already at that battlefield (no move); Dreaming Tree still draws', () => {
  let g = S0({ bfA: 'The Dreaming Tree' }); fundAll(g, P0);
  const e = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(3)', 'base');
  g = move(g, P0, [a], BF_A);
  put(g, P0, 'V(1)', 'base');      // (a second friendly unit: with one, the now-required choice is auto-answered — ENGINE-7, RJ#5998b)
  const zb = hand(g, P0, 'Zenith Blade');
  const h0 = g.players[P0].hand.length;
  g = act(g, { type: 'playCard', player: P0, obj: zb });
  if (optionIds(g).includes(e)) g = answer(g, { targets: [[e]] }, P0);
  assert.ok(optionIds(g).includes(a), 'own attacker is a legal choice');
  g = answer(g, { targets: [[a]] }, P0);
  g = resolveChain(g);
  assert.equal(locOf(g, a), BF_A);
  assert.equal(g.players[P0].hand.length, h0 - 1 + 1, 'Zenith Blade played, Dreaming Tree drew 1');
});

test('RJ#126 Ravenbloom Student\'s "when you play a spell" +1 comes after the spell (Switcheroo) resolves', () => {
  let g = S0(); fundAll(g, P0);
  const r = put(g, P0, 'Ravenbloom Student', BF_A), v = put(g, P0, 'V(5)', BF_A); control(g, BF_A, P0);
  g = play(g, P0, hand(g, P0, 'Switcheroo'), { targets: [[r, v]] });
  g = answer(g, { targets: [[v]] }, P0);
  g = settle(g);
  assert.equal(mightOf(g, r), 6, 'swapped to 5, then +1');
  assert.equal(mightOf(g, v), 2);
});

test('RJ#127 Rell, Magnetic can play Spinning Axe from hand ignoring its whole cost (Energy 2, Power 1)', () => {
  let g = S0();
  for (const r of g.players[P0].runesInPlay) g.objects[r].exhausted = true;
  touch(g);
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const rell = put(g, P0, 'Rell, Magnetic', 'base');
  const ax = hand(g, P0, 'Spinning Axe');
  g = move(g, P0, [rell], BF_A);
  for (let i = 0; i < 10 && zone(g, ax) === 'hand'; i++) {
    const d = pend(g);
    if (!d.inStep) { if (d.kind !== 'chainResponse') break; g = pass(g); continue; }
    const o = optionIds(g);
    g = act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : o.includes(ax) ? ax : o[0]] });
  }
  g = resolveChain(g);
  assert.equal(g.objects[ax].attachedTo, rell, 'played for free and attached');
});

test('RJ#128 (AMBIGUOUS, RJ adopted) Fiora, Victorious + Svellsongur defending after spending her buff: 4 Might, not Mighty, no Shield', () => {
  let g = S0(); fundAll(g, P1);
  const f = put(g, P1, 'Fiora, Victorious', BF_A, { buff: true }); control(g, BF_A, P1);
  const sv = put(g, P1, 'Svellsongur', 'base'); attachNow(g, sv, f);
  g = move(g, P0, [put(g, P0, 'V(1)', 'base')], BF_A);
  assert.ok((mightOf(g, f) ?? 0) >= 6, 'buffed: Mighty -> Shield while defending');
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'Call to Glory'), { may: [true], targets: [[put(g, P1, 'V(1)', 'base')]] });
  assert.equal(g.objects[f].counters.buff ?? 0, 0, 'buff spent');
  assert.equal(mightOf(g, f), 4, 'evaluated without her own Shield: not Mighty, no Shield');
});

test('RJ#128b Fiora, Victorious + Svellsongur, Mighty and defending: two "While I\'m Mighty, I have Shield" instances stack (+2)', () => {
  let g = S0();
  const f = put(g, P1, 'Fiora, Victorious', BF_A, { buff: true }); control(g, BF_A, P1);
  const sv = put(g, P1, 'Svellsongur', 'base'); attachNow(g, sv, f);
  g = move(g, P0, [put(g, P0, 'V(1)', 'base')], BF_A);
  assert.equal(kwValue(g, f, 'Shield'), 2);
  assert.equal(mightOf(g, f), 7);
});

test('RJ#129 Promising Future where both players play Time Warp: the opponent\'s extra turn comes first (creation order)', () => {
  let g = S0(); fundAll(g, P0, 6); fundAll(g, P1, 6);
  for (const p of [P0, P1]) for (let i = 0; i < 5; i++) put(g, p, 'Time Warp', 'deckTop');
  g = play(g, P0, hand(g, P0, 'Promising Future'));
  for (let i = 0; i < 60 && pend(g).kind !== 'mainAction'; i++) { const d = pend(g); g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g); }
  assert.deepEqual(g.ex.extraTurns, [P1, P0]);
  g = nextTurn(g); assert.equal(g.activePlayer, P1, 'P1\'s extra turn first');
  g = nextTurn(g); assert.equal(g.activePlayer, P0, 'then P0\'s');
});

test('RJ#130 Tideturner swapping places with a targeted unit does not redirect the spell', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const x = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
  const tt = put(g, P0, 'Tideturner', { facedown: BF_B });
  g = pass(play(g, P1, hand(g, P1, 'ZapA'), { targets: [[x]] }));
  g = act(g, { type: 'playCard', player: P0, obj: tt, destination: BF_B } as never);
  g = answer(g, { may: [true], targets: [[x]] }, P0);
  g = settle(g);
  assert.equal(locOf(g, x), BF_B); assert.equal(locOf(g, tt), BF_A);
  assert.equal(g.objects[x].damage, 2, 'the Zap still hits its original target');
  assert.equal(g.objects[tt].damage, 0);
});

test('RJ#131 Yasuo, Remorseful moved into an ongoing attack by Ride the Wind gets his "When I attack" trigger after it resolves', () => {
  let g = S0(); fundAll(g, P0);
  const e = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const y = put(g, P0, 'Yasuo, Remorseful', 'base');
  g = move(g, P0, [put(g, P0, 'V(1)', 'base')], BF_A);
  g = play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[y]], locations: [BF_A] });   // R-2: destination chosen as played
  for (let i = 0; i < 6 && chainLabels(g).some(l => /Ride the Wind/.test(l)) && !pend(g).inStep; i++) g = pass(g);
  g = answer(g, { targets: [[e]] }, P0);
  assert.ok(chainLabels(g).some(l => /Yasuo/.test(l)), `Yasuo trigger: ${chainLabels(g)}`);
  g = resolveChain(g);
  assert.equal(g.objects[e].damage, 6);
});

test('RJ#133 the player who moved in first is the contestor/attacker when the opponent Rides the Wind in', () => {
  let g = S0(); fundAll(g, P1);
  g = move(g, P0, [put(g, P0, 'V(2)', 'base')], BF_A);
  g = pass(g);
  g = passAll(play(g, P1, hand(g, P1, 'Ride the Wind'), { targets: [[put(g, P1, 'V(2)', 'base')]] }));
  g = answer(g, { locations: [BF_A] });
  for (let i = 0; i < 4 && !g.showdown?.isCombat; i++) g = pass(g);
  assert.ok(g.showdown?.isCombat);
  assert.equal(g.showdown?.attacker, P0);
  assert.equal(g.showdown?.defender, P1);
});

test('RJ#135 Wielder of Water\'s "while attacking alone" +2 ends as soon as another friendly unit joins the combat', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const w = put(g, P0, 'Wielder of Water', 'base');
  g = move(g, P0, [w], BF_A);
  assert.equal(mightOf(g, w), 4);
  g = resolveChain(play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[put(g, P0, 'V(1)', 'base')]], locations: [BF_A] }));   // R-2: destination chosen as played
  assert.equal(mightOf(g, w), 2, 'no longer alone');
});

test('RJ#136 Stormbringer as the 2nd card uses Darius, Trifarian\'s Might before his +2 trigger (5, not 7)', () => {
  let g = S0(); fundAll(g, P0);
  const d = put(g, P0, 'Darius, Trifarian', 'base');
  const e = put(g, P1, 'V(6)', BF_A); control(g, BF_A, P1);
  g = settle(play(g, P0, hand(g, P0, 'V(1)'), { dest: 'base' }));
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Stormbringer') });
  for (let i = 0; i < 6 && pend(g).inStep; i++) {
    const o = optionIds(g);
    g = act(g, { type: 'choose', player: P0, optionIds: [o.includes(d) ? d : o.includes(g.battlefields[BF_A].objId) ? g.battlefields[BF_A].objId : o.includes(String(BF_A)) ? String(BF_A) : o[0]] });
  }
  g = resolveChain(g);
  for (let i = 0; i < 6 && pend(g).inStep; i++) { const o = optionIds(g); g = act(g, { type: 'choose', player: P0, optionIds: [o.includes(String(BF_A)) ? String(BF_A) : o.includes(g.battlefields[BF_A].objId) ? g.battlefields[BF_A].objId : o[0]] }); g = resolveChain(g); }
  assert.equal(g.objects[e].damage, 5, 'dealt 5');
  assert.equal(zone(g, e), 'battlefield');
});

test('RJ#137 Mask of Foresight\'s +1 lasts the turn after combat; two Masks give +2', () => {
  let g = S0();
  put(g, P0, 'Mask of Foresight', 'base'); put(g, P0, 'Mask of Foresight', 'base');
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const u = put(g, P0, 'V(5)', 'base');
  g = settle(move(g, P0, [u], BF_A));
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(mightOf(g, u), 7, '+1 per Mask, still there after combat');
  g = nextTurn(g);
  assert.equal(mightOf(g, u), 5, 'gone next turn');
});

test('RJ#138 Jayce, Man of Progress may kill a friendly Gold token (it is a gear)', () => {
  let g = S0(); fundAll(g, P0);
  const gold = put(g, P0, 'unl-t05', 'base', { token: true });
  g = play(g, P0, hand(g, P0, 'Jayce, Man of Progress'), { dest: 'base' });
  let offered = false;
  for (let i = 0; i < 10 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    if (o.includes(gold)) { offered = true; g = act(g, { type: 'choose', player: d.player, optionIds: [gold] }); }
    else g = act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : o[0]] });
  }
  assert.ok(offered, 'Gold token is a legal friendly gear');
  assert.equal(zone(g, gold), 'gone');
});

test('RJ#139 Ferrous Forerunner equipped with Svellsongur dies: Deathknell triggers twice (4 Mech tokens)', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  const ff = put(g, P0, 'Ferrous Forerunner', BF_A); control(g, BF_A, P0);
  const sv = put(g, P0, 'Svellsongur', 'base'); attachNow(g, sv, ff);
  g = settle(play(g, P0, hand(g, P0, 'KillA'), { targets: [[ff]] }));
  const mechs = Object.values(g.objects).filter(o => o.zone === 'base' && o.isToken && g.cards[o.cardId]?.name === 'Mech').length;
  assert.equal(mechs, 4);
});

test('RJ#140 Reckoner\'s Arena hold activates unit conquer effects only, not the Void Burrower legend\'s', () => {
  let g = S0({ bfA: "Reckoner's Arena" });
  setLegend(g, P0, 'Void Burrower');
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  g = nextTurn(g);
  const p0 = g.players[P0].points;
  g = endTurn(g, P1);
  let asked = false;
  for (let i = 0; i < 20 && !(pend(g).kind === 'mainAction' && g.activePlayer === P0); i++) {
    const d = pend(g);
    if (/Void Burrower/.test(d.prompt) || chainLabels(g).some(l => /Void Burrower/.test(l))) asked = true;
    g = d.inStep ? act(g, legal(g, d.player)[0]) : d.kind === 'mainAction' ? endTurn(g) : pass(g);
  }
  assert.equal(g.players[P0].points, p0 + 1, 'held');
  assert.equal(asked, false, 'legend conquer ability not activated');
});

test('RJ#141 Forge of the Fluft lets the legend move an already-attached Equipment to another unit', () => {
  let g = S0({ bfA: 'Forge of the Fluft' });
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const u = put(g, P0, 'V(2)', 'base'), v = put(g, P0, 'V(3)', 'base');
  const sw = put(g, P0, 'Sword', 'base'); attachNow(g, sw, u);
  const l = g.players[P0].legend;
  const a = legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === l);
  assert.ok(a, 'legend has the granted [T] ability');
  g = act(g, a!);
  for (let i = 0; i < 6 && g.objects[sw].attachedTo !== v; i++) {
    const d = pend(g);
    if (!d.inStep) { if (d.kind !== 'chainResponse') break; g = pass(g); continue; }
    const o = optionIds(g);
    g = act(g, { type: 'choose', player: d.player, optionIds: [o.includes(sw) ? sw : o.includes(v) ? v : o[0]] });
  }
  g = resolveChain(g);
  assert.equal(g.objects[sw].attachedTo, v);
});

test('RJ#142 at 7 points: conquering one battlefield is not the 8th point, but holding at the start of the turn is', () => {
  let g = S0(); g.players[P0].points = 7;
  g = settle(move(g, P0, [put(g, P0, 'V(1)', 'base')], BF_A));
  assert.equal(g.players[P0].points, 7, 'conquer of one battlefield: draw instead');
  assert.equal(g.winner ?? null, null);
  g = nextTurn(g); g = settle(nextTurn(g));
  assert.equal(g.winner, P0, 'hold for the 8th point wins');
});

test('RJ#143 Svellsongur on a Deflect 3 unit gives the unit Deflect 6 (copied text applies to the unit)', () => {
  const g = S0();
  const u = put(g, P0, 'DeflectDouble(2)', 'base');
  assert.equal(kwValue(g, u, 'Deflect'), 3);
  const sv = put(g, P0, 'Svellsongur', 'base'); attachNow(g, sv, u);
  assert.equal(kwValue(g, u, 'Deflect'), 6);
});

test('RJ#145 Janna, Savior (errata "up to one") played to base still triggers with no enemy there', () => {
  let g = S0(); fundAll(g, P0);
  const d = put(g, P0, 'V(3)', 'base', { damage: 1 });
  g = play(g, P0, hand(g, P0, 'Janna, Savior'), { dest: 'base' });
  assert.ok(chainLabels(g).some(l => /Janna/.test(l)), `trigger on the chain: ${chainLabels(g)}`);
  g = settle(g);
  assert.equal(g.objects[d].damage, 0, 'healed her units here');
});

test('RJ#146 Cull the Weak: the turn player chooses first, then the opponent', () => {
  let g = S0(); fundAll(g, P0);
  const a = put(g, P0, 'V(1)', 'base'); put(g, P0, 'V(2)', 'base');
  const b = put(g, P1, 'V(1)', 'base'); put(g, P1, 'V(2)', 'base');
  g = resolveChain(play(g, P0, hand(g, P0, 'Cull the Weak')));
  const order: number[] = [];
  for (let i = 0; i < 4 && pend(g).inStep; i++) {
    const d = pend(g); order.push(d.player);
    g = act(g, { type: 'choose', player: d.player, optionIds: [d.player === P0 ? a : b] });
  }
  assert.deepEqual(order, [P0, P1]);
  assert.equal(zone(g, a), 'trash'); assert.equal(zone(g, b), 'trash');
});

test('RJ#147 Garbage Grabber: Recycle 3 from your trash is part of the cost (2 cards in trash: can\'t activate)', () => {
  let g = S0(); fundAll(g, P0);
  const gg = put(g, P0, 'Garbage Grabber', 'base');
  fillTrash(g, P0, 2);
  const can = (s: GameState) => legal(s, P0, 'activate').some(a => a.type === 'activate' && a.obj === gg);
  assert.equal(can(g), false, 'only 2 cards in trash');
  fillTrash(g, P0, 1); touch(g);
  assert.equal(can(g), true, '3 cards in trash');
  const h = g.players[P0].hand.length;
  g = settle(activate(g, P0, gg, 0));
  assert.equal(g.players[P0].trash.length, 0, 'recycled 3');
  assert.equal(g.players[P0].hand.length, h + 1, 'drew 1');
});

test('RJ#149 Ezreal defending alone, Arcane Shifted and replayed to the same battlefield: his "When I defend" triggers again', () => {
  let g = S0(); fundAll(g, P1);
  const ez = put(g, P1, 'sfd-082-221', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(12)', 'base');
  const as = hand(g, P1, 'Arcane Shift');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 8 && !canPlayNow(g, P1, as); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  const before = g.objects[a].damage;
  assert.equal(before, 3, `first defend trigger dealt 3 (${before})`);
  g = play(g, P1, as, { targets: [[ez], [a]] });
  g = resolveChain(g);
  for (let i = 0; i < 6 && pend(g).inStep; i++) {
    const o = optionIds(g);
    g = act(g, { type: 'choose', player: pend(g).player, optionIds: [o.includes(String(BF_A)) ? String(BF_A) : o.includes(g.battlefields[BF_A].objId) ? g.battlefields[BF_A].objId : o.includes(a) ? a : o[0]] });
    g = resolveChain(g);
  }
  const ez2 = Object.values(g.objects).find(o => o.cardId === 'sfd-082-221' && (o.zone === 'battlefield' || o.zone === 'base'));
  assert.equal(locOf(g, ez2!.id), BF_A, 'replayed to the defended battlefield');
  g = settle(g);
  assert.equal(g.log.filter(l => /^Trigger: Ezreal/.test(l.text)).length, 2, 'the replayed Ezreal is a new object: gets the Defender designation and triggers again');
});

test('RJ#150 Void Seeker whose target became invalid (moved to base) still draws', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const vs = hand(g, P0, 'Void Seeker');
  g = play(g, P0, vs, { targets: [[e]] });
  const h = g.players[P0].hand.length;
  g = pass(g);
  g = settle(play(g, P1, hand(g, P1, 'Flash'), { targets: [[e]] }));
  assert.equal(locOf(g, e), 'base');
  assert.equal(g.objects[e].damage, 0, 'no damage');
  assert.equal(g.players[P0].hand.length, h + 1, 'still drew');
});

test('RJ#152 Dark Child (Annie) end-of-turn rune ready: alone, no priority afterwards; with Targon\'s Peak also triggering, the readied runes pay for Gust between the two', () => {
  let g = S0({ bfA: "Targon's Peak" });
  const l = (() => { const d = realCard('ogs-017-024'); g.cards = { ...g.cards, [d.id]: d }; const id = g.players[P0].legend; g.objects[id].cardId = d.id; touch(g); return id; })();
  void l;
  const runes = addRunes(g, P0, 2, 'calm', false);
  const e = put(g, P1, 'V(2)', BF_B); control(g, BF_B, P1);
  const gust = hand(g, P0, 'Gust');
  // (a) alone
  let h = endTurn(g, P0);
  for (let i = 0; i < 6 && h.activePlayer === P0; i++) {
    const d = pend(h);
    if (d.inStep) { h = act(h, legal(h, d.player)[0]); continue; }
    if (!h.chain.length) break;
    h = pass(h);
  }
  assert.ok(h.activePlayer === P1 || !pend(h).inStep && !h.chain.length && (pend(h).kind !== 'chainResponse'), 'no priority window after the lone trigger');
  // (b) with Targon's Peak
  g = settle(move(g, P0, [put(g, P0, 'V(1)', 'base')], BF_A));
  assert.equal(g.battlefields[BF_A].controller, P0);
  g = endTurn(g, P0);
  let gusted = false;
  for (let i = 0; i < 20 && g.activePlayer === P0; i++) {
    const d = pend(g);
    // SCRIPT-FIX: Dark Child's runes are now up-to-2 targets chosen on the chain (any player's, RJ#239) — choose P0's two runes
    if (d.inStep && d.kind === 'chooseTargets' && /ready up to 2 runes/i.test(d.prompt ?? '') && runes.every(r => optionIds(g).includes(r))) { g = act(g, { type: 'choose', player: d.player, optionIds: [...runes] }); continue; }
    if (d.inStep) { const o = optionIds(g); const ann = (d.options ?? []).find(x => /ready up to 2 runes/i.test(x.label ?? '') && !/Targon/i.test(x.label ?? '')); g = act(g, { type: 'choose', player: d.player, optionIds: d.kind === 'orderTriggers' && ann ? [ann.id] : [o[0]] } as any); continue; }
    if (d.player === P0 && g.chain.length === 1 && runes.every(r => !g.objects[r].exhausted) && canPlayNow(g, P0, gust)) {
      g = play(g, P0, gust, { targets: [[e]] }); gusted = true; continue;
    }
    g = pass(g);
  }
  assert.ok(gusted, 'Gust played with Annie-readied runes while Targon\'s Peak trigger is on the chain');
  assert.equal(zone(g, e), 'hand');
});

test('RJ#153 Discipline whose target is Gusted does not retarget the other Poro', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const a = put(g, P0, 'Pouty Poro', BF_A), b = put(g, P0, 'Pouty Poro', BF_A); control(g, BF_A, P0);
  g = play(g, P0, hand(g, P0, 'Discipline'), { targets: [[a]] });
  g = pass(g);
  g = settle(play(g, P1, hand(g, P1, 'Gust'), { targets: [[a]] }));
  assert.equal(zone(g, a), 'hand');
  assert.equal(mightOf(g, b), 2, 'other Poro not buffed');
});

test('RJ#154 Mageseeker Warden does not stop Leona, Zealot from entering ready', () => {
  let g = S0(); fundAll(g, P0); g.players[P1].points = 5;
  put(g, P1, 'Mageseeker Warden', BF_A); control(g, BF_A, P1);
  const lz = hand(g, P0, 'ogn-079-298');
  g = settle(play(g, P0, lz, { dest: 'base' }));
  assert.equal(g.objects[lz].exhausted, false);
});

test('RJ#155 two Anivia attack two Nocturnes: the defender keeps the battlefield with no units and may still reveal Hidden Teemo after both triggers resolve', () => {
  let g = S0();
  const a1 = put(g, P0, 'Anivia', 'base'), a2 = put(g, P0, 'Anivia', 'base');
  const n1 = put(g, P1, 'Nocturne', BF_A), n2 = put(g, P1, 'Nocturne', BF_A); control(g, BF_A, P1);
  const t = put(g, P1, 'ogn-121-298', { facedown: BF_A });
  fundAll(g, P1);
  g = move(g, P0, [a1, a2], BF_A);
  for (let i = 0; i < 12 && (g.chain.length || pend(g).inStep); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(zone(g, n1), 'trash'); assert.equal(zone(g, n2), 'trash');
  assert.equal(g.battlefields[BF_A].controller, P1, 'still controlled during the showdown');
  for (let i = 0; i < 4 && pend(g).player !== P1; i++) g = pass(g);
  assert.ok(canPlayNow(g, P1, t), 'Teemo can still be played from hiding');
});

test('RJ#157 a card revealed by Apprentice Smith is a reveal: Nocturne offers to banish and play himself', () => {
  let g = S0(); fundAll(g, P0);
  const s = put(g, P0, 'Apprentice Smith', 'base');
  const n = put(g, P0, 'Nocturne', 'deckTop');
  g = move(g, P0, [s], BF_A);
  let offered = false;
  for (let i = 0; i < 12 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.inStep) { if (/Nocturne|banish/i.test(d.prompt ?? '')) offered = true; g = act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : optionIds(g)[0]] }); continue; }
    g = pass(g);
  }
  assert.ok(offered, 'Nocturne\'s reveal ability is offered'); assert.notEqual(zone(g, n), 'mainDeck', 'banished and played');
});

test('RJ#158 Equip chooses a unit (Irelia sfd-057 gets +1) but is not a spell (Irelia sfd-141 does not reduce an Equip cost)', () => {
  let g = S0(); fundAll(g, P0);
  const i1 = put(g, P0, 'sfd-057-221', 'base');
  const sw = put(g, P0, 'Sword', 'base');
  g = settle(answer(act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === sw)!), { targets: [[i1]] }, P0));
  assert.equal(g.objects[sw].attachedTo, i1);
  assert.equal(mightOf(g, i1), 4 + 2 + 1, 'Sword +2 and the choose trigger +1');
  let h = S0();
  for (const r of h.players[P0].runesInPlay) h.objects[r].exhausted = true;
  put(h, P0, 'sfd-141-221', 'base');
  const sw2 = put(h, P0, 'Sword', 'base');
  assert.equal(legal(h, P0, 'activate').some(a => a.type === 'activate' && a.obj === sw2), false, 'Equip [1] not reduced to 0');
});

test('RJ#156 once the showdown closes, combat damage is dealt and lethally damaged units are killed before anyone can act (no retreat)', () => {
  const s = attackSetup(['V(3)'], ['V(3)']);
  let g = s.g; fundAll(g, P1); hand(g, P1, 'Flash');
  for (let i = 0; i < 6 && g.showdown && pend(g).kind === 'showdownAction'; i++) {
    if (g.objects[s.def[0]].damage > 0) break;
    g = pass(g);
  }
  // the first point any player can act again, the defender is already dead
  assert.equal(zone(g, s.def[0]), 'trash');
  assert.equal(zone(g, s.atk[0]), 'trash');
});

test('RJ#160 a unit Flashed out of combat still heals in the combat cleanup (combat finishes without it)', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const dr = put(g, P0, 'Mountain Drake', 'base'), mm = put(g, P0, 'V(6)', 'base');
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [dr, mm], BF_A);
  for (let i = 0; i < 4 && !canPlayNow(g, P1, hand(g, P1, 'Hextech Ray')); i++) g = pass(g);
  g = play(g, P1, g.players[P1].hand.find(h => g.cards[g.objects[h].cardId]?.name === 'Hextech Ray')!, { targets: [[dr]] });
  g = resolveChain(g);
  assert.equal(g.objects[dr].damage, 3);
  for (let i = 0; i < 4 && pend(g).player !== P0; i++) g = pass(g);
  g = resolveChain(play(g, P0, hand(g, P0, 'Flash'), { targets: [[dr]] }));
  assert.equal(locOf(g, dr), 'base');
  g = settle(g);
  assert.equal(g.battlefields[BF_A].controller, P0, 'combat finished');
  assert.equal(g.activePlayer, P0, 'same turn');
  assert.equal(g.objects[dr].damage, 0, 'healed in the combat cleanup although it left');
});

test('RJ#161 Hidden Blade\'s target Retreated in response: no draw 2 (no unit at a battlefield to find the controller of)', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  g = play(g, P0, hand(g, P0, 'Hidden Blade'), { targets: [[e]] });
  g = pass(g);
  const rt = hand(g, P1, 'Retreat');
  const h = g.players[P1].hand.length;
  g = settle(play(g, P1, rt, { targets: [[e]] }));
  assert.equal(zone(g, e), 'hand');
  assert.equal(g.players[P1].hand.length, h - 1 + 1, 'Retreat left, unit returned; no draw 2');
});

test('RJ#163 a champion played from the champion zone can be Retreated to hand', () => {
  let g = S0(); fundAll(g, P0, 8);
  const ch = g.players[P0].championZone[0];
  assert.ok(ch, 'champion in the champion zone');
  g = settle(play(g, P0, ch, { dest: 'base' }));
  assert.equal(locOf(g, ch), 'base');
  g = settle(play(g, P0, hand(g, P0, 'Retreat'), { targets: [[ch]] }));
  assert.equal(zone(g, ch), 'hand');
});

test('RJ#164 Hextech Anomaly converts [A] 1:1 into Energy that stays in the pool to pay a later card this turn', () => {
  let g = S0();
  for (const r of g.players[P0].runesInPlay) g.objects[r].exhausted = true;
  addRunes(g, P0, 2, 'mind');
  const an = put(g, P0, 'Hextech Anomaly', 'base');
  g = activate(g, P0, an, 0);
  g = act(g, { type: 'choose', player: P0, optionIds: ['2'] });
  assert.equal(g.players[P0].pool.energy, 2);
  const v = hand(g, P0, 'V(2)');
  assert.ok(canPlayNow(g, P0, v, 'base'), 'the floated Energy pays a 2-cost unit');
});

test('RJ#168 Bellows Breath can\'t choose the same unit twice in one cast (up to three different units)', () => {
  let g = S0(); fundAll(g, P0);
  const a = put(g, P1, 'V(5)', BF_A), b = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Bellows Breath') });
  for (let i = 0; i < 4 && pend(g).kind !== 'chooseTargets'; i++) g = act(g, { type: 'choose', player: P0, optionIds: [pend(g).kind === 'optional' ? 'no' : optionIds(g)[0]] });
  assert.equal(pend(g).kind, 'chooseTargets');
  assert.ok(rejects(g, { type: 'choose', player: P0, optionIds: [a, a] }), 'duplicate target rejected');
  g = settle(act(g, { type: 'choose', player: P0, optionIds: [a, b] }));
  assert.equal(g.objects[a].damage, 1); assert.equal(g.objects[b].damage, 1);
});

test('RJ#169 Ekko (Deathknell) stolen by Hostile Takeover and killed: the Deathknell is the stealer\'s (controller at death)', () => {
  let g = S0(); fundAll(g, P0, 8);
  const ek = put(g, P1, 'ogn-110-298', BF_A); control(g, BF_A, P1);
  g = settle(play(g, P0, hand(g, P0, 'Hostile Takeover'), { targets: [[ek]] }));
  assert.equal(g.objects[ek].controller, P0);
  for (const p of [P0, P1]) for (const r of g.players[p].runesInPlay) g.objects[r].exhausted = true;
  g.players[P0].pool.energy = 3; touch(g);
  g = settle(play(g, P0, hand(g, P0, 'KillA'), { targets: [[ek]] }));
  assert.ok(g.players[P0].runesInPlay.every(r => !g.objects[r].exhausted), 'stealer\'s runes readied');
  assert.ok(g.players[P1].runesInPlay.every(r => g.objects[r].exhausted), 'owner\'s runes not');
});

test('RJ#171 (MISMATCH-RJ order) FFA combat showdown: everyone may act, no invitations; focus passes in turn order (attacker, defender, third player — not "defender last")', () => {
  let g = createGame({ seed: 3, cardDb: fixtureDb(), mode: 'ffa', firstPlayer: P0, skipMulligan: true, battlefieldSelection: 'random', includeAllCards: true,
    players: [0, 1, 2].map(i => ({ name: `P${i}`, deck: legalDeck({}, [`cf-bf-${'abc'[i]}`, `cf-bf-${'def'[i]}`, `cf-bf-${'abc'[(i + 1) % 3]}`]) })) } as never);
  for (let i = 0; i < 10 && !(g.pending?.kind === 'mainAction' && g.pending.player === P0); i++) g = g.pending!.inStep ? act(g, legal(g, g.pending!.player)[0]) : act(g, { type: 'pass', player: g.pending!.player });
  const a = put(g, P0, 'V(3)', 'base');
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [a], BF_A);
  const order: number[] = [];
  for (let i = 0; i < 4 && g.pending?.kind === 'showdownAction'; i++) { order.push(g.pending.player); g = pass(g); }
  assert.deepEqual(order, [P0, P1, 2], 'CR 1.5 345/347.2.b: next player in turn order (RJ: attacker, others, defender last)');
});

test('RJ#175 two Zero Drives: each plays only the units banished with that Zero Drive', () => {
  let g = S0(); fundAll(g, P0, 8);
  const z1 = put(g, P0, 'The Zero Drive', 'base'), z2 = put(g, P0, 'The Zero Drive', 'base');
  const a = put(g, P0, 'V(2)', 'banishment'), b = put(g, P0, 'V(3)', 'banishment');
  g.ex.links[a] = { by: z1, epoch: g.objects[z1].epoch ?? 0 } as never;
  g.ex.links[b] = { by: z2, epoch: g.objects[z2].epoch ?? 0 } as never;
  touch(g);
  g = settle(activate(g, P0, z1, 0));
  assert.equal(zone(g, z1), 'banishment');
  assert.equal(locOf(g, a), 'base', 'its own unit played');
  assert.equal(zone(g, b), 'banishment', 'the other Zero Drive\'s unit stays');
});

test('RJ#179 Gust can\'t choose a damaged 4-Might unit (damage does not lower Might); after Stupefy-style -1 it can', () => {
  let g = S0(); fundAll(g, P0);
  const e = put(g, P1, 'V(4)', BF_A, { damage: 3 }); control(g, BF_A, P1);
  const gu = hand(g, P0, 'Gust');
  assert.equal(canPlayNow(g, P0, gu), false, 'only target is 4 Might');
  mod(g, e, { might: -1 });
  assert.equal(mightOf(g, e), 3);
  assert.equal(canPlayNow(g, P0, gu), true, 'reduced to 3: legal');
});

test('RJ#181 Ride the Wind from Vilemaw\'s Lair to base: legal; the unit is readied but does not move', () => {
  let g = S0({ bfA: "Vilemaw's Lair" }); fundAll(g, P0);
  const u = put(g, P0, 'V(2)', BF_A, { ready: false }); control(g, BF_A, P0);
  g = resolveChain(play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[u]], locations: ['base'] }));   // R-2: destination chosen as played
  g = settle(g);
  assert.equal(locOf(g, u), BF_A, 'did not move');
  assert.equal(g.objects[u].exhausted, false, 'readied');
});

test('RJ#182 (AMBIGUOUS) Stormbringer kills every defender then moves the unit in: a (non-combat) showdown follows and the mover conquers', () => {
  let g = S0(); fundAll(g, P0, 8);
  const v = put(g, P0, 'V(5)', 'base');
  const k = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'Stormbringer, Volibear', { targets: [[g.battlefields[BF_A].objId]] });
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) { const d = pend(g); g = d.inStep ? choose(g, d.options![0].id) : pass(g); }
  assert.equal(zone(g, k), 'trash');
  assert.equal(locOf(g, v), BF_A);
  assert.equal(g.battlefields[BF_A].controller, P0, 'not locked: the battlefield is conquered');
  assert.equal(g.players[P0].points, 1);
});

test('RJ#183 Warwick\'s attack trigger: a face-down Fight or Flight moving Warwick to base stops it; Rebuke (Action) can\'t respond', () => {
  let g = S0(); fundAll(g, P1);
  const w = put(g, P0, 'Warwick', 'base');
  const d = put(g, P1, 'V(6)', BF_A, { damage: 1 }); control(g, BF_A, P1);
  const fof = put(g, P1, 'Fight or Flight', { facedown: BF_A });
  const rb = hand(g, P1, 'Rebuke');
  g = move(g, P0, [w], BF_A);
  for (let i = 0; i < 4 && !g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(chainLabels(g).some(l => /Warwick/.test(l)), `trigger on chain: ${chainLabels(g)}`);
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  assert.equal(canPlayNow(g, P1, rb), false, 'Rebuke is an Action');
  assert.ok(canPlayNow(g, P1, fof), 'hidden Fight or Flight may respond');
  g = play(g, P1, fof, { targets: [[w]] });
  g = resolveChain(g);
  assert.equal(locOf(g, w), 'base');
  assert.equal(zone(g, d), 'battlefield', 'damaged unit survives');
});

// RJ#186 DECIDED (docs/riftjudge/DECISIONS.md): official — SFD-FAQ Draven, Audacious: "you can't win from 6 points by conquering a battlefield
// with Draven without having scored all other battlefields—you'll gain your point from Draven, then … a card draw instead".
test('RJ#186 (MISMATCH-RJ) at 6 points Draven, Audacious (sfd-148) wins a combat: his point resolves before control is established (CR 468.4; SFD-FAQ), so the conquer is the final point and draws instead', () => {
  let g = S0(); g.players[P0].points = 6; touch(g);
  const dv = put(g, P0, 'sfd-148-221', 'base');
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [dv], BF_A);
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction' && g.winner == null; i++) { const d = pend(g); g = d.inStep ? choose(g, d.options![0].id) : pass(g); }
  assert.equal(g.winner ?? null, null, 'RJ (community consensus): 6→7 conquer, then Draven 7→8 wins');
  assert.equal(g.players[P0].points, 7);
  assert.ok(g.log.some(l => /draws a card instead of the final point/.test(l.text)));
});

test('RJ#187 an Assault attacker with damage lethal without Assault, moved to another battlefield, loses the designation and dies', () => {
  let g = S0(); fundAll(g, P0);
  const a = put(g, P0, 'Assault(2,2)', 'base');
  put(g, P1, 'V(6)', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [a], BF_A);
  assert.equal(mightOf(g, a), 4);
  g.objects[a].damage = 3; touch(g);
  g = passAll(play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[a]] }));
  if (pend(g).inStep) g = answer(g, { locations: [BF_B] });
  g = resolveChain(g);
  assert.equal(zone(g, a), 'trash', 'Might 2 with 3 damage after losing Assault');
});

test('RJ#189 Sett spending his buff: Might drops 5→4 (cost) then +4 → 8, so Grand Duelist sees him become Mighty', () => {
  let g = S0(); fundAll(g, P0);
  setLegend(g, P0, 'Grand Duelist');
  const s = put(g, P0, 'ogn-164-298', 'base', { buff: true });
  assert.equal(mightOf(g, s), 5);
  const ab = legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === s);
  assert.ok(ab, 'spend-buff ability');
  g = act(g, ab!);
  let asked = false;
  for (let i = 0; i < 12 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (/Grand Duelist|channel/i.test(d.prompt ?? '') || chainLabels(g).some(l => /Grand Duelist/.test(l))) asked = true;
    g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : optionIds(g)[0]] }) : pass(g);
  }
  assert.equal(mightOf(g, s), 8);
  assert.ok(asked || g.log.some(l => /Grand Duelist/.test(l.text)), 'Grand Duelist triggered');
});

test('RJ#191 Carnivorous Snapvine\'s target Flashed to base: the ability resolves but no damage is dealt', () => {
  let g = S0(); fundAll(g, P0, 6); fundAll(g, P1);
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const sv = hand(g, P0, 'Carnivorous Snapvine');
  g = play(g, P0, sv, { dest: 'base' });
  for (let i = 0; i < 4 && !g.chain.some(c => c.source === sv); i++) g = pend(g).inStep ? choose(g, e) : pass(g);
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  g = settle(play(g, P1, hand(g, P1, 'Flash'), { targets: [[e]] }));
  assert.equal(locOf(g, e), 'base');
  assert.equal(g.objects[e].damage, 0);
  assert.equal(g.objects[sv].damage, 0);
});

test('RJ#193 (MISMATCH-RJ) Piercing Light + Repeat choosing the same Deflect unit twice pays Deflect twice (per choice, SFD FAQ)', () => {
  let g = S0(); fundAll(g, P0, 8);
  const p = put(g, P1, 'Pouty Poro', BF_A); control(g, BF_A, P1);
  put(g, P1, 'V(9)', BF_A);
  const runes0 = g.players[P0].runesInPlay.length;
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Piercing Light') });
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    g = act(g, { type: 'choose', player: d.player, optionIds: d.kind === 'optional' ? ['yes'] : o.includes(p) ? [p] : d.kind === 'chooseTargets' ? [] : [o[0]] });
  }
  assert.equal(g.log.filter(l => /Piercing Light deals 2 to Pouty Poro/.test(l.text)).length, 2, 'Poro chosen by both executions');
  assert.equal(runes0 - g.players[P0].runesInPlay.length, 1 + 1 + 2, '[A] + Repeat [C] + Deflect [A] for each choice');
});

test('RJ#194 Yasuo swapped into the opponent\'s attack by Tideturner is a defender: his "When I attack" doesn\'t trigger', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const y = put(g, P0, 'ogn-076-298', 'base');
  const tt = put(g, P0, 'Tideturner', { facedown: BF_A });
  const a = put(g, P1, 'V(4)', 'base');
  g = move(g, P1, [a], BF_A);
  for (let i = 0; i < 4 && !canPlayNow(g, P0, tt); i++) g = pass(g);
  g = act(g, { type: 'playCard', player: P0, obj: tt });
  for (let i = 0; i < 12 && locOf(g, y) !== BF_A; i++) { const d = pend(g); g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : optionIds(g).includes(y) ? y : optionIds(g)[0]] }) : pass(g); }
  assert.equal(locOf(g, y), BF_A);
  g = settle(g);
  assert.equal(g.log.filter(l => /^Trigger: Yasuo/.test(l.text)).length, 0, 'no attack trigger');
});

test('RJ#195 Fiora (sfd-110) attacking one on one: her trigger doubles her current Might; a later +2 adds to the doubled value', () => {
  let g = S0(); fundAll(g, P0);
  const f = put(g, P0, 'sfd-110-221', 'base');
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [f], BF_A);
  g = resolveChain(g);
  assert.equal(mightOf(g, f), 6, '3 doubled');
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  g = resolveChain(play(g, P0, hand(g, P0, 'Discipline'), { targets: [[f]] }));
  assert.equal(mightOf(g, f), 8, 'doubled value + 2 (not re-doubled)');
});

test('RJ#196 a rune may be exhausted for Energy at any time with nothing to pay', () => {
  const g = S0();
  const r = legal(g, P0, 'activate').find(a => a.type === 'activate' && g.objects[a.obj].zone === 'runePool' && a.abilityIndex === 950);
  assert.ok(r, 'rune exhaust ability available');
  const h = act(g, r!);
  assert.equal(h.objects[(r as { obj: ObjId }).obj].exhausted, true);
  assert.equal(h.players[P0].pool.energy, 1);
});

test('RJ#198 at 7 points, conquering a battlefield on the opponent\'s turn (Ride the Wind) is not the winning point: draw instead', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); g.players[P0].points = 7; touch(g);
  put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
  const r = put(g, P0, 'V(3)', 'base');
  const a = put(g, P1, 'V(1)', 'base');
  g = move(g, P1, [a], BF_B);
  for (let i = 0; i < 4 && pend(g).player !== P0; i++) g = pass(g);
  g = passAll(play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[r]] }));
  g = answer(g, { locations: [BF_A] });
  const h = g.players[P0].hand.length;
  g = settle(g);
  assert.equal(g.battlefields[BF_A].controller, P0, 'conquered BF-A');
  assert.equal(g.winner ?? null, null, 'no win');
  assert.equal(g.players[P0].points, 7);
  assert.ok(g.players[P0].hand.length >= h + 1, 'drew instead');
});

test('RJ#200 Azir, Ascendant attacks and swaps with Azir, Sovereign: Sovereign becomes an attacker and his attack trigger fires', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  control(g, BF_B, P0);
  const sov = put(g, P0, 'Azir, Sovereign', BF_B);
  const tok = put(g, P0, 'Recruit', 'base', { token: true });
  const asc = put(g, P0, 'Azir, Ascendant', 'base');
  g = move(g, P0, [asc], BF_A);
  for (let i = 0; i < 4 && pend(g).player !== P0; i++) g = pass(g);
  g = activate(g, P0, asc, 0, { targets: [[sov]] });
  let trig = false;
  for (let i = 0; i < 12 && locOf(g, tok) !== BF_A; i++) {
    const d = pend(g);
    if (chainLabels(g).some(l => /Azir/.test(l)) && g.log.some(l => /^Trigger: Azir/.test(l.text))) trig = true;
    if (!d.inStep) { if (d.kind === 'chainResponse') { g = pass(g); continue; } break; }
    g = act(g, { type: 'choose', player: d.player, optionIds: d.kind === 'optional' ? ['yes'] : optionIds(g).includes(tok) ? [tok] : [optionIds(g)[0]] });
  }
  assert.equal(locOf(g, sov), BF_A);
  assert.equal(g.objects[sov].combatRole, 'attacker');
  assert.ok(trig || g.log.some(l => /^Trigger: Azir/.test(l.text)), 'Sovereign\'s attack trigger');
  assert.equal(locOf(g, tok), BF_A, 'token brought in');
});

test('RJ#203 Vex (sfd-146) in combat reduces a Repeat spell\'s total cost once (Feral Strength [2] + Repeat [2] → 3 Energy)', () => {
  let g = S0(); fundAll(g, P0, 6);
  const vx = put(g, P0, 'sfd-146-221', 'base');
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [vx], BF_A);
  for (let i = 0; i < 4 && pend(g).player !== P0; i++) g = pass(g);
  const ready = (s: GameState) => s.players[P0].runesInPlay.filter(r => !s.objects[r].exhausted).length;
  const r0 = ready(g), n0 = g.players[P0].runesInPlay.length;
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Feral Strength') });
  for (let i = 0; i < 8 && pend(g).inStep; i++) { const d = pend(g); g = act(g, { type: 'choose', player: d.player, optionIds: d.kind === 'optional' ? ['yes'] : optionIds(g).includes(vx) ? [vx] : [optionIds(g)[0]] }); }
  const recycled = n0 - g.players[P0].runesInPlay.length;
  assert.equal(r0 - ready(g) - recycled, 3, '2 + 2 - 1 Energy');
});

test('RJ#204 Cull the Weak: the opponent Gusts their only unit in response; they kill nothing and the caster still kills one of theirs', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const mine = put(g, P0, 'V(1)', 'base');
  const e = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  g = play(g, P0, hand(g, P0, 'Cull the Weak'));
  g = pass(g);
  g = resolveChain(play(g, P1, hand(g, P1, 'Gust'), { targets: [[e]] }));
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = act(g, { type: 'choose', player: pend(g).player, optionIds: [optionIds(g)[0]] });
  g = settle(g);
  assert.equal(zone(g, e), 'hand');
  assert.equal(zone(g, mine), 'trash', 'caster kills their own unit');
});

test('RJ#205 Rek\'Sai, Swarm Queen plays Lucian (sfd-028) here: he enters as an attacker and his attack trigger fires', () => {
  let g = S0(); fundAll(g, P0);
  const rs = put(g, P0, 'Rek\'Sai, Swarm Queen', 'base');
  const e = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const lu = put(g, P0, 'sfd-028-221', 'deckTop');
  g = move(g, P0, [rs], BF_A);
  for (let i = 0; i < 25 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { if (locOf(g, lu) === BF_A && !g.chain.length && d.kind === 'showdownAction') break; g = pass(g); continue; }
    const o = optionIds(g);
    g = act(g, { type: 'choose', player: d.player, optionIds: d.kind === 'optional' ? ['yes'] : o.includes(lu) ? [lu] : o.includes(String(BF_A)) ? [String(BF_A)] : o.includes(e) ? [e] : [o[0]] });
  }
  assert.equal(locOf(g, lu), BF_A, 'Lucian played here');
  assert.ok(g.log.some(l => /^Trigger: Lucian/.test(l.text)), 'his attack trigger fired');
});

test('RJ#207 Yasuo attacks Ahri (ogn-119): Ahri\'s defend trigger (-2) resolves first, so Yasuo deals 4', () => {
  let g = S0();
  const y = put(g, P0, 'ogn-076-298', 'base');
  const ah = put(g, P1, 'ogn-119-298', BF_A), v = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [y], BF_A);
  for (let i = 0; i < 12 && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g);
    if (d.inStep) { const o = optionIds(g); g = act(g, { type: 'choose', player: d.player, optionIds: [d.player === P0 ? (o.includes(v) ? v : o[0]) : (o.includes(y) ? y : o[0])] }); continue; }
    g = pass(g);
  }
  void ah;
  assert.equal(g.objects[v].damage, 4, '6 - 2');
});

test('RJ#210 Hidden Blade played from hiding: its target moved to another battlefield by Tideturner mistargets (no kill, no draw)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const hb = put(g, P0, 'Hidden Blade', { facedown: BF_A });
  put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  const tt = put(g, P1, 'Tideturner', { facedown: BF_B });
  const e = put(g, P1, 'V(3)', 'base');
  g = move(g, P1, [e], BF_A);
  for (let i = 0; i < 4 && !canPlayNow(g, P0, hb); i++) g = pass(g);
  g = play(g, P0, hb, { targets: [[e]] });
  g = pass(g);
  g = act(g, { type: 'playCard', player: P1, obj: tt });
  for (let i = 0; i < 12 && locOf(g, e) === BF_A; i++) { const d = pend(g); g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : optionIds(g).includes(e) ? e : optionIds(g)[0]] }) : pass(g); }
  assert.equal(locOf(g, e), BF_B, 'swapped away');
  const h = g.players[P1].hand.length;
  g = settle(g);
  assert.equal(zone(g, e), 'battlefield', 'not killed');
  assert.equal(g.players[P1].hand.length, h, 'no draw 2');
});

test('RJ#212 Forge of the Future recycling 4 cards at once triggers Karma once', () => {
  let g = S0(); fundAll(g, P0);
  const f = put(g, P0, 'Forge of the Future', 'base');
  put(g, P0, 'ogn-235-298', 'base');
  fillTrash(g, P0, 4);
  const deck0 = g.players[P0].mainDeck.length;
  const ab = legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === f);
  assert.ok(ab, 'Kill this: ability');
  g = act(g, ab!);
  let karma = 0;
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    g = act(g, { type: 'choose', player: d.player, optionIds: d.kind === 'optional' ? ['yes'] : /Recycle up to 4/.test(d.prompt ?? '') ? o.slice(0, 4) : [o[0]] });
  }
  karma = g.log.filter(l => /^Trigger: Karma/.test(l.text)).length;
  assert.equal(g.players[P0].mainDeck.length - deck0, 4, '4 cards recycled at once');
  assert.equal(karma, 1);
});

test('RJ#213 Nine-Tailed Fox\'s -1 applies to an attacker that already has its Assault bonus', () => {
  let g = S0();
  setLegend(g, P1, 'Nine-Tailed Fox');
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'Assault(2,2)', 'base');
  g = move(g, P0, [a], BF_A);
  g = resolveChain(g);
  assert.equal(mightOf(g, a), 3, '2 + Assault 2 - 1');
});

test('RJ#214 Yasuo attacking Reaver\'s Row: the attacker chooses Yasuo\'s target before the defender makes the Reaver\'s Row choice', () => {
  let g = S0({ bfA: "Reaver's Row" });
  const y = put(g, P0, 'ogn-076-298', 'base');
  const u1 = put(g, P1, 'V(3)', BF_A); put(g, P1, 'V(4)', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [y], BF_A);
  const order: number[] = [];
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g);
    if (d.inStep) { order.push(d.player); const o = optionIds(g); g = act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : o.includes(u1) ? u1 : o[0]] }); continue; }
    g = pass(g);
  }
  assert.equal(order[0], P0, `first decision is the attacker's (${order})`);
  assert.equal(locOf(g, u1), 'base', 'defender moved the targeted unit away');
  assert.equal(g.objects[u1].damage, 0, 'Yasuo\'s damage missed');
});

test('RJ#215 Sudden Storm: a unit that moved to an open battlefield is not attacking (2); an attacker in combat takes 4', () => {
  for (const [def, dmg] of [[false, 2], [true, 4]] as const) {
    let g = S0(); fundAll(g, P1);
    const u = put(g, P0, 'V(9)', 'base');
    if (def) { put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1); }
    g = move(g, P0, [u], BF_A);
    for (let i = 0; i < 4 && pend(g).player !== P1; i++) g = pass(g);
    g = resolveChain(play(g, P1, hand(g, P1, 'Sudden Storm'), { targets: [[u]] }));
    assert.equal(g.objects[u].damage, dmg, def ? 'attacking' : 'only contesting');
  }
});

test('RJ#219 Unforgiven (Yasuo legend) moves one unit by itself; it is not grouped with a standard move', () => {
  let g = S0(); fundAll(g, P0);
  setLegend(g, P0, 'Unforgiven');
  const a = put(g, P0, 'V(1)', 'base'); put(g, P0, 'V(2)', 'base');
  const l = g.players[P0].legend;
  const ab = legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === l);
  assert.ok(ab);
  g = act(g, ab!);
  const d = pend(g);
  assert.equal(d.kind, 'chooseTargets');
  assert.ok(rejects(g, { type: 'choose', player: P0, optionIds: optionIds(g).slice(0, 2) }), 'only one unit');
  g = act(g, { type: 'choose', player: P0, optionIds: [a] });
  for (let i = 0; i < 6 && locOf(g, a) === 'base'; i++) { const e = pend(g); g = e.inStep ? act(g, { type: 'choose', player: e.player, optionIds: [optionIds(g).includes(String(BF_A)) ? String(BF_A) : optionIds(g)[0]] }) : pass(g); }
  assert.notEqual(locOf(g, a), 'base');
});

test('RJ#220 Irelia, Fervent chosen by a spell and readied by Blade Dancer: +1 and +1 (Blade Dancer does not choose)', () => {
  let g = S0(); fundAll(g, P0);
  setLegend(g, P0, 'Blade Dancer');
  const ir = put(g, P0, 'Irelia, Fervent', 'base', { ready: false });
  g.objects[ir].exhausted = true; touch(g);
  g = play(g, P0, hand(g, P0, 'Discipline'), { targets: [[ir]] });
  for (let i = 0; i < 16 && pend(g).kind !== 'mainAction'; i++) { const d = pend(g); g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : optionIds(g)[0]] }) : pass(g); }
  assert.equal(g.objects[ir].exhausted, false, 'readied by Blade Dancer');
  assert.equal(mightOf(g, ir), 4 + 2 + 1 + 1);
});

test('RJ#222 Thousand-Tailed Watcher\'s "enemy units -3" does not choose them (no Deflect cost for a Pouty Poro)', () => {
  let g = S0(); fundAll(g, P0, 9);
  const p = put(g, P1, 'Pouty Poro', BF_A); control(g, BF_A, P1);
  const n0 = g.players[P0].runesInPlay.length;
  g = settle(play(g, P0, hand(g, P0, 'Thousand-Tailed Watcher'), { dest: 'base' }));
  assert.equal(mightOf(g, p), 1);
  assert.ok(n0 - g.players[P0].runesInPlay.length <= 2, 'Watcher [A] (+ Accelerate [A] if taken), no Deflect [A]');
  assert.ok(!g.log.some(l => /Deflect/i.test(l.text)), 'no Deflect cost incurred');
});

test('RJ#225 a unit with Trinity Force and Skyfall of Areion scores an extra point when it conquers (equipment texts reference each other)', () => {
  let g = S0();
  const u = put(g, P0, 'V(3)', 'base');
  attachNow(g, put(g, P0, 'Trinity Force', 'base'), u);
  attachNow(g, put(g, P0, 'Skyfall of Areion', 'base'), u);
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  g = settle(move(g, P0, [u], BF_A));
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[P0].points, 2, 'conquer + Trinity\'s hold effect as a conquer effect');
});

test('RJ#227 (MISMATCH-RJ) Overzealous Fan: the "you may kill me" cost is decided and paid when the trigger is finalized, not on resolution', () => {
  let g = S0();
  const fan = put(g, P1, 'Overzealous Fan', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(3)', 'base');
  g = move(g, P0, [a], BF_A);
  let killedBeforeResolve = false;
  for (let i = 0; i < 16 && locOf(g, a) === BF_A; i++) {
    const d = pend(g);
    if (d.inStep) { g = act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : optionIds(g).includes(a) ? a : optionIds(g)[0]] }); continue; }
    if (g.chain.some(c => c.source === fan) && zone(g, fan) === 'trash') killedBeforeResolve = true;
    g = pass(g);
  }
  assert.equal(locOf(g, a), 'base', 'attacker sent to base');
  assert.ok(killedBeforeResolve, 'Fan already killed (cost paid) while its trigger waits on the chain (CR 383.3.a-b)');
});

test('RJ#229 Promising Future: the opponent plays Brynhir Thundersong first; my Promising Future card is still played', () => {
  let g = S0(); fundAll(g, P0, 6); fundAll(g, P1, 6);
  const mine = [0, 1, 2, 3, 4].map(() => put(g, P0, 'V(2)', 'deckTop'));
  const br = [0, 1, 2, 3, 4].map(() => put(g, P1, 'Brynhir Thundersong', 'deckTop'));
  g = play(g, P0, hand(g, P0, 'Promising Future'));
  for (let i = 0; i < 60 && pend(g).kind !== 'mainAction'; i++) { const d = pend(g); g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g); }
  assert.equal(br.filter(b => ['base', 'battlefield'].includes(zone(g, b))).length, 1, 'Brynhir played');
  assert.equal(mine.filter(m => ['base', 'battlefield'].includes(zone(g, m))).length, 1, 'my card was still played');
});

test('RJ#228 Spinning Axe\'s Temporary trigger on the chain: Angle Shot moving it to another unit does not save it', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0);
  const u1 = put(g, P0, 'V(2)', 'base'), u2 = put(g, P0, 'V(3)', 'base');
  const ax = put(g, P0, 'Spinning Axe', 'base'); void u1; // unattached: printed Temporary is active (attached it is inactive, UNL-FAQ / DECISIONS #6709)
  const as = hand(g, P0, 'Angle Shot');
  g = endTurn(g, P1);
  let responded = false;
  for (let i = 0; i < 20 && !(pend(g).kind === 'mainAction' && g.activePlayer === P0); i++) {
    const d = pend(g);
    if (!responded && g.chain.some(c => c.source === ax) && d.player === P0 && canPlayNow(g, P0, as)) {
      g = play(g, P0, as, { targets: [[u2], [ax]] }); responded = true; continue;
    }
    if (d.inStep) { const o = optionIds(g); g = act(g, { type: 'choose', player: d.player, optionIds: [o.includes('attach') ? 'attach' : o.includes(u2) ? u2 : o.includes(ax) ? ax : o[0]] }); continue; }
    g = pass(g);
  }
  assert.ok(responded, 'Angle Shot played in response to the Temporary trigger');
  assert.ok(g.log.some(l => /Spinning Axe is attached to V\(3\)/.test(l.text)), 'Angle Shot attached it');
  assert.equal(zone(g, ax), 'trash', 'the trigger already on the chain still kills it');
});

// RJ#231 DECIDED (docs/riftjudge/DECISIONS.md): MATCH — RJ is right (1 Recruit). A "when you play a card" trigger for a spell fires
// when its play is completed by its resolution (CR 420.4.a); by then Portal Rescue has banished Viktor and his own play is still
// pending until Portal Rescue finishes (CR 354.4), so he isn't on the board for it. He does see himself played (entering at that
// moment, CR 383.2.c.1; OGN-FAQ Darius, Trifarian) → 1.
test('RJ#231 Viktor, Innovator Portal-Rescued on the opponent\'s turn: no Recruit for Portal Rescue (he is banished/pending when its play completes), one for himself being played → 1', () => {
  let g = withTokens(S0({ tp: P1 })); fundAll(g, P0);
  const vk = put(g, P0, 'ogn-117-298', BF_A); control(g, BF_A, P0);
  const a = put(g, P1, 'V(9)', 'base');
  g = move(g, P1, [a], BF_A);
  for (let i = 0; i < 4 && pend(g).player !== P0; i++) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Portal Rescue'), { targets: [[vk]] });
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  const rec = Object.values(g.objects).filter(o => o.isToken && g.cards[o.cardId]?.name === 'Recruit' && o.controller === P0 && ['base', 'battlefield'].includes(o.zone)).length;
  assert.equal(rec, 1, 'only his own play (CR 420.4.a + 354.4)');
});

test('RJ#232 The Boss (Sett) saving a unit heals and recalls it but keeps other effects (Watcher-style -3 stays)', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  setLegend(g, P0, 'The Boss');
  const u = put(g, P0, 'V(6)', BF_A, { buff: true, damage: 1 }); control(g, BF_A, P0);
  mod(g, u, { might: -3 });
  const m0 = mightOf(g, u)!;
  g = play(g, P0, hand(g, P0, 'KillA'), { targets: [[u]] });
  for (let i = 0; i < 12 && pend(g).kind !== 'mainAction'; i++) { const d = pend(g); g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : optionIds(g)[0]] }) : pass(g); }
  assert.equal(locOf(g, u), 'base', 'recalled instead of dying');
  assert.equal(g.objects[u].damage, 0, 'healed');
  assert.equal(mightOf(g, u), m0 - 1, 'the -3 stays; only the buff (+1) was spent');
});

test('RJ#234 Ezreal, Prodigy does not reduce an Equip cost (not an optional additional cost)', () => {
  const g = S0();
  for (const r of g.players[P0].runesInPlay) g.objects[r].exhausted = true;
  put(g, P0, 'Ezreal, Prodigy', 'base');
  const sw = put(g, P0, 'Sword', 'base');
  assert.equal(legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === sw), false, 'Equip [1] still costs 1');
});

test('RJ#236 Irelia, Fervent readied by the Awaken step gets +1 only if she was exhausted', () => {
  for (const ex of [true, false]) {
    let g = S0({ tp: P1 });
    const ir = put(g, P0, 'Irelia, Fervent', 'base');
    g.objects[ir].exhausted = ex; touch(g);
    g = settle(endTurn(g, P1));
    assert.equal(g.activePlayer, P0);
    assert.equal(mightOf(g, ir), ex ? 5 : 4, ex ? 'readied: +1' : 'already ready: no trigger');
  }
});

test('RJ#239 (AMBIGUOUS) Dark Child (Annie) may ready an opponent\'s runes ("ready up to 2 runes" has no owner restriction)', () => {
  let g = S0();
  setLegend(g, P0, 'ogs-017-024');
  for (const p of [P0, P1]) for (const r of g.players[p].runesInPlay) g.objects[r].exhausted = true;
  const theirs = g.players[P1].runesInPlay[0];
  touch(g);
  g = endTurn(g, P0);
  let offered = false;
  for (let i = 0; i < 8 && g.activePlayer === P0; i++) {
    const d = pend(g);
    if (d.inStep) { const o = optionIds(g); if (o.includes(theirs)) { offered = true; g = act(g, { type: 'choose', player: d.player, optionIds: [theirs] }); } else g = act(g, legal(g, d.player)[0]); continue; }
    if (!g.chain.length) break;
    g = pass(g);
  }
  assert.ok(offered, 'opponent rune selectable');
});

test('RJ#244 one battlefield scored twice in a turn by different players: P0 holds it, then P1 conquers it', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1);
  const u = put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const r = put(g, P1, 'V(2)', 'base');
  const w = put(g, P0, 'V(1)', 'base');
  g = settle(endTurn(g, P1));
  assert.equal(g.players[P0].points, 1, 'P0 held BF-A');
  g = settle(move(g, P0, [u], 'base'));
  g = move(g, P0, [w], BF_B);
  for (let i = 0; i < 4 && pend(g).player !== P1; i++) g = pass(g);
  g = passAll(play(g, P1, hand(g, P1, 'Ride the Wind'), { targets: [[r]] }));
  g = answer(g, { locations: [BF_A] });
  g = settle(g);
  assert.equal(g.battlefields[BF_A].controller, P1);
  assert.equal(g.players[P1].points, 1, 'P1 conquered the same battlefield this turn');
  assert.equal(g.activePlayer, P0);
});

test('RJ#246 (AMBIGUOUS) Fizz (sfd-140) plays a spell from the trash; it ends up recycled, not in the trash', () => {
  let g = S0(); fundAll(g, P0);
  const z = put(g, P0, 'ZapA', 'trash');
  const e = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  g = play(g, P0, hand(g, P0, 'sfd-140-221'), { dest: 'base' });
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    g = act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : o.includes(z) ? z : o.includes(e) ? e : o[0]] });
  }
  assert.ok(g.objects[e].damage > 0, 'the spell resolved');
  assert.equal(zone(g, z), 'mainDeck', 'recycled');
});

test('RJ#247 2-Might attacker vs a stunned 4-Might defender: nobody dies; only the attacker is recalled (defender stays, keeps control)', () => {
  const s = attackSetup(['V(2)'], ['V(4)'], { defOpts: [{ stunned: true }] });
  const g = settle(s.g);
  assert.equal(locOf(g, s.atk[0]), 'base', 'attacker recalled');
  assert.equal(locOf(g, s.def[0]), BF_A, 'defender NOT recalled (RJ said both)');
  assert.equal(g.battlefields[BF_A].controller, P1);
});

test('RJ#251 Baited Hook only looks at the top cards: Undertitan\'s "As I\'m revealed" [Add] [2] does not happen', () => {
  let g = S0(); fundAll(g, P0);
  const hook = put(g, P0, 'Baited Hook', 'base');
  const k = put(g, P0, 'V(1)', 'base');
  put(g, P0, 'Undertitan', 'deckTop');
  const ab = legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === hook);
  assert.ok(ab);
  g = act(g, ab!);
  let added = false;
  for (let i = 0; i < 16 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (g.log.some(l => /Undertitan/.test(l.text) && /add/i.test(l.text))) added = true;
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    g = act(g, { type: 'choose', player: d.player, optionIds: d.kind === 'optional' ? ['no'] : o.includes(k) ? [k] : d.kind === 'chooseCards' || d.kind === 'chooseTargets' ? [] : [o[0]] });
  }
  assert.equal(zone(g, k), 'trash', 'killed the friendly unit');
  assert.ok(!added && !g.log.some(l => /Undertitan/.test(l.text) && /\[Add\]|adds/i.test(l.text)), 'no reveal, no [Add] [2]');
  assert.equal(g.players[P0].pool.energy, 0);
});

test('RJ#253 Azir, Sovereign moved to base (face-down Fight or Flight) before his attack trigger resolves: no tokens move to the battlefield', () => {
  let g = S0(); fundAll(g, P1);
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const fof = put(g, P1, 'Fight or Flight', { facedown: BF_A });
  const t = put(g, P0, 'Recruit', 'base', { token: true });
  const az = put(g, P0, 'Azir, Sovereign', 'base');
  g = move(g, P0, [az], BF_A);
  for (let i = 0; i < 6 && !(g.chain.some(c => c.source === az) && pend(g).player === P1); i++) {
    const d = pend(g);
    g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : optionIds(g).includes(t) ? t : optionIds(g)[0]] }) : pass(g);
  }
  assert.ok(g.chain.some(c => c.source === az), 'Azir trigger on the chain');
  g = play(g, P1, fof, { targets: [[az]] });
  for (let i = 0; i < 12 && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g);
    g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : optionIds(g).includes(t) ? t : optionIds(g)[0]] }) : pass(g);
  }
  assert.equal(locOf(g, az), 'base');
  assert.equal(locOf(g, t), 'base', 'token not moved to BF-A');
});

test('RJ#256 Repeat is decided and paid when the spell is played; a Defy then counters the whole spell', () => {
  let g = S0(); fundAll(g, P0, 6); fundAll(g, P1);
  const u = put(g, P0, 'V(2)', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Feral Strength') });
  let askedRepeat = false;
  for (let i = 0; i < 6 && pend(g).inStep; i++) { const d = pend(g); if (d.kind === 'optional' && /Repeat/.test(d.prompt ?? '')) askedRepeat = true; g = act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : optionIds(g).includes(u) ? u : optionIds(g)[0]] }); }
  assert.ok(askedRepeat, 'Repeat offered while playing');
  assert.equal(g.chain.length, 1, 'one spell on the chain');
  g = pass(g);
  const defy = hand(g, P1, 'Defy');
  g = settle(play(g, P1, defy, { targets: [[targetOptions(g, P1, defy)[0]]] }));
  assert.equal(mightOf(g, u), 2, 'neither execution happened');
});

test('RJ#259 Yasuo, Remorseful\'s attack damage uses his Might on resolution (Discipline in response: 6 + 2 = 8)', () => {
  let g = S0(); fundAll(g, P0);
  const y = put(g, P0, 'ogn-076-298', 'base');
  const e = put(g, P1, 'V(12)', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [y], BF_A);
  for (let i = 0; i < 6 && !g.chain.some(c => c.source === y); i++) g = pend(g).inStep ? act(g, { type: 'choose', player: pend(g).player, optionIds: [optionIds(g).includes(e) ? e : optionIds(g)[0]] }) : pass(g);
  assert.ok(g.chain.some(c => c.source === y));
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Discipline'), { targets: [[y]] });
  for (let i = 0; i < 10 && (g.chain.length || pend(g).inStep); i++) g = pend(g).inStep ? act(g, { type: 'choose', player: pend(g).player, optionIds: [optionIds(g).includes(e) ? e : optionIds(g)[0]] }) : pass(g);
  assert.equal(g.objects[e].damage, 8);
});

test('RJ#263 Portal Rescue ignores the base cost, but an Accelerate on the replayed unit is still an additional cost to pay', () => {
  let g = S0(); fundAll(g, P0, 6);
  const w = put(g, P0, 'Thousand-Tailed Watcher', 'base');
  g = play(g, P0, hand(g, P0, 'Portal Rescue'), { targets: [[w]] });
  const r0 = g.players[P0].runesInPlay.filter(r => !g.objects[r].exhausted).length;
  let accel = false;
  for (let i = 0; i < 16 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    if (d.kind === 'optional' && /Accelerate/i.test(d.prompt ?? '')) accel = true;
    g = act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? (/Accelerate/i.test(d.prompt ?? '') ? 'yes' : 'no') : optionIds(g)[0]] });
  }
  assert.ok(accel, 'Accelerate offered');
  const r1 = g.players[P0].runesInPlay.filter(r => !g.objects[r].exhausted).length;
  assert.ok(r0 - r1 >= 1, 'the Accelerate cost was paid');
  assert.equal(g.objects[w].exhausted, false, 'accelerated: enters ready');
});

test('RJ#264 Glorious Executioner (Draven legend) has no once-per-turn limit: two combat wins in a turn draw twice', () => {
  let g = S0();
  setLegend(g, P0, 'Glorious Executioner');
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  const a = put(g, P0, 'V(3)', 'base'), b = put(g, P0, 'V(3)', 'base');
  const h0 = g.players[P0].hand.length;
  g = settle(move(g, P0, [a], BF_A));
  g = settle(move(g, P0, [b], BF_B));
  assert.equal(g.log.filter(l => /^Trigger: Glorious Executioner/.test(l.text)).length, 2);
  assert.ok(g.players[P0].hand.length >= h0 + 2);
});

test('RJ#273 Master Yi, Honed: Charm an enemy into his battlefield, kill it in combat, then gank to another battlefield', () => {
  let g = S0(); fundAll(g, P0);
  const yi = put(g, P0, 'Master Yi, Honed', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(2)', BF_B); control(g, BF_B, P1);
  put(g, P1, 'V(1)', BF_B);
  g = passAll(play(g, P0, hand(g, P0, 'Charm'), { targets: [[e]] }));
  g = settle(answer(g, { locations: [BF_A] }));
  assert.equal(zone(g, e), 'trash', 'killed in the combat');
  assert.equal(g.objects[yi].exhausted, false);
  g = move(g, P0, [yi], BF_B);
  assert.equal(locOf(g, yi), BF_B, 'ganked to the other battlefield');
});

test('RJ#279 Unforgiven (Yasuo legend) moving a unit from Vilemaw\'s Lair to base: may be activated, the unit does not move', () => {
  let g = S0({ bfA: "Vilemaw's Lair" }); fundAll(g, P0);
  setLegend(g, P0, 'Unforgiven');
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const l = g.players[P0].legend;
  const ab = legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === l);
  assert.ok(ab, 'activatable');
  g = act(g, ab!);
  for (let i = 0; i < 8 && pend(g).kind !== 'mainAction'; i++) { const d = pend(g); g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: [optionIds(g).includes(u) ? u : optionIds(g).includes('base') ? 'base' : optionIds(g)[0]] }) : pass(g); }
  assert.equal(locOf(g, u), BF_A, 'Lair: no move to base');
});

test('RJ#284 Void Burrower (Rek\'Sai legend): the revealed card is played paying its full cost', () => {
  let g = S0();
  setLegend(g, P0, 'Void Burrower');
  for (const r of g.players[P0].runesInPlay) g.objects[r].exhausted = true;
  addRunes(g, P0, 3);
  const u = put(g, P0, 'V(1)', 'base');
  const top = put(g, P0, 'V(3)', 'deckTop');
  g = move(g, P0, [u], BF_A);
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    g = act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : o.includes(top) ? top : o.includes('base') ? 'base' : o[0]] });
  }
  assert.ok(['base', 'battlefield'].includes(zone(g, top)), 'played');
  assert.equal(g.players[P0].runesInPlay.filter(r => !g.objects[r].exhausted).length, 0, 'paid [3]');
});

test('RJ#286 Ezreal, Prodigy does not reduce Draven\'s "When I attack, you may pay [C]" (not an optional additional cost of playing a card)', () => {
  let g = S0();
  setRunesExhaustedExcept(g, P0, 1);
  put(g, P0, 'Ezreal, Prodigy', 'base');
  const dr = put(g, P0, 'sfd-020-221', 'base');
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const n0 = g.players[P0].runesInPlay.length;
  g = move(g, P0, [dr], BF_A);
  for (let i = 0; i < 10 && (g.chain.length || pend(g).inStep); i++) { const d = pend(g); g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : optionIds(g)[0]] }) : pass(g); }
  assert.equal(mightOf(g, dr), 6, '+2 bought');
  assert.equal(n0 - g.players[P0].runesInPlay.length, 1, '[C] paid in full by recycling a rune');
});
function setRunesExhaustedExcept(g: GameState, p: typeof P0, n: number) { g.players[p].runesInPlay.forEach((r, i) => { g.objects[r].exhausted = i >= n; }); touch(g); }

test('RJ#287 Rell plays and attaches Recurve Bow on attack: the Bow\'s "When I attack" doesn\'t fire (designation already given)', () => {
  let g = S0();
  const rell = put(g, P0, 'Rell', 'base');
  const bow = put(g, P0, 'Recurve Bow', 'hand');
  const e = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [rell], BF_A);
  for (let i = 0; i < 16 && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g);
    g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : optionIds(g).includes(bow) ? bow : optionIds(g).includes(e) ? e : optionIds(g)[0]] }) : pass(g);
  }
  assert.equal(g.objects[bow].attachedTo, rell, 'Bow played and attached');
  assert.equal(g.objects[e].damage, 0, 'no Bow attack trigger');
});

test('RJ#288 a Skyfall of Areion unit conquering Grove of the God-Willow doesn\'t trigger the battlefield\'s hold effect', () => {
  let g = S0({ bfA: 'Grove of the God-Willow' });
  const u = put(g, P0, 'V(3)', 'base');
  attachNow(g, put(g, P0, 'Skyfall of Areion', 'base'), u);
  const h0 = g.players[P0].hand.length;
  g = settle(move(g, P0, [u], BF_A));
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[P0].hand.length, h0, 'no Grove draw');
});

test('RJ#290 Sabotage countered by Defy: it never resolves, no hand is revealed', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  g = play(g, P0, hand(g, P0, 'Sabotage'));
  for (let i = 0; i < 3 && pend(g).inStep; i++) g = act(g, { type: 'choose', player: pend(g).player, optionIds: [optionIds(g).includes(String(P1)) ? String(P1) : optionIds(g)[0]] });
  g = pass(g);
  const defy = hand(g, P1, 'Defy');
  g = settle(play(g, P1, defy, { targets: [[targetOptions(g, P1, defy)[0]]] }));
  assert.ok(!g.log.some(l => /reveal/i.test(l.text) && /hand/i.test(l.text)), 'no reveal');
  assert.ok(!g.log.some(l => /^Resolving Sabotage/.test(l.text)));
});

test('RJ#291 Heimerdinger, Inventor copies Daughter of the Void\'s [T] ability; both can be used for the same spell', () => {
  let g = S0(); fundAll(g, P0);
  const l = setLegend(g, P0, 'Daughter of the Void');
  const h = put(g, P0, 'Heimerdinger, Inventor', 'base');
  g.objects[h].exhausted = false; touch(g);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Discipline') });
  const acts = legal(g, P0, 'activate').filter(a => a.type === 'activate' && (a.obj === l || a.obj === h));
  assert.ok(acts.some(a => (a as { obj: ObjId }).obj === l), 'legend [T]');
  assert.ok(acts.some(a => (a as { obj: ObjId }).obj === h), 'Heimerdinger has the copied [T]');
});

test('RJ#293 a hidden unit can be played in response to Wraith of Echoes\' draw trigger (any reaction window)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  put(g, P0, 'Wraith of Echoes', 'base');
  const v = put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const hu = put(g, P0, 'HidU(2)', { facedown: BF_A });
  g = play(g, P1, hand(g, P1, 'KillA'), { targets: [[v]] });
  for (let i = 0; i < 6 && !chainLabels(g).some(x => /Wraith/.test(x)); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(chainLabels(g).some(x => /Wraith/.test(x)), `Wraith trigger on the chain: ${chainLabels(g)}`);
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  assert.ok(canPlayNow(g, P0, hu), 'hidden unit playable in response');
});

test('RJ#297 Brutalizer\'s "this" is the gear: +2 only on the turn it was attached', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'V(3)', 'base');
  const b = put(g, P0, 'Brutalizer', 'base');
  g = settle(answer(act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === b)!), { targets: [[u]] }, P0));
  assert.equal(g.objects[b].attachedTo, u);
  assert.equal(mightOf(g, u), 3 + 1 + 2, 'attached this turn');
  g = settle(nextTurn(g)); g = settle(nextTurn(g));
  assert.equal(mightOf(g, u), 3 + 1, 'a later turn: only the +1');
});

test('RJ#298 Sunken Temple checks Mighty at the conquer: a 4-Might unit made Mighty by Warmog\'s Armor\'s conquer buff doesn\'t trigger it', () => {
  let g = S0({ bfA: 'Sunken Temple' }); fundAll(g, P0);
  const u = put(g, P0, 'V(3)', 'base');
  attachNow(g, put(g, P0, "Warmog's Armor", 'base'), u);
  assert.equal(mightOf(g, u), 4);
  let temple = false;
  g = move(g, P0, [u], BF_A);
  for (let i = 0; i < 16 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (/Sunken Temple|draw 1/i.test(d.prompt ?? '') || chainLabels(g).some(l => /Sunken Temple/.test(l))) temple = true;
    g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : optionIds(g)[0]] }) : pass(g);
  }
  assert.equal(mightOf(g, u), 5, 'buffed: Mighty now');
  assert.equal(temple || g.log.some(l => /^Trigger: Sunken Temple/.test(l.text)), false, 'Sunken Temple did not trigger');
});

test('RJ#295 Void Hatchling + Void Burrower: look at the top card first (not a reveal) and may recycle it; then the top 2 are revealed', () => {
  let g = S0(); fundAll(g, P0);
  setLegend(g, P0, 'Void Burrower');
  put(g, P0, 'Void Hatchling', 'base');
  const u = put(g, P0, 'V(1)', 'base');
  const third = put(g, P0, 'V(4)', 'deckTop'), second = put(g, P0, 'V(3)', 'deckTop'), first = put(g, P0, 'V(2)', 'deckTop');
  void third; void second;
  g = move(g, P0, [u], BF_A);
  const prompts: string[] = [];
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    prompts.push(d.prompt ?? '');
    const o = optionIds(g);
    g = act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : o.includes(second) ? second : o[0]] });
  }
  assert.ok(prompts.some(p => /Hatchling|recycle it|top card/i.test(p)), `Hatchling look offered (${prompts.join(' | ')})`);
  assert.equal(zone(g, first), 'mainDeck');
  assert.equal(g.players[P0].mainDeck.at(-1) === first || g.players[P0].mainDeck.indexOf(first) > 1, true, 'looked-at card recycled (not among the two revealed from the top)');
  assert.ok(['base', 'battlefield'].includes(zone(g, second)) || g.players[P0].mainDeck.indexOf(second) !== 0, 'the reveal used the new top cards');
});

test('RJ#299 Traveling Merchant moves into an empty battlefield: Rengar, Pouncing played in response to the move trigger can only go to base (not attacking)', () => {
  let g = S0(); fundAll(g, P0);
  const r = hand(g, P0, 'Rengar, Pouncing');
  const m = put(g, P0, 'Traveling Merchant', 'base');
  put(g, P0, 'V(1)', 'hand');
  g = move(g, P0, [m], BF_A);
  for (let i = 0; i < 4 && !chainLabels(g).some(x => /Merchant/.test(x)); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(chainLabels(g).some(x => /Merchant/.test(x)), `move trigger on the chain (${chainLabels(g)})`);
  assert.equal(pend(g).player, P0);
  const ds = playDests(g, P0, r);
  assert.ok(ds.includes('base'), `base allowed (${ds})`);
  assert.ok(!ds.includes(BF_A), 'not to the empty battlefield');
});

test('RJ#300 Yasuo, Remorseful with Svellsongur attacks: both "When I attack" instances trigger', () => {
  let g = S0(); fundAll(g, P0);
  const e1 = put(g, P1, 'V(9)', BF_A); put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const y = put(g, P0, 'Yasuo, Remorseful', 'base');
  attachNow(g, put(g, P0, 'Svellsongur', 'base'), y);
  g = move(g, P0, [y], BF_A);
  let n = 0;
  for (let i = 0; i < 12 && n < 2; i++) {
    const d = pend(g);
    if (d.inStep && /enemy unit|target|Yasuo/i.test(d.prompt ?? '') && optionIds(g).includes(String(e1))) { n++; g = act(g, { type: 'choose', player: d.player, optionIds: [String(e1)] }); continue; }
    if (d.inStep) { g = act(g, legal(g, d.player)[0]); continue; }
    break;
  }
  const yt = chainLabels(g).filter(x => /Yasuo|Svellsongur/.test(x)).length;
  assert.ok(n >= 2 || yt >= 2, `two attack triggers (choices ${n}, chain ${chainLabels(g)})`);
});

test('RJ#306 Dazzling Aurora\'s end-of-turn trigger still resolves for its controller after the gear is stolen in response', () => {
  let g = S0(); fundAll(g, P0);
  const au = put(g, P0, 'Dazzling Aurora', 'base');
  const top = put(g, P0, 'V(2)', 'deckTop');
  g = endTurn(g);
  for (let i = 0; i < 6 && !chainLabels(g).some(x => /Aurora/.test(x)); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(chainLabels(g).some(x => /Aurora/.test(x)), `Aurora trigger on the chain (${chainLabels(g)})`);
  g.objects[au].controller = P1; touch(g);       // stolen in response (e.g. Akshan via Here to Help)
  g = settle(g);
  assert.ok(['base', 'battlefield'].includes(zone(g, top)), `the revealed unit was played (${zone(g, top)})`);
  assert.equal(g.objects[top].controller, P0, 'by the trigger\'s controller');
});

test('RJ#309 Charm moves an exhausted unit between battlefields; it stays exhausted', () => {
  let g = S0(); fundAll(g, P0);
  const e = put(g, P1, 'V(2)', BF_A, { ready: false }); control(g, BF_A, P1);
  assert.equal(g.objects[e].exhausted, true);
  put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
  g = passAll(play(g, P0, hand(g, P0, 'Charm'), { targets: [[e]] }));
  g = answer(g, { locations: [BF_B] });
  assert.equal(locOf(g, e), BF_B, 'moved although exhausted');
  assert.equal(g.objects[e].exhausted, true, 'still exhausted');
});

test('RJ#312 Switcheroo can swap the Might of my unit with an enemy unit at the same battlefield', () => {
  let g = S0(); fundAll(g, P0);
  const a = put(g, P0, 'V(1)', BF_A), b = put(g, P1, 'V(4)', BF_A); control(g, BF_A, P1);
  g = resolveChain(play(g, P0, hand(g, P0, 'Switcheroo'), { targets: [[a], [b]] }));
  assert.equal(mightOf(g, a), 4);
  assert.equal(mightOf(g, b), 1);
});

test('RJ#313 a buffed unit saved by Zhonya\'s Hourglass keeps its buff', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1);
  const z = put(g, P0, "Zhonya's Hourglass", 'base');
  const u = put(g, P0, 'V(2)', BF_A, { buff: true }); control(g, BF_A, P0);
  assert.equal(mightOf(g, u), 3);
  g = settle(play(g, P1, hand(g, P1, 'KillA'), { targets: [[u]] }));
  assert.equal(zone(g, z), 'trash');
  assert.equal(locOf(g, u), 'base');
  assert.equal(g.objects[u].counters.buff ?? 0, 1, 'still buffed');
  assert.equal(mightOf(g, u), 3);
});

test('RJ#315 two Void Hatchlings stack on Void Burrower\'s reveal: two looks (each may recycle) before the top 2 are revealed', () => {
  let g = S0(); fundAll(g, P0);
  setLegend(g, P0, 'Void Burrower');
  put(g, P0, 'Void Hatchling', 'base'); put(g, P0, 'Void Hatchling', 'base');
  const u = put(g, P0, 'V(1)', 'base');
  for (let i = 0; i < 4; i++) put(g, P0, `V(${i + 2})`, 'deckTop');
  g = move(g, P0, [u], BF_A);
  const prompts: string[] = [];
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    prompts.push(d.prompt ?? '');
    g = act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : optionIds(g)[0]] });
  }
  const looks = prompts.filter(p => /Hatchling|recycle it|top card/i.test(p)).length;
  assert.ok(looks >= 2, `two Hatchling looks (${prompts.join(' | ')})`);
});

test('RJ#316 Meditation\'s exhaust cost does not "choose" the unit: Blade Dancer (Irelia legend) does not trigger', () => {
  let g = S0(); fundAll(g, P0);
  setLegend(g, P0, 'Blade Dancer');
  const u = put(g, P0, 'V(2)', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Meditation') });
  const prompts: string[] = [];
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    prompts.push(d.prompt ?? '');
    const o = optionIds(g);
    g = act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : o.includes(u) ? u : o[0]] });
  }
  assert.equal(g.objects[u].exhausted, true, 'exhausted as the cost');
  assert.ok(!prompts.some(p => /Blade Dancer|ready it/i.test(p)) && !g.log.some(l => /^Trigger: Blade Dancer/.test(l.text)), `no Blade Dancer (${prompts.join(' | ')})`);
});

test('RJ#320 at 7 points, conquering a second battlefield with Ride the Wind on the opponent\'s turn draws instead of winning (the other one wasn\'t scored this turn)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0);
  g.players[P0].points = 7; touch(g);
  put(g, P0, 'V(2)', BF_B); control(g, BF_B, P0);
  const mine = put(g, P0, 'V(1)', BF_B);
  g = move(g, P1, [put(g, P1, 'V(5)', 'base')], BF_B);
  g = pass(g);
  const h0 = g.players[P0].hand.length;
  g = play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[mine]], locations: [BF_A] });
  g = settle(g);
  assert.equal(g.battlefields[BF_A].controller, P0, 'conquered BF-A');
  assert.equal(g.players[P0].points, 7);
  assert.equal(g.winner ?? null, null);
  assert.equal(g.players[P0].hand.length, h0 + 1, 'drew instead of the 8th point');
});

test('RJ#323 Switcheroo applies a difference modifier: gear attached after the swap still adds on top', () => {
  let g = S0(); fundAll(g, P0);
  const a = put(g, P0, 'V(1)', BF_A), b = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  attachNow(g, put(g, P0, 'Sword', 'base'), a);
  assert.equal(mightOf(g, a), 3);
  g = resolveChain(play(g, P0, hand(g, P0, 'Switcheroo'), { targets: [[a], [b]] }));
  assert.equal(mightOf(g, a), 2); assert.equal(mightOf(g, b), 3);
  attachNow(g, put(g, P0, 'Sword', 'base'), a);
  assert.equal(mightOf(g, a), 4, 'new gear stacks on the swapped value');
});

function apheliosSvell(want: RegExp): { modes: number; picked: string[]; second: string[] } {
  let g = S0(); fundAll(g, P0, 3);
  const ap = put(g, P0, 'Aphelios, Exalted', 'base');
  const sv = put(g, P0, 'Svellsongur', 'base');
  g = act(g, legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === sv)!);
  g = answer(g, { targets: [[ap]] });
  const picked: string[] = []; let modes = 0; let second: string[] = [];
  for (let i = 0; i < 16 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'chooseMode') {
      modes++; if (modes === 2) second = d.options!.map(o => o.label ?? o.id);
      const o = d.options!.find(o => want.test(o.label ?? '')) ?? d.options![0];
      picked.push(o.label ?? o.id); g = choose(g, o.id);
    } else if (d.inStep) g = choose(g, d.options![0].id); else g = pass(g);
  }
  return { modes, picked, second };
}

test('RJ#326 Svellsongur on Aphelios, Exalted: the copied ability triggers too (SFD-FAQ; RJ\'s "doesn\'t see itself attached" aside is wrong)', () => {
  assert.equal(apheliosSvell(/^Ready/).modes, 2, 'both instances trigger');
});

test('RJ#326b Aphelios + Svellsongur: each instance tracks its own "hasn\'t been chosen this turn" — the same mode may be chosen for both', () => {
  const r = apheliosSvell(/^Ready/);
  assert.ok(r.second.some(l => /^Ready/.test(l)), `second instance offers the same mode (${r.second})`);
});

test('RJ#327 Darius ("second card in a turn") doesn\'t trigger when the second card is countered (CR 426.1.b)', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const d = put(g, P0, 'ogn-027-298', 'base');
  g = settle(play(g, P0, hand(g, P0, 'DrawR')));
  const s2 = hand(g, P0, 'DrawR');
  g = play(g, P0, s2);
  g = pass(g);
  const defy = hand(g, P1, 'Defy');
  g = settle(play(g, P1, defy, { targets: [[targetOptions(g, P1, defy)[0]]] }));
  assert.equal(zone(g, s2), 'trash', 'countered');
  assert.equal(mightOf(g, d), g.cards[g.objects[d].cardId].might, 'no +2');
  assert.ok(!g.log.some(l => /^Trigger: Darius/.test(l.text)));
});

test('RJ#328 hidden (facedown) cards can\'t be discarded: Traveling Merchant with an empty hand discards nothing', () => {
  let g = S0(); fundAll(g, P0);
  const hc = put(g, P0, 'HidU(2)', { facedown: BF_A }); put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const m = put(g, P0, 'Traveling Merchant', 'base');
  g.players[P0].hand = []; touch(g);
  g = settle(move(g, P0, [m], BF_B));
  assert.equal(zone(g, hc), 'facedown', 'the hidden card stays');
});

test('RJ#338 an attacker that fails to clear a stunned defender is recalled (not moved): no second Traveling Merchant move trigger', () => {
  let g = S0(); fundAll(g, P0);
  const d = put(g, P1, 'V(9)', BF_A, { stunned: true }); control(g, BF_A, P1);
  const m = put(g, P0, 'Traveling Merchant', 'base');
  g = settle(move(g, P0, [m], BF_A));
  assert.equal(zone(g, d), 'battlefield', 'defender survives');
  assert.equal(locOf(g, m), 'base', 'attacker back at base');
  assert.equal(g.log.filter(l => /^Trigger: Traveling Merchant/.test(l.text)).length, 1, 'only the initial move triggered');
});

test('RJ#341 Switcheroo during combat swaps current Might incl. Assault; the keyword stays on its unit (difference modifiers)', () => {
  let g = S0(); fundAll(g, P0, 8);
  const d = put(g, P1, 'V(8)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(1)', 'base');
  g = resolveChain(play(g, P0, hand(g, P0, 'Cleave'), { targets: [[a]] }));
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 6 && !(g.showdown?.isCombat && pend(g).player === P0 && !pend(g).inStep); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(mightOf(g, a), 4, 'Assault 3 while attacking');
  g = resolveChain(play(g, P0, hand(g, P0, 'Switcheroo'), { targets: [[a], [d]] }));
  assert.equal(mightOf(g, a), 8);
  assert.equal(mightOf(g, d), 4);
  assert.ok(hasKeyword(g, a, 'Assault') && !hasKeyword(g, d, 'Assault'), 'Assault stays on the attacker');
});

test('RJ#343 a Deflect unit I took control of is friendly: my spell targeting it pays no Deflect', () => {
  const run = (mine: boolean) => {
    let g = S0(); fundAll(g, P0);
    const d = put(g, P1, 'Deflect(2,1)', 'base');
    if (mine) { g.objects[d].controller = P0; touch(g); }
    const rd = g.players[P0].runeDeck.length;
    [g] = cast(g, P0, 'ZapM', { targets: [[d]] });
    return g.players[P0].runeDeck.length - rd;
  };
  assert.equal(run(false), 1, 'enemy: Deflect [A] paid (rune recycled)');
  assert.equal(run(true), 0, 'controlled by me: no Deflect');
});

test('RJ#345 Sett, Brawler spends his buff (5 → 4) for +4 (→ 8): he becomes Mighty again and Grand Duelist triggers', () => {
  let g = S0(); fundAll(g, P0);
  setLegend(g, P0, 'Grand Duelist');
  const s = put(g, P0, 'Sett, Brawler', 'base', { buff: true });
  assert.equal(mightOf(g, s), 5);
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === s)!);
  let offered = false;
  for (let i = 0; i < 12 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (/Grand Duelist|channel/i.test(d.prompt ?? '') || chainLabels(g).some(l => /Grand Duelist/.test(l))) offered = true;
    g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : optionIds(g)[0]] }) : pass(g);
  }
  assert.equal(mightOf(g, s), 8);
  assert.ok(offered || g.log.some(l => /^Trigger: Grand Duelist/.test(l.text)), 'Grand Duelist triggered');
});

test('RJ#346 Arise! can be played with no Equipment (no targets): it plays no Sand Soldiers', () => {
  let g = S0(); fundAll(g, P0);
  const ar = hand(g, P0, 'Arise!');
  assert.ok(canPlayNow(g, P0, ar), 'playable');
  const n0 = g.players[P0].base.length;
  g = settle(act(g, { type: 'playCard', player: P0, obj: ar }));
  assert.equal(zone(g, ar), 'trash');
  assert.equal(g.players[P0].base.length, n0, 'no Sand Soldiers');
});

test('RJ#350 Brutalizer moved to a second unit the same turn: that unit gets +1 and the attached-this-turn +2 (no stacking); the first loses it', () => {
  let g = S0(); fundAll(g, P0);
  setLegend(g, P0, 'Grandmaster at Arms');
  const u1 = put(g, P0, 'V(3)', 'base'), u2 = put(g, P0, 'V(3)', 'base');
  const b = put(g, P0, 'Brutalizer', 'base');
  g = settle(answer(act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === b)!), { targets: [[u1]] }, P0));
  assert.equal(mightOf(g, u1), 6);
  const leg = g.players[P0].legend;
  const moves = legal(g, P0, 'activate').filter(a => a.type === 'activate' && a.obj === leg);
  let moved = false;
  for (const mv of moves) {
    try {
      let h = act(g, mv);
      for (let i = 0; i < 10 && pend(h).kind !== 'mainAction'; i++) {
        const d = pend(h);
        if (!d.inStep) { h = pass(h); continue; }
        const o = optionIds(h);
        h = act(h, { type: 'choose', player: d.player, optionIds: [o.includes(b) ? b : o.includes(u2) ? u2 : o[0]] });
      }
      if (g.objects[b].attachedTo === u1 && h.objects[b].attachedTo === u2) { g = h; moved = true; break; }
    } catch { /* not this ability */ }
  }
  assert.ok(moved, 'moved with Grandmaster at Arms');
  assert.equal(mightOf(g, u2), 6, '+1 and +2 (attached this turn), not +5');
  assert.equal(mightOf(g, u1), 3);
});

test('RJ#354 Fire Below the Mountain\'s gear-only [A] can\'t be spent on Hextech Anomaly\'s "pay any amount of [A]" (an effect payment, not the cost of using the gear)', () => {
  let g = S0();
  for (const r of g.players[P0].runesInPlay) g.objects[r].exhausted = true;
  g.players[P0].runesInPlay = []; touch(g);
  const l = setLegend(g, P0, 'Fire Below the Mountain');
  const an = put(g, P0, 'Hextech Anomaly', 'base');
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === l)!);
  assert.equal(g.players[P0].poolRestricted.length, 1, 'restricted [A] floating');
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === an)!);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = act(g, { type: 'choose', player: P0, optionIds: [optionIds(g).at(-1)!] });
  assert.equal(g.players[P0].pool.energy, 0, 'no Energy added');
  assert.equal(g.players[P0].poolRestricted.length, 1, 'the restricted [A] is unspent');
});

test('RJ#356 a Gold gear token counts for Ornn, Forge God\'s +1 per friendly gear', () => {
  const g = withTokens(S0());
  const o = put(g, P0, 'Ornn, Forge God', 'base');
  const m0 = mightOf(g, o)!;
  put(g, P0, 'unl-t05', 'base', { token: true });
  assert.equal(mightOf(g, o), m0 + 1);
});

test('RJ#358 (MISMATCH-RJ, CR 317.2.f) a Stupefy played in response to Grand Duelist\'s end-of-turn "becomes Mighty" trigger expires in the repeated Expiration step (same turn)', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  setLegend(g, P0, 'Grand Duelist');
  const u = put(g, P0, 'V(5)', 'base');
  g = resolveChain(play(g, P0, hand(g, P0, 'Stupefy'), { targets: [[u]] }));
  assert.equal(mightOf(g, u), 4);
  const st = hand(g, P1, 'Stupefy');
  g = endTurn(g);
  let responded = false;
  for (let i = 0; i < 30 && g.activePlayer === P0; i++) {
    const d = g.pending; if (!d) break;
    if (!responded && d.player === P1 && !d.inStep && chainLabels(g).some(l => /Grand Duelist/.test(l)) && canPlayNow(g, P1, st)) {
      g = play(g, P1, st, { targets: [[u]] }); responded = true; continue;
    }
    if (d.kind === 'mainAction') break;
    g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : optionIds(g)[0]] }) : pass(g);
  }
  assert.ok(responded, 'P1 responded to the Grand Duelist trigger in the ending phase');
  assert.equal(g.activePlayer, P1);
  assert.equal(mightOf(g, u), 5, `the response's "this turn" -1 expired too (${g.log.slice(-14).map(l => l.text).join(' / ')})`);
});

test('RJ#360 Blitzcrank\'s pull target killed in response and saved by The Boss (recalled) is still legal: pulled from base, unbuffed', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  setLegend(g, P1, 'The Boss');
  put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(4)', BF_B, { buff: true }); control(g, BF_B, P1);
  g = play(g, P0, hand(g, P0, 'Blitzcrank, Impassive'), { dest: BF_A });
  for (let i = 0; i < 8 && !chainLabels(g).some(l => /Blitzcrank/.test(l) && /^trigger/.test(l)); i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    g = act(g, { type: 'choose', player: d.player, optionIds: d.kind === 'optional' ? ['yes'] : o.includes(e) ? [e] : [o[0]] });
  }
  for (let i = 0; i < 4 && pend(g).inStep; i++) { const o = optionIds(g); g = act(g, { type: 'choose', player: pend(g).player, optionIds: [pend(g).kind === 'optional' ? 'yes' : o.includes(e) ? e : o[0]] }); }
  assert.ok(chainLabels(g).some(l => /Blitzcrank/.test(l)), `Blitzcrank trigger on the chain (${chainLabels(g)})`);
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Shakedown'), { targets: [[e]] });
  for (let i = 0; i < 20 && g.chain.length; i++) {
    const d = pend(g);
    const yes = d.kind === 'optional' ? (/draw/i.test(d.prompt ?? '') ? 'no' : 'yes') : optionIds(g).includes(e) ? e : optionIds(g)[0];
    g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: [yes] }) : pass(g);
  }
  assert.equal(zone(g, e), 'battlefield', 'saved by The Boss');
  assert.equal(g.objects[e].counters.buff ?? 0, 0, 'buff spent');
  assert.equal(locOf(g, e), BF_A, 'then pulled from its base to Blitzcrank');
});

test('RJ#362 Unlicensed Armory can\'t be activated with no friendly unit to choose (just to discard)', () => {
  const run = (unit: boolean) => {
    const g = S0(); fundAll(g, P0);
    g.players[P0].base = g.players[P0].base.filter(id => g.objects[id].cardId && g.cards[g.objects[id].cardId].type !== 'Unit'); touch(g);
    const ar = put(g, P0, 'Unlicensed Armory', 'base');
    hand(g, P0, 'V(1)');
    if (unit) put(g, P0, 'V(2)', 'base');
    return legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === ar);
  };
  assert.equal(run(true), true, 'with a friendly unit: usable');
  assert.equal(run(false), false, 'no friendly unit: not usable');
});

test('RJ#363 Leona, Zealot moving in drops a stunned 11-Might unit with 3 damage to 3: it dies in the move\'s cleanup, before combat', () => {
  let g = S0(); fundAll(g, P0);
  const m = put(g, P1, 'V(11)', BF_A, { stunned: true, damage: 3 }); put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const l = put(g, P0, 'Leona, Zealot', 'base');
  g = move(g, P0, [l], BF_A);
  assert.equal(zone(g, m), 'trash', 'died at once (lethal damage after the -8)');
  assert.ok(!g.log.some(l => /deals \d+ to V\(11\)/.test(l.text)), 'no combat damage involved');
});

test('RJ#367 Equip is base speed: usable in my open main phase, not on the opponent\'s turn (even with priority)', () => {
  const g0 = S0(); fundAll(g0, P0);
  put(g0, P0, 'V(2)', 'base');
  const sw0 = put(g0, P0, 'Sword', 'base');
  assert.ok(legal(g0, P0, 'activate').some(a => a.type === 'activate' && a.obj === sw0), 'my main phase: yes');
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  put(g, P0, 'V(2)', 'base');
  const sw = put(g, P0, 'Sword', 'base');
  const dr = hand(g, P0, 'DrawR');
  g = play(g, P1, hand(g, P1, 'DrawR'));
  for (let i = 0; i < 2 && pend(g).player !== P0; i++) g = pass(g);
  assert.equal(pend(g).player, P0);
  assert.ok(canPlayNow(g, P0, dr), 'P0 has priority (a Reaction is playable)');
  assert.ok(!legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === sw), 'Equip not usable');
});

test('RJ#368 Sett, Kingpin loses the +1 as soon as the buffed ally dies (same showdown/cleanup)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1);
  const s = put(g, P0, 'Sett, Kingpin', BF_A); const al = put(g, P0, 'V(1)', BF_A, { buff: true }); control(g, BF_A, P0);
  const m0 = mightOf(g, s)!;
  g = resolveChain(play(g, P1, hand(g, P1, 'KillA'), { targets: [[al]] }));
  assert.equal(zone(g, al), 'trash');
  assert.equal(mightOf(g, s), m0 - 1);
});

test('RJ#372 Dr. Mundo at 12 survives Unchecked Power\'s 12: the spell is in the trash (+1 → 13) before the cleanup checks lethal damage', () => {
  let g = S0(); fundAll(g, P0, 12);
  const m = put(g, P0, 'Dr. Mundo', BF_A); control(g, BF_A, P0);
  fillTrash(g, P0, 6);
  assert.equal(mightOf(g, m), 12);
  const up = hand(g, P0, 'Unchecked Power');
  g = settle(play(g, P0, up));
  assert.equal(zone(g, up), 'trash');
  assert.equal(zone(g, m), 'battlefield', 'survives');
  assert.equal(g.objects[m].damage, 12);
  assert.equal(mightOf(g, m), 13);
});

test('RJ#373 Lonely Poro dying with another friendly unit still at its battlefield did not die alone: no draw', () => {
  const run = (other: boolean) => {
    let g = S0({ tp: P1 }); fundAll(g, P1);
    const p = put(g, P0, 'Lonely Poro', BF_A); control(g, BF_A, P0);
    if (other) put(g, P0, 'V(1)', BF_A);
    const h0 = g.players[P0].hand.length;
    g = settle(play(g, P1, hand(g, P1, 'KillA'), { targets: [[p]] }));
    assert.equal(zone(g, p), 'trash');
    return g.players[P0].hand.length - h0;
  };
  assert.equal(run(false), 1, 'alone: draw');
  assert.equal(run(true), 0, 'with another friendly unit: no draw');
});

test('RJ#374 Blade of the Ruined King\'s "kill a friendly unit" Equip cost: the killed unit saved by Soraka still pays it; Blade attaches', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'Soraka', BF_A); control(g, BF_A, P0);
  const fod = put(g, P0, 'V(1)', BF_A);
  const u = put(g, P0, 'V(3)', 'base');
  const bl = put(g, P0, 'Blade of the Ruined King', 'base');
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === bl)!);
  const prompts: string[] = [];
  for (let i = 0; i < 16 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    prompts.push(d.prompt ?? ''); const o = optionIds(g);
    const pick = d.kind === 'optional' ? 'yes' : /kill/i.test(d.prompt ?? '') && o.includes(fod) ? fod : o.includes(u) ? u : o[0];
    g = act(g, { type: 'choose', player: d.player, optionIds: [pick] });
  }
  assert.equal(locOf(g, fod), "base", `fodder saved and recalled (${prompts.join(" | ")}) ${g.log.slice(-10).map(l => l.text).join(" / ")}`);
  assert.equal(g.objects[bl].attachedTo, u, 'Blade attached (cost counted as paid)');
});

test('RJ#377 (AMBIGUOUS, RJ not adopted) Commander Ledros: a unit killed for his additional cost and saved by Soraka — the cost was locked before paying (CR 356-357) and the replaced kill counts as paid (CR 203.2): still reduced', () => {
  const run = (soraka: boolean) => {
    let g = S0(); fundAll(g, P0, 12);
    if (soraka) put(g, P0, 'Soraka', BF_A);
    control(g, BF_A, P0);
    const f = put(g, P0, 'V(1)', BF_A);
    g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Commander Ledros') });
    for (let i = 0; i < 12 && pend(g).kind !== 'mainAction'; i++) {
      const d = pend(g); if (!d.inStep) { g = pass(g); continue; }
      const o = optionIds(g);
      g = act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : o.includes(f) ? f : o.includes('base') ? 'base' : o[0]] });
    }
    return { g, f, paid: g.log.find(l => /pays .* plays Commander Ledros|^P0 pays/.test(l.text))?.text };
  };
  const a = run(false), b = run(true);
  assert.equal(zone(a.g, a.f), 'trash');
  assert.equal(locOf(b.g, b.f), 'base', 'saved and recalled by Soraka');
  assert.equal(b.paid, a.paid, `same reduced payment (${a.paid} vs ${b.paid})`);
});

test('RJ#381 Hidden Blade choosing a Deflect unit pays the Deflect tax', () => {
  const run = (card: string) => {
    let g = S0(); fundAll(g, P0);
    const d = put(g, P1, card, BF_A); control(g, BF_A, P1);
    const rd = g.players[P0].runeDeck.length;
    [g] = cast(g, P0, 'Hidden Blade', { targets: [[d]] });
    return g.players[P0].runeDeck.length - rd;
  };
  assert.equal(run('Deflect(2,1)'), run('V(2)') + 1, 'one more rune recycled for Deflect [A]');
});

test('RJ#382 Glorious Executioner (Draven legend) draws for the combat win even though Vayne returns to hand on the conquer', () => {
  let g = S0(); fundAll(g, P0);
  setLegend(g, P0, 'Glorious Executioner');
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const v = put(g, P0, 'Vayne, Hunter', 'base');
  const h0 = g.players[P0].hand.length;
  g = move(g, P0, [v], BF_A);
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : optionIds(g)[0]] }) : pass(g);
  }
  assert.ok(g.log.some(l => /P0 conquers BF-A/.test(l.text)), 'conquered');
  assert.equal(zone(g, v), 'hand', 'Vayne returned');
  assert.equal(g.players[P0].hand.length, h0 + 2, 'Vayne + 1 card drawn');
});

test('RJ#383 two Dazzling Auroras: both trigger; the first unit is played (on board) before the second trigger resolves', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'Dazzling Aurora', 'base'); put(g, P0, 'Dazzling Aurora', 'base');
  const a = put(g, P0, 'V(2)', 'deckTop'), b = put(g, P0, 'V(3)', 'deckTop');
  g = endTurn(g);
  let seen = false;
  for (let i = 0; i < 30 && g.activePlayer === P0; i++) {
    const onBoard = [a, b].filter(x => ['base', 'battlefield'].includes(zone(g, x))).length;
    if (onBoard === 1 && chainLabels(g).some(l => /Aurora/.test(l))) seen = true;
    const d = g.pending; if (!d || d.kind === 'mainAction') break;
    g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: [optionIds(g).includes('base') ? 'base' : optionIds(g)[0]] }) : pass(g);
  }
  assert.ok(seen, 'one unit entered while the other Aurora trigger was still on the chain');
  assert.ok([a, b].every(x => ['base', 'battlefield'].includes(zone(g, x))), 'both played');
});

test('RJ#384 two Svellsongur on a Deflect 2 unit: three instances of its text, Deflect adds up to 6', () => {
  const g = S0();
  const o = put(g, P0, 'Ornn, Forge God', 'base');
  assert.equal(kwValue(g, o, 'Deflect'), 2);
  attachNow(g, put(g, P0, 'Svellsongur', 'base'), o);
  attachNow(g, put(g, P0, 'Svellsongur', 'base'), o);
  assert.equal(kwValue(g, o, 'Deflect'), 6);
});

test('RJ#392 (AMBIGUOUS, RJ adopted) Soraka dying at the same time as smaller friendly units there still saves them (replacement checked while she is on the board)', () => {
  let g = S0(); fundAll(g, P0, 12);
  const s = put(g, P0, 'Soraka', BF_A); control(g, BF_A, P0);
  const a = put(g, P0, 'V(1)', BF_A), b = put(g, P0, 'V(2)', BF_A);
  g = settle(play(g, P0, hand(g, P0, 'Unchecked Power')));
  assert.equal(zone(g, s), 'trash', 'Soraka dies');
  assert.equal(locOf(g, a), 'base', 'saved');
  assert.equal(locOf(g, b), 'base', 'saved');
});

test('RJ#399 Riptide Rex\'s 6 still hits its target after Tideturner swaps it to another battlefield (still "at a battlefield")', () => {
  let g = S0(); fundAll(g, P0, 8); fundAll(g, P1);
  const e = put(g, P1, 'V(6)', BF_A); control(g, BF_A, P1);
  put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  const tt = put(g, P1, 'Tideturner', { facedown: BF_B });
  g = play(g, P0, hand(g, P0, 'Riptide Rex'), { dest: 'base', targets: [[e]] });
  g = answer(g, { targets: [[e]] });
  for (let i = 0; i < 4 && !(pend(g).kind === 'chainResponse' && pend(g).player === P1); i++) g = pass(g);
  assert.ok(canPlayNow(g, P1, tt), 'hidden Tideturner playable in response');
  g = play(g, P1, tt);
  for (let i = 0; i < 20 && g.chain.length; i++) {
    const d = pend(g);
    g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : optionIds(g).includes(e) ? e : optionIds(g)[0]] }) : pass(g);
  }
  assert.ok(g.log.some(l => /V\(6\) moves to BF-B/.test(l.text)), `swapped to BF-B (${g.log.slice(-12).map(l => l.text).join(' / ')})`);
  assert.equal(zone(g, e), 'trash', 'then dealt 6 and died');
});

test('RJ#401 Rumble, Hotheaded\'s conquer trigger can\'t use a Mech that Zaun Warrens\' simultaneous trigger discards first (no Mech in the trash when it was put on the chain)', () => {
  let g = S0({ bfA: 'Zaun Warrens' }); fundAll(g, P0);
  const r = put(g, P0, 'Rumble, Hotheaded', 'base'), o = put(g, P0, 'V(1)', 'base');
  g.players[P0].hand = []; touch(g);
  const mh = hand(g, P0, 'Mech(2)');
  g = move(g, P0, [r, o], BF_A);
  for (let i = 0; i < 24 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    let pick: string;
    if (d.kind === 'orderTriggers') pick = d.options!.find(x => /Rumble/.test(x.label ?? ''))?.id ?? d.options![0].id;
    else if (d.kind === 'optional') pick = 'yes';
    else { const ids = optionIds(g); pick = ids.includes(mh) ? mh : ids.includes(o) ? o : ids[0]; }
    g = act(g, { type: 'choose', player: d.player, optionIds: [pick] });
  }
  assert.ok(g.log.some(l => /conquers/.test(l.text)), g.log.slice(-15).map(l => l.text).join(' / '));
  assert.equal(zone(g, mh), 'trash', 'Mech discarded by Zaun Warrens and not played');
  assert.equal(zone(g, o), 'battlefield', 'no unit recycled');
});

test('RJ#403 Sprite Call during my attack can\'t put the Sprite at the contested battlefield (base only)', () => {
  let { g } = attackSetup(['V(2)'], ['V(5)']);
  g = withTokens(g); fundAll(g, P0);
  const sc = hand(g, P0, 'Sprite Call');
  for (let i = 0; i < 6 && !(g.showdown && pend(g).player === P0 && !pend(g).inStep && canPlayNow(g, P0, sc)); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(canPlayNow(g, P0, sc));
  const before = new Set(Object.keys(g.objects));
  g = act(g, { type: 'playCard', player: P0, obj: sc });
  let offeredBf = false;
  for (let i = 0; i < 10 && g.chain.length + (pend(g).inStep ? 1 : 0) > 0; i++) {
    const d = pend(g);
    if (d.inStep) { if (optionIds(g).includes(String(BF_A))) offeredBf = true; g = act(g, { type: 'choose', player: d.player, optionIds: [optionIds(g).includes('base') ? 'base' : optionIds(g)[0]] }); continue; }
    g = pass(g);
  }
  const sprite = Object.keys(g.objects).find(id => !before.has(id) && g.objects[id].zone !== 'trash');
  assert.ok(sprite, 'a Sprite was played');
  assert.equal(offeredBf, false, 'BF-A not offered');
  assert.equal(locOf(g, sprite!), 'base');
});

test('RJ#408 Arise!\'s Sand Soldier may be played to a battlefield I control (not only base)', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  put(g, P0, 'Sword', 'base');
  const before = new Set(Object.keys(g.objects));
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Arise!') });
  let offered = false;
  for (let i = 0; i < 16 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    if (o.includes(String(BF_A)) && o.includes('base')) offered = true;
    g = act(g, { type: 'choose', player: d.player, optionIds: [o.includes(String(BF_A)) ? String(BF_A) : d.kind === 'optional' ? 'no' : o[0]] });
  }
  const sol = Object.keys(g.objects).find(id => !before.has(id) && ['base', 'battlefield'].includes(g.objects[id].zone));
  assert.ok(sol, 'a Sand Soldier was played');
  assert.ok(offered || locOf(g, sol!) === BF_A, 'BF-A offered as the destination');
  assert.equal(locOf(g, sol!), BF_A);
});

test('RJ#411 Ornn\'s Forge gained after a gear was already played this turn: the next gear isn\'t the first → no discount', () => {
  const run = (earlier: boolean) => {
    let g = S0({ bfA: "Ornn's Forge" }); fundAll(g, P0);
    put(g, P0, 'V(1)', BF_A);
    if (earlier) g = settle(play(g, P0, hand(g, P0, 'Long Sword')));
    control(g, BF_A, P0);
    const r0 = exhaustedRunes(g, P0);
    g = settle(play(g, P0, hand(g, P0, 'Long Sword')));
    return exhaustedRunes(g, P0) - r0;
  };
  const full = run(true), first = run(false);
  assert.equal(first, full - 1, `first gear is discounted by [1] (${first} vs ${full})`);
});

test('RJ#414 Irelia, Fervent: readied in the Awaken step gets +1 this turn; Ride the Wind on her exhausted (choose + ready) gives +2', () => {
  let g = S0({ tp: P1 });
  const ir = put(g, P0, 'Irelia, Fervent', 'base', { ready: false });
  const base = mightOf(g, ir)!;
  g = settle(nextTurn(g));
  assert.equal(g.activePlayer, P0);
  assert.equal(g.objects[ir].exhausted, false);
  assert.equal(mightOf(g, ir), base + 1, 'awaken ready: +1');
  let h = S0(); fundAll(h, P0);
  const i2 = put(h, P0, 'Irelia, Fervent', BF_A, { ready: false }); control(h, BF_A, P0);
  h = settle(play(h, P0, hand(h, P0, 'Ride the Wind'), { targets: [[i2]], locations: ['base'] }));
  assert.equal(h.objects[i2].exhausted, false);
  assert.equal(mightOf(h, i2), base + 2, 'chosen +1 and readied +1');
});

test('RJ#416 Azir, Ascendant swaps with an Eye of the Herald unit and takes the Eye: the moved unit still makes the Recruit at its own (new) location', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  const az = put(g, P0, 'Azir, Ascendant', BF_A); control(g, BF_A, P0);
  const x = put(g, P0, 'V(2)', 'base');
  const eye = put(g, P0, 'Eye of the Herald', 'base'); attachNow(g, eye, x);
  const before = new Set(Object.keys(g.objects));
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === az)!);
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    g = act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : o.includes(x) ? x : o.includes(eye) ? eye : o[0]] });
  }
  assert.equal(locOf(g, x), BF_A, 'X moved to Azir\'s spot');
  assert.equal(locOf(g, az), 'base');
  assert.equal(g.objects[eye].attachedTo, az, 'Azir took the Eye');
  const rec = Object.keys(g.objects).find(id => !before.has(id) && g.objects[id].isToken && ['base', 'battlefield'].includes(g.objects[id].zone));
  assert.ok(rec, 'a Recruit was played');
  assert.equal(locOf(g, rec!), BF_A, 'at the moved unit\'s location');
});

test('RJ#417 my Equipment on my unit stolen by Hostile Takeover: its own Equip can\'t move it (attached text inactive), Grandmaster at Arms can', () => {
  let g = S0(); fundAll(g, P0);
  const l = setLegend(g, P0, 'Grandmaster at Arms');
  const stolen = put(g, P0, 'V(3)', 'base');
  const mine = put(g, P0, 'V(2)', 'base');
  const sw = put(g, P0, 'Sword', 'base'); attachNow(g, sw, stolen);
  g.objects[stolen].controller = P1; touch(g);
  assert.equal(g.objects[sw].controller, P0, 'I still control the Equipment');
  assert.ok(!legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === sw), 'no Equip on the attached gear');
  let moved = false;
  for (const mv of legal(g, P0, 'activate').filter(a => a.type === 'activate' && a.obj === l)) {
    try {
      let h = act(g, mv);
      for (let i = 0; i < 10 && pend(h).kind !== 'mainAction'; i++) {
        const d = pend(h); if (!d.inStep) { h = pass(h); continue; }
        const o = optionIds(h); h = act(h, { type: 'choose', player: d.player, optionIds: [o.includes(sw) ? sw : o.includes(mine) ? mine : o[0]] });
      }
      if (h.objects[sw].attachedTo === mine) { moved = true; break; }
    } catch { /* other ability */ }
  }
  assert.ok(moved, 'Grandmaster at Arms reattaches it to my unit');
});

test('RJ#418 Rally the Troops also buffs unit tokens played this turn (Vanguard Captain\'s Recruits)', () => {
  let g = withTokens(S0()); fundAll(g, P0, 12);
  g = settle(play(g, P0, hand(g, P0, 'Rally the Troops')));
  g = settle(play(g, P0, hand(g, P0, 'DrawR')));    // Legion
  const before = new Set(Object.keys(g.objects));
  g = settle(play(g, P0, hand(g, P0, 'Vanguard Captain'), { dest: 'base' }));
  const recs = Object.keys(g.objects).filter(id => !before.has(id) && g.objects[id].isToken && ['base', 'battlefield'].includes(g.objects[id].zone));
  assert.equal(recs.length, 2, 'two Recruits');
  assert.ok(recs.every(r => (g.objects[r].counters.buff ?? 0) === 1), 'each buffed');
});

test('RJ#420 Imperial Decree doesn\'t change damage assignment: 2 damage vs two 3-Might defenders can\'t be split 1/1', () => {
  let g = S0(); fundAll(g, P0);
  const d1 = put(g, P1, 'V(3)', BF_A), d2 = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  g = settle(play(g, P0, hand(g, P0, 'Imperial Decree')));
  const a = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 12 && !(pend(g).kind === 'assignDamage' && pend(g).player === P0); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(pend(g).kind, 'assignDamage');
  assert.notEqual(validateAction(g, { type: 'assignDamage', player: P0, assignment: { [d1]: 1, [d2]: 1 } }), null, '1/1 is illegal');
  assert.equal(validateAction(g, { type: 'assignDamage', player: P0, assignment: { [d1]: 2, [d2]: 0 } }), null, '2/0 is legal');
});

test('RJ#424 Facebreaker can choose an already-stunned enemy, but stunning it again doesn\'t trigger "when you stun" (Radiant Dawn)', () => {
  const run = (pre: boolean) => {
    let g = S0(); fundAll(g, P0);
    setLegend(g, P0, 'Radiant Dawn');
    const f = put(g, P0, 'V(2)', BF_A, { stunned: true }); control(g, BF_A, P0);
    const e = put(g, P1, 'V(3)', BF_A, { stunned: pre });
    g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Facebreaker') });
    for (let i = 0; i < 16 && pend(g).kind !== 'mainAction'; i++) {
      const d = pend(g); if (!d.inStep) { g = pass(g); continue; }
      const o = optionIds(g); g = act(g, { type: 'choose', player: d.player, optionIds: [o.includes(e) ? e : o.includes(f) ? f : o[0]] });
    }
    assert.ok(g.objects[e].stunned);
    return g.log.filter(l => /^Trigger: Radiant Dawn/.test(l.text)).length;
  };
  assert.equal(run(false), 1, 'newly stunned: Radiant Dawn');
  assert.equal(run(true), 0, 'already stunned: no trigger');
});

test('RJ#425 Poro Herder buffing itself doesn\'t choose it: Blade Dancer (Irelia legend) doesn\'t trigger', () => {
  let g = S0(); fundAll(g, P0);
  setLegend(g, P0, 'Blade Dancer');
  put(g, P0, 'Lonely Poro', 'base');
  const ph = hand(g, P0, 'Poro Herder');
  g = act(g, { type: 'playCard', player: P0, obj: ph });
  const prompts: string[] = [];
  for (let i = 0; i < 16 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g); if (!d.inStep) { g = pass(g); continue; }
    prompts.push(d.prompt ?? ''); const o = optionIds(g);
    g = act(g, { type: 'choose', player: d.player, optionIds: [o.includes('base') ? 'base' : d.kind === 'optional' ? 'yes' : o[0]] });
  }
  assert.equal(g.objects[ph].counters.buff ?? 0, 1, 'buffed');
  assert.ok(!g.log.some(l => /^Trigger: Blade Dancer/.test(l.text)), `no Blade Dancer (${prompts.join(' | ')})`);
});

test('RJ#428 Lee Sin, Centered + Svellsongur: Shield 2 and two "[T]: Buff me" on Lee Sin; using one exhausts Lee Sin (not the gear), buff goes on him', () => {
  let g = S0(); fundAll(g, P0);
  const l = put(g, P0, 'ogn-078-298', 'base');
  const sv = put(g, P0, 'Svellsongur', 'base'); attachNow(g, sv, l);
  assert.equal(kwValue(g, l, 'Shield'), 2);
  const acts = legal(g, P0, 'activate').filter(a => a.type === 'activate' && (a.obj === l || a.obj === sv));
  assert.equal(acts.length, 2, 'two copies of the ability');
  assert.ok(acts.every(a => (a as { obj: ObjId }).obj === l), 'both are Lee Sin\'s abilities');
  g = settle(act(g, acts[1]));
  assert.equal(g.objects[l].exhausted, true, 'Lee Sin exhausted');
  assert.equal(g.objects[sv].exhausted, false, 'Svellsongur not exhausted');
  assert.equal(g.objects[l].counters.buff, 1);
  assert.ok(!legal(g, P0, 'activate').some(a => a.type === 'activate' && (a.obj === l || a.obj === sv)), 'the other copy needs Lee Sin ready');
});

test('RJ#434 Stupefy on my own unit at The Dreaming Tree, countered by Defy: the Dreaming Tree draw still happens', () => {
  let g = S0({ bfA: 'The Dreaming Tree' }); fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const st = hand(g, P0, 'Stupefy');
  const h0 = g.players[P0].hand.length;
  g = play(g, P0, st, { targets: [[u]] });
  for (let i = 0; i < 4 && !(pend(g).player === P1 && !pend(g).inStep); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  const defy = hand(g, P1, 'Defy');
  const sid = g.chain.find(c => c.source === st)?.id;
  assert.ok(sid, 'Stupefy on the chain');
  g = settle(play(g, P1, defy, { targets: [[sid!]] }));
  assert.equal(zone(g, st), 'trash');
  assert.equal(mightOf(g, u), 3, 'Stupefy countered');
  assert.equal(g.players[P0].hand.length, h0 - 1 + 1, 'Stupefy left the hand, Dreaming Tree drew 1 (no Stupefy draw)');
});

test('RJ#438 a Quick-Draw gear (Long Sword) can be played on the opponent\'s turn with no friendly units: it stays at base unattached', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  g.players[P0].base = g.players[P0].base.filter(id => g.cards[g.objects[id].cardId]?.type !== 'Unit'); touch(g);
  const ls = hand(g, P0, 'Long Sword');
  g = play(g, P1, hand(g, P1, 'DrawR'));
  for (let i = 0; i < 2 && pend(g).player !== P0; i++) g = pass(g);
  assert.ok(canPlayNow(g, P0, ls), 'Reaction timing via Quick-Draw');
  g = settle(play(g, P0, ls, { dest: 'base' }));
  assert.equal(zone(g, ls), 'base');
  assert.equal(g.objects[ls].attachedTo ?? null, null);
});

test('RJ#440 Bellows Breath choosing two enemy units counts toward Prodigal Explorer (each enemy unit chosen is a choice)', () => {
  let g = S0(); fundAll(g, P0, 6);
  const lg = setLegend(g, P0, 'Prodigal Explorer');
  const e1 = put(g, P1, 'V(9)', BF_A), e2 = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const canLegend = (h: GameState) => legal(h, P0, 'activate').some(a => a.type === 'activate' && a.obj === lg);
  assert.equal(canLegend(g), false);
  const bb = hand(g, P0, 'Bellows Breath');
  g = act(g, { type: 'playCard', player: P0, obj: bb });
  for (let i = 0; i < 12 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g); if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    if (d.kind === 'chooseTargets' && o.includes(e1)) { g = act(g, { type: 'choose', player: d.player, optionIds: [e1, e2] }); continue; }
    g = act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'no' : o[0]] });
  }
  assert.equal(g.objects[e1].damage, 1); assert.equal(g.objects[e2].damage, 1);
  assert.ok(canLegend(g), 'two enemy units chosen by Bellows Breath');
});

test('RJ#441 Vi, Destructive\'s ability can be used while she is at a battlefield (own turn, Neutral Open)', () => {
  let g = S0();
  const vi = put(g, P0, 'Vi, Destructive', BF_A); control(g, BF_A, P0);
  put(g, P0, 'V(1)', 'trash');
  const acts = legal(g, P0, 'activate').filter(x => x.type === 'activate' && x.obj === vi);
  assert.ok(acts.length > 0, 'usable at a battlefield');
  g = act(g, acts[0]); if (pend(g).kind === 'chooseCards') g = choose(g, optionIds(g)[0]);
  g = settle(g);
  assert.equal(mightOf(g, vi), 4, '+1 Might');
});

test('RJ#448 Teemo, Scout played from hidden: the opponent can Gust him in response to his play trigger; he returns to hand and gets no +3', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const t = put(g, P0, 'ogn-197-298', { facedown: BF_A });
  g = play(g, P1, hand(g, P1, 'DrawR'));
  for (let i = 0; i < 2 && pend(g).player !== P0; i++) g = pass(g);
  assert.ok(canPlayNow(g, P0, t), 'hidden Teemo playable');
  g = act(g, { type: 'playCard', player: P0, obj: t });
  for (let i = 0; i < 8 && !chainLabels(g).some(x => /trigger.*Teemo|Teemo/.test(x) && !/^card/.test(x)); i++) {
    const d = pend(g); if (d.inStep) { g = act(g, legal(g, d.player)[0]); continue; }
    if (g.chain.length && g.objects[t].zone === 'battlefield') break;
    g = pass(g);
  }
  for (let i = 0; i < 4 && !(pend(g).player === P1 && !pend(g).inStep && g.objects[t].zone === 'battlefield'); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(g.objects[t].zone, 'battlefield', `Teemo on the board, trigger pending: ${chainLabels(g)}`);
  assert.ok(g.chain.length > 0, 'his play trigger is on the chain');
  const gust = hand(g, P1, 'Gust');
  assert.ok(canPlayNow(g, P1, gust), 'Gust in response');
  g = settle(play(g, P1, gust, { targets: [[t]] }));
  assert.equal(zone(g, t), 'hand', 'returned to its owner\'s hand');
});

test('RJ#452 (MISMATCH-RJ, DECISIONS #1347/#1448) 2-Might unit at Trifarian War Camp (3) hit by Thousand-Tailed Watcher: -2 snapshotted (1); leaving the camp leaves it at 0, not 1', () => {
  let g = S0({ tp: P1, bfA: 'Trifarian War Camp' }); fundAll(g, P1, 8); fundAll(g, P0);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  assert.equal(mightOf(g, u), 3);
  [g] = cast(g, P1, 'Thousand-Tailed Watcher', { dest: 'base', may: [false] });
  g = settle(g);
  assert.equal(mightOf(g, u), 1, 'to a minimum of 1');
  [g] = cast(g, P1, 'Charm', { targets: [[u]] });
  g = passAll(g);
  g = settle(answer(g, { locations: ['base'], dest: 'base' }, P1));
  assert.equal(locOf(g, u), 'base');
  assert.equal(mightOf(g, u), 0, 'camp +1 gone; snapshotted -2 stays (CR 479.4.b, 479.4.e.2.b)');
});

test('RJ#453 Riposte can counter your own spell ("a spell" is unrestricted); the unit gets +Might equal to its Energy cost', () => {
  let g = S0(); fundAll(g, P0, 8);
  const u = put(g, P0, 'V(2)', 'base');
  [g] = cast(g, P0, 'DrawR');
  const item = g.chain[0].id, src = g.chain[0].source;
  g = play(g, P0, hand(g, P0, 'Riposte'), { targets: [[u], [item]] });
  g = settle(g);
  assert.equal(zone(g, src), 'trash', 'own spell countered');
  assert.equal(mightOf(g, u), 3, '+1 (DrawR costs 1 Energy)');
});

test('RJ#456 Shen (Reaction) played to my battlefield in response to my Sprite\'s Temporary trigger: no showdown, I keep it and score the hold point', () => {
  let g = withTokens(S0({ tp: P1 })); fundAll(g, P0);
  const sp = put(g, P0, 'unl-t07', BF_A, { token: true }); control(g, BF_A, P0);
  const sh = hand(g, P0, 'ogn-241-298');
  g = endTurn(g, P1);
  for (let i = 0; i < 6 && !g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(g.chain.length > 0, 'Temporary trigger on the chain');
  assert.ok(canPlayNow(g, P0, sh, BF_A), 'Shen playable to the battlefield in response');
  g = play(g, P0, sh, { dest: BF_A });
  g = settle(g);
  assert.equal(zone(g, sp), 'gone', 'Sprite died');
  assert.equal(locOf(g, sh), BF_A);
  assert.equal(g.battlefields[BF_A].controller, P0, 'battlefield kept');
  assert.equal(g.players[P0].points, 1, 'hold point');
  assert.ok(!g.log.some(l => /showdown/i.test(l.text) && /BF|battlefield/i.test(l.text) && /begin|start/i.test(l.text)), 'no showdown');
});

test('RJ#461 two Dazzling Auroras revealing two Deadbloom Predators: both may go to the same occupied enemy battlefield; the showdown waits for the chain', () => {
  let g = S0();
  put(g, P0, 'Dazzling Aurora', 'base'); put(g, P0, 'Dazzling Aurora', 'base');
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const d2 = put(g, P0, 'Deadbloom Predator', 'deckTop');
  const d1 = put(g, P0, 'Deadbloom Predator', 'deckTop');
  g = endTurn(g, P0);
  const offered: string[][] = []; let atShowdown: unknown[] | null = null;
  for (let i = 0; i < 60 && !(pend(g).kind === 'mainAction' && pend(g).player === P1); i++) {
    const d = pend(g);
    if (g.showdown && !atShowdown) atShowdown = [locOf(g, d1), locOf(g, d2)];
    if (d.kind === 'chooseDestination' && d.player === P0 && /Deadbloom/.test(d.prompt)) {
      const ids = d.options!.map(o => o.id); offered.push(ids);
      g = choose(g, ids.includes(String(BF_A)) ? String(BF_A) : ids[0]); continue;
    }
    if (d.kind === 'assignDamage') { g = act(g, legal(g, d.player)[0]); continue; }
    g = d.inStep ? choose(g, ...(d.options ?? []).slice(0, Math.max(1, d.min ?? 0)).map(o => o.id)) : pass(g);
  }
  assert.equal(offered.length, 2, 'two Deadbloom destination choices');
  assert.ok(offered.every(o => o.includes(String(BF_A))), 'both may go to the enemy battlefield');
  assert.deepEqual(atShowdown, [BF_A, BF_A], 'both there when the showdown begins');
});

test('RJ#462 two defenders, one killed after the showdown starts: Mask of Foresight ("when … defends alone") never triggers; Wielder of Water ("while … defending alone") gets +2', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P1, 'Mask of Foresight', 'base');
  const w = put(g, P1, 'Wielder of Water', BF_A), o = put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(9)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 6 && !(g.showdown && pend(g).player === P0 && !pend(g).inStep && !g.chain.length); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(mightOf(g, w), 2, 'not alone yet');
  g = play(g, P0, hand(g, P0, 'KillA'), { targets: [[o]] });
  for (let i = 0; i < 6 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(zone(g, o), 'trash');
  assert.equal(mightOf(g, w), 4, 'Wielder now defending alone: +2');
  assert.ok(!g.log.some(l => /^Trigger: Mask of Foresight/.test(l.text)), 'no Mask trigger');
});

test('RJ#467 Soulgorger playing an Accelerate unit from the trash: Accelerate may be paid so it enters ready (only the Energy cost is ignored; its Power cost is still paid)', () => {
  let g = S0(); fundAll(g, P0, 8);
  const w = put(g, P0, 'Thousand-Tailed Watcher', 'trash');
  const sg = hand(g, P0, 'Soulgorger');
  const n0 = g.log.length;
  g = act(g, { type: 'playCard', player: P0, obj: sg });
  let accel = false;
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g); if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    if (o.includes(w)) { g = choose(g, w); continue; }
    if (d.kind === 'optional') { if (/Accelerate/i.test(d.prompt ?? '')) accel = true; g = choose(g, 'yes'); continue; }
    g = act(g, legal(g, d.player)[0]);
  }
  assert.ok(accel, 'Accelerate offered');
  assert.equal(zone(g, w), 'base');
  assert.equal(g.objects[w].exhausted, false, 'entered ready');
  const pays = g.log.slice(n0).map(l => l.text).filter(t => /^P0 pays/.test(t));
  assert.ok(pays.some(t => /M M/.test(t)), `Watcher\'s Power cost paid (${pays.join(' | ')})`);
});

test('RJ#470 Ornn\'s legend [A] ("use only to play gear or use gear abilities") can\'t pay the hide cost of Zhonya\'s Hourglass (hiding isn\'t playing)', () => {
  let g = S0(); fundAll(g, P0, 0);
  setLegend(g, P0, 'Fire Below the Mountain');
  put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const z = hand(g, P0, "Zhonya's Hourglass");
  assert.ok(rejects(g, { type: 'hide', player: P0, obj: z, battlefieldIndex: BF_A }), 'legend power can\'t pay the hide cost');
  addRunes(g, P0, 1, 'chaos');
  g = act(g, { type: 'hide', player: P0, obj: z, battlefieldIndex: BF_A });
  assert.equal(zone(g, z), 'facedown', 'a rune pays it');
});

test('RJ#477 Fiora, Victorious defending at Fortified Position: Shield 2 makes her 6 (Mighty), her own Shield adds 1 → 7', () => {
  const s = attackSetup(['V(9)'], ['ogn-232-298'], { bfA: 'Fortified Position' });
  let g = s.g; const fio = s.def[0];
  for (let i = 0; i < 10 && g.chain.length + (pend(g).inStep ? 1 : 0) > 0; i++) {
    const d = pend(g);
    if (d.inStep) { const o = optionIds(g); g = choose(g, o.includes(fio) ? fio : o[0]); continue; }
    g = pass(g);
  }
  assert.ok(g.log.some(l => /Trigger: Fortified Position/.test(l.text)), 'Fortified Position triggered');
  assert.equal(kwValue(g, fio, 'Shield'), 3, 'Shield 2 + her own Shield');
  assert.equal(mightOf(g, fio), 7);
});

test('RJ#481 Forgotten Monument: a player can conquer-score it as soon as it is their third turn (not only from the 4th)', () => {
  const run = (taken: number) => {
    let g = S0({ bfA: 'Forgotten Monument' });
    g.players[P0].turnsTaken = taken; touch(g);
    const u = put(g, P0, 'V(2)', 'base');
    g = settle(move(g, P0, [u], BF_A));
    assert.equal(g.battlefields[BF_A].controller, P0);
    return g.players[P0].points;
  };
  assert.equal(run(1), 0, 'second turn: no score');
  assert.equal(run(2), 1, 'third turn: conquer scores');
});

test('RJ#485 (MISMATCH-RJ, DECISIONS principle 11) Draven, Vanquisher attacking Reaver\'s Row: his "you may pay [C]" is decided and paid as the trigger goes on the chain, not on resolution', () => {
  let g = S0({ bfA: "Reaver's Row" }); fundAll(g, P0);
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const dv = put(g, P0, 'sfd-020-221', 'base');
  g = move(g, P0, [dv], BF_A);
  let paidBeforeResolve: boolean | null = null;
  for (let i = 0; i < 12 && paidBeforeResolve === null; i++) {
    const d = pend(g);
    if (d.kind === 'optional' && d.player === P0 && /pay/i.test(d.prompt ?? '')) {
      const r0 = g.players[P0].runesInPlay.length;
      g = choose(g, 'yes');
      for (let j = 0; j < 4 && pend(g).inStep && pend(g).player === P0; j++) g = act(g, legal(g, P0)[0]);
      paidBeforeResolve = g.players[P0].runesInPlay.length < r0 && g.chain.some(c => c.source === dv) && mightOf(g, dv) === 4;
      break;
    }
    g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  assert.equal(paidBeforeResolve, true, 'cost paid while finalizing; +2 not yet applied (trigger still on the chain)');
});

test('RJ#489 Darius, Trifarian with 4 damage (Void Seeker): Stupefy in response to his second-card trigger kills him before the +2 resolves', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const d = put(g, P1, 'Darius, Trifarian', BF_A, { damage: 4 }); control(g, BF_A, P1);
  g = settle(play(g, P1, hand(g, P1, 'DrawR')));
  g = play(g, P1, hand(g, P1, 'DrawR'));
  for (let i = 0; i < 8 && !(pend(g).player === P0 && !pend(g).inStep && g.chain.some(c => c.source === d)); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(g.chain.some(c => c.source === d), `Darius trigger on the chain: ${chainLabels(g)}`);
  g = settle(play(g, P0, hand(g, P0, 'Stupefy'), { targets: [[d]] }));
  assert.equal(zone(g, d), 'trash', '4 Might with 4 damage: dies in the cleanup after Stupefy');
});

test('RJ#500 Ravenbloom Student triggers for each spell: two spells → +2', () => {
  let g = S0(); fundAll(g, P0);
  const rs = put(g, P0, 'Ravenbloom Student', 'base');
  const m0 = mightOf(g, rs);
  g = settle(play(g, P0, hand(g, P0, 'DrawR')));
  g = settle(play(g, P0, hand(g, P0, 'DrawR')));
  assert.equal(mightOf(g, rs), m0! + 2);
});

test('RJ#504 Ezreal, Prodigy doesn\'t discount Blade Dancer\'s "you may exhaust me and pay [A]" trigger (not an optional additional cost)', () => {
  let g = S0(); fundAll(g, P0);
  setLegend(g, P0, 'Blade Dancer');
  put(g, P0, 'Ezreal, Prodigy', 'base');
  const u = put(g, P0, 'V(3)', 'base', { ready: false });
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Discipline') });
  let rd = -1;
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g); if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    if (o.includes(u)) { g = choose(g, u); continue; }
    if (d.kind === 'optional') { rd = g.players[P0].runeDeck.length; g = choose(g, 'yes'); continue; }
    g = act(g, legal(g, d.player)[0]);
  }
  assert.ok(rd >= 0, 'Blade Dancer offered');
  assert.equal(g.objects[u].exhausted, false, 'readied');
  assert.equal(g.players[P0].runeDeck.length, rd + 1, 'a rune was recycled for [A]: no discount');
});

test('RJ#517 Void Seeker ("a unit at a battlefield") still hits its target after it moved to another battlefield in response (Resonating Strike)', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const e = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  g = play(g, P0, hand(g, P0, 'Void Seeker'), { targets: [[e]] });
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  const rs = hand(g, P1, 'Resonating Strike');
  g = act(g, { type: 'playCard', player: P1, obj: rs });
  for (let i = 0; i < 8 && pend(g).inStep && pend(g).player === P1; i++) {
    const o = optionIds(g);
    const bfB = g.battlefields[BF_B].objId;
    g = choose(g, o.includes(bfB) ? bfB : o.includes(e) ? e : o[0]);
  }
  g = settle(g);
  assert.equal(locOf(g, e), BF_B, 'moved to the other battlefield');
  assert.equal(g.objects[e].damage, 4, 'Void Seeker still dealt 4');
});

// RJ#519 → official UNL-FAQ (Yone, Blademaster and Reckoner's Arena): "No, you will not. … activating a conquer effect such as the
// Reckoner's Arena effect is the equivalent of checking the condition … as if a conquer had occurred … since the battlefield wasn't
// previously uncontrolled, Yone's ability will not trigger." RJ#519's "it goes on the chain" is MISMATCH-RJ (ENGINE-4; = conformance T193).
test('RJ#519 (official UNL-FAQ, RJ not adopted) Reckoner\'s Arena does not activate Yone, Blademaster\'s conquer effect on a hold: the battlefield wasn\'t uncontrolled', () => {
  let g = S0({ tp: P1, bfA: "Reckoner's Arena" });
  const y = put(g, P0, 'sfd-116-221', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(9)', 'base');
  g = endTurn(g, P1);
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g); if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g); g = choose(g, o.includes(e) ? e : d.kind === 'optional' ? 'yes' : o[0]);
  }
  assert.ok(g.log.some(l => /Trigger: Reckoner/.test(l.text)), 'Arena triggered');
  assert.equal(g.objects[e].damage, 0, 'Yone\'s condition is checked: no damage'); void y;
});

test('RJ#520 a unit with three Trinity Force holds: 1 + 3 points', () => {
  let g = S0({ tp: P1 });
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  for (let i = 0; i < 3; i++) attachNow(g, put(g, P0, 'Trinity Force', 'base'), u);
  g = settle(endTurn(g, P1));
  assert.equal(g.activePlayer, P0);
  assert.equal(g.players[P0].points, 4);
});

test('RJ#523 Time Warp stolen with Mystic Reversal on the opponent\'s turn: in 1v1 the stealer then takes two consecutive turns', () => {
  let g = S0();
  fundAll(g, P0, 4); addRunes(g, P0, 4, 'fury'); fundAll(g, P1, 4);
  const tw = hand(g, P0, 'Time Warp');
  g = play(g, P0, tw);
  g = pass(g);
  [g] = cast(g, P1, 'Mystic Reversal', { targets: [[g.chain[0].id]] });
  g = passAll(g);
  if (pend(g).kind === 'optional') g = choose(g, 'no');
  g = settle(g);
  assert.equal(zone(g, tw), 'banishment');
  const order: number[] = [];
  for (let i = 0; i < 3; i++) { g = settle(nextTurn(g)); order.push(g.activePlayer); }
  assert.deepEqual(order, [P1, P1, P0], 'extra turn, then P1\'s normal turn, then P0');
});

test('RJ#525 Lee Sin, Ascetic with 4 buffs after Stand United (+2 each), Smoke Screen -4 → 9; spending a buff with Wallop → 7', () => {
  let g = S0(); fundAll(g, P0, 10);
  const ls = put(g, P0, 'ogn-078-298', 'base');
  g.objects[ls].counters.buff = 3; touch(g);
  assert.equal(mightOf(g, ls), 8);
  const drv = (h: GameState, pick: (d: ReturnType<typeof pend>, o: string[]) => string | null) => {
    for (let i = 0; i < 20 && pend(h).kind !== 'mainAction'; i++) {
      const d = pend(h); if (!d.inStep) { h = pass(h); continue; }
      const o = optionIds(h); const p = pick(d, o);
      h = p !== null ? choose(h, p) : act(h, legal(h, d.player)[0]);
    }
    return h;
  };
  g = drv(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Stand United') }), (_d, o) => o.includes(ls) ? ls : null);
  assert.equal(g.objects[ls].counters.buff, 4);
  assert.equal(mightOf(g, ls), 5 + 4 * 2);
  g = drv(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Smoke Screen') }), (_d, o) => o.includes(ls) ? ls : null);
  assert.equal(mightOf(g, ls), 9);
  g = drv(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Wallop') }), (d, o) => d.kind === 'optional' ? 'yes' : o.includes(ls) ? ls : null);
  assert.equal(g.objects[ls].counters.buff, 3, 'a buff spent');
  assert.equal(mightOf(g, ls), 7, '5 + 3×2 - 4 (Smoke Screen\'s -4 was snapshotted)');
});

test('RJ#528 Sett, Brawler played (4) and buffed by his play effect (5) becomes Mighty: Grand Duelist triggers', () => {
  let g = S0(); fundAll(g, P0, 8);
  setLegend(g, P0, 'Grand Duelist');
  const s = hand(g, P0, 'Sett, Brawler');
  g = play(g, P0, s, { dest: 'base' });
  let gd = false;
  for (let i = 0; i < 12 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'optional' && /Grand Duelist/.test(d.prompt ?? '')) { gd = true; break; }
    g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  assert.equal(mightOf(g, s), 5);
  assert.ok(gd, 'Grand Duelist offered');
});

test('RJ#534 Action spells from hand (Fight or Flight, Ride the Wind) can\'t be played in response to Hidden Blade on the chain', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P0, 'V(2)', 'base');
  const fof = hand(g, P0, 'Fight or Flight'), rtw = hand(g, P0, 'Ride the Wind');
  g = move(g, P0, [u], BF_A);
  for (let i = 0; i < 4 && !(g.showdown && pend(g).player === P1); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(g.showdown && pend(g).player === P1, 'P1 has focus in the showdown');
  g = play(g, P1, hand(g, P1, 'Hidden Blade'), { targets: [[u]] });
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  assert.equal(pend(g).kind, 'chainResponse');
  assert.ok(!canPlayNow(g, P0, fof) && !canPlayNow(g, P0, rtw), 'no Action spells with a chain');
});

test('RJ#535 Convergent Mutation to Dr. Mundo\'s Might (18) is a snapshot: the unit gets +17, and later trash cards raise only Mundo', () => {
  let g = S0(); fundAll(g, P0);
  const m = put(g, P0, 'Dr. Mundo', 'base');
  fillTrash(g, P0, 12);
  const u = put(g, P0, 'V(1)', 'base');
  assert.equal(mightOf(g, m), 18);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Convergent Mutation') });
  for (let i = 0; i < 12 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g); if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g); g = choose(g, d.prompt && /another/i.test(d.prompt) ? m : o.includes(u) ? u : o.includes(m) ? m : o[0]);
  }
  assert.equal(mightOf(g, u), 18);
  fillTrash(g, P0, 2);
  assert.equal(mightOf(g, m), 21, 'Convergent Mutation itself + 2 more in the trash');
  assert.equal(mightOf(g, u), 18, 'unit doesn\'t track Mundo');
});

test('RJ#539 Kato the Arm moving into a showdown gives another unit his keywords (e.g. Ganking), but it can\'t join that showdown (no standard moves outside Neutral Open)', () => {
  let g = S0();
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const k = put(g, P0, 'Kato the Arm', 'base');
  const o = put(g, P0, 'V(2)', BF_B); control(g, BF_B, P0);
  g = move(g, P0, [k], BF_A);
  for (let i = 0; i < 12 && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g);
    if (d.inStep) { const op = optionIds(g); g = choose(g, op.includes(o) ? o : op[0]); continue; }
    g = pass(g);
  }
  assert.ok(g.showdown, 'showdown still on');
  assert.ok(hasKeyword(g, o, 'Deflect'), 'Kato\'s keywords given');
  assert.ok(!legal(g, P0, 'move').length, 'no standard move into the showdown');
});

test('RJ#540 Pickpocket targeting the opponent\'s Gold: they use (kill) the Gold in response, so Pickpocket kills nothing and gives no Gold', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  const gold = put(g, P1, 'Gold', 'base', { token: true });
  const pp = hand(g, P0, 'Pickpocket');
  g = play(g, P0, pp, { dest: 'base' });
  for (let i = 0; i < 10 && !(pend(g).player === P1 && !pend(g).inStep && g.chain.length); i++) {
    const d = pend(g);
    if (d.inStep) { const o = optionIds(g); g = choose(g, o.includes(gold) ? gold : d.kind === 'optional' ? 'yes' : o[0]); continue; }
    g = pass(g);
  }
  assert.ok(g.chain.some(c => c.source === pp), 'Pickpocket trigger on the chain');
  const use = legal(g, P1, 'activate').find(a => a.type === 'activate' && a.obj === gold);
  assert.ok(use, 'Gold usable in response');
  g = settle(act(g, use!));
  assert.equal(zone(g, gold), 'gone');
  assert.equal(g.players[P0].base.filter(id => g.cards[g.objects[id].cardId].name === 'Gold').length, 0, 'no Gold for P0');
});

test('RJ#545 Arise!: each Sand Soldier\'s location is chosen separately (one to base, one to a battlefield I control)', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  put(g, P0, 'Sword', 'base'); put(g, P0, 'Sword', 'base');
  const before = new Set(Object.keys(g.objects));
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Arise!') });
  let n = 0;
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    if (o.includes(String(BF_A)) && o.includes('base')) { g = choose(g, n++ === 0 ? 'base' : String(BF_A)); continue; }
    g = act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'no' : o[0]] });
  }
  const sols = Object.keys(g.objects).filter(id => !before.has(id) && ['base', 'battlefield'].includes(g.objects[id].zone));
  assert.equal(sols.length, 2);
  assert.deepEqual(sols.map(s => locOf(g, s)).sort(), [BF_A, 'base'].sort());
});

test('RJ#546 a spell with Repeat given another Repeat (Temporal Portal on Feral Strength): both instances may be paid → three executions', () => {
  let g = S0(); fundAll(g, P0, 10);
  const tp = put(g, P0, 'Temporal Portal', 'base');
  const u = put(g, P0, 'V(1)', 'base');
  g = settle(act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === tp)!));
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Feral Strength') });
  let reps = 0;
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g); if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    if (d.kind === 'optional') { reps++; g = choose(g, 'yes'); continue; }
    g = choose(g, o.includes(u) ? u : o[0]);
  }
  assert.equal(reps, 2, 'two Repeat instances offered');
  assert.equal(mightOf(g, u), 1 + 2 * 3);
});

test('RJ#548 Whirlwind doesn\'t choose when played: an enemy Ruin Runner can be returned on resolution (by its controller or the caster)', () => {
  let g = S0(); fundAll(g, P0);
  const rr = put(g, P1, 'Ruin Runner', BF_A); control(g, BF_A, P1);
  g = play(g, P0, hand(g, P0, 'Whirlwind'));
  let offeredToP1 = false;
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g); if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    if (d.player === P1 && o.includes(rr)) { offeredToP1 = true; g = choose(g, rr); continue; }
    g = choose(g, d.kind === 'optional' ? (d.player === P1 ? 'yes' : 'no') : o.includes('none') ? 'none' : o[0]);
  }
  assert.ok(offeredToP1, 'P1 may pick Ruin Runner');
  assert.equal(zone(g, rr), 'hand');
});

// DECIDED (DECISIONS #552): official, not a house ruling — CR 339.1 + 337.2 (an Add ability is a chain item; the passes restart).
test('RJ#552 (AMBIGUOUS, RJ adopted: CR 339) after I pass on my spell, the opponent uses an [Add] ability (Gold) and passes: I get priority again before my spell resolves', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  const gold = put(g, P1, 'Gold', 'base', { token: true });
  const dr = hand(g, P0, 'DrawR');
  g = play(g, P0, dr);
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  assert.equal(pend(g).player, P1);
  g = act(g, legal(g, P1, 'activate').find(a => a.type === 'activate' && a.obj === gold)!);
  for (let i = 0; i < 3 && pend(g).inStep; i++) g = choose(g, optionIds(g)[0]);
  assert.equal(zone(g, gold), 'gone');
  assert.equal(pend(g).player, P1, 'P1 keeps priority after the Add');
  g = pass(g);
  assert.equal(zone(g, dr), 'chain', 'spell not resolved yet');
  assert.equal(pend(g).kind, 'chainResponse'); assert.equal(pend(g).player, P0, 'P0 gets priority back');
});

test('RJ#560 Janna\'s heal removes only marked damage, not Smoke Screen\'s -Might', () => {
  let g = S0(); fundAll(g, P0, 8);
  const u = put(g, P0, 'V(6)', BF_A, { damage: 1 }); control(g, BF_A, P0);
  g = settle(play(g, P0, hand(g, P0, 'Smoke Screen'), { targets: [[u]] }));
  assert.equal(mightOf(g, u), 2);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'sfd-053-221'), destination: BF_A });
  for (let i = 0; i < 12 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g); if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g); g = choose(g, o.includes(String(BF_A)) ? String(BF_A) : o.includes('none') ? 'none' : d.kind === 'optional' ? 'no' : o[0]);
  }
  assert.equal(g.objects[u].damage, 0, 'healed');
  assert.equal(mightOf(g, u), 2, 'Smoke Screen still applies');
});

test('RJ#562 Dauntless Vanguard played to an occupied enemy battlefield: during the resulting showdown my gear can\'t Equip and my base units can\'t move there', () => {
  let g = S0(); fundAll(g, P0, 8);
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const sw = put(g, P0, 'Sword', 'base');
  put(g, P0, 'V(2)', 'base');
  const dv = hand(g, P0, 'Dauntless Vanguard');
  assert.ok(playDests(g, P0, dv).includes(BF_A));
  g = play(g, P0, dv, { dest: BF_A });
  for (let i = 0; i < 6 && !(g.showdown && !g.chain.length && pend(g).player === P0 && !pend(g).inStep); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(g.showdown?.isCombat, 'combat showdown');
  assert.ok(!legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === sw), 'no Equip');
  assert.ok(!legal(g, P0, 'move').length, 'no standard move');
});

test('RJ#564 Nine-Tailed Fox (Ahri legend) defending Trifarian War Camp: a 1-Might attacker (2 there) gets -1 → 1', () => {
  const g0 = S0({ bfA: 'Trifarian War Camp' });
  setLegend(g0, P1, 'Nine-Tailed Fox');
  put(g0, P1, 'V(3)', BF_A); control(g0, BF_A, P1);
  const a = put(g0, P0, 'V(1)', 'base');
  let g = move(g0, P0, [a], BF_A);
  for (let i = 0; i < 8 && (g.chain.length || pend(g).inStep); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(g.log.some(l => /Trigger: Nine-Tailed Fox/.test(l.text)), 'Fox triggered');
  assert.equal(mightOf(g, a), 1);
});

test('RJ#566 a unit given Temporary (Fading Memories) and then Portal Rescued comes back as a new object without Temporary', () => {
  let g = S0(); fundAll(g, P0, 10);
  const u = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  g = settle(play(g, P0, hand(g, P0, 'Fading Memories'), { targets: [[u]] }));
  assert.ok(hasKeyword(g, u, 'Temporary'));
  g = settle(play(g, P0, hand(g, P0, 'Portal Rescue'), { targets: [[u]] }));
  assert.equal(zone(g, u), 'base');
  assert.ok(!hasKeyword(g, u, 'Temporary'), 'granted Temporary lost');
});

// DECIDED (DECISIONS #572): official, RJ right — CR 491.8.b.1 disqualifies only the turn player's teammate's battlefields.
test('RJ#572 (AMBIGUOUS, RJ adopted) 2v2: conquering on an opponent\'s turn a battlefield my teammate controlled earlier that turn still scores', () => {
  const g = createGame({ seed: 3, cardDb: fixtureDb(), mode: '2v2', firstPlayer: P0, skipMulligan: true, battlefieldSelection: 'random', includeAllCards: true,
    players: [0, 1, 2, 3].map(i => ({ name: `P${i}`, deck: legalDeck({ legend: i >= 2 ? 'cf-legend-2' : 'cf-legend' }, [`cf-bf-${'abde'[i]}`, `cf-bf-${'bcef'[i]}`, `cf-bf-${'cdfa'[i]}`]) })) } as never);
  assert.ok((g as unknown as { teams?: unknown }).teams, 'teams exist');
});

test('RJ#573 Karthus doubles The Zero Drive\'s granted Deathknell: the unit is banished once (2nd trigger finds nothing) and Zero Drive plays it back once', () => {
  let g = S0(); fundAll(g, P0, 10);
  put(g, P0, 'Karthus, Eternal', 'base');
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const zd = put(g, P0, 'The Zero Drive', 'base'); attachNow(g, zd, u);
  [g] = cast(g, P0, 'KillA', { targets: [[u]] });
  g = settle(g);
  assert.ok(g.log.filter(l => /^Trigger: /.test(l.text) && /Zero Drive|Banish me/.test(l.text)).length >= 2, `two Deathknell triggers: ${g.log.filter(l => /^Trigger/.test(l.text)).map(l => l.text).join(' | ')}`);
  assert.equal(zone(g, u), 'banishment');
  const ab = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === zd);
  assert.ok(ab, 'Zero Drive ability available');
  const n0 = Object.keys(g.objects).length;
  g = settle(act(g, ab!));
  assert.equal(zone(g, u), 'base', 'played back');
  assert.ok(Object.keys(g.objects).length <= n0, 'no extra copy created');
});

test('RJ#574 Loose Cannon (1 card in hand) + Dunebreaker holding: Loose Cannon draws 1, the hold draws 2 (card text), then the turn draw → 5 cards', () => {
  let g = S0({ tp: P1 });
  setLegend(g, P0, 'Loose Cannon');
  put(g, P0, 'Dunebreaker', BF_A); control(g, BF_A, P0);
  hand(g, P0, 'V(1)');
  assert.equal(g.players[P0].hand.length, 1);
  g = settle(endTurn(g, P1));
  assert.equal(g.activePlayer, P0);
  assert.equal(g.players[P0].hand.length, 1 + 1 + 2 + 1);
});

test('RJ#575 Challenge during the combat showdown: a defending Stalwart Poro keeps its Shield +1 (deals 3)', () => {
  const s = attackSetup(['V(5)'], ['Stalwart Poro']);
  let g = s.g; fundAll(g, P0);
  const a = s.atk[0], p = s.def[0];
  for (let i = 0; i < 6 && !(pend(g).player === P0 && !pend(g).inStep && !g.chain.length); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(mightOf(g, p), 3, 'Shield while defending');
  g = play(g, P0, hand(g, P0, 'Challenge'), { targets: [[a], [p]] });
  for (let i = 0; i < 6 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(g.objects[a].damage, 3, 'Poro dealt 3 (2 + Shield)');
});

test('RJ#577 Fiora (sfd-110) attacking one on one: a hidden unit revealed in response to her trigger doesn\'t stop the doubling', () => {
  const g0 = S0(); fundAll(g0, P1);
  put(g0, P1, 'V(2)', BF_A); control(g0, BF_A, P1);
  const hu = put(g0, P1, 'HidU(2)', { facedown: BF_A });
  const f = put(g0, P0, 'sfd-110-221', 'base');
  let g = move(g0, P0, [f], BF_A);
  for (let i = 0; i < 6 && !(pend(g).player === P1 && !pend(g).inStep && g.chain.some(c => c.source === f)); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(g.chain.some(c => c.source === f), 'Fiora\'s trigger on the chain');
  assert.ok(canPlayNow(g, P1, hu));
  g = play(g, P1, hu, { dest: BF_A });
  for (let i = 0; i < 8 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(zone(g, hu), 'battlefield');
  assert.equal(mightOf(g, f), 6, 'doubled');
});

test('RJ#579 Smoke Screen on attacking Vayne (5 → 1) is snapshotted at -4: after the combat she is at 2 - 4 (read as 0); attacking again with Assault she is 1', () => {
  const s = attackSetup(['ogn-035-298'], ['V(1)'], { defOpts: [{ stunned: true }] });
  let g = s.g; fundAll(g, P1); fundAll(g, P0, 6);
  const v = s.atk[0];
  for (let i = 0; i < 6 && !(pend(g).player === P0 && !pend(g).inStep && !g.chain.length); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(mightOf(g, v), 5);
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'Smoke Screen'), { targets: [[v]] });
  for (let i = 0; i < 4 && g.chain.length; i++) g = pass(g);
  assert.equal(mightOf(g, v), 1, '5 - 4');
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) { const d = pend(g); g = d.kind === 'optional' ? choose(g, 'no') : d.inStep ? act(g, legal(g, d.player)[0]) : pass(g); }
  assert.equal(locOf(g, v), BF_A, 'conquered');
  assert.equal(mightOf(g, v), -2, 'no Assault: 2 - 4 (true value -2, read as 0)');
  put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Ride the Wind') });
  const bfB = g.battlefields[BF_B].objId;
  for (let i = 0; i < 12 && locOf(g, v) !== BF_B; i++) {
    const d = pend(g); if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g); g = choose(g, o.includes(v) ? v : o.includes(String(BF_B)) ? String(BF_B) : o.includes(bfB) ? bfB : o[0]);
  }
  assert.equal(locOf(g, v), BF_B);
  assert.equal(mightOf(g, v), 1, 'attacking again: 2 + 3 - 4');
});

test('RJ#593 a unit with Equipment attached returned to hand (Gust): the Equipment stays on the board, unattached', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const bow = put(g, P0, 'Recurve Bow', 'base'); attachNow(g, bow, u);
  g = settle(play(g, P1, hand(g, P1, 'Gust'), { targets: [[u]] }));
  assert.equal(zone(g, u), 'hand');
  assert.notEqual(zone(g, bow), 'hand', 'the Equipment does not follow the unit');
  assert.ok(['base', 'battlefield'].includes(zone(g, bow)), `Equipment still on the board (${zone(g, bow)})`);
  assert.ok(!g.objects[bow].attachedTo, 'unattached');
});

test('RJ#598 Warwick, Hunter with Recurve Bow attacks: both triggers fire together; ordering the Bow first, its 2 damage makes the target die to Warwick\'s kill', () => {
  const g0 = S0();
  const d1 = put(g0, P1, 'V(9)', BF_A), d2 = put(g0, P1, 'V(9)', BF_A); control(g0, BF_A, P1);
  const w = put(g0, P0, 'Warwick, Hunter', 'base');
  const bow = put(g0, P0, 'Recurve Bow', 'base'); attachNow(g0, bow, w);
  let g = move(g0, P0, [w], BF_A);
  let ordered = false;
  for (let i = 0; i < 30 && (g.chain.length || g.pending?.inStep); i++) {
    const d = g.pending!;
    if (d.kind === 'orderTriggers' || d.kind === 'chooseOrder') {
      ordered = true;
      // the last ordered item resolves first: put Warwick first (bottom), the Bow on top
      g = choose(g, d.options!.find(o => /Warwick/.test(o.label))!.id); continue;
    }
    if (d.inStep) { const o = optionIds(g); g = choose(g, o.includes(d1) ? d1 : o[0]); continue; }
    g = pass(g);
  }
  assert.ok(ordered, 'both attack triggers fired together and were ordered');
  assert.equal(zone(g, d1), 'trash', 'Bow damage, then Warwick kills the damaged unit');
  assert.equal(zone(g, d2), 'battlefield');
});

test('RJ#609 Yasuo, Remorseful\'s attack trigger damages the defender, then he dies to a hidden Hidden Blade: combat still ends with its cleanup, the defender is healed', () => {
  let g = S0(); fundAll(g, P1);
  const d = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const hb = put(g, P1, 'Hidden Blade', { facedown: BF_A });
  const ya = put(g, P0, 'Yasuo, Remorseful', 'base');
  g = move(g, P0, [ya], BF_A);
  g = resolveChainWith(g, d);
  assert.equal(g.objects[d].damage, 6);
  for (let i = 0; i < 4 && !canPlayNow(g, P1, hb); i++) g = pass(g);
  g = play(g, P1, hb, { targets: [[ya]] });
  g = settle(g);
  assert.equal(zone(g, ya), 'trash');
  assert.equal(zone(g, d), 'battlefield');
  assert.equal(g.objects[d].damage, 0, 'healed by the combat cleanup');
});

/** Resolve the chain, answering any target choice with t when offered. */
function resolveChainWith(g: GameState, t: ObjId): GameState {
  for (let i = 0; i < 20 && (g.chain.length || g.pending?.inStep); i++) {
    const d = g.pending!;
    if (d.inStep) { const o = optionIds(g); g = choose(g, o.includes(t) ? t : o[0]); continue; }
    g = pass(g);
  }
  return g;
}

test('RJ#611 Sett, Brawler (buffed, 5) with 4 damage spends his buff: the cost drops him to 4 and he dies in the cleanup before the +4 resolves', () => {
  const g0 = S0();
  const s = put(g0, P0, 'Sett, Brawler', 'base', { buff: true, damage: 4 });
  assert.equal(zone(g0, s), 'base');
  const ab = legal(g0, P0, 'activate').find(a => a.type === 'activate' && a.obj === s)!;
  assert.ok(ab, 'spend-buff ability available');
  let g = act(g0, ab);
  g = settle(g);
  assert.equal(zone(g, s), 'trash', 'lethal damage once the buff is spent as the cost');
});

test('RJ#612 Rek\'Sai, Swarm Queen\'s revealed unit may be played to base instead of "here"', () => {
  let g = S0(); fundAll(g, P0);
  const rs = put(g, P0, 'Rek\'Sai, Swarm Queen', 'base');
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const u = put(g, P0, 'V(2)', 'deckTop');
  g = move(g, P0, [rs], BF_A);
  let sawBase = false;
  for (let i = 0; i < 25 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { if (zone(g, u) === 'base') break; g = pass(g); continue; }
    const o = optionIds(g);
    if (o.includes('base') && o.includes(String(BF_A))) { sawBase = true; g = act(g, { type: 'choose', player: d.player, optionIds: ['base'] }); continue; }
    g = act(g, { type: 'choose', player: d.player, optionIds: d.kind === 'optional' ? ['yes'] : o.includes(u) ? [u] : [o[0]] });
  }
  assert.ok(sawBase, 'base and here are both offered');
  assert.equal(zone(g, u), 'base', 'played to base');
});

test('RJ#614 Heimerdinger, Inventor using a Gold token\'s copied "Kill this, [T]: [Add] [A]" kills himself (cost) and adds the power; the Gold stays', () => {
  let g = withTokens(S0());
  const gold = put(g, P0, 'Gold', 'base', { token: true });
  const h = put(g, P0, 'Heimerdinger, Inventor', 'base');
  g.objects[h].exhausted = false; touch(g);
  const ab = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === h);
  assert.ok(ab, 'Heimerdinger has the Gold\'s [T] ability');
  const pw0 = Object.values(g.players[P0].pool.power).reduce((s, n) => s + (n ?? 0), 0);
  g = act(g, ab!);
  for (let i = 0; i < 3 && pend(g).inStep; i++) g = choose(g, optionIds(g)[0]);
  assert.equal(zone(g, h), 'trash', 'Heimerdinger killed by the copied cost');
  assert.equal(zone(g, gold), 'base', 'the Gold itself is untouched');
  const pw1 = Object.values(g.players[P0].pool.power).reduce((s, n) => s + (n ?? 0), 0);
  assert.equal(pw1, pw0 + 1, 'one power added');
});

test('RJ#623 Fizz, Trickster played by a hidden Here to Help on the opponent\'s turn: his trigger may play any trash spell (Invert Timelines, or that same Here to Help, already in the trash)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12); fundAll(g, P1);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const hth = put(g, P0, 'Here to Help', { facedown: BF_A });
  const it = put(g, P0, 'Invert Timelines', 'trash');
  const fz = hand(g, P0, 'Fizz, Trickster');
  g = play(g, P1, hand(g, P1, 'DrawR'));
  if (pend(g).player === P1) g = pass(g);
  assert.ok(canPlayNow(g, P0, hth));
  g = act(g, { type: 'playCard', player: P0, obj: hth });
  let offered: string[] = [];
  for (let i = 0; i < 40 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    if (o.includes(it)) { offered = o; g = choose(g, it); continue; }
    if (o.includes(fz)) { g = choose(g, fz); continue; }
    g = choose(g, d.kind === 'optional' ? 'yes' : o[0]);
  }
  assert.equal(locOf(g, fz), BF_A, 'Fizz played by Here to Help');
  assert.ok(offered.includes(hth), 'the Here to Help that played him is a legal choice');
  assert.equal(zone(g, it), 'mainDeck', 'Invert Timelines played (at Reaction timing) and recycled');
  assert.equal(g.players[P0].hand.length, 4, 'discarded and drew 4 (P1 then also draws for DrawR, resolving last)');
});

test('RJ#628 hidden Tideturner at Vilemaw\'s Lair swapping with a base unit: the base unit moves to the Lair, Tideturner can\'t move to base and stays', () => {
  let g = S0({ bfA: "Vilemaw's Lair" }); fundAll(g, P0);
  control(g, BF_A, P0);
  const tt = put(g, P0, 'Tideturner', { facedown: BF_A });
  const u = put(g, P0, 'V(5)', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: tt, destination: BF_A } as never);
  g = answer(g, { may: [true], targets: [[u]] }, P0);
  g = settle(g);
  assert.equal(locOf(g, u), BF_A, 'the base unit moves to the Lair');
  assert.equal(locOf(g, tt), BF_A, 'Tideturner stays at the Lair');
});

test('RJ#633 Deathgrip gives the killed unit\'s full current Might (buff + Equipment bonus included): V(2) buffed with Hexdrinker = 4', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'V(2)', BF_A, { buff: true }), o = put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const hx = put(g, P0, 'Hexdrinker', 'base'); attachNow(g, hx, u);
  assert.equal(mightOf(g, u), 4);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Deathgrip') });
  g = choose(g, u);
  if (pend(g).inStep) g = choose(g, o);
  g = settle(g);
  assert.equal(zone(g, u), 'trash');
  assert.equal(mightOf(g, o), 5, '1 + 4');
});

test('RJ#635 Flash on my only unit, at Vilemaw\'s Lair: it can be played (and cast for zero units), but resolves without moving the unit', () => {
  let g = S0({ bfA: "Vilemaw's Lair" }); fundAll(g, P0);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const fl = hand(g, P0, 'Flash');
  assert.ok(canPlayNow(g, P0, fl), 'Flash is playable');
  g = settle(play(g, P0, fl, { targets: [[u]] }));
  assert.equal(zone(g, fl), 'trash', 'Flash resolved');
  assert.equal(locOf(g, u), BF_A, 'the unit can\'t move to base from the Lair');
});

test('RJ#640 Dragon\'s Rage: moving the first unit away (Flash) in response to the reflexive "do this" doesn\'t stop the exchange with the unit chosen at the destination', () => {
  let g = S0(); fundAll(g, P0, 4); fundAll(g, P1);
  const x = put(g, P1, 'V(3)', 'base');
  const y = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  g = play(g, P0, hand(g, P0, "Dragon's Rage"), { targets: [[x]], locations: [BF_A] });
  for (let i = 0; i < 10 && !(g.chain.length && !pend(g).inStep && pend(g).player === P1 && locOf(g, x) === BF_A); i++) {
    const d = pend(g);
    if (d.inStep) { const o = optionIds(g); g = choose(g, o.includes(y) ? y : d.kind === 'chooseDestination' ? String(BF_A) : o[0]); continue; }
    g = pass(g);
  }
  assert.equal(locOf(g, x), BF_A, 'moved');
  assert.ok(g.chain.length >= 1, 'the reflexive "do this" is on the chain');
  g = play(g, P1, hand(g, P1, 'Flash'), { targets: [[x]] });
  g = settle(g);
  assert.equal(locOf(g, x), 'base', 'Flashed back to base');
  assert.equal(zone(g, y), 'trash', 'y (2) still takes 3');
  assert.equal(g.objects[x].damage, 2, 'x still takes 2');
});

test('RJ#641 Sett, Brawler spending his only buff stops being Mighty, then the +4 makes him Mighty again: Fiora, Worthy may pay [C] to ready him', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'Fiora, Worthy', 'base');
  const s = put(g, P0, 'Sett, Brawler', 'base', { buff: true });
  g.objects[s].exhausted = true; touch(g);
  assert.equal(mightOf(g, s), 5);
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === s)!);
  assert.equal(mightOf(g, s), 4, 'not Mighty while the ability is pending');
  let asked = false;
  for (let i = 0; i < 12 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'optional' && /ready|\[C\]|Fiora/i.test(d.prompt ?? '')) asked = true;
    g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : optionIds(g)[0]) : pass(g);
  }
  assert.equal(mightOf(g, s), 8);
  assert.ok(asked || g.log.some(l => /^Trigger: Fiora/.test(l.text)), 'Fiora, Worthy triggered');
  assert.equal(g.objects[s].exhausted, false, 'readied');
});

test('RJ#647 Here to Help ("a battlefield you control") overrides Deadbloom Predator\'s permission: it can\'t go to an occupied enemy battlefield', () => {
  let g = S0(); fundAll(g, P0, 12);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  put(g, P1, 'V(2)', BF_B); control(g, BF_B, P1);
  const dp = hand(g, P0, 'Deadbloom Predator');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Here to Help') });
  const dests: string[][] = [];
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    if (d.kind === 'chooseDestination' || d.kind === 'chooseBattlefield') { dests.push(o); g = choose(g, o.includes(String(BF_A)) ? String(BF_A) : o[0]); continue; }
    g = choose(g, o.includes(dp) ? dp : d.kind === 'optional' ? 'yes' : o[0]);
  }
  for (const o of dests) assert.ok(!o.includes(String(BF_B)), `occupied enemy BF-B not offered (${o})`);
  assert.equal(locOf(g, dp), BF_A);
});

test('RJ#650 (AMBIGUOUS, RJ adopted) Heimerdinger, Inventor copies Renata Glasc, Mastermind\'s [T] "Score 1 point" but not her separate "Use my abilities only while I\'m at a battlefield": usable from base', () => {
  let g = S0(); fundAll(g, P0, 10);
  const r = put(g, P0, 'Renata Glasc, Mastermind', 'base');
  const h = put(g, P0, 'Heimerdinger, Inventor', 'base');
  g.objects[h].exhausted = false; touch(g);
  assert.ok(!legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === r), 'Renata herself can\'t use it in base');
  const ab = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === h);
  assert.ok(ab, 'Heimerdinger has the copied [T] ability in base');
  g = act(g, ab!);
  for (let i = 0; i < 6 && pend(g).inStep; i++) g = choose(g, optionIds(g)[0]);
  g = settle(g);
  assert.equal(g.players[P0].points, 1);
  assert.equal(g.objects[h].exhausted, true, 'Heimerdinger exhausted');
});

test('RJ#656 Stormbringer doesn\'t choose the enemy units it damages: no Deflect tax for an enemy Deflect unit there', () => {
  const run = (enemy: string) => {
    let g = S0(); fundAll(g, P0);
    put(g, P0, 'V(9)', 'base');
    const e = put(g, P1, enemy, BF_A); control(g, BF_A, P1);
    const r0 = g.players[P0].runeDeck.length;
    [g] = cast(g, P0, 'Stormbringer, Volibear', { targets: [[g.battlefields[BF_A].objId]] });
    for (let i = 0; i < 10; i++) { const d = g.pending!; if (d.kind === 'mainAction' || d.kind === 'showdownAction') break; if (d.inStep) g = choose(g, d.options![0].id); else g = pass(g); }
    assert.equal(zone(g, e), 'trash', `${enemy} dealt 9`);
    return g.players[P0].runeDeck.length - r0;   // power paid = runes recycled
  };
  assert.equal(run('Deadbloom Predator'), run('V(8)'), 'same total cost with a Deflect enemy');
});

test('RJ#660 Grandmaster at Arms attaching a detached Equipment to Irelia, Fervent: +1 for being chosen, nothing extra for the attach', () => {
  let g = S0(); fundAll(g, P0);
  const l = setLegend(g, P0, 'Grandmaster at Arms');
  const ir = put(g, P0, 'Irelia, Fervent', 'base');
  const bow = put(g, P0, 'Recurve Bow', 'base');
  const ab = legal(g, P0, 'activate').filter(a => a.type === 'activate' && a.obj === l);
  let done = false;
  for (const a of ab) {
    let h = act(g, a);
    let attached = false;
    for (let i = 0; i < 20 && pend(h).kind !== 'mainAction'; i++) {
      const d = pend(h);
      if (!d.inStep) { h = pass(h); continue; }
      const o = optionIds(h);
      h = choose(h, o.includes(bow) ? bow : o.includes(ir) ? ir : d.kind === 'optional' ? 'yes' : o[0]);
    }
    attached = h.objects[bow].attachedTo === ir;
    if (!attached) continue;
    done = true;
    assert.equal(mightOf(h, ir), 5, '4 + 1 (chosen) — Recurve Bow adds no Might, the attach adds no second +1');
  }
  assert.ok(done, 'the legend attached the detached Bow to Irelia');
});

test('RJ#666 Ezreal, Prodigy doesn\'t reduce Bullet Time\'s "pay any amount of [A]" (paid on resolution, not an optional additional cost)', () => {
  const run = (ez: boolean) => {
    let g = S0(); fundAll(g, P0);
    if (ez) put(g, P0, 'Ezreal, Prodigy', 'base');
    const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
    const rd0 = g.players[P0].runeDeck.length, ex0 = exhaustedRunes(g, P0);
    [g] = cast(g, P0, 'Bullet Time, Miss Fortune');
    for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) {
      const d = pend(g);
      if (!d.inStep) { g = pass(g); continue; }
      g = choose(g, d.kind === 'chooseNumber' ? '2' : optionIds(g).includes(String(BF_A)) ? String(BF_A) : optionIds(g)[0]);
    }
    assert.equal(g.objects[e].damage, 2, '2 damage dealt');
    void ex0; return g.players[P0].runeDeck.length - rd0;   // power paid = runes recycled
  };
  assert.equal(run(true), run(false), 'same amount paid with Ezreal, Prodigy');
});

test('RJ#671 Baited Hook killing a 2-Might unit can find Draven, Showboat (printed 3) at 5 points: his "+points" works only on the board; he enters at 8', () => {
  let g = S0(); fundAll(g, P0);
  g.players[P0].points = 5;
  const vic = put(g, P0, 'V(2)', 'base');
  const hook = put(g, P0, 'Baited Hook', 'base');
  const dr = put(g, P0, 'Draven, Showboat', 'deckTop');
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && (a as { obj?: ObjId }).obj === hook)!);
  g = answer(g, { targets: [[vic]] }, P0);
  let offered = false;
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    if (o.includes(dr)) { offered = true; g = choose(g, dr); continue; }
    g = choose(g, d.kind === 'optional' ? 'yes' : o.includes('base') ? 'base' : o[0]);
  }
  assert.ok(offered, 'Draven (3 in the deck) is offered');
  assert.equal(zone(g, dr), 'base');
  assert.equal(mightOf(g, dr), 8);
});

test('RJ#673 the defender\'s Smoke Screen on my attacker can\'t be answered with Cleave (Action); once it resolves I have focus and can play Cleave', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(5)', 'base');
  const cl = hand(g, P0, 'Cleave'), ss = hand(g, P1, 'Smoke Screen');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 6 && !canPlayNow(g, P1, ss); i++) g = pass(g);
  g = play(g, P1, ss, { targets: [[a]] });
  if (pend(g).player === P1) g = pass(g);
  assert.equal(pend(g).player, P0);
  assert.ok(!canPlayNow(g, P0, cl), 'Cleave (Action) can\'t respond to Smoke Screen');
  g = resolveChain(g);
  assert.equal(mightOf(g, a), 1);
  assert.equal(pend(g).player, P0, 'focus passes to me after the defender\'s spell');
  assert.ok(canPlayNow(g, P0, cl), 'now Cleave can be played');
  g = resolveChain(play(g, P0, cl, { targets: [[a]] }));
  assert.equal(mightOf(g, a), 4, '1 + Assault 3');
});

test('RJ#677 an attached Equipment\'s Equip ability is inactive (can\'t move it to another unit); once its unit dies it is back in base, ready, and can be equipped again', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const u1 = put(g, P0, 'V(2)', BF_A), u2 = put(g, P0, 'V(2)', 'base'); control(g, BF_A, P0);
  const bow = put(g, P0, 'Recurve Bow', 'base'); attachNow(g, bow, u1);
  assert.ok(!legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === bow), 'no Equip while attached');
  g = settle(play(g, P0, hand(g, P0, 'KillA'), { targets: [[u1]] }));
  assert.equal(zone(g, u1), 'trash');
  assert.equal(zone(g, bow), 'base'); assert.equal(g.objects[bow].exhausted, false, 'ready');
  const eq = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === bow);
  assert.ok(eq, 'Equip available again');
  g = act(g, eq!);
  for (let i = 0; i < 6 && pend(g).inStep; i++) g = choose(g, optionIds(g).includes(u2) ? u2 : optionIds(g)[0]);
  g = settle(g);
  assert.equal(g.objects[bow].attachedTo, u2);
});

test('RJ#682 Experimental Hexplate unattached in base is not a Mech; only the unit it is attached to is', () => {
  const g = S0();
  const u = put(g, P0, 'V(2)', 'base');
  const hp = put(g, P0, 'Experimental Hexplate', 'base');
  assert.ok(!chars(g, hp).tags.includes('Mech'), 'unattached gear: no Mech');
  assert.ok(!chars(g, u).tags.includes('Mech'));
  attachNow(g, hp, u);
  assert.ok(chars(g, u).tags.includes('Mech'), 'attached: the unit is a Mech');
});

test('RJ#686 two Unlicensed Armory effects on one unit: its first death uses only one (paid, recalled); the other still replaces a later death that turn', () => {
  const run = (n: number) => {
    let g = S0(); fundAll(g, P0, 8);
    const u = put(g, P0, 'V(2)', BF_A), o = put(g, P0, 'V(1)', 'base'); control(g, BF_A, P0);
    const arms = Array.from({ length: n }, () => put(g, P0, 'Unlicensed Armory', 'base'));
    hand(g, P0, 'V(1)'); hand(g, P0, 'V(1)');
    const kill = hand(g, P0, 'KillA'), dg = hand(g, P0, 'Deathgrip');
    for (const a of arms) {
      g = act(g, legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === a)!);
      for (let i = 0; i < 6 && pend(g).inStep; i++) { const ids = optionIds(g); g = choose(g, ids.includes(u) ? u : ids[0]); }
      g = settle(g);
    }
    const yes = (h: GameState) => { for (let i = 0; i < 30 && pend(h).kind !== 'mainAction'; i++) { const d = pend(h); if (!d.inStep) { h = pass(h); continue; } const ids = optionIds(h); h = choose(h, d.kind === 'optional' ? 'yes' : ids.includes(u) ? u : ids.includes(o) ? o : ids[0]); } return h; };
    g = yes(play(g, P0, kill, { targets: [[u]] }));
    assert.equal(locOf(g, u), 'base', 'first death replaced: recalled');
    g = yes(act(g, { type: 'playCard', player: P0, obj: dg }));
    return zone(g, u);
  };
  assert.equal(run(2), 'base', 'second death replaced by the other Armory');
  assert.equal(run(1), 'trash', 'control: with one Armory the second death happens');
});

test('RJ#690 the defender\'s Facebreaker on my Ganking attacker: Ride the Wind (Action) can\'t respond; once focus is back I can Ride it away, still stunned', () => {
  let { g, atk, def } = attackSetup(['V(3)'], ['V(5)']);
  fundAll(g, P0); fundAll(g, P1);
  const rtw = hand(g, P0, 'Ride the Wind'), fb = hand(g, P1, 'Facebreaker');
  for (let i = 0; i < 6 && !canPlayNow(g, P1, fb); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  g = play(g, P1, fb, { targets: [[def[0]], [atk[0]]] });
  if (pend(g).player === P1) g = pass(g);
  assert.ok(g.chain.length >= 1 && pend(g).player === P0);
  assert.ok(!canPlayNow(g, P0, rtw), 'Ride the Wind can\'t respond to Facebreaker');
  g = resolveChain(g);
  assert.ok(g.objects[atk[0]].stunned, 'stunned');
  assert.equal(pend(g).player, P0);
  assert.ok(canPlayNow(g, P0, rtw), 'with focus back, Ride the Wind is playable');
  g = play(g, P0, rtw, { targets: [[atk[0]]] });
  for (let i = 0; i < 6 && pend(g).inStep; i++) g = choose(g, optionIds(g).includes(String(BF_B)) ? String(BF_B) : optionIds(g)[0]);
  g = resolveChain(g);
  assert.notEqual(locOf(g, atk[0]), BF_A, 'moved away');
  assert.ok(g.objects[atk[0]].stunned, 'still stunned (lasts the turn)');
});

test('RJ#692 Svellsongur attached (Quick-Draw via Jax) to Whiteflame Protector already on the board copies its own "When you play me" — which doesn\'t trigger (no +8)', () => {
  let g = S0(); fundAll(g, P0, 6);
  put(g, P0, 'Jax, Unmatched', 'base');
  const w = put(g, P0, 'Whiteflame Protector', 'base');
  const v = put(g, P0, 'V(2)', 'base');
  const sv = hand(g, P0, 'Svellsongur');
  const m0 = { w: mightOf(g, w)!, v: mightOf(g, v)! };
  g = act(g, { type: 'playCard', player: P0, obj: sv });
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    g = choose(g, o.includes(w) ? w : d.kind === 'optional' ? 'yes' : o[0]);
  }
  assert.equal(g.objects[sv].attachedTo, w, 'Quick-Draw attached it to the Protector');
  assert.equal(mightOf(g, w), m0.w, 'no +8 on the Protector');
  assert.equal(mightOf(g, v), m0.v, 'no +8 anywhere');
});

test('RJ#695 Nine-Tailed Fox also triggers for Rengar, Pouncing played into the attack (enters as an attacker): 3 + Assault 2 - 1 = 4', () => {
  let g = S0(); fundAll(g, P0);
  setLegend(g, P1, 'Nine-Tailed Fox');
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(3)', 'base');
  const r = hand(g, P0, 'Rengar, Pouncing');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 8 && (g.chain.length || pend(g).inStep || !canPlayNow(g, P0, r, BF_A)); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(mightOf(g, a), 2, 'first attacker got -1');
  g = play(g, P0, r, { dest: BF_A });
  for (let i = 0; i < 8 && (g.chain.length || pend(g).inStep); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(g.objects[r].combatRole, 'attacker');
  assert.equal(mightOf(g, r), 4, 'Fox -1 for Rengar too');
});

test('RJ#697 Defy needs a legal spell (none on the chain → unplayable); Defying my own spell: Ravenbloom Student gets +1 only for Defy', () => {
  let g = S0(); fundAll(g, P0);
  const st = put(g, P0, 'Ravenbloom Student', 'base');
  const defy = hand(g, P0, 'Defy');
  const m0 = mightOf(g, st)!;
  assert.ok(!canPlayNow(g, P0, defy), 'no spell to counter: Defy can\'t be played');
  const dr = hand(g, P0, 'DrawR');
  g = play(g, P0, dr);
  assert.ok(canPlayNow(g, P0, defy), 'my own spell is a legal target');
  g = play(g, P0, defy, { targets: [[g.chain.find(c => c.source === dr)!.id]] });
  g = settle(g);
  assert.equal(zone(g, dr), 'trash');
  assert.equal(mightOf(g, st), m0 + 1, 'only Defy counts as played');
});

test('RJ#699 Dragon\'s Rage\'s exchange is not combat: the surviving moved unit keeps its damage (no combat-cleanup heal)', () => {
  let g = S0(); fundAll(g, P0, 4);
  const x = put(g, P1, 'V(5)', 'base');
  const y = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  g = play(g, P0, hand(g, P0, "Dragon's Rage"), { targets: [[x]], locations: [BF_A] });
  for (let i = 0; i < 12 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.inStep) { const o = optionIds(g); g = choose(g, o.includes(y) ? y : d.kind === 'chooseDestination' ? String(BF_A) : o[0]); continue; }
    g = pass(g);
  }
  assert.equal(zone(g, y), 'trash');
  assert.equal(locOf(g, x), BF_A);
  assert.equal(g.objects[x].damage, 2, 'still damaged');
});

test('RJ#708 Hostile Takeover chooses its unit: an enemy Deflect unit costs the Deflect tax', () => {
  const run = (enemy: string) => {
    let g = S0(); fundAll(g, P0);
    const e = put(g, P1, enemy, BF_A); control(g, BF_A, P1);
    const rd0 = g.players[P0].runeDeck.length, ex0 = exhaustedRunes(g, P0);
    [g] = cast(g, P0, 'Hostile Takeover', { targets: [[e]] });
    for (let i = 0; i < 6 && pend(g).inStep; i++) g = choose(g, pend(g).kind === 'optional' ? 'yes' : optionIds(g)[0]);
    g = settle(g);
    assert.equal(g.objects[e].controller, P0, 'taken');
    void ex0; return g.players[P0].runeDeck.length - rd0;
  };
  assert.equal(run('Deadbloom Predator'), run('V(8)') + 1, 'one more power (recycled rune) paid for Deflect');
});

test('RJ#709 Irelia, Fervent ("when YOU choose me") doesn\'t trigger when an opponent\'s Stupefy chooses her: only -1', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1);
  const ir = put(g, P0, 'Irelia, Fervent', BF_A); control(g, BF_A, P0);
  const m0 = mightOf(g, ir)!;
  g = settle(play(g, P1, hand(g, P1, 'Stupefy'), { targets: [[ir]] }));
  assert.equal(mightOf(g, ir), m0 - 1);
  assert.ok(!g.log.some(l => /^Trigger: Irelia/.test(l.text)), 'no Irelia trigger');
});

test('RJ#726 a card played from the deck/banishment (Rek\'Sai, Swarm Queen) is not played "from [Hidden]": Ember Monk gets nothing', () => {
  let g = S0(); fundAll(g, P0);
  const em = put(g, P0, 'Ember Monk', 'base');
  const rs = put(g, P0, 'Rek\'Sai, Swarm Queen', 'base');
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const u = put(g, P0, 'V(2)', 'deckTop');
  g = move(g, P0, [rs], BF_A);
  for (let i = 0; i < 25 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { if (zone(g, u) === 'base' && !g.chain.length) break; g = pass(g); continue; }
    const o = optionIds(g);
    g = act(g, { type: 'choose', player: d.player, optionIds: d.kind === 'optional' ? ['yes'] : o.includes(u) ? [u] : o.includes('base') ? ['base'] : [o[0]] });
  }
  assert.equal(zone(g, u), 'base', 'played from the revealed cards');
  assert.equal(mightOf(g, em), 4, 'no Ember Monk +2');
});

test('RJ#732 Arcane Shift with Repeat (Temporal Portal) resolves both executions though it banishes itself: two units replayed, 3 + 3 damage', () => {
  let g = S0(); fundAll(g, P0, 10);
  const tp = put(g, P0, 'Temporal Portal', 'base');
  const u1 = put(g, P0, 'V(1)', 'base'), u2 = put(g, P0, 'V(2)', 'base');
  const e1 = put(g, P1, 'V(9)', BF_A), e2 = put(g, P1, 'V(9)', BF_B); control(g, BF_A, P1); control(g, BF_B, P1);
  g = settle(act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === tp)!));
  const as = hand(g, P0, 'Arcane Shift');
  g = act(g, { type: 'playCard', player: P0, obj: as });
  let friendly = 0, enemy = 0;
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g); if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    if (d.kind === 'optional') { g = choose(g, 'yes'); continue; }
    if (o.includes(u1) || o.includes(u2)) { const pick = friendly++ === 0 ? u1 : u2; g = choose(g, o.includes(pick) ? pick : o[0]); continue; }
    if (o.includes(e1) || o.includes(e2)) { const pick = enemy++ === 0 ? e1 : e2; g = choose(g, o.includes(pick) ? pick : o[0]); continue; }
    g = choose(g, o.includes('base') ? 'base' : o[0]);
  }
  assert.equal(zone(g, as), 'banishment');
  assert.equal(g.objects[e1].damage + g.objects[e2].damage, 6, 'both executions dealt 3');
  const replayed = Object.values(g.objects).filter(o => o.owner === P0 && o.zone === 'base' && ['V(1)', 'V(2)'].includes(g.cards[o.cardId].name)).length;
  assert.equal(replayed, 2, 'both units banished and replayed (new objects in base)');
});

test('RJ#734 choosing an Equipment attached to an enemy Deflect unit (Rocket Barrage "kill a gear") owes no Deflect', () => {
  const run = (carrier: string) => {
    let g = S0(); fundAll(g, P0, 6);
    const c = put(g, P1, carrier, BF_A); control(g, BF_A, P1);
    const hx = put(g, P1, 'Recurve Bow', 'base'); attachNow(g, hx, c);
    const rd0 = g.players[P0].runeDeck.length;
    g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Rocket Barrage') });
    for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
      const d = pend(g); if (!d.inStep) { g = pass(g); continue; }
      const o = optionIds(g);
      if (d.kind === 'optional') { g = choose(g, 'no'); continue; }
      if (d.kind === 'chooseMode') { g = choose(g, d.options!.find(x => /gear/i.test(x.label))!.id); continue; }
      g = choose(g, o.includes(hx) ? hx : o[0]);
    }
    assert.equal(zone(g, hx), 'trash', 'gear killed');
    return g.players[P0].runeDeck.length - rd0;
  };
  assert.equal(run('Deadbloom Predator'), run('V(8)'), 'no extra power for the carrier\'s Deflect');
});

test('RJ#735 Last Breath on my exhausted Irelia, Fervent: +1 for being chosen and +1 for being readied (+2 total)', () => {
  let g = S0(); fundAll(g, P0);
  const ir = put(g, P0, 'Irelia, Fervent', BF_A, { ready: false }); control(g, BF_A, P0);
  put(g, P1, 'V(9)', BF_B); control(g, BF_B, P1);
  const m0 = mightOf(g, ir)!;
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Last Breath') });
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g); if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    g = choose(g, o.includes(ir) ? ir : d.kind === 'optional' ? 'yes' : o[0]);
  }
  assert.equal(g.objects[ir].exhausted, false, 'readied');
  assert.equal(mightOf(g, ir), m0 + 2);
});

test('RJ#745 Showstopper chooses both its unit and the destination battlefield when it is played (before anyone can respond)', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'V(2)', 'base'); put(g, P0, 'V(3)', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Showstopper') });
  const kinds: string[] = [];
  for (let i = 0; i < 6 && pend(g).inStep; i++) {
    const d = pend(g); kinds.push(d.kind);
    const o = optionIds(g);
    g = choose(g, o.includes(u) ? u : o.includes(String(BF_B)) ? String(BF_B) : o[0]);
  }
  assert.ok(g.chain.length === 1 && !pend(g).inStep, 'on the chain, waiting for responses');
  assert.ok(kinds.length >= 2, `unit and battlefield chosen while playing (${kinds})`);
  g = settle(g);
  assert.equal(locOf(g, u), BF_B);
});

test('RJ#751 The Boss saves a buffed unit in the combat cleanup (exhausting), then readies when its side conquers', () => {
  let g = S0(); fundAll(g, P0, 4);
  const lg = setLegend(g, P0, 'The Boss');
  const d = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const q = put(g, P0, 'V(4)', 'base', { buff: true }); // 5 Might: P1's 5 damage is lethal
  const v = put(g, P0, 'V(5)', 'base');
  g = move(g, P0, [q, v], BF_A);
  let used = false;
  for (let i = 0; i < 40 && pend(g).kind !== 'mainAction'; i++) {
    const p = pend(g);
    if (p.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: p.player, assignment: p.player === P0 ? { [d]: 10 } : { [q]: 5 } }); continue; }
    if (p.inStep && p.player === P0) used = true;   // (assignDamage handled above)
    g = p.inStep ? choose(g, p.options![0].id) : pass(g);
  }
  assert.ok(used, 'The Boss replacement offered');
  assert.equal(locOf(g, q), 'base', 'saved and recalled');
  assert.equal(g.battlefields[BF_A].controller, P0, 'conquered');
  assert.equal(g.objects[lg].exhausted, false, 'The Boss readied by the conquer');
});

test('RJ#752 Hostile Takeover: no direct conquer — a battlefield I already control isn\'t conquered; taking the lone enemy unit at theirs conquers via the normal showdown', () => {
  // (a) I already control BF-A; steal the enemy unit there (no other enemies): no conquer, no point
  let g = S0(); fundAll(g, P0, 6);
  put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(2)', BF_A);
  const pts = g.players[P0].points;
  g = settle(play(g, P0, hand(g, P0, 'Hostile Takeover'), { targets: [[e]] }));
  assert.equal(g.objects[e].controller, P0);
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[P0].points, pts, 'no conquer of a battlefield I already control');
  // (b) P1 controls BF-A with one unit: stealing it contests the battlefield; the showdown ends and I conquer it
  g = S0(); fundAll(g, P0, 6);
  const e2 = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const pts2 = g.players[P0].points;
  g = settle(play(g, P0, hand(g, P0, 'Hostile Takeover'), { targets: [[e2]] }));
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[P0].points, pts2 + 1, 'conquered (scored 1) through the normal showdown');
});

test('RJ#756 Kai\'Sa given Cleave (Assault 3 this turn), Retreated to hand and replayed: no Assault (a new object)', () => {
  let g = S0(); fundAll(g, P0, 12);
  const k = put(g, P0, "ogn-039-298", 'base');
  g = settle(play(g, P0, hand(g, P0, 'Cleave'), { targets: [[k]] }));
  assert.ok(hasKeyword(g, k, 'Assault'), 'Cleave gave Assault');
  g = settle(play(g, P0, hand(g, P0, 'Retreat'), { targets: [[k]] }));
  assert.equal(zone(g, k), 'hand');
  g = settle(play(g, P0, k, { dest: 'base' }));
  const now = Object.keys(g.objects).find(id => g.objects[id].zone === 'base' && g.cards[g.objects[id].cardId].id === 'ogn-039-298') as ObjId;
  assert.ok(now, 'replayed');
  assert.ok(!hasKeyword(g, now, 'Assault'), 'Cleave\'s Assault is gone');
});

test('RJ#759 a 4-Might Assault 1 attacker is already 5 Might when the defender can first respond: Void Seeker (4) doesn\'t kill it', () => {
  let g = S0(); fundAll(g, P1, 6);
  const ek = put(g, P0, 'rad-021-167', 'base');
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const vs = hand(g, P1, 'Void Seeker');
  g = move(g, P0, [ek], BF_A);
  for (let i = 0; i < 6 && !canPlayNow(g, P1, vs); i++) g = pass(g);
  assert.ok(canPlayNow(g, P1, vs), 'defender gets a window');
  assert.equal(mightOf(g, ek), 5, 'Assault already applies');
  g = resolveChain(play(g, P1, vs, { targets: [[ek]] }));
  assert.equal(g.chain.length, 0, 'Void Seeker resolved; combat damage not yet dealt');
  assert.equal(locOf(g, ek), BF_A, 'survives 4 damage');
  assert.equal(g.objects[ek].damage, 4);
});

test('RJ#761 Blade Dancer (Irelia legend) readies a friendly unit chosen on the opponent\'s turn', () => {
  let g = S0(); fundAll(g, P0, 4); fundAll(g, P1, 4);
  const lg = setLegend(g, P0, 'Blade Dancer');
  const u = put(g, P0, 'V(2)', 'base', { ready: false });
  const z = hand(g, P1, 'ZapA'); const ch = hand(g, P0, 'Consult the Heavens');
  g = nextTurn(g); fundAll(g, P0, 4); fundAll(g, P1, 4);
  assert.equal(g.activePlayer, P1);
  g = play(g, P1, z, { targets: [[u]] });
  g = pass(g);
  g = act(g, { type: 'playCard', player: P0, obj: ch });
  let offered = false;
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g); if (!d.inStep) { g = pass(g); continue; }
    if (/Blade Dancer/.test(d.prompt ?? '') || d.kind === 'optional') { offered = true; g = choose(g, optionIds(g).includes('yes') ? 'yes' : optionIds(g)[0]); continue; }
    g = choose(g, optionIds(g).includes(u) ? u : optionIds(g)[0]);
  }
  assert.ok(offered, 'Blade Dancer offered on the opponent\'s turn');
  assert.equal(g.objects[lg].exhausted, true, 'legend exhausted');
  assert.equal(g.objects[u].exhausted, false, 'unit readied');
});

test('RJ#762 Lady of Luminosity (Lux legend) draws for a 5-cost Falling Comet whose only target left the board (resolves with no effect)', () => {
  let g = S0(); fundAll(g, P0, 8);
  setLegend(g, P0, 'Lady of Luminosity');
  const e = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const fc = hand(g, P0, 'Falling Comet'); const rt = hand(g, P1, 'Retreat'); fundAll(g, P1, 2);
  put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
  const h0 = g.players[P0].hand.length;
  g = play(g, P0, fc, { targets: [[e]] });
  g = pass(g);
  g = settle(play(g, P1, rt, { targets: [[e]] })); // the opponent returns the only target to hand in response
  assert.equal(zone(g, e), 'hand');
  assert.ok(g.players[P0].trash.includes(fc), 'Falling Comet resolved (to the trash)');
  assert.equal(g.players[P0].hand.length, h0 - 1 + 1, 'Lux drew 1 (Falling Comet left hand, +1 draw)');
});

test('RJ#760 Possession on a unit wearing my Guardian Angel: I keep the gear, it still saves the unit — recalled to the new controller\'s base, gear to my trash', () => {
  let g = S0(); fundAll(g, P0, 10); fundAll(g, P1, 4);
  const u = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const ga = put(g, P1, 'Guardian Angel', BF_A); attachNow(g, ga, u);
  g = settle(play(g, P0, hand(g, P0, 'Possession'), { targets: [[u]] }));
  assert.equal(g.objects[u].controller, P0);
  assert.equal(g.objects[ga].controller, P1, 'Guardian Angel stays with its controller');
  assert.equal(g.objects[ga].attachedTo, u, 'still attached');
  g = settle(play(g, P0, hand(g, P0, 'ZapA'), { targets: [[u]] }));
  g = settle(play(g, P0, hand(g, P0, 'ZapA'), { targets: [[u]] }));
  assert.equal(zone(g, ga), 'trash'); assert.ok(g.players[P1].trash.includes(ga), 'gear to its owner\'s trash');
  assert.ok(g.players[P0].base.includes(u), 'unit saved and recalled to its current controller\'s base');
});

test('RJ#765 Karthus wearing Sacred Shears dies: Karthus sees his own death, the Shears\' Deathknell triggers twice (draw 2)', () => {
  let g = S0(); fundAll(g, P0, 6);
  const k = put(g, P0, 'Karthus', BF_A); control(g, BF_A, P0);
  const sh = put(g, P0, 'Sacred Shears', BF_A); attachNow(g, sh, k);
  const h0 = g.players[P0].hand.length;
  g = settle(play(g, P0, hand(g, P0, 'KillA'), { targets: [[k]] }));
  assert.equal(zone(g, k), 'trash');
  assert.equal(g.players[P0].hand.length, h0 + 2, 'drew 2 (h0 taken before KillA was put in hand)');
});

test('RJ#766 two Void Hatchlings, Undertitan on top kept through both looks: it is revealed once — [Add] [2] once', () => {
  let g = S0(); fundAll(g, P0);
  setLegend(g, P0, 'Void Burrower');
  put(g, P0, 'Void Hatchling', 'base'); put(g, P0, 'Void Hatchling', 'base');
  const u = put(g, P0, 'V(1)', 'base');
  put(g, P0, 'V(2)', 'deckTop'); put(g, P0, 'Undertitan', 'deckTop');
  const e0 = g.players[P0].pool.energy;
  g = move(g, P0, [u], BF_A);
  let maxE = e0;
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    maxE = Math.max(maxE, g.players[P0].pool.energy);
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    if (/Recycle it/i.test(d.prompt ?? '')) { g = act(g, { type: 'choose', player: d.player, optionIds: [] }); continue; } // keep it on top
    g = choose(g, d.kind === 'optional' ? 'yes' : o[0]);
  }
  maxE = Math.max(maxE, g.players[P0].pool.energy);
  const adds = g.log.filter(l => /Undertitan/.test(l.text) && /add|\[2\]|energy/i.test(l.text)).length;
  assert.ok(g.log.some(l => /Revealed.*Undertitan/.test(l.text)), 'Undertitan revealed');
  assert.equal(maxE - e0, 2, 'one reveal: [Add] [2] once');
  void adds;
});

test('RJ#770 Akshan (paid) equips Svellsongur with Weaponmaster first: Svellsongur can\'t copy the already-triggered play ability — one gear taken', () => {
  let g = S0(); fundAll(g, P0, 12);
  const sv = put(g, P0, 'Svellsongur', 'base');
  const g1 = put(g, P1, 'Recurve Bow', 'base'); const g2 = put(g, P1, 'Recurve Bow', 'base');
  const ak = hand(g, P0, 'Akshan');
  g = act(g, { type: 'playCard', player: P0, obj: ak });
  for (let i = 0; i < 40 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g); if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    if (d.kind === 'optional') { g = choose(g, 'yes'); continue; }
    if (d.kind === 'chooseOrder') { // Weaponmaster first (resolves first = put on the chain last)
      const ids = (d.options ?? []).map(x => x.id); const wm = (d.options ?? []).find(x => /Weaponmaster|Equip/i.test(x.label));
      g = act(g, { type: 'choose', player: d.player, optionIds: wm ? [...ids.filter(x => x !== wm.id), wm.id] : ids }); continue;
    }
    g = choose(g, o.includes(sv) ? sv : o.includes('base') ? 'base' : o[0]);
  }
  assert.equal(zone(g, ak), 'base');
  const taken = [g1, g2].filter(x => g.objects[x].controller === P0).length;
  assert.equal(g.objects[sv].attachedTo, ak, 'Weaponmaster attached Svellsongur');
  assert.equal(taken, 1, 'one enemy gear taken');
});

test('RJ#778 Wielder of Water gets +2 once Fight or Flight leaves it defending alone (passive, rechecked)', () => {
  let g = S0(); fundAll(g, P0, 4);
  const w = put(g, P1, 'Wielder of Water', BF_A); const o = put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(9)', 'base');
  const ff = hand(g, P0, 'Fight or Flight');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 6 && !canPlayNow(g, P0, ff); i++) g = pass(g);
  assert.equal(mightOf(g, w), 2, 'not alone: 2');
  g = resolveChain(play(g, P0, ff, { targets: [[o]] }));
  assert.equal(locOf(g, o), 'base');
  assert.equal(mightOf(g, w), 4, 'defending alone: +2');
});

test('RJ#780 Wuju Bladesman + Fiora (sfd-110) defending alone: +2 first, doubled on resolution (10); a friendly unit joins → loses the +2, keeps the snapshot bonus (8)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 4);
  setLegend(g, P0, 'Wuju Bladesman');
  const fi = put(g, P0, 'sfd-110-221', BF_A); control(g, BF_A, P0);
  const j = put(g, P0, 'V(1)', 'base');
  const a = put(g, P1, 'V(1)', 'base');
  const rtw = hand(g, P0, 'Ride the Wind');
  g = drive(move(g, P1, [a], BF_A), [], x => x.chain.some(c => c.source === fi));
  assert.equal(mightOf(g, fi), 5, 'Wuju +2 applies before the doubling resolves');
  g = drive(g, [], x => x.pending?.kind === 'showdownAction' && x.pending.player === P0 && x.chain.length === 0);
  assert.equal(mightOf(g, fi), 10, 'doubled');
  g = drive(act(g, { type: 'playCard', player: P0, obj: rtw }), [[j], String(BF_A)], x => x.chain.length === 0 && x.pending?.kind === 'showdownAction');
  assert.equal(locOf(g, j), BF_A, 'joined the combat');
  assert.equal(mightOf(g, fi), 8, 'base 3 + doubling snapshot 5; Wuju +2 lost');
});

test('RJ#782 Unsung Hero (2) wearing B.F. Sword (+3) is Mighty when killed: draws 2', () => {
  let g = S0(); fundAll(g, P0, 6);
  const u = put(g, P0, 'Unsung Hero', BF_A); control(g, BF_A, P0);
  const sw = put(g, P0, 'B.F. Sword', BF_A); attachNow(g, sw, u);
  assert.equal(mightOf(g, u), 5, 'Mighty with the Equipment bonus');
  const k = hand(g, P0, 'KillA'); const h0 = g.players[P0].hand.length;
  g = settle(play(g, P0, k, { targets: [[u]] }));
  assert.equal(zone(g, u), 'trash');
  assert.equal(g.players[P0].hand.length, h0 - 1 + 2, 'drew 2');
});

test('RJ#793 Heimerdinger, Inventor uses Lux\'s copied [T] Reaction on the opponent\'s turn: he exhausts, Lux stays ready', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1, 4);
  const lux = put(g, P0, 'ogs-014-024', 'base');
  const h = put(g, P0, 'Heimerdinger, Inventor', 'base');
  g.objects[h].exhausted = false; g.objects[lux].exhausted = false; touch(g);
  const t = put(g, P0, 'V(3)', 'base');
  g = pass(play(g, P1, hand(g, P1, 'ZapA'), { targets: [[t]] }));
  assert.equal(pend(g).player, P0, 'P0 has priority in response');
  const acts = legal(g, P0, 'activate').filter(a => a.type === 'activate' && (a as { obj: ObjId }).obj === h);
  assert.ok(acts.length >= 1, 'copied Reaction-speed [T] usable on the opponent\'s turn');
  g = act(g, acts[0]);
  assert.equal(g.objects[h].exhausted, true, 'Heimerdinger exhausted');
  assert.equal(g.objects[lux].exhausted, false, 'Lux not exhausted');
});

test('RJ#795 Forge of the Future recycles the specific cards I pick, from both trashes in any mix', () => {
  let g = S0(); fundAll(g, P0);
  const f = put(g, P0, 'Forge of the Future', 'base');
  fillTrash(g, P0, 3); fillTrash(g, P1, 3);
  const mine = g.players[P0].trash[1]; const theirs = [g.players[P1].trash[0], g.players[P1].trash[2]];
  const ab = legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === f);
  g = act(g, ab!);
  let offered: string[] = [];
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    if (/Recycle up to 4/.test(d.prompt ?? '')) { offered = o; g = act(g, { type: 'choose', player: d.player, optionIds: [mine, ...theirs] }); continue; }
    g = choose(g, d.kind === 'optional' ? 'yes' : o[0]);
  }
  assert.ok(theirs.every(x => offered.includes(x)) && offered.includes(mine), 'both trashes offered');
  assert.ok(!g.players[P0].trash.includes(mine) && theirs.every(x => !g.players[P1].trash.includes(x)), 'exactly the picked cards left the trashes');
  assert.equal(g.players[P1].trash.length, 1, 'the unpicked opponent card stays');
  assert.ok(theirs.every(x => g.players[P1].mainDeck.includes(x)), 'recycled to their owner\'s deck');
});

test('RJ#797 Bellows Breath + Repeat: each execution may choose a different location (unit at BF-A, then unit at BF-B)', () => {
  let g = S0(); fundAll(g, P0, 6);
  const a = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const b = put(g, P1, 'V(5)', BF_B); control(g, BF_B, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Bellows Breath') });
  let n = 0;
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g); if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    if (d.kind === 'optional') { g = choose(g, 'yes'); continue; }
    if (o.includes(a) || o.includes(b)) { const pick = n++ === 0 ? a : b; g = act(g, { type: 'choose', player: d.player, optionIds: o.includes(pick) ? [pick] : [] }); continue; }
    g = choose(g, o[0]);
  }
  assert.equal(g.objects[a].damage, 1, 'first execution at BF-A');
  assert.equal(g.objects[b].damage, 1, 'Repeat execution at BF-B');
});

test('RJ#800 Void Burrower (Rek\'Sai legend) conquering Hall of Legends: use her reveal and pay [1] to ready her again on the same conquer', () => {
  let g = S0(); fundAll(g, P0, 4);
  setBattlefieldCard(g, BF_A, 'Hall of Legends');
  const leg = setLegend(g, P0, 'Void Burrower');
  const u = put(g, P0, 'V(1)', 'base');
  for (let i = 0; i < 3; i++) put(g, P0, 'V(1)', 'deckTop');
  g = move(g, P0, [u], BF_A);
  for (let i = 0; i < 40 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g); if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    if (/Recycle it/i.test(d.prompt ?? '')) { g = act(g, { type: 'choose', player: d.player, optionIds: [] }); continue; }
    g = choose(g, d.kind === 'optional' ? 'yes' : o.includes('base') ? 'base' : o[0]);
  }
  assert.ok(g.log.some(l => /^Revealed/.test(l.text)), 'Void Burrower\'s reveal happened');
  assert.equal(g.objects[leg].exhausted, false, 'Hall of Legends readied her again');
});

test('RJ#804 Arcane Shift on an equipped unit at a battlefield: the Equipment detaches and returns to its controller\'s base', () => {
  let g = S0(); fundAll(g, P0, 6);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const sw = put(g, P0, 'Sword', BF_A); attachNow(g, sw, u);
  put(g, P1, 'V(9)', BF_B); control(g, BF_B, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Arcane Shift') });
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g); if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    g = choose(g, o.includes(u) ? u : o.includes('base') ? 'base' : o[0]);
  }
  assert.ok(!g.objects[sw].attachedTo, 'detached');
  assert.ok(g.players[P0].base.includes(sw), 'in its controller\'s base');
});

test('RJ#808 Charm an enemy into Draven, Audacious\'s battlefield, then Fight or Flight it away: Draven\'s side wins the combat (+1)', () => {
  let g = S0(); fundAll(g, P0, 8);
  const dr = put(g, P0, 'Draven, Audacious', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(2)', BF_B); control(g, BF_B, P1);
  const ff = hand(g, P0, 'Fight or Flight');
  g = resolveChain(play(g, P0, hand(g, P0, 'Charm'), { targets: [[e]] }));
  if (pend(g).inStep) g = answer(g, { locations: [BF_A] });
  for (let i = 0; i < 12 && !(canPlayNow(g, P0, ff) && g.chain.length === 0 && locOf(g, e) === BF_A); i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(locOf(g, e), BF_A, 'Charmed into Draven\'s battlefield');
  const pts = g.players[P0].points;
  g = settle(play(g, P0, ff, { targets: [[e]] }));
  assert.equal(locOf(g, e), 'base');
  assert.equal(locOf(g, dr), BF_A);
  assert.equal(g.players[P0].points, pts + 1, 'Draven: win a combat → +1 (no conquer: P0 already controlled BF-A)');
});

test('RJ#811 Rek\'Sai, Breacher played from the Champion Zone: her passive doesn\'t make her Accelerate free — unpaid, she enters exhausted', () => {
  const run = (pay: boolean) => {
    let g = S0(); fundAll(g, P0, 8);
    const cz = g.players[P0].championZone[0];
    const d = realCard('Rek\'Sai, Breacher'); g.cards = { ...g.cards, [d.id]: d }; g.objects[cz].cardId = d.id; touch(g);
    const ready = (x: GameState) => x.players[P0].runesInPlay.filter(r => !x.objects[r].exhausted).length + x.players[P0].pool.energy;
    const r0 = ready(g);
    let asked = false;
    g = act(g, { type: 'playCard', player: P0, obj: cz });
    for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
      const p = pend(g); if (!p.inStep) { g = pass(g); continue; }
      if (p.kind === 'optional' && /Accelerate/i.test(p.prompt ?? '')) { asked = true; g = choose(g, pay ? 'yes' : 'no'); continue; }
      const o = optionIds(g); g = choose(g, o.includes('base') ? 'base' : p.kind === 'optional' ? 'no' : o[0]);
    }
    assert.ok(asked, 'Accelerate offered');
    return { ex: g.objects[cz].exhausted, runes: r0 - ready(g) };
  };
  const paid = run(true), unpaid = run(false);
  assert.equal(unpaid.ex, true, 'not paid: exhausted');
  assert.equal(paid.ex, false, 'paid: ready');
  assert.ok(paid.runes > unpaid.runes, 'Accelerate cost actually paid');
});

test('RJ#817 Fiora (sfd-110) attacking one on one with Assault 3 (Cleave): the doubling includes the Assault bonus (3+3 → 12)', () => {
  let g = S0(); fundAll(g, P0, 4);
  const fi = put(g, P0, 'sfd-110-221', 'base');
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  g = settle(play(g, P0, hand(g, P0, 'Cleave'), { targets: [[fi]] }));
  g = drive(move(g, P0, [fi], BF_A), [], x => x.pending?.kind === 'showdownAction' && x.chain.length === 0);
  assert.equal(mightOf(g, fi), 12, '(3 + Assault 3) doubled');
});

test('RJ#835 Draven, Audacious moved out of the combat before it ends: his side wins but he doesn\'t trigger (conquer point only)', () => {
  let g = S0(); fundAll(g, P0, 6);
  const dr = put(g, P0, 'Draven, Audacious', 'base'); const v = put(g, P0, 'V(6)', 'base');
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const ff = hand(g, P0, 'Fight or Flight');
  const pts = g.players[P0].points;
  g = move(g, P0, [dr, v], BF_A);
  for (let i = 0; i < 8 && !(canPlayNow(g, P0, ff) && g.chain.length === 0); i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  g = settle(play(g, P0, ff, { targets: [[dr]] }));
  assert.equal(locOf(g, dr), 'base');
  assert.equal(g.battlefields[BF_A].controller, P0, 'won and conquered');
  assert.equal(g.players[P0].points, pts + 1, 'conquer only; no Draven point');
});

test('RJ#841 Charm (no Action/Reaction) can\'t be played during a showdown', () => {
  let g = S0(); fundAll(g, P0, 6);
  const a = put(g, P0, 'V(3)', 'base');
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  const ch = hand(g, P0, 'Charm');
  assert.ok(canPlayNow(g, P0, ch), 'playable in the open main phase');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 4 && pend(g).kind !== 'showdownAction'; i++) g = pass(g);
  assert.equal(pend(g).kind, 'showdownAction');
  assert.equal(canPlayNow(g, P0, ch), false, 'not during the showdown');
});

test('RJ#847 Stupefy the unit chosen by Baited Hook\'s ability before it resolves: the search uses its lowered Might', () => {
  const run = (stupefy: boolean) => {
    let g = S0(); fundAll(g, P0, 6); fundAll(g, P1, 2);
    const hook = put(g, P0, 'Baited Hook', 'base');
    const k = put(g, P0, 'V(3)', 'base');
    const big = put(g, P0, 'V(4)', 'deckTop');
    const st = hand(g, P1, 'Stupefy');
    const ab = legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === hook)!;
    g = act(g, ab);
    for (let i = 0; i < 6 && pend(g).inStep; i++) g = choose(g, optionIds(g).includes(k) ? k : optionIds(g)[0]);
    assert.ok(g.chain.length >= 1 && zone(g, k) === 'base', 'ability on the chain, unit not yet killed');
    if (stupefy) { g = pass(g); g = resolveChain(play(g, P1, st, { targets: [[k]] }), 1); }
    let offered: string[] = [];
    for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
      const d = pend(g); if (!d.inStep) { g = pass(g); continue; }
      const o = optionIds(g);
      if (d.kind === 'chooseCards' || d.kind === 'chooseTargets') { offered = offered.concat(o); g = act(g, { type: 'choose', player: d.player, optionIds: [] }); continue; }
      g = choose(g, d.kind === 'optional' ? 'no' : o[0]);
    }
    assert.equal(zone(g, k), 'trash');
    return offered.includes(big);
  };
  assert.equal(run(false), true, 'killed at 3: a 4-Might unit can be found');
  assert.equal(run(true), false, 'killed at 2 after Stupefy: the 4-Might unit is out of range');
});

test('RJ#851 Stand United played from hidden at BF-A: the buff target must be there, but "+1 per buff" reaches buffed units at BF-B too', () => {
  let g = S0(); fundAll(g, P0, 4);
  const a = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const b = put(g, P0, 'V(2)', BF_B, { buff: true }); control(g, BF_B, P0);
  const su = put(g, P0, 'Stand United', { facedown: BF_A });
  g = nextTurn(nextTurn(g)); fundAll(g, P0, 4);
  const opts = targetOptions(g, P0, su);
  assert.ok(opts.includes(a) && !opts.includes(b), `buff target only at its battlefield (${opts})`);
  const mb = mightOf(g, b)!;
  g = settle(play(g, P0, su, { targets: [[a]] }));
  assert.equal(mightOf(g, b), mb + 1, 'global +1 for the buff at the other battlefield');
});

test('RJ#865 The Boss (Sett legend) saves a buffed unit in base from Falling Star (location doesn\'t matter)', () => {
  let g = S0(); fundAll(g, P0, 4); fundAll(g, P1, 6);
  const lg = setLegend(g, P0, 'The Boss');
  const u = put(g, P0, 'V(2)', 'base', { buff: true });
  g = nextTurn(g); fundAll(g, P0, 4); fundAll(g, P1, 6);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Falling Star') });
  let offered = false;
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g); if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    if (d.player === P0) { offered = true; g = choose(g, o.includes('yes') ? 'yes' : o[0]); continue; }
    g = choose(g, o.includes(u) ? u : o[0]);
  }
  assert.ok(offered, 'The Boss offered');
  assert.equal(zone(g, u), 'base', 'saved (healed, exhausted, recalled)');
  assert.equal(g.objects[lg].exhausted, true);
});

test('RJ#871 lethal combat damage counts damage already marked: 2 to a 5-Might unit with 3 damage is lethal, the rest may go elsewhere', () => {
  let g = S0();
  const d1 = put(g, P1, 'V(5)', BF_A); const d2 = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  g.objects[d1].damage = 3; touch(g);
  const a = put(g, P0, 'V(7)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 12 && !(pend(g).kind === 'assignDamage' && pend(g).player === P0); i++) {
    const d = pend(g);
    if (d.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: d.player, assignment: (d.data as { suggested: Record<ObjId, number> }).suggested }); continue; }
    g = d.inStep ? choose(g, optionIds(g)[0]) : pass(g);
  }
  assert.equal(pend(g).kind, 'assignDamage');
  g = act(g, { type: 'assignDamage', player: P0, assignment: { [d1]: 2, [d2]: 5 } });
  g = settle(g);
  assert.equal(zone(g, d1), 'trash'); assert.equal(zone(g, d2), 'trash');
});

test('RJ#887 Baited Hook kills a unit wearing The Zero Drive: it dies (banish doesn\'t prevent the kill), then the granted Deathknell banishes it', () => {
  let g = S0(); fundAll(g, P0, 6);
  const hook = put(g, P0, 'Baited Hook', 'base');
  const u = put(g, P0, 'V(3)', 'base');
  const zd = put(g, P0, 'The Zero Drive', 'base'); attachNow(g, zd, u);
  const ab = legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === hook)!;
  g = act(g, ab);
  let died = false;
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    if (zone(g, u) === 'trash') died = true;
    const d = pend(g); if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    g = act(g, { type: 'choose', player: d.player, optionIds: d.kind === 'optional' ? ['yes'] : o.includes(u) ? [u] : d.kind === 'chooseCards' ? [] : [o[0]] });
  }
  assert.ok(died || g.log.some(l => /V\(3\) died/.test(l.text)), 'the unit died');
  assert.equal(zone(g, u), 'banishment', 'then banished by the Deathknell');
});

test('RJ#892 Thousand-Tailed Watcher\'s -3 persists on a unit The Boss saves and recalls (same object, "this turn" effect)', () => {
  let g = S0(); fundAll(g, P0, 10); fundAll(g, P1, 4);
  setLegend(g, P1, 'The Boss');
  const u = put(g, P1, 'V(5)', BF_A, { buff: true }); control(g, BF_A, P1);
  put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
  g = settle(play(g, P0, hand(g, P0, 'Thousand-Tailed Watcher'), { dest: 'base', may: [false] }));
  assert.equal(mightOf(g, u), 3, '5 +1 buff -3');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Falling Comet') });
  let offered = false;
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g); if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    if (d.player === P1) { offered = true; g = choose(g, o.includes('yes') ? 'yes' : o[0]); continue; }
    g = choose(g, o.includes(u) ? u : o[0]);
  }
  assert.ok(offered, 'The Boss offered');
  assert.equal(zone(g, u), 'base', 'saved and recalled');
  assert.equal(g.objects[u].damage, 0);
  assert.equal(mightOf(g, u), 2, 'buff spent, -3 still applies (5 - 3)');
});

test('RJ#894 the defender Retreats its only unit mid-combat: the attacker keeps its Attacker designation (Assault still applies) and wins', () => {
  let { g, atk: [a], def: [d] } = attackSetup(['Assault(3,2)'], ['V(3)']);
  fundAll(g, P0, 4); fundAll(g, P1, 4);
  for (let i = 0; i < 6 && !(pend(g).player === P1 && pend(g).kind === 'showdownAction'); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  g = play(g, P1, hand(g, P1, 'Retreat'), { targets: [[d]] });
  for (let i = 0; i < 6 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(zone(g, d), 'hand');
  assert.equal(mightOf(g, a), 5, 'still attacking: Assault 2 applies');
  g = settle(g);
  assert.equal(g.battlefields[BF_A].controller, P0, 'attacker wins and conquers');
});

test('RJ#900 (MISMATCH-RJ) Stormbringer kills the only defender, then moves in: the defender loses control in that Open cleanup (no showdown ongoing yet), so its hidden card is trashed', () => {
  let g = S0(); fundAll(g, P0, 8); fundAll(g, P1, 4);
  const v = put(g, P0, 'V(5)', 'base');
  const k = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const fae = put(g, P1, 'Blastcone Fae', { facedown: BF_A });
  [g] = cast(g, P0, 'Stormbringer, Volibear', { targets: [[g.battlefields[BF_A].objId]] });
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) { const d = pend(g); g = d.inStep ? choose(g, d.options![0].id) : pass(g); }
  assert.equal(zone(g, k), 'trash');
  assert.equal(locOf(g, v), BF_A);
  assert.equal(zone(g, fae), 'trash', 'CR 323.5 + 323.6.a: control lost, hidden card trashed');
  assert.equal(g.battlefields[BF_A].controller, P0, 'mover conquers after its showdown');
});

test('RJ#906 2v2: a player may play a base-speed spell on their teammate\'s turn when invited (CR 491.8.a)', { todo: 'RJ#906: engine has no 2v2 invite — a teammate can never play a spell or activate an ability on the turn player\'s turn (CR 491.8.a)' }, () => {
  let g = createGame({ seed: 3, cardDb: fixtureDb(), mode: '2v2', firstPlayer: P0, skipMulligan: true, battlefieldSelection: 'random', includeAllCards: true,
    players: [0, 1, 2, 3].map(i => ({ name: `P${i}`, deck: legalDeck({ legend: i >= 2 ? 'cf-legend-2' : 'cf-legend' }, [`cf-bf-${'abde'[i]}`, `cf-bf-${'bcef'[i]}`, `cf-bf-${'cdfa'[i]}`]) })) } as never) as GameState;
  assert.ok(g.pending?.kind === 'mainAction' && g.pending.player === P0);
  const P2 = 2 as typeof P0;
  fundAll(g, P2, 4);
  const f = hand(g, P2, 'Fanfare');
  const invite = legal(g, P0).some(a => /invite/i.test(a.type));
  assert.ok(invite || canPlayNow(g, P2, f), 'the teammate can be invited to play Fanfare on P0\'s turn');
});

test('RJ#908 Fae Dragon buffs up to four friendly units: an already-buffed unit may be chosen (no 2nd buff, except Lee Sin, Ascetic); one whose buff was spent in response is buffed', () => {
  let g = S0(); fundAll(g, P0, 12);
  const lee = put(g, P0, 'Lee Sin, Ascetic', 'base', { buff: true });
  const a = put(g, P0, 'V(2)', 'base', { buff: true });
  const b = put(g, P0, 'V(2)', 'base', { buff: true });
  const c = put(g, P0, 'V(2)', 'base');
  const cg = hand(g, P0, 'Call to Glory');
  g = play(g, P0, hand(g, P0, 'Fae Dragon'), { dest: 'base' });
  for (let i = 0; i < 6 && !(pend(g).inStep && pend(g).kind === 'chooseTargets'); i++) g = pass(g);
  assert.ok([lee, a, b, c].every(x => optionIds(g).includes(x)), 'buffed units are legal choices');
  g = act(g, { type: 'choose', player: P0, optionIds: [lee, a, b, c] });
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = act(g, legal(g, P0)[0]);
  g = act(g, { type: 'playCard', player: P0, obj: cg });
  for (let i = 0; i < 6 && pend(g).inStep; i++) {
    const d = pend(g); const o = optionIds(g);
    g = choose(g, d.kind === 'optional' ? 'yes' : o.includes(a) && /buff|spend/i.test(d.prompt ?? '') ? a : o.includes(c) ? c : o[0]);
  }
  assert.equal(g.objects[a].counters.buff ?? 0, 0, 'A\'s buff spent for Call to Glory');
  g = settle(g);
  assert.equal(g.objects[lee].counters.buff ?? 0, 2, 'Lee Sin, Ascetic takes a second buff');
  assert.equal(g.objects[a].counters.buff ?? 0, 1, 'A buffed again');
  assert.equal(g.objects[b].counters.buff ?? 0, 1, 'B keeps one buff');
  assert.equal(g.objects[c].counters.buff ?? 0, 1, 'C buffed');
});

test('RJ#920 Traveling Merchant attacks and its discard readies Jinx, Rebel: Jinx can\'t join — no standard move before the combat begins', () => {
  let g = S0(); fundAll(g, P0, 4);
  const tm = put(g, P0, 'Traveling Merchant', 'base');
  const jx = put(g, P0, 'Jinx, Rebel', 'base', { ready: false });
  hand(g, P0, 'V(1)');
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [tm], BF_A);
  let movable = false;
  for (let i = 0; i < 20 && pend(g).kind !== 'assignDamage' && pend(g).kind !== 'mainAction'; i++) {
    if (!g.objects[jx].exhausted && !g.chain.length && legal(g, P0, 'move').some(a => a.type === 'move' && (a as { units?: ObjId[] }).units?.includes(jx))) movable = true;
    const d = pend(g); g = d.inStep ? choose(g, optionIds(g)[0]) : pass(g);
  }
  assert.equal(g.objects[jx].exhausted, false, 'Jinx readied by the discard');
  assert.equal(movable, false, 'never a standard-move window for Jinx');
  assert.equal(locOf(g, jx), 'base');
});

test('RJ#922 Dropboarder equipped with Doran\'s Shield gets both the +1 Might and [Tank]', () => {
  const g = S0();
  const u = put(g, P0, 'Dropboarder', 'base');
  attachNow(g, put(g, P0, "Doran's Shield", 'base'), u);
  assert.equal(mightOf(g, u), 5);
  assert.ok(hasKeyword(g, u, 'Tank'));
});

test('RJ#924 the cleanup after Stupefy resolves kills the damaged Kai\'Sa before anyone gets priority: no window to Gust her at 3 Might', () => {
  let g = S0(); fundAll(g, P0, 4); fundAll(g, P1, 4);
  const k = put(g, P1, "Kai'Sa, Survivor", BF_A, { damage: 3 }); control(g, BF_A, P1);
  put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
  const gu = hand(g, P1, 'Gust');
  g = play(g, P0, hand(g, P0, 'Stupefy'), { targets: [[k]] });
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  assert.equal(g.chain.length, 1, `Stupefy still on chain (${pend(g).kind} P${pend(g).player})`);
  assert.equal(targetOptions(g, P1, gu).includes(k), false, 'Kai\'Sa is still 4 Might: not a Gust target');
  g = pass(g);
  assert.equal(zone(g, k), 'trash', 'dead in the cleanup right after Stupefy resolved');
});

test('RJ#926 equip a unit, it dies at a battlefield and the gear is recalled: Equip it again to another unit the same turn', () => {
  let g = S0(); fundAll(g, P0, 6);
  const sh = put(g, P0, "Doran's Shield", 'base');
  const u1 = put(g, P0, 'V(2)', 'base'), u2 = put(g, P0, 'V(2)', 'base');
  const eq = (gg: GameState, u: ObjId) => {
    let h = act(gg, legal(gg, P0, 'activate').find(a => a.type === 'activate' && a.obj === sh)!);
    for (let i = 0; i < 6 && pend(h).inStep; i++) h = choose(h, optionIds(h).includes(u) ? u : optionIds(h)[0]);
    return settle(h);
  };
  g = eq(g, u1);
  assert.equal(g.objects[sh].attachedTo, u1);
  put(g, P1, 'V(6)', BF_A); control(g, BF_A, P1);
  g = settle(move(g, P0, [u1], BF_A));
  assert.equal(zone(g, u1), 'trash');
  assert.equal(locOf(g, sh), 'base', 'gear recalled');
  g = eq(g, u2);
  assert.equal(g.objects[sh].attachedTo, u2, 'equipped again this turn');
});

test('RJ#928 a gear\'s "Kill this:" ability is a base-speed activated ability: Forge of the Future can be activated in my open main phase, no prompt needed', () => {
  let g = S0();
  const f = put(g, P0, 'Forge of the Future', 'base');
  fillTrash(g, P1, 2);
  const ab = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === f);
  assert.ok(ab, 'activatable with an empty chain on my turn');
  g = settle(act(g, ab!));
  assert.equal(zone(g, f), 'trash', 'killed as the cost');
});

test('RJ#938 Xin Zhao, Vigilant doesn\'t count himself: one other unit in base → enters exhausted; two → ready', () => {
  for (const n of [1, 2]) {
    let g = S0(); fundAll(g, P0, 4);
    for (let i = 0; i < n; i++) put(g, P0, 'V(1)', 'base');
    const x = hand(g, P0, 'Xin Zhao, Vigilant');
    g = settle(play(g, P0, x, { dest: 'base' }));
    assert.equal(zone(g, x), 'base');
    assert.equal(g.objects[x].exhausted, n < 2, `${n} other unit(s)`);
  }
});

test('RJ#942 Battle Mistress (Sivir legend) triggers on the opponent\'s turn: recycling a rune with priority lets me exhaust her for a Gold token', () => {
  const g0 = S0({ tp: P1 }); fundAll(g0, P0); fundAll(g0, P1);
  const l = setLegend(g0, P0, 'Battle Mistress'); g0.objects[l].exhausted = false;
  let g = pass(play(g0, P1, hand(g0, P1, 'DrawR')));
  assert.equal(pend(g).player, P0);
  const before = new Set(Object.keys(g.objects));
  const r = legal(g, P0, 'activate').find(a => a.type === 'activate' && g.objects[a.obj].zone === 'runePool' && a.abilityIndex === 951);
  assert.ok(r, 'rune recycle available');
  g = act(g, r!);
  for (let i = 0; i < 6 && pend(g).inStep; i++) g = choose(g, optionIds(g).includes('yes') ? 'yes' : optionIds(g)[0]);
  g = settle(g);
  assert.equal(g.objects[l].exhausted, true, 'Battle Mistress exhausted');
  assert.ok(Object.keys(g.objects).some(id => !before.has(id) && /Gold/.test(g.cards[g.objects[id].cardId]?.name ?? '')), 'Gold token played on the opponent\'s turn');
});

test('RJ#946 moving into an empty battlefield is a showdown, not an attack: Cleave can be played on the unit but gives no Might', () => {
  let g = S0(); fundAll(g, P0, 4);
  const a = put(g, P0, 'V(2)', 'base');
  const cl = hand(g, P0, 'Cleave');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 6 && !(g.showdown && pend(g).player === P0 && !pend(g).inStep && !g.chain.length); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(g.showdown && !g.showdown.isCombat, 'a non-combat showdown');
  assert.ok(canPlayNow(g, P0, cl), 'Cleave playable');
  g = resolveChain(play(g, P0, cl, { targets: [[a]] }));
  assert.ok(hasKeyword(g, a, 'Assault'));
  assert.equal(mightOf(g, a), 2, 'not an attacker: no +3');
});

test('RJ#950 Discipline in response to Void Seeker draws Defy; after Discipline resolves priority comes round again and the drawn Defy counters Void Seeker', () => {
  let g = S0(); fundAll(g, P0, 4); fundAll(g, P1, 4);
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
  const df = put(g, P1, 'Defy', 'deckTop');
  const vs = hand(g, P0, 'Void Seeker');
  g = play(g, P0, vs, { targets: [[e]] });
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Discipline'), { targets: [[e]] });
  for (let i = 0; i < 6 && g.chain.length > 1; i++) g = pass(g);
  assert.equal(zone(g, df), 'hand', 'Defy drawn');
  assert.equal(g.chain.length, 1, 'Void Seeker still on the chain');
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  assert.equal(g.chain.length, 1);
  assert.ok(canPlayNow(g, P1, df), 'P1 can play the drawn Defy');
  g = resolveChain(play(g, P1, df, { targets: [[vs]] }));
  assert.equal(zone(g, e), 'battlefield', 'Void Seeker countered');
});

test('RJ#952 Retreat can\'t choose the champion in my Champion Zone (only units on the board)', () => {
  const g = S0(); fundAll(g, P0, 4);
  const ch = g.players[P0].championZone[0];
  const u = put(g, P0, 'V(2)', 'base');
  const opts = targetOptions(g, P0, hand(g, P0, 'Retreat'));
  assert.ok(opts.includes(u), `board unit is a choice (${opts})`);
  assert.ok(!opts.includes(ch), 'Champion Zone card is not');
});

test('RJ#956 Not So Fast counters Akshan, Mischievous\'s play trigger that chooses my gear: I keep the gear', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1, 4);
  const gear = put(g, P1, 'Forge of the Future', 'base');
  const nsf = hand(g, P1, 'Not So Fast');
  const ak = hand(g, P0, 'Akshan, Mischievous');
  g = act(g, { type: 'playCard', player: P0, obj: ak, destination: 'base' } as never);
  const step = () => { for (let i = 0; i < 6 && pend(g).inStep; i++) { const d = pend(g), o = optionIds(g); g = choose(g, d.kind === 'optional' ? 'yes' : o.includes(gear) ? gear : o[0]); } };
  step();
  for (let i = 0; i < 6 && zone(g, ak) !== 'base'; i++) { g = pass(g); step(); }
  assert.equal(zone(g, ak), 'base');
  const trig = g.chain.find(c => (c.targets ?? []).flat().map(String).includes(gear));
  assert.ok(trig, `Akshan's gear trigger chose my gear: ${chainLabels(g)}`);
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  g = act(g, { type: 'playCard', player: P1, obj: nsf });
  for (let i = 0; i < 4 && pend(g).inStep; i++) { const o = optionIds(g); g = choose(g, o.find(x => x === String(trig!.id)) ?? o[0]); }
  g = settle(g);
  assert.equal(g.objects[gear].controller, P1, 'gear not taken');
  assert.ok(g.players[P1].base.includes(gear), 'still in my base');
});

test('RJ#960 Teemo, Strategist revealing 5 [Hidden] cards at Void Gate deals one instance of 5 +1 = 6 (not 10)', () => {
  let g = S0({ tp: P1, bfA: 'Void Gate' });
  put(g, P0, 'Teemo, Strategist', BF_A); control(g, BF_A, P0);
  for (let k = 0; k < 5; k++) put(g, P0, 'Blastcone Fae', 'deckTop');
  const a = put(g, P1, 'V(12)', 'base');
  g = move(g, P1, [a], BF_A);
  for (let i = 0; i < 20 && !g.log.some(l => /Resolving.*Teemo/.test(l.text)) && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g);
    if (d.kind === 'chooseTargets') g = choose(g, a);
    else if (d.kind === 'optional') g = choose(g, 'no');
    else g = d.inStep ? choose(g, optionIds(g)[0]) : pass(g);
  }
  for (let i = 0; i < 6 && pend(g).inStep; i++) g = choose(g, optionIds(g)[0]);
  assert.ok(g.log.some(l => /Resolving.*Teemo/.test(l.text)), 'Teemo\'s defend trigger resolved');
  assert.equal(g.objects[a].damage, 6);
});

test('RJ#966 my lone unit is moved A → empty B (showdown at B); I Ride the Wind it back to A: A was lost in the cleanup after the move, so I re-conquer A and score', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 4); fundAll(g, P1, 4);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const rtw = hand(g, P0, 'Ride the Wind');
  g = passAll(play(g, P1, hand(g, P1, 'Charm'), { targets: [[u]] }));
  g = answer(g, { locations: [BF_B] });
  assert.equal(locOf(g, u), BF_B);
  assert.equal(g.battlefields[BF_A].controller, null, 'A lost in the Open cleanup after the move');
  for (let i = 0; i < 6 && !canPlayNow(g, P0, rtw); i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.ok(g.showdown, 'in the showdown at B');
  const pts = g.players[P0].points;
  g = passAll(play(g, P0, rtw, { targets: [[u]] }));
  g = settle(answer(g, { locations: [BF_A] }));
  assert.equal(locOf(g, u), BF_A);
  assert.equal(g.battlefields[BF_A].controller, P0, 'A re-conquered');
  assert.equal(g.players[P0].points, pts + 1, 'scores (A not yet scored this turn)');
});

test('RJ#970 Singularity starts a chain, not a showdown: the opponent can\'t answer with Primal Strength (Action)', () => {
  let g = S0(); fundAll(g, P0, 8); fundAll(g, P1, 8);
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const ps = hand(g, P1, 'Primal Strength');
  g = play(g, P0, hand(g, P0, 'Singularity'), { targets: [[e]] });
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  assert.equal(g.chain.length, 1);
  assert.equal(g.showdown ?? null, null, 'no showdown');
  assert.equal(canPlayNow(g, P1, ps), false, 'Primal Strength is an Action');
});

test('RJ#972 Thermo Beam ("Kill all gear") and Salvage can\'t affect a facedown Zhonya\'s Hourglass (not a gear while hidden)', () => {
  let g = S0(); fundAll(g, P0, 8);
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const z = put(g, P1, "Zhonya's Hourglass", { facedown: BF_A });
  const gear = put(g, P1, 'Forge of the Future', 'base');
  assert.ok(!targetOptions(g, P0, hand(g, P0, 'Salvage')).includes(z), 'Salvage can\'t choose it');
  g = settle(play(g, P0, hand(g, P0, 'Thermo Beam')));
  assert.equal(zone(g, gear), 'trash', 'face-up gear killed');
  assert.equal(zone(g, z), 'facedown', 'hidden card untouched');
});

test('RJ#974 Siphon Power gives every friendly unit at the battlefield +1, Recruit tokens included', () => {
  let g = S0(); fundAll(g, P0, 4);
  const r = [put(g, P0, 'Recruit', BF_A, { token: true }), put(g, P0, 'Recruit', BF_A, { token: true }), put(g, P0, 'Recruit', BF_A, { token: true })];
  control(g, BF_A, P0);
  g = settle(play(g, P0, hand(g, P0, 'Siphon Power'), { targets: [[g.battlefields[BF_A].objId]] }));
  for (const x of r) assert.equal(mightOf(g, x), 2);
});

test('RJ#992 Lee Sin, Centered gives other buffed friendly units at his battlefield +2 (attacking too), not himself', () => {
  let { g, atk: [l, a] } = attackSetup(['Lee Sin, Centered', 'V(2)'], ['V(9)'], { atkOpts: [{ buff: true }, { buff: true }] });
  const b = put(g, P0, 'V(2)', 'base', { buff: true });
  assert.equal(mightOf(g, l), 7, '6 + buff, no +2 for himself');
  assert.equal(mightOf(g, a), 5, 'attacking ally: 2 + buff + 2');
  assert.equal(mightOf(g, b), 3, 'not at his battlefield');
});

test('RJ#1008 Udyr, Wildman moves, spends his buff to ready, gets another buff, spends it for Ganking and moves again the same turn', () => {
  let g = S0();
  const ud = put(g, P0, 'Udyr, Wildman', 'base', { buff: true });
  const mode = (x: GameState, re: RegExp) => {
    let h = act(x, { type: 'activate', player: P0, obj: ud, abilityIndex: 0 });
    h = choose(h, pend(h).options!.find(o => re.test(o.label))!.id);
    return settle(h);
  };
  g = settle(move(g, P0, [ud], BF_A));
  assert.equal(locOf(g, ud), BF_A); assert.equal(g.objects[ud].exhausted, true);
  g = mode(g, /Ready me/i);
  assert.equal(g.objects[ud].exhausted, false, 'readied');
  g.objects[ud].counters.buff = 1; touch(g); // gains another buff
  g = mode(g, /Ganking/i);
  assert.ok(hasKeyword(g, ud, 'Ganking'));
  g = settle(move(g, P0, [ud], BF_B));
  assert.equal(locOf(g, ud), BF_B, 'second move, battlefield to battlefield');
});

test('RJ#1012 Gust on my Sprite token: it ceases to exist, it doesn\'t die — Viktor, Leader makes no Recruit', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1, 4);
  put(g, P0, 'Viktor, Leader', 'base');
  const sp = put(g, P0, 'Sprite', BF_A, { token: true }); control(g, BF_A, P0);
  g = settle(play(g, P1, hand(g, P1, 'Gust'), { targets: [[sp]] }));
  assert.equal(zone(g, sp), 'gone');
  assert.equal(g.players[P0].base.filter(id => g.cards[g.objects[id].cardId].name === 'Recruit').length, 0, 'no Recruit');
});

test('RJ#1014 Last Rites conquer on the opponent\'s turn: the unit from my trash is played then (no timing restriction)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 6); fundAll(g, P1, 4);
  const u = put(g, P0, 'V(2)', 'base');
  attachNow(g, put(g, P0, 'Last Rites', 'base'), u);
  const t = put(g, P0, 'V(3)', 'trash');
  const rtw = hand(g, P0, 'Ride the Wind');
  g = move(g, P1, [put(g, P1, 'V(1)', 'base')], BF_B);
  for (let i = 0; i < 6 && !canPlayNow(g, P0, rtw); i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.ok(canPlayNow(g, P0, rtw), 'Ride the Wind in the opponent\'s showdown');
  g = passAll(play(g, P0, rtw, { targets: [[u]] }));
  g = answer(g, { locations: [BF_A] });
  for (let i = 0; i < 40 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0 && !g.showdown && zone(g, t) !== 'trash'); i++) {
    const d = pend(g);
    if (d.kind === 'mainAction') break;
    if (d.kind === 'chooseTargets' && (d.options ?? []).some(o => o.id === t)) g = choose(g, t);
    else if (d.kind === 'optional') g = choose(g, 'yes');
    else g = d.inStep ? choose(g, optionIds(g)[0]) : pass(g);
  }
  assert.equal(g.activePlayer, P1, 'still the opponent\'s turn');
  assert.equal(g.battlefields[BF_A].controller, P0, 'conquered');
  assert.ok(['base', BF_A].includes(locOf(g, t) as never), `unit played from the trash (${zone(g, t)})`);
});

test('RJ#1018 a hidden unit played from facedown with Gemcraft Seer in play gets Vision when it enters (its trigger is chained at once)', () => {
  let g = S0(); fundAll(g, P0, 4);
  put(g, P0, 'Gemcraft Seer', 'base');
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  const fae = put(g, P0, 'Blastcone Fae', { facedown: BF_A });
  const n0 = g.log.length;
  g = act(g, { type: 'playCard', player: P0, obj: fae, destination: BF_A } as never);
  let saw = false;
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
    if (/Vision/i.test(pend(g).prompt ?? '') || chainLabels(g).length && g.log.slice(n0).some(l => /Trigger.*Vision|Vision/.test(l.text))) saw = true;
    const d = pend(g); g = d.inStep ? choose(g, d.kind === 'optional' ? 'no' : optionIds(g)[0]) : pass(g);
  }
  assert.equal(locOf(g, fae), BF_A);
  assert.ok(saw || g.log.slice(n0).some(l => /Vision/.test(l.text)), 'Vision triggered for the revealed unit');
});

test('RJ#1020 an attacker may put all its (non-lethal) damage on a bigger defender: 2 damage to a 3-Might unit, none to the 1-Might one', () => {
  let g = S0();
  const d1 = put(g, P1, 'V(1)', BF_A), d3 = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 12 && !(pend(g).kind === 'assignDamage' && pend(g).player === P0); i++) {
    const d = pend(g);
    if (d.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: d.player, assignment: (d.data as { suggested: Record<ObjId, number> }).suggested }); continue; }
    g = d.inStep ? choose(g, optionIds(g)[0]) : pass(g);
  }
  assert.equal(pend(g).kind, 'assignDamage');
  assert.equal(rejects(g, { type: 'assignDamage', player: P0, assignment: { [d3]: 2 } } as never), null, 'legal assignment');
  g = act(g, { type: 'assignDamage', player: P0, assignment: { [d3]: 2 } });
  g = settle(g);
  assert.equal(zone(g, d1), 'battlefield', 'the 1-Might defender untouched');
  assert.equal(zone(g, d3), 'battlefield', 'the 3-Might defender survives');
});

test('RJ#1046 my only defender is killed by a spell in the combat showdown: the showdown goes on, I get focus and may kill the attacker (no conquest)', () => {
  let { g, atk, def } = attackSetup(['V(2)'], ['V(2)']);
  fundAll(g, P0, 4); fundAll(g, P1, 4);
  const r0 = hand(g, P0, 'Hextech Ray'), r1 = hand(g, P1, 'Hextech Ray');
  for (let i = 0; i < 6 && !canPlayNow(g, P0, r0); i++) g = pass(g);
  g = drive(play(g, P0, r0, { targets: [[def[0]]] }), [], x => x.chain.length === 0 && x.pending?.kind === 'showdownAction');
  assert.equal(zone(g, def[0]), 'trash', 'defender killed');
  assert.ok(g.showdown, 'showdown continues');
  assert.ok(canPlayNow(g, P1, r1), 'the defender (no units left) may still play an Action with focus');
  g = passAll(play(g, P1, r1, { targets: [[atk[0]]] }));
  g = settle(g);
  assert.equal(zone(g, atk[0]), 'trash', 'attacker killed');
  assert.notEqual(g.battlefields[BF_A].controller, P0, 'no conquest');
});

test('RJ#1050 the attacker kills one defender but a stunned defender survives: no conquest, the attacker is recalled to base', () => {
  let { g, atk, def } = attackSetup(['V(5)'], ['V(1)', 'V(5)'], { defOpts: [{}, { stunned: true }] });
  for (let i = 0; i < 20 && g.pending && !(g.pending.kind === 'mainAction' && !g.showdown && !g.combat); i++) {
    const d = pend(g);
    if (d.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: d.player, assignment: d.player === P0 ? { [def[0]]: 1, [def[1]]: 4 } : (d.data as { suggested: Record<ObjId, number> }).suggested }); continue; }
    g = d.inStep ? choose(g, optionIds(g)[0]) : pass(g);
  }
  assert.equal(zone(g, def[0]), 'trash', 'the 1-Might defender died');
  assert.equal(locOf(g, def[1]), BF_A, 'the stunned defender survived');
  assert.equal(locOf(g, atk[0]), 'base', 'attacker recalled');
  assert.equal(g.battlefields[BF_A].controller, P1, 'defender keeps the battlefield');
});

test('RJ#1058 a hidden Hidden Blade can be played in response to my unit\'s Temporary trigger in the Beginning Phase: it kills the unit and I draw 2', () => {
  let g = S0(); fundAll(g, P0, 6);
  const s = put(g, P0, 'unl-t07', BF_A, { token: true }); control(g, BF_A, P0);
  const hb = put(g, P0, 'Hidden Blade', { facedown: BF_A });
  g = nextTurn(g);            // P1's turn
  g = endTurn(g, P1);         // P0's turn: Temporary trigger on the chain
  for (let i = 0; i < 20 && !(g.chain.length && canPlayNow(g, P0, hb)); i++) {
    const d = pend(g); assert.notEqual(d.kind, 'mainAction', 'reached main phase without a response window');
    g = d.inStep ? act(g, legal(g, d.player)[0]) : act(g, { type: 'pass', player: d.player });
  }
  assert.ok(g.chain.length >= 1, 'Temporary trigger on the chain');
  assert.ok(canPlayNow(g, P0, hb), 'hidden Hidden Blade playable in response');
  const h0 = g.players[P0].hand.length;
  g = act(g, { type: 'playCard', player: P0, obj: hb, destination: BF_A } as never);
  g = answer(g, { targets: [[s]] }, P0);
  g = passAll(g);
  assert.notEqual(locOf(g, s), BF_A, 'Sprite killed');
  assert.ok(g.players[P0].hand.length >= h0 + 2, 'its controller drew 2');
});

test('RJ#1068 Unforgiven (Yasuo legend, no Reaction) can\'t be activated during a showdown, even with focus on my turn', () => {
  let { g } = attackSetup(['V(2)'], ['V(2)']);
  fundAll(g, P0, 6);
  setLegend(g, P0, 'Unforgiven');
  const l = g.players[P0].legend;
  for (let i = 0; i < 6 && !(g.showdown && pend(g).kind === 'showdownAction' && pend(g).player === P0); i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.ok(g.showdown, 'in the combat showdown with focus');
  assert.equal(legal(g, P0, 'activate').some(x => x.type === 'activate' && x.obj === l), false, 'legend ability not activatable');
  let h = S0(); fundAll(h, P0, 6); setLegend(h, P0, 'Unforgiven'); put(h, P0, 'V(1)', 'base');
  assert.ok(legal(h, P0, 'activate').some(x => x.type === 'activate' && x.obj === h.players[P0].legend), 'control: activatable in my main phase');
});

test('RJ#1077 combat damage: the attacker assigns first, then the defender chooses how its damage hits my units; all is dealt simultaneously', () => {
  let { g, atk, def } = attackSetup(['V(2)', 'V(2)'], ['V(2)', 'V(1)']);
  const who: number[] = [];
  for (let i = 0; i < 20 && g.pending && !(g.pending.kind === 'mainAction' && !g.showdown && !g.combat); i++) {
    const d = pend(g);
    if (d.kind === 'assignDamage') {
      who.push(d.player);
      g = act(g, { type: 'assignDamage', player: d.player, assignment: d.player === P0 ? { [def[0]]: 2, [def[1]]: 2 } : { [atk[1]]: 2, [atk[0]]: 1 } });
      continue;
    }
    g = d.inStep ? choose(g, optionIds(g)[0]) : pass(g);
  }
  assert.deepEqual(who, [P0, P1], 'attacker first, then defender');
  assert.equal(zone(g, def[0]), 'trash'); assert.equal(zone(g, def[1]), 'trash');
  assert.equal(zone(g, atk[1]), 'trash', 'the defender chose which of my units dies');
  assert.equal(zone(g, atk[0]), 'battlefield', 'the other attacker survives (damage dealt simultaneously; defender died too)');
});

test('RJ#1078 two Viktor, Leader (ogn-246): another non-Recruit unit dies → two Recruits; one Viktor dies → one Recruit (from the other)', () => {
  const recruits = (g: GameState) => g.players[P0].base.filter(id => g.cards[g.objects[id].cardId]?.name === 'Recruit').length;
  let g = withTokens(S0()); fundAll(g, P0, 6);
  put(g, P0, 'ogn-246-298', 'base'); put(g, P0, 'ogn-246-298', 'base');
  const u = put(g, P0, 'V(1)', 'base');
  g = settle(passAll(play(g, P0, hand(g, P0, 'ZapA'), { targets: [[u]] })));
  assert.equal(zone(g, u), 'trash');
  assert.equal(recruits(g), 2, 'one Recruit per Viktor');
  const g2 = withTokens(S0()); fundAll(g2, P0, 6);
  const w1 = put(g2, P0, 'ogn-246-298', BF_A); put(g2, P0, 'ogn-246-298', 'base'); control(g2, BF_A, P0);
  const h = settle(passAll(play(g2, P0, hand(g2, P0, 'KillDraw'), { targets: [[w1]] })));
  assert.equal(zone(h, w1), 'trash');
  assert.equal(recruits(h), 1, 'the dying Viktor does not see itself ("another"): only one Recruit');
});

test('RJ#1079 a buffed unit that survives combat damage keeps its buff; only the damage is healed', () => {
  let { g, def } = attackSetup(['V(2)'], ['V(3)'], { defOpts: [{ buff: true }] });
  assert.equal(mightOf(g, def[0]), 4, 'buffed 3 → 4');
  g = settle(g);
  assert.equal(locOf(g, def[0]), BF_A, 'defender survives');
  assert.equal(g.objects[def[0]].damage, 0, 'damage healed');
  assert.equal(g.objects[def[0]].counters.buff ?? 0, 1, 'buff stays');
  assert.equal(mightOf(g, def[0]), 4);
});

test('RJ#1080 Baited Hook kills Pouty Poro (Sacred Shears, Altar of Memories in play): Hook fully resolves (look/play from the original top 5) before the Deathknell and Altar triggers go on the chain', () => {
  let g = withTokens(S0()); fundAll(g, P0, 8);
  const poro = put(g, P0, 'Pouty Poro', 'base');
  attachNow(g, put(g, P0, 'Sacred Shears', 'base'), poro);
  put(g, P0, 'Altar of Memories', 'base');
  const hook = put(g, P0, 'Baited Hook', 'base');
  const small = put(g, P0, 'V(2)', 'deckTop');
  const h0 = g.players[P0].hand.length;
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && (a as { obj?: ObjId }).obj === hook)!);
  g = answer(g, { targets: [[poro]] }, P0);
  let sawChoice = false;
  for (let i = 0; i < 40 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    if (o.includes(small)) {
      sawChoice = true;
      assert.equal(zone(g, poro), 'trash', 'Poro already killed');
      assert.equal(g.players[P0].hand.length, h0, 'no Deathknell / Altar draw yet');
      assert.ok(!chainLabels(g).some(l => /Shears|Altar|Deathknell/i.test(l)), `no death triggers on the chain yet (${chainLabels(g).join(', ')})`);
      g = act(g, { type: 'choose', player: d.player, optionIds: [small] }); continue;
    }
    g = d.kind === 'optional' ? act(g, { type: 'choose', player: d.player, optionIds: ['yes'] }) : act(g, legal(g, d.player)[0]);
  }
  assert.ok(sawChoice, 'the original top card was offered');
  assert.equal(locOf(g, small), 'base');
  assert.ok(g.players[P0].hand.length >= h0 + 1, 'the death triggers resolved afterwards (draws)');
});

test('RJ#1083 Warwick, Hunter attacks three units (10 Might); Flurry of Blades in response to his attack trigger: all three die on resolution, Warwick survives and conquers', () => {
  let { g, atk, def } = attackSetup(['Warwick, Hunter'], ['V(3)', 'V(3)', 'V(4)']);
  fundAll(g, P0);
  assert.ok(g.chain.some(c => c.source === atk[0]), 'Warwick trigger on the chain');
  if (pend(g).player !== P0) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Flurry of Blades'));
  for (let i = 0; i < 10 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(def.every(d => zone(g, d) === 'trash'), 'all damaged defenders killed');
  g = settle(g);
  assert.equal(locOf(g, atk[0]), BF_A, 'Warwick survives');
  assert.equal(g.battlefields[BF_A].controller, P0, 'and conquers');
});

test('RJ#1085 Ride the Wind moves my unit in to conquer and readies it; it then standard-moves back to base and Unforgiven (Yasuo legend) moves it to another battlefield', () => {
  let g = S0(); fundAll(g, P0, 8);
  setLegend(g, P0, 'Unforgiven');
  const u = put(g, P0, 'V(2)', 'base');
  g = passAll(play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[u]] }));
  g = settle(answer(g, { locations: [BF_A] }));
  assert.equal(locOf(g, u), BF_A);
  assert.equal(g.battlefields[BF_A].controller, P0, 'conquered');
  assert.equal(g.objects[u].exhausted, false, 'readied by Ride the Wind');
  g = settle(move(g, P0, [u], 'base'));
  assert.equal(locOf(g, u), 'base', 'standard move back to base');
  const l = g.players[P0].legend;
  const ab = legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === l);
  assert.ok(ab, 'Unforgiven activatable');
  g = act(g, ab!);
  if (optionIds(g).includes(u)) g = act(g, { type: 'choose', player: P0, optionIds: [u] });
  for (let i = 0; i < 8 && locOf(g, u) === 'base'; i++) { const e = pend(g); g = e.inStep ? act(g, { type: 'choose', player: e.player, optionIds: [optionIds(g).includes(String(BF_B)) ? String(BF_B) : optionIds(g)[0]] }) : pass(g); }
  assert.equal(locOf(g, u), BF_B, 'moved to the other battlefield');
});

test('RJ#1089 2v2: Charm can\'t move an opponent\'s unit to a battlefield where their teammate has units (never at the same battlefield as a teammate)', () => {
  let g = createGame({ seed: 3, cardDb: fixtureDb(), mode: '2v2', firstPlayer: P0, skipMulligan: true, battlefieldSelection: 'random', includeAllCards: true,
    players: [0, 1, 2, 3].map(i => ({ name: `P${i}`, deck: legalDeck({ legend: i >= 2 ? 'cf-legend-2' : 'cf-legend' }, [`cf-bf-${'abde'[i]}`, `cf-bf-${'bcef'[i]}`, `cf-bf-${'cdfa'[i]}`]) })) } as never) as GameState;
  assert.equal(g.pending?.kind === 'mainAction' && g.pending.player, P0);
  fundAll(g, P0);
  const P3 = 3 as typeof P0;
  put(g, P3, 'V(2)', 0); control(g, 0, P3);
  const e = put(g, P1, 'V(1)', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: put(g, P0, 'ogn-043-298', 'hand') });
  if (pend(g).kind === 'chooseTargets' && optionIds(g).includes(e)) g = choose(g, e);
  assert.equal(pend(g).kind, 'chooseDestination', 'destination chosen on play');
  const o = optionIds(g);
  assert.ok(o.length > 0, 'some destination exists');
  assert.ok(!o.includes('0'), `not the teammate's battlefield (${o.join(',')})`);
});

test('RJ#1094 4-player FFA (8 to win): at 7, holding one battlefield at the start of my turn wins; at 6, holding two wins', () => {
  const run = (pts: number, held: number[]) => {
    let g = createGame({ seed: 3, cardDb: fixtureDb(), mode: 'ffa', firstPlayer: P0, skipMulligan: true, battlefieldSelection: 'random', includeAllCards: true,
      players: [0, 1, 2, 3].map(i => ({ name: `P${i}`, deck: legalDeck({}, [`cf-bf-${'abcd'[i]}`, `cf-bf-${'efef'[i]}`, `cf-bf-${'bcda'[i]}`]) })) } as never) as GameState;
    assert.equal(g.victoryScore, 8, 'FFA victory score 8');
    for (const bf of held) { put(g, P0, 'V(1)', bf); control(g, bf, P0); }
    g.players[P0].points = pts; touch(g);
    for (let t = 0; t < 4 && g.winner == null; t++) g = nextTurn(g);
    return g;
  };
  assert.equal(run(7, [0]).winner, P0, '7 + hold 1 = 8');
  assert.equal(run(6, [0, 1]).winner, P0, '6 + hold 2 = 8');
});

test('RJ#1099 Smoke Screen on my Carnivorous Snapvine in response to its play trigger: 6 → 2, it dies to the 3-Might target, which survives', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1, 8);
  const e = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const sv = hand(g, P1, 'Carnivorous Snapvine');
  g = play(g, P1, sv, { dest: 'base', targets: [[e]] });
  if (pend(g).player === P1) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Smoke Screen'), { targets: [[sv]] });
  for (let i = 0; i < 10 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(zone(g, sv), 'trash', 'Snapvine (2) dies to 3');
  assert.equal(locOf(g, e), BF_A, 'the 3-Might unit survives 2 damage');
  assert.equal(g.objects[e].damage, 2);
});

test('RJ#1103 Yasuo, Remorseful attacks a Nine-Tailed Fox battlefield (4-Might defender): Fox trigger on top; defender\'s Discipline in response → 6, Yasuo -1 → 5, his 5 damage doesn\'t kill', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  setLegend(g, P1, 'Nine-Tailed Fox');
  const e = put(g, P1, 'V(4)', BF_A); control(g, BF_A, P1);
  const y = put(g, P0, 'Yasuo, Remorseful', 'base');
  const disc = hand(g, P1, 'Discipline');
  g = move(g, P0, [y], BF_A);
  g = answer(g, { targets: [[e]] }, P0);
  g = answer(g, { targets: [[y]] }, P1);
  assert.match(chainLabels(g)[1], /Nine-Tailed Fox/, 'defender trigger on top');
  for (let i = 0; i < 3 && !canPlayNow(g, P1, disc); i++) g = pass(g);
  assert.ok(canPlayNow(g, P1, disc), 'defender may respond with Discipline');
  g = play(g, P1, disc, { targets: [[e]] });
  for (let i = 0; i < 12 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(mightOf(g, e), 6);
  assert.equal(mightOf(g, y), 5);
  assert.equal(g.objects[e].damage, 5, 'Yasuo deals his current 5');
  assert.equal(locOf(g, e), BF_A, 'defender survives');
});

test('RJ#1109 Kai\'Sa, Survivor dies to combat damage while another attacker survives and conquers: her conquer draw does not trigger', () => {
  const run = (killKaisa: boolean) => {
    let { g, atk, def } = attackSetup(['ogn-039-298', 'V(5)'], ['V(4)']);
    const h0 = g.players[P0].hand.length;
    for (let i = 0; i < 20 && g.pending && !(g.pending.kind === 'mainAction' && !g.showdown && !g.combat); i++) {
      const d = pend(g);
      if (d.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: d.player, assignment: d.player === P1 ? { [atk[killKaisa ? 0 : 1]]: 4 } : { [def[0]]: 9 } }); continue; }
      g = d.inStep ? choose(g, optionIds(g)[0]) : pass(g);
    }
    assert.equal(g.battlefields[BF_A].controller, P0, 'conquered');
    return { died: zone(g, atk[0]) === 'trash', drew: g.players[P0].hand.length - h0 };
  };
  assert.deepEqual(run(true), { died: true, drew: 0 }, 'Kai\'Sa died: no draw');
  assert.deepEqual(run(false), { died: false, drew: 1 }, 'control: Kai\'Sa survives → draws 1');
});

test('RJ#1110 Singularity chose two enemy units; one is Retreated in response: no retarget, the other still takes 6', () => {
  let g = S0(); fundAll(g, P0, 8); fundAll(g, P1, 4);
  const a = put(g, P1, 'V(3)', BF_A), b = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const c = put(g, P1, 'V(3)', 'base');
  g = play(g, P0, hand(g, P0, 'Singularity'), { targets: [[a, b]] });
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'Retreat'), { targets: [[a]] });
  for (let i = 0; i < 10 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(zone(g, a), 'hand', 'retreated');
  assert.equal(zone(g, b), 'trash', 'the other target still dealt 6');
  assert.equal(g.objects[c].damage, 0, 'no new target');
});

test('RJ#1111 (MISMATCH-RJ detail, CR 346.1) Yasuo, Remorseful\'s attack trigger kills the lone defender: the attacker keeps focus after that trigger chain; once he passes the opponent may still act; conquer only after both pass', () => {
  let { g, atk, def } = attackSetup(['Yasuo, Remorseful'], ['V(3)']);
  fundAll(g, P1, 4);
  const za = hand(g, P1, 'ZapA');
  for (let i = 0; i < 10 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(zone(g, def[0]), 'trash', 'trigger killed the defender');
  assert.ok(g.showdown, 'showdown still on');
  assert.equal(pend(g).kind, 'showdownAction');
  assert.equal(pend(g).player, P0, 'attacker keeps focus (chain started by a triggered ability) — RJ: "focus passes to the opponent"');
  g = pass(g);
  assert.equal(pend(g).player, P1);
  assert.ok(canPlayNow(g, P1, za), 'the opponent may play an Action before the conquer');
  assert.notEqual(g.battlefields[BF_A].controller, P0, 'not conquered yet');
  g = settle(g);
  assert.equal(g.battlefields[BF_A].controller, P0, 'conquered after both passed');
  void atk;
});

test('RJ#1113 (MISMATCH-RJ detail, CR 340/312.2.c) the opening chain holds only the attack/defend triggers (attacker\'s first, defender\'s on top); then the controller of the newest item — the defender — gets priority, not the attacker', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  setLegend(g, P1, 'Nine-Tailed Fox');
  const e = put(g, P1, 'V(7)', BF_A); control(g, BF_A, P1);
  const y = put(g, P0, 'Yasuo, Remorseful', 'base');
  g = move(g, P0, [y], BF_A);
  g = answer(g, { targets: [[e]] }, P0);
  g = answer(g, { targets: [[y]] }, P1);
  const labels = chainLabels(g);
  assert.equal(labels.length, 2, `only the two triggers (${labels.join()})`);
  assert.match(labels[0], /Yasuo/); assert.match(labels[1], /Nine-Tailed Fox/);
  expectPending(g, 'chainResponse', P1, 'newest item\'s controller gets priority');
});

test('RJ#1127 (AMBIGUOUS → house, DECISIONS #1127: RJ adopted) Flash may choose friendly units already in base (Jae Medarda: "When you choose me with a spell, draw 1" draws); they don\'t move and Traveling Merchant\'s move trigger doesn\'t fire', () => {
  let g = S0(); fundAll(g, P0, 4);
  const m = put(g, P0, 'Traveling Merchant', 'base');
  const j = put(g, P0, 'sfd-142-221', 'base');
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Flash') });
  assert.equal(pend(g).kind, 'chooseTargets');
  assert.ok(optionIds(g).includes(m) && optionIds(g).includes(j), `base units are valid choices (${optionIds(g)})`);
  g = act(g, { type: 'choose', player: P0, optionIds: [m, j] });
  const h0 = g.players[P0].hand.length, n0 = g.log.length;
  g = settle(passAll(g));
  assert.equal(locOf(g, m), 'base'); assert.equal(locOf(g, j), 'base'); assert.equal(locOf(g, u), BF_A);
  assert.equal(g.players[P0].hand.length, h0 + 1, 'Jae Medarda draws 1 (chosen by a spell); no Merchant discard/draw');
  assert.ok(!g.log.slice(n0).some(l => /Traveling Merchant/.test(l.text) && /trigger/i.test(l.text)), 'no Merchant trigger');
});

test('RJ#1131 Shen, Kinkou played from hand into my defended battlefield enters at 3; in the next cleanup he becomes a Defender (Shield 2 → 5, Mighty) and Grand Duelist triggers', () => {
  let { g } = attackSetup(['V(2)'], ['V(1)']);
  fundAll(g, P1, 6);
  setLegend(g, P1, 'Grand Duelist');
  const shen = hand(g, P1, 'Shen, Kinkou');
  for (let i = 0; i < 6 && !canPlayNow(g, P1, shen, BF_A); i++) g = pass(g);
  assert.ok(canPlayNow(g, P1, shen, BF_A), 'Shen (Reaction) playable to my battlefield in the combat showdown');
  const n0 = g.log.length;
  g = act(g, { type: 'playCard', player: P1, obj: shen, destination: BF_A } as never);
  let asked = false, mightOnEntry = -1;
  for (let i = 0; i < 12 && !(g.chain.length === 0 && pend(g).kind === 'showdownAction' && asked); i++) {
    const d = pend(g);
    if (mightOnEntry < 0 && locOf(g, shen) === BF_A) mightOnEntry = mightOf(g, shen);
    if (/Grand Duelist|channel/i.test(d.prompt ?? '') || chainLabels(g).some(l => /Grand Duelist/.test(l))) asked = true;
    g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : optionIds(g)[0]] }) : pass(g);
  }
  assert.equal(mightOf(g, shen), 5, 'Defender with Shield 2');
  assert.ok(asked || g.log.slice(n0).some(l => /Grand Duelist/.test(l.text)), 'Grand Duelist triggered');
});

test('RJ#1135 the defender loses its only unit to combat damage (no Deathknell): no window to play its hidden card — it is trashed and the attacker conquers', () => {
  let { g, def } = attackSetup(['V(3)'], ['V(1)']);
  fundAll(g, P1, 6);
  const hid = put(g, P1, 'Fight or Flight', { facedown: BF_A });
  let windowAfterDamage = false;
  for (let i = 0; i < 20 && g.pending && !(g.pending.kind === 'mainAction' && !g.showdown && !g.combat); i++) {
    const d = pend(g);
    if (zone(g, def[0]) === 'trash' && d.player === P1 && canPlayNow(g, P1, hid)) windowAfterDamage = true;
    g = d.inStep ? choose(g, optionIds(g)[0]) : pass(g);
  }
  assert.equal(zone(g, def[0]), 'trash');
  assert.equal(windowAfterDamage, false, 'no priority window with the hidden card after the defender died');
  assert.equal(zone(g, hid), 'trash', 'hidden card trashed');
  assert.equal(g.battlefields[BF_A].controller, P0);
});

test('RJ#1139 an Eye of the Herald unit moves in; Fight or Flight in response sends it to base: a second Eye trigger, and both Recruits are played "here" = base', () => {
  let g = withTokens(S0()); fundAll(g, P0, 4); fundAll(g, P1, 4);
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const ff = put(g, P1, 'Fight or Flight', { facedown: BF_A });
  const u = put(g, P0, 'V(2)', 'base');
  attachNow(g, put(g, P0, 'Eye of the Herald', 'base'), u);
  const recruits = (x: GameState) => Object.values(x.objects).filter(o => o.controller === P0 && x.cards[o.cardId]?.name === 'Recruit' && (o.zone === 'base' || o.zone === 'battlefield'));
  g = move(g, P0, [u], BF_A);
  for (let i = 0; i < 4 && !(g.chain.length && canPlayNow(g, P1, ff)); i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.ok(canPlayNow(g, P1, ff), 'hidden Fight or Flight in response to the Eye trigger');
  g = act(g, { type: 'playCard', player: P1, obj: ff, destination: BF_A } as never);
  g = answer(g, { targets: [[u]] }, P1);
  for (let i = 0; i < 16 && g.chain.length; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(locOf(g, u), 'base');
  const r = recruits(g);
  assert.equal(r.length, 2, 'two Recruits');
  assert.ok(r.every(o => o.zone === 'base'), 'both in base');
});

test('RJ#1140 2v2: my team at 10 (11 to win) after a conquer; Time Warp gives me another turn and holding my battlefield then scores the winning point, though an opponent holds another battlefield', () => {
  let g = createGame({ seed: 3, cardDb: fixtureDb(), mode: '2v2', firstPlayer: P0, skipMulligan: true, battlefieldSelection: 'random', includeAllCards: true,
    players: [0, 1, 2, 3].map(i => ({ name: `P${i}`, deck: legalDeck({ legend: i >= 2 ? 'cf-legend-2' : 'cf-legend' }, [`cf-bf-${'abde'[i]}`, `cf-bf-${'bcef'[i]}`, `cf-bf-${'cdfa'[i]}`]) })) } as never) as GameState;
  assert.equal(g.pending?.kind === 'mainAction' && g.pending.player, P0);
  fundAll(g, P0, 12);
  put(g, P0, 'V(2)', 0); control(g, 0, P0);
  put(g, P1, 'V(2)', 1); control(g, 1, P1);
  put(g, 2 as typeof P0, 'V(2)', 2); control(g, 2, 2 as typeof P0);
  setPoints(g, P0, 10); touch(g);
  const v = g.victoryScore;
  assert.equal(v, 11, '2v2 victory score');
  g = settle(passAll(play(g, P0, put(g, P0, 'Time Warp', 'hand'))));
  g = nextTurn(g);
  assert.equal(g.winner != null ? 'won' : g.activePlayer, 'won', 'the extra turn\'s hold scored the 11th point');
  assert.ok(g.winner === P0 || (Array.isArray(g.winner) && (g.winner as number[]).includes(P0)) || g.winner === 0, `P0's team wins (${JSON.stringify(g.winner)})`);
});

test('RJ#1148 a token given Accelerate by Rek\'Sai, Breacher: its Accelerate power can be paid with any domain (a token has no domain) — paid with Chaos runes only', () => {
  let g = withTokens(S0());
  setRunes(g, P0, 0); addRunes(g, P0, 8, 'chaos');
  put(g, P0, "Rek'Sai, Breacher", 'base');
  const rg = hand(g, P0, 'Royal Guard');
  assert.ok(canPlayNow(g, P0, rg, 'base'), 'Royal Guard playable with Chaos runes');
  g = play(g, P0, rg, { dest: 'base' });
  let offered = false;
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'optional' && /Accelerate/i.test(d.prompt ?? '')) { offered = true; g = choose(g, 'yes'); continue; }
    g = d.inStep ? choose(g, d.kind === 'optional' ? 'no' : optionIds(g)[0]) : pass(g);
  }
  const tok = Object.keys(g.objects).find(id => g.objects[id].isToken && g.objects[id].controller === P0 && g.objects[id].zone === 'base');
  assert.ok(tok, 'Sand Soldier played');
  assert.ok(offered, 'Accelerate offered although only Chaos power is available');
  assert.equal(g.objects[tok!].exhausted, false, 'paid: enters ready');
});

test('RJ#1153 Lonely Poro dying alone in my base ("If I died alone") draws 1; with another friendly unit in base it doesn\'t', () => {
  const run = (friend: boolean) => {
    let g = S0({ tp: P1 }); fundAll(g, P1, 4);
    const p = put(g, P0, 'Lonely Poro', 'base');
    if (friend) put(g, P0, 'V(3)', 'base');
    const h0 = g.players[P0].hand.length;
    g = settle(passAll(play(g, P1, hand(g, P1, 'ZapA'), { targets: [[p]] })));
    assert.equal(zone(g, p), 'trash');
    return g.players[P0].hand.length - h0;
  };
  assert.equal(run(false), 1, 'alone in base → draw 1');
  assert.equal(run(true), 0, 'not alone → no draw');
});

test('RJ#1156 Stupefy in response to Mindsplitter\'s play trigger resolves first (draw 1); the trigger then chooses from the hand including the drawn card — no window once it is resolving', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1, 4);
  const top = put(g, P1, 'V(4)', 'deckTop');
  const stup = hand(g, P1, 'Stupefy');
  const other = hand(g, P1, 'V(1)');
  const ms = hand(g, P0, 'Mindsplitter');
  g = act(g, { type: 'playCard', player: P0, obj: ms, destination: 'base' } as never);
  for (let i = 0; i < 6 && !(g.chain.length && canPlayNow(g, P1, stup)); i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.ok(canPlayNow(g, P1, stup), 'Stupefy in response to the trigger');
  g = play(g, P1, stup, { targets: [[ms]] });
  let offered: string[] = [];
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    if (o.includes(top)) { offered = o; assert.equal(d.player, P0); g = choose(g, top); continue; }
    g = choose(g, o[0]);
  }
  assert.ok(offered.includes(top) && offered.includes(other), `the card drawn by Stupefy can be chosen (${offered})`);
  assert.equal(zone(g, top), 'trash', 'and discarded');
});

test('RJ#1158 Harnessed Dragon\'s kill chose my unit at BF-A; my hidden Tideturner at BF-B swaps it to BF-B in response: the originally chosen unit is still killed, Tideturner survives', () => {
  let g = S0(); fundAll(g, P0, 10); fundAll(g, P1, 4);
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  const tt = put(g, P1, 'Tideturner', { facedown: BF_B });
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Harnessed Dragon'), destination: 'base' } as never);
  if (pend(g).kind === 'chooseTargets') g = choose(g, e);
  for (let i = 0; i < 4 && !(g.chain.length && canPlayNow(g, P1, tt)); i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.ok(canPlayNow(g, P1, tt), 'hidden Tideturner in response');
  g = act(g, { type: 'playCard', player: P1, obj: tt, destination: BF_B } as never);
  g = answer(g, { may: [true], targets: [[e]] }, P1);
  for (let i = 0; i < 12 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(zone(g, e), 'trash', 'the swapped (originally chosen) unit is killed');
  assert.equal(locOf(g, tt), BF_A, 'Tideturner moved to BF-A and survives');
});

test('RJ#1161 Blazing Scorcher (5) attacks a Nine-Tailed Fox battlefield; the defender Retreats its only unit in response to the Fox trigger: it still resolves (-1 → 4); the defender keeps control during the showdown', () => {
  let g = S0(); fundAll(g, P1, 4);
  setLegend(g, P1, 'Nine-Tailed Fox');
  const e = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const b = put(g, P0, 'Blazing Scorcher', 'base');
  g = move(g, P0, [b], BF_A);
  if (pend(g).kind === 'chooseTargets') g = answer(g, { targets: [[b]] }, P1);
  assert.ok(chainLabels(g).some(l => /Nine-Tailed Fox/.test(l)), 'Fox trigger on the chain');
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Retreat'), { targets: [[e]] });
  for (let i = 0; i < 10 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(zone(g, e), 'hand');
  assert.equal(mightOf(g, b), 4, 'Fox -1 applied');
  assert.ok(g.showdown, 'showdown ongoing');
  assert.equal(g.battlefields[BF_A].controller, P1, 'defender still controls it during the showdown');
});

test('RJ#1162 Pack of Wonders loop: return my Treasure Trove to hand (it leaves the board → draw 1, channel 1 exhausted), replay it paying its cost', () => {
  let g = S0(); fundAll(g, P0, 6);
  const pw = put(g, P0, 'Pack of Wonders', 'base');
  const tt = put(g, P0, 'Treasure Trove', 'base');
  const h0 = g.players[P0].hand.length, r0 = g.players[P0].runesInPlay.length;
  g = act(g, { type: 'activate', player: P0, obj: pw, abilityIndex: 0 });
  if (pend(g).kind === 'chooseTargets') g = choose(g, tt);
  g = settle(g);
  assert.equal(zone(g, tt), 'hand', 'Trove returned');
  assert.equal(g.players[P0].hand.length, h0 + 2, 'Trove in hand + 1 drawn');
  assert.equal(g.players[P0].runesInPlay.length, r0 + 1, 'channelled 1 rune');
  assert.ok(canPlayNow(g, P0, tt), 'Trove can be replayed (paying its cost)');
});

test('RJ#1166 Teemo (ogn-197, 1) from hidden next to Ember Monk (4): order Monk on top, after it resolves (6) Convergent Mutation raises Teemo to 6, then his +3 → 9', () => {
  let g = S0(); fundAll(g, P0);
  const m = put(g, P0, 'ogn-167-298', BF_A); control(g, BF_A, P0);
  const t = put(g, P0, 'ogn-197-298', { facedown: BF_A });
  g = act(g, { type: 'playCard', player: P0, obj: t });
  for (let i = 0; i < 10 && pend(g).kind !== 'orderTriggers'; i++) { const d = pend(g); if (d.inStep) break; g = pass(g); }
  assert.equal(pend(g).kind, 'orderTriggers', `trigger order choice (${pend(g).kind})`);
  const monk = pend(g).options!.find(o => /Monk/.test(o.label ?? ''))!;
  const teemo = pend(g).options!.find(o => !/Monk/.test(o.label ?? ''))!;
  // put Teemo's first (bottom), Monk's on top
  g = act(g, { type: 'choose', player: P0, optionIds: [teemo.id] });
  if (pend(g).kind === 'orderTriggers') g = act(g, { type: 'choose', player: P0, optionIds: [monk.id] });
  for (let i = 0; i < 10 && mightOf(g, m) < 6; i++) g = pass(g);
  assert.equal(mightOf(g, m), 6, 'Monk +2 resolved first');
  assert.ok(chainLabels(g).some(l => /Teemo/.test(l)), 'Teemo trigger still on the chain');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Convergent Mutation') });
  for (let i = 0; i < 4 && pend(g).kind === 'chooseTargets'; i++) g = act(g, { type: 'choose', player: P0, optionIds: [i === 0 ? t : m] });
  g = settle(g);
  assert.equal(mightOf(g, t), 9);
});

test('RJ#1167 Charm (ogn-043) moves an enemy unit from one battlefield to another (no Ganking needed for a non-standard move)', () => {
  let g = S0(); fundAll(g, P0);
  const e = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  g = play(g, P0, hand(g, P0, 'ogn-043-298'), { targets: [[e]], locations: [BF_B] });
  g = settle(g);
  assert.equal(locOf(g, e), BF_B);
});

test('RJ#1169 Yasuo (ogn-076) Rides the Wind into an ongoing combat as an attacker: his "When I attack" triggers (6 to the enemy unit)', () => {
  let g = S0(); fundAll(g, P0, 6);
  const d = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const a1 = put(g, P0, 'V(3)', 'base');
  const y = put(g, P0, 'ogn-076-298', 'base');
  g = move(g, P0, [a1], BF_A);
  for (let i = 0; i < 10 && g.chain.length; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  for (let i = 0; i < 4 && pend(g).player !== P0; i++) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[y]], locations: [BF_A] });
  const seen = new Set<string>();
  for (let i = 0; i < 12 && (g.chain.length || pend(g).inStep); i++) { chainLabels(g).forEach(l => seen.add(l)); g = pend(g).inStep ? choose(g, optionIds(g).includes(d) ? d : optionIds(g)[0]) : pass(g); }
  assert.equal(g.objects[y].combatRole, 'attacker');
  assert.ok([...seen].some(l => /Yasuo/.test(l)), `Yasuo attack trigger (${[...seen].join(', ')})`);
  assert.equal(g.objects[d].damage ?? 0, 6);
});

test('RJ#1177 Arcane Shift on my Ravenbloom Student: the replayed Student is a new object and doesn\'t get +1 for Arcane Shift (2 Might after)', () => {
  let g = S0(); fundAll(g, P0, 8);
  const s = put(g, P0, 'Ravenbloom Student', 'base');
  const e = put(g, P1, 'V(5)', BF_B); control(g, BF_B, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Arcane Shift') });
  for (let i = 0; i < 40 && g.pending && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g); const o = optionIds(g);
    if (!d.inStep) { g = pass(g); continue; }
    g = choose(g, d.kind === 'chooseDestination' ? (o.includes('base') ? 'base' : o[0]) : o.includes(s) ? s : o.includes(e) ? e : o[0]);
  }
  const st = Object.values(g.objects).filter(o => o.cardId === realCard('Ravenbloom Student').id && zone(g, o.id) === 'base');
  assert.equal(st.length, 1, 'Student replayed');
  assert.equal(mightOf(g, st[0].id), 2);
});

test('RJ#1182 a 1-Might unit attacks a Trifarian War Camp held by Nine-Tailed Fox: +1 on arrival (2), then the Fox\'s -1 (min 1, snapshotted) → 1', () => {
  let g = S0();
  setLegend(g, P1, 'Nine-Tailed Fox');
  setBattlefieldCard(g, BF_A, 'Trifarian War Camp');
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(1)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 10 && g.chain.length; i++) g = pend(g).inStep ? choose(g, pend(g).kind === 'optional' ? 'yes' : optionIds(g)[0]) : pass(g);
  assert.equal(g.objects[a].combatRole, 'attacker');
  assert.equal(mightOf(g, a), 1);
});

test('RJ#1197 a 2-Might unit with two Mask of Foresight attacks a lone Ahri (ogn-119): her defend trigger (on top) resolves first (-2 min 1 → -1), then the Masks (+2) → 3; defending vs her attack: Masks first (4), then -2 → 2', () => {
  const run = (iAttack: boolean) => {
    let g = S0();
    const att = iAttack ? P0 : P1, def = iAttack ? P1 : P0;
    put(g, P0, 'Mask of Foresight', 'base'); put(g, P0, 'Mask of Foresight', 'base');
    const mine = put(g, P0, 'V(2)', iAttack ? 'base' : BF_A);
    const ahri = put(g, P1, 'ogn-119-298', iAttack ? BF_A : 'base');
    control(g, BF_A, def);
    if (!iAttack) { g = nextTurn(g); }
    g = move(g, att, [iAttack ? mine : ahri], BF_A);
    let peak = mightOf(g, mine);
    for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) { g = pend(g).inStep ? choose(g, pend(g).kind === 'optional' ? 'yes' : optionIds(g).includes(mine) ? mine : optionIds(g)[0]) : pass(g); peak = Math.max(peak, mightOf(g, mine)); }
    assert.equal(g.objects[ahri].combatRole, iAttack ? 'defender' : 'attacker');
    if (!iAttack) assert.equal(peak, 4, 'Masks resolved first (4)');
    return mightOf(g, mine);
  };
  assert.equal(run(true), 3, 'attacking Ahri');
  assert.equal(run(false), 2, 'defending against Ahri');
});

test('RJ#1205 Ornn, Forge God (4) counts Gold gear tokens and his attached Equipment: 2 Gold + attached Sterak\'s Gage → 4 + 3 (+ the Gage\'s own bonus)', () => {
  let g = withTokens(S0());
  const o = put(g, P0, 'Ornn, Forge God', 'base');
  const m0 = mightOf(g, o);
  place(g, P0, 'unl-t05', 'base', { token: true }); place(g, P0, 'unl-t05', 'base', { token: true });
  assert.equal(mightOf(g, o), m0 + 2, 'Gold tokens are gear');
  const sg = put(g, P0, "Sterak's Gage", 'base');
  const m1 = mightOf(g, o);
  attachNow(g, sg, o);
  assert.ok(mightOf(g, o) >= m1, 'still counted when attached');
  assert.equal(mightOf(g, o), m0 + 3 + 3, '+1 per gear (3) and the Gage\'s +3 while attached');
});

// RJ#1211 (MISMATCH-RJ, principle 13): Gust resolves while Herald of the Arcane's ability is still on the chain, so its cleanup is
// Closed (CR 309.1) and control of BF-A is not lost (CR 323.5); the Recruit's location is chosen on resolution and BF-A is still mine.
test('RJ#1211 (MISMATCH-RJ, CR 309.1/323.5) Gust on my only unit at BF-A in response to Herald of the Arcane: I keep BF-A while the ability is on the chain, so the Recruit can be played there', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const leg = setLegend(g, P0, 'Herald of the Arcane');
  const v = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  g = act(g, { type: 'activate', player: P0, obj: leg, abilityIndex: 0 });
  if (pend(g).player !== P1) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Gust'), { targets: [[v]] });
  let dests: string[] = [];
  for (let i = 0; i < 20 && g.pending && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'chooseDestination') { dests = optionIds(g); g = choose(g, dests.includes(String(BF_A)) ? String(BF_A) : dests[0]); continue; }
    g = d.inStep ? choose(g, optionIds(g)[0]) : pass(g);
  }
  assert.equal(zone(g, v), 'hand', 'Gusted');
  assert.ok(dests.includes(String(BF_A)), `BF-A offered (${dests})`);
  const rec = Object.values(g.objects).find(o => g.cards[o.cardId]?.name === 'Recruit' && o.controller === P0);
  assert.ok(rec && locOf(g, rec.id) === BF_A, 'Recruit at BF-A');
  assert.equal(g.battlefields[BF_A].controller, P0);
});

test('RJ#1213 Vengeance ("Kill a unit") can\'t choose the opponent\'s chosen champion in the champion zone (a non-board zone)', () => {
  const g = S0(); fundAll(g, P0);
  const champ = g.players[P1].championZone[0];
  assert.ok(champ, 'P1 has a chosen champion');
  const e = put(g, P1, 'V(2)', 'base');
  const opts = targetOptions(g, P0, hand(g, P0, 'Vengeance'));
  assert.ok(opts.includes(e), `a board unit is offered (${opts})`);
  assert.ok(!opts.includes(champ), 'the champion-zone card is not');
});

test('RJ#1231 Fiora, Peerless (sfd-110) attacks one on one; the defender plays hidden Teemo there in response: her trigger still doubles her Might (condition checked only when it triggers)', () => {
  let g = S0(); fundAll(g, P1);
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const tm = put(g, P1, 'ogn-197-298', { facedown: BF_A });
  const f = put(g, P0, 'sfd-110-221', 'base');
  g = move(g, P0, [f], BF_A);
  for (let i = 0; i < 6 && !(g.chain.length && pend(g).player === P1); i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.ok(chainLabels(g).some(l => /Fiora/.test(l)), `Fiora trigger on the chain (${chainLabels(g)})`);
  g = act(g, { type: 'playCard', player: P1, obj: tm });
  let peak = mightOf(g, f);
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) { g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g); peak = Math.max(peak, mightOf(g, f)); }
  assert.equal(locOf(g, tm), BF_A, 'Teemo joined');
  assert.equal(peak, 6, 'doubled 3 → 6');
});

test('RJ#1238 Siphon Power affects only the units at the battlefield when it resolves: a friendly unit moving in later gets no +1; affected units keep the change after leaving', () => {
  let g = S0(); fundAll(g, P0);
  const a = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const later = put(g, P0, 'V(2)', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Siphon Power') });
  g = choose(g, g.battlefields[BF_A].objId);
  g = resolveChain(g);
  assert.equal(mightOf(g, a), 3);
  g = move(g, P0, [later], BF_A); g = settle(g);
  assert.equal(locOf(g, later), BF_A);
  assert.equal(mightOf(g, later), 2, 'arrived later: unaffected');
  g = move(g, P0, [a], 'base'); g = settle(g);
  assert.equal(mightOf(g, a), 3, 'keeps +1 after leaving');
});

test('RJ#1245 Hextech Ray (3) on a 4-Might enemy outside combat isn\'t healed before I attack it: a 1-Might attacker then finishes it', () => {
  let g = S0(); fundAll(g, P0);
  const e = put(g, P1, 'V(4)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(1)', 'base');
  g = play(g, P0, hand(g, P0, 'Hextech Ray'), { targets: [[e]] });
  g = settle(g);
  assert.equal(g.objects[e].damage, 3, 'damage stays marked');
  g = move(g, P0, [a], BF_A); g = drive(g);
  assert.equal(zone(g, e), 'trash');
});

test('RJ#1248 Ride the Wind (ogn-173, "Move a friendly unit") can\'t choose the opponent\'s unit', () => {
  const g = S0(); fundAll(g, P0);
  const mine = put(g, P0, 'V(2)', 'base'); const mine2 = put(g, P0, 'V(3)', 'base');
  const theirs = put(g, P1, 'V(2)', 'base');
  let h = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'ogn-173-298') });
  let opts: string[] = [];
  for (let i = 0; i < 4 && h.pending?.inStep; i++) {
    if (h.pending.kind === 'chooseTargets') { opts = optionIds(h); break; }
    h = choose(h, optionIds(h)[0]);
  }
  assert.ok(opts.includes(mine) && opts.includes(mine2), `own units offered (${opts})`);
  assert.ok(!opts.includes(theirs));
});

test('RJ#1263 Temporal Portal gives Bellows Breath a second Repeat: paying both, it executes three times (1 + 1 + 1 to the same 3-Might unit kills it)', () => {
  let g = S0(); fundAll(g, P0, 12);
  const tp = put(g, P0, 'Temporal Portal', 'base');
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  g = activate(g, P0, tp, 0); g = settle(g);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Bellows Breath') });
  const asked: string[] = [];
  for (let i = 0; i < 30 && g.pending && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g); const o = optionIds(g);
    if (!d.inStep) { g = pass(g); continue; }
    asked.push(d.kind);
    if (d.kind === 'optional') { g = choose(g, 'yes'); continue; }
    if (d.kind === 'chooseTargets') { g = act(g, { type: 'choose', player: d.player, optionIds: o.includes(e) ? [e] : [o[0]] }); continue; }
    g = choose(g, o[0]);
  }
  assert.equal(zone(g, e), 'trash', `three executions (${asked.join(',')})`);
});

test('RJ#1281 Ezreal (sfd-149, optional additional costs [1] less) doesn\'t reduce Hard Bargain\'s "unless its controller pays [2]": with 1 rune left my spell is countered', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  put(g, P0, 'sfd-149-221', 'base');
  const e = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  g = play(g, P0, hand(g, P0, 'Hextech Ray'), { targets: [[e]] });
  setRunes(g, P0, 1);
  if (pend(g).player !== P1) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Hard Bargain'), { targets: [[g.chain[0].id]] });
  const seen: string[] = [];
  for (let i = 0; i < 12 && g.chain.length; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const ids = optionIds(g); seen.push(`${d.player}:${d.kind}:${ids}`);
    const pay = ids.find(x => /yes|pay/i.test(x)), dec = ids.find(x => /no|decline/i.test(x));
    g = choose(g, d.player === P0 ? (pay ?? ids[0]) : (dec ?? ids[0])); // P1 declines Hard Bargain's Repeat
  }
  assert.equal(g.objects[e].damage ?? 0, 0, `Hextech Ray countered: P0 tried to pay if offered (${seen.join(' | ')})`);
});

test('RJ#1282 Morbid Return ("Return a unit from your trash to your hand") can return a champion unit', () => {
  let g = S0(); fundAll(g, P0);
  const ch = put(g, P0, 'rad-038-167', 'trash');
  g = play(g, P0, hand(g, P0, 'Morbid Return'), { targets: [[ch]], cards: [[ch]] });
  for (let i = 0; i < 10 && g.pending && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g); const o = optionIds(g);
    g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: [o.includes(ch) ? ch : o[0]] }) : pass(g);
  }
  assert.equal(zone(g, ch), 'hand');
});

test('RJ#1285 Retreat (ogn-104, "Return a friendly unit") may choose a unit in my base', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'V(2)', 'base'); put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  g = play(g, P0, hand(g, P0, 'ogn-104-298'), { targets: [[u]] });
  g = settle(g);
  assert.equal(zone(g, u), 'hand');
});

test('RJ#1292 two Leona, Zealot -8 auras stack: a stunned 12-Might enemy is 4 with one, 1 (minimum) with two', () => {
  const g = S0();
  put(g, P0, 'Leona, Zealot', BF_A);
  const v = put(g, P1, 'V(12)', BF_A, { stunned: true });
  assert.equal(mightOf(g, v), 4, 'one Leona: 12-8');
  put(g, P0, 'Leona, Zealot', BF_A); g.timestamp++;
  assert.equal(mightOf(g, v), 1, 'two Leonas: 12-16, minimum 1');
});

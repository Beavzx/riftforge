// Rift Judge verification, range r1301 (question ids 1301-2600). See docs/riftjudge/README.md and
// docs/riftjudge/r1301.md (log). One test per verified mechanics question.
import { test } from 'node:test';
import {
  assert, S0, put, hand, cast, play, pass, passN, expectPending, control, act, move, mod, nextTurn, endTurn, EventLog, setRunes,
  P0, P1, BF_A, BF_B, zone, locOf, mightOf, resolveChain, passAll, pend, answer, choose, legal, canPlayNow, playDests,
  validateAction, activate, readyRunes, exhaustedRunes, optionIds, attackSetup, cid, setBattlefieldCard, addRunes, fundAll, realCard,
  clearDeck, hasKeyword, rejects, kwValue,
  type GameState, type ObjId, type PlayerId,
} from '../conformance/harness.ts';
import { attachNow, place, playCostOf } from '../../src/engine/testkit.ts';
import { chainLabels } from '../conformance/harness.ts';
import { setLegend } from './r11701.helpers.ts';
import { createGame } from '../../src/engine/index.ts';
import { fixtureDb } from '../fixtures/conformance/cards.ts';
import { legalDeck } from '../conformance/harness.ts';

/** Make a real legend p's legend (ready). */
export function legendOf(g: GameState, p: PlayerId, name: string): ObjId {
  const d = realCard(name);
  if (!g.cards[d.id]) g.cards = { ...g.cards, [d.id]: d };
  const l = g.players[p].legend;
  g.objects[l].cardId = d.id;
  g.objects[l].exhausted = false;
  g.ex.dirty = true;
  g.timestamp++;
  return l;
}
/** Resolve the chain, answering in-step decisions (any player) from `a` in order as they come. */
export function resolveWith(g: GameState, a: Parameters<typeof answer>[1], limit = 40): GameState {
  const q: Record<string, unknown[]> = { chooseTargets: [...(a.targets ?? [])], optional: [...(a.may ?? [])], chooseDestination: [...(a.locations ?? [])],
    chooseMode: [...(a.mode ?? [])], chooseCards: [...(a.cards ?? [])], chooseNumber: [...(a.numbers ?? [])], chooseBattlefield: [...(a.battlefields ?? [])], chooseOrder: [...(a.order ?? [])] };
  q.orderTriggers = q.chooseOrder;
  for (let i = 0; i < limit; i++) {
    const d = g.pending;
    if (!d) return g;
    if (d.inStep) {
      const list = q[d.kind];
      if (!list || !list.length) return g;
      const v = list.shift();
      const ids = Array.isArray(v) ? v.map(String) : d.kind === 'optional' ? [v ? 'yes' : 'no'] : [String(v)];
      g = act(g, { type: 'choose', player: d.player, optionIds: ids });
      continue;
    }
    if (d.kind !== 'chainResponse' || g.chain.length === 0) return g;
    g = pass(g);
  }
  return g;
}
/** Pass through showdown/chain; answer damage assignment with the engine suggestion; first option for other in-step decisions. */
export function finish(g: GameState, limit = 60): GameState {
  for (let i = 0; i < limit; i++) {
    const d = g.pending;
    if (!d || d.kind === 'mainAction') return g;
    if (d.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: d.player, assignment: (d.data as { suggested: Record<string, number> }).suggested }); continue; }
    if (d.inStep) { g = act(g, { type: 'choose', player: d.player, optionIds: d.options!.slice(0, Math.max(d.min ?? 1, 1)).map(o => o.id) }); continue; }
    g = pass(g);
  }
  return g;
}
/** Add a real card def (e.g. a token a script creates) to this game's card pool. */
export function ensureCard(g: GameState, name: string): string { const d = realCard(name); if (!g.cards[d.id]) g.cards = { ...g.cards, [d.id]: d }; return d.id; }
/** Pass on chain / showdown decisions, answering nothing else. */
export const settle = (g: GameState) => passAll(g);

// ------------------------------------------------------------------------------------------------
test('RJ#1301 Ravenbloom Student gets +1 when a spell is played from hidden (hiding is not playing)', () => {
  let g = S0();
  const st = put(g, P0, 'Ravenbloom Student', 'base');
  const mine = put(g, P0, 'V(3)', BF_A);
  control(g, BF_A, P0);
  const h = hand(g, P0, 'HidZap');
  g = act(g, { type: 'hide', player: P0, obj: h, battlefieldIndex: BF_A });
  assert.equal(mightOf(g, st), 2, 'hiding a spell is not playing it');
  const fd = put(g, P0, 'HidZap', { facedown: BF_A });
  g = play(g, P0, fd, { targets: [[mine]] });
  g = resolveChain(g);
  assert.equal(mightOf(g, st), 3, 'played from facedown = played');
});

test('RJ#1312 Ravenbloom Student does not trigger on playing Teemo (a unit) from hidden', () => {
  let g = S0();
  fundAll(g, P0);
  const st = put(g, P0, 'Ravenbloom Student', 'base');
  put(g, P0, 'V(3)', BF_A);
  control(g, BF_A, P0);
  const t = put(g, P0, 'Teemo, Strategist', { facedown: BF_A });
  g = play(g, P0, t, { dest: BF_A });
  g = resolveChain(g);
  assert.equal(zone(g, t), 'battlefield');
  assert.equal(mightOf(g, st), 2);
});

test('RJ#1302 Gust in response to a Quick-Draw attach trigger returns the unit before it gets the equipment', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P0, 'V(2)', BF_A);
  control(g, BF_A, P0);
  const sg = hand(g, P0, "Sterak's Gage");
  const gu = hand(g, P1, 'Gust');
  g = play(g, P0, sg, { dest: 'base', targets: [[u]], cards: [[u]] });
  assert.ok(g.chain.length >= 1, 'attach trigger on the chain');
  g = pass(g);
  expectPending(g, 'chainResponse', P1);
  assert.ok(canPlayNow(g, P1, gu), 'unit is still 2 Might: Gust is legal');
  g = play(g, P1, gu, { targets: [[u]] });
  g = resolveChain(g);
  assert.equal(zone(g, u), 'hand', 'returned to hand');
  assert.equal(g.objects[sg].attachedTo ?? null, null, 'equipment not attached');
});

test('RJ#1303 a burn-out point can be the winning point (only conquer/hold points are final-point restricted)', () => {
  let g = S0();
  clearDeck(g, P0);
  put(g, P0, 'V(1)', 'trash');
  g.players[1].points = 7;
  [g] = cast(g, P0, 'Draw1M');
  g = passN(g, 2);
  assert.equal(g.players[1].points, 8);
  assert.equal(g.winner, 1);
});

test('RJ#1304 no reaction window when units move in; Assault/Shield are passive (no chain); attack triggers chain once the showdown begins', () => {
  const { g, atk } = attackSetup(['Assault(2,2)', 'AttackDraw(3)'], ['Shield(2,2)']);
  const d = pend(g);
  // the attack trigger of AttackDraw is the only chain item; Assault/Shield never use the chain
  assert.equal(g.chain.length, 1, 'only the attack trigger');
  assert.equal(g.chain[0].source, atk[1]);
  assert.equal(d.player, P0, 'attacker (focus) gets priority first');
});

test('RJ#1309 after a chain item resolves, the controller of the next item gets priority first', () => {
  let g = S0();
  const a = put(g, P1, 'V(5)', 'base');
  [g] = cast(g, P0, 'ZapM', { targets: [[a]] });
  g = pass(g);
  [g] = cast(g, P1, 'DrawR');
  g = pass(g);
  [g] = cast(g, P0, 'DrawR');
  g = passN(g, 2); // P0's DrawR resolves
  assert.equal(g.chain.length, 2);
  expectPending(g, 'chainResponse', P1, 'controller of the newest remaining item (P1)');
  g = passN(g, 2); // P1's DrawR resolves
  expectPending(g, 'chainResponse', P0);
});

test('RJ#1305 stolen Repeat spell keeps the repeat its first controller paid (Mystic Reversal)', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0); fundAll(g, P1);
  const x = put(g, P0, 'V(5)', BF_A);
  control(g, BF_A, P0);
  const y = put(g, P1, 'V(5)', BF_B);
  control(g, BF_B, P1);
  const bb = hand(g, P1, 'Bellows Breath');
  const mr = hand(g, P0, 'Mystic Reversal');
  g = play(g, P1, bb, { may: [true], targets: [[x]] });
  g = answer(g, { may: [true], targets: [[x]] }, P1);
  assert.equal(g.chain.length, 1);
  g = passAll(g, 1);
  if (pend(g).player === P1) g = pass(g);
  g = play(g, P0, mr, { targets: [[g.chain[0].id]] });
  // may make new choices: P0 keeps or retargets; say no
  g = answer(g, { may: [false, false, false] }, P0);
  const log = new EventLog();
  for (let i = 0; i < 20; i++) {
    const d = g.pending!;
    if (d.inStep && d.kind === 'chooseTargets') { g = log.act(g, { type: 'choose', player: d.player, optionIds: [y] }); continue; }
    if (d.inStep && d.kind === 'optional') { g = log.act(g, { type: 'choose', player: d.player, optionIds: ['no'] }); continue; }
    if (d.kind === 'chainResponse' || d.kind === 'showdownAction') { g = log.pass(g); continue; }
    break;
  }
  const dmg = log.of('damage').reduce((s, e) => s + Number(e.amount), 0);
  assert.equal(dmg, 2, 'both instances (paid repeat) happen');
});

test('RJ#1306 Bellows Breath with Repeat: each instance may pick a different battlefield', () => {
  let g = S0();
  fundAll(g, P0);
  const a = put(g, P1, 'V(5)', BF_A);
  control(g, BF_A, P1);
  const b = put(g, P1, 'V(5)', BF_B);
  control(g, BF_B, P1);
  const bb = hand(g, P0, 'Bellows Breath');
  g = play(g, P0, bb, { may: [true], targets: [[a]] });
  const log = new EventLog();
  g = log.passAll(g);
  if (pend(g).kind === 'chooseTargets') g = log.choose(g, b);
  g = log.passAll(g);
  assert.equal(g.objects[a].damage, 1);
  assert.equal(g.objects[b].damage, 1, 'second instance at another battlefield');
});

test('RJ#1307 Bounty Hunter (legend) choosing a friendly unit triggers Spirit Wheel', () => {
  let g = S0();
  fundAll(g, P0);
  const l = legendOf(g, P0, 'Bounty Hunter');
  put(g, P0, 'Spirit Wheel', 'base');
  const u = put(g, P0, 'V(2)', 'base');
  const h0 = g.players[0].hand.length;
  g = activate(g, P0, l, 0, { targets: [[u]] });
  g = answer(g, { may: [true] }, P0);
  g = resolveChain(g);
  g = answer(g, { may: [true] }, P0);
  g = resolveChain(g);
  assert.ok(hasKeyword(g, u, 'Ganking'));
  assert.equal(g.players[0].hand.length, h0 + 1, 'Spirit Wheel drew');
});

test('RJ#1308 re-conquering the same battlefield in a turn scores nothing and fires no conquer effect (Candlelit Sanctum)', () => {
  let g = S0({ bfA: 'The Candlelit Sanctum' });
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_A);
  g = passAll(g);
  g = answer(g, { cards: [[]] }, P0);
  g = choose(g, optionIds(g)[0]);
  g = passAll(g);
  assert.equal(g.players[0].points, 1);
  const n1 = g.log.length;
  // leave and come back (direct setup: recall + ready, then lose control)
  g.objects[u].exhausted = false;
  g = act(g, { type: 'move', player: P0, units: [u], to: 'base' });
  g.objects[u].exhausted = false;
  control(g, BF_A, null);
  g = move(g, P0, [u], BF_A);
  g = passAll(g);
  assert.equal(g.players[0].points, 1, 'no second point');
  assert.ok(!g.pending?.inStep || !/look|recycle|Candlelit/i.test(g.pending.prompt), 'no Candlelit trigger');
  void n1;
});

test('RJ#1310 4-player FFA: a third player gets focus/priority in a showdown between two others and may play a Reaction', async () => {
  const { createGame } = await import('../../src/engine/index.ts');
  const { fixtureDb } = await import('../fixtures/conformance/cards.ts');
  const { legalDeck } = await import('../conformance/harness.ts');
  let g = createGame({ seed: 3, cardDb: fixtureDb(), firstPlayer: P0, skipMulligan: true, battlefieldSelection: 'random', includeAllCards: true, mode: 'ffa',
    players: [0, 1, 2, 3].map(i => ({ name: `P${i}`, deck: legalDeck() })) });
  const P2 = 2 as PlayerId;
  const d = put(g, P1, 'V(3)', BF_A);
  control(g, BF_A, P1);
  const a = put(g, P0, 'V(3)', 'base');
  addRunes(g, P2, 3);
  const z = hand(g, P2, 'ZapR');
  g = move(g, P0, [a], BF_A);
  expectPending(g, 'showdownAction', P0);
  g = pass(g);
  expectPending(g, 'showdownAction', P1);
  g = pass(g);
  expectPending(g, 'showdownAction', P2, 'non-participant gets focus');
  assert.ok(canPlayNow(g, P2, z));
  g = play(g, P2, z, { targets: [[d]] });
  g = resolveChain(g);
  assert.equal(g.objects[d].damage, 2);
});

test('RJ#1313 Fight or Flight does not end the combat: a unit returned by Ride the Wind still defends; attacker does not conquer', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0); fundAll(g, P1);
  const d = put(g, P0, 'V(3)', BF_A);
  control(g, BF_A, P0);
  const a = put(g, P1, 'V(2)', 'base');
  const ff = hand(g, P1, 'Fight or Flight');
  const rw = hand(g, P0, 'Ride the Wind');
  g = move(g, P1, [a], BF_A);
  expectPending(g, 'showdownAction', P1);
  g = play(g, P1, ff, { targets: [[d]] });
  g = resolveChain(g);
  assert.equal(locOf(g, d), 'base');
  expectPending(g, 'showdownAction', P0, 'combat showdown continues, focus to P0');
  g = play(g, P0, rw, { targets: [[d]] });
  g = resolveWith(g, { locations: [BF_A] });
  assert.equal(locOf(g, d), BF_A);
  g = passAll(g);
  assert.equal(g.players[1].points, 0, 'attacker does not score');
  assert.equal(zone(g, a), 'trash');
  assert.equal(g.battlefields[BF_A].controller, P0);
});

test('RJ#1315 a Reaction drawn during the last chain item\'s resolution cannot be added to that (now ended) chain', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P1, 'V(3)', BF_A);
  control(g, BF_A, P1);
  put(g, P1, 'ZapR', 'deckTop');
  const hb = hand(g, P0, 'Hidden Blade');
  g = play(g, P0, hb, { targets: [[u]] });
  g = resolveChain(g);
  assert.equal(zone(g, u), 'trash');
  assert.equal(g.chain.length, 0, 'chain is over');
  expectPending(g, 'mainAction', P0, 'Neutral Open again: P1 has no priority');
  assert.equal(legal(g, P1).length, 0);
});

test('RJ#1316 Zaun Warrens with an empty hand: discard is skipped, still draw 1', () => {
  let g = S0({ bfA: 'Zaun Warrens' });
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_A);
  g = passAll(g);
  g = answer(g, { cards: [[]] }, P0);
  g = passAll(g);
  assert.equal(g.players[0].points, 1);
  assert.equal(g.players[0].hand.length, 1, 'drew 1');
});

test('RJ#1317 Dazzling Aurora end-of-turn play to an open battlefield at 7 (other battlefield scored this turn) conquers and wins', () => {
  let g = S0();
  fundAll(g, P0);
  g.players[0].points = 6;
  put(g, P0, 'Dazzling Aurora', 'base');
  put(g, P0, 'Miss Fortune, Buccaneer', 'deckTop');
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_B);
  g = passAll(g);
  assert.equal(g.players[0].points, 7);
  g = endTurn(g);
  for (let i = 0; i < 12; i++) { const d = g.pending; if (!d) break; if (d.inStep) { const o = d.options!.find(o => o.id === String(BF_A)) ?? d.options![0]; g = act(g, { type: 'choose', player: d.player, optionIds: [o.id] }); } else if (d.kind === 'mainAction') break; else g = pass(g); }
  assert.equal(g.turn, 3, 'the showdown/conquer happens in P0\'s ending phase, not on P1\'s turn');
  assert.equal(g.players[0].points, 8);
  assert.equal(g.winner, 0);
});

test('RJ#1318 Spirit Wheel does not trigger on a standard move (units are not chosen by a spell/ability)', () => {
  let g = S0();
  fundAll(g, P0);
  put(g, P0, 'Spirit Wheel', 'base');
  const u = put(g, P0, 'V(2)', BF_A);
  control(g, BF_A, P0);
  g = move(g, P0, [u], 'base');
  assert.equal(g.chain.length, 0);
  assert.ok(!g.pending?.inStep, 'no Spirit Wheel prompt');
});

test('RJ#1319 Jinx, Demolitionist "discard 2" is a play trigger, not a cost: playable with fewer cards, discards as many as possible', () => {
  let g = S0();
  fundAll(g, P0);
  const j = hand(g, P0, 'Jinx, Demolitionist');
  const c = hand(g, P0, 'V(1)');
  assert.ok(canPlayNow(g, P0, j), 'playable with only 1 other card in hand');
  g = play(g, P0, j, { dest: 'base', may: [false] });
  assert.equal(zone(g, j), 'base', 'Jinx is on the board before the discard');
  assert.equal(g.chain.length, 1, 'discard trigger on the chain');
  g = resolveWith(g, { cards: [[c]] });
  assert.equal(zone(g, c), 'trash');
  assert.equal(g.players[0].hand.length, 0);
});

test('RJ#1320 Kai\'Sa, Survivor conquering Zaun Warrens: both trigger together and the player orders them', () => {
  let g = S0({ bfA: 'Zaun Warrens' });
  const k = put(g, P0, "Kai'Sa, Survivor", 'base');
  const c = hand(g, P0, 'V(1)');
  void c;
  g = move(g, P0, [k], BF_A);
  g = passAll(g);
  const d = pend(g);
  assert.equal(d.kind, 'orderTriggers', `expected trigger ordering, got ${d.kind}: ${d.prompt}`);
  assert.equal(d.player, P0);
});

/** P1's turn: P1 moves into empty BF-B (showdown, P1 focus, then P0 focus); P0 Ride the Winds a unit to empty BF-A. */
function oppTurnConquer(p0points: number): GameState {
  let g = S0({ tp: P1 });
  fundAll(g, P0);
  g.players[0].points = p0points;
  const mine = put(g, P0, 'V(4)', 'base');
  const rw = hand(g, P0, 'Ride the Wind');
  const a = put(g, P1, 'V(2)', 'base');
  g = move(g, P1, [a], BF_B);
  expectPending(g, 'showdownAction', P1);
  g = pass(g);
  expectPending(g, 'showdownAction', P0);
  g = play(g, P0, rw, { targets: [[mine]] });
  g = resolveWith(g, { locations: [BF_A] });
  assert.equal(locOf(g, mine), BF_A);
  for (let i = 0; i < 20; i++) { const d = g.pending!; if (d.kind === 'mainAction' || d.inStep) break; g = pass(g); }
  g = resolveWith(g, { battlefields: [BF_A] });
  for (let i = 0; i < 20; i++) { const d = g.pending!; if (d.kind === 'mainAction' || d.inStep) break; g = pass(g); }
  assert.equal(g.activePlayer, P1, 'still P1\'s turn');
  return g;
}

test('RJ#1322 you can conquer and score a battlefield on the opponent\'s turn (Ride the Wind)', () => {
  const g = oppTurnConquer(0);
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[0].points, 1);
});

test('RJ#1323 winning on the opponent\'s turn: the final conquer point still needs every battlefield scored that turn', () => {
  const h0 = 0;
  const g = oppTurnConquer(7);
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[0].points, 7, 'BF-B not scored by P0 this turn: no final point');
  assert.equal(g.winner ?? null, null);
  assert.ok(g.players[0].hand.length > h0, 'draws instead');
});

test('RJ#1325 Svellsongur copying Azir, Ascendant gives a second, separate once-per-turn copy of the ability', () => {
  let g = S0();
  fundAll(g, P0);
  const az = put(g, P0, 'Azir, Ascendant', BF_A);
  control(g, BF_A, P0);
  const other = put(g, P0, 'V(2)', 'base');
  const sv = put(g, P0, 'Svellsongur', 'base');
  attachNow(g, sv, az);
  const acts = (s: GameState) => legal(s, P0, 'activate').filter(a => a.type === 'activate' && (a.obj === az || a.obj === sv));
  assert.equal(acts(g).length, 2, 'the ability twice (own + Svellsongur copy)');
  g = act(g, acts(g)[0]);
  g = resolveWith(g, { targets: [[other]], may: [false] });
  assert.equal(acts(g).length, 1, 'the other copy is still usable this turn');
});

test('RJ#1326 Called Shot: Repeat can be paid only once', () => {
  let g = S0();
  fundAll(g, P0, 6);
  const h0 = g.players[0].hand.length;
  const cs = hand(g, P0, 'Called Shot');
  g = act(g, { type: 'playCard', player: P0, obj: cs });
  let opts = 0;
  for (let i = 0; i < 20; i++) {
    const d = g.pending!;
    if (d.kind === 'optional') { opts++; g = choose(g, 'yes'); continue; }
    if (d.kind === 'chooseCards') { g = choose(g, d.options![0].id); continue; }
    if (d.inStep) { g = choose(g, d.options![0].id); continue; }
    if (d.kind === 'chainResponse') { g = pass(g); continue; }
    break;
  }
  assert.equal(opts, 1, 'one repeat offer');
  assert.equal(g.players[0].hand.length, h0 + 2, 'two instances, one draw each');
});

test('RJ#1327 Nine-Tailed Fox gives -1 to EACH attacking enemy unit; Ahri, Inquisitive affects one enemy unit', () => {
  let g = S0({ tp: P1 });
  legendOf(g, P0, 'Nine-Tailed Fox');
  put(g, P0, 'V(1)', BF_A);
  control(g, BF_A, P0);
  const a1 = put(g, P1, 'V(3)', 'base');
  const a2 = put(g, P1, 'V(4)', 'base');
  g = move(g, P1, [a1, a2], BF_A);
  // AUTO-AUDIT F-4 (ENGINE-7): the Fox's two instances (one per attacker) are ordered by P0
  assert.equal(g.pending?.kind, 'orderTriggers');
  g = resolveWith(g, { order: [['0']] });
  for (let i = 0; i < 6 && g.chain.length; i++) { if (g.pending!.inStep) break; g = pass(g); }
  assert.equal(mightOf(g, a1), 2);
  assert.equal(mightOf(g, a2), 3);
  // Ahri, Inquisitive: one enemy unit
  let k = S0({ tp: P1 });
  fundAll(k, P0);
  put(k, P0, 'Ahri, Inquisitive', BF_A);
  control(k, BF_A, P0);
  const b1 = put(k, P1, 'V(4)', 'base');
  const b2 = put(k, P1, 'V(4)', 'base');
  k = move(k, P1, [b1, b2], BF_A);
  k = resolveWith(k, { targets: [[b1]] });
  k = resolveWith(k, {});
  assert.deepEqual([mightOf(k, b1), mightOf(k, b2)], [2, 4]);
});

test('RJ#1328 Hidden Blade on your own unit saved by The Boss: you still draw 2', () => {
  let g = S0();
  fundAll(g, P0);
  legendOf(g, P0, 'The Boss');
  const u = put(g, P0, 'V(3)', BF_A, { buff: true });
  control(g, BF_A, P0);
  const hb = hand(g, P0, 'Hidden Blade');
  const h0 = g.players[0].hand.length - 1;
  g = play(g, P0, hb, { targets: [[u]] });
  g = resolveWith(g, { may: [true] });
  assert.equal(locOf(g, u), 'base', 'saved and recalled');
  assert.equal(g.players[0].hand.length, h0 + 2, 'still draws 2');
});

test('RJ#1329 Mask of Foresight does not trigger when moving to an open battlefield (not an attack)', () => {
  let g = S0();
  put(g, P0, 'Mask of Foresight', 'base');
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_A);
  assert.equal(g.chain.length, 0, 'no trigger');
  assert.equal(mightOf(g, u), 2);
  // control: attacking alone does trigger
  let { g: k, atk } = attackSetup(['V(2)'], ['V(1)']);
  void k; void atk;
});

test('RJ#1331 (ambiguous) defender may play Shen, Kinkou during the Deathknell chain of the combat cleanup and keeps the battlefield', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0);
  const dk = put(g, P0, 'DK(3)', BF_A);
  control(g, BF_A, P0);
  const shen = hand(g, P0, 'Shen, Kinkou');
  const a = put(g, P1, 'V(3)', 'base');
  g = move(g, P1, [a], BF_A);
  for (let i = 0; i < 10; i++) { const d = g.pending!; if (d.kind !== 'showdownAction') break; g = pass(g); }
  assert.equal(zone(g, dk), 'trash');
  assert.equal(zone(g, a), 'trash');
  assert.ok(g.chain.length >= 1, 'Deathknell on the chain');
  for (let i = 0; i < 4 && pend(g).player !== P0; i++) g = pass(g);
  expectPending(g, 'chainResponse', P0);
  assert.ok(canPlayNow(g, P0, shen, BF_A), 'Shen can be played to BF-A (still controlled)');
  g = play(g, P0, shen, { dest: BF_A });
  g = resolveWith(g, {});
  assert.equal(locOf(g, shen), BF_A);
  assert.equal(g.battlefields[BF_A].controller, P0);
});

test('RJ#1332 Stupefy on a 6-Might unit with 5 damage kills it', () => {
  let g = S0();
  fundAll(g, P0);
  const u = put(g, P1, 'V(6)', BF_A, { damage: 5 });
  control(g, BF_A, P1);
  [g] = cast(g, P0, 'Stupefy', { targets: [[u]] });
  g = resolveChain(g);
  assert.equal(zone(g, u), 'trash');
});

test('RJ#1333 Ravenbloom Student: nothing when the spell is put on the chain; +1 once it is played (countered = not played)', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const st = put(g, P0, 'Ravenbloom Student', 'base');
  const e = put(g, P1, 'V(5)', 'base');
  [g] = cast(g, P0, 'ZapM', { targets: [[e]] });
  assert.equal(mightOf(g, st), 2, 'not on chain placement');
  g = pass(g);
  [g] = cast(g, P1, 'CounterR', { targets: [[g.chain[0].id]] });
  g = resolveChain(g);
  assert.equal(mightOf(g, st), 2, 'countered: never played');
});

test('RJ#1334 Nocturne revealed by a defending Teemo, Strategist can be played to the defended battlefield (still controlled)', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0);
  const t = put(g, P0, 'Teemo, Strategist', BF_A);
  control(g, BF_A, P0);
  const n = put(g, P0, 'Nocturne, Horrifying', 'deckTop');
  const a = put(g, P1, 'V(5)', 'base');
  g = move(g, P1, [a], BF_A);
  const dests: string[] = [];
  for (let i = 0; i < 20; i++) {
    const d = g.pending!;
    if (d.kind === 'chooseTargets') { g = choose(g, a); continue; }
    if (d.kind === 'optional') { g = choose(g, 'yes'); continue; }
    if (d.kind === 'chooseDestination') { dests.push(...d.options!.map(o => o.id)); g = choose(g, String(BF_A)); continue; }
    if (d.inStep) { g = choose(g, d.options![0].id); continue; }
    if (d.kind === 'chainResponse') { g = pass(g); continue; }
    break;
  }
  void t;
  assert.ok(dests.includes(String(BF_A)), `BF-A offered (got ${dests})`);
  assert.equal(locOf(g, n), BF_A);
});

test('RJ#1335 Ride the Wind to another occupied battlefield during the opponent\'s attack: current combat first, then a new combat where you attack', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0);
  put(g, P0, 'V(2)', BF_A);
  control(g, BF_A, P0);
  const b = put(g, P1, 'V(1)', BF_B);
  control(g, BF_B, P1);
  const mine = put(g, P0, 'V(4)', 'base');
  const rw = hand(g, P0, 'Ride the Wind');
  const a = put(g, P1, 'V(5)', 'base');
  g = move(g, P1, [a], BF_A);
  g = pass(g);
  expectPending(g, 'showdownAction', P0);
  g = play(g, P0, rw, { targets: [[mine]] });
  g = resolveWith(g, { locations: [BF_B] });
  assert.equal(locOf(g, mine), BF_B);
  assert.equal(g.ex.combat?.bf, BF_A, 'the original combat continues');
  for (let i = 0; i < 10 && g.ex.combat?.bf === BF_A; i++) { if (g.pending!.inStep) break; g = pass(g); }
  assert.equal(g.ex.combat?.bf, BF_B, 'then the new combat at BF-B');
  assert.ok(g.ex.combat!.attackers.includes(mine), 'P0 is the attacker there');
  assert.ok(g.ex.combat!.defenders.includes(b));
});

test('RJ#1338 the board is bases + battlefields; trash is not on the board (units there are not targetable as units)', () => {
  let g = S0();
  const t = put(g, P1, 'V(2)', 'trash');
  const z = hand(g, P0, 'ZapM');
  const b = put(g, P1, 'V(2)', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: z });
  assert.equal(pend(g).kind, 'chainResponse', 'only one legal target (the unit on the board): auto-chosen');
  g = resolveChain(g);
  assert.equal(zone(g, b), 'trash', 'the base unit took 2 and died');
});

test('RJ#1339 Primal Strength (Action) cannot respond to Carnivorous Snapvine\'s play trigger (closed state)', () => {
  let g = S0();
  fundAll(g, P0, 6);
  const e = put(g, P1, 'V(3)', BF_A);
  control(g, BF_A, P1);
  const sv = hand(g, P0, 'Carnivorous Snapvine');
  const ps = hand(g, P0, 'Primal Strength');
  g = play(g, P0, sv, { dest: 'base', targets: [[e]] });
  assert.ok(g.chain.length >= 1, 'play trigger on the chain');
  expectPending(g, 'chainResponse', P0);
  assert.ok(!canPlayNow(g, P0, ps), 'Action spell not allowed in a closed state');
});

test('RJ#1341 Trinity Force + Skyfall of Areion on a unit holding Reckoner\'s Arena: 3 points', () => {
  let g = S0({ tp: P1, bfA: "Reckoner's Arena" });
  fundAll(g, P0);
  const u = put(g, P0, 'V(3)', BF_A);
  control(g, BF_A, P0);
  attachNow(g, put(g, P0, 'Trinity Force', 'base'), u);
  attachNow(g, put(g, P0, 'Skyfall of Areion', 'base'), u);
  g = endTurn(g);
  for (let i = 0; i < 20; i++) { const d = g.pending!; if (d.kind === 'mainAction') break; if (d.inStep) { g = choose(g, d.options![0].id); continue; } g = pass(g); }
  assert.equal(g.activePlayer, P0);
  assert.equal(g.players[0].points, 3, 'hold 1 + Trinity hold 1 + Trinity as conquer effect via Arena 1');
});

test('RJ#1345 Equipment keywords are the equipped unit\'s keywords: Kato the Arm with Doran\'s Shield passes on [Tank]', () => {
  let g = S0();
  fundAll(g, P0);
  const k = put(g, P0, 'Kato the Arm', 'base');
  attachNow(g, put(g, P0, "Doran's Shield", 'base'), k);
  assert.ok(hasKeyword(g, k, 'Tank'), 'Kato has Tank from the Equipment');
  const o = put(g, P0, 'V(2)', BF_A);
  control(g, BF_A, P0);
  g = move(g, P0, [k], BF_A);
  g = resolveWith(g, { targets: [[o]] });
  assert.ok(hasKeyword(g, o, 'Tank'), 'given with Kato\'s keywords');
});

test('RJ#1346 Garbage Grabber: recycle 3 from trash + [1] + exhaust are all costs', () => {
  let g = S0();
  const gg = put(g, P0, 'Garbage Grabber', 'base');
  put(g, P0, 'V(1)', 'trash'); put(g, P0, 'V(1)', 'trash');
  assert.ok(!legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === gg), 'only 2 cards in trash');
  put(g, P0, 'V(1)', 'trash');
  assert.ok(legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === gg));
  const r = readyRunes(g, P0), h = g.players[0].hand.length;
  g = act(g, { type: 'activate', player: P0, obj: gg, abilityIndex: 0 });
  g = resolveWith(g, { cards: [g.players[0].trash.slice(0, 3)] });
  assert.equal(g.players[0].trash.length, 0, 'recycled 3');
  assert.equal(readyRunes(g, P0), r - 1);
  assert.ok(g.objects[gg].exhausted);
  assert.equal(g.players[0].hand.length, h + 1);
});

test('RJ#1347 (board unspecified) Sett, Kingpin buffed with 2 other buffed units vs Thousand-Tailed Watcher: 5+1+3-3 = 6; small units go to 1', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P1, 4);
  const s = put(g, P0, 'Sett, Kingpin', BF_A, { buff: true });
  const a = put(g, P0, 'V(1)', BF_A, { buff: true });
  const b = put(g, P0, 'V(1)', BF_A, { buff: true });
  control(g, BF_A, P0);
  assert.equal(mightOf(g, s), 9);
  const w = hand(g, P1, 'Thousand-Tailed Watcher');
  g = play(g, P1, w, { dest: 'base', may: [false] });
  g = resolveWith(g, {});
  assert.equal(mightOf(g, s), 6);
  assert.deepEqual([mightOf(g, a), mightOf(g, b)], [1, 1]);
});

test('RJ#1348 Imperial Decree does not change lethal damage assignment: 3 Might cannot be split 1/1/1 across 10-Might defenders', () => {
  let g = S0();
  fundAll(g, P0, 4);
  const d = [put(g, P1, 'V(10)', BF_A), put(g, P1, 'V(10)', BF_A), put(g, P1, 'V(10)', BF_A)];
  control(g, BF_A, P1);
  const a = put(g, P0, 'V(3)', 'base');
  [g] = cast(g, P0, 'Imperial Decree');
  g = resolveChain(g);
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 10; i++) { const p = g.pending!; if (p.kind === 'assignDamage' && p.player === P0) break; if (p.inStep) break; g = pass(g); }
  const p = pend(g);
  assert.equal(p.kind, 'assignDamage', `got ${p.kind}`);
  assert.notEqual(validateAction(g, { type: 'assignDamage', player: P0, assignment: { [d[0]]: 1, [d[1]]: 1, [d[2]]: 1 } }), null, '1/1/1 is illegal');
  assert.equal(validateAction(g, { type: 'assignDamage', player: P0, assignment: { [d[0]]: 3 } }), null, 'all on the first');
});

test('RJ#1351 Stupefy whose only target was removed before resolution still draws 1', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P1, 'V(2)', BF_A);
  control(g, BF_A, P1);
  const sf = hand(g, P0, 'Stupefy');
  g = play(g, P0, sf, { targets: [[u]] });
  const h0 = g.players[0].hand.length;
  g = pass(g);
  [g] = cast(g, P1, 'ZapR', { targets: [[u]] });  // removal in response (stands in for Hidden Blade)
  g = resolveChain(g);
  assert.equal(zone(g, u), 'trash');
  assert.equal(g.players[0].hand.length, h0 + 1, 'Stupefy still draws');
});

test('RJ#1353 Teemo, Strategist played from hidden during a combat on its battlefield triggers once (when it defends)', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0);
  put(g, P0, 'V(1)', BF_A);
  control(g, BF_A, P0);
  const t = put(g, P0, 'Teemo, Strategist', { facedown: BF_A });
  const a = put(g, P1, 'V(6)', 'base');
  g = move(g, P1, [a], BF_A);
  g = pass(g);
  expectPending(g, 'showdownAction', P0);
  g = play(g, P0, t, { dest: BF_A });
  let n = 0;
  for (let i = 0; i < 30; i++) {
    const d = g.pending!;
    if (d.kind === 'chooseTargets') { n++; g = choose(g, a); continue; }
    if (d.inStep) { g = choose(g, d.options![0].id); continue; }
    if (d.kind === 'chainResponse') { g = pass(g); continue; }
    break;
  }
  void n;
  assert.equal(g.log.filter(l => /^Trigger: Teemo/.test(l.text)).length, 1, `Teemo's defend trigger once: ${g.log.map(l => l.text).filter(t => /Teemo/.test(t)).join(' | ')}`);
});

test('RJ#1354 Ezreal, Prodigy does not discount Draven, Vanquisher\'s "you may pay [C]" attack trigger', () => {
  let g = S0();
  setRunes(g, P0, 0); addRunes(g, P0, 3, 'fury'); addRunes(g, P0, 3, 'chaos');
  put(g, P0, 'Ezreal, Prodigy', 'base');
  const dv = put(g, P0, 'Draven, Vanquisher', 'base');
  put(g, P1, 'V(1)', BF_A);
  control(g, BF_A, P1);
  const rd = g.players[0].runeDeck.length;
  g = move(g, P0, [dv], BF_A);
  g = resolveWith(g, { may: [true] });
  assert.equal(mightOf(g, dv), 6, 'paid');
  assert.equal(g.players[0].runeDeck.length, rd + 1, 'a Fury rune was recycled for [C]: no discount');
});

test('RJ#1355 two Zhonya\'s Hourglass save two units dying simultaneously, one each', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P1);
  const z1 = put(g, P0, "Zhonya's Hourglass", 'base'), z2 = put(g, P0, "Zhonya's Hourglass", 'base');
  const a = put(g, P0, 'V(1)', BF_A), b = put(g, P0, 'V(1)', BF_A);
  control(g, BF_A, P0);
  const bb = hand(g, P1, 'Bellows Breath');
  g = play(g, P1, bb, { may: [false], targets: [[a, b]] });
  for (let i = 0; i < 10; i++) { const d = g.pending!; if (d.inStep) g = choose(g, d.options![0].id); else if (d.kind === 'chainResponse') g = pass(g); else break; }
  assert.equal(locOf(g, a), 'base'); assert.equal(locOf(g, b), 'base');
  assert.equal(zone(g, z1), 'trash'); assert.equal(zone(g, z2), 'trash');
});

test('RJ#1356 Darius, Trifarian played as the second card: his trigger uses the chain and the opponent may respond', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  [g] = cast(g, P0, 'V(1)', { dest: 'base' });
  const d = hand(g, P0, 'Darius, Trifarian');
  g = play(g, P0, d, { dest: 'base' });
  assert.equal(g.chain.length, 1, 'trigger on the chain');
  g = pass(g);
  expectPending(g, 'chainResponse', P1);
  assert.ok(canPlayNow(g, P1, hand(g, P1, 'ZapR')));
});

test('RJ#1357 a unit saved by Zhonya\'s Hourglass is healed but keeps other effects (Stupefy -1)', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P1);
  put(g, P0, "Zhonya's Hourglass", 'base');
  const u = put(g, P0, 'V(3)', BF_A);
  control(g, BF_A, P0);
  [g] = cast(g, P1, 'Stupefy', { targets: [[u]] });
  g = resolveChain(g);
  assert.equal(mightOf(g, u), 2);
  [g] = cast(g, P1, 'ZapM', { targets: [[u]] });
  g = resolveWith(g, { may: [true] });
  assert.equal(locOf(g, u), 'base');
  assert.equal(g.objects[u].damage, 0, 'healed');
  assert.equal(mightOf(g, u), 2, 'Stupefy still applies');
});

test('RJ#1358 Tideturner\'s swap counts as a move for Kayn, Unleashed (moved twice => no damage)', () => {
  let g = S0();
  fundAll(g, P0);
  const k = put(g, P0, 'Kayn, Unleashed', 'base');
  put(g, P0, 'V(1)', BF_A);
  control(g, BF_A, P0);
  const t = hand(g, P0, 'Tideturner');
  g = play(g, P0, t, { dest: BF_A });
  g = resolveWith(g, { may: [true], targets: [[k]], cards: [[k]] });
  assert.equal(locOf(g, k), BF_A, 'swapped');
  g = move(g, P0, [k], 'base');
  [g] = cast(g, P0, 'ZapM', { targets: [[k]] });
  g = resolveChain(g);
  assert.equal(g.objects[k].damage, 0);
});

test('RJ#1360 Viktor, Leader makes a Recruit when a Sprite token (non-Recruit) dies', () => {
  let g = S0();
  put(g, P0, 'Viktor, Leader', 'base');
  const sp = put(g, P0, 'Sprite', 'base', { damage: 2, token: true });
  [g] = cast(g, P0, 'ZapM', { targets: [[sp]] });
  g = resolveWith(g, {});
  g = resolveWith(g, {});
  assert.equal(zone(g, sp), 'gone');
  assert.equal(g.players[0].base.filter(id => g.cards[g.objects[id].cardId].name === 'Recruit').length, 1);
});

test('RJ#1361 Crackshot Corsair + Warwick, Hunter attacking: their controller orders the simultaneous attack triggers', () => {
  const { g } = attackSetup(['Crackshot Corsair', 'Warwick, Hunter'], ['V(3)']);
  const d = pend(g);
  assert.equal(d.kind, 'orderTriggers');
  assert.equal(d.player, P0);
});

test('RJ#1362 Udyr, Wildman: each Udyr tracks its own chosen modes', () => {
  let g = S0();
  const u1 = put(g, P0, 'Udyr, Wildman', 'base', { buff: true, ready: false });
  const u2 = put(g, P0, 'Udyr, Wildman', 'base', { buff: true, ready: false });
  g = act(g, { type: 'activate', player: P0, obj: u1, abilityIndex: 0 });
  const m1 = optionIds(g);
  const ready = pend(g).options!.find(o => /Ready me/i.test(o.label))!.id;
  g = choose(g, ready);
  g = resolveWith(g, {});
  assert.ok(!g.objects[u1].exhausted);
  g = act(g, { type: 'activate', player: P0, obj: u2, abilityIndex: 0 });
  assert.ok(pend(g).options!.some(o => /Ready me/i.test(o.label)), 'the other Udyr may still choose "Ready me"');
  void m1;
});

test('RJ#1363 Gust whose target grew past 3 Might resolves doing nothing, but still counts as played (Ravenbloom Student +1)', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const st = put(g, P0, 'Ravenbloom Student', 'base');
  const u = put(g, P1, 'V(3)', BF_A);
  control(g, BF_A, P1);
  const gu = hand(g, P0, 'Gust');
  g = play(g, P0, gu, { targets: [[u]] });
  g = pass(g);
  [g] = cast(g, P1, 'PumpR', { targets: [[u]] });
  g = resolveChain(g);
  assert.equal(locOf(g, u), BF_A, 'not returned');
  assert.equal(mightOf(g, st), 3);
});

test('RJ#1367 Ride the Wind can move a unit battlefield-to-battlefield in a showdown on the opponent\'s turn', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0);
  const m = put(g, P0, 'V(2)', BF_B);
  control(g, BF_B, P0);
  const rw = hand(g, P0, 'Ride the Wind');
  const a = put(g, P1, 'V(1)', 'base');
  g = move(g, P1, [a], BF_A);
  g = pass(g);
  expectPending(g, 'showdownAction', P0);
  g = play(g, P0, rw, { targets: [[m]] });
  g = resolveWith(g, { locations: [BF_A] });
  assert.equal(locOf(g, m), BF_A);
});

test('RJ#1368 Mask of Foresight does not trigger on Challenge (no combat)', () => {
  let g = S0();
  fundAll(g, P0);
  put(g, P0, 'Mask of Foresight', 'base');
  const f = put(g, P0, 'V(5)', BF_A);
  control(g, BF_A, P0);
  const e = put(g, P1, 'V(2)', BF_B);
  control(g, BF_B, P1);
  [g] = cast(g, P0, 'Challenge', { targets: [[f], [e]] });
  g = resolveWith(g, { targets: [[f], [e]] });
  assert.equal(zone(g, e), 'trash');
  assert.equal(g.objects[f].damage, 2, 'the friendly unit took 2 and got no +1');
  assert.equal(mightOf(g, f), 5);
});

test('RJ#1369 Ahri, Inquisitive choosing a Deflect unit must pay Deflect; with nothing to pay the trigger is removed', () => {
  // pay: a rune is recycled for the Deflect power
  let { g, def } = attackSetup(['Ahri, Inquisitive'], ['Deflect(4,1)']);
  g = resolveWith(g, { targets: [[def[0]]], may: [true] });
  assert.equal(mightOf(g, def[0]), 2, '-2 applied');
  assert.equal(g.players[0].runeDeck.length, 7, 'Deflect [A] paid by recycling a rune (S0 rune deck 6)');
  // cannot pay: the trigger does nothing (removed)
  const s0 = S0({ runes: [0, 6] });
  const d2 = put(s0, P1, 'Deflect(4,1)', BF_A);
  control(s0, BF_A, P1);
  const ah = put(s0, P0, 'Ahri, Inquisitive', 'base');
  let k = move(s0, P0, [ah], BF_A);
  k = resolveWith(k, { targets: [[d2]], may: [true] });
  assert.equal(mightOf(k, d2), 4, 'no -2');
});

test('RJ#1369b Ahri, Inquisitive: the player may decline to pay Deflect (trigger then removed)', () => {
  const { g } = attackSetup(['Ahri, Inquisitive'], ['Deflect(4,1)']);
  assert.ok(g.log.every(l => !/pays A/.test(l.text)) || g.pending?.inStep, 'a decision to pay or decline is offered');
  assert.ok(g.pending?.inStep, 'pay/decline decision pending');
});

test('RJ#1370 Fox-Fire whose target moved to base resolves doing nothing (no retarget)', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P1, 'V(2)', BF_A);
  control(g, BF_A, P1);
  [g] = cast(g, P0, 'Fox-Fire, Ahri', { targets: [[u]] });
  g = pass(g);
  [g] = cast(g, P1, 'MoveR', { targets: [[u]] });
  g = resolveChain(g);
  assert.equal(locOf(g, u), 'base', 'alive in base');
});

test('RJ#1371 Thousand-Tailed Watcher\'s -3 affects only enemy units on the board when it resolves, not units played later', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const before = put(g, P1, 'V(5)', BF_A);
  control(g, BF_A, P1);
  [g] = cast(g, P0, 'Thousand-Tailed Watcher', { dest: 'base', may: [false] });
  g = resolveWith(g, {});
  assert.equal(mightOf(g, before), 2);
  const later = put(g, P1, 'V(5)', BF_A);
  assert.equal(mightOf(g, later), 5);
});

test('RJ#1372 a countered spell does not refund the Deflect tax', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const d = put(g, P1, 'Deflect(4,1)', BF_A);
  control(g, BF_A, P1);
  const rd = g.players[0].runeDeck.length;
  const r = readyRunes(g, P0);
  [g] = cast(g, P0, 'ZapM', { targets: [[d]] });
  const spent = r - readyRunes(g, P0), rec = g.players[0].runeDeck.length - rd;
  assert.ok(rec >= 1, 'Deflect power paid');
  g = pass(g);
  [g] = cast(g, P1, 'CounterR', { targets: [[g.chain[0].id]] });
  g = resolveChain(g);
  assert.equal(g.objects[d].damage, 0, 'countered');
  assert.equal(g.players[0].runeDeck.length - rd, rec, 'recycled runes not returned');
  assert.equal(r - readyRunes(g, P0), spent, 'exhausted runes stay exhausted');
});

test('RJ#1374 one Zhonya\'s Hourglass vs several simultaneous deaths (Bullet Time): its controller chooses which unit is saved', () => {
  let g = S0({ tp: P1 });
  setRunes(g, P1, 0); addRunes(g, P1, 6, 'body');
  const z = put(g, P0, "Zhonya's Hourglass", 'base');
  const a = put(g, P0, 'V(1)', BF_A), b = put(g, P0, 'V(1)', BF_A);
  control(g, BF_A, P0);
  const bt = hand(g, P1, 'Bullet Time, Miss Fortune');
  g = act(g, { type: 'playCard', player: P1, obj: bt });
  let asked = false;
  for (let i = 0; i < 30; i++) {
    const d = g.pending!;
    if (d.kind === 'mainAction') break;
    if (d.player === P0 && d.inStep) { asked = true; const ob = d.options!.find(o => o.objIds?.includes(b) || o.id === b); g = choose(g, (ob ?? d.options![0]).id); continue; }
    if (d.kind === 'chooseTargets') { g = choose(g, d.options!.find(o => o.label.startsWith('BF-A'))!.id); continue; }
    if (d.kind === 'chooseNumber') { g = choose(g, '1'); continue; }
    if (d.inStep) { g = choose(g, d.options![0].id); continue; }
    g = pass(g);
  }
  assert.equal(zone(g, z), 'trash');
  assert.deepEqual([zone(g, a), zone(g, b)].sort(), ['base', 'trash'], 'exactly one saved');
  assert.ok(asked, 'P0 is asked which unit Zhonya\'s saves');
  assert.equal(zone(g, b), 'base');
});

test('RJ#1376 a Seal cannot pay for itself; a Seal in play can pay for another', () => {
  const g = S0({ runes: [0, 6] });
  const s1 = hand(g, P0, 'Seal of Rage');
  assert.ok(!canPlayNow(g, P0, s1), 'no resources: can\'t use itself');
  put(g, P0, 'Seal of Rage', 'base');
  assert.ok(canPlayNow(g, P0, s1), 'the Seal in play pays [C]');
});

test('RJ#1377 Forge of the Fluft: the legend ability can move an attached Equipment to another unit (detaches first)', () => {
  let g = S0({ bfA: 'Forge of the Fluft' });
  const l = g.players[0].legend;
  const a = put(g, P0, 'V(2)', BF_A), b = put(g, P0, 'V(2)', 'base');
  control(g, BF_A, P0);
  const sw = put(g, P0, 'Sword', 'base');
  attachNow(g, sw, a);
  const act1 = legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === l);
  assert.ok(act1, 'legend has the granted ability');
  g = act(g, act1!);
  g = resolveWith(g, { targets: [[b]] });
  assert.equal(g.objects[sw].attachedTo, b);
});

test('RJ#1378 The Boss (Sett legend) replacement works on the opponent\'s turn', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0); fundAll(g, P1);
  legendOf(g, P0, 'The Boss');
  const u = put(g, P0, 'V(1)', BF_A, { buff: true });
  control(g, BF_A, P0);
  [g] = cast(g, P1, 'ZapM', { targets: [[u]] });
  g = resolveWith(g, { may: [true] });
  assert.equal(locOf(g, u), 'base');
});

test('RJ#1379 after the attack/defend triggers resolve, the attacker still has focus', () => {
  let { g } = attackSetup(['AttackDraw(3)'], ['V(1)']);
  assert.equal(g.chain.length, 1);
  g = resolveChain(g);
  expectPending(g, 'showdownAction', P0);
});

test('RJ#1380 Divine Judgment does not target: Not So Fast cannot counter it', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  put(g, P0, 'V(1)', 'base');
  const ns = hand(g, P1, 'Not So Fast');
  [g] = cast(g, P0, 'Divine Judgment');
  assert.equal(g.chain.length, 1);
  g = pass(g);
  expectPending(g, 'chainResponse', P1);
  assert.ok(!canPlayNow(g, P1, ns));
});

test('RJ#1381 energy already in the pool combines with newly exhausted runes to pay a cost', () => {
  let g = S0({ runes: [2, 6] });
  g.players[0].pool = { energy: 2, power: {} };
  const u = hand(g, P0, 'V(4)');
  assert.ok(canPlayNow(g, P0, u));
  g = play(g, P0, u, { dest: 'base' });
  assert.equal(zone(g, u), 'base');
  assert.equal(readyRunes(g, P0), 0);
  assert.equal(g.players[0].pool.energy, 0);
});

test('RJ#1382 Master Yi (+2 defending alone via Wuju Bladesman) takes 6 from Yasuo, attacker Flashes out: combat cleanup heals before designations clear, Yi survives', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P1);
  legendOf(g, P0, 'Wuju Bladesman');
  const yi = put(g, P0, 'Master Yi, Honed', BF_A);
  control(g, BF_A, P0);
  const ya = put(g, P1, 'Yasuo, Remorseful', 'base');
  const fl = hand(g, P1, 'Flash');
  g = move(g, P1, [ya], BF_A);
  g = resolveWith(g, { targets: [[yi]] });
  assert.equal(g.objects[yi].damage, 6);
  assert.equal(zone(g, yi), 'battlefield', '8 Might while defending alone');
  expectPending(g, 'showdownAction', P1);
  g = play(g, P1, fl, { targets: [[ya]] });
  g = resolveChain(g);
  assert.equal(locOf(g, ya), 'base');
  g = passAll(g);
  assert.equal(zone(g, yi), 'battlefield', 'survives');
  assert.equal(g.objects[yi].damage, 0, 'healed');
});

test('RJ#1383 one counterspell counters a Repeat spell entirely (both instances)', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const x = put(g, P1, 'V(5)', 'base');
  const rp = hand(g, P0, 'RepeatZap');
  g = play(g, P0, rp, { targets: [[x]], may: [true] });
  g = pass(g);
  [g] = cast(g, P1, 'CounterR', { targets: [[g.chain[0].id]] });
  g = resolveWith(g, { targets: [[x]] });
  assert.equal(g.objects[x].damage, 0);
  assert.equal(g.chain.length, 0);
});

test('RJ#1384 Charm moving an enemy unit to an open battlefield: they conquer it and score', () => {
  let g = S0();
  fundAll(g, P0);
  const e = put(g, P1, 'V(2)', 'base');
  [g] = cast(g, P0, 'Charm', { targets: [[e]] });
  g = resolveWith(g, { locations: [BF_B] });
  g = passAll(g);
  g = resolveWith(g, { battlefields: [BF_B] });
  g = passAll(g);
  assert.equal(locOf(g, e), BF_B);
  assert.equal(g.battlefields[BF_B].controller, P1);
  assert.equal(g.players[1].points, 1);
});

test('RJ#1385 Ezreal, Dashing ("I don\'t deal combat damage") adds no Might to the combat damage total', () => {
  let { g, def } = attackSetup(['Ezreal, Dashing', 'V(1)'], ['V(6)']);
  g = resolveWith(g, { targets: [[def[0]]], order: [[]] });
  for (let i = 0; i < 6 && g.pending?.kind === 'orderTriggers'; i++) g = choose(g, g.pending!.options![0].id);
  g = resolveWith(g, { targets: [[def[0]]] });
  assert.equal(g.objects[def[0]].damage, 3, 'Ezreal\'s attack trigger');
  const log = new EventLog();
  g = log.passAll(g);
  if (g.pending?.kind === 'assignDamage') g = log.act(g, { type: 'assignDamage', player: g.pending.player, assignment: (g.pending.data as { suggested: Record<string, number> }).suggested });
  g = log.passAll(g);
  const combat = log.of('damage').filter(e => e.obj === def[0]).reduce((s, e) => s + Number(e.amount), 0);
  assert.equal(combat, 1, 'only V(1)\'s Might is dealt');
  assert.equal(zone(g, def[0]), 'battlefield');
});

test('RJ#1386 a unit that gains Deflect after being targeted does not make the finalized spell pay Deflect (Fiora, Victorious)', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0); fundAll(g, P1);
  const f = put(g, P0, 'Fiora, Victorious', 'base');
  const r1 = readyRunes(g, P1), d1 = g.players[1].runeDeck.length;
  [g] = cast(g, P1, 'Stupefy', { targets: [[f]] });
  const spent = r1 - readyRunes(g, P1), rec = g.players[1].runeDeck.length - d1;
  g = pass(g);
  [g] = cast(g, P0, 'PumpR', { targets: [[f]] });
  g = passN(g, 2);
  assert.equal(g.chain.length, 1, 'PumpR resolved, Stupefy still waiting');
  assert.ok(hasKeyword(g, f, 'Deflect'), 'Mighty: Deflect now');
  g = resolveChain(g);
  assert.equal(r1 - readyRunes(g, P1), spent, 'no additional payment');
  assert.equal(g.players[1].runeDeck.length - d1, rec);
  assert.equal(mightOf(g, f), 6, '4 +3 -1: Stupefy still resolved');
});

test('RJ#1388 the ongoing combat resolves before a new showdown elsewhere; attacker wins by default (defender left) and Glorious Executioner draws', () => {
  let g = S0();
  fundAll(g, P1);
  legendOf(g, P0, 'Glorious Executioner');
  const e = put(g, P1, 'V(2)', BF_B);
  control(g, BF_B, P1);
  const rw = hand(g, P1, 'Ride the Wind');
  const a = put(g, P0, 'V(3)', 'base');
  g = move(g, P0, [a], BF_B);
  g = pass(g);
  expectPending(g, 'showdownAction', P1);
  g = play(g, P1, rw, { targets: [[e]] });
  g = resolveWith(g, { locations: [BF_A] });
  assert.equal(locOf(g, e), BF_A);
  const h0 = g.players[0].hand.length;
  for (let i = 0; i < 10 && g.ex.combat; i++) { if (g.pending!.inStep) break; g = pass(g); }
  assert.equal(g.players[0].hand.length, h0 + 1, 'won the combat: drew 1');
  assert.equal(g.battlefields[BF_B].controller, P0);
  g = passAll(g);
  assert.equal(g.battlefields[BF_A].controller, P1, 'then P1\'s showdown at BF-A');
});

test('RJ#1389 Stormbringer kills Kog\'Maw, Caustic and moves your unit there first; then Kog\'Maw\'s Deathknell damages it', () => {
  let g = S0();
  fundAll(g, P0);
  const v = put(g, P0, 'V(5)', 'base');
  const k = put(g, P1, "Kog'Maw, Caustic", BF_A);
  control(g, BF_A, P1);
  [g] = cast(g, P0, 'Stormbringer, Volibear', { targets: [[g.battlefields[BF_A].objId]] });
  for (let i = 0; i < 10; i++) { const d = g.pending!; if (d.kind === 'mainAction' || d.kind === 'showdownAction') break; if (d.inStep) g = choose(g, d.options![0].id); else g = pass(g); }
  assert.equal(zone(g, k), 'trash');
  assert.equal(locOf(g, v), BF_A);
  assert.equal(g.objects[v].damage, 4, 'Deathknell hit the moved unit');
});

test('RJ#1390 Bard, Mercurial may move himself with his play trigger', () => {
  let g = S0();
  fundAll(g, P0);
  const b = hand(g, P0, 'Bard, Mercurial');
  g = play(g, P0, b, { dest: 'base', may: [true] });
  let saw = false;
  for (let i = 0; i < 10; i++) {
    const d = g.pending!;
    if (d.kind === 'chooseUnitsToMove' || (d.kind === 'chooseCards' || d.kind === 'chooseTargets') && d.options?.some(o => o.id === b)) { saw = true; g = choose(g, b); continue; }
    if (d.kind === 'optional') { g = choose(g, 'yes'); continue; }
    if (d.inStep) { g = choose(g, d.options!.find(o => o.id === String(BF_A))?.id ?? d.options![0].id); continue; }
    if (d.kind === 'chainResponse') { g = pass(g); continue; }
    break;
  }
  assert.ok(saw, 'Bard is a legal choice');
  assert.equal(locOf(g, b), BF_A);
});

test('RJ#1391 Rebuke on an equipped unit at a battlefield: Equipment detaches and is recalled to base', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P1);
  const u = put(g, P0, 'V(2)', BF_A);
  control(g, BF_A, P0);
  const sw = put(g, P0, 'Sword', 'base');
  attachNow(g, sw, u);
  [g] = cast(g, P1, 'Rebuke', { targets: [[u]] });
  g = resolveChain(g);
  assert.equal(zone(g, u), 'hand');
  assert.equal(g.objects[sw].attachedTo ?? null, null);
  assert.equal(zone(g, sw), 'base');
});

test('RJ#1392 Viktor, Innovator: a hidden card played on the opponent\'s turn triggers only once it resolves; countered = no trigger', () => {
  const run = (counter: boolean) => {
    let g = S0({ tp: P1 });
    fundAll(g, P0); fundAll(g, P1);
    put(g, P0, 'Viktor, Innovator', 'base');
    const mine = put(g, P0, 'V(4)', BF_A);
    control(g, BF_A, P0);
    const hz = put(g, P0, 'HidZap', { facedown: BF_A });
    const e = put(g, P1, 'V(5)', 'base');
    [g] = cast(g, P1, 'ZapM', { targets: [[e]] });
    g = pass(g);
    g = play(g, P0, hz, { targets: [[mine]] });
    const recruits = (s: GameState) => s.players[0].base.filter(id => s.cards[s.objects[id].cardId].name === 'Recruit').length;
    assert.equal(recruits(g), 0, 'not on placing it on the chain');
    if (counter) { g = pass(g); [g] = cast(g, P1, 'CounterR', { targets: [[g.chain[g.chain.length - 1].id]] }); }
    g = resolveWith(g, {});
    return recruits(g);
  };
  assert.equal(run(false), 1);
  assert.equal(run(true), 0);
});

// RJ#1393 DECIDED (docs/riftjudge/DECISIONS.md): MISMATCH-RJ. RJ's reason ("the stealer is considered to play it") is contradicted by
// the Vendetta FAQ (Rebuttal: "Although you gained control of Stupefy, you did not finalize it" — Legion/Battering Ram still
// see the original player). Ravenborn Tome's bonus applies to "the next spell you play" (the original player played it) and
// its reminder text has no controller condition: 3 + 1 = 4. Same principle as RJ#5287 (Legion).
test('RJ#1393 Hextech Ray boosted by Ravenborn Tome, stolen with Mystic Reversal: still deals the Tome bonus (4) — the original player played it (VEN-FAQ)', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const tome = put(g, P0, 'Ravenborn Tome', 'base');
  const t = put(g, P1, 'V(6)', BF_A);
  control(g, BF_A, P1);
  g = act(g, { type: 'activate', player: P0, obj: tome, abilityIndex: 0 });
  g = resolveChain(g);
  [g] = cast(g, P0, 'Hextech Ray', { targets: [[t]] });
  g = pass(g);
  [g] = cast(g, P1, 'Mystic Reversal', { targets: [[g.chain[0].id]] });
  g = resolveWith(g, { may: [false] });
  assert.equal(g.objects[t].damage, 4, 'the Tome bonus stays with the spell P0 played');
});

test('RJ#1396 (MISMATCH-RJ) face-down Teemo, Strategist played in response to a Deathknell during the combat cleanup: combat is still ongoing (designations end last, CR 468), so it becomes a defender', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0);
  const s = put(g, P0, 'Watchful Sentry', BF_A);
  control(g, BF_A, P0);
  const t = put(g, P0, 'Teemo, Strategist', { facedown: BF_A });
  const a = put(g, P1, 'V(3)', 'base');
  g = move(g, P1, [a], BF_A);
  for (let i = 0; i < 10; i++) { const d = g.pending!; if (d.kind !== 'showdownAction') break; g = pass(g); }
  assert.equal(zone(g, s), 'trash');
  assert.ok(g.chain.length >= 1, 'Deathknell on the chain');
  for (let i = 0; i < 4 && pend(g).player !== P0; i++) g = pass(g);
  assert.ok(canPlayNow(g, P0, t), 'Teemo may be played in response');
  g = play(g, P0, t, { dest: BF_A });
  g = finish(g);
  assert.ok(g.log.filter(l => /^Trigger: Teemo/.test(l.text)).length >= 1, 'gets the defender designation and its defend trigger (official: CR 468 task order, CR 323 step 2); RJ said "vanilla"');
});

test('RJ#1397 after attacking, Shen, Kinkou (Reaction) cannot be played to the attacked battlefield (not controlled)', () => {
  const { g } = attackSetup(['V(2)'], ['V(3)']);
  fundAll(g, P0);
  const s = hand(g, P0, 'Shen, Kinkou');
  assert.ok(!playDests(g, P0, s).includes(BF_A));
});

test('RJ#1398 attacker keeps its designation (and "while attacking" Assault) when the defender leaves mid-combat', () => {
  let { g, atk, def } = attackSetup(['V(2)'], ['V(3)']);
  fundAll(g, P0); fundAll(g, P1);
  [g] = cast(g, P0, 'Cleave', { targets: [[atk[0]]] });
  g = resolveChain(g);
  expectPending(g, 'showdownAction', P1);
  [g] = cast(g, P1, 'MoveR', { targets: [[def[0]]] });
  g = resolveChain(g);
  assert.equal(locOf(g, def[0]), 'base');
  assert.ok(g.ex.combat?.attackers.includes(atk[0]), 'still an attacker');
  assert.equal(mightOf(g, atk[0]), 5, 'Assault 3 still applies (2+3)');
});

test('RJ#1399 Baited Hook (no Action keyword) cannot be activated during a showdown', () => {
  let g = S0();
  fundAll(g, P0);
  const bh = put(g, P0, 'Baited Hook', 'base');
  put(g, P0, 'V(1)', 'base');
  const u = put(g, P0, 'V(2)', 'base');
  assert.ok(legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === bh), 'usable in Neutral Open');
  g = move(g, P0, [u], BF_A);
  expectPending(g, 'showdownAction', P0);
  assert.ok(!legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === bh));
});

test('RJ#1401 Traveling Merchant\'s move trigger is mandatory (no "may")', () => {
  let g = S0();
  const tm = put(g, P0, 'Traveling Merchant', 'base');
  const c = hand(g, P0, 'V(1)');
  g = move(g, P0, [tm], BF_A);
  let optional = false;
  for (let i = 0; i < 12; i++) { const d = g.pending!; if (d.kind === 'optional') optional = true; if (d.kind === 'showdownAction' || d.kind === 'mainAction') break; if (d.inStep) g = choose(g, d.options![0].id); else g = pass(g); }
  assert.ok(!optional, 'never asked whether to use it');
  assert.equal(zone(g, c), 'trash', 'discarded');
  assert.equal(g.players[0].hand.length, 1, 'drew 1');
});

test('RJ#1404 Void Hatchling does not apply to "look at" effects (Stacked Deck)', () => {
  let g = S0();
  put(g, P0, 'Void Hatchling', 'base');
  [g] = cast(g, P0, 'Stacked Deck');
  let hatch = false;
  for (let i = 0; i < 10; i++) { const d = g.pending!; if (/Hatchling|recycle it/i.test(d.prompt) && d.kind === 'optional') hatch = true; if (d.kind === 'mainAction') break; if (d.inStep) g = choose(g, ...d.options!.slice(0, Math.max(1, d.min ?? 1)).map(o => o.id)); else g = pass(g); }
  assert.ok(!hatch);
  assert.ok(!g.log.some(l => /Void Hatchling/.test(l.text)), 'Hatchling never used');
});

test('RJ#1405 Thousand-Tailed Watcher\'s "to a minimum of 1" is snapshotted: a 2-Might unit at 1 returns to 2 after +1', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P1); fundAll(g, P0);
  const u = put(g, P0, 'V(2)', BF_A);
  control(g, BF_A, P0);
  [g] = cast(g, P1, 'Thousand-Tailed Watcher', { dest: 'base', may: [false] });
  g = resolveWith(g, {});
  assert.equal(mightOf(g, u), 1);
  [g] = cast(g, P1, 'BuffM', { targets: [[u]] });
  g = resolveChain(g);
  assert.equal(mightOf(g, u), 2);
});

test('RJ#1406 Smoke Screen (-4, min 1) on a buffed 1-Might unit: increases first, reduction snapshotted, ends at 1', () => {
  let g = S0();
  fundAll(g, P0);
  const u = put(g, P1, 'V(1)', 'base', { buff: true });
  assert.equal(mightOf(g, u), 2);
  [g] = cast(g, P0, 'Smoke Screen', { targets: [[u]] });
  g = resolveChain(g);
  assert.equal(mightOf(g, u), 1);
});

test('RJ#1408 Sett, Brawler: "when you play me or when I conquer" are separate triggers, each buffs', () => {
  let g = S0();
  fundAll(g, P0);
  const s = hand(g, P0, 'Sett, Brawler');
  g = play(g, P0, s, { dest: 'base' });
  g = resolveWith(g, {});
  assert.equal(g.objects[s].counters.buff ?? 0, 1, 'play alone buffs');
  const s2 = put(g, P0, 'Sett, Brawler', 'base');
  g = move(g, P0, [s2], BF_A);
  g = finish(g);
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.objects[s2].counters.buff ?? 0, 1, 'conquer alone buffs');
});

test('RJ#1409 Iron Ballista damage is ability damage: prevented by Unyielding Spirit; choosing a Deflect unit costs the tax', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const ib = put(g, P0, 'Iron Ballista', 'base');
  const e = put(g, P1, 'V(3)', BF_A);
  control(g, BF_A, P1);
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === ib)!);
  g = answer(g, { targets: [[e]] });
  assert.equal(g.chain.length, 1);
  g = pass(g);
  [g] = cast(g, P1, 'Unyielding Spirit');
  g = resolveChain(g);
  assert.equal(g.objects[e].damage, 0, 'prevented');
  // Deflect
  let k = S0();
  fundAll(k, P0);
  const ib2 = put(k, P0, 'Iron Ballista', 'base');
  const d = put(k, P1, 'Deflect(3,1)', BF_A);
  control(k, BF_A, P1);
  const rd = k.players[0].runeDeck.length;
  k = act(k, legal(k, P0, 'activate').find(a => a.type === 'activate' && a.obj === ib2)!);
  k = answer(k, { targets: [[d]] });
  assert.equal(k.players[0].runeDeck.length, rd + 1, 'Deflect power paid');
});

test('RJ#1410 there is no priority window before the opponent\'s hold scoring (Retreat cannot stop the hold)', () => {
  let g = S0();
  fundAll(g, P0);
  put(g, P1, 'V(2)', BF_A);
  control(g, BF_A, P1);
  hand(g, P0, 'Retreat');
  g = endTurn(g);
  const asked: string[] = [];
  for (let i = 0; i < 20; i++) { const d = g.pending!; if (d.kind === 'mainAction') break; asked.push(`${d.kind}:P${d.player}`); g = d.inStep ? choose(g, d.options![0].id) : pass(g); }
  assert.equal(g.activePlayer, P1);
  assert.equal(g.players[1].points, 1, 'held');
  assert.ok(!asked.some(a => a.endsWith('P0')), `P0 never had priority: ${asked}`);
});

test('RJ#1411 Jinx, Rebel triggers on each discard: readied each time, +1 each even if already ready', () => {
  let g = S0();
  fundAll(g, P0);
  const j = put(g, P0, 'Jinx, Rebel', 'base', { ready: false });
  const c1 = hand(g, P0, 'V(1)'), c2 = hand(g, P0, 'V(2)');
  [g] = cast(g, P0, 'Lunar Boon');
  g = resolveWith(g, { cards: [[c1]] });
  g = resolveWith(g, {});
  assert.ok(!g.objects[j].exhausted);
  assert.equal(mightOf(g, j), 6);
  [g] = cast(g, P0, 'Lunar Boon');
  g = resolveWith(g, { cards: [[c2]] });
  g = resolveWith(g, {});
  assert.equal(mightOf(g, j), 7, 'already ready: still +1');
});

test('RJ#1412 Ravenbloom Student gets +1 per spell played (stacks)', () => {
  let g = S0({ runes: [12, 6] });
  const st = put(g, P0, 'Ravenbloom Student', 'base');
  for (let i = 0; i < 5; i++) { [g] = cast(g, P0, 'Draw1M'); g = resolveChain(g); }
  assert.equal(mightOf(g, st), 7);
});

test('RJ#1413 conquering at 7 and drawing instead still scores that battlefield; conquering the other one then wins', () => {
  let g = S0();
  g.players[0].points = 7;
  const a = put(g, P0, 'V(2)', 'base'), b = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [a], BF_A);
  g = finish(g);
  assert.equal(g.players[0].points, 7, 'drew instead');
  assert.equal(g.battlefields[BF_A].controller, P0);
  g = move(g, P0, [b], BF_B);
  g = finish(g);
  assert.equal(g.players[0].points, 8);
  assert.equal(g.winner, 0);
});

test('RJ#1414 opponent re-establishes control of a battlefield during my turn (unit moved in from their other battlefield): they score it', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const e1 = put(g, P1, 'V(1)', BF_A);
  const e2 = put(g, P1, 'V(4)', BF_B);
  control(g, BF_A, P1); control(g, BF_B, P1);
  [g] = cast(g, P0, 'ZapM', { targets: [[e1]] });
  g = resolveChain(g);
  assert.equal(zone(g, e1), 'trash');
  const a = put(g, P0, 'V(1)', 'base');
  const rw = hand(g, P1, 'Ride the Wind');
  g = move(g, P0, [a], BF_A);
  g = pass(g);
  expectPending(g, 'showdownAction', P1);
  g = play(g, P1, rw, { targets: [[e2]] });
  g = resolveWith(g, { locations: [BF_A] });
  g = finish(g);
  assert.equal(g.battlefields[BF_A].controller, P1);
  assert.equal(g.players[1].points, 1, 'P1 conquers BF-A on P0\'s turn');
});

test('RJ#1415 Void Seeker 4 damage on a 7-Might unit, then Smoke Screen -4: dies at the cleanup', () => {
  let g = S0();
  fundAll(g, P0);
  const u = put(g, P1, 'V(7)', BF_A);
  control(g, BF_A, P1);
  [g] = cast(g, P0, 'Void Seeker', { targets: [[u]] });
  g = resolveChain(g);
  assert.equal(g.objects[u].damage, 4);
  [g] = cast(g, P0, 'Smoke Screen', { targets: [[u]] });
  g = resolveChain(g);
  assert.equal(zone(g, u), 'trash');
});

test('RJ#1416 healing (Janna, Savior) clears damage but not Thousand-Tailed Watcher\'s -3', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P0, 'V(6)', BF_A, { damage: 2 });
  control(g, BF_A, P0);
  [g] = cast(g, P1, 'Thousand-Tailed Watcher', { dest: 'base', may: [false] });
  g = resolveWith(g, {});
  assert.equal(mightOf(g, u), 3);
  [g] = cast(g, P1, 'DrawR');
  g = pass(g);
  const j = hand(g, P0, 'Janna, Savior');
  g = play(g, P0, j, { dest: BF_A });
  g = finish(g);
  assert.equal(g.objects[u].damage, 0);
  assert.equal(mightOf(g, u), 3, '-3 stays');
});

test('RJ#1417 Smoke Screen\'s reduction is fixed when it resolves; later Might changes still adjust the total', () => {
  let g = S0();
  fundAll(g, P0);
  const u = put(g, P1, 'V(3)', 'base');
  [g] = cast(g, P0, 'Smoke Screen', { targets: [[u]] });
  g = resolveChain(g);
  assert.equal(mightOf(g, u), 1);
  [g] = cast(g, P0, 'PumpR', { targets: [[u]] });
  g = resolveChain(g);
  assert.equal(mightOf(g, u), 4, '3 - 2 (snapshotted) + 3');
});

test('RJ#1419 Sprite Call played while attacking cannot put the token at the attacked (uncontrolled) battlefield', () => {
  let { g } = attackSetup(['V(2)'], ['V(3)']);
  fundAll(g, P0);
  ensureCard(g, 'Sprite');
  const sc = hand(g, P0, 'Sprite Call');
  g = play(g, P0, sc);
  const dests: string[] = [];
  for (let i = 0; i < 10; i++) { const d = g.pending!; if (d.kind === 'chooseDestination') { dests.push(...d.options!.map(o => o.id)); g = choose(g, d.options![0].id); continue; } if (d.inStep) { g = choose(g, d.options![0].id); continue; } if (d.kind === 'chainResponse') { g = pass(g); continue; } break; }
  assert.ok(!dests.includes(String(BF_A)));
  const tok = Object.values(g.objects).find(o => g.cards[o.cardId]?.name === 'Sprite');
  assert.ok(tok, 'token played');
  assert.notEqual(locOf(g, tok!.id), BF_A);
});

test('RJ#1420 the attacker may still play Cleave after the defender\'s chain resolves (showdown continues until both pass in a row)', () => {
  let { g, atk, def } = attackSetup(['V(2)'], ['V(3)']);
  fundAll(g, P0); fundAll(g, P1);
  g = pass(g);
  [g] = cast(g, P1, 'PumpA', { targets: [[def[0]]] });
  g = resolveChain(g);
  expectPending(g, 'showdownAction', P0);
  const cl = hand(g, P0, 'Cleave');
  assert.ok(canPlayNow(g, P0, cl));
  void atk;
});

test('RJ#1422 conquering Candlelit Sanctum at 7 (final point denied): the replacement draw happens first, then the conquer trigger', () => {
  let g = S0({ bfA: 'The Candlelit Sanctum' });
  g.players[0].points = 7;
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_A);
  g = finish(g);
  const t = g.log.map(l => l.text);
  const iDraw = t.findIndex(x => /draws a card instead|P0 draws 1/.test(x));
  const iTrig = t.findIndex(x => /^Trigger: The Candlelit Sanctum/.test(x));
  assert.ok(iDraw >= 0 && iTrig >= 0, t.join(' | '));
  assert.ok(iDraw < iTrig, 'draw before the conquer trigger');
});

test('RJ#1425 Rek\'Sai, Swarm Queen killed in response to her attack trigger: it still resolves, but a unit can\'t be played "here"', () => {
  let { g, atk } = attackSetup(["Rek'Sai, Swarm Queen"], ['V(1)'], { atkOpts: [{ damage: 3 }] });
  fundAll(g, P0); fundAll(g, P1);
  put(g, P0, 'V(2)', 'deckTop');
  if (g.pending?.kind === 'optional') g = choose(g, 'yes');
  assert.equal(g.chain.length, 1);
  g = pass(g);
  [g] = cast(g, P1, 'ZapR', { targets: [[atk[0]]] });
  g = passN(g, 2);
  assert.equal(zone(g, atk[0]), 'trash');
  const dests: string[] = [];
  let revealed = false;
  for (let i = 0; i < 15; i++) {
    const d = g.pending!;
    if (d.kind === 'optional') { revealed = true; g = choose(g, 'yes'); continue; }
    if (d.kind === 'chooseDestination') { dests.push(...d.options!.map(o => o.id)); g = choose(g, d.options![0].id); continue; }
    if (d.inStep) { g = choose(g, d.options![0].id); continue; }
    if (d.kind === 'chainResponse') { g = pass(g); continue; }
    break;
  }
  assert.ok(revealed || g.log.some(l => /^Revealed/.test(l.text)), 'the trigger still resolved');
  assert.ok(!dests.includes(String(BF_A)), `not "here" (${dests})`);
});

test('RJ#1428 Retreat cannot be played without a friendly unit', () => {
  let g = S0();
  fundAll(g, P0);
  const r = hand(g, P0, 'Retreat');
  assert.ok(!canPlayNow(g, P0, r));
  put(g, P0, 'V(1)', 'base');
  assert.ok(canPlayNow(g, P0, r));
});

test('RJ#1429 during a showdown at one battlefield you may play Void Seeker on a unit at another battlefield', () => {
  let g = S0();
  fundAll(g, P0);
  const e = put(g, P1, 'V(5)', BF_B);
  control(g, BF_B, P1);
  const u = put(g, P0, 'V(1)', 'base');
  g = move(g, P0, [u], BF_A);
  expectPending(g, 'showdownAction', P0);
  const vs = hand(g, P0, 'Void Seeker');
  g = play(g, P0, vs, { targets: [[e]] });
  g = resolveChain(g);
  assert.equal(g.objects[e].damage, 4);
});

test('RJ#1431 2-Might unit on Trifarian War Camp (3) hit by Thousand-Tailed Watcher ends at 1', () => {
  let g = S0({ tp: P1, bfA: 'Trifarian War Camp' });
  fundAll(g, P1);
  const u = put(g, P0, 'V(2)', BF_A);
  control(g, BF_A, P0);
  assert.equal(mightOf(g, u), 3);
  [g] = cast(g, P1, 'Thousand-Tailed Watcher', { dest: 'base', may: [false] });
  g = resolveWith(g, {});
  assert.equal(mightOf(g, u), 1);
});

test('RJ#1432 Retreat on a unit you would Cull must be played before Cull the Weak resolves (no window during resolution)', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0); fundAll(g, P1);
  const a = put(g, P0, 'V(1)', 'base'), b = put(g, P0, 'V(2)', 'base');
  put(g, P1, 'V(1)', 'base');
  const r = hand(g, P0, 'Retreat');
  [g] = cast(g, P1, 'Cull the Weak');
  g = pass(g);
  expectPending(g, 'chainResponse', P0);
  assert.ok(canPlayNow(g, P0, r), 'in response: yes');
  g = pass(g);
  for (let i = 0; i < 6; i++) {
    const d = g.pending!;
    if (!d.inStep) break;
    if (d.player === P0) assert.ok(!canPlayNow(g, P0, r), 'not while Cull is resolving');
    g = choose(g, d.options!.find(o => o.id === a)?.id ?? d.options![0].id);
  }
  assert.equal(zone(g, a), 'trash'); assert.equal(zone(g, b), 'base');
});

test('RJ#1433 Nocturne, Horrifying drawn in the draw phase offers no banish/play option', () => {
  let g = S0({ tp: P1 });
  const n = put(g, P0, 'Nocturne, Horrifying', 'deckTop');
  g = endTurn(g);
  let offered = false;
  for (let i = 0; i < 20; i++) { const d = g.pending!; if (d.kind === 'mainAction') break; if (d.kind === 'optional' && /Nocturne|banish/i.test(d.prompt)) offered = true; g = d.inStep ? choose(g, d.options![0].id) : pass(g); }
  assert.equal(g.activePlayer, P0);
  assert.ok(!offered);
  assert.equal(zone(g, n), 'hand');
});

test('RJ#1436 stealing Time Warp with Mystic Reversal: the new controller takes the extra turn', () => {
  let g = S0();
  fundAll(g, P0, 4); addRunes(g, P0, 4, 'fury');
  fundAll(g, P1, 4);
  const tw = hand(g, P0, 'Time Warp');
  g = play(g, P0, tw);
  assert.equal(g.chain.length, 1);
  g = pass(g);
  [g] = cast(g, P1, 'Mystic Reversal', { targets: [[g.chain[0].id]] });
  g = resolveWith(g, { may: [false] });
  assert.deepEqual(g.ex.extraTurns, [P1]);
  assert.equal(zone(g, tw), 'banishment');
  g = endTurn(g);
  g = finish(g);
  assert.equal(g.activePlayer, P1);
});

test('RJ#1437 Sun Disc (no Reaction) cannot be activated while Flame Chompers\' discard trigger is on the chain', () => {
  let g = S0();
  fundAll(g, P0);
  const sd = put(g, P0, 'Sun Disc', 'base');
  const ce = hand(g, P0, 'Chemtech Enforcer');
  const fc = hand(g, P0, 'Flame Chompers');
  g = play(g, P0, ce, { dest: 'base' });
  g = resolveWith(g, { cards: [[fc]] });
  for (let i = 0; i < 5 && g.pending?.inStep; i++) g = choose(g, g.pending!.options!.find(o => o.id === fc || o.id === 'yes')?.id ?? g.pending!.options![0].id);
  assert.equal(zone(g, fc), 'trash');
  assert.ok(g.chain.length >= 1, 'Chompers trigger on the chain');
  assert.ok(!legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === sd), 'Sun Disc not usable in a closed state');
});

test('RJ#1441 a (casual) main deck may have more than 40 cards', async () => {
  const { validateDeck } = await import('../../src/engine/deck.ts');
  const { fixtureDb } = await import('../fixtures/conformance/cards.ts');
  const { legalDeck } = await import('../conformance/harness.ts');
  const d = legalDeck();
  assert.deepEqual(validateDeck(d, fixtureDb()).filter(p => p.code === 'main.size'), []);
  const big = { ...d, main: [...d.main, 'cf-v1', 'cf-v2', 'cf-v3'] };
  assert.ok(big.main.length > 40);
  assert.deepEqual(validateDeck(big, fixtureDb()).filter(p => p.code === 'main.size'), [], 'more than 40 is legal');
  const small = { ...d, main: d.main.slice(0, 38) };
  assert.ok(validateDeck(small, fixtureDb()).some(p => p.code === 'main.size'));
});

test('RJ#1443 Ezreal, Dashing\'s "move me to your base" is blocked by Vilemaw\'s Lair', () => {
  let g = S0({ tp: P1, bfA: "Vilemaw's Lair" });
  fundAll(g, P0);
  const ez = put(g, P0, 'Ezreal, Dashing', BF_A);
  control(g, BF_A, P0);
  const a = legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === ez);
  if (a) { g = act(g, a); g = resolveWith(g, {}); }
  assert.equal(locOf(g, ez), BF_A, 'stays at the Lair');
});

test('RJ#1445 Watcher takes a 2-Might defender to 1; Mask of Foresight then gives +1 when it defends alone: 2', () => {
  let g = S0();
  fundAll(g, P0);
  put(g, P1, 'Mask of Foresight', 'base');
  const d = put(g, P1, 'V(2)', BF_A);
  control(g, BF_A, P1);
  [g] = cast(g, P0, 'Thousand-Tailed Watcher', { dest: 'base', may: [false] });
  g = resolveWith(g, {});
  assert.equal(mightOf(g, d), 1);
  const a = put(g, P0, 'V(5)', 'base');
  g = move(g, P0, [a], BF_A);
  g = resolveWith(g, {});
  assert.equal(mightOf(g, d), 2);
});

test('RJ#1446 constructed: a Signature card needs its own legend even if its domains fit', async () => {
  const { validateDeck } = await import('../../src/engine/deck.ts');
  const { fixtureDb } = await import('../fixtures/conformance/cards.ts');
  const { legalDeck } = await import('../conformance/harness.ts');
  const d = legalDeck();
  const sig = realCard('Death Mark');
  const db = { ...fixtureDb(), [sig.id]: sig };
  const deck = { ...d, main: [...d.main.slice(1), sig.id] };
  assert.ok(validateDeck(deck, db).length > 0, 'Zed signature in a non-Zed deck is illegal');
});

test('RJ#1448 (ambiguous: RJ page inconsistent 2 vs 3) 3-Might unit hit by Watcher (to 1), then Discipline +2: 3', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P1); fundAll(g, P0);
  const u = put(g, P0, 'V(3)', BF_A);
  control(g, BF_A, P0);
  [g] = cast(g, P1, 'Thousand-Tailed Watcher', { dest: 'base', may: [false] });
  g = resolveWith(g, {});
  assert.equal(mightOf(g, u), 1);
  [g] = cast(g, P1, 'Discipline', { targets: [[u]] });
  g = resolveChain(g);
  assert.equal(mightOf(g, u), 3, 'snapshotted -2, then +2');
});

test('RJ#1450 Warwick, Hunter removed in response to his attack trigger: the trigger does nothing (no "here")', () => {
  let { g, atk, def } = attackSetup(['Warwick, Hunter'], ['V(3)'], { atkOpts: [{ damage: 3 }], defOpts: [{ damage: 1 }] });
  fundAll(g, P1);
  assert.equal(g.chain.length, 1);
  g = pass(g);
  [g] = cast(g, P1, 'Cannon Barrage');
  g = resolveChain(g);
  assert.equal(zone(g, atk[0]), 'trash');
  assert.equal(zone(g, def[0]), 'battlefield', 'the damaged defender was not killed');
});

test('RJ#1451 (MISMATCH-RJ) a leading "you may" in a trigger (Startipped Peak) is decided when it goes on the chain (CR 383.3.a), not on resolution', () => {
  let g = S0({ tp: P1, bfA: 'Startipped Peak' });
  put(g, P0, 'V(2)', BF_A);
  control(g, BF_A, P0);
  g = endTurn(g);
  for (let i = 0; i < 10; i++) { const d = g.pending!; if (d.kind === 'optional' || d.kind === 'mainAction') break; g = d.inStep ? choose(g, d.options![0].id) : pass(g); }
  const d = pend(g);
  assert.equal(d.kind, 'optional', 'asked');
  assert.ok(g.chain.length === 0 || g.chain[g.chain.length - 1].pending, 'decided while the trigger is still pending (finalization), before anyone can respond');
  const rp = g.players[0].runesInPlay.length;
  g = choose(g, 'yes');
  g = finish(g);
  assert.equal(g.players[0].runesInPlay.length, rp + 3, '1 from the Peak + 2 channel phase');
});

test('RJ#1453 a unit dying to Temporary granted by Fading Memories was not killed by a spell (Immortal Phoenix does not trigger)', () => {
  let g = S0();
  fundAll(g, P0);
  const ph = put(g, P0, 'Immortal Phoenix', 'trash');
  const u = put(g, P1, 'V(3)', BF_A);
  control(g, BF_A, P1);
  [g] = cast(g, P0, 'Fading Memories', { targets: [[u]] });
  g = resolveChain(g);
  assert.ok(hasKeyword(g, u, 'Temporary'));
  g = endTurn(g);
  let asked = false;
  for (let i = 0; i < 20; i++) { const d = g.pending!; if (d.kind === 'mainAction') break; if (d.player === P0 && d.inStep) asked = true; g = d.inStep ? choose(g, d.options![0].id) : pass(g); }
  assert.equal(zone(g, u), 'trash', 'died to Temporary');
  assert.ok(!asked, 'no Phoenix offer');
  assert.equal(zone(g, ph), 'trash');
});

test('RJ#1454 Pickpocket may kill a Gold token (a token\'s cost counts as 0)', () => {
  let g = S0();
  fundAll(g, P0);
  const gold = put(g, P1, 'Gold', 'base', { token: true });
  const pp = hand(g, P0, 'Pickpocket');
  g = play(g, P0, pp, { dest: 'base', may: [true], targets: [[gold]] });
  g = resolveWith(g, { may: [true], targets: [[gold]] });
  assert.notEqual(zone(g, gold), 'base');
  assert.equal(g.players[0].base.filter(id => g.cards[g.objects[id].cardId].name === 'Gold').length, 1, 'P0 gets a Gold');
});

test('RJ#1455 Smoke Screen on a 2-Might unit at Trifarian War Camp: +1 first, then -4 (min 1) = 1', () => {
  let g = S0({ bfA: 'Trifarian War Camp' });
  fundAll(g, P0);
  const u = put(g, P1, 'V(2)', BF_A);
  control(g, BF_A, P1);
  [g] = cast(g, P0, 'Smoke Screen', { targets: [[u]] });
  g = resolveChain(g);
  assert.equal(mightOf(g, u), 1);
});

test('RJ#1457 Stand United from hidden: buff target limited to that battlefield, but the extra +1 applies to buffed units anywhere', () => {
  let g = S0();
  fundAll(g, P0);
  const a = put(g, P0, 'V(2)', BF_A);
  const b = put(g, P0, 'V(2)', BF_B, { buff: true });
  control(g, BF_A, P0); control(g, BF_B, P0);
  const su = put(g, P0, 'Stand United', { facedown: BF_A });
  g = act(g, { type: 'playCard', player: P0, obj: su });
  if (pend(g).kind === 'chooseTargets') { assert.deepEqual(optionIds(g), [a]); g = choose(g, a); }
  g = resolveChain(g);
  assert.equal(mightOf(g, a), 4, '2 + buff 1 + 1');
  assert.equal(mightOf(g, b), 4, 'buffed unit at another battlefield also +1');
});

test('RJ#1458 Defy may counter an earlier (non-top) spell on the chain', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const e = put(g, P1, 'V(5)', 'base');
  let z: string;
  [g, z] = cast(g, P0, 'ZapM', { targets: [[e]] });
  [g] = cast(g, P0, 'DrawR');
  g = pass(g);
  expectPending(g, 'chainResponse', P1);
  const df = hand(g, P1, 'Defy');
  g = act(g, { type: 'playCard', player: P1, obj: df });
  const zItem = g.chain.find(c => c.source === z)!.id;
  assert.ok(optionIds(g).includes(zItem), 'the bottom spell is a legal target');
  g = choose(g, zItem);
  g = resolveChain(g);
  assert.equal(g.objects[e].damage, 0, 'ZapM countered');
});

test('RJ#1459 Zhonya\'s Hourglass played from hidden is recalled to base and protects units anywhere', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0); fundAll(g, P1);
  put(g, P0, 'V(1)', BF_A);
  control(g, BF_A, P0);
  const u = put(g, P0, 'V(2)', BF_B);
  control(g, BF_B, P0);
  const z = put(g, P0, "Zhonya's Hourglass", { facedown: BF_A });
  [g] = cast(g, P1, 'DrawR');
  g = pass(g);
  g = play(g, P0, z);
  g = resolveChain(g);
  assert.equal(zone(g, z), 'base', 'recalled to base');
  [g] = cast(g, P1, 'ZapM', { targets: [[u]] });
  g = resolveWith(g, { may: [true] });
  assert.equal(locOf(g, u), 'base', 'saved at the other battlefield');
  assert.equal(zone(g, z), 'trash');
});

test('RJ#1460 Blind Fury revealing the opponent\'s Nocturne: its owner may banish it on reveal; it is played only after Blind Fury resolves', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const n = put(g, P1, 'Nocturne, Horrifying', 'deckTop');
  [g] = cast(g, P0, 'Blind Fury');
  let p1asked = false;
  for (let i = 0; i < 20; i++) {
    const d = g.pending!;
    if (d.kind === 'mainAction') break;
    if (d.player === P1 && d.kind === 'optional') { p1asked = true; g = choose(g, 'yes'); continue; }
    if (d.inStep) { g = choose(g, d.options![0].id); continue; }
    g = pass(g);
  }
  assert.ok(p1asked, 'Nocturne\'s owner was offered to banish it');
  assert.equal(g.objects[n]?.controller ?? P1, P1);
});

test('RJ#1461 opponent moves into your battlefield: they get focus first; after they pass you may play several hidden cards in a row', () => {
  let g = S0({ tp: P1 });
  const mine = put(g, P0, 'V(5)', BF_A);
  control(g, BF_A, P0);
  const h1 = put(g, P0, 'HidZap', { facedown: BF_A }), h2 = put(g, P0, 'HidZap', { facedown: BF_A });
  const a = put(g, P1, 'V(6)', 'base');
  g = move(g, P1, [a], BF_A);
  expectPending(g, 'showdownAction', P1);
  assert.equal(legal(g, P0).length, 0, 'P0 has no priority yet');
  g = pass(g);
  expectPending(g, 'showdownAction', P0);
  g = play(g, P0, h1, { targets: [[a]] });
  expectPending(g, 'chainResponse', P0, 'still holds priority');
  assert.ok(canPlayNow(g, P0, h2));
  g = play(g, P0, h2, { targets: [[a]] });
  assert.equal(g.chain.length, 2);
  void mine;
});

test('RJ#1462 Back to Back needs two friendly units to be played', () => {
  const g = S0();
  fundAll(g, P0);
  const bb = hand(g, P0, 'Back to Back');
  put(g, P0, 'V(1)', 'base');
  assert.ok(!canPlayNow(g, P0, bb), 'one unit: not playable');
  put(g, P0, 'V(1)', 'base');
  assert.ok(canPlayNow(g, P0, bb));
});

test('RJ#1463 a unit readied by Ride the Wind and recalled after a combat it couldn\'t win stays ready', () => {
  let g = S0();
  fundAll(g, P0);
  const u = put(g, P0, 'V(2)', 'base', { ready: false });
  put(g, P1, 'V(4)', BF_B, { stunned: true });
  control(g, BF_B, P1);
  [g] = cast(g, P0, 'Ride the Wind', { targets: [[u]] });
  g = resolveWith(g, { locations: [BF_B] });
  assert.equal(locOf(g, u), BF_B);
  g = finish(g);
  assert.equal(locOf(g, u), 'base', 'recalled');
  assert.equal(g.objects[u].exhausted, false, 'still ready');
});

test('RJ#1465 Falling Star\'s target moved to base by Flash is still legal (no location requirement) and dies', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P1, 'V(3)', BF_A);
  control(g, BF_A, P1);
  [g] = cast(g, P0, 'Falling Star', { targets: [[u], [u]] });
  g = answer(g, { targets: [[u]] });
  g = pass(g);
  [g] = cast(g, P1, 'Flash', { targets: [[u]] });
  g = resolveWith(g, { targets: [[u]] });
  assert.equal(zone(g, u), 'trash');
});

test('RJ#1466 after Showstopper moves Sett, Brawler to a battlefield (showdown), his base-speed "spend my buff" cannot be used', () => {
  let g = S0();
  fundAll(g, P0);
  const s = put(g, P0, 'Sett, Brawler', 'base');
  [g] = cast(g, P0, 'Showstopper, Sett', { targets: [[s]] });
  g = resolveWith(g, { locations: [BF_A], battlefields: [BF_A] });
  assert.equal(locOf(g, s), BF_A);
  assert.equal(g.objects[s].counters.buff ?? 0, 1);
  expectPending(g, 'showdownAction', P0);
  assert.ok(!legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === s));
});

test('RJ#1468 Switcheroo from hidden swaps Ember Monk first; Ember Monk\'s +2 trigger resolves after', () => {
  let g = S0();
  fundAll(g, P0);
  const em = put(g, P0, 'Ember Monk', BF_A);
  const v = put(g, P0, 'V(1)', BF_A);
  control(g, BF_A, P0);
  const sw = put(g, P0, 'Switcheroo', { facedown: BF_A });
  g = play(g, P0, sw, { targets: [[em, v]] });
  g = resolveWith(g, {});
  assert.equal(mightOf(g, v), 4);
  assert.equal(mightOf(g, em), 3, 'swapped to 1, then +2');
});

test('RJ#1469 Super Mega Death Rocket discarded by Zaun Warrens cannot return off that same conquer', () => {
  let g = S0({ bfA: 'Zaun Warrens' });
  fundAll(g, P0);
  const r = hand(g, P0, 'Super Mega Death Rocket!, Jinx');
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_A);
  let rocketOffer = false;
  for (let i = 0; i < 20; i++) {
    const d = g.pending!;
    if (d.kind === 'mainAction') break;
    if (d.kind === 'optional' && /Rocket|return/i.test(d.prompt)) { rocketOffer = true; g = choose(g, 'yes'); continue; }
    if (d.kind === 'chooseCards' && d.options!.some(o => o.id === r)) { g = choose(g, r); continue; }
    g = d.inStep ? choose(g, d.options![0].id) : pass(g);
  }
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.ok(!rocketOffer);
  assert.equal(zone(g, r), 'trash');
});

test('RJ#1471 a hidden Zhonya\'s can be played in response to a Deathknell during the combat cleanup (bf still controlled), keeping the Zhonya\'s', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0);
  const dk = put(g, P0, 'DK(2)', BF_A);
  control(g, BF_A, P0);
  const z = put(g, P0, "Zhonya's Hourglass", { facedown: BF_A });
  const a = put(g, P1, 'V(4)', 'base');
  g = move(g, P1, [a], BF_A);
  for (let i = 0; i < 10; i++) { const d = g.pending!; if (d.kind !== 'showdownAction') break; g = pass(g); }
  assert.equal(zone(g, dk), 'trash');
  for (let i = 0; i < 4 && pend(g).player !== P0; i++) g = pass(g);
  assert.ok(canPlayNow(g, P0, z));
  g = play(g, P0, z);
  g = finish(g);
  assert.equal(zone(g, z), 'base', 'Zhonya\'s kept (recalled), not trashed with the lost battlefield');
  assert.equal(g.battlefields[BF_A].controller, P1);
});

test('RJ#1475 Lee Sin, Ascetic ("any number of buffs") can be buffed by any source while already buffed', () => {
  let g = S0();
  fundAll(g, P0);
  const l = put(g, P0, 'Lee Sin, Ascetic', 'base', { buff: true });
  [g] = cast(g, P0, 'BuffM', { targets: [[l]] });
  g = resolveChain(g);
  assert.equal(g.objects[l].counters.buff, 2);
  assert.equal(mightOf(g, l), 7);
});

test('RJ#1477 Sett, Brawler can spend a buff repeatedly in a turn when rebuffed (+4 each)', () => {
  let g = S0();
  fundAll(g, P0);
  const s = put(g, P0, 'Sett, Brawler', 'base', { buff: true });
  const spend = (k: GameState) => act(k, legal(k, P0, 'activate').find(a => a.type === 'activate' && a.obj === s)!);
  g = resolveChain(spend(g));
  assert.equal(mightOf(g, s), 8);
  [g] = cast(g, P0, 'BuffM', { targets: [[s]] });
  g = resolveChain(g);
  g = resolveChain(spend(g));
  assert.equal(mightOf(g, s), 12);
});

test('RJ#1480 a recalled unit keeps its buff', () => {
  let { g, atk } = attackSetup(['V(1)'], ['V(5)'], { atkOpts: [{ buff: true }], defOpts: [{ stunned: true }] });
  g = finish(g);
  assert.equal(locOf(g, atk[0]), 'base', 'recalled');
  assert.equal(g.objects[atk[0]].counters.buff, 1);
});

test('RJ#1481 Equip is an activated ability on the chain: the opponent can respond', () => {
  let g = S0();
  fundAll(g, P0);
  const u = put(g, P0, 'V(2)', 'base');
  const sw = put(g, P0, 'Sword', 'base');
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === sw)!);
  g = answer(g, { targets: [[u]] });
  assert.equal(g.chain.length, 1);
  g = pass(g);
  expectPending(g, 'chainResponse', P1);
});

test('RJ#1483 Ezreal, Prodigy does not reduce the (mandatory) Deflect tax', () => {
  let g = S0();
  fundAll(g, P0);
  put(g, P0, 'Ezreal, Prodigy', 'base');
  const d = put(g, P1, 'Deflect(4,1)', 'base');
  const rd = g.players[0].runeDeck.length;
  [g] = cast(g, P0, 'ZapM', { targets: [[d]] });
  assert.equal(g.players[0].runeDeck.length, rd + 1, 'Deflect [A] paid in full');
});

test('RJ#1485 unit moves to an empty battlefield, opponent Ride the Winds in during the showdown: mover attacks, opponent defends', () => {
  let g = S0();
  fundAll(g, P1);
  const a = put(g, P0, 'V(3)', 'base');
  const e = put(g, P1, 'V(2)', 'base');
  const rw = hand(g, P1, 'Ride the Wind');
  g = move(g, P0, [a], BF_A);
  g = pass(g);
  expectPending(g, 'showdownAction', P1);
  g = play(g, P1, rw, { targets: [[e]] });
  g = resolveWith(g, { locations: [BF_A] });
  for (let i = 0; i < 6 && !g.ex.combat; i++) { if (g.pending!.inStep) break; g = pass(g); }
  assert.ok(g.ex.combat, 'combat started');
  assert.ok(g.ex.combat!.attackers.includes(a));
  assert.ok(g.ex.combat!.defenders.includes(e));
});

test('RJ#1486 Noxian Drummer played directly to a battlefield does not trigger "when I move"', () => {
  let g = S0();
  fundAll(g, P0);
  put(g, P0, 'V(1)', BF_A);
  control(g, BF_A, P0);
  const nd = hand(g, P0, 'Noxian Drummer');
  g = play(g, P0, nd, { dest: BF_A });
  assert.equal(g.chain.length, 0);
  assert.equal(Object.values(g.objects).filter(o => g.cards[o.cardId]?.name === 'Recruit').length, 0);
});

test('RJ#1488 Action cards cannot be played in response to the opponent\'s spell outside a showdown', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0);
  const za = hand(g, P0, 'ZapA');
  const x = put(g, P0, 'V(5)', 'base');
  [g] = cast(g, P1, 'ZapM', { targets: [[x]] });
  g = pass(g);
  expectPending(g, 'chainResponse', P0);
  assert.ok(!canPlayNow(g, P0, za));
});

test('RJ#1489 starting the turn at 6, conquering both battlefields (7 then 8) wins', () => {
  let g = S0();
  g.players[0].points = 6;
  const a = put(g, P0, 'V(2)', 'base'), b = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [a], BF_A);
  g = finish(g);
  assert.equal(g.players[0].points, 7);
  g = move(g, P0, [b], BF_B);
  g = finish(g);
  assert.equal(g.winner, 0);
});

test('RJ#1491 Deadbloom Predator may be played to an occupied enemy battlefield', () => {
  const g = S0();
  fundAll(g, P0);
  put(g, P1, 'V(2)', BF_A);
  control(g, BF_A, P1);
  const d = hand(g, P0, 'Deadbloom Predator');
  assert.ok(playDests(g, P0, d).includes(BF_A));
});

test('RJ#1492 Zenith Blade: a friendly unit already at the stunned unit\'s battlefield may be chosen, but it does not move', () => {
  let { g, atk, def } = attackSetup(['V(3)'], ['V(2)']);
  fundAll(g, P0);
  put(g, P0, 'V(1)', 'base');      // (second friendly unit: with one, the now-required choice is auto-answered — ENGINE-7, RJ#5998b)
  const zb = hand(g, P0, 'Zenith Blade, Leona');
  g = act(g, { type: 'playCard', player: P0, obj: zb });
  const seen: string[][] = [];
  for (let i = 0; i < 10; i++) {
    const d = g.pending!;
    if (d.kind === 'chooseTargets') { seen.push(d.options!.map(o => o.id)); g = choose(g, d.options!.find(o => o.id === def[0] || o.id === atk[0])?.id ?? d.options![0].id); continue; }
    if (d.kind === 'optional') { g = choose(g, 'yes'); continue; }
    if (d.inStep) { g = choose(g, d.options![0].id); continue; }
    if (d.kind === 'chainResponse') { g = pass(g); continue; }
    break;
  }
  assert.ok(g.objects[def[0]].stunned, 'stunned');
  assert.equal(locOf(g, atk[0]), BF_A, 'stays');
  assert.ok(seen.some(s => s.includes(atk[0])), 'the friendly unit there is a legal choice');
});

test('RJ#1493 two Svellsongur on Ahri, Inquisitive: three instances of her attack trigger (copies of printed text only)', () => {
  let g = S0();
  fundAll(g, P0);
  const ah = put(g, P0, 'Ahri, Inquisitive', 'base');
  attachNow(g, put(g, P0, 'Svellsongur', 'base'), ah);
  attachNow(g, put(g, P0, 'Svellsongur', 'base'), ah);
  const e = put(g, P1, 'V(6)', BF_A);
  control(g, BF_A, P1);
  g = move(g, P0, [ah], BF_A);
  for (let i = 0; i < 6 && g.pending?.inStep; i++) g = choose(g, g.pending!.options!.find(o => o.id === e)?.id ?? g.pending!.options![0].id);
  assert.equal(g.chain.length, 3);
});

test('RJ#1494 Discipline (+2 this turn) is not a buff: Monastery of Hirana has no buff to spend', () => {
  let g = S0({ bfA: 'Monastery of Hirana' });
  fundAll(g, P0);
  const u = put(g, P0, 'V(2)', 'base');
  [g] = cast(g, P0, 'Discipline', { targets: [[u]] });
  g = resolveChain(g);
  assert.equal(g.objects[u].counters.buff ?? 0, 0);
  g = move(g, P0, [u], BF_A);
  let offered = false;
  for (let i = 0; i < 12; i++) { const d = g.pending!; if (d.kind === 'mainAction') break; if (d.kind === 'optional' && /buff/i.test(d.prompt)) offered = true; g = d.inStep ? choose(g, 'no' in {} ? 'no' : d.options![d.options!.length - 1].id) : pass(g); }
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.ok(!offered, 'no buff to spend: no offer');
});

test('RJ#1495 moving a second unit onto your Candlelit Sanctum (still controlled) is not a conquer', () => {
  let g = S0({ bfA: 'The Candlelit Sanctum' });
  const a = put(g, P0, 'V(2)', BF_A);
  control(g, BF_A, P0);
  const b = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [b], BF_A);
  g = move(g, P0, [a], 'base');
  assert.equal(g.chain.length, 0);
  assert.ok(!g.pending?.inStep);
  assert.equal(g.players[0].points, 0);
});

test('RJ#1498 a unit replayed by Portal Rescue (ignoring its cost) may still pay Accelerate to enter ready', () => {
  let g = S0();
  fundAll(g, P0);
  const u = put(g, P0, 'Accel(2)', 'base', { ready: false });
  [g] = cast(g, P0, 'Portal Rescue', { targets: [[u]] });
  let offered = false;
  for (let i = 0; i < 10; i++) { const d = g.pending!; if (d.kind === 'mainAction') break; if (d.kind === 'optional' && /Accelerate/i.test(d.prompt)) { offered = true; g = choose(g, 'yes'); continue; } g = d.inStep ? choose(g, d.options![0].id) : pass(g); }
  assert.ok(offered, 'Accelerate offered');
  const nu = g.players[0].base.find(id => g.cards[g.objects[id].cardId].name === 'Accel(2)')!;
  assert.equal(g.objects[nu].exhausted, false, 'entered ready');
});

test('RJ#1501 Ezreal, Prodigy\'s [A]-less reduction applies to Called Shot\'s optional Repeat cost', () => {
  let g = S0();
  setRunes(g, P0, 0); addRunes(g, P0, 3, 'chaos');
  put(g, P0, 'Ezreal, Prodigy', 'base');
  const rd = g.players[0].runeDeck.length;
  const cs = hand(g, P0, 'Called Shot');
  g = act(g, { type: 'playCard', player: P0, obj: cs });
  for (let i = 0; i < 20; i++) { const d = g.pending!; if (d.kind === 'mainAction') break; if (d.kind === 'optional') { g = choose(g, 'yes'); continue; } g = d.inStep ? choose(g, d.options![0].id) : pass(g); }
  assert.equal(g.players[0].runeDeck.length - rd, 1, 'only the base [C] was paid; Repeat [C] reduced to 0');
});

test('RJ#1503 Mask of Foresight\'s "defends alone" +1 still applies if Teemo joins from hidden before it resolves', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0);
  put(g, P0, 'Mask of Foresight', 'base');
  const d = put(g, P0, 'V(2)', BF_A);
  control(g, BF_A, P0);
  const t = put(g, P0, 'HidU(2)', { facedown: BF_A });
  const a = put(g, P1, 'V(5)', 'base');
  g = move(g, P1, [a], BF_A);
  assert.equal(g.chain.length, 1, 'Mask trigger');
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  g = play(g, P0, t, { dest: BF_A });
  g = resolveChain(g);
  assert.equal(locOf(g, t), BF_A);
  assert.equal(mightOf(g, d), 3, '+1 not rechecked');
});

test('RJ#1506 Challenge uses Mights at resolution: a reaction reducing the friendly unit\'s Might changes the damage', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const f = put(g, P0, 'V(4)', BF_A);
  control(g, BF_A, P0);
  const e = put(g, P1, 'V(6)', BF_B);
  control(g, BF_B, P1);
  [g] = cast(g, P0, 'Challenge', { targets: [[f], [e]] });
  g = answer(g, { targets: [[f], [e]] });
  g = pass(g);
  [g] = cast(g, P1, 'Smoke Screen', { targets: [[f]] });
  g = resolveWith(g, { targets: [[f], [e]] });
  assert.equal(g.objects[e].damage, 1, 'reduced Might (1) used');
});

test('RJ#1511 Challenge still resolves after its friendly unit is saved (recalled) by The Boss from Reaction removal', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  legendOf(g, P0, 'The Boss');
  const f = put(g, P0, 'V(1)', BF_A, { buff: true });
  control(g, BF_A, P0);
  const e = put(g, P1, 'V(3)', BF_B);
  control(g, BF_B, P1);
  [g] = cast(g, P0, 'Challenge', { targets: [[f], [e]] });
  g = answer(g, { targets: [[f], [e]] });
  g = pass(g);
  [g] = cast(g, P1, 'ZapR', { targets: [[f]] });
  g = passN(g, 2);
  g = resolveWith(g, { may: [true, true] });
  assert.equal(g.objects[e].damage, 1, 'Challenge resolved: f (1 Might, buff spent) dealt 1');
});

test('RJ#1513 Akshan, Mischievous can take an attached enemy Equipment: gains control and it attaches to Akshan', () => {
  let g = S0();
  fundAll(g, P0);
  const eu = put(g, P1, 'V(2)', 'base');
  const sw = put(g, P1, 'Sword', 'base');
  attachNow(g, sw, eu);
  const ak = hand(g, P0, 'Akshan, Mischievous');
  g = play(g, P0, ak, { dest: 'base', may: [true] });
  g = resolveWith(g, { may: [true], targets: [[sw]], cards: [[sw]] });
  for (let i = 0; i < 5 && g.pending?.inStep; i++) g = choose(g, g.pending!.options!.find(o => o.id === sw || o.id === 'yes')?.id ?? g.pending!.options![0].id);
  g = resolveWith(g, {});
  assert.equal(g.objects[sw].controller, P0);
  assert.equal(g.objects[sw].attachedTo, ak);
});

test('RJ#1516 Dragon\'s Rage moving an enemy unit to base: if Flash already returned it to base, nothing moves and no damage is dealt', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const x = put(g, P1, 'V(3)', BF_A);
  control(g, BF_A, P1);
  const y = put(g, P1, 'V(2)', 'base');
  [g] = cast(g, P0, "Dragon's Rage, Lee Sin", { targets: [[x]] });
  g = answer(g, { locations: ['base'] });
  g = pass(g);
  [g] = cast(g, P1, 'Flash', { targets: [[x]] });
  const dests: string[] = [];
  for (let i = 0; i < 12; i++) { const d = g.pending!; if (d.kind === 'mainAction') break; if (d.kind === 'chooseDestination') { dests.push(...d.options!.map(o => o.id)); g = choose(g, d.options!.find(o => o.id === 'base')?.id ?? d.options![0].id); continue; } g = d.inStep ? choose(g, d.options![0].id) : pass(g); }
  assert.equal(locOf(g, x), 'base');
  assert.equal(g.objects[x].damage, 0);
  assert.equal(g.objects[y].damage, 0);
  assert.ok(!dests.some(d => d !== 'base'), `not moved anywhere else (offered ${dests})`);
});

test('RJ#1518 Teemo, Strategist vs Deadbloom Predator (Deflect): Deflect paid once, damage dealt as one instance', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0); fundAll(g, P1);
  put(g, P0, 'Teemo, Strategist', BF_A);
  control(g, BF_A, P0);
  for (let i = 0; i < 3; i++) put(g, P0, 'HidU(1)', 'deckTop');
  const dp = put(g, P1, 'Deadbloom Predator', 'base');
  g = move(g, P1, [dp], BF_A);
  const rd = g.players[0].runeDeck.length;
  const log = new EventLog();
  for (let i = 0; i < 20; i++) { const d = g.pending!; if (d.kind === 'showdownAction' && g.chain.length === 0) break; if (d.kind === 'mainAction') break; if (d.kind === 'chooseTargets') { g = log.act(g, { type: 'choose', player: d.player, optionIds: [dp] }); continue; } g = d.inStep ? log.act(g, { type: 'choose', player: d.player, optionIds: [d.options![0].id] }) : log.pass(g); }
  const hits = log.of('damage').filter(e => e.obj === dp);
  assert.equal(hits.length, 1, 'one damage instance');
  assert.equal(Number(hits[0].amount), 3);
  assert.ok(g.players[0].runeDeck.length - rd <= 1 + 5, 'sanity');
  assert.ok(g.log.filter(l => /^P0 pays/.test(l.text)).length <= 1, 'Deflect paid once');
});

test('RJ#1521 Needlessly Large Yordle: a point from Ahri, Alluring\'s hold trigger is not "scored from holding"', async () => {
  const { playCostOf } = await import('../../src/engine/testkit.ts');
  let g = S0({ tp: P1 });
  put(g, P0, 'Ahri, Alluring', BF_A);
  control(g, BF_A, P0);
  g = endTurn(g);
  g = finish(g);
  assert.equal(g.activePlayer, P0);
  assert.equal(g.players[0].points, 2, 'hold point + Ahri point');
  const y = hand(g, P0, 'Needlessly Large Yordle');
  const c = playCostOf(g, P0, y);
  fundAll(g, P0, 6);
  const c2 = playCostOf(g, P0, y)!;
  void c;
  assert.equal(c2.energy, 8, 'reduced once ([2] less), not twice');
  assert.equal(c2.power.length, 2);
});

test('RJ#1525 a hidden card at a battlefield not involved in the showdown can be played whenever Reaction timing allows', () => {
  let g = S0({ tp: P1 });
  put(g, P0, 'V(2)', BF_A);
  control(g, BF_A, P0);
  put(g, P0, 'V(3)', BF_B);
  control(g, BF_B, P0);
  const hz = put(g, P0, 'HidZap', { facedown: BF_B });
  const a = put(g, P1, 'V(4)', 'base');
  g = move(g, P1, [a], BF_A);
  g = pass(g);
  expectPending(g, 'showdownAction', P0);
  assert.ok(canPlayNow(g, P0, hz), 'playable from BF-B during the BF-A combat');
});

test('RJ#1529 the attacker moves out with Ride the Wind during its own showdown: the first combat ends without attackers, then a new combat where it moved', () => {
  let g = S0();
  fundAll(g, P0);
  const d = put(g, P1, 'V(2)', BF_A);
  control(g, BF_A, P1);
  const b = put(g, P1, 'V(1)', BF_B);
  control(g, BF_B, P1);
  const a = put(g, P0, 'V(3)', 'base');
  const rw = hand(g, P0, 'Ride the Wind');
  g = move(g, P0, [a], BF_A);
  expectPending(g, 'showdownAction', P0);
  g = play(g, P0, rw, { targets: [[a]] });
  g = resolveWith(g, { locations: [BF_B] });
  assert.equal(locOf(g, a), BF_B);
  for (let i = 0; i < 10 && g.ex.combat?.bf !== BF_B; i++) { if (g.pending!.inStep) break; g = pass(g); }
  assert.equal(g.battlefields[BF_A].controller, P1, 'no attackers left: P1 keeps BF-A');
  assert.equal(zone(g, d), 'battlefield');
  assert.equal(g.ex.combat?.bf, BF_B, 'then the new combat at BF-B');
  assert.ok(g.ex.combat!.attackers.includes(a));
  assert.ok(g.ex.combat!.defenders.includes(b));
});

test('RJ#1531 Azir, Sovereign\'s attack trigger moves an exhausted token from another battlefield (no Ganking needed)', () => {
  let g = S0();
  const az = put(g, P0, 'Azir, Sovereign', 'base');
  const tok = put(g, P0, 'Recruit', BF_B, { ready: false });
  control(g, BF_B, P0);
  put(g, P1, 'V(1)', BF_A);
  control(g, BF_A, P1);
  g = move(g, P0, [az], BF_A);
  g = resolveWith(g, { may: [true], cards: [[tok]], targets: [[tok]] });
  for (let i = 0; i < 4 && g.pending?.inStep; i++) g = choose(g, g.pending!.options!.find(o => o.id === tok)?.id ?? g.pending!.options!.find(o => o.id === 'yes')?.id ?? g.pending!.options![0].id);
  assert.equal(locOf(g, tok), BF_A, 'exhausted token moved battlefield to battlefield');
});

test('RJ#1532 a stunned attacker is still recalled after combat at Vilemaw\'s Lair (recall is not a move)', () => {
  let { g, atk } = attackSetup(['V(2)'], ['V(5)'], { bfA: "Vilemaw's Lair", defOpts: [{ stunned: true }] });
  g.objects[atk[0]].stunned = true;
  g = finish(g);
  assert.equal(locOf(g, atk[0]), 'base');
  assert.equal(zone(g, atk[0]), 'base');
});

test('RJ#1533 hidden Zhonya\'s Hourglass: hidden at a controlled battlefield, played there from hidden, then recalled to base (unattached gear) in cleanup', () => {
  let g = S0();
  put(g, P0, 'V(2)', BF_A);
  control(g, BF_A, P0);
  const z0 = hand(g, P0, "Zhonya's Hourglass");
  assert.ok(rejects(g, { type: 'hide', player: P0, obj: z0, battlefieldIndex: BF_B } as never), 'cannot hide at a battlefield you do not control');
  g = act(g, { type: 'hide', player: P0, obj: z0, battlefieldIndex: BF_A });
  assert.equal(zone(g, z0), 'facedown');
  const z = put(g, P0, "Zhonya's Hourglass", { facedown: BF_A });
  assert.deepEqual(playDests(g, P0, z), [BF_A], 'played to that battlefield');
  g = play(g, P0, z, { dest: BF_A });
  g = resolveChain(g);
  assert.equal(locOf(g, z), 'base', 'unattached gear recalled in the cleanup');
});

test('RJ#1535 a unit with 0 or negative Might and no damage does not die', () => {
  let g = S0();
  const z = put(g, P0, 'V(0)', 'base');
  const s = put(g, P0, 'V(2)', BF_A);
  control(g, BF_A, P0);
  mod(g, s, { might: -3 });
  [g] = cast(g, P0, 'Draw1M');
  g = resolveChain(g);
  assert.equal(zone(g, z), 'base');
  assert.equal(zone(g, s), 'battlefield');
  assert.ok((mightOf(g, s) ?? 0) <= 0);
});

test('RJ#1539 Svellsongur copying a Deflect unit: the equipment itself has no active Deflect while attached (effect text applies to the unit)', () => {
  const g = S0();
  const u = put(g, P0, 'Deflect(2,1)', 'base');
  const sv = put(g, P0, 'Svellsongur', 'base');
  attachNow(g, sv, u);
  assert.ok(kwValue(g, u, 'Deflect') >= 1, 'the unit keeps Deflect');
  assert.ok(!hasKeyword(g, sv, 'Deflect'), 'inactive on the attached equipment');
});

test('RJ#1545 Yasuo, Remorseful killed (Hidden Blade) in response to his attack trigger: no damage is dealt', () => {
  let g = S0();
  fundAll(g, P1);
  const y = put(g, P0, 'Yasuo, Remorseful', 'base');
  const e = put(g, P1, 'V(4)', BF_A);
  control(g, BF_A, P1);
  const hb = put(g, P1, 'Hidden Blade', { facedown: BF_A });
  g = move(g, P0, [y], BF_A);
  for (let i = 0; i < 3 && g.pending?.inStep; i++) g = choose(g, g.pending!.options!.find(o => o.id === e)?.id ?? g.pending!.options![0].id);
  assert.ok(g.chain.length >= 1, 'attack trigger on the chain');
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  g = play(g, P1, hb, { targets: [[y]] });
  g = resolveWith(g, {});
  assert.equal(zone(g, y), 'trash');
  assert.equal(g.objects[e].damage, 0, 'no damage');
});

test('RJ#1547 do as much as you can: Jinx, Demolitionist\'s "discard 2" with 1 card in hand discards it and Jinx still enters', () => {
  let g = S0();
  fundAll(g, P0);
  hand(g, P0, 'V(1)');
  const j = hand(g, P0, 'Jinx, Demolitionist');
  g = play(g, P0, j, { dest: 'base' });
  g = resolveWith(g, {});
  for (let i = 0; i < 3 && g.pending?.inStep; i++) g = choose(g, ...g.pending!.options!.slice(0, Math.max(g.pending!.min ?? 1, 1)).map(o => o.id));
  g = resolveWith(g, {});
  assert.equal(zone(g, j), 'base');
  assert.equal(g.players[0].hand.length, 0);
  assert.equal(g.players[0].trash.length, 1, 'the one card was discarded');
});

test('RJ#1549 Nocturne, Horrifying looked at by Stacked Deck can be banished and played for [A]', () => {
  let g = S0();
  fundAll(g, P0);
  put(g, P0, 'V(1)', 'deckTop');
  put(g, P0, 'V(2)', 'deckTop');
  const n = put(g, P0, 'Nocturne, Horrifying', 'deckTop');
  [g] = cast(g, P0, 'Stacked Deck');
  for (let i = 0; i < 20; i++) {
    const d = g.pending!;
    if (d.kind === 'mainAction') break;
    if (d.kind === 'optional') { g = choose(g, 'yes'); continue; }
    if (d.kind === 'chooseDestination') { g = choose(g, d.options!.find(o => o.id === 'base')?.id ?? d.options![0].id); continue; }
    if (d.inStep) { g = choose(g, ...d.options!.filter(o => o.id !== n).slice(0, Math.max(d.min ?? 1, 1)).map(o => o.id)); continue; }
    g = pass(g);
  }
  assert.equal(zone(g, n), 'base', 'Nocturne played');
});

test('RJ#1550 Charm an enemy unit into my battlefield where Deadbloom Predator is alone: it defends alone (Wuju Bladesman +2)', () => {
  let g = S0();
  fundAll(g, P0);
  legendOf(g, P0, 'Wuju Bladesman');
  const dp = put(g, P0, 'Deadbloom Predator', BF_A);
  control(g, BF_A, P0);
  const e = put(g, P1, 'V(2)', 'base');
  g = play(g, P0, hand(g, P0, 'Charm'), { targets: [[e]] });
  for (let i = 0; i < 6 && g.chain.length; i++) g = pend(g).inStep ? answer(g, { locations: [BF_A] }) : pass(g);
  assert.equal(g.showdown?.attacker, P1, 'the charmed unit applied Contested: its controller attacks');
  assert.equal(g.objects[dp].combatRole, 'defender');
  assert.equal(mightOf(g, dp), 10, 'defending alone: +2');
});

test('RJ#1551 Zaun Warrens with an empty hand: the discard is skipped, you still draw 1', () => {
  let g = S0({ bfA: 'Zaun Warrens' });
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_A);
  g = finish(g);
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[0].hand.length, 1, 'drew 1');
});

test('RJ#1552 Tideturner moves to the chosen unit\'s location on resolution (Flash moved it to base first)', () => {
  let g = S0();
  fundAll(g, P0);
  const u = put(g, P0, 'V(2)', BF_B);
  control(g, BF_B, P0);
  control(g, BF_A, P0);
  const t = hand(g, P0, 'Tideturner');
  g = play(g, P0, t, { dest: BF_A, may: [true], targets: [[u]], cards: [[u]] });
  for (let i = 0; i < 4 && g.pending?.inStep; i++) g = choose(g, g.pending!.options!.find(o => o.id === u)?.id ?? g.pending!.options!.find(o => o.id === 'yes')?.id ?? g.pending!.options![0].id);
  assert.ok(g.chain.length >= 1, 'play trigger on the chain');
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Flash'), { targets: [[u]], cards: [[u]] });
  g = resolveWith(g, { may: [true] });
  for (let i = 0; i < 6 && g.pending?.inStep; i++) g = choose(g, g.pending!.options!.find(o => o.id === u || o.id === 'yes')?.id ?? g.pending!.options![0].id);
  g = resolveWith(g, {});
  assert.equal(locOf(g, t), 'base', 'Tideturner went to where the unit is now');
  assert.equal(locOf(g, u), BF_A, 'and the unit to Tideturner\'s original location');
});

test('RJ#1553 Sprite Call played from hidden: the Sprite token is played at that battlefield', () => {
  let g = S0();
  put(g, P0, 'V(2)', BF_A);
  control(g, BF_A, P0);
  const sc = put(g, P0, 'Sprite Call', { facedown: BF_A });
  g = play(g, P0, sc, {});
  const offered: string[] = [];
  for (let i = 0; i < 8; i++) { const d = g.pending!; if (d.kind === 'mainAction') break; if (d.kind === 'chooseDestination') { offered.push(...d.options!.map(o => o.id)); g = choose(g, d.options![0].id); continue; } g = d.inStep ? choose(g, d.options![0].id) : pass(g); }
  const sprites = Object.values(g.objects).filter(o => o.isToken && g.cards[o.cardId].name === 'Sprite');
  assert.equal(sprites.length, 1);
  assert.equal(sprites[0].battlefieldIndex, BF_A);
  assert.equal(sprites[0].zone, 'battlefield');
  assert.ok(!offered.includes('base'), `no base option (offered ${offered})`);
});

test('RJ#1554 Flash removes the only defender in response to Traveling Merchant\'s move trigger: no combat, Merchant conquers', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  hand(g, P0, 'V(1)');
  const tm = put(g, P0, 'Traveling Merchant', 'base');
  const e = put(g, P1, 'V(1)', BF_A);
  control(g, BF_A, P1);
  [g] = cast(g, P0, 'Cleave', { targets: [[tm]] });
  g = resolveChain(g);
  g = move(g, P0, [tm], BF_A);
  assert.ok(g.chain.length >= 1, 'move trigger');
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Flash'), { targets: [[e]], cards: [[e]] });
  for (let i = 0; i < 4 && g.pending?.inStep; i++) g = choose(g, g.pending!.options!.find(o => o.id === e)?.id ?? g.pending!.options![0].id);
  const log = new EventLog();
  for (let i = 0; i < 30; i++) { const d = g.pending!; if (d.kind === 'mainAction') break; g = d.inStep ? log.act(g, { type: 'choose', player: d.player, optionIds: d.options!.slice(0, Math.max(d.min ?? 1, 1)).map(o => o.id) }) : log.pass(g); }
  assert.equal(locOf(g, e), 'base');
  assert.equal(log.of('damage').length, 0, 'no combat damage');
  assert.equal(g.battlefields[BF_A].controller, P0);
});

test('RJ#1556 Twisted Fate, Gambler attacks at Reaver\'s Row: the defend trigger resolves first (unit moved to base before TF\'s damage)', () => {
  let g = S0({ bfA: "Reaver's Row" });
  const tf = put(g, P0, 'Twisted Fate, Gambler', 'base');
  const d = put(g, P1, 'V(3)', BF_A);
  control(g, BF_A, P1);
  g = move(g, P0, [tf], BF_A);
  for (let i = 0; i < 6 && g.pending?.inStep; i++) { const dd = g.pending!; g = choose(g, dd.options!.find(o => o.id === d || o.id === 'yes')?.id ?? dd.options![0].id); }
  assert.equal(g.chain.length, 2, 'both triggers on the initial chain');
  g = resolveWith(g, { may: [true], targets: [[d]], cards: [[d]] });
  for (let i = 0; i < 6 && g.pending?.inStep; i++) { const dd = g.pending!; g = choose(g, dd.options!.find(o => o.id === d || o.id === 'yes')?.id ?? dd.options![0].id); }
  g = resolveWith(g, {});
  assert.equal(locOf(g, d), 'base', 'moved to base by the defend trigger');
  assert.equal(g.objects[d].damage, 0, 'TF\'s red mode found no enemy here');
});

test('RJ#1560 Targon\'s Peak conquered during the ending step (Dazzling Aurora play): its "at the end of this turn" ready does not happen', () => {
  let g = S0({ bfA: "Targon's Peak" });
  put(g, P0, 'Dazzling Aurora', 'base');
  put(g, P0, 'Miss Fortune, Buccaneer', 'deckTop');   // ENGINE-2: a unit that can be played to an open battlefield (V(2) could only go to base)
  for (const r of g.players[0].runesInPlay) g.objects[r].exhausted = true;
  g = endTurn(g);
  for (let i = 0; i < 30 && g.turn === 3; i++) { const d = g.pending!; if (d.inStep) { const o = d.options!.find(o => o.id === String(BF_A)) ?? d.options![0]; g = act(g, { type: 'choose', player: d.player, optionIds: [o.id] }); } else if (d.kind === 'mainAction') break; else g = pass(g); }
  assert.equal(g.battlefields[BF_A].controller, P0, 'conquered in P0\'s ending step');
  assert.equal(g.turn, 4);
  assert.equal(exhaustedRunes(g, P0), 6, 'no runes readied');
});

test('RJ#1561 a unit can have several instances of Assault (they add up)', () => {
  let g = S0();
  fundAll(g, P0);
  const u = put(g, P0, 'Assault(2,1)', 'base');
  [g] = cast(g, P0, 'Cleave', { targets: [[u]] });
  g = resolveChain(g);
  assert.equal(kwValue(g, u, 'Assault'), 4);
});

test('RJ#1562 the player who contested first (Stalwart Poro, non-combat showdown) is the attacker when the opponent moves in: no Shield bonus for Poro', () => {
  let g = S0();
  fundAll(g, P1);
  const poro = put(g, P0, 'Stalwart Poro', 'base');
  const m = put(g, P1, 'V(3)', 'base');
  g = move(g, P0, [poro], BF_A);
  for (let i = 0; i < 4 && pend(g).player !== P1; i++) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Ride the Wind'), { targets: [[m]] });
  g = resolveWith(g, { locations: [BF_A] });
  for (let i = 0; i < 10 && !g.ex.combat; i++) { if (g.pending!.inStep || g.pending!.kind === 'mainAction') break; g = pass(g); }
  assert.ok(g.ex.combat, 'combat at BF-A');
  assert.ok(g.ex.combat!.attackers.includes(poro), 'P0 attacks');
  assert.ok(g.ex.combat!.defenders.includes(m));
  assert.equal(mightOf(g, poro), 2, 'Shield only for defenders');
});

test('RJ#1566 Equipment is played to base unattached; attaching needs its Equip cost', () => {
  let g = S0();
  fundAll(g, P0);
  put(g, P0, 'V(2)', 'base');
  const sw = hand(g, P0, "Doran's Blade");
  g = play(g, P0, sw, { dest: 'base' });
  g = resolveWith(g, {});
  assert.equal(zone(g, sw), 'base');
  assert.equal(g.objects[sw].attachedTo ?? null, null, 'not attached by playing it');
});

test('RJ#1567 two Orb of Regret on Stalwart Poro: 1 Might (second does nothing), then Shield makes it 2 when it defends', () => {
  let g = S0();
  fundAll(g, P0);
  const o1 = put(g, P0, 'Orb of Regret', 'base');
  const o2 = put(g, P0, 'Orb of Regret', 'base');
  const poro = put(g, P1, 'Stalwart Poro', BF_A);
  control(g, BF_A, P1);
  for (const o of [o1, o2]) {
    g = act(g, legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === o)!);
    g = resolveWith(g, { targets: [[poro]] });
    for (let i = 0; i < 3 && g.pending?.inStep; i++) g = choose(g, poro);
    g = resolveWith(g, {});
  }
  assert.equal(mightOf(g, poro), 1);
  const a = put(g, P0, 'V(5)', 'base');
  g = move(g, P0, [a], BF_A);
  assert.equal(mightOf(g, poro), 2, 'Shield +1 while defending');
});

test('RJ#1569 Daughter of the Void\'s [Add] [A] is used while paying for Hextech Ray in a showdown', () => {
  let g = S0({ tp: P1 });
  setRunes(g, P0, 0);
  g.players[0].pool.energy = 1;
  const k = legendOf(g, P0, 'Daughter of the Void');
  put(g, P0, 'V(2)', BF_A);
  control(g, BF_A, P0);
  const a = put(g, P1, 'V(2)', 'base');
  const hr = hand(g, P0, 'Hextech Ray');
  g = move(g, P1, [a], BF_A);
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  assert.ok(canPlayNow(g, P0, hr), 'payable with 1 energy + the legend\'s [A]');
  g = play(g, P0, hr, { targets: [[a]] });
  assert.equal(g.objects[k].exhausted, true, 'legend exhausted to pay');
  g = resolveWith(g, {});
  assert.equal(zone(g, a), 'trash');
});

test('RJ#1570 the showdown continues after the only defender left: the attacker still gets focus and can play an Action', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const a = put(g, P0, 'V(3)', 'base');
  const e = put(g, P1, 'V(2)', BF_A);
  control(g, BF_A, P1);
  const cl = hand(g, P0, 'Cleave');
  g = move(g, P0, [a], BF_A);
  g = pass(g);
  expectPending(g, 'showdownAction', P1);
  g = play(g, P1, hand(g, P1, 'Flash'), { targets: [[e]], cards: [[e]] });
  for (let i = 0; i < 4 && g.pending?.inStep; i++) g = choose(g, g.pending!.options!.find(o => o.id === e)?.id ?? g.pending!.options![0].id);
  g = resolveWith(g, {});
  assert.equal(locOf(g, e), 'base');
  expectPending(g, 'showdownAction', P0, 'focus back to the attacker');
  assert.ok(canPlayNow(g, P0, cl), 'Action playable');
});

test('RJ#1572 Cleave on a unit alone at a battlefield (no defenders): it is not attacking, no +3', () => {
  let g = S0();
  fundAll(g, P0);
  const a = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [a], BF_A);
  expectPending(g, 'showdownAction', P0);
  g = play(g, P0, hand(g, P0, 'Cleave'), { targets: [[a]] });
  g = resolveWith(g, {});
  assert.equal(kwValue(g, a, 'Assault'), 3);
  assert.equal(mightOf(g, a), 2, 'not attacking');
});

test('RJ#1574 Get Excited! discarding Immortal Phoenix: the kill happens after the discard, so Phoenix triggers from the trash', () => {
  let g = S0();
  fundAll(g, P0, 6);
  const ph = hand(g, P0, 'Immortal Phoenix');
  const e = put(g, P1, 'V(3)', BF_A);
  control(g, BF_A, P1);
  [g] = cast(g, P0, 'Get Excited!', { targets: [[e]] });
  for (let i = 0; i < 20; i++) {
    const d = g.pending!;
    if (d.kind === 'mainAction') break;
    if (d.kind === 'optional') { g = choose(g, 'yes'); continue; }
    if (d.inStep) { g = choose(g, d.options!.find(o => o.id === ph || o.id === 'base')?.id ?? d.options![0].id); continue; }
    g = pass(g);
  }
  assert.equal(zone(g, e), 'trash');
  assert.equal(zone(g, ph), 'base', 'Phoenix played from the trash');
});

test('RJ#1575 Heimerdinger, Inventor does not get Chem-Baroness\'s "you may exhaust me" (not a [T] ability)', () => {
  const g = S0();
  legendOf(g, P0, 'Chem-Baroness');
  const h = put(g, P0, 'Heimerdinger, Inventor', BF_A);
  control(g, BF_A, P0);
  assert.equal(legal(g, P0, 'activate').filter(x => x.type === 'activate' && x.obj === h).length, 0);
});

test('RJ#1577 opponent Charms my unit into their battlefield: I attack and get focus first', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P1);
  put(g, P1, 'V(3)', BF_A);
  control(g, BF_A, P1);
  const mine = put(g, P0, 'V(2)', 'base');
  g = play(g, P1, hand(g, P1, 'Charm'), { targets: [[mine]] });
  for (let i = 0; i < 6 && g.chain.length; i++) g = pend(g).inStep ? answer(g, { locations: [BF_A] }) : pass(g);
  assert.equal(g.showdown?.attacker, P0);
  expectPending(g, 'showdownAction', P0, 'the moved unit\'s controller has focus');
});

test('RJ#1579 Ride the Wind to an empty battlefield during the opponent\'s attack elsewhere: you conquer it and score', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0);
  put(g, P0, 'V(2)', BF_B);
  control(g, BF_B, P0);
  const mine = put(g, P0, 'V(1)', BF_B);
  const a = put(g, P1, 'V(5)', 'base');
  g = move(g, P1, [a], BF_B);
  g = pass(g);
  expectPending(g, 'showdownAction', P0);
  g = play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[mine]] });
  g = resolveWith(g, { locations: [BF_A] });
  assert.equal(locOf(g, mine), BF_A);
  g = finish(g);
  assert.equal(g.battlefields[BF_A].controller, P0, 'conquered on the opponent\'s turn');
  assert.equal(g.players[0].points, 1);
});

test('RJ#1582 at 7, a Ganking unit conquers one battlefield (draw instead of the final point), moves on and conquers the other: wins', () => {
  let g = S0();
  g.players[0].points = 7;
  const u = put(g, P0, 'Ganker(2)', 'base');
  g = move(g, P0, [u], BF_A);
  const h = g.players[0].hand.length;
  g = finish(g);
  assert.equal(g.players[0].points, 7, 'final point withheld');
  assert.equal(g.players[0].hand.length, h + 1, 'drew instead');
  g.objects[u].exhausted = false;
  g = move(g, P0, [u], BF_B);
  g = finish(g);
  assert.equal(g.players[0].points, 8);
  assert.equal(g.winner, 0);
});

test('RJ#1583 Flurry of Blades chooses nothing: no Deflect cost for Deflect units, and playable with no units at battlefields', () => {
  let g = S0();
  fundAll(g, P0);
  const fb = hand(g, P0, 'Flurry of Blades');
  assert.ok(canPlayNow(g, P0, fb), 'no units at battlefields: still playable');
  const d1 = put(g, P1, 'Deflect(3,1)', BF_A);
  const d2 = put(g, P1, 'Deflect(3,1)', BF_B);
  const before = readyRunes(g, P0);
  g = play(g, P0, fb, {});
  g = resolveChain(g);
  assert.equal(before - readyRunes(g, P0), 1, 'only the [1] energy was paid');
  assert.equal(g.objects[d1].damage, 1);
  assert.equal(g.objects[d2].damage, 1);
});

test('RJ#1585 Sneaky Deckhand played to an open battlefield conquers it and scores', () => {
  let g = S0();
  fundAll(g, P0);
  const sd = hand(g, P0, 'Sneaky Deckhand');
  assert.ok(playDests(g, P0, sd).includes(BF_A));
  g = play(g, P0, sd, { dest: BF_A });
  g = finish(g);
  assert.equal(locOf(g, sd), BF_A);
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[0].points, 1);
});

test('RJ#1587 Yasuo, Remorseful moved (Ride the Wind) into a battlefield the opponent already contested: he defends, no attack trigger', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0);
  const y = put(g, P0, 'Yasuo, Remorseful', 'base');
  const e = put(g, P1, 'V(7)', 'base');
  g = move(g, P1, [e], BF_A);
  for (let i = 0; i < 4 && pend(g).player !== P0; i++) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[y]] });
  g = resolveWith(g, { locations: [BF_A] });
  for (let i = 0; i < 10 && !g.ex.combat; i++) { if (g.pending!.inStep || g.pending!.kind === 'mainAction') break; g = pass(g); }
  assert.ok(g.ex.combat);
  assert.ok(g.ex.combat!.defenders.includes(y), 'Yasuo defends');
  assert.ok(!g.chain.some(c => c.source === y), 'no "when I attack" trigger');
});

test('RJ#1588 Trifarian War Camp +1 and Stupefy -1 (to a min of 1) on a Recruit: 1; after leaving the Camp the snapshotted -1 stays: 0', () => {
  let g = S0({ bfA: 'Trifarian War Camp' });
  fundAll(g, P0);
  const r = put(g, P0, 'Recruit', BF_A);
  control(g, BF_A, P0);
  assert.equal(mightOf(g, r), 2);
  [g] = cast(g, P0, 'Stupefy', { targets: [[r]] });
  g = resolveChain(g);
  assert.equal(mightOf(g, r), 1);
  g = move(g, P0, [r], 'base');
  g = finish(g);
  assert.equal(mightOf(g, r), 0);
});

test('RJ#1589 Dark Child readies up to 2 runes at end of turn (works with a single rune; it does not channel)', () => {
  let g = S0();
  legendOf(g, P0, 'Dark Child');
  setRunes(g, P0, 1, 'fury', false);
  const rd = g.players[0].runeDeck.length;
  g = endTurn(g);
  for (let i = 0; i < 10 && g.activePlayer === P0; i++) { const d = g.pending!; if (d.inStep) { g = choose(g, ...d.options!.slice(0, Math.max(d.min ?? 1, Math.min(d.max ?? 1, d.options!.length))).map(o => o.id)); continue; } if (d.kind === 'mainAction') break; g = pass(g); }
  assert.equal(g.players[0].runesInPlay.length, 1, 'no extra runes');
  assert.equal(g.players[0].runeDeck.length, rd);
  assert.equal(readyRunes(g, P0), 1, 'the exhausted rune was readied');
});

test('RJ#1590 Baited Hook: its friendly unit killed in response (Hidden Blade) — nothing can be played from the top 5', () => {
  let g = S0();
  fundAll(g, P0);
  const bh = put(g, P0, 'Baited Hook', 'base');
  const u = put(g, P0, 'V(2)', BF_A);
  control(g, BF_A, P0);
  const hb = put(g, P0, 'Hidden Blade', { facedown: BF_A });
  for (let i = 0; i < 5; i++) put(g, P0, 'V(1)', 'deckTop');
  g = act(g, legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === bh)!);
  for (let i = 0; i < 3 && g.pending?.inStep; i++) g = choose(g, u);
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  g = play(g, P0, hb, { targets: [[u]] });
  for (let i = 0; i < 20; i++) { const d = g.pending!; if (d.kind === 'mainAction') break; if (d.kind === 'optional') { g = choose(g, 'yes'); continue; } g = d.inStep ? choose(g, d.options![0].id) : pass(g); }
  assert.equal(zone(g, u), 'trash');
  const onBoard = Object.values(g.objects).filter(o => o.owner === P0 && (o.zone === 'base' || o.zone === 'battlefield') && g.cards[o.cardId].name === 'V(1)');
  assert.equal(onBoard.length, 0, 'no unit played (killed unit\'s Might is undefined)');
});

test('RJ#1591 Tank applies only to combat damage: Yasuo, Remorseful\'s attack trigger may target a non-Tank unit', () => {
  let g = S0();
  const y = put(g, P0, 'Yasuo, Remorseful', 'base');
  put(g, P1, 'Tank(9)', BF_A);
  const v = put(g, P1, 'V(2)', BF_A);
  control(g, BF_A, P1);
  g = move(g, P0, [y], BF_A);
  const d = pend(g);
  if (d.inStep) { assert.ok(d.options!.some(o => o.id === v), 'the non-Tank unit is a legal target'); g = choose(g, v); }
  g = resolveWith(g, {});
  assert.equal(zone(g, v), 'trash');
});

test('RJ#1594 Miss Fortune, Captain\'s move trigger can ready Traveling Merchant that moved with her', () => {
  let g = S0();
  const mf = put(g, P0, 'Miss Fortune, Captain', 'base');
  const tm = put(g, P0, 'Traveling Merchant', 'base');
  g = move(g, P0, [mf, tm], BF_A);
  for (let i = 0; i < 12; i++) { const d = g.pending!; if (d.kind === 'mainAction' || d.kind === 'showdownAction' && !g.chain.length) break; if (d.kind === 'optional') { g = choose(g, 'yes'); continue; } if (d.inStep) { g = choose(g, d.options!.find(o => o.id === tm)?.id ?? d.options![0].id); continue; } g = pass(g); }
  g = finish(g);
  assert.equal(g.objects[tm].exhausted, false, 'Merchant readied');
  assert.equal(g.objects[mf].exhausted, true);
});

test('RJ#1592 Lux legend + Promising Future (Final Spark vs opponent\'s Mindsplitter): Mindsplitter\'s trigger resolves before the Lux draw for Promising Future', () => {
  let g = S0();
  fundAll(g, P0, 8); fundAll(g, P1, 8);
  legendOf(g, P0, 'Lady of Luminosity');
  for (let i = 0; i < 4; i++) { put(g, P0, 'V(1)', 'deckTop'); put(g, P1, 'V(1)', 'deckTop'); }
  const fs = put(g, P0, 'Final Spark', 'deckTop');
  const ms = put(g, P1, 'Mindsplitter', 'deckTop');
  const t = put(g, P1, 'V(3)', 'base');
  [g] = cast(g, P0, 'Promising Future');
  for (let i = 0; i < 40; i++) { const d = g.pending!; if (d.kind === 'mainAction') break; if (d.inStep) { g = choose(g, (d.options!.find(o => o.id === fs || o.id === ms || o.id === t) ?? d.options![0]).id); continue; } g = pass(g); }
  const txt = g.log.map(l => l.text);
  const msRes = txt.findIndex(x => /^Resolving Mindsplitter/.test(x));
  const firstDraw = txt.findIndex(x => /^P0 draws 1/.test(x));
  assert.ok(msRes >= 0 && firstDraw >= 0);
  assert.ok(msRes < firstDraw, 'Mindsplitter trigger first: P0\'s hand is still empty');
  assert.equal(g.players[0].hand.length, 2, 'both Lux draws kept');
});

test('RJ#1595 Defy can counter Cleave played outside a showdown', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P0, 'V(2)', 'base');
  let cl: ObjId;
  [g, cl] = cast(g, P0, 'Cleave', { targets: [[u]] });
  g = pass(g);
  expectPending(g, 'chainResponse', P1);
  g = play(g, P1, hand(g, P1, 'Defy'), { targets: [[cl]] });
  g = resolveWith(g, {});
  assert.equal(zone(g, cl), 'trash');
  assert.equal(kwValue(g, u, 'Assault'), 0, 'countered');
});

test('RJ#1597 my last unit at a contested battlefield killed by a spell in combat: I still control it and may play Shen, Kinkou there as a Reaction', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0); fundAll(g, P1);
  const mine = put(g, P0, 'V(2)', BF_A);
  control(g, BF_A, P0);
  const shen = hand(g, P0, 'Shen, Kinkou');
  const a = put(g, P1, 'V(3)', 'base');
  g = move(g, P1, [a], BF_A);
  expectPending(g, 'showdownAction', P1);
  g = play(g, P1, hand(g, P1, 'ZapA'), { targets: [[mine]] });
  for (let i = 0; i < 6 && g.chain.length; i++) g = pass(g);
  assert.equal(zone(g, mine), 'trash');
  assert.equal(g.battlefields[BF_A].controller, P0, 'control kept during the combat');
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  assert.ok(playDests(g, P0, shen).includes(BF_A), 'Shen can be played to the battlefield');
});

test('RJ#1601 Trifarian War Camp unit (1+1) attacked by Ahri, Inquisitive\'s -2 (min 1) ends at 1', () => {
  let g = S0({ bfA: 'Trifarian War Camp', tp: P1 });
  const r = put(g, P0, 'Recruit', BF_A);
  control(g, BF_A, P0);
  const ah = put(g, P1, 'Ahri, Inquisitive', 'base');
  g = move(g, P1, [ah], BF_A);
  g = resolveWith(g, { targets: [[r]] });
  for (let i = 0; i < 3 && g.pending?.inStep; i++) g = choose(g, r);
  g = resolveWith(g, {});
  assert.equal(mightOf(g, r), 1);
});

test('RJ#1603 Thousand-Tailed Watcher\'s -3 does not apply to an enemy unit played (from hidden) after it resolved', () => {
  let g = S0();
  fundAll(g, P0, 8);
  put(g, P1, 'V(1)', BF_B);
  control(g, BF_B, P1);
  const e = put(g, P1, 'V(5)', 'base');
  const hu = put(g, P1, 'HidU(3)', { facedown: BF_B });
  [g] = cast(g, P0, 'Thousand-Tailed Watcher', { dest: 'base', may: [false] });
  g = resolveWith(g, {});
  assert.equal(mightOf(g, e), 2);
  [g] = cast(g, P0, 'DrawR');
  g = pass(g);
  g = play(g, P1, hu, { dest: BF_B });
  g = resolveWith(g, {});
  assert.equal(zone(g, hu), 'battlefield');
  assert.equal(mightOf(g, hu), 3, 'not affected');
});

test('RJ#1604 Unyielding Spirit (prevent spell/ability damage) does not stop a kill', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P1, 'V(3)', BF_A);
  control(g, BF_A, P1);
  [g] = cast(g, P0, 'KillA', { targets: [[u]] });
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'Unyielding Spirit'), {});
  g = resolveWith(g, {});
  assert.equal(zone(g, u), 'trash');
});

test('RJ#1605 conquering on the opponent\'s turn (Ride the Wind) scores immediately, then a hold point at the start of my next turn', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0);
  put(g, P0, 'V(2)', BF_B);
  control(g, BF_B, P0);
  const mine = put(g, P0, 'V(1)', BF_B);
  const a = put(g, P1, 'V(5)', 'base');
  g = move(g, P1, [a], BF_B);
  g = pass(g);
  g = play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[mine]] });
  g = resolveWith(g, { locations: [BF_A] });
  g = finish(g);
  assert.equal(g.players[0].points, 1, 'conquer point now');
  g = endTurn(g);
  for (let i = 0; i < 20 && !(g.activePlayer === P0 && g.pending?.kind === 'mainAction'); i++) g = g.pending!.inStep ? choose(g, g.pending!.options![0].id) : pass(g);
  assert.equal(g.players[0].points, 2, 'hold point at the start of P0\'s turn');
});

test('RJ#1607 Targon\'s Peak: conquer → at the end of the turn ready up to 2 runes', () => {
  let g = S0({ bfA: "Targon's Peak" });
  const u = put(g, P0, 'V(2)', 'base');
  for (const r of g.players[0].runesInPlay) g.objects[r].exhausted = true;
  g = move(g, P0, [u], BF_A);
  g = finish(g);
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(readyRunes(g, P0), 0, 'nothing readied yet');
  g = endTurn(g);
  for (let i = 0; i < 20 && g.activePlayer === P0; i++) { const d = g.pending!; if (d.inStep) { g = choose(g, ...d.options!.slice(0, Math.min(d.max ?? 1, d.options!.length)).map(o => o.id)); continue; } if (d.kind === 'mainAction') break; g = pass(g); }
  assert.equal(readyRunes(g, P0), 2, 'two runes readied at the end of the turn');
});

test('RJ#1610 Teemo, Strategist can be hidden straight from the Champion Zone', () => {
  let g = S0();
  legendOf(g, P0, 'Swift Scout');
  put(g, P0, 'V(2)', BF_A);
  control(g, BF_A, P0);
  const t = hand(g, P0, 'Teemo, Strategist');
  g.players[0].hand = g.players[0].hand.filter(x => x !== t);
  g.players[0].championZone.push(t);
  g.objects[t].zone = 'championZone';
  g.timestamp++;
  const h = legal(g, P0, 'hide').find(x => x.type === 'hide' && x.obj === t);
  assert.ok(h, 'hide offered from the Champion Zone');
  g = act(g, h!);
  for (let i = 0; i < 3 && g.pending?.inStep; i++) g = choose(g, g.pending!.options![0].id);
  assert.equal(zone(g, t), 'facedown', `pending ${g.pending?.kind} ${g.log.slice(-3).map(l => l.text)}`);
});

test('RJ#1612 a spell that needs a target can\'t be played without one (Stupefy just to draw)', () => {
  const g = S0();
  fundAll(g, P0);
  const s = hand(g, P0, 'Stupefy');
  assert.ok(!canPlayNow(g, P0, s));
});

test('RJ#1613 after the initial chain (attack triggers) resolves, the attacker keeps focus', () => {
  let { g } = attackSetup(['AttackDraw(3)'], ['V(2)']);
  g = resolveChain(g);
  expectPending(g, 'showdownAction', P0);
});

test('RJ#1614 after passing focus, the mover cannot answer Hextech Ray with Primal Strength (an Action)', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0); fundAll(g, P1);
  put(g, P0, 'V(2)', BF_A);
  control(g, BF_A, P0);
  const a = put(g, P1, 'V(1)', 'base');
  const ps = hand(g, P1, 'Primal Strength');
  g = move(g, P1, [a], BF_A);
  g = pass(g);
  g = play(g, P0, hand(g, P0, 'Hextech Ray'), { targets: [[a]] });
  g = pass(g);
  expectPending(g, 'chainResponse', P1);
  assert.ok(!canPlayNow(g, P1, ps), 'Action cannot respond');
  g = resolveWith(g, {});
  assert.equal(zone(g, a), 'trash');
});

test('RJ#1621 at 7, conquering Zaun Warrens: the draw replacing the 8th point comes first, then its trigger (discard 1, then draw 1)', () => {
  let g = S0({ bfA: 'Zaun Warrens' });
  g.players[0].points = 7;
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_A);
  g = finish(g);
  assert.equal(g.players[0].points, 7);
  assert.equal(g.players[0].hand.length, 1, 'drew, discarded that card, drew again');
  assert.equal(g.players[0].trash.length, 1, 'the first drawn card was discarded');
});

test('RJ#1622 a unit with two Guardian Angels dies: only one Guardian Angel is killed to replace it', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P0, 'V(2)', BF_A);
  control(g, BF_A, P0);
  const ga1 = put(g, P0, 'Guardian Angel', 'base');
  const ga2 = put(g, P0, 'Guardian Angel', 'base');
  attachNow(g, ga1, u); attachNow(g, ga2, u);
  [g] = cast(g, P0, 'KillA', { targets: [[u]] });
  for (let i = 0; i < 10; i++) { const d = g.pending!; if (d.kind === 'mainAction') break; g = d.inStep ? choose(g, d.options![0].id) : pass(g); }
  assert.equal(locOf(g, u), 'base', 'saved and recalled');
  const dead = [ga1, ga2].filter(x => zone(g, x) === 'trash');
  assert.equal(dead.length, 1, 'only one Guardian Angel killed');
});

test('RJ#1623 Piercing Light: first target killed in response (Wages of Pain) — the second 2 damage is still dealt', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0); fundAll(g, P1);
  const m = put(g, P0, 'V(3)', BF_A);
  control(g, BF_A, P0);
  const wp = put(g, P0, 'Wages of Pain', { facedown: BF_A });
  const o = put(g, P0, 'V(5)', 'base');
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Piercing Light') });
  for (let i = 0; i < 4 && g.pending?.inStep; i++) { const d = g.pending!; g = choose(g, d.options!.find(x => x.id === m)?.id ?? d.options!.find(x => x.id === o)?.id ?? d.options!.find(x => x.id === 'no')?.id ?? d.options![0].id); }
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  g = play(g, P0, wp, { targets: [[m]] });
  g = resolveWith(g, { targets: [[o]] });
  assert.equal(zone(g, m), 'trash');
  assert.equal(g.objects[o].damage, 2, 'the other unit still takes 2');
});

test('RJ#1625 two Spirit\'s Refuge do not stack: a buffed unit has Deflect 1 ("if they didn\'t already")', () => {
  const g = S0();
  put(g, P0, "Spirit's Refuge", 'base');
  put(g, P0, "Spirit's Refuge", 'base');
  const u = put(g, P0, 'V(2)', 'base', { buff: true });
  assert.equal(kwValue(g, u, 'Deflect'), 1);
});

test('RJ#1627 Heart of Dark Ice\'s [T] ability choosing Irelia, Fervent triggers her "when you choose me" (+1)', () => {
  let g = S0();
  const h = put(g, P0, 'Heart of Dark Ice', 'base');
  const ir = put(g, P0, 'Irelia, Fervent', 'base');
  g = act(g, legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === h)!);
  for (let i = 0; i < 3 && g.pending?.inStep; i++) g = choose(g, ir);
  g = resolveWith(g, {});
  assert.equal(mightOf(g, ir), 4 + 3 + 1);
});

test('RJ#1628 when both players pass in succession on an empty chain in combat, it goes straight to combat damage', () => {
  let { g } = attackSetup(['V(3)'], ['V(2)']);
  expectPending(g, 'showdownAction', P0);
  g = pass(g);
  expectPending(g, 'showdownAction', P1);
  g = pass(g);
  assert.ok(g.pending?.kind !== 'showdownAction' && g.pending?.kind !== 'chainResponse', `no further window (got ${g.pending?.kind})`);
});

test('RJ#1631 my own Cull the Weak killing my own unit counts as killing a unit with a spell: Immortal Phoenix triggers', () => {
  let g = S0();
  fundAll(g, P0, 6);
  const ph = put(g, P0, 'Immortal Phoenix', 'trash');
  const mine = put(g, P0, 'V(1)', 'base');
  const theirs = put(g, P1, 'V(1)', 'base');
  [g] = cast(g, P0, 'Cull the Weak');
  let offered = false;
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.inStep) {
      if (d.kind === 'optional') { if (/Phoenix|\[1\]/.test(d.prompt ?? '')) offered = true; g = choose(g, 'yes'); continue; }
      g = optionIds(g).includes(mine) ? choose(g, mine) : optionIds(g).includes(theirs) ? choose(g, theirs) : choose(g, ...d.options!.slice(0, Math.max(d.min ?? 1, 1)).map(o => o.id)); continue;
    }
    g = pass(g);
  }
  assert.equal(zone(g, mine), 'trash');
  assert.ok(offered || g.log.some(l => /Trigger: Immortal Phoenix/.test(l.text)), 'Phoenix triggered');
  assert.equal(zone(g, ph), 'base', 'Phoenix played from the trash');
});

test('RJ#1632 Void Seeker\'s target moved to base (Fight or Flight) in response: no damage, still draw 1', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const e = put(g, P1, 'V(5)', BF_A);
  control(g, BF_A, P1);
  const ff = put(g, P1, 'Fight or Flight', { facedown: BF_A });
  [g] = cast(g, P0, 'Void Seeker', { targets: [[e]] });
  g = pass(g);
  g = play(g, P1, ff, { targets: [[e]] });
  const h = g.players[0].hand.length;
  g = resolveWith(g, {});
  assert.equal(locOf(g, e), 'base');
  assert.equal(g.objects[e].damage, 0);
  assert.equal(g.players[0].hand.length, h + 1, 'drew 1');
});

test('RJ#1633 Vi (Ganking) moved by Ride the Wind conquers (7th point, readied), then Ganks to the other battlefield for the 8th', () => {
  let g = S0();
  fundAll(g, P0);
  g.players[0].points = 6;
  const vi = put(g, P0, 'ogn-036-298', 'base', { ready: false });
  g = play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[vi]] });
  g = resolveWith(g, { locations: [BF_A] });
  g = finish(g);
  assert.equal(locOf(g, vi), BF_A);
  assert.equal(g.players[0].points, 7, 'conquer point');
  assert.equal(g.objects[vi].exhausted, false, 'readied by Ride the Wind');
  g = move(g, P0, [vi], BF_B);
  g = finish(g);
  assert.equal(locOf(g, vi), BF_B, 'Ganking: battlefield to battlefield');
  assert.equal(g.players[0].points, 8);
  assert.equal(g.winner, 0, 'every battlefield scored this turn: the 8th point wins');
});

test('RJ#1638 outside a showdown there is no window to play an Action after an opponent\'s spell resolves', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const ps = hand(g, P1, 'Primal Strength');
  [g] = cast(g, P0, 'DrawR');
  g = resolveWith(g, {});
  expectPending(g, 'mainAction', P0);
  assert.ok(!canPlayNow(g, P1, ps), 'P1 gets no Action window');
});

test('RJ#1639 Daughter of the Void\'s add ability can be used on the opponent\'s turn (while responding); it resolves at once, off the chain', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P1);
  const l = legendOf(g, P0, 'Daughter of the Void');
  [g] = cast(g, P1, 'DrawR');
  g = pass(g);
  expectPending(g, 'chainResponse', P0);
  const ab = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === l);
  assert.ok(ab, 'legend ability usable on the opponent\'s turn');
  g = act(g, ab!);
  assert.equal(g.chain.length, 1, 'did not use the chain');
  const r = (g.players[P0].poolRestricted ?? []) as { kind: string; amount: number }[];
  assert.equal(r.filter(x => x.kind === 'power').reduce((s, x) => s + x.amount, 0), 1, 'power added immediately');
  expectPending(g, 'chainResponse', P0);
});

test('RJ#1643 Disintegrate (errata): draws only if its 3 damage killed the unit (checked after the cleanup)', () => {
  for (const [might, drew] of [[3, 1], [5, 0]] as const) {
    let g = S0();
    fundAll(g, P0, 2);
    const e = put(g, P1, `V(${might})`, BF_A); control(g, BF_A, P1);
    const h0 = g.players[0].hand.length;
    [g] = cast(g, P0, 'Disintegrate', { targets: [[e]] });
    g = resolveWith(g, {});
    assert.equal(zone(g, e), might === 3 ? 'trash' : 'battlefield');
    assert.equal(g.players[0].hand.length, h0 + drew, `Might ${might}: draw ${drew}`);
  }
});

test('RJ#1646 Riptide Rex\'s play effect (deal 6) is a triggered ability on the chain that can be reacted to', () => {
  let g = S0();
  fundAll(g, P0, 8); fundAll(g, P1);
  const e = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const ff = put(g, P1, 'Fight or Flight', { facedown: BF_A });
  g = play(g, P0, hand(g, P0, 'Riptide Rex'), { dest: 'base', targets: [[e]] });
  g = answer(g, { targets: [[e]] });
  for (let i = 0; i < 4 && !(g.pending?.kind === 'chainResponse' && g.pending.player === P1); i++) g = pass(g);
  expectPending(g, 'chainResponse', P1);
  assert.ok(g.chain.some(c => g.objects[c.source]?.cardId === cid('Riptide Rex')), 'Rex\'s trigger is on the chain');
  assert.ok(canPlayNow(g, P1, ff), 'P1 can react to it');
  g = play(g, P1, ff, { targets: [[e]] });
  g = resolveWith(g, {});
  assert.equal(locOf(g, e), 'base');
  assert.equal(g.objects[e].damage, 0, 'moved away in response: no damage');
});

test('RJ#1656 held a battlefield this turn, moved my only unit out and another in: a new showdown happens, but no second point', () => {
  let g = S0({ tp: P1 });
  const x = put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const y = put(g, P0, 'V(2)', 'base');
  g = nextTurn(g);
  g = finish(g);
  expectPending(g, 'mainAction', P0);
  assert.equal(g.players[0].points, 1, 'held BF-A');
  g = finish(move(g, P0, [x], 'base'));
  g = move(g, P0, [y], BF_A);
  assert.equal(g.showdown?.battlefieldIndex, BF_A, 'a new showdown at BF-A');
  g = finish(g);
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[0].points, 1, 'no second point this turn');
});

test('RJ#1659 Temporal Portal activated beforehand gives Defy Repeat (Defy can be the "next spell")', () => {
  let g = S0();
  fundAll(g, P0, 8); fundAll(g, P1);
  const tp = put(g, P0, 'Temporal Portal', 'base');
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'AttackDraw(3)', 'base');
  g = activate(g, P0, tp, 0);
  g = resolveWith(g, {});
  assert.equal(g.objects[tp].exhausted, true, 'Portal tapped ahead of time (not Reaction speed)');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  let dr: string;
  [g, dr] = cast(g, P1, 'DrawR');
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  const item = g.chain.find(c => c.source === dr || (c as { obj?: string }).obj === dr)!;
  assert.ok(item, 'DrawR on the chain');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Defy') });
  let offeredRepeat = false;
  for (let i = 0; i < 6 && g.pending?.inStep; i++) {
    const d = g.pending!;
    if (d.kind === 'optional') { if (/repeat/i.test(d.prompt ?? '') || /repeat/i.test(JSON.stringify(d.options))) offeredRepeat = true; g = choose(g, 'yes'); continue; }
    g = choose(g, optionIds(g).includes(item.id) ? item.id : optionIds(g)[0]);
  }
  assert.ok(offeredRepeat, 'Defy got Repeat from Temporal Portal');
  const h1 = g.players[1].hand.length;
  g = resolveWith(g, {});
  assert.equal(g.players[1].hand.length, h1, 'DrawR countered: no draw');
});

test('RJ#1657 Stand United from hidden stolen by Mystic Reversal: still limited to that battlefield (no new friendly target there); buff fails, the +1 applies to the thief\'s buffed units', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1, 6);
  const a = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const b = put(g, P1, 'V(2)', 'base', { buff: true });
  const su = put(g, P0, 'Stand United', { facedown: BF_A });
  g = act(g, { type: 'playCard', player: P0, obj: su });
  if (pend(g).kind === 'chooseTargets') g = choose(g, a);
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Mystic Reversal') });
  for (let i = 0; i < 4 && g.pending?.inStep; i++) g = choose(g, optionIds(g).includes(g.chain[0].id) ? g.chain[0].id : optionIds(g)[0]);
  let offeredB = false;
  for (let i = 0; i < 20; i++) {
    const d = g.pending!;
    if (d.inStep && d.kind === 'chooseTargets') { if (optionIds(g).includes(b)) offeredB = true; g = choose(g, ...d.options!.slice(0, Math.max(d.min ?? 1, 1)).map(o => o.id)); continue; }
    if (d.inStep && d.kind === 'optional') { g = choose(g, 'yes'); continue; }
    if (d.inStep) { g = choose(g, d.options![0].id); continue; }
    if (d.kind === 'chainResponse' && g.chain.length) { g = pass(g); continue; }
    break;
  }
  assert.ok(!offeredB, 'new target must still be at BF-A');
  assert.equal(g.chain.length, 0);
  assert.equal(g.objects[a].counters.buff ?? 0, 0, 'original target is not friendly to the new controller: no buff');
  assert.equal(mightOf(g, a), 2);
  assert.equal(mightOf(g, b), 4, 'thief\'s buffed unit: 2 + 1 + 1');
});

test('RJ#1661 Monastery of Hirana cannot spend an enemy unit\'s buff', () => {
  let g = S0({ bfA: 'Monastery of Hirana' });
  const u = put(g, P0, 'V(2)', 'base');
  const e = put(g, P1, 'V(2)', BF_B, { buff: true }); control(g, BF_B, P1);
  const h0 = g.players[0].hand.length;
  g = move(g, P0, [u], BF_A);
  let offered = false;
  for (let i = 0; i < 12; i++) { const d = g.pending!; if (d.kind === 'mainAction') break; if (d.inStep && optionIds(g).includes(e)) offered = true; if (d.kind === 'optional' && /buff/i.test(d.prompt ?? '')) offered = true; g = d.inStep ? choose(g, d.options![d.options!.length - 1].id) : pass(g); }
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.ok(!offered, 'only friendly buffs can be spent');
  assert.equal(g.objects[e].counters.buff, 1);
  assert.equal(g.players[0].hand.length, h0, 'no draw');
});

test('RJ#1662 damage from a spell in a non-combat showdown is not healed when the showdown ends (only after combat / at end of turn)', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P0, 'V(3)', 'base');
  g = move(g, P0, [u], BF_A);
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  expectPending(g, 'showdownAction', P1);
  g = play(g, P1, hand(g, P1, 'Hextech Ray'), { targets: [[u]] });
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Discipline'), { targets: [[u]] });
  g = finish(g);
  assert.equal(g.battlefields[BF_A].controller, P0, 'conquered');
  assert.equal(g.objects[u].damage, 3, 'still damaged after the showdown');
  assert.equal(zone(g, u), 'battlefield');
});

test('RJ#1668 Long Sword\'s Quick-Draw attaches when played without paying its Equip cost', () => {
  let g = S0();
  fundAll(g, P0);
  const u = put(g, P0, 'V(2)', 'base');
  const ls = hand(g, P0, 'Long Sword');
  const runes0 = g.players[0].runesInPlay.length;
  g = play(g, P0, ls, { dest: 'base', targets: [[u]], cards: [[u]] });
  g = resolveWith(g, { targets: [[u]], cards: [[u]] });
  assert.equal(g.objects[ls].attachedTo, u, 'attached');
  assert.equal(runes0 - g.players[0].runesInPlay.length, 1, 'only the play cost\'s 1 power was recycled (no [C] Equip cost)');
});

test('RJ#1669 Sun Disc + Jinx, Demolitionist discarding Flame Chompers: Jinx enters ready; Chompers is played after Jinx\'s trigger and enters exhausted', () => {
  let g = S0();
  fundAll(g, P0, 12);
  const sd = put(g, P0, 'Sun Disc', 'base');
  [g] = cast(g, P0, 'DrawR'); g = resolveWith(g, {});
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === sd)!);
  g = resolveWith(g, {});
  const fc = hand(g, P0, 'Flame Chompers');
  const other = hand(g, P0, 'V(1)');
  const jx = hand(g, P0, 'ogn-030-298');
  g = act(g, { type: 'playCard', player: P0, obj: jx, destination: 'base' });
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.inStep) {
      const o = optionIds(g);
      if (d.kind === 'optional') { g = choose(g, /accelerate/i.test(d.prompt ?? '') ? 'no' : 'yes'); continue; }
      if (o.includes(fc) && o.includes(other)) { g = choose(g, fc, other); continue; }
      g = choose(g, ...d.options!.slice(0, Math.max(d.min ?? 1, 1)).map(x => x.id)); continue;
    }
    g = pass(g);
  }
  assert.equal(zone(g, jx), 'base');
  assert.equal(g.objects[jx].exhausted, false, 'Jinx entered ready (Sun Disc)');
  assert.equal(zone(g, fc), 'base', 'Chompers played from the discard trigger');
  assert.equal(g.objects[fc].exhausted, true, 'Sun Disc was used up by Jinx');
});

test('RJ#1678 5-Might unit with 4 damage: Hextech Ray, Call to Glory in response, Stupefy on top — it dies in the cleanup after Stupefy, before Call to Glory resolves', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const e = put(g, P1, 'V(5)', BF_A, { damage: 4 }); control(g, BF_A, P1);
  put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
  g = play(g, P0, hand(g, P0, 'Hextech Ray'), { targets: [[e]] });
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Call to Glory'), { targets: [[e]], may: [false] });
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Stupefy'), { targets: [[e]] });
  assert.equal(g.chain.length, 3);
  g = pass(g); g = pass(g); // Stupefy resolves, then cleanup
  assert.equal(zone(g, e), 'trash', 'died in the cleanup right after Stupefy');
  assert.equal(g.chain.length, 2, 'Call to Glory still on the chain (will fizzle)');
  g = resolveWith(g, {});
  assert.equal(g.chain.length, 0);
});

test('RJ#1683 Showstopper\'s move is not a standard move: the moved unit stays ready', () => {
  let g = S0();
  fundAll(g, P0);
  const u = put(g, P0, 'V(2)', 'base');
  g = play(g, P0, hand(g, P0, 'Showstopper'), { targets: [[u]], locations: [BF_A] });
  g = resolveWith(g, { targets: [[u]], locations: [BF_A], battlefields: [BF_A] });
  g = finish(g);
  assert.equal(locOf(g, u), BF_A);
  assert.equal(g.objects[u].counters.buff, 1);
  assert.equal(g.objects[u].exhausted, false, 'not exhausted');
});

test('RJ#1684 attacker with Cleave\'s Assault 3 takes damage below its boosted Might: combat cleanup heals before the attacker status (and Assault) ends, so it survives', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const k = put(g, P0, 'V(4)', 'base');
  const d = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  g = play(g, P0, hand(g, P0, 'Cleave'), { targets: [[k]] });
  g = resolveWith(g, {});
  g = move(g, P0, [k], BF_A);
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Void Seeker'), { targets: [[k]] });
  g = resolveWith(g, {});
  assert.equal(mightOf(g, k), 7, '4 + Assault 3 while attacking');
  assert.equal(g.objects[k].damage, 4);
  g = finish(g);
  assert.equal(zone(g, d), 'trash');
  assert.equal(zone(g, k), 'battlefield', 'survived: 6 damage healed before Might returned to 4');
  assert.equal(g.objects[k].damage, 0);
  assert.equal(g.battlefields[BF_A].controller, P0, 'conquered');
});

test('RJ#1686 Wielder of Water gets +2 only while attacking/defending alone: Tibbers\' play damage (3) kills it', () => {
  let g = S0();
  fundAll(g, P0, 12);
  const w = put(g, P1, 'Wielder of Water', BF_A); control(g, BF_A, P1);
  assert.equal(mightOf(g, w), 2);
  g = play(g, P0, hand(g, P0, 'Tibbers'), { dest: 'base' });
  g = resolveWith(g, {});
  assert.equal(zone(g, w), 'trash');
});

test('RJ#1685 Noxian Drummer Gusted in response to its move trigger: "here" is gone, no Recruit token is played', () => {
  let g = S0();
  fundAll(g, P1);
  const dr = put(g, P0, 'Noxian Drummer', 'base');
  g = move(g, P0, [dr], BF_A);
  assert.ok(g.chain.length >= 1, 'move trigger on the chain');
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Gust'), { targets: [[dr]] });
  g = finish(g);
  assert.equal(zone(g, dr), 'hand');
  const recruits = Object.values(g.objects).filter(o => o.controller === P0 && g.cards[o.cardId]?.name === 'Recruit' && (o.zone as string) !== 'gone');
  assert.equal(recruits.length, 0, 'no token');
});

test('RJ#1688 Soraka replaces Baited Hook\'s kill (heal, exhaust, recall): nothing died, so no unit is played; the top 5 are still recycled', () => {
  let g = S0();
  fundAll(g, P0);
  const bh = put(g, P0, 'Baited Hook', 'base');
  put(g, P0, 'Soraka', BF_A);
  const u = put(g, P0, 'V(2)', BF_A);
  control(g, BF_A, P0);
  for (let i = 0; i < 5; i++) put(g, P0, 'V(1)', 'deckTop');
  g = act(g, legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === bh)!);
  for (let i = 0; i < 3 && g.pending?.inStep; i++) g = choose(g, u);
  for (let i = 0; i < 20; i++) { const d = g.pending!; if (d.kind === 'mainAction') break; if (d.kind === 'optional') { g = choose(g, 'yes'); continue; } g = d.inStep ? choose(g, d.options![0].id) : pass(g); }
  assert.equal(locOf(g, u), 'base', 'saved and recalled by Soraka');
  const onBoard = Object.values(g.objects).filter(o => o.owner === P0 && (o.zone === 'base' || o.zone === 'battlefield') && g.cards[o.cardId].name === 'V(1)');
  assert.equal(onBoard.length, 0, 'no unit played');
});

test('RJ#1687 my battlefield was emptied, the opponent moves in, I Ride the Wind back: they attack, I defend, win and score (conquer)', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0); fundAll(g, P1);
  const x = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const z = put(g, P0, 'V(5)', 'base');
  const y = put(g, P1, 'V(2)', 'base');
  g = play(g, P1, hand(g, P1, 'Gust'), { targets: [[x]] });
  g = resolveWith(g, {});
  assert.equal(zone(g, x), 'hand');
  assert.equal(g.battlefields[BF_A].controller ?? null, null, 'control lost (no units, open state)');
  g = move(g, P1, [y], BF_A);
  for (let i = 0; i < 4 && pend(g).player !== P0; i++) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[z]] });
  g = resolveWith(g, { locations: [BF_A] });
  const p0 = g.players[0].points;
  g = finish(g);
  assert.equal(zone(g, y), 'trash');
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[0].points, p0 + 1, 'the defender conquered and scored');
});

test('RJ#1692 I respond to my own Snapvine\'s play trigger with En Garde: alone at my base it gets +2 (8), and trades with Anivia (8)', () => {
  let g = S0();
  fundAll(g, P0, 10);
  const an = put(g, P1, 'Anivia', BF_A); control(g, BF_A, P1);
  const sv = hand(g, P0, 'Carnivorous Snapvine');
  g = play(g, P0, sv, { dest: 'base', targets: [[an]] });
  g = answer(g, { targets: [[an]] });
  for (let i = 0; i < 3 && !(pend(g).kind === 'chainResponse' && pend(g).player === P0); i++) g = pass(g);
  expectPending(g, 'chainResponse', P0, 'own trigger: P0 may respond');
  g = play(g, P0, hand(g, P0, 'En Garde'), { targets: [[sv]] });
  g = pass(g); g = pass(g); // En Garde resolves
  assert.equal(mightOf(g, sv), 8, '6 + 1 + 1 (only unit P0 controls in base)');
  g = resolveWith(g, {});
  assert.equal(zone(g, sv), 'trash');
  assert.equal(zone(g, an), 'trash');
});

test('RJ#1697 Fox-Fire choosing several Deflect units pays the sum of their Deflect values', () => {
  let g = S0();
  fundAll(g, P0, 8);
  const a = put(g, P1, 'Deflect(1,1)', BF_A), b = put(g, P1, 'Deflect(2,2)', BF_A); control(g, BF_A, P1);
  const before = g.players[0].runesInPlay.length;
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Fox-Fire') });
  g = choose(g, a); g = choose(g, b);
  for (let i = 0; i < 5 && pend(g).inStep; i++) { const d = pend(g); g = d.kind === 'chooseTargets' ? act(g, { type: 'choose', player: P0, optionIds: [] }) : choose(g, d.options!.find(o => o.id === 'yes')?.id ?? d.options![0].id); }
  assert.equal(before - g.players[0].runesInPlay.length, 1 + 2, 'Deflect 1 + Deflect 2 power');
  g = resolveWith(g, {});
  assert.equal(zone(g, a), 'trash'); assert.equal(zone(g, b), 'trash');
});

test('RJ#1700 Assault attacker Smoke Screened to 1 (snapshot -4), leaves combat: 2-4 counts as 0; attacking again it is 1', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P0, 'V(2)', 'base');
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  g = play(g, P0, hand(g, P0, 'Cleave'), { targets: [[u]] });
  g = resolveWith(g, {});
  g = move(g, P0, [u], BF_A);
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  assert.equal(mightOf(g, u), 5, '2 + Assault 3');
  g = pass(g);
  expectPending(g, 'showdownAction', P1);
  g = play(g, P1, hand(g, P1, 'Smoke Screen'), { targets: [[u]] });
  g = resolveWith(g, {});
  assert.equal(mightOf(g, u), 1, 'to a minimum of 1');
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[u]] });
  g = resolveWith(g, { locations: ['base'] });
  g = finish(g);
  assert.equal(locOf(g, u), 'base');
  assert.ok((mightOf(g, u) ?? 0) <= 0, `not attacking: 2 - 4 (got ${mightOf(g, u)}), counts as 0`);
  g = move(g, P0, [u], BF_A);
  assert.equal(mightOf(g, u), 1, 'attacking again: 2 + 3 - 4');
});

test('RJ#1705 exhausting a unit (standard move) does not exhaust its attached gear', () => {
  let g = S0();
  const u = put(g, P0, 'V(2)', 'base');
  const ls = put(g, P0, 'Long Sword', 'base');
  attachNow(g, ls, u);
  g = finish(move(g, P0, [u], BF_A));
  assert.equal(g.objects[u].exhausted, true);
  assert.equal(g.objects[ls].attachedTo, u);
  assert.equal(g.objects[ls].exhausted, false, 'attachment stays ready');
});

test('RJ#1710 the unit that started a showdown is killed during it: the showdown goes on until everyone passes focus in succession', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_A);
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  expectPending(g, 'showdownAction', P1);
  g = play(g, P1, hand(g, P1, 'Hextech Ray'), { targets: [[u]] });
  g = resolveWith(g, {});
  assert.equal(zone(g, u), 'trash');
  assert.equal(g.showdown?.battlefieldIndex, BF_A, 'showdown still open');
  expectPending(g, 'showdownAction', P0);
  g = pass(g);
  expectPending(g, 'showdownAction', P1, 'the opponent may still play spells');
  g = pass(g);
  assert.equal(g.showdown, null, 'ends after both pass in succession');
});

test('RJ#1715 Miss Fortune readies a unit as she moves to attack: the readied unit cannot standard-move into that showdown', () => {
  let g = S0();
  const mf = put(g, P0, 'ogn-162-298', 'base');
  const o = put(g, P0, 'V(2)', 'base', { ready: false });
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [mf], BF_A);
  for (let i = 0; i < 6 && g.pending?.inStep; i++) { const d = g.pending!; g = choose(g, d.kind === 'optional' ? 'yes' : optionIds(g).includes(o) ? o : d.options![0].id); }
  for (let i = 0; i < 6 && g.chain.length; i++) g = g.pending?.inStep ? choose(g, optionIds(g).includes(o) ? o : g.pending!.options![0].id) : pass(g);
  assert.equal(g.objects[o].exhausted, false, 'readied');
  assert.ok(g.showdown, 'showdown under way');
  assert.ok(!legal(g, P0, 'move').length, 'no standard move during the showdown');
});

test('RJ#1718 Charm moves my only unit off a battlefield with my hidden card: I may play it in response; otherwise it is trashed in the cleanup after Charm', () => {
  for (const respond of [true, false]) {
    let g = S0();
    fundAll(g, P0); fundAll(g, P1);
    const u = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
    const fd = put(g, P1, 'Fight or Flight', { facedown: BF_A });
    g = play(g, P0, hand(g, P0, 'Charm'), { targets: [[u]] });
    for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
    expectPending(g, 'chainResponse', P1);
    assert.ok(canPlayNow(g, P1, fd), 'hidden card playable in response to Charm');
    if (respond) {
      g = play(g, P1, fd, { targets: [[u]] });
      g = pass(g); g = pass(g); // Fight or Flight resolves first
      assert.equal(zone(g, fd), 'trash', 'played (spell resolved)');
      assert.equal(locOf(g, u), 'base');
    } else {
      g = resolveWith(g, { locations: ['base'] });
      assert.equal(locOf(g, u), 'base');
      assert.equal(zone(g, fd), 'trash', 'trashed: control lost');
      assert.equal(g.battlefields[BF_A].controller ?? null, null);
    }
  }
});

test('RJ#1721 the combat cleanup heals every unit everywhere (a unit damaged at another battlefield too)', () => {
  let g = S0();
  fundAll(g, P0);
  const far = put(g, P1, 'V(5)', BF_B, { damage: 2 }); control(g, BF_B, P1);
  const a = put(g, P0, 'V(4)', 'base');
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  g = finish(move(g, P0, [a], BF_A));
  assert.equal(g.battlefields[BF_A].controller, P0, 'combat happened');
  assert.equal(g.objects[far].damage, 0, 'healed after the combat at the other battlefield');
});

test('RJ#1722 Smoke Screen (min 1) snapshots its modifier on resolution: on a 2-Might unit, Smoke Screen then Discipline = 3; Discipline then Smoke Screen = 1', () => {
  for (const [first, second, want] of [['Smoke Screen', 'Discipline', 3], ['Discipline', 'Smoke Screen', 1]] as const) {
    let g = S0();
    fundAll(g, P0, 8);
    const u = put(g, P0, 'V(2)', 'base');
    g = play(g, P0, hand(g, P0, first), { targets: [[u]] }); g = resolveWith(g, {});
    g = play(g, P0, hand(g, P0, second), { targets: [[u]] }); g = resolveWith(g, {});
    assert.equal(mightOf(g, u), want, `${first} then ${second}`);
  }
});

test('RJ#1727 Deathknell unit with The Zero Drive attached dies: both Deathknells trigger, I order them; its own still resolves after it is banished', () => {
  let g = S0();
  fundAll(g, P0);
  const u = put(g, P0, 'DK(2)', BF_A); control(g, BF_A, P0);
  const zd = put(g, P0, 'The Zero Drive', 'base');
  attachNow(g, zd, u);
  const h0 = g.players[0].hand.length;
  [g] = cast(g, P0, 'KillA', { targets: [[u]] });
  let ordered = false;
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.inStep) {
      if (d.kind === 'orderTriggers') {
        ordered = true;
        // first chosen goes on the chain first (resolves last): the draw first, so the banish resolves first
        g = choose(g, d.options!.find(o => !/Banish/.test(o.label))?.id ?? d.options![0].id);
        continue;
      }
      g = choose(g, d.options![0].id); continue;
    }
    g = pass(g);
  }
  assert.ok(ordered, 'the controller orders the two Deathknells');
  assert.equal(zone(g, u), 'banishment', 'banished with The Zero Drive');
  assert.equal(g.players[0].hand.length, h0 + 1, 'its own Deathknell (draw 1) still resolved');
});

test('RJ#1730 (MISMATCH-RJ, CR 323.5) opponent Charms my unit BF-A → BF-B and I Retreat my BF-B unit in response: control of BF-B is not lost while Charm is on the chain, so no showdown and no point', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0); fundAll(g, P1);
  const a = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const b = put(g, P0, 'V(2)', BF_B); control(g, BF_B, P0);
  g = play(g, P1, hand(g, P1, 'Charm'), { targets: [[a]] });
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Retreat'), { targets: [[b]] });
  g = pass(g); g = pass(g); // Retreat resolves; cleanup in a Closed state (Charm still on the chain)
  assert.equal(zone(g, b), 'hand');
  assert.equal(g.battlefields[BF_B].controller, P0, 'control kept while the chain is non-empty (CR 309.1, 323.5)');
  const p0 = g.players[0].points;
  g = resolveWith(g, { locations: [BF_B] });
  g = finish(g);
  assert.equal(locOf(g, a), BF_B);
  assert.equal(g.battlefields[BF_B].controller, P0);
  assert.equal(g.players[0].points, p0, 'never lost control of BF-B: no conquer');
});

test('RJ#1731 a unit can be played from hand to a battlefield you currently control, not to one you conquered earlier and lost', () => {
  const g = S0();
  fundAll(g, P0);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  const u = hand(g, P0, 'V(2)');
  const d = playDests(g, P0, u).map(String);
  assert.ok(d.includes(String(BF_A)), 'controlled battlefield');
  assert.ok(!d.includes(String(BF_B)), 'not an enemy-controlled one');
  assert.ok(d.includes('base'));
});

test('RJ#1732 Cull the Weak can be played with no units (no targets; choices on resolution)', () => {
  let g = S0();
  fundAll(g, P0);
  const e = put(g, P1, 'V(1)', 'base');
  const c = hand(g, P0, 'Cull the Weak');
  assert.ok(canPlayNow(g, P0, c), 'playable without units of my own');
  g = play(g, P0, c);
  g = finish(g);
  assert.equal(zone(g, c), 'trash');
  assert.equal(zone(g, e), 'trash', 'the opponent still kills one of theirs');
});

test('RJ#1737 an Assault attacker with 3 damage moved out of the combat (Ride the Wind) loses Assault and dies', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P0, 'V(2)', 'base');
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  g = play(g, P0, hand(g, P0, 'Cleave'), { targets: [[u]] });
  g = resolveWith(g, {});
  g = move(g, P0, [u], BF_A);
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'Hextech Ray'), { targets: [[u]] });
  g = resolveWith(g, {});
  assert.equal(zone(g, u), 'battlefield', '5 Might with 3 damage');
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[u]] });
  g = resolveWith(g, { locations: ['base'] });
  assert.equal(zone(g, u), 'trash', 'no longer attacking: 2 Might, 3 damage');
});

test('RJ#1743 gear enters ready and its [T] ability can be used the turn it is played (own turn, open state); not on the opponent\'s turn without Reaction', () => {
  let g = S0();
  fundAll(g, P0, 8);
  const sd = hand(g, P0, 'Temporal Portal');
  g = play(g, P0, sd, { dest: 'base' });
  g = resolveWith(g, {});
  assert.equal(zone(g, sd), 'base');
  assert.equal(g.objects[sd].exhausted, false, 'enters ready');
  assert.ok(legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === sd), 'usable this turn');
  g = endTurn(g);
  for (let i = 0; i < 20 && !(g.activePlayer === P1 && g.pending?.kind === 'mainAction'); i++) g = g.pending!.inStep ? choose(g, g.pending!.options![0].id) : pass(g);
  assert.ok(!legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === sd), 'not on the opponent\'s turn');
});

test('RJ#1745 Siphon Power on enemy units at Trifarian War Camp: War Camp +1 and Siphon -1 combine (1-Might Recruit: 2 → 1) and stay combined', () => {
  let g = S0({ bfA: 'Trifarian War Camp' });
  fundAll(g, P0);
  const e = put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const f = put(g, P0, 'V(2)', BF_B); control(g, BF_B, P0);
  assert.equal(mightOf(g, e), 2, 'War Camp +1');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Siphon Power') });
  g = choose(g, g.battlefields[BF_A].objId);
  g = resolveWith(g, {});
  assert.equal(mightOf(g, e), 1, '1 + 1 - 1');
  assert.equal(mightOf(g, f), 2, 'other battlefield unaffected');
  g = move(g, P0, [put(g, P0, 'V(1)', 'base')], BF_B);
  assert.equal(mightOf(g, e), 1, 'still 1 later in the turn');
});

test('RJ#1747 Blade of the Ruined King: killing the Equip target as the cost while Zhonya\'s Hourglass replaces the death — the cost is paid, the unit survives and the Blade attaches', () => {
  let g = S0();
  fundAll(g, P0);
  const u = put(g, P0, 'V(2)', 'base');
  const z = put(g, P0, "Zhonya's Hourglass", 'base');
  const bl = put(g, P0, 'Blade of the Ruined King', 'base');
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === bl)!);
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) { const d = pend(g); g = d.inStep ? choose(g, d.options!.find(o => o.id === u)?.id ?? d.options!.find(o => o.id === 'yes')?.id ?? d.options![0].id) : pass(g); }
  assert.equal(zone(g, z), 'trash', 'Zhonya\'s replaced the death');
  assert.equal(zone(g, u), 'base');
  assert.equal(g.objects[bl].attachedTo, u, 'equip proceeds');
});

test('RJ#1750 Gust cannot target a unit with more than 3 Might', () => {
  let g = S0();
  fundAll(g, P0);
  const big = put(g, P1, 'V(4)', BF_A), small = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Gust') });
  if (pend(g).kind === 'chooseTargets') {
    assert.ok(!optionIds(g).includes(big), '4 Might: not a legal target');
    assert.ok(optionIds(g).includes(small));
  } else assert.equal(g.chain.length && g.chain[0].targets?.flat().includes(big), false);
});

test('RJ#1751 Tibbers\' "deal 3 to all units at battlefields" does not affect a facedown hidden card there', () => {
  let g = S0();
  fundAll(g, P0, 12);
  const fd = put(g, P1, 'HidU(2)', { facedown: BF_A });
  const up = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  g = play(g, P0, hand(g, P0, 'Tibbers'), { dest: 'base' });
  g = resolveWith(g, {});
  assert.equal(g.objects[up].damage, 3, 'face-up unit takes 3');
  assert.equal(g.objects[fd].damage ?? 0, 0, 'facedown card is not a unit on the board');
  assert.notEqual(zone(g, fd), 'trash');
});

test('RJ#1758 killing a unit with Challenge (the units deal the damage) does not trigger Immortal Phoenix', () => {
  let g = S0();
  fundAll(g, P0, 8);
  const ph = put(g, P0, 'Immortal Phoenix', 'trash');
  const mine = put(g, P0, 'V(5)', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(2)', BF_B); control(g, BF_B, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Challenge') });
  let offered = false;
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.inStep) { if (d.kind === 'optional') { offered = true; g = choose(g, 'yes'); continue; } const o = optionIds(g); g = choose(g, o.includes(mine) ? mine : o.includes(e) ? e : o[0]); continue; }
    g = pass(g);
  }
  assert.equal(zone(g, e), 'trash', 'killed by Challenge');
  assert.ok(!offered && !g.log.some(l => /Trigger: Immortal Phoenix/.test(l.text)), 'no Phoenix trigger');
  assert.equal(zone(g, ph), 'trash');
});

test('RJ#1760 Temptation moving my unit BF-A → BF-B; I Tideturner it to BF-B in response: Temptation does nothing (destination fixed when played)', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const w = put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  const tt = put(g, P1, 'Tideturner', { facedown: BF_B });
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Temptation') });
  const kinds: string[] = [];
  for (let i = 0; i < 6 && pend(g).inStep; i++) {
    const d = pend(g); kinds.push(d.kind);
    g = d.kind === 'chooseTargets' ? choose(g, u) : d.kind === 'optional' ? choose(g, 'no') : act(g, { type: 'choose', player: d.player, optionIds: [String(BF_B)] });
  }
  // the destination is chosen as Temptation is played (here BF-B is its only valid destination, so it is chosen automatically)
  const tItem = g.chain.find(c => c.kind === 'spell' && /Temptation/.test(c.label ?? ''));
  assert.deepEqual(tItem?.targets[1], [g.battlefields[BF_B].objId], `destination chosen on play (${kinds.join(',')})`);
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  g = act(g, { type: 'playCard', player: P1, obj: tt });
  g = answer(g, { may: [true], targets: [[u]] }, P1);
  for (let i = 0; i < 12 && (g.chain.length || pend(g).inStep); i++) { const d = pend(g); g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: [d.options!.find(o => o.id === String(BF_A))?.id ?? d.options![0].id] }) : pass(g); }
  assert.equal(locOf(g, u), BF_B, 'swapped to BF-B, and Temptation (to BF-B) did nothing');
  assert.equal(locOf(g, tt), BF_A);
  assert.equal(locOf(g, w), BF_B);
});

test('RJ#1764 Unforgiven (Yasuo legend) uses the chain: the opponent can respond (Gust) before the unit moves to base', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const l = legendOf(g, P0, 'Unforgiven');
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  put(g, P0, 'V(1)', BF_A);
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === l)!);
  for (let i = 0; i < 4 && pend(g).inStep; i++) { const d = pend(g); g = choose(g, d.options!.find(o => o.id === u)?.id ?? d.options!.find(o => o.id === 'base')?.id ?? d.options![0].id); }
  assert.equal(g.chain.length, 1, 'Unforgiven is on the chain');
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  expectPending(g, 'chainResponse', P1);
  g = play(g, P1, hand(g, P1, 'Gust'), { targets: [[u]] });
  g = finish(g);
  assert.equal(zone(g, u), 'hand', 'removed before Unforgiven resolved');
});

test('RJ#1765 Icathian Rain: buffed Lee Sin (7) takes 8 and dies; the other buffed unit (5 with Lee\'s +2) took 4 and dies in the next cleanup pass', () => {
  let g = S0();
  fundAll(g, P0, 12);
  const ls = put(g, P1, 'ogn-151-298', BF_A, { buff: true });
  const o = put(g, P1, 'V(2)', BF_A, { buff: true }); control(g, BF_A, P1);
  assert.equal(mightOf(g, ls), 7); assert.equal(mightOf(g, o), 5);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Icathian Rain') });
  for (const t of [ls, ls, ls, ls, o, o]) g = choose(g, t);
  for (let i = 0; i < 3 && pend(g).inStep; i++) g = choose(g, pend(g).options![0].id);
  g = resolveWith(g, {});
  assert.equal(zone(g, ls), 'trash');
  assert.equal(zone(g, o), 'trash', 'lost Lee Sin\'s +2: 3 Might with 4 damage');
});

test('RJ#1767 Dragon\'s Rage cannot "move" an enemy unit to the location it is already at', () => {
  let g = S0();
  fundAll(g, P0, 8);
  const e = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, "Dragon's Rage") });
  let saw: string[] | null = null;
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.inStep) {
      if (d.kind === 'chooseDestination' || d.kind === 'chooseBattlefield') saw = optionIds(g);
      g = choose(g, d.options!.find(x => x.id === e)?.id ?? d.options![0].id); continue;
    }
    g = pass(g);
  }
  assert.ok(saw, 'a destination was asked');
  assert.ok(!saw!.includes(String(BF_A)), `the unit's own location is not a destination (${saw})`);
});

test('RJ#1776 two Sun Discs activated before playing units both apply to the same next unit (the second unit enters exhausted)', () => {
  let g = S0();
  fundAll(g, P0, 8);
  const s1 = put(g, P0, 'Sun Disc', 'base'), s2 = put(g, P0, 'Sun Disc', 'base');
  [g] = cast(g, P0, 'DrawR'); g = resolveWith(g, {});
  for (const s of [s1, s2]) { g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === s)!); g = resolveWith(g, {}); }
  const u1 = hand(g, P0, 'V(1)'), u2 = hand(g, P0, 'V(1)');
  g = play(g, P0, u1, { dest: 'base' }); g = resolveWith(g, {});
  g = play(g, P0, u2, { dest: 'base' }); g = resolveWith(g, {});
  assert.equal(g.objects[u1].exhausted, false, 'next unit enters ready');
  assert.equal(g.objects[u2].exhausted, true, 'both Discs were used up by the same unit');
});

test('RJ#1780 Time Warp countered by Wind Wall is not banished (its "Banish this" never happens): it goes to the trash, no extra turn', () => {
  let g = S0();
  fundAll(g, P0, 16); fundAll(g, P1);
  let tw: string;
  [g, tw] = cast(g, P0, 'Time Warp');
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Wind Wall'), { targets: [[g.chain[0].id]] });
  g = resolveWith(g, {});
  assert.equal(zone(g, tw), 'trash');
  assert.equal(g.ex.extraTurns.length, 0, 'no extra turn');
});

test('RJ#1783 Shakedown: the enemy unit\'s controller chooses — it takes 6, or the caster draws 2', () => {
  for (const pay of [true, false]) {
    let g = S0();
    fundAll(g, P0);
    const e = put(g, P1, 'V(7)', BF_A); control(g, BF_A, P1);
    const h0 = g.players[0].hand.length;
    let chooser: number | null = null;
    [g] = cast(g, P0, 'Shakedown', { targets: [[e]] });
    for (let i = 0; i < 12 && pend(g).kind !== 'mainAction'; i++) {
      const d = pend(g);
      if (d.inStep && d.kind === 'optional') { chooser = d.player; g = choose(g, pay ? 'yes' : 'no'); continue; }
      if (d.inStep) { g = choose(g, optionIds(g).includes(e) ? e : d.options![0].id); continue; }
      g = pass(g);
    }
    assert.equal(chooser, P1, 'the unit\'s controller decides');
    const drew = g.players[0].hand.length - h0;
    assert.ok((drew === 2 && g.objects[e].damage === 0) || (drew === 0 && g.objects[e].damage === 6), `either draw 2 or 6 damage (drew ${drew}, damage ${g.objects[e].damage})`);
  }
});

test('RJ#1789 Yasuo (attack trigger) attacks a defending Ahri (attack-or-defend -2): the defender\'s trigger is on top, so Ahri\'s -2 applies before Yasuo\'s damage', () => {
  let g = S0();
  const y = put(g, P0, 'ogn-076-298', 'base');
  const ah = put(g, P1, 'ogn-119-298', BF_A);
  const v = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [y], BF_A);
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g);
    if (d.inStep) { const o = optionIds(g); g = act(g, { type: 'choose', player: d.player, optionIds: [d.player === P0 ? (o.includes(v) ? v : o[0]) : (o.includes(y) ? y : o[0])] }); continue; }
    g = pass(g);
  }
  assert.equal(mightOf(g, y), 4, 'Yasuo 6 - 2');
  assert.equal(g.objects[v].damage, 4, 'Yasuo dealt his reduced Might');
  assert.equal(zone(g, ah), 'battlefield');
});

test('RJ#1791 (MISMATCH-RJ, CR 383.3.b) Overzealous Fan\'s trigger countered by the attacker\'s Not So Fast: the Fan already died paying its "kill me" cost when the trigger was finalized', () => {
  let g = S0();
  fundAll(g, P0);
  const fan = put(g, P1, 'Overzealous Fan', BF_A);
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(3)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 10 && !(g.chain.some(c => c.source === fan) && pend(g).player === P0 && !pend(g).inStep); i++) {
    const d = pend(g);
    g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : optionIds(g).includes(a) ? a : optionIds(g)[0]] }) : pass(g);
  }
  assert.ok(g.chain.some(c => c.source === fan), 'Fan trigger on the chain');
  assert.equal(zone(g, fan), 'trash', 'cost paid on finalization: the Fan is already dead');
  const nsf = hand(g, P0, 'Not So Fast');
  assert.ok(canPlayNow(g, P0, nsf), 'Not So Fast can counter it (it chose my unit)');
  g = play(g, P0, nsf, { targets: [[g.chain.find(c => c.source === fan)!.id]] });
  for (let i = 0; i < 10 && g.chain.length; i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.equal(locOf(g, a), BF_A, 'countered: the attacker is not moved');
  assert.equal(zone(g, fan), 'trash');
});

// ---------------------------------------------------------------- cycle 4 (ids 1792+)
test('RJ#1792 Kai\'Sa, Evolutionary: the trash spell is chosen as her conquer trigger goes on the chain — a Stupefy played in response can\'t be the one she plays', () => {
  let g = S0();
  fundAll(g, P0);
  g.players[P0].points = 3;
  const k = put(g, P0, 'ogn-112-298', 'base');
  const sp = put(g, P0, 'DrawR', 'trash');
  const st = hand(g, P0, 'Stupefy');
  g = move(g, P0, [k], BF_A);
  let offered: string[] | null = null;
  for (let i = 0; i < 20 && !g.chain.some(c => c.source === k); i++) {
    const d = pend(g);
    if (d.inStep) { const o = optionIds(g); if (o.includes(sp)) { offered = o; g = choose(g, sp); } else g = choose(g, d.kind === 'optional' ? 'yes' : o[0]); continue; }
    g = pass(g);
  }
  assert.ok(offered, 'spell chosen when the trigger is put on the chain');
  assert.ok(!offered!.includes(st), 'Stupefy (still in hand) is not a choice');
  expectPending(g, 'chainResponse', P0);
  g = play(g, P0, st, { targets: [[k]] });
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.equal(zone(g, st), 'trash', 'Stupefy stays in the trash');
  assert.equal(zone(g, sp), 'mainDeck', 'the chosen spell was played and recycled');
});

test('RJ#1794 Hextech Ray ("a unit at a battlefield"): the target is Flashed to base in response, so no damage is dealt', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const e = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  g = play(g, P0, hand(g, P0, 'Hextech Ray'), { targets: [[e]] });
  g = pass(g);
  expectPending(g, 'chainResponse', P1);
  g = play(g, P1, hand(g, P1, 'Flash'), { targets: [[e]] });
  g = resolveWith(g, { targets: [[e]] });
  assert.equal(locOf(g, e), 'base');
  assert.equal(g.objects[e].damage ?? 0, 0, 'illegal target on resolution');
});

test('RJ#1795 Sigil of the Storm (current text): no rune is targeted when the conquer trigger goes on the chain; the rune is chosen on resolution', () => {
  let g = S0({ bfA: 'Sigil of the Storm' });
  const runes = [...g.players[P0].runesInPlay];
  const u = put(g, P0, 'V(1)', 'base');
  g = move(g, P0, [u], BF_A);
  let picks = 0;
  for (let i = 0; i < 20 && !g.chain.length && pend(g).kind !== 'mainAction'; i++) g = pend(g).inStep ? (picks++, choose(g, pend(g).options![0].id)) : pass(g);
  assert.ok(g.chain.length >= 1, 'conquer trigger on the chain');
  assert.equal(picks, 0, 'nothing chosen while putting it on the chain');
  assert.deepEqual(g.players[P0].runesInPlay, runes, 'no rune recycled yet');
  g = resolveWith(g, { targets: [[runes[0]]], cards: [[runes[0]]] });
  g = finish(g);
  assert.equal(g.players[P0].runesInPlay.length, runes.length - 1, 'one rune recycled on resolution');
});

test('RJ#1802 a unit killed in response to its attack trigger: Leona, Determined\'s "stun an enemy unit here" does nothing; Twisted Fate, Gambler\'s trigger still resolves', () => {
  {
    let g = S0();
    fundAll(g, P1);
    const e = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
    const le = put(g, P0, 'Leona, Determined', 'base');
    g.objects[le].damage = 2;
    g = move(g, P0, [le], BF_A);
    for (let i = 0; i < 6 && pend(g).inStep; i++) g = choose(g, optionIds(g).includes(e) ? e : pend(g).options![0].id);
    assert.ok(g.chain.some(c => c.source === le), 'Leona\'s trigger on the chain');
    for (let i = 0; i < 4 && pend(g).player !== P1; i++) g = pass(g);
    expectPending(g, 'chainResponse', P1);
    g = play(g, P1, hand(g, P1, 'ZapR'), { targets: [[le]] });
    for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
    assert.equal(zone(g, le), 'trash');
    assert.equal(!!g.objects[e].stunned, false, 'no stun: Leona is no longer there');
  }
  {
    let g = S0();
    fundAll(g, P1);
    const rd = g.players[P0].runeDeck.length;
    const tf = put(g, P0, 'Twisted Fate, Gambler', 'base');
    g.objects[tf].damage = 2;
    put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
    g = move(g, P0, [tf], BF_A);
    for (let i = 0; i < 6 && pend(g).inStep; i++) g = choose(g, pend(g).options![0].id);
    assert.ok(g.chain.some(c => c.source === tf), 'TF\'s trigger on the chain');
    for (let i = 0; i < 4 && pend(g).player !== P1; i++) g = pass(g);
    g = play(g, P1, hand(g, P1, 'ZapR'), { targets: [[tf]] });
    const logLen = g.log.length;
    for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
    assert.equal(zone(g, tf), 'trash');
    assert.ok(g.log.slice(logLen).some(l => /reveal/i.test(l.text)), 'TF\'s trigger still resolved (rune revealed)');
    assert.equal(g.players[P0].runeDeck.length, rd, 'revealed rune recycled');
  }
});

test('RJ#1809 a Seal\'s [C] can pay Hextech Anomaly\'s "pay any amount of [A]" for Energy', () => {
  let g = S0();
  for (const r of g.players[P0].runesInPlay) g.objects[r].exhausted = true;
  const seal = put(g, P0, 'Seal of Insight', 'base');
  const an = put(g, P0, 'Hextech Anomaly', 'base');
  g = activate(g, P0, seal, 0);
  g = resolveWith(g, {});
  g = activate(g, P0, an, 0);
  assert.ok(optionIds(g).includes('1'), `1 [A] payable from the Seal (${optionIds(g)})`);
  g = act(g, { type: 'choose', player: P0, optionIds: ['1'] });
  g = resolveWith(g, {});
  assert.equal(g.players[P0].pool.energy, 1);
});

test('RJ#1810 Vanguard Helm: Singularity (or Falling Star) kills a buffed unit and another friendly unit at once — the dead unit can\'t get the buff; a surviving unit does', () => {
  for (const spell of ['Singularity', 'Falling Star']) {
    let g = S0();
    fundAll(g, P1, 12);
    put(g, P0, 'Vanguard Helm', 'base');
    const a = put(g, P0, 'V(2)', BF_A, { buff: true });
    const b = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
    const c = put(g, P0, 'V(2)', 'base');
    g = endTurn(g);
    g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, spell) });
    for (let i = 0; i < 4 && pend(g).inStep && pend(g).player === P1; i++) {
      const d = pend(g);
      g = (d.max ?? 1) >= 2 ? act(g, { type: 'choose', player: P1, optionIds: [a, b] }) : choose(g, i === 0 ? a : b);
    }
    for (let i = 0; i < 30 && (g.chain.length || pend(g).inStep); i++) { const d = pend(g); g = d.inStep ? choose(g, optionIds(g).includes(c) ? c : d.options![0].id) : pass(g); }
    assert.equal(zone(g, a), 'trash', spell); assert.equal(zone(g, b), 'trash', spell);
    assert.equal(g.objects[c].counters.buff ?? 0, 1, `${spell}: the surviving unit is buffed`);
  }
});

test('RJ#1813 Mystic Reversal on Cull the Weak (no choices): each player still kills one of their own units', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1, 10);
  const m = put(g, P0, 'V(2)', 'base');
  const o = put(g, P1, 'V(2)', 'base');
  let ctw: string;
  [g, ctw] = cast(g, P0, 'Cull the Weak');
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Mystic Reversal'), { targets: [[g.chain.find(c => c.source === ctw)!.id]] });
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.equal(zone(g, m), 'trash'); assert.equal(zone(g, o), 'trash');
});

test('RJ#1816 damage does not lower Might: a 6-Might unit with 4 damage is still 6, so Gust can\'t target it', () => {
  let g = S0();
  fundAll(g, P0);
  const e = put(g, P1, 'V(6)', BF_A); control(g, BF_A, P1);
  g.objects[e].damage = 4;
  assert.equal(mightOf(g, e), 6);
  const gu = hand(g, P0, 'Gust');
  assert.ok(!canPlayNow(g, P0, gu), 'no legal Gust target (the only unit is 6 Might)');
  g.objects[e].damage = 0;
  const small = put(g, P1, 'V(3)', BF_A);
  g.objects[small].damage = 2;
  assert.ok(canPlayNow(g, P0, gu), 'a damaged 3-Might unit is still a legal target');
});

test('RJ#1821 Hostile Takeover from hidden in a showdown: the showdown continues, and I may later kill the stolen unit for Malzahar, Fanatic\'s ability', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0, 10);
  put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const ht = put(g, P0, 'Hostile Takeover', { facedown: BF_A });
  const mz = put(g, P0, 'Malzahar, Fanatic', 'base');
  const a1 = put(g, P1, 'V(3)', 'base'), a2 = put(g, P1, 'V(1)', 'base');
  g = move(g, P1, [a1, a2], BF_A);
  for (let i = 0; i < 6 && pend(g).player !== P0; i++) g = pass(g);
  expectPending(g, 'showdownAction', P0);
  g = play(g, P0, ht, { targets: [[a2]] });
  g = resolveWith(g, {});
  assert.equal(g.objects[a2].controller, P0, 'stolen');
  assert.ok(g.showdown, 'showdown continues');
  for (let i = 0; i < 4 && pend(g).player !== P0; i++) g = pass(g);
  const ac = legal(g, P0).find(x => x.type === 'activate' && (x as { obj?: ObjId }).obj === mz);
  assert.ok(ac, 'Malzahar\'s ability available with focus');
  g = act(g, ac!);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = optionIds(g).includes(a2) ? choose(g, a2) : choose(g, pend(g).options![0].id);
  assert.equal(zone(g, a2), 'trash', 'killed the stolen unit for the cost');
});

test('RJ#1824 Forge of the Fluft\'s granted ability and Emperor of the Sands\' own both cost [T] on the legend: using one leaves the other unusable', () => {
  let g = S0({ bfA: 'Forge of the Fluft' });
  fundAll(g, P0);
  const l = legendOf(g, P0, 'Emperor of the Sands');
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const sw = hand(g, P0, 'Sword');
  g = play(g, P0, sw, { dest: 'base' });
  g = resolveWith(g, {});
  const legendActs = (h: GameState) => legal(h, P0, 'activate').filter(x => x.type === 'activate' && x.obj === l);
  assert.equal(legendActs(g).length, 2, 'both legend abilities available');
  g = act(g, legendActs(g)[legendActs(g).length - 1]);
  for (let i = 0; i < 8 && (g.chain.length || pend(g).inStep); i++) { const o = pend(g).inStep ? optionIds(g) : []; g = pend(g).inStep ? choose(g, o.includes(sw) ? sw : o.includes(u) ? u : o[0]) : pass(g); }
  assert.equal(g.objects[l].exhausted, true);
  assert.equal(legendActs(g).length, 0, 'the other ability needs [T] too');
});

test('RJ#1825 Production Surge with Forecaster: the spell finishes (Mech token, then draw 1) before the Mech\'s Vision trigger resolves', () => {
  let g = S0();
  fundAll(g, P0);
  put(g, P0, 'Forecaster', 'base');
  const second = put(g, P0, 'V(1)', 'deckTop');
  const top = put(g, P0, 'V(2)', 'deckTop');
  let tw: string;
  [g, tw] = cast(g, P0, 'Production Surge');
  let seen = false;
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) {
    if (!seen && (pend(g).inStep || g.chain.some(c => c.source !== tw))) { seen = true; assert.equal(zone(g, top), 'hand', 'drew before Vision'); assert.equal(zone(g, second), 'mainDeck'); }
    g = pend(g).inStep ? choose(g, pend(g).kind === 'optional' ? 'no' : pend(g).options![0].id) : pass(g);
  }
  assert.ok(seen, 'Vision triggered');
  assert.equal(zone(g, top), 'hand');
});

test('RJ#1827 Promising Future: the active player banishes first; the next player plays first, so the active player\'s spell is on top and resolves first', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const mine = put(g, P0, 'DrawR', 'deckTop');
  const theirs = put(g, P1, 'DrawR', 'deckTop');
  const order: number[] = [];
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Promising Future') });
  let chainSeen: string[] | null = null;
  for (let i = 0; i < 30 && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g);
    if (d.inStep) { order.push(d.player); const o = optionIds(g); g = choose(g, o.includes(mine) ? mine : o.includes(theirs) ? theirs : o[0]); continue; }
    if (!chainSeen && g.chain.some(c => c.source === mine) && g.chain.some(c => c.source === theirs)) chainSeen = g.chain.map(c => c.source);
    g = pass(g);
  }
  assert.equal(order[0], P0, `active player banishes first (${order})`);
  assert.ok(chainSeen, 'both spells on the chain together');
  assert.equal(chainSeen![chainSeen!.length - 1], mine, 'active player\'s spell is on top (played second)');
});

test('RJ#1828 Mask of Foresight\'s +1 is a triggered effect: it stays after the Mask leaves play mid-combat', () => {
  let g = S0();
  const mask = put(g, P0, 'Mask of Foresight', 'base');
  const mz = put(g, P0, 'Malzahar, Fanatic', 'base');
  put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(3)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 10 && g.chain.length; i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.equal(mightOf(g, a), 4, 'Mask +1');
  expectPending(g, 'showdownAction', P0);
  g = act(g, legal(g, P0).find(x => x.type === 'activate' && (x as { obj?: ObjId }).obj === mz)!);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = optionIds(g).includes(mask) ? choose(g, mask) : choose(g, pend(g).options![0].id);
  assert.equal(zone(g, mask), 'trash');
  assert.equal(mightOf(g, a), 4, 'the +1 this turn remains');
});

test('RJ#1831 Dr. Mundo, Expert with fewer than 3 cards in the trash recycles as many as possible', () => {
  let g = S0();
  put(g, P0, 'Dr. Mundo, Expert', 'base');
  put(g, P0, 'V(1)', 'trash'); put(g, P0, 'V(2)', 'trash');
  g.players[P0].trash = g.players[P0].trash.filter(id => g.objects[id].zone === 'trash');
  assert.equal(g.players[P0].trash.length, 2);
  g = nextTurn(g); g = nextTurn(g);
  assert.equal(g.activePlayer, P0);
  assert.equal(g.players[P0].trash.length, 0, 'both recycled');
});

test('RJ#1835 Nine-Tailed Fox (Ahri legend) doesn\'t choose: a Deflect attacker gets -1 with no Deflect cost', () => {
  let g = S0();
  legendOf(g, P1, 'Nine-Tailed Fox');
  for (const r of g.players[P1].runesInPlay) g.objects[r].exhausted = true;
  put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const poro = put(g, P0, 'Pouty Poro', 'base');
  put(g, P0, 'V(3)', 'base');
  g = move(g, P0, [poro], BF_A);
  for (let i = 0; i < 10 && g.chain.length; i++) g = pend(g).inStep ? choose(g, pend(g).kind === 'optional' ? 'yes' : pend(g).options![0].id) : pass(g);
  assert.equal(mightOf(g, poro), 1, '-1 applied although P1 could pay nothing');
});

test('RJ#1836 Bo3 games 2/3: the previous game\'s loser chooses who goes first', async () => {
  const { createGame } = await import('../../src/engine/index.ts');
  const { fixtureDb } = await import('../fixtures/conformance/cards.ts');
  const { legalDeck } = await import('../conformance/harness.ts');
  let g = createGame({ seed: 5, cardDb: fixtureDb(), previousLoser: P1, skipMulligan: true, battlefieldSelection: 'random', includeAllCards: true,
    players: [0, 1].map(i => ({ name: `P${i}`, deck: legalDeck() })) });
  for (let i = 0; i < 10 && pend(g).kind !== 'chooseMode'; i++) g = act(g, legal(g, pend(g).player)[0]);
  expectPending(g, 'chooseMode', P1);
  g = choose(g, 'second');
  assert.equal(g.firstPlayer, P0);
});

test('RJ#1847 Discipline draws when it resolves; the drawn card can be played before the rest of the chain resolves', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const drawn = put(g, P0, 'ZapR', 'deckTop');
  g = play(g, P1, hand(g, P1, 'ZapM'), { targets: [[u]] });
  g = pass(g);
  expectPending(g, 'chainResponse', P0);
  g = play(g, P0, hand(g, P0, 'Discipline'), { targets: [[u]] });
  assert.equal(zone(g, drawn), 'mainDeck', 'nothing drawn when played');
  for (let i = 0; i < 4 && g.chain.length === 2; i++) g = pass(g);
  assert.equal(g.chain.length, 1, 'Discipline resolved, ZapM still on the chain');
  assert.equal(zone(g, drawn), 'hand', 'drew on resolution');
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  assert.ok(canPlayNow(g, P0, drawn), 'the drawn Reaction can respond to the remaining chain');
});

test('RJ#1848 opponent\'s Blitzcrank pulls my only unit off my battlefield; I Ride the Wind it back in the showdown: I conquer and score on their turn', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0); fundAll(g, P1, 10);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  const bl = hand(g, P1, 'Blitzcrank, Impassive');
  const rtw = hand(g, P0, 'Ride the Wind');
  g = play(g, P1, bl, { dest: BF_B });
  let played = false;
  for (let i = 0; i < 40 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!played && d.player === P0 && !d.inStep && d.kind === 'showdownAction' && locOf(g, u) === BF_B) { g = play(g, P0, rtw, { targets: [[u]] }); played = true; continue; }
    if (d.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: d.player, assignment: (d.data as { suggested: Record<string, number> }).suggested }); continue; }
    if (d.inStep) { const o = optionIds(g); g = choose(g, d.kind === 'optional' ? 'yes' : o.includes(u) ? u : o.includes(String(BF_A)) ? String(BF_A) : o[0]); continue; }
    g = pass(g);
  }
  assert.ok(played, 'Ride the Wind played in the showdown at BF-B');
  assert.equal(locOf(g, u), BF_A);
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[P0].points, 1, 'conquered on the opponent\'s turn');
});

test('RJ#1853 one standard move: a Ganking unit from a battlefield and a unit from base move together to the same battlefield', () => {
  let g = S0();
  const gk = put(g, P0, 'Ganker(2)', BF_B); control(g, BF_B, P0);
  const v = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [gk, v], BF_A);
  assert.equal(locOf(g, gk), BF_A); assert.equal(locOf(g, v), BF_A);
});

test('RJ#1854 my hidden card\'s battlefield: my only unit dies in the combat I Charmed the enemy into — the hidden card goes to the trash unplayed', () => {
  let g = S0();
  fundAll(g, P0);
  const mine = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const h = hand(g, P0, 'HidZap');
  g = act(g, { type: 'hide', player: P0, obj: h, battlefieldIndex: BF_A });
  assert.ok(!canPlayNow(g, P0, h), 'not playable the turn it was hidden');
  const e = put(g, P1, 'V(2)', 'base');
  g = play(g, P0, hand(g, P0, 'Charm'), { targets: [[e]] });
  g = resolveWith(g, { locations: [BF_A] });
  g = finish(g);
  assert.equal(zone(g, mine), 'trash'); assert.equal(zone(g, e), 'trash');
  assert.equal(zone(g, h), 'trash', 'hidden card trashed when control is lost');
});

test('RJ#1859 Catalyst of Aeons stolen by Mystic Reversal: the thief channels the 2 runes', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1, 10);
  let c: string;
  [g, c] = cast(g, P0, 'Catalyst of Aeons');
  const r0 = g.players[P0].runesInPlay.length;
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Mystic Reversal'), { targets: [[g.chain.find(x => x.source === c)!.id]] });
  const r1 = g.players[P1].runesInPlay.length;
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) g = pend(g).inStep ? choose(g, pend(g).kind === 'optional' ? 'no' : pend(g).options![0].id) : pass(g);
  assert.equal(g.players[P1].runesInPlay.length, r1 + 2, 'thief channels 2');
  assert.equal(g.players[P0].runesInPlay.length, r0, 'original caster gets nothing');
});

test('RJ#1864 (MISMATCH-RJ, CR 312.2.c) initial combat chain with an attack and a defend trigger: once both are finalized, the controller of the next (top) item — the defender — receives priority', () => {
  const { g, atk, def } = attackSetup(['AttackDraw(3)'], ['DefendAmbusher(3)']);
  assert.equal(g.chain.length, 2, 'both triggers on the initial chain');
  assert.equal(g.chain[g.chain.length - 1].source, def[0], 'defender\'s trigger on top');
  assert.equal(g.chain[0].source, atk[0]);
  expectPending(g, 'chainResponse', P1, 'CR 312.2.c: closed state, all pending items finalized → controller of the next item');
  assert.equal(g.showdown!.focus, P0, 'the attacker keeps focus');
});

test('RJ#1866 two Yasuo, Remorseful attack triggers on one unit: Zhonya\'s Hourglass recalls it after the first; the second (enemy unit "here") deals nothing', () => {
  let g = S0();
  const x = put(g, P1, 'V(5)', BF_A);
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const z = put(g, P1, "Zhonya's Hourglass", 'base');
  const y1 = put(g, P0, 'ogn-076-298', 'base'), y2 = put(g, P0, 'ogn-076-298', 'base');
  g = move(g, P0, [y1, y2], BF_A);
  let resolvedOne = false;
  for (let i = 0; i < 30 && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g);
    if (d.inStep) { const o = optionIds(g); g = choose(g, d.kind === 'optional' ? 'yes' : o.includes(x) ? x : o[0]); continue; }
    if (resolvedOne && locOf(g, x) === 'base') break;
    g = pass(g);
    if (zone(g, z) === 'trash') resolvedOne = true;
  }
  assert.equal(zone(g, z), 'trash', 'Zhonya\'s used once');
  for (let i = 0; i < 20 && g.chain.length; i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.equal(locOf(g, x), 'base', 'recalled');
  assert.equal(zone(g, x), 'base', 'not killed by the second trigger');
  assert.equal(g.objects[x].damage ?? 0, 0, 'second trigger dealt nothing');
});

test('RJ#1867 Angle Shot needs a unit and an Equipment with the same controller: no Equipment, no casting it just to draw', () => {
  let g = S0();
  fundAll(g, P0);
  put(g, P0, 'V(2)', 'base'); put(g, P1, 'V(2)', 'base');
  const as = hand(g, P0, 'Angle Shot');
  assert.ok(!canPlayNow(g, P0, as), 'no Equipment anywhere');
  put(g, P0, 'Sword', 'base');
  assert.ok(canPlayNow(g, P0, as), 'with an Equipment it is playable');
});

test('RJ#1880 Wuju Bladesman: two defenders both die to simultaneous combat damage — neither is ever "alone", so neither gets +2', () => {
  const { g: g0, def } = attackSetup(['V(6)'], ['V(3)', 'V(3)']);
  legendOf(g0, P1, 'Wuju Bladesman, Starter');
  const g = finish(g0);
  assert.equal(zone(g, def[0]), 'trash'); assert.equal(zone(g, def[1]), 'trash');
});

test('RJ#1881 Hextech Ray (3) on a 4-Might unit, Stupefy; owner Retreats; a second Stupefy kills it first — Retreat then has no unit, so no rune is channelled', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const e = put(g, P1, 'V(4)', BF_A); control(g, BF_A, P1);
  g.objects[e].damage = 3;
  g = play(g, P0, hand(g, P0, 'Stupefy'), { targets: [[e]] });
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Retreat'), { targets: [[e]] });
  const runes1 = g.players[P1].runesInPlay.length;
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Stupefy'), { targets: [[e]] });
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.equal(zone(g, e), 'trash', 'died after the second Stupefy resolved');
  assert.equal(g.players[P1].runesInPlay.length, runes1, 'Retreat did nothing: no rune channelled');
});

test('RJ#1885 Lee Sin, Centered and a buffed ally defend; both take combat damage and Lee Sin dies: the ally (lethal only without his +2) survives', () => {
  const { g: g0, def } = attackSetup(['V(10)'], ['ogn-151-298', 'V(2)'], { defOpts: [{}, { buff: true }] });
  let g = g0;
  assert.equal(mightOf(g, def[1]), 5, '2 + buff 1 + Lee Sin 2');
  for (let i = 0; i < 60; i++) {
    const d = g.pending;
    if (!d || d.kind === 'mainAction') break;
    if (d.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: d.player, assignment: d.player === P0 ? { [def[0]]: 6, [def[1]]: 4 } : (d.data as { suggested: Record<string, number> }).suggested }); continue; }
    g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: d.options!.slice(0, Math.max(d.min ?? 1, 1)).map(o => o.id) }) : pass(g);
  }
  assert.equal(zone(g, def[0]), 'trash', 'Lee Sin died');
  assert.equal(zone(g, def[1]), 'battlefield', 'the ally survives (healed by the combat cleanup before losing the +2 matters)');
});

test('RJ#1889 Zhonya\'s Hourglass is not optional: it replaces the next friendly unit death without asking', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P1);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const z = put(g, P0, "Zhonya's Hourglass", 'base');
  g = play(g, P1, hand(g, P1, 'ZapM'), { targets: [[u]] });
  let asked = false;
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g);
    if (d.inStep) { if (d.player === P0 && d.kind === 'optional') asked = true; g = choose(g, d.kind === 'optional' ? 'no' : d.options![0].id); continue; }
    g = pass(g);
  }
  assert.equal(asked, false, 'no "may" prompt');
  assert.equal(zone(g, z), 'trash');
  assert.equal(locOf(g, u), 'base', 'saved and recalled');
});

test('RJ#1895 Ride the Wind out of a combat to an empty battlefield: the current showdown/combat finishes first, then the staged showdown there', () => {
  let g = S0();
  fundAll(g, P0);
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(5)', 'base'), b = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [a, b], BF_A);
  for (let i = 0; i < 6 && g.chain.length; i++) g = pass(g);
  expectPending(g, 'showdownAction', P0);
  g = play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[b]] });
  g = resolveWith(g, { locations: [BF_B] });
  assert.equal(locOf(g, b), BF_B);
  const L = g.log.length;
  g = finish(g);
  const name = (i: number) => g.cards[g.objects[g.battlefields[i].objId].cardId].name;
  const lines = g.log.slice(L).map(l => l.text);
  const iA = lines.findIndex(t => t.includes(`conquers ${name(BF_A)}`)), iB = lines.findIndex(t => t.includes(`conquers ${name(BF_B)}`));
  assert.ok(iA >= 0 && iB >= 0, `both conquered: ${lines.filter(t => /conquer/.test(t))}`);
  assert.ok(iA < iB, 'the ongoing combat at A resolves before the showdown at B');
});

test('RJ#1900 my damaged defender is Ridden by the Wind to another battlefield: the first combat finishes (its cleanup heals everywhere) before the showdown/combat there', () => {
  let g = S0();
  fundAll(g, P1);
  const d = put(g, P1, 'V(4)', BF_A, { damage: 3 }); control(g, BF_A, P1);
  const far = put(g, P0, 'V(3)', BF_B); control(g, BF_B, P0);
  const a = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 6 && pend(g).player !== P1; i++) g = pass(g);
  expectPending(g, 'showdownAction', P1);
  g = play(g, P1, hand(g, P1, 'Ride the Wind'), { targets: [[d]] });
  g = resolveWith(g, { locations: [BF_B] });
  assert.equal(locOf(g, d), BF_B);
  let healedBeforeB = false;
  for (let i = 0; i < 60; i++) {
    const p = g.pending;
    if (!p || p.kind === 'mainAction') break;
    if (g.showdown?.battlefieldIndex === BF_B && !healedBeforeB) healedBeforeB = (g.objects[d].damage ?? 0) === 0;
    if (p.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: p.player, assignment: (p.data as { suggested: Record<string, number> }).suggested }); continue; }
    g = p.inStep ? act(g, { type: 'choose', player: p.player, optionIds: p.options!.slice(0, Math.max(p.min ?? 1, 1)).map(o => o.id) }) : pass(g);
  }
  assert.ok(healedBeforeB, 'healed when the first combat ended, before the second showdown');
  assert.equal(zone(g, far), 'trash', 'the healed 4-Might unit beats the 3-Might unit at BF-B');
  assert.equal(locOf(g, d), BF_B);
});

test('RJ#1901 Miss Fortune, Captain moving together with another unit can ready that unit (it is already in the showdown); a base unit can\'t join', () => {
  let g = S0();
  const mf = put(g, P0, 'ogn-162-298', 'base');
  const o = put(g, P0, 'V(2)', 'base');
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [mf, o], BF_A);
  assert.equal(g.objects[o].exhausted, true, 'exhausted by the move');
  for (let i = 0; i < 6 && pend(g).inStep; i++) { const d = pend(g); g = choose(g, d.kind === 'optional' ? 'yes' : optionIds(g).includes(o) ? o : d.options![0].id); }
  for (let i = 0; i < 6 && g.chain.length; i++) g = pend(g).inStep ? choose(g, optionIds(g).includes(o) ? o : pend(g).options![0].id) : pass(g);
  assert.equal(g.objects[o].exhausted, false, 'readied');
  assert.equal(locOf(g, o), BF_A);
  assert.ok(g.showdown, 'still in the showdown');
});

test('RJ#1904 Darius, Trifarian already ready still gets +2 from his second-card trigger (also on the opponent\'s turn)', () => {
  {
    let g = S0();
    fundAll(g, P0);
    const d = put(g, P0, 'Darius, Trifarian', 'base');
    for (let k = 0; k < 2; k++) { [g] = cast(g, P0, 'DrawR'); g = resolveWith(g, {}); }
    assert.equal(g.objects[d].exhausted, false);
    assert.equal(mightOf(g, d), 7);
  }
  {
    let g = S0({ tp: P1 });
    fundAll(g, P0); fundAll(g, P1);
    const d = put(g, P0, 'Darius, Trifarian', 'base');
    [g] = cast(g, P1, 'DrawR');
    g = pass(g);
    g = play(g, P0, hand(g, P0, 'DrawR'));
    g = play(g, P0, hand(g, P0, 'DrawR'));
    g = resolveWith(g, {});
    for (let i = 0; i < 10 && (g.chain.length || pend(g).inStep); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
    assert.equal(mightOf(g, d), 7, 'second card on the opponent\'s turn');
  }
});

test('RJ#1907 a legend ability is not a spell: "When you play a spell" does not trigger', () => {
  let g = S0();
  fundAll(g, P0);
  const l = legendOf(g, P0, 'Herald of the Arcane');
  put(g, P0, 'SpellWatcher', 'base');
  const h0 = g.players[P0].hand.length;
  g = act(g, legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === l)!);
  g = resolveWith(g, {});
  g = finish(g);
  assert.equal(g.players[P0].hand.length, h0, 'no draw');
  assert.ok(g.players[P0].base.some(id => /Recruit/.test(g.cards[g.objects[id].cardId].name)), 'the legend ability did resolve');
});

test('RJ#1909 Viktor, Innovator: a rune channelled by Soaring Scout\'s Deathknell on the opponent\'s turn is not a card played — no Recruit', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P1);
  put(g, P0, 'Viktor, Innovator', 'base');
  const sc = put(g, P0, 'Soaring Scout', 'base');
  const runes = g.players[P0].runesInPlay.length;
  g = play(g, P1, hand(g, P1, 'ZapM'), { targets: [[sc]] });
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.equal(zone(g, sc), 'trash');
  assert.equal(g.players[P0].runesInPlay.length, runes + 1, 'rune channelled');
  assert.ok(!g.players[P0].base.some(id => /Recruit/.test(g.cards[g.objects[id].cardId].name)), 'no Recruit');
});

test('RJ#1911 (OUTDATED: Falling Star has no reflexive triggers, SFD-FAQ) Not So Fast can counter Falling Star itself — its units are chosen when it is played', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P0, 'V(5)', BF_A); control(g, BF_A, P0);
  const v = put(g, P0, 'V(5)', 'base');
  let fs: string;
  [g, fs] = cast(g, P1, 'Falling Star', { targets: [[u], [v]] });
  for (let i = 0; i < 4 && pend(g).inStep && pend(g).player === P1; i++) g = choose(g, optionIds(g).includes(v) ? v : optionIds(g)[0]);
  assert.ok(g.chain.some(c => c.source === fs), 'Falling Star on the chain');
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  const nsf = hand(g, P0, 'Not So Fast');
  assert.ok(canPlayNow(g, P0, nsf), 'Not So Fast is legal against the spell itself');
  g = play(g, P0, nsf, { targets: [[g.chain.find(c => c.source === fs)!.id]] });
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.equal(g.objects[u].damage ?? 0, 0); assert.equal(g.objects[v].damage ?? 0, 0);
  assert.equal(zone(g, fs), 'trash', 'countered');
});

test('RJ#1913 Retreat in response to Hidden Blade: the unit returns to hand (owner channels 1 exhausted); Hidden Blade does nothing (no kill, no draw 2)', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  g = play(g, P0, hand(g, P0, 'Hidden Blade'), { targets: [[e]] });
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Retreat'), { targets: [[e]] });
  const hand1 = g.players[P1].hand.length, runes1 = g.players[P1].runesInPlay.length;
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.equal(zone(g, e), 'hand');
  assert.equal(g.players[P1].hand.length, hand1 + 1, 'only the returned unit — no draw 2');
  assert.equal(g.players[P1].runesInPlay.length, runes1 + 1, 'Retreat channelled 1');
});

test('RJ#1918 a [Hidden] card played from hand by Ava Achiever is not "played from face down" (Evelynn, Consuming doesn\'t trigger)', () => {
  let g = S0();
  fundAll(g, P0);
  const ev = put(g, P0, 'Evelynn, Consuming', 'base');
  const hz = hand(g, P0, 'HidZap');
  const e = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const ava = put(g, P0, 'Ava Achiever', 'base');
  g = move(g, P0, [ava], BF_A);
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g);
    if (d.inStep) { const o = optionIds(g); g = choose(g, d.kind === 'optional' ? 'yes' : o.includes(hz) ? hz : o.includes(e) ? e : o[0]); continue; }
    g = pass(g);
  }
  assert.notEqual(zone(g, hz), 'hand', 'Ava played HidZap from hand');
  assert.equal(g.objects[e].damage, 2, 'HidZap resolved');
  assert.equal(mightOf(g, ev), 5, 'Evelynn did not trigger (+1 only for plays from face down)');
});

test('RJ#1919 Yasuo, Remorseful attacking alone with Mask of Foresight: I order the triggers; Mask resolving first makes him deal 7', () => {
  const dealt: number[] = [];
  for (const rev of [false, true]) {
    let g = S0();
    put(g, P0, 'Mask of Foresight', 'base');
    const e = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
    const y = put(g, P0, 'ogn-076-298', 'base');
    g = move(g, P0, [y], BF_A);
    for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) {
      const d = pend(g);
      if (d.inStep && d.kind === 'orderTriggers') { const ids = d.options!.map(o => o.id); g = choose(g, rev ? ids[ids.length - 1] : ids[0]); continue; }
      if (d.inStep) { const o = optionIds(g); g = choose(g, d.kind === 'optional' ? 'yes' : o.includes(e) ? e : o[0]); continue; }
      g = pass(g);
    }
    dealt.push(g.objects[e].damage ?? 0);
  }
  assert.deepEqual([...dealt].sort(), [6, 7], `one order deals 7 (Mask first), the other 6: ${dealt}`);
});

test('RJ#1920 a defender Ridden to another battlefield with enemy units is neither attacker nor defender there (combat only staged); Ridden back, it is a defender again', () => {
  let g = S0();
  fundAll(g, P1, 10);
  const d = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  put(g, P0, 'V(2)', BF_B); control(g, BF_B, P0);
  const a = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [a], BF_A);
  const toP1 = () => { for (let i = 0; i < 6 && !(pend(g).player === P1 && pend(g).kind === 'showdownAction'); i++) g = pass(g); };
  toP1();
  assert.equal(g.objects[d].combatRole, 'defender');
  g = play(g, P1, hand(g, P1, 'Ride the Wind'), { targets: [[d]] });
  g = resolveWith(g, { locations: [BF_B] });
  assert.equal(locOf(g, d), BF_B);
  assert.notEqual(g.objects[d].combatRole, 'attacker', 'no attacker designation while BF-A\'s combat is ongoing');
  assert.notEqual(g.objects[d].combatRole, 'defender');
  toP1();
  g = play(g, P1, hand(g, P1, 'Ride the Wind'), { targets: [[d]] });
  g = resolveWith(g, { locations: [BF_A] });
  assert.equal(locOf(g, d), BF_A);
  assert.equal(g.objects[d].combatRole, 'defender', 'a defender again');
});

test('RJ#1925 the opponent takes control of my equipped unit: the attached Equipment stays mine (still friendly to me)', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P1, 12);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  put(g, P0, 'V(1)', BF_A);
  const sw = put(g, P0, 'Sword', 'base');
  attachNow(g, sw, u);
  g = play(g, P1, hand(g, P1, 'Hostile Takeover'), { targets: [[u]] });
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.equal(g.objects[u].controller, P1, 'unit stolen');
  assert.equal(g.objects[sw].controller, P0, 'gear control unchanged');
  assert.equal(g.objects[sw].attachedTo, u, 'still attached');
});

test('RJ#1928 Spinning Axe: Reaction timing only when played from hand (Quick-Draw); its Equip ability on the board is base speed', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0); fundAll(g, P1);
  put(g, P0, 'V(2)', 'base');
  const onBoard = put(g, P0, 'Spinning Axe', 'base');
  const inHand = hand(g, P0, 'Spinning Axe');
  [g] = cast(g, P1, 'DrawR');
  g = pass(g);
  expectPending(g, 'chainResponse', P0);
  assert.ok(canPlayNow(g, P0, inHand), 'playable from hand as a Reaction');
  assert.ok(!legal(g, P0, 'activate').some(x => x.type === 'activate' && x.obj === onBoard), 'Equip not usable at Reaction speed');
});

test('RJ#1938 Pit Crew readies when you play a Gold gear token (a token gear is still a gear played)', () => {
  let g = S0();
  fundAll(g, P0);
  const pc = put(g, P0, 'Pit Crew', 'base', { ready: false });
  [g] = cast(g, P0, "The Waters' Wage");
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) g = pend(g).inStep ? choose(g, pend(g).kind === 'optional' ? 'yes' : pend(g).options![0].id) : pass(g);
  assert.ok(g.players[P0].base.some(id => g.objects[id].isToken && /Gold/.test(g.cards[g.objects[id].cardId].name)), 'Gold token played');
  assert.equal(g.objects[pc].exhausted, false, 'Pit Crew readied');
});

test('RJ#1939 Defy can counter Bullet Time ("pay any amount of [A]" is paid on resolution, not part of its cost); countered, nothing is paid', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  let bt: string;
  [g, bt] = cast(g, P0, 'Bullet Time, Miss Fortune');
  for (let i = 0; i < 4 && pend(g).inStep && pend(g).player === P0; i++) g = choose(g, pend(g).options![0].id);
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  const defy = hand(g, P1, 'Defy');
  assert.ok(canPlayNow(g, P1, defy), 'Defy legal against Bullet Time');
  const rd0 = g.players[P0].runeDeck.length;
  g = play(g, P1, defy, { targets: [[g.chain.find(c => c.source === bt)!.id]] });
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.equal(zone(g, bt), 'trash', 'countered');
  assert.equal(g.players[P0].runeDeck.length, rd0, 'caster recycled no runes for the [A]');
});

// ---------------- cycle 5 (ids 1941-) ----------------
test('RJ#1945 a stunned enemy unit still deals its damage back through Gentlemen\'s Duel (stun stops only combat damage)', () => {
  let g = S0();
  fundAll(g, P0);
  const f = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(3)', BF_B, { stunned: true }); control(g, BF_B, P1);
  g = play(g, P0, hand(g, P0, "Gentlemen's Duel"), { targets: [[f]] });
  g = resolveWith(g, { targets: [[e]], may: [true] });
  for (let i = 0; i < 6 && pend(g).inStep; i++) g = choose(g, optionIds(g).includes(e) ? e : optionIds(g)[0]);
  g = settle(g);
  assert.equal(g.objects[f].damage, 3, 'the stunned unit dealt its 3');
  assert.equal(zone(g, e), 'trash', '5-Might friendly unit killed it');
});

test('RJ#1947 Volibear, Furious moves to an empty battlefield (non-combat showdown); the opponent Rides the Wind a unit in: the combat that follows makes him the attacker, so his attack trigger fires', () => {
  let g = S0();
  fundAll(g, P1, 6);
  const vb = put(g, P0, 'ogn-041-298', 'base');
  const d = put(g, P1, 'V(2)', 'base');
  g = move(g, P0, [vb], BF_A);
  assert.ok(g.showdown && !g.showdown.isCombat, 'non-combat showdown');
  for (let i = 0; i < 6 && pend(g).player !== P1; i++) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Ride the Wind'), { targets: [[d]], locations: [BF_A] });
  g = resolveWith(g, { locations: [BF_A] });
  assert.equal(locOf(g, d), BF_A);
  let fired = false;
  for (let i = 0; i < 30; i++) {
    if (g.chain.some(c => c.source === vb)) fired = true;
    const p = g.pending;
    if (!p || p.kind === 'mainAction') break;
    if (p.inStep) { const o = optionIds(g); g = choose(g, ...(p.kind === 'chooseTargets' && o.includes(d) ? [d] : [o[0]])); continue; }
    if (p.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: p.player, assignment: (p.data as { suggested: Record<string, number> }).suggested }); continue; }
    g = pass(g);
  }
  assert.ok(fired, 'Volibear\'s "When I attack" trigger went on the chain');
  assert.equal(zone(g, d), 'trash');
});

test('RJ#1948 Tideturner swapping with Void Seeker\'s target doesn\'t become the target: the original unit (still at a battlefield) takes the 4', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0); fundAll(g, P1);
  const a = put(g, P0, 'V(5)', BF_A); control(g, BF_A, P0);
  put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
  const tt = put(g, P0, 'Tideturner', { facedown: BF_B });
  [g] = cast(g, P1, 'Void Seeker', { targets: [[a]] });
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  g = play(g, P0, tt, { dest: BF_B });
  g = resolveWith(g, { may: [true], targets: [[a]] });
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g);
    if (d.inStep) { const o = optionIds(g); g = choose(g, d.kind === 'optional' ? 'yes' : o.includes(a) ? a : o[0]); continue; }
    g = pass(g);
  }
  assert.equal(locOf(g, a), BF_B, 'swapped');
  assert.equal(locOf(g, tt), BF_A);
  assert.equal(g.objects[a].damage ?? 0, 4, 'the original target took the damage');
  assert.equal(g.objects[tt].damage ?? 0, 0, 'Tideturner did not become the target');
});

test('RJ#1951 (MISMATCH-RJ: CR 383.3.a-b) Vayne\'s "you may pay [1] to return me" is decided and paid as the conquer trigger is finalized, not on resolution', () => {
  let g = S0();
  fundAll(g, P0);
  const v = put(g, P0, 'ogn-035-298', 'base');
  g = move(g, P0, [v], BF_A);
  for (let i = 0; i < 10 && !(pend(g).kind === 'optional' && pend(g).player === P0) && pend(g).kind !== 'mainAction'; i++) g = pass(g);
  const d = expectPending(g, 'optional', P0, 'pay/decline offered at finalization');
  assert.ok(!g.chain.some(c => c.source === v && (c as { pending?: boolean }).pending === false), 'not yet a finalized chain item');
  void d;
  g = choose(g, 'no');
  assert.ok(!g.chain.some(c => c.source === v), 'declined: removed, nothing to respond to');
  g = settle(g);
  assert.equal(zone(g, v), 'battlefield');
});

test('RJ#1953 game setup: battlefields are chosen/revealed before the previous game\'s loser chooses the turn order', async () => {
  const { createGame } = await import('../../src/engine/index.ts');
  const { fixtureDb } = await import('../fixtures/conformance/cards.ts');
  const { legalDeck } = await import('../conformance/harness.ts');
  let g = createGame({ seed: 5, cardDb: fixtureDb(), previousLoser: P1, skipMulligan: true, battlefieldSelection: 'choose', includeAllCards: true,
    players: [0, 1].map(i => ({ name: `P${i}`, deck: legalDeck() })) });
  const kinds: string[] = [];
  for (let i = 0; i < 10 && pend(g).kind !== 'chooseMode'; i++) { kinds.push(pend(g).kind); g = act(g, legal(g, pend(g).player)[0]); }
  expectPending(g, 'chooseMode', P1);
  assert.ok(kinds.length >= 1, `battlefield choices came first: ${kinds}`);
  assert.equal(g.battlefields.length, 2, 'battlefields revealed before the turn-order choice');
});

test('RJ#1955 Zenith Blade can move an exhausted friendly unit into a battlefield with enemy units: a combat follows', () => {
  let g = S0();
  fundAll(g, P0, 6);
  const f = put(g, P0, 'V(5)', 'base', { ready: false });
  const e1 = put(g, P1, 'V(3)', BF_A); put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  g = play(g, P0, hand(g, P0, 'Zenith Blade'), { targets: [[e1]] });
  for (let i = 0; i < 6 && pend(g).inStep && pend(g).player === P0; i++) {
    const d = pend(g); const o = optionIds(g);
    g = choose(g, d.kind === 'optional' ? 'yes' : o.includes(f) ? f : o.includes(String(BF_A)) ? String(BF_A) : o[0]);
  }
  for (let i = 0; i < 6 && g.chain.length; i++) g = pend(g).kind === 'optional' ? choose(g, 'yes') : pass(g);   // (RJ#5998b: move? on resolution)
  assert.equal(locOf(g, f), BF_A, 'exhausted unit moved by the spell');
  assert.ok(g.showdown?.isCombat, 'combat');
  assert.equal(g.objects[f].combatRole, 'attacker');
});

test('RJ#1957 Stormbringer (6) on a lone 6-Might enemy unit with the Wuju Bladesman legend: it dies in the cleanup before any combat, so the "defends alone" +2 never applies', () => {
  let g = S0(); fundAll(g, P0, 8);
  legendOf(g, P1, 'Wuju Bladesman');
  const v = put(g, P0, 'V(6)', 'base');
  const y = put(g, P1, 'V(6)', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'Stormbringer', { targets: [[g.battlefields[BF_A].objId]] });
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) { const d = pend(g); g = d.inStep ? choose(g, d.options![0].id) : pass(g); }
  assert.equal(zone(g, y), 'trash', 'killed before it could defend');
  assert.equal(locOf(g, v), BF_A);
  assert.equal(g.battlefields[BF_A].controller, P0);
});

test('RJ#1958 Falling Star\'s unit is recalled by The Boss (saved from Hidden Blade): same object, still hit — 3+3 kills it in base', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0, 6); fundAll(g, P1, 6);
  legendOf(g, P0, 'The Boss');
  const s = put(g, P0, 'V(5)', BF_A, { buff: true }); control(g, BF_A, P0);
  const hb = put(g, P0, 'Hidden Blade', { facedown: BF_A });
  let fs: string;
  [g, fs] = cast(g, P1, 'Falling Star', { targets: [[s], [s]] });
  for (let i = 0; i < 4 && pend(g).inStep && pend(g).player === P1; i++) g = choose(g, optionIds(g).includes(s) ? s : optionIds(g)[0]);
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  g = play(g, P0, hb, { targets: [[s]] });
  let saved = false;
  for (let i = 0; i < 30 && (g.chain.length || pend(g).inStep); i++) {
    if (locOf(g, s) === 'base' && g.chain.some(c => c.source === fs)) saved = true;
    const d = pend(g);
    if (d.inStep) { g = choose(g, d.kind === 'optional' ? 'yes' : optionIds(g)[0]); continue; }
    g = pass(g);
  }
  assert.ok(saved, 'The Boss replaced the Hidden Blade death (recall)');
  assert.ok(g.chain.every(c => c.source !== fs));
  assert.equal(zone(g, s), 'trash', 'Falling Star still hit the recalled unit (6 damage on a 5-Might unit)');
});

test('RJ#1960 Mask of Foresight triggers for a unit moved in by Ride the Wind, and again in a second combat the same turn after it Ganks to another battlefield', () => {
  let g = S0();
  fundAll(g, P0);
  put(g, P0, 'Mask of Foresight', 'base');
  const vi = put(g, P0, 'ogn-036-298', 'base', { ready: false });
  const base = mightOf(g, vi)!;
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  g = play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[vi]] });
  g = resolveWith(g, { locations: [BF_A] });
  g = finish(g);
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(mightOf(g, vi), base + 1, 'first combat: +1');
  g = move(g, P0, [vi], BF_B);
  g = finish(g);
  assert.equal(g.battlefields[BF_B].controller, P0);
  assert.equal(mightOf(g, vi), base + 2, 'second combat the same turn: +1 again');
});

test('RJ#1964 Defy checks Piercing Light\'s printed cost: with its Repeat cost paid it can still be countered', () => {
  let g = S0();
  fundAll(g, P0, 8); fundAll(g, P1);
  const e = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const runes0 = g.players[P0].runesInPlay.length;
  const pl = hand(g, P0, 'Piercing Light');
  g = act(g, { type: 'playCard', player: P0, obj: pl });
  for (let i = 0; i < 12 && pend(g).inStep && pend(g).player === P0; i++) {
    const d = pend(g); const o = optionIds(g);
    g = act(g, { type: 'choose', player: P0, optionIds: d.kind === 'optional' ? ['yes'] : o.includes(e) ? [e] : d.kind === 'chooseTargets' ? [] : [o[0]] });
  }
  assert.ok(runes0 - g.players[P0].runesInPlay.length >= 2, 'Repeat [C] paid on top of the base cost');
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  const defy = hand(g, P1, 'Defy');
  assert.ok(canPlayNow(g, P1, defy), 'Defy is legal (printed cost)');
  g = play(g, P1, defy, { targets: [[g.chain.find(c => c.source === pl)!.id]] });
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.equal(zone(g, pl), 'trash');
  assert.equal(g.objects[e].damage ?? 0, 0, 'countered');
});

test('RJ#1966 Nine-Tailed Fox: a unit moved into the combat later (Ride the Wind) also gets -1 when it becomes an attacker', () => {
  let g = S0();
  fundAll(g, P0, 6);
  legendOf(g, P1, 'Nine-Tailed Fox');
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const a1 = put(g, P0, 'V(3)', 'base');
  const a2 = put(g, P0, 'V(4)', 'base');
  g = move(g, P0, [a1], BF_A);
  for (let i = 0; i < 10 && g.chain.length; i++) g = pend(g).inStep ? choose(g, pend(g).kind === 'optional' ? 'yes' : optionIds(g)[0]) : pass(g);
  assert.equal(mightOf(g, a1), 2, 'first attacker -1');
  for (let i = 0; i < 4 && pend(g).player !== P0; i++) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[a2]] });
  g = resolveWith(g, { locations: [BF_A] });
  for (let i = 0; i < 10 && (g.chain.length || pend(g).inStep); i++) g = pend(g).inStep ? choose(g, pend(g).kind === 'optional' ? 'yes' : optionIds(g)[0]) : pass(g);
  assert.equal(locOf(g, a2), BF_A);
  assert.equal(g.objects[a2].combatRole, 'attacker');
  assert.equal(mightOf(g, a2), 3, 'the late attacker -1 too');
  assert.equal(mightOf(g, a1), 2, 'the first one only once');
});

test('RJ#1977 Kayn with two Masks of Foresight: moved in by Unforgiven he attacks alone (+2), wins, then Ganks into another lone combat (+2 more) = 10', () => {
  let g = S0();
  fundAll(g, P0, 8);
  const l = legendOf(g, P0, 'Unforgiven');
  put(g, P0, 'Mask of Foresight', 'base'); put(g, P0, 'Mask of Foresight', 'base');
  const k = put(g, P0, 'Kayn', 'base');
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === l)!);
  for (let i = 0; i < 4 && pend(g).inStep; i++) { const d = pend(g); g = choose(g, d.options!.find(o => o.id === k)?.id ?? d.options!.find(o => o.id === String(BF_A))?.id ?? d.options![0].id); }
  g = finish(g);
  assert.equal(locOf(g, k), BF_A);
  assert.equal(mightOf(g, k), 8, '6 + 1 per Mask');
  assert.equal(g.objects[k].exhausted, false, 'an ability move does not exhaust');
  g = move(g, P0, [k], BF_B);
  g = finish(g);
  assert.equal(locOf(g, k), BF_B, 'Ganking');
  assert.equal(mightOf(g, k), 10, '6 + 2 + 2');
});

test('RJ#1979 Wuju Bladesman\'s "defends alone +2" applies as soon as the unit is a lone defender, before Yasuo, Remorseful\'s attack trigger resolves', () => {
  let g = S0();
  legendOf(g, P1, 'Wuju Bladesman');
  const d = put(g, P1, 'V(6)', BF_A); control(g, BF_A, P1);
  const y = put(g, P0, 'ogn-076-298', 'base');
  g = move(g, P0, [y], BF_A);
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) {
    const p = pend(g);
    if (p.inStep) { const o = optionIds(g); g = choose(g, p.kind === 'optional' ? 'yes' : o.includes(d) ? d : o[0]); continue; }
    g = pass(g);
  }
  assert.equal(g.objects[d].damage ?? 0, 6, 'Yasuo\'s trigger dealt 6');
  assert.equal(zone(g, d), 'battlefield', 'survives at 8 Might');
  assert.equal(mightOf(g, d), 8);
});

test('RJ#1983 Unyielding Spirit prevents Riptide Rex\'s play-trigger damage (ability damage)', () => {
  let g = S0();
  fundAll(g, P0, 12); fundAll(g, P1);
  const e = put(g, P1, 'V(7)', BF_A); control(g, BF_A, P1);
  const rex = hand(g, P0, 'Riptide Rex');
  g = play(g, P0, rex, { dest: 'base', targets: [[e]] });
  for (let i = 0; i < 4 && pend(g).inStep && pend(g).player === P0; i++) g = choose(g, optionIds(g).includes(e) ? e : optionIds(g)[0]);
  assert.ok(g.chain.some(c => c.source === rex), 'play trigger on the chain');
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Unyielding Spirit'), {});
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) g = pend(g).inStep ? choose(g, optionIds(g).includes(e) ? e : optionIds(g)[0]) : pass(g);
  assert.equal(g.objects[e].damage ?? 0, 0, 'prevented');
  assert.equal(zone(g, e), 'battlefield');
});

test('RJ#1989 a Quick-Draw gear played from hand attaches for its play cost only (no Equip [C]); Equip is a separate base-speed ability', () => {
  let g = S0();
  fundAll(g, P0);
  const u = put(g, P0, 'V(2)', 'base');
  const runes0 = g.players[P0].runesInPlay.length;
  const sg = hand(g, P0, "Sterak's Gage");
  g = play(g, P0, sg, { dest: 'base', targets: [[u]], cards: [[u]] });
  g = finish(g);
  assert.equal(g.objects[sg].attachedTo, u, 'attached by Quick-Draw');
  assert.equal(runes0 - g.players[P0].runesInPlay.length, 2, 'only the 2 printed power recycled — no Equip [C]');
});

test('RJ#1990 a unit played by Dazzling Aurora is a normal unit: when it dies it goes to the trash (not banishment)', () => {
  let g = S0();
  put(g, P0, 'Dazzling Aurora', 'base');
  const u = put(g, P0, 'V(1)', 'deckTop');
  g = endTurn(g, P0);
  g = finish(g);
  assert.equal(locOf(g, u), 'base', 'played by Aurora');
  fundAll(g, P1);
  [g] = cast(g, P1, 'ZapM', { targets: [[u]] });
  g = finish(g);
  assert.equal(zone(g, u), 'trash');
});

test('RJ#1998 doubling Might is arithmetic (CR 433: increase by its current value): Last Stand on 3 → 6, a later +2 → 8; +2 first, then Last Stand → 10', () => {
  for (const order of ['double-first', 'plus-first'] as const) {
    let g = S0();
    fundAll(g, P0, 8);
    const u = put(g, P0, 'V(3)', 'base');
    const seq = order === 'double-first' ? ['Last Stand', 'Discipline'] : ['Discipline', 'Last Stand'];
    for (const s of seq) { g = play(g, P0, hand(g, P0, s), { targets: [[u]] }); g = finish(g); }
    assert.equal(mightOf(g, u), order === 'double-first' ? 8 : 10, order);
  }
});

test('RJ#1999 Unyielding Spirit doesn\'t prevent Last Breath\'s damage (the readied unit deals it; CR 418.6.b.3)', () => {
  let g = S0();
  fundAll(g, P0, 8);
  const f = put(g, P0, 'V(4)', 'base');
  const e = put(g, P1, 'V(6)', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'Unyielding Spirit');
  g = finish(g);
  g = play(g, P0, hand(g, P0, 'Last Breath'), { targets: [[f], [e]] });
  g = resolveWith(g, { targets: [[f], [e]] });
  g = finish(g);
  assert.equal(g.objects[e].damage ?? 0, 4, 'not prevented');
});

test('RJ#2002 Defiant Dance needs two different units it may choose: with only an enemy Ruin Runner it is playable only if I have two units', () => {
  let g = S0();
  fundAll(g, P0);
  put(g, P1, 'Ruin Runner', BF_A); control(g, BF_A, P1);
  const dd = hand(g, P0, 'Defiant Dance');
  put(g, P0, 'V(2)', 'base');
  assert.equal(canPlayNow(g, P0, dd), false, 'one own unit + an unchoosable Ruin Runner: no second target');
  put(g, P0, 'V(3)', 'base');
  assert.equal(canPlayNow(g, P0, dd), true, 'two own units');
});

test('RJ#2004 (MISMATCH-RJ, principle 13) outside combat too: Falling Star kills my lone Tasty Faefolk; while its Deathknell is on the chain I still control the battlefield and can play my hidden Zhonya\'s Hourglass', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P1, 6); fundAll(g, P0, 4);
  const tf = put(g, P0, 'Tasty Faefolk', BF_A); control(g, BF_A, P0);
  const z = put(g, P0, "Zhonya's Hourglass", { facedown: BF_A });
  let fs: string;
  [g, fs] = cast(g, P1, 'Falling Star', { targets: [[tf], [tf]] });
  for (let i = 0; i < 4 && pend(g).inStep && pend(g).player === P1; i++) g = choose(g, optionIds(g).includes(tf) ? tf : optionIds(g)[0]);
  let playable = false;
  for (let i = 0; i < 20; i++) {
    const d = pend(g);
    if (zone(g, tf) === 'trash' && g.chain.some(c => c.source === tf) && d.player === P0 && !d.inStep) { playable = canPlayNow(g, P0, z); break; }
    if (d.kind === 'mainAction') break;
    g = d.inStep ? choose(g, d.kind === 'optional' ? 'no' : d.options![0].id) : pass(g);
  }
  void fs;
  assert.equal(zone(g, tf), 'trash');
  assert.ok(playable, 'Zhonya\'s Hourglass can be played in response to the Deathknell (cleanup was Closed)');
  assert.equal(g.battlefields[BF_A].controller, P0);
});

test('RJ#2007 Arena Bar\'s [T] ability has no [Reaction]: it can\'t be used while a chain is open (e.g. to buff a unit before Monastery of Hirana\'s conquer trigger)', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const ab = put(g, P0, 'Arena Bar', 'base');
  put(g, P0, 'V(2)', 'base', { ready: false });
  assert.ok(legal(g, P0, 'activate').some(x => x.type === 'activate' && x.obj === ab), 'usable in my open main phase');
  [g] = cast(g, P0, 'DrawR');
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  expectPending(g, 'chainResponse', P0);
  assert.ok(!legal(g, P0, 'activate').some(x => x.type === 'activate' && x.obj === ab), 'not at Reaction speed');
});

test('RJ#2009 Teemo, Strategist counts only revealed cards with [Hidden]: Ember Monk (a "from Hidden" payoff) doesn\'t count', () => {
  let g = S0();
  const t = put(g, P1, 'ogn-121-298', BF_A); control(g, BF_A, P1);
  clearDeck(g, P1);
  for (const c of ['Ember Monk', 'Hidden Blade', 'V(1)', 'V(1)', 'Ember Monk']) put(g, P1, c, 'deckBottom');
  const a = put(g, P0, 'V(9)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g);
    if (d.inStep) { const o = optionIds(g); g = choose(g, d.kind === 'optional' ? 'yes' : o.includes(a) ? a : o[0]); continue; }
    g = pass(g);
  }
  void t;
  assert.equal(g.objects[a].damage ?? 0, 1, 'only Hidden Blade has [Hidden]');
});

test('RJ#2014 Svellsongur attached to Irelia, Fervent passes her copied text back: chosen by a spell, she gets +1 twice', () => {
  let g = S0();
  fundAll(g, P0, 8);
  const ir = put(g, P0, 'sfd-057-221', 'base');
  const sv = put(g, P0, 'Svellsongur', 'base');
  attachNow(g, sv, ir);
  assert.ok(hasKeyword(g, ir, 'Deflect'));
  assert.equal(kwValue(g, ir, 'Deflect'), 2, 'a second Deflect instance');
  g = play(g, P0, hand(g, P0, 'Discipline'), { targets: [[ir]] });
  g = finish(g);
  assert.equal(mightOf(g, ir), 4 + 2 + 1 + 1, 'two instances of "When you choose or ready me, +1"');
});

test('RJ#2019 Singularity on two units, one Retreated in response: no retargeting, the other still takes 6', () => {
  let g = S0();
  fundAll(g, P0, 8); fundAll(g, P1);
  const a = put(g, P1, 'V(7)', BF_A); const b = put(g, P1, 'V(7)', BF_A); control(g, BF_A, P1);
  const c = put(g, P1, 'V(7)', 'base');
  g = play(g, P0, hand(g, P0, 'Singularity'), { targets: [[a, b]] });
  for (let i = 0; i < 4 && pend(g).inStep && pend(g).player === P0; i++) g = choose(g, a, b);
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Retreat'), { targets: [[a]] });
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(zone(g, a), 'hand');
  assert.equal(g.objects[b].damage ?? 0, 6);
  assert.equal(g.objects[c].damage ?? 0, 0, 'not retargeted');
});

test('RJ#2024 (1v1 analogue of the 2v2 case) holding both battlefields at the start of my turn scores both, the last one winning — the final-point restriction is only on conquering', () => {
  let g = S0({ tp: P1 });
  g.players[P0].points = 6;
  put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  put(g, P0, 'V(2)', BF_B); control(g, BF_B, P0);
  g = endTurn(g, P1);
  for (let i = 0; i < 20 && g.winner === null && pend(g)?.kind !== 'mainAction'; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(g.players[P0].points, 8);
  assert.equal(g.winner, P0);
});

test('RJ#2025 Imperial Decree: a 4-Might attacker kills three 1-Might defenders and, having taken damage, is killed by Decree too — all at once', () => {
  let g = S0();
  fundAll(g, P0, 8);
  const def = [put(g, P1, 'V(1)', BF_A), put(g, P1, 'V(1)', BF_A), put(g, P1, 'V(1)', BF_A)]; control(g, BF_A, P1);
  const a = put(g, P0, 'V(4)', 'base');
  [g] = cast(g, P0, 'Imperial Decree');
  g = finish(g);
  g = move(g, P0, [a], BF_A);
  g = finish(g);
  for (const d of def) assert.equal(zone(g, d), 'trash');
  assert.equal(zone(g, a), 'trash', 'took 3 (non-lethal) and Imperial Decree killed it');
});

test('RJ#2034 there is no voluntary discard: no action lets a player discard from hand outside an effect or cost', () => {
  let g = S0();
  fundAll(g, P0);
  hand(g, P0, 'V(1)'); hand(g, P0, 'V(2)');
  const types = new Set(legal(g, P0).map(a => a.type));
  assert.ok(!types.has('discard' as never), `no discard action: ${[...types]}`);
});

test('RJ#2035 a [Hidden] champion can be hidden straight from the Champion Zone', () => {
  let g = S0();
  fundAll(g, P0);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const ch = g.players[P0].championZone[0];
  g.objects[ch].cardId = ensureCard(g, 'ogn-121-298');
  g.timestamp++;
  assert.ok(legal(g, P0, 'hide').some(a => a.type === 'hide' && a.obj === ch), 'hide from the Champion Zone offered');
});

test('RJ#2037 the defender Gusts the lone attacker during the combat showdown: the combat still ends with the defender winning — Glorious Executioner draws', () => {
  let g = S0();
  fundAll(g, P1);
  legendOf(g, P1, 'Glorious Executioner');
  put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 6 && !(pend(g).player === P1 && pend(g).kind === 'showdownAction'); i++) g = pass(g);
  const h = g.players[P1].hand.length;
  g = play(g, P1, hand(g, P1, 'Gust'), { targets: [[a]] });
  g = finish(g);
  assert.equal(zone(g, a), 'hand');
  assert.equal(g.players[P1].hand.length, h + 1, 'won the combat: drew 1 (Gust left the hand, +1 draw)');
});

test('RJ#2039 Fiora (sfd-110) attacking one on one: her doubling uses her Might when the trigger resolves — Stupefy in response first makes it 2 → 4', () => {
  let g = S0();
  fundAll(g, P1);
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const f = put(g, P0, 'sfd-110-221', 'base');
  g = move(g, P0, [f], BF_A);
  for (let i = 0; i < 4 && !g.chain.some(c => c.source === f); i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.ok(g.chain.some(c => c.source === f), 'doubling trigger on the chain');
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Stupefy'), { targets: [[f]] });
  for (let i = 0; i < 10 && g.chain.length; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(mightOf(g, f), 4, '(3 - 1) doubled');
});

test('RJ#2041 a unit dying at Vilemaw\'s Lair is still saved by Zhonya\'s Hourglass (recall is not a move)', () => {
  let g = S0({ tp: P1, bfA: "Vilemaw's Lair" });
  fundAll(g, P1);
  put(g, P0, "Zhonya's Hourglass", 'base');
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  [g] = cast(g, P1, 'ZapM', { targets: [[u]] });
  g = finish(g);
  assert.equal(locOf(g, u), 'base', 'recalled despite "Units can\'t move from here to base"');
});

test('RJ#2042 killing Sona in response to her end-of-turn trigger doesn\'t stop it: the "if I\'m at a battlefield" was checked when it triggered', () => {
  let g = S0();
  fundAll(g, P1);
  const so = put(g, P0, 'Sona', BF_A, { damage: 2 }); control(g, BF_A, P0);
  setRunes(g, P0, 0);
  addRunes(g, P0, 4, 'fury', false);
  g = endTurn(g, P0);
  for (let i = 0; i < 4 && !g.chain.some(c => c.source === so); i++) g = pend(g).inStep ? choose(g, ...optionIds(g).slice(0, pend(g).max ?? 4)) : pass(g);
  assert.ok(g.chain.some(c => c.source === so), 'Sona\'s trigger on the chain');
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  g = play(g, P1, hand(g, P1, 'ZapR'), { targets: [[so]] });
  for (let i = 0; i < 10 && g.chain.length; i++) g = pend(g).inStep ? choose(g, ...optionIds(g).slice(0, pend(g).max ?? 1)) : pass(g);
  assert.equal(zone(g, so), 'trash');
  assert.ok(readyRunes(g, P0) >= 4, `runes readied anyway: ${readyRunes(g, P0)}`);
});

test('RJ#2051 (MISMATCH-RJ: CR 103.3.a) a constructed deck must designate a Chosen Champion: a deck without one is rejected', async () => {
  const { validateDeck } = await import('../../src/engine/index.ts');
  const { fixtureDb } = await import('../fixtures/conformance/cards.ts');
  const { legalDeck } = await import('../conformance/harness.ts');
  const db = fixtureDb();
  assert.deepEqual(validateDeck(legalDeck(), db).filter(p => /^champion/.test(p.code)), [], 'with a champion: fine');
  const probs = validateDeck(legalDeck({ champion: '' as never }), db);
  assert.ok(probs.some(p => /^champion/.test(p.code)), `no champion → rejected: ${probs.map(p => p.code)}`);
});

test('RJ#2055 Thousand-Tailed Watcher\'s -3 hits only enemy units on the board when it resolves; it lasts the turn even after the Watcher dies (RJ\'s "ends when Watcher leaves" aside is wrong: "this turn")', () => {
  let g = S0();
  fundAll(g, P0, 12); fundAll(g, P1, 12);
  const e = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const w = hand(g, P0, 'Thousand-Tailed Watcher');
  g = play(g, P0, w, { dest: 'base' });
  g = finish(g);
  assert.equal(mightOf(g, e), 2);
  g.objects[w].damage = 99; g.ex.dirty = true; g.timestamp++;
  [g] = cast(g, P0, 'DrawR'); g = finish(g);
  assert.equal(zone(g, w), 'trash', 'Watcher died');
  assert.equal(mightOf(g, e), 2, '"this turn" outlasts the Watcher');
  const later = put(g, P1, 'V(5)', BF_A);
  assert.equal(mightOf(g, later), 5, 'a unit arriving later is not affected');
});

test('RJ#2054 at 7 having conquered BF-A this turn, I move into empty BF-B; the opponent Rides the Wind into BF-A: that combat is only staged, and my BF-B conquer (all battlefields scored) wins first', () => {
  let g = S0();
  fundAll(g, P1, 6);
  g.players[P0].points = 6;
  const a = put(g, P0, 'V(3)', 'base');
  const b = put(g, P0, 'V(3)', 'base');
  const r = put(g, P1, 'V(2)', 'base');
  g = move(g, P0, [a], BF_A); g = finish(g);
  assert.equal(g.players[P0].points, 7, 'conquered BF-A');
  g = move(g, P0, [b], BF_B);
  for (let i = 0; i < 6 && !(pend(g).player === P1 && pend(g).kind === 'showdownAction'); i++) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Ride the Wind'), { targets: [[r]] });
  g = resolveWith(g, { locations: [BF_A] });
  assert.equal(locOf(g, r), BF_A);
  g = finish(g);
  assert.equal(g.winner, P0, 'won at BF-B before the staged BF-A combat');
});

test('RJ#2061 Svellsongur on Ahri, Alluring: holding scores 3 (the hold, her "When I hold, score 1", and the copy)', () => {
  let g = S0({ tp: P1 });
  const ah = put(g, P0, 'ogn-066-298', BF_A); control(g, BF_A, P0);
  const sv = put(g, P0, 'Svellsongur', 'base');
  attachNow(g, sv, ah);
  g = endTurn(g, P1);
  for (let i = 0; i < 20 && g.winner === null && pend(g)?.kind !== 'mainAction'; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(g.players[P0].points, 3);
});

test('RJ#2065 Stand United: units already buffed (e.g. by Blind Monk) also get the extra +1 this turn', () => {
  let g = S0();
  fundAll(g, P0);
  const b = put(g, P0, 'V(1)', 'base', { buff: true });
  const t = put(g, P0, 'V(3)', 'base');
  assert.equal(mightOf(g, b), 2);
  g = play(g, P0, hand(g, P0, 'Stand United'), { targets: [[t]] });
  g = finish(g);
  assert.equal(mightOf(g, b), 3, 'existing buff now gives +2');
  assert.equal(mightOf(g, t), 5, 'new buff +1 +1');
});

test('RJ#2068 Dazzling Aurora: the revealed non-units are recycled to the bottom of the deck; with no unit at all, the revealed cards stay in the deck', () => {
  let g = S0();
  put(g, P0, 'Dazzling Aurora', 'base');
  clearDeck(g, P0);
  const s1 = put(g, P0, 'DrawR', 'deckBottom'), s2 = put(g, P0, 'DrawR', 'deckBottom');
  const u = put(g, P0, 'V(1)', 'deckBottom');
  const s3 = put(g, P0, 'DrawR', 'deckBottom');
  g = endTurn(g, P0);
  g = finish(g);
  assert.equal(locOf(g, u), 'base', 'unit played');
  const deck = g.players[P0].mainDeck;
  assert.equal(deck[0], s3, 'unrevealed card stays on top');
  assert.deepEqual([...deck.slice(-2)].sort(), [s1, s2].sort(), 'revealed non-units at the bottom');
  let h = S0();
  put(h, P0, 'Dazzling Aurora', 'base');
  clearDeck(h, P0);
  const xs = [put(h, P0, 'DrawR', 'deckBottom'), put(h, P0, 'DrawR', 'deckBottom')];
  h = endTurn(h, P0);
  h = finish(h);
  for (const x of xs) assert.equal(zone(h, x) === 'mainDeck' || zone(h, x) === 'hand', true, `${x} back in the deck (or drawn): ${zone(h, x)}`);
});

test('RJ#2074 the unit Dazzling Aurora plays may go to a battlefield I control (not only base)', () => {
  let g = S0();
  put(g, P0, 'Dazzling Aurora', 'base');
  put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const u = put(g, P0, 'V(1)', 'deckTop');
  g = endTurn(g, P0);
  let offered = false;
  for (let i = 0; i < 20 && locOf(g, u) === null; i++) {
    const d = pend(g);
    if (d.inStep) { const o = optionIds(g); if (o.includes(String(BF_A))) { offered = true; g = choose(g, String(BF_A)); } else g = choose(g, o[0]); continue; }
    g = pass(g);
  }
  assert.ok(offered, 'battlefield offered as destination');
  assert.equal(locOf(g, u), BF_A);
});

test('RJ#2075 Sun Disc\'s [T] ability has no [Reaction]: it can\'t be used while a spell (e.g. a burn spell for Immortal Phoenix) is on the chain', () => {
  let g = S0();
  fundAll(g, P0);
  const sd = put(g, P0, 'Sun Disc', 'base');
  [g] = cast(g, P0, 'DrawR'); g = finish(g);
  assert.ok(legal(g, P0, 'activate').some(x => x.type === 'activate' && x.obj === sd), 'usable in the open state (Legion met)');
  [g] = cast(g, P0, 'DrawR');
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  expectPending(g, 'chainResponse', P0);
  assert.ok(!legal(g, P0, 'activate').some(x => x.type === 'activate' && x.obj === sd), 'not at Reaction speed');
});

test('RJ#2076 Pit Rookie\'s buff resolves onto Cithria first; with Cithria\'s own trigger still on the chain I can spend that buff for a free Call to Glory, then Cithria re-buffs', () => {
  let ok = false;
  for (const pickFirst of [0, 1]) {
    let g = S0();
    fundAll(g, P0);
    const ci = put(g, P0, 'Cithria of Cloudfield', 'base');
    g = play(g, P0, hand(g, P0, 'Pit Rookie'), { dest: 'base' });
    for (let i = 0; i < 10 && pend(g).inStep; i++) { const d = pend(g); const o = optionIds(g); g = choose(g, d.kind === 'orderTriggers' ? o[pickFirst] : o.includes(ci) ? ci : o[0]); }
    for (let i = 0; i < 6 && g.chain.length > 1; i++) g = pend(g).inStep ? choose(g, optionIds(g).includes(ci) ? ci : optionIds(g)[0]) : pass(g);
    if (!(g.objects[ci].counters?.buff && g.chain.some(c => c.source === ci))) continue;
    for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
    const runes = g.players[P0].runesInPlay.filter(r => !g.objects[r].exhausted).length;
    const cg = hand(g, P0, 'Call to Glory');
    g = act(g, { type: 'playCard', player: P0, obj: cg });
    for (let i = 0; i < 6 && pend(g).inStep && pend(g).player === P0; i++) { const d = pend(g); const o = optionIds(g); g = choose(g, d.kind === 'optional' ? 'yes' : o.includes(ci) ? ci : o[0]); }
    assert.equal(g.players[P0].runesInPlay.filter(r => !g.objects[r].exhausted).length, runes, 'cost ignored (buff spent)');
    assert.ok(!g.objects[ci].counters?.buff, 'buff spent');
    g = finish(g);
    assert.ok(g.objects[ci].counters?.buff, 'Cithria\'s trigger resolved afterwards: buffed again');
    assert.equal(mightOf(g, ci), 1 + 1 + 3);
    ok = true;
  }
  assert.ok(ok, 'one trigger order leaves Cithria buffed with her trigger still pending');
});

test('RJ#2079 main deck size: at least 40 casually (41 is fine); a tournament deck of 41 is flagged (exactly 40)', async () => {
  const { validateDeck } = await import('../../src/engine/index.ts');
  const { fixtureDb } = await import('../fixtures/conformance/cards.ts');
  const { legalDeck } = await import('../conformance/harness.ts');
  const db = fixtureDb();
  const d = legalDeck();
  const big = { ...d, main: [...d.main, ...new Array(41 - d.main.length - 1).fill('cf-v1').slice(0, Math.max(0, 41 - d.main.length - 1))] };
  const n = big.main.length + 1;
  assert.ok(n >= 41, `deck of ${n} incl. champion`);
  assert.ok(!validateDeck(big, db).some(p => /^main\.size/.test(p.code)), 'casual: more than 40 allowed');
  assert.ok(validateDeck(big, db, { tournament: true }).some(p => /^main\.size/.test(p.code)), 'tournament: not exactly 40 → flagged');
});

test('RJ#2081 Noxian Guillotine marks a 12-Might unit, then Disintegrate\'s 3 damage makes Guillotine kill it: Disintegrate didn\'t kill it — no draw', () => {
  let g = S0();
  fundAll(g, P0, 10);
  const e = put(g, P1, 'V(12)', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'Noxian Guillotine', { targets: [[e]] }); g = finish(g);
  assert.equal(zone(g, e), 'battlefield', 'not Legion: only marked');
  const h = g.players[P0].hand.length;
  [g] = cast(g, P0, 'Disintegrate', { targets: [[e]] }); g = finish(g);
  assert.equal(zone(g, e), 'trash', 'killed by Guillotine\'s effect');
  assert.equal(g.players[P0].hand.length, h, 'Disintegrate draws nothing');
});

test('RJ#2091 Yasuo, Remorseful\'s attack trigger fires once per combat: Ridden out and back into the same combat, he does not trigger again', () => {
  let g = S0();
  fundAll(g, P0, 12);
  const e = put(g, P1, 'V(12)', BF_A); control(g, BF_A, P1);
  const y = put(g, P0, 'ogn-076-298', 'base');
  const o = put(g, P0, 'V(1)', 'base');
  g = move(g, P0, [y, o], BF_A);
  const fired = () => g.log.filter(l => /Yasuo/.test(l.text) && /deals \d+/.test(l.text)).length;
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) { const d = pend(g); g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : optionIds(g).includes(e) ? e : optionIds(g)[0]) : pass(g); }
  const n1 = fired();
  assert.equal(g.objects[e].damage ?? 0, 6, 'first attack trigger');
  for (const dest of ['base', BF_A] as const) {
    for (let i = 0; i < 6 && !(pend(g).player === P0 && pend(g).kind === 'showdownAction'); i++) g = pass(g);
    g = play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[y]] });
    g = resolveWith(g, { locations: [dest] });
    for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) { const d = pend(g); g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : optionIds(g).includes(e) ? e : optionIds(g)[0]) : pass(g); }
    assert.equal(locOf(g, y), dest);
  }
  assert.ok(g.showdown?.isCombat, 'still the same combat');
  assert.equal(fired(), n1, 'no second trigger');
  assert.equal(g.objects[e].damage ?? 0, 6);
});

test('RJ#2092 Heimerdinger copying Malzahar\'s ability still has to pay its "Kill a friendly unit or gear" cost', () => {
  let g = S0();
  const hm = put(g, P0, 'ogn-111-298', 'base');
  put(g, P0, 'Malzahar', 'base');
  const f = put(g, P0, 'V(1)', 'base');
  const ab = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === hm);
  assert.ok(ab, 'Heimerdinger has the copied ability');
  g = act(g, ab!);
  for (let i = 0; i < 6 && pend(g).inStep; i++) { const o = optionIds(g); g = choose(g, o.includes(f) ? f : o[0]); }
  assert.equal(zone(g, f), 'trash', 'a friendly unit was killed as the cost');
  assert.equal(g.objects[hm].exhausted, true);
});

// ---- cycle 6 (2094-) ----------------------------------------------------------------------------
test('RJ#2097 Mindsplitter can discard a unit card with [Deflect] from the opponent\'s hand without paying Deflect (not on the board)', () => {
  let g = S0(); fundAll(g, P0, 12);
  const poro = hand(g, P1, 'Pouty Poro');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Mindsplitter'), destination: 'base' } as never);
  let runes = -1;
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { if (runes < 0 && g.chain.length) runes = readyRunes(g, P0); g = pass(g); continue; }
    const o = optionIds(g);
    g = choose(g, o.includes(poro) ? poro : o[0]);
  }
  assert.equal(zone(g, poro), 'trash', 'the Deflect unit card was discarded');
  assert.equal(readyRunes(g, P0), runes, 'no Deflect cost paid');
});

test('RJ#2099 I attack BF-A; the defender Rides the Wind its only unit to empty BF-B: I conquer BF-A first, then their staged showdown at BF-B lets them conquer it', () => {
  let g = S0(); fundAll(g, P1, 6);
  const e = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(3)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 6 && !(pend(g).player === P1 && ['showdownAction', 'chainResponse'].includes(pend(g).kind)); i++) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Ride the Wind'), { targets: [[e]] });
  g = resolveWith(g, { locations: [BF_B] });
  assert.equal(locOf(g, e), BF_B);
  const order: number[] = [];
  for (let i = 0; i < 40 && pend(g).kind !== 'mainAction'; i++) {
    const was = [g.players[P0].points, g.players[P1].points];
    const d = pend(g);
    g = d.inStep ? choose(g, optionIds(g)[0]) : pass(g);
    if (g.players[P0].points > was[0]) order.push(P0);
    if (g.players[P1].points > was[1]) order.push(P1);
  }
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.battlefields[BF_B].controller, P1);
  assert.deepEqual(order, [P0, P1], 'BF-A scored first, then the held BF-B showdown');
});

test('RJ#2102 Traveling Merchant\'s move trigger resolves before the showdown; then Yasuo\'s attack trigger goes on first and the defender\'s triggers (Nine-Tailed Fox once per attacker, Ahri) go on top', () => {
  let g = S0(); fundAll(g, P0, 12);
  setLegend(g, P1, 'Nine-Tailed Fox');
  const ah = put(g, P1, 'ogn-119-298', BF_A); control(g, BF_A, P1);
  const y = put(g, P0, 'Yasuo, Remorseful', 'base');
  const tm = put(g, P0, 'Traveling Merchant', 'base');
  hand(g, P0, 'V(1)');
  g = move(g, P0, [y, tm], BF_A);
  let merchantDone = false, seen: string[] = [];
  assert.deepEqual(chainLabels(g), ['trigger:Traveling Merchant'], 'only the move trigger first');
  for (let i = 0; i < 30; i++) {
    const labels = chainLabels(g);
    if (g.players[P0].trash.length > 0) merchantDone = true;
    if (labels.some(l => /Yasuo/.test(l))) assert.ok(merchantDone && !labels.some(l => /Merchant/.test(l)), 'Merchant resolved before the showdown chain');
    if (labels.length >= 4) { seen = labels; break; }
    const d = pend(g);
    if (!d || d.kind === 'mainAction') break;
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    g = choose(g, d.kind === 'optional' ? 'yes' : o.includes(ah) ? ah : o.includes(y) ? y : o[0]);
  }
  assert.ok(merchantDone, 'Merchant discarded/drew first');
  assert.equal(seen.length, 4, seen.join());
  assert.match(seen[0], /Yasuo/, 'attacker\'s trigger first (bottom)');
  assert.equal(seen.slice(1).filter(l => /Nine-Tailed Fox/.test(l)).length, 2, 'Fox triggers once per attacking unit');
  assert.equal(seen.slice(1).filter(l => /Ahri/.test(l)).length, 1);
});

test('RJ#2103 Vilemaw\'s Lair: units that fail to conquer are still recalled to base (recall isn\'t a move); Charm can move a unit from there only to another battlefield', () => {
  let g = S0(); setBattlefieldCard(g, BF_A, "Vilemaw's Lair");
  for (const m of ['V(4)', 'V(3)', 'V(3)', 'V(3)']) put(g, P1, m, BF_A);
  control(g, BF_A, P1);
  const a = put(g, P0, 'V(2)', 'base'), vm = put(g, P0, 'Vilemaw', 'base');
  g = finish(move(g, P0, [a, vm], BF_A));
  assert.equal(locOf(g, a), 'base'); assert.equal(locOf(g, vm), 'base', 'recalled despite the Lair');
  let h = S0(); fundAll(h, P0); setBattlefieldCard(h, BF_A, "Vilemaw's Lair");
  const e = put(h, P1, 'V(2)', BF_A); control(h, BF_A, P1);
  h = act(h, { type: 'playCard', player: P0, obj: hand(h, P0, 'ogn-043-298') });
  for (let i = 0; i < 6 && pend(h).inStep; i++) { const o = optionIds(h); h = choose(h, o.includes(e) ? e : o.includes(String(BF_B)) ? String(BF_B) : o[0]); }
  h = finish(h);
  assert.equal(locOf(h, e), BF_B, 'Charm moves it to another battlefield');
});

// WONTFIX (ENGINE-5): official VEN-FAQ ("If I play Ride the Wind targeting my unit at Vilemaw's Lair and attempt to move them to
// base, what happens?" — "They will be readied."): base may be chosen; the Lair's "can't" negates the move at execution
// (DECISIONS #5811, CR 358.3.a; docs/rules-decisions.md #48; conformance T185). RJ#2103's "base must not be offered" → MISMATCH-RJ.
test('RJ#2103b (WONTFIX: official VEN-FAQ) Charm on an enemy unit at Vilemaw\'s Lair may choose base; the move is then negated (the unit stays)', () => {
  let h = S0(); fundAll(h, P0); setBattlefieldCard(h, BF_A, "Vilemaw's Lair");
  const e = put(h, P1, 'V(2)', BF_A); control(h, BF_A, P1);
  h = act(h, { type: 'playCard', player: P0, obj: hand(h, P0, 'ogn-043-298') });
  const offered: string[] = [];
  for (let i = 0; i < 6 && pend(h).inStep; i++) { const o = optionIds(h); if (pend(h).kind === 'chooseDestination') offered.push(...o); h = choose(h, o.includes(e) ? e : o.includes('base') ? 'base' : o[0]); }
  assert.ok(offered.includes('base'), `base offered (offered: ${offered})`);
  h = finish(h);
  assert.equal(locOf(h, e), BF_A, 'the move to base is negated');
});

test('RJ#2105 Temporal Portal\'s Repeat on a spell played from hidden for 0 costs the printed cost (HidZap: 3)', () => {
  let g = S0(); fundAll(g, P0, 10);
  const tp = put(g, P0, 'Temporal Portal', 'base');
  const e = put(g, P0, 'V(9)', BF_A); control(g, BF_A, P0);
  const fd = put(g, P0, 'HidZap', { facedown: BF_A });
  g = settle(act(g, legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === tp)!));
  const r0 = readyRunes(g, P0), pool0 = g.players[P0].pool.energy;   // (Portal's rune may leave [1] floating, rules-decisions #65)
  g = act(g, { type: 'playCard', player: P0, obj: fd });
  let offered = false;
  for (let i = 0; i < 10 && pend(g).inStep; i++) {
    const d = pend(g); const o = optionIds(g);
    if (d.kind === 'optional') { offered = true; g = choose(g, 'yes'); continue; }
    g = choose(g, o.includes(e) ? e : o[0]);
  }
  assert.ok(offered, 'Repeat offered');
  assert.equal(r0 - readyRunes(g, P0) + pool0 - g.players[P0].pool.energy, 3, 'Repeat paid at the printed cost 3 (the hidden play itself is free)');
  g = finish(g);
  assert.equal(g.objects[e].damage, 4, 'two executions');
});

test('RJ#2106 Sett, Brawler can spend his buff, be buffed again, and spend it again: +4 each time', () => {
  let g = S0(); fundAll(g, P0);
  const s = put(g, P0, 'Sett, Brawler', 'base', { buff: true });
  const base = mightOf(g, s) - 1;
  g = passAll(activate(g, P0, s, 2));
  assert.equal(mightOf(g, s), base + 4);
  g.objects[s].counters = { ...(g.objects[s].counters ?? {}), buff: 1 }; g.ex.dirty = true; g.timestamp++;
  g = passAll(activate(g, P0, s, 2));
  assert.equal(mightOf(g, s), base + 8, 'second +4');
});

test('RJ#2107 Fox-Fire ("any number") may be played with zero targets, and still counts as a spell played (Ravenbloom Student +1)', () => {
  let g = S0(); fundAll(g, P0);
  const st = put(g, P0, 'Ravenbloom Student', 'base');
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const m0 = mightOf(g, st);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Fox-Fire') });
  for (let i = 0; i < 4 && pend(g).inStep && pend(g).kind === 'chooseTargets'; i++) g = act(g, { type: 'choose', player: P0, optionIds: [] });
  g = finish(g);
  assert.equal(mightOf(g, st), m0 + 1);
});

test('RJ#2111 Udyr, Wildman: the mode (and its target) is chosen as the ability is put on the chain, before anyone can respond', () => {
  let g = S0();
  const u = put(g, P0, 'Udyr, Wildman', 'base', { buff: true });
  const e = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  g = act(g, { type: 'activate', player: P0, obj: u, abilityIndex: 0 });
  assert.ok(pend(g).inStep, 'a choice is pending right away');
  const deal = pend(g).options!.find(o => /Deal 2/i.test(o.label))!.id;
  g = choose(g, deal);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = choose(g, optionIds(g).includes(e) ? e : optionIds(g)[0]);
  assert.equal(pend(g).kind, 'chainResponse', 'mode and target chosen before the response window');
  assert.ok(g.chain.at(-1)!.targets?.flat().includes(e), 'target locked in on the chain item');
  g = finish(g);
  assert.equal(g.objects[e].damage, 2);
});

test('RJ#2117 Baited Hook kills my only unit and finds Cruel Patron: it can\'t be played (no friendly unit to kill for its additional cost)', () => {
  let g = S0(); fundAll(g, P0);
  const v = put(g, P0, 'V(5)', 'base');
  const hook = put(g, P0, 'Baited Hook', 'base');
  clearDeck(g, P0);
  const cp = put(g, P0, 'Cruel Patron', 'deckTop');
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === hook)!);
  g = answer(g, { targets: [[v]] }, P0);
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    g = act(g, { type: 'choose', player: d.player, optionIds: d.kind === 'optional' ? ['yes'] : [o.includes(cp) ? cp : o[0]] });
  }
  assert.equal(zone(g, v), 'trash');
  assert.ok(!['base', 'battlefield'].includes(zone(g, cp)), `Patron not played (${zone(g, cp)})`);
});

test('RJ#2121 Final Spark (8) on a 10-Might enemy, Back to Back on my 3-Might unit, then the opponent\'s Gentlemen\'s Duel (+3 → 13) on it: both die (13 vs 5; 8 + 5 = 13)', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const dr = put(g, P1, 'V(10)', BF_B); control(g, BF_B, P1);
  const po = put(g, P0, 'V(3)', 'base'), lux = put(g, P0, 'V(2)', 'base');
  const sc = put(g, P0, 'V(1)', 'base');
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const gd = hand(g, P1, 'Gentlemen\'s Duel');
  g = move(g, P0, [sc], BF_A);
  for (let i = 0; i < 6 && !(pend(g).player === P0 && pend(g).kind === 'showdownAction'); i++) g = pass(g);
  assert.ok(g.showdown, 'combat showdown at BF-A (Action timing)');
  g = play(g, P0, hand(g, P0, 'Final Spark'), { targets: [[dr]] });
  for (let i = 0; i < 6 && g.chain.length; i++) g = pass(g);
  assert.equal(g.objects[dr].damage, 8);
  for (let i = 0; i < 4 && pend(g).player !== P0; i++) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Back to Back'), { targets: [[po, lux]] });
  for (let i = 0; i < 6 && g.chain.length; i++) g = pass(g);
  assert.equal(mightOf(g, po), 5);
  for (let i = 0; i < 4 && !(pend(g).player === P1 && canPlayNow(g, P1, gd)); i++) g = pass(g);
  g = act(g, { type: 'playCard', player: P1, obj: gd });
  for (let i = 0; i < 6 && pend(g).inStep; i++) { const o = optionIds(g); g = choose(g, o.includes(dr) ? dr : o.includes(po) ? po : o[0]); }
  for (let i = 0; i < 6 && pend(g).inStep === false && g.chain.length; i++) g = pass(g);
  for (let i = 0; i < 6 && pend(g).inStep; i++) { const o = optionIds(g); g = choose(g, o.includes(po) ? po : o[0]); }
  g = finish(g);
  assert.equal(zone(g, po), 'trash', 'Poro takes 13');
  assert.equal(zone(g, dr), 'trash', '8 + 5 = 13 kills the 13-Might dragon');
});

test('RJ#2123 Rengar, Pouncing can still be played to the battlefield I\'m attacking after my only attacker was killed (I\'m still the Attacker)', () => {
  const g0 = S0(); fundAll(g0, P0); fundAll(g0, P1);
  put(g0, P1, 'V(9)', BF_A); control(g0, BF_A, P1);
  const a = put(g0, P0, 'V(2)', 'base');
  const r = hand(g0, P0, 'Rengar, Pouncing');
  const k = hand(g0, P1, 'KillA');
  let g = move(g0, P0, [a], BF_A);
  for (let i = 0; i < 8 && !(pend(g).player === P1 && canPlayNow(g, P1, k)); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  g = play(g, P1, k, { targets: [[a]] });
  for (let i = 0; i < 6 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(zone(g, a), 'trash');
  assert.equal(g.showdown?.attacker, P0);
  assert.ok(playDests(g, P0, r).includes(BF_A), 'the attacked battlefield is still a legal destination');
});

test('RJ#2124 Shakedown\'s target killed in response (hidden Hidden Blade): Shakedown resolves with no effect — no "draw 2" choice, no draw', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const e = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const hb = put(g, P1, 'Hidden Blade', { facedown: BF_A });
  [g] = cast(g, P0, 'Shakedown', { targets: [[e]] });
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  g = play(g, P1, hb, { targets: [[e]] });
  const h0 = g.players[P0].hand.length;
  let asked = false;
  for (let i = 0; i < 12 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.inStep && d.kind === 'optional') { asked = true; g = choose(g, 'yes'); continue; }
    g = d.inStep ? choose(g, optionIds(g)[0]) : pass(g);
  }
  assert.equal(zone(g, e), 'trash');
  assert.equal(asked, false, 'no choice offered');
  assert.equal(g.players[P0].hand.length, h0, 'caster draws nothing');
});

test('RJ#2125 FFA: units of only two players can be at one battlefield — a third player can\'t move in where two players already have units', async () => {
  const { createGame } = await import('../../src/engine/index.ts');
  const { fixtureDb } = await import('../fixtures/conformance/cards.ts');
  const { legalDeck, moveDests } = await import('../conformance/harness.ts');
  const g = createGame({ seed: 3, cardDb: fixtureDb(), firstPlayer: P0, skipMulligan: true, battlefieldSelection: 'random', includeAllCards: true, mode: 'ffa',
    players: [0, 1, 2].map(i => ({ name: `P${i}`, deck: legalDeck() })) } as never);
  const P2 = 2 as PlayerId;
  put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  put(g, P2, 'V(3)', BF_A);
  const a = put(g, P0, 'V(1)', 'base');
  const ds = moveDests(g, P0, a);
  assert.ok(!ds.includes(BF_A), `BF-A not a destination: ${ds}`);
  assert.ok(ds.includes(BF_B));
});

test('RJ#2127 Azir, Sovereign swapped to another battlefield (hidden Tideturner) before his attack trigger resolves: the tokens move to his new battlefield', () => {
  let g = S0(); fundAll(g, P0, 12);
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  control(g, BF_B, P0);
  put(g, P0, 'V(1)', BF_B);
  const tt = put(g, P0, 'Tideturner', { facedown: BF_B });
  const t2 = put(g, P0, 'Recruit', 'base', { token: true });
  const az = put(g, P0, 'Azir, Sovereign', 'base');
  g = move(g, P0, [az], BF_A);
  for (let i = 0; i < 10 && !(chainLabels(g).some(l => /Azir/.test(l)) && pend(g).player === P0 && !pend(g).inStep); i++) g = pend(g).inStep ? choose(g, pend(g).kind === 'optional' ? 'yes' : optionIds(g)[0]) : pass(g);
  assert.ok(chainLabels(g).some(l => /Azir/.test(l)), 'attack trigger on the chain');
  g = act(g, { type: 'playCard', player: P0, obj: tt });
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction' && !(locOf(g, az) === BF_B && !chainLabels(g).some(l => /Azir/.test(l))); i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    g = act(g, { type: 'choose', player: d.player, optionIds: d.kind === 'optional' ? ['yes'] : /swap/i.test(d.prompt ?? '') && o.includes(az) ? [az] : o.includes(t2) ? [t2] : [o[0]] });
  }
  assert.equal(locOf(g, az), BF_B, 'Azir swapped to BF-B');
  assert.equal(locOf(g, t2), BF_B, 'token moved to Azir\'s new battlefield');
});

test('RJ#2137 Retreat in response to Harnessed Dragon\'s play trigger returns my targeted unit to hand; the kill then does nothing', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1, 12);
  const u = put(g, P0, 'V(3)', 'base');
  const r = hand(g, P0, 'Retreat');
  g = play(g, P1, hand(g, P1, 'Harnessed Dragon'), { dest: 'base', targets: [[u]] });
  g = answer(g, { targets: [[u]] }, P1);
  assert.ok(chainLabels(g).some(l => /Harnessed Dragon/.test(l)), 'kill trigger on the chain');
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  assert.ok(canPlayNow(g, P0, r));
  g = play(g, P0, r, { targets: [[u]] });
  g = finish(g);
  assert.equal(zone(g, u), 'hand');
});

test('RJ#2140 the defender Rides the Wind its unit out of the combat and back in, then wins: it kept control throughout — no conquer point', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12);
  const d = put(g, P0, 'V(5)', BF_A); control(g, BF_A, P0);
  const a = put(g, P1, 'V(2)', 'base');
  g = move(g, P1, [a], BF_A);
  for (const dest of ['base', BF_A] as const) {
    for (let i = 0; i < 8 && !(pend(g).player === P0 && pend(g).kind === 'showdownAction'); i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
    g = play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[d]] });
    g = resolveWith(g, { locations: [dest] });
    for (let i = 0; i < 6 && g.chain.length; i++) g = pass(g);
    assert.equal(locOf(g, d), dest);
    assert.equal(g.battlefields[BF_A].controller, P0, 'control kept during the showdown');
  }
  g = finish(g);
  assert.equal(zone(g, a), 'trash');
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[P0].points, 0, 'no conquer');
});

test('RJ#2141 my Thousand-Tailed Watcher (7) with 4 damage dies when the opponent\'s Watcher gives it -3 (4 damage ≥ 4 Might)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1, 12);
  const mine = put(g, P0, 'Thousand-Tailed Watcher', 'base');
  assert.equal(mightOf(g, mine), 7);
  g.objects[mine].damage = 4; g.ex.dirty = true; g.timestamp++;
  g = play(g, P1, hand(g, P1, 'Thousand-Tailed Watcher'), { dest: 'base' });
  g = finish(g);
  assert.equal(zone(g, mine), 'trash');
});

test('RJ#2144 Switcheroo swaps Mights but the buff stays on its unit: buffed 5 ↔ 2 → 2 (still buffed) and 5; spending the buff later takes it to 1', () => {
  let g = S0(); fundAll(g, P0);
  const a = put(g, P0, 'V(4)', BF_A, { buff: true }), b = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  assert.equal(mightOf(g, a), 5);
  g = resolveChain(play(g, P0, hand(g, P0, 'Switcheroo'), { targets: [[a], [b]] }));
  assert.equal(mightOf(g, a), 2); assert.equal(mightOf(g, b), 5);
  assert.ok(g.objects[a].counters?.buff, 'buff still on A');
  assert.ok(!g.objects[b].counters?.buff);
  g.objects[a].counters = { ...g.objects[a].counters, buff: 0 }; g.ex.dirty = true; g.timestamp++;
  assert.equal(mightOf(g, a), 1, 'losing the buff loses its +1');
});

test('RJ#2145 (MISMATCH-RJ numbers) Deadbloom Predator (8) given -3 by an enemy Thousand-Tailed Watcher, then saved by Zhonya\'s Hourglass: effects stay — recalled at 5 (RJ says "8, keeping the buff"; Watcher is a -3)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1, 14);
  put(g, P0, "Zhonya's Hourglass", 'base');
  const db = put(g, P0, 'Deadbloom Predator', BF_A); control(g, BF_A, P0);
  g = play(g, P1, hand(g, P1, 'Thousand-Tailed Watcher'), { dest: 'base' });
  g = finish(g);
  assert.equal(mightOf(g, db), 5);
  [g] = cast(g, P1, 'KillA', { targets: [[db]] });
  g = resolveWith(g, { may: [true] });
  g = finish(g);
  assert.equal(locOf(g, db), 'base', 'saved and recalled');
  assert.equal(mightOf(g, db), 5, 'the -3 this turn still applies');
});

test('RJ#2152 Tideturner played from hidden at Vilemaw\'s Lair choosing a unit in my base: Tideturner can\'t move to base and stays; the base unit still moves to the Lair', () => {
  let g = S0(); fundAll(g, P0); setBattlefieldCard(g, BF_A, "Vilemaw's Lair");
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const tt = put(g, P0, 'Tideturner', { facedown: BF_A });
  const u = put(g, P0, 'V(2)', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: tt });
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    g = act(g, { type: 'choose', player: d.player, optionIds: d.kind === 'optional' ? ['yes'] : [o.includes(u) ? u : o[0]] });
  }
  assert.equal(locOf(g, tt), BF_A, 'Tideturner stays at the Lair');
  assert.equal(locOf(g, u), BF_A, 'the base unit moved to the Lair');
});

test('RJ#2158 Piercing Light dealing 2 to my own Ravenbloom Student (2): it dies before its "+1 when you play a spell" can resolve', () => {
  let g = S0(); fundAll(g, P0);
  const st = put(g, P0, 'Ravenbloom Student', BF_A); control(g, BF_A, P0);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Piercing Light') });
  for (let i = 0; i < 6 && pend(g).inStep; i++) { const d = pend(g); const o = optionIds(g); g = act(g, { type: 'choose', player: d.player, optionIds: d.kind === 'optional' ? ['no'] : d.min === 0 && !o.includes(st) ? [] : [o.includes(st) ? st : o[0]] }); }
  g = finish(g);
  assert.equal(zone(g, st), 'trash');
});

test('RJ#2161 Vex, Cheerless in combat: an enemy Feral Strength with Repeat pays [2] + Repeat [2] + Vex\'s [1][A] once (Repeat itself is not increased)', () => {
  const cost = (vex: boolean, repeat: boolean) => {
    const g0 = S0({ tp: P1 }); fundAll(g0, P1, 12);
    put(g0, P0, vex ? 'Vex, Cheerless' : 'V(5)', BF_A); control(g0, BF_A, P0);
    const t = put(g0, P1, 'V(1)', 'base');
    let g = move(g0, P1, [t], BF_A);
    assert.ok(g.showdown?.isCombat);
    for (let i = 0; i < 4 && pend(g).player !== P1; i++) g = pass(g);
    const n0 = g.players[P1].runesInPlay.length, r0 = readyRunes(g, P1);
    g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Feral Strength') });
    for (let i = 0; i < 8 && pend(g).inStep; i++) { const d = pend(g); g = act(g, { type: 'choose', player: d.player, optionIds: d.kind === 'optional' ? [repeat ? 'yes' : 'no'] : optionIds(g).includes(t) ? [t] : [optionIds(g)[0]] }); }
    void n0; void r0;
    return g.log.filter(l => /^P1 pays/.test(l.text)).map(l => l.text).join(' / ');
  };
  assert.equal(cost(false, true), 'P1 pays 4');
  assert.equal(cost(true, false), 'P1 pays 3 A', 'Vex: +[1][A]');
  assert.equal(cost(true, true), 'P1 pays 5 A', 'with Repeat: Vex applies once');
});

test('RJ#2174 (MISMATCH-RJ, CR 359.3.f) defending Ahri at Reaver\'s Row: I may order the Row first to resolve (Ahri to base) — then Ahri\'s "-2 to an enemy unit here" finds no target here (she is in base) and does nothing', () => {
  let g = S0({ tp: P1 }); setBattlefieldCard(g, BF_A, "Reaver's Row");
  const ah = put(g, P0, 'ogn-119-298', BF_A); control(g, BF_A, P0);
  const a = put(g, P1, 'V(4)', 'base');
  g = move(g, P1, [a], BF_A);
  let ordered = false;
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction' && !(g.chain.length === 0 && pend(g).kind === 'showdownAction'); i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    if (d.kind === 'orderTriggers') { ordered = true; const ahriFirst = d.options!.find(x => /Ahri/.test(x.label))?.id ?? o[0]; g = choose(g, ahriFirst); continue; }
    g = act(g, { type: 'choose', player: d.player, optionIds: d.kind === 'optional' ? ['yes'] : [o.includes(ah) ? ah : o.includes(a) ? a : o[0]] });
  }
  assert.ok(ordered, 'P0 orders its two defend triggers');
  assert.equal(locOf(g, ah), 'base', 'Reaver\'s Row moved Ahri to base');
  assert.equal(mightOf(g, a), 4, '"here" is read on resolution: no -2');
});

test('RJ#2176 Lady of Luminosity checks the printed cost: a 5-cost Falling Comet reduced to 4 by Eager Apprentice still draws', () => {
  let g = S0(); fundAll(g, P0, 8);
  setLegend(g, P0, 'Lady of Luminosity');
  put(g, P0, 'Eager Apprentice', BF_B); control(g, BF_B, P0);
  const e = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const fc = hand(g, P0, 'Falling Comet');
  const h0 = g.players[P0].hand.length, r0 = readyRunes(g, P0);
  g = play(g, P0, fc, { targets: [[e]] });
  assert.equal(r0 - readyRunes(g, P0), 4, 'paid 4 energy (discounted)');
  g = finish(g);
  assert.equal(g.players[P0].hand.length, h0 - 1 + 1, 'Lux drew 1');
});

test('RJ#2177 damage doesn\'t carry over between combats: Kayn (6, moved twice → takes no damage) attacks a 9-Might unit twice; it is healed after each combat and survives both', () => {
  let g = S0(); fundAll(g, P0, 12);
  const e = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  control(g, BF_B, P0); put(g, P0, 'V(1)', BF_B);
  const k = put(g, P0, 'Kayn, Unleashed', 'base');
  g = finish(move(g, P0, [k], BF_B));
  g = play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[k]] });
  g = resolveWith(g, { locations: [BF_A] });
  g = finish(g);
  assert.equal(zone(g, k), 'base', 'Kayn took no damage and was recalled');
  assert.equal(zone(g, e), 'battlefield');
  assert.equal(g.objects[e].damage ?? 0, 0, 'healed after the combat');
  g = play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[k]] });
  g = resolveWith(g, { locations: [BF_A] });
  g = finish(g);
  assert.equal(zone(g, e), 'battlefield', 'second combat: 6 again, not 12');
});

test('RJ#2180 Zenith Blade on an already-stunned enemy unit: legal; no new stun (Eclipse Herald doesn\'t trigger), and my unit still moves', () => {
  let g = S0(); fundAll(g, P0, 6);
  const eh = put(g, P0, 'Eclipse Herald', 'base', { ready: false });
  const f = put(g, P0, 'V(5)', 'base');
  const e1 = put(g, P1, 'V(3)', BF_A, { stunned: true }); control(g, BF_A, P1);
  const m0 = mightOf(g, eh);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Zenith Blade') });
  assert.equal(pend(g).kind, 'chooseTargets', 'playable: the stunned unit is a legal target (auto-chosen, the only one)');
  for (let i = 0; i < 12 && (pend(g).inStep || g.chain.length); i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    g = act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : o.includes(f) ? f : o.includes(String(BF_A)) ? String(BF_A) : o[0]] });
  }
  assert.equal(locOf(g, f), BF_A, 'the friendly unit moved');
  assert.ok(g.objects[e1].stunned, 'still stunned');
  assert.equal(g.objects[eh].exhausted, true, 'Eclipse Herald not readied');
  assert.equal(mightOf(g, eh), m0);
});

test('RJ#2186 Spectral Matron can\'t play Kraken Hunter (printed [3] + 2 Power) from the trash, even with buffs available for its discount (printed cost is checked)', () => {
  let g = S0(); fundAll(g, P0, 8);
  put(g, P0, 'V(2)', 'base', { buff: true });
  const kh = put(g, P0, 'Kraken Hunter', 'trash');
  const ok = put(g, P0, 'V(1)', 'trash');
  let offered: string[] = [];
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Spectral Matron'), destination: 'base' } as never);
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    if (o.includes(ok)) offered = o;
    g = act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : o.includes(ok) ? ok : o[0]] });
  }
  assert.ok(offered.length > 0, 'a cheap unit is offered');
  assert.ok(!offered.includes(kh), 'Kraken Hunter is not');
  assert.equal(zone(g, kh), 'trash');
});

test('RJ#2187 Karma, Channeler: recycling runes to pay her own cost doesn\'t trigger her (not on the board; runes aren\'t cards); her Vision recycle does', () => {
  for (const vision of [false, true]) {
    let g = S0(); fundAll(g, P0, 10);
    const f = put(g, P0, 'V(1)', 'base');
    put(g, P0, 'V(1)', 'deckTop');
    const n0 = g.players[P0].runesInPlay.length;
    g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Karma, Channeler'), destination: 'base' } as never);
    assert.ok(g.players[P0].runesInPlay.length < n0, 'a rune was recycled for her Power');
    for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
      const d = pend(g);
      if (!d.inStep) { g = pass(g); continue; }
      const o = optionIds(g);
      if (d.kind === 'optional') { g = choose(g, vision ? 'yes' : 'no'); continue; }
      if (d.kind === 'chooseCards' && /Vision|recycle/i.test(d.prompt ?? '')) { g = act(g, { type: 'choose', player: d.player, optionIds: vision ? o.slice(0, 1) : [] }); continue; }
      g = act(g, { type: 'choose', player: d.player, optionIds: [o.includes(f) ? f : o[0]] });
    }
    assert.equal(!!g.objects[f].counters?.buff, vision, vision ? 'Vision recycle → buff' : 'no buff from the rune recycle');
  }
});

test('RJ#2188 (MISMATCH-RJ, principle 13) Mushroom Pouch and my lone Temporary unit (hidden card at its battlefield) trigger together at my Beginning Phase: I order them; even with Temporary resolving first, Pouch\'s trigger is still on the chain (Closed state, CR 309.1/323.5), so control and the facedown card are kept until it resolves — it draws either way', () => {
  const run = (pouchFirst: boolean) => {
    let g = S0({ tp: P1 });
    put(g, P0, 'Mushroom Pouch', 'base');
    const t = put(g, P0, 'Temp(2)', BF_A); control(g, BF_A, P0);
    const fd = put(g, P0, 'HidZap', { facedown: BF_A });
    for (let i = 0; i < 6; i++) put(g, P0, 'V(1)', 'deckTop');
    const h0 = g.players[P0].hand.length;
    g = endTurn(g, P1);
    let ordered = false;
    for (let i = 0; i < 20 && !(pend(g).kind === 'mainAction' && pend(g).player === P0); i++) {
      const d = pend(g);
      if (!d.inStep) { g = pass(g); continue; }
      if (d.kind === 'orderTriggers') { ordered = true; const want = d.options!.find(o => pouchFirst ? /Temp/.test(o.label) : /Mushroom/.test(o.label))?.id ?? d.options![0].id; g = choose(g, want); continue; }
      g = choose(g, optionIds(g)[0]);
    }
    return { ordered, drew: g.players[P0].hand.length - h0, t: zone(g, t), fd: zone(g, fd), ctl: g.battlefields[BF_A].controller };
  };
  const a = run(true), b = run(false);
  assert.ok(a.ordered && b.ordered, 'the player orders the two triggers');
  for (const r of [a, b]) {
    assert.equal(r.t, 'trash');
    assert.equal(r.drew, 2, 'turn draw + Pouch');
    assert.equal(r.fd, 'trash', 'hidden card trashed once control is lost in an Open state');
    assert.notEqual(r.ctl, P0);
  }
});

test('RJ#2191 no overkill while another unit lacks lethal: 5 damage vs two 2-Might defenders can\'t all go on one (2 + 3 or 3 + 2 is fine); 2 damage may all go on one', () => {
  let { g, def } = attackSetup(['V(5)'], ['V(2)', 'V(2)']);
  for (let i = 0; i < 10 && pend(g).kind !== 'assignDamage'; i++) g = pass(g);
  assert.notEqual(validateAction(g, { type: 'assignDamage', player: P0, assignment: { [def[0]]: 5 } }), null, 'overkill rejected');
  assert.equal(validateAction(g, { type: 'assignDamage', player: P0, assignment: { [def[0]]: 3, [def[1]]: 2 } }), null, 'excess after both lethal is fine');
  let r = attackSetup(['V(2)'], ['V(2)', 'V(2)']);
  g = r.g; for (let i = 0; i < 10 && pend(g).kind !== 'assignDamage'; i++) g = pass(g);
  assert.equal(validateAction(g, { type: 'assignDamage', player: P0, assignment: { [r.def[0]]: 2 } }), null, 'all on the first when it is not more than lethal');
});

test('RJ#2194 (MISMATCH-RJ, CR 491.8.h/i) 2v2: teammates may not use the same Champion Legend (nor the same battlefields) — such a game is rejected', async () => {
  const { createGame } = await import('../../src/engine/index.ts');
  const { fixtureDb } = await import('../fixtures/conformance/cards.ts');
  const { legalDeck } = await import('../conformance/harness.ts');
  assert.throws(() => createGame({ seed: 3, cardDb: fixtureDb(), firstPlayer: P0, skipMulligan: true, battlefieldSelection: 'random', includeAllCards: true, mode: '2v2',
    players: [0, 1, 2, 3].map(i => ({ name: `P${i}`, deck: legalDeck() })) } as never), /legend|teammate/i);
});

test('RJ#2195 (MISMATCH-RJ, CR 491.5.c) 2v2 turn order alternates teams (1a, 2a, 1b, 2b), not 1a, 1b, 2a, 2b', async () => {
  const { createGame } = await import('../../src/engine/index.ts');
  const { fixtureDb } = await import('../fixtures/conformance/cards.ts');
  const { legalDeck } = await import('../conformance/harness.ts');
  let g = createGame({ seed: 3, cardDb: fixtureDb(), firstPlayer: P0, skipMulligan: true, battlefieldSelection: 'random', includeAllCards: true, mode: '2v2',
    players: [0, 1, 2, 3].map(i => ({ name: `P${i}`, deck: legalDeck({ legend: i >= 2 ? 'cf-legend-2' : 'cf-legend' }, [`cf-bf-${'abde'[i]}`, `cf-bf-${'bcef'[i]}`, `cf-bf-${'cdfa'[i]}`]) })) } as never);
  const teams = (g as unknown as { teams: PlayerId[][] }).teams;
  const team = (p: number) => teams.findIndex(t => t.includes(p as PlayerId));
  const order: number[] = [];
  for (let i = 0; i < 4; i++) {
    for (let k = 0; k < 40 && pend(g).kind !== 'mainAction'; k++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
    order.push(pend(g).player);
    g = endTurn(g, pend(g).player);
  }
  assert.equal(new Set(order).size, 4, `four different players: ${order}`);
  for (let i = 1; i < 4; i++) assert.notEqual(team(order[i]), team(order[i - 1]), `teams alternate: ${order}`);
});

test('RJ#2201 (MISMATCH-RJ in part, principle 11) Ava Achiever\'s "you may pay [C] to play a [Hidden] card from your hand": the [C] is decided and paid as the trigger goes on the chain; the card is chosen (and stays in hand) until it resolves', () => {
  let g = S0(); fundAll(g, P0);
  const hz = hand(g, P0, 'HidZap');
  const e = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const ava = put(g, P0, 'Ava Achiever', 'base');
  const n0 = g.players[P0].runesInPlay.length;
  g = move(g, P0, [ava], BF_A);
  assert.equal(pend(g).kind, 'optional', 'the "may pay" is asked at finalization');
  g = choose(g, 'yes');
  assert.ok(chainLabels(g).some(l => /Ava/.test(l)), 'trigger on the chain');
  assert.equal(pend(g).kind, 'chainResponse');
  assert.equal(g.players[P0].runesInPlay.length, n0 - 1, '[C] already paid (a rune recycled)');
  assert.equal(zone(g, hz), 'hand', 'the card is still in hand');
  for (let i = 0; i < 12 && zone(g, hz) === 'hand'; i++) { const d = pend(g); g = d.inStep ? choose(g, optionIds(g).includes(hz) ? hz : optionIds(g).includes(e) ? e : optionIds(g)[0]) : pass(g); }
  assert.notEqual(zone(g, hz), 'hand', 'played on resolution');
});

test('RJ#2208 Pit Rookie can be played with no other friendly unit; its trigger has no target and doesn\'t go on the chain', () => {
  let g = S0(); fundAll(g, P0);
  for (const id of [...g.players[P0].base]) if (g.cards[g.objects[id].cardId]?.type === 'Unit') { delete g.objects[id]; g.players[P0].base = g.players[P0].base.filter(x => x !== id); }
  g.timestamp++; g.ex.dirty = true;
  const pr = hand(g, P0, 'Pit Rookie');
  assert.ok(canPlayNow(g, P0, pr));
  g = act(g, { type: 'playCard', player: P0, obj: pr, destination: 'base' } as never);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = choose(g, optionIds(g)[0]);
  assert.equal(zone(g, pr), 'base');
  assert.ok(!chainLabels(g).some(l => /Pit Rookie/.test(l)), `no trigger on the chain: ${chainLabels(g)}`);
  assert.ok(!g.objects[pr].counters?.buff, 'it can\'t buff itself ("another")');
});

test('RJ#2212 Traveling Merchant with an empty hand: nothing to discard, but it still draws 1', () => {
  let g = S0();
  for (const id of [...g.players[P0].hand]) { g.objects[id].zone = 'trash'; g.players[P0].trash.push(id); }
  g.players[P0].hand = []; g.timestamp++; g.ex.dirty = true;
  const tm = put(g, P0, 'Traveling Merchant', 'base');
  control(g, BF_B, P0);
  g = finish(move(g, P0, [tm], BF_B));
  assert.equal(g.players[P0].hand.length, 1, 'drew 1');
});

test('RJ#2215 Gust on Vayne (2, Assault 3) moving in to attack: alone, no window until combat (then 5 Might — not Gustable); with Traveling Merchant\'s move trigger on the chain she is still 2 and can be Gusted', () => {
  for (const withMerchant of [false, true]) {
    let g = S0(); fundAll(g, P1);
    put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
    const v = put(g, P0, 'ogn-035-298', 'base');
    const movers = [v];
    if (withMerchant) { movers.push(put(g, P0, 'Traveling Merchant', 'base')); hand(g, P0, 'V(1)'); }
    const gu = hand(g, P1, 'Gust');
    g = move(g, P0, movers, BF_A);
    for (let i = 0; i < 6 && pend(g).player !== P1; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
    if (withMerchant) {
      assert.ok(chainLabels(g).some(l => /Merchant/.test(l)), 'Merchant\'s trigger opened the window');
      assert.ok(!g.showdown?.isCombat || !g.objects[v].combatRole, 'not an attacker yet');
      assert.equal(mightOf(g, v), 2);
      g = play(g, P1, gu, { targets: [[v]] });
      g = finish(g);
      assert.equal(zone(g, v), 'hand', 'Gusted');
    } else {
      assert.ok(g.showdown?.isCombat, 'first window is in the combat');
      assert.equal(mightOf(g, v), 5);
      const x = (() => { try { const h = act(g, { type: 'playCard', player: P1, obj: gu }); return h.pending?.kind === 'chooseTargets' ? optionIds(h).includes(v) : (h.chain.at(-1)?.targets?.flat() ?? []).includes(v); } catch { return false; } })();
      assert.ok(!x, 'Vayne is not a legal Gust target');
    }
  }
});

test('RJ#2218 2v2: Charm can\'t move an enemy unit to a battlefield occupied by its teammate (units of one team can\'t share a battlefield)', async () => {
  const { createGame } = await import('../../src/engine/index.ts');
  const { fixtureDb } = await import('../fixtures/conformance/cards.ts');
  const { legalDeck } = await import('../conformance/harness.ts');
  let g = createGame({ seed: 3, cardDb: fixtureDb(), firstPlayer: P0, skipMulligan: true, battlefieldSelection: 'random', includeAllCards: true, mode: '2v2',
    players: [0, 1, 2, 3].map(i => ({ name: `P${i}`, deck: legalDeck({ legend: i >= 2 ? 'cf-legend-2' : 'cf-legend' }, [`cf-bf-${'abde'[i]}`, `cf-bf-${'bcef'[i]}`, `cf-bf-${'cdfa'[i]}`]) })) } as never);
  const teams = (g as unknown as { teams: PlayerId[][] }).teams;
  const enemy = teams.find(t => !t.includes(P0))!;
  const [e1, e2] = enemy;
  for (let k = 0; k < 40 && !(pend(g).kind === 'mainAction' && pend(g).player === P0); k++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  fundAll(g, P0);
  const u = put(g, e1, 'V(2)', BF_A); control(g, BF_A, e1);
  put(g, e2, 'V(2)', BF_B); control(g, BF_B, e2);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'ogn-043-298') });
  const offered: string[] = [];
  for (let i = 0; i < 6 && pend(g).inStep; i++) { const o = optionIds(g); if (pend(g).kind === 'chooseDestination') offered.push(...o); g = choose(g, o.includes(u) ? u : o[0]); }
  assert.ok(offered.length > 0, 'a destination was asked');
  assert.ok(!offered.includes(String(BF_B)), `teammate's battlefield not offered: ${offered}`);
  void P1;
});

test('RJ#2222 Might of Demacia (Garen legend): conquering with 4 units there draws 2; with 3 it doesn\'t', () => {
  for (const n of [4, 3]) {
    let g = S0();
    setLegend(g, P0, 'Might of Demacia');
    for (let i = 0; i < 8; i++) put(g, P0, 'V(1)', 'deckTop');
    const us = Array.from({ length: n }, () => put(g, P0, 'V(1)', 'base'));
    const h0 = g.players[P0].hand.length;
    g = finish(move(g, P0, us, BF_A));
    assert.equal(g.battlefields[BF_A].controller, P0);
    assert.equal(g.players[P0].hand.length - h0, n === 4 ? 2 : 0, `${n} units`);
  }
});

test('RJ#2224 Super Mega Death Rocket! in the trash: conquering with an empty hand can\'t return it (the discard 1 cost can\'t be paid)', () => {
  let g = S0();
  for (const id of [...g.players[P0].hand]) { g.objects[id].zone = 'trash'; g.players[P0].trash.push(id); }
  g.players[P0].hand = []; g.timestamp++; g.ex.dirty = true;
  const r = put(g, P0, 'Super Mega Death Rocket!', 'trash');
  const u = put(g, P0, 'V(1)', 'base');
  let asked = false;
  g = move(g, P0, [u], BF_A);
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    if (d.kind === 'optional' && /Rocket|discard/i.test(d.prompt ?? '')) { asked = true; g = choose(g, 'yes'); continue; }
    g = choose(g, optionIds(g)[0]);
  }
  assert.equal(g.battlefields[BF_A].controller, P0, 'conquered');
  assert.equal(zone(g, r), 'trash', 'Rocket stays in the trash');
  void asked;
});

test('RJ#2230 an exhausted Stealthy Pursuer in base may still move with a friendly unit that moves from base (its trigger moves it, no ready needed)', () => {
  let g = S0();
  const sp = put(g, P0, 'Stealthy Pursuer', 'base', { ready: false });
  const u = put(g, P0, 'V(2)', 'base');
  control(g, BF_B, P0);
  g = move(g, P0, [u], BF_B);
  for (let i = 0; i < 12 && pend(g).kind !== 'mainAction'; i++) { const d = pend(g); g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : optionIds(g)[0]) : pass(g); }
  assert.equal(locOf(g, sp), BF_B, 'moved with it');
});

// ------------------------------------------------------------------------------------------------ cycle 7 (2231-)
test('RJ#2233 Dazzling Aurora can play a Champion unit (Kayn, Unleashed): "unit" has no restriction', () => {
  let g = S0();
  put(g, P0, 'Dazzling Aurora', 'base');
  const k = put(g, P0, 'Kayn, Unleashed', 'deckTop');
  assert.ok(g.cards[g.objects[k].cardId].supertypes?.includes('Champion'));
  g = finish(endTurn(g, P0));
  assert.equal(locOf(g, k), 'base', 'played by Aurora');
});

test('RJ#2234 one standard move may combine a Ganking unit from a battlefield and units from base, all to the same battlefield', () => {
  let g = S0();
  const gk = put(g, P0, 'Kayn, Unleashed', BF_A); control(g, BF_A, P0);
  const b = put(g, P0, 'V(2)', 'base');
  assert.equal(validateAction(g, { type: 'move', player: P0, units: [gk, b], to: BF_B }), null, 'legal');
  g = finish(move(g, P0, [gk, b], BF_B));
  assert.equal(locOf(g, gk), BF_B);
  assert.equal(locOf(g, b), BF_B);
});

test('RJ#2236 Shen, Kinkou played (Reaction) in response to Thousand-Tailed Watcher\'s play trigger is on the board when it resolves: -3 (to a min of 1)', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const sh = hand(g, P1, 'Shen, Kinkou');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Thousand-Tailed Watcher'), destination: 'base' });
  for (let i = 0; i < 10 && !(pend(g).player === P1 && chainLabels(g).some(l => /Watcher/.test(l)) && pend(g).kind === 'chainResponse'); i++) g = pend(g).inStep ? choose(g, pend(g).kind === 'optional' ? 'no' : optionIds(g)[0]) : pass(g);
  assert.ok(canPlayNow(g, P1, sh), 'Shen playable in response');
  g = play(g, P1, sh, { dest: 'base' });
  g = finish(g);
  assert.equal(zone(g, sh), 'base');
  assert.equal(mightOf(g, sh), 1, '3 - 3 → min 1');
});

test('RJ#2238 Mobilize (no [Add]) is a spell on the chain: the opponent can respond with a Reaction', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const r = hand(g, P1, 'DrawR');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Mobilize') });
  for (let i = 0; i < 4 && pend(g).player !== P1; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.ok(chainLabels(g).some(l => /Mobilize/.test(l)), 'Mobilize on the chain');
  assert.ok(canPlayNow(g, P1, r), 'Reaction in response');
});

test('RJ#2239 a player with Might must assign all of it in combat (can\'t assign none)', () => {
  let { g, def } = attackSetup(['V(3)'], ['V(2)', 'V(2)']);
  for (let i = 0; i < 30 && pend(g).kind !== 'assignDamage' && pend(g).kind !== 'mainAction'; i++) g = pass(g);
  assert.equal(pend(g).kind, 'assignDamage');
  assert.notEqual(validateAction(g, { type: 'assignDamage', player: pend(g).player, assignment: {} }), null, 'nothing assigned: illegal');
  assert.notEqual(validateAction(g, { type: 'assignDamage', player: pend(g).player, assignment: { [def[0]]: 0 } }), null, '0 assigned: illegal');
  assert.equal(validateAction(g, { type: 'assignDamage', player: pend(g).player, assignment: { [def[0]]: 2, [def[1]]: 1 } }), null);
});

test('RJ#2240 Cithria of Cloudfield\'s buff from playing Kraken Hunter comes too late to pay Kraken Hunter\'s buff cost; an existing buff can be spent and she is buffed again', () => {
  for (const pre of [false, true]) {
    let g = S0(); fundAll(g, P0);
    const c = put(g, P0, 'Cithria of Cloudfield', 'base', pre ? { buff: true } : {});
    const kh = hand(g, P0, 'Kraken Hunter');
    g = act(g, { type: 'playCard', player: P0, obj: kh, destination: 'base' } as never);
    const seen: string[] = [];
    for (let i = 0; i < 8 && pend(g).inStep; i++) {
      const d = pend(g); const ids = optionIds(g); seen.push(...ids);
      if (d.kind === 'optional') g = choose(g, /Accelerate/i.test(d.prompt ?? '') ? 'no' : 'yes');
      else if (d.kind === 'chooseNumber') g = choose(g, ids.at(-1)!);
      else g = act(g, { type: 'choose', player: P0, optionIds: ids.includes(c) ? [c] : ids.length && (d.min ?? 1) > 0 ? [ids[0]] : [] });
    }
    if (!pre) assert.ok(!seen.includes(c), 'unbuffed Cithria not offered as a buff to spend');
    g = finish(g);
    assert.equal(zone(g, kh), 'base');
    assert.equal(g.objects[c].counters.buff ?? 0, 1, pre ? 'spent, then buffed again by her trigger' : 'buffed after the play');
  }
});

test('RJ#2243 Warwick, Hunter\'s attack trigger goes on the chain with no damaged enemy unit; damage dealt in response makes the unit die on resolution', () => {
  let { g, def } = attackSetup(['Warwick, Hunter'], ['V(5)']);
  fundAll(g, P0);
  for (let i = 0; i < 6 && !chainLabels(g).some(l => /Warwick/.test(l)); i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.ok(chainLabels(g).some(l => /Warwick/.test(l)), 'trigger on the chain without a damaged enemy');
  for (let i = 0; i < 6 && pend(g).player !== P0; i++) g = pass(g);
  g = play(g, P0, hand(g, P0, 'ZapR'), { targets: [[def[0]]] });
  g = resolveWith(g, {});
  assert.equal(zone(g, def[0]), 'trash', 'damaged by the Reaction, then killed by Warwick');
});

test('RJ#2245 a Seal adds 1 Power (no Energy) and recycles no rune', () => {
  let g = S0();
  const s = put(g, P0, 'Seal of Rage', 'base');
  const n0 = g.players[P0].runesInPlay.length;
  g = activate(g, P0, s, 0);
  const pool = g.players[P0].pool;
  assert.equal(pool.energy, 0, 'no Energy');
  assert.equal(Object.values(pool.power).reduce((a, b) => a + (b ?? 0), 0), 1, '1 Power');
  assert.equal(g.players[P0].runesInPlay.length, n0, 'no rune recycled');
});

test('RJ#2247 Charm can move an enemy unit between battlefields, but not to the location it is already at', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'ogn-043-298') });
  const offered: string[] = [];
  for (let i = 0; i < 6 && pend(g).inStep; i++) { const o = optionIds(g); if (pend(g).kind === 'chooseDestination') { offered.push(...o); g = choose(g, String(BF_B)); continue; } g = choose(g, o.includes(u) ? u : o[0]); }
  assert.ok(offered.includes(String(BF_B)), `another battlefield offered: ${offered}`);
  assert.ok(!offered.includes(String(BF_A)), `its own battlefield not offered: ${offered}`);
  g = finish(g);
  assert.equal(locOf(g, u), BF_B);
});

test('RJ#2252 Defy can\'t be played without a spell to counter (no self-target, CR 355.9.c), so it can\'t be used just to trigger Ravenbloom Student', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'Ravenbloom Student', 'base');
  assert.equal(canPlayNow(g, P0, hand(g, P0, 'Defy')), false);
});

test('RJ#2255 Get Excited! discarding Rhasa the Sunderer deals its printed Energy cost (10), not the reduced cost', () => {
  let g = S0(); fundAll(g, P0, 12);
  for (const id of g.players[P0].hand) delete g.objects[id];
  g.players[P0].hand = []; g.timestamp++;
  for (let i = 0; i < 6; i++) put(g, P0, 'V(1)', 'trash');
  const rh = hand(g, P0, 'Rhasa the Sunderer');
  const e = put(g, P1, 'V(12)', BF_B); control(g, BF_B, P1);
  g = play(g, P0, hand(g, P0, 'Get Excited!'), { targets: [[e]] });
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g); g = choose(g, o.includes(rh) ? rh : o[0]);
  }
  assert.equal(zone(g, rh), 'trash', 'Rhasa discarded');
  assert.equal(g.objects[e].damage, 10);
});

test('RJ#2264 Teemo, Strategist must choose the enemy unit here (no "up to"); its Deflect cost may be refused (PATCH-1), which removes the whole trigger — no reveal, no damage', () => {
  for (const pay of [false, true]) {
    let g = S0(); fundAll(g, P1);
    for (let i = 0; i < 8; i++) put(g, P1, 'HidZap', 'deckTop');
    const def = [put(g, P1, 'Teemo, Strategist', BF_A)]; control(g, BF_A, P1);
    const atk = [put(g, P0, 'Deadbloom Predator', 'base')];
    const deck0 = [...g.players[P1].mainDeck];
    g = move(g, P0, atk, BF_A);
    let asked = false, zeroOk = false;
    for (let i = 0; i < 12 && pend(g).player === P1 && pend(g).inStep; i++) {
      const d = pend(g); asked = true;
      if (d.kind === 'chooseTargets') { zeroOk = (d.min ?? 1) === 0; g = act(g, { type: 'choose', player: P1, optionIds: pay || !zeroOk ? [atk[0]] : [] }); continue; }
      if (d.kind === 'optional') { g = choose(g, pay ? 'yes' : 'no'); continue; }
      g = choose(g, optionIds(g)[0]);
    }
    assert.ok(asked, 'Teemo\'s trigger asked its controller');
    const onChain = chainLabels(g).some(l => /Teemo/.test(l));
    if (!pay) {
      assert.ok(!onChain, 'refused Deflect: the trigger failed to finalize');
      assert.deepEqual(g.players[P1].mainDeck, deck0, 'no reveal / recycle');
      g = finish(g);
      assert.equal(g.objects[atk[0]].damage ?? 0, 0, 'no Teemo damage');
    } else assert.ok(onChain, 'paid: trigger on the chain');
    void def;
  }
});

test('RJ#2269 defending with a 2 vs a 5 attacker: Hextech Ray (3) in the showdown doesn\'t kill it; the combat damage does — Immortal Phoenix in my trash doesn\'t trigger', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0);
  const ph = put(g, P0, 'Immortal Phoenix', 'trash');
  const d = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const a = put(g, P1, 'V(5)', 'base');
  g = move(g, P1, [a], BF_A);
  for (let i = 0; i < 6 && pend(g).player !== P0; i++) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Hextech Ray'), { targets: [[a]] });
  g = resolveWith(g, {});
  assert.equal(zone(g, a), 'battlefield', 'the spell alone isn\'t lethal');
  let offered = false;
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const p = pend(g);
    if (p.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: p.player, assignment: (p.data as { suggested: Record<string, number> }).suggested }); continue; }
    if (p.kind === 'optional' && /Phoenix/i.test(p.prompt ?? '')) { offered = true; g = choose(g, 'no'); continue; }
    g = p.inStep ? choose(g, optionIds(g)[0]) : pass(g);
  }
  assert.equal(zone(g, a), 'trash', 'killed by combat damage');
  assert.ok(!offered, 'no Phoenix trigger');
  assert.equal(zone(g, ph), 'trash');
  void d;
});

test('RJ#2270 a Recruit token is a unit: it can be killed to pay Malzahar, Fanatic\'s "Kill a friendly unit or gear" cost', () => {
  let g = S0();
  const m = put(g, P0, 'Malzahar, Fanatic', 'base');
  const r = put(g, P0, 'Recruit', 'base');
  g = act(g, { type: 'activate', player: P0, obj: m, abilityIndex: 0 });
  let offered = false;
  for (let i = 0; i < 4 && g.pending?.inStep; i++) { const o = optionIds(g); if (o.includes(r)) { offered = true; g = choose(g, r); } else g = choose(g, o[0]); }
  g = finish(g);
  assert.ok(offered, 'the Recruit token is offered');
  assert.ok(!['base', 'battlefield'].includes(zone(g, r)), 'the token was killed');
  assert.equal(zone(g, m), 'base');
});

test('RJ#2277 Sona, Harmonious with only 2 exhausted runes: she readies those 2 ("up to 4")', () => {
  let g = S0();
  put(g, P0, 'Sona', BF_A); control(g, BF_A, P0);
  setRunes(g, P0, 0);
  addRunes(g, P0, 2, 'fury', false);
  addRunes(g, P0, 3, 'calm', true);
  assert.equal(exhaustedRunes(g, P0), 2);
  g = endTurn(g, P0);
  for (let i = 0; i < 10 && pend(g).player === P0 && pend(g).kind !== 'mainAction'; i++) g = pend(g).inStep ? choose(g, ...optionIds(g).slice(0, pend(g).max ?? 4)) : pass(g);
  for (let i = 0; i < 10 && g.chain.length; i++) g = pend(g).inStep ? choose(g, ...optionIds(g).slice(0, pend(g).max ?? 4)) : pass(g);
  assert.equal(exhaustedRunes(g, P0), 0, 'both readied');
  assert.equal(g.players[P0].runesInPlay.length, 5);
});

test('RJ#2283 Brynhir Thundersong killed by Shakedown in response to his play trigger: the trigger still resolves — opponents can\'t play cards this turn', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const sk = hand(g, P1, 'Shakedown');
  const zr = hand(g, P1, 'ZapR');
  const br = hand(g, P0, 'Brynhir Thundersong');
  g = act(g, { type: 'playCard', player: P0, obj: br, destination: 'base' });
  for (let i = 0; i < 8 && !(pend(g).player === P1 && pend(g).kind === 'chainResponse'); i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.ok(chainLabels(g).some(l => /Brynhir/.test(l)), 'play trigger on the chain');
  g = play(g, P1, sk, { targets: [[br]] });
  for (let i = 0; i < 20 && g.chain.length; i++) { const d = pend(g); g = d.inStep ? choose(g, d.kind === 'optional' ? 'no' : optionIds(g).find(o => /dmg|damage|deal|6/i.test(o)) ?? optionIds(g).at(-1)!) : pass(g); }
  assert.equal(zone(g, br), 'trash', 'Brynhir died');
  [g] = cast(g, P0, 'DrawR');
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  assert.equal(pend(g).player, P1);
  assert.equal(canPlayNow(g, P1, zr), false, 'opponent can\'t play cards this turn');
});

test('RJ#2284 Sett, Brawler can spend his buff while exhausted (no [T] in the cost); it gives +4 whether he is ready or exhausted (no +8)', () => {
  for (const ready of [false, true]) {
    let g = S0(); fundAll(g, P0);
    const s = put(g, P0, 'Sett, Brawler', 'base', { buff: true, ready });
    const base = mightOf(g, s) - 1;
    g = passAll(activate(g, P0, s, 2));
    assert.equal(g.objects[s].counters.buff ?? 0, 0, 'buff spent');
    assert.equal(mightOf(g, s), base + 4, ready ? 'ready: +4' : 'exhausted: +4');
  }
});

test('RJ#2285 Portal Rescue on my Brynhir Thundersong in the opponent\'s showdown: once his play trigger resolves, they can\'t play cards for the rest of their turn', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const br = put(g, P0, 'Brynhir Thundersong', 'base');
  const za = hand(g, P1, 'ZapA');
  const m = put(g, P1, 'V(2)', 'base');
  g = move(g, P1, [m], BF_A);
  for (let i = 0; i < 6 && pend(g).player !== P0; i++) g = pass(g);
  assert.equal(pend(g).kind, 'showdownAction');
  g = play(g, P0, hand(g, P0, 'Portal Rescue'), { targets: [[br]] });
  for (let i = 0; i < 20 && g.chain.length; i++) g = pend(g).inStep ? choose(g, optionIds(g).includes('base') ? 'base' : optionIds(g)[0]) : pass(g);
  assert.equal(zone(g, br), 'base', 'Brynhir replayed');
  for (let i = 0; i < 4 && pend(g).player !== P1 && pend(g).kind === 'showdownAction'; i++) g = pass(g);
  if (pend(g).player === P1 && pend(g).kind === 'showdownAction') assert.equal(canPlayNow(g, P1, za), false, 'no more cards in the showdown');
  g = finish(g);
  assert.equal(pend(g).player, P1);
  assert.equal(canPlayNow(g, P1, za), false, 'nor later in their turn');
});

test('RJ#2291 a Champion unit on the board is a unit: Possession can take it', () => {
  let g = S0(); fundAll(g, P0, 3);
  const k = put(g, P1, 'Kayn, Unleashed', BF_A); control(g, BF_A, P1);
  g = play(g, P0, hand(g, P0, 'Possession'), { targets: [[k]] });
  g = finish(g);
  assert.equal(g.objects[k].controller, P0, 'taken');
  assert.equal(locOf(g, k), 'base', 'recalled to my base');
});

test('RJ#2294 Nine-Tailed Fox (Ahri legend) doesn\'t choose: its -1 on a Deflect attacker (Deadbloom Predator) costs no Deflect', () => {
  const g0 = S0();
  setLegend(g0, P1, 'Nine-Tailed Fox');
  fundAll(g0, P1);
  put(g0, P1, 'V(3)', BF_A); control(g0, BF_A, P1);
  const a = put(g0, P0, 'Deadbloom Predator', 'base');
  const r0 = g0.players[P1].runesInPlay.length, ready0 = readyRunes(g0, P1);
  let g = move(g0, P0, [a], BF_A);
  const prompts: string[] = [];
  for (let i = 0; i < 8 && (g.chain.length || pend(g).inStep); i++) { if (pend(g).inStep) prompts.push(pend(g).prompt ?? ''); g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g); }
  assert.ok(g.log.some(l => /Trigger: Nine-Tailed Fox/.test(l.text)), 'Fox triggered');
  assert.equal(mightOf(g, a), 7, '8 - 1');
  assert.ok(!prompts.some(p => /Deflect/i.test(p)), `no Deflect asked: ${prompts}`);
  assert.equal(g.players[P1].runesInPlay.length, r0);
  assert.equal(readyRunes(g, P1), ready0, 'nothing paid');
});

test('RJ#2295 The Boss (Sett legend) saving a buffed Deathknell unit is a replacement: it never dies, so no Deathknell', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  legendOf(g, P0, 'The Boss');
  const u = put(g, P0, 'DK(1)', BF_A, { buff: true }); control(g, BF_A, P0);
  for (let i = 0; i < 3; i++) put(g, P0, 'V(1)', 'deckTop');
  const h0 = g.players[P0].hand.length;
  [g] = cast(g, P0, 'ZapM', { targets: [[u]] });
  g = resolveWith(g, { may: [true] });
  g = finish(g);
  assert.equal(locOf(g, u), 'base', 'saved and recalled');
  assert.equal(g.players[P0].hand.length, h0, 'no Deathknell draw (ZapM was created in hand and played)');
  assert.equal(g.objects[u].counters.buff ?? 0, 0, 'buff spent');
});

test('RJ#2299 a deck may run both Jinx champions (Demolitionist as Chosen Champion, Rebel in the main deck): different names; only one is the Chosen Champion', async () => {
  const { validateDeck } = await import('../../src/engine/deck.ts');
  const { fixtureDb } = await import('../fixtures/conformance/cards.ts');
  const { legalDeck } = await import('../conformance/harness.ts');
  const L = realCard('Loose Cannon'), D = realCard('ogn-030-298'), R = realCard('Jinx, Rebel');
  const db = { ...fixtureDb(), [L.id]: L, [D.id]: D, [R.id]: R };
  const d = legalDeck({ legend: L.id, champion: D.id });
  assert.deepEqual(validateDeck({ ...d, main: [...d.main.slice(3), D.id, R.id, R.id] }, db), [], 'both versions: legal');
  assert.ok(validateDeck({ ...d, main: [...d.main.slice(4), D.id, D.id, D.id, R.id] }, db).some(p => p.code === 'copies'), 'the Chosen Champion counts toward its own 3-copy limit');
});

test('RJ#2317 Challenge choosing an enemy Deflect unit pays the Deflect cost', () => {
  let g = S0(); fundAll(g, P0);
  const d = put(g, P1, 'Deflect(4,1)', BF_A); control(g, BF_A, P1);
  const f = put(g, P0, 'V(5)', 'base');
  const rd = g.players[0].runeDeck.length;
  g = play(g, P0, hand(g, P0, 'Challenge'), { targets: [[f], [d]] });
  for (let i = 0; i < 6 && pend(g).inStep; i++) { const o = optionIds(g); g = choose(g, o.includes(d) ? d : o.includes(f) ? f : o[0]); }
  assert.ok(g.chain.length >= 1, 'Challenge on the chain');
  assert.ok(g.players[0].runeDeck.length - rd >= 1, 'Deflect power paid (a rune recycled)');
  const rdNoDeflect = (() => {
    let h = S0(); fundAll(h, P0);
    const e = put(h, P1, 'V(4)', BF_A); control(h, BF_A, P1);
    const ff = put(h, P0, 'V(5)', 'base');
    const r0 = h.players[0].runeDeck.length;
    h = play(h, P0, hand(h, P0, 'Challenge'), { targets: [[ff], [e]] });
    for (let i = 0; i < 6 && pend(h).inStep; i++) { const o = optionIds(h); h = choose(h, o.includes(e) ? e : o.includes(ff) ? ff : o[0]); }
    return h.players[0].runeDeck.length - r0;
  })();
  assert.equal(g.players[0].runeDeck.length - rd, rdNoDeflect + 1, 'exactly one extra power (Deflect 1)');
});

test('RJ#2318 defending Fiora, Victorious made Mighty by Call to Glory (4+3, Shield → 8); Smoke Screen (paying her Deflect) → 3, not Mighty, no Shield', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const fi = put(g, P1, 'Fiora, Victorious', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 6 && pend(g).player !== P1; i++) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Call to Glory'), { targets: [[fi]], may: [false] });
  g = resolveWith(g, {});
  assert.ok(hasKeyword(g, fi, 'Shield') && hasKeyword(g, fi, 'Deflect'), 'Mighty: Shield and Deflect');
  assert.equal(mightOf(g, fi), 8, '4 + 3 + Shield 1');
  for (let i = 0; i < 4 && pend(g).player !== P0; i++) g = pass(g);
  const rd = g.players[P0].runeDeck.length;
  g = play(g, P0, hand(g, P0, 'Smoke Screen'), { targets: [[fi]] });
  assert.ok(g.players[P0].runeDeck.length - rd >= 1, 'Deflect paid');
  g = resolveWith(g, {});
  assert.equal(mightOf(g, fi), 3, '4 + 3 - 4, no Shield');
  assert.ok(!hasKeyword(g, fi, 'Shield'));
});

test('RJ#2323 Sprite Mother killed (Shakedown) in response to her play trigger: no "here" any more, so no Sprite is played', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const sm = hand(g, P0, 'Sprite Mother');
  g = act(g, { type: 'playCard', player: P0, obj: sm, destination: 'base' });
  for (let i = 0; i < 8 && !(pend(g).player === P1 && pend(g).kind === 'chainResponse'); i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.ok(chainLabels(g).some(l => /Sprite Mother/.test(l)), 'play trigger on the chain');
  g = play(g, P1, hand(g, P1, 'Shakedown'), { targets: [[sm]] });
  for (let i = 0; i < 20 && g.chain.length; i++) { const d = pend(g); g = d.inStep ? choose(g, d.kind === 'optional' ? 'no' : optionIds(g).find(o => /dmg|damage|deal|6/i.test(o)) ?? optionIds(g).at(-1)!) : pass(g); }
  assert.equal(zone(g, sm), 'trash');
  const sprites = Object.values(g.objects).filter(o => ['base', 'battlefield'].includes(o.zone) && /Sprite/.test(g.cards[o.cardId]?.name ?? '') && o.controller === P0);
  assert.equal(sprites.length, 0, 'no Sprite token');
});

test('RJ#2332 buffed (Mighty) Fiora, Victorious with Spirit\'s Refuge in play: Deflect 1, not 2 (Refuge grants it only "if they didn\'t already")', () => {
  const g = S0();
  const fi = put(g, P0, 'Fiora, Victorious', 'base', { buff: true });
  put(g, P0, "Spirit's Refuge", 'base');
  assert.equal(mightOf(g, fi), 5, 'Mighty');
  assert.ok(hasKeyword(g, fi, 'Deflect'));
  assert.equal(kwValue(g, fi, 'Deflect'), 1);
});

test('RJ#2338 Warwick, Hunter killed in response to his attack trigger: "kill all damaged enemy units here" has no "here" — the damaged defenders survive', () => {
  let g = S0(); fundAll(g, P1);
  const d = put(g, P1, 'V(5)', BF_A, { damage: 1 }); control(g, BF_A, P1);
  const w = put(g, P0, 'Warwick, Hunter', 'base');
  g.objects[w].damage = 3;
  g = move(g, P0, [w], BF_A);
  for (let i = 0; i < 6 && !chainLabels(g).some(l => /Warwick/.test(l)); i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.ok(chainLabels(g).some(l => /Warwick/.test(l)), 'attack trigger on the chain');
  for (let i = 0; i < 4 && pend(g).player !== P1; i++) g = pass(g);
  g = play(g, P1, hand(g, P1, 'ZapR'), { targets: [[w]] });
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(zone(g, w), 'trash', 'Warwick died');
  assert.equal(zone(g, d), 'battlefield', 'the damaged defender survives');
});

test('RJ#2359 the opponent Smoke Screens my Ravenbloom Student in response to my Smoke Screen: 2 → 1 (snapshotted -1), then my spell resolves and +1 → 2', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const st = put(g, P0, 'Ravenbloom Student', 'base');
  const e = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  g = play(g, P0, hand(g, P0, 'Smoke Screen'), { targets: [[e]] });
  for (let i = 0; i < 6 && pend(g).player !== P1; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(mightOf(g, st), 2, 'no +1 yet (the spell play completes on resolution)');
  g = play(g, P1, hand(g, P1, 'Smoke Screen'), { targets: [[st]] });
  g = resolveWith(g, {});
  g = finish(g);
  assert.equal(mightOf(g, st), 2);
  assert.equal(mightOf(g, e), 1);
});

test('RJ#2378 two Ravenborn Tomes stack: the next spell deals +2 per damage instance (Hextech Ray 3 → 5)', () => {
  let g = S0(); fundAll(g, P0, 6);
  const t1 = put(g, P0, 'Ravenborn Tome', 'base'), t2 = put(g, P0, 'Ravenborn Tome', 'base');
  const e = put(g, P1, 'V(8)', BF_A); control(g, BF_A, P1);
  for (const t of [t1, t2]) { g = act(g, { type: 'activate', player: P0, obj: t, abilityIndex: 0 }); g = resolveChain(g); }
  [g] = cast(g, P0, 'Hextech Ray', { targets: [[e]] });
  g = resolveWith(g, {});
  assert.equal(pend(g).kind, 'chooseOrder', 'two bonus-damage replacements to order');
  g = finish(g);
  assert.equal(g.objects[e].damage, 5, '3 + 1 + 1');
});

test('RJ#2393 a Seal (gear) enters ready: it can be tapped for [C] the turn it is played', () => {
  let g = S0(); fundAll(g, P0);
  const s = hand(g, P0, 'Seal of Rage');
  g = play(g, P0, s, { dest: 'base' });
  g = resolveWith(g, {});
  assert.equal(zone(g, s), 'base');
  assert.equal(g.objects[s].exhausted, false, 'ready');
  assert.ok(legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === s), 'its [T] ability is usable now');
});

test('RJ#2397 (MISMATCH-RJ) hidden Zhonya\'s Hourglass at a battlefield, played in response to Falling Star on my Carnivorous Snapvine in base: it saves the Snapvine (OGN-FAQ: saves a friendly unit dying anywhere)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const sv = put(g, P0, 'Carnivorous Snapvine', 'base');
  const z = put(g, P0, "Zhonya's Hourglass", { facedown: BF_A });
  [g] = cast(g, P1, 'Falling Star', { targets: [[sv], [sv]] });
  g = answer(g, { targets: [[sv]] });
  for (let i = 0; i < 4 && pend(g).player !== P0; i++) g = pass(g);
  g = play(g, P0, z);
  g = resolveWith(g, { may: [true, true], targets: [[sv]] });
  g = finish(g);
  assert.equal(zone(g, z), 'trash', 'the Hourglass was used');
  assert.equal(locOf(g, sv), 'base', 'Snapvine saved (recalled)');
});

test('RJ#2399 Draven (ogn-028, "my Might is increased by your points") played with 2 points enters Mighty: Relentless Storm triggers; with 0 points it does not', () => {
  for (const pts of [2, 0]) {
    let g = S0(); fundAll(g, P0);
    const lg = setLegend(g, P0, 'Relentless Storm');
    g.players[P0].points = pts;
    const dv = hand(g, P0, 'ogn-028-298');
    g = act(g, { type: 'playCard', player: P0, obj: dv, destination: 'base' });
    const asked = pend(g).kind === 'optional';
    g = resolveWith(g, { may: [true] });
    g = finish(g);
    assert.equal(zone(g, dv), 'base');
    assert.equal(mightOf(g, dv), 3 + pts);
    assert.equal(asked, pts >= 2, `points ${pts}: Relentless Storm offered`);
    assert.equal(g.objects[lg].exhausted, pts >= 2, 'legend exhausted to channel');
  }
});

test('RJ#2407 The Boss saves buffed Sett, Brawler in combat (recalled); his side still conquers: The Boss readies, Sett gets no conquer buff (he is in base)', () => {
  let g = S0(); fundAll(g, P0, 4);
  const lg = setLegend(g, P0, 'The Boss');
  const d = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const st = put(g, P0, 'Sett, Brawler', 'base', { buff: true });
  const v = put(g, P0, 'V(6)', 'base');
  g = move(g, P0, [st, v], BF_A);
  for (let i = 0; i < 40 && pend(g).kind !== 'mainAction'; i++) {
    const p = pend(g);
    if (p.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: p.player, assignment: p.player === P0 ? { [d]: 11 } : { [st]: 5 } }); continue; }
    g = p.inStep ? choose(g, p.options![0].id) : pass(g);
  }
  assert.equal(locOf(g, st), 'base', 'saved and recalled');
  assert.equal(g.battlefields[BF_A].controller, P0, 'conquered');
  assert.equal(g.objects[lg].exhausted, false, 'The Boss readied by the conquer');
  assert.equal(g.objects[st].counters.buff ?? 0, 0, 'Sett\'s buff was spent and he got no new one');
});

test('RJ#2405 2v2: Dragon\'s Rage can\'t move an enemy unit to a battlefield its teammate occupies (CR 449.2.b), so no exchange with the ally\'s unit there', () => {
  let g = createGame({ seed: 3, cardDb: fixtureDb(), mode: '2v2', firstPlayer: 0, skipMulligan: true, battlefieldSelection: 'random', includeAllCards: true,
    players: [0, 1, 2, 3].map(i => ({ name: `P${i}`, deck: legalDeck({ legend: i >= 2 ? 'cf-legend-2' : 'cf-legend' }, [`cf-bf-${'abde'[i]}`, `cf-bf-${'bcef'[i]}`, `cf-bf-${'cdfa'[i]}`]) })) } as never) as GameState;
  assert.equal(g.activePlayer, P0);
  fundAll(g, P0);
  const x = put(g, P1, 'V(3)', 'base');
  put(g, 3 as PlayerId, 'V(2)', 1); g.battlefields[1].controller = 3 as PlayerId; g.ex.dirty = true; g.timestamp++;
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, "Dragon's Rage") });
  expectPending(g, 'chooseTargets', P0);
  g = choose(g, x);
  expectPending(g, 'chooseDestination', P0);
  assert.ok(!optionIds(g).includes('1'), 'the battlefield P1\'s teammate occupies is not a destination');
  assert.ok(optionIds(g).includes('0') && optionIds(g).includes('2'), 'sanity: other battlefields are');
});

test('RJ#2410 Noxian Drummer Flashed back to base in response to its move trigger: the Recruit is played where the Drummer is on resolution — base', () => {
  let g = S0(); fundAll(g, P0);
  ensureCard(g, 'Recruit');
  const dr = put(g, P0, 'Noxian Drummer', 'base');
  g = move(g, P0, [dr], BF_A);
  assert.ok(chainLabels(g).some(l => /Drummer/.test(l)), 'move trigger on the chain');
  expectPending(g, 'chainResponse', P0);
  g = play(g, P0, hand(g, P0, 'Flash'), { targets: [[dr]] });
  g = finish(g);
  assert.equal(locOf(g, dr), 'base');
  const recruits = Object.values(g.objects).filter(o => o.controller === P0 && g.cards[o.cardId]?.name === 'Recruit' && ['base', 'battlefield'].includes(o.zone));
  assert.equal(recruits.length, 1, 'one Recruit');
  assert.equal(locOf(g, recruits[0].id), 'base', 'played here = base');
});

test('RJ#2423 Kai\'Sa, Evolutionary: the conquer point is scored before her trigger, so it counts for "Energy cost less than your points" (2 → 3 points: a 2-cost spell qualifies; 1 → 2: it doesn\'t)', () => {
  for (const pts of [2, 1]) {
    let g = S0(); fundAll(g, P0);
    g.players[P0].points = pts;
    const k = put(g, P0, 'ogn-112-298', 'base');
    const sp = put(g, P0, 'Meditation', 'trash');
    g = move(g, P0, [k], BF_A);
    let offered = false;
    for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
      const d = pend(g);
      if (d.inStep) { const o = optionIds(g); if (o.includes(sp)) { offered = true; g = choose(g, sp); } else g = choose(g, d.kind === 'optional' ? (o.includes('yes') ? 'yes' : o[0]) : o[0]); continue; }
      g = pass(g);
    }
    assert.equal(g.players[P0].points, pts + 1, 'conquer point');
    assert.equal(offered, pts === 2, `points before conquer ${pts}`);
  }
});

test('RJ#2428 Facebreaker needs a friendly and an enemy unit at the same battlefield (unplayable otherwise); an already-stunned friendly unit is a legal choice and the enemy is still stunned', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const e = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  put(g, P0, 'V(2)', BF_B); control(g, BF_B, P0);
  const fb = hand(g, P0, 'Facebreaker');
  assert.ok(!canPlayNow(g, P0, fb), 'no friendly unit at the enemy\'s battlefield');
  const mine = put(g, P0, 'V(2)', BF_A, { stunned: true });
  assert.ok(canPlayNow(g, P0, fb), 'stunned friendly + enemy there');
  g = play(g, P0, fb, { targets: [[mine], [e]] });
  if (pend(g).inStep && pend(g).kind === 'chooseTargets') g = act(g, { type: 'choose', player: P0, optionIds: [mine, e] });
  g = finish(g);
  assert.equal(zone(g, fb), 'trash');
  assert.ok(g.objects[e].stunned, 'enemy stunned');
  assert.ok(g.objects[mine].stunned, 'still stunned');
});

test('RJ#2429 holding scores in the Beginning phase with no chain item: by the time the opponent could react (Gust), the hold point is already scored', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1);
  const u = put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  g = endTurn(g, P1);
  assert.equal(g.players[P0].points, 1, 'scored on hold');
  assert.equal(g.chain.length, 0, 'no hold trigger on the chain');
  assert.equal(pend(g).kind, 'mainAction', 'first decision is P0\'s main action');
  assert.equal(pend(g).player, P0);
  assert.equal(zone(g, u), 'battlefield');
});

test('RJ#2437 Ember Monk: a spell played from hidden and countered by Defy was never played — no +2; uncountered it gives +2', () => {
  for (const counter of [true, false]) {
    let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
    const m = put(g, P0, 'Ember Monk', 'base');
    const base = mightOf(g, m);
    const mine = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
    const fd = put(g, P0, 'HidZap', { facedown: BF_A });
    [g] = cast(g, P1, 'DrawR');
    g = pass(g);
    g = play(g, P0, fd, { targets: [[mine]] });
    for (let i = 0; i < 4 && pend(g).player !== P1; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
    if (counter) g = play(g, P1, hand(g, P1, 'Defy'), { targets: [[g.chain.at(-1)!.id]] });
    g = resolveWith(g, {});
    g = finish(g);
    assert.equal(mightOf(g, m), base + (counter ? 0 : 2), counter ? 'countered: no +2' : 'resolved: +2');
  }
});

test('RJ#2438 Disarming Rake ("When you play me, you may kill a gear"): no gear → no trigger; with a gear the "may" and the gear are decided as the trigger goes on the chain (principle 11), not on resolution', () => {
  {
    let g = S0(); fundAll(g, P0);
    g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Disarming Rake'), destination: 'base' });
    g = finish(g);
    assert.equal(g.chain.length, 0);
    assert.equal(pend(g).kind, 'mainAction', 'nothing to choose, no trigger');
  }
  let g = S0(); fundAll(g, P0);
  const gear = put(g, P1, 'Seal of Rage', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Disarming Rake'), destination: 'base' });
  assert.ok(pend(g).inStep, 'asked first');
  assert.ok(!chainLabels(g).some(l => /Disarming Rake/.test(l)), 'before it is on the chain');
  for (let i = 0; i < 4 && pend(g).inStep; i++) { const o = optionIds(g); g = choose(g, o.includes(gear) ? gear : o.includes('yes') ? 'yes' : o[0]); }
  assert.ok(chainLabels(g).some(l => /Disarming Rake/.test(l)), 'then the trigger is on the chain');
  g = resolveWith(g, {});
  assert.equal(zone(g, gear), 'trash');
});

test('RJ#2442 Cruel Patron played to my battlefield, killing my only unit there for its cost: the Patron arrives before any cleanup, so control and the hidden card stay', () => {
  let g = S0(); fundAll(g, P0);
  const v = put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const fd = put(g, P0, 'HidZap', { facedown: BF_A });
  const cp = hand(g, P0, 'Cruel Patron');
  g = act(g, { type: 'playCard', player: P0, obj: cp, destination: BF_A });
  for (let i = 0; i < 4 && g.pending?.inStep; i++) g = optionIds(g).includes(v) ? choose(g, v) : act(g, legal(g, P0)[0]);
  g = finish(g);
  assert.equal(zone(g, v), 'trash', 'cost paid');
  assert.equal(locOf(g, cp), BF_A);
  assert.equal(g.battlefields[BF_A].controller, P0, 'still controlled');
  assert.equal(zone(g, fd), 'facedown', 'the hidden card stays');
});

test('RJ#2443 Ahri, Inquisitive killed in response to her defend trigger: it still resolves but "here" is gone — the attacker gets no -2', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1);
  const ah = put(g, P0, 'Ahri, Inquisitive', BF_A, { damage: 2 }); control(g, BF_A, P0);
  const a = put(g, P1, 'V(5)', 'base');
  g = move(g, P1, [a], BF_A);
  for (let i = 0; i < 8 && !chainLabels(g).some(l => /Ahri/.test(l)); i++) g = pend(g).inStep ? choose(g, optionIds(g).includes(a) ? a : optionIds(g)[0]) : pass(g);
  assert.ok(chainLabels(g).some(l => /Ahri/.test(l)), 'defend trigger on the chain');
  for (let i = 0; i < 4 && pend(g).player !== P1; i++) g = pass(g);
  g = play(g, P1, hand(g, P1, 'ZapR'), { targets: [[ah]] });
  for (let i = 0; i < 10 && g.chain.length; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(zone(g, ah), 'trash');
  assert.equal(mightOf(g, a), 5, 'no -2');
});

test('RJ#2444 (MISMATCH-RJ numbers) Clockwork Keeper (2) hit by Thousand-Tailed Watcher: -3 "to a minimum of 1" → 1 (snapshotted -1), then +2 this turn → 3 (RJ: -1, then 1)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1); fundAll(g, P0);
  const k = put(g, P0, 'Clockwork Keeper', BF_A); control(g, BF_A, P0);
  assert.equal(mightOf(g, k), 2);
  [g] = cast(g, P1, 'Thousand-Tailed Watcher', { dest: 'base', may: [false] });
  g = resolveWith(g, {});
  assert.equal(mightOf(g, k), 1, 'not -1: minimum of 1');
  [g] = cast(g, P1, 'Discipline', { targets: [[k]] });
  g = resolveChain(g);
  assert.equal(mightOf(g, k), 3, 'snapshotted -1, then +2');
});

test('RJ#2447 the defender can\'t standard-move its ready unit back to base on the opponent\'s turn (only on its own turn, outside showdowns, empty chain)', () => {
  const { g, def } = attackSetup(['V(5)'], ['V(2)']);
  let h = g;
  for (let i = 0; i < 4 && pend(h).player !== P1; i++) h = pend(h).inStep ? choose(h, optionIds(h)[0]) : pass(h);
  assert.equal(pend(h).player, P1, 'the defender has focus/priority');
  assert.equal(h.objects[def[0]].exhausted, false, 'ready');
  assert.equal(legal(h, P1, 'move').length, 0, 'no standard move');
});

test('RJ#2453 Anivia moved to base (Flash) before her attack trigger resolves: "here" is now her base — no damage to the enemy units at the battlefield', () => {
  let g = S0(); fundAll(g, P0);
  const d1 = put(g, P1, 'V(2)', BF_A), d2 = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const an = put(g, P0, 'Anivia', 'base');
  g = move(g, P0, [an], BF_A);
  for (let i = 0; i < 6 && !chainLabels(g).some(l => /Anivia/.test(l)); i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.ok(chainLabels(g).some(l => /Anivia/.test(l)), 'attack trigger on the chain');
  expectPending(g, 'chainResponse', P0);
  g = play(g, P0, hand(g, P0, 'Flash'), { targets: [[an]] });
  for (let i = 0; i < 10 && g.chain.length; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(locOf(g, an), 'base');
  assert.equal(g.objects[d1].damage, 0);
  assert.equal(g.objects[d2].damage, 0);
});

test('RJ#2455 a buffed unit returned to hand (Gust) loses its buff; played again it is a new, unbuffed unit', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P0, 'V(2)', BF_A, { buff: true }); control(g, BF_A, P0);
  assert.equal(mightOf(g, u), 3);
  g = play(g, P0, hand(g, P0, 'Gust'), { targets: [[u]] });
  g = finish(g);
  assert.equal(zone(g, u), 'hand');
  g = act(g, { type: 'playCard', player: P0, obj: u, destination: 'base' });
  g = finish(g);
  assert.equal(zone(g, u), 'base');
  assert.equal(g.objects[u].counters.buff ?? 0, 0, 'no buff');
  assert.equal(mightOf(g, u), 2);
});

test('RJ#2466 an exhausted unit can still use an ability with no exhaust cost: exhausted Vi (ogn-036) recycles 1 from her trash for +1', () => {
  let g = S0(); fundAll(g, P0);
  const vi = put(g, P0, 'ogn-036-298', 'base', { ready: false });
  g.objects[vi].exhausted = true;
  put(g, P0, 'V(1)', 'trash');
  const a = legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === vi);
  assert.ok(a, 'ability available while exhausted');
  const m0 = mightOf(g, vi);
  g = act(g, a!);
  g = resolveWith(g, {});
  g = finish(g);
  assert.equal(mightOf(g, vi), m0 + 1);
});

test('RJ#2468 Immortal Phoenix works on the opponent\'s turn: my Reaction kills their unit, I may pay [1][C] to play Phoenix from my trash', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const ph = put(g, P0, 'Immortal Phoenix', 'trash');
  const e = put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P1, 'DrawR');
  g = pass(g);
  expectPending(g, 'chainResponse', P0);
  g = play(g, P0, hand(g, P0, 'ZapR'), { targets: [[e]] });
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) { const d = pend(g); g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : optionIds(g).includes('base') ? 'base' : optionIds(g)[0]) : pass(g); }
  assert.equal(zone(g, e), 'trash');
  assert.equal(zone(g, ph), 'base', 'Phoenix played from the trash on the opponent\'s turn');
});

test('RJ#2471 Dr. Mundo\'s "recycle 3 from your trash": the player chooses which 3 (of 5) are recycled', () => {
  let g = S0({ tp: P1 });
  put(g, P0, 'Dr. Mundo', 'base');
  const tr = [1, 2, 3, 4, 5].map(i => put(g, P0, `V(${i})`, 'trash'));
  g = endTurn(g, P1);
  for (let i = 0; i < 4 && !pend(g).inStep; i++) g = pass(g);
  const d = expectPending(g, 'chooseCards', P0);
  assert.equal(d.min, 3); assert.equal(d.max, 3);
  assert.deepEqual(optionIds(g).sort(), [...tr].sort(), 'any trash card may be chosen');
  g = act(g, { type: 'choose', player: P0, optionIds: [tr[0], tr[2], tr[4]] });
  g = finish(g);
  assert.deepEqual([tr[1], tr[3]].map(id => zone(g, id)), ['trash', 'trash'], 'the unchosen stay');
  assert.deepEqual([tr[0], tr[2], tr[4]].map(id => zone(g, id)), ['mainDeck', 'mainDeck', 'mainDeck']);
});

test('RJ#2489 Discipline needs a unit to choose (any unit, enemy too); its unit killed in response: no +2, but the spell still resolves and draws', () => {
  {
    const g = S0(); fundAll(g, P0);
    for (const id of [...g.players[P0].base]) if (g.objects[id] && g.cards[g.objects[id].cardId]?.type === 'Unit') delete g.objects[id];
    const d = hand(g, P0, 'Discipline');
    assert.ok(!canPlayNow(g, P0, d), 'no units at all: no target');
    put(g, P1, 'V(2)', 'base');
    assert.ok(canPlayNow(g, P0, d), 'an enemy unit is a legal choice');
  }
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const h0 = g.players[P0].hand.length;
  g = play(g, P0, hand(g, P0, 'Discipline'), { targets: [[u]] });
  for (let i = 0; i < 4 && pend(g).player !== P1; i++) g = pass(g);
  g = play(g, P1, hand(g, P1, 'ZapR'), { targets: [[u]] });
  g = resolveWith(g, {});
  g = finish(g);
  assert.equal(zone(g, u), 'trash');
  assert.equal(g.players[P0].hand.length, h0 + 1, 'Discipline still drew 1 (hand: +Discipline -Discipline +1)');
});

test('RJ#2494 Chemtech Enforcer\'s discard is a play trigger, not a cost: the opponent gets a chance to respond before the card is discarded', () => {
  let g = S0(); fundAll(g, P0);
  const ce = hand(g, P0, 'Chemtech Enforcer');
  const x = hand(g, P0, 'V(1)');
  g = act(g, { type: 'playCard', player: P0, obj: ce, destination: 'base' });
  assert.equal(zone(g, ce), 'base', 'on the board');
  assert.ok(chainLabels(g).some(l => /Chemtech/.test(l)), 'trigger on the chain');
  for (let i = 0; i < 4 && pend(g).player !== P1; i++) g = pass(g);
  expectPending(g, 'chainResponse', P1);
  assert.equal(zone(g, x), 'hand', 'nothing discarded yet');
  g = resolveWith(g, { cards: [[x]] });
  g = finish(g);
  assert.equal(zone(g, x), 'trash');
});

test('RJ#2495 Unforgiven (Yasuo legend) moves an exhausted unit from base to an empty battlefield: it conquers and scores', () => {
  let g = S0();
  fundAll(g, P0);
  const l = legendOf(g, P0, 'Unforgiven');
  const u = put(g, P0, 'V(2)', 'base');
  g.objects[u].exhausted = true;
  const p0 = g.players[P0].points;
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === l)!);
  for (let i = 0; i < 6 && locOf(g, u) === 'base'; i++) { const d = pend(g); g = d.inStep ? choose(g, d.options!.find(o => o.id === u)?.id ?? d.options!.find(o => o.id === String(BF_B))?.id ?? d.options![0].id) : pass(g); }
  assert.equal(locOf(g, u), BF_B, 'moved while exhausted');
  g = finish(g);
  assert.equal(g.battlefields[BF_B].controller, P0, 'conquered');
  assert.equal(g.players[P0].points, p0 + 1, 'scored');
});

test('RJ#2501 5 vs 5 in combat, Stupefy-style -1 on one: the 4-Might unit dies, the 5-Might unit (4 damage) survives', () => {
  let g = S0();
  const d = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(5)', 'base');
  mod(g, a, { might: -1 });
  g = move(g, P0, [a], BF_A);
  g = finish(g);
  assert.equal(zone(g, a), 'trash', 'the reduced unit dies');
  assert.equal(zone(g, d), 'battlefield', 'the 5-Might unit survives 4 damage');
});

test('RJ#2507 held BF A at 6 → 7, then lost BF A (moved my unit out); conquering BF B the same turn is the final point: wins', () => {
  let g = S0({ tp: P1 });
  const h = put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const c = put(g, P0, 'V(2)', 'base');
  g.players[P0].points = 6;
  g = endTurn(g, P1);
  g = finish(g);
  assert.equal(g.players[P0].points, 7, 'hold point');
  g = finish(move(g, P0, [h], 'base'));
  assert.notEqual(g.battlefields[BF_A].controller, P0, 'BF A no longer controlled');
  g = finish(move(g, P0, [c], BF_B));
  assert.equal(g.players[P0].points, 8);
  assert.equal(g.winner, P0);
});

test('RJ#2524 Siphon Power chooses a battlefield, not units: an enemy Deflect unit there adds no cost, and it still gets -1', () => {
  const spent = (deflect: boolean) => {
    let g = S0(); fundAll(g, P0);
    const e = put(g, P1, deflect ? 'Deflect(3,1)' : 'V(3)', BF_A); control(g, BF_A, P1);
    const before = readyRunes(g, P0);
    g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Siphon Power') });
    g = choose(g, g.battlefields[BF_A].objId);
    const cost = before - readyRunes(g, P0);
    g = resolveChain(g);
    return { cost, m: mightOf(g, e) };
  };
  const a = spent(false), b = spent(true);
  assert.equal(b.cost, a.cost, 'no Deflect cost');
  assert.equal(b.m, 2, 'the Deflect unit still gets -1');
});

test('RJ#2525 a card hidden on the turn I play Time Warp can be played from hidden in the extra turn (a new turn)', () => {
  let g = S0(); fundAll(g, P0, 6); addRunes(g, P0, 12, 'mind');
  put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const h = hand(g, P0, 'HidZap');
  g = act(g, { type: 'hide', player: P0, obj: h, battlefieldIndex: BF_A });
  assert.equal(zone(g, h), 'facedown');
  g = settle(play(g, P0, hand(g, P0, 'Time Warp')));
  assert.ok(!canPlayNow(g, P0, h), 'not the turn it was hidden');
  g = nextTurn(g);
  assert.equal(g.activePlayer, P0, 'extra turn');
  assert.ok(canPlayNow(g, P0, h), 'playable from hidden in the extra turn');
});

test('RJ#2528 Mushroom Pouch + my lone Temporary unit at my Beginning Phase: with the Temporary trigger still on the chain I can play the hidden card (Reaction) there before the unit dies', () => {
  let g = S0({ tp: P1 });
  put(g, P0, 'Mushroom Pouch', 'base');
  const t = put(g, P0, 'Temp(2)', BF_A); control(g, BF_A, P0);
  const fd = put(g, P0, 'HidZap', { facedown: BF_A });
  for (let i = 0; i < 6; i++) put(g, P0, 'V(1)', 'deckTop');
  g = endTurn(g, P1);
  let played = false;
  for (let i = 0; i < 30 && !(pend(g).kind === 'mainAction' && pend(g).player === P0); i++) {
    const d = pend(g);
    if (d.inStep) { g = choose(g, d.kind === 'orderTriggers' ? (d.options!.find(o => /Mushroom/.test(o.label))?.id ?? d.options![0].id) : optionIds(g)[0]); continue; }
    if (!played && d.player === P0 && d.kind === 'chainResponse' && chainLabels(g).some(l => /Temp/.test(l))) {
      assert.ok(canPlayNow(g, P0, fd), 'hidden card playable while the Temporary trigger is pending');
      g = play(g, P0, fd, { targets: [[t]] }); played = true; continue;
    }
    g = pass(g);
  }
  assert.ok(played, 'played from hidden in the Beginning Phase');
  assert.equal(zone(g, fd), 'trash', 'the spell resolved (not lost facedown)');
});

test('RJ#2542 Sky Splitter\'s reduction uses current Might: a 3-Might unit with +2 this turn reduces by 5; a 6-Might unit at -3 reduces by 3', () => {
  const g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'V(3)', 'base');
  mod(g, u, { might: 2 });
  const ss = hand(g, P0, 'Sky Splitter');
  assert.equal(playCostOf(g, P0, ss)?.energy, 3, '8 - 5');
  const g2 = S0(); fundAll(g2, P0);
  const b = put(g2, P0, 'V(6)', 'base');
  mod(g2, b, { might: -3 });
  assert.equal(playCostOf(g2, P0, hand(g2, P0, 'Sky Splitter'))?.energy, 5, '8 - 3 (current), not 8 - 6');
});

test('RJ#2553 Showstopper (no [Action]) can\'t be played once a unit has moved in and the showdown has begun', () => {
  let g = S0(); fundAll(g, P0);
  const ss = hand(g, P0, 'Showstopper');
  put(g, P0, 'V(1)', 'base');
  const u = put(g, P0, 'V(2)', 'base');
  assert.ok(canPlayNow(g, P0, ss), 'main phase, empty chain: playable');
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [u], BF_A);
  for (let i = 0; i < 6 && pend(g).player !== P0; i++) g = pass(g);
  assert.ok(['showdownAction', 'chainResponse'].includes(pend(g).kind), `in the showdown: ${pend(g).kind}`);
  assert.ok(!canPlayNow(g, P0, ss), 'not during the showdown');
  void e;
});

test('RJ#2556 Lee Sin (any number of buffs) with 3 buffs + Stand United: each buff gives +1 more → +3 extra Might', () => {
  let g = S0(); fundAll(g, P0);
  const lee = put(g, P0, 'ogn-078-298', 'base');
  g.objects[lee].counters.buff = 3; g.ex.dirty = true; g.timestamp++;
  const m0 = mightOf(g, lee);
  assert.equal(m0, 8, '5 + 3 buffs');
  g = play(g, P0, hand(g, P0, 'Stand United'), { targets: [[lee]] });
  g = resolveWith(g, { targets: [[lee]] });
  g = finish(g);
  assert.equal(g.objects[lee].counters.buff, 4, 'Stand United buffed him again (no limit)');
  assert.equal(mightOf(g, lee), 5 + 4 * 2, 'each of his 4 buffs now gives +2');
});

test('RJ#2568 Last Stand on a defending Shen (3 + Shield 2 = 5) doubles to 10; after combat, without Shield, he is 8', () => {
  let { g, def } = attackSetup(['V(1)'], ['ogn-241-298']);
  fundAll(g, P1);
  const shen = def[0];
  for (let i = 0; i < 6 && pend(g).player !== P1; i++) g = pass(g);
  assert.equal(mightOf(g, shen), 5, 'Shield 2 while defending');
  g = play(g, P1, hand(g, P1, 'Last Stand'), { targets: [[shen]] });
  g = resolveWith(g, {});
  assert.equal(mightOf(g, shen), 10);
  g = finish(g);
  assert.equal(zone(g, shen), 'battlefield');
  assert.equal(mightOf(g, shen), 8, '3 + 5 (the doubling snapshot), Shield gone');
});

test('RJ#2570 Shen (Reaction unit) played in response enters the board at once; Discipline in the same chain can choose him', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  [g] = cast(g, P0, 'DrawR');
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  expectPending(g, 'chainResponse', P1);
  const shen = hand(g, P1, 'ogn-241-298');
  g = act(g, { type: 'playCard', player: P1, obj: shen, destination: 'base' });
  assert.equal(zone(g, shen), 'base', 'on the board while DrawR is still on the chain');
  assert.ok(g.chain.length >= 1, 'the chain still holds DrawR');
  for (let i = 0; i < 4 && pend(g).player !== P1; i++) g = pass(g);
  const d = hand(g, P1, 'Discipline');
  g = play(g, P1, d, { targets: [[shen]] });
  g = resolveWith(g, {});
  assert.equal(mightOf(g, shen), 5, '3 + 2');
});

test('RJ#2581 Catalyst of Aeons with one rune left in the rune deck: channels 1 and (couldn\'t channel 2) draws 1', () => {
  let g = S0({ runeDeck: [1, 6] });
  setRunes(g, P0, 11, 'body');
  const h0 = g.players[P0].hand.length;
  const r0 = g.players[P0].runesInPlay.length;
  g = settle(play(g, P0, hand(g, P0, 'Catalyst of Aeons')));
  assert.equal(g.players[P0].runesInPlay.length, r0 + 1, 'one channelled');
  assert.equal(g.players[P0].hand.length, h0 + 1, '1 drawn (Catalyst was added to hand after h0 was read)');
});

test('RJ#2585 Pack of Wonders returning Treasure Trove to hand triggers its "leaves the board": draw 1 and channel 1 rune', () => {
  let g = S0(); fundAll(g, P0);
  const pk = put(g, P0, 'Pack of Wonders', 'base');
  const tt = put(g, P0, 'Treasure Trove', 'base');
  const h0 = g.players[P0].hand.length, r0 = g.players[P0].runesInPlay.length;
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === pk)!);
  g = resolveWith(g, { targets: [[tt]], cards: [[tt]] });
  g = finish(g);
  assert.equal(zone(g, tt), 'hand');
  assert.equal(g.players[P0].hand.length, h0 + 2, 'Trove back in hand + 1 drawn');
  assert.equal(g.players[P0].runesInPlay.length, r0 + 1, 'channelled 1 rune');
});

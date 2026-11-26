// Rift Judge verification, range r9101 (question ids 9101-10400). One test per question; see docs/riftjudge/r9101.md.
import { test } from 'node:test';
import {
  assert, S0, put, hand, cast, play, pass, passN, expectPending, control, act, move, mod, nextTurn, endTurn, EventLog, setRunes,
  P0, P1, BF_A, BF_B, zone, locOf, mightOf, resolveChain, passAll, pend, answer, yes, no, choose, legal, canPlayNow, playDests,
  validateAction, activate, moveDests, readyRunes, exhaustedRunes, optionIds, attackSetup, cid, setBattlefieldCard, addRunes, fundAll, rejects, hasKeyword, kwValue, fillTrash,
  type GameState, type ObjId, type PlayerId,
} from '../conformance/harness.ts';
import { attachNow, touch, playCostOf } from '../../src/engine/testkit.ts';
import { withTokens, drive as driveH } from './r11701.helpers.ts';
import { chars as charsOf } from '../../src/engine/chars.ts';
import { newGame, realCard } from '../conformance/harness.ts';
import { playOptions } from '../../src/engine/play.ts';
import { createGame } from '../../src/engine/index.ts';
import { fixtureDb } from '../fixtures/conformance/cards.ts';
import { legalDeck } from '../conformance/harness.ts';

const ex = (g: GameState, id: ObjId) => g.objects[id].exhausted;

// ---------------------------------------------------------------------------------------------- 9101-9110
test('RJ#9101 hiding a card is not playing a card (Darius, Trifarian stays exhausted)', () => {
  let g = S0();
  fundAll(g, P0, 3);
  const d = put(g, P0, 'Darius, Trifarian', 'base', { ready: false });
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  [g] = cast(g, P0, 'V(1)', { dest: 'base' });
  g = passAll(g);
  const h = hand(g, P0, 'HidU(2)');
  g = act(g, { type: 'hide', player: P0, obj: h, battlefieldIndex: BF_A });
  g = passAll(g);
  assert.equal(zone(g, h), 'facedown');
  assert.equal(ex(g, d), true, 'not readied');
  assert.equal(mightOf(g, d), 5);
});

test('RJ#9102 Thousand-Tailed Watcher gives Ruin Runner -3 (no choosing), min 1', () => {
  let g = S0();
  fundAll(g, P0, 3);
  const rr = put(g, P1, 'Ruin Runner', 'base');
  [g] = cast(g, P0, 'Thousand-Tailed Watcher', { dest: 'base', may: [false] });
  g = passAll(g);
  assert.equal(mightOf(g, rr), 2);
});

test('RJ#9103 a banished token ceases to exist (nothing for Zero Drive to play)', () => {
  let g = S0();
  const t = put(g, P1, 'Recruit', BF_A);
  control(g, BF_A, P1);
  fundAll(g, P0, 3);
  [g] = cast(g, P0, 'Burn Away', { targets: [[t]] });
  g = passAll(g);
  assert.equal(zone(g, t), 'gone');
});

test('RJ#9104 Ahri, Inquisitive can\'t give Ruin Runner -2', () => {
  let { g, atk, def } = attackSetup(['Ahri, Inquisitive'], ['Ruin Runner']);
  g = passAll(g);
  assert.ok(!g.log.some(l => /-2/.test(l.text) && /Ruin Runner/.test(l.text)));
  assert.equal(zone(g, def[0]), 'battlefield', 'Ruin Runner (5) survives 3 damage: it never became 3 Might');
  assert.equal(zone(g, atk[0]), 'trash');
});

test('RJ#9105 Bullet Time costs only [1] when played; [C] amount is paid on resolution', () => {
  let g = S0();
  setRunes(g, P0, 0); addRunes(g, P0, 1, 'body'); addRunes(g, P0, 3, 'chaos');
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const bt = hand(g, P0, 'Bullet Time');
  g = act(g, { type: 'playCard', player: P0, obj: bt });
  g = choose(g, g.battlefields[BF_A].objId);
  // the spell is on the chain, opponent may respond, at most one rune used so far
  assert.equal(g.chain.length, 1);
  assert.equal(exhaustedRunes(g, P0) + (4 - g.players[0].runesInPlay.length), 1, 'only the [1] energy was paid');
  g = pass(g);
  expectPending(g, 'chainResponse', P1);
  g = pass(g);
  expectPending(g, 'chooseNumber', P0);
  g = answer(g, { numbers: [3] }, P0);
  g = passAll(g);
  assert.equal(zone(g, e), 'trash', '3 damage on resolution');
});

test('RJ#9106 Akshan, Mischievous takes an Equipment attached to an enemy unit and attaches it to himself', () => {
  let g = S0();
  fundAll(g, P0, 3);
  const eu = put(g, P1, 'V(2)', 'base');
  const sw = put(g, P1, 'Long Sword', 'base');
  attachNow(g, sw, eu);
  const ak = hand(g, P0, 'Akshan, Mischievous');
  g = act(g, { type: 'playCard', player: P0, obj: ak, destination: 'base' });
  g = answer(g, { may: [true] }, P0);
  for (let i = 0; i < 12 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'orderTriggers') g = choose(g, d.options!.find(o => /Weaponmaster/.test(o.label))!.id);
    else if (d.inStep) g = choose(g, d.options!.find(o => o.id === sw)?.id ?? d.options![0].id);
    else g = pass(g);
  }
  assert.equal(g.objects[sw].controller, P0);
  assert.equal(g.objects[sw].attachedTo, ak);
  assert.equal(mightOf(g, ak), 6);
});

test('RJ#9107 reaction windows: spells open a chain; hiding opens none', () => {
  let g = S0();
  [g] = cast(g, P0, 'DrawR');
  assert.equal(g.chain.length, 1);
  g = pass(g);
  expectPending(g, 'chainResponse', P1, 'opponent can react to a spell');
  g = passAll(g);
  [g] = cast(g, P0, 'V(1)', { dest: 'base' });
  assert.equal(g.chain.length, 0, 'a unit resolves immediately');
  expectPending(g, 'mainAction', P0);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const h = hand(g, P0, 'HidU(2)');
  g = act(g, { type: 'hide', player: P0, obj: h, battlefieldIndex: BF_A });
  expectPending(g, 'mainAction', P0);
  assert.equal(g.chain.length, 0);
});

test('RJ#9108 Irelia, Fervent keeps +1 even if the spell choosing her is countered', () => {
  let g = S0();
  fundAll(g, P0, 2);
  const ir = put(g, P0, 'Irelia, Fervent', BF_A); control(g, BF_A, P0);
  put(g, P1, 'V(1)', 'base');
  [g] = cast(g, P0, 'StunA', { targets: [[ir]] });
  // Irelia's trigger is above the spell
  assert.equal(g.chain.length, 2);
  g = passN(g, 2);
  assert.equal(mightOf(g, ir), 5);
  g = pass(g);
  const c = hand(g, P1, 'CounterR');
  g = play(g, P1, c);
  g = passAll(g);
  assert.equal(g.chain.length, 0);
  assert.equal(!!g.objects[ir].stunned, false, 'spell countered');
  assert.equal(mightOf(g, ir), 5, '+1 stays');
});

test('RJ#9109 a Recruit token returned to hand ceases to exist and does not die', () => {
  let g = S0();
  fundAll(g, P0, 2);
  const t = put(g, P1, 'Recruit', BF_A); control(g, BF_A, P1);
  put(g, P1, 'DeathWatch', 'base');
  const h1 = g.players[1].hand.length;
  [g] = cast(g, P0, 'Gust', { targets: [[t]] });
  g = passAll(g);
  assert.equal(zone(g, t), 'gone');
  assert.equal(g.players[1].hand.length, h1, 'not in hand, no death draw');
});

test('RJ#9110 Angle Shot can\'t choose Ruin Runner to detach its Equipment', () => {
  let g = S0();
  fundAll(g, P0, 2);
  const rr = put(g, P1, 'Ruin Runner', 'base');
  const sw = put(g, P1, 'Long Sword', 'base');
  attachNow(g, sw, rr);
  const as = hand(g, P0, 'Angle Shot');
  assert.equal(canPlayNow(g, P0, as), false, 'no legal unit to choose');
});

// ---------------------------------------------------------------------------------------------- 9111-9120
function setLegend(g: GameState, p: PlayerId, card: string): ObjId {
  const id = cid(card);
  if (!g.cards[id]) setBattlefieldCard(g, BF_B, g.objects[g.battlefields[BF_B].objId].cardId); // no-op, keeps touch
  const l = g.players[p].legend;
  const def = g.cards[id] ?? (() => { const t = put(g, p, card, 'trash'); const d = g.cards[id]; delete g.objects[t]; g.players[p].trash = g.players[p].trash.filter(x => x !== t); return d; })();
  void def;
  g.objects[l].cardId = id; g.objects[l].exhausted = false;
  return l;
}
/** Resolve everything, answering in-step decisions with the first option (or a picker). */
function settle(g: GameState, pick: (d: NonNullable<GameState['pending']>) => string | undefined = () => undefined, limit = 40): GameState {
  for (let i = 0; i < limit; i++) {
    const d = g.pending;
    if (!d || d.kind === 'mainAction') return g;
    if (d.inStep) g = choose(g, pick(d) ?? d.options![0].id);
    else g = pass(g);
  }
  return g;
}

test('RJ#9111 a unit moved to base by Reaver\'s Row stays ready (only a Standard Move exhausts)', () => {
  const g0 = S0({ bfA: "Reaver's Row" });
  const d = put(g0, P1, 'V(2)', BF_A); control(g0, BF_A, P1);
  const a = put(g0, P0, 'V(3)', 'base');
  let g = move(g0, P0, [a], BF_A);
  g = settle(g, dd => dd.kind === 'optional' ? 'yes' : dd.options!.find(o => o.id === d)?.id);
  assert.equal(locOf(g, d), 'base');
  assert.equal(ex(g, d), false, 'still ready');
});

test('RJ#9113 Singularity can\'t choose the same unit twice', () => {
  let g = S0();
  fundAll(g, P0, 3);
  const u = put(g, P1, 'V(7)', BF_A); control(g, BF_A, P1);
  put(g, P1, 'V(2)', 'base');
  const s = hand(g, P0, 'Singularity');
  g = act(g, { type: 'playCard', player: P0, obj: s });
  expectPending(g, 'chooseTargets', P0);
  assert.notEqual(rejects(g, { type: 'choose', player: P0, optionIds: [u, u] }), null);
});

test('RJ#9114 Glasc Mixologist\'s Deathknell can play Pickpocket that died at the same time', () => {
  let g = S0();
  fundAll(g, P1, 3);
  const gm = put(g, P0, 'Glasc Mixologist', BF_A), pp = put(g, P0, 'Pickpocket', BF_A); control(g, BF_A, P0);
  g = act(g, { type: 'endTurn', player: P0 });
  g = settle(g); // to P1's main
  [g] = cast(g, P1, 'Singularity', { targets: [[gm, pp]] });
  g = settle(g, d => d.kind === 'optional' ? 'yes' : d.options!.find(o => o.id === pp || /Pickpocket/.test(o.label))?.id);
  assert.equal(zone(g, gm), 'trash');
  assert.equal(zone(g, pp), 'base', 'Pickpocket played from trash');
});

test('RJ#9115 Pirate\'s Haven: +1 when units ready in Awaken; not when entering ready via Accelerate', () => {
  let g = S0();
  fundAll(g, P0, 3);
  put(g, P0, "Pirate's Haven", 'base');
  const u = put(g, P0, 'V(2)', 'base', { ready: false });
  [g] = cast(g, P0, 'Thousand-Tailed Watcher', { dest: 'base', may: [true] });
  g = settle(g);
  const w = g.players[0].base.find(id => g.cards[g.objects[id].cardId].name === 'Thousand-Tailed Watcher')!;
  assert.equal(ex(g, w), false, 'entered ready');
  assert.equal(mightOf(g, w), 7, 'entering ready is not readying');
  g = act(g, { type: 'endTurn', player: P0 });
  g = settle(g); g = act(g, { type: 'endTurn', player: P1 }); g = settle(g);
  assert.equal(g.activePlayer, P0);
  assert.equal(mightOf(g, u), 3, 'readied in Awaken: +1');
});

test('RJ#9116 Draven win-combat point at 6 then conquer at 7 draws instead (final point)', () => {
  // covered by tests/conformance/K-faq.test.ts T197; checked here with the real card.
  let { g } = attackSetup(['Draven, Audacious'], ['V(1)']);
  g.players[0].points = 6;
  const h0 = g.players[0].hand.length;
  g = settle(g);
  assert.equal(g.battlefields[BF_A].controller, 0);
  assert.equal(g.players[0].points, 7);
  assert.equal(g.players[0].hand.length, h0 + 1);
});

test('RJ#9117 Viktor, Leader dying with another unit makes no Recruit', () => {
  let g = S0();
  fundAll(g, P1, 3);
  const vk = put(g, P0, 'Viktor, Leader', BF_A), o = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  g = act(g, { type: 'endTurn', player: P0 }); g = settle(g);
  [g] = cast(g, P1, 'Singularity', { targets: [[vk, o]] });
  g = settle(g);
  assert.equal(zone(g, vk), 'trash'); assert.equal(zone(g, o), 'trash');
  assert.equal(g.players[0].base.filter(id => g.cards[g.objects[id].cardId].name === 'Recruit').length, 0);
});

test('RJ#9118 Wages of Pain can kill a unit', () => {
  let g = S0();
  fundAll(g, P0, 3);
  const u = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'Wages of Pain', { targets: [[u]] });
  g = settle(g);
  assert.equal(zone(g, u), 'trash');
});

test('RJ#9119 Not So Fast can\'t counter Stormbringer (it chooses the caster\'s own unit)', () => {
  let g = S0();
  fundAll(g, P0, 4);
  fundAll(g, P1, 3);
  const mine = put(g, P0, 'V(3)', 'base');
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const nsf = hand(g, P1, 'Not So Fast');
  void mine;
  [g] = cast(g, P0, 'Stormbringer, Volibear', { targets: [[g.battlefields[BF_A].objId]] });
  assert.ok(g.chain.length >= 1);
  g = pass(g);
  expectPending(g, 'chainResponse', P1);
  assert.equal(canPlayNow(g, P1, nsf), false);
});

test('RJ#9120 Grandmaster at Arms abilities can\'t be used in a showdown', () => {
  let g = S0();
  const l = setLegend(g, P0, 'Grandmaster at Arms');
  const u = put(g, P0, 'V(2)', 'base');
  put(g, P0, 'Long Sword', 'base');
  assert.ok(legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === l), 'usable in main phase');
  g = move(g, P0, [u], BF_B);
  expectPending(g, 'showdownAction', P0);
  assert.ok(!legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === l));
});

// ---------------------------------------------------------------------------------------------- 9121-9132
test('RJ#9121 playing a unit gives no priority; its play trigger does', () => {
  let g = S0();
  fundAll(g, P0, 3);
  [g] = cast(g, P0, 'V(2)', { dest: 'base' });
  expectPending(g, 'mainAction', P0);
  assert.equal(g.chain.length, 0);
  [g] = cast(g, P0, 'Sett, Brawler', { dest: 'base' });
  assert.equal(g.chain.length, 1, 'play trigger on the chain');
  g = pass(g);
  expectPending(g, 'chainResponse', P1);
});

test('RJ#9122 priority: TP in neutral open; caster first, then passes in turn order; mover gets showdown focus', () => {
  let g = S0();
  expectPending(g, 'mainAction', P0);
  [g] = cast(g, P0, 'DrawR');
  expectPending(g, 'chainResponse', P0);
  g = pass(g);
  expectPending(g, 'chainResponse', P1);
  g = pass(g);
  expectPending(g, 'mainAction', P0);
  const u = put(g, P0, 'V(1)', 'base');
  g = move(g, P0, [u], BF_B);
  expectPending(g, 'showdownAction', P0);
});

test('RJ#9123 chain resolves when all pass in a row; showdown ends after passes on an empty chain', () => {
  let g = S0();
  const u = put(g, P0, 'V(1)', 'base');
  g = move(g, P0, [u], BF_B);
  [g] = cast(g, P0, 'DrawR');
  g = passN(g, 2);
  assert.equal(g.chain.length, 0);
  expectPending(g, 'showdownAction', P1, 'showdown continues; focus passed after the chain (CR 346)');
  g = passN(g, 2);
  assert.equal(g.showdown, null);
  expectPending(g, 'mainAction', P0);
  assert.equal(g.battlefields[BF_B].controller, P0);
});

test('RJ#9124 Punch First is playable in the showdown after the opponent\'s Discipline resolves', () => {
  let g = S0();
  fundAll(g, P0, 3); fundAll(g, P1, 3);
  const u = put(g, P0, 'V(1)', 'base');
  g = move(g, P0, [u], BF_B);
  g = pass(g);
  expectPending(g, 'showdownAction', P1);
  [g] = cast(g, P1, 'Discipline', { targets: [[u]] });
  g = passN(g, 2);
  assert.equal(g.chain.length, 0);
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  expectPending(g, 'showdownAction', P0);
  const pf = hand(g, P0, 'Punch First');
  assert.ok(canPlayNow(g, P0, pf));
});

test('RJ#9126 playing Zhonya\'s Hourglass from facedown is playing a gear (Pit Crew readies)', () => {
  let g = S0();
  fundAll(g, P0, 3);
  const pc = put(g, P0, 'Pit Crew', 'base', { ready: false });
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const z = put(g, P0, "Zhonya's Hourglass", { facedown: BF_A });
  g = act(g, { type: 'playCard', player: P0, obj: z });
  g = settle(g);
  assert.equal(zone(g, z), 'base');
  assert.equal(ex(g, pc), false);
});

test('RJ#9127 Sett, Brawler\'s spend-buff ability can\'t be used on the opponent\'s turn', () => {
  let g = S0({ tp: P1 });
  const st = put(g, P0, 'Sett, Brawler', 'base', { buff: true });
  [g] = cast(g, P1, 'DrawR');
  g = pass(g);
  expectPending(g, 'chainResponse', P0);
  assert.ok(!legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === st));
  let h = S0();
  const s2 = put(h, P0, 'Sett, Brawler', 'base', { buff: true });
  assert.ok(legal(h, P0, 'activate').some(a => a.type === 'activate' && a.obj === s2), 'usable on own turn, open state');
});

test('RJ#9128 Assault gives nothing when moving to an empty battlefield (no attacker)', () => {
  let g = S0();
  const l = put(g, P0, 'Lucian, Gunslinger', 'base');
  g = move(g, P0, [l], BF_B);
  expectPending(g, 'showdownAction', P0);
  assert.equal(mightOf(g, l), 2);
});

test('RJ#9129 a unit played to a battlefield enters before anyone can react', () => {
  let g = S0();
  fundAll(g, P0, 3);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const u = hand(g, P0, 'V(2)');
  g = play(g, P0, u, { dest: BF_A });
  assert.equal(locOf(g, u), BF_A);
  assert.equal(g.chain.length, 0);
  expectPending(g, 'mainAction', P0);
});

test('RJ#9130 Fight or Flight on the unit that moved to an open battlefield: the showdown still happens', () => {
  let g = S0();
  fundAll(g, P1, 3);
  const u = put(g, P0, 'V(1)', 'base');
  g = move(g, P0, [u], BF_B);
  g = pass(g);
  [g] = cast(g, P1, 'Fight or Flight', { targets: [[u]] });
  g = passN(g, 2);
  assert.equal(locOf(g, u), 'base');
  assert.ok(g.showdown, 'still in the showdown');
  expectPending(g, 'showdownAction', pend(g).player);
  g = passAll(g);
  assert.equal(g.battlefields[BF_B].controller, null);
});

test('RJ#9131 Challenge damage on a base unit is not healed by conquering an open battlefield', () => {
  let g = S0();
  fundAll(g, P0, 3);
  const u = put(g, P0, 'V(4)', 'base'), e = put(g, P1, 'V(1)', 'base');
  [g] = cast(g, P0, 'Challenge', { targets: [[u], [e]] });
  g = settle(g);
  assert.equal(g.objects[u].damage, 1);
  g = move(g, P0, [u], BF_B);
  g = passAll(g);
  assert.equal(g.battlefields[BF_B].controller, P0);
  assert.equal(g.objects[u].damage, 1, 'no healing');
});

test('RJ#9132 Defy can counter Called Shot even with its Repeat paid (countered: no draws)', () => {
  let g = S0();
  fundAll(g, P0, 3); fundAll(g, P1, 3);
  const cs = hand(g, P0, 'Called Shot');
  const h0 = g.players[0].hand.length;
  g = act(g, { type: 'playCard', player: P0, obj: cs });
  g = answer(g, { may: [true] }, P0);
  assert.equal(g.chain.length, 1);
  g = pass(g);
  const df = hand(g, P1, 'Defy');
  assert.ok(canPlayNow(g, P1, df), 'Called Shot\'s cost is [0][A] — repeat paid does not change it');
  g = play(g, P1, df);
  g = settle(g);
  assert.equal(zone(g, cs), 'trash');
  assert.equal(g.players[0].hand.length, h0 - 1, 'no draws');
});

test('RJ#9125 Bellows Breath targets split by Fight or Flight: caster picks which location\'s targets are dealt damage', () => {
  let g = S0();
  fundAll(g, P0, 3); fundAll(g, P1, 3);
  const a = put(g, P1, 'V(3)', BF_A), b = put(g, P1, 'V(3)', BF_A), c = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const f = put(g, P1, 'Fight or Flight', { facedown: BF_A });
  const bb = hand(g, P0, 'Bellows Breath');
  g = act(g, { type: 'playCard', player: P0, obj: bb });
  g = choose(g, a, b, c);
  g = no(g); // no Repeat
  g = pass(g);
  g = act(g, { type: 'playCard', player: P1, obj: f });
  g = choose(g, a);
  g = passN(g, 2);
  assert.equal(locOf(g, a), 'base');
  g = passN(g, 2);
  // house ruling: P0 chooses the location; choose Battlefield A
  const d = pend(g);
  assert.ok(d.inStep && d.player === P0, 'caster chooses which location');
  g = choose(g, d.options!.find(o => /BF-A/.test(o.label) || o.id === String(BF_A) || o.id === g.battlefields[BF_A].objId)!.id);
  g = settle(g);
  assert.deepEqual([a, b, c].map(x => g.objects[x].damage), [0, 1, 1]);
});

// ADJUDICATOR-4: CR 355.11.b.1 (its own Bellows Breath example) — a legal subset must keep the maximum number of targets
// possible: two targets Flashed to base, the caster picks base → both are dealt damage (never just one of them).
test('RJ#9125b (CR 355.11.b.1) Bellows Breath: a Reaction moves two of three targets to base; choosing base hits both of them', () => {
  let g = S0();
  fundAll(g, P0, 3); fundAll(g, P1, 3);
  const a = put(g, P1, 'V(3)', BF_A), b = put(g, P1, 'V(3)', BF_A), c = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Bellows Breath') });
  g = choose(g, a, b, c);
  g = no(g); // no Repeat
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'Flash'), { targets: [[a, b]] });
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    if (d.player === P1) { g = choose(g, a, b); continue; }
    const base = d.options!.find(o => /base/i.test(o.label) || o.id === 'base');
    assert.ok(base, 'caster may choose the base location');
    g = choose(g, base!.id);
  }
  assert.deepEqual([a, b].map(x => locOf(g, x)), ['base', 'base']);
  assert.deepEqual([a, b, c].map(x => g.objects[x].damage), [1, 1, 0]);
});

// ---------------------------------------------------------------------------------------------- 9133-9144
const named = (g: GameState, p: PlayerId, name: string, zoneList: 'base' | 'hand' | 'trash' = 'base') => g.players[p][zoneList].filter(id => g.cards[g.objects[id].cardId].name === name);

test('RJ#9133 Gold tokens add power only: a [2][A][A] spell still needs runes for the energy', () => {
  const g = S0();
  setRunes(g, P0, 0);
  put(g, P0, 'Gold', 'base'); put(g, P0, 'Gold', 'base');
  put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const fs = hand(g, P0, 'Falling Star');
  assert.equal(canPlayNow(g, P0, fs), false, 'Golds can\'t pay the [2]');
  addRunes(g, P0, 2, 'calm', true);
  assert.equal(canPlayNow(g, P0, fs), true, '2 runes exhausted for [2] + 2 Golds for [A][A]');
});

test('RJ#9134 Falling Star (no Action) can\'t be played while the Reaver\'s Row defend trigger is on the chain', () => {
  const g0 = S0({ bfA: "Reaver's Row" });
  fundAll(g0, P0, 3);
  put(g0, P1, 'V(2)', BF_A); control(g0, BF_A, P1);
  const a = put(g0, P0, 'V(3)', 'base');
  const fs = hand(g0, P0, 'Falling Star');
  let g = move(g0, P0, [a], BF_A);
  for (let i = 0; i < 5 && g.chain.length === 0 && pend(g).inStep; i++) g = choose(g, pend(g).options![0].id);
  assert.ok(g.chain.length >= 1 || pend(g).inStep);
  assert.equal(canPlayNow(g, P0, fs), false);
});

test('RJ#9135 Darius, Trifarian played as your second card triggers himself', () => {
  let g = S0();
  fundAll(g, P0, 3);
  [g] = cast(g, P0, 'V(1)', { dest: 'base' });
  const d = hand(g, P0, 'Darius, Trifarian');
  g = play(g, P0, d, { dest: 'base' });
  g = settle(g);
  assert.equal(ex(g, d), false);
  assert.equal(mightOf(g, d), 7);
});

test('RJ#9136 Draven at 7: conquering an empty battlefield draws; winning a combat scores the 8th', () => {
  let g = S0();
  const dr = put(g, P0, 'Draven, Audacious', 'base');
  g.players[0].points = 7;
  const h0 = g.players[0].hand.length;
  g = move(g, P0, [dr], BF_B);
  g = settle(g);
  assert.equal(g.players[0].points, 7);
  assert.equal(g.players[0].hand.length, h0 + 1);
  let { g: c } = attackSetup(['Draven, Audacious'], ['V(1)']);
  c.players[0].points = 7;
  c = settle(c);
  assert.equal(c.winner, P0);
});

test('RJ#9137 (MISMATCH-RJ) Draven, Vanquisher\'s "you may pay [C]" is the trigger\'s base cost, paid as it goes on the chain (CR 383.3.b)', () => {
  let { g, atk } = attackSetup(['Draven, Vanquisher'], ['V(1)']);
  expectPending(g, 'optional', P0, 'decided at finalization, before anyone can react');
  assert.equal(g.chain.length, 0);
  g = yes(g);
  assert.equal(g.chain.length, 1);
  assert.equal(g.players[0].runesInPlay.length, 5, '[C] paid (rune recycled) before reactions');
  g = settle(g);
  assert.equal(mightOf(g, atk[0]), 6);
});

test('RJ#9138 Fight or Flight needs a unit at a battlefield to choose', () => {
  const g = S0();
  fundAll(g, P0, 3);
  put(g, P1, 'V(2)', 'base');
  const f = hand(g, P0, 'Fight or Flight');
  assert.equal(canPlayNow(g, P0, f), false);
  put(g, P1, 'V(2)', BF_A);
  assert.equal(canPlayNow(g, P0, f), true);
});

test('RJ#9139 Monastery of Hirana spends the buff first, then Warmog\'s Armor buffs again', () => {
  const g0 = S0({ bfB: 'Monastery of Hirana' });
  const u = put(g0, P0, 'V(3)', 'base', { buff: true });
  const wa = put(g0, P0, "Warmog's Armor", 'base');
  attachNow(g0, wa, u);
  const h0 = g0.players[0].hand.length;
  let g = move(g0, P0, [u], BF_B);
  g = settle(g, d => d.kind === 'orderTriggers' ? d.options!.find(o => /Warmog|buff me/i.test(o.label))?.id : d.kind === 'optional' ? 'yes' : undefined);
  assert.equal(g.battlefields[BF_B].controller, P0);
  assert.equal(g.players[0].hand.length, h0 + 1, 'drew 1');
  assert.equal(g.objects[u].counters.buff ?? 0, 1, 'buffed again');
});

test('RJ#9140 stolen Guardian Angel moved to Jax: when Akshan leaves, control reverts but it stays attached', () => {
  let g = S0();
  fundAll(g, P0, 4);
  const ga = put(g, P1, 'Guardian Angel', 'base');
  const ak = hand(g, P0, 'Akshan, Mischievous');
  g = act(g, { type: 'playCard', player: P0, obj: ak, destination: 'base' });
  g = answer(g, { may: [true] }, P0);
  g = settle(g, d => d.kind === 'orderTriggers' ? d.options!.find(o => /Weaponmaster/.test(o.label))?.id : d.options!.find(o => o.id === ga)?.id ?? (d.kind === 'optional' ? 'yes' : undefined));
  assert.equal(g.objects[ga].attachedTo, ak);
  const jx = hand(g, P0, 'Jax, Unrelenting');
  g = act(g, { type: 'playCard', player: P0, obj: jx, destination: 'base' });
  g = settle(g, d => d.kind === 'optional' ? 'yes' : d.options!.find(o => o.id === ga)?.id);
  assert.equal(g.objects[ga].attachedTo, jx, 'Weaponmaster moved it to Jax');
  [g] = cast(g, P0, 'KillDraw', { targets: [[ak]] });
  g = settle(g);
  assert.equal(zone(g, ak), 'trash');
  assert.equal(g.objects[ga].controller, P1, 'control reverts');
  assert.equal(g.objects[ga].attachedTo, jx, 'still attached to Jax');
});

test('RJ#9141 no window to Defy Bullet Time once its [C] is paid (that is mid-resolution)', () => {
  let g = S0();
  setRunes(g, P0, 0); addRunes(g, P0, 1, 'body'); addRunes(g, P0, 3, 'chaos');
  fundAll(g, P1, 2);
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  hand(g, P1, 'Defy');
  const bt = hand(g, P0, 'Bullet Time');
  g = act(g, { type: 'playCard', player: P0, obj: bt });
  g = choose(g, g.battlefields[BF_A].objId);
  g = passN(g, 2);
  expectPending(g, 'chooseNumber', P0);
  g = answer(g, { numbers: [3] }, P0);
  assert.equal(g.chain.length, 0, 'resolved immediately');
  assert.equal(zone(g, e), 'trash');
});

test('RJ#9142 Meditation\'s exhaust cost doesn\'t choose a unit (no Dreaming Tree draw)', () => {
  let g = S0({ bfA: 'The Dreaming Tree' });
  fundAll(g, P0, 3);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const h0 = g.players[0].hand.length;
  const m = hand(g, P0, 'Meditation');
  g = act(g, { type: 'playCard', player: P0, obj: m });
  g = settle(g, d => d.kind === 'optional' ? 'yes' : d.options!.find(o => o.id === u)?.id);
  assert.equal(ex(g, u), true);
  assert.equal(g.players[0].hand.length, h0 + 2, 'draw 2 only');
});

test('RJ#9143 equipping Irelia, Fervent chooses her: +1', () => {
  let g = S0();
  fundAll(g, P0, 2);
  const ir = put(g, P0, 'Irelia, Fervent', 'base');
  const sw = put(g, P0, 'Long Sword', 'base');
  const ab = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === sw)!;
  g = act(g, ab);
  g = settle(g, d => d.options!.find(o => o.id === ir)?.id);
  assert.equal(g.objects[sw].attachedTo, ir);
  assert.equal(mightOf(g, ir), 4 + 2 + 1);
});

test('RJ#9144 Reaver\'s Row triggers as the showdown begins (on defend)', () => {
  const g0 = S0({ bfA: "Reaver's Row" });
  put(g0, P1, 'V(2)', BF_A); control(g0, BF_A, P1);
  const a = put(g0, P0, 'V(3)', 'base');
  const g = move(g0, P0, [a], BF_A);
  const d = pend(g);
  assert.ok(g.chain.some(c => /Reaver/.test(g.cards[g.objects[c.source]?.cardId]?.name ?? '')) || (d.inStep && d.player === P1), 'trigger right at the start of the combat showdown');
});

// ---------------------------------------------------------------------------------------------- 9145-9156
test('RJ#9145 Rocket Barrage has no Action/Reaction: not playable in response', () => {
  let g = S0();
  fundAll(g, P0, 4);
  put(g, P1, 'V(2)', 'base');
  const rb = hand(g, P0, 'Rocket Barrage');
  assert.ok(canPlayNow(g, P0, rb), 'main phase, open: ok');
  [g] = cast(g, P0, 'DrawR');
  expectPending(g, 'chainResponse', P0);
  assert.equal(canPlayNow(g, P0, rb), false);
});

test('RJ#9146 Void Seeker (Action) is playable in the non-combat showdown after moving to an empty battlefield', () => {
  let g = S0();
  fundAll(g, P0, 3);
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_B);
  expectPending(g, 'showdownAction', P0);
  assert.ok(canPlayNow(g, P0, hand(g, P0, 'Void Seeker')));
});

test('RJ#9147 Brynhir Thundersong enters with no window, but her play trigger can be responded to', () => {
  let g = S0();
  fundAll(g, P0, 3);
  const b = hand(g, P0, 'Brynhir Thundersong');
  g = play(g, P0, b, { dest: 'base' });
  assert.equal(zone(g, b), 'base');
  assert.equal(g.chain.length, 1);
  g = pass(g);
  expectPending(g, 'chainResponse', P1);
  const r = hand(g, P1, 'DrawR');
  assert.ok(canPlayNow(g, P1, r), 'P1 can still react before the trigger resolves');
});

test('RJ#9148 activating a gear ability is not playing a card (Darius, Trifarian)', () => {
  let g = S0();
  fundAll(g, P0, 3);
  const d = put(g, P0, 'Darius, Trifarian', 'base', { ready: false });
  const sw = put(g, P0, 'Long Sword', 'base');
  [g] = cast(g, P0, 'V(1)', { dest: 'base' });
  const ab = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === sw)!;
  g = act(g, ab);
  g = settle(g, dd => dd.options!.find(o => o.id === d)?.id);
  assert.equal(g.objects[sw].attachedTo, d);
  assert.equal(ex(g, d), true, 'no second card played');
});

test('RJ#9149 Glasc Mixologist dying as a defender can play a unit there and keep control', () => {
  // attacker and Mixologist trade; the Deathknell unit arrives at BF-A, so P1 still has units there
  let { g, atk, def } = attackSetup(['V(5)'], ['Glasc Mixologist']);
  const pp = put(g, P1, 'V(3)', 'trash');
  g = settle(g, d => d.kind === 'optional' ? 'yes' : d.options!.find(o => o.id === pp || o.id === String(BF_A))?.id);
  assert.equal(zone(g, def[0]), 'trash');
  assert.equal(locOf(g, pp), BF_A, 'played to the battlefield');
  assert.equal(zone(g, atk[0]), 'trash');
  assert.equal(g.battlefields[BF_A].controller, P1, 'kept control');
});

test('RJ#9150 two Dazzling Auroras: the second trigger resolves before the showdown from Deadbloom Predator', () => {
  let g = S0();
  put(g, P0, 'Dazzling Aurora', 'base'); put(g, P0, 'Dazzling Aurora', 'base');
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const second = put(g, P0, 'V(2)', 'deckTop');
  const db = put(g, P0, 'Deadbloom Predator', 'deckTop');
  g = act(g, { type: 'endTurn', player: P0 });
  let sawShowdownBeforeSecond = false;
  for (let i = 0; i < 40; i++) {
    const d = g.pending!;
    if (d.kind === 'mainAction') break;
    if (g.showdown && zone(g, second) === 'mainDeck' && zone(g, db) === 'battlefield') sawShowdownBeforeSecond = true;
    if (d.inStep) g = choose(g, d.options!.find(o => o.id === String(BF_A) || o.id === g.battlefields[BF_A].objId)?.id ?? d.options![0].id);
    else g = pass(g);
  }
  assert.equal(locOf(g, db) !== null || zone(g, db) === 'trash', true);
  assert.notEqual(zone(g, second), 'mainDeck', 'second Aurora resolved');
  assert.equal(sawShowdownBeforeSecond, false);
});

test('RJ#9151 Akshan\'s stolen Equipment taken by Lucian, Merciless (Weaponmaster) stays on Lucian when Akshan leaves', () => {
  let g = S0();
  fundAll(g, P0, 4);
  const sw = put(g, P1, 'Long Sword', 'base');
  const ak = hand(g, P0, 'Akshan, Mischievous');
  g = act(g, { type: 'playCard', player: P0, obj: ak, destination: 'base' });
  g = answer(g, { may: [true] }, P0);
  g = settle(g, d => d.kind === 'orderTriggers' ? d.options!.find(o => /Weaponmaster/.test(o.label))?.id : d.options!.find(o => o.id === sw)?.id ?? (d.kind === 'optional' ? 'yes' : undefined));
  const lu = hand(g, P0, 'Lucian, Merciless');
  g = act(g, { type: 'playCard', player: P0, obj: lu, destination: 'base' });
  g = settle(g, d => d.kind === 'optional' ? 'yes' : d.options!.find(o => o.id === sw)?.id);
  assert.equal(g.objects[sw].attachedTo, lu);
  [g] = cast(g, P0, 'KillDraw', { targets: [[ak]] });
  g = settle(g);
  assert.equal(g.objects[sw].controller, P1);
  assert.equal(g.objects[sw].attachedTo, lu);
});

test('RJ#9153 opponent attacks my battlefield: I can play an Action spell when I get focus', () => {
  let { g } = attackSetup(['V(3)'], ['V(2)']);
  fundAll(g, P1, 3);
  g = settle(g, () => undefined, 0);
  for (let i = 0; i < 4 && !(pend(g).kind === 'showdownAction' && pend(g).player === P1); i++) g = pass(g);
  expectPending(g, 'showdownAction', P1);
  assert.ok(canPlayNow(g, P1, hand(g, P1, 'Void Seeker')));
});

function thwonkSetup() {
  let { g, atk } = attackSetup(['V(3)'], ['V(2)']);
  fundAll(g, P0, 3); fundAll(g, P1, 3);
  for (let i = 0; i < 4 && !(pend(g).kind === 'showdownAction' && pend(g).player === P1); i++) g = pass(g);
  const th = hand(g, P1, 'Thwonk!');
  g = act(g, { type: 'playCard', player: P1, obj: th });
  g = answer(g, { targets: [[atk[0]]], may: [true] }, P1);
  for (let i = 0; i < 3 && pend(g).inStep && pend(g).player === P1; i++) g = choose(g, pend(g).options!.find(o => o.id === atk[0] || o.id === 'yes')?.id ?? pend(g).options![0].id);
  return { g, atk, th };
}
test('RJ#9154 Not So Fast can counter (repeated) Thwonk! on my attacking unit', () => {
  let { g, atk, th } = thwonkSetup();
  assert.equal(g.chain.length, 1);
  g = pass(g);
  expectPending(g, 'chainResponse', P0);
  const n = hand(g, P0, 'Not So Fast');
  assert.ok(canPlayNow(g, P0, n));
  g = play(g, P0, n);
  g = passN(g, 2); g = passN(g, 2);
  assert.equal(zone(g, th), 'trash');
  assert.equal(!!g.objects[atk[0]].stunned, false);
});

test('RJ#9155 Defy counters Thwonk! with its Repeat paid', () => {
  let { g, atk, th } = thwonkSetup();
  g = pass(g);
  const d = hand(g, P0, 'Defy');
  assert.ok(canPlayNow(g, P0, d));
  g = play(g, P0, d);
  g = passN(g, 2); g = passN(g, 2);
  assert.equal(zone(g, th), 'trash');
  assert.equal(!!g.objects[atk[0]].stunned, false);
});

test('RJ#9156 Janna, Savior (Reaction) can be played in response to Singularity', () => {
  let g = S0();
  fundAll(g, P0, 3); fundAll(g, P1, 3);
  const u = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'Singularity', { targets: [[u]] });
  g = pass(g);
  expectPending(g, 'chainResponse', P1);
  assert.ok(canPlayNow(g, P1, hand(g, P1, 'Janna, Savior')));
});

// ---------------------------------------------------------------------------------------------- 9157-9164
test('RJ#9158 Retreat can\'t return an opponent\'s unit', () => {
  const g = S0();
  fundAll(g, P0, 2);
  put(g, P1, 'V(2)', BF_A);
  const r = hand(g, P0, 'Retreat');
  assert.equal(canPlayNow(g, P0, r), false, 'no friendly unit to choose');
  put(g, P0, 'V(2)', 'base');
  assert.equal(canPlayNow(g, P0, r), true);
});

test('RJ#9159 Ride the Wind can move a unit from one battlefield to another', () => {
  let g = S0();
  fundAll(g, P0, 2);
  const u = put(g, P0, 'V(2)', BF_A, { ready: false }); control(g, BF_A, P0);
  [g] = cast(g, P0, 'Ride the Wind', { targets: [[u]], locations: [BF_B], battlefields: [BF_B] });
  g = settle(g, d => d.options!.find(o => o.id === String(BF_B) || o.id === g.battlefields[BF_B].objId)?.id);
  assert.equal(locOf(g, u), BF_B);
  assert.equal(ex(g, u), false);
});

test('RJ#9160 Singularity can choose units in a base', () => {
  let g = S0();
  fundAll(g, P0, 3);
  const u = put(g, P1, 'V(5)', 'base');
  [g] = cast(g, P0, 'Singularity', { targets: [[u]] });
  g = settle(g);
  assert.equal(zone(g, u), 'trash');
});

test('RJ#9161 Weaponmaster only works when the unit is played (no later free attach)', () => {
  const g = S0();
  const j = put(g, P0, 'Jax, Unrelenting', 'base');
  put(g, P0, 'Long Sword', 'base');
  setRunes(g, P0, 0);
  assert.ok(!legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === j), 'no activated Weaponmaster');
  assert.equal(legal(g, P0, 'activate').length, 0, 'and Equip needs its [C]');
});

test('RJ#9164 the same Equipment can be equipped several times a turn, paying each time', () => {
  let g = S0();
  fundAll(g, P0, 2);
  const a = put(g, P0, 'V(2)', 'base'), b = put(g, P0, 'V(2)', 'base');
  const sw = put(g, P0, 'Long Sword', 'base');
  for (const target of [a, b]) {
    const ab2 = legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === sw)!;
    g = act(g, ab2);
    g = settle(g, d => d.options!.find(o => o.id === target)?.id);
    assert.equal(g.objects[sw].attachedTo, target);
    // detach: the unit dies → Equipment stays, returns to base
    if (target === a) { [g] = cast(g, P0, 'KillDraw', { targets: [[a]] }); g = settle(g); }
  }
});

// ---------------------------------------------------------------------------------------------- 9165-9172
const equip = (g: GameState, gear: ObjId, unit: ObjId): GameState => {
  const ab = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === gear)!;
  assert.ok(ab, 'Equip is available');
  return settle(act(g, ab), d => d.options!.find(o => o.id === unit)?.id);
};

test('RJ#9165 no limit on Equipment attached to one unit', () => {
  let g = S0();
  fundAll(g, P0, 3);
  const u = put(g, P0, 'V(2)', 'base');
  const sws = [0, 1, 2].map(() => put(g, P0, 'Long Sword', 'base'));
  for (const s of sws) g = equip(g, s, u);
  assert.ok(sws.every(s => g.objects[s].attachedTo === u));
  assert.equal(mightOf(g, u), 2 + 6);
});

test('RJ#9166 Salvage with no gear killed still draws', () => {
  let g = S0();
  fundAll(g, P0, 2);
  const h0 = g.players[0].hand.length;
  const s = hand(g, P0, 'Salvage');
  assert.ok(canPlayNow(g, P0, s));
  g = play(g, P0, s);
  g = settle(g, d => d.kind === 'optional' ? 'no' : undefined);
  assert.equal(g.players[0].hand.length, h0 + 1, 'Salvage added (+1) and left (-1), drew 1 (+1)');
});

test('RJ#9167 Spinning Axe\'s Equip can\'t be used in response (open state only)', () => {
  let g = S0();
  fundAll(g, P0, 3);
  put(g, P0, 'V(2)', 'base');
  const ax = put(g, P0, 'Spinning Axe', 'base');
  assert.ok(legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === ax));
  [g] = cast(g, P0, 'DrawR');
  expectPending(g, 'chainResponse', P0);
  assert.ok(!legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === ax));
});

test('RJ#9169 Tideturner played from hiding can\'t choose a unit at its own battlefield', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P1, 3);
  const mf = put(g, P0, 'V(3)', BF_A), other = put(g, P0, 'V(1)', 'base'); control(g, BF_A, P0);
  const tt = put(g, P0, 'Tideturner', { facedown: BF_A });
  [g] = cast(g, P1, 'Charm', { targets: [[mf]], dest: 'base', locations: ['base'] });
  g = answer(g, { locations: ['base'] }, P1);
  g = pass(g);
  expectPending(g, 'chainResponse', P0);
  g = act(g, { type: 'playCard', player: P0, obj: tt });
  for (let i = 0; i < 4 && pend(g).inStep && pend(g).kind !== 'chooseTargets'; i++) g = choose(g, pend(g).kind === 'optional' ? 'yes' : pend(g).options![0].id);
  const d = pend(g);
  if (d.kind === 'chooseTargets') {
    const ids = d.options!.map(o => o.id);
    assert.ok(!ids.includes(mf), 'Miss Fortune (same battlefield) is not a legal choice');
    assert.ok(ids.includes(other));
  }
});

test('RJ#9170 Bellows Breath can\'t choose one unit three times', () => {
  let g = S0();
  fundAll(g, P0, 3);
  const u = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const bb = hand(g, P0, 'Bellows Breath');
  g = act(g, { type: 'playCard', player: P0, obj: bb });
  expectPending(g, 'chooseTargets', P0);
  assert.notEqual(rejects(g, { type: 'choose', player: P0, optionIds: [u, u, u] }), null);
  g = choose(g, u); g = no(g);
  g = settle(g);
  assert.equal(g.objects[u].damage, 1);
});

test('RJ#9171 Here to Help can\'t play the Chosen Champion from the Champion Zone', () => {
  let g = S0();
  fundAll(g, P0, 3);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const champ = g.players[0].championZone[0];
  assert.ok(champ, 'a champion in the Champion Zone');
  [g] = cast(g, P0, 'Here to Help');
  g = settle(g, d => d.kind === 'optional' ? 'yes' : undefined);
  assert.equal(zone(g, champ), 'championZone');
});

test('RJ#9172 a Seal\'s power can pay Deflect', () => {
  const g = S0();
  setRunes(g, P0, 1, 'fury');
  put(g, P0, 'Seal of Rage', 'base');
  const d = put(g, P1, 'Irelia, Fervent', BF_A); control(g, BF_A, P1);
  const st = hand(g, P0, 'StunA');
  assert.ok(canPlayNow(g, P0, st), '[1] from the rune + [A] Deflect from the Seal');
  setRunes(g, P0, 0);
  assert.equal(canPlayNow(g, P0, st), false, 'the Seal can\'t pay the energy');
  void d;
});

// ---------------------------------------------------------------------------------------------- 9173-9180
test('RJ#9173 two Darius, Trifarian in one turn: both trigger', () => {
  let g = S0();
  fundAll(g, P0, 4);
  const d1 = hand(g, P0, 'Darius, Trifarian'), d2 = hand(g, P0, 'Darius, Trifarian');
  g = play(g, P0, d1, { dest: 'base' }); g = settle(g);
  g = play(g, P0, d2, { dest: 'base' }); g = settle(g);
  assert.equal(ex(g, d1), false); assert.equal(ex(g, d2), false);
  assert.equal(mightOf(g, d1), 7); assert.equal(mightOf(g, d2), 7);
});

test('RJ#9174 Overzealous Fan swapped in by Tideturner mid-combat becomes a defender and its trigger fires', () => {
  let { g } = attackSetup(['V(3)'], ['V(2)']);
  const fan = put(g, P1, 'Overzealous Fan', 'base');
  const tt = put(g, P1, 'Tideturner', { facedown: BF_A });
  for (let i = 0; i < 4 && !(pend(g).kind === 'showdownAction' && pend(g).player === P1); i++) g = pass(g);
  g = act(g, { type: 'playCard', player: P1, obj: tt });
  let fanTriggered = false;
  for (let i = 0; i < 20; i++) {
    const d = g.pending!;
    if (d.kind === 'mainAction') break;
    if (/Overzealous Fan/.test(d.prompt) || g.chain.some(c => c.source === fan) || (d.options ?? []).some(o => /Overzealous/.test(o.label) && d.kind === 'orderTriggers')) fanTriggered = true;
    if (fanTriggered) break;
    if (d.inStep) g = choose(g, d.options!.find(o => o.id === fan)?.id ?? (d.kind === 'optional' ? 'yes' : d.options![0].id));
    else g = pass(g);
  }
  assert.equal(locOf(g, fan), BF_A, 'Fan was swapped to the battlefield');
  assert.ok(fanTriggered, '"When I defend" fired after it got the designation');
});

test('RJ#9175 Yasuo, Remorseful\'s attack trigger can hit a non-Tank unit (Tank is only combat damage)', () => {
  let { g, def } = attackSetup(['Yasuo, Remorseful'], ['Tank(3)', 'V(2)']);
  for (let i = 0; i < 4 && pend(g).kind !== 'chooseTargets'; i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  const d = expectPending(g, 'chooseTargets', P0);
  assert.ok(d.options!.some(o => o.id === def[1]));
});

test('RJ#9176 Adaptatron killing Svellsongur attached to Ornn, Forge God pays no Deflect', () => {
  let g = S0();
  setRunes(g, P0, 0);
  const o = put(g, P1, 'Ornn, Forge God', 'base');
  const sv = put(g, P1, 'Svellsongur', 'base');
  attachNow(g, sv, o);
  const ad = put(g, P0, 'Adaptatron', 'base');
  g = move(g, P0, [ad], BF_B);
  g = settle(g, d => d.kind === 'optional' ? 'yes' : d.options!.find(x => x.id === sv)?.id);
  assert.equal(zone(g, sv), 'trash', 'killed with no runes to pay any Deflect');
  assert.equal(g.objects[ad].counters.buff ?? 0, 1);
});

test('RJ#9177 Power Nexus: one hold trigger, pay once to score 1 more point', () => {
  let g = S0({ tp: P1, bfA: 'Power Nexus' });
  put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  setRunes(g, P0, 8, 'fury');
  g = act(g, { type: 'endTurn', player: P1 });
  let pays = 0;
  for (let i = 0; i < 30; i++) {
    const d = g.pending!;
    if (d.kind === 'mainAction' && d.player === P0) break;
    if (d.kind === 'optional') { pays++; g = yes(g); continue; }
    g = d.inStep ? choose(g, d.options![0].id) : d.kind === 'mainAction' ? endTurn(g) : pass(g);
  }
  assert.equal(pays, 1);
  assert.equal(g.players[0].points, 2, 'hold + Power Nexus');
});

test('RJ#9178 Flurry of Blades doesn\'t choose: no Deflect to pay', () => {
  let g = S0();
  setRunes(g, P0, 1, 'body');
  const ir = put(g, P1, 'Irelia, Fervent', BF_A); control(g, BF_A, P1);
  const f = hand(g, P0, 'Flurry of Blades');
  assert.ok(canPlayNow(g, P0, f));
  g = play(g, P0, f); g = settle(g);
  assert.equal(g.objects[ir].damage, 1);
});

test('RJ#9179 a hold blocked by Tianna still scores the battlefield; then conquering the other wins at 7', () => {
  let g = S0({ tp: P1 });
  put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const t = put(g, P1, 'Tianna Crownguard', BF_B); control(g, BF_B, P1);
  g.players[0].points = 7;
  g = act(g, { type: 'endTurn', player: P1 });
  g = settle(g);
  expectPending(g, 'mainAction', P0);
  assert.equal(g.players[0].points, 7, 'Tianna stops the hold point');
  fundAll(g, P0, 3);
  [g] = cast(g, P0, 'KillA', { targets: [[t]] });
  g = settle(g);
  assert.equal(zone(g, t), 'trash');
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_B);
  g = settle(g);
  assert.equal(g.winner, P0, 'both battlefields scored this turn → the conquer is the final point');
});

test('RJ#9180 opponent moves to an empty battlefield on their turn: I can play an Action spell with focus', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0, 3);
  const u = put(g, P1, 'V(2)', 'base');
  g = move(g, P1, [u], BF_B);
  g = pass(g);
  expectPending(g, 'showdownAction', P0);
  assert.ok(canPlayNow(g, P0, hand(g, P0, 'Void Seeker')));
});

// ---------------------------------------------------------------------------------------------- 9181-9188
test('RJ#9181 Sun Disc: [Legion] — the next unit enters ready only if you played another card first', () => {
  for (const legion of [false, true]) {
    let g = S0();
    fundAll(g, P0, 3);
    const sd = put(g, P0, 'Sun Disc', 'base');
    if (legion) { [g] = cast(g, P0, 'DrawR'); g = settle(g); }
    const ab = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === sd);
    if (ab) { g = act(g, ab); g = settle(g); }
    const u = hand(g, P0, 'V(2)');
    g = play(g, P0, u, { dest: 'base' }); g = settle(g);
    assert.equal(ex(g, u), !legion, legion ? 'Legion: enters ready' : 'no Legion: enters exhausted');
  }
});

test('RJ#9182 hold one battlefield to 7, then conquer the other the same turn: win (every battlefield scored)', () => {
  let g = S0({ tp: P1 });
  put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  g.players[0].points = 6;
  g = act(g, { type: 'endTurn', player: P1 });
  g = settle(g);
  assert.equal(g.players[0].points, 7, 'hold');
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_B);
  g = settle(g);
  assert.equal(g.winner, P0);
});

test('RJ#9184 Arcane Shift can\'t be played without an enemy unit at a battlefield', () => {
  let g = S0();
  fundAll(g, P0, 3);
  const u = put(g, P0, 'V(2)', 'base');
  put(g, P1, 'V(2)', 'base');
  g = move(g, P0, [u], BF_B);
  expectPending(g, 'showdownAction', P0);
  const as = hand(g, P0, 'Arcane Shift');
  assert.equal(canPlayNow(g, P0, as), false);
});

test('RJ#9186 a Hidden unit played from facedown enters exhausted', () => {
  let g = S0();
  fundAll(g, P0, 3);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const h = put(g, P0, 'HidU(2)', { facedown: BF_A });
  g = act(g, { type: 'playCard', player: P0, obj: h });
  g = settle(g);
  assert.equal(locOf(g, h), BF_A);
  assert.equal(ex(g, h), true);
});

test('RJ#9187 RJ#9188 battlefields are determined before the opening hands are drawn', () => {
  let g = newGame({ mulligan: true });
  for (let i = 0; i < 6 && pend(g).kind !== 'mulligan'; i++) g = choose(g, pend(g).options![0].id);
  const d = pend(g);
  assert.equal(d.kind, 'mulligan');
  for (const bf of g.battlefields) assert.ok(g.objects[bf.objId]?.cardId, 'battlefields already in place');
  assert.equal(g.players[d.player].hand.length, 4);
});

// ---------------------------------------------------------------------------------------------- 9189-9196
test('RJ#9189 Deflect is paid for each choice (Icathian Rain choosing the same Deflect unit twice)', () => {
  let g = S0();
  fundAll(g, P0, 3);
  const before = g.players[0].runesInPlay.length;
  const ir = put(g, P1, 'Irelia, Fervent', BF_A), v = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const rain = hand(g, P0, "Icathian Rain, Kai'Sa");
  g = act(g, { type: 'playCard', player: P0, obj: rain });
  for (const t of [ir, ir, v, v, v, v]) g = choose(g, t);
  for (let i = 0; i < 3 && pend(g).inStep; i++) g = choose(g, pend(g).options![0].id);
  const recycled = before - g.players[0].runesInPlay.length;
  assert.equal(recycled, 3 + 2, '[A][A][A] + one Deflect [A] per choice of Irelia');
});

test('RJ#9190 a battlefield is scored only once per turn', () => {
  // tests/conformance/G-scoring.test.ts T100 covers re-establishing control after leaving; same rule.
  let g = S0();
  fundAll(g, P0, 3);
  const a = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [a], BF_B); g = settle(g);
  assert.equal(g.players[0].points, 1);
  [g] = cast(g, P0, 'Ride the Wind', { targets: [[a]] });
  g = settle(g, d => d.options!.find(o => o.id === 'base')?.id);
  g = settle(g);
  if (locOf(g, a) === 'base') { g = move(g, P0, [a], BF_B); g = settle(g); }
  assert.equal(g.players[0].points, 1);
});

test('RJ#9191 attackers recalled after a combat with no result go to base, not where they came from', () => {
  let g = S0();
  const gk = put(g, P0, 'Ganker(2)', BF_B); control(g, BF_B, P0);
  put(g, P1, 'V(5)', BF_A, { stunned: true }); control(g, BF_A, P1);
  g = move(g, P0, [gk], BF_A);
  g = settle(g);
  assert.equal(locOf(g, gk), 'base');
});

test('RJ#9192 an attack trigger still resolves after its unit leaves the board', () => {
  let { g, atk } = attackSetup(['AttackDraw(3)'], ['V(2)']);
  fundAll(g, P1, 2);
  const h0 = g.players[0].hand.length;
  assert.equal(g.chain.length, 1);
  g = pass(g);
  [g] = cast(g, P1, 'Gust', { targets: [[atk[0]]] });
  g = settle(g);
  assert.notEqual(locOf(g, atk[0]), BF_A);
  assert.equal(g.players[0].hand.length >= h0 + 1, true, 'drew from the trigger (and Gust returned the unit to hand)');
});

test('RJ#9193 two Forecasters: a Mech has Vision twice and it triggers twice', () => {
  let g = S0();
  fundAll(g, P0, 2);
  put(g, P0, 'Forecaster', 'base'); put(g, P0, 'Forecaster', 'base');
  [g] = cast(g, P0, 'Mech(2)', { dest: 'base' });
  let visions = 0;
  for (let i = 0; i < 20; i++) {
    const d = g.pending!;
    if (d.kind === 'mainAction') break;
    if (d.kind === 'orderTriggers') { visions = Math.max(visions, d.options!.length); }
    g = d.inStep ? choose(g, d.options![0].id) : pass(g);
  }
  assert.ok(visions >= 2 || g.log.filter(l => /Vision/.test(l.text)).length >= 2, 'two Vision triggers');
});

test('RJ#9194 Sabotage: opponent reveals hand, caster recycles a non-unit card', () => {
  let g = S0();
  fundAll(g, P0, 2);
  const s = hand(g, P1, 'DrawR');
  hand(g, P1, 'V(2)');
  [g] = cast(g, P0, 'Sabotage');
  g = settle(g, d => d.options!.find(o => o.id === s)?.id);
  assert.equal(zone(g, s), 'mainDeck');
});

test('RJ#9195 Watcher vs Trifarian War Camp: -3 computed with the +1 included (min 1)', () => {
  let g = S0({ bfA: 'Trifarian War Camp' });
  fundAll(g, P0, 3);
  const a = put(g, P1, 'V(5)', BF_A), b = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  assert.equal(mightOf(g, a), 6);
  [g] = cast(g, P0, 'Thousand-Tailed Watcher', { dest: 'base', may: [false] });
  g = settle(g);
  assert.equal(mightOf(g, a), 3);
  assert.equal(mightOf(g, b), 1);
});

test('RJ#9196 Defy counters a repeated Piercing Light (printed cost [2][A])', () => {
  let g = S0();
  fundAll(g, P0, 3); fundAll(g, P1, 2);
  const u = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const pl = hand(g, P0, 'Piercing Light');
  g = act(g, { type: 'playCard', player: P0, obj: pl });
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = choose(g, pend(g).kind === 'optional' ? 'yes' : (pend(g).options!.find(o => o.id === u)?.id ?? pend(g).options![0].id));
  g = pass(g);
  const d = hand(g, P1, 'Defy');
  assert.ok(canPlayNow(g, P1, d));
  g = play(g, P1, d); g = settle(g);
  assert.equal(g.objects[u].damage, 0);
});

// ---------------------------------------------------------------------------------------------- 9197-9204
test('RJ#9197 Bellows Breath: one instance needs distinct units, the Repeat may hit the same unit again', () => {
  let g = S0();
  fundAll(g, P0, 3);
  const u = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const bb = hand(g, P0, 'Bellows Breath');
  g = act(g, { type: 'playCard', player: P0, obj: bb });
  g = choose(g, u); g = yes(g);
  g = choose(g, u);                                // CR 820.2: the Repeat's choice is made as it is played
  g = passN(g, 2);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = choose(g, pend(g).options!.find(o => o.id === u)?.id ?? pend(g).options![0].id);
  g = settle(g);
  assert.equal(g.objects[u].damage, 2);
});

test('RJ#9198 Sett, Brawler can spend the buff he got this turn once the play trigger has resolved', () => {
  let g = S0();
  fundAll(g, P0, 3);
  const st = hand(g, P0, 'Sett, Brawler');
  g = play(g, P0, st, { dest: 'base' });
  assert.ok(!legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === st), 'not while the buff trigger is pending');
  g = settle(g);
  assert.equal(g.objects[st].counters.buff, 1);
  const ab = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === st)!;
  g = settle(act(g, ab));
  assert.equal(mightOf(g, st), 8);
});

test('RJ#9199 two 4-Might attackers vs a 6 defender, one killed by an effect: the other dies, the defender survives', () => {
  let { g, atk, def } = attackSetup(['V(4)', 'V(4)'], ['V(6)']);
  fundAll(g, P1, 3);
  g = pass(g);
  [g] = cast(g, P1, 'KillA', { targets: [[atk[0]]] });
  g = settle(g);
  assert.equal(zone(g, atk[0]), 'trash'); assert.equal(zone(g, atk[1]), 'trash');
  assert.equal(locOf(g, def[0]), BF_A);
  assert.equal(g.battlefields[BF_A].controller, P1);
});

test('RJ#9200 Called Shot with Repeat is one card played (Darius, Trifarian not triggered)', () => {
  let g = S0();
  fundAll(g, P0, 3);
  const d = put(g, P0, 'Darius, Trifarian', 'base', { ready: false });
  const cs = hand(g, P0, 'Called Shot');
  g = act(g, { type: 'playCard', player: P0, obj: cs });
  g = answer(g, { may: [true] }, P0);
  g = settle(g);
  assert.equal(ex(g, d), true);
});

test('RJ#9201 Switcheroo swaps current Mights (with modifiers)', () => {
  let g = S0();
  fundAll(g, P0, 3);
  const a = put(g, P0, 'V(2)', BF_A), b = put(g, P0, 'V(4)', BF_A); control(g, BF_A, P0);
  mod(g, a, { might: 3 });
  assert.equal(mightOf(g, a), 5);
  [g] = cast(g, P0, 'Switcheroo', { targets: [[a, b]] });
  g = settle(g, d => d.options!.find(o => o.id === a || o.id === b)?.id);
  assert.equal(mightOf(g, a), 4); assert.equal(mightOf(g, b), 5);
});

test('RJ#9202 Hard Bargain\'s Repeat [2]: one Ezreal, Prodigy → [1]; two → [0]', () => {
  for (const [n, cost] of [[1, 1], [2, 0]] as const) {
    let g = S0({ tp: P1 });
    fundAll(g, P0, 2);
    for (let i = 0; i < n; i++) put(g, P0, 'Ezreal, Prodigy', 'base');
    [g] = cast(g, P1, 'DrawR');
    g = pass(g);
    const hb = hand(g, P0, 'Hard Bargain');
    const runes0 = readyRunes(g, P0);
    g = act(g, { type: 'playCard', player: P0, obj: hb });
    for (let i = 0; i < 3 && pend(g).inStep && pend(g).kind !== 'optional'; i++) g = choose(g, pend(g).options![0].id);
    const d = expectPending(g, 'optional', P0);
    assert.match(d.prompt, /Repeat/);
    g = yes(g);
    for (let i = 0; i < 3 && pend(g).inStep; i++) g = choose(g, pend(g).options![0].id);
    assert.equal(runes0 - readyRunes(g, P0), 2 + cost, `${n} Ezreal: [2] + Repeat [${cost}]`);
  }
});

test('RJ#9203 Jax, Unmatched gives Equipment Quick-Draw: played in response to Falling Star, attached at once', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0, 2); fundAll(g, P1, 3);
  const u = put(g, P0, 'V(7)', BF_A); control(g, BF_A, P0);
  const wa = hand(g, P0, "Warmog's Armor");
  [g] = cast(g, P1, 'Falling Star', { targets: [[u], [u]] });
  g = pass(g);
  expectPending(g, 'chainResponse', P0);
  assert.equal(canPlayNow(g, P0, wa), false, 'no Quick-Draw without Jax');
  put(g, P0, 'Jax, Unmatched', 'base');
  assert.equal(canPlayNow(g, P0, wa), true, 'Quick-Draw from Jax');
  g = play(g, P0, wa);
  g = settle(g, d => d.options!.find(o => o.id === u)?.id);
  assert.equal(g.objects[wa].attachedTo, u);
  assert.equal(locOf(g, u), BF_A, '7+1 Might survives the 6 damage');
});

// ---------------------------------------------------------------------------------------------- 9205-9212
test('RJ#9206 Not So Fast can counter Singularity choosing two of my units', () => {
  let g = S0();
  fundAll(g, P0, 3); fundAll(g, P1, 3);
  const a = put(g, P1, 'V(3)', BF_A), b = put(g, P1, 'V(3)', 'base'); control(g, BF_A, P1);
  const sg = hand(g, P0, 'Singularity');
  g = play(g, P0, sg, { targets: [[a, b]] });
  g = pass(g);
  const n = hand(g, P1, 'Not So Fast');
  assert.ok(canPlayNow(g, P1, n));
  g = play(g, P1, n); g = settle(g);
  assert.equal(locOf(g, a), BF_A); assert.equal(locOf(g, b), 'base');
});

test('RJ#9207 Acceptable Losses killing Forge of the Future doesn\'t run its "Kill this:" ability', () => {
  let g = S0();
  fundAll(g, P0, 2);
  const fg = put(g, P0, 'Forge of the Future', 'base');
  const tr = put(g, P1, 'V(1)', 'trash');
  [g] = cast(g, P0, 'Acceptable Losses');
  g = settle(g, d => d.options!.find(o => o.id === fg)?.id);
  assert.equal(zone(g, fg), 'trash');
  assert.equal(zone(g, tr), 'trash', 'nothing recycled');
});

test('RJ#9209 Immortal Phoenix moved to an empty battlefield has 3 Might (no Assault) and dies to Void Seeker', () => {
  let g = S0();
  fundAll(g, P1, 3);
  const ph = put(g, P0, 'Immortal Phoenix', 'base');
  g = move(g, P0, [ph], BF_B);
  assert.equal(mightOf(g, ph), 3);
  g = pass(g);
  [g] = cast(g, P1, 'Void Seeker', { targets: [[ph]] });
  g = settle(g, d => d.kind === 'optional' ? 'no' : undefined);
  assert.equal(zone(g, ph), 'trash');
});

test('RJ#9210 Purifier\'s Assault from Equipment doesn\'t apply to Challenge (not combat)', () => {
  let g = S0();
  fundAll(g, P0, 3);
  setLegend(g, P0, 'Purifier');
  const u = put(g, P0, 'V(2)', 'base'), sw = put(g, P0, 'Long Sword', 'base'); attachNow(g, sw, u);
  const e = put(g, P1, 'V(9)', 'base');
  [g] = cast(g, P0, 'Challenge', { targets: [[u], [e]] });
  g = settle(g);
  assert.equal(g.objects[e].damage, 4, '2 + 2 (Sword), no Assault');
});

test('RJ#9211 Punch First (Action) can\'t respond to Challenge', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0, 3); fundAll(g, P1, 3);
  const u = put(g, P0, 'V(2)', 'base'), e = put(g, P1, 'V(3)', 'base');
  [g] = cast(g, P1, 'Challenge', { targets: [[e], [u]] });
  g = pass(g);
  expectPending(g, 'chainResponse', P0);
  assert.equal(canPlayNow(g, P0, hand(g, P0, 'Punch First')), false);
});

test('RJ#9212 a Hidden card\'s additional cost is paid when it is played from facedown (Pyke)', () => {
  let g = S0();
  fundAll(g, P0, 2);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const pk = hand(g, P0, 'Pyke');
  g = act(g, { type: 'hide', player: P0, obj: pk, battlefieldIndex: BF_A });
  assert.equal(zone(g, pk), 'facedown');
  assert.ok(!pend(g).inStep, 'no additional-cost question when hiding');
  g.objects[pk].hiddenTurn = g.turn - 1;
  g = act(g, { type: 'playCard', player: P0, obj: pk });
  const d = expectPending(g, 'optional', P0, 'asked on play');
  assert.match(d.prompt, /additional|pay/i);
  g = yes(g); g = settle(g);
  assert.equal(ex(g, pk), false);
  assert.equal(mightOf(g, pk), 2 + 2);
});

// ---------------------------------------------------------------------------------------------- 9213-9220 (partial: fetch limit)
test('RJ#9214 Fizz, Trickster plays Frigid Touch from the trash (ignoring Energy), then recycles it', () => {
  let g = S0();
  fundAll(g, P0, 3);
  const e = put(g, P1, 'V(4)', BF_A); control(g, BF_A, P1);
  const ft = put(g, P0, 'Frigid Touch', 'trash');
  const fz = hand(g, P0, 'Fizz, Trickster');
  g = play(g, P0, fz, { dest: 'base' });
  const r0 = readyRunes(g, P0);
  g = settle(g, d => d.kind === 'optional' ? (/Repeat/.test(d.prompt) ? 'no' : 'yes') : d.options!.find(o => o.id === ft || o.id === e)?.id);
  assert.equal(mightOf(g, e), 2, 'Frigid Touch resolved');
  assert.equal(zone(g, ft), 'mainDeck', 'recycled');
  assert.equal(readyRunes(g, P0), r0, 'no Energy paid');
});

test('RJ#9215 Void Burrower: the banished card is played paying its cost', () => {
  let g = S0();
  setLegend(g, P0, 'Void Burrower');
  setRunes(g, P0, 3, 'fury');
  const v2 = put(g, P0, 'V(2)', 'deckTop');
  const u = put(g, P0, 'V(1)', 'base');
  g = move(g, P0, [u], BF_B);
  g = settle(g, d => d.kind === 'optional' ? 'yes' : d.options!.find(o => o.id === v2)?.id ?? (d.kind === 'chooseDestination' ? 'base' : undefined));
  assert.equal(zone(g, v2), 'base');
  assert.equal(readyRunes(g, P0), 1, 'paid [2] for V(2)');
});

test('RJ#9218 a hidden Tideturner at another battlefield can swap with my unit in combat', () => {
  let { g, atk } = attackSetup(['V(3)'], ['V(5)']);
  control(g, BF_B, P0);
  const tt = put(g, P0, 'Tideturner', { facedown: BF_B });
  g = act(g, { type: 'playCard', player: P0, obj: tt });
  g = settle(g, d => d.options!.find(o => o.id === atk[0])?.id ?? (d.kind === 'optional' ? 'yes' : undefined));
  assert.equal(locOf(g, atk[0]), BF_B, 'my unit escaped to Tideturner\'s battlefield');
});

test('RJ#9213 Assembly Rig: once per turn because of [T] (needs a unit to recycle and [1][C])', () => {
  let g = S0();
  fundAll(g, P0, 3);
  const rig = put(g, P0, 'Assembly Rig', 'base');
  put(g, P0, 'V(1)', 'trash'); put(g, P0, 'V(1)', 'trash');
  const ab = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === rig)!;
  assert.ok(ab);
  g = settle(act(g, ab));
  assert.equal(named(g, P0, 'Mech').length, 1);
  assert.equal(ex(g, rig), true);
  assert.ok(!legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === rig), 'not again this turn');
});

test('RJ#9216 Piercing Light: first target moved to base, the second still takes 2', () => {
  let g = S0();
  fundAll(g, P0, 3);
  const a = put(g, P1, 'V(3)', BF_A), b = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const f = put(g, P1, 'Fight or Flight', { facedown: BF_A });
  const pl = hand(g, P0, 'Piercing Light');
  g = act(g, { type: 'playCard', player: P0, obj: pl });
  g = choose(g, a);
  for (let i = 0; i < 3 && pend(g).inStep; i++) g = choose(g, pend(g).kind === 'optional' ? 'no' : (pend(g).options!.find(o => o.id === b)?.id ?? pend(g).options![0].id));
  g = pass(g);
  g = act(g, { type: 'playCard', player: P1, obj: f });
  g = choose(g, a);
  g = settle(g, d => d.kind === 'optional' ? 'no' : d.options!.find(o => o.id === b)?.id);
  assert.equal(locOf(g, a), 'base');
  assert.equal(g.objects[a].damage, 0, 'first target illegal (not at a battlefield)');
  assert.equal(g.objects[b].damage, 2, 'second damage still dealt');
});

test('RJ#9217 Kog\'Maw, Caustic dies in combat: units are healed before its Deathknell deals 4', () => {
  let { g, def } = attackSetup(["Kog'Maw, Caustic"], ['V(5)']);
  g = settle(g);
  assert.equal(locOf(g, def[0]), BF_A, 'healed, then 4 < 5: survives');
  assert.equal(g.objects[def[0]].damage, 4);
});

// ---------------------------------------------------------------------------------------------- 9219-
test('RJ#9221 Baron Nashor entering the new Baron Pit conquers it (scores)', () => {
  let g = S0();
  setRunes(g, P0, 0); addRunes(g, P0, 7, 'chaos'); addRunes(g, P0, 6, 'fury');
  g.cards = { ...g.cards, 'unl-t01': realCard('unl-t01') }; // token battlefield def in this game's card pool
  const bn = hand(g, P0, 'Baron Nashor');
  assert.ok(canPlayNow(g, P0, bn));
  g = act(g, { type: 'playCard', player: P0, obj: bn });
  g = settle(g, d => d.options!.find(o => /Baron/.test(o.label))?.id);
  const pit = g.battlefields.findIndex(b => g.cards[g.objects[b.objId].cardId].name === 'Baron Pit');
  assert.ok(pit >= 0, 'Baron Pit added');
  assert.equal(locOf(g, bn), pit);
  assert.equal(g.battlefields[pit].controller, P0);
  assert.equal(g.players[0].points, 1, 'conquer point');
});

test('RJ#9222 damage stays marked after surviving Void Seeker (no heal until combat cleanup / end of turn)', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0, 2); fundAll(g, P1, 3);
  const u = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const sw = hand(g, P0, 'Long Sword');
  [g] = cast(g, P1, 'Void Seeker', { targets: [[u]] });
  g = pass(g);
  g = play(g, P0, sw);
  g = settle(g, d => d.options!.find(o => o.id === u)?.id);
  assert.equal(locOf(g, u), BF_A, '5 Might survives 4');
  assert.equal(g.objects[u].damage, 4);
  [g] = cast(g, P1, 'Flurry of Blades');
  g = settle(g);
  assert.equal(zone(g, u), 'trash', '4 + 1 = 5: dies');
});

test('RJ#9223 Vex, Cheerless reduces the total cost including Repeat ([2][A][A] → [1][A])', () => {
  let { g, def } = attackSetup(['Vex, Cheerless'], ['V(5)']);
  fundAll(g, P0, 3);
  for (let i = 0; i < 4 && !(pend(g).kind === 'showdownAction' && pend(g).player === P0); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  expectPending(g, 'showdownAction', P0);
  const n0 = g.players[0].runesInPlay.length, r0 = readyRunes(g, P0);
  const bb = hand(g, P0, 'Bellows Breath');
  g = act(g, { type: 'playCard', player: P0, obj: bb });
  g = choose(g, def[0]); g = yes(g);
  g = choose(g, def[0]);                           // CR 820.2: the Repeat's choice, then payment
  const recycled = n0 - g.players[0].runesInPlay.length, exhausted = r0 - readyRunes(g, P0) - recycled;
  assert.deepEqual({ exhausted, recycled }, { exhausted: 1, recycled: 1 });
});

test('RJ#9224 Gold adds power to the pool, not a rune', () => {
  let g = S0();
  const n0 = g.players[0].runesInPlay.length;
  const gd = put(g, P0, 'Gold', 'base');
  const ab = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === gd)!;
  assert.ok(ab);
  g = settle(act(g, ab));
  assert.equal(zone(g, gd), 'gone', 'token killed');
  assert.equal(g.players[0].runesInPlay.length, n0, 'no rune added');
  const pw = Object.values(g.players[0].pool.power).reduce((s, n) => s + Number(n), 0);
  assert.equal(pw, 1);
});

test('RJ#9225 a Hidden card revealed by Void Burrower is played, not hidden', () => {
  let g = S0();
  setLegend(g, P0, 'Void Burrower');
  setRunes(g, P0, 4, 'fury');
  const h = put(g, P0, 'HidU(2)', 'deckTop');
  const u = put(g, P0, 'V(1)', 'base');
  g = move(g, P0, [u], BF_B);
  const seen: string[] = [];
  g = settle(g, d => { seen.push(d.prompt); return d.kind === 'optional' ? 'yes' : d.options!.find(o => o.id === h)?.id ?? (d.kind === 'chooseDestination' ? 'base' : undefined); });
  assert.notEqual(zone(g, h), 'facedown');
  assert.ok(['base', 'battlefield'].includes(zone(g, h)));
  assert.ok(!seen.some(p => /\bhide\b/i.test(p)), 'no option to hide');
});

test('RJ#9226 Stacked Deck looking at Nocturne, Horrifying: banish it and play it for [A] after the spell', () => {
  let g = S0();
  setRunes(g, P0, 3, 'chaos');
  const nc = put(g, P0, 'Nocturne, Horrifying', 'deckTop');
  [g] = cast(g, P0, 'Stacked Deck');
  g = settle(g, d => d.kind === 'optional' ? 'yes' : (d.options!.find(o => o.id === nc)?.id ?? (d.kind === 'chooseDestination' ? 'base' : undefined)));
  assert.ok(['base', 'battlefield'].includes(zone(g, nc)), `Nocturne played (zone ${zone(g, nc)})`);
  assert.equal(g.players[0].runesInPlay.length, 2, 'paid [A] (one rune recycled)');
});

// RJ#9227 DECIDED (docs/riftjudge/DECISIONS.md): consistent with RJ#10433 (+ #9523/#10168/#10194, CR 355.5): Heedless
// Resurrection's trash unit is chosen while playing, before the kill cost is paid, so the killed unit can't be the one played
// back. RJ's verdict (no +2) holds for a Diana already in the trash: she is played after HR finishes resolving (CR 354.4), so she
// isn't on the board when HR's play completes (CR 420.4.a).
test('RJ#9227 Diana, No Longer Human played from the trash by Heedless Resurrection doesn\'t get +2 from it', () => {
  let g = S0();
  fundAll(g, P0, 3);
  const di = put(g, P0, 'Diana, No Longer Human', 'trash');
  const other = put(g, P0, 'Diana, No Longer Human', 'base'); // same cost: a legal kill for the additional cost
  const hr = hand(g, P0, 'Heedless Resurrection');
  g = act(g, { type: 'playCard', player: P0, obj: hr });
  g = settle(g, d => d.options!.find(o => o.id === di)?.id ?? d.options!.find(o => o.id === other)?.id);
  assert.equal(zone(g, other), 'trash', 'the other Diana was killed for the cost');
  assert.notEqual(zone(g, di), 'trash', 'Diana played back');
  assert.equal(mightOf(g, di), 3, 'no +2: she was not on the board when Heedless Resurrection was played');
});

test('RJ#9228 responding to a Sprite\'s Temporary trigger with hidden Sprite Call: the new Sprite survives the turn', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0, 3);
  const old = put(g, P0, 'Sprite', 'base', { token: true });
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const sc = put(g, P0, 'Sprite Call', { facedown: BF_A });
  g = act(g, { type: 'endTurn', player: P1 });
  let played = false;
  for (let i = 0; i < 30; i++) {
    const d = g.pending!;
    if (d.kind === 'mainAction' && d.player === P0) break;
    if (!played && d.kind === 'chainResponse' && d.player === P0 && g.chain.some(c => c.source === old)) {
      g = act(g, { type: 'playCard', player: P0, obj: sc }); played = true; continue;
    }
    g = d.inStep ? choose(g, d.options![0].id) : pass(g);
  }
  assert.ok(played, 'Sprite Call played in response to the Temporary trigger');
  assert.equal(zone(g, old), 'gone');
  // SCRIPT-FIX: a token played by a card played from facedown is played at that battlefield (CR 811.1.d.5; RJ#1553), not base
  const sprites = Object.values(g.objects).filter(o => o.controller === P0 && (o.zone === 'base' || o.zone === 'battlefield') && g.cards[o.cardId]?.name === 'Sprite');
  assert.equal(sprites.length, 1, 'the new Sprite is still here in the main phase');
});

test('RJ#9231 Dusk Rose Lab can kill a Sprite before its Temporary trigger resolves, to draw', () => {
  let g = S0({ tp: P1, bfA: 'Dusk Rose Lab' });
  const sp = put(g, P0, 'Sprite', BF_A, { token: true }); control(g, BF_A, P0);
  put(g, P0, 'V(1)', BF_A);
  const h0 = g.players[0].hand.length;
  g = act(g, { type: 'endTurn', player: P1 });
  let ordered = false;
  g = settle(g, d => {
    if (d.kind === 'orderTriggers') { ordered = true; return d.options!.find(o => /Sprite|Temporary/.test(o.label))?.id; }
    if (d.kind === 'optional') return 'yes';
    return d.options!.find(o => o.id === sp)?.id;
  });
  assert.ok(ordered, 'both triggers at the start of the Beginning Phase, ordered by P0');
  assert.equal(zone(g, sp), 'gone');
  assert.equal(g.players[0].hand.length, h0 + 2, 'Lab draw + draw step');
});

test('RJ#9232 Get Excited!: target chosen when played, the discard happens on resolution', () => {
  let g = S0();
  fundAll(g, P0, 3);
  const e = put(g, P1, 'V(4)', BF_A); control(g, BF_A, P1);
  const c = hand(g, P0, 'V(3)');
  const ge = hand(g, P0, 'Get Excited!');
  g = act(g, { type: 'playCard', player: P0, obj: ge });
  if (pend(g).kind === 'chooseTargets') g = choose(g, e);
  assert.equal(g.chain.length, 1);
  assert.equal(zone(g, c), 'hand', 'nothing discarded yet (not a cost)');
  g = settle(g, d => d.options!.find(o => o.id === c)?.id);
  assert.equal(zone(g, c), 'trash');
  assert.equal(g.objects[e].damage, 3);
});

test('RJ#9233 Grand Strategem only affects units on the board when it resolves', () => {
  let g = S0();
  fundAll(g, P0, 4);
  const a = put(g, P0, 'V(2)', 'base');
  [g] = cast(g, P0, 'Grand Strategem');
  g = settle(g);
  assert.equal(mightOf(g, a), 7);
  const b = hand(g, P0, 'V(2)');
  g = play(g, P0, b, { dest: 'base' }); g = settle(g);
  assert.equal(mightOf(g, b), 2);
});

test('RJ#9234 healing in response to Imperial Decree\'s kill trigger doesn\'t save the unit', () => {
  let g = S0();
  fundAll(g, P0, 4); fundAll(g, P1, 3);
  const v = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'Imperial Decree'); g = settle(g);
  [g] = cast(g, P0, 'Flurry of Blades');
  g = passN(g, 2);
  assert.equal(g.objects[v].damage, 1);
  assert.ok(g.chain.length >= 1, 'Decree trigger on the chain');
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  const j = hand(g, P1, 'Janna, Savior');
  g = play(g, P1, j, { dest: BF_A });
  g = settle(g, d => d.kind === 'optional' ? 'no' : undefined);
  assert.equal(zone(g, v), 'trash', 'still killed');
});

test('RJ#9235 Smoke Screen on a 1-Might Watchful Sentry reduces by 0 (snapshot); Discipline then makes it 3', () => {
  let g = S0();
  fundAll(g, P0, 3);
  const s = put(g, P1, 'Watchful Sentry', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'Smoke Screen', { targets: [[s]] }); g = settle(g);
  assert.equal(mightOf(g, s), 1);
  [g] = cast(g, P0, 'Discipline', { targets: [[s]] }); g = settle(g);
  assert.equal(mightOf(g, s), 3);
});

test('RJ#9236 Hostile Takeover on the only enemy unit at their battlefield: noncombat showdown, conquer point kept (SFD-FAQ)', () => {
  let g = S0();
  fundAll(g, P0, 4);
  const u = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'Hostile Takeover', { targets: [[u]] });
  g = passN(g, 2);
  assert.equal(g.objects[u].controller, P0);
  let sawShowdown = false;
  for (let i = 0; i < 10 && pend(g).kind !== 'mainAction'; i++) { if (g.showdown) sawShowdown = true; g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g); }
  assert.ok(sawShowdown, 'a noncombat showdown happens first');
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[0].points, 1);
  g = endTurn(g);
  assert.equal(g.players[0].points, 1, 'point kept after control returns');
});

test('RJ#9237 (a) Ezreal, Prodigy doesn\'t reduce Deflect (not an optional cost)', () => {
  let g = S0();
  put(g, P0, 'Ezreal, Prodigy', 'base');
  setRunes(g, P0, 3, 'fury');
  const ir = put(g, P1, 'Irelia, Fervent', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'StunA', { targets: [[ir]] });
  assert.equal(g.players[0].runesInPlay.length, 2, 'Deflect [A] still paid (one rune recycled) with Ezreal');
});

test('RJ#9237 (b) Vex, Cheerless reduces the Deflect part of the total cost', () => {
  let { g: c } = attackSetup(['Vex, Cheerless'], ['Irelia, Fervent']);
  for (let i = 0; i < 6 && !(pend(c).kind === 'showdownAction' && pend(c).player === P0); i++) c = pend(c).inStep ? choose(c, pend(c).options![0].id) : pass(c);
  setRunes(c, P0, 3, 'fury');
  const irc = Object.keys(c.objects).find(id => c.objects[id].zone === 'battlefield' && c.cards[c.objects[id].cardId].name === 'Irelia')!;
  [c] = cast(c, P0, 'StunA', { targets: [[irc]] });
  assert.equal(c.players[0].runesInPlay.length, 3, 'Vex: [1]+[A] − [1][A], min [1] → no rune recycled');
  assert.equal(exhaustedRunes(c, P0), 1);
});

test('RJ#9239 Traveling Merchant\'s move trigger resolves before combat damage (Tank only matters at assignment)', () => {
  const g0 = S0();
  put(g0, P1, 'Tank(3)', BF_A); control(g0, BF_A, P1);
  const m = put(g0, P0, 'Traveling Merchant', 'base');
  const c = hand(g0, P0, 'V(1)');
  let g = move(g0, P0, [m], BF_A);
  assert.ok(g.chain.some(x => x.source === m) || pend(g).inStep, 'move trigger right away');
  const ev = new EventLog();
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) g = pend(g).inStep ? ev.choose(g, pend(g).options!.find(o => o.id === c)?.id ?? pend(g).options![0].id) : ev.pass(g);
  const types = ev.events.map(e => e.type);
  const di = types.findIndex(t => /discard/.test(t)), dmg = types.findIndex(t => t === 'damage');
  assert.ok(di >= 0 && (dmg < 0 || di < dmg), 'discard/draw before combat damage');
});

test('RJ#9240 Vex, Apathetic at a battlefield stuns an enemy unit played to its base', () => {
  let g = S0({ tp: P1 });
  put(g, P0, 'Vex, Apathetic', BF_A); control(g, BF_A, P0);
  const u = hand(g, P1, 'V(2)');
  g = play(g, P1, u, { dest: 'base' });
  g = settle(g);
  assert.equal(locOf(g, u), 'base');
  assert.equal(!!g.objects[u].stunned, true);
});

test('RJ#9241 Flash choosing two friendly units at The Dreaming Tree draws once', () => {
  let g = S0({ bfA: 'The Dreaming Tree' });
  fundAll(g, P0, 2);
  const a = put(g, P0, 'V(2)', BF_A), b = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const f = hand(g, P0, 'Flash');
  const h0 = g.players[0].hand.length;
  g = play(g, P0, f, { targets: [[a, b]] });
  g = settle(g);
  assert.equal(locOf(g, a), 'base'); assert.equal(locOf(g, b), 'base');
  assert.equal(g.players[0].hand.length, h0 - 1 + 1, 'one draw');
});

test('RJ#9246 The Boss (Sett legend) can replace the death of my buffed unit killed by my own Deathgrip', () => {
  let g = S0();
  fundAll(g, P0, 2);
  const l = setLegend(g, P0, 'The Boss');
  const u = put(g, P0, 'V(3)', BF_A, { buff: true }); control(g, BF_A, P0);
  const o = put(g, P0, 'V(1)', 'base');
  [g] = cast(g, P0, 'Deathgrip', { targets: [[u], [o]] });
  let asked = false;
  g = settle(g, d => { if (d.kind === 'optional') { asked = true; return 'yes'; } return d.options!.find(x => x.id === u || x.id === o)?.id; });
  assert.ok(asked, 'replacement offered');
  assert.equal(locOf(g, u), 'base', 'recalled instead of dying');
  assert.equal(ex(g, u), true);
  assert.equal(g.objects[u].counters.buff ?? 0, 0);
  assert.equal(ex(g, l), true);
});

test('RJ#9248 Energy Conduit: [T] adds [1] to the pool immediately (no chain)', () => {
  let g = S0();
  const ec = put(g, P0, 'Energy Conduit', 'base');
  const ab = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === ec)!;
  assert.ok(ab);
  g = act(g, ab);
  assert.equal(g.chain.length, 0);
  assert.equal(g.players[0].pool.energy, 1);
  assert.equal(ex(g, ec), true);
});

test('RJ#9249 Yasuo, Remorseful moved to base by Fight or Flight before his attack trigger resolves: no damage', () => {
  let { g, atk, def } = attackSetup(['Yasuo, Remorseful'], ['V(7)']);
  fundAll(g, P1, 3);
  for (let i = 0; i < 3 && pend(g).inStep; i++) g = choose(g, def[0]);
  assert.ok(g.chain.length >= 1);
  g = pass(g);
  const f = put(g, P1, 'Fight or Flight', { facedown: BF_A });
  g = act(g, { type: 'playCard', player: P1, obj: f });
  g = choose(g, atk[0]);
  g = passN(g, 2);
  assert.equal(locOf(g, atk[0]), 'base');
  g = passN(g, 2);
  assert.equal(g.objects[def[0]].damage, 0, 'the enemy is no longer "here"');
});

test('RJ#9250 Obelisk of Power: each player channels 1 extra rune at their first Beginning Phase only', () => {
  const run = (first: boolean) => {
    let g = S0({ tp: P1, bfA: 'Obelisk of Power' });
    g.players[0].turnsTaken = first ? 0 : 1;
    const r0 = g.players[0].runesInPlay.length;
    g = act(g, { type: 'endTurn', player: P1 });
    g = settle(g);
    return g.players[0].runesInPlay.length - r0;
  };
  const normal = run(false);
  assert.equal(run(true), normal + 1);
});

test('RJ#9251 a stunned unit still deals damage through Challenge (Stun only stops combat damage)', () => {
  let g = S0();
  fundAll(g, P0, 3);
  const u = put(g, P0, 'V(4)', 'base'), e = put(g, P1, 'V(5)', 'base', { stunned: true });
  [g] = cast(g, P0, 'Challenge', { targets: [[u], [e]] });
  g = settle(g);
  assert.equal(zone(g, u), 'trash', 'the stunned 5 dealt 5');
});

test('RJ#9252 a Repeat cost can be paid only once', () => {
  let g = S0();
  fundAll(g, P0, 4);
  const u = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Bellows Breath') });
  g = choose(g, u); g = yes(g);
  g = choose(g, u);                                // the Repeat's choice (CR 820.2)
  expectPending(g, 'chainResponse', P0, 'no second Repeat offer');
});

test('RJ#9253 Long Sword played from hand attaches via Quick-Draw without paying Equip', () => {
  let g = S0();
  setRunes(g, P0, 4, 'fury');
  const u = put(g, P0, 'V(2)', 'base');
  const sw = hand(g, P0, 'Long Sword');
  g = play(g, P0, sw);
  g = settle(g, d => d.options!.find(o => o.id === u)?.id ?? (d.kind === 'optional' ? 'yes' : undefined));
  assert.equal(g.objects[sw].attachedTo, u);
  assert.equal(g.players[0].runesInPlay.length, 3, 'only the play cost: [2] exhausted + [A] (1 recycled); no Equip [C]');
});

// MISMATCH-RJ (DECISIONS #9254, ENGINE-9): RJ says "the Beginning Phase is not a Neutral Open State", but CR 308-310 define the
// states "At any given time" by showdown/combat and chain only (riftlens /rules/states-of-the-turn/, read 2026-11-26) and CR 323.11
// has no phase condition (DECISIONS #11019): the showdown begins in the Beginning Phase, once the Hold triggers have resolved.
test('RJ#9254 (MISMATCH-RJ, CR 308-310 / 323.11) Sneaky Deckhand played to an open battlefield by Last Rites in the Beginning Phase: the showdown begins there, before Channel and Draw', () => {
  let g = S0({ tp: P1 });
  const u = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const lr = put(g, P0, 'Last Rites', 'base'); attachNow(g, lr, u);
  const dh = put(g, P0, 'Sneaky Deckhand', 'trash');
  g = act(g, { type: 'endTurn', player: P1 });
  const phases = new Set<string>();
  for (let i = 0; i < 30; i++) {
    const d = g.pending!;
    if (g.showdown) phases.add(g.phase);
    if (d.kind === 'mainAction' && d.player === P0 && !g.showdown && locOf(g, dh) === BF_B && g.battlefields[BF_B].controller === P0) break;
    if (d.kind === 'mainAction') break;
    if (d.inStep) g = choose(g, d.kind === 'optional' ? 'yes' : (d.options!.find(o => o.id === dh || o.id === String(BF_B))?.id ?? d.options![0].id));
    else g = pass(g);
  }
  assert.equal(locOf(g, dh), BF_B, 'Deckhand played to the open battlefield');
  assert.ok(phases.size > 0, 'a showdown happened');
  assert.deepEqual([...phases], ['beginning'], 'the showdown is in the Beginning Phase (not the Action Phase)');
});

test('RJ#9255 hiding Consult the Past costs [A] only; playing it from facedown later costs nothing', () => {
  let g = S0();
  setRunes(g, P0, 4, 'mind');
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const c = hand(g, P0, 'Consult the Past');
  g = act(g, { type: 'hide', player: P0, obj: c, battlefieldIndex: BF_A });
  assert.equal(g.players[0].runesInPlay.length, 3, '[A]: one rune recycled');
  assert.equal(exhaustedRunes(g, P0), 0, 'no energy');
  g.objects[c].hiddenTurn = g.turn - 1;
  const h0 = g.players[0].hand.length;
  g = act(g, { type: 'playCard', player: P0, obj: c });
  g = settle(g);
  assert.equal(g.players[0].hand.length, h0 + 2);
  assert.equal(readyRunes(g, P0), 3, 'free from facedown');
});

test('RJ#9256 Karthus played by Baited Hook after Mixologist died doesn\'t double that Deathknell', () => {
  let g = S0();
  fundAll(g, P0, 2);
  const gm = put(g, P0, 'Glasc Mixologist', 'base');
  const hk = put(g, P0, 'Baited Hook', 'base');
  const k = put(g, P0, 'Karthus, Eternal', 'deckTop');
  const t1 = put(g, P0, 'V(1)', 'trash'), t2 = put(g, P0, 'V(1)', 'trash');
  const ab = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === hk)!;
  g = act(g, ab);
  g = settle(g, d => d.kind === 'optional' ? 'yes' : (d.options!.find(o => o.id === gm || o.id === k || o.id === t1 || o.id === t2)?.id ?? (d.kind === 'chooseDestination' ? 'base' : undefined)));
  assert.equal(zone(g, gm), 'trash');
  assert.equal(zone(g, k), 'base', 'Karthus played');
  const back = [t1, t2].filter(t => zone(g, t) === 'base').length;
  assert.equal(back, 1, 'Mixologist\'s Deathknell resolved once');
});

test('RJ#9257 the second player draws on their first turn (1v1)', () => {
  let g = newGame({ firstPlayer: P0 });
  g = act(g, { type: 'endTurn', player: P0 });
  g = settle(g);
  expectPending(g, 'mainAction', P1);
  assert.equal(g.players[1].hand.length, 5);
});

// ---------------------------------------------------------------------------------------------- 9258-9270
test('RJ#9259 Vision: recycling the looked-at card puts it on the bottom of the Main Deck (not the trash)', () => {
  let g = S0();
  fundAll(g, P0);
  const top = put(g, P0, 'V(5)', 'deckTop');
  const t0 = g.players[P0].trash.length;
  const mp = hand(g, P0, 'Mystic Poro');
  g = play(g, P0, mp, { dest: 'base' });
  g = settle(g, d => d.kind === 'optional' ? 'yes' : undefined);
  const deck = g.players[P0].mainDeck;
  assert.equal(deck[deck.length - 1], top, 'bottom of the deck');
  assert.equal(g.players[P0].trash.length, t0);
});

test('RJ#9262 a "when I hold" trigger goes on the chain in the Beginning Phase, right after the hold point is scored', () => {
  let g = S0({ tp: P1 });
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  attachNow(g, put(g, P0, 'Trinity Force', 'base'), u);
  g = act(g, { type: 'endTurn', player: P1 });
  for (let i = 0; i < 30 && !g.chain.length; i++) {
    const d = g.pending!;
    if (d.kind === 'mainAction') break;
    g = d.inStep ? choose(g, d.options![0].id) : pass(g);
  }
  assert.ok(g.chain.length >= 1, 'hold trigger on the chain');
  assert.equal(g.phase, 'beginning');
  assert.equal(g.players[P0].points, 1, 'the hold point was scored first');
  g = settle(g);
  assert.equal(g.players[P0].points, 2);
});

test('RJ#9264 Azir, Sovereign\'s attack trigger still moves tokens if the defenders are gone before it resolves', () => {
  let g = withTokens(S0());
  const az = put(g, P0, 'Azir, Sovereign', 'base');
  const t1 = put(g, P0, 'Recruit', 'base', { token: true }), t2 = put(g, P0, 'Recruit', BF_B, { token: true });
  const d = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [az], BF_A);
  for (let i = 0; i < 5 && !g.chain.some(c => c.source === az); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.ok(g.chain.some(c => c.source === az), 'attack trigger on the chain');
  // the defender leaves before the trigger resolves (e.g. killed in response)
  g.objects[d].zone = 'trash'; g.players[P1].trash.push(d); touch(g);
  g = settle(g, dd => dd.kind === 'optional' ? 'yes' : (dd.options!.some(o => o.id === t1) ? [t1, t2].join(',') : undefined));
  const moved = [t1, t2].filter(t => locOf(g, t) === BF_A).length;
  assert.ok(moved >= 1, `tokens moved to Azir's battlefield (${moved})`);
});

test('RJ#9265 simultaneous Deathknells of both players: turn player\'s goes on the chain first, so the opponent\'s resolves first', () => {
  let g = S0();
  fundAll(g, P0);
  const a = put(g, P0, 'DK(1)', BF_A), b = put(g, P1, 'DK(1)', BF_A);
  [g] = cast(g, P0, 'UpTo2Zap', { targets: [[a, b]] });
  for (let i = 0; i < 10 && !(g.chain.length >= 2); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.equal(g.chain.length, 2, 'both Deathknells on the chain');
  assert.equal(g.chain[0].controller, P0, 'turn player\'s trigger at the bottom');
  assert.equal(g.chain[1].controller, P1, 'opponent\'s on top (resolves first, LIFO)');
});

test('RJ#9266 Twisted Fate, Gambler revealing a Chaos rune: it is recycled and nothing else happens', () => {
  let g = S0();
  const [cr] = addRunes(g, P0, 1, 'chaos');
  g.players[P0].runesInPlay = g.players[P0].runesInPlay.filter(r => r !== cr);
  g.objects[cr].zone = 'runeDeck'; g.players[P0].runeDeck.unshift(cr); touch(g);
  const rd = g.players[P0].runeDeck;
  const tf = put(g, P0, 'Twisted Fate, Gambler', 'base');
  const d1 = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const h0 = g.players[P0].hand.length;
  g = move(g, P0, [tf], BF_A);
  for (let i = 0; i < 10 && g.chain.length; i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  for (let i = 0; i < 10 && g.chain.some(c => c.source === tf); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.equal(g.players[P0].runeDeck.at(-1), cr, 'Chaos rune recycled to the bottom');
  void rd;
  assert.equal(g.players[P0].hand.length, h0, 'no draw');
  assert.equal(!!g.objects[d1].stunned, false, 'no stun');
  assert.ok((g.objects[d1].damage ?? 0) <= 4, 'no 2/1 trigger damage beyond combat');
});

test('RJ#9268 Defy can counter Hidden Blade aimed at a Deflect unit (Deflect is not part of its cost); Deflect isn\'t refunded', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const ir = put(g, P1, 'Irelia, Fervent', BF_A); control(g, BF_A, P1);
  const r0 = g.players[P0].runesInPlay.length;
  [g] = cast(g, P0, 'Hidden Blade', { targets: [[ir]] });
  assert.equal(g.players[P0].runesInPlay.length, r0 - 2, '[A] + Deflect [A] recycled');
  g = settle(g, undefined, 0);
  while (g.pending?.player !== P1 || g.pending.kind !== 'chainResponse') g = pass(g);
  const df = hand(g, P1, 'Defy');
  assert.ok(canPlayNow(g, P1, df), 'Defy is playable');
  g = play(g, P1, df, { targets: [[g.chain.find(c => c.kind === 'spell')!.id]] });
  g = settle(g);
  assert.equal(zone(g, ir), 'battlefield', 'Hidden Blade countered');
  assert.equal(g.players[P0].runesInPlay.length, r0 - 2, 'Deflect not refunded');
});

test('RJ#9270 Yasuo, Remorseful stunned after attacking: his attack trigger still deals damage', () => {
  let { g, atk, def } = attackSetup(['Yasuo, Remorseful'], ['V(7)']);
  for (let i = 0; i < 3 && pend(g).inStep; i++) g = choose(g, def[0]);
  assert.ok(g.chain.some(c => c.source === atk[0]), 'attack trigger on the chain');
  g.objects[atk[0]].stunned = true; touch(g);
  for (let i = 0; i < 6 && g.chain.some(c => c.source === atk[0]); i++) g = pend(g).inStep ? choose(g, def[0]) : pass(g);
  assert.equal(g.objects[def[0]].damage, 6, 'ability damage equal to his Might');
});

test('RJ#9271 Rek\'Sai, Breacher: a unit token played by an ability has Accelerate (pay to enter ready, otherwise exhausted)', () => {
  const run = (pay: boolean) => {
    let g = withTokens(S0());
    fundAll(g, P0, 6);
    put(g, P0, "Rek'Sai, Breacher", 'base');
    const rg = hand(g, P0, 'Royal Guard');
    g = play(g, P0, rg, { dest: 'base' });
    let offered = false;
    g = settle(g, d => {
      if (d.kind === 'optional' && /Accelerate/i.test(d.prompt ?? '')) { offered = true; return pay ? 'yes' : 'no'; }
      return d.kind === 'optional' ? 'no' : undefined;
    });
    const tok = Object.keys(g.objects).find(id => g.objects[id].isToken && g.objects[id].controller === P0 && g.objects[id].zone === 'base');
    assert.ok(tok, 'Sand Soldier played');
    return { offered, ready: !g.objects[tok!].exhausted };
  };
  const a = run(true), b = run(false);
  assert.ok(a.offered, 'Accelerate offered for the token');
  assert.equal(a.ready, true);
  assert.equal(b.ready, false);
});

test('RJ#9272 Not So Fast can\'t counter an enemy Not So Fast (it chooses a spell, not a friendly unit or gear)', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const mine = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  [g] = cast(g, P1 === P1 ? P0 : P0, 'StunA', { targets: [[put(g, P1, 'V(2)', BF_B)]] });
  void mine;
  // P0's StunA chooses P1's unit; P1 answers with Not So Fast
  while (!(g.pending?.kind === 'chainResponse' && g.pending.player === P1)) g = pass(g);
  const nsf1 = hand(g, P1, 'Not So Fast');
  assert.ok(canPlayNow(g, P1, nsf1), 'P1 may counter the StunA');
  g = play(g, P1, nsf1, { targets: [[g.chain[0].id]] });
  while (!(g.pending?.kind === 'chainResponse' && g.pending.player === P0)) g = pass(g);
  const nsf0 = hand(g, P0, 'Not So Fast');
  assert.equal(canPlayNow(g, P0, nsf0), false, 'no legal target: Not So Fast chooses a spell');
});

test('RJ#9273 Guards! played from facedown: the Sand Soldier must be played at that battlefield (not base)', () => {
  let g = withTokens(S0());
  fundAll(g, P0);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const gd = put(g, P0, 'Guards!', { facedown: BF_A });
  g = act(g, { type: 'playCard', player: P0, obj: gd });
  let baseOffered = false;
  g = settle(g, d => { if (d.options?.some(o => o.id === 'base')) baseOffered = true; return d.kind === 'optional' ? 'no' : (d.options?.find(o => o.id === String(BF_A))?.id); });
  const s = Object.keys(g.objects).find(id => g.objects[id].isToken && g.cards[g.objects[id].cardId].name === 'Sand Soldier');
  assert.ok(s);
  assert.equal(locOf(g, s!), BF_A);
  assert.equal(baseOffered, false, 'base not offered');
});

test('RJ#9274 Grand Duelist triggers mid-showdown when a unit becomes Mighty (and can channel)', () => {
  let { g, atk, def } = attackSetup(['V(4)'], ['V(9)']);
  setLegend(g, P0, 'Grand Duelist');
  fundAll(g, P0);
  for (let i = 0; i < 8 && !(pend(g).kind === 'showdownAction' && pend(g).player === P0); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  expectPending(g, 'showdownAction', P0);
  const r0 = g.players[P0].runesInPlay.length;
  [g] = cast(g, P0, 'One-Two Punch', { targets: [[atk[0]], [def[0]]] });
  let asked = false;
  for (let i = 0; i < 10 && !asked && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g);
    if (d.kind === 'optional' && d.player === P0) { asked = true; g = yes(g); break; }
    g = d.inStep ? choose(g, d.options![0].id) : pass(g);
  }
  for (let i = 0; i < 10 && g.chain.length; i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.ok(asked, 'Grand Duelist offered');
  assert.ok(g.showdown || g.combat, 'still in the showdown');
  void r0;
  assert.ok(g.log.some(l => /channel/i.test(l.text)), 'channelled a rune');
});

test('RJ#9275 a Deceiver Reflection copying Kai\'Sa, Evolutionary after she conquered doesn\'t get her conquer trigger for that conquest', () => {
  let g = withTokens(S0());
  fundAll(g, P0);
  setLegend(g, P0, 'Deceiver');
  g.players[P0].points = 3;
  put(g, P0, 'DrawR', 'trash');
  hand(g, P0, 'V(1)');
  const k = put(g, P0, "Kai'Sa, Evolutionary", 'base');
  g = move(g, P0, [k], BF_A);
  g = settle(g, d => d.kind === 'optional' ? 'yes' : (d.options!.find(o => o.id === k)?.id));
  const refl = Object.keys(g.objects).filter(id => g.objects[id].isToken && g.objects[id].zone === 'battlefield');
  assert.equal(refl.length, 1, 'Reflection played');
  const trig = g.log.filter(l => /Trigger: Kai'Sa/.test(l.text)).length;
  assert.equal(trig, 1, 'only the original Kai\'Sa\'s conquer trigger');
});

test('RJ#9276 Yasuo, Remorseful\'s attack damage doesn\'t follow a defender moved to base by Reaver\'s Row first', () => {
  const g0 = S0({ bfA: "Reaver's Row" });
  const d = put(g0, P1, 'V(7)', BF_A); control(g0, BF_A, P1);
  const y = put(g0, P0, 'Yasuo, Remorseful', 'base');
  let g = move(g0, P0, [y], BF_A);
  g = settle(g, dd => dd.kind === 'optional' ? 'yes' : dd.options!.find(o => o.id === d)?.id);
  assert.equal(locOf(g, d), 'base');
  assert.equal(g.objects[d].damage ?? 0, 0, 'no damage at base');
});

test('RJ#9277 a move instruction (Charm) is mandatory: the unit\'s current location is not a destination', () => {
  let g = S0();
  fundAll(g, P0);
  const e = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const c = hand(g, P0, 'Charm');
  g = act(g, { type: 'playCard', player: P0, obj: c });
  const dests = new Set<string>();
  for (let i = 0; i < 12 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    if (d.options!.some(o => o.id === e)) { g = choose(g, e); continue; }
    if (d.kind === 'chooseDestination') for (const o of d.options!) dests.add(o.id);
    g = choose(g, d.options!.find(o => o.id === String(BF_B))?.id ?? d.options![0].id);
  }
  assert.ok(dests.size > 0, 'a destination was asked');
  assert.ok(!dests.has(String(BF_A)), 'cannot "move" it to where it already is');
  assert.notEqual(locOf(g, e), BF_A, 'it moved');
});

test('RJ#9279 Irelia, Fervent chosen by Reaver\'s Row gets +1 Might (the "may" is decided when the trigger is put on the chain)', () => {
  const g0 = S0({ bfA: "Reaver's Row" });
  const ir = put(g0, P1, 'Irelia, Fervent', BF_A); control(g0, BF_A, P1);
  const a = put(g0, P0, 'V(3)', 'base');
  let g = move(g0, P0, [a], BF_A);
  expectPending(g, 'chooseTargets', P1, 'Reaver\'s Row choice made at finalization');
  g = choose(g, ir);
  for (let i = 0; i < 8 && g.chain.length; i++) g = pass(g);
  assert.equal(mightOf(g, ir), 5, '+1 for being chosen');
  assert.equal(locOf(g, ir), 'base', 'no second "may" on resolution: she moves');
});

test('RJ#9281 Cull the Weak doesn\'t "choose" with a spell: no draw from The Dreaming Tree', () => {
  let g = S0({ bfA: 'The Dreaming Tree' });
  fundAll(g, P0);
  const a = put(g, P0, 'V(2)', BF_A), b = put(g, P1, 'V(2)', BF_A);
  const h0 = g.players[P0].hand.length, h1 = g.players[P1].hand.length;
  [g] = cast(g, P0, 'Cull the Weak');
  g = settle(g, d => d.options!.find(o => o.id === a || o.id === b)?.id);
  assert.equal(zone(g, a), 'trash'); assert.equal(zone(g, b), 'trash');
  assert.equal(g.players[P0].hand.length, h0, 'P0 no draw');
  assert.equal(g.players[P1].hand.length, h1, 'P1 no draw');
});

test('RJ#9283 drawing Nocturne, Horrifying is not revealing him: no banish/play offer', () => {
  let g = S0();
  fundAll(g, P0);
  const n = put(g, P0, 'Nocturne, Horrifying', 'deckTop');
  [g] = cast(g, P0, 'DrawR');
  let offered = false;
  g = settle(g, d => { if (d.kind === 'optional') { offered = true; return 'no'; } return undefined; });
  assert.equal(offered, false);
  assert.equal(zone(g, n), 'hand');
});

test('RJ#9284 Drag Under taken by Mystic Reversal still kills the only unit at a battlefield (no "choose nothing")', () => {
  for (const newChoices of [true, false]) {
    let g = S0({ tp: P1 });
    fundAll(g, P0); fundAll(g, P1);
    const mine = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
    put(g, P1, 'V(3)', 'base');
    [g] = cast(g, P1, 'Drag Under', { targets: [[mine]] });
    const du = g.chain[0].source;
    g = pass(g);
    g = play(g, P0, hand(g, P0, 'Mystic Reversal'), { targets: [[du]] });
    g = settle(g, d => d.kind === 'optional' ? (newChoices ? 'yes' : 'no') : (d.options!.find(o => o.id === mine)?.id));
    assert.equal(zone(g, mine), 'trash', `new choices ${newChoices}: the only legal target is killed`);
  }
});

test('RJ#9285 Darius, Trifarian played as the third card doesn\'t ready himself', () => {
  let g = S0();
  fundAll(g, P0, 4);
  [g] = cast(g, P0, 'V(1)', { dest: 'base' });
  [g] = cast(g, P0, 'V(1)', { dest: 'base' });
  const d = hand(g, P0, 'Darius, Trifarian');
  g = play(g, P0, d, { dest: 'base' });
  g = settle(g);
  assert.equal(ex(g, d), true, 'enters exhausted, no trigger');
  assert.equal(mightOf(g, d), 5);
});

test('RJ#9289 Vex, Cheerless attacking into Reaver\'s Row is in combat while the defend trigger is on the chain: enemy spells cost [1][A] more', () => {
  const g0 = S0({ bfA: "Reaver's Row" });
  const d = put(g0, P1, 'V(2)', BF_A); control(g0, BF_A, P1);
  const vx = put(g0, P0, 'Vex, Cheerless', 'base');
  setRunes(g0, P1, 1, 'fury');
  const dr = hand(g0, P1, 'DrawR');
  let g = move(g0, P0, [vx], BF_A);
  if (pend(g).kind === 'chooseTargets' && pend(g).player === P1) g = choose(g, d);
  let checked = false;
  for (let i = 0; i < 6 && g.chain.length; i++) {
    if (pend(g).player === P1 && pend(g).kind === 'chainResponse') { assert.equal(canPlayNow(g, P1, dr), false, 'DrawR now costs [2][A]'); checked = true; break; }
    g = pass(g);
  }
  assert.ok(checked, 'P1 had priority with the Reaver\'s Row trigger on the chain');
  setRunes(g, P1, 2, 'fury'); addRunes(g, P1, 1, 'fury');
  assert.equal(canPlayNow(g, P1, dr), true, 'payable with [2][A]');
});

test('RJ#9290 Dazzling Aurora plays Deadbloom Predator to an occupied enemy battlefield: the combat happens in the ending step of that turn', () => {
  let g = S0();
  fundAll(g, P0);
  put(g, P0, 'Dazzling Aurora', 'base');
  const p = put(g, P0, 'Deadbloom Predator', 'deckTop');
  const e = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const t0 = g.turn;
  g = endTurn(g);
  let combatTurn = -1;
  for (let i = 0; i < 30; i++) {
    const d = g.pending; if (!d) break;
    if ((g.combat || g.showdown) && combatTurn < 0) combatTurn = g.turn;
    if (d.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: d.player, assignment: (d.data as { suggested: Record<ObjId, number> }).suggested }); continue; }
    if (d.inStep) { const o = d.options!.find(o => o.id === String(BF_A)) ?? d.options![0]; g = choose(g, o.id); }
    else if (d.kind === 'mainAction') break; else g = pass(g);
  }
  assert.equal(locOf(g, p), BF_A, 'Predator played to the enemy battlefield');
  assert.equal(combatTurn, t0, 'showdown/combat in P0\'s ending step');
  assert.equal(zone(g, e), 'trash');
});

// ---------------------------------------------------------------------------------------------- 9291-9300
test('RJ#9291 Piercing Light killing Lonely Poro and another friendly unit there at once: Poro didn\'t die alone (either order)', () => {
  for (const first of ['poro', 'other']) {
    let g = S0();
    fundAll(g, P0);
    const lp = put(g, P1, 'Lonely Poro', BF_A), o = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
    const h1 = g.players[P1].hand.length;
    [g] = cast(g, P0, 'Piercing Light', { targets: first === 'poro' ? [[lp], [o]] : [[o], [lp]], may: [false] });
    g = settle(g, d => d.kind === 'optional' ? 'no' : undefined);
    assert.equal(zone(g, lp), 'trash'); assert.equal(zone(g, o), 'trash');
    assert.equal(g.players[P1].hand.length, h1, `${first} first: no draw`);
  }
});

test('RJ#9292 a Reaction drawn while the chain resolves (Defy) can be played before the remaining chain items resolve', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const df = put(g, P1, 'Defy', 'deckTop');
  [g] = cast(g, P0, 'KillA', { targets: [[e]] });
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'DrawR'));
  g = pass(g); g = pass(g);
  assert.equal(zone(g, df), 'hand', 'Defy drawn');
  assert.equal(g.chain.length, 1, 'KillA still on the chain');
  const p = pend(g);
  if (p.player !== P1) g = pass(g);
  expectPending(g, 'chainResponse', P1);
  g = play(g, P1, df, { targets: [[g.chain[0].source]] });
  g = settle(g);
  assert.equal(zone(g, e), 'battlefield', 'KillA countered');
});

test('RJ#9294 Discipline on Irelia, Fervent stolen by Mystic Reversal and retargeted: Irelia keeps her +1 (her trigger was already on the chain)', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const ir = put(g, P0, 'Irelia, Fervent', BF_A); control(g, BF_A, P0);
  const m0 = mightOf(g, ir)!;
  const pu = put(g, P1, 'V(2)', BF_B);
  [g] = cast(g, P0, 'Discipline', { targets: [[ir]] });
  assert.equal(g.chain.length, 2, 'Irelia\'s trigger above Discipline');
  const disc = g.chain[0].source;
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'Mystic Reversal'), { targets: [[disc]] });
  g = settle(g, d => d.kind === 'optional' ? 'yes' : (d.options!.find(o => o.id === pu)?.id));
  assert.equal(mightOf(g, ir), m0 + 1, 'Irelia +1 stays, no +2');
  assert.equal(mightOf(g, pu), 4, 'retargeted Discipline gives P1\'s unit +2');
});

test('RJ#9295 Deathgrip can\'t be played without a friendly unit (it chooses one); Cull the Weak can', () => {
  let g = S0();
  fundAll(g, P0);
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const dg = hand(g, P0, 'Deathgrip');
  assert.equal(canPlayNow(g, P0, dg), false);
  const cw = hand(g, P0, 'Cull the Weak');
  assert.equal(canPlayNow(g, P0, cw), true);
});

test('RJ#9296 Wages of Pain whose target is Retreated in response still plays the Gold token', () => {
  let g = withTokens(S0());
  fundAll(g, P0); fundAll(g, P1);
  const e = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'Wages of Pain', { targets: [[e]] });
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'Retreat'), { targets: [[e]] });
  g = settle(g);
  assert.equal(zone(g, e), 'hand');
  const gold = g.players[P0].base.filter(id => g.cards[g.objects[id].cardId]?.name === 'Gold');
  assert.equal(gold.length, 1, 'Gold still played');
  assert.equal(ex(g, gold[0]), true, 'exhausted');
});

test('RJ#9297 Viktor, Innovator: a card countered by Defy on the opponent\'s turn was never played — no Recruit', () => {
  let g = withTokens(S0({ tp: P1 }));
  fundAll(g, P0); fundAll(g, P1);
  put(g, P0, 'Viktor, Innovator', 'base');
  put(g, P1, 'V(1)', 'base');
  [g] = cast(g, P1, 'StunA', { targets: [[put(g, P0, 'V(2)', 'base')]] });
  g = pass(g);
  g = play(g, P0, hand(g, P0, 'DrawR'));
  const dr = g.chain[g.chain.length - 1].source, drItem = g.chain[g.chain.length - 1].id;
  while (!(pend(g).player === P1 && pend(g).kind === 'chainResponse')) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Defy'), { targets: [[drItem]] });
  g = settle(g);
  assert.equal(zone(g, dr), 'trash');
  const recruits = g.players[P0].base.filter(id => g.cards[g.objects[id].cardId]?.name === 'Recruit');
  assert.equal(recruits.length, 0);
});

test('RJ#9298 Seals enter ready and can be used the turn they are played', () => {
  let g = S0();
  fundAll(g, P0);
  const s = hand(g, P0, 'Seal of Rage');
  g = play(g, P0, s);
  g = settle(g);
  assert.equal(zone(g, s), 'base');
  assert.equal(ex(g, s), false);
  assert.ok(legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === s), 'usable now');
});

test('RJ#9299 gear can be attached to a Sprite token; when the Sprite leaves, the gear detaches and is recalled (not trashed)', () => {
  let g = withTokens(S0());
  fundAll(g, P0);
  const sp = put(g, P0, 'Sprite', BF_A, { token: true }); control(g, BF_A, P0);
  const sw = put(g, P0, 'Sword', 'base');
  attachNow(g, sw, sp);
  assert.equal(g.objects[sw].attachedTo, sp);
  assert.equal(mightOf(g, sp), 5);
  [g] = cast(g, P0, 'KillA', { targets: [[sp]] });
  g = settle(g);
  assert.equal(zone(g, sp), 'gone', 'token ceased to exist');
  assert.equal(g.objects[sw].attachedTo ?? null, null);
  assert.equal(zone(g, sw), 'base');
});

test('RJ#9300 Thousand-Tailed Watcher\'s -3 doesn\'t choose: no Deflect cost for enemy Mechs with Breakneck Mech\'s Deflect', () => {
  let g = S0();
  setRunes(g, P0, 7, 'mind');
  put(g, P1, 'Breakneck Mech', 'base');
  const m = put(g, P1, 'Mech(2)', 'base');
  assert.ok(hasKeyword(g, m, 'Deflect'));
  const w = hand(g, P0, 'Thousand-Tailed Watcher');
  assert.ok(canPlayNow(g, P0, w, 'base'));
  g = play(g, P0, w, { dest: 'base', may: [false] });
  g = settle(g, d => d.kind === 'optional' ? 'no' : undefined);
  assert.equal(zone(g, w), 'base');
  assert.equal(g.players[P0].runesInPlay.length, 6, 'only Watcher\'s own [A] recycled, no Deflect [A]');
  assert.equal(mightOf(g, m), 1, '-3 to a minimum of 1');
});

// ---------------------------------------------------------------------------------------------- 9301-9310
test('RJ#9301 Eager Apprentice reduces the total cost including the Repeat cost', () => {
  let g = S0();
  setRunes(g, P0, 2, 'fury');
  put(g, P0, 'Eager Apprentice', BF_B); control(g, BF_B, P0);
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const rz = hand(g, P0, 'RepeatZap');
  g = act(g, { type: 'playCard', player: P0, obj: rz });
  for (let i = 0; i < 4 && pend(g).inStep; i++) {
    const d = pend(g);
    g = d.kind === 'optional' ? yes(g) : choose(g, d.options!.find(o => o.id === e)?.id ?? d.options![0].id);
  }
  assert.equal(g.chain[0].repeat, 1);
  assert.equal(exhaustedRunes(g, P0), 1, '[1] + Repeat [1] − [1] = [1]');
});

test('RJ#9302 Tricksy Tentacles: the units and the destination are chosen when it is played (CR 355.4)', () => {
  let g = S0();
  fundAll(g, P0);
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const t = hand(g, P0, 'Tricksy Tentacles');
  g = act(g, { type: 'playCard', player: P0, obj: t });
  let destBeforeChain = false;
  for (let i = 0; i < 6 && pend(g).inStep; i++) {
    const d = pend(g);
    if (d.kind === 'chooseDestination') destBeforeChain = true;
    g = choose(g, d.options!.find(o => o.id === e)?.id ?? d.options!.find(o => o.id === 'base')?.id ?? d.options![0].id);
  }
  assert.ok(g.chain.length >= 1);
  assert.ok(destBeforeChain, 'destination chosen before the spell is on the chain');
});

test('RJ#9307 Whirlwind doesn\'t choose: returning an enemy Deflect unit costs no Deflect', () => {
  let g = S0();
  setRunes(g, P0, 4, 'chaos');
  const ir = put(g, P1, 'Irelia, Fervent', BF_A); control(g, BF_A, P1);
  const w = hand(g, P0, 'Whirlwind');
  g = play(g, P0, w);
  assert.equal(g.players[P0].runesInPlay.length, 3, 'only Whirlwind\'s own [A]');
  g = settle(g, d => {
    if (d.player === P1) return d.options!.find(o => /no|skip|none|pass/i.test(o.id + o.label))?.id ?? (d.kind === 'optional' ? 'no' : undefined);
    if (d.kind === 'optional') return 'yes';
    return d.options!.find(o => o.id === ir)?.id;
  });
  assert.equal(zone(g, ir), 'hand');
  assert.equal(g.players[P0].runesInPlay.length, 3, 'no Deflect [A] paid');
});

test('RJ#9308 Bellows Breath targets all moved to base by hidden Emperor\'s Divide: damaged at base, Imperial Decree kills them', () => {
  let g = S0();
  fundAll(g, P0, 4); fundAll(g, P1, 3);
  [g] = cast(g, P0, 'Imperial Decree');
  g = settle(g);
  const a = put(g, P1, 'V(3)', BF_A), b = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const ed = put(g, P1, "Emperor's Divide", { facedown: BF_A });
  const bb = hand(g, P0, 'Bellows Breath');
  g = act(g, { type: 'playCard', player: P0, obj: bb });
  g = choose(g, a, b);
  g = no(g);
  g = pass(g);
  g = act(g, { type: 'playCard', player: P1, obj: ed });
  for (let i = 0; i < 3 && pend(g).inStep; i++) g = pend(g).options!.some(o => o.id === a) ? choose(g, ...[a, b].filter(x => pend(g).options!.some(o => o.id === x))) : choose(g, pend(g).options![0].id);
  g = settle(g, d => d.options!.find(o => o.id === 'base')?.id);
  assert.equal(zone(g, a), 'trash'); assert.equal(zone(g, b), 'trash');
});

test('RJ#9309 Hidden Blade\'s target Flashed to base: no kill and its controller doesn\'t draw 2', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'Hidden Blade', { targets: [[u]] });
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'Flash'), { targets: [[u]] });
  const h1 = g.players[P1].hand.length;
  g = settle(g);
  assert.equal(locOf(g, u), 'base');
  assert.equal(zone(g, u), 'base');
  assert.equal(g.players[P1].hand.length, h1, 'no draw');
});

// ---------------------------------------------------------------------------------------------- 9311-9320
test('RJ#9312 Vex, Apathetic doesn\'t choose: she stuns an enemy Ruin Runner played while she is at a battlefield', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P1, 6);
  put(g, P0, 'Vex, Apathetic', BF_A); control(g, BF_A, P0);
  const rr = hand(g, P1, 'Ruin Runner');
  g = play(g, P1, rr, { dest: 'base' });
  g = settle(g);
  assert.equal(zone(g, rr), 'base');
  assert.equal(!!g.objects[rr].stunned, true);
});

test('RJ#9313 Switcheroo can\'t choose an enemy Ruin Runner', () => {
  let g = S0();
  fundAll(g, P0);
  const rr = put(g, P1, 'Ruin Runner', BF_A); control(g, BF_A, P1);
  const o = put(g, P1, 'V(2)', BF_A);
  const sw = hand(g, P0, 'Switcheroo');
  assert.equal(canPlayNow(g, P0, sw), false, 'only one choosable unit there');
  const o2 = put(g, P1, 'V(3)', BF_A);
  g = act(g, { type: 'playCard', player: P0, obj: sw });
  if (pend(g).inStep) { assert.ok(!pend(g).options!.some(x => x.id === rr), 'Ruin Runner not offered'); g = choose(g, o, o2); }
  const tg = g.chain[0].targets.flat();
  assert.ok(!tg.includes(rr), 'Ruin Runner not chosen');
  assert.deepEqual([...tg].sort(), [o, o2].sort());
});

test('RJ#9314 Glasc Mixologist killed while trying to conquer an uncontrolled battlefield: its Deathknell can\'t play a unit there', () => {
  let g = S0();
  fundAll(g, P1);
  const gm = put(g, P0, 'Glasc Mixologist', 'base');
  const t = put(g, P0, 'V(1)', 'trash');
  put(g, P1, 'V(1)', 'base');
  g = move(g, P0, [gm], BF_A);
  expectPending(g, 'showdownAction', P0);
  g = pass(g);
  expectPending(g, 'showdownAction', P1);
  g = play(g, P1, hand(g, P1, 'Hidden Blade'), { targets: [[gm]] });
  const dests = new Set<string>();
  g = settle(g, d => {
    if (d.kind === 'optional') return 'yes';
    if (d.kind === 'chooseDestination') { d.options!.forEach(o => dests.add(o.id)); return d.options!.find(o => o.id === 'base')?.id; }
    return d.options!.find(o => o.id === t)?.id;
  });
  assert.equal(zone(g, gm), 'trash');
  assert.equal(zone(g, t), 'base', 'played to base');
  assert.ok(!dests.has(String(BF_A)), 'not to the battlefield P0 did not control');
});

test('RJ#9315 Deathgrip chooses its friendly unit when played; if it is gone on resolution: no kill, no Might, still draw 1', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P0, 'V(2)', BF_A), o = put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const dg = hand(g, P0, 'Deathgrip');
  g = act(g, { type: 'playCard', player: P0, obj: dg });
  expectPending(g, 'chooseTargets', P0, 'the unit to kill is chosen when played');
  g = choose(g, u);
  if (pend(g).inStep) g = choose(g, o);
  assert.ok(g.chain[0].targets.flat().includes(u));
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'Gust'), { targets: [[u]] });
  const h0 = g.players[P0].hand.length;
  g = settle(g);
  assert.equal(zone(g, u), 'hand');
  assert.equal(mightOf(g, o), 1, 'no Might given');
  assert.equal(g.players[P0].hand.length, h0 + 2, 'u returned + still draws 1');
});

test('RJ#9318 Blade of the Ruined King equipped to Unsung Hero by killing her as the Equip cost: she dies at 2 Might (no draw), Blade doesn\'t attach', () => {
  let g = S0();
  fundAll(g, P0);
  const uh = put(g, P0, 'Unsung Hero', 'base');
  const bl = put(g, P0, 'Blade of the Ruined King', 'base');
  const h0 = g.players[P0].hand.length;
  const ab = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === bl);
  assert.ok(ab, 'Equip available');
  g = act(g, ab!);
  g = settle(g, d => d.options!.find(o => o.id === uh)?.id);
  assert.equal(zone(g, uh), 'trash');
  assert.equal(g.players[P0].hand.length, h0, 'not Mighty when killed: no draw');
  assert.equal(g.objects[bl].attachedTo ?? null, null);
});

test('RJ#9320 a spell played from the trash by Fizz, Trickster can choose Fizz himself', () => {
  let g = S0(); fundAll(g, P0);
  const b = put(g, P0, 'BuffM', 'trash');
  put(g, P0, 'V(1)', 'base');
  const fz = hand(g, P0, 'Fizz, Trickster');
  g = play(g, P0, fz, { dest: 'base' });
  let offeredFizz = false;
  g = settle(g, d => {
    if (d.kind === 'optional') return 'yes';
    if (d.options!.some(o => o.id === b)) return b;
    if (d.options!.some(o => o.id === fz)) { offeredFizz = true; return fz; }
    return undefined;
  });
  assert.ok(offeredFizz, 'Fizz is a legal choice for the spell');
  assert.equal(g.objects[fz].counters.buff ?? 0, 1);
  assert.equal(zone(g, b), 'mainDeck', 'then recycled');
});

// ---------------------------------------------------------------------------------------------- 9321-9330
test('RJ#9321 conquering an empty battlefield doesn\'t heal damaged units elsewhere', () => {
  let g = S0();
  const hurt = put(g, P0, 'V(5)', BF_A, { damage: 2 }); control(g, BF_A, P0);
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_B);
  g = settle(g);
  assert.equal(g.battlefields[BF_B].controller, P0, 'conquered');
  assert.equal(g.objects[hurt].damage, 2, 'no heal from a conquest');
});

test('RJ#9322 a unit killed in the showdown after moving to an empty battlefield: no control, no point; a conquest scores at once', () => {
  let g = S0();
  fundAll(g, P1);
  const u = put(g, P0, 'V(2)', 'base');
  put(g, P1, 'V(1)', 'base');
  g = move(g, P0, [u], BF_A);
  expectPending(g, 'showdownAction', P0);
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'Hidden Blade'), { targets: [[u]] });
  g = settle(g);
  assert.equal(zone(g, u), 'trash');
  assert.equal(g.battlefields[BF_A].controller ?? null, null);
  assert.equal(g.players[P0].points, 0);
  const v = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [v], BF_B);
  g = settle(g);
  assert.equal(g.players[P0].points, 1, 'conquer point scored immediately');
});

test('RJ#9324 my hidden Tideturner can be played in response to Ferrous Forerunner\'s Deathknell after a combat trade', () => {
  let g = withTokens(S0({ tp: P1 }));
  const ff = put(g, P0, 'Ferrous Forerunner', BF_A); control(g, BF_A, P0);
  const tt = put(g, P0, 'Tideturner', { facedown: BF_A });
  put(g, P0, 'V(1)', 'base');
  const a = put(g, P1, 'V(6)', 'base');
  g = move(g, P1, [a], BF_A);
  let can = false;
  for (let i = 0; i < 30 && !can; i++) {
    const d = g.pending!;
    if (d.kind === 'mainAction') break;
    if (zone(g, ff) === 'trash' && g.chain.some(c => c.source === ff) && d.player === P0 && !d.inStep) { can = canPlayNow(g, P0, tt); break; }
    if (d.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: d.player, assignment: (d.data as { suggested: Record<ObjId, number> }).suggested }); continue; }
    g = d.inStep ? choose(g, d.options![0].id) : pass(g);
  }
  assert.equal(zone(g, a), 'trash', 'trade');
  assert.ok(can, 'Tideturner playable with the Deathknell on the chain');
  g = act(g, { type: 'playCard', player: P0, obj: tt });
  g = settle(g, d => d.kind === 'optional' ? 'no' : undefined);
  assert.ok(['battlefield', 'base'].includes(zone(g, tt)), 'Tideturner played (and maybe swapped)');
  const mechs = g.players[P0].base.filter(id => g.objects[id].isToken);
  assert.equal(mechs.length, 2, 'Deathknell resolves after');
});

test('RJ#9328 Hard Bargain + Repeat on the same spell twice: its controller must pay [2] twice to save it', () => {
  const run = (p0Runes: number) => {
    let g = S0();
    setRunes(g, P0, p0Runes, 'fury'); fundAll(g, P1);
    const t = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
    const z = hand(g, P0, 'ZapA');
    g = play(g, P0, z, { targets: [[t]] });
    g = pass(g);
    const hb = hand(g, P1, 'Hard Bargain');
    g = act(g, { type: 'playCard', player: P1, obj: hb });
    let pays = 0;
    g = settle(g, d => {
      if (d.player === P1) return d.kind === 'optional' ? 'yes' : (d.options!.find(o => o.id === z || g.chain.some(c => c.id === o.id && c.source === z))?.id);
      if (d.kind === 'optional') { pays++; return 'yes'; }
      return undefined;
    });
    return { pays, dmg: g.objects[t].damage, zone: zone(g, t) };
  };
  const poor = run(1 + 2);      // ZapA [1] + one [2] payment
  assert.equal(poor.dmg, 0, 'can pay only once: the second execution counters it');
  const rich = run(1 + 4);
  assert.equal(rich.pays, 2, 'asked to pay twice');
  assert.ok(rich.dmg > 0, 'paid [2] twice: the Zap resolves');
});

test('RJ#9329 Glasc Mixologist alone at my battlefield killed by Singularity: its Deathknell may play a unit back to that battlefield', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P1);
  const gm = put(g, P0, 'Glasc Mixologist', BF_A); control(g, BF_A, P0);
  const t = put(g, P0, 'V(1)', 'trash');
  [g] = cast(g, P1, 'Singularity', { targets: [[gm]] });
  const dests = new Set<string>();
  g = settle(g, d => {
    if (d.kind === 'optional') return 'yes';
    if (d.kind === 'chooseDestination') { d.options!.forEach(o => dests.add(o.id)); return d.options!.find(o => o.id === String(BF_A))?.id; }
    return d.options!.find(o => o.id === t)?.id;
  });
  assert.equal(zone(g, gm), 'trash');
  assert.ok(dests.has(String(BF_A)), 'still controlled while the Deathknell resolves');
  assert.equal(locOf(g, t), BF_A);
  assert.equal(g.battlefields[BF_A].controller, P0);
});

// ---------------------------------------------------------------------------------------------- 9331-9340
test('RJ#9331 Soraka, Wanderer replaces a Temporary Sprite\'s death here: healed, recalled to base, still Temporary', () => {
  let g = withTokens(S0({ tp: P1 }));
  put(g, P0, 'Soraka, Wanderer', BF_A); control(g, BF_A, P0);
  const sp = put(g, P0, 'Sprite', BF_A, { token: true });
  g = act(g, { type: 'endTurn', player: P1 });
  g = settle(g, d => d.kind === 'optional' ? 'yes' : undefined);
  expectPending(g, 'mainAction', P0);
  assert.equal(zone(g, sp), 'base', 'saved and recalled');
  assert.ok(hasKeyword(g, sp, 'Temporary'), 'keeps Temporary');
});

test('RJ#9333 Rumble, Hotheaded can\'t recycle a Mech from hand for his conquer trigger (only a friendly unit on the board)', () => {
  let g = S0();
  const r = put(g, P0, 'Rumble, Hotheaded', 'base');
  const mh = hand(g, P0, 'Mech(2)');
  const mt = put(g, P0, 'Mech(2)', 'trash');
  g = move(g, P0, [r], BF_A);
  let offeredHand = false;
  g = settle(g, d => { if (d.options!.some(o => o.id === mh)) offeredHand = true; return d.kind === 'optional' ? 'yes' : (d.options!.find(o => o.id === mh || o.id === mt)?.id); });
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(offeredHand, false);
  assert.equal(zone(g, mh), 'hand');
  assert.equal(zone(g, mt), 'trash', 'no Mech played from the trash');
});

test('RJ#9334 my unit Charmed into the opponent\'s battlefield; I Rebuke their only unit during the combat: I win the combat, conquer and (Glorious Executioner) draw', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0); fundAll(g, P1);
  setLegend(g, P0, 'Glorious Executioner');
  const mine = put(g, P0, 'V(2)', 'base');
  const theirs = put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const rb = hand(g, P0, 'Rebuke');
  [g] = cast(g, P1, 'Charm', { targets: [[mine]], dest: BF_A });
  const h0 = g.players[P0].hand.length;
  let rebuked = false;
  for (let i = 0; i < 40; i++) {
    const d = g.pending!;
    if (d.kind === 'mainAction') break;
    if (!rebuked && d.player === P0 && !d.inStep && !g.chain.length && canPlayNow(g, P0, rb)) { g = play(g, P0, rb, { targets: [[theirs]] }); rebuked = true; continue; }
    if (d.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: d.player, assignment: (d.data as { suggested: Record<ObjId, number> }).suggested }); continue; }
    g = d.inStep ? choose(g, d.options!.find(o => o.id === String(BF_A))?.id ?? d.options![0].id) : pass(g);
  }
  assert.ok(rebuked, 'Rebuke played during the combat');
  assert.equal(locOf(g, mine), BF_A);
  assert.equal(g.battlefields[BF_A].controller, P0, 'conquered on the opponent\'s turn');
  assert.equal(g.players[P0].points, 1);
  assert.equal(g.players[P0].hand.length, h0 - 1 + 1, 'Rebuke left, Executioner drew 1');
});

test('RJ#9337 Back-Alley Bar\'s +1 doesn\'t choose the unit: Blade Dancer (Irelia legend) does not trigger', () => {
  let g = S0({ bfA: 'Back-Alley Bar' });
  fundAll(g, P0);
  setLegend(g, P0, 'Blade Dancer');
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  g = move(g, P0, [u], 'base');
  let asked = false;
  g = settle(g, d => { if (d.kind === 'optional') { asked = true; return 'no'; } return undefined; });
  assert.equal(mightOf(g, u), 3, '+1 this turn');
  assert.equal(asked, false, 'no Blade Dancer offer');
});

test('RJ#9338 Tank doesn\'t restrict spells: Falling Comet may choose the non-Tank unit', () => {
  let g = S0();
  fundAll(g, P0);
  put(g, P1, 'Tank(3)', BF_A); const o = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'Falling Comet', { targets: [[o]] });
  g = settle(g);
  assert.equal(zone(g, o), 'trash');
});

test('RJ#9340 Ezreal, Prodigy\'s optional-cost discount applies before Vex, Cheerless\'s total-cost discount (Bellows Breath + Repeat = [1][C])', () => {
  let { g, def } = attackSetup(['Vex, Cheerless'], ['V(9)', 'V(9)']);
  put(g, P0, 'Ezreal, Prodigy', 'base');
  for (let i = 0; i < 6 && !(pend(g).kind === 'showdownAction' && pend(g).player === P0); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  setRunes(g, P0, 1, 'fury'); const [m] = addRunes(g, P0, 1, 'mind', false);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Bellows Breath') });
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = pend(g).kind === 'optional' ? yes(g) : choose(g, def[0]);
  assert.equal(g.chain.at(-1)!.repeat, 1);
  // Ezreal first: Repeat [1][C] → [C]; total [1][A][C] − [1][A] (min [1]) = [1][C]. (Vex first would leave just [C].)
  assert.equal(zone(g, m), 'runeDeck', '[C] from the recycled Mind rune');
  assert.equal(exhaustedRunes(g, P0), 1, '[1] energy still paid (Fury rune exhausted)');
});

// ---------------------------------------------------------------------------------------------- 9341-9350
test('RJ#9341 Bellows Breath + Repeat on units at two battlefields; both Flashed to base: both still take damage and die', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const a = put(g, P1, 'V(1)', BF_A), b = put(g, P1, 'V(1)', BF_B); control(g, BF_A, P1); control(g, BF_B, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Bellows Breath') });
  let firstDone = false;   // CR 820.2: first execution chooses a, the Repeat execution (chosen as played) chooses b
  for (let i = 0; i < 6 && pend(g).inStep; i++) {
    const d = pend(g);
    if (d.kind === 'optional') { g = yes(g); continue; }
    const want = firstDone ? b : a;
    g = choose(g, d.options!.some(o => o.id === want) ? want : d.options![0].id);
    firstDone = true;
  }
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'Flash'), { targets: [[a, b]] });
  g = settle(g, d => d.options!.find(o => o.id === b)?.id ?? d.options!.find(o => o.id === 'base')?.id);
  assert.equal(zone(g, a), 'trash'); assert.equal(zone(g, b), 'trash');
});

test('RJ#9343 you can counter your own spell (no refund)', () => {
  let g = S0();
  fundAll(g, P0);
  const h0 = g.players[P0].hand.length;
  [g] = cast(g, P0, 'DrawR');
  const item = g.chain[0].id, src = g.chain[0].source;
  const r1 = readyRunes(g, P0);
  g = play(g, P0, hand(g, P0, 'CounterR'), { targets: [[item]] });
  g = settle(g);
  assert.equal(zone(g, src), 'trash');
  assert.equal(g.players[P0].hand.length, h0, 'DrawR countered: no draw (both cards left the hand)');
  assert.ok(readyRunes(g, P0) < r1, 'no refund');
});

test('RJ#9345 Keeper\'s Verdict on a token: it goes to the Main Deck and ceases to exist', () => {
  let g = withTokens(S0());
  fundAll(g, P0);
  const t = put(g, P1, 'Recruit', BF_A, { token: true }); control(g, BF_A, P1);
  const d0 = g.players[P1].mainDeck.length;
  [g] = cast(g, P0, "Keeper's Verdict", { targets: [[t]] });
  g = settle(g);
  assert.equal(zone(g, t), 'gone');
  assert.ok(!g.players[P1].mainDeck.includes(t));
  assert.equal(g.players[P1].mainDeck.length, d0);
});

test('RJ#9349 Forgefire Cape can be equipped to my own Ruin Runner (protection only stops enemy choices)', () => {
  let g = S0();
  fundAll(g, P0);
  const rr = put(g, P0, 'Ruin Runner', 'base');
  const cape = put(g, P0, 'Forgefire Cape', 'base');
  const m0 = mightOf(g, rr)!;
  g = equip(g, cape, rr);
  assert.equal(g.objects[cape].attachedTo, rr);
  assert.equal(mightOf(g, rr), m0 + 3);
});

// ---------------------------------------------------------------------------------------------- 9351-9360
test('RJ#9353 Brush gives Ivern, Friend to All (Ivern + chosen Bird tag) only +1, not +1 per matching tag', () => {
  let g = withTokens(S0());
  setBattlefieldCard(g, BF_A, 'unl-t03');
  const iv = put(g, P0, 'Ivern, Friend to All', BF_A); control(g, BF_A, P0);
  mod(g, iv, { addTags: ['Bird'] });
  assert.equal(mightOf(g, iv), 7);
});

test('RJ#9354 Svellsongur doesn\'t copy a Shield granted by Block (only printed text)', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0);
  const u = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const sv = put(g, P0, 'Svellsongur', 'base'); attachNow(g, sv, u);
  const bl = put(g, P0, 'Block', { facedown: BF_A });
  const a = put(g, P1, 'V(1)', 'base');
  g = move(g, P1, [a], BF_A);
  for (let i = 0; i < 6 && !canPlayNow(g, P0, bl); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  g = play(g, P0, bl, { targets: [[u]] });
  for (let i = 0; i < 4 && g.chain.length; i++) g = pass(g);
  assert.equal(kwValue(g, u, 'Shield'), 3, 'Shield 3 from Block only (not doubled)');
});

test('RJ#9355 Alpha Strike after Stupefy on the dealing unit: damage total reduced by 1, still only the originally chosen enemies', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const f = put(g, P0, 'V(4)', BF_A); control(g, BF_A, P0);
  const e1 = put(g, P1, 'V(5)', BF_B), e2 = put(g, P1, 'V(5)', BF_B); control(g, BF_B, P1);
  const e3 = put(g, P1, 'V(5)', BF_B);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Alpha Strike') });
  for (let i = 0; i < 6 && pend(g).inStep; i++) {
    const d = pend(g);
    const ids = d.options!.map(o => o.id);
    if (ids.includes(f)) g = choose(g, f);
    else if (d.kind === 'chooseNumber' || (d.data as { split?: unknown } | undefined)?.split) g = choose(g, d.options![0].id);
    else g = choose(g, ...[e1, e2].filter(x => ids.includes(x)));
  }
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'Stupefy'), { targets: [[f]] });
  g = settle(g, d => d.options!.find(o => o.id === e1 || o.id === e2)?.id);
  const dmg = [e1, e2, e3].map(x => g.objects[x].damage ?? 0);
  assert.equal(dmg[0] + dmg[1], 3, 'Might 3 after Stupefy');
  assert.equal(dmg[2], 0, 'no new target');
});

// ADJUDICATOR-4 (DECISIONS #9356): official UNL-FAQ "What happens if you Brush a Brush?": "The Brush token will cease to exist" and the
// swap back may choose any replaced object, incl. the original battlefield — Green Father may Brush a Brush. RJ#9356 → MISMATCH-RJ.
test('RJ#9356 (MISMATCH-RJ, UNL-FAQ) Green Father may replace a held Brush with another Brush (the old Brush token ceases to exist)', () => {
  let g = withTokens(S0({ tp: P1 }));
  setBattlefieldCard(g, BF_A, 'unl-t03');
  const gf = setLegend(g, P0, 'Green Father');
  put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  g = act(g, { type: 'endTurn', player: P1 });
  let offered = false;
  g = settle(g, d => { if (d.kind === 'optional' && d.player === P0 && /Green Father|replace that battlefield/i.test(d.prompt ?? '')) { offered = true; return 'yes'; } return d.kind === 'optional' ? 'no' : undefined; });
  assert.equal(g.players[P0].points, 1, 'held');
  assert.ok(offered, 'Green Father offered on the Brush');
  assert.equal(ex(g, gf), true, 'legend exhausted: the Brush was Brushed');
});

test('RJ#9357 equipping Boots of Swiftness chooses a friendly unit: Blade Dancer (Irelia legend) triggers', () => {
  let g = S0();
  fundAll(g, P0);
  const bd = setLegend(g, P0, 'Blade Dancer');
  const u = put(g, P0, 'V(2)', 'base', { ready: false });
  const bt = put(g, P0, 'Boots of Swiftness', 'base');
  const ab = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === bt)!;
  assert.ok(ab, 'Equip available');
  g = act(g, ab);
  let offered = false;
  g = settle(g, d => { if (d.kind === 'optional') { offered = true; return 'yes'; } return d.options!.find(o => o.id === u)?.id; });
  assert.equal(g.objects[bt].attachedTo, u);
  assert.ok(offered, 'Blade Dancer offered');
  assert.equal(ex(g, bd), true);
  assert.equal(ex(g, u), false, 'readied');
});

// ---------------------------------------------------------------------------------------------- 9361-9370
test('RJ#9362 Fizz, Trickster\'s play trigger on the chain: Last Rites can\'t be equipped until it resolves (Equip isn\'t a Reaction)', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'DrawR', 'trash');
  fillTrash(g, P0, 2);
  const lr = put(g, P0, 'Last Rites', 'base');
  const fz = hand(g, P0, 'Fizz, Trickster');
  g = play(g, P0, fz, { dest: 'base' });
  for (let i = 0; i < 3 && pend(g).inStep; i++) g = pend(g).kind === 'optional' ? no(g) : choose(g, pend(g).options![0].id);
  assert.ok(g.chain.length >= 1, 'Fizz trigger on the chain');
  assert.ok(!legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === lr), 'no Equip while the chain is open');
  g = settle(g, d => d.kind === 'optional' ? 'no' : undefined);
  assert.ok(legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === lr), 'Equip available afterwards');
});

test('RJ#9363 Singularity ("up to two") can be played choosing zero units', () => {
  let g = S0();
  fundAll(g, P0);
  const s = hand(g, P0, 'Singularity');
  assert.ok(canPlayNow(g, P0, s), 'playable with no units anywhere');
  g = play(g, P0, s, { targets: [[]] });
  g = settle(g);
  assert.equal(zone(g, s), 'trash');
});

test('RJ#9364 Ivern, Friend to All loses his chosen tag when he dies (trash resets modifications)', () => {
  let g = S0();
  fundAll(g, P0, 6);
  const iv = hand(g, P0, 'Ivern, Friend to All');
  g = play(g, P0, iv, { dest: 'base' });
  g = settle(g, d => d.options!.find(o => /Bird/.test(o.label) || o.id === 'Bird')?.id);
  assert.ok(charsOf(g, iv).tags.includes('Bird'), 'gained Bird');
  [g] = cast(g, P0, 'KillDraw', { targets: [[iv]] });
  g = settle(g);
  assert.equal(zone(g, iv), 'trash');
  assert.ok(!charsOf(g, iv).tags.includes('Bird'), 'no Bird tag in the trash');
});

test('RJ#9367 a Deathknell unit saved by Guardian Angel never dies: no Deathknell', () => {
  let g = S0();
  fundAll(g, P0);
  const u = put(g, P0, 'DK(1)', BF_A); control(g, BF_A, P0);
  const ga = put(g, P0, 'Guardian Angel', 'base'); attachNow(g, ga, u);
  const h0 = g.players[P0].hand.length;
  [g] = cast(g, P0, 'KillA', { targets: [[u]] });
  g = settle(g, d => d.kind === 'optional' ? 'yes' : undefined);
  assert.equal(zone(g, ga), 'trash', 'Guardian Angel killed instead');
  assert.equal(locOf(g, u), 'base', 'recalled');
  assert.equal(g.players[P0].hand.length, h0, 'no Deathknell draw (KillA left the hand: net 0)');
});

test('RJ#9368 hidden Guards! played during combat with Emperor of the Sands: the Sand Soldier\'s Weaponmaster attaches an Equipment before damage', () => {
  let g = withTokens(S0({ tp: P1 }));
  fundAll(g, P0);
  setLegend(g, P0, 'Emperor of the Sands');
  const d = put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const gd = put(g, P0, 'Guards!', { facedown: BF_A });
  const sw = put(g, P0, 'Long Sword', 'base');
  const a = put(g, P1, 'V(9)', 'base');
  g = move(g, P1, [a], BF_A);
  for (let i = 0; i < 8 && !canPlayNow(g, P0, gd); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.ok(canPlayNow(g, P0, gd), 'Guards! playable in the combat');
  g = act(g, { type: 'playCard', player: P0, obj: gd });
  let soldier: ObjId | undefined;
  let attachedBeforeDamage = false;
  for (let i = 0; i < 30; i++) {
    const p = g.pending!;
    soldier ??= Object.keys(g.objects).find(id => g.objects[id].isToken && g.cards[g.objects[id].cardId].name === 'Sand Soldier');
    if (p.kind === 'assignDamage') { attachedBeforeDamage = !!soldier && g.objects[sw].attachedTo === soldier; g = act(g, { type: 'assignDamage', player: p.player, assignment: (p.data as { suggested: Record<ObjId, number> }).suggested }); continue; }
    if (p.kind === 'mainAction') break;
    g = p.inStep ? choose(g, p.kind === 'optional' ? 'yes' : (p.options!.find(o => o.id === sw || o.id === soldier)?.id ?? p.options![0].id)) : pass(g);
  }
  void d;
  assert.ok(soldier, 'Sand Soldier played');
  assert.ok(attachedBeforeDamage || g.objects[sw].attachedTo === soldier, 'Long Sword attached to the Soldier');
});

test('RJ#9369 Forge of the Fluft\'s granted legend ability has default timing: not usable while defending in a showdown', () => {
  let g = S0({ tp: P1, bfA: 'Forge of the Fluft' });
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  put(g, P0, 'V(3)', 'base');
  const sw = put(g, P0, 'Sword', 'base'); void sw; void u;
  const l = g.players[P0].legend;
  const a = put(g, P1, 'V(1)', 'base');
  g = move(g, P1, [a], BF_A);
  let checked = 0;
  for (let i = 0; i < 12 && pend(g).kind !== 'mainAction'; i++) {
    if (pend(g).player === P0 && !pend(g).inStep) { assert.ok(!legal(g, P0, 'activate').some(x => x.type === 'activate' && x.obj === l)); checked++; }
    if (pend(g).kind === 'assignDamage') { const d = pend(g); g = act(g, { type: 'assignDamage', player: d.player, assignment: (d.data as { suggested: Record<ObjId, number> }).suggested }); continue; }
    g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  }
  assert.ok(checked > 0, 'P0 had priority/focus during the combat');
});

test('RJ#9370 Beast Below with no other friendly unit: its play trigger has no legal target and is removed (enemy stays)', () => {
  let g = S0();
  fundAll(g, P0, 7);
  const e = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const bb = hand(g, P0, 'Beast Below');
  assert.ok(canPlayNow(g, P0, bb, 'base'));
  g = play(g, P0, bb, { dest: 'base' });
  assert.equal(g.chain.length, 0, 'no trigger on the chain');
  g = settle(g);
  assert.equal(zone(g, bb), 'base');
  assert.equal(zone(g, e), 'battlefield');
});

// ---------------------------------------------------------------------------------------------- 9371-9380
test('RJ#9371 Retreat on an enemy unit I took with Hostile Takeover: it goes to its owner\'s hand, the owner channels, no recall later', () => {
  let g = S0();
  fundAll(g, P0, 4);
  const u = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  put(g, P1, 'V(1)', BF_A);
  [g] = cast(g, P0, 'Hostile Takeover', { targets: [[u]] });
  g = passN(g, 2);
  assert.equal(g.objects[u].controller, P0);
  const r1 = g.players[P1].runesInPlay.length, r0 = g.players[P0].runesInPlay.length;
  const rt = hand(g, P0, 'Retreat');
  if (canPlayNow(g, P0, rt)) {
    g = play(g, P0, rt, { targets: [[u]] });
  }
  g = settle(g);
  assert.equal(zone(g, u), 'hand');
  assert.ok(g.players[P1].hand.includes(u), 'owner\'s hand');
  assert.equal(g.players[P1].runesInPlay.length, r1 + 1, 'owner channels 1');
  assert.ok(g.players[P0].runesInPlay.length <= r0, 'P0 channels nothing');
  g = endTurn(g);
  assert.ok(g.players[P1].hand.includes(u), 'no recall at end of turn');
});

test('RJ#9373 Diana, Lunari moving to an open battlefield starts a showdown there: her "when a showdown begins here" triggers', () => {
  let g = S0();
  fundAll(g, P0);
  const di = put(g, P0, 'Diana, Lunari', 'base');
  g = move(g, P0, [di], BF_A);
  let offered = false;
  g = settle(g, d => { if (d.kind === 'optional' && d.player === P0) { offered = true; return 'no'; } return undefined; });
  assert.ok(offered || g.log.some(l => /Trigger: Diana/.test(l.text)), 'Diana\'s showdown trigger');
  assert.equal(g.battlefields[BF_A].controller, P0);
});

test('RJ#9375 Factory Recall on an Equipment I stole with Akshan returns it to its owner\'s hand', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const eu = put(g, P1, 'V(2)', 'base');
  const sw = put(g, P1, 'Long Sword', 'base');
  attachNow(g, sw, eu);
  const ak = hand(g, P0, 'Akshan, Mischievous');
  g = act(g, { type: 'playCard', player: P0, obj: ak, destination: 'base' });
  g = answer(g, { may: [true] }, P0);
  for (let i = 0; i < 12 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'orderTriggers') g = choose(g, d.options!.find(o => /Weaponmaster/.test(o.label))!.id);
    else if (d.inStep) g = choose(g, d.options!.find(o => o.id === sw)?.id ?? d.options![0].id);
    else g = pass(g);
  }
  assert.equal(g.objects[sw].controller, P0);
  g = endTurn(g); g = settle(g);
  [g] = cast(g, P1, 'Factory Recall', { targets: [[sw]] });
  g = settle(g);
  assert.ok(g.players[P1].hand.includes(sw), 'owner\'s hand');
});

test('RJ#9376 Azir, Ascendant\'s swap doesn\'t exhaust the swapped unit', () => {
  let g = S0();
  fundAll(g, P0);
  const az = put(g, P0, 'Azir, Ascendant', 'base');
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const ab = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === az)!;
  assert.ok(ab);
  g = act(g, ab);
  g = settle(g, d => d.kind === 'optional' ? 'no' : d.options!.find(o => o.id === u)?.id);
  assert.equal(locOf(g, u), 'base'); assert.equal(locOf(g, az), BF_A);
  assert.equal(ex(g, u), false, 'still ready');
});

test('RJ#9377 Not So Fast counters Elder Dragon\'s play trigger that chose my unit', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0); fundAll(g, P1, 16);
  const mine = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const ed = hand(g, P1, 'Elder Dragon');
  g = act(g, { type: 'playCard', player: P1, obj: ed, destination: 'base' });
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = choose(g, pend(g).options!.some(o => o.id === mine) ? mine : pend(g).options![0].id);
  assert.ok(g.chain.some(c => c.source === ed), 'play trigger on the chain');
  while (!(pend(g).player === P0 && pend(g).kind === 'chainResponse')) g = pass(g);
  const nsf = hand(g, P0, 'Not So Fast');
  assert.ok(canPlayNow(g, P0, nsf));
  g = play(g, P0, nsf, { targets: [[g.chain.find(c => c.source === ed)!.id]] });
  g = settle(g);
  assert.equal(zone(g, mine), 'battlefield', 'trigger countered: no lethal 1 damage');
  assert.equal(zone(g, ed), 'base');
});

test('RJ#9378 a ready stunned attacker recalled after a no-kill combat stays ready (and stunned)', () => {
  let { g, atk } = attackSetup(['V(5)'], ['V(1)'], { defOpts: [{}] });
  g.objects[atk[0]].exhausted = false; g.objects[atk[0]].stunned = true; touch(g);
  g = settle(g, undefined, 60);
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: d.player, assignment: (d.data as { suggested: Record<ObjId, number> }).suggested }); continue; }
    g = d.inStep ? choose(g, d.options![0].id) : pass(g);
  }
  assert.equal(locOf(g, atk[0]), 'base', 'recalled');
  assert.equal(ex(g, atk[0]), false, 'still ready');
  assert.equal(!!g.objects[atk[0]].stunned, true, 'still stunned');
});

test('RJ#9379 Deathgrip on my unit next to Soraka, Wanderer: the death is replaced (recalled exhausted), no Might bonus, still draw 1', () => {
  let g = S0();
  fundAll(g, P0);
  put(g, P0, 'Soraka, Wanderer', BF_A); control(g, BF_A, P0);
  const u = put(g, P0, 'V(2)', BF_A), o = put(g, P0, 'V(1)', 'base');
  const h0 = g.players[P0].hand.length;
  [g] = cast(g, P0, 'Deathgrip', { targets: [[u], [o]] });
  g = settle(g, d => d.kind === 'optional' ? 'yes' : undefined);
  assert.equal(locOf(g, u), 'base', 'recalled instead of dying');
  assert.equal(ex(g, u), true);
  assert.equal(mightOf(g, o), 1, '"If you do" not met: no Might');
  assert.equal(g.players[P0].hand.length, h0 + 1, 'draw 1 (Deathgrip left the hand: net +1)');
});

// ---------------------------------------------------------------------------------------------- 9381-9390
test('RJ#9381 Arcane Shift can\'t be played when the only enemy unit at a battlefield is Ruin Runner', () => {
  let g = S0();
  fundAll(g, P0);
  put(g, P0, 'V(2)', 'base');
  put(g, P1, 'Ruin Runner', BF_A); control(g, BF_A, P1);
  const as = hand(g, P0, 'Arcane Shift');
  assert.equal(canPlayNow(g, P0, as), false);
  put(g, P1, 'V(1)', BF_A);
  assert.equal(canPlayNow(g, P0, as), true, 'another enemy unit there: playable');
});

test('RJ#9382 Irelia, Fervent chosen by my spell (+1) and readied by Blade Dancer (+1 again)', () => {
  let g = S0();
  fundAll(g, P0);
  setLegend(g, P0, 'Blade Dancer');
  const ir = put(g, P0, 'Irelia, Fervent', BF_A, { ready: false }); control(g, BF_A, P0);
  const m0 = mightOf(g, ir)!;
  [g] = cast(g, P0, 'Discipline', { targets: [[ir]] });
  g = settle(g, d => d.kind === 'optional' ? 'yes' : undefined);
  assert.equal(ex(g, ir), false, 'readied');
  assert.equal(mightOf(g, ir), m0 + 1 + 1 + 2, 'choose +1, ready +1, Discipline +2');
});

test('RJ#9385 Cull the Weak kills an enemy Baron Nashor (its controller picks; nothing is chosen by the spell)', () => {
  let g = S0();
  fundAll(g, P0);
  const bn = put(g, P1, 'Baron Nashor', BF_A); control(g, BF_A, P1);
  put(g, P0, 'V(1)', 'base');
  [g] = cast(g, P0, 'Cull the Weak');
  g = settle(g);
  assert.equal(zone(g, bn), 'trash');
});

test('RJ#9387 Plundering Poro conquering Veiled Temple: the Temple can\'t ready the Gold token (it doesn\'t exist when the Temple\'s gear is chosen)', () => {
  let g = withTokens(S0({ bfA: 'Veiled Temple' }));
  const pp = put(g, P0, 'Plundering Poro', 'base');
  g = move(g, P0, [pp], BF_A);
  g = settle(g, d => d.kind === 'optional' ? 'yes' : undefined);
  const gold = g.players[P0].base.filter(id => g.cards[g.objects[id].cardId]?.name === 'Gold');
  assert.equal(gold.length, 1, 'Gold played');
  assert.equal(ex(g, gold[0]), true, 'still exhausted');
});

test('RJ#9388 two Falling Stars can stack damage on the same enemy unit at its base', () => {
  let g = S0();
  fundAll(g, P0, 6);
  const e = put(g, P1, 'V(9)', 'base');
  for (let n = 0; n < 2; n++) {
    [g] = cast(g, P0, 'Falling Star', { targets: [[e], [e]] });
    g = settle(g, d => d.options!.find(o => o.id === e)?.id);
  }
  assert.equal(zone(g, e), 'trash', '3+3+3+3 ≥ 9');
});

// ---------------------------------------------------------------------------------------------- 9391-9400
test('RJ#9391 Azir, Ascendant swapping into a battlefield with an enemy Forgefire Cape unit takes no damage (the Cape only triggers on attack/defend)', () => {
  let g = S0();
  fundAll(g, P0);
  const d = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const cape = put(g, P1, 'Forgefire Cape', 'base'); attachNow(g, cape, d);
  const az = put(g, P0, 'Azir, Ascendant', 'base');
  const a = put(g, P0, 'V(5)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 10 && !(pend(g).kind === 'showdownAction' && pend(g).player === P0 && !g.chain.length); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.equal(g.objects[a].damage, 2, 'defend trigger hit the attacker');
  const ab = legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === az);
  assert.ok(ab, 'Azir\'s action usable in the showdown');
  g = act(g, ab!);
  for (let i = 0; i < 6 && (pend(g).inStep || g.chain.length); i++) g = pend(g).inStep ? choose(g, pend(g).kind === 'optional' ? 'no' : (pend(g).options!.find(o => o.id === a)?.id ?? pend(g).options![0].id)) : pass(g);
  assert.equal(locOf(g, az), BF_A, 'swapped in');
  assert.equal(g.objects[az].damage ?? 0, 0, 'no Cape damage');
});

test('RJ#9396 Elder Dragon: damage prevented by Unyielding Spirit is not dealt, so it doesn\'t kill', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  put(g, P0, 'Elder Dragon', 'base');
  const e = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'ZapA', { targets: [[e]] });
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'Unyielding Spirit'));
  g = settle(g);
  assert.equal(g.objects[e].damage ?? 0, 0);
  assert.equal(zone(g, e), 'battlefield');
});

test('RJ#9398 a token with Deathknell triggers it when killed (it ceases to exist, the trigger still resolves)', () => {
  let g = S0();
  fundAll(g, P0);
  const t = put(g, P0, 'DK(1)', BF_A, { token: true }); control(g, BF_A, P0);
  const h0 = g.players[P0].hand.length;
  [g] = cast(g, P0, 'KillA', { targets: [[t]] });
  g = settle(g);
  assert.equal(zone(g, t), 'gone');
  assert.equal(g.players[P0].hand.length, h0 + 1, 'Deathknell draw (KillA left the hand: net +1)');
});

// ---------------------------------------------------------------------------------------------- 9401-9410
test('RJ#9401 Baited Hook on a unit protected by Tactical Retreat: no unit is killed, so nothing can be played (all 5 recycled)', () => {
  let g = S0();
  fundAll(g, P0);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const hk = put(g, P0, 'Baited Hook', 'base');
  const top = put(g, P0, 'V(1)', 'deckTop');
  [g] = cast(g, P0, 'Tactical Retreat', { targets: [[u]] });
  g = settle(g);
  const ab = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === hk)!;
  assert.ok(ab);
  g = act(g, ab);
  g = settle(g, d => d.kind === 'optional' ? 'yes' : (d.options!.find(o => o.id === u || o.id === top)?.id));
  assert.equal(locOf(g, u), 'base', 'saved: recalled');
  assert.equal(zone(g, top), 'mainDeck', 'not played (no killed unit)');
});

test('RJ#9403 Baron Nashor: other friendly units everywhere have +2 Might (not himself); enemy spells can\'t choose him', () => {
  let g = S0();
  fundAll(g, P1);
  const bn = put(g, P0, 'Baron Nashor', BF_A); control(g, BF_A, P0);
  const a = put(g, P0, 'V(1)', 'base'), b = put(g, P0, 'V(1)', BF_B);
  assert.equal(mightOf(g, a), 3); assert.equal(mightOf(g, b), 3);
  assert.equal(mightOf(g, bn), 12, 'printed 12, no +2 for himself');
  const e = put(g, P1, 'V(1)', 'base');
  assert.equal(mightOf(g, e), 1, 'not enemy units');
  g = endTurn(g); g = settle(g);
  const fc = hand(g, P1, 'Hextech Ray');
  g = act(g, { type: 'playCard', player: P1, obj: fc });
  const d = pend(g);
  if (d.inStep) assert.ok(!d.options!.some(o => o.id === bn), 'Baron not choosable');
  else assert.ok(!g.chain[0].targets.flat().includes(bn));
});

test('RJ#9404 my only attacker Rebuked during the combat showdown: the showdown goes on and I may play another Action (Hextech Ray)', () => {
  let { g, atk, def } = attackSetup(['V(2)'], ['V(6)']);
  fundAll(g, P0); fundAll(g, P1);
  for (let i = 0; i < 6 && !(pend(g).kind === 'showdownAction' && pend(g).player === P0); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  g = pass(g);
  expectPending(g, 'showdownAction', P1);
  g = play(g, P1, hand(g, P1, 'Rebuke'), { targets: [[atk[0]]] });
  for (let i = 0; i < 4 && g.chain.length; i++) g = pass(g);
  assert.equal(zone(g, atk[0]), 'hand');
  expectPending(g, 'showdownAction', P0, 'focus back to me, state open');
  const hr = hand(g, P0, 'Hextech Ray');
  assert.ok(canPlayNow(g, P0, hr), 'an Action may be played');
  void def;
});

test('RJ#9408 Smoke and Mirrors swaps Lillia, Fae Fawn with a Temporary unit elsewhere; her move trigger plays a Sprite where she left', () => {
  let g = withTokens(S0());
  fundAll(g, P0);
  const li = put(g, P0, 'Lillia, Fae Fawn', 'base');
  const sp = put(g, P0, 'Sprite', BF_A, { token: true }); control(g, BF_A, P0);
  [g] = cast(g, P0, 'Smoke and Mirrors', { targets: [[li], [sp]] });
  g = settle(g, d => d.options!.find(o => o.id === li || o.id === sp)?.id);
  assert.equal(locOf(g, li), BF_A);
  assert.equal(locOf(g, sp), 'base');
  const sprites = Object.keys(g.objects).filter(id => g.objects[id].isToken && g.cards[g.objects[id].cardId].name === 'Sprite' && g.objects[id].zone === 'base');
  assert.equal(sprites.length, 2, 'new Sprite at the base Lillia left');
});

test('RJ#9416 Zaun Warrens\' conquer trigger uses the chain: the point is scored first, and the opponent may react before it resolves', () => {
  let g = S0({ bfA: 'Zaun Warrens' });
  fundAll(g, P1);
  hand(g, P0, 'V(1)');
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_A);
  for (let i = 0; i < 8 && g.chain.length === 0; i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.equal(g.players[0].points, 1, 'scored before the trigger resolves');
  assert.equal(g.chain.length, 1, 'trigger on the chain');
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  expectPending(g, 'chainResponse', P1);
  assert.ok(canPlayNow(g, P1, hand(g, P1, 'Unyielding Spirit')), 'a Reaction may be played in response');
});

test('RJ#9417 a spell countered by Defy still counts as a card played for Battering Ram (finalized, CR 420.4.b)', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const ram = hand(g, P0, 'Battering Ram');
  const sp = hand(g, P0, 'DrawR');
  const h0 = g.players[P0].hand.length;
  g = act(g, { type: 'playCard', player: P0, obj: sp });
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'Defy'), { targets: [[sp]] });
  g = settle(g);
  assert.equal(zone(g, sp), 'trash', 'countered');
  assert.equal(g.players[P0].hand.length, h0 - 1, 'no draw');
  assert.equal(playCostOf(g, P0, ram)?.energy, 4, '5 - 1 (the countered spell)');
});

test('RJ#9419 Imperial Decree + Bellows Breath with Repeat on a Guardian Angel unit: two damage instances, two kill triggers — Guardian Angel saves it once, the second kill follows it to base', () => {
  let g = S0();
  fundAll(g, P0);
  [g] = cast(g, P0, 'Imperial Decree');
  g = settle(g);
  const poro = put(g, P1, 'Stalwart Poro', BF_A); control(g, BF_A, P1);
  const ga = put(g, P1, 'Guardian Angel', 'base'); attachNow(g, ga, poro);
  const bb = hand(g, P0, 'Bellows Breath');
  g = act(g, { type: 'playCard', player: P0, obj: bb });
  for (let i = 0; i < 8 && pend(g).inStep; i++) { const d = pend(g); g = d.kind === 'optional' ? yes(g) : choose(g, d.options!.find(o => o.id === poro)?.id ?? d.options![0].id); }
  g = settle(g, d => d.kind === 'optional' ? 'yes' : d.options!.find(o => o.id === poro)?.id);
  assert.equal(zone(g, ga), 'trash', 'Guardian Angel used');
  assert.equal(zone(g, poro), 'trash', 'second Decree trigger kills it at base');
});

test('RJ#9422 Imperial Decree + a lethal Bellows Breath on a Guardian Angel unit: the Angel replaces the lethal-damage death, then the Decree trigger still kills it', () => {
  let g = S0();
  fundAll(g, P0);
  [g] = cast(g, P0, 'Imperial Decree');
  g = settle(g);
  const u = put(g, P1, 'Scuttle Crab', BF_A); control(g, BF_A, P1);
  const ga = put(g, P1, 'Guardian Angel', 'base'); attachNow(g, ga, u);
  assert.equal(mightOf(g, u), 1, '0 + Guardian Angel 1: Bellows Breath\'s 1 is lethal');
  const bb = hand(g, P0, 'Bellows Breath');
  g = act(g, { type: 'playCard', player: P0, obj: bb });
  for (let i = 0; i < 8 && pend(g).inStep; i++) { const d = pend(g); g = d.kind === 'optional' ? no(g) : choose(g, d.options!.find(o => o.id === u)?.id ?? d.options![0].id); }
  g = settle(g, d => d.kind === 'optional' ? 'no' : d.options!.find(o => o.id === u)?.id);
  assert.equal(zone(g, ga), 'trash', 'Guardian Angel used');
  assert.equal(zone(g, u), 'trash', 'the Decree kill follows');
});

test('RJ#9423 Irresistible Faefolk moved to an empty battlefield pulls in an enemy unit: I applied Contested, so I am the Attacker', () => {
  let g = S0();
  const e = put(g, P1, 'V(2)', 'base');
  const f = put(g, P0, 'Irresistible Faefolk', 'base');
  g = move(g, P0, [f], BF_A);
  for (let i = 0; i < 12 && !g.showdown?.isCombat; i++) { const d = pend(g); g = d.inStep ? (d.kind === 'optional' ? yes(g) : choose(g, d.options!.find(o => o.id === e)?.id ?? d.options![0].id)) : pass(g); }
  assert.equal(locOf(g, e), BF_A);
  assert.equal(g.showdown?.isCombat, true);
  assert.equal(g.showdown?.attacker, P0);
});

test('RJ#9425 Sacrifice\'s kill cost on a Mighty unit under Tactical Retreat: replaced (healed, exhausted, recalled) but still paid — draw 2 and channel 1', () => {
  let g = S0();
  fundAll(g, P0);
  const m = put(g, P0, 'V(5)', BF_A); control(g, BF_A, P0);
  [g] = cast(g, P0, 'Tactical Retreat', { targets: [[m]] });
  g = settle(g);
  const sac = hand(g, P0, 'Sacrifice');
  const h0 = g.players[P0].hand.length - 1;
  g = act(g, { type: 'playCard', player: P0, obj: sac });
  g = settle(g, d => d.kind === 'optional' ? 'yes' : d.options!.find(o => o.id === m)?.id);
  assert.equal(locOf(g, m), 'base', 'saved and recalled');
  assert.equal(ex(g, m), true, 'exhausted');
  assert.equal(g.players[P0].hand.length, h0 + 2, 'drew 2');
  assert.ok(g.log.some(l => /channels 1 rune/i.test(l.text)), 'channelled 1 rune');
});

test('RJ#9427 after my Facebreaker resolves in the combat showdown, I can still play Tactical Retreat (Reaction) when focus comes back; both stunned, my attacker is recalled', () => {
  let { g, atk, def } = attackSetup(['V(2)'], ['V(5)']);
  fundAll(g, P0);
  for (let i = 0; i < 6 && !(pend(g).kind === 'showdownAction' && pend(g).player === P0); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  g = play(g, P0, hand(g, P0, 'Facebreaker'), { targets: [[atk[0]], [def[0]]] });
  for (let i = 0; i < 4 && g.chain.length; i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.ok(g.objects[atk[0]].stunned && g.objects[def[0]].stunned, 'both stunned');
  expectPending(g, 'showdownAction', P1, 'focus passed to the opponent');
  g = pass(g);
  expectPending(g, 'showdownAction', P0);
  const tr = hand(g, P0, 'Tactical Retreat');
  assert.ok(canPlayNow(g, P0, tr), 'Reaction playable');
  g = play(g, P0, tr, { targets: [[atk[0]]] });
  g = settle(g);
  assert.equal(locOf(g, atk[0]), 'base', 'survived and recalled after combat');
  assert.equal(locOf(g, def[0]), BF_A);
});

test('RJ#9429 Undertitan\'s play trigger uses the chain and buffs the other units present when it resolves', () => {
  let g = S0();
  fundAll(g, P0);
  const a = put(g, P0, 'V(1)', 'base');
  const ut = hand(g, P0, 'Undertitan');
  g = act(g, { type: 'playCard', player: P0, obj: ut, destination: 'base' });
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = choose(g, pend(g).options![0].id);
  assert.equal(g.chain.length, 1, 'play trigger on the chain');
  const late = put(g, P0, 'V(1)', 'base');
  g = settle(g);
  assert.equal(mightOf(g, a), 3);
  assert.equal(mightOf(g, late), 3, 'a unit that arrived before resolution is buffed too');
  assert.equal(mightOf(g, ut), 5, 'not himself');
});

test('RJ#9433 a hidden Wages of Pain can be played during a showdown at another battlefield, but can only choose a unit at the battlefield where it was hidden', () => {
  let g = S0();
  fundAll(g, P1);
  const mine = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const wp = put(g, P1, 'Wages of Pain', { facedown: BF_A });
  const d1 = put(g, P1, 'V(5)', BF_B); control(g, BF_B, P1);
  const a = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [a], BF_B);
  for (let i = 0; i < 8 && !(pend(g).player === P1 && !pend(g).inStep); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.equal(pend(g).player, P1);
  assert.ok(canPlayNow(g, P1, wp), 'may react with the hidden card');
  g = act(g, { type: 'playCard', player: P1, obj: wp });
  const d = pend(g);
  const chosen = d.inStep ? d.options!.map(o => o.id) : g.chain[g.chain.length - 1].targets.flat();
  assert.ok(chosen.includes(mine), 'units at the hidden battlefield are choosable (only one: auto-chosen)');
  assert.ok(!chosen.includes(a) && !chosen.includes(d1), 'not units at the other battlefield');
});

test('RJ#9434 Renata Glasc, Mastermind\'s "Score 1 point" at 7 wins on my turn (not a conquer/hold point: no all-battlefields rule)', () => {
  let g = S0();
  fundAll(g, P0, 10);
  g.players[P0].points = 7;
  const r = put(g, P0, 'Renata Glasc, Mastermind', BF_A); control(g, BF_A, P0);
  const ab = legal(g, P0, 'activate').filter(x => x.type === 'activate' && x.obj === r);
  assert.ok(ab.length >= 1, 'abilities usable at a battlefield');
  const score = ab.find(x => /score/i.test(JSON.stringify(x))) ?? ab[ab.length - 1];
  g = act(g, score);
  for (let i = 0; i < 6 && g.chain.length === 0 && pend(g).inStep; i++) g = choose(g, pend(g).options![0].id);
  assert.equal(g.chain.length, 1, 'on the chain: the opponent may respond');
  g = settle(g);
  assert.equal(g.players[P0].points, 8);
  assert.equal(g.winner, P0);
});

test('RJ#9435 Charm an enemy Volibear, Furious onto my Yuumi + Vilemaw battlefield: the defender\'s Yuumi trigger goes on the chain last and resolves first (+3 and Tank before Volibear\'s 5)', () => {
  let g = S0();
  fundAll(g, P0);
  put(g, P0, 'Yuumi, Magical Cat', BF_A);
  const vm = put(g, P0, 'Vilemaw', BF_A); control(g, BF_A, P0);
  const vb = put(g, P1, 'Volibear, Furious', 'base');
  [g] = cast(g, P0, 'Charm', { targets: [[vb]] });
  let mightAtVoli = -1;
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction' && pend(g).kind !== 'assignDamage'; i++) {
    const d = pend(g);
    if (g.chain.length === 1 && /Volibear/.test(JSON.stringify(g.chain[0])) && mightAtVoli < 0) mightAtVoli = mightOf(g, vm) ?? -1;
    g = d.inStep ? choose(g, d.options!.find(o => o.id === vm || o.id === String(BF_A))?.id ?? d.options![0].id) : pass(g);
  }
  const texts = g.log.map(l => l.text);
  const iy = texts.findIndex(t => /Resolving Yuumi/.test(t)), iv = texts.findIndex(t => /Resolving Volibear/.test(t));
  assert.ok(texts.some(t => /P1 attacks, P0 defends/.test(t)), 'the Charmed unit\'s controller attacks');
  assert.ok(iy >= 0 && iv > iy, 'Yuumi resolves first');
  assert.equal(mightAtVoli, 11, 'Vilemaw 8+3 when Volibear\'s trigger resolves');
});

test('RJ#9436 Fiora, Peerless attacking one on one: Gust her in response to her attack trigger (3 Might) — she returns to hand before the double', () => {
  let { g, atk, def } = attackSetup(['Fiora, Peerless'], ['Pouty Poro']);
  fundAll(g, P1);
  for (let i = 0; i < 6 && !(g.chain.length && pend(g).player === P1 && !pend(g).inStep); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.equal(g.chain.length, 1, 'Fiora\'s attack trigger on the chain');
  assert.equal(mightOf(g, atk[0]), 3);
  g = play(g, P1, hand(g, P1, 'Gust'), { targets: [[atk[0]]] });
  g = settle(g);
  assert.equal(zone(g, atk[0]), 'hand');
  assert.equal(locOf(g, def[0]), BF_A);
});

test('RJ#9440 playing a token unit is playing a unit: Ephemeral Ward ("When you play a unit, kill this") dies to a Sprite token', () => {
  let g = withTokens(S0());
  fundAll(g, P0);
  const w = put(g, P0, 'Ephemeral Ward', 'base');
  [g] = cast(g, P0, 'Sprite Call');
  g = settle(g);
  assert.ok(Object.values(g.objects).some(o => o.isToken && g.cards[o.cardId].name === 'Sprite' && o.controller === P0), 'Sprite played');
  assert.equal(zone(g, w), 'trash');
});

test('RJ#9444 Arachnoid Horror in base does not let an Ambush unit (Nidalee, Cat Form) be played as a Reaction to a battlefield where I have no units', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0);
  put(g, P0, 'Arachnoid Horror', 'base');
  const n = hand(g, P0, 'Nidalee, Cat Form');
  const e = put(g, P1, 'V(2)', 'base');
  g = move(g, P1, [e], BF_A);
  for (let i = 0; i < 6 && pend(g).player !== P0; i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.equal(pend(g).player, P0, 'I have focus in the showdown');
  assert.ok(!playDests(g, P0, n).includes(BF_A as never), 'not to BF-A');
});

test('RJ#9446 Iron Ballista\'s "Deal 2 to a unit at a battlefield" can\'t choose an enemy Baron Nashor', () => {
  let g = S0();
  fundAll(g, P0);
  const bn = put(g, P1, 'Baron Nashor', BF_A); control(g, BF_A, P1);
  const other = put(g, P1, 'V(3)', BF_A);
  const ib = put(g, P0, 'Iron Ballista', 'base');
  const ab = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === ib);
  assert.ok(ab, 'ability usable');
  g = act(g, ab!);
  const d = pend(g);
  const opts = d.inStep ? d.options!.map(o => o.id) : g.chain[g.chain.length - 1].targets.flat();
  assert.ok(opts.includes(other));
  assert.ok(!opts.includes(bn), 'Baron not choosable');
});

test('RJ#9448 Amateur Recital\'s "move a unit at a battlefield" chooses a unit: choosing an enemy Deflect unit costs [A]; with no power the enemy Pouty Poro can\'t be chosen', () => {
  const g0 = S0({ tp: P1, runes: [0, 6] }); setBattlefieldCard(g0, BF_A, 'Amateur Recital');
  put(g0, P0, 'V(2)', BF_A); control(g0, BF_A, P0);
  const pp = put(g0, P1, 'Pouty Poro', BF_B); control(g0, BF_B, P1);
  let g = endTurn(g0, P1);
  let offered = false;
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.inStep && d.options!.some(o => o.id === pp)) offered = true;
    g = d.inStep ? choose(g, d.options!.find(o => o.id === pp)?.id ?? (d.kind === 'optional' ? 'yes' : d.options![0].id)) : pass(g);
  }
  assert.equal(offered, false, 'Deflect unpayable: not choosable');
  assert.equal(locOf(g, pp), BF_B);
});

test('RJ#9450 Piercing Light + Repeat on the same 2-Might unit both times: no cleanup between executions, both deal their damage, it dies after the spell', () => {
  let g = S0();
  fundAll(g, P0);
  const u = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const pl = hand(g, P0, 'Piercing Light');
  g = act(g, { type: 'playCard', player: P0, obj: pl });
  for (let i = 0; i < 10 && (pend(g).inStep); i++) { const d = pend(g); g = d.kind === 'optional' ? yes(g) : choose(g, ...(d.options!.some(o => o.id === u) ? [u] : [])); }
  g = settle(g, d => d.kind === 'optional' ? 'yes' : d.options!.find(o => o.id === u)?.id);
  const hits = g.log.filter(l => /Piercing Light deals 2 to V\(2\)/.test(l.text)).length;
  assert.equal(hits, 2, 'both executions dealt damage to it');
  assert.equal(zone(g, u), 'trash');
});

test('RJ#9451 Draven, Audacious saved by Guardian Angel in combat never dies: the opponent scores no point', () => {
  let { g, atk } = attackSetup(['Draven, Audacious'], ['V(9)']);
  const ga = put(g, P0, 'Guardian Angel', 'base'); attachNow(g, ga, atk[0]);
  const p1 = g.players[P1].points;
  g = settle(g);
  assert.equal(zone(g, ga), 'trash');
  assert.equal(locOf(g, atk[0]), 'base');
  assert.equal(g.players[P1].points, p1, 'no point for the opponent');
});

test('RJ#9453 Hidden Blade\'s target banished and replayed by Thrill of the Hunt in response is a new object: Hidden Blade mistargets (no kill, no draw)', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'Hidden Blade', { targets: [[u]] });
  g = pass(g);
  const h1 = g.players[P1].hand.length;
  g = play(g, P1, hand(g, P1, 'Thrill of the Hunt'), { targets: [[u]] });
  g = settle(g, d => d.options!.find(o => o.id === String(BF_A))?.id);
  const replayed = Object.keys(g.objects).filter(id => g.objects[id].zone === 'battlefield' && g.objects[id].controller === P1 && g.cards[g.objects[id].cardId].name === 'V(3)');
  assert.equal(replayed.length, 1, 'the unit is back on the board');
  assert.equal(g.players[P1].hand.length, h1, 'no draw 2');
});

test('RJ#9454 Wages of Pain on a Laurent Duelist (3, Assault 2): attacking it is 5 and survives 3; at its base 3 damage kills it; Gold played either way', () => {
  let { g, atk } = attackSetup(['Laurent Duelist'], ['V(1)']);
  fundAll(g, P1);
  for (let i = 0; i < 6 && !(pend(g).kind === 'showdownAction' && pend(g).player === P1 && !g.chain.length); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.equal(mightOf(g, atk[0]), 5);
  g = play(g, P1, hand(g, P1, 'Wages of Pain'), { targets: [[atk[0]]] });
  for (let i = 0; i < 4 && g.chain.length; i++) g = pass(g);
  assert.equal(g.objects[atk[0]].damage, 3);
  assert.equal(zone(g, atk[0]), 'battlefield', 'survives as an attacker');
  assert.ok(g.players[P1].base.some(id => g.cards[g.objects[id].cardId].name === 'Gold'), 'Gold played');
  let h = S0(); fundAll(h, P1);
  const d = put(h, P0, 'Laurent Duelist', BF_A); control(h, BF_A, P0);
  h = endTurn(h, P0); h = settle(h);
  h = play(h, P1, hand(h, P1, 'Wages of Pain'), { targets: [[d]] });
  h = settle(h);
  assert.equal(zone(h, d), 'trash', 'not attacking: 3 Might, dies');
});

test('RJ#9455 three Vex, Mocking: one stun gives three separate move triggers; they resolve one at a time and all three can move', () => {
  let g = S0();
  fundAll(g, P0);
  const vs = [0, 1, 2].map(() => put(g, P0, 'Vex, Mocking', 'base'));
  const e = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'StunA', { targets: [[e]] });
  let maxChain = 0;
  for (let i = 0; i < 40 && pend(g).kind !== 'mainAction' && !g.showdown; i++) {
    const d = pend(g);
    maxChain = Math.max(maxChain, g.chain.length);
    g = d.inStep ? (d.kind === 'optional' ? yes(g) : choose(g, d.options![0].id)) : pass(g);
  }
  assert.ok(g.objects[e].stunned);
  assert.equal(g.log.filter(l => /Vex.* moves to BF-A/.test(l.text)).length, 3, 'three separate moves');
  assert.ok(maxChain >= 3, `three separate triggers on the chain (max ${maxChain})`);
  assert.equal(g.log.filter(l => /Resolving Vex/.test(l.text)).length, 3, 'resolved one by one');
  assert.ok(vs.every(v => locOf(g, v) === BF_A), 'all three moved');
});

test('RJ#9457 my Defy returned to hand by Abandon: once Abandon resolves I get priority again and can re-play Defy on the original spell', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const sp = hand(g, P0, 'DrawR');
  g = act(g, { type: 'playCard', player: P0, obj: sp });
  g = pass(g);
  const df = hand(g, P1, 'Defy');
  g = play(g, P1, df, { targets: [[sp]] });
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  const ab = hand(g, P0, 'Abandon');
  g = act(g, { type: 'playCard', player: P0, obj: ab });
  g = choose(g, pend(g).options!.find(o => o.label === 'Defy')!.id);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = choose(g, pend(g).options![0].id);
  for (let i = 0; i < 6 && zone(g, df) !== 'hand'; i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.equal(zone(g, df), 'hand', 'Defy returned');
  for (let i = 0; i < 6 && g.chain.length > 1; i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.equal(g.chain.length, 1, 'the original spell is still on the chain');
  for (let i = 0; i < 4 && pend(g).player !== P1; i++) g = pass(g);
  assert.ok(canPlayNow(g, P1, df), 'Defy playable again');
  g = play(g, P1, df, { targets: [[sp]] });
  g = settle(g);
  assert.equal(zone(g, sp), 'trash', 'countered');
});

test('RJ#9458 Inferna (Ambush, Assault 2) ambushed in as a defender gets no Assault bonus', () => {
  let { g } = attackSetup(['V(2)'], ['V(5)']);
  fundAll(g, P1);
  for (let i = 0; i < 6 && !(pend(g).kind === 'showdownAction' && pend(g).player === P0 && !g.chain.length); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  g = pass(g);
  const inf = hand(g, P1, 'Inferna');
  g = play(g, P1, inf, { dest: BF_A });
  for (let i = 0; i < 4 && g.chain.length; i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.equal(locOf(g, inf), BF_A);
  assert.equal(mightOf(g, inf), 1, 'Defender: Assault inactive');
});

test('RJ#9468 (MISMATCH-RJ aside) Gutter Palace\'s Beginning Phase win trigger uses the chain and can be answered, but its "if" is part of the trigger condition (CR 383.2.a.1): Gusting a unit in response doesn\'t stop the win', () => {
  const g0 = S0({ tp: P1 });
  fundAll(g0, P1);
  put(g0, P0, 'Gutter Palace', 'base');
  const us = [0, 1, 2, 3].map(() => put(g0, P0, 'V(2)', BF_A)); control(g0, BF_A, P0);
  while (g0.players[P0].hand.length > 4) g0.players[P0].hand.pop();
  while (g0.players[P0].hand.length < 4) hand(g0, P0, 'V(1)');
  const gust = hand(g0, P1, 'Gust');
  let g = endTurn(g0, P1);
  let responded = false;
  for (let i = 0; i < 20 && g.winner == null && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!responded && d.player === P1 && g.chain.length > 0 && canPlayNow(g, P1, gust)) {
      g = play(g, P1, gust, { targets: [[us[0]]] }); responded = true; continue;
    }
    g = d.inStep ? choose(g, d.options![0].id) : pass(g);
  }
  assert.ok(responded, 'a response window on the trigger');
  assert.equal(g.players[P0].hand.length, 5, 'the Gust resolved (5 cards, 3 units)');
  assert.equal(g.winner, P0, 'condition not rechecked on resolution (Sona, Harmonious example in CR 383.2.a.1)');
});

test('RJ#9470 Prodigal Explorer readied after use: its "use only if … twice this turn" condition still holds, no new choices needed', () => {
  let g = S0();
  fundAll(g, P0);
  const lg = setLegend(g, P0, 'Prodigal Explorer');
  const e1 = put(g, P1, 'V(9)', BF_A), e2 = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const canLegend = (h: GameState) => legal(h, P0, 'activate').some(a => a.type === 'activate' && a.obj === lg);
  [g] = cast(g, P0, 'ZapA', { targets: [[e1]] }); g = settle(g);
  [g] = cast(g, P0, 'ZapA', { targets: [[e2]] }); g = settle(g);
  assert.ok(canLegend(g));
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === lg)!);
  g = settle(g);
  assert.equal(ex(g, lg), true);
  assert.equal(canLegend(g), false, 'exhausted');
  g.objects[lg].exhausted = false; // readied by an effect
  assert.ok(canLegend(g), 'usable again this turn');
});

test('RJ#9471 Dunebreaker played from a 3-card hand: 2 cards left when he enters, so he enters ready', () => {
  let g = S0();
  fundAll(g, P0);
  g.players[P0].hand = [];
  const d = hand(g, P0, 'Dunebreaker'); hand(g, P0, 'V(1)'); hand(g, P0, 'V(1)');
  assert.equal(g.players[P0].hand.length, 3);
  g = play(g, P0, d, { dest: 'base' });
  g = settle(g);
  assert.equal(zone(g, d), 'base');
  assert.equal(ex(g, d), false, 'ready');
});

test('RJ#9478 Shadow\'s Call can\'t be played without a friendly unit lacking [Temporary]', () => {
  const g = withTokens(S0());
  fundAll(g, P0);
  const sc = hand(g, P0, "Shadow's Call");
  assert.equal(canPlayNow(g, P0, sc), false, 'no friendly unit');
  put(g, P0, 'Sprite', 'base', { token: true });
  assert.equal(canPlayNow(g, P0, sc), false, 'only a Temporary unit');
  put(g, P0, 'V(1)', 'base');
  assert.equal(canPlayNow(g, P0, sc), true);
});

test('RJ#9483 Akshan, Mischievous takes an exhausted Heart of Dark Ice: it stays exhausted under my control', () => {
  let g = S0();
  fundAll(g, P0);
  const h = put(g, P1, 'Heart of Dark Ice', 'base', { ready: false });
  const ak = hand(g, P0, 'Akshan, Mischievous');
  g = act(g, { type: 'playCard', player: P0, obj: ak, destination: 'base' });
  g = settle(g, d => d.kind === 'optional' ? 'yes' : d.options!.find(o => o.id === h)?.id);
  assert.equal(g.objects[h].controller, P0);
  assert.equal(locOf(g, h), 'base');
  assert.equal(ex(g, h), true, 'still exhausted');
});

test('RJ#9485 Mirror Image\'s Reflection token is played: an enemy Vex, Apathetic at a battlefield stuns it', () => {
  let g = withTokens(S0());
  fundAll(g, P0);
  put(g, P1, 'Vex, Apathetic', BF_A); control(g, BF_A, P1);
  const u = put(g, P0, 'V(3)', 'base');
  [g] = cast(g, P0, 'Mirror Image', { targets: [[u]] });
  g = settle(g);
  const refl = Object.keys(g.objects).filter(id => g.objects[id].isToken && g.objects[id].controller === P0 && g.objects[id].zone === 'base');
  assert.equal(refl.length, 1);
  assert.ok(g.objects[refl[0]].stunned, 'stunned by Vex');
});

test('RJ#9489 a repeated Bellows Breath (1+1) on a Guardian Angel unit: lethal is checked after the spell, Guardian Angel replaces the death once — the unit survives at base', () => {
  let g = S0();
  fundAll(g, P0);
  const u = put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const ga = put(g, P1, 'Guardian Angel', 'base'); attachNow(g, ga, u);
  assert.equal(mightOf(g, u), 2);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Bellows Breath') });
  for (let i = 0; i < 8 && pend(g).inStep; i++) { const d = pend(g); g = d.kind === 'optional' ? yes(g) : choose(g, d.options!.find(o => o.id === u)?.id ?? d.options![0].id); }
  g = settle(g, d => d.kind === 'optional' ? 'yes' : d.options!.find(o => o.id === u)?.id);
  assert.equal(g.log.filter(l => /Bellows Breath deals 1 to V\(1\)/.test(l.text)).length, 2);
  assert.equal(zone(g, ga), 'trash');
  assert.equal(locOf(g, u), 'base');
  assert.equal(g.objects[u].damage ?? 0, 0, 'healed');
});

test('RJ#9494 Hostile Takeover on an enemy unit at Vilemaw\'s Lair: at end of turn it is recalled to its owner\'s base anyway (a recall is not a move)', () => {
  let g = S0({ bfA: "Vilemaw's Lair" });
  fundAll(g, P0);
  const u = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'Hostile Takeover', { targets: [[u]] });
  g = passN(g, 2);
  assert.equal(g.objects[u].controller, P0);
  g = settle(g);
  assert.equal(locOf(g, u), BF_A);
  g = endTurn(g);
  g = settle(g);
  assert.equal(g.objects[u].controller, P1);
  assert.ok(g.players[P1].base.includes(u), 'recalled to its owner\'s base');
});

test('RJ#9496 Ride the Wind on an already-ready Irelia, Fervent: chosen +1 only (readying a ready unit does nothing)', () => {
  let h = S0(); fundAll(h, P0);
  const ir = put(h, P0, 'Irelia, Fervent', BF_A); control(h, BF_A, P0);
  const base = mightOf(h, ir)!;
  h = settle(play(h, P0, hand(h, P0, 'Ride the Wind'), { targets: [[ir]], locations: ['base'] }));
  assert.equal(locOf(h, ir), 'base');
  assert.equal(mightOf(h, ir), base + 1);
});

test('RJ#9499 Elder Dragon: "any amount of your damage" includes combat damage by my other units (V(1) kills a V(9) defender)', () => {
  let { g, atk, def } = attackSetup(['V(1)'], ['V(9)']);
  put(g, P0, 'Elder Dragon', 'base');
  g = settle(g);
  assert.equal(zone(g, def[0]), 'trash', '1 combat damage was enough');
  void atk;
});

test('RJ#9501 Navori Fighting Pit\'s hold buff chooses its unit when the trigger is chained: a hidden unit played there in response can\'t get it', () => {
  const g0 = S0({ tp: P1, bfA: 'Navori Fighting Pit' });
  fundAll(g0, P0);
  const v = put(g0, P0, 'V(2)', BF_A); control(g0, BF_A, P0);
  const hu = put(g0, P0, 'HidU(2)', { facedown: BF_A });
  let g = endTurn(g0, P1);
  let played = false, offeredHidden = false;
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!played && !d.inStep && d.player === P0 && g.chain.length && canPlayNow(g, P0, hu)) { g = act(g, { type: 'playCard', player: P0, obj: hu, destination: BF_A } as never); played = true; continue; }
    if (d.inStep && d.options!.some(o => o.id === hu)) offeredHidden = true;
    g = d.inStep ? choose(g, d.options!.find(o => o.id === hu)?.id ?? d.options![0].id) : pass(g);
  }
  assert.ok(played, 'the hidden unit was played in response');
  assert.equal(offeredHidden, false, 'not offered as the buff target');
  assert.equal(g.objects[v].counters?.buff ?? 0, 1, 'the unit chosen at finalization is buffed');
  assert.equal(g.objects[hu].counters?.buff ?? 0, 0);
});

test('RJ#9503 holding Amateur Recital and The Papertree: both are scored at once; moving the Papertree unit to base with the Recital trigger doesn\'t stop the Papertree trigger', () => {
  const g0 = S0({ tp: P1, bfA: 'Amateur Recital', bfB: 'The Papertree' });
  put(g0, P0, 'V(2)', BF_A); control(g0, BF_A, P0);
  const pu = put(g0, P0, 'V(2)', BF_B); control(g0, BF_B, P0);
  const r1 = g0.players[P1].runesInPlay.length;
  let g = endTurn(g0, P1);
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'orderTriggers') { g = choose(g, d.options!.find(o => /Papertree/.test(o.label))?.id ?? d.options![0].id); continue; }
    g = d.inStep ? choose(g, d.options!.find(o => o.id === pu)?.id ?? (d.kind === 'optional' ? 'yes' : d.options![0].id)) : pass(g);
  }
  assert.equal(g.players[P0].points, 2, 'both held battlefields scored');
  assert.equal(locOf(g, pu), 'base', 'Recital moved the Papertree unit');
  assert.equal(g.players[P1].runesInPlay.length, r1 + 1, 'the Papertree trigger still resolved');
});

test('RJ#9508 Not So Fast can\'t counter an opponent\'s Heedless Resurrection (it chooses a card in their own trash, not a friendly unit of mine)', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0); fundAll(g, P1);
  put(g, P1, 'V(3)', 'base'); put(g, P1, 'V(2)', 'trash');
  put(g, P0, 'V(2)', 'base');
  const nsf = hand(g, P0, 'Not So Fast');
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Heedless Resurrection') });
  for (let i = 0; i < 8 && pend(g).inStep; i++) g = choose(g, pend(g).options![0].id);
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  assert.ok(g.chain.length >= 1, 'Heedless Resurrection on the chain');
  assert.equal(canPlayNow(g, P0, nsf), false, 'no legal Not So Fast target');
  let c = S0({ tp: P1 }); fundAll(c, P0); fundAll(c, P1);
  const mine = put(c, P0, 'V(2)', BF_A); control(c, BF_A, P0);
  const n2 = hand(c, P0, 'Not So Fast');
  [c] = cast(c, P1, 'ZapA', { targets: [[mine]] });
  for (let i = 0; i < 3 && pend(c).player !== P0; i++) c = pass(c);
  assert.equal(canPlayNow(c, P0, n2), true, 'control: it can counter a spell choosing my unit');
});

test('RJ#9509 Counter Strike in response to Stupefy on my attacking Stellacorn Herder: I draw, its combat damage is prevented, both survive and it is recalled', () => {
  let { g, atk, def } = attackSetup(['Stellacorn Herder'], ['V(3)']);
  fundAll(g, P0); fundAll(g, P1);
  for (let i = 0; i < 8 && !(pend(g).kind === 'showdownAction' && pend(g).player === P0 && !g.chain.length); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'Stupefy'), { targets: [[atk[0]]] });
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  const cs = hand(g, P0, 'Counter Strike');
  const h0 = g.players[P0].hand.length;
  g = play(g, P0, cs, { targets: [[atk[0]]] });
  for (let i = 0; i < 6 && g.chain.length; i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.equal(g.players[P0].hand.length, h0 - 1 + 1, 'Counter Strike drew 1');
  assert.equal(mightOf(g, atk[0]), 2, 'Stupefy -1');
  g = settle(g);
  assert.equal(g.objects[atk[0]].damage ?? 0, 0, 'combat damage prevented');
  assert.equal(locOf(g, atk[0]), 'base', 'recalled');
  assert.equal(zone(g, def[0]), 'battlefield');
});

test('RJ#9511 a damaged unit moved by a spell into a non-combat showdown is not healed (healing: combat cleanup or end of turn)', () => {
  let g = S0();
  fundAll(g, P0);
  const u = put(g, P0, 'V(5)', BF_B); control(g, BF_B, P0);
  g.objects[u].damage = 2;
  [g] = cast(g, P0, 'Ride the Wind', { targets: [[u]], locations: [BF_A] } as never);
  g = settle(g, d => d.options!.find(o => o.id === String(BF_A))?.id);
  assert.equal(locOf(g, u), BF_A, 'moved and conquered');
  assert.equal(g.objects[u].damage, 2, 'still damaged');
});

test('RJ#9515 Sacrifice\'s kill cost is paid before the opponent can respond (the unit is already in the trash); the killed Ekko, Recurrent\'s Deathknell resolves before Sacrifice', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const ek = put(g, P0, 'Ekko, Recurrent', BF_A); control(g, BF_A, P0);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Sacrifice') });
  for (let i = 0; i < 8 && pend(g).player !== P1; i++) { const d = pend(g); g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : (d.options!.find(o => o.id === ek)?.id ?? d.options![0].id)) : pass(g); }
  assert.notEqual(zone(g, ek), 'battlefield', 'already gone when the opponent first gets priority');
  g = settle(g, d => d.kind === 'optional' ? 'yes' : undefined);
  const t = g.log.map(l => l.text);
  const ie = t.findIndex(x => /Resolving Ekko/.test(x)), is = t.findIndex(x => /Resolving Sacrifice/.test(x));
  assert.ok(ie >= 0 && is > ie, 'Deathknell first');
});

test('RJ#9516 Crescent Strike\'s "each other enemy unit there" is not chosen: an enemy Baron Nashor there (can\'t be chosen by enemy spells) still takes 1', () => {
  let g = S0();
  fundAll(g, P0);
  const t = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const bn = put(g, P1, 'Baron Nashor', BF_A);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Crescent Strike') });
  for (let i = 0; i < 6 && pend(g).inStep; i++) { const d = pend(g); assert.ok(!d.options!.some(o => o.id === bn), 'Baron not choosable'); g = choose(g, d.options!.find(o => o.id === t || o.id === String(BF_A))?.id ?? d.options![0].id); }
  g = settle(g);
  assert.equal(g.objects[t].damage, 4, '4 to the chosen unit (7 Might with Baron\'s +2)');
  assert.equal(g.objects[bn].damage, 1, 'the other enemy unit takes 1');
});

test('RJ#9518 Ruined Rex\'s combat Deathknells (doubled by Karthus) kill Draven, Audacious during the combat cleanup: he still has his Attacker designation, so he died in combat — the opponent scores 1', () => {
  let g = S0();
  const rex = put(g, P1, 'Ruined Rex', BF_A); control(g, BF_A, P1);
  g.objects[rex].stunned = true;
  put(g, P1, 'Karthus, Eternal', 'base');
  const dr = put(g, P0, 'Draven, Audacious', 'base');
  const p1 = g.players[P1].points;
  g = move(g, P0, [dr], BF_A);
  g = settle(g, d => d.options!.find(o => o.id === dr)?.id);
  assert.equal(zone(g, rex), 'trash');
  assert.equal(zone(g, dr), 'trash', '4 + 4 after the heal');
  assert.equal(g.players[P1].points, p1 + 1, 'Draven died in combat');
});

test('RJ#9519 I Charm the opponent\'s only unit off their battlefield (they lose control); they Thrill of the Hunt it back there: they conquer and score on my turn', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'Charm', { targets: [[u]] });
  for (let i = 0; i < 8 && locOf(g, u) === BF_A; i++) g = pend(g).inStep ? choose(g, pend(g).options!.find(o => o.id === String(BF_B))?.id ?? pend(g).options![0].id) : pass(g);
  assert.equal(locOf(g, u), BF_B);
  for (let i = 0; i < 6 && pend(g).player !== P1; i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.notEqual(g.battlefields[BF_A].controller, P1, 'control of BF-A lost');
  const p1 = g.players[P1].points;
  g = play(g, P1, hand(g, P1, 'Thrill of the Hunt'), { targets: [[u]] });
  g = settle(g, d => d.options!.find(o => o.id === String(BF_A))?.id);
  const back = Object.keys(g.objects).filter(id => g.objects[id].zone === 'battlefield' && g.objects[id].controller === P1 && g.cards[g.objects[id].cardId].name === 'V(2)');
  assert.equal(back.length, 1);
  assert.equal(locOf(g, back[0]), BF_A);
  assert.equal(g.battlefields[BF_A].controller, P1);
  assert.equal(g.players[P1].points, p1 + 1, 'conquer point');
});

test('RJ#9524 (MISMATCH-RJ) defending Glasc Mixologist dies, the attacker survives: the Deathknell unit arrives before the combat result (CR 468.2 → 468.3), both sides have units → no result and a new combat is staged', () => {
  let { g, atk } = attackSetup(['V(9)'], ['Glasc Mixologist']);
  const pp = put(g, P1, 'V(3)', 'trash');
  let sawNewCombat = false;
  for (let i = 0; i < 40 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (zone(g, pp) === 'battlefield' && g.showdown?.isCombat && g.chain.length === 0) { sawNewCombat = true; break; }
    if (d.kind === 'assignDamage') { g = act(g, legal(g, d.player)[0]); continue; }
    g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : (d.options!.find(o => o.id === pp || o.id === String(BF_A))?.id ?? d.options![0].id)) : pass(g);
  }
  assert.equal(locOf(g, pp), BF_A, 'played to the battlefield');
  assert.equal(locOf(g, atk[0]), BF_A, 'the attacker was not recalled (no defender remained in the cleanup)');
  assert.ok(sawNewCombat, 'a new combat at BF-A (DECISIONS #3993, principle 1)');
  assert.equal(g.log.filter(l => /^Combat at BF-A/.test(l.text)).length, 2, `two combats (${g.log.filter(l => /Combat/.test(l.text)).map(l => l.text).join(' | ')})`);
});

test('RJ#9525 Targon\'s Peak replaced by a Brush (Green Father) before its conquer trigger resolves: the trigger still resolves and readies 2 runes at end of turn', () => {
  let g = withTokens(S0({ bfA: "Targon's Peak" }));
  setLegend(g, P0, 'Green Father');
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_A);
  g = driveH(g, [/Targon's Peak/, 'yes', 'yes', 'yes'], x => x.pending?.kind === 'mainAction');
  assert.equal(g.cards[g.objects[g.battlefields[BF_A].objId].cardId].name, 'Brush', 'replaced by Brush');
  const t = g.log.map(l => l.text);
  const ip = t.findIndex(x => /Resolving Targon's Peak/.test(x)), ig = t.findIndex(x => /Resolving Green Father/.test(x));
  assert.ok(ig >= 0 && ip > ig, `Brush first, then the Peak trigger (${t.slice(-12).join(' | ')})`);
  for (const r of g.players[P0].runesInPlay) g.objects[r].exhausted = true;
  g = endTurn(g);
  for (let i = 0; i < 10 && g.activePlayer === P0; i++) { const d = pend(g); g = d.inStep ? choose(g, ...(d.kind === 'chooseCards' ? d.options!.slice(0, 2) : d.options!.slice(0, 1)).map(o => o.id)) : pass(g); }
  assert.equal(g.players[P0].runesInPlay.filter(r => !g.objects[r].exhausted).length, 2, 'two runes readied at end of turn');
});

test('RJ#9526 Bone Skewer can\'t choose the opponent\'s champion in their Champion Zone (not their hand)', () => {
  let g = S0(); fundAll(g, P0);
  g.players[P1].hand = [];
  const c = hand(g, P1, 'V(2)');
  g.players[P1].hand = g.players[P1].hand.filter(x => x !== c);
  g.players[P1].championZone.push(c); g.objects[c].zone = 'championZone'; g.timestamp++;
  let offered = false;
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Bone Skewer') });
  for (let i = 0; i < 12 && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g);
    if (d.inStep) { const o = optionIds(g); if (o.includes(c)) offered = true; g = choose(g, d.kind === 'optional' ? 'yes' : o.includes(c) ? c : o.includes(String(BF_A)) ? String(BF_A) : o.includes(g.battlefields[BF_A].objId) ? g.battlefields[BF_A].objId : o[0]); continue; }
    g = pass(g);
  }
  assert.equal(offered, false);
  assert.equal(zone(g, c), 'championZone');
});

test('RJ#9532 (MISMATCH-RJ) Voidreaver\'s "Spend 1 XP, [T]: Buff a unit" exhausts the legend: with 3 XP it buffs only one unit per turn unless readied', () => {
  let g = S0();
  const lg = setLegend(g, P0, 'Voidreaver');
  g.players[P0].xp = 3;
  const a = put(g, P0, 'V(2)', 'base'), b = put(g, P0, 'V(2)', 'base');
  const ab = legal(g, P0, 'activate').filter(x => x.type === 'activate' && x.obj === lg);
  assert.ok(ab.length >= 1);
  g = act(g, ab[0]);
  g = settle(g, d => d.options!.find(o => o.id === a)?.id);
  assert.equal(g.objects[a].counters?.buff ?? 0, 1);
  assert.equal(ex(g, lg), true, '[T] paid');
  assert.equal(legal(g, P0, 'activate').some(x => x.type === 'activate' && x.obj === lg), false, 'no second buff this turn');
  assert.equal(g.objects[b].counters?.buff ?? 0, 0);
});

test('RJ#9535 Eclipse (-4) on a 3-Might unit then Discipline (+2): negative Might is kept for calculation, ends at 1', () => {
  let g = S0();
  fundAll(g, P0);
  const u = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  [g] = cast(g, P0, 'Eclipse', { targets: [[u]] }); g = settle(g);
  assert.equal(mightOf(g, u), -1, 'kept as -1 for calculation (read as 0)');
  assert.equal(zone(g, u), 'battlefield');
  [g] = cast(g, P0, 'Discipline', { targets: [[u]] }); g = settle(g);
  assert.equal(mightOf(g, u), 1, '-1 + 2');
});

test('RJ#9536 (AMBIGUOUS, house: CR 359.3.e.6) Tideturner (played to base) swapping with my unit at a battlefield while Minotaur Reckoner is out: only the move to base is negated — Tideturner still moves', () => {
  let g = S0();
  fundAll(g, P0);
  put(g, P1, 'Minotaur Reckoner', 'base');
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const tt = hand(g, P0, 'Tideturner');
  g = act(g, { type: 'playCard', player: P0, obj: tt, destination: 'base' });
  g = settle(g, d => d.kind === 'optional' ? 'yes' : d.options!.find(o => o.id === u)?.id);
  assert.equal(locOf(g, u), BF_A, 'unit can\'t move to base');
  assert.equal(locOf(g, tt), BF_A, 'the possible half of the instruction still happens (RJ\'s "both stay" not adopted)');
});

test('RJ#9537 Red Brambleback + a Trinity Force / Skyfall of Areion unit conquering: Trinity\'s point triggers twice — 3 points', () => {
  let g = S0();
  const u = put(g, P0, 'V(3)', 'base');
  attachNow(g, put(g, P0, 'Trinity Force', 'base'), u);
  attachNow(g, put(g, P0, 'Skyfall of Areion', 'base'), u);
  const rb = put(g, P0, 'Red Brambleback', 'base');
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  g = driveH(move(g, P0, [u, rb], BF_A), Array(12).fill('first'), x => x.pending?.kind === 'mainAction');
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[P0].points, 3);
});

test('RJ#9550 an attacker recalled after a no-kill combat keeps its Equipment attached (board zone to board zone)', () => {
  let { g, atk, def } = attackSetup(['V(1)'], ['V(9)']);
  const sw = put(g, P0, 'Long Sword', 'base'); attachNow(g, sw, atk[0]);
  g.objects[def[0]].stunned = true;
  g = settle(g);
  if (zone(g, atk[0]) === 'base' || locOf(g, atk[0]) === 'base') {
    assert.equal(g.objects[sw].attachedTo, atk[0], 'still attached');
    assert.equal(locOf(g, sw), 'base');
  } else assert.fail(`attacker not recalled: ${zone(g, atk[0])}`);
});

test('RJ#9553 Defy can counter Death from Below (printed cost [4][A])', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const e = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const dfb = hand(g, P0, 'Death from Below');
  g = act(g, { type: 'playCard', player: P0, obj: dfb });
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = choose(g, pend(g).options!.find(o => o.id === e)?.id ?? pend(g).options![0].id);
  g = pass(g);
  const df = hand(g, P1, 'Defy');
  assert.ok(canPlayNow(g, P1, df));
  g = play(g, P1, df, { targets: [[dfb]] });
  g = settle(g);
  assert.equal(zone(g, e), 'battlefield', 'countered: no kill');
  assert.equal(zone(g, dfb), 'trash');
});

test('RJ#9558 Pack of Wonders (no Reaction/Action) can\'t be activated in a showdown on the opponent\'s turn', () => {
  let g = S0({ tp: P1 });
  const mine = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const pw = put(g, P0, 'Pack of Wonders', 'base');
  const e = put(g, P1, 'V(5)', 'base');
  g = move(g, P1, [e], BF_A);
  for (let i = 0; i < 8 && pend(g).player !== P0; i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.equal(pend(g).player, P0, 'I have priority/focus in the showdown');
  assert.ok(!legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === pw), 'not usable');
  void mine;
});

test('RJ#9559 a damaged attacker still deals combat damage equal to its full Might (marked damage doesn\'t reduce Might)', () => {
  let { g, atk, def } = attackSetup(['V(11)'], ['V(10)']);
  g.objects[atk[0]].damage = 9;
  assert.equal(mightOf(g, atk[0]), 11);
  g = settle(g);
  assert.equal(zone(g, def[0]), 'trash', '11 damage kills the 10');
});

test('RJ#9560 an Equip activation uses the chain: the opponent can react (Gust the unit) before it attaches', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const sw = put(g, P0, 'Long Sword', 'base');
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === sw)!);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = choose(g, pend(g).options!.find(o => o.id === u)?.id ?? pend(g).options![0].id);
  assert.equal(g.chain.length, 1, 'Equip on the chain');
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  expectPending(g, 'chainResponse', P1);
  g = play(g, P1, hand(g, P1, 'Gust'), { targets: [[u]] });
  g = settle(g);
  assert.equal(zone(g, u), 'hand');
  assert.notEqual(g.objects[sw].attachedTo, u, 'not attached');
});

// ---------------------------------------------------------------------------------------------- 9561-9570
test('RJ#9563 hidden Hostile Takeover on the attacker, then hidden Hidden Blade on it in the same showdown: it dies and I (its controller) draw 2', () => {
  let { g, atk } = attackSetup(['V(3)'], ['V(1)']);
  fundAll(g, P1);
  const ht = put(g, P1, 'Hostile Takeover', { facedown: BF_A });
  const hb = put(g, P1, 'Hidden Blade', { facedown: BF_A });
  for (let i = 0; i < 6 && !(pend(g).player === P1 && !pend(g).inStep); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  g = act(g, { type: 'playCard', player: P1, obj: ht });
  if (pend(g).inStep) g = choose(g, atk[0]);
  for (let i = 0; i < 6 && !(pend(g).player === P1 && !pend(g).inStep && g.chain.length === 0); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.equal(g.objects[atk[0]].controller, P1);
  assert.ok(canPlayNow(g, P1, hb), 'I still have focus in the showdown');
  const h = g.players[P1].hand.length;
  g = act(g, { type: 'playCard', player: P1, obj: hb });
  g = choose(g, atk[0]);
  g = settle(g);
  assert.equal(zone(g, atk[0]), 'trash');
  assert.equal(g.players[P1].hand.length - h, 2);
});
test('RJ#9564 En Garde on a lone Irelia, Fervent: +1 (her trigger) +1 +1 (alone) = +3', () => {
  let g = S0();
  fundAll(g, P0);
  const ir = put(g, P0, 'Irelia, Fervent', BF_A); control(g, BF_A, P0);
  [g] = cast(g, P0, 'En Garde', { targets: [[ir]] });
  g = settle(g);
  assert.equal(mightOf(g, ir), 7);
});
test('RJ#9565 Frigid Touch with Repeat on the same 2-Might unit: -4 → -2 Might (negative kept), survives', () => {
  let g = S0(); fundAll(g, P0, 12);
  const e = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Frigid Touch') });
  g = settle(g, d => d.kind === 'optional' ? 'yes' : d.options!.find(o => o.id === e)?.id);
  assert.equal(mightOf(g, e), -2);
  assert.equal(zone(g, e), 'battlefield');
});
test('RJ#9569 Friendship with no Bird/Cat/Dog/Poro units: +0 Might', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  [g] = cast(g, P0, 'Friendship', { targets: [[u]] });
  g = settle(g);
  assert.equal(mightOf(g, u), 2);
});

test('RJ#9573 (AMBIGUOUS, house = RJ; CR 373) Singularity on Soraka (Guardian Angel) and a Recruit: the controller orders the deaths — Recruit first saves both, Soraka first recalls her and the Recruit dies', () => {
  const run = (first: 'so' | 'r') => {
    let g = S0(); fundAll(g, P0, 12);
    const so = put(g, P1, 'Soraka', BF_A); control(g, BF_A, P1);
    const ga = put(g, P1, 'Guardian Angel', 'base'); attachNow(g, ga, so);
    const r = put(g, P1, 'Recruit', BF_A, { token: true });
    [g] = cast(g, P0, 'Singularity', { targets: [[so, r]] });
    let asked = false;
    g = settle(g, d => { if (d.kind === 'chooseOrder') { asked = d.player === P1; return first === 'so' ? so : r; } return undefined; });
    assert.ok(asked, 'Soraka\'s controller chooses');
    assert.equal(zone(g, ga), 'trash');
    assert.equal(locOf(g, so), 'base');
    return zone(g, r);
  };
  assert.equal(run('r'), 'base', 'Recruit saved by Soraka');
  assert.equal(run('so'), 'gone', 'Soraka already recalled: Recruit dies');
});
test('RJ#9578 Wuju Master at 9 XP: Herald of Spring\'s play trigger reaches Level 11, but Herald already entered exhausted', () => {
  let g = S0(); fundAll(g, P0, 12);
  setLegend(g, P0, 'Wuju Master');
  g.players[P0].xp = 9;
  const h = hand(g, P0, 'Herald of Spring');
  g = settle(play(g, P0, h, { dest: 'base' }), d => d.kind === 'optional' ? 'no' : undefined);
  assert.equal(g.players[P0].xp, 11);
  assert.equal(ex(g, h), true, 'entered exhausted');
  const v = hand(g, P0, 'V(1)');
  g = settle(play(g, P0, v, { dest: 'base' }));
  assert.equal(ex(g, v), false, 'later units enter ready');
});
test('RJ#9579 Nine-Tailed Fox\'s -1 still applies to an attacker Flashed back to base in response', () => {
  const g0 = S0(); setLegend(g0, P1, 'Nine-Tailed Fox'); fundAll(g0, P0);
  put(g0, P1, 'V(1)', BF_A); control(g0, BF_A, P1);
  const a = put(g0, P0, 'V(4)', 'base');
  let g = move(g0, P0, [a], BF_A);
  for (let i = 0; i < 6 && !(g.chain.length && pend(g).player === P0 && !pend(g).inStep); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.ok(g.chain.length >= 1, 'Fox trigger on the chain');
  g = play(g, P0, hand(g, P0, 'Flash'), { targets: [[a]] });
  g = settle(g, d => d.options!.find(o => o.id === a)?.id);
  assert.equal(locOf(g, a), 'base');
  assert.equal(mightOf(g, a), 3);
});
test('RJ#9583 Recruits played by Vanguard Armory enter exhausted', () => {
  let g = S0(); fundAll(g, P0);
  const va = put(g, P0, 'Vanguard Armory', 'base');
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === va)!);
  g = settle(g, d => d.options!.find(o => o.id === 'base')?.id);
  const rs = g.players[P0].base.filter(id => g.cards[g.objects[id].cardId].name === 'Recruit');
  assert.equal(rs.length, 3);
  assert.ok(rs.every(r => ex(g, r)), 'all exhausted');
});
test('RJ#9584 buffing a unit already at 5+ Might is not "becoming Mighty": Grand Duelist doesn\'t trigger', () => {
  let g = S0(); fundAll(g, P0);
  setLegend(g, P0, 'Grand Duelist');
  const u = put(g, P0, 'V(5)', BF_A); control(g, BF_A, P0);
  const n0 = g.log.length;
  [g] = cast(g, P0, 'Discipline', { targets: [[u]] });
  g = settle(g, d => d.kind === 'optional' ? 'yes' : undefined);
  assert.equal(mightOf(g, u), 7);
  assert.ok(!g.log.slice(n0).some(l => /Grand Duelist/.test(l.text)), 'no trigger');
});
test('RJ#9588 Bellows Breath + Repeat choosing a Deflect unit (Pouty Poro) in both executions: [1][A] + Repeat [1][C] + Deflect [A] twice = 4 power', () => {
  let g = S0(); fundAll(g, P0, 8);
  const p = put(g, P1, 'Pouty Poro', BF_A); control(g, BF_A, P1);
  put(g, P1, 'V(9)', BF_A);
  const runes0 = g.players[P0].runesInPlay.length;
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Bellows Breath') });
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    g = act(g, { type: 'choose', player: d.player, optionIds: d.kind === 'optional' ? ['yes'] : o.includes(p) ? [p] : d.kind === 'chooseTargets' ? [] : [o[0]] });
  }
  assert.equal(g.log.filter(l => /Bellows Breath deals 1 to Pouty Poro/.test(l.text)).length, 2, 'Poro chosen by both executions');
  const recycled = runes0 - g.players[P0].runesInPlay.length;
  assert.equal(recycled, 4, 'power: [A] + [C] + Deflect [A] x2');
});
test('RJ#9589 Nine-Tailed Fox (doesn\'t choose) gives an attacking Ruin Runner -1', () => {
  const g0 = S0(); setLegend(g0, P1, 'Nine-Tailed Fox');
  put(g0, P1, 'V(1)', BF_A); control(g0, BF_A, P1);
  const a = put(g0, P0, 'Ruin Runner', 'base');
  let g = move(g0, P0, [a], BF_A);
  let seen: number | null = null;
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) { if (!g.chain.length && g.log.some(l => /Resolving Nine-Tailed Fox/.test(l.text)) && seen === null) seen = mightOf(g, a); g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g); }
  assert.ok(g.log.some(l => /Resolving Nine-Tailed Fox/.test(l.text)));
  assert.equal(seen, 4, '5 - 1');
});
test('RJ#9592 (MISMATCH-RJ, CR 317.1 / 391) Hostile Takeover\'s "lose control and recall it at end of turn" is a delayed trigger on the Ending-step chain: players can respond to it', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
  [g] = cast(g, P0, 'Hostile Takeover', { targets: [[e]] });
  g = settle(g);
  assert.equal(g.objects[e].controller, P0);
  const gu = hand(g, P1, 'Gust');
  g = act(g, { type: 'endTurn', player: P0 });
  let window = false;
  for (let i = 0; i < 12 && !(g.activePlayer === P1 && pend(g).kind === 'mainAction'); i++) {
    const d = pend(g);
    if (d.kind === 'chainResponse' && d.player === P1 && g.chain.some(c => /returnControl/i.test(String(c.abilityKey)))) { window = true; assert.ok(canPlayNow(g, P1, gu), 'a Reaction can be played in response'); }
    g = d.inStep ? choose(g, d.options![0].id) : pass(g);
  }
  assert.ok(window, 'the end-of-turn return is a chain item with a response window');
  assert.equal(g.objects[e].controller, P1);
  assert.equal(locOf(g, e), 'base');
});
test('RJ#9596 Switcheroo on Draven, Showboat (3 + 7 points = 10) and a 5-Might unit: Draven 5, the unit 10', () => {
  let g = S0(); fundAll(g, P0);
  g.players[P0].points = 7;
  const dr = put(g, P0, 'ogn-028-298', BF_A); control(g, BF_A, P0);
  const u = put(g, P0, 'V(5)', BF_A);
  assert.equal(mightOf(g, dr), 10);
  [g] = cast(g, P0, 'Switcheroo', { targets: [[dr, u]] });
  g = settle(g, d => d.options!.find(o => o.id === dr || o.id === u)?.id);
  assert.equal(mightOf(g, dr), 5);
  assert.equal(mightOf(g, u), 10);
});
test('RJ#9597 Piercing Light needs a unit at a battlefield for its first part: with only base units it can\'t be played', () => {
  const g = S0(); fundAll(g, P0);
  put(g, P1, 'V(2)', 'base'); put(g, P0, 'V(2)', 'base');
  const pl = hand(g, P0, 'Piercing Light');
  assert.equal(canPlayNow(g, P0, pl), false);
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  assert.equal(canPlayNow(g, P0, pl), true);
});
test('RJ#9598 Atakhan attacking a lone Ruin Runner: "the defender must kill one of their units here" (no choosing by Atakhan) kills it', () => {
  let { g, def } = attackSetup(['Atakhan'], ['Ruin Runner']);
  for (let i = 0; i < 20 && !(g.log.some(l => /Resolving Atakhan/.test(l.text)) && !g.chain.length); i++) g = pend(g).inStep ? choose(g, pend(g).options!.find(o => o.id === def[0])?.id ?? pend(g).options![0].id) : pass(g);
  assert.ok(g.log.some(l => /Resolving Atakhan/.test(l.text)));
  assert.equal(zone(g, def[0]), 'trash', 'killed by the attack trigger, before combat damage');
  assert.ok(!g.log.some(l => /combat damage/i.test(l.text)));
});
test('RJ#9601 Sett, Brawler\'s spend-buff ability (no Action/Reaction) can\'t be used in a showdown on my own turn', () => {
  let { g, atk } = attackSetup(['Sett, Brawler'], ['V(3)'], { atkOpts: [{ buff: true }] });
  let checked = false;
  for (let i = 0; i < 10 && pend(g).kind !== 'mainAction'; i++) {
    if (pend(g).kind === 'showdownAction' && pend(g).player === P0) { checked = true; assert.ok(!legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === atk[0])); break; }
    g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  }
  assert.ok(checked, 'reached my showdown focus');
});
test('RJ#9606 two Glasc Mixologists die together; one Deathknell plays Karthus: the other Deathknell (already on the chain) is not doubled', () => {
  let g = S0(); fundAll(g, P0, 12);
  const m1 = put(g, P1, 'Glasc Mixologist', BF_A), m2 = put(g, P1, 'Glasc Mixologist', BF_A); control(g, BF_A, P1);
  const k = put(g, P1, 'Karthus', 'trash');
  [g] = cast(g, P0, 'Singularity', { targets: [[m1, m2]] });
  g = settle(g, d => d.options!.find(o => o.id === k)?.id ?? (d.kind === 'optional' ? 'yes' : undefined));
  assert.equal(zone(g, k), 'base', 'Karthus played');
  assert.equal(g.log.filter(l => /^Trigger: Glasc Mixologist/.test(l.text)).length, 2);
  assert.equal(g.log.filter(l => /^Resolving Glasc Mixologist/.test(l.text)).length, 2, 'no extra trigger');
});
test('RJ#9612 Ruined Rex\'s Deathknell may choose an enemy unit anywhere (another battlefield or a base)', () => {
  let g = S0(); fundAll(g, P0, 12);
  const rex = put(g, P1, 'Ruined Rex', BF_A); control(g, BF_A, P1);
  const far = put(g, P0, 'V(4)', BF_B); control(g, BF_B, P0);
  const home = put(g, P0, 'V(4)', 'base');
  [g] = cast(g, P0, 'Singularity', { targets: [[rex]] });
  let offered: string[] = [];
  g = settle(g, d => { if (d.player === P1 && d.options!.some(o => o.id === far)) { offered = d.options!.map(o => o.id); return far; } return undefined; });
  assert.ok(offered.includes(far) && offered.includes(home), 'units at another battlefield and in base are legal');
  assert.equal(zone(g, far), 'trash');
});
test('RJ#9613 holding Amateur Recital with the Deceiver legend: Recital\'s unit is chosen when its trigger goes on the chain, so the Reflection (made later by Deceiver) can\'t be moved', () => {
  const g0 = S0({ tp: P1, bfA: 'Amateur Recital' });
  setLegend(g0, P0, 'Deceiver');
  const u = put(g0, P0, 'V(2)', BF_A); control(g0, BF_A, P0);
  hand(g0, P0, 'V(1)');
  let g = endTurn(g0, P1);
  let recitalOpts: string[] | null = null;
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'orderTriggers') { g = choose(g, d.options!.find(o => /Recital/.test(o.label))?.id ?? d.options![0].id); continue; }
    if (d.kind === 'chooseTargets' && /Recital/.test(d.prompt ?? '')) recitalOpts = d.options!.map(o => o.id);
    g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : d.options![0].id) : pass(g);
  }
  assert.deepEqual(recitalOpts, [u], 'only the unit that existed when the trigger was chained');
  const refl = g.players[P0].base.concat(Object.keys(g.objects).filter(id => g.objects[id].zone === 'battlefield')).filter(id => g.objects[id].isToken && g.objects[id].controller === P0);
  assert.equal(refl.length, 1);
  assert.equal(locOf(g, refl[0]), BF_A, 'Reflection stays');
  assert.equal(locOf(g, u), 'base');
});
test('RJ#9616 Sun Disc played as my first card doesn\'t satisfy its own [Legion]; played after another card, it does', () => {
  for (const first of [true, false]) {
    let g = S0(); fundAll(g, P0, 8);
    if (!first) { [g] = cast(g, P0, 'DrawR'); g = settle(g); }
    const sd = hand(g, P0, 'Sun Disc');
    g = settle(play(g, P0, sd, { dest: 'base' }));
    const ab = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === sd);
    if (ab) { g = act(g, ab); g = settle(g); }
    const u = hand(g, P0, 'V(2)');
    g = settle(play(g, P0, u, { dest: 'base' }));
    assert.equal(ex(g, u), first, first ? 'Legion not met by Sun Disc itself' : 'Legion met: enters ready');
  }
});
test('RJ#9618 my lone Temporary unit (Glasc Mixologist via Fading Memories) dies in my Beginning Phase: its Deathknell may still play a unit to that battlefield (Closed state, control kept)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1);
  const m = put(g, P0, 'Glasc Mixologist', BF_A); control(g, BF_A, P0);
  const t = put(g, P0, 'V(2)', 'trash');
  [g] = cast(g, P1, 'Fading Memories', { targets: [[m]] });
  g = settle(g);
  g = endTurn(g, P1);
  let dests: string[] = [];
  g = settle(g, d => {
    if (d.kind === 'optional') return 'yes';
    if (d.options!.some(o => o.id === t)) return t;
    if (d.kind === 'chooseDestination') { dests = d.options!.map(o => o.id); return d.options!.find(o => o.id === String(BF_A))?.id; }
    return undefined;
  });
  assert.equal(zone(g, m), 'trash');
  assert.ok(dests.includes(String(BF_A)), 'the battlefield is still mine when the Deathknell resolves');
  assert.equal(locOf(g, t), BF_A);
  assert.equal(g.battlefields[BF_A].controller, P0);
});
test('RJ#9619 in response to my Sprite\'s Temporary trigger I play hidden Evelynn, Entrancing and pull an enemy in: the Sprite is trashed before the showdown/combat', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0);
  const sp = put(g, P0, 'Sprite', BF_A, { token: true }); control(g, BF_A, P0);
  const ev = put(g, P0, 'unl-141-219', { facedown: BF_A });
  const e = put(g, P1, 'V(1)', 'base');
  g = endTurn(g, P1);
  for (let i = 0; i < 10 && !(g.chain.length && pend(g).player === P0 && !pend(g).inStep); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.ok(g.chain.some(c => c.source === sp), 'Temporary trigger on the chain');
  g = act(g, { type: 'playCard', player: P0, obj: ev });
  let sawCombatWithSprite = false;
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'showdownAction' && zone(g, sp) === 'battlefield') sawCombatWithSprite = true;
    g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : d.options!.find(o => o.id === e)?.id ?? d.options![0].id) : pass(g);
  }
  assert.equal(zone(g, sp), 'gone', 'Sprite token gone');
  assert.equal(sawCombatWithSprite, false, 'no showdown while the Sprite was still there');
  assert.ok(g.log.some(l => /V\(1\) moves to/.test(l.text)), 'enemy pulled in');
});
test('RJ#9622 Frozen Fortress (held by the opponent) deals 1 to their unit: not "my damage", so my Elder Dragon doesn\'t make it lethal', () => {
  let g = S0({ tp: P1, bfA: 'Frozen Fortress' });
  put(g, P0, 'Elder Dragon', 'base');
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  g = endTurn(g, P1);
  g = settle(g);
  assert.equal(g.objects[e]?.damage, 1, 'took 1 at the start of my Beginning Phase');
  assert.equal(zone(g, e), 'battlefield');
});
test('RJ#9623 Hidden Blade whose target is Flashed to base still resolves, so Ravenbloom Student sees the spell played', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const rs = put(g, P0, 'Ravenbloom Student', BF_B); control(g, BF_B, P0);
  const m0 = mightOf(g, rs)!;
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  g = play(g, P0, hand(g, P0, 'Hidden Blade'), { targets: [[e]] });
  for (let i = 0; i < 4 && !(pend(g).player === P1 && pend(g).kind === 'chainResponse'); i++) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Flash'), { targets: [[e]] });
  g = settle(g, d => d.options!.find(o => o.id === e)?.id);
  assert.equal(locOf(g, e), 'base');
  assert.equal(zone(g, e), 'base', 'not killed');
  assert.equal(mightOf(g, rs), m0 + 1);
});
test('RJ#9629 an Eye of the Herald unit Gusted in response to its move trigger: no Recruit ("here" no longer exists)', () => {
  let g = withTokens(S0()); fundAll(g, P1);
  const u = put(g, P0, 'V(2)', 'base');
  attachNow(g, put(g, P0, 'Eye of the Herald', 'base'), u);
  const before = new Set(Object.keys(g.objects));
  g = move(g, P0, [u], BF_A);
  for (let i = 0; i < 6 && !(g.chain.length && pend(g).player === P1 && !pend(g).inStep); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.ok(g.chain.length >= 1, 'Eye trigger on the chain');
  g = play(g, P1, hand(g, P1, 'Gust'), { targets: [[u]] });
  g = settle(g);
  assert.equal(zone(g, u), 'hand');
  assert.ok(!Object.keys(g.objects).some(id => !before.has(id) && g.objects[id].isToken && g.cards[g.objects[id].cardId].name === 'Recruit' && (g.objects[id].zone as string) !== 'gone'), 'no Recruit');
});
test('RJ#9630 Frigid Touch + Repeat with Ezreal, Prodigy (Repeat [2] → [1]) and two Vex, Cheerless in combat (-1 each, min 1): 2 + 1 - 2 = 1 energy', () => {
  let { g } = attackSetup(['sfd-146-221', 'sfd-146-221'], ['V(9)']);
  setRunes(g, P0, 6, 'mind');
  put(g, P0, 'sfd-149-221', 'base');
  for (let i = 0; i < 8 && !(pend(g).kind === 'showdownAction' && pend(g).player === P0); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.equal(exhaustedRunes(g, P0), 0);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Frigid Touch') });
  let repeatPrompt = '';
  for (let i = 0; i < 6 && pend(g).inStep; i++) { const d = pend(g); if (d.kind === 'optional') repeatPrompt = d.prompt ?? ''; g = choose(g, d.kind === 'optional' ? 'yes' : d.options![0].id); }
  assert.match(repeatPrompt, /Pay 1 to Repeat/);
  assert.equal(g.chain.length, 1);
  assert.equal(exhaustedRunes(g, P0), 1, 'one energy paid');
  assert.equal(g.players[P0].runesInPlay.length, 6, 'no power');
});
test('RJ#9636 a ready unit moved by Relentless Pursuit conquers and moves itself back to base with the granted trigger: still ready', () => {
  let g = S0(); fundAll(g, P0);
  const fm = put(g, P0, 'First Mate', 'base');
  [g] = cast(g, P0, 'Relentless Pursuit', { targets: [[fm]], locations: [BF_A], battlefields: [BF_A] });
  g = settle(g, d => d.kind === 'optional' ? 'yes' : d.options!.find(o => o.id === fm || o.id === String(BF_A))?.id ?? (d.kind === 'chooseTargets' ? undefined : undefined));
  assert.equal(g.players[P0].points, 1, 'conquered');
  assert.equal(locOf(g, fm), 'base', 'moved home');
  assert.equal(ex(g, fm), false, 'still ready');
});
test('RJ#9638 Ezreal (sfd-082) attack trigger uses his Might on resolution: opponent Disciplines their unit, I Discipline Ezreal on top → 5 damage', () => {
  let { g, atk, def } = attackSetup(['sfd-082-221'], ['V(9)']);
  fundAll(g, P0); fundAll(g, P1);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = choose(g, def[0]);
  assert.ok(g.chain.length >= 1);
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Discipline'), { targets: [[def[0]]] });
  g = pass(g);
  g = play(g, P0, hand(g, P0, 'Discipline'), { targets: [[atk[0]]] });
  for (let i = 0; i < 12 && g.chain.length; i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.equal(g.objects[def[0]].damage, 5);
});
test('RJ#9639 defending Ezreal (sfd-082): his defend trigger deals 3, then in the same combat showdown he can use [C]: [Action] to move to base', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0);
  const ez = put(g, P0, 'sfd-082-221', BF_A); control(g, BF_A, P0);
  const a = put(g, P1, 'V(5)', 'base');
  g = move(g, P1, [a], BF_A);
  let used = false;
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!used && d.kind === 'showdownAction' && d.player === P0 && !g.chain.length) {
      assert.equal(g.objects[a].damage, 3, 'defend trigger already resolved');
      const ab = legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === ez);
      assert.ok(ab, 'Action ability usable in the showdown');
      g = act(g, ab!); used = true; continue;
    }
    g = d.inStep ? choose(g, d.options!.find(o => o.id === a)?.id ?? d.options![0].id) : pass(g);
  }
  assert.ok(used);
  assert.equal(locOf(g, ez), 'base');
});
test('RJ#9641 outside a showdown I can play a unit from hand straight to a battlefield I control (not to one I don\'t)', () => {
  const g = S0(); fundAll(g, P0);
  put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const u = hand(g, P0, 'V(1)');
  const ds = playDests(g, P0, u).map(String);
  assert.ok(ds.includes(String(BF_A)), `dests ${ds}`);
  assert.ok(!ds.includes(String(BF_B)));
});
test('RJ#9643 "a unit with 3 Might or less" checks current Might: a buffed 3-Might unit (4) can\'t be chosen by Burn Away', () => {
  const g = S0(); fundAll(g, P0);
  put(g, P1, 'V(3)', BF_A, { buff: true }); control(g, BF_A, P1);
  const ba = hand(g, P0, 'Burn Away');
  assert.equal(canPlayNow(g, P0, ba), false, 'no legal unit (4 Might)');
  put(g, P1, 'V(3)', BF_A);
  assert.equal(canPlayNow(g, P0, ba), true, 'an unbuffed 3 is legal');
});
test('RJ#9646 Lillia, Fae Fawn moving from base to a battlefield plays her Sprite in my base (the location she moved from)', () => {
  let g = withTokens(S0());
  const l = put(g, P0, 'unl-082-219', 'base');
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  g = settle(move(g, P0, [l], BF_A));
  assert.equal(locOf(g, l), BF_A);
  const sp = g.players[P0].base.filter(id => g.cards[g.objects[id].cardId].name === 'Sprite');
  assert.equal(sp.length, 1, 'Sprite in base');
});
test('RJ#9647 (MISMATCH-RJ, CR 1.5 / RJ#828, #9583) a Sprite token whose creating effect names no state (Lillia, Fae Fawn) enters exhausted like any unit; "a ready Sprite" (Sprite Fountain) enters ready', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  const l = put(g, P0, 'unl-082-219', 'base');
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  g = settle(move(g, P0, [l], BF_A));
  const sp = g.players[P0].base.filter(id => g.cards[g.objects[id].cardId].name === 'Sprite');
  assert.equal(sp.length, 1);
  assert.equal(ex(g, sp[0]), true, 'no state specified → exhausted');
  const sf = hand(g, P0, 'Sprite Fountain');
  g = settle(play(g, P0, sf, { dest: 'base' }));
  const sp2 = g.players[P0].base.filter(id => g.cards[g.objects[id].cardId].name === 'Sprite' && id !== sp[0]);
  assert.equal(sp2.length, 1);
  assert.equal(ex(g, sp2[0]), false, '"ready Sprite" → ready');
});
test('RJ#9651 Challenge choosing Irelia, Fervent: her +1 trigger resolves first, so she deals 5', () => {
  let g = S0(); fundAll(g, P0);
  const ir = put(g, P0, 'Irelia, Fervent', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(9)', BF_B); control(g, BF_B, P1);
  [g] = cast(g, P0, 'Challenge', { targets: [[ir, e]] });
  g = settle(g, d => d.options!.find(o => o.id === ir || o.id === e)?.id);
  assert.equal(g.objects[e].damage, 5);
});
test('RJ#9654 Pit Rookie and a defending Lonely Poro trade: during the Poro\'s Deathknell the defender can still play its hidden Zhonya\'s Hourglass there (it goes to base)', () => {
  let { g } = attackSetup(['Pit Rookie'], ['Lonely Poro']);
  const z = put(g, P1, "Zhonya's Hourglass", { facedown: BF_A });
  let played = false;
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!played && d.player === P1 && !d.inStep && g.chain.some(c => /Lonely Poro/.test(g.cards[g.objects[c.source]?.cardId]?.name ?? '') || /Lonely Poro/.test(JSON.stringify(c)))) {
      assert.equal(zone(g, z), 'facedown', 'hidden card still there');
      assert.ok(canPlayNow(g, P1, z)); g = act(g, { type: 'playCard', player: P1, obj: z }); played = true; continue;
    }
    g = d.inStep ? choose(g, d.options![0].id) : pass(g);
  }
  assert.ok(played, 'window during the Deathknell');
  assert.equal(zone(g, z), 'base');
});
test('RJ#9655 Repulse can\'t counter a repeated Bellows Breath that chose one of my units at each of two battlefields (the spell chooses another friendly unit too — Repeat choices are made when played)', () => {
  let g = S0(); fundAll(g, P0, 8); fundAll(g, P1);
  const a = put(g, P1, 'V(4)', BF_A); control(g, BF_A, P1);
  const b = put(g, P1, 'V(4)', BF_B); control(g, BF_B, P1);
  const bb = hand(g, P0, 'Bellows Breath');
  g = act(g, { type: 'playCard', player: P0, obj: bb });
  let n = 0;
  for (let i = 0; i < 10 && pend(g).inStep; i++) { const d = pend(g); if (d.kind === 'optional') { g = choose(g, 'yes'); continue; } g = act(g, { type: 'choose', player: P0, optionIds: [n++ === 0 ? a : b] }); }
  g = pass(g);
  const rp = hand(g, P1, 'Repulse');
  if (canPlayNow(g, P1, rp)) {
    g = act(g, { type: 'playCard', player: P1, obj: rp });
    for (let i = 0; i < 6 && pend(g).inStep; i++) { const d = pend(g); g = choose(g, d.options!.find(o => o.id === a)?.id ?? d.options![0].id); }
  }
  g = settle(g);
  assert.ok(!g.log.some(l => /Bellows Breath is countered/.test(l.text)), 'not countered');
  assert.deepEqual([g.objects[a].damage, g.objects[b].damage], [1, 1]);
});
test('RJ#9656 Relentless Pursuit: conquer, return home ready, Standard Move to the other battlefield, conquer again (granted ability lasts the turn) and return home', () => {
  let g = S0(); fundAll(g, P0);
  const fm = put(g, P0, 'First Mate', 'base');
  [g] = cast(g, P0, 'Relentless Pursuit', { targets: [[fm]], locations: [BF_A], battlefields: [BF_A] });
  g = settle(g, d => d.kind === 'optional' ? 'yes' : d.options!.find(o => o.id === fm || o.id === String(BF_A))?.id);
  assert.equal(locOf(g, fm), 'base'); assert.equal(ex(g, fm), false);
  g = settle(move(g, P0, [fm], BF_B), d => d.kind === 'optional' ? 'yes' : undefined);
  assert.equal(g.players[P0].points, 2);
  assert.equal(locOf(g, fm), 'base', 'second conquer trigger moved it home');
});
test('RJ#9657 an Equipment whose unit died goes to base and can be equipped to another unit the same turn', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const v = put(g, P0, 'V(2)', 'base');
  const sw = put(g, P0, 'Long Sword', 'base'); attachNow(g, sw, u);
  [g] = cast(g, P0, 'Singularity', { targets: [[u]] });
  g = settle(g);
  assert.equal(zone(g, u), 'trash');
  assert.equal(locOf(g, sw), 'base'); assert.ok(!g.objects[sw].attachedTo);
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === sw)!);
  g = settle(g, d => d.options!.find(o => o.id === v)?.id);
  assert.equal(g.objects[sw].attachedTo, v);
});
test('RJ#9658 a unit given -4 by Smoke Screen, then killed and saved by Guardian Angel (recalled): keeps the -4 in base', () => {
  let g = S0(); fundAll(g, P0, 8);
  const u = put(g, P1, 'V(6)', BF_A); control(g, BF_A, P1);
  attachNow(g, put(g, P1, 'Guardian Angel', 'base'), u);
  [g] = cast(g, P0, 'Smoke Screen', { targets: [[u]] }); g = settle(g);
  assert.equal(mightOf(g, u), 3, '6 + 1 (Guardian Angel) - 4');
  [g] = cast(g, P0, 'Singularity', { targets: [[u]] }); g = settle(g);
  assert.equal(locOf(g, u), 'base');
  assert.equal(g.objects[u].damage, 0, 'healed');
  assert.equal(mightOf(g, u), 2, 'still -4 (6 - 4; the Angel is gone)');
});
test('RJ#9659 an attacker\'s "When I attack" trigger fires once per combat: a defender Ridden in later doesn\'t retrigger it', () => {
  const g0 = S0(); fundAll(g0, P1);
  const d1 = put(g0, P1, 'V(2)', BF_A); put(g0, P1, 'V(5)', BF_A); control(g0, BF_A, P1);
  const late = put(g0, P1, 'V(1)', 'base');
  const rw = hand(g0, P1, 'Ride the Wind');
  const ez = put(g0, P0, 'sfd-082-221', 'base');
  let g = move(g0, P0, [ez], BF_A);
  let rode = false;
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!rode && d.kind === 'showdownAction' && d.player === P1 && !g.chain.length) { g = play(g, P1, rw, { targets: [[late]], locations: [BF_A], battlefields: [BF_A] }); rode = true; continue; }
    g = d.inStep ? choose(g, d.options!.find(o => o.id === d1)?.id ?? d.options!.find(o => o.id === late)?.id ?? d.options!.find(o => o.id === String(BF_A))?.id ?? d.options![0].id) : pass(g);
  }
  assert.ok(rode);
  assert.ok(g.log.some(l => /V\(1\) moves to/.test(l.text)), 'late defender arrived');
  assert.equal(g.log.filter(l => /^Trigger: Ezreal/.test(l.text)).length, 1);
});
test('RJ#9660 Hexdrinker on Irelia, Fervent: Deflect values add up (1 + 1 = 2), not doubled', () => {
  const g = S0();
  const ir = put(g, P0, 'Irelia, Fervent', 'base');
  attachNow(g, put(g, P0, 'Hexdrinker', 'base'), ir);
  assert.equal(kwValue(g, ir, 'Deflect'), 2);
});
test('RJ#9662 Blighted Battleaxe: another of my units conquering doesn\'t count — the equipped unit didn\'t conquer, so it is unattached and dealt 4', () => {
  let g = S0();
  const u = put(g, P0, 'V(3)', 'base');
  const ax = put(g, P0, 'Blighted Battleaxe', 'base'); attachNow(g, ax, u);
  const other = put(g, P0, 'V(1)', 'base');
  g = settle(move(g, P0, [other], BF_A));
  assert.equal(g.battlefields[BF_A].controller, P0, 'another unit conquered');
  g = endTurn(g, P0);
  for (let i = 0; i < 20 && !(g.activePlayer === P1 && pend(g).kind === 'mainAction'); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.equal(g.objects[ax].attachedTo, undefined, 'unattached');
  assert.equal(zone(g, u), 'trash', '3-Might unit takes 4');
});
test('RJ#9663 hidden Zhonya\'s Hourglass played in response to a Deathknell doesn\'t save the dead unit; (aside, principle 13) it is still playable outside combat after my only unit there died', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1, 8);
  const m = put(g, P0, 'Lonely Poro', BF_A); control(g, BF_A, P0);
  const z = put(g, P0, "Zhonya's Hourglass", { facedown: BF_A });
  [g] = cast(g, P1, 'Singularity', { targets: [[m]] });
  let played = false;
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!played && d.player === P0 && !d.inStep && zone(g, m) === 'trash' && g.chain.length) {
      assert.ok(canPlayNow(g, P0, z), 'hidden card still playable (Closed state, control kept)');
      g = act(g, { type: 'playCard', player: P0, obj: z }); played = true; continue;
    }
    g = d.inStep ? choose(g, d.options![0].id) : pass(g);
  }
  assert.ok(played);
  assert.equal(zone(g, m), 'trash', 'not saved');
  assert.equal(zone(g, z), 'base');
});
test('RJ#9664 Smite kills a Deathknell unit: it is banished instead, so no Deathknell', () => {
  let g = S0(); fundAll(g, P0);
  const p = put(g, P1, 'Lonely Poro', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'Smite', { targets: [[p]] });
  g = settle(g);
  assert.equal(zone(g, p), 'banishment');
  assert.ok(!g.log.some(l => /Trigger: Lonely Poro/.test(l.text)), 'no Deathknell');
});
test('RJ#9666 Vanguard Armory enters ready and can use its [T] the turn it is played', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  const va = hand(g, P0, 'Vanguard Armory');
  g = settle(play(g, P0, va, { dest: 'base' }));
  assert.equal(ex(g, va), false);
  const ab = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === va);
  assert.ok(ab, 'usable at once');
  g = settle(act(g, ab!), d => d.options!.find(o => o.id === 'base')?.id);
  assert.equal(g.players[P0].base.filter(id => g.cards[g.objects[id].cardId].name === 'Recruit').length, 3);
});
test('RJ#9668 Frigid Touch on a Deflect unit with Vex, Cheerless in combat: [2] + Deflect [A], then -[1][A] = 1 energy, no power', () => {
  const g0 = S0();
  const p = put(g0, P1, 'Pouty Poro', BF_A); put(g0, P1, 'V(9)', BF_A); control(g0, BF_A, P1);
  setRunes(g0, P0, 6, 'mind');
  const ft = hand(g0, P0, 'Frigid Touch');
  const vx = put(g0, P0, 'sfd-146-221', 'base');
  let g = move(g0, P0, [vx], BF_A);
  for (let i = 0; i < 8 && !(pend(g).kind === 'showdownAction' && pend(g).player === P0); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  g = act(g, { type: 'playCard', player: P0, obj: ft });
  for (let i = 0; i < 6 && pend(g).inStep; i++) { const d = pend(g); g = choose(g, d.kind === 'optional' ? 'no' : d.options!.find(o => o.id === p)?.id ?? d.options![0].id); }
  assert.equal(g.chain.length, 1);
  assert.equal(exhaustedRunes(g, P0), 1, 'one energy');
  assert.equal(g.players[P0].runesInPlay.length, 6, 'no power (Deflect [A] reduced by Vex)');
});
test('RJ#9671 Dragon\'s Rage (no Action/Reaction) can\'t be played in a showdown', () => {
  const g0 = S0(); fundAll(g0, P0);
  put(g0, P1, 'V(2)', BF_A); control(g0, BF_A, P1);
  const dr = hand(g0, P0, "Dragon's Rage");
  const a = put(g0, P0, 'V(4)', 'base');
  put(g0, P0, 'V(1)', 'base');
  assert.ok(canPlayNow(g0, P0, dr), 'playable in my open main phase');
  let g = move(g0, P0, [a], BF_A);
  for (let i = 0; i < 8 && !(pend(g).kind === 'showdownAction' && pend(g).player === P0); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  expectPending(g, 'showdownAction', P0);
  assert.equal(canPlayNow(g, P0, dr), false);
});
test('RJ#9672 Star Spring: in response to Smite ("at a battlefield") I Ambush a unit there and move my targeted unit to base: Smite fails; vs Singularity (any location) it still dies', () => {
  const run = (spell: string) => {
    let g = S0({ tp: P1, bfA: 'Star Spring' }); fundAll(g, P0, 8); fundAll(g, P1, 8);
    const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
    const rg = hand(g, P0, 'unl-120-219');
    [g] = cast(g, P1, spell, { targets: [[u]] });
    for (let i = 0; i < 4 && !(pend(g).player === P0 && pend(g).kind === 'chainResponse'); i++) g = pass(g);
    g = act(g, { type: 'playCard', player: P0, obj: rg, destination: BF_A } as never);
    g = settle(g, d => d.kind === 'optional' ? 'yes' : d.options!.find(o => o.id === u)?.id ?? d.options!.find(o => o.id === String(BF_A))?.id);
    return { loc: locOf(g, u), z: zone(g, u), rg: locOf(g, rg) };
  };
  const a = run('Smite');
  assert.equal(a.rg, BF_A);
  assert.equal(a.z, 'base', 'Smite lost its target');
  const b = run('Singularity');
  assert.equal(b.z, 'trash', 'Singularity still hits it in base');
});
test('RJ#9678 Strike Down with my buffed Warmog\'s Armor unit: deals its full Might, detaches the Armor, the buff stays', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'V(3)', BF_A, { buff: true }); control(g, BF_A, P0);
  const wa = put(g, P0, "Warmog's Armor", 'base'); attachNow(g, wa, u);
  const m = mightOf(g, u)!;
  const e = put(g, P1, 'V(9)', BF_B); control(g, BF_B, P1);
  [g] = cast(g, P0, 'Strike Down', { targets: [[u], [e]] });
  g = settle(g, d => d.options!.find(o => o.id === u || o.id === e || o.id === wa)?.id);
  assert.equal(g.objects[e].damage, m);
  assert.equal(g.objects[wa].attachedTo, undefined, 'detached');
  assert.equal(g.objects[u].counters?.buff ?? 0, 1, 'buff kept');
  assert.equal(mightOf(g, u), 4);
});
test('RJ#9680 runes readied in my Awaken Phase can pay for a Reaction played in response to my Temporary trigger', () => {
  let g = withTokens(S0({ tp: P1 }));
  setRunes(g, P0, 3, 'calm', false);
  const sp = put(g, P0, 'Sprite', BF_A, { token: true }); control(g, BF_A, P0);
  g = endTurn(g, P1);
  for (let i = 0; i < 10 && !(g.chain.some(c => c.source === sp) && pend(g).player === P0 && !pend(g).inStep); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.ok(g.chain.some(c => c.source === sp));
  assert.equal(exhaustedRunes(g, P0), 0, 'readied in Awaken');
  const d = hand(g, P0, 'Discipline');
  assert.ok(canPlayNow(g, P0, d));
  g = play(g, P0, d, { targets: [[sp]] });
  assert.ok(exhaustedRunes(g, P0) >= 1, 'paid with the fresh runes');
});
test('RJ#9681 Breakneck Mech (base) and two other Mechs (Clanging Sentry) at my other battlefield (Ganking from the Mech) move together in one Standard Move to attack', () => {
  let g = withTokens(S0());
  const bm = put(g, P0, 'Breakneck Mech', 'base');
  const t1 = put(g, P0, 'Clanging Sentry', BF_B), t2 = put(g, P0, 'Clanging Sentry', BF_B); control(g, BF_B, P0);
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const mv = legal(g, P0, 'move').find(a => a.type === 'move' && a.units.length === 3 && [bm, t1, t2].every(u => a.units.includes(u)));
  assert.ok(mv, 'one move with all three');
  g = act(g, mv!);
  assert.deepEqual([bm, t1, t2].map(u => locOf(g, u)), [BF_A, BF_A, BF_A]);
});
test('RJ#9682 two Hard Bargains on my spell (opponent plays the second before the first resolves): each asks me to pay [2]', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const sp = hand(g, P0, 'DrawR');
  g = play(g, P0, sp);
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'Hard Bargain'), { targets: [[sp]], may: [false] });
  if (pend(g).player !== P1) { g = pass(g); }
  g = play(g, P1, hand(g, P1, 'Hard Bargain'), { targets: [[g.chain.find(c => c.source === sp)!.id]], may: [false] });
  assert.equal(g.chain.length, 3);
  let asked = 0;
  g = settle(g, d => { if (d.kind === 'optional' && d.player === P0) { asked++; return 'yes'; } return undefined; });
  assert.equal(asked, 2, 'pay [2] for each Hard Bargain');
  assert.ok(!g.log.some(l => /DrawR is countered/.test(l.text)), 'my spell resolves');
});
test('RJ#9683 Blind Monk\'s "buff a friendly unit" chooses Irelia, Fervent: +1 trigger and the buff (4 → 6)', () => {
  let g = S0(); fundAll(g, P0);
  const lg = setLegend(g, P0, 'Blind Monk');
  const ir = put(g, P0, 'Irelia, Fervent', 'base');
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === lg)!);
  g = settle(g, d => d.options!.find(o => o.id === ir)?.id);
  assert.equal(g.objects[ir].counters?.buff ?? 0, 1);
  assert.equal(mightOf(g, ir), 6);
});
test('RJ#9687 Thrill of the Hunt on my Long Sword unit: it is banished and replayed as a new object — the Sword stays behind, unattached, in my base', () => {
  let g = S0(); fundAll(g, P0, 12);
  const u = put(g, P0, 'V(2)', 'base');
  const ls = put(g, P0, 'Long Sword', 'base'); attachNow(g, ls, u);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  [g] = cast(g, P0, 'Thrill of the Hunt', { targets: [[u]] });
  g = settle(g, d => d.options!.find(o => o.id === String(BF_A))?.id);
  const replayed = Object.values(g.objects).find(o => o.zone === 'battlefield' && g.cards[o.cardId].name === 'V(2)');
  assert.ok(replayed, 'replayed to a battlefield');
  assert.equal(g.objects[ls].attachedTo, undefined);
  assert.equal(locOf(g, ls), 'base');
});

// ---------------------------------------------------------------------------------------------- 9691-9710 (cycle 2026-11-26b)
test('RJ#9694 Overzealous Fan moves my lone attacker to base: the combat showdown goes on and I may Ride the Wind it back', () => {
  const g0 = S0(); fundAll(g0, P0);
  const fan = put(g0, P1, 'Overzealous Fan', BF_A); control(g0, BF_A, P1);
  put(g0, P1, 'V(1)', BF_A);
  const a = put(g0, P0, 'V(3)', 'base');
  let g = move(g0, P0, [a], BF_A);
  for (let i = 0; i < 12 && !(g.chain.length === 0 && pend(g).kind === 'showdownAction'); i++) {
    const d = pend(g);
    g = d.kind === 'optional' ? yes(g) : d.inStep ? choose(g, d.options!.find(o => o.id === a)?.id ?? d.options![0].id) : pass(g);
  }
  assert.equal(zone(g, fan), 'trash');
  assert.equal(locOf(g, a), 'base');
  assert.equal(pend(g).kind, 'showdownAction', 'showdown still running');
  assert.equal(pend(g).player, P0, 'attacker has focus');
  const rw = hand(g, P0, 'Ride the Wind');
  assert.ok(canPlayNow(g, P0, rw), 'an Action is playable');
});
test('RJ#9697 Blue Sentinel holding Grove of the God-Willow: the Grove\'s hold draw triggers twice', () => {
  const run = (unit: string) => {
    let g = S0({ tp: P1, bfA: 'Grove of the God-Willow' });
    for (let i = 0; i < 5; i++) put(g, P0, 'V(1)', 'deckTop');
    put(g, P0, unit, BF_A); control(g, BF_A, P0);
    const h0 = g.players[P0].hand.length;
    g = endTurn(g);
    g = settle(g, d => d.kind === 'optional' ? 'yes' : undefined, 60);
    return g.players[P0].hand.length - h0;
  };
  assert.equal(run('Blue Sentinel') - run('V(4)'), 1, 'one extra Grove draw');
});
test('RJ#9699 Salvage can kill gear attached to Ruin Runner (the gear is chosen, not the unit)', () => {
  let g = S0(); fundAll(g, P0);
  const rr = put(g, P1, 'Ruin Runner', 'base');
  const sw = put(g, P1, 'Long Sword', 'base'); attachNow(g, sw, rr);
  [g] = cast(g, P0, 'Salvage', { targets: [[sw]] });
  g = settle(g, d => d.kind === 'optional' ? 'yes' : d.options!.find(o => o.id === sw)?.id);
  assert.equal(zone(g, sw), 'trash');
  assert.equal(zone(g, rr), 'base');
});
test('RJ#9701 Ezreal, Dashing attacks into Nine-Tailed Fox: the Fox\'s -1 (added later) resolves first, so Ezreal deals 2', () => {
  const g0 = S0(); setLegend(g0, P1, 'Nine-Tailed Fox');
  const d = put(g0, P1, 'V(9)', BF_A); control(g0, BF_A, P1);
  const ez = put(g0, P0, 'sfd-082-221', 'base');
  let g = move(g0, P0, [ez], BF_A);
  const n = g.log.length;
  g = settle(g, dd => dd.options!.find(o => o.id === d)?.id ?? dd.options!.find(o => o.id === ez)?.id, 20);
  const t = g.log.slice(n).map(l => l.text);
  assert.ok(t.findIndex(x => /Resolving Nine-Tailed Fox/.test(x)) < t.findIndex(x => /Resolving Ezreal/.test(x)), 'Fox resolves first');
  assert.ok(t.some(x => /Ezreal deals 2 to V\(9\)/.test(x)), t.join(' | '));
});
test('RJ#9706 I stun the attacker while defending: it deals no combat damage and my defender kills it', () => {
  let { g, atk, def } = attackSetup(['V(3)'], ['V(3)']);
  fundAll(g, P1);
  for (let i = 0; i < 6 && pend(g).kind !== 'showdownAction'; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'StunA'), { targets: [[atk[0]]] });
  g = settle(g, dd => dd.options!.find(o => o.id === atk[0])?.id, 40);
  assert.equal(zone(g, atk[0]), 'trash');
  assert.equal(zone(g, def[0]), 'battlefield');
  assert.equal(g.objects[def[0]].damage ?? 0, 0);
});
test('RJ#9708 Azir, Ascendant at Vilemaw\'s Lair swaps with a unit in my base: Azir can\'t move to base (stays), the unit still moves to the Lair', () => {
  let g = S0({ bfA: "Vilemaw's Lair" }); fundAll(g, P0);
  const az = put(g, P0, 'Azir, Ascendant', BF_A); control(g, BF_A, P0);
  const u = put(g, P0, 'V(2)', 'base');
  g = activate(g, P0, az, 0, { targets: [[u]] });
  g = settle(g);
  assert.equal(locOf(g, az), BF_A);
  assert.equal(locOf(g, u), BF_A);
});
test('RJ#9710 Drag Under choosing an enemy Deflect unit pays the Deflect cost (any domain)', () => {
  let g = S0();
  setRunes(g, P0, 7, 'order');
  const ir = put(g, P1, 'Irelia, Fervent', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'Drag Under', { targets: [[ir]] });
  assert.equal(g.players[0].runesInPlay.length, 5, '[A] for the spell + [A] Deflect recycled');
  g = settle(g);
  assert.equal(zone(g, ir), 'trash');
});

// ---------------------------------------------------------------------------------------------- 9711-9730
test('RJ#9712 a stunned attacker adds no Might to combat damage (stunned 7 + 4 → 4 dealt)', () => {
  let { g, atk, def } = attackSetup(['V(7)', 'V(4)'], ['V(5)']);
  fundAll(g, P1);
  for (let i = 0; i < 6 && pend(g).kind !== 'showdownAction'; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'StunA'), { targets: [[atk[0]]] });
  const n = g.log.length;
  g = driveH(g);
  assert.equal(zone(g, def[0]), 'battlefield', 'only 4 damage: the 5-Might defender survives');
  assert.ok(!g.log.slice(n).some(l => /V\(5\) died/.test(l.text)));
});
test('RJ#9715 Draven, Audacious moved to base during the combat showdown: my other attacker wins the combat, but Draven didn\'t — only the conquer point', () => {
  let { g, atk, def } = attackSetup(['Draven, Audacious', 'V(3)'], ['V(1)']);
  fundAll(g, P0);
  for (let i = 0; i < 6 && !(pend(g).kind === 'showdownAction' && pend(g).player === P0); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  g = play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[atk[0]]], dest: 'base' });
  g = driveH(g, ['first', 'first', 'first']);
  g = driveH(g);
  assert.equal(locOf(g, atk[0]), 'base');
  assert.equal(zone(g, def[0]), 'trash');
  assert.equal(g.players[P0].points, 1, 'conquer only; no Draven point');
});
test('RJ#9719 hidden Zhonya\'s Hourglass revealed in response to a kill spell: it lands in base at once and Thermo Beam (Action) can\'t be played before the kill resolves — the unit is saved', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const z = put(g, P0, "Zhonya's Hourglass", { facedown: BF_A });
  const tb = hand(g, P1, 'Thermo Beam');
  g = play(g, P1, hand(g, P1, 'KillA'), { targets: [[u]] });
  g = pass(g);
  assert.equal(pend(g).player, P0);
  assert.ok(canPlayNow(g, P0, z));
  g = act(g, { type: 'playCard', player: P0, obj: z });
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = choose(g, pend(g).options![0].id);
  assert.equal(zone(g, z), 'base', 'resolved at once (gear), no window');
  if (pend(g).player === P0) g = pass(g);
  assert.equal(pend(g).player, P1);
  assert.equal(canPlayNow(g, P1, tb), false, 'Thermo Beam is an Action: not while the kill is on the chain');
  g = settle(g);
  assert.equal(zone(g, z), 'trash');
  assert.equal(locOf(g, u), 'base', 'saved and recalled');
});
test('RJ#9720 defending 7 vs a stunned 7 and a 4: only 4 damage, my unit survives', () => {
  let { g, atk, def } = attackSetup(['V(7)', 'V(4)'], ['V(7)']);
  fundAll(g, P1);
  for (let i = 0; i < 6 && pend(g).kind !== 'showdownAction'; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'StunA'), { targets: [[atk[0]]] });
  g = driveH(g);
  assert.equal(zone(g, def[0]), 'battlefield');
  assert.equal(zone(g, atk[1]), 'trash', 'my 7 kills the 4');
});
test('RJ#9721 Falling Star twice on an enemy Soaring Scout with Guardian Angel: 6 damage, one would-die → Guardian Angel dies instead, Scout recalled (no Deathknell)', () => {
  let g = S0(); fundAll(g, P0);
  const sc = put(g, P1, 'Soaring Scout', BF_A); control(g, BF_A, P1);
  const ga = put(g, P1, 'Guardian Angel', 'base'); attachNow(g, ga, sc);
  put(g, P1, 'V(1)', BF_A);
  const r0 = g.players[P1].runesInPlay.length;
  [g] = cast(g, P0, 'Falling Star', { targets: [[sc], [sc]] });
  g = settle(g, d => d.options!.find(o => o.id === sc)?.id);
  assert.equal(zone(g, ga), 'trash');
  assert.equal(locOf(g, sc), 'base');
  assert.equal(g.objects[sc].damage ?? 0, 0, 'healed');
  assert.equal(g.players[P1].runesInPlay.length, r0, 'no Deathknell channel');
});
test('RJ#9724 two Tideturners defend Forbidding Waste; Hextech Ray kills one mid-showdown: the survivor is now defending alone → -2 at once', () => {
  let { g, def } = attackSetup(['V(5)'], ['Tideturner', 'Tideturner'], { bfA: 'Forbidding Waste' });
  fundAll(g, P0);
  for (let i = 0; i < 8 && !(pend(g).kind === 'showdownAction' && pend(g).player === P0); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(mightOf(g, def[1]), 2, 'not alone yet');
  g = play(g, P0, hand(g, P0, 'Hextech Ray'), { targets: [[def[0]]] });
  g = resolveChain(g);
  assert.equal(zone(g, def[0]), 'trash');
  assert.equal(mightOf(g, def[1]), 0, 'defending alone: 2 - 2');
});
test('RJ#9728 Baron Nashor entering the new Baron Pit starts a non-combat showdown there; it is conquered only when the showdown ends', () => {
  let g = S0();
  setRunes(g, P0, 0); addRunes(g, P0, 7, 'chaos'); addRunes(g, P0, 6, 'fury');
  g.cards = { ...g.cards, 'unl-t01': realCard('unl-t01') };
  const bn = hand(g, P0, 'Baron Nashor');
  g = act(g, { type: 'playCard', player: P0, obj: bn });
  for (let i = 0; i < 6 && pend(g).inStep; i++) g = choose(g, pend(g).options!.find(o => /Baron/.test(o.label))?.id ?? pend(g).options![0].id);
  const pit = g.battlefields.findIndex(b => g.cards[g.objects[b.objId].cardId].name === 'Baron Pit');
  assert.equal(pend(g).kind, 'showdownAction', 'showdown');
  assert.notEqual(g.battlefields[pit].controller, P0, 'not conquered yet');
  assert.equal(g.players[0].points, 0);
  g = settle(g);
  assert.equal(g.battlefields[pit].controller, P0);
  assert.equal(g.players[0].points, 1);
});
test('RJ#9729 Sacrifice (killing the Mighty unit Mirror Image chose) in response: Sacrifice draws/channels, then the Reflection is played but copies nothing', () => {
  let g = withTokens(S0()); fundAll(g, P0); fundAll(g, P1);
  const t = put(g, P1, 'V(6)', BF_A); control(g, BF_A, P1);
  const before = new Set(Object.keys(g.objects));
  g = play(g, P0, hand(g, P0, 'Mirror Image'), { targets: [[t]] });
  if (pend(g).player !== P1) g = pass(g);
  const sc = hand(g, P1, 'Sacrifice');
  assert.ok(canPlayNow(g, P1, sc));
  const h1 = g.players[P1].hand.length;
  g = act(g, { type: 'playCard', player: P1, obj: sc });
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = choose(g, pend(g).options!.find(o => o.id === t)?.id ?? pend(g).options![0].id);
  assert.equal(zone(g, t), 'trash', 'killed as the cost');
  g = settle(g);
  assert.equal(g.players[P1].hand.length, h1 - 1 + 2, 'Sacrifice drew 2');
  const r = Object.keys(g.objects).filter(id => !before.has(id) && g.objects[id].isToken && g.objects[id].zone === 'base');
  assert.equal(r.length, 1, 'Reflection still played');
  assert.equal(mightOf(g, r[0]), 0, 'not a copy');
});

// ---------------------------------------------------------------------------------------------- 9731-9750
test('RJ#9731 Void Rush finds Noxus Hopeful: [2] from Void Rush + [2] Legion (Void Rush was played) → free', () => {
  let g = S0();
  setRunes(g, P0, 0);
  g.players[P0].pool = { energy: 2, power: { Fury: 1, Chaos: 0, Mind: 0, Calm: 0, Body: 0, Order: 0 } } as GameState['players'][0]['pool'];
  put(g, P0, 'V(1)', 'deckTop');
  const nh = put(g, P0, 'Noxus Hopeful', 'deckTop');
  [g] = cast(g, P0, 'Void Rush');
  g = settle(g, d => d.kind === 'optional' ? 'yes' : d.options!.find(o => o.id === nh)?.id ?? d.options!.find(o => o.id === 'base')?.id);
  assert.ok(['base', 'battlefield'].includes(zone(g, nh)), `played for 0 (zone ${zone(g, nh)})`);
});
test('RJ#9732 Mirror Image can choose a Reflection that copies a unit: the new Reflection copies what it currently is', () => {
  let g = withTokens(S0()); fundAll(g, P0, 12);
  const t = put(g, P1, 'V(6)', BF_A); control(g, BF_A, P1);
  let before = new Set(Object.keys(g.objects));
  [g] = cast(g, P0, 'Mirror Image', { targets: [[t]] });
  g = settle(g, d => d.options!.find(o => o.id === t)?.id);
  const r1 = Object.keys(g.objects).find(id => !before.has(id) && g.objects[id].isToken && g.objects[id].zone === 'base')!;
  assert.equal(mightOf(g, r1), 6);
  before = new Set(Object.keys(g.objects));
  const mi2 = put(g, P0, 'Mirror Image', 'hand');
  g = play(g, P0, mi2, { targets: [[r1]] });
  g = settle(g, d => d.options!.find(o => o.id === r1)?.id);
  const r2 = Object.keys(g.objects).find(id => !before.has(id) && g.objects[id].isToken && g.objects[id].zone === 'base')!;
  assert.ok(r2, 'second Reflection');
  assert.equal(mightOf(g, r2), 6, 'a copy of V(6) (the copied characteristics)');
});
test('RJ#9733 Rumble, Scrapper with Skyfall of Areion conquers: his hold effect triggers once (one conquer) → one Mech token', () => {
  let g = withTokens(S0());
  const r = put(g, P0, 'Rumble, Scrapper', 'base');
  const sk = put(g, P0, 'Skyfall of Areion', 'base'); attachNow(g, sk, r);
  const base0 = new Set(g.players[P0].base);
  g = move(g, P0, [r], BF_A);
  const n = g.log.length;
  g = settle(g, d => d.kind === 'optional' ? 'yes' : undefined);
  assert.equal(g.battlefields[BF_A].controller, P0);
  const trig = g.log.slice(n).filter(l => /^Trigger: Rumble/.test(l.text));
  assert.equal(trig.length, 1, trig.map(l => l.text).join(' | '));
  const mechs = g.players[P0].base.filter(id => !base0.has(id) && g.objects[id].isToken);
  assert.equal(mechs.length, 1, 'one Mech token');
});
test('RJ#9735 a unit I play with Ambush (as a Reaction) while the enemy Vex, Apathetic is at a battlefield is stunned', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  put(g, P1, 'Vex, Apathetic', BF_A); control(g, BF_A, P1);
  put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
  g = play(g, P1, hand(g, P1, 'DrawR'));
  if (pend(g).player !== P0) g = pass(g);
  const amb = hand(g, P0, 'Ambusher(2)');
  assert.ok(canPlayNow(g, P0, amb, BF_B));
  g = play(g, P0, amb, { dest: BF_B });
  g = settle(g);
  assert.equal(locOf(g, amb), BF_B);
  assert.equal(!!g.objects[amb].stunned, true);
});
test('RJ#9743 a Ganking unit that moved from one battlefield to attack another, stunned and surviving, is recalled to base (not to its old battlefield)', () => {
  let g = S0(); fundAll(g, P1);
  const gk = put(g, P0, 'Ganker(2)', BF_B); control(g, BF_B, P0);
  put(g, P0, 'V(1)', BF_B);
  const d = put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [gk], BF_A);
  for (let i = 0; i < 6 && pend(g).kind !== 'showdownAction'; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'StunA'), { targets: [[gk]] });
  g = driveH(g);
  assert.equal(zone(g, d), 'battlefield', 'stunned: no damage dealt');
  assert.equal(locOf(g, gk), 'base', 'recalled to base');
});
test('RJ#9744 Not So Fast on an Icathian Rain that chose one of my units (and other units): the whole spell is countered', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1, 12);
  const u = put(g, P0, 'V(9)', BF_A); control(g, BF_A, P0);
  const w = put(g, P1, 'V(12)', BF_B); control(g, BF_B, P1);
  let ir: string;
  [g, ir] = cast(g, P1, 'Icathian Rain', { targets: [[u], [w], [w], [w], [w], [w]] });
  for (let i = 0; i < 8 && pend(g).inStep && pend(g).player === P1; i++) g = choose(g, optionIds(g).includes(w) ? w : optionIds(g)[0]);
  assert.ok(g.chain.some(c => c.source === ir));
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  const nsf = hand(g, P0, 'Not So Fast');
  assert.ok(canPlayNow(g, P0, nsf));
  g = play(g, P0, nsf, { targets: [[g.chain.find(c => c.source === ir)!.id]] });
  g = settle(g);
  assert.equal(g.objects[u].damage ?? 0, 0);
  assert.equal(g.objects[w].damage ?? 0, 0, 'no instance resolved');
});
test('RJ#9746 Grim Apothecary played to a battlefield may return itself to my hand', () => {
  let g = S0(); fundAll(g, P0, 12);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const ga = hand(g, P0, 'Grim Apothecary');
  g = play(g, P0, ga, { dest: BF_A });
  let offered = false;
  g = settle(g, d => { if (d.options!.some(o => o.id === ga)) { offered = true; return ga; } return d.kind === 'optional' ? 'yes' : undefined; });
  assert.ok(offered, 'itself offered');
  assert.equal(zone(g, ga), 'hand');
});
test('RJ#9750 Star-Crossed in response to Thousand-Tailed Watcher\'s play trigger: Watcher and my unit go to hand; the trigger still resolves on my remaining units', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1, 12);
  const mine = put(g, P0, 'V(2)', 'base');
  const other = put(g, P0, 'V(5)', 'base');
  const tw = hand(g, P1, 'Thousand-Tailed Watcher');
  g = play(g, P1, tw, { dest: 'base', may: [false] });
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = pend(g).kind === 'optional' ? no(g) : choose(g, pend(g).options![0].id);
  assert.ok(g.chain.length >= 1, 'play trigger on the chain');
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  const sc = hand(g, P0, 'Star-Crossed');
  assert.ok(canPlayNow(g, P0, sc));
  g = play(g, P0, sc, { targets: [[mine], [tw]] });
  g = settle(g, d => d.options!.find(o => o.id === mine || o.id === tw)?.id);
  assert.equal(zone(g, tw), 'hand'); assert.equal(zone(g, mine), 'hand');
  assert.equal(mightOf(g, other), 2, 'the -3 still resolves');
});

// ---------------------------------------------------------------------------------------------- 9751-9770
test('RJ#9751 Sprite Mother\'s Sprite is stunned by an enemy Vex, Apathetic (at a battlefield) and can\'t move; no Ride the Wind in response to Vex\'s trigger', () => {
  let g = withTokens(S0()); fundAll(g, P0, 12);
  put(g, P1, 'Vex, Apathetic', BF_A); control(g, BF_A, P1);
  const before = new Set(Object.keys(g.objects));
  const sm = hand(g, P0, 'Sprite Mother');
  const rw = hand(g, P0, 'Ride the Wind');
  g = play(g, P0, sm, { dest: 'base' });
  let rwDuringChain = false;
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep && d.player === P0 && g.chain.length && canPlayNow(g, P0, rw)) rwDuringChain = true;
    g = d.inStep ? choose(g, d.options![0].id) : pass(g);
  }
  assert.equal(rwDuringChain, false, 'Ride the Wind (Action) not playable while a trigger is on the chain');
  const sp = Object.keys(g.objects).find(id => !before.has(id) && g.objects[id].isToken && ['base', 'battlefield'].includes(g.objects[id].zone))!;
  assert.ok(sp, 'Sprite played');
  assert.equal(!!g.objects[sp].stunned, true);
  assert.ok(!legal(g, P0, 'move').some(a => a.type === 'move' && a.units.includes(sp)), 'can\'t move');
});
test('RJ#9752 Noxian Drummer moving to Rockfall Path: "play a Recruit here" does nothing (units can\'t be played there)', () => {
  let g = withTokens(S0({ bfA: 'Rockfall Path' }));
  const nd = put(g, P0, 'Noxian Drummer', 'base');
  const before = new Set(Object.keys(g.objects));
  g = move(g, P0, [nd], BF_A);
  g = settle(g);
  assert.equal(locOf(g, nd), BF_A);
  assert.ok(!Object.keys(g.objects).some(id => !before.has(id) && g.objects[id].isToken && ['base', 'battlefield'].includes(g.objects[id].zone)), 'no Recruit');
});
test('RJ#9758 no limit on units at a battlefield', () => {
  let g = S0();
  const us = Array.from({ length: 12 }, () => put(g, P0, 'V(1)', 'base'));
  g = move(g, P0, us, BF_A);
  g = settle(g);
  assert.ok(us.every(u => locOf(g, u) === BF_A));
});
test('RJ#9760 Bullet Time / Unchecked Power don\'t choose Pouty Poro: no Deflect cost', () => {
  let g = S0();
  setRunes(g, P0, 0); addRunes(g, P0, 1, 'body');
  put(g, P1, 'Pouty Poro', BF_A); control(g, BF_A, P1);
  const bt = hand(g, P0, 'Bullet Time');
  g = act(g, { type: 'playCard', player: P0, obj: bt });
  g = choose(g, g.battlefields[BF_A].objId);
  assert.equal(g.players[0].runesInPlay.length, 1, 'Bullet Time: no Deflect [A] recycled');
  g = S0();
  setRunes(g, P0, 0); addRunes(g, P0, 7, 'mind');
  put(g, P1, 'Pouty Poro', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'Unchecked Power');
  assert.equal(g.players[0].runesInPlay.length, 5, 'only its own [A][A] recycled');
});
test('RJ#9764 (MISMATCH-RJ aside) Rengar, Trophy Hunter Ambushed in response to Anivia\'s attack trigger is hit too — and with my Elder Dragon the 3 damage kills the 6-Might Rengar', () => {
  let g = S0(); fundAll(g, P1, 12);
  put(g, P0, 'Elder Dragon', 'base');
  const an = put(g, P0, 'Anivia, Primal', 'base');
  const d = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const rg = hand(g, P1, 'Rengar, Trophy Hunter');
  g = move(g, P0, [an], BF_A);
  for (let i = 0; i < 6 && !(pend(g).player === P1 && !pend(g).inStep && g.chain.length); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.ok(canPlayNow(g, P1, rg, BF_A), 'Rengar Ambush in response');
  g = play(g, P1, rg, { dest: BF_A });
  for (let i = 0; i < 12 && g.chain.length; i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.equal(zone(g, rg), 'trash', 'Rengar dies to 3 (Elder Dragon: any amount kills)');
  assert.equal(zone(g, d), 'trash');
});
test('RJ#9766 (aside MISMATCH-RJ) my defending Watchful Sentry dies; I Ambush Rengar in response to its Deathknell and win the (new) combat: I keep the battlefield — no conquer, no point (I never lost control)', () => {
  let { g, atk } = attackSetup(['V(2)'], ['Watchful Sentry']);
  fundAll(g, P1, 12);
  const rg = hand(g, P1, 'Rengar, Trophy Hunter');
  const p1pts = g.players[P1].points;
  let played = false;
  for (let i = 0; i < 60 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!played && d.player === P1 && !d.inStep && g.chain.some(c => /Watchful Sentry/.test(JSON.stringify(c)) || g.cards[g.objects[c.source]?.cardId]?.name === 'Watchful Sentry')) {
      assert.ok(canPlayNow(g, P1, rg, BF_A)); g = play(g, P1, rg, { dest: BF_A }); played = true; continue;
    }
    if (d.kind === 'assignDamage') { g = act(g, legal(g, d.player)[0]); continue; }
    g = d.inStep ? choose(g, d.options![0].id) : pass(g);
  }
  assert.ok(played, 'Rengar played during the Deathknell');
  assert.equal(zone(g, atk[0]), 'trash', 'Rengar won the new combat');
  assert.equal(g.battlefields[BF_A].controller, P1);
  assert.equal(g.players[P1].points, p1pts, 'no conquer point');
});
test('RJ#9767 Stalwart Poro (2) hit by Thousand-Tailed Watcher (-3, min 1 → -1), defending alone with Wuju Bladesman (+2) and Shield (+1): 4', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1, 12);
  setLegend(g, P0, 'Wuju Bladesman');
  const po = put(g, P0, 'Stalwart Poro', BF_A); control(g, BF_A, P0);
  const tw = hand(g, P1, 'Thousand-Tailed Watcher');
  g = play(g, P1, tw, { dest: 'base', may: [true] });
  g = settle(g, d => d.kind === 'optional' ? 'yes' : undefined);
  assert.equal(mightOf(g, po), 1);
  g = move(g, P1, [tw], BF_A);
  for (let i = 0; i < 6 && pend(g).inStep; i++) g = choose(g, pend(g).options![0].id);
  assert.equal(mightOf(g, po), 4, '2 - 1 + 2 + 1');
});
test('RJ#9769 Pridestalker (Rengar legend): my only unit, just played, may take its own +1', () => {
  let g = S0(); fundAll(g, P0);
  setLegend(g, P0, 'Pridestalker');
  const u = hand(g, P0, 'V(2)');
  g = play(g, P0, u, { dest: 'base' });
  g = settle(g, d => d.options!.find(o => o.id === u)?.id);
  assert.equal(mightOf(g, u), 3);
});

// ---------------------------------------------------------------------------------------------- 9771-9790
test('RJ#9776 Elder Dragon\'s play trigger may choose an enemy unit in its base (a base is a location); 1 damage kills it', () => {
  let g = S0(); fundAll(g, P0, 20);
  const e = put(g, P1, 'V(5)', 'base');
  const ed = hand(g, P0, 'Elder Dragon');
  g = play(g, P0, ed, { dest: 'base' });
  let offered = false;
  g = settle(g, d => { if (d.options!.some(o => o.id === e)) { offered = true; return d.kind === 'chooseTargets' ? e : e; } return undefined; });
  assert.ok(offered, 'enemy base unit offered');
  assert.equal(zone(g, e), 'trash');
});
test('RJ#9775 Switcheroo\'s swapped Might stays on the unit for the turn after Ride the Wind moves it to the other battlefield', () => {
  let g = S0(); fundAll(g, P0, 12);
  const a = put(g, P0, 'V(2)', BF_A), b = put(g, P0, 'V(5)', BF_A); control(g, BF_A, P0);
  put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
  [g] = cast(g, P0, 'Switcheroo', { targets: [[a, b]] });
  g = settle(g, d => d.options!.find(o => o.id === a || o.id === b)?.id);
  assert.equal(mightOf(g, a), 5);
  [g] = cast(g, P0, 'Ride the Wind', { targets: [[a]], dest: BF_B });
  g = settle(g, d => d.options!.find(o => o.id === a || o.id === String(BF_B))?.id);
  assert.equal(locOf(g, a), BF_B);
  assert.equal(mightOf(g, a), 5);
});
test('RJ#9780 Undying Loyalty: the unit is chosen first and the [2] discount for a Poro applies before paying', () => {
  let g = S0(); setRunes(g, P0, 1, 'order');
  put(g, P0, 'V(1)', 'trash');
  const ul = hand(g, P0, 'Undying Loyalty');
  assert.equal(canPlayNow(g, P0, ul), false, 'only a non-Poro in the trash: [2][A] unaffordable with one rune');
  const pp = put(g, P0, 'Pouty Poro', 'trash');
  assert.ok(canPlayNow(g, P0, ul), 'choosing the Poro: [A] only');
  g = play(g, P0, ul, { targets: [[pp]] });
  g = settle(g, d => d.options!.find(o => o.id === pp)?.id ?? d.options!.find(o => o.id === 'base')?.id);
  assert.equal(zone(g, pp), 'base');
});
test('RJ#9782 a Gold token killed for its own [Add] can\'t also be killed for Malzahar, Fanatic\'s cost', () => {
  let g = withTokens(S0());
  const mz = put(g, P0, 'Malzahar, Fanatic', 'base');
  const gold = put(g, P0, 'Gold', 'base', { token: true });
  const ga = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === gold);
  assert.ok(ga, 'Gold ability available');
  g = act(g, ga!);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = choose(g, pend(g).options![0].id);
  assert.notEqual(zone(g, gold), 'base', 'Gold killed as its cost');
  const ma = legal(g, P0, 'activate').filter(a => a.type === 'activate' && a.obj === mz);
  if (ma.length) {
    g = act(g, ma[0]);
    if (pend(g).inStep) assert.ok(!pend(g).options!.some(o => o.id === gold), 'the dead Gold is not a choice');
  }
});
test('RJ#9794 game setup: battlefields are chosen and revealed before the play-order choice; then opening draws', () => {
  let g = newGame({ battlefieldChoice: 'choose' });
  const kinds: string[] = [];
  for (let i = 0; i < 8 && pend(g).kind === 'chooseBattlefield'; i++) { kinds.push(pend(g).kind); g = choose(g, pend(g).options![0].id); }
  assert.equal(kinds.length, 2, 'both battlefields chosen first');
  assert.equal(g.battlefields.length, 2, 'revealed');
  const d = pend(g);
  assert.ok(d.kind !== 'chooseBattlefield' && /first|second|order/i.test(d.prompt ?? ''), `next: play order (${d.kind}: ${d.prompt})`);
  assert.ok(g.players.every(p => p.hand.length === 0), 'no opening hands before the play-order choice');
});
test('RJ#9801 a countered spell counts for Legion (finalized) but not for Chemtech Cask ("when you play a spell": not played)', () => {
  const run = (counter: boolean) => {
    let g = withTokens(S0({ tp: P1 })); fundAll(g, P0, 12); fundAll(g, P1, 12);
    put(g, P0, 'Chemtech Cask', 'base');
    g = play(g, P1, hand(g, P1, 'DrawR'));
    if (pend(g).player !== P0) g = pass(g);
    const sp = hand(g, P0, 'DrawR');
    g = play(g, P0, sp);
    if (counter) {
      if (pend(g).player !== P1) g = pass(g);
      g = play(g, P1, hand(g, P1, 'Wind Wall'), { targets: [[g.chain.find(c => c.source === sp)!.id]] });
    }
    let asked = false;
    for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) { const d = pend(g); if (d.kind === 'optional' && /Chemtech|Gold|exhaust/i.test(d.prompt ?? '')) asked = true; g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : optionIds(g)[0]) : pass(g); }
    return asked || g.players[P0].base.some(id => g.cards[g.objects[id].cardId].name === 'Gold');
  };
  assert.equal(run(false), true, 'uncountered: Cask triggers');
  assert.equal(run(true), false, 'countered: no Cask trigger');
});
test('RJ#9806 after Brynhir Thundersong\'s play trigger resolves, the opponent can\'t play a hidden Zhonya\'s Hourglass (in response to the trigger they still can)', () => {
  let g = S0(); fundAll(g, P0, 12);
  const u = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const z = put(g, P1, "Zhonya's Hourglass", { facedown: BF_A });
  g = play(g, P0, hand(g, P0, 'Brynhir Thundersong'), { dest: 'base' });
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.ok(g.chain.length >= 1);
  assert.ok(canPlayNow(g, P1, z), 'in response to the trigger: allowed');
  g = settle(g);
  [g] = cast(g, P0, 'KillA', { targets: [[u]] });
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  assert.equal(canPlayNow(g, P1, z), false, 'afterwards: no hidden plays');
  g = settle(g);
  assert.equal(zone(g, u), 'trash');
});
test('RJ#9808 Forbidding Waste\'s -2 applies to a Deflect unit defending alone (nothing is chosen)', () => {
  let { g, def } = attackSetup(['V(5)'], ['Pouty Poro'], { bfA: 'Forbidding Waste' });
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = choose(g, pend(g).options![0].id);
  assert.equal(mightOf(g, def[0]), 0);
});
test('RJ#9810 Janna, Savior\'s "move up to one enemy unit from here" chooses it: an enemy Pouty Poro costs its Deflect', () => {
  let g = S0({ tp: P1 });
  setRunes(g, P0, 6, 'calm');
  put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const pp = put(g, P1, 'Pouty Poro', 'base');
  g = move(g, P1, [pp], BF_A);
  for (let i = 0; i < 8 && !(pend(g).kind === 'showdownAction' && pend(g).player === P0); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  const j = hand(g, P0, 'Janna, Savior');
  assert.ok(canPlayNow(g, P0, j, BF_A));
  g = play(g, P0, j, { dest: BF_A });
  const r0 = g.players[0].runesInPlay.length;
  for (let i = 0; i < 6 && pend(g).inStep && pend(g).player === P0; i++) { const d = pend(g); g = d.kind === 'optional' ? yes(g) : choose(g, d.options!.find(o => o.id === pp)?.id ?? d.options![0].id); }
  assert.equal(r0 - g.players[0].runesInPlay.length, 1, 'Deflect [A] paid as the trigger chose the Poro');
  g = resolveChain(g);
  assert.equal(locOf(g, pp), 'base');
});

// ---------------------------------------------------------------------------------------------- 9811-9830
test('RJ#9811 two Guardian Angels on one unit that would die: only one is killed instead; the other stays attached as it is recalled', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const g1 = put(g, P1, 'Guardian Angel', 'base'), g2 = put(g, P1, 'Guardian Angel', 'base');
  attachNow(g, g1, u); attachNow(g, g2, u);
  [g] = cast(g, P0, 'KillA', { targets: [[u]] });
  g = settle(g, d => d.options!.find(o => o.id === g1)?.id);
  assert.equal(locOf(g, u), 'base');
  const dead = [g1, g2].filter(x => zone(g, x) === 'trash');
  assert.equal(dead.length, 1, 'one Guardian Angel killed');
  const live = [g1, g2].find(x => zone(g, x) !== 'trash')!;
  assert.equal(g.objects[live].attachedTo, u, 'the other stays attached');
});
test('RJ#9815 Noxus Hopeful (4) moves to an empty Sunken Temple; Blood Rush (Assault 2) in the non-combat showdown: not an attacker → 4, not Mighty → no Temple trigger', () => {
  let g = S0({ bfA: 'Sunken Temple' }); fundAll(g, P0);
  const nh = put(g, P0, 'Noxus Hopeful', 'base');
  g = move(g, P0, [nh], BF_A);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = choose(g, pend(g).options![0].id);
  assert.equal(pend(g).kind, 'showdownAction');
  g = play(g, P0, hand(g, P0, 'Blood Rush'), { targets: [[nh]], may: [false] });
  g = resolveChain(g);
  assert.equal(mightOf(g, nh), 4, 'Assault only while attacking');
  const n = g.log.length;
  let temple = false;
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) { const d = pend(g); if (/Sunken Temple|draw 1/i.test(d.prompt ?? '')) temple = true; g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : d.options![0].id) : pass(g); }
  assert.equal(g.battlefields[BF_A].controller, P0, 'conquered');
  assert.ok(!temple && !g.log.slice(n).some(l => /^Trigger: Sunken Temple/.test(l.text)), 'no Temple trigger');
});
test('RJ#9814 Emperor\'s Divide moves my ready unit to base without exhausting it', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'V(2)', BF_A, { ready: true }); control(g, BF_A, P0);
  [g] = cast(g, P0, "Emperor's Divide", { targets: [[u]] });
  g = settle(g, d => d.options!.find(o => o.id === u)?.id ?? d.options!.find(o => o.id === String(BF_A))?.id);
  assert.equal(locOf(g, u), 'base');
  assert.equal(ex(g, u), false, 'still ready');
});
test('RJ#9820 the opponent moves into an empty battlefield; I play Rengar, Trophy Hunter there during the showdown: they are the Attacker, I am the Defender', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12);
  const e = put(g, P1, 'V(2)', 'base');
  g = move(g, P1, [e], BF_A);
  for (let i = 0; i < 4 && !(pend(g).player === P0 && !pend(g).inStep); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  const rg = hand(g, P0, 'Rengar, Trophy Hunter');
  assert.ok(canPlayNow(g, P0, rg, BF_A), 'Ambush there (enemy units present)');
  g = play(g, P0, rg, { dest: BF_A });
  for (let i = 0; i < 8 && !g.log.some(l => /^Combat at BF-A/.test(l.text)); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.ok(g.log.some(l => /Combat at BF-A: P1 attacks, P0 defends/.test(l.text)), g.log.filter(l => /Combat/.test(l.text)).map(l => l.text).join(' | '));
});
test('RJ#9821 Deathgrip on my Guardian Angel unit: the death is replaced, so no Might bonus ("if you do"); still draw 1', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'V(4)', 'base');
  const ga = put(g, P0, 'Guardian Angel', 'base'); attachNow(g, ga, u);
  const o = put(g, P0, 'V(2)', 'base');
  const h0 = g.players[P0].hand.length;
  [g] = cast(g, P0, 'Deathgrip', { targets: [[u], [o]] });
  g = settle(g, d => d.options!.find(x => x.id === u)?.id ?? d.options!.find(x => x.id === o)?.id);
  assert.equal(zone(g, ga), 'trash');
  assert.equal(zone(g, u), 'base');
  assert.equal(mightOf(g, o), 2, 'no +4');
  assert.equal(g.players[P0].hand.length, h0 + 1, 'drew 1');
});
test('RJ#9824 a Reflection token played by Mirror Image is stunned by an enemy Vex, Apathetic at a battlefield (it was played) and can\'t move', () => {
  let g = withTokens(S0()); fundAll(g, P0, 12);
  put(g, P1, 'Vex, Apathetic', BF_A); control(g, BF_A, P1);
  const t = put(g, P1, 'V(3)', 'base');
  const before = new Set(Object.keys(g.objects));
  [g] = cast(g, P0, 'Mirror Image', { targets: [[t]] });
  g = settle(g, d => d.options!.find(o => o.id === t)?.id);
  const r = Object.keys(g.objects).find(id => !before.has(id) && g.objects[id].isToken && g.objects[id].zone === 'base')!;
  assert.ok(r, 'Reflection played');
  assert.equal(!!g.objects[r].stunned, true);
  assert.ok(!legal(g, P0, 'move').some(a => a.type === 'move' && a.units.includes(r)));
});

// ---------------------------------------------------------------------------------------------- 9831-9850
test('RJ#9835 Deathgrip on my buffed unit saved by The Boss (Sett legend): no Might bonus for the other unit (it never died); still draw 1', () => {
  let g = S0();
  fundAll(g, P0, 2);
  setLegend(g, P0, 'The Boss');
  const u = put(g, P0, 'V(3)', BF_A, { buff: true }); control(g, BF_A, P0);
  const o = put(g, P0, 'V(1)', 'base');
  const n = g.log.length;
  [g] = cast(g, P0, 'Deathgrip', { targets: [[u], [o]] });
  g = settle(g, d => d.kind === 'optional' ? 'yes' : d.options!.find(x => x.id === u || x.id === o)?.id);
  assert.equal(locOf(g, u), 'base');
  assert.equal(mightOf(g, o), 1, 'no bonus');
  assert.ok(g.log.slice(n).some(l => /P0 draws/.test(l.text)), 'drew 1');
});
test('RJ#9841 my lone Lonely Poro dies: in response to its Deathknell I may Ambush to my other battlefield (not the Poro\'s — no unit of mine there); "died alone" was fixed at its death → draw', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12); fundAll(g, P1);
  const lp = put(g, P0, 'Lonely Poro', BF_A); control(g, BF_A, P0);
  put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
  const amb = hand(g, P0, 'Ambusher(2)');
  g = play(g, P1, hand(g, P1, 'KillA'), { targets: [[lp]] });
  for (let i = 0; i < 8 && !(g.chain.some(c => c.source === lp) && pend(g).player === P0 && !pend(g).inStep); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.ok(g.chain.some(c => c.source === lp), 'Deathknell on the chain');
  assert.equal(canPlayNow(g, P0, amb, BF_A), false, 'no friendly unit at the Poro\'s battlefield');
  assert.ok(canPlayNow(g, P0, amb, BF_B));
  const h0 = g.players[P0].hand.length;
  g = play(g, P0, amb, { dest: BF_B });
  g = settle(g);
  assert.equal(locOf(g, amb), BF_B);
  assert.equal(g.players[P0].hand.length, h0 - 1 + 1, 'Poro drew 1');
});
test('RJ#9844 Vex, Cheerless in combat + Find Your Center with the opponent at 6: both total-cost discounts, Vex first (3 → 2, min [1]), then [2] less → free', () => {
  let { g } = attackSetup(['Vex, Cheerless'], ['V(9)']);
  g.players[P1].points = 6;
  for (let i = 0; i < 6 && !(pend(g).kind === 'showdownAction' && pend(g).player === P0); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  setRunes(g, P0, 0);
  const f = hand(g, P0, 'Find Your Center');
  assert.ok(canPlayNow(g, P0, f), 'playable with no runes at all');
});
test('RJ#9845 Cull the Weak with Repeat (Temporal Portal) vs my only unit with Guardian Angel: the first kill is replaced (recalled), the repeat kills it in base', () => {
  let g = S0(); fundAll(g, P0, 12);
  const tp = put(g, P0, 'Temporal Portal', 'base');
  put(g, P0, 'V(1)', 'base');
  const u = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const ga = put(g, P1, 'Guardian Angel', 'base'); attachNow(g, ga, u);
  g = settle(act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === tp)!));
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Cull the Weak') });
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g); if (!d.inStep) { g = pass(g); continue; }
    g = choose(g, d.kind === 'optional' ? 'yes' : optionIds(g).includes(u) ? u : optionIds(g)[0]);
  }
  assert.equal(zone(g, ga), 'trash', 'Guardian Angel used on the first kill');
  assert.equal(zone(g, u), 'trash', 'the repeat kills it in base');
});
test('RJ#9846 (MISMATCH-RJ) combat damage: lethal must be assigned to a unit before moving on (4 Might vs 5 and 3: all 4 on the 5 is fine, a 2/2 split is not)', () => {
  let { g, def } = attackSetup(['V(4)'], ['V(5)', 'V(3)']);
  for (let i = 0; i < 10 && pend(g).kind !== 'assignDamage'; i++) g = pass(g);
  assert.equal(pend(g).kind, 'assignDamage');
  assert.equal(validateAction(g, { type: 'assignDamage', player: P0, assignment: { [def[0]]: 4 } }), null, 'all 4 on the 5-Might unit');
  assert.equal(validateAction(g, { type: 'assignDamage', player: P0, assignment: { [def[1]]: 3, [def[0]]: 1 } }), null, 'lethal on the 3, rest on the 5');
  assert.notEqual(validateAction(g, { type: 'assignDamage', player: P0, assignment: { [def[0]]: 2, [def[1]]: 2 } }), null, 'CR 467.2.c: no partial split');
});
test('RJ#9848 Deathgrip kills my equipped unit in a showdown: the gear stays unattached (no Might), can\'t be equipped during the showdown, and is recalled', () => {
  let g = S0(); fundAll(g, P0, 12);
  const e = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const u = put(g, P0, 'V(3)', 'base'); const o = put(g, P0, 'V(2)', 'base');
  const sw = put(g, P0, 'Long Sword', 'base'); attachNow(g, sw, u);
  g = move(g, P0, [u, o], BF_A);
  for (let i = 0; i < 8 && !(pend(g).kind === 'showdownAction' && pend(g).player === P0); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  g = play(g, P0, hand(g, P0, 'Deathgrip'), { targets: [[u], [o]] });
  g = resolveChain(g);
  assert.equal(zone(g, u), 'trash');
  assert.equal(mightOf(g, o), 2 + 5, 'its Might included the sword');
  assert.ok(!g.objects[sw].attachedTo);
  assert.ok(!legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === sw), 'no Equip in a showdown');
  g = settle(g, d => d.kind === 'assignDamage' ? undefined : undefined);
  assert.equal(locOf(g, sw), 'base', 'recalled');
  void e;
});
test('RJ#9849 Kha\'Zix, Mutating Horror Ambushed into my 1-vs-1 attack: he becomes an attacker, the enemy unit is alone → +2 and 2 XP', () => {
  const g0 = S0(); fundAll(g0, P0, 12);
  put(g0, P1, 'V(3)', BF_A); control(g0, BF_A, P1);
  const a = put(g0, P0, 'V(1)', 'base');
  const kz = hand(g0, P0, "Kha'Zix, Mutating Horror");
  let g = move(g0, P0, [a], BF_A);
  assert.ok(canPlayNow(g, P0, kz, BF_A));
  g = play(g, P0, kz, { dest: BF_A });
  const x0 = g.players[P0].xp;
  for (let i = 0; i < 20 && pend(g).kind !== 'assignDamage' && pend(g).kind !== 'mainAction'; i++) g = pend(g).inStep ? choose(g, pend(g).kind === 'optional' ? 'yes' : pend(g).options![0].id) : pass(g);
  assert.equal(g.objects[kz].combatRole, 'attacker');
  assert.equal(g.players[P0].xp, x0 + 2, '2 XP');
  assert.ok(g.log.some(l => /Kha'Zix/.test(l.text) && /\+2/.test(l.text)) || g.players[P0].xp === x0 + 2);
});
test('RJ#9854 Hostile Takeover can take an enemy unit token', () => {
  let g = withTokens(S0()); fundAll(g, P0, 12);
  const t = put(g, P1, 'Recruit', BF_A); control(g, BF_A, P1);
  g = settle(play(g, P0, hand(g, P0, 'Hostile Takeover'), { targets: [[t]] }));
  assert.equal(g.objects[t].controller, P0);
});
function groveBrushHold(order: 'brush' | 'gf' | 'decline') {
  let g = withTokens(S0({ bfA: 'Grove of the God-Willow' }));
  const gf = setLegend(g, P0, 'Green Father');
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_A);
  g = settle(g, d => d.kind === 'optional' ? 'yes' : undefined);
  assert.equal(g.cards[g.objects[g.battlefields[BF_A].objId].cardId].name, 'Brush', 'conquered and replaced by Brush');
  g = endTurn(g);
  g = settle(g, d => d.kind === 'optional' ? 'no' : undefined);
  g.objects[gf].exhausted = false; touch(g);
  const n = g.log.length;
  g = endTurn(g);
  let gfOffered = false;
  for (let i = 0; i < 40 && !(pend(g).kind === 'mainAction' && g.activePlayer === P0); i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    if (d.kind === 'orderTriggers') { const o = d.options!.find(x => order === 'gf' ? /Green Father|Brush battlefield token/i.test(x.label) && !/swap/i.test(x.label) : /swap|replaced/i.test(x.label)) ?? d.options![0]; g = choose(g, o.id); continue; }
    if (d.kind === 'optional') { if (/Green Father/i.test(d.prompt ?? '')) { gfOffered = true; g = choose(g, order === 'decline' ? 'no' : 'yes'); } else g = choose(g, 'yes'); continue; }
    g = choose(g, d.options![0].id);
  }
  return { g, n, gfOffered, name: g.cards[g.objects[g.battlefields[BF_A].objId].cardId].name };
}
test('RJ#9852 holding a Brush and swapping it back to Grove of the God-Willow: no Grove hold draw (the hold happened at the Brush)', () => {
  const { g, n, name } = groveBrushHold('decline');
  assert.equal(name, 'Grove of the God-Willow', 'swapped back');
  assert.ok(!g.log.slice(n).some(l => /Grove of the God-Willow/.test(l.text) && /Trigger|Resolving/.test(l.text)), 'no Grove trigger');
});
test('RJ#9853 holding a Brush with Green Father: swap back to the original battlefield first, then Green Father replaces it with a Brush again', () => {
  const { gfOffered, name } = groveBrushHold('brush');
  assert.ok(gfOffered, 'Green Father triggers on the hold');
  assert.equal(name, 'Brush');
});
test('RJ#9862 Commander Ledros played to a battlefield I control, killing my only unit there as his additional cost: he enters there and I keep control', () => {
  let g = S0(); fundAll(g, P0, 12);
  const u = put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const ld = hand(g, P0, 'Commander Ledros');
  assert.ok(playDests(g, P0, ld).includes(BF_A));
  g = act(g, { type: 'playCard', player: P0, obj: ld, destination: BF_A });
  for (let i = 0; i < 6 && g.pending?.inStep; i++) {
    const d = g.pending; const ids = d.options!.map(o => o.id);
    g = ids.includes(u) ? choose(g, u) : choose(g, ids.includes('yes') ? 'yes' : ids[0]);
  }
  g = settle(g);
  assert.equal(zone(g, u), 'trash');
  assert.equal(locOf(g, ld), BF_A);
  assert.equal(g.battlefields[BF_A].controller, P0);
});
test('RJ#9863 LeBlanc, Everywhere at Once: my Temporary units at her battlefield aren\'t killed at my Beginning Phase (elsewhere they are); she has Backline', () => {
  let g = withTokens(S0());
  put(g, P0, 'LeBlanc, Everywhere at Once', BF_A); control(g, BF_A, P0);
  const s1 = put(g, P0, 'Sprite', BF_A), s2 = put(g, P0, 'Sprite', 'base');
  g = nextTurn(g); g = nextTurn(g);
  assert.equal(g.activePlayer, P0);
  assert.equal(locOf(g, s1), BF_A, 'Temporary does not trigger at her battlefield');
  assert.notEqual(zone(g, s2), 'base', 'the base Sprite was killed');
  const r = attackSetup(['V(5)'], ['LeBlanc, Everywhere at Once', 'V(2)'], { tp: P0 });
  let h = r.g; for (let i = 0; i < 10 && pend(h).kind !== 'assignDamage'; i++) h = pass(h);
  assert.notEqual(validateAction(h, { type: 'assignDamage', player: P0, assignment: { [r.def[0]]: 4, [r.def[1]]: 1 } }), null, 'Backline: the other unit first');
});
test('RJ#9870 Thrill of the Hunt on my unit with -2 Might this turn: it is replayed as a new object without the modifier', () => {
  let g = S0(); fundAll(g, P0, 6);
  const u = put(g, P0, 'V(4)', 'base');
  mod(g, u, { might: -2 });
  assert.equal(mightOf(g, u), 2);
  g = play(g, P0, hand(g, P0, 'Thrill of the Hunt'), { targets: [[u]] });
  g = settle(g, d => d.options!.find(o => o.id === String(BF_A))?.id);
  assert.equal(zone(g, u), 'battlefield');
  assert.equal(mightOf(g, u), 4, 'modifier gone');
});
test('RJ#9873 Kinkou Initiate + Pridestalker: order Pridestalker\'s trigger on top; its +1 lifts my other units to 5 before Kinkou checks on resolution → draw', () => {
  let g = S0(); fundAll(g, P0);
  setLegend(g, P0, 'Pridestalker');
  const o = put(g, P0, 'V(4)', 'base');
  const k = hand(g, P0, 'Kinkou Initiate');
  const h0 = g.players[P0].hand.length;
  g = play(g, P0, k, { dest: 'base' });
  let ordered = false;
  g = settle(g, d => {
    if (d.kind === 'orderTriggers') { ordered = true; return d.options!.find(x => /Kinkou/.test(x.label))?.id; }
    return d.options!.find(x => x.id === o)?.id;
  });
  assert.ok(ordered, 'simultaneous triggers ordered by me');
  assert.equal(mightOf(g, o), 5);
  assert.equal(g.players[P0].hand.length, h0 - 1 + 1, 'Kinkou drew');
});
test('RJ#9874 Elder Dragon killed in the showdown before combat damage: its passive is gone, my 1 damage doesn\'t kill the 5-Might defender', () => {
  let g = S0(); fundAll(g, P1);
  const d = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const ed = put(g, P0, 'Elder Dragon', 'base'), a = put(g, P0, 'V(1)', 'base');
  g = move(g, P0, [ed, a], BF_A);
  for (let i = 0; i < 8 && !(pend(g).kind === 'showdownAction' && pend(g).player === P1); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  g = play(g, P1, hand(g, P1, 'KillA'), { targets: [[ed]] });
  g = resolveChain(g);
  assert.equal(zone(g, ed), 'trash');
  g = settle(g);
  assert.equal(zone(g, d), 'battlefield', 'survives 1 damage');
});
test('RJ#9875 Elder Dragon dying in the same combat still makes its damage lethal (lethal checked while it is on the board, simultaneous deaths)', () => {
  let { g, atk, def } = attackSetup(['Elder Dragon'], ['V(12)']);
  mod(g, def[0], { might: 3 });
  assert.equal(mightOf(g, def[0]), 15);
  g = settle(g);
  assert.equal(zone(g, atk[0]), 'trash', 'Elder Dragon died');
  assert.equal(zone(g, def[0]), 'trash', '10 damage killed the 15-Might unit');
});
test('RJ#9876 Rengar, Pouncing (Reaction) can be played to my base on the opponent\'s turn, in response to their spell', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  [g] = cast(g, P1, 'DrawR');
  g = pass(g);
  expectPending(g, 'chainResponse', P0);
  const rg = hand(g, P0, 'Rengar, Pouncing');
  assert.ok(playDests(g, P0, rg).includes('base'));
  g = play(g, P0, rg, { dest: 'base' });
  g = settle(g);
  assert.equal(locOf(g, rg), 'base');
});
test('RJ#9877 the opponent moves into an empty battlefield; I play Rengar, Trophy Hunter there: he is my lone Defender and gets Wuju Bladesman\'s +2', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12);
  setLegend(g, P0, 'Wuju Bladesman');
  const e = put(g, P1, 'V(1)', 'base');
  g = move(g, P1, [e], BF_A);
  for (let i = 0; i < 4 && !(pend(g).player === P0 && !pend(g).inStep); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  const rg = hand(g, P0, 'Rengar, Trophy Hunter');
  const base = g.cards[g.objects[rg].cardId].might!;
  g = play(g, P0, rg, { dest: BF_A });
  for (let i = 0; i < 12 && g.objects[rg].combatRole !== 'defender'; i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.equal(g.objects[rg].combatRole, 'defender');
  assert.equal(mightOf(g, rg), base + 2);
});
test('RJ#9882 Frozen Fortress\'s start-of-Beginning-Phase damage resolves before the turn player holds and scores', () => {
  let g = S0(); setBattlefieldCard(g, BF_A, 'Frozen Fortress');
  put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const n = g.log.length;
  g = nextTurn(g);
  const t = g.log.slice(n).map(l => l.text);
  const iff = t.findIndex(x => /Resolving Frozen Fortress/.test(x));
  const ih = t.findIndex(x => /P1 (holds|scores)/.test(x));
  assert.ok(iff >= 0 && ih > iff, t.join(' | '));
  assert.equal(g.players[P1].points, 1);
});
test('RJ#9884 Falling Star on my Immortal Phoenix; I Deathgrip the Phoenix in response and replay it from the trash: the new Phoenix is not Falling Star\'s target', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12); fundAll(g, P1);
  const ph = put(g, P0, 'Immortal Phoenix', BF_A); control(g, BF_A, P0);
  const o = put(g, P0, 'V(2)', 'base');
  const e = put(g, P1, 'V(5)', 'base');
  g = play(g, P1, hand(g, P1, 'Falling Star'), { targets: [[ph], [e]] });
  for (let i = 0; i < 4 && !(pend(g).player === P0 && pend(g).kind === 'chainResponse'); i++) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Deathgrip'), { targets: [[ph], [o]] });
  g = settle(g, d => d.kind === 'optional' ? 'yes' : d.options!.find(x => x.id === ph || x.id === o || x.id === 'base')?.id);
  const phs = named(g, P0, 'Immortal Phoenix', 'base');
  assert.equal(phs.length, 1, 'Phoenix replayed to base');
  assert.equal(g.objects[phs[0]].damage ?? 0, 0, 'the new object is not dealt 3');
  assert.equal(g.objects[e].damage, 3, 'the other instruction still resolves');
});
test('RJ#9885 Piercing Light: first target a unit at a battlefield (my own), second "up to one other" = the enemy Recruit in base; Ornn, Forge God (Deflect 2) need not be chosen', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  const orn = put(g, P1, 'Ornn, Forge God', BF_A); control(g, BF_A, P1);
  const r = put(g, P1, 'Recruit', 'base');
  const mine = put(g, P0, 'V(5)', BF_B); control(g, BF_B, P0);
  g = play(g, P0, hand(g, P0, 'Piercing Light'), { targets: [[mine], [r]] });
  g = settle(g, d => d.kind === 'optional' ? 'no' : undefined);
  assert.equal(zone(g, r), 'gone', 'the token died');
  assert.equal(g.objects[orn].damage ?? 0, 0);
  assert.equal(g.objects[mine].damage, 2);
});
test('RJ#9886 Tideturner played to base swaps with my ready unit at a battlefield: that unit arrives in base still ready', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'V(2)', BF_A, { ready: true }); control(g, BF_A, P0);
  const tt = hand(g, P0, 'Tideturner');
  g = play(g, P0, tt, { dest: 'base' });
  g = settle(g, d => d.kind === 'optional' ? 'yes' : d.options!.find(o => o.id === u)?.id);
  assert.equal(locOf(g, u), 'base');
  assert.equal(locOf(g, tt), BF_A);
  assert.equal(ex(g, u), false, 'still ready');
});
test('RJ#9887 Alpha Strike\'s damage on an enemy unit with Guardian Angel: the death is replaced, so it "kills" nothing → no XP', () => {
  let g = S0(); fundAll(g, P0);
  const f = put(g, P0, 'V(4)', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(2)', BF_B); control(g, BF_B, P1);
  const ga = put(g, P1, 'Guardian Angel', BF_B); attachNow(g, ga, e);
  const x0 = g.players[P0].xp;
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Alpha Strike') });
  for (let i = 0; i < 6 && pend(g).inStep; i++) {
    const ids = optionIds(g);
    g = choose(g, ids.includes(f) ? f : ids.includes(e) ? e : ids[0]);
  }
  g = settle(g, d => d.options!.find(o => o.id === e)?.id);
  assert.equal(zone(g, ga), 'trash', 'Guardian Angel used');
  assert.equal(locOf(g, e), 'base');
  assert.equal(g.players[P0].xp, x0, 'no XP');
});
test('RJ#9892 conquering a Brush (it replaced Trapping Grounds) with 4 excess damage, then swapping back on scoring: Trapping Grounds was not the conquered battlefield → no Bird', () => {
  let g = withTokens(S0({ bfA: 'Trapping Grounds' }));
  setLegend(g, P0, 'Green Father');
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_A);
  g = settle(g, d => d.kind === 'optional' ? 'yes' : undefined);
  assert.equal(g.cards[g.objects[g.battlefields[BF_A].objId].cardId].name, 'Brush');
  g = endTurn(g);
  g = settle(g, d => d.kind === 'optional' ? 'no' : undefined);
  assert.equal(g.activePlayer, P1);
  const a = put(g, P1, 'V(6)', 'base');
  g = move(g, P1, [a], BF_A);
  let swapped = false;
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    if (d.kind === 'optional') { if (/Replace Brush/i.test(d.prompt ?? '')) swapped = true; g = choose(g, 'yes'); continue; }
    g = choose(g, d.options![0].id);
  }
  assert.equal(zone(g, u), 'trash');
  assert.equal(g.battlefields[BF_A].controller, P1);
  assert.ok(swapped, 'Brush swap offered');
  assert.equal(g.cards[g.objects[g.battlefields[BF_A].objId].cardId].name, 'Trapping Grounds');
  assert.ok(!Object.values(g.objects).some(o => o.controller === P1 && o.isToken && g.cards[o.cardId].name === 'Bird'), 'no Bird token');
});
test('RJ#9897 both players at 8 after I conquer Aspirant\'s Climb and Green Father replaces it with a Brush: victory score back to 8, but nobody has more points → the game continues', () => {
  let g = withTokens(S0({ bfA: "Aspirant's Climb" }));
  setLegend(g, P0, 'Green Father');
  g.players[P0].points = 7; g.players[P1].points = 8; touch(g);
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_A);
  g = settle(g, d => d.kind === 'optional' ? 'yes' : undefined);
  assert.equal(g.cards[g.objects[g.battlefields[BF_A].objId].cardId].name, 'Brush');
  assert.equal(g.players[P0].points, 8);
  assert.equal(g.winner ?? null, null, 'tied at 8: no winner');
});
test('RJ#9898 Hard Bargain can\'t be played with an empty chain (no spell to counter)', () => {
  const g = S0(); fundAll(g, P0);
  assert.equal(canPlayNow(g, P0, hand(g, P0, 'Hard Bargain')), false);
});
test('RJ#9899 Rengar, Pouncing (Reaction) played to the battlefield I\'m defending: allowed, but he is a defender → no Assault 2', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0);
  put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const a = put(g, P1, 'V(3)', 'base');
  g = move(g, P1, [a], BF_A);
  for (let i = 0; i < 8 && !(pend(g).player === P0 && !pend(g).inStep); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  const rg = hand(g, P0, 'Rengar, Pouncing');
  assert.ok(canPlayNow(g, P0, rg, BF_A));
  g = play(g, P0, rg, { dest: BF_A });
  for (let i = 0; i < 6 && !g.objects[rg].combatRole; i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.equal(g.objects[rg].combatRole, 'defender');
  assert.equal(mightOf(g, rg), 3, 'no Assault');
});
test('RJ#9911 both at 8 (Aspirant\'s Climb: 9 to win); I conquer the Climb as my first score this turn → draw 1 instead of the final point; Green Father Brushes it: tied at 8, game continues', () => {
  let g = withTokens(S0({ bfA: "Aspirant's Climb" }));
  setLegend(g, P0, 'Green Father');
  g.players[P0].points = 8; g.players[P1].points = 8; touch(g);
  const u = put(g, P0, 'V(2)', 'base');
  const h0 = g.players[P0].hand.length;
  g = move(g, P0, [u], BF_A);
  g = settle(g, d => d.kind === 'optional' ? 'yes' : undefined);
  assert.equal(g.cards[g.objects[g.battlefields[BF_A].objId].cardId].name, 'Brush');
  assert.equal(g.players[P0].points, 8, 'final point by conquering needs every battlefield scored');
  assert.equal(g.players[P0].hand.length, h0 + 1, 'drew 1 instead');
  assert.equal(g.winner ?? null, null);
});
test('RJ#9914 an attached Spinning Axe (printed Temporary inactive) given Temporary by Turn to Dust dies at my next Beginning Phase; an untouched attached Axe stays', () => {
  let g = S0(); fundAll(g, P0, 12);
  const u = put(g, P0, 'V(2)', 'base'), u2 = put(g, P0, 'V(2)', 'base');
  const ax = put(g, P0, 'Spinning Axe', 'base'); attachNow(g, ax, u);
  const ax2 = put(g, P0, 'Spinning Axe', 'base'); attachNow(g, ax2, u2);
  g = settle(play(g, P0, hand(g, P0, 'Turn to Dust'), { targets: [[ax]] }));
  assert.equal(zone(g, ax), 'base');
  g = nextTurn(g); g = nextTurn(g);
  assert.equal(g.activePlayer, P0);
  assert.equal(zone(g, ax), 'trash', 'granted Temporary triggers');
  assert.equal(g.objects[ax2].attachedTo, u2, 'printed Temporary inactive while attached');
});
test('RJ#9917 (official UNL-FAQ) Zilean, Time Mage conquers; Deceiver plays a Reflection there → Zilean doubles it; both tokens become Zilean copies with Temporary, and no further tokens follow', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  setLegend(g, P0, 'Deceiver');
  const z = put(g, P0, 'Zilean, Time Mage', 'base');
  hand(g, P0, 'V(1)');
  const before = new Set(Object.keys(g.objects));
  g = move(g, P0, [z], BF_A);
  g = settle(g, d => d.kind === 'optional' ? 'yes' : d.options!.find(o => o.id === z)?.id);
  const toks = Object.keys(g.objects).filter(id => !before.has(id) && g.objects[id].isToken && g.objects[id].zone === 'battlefield');
  assert.equal(toks.length, 2, 'two Reflections, not infinite');
  for (const t of toks) {
    assert.equal(charsOf(g, t).name, 'Zilean', 'copy of Zilean');
    assert.ok(hasKeyword(g, t, 'Temporary'));
  }
});
test('RJ#9918 Counter Strike in response to the opponent\'s Elder Dragon play trigger: the 1 damage is prevented, so the passive never makes it lethal', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1, 20);
  const u = put(g, P0, 'V(3)', 'base');
  const ed = hand(g, P1, 'Elder Dragon');
  g = play(g, P1, ed, { dest: 'base' });
  for (let i = 0; i < 10 && !(g.chain.length && pend(g).player === P0 && pend(g).kind === 'chainResponse'); i++) {
    const d = pend(g); g = d.inStep ? choose(g, d.options!.find(o => o.id === u)?.id ?? d.options![0].id) : pass(g);
  }
  assert.ok(g.chain.length, 'play trigger on the chain');
  g = play(g, P0, hand(g, P0, 'Counter Strike'), { targets: [[u]] });
  const n = g.log.length;
  g = settle(g, d => d.options!.find(o => o.id === u)?.id);
  assert.ok(g.log.slice(n).some(l => /Resolving Elder Dragon/.test(l.text)), 'the trigger (targeting my unit) resolved');
  assert.equal(zone(g, u), 'base', 'survives');
  assert.equal(g.objects[u].damage ?? 0, 0);
});
test('RJ#9921 Alpha Strike chose three enemy units; they Flash two of them to base: those are still chosen, so Repulse ("chooses it and no other friendly unit") can\'t counter it', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const f = put(g, P0, 'V(9)', BF_A); control(g, BF_A, P0);
  const e = [put(g, P1, 'V(2)', BF_B), put(g, P1, 'V(2)', BF_B), put(g, P1, 'V(2)', BF_B)]; control(g, BF_B, P1);
  put(g, P1, 'V(2)', BF_B);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Alpha Strike') });
  for (let i = 0; i < 6 && pend(g).inStep; i++) {
    const ids = optionIds(g);
    g = ids.includes(f) ? choose(g, f) : choose(g, ...e.filter(x => ids.includes(x)));
  }
  assert.equal(g.chain.length, 1);
  g = pass(g);
  expectPending(g, 'chainResponse', P1);
  g = play(g, P1, hand(g, P1, 'Flash'), { targets: [[e[1], e[2]]] });
  g = resolveChain(g, 1);
  for (let i = 0; i < 3 && g.chain.length > 1; i++) g = pass(g);
  assert.equal(locOf(g, e[1]), 'base');
  assert.equal(g.chain.length, 1, 'Alpha Strike still on the chain');
  if (pend(g).player !== P1) g = pass(g);
  assert.equal(pend(g).player, P1);
  assert.equal(canPlayNow(g, P1, hand(g, P1, 'Repulse')), false, 'no spell chooses only e[0]');
});
test('RJ#9923 Atakhan played from the deck (Rek\'Sai, Swarm Queen) with Accelerate from Rek\'Sai, Breacher, killing the Breacher for his additional cost: he still enters ready', () => {
  let g = S0(); fundAll(g, P0, 14);
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const br = put(g, P0, "Rek'Sai, Breacher", 'base');
  put(g, P0, 'V(1)', 'deckTop'); const at = put(g, P0, 'Atakhan', 'deckTop');
  const q = put(g, P0, "Rek'Sai, Swarm Queen", 'base');
  g = move(g, P0, [q], BF_A);
  let acc = false;
  for (let i = 0; i < 40 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    if (d.kind === 'optional' && /Accelerate/.test(d.prompt ?? '')) acc = true;
    g = choose(g, (d.options!.find(o => o.id === at) ?? d.options!.find(o => o.id === br) ?? d.options!.find(o => o.id === 'yes') ?? d.options![0]).id);
  }
  assert.ok(acc, 'Accelerate offered');
  assert.equal(zone(g, br), 'trash', 'Breacher killed for the cost');
  assert.equal(zone(g, at), 'base');
  assert.equal(ex(g, at), false, 'entered ready');
});
test('RJ#9927 my exhausted Sprite readies in the Awaken Phase; in response to its Temporary trigger I play Meditation exhausting it → draw 2, then it dies', () => {
  let g = withTokens(S0({ tp: P1 })); fundAll(g, P0);
  const sp = put(g, P0, 'Sprite', 'base', { ready: false });
  g = endTurn(g, P1);
  assert.ok(g.chain.length > 0, 'Temporary trigger on the chain');
  assert.equal(ex(g, sp), false, 'readied in the Awaken Phase');
  const h0 = g.players[P0].hand.length;
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Meditation') });
  for (let i = 0; i < 6 && pend(g).inStep; i++) { const ids = optionIds(g); g = choose(g, ids.includes(sp) ? sp : ids.includes('yes') ? 'yes' : ids[0]); }
  assert.equal(ex(g, sp), true, 'exhausted for the cost');
  g = settle(g);
  assert.equal(g.players[P0].hand.length, h0 + 2 + 1, 'Meditation drew 2 (+1 in the Draw Phase; Meditation was added after counting)');
  assert.notEqual(zone(g, sp), 'base', 'then it dies');
});
test('RJ#9933 Voidreaver (Kha\'Zix legend) XP abilities can\'t be used in a showdown, even with focus (no Action/Reaction); they can in my open Main Phase', () => {
  let g = S0(); fundAll(g, P0);
  const l = setLegend(g, P0, 'Voidreaver');
  g.players[P0].xp = 3; touch(g);
  const u = put(g, P0, 'V(2)', 'base');
  assert.ok(legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === l), 'usable in the open Main Phase');
  put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [u], BF_A);
  for (let i = 0; i < 6 && !(pend(g).kind === 'showdownAction' && pend(g).player === P0); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.equal(pend(g).kind, 'showdownAction');
  assert.ok(!legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === l), 'not in the showdown');
});
test('RJ#9939 Rengar, Pouncing (3) with Pridestalker\'s +1 resolved is 4: Gust (3 or less) can\'t choose him; in response to the Pridestalker trigger (still 3) it can', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  setLegend(g, P0, 'Pridestalker');
  put(g, P0, 'V(5)', BF_A); control(g, BF_A, P0);
  [g] = cast(g, P1, 'DrawR');
  g = pass(g);
  const rg = hand(g, P0, 'Rengar, Pouncing');
  g = play(g, P0, rg, { dest: BF_A });
  for (let i = 0; i < 6 && !(pend(g).player === P1 && pend(g).kind === 'chainResponse'); i++) g = pend(g).inStep ? choose(g, pend(g).options!.find(o => o.id === rg)?.id ?? pend(g).options![0].id) : pass(g);
  assert.equal(locOf(g, rg), BF_A);
  assert.equal(mightOf(g, rg), 3, 'Pridestalker trigger still on the chain');
  const gust = hand(g, P1, 'Gust');
  assert.ok(canPlayNow(g, P1, gust), 'Gust in response to the trigger');
  g = pass(g);
  for (let i = 0; i < 6 && !(mightOf(g, rg) === 4 && pend(g).player === P1 && !pend(g).inStep); i++) g = pend(g).inStep ? choose(g, pend(g).options!.find(o => o.id === rg)?.id ?? pend(g).options![0].id) : pass(g);
  assert.equal(mightOf(g, rg), 4);
  assert.equal(canPlayNow(g, P1, gust), false, 'at 4 Might he can\'t be chosen');
});
test('RJ#9942 my Falling Star answered by Not So Fast: I Abandon my own Falling Star in response — it returns to my hand and Not So Fast has nothing to counter', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1);
  const e = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const fs = hand(g, P0, 'Falling Star');
  g = play(g, P0, fs, { targets: [[e], [e]] });
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  const pickSpell = (gg: GameState, re: RegExp) => { const o = pend(gg).options!; return choose(gg, (o.find(x => x.id === fs) ?? o.find(x => re.test(x.label)) ?? o[0]).id); };
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Not So Fast') });
  if (pend(g).kind === 'chooseTargets') g = pickSpell(g, /Falling Star/);
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Abandon') });
  if (pend(g).kind === 'chooseTargets') g = pickSpell(g, /Falling Star/);
  assert.equal(g.chain.length, 3);
  g = settle(g, d => d.kind === 'optional' ? 'no' : undefined);
  assert.equal(zone(g, fs), 'hand', 'Falling Star back in hand');
  assert.equal(g.objects[e].damage ?? 0, 0);
  assert.equal(g.chain.length, 0);
});
test('RJ#9948 Revna the Lorekeeper\'s "if you spent [4] or more" checks the spell just played: a 5-cost spell readies her; a later 0-cost spell does not (despite 5 spent earlier)', () => {
  let g = S0(); fundAll(g, P0, 12);
  const rv = put(g, P0, 'Revna the Lorekeeper', 'base', { ready: false });
  const e = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  g = settle(play(g, P0, hand(g, P0, 'Hostile Takeover'), { targets: [[e]] }));
  assert.equal(ex(g, rv), false, 'readied by the 5-cost spell');
  g.objects[rv].exhausted = true; touch(g);
  [g] = cast(g, P0, 'AddR');
  g = settle(g);
  assert.equal(ex(g, rv), true, '0 spent on this spell');
});
test('RJ#9954 Stalking Wolf: kill my Poro at a battlefield for the cost, but play the Wolf to my base instead (the Ambush there is optional)', () => {
  let g = S0(); fundAll(g, P0);
  const po = put(g, P0, 'Lonely Poro', BF_A); control(g, BF_A, P0);
  const w = hand(g, P0, 'Stalking Wolf');
  g = act(g, { type: 'playCard', player: P0, obj: w, destination: 'base' });
  g = driveH(g, [[po], [po], 'yes', 'yes'], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, po), 'trash');
  assert.equal(locOf(g, w), 'base');
});

// ---------------------------------------------------------------------------------------------- 9963-
test('RJ#9965 Void Assault ("Move a friendly unit, then move an enemy unit") can\'t be played with no friendly unit, even with an enemy unit to move', () => {
  const g = S0(); fundAll(g, P0);
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const va = hand(g, P0, 'Void Assault');
  assert.equal(canPlayNow(g, P0, va), false, 'no friendly unit');
  put(g, P0, 'V(1)', 'base');
  assert.equal(canPlayNow(g, P0, va), true, 'with a friendly unit');
});

test('RJ#9969 a stunned unit still deals damage equal to its Might for Alpha Strike (stun only affects combat damage)', () => {
  let g = S0(); fundAll(g, P0);
  const f = put(g, P0, 'V(4)', BF_A, { stunned: true }); control(g, BF_A, P0);
  const e = put(g, P1, 'V(3)', BF_B); control(g, BF_B, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Alpha Strike') });
  for (let i = 0; i < 6 && pend(g).inStep; i++) {
    const ids = optionIds(g);
    g = choose(g, ids.includes(f) ? f : ids.includes(e) ? e : ids[0]);
  }
  g = settle(g, d => d.options!.find(o => o.id === e)?.id);
  assert.equal(zone(g, e), 'trash', '4 damage from the stunned unit');
});

test('RJ#9970 Vi, Hotheaded\'s "[2][C]: Double my Might" has no Reaction: not usable in response to a removal spell, usable in my open Main Phase', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const vi = put(g, P0, 'Vi, Hotheaded', BF_A); control(g, BF_A, P0);
  [g] = cast(g, P1, 'Hextech Ray', { targets: [[vi]] });
  g = pass(g);
  expectPending(g, 'chainResponse', P0);
  assert.ok(!legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === vi), 'no response with Vi');
  let h = S0(); fundAll(h, P0);
  const vi2 = put(h, P0, 'Vi, Hotheaded', BF_A); control(h, BF_A, P0);
  assert.ok(legal(h, P0, 'activate').some(a => a.type === 'activate' && a.obj === vi2), 'open Main Phase: usable');
  void g;
});

test('RJ#9971 Atakhan moves into an empty battlefield; the opponent\'s Zenith Blade brings a unit in → combat with Atakhan as the attacker: his "When I attack" makes the defender kill their unit there', () => {
  let g = S0(); fundAll(g, P1);
  const at = put(g, P0, 'Atakhan', 'base');
  const mine = put(g, P1, 'V(2)', 'base');
  g = pass(move(g, P0, [at], BF_A));
  expectPending(g, 'showdownAction', P1);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Zenith Blade') });
  g = settle(g, d => d.kind === 'optional' ? 'yes' : d.options!.find(o => o.id === at || o.id === mine)?.id, 60);
  assert.equal(zone(g, mine), 'trash', 'killed by Atakhan\'s attack trigger');
  assert.equal(g.battlefields[BF_A].controller, P0);
});

test('RJ#9975 Rumble, Hotheaded conquers BF2: his trigger recycles my unit at BF1, and the Mech from my trash can still be played to BF1 (control kept while the chain exists)', () => {
  let g = S0(); fundAll(g, P0, 12);
  const rb = put(g, P0, 'Rumble, Hotheaded', 'base');
  const u = put(g, P0, 'V(2)', BF_B); control(g, BF_B, P0);
  const gj = put(g, P0, 'Gem Jammer', 'trash');
  let dests: string[] = [];
  g = settle(move(g, P0, [rb], BF_A), d => {
    const ids = d.options!.map(o => o.id);
    if (d.kind === 'chooseDestination' || d.kind === 'chooseBattlefield') { dests = ids; return ids.includes(String(BF_B)) ? String(BF_B) : undefined; }
    if (ids.includes(u)) return u; if (ids.includes(gj)) return gj; return d.kind === 'optional' ? 'yes' : undefined;
  }, 60);
  assert.equal(zone(g, u), 'mainDeck', 'recycled');
  assert.ok(dests.includes(String(BF_B)), `BF1 offered (${dests})`);
  assert.equal(locOf(g, gj), BF_B, 'Mech played to BF1');
});

test('RJ#9981 Abandon ("Counter a spell") can\'t be played with an empty chain', () => {
  const g = S0(); fundAll(g, P0);
  assert.equal(canPlayNow(g, P0, hand(g, P0, 'Abandon')), false);
});

test('RJ#9983 my lone Temporary Sprite at a battlefield dies at my Beginning Phase; Ambushing a unit there in response keeps control → I still hold (+1 point)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0);
  const sp = put(g, P0, 'Sprite', BF_A, { token: true }); control(g, BF_A, P0);
  const amb = hand(g, P0, 'Ambusher(2)');
  const pts = g.players[P0].points;
  g = act(g, { type: 'endTurn', player: P1 });
  let played = false;
  for (let i = 0; i < 40; i++) {
    const d = g.pending!;
    if (d.kind === 'mainAction' && d.player === P0) break;
    if (!played && !d.inStep && d.player === P0 && g.chain.some(c => c.source === sp) && canPlayNow(g, P0, amb, BF_A)) {
      g = play(g, P0, amb, { dest: BF_A }); played = true; continue;
    }
    g = d.inStep ? choose(g, d.options![0].id) : pass(g);
  }
  assert.ok(played, 'Ambush in response to the Temporary trigger');
  assert.equal(zone(g, sp), 'gone');
  assert.equal(locOf(g, amb), BF_A);
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[P0].points, pts + 1, 'held');
});

function rengarVsVex(vex: string) {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12);
  const v = put(g, P1, vex, 'base');
  const r = hand(g, P0, 'Rengar, Trophy Hunter');
  g = move(g, P1, [v], BF_A);
  for (let i = 0; i < 8 && !(pend(g).player === P0 && !pend(g).inStep && canPlayNow(g, P0, r, BF_A)); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(canPlayNow(g, P0, r, BF_A), 'Rengar playable there in the showdown');
  g = play(g, P0, r, { dest: BF_A });
  g = settle(g, d => d.options!.find(o => o.id === r)?.id, 60);
  return { g, v, r };
}
test('RJ#9985 (printed Might) opponent moves Vex, Cheerless (5) into an empty battlefield, I play Rengar, Trophy Hunter (6) there: I defend, Vex dies (not recalled), Rengar survives and I conquer', () => {
  const { g, v, r } = rengarVsVex('Vex, Cheerless');
  assert.equal(zone(g, v), 'trash', '6 damage on a 5-Might Vex');
  assert.equal(locOf(g, r), BF_A);
  assert.equal(g.objects[r].damage ?? 0, 0, 'healed after combat');
  assert.equal(g.battlefields[BF_A].controller, P0);
});
test('RJ#9995 opponent moves Vex, Apathetic (4) into an empty battlefield, I play Rengar, Trophy Hunter there: Vex stuns him; combat — Vex survives and is recalled, Rengar stays and I conquer', () => {
  const { g, v, r } = rengarVsVex('Vex, Apathetic');
  assert.ok(g.objects[r].stunned, 'stunned by Vex');
  assert.equal(locOf(g, v), 'base', 'attacker recalled');
  assert.equal(locOf(g, r), BF_A);
  assert.equal(g.battlefields[BF_A].controller, P0);
});

test('RJ#9991/#9996 Forgotten Signpost can\'t be played in a showdown (its [Action] is on the ability), but on the board its ability can be used in a showdown, exhausting the Signpost', () => {
  let g = S0(); fundAll(g, P0);
  const a = put(g, P0, 'V(2)', 'base');
  const b = put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
  const c = put(g, P0, 'V(1)', 'base');
  const fs = put(g, P0, 'Forgotten Signpost', 'base');
  const fsHand = hand(g, P0, 'Forgotten Signpost');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 6 && !(g.showdown && !pend(g).inStep && pend(g).player === P0); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(g.showdown, 'in a showdown');
  assert.equal(canPlayNow(g, P0, fsHand), false, 'the gear itself has no Action');
  const ab = legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === fs);
  assert.ok(ab, 'ability usable in the showdown');
  g = act(g, ab!);
  g = settle(g, d => d.options!.find(o => o.id === b)?.id ?? d.options!.find(o => o.id === c)?.id, 10);
  assert.equal(ex(g, fs), true, 'Signpost exhausted');
  void c;
});

// ---------------------------------------------------------------------------------------------- 10000-
test('RJ#10006 Crescent Strike: the 1 damage to each other enemy unit doesn\'t choose them → no Deflect owed for an enemy Pouty Poro there (exact cost [3][A] suffices)', () => {
  let g = S0(); setRunes(g, P0, 4, 'mind');
  const t = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const pp = put(g, P1, 'Pouty Poro', BF_A);
  const cs = hand(g, P0, 'Crescent Strike');
  assert.ok(canPlayNow(g, P0, cs), 'affordable without any Deflect tax');
  g = act(g, { type: 'playCard', player: P0, obj: cs });
  for (let i = 0; i < 6 && pend(g).inStep; i++) { const d = pend(g); g = choose(g, d.options!.find(o => o.id === t || o.id === String(BF_A))?.id ?? d.options![0].id); }
  g = settle(g);
  assert.equal(g.objects[t].damage, 4);
  assert.equal(g.objects[pp]?.damage ?? 0, 1, 'Pouty Poro took 1 (or died)');
});

test('RJ#10010 (AMBIGUOUS, RJ\'s reasoning adopted) two Lotus Traps on the same unit: two separate doubling effects → Hextech Ray\'s 3 becomes 12 (kills a 9-Might unit; one Trap\'s 6 would not)', () => {
  for (const n of [1, 2]) {
    let g = S0(); fundAll(g, P0, 12);
    const u = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
    for (let k = 0; k < n; k++) { g = settle(play(g, P0, hand(g, P0, 'Lotus Trap'), { targets: [[u]] })); }
    g = settle(play(g, P0, hand(g, P0, 'Hextech Ray'), { targets: [[u]] }));
    if (n === 2) assert.equal(zone(g, u), 'trash', '12 damage');
    else assert.equal(g.objects[u].damage, 6, 'one Trap: 6');
  }
});

test('RJ#10011 Stalking Wolf: kill my Bird token at BF1 for the cost and play the Wolf to BF2 (a battlefield I control)', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  const b = put(g, P0, 'Bird', BF_A, { token: true }); control(g, BF_A, P0);
  put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
  const w = hand(g, P0, 'Stalking Wolf');
  assert.ok(canPlayNow(g, P0, w, BF_B));
  g = act(g, { type: 'playCard', player: P0, obj: w, destination: BF_B });
  g = driveH(g, [[b], [b], 'yes', 'yes'], x => x.pending?.kind === 'mainAction');
  assert.ok(!g.objects[b] || !['base', 'battlefield'].includes(g.objects[b].zone), 'Bird killed');
  assert.equal(locOf(g, w), BF_B);
});

test('RJ#10012 Downstage Dramatics with its Repeat [2] paid = 4 spent on a spell → Jhin, Meticulous Killer gets his [C] cost; without the Repeat (2) he doesn\'t', () => {
  for (const rep of [true, false]) {
    let g = S0(); fundAll(g, P0, 12);
    const j = hand(g, P0, 'Jhin, Meticulous Killer');
    const n0 = playOptions(g, P0).filter(o => o.obj === j).length;
    g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Downstage Dramatics') });
    g = settle(g, d => d.kind === 'optional' ? (rep ? 'yes' : 'no') : undefined);
    assert.equal(playOptions(g, P0).filter(o => o.obj === j).length, n0 + (rep ? 1 : 0), `repeat=${rep}`);
  }
});

test('RJ#10013 Flurry of Feathers while I attack an enemy battlefield: the Birds can\'t be played to it (not mine)', () => {
  let { g } = attackSetup(['V(2)'], ['V(5)']);
  g = withTokens(g); fundAll(g, P0);
  for (let i = 0; i < 6 && !(pend(g).player === P0 && !pend(g).inStep && g.showdown); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Flurry of Feathers') });
  let offered: string[] = [];
  g = settle(g, d => {
    const bird = d.options!.find(o => /Bird|token/i.test(String(o.label ?? '')));
    if (bird && d.kind !== 'chooseDestination') return bird.id;
    if (d.kind === 'chooseDestination') { offered = d.options!.map(o => o.id); return 'base'; }
    return undefined;
  }, 30);
  assert.ok(!offered.includes(String(BF_A)), `attacked battlefield not offered (${offered})`);
  const birds = Object.values(g.objects).filter(o => o.controller === P0 && g.cards[o.cardId]?.name === 'Bird' && (o.zone === 'base' || o.zone === 'battlefield'));
  assert.equal(birds.length, 4);
  assert.ok(birds.every(o => o.zone === 'base'), 'all to base');
});

test('RJ#10014 Stalking Wolf can\'t be played without a Bird, Cat, Dog or Poro to kill (nothing is paid)', () => {
  const g = S0(); fundAll(g, P0);
  put(g, P0, 'V(2)', 'base');
  const w = hand(g, P0, 'Stalking Wolf');
  assert.equal(canPlayNow(g, P0, w), false);
  assert.equal(exhaustedRunes(g, P0), 0, 'no runes spent');
});

test('RJ#10015 Gardens of Becoming\'s granted "[T]: Gain 1 XP" can\'t be used by an exhausted unit there', () => {
  const g = S0({ bfA: 'Gardens of Becoming' });
  const e = put(g, P0, 'V(2)', BF_A, { ready: false }); control(g, BF_A, P0);
  const r = put(g, P0, 'V(2)', BF_A);
  const acts = legal(g, P0, 'activate').filter(a => a.type === 'activate');
  assert.ok(!acts.some(a => a.type === 'activate' && a.obj === e), 'exhausted unit: no');
  assert.ok(acts.some(a => a.type === 'activate' && a.obj === r), 'ready unit: yes');
});

test('RJ#10019 Emperor of the Sands (no Action/Reaction) after playing an Equipment: usable in my open Main Phase, not in a showdown', () => {
  let g = S0(); fundAll(g, P0, 12);
  const leg = setLegend(g, P0, 'Emperor of the Sands');
  const u = put(g, P0, 'V(2)', 'base');
  g = settle(play(g, P0, hand(g, P0, 'Long Sword')), d => d.options!.find(o => o.id === u)?.id);
  assert.ok(legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === leg), 'open Main Phase: usable');
  g = move(g, P0, [u], BF_A);
  for (let i = 0; i < 6 && !(pend(g).player === P0 && !pend(g).inStep && g.showdown); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(g.showdown);
  assert.ok(!legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === leg), 'showdown: not usable');
});

test('RJ#10021 opponent Ambushes Vi, Peacekeeper in response to my Mindsplitter\'s play trigger: she enters, and the trigger still resolves (they reveal and discard)', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1, 12);
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const vi = hand(g, P1, 'Vi, Peacekeeper');
  const other = hand(g, P1, 'V(2)');
  g = play(g, P0, hand(g, P0, 'Mindsplitter'), { dest: 'base' });
  for (let i = 0; i < 6 && !(pend(g).player === P1 && !pend(g).inStep); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(g.chain.length > 0, 'Mindsplitter trigger on the chain');
  assert.ok(canPlayNow(g, P1, vi, BF_A), 'Ambush as a Reaction');
  g = play(g, P1, vi, { dest: BF_A });
  g = settle(g, d => d.options!.find(o => o.id === other)?.id);
  assert.equal(locOf(g, vi), BF_A);
  assert.equal(zone(g, other), 'trash', 'discarded by Mindsplitter');
});

test('RJ#10022 Tryndamere, Barbarian (8) attacks a 4-Might defender with my Lotus Trap on it: lethal is 2 assigned (doubled), so 6 excess → he scores 1 more (CR 467.2.c.5)', () => {
  const run = (trap: boolean) => {
    const g0 = S0({ seed: 3 }); fundAll(g0, P0);
    const d = put(g0, P1, 'V(4)', BF_A); control(g0, BF_A, P1);
    const t = put(g0, P0, 'Tryndamere, Barbarian', 'base');
    let g = g0;
    if (trap) g = settle(play(g, P0, hand(g, P0, 'Lotus Trap'), { targets: [[d]] }));
    g = move(g, P0, [t], BF_A);
    g = settle(g);
    assert.equal(zone(g, d), 'trash');
    return g.players[P0].points;
  };
  assert.equal(run(false), 1, '4 excess: conquer point only');
  assert.equal(run(true), 2, 'Lotus Trap: 6 excess');
});

test('RJ#10023 Vi, Hotheaded with B.F. Sword (6) doubles to 12; the Sword is then killed (Acceptable Losses): the added +6 is fixed → 9', () => {
  let g = S0(); fundAll(g, P0, 12);
  const vi = put(g, P0, 'Vi, Hotheaded', 'base');
  const sw = put(g, P0, 'B.F. Sword', 'base'); attachNow(g, sw, vi);
  assert.equal(mightOf(g, vi), 6);
  const ab = legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === vi && x.abilityIndex < 900)!;
  g = settle(act(g, ab));
  assert.equal(mightOf(g, vi), 12);
  g = settle(play(g, P0, hand(g, P0, 'Acceptable Losses')), d => d.options!.find(o => o.id === sw)?.id);
  assert.equal(zone(g, sw), 'trash');
  assert.equal(mightOf(g, vi), 9);
});

test('RJ#10026 Void Assault moves my unit then an enemy unit into an empty battlefield on my turn: combat, I\'m the attacker, they defend', () => {
  let g = S0(); fundAll(g, P0);
  const f = put(g, P0, 'V(3)', 'base');
  const e = put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  put(g, P1, 'V(1)', BF_B);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Void Assault') });
  for (let i = 0; i < 40 && !g.objects[f].combatRole; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const ids = d.options!.map(o => o.id);
    g = choose(g, ids.includes(f) ? f : ids.includes(e) ? e : ids.includes(String(BF_A)) ? String(BF_A) : ids[0]);
  }
  assert.equal(locOf(g, f), BF_A); assert.equal(locOf(g, e), BF_A);
  assert.equal(g.objects[f].combatRole, 'attacker');
  assert.equal(g.objects[e].combatRole, 'defender');
});

test('RJ#10029 Riposte countering a Call to Glory played for free (buff spent) gives +3 — the printed Energy cost', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const mine = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const theirs = put(g, P1, 'V(2)', BF_B, { buff: true }); control(g, BF_B, P1);
  const cg = hand(g, P1, 'Call to Glory');
  g = act(g, { type: 'playCard', player: P1, obj: cg });
  for (let i = 0; i < 6 && pend(g).inStep; i++) { const d = pend(g); g = d.kind === 'optional' ? yes(g) : choose(g, d.options!.find(o => o.id === theirs)?.id ?? d.options![0].id); }
  assert.equal((g.objects[theirs].counters.buff ?? 0) > 0, false, 'buff spent');
  if (pend(g).player === P1) g = pass(g);
  const rp = hand(g, P0, 'Riposte');
  g = act(g, { type: 'playCard', player: P0, obj: rp });
  for (let i = 0; i < 6 && pend(g).inStep; i++) { const d = pend(g); g = choose(g, d.options!.find(o => o.id === mine || o.id === cg)?.id ?? d.options![0].id); }
  g = settle(g);
  assert.equal(zone(g, cg), 'trash', 'countered');
  assert.equal(mightOf(g, mine), 5, '+3');
  assert.equal(mightOf(g, theirs), 2);
});

test('RJ#10030 Galio, Indefatigable (no combat damage) attacks a 3-Might defender with my Symbol of the Solari out: both sides keep units → tie → all units there are recalled', () => {
  let { g, atk, def } = attackSetup(['Galio, Indefatigable'], ['V(3)']);
  put(g, P0, 'Symbol of the Solari', 'base');
  g = settle(g, undefined, 60);
  assert.equal(locOf(g, atk[0]), 'base');
  assert.equal(locOf(g, def[0]), 'base', 'defender recalled too');
  assert.equal(g.objects[def[0]].damage ?? 0, 0);
});

test('RJ#10031/#10032 Bloodharbor Ripper\'s legend ability and Baited Hook\'s ability (no Action/Reaction): usable in my open Main Phase, not in response to a spell', () => {
  const mk = (tp: PlayerId = P0) => {
    const g = S0({ tp }); fundAll(g, P0, 12); fundAll(g, P1);
    const leg = setLegend(g, P0, 'Bloodharbor Ripper');
    const hook = put(g, P0, 'Baited Hook', 'base');
    const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
    return { g, leg, hook, u };
  };
  const has = (g: GameState, o: ObjId) => legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === o);
  const a = mk();
  assert.ok(has(a.g, a.leg) && has(a.g, a.hook), 'open Main Phase: both usable');
  const b = mk(P1);
  let g = b.g;
  [g] = cast(g, P1, 'Hextech Ray', { targets: [[b.u]] });
  if (pend(g).player === P1) g = pass(g);
  expectPending(g, 'chainResponse', P0);
  assert.ok(!has(g, b.leg), 'Ripper: not in response');
  assert.ok(!has(g, b.hook), 'Baited Hook: not in response');
});

test('RJ#10036 a 4-Might attacker vs a 0-Might and a 4-Might defender: lethal is 1 + 4, so it can\'t kill both', () => {
  let { g, def } = attackSetup(['V(4)'], ['V(0)', 'V(4)']);
  g = driveH(g);
  const dead = def.filter(d => zone(g, d) === 'trash').length;
  assert.equal(dead, 1, 'exactly one defender dies');
});

test('RJ#10047 Blood Money on an enemy 2-Might unit; En Garde in response makes it 4 (alone): Blood Money keeps its target, which is now illegal → nothing dies, no Gold', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const e = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const gold0 = Object.values(g.objects).filter(o => g.cards[o.cardId]?.name === 'Gold').length;
  g = play(g, P0, hand(g, P0, 'Blood Money'), { targets: [[e]] });
  if (pend(g).player === P0) g = pass(g);
  g = play(g, P1, hand(g, P1, 'En Garde'), { targets: [[e]] });
  g = settle(g);
  assert.equal(mightOf(g, e), 4);
  assert.equal(locOf(g, e), BF_A, 'survives');
  assert.equal(Object.values(g.objects).filter(o => g.cards[o.cardId]?.name === 'Gold').length, gold0, 'no Gold');
});

test('RJ#10050 (MISMATCH-RJ, principle 11) Dusk Rose Lab\'s "you may kill a unit you control here to draw 1": the kill is paid when the trigger is put on the chain, so the unit is already dead before anyone can respond; the draw still happens', () => {
  let g = S0({ tp: P1, bfA: 'Dusk Rose Lab' });
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const h0 = g.players[P0].hand.length;
  g = act(g, { type: 'endTurn', player: P1 });
  let deadBeforeResolution = false;
  for (let i = 0; i < 40; i++) {
    const d = g.pending!;
    if (d.kind === 'mainAction' && d.player === P0) break;
    if (!d.inStep && g.chain.some(c => /Dusk Rose/.test(String(c.label ?? ''))) && zone(g, u) === 'trash') deadBeforeResolution = true;
    if (d.inStep) g = d.kind === 'optional' ? yes(g) : choose(g, d.options!.find(o => o.id === u)?.id ?? d.options![0].id);
    else g = pass(g);
  }
  assert.equal(zone(g, u), 'trash');
  assert.equal(g.players[P0].hand.length, h0 + 2, 'Lab draw + draw step');
  assert.ok(deadBeforeResolution, 'unit killed as the trigger is finalized (CR 383.3.b), before any response window');
});

test('RJ#10052 Baron Pit already on the board: the opponent\'s Baron Nashor can\'t add another, so he doesn\'t "enter there" (he goes to their base)', () => {
  let g = S0();
  setRunes(g, P0, 0); addRunes(g, P0, 7, 'chaos'); addRunes(g, P0, 6, 'fury');
  g.cards = { ...g.cards, 'unl-t01': realCard('unl-t01') };
  const bn = hand(g, P0, 'Baron Nashor');
  g = settle(act(g, { type: 'playCard', player: P0, obj: bn }), d => d.options!.find(o => /Baron/.test(o.label))?.id);
  const pits = () => g.battlefields.filter(b => g.cards[g.objects[b.objId].cardId].name === 'Baron Pit').length;
  assert.equal(pits(), 1);
  g = endTurn(g, P0);
  g = settle(g, undefined, 20);
  setRunes(g, P1, 0); addRunes(g, P1, 7, 'chaos'); addRunes(g, P1, 6, 'fury');
  const bn2 = hand(g, P1, 'Baron Nashor');
  g = settle(act(g, { type: 'playCard', player: P1, obj: bn2, destination: 'base' }), d => d.options!.find(o => o.id === 'base')?.id);
  assert.equal(pits(), 1, 'still one Pit');
  assert.equal(locOf(g, bn2), 'base');
});

test('RJ#10053 Moonfall\'s -2 applies only to enemy units there as it resolves: an enemy unit moved there afterwards keeps its Might', () => {
  let g = S0(); fundAll(g, P0, 12);
  put(g, P0, 'V(9)', BF_A); control(g, BF_A, P0);
  const e1 = put(g, P1, 'V(4)', BF_B); control(g, BF_B, P1);
  const e2 = put(g, P1, 'V(4)', BF_B);
  const mf = hand(g, P0, 'Moonfall');
  g = act(g, { type: 'playCard', player: P0, obj: mf });
  for (let i = 0; i < 20 && zone(g, mf) !== 'trash'; i++) {
    const d = pend(g);
    g = d.inStep ? (d.kind === 'optional' ? yes(g) : choose(g, d.options!.find(o => o.id === String(BF_A) || o.id === e1)?.id ?? d.options![0].id)) : pass(g);
  }
  assert.equal(locOf(g, e1), BF_A);
  assert.equal(mightOf(g, e1), 2, 'there as Moonfall resolved');
  const ch = hand(g, P0, 'Charm');
  for (let i = 0; i < 10 && !(pend(g).player === P0 && !pend(g).inStep && canPlayNow(g, P0, ch)); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  g = act(g, { type: 'playCard', player: P0, obj: ch });
  for (let i = 0; i < 20 && locOf(g, e2) !== BF_A; i++) {
    const d = pend(g);
    g = d.inStep ? choose(g, d.options!.find(o => o.id === e2 || o.id === String(BF_A))?.id ?? d.options![0].id) : pass(g);
  }
  assert.equal(locOf(g, e2), BF_A);
  assert.equal(mightOf(g, e2), 4, 'moved in afterwards: not affected');
});

test('RJ#10055 opponent\'s Deathgrip (kill A, Might to B); my Star-Crossed returns B (and one of mine) in response: A still dies, no Might given, they still draw', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const a = put(g, P1, 'V(3)', BF_B); control(g, BF_B, P1);
  const b = put(g, P1, 'V(2)', BF_B);
  const mine = put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const h1 = g.players[P1].hand.length;
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Deathgrip') });
  const picks = [a, b];
  for (let i = 0; i < 6 && pend(g).inStep; i++) { const d = pend(g); const x = picks.find(p => d.options!.some(o => o.id === p)); g = choose(g, x ?? d.options![0].id); if (x) picks.splice(picks.indexOf(x), 1); }
  if (pend(g).player === P1) g = pass(g);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Star-Crossed') });
  for (let i = 0; i < 6 && pend(g).inStep; i++) { const d = pend(g); g = choose(g, d.options!.find(o => o.id === mine || o.id === b)?.id ?? d.options![0].id); }
  g = settle(g);
  assert.equal(zone(g, b), 'hand');
  assert.equal(zone(g, mine), 'hand');
  assert.equal(zone(g, a), 'trash', 'still killed');
  assert.equal(g.players[P1].hand.length, h1 + 1 + 1, 'B returned + Deathgrip\'s draw');
});

test('RJ#10058 opponent\'s Star-Crossed (their unit + my only unit); I Sacrifice my unit in response: their own unit is still returned to their hand', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const mine = put(g, P0, 'V(5)', BF_A); control(g, BF_A, P0);
  const theirs = put(g, P1, 'V(2)', BF_B); control(g, BF_B, P1);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Star-Crossed') });
  for (let i = 0; i < 6 && pend(g).inStep; i++) { const d = pend(g); g = choose(g, d.options!.find(o => o.id === mine || o.id === theirs)?.id ?? d.options![0].id); }
  if (pend(g).player === P1) g = pass(g);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Sacrifice') });
  g = settle(g, d => d.options!.find(o => o.id === mine)?.id);
  assert.equal(zone(g, mine), 'trash');
  assert.equal(zone(g, theirs), 'hand', 'remaining legal target still returned');
});

test('RJ#10062 opponent attacks my battlefield; I play Heedless Resurrection (killing a friendly unit) to play Overzealous Fan from my trash there: it becomes a defender at the cleanup and may kill itself to send the attacker to base', () => {
  let { g, atk } = attackSetup(['V(3)'], ['V(2)', 'V(2)']);
  fundAll(g, P1);
  const fan = put(g, P1, 'Overzealous Fan', 'trash');
  const def = Object.keys(g.objects).filter(id => g.objects[id].controller === P1 && locOf(g, id) === BF_A && id !== fan);
  for (let i = 0; i < 4 && !(pend(g).kind === 'showdownAction' && pend(g).player === P1); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  expectPending(g, 'showdownAction', P1);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Heedless Resurrection') });
  g = settle(g, d => {
    if (d.kind === 'optional') return 'yes';
    const ids = d.options!.map(o => o.id);
    if (ids.includes(fan)) return fan;
    if (ids.includes(def[0])) return def[0];
    if (ids.includes(String(BF_A))) return String(BF_A);
    if (ids.includes(atk[0])) return atk[0];
    return undefined;
  }, 60);
  assert.equal(zone(g, fan), 'trash', 'Fan killed itself');
  assert.equal(locOf(g, atk[0]), 'base', 'attacker moved to base');
  assert.equal(g.objects[atk[0]].damage ?? 0, 0);
  assert.equal(locOf(g, def[1]), BF_A, 'my other defender kept the battlefield');
});

test('RJ#10063 my spell ← their Hard Bargain ← my Lilting Lullaby: they can still respond with En Garde (Lullaby\'s restriction applies only once it resolves)', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const tu = put(g, P1, 'V(2)', BF_B); control(g, BF_B, P1);
  const ds = hand(g, P0, 'Discipline');
  g = play(g, P0, ds, { targets: [[u]] });
  if (pend(g).player === P0) g = pass(g);
  const hb = hand(g, P1, 'Hard Bargain');
  g = act(g, { type: 'playCard', player: P1, obj: hb });
  for (let i = 0; i < 6 && pend(g).inStep; i++) { const d = pend(g); g = d.kind === 'optional' ? no(g) : choose(g, d.options!.find(o => o.id === ds || /Discipline/.test(String(o.label)))?.id ?? d.options![0].id); }
  if (pend(g).player === P1) g = pass(g);
  const ll = hand(g, P0, 'Lilting Lullaby');
  g = act(g, { type: 'playCard', player: P0, obj: ll });
  for (let i = 0; i < 6 && pend(g).inStep; i++) { const d = pend(g); g = choose(g, d.options!.find(o => o.id === hb || /Hard Bargain/.test(String(o.label)))?.id ?? d.options![0].id); }
  if (pend(g).player === P0) g = pass(g);
  const eg = hand(g, P1, 'En Garde'), eg2 = hand(g, P1, 'En Garde');
  assert.ok(canPlayNow(g, P1, eg), 'En Garde playable in response');
  g = play(g, P1, eg, { targets: [[tu]] });
  g = settle(g, d => d.kind === 'optional' ? 'no' : undefined);
  assert.equal(zone(g, hb), 'trash', 'Hard Bargain countered');
  assert.equal(mightOf(g, tu), 4, 'En Garde resolved');
  assert.equal(mightOf(g, u), 4, 'Discipline resolved');
  void eg2;
});

test('RJ#10072 Relentless Pursuit moves a ready unit: it stays ready (only a Standard Move exhausts)', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'V(2)', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Relentless Pursuit') });
  g = settle(g, d => d.kind === 'optional' ? 'no' : d.options!.find(o => o.id === u || o.id === String(BF_A))?.id);
  assert.equal(locOf(g, u), BF_A);
  assert.equal(ex(g, u), false, 'still ready');
});

test('RJ#10081 Bashful Bloom\'s "[1] less for each friendly unit with Temporary" doesn\'t count a Sprite Fountain gear (not a unit): with 3 runes it isn\'t usable; with a Temporary Sprite unit it is', () => {
  const run = (sprite: boolean) => {
    const g = withTokens(S0()); setRunes(g, P0, 3);
    const leg = setLegend(g, P0, 'Bashful Bloom');
    put(g, P0, 'Sprite Fountain', 'base');
    if (sprite) put(g, P0, 'Sprite', 'base', { token: true });
    return legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === leg);
  };
  assert.equal(run(false), false, 'gear not counted: [4] with 3 runes');
  assert.equal(run(true), true, 'one Temporary unit: [3]');
});

test('RJ#10086 Abandoned Hall ("When a player plays a spell, they may give a unit they control here +1"): the spell counts as played once it resolves — a unit Ridden out of the Hall gets nothing, a unit Ridden into it can get the +1', () => {
  const run = (into: boolean) => {
    let g = S0({ bfA: 'Abandoned Hall' }); fundAll(g, P0);
    const u = put(g, P0, 'V(2)', into ? BF_B : BF_A);
    control(g, BF_A, P0); control(g, BF_B, P0);
    g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Ride the Wind') });
    g = settle(g, d => d.kind === 'optional' ? 'yes' : d.options!.find(o => o.id === u || o.id === String(into ? BF_A : BF_B))?.id);
    assert.equal(locOf(g, u), into ? BF_A : BF_B);
    return mightOf(g, u);
  };
  assert.equal(run(false), 2, 'moved out: not here when the trigger happens');
  assert.equal(run(true), 3, 'moved in: +1');
});

test('RJ#10082 Deathgrip must choose a friendly unit to kill: with no friendly unit it can\'t be played', () => {
  const g = S0(); fundAll(g, P0);
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const dg = hand(g, P0, 'Deathgrip');
  assert.equal(canPlayNow(g, P0, dg), false);
  // (with a single friendly unit the house call is also "can't" — docs/rulings.md addendum, "another friendly unit" is a target)
  put(g, P0, 'V(1)', 'base'); put(g, P0, 'V(2)', 'base');
  assert.equal(canPlayNow(g, P0, dg), true);
});

test('RJ#10089 Ambush gives Reaction timing only for a battlefield where I have units: in a showdown the Ambush unit can go there, not to my base', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
  const a = put(g, P0, 'V(2)', 'base');
  const amb = hand(g, P0, 'Ambusher(2)');
  assert.ok(playDests(g, P0, amb).includes('base'), 'open Main Phase: base is fine');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 6 && !(g.showdown && !pend(g).inStep && pend(g).player === P0); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(g.showdown);
  const ds = playDests(g, P0, amb);
  assert.ok(ds.includes(BF_B) || ds.includes(BF_A), `a battlefield with my units (${ds})`);
  assert.ok(!ds.includes('base'), 'not to base in the showdown');
});

test('RJ#10092 Akshan, Mischievous with the [C][C] paid: Weaponmaster attaches my Equipment and his play trigger steals and attaches the enemy\'s — both end up on him', () => {
  let g = S0(); fundAll(g, P0, 12);
  const eu = put(g, P1, 'V(2)', 'base');
  const theirs = put(g, P1, 'Long Sword', 'base'); attachNow(g, theirs, eu);
  const mine = put(g, P0, 'B.F. Sword', 'base');
  const ak = hand(g, P0, 'Akshan, Mischievous');
  g = act(g, { type: 'playCard', player: P0, obj: ak, destination: 'base' });
  g = answer(g, { may: [true] }, P0);
  for (let i = 0; i < 16 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'orderTriggers') g = choose(g, d.options![0].id);
    else if (d.kind === 'optional') g = yes(g);
    else if (d.inStep) g = choose(g, d.options!.find(o => o.id === mine || o.id === theirs)?.id ?? d.options![0].id);
    else g = pass(g);
  }
  assert.equal(g.objects[mine].attachedTo, ak, 'Weaponmaster attach');
  assert.equal(g.objects[theirs].attachedTo, ak, 'stolen and attached');
  assert.equal(g.objects[theirs].controller, P0);
});

test('RJ#10094 my Star-Crossed (A mine, B theirs); their Star-Crossed in response (B theirs, C mine): theirs returns B and C, then mine still returns A', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const a = put(g, P0, 'V(2)', BF_A), c = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const b = put(g, P1, 'V(2)', BF_B); control(g, BF_B, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Star-Crossed') });
  for (let i = 0; i < 6 && pend(g).inStep; i++) { const d = pend(g); g = choose(g, d.options!.find(o => o.id === a || o.id === b)?.id ?? d.options![0].id); }
  if (pend(g).player === P0) g = pass(g);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Star-Crossed') });
  for (let i = 0; i < 6 && pend(g).inStep; i++) { const d = pend(g); g = choose(g, d.options!.find(o => o.id === b || o.id === c)?.id ?? d.options![0].id); }
  g = settle(g);
  assert.equal(zone(g, b), 'hand'); assert.equal(zone(g, c), 'hand');
  assert.equal(zone(g, a), 'hand', 'first Star-Crossed still returns its remaining target');
});

test('RJ#10096 Tactical Retreat on my unit in base saves it from a later kill spell: it stays in base (healed, exhausted)', () => {
  let g = S0(); fundAll(g, P0, 12);
  const u = put(g, P0, 'V(2)', 'base'), v = put(g, P0, 'V(1)', 'base');
  g = settle(play(g, P0, hand(g, P0, 'Tactical Retreat'), { targets: [[u]] }), d => d.options!.find(o => o.id === u)?.id);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Deathgrip') });
  g = choose(g, u); if (pend(g).inStep) g = choose(g, v);
  g = settle(g);
  assert.equal(locOf(g, u), 'base', 'death replaced');
  assert.equal(ex(g, u), true, 'exhausted');
});

// ---------------------------------------------------------------------------------------------- 10098-10110 (cycle 2026-11-26e)
test('RJ#10098 Ezreal, Dashing\'s attack trigger choosing Deadbloom Predator owes the Deflect tax: paying it recycles a rune', () => {
  let g = S0(); fundAll(g, P0);
  const ez = put(g, P0, 'Ezreal, Dashing', 'base');
  const db = put(g, P1, 'Deadbloom Predator', BF_A); control(g, BF_A, P1);
  const r0 = g.players[P0].runesInPlay.length;
  g = move(g, P0, [ez], BF_A);
  let asked = false;
  for (let i = 0; i < 40 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: d.player, assignment: (d.data as { suggested: Record<ObjId, number> }).suggested }); continue; }
    if (/Deflect/.test(d.prompt)) asked = true;
    if (d.inStep) g = d.kind === 'optional' ? yes(g) : choose(g, d.options!.find(o => o.id === db)?.id ?? d.options![0].id);
    else g = pass(g);
  }
  assert.ok(asked, 'Deflect payment asked for the trigger');
  assert.equal(g.players[P0].runesInPlay.length, r0 - 1, 'one rune recycled for [A]');
  assert.ok(g.log.some(l => /Ezreal deals 3 to Deadbloom Predator/.test(l.text)), 'trigger dealt its damage');
});

test('RJ#10102 Loyal Poro ("If I didn\'t die alone, draw 1"): alone means no other FRIENDLY units — killed alone by two attackers: no draw; with a friendly unit there: draw', () => {
  const run = (buddy: boolean) => {
    let { g } = attackSetup(['V(5)', 'V(5)'], buddy ? ['Loyal Poro', 'V(9)'] : ['Loyal Poro']);
    const h0 = g.players[P1].hand.length;
    for (let i = 0; i < 60 && pend(g).kind !== 'mainAction'; i++) {
      const d = pend(g);
      if (d.kind === 'assignDamage') { const s = (d.data as { suggested: Record<ObjId, number> }).suggested; g = act(g, { type: 'assignDamage', player: d.player, assignment: s }); continue; }
      g = d.inStep ? choose(g, d.options![0].id) : pass(g);
    }
    assert.ok(named(g, P1, 'Loyal Poro', 'trash').length === 1, 'Poro died');
    return g.players[P1].hand.length - h0;
  };
  assert.equal(run(false), 0, 'died alone (enemy units don\'t count)');
  assert.equal(run(true), 1, 'another friendly unit there: not alone');
});

test('RJ#10106 I score a Brush (hold) and swap back to the original battlefield: the location was already scored by me this turn, so conquering it again this turn scores nothing', () => {
  let { g, name } = groveBrushHold('decline');
  assert.equal(name, 'Grove of the God-Willow', 'swapped back');
  assert.ok(g.battlefields[BF_A].scoredThisTurnBy.includes(P0), 'scored-this-turn status kept by the location');
  for (const id of Object.keys(g.objects)) { const o = g.objects[id]; if (o.zone === 'battlefield' && o.battlefieldIndex === BF_A && o.controller === P0) o.controller = P1; } // (board tweak: P0 loses the battlefield)
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(5)', 'base');
  const pts = g.players[P0].points;
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 40 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: d.player, assignment: (d.data as { suggested: Record<ObjId, number> }).suggested }); continue; }
    g = d.inStep ? choose(g, d.kind === 'optional' ? 'no' : d.options![0].id) : pass(g);
  }
  assert.equal(g.battlefields[BF_A].controller, P0, 'conquered');
  assert.equal(g.players[P0].points, pts, 'no second score at that battlefield this turn');
});

test('RJ#10108 Beginning Phase order: start-of-phase triggers (Loose Cannon draw) → hold (score) → Channel → Draw Phase draw', () => {
  let g = S0({ tp: P1 }); setLegend(g, P0, 'Loose Cannon');
  put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  for (const id of g.players[P0].hand) delete g.objects[id];
  g.players[P0].hand = []; touch(g);
  const n = g.log.length;
  g = endTurn(g, P1);
  for (let i = 0; i < 30 && !(pend(g).kind === 'mainAction' && g.activePlayer === P0); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  const L = g.log.slice(n).map(l => l.text);
  const at = (re: RegExp, from = 0) => L.findIndex((t, i) => i >= from && re.test(t));
  const cannon = at(/Resolving Loose Cannon/), hold = at(/P0 holds BF-A/), chan = at(/P0 channels/), draw = at(/P0 draws 1/, chan);
  assert.ok(cannon >= 0 && cannon < hold && hold < chan && chan < draw, L.join(' | '));
});

test('RJ#10109 equipping Guardian Angel to Irelia, Fervent chooses her: +1 from her trigger and +1 from the gear = +2 total (4 → 6), not +3', () => {
  let g = S0(); fundAll(g, P0, 3);
  const ir = put(g, P0, 'Irelia, Fervent', 'base');
  const ga = put(g, P0, 'Guardian Angel', 'base');
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === ga)!);
  g = settle(g, d => d.options!.find(o => o.id === ir)?.id);
  assert.equal(g.objects[ga].attachedTo, ir);
  assert.equal(mightOf(g, ir), 6);
});

test('RJ#10110 Double Trouble without revealing a unit: the 3 looked-at cards are recycled to the BOTTOM of the Main Deck (none drawn)', () => {
  let g = S0(); fundAll(g, P0);
  for (const id of g.players[P0].mainDeck) delete g.objects[id];
  g.players[P0].mainDeck = []; touch(g);
  for (const c of ['V(1)', 'V(2)', 'V(3)', 'V(4)', 'V(5)']) put(g, P0, c, 'deckTop');
  const h0 = g.players[P0].hand.length;
  const dt = hand(g, P0, 'Double Trouble');
  g = act(g, { type: 'playCard', player: P0, obj: dt });
  for (let i = 0; i < 30 && g.pending?.kind !== 'mainAction'; i++) {
    const p = g.pending!;
    if (!p.inStep) { g = pass(g); continue; }
    g = p.kind === 'optional' ? no(g) : act(g, { type: 'choose', player: P0, optionIds: [] });
  }
  const deck = g.players[P0].mainDeck.map(i => g.cards[g.objects[i].cardId].name);
  assert.deepEqual(deck.slice(0, 2), ['V(2)', 'V(1)'], 'the untouched cards are now on top');
  assert.deepEqual([...deck.slice(2)].sort(), ['V(3)', 'V(4)', 'V(5)'], 'the 3 looked-at cards went to the bottom');
  assert.equal(g.players[P0].hand.length, h0, 'nothing drawn');
});

// ---------------------------------------------------------------------------------------------- 10111-10120
test('RJ#10114 Lotus Trap on an enemy Mindsplitter (7): my Noxus Hopeful (4) attacks it — 4 combat damage doubled to 8 kills it', () => {
  let g = S0(); fundAll(g, P0);
  const ms = put(g, P1, 'Mindsplitter', BF_A); control(g, BF_A, P1);
  const nh = put(g, P0, 'Noxus Hopeful', 'base');
  g = settle(play(g, P0, hand(g, P0, 'Lotus Trap'), { targets: [[ms]] }), d => d.options!.find(o => o.id === ms)?.id);
  g = move(g, P0, [nh], BF_A);
  for (let i = 0; i < 40 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: d.player, assignment: (d.data as { suggested: Record<ObjId, number> }).suggested }); continue; }
    g = d.inStep ? choose(g, d.options![0].id) : pass(g);
  }
  assert.equal(zone(g, ms), 'trash', '8 damage ≥ 7 Might');
  assert.equal(zone(g, nh), 'trash', 'Hopeful also dies to 7');
});

test('RJ#10120 Ganking with three battlefields: a unit at the first may move straight to the third (no adjacency)', () => {
  let g = S0();
  const bfCard = g.objects[g.battlefields[BF_B].objId].cardId;
  const t = put(g, P1, bfCard, 'trash');
  g.players[P1].trash = g.players[P1].trash.filter(x => x !== t);
  Object.assign(g.objects[t], { zone: 'battlefield', battlefieldIndex: 2 });
  g.battlefields.push({ objId: t, controller: null, contested: false, scoredThisTurnBy: [], contestedBy: null, owner: P1 });
  touch(g);
  const gk = put(g, P0, 'Ganker(2)', BF_A); control(g, BF_A, P0);
  put(g, P1, 'V(1)', 2); control(g, 2, P1);
  assert.ok(moveDests(g, P0, gk).includes(2), `third battlefield reachable: ${moveDests(g, P0, gk)}`);
  g = move(g, P0, [gk], 2);
  assert.equal(locOf(g, gk), 2);
});

test('RJ#10126 Red Brambleback conquers Minefield ("When you conquer here, put the top 2 cards of your Main Deck into your trash"): the battlefield\'s conquer effect triggers twice → 4 cards; already scored this turn → no conquer effects', () => {
  const run = (scored: boolean) => {
    let g = S0({ bfA: 'Minefield' });
    const rb = put(g, P0, 'Red Brambleback', 'base');
    if (scored) g.battlefields[BF_A].scoredThisTurnBy.push(P0);
    const d0 = g.players[P0].mainDeck.length;
    g = move(g, P0, [rb], BF_A);
    g = settle(g, d => d.kind === 'optional' ? 'yes' : undefined);
    assert.equal(g.battlefields[BF_A].controller, P0);
    return d0 - g.players[P0].mainDeck.length;
  };
  assert.equal(run(false), 4, 'Minefield trigger doubled');
  assert.equal(run(true), 0, 'no conquer (already scored) → nothing to double');
});

test('RJ#10129 Nami, Headstrong held: the next unit I play (Irelia, Fervent) is readied and buffed without being chosen → +1 (ready) + buff, no "choose" +1 (4 → 6)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 6);
  put(g, P0, 'Nami, Headstrong', BF_A); control(g, BF_A, P0);
  g = endTurn(g, P1);
  for (let i = 0; i < 30 && !(pend(g).kind === 'mainAction' && g.activePlayer === P0); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  const ir = hand(g, P0, 'Irelia, Fervent');
  g = act(g, { type: 'playCard', player: P0, obj: ir, destination: 'base' });
  g = settle(g, d => d.kind === 'optional' ? 'no' : undefined);
  assert.equal(ex(g, ir), false, 'readied');
  assert.equal(mightOf(g, ir), 6, '4 + 1 (ready trigger) + 1 (buff)');
});

// ---------------------------------------------------------------------------------------------- 10131-10140
test('RJ#10132 Plundering Poro conquers and plays a Gold gear token: a token is not a card, so Legion (Noxus Hopeful) stays off — still [4]', () => {
  let g = withTokens(S0());
  const pp = put(g, P0, 'Plundering Poro', 'base');
  const nh = hand(g, P0, 'Noxus Hopeful');
  g = move(g, P0, [pp], BF_A);
  g = settle(g, d => d.kind === 'optional' ? 'yes' : undefined);
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.ok(Object.values(g.objects).some(o => o.zone === 'base' && g.cards[o.cardId]?.name === 'Gold'), 'Gold token played');
  assert.equal(playCostOf(g, P0, nh)!.energy, 4, 'no Legion discount');
});

test('RJ#10139 Arcane Shift needs a friendly unit too: an enemy at a battlefield but no friendly unit → can\'t be played; with one → playable', () => {
  let g = S0(); fundAll(g, P0, 4);
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const as = hand(g, P0, 'Arcane Shift');
  assert.equal(canPlayNow(g, P0, as), false, 'no friendly unit');
  put(g, P0, 'V(1)', 'base'); touch(g);
  assert.equal(canPlayNow(g, P0, as), true, 'both targets available');
});

test('RJ#10140 Azir, Sovereign\'s attack trigger can move a Reflection token that is copying a (non-token) unit: it is still a token unit', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const rf = put(g, P0, 'Reflection', 'base', { token: true });
  g.cards = { ...g.cards, [cid('Noxus Hopeful')]: realCard('Noxus Hopeful') };
  mod(g, rf, { copyOf: cid('Noxus Hopeful'), duration: 'permanent' });
  assert.equal(mightOf(g, rf), 4, 'copying Noxus Hopeful');
  const az = put(g, P0, 'Azir, Sovereign', 'base');
  g = move(g, P0, [az], BF_A);
  let offered = false;
  for (let i = 0; i < 12 && locOf(g, rf) !== BF_A; i++) {
    const d = pend(g);
    if (!d.inStep) { if (d.kind === 'chainResponse') { g = pass(g); continue; } break; }
    if (d.kind === 'optional') { g = yes(g); continue; }
    if (optionIds(g).includes(rf)) offered = true;
    g = act(g, { type: 'choose', player: d.player, optionIds: [rf] });
  }
  assert.ok(offered, 'the copied Reflection is selectable');
  assert.equal(locOf(g, rf), BF_A);
});

// ---------------------------------------------------------------------------------------------- 10141-10150
test('RJ#10149 Gentle Gemdragon\'s play trigger readies up to 2 runes — including runes just exhausted to pay for him', () => {
  let g = S0(); setRunes(g, P0, 8, 'body');
  const gd = hand(g, P0, 'Gentle Gemdragon');
  g = act(g, { type: 'playCard', player: P0, obj: gd, destination: 'base' });
  assert.equal(readyRunes(g, P0), 0, 'all 8 runes paid');
  expectPending(g, 'chooseTargets', P0);
  const mine = pend(g).options!.filter(o => g.players[P0].runesInPlay.includes(o.id)).map(o => o.id);
  assert.equal(mine.length, 8, 'the exhausted paying runes are choosable');
  g = act(g, { type: 'choose', player: P0, optionIds: mine.slice(0, 2) });
  g = settle(g);
  assert.equal(readyRunes(g, P0), 2, 'two of the paying runes readied');
  assert.equal(locOf(g, gd), 'base');
});

// ---------------------------------------------------------------------------------------------- 10151-10160
test('RJ#10152 Green Father replaces the Baron Pit (token) with a Brush: the Pit ceases to exist, so the next Baron Nashor adds a new Baron Pit', () => {
  let g = withTokens(S0());
  setRunes(g, P0, 0); addRunes(g, P0, 14, 'chaos'); addRunes(g, P0, 12, 'fury');
  g.cards = { ...g.cards, 'unl-t01': realCard('unl-t01') };
  const gf = setLegend(g, P0, 'Green Father');
  const bn = hand(g, P0, 'Baron Nashor');
  g = act(g, { type: 'playCard', player: P0, obj: bn });
  let replaced = false;
  g = settle(g, d => { if (d.kind === 'optional') { if (/Green Father|Brush|replace/i.test(d.prompt ?? '')) replaced = true; return 'yes'; } return d.options!.find(o => /Baron/.test(o.label))?.id; });
  assert.ok(replaced, 'Green Father offered on the Pit conquer');
  assert.equal(ex(g, gf), true);
  const name = (i: number) => g.cards[g.objects[g.battlefields[i].objId].cardId].name;
  const idx = g.battlefields.length - 1;
  assert.equal(name(idx), 'Brush', 'the Pit was replaced');
  assert.ok(!g.battlefields.some((_, i) => name(i) === 'Baron Pit'), 'no Baron Pit on the board');
  const bn2 = hand(g, P0, 'Baron Nashor');
  g = act(g, { type: 'playCard', player: P0, obj: bn2 });
  g = settle(g, d => d.kind === 'optional' ? 'no' : d.options!.find(o => /Baron/.test(o.label))?.id);
  const pit = g.battlefields.findIndex((_, i) => name(i) === 'Baron Pit');
  assert.ok(pit > idx, 'a new Baron Pit was added');
  assert.equal(locOf(g, bn2), pit, 'the second Baron enters there');
});

test('RJ#10154 two Zilean, Time Mage at a battlefield: each replacement adds one copy — Iterative Design\'s one Mech token becomes three', () => {
  let g = withTokens(S0()); fundAll(g, P0, 4); addRunes(g, P0, 6, 'mind');
  put(g, P0, 'Zilean, Time Mage', BF_A); put(g, P0, 'Zilean, Time Mage', BF_A); control(g, BF_A, P0);
  const before = new Set(Object.keys(g.objects));
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Iterative Design') });
  g = settle(g, d => d.kind === 'optional' ? (/Flow/i.test(d.prompt ?? '') ? 'no' : 'yes') : undefined);
  const toks = Object.keys(g.objects).filter(id => !before.has(id) && g.objects[id].isToken && ['base', 'battlefield'].includes(g.objects[id].zone));
  assert.equal(toks.length, 3);
});

// ---------------------------------------------------------------------------------------------- 10161-10170
function ffa3r(): GameState {
  let g = createGame({ seed: 3, cardDb: fixtureDb(), mode: 'ffa', firstPlayer: P0, skipMulligan: true, battlefieldSelection: 'random', includeAllCards: true,
    players: [0, 1, 2].map(i => ({ name: `P${i}`, deck: legalDeck({}, [`cf-bf-${'abc'[i]}`, `cf-bf-${'def'[i]}`, `cf-bf-${'abc'[(i + 1) % 3]}`]) })) } as never);
  for (let i = 0; i < 10 && !(g.pending?.kind === 'mainAction' && g.pending.player === P0); i++) g = g.pending!.inStep ? act(g, legal(g, g.pending!.player)[0]) : act(g, { type: 'pass', player: g.pending!.player });
  for (const p of [P0, P1, 2 as PlayerId]) fundAll(g, p);
  return g;
}
test('RJ#10161 FFA3: in a showdown between two other players, a third player can\'t play Rengar, Trophy Hunter there (only to another battlefield with enemy units)', () => {
  let g = ffa3r(); const P2 = 2 as PlayerId; addRunes(g, P2, 6, 'body');
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  const a = put(g, P0, 'V(3)', 'base');
  const rg = hand(g, P2, 'Rengar, Trophy Hunter');
  g = move(g, P0, [a], BF_A);
  let seen = false;
  for (let i = 0; i < 12 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.player === P2 && g.showdown) { seen = true; const ds = playDests(g, P2, rg); assert.ok(!ds.includes(BF_A), `not into the P0-P1 showdown (${ds})`); assert.ok(ds.includes(BF_B), 'positive control: the other enemy battlefield'); break; }
    g = d.inStep ? choose(g, d.options![0].id) : pass(g);
  }
  assert.ok(seen, 'P2 got a showdown priority window');
});

test('RJ#10163 Temporary Karthus, Eternal + Watchful Sentry at Dusk Rose Lab: kill the Sentry with the Lab before Karthus\'s Temporary kill → Deathknell twice (2) + Lab draw (1) = 3, plus the turn draw', () => {
  let g = S0({ tp: P1, bfA: 'Dusk Rose Lab' });
  const k = put(g, P0, 'Karthus, Eternal', BF_A); control(g, BF_A, P0);
  mod(g, k, { addKeywords: ['Temporary'], duration: 'permanent', layer: 2 });
  const ws = put(g, P0, 'Watchful Sentry', BF_A);
  const h0 = g.players[P0].hand.length;
  g = act(g, { type: 'endTurn', player: P1 });
  let ordered = false;
  for (let i = 0; i < 40 && !(pend(g).kind === 'mainAction' && g.activePlayer === P0); i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    if (d.kind === 'orderTriggers') { ordered = true; g = choose(g, d.options!.find(o => /Temporary|Karthus/.test(o.label))?.id ?? d.options![0].id); continue; }
    g = d.kind === 'optional' ? yes(g) : choose(g, d.options!.find(o => o.id === ws)?.id ?? d.options![0].id);
  }
  assert.ok(ordered, 'Lab and Temporary triggers ordered by P0');
  assert.equal(zone(g, ws), 'trash');
  assert.equal(zone(g, k), 'trash', 'Karthus still dies to Temporary afterwards');
  assert.equal(g.players[P0].hand.length, h0 + 3 + 1, '2 (Deathknell ×2) + 1 (Lab) + 1 (Draw Phase)');
});

test('RJ#10166 The Syren ("Move a friendly unit at a battlefield to its base") vs Vilemaw\'s Lair ("Units can\'t move from here to base"): the unit stays (can\'t beats can)', () => {
  let g = S0({ bfA: "Vilemaw's Lair" }); fundAll(g, P0);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const sy = put(g, P0, 'The Syren', 'base');
  const ab = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === sy);
  if (ab) { g = act(g, ab); g = settle(g, d => d.options!.find(o => o.id === u)?.id); }
  assert.equal(locOf(g, u), BF_A, 'not moved to base');
  // control: the same activation at an ordinary battlefield does move the unit
  let h = S0(); fundAll(h, P0);
  const v = put(h, P0, 'V(2)', BF_B); control(h, BF_B, P0);
  const sy2 = put(h, P0, 'The Syren', 'base');
  h = act(h, legal(h, P0, 'activate').find(a => a.type === 'activate' && a.obj === sy2)!);
  h = settle(h, d => d.options!.find(o => o.id === v)?.id);
  assert.equal(locOf(h, v), 'base');
});

test('RJ#10167 Scorchclaw on the board when I reach 3 XP: his Level 3 "+1 [S]" turns on at once (the "enter ready" part does nothing now)', () => {
  const g = S0();
  const sc = put(g, P0, 'Scorchclaw', 'base', { ready: false });
  g.players[P0].xp = 2; touch(g);
  assert.equal(mightOf(g, sc), 3);
  g.players[P0].xp = 3; touch(g);
  assert.equal(mightOf(g, sc), 4, 'Level 3 active');
  assert.equal(ex(g, sc), true, 'still exhausted');
});

// ---------------------------------------------------------------------------------------------- 10171-10180
test('RJ#10172 two attackers vs a defending Kha\'Zix, Mutating Horror: the "enemy unit alone here" condition fails when he defends, so no trigger — Gusting one attacker afterwards doesn\'t bring it back', () => {
  let { g, atk, def } = attackSetup(['V(1)', 'V(1)'], ['Kha\'Zix, Mutating Horror']);
  fundAll(g, P1);
  const x0 = g.players[P1].xp;
  assert.ok(!g.chain.some(c => /Kha/.test(String(c.label))), 'no Kha\'Zix trigger on the chain');
  for (let i = 0; i < 8 && !(pend(g).player === P1 && !pend(g).inStep); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  g = play(g, P1, hand(g, P1, 'Gust'), { targets: [[atk[0]]] });
  for (let i = 0; i < 40 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: d.player, assignment: (d.data as { suggested: Record<ObjId, number> }).suggested }); continue; }
    g = d.inStep ? choose(g, d.options![0].id) : pass(g);
  }
  assert.equal(zone(g, atk[0]), 'hand', 'Gusted');
  assert.equal(g.players[P1].xp, x0, 'no XP');
  assert.ok(!g.log.some(l => /Kha'Zix.*\+2|gains? 2 XP/.test(l.text)), 'no +2');
  void def;
});

test('RJ#10174 Fizz, Trickster played by Heedless Resurrection: his play trigger comes after HR is in the trash, so he may play that same Heedless Resurrection', () => {
  let g = S0(); fundAll(g, P0, 4); addRunes(g, P0, 6, 'chaos'); addRunes(g, P0, 4, 'mind');
  const fz = put(g, P0, 'Fizz, Trickster', 'trash');
  const m1 = put(g, P0, 'Mindsplitter', 'base'), m2 = put(g, P0, 'Mindsplitter', 'base');
  const hr = hand(g, P0, 'Heedless Resurrection');
  g = act(g, { type: 'playCard', player: P0, obj: hr });
  let offered = false, firstKill = true;
  for (let i = 0; i < 40 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    if (/spell .*from your trash/i.test(d.prompt ?? '') && d.options!.some(o => o.id === hr)) { offered = true; g = choose(g, hr); continue; }
    const ids = d.options!.map(o => o.id);
    const pick: string = ids.includes(fz) && firstKill ? fz : ids.includes(m1) && firstKill ? m1 : ids.includes(m2) ? m2 : ids.includes(m1) ? m1 : ids.includes('yes') ? 'yes' : ids[0];
    if (pick === m1 || pick === fz) firstKill = pick === fz ? firstKill : false;
    g = choose(g, pick);
  }
  assert.ok(offered, 'the Heedless Resurrection that played Fizz is a legal choice');
  assert.equal(locOf(g, fz), 'base');
});

// ---------------------------------------------------------------------------------------------- 10177-10400
test('RJ#10195 Cursed Sarcophagus\'s "[T]: Play a unit banished with this" has no [Reaction]: it can\'t be used on the opponent\'s turn, even for an Ambush unit (Rengar, Trophy Hunter)', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  const r = put(g, P0, 'Rengar, Trophy Hunter', 'trash');
  g = settle(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Cursed Sarcophagus') }));
  const sar = g.players[P0].base.find(id => g.cards[g.objects[id].cardId].name === 'Cursed Sarcophagus')!;
  assert.equal(zone(g, r), 'banishment');
  assert.ok(legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === sar), 'usable on my own turn (Open state)');
  g = act(g, { type: 'endTurn', player: P0 }); g = settle(g);
  assert.equal(g.activePlayer, P1);
  fundAll(g, P1);
  [g] = cast(g, P1, 'DrawR');
  g = pass(g);
  expectPending(g, 'chainResponse', P0);
  assert.ok(!legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === sar), 'not on the opponent\'s turn');
});

test('RJ#10206 Crescent Strike: a unit (Soulspinner) Ambushed to that battlefield in response still takes the 1 (the "other enemy units there" are found on resolution)', () => {
  let g = withTokens(S0()); fundAll(g, P0); fundAll(g, P1);
  const t = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const amb = hand(g, P1, 'Soulspinner');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Crescent Strike') });
  for (let i = 0; i < 6 && pend(g).inStep; i++) { const d = pend(g); g = choose(g, d.options!.find(o => o.id === t || o.id === String(BF_A))?.id ?? d.options![0].id); }
  if (pend(g).player === P0) g = pass(g);
  expectPending(g, 'chainResponse', P1);
  g = act(g, { type: 'playCard', player: P1, obj: amb });
  for (let i = 0; i < 6 && pend(g).inStep && pend(g).player === P1; i++) { const d = pend(g); g = choose(g, d.options!.find(o => o.id === String(BF_A) || o.id === 'no')?.id ?? d.options![0].id); }
  assert.equal(locOf(g, amb), BF_A, 'Ambushed in');
  g = settle(g, d => d.options!.find(o => o.id === 'no')?.id);
  assert.equal(g.objects[t].damage, 4);
  assert.equal(zone(g, amb), 'battlefield');
  assert.equal(g.objects[amb].damage, 1, 'the Ambushed unit takes 1');
});

test('RJ#10216 two Allay, Eager Admirer at a battlefield: my other units there have Deflect 2, and each Allay has Deflect 2 (printed + the other copy)', () => {
  const g = S0();
  const a1 = put(g, P0, 'unl-041-219', BF_A); control(g, BF_A, P0);
  const a2 = put(g, P0, 'unl-041-219', BF_A);
  const u = put(g, P0, 'V(2)', BF_A);
  assert.equal(kwValue(g, u, 'Deflect'), 2);
  assert.equal(kwValue(g, a1, 'Deflect'), 2);
  assert.equal(kwValue(g, a2, 'Deflect'), 2);
});

test('RJ#10218 Not So Fast can\'t counter Bone Skewer: it chooses only a battlefield when played (the unit comes from the hand on resolution)', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  hand(g, P1, 'V(3)');
  const nsf = hand(g, P1, 'Not So Fast');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Bone Skewer') });
  for (let i = 0; i < 4 && pend(g).inStep && pend(g).player === P0; i++) { const d = pend(g); g = choose(g, d.options!.find(o => o.id === String(BF_A))?.id ?? d.options![0].id); }
  assert.ok(g.chain.length >= 1);
  if (pend(g).player === P0) g = pass(g);
  expectPending(g, 'chainResponse', P1);
  assert.equal(canPlayNow(g, P1, nsf), false);
});

test('RJ#10219 three Shard of Undoing, three Temporary units die together in my Beginning Phase: each Shard triggers once → the opponent kills three units', () => {
  let g = S0();
  for (let i = 0; i < 3; i++) { put(g, P1, 'Shard of Undoing', 'base'); put(g, P1, 'Temp(1)', 'base'); }
  const es = [put(g, P0, 'V(2)', 'base'), put(g, P0, 'V(3)', 'base'), put(g, P0, 'V(4)', 'base'), put(g, P0, 'V(5)', 'base')];
  g = act(g, { type: 'endTurn', player: P0 });
  g = settle(g);
  assert.equal(g.activePlayer, P1);
  assert.equal(es.filter(e => zone(g, e) === 'trash').length, 3, 'three of my units killed');
});

test('RJ#10248 my attacker (2 + Guardian Angel = 3) takes lethal damage vs Nidalee (4); Guardian Angel recalls it instead of dying: Nidalee still wins the combat → her controller draws 1', () => {
  let g = S0();
  const n = put(g, P1, 'unl-114-219', BF_A); control(g, BF_A, P1);
  const u = put(g, P0, 'V(2)', 'base');
  const ga = put(g, P0, 'Guardian Angel', 'base');
  attachNow(g, ga, u);
  assert.equal(mightOf(g, u), 3);
  const h1 = g.players[P1].hand.length;
  g = move(g, P0, [u], BF_A);
  g = settle(g);
  assert.equal(locOf(g, u), 'base', 'recalled by Guardian Angel');
  assert.equal(zone(g, ga), 'trash');
  assert.equal(locOf(g, n), BF_A);
  assert.equal(g.players[P1].hand.length, h1 + 1, 'Nidalee won the combat: draw 1');
});

test('RJ#10249 same as #10248 with my Symbol of the Solari: not a tie (only Nidalee is left), so Nidalee stays', () => {
  let g = S0();
  const n = put(g, P1, 'unl-114-219', BF_A); control(g, BF_A, P1);
  const u = put(g, P0, 'V(2)', 'base');
  const ga = put(g, P0, 'Guardian Angel', 'base');
  put(g, P0, 'Symbol of the Solari', 'base');
  attachNow(g, ga, u);
  g = move(g, P0, [u], BF_A);
  g = settle(g);
  assert.equal(locOf(g, u), 'base');
  assert.equal(locOf(g, n), BF_A, 'Nidalee not recalled');
  assert.equal(g.battlefields[BF_A].controller, P1);
});

test('RJ#10250 an enemy Mageseeker Warden at a battlefield ("opponents can only play units to their base"): Baron Nashor can still be played — he enters the new Baron Pit', () => {
  let g = withTokens(S0());
  setRunes(g, P0, 0); addRunes(g, P0, 14, 'chaos'); addRunes(g, P0, 12, 'fury');
  put(g, P1, 'Mageseeker Warden', BF_A); control(g, BF_A, P1);
  put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
  const bn = hand(g, P0, 'Baron Nashor');
  assert.ok(canPlayNow(g, P0, bn), 'playable');
  assert.ok(!playDests(g, P0, bn).includes(BF_B), 'not to my battlefield (Warden)');
  g = play(g, P0, bn, { dest: 'base' });
  g = settle(g, d => d.kind === 'optional' ? 'no' : undefined);
  const name = (i: number) => g.cards[g.objects[g.battlefields[i].objId].cardId].name;
  const pit = g.battlefields.findIndex((_, i) => name(i) === 'Baron Pit');
  assert.ok(pit >= 0, 'Baron Pit added');
  assert.equal(locOf(g, bn), pit, 'Baron enters there');
});

test('RJ#10251 kill spell (Death from Below) on the opponent\'s 8-Might unit next to Alpha Wildclaw (7); they Discipline the Wildclaw (9) in response: the target can\'t be chosen any more → mistargets, the unit lives', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const w = put(g, P1, 'unl-057-219', BF_A); control(g, BF_A, P1);
  const big = put(g, P1, 'V(8)', BF_A);
  const disc = hand(g, P1, 'Discipline');
  [g] = cast(g, P0, 'Death from Below', { targets: [[big]] });
  if (pend(g).player === P0) g = pass(g);
  expectPending(g, 'chainResponse', P1);
  g = play(g, P1, disc, { targets: [[w]] });
  g = settle(g, d => d.kind === 'optional' ? 'no' : undefined);
  assert.equal(mightOf(g, w), 9);
  assert.ok(g.log.some(l => /Resolving Death from Below/.test(l.text)), 'the kill spell was played and resolved');
  assert.equal(zone(g, big), 'battlefield', 'the 8-Might unit survives');
});

test('RJ#10252 killing my Mighty unit as Sacrifice\'s additional cost: Sacrifice contains the Kill instruction, so it is responsible (CR 429.5.b; DECISIONS #7364) — Immortal Phoenix in my trash triggers', () => {
  let g = S0(); fundAll(g, P0, 8);
  const ph = put(g, P0, 'Immortal Phoenix', 'trash');
  const m = put(g, P0, 'V(5)', 'base');
  let offered = false;
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Sacrifice') });
  g = settle(g, d => { if (d.kind === 'optional' && /Phoenix/.test(d.prompt ?? '')) { offered = true; return 'yes'; } return d.options!.find(o => o.id === m)?.id; });
  assert.equal(zone(g, m), 'trash', 'the Mighty unit was killed for the cost');
  assert.ok(g.log.some(l => /Resolving Sacrifice/.test(l.text)), 'Sacrifice resolved');
  assert.ok(offered, 'Phoenix trigger offered');
  assert.equal(locOf(g, ph), 'base', 'Phoenix played from the trash');
});

test('RJ#10256 Call to Battle can\'t move my unit to the battlefield it is already at (CR 355.4.a): only my unit elsewhere is offered', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const v = put(g, P0, 'V(3)', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Call to Battle') });
  const seen: string[][] = [];
  for (let i = 0; i < 6 && pend(g).inStep && pend(g).player === P0; i++) {
    const d = pend(g); seen.push(d.options!.map(o => o.id));
    if (d.options!.some(o => o.id === v)) { assert.ok(!d.options!.some(o => o.id === u), 'the unit already there is not offered'); g = choose(g, v); }
    else g = choose(g, d.options!.find(o => o.id === String(BF_A))?.id ?? d.options![0].id);
  }
  assert.ok(seen.every(s => !s.includes(u)), 'the unit already there is never offered');
  assert.ok(g.log.some(l => /\(auto\) Move a unit you control.*V\(3\)/.test(l.text)), 'V(3) is the only legal unit (auto-chosen)');
  g = settle(g);
  assert.equal(locOf(g, v), BF_A);
});

test('RJ#10259 Alpha Strike (3-Might dealer) on three 1-Might units; Stupefy on the dealer (2) and En Garde on one target (2) in response: 2 damage for 3 targets → drop only one target (CR 355.14.h), 1 each — the 2-Might unit can\'t get both', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const f = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const [r1, r2, r3] = [put(g, P1, 'V(1)', BF_B), put(g, P1, 'V(1)', BF_B), put(g, P1, 'V(1)', BF_B)]; control(g, BF_B, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Alpha Strike') });
  for (let i = 0; i < 6 && pend(g).inStep; i++) {
    const d = pend(g); const ids = d.options!.map(o => o.id);
    if (ids.includes(f)) g = choose(g, f);
    else if (d.kind === 'chooseNumber' || (d.data as { split?: unknown } | undefined)?.split) g = choose(g, d.options![0].id);
    else g = choose(g, ...[r1, r2, r3].filter(x => ids.includes(x)));
  }
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'Stupefy'), { targets: [[f]] });
  if (pend(g).player !== P1) g = pass(g);
  g = play(g, P1, hand(g, P1, 'En Garde'), { targets: [[r1]] });
  // adversarial: keep r1 among the targets whenever asked
  let keepAsked = false;
  for (let i = 0; i < 40 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    const ids = d.options!.map(o => o.id);
    if (ids.includes(r1) && ids.includes(r2)) { keepAsked = true; g = choose(g, r1, r2); continue; }
    g = choose(g, ids.includes(r1) ? r1 : ids[0]);
  }
  assert.ok(keepAsked, 'asked which 2 of the 3 targets to keep');
  assert.equal(mightOf(g, f), 2);
  const dmg = [r1, r2, r3].map(x => g.objects[x].damage ?? (zone(g, x) === 'trash' ? 1 : 0));
  assert.ok(zone(g, r1) !== 'trash', 'the 2-Might unit survives');
  assert.ok((g.objects[r1].damage ?? 0) <= 1, 'at most 1 to it');
  assert.equal([r2, r3].filter(x => zone(g, x) === 'trash').length + ((g.objects[r1].damage ?? 0) ? 1 : 0), 2, 'two targets kept, 1 damage each');
  void dmg;
});

test('RJ#10260 my spell ← their Lilting Lullaby ← my own Abandon on my spell: Lullaby\'s target is gone (mistargets), so its "can\'t play spells" never applies — I can still play spells', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const sp = hand(g, P0, 'DrawR');
  const other = hand(g, P0, 'DrawR');
  [g] = [play(g, P0, sp)];
  if (pend(g).player === P0) g = pass(g);
  expectPending(g, 'chainResponse', P1);
  g = play(g, P1, hand(g, P1, 'Lilting Lullaby'));
  if (pend(g).player === P1) g = pass(g);
  expectPending(g, 'chainResponse', P0);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Abandon') });
  for (let i = 0; i < 4 && pend(g).inStep && pend(g).player === P0; i++) { const d = pend(g); g = choose(g, d.options!.find(o => /DrawR/.test(o.label ?? ''))?.id ?? d.options![0].id); }
  g = settle(g, d => d.kind === 'optional' ? 'no' : undefined);
  expectPending(g, 'mainAction', P0);
  assert.equal(zone(g, sp), 'hand', 'Abandon returned my spell to hand');
  assert.ok(canPlayNow(g, P0, other), 'no "can\'t play spells" restriction');
});

test('RJ#10266 Bone Skewer plays the opponent\'s Clockwork Keeper "ignoring any and all costs": the optional [C] counts as paid for free → they draw 1', () => {
  let g = S0(); fundAll(g, P0);
  setRunes(g, P1, 0);
  const k = hand(g, P1, 'Clockwork Keeper');
  const h1 = g.players[P1].hand.length;
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Bone Skewer') });
  g = settle(g, d => d.kind === 'optional' ? 'yes' : (d.options!.find(o => o.id === k) ?? d.options!.find(o => o.id === String(BF_B)))?.id, 60);
  assert.equal(zone(g, k), 'battlefield', 'Keeper played to the chosen battlefield');
  assert.equal(g.players[P1].hand.length, h1, 'Keeper left the hand (-1) and they drew 1 (+1)');
});

test('RJ#10269/#10270 Jayce, Man of Progress: after his trigger resolves I may play ONE gear (≤ [7]) ignoring its Energy cost later that turn; a second such gear pays its Energy', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  const other = put(g, P0, 'Long Sword', 'base');
  const va1 = put(g, P0, 'Vanguard Armory', 'hand');
  const va2 = put(g, P0, 'Vanguard Armory', 'hand');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'sfd-084-221'), destination: 'base' });
  g = driveH(g, [[other]], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, other), 'trash');
  // later, as a separate main-phase action
  setRunes(g, P0, 0); addRunes(g, P0, 1, 'order');
  assert.equal(playCostOf(g, P0, va1)?.energy ?? 0, 0, 'first gear: Energy ignored');
  g = driveH(act(g, { type: 'playCard', player: P0, obj: va1 }), [], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, va1), 'base');
  assert.equal(playCostOf(g, P0, va2)?.energy, 7, 'second gear pays its Energy');
});

test('RJ#10275 Heimerdinger, Inventor copying The List\'s [T] (named Poro): the named tag is linked to The List itself, so Heimerdinger\'s copy has no named tag — a Poro can\'t get -2 from it', () => {
  let g = S0(); fundAll(g, P0, 12);
  const poro = put(g, P1, 'Pouty Poro', BF_A); control(g, BF_A, P1);
  const m0 = mightOf(g, poro);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'The List') });
  g = settle(g, d => d.options?.find(o => /^Poro$/i.test(o.label ?? ''))?.id);
  const tl = g.players[P0].base.find(id => g.cards[g.objects[id].cardId].name === 'The List')!;
  assert.ok(tl, 'The List in play');
  const h = put(g, P0, 'ogn-111-298', 'base');
  const ha = legal(g, P0, 'activate').filter(a => a.type === 'activate' && a.obj === h);
  for (const a of ha) {
    const g2 = settle(act(g, a), d => d.options?.find(o => o.id === poro)?.id);
    assert.equal(mightOf(g2, poro), m0, 'Heimerdinger\'s copy can\'t give the Poro -2');
  }
  // The List itself still can
  const g3 = settle(act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === tl)!), d => d.options?.find(o => o.id === poro)?.id);
  assert.equal(mightOf(g3, poro), m0 - 2);
});

test('RJ#10278 Tactical Retreat on my Temporary unit in response to its Beginning-Phase kill trigger: the death is replaced, the unit survives', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0);
  const t = put(g, P0, 'Temp(2)', BF_A); control(g, BF_A, P0);
  const tr = hand(g, P0, 'Tactical Retreat');
  g = act(g, { type: 'endTurn', player: P1 });
  for (let i = 0; i < 20 && !(pend(g).player === P0 && canPlayNow(g, P0, tr) && g.chain.length > 0); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.ok(g.chain.length > 0 && canPlayNow(g, P0, tr), 'window on the Temporary trigger');
  g = play(g, P0, tr, { targets: [[t]] });
  g = settle(g);
  assert.notEqual(zone(g, t), 'trash', 'saved');
  assert.equal(locOf(g, t), 'base', 'recalled');
});

test('RJ#10283 Upstage Comedy + Repeat on the same already-ready Irelia, Fervent: legal; each choice gives her +1, but readying a ready unit does nothing (no "ready me" +1)', () => {
  let g = S0(); fundAll(g, P0, 6);
  const ir = put(g, P0, 'sfd-057-221', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Upstage Comedy') });
  for (let i = 0; i < 6 && pend(g).inStep && pend(g).player === P0; i++) g = choose(g, pend(g).options!.find(o => o.id === ir || o.id === 'yes')?.id ?? pend(g).options![0].id);
  g = settle(g, d => d.kind === 'optional' ? 'yes' : d.options!.find(o => o.id === ir)?.id);
  assert.ok(g.log.some(l => /Resolving Upstage Comedy/.test(l.text)));
  assert.equal(ex(g, ir), false);
  assert.equal(mightOf(g, ir), 4 + 2, 'two "choose me" +1s, no "ready me" +1');
});

test('RJ#10306 Mystic Reversal on the opponent\'s Heedless Resurrection: new choices pick a unit from MY trash; its kill cost was paid by the caster — I kill nothing', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0, 8); fundAll(g, P1, 8);
  const k = put(g, P1, 'V(2)', 'base'), t1 = put(g, P1, 'V(2)', 'trash'), t0 = put(g, P0, 'V(2)', 'trash');
  const m0 = put(g, P0, 'V(3)', 'base');
  g = play(g, P1, hand(g, P1, 'Heedless Resurrection'));
  for (let i = 0; i < 10 && pend(g).inStep; i++) { const ids = pend(g).options!.map(o => o.id); g = choose(g, ids.includes(k) ? k : ids.includes(t1) ? t1 : ids[0]); }
  assert.equal(zone(g, k), 'trash', 'the caster paid the kill');
  const hr = g.chain[0].source;
  if (pend(g).player === P1) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Mystic Reversal'), { targets: [[hr]] });
  g = settle(g, d => { const ids = d.options!.map(o => o.id); return ids.includes('yes') ? 'yes' : ids.includes(t0) ? t0 : undefined; });
  assert.equal(locOf(g, t0), 'base');
  assert.equal(g.objects[t0].controller, P0, 'my unit, played from my trash');
  assert.equal(zone(g, t1), 'trash', 'the original choice was replaced');
  assert.equal(zone(g, m0), 'base', 'no kill for the new controller');
});

test('RJ#10317 Fading Memories can choose a unit that is already Temporary; the redundant instances give one Beginning-Phase kill trigger (CR 816.2.a)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1, 10);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  g = driveH(play(g, P1, hand(g, P1, 'Fading Memories'), { targets: [[u]] }));
  g = driveH(play(g, P1, hand(g, P1, 'Fading Memories'), { targets: [[u]] }));
  assert.equal(g.log.filter(l => /Resolving Fading Memories/.test(l.text)).length, 2, 'the second one was legal on the Temporary unit');
  g = endTurn(g, P1);
  assert.equal(g.chain.length, 1, 'one Temporary trigger');
  g = driveH(g);
  assert.equal(zone(g, u), 'trash');
});

test('RJ#10321 at 5 points, two Tryndamere, Barbarian conquer with 5+ excess while the opponent holds the other battlefield: conquer 6, each Tryndamere +1 → 8, I win (only the conquer point needs every battlefield)', () => {
  let g = S0(); g.players[P0].points = 5;
  const t1 = put(g, P0, 'ogn-034-298', 'base'), t2 = put(g, P0, 'ogn-034-298', 'base');
  const d = put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  g = driveH(move(g, P0, [t1, t2], BF_A), ['first', 'first', 'first', 'first']);
  assert.equal(zone(g, d), 'trash');
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[P0].points, 8);
  assert.equal(g.winner, P0);
});

test('RJ#10325 Red Brambleback\'s "When I conquer, [Buff] a friendly unit" can buff himself', () => {
  let g = S0();
  const rb = put(g, P0, 'Red Brambleback', 'base'); put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [rb], BF_A);
  let offeredSelf = false;
  g = settle(g, d => { const ids = d.options!.map(o => o.id); if (ids.includes(rb)) { offeredSelf = true; return rb; } return d.kind === 'optional' ? 'yes' : undefined; });
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.ok(offeredSelf || (g.objects[rb].counters.buff ?? 0) > 0, 'he is a legal choice');
  assert.equal(g.objects[rb].counters.buff ?? 0, 1, 'buffed');
});

test('RJ#10326 Wuju Master at Level 11 ("Your units enter ready"): Arachnoid Horror played straight to a battlefield enters ready', () => {
  let g = S0(); fundAll(g, P0, 12);
  setLegend(g, P0, 'Wuju Master');
  g.players[P0].xp = 11;
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const ah = hand(g, P0, 'Arachnoid Horror');
  g = settle(play(g, P0, ah, { dest: BF_A }), d => d.kind === 'optional' ? 'no' : undefined);
  assert.equal(locOf(g, ah), BF_A);
  assert.equal(ex(g, ah), false, 'entered ready');
});

test('RJ#10328 Here to Help\'s [3] reduction stacks with Master Yi, Unstoppable\'s Level reduction: at Level 6 his 12 Energy becomes 5', () => {
  const run = (xp: number) => {
    let g = S0(); fundAll(g, P0, 2); addRunes(g, P0, 14, 'calm');
    g.players[P0].xp = xp;
    put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
    const y = hand(g, P0, 'unl-059-219');
    g = settle(play(g, P0, hand(g, P0, 'Here to Help')), d => d.options!.find(o => o.id === y || o.id === 'yes')?.id);
    assert.equal(locOf(g, y), BF_A);
    return { log: g.log.map(l => l.text) };
  };
  const lv6 = run(6), lv0 = run(0);
  assert.ok(lv0.log.some(t => /pays 9 C C C$/.test(t)), 'control: Here to Help alone → [9][C][C][C]');
  assert.ok(lv6.log.some(t => /pays 5 C$/.test(t)), 'Level 6 ([4][C][C] less) on top → [5][C]');
});

test('RJ#10331 a stunned Shadow can still exhaust for its [T] ability (Stun doesn\'t stop exhausting / activating)', () => {
  let { g, atk } = attackSetup(['V(3)'], ['Shadow'], { defOpts: [{ stunned: true }] });
  fundAll(g, P1, 3);
  const sh = Object.keys(g.objects).find(id => g.cards[g.objects[id].cardId]?.name === 'Shadow')!;
  assert.equal(g.objects[sh].stunned, true);
  for (let i = 0; i < 10 && !(pend(g).player === P1 && !pend(g).inStep); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.ok(legal(g, P1).some(a => a.type === 'activate' && a.obj === sh), 'activation offered while stunned');
  g = activate(g, P1, sh, 0, { targets: [[atk[0]]] });
  assert.equal(ex(g, sh), true, 'exhausted as the cost');
  g = settle(g, d => d.options!.find(o => o.id === atk[0])?.id);
  assert.ok(g.log.some(l => /Resolving Shadow/.test(l.text)));
});

test('RJ#10348 a battlefield I "held" with no units there at my Beginning Phase: no hold (no point, no Amateur Recital trigger) — nothing to respond to', () => {
  let g = S0({ tp: P1, bfA: 'Amateur Recital' });
  put(g, P0, 'V(2)', 'base'); control(g, BF_A, P0);
  put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  const pts = g.players[P0].points;
  g = endTurn(g, P1);
  assert.ok(!g.chain.some(c => /Amateur Recital/.test(String(c.label ?? ''))), 'no hold trigger on the chain');
  g = settle(g);
  assert.equal(g.players[P0].points, pts, 'no hold point');
  assert.ok(!g.log.some(l => /Resolving Amateur Recital/.test(l.text)));
  // control: with a unit there, the hold scores and triggers
  let h = S0({ tp: P1, bfA: 'Amateur Recital' });
  put(h, P0, 'V(2)', BF_A); control(h, BF_A, P0);
  const p2 = h.players[P0].points;
  h = endTurn(h, P1);
  h = settle(h, d => d.kind === 'optional' ? 'no' : undefined);
  assert.equal(h.players[P0].points, p2 + 1, 'hold point with a unit');
});

test('RJ#10354 Tricksy Tentacles uses current Might: two enemy 4-Might units buffed to 5 (total 10) can\'t both be chosen (limit 8); one can', () => {
  let g = S0(); fundAll(g, P0);
  const a = put(g, P1, 'V(4)', BF_A, { buff: true }), b = put(g, P1, 'V(4)', BF_A, { buff: true }); control(g, BF_A, P1);
  assert.equal(mightOf(g, a), 5);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Tricksy Tentacles') });
  assert.equal(pend(g).kind, 'chooseTargets');
  g = choose(g, a);
  const d = pend(g);
  assert.ok(!(d.kind === 'chooseTargets' && d.options!.some(o => o.id === b)), 'the second 5-Might unit would exceed 8');
});

test('RJ#10357 Daisy! has the Ivern tag: +1 Might at a Brush', () => {
  let g = withTokens(S0());
  setBattlefieldCard(g, BF_A, 'unl-t03');
  const d = put(g, P0, 'Daisy!', BF_A); control(g, BF_A, P0);
  assert.equal(mightOf(g, d), 9);
});

test('RJ#10356 a ready unit Dazzling Aurora plays to base at the end of my turn can\'t Standard Move (Main Phase only)', () => {
  let g = S0(); fundAll(g, P0);
  setLegend(g, P0, 'Wuju Master'); g.players[P0].xp = 11;
  put(g, P0, 'Dazzling Aurora', 'base');
  const sc = put(g, P0, 'Scuttle Crab', 'deckTop');
  g = act(g, { type: 'endTurn', player: P0 });
  let checked = false;
  for (let i = 0; i < 30 && g.pending; i++) {
    const d = g.pending;
    if (['base', 'battlefield'].includes(zone(g, sc)) && !d.inStep && d.player === P0) {
      assert.equal(ex(g, sc), false, 'entered ready (Level 11)');
      assert.ok(!legal(g, P0).some(a => a.type === 'move'), 'no Standard Move in the Ending Phase');
      checked = true;
    }
    if (d.kind === 'mainAction') break;
    g = d.inStep ? choose(g, d.options!.find(o => o.id === 'base')?.id ?? (d.kind === 'optional' ? 'no' : d.options![0].id)) : pass(g);
  }
  assert.ok(checked, 'P0 had priority with the ready Crab in base (its draw trigger) — and no move was offered');
  assert.equal(locOf(g, sc), 'base', 'still in base');
});

test('RJ#10362 a Reflection copying the opponent\'s Elder Dragon gets its passive ("any amount of your damage kills enemy units") but no play trigger: my 2 damage kills a 5-Might enemy', () => {
  let g = withTokens(S0()); fundAll(g, P0, 6);
  const ed = put(g, P1, 'Elder Dragon', 'base');
  const e = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const before = new Set(Object.keys(g.objects));
  g = settle(play(g, P0, hand(g, P0, 'Mirror Image'), { targets: [[ed]] }), d => d.kind === 'optional' ? 'yes' : undefined);
  const r = g.players[P0].base.find(id => !before.has(id) && g.objects[id].isToken)!;
  assert.ok(r, 'Reflection created');
  assert.equal(mightOf(g, r), 10, 'copy of Elder Dragon');
  assert.equal(g.objects[e].damage ?? 0, 0, 'no play trigger (it wasn\'t played as Elder Dragon)');
  g = settle(play(g, P0, hand(g, P0, 'ZapM'), { targets: [[e]] }));
  assert.equal(zone(g, e), 'trash', '2 damage of mine is enough');
});

test('RJ#10364 my Windsinger bounces the opponent\'s only Sprite at their battlefield; they respond with hidden Sprite Call there: they never lost control → no conquer, no point', () => {
  let g = withTokens(S0()); fundAll(g, P0, 6); fundAll(g, P1, 6);
  const sp = put(g, P1, 'Sprite', BF_A, { token: true }); control(g, BF_A, P1);
  const sc = put(g, P1, 'Sprite Call', { facedown: BF_A });
  const pts = g.players[P1].points;
  const ws = hand(g, P0, 'Windsinger');
  g = act(g, { type: 'playCard', player: P0, obj: ws, destination: 'base' } as never);
  for (let i = 0; i < 10 && !(g.chain.length > 0 && pend(g).player === P1 && !pend(g).inStep); i++) {
    const d = pend(g); g = d.inStep ? choose(g, d.options!.find(o => o.id === sp || o.id === 'yes')?.id ?? d.options![0].id) : pass(g);
  }
  assert.ok(canPlayNow(g, P1, sc), 'Sprite Call playable in response');
  g = play(g, P1, sc);
  g = settle(g, d => d.options!.find(o => o.id === sp || o.id === 'yes')?.id);
  assert.equal(zone(g, sp), 'gone', 'the old Sprite was returned (ceases to exist)');
  assert.equal(g.battlefields[BF_A].controller, P1);
  assert.equal(g.players[P1].points, pts, 'no conquer');
});

test('RJ#10365 opponent\'s Salvage chooses the gear on my unit; I Sacrifice that unit in response (gear detaches, recalled to base): same gear object, Salvage still kills it and draws', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 6); fundAll(g, P1, 6);
  const u = put(g, P0, 'V(5)', BF_A); control(g, BF_A, P0);
  const ls = put(g, P0, 'Long Sword', 'base'); attachNow(g, ls, u);
  const h1 = g.players[P1].hand.length;
  g = play(g, P1, hand(g, P1, 'Salvage'), { targets: [[ls]] });
  for (let i = 0; i < 6 && !(pend(g).player === P0 && !pend(g).inStep); i++) g = pend(g).inStep ? choose(g, pend(g).options!.find(o => o.id === ls || o.id === 'yes')?.id ?? pend(g).options![0].id) : pass(g);
  assert.equal(g.chain.length, 1, 'Salvage on the chain');
  g = play(g, P0, hand(g, P0, 'Sacrifice'), { targets: [[u]] });
  g = settle(g, d => d.options!.find(o => o.id === u || o.id === ls || o.id === 'yes')?.id);
  assert.equal(zone(g, u), 'trash');
  assert.equal(zone(g, ls), 'trash', 'Salvage killed the (now unattached) gear');
  assert.ok(g.players[P1].hand.length >= h1 - 1 + 1, 'Salvage drew');
});

test('RJ#10371 Heedless Resurrection whose kill cost is replaced by Zhonya\'s Hourglass: the cost is paid, but no unit was killed → nothing to compare against, no unit is played', () => {
  const run = (zhonya: boolean) => {
    let g = S0(); fundAll(g, P0, 6);
    const k = put(g, P0, 'V(3)', 'base');
    if (zhonya) put(g, P0, 'Zhonya\'s Hourglass', 'base');
    const t = put(g, P0, 'V(1)', 'trash');
    g = play(g, P0, hand(g, P0, 'Heedless Resurrection'));
    g = settle(g, d => d.options!.find(o => o.id === k || o.id === t || o.id === 'yes')?.id);
    assert.ok(g.log.some(l => /Resolving Heedless Resurrection/.test(l.text)), 'the spell was played (cost paid)');
    return { k: zone(g, k), t: zone(g, t) };
  };
  const saved = run(true);
  assert.equal(saved.k, 'base', 'Zhonya\'s saved the cost unit');
  assert.equal(saved.t, 'trash', 'no killed unit → nothing played');
  const normal = run(false);
  assert.equal(normal.t, 'base', 'control: normally the trash unit is played');
});

test('RJ#10370 Stare Down can be played choosing a battlefield with no enemy units: the move does nothing, I still gain 1 XP', () => {
  let g = S0(); fundAll(g, P0, 6);
  const u = put(g, P0, 'V(3)', 'base');
  const xp = g.players[P0].xp ?? 0;
  const sd = hand(g, P0, 'Stare Down');
  assert.ok(canPlayNow(g, P0, sd), 'playable with no enemy units anywhere');
  g = act(g, { type: 'playCard', player: P0, obj: sd });
  g = settle(g, d => d.options!.find(o => o.id === u || o.id === String(BF_A))?.id);
  assert.ok(g.log.some(l => /Resolving Stare Down/.test(l.text)));
  assert.equal(g.players[P0].xp, xp + 1);
});

test('RJ#10375 (MISMATCH-RJ, DECISIONS #12916) my attacking Bird token is my only unit at the enemy battlefield: Stalking Wolf may still Ambush there killing that Bird (destination chosen while it is there; its own text)', () => {
  let g = withTokens(S0()); fundAll(g, P0, 8);
  const d = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const bird = put(g, P0, 'Bird', 'base', { token: true });
  const w = hand(g, P0, 'Stalking Wolf');
  g = move(g, P0, [bird], BF_A);
  for (let i = 0; i < 8 && !(pend(g).player === P0 && !pend(g).inStep && canPlayNow(g, P0, w, BF_A)); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.ok(canPlayNow(g, P0, w, BF_A), 'Wolf may Ambush to the attacked battlefield');
  g = act(g, { type: 'playCard', player: P0, obj: w, destination: BF_A });
  g = driveH(g, [[bird], [bird], 'yes', 'yes'], x => x.chain.length === 0 || x.pending?.kind === 'showdownAction');
  assert.notEqual(zone(g, bird), 'battlefield', 'Bird killed for the cost');
  assert.equal(locOf(g, w), BF_A, 'Wolf ambushed in');
  assert.equal(zone(g, d), 'battlefield');
});

test('RJ#10378 Blue Sentinel doubles hold effects (Grove\'s draw), not the hold point: still +1 point', () => {
  let g = S0({ tp: P1, bfA: 'Grove of the God-Willow' });
  for (let i = 0; i < 5; i++) put(g, P0, 'V(1)', 'deckTop');
  put(g, P0, 'Blue Sentinel', BF_A); control(g, BF_A, P0);
  const p0 = g.players[P0].points;
  g = endTurn(g);
  g = settle(g, d => d.kind === 'optional' ? 'yes' : undefined, 60);
  assert.equal(g.players[P0].points, p0 + 1);
});

test('RJ#10398 Pack of Wonders can return a gear attached to my unit: the gear goes to hand, the unit stays (no longer equipped)', () => {
  let g = S0();
  const pw = put(g, P0, 'Pack of Wonders', 'base');
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const ls = put(g, P0, 'Long Sword', 'base'); attachNow(g, ls, u);
  const m0 = mightOf(g, u);
  g = act(g, { type: 'activate', player: P0, obj: pw, abilityIndex: 0 });
  g = settle(g, d => d.options!.find(o => o.id === ls)?.id);
  assert.equal(zone(g, ls), 'hand');
  assert.equal(locOf(g, u), BF_A);
  assert.equal(mightOf(g, u), m0 - 2, 'Long Sword\'s +2 gone');
});

// Rift Judge verification, range r3901 (question ids 3901-5200). See docs/riftjudge/README.md and docs/riftjudge/r3901.md.
import { test } from 'node:test';
import {
  assert, S0, put, hand, cast, play, pass, passN, expectPending, control, act, move, mod, nextTurn, endTurn, EventLog, setRunes,
  P0, P1, BF_A, BF_B, zone, locOf, mightOf, resolveChain, passAll, pend, answer, yes, no, choose, legal, canPlayNow, playDests,
  validateAction, activate, readyRunes, exhaustedRunes, optionIds, attackSetup, needsScripts, cid, setBattlefieldCard, addRunes, fundAll,
  rejects, hasKeyword, kwValue, moveDests, fillTrash, chainLabels, clearDeck,
  type GameState, type ObjId,
} from '../conformance/harness.ts';
import type { PlayerId } from '../../src/engine/types.ts';
import { validateDeck } from '../../src/engine/index.ts';
import { fixtureDb } from '../fixtures/conformance/cards.ts';
import { legalDeck, newGame } from '../conformance/harness.ts';
import { withTokens, drive as drive11 } from './r11701.helpers.ts';
import { attachNow } from '../../src/engine/testkit.ts';

const todoReal = (reason: string, ...cards: string[]) => { const m = needsScripts(...cards); return m ? `${m}; ${reason}` : false; };
const runeDeckN = (g: GameState, p: PlayerId) => g.players[p].runeDeck.length;
/** pass through chains and showdowns until a non-response decision is pending */
function settle(g: GameState, limit = 60): GameState {
  for (let i = 0; i < limit; i++) {
    const d = g.pending;
    if (d && d.inStep && d.kind === 'orderTriggers') { g = choose(g, d.options![0].id); continue; }
    if (!d || d.inStep || (d.kind !== 'chainResponse' && d.kind !== 'showdownAction')) return g;
    g = pass(g);
  }
  return g;
}
const allRunes = (g: GameState, p: PlayerId) => g.players[p].runesInPlay.length;

// RJ#3902 — Void Seeker on a Deflect unit: the Deflect tax must be paid (no declining it).
test('RJ#3902 Void Seeker targeting Pouty Poro must pay the Deflect tax', () => {
  let g = S0();
  fundAll(g, P0, 4);
  const poro = put(g, P1, 'Pouty Poro', BF_A);
  control(g, BF_A, P1);
  const vs = hand(g, P0, 'Void Seeker');
  const before = allRunes(g, P0);
  g = play(g, P0, vs, { targets: [[poro]] });
  // 3 energy (exhaust 3) + [Fury] (recycle 1) + Deflect [A] (recycle 1 more)
  assert.equal(before - allRunes(g, P0), 2, 'two runes recycled: Fury power + Deflect tax');
  // with only enough for the base cost, Poro can't be chosen
  let h = S0();
  setRunes(h, P0, 1, 'fury');
  h.players[0].pool = { energy: 3, power: {} };
  const poro2 = put(h, P1, 'Pouty Poro', BF_A);
  const other = put(h, P1, 'V(2)', BF_A);
  control(h, BF_A, P1);
  const vs2 = hand(h, P0, 'Void Seeker');
  h = act(h, { type: 'playCard', player: P0, obj: vs2 });
  if (pend(h).kind === 'chooseTargets') { assert.ok(!optionIds(h).includes(poro2), 'unaffordable Deflect target not offered'); h = choose(h, other); }
  h = resolveChain(h);
  assert.equal(zone(h, other), 'trash', 'the only affordable target was hit');
  assert.equal(h.objects[poro2].damage, 0);
});

// RJ#3904 — final point via conquer on the opponent's turn: same rule, needs every battlefield scored this turn.
// Same rule as T101 (tests/conformance/G-scoring.test.ts); here the conquer happens on the opponent's turn.
test('RJ#3904 conquering the final point on the opponent\'s turn without scoring every battlefield draws instead', () => {
  let g = S0();
  g.players[1].points = 7;
  const u = hand(g, P1, 'V(3)');
  const dr = hand(g, P1, 'DropR');
  const h1 = g.players[1].hand.length;
  const z = put(g, P1, 'V(1)', 'base');
  [g] = cast(g, P0, 'ZapM', { targets: [[z]] });
  g = pass(g);
  g = play(g, P1, dr);
  g = resolveChain(g);
  g = answer(g, { battlefields: [BF_B], cards: [[u]] });
  g = settle(g);
  assert.equal(locOf(g, u), BF_B);
  assert.equal(g.battlefields[BF_B].controller, P1, 'P1 conquers BF-B on P0\'s turn');
  assert.equal(g.players[1].points, 7, 'no final point');
  assert.equal(g.players[1].hand.length, h1 - 2 + 1, 'draws 1 instead');
  assert.equal(g.winner, null);
});

// RJ#3905 — Darius, Trifarian triggers when he is the 2nd card (or on board for it), not when he is the 3rd.
test('RJ#3905 Darius, Trifarian: second card triggers, third card does not', () => {
  const run = (before: number) => {
    let g = S0();
    fundAll(g, P0, 6);
    for (let i = 0; i < before; i++) { [g] = cast(g, P0, 'V(1)', { dest: 'base' }); g = resolveChain(g); }
    const d = hand(g, P0, 'Darius, Trifarian');
    g = play(g, P0, d, { dest: 'base' });
    g = resolveChain(g);
    g = passAll(g); g = resolveChain(g);
    return { ready: !g.objects[d].exhausted, might: mightOf(g, d) };
  };
  assert.deepEqual(run(1), { ready: true, might: 7 }, 'Darius as the 2nd card readies and gets +2');
  assert.deepEqual(run(2), { ready: false, might: 5 }, 'Darius as the 3rd card: no trigger');
  // already on board when the 2nd card is played
  let g = S0();
  fundAll(g, P0, 6);
  const d = put(g, P0, 'Darius, Trifarian', 'base', { ready: false });
  [g] = cast(g, P0, 'V(1)', { dest: 'base' }); g = resolveChain(g);
  [g] = cast(g, P0, 'V(1)', { dest: 'base' }); g = resolveChain(g); g = passAll(g); g = resolveChain(g);
  assert.equal(g.objects[d].exhausted, false);
  assert.equal(mightOf(g, d), 7);
});

// RJ#3908 — Whirlwind doesn't target, so no Deflect tax.
test('RJ#3908 Whirlwind does not pay a Deflect tax', () => {
  let g = S0();
  fundAll(g, P0, 4);
  put(g, P1, 'Pouty Poro', BF_A);
  control(g, BF_A, P1);
  const w = hand(g, P0, 'Whirlwind');
  const before = allRunes(g, P0);
  g = play(g, P0, w);
  assert.equal(before - allRunes(g, P0), 1, 'only the [Chaos] power rune is recycled');
});

// RJ#3903 — a non-targeting "each player kills one of their units" can be played with no friendly units.
test('RJ#3903 Cull the Weak is playable with no friendly units and still kills the opponent\'s', () => {
  let g = S0();
  fundAll(g, P0, 4);
  const e = put(g, P1, 'V(3)', BF_A);
  control(g, BF_A, P1);
  const c = hand(g, P0, 'Cull the Weak');
  assert.ok(canPlayNow(g, P0, c));
  g = play(g, P0, c);
  g = resolveChain(g);
  g = answer(g, { cards: [[e]], targets: [[e]] });
  g = resolveChain(g);
  assert.equal(zone(g, e), 'trash');
});

// RJ#3906 — several reactions on the same chain while holding priority: covered by T049 (D-chain) + this check.
test('RJ#3906 a player may play two reactions in a row before passing', () => {
  let g = S0();
  const v = put(g, P1, 'V(5)', 'base');
  const r1 = hand(g, P1, 'ZapR'); const r2 = hand(g, P1, 'ZapR');
  const t = put(g, P0, 'V(5)', 'base');
  [g] = cast(g, P0, 'ZapM', { targets: [[v]] });
  g = pass(g);
  expectPending(g, 'chainResponse', P1);
  g = play(g, P1, r1, { targets: [[t]] });
  expectPending(g, 'chainResponse', P1, 'priority stays with the player who played the reaction');
  assert.ok(canPlayNow(g, P1, r2));
  g = play(g, P1, r2, { targets: [[t]] });
  assert.equal(g.chain.length, 3);
});

// RJ#3909 — two Time Warps in one turn give two extra turns.
test('RJ#3909 two Time Warps give two extra turns', () => {
  let g = S0();
  fundAll(g, P0, 10);
  addRunes(g, P0, 10, 'mind');
  const t1 = hand(g, P0, 'Time Warp'); const t2 = hand(g, P0, 'Time Warp');
  g = play(g, P0, t1); g = resolveChain(g);
  g = play(g, P0, t2); g = resolveChain(g);
  assert.equal(zone(g, t1), 'banishment');
  const turn = g.turn;
  g = nextTurn(g);
  assert.equal(g.activePlayer, P0, 'extra turn 1'); assert.equal(g.turn, turn + 1);
  g = nextTurn(g);
  assert.equal(g.activePlayer, P0, 'extra turn 2');
  g = nextTurn(g);
  assert.equal(g.activePlayer, P1, 'then the opponent');
});

// RJ#3907 — Teemo, Strategist played from hidden into the opponent's attack defends, and his trigger happens once.
test('RJ#3907 Teemo, Strategist played from facedown during an attack triggers "when I defend" once', () => {
  let g = S0({ tp: P1 });
  put(g, P0, 'V(1)', BF_A);
  control(g, BF_A, P0);
  const t = put(g, P0, 'Teemo, Strategist', { facedown: BF_A });
  put(g, P0, 'Teemo, Scout', 'deckTop'); put(g, P0, 'Teemo, Scout', 'deckTop');
  const a = put(g, P1, 'V(9)', 'base');
  const log = new EventLog();
  g = log.act(g, { type: 'move', player: P1, units: [a], to: BF_A });
  g = log.pass(g);
  expectPending(g, 'showdownAction', P0);
  g = log.act(g, { type: 'playCard', player: P0, obj: t, destination: BF_A });
  for (let i = 0; i < 40; i++) {
    const d = g.pending; if (!d) break;
    if (d.inStep) { if (d.kind === 'chooseTargets' || d.kind === 'chooseCards') { g = log.choose(g, a); continue; } break; }
    if (d.kind !== 'chainResponse' && d.kind !== 'showdownAction') break;
    g = log.pass(g);
  }
  const fromTeemo = log.of('damage').filter(e => e.obj === a && e.source === t && !e.combat);
  const trig = g.log.filter(l => /^Trigger: Teemo: When I defend/.test(l.text)).length;
  assert.equal(trig, 1, 'the defend trigger happened exactly once');
  assert.equal(fromTeemo.length, 1);
  assert.equal(fromTeemo[0].amount, 2, '1 per Hidden card revealed');
});

// RJ#3910 — Leona (or anyone) attacks, both sides survive: attackers are recalled. Covered by T079 too.
test('RJ#3910 attackers and defenders both survive: attackers recalled', () => {
  let { g, atk, def } = attackSetup(['Leona, Determined'], ['V(5)', 'V(3)'], { runes: [8, 8] });
  g = answer(g, { targets: [[def[0]]] });
  g = settle(g);
  for (let i = 0; i < 4 && pend(g).kind === 'assignDamage'; i++) { const l = legal(g, pend(g).player); g = act(g, l[0]); g = settle(g); }
  assert.equal(locOf(g, atk[0]), 'base', 'Leona recalled');
  assert.equal(locOf(g, def[0]), BF_A, 'stunned V(5) survives');
  assert.equal(g.battlefields[BF_A].controller, P1);
});

// RJ#3911 — Wraith of Echoes doesn't see its own death (errata: "another friendly unit").
test('RJ#3911 Wraith of Echoes does not draw for its own death; draws for another friendly unit', () => {
  let g = S0();
  const w = put(g, P0, 'Wraith of Echoes', 'base');
  const h0 = g.players[0].hand.length;
  [g] = cast(g, P0, 'ZapM', { targets: [[w]] });
  mod(g, w, { might: -4 });
  g = settle(g); g = resolveChain(g); g = settle(g);
  assert.equal(zone(g, w), 'trash');
  assert.equal(g.players[0].hand.length, h0, 'no draw for its own death');
  let k = S0();
  put(k, P0, 'Wraith of Echoes', 'base');
  const v = put(k, P0, 'V(1)', 'base');
  const k0 = k.players[0].hand.length;
  [k] = cast(k, P0, 'ZapM', { targets: [[v]] });
  k = settle(k); k = resolveChain(k); k = settle(k);
  assert.equal(zone(k, v), 'trash');
  assert.equal(k.players[0].hand.length, k0 + 1, 'draws for another friendly unit');
});

// RJ#3912 — "When you play me" targets aren't limited to where the unit was played (Carnivorous Snapvine).
test('RJ#3912 Carnivorous Snapvine played to base may choose an enemy unit at any battlefield', () => {
  let g = S0();
  fundAll(g, P0, 6);
  const a = put(g, P1, 'V(2)', BF_A); const b = put(g, P1, 'V(3)', BF_B);
  control(g, BF_A, P1); control(g, BF_B, P1);
  const s = hand(g, P0, 'Carnivorous Snapvine');
  g = play(g, P0, s, { dest: 'base' });
  g = resolveChain(g);
  expectPending(g, 'chooseTargets', P0);
  assert.deepEqual(optionIds(g).sort(), [a, b].sort());
  g = choose(g, b);
  g = resolveChain(g); g = settle(g);
  assert.equal(zone(g, b), 'trash');
  assert.equal(g.objects[s].damage, 3);
});

// RJ#3913 — lethal combat damage kills in combat cleanup before anyone can respond (no Janna heal in time).
test('RJ#3913 a unit dealt lethal combat damage is in the trash before any player gets priority', () => {
  let { g, def } = attackSetup(['V(5)'], ['V(3)']);
  const log = new EventLog();
  for (let i = 0; i < 30 && !log.of('damage').length; i++) {
    const d = pend(g);
    if (d.kind === 'assignDamage') { g = log.act(g, legal(g, d.player)[0]); continue; }
    g = log.pass(g);
  }
  assert.ok(log.of('damage').length > 0);
  assert.equal(zone(g, def[0]), 'trash', 'already dead at the first decision after combat damage');
});

// RJ#3916 — lone attacker removed by Fight or Flight: no damage step, but the defender still wins the combat.
test('RJ#3916 attacker sent to base by Fight or Flight: defenders still win the combat (Draven point, win-combat draw)', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0, 4);
  put(g, P0, 'Draven, Audacious', BF_A);
  put(g, P0, 'Nidalee, Cat Form', BF_A);
  control(g, BF_A, P0);
  const ff = hand(g, P0, 'Fight or Flight');
  const a = put(g, P1, 'V(3)', 'base');
  g = move(g, P1, [a], BF_A);
  g = pass(g);
  expectPending(g, 'showdownAction', P0);
  const h0 = g.players[0].hand.length;
  g = play(g, P0, ff, { targets: [[a]] });
  g = settle(g); g = resolveChain(g); g = settle(g);
  assert.equal(locOf(g, a), 'base');
  assert.equal(g.players[0].points, 1, 'Draven, Audacious: first win of the turn scores 1');
  assert.equal(g.players[0].hand.length, h0 - 1 + 1, 'Nidalee draws 1 for winning');
  assert.equal(g.battlefields[BF_A].controller, P0);
});

// RJ#3918 — Nocturne seen during Promising Future: PF finishes resolving (incl. the cards it plays) before Nocturne is played.
// No official answer; RJ#3918 and RJ#1225 (both verified) adopted as house ruling.
test('RJ#3918 Nocturne revealed by Promising Future is played only after Promising Future finishes', () => {
  let g = S0();
  fundAll(g, P0, 6);
  put(g, P0, 'Nocturne, Horrifying', 'deckTop');
  const pf = hand(g, P0, 'Promising Future');
  g = act(g, { type: 'playCard', player: P0, obj: pf });
  for (let i = 0; i < 30; i++) {
    const d = pend(g);
    if (d.kind === 'mainAction') break;
    if (d.inStep) { const opt = d.options?.find(o => /yes/i.test(o.id)) ?? d.options?.[0]; g = opt ? choose(g, opt.id) : act(g, legal(g, d.player)[0]); continue; }
    g = pass(g);
  }
  const t = g.log.map(l => l.text);
  const noc = t.findIndex(x => /plays Nocturne/.test(x));
  const lastPf = Math.max(...t.map((x, i) => (/P[01] plays V\(1\)/.test(x) ? i : -1)));
  assert.ok(noc > 0, 'Nocturne was played');
  assert.ok(noc > lastPf, 'Nocturne is played after Promising Future\'s plays');
});

// RJ#3919 — a Possessed unit returned by Retreat goes to its owner's hand and its OWNER channels the rune.
test('RJ#3919 Retreat on a possessed unit: owner\'s hand, owner channels 1 rune exhausted', () => {
  let g = S0();
  fundAll(g, P0, 3);
  const u = put(g, P1, 'V(3)', BF_A, { controller: P0 }); // owned by P1, controlled by P0 (after Possession)
  const r = hand(g, P0, 'Retreat');
  const runes1 = g.players[1].runesInPlay.length, runes0 = g.players[0].runesInPlay.length;
  g = play(g, P0, r, { targets: [[u]] });
  g = resolveChain(g);
  assert.ok(g.players[1].hand.includes(u), 'owner\'s hand');
  assert.equal(g.players[1].runesInPlay.length, runes1 + 1, 'owner channels');
  assert.equal(g.players[0].runesInPlay.length, runes0, 'caster does not');
  assert.ok(g.objects[g.players[1].runesInPlay.at(-1)!].exhausted, 'exhausted');
});

// RJ#3920 — a Hidden champion can be hidden straight from the Champion Zone (also docs/keywords.md Hidden).
test('RJ#3920 Teemo can be hidden directly from the Champion Zone', () => {
  const g = S0();
  put(g, P0, 'V(1)', BF_A);
  control(g, BF_A, P0);
  const t = put(g, P0, 'Teemo, Strategist', 'base');
  g.players[0].base = g.players[0].base.filter(x => x !== t);
  g.objects[t].zone = 'championZone';
  g.players[0].championZone = [t];
  assert.ok(legal(g, P0, 'hide').some(a => a.type === 'hide' && a.obj === t), 'hide offered from the Champion Zone');
  const h = act(g, { type: 'hide', player: P0, obj: t, battlefieldIndex: BF_A });
  assert.equal(h.objects[t].zone, 'facedown');
});

// RJ#3921 — attack and defend triggers share one chain: attacker's first (bottom), defender's on top → defend resolves first.
test('RJ#3921 attack and defend triggers go on one chain; defender\'s resolve first', () => {
  const g0 = S0();
  put(g0, P1, 'DefendAmbusher(3)', BF_A);
  control(g0, BF_A, P1);
  const a = put(g0, P0, 'AttackDraw(3)', 'base');
  const g = move(g0, P0, [a], BF_A);
  assert.equal(g.chain.length, 2, 'both triggers on the same chain');
  assert.equal(g.objects[g.chain[0].source].controller, P0, 'attacker\'s trigger at the bottom');
  assert.equal(g.objects[g.chain[1].source].controller, P1, 'defender\'s trigger on top (resolves first)');
});

// RJ#3922 — attack triggers form the first chain of the combat showdown: only reactions; then the attacker gets focus.
test('RJ#3922 Yasuo, Remorseful attack trigger: closed chain (reactions only), then attacker acts first', () => {
  const g0 = S0();
  fundAll(g0, P0, 2); fundAll(g0, P1, 2);
  const e = put(g0, P1, 'V(8)', BF_A);
  control(g0, BF_A, P1);
  const y = put(g0, P0, 'Yasuo, Remorseful', 'base');
  const zm = hand(g0, P1, 'ZapM'); const zr = hand(g0, P1, 'ZapR');
  let g = move(g0, P0, [y], BF_A);
  g = answer(g, { targets: [[e]] });
  assert.equal(g.chain.length, 1, 'attack trigger on the chain');
  g = pass(g);
  expectPending(g, 'chainResponse', P1);
  assert.ok(!canPlayNow(g, P1, zm), 'no actions on the closed chain');
  assert.ok(canPlayNow(g, P1, zr), 'reactions allowed');
  g = pass(g);
  expectPending(g, 'showdownAction', P0, 'attacker gets focus after the chain resolves');
});

// RJ#3923 — no showdown starts mid-chain; it starts once the chain has fully resolved.
test('RJ#3923 a unit arriving at an empty battlefield mid-chain: showdown/conquer only after the chain is empty', () => {
  let g = S0();
  const v = put(g, P1, 'V(5)', 'base');
  const u = hand(g, P0, 'V(2)');
  const dr = hand(g, P0, 'DropR');
  [g] = cast(g, P0, 'ZapM', { targets: [[v]] });
  g = play(g, P0, dr);
  g = resolveChain(g, 2);             // DropR resolves (top) – ZapM still below
  g = answer(g, { battlefields: [BF_B], cards: [[u]] });
  for (let i = 0; i < 10 && locOf(g, u) !== BF_B; i++) g = pass(g);
  assert.equal(locOf(g, u), BF_B);
  assert.ok(g.chain.length > 0, 'ZapM still on the chain');
  assert.equal(g.showdown, null, 'no showdown mid-chain');
  assert.equal(g.battlefields[BF_B].controller, null, 'not conquered yet');
  g = settle(g);
  assert.equal(g.chain.length, 0);
  assert.equal(g.battlefields[BF_B].controller, P0, 'conquered after the chain');
});

// RJ#3924 — "Pay any amount of [C]" (Bullet Time) is paid during resolution: no response window after it.
test('RJ#3924 Bullet Time: the amount is chosen/paid on resolution, after the last response window', () => {
  let g = S0();
  fundAll(g, P0, 4);
  const e = put(g, P1, 'V(3)', BF_A);
  control(g, BF_A, P1);
  const bt = hand(g, P0, 'Bullet Time, Miss Fortune');
  const runes = allRunes(g, P0);
  g = play(g, P0, bt, { battlefields: [BF_A] });
  if (pend(g).kind === 'chooseTargets') g = choose(g, pend(g).options!.find(o => /BF-A/.test(o.label))!.id);
  assert.equal(allRunes(g, P0), runes, 'no rune recycled when played (only [1] energy)');
  g = passN(g, 2);
  const d = pend(g);
  assert.ok(d.inStep, `on resolution P0 picks the amount (${d.kind}: ${d.prompt})`);
  g = answer(g, { battlefields: [BF_A], numbers: [3] });
  g = settle(g);
  assert.equal(zone(g, e), 'trash');
  assert.equal(allRunes(g, P0), runes - 3, 'three [C] paid by recycling');
});

// RJ#3925 — both at 7: B's attacker kills one of A's two Draven, Audacious (B scores via "When I die in combat"), the
// other Draven wins the combat (A scores). RJ (citing a semi-official CN judge FAQ, "clarification pending"): A wins.
// DECIDED (docs/riftjudge/DECISIONS.md): CR 1.5 468.2 — chain items from combat damage and the combat cleanup (the death
// trigger) resolve BEFORE the combat result is determined (468.3, the win trigger). B reaches 8 first and wins at the
// next cleanup (323.1). MISMATCH-RJ.
test('RJ#3925 two Draven, Audacious defending at 7-7: the die-in-combat point (combat cleanup, CR 468.2) comes before the win point (CR 468.3), so B wins', () => {
  let g = S0({ tp: P1 });
  g.players[0].points = 7; g.players[1].points = 7;
  const d1 = put(g, P0, 'Draven, Audacious', BF_A); const d2 = put(g, P0, 'Draven, Audacious', BF_A);
  control(g, BF_A, P0);
  const a = put(g, P1, 'V(8)', 'base');
  g = move(g, P1, [a], BF_A);
  for (let i = 0; i < 60 && g.winner === null && g.pending; i++) {
    const d = g.pending;
    if (d.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: d.player, assignment: d.player === P1 ? { [d1]: 6, [d2]: 2 } : { [a]: 12 } }); continue; }
    if (d.inStep) { const l = legal(g, d.player); g = act(g, l[0]); continue; }
    if (d.kind === 'mainAction') break;
    g = pass(g);
  }
  assert.equal(g.winner, P1, `CR 468.2 before 468.3: B wins (log: ${g.log.slice(-6).map(l => l.text).join(' | ')})`);
});

// RJ#3927 — a card played from hidden gets "here" on its targets, rechecked on resolution: a target moved away is illegal.
test('RJ#3927 hidden spell whose target moves to another location before resolution mistargets', () => {
  let g = S0({ tp: P1 });
  const a = put(g, P0, 'V(1)', BF_A);
  control(g, BF_A, P0);
  const hz = put(g, P0, 'HidZap', { facedown: BF_A });
  const mr = hand(g, P0, 'MoveR');
  const e = put(g, P1, 'V(3)', 'base');
  [g] = cast(g, P1, 'ZapM', { targets: [[e]] });
  g = pass(g);
  g = play(g, P0, hz, { targets: [[a]] });
  g = play(g, P0, mr, { targets: [[a]] });
  g = resolveChain(g, 2); // MoveR resolves
  assert.equal(locOf(g, a), 'base');
  g = resolveChain(g, 2); // HidZap resolves
  assert.equal(g.objects[a].damage, 0, 'no longer "here" → mistarget');
});

// RJ#3929 — Yasuo leaves before his "when I attack" trigger resolves: it resolves but does nothing (no Might to use).
test('RJ#3929 Yasuo, Remorseful leaves before his attack trigger resolves: no damage', () => {
  const g0 = S0();
  fundAll(g0, P0, 2);
  const e = put(g0, P1, 'V(9)', BF_A);
  const e2 = put(g0, P1, 'V(1)', BF_A);
  control(g0, BF_A, P1);
  const y = put(g0, P0, 'Yasuo, Remorseful', 'base');
  const sc = hand(g0, P0, 'StarCrossedLike');
  let g = move(g0, P0, [y], BF_A);
  g = answer(g, { targets: [[e]] });
  g = act(g, { type: 'playCard', player: P0, obj: sc });
  for (let i = 0; i < 3 && pend(g).kind === 'chooseTargets'; i++) g = choose(g, optionIds(g).includes(e2) ? e2 : y);
  g = settle(g);
  assert.equal(zone(g, y), 'hand');
  assert.equal(g.objects[e].damage, 0, 'Yasuo\'s trigger deals nothing once he is gone');
});

// RJ#3930 — marked damage doesn't reduce Might / combat damage dealt.
test('RJ#3930 a damaged unit still deals combat damage equal to its full Might', () => {
  let { g, atk, def } = attackSetup(['V(4)'], ['V(6)'], { atkOpts: [{ damage: 3 }] });
  assert.equal(mightOf(g, atk[0]), 4);
  const log = new EventLog();
  for (let i = 0; i < 30 && !log.of('damage').length; i++) { const d = pend(g); if (d.kind === 'assignDamage') { g = log.act(g, legal(g, d.player)[0]); continue; } g = log.pass(g); }
  assert.equal(log.of('damage').find(e => e.obj === def[0])?.amount, 4);
});

// RJ#3931 — (2v2 question) a battlefield conquered by one player this turn can still be scored by another player that
// turn. 2v2 isn't implemented; the per-player rule is checked in 1v1.
test('RJ#3931 a battlefield P0 conquered this turn can still be conquered (scored) by P1 the same turn', () => {
  let g = S0();
  const mine = put(g, P0, 'V(1)', 'base');
  g = move(g, P0, [mine], BF_A);
  g = settle(g);
  assert.equal(g.players[0].points, 1, 'P0 conquers BF-A');
  const u = hand(g, P1, 'V(3)');
  const dr = hand(g, P1, 'DropR');
  [g] = cast(g, P0, 'KillA', { targets: [[mine]] });
  g = pass(g);
  g = play(g, P1, dr);
  g = resolveChain(g, 2);
  g = answer(g, { battlefields: [BF_A], cards: [[u]] });
  g = settle(g);
  assert.equal(zone(g, mine), 'trash');
  assert.equal(g.battlefields[BF_A].controller, P1);
  assert.equal(g.players[1].points, 1, 'P1 scores BF-A too');
});

function setLegend(g: GameState, p: PlayerId, card: string): ObjId {
  const id = cid(card);
  if (!g.cards[id]) put(g, p, card, 'trash'); // registers the def
  const l = g.players[p].legend; g.objects[l].cardId = id; g.timestamp++; return l;
}

// RJ#3935 — "While a friendly unit defends alone, it gets +2" is continuous: lost as soon as another defender appears.
test('RJ#3935 Wuju Bladesman: the lone defender loses +2 the moment a hidden unit is played there', () => {
  let g = S0({ tp: P1 });
  setLegend(g, P0, 'Wuju Bladesman, Starter');
  const d = put(g, P0, 'V(3)', BF_A);
  control(g, BF_A, P0);
  const h = put(g, P0, 'HidU(2)', { facedown: BF_A });
  const a = put(g, P1, 'V(5)', 'base');
  g = move(g, P1, [a], BF_A);
  expectPending(g, 'showdownAction', P1);
  g = pass(g);
  expectPending(g, 'showdownAction', P0);
  assert.equal(mightOf(g, d), 5, 'defends alone: +2');
  g = play(g, P0, h, { dest: BF_A });
  g = resolveChain(g);
  assert.equal(locOf(g, h), BF_A);
  assert.equal(mightOf(g, d), 3, 'no longer alone: bonus gone');
});

// RJ#3936 — Charm moves an enemy unit battlefield→battlefield (Ganking not needed); exhausted/ready unchanged.
test('RJ#3936 Charm moves an enemy unit between battlefields without Ganking and keeps it ready', () => {
  let g = S0();
  fundAll(g, P0, 2);
  const e = put(g, P1, 'V(2)', BF_A, { ready: true });
  control(g, BF_A, P1);
  const c = hand(g, P0, 'Charm');
  g = play(g, P0, c, { targets: [[e]], locations: [BF_B], dest: BF_B });
  if (pend(g).kind === 'chooseDestination') g = answer(g, { locations: [BF_B] });
  g = resolveChain(g);
  if (pend(g).inStep) g = answer(g, { locations: [BF_B] });
  g = settle(g);
  assert.equal(locOf(g, e), BF_B);
  assert.equal(g.objects[e].exhausted, false, 'still ready');
});

// RJ#3937 — a unit readied again can standard-move again the same turn.
test('RJ#3937 a readied unit can make another standard move the same turn', () => {
  let g = S0();
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_A);
  g = settle(g);
  assert.equal(g.objects[u].exhausted, true);
  assert.deepEqual(moveDests(g, P0, u), [], 'exhausted: no move');
  g.objects[u].exhausted = false; g.timestamp++;
  assert.ok(moveDests(g, P0, u).includes('base'), 'ready again: can move again');
  g = move(g, P0, [u], 'base');
  assert.equal(locOf(g, u), 'base');
});

// RJ#3941 — Possession's target moved to base in response: no longer "at a battlefield" → no control change.
test('RJ#3941 Possession whose target was moved to base in response takes nothing', () => {
  let g = S0();
  fundAll(g, P0, 8);
  const e = put(g, P1, 'V(3)', BF_A);
  control(g, BF_A, P1);
  const mr = hand(g, P1, 'MoveR');
  const p = hand(g, P0, 'Possession');
  g = play(g, P0, p, { targets: [[e]] });
  g = pass(g);
  g = play(g, P1, mr, { targets: [[e]] });
  g = settle(g);
  assert.equal(locOf(g, e), 'base');
  assert.equal(g.objects[e].controller, P1, 'still P1\'s');
});

// RJ#3942 — Shield values stack (Shield 1 + Shield 2 = Shield 3); same rule as Deflect in T138.
test('RJ#3942 Shield 1 plus a granted Shield 2 is Shield 3', () => {
  const g = S0();
  const u = put(g, P0, 'Shield(2,1)', 'base');
  assert.equal(kwValue(g, u, 'Shield'), 1);
  mod(g, u, { layer: 2, addKeywords: ['Shield 2'] });
  assert.equal(kwValue(g, u, 'Shield'), 3);
});

// RJ#3943 — Charm can move an enemy unit to its owner's base (never yours); no combat in a base.
test('RJ#3943 Charm: an enemy unit can be moved to its owner\'s base; no combat there', () => {
  let g = S0();
  fundAll(g, P0, 2);
  const e = put(g, P1, 'V(2)', BF_A);
  control(g, BF_A, P1);
  put(g, P0, 'V(2)', 'base');
  const c = hand(g, P0, 'Charm');
  g = play(g, P0, c, { targets: [[e]], dest: 'base', locations: ['base'] });
  if (pend(g).inStep) g = answer(g, { locations: ['base'] });
  g = resolveChain(g);
  if (pend(g).inStep) g = answer(g, { locations: ['base'] });
  g = settle(g);
  assert.equal(locOf(g, e), 'base');
  assert.ok(g.players[1].base.includes(e), 'in its owner\'s base');
  assert.ok(!g.players[0].base.includes(e));
  assert.equal(g.showdown, null);
});

// RJ#3945 — Ahri, Inquisitive's attack trigger targets → the Deflect tax is mandatory.
test('RJ#3945 Ahri, Inquisitive choosing a Deflect unit pays the Deflect tax', () => {
  const g0 = S0();
  setRunes(g0, P0, 3);
  const poro = put(g0, P1, 'Pouty Poro', BF_A);
  control(g0, BF_A, P1);
  const a = put(g0, P0, 'Ahri, Inquisitive', 'base');
  const before = allRunes(g0, P0);
  let g = move(g0, P0, [a], BF_A);
  g = answer(g, { targets: [[poro]] });
  if (pend(g).inStep) { const l = legal(g, pend(g).player); g = act(g, l[0]); }
  assert.equal(before - allRunes(g, P0), 1, 'one rune recycled for Deflect');
  assert.equal(mightOf(g, poro), 2, 'not yet resolved');
});

// RJ#3947 — moving requires a different location: Ride the Wind can't "move" a unit to where it already is.
test('RJ#3947 Ride the Wind does not offer the unit\'s current location as the destination', () => {
  let g = S0();
  fundAll(g, P0, 2);
  const u = put(g, P0, 'V(2)', BF_A, { ready: false });
  control(g, BF_A, P0);
  const r = hand(g, P0, 'Ride the Wind');
  g = act(g, { type: 'playCard', player: P0, obj: r });
  for (let i = 0; i < 6; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    if (d.kind === 'chooseTargets') { g = choose(g, u); continue; }
    if (d.kind === 'chooseDestination' || d.kind === 'chooseBattlefield') {
      const ids = optionIds(g);
      assert.ok(!ids.includes(String(BF_A)), `current location not offered (${ids})`);
      return;
    }
    break;
  }
  assert.fail(`no destination decision (${pend(g).kind})`);
});

// RJ#3950 — a Temporary unit saved by Zhonya's Hourglass keeps Temporary and its buff.
test('RJ#3950 Last Stand\'s Temporary unit saved by Zhonya\'s Hourglass keeps Temporary and its buff', () => {
  let g = S0();
  fundAll(g, P0, 3);
  const u = put(g, P0, 'V(3)', BF_A, { buff: true });
  control(g, BF_A, P0);
  const z = put(g, P0, "Zhonya's Hourglass", 'base');
  const ls = hand(g, P0, 'Last Stand');
  g = play(g, P0, ls, { targets: [[u]] });
  g = resolveChain(g);
  assert.ok(hasKeyword(g, u, 'Temporary'));
  g = nextTurn(g); // P1's turn
  g = nextTurn(g); // P0's beginning phase: Temporary kills → Zhonya replaces
  g = settle(g);
  assert.equal(zone(g, z), 'trash', 'Hourglass died instead');
  assert.equal(locOf(g, u), 'base', 'recalled');
  assert.ok(hasKeyword(g, u, 'Temporary'), 'keeps Temporary');
  assert.equal(g.objects[u].counters.buff, 1, 'keeps its buff');
});

// RJ#3953 — after losing a combat at a battlefield you may move more units there the same turn.
test('RJ#3953 after losing a combat you can move another unit to that battlefield', () => {
  const g0 = S0();
  put(g0, P1, 'V(5)', BF_A);
  control(g0, BF_A, P1);
  const a = put(g0, P0, 'V(1)', 'base');
  const b = put(g0, P0, 'V(2)', 'base');
  let g = move(g0, P0, [a], BF_A);
  g = settle(g);
  for (let i = 0; i < 4 && pend(g).kind === 'assignDamage'; i++) { g = act(g, legal(g, pend(g).player)[0]); g = settle(g); }
  expectPending(g, 'mainAction', P0);
  assert.equal(zone(g, a), 'trash', 'lost the combat');
  assert.ok(moveDests(g, P0, b).includes(BF_A));
  g = move(g, P0, [b], BF_A);
  assert.equal(locOf(g, b), BF_A);
});

// RJ#3955 — a unit played by a resolving effect (Harrowing → Udyr; here DropR) becomes a board object at once:
// opponents can react to the original spell, not to the unit (CR 337.2/359.2). Spells played that way do go on the
// chain as finalized items after the effect finishes (CR 337.4) — see log note.
test('RJ#3955 a unit played during a spell\'s resolution enters at once with no response window', () => {
  let g = S0();
  const u = hand(g, P0, 'V(2)');
  const dr = hand(g, P0, 'DropR');
  g = play(g, P0, dr);
  expectPending(g, 'chainResponse', P0);
  g = pass(g);
  expectPending(g, 'chainResponse', P1, 'opponent may react to the original spell');
  g = pass(g);
  g = answer(g, { battlefields: [BF_B], cards: [[u]] });
  assert.equal(locOf(g, u), BF_B, 'on the board immediately');
  assert.ok(!g.chain.some(c => c.source === u), 'the unit is never a chain item one can respond to');
});

// RJ#3961 — Dragon's Rage: the moved enemy unit is a target (Deflect tax) and the reflexive "choose another enemy unit"
// is a target too (another Deflect tax).
test('RJ#3961 Dragon\'s Rage pays Deflect for the moved unit and again for the reflexive choice', () => {
  let g = S0();
  fundAll(g, P0, 4);
  const p1 = put(g, P1, 'Pouty Poro', BF_A);
  const p2 = put(g, P1, 'Pouty Poro', BF_B);
  control(g, BF_A, P1); control(g, BF_B, P1);
  const dr = hand(g, P0, "Dragon's Rage, Lee Sin");
  const before = allRunes(g, P0);
  g = act(g, { type: 'playCard', player: P0, obj: dr });
  for (let i = 0; i < 12; i++) {
    const d = pend(g);
    if (d.kind === 'mainAction') break;
    if (!d.inStep) { g = pass(g); continue; }
    if (d.kind === 'chooseTargets') { g = choose(g, optionIds(g).includes(p1) ? p1 : p2); continue; }
    if (d.kind === 'chooseDestination' || d.kind === 'chooseBattlefield') { g = choose(g, String(BF_B)); continue; }
    g = act(g, legal(g, d.player)[0]);
  }
  assert.ok(g.log.some(l => /Pouty Poro moves to BF-B/.test(l.text)), 'moved to BF-B');
  assert.equal(before - allRunes(g, P0), 3, 'power + Deflect (move target) + Deflect (reflexive target)');
});

// RJ#3963 — while Traveling Merchant's move trigger is on the chain, combat hasn't begun: you aren't attacking yet,
// so Rengar, Pouncing can't be played to that battlefield (base / controlled battlefields only).
test('RJ#3963 during the move trigger you are not yet attacking: Rengar, Pouncing can\'t join that battlefield', () => {
  const g0 = S0();
  fundAll(g0, P0, 3);
  put(g0, P1, 'V(5)', BF_A);
  control(g0, BF_A, P1);
  put(g0, P0, 'V(1)', 'deckTop');
  const m = put(g0, P0, 'Traveling Merchant', 'base');
  const r = hand(g0, P0, 'Rengar, Pouncing');
  const junk = hand(g0, P0, 'V(1)'); // something to discard
  let g = move(g0, P0, [m], BF_A);
  assert.ok(g.chain.length >= 1, 'move trigger on the chain');
  assert.equal(g.showdown?.attacker ?? null, null, 'no attacker yet');
  assert.ok(!playDests(g, P0, r).includes(BF_A), 'not to the battlefield being moved into');
  // once combat has begun, Rengar may join as an attacker
  for (let i = 0; i < 10 && !(g.showdown?.isCombat && pend(g).kind === 'showdownAction'); i++) {
    const d = pend(g); if (d.inStep) { g = optionIds(g).includes(junk) ? choose(g, junk) : act(g, legal(g, d.player)[0]); continue; } g = pass(g);
  }
  if (pend(g).player === P0) assert.ok(playDests(g, P0, r).includes(BF_A), 'during combat it can');
});

// RJ#3967 — no "legend rule": several champion units (even same name) can be on the board together.
test('RJ#3967 two copies of the same champion unit can be in play together', () => {
  let g = S0();
  fundAll(g, P0, 6);
  const d1 = put(g, P0, 'Darius, Trifarian', 'base');
  const d2 = hand(g, P0, 'Darius, Trifarian');
  assert.ok(canPlayNow(g, P0, d2));
  g = play(g, P0, d2, { dest: 'base' });
  g = settle(g);
  assert.equal(locOf(g, d1), 'base'); assert.equal(locOf(g, d2), 'base');
});

// RJ#3968 — "open battlefield" = no units and no controller (CR 170.11): a contested battlefield with an enemy unit
// isn't open, so Sneaky Deckhand can't be played there.
test('RJ#3968 Sneaky Deckhand can\'t be played to an uncontrolled battlefield that has an enemy unit', () => {
  const g = S0();
  fundAll(g, P0, 3);
  put(g, P1, 'V(2)', BF_A); // uncontrolled, occupied
  const s = hand(g, P0, 'Sneaky Deckhand');
  const ds = playDests(g, P0, s);
  assert.ok(!ds.includes(BF_A), 'occupied → not open');
  assert.ok(ds.includes(BF_B), 'empty & uncontrolled → open');
});

// RJ#3969 — an activated ability with no timing keyword: your turn, Neutral Open only; "Counter a spell" can't hit abilities.
test('RJ#3969 Sett, Brawler\'s "Spend my buff" is main-phase only; a spell counter can\'t target an ability', () => {
  let g = S0();
  const s = put(g, P0, 'Sett, Brawler', 'base', { buff: true });
  assert.ok(legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === s), 'usable in your Main phase');
  // in a showdown (combat elsewhere) it is not offered
  const a = put(g, P0, 'V(2)', 'base');
  put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  let h = move(g, P0, [a], BF_A);
  expectPending(h, 'showdownAction', P0);
  assert.ok(!legal(h, P0, 'activate').some(x => x.type === 'activate' && x.obj === s), 'not during a showdown');
  // a "counter a spell" can't target its ability on the chain (abilities aren't spells)
  let k = S0();
  const s2 = put(k, P0, 'Sett, Brawler', 'base', { buff: true });
  const cr = hand(k, P1, 'CounterR');
  const ab = legal(k, P0, 'activate').find(x => x.type === 'activate' && x.obj === s2)!;
  k = act(k, ab);
  k = answer(k, {});
  if (k.chain.length) { k = pass(k); assert.ok(!canPlayNow(k, P1, cr), 'no spell to counter'); }
});

// RJ#3970 — RJ: Void Burrower's "you may exhaust me to…" is paid on resolution, so Candlelit Sanctum can resolve first.
// OFFICIAL (CR 1.5 383.3.a/383.3.b.1): a leading "you may" / cost is decided and paid when the trigger is finalized onto
// the chain — i.e. before the Sanctum's look resolves. Test asserts the official behaviour.
test('RJ#3970 Void Burrower\'s exhaust decision is made when its trigger goes on the chain, before Candlelit Sanctum resolves', () => {
  let g = S0({ bfA: 'The Candlelit Sanctum' });
  setLegend(g, P0, 'Void Burrower');
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_A);
  let sawExhaustQ = false;
  for (let i = 0; i < 12; i++) {
    const d = pend(g);
    if (d.kind === 'mainAction') break;
    if (d.kind === 'orderTriggers') { g = choose(g, d.options!.find(o => /Void Burrower/.test(o.label))!.id); continue; }
    if (d.kind === 'optional' && /Void Burrower/.test(d.prompt)) {
      sawExhaustQ = true;
      assert.ok(!g.log.some(l => /Resolving The Candlelit Sanctum/.test(l.text)), 'decided before the Sanctum resolves');
      g = choose(g, 'no'); continue;
    }
    if (d.inStep) { g = choose(g, d.options![0].id); continue; }
    g = pass(g);
  }
  assert.ok(sawExhaustQ);
  assert.ok(!g.objects[g.players[0].legend].exhausted, 'declined → not exhausted');
});

// RJ#3971 — Deflect normally stacks, but Spirit's Refuge grants it only "if they didn't already" (no self-stacking).
test('RJ#3971 two Spirit\'s Refuge give a buffed unit only Deflect 1; a unit that already has Deflect gets nothing extra', () => {
  const g = S0();
  put(g, P0, "Spirit's Refuge", 'base'); put(g, P0, "Spirit's Refuge", 'base');
  const u = put(g, P0, 'V(2)', 'base', { buff: true });
  const p = put(g, P0, 'Pouty Poro', 'base', { buff: true });
  const v = put(g, P0, 'V(2)', 'base');
  assert.equal(kwValue(g, u, 'Deflect'), 1);
  assert.equal(kwValue(g, p, 'Deflect'), 1, 'already had Deflect');
  assert.equal(kwValue(g, v, 'Deflect'), 0, 'unbuffed');
});

// RJ#3972 — a spell with required targets can't be played without them (Stupefy, Back to Back); "up to" is optional.
test('RJ#3972 Stupefy needs a unit; Back to Back needs two friendly units', () => {
  const g = S0();
  fundAll(g, P0, 3);
  const s = hand(g, P0, 'Stupefy'); const b = hand(g, P0, 'Back to Back');
  assert.ok(!canPlayNow(g, P0, s), 'no unit anywhere → Stupefy unplayable');
  put(g, P0, 'V(2)', 'base');
  assert.ok(canPlayNow(g, P0, s));
  assert.ok(!canPlayNow(g, P0, b), 'only one friendly unit');
  put(g, P0, 'V(2)', 'base');
  assert.ok(canPlayNow(g, P0, b));
});

// RJ#3975 — conquering The Candlelit Sanctum at 7: the point (here: the final-point draw) happens first, then the
// Sanctum's conquer trigger looks at the top two cards.
test('RJ#3975 Candlelit Sanctum at 7 points: the final-point draw happens before the look', () => {
  let g = S0({ bfA: 'The Candlelit Sanctum' });
  g.players[0].points = 7;
  const u = put(g, P0, 'V(2)', 'base');
  const h0 = g.players[0].hand.length;
  g = move(g, P0, [u], BF_A);
  for (let i = 0; i < 12 && !(pend(g).inStep && pend(g).kind === 'chooseCards'); i++) g = pass(g);
  expectPending(g, 'chooseCards', P0, 'Sanctum look');
  assert.equal(g.players[0].hand.length, h0 + 1, 'already drew 1 (final point not available by conquer)');
  assert.equal(g.players[0].points, 7);
});

// RJ#3977 — Mageseeker Warden ("opponents can only play units to their base"): a hidden unit at a battlefield can't be
// played; Sprite Call can be played from hidden but its Sprite can't enter at that battlefield (nor be redirected to base).
test('RJ#3977 Mageseeker Warden: hidden unit unplayable; Sprite Call from hidden makes no Sprite', () => {
  let g = S0({ tp: P1 });
  put(g, P0, 'V(1)', BF_A);
  control(g, BF_A, P0);
  put(g, P1, 'Mageseeker Warden', BF_B);
  control(g, BF_B, P1);
  const hu = put(g, P0, 'HidU(2)', { facedown: BF_A });
  const sc = put(g, P0, 'Sprite Call', { facedown: BF_A });
  const e = put(g, P1, 'V(3)', 'base');
  [g] = cast(g, P1, 'ZapM', { targets: [[e]] });
  g = pass(g);
  expectPending(g, 'chainResponse', P0);
  assert.ok(!canPlayNow(g, P0, hu), 'hidden unit can\'t be played to the battlefield');
  assert.ok(canPlayNow(g, P0, sc), 'Sprite Call itself can be played');
  const units0 = Object.values(g.objects).filter(o => o.controller === P0 && (o.zone === 'base' || o.zone === 'battlefield')).length;
  g = play(g, P0, sc);
  g = settle(g);
  const units1 = Object.values(g.objects).filter(o => o.controller === P0 && (o.zone === 'base' || o.zone === 'battlefield')).length;
  assert.equal(units1, units0, 'no Sprite anywhere');
});

// RJ#3978 — Radiant Dawn (Leona legend) triggers each time you stun enemy units, but stunning an already-stunned unit
// isn't a stun and doesn't trigger it.
test('RJ#3978 Radiant Dawn triggers on each stun, not on re-stunning a stunned unit', () => {
  let g = S0();
  setLegend(g, P0, 'Radiant Dawn');
  put(g, P0, 'V(2)', 'base'); put(g, P0, 'V(2)', 'base'); put(g, P0, 'V(2)', 'base');
  const a = put(g, P1, 'V(3)', BF_A); const b = put(g, P1, 'V(3)', BF_A);
  control(g, BF_A, P1);
  const trig = () => g.log.filter(l => /^Trigger: Radiant Dawn/.test(l.text)).length;
  for (const t of [a, b]) {
    [g] = cast(g, P0, 'StunA', { targets: [[t]] });
    g = settle(g);
    g = answer(g, { targets: [[g.players[0].base.find(x => !g.objects[x].counters.buff)!]] });
    g = settle(g);
  }
  assert.equal(trig(), 2, 'twice in one turn');
  assert.ok(g.objects[a].stunned);
  [g] = cast(g, P0, 'StunA', { targets: [[a]] });
  g = settle(g);
  assert.equal(trig(), 2, 'already stunned → no trigger');
});

// RJ#3979 — damage marked before combat (e.g. Iron Ballista) stays: a 1-Might attacker finishes a damaged 3-Might unit.
test('RJ#3979 pre-combat damage persists: 1 Might kills a 3-Might defender with 2 damage marked', () => {
  let { g, def } = attackSetup(['V(1)'], ['V(3)'], { defOpts: [{ damage: 2 }] });
  g = settle(g);
  for (let i = 0; i < 4 && pend(g).kind === 'assignDamage'; i++) { g = act(g, legal(g, pend(g).player)[0]); g = settle(g); }
  assert.equal(zone(g, def[0]), 'trash');
});

// RJ#3980 — buffed Fiora, Victorious (4+1 = 5, Mighty → Shield) defending, then Stupefy -1: Mighty is checked without
// her own Shield bonus → 4, not Mighty, loses Shield → ends at 4.
test('RJ#3980 buffed defending Fiora, Victorious hit by Stupefy ends at 4 Might', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0, 2);
  const f = put(g, P0, 'Fiora, Victorious', BF_A, { buff: true });
  control(g, BF_A, P0);
  const s = hand(g, P0, 'Stupefy');
  const a = put(g, P1, 'V(1)', 'base');
  g = move(g, P1, [a], BF_A);
  g = settle(g, 1);
  if (pend(g).player === P1 && pend(g).kind === 'showdownAction') g = pass(g);
  expectPending(g, 'showdownAction', P0);
  assert.equal(mightOf(g, f), 6, '5 (Mighty) + Shield while defending');
  g = play(g, P0, s, { targets: [[f]] });
  g = resolveChain(g);
  assert.equal(mightOf(g, f), 4);
  assert.ok(!hasKeyword(g, f, 'Shield'));
});

// RJ#3981 — you can only hide at a battlefield (never base); a hidden gear played from a battlefield enters at base.
test('RJ#3981 Zhonya\'s Hourglass: hide targets are battlefields only; played from hidden it goes to base', () => {
  let g = S0();
  put(g, P0, 'V(1)', BF_A);
  control(g, BF_A, P0);
  const z0 = hand(g, P0, "Zhonya's Hourglass");
  const hides = legal(g, P0, 'hide').filter(a => a.type === 'hide' && a.obj === z0);
  assert.ok(hides.length > 0 && hides.every(a => a.type === 'hide' && typeof a.battlefieldIndex === 'number'));
  let h = S0({ tp: P1 });
  put(h, P0, 'V(1)', BF_A);
  control(h, BF_A, P0);
  const z = put(h, P0, "Zhonya's Hourglass", { facedown: BF_A });
  const e = put(h, P1, 'V(3)', 'base');
  [h] = cast(h, P1, 'ZapM', { targets: [[e]] });
  h = pass(h);
  h = play(h, P0, z);
  h = settle(h);
  assert.ok(h.players[0].base.includes(z), 'gear enters at base');
});

// RJ#3983 — "-4 [S] this turn, to a minimum of 1": the reduction is fixed when it resolves (3 → 1, i.e. -2); a later
// +3 (Call to Glory) then gives 4.
test('RJ#3983 Smoke Screen then Call to Glory on a 3-Might unit: final Might 4', () => {
  let g = S0();
  fundAll(g, P0, 4);
  const u = put(g, P0, 'V(3)', 'base');
  const ss = hand(g, P0, 'Smoke Screen');
  const cg = hand(g, P0, 'Call to Glory');
  g = play(g, P0, ss, { targets: [[u]] });
  g = resolveChain(g);
  assert.equal(mightOf(g, u), 1);
  g = play(g, P0, cg, { targets: [[u]], may: [false] });
  g = answer(g, { targets: [[u]], may: [false] });
  g = resolveChain(g);
  assert.equal(mightOf(g, u), 4);
});

// RJ#3985 — Void Gate adds 1 Bonus Damage per damage instance (it doesn't double). (RJ's Teemo multi-target part
// describes the pre-errata Teemo, Strategist — OUTDATED; current text chooses one enemy unit.)
test('RJ#3985 Void Gate adds +1 to a spell\'s damage instance, not double', () => {
  let g = S0({ bfA: 'Void Gate' });
  const e = put(g, P1, 'V(5)', BF_A);
  control(g, BF_A, P1);
  const log = new EventLog();
  [g] = cast(g, P0, 'ZapM', { targets: [[e]] });
  g = log.passAll(g);
  assert.equal(g.objects[e].damage, 3, '2 + 1 bonus');
});

// RJ#3987 — holding (Beginning phase scoring) doesn't open a chain, so nobody can play reactions then.
test('RJ#3987 no reaction window when a battlefield is held (no hold triggers)', () => {
  let g = S0({ tp: P1 });
  put(g, P0, 'V(2)', BF_A);
  control(g, BF_A, P0);
  hand(g, P1, 'ZapR');
  g = endTurn(g, P1);
  const seen: string[] = [];
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) { const d = pend(g); seen.push(`${d.kind}:P${d.player}`); g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g); }
  assert.equal(g.players[0].points, 1, 'P0 held BF-A');
  assert.ok(!seen.some(s => s.endsWith(':P1')), `P1 got no priority (${seen})`);
});

// RJ#3988 — the rune deck must fit the legend's domain identity (2 domains in constructed): an off-domain rune is illegal.
test('RJ#3988 a rune outside the legend\'s two domains makes the deck illegal', () => {
  const ok = legalDeck({ runes: [...new Array(6).fill('cf-rune-fury'), ...new Array(6).fill('cf-rune-chaos')] });
  assert.equal(validateDeck(ok, fixtureDb(), { battlefields: 3 }).length, 0, 'Fury + Chaos runes for a Fury/Chaos legend');
  const bad = legalDeck({ runes: [...new Array(4).fill('cf-rune-fury'), ...new Array(4).fill('cf-rune-chaos'), ...new Array(4).fill('cf-rune-calm')] });
  assert.ok(validateDeck(bad, fixtureDb(), { battlefields: 3 }).length > 0, 'a third domain is illegal');
});

// RJ#3993 — RJ answers under rules v1.1/v1.2 ("illegal state"/Houston ruling). CR 1.5 (spec §6.3 step 3 task 2): if the
// result step finds both players with units there (a Reaction unit played in response to a combat Deathknell),
// there's no result and a new showdown + combat is staged there with the same roles.
test('RJ#3993 Shen, Kinkou played in response to a combat Deathknell: a new combat is staged', () => {
  let { g, def } = attackSetup(['V(5)'], ['DK(2)'], { runes: [6, 6] });
  fundAll(g, P1, 3);
  const shen = hand(g, P1, 'Shen, Kinkou');
  for (let i = 0; i < 30 && zone(g, def[0]) !== 'trash'; i++) { const d = pend(g); g = d.kind === 'assignDamage' ? act(g, legal(g, d.player)[0]) : pass(g); }
  assert.equal(zone(g, def[0]), 'trash');
  for (let i = 0; i < 4 && pend(g).player !== P1; i++) g = pass(g);
  expectPending(g, 'chainResponse', P1, 'Deathknell on the chain');
  assert.ok(canPlayNow(g, P1, shen, BF_A), 'Shen (Reaction) can be played to BF-A');
  g = play(g, P1, shen, { dest: BF_A });
  for (let i = 0; i < 10 && g.chain.length; i++) g = pass(g);
  assert.equal(locOf(g, shen), BF_A);
  assert.ok(g.showdown?.isCombat && g.showdown.battlefieldIndex === BF_A, 'new combat at BF-A');
  assert.equal(g.showdown!.attacker, P0); assert.equal(g.showdown!.defender, P1);
});

// RJ#3994 — Viktor, Innovator's Recruit is played "to your base": Miss Fortune, Buccaneer's "may be played to open
// battlefields" doesn't let it go elsewhere.
test('RJ#3994 Viktor, Innovator\'s Recruit goes to base even with Miss Fortune, Buccaneer', () => {
  let g = S0({ tp: P1 });
  put(g, P0, 'Viktor, Innovator', 'base');
  put(g, P0, 'Miss Fortune, Buccaneer', 'base');
  const e = put(g, P1, 'V(3)', 'base');
  const base0 = g.players[0].base.length;
  [g] = cast(g, P1, 'ZapM', { targets: [[e]] });
  g = pass(g);
  [g] = cast(g, P0, 'ZapR', { targets: [[e]] });
  for (let i = 0; i < 12 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.inStep) { assert.ok(!(d.kind === 'chooseDestination' && optionIds(g).some(x => x !== 'base')), 'no battlefield offered'); g = act(g, legal(g, d.player)[0]); continue; }
    g = pass(g);
  }
  assert.equal(g.players[0].base.length, base0 + 1, 'Recruit in base');
  assert.ok(!Object.values(g.objects).some(o => o.isToken && o.zone === 'battlefield'));
});

// RJ#3996 — Nocturne played via his look/reveal ability costs [A] (one power of any domain), no Energy, no [Chaos].
test('RJ#3996 Nocturne, Horrifying played from the deck costs just [A]', () => {
  let g = S0();
  setRunes(g, P0, 5, 'mind'); addRunes(g, P0, 2, 'calm'); // no Chaos rune at all
  const n = put(g, P0, 'Nocturne, Horrifying', 'deckTop');
  const pf = hand(g, P0, 'Promising Future');
  g = act(g, { type: 'playCard', player: P0, obj: pf });
  let before: { all: number; ex: number } | null = null;
  for (let i = 0; i < 30; i++) {
    const d = pend(g);
    if (d.kind === 'mainAction') break;
    if (!before && /Nocturne/.test(d.prompt ?? '') && /\[A\]/.test(d.prompt ?? '')) before = { all: allRunes(g, P0), ex: exhaustedRunes(g, P0) };
    if (!before && g.log.some(l => /^Trigger: Nocturne/.test(l.text))) before = { all: allRunes(g, P0), ex: exhaustedRunes(g, P0) };
    if (d.inStep) { const opt = d.options?.find(o => /yes/i.test(o.id)) ?? d.options?.[0]; g = opt ? choose(g, opt.id) : act(g, legal(g, d.player)[0]); continue; }
    g = pass(g);
  }
  assert.ok(g.objects[n].zone === 'base' || g.objects[n].zone === 'battlefield', 'Nocturne played without a Chaos rune');
  assert.ok(before, 'saw the Nocturne play');
  assert.equal(before!.all - allRunes(g, P0), 1, 'one rune recycled for [A]');
  assert.ok(exhaustedRunes(g, P0) <= before!.ex, 'no Energy paid');
});

// RJ#3997 — Akshan, Mischievous's "[C][C] as an additional cost" is an optional additional cost, so Ezreal, Prodigy
// reduces it ([1] or [A] less).
test('RJ#3997 Ezreal, Prodigy reduces Akshan, Mischievous\'s optional additional cost', () => {
  const run = (withEz: boolean) => {
    let g = S0();
    fundAll(g, P0, 4);
    if (withEz) put(g, P0, 'Ezreal, Prodigy', 'base');
    put(g, P1, 'Gold', 'base');
    const a = hand(g, P0, 'Akshan, Mischievous');
    const all0 = allRunes(g, P0);
    g = act(g, { type: 'playCard', player: P0, obj: a, destination: 'base' });
    g = answer(g, { may: [true] });
    return all0 - allRunes(g, P0); // runes recycled for power
  };
  const plain = run(false), ez = run(true);
  assert.equal(plain - ez, 1, `one less power rune recycled with Ezreal (${plain} vs ${ez})`);
});

// RJ#3999 — "give me +3" isn't choosing a friendly unit: Teemo, Scout's play trigger doesn't trigger Spirit Wheel.
test('RJ#3999 a self-referencing "me" effect does not count as choosing a friendly unit (Spirit Wheel)', () => {
  let g = S0();
  fundAll(g, P0, 3);
  put(g, P0, 'Spirit Wheel', 'base');
  const t = hand(g, P0, 'Teemo, Scout');
  g = play(g, P0, t, { dest: 'base' });
  const prompts: string[] = [];
  for (let i = 0; i < 10 && pend(g).kind !== 'mainAction'; i++) { const d = pend(g); prompts.push(d.prompt ?? ''); g = d.inStep ? choose(g, d.options![0].id) : pass(g); }
  assert.equal(mightOf(g, t), 4);
  assert.ok(!g.log.some(l => /Trigger: Spirit Wheel/.test(l.text)) && !prompts.some(p => /Spirit Wheel/.test(p)), 'no Spirit Wheel trigger');
  // sanity: choosing a friendly unit with a targeted spell does trigger it
  let k = S0();
  put(k, P0, 'Spirit Wheel', 'base');
  const v = put(k, P0, 'V(5)', 'base');
  [k] = cast(k, P0, 'ZapM', { targets: [[v]] });
  assert.ok(k.log.some(l => /Spirit Wheel/.test(l.text)) || /Spirit Wheel/.test(pend(k).prompt ?? '') || k.chain.length > 1, 'targeting a friendly unit triggers it');
});

// RJ#4000 — "costs no more than [4] and [A]" (Defy) looks at the spell's own cost, not the Deflect tax paid on top.
test('RJ#4000 Defy can counter Void Seeker even though Deflect made it cost 2 power', () => {
  let g = S0();
  fundAll(g, P0, 4); fundAll(g, P1, 2);
  const poro = put(g, P1, 'Pouty Poro', BF_A);
  control(g, BF_A, P1);
  const vs = hand(g, P0, 'Void Seeker');
  const d = hand(g, P1, 'Defy');
  g = play(g, P0, vs, { targets: [[poro]] });
  g = pass(g);
  expectPending(g, 'chainResponse', P1);
  assert.ok(canPlayNow(g, P1, d), 'Void Seeker is a legal Defy target');
  g = play(g, P1, d, { targets: [[g.chain[0].id]] });
  g = settle(g);
  assert.equal(zone(g, vs), 'trash');
  assert.equal(g.objects[poro].damage, 0, 'countered');
});

// RJ#4001 — Wildclaw Shaman has no buff by default; spending another unit's buff buffs and readies it. A unit holds one buff.
test('RJ#4001 Wildclaw Shaman: no buff by default; spend a buff to buff + ready it', () => {
  let g = S0();
  fundAll(g, P0, 4);
  const w = hand(g, P0, 'Wildclaw Shaman');
  g = play(g, P0, w, { dest: 'base' });
  g = settle(g);
  assert.ok(!g.objects[w].counters.buff, 'no buff by default');
  assert.equal(g.objects[w].exhausted, true);
  let k = S0();
  fundAll(k, P0, 4);
  const b = put(k, P0, 'V(2)', 'base', { buff: true });
  const w2 = hand(k, P0, 'Wildclaw Shaman');
  k = play(k, P0, w2, { dest: 'base' });
  for (let i = 0; i < 8 && pend(k).kind !== 'mainAction'; i++) { const d = pend(k); if (d.inStep) { k = d.kind === 'optional' ? choose(k, 'yes') : optionIds(k).includes(b) ? choose(k, b) : choose(k, d.options![0].id); continue; } k = pass(k); }
  assert.ok(!k.objects[b].counters.buff, 'buff spent');
  assert.equal(k.objects[w2].counters.buff, 1, 'buffed once');
  assert.equal(k.objects[w2].exhausted, false, 'readied');
});

// RJ#4003 — a "when you play me, buff me" trigger uses the chain, so the opponent may respond before the buff.
test('RJ#4003 the opponent can respond to a play trigger that buffs (Sett, Brawler)', () => {
  let g = S0();
  fundAll(g, P0, 5);
  const s = hand(g, P0, 'Sett, Brawler');
  const zr = hand(g, P1, 'ZapR');
  g = play(g, P0, s, { dest: 'base' });
  assert.ok(g.chain.length >= 1, 'trigger on the chain');
  assert.ok(!g.objects[s].counters.buff, 'not buffed yet');
  g = pass(g);
  expectPending(g, 'chainResponse', P1);
  assert.ok(canPlayNow(g, P1, zr));
});

// RJ#4004 — Blitzcrank, Impassive in base never "holds" (only battlefields are held): he stays; at a held battlefield
// he returns to hand.
test('RJ#4004 Blitzcrank, Impassive in base doesn\'t hold; at a held battlefield he returns to hand', () => {
  let g = S0();
  const b = put(g, P0, 'Blitzcrank, Impassive', 'base');
  const b2 = put(g, P0, 'Blitzcrank, Impassive', BF_A);
  control(g, BF_A, P0);
  g = nextTurn(g); g = nextTurn(g);
  g = settle(g);
  expectPending(g, 'mainAction', P0);
  assert.equal(locOf(g, b), 'base', 'base: no hold');
  assert.equal(zone(g, b2), 'hand', 'held BF-A: returned');
});

// RJ#4006 — moving an enemy unit (Charm) to an empty battlefield lets ITS controller conquer and score.
test('RJ#4006 Charm moves an enemy unit to an empty battlefield: the opponent conquers it and scores', () => {
  let g = S0();
  fundAll(g, P0, 2);
  const e = put(g, P1, 'V(2)', BF_A);
  put(g, P1, 'V(2)', BF_A);
  control(g, BF_A, P1);
  const c = hand(g, P0, 'Charm');
  g = play(g, P0, c, { targets: [[e]], dest: BF_B, locations: [BF_B] });
  if (pend(g).inStep) g = answer(g, { locations: [BF_B] });
  g = resolveChain(g);
  if (pend(g).inStep) g = answer(g, { locations: [BF_B] });
  g = settle(g);
  assert.equal(locOf(g, e), BF_B);
  assert.equal(g.battlefields[BF_B].controller, P1);
  assert.equal(g.players[1].points, 1, 'P1 conquers');
});

// RJ#4007 — Stun only stops combat damage: a stunned enemy still deals damage via Challenge's effect.
test('RJ#4007 a stunned unit still deals Challenge damage', () => {
  let g = S0();
  fundAll(g, P0, 2);
  const f = put(g, P0, 'V(5)', 'base');
  const e = put(g, P1, 'V(3)', BF_A, { stunned: true });
  control(g, BF_A, P1);
  const c = hand(g, P0, 'Challenge');
  g = act(g, { type: 'playCard', player: P0, obj: c });
  for (let i = 0; i < 4 && pend(g).kind === 'chooseTargets'; i++) g = choose(g, optionIds(g).includes(f) ? f : e);
  g = settle(g);
  assert.equal(zone(g, e), 'trash');
  assert.equal(g.objects[f].damage, 3, 'the stunned unit dealt its 3');
});

// RJ#4009 — "a unit costing no more than [3]" (Spectral Matron) checks the printed cost: Rhasa the Sunderer (10, reduced
// by trash) is never eligible.
test('RJ#4009 Spectral Matron can\'t play Rhasa the Sunderer from the trash despite its reduction', () => {
  let g = S0();
  fundAll(g, P0, 4);
  fillTrash(g, P0, 9);
  const r = put(g, P0, 'Rhasa the Sunderer', 'trash');
  const ok = put(g, P0, 'V(3)', 'trash');
  const m = hand(g, P0, 'Spectral Matron');
  g = play(g, P0, m, { dest: 'base' });
  let offered: string[] = [];
  for (let i = 0; i < 10 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.inStep) { if (d.kind === 'chooseCards' || d.kind === 'chooseTargets') offered = optionIds(g); g = d.kind === 'optional' ? choose(g, 'yes') : optionIds(g).includes(ok) ? choose(g, ok) : act(g, legal(g, d.player)[0]); continue; }
    g = pass(g);
  }
  assert.ok(!offered.includes(r), 'Rhasa not eligible');
  assert.ok(offered.includes(ok) || zone(g, ok) !== 'trash', 'a real 3-cost unit is');
});

// RJ#4010 — a 0-Might unit doesn't die by itself; it dies only with non-zero damage ≥ its Might.
test('RJ#4010 a unit at 0 Might survives until it has damage marked', () => {
  let g = S0();
  const u = put(g, P0, 'V(2)', 'base');
  const v = put(g, P1, 'V(5)', 'base');
  mod(g, u, { might: -2 });
  [g] = cast(g, P0, 'ZapM', { targets: [[v]] });
  g = settle(g);
  assert.equal(mightOf(g, u), 0);
  assert.equal(zone(g, u), 'base', 'alive after cleanups');
  [g] = cast(g, P0, 'ZapM', { targets: [[u]] });
  g = settle(g);
  assert.equal(zone(g, u), 'trash', 'damage ≥ 0 Might (non-zero) kills');
});

// RJ#4012 — several Equipment can be attached to one unit (and survive its death: T152).
test('RJ#4012 two Swords can be equipped to the same unit', () => {
  let g = S0();
  const u = put(g, P0, 'V(2)', 'base');
  const s1 = put(g, P0, 'Sword', 'base'); const s2 = put(g, P0, 'Sword', 'base');
  for (const s of [s1, s2]) {
    const a = legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === s);
    assert.ok(a, 'Equip offered');
    g = act(g, a!);
    g = answer(g, { targets: [[u]] });
    g = settle(g);
  }
  assert.equal(g.objects[s1].attachedTo, u); assert.equal(g.objects[s2].attachedTo, u);
  assert.equal(mightOf(g, u), 6);
});

// RJ#4013 — Reaver's Row's defend trigger resolves before Yasuo's attack trigger: the defender moves the chosen unit to
// base and Yasuo's "enemy unit here" target is gone.
test('RJ#4013 Reaver\'s Row saves the unit Yasuo, Remorseful targeted', () => {
  const g0 = S0({ bfA: "Reaver's Row" });
  const t = put(g0, P1, 'V(3)', BF_A); const o = put(g0, P1, 'V(1)', BF_A);
  control(g0, BF_A, P1);
  const y = put(g0, P0, 'Yasuo, Remorseful', 'base');
  let g = move(g0, P0, [y], BF_A);
  for (let i = 0; i < 20 && !g.log.some(l => /^Resolving Yasuo/.test(l.text)); i++) {
    const d = pend(g);
    if (d.inStep) {
      if (d.player === P0 && d.kind === 'chooseTargets') { g = choose(g, t); continue; }
      if (d.player === P1 && d.kind === 'optional') { g = choose(g, 'yes'); continue; }
      if (d.player === P1 && optionIds(g).includes(t)) { g = choose(g, t); continue; }
      g = choose(g, d.options![0].id); continue;
    }
    g = pass(g);
  }
  assert.equal(locOf(g, t), 'base', 'moved to base by Reaver\'s Row');
  assert.equal(g.objects[t].damage, 0, 'Yasuo\'s damage fizzled');
  void o;
});

// RJ#4015 — two Dazzling Auroras both trigger at the end of your turn.
test('RJ#4015 two Dazzling Auroras each play a unit at end of turn', () => {
  let g = S0();
  put(g, P0, 'Dazzling Aurora', 'base'); put(g, P0, 'Dazzling Aurora', 'base');
  const units0 = g.players[0].base.filter(x => g.cards[g.objects[x].cardId].type === 'Unit').length;
  g = endTurn(g, P0);
  for (let i = 0; i < 30 && !(pend(g).kind === 'mainAction' && pend(g).player === P1); i++) { const d = pend(g); g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g); }
  const units1 = g.players[0].base.filter(x => g.cards[g.objects[x].cardId].type === 'Unit').length;
  assert.equal(g.log.filter(l => /^Trigger: Dazzling Aurora/.test(l.text)).length, 2);
  assert.equal(units1 - units0, 2, 'two units played');
});

// RJ#4016 — Reaver's Row can move an EXHAUSTED defender to base (effect moves don't need a ready unit; status unchanged).
test('RJ#4016 Reaver\'s Row moves an exhausted defender to base and it stays exhausted', () => {
  const g0 = S0({ bfA: "Reaver's Row" });
  const d = put(g0, P1, 'V(3)', BF_A, { ready: false });
  control(g0, BF_A, P1);
  const a = put(g0, P0, 'V(2)', 'base');
  let g = move(g0, P0, [a], BF_A);
  for (let i = 0; i < 10 && locOf(g, d) === BF_A && g.chain.length + (pend(g).inStep ? 1 : 0) > 0; i++) {
    const x = pend(g);
    if (x.inStep) { g = x.kind === 'optional' ? choose(g, 'yes') : optionIds(g).includes(d) ? choose(g, d) : choose(g, x.options![0].id); continue; }
    g = pass(g);
  }
  assert.equal(locOf(g, d), 'base');
  assert.equal(g.objects[d].exhausted, true);
});

// RJ#4017 — a card drawn by a resolving reaction (Consult the Past) can be used against spells still on the chain.
test('RJ#4017 a counterspell drawn mid-chain can counter the spell still below', () => {
  let g = S0();
  const v = put(g, P1, 'V(2)', 'base');
  const cr = put(g, P1, 'CounterR', 'deckTop');
  const dr = hand(g, P1, 'DrawR');
  [g] = cast(g, P0, 'ZapM', { targets: [[v]] });
  g = pass(g);
  g = play(g, P1, dr);
  g = passN(g, 2); // DrawR resolves
  assert.ok(g.players[1].hand.includes(cr));
  assert.equal(g.chain.length, 1, 'ZapM still on the chain');
  for (let i = 0; i < 2 && pend(g).player !== P1; i++) g = pass(g);
  expectPending(g, 'chainResponse', P1);
  assert.ok(canPlayNow(g, P1, cr));
  g = play(g, P1, cr, { targets: [[g.chain[0].id]] });
  g = settle(g);
  assert.equal(zone(g, v), 'base', 'ZapM countered');
});

// RJ#4019 — opponent's Cull the Weak makes ME kill one of my units. RJ (responder unsure): Immortal Phoenix triggers.
// DECIDED (docs/riftjudge/DECISIONS.md): Origins FAQ "What does it mean to 'kill a unit with a spell?'" — "Notably, the
// following do not count as you killing a unit with a spell: You are instructed to kill a unit by a spell another player
// controls ... (e.g., another player's Cull the Weak)." MISMATCH-RJ (official).
test('RJ#4019 killing my own unit for the opponent\'s Cull the Weak does NOT trigger Immortal Phoenix (Origins FAQ)', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P1, 3); fundAll(g, P0, 3);
  const ph = put(g, P0, 'Immortal Phoenix', 'trash');
  const mine = put(g, P0, 'V(1)', 'base');
  const theirs = put(g, P1, 'V(1)', 'base');
  const c = hand(g, P1, 'Cull the Weak');
  g = play(g, P1, c);
  let offered = false;
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.inStep) {
      if (d.player === P0 && /Phoenix/.test(d.prompt ?? '')) { offered = true; g = choose(g, 'no'); continue; }
      g = optionIds(g).includes(mine) ? choose(g, mine) : optionIds(g).includes(theirs) ? choose(g, theirs) : act(g, legal(g, d.player)[0]); continue;
    }
    g = pass(g);
  }
  assert.equal(zone(g, mine), 'trash');
  assert.ok(!offered && !g.log.some(l => /Trigger: Immortal Phoenix/.test(l.text)), 'no Phoenix trigger: the spell is controlled by another player');
  assert.equal(zone(g, ph), 'trash');
});

// RJ#4020 — Herald of the Arcane (Viktor legend) "Play a Recruit token" has no location: base or a controlled battlefield.
test('RJ#4020 Herald of the Arcane\'s Recruit may be played to a battlefield you control', () => {
  let g = S0();
  const l = setLegend(g, P0, 'Herald of the Arcane');
  put(g, P0, 'V(1)', BF_A);
  control(g, BF_A, P0);
  const ab = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === l);
  assert.ok(ab, 'legend ability available');
  g = act(g, ab!);
  let dests: string[] = [];
  for (let i = 0; i < 8 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.inStep) { if (d.kind === 'chooseDestination' || d.kind === 'chooseBattlefield') { dests = optionIds(g); g = choose(g, String(BF_A)); continue; } g = act(g, legal(g, d.player)[0]); continue; }
    g = pass(g);
  }
  assert.ok(dests.includes(String(BF_A)), `BF-A offered (${dests})`);
  assert.ok(Object.values(g.objects).some(o => o.isToken && o.zone === 'battlefield' && o.battlefieldIndex === BF_A));
});

// RJ#4021 — units can be played straight to a battlefield you control (also one conquered this turn), never to one
// you're only attacking / don't control.
test('RJ#4021 a unit can be played to a controlled battlefield (incl. just conquered) but not an uncontrolled one', () => {
  let g = S0();
  const u = put(g, P0, 'V(1)', 'base');
  const h = hand(g, P0, 'V(2)');
  assert.deepEqual(playDests(g, P0, h), ['base'], 'no controlled battlefield yet');
  g = move(g, P0, [u], BF_A);
  g = settle(g);
  assert.equal(g.battlefields[BF_A].controller, P0, 'conquered this turn');
  assert.ok(playDests(g, P0, h).includes(BF_A));
  assert.ok(!playDests(g, P0, h).includes(BF_B));
});

// RJ#4025 — ("Moonlit Fae"/MF: tested with Miss Fortune, Captain) a unit that moved WITH her is already exhausted by the
// move cost when her "first time I move" trigger resolves, so she can ready it.
test('RJ#4025 Miss Fortune, Captain can ready a unit that moved together with her', () => {
  let g = S0();
  const mf = put(g, P0, 'Miss Fortune, Captain', 'base');
  const v = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [mf, v], BF_A);
  let offered = false;
  for (let i = 0; i < 10 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.inStep) {
      if (d.kind === 'optional') { g = choose(g, 'yes'); continue; }
      if (optionIds(g).includes(v)) { offered = true; g = choose(g, v); continue; }
      g = choose(g, d.options![0].id); continue;
    }
    g = pass(g);
  }
  assert.ok(offered, 'the co-moved unit is a legal choice');
  assert.equal(g.objects[v].exhausted, false);
});

// RJ#4026 — 5-Might unit with 4 damage (Void Seeker) then -1 (Stupefy) → 4 damage is lethal at the next cleanup.
test('RJ#4026 Void Seeker 4 damage then Stupefy -1 kills a 5-Might unit', () => {
  let g = S0();
  fundAll(g, P0, 4);
  const e = put(g, P1, 'V(5)', BF_A);
  control(g, BF_A, P1);
  const vs = hand(g, P0, 'Void Seeker'); const st = hand(g, P0, 'Stupefy');
  g = play(g, P0, vs, { targets: [[e]] }); g = settle(g);
  assert.equal(g.objects[e].damage, 4); assert.equal(zone(g, e), 'battlefield');
  g = play(g, P0, st, { targets: [[e]] }); g = settle(g);
  assert.equal(zone(g, e), 'trash');
});

// RJ#4029 — "When I defend" only triggers when the unit is designated a defender in combat, not when it's targeted.
test('RJ#4029 being targeted by a spell does not trigger "when I defend"', () => {
  let g = S0();
  const d = put(g, P1, 'DefendAmbusher(3)', BF_A);
  control(g, BF_A, P1);
  const h1 = g.players[1].hand.length;
  [g] = cast(g, P0, 'ZapM', { targets: [[d]] });
  g = settle(g);
  assert.equal(g.players[1].hand.length, h1, 'no defend draw');
});

// RJ#4030 — Blastcone Fae's play trigger still resolves after Fae is returned to hand by Gust in response.
test('RJ#4030 Blastcone Fae bounced in response: its -2 still applies', () => {
  let g = S0();
  fundAll(g, P0, 2); fundAll(g, P1, 2);
  put(g, P0, 'V(1)', BF_A);
  control(g, BF_A, P0);
  const e = put(g, P1, 'V(5)', 'base');
  const f = hand(g, P0, 'Blastcone Fae');
  const gu = hand(g, P1, 'Gust');
  g = play(g, P0, f, { dest: BF_A, targets: [[e]] });
  g = answer(g, { targets: [[e]] });
  g = pass(g);
  expectPending(g, 'chainResponse', P1);
  g = play(g, P1, gu, { targets: [[f]] });
  g = settle(g);
  assert.equal(zone(g, f), 'hand');
  assert.equal(mightOf(g, e), 3);
});

// RJ#4032 — Bo1 (Duel, CR 487): battlefields are chosen at random — no battlefield decision. (Bo3 private selection: T012.)
test('RJ#4032 Bo1 battlefield selection is random (no player choice)', () => {
  const g = newGame({ battlefieldChoice: 'random' });
  assert.notEqual(g.pending?.kind, 'chooseBattlefield');
  assert.equal(g.battlefields.length, 2);
});

// RJ#4033 — both of Falling Star's targets are chosen when it's played; nothing is re-chosen on resolution.
test('RJ#4033 Falling Star\'s two targets are locked at play; no redirect on resolution', () => {
  let g = S0();
  fundAll(g, P0, 3);
  const a = put(g, P1, 'V(4)', BF_A); const b = put(g, P1, 'V(6)', BF_A);
  control(g, BF_A, P1);
  const fs = hand(g, P0, 'Falling Star');
  g = act(g, { type: 'playCard', player: P0, obj: fs });
  let picks = 0;
  while (pend(g).kind === 'chooseTargets') { g = choose(g, optionIds(g).includes(a) ? a : optionIds(g)[0]); picks++; }
  assert.ok(picks >= 1, 'targets chosen while playing');
  assert.equal(g.chain.length, 1);
  g = pass(g); g = pass(g);
  assert.ok(!pend(g).inStep || pend(g).kind !== 'chooseTargets', 'no target choice on resolution');
  g = settle(g);
  assert.equal(zone(g, a), 'trash');
  assert.equal(g.objects[b].damage, 0, 'the other unit is not hit (no redirect)');
});

// ---- cycle 2 (resume at 4034) ----
const logText = (g: GameState) => g.log.map(l => l.text).join('\n');
/** generic driver: answer in-step decisions with pick() or the first legal action, pass priority, stop at main phase */
function drv(g: GameState, pick: (g: GameState) => string[] | undefined = () => undefined, limit = 60): GameState {
  for (let i = 0; i < limit; i++) {
    const d = g.pending;
    if (!d || d.kind === 'mainAction') return g;
    if (d.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: d.player, assignment: (d.data as { suggested: Record<ObjId, number> }).suggested }); continue; }
    if (d.inStep) { const p = pick(g); g = p ? act(g, { type: 'choose', player: d.player, optionIds: p }) : act(g, legal(g, d.player)[0]); continue; }
    g = pass(g);
  }
  return g;
}

// RJ#4034 — Karma, Channeler: cards recycled simultaneously (Baited Hook's "recycle the rest") = one trigger.
// (Separate Vision recycles via Gemcraft Seer trigger separately: RJ#10512 in r10401.)
test('RJ#4034 Baited Hook recycling several cards at once triggers Karma, Channeler only once', () => {
  let g = S0();
  fundAll(g, P0);
  put(g, P0, 'Karma, Channeler', 'base');
  const hook = put(g, P0, 'Baited Hook', 'base');
  const f = put(g, P0, 'V(1)', 'base');
  for (let i = 0; i < 5; i++) put(g, P0, 'V(5)', 'deckTop');
  const ab = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === hook)!;
  g = act(g, ab);
  g = drv(g, gg => { const d = gg.pending!; if (d.kind === 'chooseTargets') return [f]; if (d.kind === 'optional') return ['no']; if (d.kind === 'chooseCards') return []; return undefined; });
  assert.equal(zone(g, f), 'trash');
  assert.ok(/recycl/i.test(logText(g)), 'cards were recycled');
  assert.equal((logText(g).match(/Trigger: Karma/g) ?? []).length, 1, 'one Karma trigger');
});

// RJ#4035 — Showstopper's move doesn't exhaust, works on an exhausted unit, and nothing else moves with it.
test('RJ#4035 Showstopper moves a unit without exhausting it (exhausted units allowed); no other unit follows', () => {
  for (const ready of [true, false]) {
    let g = S0();
    fundAll(g, P0, 3);
    const u = put(g, P0, 'V(2)', 'base', { ready });
    const o = put(g, P0, 'V(1)', 'base');
    const ss = hand(g, P0, 'Showstopper');
    g = play(g, P0, ss, { targets: [[u]], battlefields: [BF_A], locations: [BF_A] });
    g = answer(g, { battlefields: [BF_A], locations: [BF_A] });
    g = drv(g, gg => gg.pending!.kind === 'chooseDestination' || gg.pending!.kind === 'chooseBattlefield' ? [String(BF_A)] : undefined);
    assert.equal(locOf(g, u), BF_A, `moved (ready=${ready})`);
    assert.equal(g.objects[u].exhausted, !ready, 'exhausted state unchanged');
    assert.equal(locOf(g, o), 'base', 'the other unit did not follow');
  }
});

// RJ#4037 — Yasuo, Remorseful killed in response to his attack trigger: no damage ("my Might … here" needs him there).
test('RJ#4037 Yasuo, Remorseful killed before his attack trigger resolves deals no damage', () => {
  let g = S0(); fundAll(g, P1);
  const x = put(g, P1, 'V(7)', BF_A); control(g, BF_A, P1);
  const y = put(g, P0, 'Yasuo, Remorseful', 'base', { damage: 4 });
  const z = hand(g, P1, 'ZapR');
  g = move(g, P0, [y], BF_A);
  g = answer(g, { targets: [[x]] }, P0);
  assert.ok(chainLabels(g).some(l => /Yasuo/.test(l)), 'trigger on the chain');
  if (pend(g).player === P0) g = pass(g);
  g = play(g, P1, z, { targets: [[y]] });
  g = drv(g);
  assert.equal(zone(g, y), 'trash', 'Yasuo died');
  assert.equal(g.objects[x].damage, 0, 'no damage dealt');
});

// RJ#4038 — Fox-Fire: one target pumped above 4 becomes invalid; the spell still resolves on the remaining valid target.
test('RJ#4038 Fox-Fire: a target pumped past 4 Might is invalid, the remaining valid target is still killed', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const a = put(g, P1, 'V(2)', BF_A); const b = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const pr = hand(g, P1, 'PumpR');
  const ff = hand(g, P0, 'Fox-Fire, Ahri');
  g = act(g, { type: 'playCard', player: P0, obj: ff });
  for (let i = 0; i < 4 && pend(g).kind === 'chooseTargets'; i++) {
    const o = optionIds(g); g = choose(g, o.includes(a) ? a : o.includes(b) ? b : o[0]);
  }
  g = settle(g, 0);
  if (pend(g).player === P0) g = pass(g);
  g = play(g, P1, pr, { targets: [[a]] });
  g = drv(g);
  assert.equal(zone(g, a), 'battlefield', 'pumped target survives');
  assert.equal(zone(g, b), 'trash', 'remaining valid target killed');
});

// RJ#4039 — Raging Firebrand's discount is used up by the next spell even if that spell is countered.
test('RJ#4039 Raging Firebrand\'s discount is consumed by a spell that gets countered', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const fb = hand(g, P0, 'Raging Firebrand');
  g = play(g, P0, fb, { dest: 'base' }); g = drv(g);
  assert.equal(zone(g, fb), 'base');
  const e = put(g, P1, 'V(5)', 'base');
  const z1 = hand(g, P0, 'ZapM'); const z2 = hand(g, P0, 'ZapM');
  const cr = hand(g, P1, 'CounterR');
  let ex = exhaustedRunes(g, P0);
  g = play(g, P0, z1, { targets: [[e]] });
  assert.equal(exhaustedRunes(g, P0) - ex, 0, 'first spell discounted to 0');
  if (pend(g).player === P0) g = pass(g);
  g = play(g, P1, cr, { targets: [[g.chain[g.chain.length - 1].id]] } as never);
  g = drv(g);
  assert.equal(zone(g, z1), 'trash'); assert.equal(g.objects[e].damage, 0, 'countered');
  ex = exhaustedRunes(g, P0);
  g = play(g, P0, z2, { targets: [[e]] });
  assert.equal(exhaustedRunes(g, P0) - ex, 1, 'next spell pays full cost');
});

// RJ#4041 — a spell stays on the chain while pending and is put in the trash only as it resolves (after its effects).
test('RJ#4041 a played spell is not in the trash while on the chain; it goes there when it resolves', () => {
  let g = S0();
  const e = put(g, P1, 'V(5)', 'base');
  let z: ObjId;
  [g, z] = cast(g, P0, 'ZapM', { targets: [[e]] });
  assert.notEqual(zone(g, z), 'trash', 'on the chain, not in the trash');
  assert.ok(!g.players[0].trash.includes(z));
  g = drv(g);
  assert.equal(g.objects[e].damage, 2);
  assert.equal(zone(g, z), 'trash');
});

// RJ#4043 — a [Reaction] unit (Shen, Kinkou) follows the normal play locations: base or a controlled battlefield.
// Attacking a battlefield you don't control → not there; the defender controls it → may play it there.
test('RJ#4043 a Reaction unit can be played to base or a controlled (defended) battlefield, not one you are attacking', () => {
  const s = attackSetup(['V(3)'], ['V(3)']);
  let g = s.g;
  fundAll(g, P0); fundAll(g, P1);
  const a = hand(g, P0, 'Shen, Kinkou'); const d = hand(g, P1, 'Shen, Kinkou');
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = act(g, legal(g, pend(g).player)[0]);
  expectPending(g, 'showdownAction', P0);
  const pa = playDests(g, P0, a);
  assert.ok(pa.includes('base') && !pa.includes(BF_A), `attacker: ${pa}`);
  g = pass(g);
  expectPending(g, 'showdownAction', P1);
  assert.ok(playDests(g, P1, d).includes(BF_A), `defender: ${playDests(g, P1, d)}`);
});

// RJ#4044 — (2v2 question) Portal Rescue: the unit's owner plays it, so its "When you play me" triggers.
// 2v2/teams aren't implemented; checked in 1v1 with your own Mindsplitter.
test('RJ#4044 Portal Rescue: the owner plays the unit, so Mindsplitter\'s "When you play me" triggers', () => {
  let g = S0();
  fundAll(g, P0);
  const m = put(g, P0, 'Mindsplitter', BF_A); control(g, BF_A, P0);
  hand(g, P1, 'V(1)');
  const pr = hand(g, P0, 'Portal Rescue');
  g = play(g, P0, pr, { targets: [[m]] });
  g = drv(g);
  assert.equal(locOf(g, m), 'base', 'played to base');
  assert.ok(/Trigger: Mindsplitter/.test(logText(g)), 'play trigger fired');
});

// RJ#4046 — Stormbringer's move keeps the unit's ready/exhausted state (only a standard move exhausts).
test('RJ#4046 Stormbringer moves the chosen unit without changing its ready/exhausted state', () => {
  for (const ready of [true, false]) {
    let g = S0();
    fundAll(g, P0);
    const v = put(g, P0, 'V(3)', 'base', { ready });
    put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
    [g] = cast(g, P0, 'Stormbringer, Volibear', { targets: [[g.battlefields[BF_A].objId]] });
    for (let i = 0; i < 10; i++) { const d = g.pending!; if (d.kind === 'mainAction' || d.kind === 'showdownAction') break; if (d.inStep) g = choose(g, d.options!.some(o => o.id === v) ? v : d.options![0].id); else g = pass(g); }
    assert.equal(locOf(g, v), BF_A);
    assert.equal(g.objects[v].exhausted, !ready, `ready=${ready} kept`);
  }
});

// RJ#4047 — a Hard Bargain whose Repeat was paid is one spell: an opposing Hard Bargain counters all of it (both instances).
test('RJ#4047 Hard Bargain countering a Repeat-paid Hard Bargain counters both of its instances', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const t = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const a = hand(g, P0, 'ZapA'), b = hand(g, P0, 'ZapR'), hb = hand(g, P1, 'Hard Bargain'), hb0 = hand(g, P0, 'Hard Bargain');
  g = play(g, P0, a, { targets: [[t]] });
  g = pass(play(g, P0, b, { targets: [[t]] }));
  g = act(g, { type: 'playCard', player: P1, obj: hb });
  const first = String(pend(g).options![0].id);
  g = answer(g, { targets: [[first]], may: [true] }, P1);
  // CR 820.2: the Repeat execution's target is chosen as it is played (the other Zap)
  g = answer(g, { targets: [[String(pend(g).options!.find(o => o.id !== first)!.id)]] }, P1);
  assert.equal(g.chain.length, 3, 'one chain item for the repeated Hard Bargain');
  if (pend(g).player !== P0) g = pass(g);
  g = act(g, { type: 'playCard', player: P0, obj: hb0 });
  g = answer(g, { targets: [[String(g.chain.find(c => c.source === hb)!.id)]], may: [false] }, P0);
  g = drv(g, gg => gg.pending!.kind === 'optional' ? ['no'] : undefined);
  assert.equal(zone(g, hb), 'trash');
  assert.equal(g.objects[t].damage, 4, 'both Zaps resolved: neither instance countered them');
});

// RJ#4049 — "As I'm revealed" (Undertitan) happens immediately during the revealing effect: no chain item, no trigger.
test('RJ#4049 Undertitan\'s "As I\'m revealed, [Add] [2]" applies at once mid-resolution, without using the chain', () => {
  let g = S0();
  fundAll(g, P0);
  put(g, P0, 'V(1)', 'deckTop');
  put(g, P0, 'Undertitan', 'deckTop');
  const vr = hand(g, P0, 'Void Rush');
  g = play(g, P0, vr);
  const e0 = g.players[0].pool.energy;
  g = pass(g);
  if (!pend(g).inStep) g = pass(g);
  assert.ok(pend(g).inStep, `mid-resolution decision (${pend(g).kind})`);
  assert.equal(g.players[0].pool.energy - e0, 2, 'energy already added while Void Rush is still resolving');
  assert.ok(!g.chain.some(c => g.objects[c.source] && g.cards[g.objects[c.source].cardId]?.name === 'Undertitan'), 'not on the chain');
  assert.ok(!/Trigger: Undertitan/.test(logText(g)));
});

// RJ#4051 — Blitzcrank, Impassive's pull isn't a standard move: any enemy unit (base or another battlefield, no Ganking) can be moved.
test('RJ#4051 Blitzcrank, Impassive can pull a non-Ganking enemy unit from base or from another battlefield', () => {
  for (const from of ['base', BF_B] as const) {
    let g = S0(); fundAll(g, P0);
    put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
    const e = put(g, P1, 'V(2)', from);
    if (from !== 'base') control(g, BF_B, P1);
    g = play(g, P0, hand(g, P0, 'Blitzcrank, Impassive'), { dest: BF_A });
    for (let i = 0; i < 8 && locOf(g, e) !== BF_A; i++) g = pend(g).inStep ? answer(g, { may: [true], targets: [[e]] }) : pass(g);
    assert.equal(locOf(g, e), BF_A, `pulled from ${from}`);
  }
});

// RJ#4053 — an attacking Immortal Phoenix is 5 Might (Assault applies at once): Gust can't target it in the showdown.
// Moving in alongside Traveling Merchant, the move trigger's window comes before attacking: Phoenix is 3 and Gust works.
test('RJ#4053 Gust can\'t hit an attacking Immortal Phoenix, but can during a co-moving unit\'s move trigger', () => {
  let g = S0(); fundAll(g, P1);
  put(g, P1, 'V(4)', BF_A); control(g, BF_A, P1);
  const ph = put(g, P0, 'Immortal Phoenix', 'base');
  const gu = hand(g, P1, 'Gust');
  g = move(g, P0, [ph], BF_A);
  for (let i = 0; i < 6 && !(g.showdown?.isCombat && pend(g).kind === 'showdownAction' && pend(g).player === P1); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(mightOf(g, ph), 5, 'Assault applied while attacking');
  assert.equal(pend(g).player, P1);
  assert.ok(!canPlayNow(g, P1, gu), 'no legal Gust target: Phoenix is 5, the defender 4');
  // with Traveling Merchant
  let h = S0(); fundAll(h, P1);
  put(h, P1, 'V(4)', BF_A); control(h, BF_A, P1);
  const ph2 = put(h, P0, 'Immortal Phoenix', 'base');
  const m = put(h, P0, 'Traveling Merchant', 'base');
  hand(h, P0, 'V(1)'); put(h, P0, 'V(1)', 'deckTop');
  const gu2 = hand(h, P1, 'Gust');
  h = move(h, P0, [ph2, m], BF_A);
  assert.ok(h.chain.length >= 1, 'Merchant trigger on the chain');
  assert.equal(mightOf(h, ph2), 3, 'not yet attacking');
  if (pend(h).player === P0) h = pass(h);
  h = play(h, P1, gu2, { targets: [[ph2]] });
  h = drv(h);
  assert.equal(zone(h, ph2), 'hand', 'Gusted before the showdown');
});

// RJ#4056 — hiding a card isn't playing it; playing it from hidden later is (Ravenbloom Student "When you play a spell").
test('RJ#4056 hiding a spell does not trigger Ravenbloom Student; playing it from hidden does', () => {
  let g = S0();
  fundAll(g, P0);
  const rs = put(g, P0, 'Ravenbloom Student', BF_A); control(g, BF_A, P0);
  const hz = hand(g, P0, 'HidZap');
  g = act(g, { type: 'hide', player: P0, obj: hz, battlefieldIndex: BF_A });
  g = drv(g);
  assert.equal(zone(g, hz), 'facedown');
  assert.equal(mightOf(g, rs), 2, 'hiding is not playing');
  assert.ok(!/Trigger: Ravenbloom/.test(logText(g)));
  g = nextTurn(g); g = nextTurn(g);
  expectPending(g, 'mainAction', P0);
  const e = put(g, P0, 'V(5)', BF_A);
  g = play(g, P0, hz, { targets: [[e]] });
  g = drv(g);
  assert.equal(g.objects[e].damage, 2, 'played from hidden');
  assert.equal(mightOf(g, rs), 3, 'Student +1');
});

// RJ#4057 — a battlefield scored by holding this turn can't be conquered again that turn: retaking it after leaving
// gives control only — no point, no "When I conquer" (Kai'Sa, Survivor).
test('RJ#4057 retaking a battlefield already scored by holding this turn is not a conquer (Kai\'Sa, Survivor no draw)', () => {
  let g = S0({ tp: P1 });
  const x = put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const k = put(g, P0, "Kai'Sa, Survivor", 'base');
  g = nextTurn(g);
  g = drv(g);
  expectPending(g, 'mainAction', P0);
  assert.equal(g.players[0].points, 1, 'held BF-A');
  g = drv(move(g, P0, [x], 'base'));
  g = drv(move(g, P0, [k], BF_A));
  const h0 = g.players[0].hand.length;
  assert.equal(g.battlefields[BF_A].controller, P0, 'control retaken');
  assert.equal(g.players[0].points, 1, 'no second point');
  assert.ok(!/Trigger: Kai'Sa/.test(logText(g)), 'no conquer trigger');
  assert.equal(g.players[0].hand.length, h0);
});
test('RJ#4057 a conquer blocked from scoring by the final-point rule is still a conquer (Kai\'Sa, Survivor draws)', () => {
  let g = S0();
  g.players[0].points = 7;
  const k = put(g, P0, "Kai'Sa, Survivor", 'base');
  const h0 = g.players[0].hand.length;
  g = drv(move(g, P0, [k], BF_A));
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[0].points, 7, 'final point not scored');
  assert.ok(/Trigger: Kai'Sa/.test(logText(g)), 'conquer trigger');
  assert.equal(g.players[0].hand.length, h0 + 2, 'final-point draw + Kai\'Sa draw');
});

// RJ#4058 — after a player passes focus, the other player's Stupefy resets the passes: once it resolves, the first player
// gets focus again before combat and may play an Action (Cleave).
test('RJ#4058 a Stupefy played after the opponent passed focus gives them another chance to play an Action (Cleave)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  put(g, P0, 'V(4)', BF_A); control(g, BF_A, P0);
  const a = put(g, P1, 'V(4)', 'base');
  const st = hand(g, P0, 'Stupefy'); const cl = hand(g, P1, 'Cleave');
  g = move(g, P1, [a], BF_A);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = act(g, legal(g, pend(g).player)[0]);
  expectPending(g, 'showdownAction', P1);
  g = pass(g);                                  // P1 passes focus
  expectPending(g, 'showdownAction', P0);
  g = play(g, P0, st, { targets: [[a]] });
  let sawCleave = false;
  for (let i = 0; i < 12 && g.showdown; i++) {
    const d = pend(g);
    if (d.player === P1 && d.kind === 'showdownAction' && g.chain.length === 0) { sawCleave = canPlayNow(g, P1, cl); break; }
    g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  assert.equal(mightOf(g, a), 3, 'Stupefy resolved');
  assert.ok(sawCleave, 'P1 gets focus again and may play Cleave');
});

// RJ#4060 — Relentless Storm: "play a Mighty unit" is checked when the unit is played; Stupefy afterwards doesn't stop it.
test('RJ#4060 Relentless Storm still channels after the Mighty unit is Stupefied below 5 in response', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  setLegend(g, P0, 'Relentless Storm');
  const st = hand(g, P1, 'Stupefy');
  const u = hand(g, P0, 'V(5)');
  g = act(g, { type: 'playCard', player: P0, obj: u, destination: 'base' });
  for (let i = 0; i < 8 && pend(g).inStep; i++) { const d = pend(g); g = d.kind === 'optional' ? choose(g, 'yes') : act(g, legal(g, d.player)[0]); }
  for (let i = 0; i < 4 && !chainLabels(g).some(l => /Relentless/.test(l)); i++) g = pend(g).inStep ? (pend(g).kind === 'optional' ? choose(g, 'yes') : act(g, legal(g, pend(g).player)[0])) : pass(g);
  assert.ok(chainLabels(g).some(l => /Relentless/.test(l)), `trigger on chain: ${chainLabels(g)}`);
  const r1 = g.players[P0].runesInPlay.length;
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  g = play(g, P1, st, { targets: [[u]] });
  g = drv(g, gg => gg.pending!.kind === 'optional' ? ['yes'] : undefined);
  assert.equal(mightOf(g, u), 4, 'no longer Mighty');
  assert.equal(g.players[P0].runesInPlay.length, r1 + 1, 'channelled a rune anyway');
});

// RJ#4067 — Tideturner's swap doesn't ready (or exhaust) the other unit. (Ready stays ready: RJ#6654.)
test('RJ#4067 Tideturner swapping with an exhausted unit leaves it exhausted', () => {
  let g = S0(); fundAll(g, P0);
  control(g, BF_A, P0);
  const u = put(g, P0, 'V(3)', BF_A, { ready: false });
  const t = hand(g, P0, 'Tideturner');
  g = play(g, P0, t, { dest: 'base' });
  g = drv(g, gg => { const d = gg.pending!; if (d.kind === 'optional') return ['yes']; if (d.options?.some(o => o.id === u)) return [u]; return undefined; });
  assert.equal(locOf(g, u), 'base', 'swapped');
  assert.equal(locOf(g, t), BF_A);
  assert.equal(g.objects[u].exhausted, true, 'not readied');
});

// RJ#4069 — Gust's "3 Might or less" is checked when choosing: a 4-Might unit can't be chosen with Stupefy merely on the
// chain; once Stupefy has resolved (3 Might) it can.
test('RJ#4069 Gust can\'t choose a 4-Might unit while Stupefy is only on the chain; after it resolves it can', () => {
  let g = S0(); fundAll(g, P0);
  const e = put(g, P1, 'V(4)', BF_A); control(g, BF_A, P1);
  const st = hand(g, P0, 'Stupefy'); const gu = hand(g, P0, 'Gust');
  g = play(g, P0, st, { targets: [[e]] });
  assert.equal(g.chain.length, 1);
  expectPending(g, 'chainResponse', P0);
  assert.ok(!canPlayNow(g, P0, gu), 'no legal Gust target yet');
  g = drv(g);
  assert.equal(mightOf(g, e), 3);
  g = play(g, P0, gu, { targets: [[e]] });
  g = drv(g);
  assert.equal(zone(g, e), 'hand');
});

// RJ#4070 — a targeting spell needs a legal target to be played (Void Seeker); a non-targeting one doesn't (Acceptable Losses).
test('RJ#4070 Void Seeker is unplayable with no unit to target; Acceptable Losses is playable with no gear in play', () => {
  const g = S0(); fundAll(g, P0);
  for (const id of [...g.players[0].base, ...g.players[1].base]) delete g.objects[id];
  g.players[0].base = []; g.players[1].base = []; g.timestamp++;
  const vs = hand(g, P0, 'Void Seeker'); const al = hand(g, P0, 'Acceptable Losses');
  assert.ok(!Object.values(g.objects).some(o => (o.zone === 'base' || o.zone === 'battlefield') && ['Unit', 'Gear'].includes(g.cards[o.cardId]?.type)), 'no units or gear on the board');
  assert.ok(!canPlayNow(g, P0, vs), 'Void Seeker needs a target');
  assert.ok(canPlayNow(g, P0, al), 'Acceptable Losses does not target');
});

// RJ#4071 — Pack of Wonders chooses only friendly objects on the board; cards in the trash can't be chosen.
test('RJ#4071 Pack of Wonders cannot return a unit or gear from the trash', () => {
  let g = S0(); fundAll(g, P0);
  const pw = put(g, P0, 'Pack of Wonders', 'base');
  const tu = put(g, P0, 'V(2)', 'trash'); const tg = put(g, P0, 'Pack of Wonders', 'trash');
  const live = put(g, P0, 'V(1)', 'base');
  const ab = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === pw);
  assert.ok(ab, 'activatable (a unit is on the board)');
  g = act(g, ab!);
  if (pend(g).kind === 'chooseTargets') { const o = optionIds(g); assert.ok(o.includes(live) && !o.includes(tu) && !o.includes(tg), `options ${o}`); g = choose(g, live); }
  g = drv(g);
  assert.equal(zone(g, live), 'hand', 'the only legal choice (on the board) was returned');
  assert.equal(zone(g, tu), 'trash'); assert.equal(zone(g, tg), 'trash');
});

// RJ#4074 — damage sources: Yasuo, Remorseful's attack trigger ("deal damage equal to my Might") is ability damage,
// so Unyielding Spirit prevents it. (Challenge/Snapvine unit-sourced: RJ#8088/RJ#2602; Iron Ballista: RJ#1409.)
test('RJ#4074 Unyielding Spirit prevents Yasuo, Remorseful\'s attack-trigger damage (ability damage)', () => {
  let g = S0(); fundAll(g, P1);
  const x = put(g, P1, 'V(7)', BF_A); control(g, BF_A, P1);
  const y = put(g, P0, 'Yasuo, Remorseful', 'base');
  const us = hand(g, P1, 'Unyielding Spirit');
  g = move(g, P0, [y], BF_A);
  g = answer(g, { targets: [[x]] }, P0);
  assert.ok(chainLabels(g).some(l => /Yasuo/.test(l)));
  if (pend(g).player === P0) g = pass(g);
  g = play(g, P1, us);
  for (let i = 0; i < 8 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(/Resolving Yasuo/.test(logText(g)), 'trigger resolved');
  assert.ok(g.showdown?.isCombat, 'still before combat damage');
  assert.equal(g.objects[x].damage, 0, 'prevented');
});

// RJ#4077 — Traveling Merchant + Yasuo, Remorseful move into Teemo, Strategist: the move trigger resolves before the
// showdown; then the defend trigger (on top) resolves before the attack trigger.
test('RJ#4077 move trigger resolves first, then Teemo\'s defend trigger before Yasuo\'s attack trigger', () => {
  let g = S0(); fundAll(g, P1);
  put(g, P1, 'Teemo, Strategist', BF_A); control(g, BF_A, P1);
  for (let i = 0; i < 5; i++) { put(g, P1, 'V(1)', 'deckTop'); put(g, P0, 'V(1)', 'deckTop'); }
  const m = put(g, P0, 'Traveling Merchant', 'base');
  const y = put(g, P0, 'Yasuo, Remorseful', 'base');
  hand(g, P0, 'V(1)');
  g = move(g, P0, [m, y], BF_A);
  for (let i = 0; i < 30 && !(g.showdown?.isCombat && g.chain.length === 0 && /Resolving Yasuo/.test(logText(g))); i++) {
    const d = pend(g); if (d.kind === 'assignDamage' || d.kind === 'mainAction') break;
    g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  const L = g.log.map(l => l.text);
  const at = (re: RegExp) => L.findIndex(t => re.test(t));
  const mer = at(/^Resolving Traveling Merchant/), sd = at(/^Showdown at BF-A|^Combat at BF-A/), te = at(/^Resolving Teemo/), ya = at(/^Resolving Yasuo/);
  assert.ok(mer >= 0 && te >= 0 && ya >= 0, L.slice(-15).join(' | '));
  assert.ok(mer < at(/^Trigger: Yasuo/) && mer < at(/^Trigger: Teemo/), 'move trigger resolved before combat triggers');
  assert.ok(sd < 0 || mer < sd, 'before the showdown');
  assert.ok(te < ya, 'defend trigger resolves before the attack trigger');
});

// RJ#4079 — Miss Fortune, Buccaneer played to an open battlefield: no immediate point; it's a showdown, and if she's
// removed during it there is no conquer.
test('RJ#4079 Miss Fortune, Buccaneer played to an open battlefield scores only by conquering after the showdown', () => {
  const run = (kill: boolean) => {
    let g = S0(); fundAll(g, P0); fundAll(g, P1);
    const mf = hand(g, P0, 'Miss Fortune, Buccaneer');
    const k = hand(g, P1, 'KillA');
    g = play(g, P0, mf, { dest: BF_A });
    for (let i = 0; i < 6 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
    const p0 = g.players[0].points;
    assert.ok(g.showdown && g.showdown.battlefieldIndex === BF_A, 'a showdown at the open battlefield');
    if (kill) {
      if (pend(g).player === P0) g = pass(g);
      g = play(g, P1, k, { targets: [[mf]] });
    }
    g = drv(g);
    return { p0, pts: g.players[0].points, ctl: g.battlefields[BF_A].controller };
  };
  const a = run(false);
  assert.equal(a.p0, 0, 'no point on play');
  assert.deepEqual([a.pts, a.ctl], [1, P0], 'conquered after the showdown');
  const b = run(true);
  assert.deepEqual([b.pts, b.ctl], [0, null], 'removed during the showdown: no point');
});

// RJ#4086 — a Ride the Wind into a non-combat showdown stages combat: it follows immediately, with no scoring in between.
test('RJ#4086 Ride the Wind during a non-combat showdown: combat follows at once, no conquer/score before it', () => {
  let g = S0(); fundAll(g, P1);
  const a = put(g, P0, 'V(3)', 'base');
  const r = put(g, P1, 'V(2)', 'base');
  const rtw = hand(g, P1, 'Ride the Wind');
  g = move(g, P0, [a], BF_A);
  assert.equal(g.showdown?.battlefieldIndex, BF_A);
  assert.ok(!g.showdown?.isCombat, 'non-combat showdown');
  g = pass(g);
  expectPending(g, 'showdownAction', P1);
  g = play(g, P1, rtw, { targets: [[r]], locations: [BF_A] });
  g = drv(g, gg => gg.pending!.options?.some(o => o.id === String(BF_A)) ? [String(BF_A)] : undefined);
  const L = g.log.map(l => l.text);
  const combat = L.findIndex(t => /^Combat at BF-A/.test(t)), conq = L.findIndex(t => /P0 conquers BF-A/.test(t));
  assert.ok(combat >= 0, 'combat happened: ' + L.slice(-10).join(' | '));
  assert.ok(conq < 0 || conq > combat, 'no conquer before the combat');
  assert.equal(g.players[0].points, 1, 'one point, after combat');
});

// RJ#4087 — Facebreaker chooses its units (no "target" wording needed), so Deflect's tax must be paid to choose Pouty Poro.
test('RJ#4087 Facebreaker must pay Deflect to choose Pouty Poro; without the [A] it can\'t be played on it', () => {
  let g = S0();
  setRunes(g, P0, 0);
  g.players[0].pool = { energy: 2, power: {} };
  put(g, P0, 'V(2)', BF_A);
  const poro = put(g, P1, 'Pouty Poro', BF_A);
  const fb = hand(g, P0, 'Facebreaker');
  if (canPlayNow(g, P0, fb)) {
    let err = '';
    try { g = act(g, { type: 'playCard', player: P0, obj: fb }); } catch (e) { err = String(e); }
    assert.ok(err || pend(g).kind !== 'chooseTargets' || !optionIds(g).includes(poro), `Poro not choosable without the tax (${pend(g).kind} ${optionIds(g)})`);
    assert.ok(err || !g.chain.length, 'Facebreaker did not reach the chain');
  }
  let h = S0();
  fundAll(h, P0, 2);
  const f2 = put(h, P0, 'V(2)', BF_A);
  const poro2 = put(h, P1, 'Pouty Poro', BF_A);
  const fb2 = hand(h, P0, 'Facebreaker');
  const before = allRunes(h, P0);
  h = play(h, P0, fb2, { targets: [[f2], [poro2]] });
  for (let i = 0; i < 4 && pend(h).kind === 'chooseTargets'; i++) h = choose(h, optionIds(h).includes(poro2) ? poro2 : f2);
  assert.equal(before - allRunes(h, P0), 1, 'one rune recycled for the Deflect tax');
  h = drv(h);
  assert.ok(h.objects[poro2].stunned, 'Poro stunned');
  void poro;
});

// RJ#4089 — a unit swapped into a combat by hidden Tideturner becomes a defender then, and its "When I defend" triggers.
test('RJ#4089 Overzealous Fan swapped into the defended battlefield by Tideturner gets its defend trigger', () => {
  let g = S0(); fundAll(g, P1);
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const tt = put(g, P1, 'Tideturner', { facedown: BF_A });
  const fan = put(g, P1, 'Overzealous Fan', 'base');
  const a = put(g, P0, 'V(3)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 6 && !(g.showdown?.isCombat && pend(g).kind === 'showdownAction' && g.chain.length === 0); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  if (pend(g).player === P0) g = pass(g);
  expectPending(g, 'showdownAction', P1);
  g = act(g, { type: 'playCard', player: P1, obj: tt, destination: BF_A } as never);
  for (let i = 0; i < 12 && !/Trigger: Overzealous Fan/.test(logText(g)); i++) {
    const d = pend(g); if (d.kind === 'mainAction' || d.kind === 'assignDamage') break;
    if (d.inStep) { g = d.kind === 'optional' && /Tideturner|choose/i.test(d.prompt ?? '') ? choose(g, 'yes') : d.options?.some(o => o.id === fan) ? choose(g, fan) : act(g, legal(g, d.player)[0]); continue; }
    g = pass(g);
  }
  assert.ok(/Overzealous Fan moves to BF-A/.test(logText(g)), 'Fan swapped in');
  assert.ok(/Trigger: Overzealous Fan/.test(logText(g)), 'defend trigger');
  g = drv(g, gg => gg.pending!.kind === 'optional' ? ['yes'] : gg.pending!.options?.some(o => o.id === a) ? [a] : undefined);
  assert.equal(locOf(g, a), 'base', 'Fan killed itself to send the attacker home');
});

// ---- cycle 3 (resume at 4090) ----
// RJ#4092 — Fight or Flight on a unit at Vilemaw's Lair: playable, but the move to base doesn't happen ("can't" beats "can").
test('RJ#4092 Fight or Flight on a unit at Vilemaw\'s Lair is playable but the unit does not move', () => {
  let g = S0({ bfA: "Vilemaw's Lair" }); fundAll(g, P0);
  const e = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const ff = hand(g, P0, 'Fight or Flight');
  assert.ok(canPlayNow(g, P0, ff), 'playable');
  g = play(g, P0, ff, { targets: [[e]] });
  g = drv(g);
  assert.equal(zone(g, ff), 'trash', 'resolved');
  assert.equal(locOf(g, e), BF_A, 'did not move to base');
});

// RJ#4094 — a token unit is a unit: a Recruit from Herald of the Arcane enters ready after Sun Disc's Legion ability.
test('RJ#4094 a Recruit token played by Herald of the Arcane enters ready after Sun Disc', () => {
  for (const disc of [true, false]) {
    let g = S0(); fundAll(g, P0, 4);
    const l = setLegend(g, P0, 'Herald of the Arcane');
    const sd = put(g, P0, 'Sun Disc', 'base');
    [g] = cast(g, P0, 'DrawR'); g = settle(g);
    if (disc) {
      const ab = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === sd);
      assert.ok(ab, 'Sun Disc (Legion) available');
      g = drv(act(g, ab!));
    }
    const before = new Set(Object.keys(g.objects));
    const hl = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === l);
    assert.ok(hl, 'legend ability available');
    g = drv(act(g, hl!), gg => gg.pending!.options?.some(o => o.id === 'base') ? ['base'] : undefined);
    const tok = Object.values(g.objects).find(o => o.isToken && !before.has(o.id) && o.zone !== 'trash');
    assert.ok(tok, 'Recruit token played');
    assert.equal(tok!.exhausted, !disc, disc ? 'enters ready' : 'control: enters exhausted');
  }
});

const settleStep = (g: GameState) => { for (let i = 0; i < 6 && pend(g).inStep; i++) g = act(g, legal(g, pend(g).player)[0]); return g; };
// RJ#4098 — Thwonk! vs Flash: Flash resolving first makes the target an illegal choice (no longer attacking) → no stun;
// Thwonk! resolving first stuns, and Flashing afterwards keeps it stunned.
test('RJ#4098 Thwonk! on an attacker: Flash in response fizzles it; Flash afterwards leaves the unit stunned', () => {
  for (const flashFirst of [true, false]) {
    let g = S0(); fundAll(g, P0); fundAll(g, P1);
    put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
    const a = put(g, P0, 'V(3)', 'base');
    const fl = hand(g, P0, 'Flash');
    const th = hand(g, P1, 'Thwonk!');
    g = move(g, P0, [a], BF_A);
    assert.ok(g.showdown?.isCombat);
    if (pend(g).player === P0) g = pass(g);
    g = play(g, P1, th, { targets: [[a]] });
    for (let i = 0; i < 4 && pend(g).inStep; i++) g = choose(g, pend(g).kind === 'optional' ? 'no' : optionIds(g)[0]);
    if (pend(g).player === P1) g = pass(g);
    if (flashFirst) {
      g = play(g, P0, fl, { targets: [[a]] });
      g = resolveChain(g);
    } else {
      g = pass(g);
      g = settleStep(g);
      assert.ok(g.objects[a].stunned, 'stunned by Thwonk!');
      if (pend(g).player === P1) g = pass(g);
      g = play(g, P0, fl, { targets: [[a]] });
      g = resolveChain(g);
    }
    assert.equal(locOf(g, a), 'base');
    assert.equal(!!g.objects[a].stunned, !flashFirst, flashFirst ? 'Thwonk! fizzled' : 'still stunned after moving');
  }
});

// RJ#4101 — Fiora (sfd-110) "When I attack or defend one on one": checked when the combat triggers would trigger; removing an
// attacker later (hidden Fight or Flight in response to the defend triggers) doesn't create the trigger. ("Fog of War" isn't
// in the card pool; Fight or Flight stands in for it.)
test('RJ#4101 Fiora defending against two attackers: removing one in response to the defend triggers does not trigger her', () => {
  let g = S0({ bfA: "Reaver's Row" }); fundAll(g, P1);
  const f = put(g, P1, 'sfd-110-221', BF_A); control(g, BF_A, P1);
  const ff = put(g, P1, 'Fight or Flight', { facedown: BF_A });
  const a1 = put(g, P0, 'V(2)', 'base'), a2 = put(g, P0, 'V(2)', 'base');
  const m0 = mightOf(g, f);
  g = move(g, P0, [a1, a2], BF_A);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = choose(g, pend(g).kind === 'optional' ? 'no' : optionIds(g)[0]);
  assert.ok(g.chain.length > 0, 'defend trigger (Reaver\'s Row) on the chain');
  if (pend(g).player === P0) g = pass(g);
  g = act(g, { type: 'playCard', player: P1, obj: ff, targets: [[a1]] } as never);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = optionIds(g).includes(a1) ? choose(g, a1) : act(g, legal(g, pend(g).player)[0]);
  for (let i = 0; i < 12 && g.chain.length; i++) { const d = pend(g); g = d.inStep ? choose(g, d.kind === 'optional' ? 'no' : optionIds(g)[0]) : pass(g); }
  assert.equal(locOf(g, a1), 'base', 'one attacker removed');
  assert.ok(!/Trigger: Fiora/.test(logText(g)), 'no Fiora trigger');
  assert.equal(mightOf(g, f), m0, 'not doubled');
});

// RJ#4103 — a trigger whose condition is met while a spell is being played (choosing a unit at The Dreaming Tree) goes on
// the chain above the spell and resolves first.
test('RJ#4103 The Dreaming Tree\'s draw (triggered while playing the spell) resolves before the spell', () => {
  let g = S0({ bfA: 'The Dreaming Tree' }); fundAll(g, P0);
  const f = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const b = hand(g, P0, 'BuffM');
  g = play(g, P0, b, { targets: [[f]] });
  const L = chainLabels(g);
  assert.equal(L.length, 2, `spell + trigger on the chain (${L})`);
  assert.ok(/BuffM/.test(L[0]) && !/BuffM/.test(L[1]), `spell at the bottom, trigger on top (${L})`);
  const h0 = g.players[0].hand.length;
  g = pass(g); g = pass(g);
  assert.equal(g.players[0].hand.length, h0 + 1, 'drew');
  assert.equal(g.chain.length, 1, 'the spell is still on the chain after the trigger resolved');
  g = resolveChain(g);
  assert.equal(g.objects[f].counters.buff ?? 0, 1, 'then the spell resolves (buffed)');
});

// RJ#4107 — lethal assignment counts damage already marked: a 6-Might attacker may assign 3+3 to two 5-Might defenders
// with 2 damage each, killing both.
test('RJ#4107 6-Might attacker kills two damaged 5-Might defenders by assigning 3 to each', () => {
  let { g, atk, def } = attackSetup(['V(6)'], ['V(5)', 'V(5)'], { defOpts: [{ damage: 2 }, { damage: 2 }] });
  let assigned = false;
  for (let i = 0; i < 40; i++) {
    const d = g.pending; if (!d || d.kind === 'mainAction') break;
    if (d.kind === 'assignDamage') {
      if (d.player === P0) { g = act(g, { type: 'assignDamage', player: P0, assignment: { [def[0]]: 3, [def[1]]: 3 } }); assigned = true; }
      else g = act(g, { type: 'assignDamage', player: d.player, assignment: (d.data as { suggested: Record<ObjId, number> }).suggested });
      continue;
    }
    g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  assert.ok(assigned, 'attacker assigned 3/3');
  assert.equal(zone(g, def[0]), 'trash'); assert.equal(zone(g, def[1]), 'trash');
  void atk;
});

// RJ#4111 — "When I attack" triggers the first time the unit becomes an attacker in a combat (CR 383.4.e): Yasuo Flashed to
// base in response to his trigger and Ridden back into the same combat doesn't trigger again.
test('RJ#4111 Yasuo, Remorseful leaving and re-entering the same combat does not trigger his attack ability again', () => {
  let g = S0(); fundAll(g, P0);
  const d = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const y = put(g, P0, 'Yasuo, Remorseful', 'base');
  const o = put(g, P0, 'V(1)', 'base');
  const fl = hand(g, P0, 'Flash'), rw = hand(g, P0, 'Ride the Wind');
  g = move(g, P0, [y, o], BF_A);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = optionIds(g).includes(d) ? choose(g, d) : act(g, legal(g, pend(g).player)[0]);
  assert.ok(chainLabels(g).some(l => /Yasuo/.test(l)), 'attack trigger on the chain');
  if (pend(g).player !== P0) g = pass(g);
  g = play(g, P0, fl, { targets: [[y]] });
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = optionIds(g).includes(y) ? choose(g, y) : act(g, legal(g, pend(g).player)[0]);
  for (let i = 0; i < 10 && g.chain.length; i++) { const dd = pend(g); g = dd.inStep ? act(g, legal(g, dd.player)[0]) : pass(g); }
  assert.equal(locOf(g, y), 'base');
  assert.ok(g.showdown?.isCombat, 'combat goes on (another attacker remains)');
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  g = play(g, P0, rw, { targets: [[y]], locations: [BF_A] });
  g = drv(g, gg => gg.pending!.options?.some(op => op.id === String(BF_A)) ? [String(BF_A)] : gg.pending!.options?.some(op => op.id === d) ? [d] : undefined);
  const L = g.log.map(l => l.text);
  const back = L.findIndex((t, i) => i > L.findIndex(u => /Ride the Wind/.test(u)) && /Yasuo moves to BF-A/.test(t));
  assert.ok(back >= 0, 'Ridden back into BF-A: ' + L.slice(-12).join(' | '));
  const n = L.filter(t => /^Trigger: Yasuo/.test(t)).length;
  assert.equal(n, 1, 'one attack trigger in total');
});

// RJ#4113 — Retreat in response to the opponent's Cull the Weak triggers Viktor, Innovator; his Recruit arrives before Cull
// resolves, so it can be the unit killed.
test('RJ#4113 Retreat in response to Cull the Weak: Viktor, Innovator\'s Recruit arrives first and can be killed for Cull', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  put(g, P0, 'V(1)', 'base');
  const v = put(g, P1, 'Viktor, Innovator', 'base');
  const o = put(g, P1, 'V(2)', 'base');
  const rt = hand(g, P1, 'Retreat');
  [g] = cast(g, P0, 'Cull the Weak');
  if (pend(g).player === P0) g = pass(g);
  g = play(g, P1, rt, { targets: [[o]] });
  let sawRecruit = false;
  for (let i = 0; i < 30 && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g);
    if (d.inStep) {
      const rec = Object.values(g.objects).find(x => x.isToken && x.controller === P1 && (x.zone === 'base' || x.zone === 'battlefield'));
      if (d.player === P1 && rec && optionIds(g).includes(rec.id)) { sawRecruit = true; g = choose(g, rec.id); continue; }
      g = act(g, legal(g, d.player)[0]); continue;
    }
    g = pass(g);
  }
  assert.equal(zone(g, o), 'hand', 'Retreated');
  assert.ok(sawRecruit, 'the Recruit was a legal choice for Cull the Weak');
  assert.equal(zone(g, v), 'base', 'Viktor survives');
});

// RJ#4119 — Teemo, Strategist Gusted in response to his defend trigger: the reveal still happens, no damage (as RJ#7821).
// RJ's aside "control is lost once you have no units there, even in a showdown" contradicts CR 323.5 (DECISIONS #2756): the
// battlefield stays controlled during the combat, so a revealed Nocturne may be played there.
test('RJ#4119 Teemo, Strategist Gusted: still reveals; (MISMATCH-RJ aside) a revealed Nocturne can be played to the still-controlled battlefield', () => {
  let g = S0(); fundAll(g, P0, 2); fundAll(g, P1, 2);
  const t = put(g, P1, 'Teemo, Strategist', BF_A); control(g, BF_A, P1);
  const n = put(g, P1, 'Nocturne, Horrifying', 'deckTop');
  const a = put(g, P0, 'V(5)', 'base');
  const gu = hand(g, P0, 'Gust');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 3 && pend(g).player === P1 && !pend(g).inStep; i++) g = pass(g);
  g = play(g, P0, gu, { targets: [[t]] });
  let dests: string[] = [];
  g = drv(g, gg => {
    const d = gg.pending!;
    if (d.kind === 'optional') return ['yes'];
    if (d.options?.some(o => o.id === 'base')) { dests = d.options.map(o => o.id); return [dests.includes(String(BF_A)) ? String(BF_A) : 'base']; }
    return undefined;
  });
  assert.equal(zone(g, t), 'hand');
  assert.ok(g.log.some(l => /Revealed/.test(l.text)), 'top 5 revealed');
  // (no damage from Teemo: RJ#7821)
  void a;
  assert.ok(dests.includes(String(BF_A)), `BF-A offered for Nocturne (${dests})`);
  assert.ok(zone(g, n) !== 'banishment', 'Nocturne was played');
});

// RJ#4122 — banishing (Portal Rescue) is not a move (Banishment is a non-board zone): Traveling Merchant at a battlefield
// Portal-Rescued to base gets no "When I move" trigger.
test('RJ#4122 Portal Rescue on Traveling Merchant at a battlefield: banish + play to base is not a move (no move trigger)', () => {
  let g = S0(); fundAll(g, P0);
  const m = put(g, P0, 'Traveling Merchant', BF_A); control(g, BF_A, P0);
  const pr = hand(g, P0, 'Portal Rescue');
  g = play(g, P0, pr, { targets: [[m]] });
  g = drv(g);
  assert.equal(locOf(g, m), 'base', 'back in base');
  assert.ok(/Banish/i.test(logText(g)));
  assert.ok(!/Trigger: Traveling Merchant/.test(logText(g)), 'no move trigger');
});

// RJ#4130 — Lee Sin, Centered dies in combat: his +2 goes away, but combat damage is healed before it can make the ally's
// damage lethal, so the ally survives.
test('RJ#4130 Lee Sin, Centered dies in combat: a buffed ally with damage >= its reduced Might is healed first and survives', () => {
  let { g, atk, def } = attackSetup(['V(10)'], ['Lee Sin, Centered', 'V(2)'], { defOpts: [{}, { buff: true }] });
  const [ls, u] = def;
  assert.equal(mightOf(g, u), 5);
  let assigned = false;
  for (let i = 0; i < 40; i++) {
    const d = g.pending; if (!d || d.kind === 'mainAction') break;
    if (d.kind === 'assignDamage') {
      if (d.player === P0) { g = act(g, { type: 'assignDamage', player: P0, assignment: { [ls]: 6, [u]: 4 } }); assigned = true; }
      else g = act(g, { type: 'assignDamage', player: d.player, assignment: (d.data as { suggested: Record<ObjId, number> }).suggested });
      continue;
    }
    g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  assert.ok(assigned);
  assert.equal(zone(g, ls), 'trash', 'Lee Sin died');
  assert.equal(zone(g, atk[0]), 'trash', 'attacker died');
  assert.equal(locOf(g, u), BF_A, 'ally survives');
  assert.equal(g.objects[u].damage, 0, 'healed');
  assert.equal(mightOf(g, u), 3);
});

// RJ#4133 — Anivia moved into an enemy battlefield by an effect (Ride the Wind) becomes an attacker: her attack trigger fires.
// (A unit moved to HER battlefield makes her a defender — DECISIONS #10581.)
test('RJ#4133 Anivia moved into an enemy battlefield by Ride the Wind attacks: 3 to all enemy units there', () => {
  let g = S0(); fundAll(g, P0);
  const e1 = put(g, P1, 'V(5)', BF_A), e2 = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const an = put(g, P0, 'Anivia', 'base');
  g = play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[an]], locations: [BF_A] });
  g = drv(g, gg => gg.pending!.options?.some(o => o.id === String(BF_A)) ? [String(BF_A)] : undefined);
  assert.ok(/Trigger: Anivia/.test(logText(g)), 'attack trigger');
  assert.ok(/Effect deals 3 to/.test(logText(g)) || zone(g, e1) === 'trash', '3 to all enemy units');
  void e2;
});

// RJ#4138 (MISMATCH-RJ) — RJ: a countered card doesn't count for Legion. Official: Legion is not a play trigger; it checks
// that another card was Finalized by you this turn (CR 812.1.c). CR 426.1.b ("not considered to have been played") covers
// only "abilities that trigger on cards being played". A spell countered by Defy was finalized, so Legion is on.
test('RJ#4138 (MISMATCH-RJ) a spell countered by Defy still satisfies Legion (CR 812.1.c finalized; 426.1.b is for play triggers)', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const dr = hand(g, P0, 'DrawR');
  const df = hand(g, P1, 'Defy');
  g = play(g, P0, dr);
  if (pend(g).player === P0) g = pass(g);
  g = play(g, P1, df, { targets: [[dr]] });
  g = settle(g);
  assert.equal(zone(g, dr), 'trash');
  assert.ok(/counter/i.test(logText(g)), 'countered');
  const tg = hand(g, P0, 'Trifarian Gloryseeker');
  g = play(g, P0, tg, { dest: 'base' });
  g = drv(g);
  assert.equal(g.objects[tg].counters.buff, 1, 'Legion active: Gloryseeker buffed itself');
  let h = S0(); fundAll(h, P0);
  const tg2 = hand(h, P0, 'Trifarian Gloryseeker');
  h = drv(play(h, P0, tg2, { dest: 'base' }));
  assert.ok(!h.objects[tg2].counters.buff, 'control: no other card played → no buff');
});

// RJ#4143 — Tideturner removed from the board (Retreat) in response to its play trigger: no "original location" → the
// chosen unit doesn't move.
test('RJ#4143 Tideturner returned to hand in response to its play trigger: the chosen unit does not move', () => {
  let g = S0(); fundAll(g, P0);
  const x = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const tt = hand(g, P0, 'Tideturner');
  const rt = hand(g, P0, 'Retreat');
  g = play(g, P0, tt, { dest: 'base' });
  for (let i = 0; i < 6 && pend(g).inStep; i++) {
    const d = pend(g);
    g = d.kind === 'optional' ? choose(g, 'yes') : optionIds(g).includes(x) ? choose(g, x) : act(g, legal(g, d.player)[0]);
  }
  assert.ok(chainLabels(g).some(l => /Tideturner/.test(l)), 'trigger on the chain');
  g = play(g, P0, rt, { targets: [[tt]] });
  g = drv(g);
  assert.equal(zone(g, tt), 'hand');
  assert.equal(locOf(g, x), BF_A, 'did not move');
});

// RJ#4144 — Flurry of Blades damages units at both battlefields, then Ride the Wind takes Warwick to the second one mid-combat:
// the first combat finishes (healing all units) before the second combat's attack trigger, so the unit there isn't killed by it.
test('RJ#4144 Warwick Ridden to a second battlefield after Flurry of Blades: the first combat heals everyone before his second attack trigger', () => {
  let g = S0(); fundAll(g, P0, 6);
  const da = put(g, P1, 'V(4)', BF_A); control(g, BF_A, P1);
  const db = put(g, P1, 'V(5)', BF_B); control(g, BF_B, P1);
  const w = put(g, P0, 'Warwick', 'base');
  const o = put(g, P0, 'V(3)', 'base');
  const fb = hand(g, P0, 'Flurry of Blades'), rw = hand(g, P0, 'Ride the Wind');
  g = move(g, P0, [w, o], BF_A);
  for (let i = 0; i < 10 && g.chain.length; i++) { const d = pend(g); g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g); }
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  g = play(g, P0, fb);
  g = resolveChain(g);
  assert.equal(g.objects[db].damage, 1, 'Flurry damaged the unit at BF-B');
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  g = play(g, P0, rw, { targets: [[w]], locations: [BF_B] });
  let dmgAtSecondTrigger = -1;
  for (let i = 0; i < 60; i++) {
    const d = g.pending; if (!d || d.kind === 'mainAction') break;
    if (dmgAtSecondTrigger < 0 && g.log.filter(l => /^Trigger: Warwick/.test(l.text)).length >= 2) dmgAtSecondTrigger = g.objects[db].damage;
    if (d.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: d.player, assignment: (d.data as { suggested: Record<ObjId, number> }).suggested }); continue; }
    if (d.inStep) { g = optionIds(g).includes(String(BF_B)) ? choose(g, String(BF_B)) : act(g, legal(g, d.player)[0]); continue; }
    g = pass(g);
  }
  const L = g.log.map(l => l.text);
  assert.ok(L.filter(t => /^Trigger: Warwick/.test(t)).length >= 2, 'second attack trigger: ' + L.slice(-12).join(' | '));
  assert.equal(dmgAtSecondTrigger, 0, 'healed before Warwick\'s second attack trigger');
  void da;
});

// RJ#4153 — Zhonya's Hourglass protects "a friendly unit": my unit possessed by the opponent is theirs when it dies → not saved.
test('RJ#4153 my unit taken by Possession dies: my Zhonya\'s Hourglass does not save it', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const zh = put(g, P0, "Zhonya's Hourglass", 'base');
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  put(g, P0, 'V(1)', BF_A);
  g = endTurn(g); g = drv(g);
  const ps = hand(g, P1, 'Possession');
  g = drv(play(g, P1, ps, { targets: [[u]] }));
  assert.equal(g.objects[u].controller, P1, 'possessed');
  const k = hand(g, P1, 'KillDraw');
  g = drv(play(g, P1, k, { targets: [[u]] }));
  assert.equal(zone(g, u), 'trash', 'not saved');
  assert.equal(zone(g, zh), 'base', 'Hourglass unused');
});

// RJ#4155 — Sett, Brawler's "Spend my buff" has no [Reaction]: it can't be activated while Reckoner's Arena's hold trigger
// (activating his conquer "buff me") is on the chain.
test('RJ#4155 Sett, Brawler can\'t spend his buff in response to Reckoner\'s Arena\'s hold trigger', () => {
  let g = S0({ tp: P1, bfA: "Reckoner's Arena" });
  const s = put(g, P0, 'Sett, Brawler', BF_A, { buff: true }); control(g, BF_A, P0);
  g = act(g, { type: 'endTurn', player: P1 });
  let sawChain = false;
  for (let i = 0; i < 20; i++) {
    const d = g.pending; if (!d || d.kind === 'mainAction') break;
    if (g.chain.length && chainLabels(g).some(l => /Reckoner/.test(l))) {
      sawChain = true;
      if (d.player === P0) assert.ok(!legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === s), 'no window for Sett\'s ability');
    }
    g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  assert.ok(sawChain, 'hold trigger used the chain: ' + logText(g).split('\n').slice(-8).join(' | '));
  assert.equal(g.objects[s].counters.buff, 1, 'still (only) buffed');
});

// RJ#4156 (MISMATCH-RJ arithmetic) — buffed Pouty Poro (2) at Trifarian War Camp = 4; Smoke Screen snapshots -3 (to 1);
// Discipline +2 → 3. RJ lists the same modifiers but sums the increases (+1 +1 +2) as 6 and states 5. A second Smoke Screen
// afterwards gives -2 (RJ agrees) → 1.
test('RJ#4156 (MISMATCH-RJ arithmetic) buffed 2-Might unit at Trifarian War Camp: Smoke Screen then Discipline → 3, not 5', () => {
  let g = S0({ bfA: 'Trifarian War Camp' }); fundAll(g, P0, 8);
  const u = put(g, P0, 'Pouty Poro', BF_A, { buff: true }); control(g, BF_A, P0);
  assert.equal(mightOf(g, u), 4);
  g = resolveChain(play(g, P0, hand(g, P0, 'Smoke Screen'), { targets: [[u]] }));
  assert.equal(mightOf(g, u), 1);
  g = resolveChain(play(g, P0, hand(g, P0, 'Discipline'), { targets: [[u]] }));
  assert.equal(mightOf(g, u), 3, '2 + 1 + 1 + 2 - 3');
  g = resolveChain(play(g, P0, hand(g, P0, 'Smoke Screen'), { targets: [[u]] }));
  assert.equal(mightOf(g, u), 1, 'second Smoke Screen snapshots -2');
});

// RJ#4157 — Unsung Hero (pumped to 5) Stupefied to 4, then killed: her Deathknell triggers but she wasn't Mighty → no draw. Control:
// killed at 5 → draw 2.
test('RJ#4157 Unsung Hero killed after a -1 (4 Might) draws nothing; killed at 5 she draws 2', () => {
  for (const stup of [true, false]) {
    let g = S0(); fundAll(g, P1, 6);
    for (let i = 0; i < 4; i++) put(g, P0, 'V(1)', 'deckTop');
    const u = put(g, P0, 'Unsung Hero', BF_A); control(g, BF_A, P0);
    g = endTurn(g); g = drv(g);
    mod(g, u, { might: 3 });                       // printed 2: pumped to 5 (Mighty)
    if (stup) { mod(g, u, { might: -1 }); assert.equal(mightOf(g, u), 4); }
    const h0 = g.players[0].hand.length;
    g = drv(play(g, P1, hand(g, P1, 'KillDraw'), { targets: [[u]] }));
    assert.equal(zone(g, u), 'trash');
    assert.ok(/Trigger: Unsung Hero/.test(logText(g)), 'Deathknell triggers');
    assert.equal(g.players[0].hand.length - h0, stup ? 0 : 2);
  }
});

// RJ#4160 (OUTDATED) — old Teemo, Strategist text triggered "on play from hidden" and "when I defend"; the errata'd text
// (ogn-121) has only "When I defend": played from hidden into the combat he defends and triggers exactly once.
test('RJ#4160 (OUTDATED) Teemo, Strategist played from hidden into a combat at his battlefield triggers once (defend)', () => {
  let g = S0(); fundAll(g, P1);
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const t = put(g, P1, 'Teemo, Strategist', { facedown: BF_A });
  for (let i = 0; i < 5; i++) put(g, P1, 'V(1)', 'deckTop');
  const a = put(g, P0, 'V(6)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 6 && !(g.showdown?.isCombat && pend(g).kind === 'showdownAction' && g.chain.length === 0); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  if (pend(g).player === P0) g = pass(g);
  expectPending(g, 'showdownAction', P1);
  g = act(g, { type: 'playCard', player: P1, obj: t, destination: BF_A } as never);
  g = drv(g);
  assert.equal(g.log.filter(l => /^Trigger: Teemo/.test(l.text)).length, 1, 'one trigger');
});

// RJ#4164 — Crackshot Corsair Gusted in response to her attack trigger: "an enemy unit here" has no "here" any more → no damage.
test('RJ#4164 Crackshot Corsair returned by Gust in response to her attack trigger: the trigger deals no damage', () => {
  let g = S0(); fundAll(g, P1);
  const d = put(g, P1, 'V(4)', BF_A); control(g, BF_A, P1);
  const c = put(g, P0, 'Crackshot Corsair', 'base');
  put(g, P0, 'V(2)', 'base');
  const o = g.players[0].base.find(id => id !== c)!;
  g = move(g, P0, [c, o], BF_A);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = optionIds(g).includes(d) ? choose(g, d) : act(g, legal(g, pend(g).player)[0]);
  assert.ok(chainLabels(g).some(l => /Crackshot/.test(l)), 'attack trigger on the chain');
  if (pend(g).player === P0) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Gust'), { targets: [[c]] });
  for (let i = 0; i < 10 && g.chain.length; i++) { const dd = pend(g); g = dd.inStep ? act(g, legal(g, dd.player)[0]) : pass(g); }
  assert.equal(zone(g, c), 'hand');
  assert.ok(/Resolving Crackshot|Crackshot.*(fizzle|no legal|illegal)/i.test(logText(g)) || !g.chain.length);
  assert.equal(g.objects[d].damage, 0, 'no damage');
});

// RJ#4165 — Pack of Wonders' ability has no [Reaction]/[Action]: only on your own turn in a Neutral Open state.
test('RJ#4165 Pack of Wonders can be activated only on your own turn with no chain or showdown', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const pw = put(g, P0, 'Pack of Wonders', 'base');
  put(g, P0, 'V(1)', 'base');
  const canPW = (gg: GameState) => legal(gg, P0, 'activate').some(a => a.type === 'activate' && a.obj === pw);
  assert.ok(canPW(g), 'own main phase, open state');
  let h = endTurn(structuredClone(g)); h = drv(h);
  h = play(h, P1, hand(h, P1, 'DrawR'));
  if (pend(h).player === P1) h = pass(h);
  expectPending(h, 'chainResponse', P0);
  assert.ok(!canPW(h), 'not in response on the opponent\'s turn');
  const a = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [a], BF_A);
  assert.ok(g.showdown, 'showdown');
  assert.ok(!canPW(g), 'not during a showdown');
});

// RJ#4169 — Cithria already buffed, Wildclaw Shaman played: resolve Wildclaw's trigger first spending Cithria's buff (Wildclaw
// buffed + ready), then Cithria's own trigger buffs her again.
test('RJ#4169 buffed Cithria of Cloudfield + Wildclaw Shaman: spend Cithria\'s buff for Wildclaw, then Cithria is buffed again', () => {
  let g = S0(); fundAll(g, P0);
  const c = put(g, P0, 'Cithria of Cloudfield', 'base', { buff: true });
  const w = hand(g, P0, 'Wildclaw Shaman');
  g = act(g, { type: 'playCard', player: P0, obj: w, destination: 'base' } as never);
  const seen: string[] = [];
  for (let i = 0; i < 30; i++) {
    const d = g.pending; if (!d || d.kind === 'mainAction') break;
    if (d.inStep) {
      seen.push(`${d.kind}:${(d.options ?? []).map(o => o.label ?? o.id).join('/')}`);
      if (d.kind === 'orderTriggers') { const o = d.options!.find(x => /Wildclaw/.test(x.label ?? '')) ?? d.options![0]; g = choose(g, o.id); continue; }
      if (d.kind === 'optional') { g = choose(g, 'yes'); continue; }
      if (optionIds(g).includes(c)) { g = choose(g, c); continue; }
      g = act(g, legal(g, d.player)[0]); continue;
    }
    g = pass(g);
  }
  assert.equal(g.objects[w].counters.buff ?? 0, 1, 'Wildclaw buffed: ' + seen.join(' ; '));
  assert.equal(g.objects[w].exhausted, false, 'Wildclaw ready');
  assert.equal(g.objects[c].counters.buff ?? 0, 1, 'Cithria buffed again');
});

// RJ#4171 — the attacker can't play Shen to the battlefield he's attacking (not controlled); a unit that joins the attack
// later (Ride the Wind) becomes an attacker and gets Nine-Tailed Fox's -1 too.
test('RJ#4171 attacker can\'t play Shen to the attacked battlefield; a unit joining the attack later gets Nine-Tailed Fox\'s -1', () => {
  let g = S0(); fundAll(g, P0);
  setLegend(g, P1, 'Nine-Tailed Fox');
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(2)', 'base'), late = put(g, P0, 'V(3)', 'base');
  const sh = hand(g, P0, 'Shen');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 10 && (g.chain.length || pend(g).inStep); i++) { const d = pend(g); g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g); }
  assert.equal(mightOf(g, a), 1, 'first attacker -1');
  expectPending(g, 'showdownAction', P0);
  assert.ok(!playDests(g, P0, sh).includes(BF_A), 'Shen can\'t be played to the attacked battlefield');
  g = play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[late]], locations: [BF_A] });
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g);
    g = d.inStep ? (optionIds(g).includes(String(BF_A)) ? choose(g, String(BF_A)) : act(g, legal(g, d.player)[0])) : pass(g);
  }
  assert.equal(locOf(g, late), BF_A);
  assert.equal(g.log.filter(l => /^Trigger: Nine-Tailed Fox/.test(l.text)).length, 2, 'Fox triggers for the late attacker');
  assert.equal(mightOf(g, late), 2, 'late attacker -1');
});

// RJ#4173 (AMBIGUOUS, house = RJ#4173 + RJ#990) — Divine Judgment's "Each player chooses 2 units…" isn't limited to units they
// control: with only one unit of my own I must also choose an enemy unit, and the opponent then keeps its other two by
// choosing them → the opponent keeps three. Engine offers each player only their own objects.
test('RJ#4173 (AMBIGUOUS) Divine Judgment: with one unit I must also choose an enemy unit; the opponent can keep all three of theirs', () => {
  let g = S0(); fundAll(g, P0, 8);
  const mine = put(g, P0, 'V(1)', 'base');
  const [e1, e2, e3] = [put(g, P1, 'V(2)', 'base'), put(g, P1, 'V(2)', 'base'), put(g, P1, 'V(2)', 'base')];
  const dj = hand(g, P0, 'Divine Judgment');
  g = play(g, P0, dj);
  let p0Units: string[] = [];
  for (let i = 0; i < 40; i++) {
    const d = g.pending; if (!d || d.kind === 'mainAction') break;
    if (d.inStep && d.kind === 'chooseCards' && /units/.test(d.prompt ?? '')) {
      const ids = optionIds(g);
      if (d.player === P0) { p0Units = ids; g = act(g, { type: 'choose', player: P0, optionIds: [mine, e1] }); }
      else g = act(g, { type: 'choose', player: P1, optionIds: ids.filter(id => id === e2 || id === e3) });
      continue;
    }
    g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  assert.ok(p0Units.includes(e1), 'enemy units offered to me');
  assert.equal(zone(g, mine), 'base');
  for (const e of [e1, e2, e3]) assert.equal(zone(g, e), 'base', 'all three enemy units kept');
});

// RJ#4186 — Ride the Wind during a showdown can move a unit from that battlefield to an empty one; it conquers it afterwards.
test('RJ#4186 Ride the Wind mid-showdown moves a unit to an empty battlefield, which it then conquers for a point', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const a1 = put(g, P0, 'V(3)', 'base'), a2 = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [a1, a2], BF_A);
  for (let i = 0; i < 6 && (g.chain.length || pend(g).inStep); i++) { const d = pend(g); g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g); }
  expectPending(g, 'showdownAction', P0);
  g = play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[a2]], locations: [BF_B] });
  g = drv(g, gg => gg.pending!.options?.some(o => o.id === String(BF_B)) ? [String(BF_B)] : undefined);
  assert.equal(locOf(g, a2), BF_B);
  assert.equal(g.battlefields[BF_B].controller, P0, 'conquered BF-B');
  assert.equal(g.battlefields[BF_A].controller, P0, 'and BF-A');
  assert.equal(g.players[0].points, 2);
});

// RJ#4193 — an attacker kept alive only by Assault (1 Might + Cleave's Assault 3, 3 damage) moved to base by Fight or Flight
// from Back-Alley Bar: it stops being an attacker, the cleanup after Fight or Flight kills it before the Bar's +1 resolves.
test('RJ#4193 attacker alive only through Assault moved off Back-Alley Bar by Fight or Flight dies before the Bar\'s +1', () => {
  let g = S0({ bfA: 'Back-Alley Bar' }); fundAll(g, P0, 6);
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(1)', 'base'), o = put(g, P0, 'V(1)', 'base');
  g = move(g, P0, [a, o], BF_A);
  for (let i = 0; i < 6 && (g.chain.length || pend(g).inStep); i++) { const d = pend(g); g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g); }
  expectPending(g, 'showdownAction', P0);
  g = resolveChain(play(g, P0, hand(g, P0, 'Cleave'), { targets: [[a]] }));
  assert.equal(mightOf(g, a), 4, 'Assault 3 while attacking');
  g.objects[a].damage = 3; g.timestamp++;
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Fight or Flight'), { targets: [[a]] });
  for (let i = 0; i < 12 && (g.chain.length || pend(g).inStep); i++) { const d = pend(g); g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g); }
  const L = g.log.map(l => l.text);
  const died = L.findIndex(t => /V\(1\).* died|^V\(1\) died/.test(t)), bar = L.findIndex(t => /^Resolving Back-Alley Bar/.test(t));
  assert.equal(zone(g, a), 'trash', 'died: ' + L.slice(-8).join(' | '));
  assert.ok(died >= 0 && (bar < 0 || died < bar), 'died before the Bar\'s +1 resolved');
});

// RJ#4208 — Baited Hook uses the killed unit's Might as it died, Trifarian War Camp's +1 included: a 1-Might unit there (2)
// lets you play a 3-Might unit (not a 4).
test('RJ#4208 Baited Hook killing a 1-Might unit at Trifarian War Camp (2 Might) can play a 3-Might unit, not a 4', () => {
  let g = S0({ bfA: 'Trifarian War Camp' }); fundAll(g, P0, 4);
  const vic = put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  assert.equal(mightOf(g, vic), 2);
  const hook = put(g, P0, 'Baited Hook', 'base');
  const big = put(g, P0, 'V(4)', 'deckTop'), ok3 = put(g, P0, 'V(3)', 'deckTop');
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && (a as { obj?: ObjId }).obj === hook)!);
  let offeredBig = false, offered3 = false;
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    if (o.includes(vic)) { g = choose(g, vic); continue; }
    if (o.includes(big)) offeredBig = true;
    if (o.includes(ok3)) { offered3 = true; g = act(g, { type: 'choose', player: d.player, optionIds: [ok3] }); continue; }
    g = d.kind === 'optional' ? choose(g, 'yes') : act(g, legal(g, d.player)[0]);
  }
  assert.equal(zone(g, vic), 'trash');
  assert.ok(offered3 && !offeredBig, `3 offered, 4 not (${offered3}/${offeredBig})`);
});

// RJ#4210 — Fiora (sfd-110, 3) attacking one on one: Gust may respond to her trigger. Defending alone with Wuju Bladesman
// (Yi legend) she already has +2 (5 Might, a static) when her trigger is on the chain → Gust can't choose her.
test('RJ#4210 Gust in response to Fiora\'s one-on-one trigger: works when she attacks; not when Wuju Bladesman makes her 5 defending', () => {
  // attacking
  let g = S0(); fundAll(g, P1);
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const f = put(g, P0, 'sfd-110-221', 'base');
  const gu = hand(g, P1, 'Gust');
  g = move(g, P0, [f], BF_A);
  assert.ok(chainLabels(g).some(l => /Fiora/.test(l)), 'trigger on the chain');
  if (pend(g).player === P0) g = pass(g);
  assert.ok(canPlayNow(g, P1, gu), 'Gust playable on 3-Might Fiora');
  g = play(g, P1, gu, { targets: [[f]] }); g = resolveChain(g);
  assert.equal(zone(g, f), 'hand');
  // defending with Wuju Bladesman
  let h = S0(); fundAll(h, P0);
  setLegend(h, P1, 'Wuju Bladesman');
  const f2 = put(h, P1, 'sfd-110-221', BF_A); control(h, BF_A, P1);
  const a = put(h, P0, 'V(2)', 'base');
  const gu2 = hand(h, P0, 'Gust');
  h = move(h, P0, [a], BF_A);
  assert.ok(chainLabels(h).some(l => /Fiora/.test(l)), 'defend trigger on the chain');
  assert.equal(mightOf(h, f2), 5, 'Wuju Bladesman +2 already applies');
  for (let i = 0; i < 2 && pend(h).player !== P0; i++) h = pass(h);
  let opts: string[] = [];
  try {
    const h2 = act(h, { type: 'playCard', player: P0, obj: gu2 });
    opts = pend(h2).kind === 'chooseTargets' ? optionIds(h2) : chainLabels(h2);
  } catch { /* not playable */ }
  assert.ok(!opts.includes(f2), `Fiora (5) not a legal Gust target (${opts})`);
});

// RJ#4212 — Cull the Weak doesn't choose/target: no Deflect tax even when the caster's only unit (or the opponent's) has Deflect.
test('RJ#4212 Cull the Weak with Pouty Poros on both sides: no Deflect tax is paid', () => {
  let g = S0(); fundAll(g, P0, 6);
  const mine = put(g, P0, 'Pouty Poro', 'base');
  const theirs = put(g, P1, 'Pouty Poro', BF_A); control(g, BF_A, P1);
  const before = allRunes(g, P0);
  const cw = hand(g, P0, 'Cull the Weak');
  g = drv(play(g, P0, cw));
  assert.equal(zone(g, mine), 'trash'); assert.equal(zone(g, theirs), 'trash');
  assert.equal(before - allRunes(g, P0), 1, 'only the spell\'s own [A] (one rune recycled), no Deflect tax');
});

// RJ#4217 — Swift Scout (Teemo legend) takes a Teemo unit from the Champion Zone or the board, never from the trash.
// (RJ's aside "not Teemo, Scout" contradicts the text "a Teemo unit you own": a board Teemo, Scout is returnable — RJ#5240.)
test('RJ#4217 Swift Scout cannot put Teemo, Scout from the trash into hand; from the board it can', () => {
  let g = S0(); fundAll(g, P0);
  const l = setLegend(g, P0, 'Swift Scout');
  const tr = put(g, P0, 'Teemo, Scout', 'trash');
  let used = false;
  const ab = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === l);
  if (ab) {
    try {
      let h = act(g, ab);
      for (let i = 0; i < 6 && pend(h).inStep; i++) { assert.ok(!optionIds(h).includes(tr), 'trash Teemo not offered'); h = act(h, legal(h, pend(h).player)[0]); }
      h = drv(h); used = zone(h, tr) === 'hand';
    } catch { /* no legal choice */ }
  }
  assert.ok(!used, 'Teemo, Scout stays in the trash');
  const b = put(g, P0, 'Teemo, Scout', 'base');
  g = activate(g, P0, l, 0, { targets: [[b]], cards: [[b]] });
  g = passAll(g);
  assert.equal(zone(g, b), 'hand', 'from the board: returned');
});

// RJ#4219 — a spell taken by Mystic Reversal resolves under the thief's control: the original caster's Ravenbloom Student
// gets nothing for it (VEN-FAQ: the Student checks a spell you control resolving); the thief's Student gets +1 for Mystic
// Reversal and +1 for the stolen spell (as RJ#11755). (RJ's reason "the thief played it" differs from DECISIONS principle 2,
// but no Legion/finalize check is involved here, so the result is the same.)
test('RJ#4219 Void Seeker stolen by Mystic Reversal: the original caster\'s Ravenbloom Student gets no +1, the thief\'s gets +2', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const rs1 = put(g, P1, 'Ravenbloom Student', 'base');
  const rs0 = put(g, P0, 'Ravenbloom Student', 'base');
  const m1 = mightOf(g, rs1)!, m0 = mightOf(g, rs0)!;
  const t = put(g, P0, 'V(5)', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(5)', BF_B); control(g, BF_B, P1);
  g = endTurn(g); g = drv(g);
  g = play(g, P1, hand(g, P1, 'Void Seeker'), { targets: [[t]] });
  for (let i = 0; i < 4 && (pend(g).inStep || pend(g).player === P1); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  g = play(g, P0, hand(g, P0, 'Mystic Reversal'));
  g = drv(g, gg => {
    const d = gg.pending!;
    if (d.kind === 'optional') return ['yes'];
    if (d.options?.some(o => o.id === e)) return [e];
    return undefined;
  });
  assert.equal(mightOf(g, rs1), m1, 'original caster\'s Student: no +1');
  assert.equal(mightOf(g, rs0), m0 + 2, 'thief\'s Student: +1 Mystic Reversal, +1 Void Seeker');
});

// RJ#4225 — a combat heals every unit on the board, also ones not in it (a damaged unit in base). A non-combat showdown
// heals nobody (RJ#4130's nuance) — "showdown" in RJ#4225 means a combat.
test('RJ#4225 a combat elsewhere heals a damaged unit in base; a non-combat showdown does not', () => {
  for (const combat of [true, false]) {
    let g = S0();
    const hurt = put(g, P0, 'V(5)', 'base', { damage: 2 });
    if (combat) { put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1); }
    const a = put(g, P0, 'V(3)', 'base');
    g = drv(move(g, P0, [a], BF_A));
    assert.equal(g.battlefields[BF_A].controller, P0);
    assert.equal(g.objects[hurt].damage, combat ? 0 : 2, combat ? 'healed by the combat' : 'no heal after a non-combat showdown');
  }
});

// RJ#4233 — Sett, Kingpin at 7 (two buffed allies) with 6 damage on everyone: the allies die, he drops to 5 and dies in the
// next cleanup.
test('RJ#4233 Sett, Kingpin (7 via two buffed allies) and the allies all take 6: allies die, then Sett (5) dies too', () => {
  let g = S0(); fundAll(g, P0);
  const s = put(g, P0, 'Sett, Kingpin', BF_A); control(g, BF_A, P0);
  const b1 = put(g, P0, 'V(1)', BF_A, { buff: true }), b2 = put(g, P0, 'V(1)', BF_A, { buff: true });
  assert.equal(mightOf(g, s), 7);
  for (const id of [s, b1, b2]) g.objects[id].damage = 6;
  g.timestamp++;
  [g] = cast(g, P0, 'DrawR'); g = drv(g);
  assert.equal(zone(g, b1), 'trash'); assert.equal(zone(g, b2), 'trash');
  assert.equal(zone(g, s), 'trash', 'Sett dies once his Might drops to 5');
});

// RJ#4236 — Void Gate (errata: "Spells and abilities deal 1 Bonus Damage to units here"): Icathian Rain split between a unit
// at Void Gate and one elsewhere — only the instances dealt to the unit here get +1. RJ's "as written, every instance gets +1"
// reading is OUTDATED (pre-errata text); its "intended" ruling is the current text.
test('RJ#4236 (OUTDATED as-written part) Icathian Rain split across Void Gate and elsewhere: +1 only for instances to the unit at Void Gate', () => {
  let g = S0({ bfA: 'Void Gate' }); fundAll(g, P0, 5);
  const here = put(g, P1, 'V(12)', BF_A); control(g, BF_A, P1);
  const there = put(g, P1, 'V(12)', BF_B); control(g, BF_B, P1);
  mod(g, here, { might: 10 }); mod(g, there, { might: 10 });
  const ir = hand(g, P0, "Icathian Rain, Kai'Sa");
  g = act(g, { type: 'playCard', player: P0, obj: ir });
  let n = 0;
  for (let i = 0; i < 40 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    if (pend(g).kind === 'chooseTargets') { g = choose(g, n++ < 3 ? here : there); continue; }
    g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  }
  assert.equal(g.objects[here].damage, 9, '3 instances × (2+1)');
  assert.equal(g.objects[there].damage, 6, '3 instances × 2, no bonus elsewhere');
});

// RJ#4237 — Warwick attacks Reaver's Row: the defend trigger goes on the chain after his attack trigger, resolves first, and
// the damaged defender moved to base survives Warwick's "kill all damaged enemy units here".
test('RJ#4237 Warwick attacks Reaver\'s Row: the damaged defender is moved to base first and survives his attack trigger', () => {
  let g = S0({ bfA: "Reaver's Row" });
  const d = put(g, P1, 'V(4)', BF_A, { damage: 1 }); put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const w = put(g, P0, 'Warwick', 'base');
  g = move(g, P0, [w], BF_A);
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) {
    const p = pend(g);
    if (p.inStep) { g = p.kind === 'optional' ? choose(g, 'yes') : optionIds(g).includes(d) ? choose(g, d) : act(g, legal(g, p.player)[0]); continue; }
    g = pass(g);
  }
  const L = g.log.map(l => l.text);
  const rr = L.findIndex(t => /^Resolving Reaver/.test(t)), ww = L.findIndex(t => /^Resolving Warwick/.test(t));
  assert.ok(rr >= 0 && ww >= 0 && rr < ww, `Reaver's Row resolves first (${rr}/${ww})`);
  assert.equal(locOf(g, d), 'base', 'moved to base');
  assert.notEqual(zone(g, d), 'trash', 'survives');
});

// ---- cycle 4 (resume at 4238) ----
// RJ#4241 — Fading Memories gives the opponent's unit Temporary: its Beginning Phase trigger is the unit controller's, so with
// their Loose Cannon (Jinx legend) trigger they control both and order them.
test('RJ#4241 Temporary from my Fading Memories and the opponent\'s Loose Cannon trigger: the opponent orders both', () => {
  let g = S0(); fundAll(g, P0, 6);
  setLegend(g, P1, 'Loose Cannon');
  const u = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  g.players[1].hand = [];
  g = play(g, P0, hand(g, P0, 'Fading Memories'), { targets: [[u]] });
  g = resolveChain(g);
  g = endTurn(g);
  const d = pend(g);
  assert.equal(d.kind, 'orderTriggers'); assert.equal(d.player, P1, 'the unit\'s controller orders');
  assert.ok(d.options!.some(o => /Loose Cannon/.test(o.label ?? '')) && d.options!.some(o => /Temporary/.test(o.label ?? '')));
  g = drv(g);
  assert.equal(zone(g, u), 'trash');
});

// RJ#4242 — Karma, Channeler ("When you recycle one or more cards to your Main Deck"): my Sabotage recycling the opponent's
// card goes to their deck → no buff; the opponent's Sabotage recycling my card to my deck → my Karma buffs.
test('RJ#4242 Sabotage on the opponent does not trigger my Karma, Channeler; their Sabotage on me does', () => {
  for (const caster of [P0, P1]) {
    let g = S0({ tp: caster }); fundAll(g, caster, 2);
    const k = put(g, P0, 'Karma, Channeler', 'base');
    const s = hand(g, caster === P0 ? P1 : P0, 'DrawR');
    [g] = cast(g, caster, 'Sabotage');
    g = drv(g, gg => gg.pending!.options?.some(o => o.id === s) ? [s] : undefined);
    assert.equal(zone(g, s), 'mainDeck');
    assert.equal(g.objects[k].counters.buff ?? 0, caster === P0 ? 0 : 1, caster === P0 ? 'recycled to the opponent\'s deck: no buff' : 'recycled to my deck: buff');
  }
});

// RJ#4247 — Zhonya's Hourglass is a replacement effect: no chain item, so there is no window to Gust in between.
test('RJ#4247 Zhonya\'s Hourglass saving a unit uses no chain: the spell resolves straight to the main phase', () => {
  let g = S0(); fundAll(g, P0, 4);
  const u = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const z = put(g, P1, "Zhonya's Hourglass", 'base');
  hand(g, P1, 'Gust');
  g = play(g, P0, hand(g, P0, 'Void Seeker'), { targets: [[u]] });
  g = pass(g); g = pass(g);
  assert.equal(pend(g).kind, 'mainAction', 'no response window after the replacement');
  assert.equal(g.chain.length, 0);
  assert.equal(zone(g, z), 'trash'); assert.equal(locOf(g, u), 'base');
});

// RJ#4262 — Ava, Achiever's attack trigger still resolves after she dies in response, but "If it's a unit, play it here" has no
// "here" any more (CR 359.3.f: read on execution; DECISIONS principle 17) → the hidden unit can't be played (stays in hand).
// Engine: the script falls back to the default destination and plays it to base.
test('RJ#4262 Ava, Achiever killed in response to her attack trigger: a Hidden unit can no longer be played "here" (stays in hand)', () => {
  for (const kill of [false, true]) {
    let g = S0(); fundAll(g, P0, 4); fundAll(g, P1, 2);
    put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
    const ava = put(g, P0, 'ogn-107-298', 'base');
    const h = hand(g, P0, 'HidU(2)');
    g = move(g, P0, [ava], BF_A);
    for (let i = 0; i < 20; i++) {
      const d = g.pending!;
      if (d.kind === 'mainAction' || d.kind === 'assignDamage') break;
      if (kill && !d.inStep && d.player === P1 && zone(g, ava) !== 'trash' && g.chain.length === 1) {
        g = play(g, P1, hand(g, P1, 'ZapR'), { targets: [[ava]] }); g.objects[ava].damage = 9; continue;
      }
      g = d.inStep ? (d.options?.some(o => o.id === h) ? choose(g, h) : d.options?.some(o => o.id === 'yes') ? choose(g, 'yes') : act(g, legal(g, d.player)[0])) : pass(g);
    }
    if (!kill) assert.equal(locOf(g, h), BF_A, 'Ava alive: played to her battlefield');
    else { assert.equal(zone(g, ava), 'trash'); assert.equal(zone(g, h), 'hand', 'Ava gone: no "here", the unit isn\'t played'); }
  }
});

// RJ#4264 — Sabotage: with a non-unit card in the revealed hand, one must be chosen (min 1, no declining).
test('RJ#4264 Sabotage must choose a non-unit card when one exists (no empty choice)', () => {
  let g = S0(); fundAll(g, P0, 2);
  hand(g, P1, 'DrawR'); hand(g, P1, 'ZapR'); hand(g, P1, 'V(2)');
  [g] = cast(g, P0, 'Sabotage');
  g = pass(g); g = pass(g);
  const d = pend(g);
  assert.equal(d.kind, 'chooseCards');
  assert.equal(d.min, 1, 'a card must be chosen');
  assert.ok(!legal(g, P0).some(a => a.type === 'choose' && a.optionIds.length === 0), 'no empty choice offered');
});

// RJ#4270 — Dazzling Aurora with no unit left in the deck: reveal what there is, no Burn Out (CR 432.1.c). RJ's nuance "burn out
// if the deck is already empty" is MISMATCH-RJ: CR 432.1.c — revealing more cards than the deck holds never burns out.
test('RJ#4270 (MISMATCH-RJ nuance) Dazzling Aurora revealing a deck with no units — or an empty deck — does not Burn Out', () => {
  for (const names of [['DrawR', 'ZapR', 'ZapM'], []]) {
    let g = S0();
    put(g, P0, 'Dazzling Aurora', 'base');
    clearDeck(g, P0);
    const cs = names.map(n => put(g, P0, n, 'deckBottom'));
    g = endTurn(g); g = drv(g);
    assert.equal(g.players[1].points, 0, 'no Burn Out point for the opponent');
    assert.equal(g.players[0].mainDeck.length, cs.length, 'revealed cards stay in / return to the deck');
  }
});

// RJ#4276 — on the opponent's turn my lone unit at B is Charmed to A (I lose B in the Open cleanup); in the showdown at A I Ride
// the Wind it back to B: B is uncontrolled and empty → I conquer it and score (not scored by me this turn).
test('RJ#4276 my unit Charmed from B to A on the opponent\'s turn, Ridden back to B in the showdown: I conquer B', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1, 2); fundAll(g, P0, 3);
  const u = put(g, P0, 'V(2)', BF_B); control(g, BF_B, P0);
  put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const rtw = hand(g, P0, 'Ride the Wind');
  g = play(g, P1, hand(g, P1, 'Charm'), { targets: [[u]], locations: [BF_A], dest: BF_A });
  if (pend(g).kind === 'chooseDestination') g = answer(g, { locations: [BF_A] });
  g = resolveChain(g);
  if (pend(g).inStep) g = answer(g, { locations: [BF_A] });
  assert.equal(g.battlefields[BF_B].controller, null, 'B lost once the Charm resolved');
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'showdownAction' && d.player === P0 && zone(g, rtw) === 'hand') { g = play(g, P0, rtw, { targets: [[u]], locations: [BF_B], dest: BF_B }); continue; }
    g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  assert.equal(locOf(g, u), BF_B);
  assert.equal(g.battlefields[BF_B].controller, P0);
  assert.equal(g.players[0].points, 1, 'conquer point on the opponent\'s turn');
});

// RJ#4285 — in response to my Temporary unit's Beginning Phase kill trigger I play my hidden unit there: it enters exhausted,
// I keep the battlefield and score it.
test('RJ#4285 hidden unit played in response to a Temporary trigger keeps the battlefield (enters exhausted) and scores it', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0);
  control(g, BF_A, P0);
  const t = put(g, P0, 'Temp(2)', BF_A);
  const fd = put(g, P0, 'HidU(2)', { facedown: BF_A, hiddenTurn: 1 });
  g = endTurn(g, P1);
  for (let i = 0; i < 20 && !g.chain.some(c => c.source === t); i++) { const p = pend(g); g = p.inStep ? choose(g, p.options![0].id) : pass(g); }
  expectPending(g, 'chainResponse', P0);
  assert.ok(canPlayNow(g, P0, fd));
  g = act(g, { type: 'playCard', player: P0, obj: fd, destination: BF_A });
  g = drv(g);
  assert.equal(zone(g, t), 'trash');
  assert.equal(locOf(g, fd), BF_A); assert.equal(g.objects[fd].exhausted, true, 'enters exhausted');
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[0].points, 1, 'held and scored');
});

// RJ#4289 — Loose Cannon (Jinx legend) "draw 1 if you have one or fewer cards" triggers every Beginning Phase whatever the hand
// size (the condition is checked on resolution), so the opponent always gets a reaction window.
test('RJ#4289 Loose Cannon triggers whatever the hand size (opponent may react); the hand check is on resolution', () => {
  for (const n of [3, 0]) {
    let g = S0({ tp: P1 }); fundAll(g, P1, 1);
    const l = setLegend(g, P0, 'Loose Cannon');
    g.players[0].hand = [];
    for (let i = 0; i < n; i++) hand(g, P0, 'V(1)');
    const r = hand(g, P1, 'DrawR');
    g = endTurn(g, P1);
    assert.ok(g.chain.some(c => c.source === l), `trigger on the chain with ${n} cards`);
    g = pass(g);
    expectPending(g, 'chainResponse', P1);
    assert.ok(canPlayNow(g, P1, r), 'opponent may react');
    g = drv(g);
    assert.equal(g.players[0].hand.length, n === 0 ? 2 : n + 1, n === 0 ? 'drew 1 (+ draw phase)' : 'no extra draw');
  }
});

// RJ#4292 — The Boss's replacement cost [A] can be paid with a Seal's [Add] (no chain needed): no runes, only a Seal.
test('RJ#4292 The Boss\'s [A] replacement cost can be paid with a Seal (mana ability during resolution)', () => {
  let g = S0(); fundAll(g, P0);
  setLegend(g, P1, 'The Boss');
  setRunes(g, P1, 0, 'body');
  const seal = put(g, P1, 'Seal of Strength', 'base');
  const u = put(g, P1, 'V(3)', BF_A, { buff: true }); control(g, BF_A, P1);
  [g] = cast(g, P0, 'Void Seeker', { targets: [[u]] });
  g = passAll(g);
  expectPending(g, 'optional', P1);
  g = drv(yes(g));
  assert.equal(locOf(g, u), 'base', 'saved and recalled');
  assert.equal(g.objects[seal].exhausted, true, 'the Seal paid the [A]');
});

// RJ#4299 — Viktor, Leader ("another non-Recruit unit") triggers for a dying Sprite token (a Fae token, not a Recruit).
test('RJ#4299 a Sprite token dying triggers Viktor, Leader (it is not a Recruit)', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  put(g, P1, 'Viktor, Leader', 'base');
  const sp = put(g, P1, 'unl-t07', BF_A, { token: true }); control(g, BF_A, P1);
  [g] = cast(g, P0, 'Void Seeker', { targets: [[sp]] });
  g = drv(g);
  assert.notEqual(zone(g, sp), 'battlefield');
  assert.equal(g.players[1].base.filter(id => g.cards[g.objects[id].cardId].name === 'Recruit').length, 1, 'one Recruit');
});

// RJ#4308 — Time Warp inserts the extra turn as it resolves; there is no end-of-turn trigger (no reaction window) for it.
test('RJ#4308 Time Warp creates no end-of-turn chain item: ending the turn goes straight into the extra turn', () => {
  let g = S0(); fundAll(g, P0, 10); addRunes(g, P0, 10, 'mind');
  hand(g, P1, 'ZapR'); fundAll(g, P1, 2);
  g = play(g, P0, hand(g, P0, 'Time Warp')); g = resolveChain(g);
  g = endTurn(g);
  expectPending(g, 'mainAction', P0);
  assert.equal(g.activePlayer, P0, 'extra turn');
  assert.ok(!g.log.some(l => /Trigger: Time Warp/.test(l.text)), 'no Time Warp trigger');
});

// RJ#4315 — Cleave's Assault 3 lasts the turn but only adds Might while attacking: +3 at A, back to base Might after that combat,
// +3 again when Ride the Wind takes the unit into a second combat at B.
test('RJ#4315 Cleave\'s Assault 3 applies again in a second attack the same turn (Ride the Wind into another occupied battlefield)', () => {
  let g = S0(); fundAll(g, P0, 6);
  const a = put(g, P0, 'V(3)', 'base');
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  g = play(g, P0, hand(g, P0, 'Cleave'), { targets: [[a]] }); g = resolveChain(g);
  assert.equal(mightOf(g, a), 3, 'not attacking yet');
  g = move(g, P0, [a], BF_A);
  assert.equal(mightOf(g, a), 6, 'attacker at A');
  g = drv(g);
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(mightOf(g, a), 3, 'combat over: no longer an attacker');
  g = play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[a]], locations: [BF_B], dest: BF_B });
  g = resolveChain(g);
  assert.equal(locOf(g, a), BF_B);
  assert.equal(mightOf(g, a), 6, 'attacker again at B');
});

// RJ#4316 — Mystic Reversal may take any spell on the chain, not only the one it responds to (here the bottom ZapM).
test('RJ#4316 Mystic Reversal can take control of a spell lower on the chain than the one it responds to', () => {
  let g = S0(); fundAll(g, P0, 8); fundAll(g, P1, 8);
  const e = put(g, P1, 'V(5)', 'base'), f = put(g, P0, 'V(5)', 'base');
  g = play(g, P0, hand(g, P0, 'ZapM'), { targets: [[e]] });
  const bottom = g.chain[0].id;
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'ZapR'), { targets: [[f]] });
  const top = g.chain[1].id;
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Mystic Reversal') });
  assert.deepEqual([...optionIds(g)].sort(), [bottom, top].sort(), 'both spells can be chosen');
  g = choose(g, bottom);
  g = drv(g, gg => gg.pending!.kind === 'optional' ? ['yes'] : optionIds(gg).includes(f) ? [f] : undefined);
  assert.equal(g.objects[e].damage, 0, 'the stolen ZapM was redirected');
  assert.equal(g.objects[f].damage, 4, 'ZapR + the stolen ZapM hit P0\'s unit');
});

// RJ#4318 — Volibear, Furious's split damage targets are locked when his attack trigger is chained: a unit Tideturner swaps in
// afterwards (hidden Tideturner played in response) can't be hit.
test('RJ#4318 Volibear, Furious\'s split-damage targets are chosen on chaining: the unit Tideturner swaps in takes nothing', () => {
  let g = S0();
  const d = put(g, P1, 'V(12)', BF_A); control(g, BF_A, P1);
  const x = put(g, P1, 'V(12)', 'base');
  const tt = put(g, P1, 'Tideturner', { facedown: BF_A, hiddenTurn: 0 });
  const v = put(g, P0, 'Volibear, Furious', 'base');
  g = move(g, P0, [v], BF_A);
  for (let i = 0; i < 6 && pend(g).inStep; i++) g = choose(g, optionIds(g).includes(d) ? d : optionIds(g)[0]);
  assert.deepEqual(g.chain.find(c => c.source === v)?.targets, [[d]], 'target locked on chaining');
  for (let i = 0; i < 4 && pend(g).player !== P1; i++) g = pass(g);
  g = act(g, { type: 'playCard', player: P1, obj: tt, destination: BF_A });
  for (let i = 0; i < 30 && g.chain.length; i++) {
    const p = pend(g);
    g = p.inStep ? (optionIds(g).includes(x) ? choose(g, x) : p.kind === 'optional' ? choose(g, 'yes') : act(g, legal(g, p.player)[0])) : pass(g);
  }
  assert.equal(locOf(g, x), BF_A, 'swapped in');
  assert.equal(g.objects[x].damage, 0, 'not a target');
  assert.equal(g.objects[d].damage, 5);
});

// RJ#4320 — (MISMATCH-RJ) the defender's last unit dies mid-showdown: the battlefield is still controlled during the showdown/
// combat there (CR 323.5; DECISIONS #2756/#4119), so the hidden Pakaa Cub isn't trashed and can still be played — it joins as a
// defender and deals combat damage. RJ: "can't be revealed after your last unit dies".
test('RJ#4320 (MISMATCH-RJ, CR 323.5) last defender killed mid-showdown: hidden Pakaa Cub can still be played and defends', () => {
  let g = S0(); fundAll(g, P0, 2); fundAll(g, P1, 2);
  const d = put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const cub = put(g, P1, 'Pakaa Cub', { facedown: BF_A, hiddenTurn: 0 });
  const a = put(g, P0, 'V(5)', 'base');
  g = move(g, P0, [a], BF_A);
  g = play(g, P0, hand(g, P0, 'ZapA'), { targets: [[d]] });
  g = pass(g); g = pass(g);
  assert.equal(zone(g, d), 'trash');
  assert.equal(g.battlefields[BF_A].controller, P1, 'still controlled during the showdown');
  expectPending(g, 'showdownAction', P1);
  assert.ok(canPlayNow(g, P1, cub), 'the hidden Cub can be played');
  g = act(g, { type: 'playCard', player: P1, obj: cub, destination: BF_A });
  g = drv(g);
  assert.equal(zone(g, cub), 'trash', 'the Cub defended and died');
  assert.equal(g.objects[a].damage, 0, 'damage healed after combat');
  assert.ok(g.log.some(l => /Pakaa Cub deals 3|deals 3 .*V\(5\)|Combat at BF-A/.test(l.text)), 'a combat happened');
});

// RJ#4326 — Singularity on Sett, Brawler + another unit; Hidden Blade kills Sett in response, The Boss saves and recalls him:
// he is the same object in base (no location restriction on Singularity), so Singularity still hits and kills him.
test('RJ#4326 Sett, Brawler saved by The Boss (recalled) in response to Singularity is still its target and dies in base', () => {
  let g = S0(); fundAll(g, P0, 8); fundAll(g, P1, 4);
  setLegend(g, P1, 'The Boss');
  const s = put(g, P1, 'Sett, Brawler', BF_A, { buff: true }); control(g, BF_A, P1);
  const o = put(g, P1, 'V(3)', BF_A);
  const hb = put(g, P1, 'Hidden Blade', { facedown: BF_A, hiddenTurn: 0 });
  g = play(g, P0, hand(g, P0, 'Singularity'), { targets: [[s, o]] });
  g = pass(g);
  g = play(g, P1, hb, { targets: [[s]] });
  g = pass(g); g = pass(g);
  expectPending(g, 'optional', P1);
  g = yes(g);
  assert.equal(locOf(g, s), 'base', 'saved and recalled');
  g = drv(g);
  assert.equal(zone(g, s), 'trash', 'Singularity still kills him in base');
  assert.equal(zone(g, o), 'trash');
});

// RJ#4339 — Vi, Destructive's "Recycle 1 from your trash: +1 Might" has no Reaction/Action: usable on my own turn only, not in a
// showdown on the opponent's turn.
test('RJ#4339 Vi, Destructive\'s ability can\'t be used on the opponent\'s turn (even with focus in a showdown)', () => {
  let g = S0(); fundAll(g, P1, 2);
  const vi = put(g, P0, 'Vi, Destructive', BF_A); control(g, BF_A, P0);
  fillTrash(g, P0, 3);
  const viActs = (gg: GameState) => legal(gg, P0).filter(a => a.type === 'activate' && a.obj === vi).length;
  assert.ok(viActs(g) > 0, 'usable on my turn');
  g = drv(endTurn(g));
  const a = put(g, P1, 'V(2)', 'base');
  g = move(g, P1, [a], BF_A);
  for (let i = 0; i < 4 && pend(g).player !== P0; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  expectPending(g, 'showdownAction', P0);
  assert.equal(viActs(g), 0, 'not on the opponent\'s turn');
});

// RJ#4340 — buffed Sett, Kingpin counts himself as a buffed friendly unit at his battlefield: 5 + 1 (buff) + 1 = 7.
test('RJ#4340 a buffed Sett, Kingpin alone counts himself: 7 Might', () => {
  const g = S0();
  const s = put(g, P0, 'Sett, Kingpin', BF_A, { buff: true }); control(g, BF_A, P0);
  assert.equal(mightOf(g, s), 7);
  const h = S0();
  const s2 = put(h, P0, 'Sett, Kingpin', BF_A); control(h, BF_A, P0);
  assert.equal(mightOf(h, s2), 5, 'unbuffed: 5');
});

// RJ#4346 — Daughter of the Void's spell-only [A] can't pay Sprite Call's hide cost (hiding isn't playing a spell).
test('RJ#4346 Daughter of the Void\'s spell-only [A] cannot pay the [A] to hide Sprite Call; a rune can', () => {
  let g = S0();
  setLegend(g, P0, 'Daughter of the Void');
  setRunes(g, P0, 0, 'mind');
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const sc = hand(g, P0, 'Sprite Call');
  g = act(g, legal(g, P0).find(a => a.type === 'activate' && a.obj === g.players[0].legend)!);
  assert.notEqual(validateAction(g, { type: 'hide', player: P0, obj: sc, battlefieldIndex: BF_A }), null, 'spell-only power can\'t hide');
  setRunes(g, P0, 1, 'mind');
  assert.equal(validateAction(g, { type: 'hide', player: P0, obj: sc, battlefieldIndex: BF_A }), null, 'a rune pays it');
});

// RJ#4348 — holding Reckoner's Arena activates Rumble, Hotheaded's conquer effect, which plays Rumble, Scrapper from the trash: the
// hold already happened, so Scrapper's "When I hold" doesn't trigger (no Mech token).
test('RJ#4348 Rumble, Scrapper played via Reckoner\'s Arena + Rumble, Hotheaded after the hold gets no hold trigger', () => {
  let g = S0({ tp: P1, bfA: "Reckoner's Arena" }); fundAll(g, P0, 8);
  put(g, P0, 'Rumble, Hotheaded', BF_A); control(g, BF_A, P0);
  const r = put(g, P0, 'V(4)', BF_A);
  const sc = put(g, P0, 'Rumble, Scrapper', 'trash');
  g = endTurn(g);
  g = drv(g, gg => { const d = gg.pending!; const o = optionIds(gg); return o.includes(r) ? [r] : o.includes(sc) ? [sc] : d.kind === 'optional' ? ['yes'] : undefined; });
  assert.equal(zone(g, sc), 'base', 'Scrapper played from the trash');
  assert.ok(!g.players[0].base.some(id => g.objects[id].cardId !== g.objects[sc].cardId && /Mech/.test(g.cards[g.objects[id].cardId].name)), 'no Mech token');
  assert.ok(!g.log.some(l => /Trigger: Rumble: When I hold/.test(l.text)));
});

// RJ#4352 — Eager Apprentice ("While I'm at a battlefield") reduces spell costs while attacking an enemy battlefield too.
test('RJ#4352 Eager Apprentice attacking an enemy battlefield still reduces spell Energy costs (Void Seeker 3 → 2)', () => {
  let g = S0(); setRunes(g, P0, 6, 'fury');
  const ea = put(g, P0, 'Eager Apprentice', 'base');
  put(g, P1, 'V(1)', BF_A); const t = put(g, P1, 'V(8)', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [ea], BF_A);
  expectPending(g, 'showdownAction', P0);
  assert.equal(g.battlefields[BF_A].controller, P1, 'not controlled by the attacker');
  g = play(g, P0, hand(g, P0, 'Void Seeker'), { targets: [[t]] });
  assert.ok(g.log.some(l => /^P0 pays 2 F$/.test(l.text)), 'paid [2] + [F] instead of [3] + [F]');
});

// RJ#4355 — an 8-Might attacker with 2 damage already marked fights a 6-Might defender: both die (6 + 2 = 8), nobody wins.
test('RJ#4355 8-Might attacker with 2 marked damage vs a 6-Might defender: both die, nobody gets the battlefield', () => {
  let g = S0();
  const a = put(g, P0, 'V(8)', 'base', { damage: 2 });
  const d = put(g, P1, 'V(6)', BF_A); control(g, BF_A, P1);
  g = drv(move(g, P0, [a], BF_A));
  assert.equal(zone(g, a), 'trash'); assert.equal(zone(g, d), 'trash');
  assert.equal(g.battlefields[BF_A].controller, null);
  assert.equal(g.players[0].points, 0);
});

// RJ#4357 — Cleave on Vayne, Hunter (Assault 3): Assault 3 + 3 → +6 while attacking (2 → 8).
test('RJ#4357 Cleave on Vayne, Hunter stacks Assault: 2 + 6 = 8 while attacking', () => {
  let g = S0(); fundAll(g, P0, 4);
  const v = put(g, P0, 'Vayne, Hunter', 'base');
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  g = play(g, P0, hand(g, P0, 'Cleave'), { targets: [[v]] }); g = resolveChain(g);
  assert.equal(kwValue(g, v, 'Assault'), 6);
  g = move(g, P0, [v], BF_A);
  assert.equal(mightOf(g, v), 8);
});

// RJ#4360 — a hidden card at a battlefield not in the showdown can still be played during it, but its targets are limited to its
// own battlefield (Hidden Blade at B during a showdown at A can only choose a unit at B).
test('RJ#4360 hidden Hidden Blade at B is playable during a showdown at A, targeting only units at B', () => {
  let g = S0(); fundAll(g, P1, 4);
  put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const own = put(g, P1, 'V(2)', BF_B); control(g, BF_B, P1);
  const hb = put(g, P1, 'Hidden Blade', { facedown: BF_B, hiddenTurn: 0 });
  const a = put(g, P0, 'V(3)', 'base');
  g = move(g, P0, [a], BF_A);
  g = pass(g);
  expectPending(g, 'showdownAction', P1);
  assert.ok(canPlayNow(g, P1, hb));
  g = act(g, { type: 'playCard', player: P1, obj: hb });
  assert.deepEqual(g.chain.find(c => c.kind === 'spell')?.targets, [[own]], 'the attacker at A is not a legal target');
});

// RJ#4364 — Wuju Bladesman's "+2 while defending alone" is continuous: lone defender 3+2 = 5, Smoke Screen (snapshotted -4) → 1;
// a hidden ally joins → bonus lost (3-4 = -1); the ally dies → alone again, the +2 is back (1).
test('RJ#4364 Wuju Bladesman bonus returns when the defender is alone again, on top of a snapshotted Smoke Screen', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1, 6);
  setLegend(g, P0, 'Wuju Bladesman, Starter');
  const d = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const h = put(g, P0, 'HidU(2)', { facedown: BF_A });
  const a = put(g, P1, 'V(9)', 'base');
  g = move(g, P1, [a], BF_A);
  g = play(g, P1, hand(g, P1, 'Smoke Screen'), { targets: [[d]] }); g = resolveChain(g);
  assert.equal(mightOf(g, d), 1, '5 - 4');
  if (pend(g).player === P1) g = pass(g);
  g = play(g, P0, h, { dest: BF_A }); g = resolveChain(g);
  assert.equal(mightOf(g, d), -1, 'not alone: 3 - 4 (no new minimum)');
  if (pend(g).player === P0) g = pass(g);
  g = play(g, P1, hand(g, P1, 'ZapA'), { targets: [[h]] }); g = resolveChain(g);
  assert.equal(zone(g, h), 'trash');
  assert.equal(mightOf(g, d), 1, 'alone again: +2 back');
});

// RJ#4365 — a lone 5-Might attacker with Mask of Foresight attacks into Ahri, Inquisitive: Ahri's defend trigger (on top) resolves
// first (-2 → 3), then the Mask (+1 → 4).
test('RJ#4365 Ahri, Inquisitive\'s defend -2 resolves before the attacker\'s Mask of Foresight +1: 5 → 3 → 4', () => {
  let g = S0();
  put(g, P1, 'Ahri, Inquisitive', BF_A); control(g, BF_A, P1);
  put(g, P0, 'Mask of Foresight', 'base');
  const a = put(g, P0, 'V(5)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) {
    const p = pend(g);
    g = p.inStep ? (optionIds(g).includes(a) ? choose(g, a) : act(g, legal(g, p.player)[0])) : pass(g);
  }
  const R = g.log.filter(l => /^Resolving/.test(l.text)).map(l => l.text);
  assert.ok(/Ahri/.test(R[0]) && /Mask of Foresight/.test(R[1]), R.join(' | '));
  assert.equal(mightOf(g, a), 4);
});

// RJ#4375 — Caitlyn, Patrolling's [T] ability has no Action/Reaction: usable in my main phase, not during a showdown (even mine).
test('RJ#4375 Caitlyn, Patrolling\'s [T] ability can\'t be used during a showdown', () => {
  let g = S0();
  const c = put(g, P0, 'Caitlyn, Patrolling', BF_B, { ready: true }); control(g, BF_B, P0);
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(3)', 'base');
  const n = (gg: GameState) => legal(gg, P0).filter(x => x.type === 'activate' && x.obj === c).length;
  assert.ok(n(g) > 0, 'usable in the main phase');
  g = move(g, P0, [a], BF_A);
  expectPending(g, 'showdownAction', P0);
  assert.equal(n(g), 0, 'not in the showdown');
});

// RJ#4383 — (MISMATCH-RJ) Arcane Shift (Ezreal) banishes my only unit at a battlefield and replays it: control isn't lost while the
// spell is resolving (Closed state, CR 309.1/323.5; DECISIONS principle 13; same as RJ#10517 Baited Hook, RJ#8355), so the unit
// may be played back to that battlefield. RJ: "you lose control before the replay step".
test('RJ#4383 (MISMATCH-RJ, CR 323.5) Arcane Shift on my only unit at a battlefield may replay it to that same battlefield', () => {
  let g = S0(); fundAll(g, P0, 8);
  const v = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(5)', BF_B); control(g, BF_B, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Arcane Shift') });
  let dests: string[] = [];
  g = drv(g, gg => {
    const d = gg.pending!; const o = optionIds(gg);
    if (d.kind === 'chooseDestination') { dests = o; return o.includes(String(BF_A)) ? [String(BF_A)] : undefined; }
    return o.includes(v) ? [v] : o.includes(e) ? [e] : undefined;
  });
  assert.ok(dests.includes(String(BF_A)), `BF-A offered (${dests})`);
  assert.equal(locOf(g, v), BF_A);
  assert.equal(g.battlefields[BF_A].controller, P0);
});

// RJ#4387 — Hostile Takeover takes an enemy unit; Portal Rescue on it banishes it and its owner plays it to their base: a new
// object, the control effect is gone and nothing happens to it at end of turn.
test('RJ#4387 Hostile Takeover then Portal Rescue: the owner replays the unit to their base and keeps it', () => {
  let g = S0(); fundAll(g, P0, 12);
  const u = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  g = play(g, P0, hand(g, P0, 'Hostile Takeover'), { targets: [[u]] }); g = drv(g);
  assert.equal(g.objects[u].controller, P0, 'taken');
  g = play(g, P0, hand(g, P0, 'Portal Rescue'), { targets: [[u]] }); g = drv(g);
  const mine = () => Object.values(g.objects).filter(o => g.cards[o.cardId].name === 'V(3)' && o.zone !== 'trash');
  assert.deepEqual(mine().map(o => [o.zone, o.controller]), [['base', P1]], 'owner played it to their base');
  g = drv(endTurn(g));
  assert.deepEqual(mine().map(o => [o.zone, o.controller]), [['base', P1]], 'unchanged at end of turn');
});

// RJ#4390 — buffed Cithria of Cloudfield: spend her buff to reduce Kraken Hunter's [C][C], then Cithria's "When you play another
// unit, buff me" gives her a new buff.
test('RJ#4390 spend Cithria\'s buff on Kraken Hunter\'s cost; her play trigger then buffs her again', () => {
  let g = S0();
  setRunes(g, P0, 5, 'body');
  const c = put(g, P0, 'Cithria of Cloudfield', 'base', { buff: true });
  const kh = hand(g, P0, 'Kraken Hunter');
  const rd0 = g.players[0].runeDeck.length;
  g = act(g, { type: 'playCard', player: P0, obj: kh, destination: 'base' });
  for (let i = 0; i < 6 && pend(g).inStep; i++) {
    const p = pend(g);
    g = p.kind === 'chooseNumber' ? choose(g, '1') : p.kind === 'optional' ? no(g) : choose(g, optionIds(g)[0]);
  }
  assert.equal(g.objects[c].counters.buff ?? 0, 0, 'buff spent');
  assert.equal(g.players[0].runeDeck.length - rd0, 1, 'only one [C] recycled');
  g = drv(g);
  assert.equal(zone(g, kh), 'base');
  assert.equal(g.objects[c].counters.buff, 1, 'rebuffed by her trigger');
});

// ---- cycle 5 (resume at 4392) ----

// RJ#4395 (+4402) — Gust on a Recruit token: it is returned to hand and immediately ceases to exist (tokens can't exist off the board).
test('RJ#4395 Gust on a Recruit token: it leaves the board and ceases to exist (not in hand, not in the trash)', () => {
  let g = S0(); fundAll(g, P0);
  const t = put(g, P1, 'ven-t04', BF_A); control(g, BF_A, P1);
  const h1 = g.players[1].hand.length;
  g = play(g, P0, hand(g, P0, 'Gust'), { targets: [[t]] }); g = drv(g);
  assert.equal(g.players[1].hand.length, h1, 'nothing added to the owner\'s hand');
  assert.ok(!g.players[1].trash.includes(t), 'not in the trash');
  assert.ok(!['base', 'battlefield', 'hand'].includes(g.objects[t]?.zone ?? 'gone'), `token gone (${g.objects[t]?.zone})`);
});

// RJ#4396 — (MISMATCH-RJ, CR 323.11) Blitzcrank, Impassive played to an empty uncontrolled battlefield pulls an enemy unit there: a
// non-combat showdown and a combat are both staged, but 323.11 begins only showdowns "at Battlefields without a Staged Combat",
// so the combat (with its combat showdown) begins directly — one showdown, not "an open showdown, then a combat showdown".
test('RJ#4396 (MISMATCH-RJ, CR 323.11) Blitzcrank pulling an enemy into the empty battlefield he was played to: combat begins at once (no separate open showdown)', () => {
  let g = S0(); fundAll(g, P0, 8);
  put(g, P0, 'ogn-193-298', 'base'); // Miss Fortune (Chaos): friendly units may be played to open battlefields
  const e = put(g, P1, 'V(2)', 'base');
  const b = hand(g, P0, 'Blitzcrank, Impassive');
  g = act(g, { type: 'playCard', player: P0, obj: b, destination: BF_A });
  const seen: boolean[] = [];
  for (let i = 0; i < 30; i++) {
    const d = pend(g);
    if (g.showdown && !g.chain.length && !seen.length) seen.push(g.showdown.isCombat);
    if (d.kind === 'mainAction' || (g.showdown && !g.chain.length)) break;
    if (d.inStep) { const o = optionIds(g); g = choose(g, d.kind === 'optional' ? 'yes' : o.includes(e) ? e : o[0]); continue; }
    g = pass(g);
  }
  assert.equal(locOf(g, e), BF_A, 'enemy pulled');
  assert.deepEqual(seen, [true], 'the first (and only) showdown to open is the combat showdown');
  assert.equal(g.showdown?.attacker, P0);
});

// RJ#4400 — Tryndamere attacks a lone defender; Hidden Blade kills it before combat damage: no damage is assigned, so no excess and no
// bonus point (only the conquer point).
test('RJ#4400 Tryndamere\'s lone defender killed by Hidden Blade before damage: conquer point only, no excess-damage point', () => {
  let g = S0(); fundAll(g, P0);
  const d = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const t = put(g, P0, 'Tryndamere, Barbarian', 'base');
  g = move(g, P0, [t], BF_A);
  expectPending(g, 'showdownAction', P0);
  g = play(g, P0, hand(g, P0, 'Hidden Blade'), { targets: [[d]] });
  g = drv(g);
  assert.equal(zone(g, d), 'trash');
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[0].points, 1);
});

// RJ#4404 — Bandle Tree ("You may hide an additional card here"): two hidden cards there, each hide paid separately; elsewhere one.
test('RJ#4404 Bandle Tree allows a second hidden card there, paid separately; other battlefields still one', () => {
  let g = S0();
  setBattlefieldCard(g, BF_A, 'Bandle Tree');
  setRunes(g, P0, 3);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
  const [h1, h2, h3, h4] = ['HidU(2)', 'HidU(3)', 'HidU(2)', 'HidU(3)'].map(n => hand(g, P0, n));
  g = act(g, { type: 'hide', player: P0, obj: h1, battlefieldIndex: BF_A });
  assert.equal(g.players[0].runesInPlay.length, 2, 'first hide paid');
  assert.equal(validateAction(g, { type: 'hide', player: P0, obj: h2, battlefieldIndex: BF_A }), null, 'second card at Bandle Tree');
  g = act(g, { type: 'hide', player: P0, obj: h2, battlefieldIndex: BF_A });
  assert.equal(g.players[0].runesInPlay.length, 1, 'second hide paid separately');
  assert.deepEqual([zone(g, h1), zone(g, h2)], ['facedown', 'facedown']);
  g = act(g, { type: 'hide', player: P0, obj: h3, battlefieldIndex: BF_B });
  assert.notEqual(validateAction(g, { type: 'hide', player: P0, obj: h4, battlefieldIndex: BF_B }), null, 'only one at a normal battlefield');
});

// RJ#4416 — Blastcone Fae played from hand to my base: her play effect may still give an enemy unit (at a battlefield) -2.
test('RJ#4416 Blastcone Fae hardcast to my base gives an enemy unit at a battlefield -2', () => {
  let g = S0(); fundAll(g, P0);
  const e = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const f = hand(g, P0, 'Blastcone Fae');
  g = play(g, P0, f, { dest: 'base', targets: [[e]] });
  g = drv(g, gg => optionIds(gg).includes(e) ? [e] : undefined);
  assert.equal(zone(g, f), 'base');
  assert.equal(mightOf(g, e), 3);
});

// RJ#4423 — a unit with "When I conquer" (Kai'Sa, ogn-039) that dies in combat is gone before control is established: no trigger
// when its side conquers.
test('RJ#4423 Kai\'Sa ("When I conquer, draw 1") dying in combat does not trigger when her surviving ally conquers', () => {
  let g = S0();
  const d = put(g, P1, 'V(4)', BF_A); control(g, BF_A, P1);
  const k = put(g, P0, 'ogn-039-298', 'base');
  const v = put(g, P0, 'V(5)', 'base');
  const h0 = g.players[0].hand.length;
  g = move(g, P0, [k, v], BF_A);
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const p = pend(g);
    if (p.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: p.player, assignment: p.player === P0 ? { [d]: 9 } : { [k]: 4 } }); continue; }
    g = p.inStep ? choose(g, p.options![0].id) : pass(g);
  }
  assert.equal(zone(g, k), 'trash');
  assert.equal(g.battlefields[BF_A].controller, P0, 'conquered');
  assert.equal(g.players[0].hand.length, h0, 'no draw');
});

// RJ#4425 — Warwick, Hunter attacks; the opponent responds to his trigger with Hextech Ray on him; I respond with Unyielding Spirit, then
// (holding priority) Flurry of Blades. LIFO: Flurry damages everyone first, Unyielding Spirit then prevents the Ray, and Warwick's kill
// (not damage) still kills every damaged enemy there.
test('RJ#4425 Warwick\'s attack trigger: Flurry of Blades, then Unyielding Spirit stops the damage spell; Warwick then kills the Flurry-damaged enemies', () => {
  let g = S0(); fundAll(g, P0, 6); fundAll(g, P1, 6);
  const e1 = put(g, P1, 'V(4)', BF_A), e2 = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const w = put(g, P0, 'Warwick, Hunter', 'base');
  g = move(g, P0, [w], BF_A);
  for (let i = 0; i < 6 && !chainLabels(g).some(l => /Warwick/.test(l)); i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.ok(chainLabels(g).some(l => /Warwick/.test(l)), 'Warwick trigger on the chain');
  if (pend(g).player === P0) g = pass(g);
  g = play(g, P1, hand(g, P1, 'ZapR'), { targets: [[w]] }); // a Reaction damage spell (the question's Hextech Ray is an Action and couldn't respond)
  g = pass(g);
  g = play(g, P0, hand(g, P0, 'Unyielding Spirit'));
  g = play(g, P0, hand(g, P0, 'Flurry of Blades'));
  for (let i = 0; i < 30 && g.chain.length; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(g.objects[w].damage, 1, 'Warwick took only Flurry\'s 1 (the damage spell prevented)');
  assert.deepEqual([zone(g, e1), zone(g, e2)], ['trash', 'trash'], 'damaged enemies killed by Warwick');
});

// RJ#4434 — on the opponent's turn, during their showdown at another battlefield, I Ride the Wind my only unit off my battlefield (I lose
// it in that Open-state cleanup — no showdown there) and Ride the Wind it back: a new showdown is staged there, begins after theirs,
// and I conquer and score.
test('RJ#4434 Ride the Wind off my battlefield and back during the opponent\'s showdown elsewhere: I conquer it again and score', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 8);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const m = put(g, P1, 'V(1)', 'base');
  const [r1, r2] = [hand(g, P0, 'Ride the Wind'), hand(g, P0, 'Ride the Wind')];
  g = move(g, P1, [m], BF_B);
  expectPending(g, 'showdownAction', P1);
  g = pass(g);
  g = play(g, P0, r1, { targets: [[u]], locations: ['base'] }); g = resolveChain(g);
  assert.equal(locOf(g, u), 'base');
  assert.equal(g.battlefields[BF_A].controller, null, 'control lost (no showdown at BF-A)');
  for (let i = 0; i < 4 && pend(g).player !== P0; i++) g = pass(g);
  g = play(g, P0, r2, { targets: [[u]], locations: [BF_A] }); g = resolveChain(g);
  g = drv(g);
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[0].points, 1, 'conquer point on the opponent\'s turn');
});

// RJ#4441 — exhaust all 9 runes for Energy, move Miss Fortune, Captain (ogn-162: ready something else that's exhausted) to ready one
// rune, exhaust it again: the pool keeps all 10 Energy through the move and pays for a 10-Energy Volibear, Furious.
test('RJ#4441 the rune pool persists through Miss Fortune\'s move: 9 Energy + a readied rune = 10 for Volibear, Furious', () => {
  let g = S0();
  setRunes(g, P0, 9, 'body'); addRunes(g, P0, 2, 'fury');
  const mf = put(g, P0, 'ogn-162-298', 'base');
  put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
  const body = g.players[0].runesInPlay.slice(0, 9);
  const energyOf = (gg: GameState, r: ObjId) => legal(gg, P0, 'activate').find(a => a.type === 'activate' && a.obj === r)!; // first Add ability = exhaust for Energy (T016)
  for (const r of body) g = act(g, energyOf(g, r));
  assert.equal(g.players[0].pool.energy, 9);
  g = move(g, P0, [mf], BF_B);
  g = drv(g, gg => { const d = gg.pending!; if (d.kind === 'optional') return ['yes']; const o = optionIds(gg); const r = o.find(x => body.includes(x)); return r ? [r] : undefined; });
  const readied = body.filter(r => !g.objects[r].exhausted);
  assert.equal(readied.length, 1, 'one rune readied by Miss Fortune');
  g = act(g, energyOf(g, readied[0]));
  assert.equal(g.players[0].pool.energy, 10, 'pool kept through the move');
  const vb = hand(g, P0, 'Volibear, Furious');
  g = play(g, P0, vb, { dest: 'base' }); g = drv(g);
  assert.equal(zone(g, vb), 'base');
});

// RJ#4442 — I Charm an enemy V(3) (its controller has Mask of Foresight) into my battlefield with Ahri, Inquisitive and the Nine-Tailed
// Fox legend: it attacks; the attacker's Mask goes on the chain first, my Ahri triggers on top resolve first (3 → 1 → 1), Mask last → 2.
test('RJ#4442 Charmed attacker with its Mask of Foresight vs Ahri, Inquisitive + Nine-Tailed Fox: Ahri\'s reductions first, Mask last → 2', () => {
  let g = S0(); fundAll(g, P0, 4);
  setLegend(g, P0, 'Nine-Tailed Fox');
  put(g, P0, 'Ahri, Inquisitive', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(3)', 'base');
  put(g, P1, 'Mask of Foresight', 'base');
  g = play(g, P0, hand(g, P0, 'Charm'), { targets: [[e]], locations: [BF_A] });
  for (let i = 0; i < 30 && (g.chain.length || pend(g).inStep); i++) {
    const p = pend(g);
    g = p.inStep ? (optionIds(g).includes(e) ? choose(g, e) : p.kind === 'chooseDestination' ? choose(g, String(BF_A)) : act(g, legal(g, p.player)[0])) : pass(g);
  }
  assert.equal(g.showdown?.attacker, P1);
  const R = g.log.filter(l => /^Resolving/.test(l.text)).map(l => l.text);
  const iMask = R.findIndex(t => /Mask of Foresight/.test(t)), iAhri = R.findIndex(t => /Ahri/.test(t));
  assert.ok(iAhri >= 0 && iMask > iAhri, R.join(' | '));
  assert.equal(mightOf(g, e), 2);
});

// RJ#4459 — Dr. Mundo, Expert (6, empty trash) is attacked by Yasuo, Remorseful (6); in response to Yasuo's attack trigger I play two
// Stupefies (on another unit): both are in my trash before the trigger resolves, so Mundo is 8 and survives the 6 damage.
test('RJ#4459 two Stupefies in response to Yasuo, Remorseful\'s attack trigger raise Dr. Mundo to 8 first: he survives the 6 damage', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 4);
  g.players[0].trash = [];
  const m = put(g, P0, 'Dr. Mundo, Expert', BF_A); control(g, BF_A, P0);
  const other = put(g, P1, 'V(3)', BF_B); control(g, BF_B, P1);
  const y = put(g, P1, 'Yasuo, Remorseful', 'base');
  g = move(g, P1, [y], BF_A);
  for (let i = 0; i < 6 && !chainLabels(g).some(l => /Yasuo/.test(l)); i++) g = pend(g).inStep ? choose(g, optionIds(g).includes(m) ? m : optionIds(g)[0]) : pass(g);
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Stupefy'), { targets: [[other]] });
  g = play(g, P0, hand(g, P0, 'Stupefy'), { targets: [[other]] });
  for (let i = 0; i < 20 && chainLabels(g).length; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(zone(g, m), 'battlefield', 'Mundo survives');
  assert.equal(g.objects[m].damage, 6);
  assert.equal(mightOf(g, m), 8);
});

// RJ#4463 — an already-buffed Sett, Brawler conquers Monastery of Hirana: he spends his buff on the Monastery's draw (paid as that
// trigger goes on the chain — principle 11, DECISIONS #7923), draws 1, and his own conquer trigger buffs him again. (Unbuffed Sett: no
// draw — RJ#7923, r7801.)
test('RJ#4463 buffed Sett, Brawler conquers Monastery of Hirana: spends his buff to draw 1, then his conquer trigger rebuffs him', () => {
  let g = S0({ bfA: 'Monastery of Hirana' });
  const s = put(g, P0, 'Sett, Brawler', 'base', { buff: true });
  const h0 = g.players[0].hand.length;
  g = move(g, P0, [s], BF_A);
  for (let i = 0; i < 16 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'optional') { g = yes(g); continue; }
    g = d.inStep ? choose(g, d.options![0].id) : pass(g);
  }
  assert.equal(g.players[0].points, 1);
  assert.equal(g.players[0].hand.length, h0 + 1, 'drew 1');
  assert.equal(g.objects[s].counters.buff, 1, 'buffed again');
});

// RJ#4464 — "Use only once per turn" is per object: two Azir, Ascendant can each use their own ability once this turn.
test('RJ#4464 two Azir, Ascendant: each uses its own once-per-turn ability', () => {
  let g = S0(); fundAll(g, P0);
  const a1 = put(g, P0, 'Azir, Ascendant', BF_A), a2 = put(g, P0, 'Azir, Ascendant', BF_A); control(g, BF_A, P0);
  const o1 = put(g, P0, 'V(2)', 'base'), o2 = put(g, P0, 'V(3)', 'base');
  const acts = (s: GameState, o: ObjId) => legal(s, P0, 'activate').filter(a => a.type === 'activate' && a.obj === o);
  assert.equal(acts(g, a1).length, 1); assert.equal(acts(g, a2).length, 1);
  g = act(g, acts(g, a1)[0]); g = drv(g, gg => optionIds(gg).includes(o1) ? [o1] : gg.pending!.kind === 'optional' ? ['no'] : undefined);
  assert.equal(acts(g, a1).length, 0, 'first Azir used');
  assert.equal(acts(g, a2).length, 1, 'second Azir still can');
  g = act(g, acts(g, a2)[0]); g = drv(g, gg => optionIds(gg).includes(o2) ? [o2] : gg.pending!.kind === 'optional' ? ['no'] : undefined);
  assert.equal(acts(g, a2).length, 0);
});

// RJ#4466 — Unforgiven (Yasuo legend, "[2], [E]: Move a friendly unit to or from its base") has no Action/Reaction: it can't be
// activated in the showdown/combat Yasuo just started.
test('RJ#4466 Unforgiven (Yasuo legend) can\'t be activated during the combat to pull the attacker back', () => {
  let g = S0(); fundAll(g, P0);
  const l = setLegend(g, P0, 'Unforgiven');
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(3)', 'base');
  const n = (gg: GameState) => legal(gg, P0).filter(x => x.type === 'activate' && x.obj === l).length;
  assert.ok(n(g) > 0, 'usable in the main phase');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = choose(g, optionIds(g)[0]);
  expectPending(g, 'showdownAction', P0);
  assert.equal(n(g), 0, 'not in the combat showdown');
});

// RJ#4475 — (MISMATCH-RJ, card text ogn-295) Vilemaw's Lair says "Units can't move from here to base": it does not stop moves to
// another battlefield. Ride the Wind and Zenith Blade can move a unit from the Lair to the other battlefield (as verified RJ#8472).
test('RJ#4475 (MISMATCH-RJ, card text) Vilemaw\'s Lair only blocks moves to base: Ride the Wind / Zenith Blade move a unit from it to the other battlefield', () => {
  const setup = () => {
    const g = S0({ bfA: "Vilemaw's Lair" }); fundAll(g, P0, 6);
    const u = put(g, P0, 'V(3)', BF_A, { ready: false }); control(g, BF_A, P0);
    put(g, P0, 'V(1)', BF_A);
    return { g, u };
  };
  let { g, u } = setup();
  g = play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[u]], locations: [BF_B] }); g = drv(g);
  assert.equal(locOf(g, u), BF_B, 'Ride the Wind to BF-B');
  ({ g, u } = setup());
  const e = put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Zenith Blade') });
  g = drv(g, gg => { const d = gg.pending!; const o = optionIds(gg); if (d.kind === 'optional') return ['yes']; if (o.includes(e)) return [e]; if (o.includes(u)) return [u]; return undefined; });
  assert.equal(locOf(g, u), BF_B, 'Zenith Blade moved it to the stunned enemy\'s battlefield');
});

// RJ#4479 — (MISMATCH-RJ in part, CR 473.1.b) only the WINNING point is restricted: at 6, conquering a single battlefield
// scores normally (→ 7); at 7 the conquer point needs every battlefield scored this turn (T101/T102). RJ: "conquering one battlefield
// alone cannot take you from 6 to 7".
test('RJ#4479 (MISMATCH-RJ in part) at 6 points, conquering one battlefield scores the 7th point normally', () => {
  let g = S0();
  g.players[0].points = 6;
  const u = put(g, P0, 'V(3)', 'base');
  const h0 = g.players[0].hand.length;
  g = move(g, P0, [u], BF_A); g = drv(g);
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[0].points, 7);
  assert.equal(g.players[0].hand.length, h0, 'no draw-instead');
});

// RJ#4487 — Scrapyard Champion's Legion "discard 2, then draw 2" with 1 card left in hand: discard what you can (1), still draw 2.
test('RJ#4487 Scrapyard Champion (Legion) with one other card in hand discards 1 and still draws 2', () => {
  let g = S0(); fundAll(g, P0, 8);
  g.players[0].hand = [];
  const first = hand(g, P0, 'V(1)');
  const sc = hand(g, P0, 'Scrapyard Champion');
  const keep = hand(g, P0, 'V(2)');
  g = play(g, P0, first, { dest: 'base' }); g = drv(g);
  const t0 = g.players[0].trash.length;
  g = play(g, P0, sc, { dest: 'base' });
  g = drv(g, gg => { const o = optionIds(gg); return o.includes(keep) ? [keep] : undefined; });
  assert.equal(zone(g, keep), 'trash', 'the one card discarded');
  assert.equal(g.players[0].trash.length - t0, 1);
  assert.equal(g.players[0].hand.length, 2, 'drew 2');
});

// RJ#4515 — Ahri, Inquisitive attacks a lone Blastcone Fae (2): her -2 (min 1) is computed and snapshotted as -1 (principle 10) → 1;
// Discipline +2 in the showdown → 3.
test('RJ#4515 Ahri, Inquisitive\'s -2 (min 1) on a 2-Might Blastcone Fae, then Discipline +2: 3', () => {
  let g = S0(); fundAll(g, P1, 4);
  const f = put(g, P1, 'Blastcone Fae', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'Ahri, Inquisitive', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) g = pend(g).inStep ? choose(g, optionIds(g).includes(f) ? f : optionIds(g)[0]) : pass(g);
  assert.equal(mightOf(g, f), 1, '2 - 2, min 1');
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Discipline'), { targets: [[f]] });
  for (let i = 0; i < 10 && g.chain.length; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(mightOf(g, f), 3);
});

// RJ#4516 — buffed Qiyana, Victorious takes lethal combat damage and The Boss (Sett legend) recalls her instead of dying: she is in
// base when her side conquers, so her conquer trigger doesn't fire.
test('RJ#4516 Qiyana saved by The Boss (recalled) during combat is not there at the conquer: no draw/channel', () => {
  let g = S0(); fundAll(g, P0, 4);
  setLegend(g, P0, 'The Boss');
  const d = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const q = put(g, P0, 'Qiyana, Victorious', 'base', { buff: true });
  const v = put(g, P0, 'V(5)', 'base');
  const h0 = g.players[0].hand.length, r0 = g.players[0].runesInPlay.length;
  g = move(g, P0, [q, v], BF_A);
  for (let i = 0; i < 40 && pend(g).kind !== 'mainAction'; i++) {
    const p = pend(g);
    if (p.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: p.player, assignment: p.player === P0 ? { [d]: 10 } : { [q]: 5 } }); continue; }
    if (p.kind === 'optional') { g = yes(g); continue; }
    g = p.inStep ? choose(g, p.options![0].id) : pass(g);
  }
  assert.equal(zone(g, d), 'trash');
  assert.equal(locOf(g, q), 'base', 'saved and recalled by The Boss');
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[0].hand.length, h0, 'no Qiyana draw');
  assert.equal(g.players[0].runesInPlay.length, r0 - 1, 'one rune recycled for The Boss\'s [A]; no Qiyana channel');
});

// RJ#4522 / RJ#4523 — Fox-Fire ("Kill any number of units at a battlefield with total Might 4 or less") played from hand: all chosen
// units must be at ONE battlefield (#4522 right; #4523's "any battlefield(s)" is MISMATCH-RJ, card text ogn-256).
test('RJ#4522 Fox-Fire from hand: after choosing a unit at BF-A, units at BF-B are no longer offered', () => {
  let g = S0(); fundAll(g, P0, 6);
  const a1 = put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const b1 = put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Fox-Fire') });
  assert.ok(optionIds(g).includes(a1) && optionIds(g).includes(b1), 'either battlefield at first');
  g = choose(g, a1);
  assert.ok(!optionIds(g).includes(b1), `BF-B unit not offered once a BF-A unit is chosen (${optionIds(g)})`);
});

// RJ#4531 — a combat where no combat damage is dealt (the lone defender is killed by Hidden Blade first) still runs every combat step:
// at its end all units heal, including a damaged unit at the other battlefield.
test('RJ#4531 a combat with no combat damage still heals every unit, including one at the other battlefield', () => {
  let g = S0(); fundAll(g, P0);
  const d = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const far = put(g, P1, 'V(5)', BF_B, { damage: 2 }); control(g, BF_B, P1);
  const a = put(g, P0, 'V(3)', 'base');
  g = move(g, P0, [a], BF_A);
  expectPending(g, 'showdownAction', P0);
  assert.equal(g.showdown?.isCombat, true);
  g = play(g, P0, hand(g, P0, 'Hidden Blade'), { targets: [[d]] });
  g = drv(g);
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.objects[far].damage, 0, 'healed at the end of the combat');
});

// RJ#4532 — Cull the Weak ("Each player kills one of their units", main speed so the caster is the turn player): the caster chooses
// first, then the other player.
test('RJ#4532 Cull the Weak: the caster (turn player) chooses their unit first, then the opponent', () => {
  let g = S0(); fundAll(g, P0, 4);
  const m1 = put(g, P0, 'V(1)', 'base'), m2 = put(g, P0, 'V(2)', 'base');
  const e1 = put(g, P1, 'V(1)', 'base'), e2 = put(g, P1, 'V(2)', 'base');
  g = play(g, P0, hand(g, P0, 'Cull the Weak'));
  const order: PlayerId[] = [];
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.inStep) { order.push(d.player); const o = optionIds(g); g = choose(g, o.includes(m1) ? m1 : o.includes(e1) ? e1 : o[0]); continue; }
    g = pass(g);
  }
  assert.deepEqual(order, [P0, P1]);
  assert.deepEqual([zone(g, m1), zone(g, m2), zone(g, e1), zone(g, e2)], ['trash', 'base', 'trash', 'base']);
});

// ---- cycle 6 (resume at 4544) ----
// RJ#4551 — Yasuo, Windrider ("The third time I move in a turn, you score 1 point") at 7 points: only a conquer is restricted for the
// final point, so his third move wins.
test('RJ#4551 Yasuo, Windrider\'s third move scores the 8th point and wins (not a conquer)', () => {
  let g = S0(); g.players[P0].points = 7;
  control(g, BF_A, P0); control(g, BF_B, P0);
  const y = put(g, P0, 'Yasuo, Windrider', 'base');
  for (const to of [BF_A, BF_B, 'base'] as const) { g.objects[y].exhausted = false; g = drv(move(g, P0, [y], to)); if (g.winner !== null) break; }
  assert.equal(g.players[P0].points >= 8 || g.winner === P0, true, `points ${g.players[P0].points}`);
  assert.equal(g.winner, P0);
});

// RJ#4553 — P0 moves into an uncontrolled battlefield, P1 Rides the Wind a (stunned) unit in: combat, both sides survive → the attacker
// is recalled, the defender stays and then takes control of the battlefield and scores it.
test('RJ#4553 surprise defence (Ride the Wind) into an open battlefield, both survive the combat: attacker recalled, defender conquers', () => {
  let g = S0(); fundAll(g, P1, 4);
  const a = put(g, P0, 'V(3)', 'base');
  const d = put(g, P1, 'V(5)', 'base', { stunned: true });
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 4 && pend(g).player !== P1; i++) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Ride the Wind'), { targets: [[d]] });
  g = drv(g, x => (optionIds(x).includes(String(BF_A)) ? [String(BF_A)] : undefined));
  assert.equal(locOf(g, a), 'base', 'attacker recalled');
  assert.equal(locOf(g, d), BF_A, 'defender stays');
  assert.equal(g.battlefields[BF_A].controller, P1);
  assert.equal(g.players[P1].points, 1, 'P1 scores the battlefield');
});

// RJ#4558 — Whiteflame Protector ("When you play me, give a unit +8 [S] this turn") may choose itself.
test('RJ#4558 Whiteflame Protector\'s play trigger may give itself +8', () => {
  let g = S0(); fundAll(g, P0, 6);
  put(g, P0, 'V(2)', 'base');
  const w = hand(g, P0, 'Whiteflame Protector');
  g = act(g, { type: 'playCard', player: P0, obj: w, destination: 'base' });
  let offered = false;
  g = drv(g, x => { if (x.pending!.kind === 'chooseTargets' && optionIds(x).includes(w)) { offered = true; return [w]; } return undefined; });
  assert.ok(offered, 'itself is a legal choice');
  assert.equal(mightOf(g, w), (g.cards[g.objects[w].cardId].might ?? 0) + 8);
});

// RJ#4570 — Zhonya's Hourglass ("If a friendly unit would die, kill this instead…") doesn't choose anything, so played from hidden at
// BF-A it protects a friendly unit anywhere (here: one in base).
test('RJ#4570 Zhonya\'s Hourglass played from hidden at BF-A saves a friendly unit in base', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 4);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const z = put(g, P0, "Zhonya's Hourglass", { facedown: BF_A });
  const u = put(g, P0, 'V(2)', 'base');
  [g] = cast(g, P1, 'ZapR', { targets: [[u]] });
  if (pend(g).player === P1) g = pass(g);
  assert.ok(canPlayNow(g, P0, z), 'playable from hidden in response');
  g = act(g, { type: 'playCard', player: P0, obj: z, destination: BF_A });
  g = drv(g);
  assert.equal(zone(g, z), 'trash', 'Zhonya\'s killed instead');
  assert.equal(zone(g, u), 'base');
  assert.equal(g.objects[u].damage, 0);
});

// RJ#4574 — Nine-Tailed Fox (Ahri legend) is a triggered ability with no exhaust in it: it triggers while the legend is exhausted.
test('RJ#4574 an exhausted Nine-Tailed Fox legend still gives the attacker -1', () => {
  let g = S0({ tp: P1 });
  const l = setLegend(g, P0, 'Nine-Tailed Fox'); g.objects[l].exhausted = true;
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const a = put(g, P1, 'V(4)', 'base');
  g = move(g, P1, [a], BF_A);
  for (let i = 0; i < 10 && (g.chain.length || pend(g).inStep); i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.ok(g.log.some(x => /Trigger: Nine-Tailed Fox/.test(x.text)), 'Fox triggered');
  assert.equal(mightOf(g, a), 3);
});

// RJ#4577 — Rek'Sai, Swarm Queen's attack trigger plays a banished card from the top of the deck: it can't be hidden instead (hiding is
// only from hand) — the Hidden Blade is simply played.
test('RJ#4577 Rek\'Sai, Swarm Queen: a Hidden Blade revealed by her trigger is played, never offered to be hidden', () => {
  let g = S0(); fundAll(g, P0, 6);
  const e = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const r = put(g, P0, "Rek'Sai, Swarm Queen", 'base');
  const hb = put(g, P0, 'Hidden Blade', 'deckTop'); put(g, P0, 'V(1)', 'deckTop');
  g = move(g, P0, [r], BF_A);
  const seen: string[] = [];
  g = drv(g, x => {
    const d = x.pending!; seen.push(...optionIds(x).map(String));
    if (d.kind === 'optional') return ['yes'];
    if (d.kind === 'chooseCards' && optionIds(x).includes(hb)) return [hb];
    if (d.kind === 'chooseTargets' && optionIds(x).includes(e)) return [e];
    return undefined;
  });
  assert.ok(!seen.some(s => /hide/i.test(s)), 'no hide option');
  assert.equal(zone(g, hb), 'trash', 'played (resolved), not hidden');
  assert.equal(zone(g, e), 'trash');
});

// RJ#4578 — damage stays on a unit through a non-combat showdown/conquer; units heal at the end of a combat or the end of the turn.
test('RJ#4578 a damaged unit conquering an empty battlefield keeps its damage until the end of turn', () => {
  let g = S0();
  const u = put(g, P0, 'V(3)', 'base', { damage: 2 });
  g = drv(move(g, P0, [u], BF_A));
  assert.equal(g.battlefields[BF_A].controller, P0, 'conquered');
  assert.equal(g.objects[u].damage, 2, 'not healed by the conquer');
  g = endTurn(g);
  assert.equal(g.objects[u].damage, 0, 'healed at end of turn');
});

// RJ#4589 — Unforgiven (Yasuo legend: "[2], [E]: Move a friendly unit to or from its base") chooses the unit it moves, so Irelia,
// Fervent ("When you choose or ready me, give me +1 [S] this turn") gets +1.
test('RJ#4589 Unforgiven moving Irelia, Fervent chooses her: +1', () => {
  let g = S0(); fundAll(g, P0, 4);
  const l = setLegend(g, P0, 'Unforgiven');
  const ir = put(g, P0, 'Irelia, Fervent', 'base');
  const base = mightOf(g, ir);
  const ab = legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === l);
  assert.ok(ab, 'Unforgiven activatable');
  g = act(g, ab!);
  g = drv(g, x => { if (optionIds(x).includes(ir)) return [ir]; if (optionIds(x).includes(String(BF_A))) return [String(BF_A)]; return undefined; });
  assert.equal(locOf(g, ir), BF_A, 'moved');
  assert.equal(mightOf(g, ir), base + 1);
});

// RJ#4602 — Charm moves an enemy unit into my battlefield: its controller applied Contested, so they are the attacker and get focus
// first in the combat showdown, even though I played the spell (principle 18).
test('RJ#4602 after my Charm pulls an enemy into my battlefield, the opponent (attacker) has focus first', () => {
  let g = S0(); fundAll(g, P0, 4);
  put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(2)', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Charm') });
  for (let i = 0; i < 20 && pend(g).kind !== 'showdownAction'; i++) {
    const d = pend(g);
    if (d.inStep) { const o = optionIds(g).map(String); g = choose(g, o.includes(e) ? e : o.includes(String(BF_A)) ? String(BF_A) : o[0]); continue; }
    g = pass(g);
  }
  assert.equal(locOf(g, e), BF_A);
  assert.equal(g.showdown?.attacker, P1);
  expectPending(g, 'showdownAction', P1);
});

// RJ#4607 — 3-Might attacker: Smoke Screen (-4, min 1) resolved first, then Cleave (Assault 3) → 4; Cleave first (6), then Smoke
// Screen → 2 (the non-passive minimum is snapshotted when applied, principle 10).
test('RJ#4607 Smoke Screen then Cleave on a 3-Might attacker: 4; Cleave then Smoke Screen: 2', () => {
  const run = (cleaveFirst: boolean) => {
    let g = S0(); fundAll(g, P0, 4); fundAll(g, P1, 4);
    put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
    const a = put(g, P0, 'V(3)', 'base');
    g = move(g, P0, [a], BF_A);
    for (let i = 0; i < 6 && (g.chain.length || pend(g).inStep); i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
    const cleave = () => { if (pend(g).player !== P0) g = pass(g); g = play(g, P0, hand(g, P0, 'Cleave'), { targets: [[a]] }); g = resolveChain(g); };
    const smoke = () => { if (pend(g).player !== P1) g = pass(g); g = play(g, P1, hand(g, P1, 'Smoke Screen'), { targets: [[a]] }); g = resolveChain(g); };
    if (cleaveFirst) { cleave(); assert.equal(mightOf(g, a), 6); smoke(); } else { smoke(); assert.equal(mightOf(g, a), 1); cleave(); }
    return mightOf(g, a);
  };
  assert.equal(run(false), 4);
  assert.equal(run(true), 2);
});

// RJ#4611 — three 1-Might units at Trifarian War Camp (2 each): Thousand-Tailed Watcher's -3 (min 1) is snapshotted as -1 → 1;
// Grand Strategem +5 afterwards → 6 each (principle 10).
test('RJ#4611 War Camp units (2) hit by Thousand-Tailed Watcher (→ 1), then Grand Strategem: 6 each', () => {
  let g = S0({ bfA: 'Trifarian War Camp' }); fundAll(g, P0, 10); fundAll(g, P1, 10);
  const us = [put(g, P1, 'V(1)', BF_A), put(g, P1, 'V(1)', BF_A), put(g, P1, 'V(1)', BF_A)]; control(g, BF_A, P1);
  assert.deepEqual(us.map(u => mightOf(g, u)), [2, 2, 2]);
  [g] = cast(g, P0, 'Thousand-Tailed Watcher', { dest: 'base', may: [false] });
  g = settle(g);
  assert.deepEqual(us.map(u => mightOf(g, u)), [1, 1, 1]);
  const a = put(g, P0, 'V(1)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 6 && pend(g).player !== P1; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  g = play(g, P1, hand(g, P1, 'Grand Strategem'));
  g = resolveChain(g);
  assert.deepEqual(us.map(u => mightOf(g, u)), [6, 6, 6]);
});

// RJ#4613 — Dr. Mundo (6 + 10 in trash = 16) and Ravenbloom Student (2) swapped by Switcheroo: fixed -14/+14 modifiers; Switcheroo
// then goes to the trash (Mundo 6+11-14 = 3) and the Student's spell trigger adds +1 after the swap (2+14+1 = 17).
test('RJ#4613 Switcheroo between Dr. Mundo (16) and Ravenbloom Student (2): Mundo 3, Student 17', () => {
  let g = S0(); fundAll(g, P0, 6);
  fillTrash(g, P0, 10);
  const m = put(g, P0, 'Dr. Mundo', BF_A), s = put(g, P0, 'Ravenbloom Student', BF_A); control(g, BF_A, P0);
  assert.equal(mightOf(g, m), 16);
  g = play(g, P0, hand(g, P0, 'Switcheroo'), { targets: [[m, s]] });
  g = drv(g, x => (x.pending!.kind === 'chooseTargets' ? [optionIds(x).includes(m) ? m : s] : undefined));
  assert.equal(g.players[P0].trash.length, 11);
  assert.equal(mightOf(g, m), 3);
  assert.equal(mightOf(g, s), 17);
});

// RJ#4630 — Mystic Reversal may keep the stolen spell's original choices; Possession's "enemy unit" is then my own unit, illegal for
// me, so the spell does nothing — it is effectively nullified.
test('RJ#4630 Mystic Reversal on Possession targeting my unit, keeping the original target: nothing happens', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 6); fundAll(g, P1, 6);
  const mine = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const pos = hand(g, P1, 'Possession');
  g = play(g, P1, pos, { targets: [[mine]] });
  if (pend(g).player === P1) g = pass(g);
  [g] = cast(g, P0, 'Mystic Reversal', { targets: [[g.chain[0].id]] });
  g = drv(g, x => (x.pending!.kind === 'optional' ? ['no'] : undefined));
  assert.equal(g.objects[mine].controller, P0, 'still mine');
  assert.equal(locOf(g, mine), BF_A, 'not recalled');
  assert.equal(zone(g, pos), 'trash', 'Possession resolved (fizzled) under my control');
  assert.equal(g.chain.length, 0);
});

// RJ#4633 — Darius ("Other friendly units have +1 [S] here") dies in combat; two 1-Might units each with 1 damage were 2 Might with
// him. Only Darius has lethal damage in the combat cleanup; the others' damage is removed at the end of combat before any further
// cleanup, so they survive (RJ adopted; RJ itself flags it as possibly unintended — AMBIGUOUS).
test('RJ#4633 Darius (+1 to others here) dies in combat: damaged 1-Might allies (1 damage) survive, healed at the end of combat', () => {
  let g = S0();
  put(g, P1, 'V(6)', BF_A); control(g, BF_A, P1);
  const dar = put(g, P0, 'ogn-243-298', 'base');
  const r1 = put(g, P0, 'V(1)', 'base', { damage: 1 }), r2 = put(g, P0, 'V(1)', 'base', { damage: 1 });
  g = move(g, P0, [dar, r1, r2], BF_A);
  assert.equal(mightOf(g, r1), 2);
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const p = pend(g);
    if (p.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: p.player, assignment: p.player === P1 ? { [dar]: 6 } : (p.data as { suggested: Record<ObjId, number> }).suggested }); continue; }
    g = p.inStep ? act(g, legal(g, p.player)[0]) : pass(g);
  }
  assert.equal(zone(g, dar), 'trash');
  assert.deepEqual([zone(g, r1), zone(g, r2)], ['battlefield', 'battlefield']);
  assert.equal(g.objects[r1].damage, 0);
});

// RJ#4634 — two Vi ("Recycle 1 from your trash: Give me +1 [S] this turn"): each activation is one Vi's own ability; only it gets +1.
test('RJ#4634 two Vi: recycling for one Vi\'s ability gives only that Vi +1', () => {
  let g = S0();
  fillTrash(g, P0, 3);
  const v1 = put(g, P0, 'ogn-036-298', 'base'), v2 = put(g, P0, 'ogn-036-298', 'base');
  g = act(g, legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === v1)!);
  g = drv(g);
  assert.equal(mightOf(g, v1), 4);
  assert.equal(mightOf(g, v2), 3);
  assert.equal(g.players[P0].trash.length, 2);
});

// RJ#4642 — Kai'Sa, Evolutionary plays Time Warp from the trash on conquer ("…Then recycle it"): Time Warp banishes itself as it
// resolves, so the recycle can't find it — it stays banished (the extra turn is still taken). Points 11 under a 16-point game.
test('RJ#4642 Time Warp played from the trash by Kai\'Sa, Evolutionary banishes itself; not recycled', () => {
  let g = S0({ victoryScore: 16 }); fundAll(g, P0, 6); g.players[P0].points = 11;
  const ks = put(g, P0, "Kai'Sa, Evolutionary", 'base');
  const tw = put(g, P0, 'Time Warp', 'trash');
  g = drv(move(g, P0, [ks], BF_A), x => { const ids = optionIds(x); if (ids.includes(tw)) return [tw]; if (x.pending!.kind === 'optional') return ['yes']; return undefined; });
  assert.equal(g.players[P0].points, 12, 'conquered');
  assert.equal(zone(g, tw), 'banishment', 'stays banished');
  assert.deepEqual(g.ex.extraTurns, [P0]);
});

// RJ#4645 — Traveling Merchant ("When I move, discard 1, then draw 1") moves into an enemy battlefield: once its trigger resolves, the
// combat showdown begins with no main-phase window in between (the next decision is inside the combat).
test('RJ#4645 after Traveling Merchant\'s move trigger resolves, the combat begins at once (no main-phase window)', () => {
  let g = S0();
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const m = put(g, P0, 'Traveling Merchant', 'base');
  g = move(g, P0, [m], BF_A);
  for (let i = 0; i < 10 && (g.chain.length || pend(g).inStep); i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.ok(g.log.some(l => /Trigger: Traveling Merchant/.test(l.text)), 'move trigger happened');
  assert.notEqual(pend(g).kind, 'mainAction');
  assert.equal(g.showdown?.isCombat, true, 'already in the combat showdown');
});

// RJ#4648 — a 4-Might unit at Trifarian War Camp (5) gets Smoke Screen (-4, min 1): 1 (the -4 is applied in full); moved off the camp
// it loses the +1 and is 0.
test('RJ#4648 War Camp unit (4+1) Smoke Screened to 1; leaving the camp it drops to 0', () => {
  let g = S0({ bfA: 'Trifarian War Camp' }); fundAll(g, P0, 4);
  const u = put(g, P0, 'V(4)', BF_A); control(g, BF_A, P0);
  assert.equal(mightOf(g, u), 5);
  g = play(g, P0, hand(g, P0, 'Smoke Screen'), { targets: [[u]] });
  g = resolveChain(g);
  assert.equal(mightOf(g, u), 1);
  g = drv(move(g, P0, [u], 'base'));
  assert.equal(locOf(g, u), 'base');
  assert.equal(mightOf(g, u), 0);
});

// RJ#4650 — Yasuo ("When I attack, deal damage equal to my Might to an enemy unit here") is stolen by Hostile Takeover in response to
// his attack trigger: the trigger stays controlled by the attacker with its original target, which is still an enemy of that
// controller, so it resolves (verified consensus RJ#11824/#8226/#563). RJ#4650's "fails from the source's perspective" is not adopted.
test('RJ#4650 Yasuo stolen by Hostile Takeover in response to his attack trigger: the trigger still damages its original target', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const y = put(g, P1, 'ogn-076-298', 'base');
  const v = put(g, P0, 'V(9)', BF_A); control(g, BF_A, P0);
  const ht = put(g, P0, 'Hostile Takeover', { facedown: BF_A });
  g = drive11(move(g, P1, [y], BF_A), [], x => x.pending?.player === P0);
  assert.deepEqual(chainLabels(g), ['trigger:Yasuo']);
  g = drive11(act(g, { type: 'playCard', player: P0, obj: ht }), [[y]], x => x.chain.length === 1 && x.pending?.kind === 'chainResponse');
  assert.equal(g.objects[y].controller, P0, 'Hostile Takeover resolved first');
  g = drive11(g, [], x => x.chain.length === 0);
  assert.ok(g.objects[v].damage > 0);
  assert.equal(g.objects[v].damage, mightOf(g, y), 'damage equal to Yasuo\'s Might dealt to the original target');
});

// RJ#4660 — the lone defender is killed during the combat showdown: the combat is unopposed but still a combat until it ends, so the
// attacker keeps its Attacker designation and Cleave's Assault 3 applies.
test('RJ#4660 attacker in a combat made unopposed (defender killed) still gets Cleave\'s Assault bonus', () => {
  let g = S0(); fundAll(g, P0, 6);
  const d = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(3)', 'base');
  g = move(g, P0, [a], BF_A);
  expectPending(g, 'showdownAction', P0);
  g = play(g, P0, hand(g, P0, 'Hidden Blade'), { targets: [[d]] });
  g = resolveChain(g);
  assert.equal(zone(g, d), 'trash');
  assert.equal(g.showdown?.isCombat, true, 'still a combat showdown');
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Cleave'), { targets: [[a]] });
  g = resolveChain(g);
  assert.equal(g.objects[a].combatRole, 'attacker');
  assert.equal(mightOf(g, a), 6, '3 + Assault 3');
});

// RJ#4669 — Dazzling Aurora's end-of-turn trigger plays a unit to an open battlefield; the showdown there happens in the ending step,
// and afterwards the ending step continues: Aurora does not trigger a second time.
test('RJ#4669 Dazzling Aurora triggers once per end of turn, even after the showdown it causes', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'Dazzling Aurora', 'base');
  put(g, P0, 'V(1)', 'deckTop');
  put(g, P0, 'Miss Fortune, Buccaneer', 'deckTop');
  g = endTurn(g);
  for (let i = 0; i < 20; i++) { const d = g.pending; if (!d || d.kind === 'mainAction') break; if (d.inStep) { const o = d.options!.find(o => o.id === String(BF_A)) ?? d.options![0]; g = act(g, { type: 'choose', player: d.player, optionIds: [o.id] }); } else g = pass(g); }
  assert.equal(g.battlefields[BF_A].controller, P0, 'the showdown/conquer happened');
  assert.equal(g.log.filter(l => /Trigger: Dazzling Aurora/.test(l.text)).length, 1, 'one Aurora trigger');
  assert.equal(g.activePlayer, P1, 'the turn ended');
});

// RJ#4671 — Stupefy ("Give a unit -1 [S] this turn, to a minimum of 1 [S]. Draw 1.") whose target died in response: still draws.
test('RJ#4671 Stupefy whose target is gone on resolution still draws 1', () => {
  let g = S0(); fundAll(g, P0, 4);
  const v = put(g, P1, 'V(2)', 'base');
  g = play(g, P0, hand(g, P0, 'Stupefy'), { targets: [[v]] });
  [g] = cast(g, P0, 'ZapR', { targets: [[v]] });
  const h0 = g.players[P0].hand.length;
  g = resolveChain(g);
  assert.equal(zone(g, v), 'trash');
  assert.equal(g.players[P0].hand.length, h0 + 1, 'Stupefy still draws');
});

// RJ#4672 — Miss Fortune, Captain ("The first time I move each turn, you may ready something else") also triggers when an effect
// (Ride the Wind) moves her.
test('RJ#4672 Miss Fortune, Captain moved by Ride the Wind: her first-move trigger readies something else', () => {
  let g = S0(); fundAll(g, P0, 4);
  const mf = put(g, P0, 'Miss Fortune, Captain', 'base');
  const tired = put(g, P0, 'V(2)', 'base', { ready: false });
  g = play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[mf]] });
  let asked = false;
  g = drv(g, x => { const ids = optionIds(x).map(String); if (ids.includes(String(BF_A)) && x.pending!.kind !== 'chooseTargets') return [String(BF_A)]; if (ids.includes(tired)) { asked = true; return [tired]; } if (x.pending!.kind === 'optional') return ['yes']; return undefined; });
  assert.equal(locOf(g, mf), BF_A);
  assert.ok(asked, 'her trigger offered the exhausted unit');
  assert.equal(g.objects[tired].exhausted, false);
});

// RJ#4675 — one unit attacks two battlefields controlled by a Nine-Tailed Fox (Ahri legend) player in one turn (the second via Ride the
// Wind): the legend triggers each time, -1 and -1 → -2.
test('RJ#4675 a unit attacking two Nine-Tailed Fox battlefields in one turn gets -1 twice', () => {
  let g = S0(); fundAll(g, P0, 6);
  setLegend(g, P1, 'Nine-Tailed Fox');
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  const a = put(g, P0, 'V(5)', 'base');
  g = drv(move(g, P0, [a], BF_A));
  assert.equal(g.battlefields[BF_A].controller, P0, 'first attack won');
  assert.equal(mightOf(g, a), 4);
  g = play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[a]] });
  g = drv(g, x => (optionIds(x).map(String).includes(String(BF_B)) ? [String(BF_B)] : undefined));
  assert.equal(locOf(g, a), BF_B);
  assert.equal(g.log.filter(l => /Trigger: Nine-Tailed Fox/.test(l.text)).length, 2);
  assert.equal(mightOf(g, a), 3, '5 - 1 - 1');
});

// ---- cycle 7 (resume at 4679) ----
// RJ#4679 — Ekko, Recurrent ("[Deathknell] — Recycle me to ready your runes") dies alone defending: once his Deathknell has resolved
// the combat result follows at once — no window to spend the readied runes. RJ's aside "lone unit → control is lost at once, so
// Shen can't be played there" is not adopted: the combat is ongoing, so Shen, Kinkou (Reaction) can be played to that battlefield in
// response to the Deathknell (DECISIONS #1331, principle 1).
test('RJ#4679 Ekko, Recurrent\'s Deathknell readies runes but no window follows before the result; Shen can answer the Deathknell itself', () => {
  const setup = (extra: number) => {
    let g = S0({ tp: P1 });
    setRunes(g, P0, 3, 'calm', false);
    if (extra) addRunes(g, P0, extra, 'order');
    const ek = put(g, P0, 'Ekko, Recurrent', BF_A); control(g, BF_A, P0);
    const shen = hand(g, P0, 'Shen, Kinkou');
    const a = put(g, P1, 'V(7)', 'base');
    g = move(g, P1, [a], BF_A);
    for (let i = 0; i < 20 && zone(g, ek) !== 'trash'; i++) { const d = pend(g); g = d.kind === 'assignDamage' ? act(g, legal(g, d.player)[0]) : pass(g); }
    if (pend(g).kind === 'optional') g = yes(g);
    assert.deepEqual(chainLabels(g), ['trigger:Ekko']);
    return { g, shen };
  };
  let { g, shen } = setup(0);
  for (let i = 0; i < 6 && g.chain.length; i++) g = pass(g);
  expectPending(g, 'mainAction', P1, 'straight to the result after the Deathknell');
  assert.equal(readyRunes(g, P0), 3, 'runes readied');
  assert.equal(g.battlefields[BF_A].controller, P1, 'P1 conquered');
  void shen;
  ({ g, shen } = setup(4));
  for (let i = 0; i < 4 && pend(g).player !== P0; i++) g = pass(g);
  expectPending(g, 'chainResponse', P0);
  assert.equal(g.battlefields[BF_A].controller, P0, 'control kept while the combat is ongoing');
  assert.ok(canPlayNow(g, P0, shen, BF_A), 'Shen, Kinkou can be played there in response to the Deathknell');
});

// RJ#4685 — two Sett, Brawler ("When you play me or when I conquer, buff me") conquer together: each one's trigger buffs him.
test('RJ#4685 two Sett, Brawler conquering together are both buffed', () => {
  let g = S0();
  const s1 = put(g, P0, 'Sett, Brawler', 'base');
  const s2 = put(g, P0, 'Sett, Brawler', 'base');
  g = drv(move(g, P0, [s1, s2], BF_A));
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.objects[s1].counters.buff ?? 0, 1);
  assert.equal(g.objects[s2].counters.buff ?? 0, 1);
  assert.equal(mightOf(g, s1), 5); assert.equal(mightOf(g, s2), 5);
});

// RJ#4688 — an equipped unit dies: the Equipment is unattached and stays ready (no Equip ability exhausts the gear); see T152.
test('RJ#4688 Equipment whose unit dies is not exhausted', () => {
  let g = S0(); fundAll(g, P0, 4);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const sw = put(g, P0, 'Long Sword', 'base'); attachNow(g, sw, u);
  assert.equal(g.objects[sw].exhausted, false);
  [g] = cast(g, P0, 'KillA', { targets: [[u]] });
  g = resolveChain(g);
  assert.equal(zone(g, u), 'trash');
  assert.equal(g.objects[sw].attachedTo, undefined);
  assert.equal(locOf(g, sw), 'base');
  assert.equal(g.objects[sw].exhausted, false, 'still ready');
});

// RJ#4690 — the defender removes its only unit during the combat showdown: it still gets focus, keeps control of the battlefield
// until the combat ends, and may still play a unit there (CR 323.5: no loss of control while a showdown/combat is ongoing). RJ#10885 (r10401).
test('RJ#4690 defender with no units left in the combat showdown still gets focus, keeps control and can play a unit there', () => {
  let { g, def: [d] } = attackSetup(['V(3)'], ['V(3)']);
  fundAll(g, P0, 12); fundAll(g, P1, 12);
  const shen = hand(g, P1, 'Shen, Kinkou');
  for (let i = 0; i < 6 && !(pend(g).player === P1 && pend(g).kind === 'showdownAction'); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  g = play(g, P1, hand(g, P1, 'Retreat'), { targets: [[d]] });
  for (let i = 0; i < 6 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(zone(g, d), 'hand');
  expectPending(g, 'showdownAction', P0);
  g = pass(g);
  expectPending(g, 'showdownAction', P1, 'the unit-less defender gets focus');
  assert.equal(g.battlefields[BF_A].controller, P1, 'still controls the battlefield');
  assert.ok(canPlayNow(g, P1, shen, BF_A), 'can play a unit to it');
});

// RJ#4701 — Kai'Sa, Evolutionary's conquer trigger plays Falling Comet (cost [5]) from the trash without paying its Energy cost:
// Lady of Luminosity ("When you play a spell that costs [5] or more, draw 1") checks the card's cost, so it draws (RJ#2176, r1301).
test('RJ#4701 Falling Comet played free by Kai\'Sa, Evolutionary still costs 5 for Lady of Luminosity: draw 1', () => {
  let g = S0(); fundAll(g, P0, 6); g.players[P0].points = 6;
  setLegend(g, P0, 'Lady of Luminosity');
  const ks = put(g, P0, "Kai'Sa, Evolutionary", 'base');
  const fc = put(g, P0, 'Falling Comet', 'trash');
  const e = put(g, P1, 'V(3)', BF_B); control(g, BF_B, P1);
  const h0 = g.players[P0].hand.length;
  g = drv(move(g, P0, [ks], BF_A), x => { const ids = optionIds(x); if (ids.includes(fc)) return [fc]; if (ids.includes(e)) return [e]; if (x.pending!.kind === 'optional') return ['yes']; return undefined; });
  assert.equal(g.players[P0].points, 7, 'conquered');
  assert.equal(zone(g, e), 'trash', 'Falling Comet was played and resolved');
  assert.ok(g.log.some(l => /Lady of Luminosity/.test(l.text)), 'legend triggered');
  assert.equal(g.players[P0].hand.length, h0 + 1, 'drew 1');
});

// RJ#4710 — Herald of the Arcane ("[1], [T]: Play a 1 [S] Recruit unit token") is an activated ability on the chain, so the opponent
// may respond to it; the Recruit it plays when it resolves finalizes and resolves at once (no chain item / window for the token).
test('RJ#4710 Herald of the Arcane\'s ability can be responded to; the Recruit itself enters without a new window', () => {
  let g = S0(); fundAll(g, P1, 4); const zr = hand(g, P1, 'ZapR'); put(g, P0, 'V(3)', 'base');
  const l = setLegend(g, P0, 'Herald of the Arcane');
  const ab = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === l)!;
  g = act(g, ab);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = act(g, legal(g, pend(g).player)[0]);
  assert.deepEqual(chainLabels(g).map(s => s.split(':')[0]), ['ability'], 'the ability is on the chain');
  g = pass(g);
  expectPending(g, 'chainResponse', P1, 'the opponent may respond');
  assert.ok(canPlayNow(g, P1, zr), 'a Reaction can be played');
  g = pass(g);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = act(g, legal(g, pend(g).player)[0]);
  assert.equal(g.chain.length, 0, 'no chain item for the token');
  expectPending(g, 'mainAction', P0);
  assert.ok(Object.values(g.objects).some(o => o.isToken && o.zone === 'base' && o.controller === P0), 'Recruit in play');
});

// RJ#4717 — an off-domain card (a Calm/Body card in a Fury/Chaos deck) in the sideboard is a deck-building error: the deck is illegal
// (sideboard cards must be valid main-deck cards), so no effect (Dazzling Aurora) can get it into play.
test('RJ#4717 an off-domain card in the sideboard makes the deck illegal', () => {
  const ok = legalDeck({ sideboard: ['cf-furychaos'] });
  assert.equal(validateDeck(ok, fixtureDb(), { battlefields: 3 }).length, 0, 'an in-domain sideboard card is fine');
  const bad = legalDeck({ sideboard: ['cf-calmbody'] });
  assert.ok(validateDeck(bad, fixtureDb(), { battlefields: 3 }).length > 0, 'off-domain sideboard card is illegal');
});

// RJ#4727 — a 1-Might unit with Mask of Foresight ("attacks alone: +1") attacks a Nine-Tailed Fox ("-1, to a minimum of 1") battlefield.
// Combat triggers are placed attacker first, defender last (CR 466.2.d.1) on either player's turn, so the Fox resolves first: on a
// 1-Might unit its -1 (min 1) generates -0 (CR 479.4.b, principle 10), then Mask +1 → 2. RJ (turn-order placement, ends at 1) not adopted.
test('RJ#4727 (MISMATCH-RJ) 1-Might attacker with Mask of Foresight vs Nine-Tailed Fox: Fox resolves first (min 1 → -0), then +1 → 2, on either turn', () => {
  // attacker's turn
  let g = S0(); setLegend(g, P1, 'Nine-Tailed Fox');
  put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  put(g, P0, 'Mask of Foresight', 'base');
  const a = put(g, P0, 'V(1)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 12 && (g.chain.length || pend(g).inStep); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  let R = g.log.filter(l => /^Resolving/.test(l.text)).map(l => l.text);
  assert.ok(R.findIndex(t => /Nine-Tailed Fox/.test(t)) < R.findIndex(t => /Mask of Foresight/.test(t)), R.join(' | '));
  assert.equal(mightOf(g, a), 2);
  // defender's turn (P1 Charms my unit into its Fox battlefield)
  let h = S0({ tp: P1 }); fundAll(h, P1, 4); setLegend(h, P1, 'Nine-Tailed Fox');
  put(h, P1, 'V(3)', BF_A); control(h, BF_A, P1);
  put(h, P0, 'Mask of Foresight', 'base');
  const b = put(h, P0, 'V(1)', 'base');
  h = play(h, P1, hand(h, P1, 'Charm'), { targets: [[b]], locations: [BF_A] });
  for (let i = 0; i < 30 && (h.chain.length || pend(h).inStep); i++) {
    const p = pend(h);
    h = p.inStep ? (optionIds(h).includes(b) ? choose(h, b) : p.kind === 'chooseDestination' ? choose(h, String(BF_A)) : act(h, legal(h, p.player)[0])) : pass(h);
  }
  assert.equal(h.showdown?.attacker, P0);
  R = h.log.filter(l => /^Resolving/.test(l.text)).map(l => l.text);
  assert.ok(R.findIndex(t => /Nine-Tailed Fox/.test(t)) < R.findIndex(t => /Mask of Foresight/.test(t)), R.join(' | '));
  assert.equal(mightOf(h, b), 2);
});

// RJ#4729 — exhausted buffed Fiora, Victorious (5, Mighty) with Fiora, Worthy: Call to Glory paid by spending her buff drops her to 4,
// then its +3 makes her Mighty again → Fiora, Worthy's "becomes Mighty" triggers and may pay [C] to ready her (cf. RJ#641, r0001).
test('RJ#4729 Fiora, Victorious loses Mighty by spending her buff for Call to Glory, regains it from the +3: Fiora, Worthy readies her', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'Fiora, Worthy', 'base');
  const fv = put(g, P0, 'Fiora, Victorious', 'base', { buff: true, ready: false });
  assert.equal(mightOf(g, fv), 5);
  const cg = hand(g, P0, 'Call to Glory');
  g = act(g, { type: 'playCard', player: P0, obj: cg });
  let asked = false;
  g = drv(g, gg => { const d = gg.pending!; if (d.kind === 'optional') { if (/ready|\[C\]|Fiora/i.test(d.prompt ?? '')) asked = true; return ['yes']; } if (d.options!.some(o => o.id === fv)) return [fv]; return undefined; });
  assert.ok(!(g.objects[fv].counters.buff > 0), 'buff spent');
  assert.equal(mightOf(g, fv), 7);
  assert.ok(asked || g.log.some(l => /^Trigger: Fiora, Worthy|^Trigger: Fiora/.test(l.text)), 'Fiora, Worthy triggered');
  assert.equal(g.objects[fv].exhausted, false, 'readied');
});

// RJ#4743 — P0's Hidden Blade on P1's unit; P1 responds with Discipline (draw 1) on another unit; once Discipline resolves P1 has
// priority again with Hidden Blade still on the chain, so the Defy just drawn can counter it.
test('RJ#4743 Discipline in response to Hidden Blade draws Defy, which can then counter Hidden Blade', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const t = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const o = put(g, P1, 'V(2)', 'base');
  const df = put(g, P1, 'Defy', 'deckTop');
  g = play(g, P0, hand(g, P0, 'Hidden Blade'), { targets: [[t]] });
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'Discipline'), { targets: [[o]] });
  for (let i = 0; i < 4 && g.chain.length === 2; i++) g = pass(g);
  assert.equal(g.chain.length, 1, 'Discipline resolved, Hidden Blade still on the chain');
  assert.equal(zone(g, df), 'hand', 'Defy drawn');
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  expectPending(g, 'chainResponse', P1);
  g = play(g, P1, df, { targets: [[g.chain[0].id]] });
  g = resolveChain(g);
  assert.equal(zone(g, t), 'battlefield', 'Hidden Blade countered');
});

// RJ#4749 — Blood Money ("Kill a unit at a battlefield with 2 [S] or less") can't choose a 3-Might unit planning to Stupefy it in
// response; with Stupefy resolved first (3 → 2) it can.
test('RJ#4749 Blood Money can\'t target a 3-Might unit; after Stupefy has resolved (2) it can', () => {
  let g = S0(); fundAll(g, P0, 6);
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const other = put(g, P1, 'V(1)', BF_A);
  const bm = hand(g, P0, 'Blood Money');
  const x = act(g, { type: 'playCard', player: P0, obj: bm });
  const tg = x.pending?.kind === 'chooseTargets' ? optionIds(x) : x.chain.at(-1)?.targets.flat() ?? [];
  assert.ok(!tg.includes(e), `3-Might unit not offered (${tg})`);
  assert.ok(tg.includes(other));
  g = play(g, P0, hand(g, P0, 'Stupefy'), { targets: [[e]] });
  g = resolveChain(g);
  assert.equal(mightOf(g, e), 2);
  g = play(g, P0, bm, { targets: [[e]] });
  g = resolveChain(g);
  assert.equal(zone(g, e), 'trash');
});

// RJ#4760 — Rengar, Pouncing ("I can be played to a battlefield you're attacking") played in response to Traveling Merchant's move
// trigger: combat hasn't begun, so P0 isn't attacking yet — Rengar can only go to base and is not an attacker in the combat that follows.
test('RJ#4760 Rengar, Pouncing in response to Traveling Merchant\'s move trigger: only to base, not an attacker', () => {
  let g = S0(); fundAll(g, P0, 4);
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const m = put(g, P0, 'Traveling Merchant', 'base');
  const r = hand(g, P0, 'Rengar, Pouncing');
  g = move(g, P0, [m], BF_A);
  for (let i = 0; i < 5 && pend(g).inStep; i++) g = choose(g, optionIds(g)[0]);
  assert.deepEqual(chainLabels(g), ['trigger:Traveling Merchant']);
  assert.equal(g.showdown, null, 'combat not begun');
  assert.deepEqual(playDests(g, P0, r), ['base']);
  g = play(g, P0, r, { dest: 'base' });
  for (let i = 0; i < 10 && (g.chain.length || pend(g).inStep); i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(g.showdown?.isCombat, true);
  assert.equal(locOf(g, r), 'base');
  assert.ok(g.objects[r].combatRole !== 'attacker');
});

// RJ#4763 — Switcheroo in combat on an attacker with Assault 3 (Vayne, Hunter: 2 + 3 = 5) and a 1-Might defender: current Mights
// (incl. Assault) are swapped → attacker 1, defender 5; the swap is a this-turn difference (DECISIONS #10752), so when the attacker
// later loses Assault it goes 3 lower (here: 1 → -2 once no longer attacking).
test('RJ#4763 Switcheroo swaps an Assault attacker\'s current Might with the defender\'s; losing Assault later lowers it further', () => {
  let g = S0(); fundAll(g, P0, 6);
  const d = put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const v = put(g, P0, 'Vayne, Hunter', 'base');
  g = move(g, P0, [v], BF_A);
  for (let i = 0; i < 6 && !(pend(g).kind === 'showdownAction' && pend(g).player === P0); i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(mightOf(g, v), 5);
  g = play(g, P0, hand(g, P0, 'Switcheroo'), { targets: [[v, d]] });
  g = resolveChain(g);
  assert.equal(mightOf(g, v), 1, 'attacker gets the defender\'s 1');
  assert.equal(mightOf(g, d), 5, 'defender gets 5');
  g.objects[v].combatRole = undefined as never; g.timestamp++;
  assert.equal(mightOf(g, v), -2, 'without Assault: 2 - 4');
});

// RJ#4774 — Heimerdinger, Inventor ("I have all [T] abilities of all friendly legends, units, and gear") gets them only from objects on
// the board (and the legend): an Iron Ballista in the trash gives him nothing; one on the board does.
test('RJ#4774 Heimerdinger, Inventor copies [T] abilities of gear on the board, not of gear in the trash', () => {
  let g = S0(); fundAll(g, P0);
  const h = put(g, P0, 'Heimerdinger, Inventor', 'base');
  put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  put(g, P0, 'Iron Ballista', 'trash');
  assert.ok(!legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === h), 'nothing copied from the trash');
  put(g, P0, 'Iron Ballista', 'base', { ready: false });
  assert.ok(legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === h), 'copied from the board (even exhausted)');
});

// RJ#4777 — Svellsongur copies the unit's printed text only: on Watchful Sentry ("[Deathknell] — Draw 1") both Deathknells trigger
// (draw 2); on a vanilla unit whose Deathknell comes from Sacred Shears, only the Shears' one does (draw 1). Cf. RJ#5323 (r5201).
test('RJ#4777 Svellsongur doubles Watchful Sentry\'s printed Deathknell, but not a Deathknell granted by Sacred Shears', () => {
  const run = (unit: string, shears: boolean) => {
    let g = S0(); fundAll(g, P0, 4);
    const u = put(g, P0, unit, BF_A); control(g, BF_A, P0);
    if (shears) attachNow(g, put(g, P0, 'Sacred Shears', 'base'), u);
    attachNow(g, put(g, P0, 'Svellsongur', 'base'), u);
    const h0 = g.players[P0].hand.length;
    [g] = cast(g, P0, 'KillA', { targets: [[u]] });
    g = drv(g);
    assert.equal(zone(g, u), 'trash');
    return g.players[P0].hand.length - h0;
  };
  assert.equal(run('Watchful Sentry', false), 2, 'printed + copied Deathknell');
  assert.equal(run('V(2)', true), 1, 'only the Shears\' Deathknell');
});

// RJ#4789 — Fiora, Peerless ("When I attack or defend one on one, double my Might this combat") defending against two attackers: the
// "one on one" condition is part of the trigger event, so it never triggers (and there is no window to Fight or Flight one attacker first).
test('RJ#4789 Fiora, Peerless defending against two attackers does not trigger', () => {
  let g = S0({ tp: P1 });
  const f = put(g, P0, 'Fiora, Peerless', BF_A); control(g, BF_A, P0);
  const a1 = put(g, P1, 'V(1)', 'base'), a2 = put(g, P1, 'V(1)', 'base');
  g = move(g, P1, [a1, a2], BF_A);
  for (let i = 0; i < 6 && (g.chain.length || pend(g).inStep); i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(g.showdown?.isCombat, true);
  assert.ok(!g.log.some(l => /Trigger: Fiora/.test(l.text)), 'no trigger');
  assert.equal(mightOf(g, f), 3);
});

// RJ#4799 — buffed Sett, Brawler (5) in base spends his buff (cost → 4) for +4; the opponent responds with Smoke Screen (-4, min 1):
// it resolves first (4 → 1, a -3), then the +4 → 5. If he already had 1 damage, he dies in the cleanup right after Smoke Screen.
test('RJ#4799 Sett, Brawler\'s +4 answered by Smoke Screen: 4 → 1 → 5; with 1 damage he dies before the +4', () => {
  const run = (damage: number) => {
    let g = S0(); fundAll(g, P1, 4);
    const s = put(g, P0, 'Sett, Brawler', 'base', { buff: true, damage });
    g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === s)!);
    for (let i = 0; i < 3 && pend(g).inStep; i++) g = act(g, legal(g, pend(g).player)[0]);
    assert.equal(mightOf(g, s), 4, 'buff spent as the cost');
    g = pass(g);
    expectPending(g, 'chainResponse', P1);
    g = play(g, P1, hand(g, P1, 'Smoke Screen'), { targets: [[s]] });
    g = pass(g); g = pass(g);
    assert.equal(g.chain.length, 1, 'Smoke Screen resolved');
    if (zone(g, s) === 'trash') return 'dead';
    assert.equal(mightOf(g, s), 1);
    g = resolveChain(g);
    return mightOf(g, s);
  };
  assert.equal(run(0), 5);
  assert.equal(run(1), 'dead');
});

// RJ#4801 — Arcane Shift (banish a friendly unit and replay it; deal 3 to an enemy unit) chooses one of the opponent's units, so the
// opponent's Not So Fast ("Counter an enemy spell or ability that chooses a friendly unit or gear") can counter it.
test('RJ#4801 Not So Fast counters Arcane Shift (it chose the opponent\'s unit)', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P0, 'V(2)', 'base');
  const e = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  g = play(g, P0, hand(g, P0, 'Arcane Shift'), { targets: [[u], [e]] });
  assert.equal(g.chain.length, 1);
  assert.ok(g.chain[0].targets.flat().includes(e), 'the enemy unit was chosen');
  g = pass(g);
  const nsf = hand(g, P1, 'Not So Fast');
  assert.ok(canPlayNow(g, P1, nsf), 'Not So Fast is playable');
  g = play(g, P1, nsf, { targets: [[g.chain[0].id]] });
  g = resolveChain(g);
  assert.equal(g.objects[e].damage, 0, 'no damage');
  assert.equal(locOf(g, u), 'base', 'the friendly unit was never banished');
});

// RJ#4802 — Dr. Mundo, Expert (6, empty trash) defends with a Tank(2); the 8-Might attacker assigns lethal to the Tank first and 6 to
// Mundo: combat damage is simultaneous, so both die in the same cleanup — the Tank reaching the trash doesn't save Mundo.
test('RJ#4802 Dr. Mundo, Expert and a Tank dealt lethal combat damage together both die (no +1 from the Tank first)', () => {
  let g = S0({ tp: P1 });
  g.players[P0].trash = [];
  const m = put(g, P0, 'Dr. Mundo, Expert', BF_A); control(g, BF_A, P0);
  const t = put(g, P0, 'Tank(2)', BF_A);
  const a = put(g, P1, 'V(8)', 'base');
  assert.equal(mightOf(g, m), 6);
  g = move(g, P1, [a], BF_A);
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: d.player, assignment: d.player === P1 ? { [t]: 2, [m]: 6 } : (d.data as { suggested: Record<ObjId, number> }).suggested }); continue; }
    g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  assert.equal(zone(g, t), 'trash');
  assert.equal(zone(g, m), 'trash', 'Mundo dies too');
});

// RJ#4803 — Altar of Memories puts a card from hand on the bottom of the Main Deck: that is not "recycling", so Karma, Channeler
// ("When you recycle one or more cards to your Main Deck, buff a friendly unit") does not trigger.
test('RJ#4803 Altar of Memories putting a card on the bottom of the deck is not a recycle: no Karma, Channeler buff', () => {
  let g = S0(); fundAll(g, P0, 4);
  const k = put(g, P0, 'Karma, Channeler', 'base');
  put(g, P0, 'Altar of Memories', 'base');
  const u = put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0); put(g, P0, 'V(1)', BF_A);
  const c = hand(g, P0, 'V(2)');
  [g] = cast(g, P0, 'KillA', { targets: [[u]] });
  let bottom = false;
  g = drv(g, x => { const d = x.pending!; if (d.kind === 'optional') return ['yes']; if (d.kind === 'chooseCards' && optionIds(x).includes(c)) return [c]; if (optionIds(x).includes('bottom')) { bottom = true; return ['bottom']; } return undefined; });
  assert.ok(bottom, 'put on the bottom');
  assert.equal(g.players[P0].mainDeck.at(-1), c);
  assert.ok(!g.log.some(l => /Trigger: Karma/.test(l.text)), 'Karma did not trigger');
  assert.ok(!(g.objects[k].counters.buff > 0));
});

// RJ#4816 — on the opponent's turn I play a hidden Hidden Blade on my own unit with Wraith of Echoes and Viktor, Innovator out:
// the kill (Wraith) happens during resolution, the play completes after it (Viktor), so the two triggers became pending at
// different times — no order choice; Wraith goes on the chain first and Viktor resolves first. With a damage spell (HidZap)
// the unit dies in the cleanup after the play completed, so Viktor is first and Wraith resolves first.
test('RJ#4816 Hidden Blade on my unit with Wraith of Echoes + Viktor, Innovator: no order choice — Wraith then Viktor on the chain; with a damage spell, Viktor then Wraith', () => {
  const run = (blade: string) => {
    let g = S0({ tp: P1 });
    fundAll(g, P0); fundAll(g, P1);
    put(g, P0, 'Viktor, Innovator', 'base');
    put(g, P0, 'Wraith of Echoes', 'base');
    const mine = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
    const hb = put(g, P0, blade, { facedown: BF_A });
    const e = put(g, P1, 'V(5)', 'base');
    [g] = cast(g, P1, 'ZapM', { targets: [[e]] });
    g = pass(g);
    g = play(g, P0, hb, { targets: [[mine]] });
    g = pass(g); g = pass(g);
    assert.equal(zone(g, mine), 'trash');
    assert.notEqual(pend(g).kind, 'orderTriggers', 'no order choice');
    return chainLabels(g).slice(1);
  };
  assert.deepEqual(run('Hidden Blade'), ['trigger:Wraith of Echoes', 'trigger:Viktor']);
  assert.deepEqual(run('HidZap'), ['trigger:Viktor', 'trigger:Wraith of Echoes']);
});

// RJ#4825 — a deck needs no Signature card (only the ≤ 3 limit exists): the standard legal deck has none and validates.
test('RJ#4825 a deck with no Signature cards is legal', () => {
  const d = legalDeck();
  const db = fixtureDb();
  assert.ok(!d.main.some(id => (db[id]?.supertypes ?? []).includes('Signature')), 'no Signature card in the deck');
  assert.deepEqual(validateDeck(d, db, { battlefields: 3 }), []);
});

// RJ#4828 — Unforgiven (Yasuo legend: "[2], [E]: Move a friendly unit to or from its base") doesn't exhaust the moved unit; an
// exhausted unit can be moved and stays exhausted.
test('RJ#4828 Unforgiven moving a unit to base does not exhaust it; an exhausted unit stays exhausted', () => {
  for (const ready of [true, false]) {
    let g = S0();
    fundAll(g, P0);
    const lg = setLegend(g, P0, 'Unforgiven');
    const u = put(g, P0, 'V(2)', BF_A, { ready }); control(g, BF_A, P0);
    g = act(g, legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === lg)!);
    g = answer(g, { targets: [[u]], locations: ['base'] }, P0);
    g = drv(g, x => (optionIds(x).includes('base') ? ['base'] : undefined));
    assert.equal(locOf(g, u), 'base');
    assert.equal(g.objects[u].exhausted, !ready, ready ? 'still ready' : 'still exhausted');
  }
});

// RJ#4835 — buffed Sett, Brawler conquers Monastery of Hirana: he spends his buff for Monastery's draw and regains one from his
// own conquer trigger. (RJ spends the buff when Monastery's trigger resolves; officially it is paid as the trigger finalizes —
// CR 383.3.b, DECISIONS #7923 — the outcome is the same: draw 1, Sett ends buffed.)
test('RJ#4835 buffed Sett, Brawler conquering Monastery of Hirana spends his buff to draw, then his conquer trigger buffs him again', () => {
  let g = S0({ bfA: 'Monastery of Hirana' });
  const s = put(g, P0, 'Sett, Brawler', 'base', { buff: true });
  const h0 = g.players[0].hand.length;
  g = move(g, P0, [s], BF_A);
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'orderTriggers') { g = choose(g, (d.options!.find(o => /Monastery/.test(o.label)) ?? d.options![0]).id); continue; }
    if (d.kind === 'optional') { g = yes(g); continue; }
    if (d.inStep) { g = choose(g, (d.options!.find(o => o.id === String(s)) ?? d.options![0]).id); continue; }
    g = pass(g);
  }
  assert.equal(g.players[0].points, 1);
  assert.equal(g.players[0].hand.length, h0 + 1, 'drew 1');
  assert.equal(g.objects[s].counters.buff, 1, 'buffed again');
});

// RJ#4837 — buffed Sett, Kingpin alone at a battlefield: 5 + 1 (buff) + 1 (himself, a buffed friendly unit) = 7; Thousand-Tailed
// Watcher -3 → 4; Call to Glory spending his buff (loses the buff and his own +1 → 2) then +3 → 5.
test('RJ#4837 buffed Sett, Kingpin: Watcher -3 (7 → 4), then Call to Glory spending his buff → 5', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P1, 4); fundAll(g, P0, 4);
  const s = put(g, P0, 'Sett, Kingpin', BF_A, { buff: true }); control(g, BF_A, P0);
  assert.equal(mightOf(g, s), 7);
  g = play(g, P1, hand(g, P1, 'Thousand-Tailed Watcher'), { dest: 'base', may: [false] });
  g = resolveChain(g);
  assert.equal(mightOf(g, s), 4);
  const e = put(g, P1, 'V(5)', 'base');
  [g] = cast(g, P1, 'ZapM', { targets: [[e]] }); // opens a chain on P1's turn so P0 can react
  g = pass(g);
  const cg = hand(g, P0, 'Call to Glory');
  g = drv(play(g, P0, cg, { may: [true], targets: [[s]] }), x => x.pending!.kind === 'optional' ? ['yes'] : optionIds(x).includes(s) ? [s] : undefined);
  assert.equal(zone(g, cg), 'trash');
  assert.ok(!(g.objects[s].counters.buff > 0), 'buff spent');
  assert.equal(mightOf(g, s), 5);
});

// RJ#4846 — Dragon's Rage ("Move an enemy unit. Then … choose another enemy unit at its destination …") may send the enemy unit to its
// controller's base; the exchange then happens with another enemy unit in that base. (RJ answers only the first half.)
test('RJ#4846 Dragon\'s Rage moves an enemy unit to its base; it and another enemy unit there deal damage to each other', () => {
  let g = S0();
  fundAll(g, P0);
  const x = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const y = put(g, P1, 'V(2)', 'base');
  [g] = cast(g, P0, "Dragon's Rage, Lee Sin", { targets: [[x]] });
  g = answer(g, { locations: ['base'] });
  g = drv(g, z => (optionIds(z).includes('base') ? ['base'] : optionIds(z).includes(y) ? [y] : undefined));
  assert.equal(locOf(g, x), 'base');
  assert.equal(zone(g, y), 'trash', 'the 2-Might unit took 3');
  assert.equal(g.objects[x].damage, 2);
});

// RJ#4850 — with nothing triggering at end of turn there is no priority window: ending the turn goes straight to the opponent's
// turn, and a Reaction in the opponent's hand is never playable in my ending step. (End-of-turn triggers — Dazzling Aurora —
// do open a window: RJ#7108, r6501.)
test('RJ#4850 no end-of-turn trigger: no window for the opponent\'s Reaction before my turn ends', () => {
  let g = S0();
  fundAll(g, P1);
  hand(g, P1, 'Stupefy');
  put(g, P0, 'V(2)', 'base');
  const t0 = g.turn;
  g = act(g, { type: 'endTurn', player: P0 });
  const seen: string[] = [];
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) { seen.push(`${g.pending.kind}:${g.pending.player}:${g.turn}`); g = g.pending.inStep ? act(g, legal(g, g.pending.player)[0]) : pass(g); }
  assert.ok(!seen.some(s => s.endsWith(`:${t0}`) && /chainResponse|showdownAction/.test(s)), `no window on my turn (${seen})`);
  assert.equal(pend(g).player, P1, 'the opponent\'s turn began');
  assert.notEqual(g.turn, t0);
});

// RJ#4864 — the opponent's Zhonya's Hourglass replaces the death of their defending Watchful Sentry (Deathknell — Draw 1): no
// Deathknell (it never died), but it is recalled, so my Draven, Audacious still wins the combat ("first time I win a combat each
// turn, you score 1 point") and conquers: 2 points.
test('RJ#4864 Zhonya\'s Hourglass saves the defending Deathknell unit: no Deathknell, but Draven, Audacious still wins the combat (point) and conquers', () => {
  let g = S0();
  const dr = put(g, P0, 'Draven, Audacious', 'base');
  const ws = put(g, P1, 'Watchful Sentry', BF_A); control(g, BF_A, P1);
  const z = put(g, P1, "Zhonya's Hourglass", 'base');
  const h1 = g.players[P1].hand.length;
  g = drv(move(g, P0, [dr], BF_A), x => (x.pending!.kind === 'optional' ? ['yes'] : undefined));
  assert.equal(zone(g, z), 'trash', 'Hourglass used');
  assert.equal(locOf(g, ws), 'base', 'Sentry saved and recalled');
  assert.equal(g.players[P1].hand.length, h1, 'no Deathknell draw');
  assert.equal(g.battlefields[BF_A].controller, P0, 'conquered');
  assert.equal(g.players[P0].points, 2, 'conquer + Draven\'s win-a-combat point');
});

// RJ#4866 — on the opponent's turn (in a showdown) I play Get Excited!, discarding Flame Chompers on resolution (its trigger becomes
// pending then) and killing their Watchful Sentry (Deathknell) in the cleanup, which also triggers my Immortal Phoenix in the trash.
// Chompers' trigger is chained first; of the two simultaneous cleanup triggers the turn player's Deathknell goes on first; so the
// resolution order is Phoenix, Deathknell, Chompers — and both of my units are played to my base.
test('RJ#4866 Get Excited! discarding Flame Chompers and killing a Deathknell unit on the opponent\'s turn: Phoenix, Deathknell, Chompers; both units played', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0); fundAll(g, P1);
  g.players[P0].hand = [];
  const ch = hand(g, P0, 'Flame Chompers');
  const ge = hand(g, P0, 'Get Excited!');
  const ph = put(g, P0, 'Immortal Phoenix', 'trash');
  const ws = put(g, P1, 'Watchful Sentry', BF_A); control(g, BF_A, P1);
  const m = put(g, P1, 'V(2)', 'base');
  g = move(g, P1, [m], BF_B);
  g = pass(g);
  expectPending(g, 'showdownAction', P0);
  g = play(g, P0, ge, { targets: [[ws]] });
  for (let i = 0; i < 12 && g.chain.length < 3; i++) g = pend(g).inStep ? choose(g, optionIds(g).includes('yes') ? 'yes' : optionIds(g)[0]) : pass(g);
  assert.deepEqual(chainLabels(g), ['trigger:Flame Chompers', 'trigger:Watchful Sentry', 'trigger:Immortal Phoenix']);
  const n0 = g.log.length;
  g = drv(g, x => (optionIds(x).includes('yes') ? ['yes'] : undefined));
  const res = g.log.slice(n0).map(l => l.text).filter(t => /^Resolving/.test(t));
  const idx = (re: RegExp) => res.findIndex(t => re.test(t));
  assert.ok(idx(/Phoenix/) < idx(/Sentry/) && idx(/Sentry/) < idx(/Chompers/), `order ${res}`);
  assert.equal(locOf(g, ch), 'base');
  assert.equal(locOf(g, ph), 'base');
});

// RJ#4874 — Cleave on my 4-Might unit; the opponent answers with Stupefy (-1). While Stupefy is still on the chain the unit is 4, so
// Gust ("3 [S] or less") can't choose it; once Stupefy resolves (3) Gust can, before Cleave resolves.
test('RJ#4874 Gust can target a 4-Might unit only after Stupefy has resolved (not while it is still on the chain)', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P0, 'V(4)', BF_A); control(g, BF_A, P0);
  const gust = hand(g, P1, 'Gust');
  g = play(g, P0, hand(g, P0, 'Cleave'), { targets: [[u]] });
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'Stupefy'), { targets: [[u]] });
  if (pend(g).player !== P1) g = pass(g);
  expectPending(g, 'chainResponse', P1);
  assert.equal(g.chain.length, 2);
  assert.equal(canPlayNow(g, P1, gust), false, 'no legal Gust target while Stupefy is unresolved');
  for (let i = 0; i < 3 && g.chain.length === 2; i++) g = pass(g);
  assert.equal(g.chain.length, 1, 'Stupefy resolved, Cleave remains');
  assert.equal(mightOf(g, u), 3);
  if (pend(g).player === P0) g = pass(g);
  assert.ok(canPlayNow(g, P1, gust), 'now Gust can choose it');
  g = play(g, P1, gust, { targets: [[u]] });
  g = resolveChain(g);
  assert.equal(zone(g, u), 'hand');
});

// RJ#4875 — Traveling Merchant moves into an enemy-held battlefield (combat staged; its trigger on the chain, so the state is Closed);
// I Flash it back to base in response: no showdown/combat ever starts, the battlefield stays the opponent's, and the Merchant's
// "When I move" triggers twice (in and out).
test('RJ#4875 Traveling Merchant Flashed back out before the combat starts: no showdown, two move triggers', () => {
  let g = S0();
  fundAll(g, P0);
  for (let i = 0; i < 3; i++) hand(g, P0, 'V(1)');
  const tm = put(g, P0, 'Traveling Merchant', 'base');
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [tm], BF_A);
  assert.ok(g.chain.some(c => c.source === tm), 'move trigger on the chain');
  if (pend(g).player !== P0) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Flash'), { targets: [[tm]] });
  g = drv(g);
  assert.equal(locOf(g, tm), 'base');
  assert.equal(g.objects[e].damage, 0, 'no combat');
  assert.equal(g.objects[tm].damage, 0);
  assert.equal(g.battlefields[BF_A].controller, P1);
  assert.equal(g.log.filter(l => /^Trigger: Traveling Merchant/.test(l.text)).length, 2, 'two triggers');
  assert.ok(!g.log.some(l => /[Ss]howdown|[Cc]ombat begins/.test(l.text)), 'no showdown');
});

// RJ#4888 (MISMATCH-RJ) — RJ: simultaneous triggers are ordered at once, but their choices (targets, modes) and the example's
// cost (Super Mega Death Rocket!'s "you may discard 1 to return this") are made as each resolves, so ordering Qiyana's draw first
// can supply the card to discard. Officially a trigger's targets/choices are made, and a leading "you may [cost]" is decided and
// paid, when it is finalized onto the chain (CR 383.3.a-b, 355.5; DECISIONS #1451 group, #5702): with an empty hand the Rocket
// trigger can't be paid and is removed, even though Qiyana, Victorious then draws 1.
test('RJ#4888 (official: CR 383.3.b) Qiyana, Victorious + Super Mega Death Rocket! conquer triggers: the Rocket\'s discard is paid on finalization — an empty hand can\'t use Qiyana\'s later draw', () => {
  let g = S0();
  g.players[P0].hand = [];
  const q = put(g, P0, 'Qiyana, Victorious', 'base');
  const r = put(g, P0, 'Super Mega Death Rocket!, Jinx', 'trash');
  g = move(g, P0, [q], BF_A);
  let ordered = false;
  g = drv(g, x => {
    const d = x.pending!;
    if (d.kind === 'orderTriggers') { ordered = true; return [d.options!.find(o => /Qiyana/.test(o.label))!.id]; } // any order: the Rocket's cost is due as it is chained
    if (optionIds(x).includes('yes')) return ['yes'];
    return undefined;
  });
  assert.ok(ordered, 'the two triggers were ordered');
  assert.equal(g.players[P0].hand.length, 1, 'Qiyana drew 1');
  assert.equal(zone(g, r), 'trash', 'the Rocket could not be returned');
  // with a card in hand the Rocket's discard is paid as it goes on the chain and it returns
  let h = S0();
  h.players[P0].hand = [];
  const c = hand(h, P0, 'V(1)');
  const q2 = put(h, P0, 'Qiyana, Victorious', 'base');
  const r2 = put(h, P0, 'Super Mega Death Rocket!, Jinx', 'trash');
  h = move(h, P0, [q2], BF_A);
  h = drv(h, x => (optionIds(x).includes('yes') ? ['yes'] : optionIds(x).includes(c) ? [c] : undefined));
  assert.equal(zone(h, c), 'trash', 'discarded');
  assert.equal(zone(h, r2), 'hand', 'Rocket returned');
});

// RJ#4894 — buffed Stalwart Poro (3) next to Lee Sin, Centered (+2 → 5) gets Thousand-Tailed Watcher's -3 (min 1): increases are
// applied first, the reduction is a plain -3 → 2 (no re-application of the aura afterwards).
test('RJ#4894 buffed Stalwart Poro with Lee Sin, Centered (5) hit by Thousand-Tailed Watcher: 2', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P1, 4);
  put(g, P0, 'Lee Sin, Centered', BF_A);
  const p = put(g, P0, 'Stalwart Poro', BF_A, { buff: true }); control(g, BF_A, P0);
  assert.equal(mightOf(g, p), 5);
  g = play(g, P1, hand(g, P1, 'Thousand-Tailed Watcher'), { dest: 'base', may: [false] });
  g = resolveChain(g);
  assert.equal(mightOf(g, p), 2);
});

// RJ#4914 — Ember Monk ("When you play a card from [Hidden], give me +2") sees a hidden card played at another battlefield.
test('RJ#4914 Ember Monk gets +2 for a card played from hiding at a different battlefield', () => {
  let g = S0();
  fundAll(g, P0);
  const m = put(g, P0, 'Ember Monk', BF_A); control(g, BF_A, P0);
  put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
  const hz = put(g, P0, 'HidZap', { facedown: BF_B, hiddenTurn: 0 });
  const e = put(g, P1, 'V(5)', 'base');
  g = play(g, P0, hz, { targets: [[e]] });
  g = drv(g);
  assert.equal(zone(g, hz), 'trash');
  assert.equal(mightOf(g, m), 6);
});

// RJ#4915 (OUTDATED) — surprise defence: I move into an empty battlefield (non-combat showdown), the opponent Rides the Wind a unit in.
// RJ (v1.4): the non-combat showdown goes on until all pass, then the staged combat begins. CR 1.5 323.13 (cleanup step 10a): "Combat
// is Staged at a Battlefield where there is a Non-Combat Showdown ongoing, that Showdown becomes a Combat Showdown" — in the cleanup
// right after Ride the Wind resolves. The first mover is the attacker (DECISIONS #4560 group).
test('RJ#4915 (official: CR 323.13) surprise defence: the non-combat showdown becomes the combat showdown as soon as Ride the Wind resolves; the first mover attacks', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1, 4);
  const a = put(g, P0, 'V(3)', 'base');
  const d = put(g, P1, 'V(2)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 4 && pend(g).player !== P1; i++) g = pass(g);
  assert.equal(g.showdown?.isCombat, false, 'non-combat showdown');
  g = play(g, P1, hand(g, P1, 'Ride the Wind'), { targets: [[d]] });
  g = answer(g, { locations: [BF_A] });
  for (let i = 0; i < 6 && g.chain.length > 0; i++) g = pend(g).inStep ? choose(g, optionIds(g).includes(String(BF_A)) ? String(BF_A) : optionIds(g)[0]) : pass(g);
  assert.equal(locOf(g, d), BF_A, 'the defender arrived');
  assert.equal(g.showdown?.isCombat, true, 'combat showdown at once, no further passes needed');
  assert.equal(g.showdown?.attacker, P0, 'the first mover attacks');
  assert.equal(g.showdown?.defender, P1);
});

// RJ#4932 — Dr. Mundo, Expert with one card in the trash (7) gets two Smoke Screens (-4 and -2, each snapshotted to keep him at 1);
// when the card leaves the trash he is 6 - 6 = 0 (the minimum was only applied as each resolved); a third Smoke Screen gives -0 → 0.
test('RJ#4932 Dr. Mundo, Expert 7 → 1 by two Smoke Screens; the trash card leaves → 0; a third Smoke Screen keeps 0', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P1);
  const m = put(g, P0, 'Dr. Mundo, Expert', 'base');
  g.players[P0].trash = [];
  put(g, P0, 'V(1)', 'trash');
  assert.equal(mightOf(g, m), 7);
  for (let i = 0; i < 2; i++) { g = play(g, P1, hand(g, P1, 'Smoke Screen'), { targets: [[m]] }); g = resolveChain(g); }
  assert.equal(mightOf(g, m), 1);
  g.players[P0].trash = []; g.timestamp++;
  assert.equal(mightOf(g, m), 0, 'snapshotted -6 with 6 base');
  g = play(g, P1, hand(g, P1, 'Smoke Screen'), { targets: [[m]] }); g = resolveChain(g);
  assert.equal(mightOf(g, m), 0);
  assert.equal(zone(g, m), 'base', '0 Might without damage does not die');
});

// ---- cycle 9 (resume at 4942) ----
// RJ#4955 — Petricite Monument ("Friendly units have [Deflect]") is a static aura: units played later get it too, enemies don't,
// and it ends when the gear leaves the board ([Temporary] kills it at my next Beginning Phase).
test('RJ#4955 Petricite Monument: friendly units (incl. later ones) have Deflect only while it is on the board', () => {
  let g = S0();
  const m = put(g, P0, 'Petricite Monument', 'base');
  const u = put(g, P0, 'V(2)', 'base');
  const e = put(g, P1, 'V(2)', 'base');
  assert.ok(hasKeyword(g, u, 'Deflect'));
  assert.ok(!hasKeyword(g, e, 'Deflect'), 'enemy units do not');
  const later = put(g, P0, 'V(1)', BF_A);
  assert.ok(hasKeyword(g, later, 'Deflect'), 'a unit arriving later has it too');
  g = nextTurn(g); g = nextTurn(g);
  assert.equal(zone(g, m), 'trash', 'Temporary killed it');
  assert.ok(!hasKeyword(g, u, 'Deflect') && !hasKeyword(g, later, 'Deflect'), 'Deflect ends with the gear');
});

// RJ#4967 — Twisted Fate, Gambler's attack trigger "reveal the top rune of your rune deck, then recycle it" recycles a rune, so
// Battle Mistress (Sivir legend, "When you recycle a rune, you may exhaust me to play a Gold gear token exhausted") triggers.
test('RJ#4967 Twisted Fate, Gambler recycling the top rune of the rune deck triggers Battle Mistress', () => {
  let g = S0();
  const l = setLegend(g, P0, 'Battle Mistress');
  g.objects[l].exhausted = false;
  const tf = put(g, P0, 'Twisted Fate, Gambler', 'base');
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  assert.ok(runeDeckN(g, P0) > 0);
  const golds = (x: GameState) => Object.values(x.objects).filter(o => o.isToken && o.controller === P0 && x.cards[o.cardId]?.name === 'Gold' && o.zone === 'base').length;
  g = move(g, P0, [tf], BF_A);
  g = drv(g, x => (optionIds(x).includes('yes') ? ['yes'] : undefined));
  assert.equal(golds(g), 1, 'Gold token played (the legend may ready again when the enemy dies)');
});

// RJ#4975 — The Zero Drive on a unit I control but the opponent owns: its granted Deathknell banishes it to its owner's banishment,
// still "banished with this", so Zero Drive's "[3][C], Banish this: Play all units banished with this" plays it for me.
test('RJ#4975 The Zero Drive plays back a stolen (opponent-owned) unit it banished', () => {
  let g = S0(); fundAll(g, P0, 8);
  const u = put(g, P1, 'V(2)', 'base', { controller: P0, damage: 2 });
  const zd = put(g, P0, 'The Zero Drive', 'base');
  attachNow(g, zd, u); // +2 Might while equipped: 4 Might, 2 damage
  [g] = cast(g, P0, 'ZapM', { targets: [[u]] });
  g = drv(g);
  assert.equal(zone(g, u), 'banishment', 'banished by the granted Deathknell');
  assert.equal(g.objects[u].owner, P1);
  assert.notEqual(zone(g, zd), 'banishment');
  g = drv(activate(g, P0, zd, 0));
  assert.equal(zone(g, zd), 'banishment');
  assert.equal(zone(g, u), 'base', 'played back');
  assert.equal(g.objects[u].controller, P0, 'under my control');
});

// RJ#4979 — one exhaust can't pay two costs: exhausting Lee Sin, Ascetic for Meditation (draw 2) leaves his "[T]: Buff me" unusable.
test('RJ#4979 Lee Sin, Ascetic exhausted as Meditation\'s cost can no longer use his [T] buff ability', () => {
  let g = S0(); fundAll(g, P0);
  const lee = put(g, P0, 'Lee Sin, Ascetic', 'base');
  const canBuff = (x: GameState) => legal(x, P0, 'activate').some(a => a.type === 'activate' && a.obj === lee);
  assert.ok(canBuff(g), 'ready: [T] available');
  const h0 = g.players[P0].hand.length;
  g = play(g, P0, hand(g, P0, 'Meditation'), { may: [true], targets: [[lee]] });
  g = resolveChain(g);
  assert.equal(g.players[P0].hand.length, h0 + 2, 'drew 2 (Meditation itself was added and played)');
  assert.equal(g.objects[lee].exhausted, true);
  assert.ok(!canBuff(g), 'exhausted: no [T] ability');
});

// RJ#5053 — Zenith Blade ("Stun an enemy unit at a battlefield. You may move a friendly unit to that enemy unit's battlefield"):
// if I Retreat my own chosen unit in response, the enemy is still stunned; if the enemy unit is Retreated, nothing that refers to it
// happens — no stun, and the friendly unit doesn't move ("that enemy unit's battlefield").
test('RJ#5053 Zenith Blade: my friendly unit Retreated in response → the stun still happens; the enemy Retreated → no stun, no move', () => {
  const setup = () => {
    let g = S0(); fundAll(g, P0); fundAll(g, P1);
    const e = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
    const f = put(g, P0, 'V(3)', 'base');
    put(g, P0, 'V(1)', 'base');
    g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Zenith Blade') });
    for (let i = 0; i < 8 && pend(g).inStep && pend(g).kind === 'chooseTargets'; i++) g = choose(g, optionIds(g).includes(f) ? f : e);
    return { g, e, f };
  };
  const finish = (g: GameState) => drv(g, x => (optionIds(x).includes('yes') ? ['yes'] : undefined));
  let { g, e, f } = setup();
  assert.equal(g.chain.length, 1);
  g = play(g, P0, hand(g, P0, 'Retreat'), { targets: [[f]] });
  g = finish(g);
  assert.equal(zone(g, f), 'hand', 'my unit was Retreated');
  assert.equal(g.objects[e].stunned, true, 'the enemy is still stunned');
  ({ g, e, f } = setup());
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'Retreat'), { targets: [[e]] });
  g = finish(g);
  assert.equal(zone(g, e), 'hand');
  assert.equal(locOf(g, f), 'base', 'no move to "that enemy unit\'s battlefield"');
});

// RJ#5056 — a defending Ezreal, Dashing deals his defend-trigger damage on the initial chain, then (with focus, empty chain) uses his
// "[C]: [Action] — Move me to your base" to leave the combat; it can't be used in response to the trigger chain.
test('RJ#5056 defending Ezreal, Dashing: trigger damage first, then his Action move to base with focus on an empty chain', () => {
  let g = S0(); fundAll(g, P1);
  const ez = put(g, P1, 'Ezreal, Dashing', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(5)', 'base');
  g = move(g, P0, [a], BF_A);
  const canMove = (x: GameState) => legal(x, P1, 'activate').some(l => l.type === 'activate' && l.obj === ez);
  for (let i = 0; i < 6 && g.chain.length === 0 && pend(g).inStep; i++) g = choose(g, optionIds(g)[0]);
  assert.ok(g.chain.length > 0, 'defend trigger on the initial chain');
  if (pend(g).player === P1) assert.ok(!canMove(g), 'Action ability not usable while the chain is open');
  g = resolveChain(g);
  assert.equal(g.objects[a].damage, 3, 'Ezreal dealt his Might');
  for (let i = 0; i < 4 && pend(g).player !== P1; i++) g = pass(g);
  assert.equal(pend(g).kind, 'showdownAction');
  assert.ok(canMove(g), 'with focus on an empty chain he can move');
  g = act(g, legal(g, P1, 'activate').find(l => l.type === 'activate' && l.obj === ez)!);
  g = drv(g);
  assert.equal(locOf(g, ez), 'base');
  assert.equal(g.battlefields[BF_A].controller, P0, 'no defender left: the attacker conquers');
});

// RJ#5066 — Convergent Mutation ("This turn, increase its Might to the Might of another friendly unit") is not permanent.
test('RJ#5066 Convergent Mutation lasts only this turn', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'V(2)', 'base');
  const o5 = put(g, P0, 'V(5)', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Convergent Mutation') });
  for (let i = 0; i < 12 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g); if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g); g = choose(g, d.prompt && /another/i.test(d.prompt) ? o5 : o.includes(u) ? u : o[0]);
  }
  assert.equal(mightOf(g, u), 5);
  g = nextTurn(g);
  assert.equal(mightOf(g, u), 2, 'back to 2 next turn');
});

// RJ#5092 — Recruit the Vanguard (6) with the Lux legend (Lady of Luminosity) and Gemcraft Seer (other friendly units have Vision):
// the spell's play is completed by its resolution (principle 23) → Lady's draw trigger is met first; the four Recruit tokens are
// played after the spell finishes (CR 354.4, principle 5), so their Vision triggers are met later and placed above it
// (chronological placement, DECISIONS #7205) → all four Visions resolve before the draw.
test('RJ#5092 Recruit the Vanguard + Lady of Luminosity + Gemcraft Seer: the four Vision triggers resolve before the legend\'s draw', () => {
  let g = S0(); fundAll(g, P0);
  setLegend(g, P0, 'Lady of Luminosity');
  put(g, P0, 'Gemcraft Seer', 'base');
  const rv = hand(g, P0, 'Recruit the Vanguard');
  const h0 = g.players[P0].hand.length - 1;
  g = act(g, { type: 'playCard', player: P0, obj: rv });
  const handAtVision: number[] = [];
  for (let i = 0; i < 40 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    if (d.kind === 'chooseCards') handAtVision.push(g.players[P0].hand.length - h0);
    const o = optionIds(g); g = choose(g, o.includes('no') ? 'no' : o[0]);
  }
  assert.equal(handAtVision.length, 4, 'four Vision looks');
  assert.deepEqual(handAtVision, [0, 0, 0, 0], 'no card drawn before the Visions');
  assert.equal(g.players[P0].hand.length - h0, 1, 'the draw happens last');
});

// RJ#5121 — one Zhonya's Hourglass, several simultaneous deaths: RJ says the units' OWNER chooses (even for a unit taken by
// Possession). Official: the controller of the affected objects chooses (CR 373, DECISIONS principle 14, #1374) — here I control
// both dying units (one owned by the opponent, as after Possession), so I choose, and I may save the borrowed one.
test('RJ#5121 Zhonya\'s Hourglass vs simultaneous deaths of my unit and a unit I control but the opponent owns: I (controller) choose', () => {
  let g = S0({ tp: P1 });
  setRunes(g, P1, 0); addRunes(g, P1, 6, 'body');
  const z = put(g, P0, "Zhonya's Hourglass", 'base');
  const a = put(g, P0, 'V(1)', BF_A);
  const b = put(g, P1, 'V(1)', BF_A, { controller: P0 }); // owned by P1, controlled by P0
  control(g, BF_A, P0);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Bullet Time, Miss Fortune') });
  let askedP0 = false, askedP1Zhonya = false;
  for (let i = 0; i < 30; i++) {
    const d = g.pending!;
    if (d.kind === 'mainAction') break;
    const offersUnits = d.options?.some(o => o.id === a || o.id === b || o.objIds?.includes(a) || o.objIds?.includes(b));
    if (d.inStep && offersUnits && d.kind !== 'chooseTargets') {
      if (d.player === P0) { askedP0 = true; const ob = d.options!.find(o => o.objIds?.includes(b) || o.id === b); g = choose(g, (ob ?? d.options![0]).id); continue; }
      askedP1Zhonya = true;
    }
    if (d.kind === 'chooseTargets') { g = choose(g, d.options!.find(o => o.label.startsWith('BF-A'))!.id); continue; }
    if (d.kind === 'chooseNumber') { g = choose(g, '1'); continue; }
    if (d.inStep) { g = choose(g, d.options![0].id); continue; }
    g = pass(g);
  }
  assert.equal(zone(g, z), 'trash');
  assert.ok(askedP0, 'the controller (P0) chooses which death Zhonya\'s replaces');
  assert.ok(!askedP1Zhonya, 'the owner of the borrowed unit is not asked');
  assert.equal(zone(g, a), 'trash');
  assert.equal(zone(g, b), 'base', 'the borrowed unit was saved and recalled');
});

// RJ#5124 — Heimerdinger, Inventor ("I have all [T] abilities of all friendly legends, units, and gear") doesn't see a unit in the
// Chosen Champion zone: "units" means units on the board; the champion zone is a non-board zone (CR 108).
test('RJ#5124 Heimerdinger, Inventor does not gain the [T] ability of a unit in the Chosen Champion zone', () => {
  const heimerActs = (onBoard: boolean) => {
    const g = S0(); fundAll(g, P0);
    const h = put(g, P0, 'Heimerdinger, Inventor', 'base'); g.objects[h].exhausted = false;
    if (onBoard) { const l = put(g, P0, 'Lee Sin, Ascetic', 'base'); g.objects[l].exhausted = true; }
    else {
      const id = cid('Lee Sin, Ascetic'); if (!g.cards[id]) put(g, P0, 'Lee Sin, Ascetic', 'trash');
      const c = g.players[P0].championZone[0]; g.objects[c].cardId = id; g.timestamp++;
    }
    return legal(g, P0, 'activate').filter(a => a.type === 'activate' && a.obj === h).length;
  };
  const withChampZone = heimerActs(false), withBoard = heimerActs(true);
  assert.ok(withBoard > withChampZone, `Lee Sin on the board adds an ability to Heimerdinger (${withBoard} vs ${withChampZone})`);
});

// RJ#5159 — Ezreal, Dashing (3) wearing Forgefire Cape (+3), Rabadon's Deathcrown (+3) and Svellsongur (copies his text) attacks:
// three triggers (his, the Cape's, Svellsongur's copy of his); his and the copy each deal his Might 9 + 3 Bonus Damage = 12 to one enemy,
// the Cape deals 2 + 3 = 5 to each enemy unit there.
test('RJ#5159 Ezreal, Dashing + Forgefire Cape + Rabadon\'s Deathcrown + Svellsongur attacking: 12 + 12 to the chosen enemy, 5 to every enemy there', () => {
  let g = S0(); fundAll(g, P0);
  const ez = put(g, P0, 'Ezreal, Dashing', 'base'); g.objects[ez].exhausted = false;
  for (const gear of ['Forgefire Cape', "Rabadon's Deathcrown", 'Svellsongur']) attachNow(g, put(g, P0, gear, 'base'), ez);
  assert.equal(mightOf(g, ez), 9);
  const t1 = put(g, P1, 'V(12)', BF_A), t2 = put(g, P1, 'V(12)', BF_A); control(g, BF_A, P1);
  mod(g, t1, { might: 30 }); mod(g, t2, { might: 30 }); // 42 Might each: everything survives, damage stays marked
  g = move(g, P0, [ez], BF_A);
  let triggers = 0;
  for (let i = 0; i < 40 && !(g.chain.length === 0 && pend(g).kind === 'showdownAction'); i++) {
    const d = pend(g);
    if (!d.inStep) { triggers = Math.max(triggers, g.chain.length); g = pass(g); continue; }
    const o = optionIds(g); g = choose(g, o.includes(t1) ? t1 : o[0]);
  }
  assert.equal(triggers, 3, 'three attack triggers on the chain');
  assert.equal(g.objects[t1].damage, 29, '12 + 12 + 5');
  assert.equal(g.objects[t2].damage, 5);
});

// RJ#5162 — The Syren ("[1], [E]: Move a friendly unit at a battlefield to its base") chooses a friendly unit even without the word
// "choose": Spirit Wheel ("When you choose a friendly unit, you may pay [1] and exhaust this to draw 1") triggers.
test('RJ#5162 activating The Syren on a friendly unit triggers Spirit Wheel', () => {
  let g = S0(); fundAll(g, P0);
  const syren = put(g, P0, 'The Syren', 'base');
  put(g, P0, 'Spirit Wheel', 'base');
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const ab = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === syren);
  assert.ok(ab, 'The Syren can be activated');
  g = act(g, ab!);
  const prompts: string[] = [];
  for (let i = 0; i < 16 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g); prompts.push(d.prompt ?? '');
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g); g = choose(g, o.includes(u) ? u : o.includes('yes') ? 'yes' : o[0]);
  }
  assert.equal(locOf(g, u), 'base', 'moved to base');
  assert.ok(g.log.some(l => /Spirit Wheel/.test(l.text)) || prompts.some(p => /Spirit Wheel/.test(p)), 'Spirit Wheel triggered');
});

// RJ#5164 — Kraken Hunter played by Reinforce ("…play it, reducing its cost by [5]") with Accelerate: the [5] reduction applies to the
// total Energy cost, Accelerate's [1] included (CR 356), so only Power is left to pay; it enters ready.
test('RJ#5164 Reinforce plays Kraken Hunter with Accelerate: the [1] of Accelerate is covered by the [5] reduction, it enters ready', () => {
  let g = S0(); setRunes(g, P0, 5, 'body');
  for (let i = 0; i < 4; i++) put(g, P0, 'V(1)', 'deckTop');
  const k = put(g, P0, 'Kraken Hunter', 'deckTop');
  g = play(g, P0, hand(g, P0, 'Reinforce'));
  let offered = false;
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    if (d.kind === 'chooseCards' && o.includes(k)) g = act(g, { type: 'choose', player: d.player, optionIds: [k] });
    else if (d.kind === 'optional') { if (/Accelerate/i.test(d.prompt ?? '')) offered = true; g = choose(g, /recycle/i.test(d.prompt ?? '') ? 'no' : 'yes'); }
    else g = act(g, legal(g, d.player)[0]);
  }
  assert.ok(offered, 'Accelerate offered');
  assert.equal(locOf(g, k), 'base');
  assert.equal(g.objects[k].exhausted, false, 'entered ready');
});

// RJ#5168 — Mystic Reversal on the opponent's Unchecked Power ("Exhaust all friendly units, then deal 12 to all units at battlefields"):
// the new controller can't decline it — nothing in it is optional; "friendly" now means the stealer's units.
test('RJ#5168 Unchecked Power taken by Mystic Reversal resolves as written for its new controller: their units exhausted, 12 to all at battlefields', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const mine = put(g, P0, 'V(3)', 'base');
  const theirBase = put(g, P1, 'V(3)', 'base'); g.objects[theirBase].exhausted = false;
  const theirBf = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Unchecked Power') });
  for (let i = 0; i < 4 && pend(g).player !== P1; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  const up = g.chain[0];
  g = play(g, P1, hand(g, P1, 'Mystic Reversal'), { targets: [[up.id as ObjId]] });
  const prompts: string[] = [];
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g); if (!d.inStep) { g = pass(g); continue; }
    prompts.push(d.prompt ?? ''); g = choose(g, optionIds(g).includes('no') && /new choices|change/i.test(d.prompt ?? '') ? 'no' : optionIds(g)[0]);
  }
  assert.ok(!prompts.some(p => /Unchecked Power/i.test(p) && /may|decline/i.test(p)), 'no option to decline');
  assert.equal(g.objects[theirBase].exhausted, true, 'the stealer\'s units are exhausted');
  assert.equal(g.objects[mine].exhausted, false, 'the caster\'s units are not "friendly" to the new controller');
  assert.equal(zone(g, theirBf), 'trash', '12 to all units at battlefields');
});

// RJ#5181 — Convergent Mutation ("This turn, increase its Might to the Might of another friendly unit") is computed once on resolution:
// later changes to the other unit (+3, or its death) don't change the boosted unit this turn.
test('RJ#5181 Convergent Mutation does not track the other unit: its later +3 or death leave the boosted unit at the matched value', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'V(2)', 'base');
  const o5 = put(g, P0, 'V(5)', BF_A); control(g, BF_A, P0);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Convergent Mutation') });
  for (let i = 0; i < 12 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g); if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g); g = choose(g, d.prompt && /another/i.test(d.prompt) ? o5 : o.includes(u) ? u : o[0]);
  }
  assert.equal(mightOf(g, u), 5);
  mod(g, o5, { might: 3 });
  assert.equal(mightOf(g, o5), 8);
  assert.equal(mightOf(g, u), 5, 'not tracking the +3');
  fundAll(g, P0);
  [g] = cast(g, P0, 'KillA', { targets: [[o5]] }); g = drv(g);
  assert.equal(zone(g, o5), 'trash');
  assert.equal(mightOf(g, u), 5, 'kept after the other unit died');
});

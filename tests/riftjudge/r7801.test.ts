// Rift Judge verification, range r7801 (question ids 7801-9100). See docs/riftjudge/README.md and docs/riftjudge/r7801.md.
import { test } from 'node:test';
import { validateDeck, createGame } from '../../src/engine/index.ts';
import { fixtureDb } from '../fixtures/conformance/cards.ts';
import { attachNow, playCostOf } from '../../src/engine/testkit.ts';
import { legalDeck, realCard } from '../conformance/harness.ts';
import { withTokens, setLegend } from './r11701.helpers.ts';
import {
  assert, S0, put, hand, cast, play, pass, passN, expectPending, control, act, move, mod, nextTurn, endTurn, EventLog, setRunes,
  P0, P1, BF_A, BF_B, zone, locOf, mightOf, resolveChain, passAll, pend, answer, yes, no, choose, legal, canPlayNow, playDests,
  validateAction, activate, readyRunes, exhaustedRunes, optionIds, attackSetup, needsScripts, cid, setBattlefieldCard, addRunes, fundAll,
  rejects, moveDests, hasKeyword, toMainOf, kwValue, getView, chainLabels,
  type GameState, type ObjId, type PlayerId,
} from '../conformance/harness.ts';

void [hand, cast, play, passN, expectPending, mod, nextTurn, endTurn, EventLog, setRunes, BF_B, mightOf, resolveChain, answer, no, choose,
  legal, canPlayNow, playDests, validateAction, activate, readyRunes, exhaustedRunes, optionIds, needsScripts, cid, setBattlefieldCard, fundAll,
  rejects, moveDests, hasKeyword, zone, locOf, passAll, pend, yes, control, act, move, put, pass, attackSetup, addRunes, S0];

/** Replace p's legend with a real legend card. */
function legend(g: GameState, p: PlayerId, name: string): ObjId {
  const id = g.players[p].legend;
  const c = cid(name);
  if (!g.cards[c]) put(g, p, name, 'banishment');
  g.objects[id].cardId = c;
  g.ex.dirty = true; g.timestamp++;
  return id;
}
/** Pass showdown/chain decisions until an in-step decision or main phase. */
function toStep(g: GameState, limit = 40): GameState {
  for (let i = 0; i < limit; i++) {
    const d = g.pending;
    if (!d || d.inStep || (d.kind !== 'showdownAction' && d.kind !== 'chainResponse')) return g;
    g = pass(g);
  }
  return g;
}
void legend; void toStep;
const kwv = (g: GameState, id: ObjId, k: string) => kwValue(g, id, k);

// ---------------------------------------------------------------------------------------------
test('RJ#7801 The Boss saves a buffed Sett, Brawler that traded lethal damage in combat (replacement before it dies)', () => {
  let { g, atk, def } = (() => {
    const g0 = S0();
    const d = put(g0, P1, 'V(5)', BF_A); control(g0, BF_A, P1);
    const a = put(g0, P0, 'Sett, Brawler', 'base', { buff: true });
    legend(g0, P0, 'The Boss'); addRunes(g0, P0, 1, 'body');
    return { g: move(g0, P0, [a], BF_A), atk: [a], def: [d] };
  })();
  g = toStep(g);
  expectPending(g, 'optional', P0);
  assert.match(pend(g).prompt, /Boss/);
  g = yes(g); g = toStep(g);
  assert.equal(locOf(g, atk[0]), 'base');
  assert.equal(g.objects[atk[0]].damage, 0);
  assert.equal(zone(g, def[0]), 'trash');
});

test('RJ#7804 a battlefield held at the start of the turn cannot be conquered again that turn', () => {
  let g = S0({ tp: P1 });
  const u = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const v = put(g, P1, 'V(1)', 'base');
  g = act(g, { type: 'endTurn', player: P1 });
  g = toStep(g);
  expectPending(g, 'mainAction', P0);
  assert.equal(g.players[0].points, 1, 'hold');
  // P0 leaves and P1 takes it over, then P0 comes back and wins it
  g = move(g, P0, [u], 'base'); g = toStep(g);
  void v;
  g.battlefields[BF_A].controller = P1; g.timestamp++; // control changed in between (setup)
  const w = put(g, P1, 'V(1)', BF_A);
  const u2 = put(g, P0, 'V(3)', 'base');
  g = move(g, P0, [u2], BF_A); g = toStep(g);
  assert.equal(zone(g, w), 'trash');
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[0].points, 1, 'no second score from the same battlefield this turn');
});

test('RJ#7805 Ride the Wind during a combat showdown: both showdowns complete and both battlefields are scored', () => {
  let g = S0();
  addRunes(g, P0, 2, 'chaos');
  const d = put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(3)', 'base');
  const b = put(g, P0, 'V(2)', 'base', { ready: false });
  const rtw = hand(g, P0, 'Ride the Wind');
  g = move(g, P0, [a], BF_A);
  expectPending(g, 'showdownAction', P0);
  g = play(g, P0, rtw, { targets: [[b]], locations: [BF_B] });
  g = toStep(g); g = answer(g, { locations: [BF_B] }); g = toStep(g);
  assert.equal(zone(g, d), 'trash');
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.battlefields[BF_B].controller, P0);
  assert.equal(g.players[0].points, 2);
});

test('RJ#7806 Vi, Destructive: no per-turn limit, opponent can respond, not usable on the opponent\'s turn', () => {
  let g = S0();
  const vi = put(g, P0, 'Vi, Destructive', 'base');
  for (let i = 0; i < 3; i++) put(g, P0, 'V(1)', 'trash');
  const acts = () => legal(g, P0, 'activate').filter(x => x.type === 'activate' && x.obj === vi);
  assert.ok(acts().length > 0);
  const use = () => { g = act(g, acts()[0]); if (pend(g).kind === 'chooseCards') g = choose(g, optionIds(g)[0]); };
  use();
  assert.equal(g.chain.length, 1, 'the ability uses the chain');
  g = pass(g);
  expectPending(g, 'chainResponse', P1, 'opponent may respond');
  g = toStep(g);
  use(); g = toStep(g);
  assert.equal(mightOf(g, vi), 5);
  assert.equal(g.players[0].trash.length, 1);
  const g2 = S0({ tp: P1 });
  const vi2 = put(g2, P0, 'Vi, Destructive', 'base'); put(g2, P0, 'V(1)', 'trash');
  assert.equal(legal(g2, P0, 'activate').filter(x => x.type === 'activate' && x.obj === vi2).length, 0);
});

test('RJ#7807 Vi, Destructive: not activatable during a showdown (no Action/Reaction timing) (dup of 7806)', () => {
  const s = attackSetup(['V(3)'], ['V(2)']);
  let g = s.g;
  const vi = put(g, P0, 'Vi, Destructive', 'base'); put(g, P0, 'V(1)', 'trash');
  expectPending(g, 'showdownAction', P0);
  assert.equal(legal(g, P0, 'activate').filter(x => x.type === 'activate' && x.obj === vi).length, 0);
});

test('RJ#7808 no reactions can be played during combat damage assignment', () => {
  const s = attackSetup(['V(5)'], ['V(3)', 'V(3)']);
  let g = s.g;
  const r0 = hand(g, P0, 'PumpR'); const r1 = hand(g, P1, 'PumpR');
  g = toStep(g);
  expectPending(g, 'assignDamage', P0);
  assert.equal(legal(g, P1, 'playCard').length, 0);
  assert.equal(legal(g, P0, 'playCard').length, 0);
  assert.notEqual(validateAction(g, { type: 'playCard', player: P1, obj: r1 }), null);
  assert.notEqual(validateAction(g, { type: 'playCard', player: P0, obj: r0 }), null);
});

test('RJ#7811 Mystic Reversal can take back a spell an opponent took with Mystic Reversal', () => {
  let g = S0();
  addRunes(g, P0, 7, 'calm'); addRunes(g, P1, 7, 'calm');
  const mine = put(g, P0, 'V(3)', 'base'); const theirs = put(g, P1, 'V(3)', 'base');
  const mr0 = hand(g, P0, 'Mystic Reversal'); const mr1 = hand(g, P1, 'Mystic Reversal');
  let zap: ObjId;
  [g, zap] = cast(g, P0, 'ZapA', { targets: [[theirs]] });
  g = pass(g);
  g = play(g, P1, mr1, { targets: [[zap]] });
  g = pass(g); g = pass(g); // P1's Mystic Reversal resolves: P1 now controls Zap and may make new choices
  g = answer(g, { may: [true], targets: [[mine]] }, P1);
  expectPending(g, 'chainResponse', P1);
  assert.equal(g.chain.find(c => c.source === zap)?.controller, P1);
  g = pass(g);
  g = play(g, P0, mr0, { targets: [[zap]] });
  g = pass(g); g = pass(g);
  g = answer(g, { may: [true], targets: [[theirs]] }, P0);
  g = toStep(g);
  assert.equal(g.objects[theirs].damage, 2);
  assert.equal(g.objects[mine].damage, 0);
});

test('RJ#7812 Assault/Shield are static: nothing goes on the chain to react to', () => {
  const s = attackSetup(['Assault(2,2)'], ['Shield(2,2)']);
  const g = s.g;
  assert.equal(g.chain.length, 0);
  assert.equal(mightOf(g, s.atk[0]), 4);
  assert.equal(mightOf(g, s.def[0]), 4);
});

test('RJ#7814 moving into an open battlefield starts a showdown; only Action/Reaction cards can be played in it', () => {
  let g = S0();
  const u = put(g, P0, 'V(2)', 'base');
  const za = hand(g, P0, 'ZapA'); const zm = hand(g, P0, 'ZapM'); const zr = hand(g, P0, 'ZapR');
  g = move(g, P0, [u], BF_A);
  expectPending(g, 'showdownAction', P0);
  assert.equal(g.showdown?.battlefieldIndex, BF_A);
  assert.ok(canPlayNow(g, P0, za)); assert.ok(canPlayNow(g, P0, zr));
  assert.ok(!canPlayNow(g, P0, zm));
});

test('RJ#7815 Deadbloom Predator played to an occupied enemy battlefield: no other unit can be moved in with it', () => {
  let g = S0();
  fundAll(g, P0, 4);
  const e = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const gk = put(g, P0, 'Ganker(2)', BF_B); control(g, BF_B, P0);
  const dp = hand(g, P0, 'Deadbloom Predator');
  assert.ok(playDests(g, P0, dp).includes(BF_A));
  g = play(g, P0, dp, { dest: BF_A });
  // a unit resolves as soon as it is played -> combat at BF-A right away, without the Ganking unit
  expectPending(g, 'showdownAction', P0);
  assert.ok(g.showdown);
  assert.equal(legal(g, P0, 'move').length, 0, 'no standard move during the combat showdown');
  g = toStep(g);
  assert.equal(zone(g, e), 'trash');
  assert.equal(locOf(g, gk), BF_B);
});

test('RJ#7816 Leona, Zealot -8 (min 1) applies after Trifarian War Camp +1 (increases before decreases)', () => {
  const g = S0({ bfA: 'Trifarian War Camp' });
  put(g, P0, 'Leona, Zealot', BF_A);
  const e = put(g, P1, 'V(3)', BF_A, { stunned: true });
  assert.equal(mightOf(g, e), 1);
});

test('RJ#7817 Dragon\'s Rage cannot "move" a unit to its current location', () => {
  let g = S0();
  fundAll(g, P0, 4);
  const e = put(g, P1, 'V(2)', 'base');
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const dr = hand(g, P0, "Dragon's Rage");
  g = play(g, P0, dr, { targets: [[e]] });
  g = toStep(g);
  const d = pend(g);
  assert.equal(d.kind, 'chooseDestination');
  assert.ok(!optionIds(g).includes('base'), 'base is its current location');
  assert.ok(optionIds(g).length > 0);
});

test('RJ#7819 Mask of Foresight: a unit that becomes alone later in the combat does not get +1', () => {
  // alone from the start: +1
  {
    const g0 = S0(); put(g0, P0, 'Mask of Foresight', 'base');
    const d = put(g0, P1, 'V(5)', BF_A); control(g0, BF_A, P1); void d;
    const a = put(g0, P0, 'V(2)', 'base');
    let g = move(g0, P0, [a], BF_A); g = resolveChain(g);
    assert.equal(mightOf(g, a), 3);
  }
  // two attackers, one leaves -> no +1 for the other
  {
    const g0 = S0(); put(g0, P0, 'Mask of Foresight', 'base');
    put(g0, P1, 'V(9)', BF_A); control(g0, BF_A, P1);
    const a = put(g0, P0, 'V(2)', 'base'); const b = put(g0, P0, 'V(2)', 'base');
    const mr = hand(g0, P0, 'MoveR');
    let g = move(g0, P0, [a, b], BF_A); g = resolveChain(g);
    assert.equal(mightOf(g, a), 2);
    g = play(g, P0, mr, { targets: [[b]] }); g = resolveChain(g);
    assert.equal(locOf(g, b), 'base');
    assert.equal(g.chain.length, 0);
    assert.equal(mightOf(g, a), 2);
  }
});

test('RJ#7820 buffing an already-buffed unit does nothing and is not "buffing" (Mistfall); Lee Sin, Ascetic can stack buffs', () => {
  let g = S0();
  fundAll(g, P0, 4);
  put(g, P0, 'Mistfall', 'base');
  const u = put(g, P0, 'V(2)', 'base', { buff: true, ready: false, damage: 1 });
  const pr = hand(g, P0, 'Pit Rookie');
  g = play(g, P0, pr, { targets: [[u]] });
  g = toStep(g);
  assert.equal(g.objects[u].counters.buff, 1);
  assert.ok(!(pend(g).kind === 'optional' && /Mistfall/.test(pend(g).prompt)), 'Mistfall does not trigger');
  assert.equal(g.chain.length, 0);
  // Lee Sin, Ascetic
  let h = S0();
  const ls = put(h, P0, 'Lee Sin, Ascetic', 'base', { buff: true });
  h = act(h, legal(h, P0, 'activate').find(x => x.type === 'activate' && x.obj === ls)!);
  h = toStep(h);
  assert.equal(h.objects[ls].counters.buff, 2);
});

test('RJ#7818 Nocturne, Horrifying played from a Teemo, Strategist reveal enters exhausted', () => {
  let g = S0();
  fundAll(g, P1, 2);
  put(g, P1, 'Teemo, Strategist', BF_A); control(g, BF_A, P1);
  const n = put(g, P1, 'Nocturne, Horrifying', 'deckTop');
  const a = put(g, P0, 'V(3)', 'base');
  g = move(g, P0, [a], BF_A);
  g = toStep(g); g = answer(g, { may: [true] }, P1);
  g = toStep(g); g = answer(g, { may: [true], locations: ['base'] }, P1);
  assert.equal(zone(g, n), 'base');
  assert.equal(g.objects[n].exhausted, true);
});

test('RJ#7822 Zhonya\'s Hourglass played from hidden at one battlefield saves a unit at another battlefield', () => {
  let g = S0();
  fundAll(g, P0, 3); fundAll(g, P1, 3);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const zh = put(g, P0, "Zhonya's Hourglass", { facedown: BF_A });
  const u = put(g, P0, 'V(2)', BF_B); control(g, BF_B, P0);
  g = endTurn(g); g = toMainOf(g, P1);
  const zr = hand(g, P1, 'ZapR');
  g = play(g, P1, zr, { targets: [[u]] });
  g = pass(g);
  expectPending(g, 'chainResponse', P0);
  g = play(g, P0, zh);
  assert.equal(zone(g, zh), 'base', 'gear is played to base');
  g = resolveChain(g); g = toStep(g);
  g = answer(g, { may: [true] }, P0);
  g = toStep(g);
  assert.equal(zone(g, zh), 'trash');
  assert.equal(locOf(g, u), 'base');
  assert.equal(g.objects[u].damage, 0);
});

test('RJ#7824 Deflect applies to effects that select a unit without "choose" (= T137) and is mandatory for spells', () => {
  let g = S0();
  setRunes(g, P0, 1);
  const d = put(g, P1, 'Deflect(3,1)', BF_A); control(g, BF_A, P1);
  const z = hand(g, P0, 'ZapM');
  assert.ok(!legal(g, P0, 'playCard').some(x => x.type === 'playCard' && x.obj === z && JSON.stringify(x).includes(d)), 'cannot skip the tax');
  g = act(g, { type: 'playCard', player: P0, obj: z });
  if (pend(g).kind === 'chooseTargets') assert.ok(!optionIds(g).includes(d), 'unaffordable Deflect target not offered');
});

test('RJ#7824 a triggered ability\'s Deflect cost may be declined; the trigger is then removed (house ruling)', () => {
  let g = S0();
  const d = put(g, P1, 'Deflect(3,1)', BF_A); control(g, BF_A, P1);
  const pd = hand(g, P0, 'PlayDeal2');
  g = act(g, { type: 'playCard', player: P0, obj: pd });
  g = answer(g, { targets: [[d]] }, P0);
  const before = readyRunes(g, P0);
  const p = pend(g);
  assert.ok(p.inStep && (p.kind === 'optional' || p.kind === 'payment'), 'controller is asked whether to pay the Deflect cost');
  g = no(g); g = toStep(g);
  assert.equal(g.objects[d].damage, 0);
  assert.equal(readyRunes(g, P0), before);
});

test('RJ#7825 combat cleanup heals every unit at every location, incl. earlier spell damage', () => {
  let g = S0();
  const o = put(g, P0, 'V(5)', BF_B); control(g, BF_B, P0);
  const e = put(g, P1, 'V(5)', 'base');
  [g] = cast(g, P0, 'ZapA', { targets: [[o]] }); g = resolveChain(g);
  [g] = cast(g, P0, 'ZapA', { targets: [[e]] }); g = resolveChain(g);
  assert.equal(g.objects[o].damage, 2);
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(3)', 'base');
  g = move(g, P0, [a], BF_A); g = toStep(g);
  assert.equal(g.objects[o].damage, 0);
  assert.equal(g.objects[e].damage, 0);
});

test('RJ#7826 a battlefield is conquered only after combat damage; the defender can still respond with focus', () => {
  let { g, atk, def } = attackSetup(['V(3)'], ['V(2)']);
  g = pass(g);
  expectPending(g, 'showdownAction', P1);
  assert.equal(g.battlefields[BF_A].controller, P1);
  [g] = cast(g, P1, 'ZapA', { targets: [[atk[0]]] });
  g = toStep(g);
  assert.equal(zone(g, atk[0]), 'trash');
  assert.equal(zone(g, def[0]), 'trash');
  assert.notEqual(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[0].points, 0);
});

test('RJ#7827 unit tokens are played exhausted unless stated otherwise', () => {
  let g = S0();
  fundAll(g, P0, 2);
  [g] = cast(g, P0, 'Recruit the Vanguard'); g = resolveChain(g);
  g = answer(g, { locations: ['base', 'base', 'base', 'base'] }, P0);
  const toks = g.players[0].base.filter(id => g.objects[id].isToken);
  assert.equal(toks.length, 4);
  for (const t of toks) assert.equal(g.objects[t].exhausted, true);
});

test('RJ#7828 Tryndamere, Barbarian does not trigger on a hold (needs a conquer after an attack)', () => {
  let g = S0({ tp: P1 });
  put(g, P0, 'Tryndamere, Barbarian', BF_A); control(g, BF_A, P0);
  g = endTurn(g, P1); g = toStep(g);
  expectPending(g, 'mainAction', P0);
  assert.equal(g.players[0].points, 1, 'hold only, no bonus point');
});

test('RJ#7821 Teemo, Strategist returned by Gust in response: the reveal still happens, no damage (nothing "here")', () => {
  let g = S0();
  fundAll(g, P0, 2);
  const t = put(g, P1, 'Teemo, Strategist', BF_A); control(g, BF_A, P1);
  for (let i = 0; i < 3; i++) put(g, P1, 'HidU(1)', 'deckTop');
  const a = put(g, P0, 'V(5)', 'base');
  const gu = hand(g, P0, 'Gust');
  g = move(g, P0, [a], BF_A);
  expectPending(g, 'chainResponse', P1);
  g = pass(g);
  g = play(g, P0, gu, { targets: [[t]] });
  g = toStep(g);
  assert.equal(zone(g, t), 'hand');
  assert.ok(g.log.some(l => /Revealed/.test(l.text)), 'top 5 revealed');
  assert.equal(g.objects[a].damage, 0);
});

test('RJ#7830 two copies of the same champion can be on the board', () => {
  let g = S0();
  put(g, P0, 'Vi, Destructive', 'base');
  const v2 = hand(g, P0, 'Vi, Destructive');
  assert.ok(canPlayNow(g, P0, v2));
  g = play(g, P0, v2, { dest: 'base' }); g = toStep(g);
  assert.equal(g.players[0].base.filter(id => g.cards[g.objects[id].cardId].name === 'Vi').length, 2);
});

test('RJ#7832 a Showstopper-moved unit recalled after combat keeps its ready state', () => {
  let g = S0();
  fundAll(g, P0, 3);
  const d = put(g, P1, 'V(5)', BF_A, { stunned: true }); control(g, BF_A, P1);
  const u = put(g, P0, 'V(2)', 'base');
  const ss = hand(g, P0, 'Showstopper');
  g = play(g, P0, ss, { targets: [[u]], battlefields: [BF_A], locations: [BF_A] });
  g = toStep(g); g = answer(g, { battlefields: [BF_A], locations: [BF_A] }); g = toStep(g);
  assert.equal(g.objects[d].damage, 0, 'healed after combat');
  assert.equal(zone(g, d), 'battlefield');
  assert.equal(locOf(g, u), 'base', 'recalled');
  assert.equal(g.objects[u].exhausted, false, 'recall does not exhaust');
});

test('RJ#7834 Traveling Merchant moved by Charm triggers "when I move"; being recalled does not', () => {
  let g = S0();
  fundAll(g, P0, 2);
  const m = put(g, P1, 'Traveling Merchant', BF_A); control(g, BF_A, P1);
  const c1 = hand(g, P1, 'V(1)');
  const ch = hand(g, P0, 'Charm');
  g = play(g, P0, ch, { targets: [[m]] });
  g = toStep(g); g = answer(g, { locations: [BF_B] }); g = toStep(g);
  assert.equal(locOf(g, m), BF_B);
  g = answer(g, { cards: [[c1]] }, P1); g = toStep(g);
  assert.equal(zone(g, c1), 'trash', 'discarded 1');
  assert.equal(g.players[1].hand.length, 1, 'then drew 1');
  // recall after combat: no trigger
  let h = S0();
  put(h, P1, 'V(5)', BF_A, { stunned: true }); control(h, BF_A, P1);
  const m2 = put(h, P0, 'Traveling Merchant', 'base');
  const c2 = hand(h, P0, 'V(1)');
  h = move(h, P0, [m2], BF_A);
  h = answer(h, { cards: [[c2]] }, P0); h = toStep(h);
  const handAfterMove = h.players[0].hand.length;
  assert.equal(locOf(h, m2), 'base', 'recalled');
  assert.equal(h.players[0].hand.length, handAfterMove);
  assert.ok(!(h.pending?.inStep), 'no discard prompt from the recall');
});

test('RJ#7836 Cithria of Cloudfield\'s trigger goes on the chain even while she is already buffed', () => {
  let g = S0();
  fundAll(g, P0, 2);
  const c = put(g, P0, 'Cithria of Cloudfield', 'base', { buff: true });
  const v = hand(g, P0, 'V(1)');
  g = play(g, P0, v, { dest: 'base' });
  assert.equal(g.chain.length, 1, 'trigger on the chain');
  g = pass(g);
  expectPending(g, 'chainResponse', P1, 'opponent can respond');
  g = toStep(g);
  assert.equal(g.objects[c].counters.buff, 1);
});

test('RJ#7838 a player can play several Reactions in a row before passing', () => {
  let { g, def } = attackSetup(['V(3)'], ['V(4)']);
  fundAll(g, P1, 3);
  const s1 = hand(g, P1, 'Stupefy'); const s2 = hand(g, P1, 'Stupefy');
  g = pass(g);
  expectPending(g, 'showdownAction', P1);
  g = play(g, P1, s1, { targets: [[def[0]]] });
  expectPending(g, 'chainResponse', P1, 'keeps priority after playing');
  g = play(g, P1, s2, { targets: [[def[0]]] });
  assert.equal(g.chain.length, 2);
});

test('RJ#7840 (analogue, Noxian Drummer) a "here" token trigger does nothing if the source left the board before it resolves', () => {
  let g = S0();
  fundAll(g, P1, 2);
  const dr = put(g, P0, 'Noxian Drummer', 'base');
  const gu = hand(g, P1, 'Gust');
  g = move(g, P0, [dr], BF_B);
  assert.equal(g.chain.length, 1);
  g = pass(g);
  g = play(g, P1, gu, { targets: [[dr]] });
  g = toStep(g);
  assert.equal(zone(g, dr), 'hand');
  const toks = Object.values(g.objects).filter(o => o.isToken && (o.zone === 'battlefield' || o.zone === 'base'));
  assert.equal(toks.length, 0);
});

test('RJ#7842 a spell with no legal target cannot be played', () => {
  const g = S0();
  const z = hand(g, P0, 'ZapA');
  assert.ok(!canPlayNow(g, P0, z));
  put(g, P1, 'V(2)', 'base');
  assert.ok(canPlayNow(g, P0, z));
});

test('RJ#7843 Relentless Pursuit into the opponent\'s open-battlefield showdown: combat with them attacking, winner conquers', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0, 2);
  const a = put(g, P1, 'V(2)', 'base');
  const d = put(g, P0, 'V(3)', 'base');
  const rp = hand(g, P0, 'Relentless Pursuit');
  g = move(g, P1, [a], BF_A);
  g = pass(g);
  g = play(g, P0, rp, { targets: [[d]], locations: [BF_A] });   // R-2: destination chosen as played
  g = toStep(g); 
  assert.ok(g.showdown?.isCombat);
  assert.equal(g.showdown!.attacker, P1); assert.equal(g.showdown!.defender, P0);
  g = toStep(g); g = answer(g, { may: [false] }); g = toStep(g);
  assert.equal(g.players[1].points, 0, 'no point from the first showdown');
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[0].points, 1);
});

test('RJ#7844 a unit played from hidden resolves at once; its play trigger goes on the chain with the turn player first', () => {
  let g = S0();
  fundAll(g, P0, 1);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const t = put(g, P0, 'Teemo, Scout', { facedown: BF_A });
  g = play(g, P0, t, { dest: BF_A });
  assert.equal(zone(g, t), 'battlefield');
  assert.equal(g.chain.length, 1);
  expectPending(g, 'chainResponse', P0);
  // no play trigger -> no window
  let h = S0();
  put(h, P0, 'V(1)', BF_A); control(h, BF_A, P0);
  const hu = put(h, P0, 'HidU(2)', { facedown: BF_A });
  h = play(h, P0, hu, { dest: BF_A });
  assert.equal(h.chain.length, 0);
  expectPending(h, 'mainAction', P0);
});

test('RJ#7845 Nocturne revealed by Ravenbloom Conservatory can be played, to that battlefield', () => {
  let g = S0({ bfA: 'Ravenbloom Conservatory' });
  fundAll(g, P1, 1);
  put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const n = put(g, P1, 'Nocturne, Horrifying', 'deckTop');
  const a = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [a], BF_A);
  g = toStep(g); g = answer(g, { may: [true] }, P1);
  g = toStep(g); g = answer(g, { may: [true] }, P1);
  expectPending(g, 'chooseDestination', P1);
  assert.ok(optionIds(g).includes(String(BF_A)));
  g = answer(g, { locations: [BF_A] }, P1);
  assert.equal(locOf(g, n), BF_A);
});

test('RJ#7846 Darius, Trifarian: second card kills Mageseeker Warden -> Darius still readies (+2)', () => {
  let g = S0();
  fundAll(g, P0, 3);
  const mw = put(g, P1, 'Mageseeker Warden', BF_A); control(g, BF_A, P1);
  const dz = put(g, P0, 'Darius, Trifarian', 'base', { ready: false });
  [g] = cast(g, P0, 'V(1)', { dest: 'base' }); g = toStep(g);
  [g] = cast(g, P0, 'KillA', { targets: [[mw]] });
  g = toStep(g);
  assert.equal(zone(g, mw), 'trash');
  assert.equal(mightOf(g, dz), 7);
  assert.equal(g.objects[dz].exhausted, false);
});

test('RJ#7847 Darius, Trifarian counts himself as the second card played', () => {
  let g = S0();
  fundAll(g, P0, 3);
  [g] = cast(g, P0, 'V(1)', { dest: 'base' }); g = toStep(g);
  let dz: ObjId;
  [g, dz] = cast(g, P0, 'Darius, Trifarian', { dest: 'base' }); g = toStep(g);
  assert.equal(mightOf(g, dz), 7);
  assert.equal(g.objects[dz].exhausted, false);
});

test('RJ#7848 attacker leaves the combat with Ride the Wind: the combat still ends with a combat cleanup that heals units', () => {
  let g = S0();
  fundAll(g, P0, 3);
  const d = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(3)', 'base');
  const rtw = hand(g, P0, 'Ride the Wind');
  g = move(g, P0, [a], BF_A);
  [g] = cast(g, P0, 'ZapA', { targets: [[d]] });
  g = resolveChain(g);
  assert.equal(g.objects[d].damage, 2);
  expectPending(g, 'showdownAction', P1); g = pass(g);
  g = play(g, P0, rtw, { targets: [[a]] });
  g = toStep(g); g = answer(g, { locations: ['base'] }); g = toStep(g);
  assert.equal(locOf(g, a), 'base');
  assert.equal(g.showdown, null);
  assert.equal(g.objects[d].damage, 0, 'healed in the combat cleanup');
  assert.equal(g.battlefields[BF_A].controller, P1);
});

test('RJ#7849 a player can conquer (score) during the opponent\'s turn after being moved in by their Charm', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P1, 2);
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const u = put(g, P0, 'V(3)', 'base');
  const ch = hand(g, P1, 'Charm');
  g = play(g, P1, ch, { targets: [[u]] });
  g = toStep(g); g = answer(g, { locations: [BF_A] }); g = toStep(g);
  assert.equal(g.activePlayer, P1);
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[0].points, 1);
});

test('RJ#7851 Sett, Kingpin gets +1 per buffed friendly unit at his battlefield while attacking too', () => {
  const g0 = S0();
  put(g0, P1, 'V(9)', BF_A); control(g0, BF_A, P1);
  const s = put(g0, P0, 'Sett, Kingpin', 'base');
  const b = put(g0, P0, 'V(1)', 'base', { buff: true });
  assert.equal(mightOf(g0, s), 5, 'not at a battlefield');
  const g = move(g0, P0, [s, b], BF_A);
  assert.equal(mightOf(g, s), 6);
});

test('RJ#7852 no priority window when the opponent ends their turn', () => {
  let g = S0();
  fundAll(g, P1, 2);
  hand(g, P1, 'ZapR');
  put(g, P0, 'V(2)', 'base');
  g = endTurn(g, P0);
  expectPending(g, 'mainAction', P1);
  assert.equal(g.activePlayer, P1);
});

test('RJ#7855 Volibear, Furious: "any number of enemy units" may be zero, so the Deflect tax can be avoided', () => {
  let g = S0();
  put(g, P1, 'Deflect(3,1)', BF_A); control(g, BF_A, P1);
  const v = put(g, P0, 'Volibear, Furious', 'base');
  const before = readyRunes(g, P0) + g.players[0].runeDeck.length;
  g = move(g, P0, [v], BF_A);
  const p = pend(g);
  assert.ok(p.inStep && p.kind === 'chooseTargets', 'P0 chooses the split recipients (zero allowed)');
  g = act(g, { type: 'choose', player: P0, optionIds: [] });
  assert.equal(readyRunes(g, P0) + g.players[0].runeDeck.length, before, 'no Deflect tax paid');
});

test('RJ#7856 holding a battlefield does not trigger its "When you conquer here"', () => {
  let g = S0({ tp: P1, bfA: 'Ruined Monastery' });
  put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  hand(g, P0, 'V(1)');
  g = endTurn(g, P1); g = toStep(g);
  expectPending(g, 'mainAction', P0);
  assert.equal(g.players[0].points, 1);
  assert.ok(!g.log.some(l => /Monastery|discard/i.test(l.text) && /Trigger|Resolving/.test(l.text)));
});

test('RJ#7857 Thousand-Tailed Watcher -3 (min 1) on a 2-Might unit with a +1 buff leaves it at 1', () => {
  let g = S0();
  fundAll(g, P0, 3); addRunes(g, P0, 4, 'mind');
  const e = put(g, P1, 'V(2)', 'base', { buff: true });
  assert.equal(mightOf(g, e), 3);
  [g] = cast(g, P0, 'Thousand-Tailed Watcher', { dest: 'base', may: [false] }); g = toStep(g);
  assert.equal(mightOf(g, e), 1);
});

test('RJ#7859 The Boss saves an exhausted buffed unit at base dying to a spell (no showdown needed)', () => {
  let g = S0();
  legend(g, P0, 'The Boss'); addRunes(g, P0, 1, 'body');
  const u = put(g, P0, 'V(2)', 'base', { buff: true, ready: false, damage: 1 });
  [g] = cast(g, P0, 'ZapA', { targets: [[u]] });
  g = toStep(g);
  assert.match(pend(g).prompt, /Boss/);
  g = yes(g); g = toStep(g);
  assert.equal(locOf(g, u), 'base');
  assert.equal(g.objects[u].damage, 0);
});

test('RJ#7861 "this turn" Might effects (Grand Strategem) affect only units on the board when they resolve', () => {
  let g = S0();
  fundAll(g, P0, 3);
  const a = put(g, P0, 'V(2)', 'base');
  [g] = cast(g, P0, 'Grand Strategem'); g = toStep(g);
  assert.equal(mightOf(g, a), 7);
  let b: ObjId;
  [g, b] = cast(g, P0, 'V(1)', { dest: 'base' }); g = toStep(g);
  assert.equal(mightOf(g, b), 1);
});

test('RJ#7862 Fortified Position: "you" on an uncontrolled battlefield -> no trigger for a surprise defender', () => {
  let g = S0({ tp: P1, bfA: 'Fortified Position' });
  fundAll(g, P0, 2);
  const a = put(g, P1, 'V(2)', 'base');
  const d = put(g, P0, 'V(3)', 'base');
  const rp = hand(g, P0, 'Relentless Pursuit');
  g = move(g, P1, [a], BF_A);
  g = pass(g);
  g = play(g, P0, rp, { targets: [[d]], locations: [BF_A] });   // R-2: destination chosen as played
  for (let i = 0; i < 10 && g.chain.length && !pend(g).inStep; i++) g = pass(g);   // resolve it only
  assert.ok(g.showdown?.isCombat);
  assert.equal(g.battlefields[BF_A].controller, null);
  // SCRIPT-FIX: the battlefield's own name appears in move/showdown log lines; look for the trigger itself
  assert.ok(!g.log.some(l => /Trigger: Fortified|Shield 2/.test(l.text)), 'no Fortified Position trigger');
  assert.ok(!hasKeyword(g, d, 'Shield'));
});

test('RJ#7863 a combat showdown does not end just because one side has no units left', () => {
  let { g, atk } = attackSetup(['V(2)'], ['V(5)']);
  g = pass(g);
  [g] = cast(g, P1, 'ZapA', { targets: [[atk[0]]] });
  g = resolveChain(g);
  assert.equal(zone(g, atk[0]), 'trash');
  assert.ok(g.showdown, 'showdown still in progress');
  assert.equal(pend(g).kind, 'showdownAction');
});

test('RJ#7864 6 damage, then -4 Might on a 9-Might unit: it dies', () => {
  let g = S0();
  const u = put(g, P1, 'V(9)', BF_A, { damage: 6 }); control(g, BF_A, P1);
  mod(g, u, { might: -4 });
  [g] = cast(g, P0, 'DrawR'); g = toStep(g);
  assert.equal(zone(g, u), 'trash');
});

test('RJ#7865 Cleave (Assault 3) on a unit moved to an open battlefield: no attacker, no bonus', () => {
  let g = S0();
  fundAll(g, P0, 2);
  const u = put(g, P0, 'V(2)', 'base');
  [g] = cast(g, P0, 'Cleave', { targets: [[u]] }); g = toStep(g);
  g = move(g, P0, [u], BF_A);
  assert.ok(g.showdown && !g.showdown.isCombat);
  assert.equal(mightOf(g, u), 2);
});

test('RJ#7866 no draw for being unable to channel runes (empty rune deck)', () => {
  let g = S0({ tp: P1, runeDeck: [0, 6] });
  const h0 = g.players[0].hand.length;
  g = endTurn(g, P1); g = toStep(g);
  expectPending(g, 'mainAction', P0);
  assert.equal(g.players[0].hand.length, h0 + 1, 'only the Draw Phase draw');
});

test('RJ#7867 Rebuke (Action) cannot respond to Yasuo, Remorseful\'s attack trigger', () => {
  let g = S0();
  fundAll(g, P1, 2);
  put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const y = put(g, P0, 'Yasuo, Remorseful', 'base');
  const rb = hand(g, P1, 'Rebuke');
  g = move(g, P0, [y], BF_A);
  assert.ok(g.chain.length >= 1);
  g = pass(g);
  expectPending(g, 'chainResponse', P1);
  assert.ok(!canPlayNow(g, P1, rb));
});

test('RJ#7869 a 4-Might unit played next to Darius, Executioner is never "becoming Mighty" (Grand Duelist does not trigger) (house ruling)', () => {
  let g = S0();
  legend(g, P0, 'Grand Duelist');
  put(g, P0, 'Darius, Executioner', 'base');
  let u: ObjId;
  [g, u] = cast(g, P0, 'V(4)', { dest: 'base' });
  assert.equal(mightOf(g, u), 5);
  assert.ok(!(pend(g).kind === 'optional' && /channel|Duelist/i.test(pend(g).prompt)), 'no Grand Duelist prompt');
  assert.equal(g.chain.length, 0);
});

test('RJ#7870 Ravenbloom Student\'s "when you play a spell" is a normal trigger on the chain', () => {
  let g = S0();
  fundAll(g, P1, 2);
  const st = put(g, P1, 'Ravenbloom Student', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'ZapA', { targets: [[st]] });
  g = pass(g);
  const sp = hand(g, P1, 'Stupefy');
  g = play(g, P1, sp, { targets: [[st]] });
  const log = new EventLog();
  let sawTrigger = false;
  for (let i = 0; i < 20 && g.chain.length; i++) {
    if (g.chain.some(c => c.source === st)) sawTrigger = true;
    if (pend(g).inStep) break;
    g = log.pass(g);
  }
  assert.ok(sawTrigger, 'Student trigger went on the chain');
});

test('RJ#7871 discarding Scrapheap to Traveling Merchant draws 2 in total', () => {
  let g = S0();
  const m = put(g, P0, 'Traveling Merchant', 'base');
  const sh = hand(g, P0, 'Scrapheap');
  const h0 = g.players[0].hand.length;
  g = move(g, P0, [m], BF_A);
  g = answer(g, { cards: [[sh]] }, P0); g = toStep(g);
  assert.equal(zone(g, sh), 'trash');
  assert.equal(g.players[0].hand.length, h0 - 1 + 2);
});

test('RJ#7872 a unit reduced to 0 Might (Frigid Touch) with no damage does not die', () => {
  let g = S0();
  fundAll(g, P0, 2);
  const e = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const ft = hand(g, P0, 'Frigid Touch');
  g = play(g, P0, ft, { targets: [[e]], may: [false] }); g = toStep(g);
  if (pend(g).inStep) { g = answer(g, { may: [false] }); g = toStep(g); }
  assert.equal(mightOf(g, e), 0);
  assert.equal(zone(g, e), 'battlefield');
});

test('RJ#7874 Switcheroo as the second card: the swap resolves, then Darius, Trifarian gets +2 (ends at 9)', () => {
  let g = S0();
  fundAll(g, P0, 3);
  [g] = cast(g, P0, 'V(1)', { dest: 'base' }); g = toStep(g);
  const e = put(g, P1, 'V(7)', BF_A); control(g, BF_A, P1);
  const dz = put(g, P0, 'Darius, Trifarian', 'base');
  g = move(g, P0, [dz], BF_A);
  expectPending(g, 'showdownAction', P0);
  const sw = hand(g, P0, 'Switcheroo');
  g = play(g, P0, sw, { targets: [[dz, e]] });
  for (let i = 0; i < 10 && g.chain.length; i++) { if (pend(g).inStep) break; g = pass(g); }
  assert.equal(mightOf(g, dz), 9);
  assert.equal(mightOf(g, e), 5);
});

test('RJ#7875 Deflect gained after being targeted (Fiora, Victorious made Mighty in response) adds no tax', () => {
  let g = S0();
  fundAll(g, P0, 3); fundAll(g, P1, 1);
  const f = put(g, P1, 'Fiora, Victorious', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'Void Seeker', { targets: [[f]] });
  const r0 = readyRunes(g, P0); const rd0 = g.players[0].runeDeck.length;
  g = pass(g);
  [g] = cast(g, P1, 'PumpR', { targets: [[f]] });
  g = pass(g); g = pass(g);
  assert.equal(g.chain.length, 1, 'PumpR resolved, Void Seeker still on the chain');
  assert.ok(hasKeyword(g, f, 'Deflect'));
  g = toStep(g);
  assert.equal(readyRunes(g, P0), r0); assert.equal(g.players[0].runeDeck.length, rd0);
  assert.equal(g.objects[f].damage > 0 || zone(g, f) === 'trash', true, 'Void Seeker still resolved');
});

test('RJ#7877 Vilemaw\'s Lair does not stop the post-combat recall (recall is not a move)', () => {
  let { g, atk } = attackSetup(['V(2)'], ['V(5)'], { bfA: "Vilemaw's Lair", defOpts: [{ stunned: true }] });
  g = toStep(g);
  assert.equal(locOf(g, atk[0]), 'base');
});

test('RJ#7878 spending a buff removes its +1 Might whatever the other modifiers', () => {
  let g = S0();
  const s = put(g, P0, 'Sett, Brawler', 'base', { buff: true });
  mod(g, s, { might: -3 });
  assert.equal(mightOf(g, s), 2);
  g = act(g, legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === s)!);
  g = toStep(g);
  assert.equal(g.objects[s].counters.buff ?? 0, 0);
  assert.equal(mightOf(g, s), 5, '4 - 3 + 4 (buff gone)');
});

test('RJ#7879 after one chain item resolves, players may add new Reactions before the next item resolves', () => {
  let g = S0();
  fundAll(g, P1, 2);
  const u = put(g, P1, 'V(5)', 'base');
  [g] = cast(g, P0, 'ZapA', { targets: [[u]] });
  g = pass(g);
  [g] = cast(g, P1, 'DrawR');
  g = pass(g); g = pass(g); // DrawR resolves
  assert.equal(g.chain.length, 1);
  const p = pend(g);
  assert.equal(p.kind, 'chainResponse');
  const mr = hand(g, P1, 'MoveR'); void mr;
  const zr = hand(g, P1, 'ZapR');
  if (p.player === P0) g = pass(g);
  assert.ok(canPlayNow(g, P1, zr), 'P1 can respond again before ZapA resolves');
});

test('RJ#7882 moving a unit to a battlefield you already control starts no showdown (no Action window for the opponent)', () => {
  let g = S0();
  put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_A);
  assert.equal(g.showdown, null);
  expectPending(g, 'mainAction', P0);
});

test('RJ#7883 Sett, Brawler\'s "spend my buff" is base speed: not usable in a showdown or on the chain', () => {
  let { g, atk } = attackSetup(['Sett, Brawler'], ['V(9)'], { atkOpts: [{ buff: true }] });
  expectPending(g, 'showdownAction', P0);
  assert.equal(legal(g, P0, 'activate').filter(x => x.type === 'activate' && x.obj === atk[0]).length, 0);
  let h = S0();
  const s = put(h, P0, 'Sett, Brawler', 'base', { buff: true });
  [h] = cast(h, P0, 'DrawR');
  assert.equal(legal(h, P0, 'activate').filter(x => x.type === 'activate' && x.obj === s).length, 0, 'not while a chain exists');
});

test('RJ#7884 Darius, Trifarian played as the third card does not trigger', () => {
  let g = S0();
  fundAll(g, P0, 3);
  [g] = cast(g, P0, 'V(1)', { dest: 'base' }); g = toStep(g);
  [g] = cast(g, P0, 'V(1)', { dest: 'base' }); g = toStep(g);
  let dz: ObjId;
  [g, dz] = cast(g, P0, 'Darius, Trifarian', { dest: 'base' }); g = toStep(g);
  assert.equal(mightOf(g, dz), 5);
  assert.equal(g.objects[dz].exhausted, true);
});

test('RJ#7886 responding to Dragon\'s Rage by moving the other enemy unit away: no damage is exchanged', () => {
  let g = S0();
  fundAll(g, P0, 4); fundAll(g, P1, 1);
  const x = put(g, P1, 'V(3)', 'base');
  const y = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const dr = hand(g, P0, "Dragon's Rage");
  g = play(g, P0, dr, { targets: [[x]], locations: [BF_A] });   // R-2: destination chosen as played
  g = pass(g);
  [g] = cast(g, P1, 'MoveR', { targets: [[y]] });
  g = toStep(g);
  g = toStep(g);
  assert.equal(locOf(g, y), 'base');
  assert.equal(locOf(g, x), BF_A);
  assert.equal(g.objects[x].damage, 0); assert.equal(g.objects[y].damage, 0);
});

test('RJ#7888 Reaver\'s Row trigger cannot choose a facedown (hidden) unit', () => {
  let g = S0({ bfA: "Reaver's Row" });
  const d = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const hid = put(g, P1, 'HidU(2)', { facedown: BF_A });
  const a = put(g, P0, 'V(5)', 'base');
  g = move(g, P0, [a], BF_A);
  // P1's "When you defend here" optional/targets
  for (let i = 0; i < 5 && pend(g).player === P1 && pend(g).inStep && pend(g).kind === 'optional'; i++) g = yes(g);
  const p = pend(g);
  if (p.kind === 'chooseTargets') {
    assert.ok(!optionIds(g).includes(hid), 'facedown card is not a legal choice');
    assert.ok(optionIds(g).includes(d));
  } else {
    assert.ok(g.chain.length > 0 || g.log.some(l => /Reaver/.test(l.text)));
    assert.ok(!g.chain.some(c => JSON.stringify(c).includes(hid)));
  }
});

test('RJ#7891 Portal Rescue "ignoring its cost" still allows paying the optional Accelerate cost', () => {
  let g = S0();
  fundAll(g, P0, 2); addRunes(g, P0, 2, 'mind');
  const w = put(g, P0, 'Thousand-Tailed Watcher', 'base', { ready: false });
  [g] = cast(g, P0, 'Portal Rescue', { targets: [[w]] });
  g = toStep(g);
  const p = pend(g);
  assert.ok(p.kind === 'optional' && /Accelerate/.test(p.prompt), 'Accelerate offered');
  g = yes(g); g = toStep(g);
  const nw = g.players[0].base.find(id => g.objects[id].cardId === cid('Thousand-Tailed Watcher'))!;
  assert.ok(nw);
  assert.equal(g.objects[nw].exhausted, false);
});

test('RJ#7892 showdown focus: the opening trigger chain keeps focus with the attacker; a later card chain passes it', () => {
  let g = S0();
  put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const y = put(g, P0, 'Yasuo, Remorseful', 'base');
  put(g, P1, 'V(4)', 'base');
  g = move(g, P0, [y], BF_A);
  g = resolveChain(g);
  expectPending(g, 'showdownAction', P0, 'attacker keeps focus after the trigger chain');
  const e2 = put(g, P1, 'V(5)', 'base');
  [g] = cast(g, P0, 'ZapA', { targets: [[e2]] });
  g = resolveChain(g);
  expectPending(g, 'showdownAction', P1, 'focus passes after a played card\'s chain');
});

test('RJ#7893 Possession on Akshan, Mischievous: Akshan never leaves the board, so the stolen gear stays with its previous controller', () => {
  let g = S0();
  fundAll(g, P0, 4);
  const sh = put(g, P1, 'Scrapheap', 'base');
  const ak = hand(g, P0, 'Akshan, Mischievous');
  g = act(g, { type: 'playCard', player: P0, obj: ak, destination: 'base' });
  for (let i = 0; i < 10 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'optional') g = yes(g);
    else if (d.kind === 'chooseTargets') g = choose(g, sh);
    else if (d.inStep) g = choose(g, d.options![0].id);
    else g = pass(g);
  }
  assert.equal(g.objects[sh].controller, P0);
  // move Akshan to BF-A (setup), then P1 takes him with Possession
  g.players[0].base = g.players[0].base.filter(x => x !== ak);
  g.objects[ak].zone = 'battlefield'; g.objects[ak].battlefieldIndex = BF_A; control(g, BF_A, P0);
  g = endTurn(g, P0); g = toStep(g);
  expectPending(g, 'mainAction', P1);
  fundAll(g, P1, 4); addRunes(g, P1, 4, 'chaos');
  [g] = cast(g, P1, 'Possession', { targets: [[ak]] });
  g = toStep(g);
  assert.equal(g.objects[ak].controller, P1);
  assert.equal(g.objects[sh].controller, P0, 'P0 keeps the gear');
});

test('RJ#7897 Volibear, Furious attacks Ahri, Inquisitive: Ahri\'s defend trigger resolves first, then Volibear\'s damage kills her', () => {
  let g = S0();
  const ah = put(g, P1, 'Ahri, Inquisitive', BF_A); control(g, BF_A, P1);
  const v = put(g, P0, 'Volibear, Furious', 'base');
  g = move(g, P0, [v], BF_A);
  for (let i = 0; i < 6 && pend(g).inStep; i++) g = choose(g, optionIds(g)[0]);
  assert.equal(g.chain.length, 2);
  assert.equal(g.chain[g.chain.length - 1].source, ah, 'defender trigger on top');
  g = resolveChain(g);
  assert.equal(mightOf(g, v), 7);
  assert.equal(zone(g, ah), 'trash');
});

test('RJ#7898 Mask of Foresight (defender) resolves before Yasuo, Remorseful\'s attack damage', () => {
  let g = S0();
  put(g, P1, 'Mask of Foresight', 'base');
  const d = put(g, P1, 'V(6)', BF_A); control(g, BF_A, P1);
  const y = put(g, P0, 'Yasuo, Remorseful', 'base');
  g = move(g, P0, [y], BF_A);
  for (let i = 0; i < 6 && pend(g).inStep; i++) g = choose(g, optionIds(g)[0]);
  g = resolveChain(g);
  assert.equal(g.objects[d].damage, 6);
  assert.equal(zone(g, d), 'battlefield', '7 Might when the 6 damage arrives');
});

test('RJ#7900 Temporary is a trigger at the start of the Beginning Phase: players can respond before the permanent leaves', () => {
  let g = S0({ tp: P1 });
  const t = put(g, P0, 'Temp(2)', 'base');
  g = endTurn(g, P1);
  assert.ok(g.chain.length >= 1, 'Temporary trigger on the chain');
  assert.equal(pend(g).kind, 'chainResponse');
  assert.equal(zone(g, t), 'base', 'still there while the trigger waits');
  g = resolveChain(g); g = toStep(g);
  assert.equal(zone(g, t), 'trash');
});

test('RJ#7904 Svellsongur copies only printed text, not Cleave\'s granted Assault 3', () => {
  let g = S0();
  fundAll(g, P0, 3);
  const u = put(g, P0, 'V(2)', 'base');
  const sv = put(g, P0, 'Svellsongur', 'base');
  [g] = cast(g, P0, 'Cleave', { targets: [[u]] }); g = toStep(g);
  assert.equal(kwv(g, u, 'Assault'), 3);
  const eq = legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === sv)!;
  assert.ok(eq);
  g = act(g, eq); g = answer(g, { targets: [[u]] }); g = toStep(g);
  assert.equal(g.objects[sv].attachedTo, u);
  assert.equal(kwv(g, u, 'Assault'), 3, 'not doubled');
});

test('RJ#7905 Kog\'Maw, Caustic dying at base: bases are not battlefields, no damage there', () => {
  let g = S0();
  const k = put(g, P0, "Kog'Maw, Caustic", 'base');
  const o = put(g, P0, 'V(5)', 'base');
  const e = put(g, P1, 'V(5)', 'base');
  [g] = cast(g, P0, 'ZapA', { targets: [[k]] }); g = toStep(g);
  assert.equal(zone(g, k), 'trash');
  assert.equal(g.objects[o].damage, 0); assert.equal(g.objects[e].damage, 0);
});

test('RJ#7907 Tideturner played from hidden can swap with a unit at another battlefield (card text overrides 811.1.d)', () => {
  let g = S0();
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const far = put(g, P0, 'V(3)', BF_B); control(g, BF_B, P0);
  const tt = put(g, P0, 'Tideturner', { facedown: BF_A });
  g = play(g, P0, tt, { dest: BF_A });
  g = answer(g, { may: [true], targets: [[far]] }, P0);
  g = toStep(g); g = answer(g, { may: [true], targets: [[far]] }, P0); g = toStep(g);
  assert.equal(locOf(g, tt), BF_B);
  assert.equal(locOf(g, far), BF_A);
});

test('RJ#7910 Dragon\'s Rage paid with a Deflect tax can still be Defied (Defy checks the card\'s cost)', () => {
  let g = S0();
  fundAll(g, P0, 4); fundAll(g, P1, 2);
  const x = put(g, P1, 'Deflect(3,1)', 'base');
  put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const dr = hand(g, P0, "Dragon's Rage");
  g = play(g, P0, dr, { targets: [[x]], locations: [BF_A] });   // R-2: destination chosen as played
  g = pass(g);
  const df = hand(g, P1, 'Defy');
  assert.ok(canPlayNow(g, P1, df));
  g = play(g, P1, df, { targets: [[g.chain[0].id]] });
  g = resolveChain(g);
  assert.equal(zone(g, dr), 'trash');
  assert.equal(locOf(g, x), 'base', 'Dragon\'s Rage was countered');
});

test('RJ#7909 playing a unit/gear gives no response window; only its play trigger can be responded to (after it is on the board)', () => {
  let g = S0();
  fundAll(g, P0, 3);
  let v: ObjId;
  [g, v] = cast(g, P0, 'V(1)', { dest: 'base' });
  assert.equal(zone(g, v), 'base'); assert.equal(g.chain.length, 0);
  expectPending(g, 'mainAction', P0);
  let s: ObjId;
  [g, s] = cast(g, P0, 'Sword');
  assert.equal(zone(g, s), 'base'); assert.equal(g.chain.length, 0);
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  let r: ObjId;
  [g, r] = cast(g, P0, 'Riptide Rex', { dest: 'base' });
  assert.equal(zone(g, r), 'base', 'Rex already on the board');
  assert.equal(g.chain.length, 1, 'its play trigger is on the chain');
});

test('RJ#7913 Dazzling Aurora stops at the first unit revealed (Nocturne), and does not keep revealing', () => {
  let g = S0();
  fundAll(g, P0, 1);
  put(g, P0, 'Dazzling Aurora', 'base');
  const n = put(g, P0, 'Nocturne, Horrifying', 'deckTop');
  const z = put(g, P0, 'ZapA', 'deckTop');
  const deck0 = g.players[0].mainDeck.length;
  g = endTurn(g, P0);
  for (let i = 0; i < 12 && g.pending && g.activePlayer === P0; i++) {
    const d = pend(g);
    if (d.inStep) g = d.kind === 'optional' ? no(g) : choose(g, optionIds(g)[0]); else if (d.kind === 'mainAction') break; else g = pass(g);
  }
  assert.ok(['base', 'battlefield'].includes(zone(g, n)), 'Nocturne played');
  assert.equal(zone(g, z), 'mainDeck', 'ZapA recycled');
  assert.equal(g.players[0].mainDeck[g.players[0].mainDeck.length - 1], z, 'recycled to the bottom');
  assert.equal(g.players[0].mainDeck.length, deck0 - 1, 'only ZapA and Nocturne were revealed');
  const aur = Object.values(g.objects).find(o => o.cardId === cid('Dazzling Aurora'))!;
  assert.equal(aur.zone, 'base', 'RJ#7993: Aurora stays in play');
});

test('RJ#7915 Svellsongur attached to Aphelios, Exalted copies his text: Aphelios triggers twice', () => {
  let g = S0();
  fundAll(g, P0, 3);
  put(g, P0, 'Aphelios, Exalted', 'base');
  const sv = put(g, P0, 'Svellsongur', 'base');
  g = act(g, legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === sv)!);
  g = answer(g, { targets: [[g.players[0].base[0]]] });
  let modes = 0;
  for (let i = 0; i < 14 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'chooseMode') { modes++; g = choose(g, d.options![0].id); } else if (d.inStep) g = choose(g, d.options![0].id); else g = pass(g);
  }
  assert.equal(g.log.filter(l => /^Trigger: Aphelios/.test(l.text)).length, 2);
  assert.equal(modes, 2);
});

test('RJ#7916 Wielder of Water: two Stupefys in combat (snapshot -1 each), then Ride the Wind out of combat -> 0 Might, survives', () => {
  let g = S0();
  fundAll(g, P0, 3);
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const w = put(g, P0, 'Wielder of Water', 'base');
  g = move(g, P0, [w], BF_A);
  assert.equal(mightOf(g, w), 4);
  for (let k = 0; k < 2; k++) {
    if (pend(g).player !== P0) g = pass(g);
    const s = hand(g, P0, 'Stupefy');
    g = play(g, P0, s, { targets: [[w]] }); g = resolveChain(g);
  }
  assert.equal(mightOf(g, w), 2);
  if (pend(g).player !== P0) g = pass(g);
  const rtw = hand(g, P0, 'Ride the Wind');
  g = play(g, P0, rtw, { targets: [[w]] });
  g = toStep(g); g = answer(g, { locations: ['base'] }); g = toStep(g);
  assert.equal(locOf(g, w), 'base');
  assert.equal(mightOf(g, w), 0);
});

test('RJ#7917 Warwick, Hunter killed with his attack trigger on the chain: "here" is gone, nothing is killed', () => {
  let g = S0();
  fundAll(g, P1, 2);
  const e = put(g, P1, 'V(5)', BF_A, { damage: 1 }); control(g, BF_A, P1);
  const w = put(g, P0, 'Warwick, Hunter', 'base', { damage: 4 });
  g = move(g, P0, [w], BF_A);
  assert.equal(g.chain.length, 1);
  g = pass(g);
  [g] = cast(g, P1, 'ZapR', { targets: [[w]] });
  g = resolveChain(g);
  assert.equal(zone(g, w), 'trash');
  assert.equal(zone(g, e), 'battlefield', 'damaged enemy not killed');
});

test('RJ#7918 Stalwart Poro with Taric, Protector here has Shield 2 (Shield stacks)', () => {
  const { g, def } = attackSetup(['V(9)'], ['Stalwart Poro', 'Taric, Protector']);
  assert.equal(kwv(g, def[0], 'Shield'), 2);
  assert.equal(mightOf(g, def[0]), 4);
});

test('RJ#7919 Wuju Bladesman (Master Yi) +2 is not a floor: the defender can still be reduced below 3', () => {
  let g = S0({ tp: P1 });
  legend(g, P0, 'Wuju Bladesman');
  fundAll(g, P1, 2);
  const d = put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const a = put(g, P1, 'V(9)', 'base');
  g = move(g, P1, [a], BF_A);
  assert.equal(mightOf(g, d), 3);
  if (pend(g).player !== P1) g = pass(g);
  const s = hand(g, P1, 'Stupefy');
  g = play(g, P1, s, { targets: [[d]] }); g = resolveChain(g);
  assert.equal(mightOf(g, d), 2);
});

test('RJ#7920 Kraken Hunter cannot use the buff Cithria gets from its own play to reduce its cost', () => {
  let g = S0();
  setRunes(g, P0, 5, 'body');
  const c = put(g, P0, 'Cithria of Cloudfield', 'base');
  const kh = hand(g, P0, 'Kraken Hunter');
  const rd0 = g.players[0].runeDeck.length;
  g = act(g, { type: 'playCard', player: P0, obj: kh, destination: 'base' });
  for (let i = 0; i < 6 && pend(g).inStep; i++) g = pend(g).kind === 'optional' ? no(g) : choose(g, optionIds(g)[0]);
  g = toStep(g);
  assert.equal(g.objects[c].counters.buff, 1, 'Cithria buffed only after the play');
  assert.equal(g.players[0].runeDeck.length, rd0 + 2, 'full [C][C] paid (no reduction)');
});

test('RJ#7921 surprise defender at an uncontrolled battlefield conquers on the opponent\'s turn when the attacker is recalled', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0, 3);
  const a = put(g, P1, 'V(5)', 'base');
  const d = put(g, P0, 'V(2)', 'base');
  const rp = hand(g, P0, 'Relentless Pursuit');
  g = move(g, P1, [a], BF_A);
  g = pass(g);
  g = play(g, P0, rp, { targets: [[d]], locations: [BF_A] });   // R-2: destination chosen as played
  for (let i = 0; i < 10 && g.chain.length && !pend(g).inStep; i++) g = pass(g);   // resolve it only
  assert.ok(g.showdown?.isCombat);
  if (pend(g).player !== P0) g = pass(g);
  expectPending(g, 'showdownAction', P0);
  [g] = cast(g, P0, 'StunA', { targets: [[a]] });
  g = toStep(g); g = answer(g, { may: [false] }); g = toStep(g);
  assert.equal(locOf(g, a), 'base', 'attacker recalled');
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[0].points, 1);
});

test('RJ#7922 Shakedown in response to Unyielding Spirit resolves first (its damage is not prevented)', () => {
  let g = S0();
  fundAll(g, P0, 2); fundAll(g, P1, 2);
  const e = put(g, P1, 'V(9)', 'base');
  [g] = cast(g, P0, 'DrawR'); g = pass(g);
  [g] = cast(g, P1, 'Unyielding Spirit'); g = pass(g);
  const sk = hand(g, P0, 'Shakedown');
  g = play(g, P0, sk, { targets: [[e]] });
  g = pass(g); g = pass(g);
  // P1 decides: take 6 or let P0 draw 2 -> take the damage
  for (let i = 0; i < 3 && pend(g).inStep; i++) {
    const opt = pend(g).options!.find(o => /deal|damage|6/i.test(o.label)) ?? pend(g).options!.find(o => o.id === 'no') ?? pend(g).options![0];
    g = choose(g, opt.id);
  }
  assert.equal(g.objects[e].damage, 6);
});

test('RJ#7923 (official: CR 383.3.b) Monastery of Hirana\'s "you may spend a buff" is paid as it goes on the chain, before Sett, Brawler\'s simultaneous conquer buff exists', () => {
  let g = S0({ bfA: 'Monastery of Hirana' });
  const s = put(g, P0, 'Sett, Brawler', 'base');
  const h0 = g.players[0].hand.length;
  g = move(g, P0, [s], BF_A);
  g = toStep(g);
  for (let i = 0; i < 12 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'orderTriggers') { g = choose(g, (d.options!.find(o => /Monastery/.test(o.label)) ?? d.options![0]).id); continue; }
    if (d.kind === 'optional') { g = yes(g); continue; }
    if (d.inStep) { g = choose(g, d.options![0].id); continue; }
    g = pass(g);
  }
  assert.equal(g.players[0].points, 1);
  assert.equal(g.players[0].hand.length, h0, 'no draw: the cost could not be paid when the trigger finalized');
  assert.equal(g.objects[s].counters.buff, 1, 'Sett keeps the buff from his own trigger');
});

test('RJ#7924 a spell whose target became illegal does nothing; no new target is chosen', () => {
  let g = S0();
  fundAll(g, P1, 1);
  const t = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const other = put(g, P1, 'V(2)', BF_A);
  [g] = cast(g, P0, 'KillA', { targets: [[t]] });
  g = pass(g);
  [g] = cast(g, P1, 'MoveR', { targets: [[t]] });
  g = resolveChain(g);
  assert.ok(!pend(g).inStep, 'no re-targeting');
  assert.equal(zone(g, t), 'base');
  assert.equal(zone(g, other), 'battlefield');
});

test('RJ#7925 a Might-restricted target is re-checked on resolution (Blood Money vs a pumped unit)', () => {
  let g = S0();
  fundAll(g, P0, 2); fundAll(g, P1, 1);
  const t = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'Blood Money', { targets: [[t]] });
  g = pass(g);
  [g] = cast(g, P1, 'PumpR', { targets: [[t]] });
  g = resolveChain(g);
  assert.equal(zone(g, t), 'battlefield', 'no longer a legal target (5 Might)');
});

test('RJ#7926 Shen, Kinkou played into a combat as a defender has Shield 2 at once: Gust cannot choose him', () => {
  let { g } = attackSetup(['V(5)'], ['V(1)']);
  fundAll(g, P0, 2); fundAll(g, P1, 2);
  g = pass(g);
  const sh = hand(g, P1, 'Shen, Kinkou');
  g = play(g, P1, sh, { dest: BF_A });
  g = answer(g, { locations: [BF_A] }, P1);
  assert.equal(locOf(g, sh), BF_A);
  assert.equal(g.objects[sh].combatRole, 'defender');
  assert.equal(mightOf(g, sh), 5);
  if (pend(g).player !== P0) g = pass(g);
  const gu = hand(g, P0, 'Gust');
  g = act(g, { type: 'playCard', player: P0, obj: gu });
  if (pend(g).kind === 'chooseTargets') assert.ok(!optionIds(g).includes(sh));
});

test('RJ#7927 Gust in response to a pump spell returns the unit before the pump resolves', () => {
  let g = S0();
  fundAll(g, P1, 1);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  [g] = cast(g, P0, 'PumpA', { targets: [[u]] });
  g = pass(g);
  const gu = hand(g, P1, 'Gust');
  g = play(g, P1, gu, { targets: [[u]] });
  g = resolveChain(g);
  assert.equal(zone(g, u), 'hand');
});

test('RJ#7929 two Darius, Trifarian played back to back: both trigger on the second (both ready, +2)', () => {
  let g = S0();
  fundAll(g, P0, 4);
  let d1: ObjId, d2: ObjId;
  [g, d1] = cast(g, P0, 'Darius, Trifarian', { dest: 'base' }); g = toStep(g);
  [g, d2] = cast(g, P0, 'Darius, Trifarian', { dest: 'base' });
  for (let i = 0; i < 8 && g.pending && g.pending.kind !== 'mainAction'; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  for (const d of [d1, d2]) { assert.equal(g.objects[d].exhausted, false); assert.equal(mightOf(g, d), 7); }
});

test('RJ#7932 a Hidden champion (Teemo) can be hidden from the Champion Zone at a battlefield you control', () => {
  const g = S0();
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const pl = g.players[0];
  for (const id of pl.championZone) delete g.objects[id];
  const t = put(g, P0, 'Teemo, Scout', 'banishment');
  pl.banishment = pl.banishment.filter(x => x !== t);
  g.objects[t].zone = 'championZone'; pl.championZone = [t]; g.timestamp++;
  assert.ok(legal(g, P0, 'hide').some(a => a.type === 'hide' && a.obj === t && a.battlefieldIndex === BF_A));
});

test('RJ#7933 a buffed unit saved by Zhonya\'s Hourglass keeps its buff (recall stays on the board)', () => {
  let g = S0();
  put(g, P0, "Zhonya's Hourglass", 'base');
  const u = put(g, P0, 'V(2)', BF_A, { buff: true, damage: 1 }); control(g, BF_A, P0);
  [g] = cast(g, P0, 'ZapA', { targets: [[u]] });
  g = toStep(g); g = answer(g, { may: [true] }); g = toStep(g);
  assert.equal(locOf(g, u), 'base');
  assert.equal(g.objects[u].counters.buff, 1);
});

test('RJ#7935 a stunned Yasuo, Remorseful moved into combat by Charm still triggers "when I attack" and deals his Might', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P1, 2);
  const e = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const y = put(g, P0, 'Yasuo, Remorseful', 'base', { stunned: true });
  const ch = hand(g, P1, 'Charm');
  g = play(g, P1, ch, { targets: [[y]] });
  g = toStep(g); g = answer(g, { locations: [BF_A] });
  assert.equal(g.showdown?.attacker, P0);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = choose(g, optionIds(g)[0]);
  g = resolveChain(g);
  assert.equal(g.objects[e].damage, 6);
});

test('RJ#7936 a move trigger resolves before combat starts; Assault applies only once combat begins', () => {
  let g = S0();
  fundAll(g, P0, 2);
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const m = put(g, P0, 'Traveling Merchant', 'base');
  hand(g, P0, 'V(1)');
  [g] = cast(g, P0, 'Cleave', { targets: [[m]] }); g = toStep(g);
  g = move(g, P0, [m], BF_A);
  assert.ok(g.chain.length >= 1 || pend(g).inStep, 'move trigger pending');
  assert.ok(!g.showdown?.isCombat);
  assert.equal(mightOf(g, m), 2);
  for (let i = 0; i < 8 && !g.showdown?.isCombat; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.ok(g.showdown?.isCombat);
  assert.equal(mightOf(g, m), 5);
});

test('RJ#7937 Tideturner cannot choose a unit at its own location; the trigger is optional', () => {
  let g = S0();
  fundAll(g, P0, 2);
  const same = put(g, P0, 'V(2)', 'base');
  const tt = hand(g, P0, 'Tideturner');
  g = play(g, P0, tt, { dest: 'base' });
  for (let i = 0; i < 4 && pend(g).inStep; i++) {
    if (pend(g).kind === 'chooseTargets') { assert.ok(!optionIds(g).includes(same)); break; }
    g = yes(g);
  }
  assert.equal(zone(g, tt), 'base');
});

test('RJ#7939 Nine-Tailed Fox (Ahri legend): attacker moved by Ride the Wind into a second controlled battlefield gets -1 again', () => {
  let g = S0();
  legend(g, P1, 'Nine-Tailed Fox');
  fundAll(g, P0, 2);
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  const a = put(g, P0, 'V(5)', 'base');
  g = move(g, P0, [a], BF_A);
  g = resolveChain(g);
  assert.equal(mightOf(g, a), 4);
  expectPending(g, 'showdownAction', P0);
  const rtw = hand(g, P0, 'Ride the Wind');
  g = play(g, P0, rtw, { targets: [[a]] });
  g = toStep(g); g = answer(g, { locations: [BF_B] });
  for (let i = 0; i < 20 && g.objects[a].combatRole !== 'attacker' || (i < 20 && g.chain.length); i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(locOf(g, a), BF_B);
  assert.equal(mightOf(g, a), 3);
});

test('RJ#7941 Stacked Deck looking at three Nocturnes: each may be banished and played for [A]; then nothing goes to hand', () => {
  let g = S0();
  fundAll(g, P0, 2);
  const ns = [0, 1, 2].map(() => put(g, P0, 'Nocturne, Horrifying', 'deckTop'));
  const sd = hand(g, P0, 'Stacked Deck');
  const h0 = g.players[0].hand.length;
  g = play(g, P0, sd);
  for (let i = 0; i < 40 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'optional') g = yes(g);
    else if (d.kind === 'chooseDestination') g = choose(g, 'base');
    else if (d.inStep) g = choose(g, optionIds(g)[0]);
    else g = pass(g);
  }
  for (const n of ns) assert.equal(zone(g, n), 'base');
  assert.equal(g.players[0].hand.length, h0 - 1, 'no card put into hand');
});

test('RJ#7944 one move action sends its units to a single destination', () => {
  let g = S0();
  const a = put(g, P0, 'V(1)', 'base'); const b = put(g, P0, 'V(1)', 'base');
  const acts = legal(g, P0, 'move').filter(x => x.type === 'move' && x.units.length === 2);
  assert.ok(acts.length > 0);
  for (const x of acts) assert.ok(x.type === 'move' && (typeof x.to === 'number' || x.to === 'base'));
  g = move(g, P0, [a, b], BF_A);
  assert.equal(locOf(g, a), BF_A); assert.equal(locOf(g, b), BF_A);
});

test('RJ#7948 Lady of Luminosity (Lux): Promising Future\'s draw happens before the Divine Judgment it plays resolves', () => {
  let g = S0();
  fundAll(g, P0, 3);
  legend(g, P0, 'Lady of Luminosity');
  const dj = put(g, P0, 'Divine Judgment', 'deckTop');
  const pf = hand(g, P0, 'Promising Future');
  g = play(g, P0, pf);
  for (let i = 0; i < 40 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'chooseCards' && d.options!.some(o => o.id === dj)) g = choose(g, dj);
    else if (d.kind === 'chooseCards') g = choose(g, ...d.options!.slice(0, d.max ?? 1).map(o => o.id));
    else if (d.inStep) g = d.kind === 'optional' ? yes(g) : choose(g, d.options![0].id);
    else g = pass(g);
  }
  const t = g.log.map(l => l.text);
  const dji = t.findIndex(x => /^Resolving Divine Judgment/.test(x));
  const draws = t.map((x, i) => /P0 draws 1/.test(x) ? i : -1).filter(i => i >= 0);
  assert.ok(dji > 0);
  assert.equal(draws.length, 2);
  assert.ok(draws[0] < dji && draws[1] > dji, 'one draw before, one after Divine Judgment');
});

test('RJ#7949 Charm moves an exhausted enemy unit battlefield-to-battlefield (no Ganking needed), never into another player\'s base', () => {
  let g = S0();
  fundAll(g, P0, 2);
  const e = put(g, P1, 'V(2)', BF_A, { ready: false }); control(g, BF_A, P1);
  const ch = hand(g, P0, 'Charm');
  g = play(g, P0, ch, { targets: [[e]] });
  g = toStep(g);
  expectPending(g, 'chooseDestination', P0);
  assert.ok(optionIds(g).includes(String(BF_B)));
  assert.ok(optionIds(g).includes('base'), "its owner's base");
  assert.ok(!optionIds(g).includes(String(BF_A)));
  g = answer(g, { locations: [BF_B] }); g = toStep(g);
  assert.equal(locOf(g, e), BF_B);
});

test('RJ#7951 Retreat on Viktor, Innovator during the opponent\'s turn: Viktor is gone when the play completes, no Recruit', () => {
  let g = S0();
  fundAll(g, P1, 2);
  const v = put(g, P1, 'Viktor, Innovator', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'DrawR');
  g = pass(g);
  const rt = hand(g, P1, 'Retreat');
  g = play(g, P1, rt, { targets: [[v]] });
  g = resolveChain(g); g = toStep(g);
  assert.equal(zone(g, v), 'hand');
  const toks = Object.values(g.objects).filter(o => o.isToken && (o.zone === 'base' || o.zone === 'battlefield'));
  assert.equal(toks.length, 0);
});

test('RJ#7953 a unit moved by a spell (MoveR stand-in for Fight or Flight) stays ready', () => {
  let g = S0();
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  [g] = cast(g, P0, 'MoveR', { targets: [[u]] }); g = resolveChain(g);
  assert.equal(locOf(g, u), 'base');
  assert.equal(g.objects[u].exhausted, false);
});

test('RJ#7958 after Unchecked Power wipes a battlefield, the opponent gets no window to play their hidden unit there', () => {
  let g = S0();
  fundAll(g, P0, 2); addRunes(g, P0, 3, 'mind');
  put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const hid = put(g, P1, 'HidU(2)', { facedown: BF_A });
  [g] = cast(g, P0, 'Unchecked Power');
  g = pass(g);
  expectPending(g, 'chainResponse', P1);
  assert.ok(canPlayNow(g, P1, hid), 'the only window is before it resolves');
  g = pass(g);
  assert.equal(g.chain.length, 0);
  expectPending(g, 'mainAction', P0);
  assert.equal(zone(g, hid), 'trash', 'facedown card lost with the battlefield');
});

test('RJ#7959 Meditation\'s exhaust-a-unit cost does not "choose" it for The Dreaming Tree: draw 2, not 3', () => {
  let g = S0({ bfA: 'The Dreaming Tree' });
  fundAll(g, P0, 2);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const md = hand(g, P0, 'Meditation');
  const h0 = g.players[0].hand.length;
  g = act(g, { type: 'playCard', player: P0, obj: md });
  for (let i = 0; i < 6 && pend(g).inStep; i++) {
    const d = pend(g);
    if (d.kind === 'optional') g = yes(g); else if (d.options!.some(o => o.id === u)) g = choose(g, u); else g = choose(g, d.options![0].id);
  }
  g = resolveChain(g); g = toStep(g);
  assert.equal(g.objects[u].exhausted, true);
  assert.equal(g.players[0].hand.length, h0 - 1 + 2);
});

test('RJ#7961 a ready Gold token pays for a Reaction while a spell is on the chain', () => {
  let g = S0();
  setRunes(g, P1, 1, 'fury');
  const gold = put(g, P1, 'cf-gold', 'base', { token: true });
  const e = put(g, P1, 'V(5)', 'base');
  [g] = cast(g, P0, 'ZapA', { targets: [[e]] });
  g = pass(g);
  const df = hand(g, P1, 'Defy');
  assert.ok(canPlayNow(g, P1, df), 'Fury rune for energy + Gold for the [A]');
  g = play(g, P1, df, { targets: [[g.chain[0].id]] });
  assert.notEqual(zone(g, gold), 'base', 'Gold was used');
  g = resolveChain(g);
  assert.equal(g.objects[e].damage, 0, 'ZapA countered');
});

test('RJ#7963 The Dreaming Tree\'s "first time each turn" resets each turn: draw on your turn and again on the opponent\'s', () => {
  let g = S0({ bfA: 'The Dreaming Tree' });
  fundAll(g, P0, 2);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  let h = g.players[0].hand.length;
  [g] = cast(g, P0, 'PumpA', { targets: [[u]] }); g = resolveChain(g); g = toStep(g);
  assert.equal(g.players[0].hand.length, h + 1);
  [g] = cast(g, P0, 'PumpA', { targets: [[u]] }); g = resolveChain(g); g = toStep(g);
  assert.equal(g.players[0].hand.length, h + 1, 'only the first time this turn');
  g = endTurn(g, P0); g = toStep(g);
  expectPending(g, 'mainAction', P1);
  fundAll(g, P0, 2);
  [g] = cast(g, P1, 'DrawR'); g = pass(g);
  h = g.players[0].hand.length;
  const pr = hand(g, P0, 'PumpR');
  g = play(g, P0, pr, { targets: [[u]] }); g = resolveChain(g); g = toStep(g);
  assert.equal(g.players[0].hand.length, h + 1, 'Dreaming Tree drew 1 again on the opponent\'s turn');
});

test('RJ#7964 Unforgiven (Yasuo legend) moves a ready unit without exhausting it; it can then Gank', () => {
  let g = S0();
  const L = legend(g, P0, 'Unforgiven');
  const u = put(g, P0, 'Ganker(2)', 'base');
  g = act(g, legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === L)!);
  g = answer(g, { targets: [[u]], locations: [BF_A], battlefields: [BF_A] });
  g = toStep(g); g = answer(g, { locations: [BF_A], battlefields: [BF_A] }); g = toStep(g);
  assert.equal(locOf(g, u), BF_A);
  assert.equal(g.objects[u].exhausted, false);
  assert.ok(moveDests(g, P0, u).includes(BF_B), 'can still Gank to another battlefield');
});

test('RJ#7965 no limit on distinct champion units in a deck (each up to 3 copies)', () => {
  const d = legalDeck();
  d.main = d.main.slice(0, 34).concat(['cf-champ', 'cf-champ', 'cf-champ2', 'cf-champ2', 'cf-champ2']); // + the chosen champion = 3 copies
  const probs = validateDeck(d, fixtureDb(), { battlefields: 3 });
  assert.deepEqual(probs.filter(p => /champion/i.test(JSON.stringify(p))), []);
  const d4 = legalDeck();
  d4.main = d4.main.slice(0, 35).concat(['cf-champ2', 'cf-champ2', 'cf-champ2', 'cf-champ2']);
  assert.ok(validateDeck(d4, fixtureDb(), { battlefields: 3 }).length > 0, '4 copies is illegal');
});

test('RJ#7966 recycling a rune to pay a cost triggers Battle Mistress (Sivir): the trigger goes on the chain and the player keeps priority', () => {
  let g = S0();
  legend(g, P0, 'Battle Mistress');
  const e = put(g, P1, 'V(5)', BF_A);
  const vs = hand(g, P0, 'Void Seeker');
  g = play(g, P0, vs, { targets: [[e]] });
  if (pend(g).kind === 'optional') g = yes(g); // its leading "you may" (CR 383.3.a)
  assert.equal(g.chain.length, 2);
  assert.equal(g.chain[1].source, g.players[0].legend, 'Battle Mistress trigger above the spell');
  expectPending(g, 'chainResponse', P0);
});

test('RJ#7967 two Qiyana, Victorious conquering together both trigger (draw 2)', () => {
  let g = S0();
  const q1 = put(g, P0, 'Qiyana, Victorious', 'base'); const q2 = put(g, P0, 'Qiyana, Victorious', 'base');
  const h0 = g.players[0].hand.length;
  g = move(g, P0, [q1, q2], BF_A);
  for (let i = 0; i < 16 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'chooseMode' || (d.inStep && d.options!.some(o => /draw/i.test(o.label)))) g = choose(g, d.options!.find(o => /draw/i.test(o.label))!.id);
    else if (d.inStep) g = choose(g, d.options![0].id); else g = pass(g);
  }
  assert.equal(g.players[0].hand.length, h0 + 2);
});

test('RJ#7969 Karma Channeler does not trigger on recycling runes', () => {
  let g = S0();
  const k = put(g, P0, 'ogn-235-298', 'base');
  const e = put(g, P1, 'V(5)', BF_A);
  const vs = hand(g, P0, 'Void Seeker');
  g = play(g, P0, vs, { targets: [[e]] });
  assert.equal(g.chain.length, 1, 'no Karma trigger');
  g = resolveChain(g); g = toStep(g);
  assert.equal(g.objects[k].counters.buff ?? 0, 0);
});

// RJ#7970 — MISMATCH-RJ (DECISIONS #7970, principle 12): a hidden permanent's play effect mistargets once its source has left
// the board (CR 811.1.d.3.a, Blastcone Fae is the CR's own example), so Gusting the Fae stops the -2. (From hand: RJ#4030, -2 stays.)
test('RJ#7970 (MISMATCH-RJ, CR 811.1.d.3.a) Gusting Blastcone Fae played from hidden stops its -2 (play effect mistargets)', () => {
  let g = S0();
  fundAll(g, P0, 2);
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const fae = put(g, P1, 'Blastcone Fae', { facedown: BF_A });
  const a = put(g, P0, 'V(5)', 'base');
  g = move(g, P0, [a], BF_A);
  g = pass(g);
  g = play(g, P1, fae, { dest: BF_A });
  g = answer(g, { targets: [[a]] }, P1);
  assert.ok(g.chain.some(c => c.source === fae));
  if (pend(g).player !== P0) g = pass(g);
  const gu = hand(g, P0, 'Gust');
  g = play(g, P0, gu, { targets: [[fae]] });
  g = resolveChain(g);
  assert.equal(zone(g, fae), 'hand');
  assert.equal(mightOf(g, a), 5);
});

test('RJ#7971 re-entering a battlefield you held this turn after leaving it: a showdown, control regained, but no conquer (no Qiyana trigger)', () => {
  let g = S0({ tp: P1 });
  const u = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const q = put(g, P0, 'Qiyana, Victorious', 'base');
  g = endTurn(g, P1); g = toStep(g);
  expectPending(g, 'mainAction', P0);
  assert.equal(g.players[0].points, 1);
  g = move(g, P0, [u], 'base'); g = toStep(g);
  assert.equal(g.battlefields[BF_A].controller, null);
  const h0 = g.players[0].hand.length;
  g = move(g, P0, [q], BF_A);
  assert.ok(g.showdown && !g.showdown.isCombat, 'non-combat showdown');
  g = toStep(g);
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[0].points, 1);
  assert.equal(g.players[0].hand.length, h0, 'no conquer trigger');
});

test('RJ#7974 4-Might unit played onto Trifarian War Camp: Grand Duelist (becomes Mighty) no, Relentless Storm (play a Mighty unit) yes', () => {
  const run = (leg: string) => {
    let g = S0({ bfA: 'Trifarian War Camp' });
    legend(g, P0, leg);
    put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
    let u: ObjId;
    [g, u] = cast(g, P0, 'V(4)', { dest: BF_A });
    assert.equal(mightOf(g, u), 5);
    return pend(g).kind === 'optional' || g.chain.length > 0;
  };
  assert.equal(run('Grand Duelist'), false);
  assert.equal(run('Relentless Storm'), true);
});

test('RJ#7976 Kraken Hunter: spending a buff lowers its power cost; Seal of Strength can pay the rest', () => {
  let g = S0();
  setRunes(g, P0, 3, 'body');
  const seal = put(g, P0, 'Seal of Strength', 'base');
  const b = put(g, P0, 'V(1)', 'base', { buff: true });
  const kh = hand(g, P0, 'Kraken Hunter');
  const rd0 = g.players[0].runeDeck.length;
  g = act(g, { type: 'playCard', player: P0, obj: kh, destination: 'base' });
  for (let i = 0; i < 8 && pend(g).inStep; i++) {
    const d = pend(g);
    if (d.kind === 'optional') g = /Accelerate/.test(d.prompt) ? no(g) : yes(g);
    else if (d.kind === 'chooseNumber') g = choose(g, '1');
    else if (d.options!.some(o => o.id === b)) g = choose(g, b);
    else g = choose(g, d.options![0].id);
  }
  g = toStep(g);
  assert.equal(zone(g, kh), 'base');
  assert.equal(g.objects[b].counters.buff ?? 0, 0, 'buff spent');
  const powerPaid = (g.players[0].runeDeck.length - rd0) + (g.objects[seal].exhausted ? 1 : 0);
  assert.equal(powerPaid, 1, 'only one [C] paid after spending the buff');
});

test('RJ#7978 Singularity ("up to two units") can choose units in base', () => {
  let g = S0();
  fundAll(g, P0, 3); addRunes(g, P0, 4, 'mind');
  const b = put(g, P1, 'V(9)', 'base');
  const f = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Singularity') });
  expectPending(g, 'chooseTargets', P0);
  assert.ok(optionIds(g).includes(b) && optionIds(g).includes(f));
  g = choose(g, b, f); g = resolveChain(g);
  assert.equal(g.objects[b].damage, 6); assert.equal(g.objects[f].damage, 6);
});

test('RJ#7980 Baited Hook: the death trigger (Altar of Memories as stand-in) waits until the Hook finishes; the found unit is played first', () => {
  let g = S0();
  fundAll(g, P0, 3);
  const hook = put(g, P0, 'Baited Hook', 'base');
  put(g, P0, 'Altar of Memories', 'base');
  const k = put(g, P0, 'V(2)', 'base');
  const found = put(g, P0, 'V(3)', 'deckTop');
  g = act(g, legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === hook)!);
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.options?.some(o => o.id === k) && d.kind === 'chooseTargets') g = choose(g, k);
    else if (d.options?.some(o => o.id === found)) g = choose(g, found);
    else if (d.kind === 'optional') g = yes(g);
    else if (d.kind === 'chooseDestination') g = choose(g, 'base');
    else if (d.inStep) g = choose(g, ...(d.options ?? []).slice(0, d.min ?? 1).map(o => o.id));
    else g = pass(g);
  }
  const t = g.log.map(l => l.text);
  const played = t.findIndex(x => /plays V\(3\)/.test(x));
  const altar = t.findIndex(x => /^Resolving Altar of Memories/.test(x));
  assert.ok(played >= 0 && altar >= 0, t.join(' | '));
  assert.ok(played < altar, 'found unit played before Altar resolves');
});

test('RJ#7982 "discard 1, then draw 1" with an empty hand still draws (Traveling Merchant)', () => {
  let g = S0();
  const m = put(g, P0, 'Traveling Merchant', 'base');
  assert.equal(g.players[0].hand.length, 0);
  g = move(g, P0, [m], BF_A); g = toStep(g);
  assert.equal(g.players[0].hand.length, 1);
});

test('RJ#7983 Garen, Commander and a buffed-by-Garen Recruit take combat damage; Garen dies, the Recruit (1 damage) survives — healed in the same combat cleanup', () => {
  let g = S0();
  const d = put(g, P1, 'V(6)', BF_A); control(g, BF_A, P1);
  const gar = put(g, P0, 'Garen, Commander', 'base');
  const r = put(g, P0, 'cf-recruit', 'base', { token: true });
  g = move(g, P0, [gar, r], BF_A);
  assert.equal(mightOf(g, r), 2);
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const p = pend(g);
    if (p.kind === 'assignDamage') {
      const asg = p.player === P1 ? { [gar]: 5, [r]: 1 } : { [d]: 7 };
      g = act(g, { type: 'assignDamage', player: p.player, assignment: asg });
    } else if (p.inStep) g = choose(g, optionIds(g)[0]); else g = pass(g);
  }
  assert.equal(zone(g, gar), 'trash');
  assert.equal(zone(g, r), 'battlefield');
  assert.equal(g.objects[r].damage, 0);
});

test('RJ#7984 Anivia, Primal kills First Mate; the remaining defender Yi becomes alone -> Wuju Bladesman +2 (8 Might)', () => {
  let g = S0();
  legend(g, P1, 'Wuju Bladesman');
  const yi = put(g, P1, 'Master Yi, Honed', BF_A); control(g, BF_A, P1);
  const fm = put(g, P1, 'First Mate', BF_A);
  const an = put(g, P0, 'Anivia, Primal', 'base');
  g = move(g, P0, [an], BF_A);
  assert.equal(mightOf(g, yi), 6);
  g = resolveChain(g);
  assert.equal(zone(g, fm), 'trash');
  assert.equal(mightOf(g, yi), 8);
});

test('RJ#7986 Shield and Wuju Bladesman apply as soon as the defender is designated, before attack triggers resolve', () => {
  let g = S0();
  legend(g, P1, 'Wuju Bladesman');
  const d = put(g, P1, 'Shield(2,1)', BF_A); control(g, BF_A, P1);
  const y = put(g, P0, 'Yasuo, Remorseful', 'base');
  g = move(g, P0, [y], BF_A);
  assert.ok(g.chain.length >= 1, 'attack trigger still on the chain');
  assert.equal(mightOf(g, d), 5, '2 + Shield 1 + Wuju 2');
});

test('RJ#7987 Aspirant\'s Climb raises the Victory Score for everyone just by being in play (8 -> 9)', () => {
  let g = S0({ bfA: "Aspirant's Climb" });
  g.players[0].points = 8;
  [g] = cast(g, P0, 'DrawR'); g = toStep(g);
  assert.equal(g.winner ?? null, null, '8 is not enough');
  g.players[0].points = 9;
  [g] = cast(g, P0, 'DrawR'); g = toStep(g);
  assert.equal(g.winner, P0);
});

test('RJ#7989 a Shield defender moved out of combat loses the bonus at once; the Assault attacker keeps its bonus', () => {
  let { g, atk, def } = attackSetup(['Assault(2,1)'], ['Shield(2,1)']);
  fundAll(g, P1, 1);
  assert.equal(mightOf(g, def[0]), 3); assert.equal(mightOf(g, atk[0]), 3);
  g = pass(g);
  [g] = cast(g, P1, 'MoveR', { targets: [[def[0]]] }); g = resolveChain(g);
  assert.equal(locOf(g, def[0]), 'base');
  assert.equal(mightOf(g, def[0]), 2);
  assert.ok(g.showdown, 'showdown continues');
  assert.equal(mightOf(g, atk[0]), 3);
});

test('RJ#7992 Shen, Kinkou cannot be played into an uncontrolled battlefield the opponent is taking', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0, 2);
  const a = put(g, P1, 'V(2)', 'base');
  g = move(g, P1, [a], BF_A);
  g = pass(g);
  const sh = hand(g, P0, 'Shen, Kinkou');
  assert.ok(!playDests(g, P0, sh).includes(BF_A));
});

test('RJ#7997 Discipline whose target left the board still draws (partial resolution)', () => {
  let g = S0();
  fundAll(g, P0, 2); fundAll(g, P1, 1);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const dsc = hand(g, P0, 'Discipline');
  g = play(g, P0, dsc, { targets: [[u]] });
  g = pass(g);
  const gu = hand(g, P1, 'Gust');
  g = play(g, P1, gu, { targets: [[u]] });
  const h0 = g.players[0].hand.length;
  g = resolveChain(g);
  assert.equal(zone(g, u), 'hand');
  assert.equal(g.players[0].hand.length, h0 + 2, 'returned unit + drew 1');
});

test('RJ#8001 Call to Glory: the buff spent and the unit getting +3 can be different units', () => {
  let g = S0();
  setRunes(g, P0, 0);
  const b = put(g, P0, 'V(1)', 'base', { buff: true });
  const t = put(g, P0, 'V(2)', 'base');
  const cg = hand(g, P0, 'Call to Glory');
  g = act(g, { type: 'playCard', player: P0, obj: cg });
  for (let i = 0; i < 6 && pend(g).inStep; i++) {
    const d = pend(g);
    if (d.kind === 'optional') g = yes(g);
    else if (d.kind === 'chooseTargets' && d.options!.some(o => o.id === t)) g = choose(g, t);
    else if (d.options!.some(o => o.id === b)) g = choose(g, b);
    else g = choose(g, d.options![0].id);
  }
  g = resolveChain(g);
  assert.equal(g.objects[b].counters.buff ?? 0, 0);
  assert.equal(mightOf(g, t), 5);
});

test('RJ#8002 (official: CR 387-389) reflexive "do this" items exist: Disintegrate\'s draw becomes its own chain item', () => {
  let g = S0();
  fundAll(g, P0, 2);
  const e = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'Disintegrate', { targets: [[e]] });
  g = pass(g); g = pass(g); // Disintegrate resolves
  assert.equal(zone(g, e), 'trash');
  assert.equal(g.chain.length, 1, 'reflexive draw item on the chain');
  const h0 = g.players[0].hand.length;
  g = resolveChain(g);
  assert.equal(g.players[0].hand.length, h0 + 1);
});

test('RJ#8003 Kinkou Monk (errata "up to two") still triggers with only one other friendly unit', () => {
  let g = S0();
  fundAll(g, P0, 3);
  const o = put(g, P0, 'V(2)', 'base');
  [g] = cast(g, P0, 'Kinkou Monk', { dest: 'base', targets: [[o]] });
  g = answer(g, { targets: [[o]] }); g = resolveChain(g); g = toStep(g);
  assert.equal(g.objects[o].counters.buff, 1);
});

test('RJ#8004 end of turn: "this turn" Might and damage go away together; a unit kept alive only by +2 survives', () => {
  let g = S0();
  const u = put(g, P0, 'V(2)', 'base', { damage: 3 });
  mod(g, u, { might: 2 });
  [g] = cast(g, P0, 'DrawR'); g = toStep(g);
  assert.equal(zone(g, u), 'base');
  g = endTurn(g, P0); g = toStep(g);
  assert.equal(zone(g, u), 'base');
  assert.equal(g.objects[u].damage, 0);
  assert.equal(mightOf(g, u), 2);
});

test('RJ#8005 Imperial Decree + two 1-Might attackers vs two 6-Might defenders: damage must stack on one, so only one dies', () => {
  let g = S0();
  fundAll(g, P0, 3); addRunes(g, P0, 2, 'order');
  const d1 = put(g, P1, 'V(6)', BF_A); const d2 = put(g, P1, 'V(6)', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'Imperial Decree'); g = resolveChain(g);
  const a1 = put(g, P0, 'V(1)', 'base'); const a2 = put(g, P0, 'V(1)', 'base');
  g = move(g, P0, [a1, a2], BF_A);
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const p = pend(g);
    if (p.kind === 'assignDamage' && p.player === P0) {
      assert.notEqual(validateAction(g, { type: 'assignDamage', player: P0, assignment: { [d1]: 1, [d2]: 1 } }), null, 'cannot split before lethal');
      g = act(g, { type: 'assignDamage', player: P0, assignment: { [d1]: 2 } });
    } else if (p.kind === 'assignDamage') g = act(g, { type: 'assignDamage', player: p.player, assignment: { [a1]: 6, [a2]: 6 } });
    else if (p.inStep) g = choose(g, optionIds(g)[0]); else g = pass(g);
  }
  assert.equal(zone(g, d1), 'trash');
  assert.equal(zone(g, d2), 'battlefield');
});

test('RJ#8007 Blitzcrank, Impassive alone holds: the point is scored, then he returns to hand', () => {
  let g = S0({ tp: P1 });
  const b = put(g, P0, 'Blitzcrank, Impassive', BF_A); control(g, BF_A, P0);
  g = endTurn(g, P1); g = resolveChain(g); g = toStep(g);
  assert.equal(g.players[0].points, 1);
  assert.equal(zone(g, b), 'hand');
});

test('RJ#8008 Darius, Trifarian played by Baited Hook (after playing the Hook) counts as the second card and readies', () => {
  let g = S0();
  fundAll(g, P0, 4);
  let hook: ObjId;
  [g, hook] = cast(g, P0, 'Baited Hook'); g = toStep(g);
  const k = put(g, P0, 'V(4)', 'base');
  const dz = put(g, P0, 'Darius, Trifarian', 'deckTop');
  g = act(g, legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === hook)!);
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'chooseTargets' && d.options!.some(o => o.id === k)) g = choose(g, k);
    else if (d.options?.some(o => o.id === dz)) g = choose(g, dz);
    else if (d.kind === 'optional') g = yes(g);
    else if (d.kind === 'chooseDestination') g = choose(g, 'base');
    else if (d.inStep) g = choose(g, ...(d.options ?? []).slice(0, d.min ?? 1).map(o => o.id));
    else g = pass(g);
  }
  assert.equal(zone(g, dz), 'base');
  assert.equal(g.objects[dz].exhausted, false);
  assert.equal(mightOf(g, dz), 7);
});

test('RJ#8016 a unit saved by The Boss did not die: Immortal Phoenix ("when you kill a unit with a spell") does not trigger', () => {
  let g = S0();
  legend(g, P0, 'The Boss'); addRunes(g, P0, 1, 'body');
  const ph = put(g, P0, 'Immortal Phoenix', 'trash');
  const u = put(g, P0, 'V(2)', 'base', { buff: true, damage: 1 });
  [g] = cast(g, P0, 'ZapA', { targets: [[u]] });
  g = toStep(g);
  assert.match(pend(g).prompt, /Boss/);
  g = yes(g); g = toStep(g);
  assert.equal(locOf(g, u), 'base');
  assert.ok(!(pend(g).kind === 'optional' && /Phoenix/.test(pend(g).prompt)), 'no Phoenix offer');
  assert.equal(zone(g, ph), 'trash');
});

test('RJ#8018 Switcheroo on Dr. Mundo and Traveling Merchant: +/-X fixed at resolution; Mundo still grows with the trash afterwards', () => {
  let g = S0();
  fundAll(g, P0, 3);
  const mu = put(g, P0, 'Dr. Mundo, Expert', BF_A); control(g, BF_A, P0);
  const tm = put(g, P0, 'Traveling Merchant', BF_A);
  for (let i = 0; i < 4; i++) put(g, P0, 'V(1)', 'trash');
  assert.equal(mightOf(g, mu), 10);
  [g] = cast(g, P0, 'Switcheroo', { targets: [[mu, tm]] }); g = resolveChain(g); g = toStep(g);
  assert.equal(mightOf(g, tm), 10);
  const m1 = mightOf(g, mu)!;
  assert.equal(m1, 2 + (g.players[0].trash.length - 4), 'Mundo 10 -> 2, plus Switcheroo now in the trash');
  put(g, P0, 'V(1)', 'trash'); g.timestamp++;
  assert.equal(mightOf(g, mu), m1 + 1);
  assert.equal(mightOf(g, tm), 10);
});

test('RJ#8020 a "when you play me" trigger still resolves after the unit is killed in response', () => {
  let g = S0();
  fundAll(g, P0, 2); fundAll(g, P1, 1);
  const e = put(g, P1, 'V(5)', 'base');
  let pd: ObjId;
  [g, pd] = cast(g, P0, 'PlayDeal2', { dest: 'base', targets: [[e]] });
  assert.equal(g.chain.length, 1);
  g = pass(g);
  [g] = cast(g, P1, 'ZapR', { targets: [[pd]] });
  g = resolveChain(g);
  assert.equal(zone(g, pd), 'trash');
  assert.equal(g.objects[e].damage, 2);
});

test('RJ#8023 the card Stacked Deck puts into your hand is not revealed to the opponent', () => {
  let g = S0();
  fundAll(g, P0, 1);
  const top = put(g, P0, 'ZapA', 'deckTop');
  const sd = hand(g, P0, 'Stacked Deck');
  g = play(g, P0, sd); g = toStep(g);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = pend(g).options!.some(o => o.id === top) ? choose(g, top) : choose(g, optionIds(g)[0]);
  g = toStep(g);
  assert.equal(zone(g, top), 'hand');
  const v = getView(g, P1).state.objects[top] as { cardId?: string } | undefined;
  assert.ok(!v || v.cardId !== g.objects[top].cardId, 'hidden from the opponent');
});

test('RJ#8024 "other friendly units" excludes the source (Garen, Commander)', () => {
  const g = S0();
  const gar = put(g, P0, 'Garen, Commander', BF_A); control(g, BF_A, P0);
  const o = put(g, P0, 'V(2)', BF_A);
  assert.equal(mightOf(g, gar), 5);
  assert.equal(mightOf(g, o), 3);
});

test('RJ#8027 Watcher\'s -3 (min 1) on a 2-Might unit is snapshotted as -1: Discipline (+2) then makes it 3', () => {
  let g = S0();
  fundAll(g, P0, 3); addRunes(g, P0, 4, 'mind'); fundAll(g, P1, 1);
  const e = put(g, P1, 'V(2)', 'base');
  [g] = cast(g, P0, 'Thousand-Tailed Watcher', { dest: 'base', may: [false] }); g = toStep(g);
  assert.equal(mightOf(g, e), 1);
  [g] = cast(g, P0, 'DrawR'); g = pass(g);
  [g] = cast(g, P1, 'Discipline', { targets: [[e]] }); g = resolveChain(g);
  assert.equal(mightOf(g, e), 3);
});

test('RJ#8028 hiding is base speed (not on a chain / in a showdown); a hidden card is played at Reaction speed on a later turn', () => {
  let g = S0();
  fundAll(g, P0, 2);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const h = hand(g, P0, 'HidZap');
  assert.ok(legal(g, P0, 'hide').some(a => a.type === 'hide' && a.obj === h));
  [g] = cast(g, P0, 'DrawR');
  assert.equal(legal(g, P0, 'hide').length, 0, 'no hiding while a chain exists');
  g = resolveChain(g);
  const f = put(g, P0, 'HidZap', { facedown: BF_A });
  const e = put(g, P1, 'V(5)', BF_A);
  [g] = cast(g, P0, 'DrawR');
  assert.ok(canPlayNow(g, P0, f), 'facedown card has Reaction timing');
  void e;
});

test('RJ#8030 hold points are gained before hold triggers resolve; reaching the Victory Score wins at once (Blitzcrank as the hold-trigger stand-in)', () => {
  let g = S0({ tp: P1 });
  g.players[0].points = 6;
  const b = put(g, P0, 'Blitzcrank, Impassive', BF_A); control(g, BF_A, P0);
  put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
  g = endTurn(g, P1);
  assert.equal(g.winner, P0);
  assert.equal(locOf(g, b), BF_A, 'hold trigger never resolved');
});

test('RJ#8034 Karma Channeler (recycle from Dazzling Aurora) can buff the unit Aurora just played', () => {
  let g = S0();
  put(g, P0, 'Dazzling Aurora', 'base');
  put(g, P0, 'ogn-235-298', 'base');
  const u = put(g, P0, 'V(3)', 'deckTop');
  put(g, P0, 'ZapA', 'deckTop');
  g = endTurn(g, P0);
  let offered = false;
  for (let i = 0; i < 16 && g.pending && g.activePlayer === P0; i++) {
    const d = pend(g);
    if (d.kind === 'chooseTargets' && d.options!.some(o => o.id === u)) { offered = true; g = choose(g, u); continue; }
    if (d.inStep) g = d.kind === 'optional' ? no(g) : choose(g, optionIds(g)[0]); else g = pass(g);
  }
  assert.ok(offered, 'Aurora\'s unit is a legal Karma target');
  assert.equal(g.objects[u].counters.buff, 1);
});

test('RJ#8035 a spell whose only target left still counts as played: Ravenbloom Student gets +1', () => {
  let g = S0();
  fundAll(g, P1, 1);
  const st = put(g, P0, 'Ravenbloom Student', 'base');
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'KillA', { targets: [[e]] });
  g = pass(g);
  [g] = cast(g, P1, 'MoveR', { targets: [[e]] });
  g = resolveChain(g); g = resolveChain(g);
  assert.equal(zone(g, e), 'base', 'KillA had no legal target left');
  assert.equal(mightOf(g, st), 3);
});

test('RJ#8038 a Mighty unit played by Dazzling Aurora triggers Relentless Storm (Volibear legend)', () => {
  let g = S0();
  legend(g, P0, 'Relentless Storm');
  put(g, P0, 'Dazzling Aurora', 'base');
  put(g, P0, 'V(6)', 'deckTop');
  const r0 = g.players[0].runesInPlay.length;
  g = endTurn(g, P0);
  let offered = false;
  for (let i = 0; i < 16 && g.pending && g.activePlayer === P0; i++) {
    const d = pend(g);
    if (d.kind === 'optional' && /channel|Storm|exhaust/i.test(d.prompt)) { offered = true; g = yes(g); continue; }
    if (d.inStep) g = d.kind === 'optional' ? no(g) : choose(g, optionIds(g)[0]); else g = pass(g);
  }
  assert.ok(offered);
  assert.equal(g.players[0].runesInPlay.length >= r0 + 1, true);
});

test('RJ#8040 Swift Scout (Teemo legend): hide by paying [1] energy (exhaust) instead of [A] (recycle)', () => {
  let g = S0();
  legend(g, P0, 'Swift Scout');
  setRunes(g, P0, 1);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const h = hand(g, P0, 'HidZap');
  const rd0 = g.players[0].runeDeck.length;
  const hides = legal(g, P0, 'hide').filter(a => a.type === 'hide' && a.obj === h);
  assert.ok(hides.length > 0);
  g = act(g, hides[0]);
  for (let i = 0; i < 4 && pend(g).inStep; i++) {
    const d = pend(g);
    const o = d.options!.find(x => x.label === '1') ?? d.options![0];
    g = choose(g, o.id);
  }
  assert.equal(zone(g, h), 'facedown');
  assert.equal(g.players[0].runeDeck.length, rd0, 'no rune recycled');
  assert.equal(exhaustedRunes(g, P0), 1, 'paid by exhausting');
});

test('RJ#8042 Bullet Time: the "pay any amount of [A]" is chosen and paid on resolution (not if countered)', () => {
  let g = S0();
  fundAll(g, P0, 3); fundAll(g, P1, 2);
  const e = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const bt = hand(g, P0, 'Bullet Time, Miss Fortune');
  g = act(g, { type: 'playCard', player: P0, obj: bt });
  for (let i = 0; i < 4 && pend(g).inStep; i++) {
    assert.notEqual(pend(g).kind, 'chooseNumber', 'amount not chosen on play');
    g = choose(g, optionIds(g).includes(String(BF_A)) ? String(BF_A) : optionIds(g)[0]);
  }
  const rd = g.players[0].runeDeck.length;
  g = pass(g);
  const df = hand(g, P1, 'Defy');
  g = play(g, P1, df, { targets: [[g.chain[0].id]] });
  g = resolveChain(g);
  assert.equal(g.players[0].runeDeck.length, rd, 'countered: nothing extra paid');
  assert.equal(g.objects[e].damage, 0);
});

test('RJ#8043 Teemo, Strategist chooses exactly one enemy unit, however many [Hidden] cards are revealed', () => {
  let g = S0();
  put(g, P1, 'Teemo, Strategist', BF_A); control(g, BF_A, P1);
  for (let i = 0; i < 3; i++) put(g, P1, 'HidU(1)', 'deckTop');
  const a = put(g, P0, 'V(5)', 'base'); const b = put(g, P0, 'V(5)', 'base');
  g = move(g, P0, [a, b], BF_A);
  if (pend(g).kind === 'chooseTargets') { assert.equal(pend(g).max ?? 1, 1); g = choose(g, a); }
  g = resolveChain(g);
  assert.equal(g.objects[a].damage + g.objects[b].damage, 3, 'all 3 on one unit');
  assert.ok(g.objects[a].damage === 3 || g.objects[b].damage === 3);
});

test('RJ#8044 (official: CR 340/346.1) an [Add] ability resolves at once without passing priority', () => {
  let g = S0();
  const gold = put(g, P0, 'cf-gold', 'base', { token: true });
  [g] = cast(g, P0, 'DrawR');
  expectPending(g, 'chainResponse', P0);
  const ga = legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === gold);
  assert.ok(ga, 'Gold can be used as a Reaction');
  g = act(g, ga!);
  for (let i = 0; i < 3 && pend(g).inStep; i++) g = choose(g, optionIds(g)[0]);
  assert.equal(g.chain.length, 1, 'nothing waits on the chain');
  expectPending(g, 'chainResponse', P0, 'priority stays with the player');
  assert.ok(g.players[0].pool.power && Object.values(g.players[0].pool.power).reduce((s, n) => s + (n as number), 0) >= 1);
});

test('RJ#8045 Defy checks the printed cost: a Repeated Bellows Breath can still be Defied', () => {
  let g = S0();
  fundAll(g, P0, 3); fundAll(g, P1, 2);
  const e = put(g, P1, 'V(5)', 'base');
  const bb = hand(g, P0, 'Bellows Breath');
  g = act(g, { type: 'playCard', player: P0, obj: bb });
  for (let i = 0; i < 6 && pend(g).inStep; i++) {
    const d = pend(g);
    if (d.kind === 'optional') g = yes(g);
    else if (d.kind === 'chooseTargets') g = choose(g, e);
    else g = choose(g, optionIds(g)[0]);
  }
  g = pass(g);
  const df = hand(g, P1, 'Defy');
  assert.ok(canPlayNow(g, P1, df));
  g = play(g, P1, df, { targets: [[g.chain[0].id]] });
  g = resolveChain(g);
  assert.equal(g.objects[e].damage, 0);
});

test('RJ#8047 an enemy unit moved by your Charm into your battlefield is the attacker: its Assault applies and Nine-Tailed Fox triggers', () => {
  let g = S0();
  legend(g, P0, 'Nine-Tailed Fox');
  fundAll(g, P0, 2);
  put(g, P0, 'V(9)', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'Assault(3,2)', 'base');
  const ch = hand(g, P0, 'Charm');
  g = play(g, P0, ch, { targets: [[e]] });
  g = toStep(g); g = answer(g, { locations: [BF_A] });
  assert.equal(g.showdown?.attacker, P1);
  assert.equal(g.objects[e].combatRole, 'attacker');
  g = resolveChain(g);
  assert.equal(mightOf(g, e), 4, '3 + Assault 2 - 1 (Fox)');
});

test('RJ#8054 at 7 points conquering Zaun Warrens with an empty hand: draw instead of the point, then discard 1, then draw 1', () => {
  let g = S0({ bfA: 'Zaun Warrens' });
  g.players[0].points = 7;
  const u = put(g, P0, 'V(2)', 'base');
  const t0 = g.players[0].trash.length;
  g = move(g, P0, [u], BF_A);
  for (let i = 0; i < 12 && g.pending && g.pending.kind !== 'mainAction'; i++) g = pend(g).inStep ? choose(g, ...optionIds(g).slice(0, pend(g).min ?? 1)) : pass(g);
  assert.equal(g.players[0].points, 7);
  assert.equal(g.players[0].trash.length, t0 + 1, 'discarded the card drawn for the final point');
  assert.equal(g.players[0].hand.length, 1);
});

test('RJ#8055 Cruel Patron killing Kog\'Maw as its cost lands first; the Deathknell then hits Patron there (no recall)', () => {
  let g = S0();
  fundAll(g, P0, 2);
  const k = put(g, P0, "Kog'Maw, Caustic", BF_A); control(g, BF_A, P0);
  const o = put(g, P0, 'V(1)', BF_A);
  const cp = hand(g, P0, 'Cruel Patron');
  g = act(g, { type: 'playCard', player: P0, obj: cp, destination: BF_A });
  for (let i = 0; i < 6 && pend(g).inStep; i++) g = pend(g).options!.some(x => x.id === k) ? choose(g, k) : choose(g, optionIds(g)[0]);
  g = resolveChain(g); g = toStep(g);
  assert.equal(zone(g, k), 'trash');
  assert.equal(locOf(g, cp), BF_A);
  assert.equal(g.objects[cp].damage, 4);
  assert.equal(zone(g, o), 'trash');
});

test('RJ#8056 Volibear, Furious\'s split damage targeting a Deflect unit costs the tax once', () => {
  let g = S0();
  const d = put(g, P1, 'Deflect(6,1)', BF_A); control(g, BF_A, P1);
  const v = put(g, P0, 'Volibear, Furious', 'base');
  const rd0 = g.players[0].runeDeck.length;
  g = move(g, P0, [v], BF_A);
  for (let i = 0; i < 6 && pend(g).inStep; i++) {
    const p = pend(g);
    if (p.kind === 'chooseTargets') g = choose(g, d);
    else if (p.kind === 'optional') g = yes(g);
    else g = choose(g, optionIds(g)[0]);
  }
  assert.equal(g.players[0].runeDeck.length, rd0 + 1, 'one [A]');
  g = resolveChain(g);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = choose(g, optionIds(g)[0]);
  assert.equal(g.objects[d].damage, 5);
});

test('RJ#8057 Defy cannot counter Falling Star (2 power > [A])', () => {
  let g = S0();
  fundAll(g, P0, 3); fundAll(g, P1, 2);
  const e = put(g, P1, 'V(9)', 'base');
  [g] = cast(g, P0, 'Falling Star', { targets: [[e], [e]] });
  if (pend(g).kind !== 'chainResponse') g = answer(g, { targets: [[e], [e]] });
  g = pass(g);
  const df = hand(g, P1, 'Defy');
  assert.ok(!canPlayNow(g, P1, df));
});

test('RJ#8059 Yasuo, Remorseful (6) attacks a 10-Might unit: trigger 6 + combat 6 kill it; it still deals its full 10 back', () => {
  let g = S0();
  const d = put(g, P1, 'V(10)', BF_A); control(g, BF_A, P1);
  const y = put(g, P0, 'Yasuo, Remorseful', 'base');
  g = move(g, P0, [y], BF_A);
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(zone(g, d), 'trash');
  assert.equal(zone(g, y), 'trash');
});

test('RJ#8061 Arena Bar\'s activated ability uses the chain; the opponent can respond', () => {
  let g = S0();
  const ab = put(g, P0, 'Arena Bar', 'base');
  const u = put(g, P0, 'V(2)', 'base', { ready: false });
  g = act(g, legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === ab)!);
  g = answer(g, { targets: [[u]] });
  assert.equal(g.chain.length, 1);
  g = pass(g);
  expectPending(g, 'chainResponse', P1);
});

test('RJ#8064 Deadbloom Predator: playable to your battlefield or an occupied enemy one, not an open battlefield', () => {
  const g = S0();
  fundAll(g, P0, 4);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const dp = hand(g, P0, 'Deadbloom Predator');
  const ds = playDests(g, P0, dp);
  assert.ok(ds.includes(BF_A)); assert.ok(!ds.includes(BF_B), 'open battlefield not allowed');
  put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  assert.ok(playDests(g, P0, dp).includes(BF_B));
});

test('RJ#8067 (official: CR 383.3.a) a trigger starting with "you may" is decided as it goes on the chain; declining removes it', () => {
  let g = S0();
  legend(g, P0, 'Battle Mistress');
  const e = put(g, P1, 'V(5)', BF_A);
  const vs = hand(g, P0, 'Void Seeker');
  g = play(g, P0, vs, { targets: [[e]] });
  const p = pend(g);
  assert.ok(p.kind === 'optional' && /Battle Mistress/.test(p.prompt), 'asked before anyone can respond');
  g = no(g);
  assert.equal(g.chain.length, 1, 'declined trigger removed');
});

test('RJ#8069 Startipped Peak\'s hold rune arrives exhausted and stays exhausted into the Main Phase', () => {
  let g = S0({ tp: P1, bfA: 'Startipped Peak' });
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const r0 = g.players[0].runesInPlay.length;
  g = endTurn(g, P1);
  for (let i = 0; i < 10 && g.pending && g.pending.kind !== 'mainAction'; i++) g = pend(g).kind === 'optional' ? yes(g) : pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  expectPending(g, 'mainAction', P0);
  assert.ok(g.players[0].runesInPlay.length >= r0 + 1);
  assert.ok(exhaustedRunes(g, P0) >= 1, 'the Peak rune is still exhausted');
});

test('RJ#8070 Ezreal, Dashing\'s [Action] dash is not usable while his attack trigger is on the chain, only once the showdown is open', () => {
  let g = S0();
  fundAll(g, P0, 2);
  const e = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const ez = put(g, P0, 'Ezreal, Dashing', 'base');
  g = move(g, P0, [ez], BF_A);
  for (let i = 0; i < 3 && pend(g).inStep; i++) g = choose(g, e);
  assert.ok(g.chain.length >= 1);
  assert.equal(legal(g, P0, 'activate').filter(x => x.type === 'activate' && x.obj === ez).length, 0, 'closed state: no Action');
  g = resolveChain(g);
  assert.equal(g.objects[e].damage, 3);
  expectPending(g, 'showdownAction', P0);
  assert.ok(legal(g, P0, 'activate').some(x => x.type === 'activate' && x.obj === ez), 'dash available with focus');
});

test('RJ#8071 (analogue: Portal Rescue) "ignoring its cost" ignores the power cost too', () => {
  let g = S0();
  fundAll(g, P0, 2);
  const w = put(g, P0, 'Thousand-Tailed Watcher', 'base', { ready: false });
  const rd0 = g.players[0].runeDeck.length;
  [g] = cast(g, P0, 'Portal Rescue', { targets: [[w]] });
  const rd1 = g.players[0].runeDeck.length; // Portal Rescue's own [M]
  g = toStep(g);
  if (pend(g).kind === 'optional') g = no(g); // no Accelerate
  g = toStep(g);
  assert.equal(rd1 - rd0, 1);
  assert.equal(g.players[0].runeDeck.length, rd1, 'Watcher\'s 1 power not paid');
});

test('RJ#8072 two of my units die at once with Zhonya\'s Hourglass in play: I (its controller) choose which is saved', () => {
  let g = S0({ tp: P1 });
  put(g, P0, "Zhonya's Hourglass", 'base');
  const d1 = put(g, P0, 'V(1)', BF_A); const d2 = put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const a = put(g, P1, 'V(9)', 'base');
  g = move(g, P1, [a], BF_A);
  let chooser: PlayerId | null = null;
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const p = pend(g);
    if (p.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: p.player, assignment: p.player === P1 ? { [d1]: 1, [d2]: 8 } : { [a]: 2 } }); continue; }
    if (p.inStep && (p.options ?? []).some(o => o.id === d2 || /V\(1\)/.test(o.label))) { chooser = p.player; g = choose(g, (p.options!.find(o => o.id === d2) ?? p.options![0]).id); continue; }
    if (p.kind === 'optional') { chooser = chooser ?? p.player; g = yes(g); continue; }
    g = p.inStep ? choose(g, optionIds(g)[0]) : pass(g);
  }
  assert.equal(chooser, P0);
  assert.equal([d1, d2].filter(x => zone(g, x) === 'base').length, 1, 'exactly one saved');
});

test('RJ#8075 Ravenbloom Student: a countered spell is not "played" (no +1); the +1 is not a buff', () => {
  let g = S0();
  fundAll(g, P0, 1); fundAll(g, P1, 2);
  const st = put(g, P0, 'Ravenbloom Student', 'base');
  [g] = cast(g, P0, 'DrawR'); g = pass(g);
  const df = hand(g, P1, 'Defy');
  g = play(g, P1, df, { targets: [[g.chain[0].id]] });
  g = resolveChain(g);
  assert.equal(mightOf(g, st), 2, 'countered spell: no trigger');
  [g] = cast(g, P0, 'DrawR'); g = resolveChain(g);
  assert.equal(mightOf(g, st), 3);
  assert.equal(g.objects[st].counters.buff ?? 0, 0, 'not a buff');
});

test('RJ#8077 a spell played from hidden can only target units at its battlefield (CR 811.1.d)', () => {
  let g = S0();
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const hz = put(g, P0, 'HidZap', { facedown: BF_A });
  const here = put(g, P1, 'V(5)', BF_A);
  const there = put(g, P1, 'V(5)', BF_B);
  [g] = cast(g, P0, 'DrawR');
  g = act(g, { type: 'playCard', player: P0, obj: hz });
  expectPending(g, 'chooseTargets', P0);
  assert.ok(optionIds(g).includes(here));
  assert.ok(!optionIds(g).includes(there));
});

test('RJ#8080 two Dazzling Auroras: a Deadbloom Predator played into enemies by the first waits for the chain to empty before the showdown', () => {
  let g = S0();
  put(g, P0, 'Dazzling Aurora', 'base'); put(g, P0, 'Dazzling Aurora', 'base');
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  put(g, P0, 'V(1)', 'deckTop');
  const dp = put(g, P0, 'Deadbloom Predator', 'deckTop');
  g = endTurn(g, P0);
  let sawWait = false;
  for (let i = 0; i < 30 && g.pending && !g.showdown && g.activePlayer === P0; i++) {
    const d = pend(g);
    if (locOf(g, dp) === BF_A && g.chain.length > 0) { sawWait = true; assert.equal(g.showdown, null); }
    if (d.kind === 'chooseDestination') g = choose(g, optionIds(g).includes(String(BF_A)) ? String(BF_A) : optionIds(g)[0]);
    else if (d.inStep) g = d.kind === 'optional' ? no(g) : choose(g, optionIds(g)[0]);
    else g = pass(g);
  }
  assert.equal(locOf(g, dp), BF_A);
  assert.ok(sawWait, 'Predator sat at BF-A while the second Aurora was still on the chain');
  assert.ok(g.showdown?.isCombat, 'combat once the chain is empty');
});

test('RJ#8081 Blitzcrank pulls the only unit off a battlefield with a hidden Tideturner: the battlefield is lost and the facedown card trashed with no window', () => {
  let g = S0();
  fundAll(g, P0, 3);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const only = put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  const tt = put(g, P1, 'Tideturner', { facedown: BF_B });
  const b = hand(g, P0, 'Blitzcrank, Impassive');
  g = act(g, { type: 'playCard', player: P0, obj: b, destination: BF_A });
  g = answer(g, { targets: [[only]], may: [true] }, P0);
  g = pass(g); g = pass(g);
  assert.equal(locOf(g, only), BF_A);
  assert.equal(zone(g, tt), 'trash');
  assert.notEqual(g.battlefields[BF_B].controller, P1);
});

test('RJ#8082 Viktor, Leader dying together with another non-Recruit unit makes no Recruit', () => {
  let g = S0({ tp: P1 });
  const v = put(g, P0, 'Viktor, Leader', BF_A); const o = put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const a = put(g, P1, 'V(9)', 'base');
  g = move(g, P1, [a], BF_A);
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const p = pend(g);
    if (p.kind === 'assignDamage') g = act(g, { type: 'assignDamage', player: p.player, assignment: p.player === P1 ? { [v]: 4, [o]: 5 } : { [a]: 5 } });
    else g = p.inStep ? choose(g, optionIds(g)[0]) : pass(g);
  }
  assert.equal(zone(g, v), 'trash'); assert.equal(zone(g, o), 'trash');
  assert.equal(Object.values(g.objects).filter(x => x.isToken && x.controller === P0 && (x.zone === 'base' || x.zone === 'battlefield')).length, 0);
});

test('RJ#8085 Hostile Takeover on the opponent\'s turn at my battlefield: no conquer, and the readied unit cannot make a standard move then', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0, 2); addRunes(g, P0, 2, 'mind');
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const ht = put(g, P0, 'Hostile Takeover', { facedown: BF_A });
  const e = put(g, P1, 'Ganker(3)', 'base');
  g = move(g, P1, [e], BF_A);
  if (pend(g).player === P1) g = pass(g);
  g = play(g, P0, ht, { targets: [[e]] });
  g = resolveChain(g);
  assert.equal(g.objects[e].controller, P0);
  assert.equal(g.players[0].points, 0, 'already controlled: not a conquer');
  assert.equal(legal(g, P0, 'move').length, 0, 'no standard moves on the opponent\'s turn');
});

test('RJ#8088 Unyielding Spirit does not prevent the units\' damage from Challenge (damage dealt by units, CR 418.6.b.3)', () => {
  let g = S0();
  fundAll(g, P0, 3); fundAll(g, P1, 2);
  const f = put(g, P0, 'V(3)', 'base'); const e = put(g, P1, 'V(4)', 'base');
  [g] = cast(g, P0, 'DrawR'); g = pass(g);
  [g] = cast(g, P1, 'Unyielding Spirit'); g = resolveChain(g);
  [g] = cast(g, P0, 'Challenge', { targets: [[f], [e]] });
  if (pend(g).kind === 'chooseTargets') g = answer(g, { targets: [[e]] });
  g = resolveChain(g);
  assert.equal(g.objects[e].damage, 3);
  assert.equal(zone(g, f), 'trash');
});

test('RJ#8096 a "this turn" Might bonus given on the opponent\'s turn ends at the end of that turn', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0, 1);
  const u = put(g, P0, 'V(2)', 'base');
  [g] = cast(g, P1, 'DrawR'); g = pass(g);
  [g] = cast(g, P0, 'PumpR', { targets: [[u]] }); g = resolveChain(g);
  assert.equal(mightOf(g, u), 5);
  g = endTurn(g, P1); g = toStep(g);
  expectPending(g, 'mainAction', P0);
  assert.equal(mightOf(g, u), 2);
});

test('RJ#8099 Zhonya\'s Hourglass saves a Temporary unit from its own trigger; it keeps Temporary', () => {
  let g = S0({ tp: P1 });
  put(g, P0, "Zhonya's Hourglass", 'base');
  const t = put(g, P0, 'Temp(2)', BF_A); control(g, BF_A, P0);
  g = endTurn(g, P1);
  for (let i = 0; i < 12 && g.pending && g.pending.kind !== 'mainAction'; i++) g = pend(g).kind === 'optional' ? yes(g) : pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(zone(g, t), 'base', 'saved and recalled');
  assert.ok(hasKeyword(g, t, 'Temporary'));
});

test('RJ#8103 Retreat on my unit at The Dreaming Tree: the Tree\'s draw trigger resolves before Retreat', () => {
  let g = S0({ bfA: 'The Dreaming Tree' });
  fundAll(g, P0, 2);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const rt = hand(g, P0, 'Retreat');
  g = play(g, P0, rt, { targets: [[u]] });
  assert.equal(g.chain.length, 2, 'Dreaming Tree trigger above Retreat');
  const h0 = g.players[0].hand.length;
  g = pass(g); g = pass(g);
  assert.equal(g.players[0].hand.length, h0 + 1, 'drew first');
  assert.equal(locOf(g, u), BF_A, 'unit not yet returned');
  g = resolveChain(g);
  assert.equal(zone(g, u), 'hand');
});

test('RJ#8109 a champion played from the Champion Zone is "played from anywhere other than a hand": Rek\'Sai, Breacher grants Accelerate', () => {
  let g = S0();
  fundAll(g, P0, 3);
  put(g, P0, "Rek'Sai, Breacher", 'base');
  const pl = g.players[0];
  for (const id of pl.championZone) delete g.objects[id];
  const sq = put(g, P0, "Rek'Sai, Swarm Queen", 'banishment');
  pl.banishment = pl.banishment.filter(x => x !== sq);
  g.objects[sq].zone = 'championZone'; pl.championZone = [sq]; g.timestamp++;
  assert.ok(canPlayNow(g, P0, sq));
  g = act(g, { type: 'playCard', player: P0, obj: sq, destination: 'base' });
  const p = pend(g);
  assert.ok(p.kind === 'optional' && /Accelerate/.test(p.prompt), 'Accelerate offered');
  g = yes(g); g = toStep(g);
  assert.equal(g.objects[sq].exhausted, false);
});

test('RJ#8110 Daughter of the Void (Kai\'Sa legend) adds [A] usable only for spells', () => {
  const g = S0();
  legend(g, P0, 'Daughter of the Void');
  setRunes(g, P0, 5, 'calm');
  put(g, P1, 'V(5)', BF_A);
  const vs = hand(g, P0, 'Void Seeker');
  assert.ok(canPlayNow(g, P0, vs), 'Fury power from the legend for a spell');
  const sb = hand(g, P0, 'Sett, Brawler');
  assert.ok(!canPlayNow(g, P0, sb), 'not for a unit');
});

test('RJ#8113 while attacking, Janna, Savior cannot be played to the (enemy-controlled) combat battlefield', () => {
  const { g } = attackSetup(['V(3)'], ['V(2)']);
  fundAll(g, P0, 2);
  const j = hand(g, P0, 'Janna, Savior');
  expectPending(g, 'showdownAction', P0);
  assert.ok(!playDests(g, P0, j).includes(BF_A));
  assert.ok(playDests(g, P0, j).includes('base'));
});

test('RJ#8116 En Garde\'s extra +1 applies to a lone attacker at an enemy battlefield', () => {
  let { g, atk } = attackSetup(['V(2)'], ['V(9)']);
  fundAll(g, P0, 1);
  [g] = cast(g, P0, 'En Garde', { targets: [[atk[0]]] });
  g = resolveChain(g);
  assert.equal(mightOf(g, atk[0]), 4);
});

test('RJ#8121 sending units into a battlefield one at a time: each attacks alone and gets Mask of Foresight\'s +1', () => {
  let g = S0();
  put(g, P0, 'Mask of Foresight', 'base');
  put(g, P1, 'V(3)', BF_A); put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const a1 = put(g, P0, 'V(3)', 'base'); const a2 = put(g, P0, 'V(3)', 'base');
  g = move(g, P0, [a1], BF_A); g = resolveChain(g);
  assert.equal(mightOf(g, a1), 4);
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) g = pend(g).inStep ? (pend(g).kind === 'assignDamage' ? act(g, legal(g, pend(g).player)[0]) : choose(g, optionIds(g)[0])) : pass(g);
  if (pend(g).kind === 'assignDamage') g = act(g, legal(g, pend(g).player)[0]);
  expectPending(g, 'mainAction', P0);
  g = move(g, P0, [a2], BF_A); g = resolveChain(g);
  assert.equal(mightOf(g, a2), 4);
});

test('RJ#8122 Rumble, Hotheaded recycling a unit card (Ferrous Forerunner) triggers Karma Channeler', () => {
  let g = S0();
  fundAll(g, P0, 3);
  const k = put(g, P0, 'ogn-235-298', 'base');
  const ff = put(g, P0, 'Ferrous Forerunner', 'base');
  put(g, P0, 'Clanging Sentry', 'trash');
  const r = put(g, P0, 'Rumble, Hotheaded', 'base');
  g = move(g, P0, [r], BF_A);
  let karma = false;
  for (let i = 0; i < 24 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'optional') { g = yes(g); continue; }
    if (d.options?.some(o => o.id === ff) && d.kind !== 'chooseDestination') { g = choose(g, ff); continue; }
    if (d.kind === 'chooseTargets' && /buff/i.test(d.prompt)) { karma = true; g = choose(g, k); continue; }
    g = d.inStep ? choose(g, ...optionIds(g).slice(0, d.min ?? 1)) : pass(g);
  }
  assert.equal(zone(g, ff), 'mainDeck', 'Forerunner recycled');
  assert.ok(karma || g.log.some(l => /Karma/.test(l.text) && /Trigger/.test(l.text)), 'Karma triggered');
});

test('RJ#8123 Convergent Mutation needs two different friendly units', () => {
  const g = S0();
  fundAll(g, P0, 3);
  put(g, P0, 'Dr. Mundo, Expert', 'base');
  const cm = hand(g, P0, 'Convergent Mutation');
  assert.ok(!canPlayNow(g, P0, cm), 'one friendly unit only');
  put(g, P0, 'V(1)', 'base');
  assert.ok(canPlayNow(g, P0, cm));
});

test('RJ#8124 Jinx, Demolitionist accelerated costs 4 energy and two Fury power', () => {
  let g = S0();
  setRunes(g, P0, 6, 'fury');
  const j = hand(g, P0, 'Jinx, Demolitionist');
  const rd0 = g.players[0].runeDeck.length;
  g = act(g, { type: 'playCard', player: P0, obj: j, destination: 'base' });
  if (pend(g).kind === 'optional') g = yes(g);
  for (let i = 0; i < 6 && pend(g).inStep; i++) g = choose(g, ...optionIds(g).slice(0, pend(g).min ?? 1));
  assert.equal(g.players[0].runeDeck.length - rd0, 2, 'two runes recycled');
  assert.equal(g.objects[j].exhausted, false);
  assert.equal(g.players[0].runesInPlay.length, 4);
  assert.equal(exhaustedRunes(g, P0) + 2, 4, '4 energy (two of the exhausted runes were then recycled for power)');
});

test('RJ#8125 moving Lee Sin, Ascetic (which exhausts him) does not buff him; only his [T] ability does', () => {
  let g = S0();
  const ls = put(g, P0, 'Lee Sin, Ascetic', 'base');
  g = move(g, P0, [ls], BF_A); g = toStep(g);
  assert.equal(g.objects[ls].exhausted, true);
  assert.equal(g.objects[ls].counters.buff ?? 0, 0);
  assert.equal(legal(g, P0, 'activate').filter(x => x.type === 'activate' && x.obj === ls).length, 0, '[T] not payable while exhausted');
});

test('RJ#8126 Thousand-Tailed Watcher ("enemy units", no target) pays no Deflect tax', () => {
  let g = S0();
  setRunes(g, P0, 8, 'mind');
  put(g, P1, 'Deflect(3,1)', 'base');
  const rd0 = g.players[0].runeDeck.length;
  [g] = cast(g, P0, 'Thousand-Tailed Watcher', { dest: 'base', may: [false] }); g = toStep(g);
  assert.equal(g.players[0].runeDeck.length - rd0, 1, 'only its own [M]');
});

test('RJ#8127 Portal Rescue on a unit I control but don\'t own: its owner plays it to their base', () => {
  let g = S0();
  fundAll(g, P0, 2);
  const u = put(g, P1, 'V(3)', 'base', { controller: P0 });
  [g] = cast(g, P0, 'Portal Rescue', { targets: [[u]] });
  for (let i = 0; i < 10 && g.pending && g.pending.kind !== 'mainAction'; i++) g = pend(g).kind === 'optional' ? no(g) : pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  const nu = g.players[1].base.find(id => g.objects[id].cardId === cid('V(3)'));
  assert.ok(nu, 'in its owner\'s base');
  assert.equal(g.objects[nu!].controller, P1);
});

test('RJ#8130 Portal Rescue as the first card re-plays Darius: Trifarian (2nd card) and Executioner (Legion) both ready', () => {
  for (const name of ['Darius, Trifarian', 'Darius, Executioner']) {
    let g = S0();
    fundAll(g, P0, 2);
    const d = put(g, P0, name, 'base', { ready: false });
    [g] = cast(g, P0, 'Portal Rescue', { targets: [[d]] });
    for (let i = 0; i < 10 && g.pending && g.pending.kind !== 'mainAction'; i++) g = pend(g).kind === 'optional' ? yes(g) : pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
    const nd = g.players[0].base.find(id => g.objects[id].cardId === cid(name))!;
    assert.equal(g.objects[nd].exhausted, false, `${name} readied`);
  }
});

test('RJ#8131 Wielder of Water defending with a facedown card is still alone (+2); once the hidden unit is played it is not', () => {
  let g = S0({ tp: P1 });
  const w = put(g, P0, 'Wielder of Water', BF_A); control(g, BF_A, P0);
  const h = put(g, P0, 'HidU(1)', { facedown: BF_A });
  const a = put(g, P1, 'V(9)', 'base');
  g = move(g, P1, [a], BF_A);
  assert.equal(mightOf(g, w), 4);
  if (pend(g).player === P1) g = pass(g);
  g = play(g, P0, h, { dest: BF_A });
  g = resolveChain(g);
  assert.equal(locOf(g, h), BF_A);
  assert.equal(mightOf(g, w), 2);
});

// RJ#8134 DECIDED (docs/riftjudge/DECISIONS.md): MISMATCH-RJ. CR 1.5 808.1.d.2: the Deathknell "will be added to the chain as a
// Pending Item before the card is moved to the trash"; 309.1 "If a Chain exists, the turn is in a Closed State"; 323.5 loses control
// only "if the turn is in an Open State" — so in that cleanup control (and the hidden card, 323.6) is kept and the hidden card can be
// played in response to the Deathknell. Same as RJ#10434 (+ #7086, #8150, #1972, #9010, #9690 verified).
test('RJ#8134 my only unit dies to a spell: its Deathknell is on the chain, so I still control the battlefield and can play the facedown card in response (CR 808.1.d.2, 309.1, 323.5)', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P1, 2); fundAll(g, P0, 2);
  const ek = put(g, P0, 'Ekko, Recurrent', BF_A); control(g, BF_A, P0);
  const hid = put(g, P0, 'HidU(2)', { facedown: BF_A });
  [g] = cast(g, P1, 'KillA', { targets: [[ek]] });
  g = pass(g); g = pass(g);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = act(g, legal(g, pend(g).player)[0]); // Ekko's Deathknell: base cost (recycle me) accepted
  assert.notEqual(zone(g, ek), 'battlefield');
  assert.ok(g.chain.length >= 1, 'Deathknell on the chain');
  assert.equal(zone(g, hid), 'facedown', 'facedown card still there');
  assert.equal(g.battlefields[BF_A].controller, P0, 'control kept while the chain exists');
  for (let i = 0; i < 4 && pend(g).player !== P0; i++) g = pass(g);
  assert.ok(canPlayNow(g, P0, hid), 'the hidden card may be played in response');
});

test('RJ#8135 Repeat is an optional cost paid on play; the spell is one chain item and repeats with no window in between', () => {
  let g = S0();
  fundAll(g, P0, 3);
  const e = put(g, P1, 'V(5)', 'base');
  const bb = hand(g, P0, 'Bellows Breath');
  g = act(g, { type: 'playCard', player: P0, obj: bb });
  for (let i = 0; i < 6 && pend(g).inStep; i++) g = pend(g).kind === 'optional' ? yes(g) : pend(g).kind === 'chooseTargets' ? choose(g, e) : choose(g, optionIds(g)[0]);
  assert.equal(g.chain.length, 1);
  g = pass(g); g = pass(g);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = pend(g).kind === 'chooseTargets' ? choose(g, e) : choose(g, optionIds(g)[0]);
  g = resolveChain(g);
  assert.equal(g.objects[e].damage, 2, 'both instances, one chain item');
});

test('RJ#8137 after a conquer with no conquer trigger there is no Reaction window; with one (Qiyana) there is', () => {
  let g = S0();
  fundAll(g, P1, 1);
  hand(g, P1, 'Gust');
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_A); g = passAll(g);
  assert.equal(g.players[0].points, 1);
  expectPending(g, 'mainAction', P0);
  let h = S0();
  fundAll(h, P1, 1);
  const gu = hand(h, P1, 'ZapR');
  const q = put(h, P0, 'Qiyana, Victorious', 'base');
  h = move(h, P0, [q], BF_A);
  for (let i = 0; i < 6 && pend(h).kind === 'showdownAction'; i++) h = pass(h);
  for (let i = 0; i < 4 && pend(h).inStep; i++) h = choose(h, optionIds(h)[0]);
  assert.ok(h.chain.length >= 1, 'Qiyana conquer trigger on the chain');
  if (pend(h).player === P0) h = pass(h);
  expectPending(h, 'chainResponse', P1);
  assert.ok(canPlayNow(h, P1, gu));
});

test('RJ#8138 Black Market Broker triggers on playing a hidden (facedown) card', () => {
  let g = S0();
  put(g, P0, 'Black Market Broker', 'base');
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const h = put(g, P0, 'HidU(2)', { facedown: BF_A });
  g = play(g, P0, h, { dest: BF_A });
  g = resolveChain(g);
  assert.ok(Object.values(g.objects).some(o => o.isToken && o.controller === P0 && g.cards[o.cardId]?.name === 'Gold' && o.zone === 'base'));
});

test('RJ#8139 Discipline needs a unit to target; it cannot be played just to draw', () => {
  const g = S0();
  fundAll(g, P0, 1);
  const d = hand(g, P0, 'Discipline');
  assert.ok(!canPlayNow(g, P0, d));
  put(g, P0, 'V(1)', 'base');
  assert.ok(canPlayNow(g, P0, d));
});

test('RJ#8141 a gear ability choosing an enemy Deflect unit pays the tax; choosing my own Deflect unit does not', () => {
  const run = (enemy: boolean) => {
    let g = S0();
    const toe = put(g, P0, 'Tools of Empire', 'base');
    const d = put(g, enemy ? P1 : P0, 'Deflect(3,1)', 'base');
    const rd0 = g.players[0].runeDeck.length;
    g = act(g, legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === toe)!);
    for (let i = 0; i < 4 && pend(g).inStep; i++) g = pend(g).kind === 'chooseTargets' ? choose(g, d) : pend(g).kind === 'optional' ? yes(g) : choose(g, optionIds(g)[0]);
    return g.players[0].runeDeck.length - rd0;
  };
  assert.equal(run(true), 1);
  assert.equal(run(false), 0);
});

test('RJ#8142 a standard move exhausts; a readied Ganking unit can move again and conquer a second battlefield', () => {
  let g = S0();
  fundAll(g, P0, 3);
  const u = put(g, P0, 'Ganker(2)', 'base');
  g = move(g, P0, [u], BF_A); g = toStep(g);
  assert.equal(g.objects[u].exhausted, true);
  assert.equal(moveDests(g, P0, u).length, 0, 'exhausted: no standard move');
  [g] = cast(g, P0, 'First Mate', { dest: 'base', targets: [[u]] });
  g = answer(g, { targets: [[u]] }); g = resolveChain(g); g = toStep(g);
  assert.equal(g.objects[u].exhausted, false);
  g = move(g, P0, [u], BF_B); g = toStep(g);
  assert.equal(g.players[0].points, 2);
});

test('RJ#8143 a -1 Might effect is not damage for Imperial Decree', () => {
  let g = S0();
  fundAll(g, P0, 3); addRunes(g, P0, 2, 'order');
  const e = put(g, P1, 'V(4)', 'base');
  [g] = cast(g, P0, 'Imperial Decree'); g = resolveChain(g);
  [g] = cast(g, P0, 'Stupefy', { targets: [[e]] }); g = resolveChain(g); g = toStep(g);
  assert.equal(zone(g, e), 'base');
  assert.equal(mightOf(g, e), 3);
});

test('RJ#8145 Obelisk of Power: first player channels 2+1 = 3, second player 3+1 = 4 on their first turns', () => {
  const ob = realCard('Obelisk of Power');
  let g = createGame({ seed: 3, cardDb: { ...fixtureDb(), [ob.id]: ob }, firstPlayer: P0, skipMulligan: true, validateDecks: false, battlefieldSelection: 'random', includeAllCards: true,
    players: [{ name: 'A', deck: legalDeck({}, [ob.id, ob.id, ob.id]) }, { name: 'B', deck: legalDeck({}, ['cf-bf-d', 'cf-bf-e', 'cf-bf-f']) }] });
  const seen: number[] = [];
  for (let i = 0; i < 30 && g.pending && seen.length < 2; i++) {
    const d = pend(g);
    if (d.kind === 'mainAction') { seen.push(g.players[d.player].runesInPlay.length); g = act(g, { type: 'endTurn', player: d.player }); continue; }
    g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: [d.options![0].id] }) : pass(g);
  }
  assert.deepEqual(seen, [3, 4]);
});

test('RJ#8151 a unit I control but don\'t own goes to its owner\'s trash when it dies', () => {
  let g = S0();
  const u = put(g, P1, 'V(2)', 'base', { controller: P0, damage: 1 });
  [g] = cast(g, P0, 'ZapA', { targets: [[u]] }); g = resolveChain(g); g = toStep(g);
  assert.equal(zone(g, u), 'trash');
  assert.ok(g.players[1].trash.includes(u));
  assert.ok(!g.players[0].trash.includes(u));
});

test('RJ#8152 after Reaver\'s Row sends my only defender to base, I can still play my hidden card there during the showdown', () => {
  let g = S0({ bfA: "Reaver's Row" });
  fundAll(g, P1, 1);
  const d = put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const hz = put(g, P1, 'HidZap', { facedown: BF_A });
  const a = put(g, P0, 'V(5)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 6 && pend(g).inStep; i++) g = pend(g).kind === 'optional' ? yes(g) : choose(g, d);
  g = resolveChain(g);
  assert.equal(locOf(g, d), 'base');
  if (pend(g).player === P0) g = pass(g);
  expectPending(g, 'showdownAction', P1);
  assert.equal(zone(g, hz), 'facedown');
  assert.ok(canPlayNow(g, P1, hz));
});

test('RJ#8153 Icathian Rain at Void Gate: each of the six 2-damage instances gets +1 (18 total)', () => {
  let g = S0({ bfA: 'Void Gate' });
  fundAll(g, P0, 5);
  const e = put(g, P1, 'V(12)', BF_A); control(g, BF_A, P1);
  mod(g, e, { might: 10 });
  const ir = hand(g, P0, "Icathian Rain, Kai'Sa");
  g = act(g, { type: 'playCard', player: P0, obj: ir });
  for (let i = 0; i < 40 && g.pending && g.pending.kind !== 'mainAction'; i++) g = pend(g).kind === 'chooseTargets' ? choose(g, e) : pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(g.objects[e].damage, 18);
});

test('RJ#8155 Unforgiven (Yasuo legend) moves exactly one unit, exhausted or not', () => {
  let g = S0();
  const L = legend(g, P0, 'Unforgiven');
  const a = put(g, P0, 'V(1)', 'base', { ready: false }); put(g, P0, 'V(1)', 'base', { ready: false });
  g = act(g, legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === L)!);
  const p = pend(g);
  assert.equal(p.kind, 'chooseTargets');
  assert.equal(p.max ?? 1, 1, 'one unit');
  assert.ok(optionIds(g).includes(a), 'exhausted unit is fine');
});

test('RJ#8157 equipping Svellsongur to Irelia, Fervent: her "when you choose me" fires once (the copy isn\'t attached yet)', () => {
  let g = S0();
  fundAll(g, P0, 3);
  const ir = put(g, P0, 'Irelia, Fervent', 'base');
  const sv = put(g, P0, 'Svellsongur', 'base');
  g = act(g, legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === sv)!);
  g = answer(g, { targets: [[ir]] });
  for (let i = 0; i < 12 && g.pending && g.pending.kind !== 'mainAction'; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(g.objects[sv].attachedTo, ir);
  assert.equal(mightOf(g, ir), 5, '4 + 1 (once); Svellsongur itself adds 0');
});

test('RJ#8160 an already-buffed Sett, Brawler conquers Monastery of Hirana: spend the buff to draw, then his conquer trigger re-buffs him', () => {
  let g = S0({ bfA: 'Monastery of Hirana' });
  const s = put(g, P0, 'Sett, Brawler', 'base', { buff: true });
  const h0 = g.players[0].hand.length;
  g = move(g, P0, [s], BF_A);
  for (let i = 0; i < 14 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'optional') g = yes(g); else g = d.inStep ? choose(g, optionIds(g)[0]) : pass(g);
  }
  assert.equal(g.players[0].hand.length, h0 + 1);
  assert.equal(g.objects[s].counters.buff, 1);
});

test('RJ#8162 (official: CR 312.2.c, 340) only the defender\'s Reaver\'s Row trigger on the opening chain: its controller gets priority; afterwards the attacker has focus', () => {
  let g = S0({ bfA: "Reaver's Row" });
  put(g, P1, 'V(3)', BF_A); put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(5)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = pend(g).kind === 'optional' ? yes(g) : choose(g, optionIds(g)[0]);
  assert.equal(g.chain.length, 1);
  expectPending(g, 'chainResponse', P1, 'controller of the newest item');
  g = resolveChain(g);
  expectPending(g, 'showdownAction', P0, 'attacker keeps focus');
});

test('RJ#8164 one standard move can take units from different origins (Ganking unit at a battlefield + a base unit) to one destination', () => {
  let g = S0();
  const gk = put(g, P0, 'Ganker(2)', BF_A); control(g, BF_A, P0);
  const b = put(g, P0, 'V(2)', 'base');
  assert.equal(validateAction(g, { type: 'move', player: P0, units: [gk, b], to: BF_B }), null);
  g = move(g, P0, [gk, b], BF_B); g = toStep(g);
  assert.equal(locOf(g, gk), BF_B); assert.equal(locOf(g, b), BF_B);
});

test('RJ#8166 Unyielding Spirit prevents Yasuo, Remorseful\'s subject-less "deal damage" ability', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0, 2);
  const d = put(g, P0, 'V(9)', BF_A); control(g, BF_A, P0);
  [g] = cast(g, P1, 'DrawR'); g = pass(g);
  [g] = cast(g, P0, 'Unyielding Spirit'); g = resolveChain(g);
  const y = put(g, P1, 'Yasuo, Remorseful', 'base');
  g = move(g, P1, [y], BF_A);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = choose(g, optionIds(g)[0]);
  g = resolveChain(g);
  assert.equal(g.objects[d].damage, 0);
});

test('RJ#8168 Viktor, Leader (yellow): a unit dies in a winning attack -> the Recruit is played into base', () => {
  let g = S0();
  put(g, P0, 'Viktor, Leader', 'base');
  const d = put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const a1 = put(g, P0, 'V(1)', 'base'); const a2 = put(g, P0, 'V(3)', 'base');
  g = move(g, P0, [a1, a2], BF_A);
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const p = pend(g);
    if (p.kind === 'assignDamage') g = act(g, { type: 'assignDamage', player: p.player, assignment: p.player === P1 ? { [a1]: 1 } : { [d]: 4 } });
    else g = p.inStep ? choose(g, optionIds(g)[0]) : pass(g);
  }
  assert.equal(zone(g, a1), 'trash');
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.ok(g.players[0].base.some(id => g.objects[id].isToken));
});

test('RJ#8172 Hand of Noxus adds [1] energy (not a rune), only with Legion (after another card this turn)', () => {
  let g = S0();
  const L = legend(g, P0, 'Hand of Noxus');
  setRunes(g, P0, 1);
  const v2 = hand(g, P0, 'V(2)');
  assert.ok(!canPlayNow(g, P0, v2), 'first card: no Legion, only 1 energy');
  [g] = cast(g, P0, 'V(1)', { dest: 'base' }); g = toStep(g);
  setRunes(g, P0, 1);
  assert.ok(canPlayNow(g, P0, v2), 'Legion: rune + legend = 2 energy');
  g = play(g, P0, v2, { dest: 'base' }); g = toStep(g);
  assert.equal(zone(g, v2), 'base');
  assert.equal(g.objects[L].exhausted, true);
  assert.equal(g.players[0].runesInPlay.length, 1, 'no rune added');
});

test('RJ#8173 Zhonya\'s Hourglass is mandatory: no "may" prompt', () => {
  let g = S0();
  put(g, P0, "Zhonya's Hourglass", 'base');
  const u = put(g, P0, 'V(2)', 'base', { damage: 1 });
  [g] = cast(g, P0, 'ZapA', { targets: [[u]] });
  g = pass(g); g = pass(g);
  assert.ok(!(pend(g).kind === 'optional'), 'not optional');
  g = toStep(g);
  assert.equal(zone(g, u), 'base');
});

test('RJ#8175 Baited Hook kills a buffed unit: Vanguard Helm\'s trigger finalizes before the found unit is played, so it cannot choose it', () => {
  let g = S0();
  fundAll(g, P0, 3);
  const hook = put(g, P0, 'Baited Hook', 'base');
  put(g, P0, 'Vanguard Helm', 'base');
  const k = put(g, P0, 'V(2)', 'base', { buff: true });
  const v1 = put(g, P0, 'V(1)', 'base');
  const found = put(g, P0, 'V(3)', 'deckTop');
  g = act(g, legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === hook)!);
  let helmOptions: string[] | null = null;
  for (let i = 0; i < 24 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'chooseTargets' && d.options!.some(o => o.id === k) && zone(g, k) !== 'trash') { g = choose(g, k); continue; }
    if (d.kind === 'chooseTargets' && /buff/i.test(d.prompt)) { helmOptions = optionIds(g); g = choose(g, optionIds(g)[0]); continue; }
    if (d.options?.some(o => o.id === found)) { g = choose(g, found); continue; }
    if (d.kind === 'optional') { g = yes(g); continue; }
    if (d.kind === 'chooseDestination') { g = choose(g, 'base'); continue; }
    g = d.inStep ? choose(g, ...(d.options ?? []).slice(0, d.min ?? 1).map(o => o.id)) : pass(g);
  }
  // with the found unit not yet on the board, V(1) is Helm's only choice (auto-chosen, so possibly no decision)
  assert.ok(!(helmOptions ?? []).includes(found), 'the found unit was not yet on the board');
  assert.equal(zone(g, found), 'base', 'the found unit was played');
  assert.equal(g.objects[v1].counters.buff, 1, 'Helm buffed the unit that was on the board');
  assert.ok(!(g.objects[found].counters.buff > 0), 'not the found unit');
});

test('RJ#8178 Miss Fortune, Captain moving with another unit can ready that unit (ready at the battlefield)', () => {
  let g = S0();
  const mf = put(g, P0, 'Miss Fortune, Captain', 'base');
  const o = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [mf, o], BF_A);
  for (let i = 0; i < 10 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'optional') g = yes(g);
    else if (d.kind === 'chooseTargets' && d.options!.some(x => x.id === o)) g = choose(g, o);
    else g = d.inStep ? choose(g, optionIds(g)[0]) : pass(g);
  }
  assert.equal(locOf(g, o), BF_A);
  assert.equal(g.objects[o].exhausted, false);
});

test('RJ#8181 Last Rites cannot be equipped without 2 cards in the trash to recycle', () => {
  const g = S0();
  fundAll(g, P0, 2);
  const lr = put(g, P0, 'Last Rites', 'base');
  put(g, P0, 'V(1)', 'base');
  put(g, P0, 'V(1)', 'trash');
  const can = () => legal(g, P0, 'activate').some(x => x.type === 'activate' && x.obj === lr);
  assert.ok(!can(), 'only 1 card in trash');
  put(g, P0, 'V(1)', 'trash');
  assert.ok(can());
});

test('RJ#8186 after Possession takes Darius, Trifarian, Possession counts as my first card: my next card triggers him', () => {
  let g = S0();
  fundAll(g, P0, 3); addRunes(g, P0, 4, 'chaos');
  const dz = put(g, P1, 'Darius, Trifarian', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'Possession', { targets: [[dz]] }); g = resolveChain(g); g = toStep(g);
  assert.equal(g.objects[dz].controller, P0);
  g.objects[dz].exhausted = true; g.timestamp++;
  [g] = cast(g, P0, 'V(1)', { dest: 'base' }); g = resolveChain(g); g = toStep(g);
  assert.equal(g.objects[dz].exhausted, false);
  assert.equal(mightOf(g, dz), 7);
});

test('RJ#8188 a non-combat showdown does not heal units', () => {
  let g = S0();
  fundAll(g, P0, 1);
  const o = put(g, P0, 'V(5)', BF_B, { damage: 2 }); control(g, BF_B, P0);
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_A); g = toStep(g);
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.objects[o].damage, 2);
});

test('RJ#8201 a unit stunned at one battlefield stays stunned after moving to another: it deals no combat damage there', () => {
  let g = S0();
  // (stunned earlier this turn elsewhere, now in base; a standard move from a battlefield goes to base)
  const u = put(g, P0, 'V(3)', 'base', { stunned: true });
  const d = put(g, P1, 'V(2)', BF_B); control(g, BF_B, P1);
  g = move(g, P0, [u], BF_B); g = toStep(g);
  for (let i = 0; i < 6 && pend(g).inStep; i++) { g = choose(g, ...(pend(g).options ?? []).slice(0, pend(g).min ?? 1).map(o => o.id)); g = toStep(g); }
  assert.equal(zone(g, d), 'battlefield');
  assert.equal(g.objects[d].damage, 0, 'stunned attacker dealt no damage');
  assert.equal(g.objects[u].stunned, true);
});

test('RJ#8203 Baited Hook\'s kill replaced by Zhonya\'s Hourglass: no unit was killed, so nothing can be played from the top 5', () => {
  let g = S0();
  fundAll(g, P0);
  const bh = put(g, P0, 'Baited Hook', 'base');
  const zh = put(g, P0, "Zhonya's Hourglass", 'base');
  const u = put(g, P0, 'V(2)', 'base');
  for (let i = 0; i < 5; i++) put(g, P0, 'V(1)', 'deckTop');
  g = act(g, legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === bh)!);
  for (let i = 0; i < 3 && g.pending?.inStep; i++) g = choose(g, u);
  for (let i = 0; i < 20; i++) {
    const d = g.pending!; if (d.kind === 'mainAction') break;
    if (d.kind === 'optional') { g = choose(g, 'yes'); continue; }
    if (d.inStep) assert.ok(!(d.options ?? []).some(o => g.objects[o.id] && g.cards[g.objects[o.id].cardId].name === 'V(1)'), 'no V(1) offered');
    g = d.inStep ? choose(g, ...(d.options ?? []).slice(0, d.min ?? 0).map(o => o.id)) : pass(g);
  }
  assert.equal(zone(g, zh), 'trash');
  assert.equal(zone(g, u), 'base', 'saved');
  const onBoard = Object.values(g.objects).filter(o => o.owner === P0 && (o.zone === 'base' || o.zone === 'battlefield') && g.cards[o.cardId].name === 'V(1)');
  assert.equal(onBoard.length, 0, 'no unit played');
});

test('RJ#8211 (MISMATCH-RJ) Dropboarder\'s "if you control two or more gear" is part of its trigger condition (CR 383.2.a.1): with one gear it never triggers, so a gear played afterwards cannot ready it', () => {
  const run = (gears: number) => {
    let g = S0(); fundAll(g, P0, 6);
    for (let i = 0; i < gears; i++) put(g, P0, 'Cloth Armor', 'base');
    const db = hand(g, P0, 'Dropboarder');
    g = play(g, P0, db, { dest: 'base' });
    const triggered = g.chain.length > 0;
    put(g, P0, 'Cloth Armor', 'base'); // a second gear arrives before anything resolves (stand-in for a Quick-Draw response)
    g = resolveChain(g); g = toStep(g);
    return { triggered, exhausted: g.objects[db].exhausted };
  };
  const one = run(1);
  assert.equal(one.triggered, false, 'no trigger with only one gear');
  assert.equal(one.exhausted, true);
  const two = run(2);
  assert.equal(two.triggered, true);
  assert.equal(two.exhausted, false);
});

test('RJ#8216 (MISMATCH-RJ) defender retreats via Reaver\'s Row, then Ride the Wind brings a unit back and wins: control was never lost mid-combat, so no conquer/score', () => {
  let g = S0({ bfA: "Reaver's Row" });
  fundAll(g, P1, 3); addRunes(g, P1, 2, 'chaos');
  const d = put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const big = put(g, P1, 'V(8)', 'base');
  const a = put(g, P0, 'V(5)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 6 && pend(g).inStep; i++) g = pend(g).kind === 'optional' ? yes(g) : choose(g, d);
  g = resolveChain(g);
  assert.equal(locOf(g, d), 'base');
  if (pend(g).player === P0) g = pass(g);
  expectPending(g, 'showdownAction', P1);
  assert.equal(g.battlefields[BF_A].controller, P1, 'still controlled during the combat (CR 323.5)');
  const rw = hand(g, P1, 'Ride the Wind');
  g = act(g, { type: 'playCard', player: P1, obj: rw });
  for (let i = 0; i < 40 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const p = pend(g);
    if (p.kind === 'chooseTargets' && p.options!.some(o => o.id === big)) g = choose(g, big);
    else if (p.kind === 'chooseDestination') g = choose(g, String(BF_A));
    else g = p.inStep ? choose(g, ...(p.options ?? []).slice(0, p.min ?? 1).map(o => o.id)) : pass(g);
  }
  assert.equal(zone(g, a), 'trash');
  assert.equal(locOf(g, big), BF_A);
  assert.equal(g.battlefields[BF_A].controller, P1);
  assert.equal(g.players[1].points, 0, 'no conquer point for the defender');
});

test('RJ#8220 two Dazzling Auroras on one chain: Deadbloom Predator goes to an occupied enemy battlefield; the second unit can only go to base; the combat starts after both resolve', () => {
  let g = S0();
  put(g, P0, 'Dazzling Aurora', 'base'); put(g, P0, 'Dazzling Aurora', 'base');
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const v = put(g, P0, 'V(1)', 'deckTop');
  const db = put(g, P0, 'Deadbloom Predator', 'deckTop');
  g = endTurn(g, P0);
  let dbOffered: string[] = []; let vOffered: string[] | null = null; let vLocAtShowdown: unknown = 'unset';
  for (let i = 0; i < 40 && !(pend(g).kind === 'mainAction' && pend(g).player === P1); i++) {
    const d = pend(g);
    if (g.showdown && vLocAtShowdown === 'unset') vLocAtShowdown = locOf(g, v);
    if (d.kind === 'chooseDestination' && d.player === P0) {
      const ids = d.options!.map(o => o.id);
      if (/Deadbloom/.test(d.prompt)) { dbOffered = ids; g = choose(g, String(BF_A)); } else { vOffered = ids; g = choose(g, ids[0]); }
      continue;
    }
    g = d.inStep ? choose(g, ...(d.options ?? []).slice(0, Math.max(1, d.min ?? 0)).map(o => o.id)) : pass(g);
  }
  assert.ok(dbOffered.includes(String(BF_A)), 'Deadbloom may go to the enemy battlefield');
  if (vOffered) assert.ok(!(vOffered as string[]).includes(String(BF_A)), 'second unit not offered the Deadbloom battlefield');
  assert.equal(vLocAtShowdown, 'base', 'second unit already played (to base) when the showdown begins');
  void db;
});

test('RJ#8226 Rek\'Sai stolen by Hostile Takeover in response to her "When I attack": the trigger stays controlled by the attacker', () => {
  let g = S0();
  fundAll(g, P1, 4); addRunes(g, P1, 2, 'chaos');
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const ht = put(g, P1, 'Hostile Takeover', { facedown: BF_A });
  const rs = put(g, P0, 'sfd-170-221', 'base'); // Rek'Sai (attack trigger)
  put(g, P0, 'V(1)', 'deckTop'); put(g, P0, 'V(1)', 'deckTop');
  g = move(g, P0, [rs], BF_A);
  for (let i = 0; i < 6 && pend(g).inStep; i++) g = pend(g).kind === 'optional' ? yes(g) : choose(g, optionIds(g)[0]);
  const item = g.chain.find(c => c.source === rs);
  assert.ok(item, 'attack trigger on the chain');
  for (let i = 0; i < 4 && pend(g).player !== P1; i++) g = pass(g);
  g = play(g, P1, ht, { targets: [[rs]] });
  g = pass(g); g = pass(g); // Takeover resolves
  assert.equal(g.objects[rs].controller, P1);
  const left = g.chain.find(c => c.source === rs);
  assert.ok(left, 'attack trigger still on the chain');
  assert.equal(left!.controller, P0);
});

test('RJ#8229 Lucian (sfd-113) readies only on his first conquer each turn: after Relentless Pursuit returns him and he conquers again, he stays exhausted', () => {
  let g = S0();
  fundAll(g, P0, 4);
  const l = put(g, P0, 'sfd-113-221', 'base', { ready: false });
  const rp = hand(g, P0, 'Relentless Pursuit');
  g = play(g, P0, rp, { targets: [[l]], locations: [BF_A] });
  const drive = () => {
    for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
      const d = pend(g);
      if (d.kind === 'optional') g = yes(g);
      else if (d.kind === 'chooseDestination') g = choose(g, d.options!.some(o => o.id === 'base') ? 'base' : d.options![0].id);
      else g = d.inStep ? choose(g, ...(d.options ?? []).slice(0, Math.max(1, d.min ?? 0)).map(o => o.id)) : pass(g);
    }
  };
  drive();
  assert.equal(g.players[0].points, 1, 'conquered BF-A');
  assert.equal(locOf(g, l), 'base');
  assert.equal(g.objects[l].exhausted, false, 'readied by the first conquer');
  g = move(g, P0, [l], BF_B); drive();
  assert.equal(g.players[0].points, 2, 'conquered BF-B');
  assert.equal(g.objects[l].exhausted, true, 'no ready on the second conquer');
});

test('RJ#8230 Volibear, Furious killed by a hidden Hidden Blade in response to his attack trigger: "here" no longer exists, no damage', () => {
  let g = S0();
  const d = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const hb = put(g, P1, 'Hidden Blade', { facedown: BF_A });
  const v = put(g, P0, 'Volibear, Furious', 'base');
  g = move(g, P0, [v], BF_A);
  for (let i = 0; i < 6 && pend(g).inStep; i++) g = choose(g, ...(pend(g).options ?? []).filter(o => o.id === d || !(pend(g).options ?? []).some(x => x.id === d)).slice(0, 1).map(o => o.id));
  assert.ok(g.chain.some(c => c.source === v), 'attack trigger on the chain');
  for (let i = 0; i < 4 && pend(g).player !== P1; i++) g = pass(g);
  g = play(g, P1, hb, { targets: [[v]] });
  for (let i = 0; i < 20 && g.chain.length; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(zone(g, v), 'trash');
  assert.equal(g.objects[d].damage, 0, 'no split damage');
});

test('RJ#8231 Cleave (Action) cannot be played while Reaver\'s Row\'s defend trigger is on the chain, but the attacker can play it once the trigger has resolved', () => {
  let g = S0({ bfA: "Reaver's Row" });
  fundAll(g, P0, 2);
  const d = put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  put(g, P1, 'V(1)', BF_A);
  const a = put(g, P0, 'V(5)', 'base');
  const cl = hand(g, P0, 'Cleave');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 6 && pend(g).inStep; i++) g = pend(g).kind === 'optional' ? yes(g) : choose(g, d);
  assert.ok(g.chain.length > 0, "Reaver's Row on the chain");
  if (pend(g).player !== P0) g = pass(g);
  assert.equal(pend(g).player, P0);
  assert.ok(!canPlayNow(g, P0, cl), 'no Actions while the trigger is on the chain');
  g = resolveChain(g);
  assert.equal(locOf(g, d), 'base');
  expectPending(g, 'showdownAction', P0);
  assert.ok(canPlayNow(g, P0, cl));
});

test('RJ#8239 Thousand-Tailed Watcher changing controller while its play trigger waits: "enemy units" is still relative to the player who played it', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P1, 9);
  const mine = put(g, P0, 'V(5)', 'base');
  const theirs = put(g, P1, 'V(5)', 'base');
  const w = hand(g, P1, 'Thousand-Tailed Watcher');
  g = play(g, P1, w, { dest: 'base' });
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = choose(g, ...(pend(g).options ?? []).slice(0, pend(g).min ?? 0).map(o => o.id));
  const trig = g.chain.find(c => c.source === w);
  assert.ok(trig, 'play trigger on the chain');
  g.objects[w].controller = P0; g.ex.dirty = true; g.timestamp++; // stand-in for Possession taking it (setup)
  g = resolveChain(g); g = toStep(g);
  assert.equal(mightOf(g, mine), 2, 'the original controller\'s enemies get -3');
  assert.equal(mightOf(g, theirs), 5);
});

test('RJ#8241 Time Warp: the skipped-over opponent gets no Beginning Phase, so no hold point, until their own turn', () => {
  let g = S0();
  fundAll(g, P0, 10); addRunes(g, P0, 10, 'mind');
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  put(g, P0, 'V(2)', BF_B); control(g, BF_B, P0);
  const tw = hand(g, P0, 'Time Warp');
  g = play(g, P0, tw); g = resolveChain(g);
  g = nextTurn(g);
  assert.equal(g.activePlayer, P0, 'extra turn');
  assert.equal(g.players[1].points, 0, 'opponent scored no hold');
  assert.equal(g.players[0].points, 1, 'the extra turn\'s player holds');
  g = nextTurn(g);
  assert.equal(g.activePlayer, P1);
  assert.equal(g.players[1].points, 1);
});

test('RJ#8243 Soulgorger playing Magma Wurm from the trash: Soulgorger already entered exhausted and stays so', () => {
  let g = S0();
  fundAll(g, P0, 10); addRunes(g, P0, 6, 'body');
  const mw = put(g, P0, 'Magma Wurm', 'trash');
  const sg = hand(g, P0, 'Soulgorger');
  g = play(g, P0, sg, { dest: 'base' });
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'optional') g = yes(g);
    else if (d.kind === 'chooseTargets' && d.options!.some(o => o.id === mw)) g = choose(g, mw);
    else if (d.kind === 'chooseDestination') g = choose(g, 'base');
    else g = d.inStep ? choose(g, ...(d.options ?? []).slice(0, Math.max(1, d.min ?? 0)).map(o => o.id)) : pass(g);
  }
  assert.equal(zone(g, mw), 'base', 'Magma Wurm played from the trash');
  assert.equal(g.objects[sg].exhausted, true);
});

test('RJ#8247 (AMBIGUOUS, house = RJ) Mystic Reversal on Wind Wall: the new target for Wind Wall cannot be Mystic Reversal itself', () => {
  let g = S0();
  fundAll(g, P0, 6); fundAll(g, P1, 4);
  const u = put(g, P0, 'V(2)', 'base');
  [g] = cast(g, P0, 'Discipline', { targets: [[u]] });
  const disc = g.chain[0].id;
  g = pass(g);
  const ww = hand(g, P1, 'Wind Wall');
  g = play(g, P1, ww, { targets: [[disc]] });
  if (pend(g).player === P1) g = pass(g);
  const wwItem = g.chain.find(c => c.source === ww)!.id;
  const mr = hand(g, P0, 'Mystic Reversal');
  g = play(g, P0, mr, { targets: [[wwItem]] });
  const mrItem = g.chain.find(c => c.source === mr)!.id;
  let offered: string[] | null = null;
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'optional') { g = yes(g); continue; }
    if (d.inStep && offered === null && (d.options ?? []).some(o => o.id === disc)) offered = (d.options ?? []).map(o => o.id);
    g = d.inStep ? choose(g, ...(d.options ?? []).slice(0, Math.max(1, d.min ?? 0)).map(o => o.id)) : pass(g);
  }
  // with Mystic Reversal (and Wind Wall itself) excluded, Discipline is the only legal new target: chosen automatically
  const auto = g.log.some(l => /^\(auto\) New choice/.test(l.text) && /Discipline/.test(l.text));
  assert.ok(offered || auto, `Wind Wall's new target was chosen (${g.log.slice(-12).map(l => l.text).join(' | ')})`);
  assert.ok(!(offered ?? []).includes(mrItem), 'Mystic Reversal is not a legal new target');
  assert.ok(!(offered ?? []).includes(wwItem), 'nor Wind Wall itself');
});

test('RJ#8264 Zhonya\'s Hourglass played from hidden at one battlefield then saves a friendly unit dying elsewhere (card text: "a friendly unit")', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P1, 4);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const z = put(g, P0, "Zhonya's Hourglass", { facedown: BF_A });
  const far = put(g, P0, 'V(2)', BF_B); control(g, BF_B, P0);
  const e = put(g, P1, 'V(3)', 'base');
  [g] = cast(g, P1, 'ZapM', { targets: [[e]] });
  g = pass(g);
  g = play(g, P0, z);
  g = resolveChain(g); g = toStep(g);
  assert.equal(zone(g, z), 'base');
  [g] = cast(g, P1, 'Hidden Blade', { targets: [[far]] });
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) g = pend(g).kind === 'optional' ? yes(g) : pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(zone(g, z), 'trash', 'Hourglass used');
  assert.equal(locOf(g, far), 'base', 'unit at the other battlefield saved and recalled');
});

test('RJ#8265 no priority round at the end of a turn: with nothing on the chain, the opponent gets no window to play a Reaction (Meditation) before the next turn', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0, 3);
  hand(g, P0, 'Meditation');
  g = act(g, { type: 'endTurn', player: P1 });
  const seen: string[] = [];
  for (let i = 0; i < 20 && !(pend(g).kind === 'mainAction' && pend(g).player === P0); i++) {
    const d = pend(g); seen.push(`${d.kind}:${d.player}`);
    g = d.inStep ? choose(g, ...(d.options ?? []).slice(0, Math.max(1, d.min ?? 0)).map(o => o.id)) : pass(g);
  }
  expectPending(g, 'mainAction', P0);
  assert.deepEqual(seen, [], `no decisions between the turns (${seen.join(', ')})`);
  assert.equal(g.activePlayer, P0);
});

test('RJ#8266 two Vi, Destructive: one recycled card pays for only one Vi\'s ability', () => {
  let g = S0();
  const v1 = put(g, P0, 'Vi, Destructive', 'base');
  const v2 = put(g, P0, 'Vi, Destructive', 'base');
  put(g, P0, 'V(1)', 'trash');
  const acts = (v: ObjId) => legal(g, P0, 'activate').filter(x => x.type === 'activate' && x.obj === v);
  g = act(g, acts(v1)[0]); if (pend(g).kind === 'chooseCards') g = choose(g, optionIds(g)[0]);
  g = resolveChain(g); g = toStep(g);
  assert.equal(mightOf(g, v1), 4);
  assert.equal(mightOf(g, v2), 3);
  assert.equal(acts(v2).length, 0, 'no card left to recycle');
});

test('RJ#8270 Fiora (ogn-232) defending with Taric, Protector: Taric\'s Shield makes her 5 (Mighty), then her own Shield adds 1 → 6', () => {
  const { g, def } = attackSetup(['V(9)'], ['ogn-232-298', 'Taric, Protector']);
  assert.equal(mightOf(g, def[0]), 6);
  assert.ok(hasKeyword(g, def[0], 'Ganking'));
});

test('RJ#8273 damage from separate spells on my turn accumulates: two 2-damage spells kill a 3-Might unit', () => {
  let g = S0();
  fundAll(g, P0, 4);
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'ZapM', { targets: [[e]] }); g = resolveChain(g); g = toStep(g);
  assert.equal(g.objects[e].damage, 2);
  [g] = cast(g, P0, 'ZapM', { targets: [[e]] }); g = resolveChain(g); g = toStep(g);
  assert.equal(zone(g, e), 'trash');
});

const voliDraws = (g: GameState, f: (g: GameState) => GameState): number => {
  const h = g.players[1].hand.length;
  g = f(g);
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g);
    g = d.kind === 'chooseDestination' ? choose(g, String(BF_A)) : d.inStep ? choose(g, d.options![0].id) : pass(g);
  }
  return g.players[1].hand.length - h;
};

test('RJ#8279 (MISMATCH-RJ in part) Volibear, Imposing: "an opponent moves" = the opponent moves their own unit(s) (CR 412.4, RJ#2574): their move draws; my Charm on their unit (RJ: draws) or their Charm on my unit does not', () => {
  let g = S0(); put(g, P1, 'Volibear, Imposing', BF_B); control(g, BF_B, P1);
  const a = put(g, P0, 'V(1)', 'base');
  assert.equal(voliDraws(g, x => move(x, P0, [a], BF_A)), 1, 'opponent moves their unit');
  g = S0({ tp: P1 }); fundAll(g, P1, 3); put(g, P1, 'Volibear, Imposing', BF_B); control(g, BF_B, P1);
  const b = put(g, P0, 'V(1)', 'base');
  assert.equal(voliDraws(g, x => play(x, P1, hand(x, P1, 'Charm'), { targets: [[b]], locations: [BF_A] })), 0, 'my Charm moves an enemy unit: I am responsible, no draw (RJ said draw)');
  g = S0(); fundAll(g, P0, 3); put(g, P1, 'Volibear, Imposing', BF_B); control(g, BF_B, P1);
  const c = put(g, P1, 'V(1)', 'base');
  assert.equal(voliDraws(g, x => play(x, P0, hand(x, P0, 'Charm'), { targets: [[c]], locations: [BF_A] })), 0, 'opponent Charms my unit: no draw (RJ agrees)');
});

test('RJ#8279b (AMBIGUOUS, house = RJ#8279 + RJ#2574) Volibear, Imposing in base does not draw: "other than mine" needs him at a battlefield', () => {
  const g = S0(); put(g, P1, 'Volibear, Imposing', 'base');
  const a = put(g, P0, 'V(1)', 'base');
  assert.equal(voliDraws(g, x => move(x, P0, [a], BF_A)), 0);
});

test('RJ#8283 Blitzcrank\'s "move an enemy unit to here" uses his location on resolution: moved to base in response, the pulled unit goes to its own base', () => {
  let g = S0();
  fundAll(g, P0, 8); addRunes(g, P0, 6, 'fury');
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(2)', BF_B); control(g, BF_B, P1);
  const bz = hand(g, P0, 'Blitzcrank, Impassive');
  g = play(g, P0, bz, { dest: BF_A });
  for (let i = 0; i < 6 && pend(g).inStep; i++) g = pend(g).kind === 'optional' ? yes(g) : choose(g, e);
  assert.ok(g.chain.some(c => c.source === bz), 'hook trigger on the chain');
  if (pend(g).player !== P0) g = pass(g);
  g = play(g, P0, hand(g, P0, 'MoveR'), { targets: [[bz]] });

  for (let i = 0; i < 20 && g.chain.length; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(locOf(g, bz), 'base');
  assert.equal(locOf(g, e), 'base', 'pulled to "here" = base → its own base');
  assert.ok(g.players[1].base.includes(e));
});

test('RJ#8287 Fizz (sfd-140) playing a Repeat spell from the trash ignores only its Energy cost: Repeat must still be paid', () => {
  const run = (runes: number) => {
    let g = S0(); setRunes(g, P0, 0); addRunes(g, P0, runes, 'chaos');
    put(g, P0, 'RepeatZap', 'trash');
    const e = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
    g = play(g, P0, hand(g, P0, 'sfd-140-221'), { dest: 'base' });
    for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
      const d = pend(g);
      if (!d.inStep) { g = pass(g); continue; }
      const o = optionIds(g);
      g = choose(g, d.kind === 'optional' ? 'yes' : o.includes(e) ? e : o[0]);
    }
    return g.objects[e].damage;
  };
  assert.equal(run(3), 1, 'no energy left for Repeat: one execution');
  assert.equal(run(4), 2, 'Repeat paid with the extra energy');
});

test('RJ#8289 Azir, Ascendant (sfd-050) can use his swap ability while exhausted (no [T] in the cost), e.g. in the opponent\'s showdown', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0, 2);
  const az = put(g, P0, 'sfd-050-221', 'base', { ready: false });
  const u = put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const a = put(g, P1, 'V(3)', 'base');
  g = move(g, P1, [a], BF_A);
  for (let i = 0; i < 6 && pend(g).player !== P0; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(g.objects[az].exhausted, true);
  const acts = legal(g, P0, 'activate').filter(x => x.type === 'activate' && x.obj === az);
  assert.ok(acts.length > 0, 'activatable while exhausted');
  g = act(g, acts[0]);
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) { const d = pend(g); g = d.inStep ? choose(g, d.options!.some(o => o.id === u) ? u : d.options![0].id) : pass(g); }
  assert.equal(locOf(g, az), BF_A);
  assert.equal(locOf(g, u), 'base');
});

test('RJ#8290 using a Gold token before playing Darius, Trifarian does not make Darius the second card (tokens/abilities aren\'t cards)', () => {
  let g = S0();
  fundAll(g, P0, 3);
  const gold = put(g, P0, 'Gold', 'base');
  const ga = legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === gold);
  assert.ok(ga, 'Gold usable');
  g = act(g, ga!); g = toStep(g);
  assert.notEqual(zone(g, gold), 'base', 'Gold used (killed)');
  const dz = hand(g, P0, 'Darius, Trifarian');
  g = play(g, P0, dz, { dest: 'base' }); g = resolveChain(g); g = toStep(g);
  assert.equal(g.objects[dz].exhausted, true, 'no ready: Darius was the first card');
  assert.equal(mightOf(g, dz), 5);
});

test('RJ#8296 I Charm a stronger enemy unit onto my battlefield on my turn: it is the attacker, wins, and its controller conquers and scores', () => {
  let g = S0();
  fundAll(g, P0, 3);
  const d = put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(5)', 'base');
  g = play(g, P0, hand(g, P0, 'Charm'), { targets: [[e]], locations: [BF_A] });
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const p = pend(g);
    if (g.showdown?.isCombat && g.showdown.attacker !== undefined) assert.equal(g.showdown.attacker, P1);
    g = p.kind === 'chooseDestination' ? choose(g, String(BF_A)) : p.inStep ? choose(g, ...(p.options ?? []).slice(0, Math.max(1, p.min ?? 0)).map(o => o.id)) : pass(g);
  }
  assert.equal(zone(g, d), 'trash');
  assert.equal(g.battlefields[BF_A].controller, P1);
  assert.equal(g.players[1].points, 1, 'conquer on the opponent\'s turn');
});

test('RJ#8299 opponent Charms my unit into an empty battlefield on their turn: I conquer and score; at 7 points it is not the final point (draw instead)', () => {
  const run = (pts: number) => {
    let g = S0({ tp: P1 });
    fundAll(g, P1, 3);
    g.players[0].points = pts;
    put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
    const u = put(g, P0, 'V(2)', 'base');
    const h = g.players[0].hand.length;
    g = play(g, P1, hand(g, P1, 'Charm'), { targets: [[u]], locations: [BF_A] });
    for (let i = 0; i < 30 && g.pending && !(g.pending.kind === 'mainAction' && g.pending.player === P1); i++) {
      const p = pend(g);
      g = p.kind === 'chooseDestination' ? choose(g, String(BF_A)) : p.inStep ? choose(g, ...(p.options ?? []).slice(0, Math.max(1, p.min ?? 0)).map(o => o.id)) : pass(g);
    }
    return { ctrl: g.battlefields[BF_A].controller, pts: g.players[0].points, drew: g.players[0].hand.length - h, over: g.winner ?? null };
  };
  const a = run(0);
  assert.equal(a.ctrl, P0); assert.equal(a.pts, 1);
  const b = run(7);
  assert.equal(b.ctrl, P0); assert.equal(b.pts, 7, 'no 8th point'); assert.equal(b.drew, 1, 'draws instead'); assert.equal(b.over, null);
});

test('RJ#8301 Mystic Reversal on a Defy aimed at my spell: Defy ("a spell") has no other legal target, so it still counters my spell', () => {
  let g = S0();
  fundAll(g, P0, 6); fundAll(g, P1, 4);
  const e = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'ZapM', { targets: [[e]] });
  const zapItem = g.chain[0].id;
  g = pass(g);
  const df = hand(g, P1, 'Defy');
  g = play(g, P1, df, { targets: [[zapItem]] });
  if (pend(g).player === P1) g = pass(g);
  const dfItem = g.chain.find(c => c.source === df)!.id;
  g = play(g, P0, hand(g, P0, 'Mystic Reversal'), { targets: [[dfItem]] });
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g);
    g = d.kind === 'optional' ? yes(g) : d.inStep ? choose(g, ...(d.options ?? []).slice(0, Math.max(1, d.min ?? 0)).map(o => o.id)) : pass(g);
  }
  assert.equal(g.objects[df].owner, P1);
  assert.equal(g.objects[e].damage, 0, 'my ZapM was countered by the Defy I took');
});

test('RJ#8304 two defenders at Reaver\'s Row, one sent to base by its trigger: Mask of Foresight does not trigger (they did not defend alone)', () => {
  let g = S0({ bfA: "Reaver's Row" });
  put(g, P1, 'Mask of Foresight', 'base');
  const d1 = put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const d2 = put(g, P1, 'V(6)', BF_A);
  const a = put(g, P0, 'V(3)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 6 && pend(g).inStep; i++) g = pend(g).kind === 'optional' ? yes(g) : choose(g, (pend(g).options ?? []).some(o => o.id === d1) ? d1 : optionIds(g)[0]);
  assert.ok(!g.chain.some(c => g.objects[c.source] && g.cards[g.objects[c.source].cardId].name === 'Mask of Foresight'), 'no Mask trigger');
  g = resolveChain(g);
  assert.equal(locOf(g, d1), 'base');
  assert.equal(mightOf(g, d2), 6, 'no +1');
});

test('RJ#8312 (RJ: no answer) Draven, Audacious attacks Reaver\'s Row and the only defender retreats: the combat still resolves, Draven is the only one with units → wins (1) and conquers (1) = 2 (CR 468.3)', () => {
  let g = S0({ bfA: "Reaver's Row" });
  const d = put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const dv = put(g, P0, 'sfd-148-221', 'base');
  g = move(g, P0, [dv], BF_A);
  for (let i = 0; i < 40 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const p = pend(g);
    g = p.kind === 'optional' ? yes(g) : p.inStep ? choose(g, (p.options ?? []).some(o => o.id === d) ? d : optionIds(g)[0]) : pass(g);
  }
  assert.equal(locOf(g, d), 'base');
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[0].points, 2, 'win-a-combat point + conquer point');
});

test('RJ#8316 opponent kills my only unit at my battlefield (control lost) and moves in; I Ride the Wind a unit there and win: I conquer and score on their turn', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P1, 3); fundAll(g, P0, 3); addRunes(g, P0, 2, 'chaos');
  const mine = put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const big = put(g, P0, 'V(6)', 'base');
  const a = put(g, P1, 'V(2)', 'base');
  [g] = cast(g, P1, 'KillA', { targets: [[mine]] }); g = resolveChain(g); g = toStep(g);
  assert.equal(g.battlefields[BF_A].controller, null, 'control lost in an open state');
  g = move(g, P1, [a], BF_A);
  for (let i = 0; i < 6 && pend(g).player !== P0; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  const rw = hand(g, P0, 'Ride the Wind');
  g = act(g, { type: 'playCard', player: P0, obj: rw });
  for (let i = 0; i < 40 && g.pending && !(g.pending.kind === 'mainAction' && g.pending.player === P1); i++) {
    const p = pend(g);
    if (p.kind === 'chooseTargets' && p.options!.some(o => o.id === big)) g = choose(g, big);
    else if (p.kind === 'chooseDestination') g = choose(g, String(BF_A));
    else g = p.inStep ? choose(g, ...(p.options ?? []).slice(0, Math.max(1, p.min ?? 0)).map(o => o.id)) : pass(g);
  }
  assert.equal(zone(g, a), 'trash');
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[0].points, 1);
});

test('RJ#8318 a 1-Might unit attacking Trifarian War Camp: War Camp\'s +1 is already applied when Nine-Tailed Fox\'s -1 (min 1) is computed → 1', () => {
  let g = S0({ tp: P1, bfA: 'Trifarian War Camp' });
  legend(g, P0, 'Nine-Tailed Fox');
  put(g, P0, 'V(9)', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(1)', 'base');
  g = move(g, P1, [e], BF_A);
  for (let i = 0; i < 6 && pend(g).inStep; i++) g = choose(g, optionIds(g)[0]);
  g = resolveChain(g);
  assert.equal(mightOf(g, e), 1, '1 + 1 (War Camp) - 1 (Fox)');
});

test('RJ#8323 Miss Fortune, Captain bounced and replayed (Accelerate) is a new object: her "first time I move each turn" works again', () => {
  let g = S0();
  fundAll(g, P0, 8);
  const mf = put(g, P0, 'Miss Fortune, Captain', 'base');
  const x1 = put(g, P0, 'V(1)', 'base', { ready: false });
  const x2 = put(g, P0, 'V(1)', 'base', { ready: false });
  const drive = (pick: ObjId) => {
    for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
      const d = pend(g);
      if (d.kind === 'optional') g = yes(g);
      else if (d.inStep && (d.options ?? []).some(o => o.id === pick)) g = choose(g, pick);
      else g = d.inStep ? choose(g, ...(d.options ?? []).slice(0, Math.max(1, d.min ?? 0)).map(o => o.id)) : pass(g);
    }
  };
  g = move(g, P0, [mf], BF_A); drive(x1);
  assert.equal(g.objects[x1].exhausted, false, 'first move readies x1');
  g = play(g, P0, hand(g, P0, 'BounceM'), { targets: [[mf]] }); drive(mf);
  assert.equal(zone(g, mf), 'hand');
  g = act(g, { type: 'playCard', player: P0, obj: mf, destination: 'base' });
  drive(mf);
  assert.equal(zone(g, mf), 'base');
  assert.equal(g.objects[mf].exhausted, false, 'Accelerate paid → ready');
  g = move(g, P0, [mf], BF_B); drive(x2);
  assert.equal(g.objects[x2].exhausted, false, 'new object: first move again readies x2');
});

test('RJ#8324 two Zhonya\'s Hourglasses, one unit dies: only one Hourglass is used', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P1, 3);
  const z1 = put(g, P0, "Zhonya's Hourglass", 'base');
  const z2 = put(g, P0, "Zhonya's Hourglass", 'base');
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  [g] = cast(g, P1, 'KillA', { targets: [[u]] });
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(locOf(g, u), 'base', 'saved');
  assert.equal([z1, z2].filter(z => zone(g, z) === 'trash').length, 1);
  assert.equal([z1, z2].filter(z => zone(g, z) === 'base').length, 1);
});

test('RJ#8334 my only unit Ganks from a battlefield to the other one: I lose the first battlefield and can no longer play units there', () => {
  let g = S0();
  fundAll(g, P0, 3);
  const vi = put(g, P0, 'Vi, Destructive', BF_A); control(g, BF_A, P0);
  const nu = hand(g, P0, 'V(1)');
  assert.ok(playDests(g, P0, nu).includes(BF_A));
  g = move(g, P0, [vi], BF_B); g = toStep(g);
  for (let i = 0; i < 10 && g.pending && g.pending.kind !== 'mainAction'; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(locOf(g, vi), BF_B);
  assert.equal(g.battlefields[BF_A].controller, null);
  assert.ok(!playDests(g, P0, nu).includes(BF_A));
});

test('RJ#8335 Charm targets my buffed unit; I kill it in response and The Boss saves it (recall to base, same object): Charm still moves it from base', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P1, 3); fundAll(g, P0, 3);
  legend(g, P0, 'The Boss');
  const u = put(g, P0, 'V(2)', BF_A, { buff: true, damage: 1 }); control(g, BF_A, P0);
  put(g, P0, 'V(1)', BF_A);
  g = play(g, P1, hand(g, P1, 'Charm'), { targets: [[u]], locations: [BF_B] });
  if (pend(g).player !== P0) g = pass(g);
  g = play(g, P0, hand(g, P0, 'ZapR'), { targets: [[u]] });
  for (let i = 0; i < 30 && g.pending && !(g.pending.kind === 'mainAction'); i++) {
    const d = pend(g);
    if (d.kind === 'optional') g = yes(g);
    else if (d.kind === 'chooseDestination') g = choose(g, String(BF_B));
    else g = d.inStep ? choose(g, ...(d.options ?? []).slice(0, Math.max(1, d.min ?? 0)).map(o => o.id)) : pass(g);
    if (!g.chain.length && !g.pending?.inStep && locOf(g, u) !== BF_A) break;
  }
  assert.notEqual(zone(g, u), 'trash', 'saved by The Boss');
  assert.ok(!g.objects[u].counters.buff, 'its buff was spent by The Boss');
  assert.equal(g.objects[u].damage, 0, 'healed');
  assert.equal(locOf(g, u), BF_B, 'Charm still moved it (from base)');
});

test('RJ#8338 Yone (sfd-116) with Skyfall of Areion: his "conquer a battlefield that was uncontrolled" also counts on hold, but a held battlefield was not uncontrolled → no damage', () => {
  let g = S0({ tp: P1 });
  const y = put(g, P0, 'sfd-116-221', BF_A); control(g, BF_A, P0);
  attachNow(g, put(g, P0, 'Skyfall of Areion', 'base'), y);
  const e = put(g, P1, 'V(3)', 'base');
  g = endTurn(g, P1);
  for (let i = 0; i < 20 && !(pend(g).kind === 'mainAction' && pend(g).player === P0); i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(g.players[0].points, 1, 'held');
  assert.equal(g.objects[e].damage, 0, 'no Yone damage');
});

test('RJ#8340 (MISMATCH-RJ in part) hidden Zhonya\'s Hourglass can be played in response to Charm, but it only replaces a death: the unit is still moved and the Hourglass stays unused', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P1, 3);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  put(g, P0, 'V(1)', BF_A);
  const z = put(g, P0, "Zhonya's Hourglass", { facedown: BF_A });
  g = play(g, P1, hand(g, P1, 'Charm'), { targets: [[u]], locations: [BF_B] });
  if (pend(g).player !== P0) g = pass(g);
  assert.ok(canPlayNow(g, P0, z), 'hidden Hourglass playable in response');
  g = play(g, P0, z);
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g);
    g = d.kind === 'chooseDestination' ? choose(g, String(BF_B)) : d.inStep ? choose(g, ...(d.options ?? []).slice(0, Math.max(1, d.min ?? 0)).map(o => o.id)) : pass(g);
    if (!g.chain.length && locOf(g, u) === BF_B) break;
  }
  assert.equal(zone(g, z), 'base', 'Hourglass on the board, unused');
  assert.equal(locOf(g, u), BF_B, 'the move is not prevented');
});

test('RJ#8342 only combat heals: a damaged unit moving to an empty battlefield (non-combat showdown, conquer) keeps its damage', () => {
  let g = S0();
  const u = put(g, P0, 'V(3)', 'base', { damage: 1 });
  g = move(g, P0, [u], BF_B); g = toStep(g);
  assert.equal(g.battlefields[BF_B].controller, P0, 'conquered');
  assert.equal(g.objects[u].damage, 1, 'no heal without a combat');
});

test('RJ#8345 hidden Teemo played in response to my Sprite\'s Temporary kill keeps the battlefield: I hold it, not conquer', () => {
  let g = S0({ tp: P1 });
  const sp = put(g, P0, 'unl-t07', BF_A); control(g, BF_A, P0);
  const t = put(g, P0, 'ogn-197-298', { facedown: BF_A });
  g = endTurn(g, P1);
  fundAll(g, P0, 3);
  assert.ok(g.chain.length >= 1, 'Temporary trigger on the chain');
  for (let i = 0; i < 4 && pend(g).player !== P0; i++) g = pass(g);
  assert.ok(canPlayNow(g, P0, t), 'hidden Teemo playable in response');
  g = play(g, P0, t);
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.ok(['trash', 'gone'].includes(zone(g, sp)), 'Sprite token died');
  assert.equal(locOf(g, t), BF_A);
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[0].points, 1, 'held (1 point), no conquer');
});

test('RJ#8346 Nine-Tailed Fox triggers for every attacking enemy unit (no target → no Deflect cost), and for one moved in mid-combat by Zenith Blade', () => {
  let g = S0({ tp: P1 });
  legend(g, P0, 'Nine-Tailed Fox');
  const d = put(g, P0, 'V(9)', BF_A); control(g, BF_A, P0);
  const a1 = put(g, P1, 'Deflect(3,1)', 'base'), a2 = put(g, P1, 'V(3)', 'base');
  const late = put(g, P1, 'V(4)', 'base');
  fundAll(g, P1, 4);
  const runes = readyRunes(g, P1);
  g = move(g, P1, [a1, a2], BF_A);
  for (let i = 0; i < 6 && pend(g).inStep; i++) g = choose(g, optionIds(g)[0]);
  g = resolveChain(g);
  assert.equal(mightOf(g, a1), 2); assert.equal(mightOf(g, a2), 2);
  assert.equal(readyRunes(g, P1), runes, 'no Deflect paid');
  for (let i = 0; i < 4 && pend(g).player !== P1; i++) g = pass(g);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Zenith Blade') });
  for (let i = 0; i < 12 && (g.chain.length || pend(g).inStep); i++) {
    const p = pend(g);
    if (p.kind === 'optional') g = yes(g);
    else if (p.inStep) g = choose(g, (p.options ?? []).some(o => o.id === late) ? late : optionIds(g)[0]);
    else g = pass(g);
    if (locOf(g, late) === BF_A && !g.chain.length) break;
  }
  assert.equal(locOf(g, late), BF_A, 'moved into the combat');
  assert.equal(mightOf(g, late), 3, 'Fox triggered for the new attacker');
});

test('RJ#8347 Volibear, Furious\'s 5 split damage is extra (not part of his 9 Might); the damaged defender still deals its full Might', () => {
  let g = S0();
  const e = put(g, P1, 'V(12)', BF_A); control(g, BF_A, P1);
  const v = put(g, P0, 'Volibear, Furious', 'base');
  g = move(g, P0, [v], BF_A);
  for (let i = 0; i < 40 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'chooseTargets') g = choose(g, e);
    else if (d.kind === 'optional') g = yes(g);
    else g = d.inStep ? choose(g, ...(d.options ?? []).slice(0, Math.max(1, d.min ?? 0)).map(o => o.id)) : pass(g);
  }
  assert.equal(zone(g, e), 'trash', '5 + 9 = 14 ≥ 12 (9 alone would not kill it)');
  assert.equal(zone(g, v), 'trash', 'the damaged defender still dealt 12 to Volibear');
});

test('RJ#8348 Warwick ("I enter ready") played by Portal Rescue enters ready', () => {
  let g = S0();
  fundAll(g, P0, 3);
  const w = put(g, P0, 'Warwick', 'base', { ready: false });
  [g] = cast(g, P0, 'Portal Rescue', { targets: [[w]] });
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) g = pend(g).inStep ? choose(g, ...(pend(g).options ?? []).slice(0, Math.max(1, pend(g).min ?? 0)).map(o => o.id)) : pass(g);
  const nw = g.players[P0].base.find(o => g.cards[g.objects[o].cardId]?.name.startsWith('Warwick'))!;
  assert.ok(nw, 'Warwick back at base');
  assert.ok(!g.objects[nw].exhausted, 'entered ready');
});

test('RJ#8351 the combat cleanup heals all units everywhere: a unit damaged at another battlefield (e.g. by Challenge) heals when the combat ends', () => {
  let g = S0();
  const far = put(g, P0, 'V(4)', BF_B, { damage: 2 }); control(g, BF_B, P0);
  const fe = put(g, P1, 'V(4)', 'base', { damage: 1 });
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(3)', 'base');
  g = move(g, P0, [a], BF_A); g = toStep(g);
  for (let i = 0; i < 10 && pend(g).inStep; i++) g = choose(g, optionIds(g)[0]);
  g = toStep(g);
  assert.equal(g.battlefields[BF_A].controller, P0, 'combat over');
  assert.equal(g.activePlayer, P0, 'same turn');
  assert.equal(g.objects[far].damage, 0, 'unit at the other battlefield healed');
  assert.equal(g.objects[fe].damage, 0, 'enemy unit at base healed too');
});

test('RJ#8355 (MISMATCH-RJ in part) play units only to a battlefield you control (conquer first, then play there); killing your only unit there for Cruel Patron\'s cost keeps control (Closed state) so it lands there', () => {
  let g = S0();
  fundAll(g, P0, 6);
  const x = hand(g, P0, 'V(1)');
  assert.ok(!playDests(g, P0, x).includes(BF_A), 'not controlled yet');
  const m = put(g, P0, 'V(1)', 'base');
  g = move(g, P0, [m], BF_A); g = toStep(g);
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.ok(playDests(g, P0, x).includes(BF_A), 'conquered this turn, now playable there');
  const cp = hand(g, P0, 'Cruel Patron');
  g = act(g, { type: 'playCard', player: P0, obj: cp, destination: BF_A });
  for (let i = 0; i < 6 && pend(g).inStep; i++) g = pend(g).options!.some(o => o.id === m) ? choose(g, m) : choose(g, optionIds(g)[0]);
  g = resolveChain(g); g = toStep(g);
  assert.equal(zone(g, m), 'trash', 'only unit killed as the cost');
  assert.equal(locOf(g, cp), BF_A, 'Patron still lands there (CR 352.1, 309.1, 323.5)');
  assert.equal(g.battlefields[BF_A].controller, P0);
});

test('RJ#8356 attacker with Cleave\'s Assault 3 (5 Might) takes 3, then Rides the Wind to base: it stops being an Attacker, Assault turns off and it dies', () => {
  let g = S0();
  fundAll(g, P0, 6); fundAll(g, P1, 4);
  const a = put(g, P0, 'V(2)', 'base');
  put(g, P0, 'V(1)', 'base');
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'Cleave', { targets: [[a]] }); g = toStep(g);
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 6 && !(pend(g).kind === 'showdownAction' && pend(g).player === P1); i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(mightOf(g, a), 5, 'attacking with Assault 3');
  g = play(g, P1, hand(g, P1, 'Hextech Ray'), { targets: [[a]] });
  g = resolveChain(g);
  assert.equal(g.objects[a].damage, 3);
  assert.notEqual(zone(g, a), 'trash');
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[a]], locations: ['base' as never] });
  for (let i = 0; i < 10 && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g);
    if (d.inStep && (d.options ?? []).some(o => o.id === 'base')) g = choose(g, 'base');
    else g = d.inStep ? choose(g, optionIds(g)[0]) : pass(g);
  }
  assert.equal(zone(g, a), 'trash', '2 Might with 3 damage once it is no longer an Attacker');
});

test('RJ#8358 two Reactions in response to an enemy spell: each one\'s Ravenbloom Student trigger goes on the same chain (the enemy spell stays below)', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P1, 2); fundAll(g, P0, 3);
  const st = put(g, P0, 'Ravenbloom Student', BF_A); control(g, BF_A, P0);
  const zap = hand(g, P1, 'ZapA');
  g = play(g, P1, zap, { targets: [[st]] });
  let triggers = 0;
  for (let k = 0; k < 2; k++) {
    if (pend(g).player !== P0) g = pass(g);
    const dr = hand(g, P0, 'DrawR');
    g = play(g, P0, dr);
    for (let i = 0; i < 4 && g.chain.some(c => c.source === dr); i++) g = pass(g); // both pass: DrawR resolves
    assert.ok(g.chain.some(c => c.source === st), 'Student trigger put on the chain');
    assert.ok(g.chain.some(c => c.source === zap || (c as { obj?: ObjId }).obj === zap), 'the enemy spell is still on the chain');
    triggers++;
    for (let i = 0; i < 4 && g.chain.some(c => c.source === st); i++) g = pass(g);
  }
  assert.equal(triggers, 2);
  assert.equal(mightOf(g, st), 4, '+1 per spell');
  g = resolveChain(g);
  assert.equal(g.objects[st].damage, 2);
});

test('RJ#8361 a combat-cleanup Deathknell resolves after the heal; once the chain is empty nobody gets focus — the combat result follows with no Action window', () => {
  let g = S0();
  fundAll(g, P0, 2); fundAll(g, P1, 2);
  const a = put(g, P0, 'V(3)', 'base');
  const d = put(g, P1, 'DK(1)', BF_A); control(g, BF_A, P1);
  hand(g, P0, 'PumpA'); hand(g, P1, 'PumpA');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 20 && !(zone(g, d) === 'trash' && g.chain.length); i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(zone(g, d), 'trash');
  assert.ok(g.chain.length >= 1, 'Deathknell on the chain');
  assert.equal(g.objects[a].damage, 0, 'already healed (3c) before the Deathknell resolves');
  let sawShowdown = false;
  for (let i = 0; i < 10 && g.chain.length; i++) { g = pass(g); if (!g.chain.length && pend(g).kind === 'showdownAction') sawShowdown = true; }
  assert.ok(!sawShowdown, 'no showdown focus after the chain empties');
  assert.equal(g.battlefields[BF_A].controller, P0, 'combat finished: conquered');
  expectPending(g, 'mainAction', P0);
});

test('RJ#8363 Switcheroo on an attacker with Assault 3 (1+3 = 4) and a 1-Might defender: Assault isn\'t added on top of the swapped Might → attacker 1, defender 4', () => {
  let g = S0();
  fundAll(g, P0, 4);
  const a = put(g, P0, 'Assault(1,3)', 'base');
  const d = put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 6 && !(pend(g).kind === 'showdownAction' && pend(g).player === P0 && !g.chain.length); i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(mightOf(g, a), 4, 'attacking: 1 + Assault 3');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Switcheroo') });
  for (let i = 0; i < 6 && pend(g).inStep; i++) g = pend(g).kind === 'chooseTargets' ? choose(g, ...[a, d].filter(x => optionIds(g).includes(x)).slice(0, Math.max(1, pend(g).min ?? 1))) : choose(g, optionIds(g)[0]);
  for (let i = 0; i < 6 && g.chain.length; i++) g = pass(g);
  assert.equal(mightOf(g, a), 1);
  assert.equal(mightOf(g, d), 4);
});

test('RJ#8365 Iron Ballista ([T] ability without Action/Reaction) can\'t be used in a showdown on the opponent\'s turn (nor in my own showdown)', () => {
  const s = attackSetup(['V(3)'], ['V(2)']);
  let g = s.g;
  const ib = put(g, P1, 'Iron Ballista', 'base', { ready: true });
  const mine = put(g, P0, 'Iron Ballista', 'base', { ready: true });
  for (let i = 0; i < 4 && pend(g).player !== P1; i++) g = pass(g);
  expectPending(g, 'showdownAction', P1);
  assert.equal(legal(g, P1, 'activate').filter(x => x.type === 'activate' && x.obj === ib).length, 0);
  assert.equal(legal(g, P0, 'activate').filter(x => x.type === 'activate' && x.obj === mine).length, 0);
  const g2 = S0();
  const ib2 = put(g2, P0, 'Iron Ballista', 'base', { ready: true }); put(g2, P1, 'V(2)', BF_A);
  assert.ok(legal(g2, P0, 'activate').some(x => x.type === 'activate' && x.obj === ib2), 'usable in my main phase');
});

test('RJ#8368 Yasuo, Remorseful\'s attack target is locked when the trigger goes on the chain: moved away in response → no effect, the remaining defender takes nothing', () => {
  let g = S0({});
  fundAll(g, P1, 2);
  const t1 = put(g, P1, 'V(3)', BF_A), t2 = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const y = put(g, P0, 'Yasuo, Remorseful', 'base');
  g = move(g, P0, [y], BF_A);
  for (let i = 0; i < 6 && pend(g).inStep; i++) g = pend(g).kind === 'chooseTargets' ? choose(g, t1) : choose(g, optionIds(g)[0]);
  assert.ok(g.chain.length >= 1, 'attack trigger on the chain');
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  g = play(g, P1, hand(g, P1, 'MoveR'), { targets: [[t1]] });
  for (let i = 0; i < 8 && g.chain.length; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(locOf(g, t1), 'base');
  assert.equal(g.objects[t1].damage, 0);
  assert.equal(g.objects[t2].damage, 0, 'no retarget onto the other unit');
});

test('RJ#8370 Stacked Deck (Action) can\'t be played in response to a chain item; a Reaction can', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P1, 2); fundAll(g, P0, 4);
  const u = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  g = play(g, P1, hand(g, P1, 'ZapA'), { targets: [[u]] });
  if (pend(g).player !== P0) g = pass(g);
  expectPending(g, 'chainResponse', P0);
  assert.ok(!canPlayNow(g, P0, hand(g, P0, 'Stacked Deck')), 'Action: not in response');
  assert.ok(canPlayNow(g, P0, hand(g, P0, 'DrawR')), 'Reaction draw is fine');
});

test('RJ#8372 Teemo, Strategist counts only cards with the [Hidden] keyword, not cards that merely mention hidden', () => {
  let g = S0({ tp: P1 });
  put(g, P0, 'Teemo, Strategist', BF_A); control(g, BF_A, P0);
  for (const c of ['Ember Monk', 'Noxus Saboteur', 'ogn-197-298', 'Ava Achiever', 'ogn-094-298']) put(g, P0, c, 'deckTop');
  const a = put(g, P1, 'V(9)', 'base');
  g = move(g, P1, [a], BF_A);
  for (let i = 0; i < 20 && g.objects[a].damage === 0; i++) {
    const d = g.pending!;
    if (d.kind === 'chooseTargets') g = choose(g, a);
    else if (d.kind === 'optional') g = no(g);
    else if (d.inStep) g = choose(g, d.options![0].id);
    else if (d.kind === 'chainResponse') g = pass(g);
    else break;
  }
  assert.equal(g.objects[a].damage, 2, 'two [Hidden] cards among the five');
});

test('RJ#8373 Challenge at Void Gate: the units deal the damage, not the spell → no Bonus Damage to the unit there', () => {
  let g = S0({ bfA: 'Void Gate' });
  fundAll(g, P0, 3);
  const f = put(g, P0, 'V(4)', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(3)', 'base');
  [g] = cast(g, P0, 'Challenge', { targets: [[f], [e]] });
  if (pend(g).kind === 'chooseTargets') g = answer(g, { targets: [[e]] });
  g = resolveChain(g);
  assert.equal(g.objects[f].damage, 3, 'no +1 from Void Gate');
  assert.notEqual(zone(g, f), 'trash');
  assert.equal(zone(g, e), 'trash');
});

// RJ#8377 — MATCH (DECISIONS #2839 revised by ADJUDICATOR-2, principle 17): "I may be moved with it" uses the friend's location on resolution
// (like Tideturner's "its location", RJ#1552; Noxian Drummer's "here", RJ#7840 / CR 359.3.f); the friend killed in response → Pursuer stays.
test('RJ#8377 Stealthy Pursuer is a trigger (chain window); the friend killed in response means Pursuer is not moved', () => {
  let g = S0();
  fundAll(g, P1, 2);
  const sp = put(g, P0, 'Stealthy Pursuer', 'base');
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_A);
  if (pend(g).kind === 'optional') g = choose(g, 'yes');
  assert.ok(g.chain.some(c => c.source === sp), 'Pursuer trigger on the chain (a chain window)');
  if (pend(g).player !== P1) g = pass(g);
  g = play(g, P1, hand(g, P1, 'ZapR'), { targets: [[u]] });
  g = resolveChain(g);
  if (pend(g).kind === 'optional') g = choose(g, 'yes');
  g = resolveChain(g);
  assert.equal(zone(g, u), 'trash');
  assert.equal(locOf(g, sp), 'base');
});

test('RJ#8385 an exhausted unit can be moved into a combat by an effect (Zenith Blade) and fights as an attacker', () => {
  let g = S0();
  fundAll(g, P0, 4);
  const d = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const ex = put(g, P0, 'V(4)', 'base', { ready: false });
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Zenith Blade') });
  for (let i = 0; i < 40 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const p = pend(g);
    if (p.kind === 'optional') g = yes(g);
    else if (p.inStep) g = choose(g, (p.options ?? []).some(o => o.id === d) ? d : (p.options ?? []).some(o => o.id === ex) ? ex : optionIds(g)[0]);
    else g = pass(g);
  }
  assert.equal(zone(g, d), 'trash', 'the exhausted unit fought');
  assert.equal(locOf(g, ex), BF_A);
  assert.equal(g.battlefields[BF_A].controller, P0);
});

test('RJ#8386 a spell is on the chain (not in the trash) until it resolves, then goes to the trash', () => {
  let g = S0();
  fundAll(g, P0, 1);
  let sp: ObjId;
  [g, sp] = cast(g, P0, 'DrawR');
  assert.ok(g.chain.length >= 1);
  assert.notEqual(zone(g, sp), 'trash');
  assert.ok(!g.players[P0].trash.includes(sp));
  g = resolveChain(g);
  assert.equal(zone(g, sp), 'trash');
});

test('RJ#8388 Dragon\'s Rage\'s "do this" part is a reflexive trigger put on the chain after the move: it is not a spell, so "Counter a spell" can\'t counter it', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const x = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const y = put(g, P1, 'V(2)', BF_B); control(g, BF_B, P1);
  const cr = hand(g, P1, 'CounterR');
  [g] = cast(g, P0, "Dragon's Rage, Lee Sin", { targets: [[x]] });
  g = answer(g, { locations: [BF_B] });
  for (let i = 0; i < 12 && locOf(g, x) !== BF_B; i++) { const d = pend(g); g = d.kind === 'chooseDestination' ? choose(g, String(BF_B)) : d.inStep ? choose(g, optionIds(g)[0]) : pass(g); }
  assert.equal(locOf(g, x), BF_B, 'moved');
  for (let i = 0; i < 6 && pend(g).inStep; i++) g = choose(g, (pend(g).options ?? []).some(o => o.id === y) ? y : optionIds(g)[0]);
  assert.ok(g.chain.length >= 1 && g.chain.every(c => c.kind !== 'spell'), 'only the reflexive ability is on the chain');
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  assert.ok(!canPlayNow(g, P1, cr), 'no spell to counter');
  g = resolveChain(g);
  assert.equal(zone(g, y), 'trash', 'the 3 kills the 2');
});

test('RJ#8392 Time Warp: the opponent holding a battlefield scores no hold point (they get no turn); I hold mine in my extra turn', () => {
  let g = S0();
  fundAll(g, P0, 10); addRunes(g, P0, 10, 'mind');
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  put(g, P0, 'V(2)', BF_B); control(g, BF_B, P0);
  g = play(g, P0, hand(g, P0, 'Time Warp')); g = resolveChain(g);
  const p1 = g.players[1].points, p0 = g.players[0].points;
  g = nextTurn(g);
  assert.equal(g.activePlayer, P0, 'extra turn');
  assert.equal(g.players[1].points, p1, 'no hold point for the opponent');
  assert.equal(g.players[0].points, p0 + 1, 'I hold BF-B');
});

test('RJ#8397 a facedown card is not a unit: Wielder of Water with a hidden card beside it still defends alone (+2)', () => {
  let g = S0();
  const w = put(g, P1, 'Wielder of Water', BF_A); control(g, BF_A, P1);
  put(g, P1, 'ogn-197-298', { facedown: BF_A });
  const a = put(g, P0, 'V(1)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 6 && (pend(g).inStep || g.chain.length); i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  expectPending(g, 'showdownAction', P0);
  assert.equal(mightOf(g, w), 4, 'defending alone');
});

test('RJ#8398 Last Breath chooses its enemy unit: an enemy Deflect unit costs the Deflect tax (one more rune recycled than for a plain unit)', () => {
  const run = (enemy: string) => {
    let g = S0();
    fundAll(g, P0, 6);
    const f = put(g, P0, 'V(3)', 'base', { ready: false });
    const e = put(g, P1, enemy, BF_A); control(g, BF_A, P1);
    const r0 = g.players[0].runesInPlay.length;
    g = play(g, P0, hand(g, P0, 'Last Breath'), { targets: [[f], [e]] });
    g = resolveChain(g);
    assert.equal(g.objects[e].damage, 3);
    return r0 - g.players[0].runesInPlay.length;
  };
  assert.equal(run('Deflect(4,1)'), run('V(4)') + 1);
});

test('RJ#8399 Volibear, Imposing: an opponent moving two units in one move draws once', () => {
  const g = S0(); put(g, P1, 'Volibear, Imposing', BF_B); control(g, BF_B, P1);
  const a = put(g, P0, 'V(1)', 'base'), b = put(g, P0, 'V(1)', 'base');
  assert.equal(voliDraws(g, x => move(x, P0, [a, b], BF_A)), 1);
});

test('RJ#8402 Kato the Arm gives his current keywords (incl. gained Assault) and +Might equal to his current Might (incl. Equipment), fixed on resolution', () => {
  let g = S0();
  fundAll(g, P0, 6);
  const k = put(g, P0, 'Kato the Arm', 'base');
  const o = put(g, P0, 'V(1)', 'base');
  attachNow(g, put(g, P0, "Doran's Blade", 'base'), k);
  [g] = cast(g, P0, 'Cleave', { targets: [[k]] }); g = toStep(g);
  const km = mightOf(g, k)!;
  assert.ok(km > 3, 'Equipment bonus on Kato');
  g = move(g, P0, [k], BF_A);
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g);
    if (d.kind === 'optional') g = yes(g);
    else if (d.inStep) g = choose(g, (d.options ?? []).some(x => x.id === o) ? o : optionIds(g)[0]);
    else g = pass(g);
  }
  assert.equal(mightOf(g, o), 1 + km, '+Might equal to Kato\'s Might with Equipment');
  assert.ok(hasKeyword(g, o, 'Deflect'), 'printed keyword');
  assert.equal(kwv(g, o, 'Assault'), 3, 'gained keyword copied too');
  [g] = cast(g, P0, 'PumpA', { targets: [[k]] }); g = toStep(g);
  assert.equal(mightOf(g, o), 1 + km, 'later change to Kato does not matter');
});

test('RJ#8405 Yone (sfd-116) triggers when he conquers an uncontrolled battlefield (non-combat), not one taken from an opponent in combat', () => {
  let g = S0();
  const y = put(g, P0, 'sfd-116-221', 'base');
  const e = put(g, P1, 'V(9)', 'base');
  const drive = () => { for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) g = pend(g).inStep ? choose(g, (pend(g).options ?? []).some(o => o.id === e) ? e : optionIds(g)[0]) : pass(g); };
  g = move(g, P0, [y], BF_A); drive();
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.objects[e].damage, mightOf(g, y), 'dealt his Might to the enemy unit in base');
  let h = S0();
  const y2 = put(h, P0, 'sfd-116-221', 'base');
  const e2 = put(h, P1, 'V(9)', 'base');
  put(h, P1, 'V(1)', BF_A); control(h, BF_A, P1);
  g = move(h, P0, [y2], BF_A); drive();
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.objects[e2].damage, 0, 'battlefield was controlled → no trigger');
  void h;
});

test('RJ#8414 a negative-Might attacker counts as 0 (doesn\'t reduce the team\'s damage): 5 + (-9) still kills a 5-Might defender', () => {
  let g = S0();
  fundAll(g, P0, 6);
  const big = put(g, P0, 'V(5)', 'base'), neg = put(g, P0, 'V(1)', 'base');
  const d = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'Moonlight Affliction', { targets: [[neg]] }); g = toStep(g);
  assert.ok(mightOf(g, neg)! <= 0);
  g = move(g, P0, [big, neg], BF_A);
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const p = pend(g);
    if (p.kind === 'assignDamage' && p.player === P0) g = act(g, { type: 'assignDamage', player: P0, assignment: { [d]: 5 } });
    else if (p.kind === 'assignDamage') g = act(g, legal(g, p.player)[0]);
    else g = p.inStep ? choose(g, optionIds(g)[0]) : pass(g);
  }
  assert.equal(zone(g, d), 'trash');
  assert.equal(g.battlefields[BF_A].controller, P0);
});

test('RJ#8419 Weaponmaster is optional: with an Equipment available the player may decline (it stays where it is)', () => {
  let g = S0();
  fundAll(g, P0, 4);
  const a = put(g, P0, 'V(2)', 'base');
  const s = put(g, P0, "Doran's Blade", 'base'); attachNow(g, s, a);
  let b: ObjId;
  [g, b] = cast(g, P0, 'Weaponmaster(2)', { dest: 'base' });
  let declined = false;
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'optional') { g = no(g); declined = true; }
    else if (d.kind === 'chooseTargets' || d.kind === 'chooseCards') {
      assert.ok((d.min ?? 0) === 0, 'choosing an Equipment is optional (min 0)');
      g = act(g, { type: 'choose', player: d.player, optionIds: [] }); declined = true;
    } else g = d.inStep ? choose(g, optionIds(g)[0]) : pass(g);
  }
  assert.ok(declined, 'the player was offered the choice');
  assert.equal(g.objects[s].attachedTo, a, 'Equipment not moved');
  assert.notEqual(g.objects[s].attachedTo, b);
});

test('RJ#8421 defending Fiora (sfd-110) one on one: Punch First (Action) can\'t answer her trigger; after it resolves (3 → 6) it can be played in the showdown → 11', () => {
  let g = S0();
  fundAll(g, P1, 4);
  const f = put(g, P1, 'sfd-110-221', BF_A); control(g, BF_A, P1);
  const pf = hand(g, P1, 'Punch First');
  const a = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 6 && pend(g).inStep; i++) g = choose(g, optionIds(g)[0]);
  assert.ok(g.chain.some(c => c.source === f), 'Fiora trigger on the chain');
  for (let i = 0; i < 3 && pend(g).player !== P1 && g.chain.length; i++) g = pass(g);
  assert.ok(!canPlayNow(g, P1, pf), 'Action not playable while the trigger is on the chain');
  for (let i = 0; i < 6 && g.chain.length; i++) g = pass(g);
  assert.equal(mightOf(g, f), 6);
  for (let i = 0; i < 3 && !(pend(g).kind === 'showdownAction' && pend(g).player === P1); i++) g = pass(g);
  g = play(g, P1, pf, { targets: [[f]] }); g = resolveChain(g);
  assert.equal(mightOf(g, f), 11);
});

test('RJ#8424 Nine-Tailed Fox triggers once per unit per combat: the attacker sent to base (Fight or Flight) and Ridden back into the same combat is not hit again', () => {
  let g = S0({ tp: P1 });
  legend(g, P0, 'Nine-Tailed Fox');
  fundAll(g, P0, 6); fundAll(g, P1, 6);
  put(g, P0, 'V(9)', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(4)', 'base');
  g = move(g, P1, [e], BF_A);
  for (let i = 0; i < 6 && pend(g).inStep; i++) g = choose(g, optionIds(g)[0]);
  g = resolveChain(g);
  assert.equal(mightOf(g, e), 3);
  for (let i = 0; i < 4 && !(pend(g).kind === 'showdownAction' && pend(g).player === P0); i++) g = pass(g);
  // P1 has focus first; pass to P0
  g = play(g, P0, hand(g, P0, 'Fight or Flight'), { targets: [[e]] }); g = resolveChain(g);
  assert.equal(locOf(g, e), 'base');
  for (let i = 0; i < 4 && !(pend(g).kind === 'showdownAction' && pend(g).player === P1); i++) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Ride the Wind'), { targets: [[e]], locations: [BF_A] });
  for (let i = 0; i < 10 && (g.chain.length || pend(g).inStep); i++) { const d = pend(g); g = d.kind === 'chooseDestination' ? choose(g, String(BF_A)) : d.inStep ? choose(g, optionIds(g)[0]) : pass(g); }
  assert.equal(locOf(g, e), BF_A);
  assert.equal(mightOf(g, e), 3, 'still only -1');
});

test('RJ#8426 (MISMATCH-RJ in part) Thwonk! + Repeat on the SAME attacker: the second stun does nothing (a stunned unit can\'t be stunned again, CR 424.1.a.1) → Radiant Dawn buffs once', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0, 8);
  legend(g, P0, 'Radiant Dawn');
  const d = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const other = put(g, P0, 'V(2)', 'base');
  const a1 = put(g, P1, 'V(3)', 'base');
  g = move(g, P1, [a1], BF_A);
  for (let i = 0; i < 4 && !(g.pending?.kind === 'showdownAction' && g.pending.player === P0); i++) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Thwonk!'), { may: [true], targets: [[a1], [a1]] });
  for (let i = 0; i < 12 && (g.chain.length || pend(g).inStep); i++) {
    const p = pend(g);
    if (p.kind === 'optional') g = yes(g);
    else if (p.inStep) { const ids = optionIds(g); g = choose(g, ids.includes(other) ? other : ids.includes(d) ? d : ids.includes(a1) ? a1 : ids[0]); }
    else g = pass(g);
  }
  assert.ok(g.objects[a1].stunned);
  const buffs = (g.objects[d].counters.buff ?? 0) + (g.objects[other].counters.buff ?? 0);
  assert.equal(buffs, 1, 'only the first execution stunned something');
  assert.equal(g.log.filter(l => /^Trigger: Radiant Dawn/.test(l.text)).length, 1);
  assert.equal(g.log.filter(l => /Stun an attacking unit/.test(l.text)).length, 2, 'Repeat paid: two executions chose it');
});

test('RJ#8429 Last Rites conquer: the unit from the trash may be played to the battlefield just conquered', () => {
  let g = S0();
  fundAll(g, P0, 6);
  const u = put(g, P0, 'V(2)', 'base');
  attachNow(g, put(g, P0, 'Last Rites', 'base'), u);
  const t = put(g, P0, 'V(3)', 'trash');
  g = move(g, P0, [u], BF_A);
  let offered: string[] = [];
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'chooseTargets' && (d.options ?? []).some(o => o.id === t)) g = choose(g, t);
    else if (d.kind === 'chooseDestination') { offered = optionIds(g); g = choose(g, offered.includes(String(BF_A)) ? String(BF_A) : offered[0]); }
    else if (d.kind === 'optional') g = yes(g);
    else g = d.inStep ? choose(g, optionIds(g)[0]) : pass(g);
  }
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(locOf(g, t), BF_A, `played to the conquered battlefield (offered ${offered})`);
});

test('RJ#8431 Yasuo, Windrider moving six times in a turn scores once (only the third move)', () => {
  let g = S0();
  fundAll(g, P0, 20);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
  const y = put(g, P0, 'Yasuo, Windrider', 'base');
  const p0 = g.players[0].points;
  const dests = [BF_A, BF_B, BF_A, BF_B, BF_A, BF_B];
  const pts: number[] = [];
  for (const to of dests) {
    g = play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[y]], locations: [to] });
    for (let i = 0; i < 10 && g.pending && g.pending.kind !== 'mainAction'; i++) { const d = pend(g); g = d.kind === 'chooseDestination' ? choose(g, String(to)) : d.inStep ? choose(g, optionIds(g)[0]) : pass(g); }
    assert.equal(locOf(g, y), to);
    pts.push(g.players[0].points - p0);
  }
  assert.deepEqual(pts, [0, 0, 1, 1, 1, 1]);
});

test('RJ#8435 after playing Discipline I keep priority and may play a hidden card on top of it at once; it resolves first (a card hidden this turn can\'t be played)', () => {
  let g = S0();
  fundAll(g, P0, 6);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const hb = put(g, P0, 'ogn-197-298', { facedown: BF_A });
  put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
  const fresh = hand(g, P0, 'Sprite Call');
  g = act(g, { type: 'hide', player: P0, obj: fresh, battlefieldIndex: BF_B });
  const disc = hand(g, P0, 'Discipline');
  g = play(g, P0, disc, { targets: [[u]] });
  expectPending(g, 'chainResponse', P0);
  assert.ok(!canPlayNow(g, P0, fresh), 'hidden this turn: not yet');
  assert.ok(canPlayNow(g, P0, hb), 'hidden earlier: playable while I hold priority');
  g = play(g, P0, hb);
  for (let i = 0; i < 6 && pend(g).inStep; i++) g = choose(g, optionIds(g)[0]);
  assert.equal(locOf(g, hb), BF_A, 'the hidden unit is on the board first');
  assert.ok(g.chain.some(c => c.source === disc), 'Discipline still waiting below');
  g = resolveChain(g);
  assert.equal(mightOf(g, u), 4);
});

test('RJ#8439 (MISMATCH-RJ per principle 1, CR 468.2) Imperial Decree\'s kill from combat damage resolves before the combat result: the defender dies too, nobody wins → Glorious Executioner draws nothing', () => {
  let g = S0();
  fundAll(g, P0, 6);
  legend(g, P1, 'Glorious Executioner');
  const d = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const r = put(g, P0, 'V(1)', 'base');
  [g] = cast(g, P0, 'Imperial Decree'); g = toStep(g);
  const h1 = g.players[1].hand.length;
  g = move(g, P0, [r], BF_A);
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(zone(g, r), 'trash');
  assert.equal(zone(g, d), 'trash', 'Decree killed the damaged defender');
  assert.equal(g.players[1].hand.length, h1, 'no combat winner → no draw');
  let c = S0();
  legend(c, P1, 'Glorious Executioner');
  put(c, P1, 'V(3)', BF_A); control(c, BF_A, P1);
  const r2 = put(c, P0, 'V(1)', 'base');
  const h2 = c.players[1].hand.length;
  c = move(c, P0, [r2], BF_A);
  for (let i = 0; i < 30 && c.pending && c.pending.kind !== 'mainAction'; i++) c = pend(c).inStep ? choose(c, optionIds(c)[0]) : pass(c);
  assert.equal(c.players[1].hand.length, h2 + 1, 'control: without the Decree the defender wins and draws');
});

test('RJ#8440 an equipped unit recycled (Rumble, Hotheaded\'s conquer) leaves its gear behind, detached, at its controller\'s base', () => {
  let g = S0();
  fundAll(g, P0, 10);
  const r = put(g, P0, 'sfd-026-221', 'base');
  const v = put(g, P0, 'V(3)', BF_B); control(g, BF_B, P0);
  const blade = put(g, P0, "Doran's Blade", 'base'); attachNow(g, blade, v);
  const mm = put(g, P0, 'Mega-Mech', 'trash');
  g = move(g, P0, [r], BF_A);
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    const pick = d.kind === 'optional' ? 'yes' : o.includes(v) ? v : o.includes(mm) ? mm : o.includes('base') ? 'base' : o[0];
    g = act(g, { type: 'choose', player: d.player, optionIds: [pick] });
  }
  assert.equal(zone(g, v), 'mainDeck', 'unit recycled');
  assert.equal(g.objects[blade].attachedTo ?? null, null, 'gear detached');
  assert.equal(zone(g, blade), 'base', 'gear stays on the board at base');
});

test('RJ#8441 Salvage killing an attached Sacred Shears: the Deathknell is the unit\'s granted text, so no draw from the Shears (only Salvage\'s draw 1)', () => {
  let g = S0();
  fundAll(g, P0, 6);
  const u = put(g, P0, 'V(2)', 'base');
  const sh = put(g, P0, 'Sacred Shears', 'base'); attachNow(g, sh, u);
  const h = g.players[0].hand.length;
  const sv = hand(g, P0, 'Salvage');
  g = act(g, { type: 'playCard', player: P0, obj: sv });
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'optional') g = yes(g);
    else if (d.inStep) g = choose(g, optionIds(g).includes(sh) ? sh : optionIds(g)[0]);
    else g = pass(g);
  }
  assert.equal(zone(g, sh), 'trash');
  assert.equal(zone(g, u), 'base');
  assert.equal(g.players[0].hand.length, h + 1, 'only Salvage\'s draw 1 (Salvage was added after counting): no Shears draw');
});

test('RJ#8443 Ava Achiever attacks and plays Hostile Takeover from hand: the stolen defender becomes an Attacker with her (and the battlefield is won)', () => {
  let g = S0();
  fundAll(g, P0, 6);
  const ava = put(g, P0, 'Ava Achiever', 'base');
  const ht = hand(g, P0, 'Hostile Takeover');
  const d1 = put(g, P1, 'V(3)', BF_A); const d2 = put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [ava], BF_A);
  for (let i = 0; i < 40 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'optional') g = yes(g);
    else if (d.kind === 'assignDamage') g = act(g, legal(g, d.player)[0]);
    else if (d.inStep) { const o = optionIds(g); g = choose(g, o.includes(ht) ? ht : o.includes(d1) ? d1 : o.includes(d2) ? d2 : o[0]); }
    else g = pass(g);
  }
  assert.notEqual(zone(g, ht), 'hand', 'Hostile Takeover played');
  assert.equal(zone(g, d2), 'trash', 'the remaining defender was beaten');
  assert.equal(locOf(g, d1), BF_A, 'the stolen unit fought on the attacking side and survived');
  assert.equal(g.battlefields[BF_A].controller, P0);
});

test('RJ#8444 (MISMATCH-RJ in part) two Vex, Cheerless in combat + Ezreal, Prodigy: repeated Bellows Breath costs [1], not 0 — Ezreal\'s discount applies to the Repeat component first, then each Vex discount stops at its own minimum [1] (CR 356)', () => {
  let g = S0(); fundAll(g, P0, 8);
  const v1 = put(g, P0, 'sfd-146-221', 'base'), v2 = put(g, P0, 'sfd-146-221', 'base');
  put(g, P0, 'sfd-149-221', 'base');
  const e = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [v1, v2], BF_A);
  for (let i = 0; i < 4 && pend(g).player !== P0; i++) g = pass(g);
  const ready = (s: GameState) => s.players[P0].runesInPlay.filter(r => !s.objects[r].exhausted).length;
  const r0 = ready(g), n0 = g.players[P0].runesInPlay.length;
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Bellows Breath') });
  let repeated = false;
  for (let i = 0; i < 12 && pend(g).inStep; i++) {
    const d = pend(g);
    if (d.kind === 'optional') repeated = true;
    g = act(g, { type: 'choose', player: d.player, optionIds: d.kind === 'optional' ? ['yes'] : optionIds(g).includes(e) ? [e] : [optionIds(g)[0]] });
  }
  assert.ok(repeated, 'Repeat paid');
  const recycled = n0 - g.players[P0].runesInPlay.length;
  assert.equal(recycled, 0, 'no power left to pay');
  assert.equal(r0 - ready(g) - recycled, 1, '[1] energy remains (Vex minimum)');
});

test('RJ#8446 Not So Fast can\'t counter Brynhir Thundersong\'s play trigger (it chooses nothing); other Reactions still can be played while it is on the chain', () => {
  let g = S0();
  fundAll(g, P0, 8); fundAll(g, P1, 4);
  put(g, P1, 'V(2)', 'base');
  const nsf = hand(g, P1, 'Not So Fast'), dr = hand(g, P1, 'DrawR');
  const b = hand(g, P0, 'Brynhir Thundersong');
  g = play(g, P0, b, { dest: 'base' });
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = choose(g, optionIds(g)[0]);
  assert.ok(g.chain.some(c => c.source === b), 'play trigger on the chain');
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  assert.ok(!canPlayNow(g, P1, nsf), 'nothing for Not So Fast to counter');
  assert.ok(canPlayNow(g, P1, dr), 'other Reactions are fine');
  g = resolveChain(g);
  assert.ok(!canPlayNow(g, P1, dr), 'afterwards: no cards this turn');
});

test('RJ#8450 Riposte on Stupefy, then Stupefy\'s caster Defies their own Stupefy: when Riposte resolves its spell is gone → no Might for the unit', () => {
  let g = S0();
  fundAll(g, P0, 6); fundAll(g, P1, 6);
  const u = put(g, P1, 'V(3)', 'base');
  const st = hand(g, P0, 'Stupefy');
  g = play(g, P0, st, { targets: [[u]] });
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  const rp = hand(g, P1, 'Riposte');
  g = act(g, { type: 'playCard', player: P1, obj: rp });
  for (let i = 0; i < 6 && pend(g).inStep; i++) { const o = optionIds(g); g = choose(g, o.includes(u) ? u : o.find(x => g.chain.some(c => c.id === x && c.source === st)) ?? o.find(x => x !== rp) ?? o[0]); }
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  const df = hand(g, P0, 'Defy');
  g = act(g, { type: 'playCard', player: P0, obj: df });
  for (let i = 0; i < 6 && pend(g).inStep; i++) { const o = optionIds(g); g = choose(g, o.find(x => g.chain.some(c => c.id === x && c.source === st)) ?? o[0]); }
  g = resolveChain(g);
  assert.equal(zone(g, rp), 'trash'); assert.equal(zone(g, df), 'trash');
  assert.equal(zone(g, st), 'trash', 'Stupefy countered by Defy');
  assert.equal(mightOf(g, u), 3, 'no Might from Riposte (and no Stupefy -1)');
});

test('RJ#8451 (analogue: hidden Demon Shade for Ride the Wind) Wages of Pain on my unit, I move it to an open battlefield in response: the showdown is only staged; the 3 damage then kills a 2-Might unit → no showdown, no point; a 4-Might unit survives and conquers', () => {
  const run = (might: number) => {
    let g = S0({ tp: P1 }); withTokens(g);
    fundAll(g, P0, 4); fundAll(g, P1, 4);
    const u = put(g, P0, `V(${might})`, BF_A); control(g, BF_A, P0);
    put(g, P0, 'V(1)', BF_A);
    const ds = put(g, P0, 'Demon Shade', { facedown: BF_A });
    g = play(g, P1, hand(g, P1, 'Wages of Pain'), { targets: [[u]] });
    for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
    assert.ok(canPlayNow(g, P0, ds), 'hidden Demon Shade at Reaction speed');
    g = act(g, { type: 'playCard', player: P0, obj: ds });
    for (let i = 0; i < 8 && pend(g).inStep; i++) { const o = optionIds(g); g = choose(g, o.includes(u) ? u : o.includes(String(BF_B)) ? String(BF_B) : o[0]); }
    for (let i = 0; i < 30 && g.pending && !(g.pending.kind === 'mainAction' && g.pending.player === P1); i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
    return { g, u };
  };
  let { g, u } = run(2);
  assert.equal(zone(g, u), 'trash', 'moved, then killed by the 3 damage');
  assert.equal(g.battlefields[BF_B].controller, null, 'no showdown → not conquered');
  assert.equal(g.players[0].points, 0);
  ({ g, u } = run(4));
  assert.equal(locOf(g, u), BF_B);
  assert.equal(g.battlefields[BF_B].controller, P0, 'survived: the staged showdown began after the chain → conquered');
  assert.equal(g.players[0].points, 1);
});

test('RJ#8452 a hold blocked by Tianna Crownguard still marks the battlefield scored: after killing Tianna, re-taking it the same turn gives no conquer point', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P1, 0);
  const u = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const t = put(g, P1, 'Tianna Crownguard', BF_B); control(g, BF_B, P1);
  g = endTurn(g, P1); g = toStep(g);
  expectPending(g, 'mainAction', P0);
  assert.equal(g.players[0].points, 0, 'hold point blocked by Tianna');
  fundAll(g, P0, 4);
  [g] = cast(g, P0, 'KillA', { targets: [[t]] }); g = toStep(g);
  assert.equal(zone(g, t), 'trash');
  g = move(g, P0, [u], 'base'); g = toStep(g);
  const u3 = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u3], BF_B); g = toStep(g);
  for (let i = 0; i < 10 && g.pending && g.pending.kind !== 'mainAction'; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(g.players[0].points, 1, 'control: conquering BF-B (Tianna gone) scores');
  assert.equal(g.battlefields[BF_A].controller, null, 'left: uncontrolled');
  const u2 = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u2], BF_A); g = toStep(g);
  for (let i = 0; i < 10 && g.pending && g.pending.kind !== 'mainAction'; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[0].points, 1, 'BF-A already scored this turn → no conquer point');
});

test('RJ#8457 (MISMATCH-RJ in part) 7-7, Invert Timelines with tiny decks: nobody "loses" for not drawing — Burn Out gives the opponent a point (CR 432); a 2nd burn-out point in one sequence wins at once', () => {
  const run = (casterTrash: number) => {
    let g = S0();
    fundAll(g, P0, 6);
    g.players[0].points = 7; g.players[1].points = 7;
    for (const p of [P0, P1]) { for (const o of g.players[p].mainDeck) g.objects[o].zone = 'banishment' as never; g.players[p].mainDeck = []; }
    put(g, P0, 'V(1)', 'deckTop'); put(g, P0, 'V(1)', 'deckTop');
    for (let k = 0; k < 3; k++) put(g, P1, 'V(1)', 'deckTop');
    for (let k = 0; k < casterTrash; k++) put(g, P0, 'V(1)', 'trash');
    hand(g, P0, 'V(2)'); hand(g, P1, 'V(2)');
    [g] = cast(g, P0, 'Invert Timelines');
    for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction' && g.winner == null; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
    return g;
  };
  let g = run(0);
  assert.equal(g.winner, P1, 'caster burns out twice in one draw: the 2nd point wins for the opponent immediately (432.3)');
  g = run(5);
  assert.equal(g.winner, null, 'each burns out once → 8-8, no single leader, play continues');
  assert.equal(g.players[0].points, 8); assert.equal(g.players[1].points, 8);
});

test('RJ#8460 Salvage ("kill up to one gear") can be played with no gear on the board, just to draw', () => {
  let g = S0();
  fundAll(g, P0, 4);
  const sv = hand(g, P0, 'Salvage');
  assert.ok(canPlayNow(g, P0, sv));
  const h = g.players[0].hand.length;
  g = act(g, { type: 'playCard', player: P0, obj: sv });
  for (let i = 0; i < 10 && g.pending && g.pending.kind !== 'mainAction'; i++) { const d = pend(g); g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: (d.min ?? 0) === 0 && d.kind !== 'optional' ? [] : [optionIds(g)[0]] }) : pass(g); }
  assert.equal(g.players[0].hand.length, h, 'Salvage left, 1 drawn');
});

test('RJ#8464 Ravenbloom Conservatory: a revealed non-spell must be recycled (bottom of the Main Deck), not kept on top', () => {
  let g = S0({ bfA: 'Ravenbloom Conservatory' });
  put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const top = put(g, P1, 'V(4)', 'deckTop');
  const a = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 10 && g.players[1].mainDeck[0] === top && zone(g, top) === 'mainDeck'; i++) {
    const d = pend(g);
    if (d.kind === 'optional') { assert.ok(!/recycle/i.test(d.prompt ?? ''), 'recycling is not optional'); g = yes(g); }
    else g = d.inStep ? choose(g, optionIds(g)[0]) : pass(g);
  }
  assert.equal(zone(g, top), 'mainDeck');
  const deck = g.players[1].mainDeck;
  assert.equal(deck[deck.length - 1], top, 'recycled to the bottom');
});

test('RJ#8468 Warmog\'s Armor: the buff its unit got from conquering stays after the Armor is killed; later conquers give nothing', () => {
  let g = S0();
  fundAll(g, P0, 6);
  const u = put(g, P0, 'V(2)', 'base');
  const wa = put(g, P0, "Warmog's Armor", 'base'); attachNow(g, wa, u);
  g = move(g, P0, [u], BF_A);
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(g.objects[u].counters.buff ?? 0, 1, 'buffed by the conquer');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Salvage') });
  for (let i = 0; i < 10 && g.pending && g.pending.kind !== 'mainAction'; i++) { const d = pend(g); g = d.inStep ? choose(g, optionIds(g).includes(wa) ? wa : optionIds(g)[0]) : pass(g); }
  assert.equal(zone(g, wa), 'trash');
  assert.equal(g.objects[u].counters.buff ?? 0, 1, 'buff kept');
});

test('RJ#8472 Relentless Pursuit moves a unit from Vilemaw\'s Lair to the other battlefield (the Lair only stops moves to base)', () => {
  let g = S0({ bfA: "Vilemaw's Lair" });
  fundAll(g, P0, 6);
  const u = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  put(g, P0, 'V(1)', BF_A);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Relentless Pursuit') });
  let offered: string[] = [];
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'chooseDestination') { offered = optionIds(g); g = choose(g, String(BF_B)); }
    else if (d.kind === 'optional') g = no(g);
    else if (d.inStep) g = choose(g, ...(optionIds(g).includes(u) ? [u] : (d.min ?? 0) === 0 ? [] : [optionIds(g)[0]]));
    else g = pass(g);
  }
  assert.ok(offered.includes(String(BF_B)), `BF-B offered (${offered})`);
  assert.equal(locOf(g, u), BF_B);
});

test('RJ#8473 Thousand-Tailed Watcher chooses nothing: an enemy Ruin Runner ("can\'t be chosen") still gets -3 (5 → 2)', () => {
  let g = S0();
  fundAll(g, P0, 3); addRunes(g, P0, 6, 'mind');
  const rr = put(g, P1, 'Ruin Runner', 'base');
  [g] = cast(g, P0, 'Thousand-Tailed Watcher', { dest: 'base', may: [false] }); g = toStep(g);
  assert.equal(mightOf(g, rr), 2);
});

test('RJ#8483 Thousand-Tailed Watcher chooses nothing: an enemy Deflect unit costs no Deflect tax and still gets -3', () => {
  const run = (enemy: string) => {
    let g = S0();
    fundAll(g, P0, 3); addRunes(g, P0, 6, 'mind');
    const e = put(g, P1, enemy, 'base');
    const n0 = g.players[0].runesInPlay.length;
    [g] = cast(g, P0, 'Thousand-Tailed Watcher', { dest: 'base', may: [false] }); g = toStep(g);
    assert.equal(mightOf(g, e), 2);
    return n0 - g.players[0].runesInPlay.length;
  };
  assert.equal(run('Deflect(5,2)'), run('V(5)'), 'same runes recycled with or without an enemy Deflect unit');
});

test('RJ#8474 Not So Fast counters Hostile Takeover choosing my unit: no control change, Takeover to the trash', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P1, 8); fundAll(g, P0, 4);
  const u = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const ht = hand(g, P1, 'Hostile Takeover');
  g = play(g, P1, ht, { targets: [[u]] });
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  const nsf = hand(g, P0, 'Not So Fast');
  assert.ok(canPlayNow(g, P0, nsf));
  g = act(g, { type: 'playCard', player: P0, obj: nsf });
  for (let i = 0; i < 4 && pend(g).inStep; i++) { const o = optionIds(g); g = choose(g, o.find(x => g.chain.some(c => c.id === x && c.source === ht)) ?? o[0]); }
  g = resolveChain(g);
  assert.equal(zone(g, ht), 'trash');
  assert.equal(g.objects[u].controller, P0);
});

test('RJ#8475 two Breakneck Mechs: Deflect granted by each copy stacks → each Mech has Deflect 2', () => {
  const g = S0();
  const m1 = put(g, P0, 'Breakneck Mech', 'base'), m2 = put(g, P0, 'Breakneck Mech', 'base');
  assert.equal(kwv(g, m1, 'Deflect'), 2);
  assert.equal(kwv(g, m2, 'Deflect'), 2);
});

test('RJ#8479 my only unit at a battlefield (Temporary) dies at the start of my Beginning Phase: its two attached Spinning Axes are recalled to base (not trashed), and I score no hold point', () => {
  let g = S0({ tp: P1 });
  const t = put(g, P0, 'Temp(5)', BF_A); control(g, BF_A, P0);
  const ax1 = put(g, P0, 'Spinning Axe', 'base'), ax2 = put(g, P0, 'Spinning Axe', 'base');
  attachNow(g, ax1, t); attachNow(g, ax2, t);
  g = endTurn(g, P1);
  for (let i = 0; i < 20 && !(pend(g).kind === 'mainAction' && pend(g).player === P0); i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(zone(g, t), 'trash');
  for (const ax of [ax1, ax2]) { assert.equal(zone(g, ax), 'base', 'Axe recalled to base'); assert.equal(g.objects[ax].attachedTo ?? null, null); }
  assert.equal(g.players[0].points, 0, 'no hold: the unit was gone before scoring');
});

test('RJ#8480 hidden Hidden Blade can answer Falling Star by killing my own unit there (I draw 2); from hand it can\'t be played in response', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P1, 6); fundAll(g, P0, 6);
  const u = put(g, P0, 'V(4)', BF_A); control(g, BF_A, P0);
  put(g, P0, 'V(1)', BF_A);
  const hbHidden = put(g, P0, 'Hidden Blade', { facedown: BF_A });
  const hbHand = hand(g, P0, 'Hidden Blade');
  const fs = hand(g, P1, 'Falling Star');
  g = play(g, P1, fs, { targets: [[u], [u]] });
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = choose(g, optionIds(g).includes(u) ? u : optionIds(g)[0]);
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  assert.ok(!canPlayNow(g, P0, hbHand), 'from hand: Action, not in response');
  assert.ok(canPlayNow(g, P0, hbHidden), 'hidden: Reaction speed');
  const h = g.players[0].hand.length;
  g = play(g, P0, hbHidden, { targets: [[u]] });
  for (let i = 0; i < 4 && g.chain.some(c => c.source === hbHidden); i++) g = pass(g);
  assert.equal(zone(g, u), 'trash');
  assert.equal(g.players[0].hand.length, h + 2, 'its controller (me) draws 2');
  g = resolveChain(g);
  assert.equal(zone(g, fs), 'trash', 'Falling Star finds nothing');
});

test('RJ#8481 Piercing Light: the second unit must be another unit (not the first one); it may be one in a base or none', () => {
  let g = S0();
  fundAll(g, P0, 6);
  const e = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const eb = put(g, P1, 'V(5)', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Piercing Light') });
  let second: string[] | null = null;
  for (let i = 0; i < 12 && pend(g).inStep; i++) {
    const d = pend(g);
    if (d.kind === 'optional') { g = no(g); continue; }
    if (d.kind === 'chooseTargets') {
      if (!/other/.test(d.prompt ?? '')) { g = choose(g, e); continue; }
      second = optionIds(g);
      assert.equal(d.min ?? 0, 0, 'up to one: may choose none');
      g = choose(g, eb); continue;
    }
    g = choose(g, optionIds(g)[0]);
  }
  assert.ok(second, 'second choice offered');
  assert.ok(!second!.includes(e), 'not the first unit');
  assert.ok(second!.includes(eb), 'a unit in a base is allowed');
  g = resolveChain(g);
  assert.equal(g.objects[e].damage, 2); assert.equal(g.objects[eb].damage, 2);
});

test('RJ#8486 Bonus Damage (Void Gate) only adds to real damage: Teemo, Strategist revealing no [Hidden] cards deals 0, which stays 0 (no +1)', () => {
  let g = S0({ tp: P1, bfA: 'Void Gate' });
  put(g, P0, 'Teemo, Strategist', BF_A); control(g, BF_A, P0);
  for (let k = 0; k < 5; k++) put(g, P0, 'V(1)', 'deckTop');
  const a = put(g, P1, 'V(9)', 'base');
  g = move(g, P1, [a], BF_A);
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g);
    if (d.kind === 'chooseTargets') g = choose(g, a);
    else if (d.kind === 'optional') g = no(g);
    else g = d.inStep ? choose(g, optionIds(g)[0]) : pass(g);
  }
  assert.ok(g.log.some(l => /Resolving.*Teemo/.test(l.text)), 'Teemo\'s defend trigger resolved');
  assert.equal(g.objects[a].damage, 0, 'no damage instance → no Bonus Damage');
});

test('RJ#8498 a stunned attacker left alone after Hidden Blade kills the lone defender still conquers (stun only removes its combat damage)', () => {
  let { g, atk, def } = attackSetup(['V(3)'], ['V(2)'], { atkOpts: [{ stunned: true }] });
  fundAll(g, P0, 4);
  expectPending(g, 'showdownAction', P0);
  g = play(g, P0, hand(g, P0, 'KillA'), { targets: [[def[0]]] });
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(zone(g, def[0]), 'trash');
  assert.equal(locOf(g, atk[0]), BF_A);
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[0].points, 1, 'conquer point');
});

test('RJ#8503 Falling Star on two different units with Annie, Fiery: each instance gets the Bonus Damage (4 and 4)', () => {
  let g = S0(); fundAll(g, P0, 6);
  put(g, P0, 'Annie, Fiery', 'base');
  const a = put(g, P1, 'V(9)', BF_A), b = put(g, P1, 'V(9)', 'base'); control(g, BF_A, P1);
  g = play(g, P0, hand(g, P0, 'Falling Star'), { targets: [[a], [b]] });
  g = resolveChain(g);
  assert.deepEqual([g.objects[a].damage, g.objects[b].damage], [4, 4]);
});

test('RJ#8505 Overzealous Fan choosing an attacker with Deflect must pay the Deflect cost (paid as the trigger goes on the chain)', () => {
  const run = (attacker: string) => {
    let g = S0(); fundAll(g, P1, 4);
    const fan = put(g, P1, 'Overzealous Fan', BF_A); control(g, BF_A, P1);
    const a = put(g, P0, attacker, 'base');
    const r0 = g.players[P1].runesInPlay.length, rr0 = readyRunes(g, P1);
    g = move(g, P0, [a], BF_A);
    for (let i = 0; i < 20 && locOf(g, a) === BF_A; i++) {
      const d = pend(g);
      if (d.inStep) { g = act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : optionIds(g).includes(a) ? a : optionIds(g)[0]] }); continue; }
      g = pass(g);
    }
    assert.equal(zone(g, fan), 'trash');
    assert.equal(locOf(g, a), 'base', 'attacker moved to base');
    return (r0 - g.players[P1].runesInPlay.length) + (rr0 - readyRunes(g, P1));
  };
  assert.ok(run('Deflect(3,1)') > run('V(3)'), 'Deflect cost paid');
});

test('RJ#8508 Dazzling Aurora: the revealed non-units are recycled together (bottom of the deck, randomized as a group); the unit is played', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'Dazzling Aurora', 'base');
  const u = put(g, P0, 'V(2)', 'deckTop');
  const s1 = put(g, P0, 'Falling Star', 'deckTop'), s2 = put(g, P0, 'Defy', 'deckTop');
  g = endTurn(g);
  for (let i = 0; i < 30 && g.activePlayer === P0; i++) {
    const d = g.pending; if (!d || d.kind === 'mainAction') break;
    g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: [optionIds(g).includes('base') ? 'base' : optionIds(g)[0]] }) : pass(g);
  }
  assert.ok(['base', 'battlefield'].includes(zone(g, u)), 'unit played');
  const deck = g.players[P0].mainDeck;
  assert.deepEqual([...deck.slice(-2)].sort(), [s1, s2].sort(), 'both revealed spells at the bottom');
});

test('RJ#8517 First Mate\'s play trigger uses the chain (opponent may respond); with only an exhausted enemy unit it must ready that unit', () => {
  let g = S0(); fundAll(g, P0, 4);
  const e = put(g, P1, 'V(2)', 'base', { ready: false });
  const fm = hand(g, P0, 'First Mate');
  g = play(g, P0, fm, { dest: 'base' });
  for (let i = 0; i < 4 && pend(g).inStep && g.chain.length === 0; i++) g = choose(g, optionIds(g).includes(e) ? e : optionIds(g)[0]);
  assert.ok(g.chain.some(c => c.source === fm), 'trigger on the chain');
  for (let i = 0; i < 4 && pend(g).player !== P1; i++) g = pend(g).inStep ? choose(g, optionIds(g).includes(e) ? e : optionIds(g)[0]) : pass(g);
  expectPending(g, 'chainResponse', P1);
  g = resolveChain(g);
  for (let i = 0; i < 6 && pend(g).inStep; i++) { assert.notEqual(pend(g).kind, 'optional', 'not optional'); g = choose(g, e); g = resolveChain(g); }
  assert.equal(g.objects[e].exhausted, false, 'enemy unit readied');
});

test('RJ#8519 Not So Fast can\'t counter Cull the Weak (units are chosen on resolution, nothing is chosen when played)', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  put(g, P0, 'V(1)', 'base'); put(g, P1, 'V(1)', 'base');
  const ns = hand(g, P1, 'Not So Fast');
  [g] = cast(g, P0, 'Cull the Weak');
  assert.equal(g.chain.length, 1);
  g = pass(g);
  expectPending(g, 'chainResponse', P1);
  assert.equal(canPlayNow(g, P1, ns), false);
});

test('RJ#8520 Invert Timelines vs an opponent with 4 cards in hand and an empty deck: they burn out (trash incl. the discards shuffled in), I score 1, they finish drawing 4', () => {
  let g = S0();
  fundAll(g, P0, 6);
  for (const o of g.players[P1].mainDeck) g.objects[o].zone = 'banishment' as never;
  g.players[P1].mainDeck = [];
  for (let k = 0; k < 4; k++) hand(g, P1, 'V(1)');
  const pts = g.players[P0].points;
  [g] = cast(g, P0, 'Invert Timelines');
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction' && g.winner == null; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(g.players[P0].points, pts + 1, 'burn out gives me 1 point');
  assert.equal(g.players[P1].hand.length, 4, 'they drew 4 after reshuffling');
  assert.equal(g.players[P1].trash.length, 0);
});

test('RJ#8521 Not So Fast counters Zaun Punk\'s play trigger when it chose my gear; the Punk\'s own gear stays killed (cost)', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const mine = put(g, P0, 'Pendulum Blade', 'base');
  const theirs = put(g, P1, 'Pendulum Blade', 'base');
  const zp = hand(g, P0, 'Zaun Punk');
  const ns = hand(g, P1, 'Not So Fast');
  g = act(g, { type: 'playCard', player: P0, obj: zp });
  let countered = false;
  for (let i = 0; i < 40 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.inStep) {
      const o = optionIds(g);
      if (d.kind === 'optional') { g = yes(g); continue; }
      if (d.player === P1) { const t = o.find(x => g.chain.some(c => c.id === x && c.source === zp)) ?? o[0]; g = choose(g, t); continue; }
      g = choose(g, o.includes(mine) ? mine : o.includes(theirs) ? theirs : o.includes('base') ? 'base' : o[0]); continue;
    }
    if (!countered && d.player === P1 && g.chain.some(c => c.source === zp) && canPlayNow(g, P1, ns)) { countered = true; g = act(g, { type: 'playCard', player: P1, obj: ns }); continue; }
    g = pass(g);
  }
  assert.ok(countered, 'Not So Fast was playable against the trigger');
  assert.equal(zone(g, mine), 'trash', 'additional cost stays paid');
  assert.equal(zone(g, theirs), 'base', 'my gear survives');
});

test('RJ#8524 Chem-Baroness\'s extra [1] from Gold is on at 5 points (8 to win) — with Aspirant\'s Climb (9 to win) only from 6', () => {
  const extra = (pts: number, climb: boolean) => {
    let g = S0(climb ? { bfA: "Aspirant's Climb" } : {});
    legend(g, P0, 'Chem-Baroness');
    g.players[P0].points = pts;
    const gold = put(g, P0, 'Gold', 'base', { token: true });
    const e0 = g.players[P0].pool.energy;
    const ga = legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === gold);
    assert.ok(ga, 'Gold usable');
    g = act(g, ga!); g = toStep(g);
    return g.players[P0].pool.energy - e0;
  };
  assert.equal(extra(5, false), 1, '5 of 8');
  assert.equal(extra(4, false), 0, '4 of 8');
  assert.equal(extra(5, true), 0, '5 of 9');
  assert.equal(extra(6, true), 1, '6 of 9');
});

test('RJ#8525 Akshan, Mischievous played by Baited Hook (ignoring its cost) may still pay his optional [C][C] and takes an enemy gear', () => {
  let g = S0();
  fundAll(g, P0);
  const hook = put(g, P0, 'Baited Hook', 'base');
  const f = put(g, P0, 'V(3)', 'base');
  const eg = put(g, P1, 'Pendulum Blade', 'base');
  const ak = put(g, P0, 'Akshan, Mischievous', 'deckTop');
  const ab = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === hook)!;
  g = act(g, ab);
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g); const o = optionIds(g);
    if (d.kind === 'optional') g = yes(g);
    else if (d.inStep) g = choose(g, o.includes(f) ? f : o.includes(ak) ? ak : o.includes(eg) ? eg : o.includes('base') ? 'base' : o[0]);
    else g = pass(g);
  }
  assert.equal(zone(g, ak), 'base', 'Akshan played');
  assert.equal(g.objects[eg].controller, P0, 'enemy gear taken (additional cost was paid)');
});

test('RJ#8526 Charm with Repeat (Temporal Portal): two enemy units charmed into my battlefield fight one combat as attackers; to two battlefields, both combats happen', () => {
  const run = (dests: number[]) => {
    let g = S0(); fundAll(g, P0, 12);
    const m1 = put(g, P0, 'V(5)', BF_A); control(g, BF_A, P0);
    const m2 = put(g, P0, 'V(5)', BF_B); control(g, BF_B, P0);
    const e1 = put(g, P1, 'V(1)', 'base'), e2 = put(g, P1, 'V(1)', 'base');
    const tp = put(g, P0, 'Temporal Portal', 'base');
    g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === tp)!); g = toStep(g);
    g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Charm') });
    let nt = 0, nd = 0; const seen: string[] = [];
    for (let i = 0; i < 60 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0 && nt >= 2); i++) {
      const d = pend(g); const o = optionIds(g);
      if (d.kind === 'optional') { g = yes(g); continue; }
      if (d.kind === 'chooseTargets' && (o.includes(e1) || o.includes(e2))) { g = choose(g, nt++ === 0 ? e1 : (o.includes(e2) ? e2 : e1)); continue; }
      if (d.kind === 'chooseDestination') { g = choose(g, String(dests[Math.min(nd++, dests.length - 1)])); continue; }
      if (d.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: d.player, assignment: (d.data as { suggested: Record<ObjId, number> }).suggested }); continue; }
      if (d.inStep) { g = choose(g, o[0]); continue; }
      if (d.kind === 'mainAction') break;
      seen.push(`${d.kind}:${d.player}`);
      g = pass(g);
    }
    return { g, e1, e2, m1, m2 };
  };
  let r = run([BF_A, BF_A]);
  assert.deepEqual([zone(r.g, r.e1), zone(r.g, r.e2)], ['trash', 'trash'], 'one combat at BF-A kills both attackers');
  assert.equal(r.g.battlefields[BF_A].controller, P0);
  assert.equal(r.g.players[P1].points, 0, 'the attackers did not conquer');
  r = run([BF_A, BF_B]);
  assert.deepEqual([zone(r.g, r.e1), zone(r.g, r.e2)], ['trash', 'trash'], 'a combat at each battlefield');
  assert.deepEqual([r.g.battlefields[BF_A].controller, r.g.battlefields[BF_B].controller], [P0, P0]);
});

test('RJ#8527 Counter Strike on a defender facing several attackers prevents all the combat damage to it (one damage event)', () => {
  let { g, def } = attackSetup(['V(3)', 'V(3)', 'V(3)'], ['V(2)']);
  fundAll(g, P1);
  for (let i = 0; i < 4 && !(pend(g).kind === 'showdownAction' && pend(g).player === P1); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  g = play(g, P1, hand(g, P1, 'Counter Strike'), { targets: [[def[0]]] });
  for (let i = 0; i < 40 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: d.player, assignment: (d.data as { suggested: Record<ObjId, number> }).suggested }); continue; }
    g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  assert.equal(locOf(g, def[0]), BF_A, 'defender survives 9 damage from three attackers');
  assert.equal(g.objects[def[0]].damage ?? 0, 0);
  assert.equal(g.battlefields[BF_A].controller, P1);
});

test('RJ#8530 at 7 points Draven, Audacious winning a combat gives the 8th point and wins (not a Hold/Conquer point, no all-battlefields rule)', () => {
  let g = S0(); g.players[P0].points = 7; g.timestamp++;
  const dv = put(g, P0, 'Draven, Audacious', 'base');
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [dv], BF_A);
  for (let i = 0; i < 30 && g.pending && pend(g).kind !== 'mainAction' && g.winner == null; i++) { const d = pend(g); g = d.inStep ? choose(g, d.options![0].id) : pass(g); }
  assert.equal(g.winner, P0);
});

test('RJ#8533 Tideturner can be hidden only at a battlefield I control (not in base), and from hiding it is played only to that battlefield', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
  put(g, P1, 'V(1)', BF_B);
  const t = hand(g, P0, 'Tideturner');
  const hides = legal(g, P0, 'hide').filter(a => a.type === 'hide' && a.obj === t).map(a => (a as { battlefieldIndex: number }).battlefieldIndex);
  assert.ok(hides.length > 0 && hides.every(b => typeof b === 'number'), `hide only at battlefields (${hides})`);
  g.battlefields[BF_B].controller = P1; g.timestamp++;
  const hid = put(g, P0, 'Tideturner', { facedown: BF_A });
  put(g, P0, 'V(2)', 'base');
  const dests = playDests(g, P0, hid);
  assert.ok(canPlayNow(g, P0, hid), 'playable from hiding');
  assert.ok(dests.length === 0 || dests.every(d => d === BF_A), `only its battlefield (${dests})`);
  assert.ok(!(dests as unknown[]).includes('base'));
});

test('RJ#8535 Switcheroo choosing an enemy Deflect unit pays the Deflect cost when played', () => {
  const pays = (card: string) => {
    let g = S0(); fundAll(g, P0, 10);
    const m = put(g, P0, 'V(2)', BF_A);
    const t = put(g, P1, card, BF_A);
    const n = g.log.length;
    g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Switcheroo') });
    g = answer(g, { targets: [[m, t]] }, P0);
    for (let i = 0; i < 4 && pend(g).inStep; i++) g = choose(g, optionIds(g).includes(t) ? t : optionIds(g).includes(m) ? m : optionIds(g)[0]);
    assert.ok(g.chain.length > 0, 'on the chain');
    return g.log.slice(n).filter(l => /^P0 pays/.test(l.text)).map(l => l.text).join(' ');
  };
  const plain = pays('V(5)'), dfl = pays('Deflect(5,1)');
  const power = (s: string) => (s.match(/\b[A-Z]\b/g) ?? []).length;
  assert.equal(power(dfl) - power(plain), 1, `Deflect paid (${plain} vs ${dfl})`);
});

test('RJ#8547 (MISMATCH-RJ timing, CR 383.3.a-b) Ezreal, Dashing attacks a lone Overzealous Fan: the Fan\'s "kill me" is paid as its trigger goes on the chain; it resolves first, Ezreal goes to base and his attack trigger does nothing', () => {
  let g = S0();
  const fan = put(g, P1, 'Overzealous Fan', BF_A); control(g, BF_A, P1);
  const ez = put(g, P0, 'Ezreal, Dashing', 'base');
  g = move(g, P0, [ez], BF_A);
  let fanDeadWhileOnChain = false;
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.inStep) { g = act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : optionIds(g).includes(ez) ? ez : optionIds(g)[0]] }); continue; }
    if (g.chain.some(c => c.source === fan) && zone(g, fan) === 'trash') fanDeadWhileOnChain = true;
    g = pass(g);
  }
  assert.ok(fanDeadWhileOnChain, 'Fan killed (cost) while its trigger is on the chain');
  assert.equal(locOf(g, ez), 'base', 'Ezreal moved to base');
  assert.equal(g.objects[ez].damage ?? 0, 0);
  assert.notEqual(g.battlefields[BF_A].controller, P0, 'no conquer');
});

test('RJ#8550 holding Reckoner\'s Arena with a unit wearing Doran\'s Ring activates the Ring\'s granted conquer effect: discard 1, then draw 1', () => {
  let g = S0({ tp: P1, bfA: "Reckoner's Arena" });
  fundAll(g, P0);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  attachNow(g, put(g, P0, "Doran's Ring", 'base'), u);
  const c = hand(g, P0, 'V(1)');
  const n = g.log.length;
  g = endTurn(g);
  for (let i = 0; i < 30; i++) { const d = g.pending!; if (d.kind === 'mainAction') break; g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : optionIds(g).includes(c) ? c : d.options![0].id) : pass(g); }
  assert.equal(g.activePlayer, P0);
  assert.ok(g.log.slice(n).some(l => /^Resolving .*When I conquer, discard 1, then draw 1/.test(l.text)), 'Ring\'s conquer effect (granted to the unit) activated');
  assert.equal(zone(g, c), 'trash', 'discarded 1');
});

test('RJ#8555 Udyr, Wildman in base may spend his buff to stun an enemy unit at any battlefield (not one in a base)', () => {
  let g = S0();
  const u = put(g, P0, 'Udyr, Wildman', 'base', { buff: true });
  const far = put(g, P1, 'V(3)', BF_B); control(g, BF_B, P1);
  const inBase = put(g, P1, 'V(3)', 'base');
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  g = act(g, { type: 'activate', player: P0, obj: u, abilityIndex: 0 });
  const stun = pend(g).options!.find(o => /Stun/i.test(o.label))!.id;
  g = choose(g, stun);
  let offered: string[] = [];
  for (let i = 0; i < 6 && pend(g).inStep; i++) { offered = optionIds(g); g = choose(g, far); }
  if (!offered.length) for (let i = 0; i < 6 && g.chain.length; i++) { if (pend(g).inStep) { offered = optionIds(g); g = choose(g, far); } else g = pass(g); }
  assert.ok(offered.includes(far), 'unit at another battlefield offered');
  assert.ok(!offered.includes(inBase), 'not a unit in a base');
  g = resolveChain(g);
  assert.ok(g.objects[far].stunned, 'stunned');
});

test('RJ#8556 a 4-Might unit already on the board moving from base onto Trifarian War Camp becomes Mighty (4 → 5): Grand Duelist triggers', () => {
  let g = S0({ bfA: 'Trifarian War Camp' });
  legend(g, P0, 'Grand Duelist');
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const u = put(g, P0, 'V(4)', 'base');
  const n = g.log.length;
  g = move(g, P0, [u], BF_A);
  assert.equal(mightOf(g, u), 5);
  assert.ok(pend(g).kind === 'optional' || g.chain.length > 0 || g.log.slice(n).some(l => /Grand Duelist/.test(l.text)), 'Grand Duelist triggered');
});

test('RJ#8560 an unattached Hexdrinker has no Deflect (its [Deflect] is granted only while attached, to the unit)', () => {
  const g = S0();
  const hx = put(g, P0, 'Hexdrinker', 'base');
  const u = put(g, P0, 'V(2)', 'base');
  assert.equal(kwv(g, hx, 'Deflect'), 0, 'gear itself: no Deflect');
  assert.equal(kwv(g, u, 'Deflect'), 0);
  attachNow(g, hx, u); g.timestamp++;
  assert.ok(kwv(g, u, 'Deflect') >= 1, 'equipped unit has Deflect');
});

test('RJ#8562 Weaponmaster can\'t take back my Equipment that an enemy Akshan stole (I no longer control it)', () => {
  let g = S0();
  fundAll(g, P0, 4);
  const mineOwned = put(g, P0, "Doran's Blade", 'base');
  const eu = put(g, P1, 'V(2)', 'base');
  g.objects[mineOwned].controller = P1; attachNow(g, mineOwned, eu); g.timestamp++;
  const ok = put(g, P0, "Doran's Blade", 'base');
  let b: ObjId;
  [g, b] = cast(g, P0, 'Weaponmaster(2)', { dest: 'base' });
  const offered = new Set<string>();
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'chooseTargets' || d.kind === 'chooseCards') { optionIds(g).forEach(x => offered.add(x)); g = choose(g, optionIds(g).includes(ok) ? ok : optionIds(g)[0]); }
    else g = d.inStep ? (d.kind === 'optional' ? yes(g) : choose(g, optionIds(g)[0])) : pass(g);
  }
  assert.ok(offered.has(ok), 'my own unattached Equipment is offered');
  assert.ok(!offered.has(mineOwned), 'the stolen Equipment is not offered');
  assert.equal(g.objects[mineOwned].attachedTo, eu);
  void b;
});

test('RJ#8565 Falling Star can\'t choose an enemy Ruin Runner (with no other unit it can\'t be played)', () => {
  const g = S0(); fundAll(g, P0, 6);
  const rr = put(g, P1, 'Ruin Runner', BF_A); control(g, BF_A, P1);
  const fs = hand(g, P0, 'Falling Star');
  assert.equal(canPlayNow(g, P0, fs), false, 'no legal unit to choose');
  const g2 = S0(); fundAll(g2, P0, 6);
  const rr2 = put(g2, P1, 'Ruin Runner', BF_A); const v = put(g2, P1, 'V(5)', BF_A); control(g2, BF_A, P1);
  let g3 = act(g2, { type: 'playCard', player: P0, obj: hand(g2, P0, 'Falling Star') });
  const seen = new Set<string>();
  for (let i = 0; i < 6 && pend(g3).inStep; i++) { optionIds(g3).forEach(x => seen.add(x)); g3 = choose(g3, v); }
  assert.ok(!seen.has(rr2), 'Ruin Runner not offered');
  g3 = resolveChain(g3);
  assert.equal(g3.objects[rr2].damage ?? 0, 0, 'Ruin Runner untouched');
  assert.equal(zone(g3, v), 'trash', 'both instances (6) on the other unit');
  void rr;
});

test('RJ#8566 Brutalizer equipped this turn to a 2-Might unit, then re-attached to it by Grandmaster at Arms: 5 (+1 and one +2, no stacking)', () => {
  let g = S0(); fundAll(g, P0);
  legend(g, P0, 'Grandmaster at Arms');
  const u = put(g, P0, 'V(2)', 'base');
  const b = put(g, P0, 'Brutalizer', 'base');
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === b)!);
  for (let i = 0; i < 10 && pend(g).kind !== 'mainAction'; i++) g = pend(g).inStep ? choose(g, optionIds(g).includes(u) ? u : optionIds(g)[0]) : pass(g);
  assert.equal(mightOf(g, u), 5);
  const leg = g.players[P0].legend;
  for (const mv of legal(g, P0, 'activate').filter(a => a.type === 'activate' && a.obj === leg)) {
    let h = act(g, mv);
    for (let i = 0; i < 10 && pend(h).kind !== 'mainAction'; i++) { const o = pend(h).inStep ? optionIds(h) : []; h = pend(h).inStep ? choose(h, o.includes(b) ? b : o.includes(u) ? u : o[0]) : pass(h); }
    assert.equal(h.objects[b].attachedTo, u);
    assert.equal(mightOf(h, u), 5, 'still 5 after the re-attach');
  }
});

test('RJ#8567 Baited Hook kills a Deathknell unit and plays a unit with a play trigger: the Deathknell goes on the chain first, the play trigger above it resolves first', () => {
  let g = S0(); fundAll(g, P0);
  const hook = put(g, P0, 'Baited Hook', 'base');
  const dk = put(g, P0, 'DK(2)', 'base');
  put(g, P0, 'V(1)', 'base', { ready: false });
  const fm = put(g, P0, 'First Mate', 'deckTop');
  const n = g.log.length;
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === hook)!);
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g); const o = optionIds(g);
    if (d.kind === 'optional') g = yes(g);
    else if (d.inStep) g = choose(g, o.includes(dk) ? dk : o.includes(fm) ? fm : o.includes('base') ? 'base' : o[0]);
    else g = pass(g);
  }
  const L = g.log.slice(n).map(l => l.text);
  const iFm = L.findIndex(x => /^Resolving First Mate/.test(x)), iDk = L.findIndex(x => /^Resolving DK\(2\)/.test(x));
  assert.ok(zone(g, fm) === 'base', 'First Mate played');
  assert.ok(iFm >= 0 && iDk >= 0 && iFm < iDk, `play trigger first, then Deathknell (${L.join(' / ')})`);
});

test('RJ#8570 Equip can attach to my unit at a battlefield (the Equipment moves there), on my turn in an Open state', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const b = put(g, P0, "Doran's Blade", 'base');
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === b)!);
  for (let i = 0; i < 10 && pend(g).kind !== 'mainAction'; i++) g = pend(g).inStep ? choose(g, optionIds(g).includes(u) ? u : optionIds(g)[0]) : pass(g);
  assert.equal(g.objects[b].attachedTo, u);
  assert.equal(locOf(g, b), BF_A);
});

test('RJ#8575 two Draven, Audacious (one each) kill each other in combat at 7-7: the turn player\'s trigger goes on the chain first, the opponent\'s resolves first → the turn player reaches 8 and wins', () => {
  let g = S0(); g.players[P0].points = 7; g.players[P1].points = 7; g.timestamp++;
  put(g, P1, 'Draven, Audacious', BF_A); control(g, BF_A, P1);
  const mine = put(g, P0, 'Draven, Audacious', 'base');
  g = move(g, P0, [mine], BF_A);
  for (let i = 0; i < 40 && g.pending && g.winner == null && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: d.player, assignment: (d.data as { suggested: Record<ObjId, number> }).suggested }); continue; }
    g = d.inStep ? choose(g, d.options![0].id) : pass(g);
  }
  assert.equal(g.winner, P0);
});

test('RJ#8576 opponent moves into an empty battlefield; in the showdown I Ride the Wind my Overzealous Fan there: it becomes a Defender, its defend trigger can send the attacker to base', () => {
  let g = S0();
  fundAll(g, P1);
  const a = put(g, P0, 'V(3)', 'base');
  const fan = put(g, P1, 'Overzealous Fan', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 4 && !(pend(g).kind === 'showdownAction' && pend(g).player === P1); i++) g = pass(g);
  expectPending(g, 'showdownAction', P1);
  g = play(g, P1, hand(g, P1, 'Ride the Wind'), { targets: [[fan]], locations: [BF_A] });
  let asked = false;
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g); const o = optionIds(g);
    if (d.kind === 'optional' && d.player === P1) { asked = asked || /Overzealous|kill me/i.test(d.prompt ?? ''); g = yes(g); continue; }
    if (d.kind === 'chooseDestination') { g = choose(g, String(BF_A)); continue; }
    if (d.inStep) { g = choose(g, o.includes(a) ? a : o.includes(fan) ? fan : o[0]); continue; }
    g = pass(g);
  }
  assert.ok(asked || g.log.some(l => /Trigger: Overzealous Fan/.test(l.text)), 'Fan\'s defend trigger');
  assert.equal(locOf(g, a), 'base', 'attacker sent to base');
  assert.equal(zone(g, fan), 'trash');
});

test('RJ#8578 Glorious Executioner\'s win-combat draw resolves before control is gained and conquer effects trigger', () => {
  let g = S0();
  legend(g, P0, 'Glorious Executioner');
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'ConquerDraw(3)', 'base');
  const n = g.log.length;
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 30 && g.pending && pend(g).kind !== 'mainAction'; i++) { const d = pend(g); g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : d.options![0].id) : pass(g); }
  const L = g.log.slice(n).map(l => l.text);
  const iG = L.findIndex(x => /^Resolving Glorious Executioner/.test(x));
  const iC = L.findIndex(x => /^Resolving ConquerDraw/.test(x));
  const iCtl = L.findIndex(x => /conquer/i.test(x) && /P0/.test(x));
  assert.ok(iG >= 0 && iC >= 0 && iG < iC, `legend draw before the conquer effect (${L.join(' / ')})`);
  assert.ok(iCtl < 0 || iG < iCtl, 'and before the conquer');
});

test('RJ#8579 Orb of Regret (no Reaction/Action) can\'t be used on the opponent\'s turn; on my own turn it can', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1);
  const orb = put(g, P0, 'Orb of Regret', 'base');
  const v = put(g, P1, 'V(3)', 'base');
  g = play(g, P1, hand(g, P1, 'Discipline'), { targets: [[v]] });
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  expectPending(g, 'chainResponse', P0, 'P0 has priority on the opponent\'s turn');
  assert.equal(legal(g, P0, 'activate').filter(a => a.type === 'activate' && a.obj === orb).length, 0);
  const h = S0();
  const orb2 = put(h, P0, 'Orb of Regret', 'base'); put(h, P1, 'V(3)', 'base');
  assert.ok(legal(h, P0, 'activate').some(a => a.type === 'activate' && a.obj === orb2));
});

test('RJ#8581 Bellows Breath can\'t choose an enemy Ruin Runner (in its base or anywhere)', () => {
  let g = S0(); fundAll(g, P0, 6);
  const rr = put(g, P1, 'Ruin Runner', 'base');
  const v = put(g, P1, 'V(3)', 'base'), w = put(g, P1, 'V(3)', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Bellows Breath') });
  const seen = new Set<string>();
  for (let i = 0; i < 8 && pend(g).inStep; i++) {
    const d = pend(g); optionIds(g).forEach(x => seen.add(x));
    if (d.kind === 'optional') { g = no(g); continue; }
    if (d.kind === 'chooseTargets') { const o = optionIds(g).filter(x => x === v || x === w); g = act(g, { type: 'choose', player: P0, optionIds: o.length ? o.slice(0, d.max ?? 1) : [optionIds(g)[0]] }); continue; }
    g = choose(g, optionIds(g)[0]);
  }
  assert.ok(seen.has(v), 'other units offered');
  assert.ok(!seen.has(rr), 'Ruin Runner not offered');
});

test('RJ#8584 Grandmaster at Arms (Jax legend, no Action/Reaction) can\'t be activated by the defender during a showdown', () => {
  let { g, def } = attackSetup(['V(3)'], ['V(2)']);
  fundAll(g, P1);
  legend(g, P1, 'Grandmaster at Arms');
  const eq = put(g, P1, "Doran's Blade", 'base');
  void eq; void def;
  for (let i = 0; i < 4 && !(pend(g).kind === 'showdownAction' && pend(g).player === P1); i++) g = pass(g);
  expectPending(g, 'showdownAction', P1);
  const leg = g.players[P1].legend;
  assert.equal(legal(g, P1, 'activate').filter(a => a.type === 'activate' && a.obj === leg).length, 0);
});

test('RJ#8586 Teemo, Strategist chooses only one enemy unit; all the [Hidden] damage goes to it', () => {
  let g = S0({ tp: P1 });
  put(g, P0, 'Teemo, Strategist', BF_A); control(g, BF_A, P0);
  for (let k = 0; k < 3; k++) put(g, P0, 'V(1)', 'deckTop');
  put(g, P0, 'Hidden Blade', 'deckTop'); put(g, P0, 'Hidden Blade', 'deckTop');
  const a1 = put(g, P1, 'V(9)', 'base'), a2 = put(g, P1, 'V(9)', 'base');
  g = move(g, P1, [a1, a2], BF_A);
  let max = -1;
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g);
    if (d.kind === 'chooseTargets' && d.player === P0) { max = d.max ?? 1; g = choose(g, a1); }
    else if (d.kind === 'optional') g = no(g);
    else g = d.inStep ? choose(g, optionIds(g)[0]) : pass(g);
  }
  assert.equal(max, 1, 'one enemy unit');
  assert.equal(g.objects[a1].damage, 2, '1 per [Hidden] card');
  assert.equal(g.objects[a2].damage ?? 0, 0);
});

test('RJ#8591 Defiant Dance with only my Irelia and the enemy Irelia (Deflect): the enemy one must be chosen and its Deflect paid — without the extra [A] the play is undone', () => {
  const run = (runes: number) => {
    let g = S0();
    setRunes(g, P0, runes, 'calm');
    const m = put(g, P0, 'Irelia, Fervent', 'base'), e = put(g, P1, 'Irelia, Fervent', 'base');
    const dd = hand(g, P0, 'Defiant Dance');
    g = act(g, { type: 'playCard', player: P0, obj: dd });
    for (let i = 0; i < 8 && pend(g).inStep; i++) { const o = optionIds(g); g = choose(g, o.includes(m) ? m : o.includes(e) ? e : o[0]); }
    return { played: g.chain.some(c => c.source === dd), inHand: zone(g, dd) === 'hand' };
  };
  const one = run(1);
  assert.ok(!one.played && one.inHand, 'can\'t pay the Deflect [A]: not played');
  assert.ok(run(2).played, 'with the extra [A]');
});

test('RJ#8593 a unit with Assault moving to an open battlefield is not an attacker (non-combat showdown): no Assault bonus', () => {
  let g = S0();
  const a = put(g, P0, 'Assault(2,2)', 'base');
  g = move(g, P0, [a], BF_A);
  assert.equal(mightOf(g, a), 2, 'no +2 at an open battlefield');
  const s = attackSetup(['Assault(2,2)'], ['V(9)']);
  assert.equal(mightOf(s.g, s.atk[0]), 4, 'sanity: attacking an occupied battlefield → 4');
});

test('RJ#8600 Nocturne revealed by Teemo, Strategist\'s defend trigger in a combat can be played straight to the battlefield I am defending (I still control it)', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0);
  put(g, P0, 'Teemo, Strategist', BF_A); control(g, BF_A, P0);
  for (let k = 0; k < 5; k++) put(g, P0, 'V(1)', 'deckTop');
  const n = put(g, P0, 'Nocturne, Horrifying', 'deckTop');
  const a = put(g, P1, 'V(9)', 'base');
  g = move(g, P1, [a], BF_A);
  let dests: string[] = [];
  for (let i = 0; i < 40 && g.pending && !(g.pending.kind === 'mainAction'); i++) {
    const d = pend(g);
    if (d.kind === 'optional') { g = yes(g); continue; }
    if (d.kind === 'chooseDestination') { dests = optionIds(g); g = choose(g, dests.includes(String(BF_A)) ? String(BF_A) : dests[0]); continue; }
    if (d.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: d.player, assignment: (d.data as { suggested: Record<ObjId, number> }).suggested }); continue; }
    if (zone(g, n) === 'battlefield') break;
    g = d.inStep ? choose(g, optionIds(g).includes(a) ? a : optionIds(g)[0]) : pass(g);
  }
  assert.ok(dests.includes(String(BF_A)), `the defended battlefield offered (${dests})`);
  assert.equal(locOf(g, n), BF_A);
});

test('RJ#8603 when an equipped unit dies, its Equipment is recalled to base ready and can be equipped again', () => {
  let g = S0(); fundAll(g, P0, 6);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const b = put(g, P0, "Doran's Blade", 'base'); attachNow(g, b, u);
  const v = put(g, P0, 'V(2)', 'base');
  [g] = cast(g, P0, 'Hidden Blade', { targets: [[u]] });
  g = resolveChain(g); g = toStep(g);
  assert.equal(zone(g, u), 'trash');
  assert.equal(zone(g, b), 'base'); assert.equal(g.objects[b].exhausted, false, 'ready');
  assert.ok(legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === b), 'Equip available again');
  void v;
});

test('RJ#8604 playing Traveling Merchant is not a move: no discard/draw', () => {
  let g = S0(); fundAll(g, P0);
  const tm = hand(g, P0, 'Traveling Merchant');
  const n = g.log.length;
  g = play(g, P0, tm, { dest: 'base' }); g = resolveChain(g);
  assert.equal(zone(g, tm), 'base');
  assert.ok(!g.log.slice(n).some(l => /Trigger: Traveling Merchant/.test(l.text)), 'no move trigger');
});

test('RJ#8607 (MISMATCH-RJ, card text) Defy can\'t counter Rebuke: Rebuke\'s printed cost has [A][A], more than Defy\'s "no more than [A]" (Vex\'s increase is irrelevant either way)', () => {
  let g = S0();
  fundAll(g, P0, 4); fundAll(g, P1, 2);
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'Rebuke', { targets: [[e]] });
  if (pend(g).kind !== 'chainResponse') g = answer(g, { targets: [[e]] });
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  expectPending(g, 'chainResponse', P1);
  const df = hand(g, P1, 'Defy');
  assert.ok(!canPlayNow(g, P1, df));
});

test('RJ#8609 Arcane Shift on my attacker during combat: it can\'t be replayed to the contested battlefield (the defender controls it) — base only', () => {
  let { g, atk, def } = attackSetup(['V(3)', 'V(2)'], ['V(9)']);
  fundAll(g, P0);
  expectPending(g, 'showdownAction', P0);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Arcane Shift') });
  let dests: string[] = [];
  for (let i = 0; i < 30 && g.pending && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g); const o = optionIds(g);
    if (d.kind === 'chooseDestination') { dests = o; g = choose(g, o.includes('base') ? 'base' : o[0]); continue; }
    if (d.inStep) { g = choose(g, o.includes(atk[0]) ? atk[0] : o.includes(def[0]) ? def[0] : o[0]); continue; }
    g = pass(g);
  }
  assert.ok(!dests.includes(String(BF_A)), `contested battlefield not offered (${dests})`);
  assert.equal(locOf(g, atk[0]), 'base');
});

test('RJ#8610 (MISMATCH-RJ in part) I move into an empty battlefield, the opponent Rides the Wind Irelia, Fervent in: my Arcane Shift (paying her Deflect) replays MY banished unit, but not to that uncontrolled battlefield — base only', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1);
  const a = put(g, P0, 'V(3)', 'base');
  const ir = put(g, P1, 'Irelia, Fervent', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 4 && !(pend(g).kind === 'showdownAction' && pend(g).player === P1); i++) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Ride the Wind'), { targets: [[ir]], locations: [BF_A] });
  for (let i = 0; i < 20 && !(pend(g).kind === 'showdownAction' && pend(g).player === P0 && g.chain.length === 0); i++) {
    const d = pend(g); const o = optionIds(g);
    if (d.kind === 'chooseDestination') { g = choose(g, String(BF_A)); continue; }
    if (d.kind === 'optional') { g = no(g); continue; }
    g = d.inStep ? choose(g, o.includes(ir) ? ir : o[0]) : pass(g);
  }
  assert.equal(locOf(g, ir), BF_A);
  expectPending(g, 'showdownAction', P0);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Arcane Shift') });
  let dests: string[] = [];
  for (let i = 0; i < 30 && g.pending && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g); const o = optionIds(g);
    if (d.kind === 'chooseDestination') { dests = o; g = choose(g, o.includes('base') ? 'base' : o[0]); continue; }
    if (d.kind === 'optional') { g = yes(g); continue; }
    if (d.inStep) { g = choose(g, o.includes(a) ? a : o.includes(ir) ? ir : o[0]); continue; }
    g = pass(g);
  }
  assert.ok(!dests.includes(String(BF_A)), `uncontrolled battlefield not offered (${dests})`);
  assert.equal(locOf(g, a), 'base', 'my unit replayed to base');
  assert.ok((g.objects[ir].damage ?? 0) >= 3 || zone(g, ir) === 'trash', 'Irelia took 3');
});

test('RJ#8612 Sabotage recycles my Scrapheap from hand: recycling isn\'t discarding — no draw', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1);
  const sh = hand(g, P0, 'Scrapheap');
  const h0 = g.players[P0].hand.length;
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Sabotage') });
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) { const d = pend(g); const o = optionIds(g); g = d.inStep ? choose(g, o.includes(sh) ? sh : o.includes(String(P0)) ? String(P0) : o[0]) : pass(g); }
  assert.equal(zone(g, sh), 'mainDeck', 'recycled');
  assert.equal(g.players[P0].hand.length, h0 - 1, 'no draw');
});

test('RJ#8613 Cull the Weak chooses nothing when played: no Deflect cost for an opponent\'s Deflect unit', () => {
  const cost = (enemy: string) => {
    let g = S0(); fundAll(g, P0, 6);
    put(g, P0, 'V(1)', 'base'); const e = put(g, P1, enemy, 'base');
    const n = g.log.length;
    [g] = cast(g, P0, 'Cull the Weak');
    for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
    assert.equal(zone(g, e), 'trash');
    return g.log.slice(n).filter(l => /^P0 pays/.test(l.text)).map(l => l.text).join(' ');
  };
  assert.equal(cost('Deflect(3,1)'), cost('V(3)'));
});

test('RJ#8616 King\'s Edict: the opponent makes the choice on resolution, so their Ruin Runner can be chosen and dies', () => {
  let g = S0(); fundAll(g, P0, 10);
  const rr = put(g, P1, 'Ruin Runner', 'base');
  [g] = cast(g, P0, "King's Edict");
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) { const d = pend(g); const o = optionIds(g); g = d.inStep ? choose(g, o.includes(rr) ? rr : o[0]) : pass(g); }
  assert.equal(zone(g, rr), 'trash');
});

test('RJ#8617 Falling Star kills my Lonely Poro at a battlefield and my Lonely Poro in base at once; Zhonya\'s Hourglass saves the base one, the battlefield one died alone → its Deathknell draws 1', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1, 6);
  const p1 = put(g, P0, 'Lonely Poro', BF_A); control(g, BF_A, P0);
  const p2 = put(g, P0, 'Lonely Poro', 'base');
  put(g, P0, "Zhonya's Hourglass", 'base');
  const h0 = g.players[P0].hand.length;
  g = play(g, P1, hand(g, P1, 'Falling Star'), { targets: [[p1], [p2]] });
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) { const d = pend(g); const o = optionIds(g); g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : o.includes(p2) ? p2 : o[0]) : pass(g); }
  assert.equal(zone(g, p1), 'trash'); assert.equal(zone(g, p2), 'base', 'Hourglass saved the base Poro');
  assert.equal(g.players[P0].hand.length, h0 + 1, 'the dead Poro\'s Deathknell drew 1');
});

test('RJ#8619 picking my Irelia, Fervent for the opponent\'s Cull the Weak is not "choosing" her: no +1 trigger', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1, 6);
  const ir = put(g, P0, 'Irelia, Fervent', 'base'); put(g, P0, 'V(1)', 'base');
  put(g, P1, 'V(1)', 'base');
  const n = g.log.length;
  [g] = cast(g, P1, 'Cull the Weak');
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) { const d = pend(g); const o = optionIds(g); g = d.inStep ? choose(g, o.includes(ir) ? ir : o[0]) : pass(g); }
  assert.equal(zone(g, ir), 'trash');
  assert.ok(!g.log.slice(n).some(l => /^Trigger: Irelia/.test(l.text)), 'no "When you choose me" trigger');
});

test('RJ#8620 Confront also makes token units played this turn enter ready (Vanguard Armory Recruits)', () => {
  let g = withTokens(S0()); fundAll(g, P0, 6);
  const va = put(g, P0, 'Vanguard Armory', 'base');
  [g] = cast(g, P0, 'Confront'); g = resolveChain(g); g = toStep(g);
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === va)!);
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) { const d = pend(g); const o = optionIds(g); g = d.inStep ? choose(g, o.includes('base') ? 'base' : o[0]) : pass(g); }
  const recruits = Object.values(g.objects).filter(o => o.isToken && g.cards[o.cardId]?.name === 'Recruit' && o.zone === 'base');
  assert.equal(recruits.length, 3);
  assert.ok(recruits.every(r => !r.exhausted), 'entered ready');
});

test('RJ#8622 at 6, conquering with a unit wearing Skyfall of Areion + Trinity Force: conquer 7, then Trinity Force\'s hold point (as a conquer effect) 8 → win', () => {
  let g = S0(); fundAll(g, P0);
  g.players[P0].points = 6; g.timestamp++;
  const u = put(g, P0, 'V(4)', 'base');
  attachNow(g, put(g, P0, 'Trinity Force', 'base'), u);
  attachNow(g, put(g, P0, 'Skyfall of Areion', 'base'), u);
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [u], BF_A);
  for (let i = 0; i < 30 && g.pending && g.winner == null && pend(g).kind !== 'mainAction'; i++) { const d = pend(g); g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : d.options![0].id) : pass(g); }
  assert.equal(g.winner, P0);
});

// RJ#8623 — AMBIGUOUS (RJ "3", self-labelled author interpretation, no official FAQ) → not adopted, flagged for the lead: Repeat
// executes the effect one more time (CR 820.1.d) and "If you do" refers to the additional cost that was paid when Meditation was
// played, so both executions draw 2 → 4.
test('RJ#8623 (AMBIGUOUS, RJ not adopted) Meditation with its exhaust cost paid and Repeat from Temporal Portal: both executions see "if you do" → draw 4', () => {
  let g = S0(); fundAll(g, P0, 12);
  const u = put(g, P0, 'V(2)', 'base');
  const tp = put(g, P0, 'Temporal Portal', 'base');
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === tp)!); g = toStep(g);
  const m = hand(g, P0, 'Meditation');
  const h0 = g.players[P0].hand.length - 1;
  g = act(g, { type: 'playCard', player: P0, obj: m });
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) { const d = pend(g); g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : optionIds(g).includes(u) ? u : optionIds(g)[0]) : pass(g); }
  assert.equal(g.objects[u].exhausted, true);
  assert.equal(g.players[P0].hand.length - h0, 4);
});

test('RJ#8626 Singularity kills Karthus, Eternal and Machine Evangel together: Evangel\'s Deathknell triggers twice → 6 Recruits', () => {
  let g = withTokens(S0()); fundAll(g, P0, 10);
  const k = put(g, P0, 'Karthus, Eternal', 'base'), m = put(g, P0, 'Machine Evangel', 'base');
  g = play(g, P0, hand(g, P0, 'Singularity'), { targets: [[k, m]] });
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) { const d = pend(g); const o = optionIds(g); g = d.inStep ? choose(g, o.includes(k) ? k : o.includes('base') ? 'base' : o[0]) : pass(g); }
  assert.deepEqual([zone(g, k), zone(g, m)], ['trash', 'trash']);
  const recruits = Object.values(g.objects).filter(o => o.isToken && g.cards[o.cardId]?.name === 'Recruit' && o.zone === 'base' && o.controller === P0);
  assert.equal(recruits.length, 6);
});

test('RJ#8637 Tideturner played to base swapping with my unit at Vilemaw\'s Lair: Tideturner moves to the Lair, the unit can\'t move to base and stays', () => {
  let g = S0({ bfA: "Vilemaw's Lair" }); fundAll(g, P0);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const tt = hand(g, P0, 'Tideturner');
  g = act(g, { type: 'playCard', player: P0, obj: tt });
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g); const o = optionIds(g);
    if (d.kind === 'chooseDestination') { g = choose(g, o.includes('base') ? 'base' : o[0]); continue; }
    g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : o.includes(u) ? u : o[0]) : pass(g);
  }
  assert.equal(locOf(g, tt), BF_A, 'Tideturner moves to the Lair');
  assert.equal(locOf(g, u), BF_A, 'the unit stays at the Lair');
});

test('RJ#8639 Falling Star resolves both damage instructions as one chain item: no window between them', () => {
  let g = S0(); fundAll(g, P0, 8); fundAll(g, P1, 8);
  const a = put(g, P1, 'V(3)', 'base'), b = put(g, P1, 'V(3)', 'base');
  g = play(g, P0, hand(g, P0, 'Falling Star'), { targets: [[a], [b]] });
  assert.equal(g.chain.length, 1);
  g = pass(g);
  expectPending(g, 'chainResponse', P1);
  g = pass(g);
  assert.equal(g.chain.length, 0);
  assert.deepEqual([zone(g, a), zone(g, b)], ['trash', 'trash'], 'both instances dealt in one resolution');
  expectPending(g, 'mainAction', P0);
});

test('RJ#8640 Not So Fast can counter an enemy Get Excited! choosing my unit, but not my own Get Excited! or one choosing the enemy\'s own unit', () => {
  const can = (caster: PlayerId, targetOwner: PlayerId) => {
    let g = S0({ tp: caster }); fundAll(g, P0, 6); fundAll(g, P1, 6);
    const t = put(g, targetOwner, 'V(5)', BF_A); control(g, BF_A, targetOwner);
    hand(g, caster, 'V(2)');
    const nsf = hand(g, P0, 'Not So Fast');
    g = play(g, caster, hand(g, caster, 'Get Excited!'), { targets: [[t]] });
    for (let i = 0; i < 10 && pend(g).inStep; i++) g = choose(g, optionIds(g)[0]);
    if (caster === P1) g = pass(g);
    return g.chain.length > 0 && pend(g).player === P0 && canPlayNow(g, P0, nsf);
  };
  assert.equal(can(P1, P0), true, 'enemy spell choosing my unit');
  assert.equal(can(P1, P1), false, 'enemy spell choosing its own unit');
  assert.equal(can(P0, P0), false, 'my own spell');
});

test('RJ#8652 Spinning Axe\'s Equip can attach it to any unit I control, not only Draven', () => {
  let g = S0(); fundAll(g, P0, 4);
  const u = put(g, P0, 'V(2)', 'base');
  const ax = put(g, P0, 'Spinning Axe', 'base');
  const eq = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === ax);
  assert.ok(eq, 'Equip available');
  g = act(g, eq!);
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) { const d = pend(g); const o = optionIds(g); g = d.inStep ? choose(g, o.includes(u) ? u : o[0]) : pass(g); }
  assert.equal(g.objects[ax].attachedTo, u);
});

test('RJ#8654 Last Rites\' "When I conquer or hold" triggers when the equipped unit holds in my Beginning Phase: play a unit from my trash', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 6);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  attachNow(g, put(g, P0, 'Last Rites', BF_A), u);
  const t = put(g, P0, 'V(3)', 'trash');
  g = act(g, { type: 'endTurn', player: P1 });
  let asked = false;
  for (let i = 0; i < 40 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g); const o = optionIds(g);
    if (o.includes(t)) asked = true;
    if (d.kind === 'chooseDestination') { g = choose(g, o.includes('base') ? 'base' : o[0]); continue; }
    g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : o.includes(t) ? t : o[0]) : pass(g);
  }
  assert.ok(asked, 'hold trigger offered the trash unit');
  assert.ok(['base', 'battlefield'].includes(zone(g, t)), `played from trash (${zone(g, t)})`);
});

test('RJ#8659 the opponent moves a unit into an open battlefield: in the showdown that follows I may Rebuke it (Action) and they don\'t conquer', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 6);
  const e = put(g, P1, 'V(2)', 'base');
  const rb = hand(g, P0, 'Rebuke');
  g = move(g, P1, [e], BF_A);
  for (let i = 0; i < 6 && !(pend(g).kind === 'showdownAction' && pend(g).player === P0); i++) g = pass(g);
  expectPending(g, 'showdownAction', P0);
  assert.ok(canPlayNow(g, P0, rb));
  g = play(g, P0, rb, { targets: [[e]] });
  g = toStep(g);
  assert.equal(zone(g, e), 'hand');
  assert.notEqual(g.battlefields[BF_A].controller, P1);
});

test('RJ#8667 Time Warp given Repeat (Temporal Portal): both executions add an extra turn → two consecutive extra turns', () => {
  let g = S0(); fundAll(g, P0, 20); addRunes(g, P0, 10, 'mind');
  const tp = put(g, P0, 'Temporal Portal', 'base');
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === tp)!); g = toStep(g);
  const tw = hand(g, P0, 'Time Warp');
  g = act(g, { type: 'playCard', player: P0, obj: tw });
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) { const d = pend(g); g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : optionIds(g)[0]) : pass(g); }
  assert.equal(zone(g, tw), 'banishment');
  g = nextTurn(g); assert.equal(g.activePlayer, P0, 'extra turn 1');
  g = nextTurn(g); assert.equal(g.activePlayer, P0, 'extra turn 2');
  g = nextTurn(g); assert.equal(g.activePlayer, P1, 'then the opponent');
});

test('RJ#8669 Akshan (additional cost paid) takes an enemy Hexdrinker attached to a unit: the gear is chosen, not the Deflect unit — no Deflect cost', () => {
  const run = (gear: string) => {
    let g = S0(); fundAll(g, P0, 10);
    const e = put(g, P1, 'V(3)', 'base');
    const hx = put(g, P1, gear, 'base'); attachNow(g, hx, e);
    const ak = hand(g, P0, 'Akshan');
    const n = g.log.length;
    g = act(g, { type: 'playCard', player: P0, obj: ak });
    for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
      const d = pend(g); const o = optionIds(g);
      if (d.kind === 'chooseDestination') { g = choose(g, o.includes('base') ? 'base' : o[0]); continue; }
      g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : o.includes(hx) ? hx : o[0]) : pass(g);
    }
    assert.equal(g.objects[hx].attachedTo, ak, `${gear} attached to Akshan`);
    return g.log.slice(n).filter(l => /^P0 pays/.test(l.text)).map(l => l.text).join(' ');
  };
  assert.equal(run('Hexdrinker'), run('Blade of the Exile'));
});

test('RJ#8670 Unyielding Spirit does not stop Imperial Decree: combat damage still kills via the Decree (and the Decree\'s kill isn\'t damage)', () => {
  let g = S0(); fundAll(g, P0, 12);
  const a = put(g, P0, 'V(3)', 'base');
  const d = put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'Imperial Decree'); g = resolveChain(g); g = toStep(g);
  [g] = cast(g, P0, 'Unyielding Spirit'); g = resolveChain(g); g = toStep(g);
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) { const dd = pend(g); g = dd.inStep ? choose(g, optionIds(g)[0]) : pass(g); }
  assert.equal(zone(g, d), 'trash');
  assert.equal(zone(g, a), 'trash', 'the attacker took 1 combat damage and the Decree killed it');
});

test('RJ#8676 (MISMATCH-RJ in part: card text "Heal me") Guardian Angel saves an equipped, buffed unit from lethal damage: other Equipment and the buff stay, but the damage is healed', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1, 8);
  const u = put(g, P0, 'V(2)', BF_A, { buff: true, damage: 4 }); control(g, BF_A, P0);
  const o = put(g, P0, 'V(5)', BF_A);
  attachNow(g, put(g, P0, 'Guardian Angel', BF_A), u);
  const bl = put(g, P0, 'Blade of the Exile', BF_A); attachNow(g, bl, u);
  const m = mightOf(g, u);
  g = play(g, P1, hand(g, P1, 'Falling Star'), { targets: [[u], [o]] });
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) { const d = pend(g); g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : optionIds(g)[0]) : pass(g); }
  assert.equal(locOf(g, u), 'base', 'saved and recalled');
  assert.equal(g.objects[bl].attachedTo, u, 'other Equipment still attached');
  assert.equal(g.objects[u].counters?.buff, 1, 'buff kept');
  assert.equal(g.objects[u].damage ?? 0, 0, 'healed');
  assert.ok(m >= 4 && m <= 7, `lethal: 4 + 3 damage vs ${m} Might`);
});

test('RJ#8673 Not So Fast can\'t counter King\'s Edict (it chooses nothing when played; the opponent chooses on resolution)', () => {
  let g = S0(); fundAll(g, P0, 10); fundAll(g, P1, 6);
  put(g, P1, 'V(2)', 'base');
  const nsf = hand(g, P1, 'Not So Fast');
  [g] = cast(g, P0, "King's Edict");
  g = pass(g);
  expectPending(g, 'chainResponse', P1);
  assert.equal(canPlayNow(g, P1, nsf), false);
});

test('RJ#8681 Cull the Weak chooses nothing: an opponent whose only unit is Ruin Runner must kill it', () => {
  let g = S0(); fundAll(g, P0, 6);
  put(g, P0, 'V(1)', 'base');
  const rr = put(g, P1, 'Ruin Runner', 'base');
  [g] = cast(g, P0, 'Cull the Weak');
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(zone(g, rr), 'trash');
});

test('RJ#8682 Bone Skewer can choose Ruin Runner in the opponent\'s hand (its "can\'t be chosen" works only on the board): it is played there, stunned', () => {
  let g = S0(); fundAll(g, P0, 6);
  const rr = hand(g, P1, 'Ruin Runner');
  const bf = g.battlefields[BF_A].objId;
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Bone Skewer') });
  let offered = false;
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g); const o = optionIds(g);
    if (o.includes(rr)) offered = true;
    g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : o.includes(rr) ? rr : o.includes(bf) ? bf : o[0]) : pass(g);
  }
  assert.ok(offered, 'Ruin Runner offered');
  assert.equal(locOf(g, rr), BF_A);
  assert.ok(g.objects[rr].stunned, 'stunned');
});

test('RJ#8683 Bone Skewer picking Rengar (Deflect) from the opponent\'s hand: no Deflect cost (a card in hand isn\'t a permanent) and the stun owes none either', () => {
  const run = (name: string) => {
    let g = S0(); fundAll(g, P0, 6);
    const r = hand(g, P1, name);
    const bf = g.battlefields[BF_A].objId;
    const n = g.log.length;
    g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Bone Skewer') });
    for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
      const d = pend(g); const o = optionIds(g);
      g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : o.includes(r) ? r : o.includes(bf) ? bf : o[0]) : pass(g);
    }
    assert.equal(locOf(g, r), BF_A); assert.ok(g.objects[r].stunned, `${name} stunned`);
    return g.log.slice(n).filter(l => /^P0 pays/.test(l.text)).map(l => l.text).join(' ');
  };
  assert.equal(run('unl-024-219'), run('V(3)'), 'same payment as for a unit without Deflect');
});

test('RJ#8684 my Elder Dragon + my Flurry of Blades: enemy units at battlefields die to 1, my own units just take 1', () => {
  let g = S0(); fundAll(g, P0, 6);
  put(g, P0, 'Elder Dragon', 'base');
  const mine = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(3)', BF_B); control(g, BF_B, P1);
  [g] = cast(g, P0, 'Flurry of Blades');
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(zone(g, e), 'trash');
  assert.equal(zone(g, mine), 'battlefield'); assert.equal(g.objects[mine].damage, 1);
});

test('RJ#8685 Vex, Apathetic stuns an enemy Baron Nashor as it is played: the trigger names the played unit, it doesn\'t choose it', () => {
  let g = S0(); fundAll(g, P0, 12);
  put(g, P1, 'unl-150-219', BF_A); control(g, BF_A, P1);
  const bn = hand(g, P0, 'Baron Nashor');
  g = act(g, { type: 'playCard', player: P0, obj: bn });
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) { const d = pend(g); g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : optionIds(g)[0]) : pass(g); }
  assert.ok(['base', 'battlefield'].includes(zone(g, bn)));
  assert.ok(g.objects[bn].stunned, 'Baron Nashor stunned');
});

test('RJ#8686 Deceiver (LeBlanc legend) holding with an empty hand: the discard is a cost — the trigger can\'t be finalized, no Reflection (with a card in hand it can)', () => {
  const run = (cards: number) => {
    let g = withTokens(S0({ tp: P1 }));
    legend(g, P0, 'Deceiver');
    put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
    g.players[P0].hand = []; g.timestamp++;
    for (let k = 0; k < cards; k++) hand(g, P0, 'V(1)');
    g = act(g, { type: 'endTurn', player: P1 });
    for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) { const d = pend(g); g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : optionIds(g)[0]) : pass(g); }
    assert.ok(g.players[P0].points >= 1, 'held');
    return Object.values(g.objects).filter(o => o.isToken && /Reflection/.test(g.cards[o.cardId]?.name ?? '') && ['base', 'battlefield'].includes(o.zone)).length;
  };
  assert.equal(run(0), 0, 'no Reflection with an empty hand');
  assert.equal(run(1), 1, 'Reflection when the discard can be paid');
});

test('RJ#8695 Pickpocket can be played with no gear on the board: it enters, its trigger does nothing, no Gold', () => {
  let g = withTokens(S0()); fundAll(g, P0, 4);
  const pp = hand(g, P0, 'Pickpocket');
  g = act(g, { type: 'playCard', player: P0, obj: pp });
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) { const d = pend(g); const o = optionIds(g); g = d.inStep ? choose(g, o.includes('base') ? 'base' : d.kind === 'optional' ? 'yes' : o[0]) : pass(g); }
  assert.equal(zone(g, pp), 'base');
  assert.equal(Object.values(g.objects).filter(o => o.isToken && g.cards[o.cardId]?.name === 'Gold').length, 0);
});

test('RJ#8696 the opponent attacks my battlefield A; in the showdown my Arcane Shift banishes my unit at battlefield B and replays it to A (I control A), dealing 3 to the attacker', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 8);
  const da = put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const ub = put(g, P0, 'V(4)', BF_B); control(g, BF_B, P0);
  const at = put(g, P1, 'V(3)', 'base');
  g = move(g, P1, [at], BF_A);
  for (let i = 0; i < 6 && !(pend(g).kind === 'showdownAction' && pend(g).player === P0); i++) g = pass(g);
  expectPending(g, 'showdownAction', P0);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Arcane Shift') });
  let dests: string[] = [];
  for (let i = 0; i < 30 && g.pending && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g); const o = optionIds(g);
    if (d.kind === 'chooseDestination') { dests = o; g = choose(g, o.includes(String(BF_A)) ? String(BF_A) : o[0]); continue; }
    if (d.inStep) { g = choose(g, o.includes(ub) ? ub : o.includes(at) ? at : o[0]); continue; }
    g = pass(g);
  }
  assert.ok(dests.includes(String(BF_A)), `battlefield A offered (${dests})`);
  assert.equal(locOf(g, ub), BF_A);
  assert.equal(zone(g, at), 'trash', '3 damage killed the attacker');
  void da;
});

test('RJ#8699 Downwell returns Gold tokens too: they cease to exist (not kept in hand)', () => {
  let g = withTokens(S0()); fundAll(g, P0, 10);
  const pp = hand(g, P0, 'Pickpocket');
  put(g, P1, 'Gold', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: pp });
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) { const d = pend(g); const o = optionIds(g); g = d.inStep ? choose(g, o.includes('base') ? 'base' : d.kind === 'optional' ? 'yes' : o[0]) : pass(g); }
  const golds = () => Object.values(g.objects).filter(o => g.cards[o.cardId]?.name === 'Gold' && ['base', 'battlefield', 'hand'].includes(o.zone));
  assert.ok(golds().length >= 1, 'a Gold token on the board');
  [g] = cast(g, P0, 'Downwell');
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(zone(g, pp), 'hand');
  assert.equal(golds().length, 0, 'Gold tokens gone');
  assert.ok(!g.players[P0].hand.some(id => g.cards[g.objects[id]?.cardId]?.name === 'Gold'));
});

test('RJ#8705 Grandmaster at Arms re-attaching Brutalizer to the unit it is already attached to does nothing (CR 435.1): no new +2', () => {
  let g = S0();
  legend(g, P0, 'Grandmaster at Arms');
  const u = put(g, P0, 'V(2)', 'base');
  const br = put(g, P0, 'Brutalizer', 'base'); attachNow(g, br, u);
  const m0 = mightOf(g, u);
  const lg = g.players[P0].legend;
  const acts = legal(g, P0, 'activate').filter(a => a.type === 'activate' && a.obj === lg);
  assert.ok(acts.length > 0, 'legend abilities available');
  for (const a of acts) {
    let h = act(g, a);
    for (let i = 0; i < 20 && h.pending && h.pending.kind !== 'mainAction'; i++) { const d = pend(h); const o = optionIds(h); h = d.inStep ? choose(h, o.includes(br) ? br : o.includes(u) ? u : o[0]) : pass(h); }
    assert.equal(h.objects[br].attachedTo, u);
    assert.equal(mightOf(h, u), m0, 'no Brutalizer +2 from a "re-attach" to the same unit');
  }
});

test('RJ#8706 Assault lasts while the unit is an attacker, through the conquer: Jinx (4, Assault 2) conquers Sunken Temple as a Mighty unit → may pay [1] to draw', () => {
  let g = S0({ bfA: 'Sunken Temple' }); fundAll(g, P0, 6);
  const j = put(g, P0, 'ogn-030-298', 'base');
  const d = put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [j], BF_A);
  const h0 = g.players[P0].hand.length;
  let offered = false;
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const dd = pend(g);
    if (dd.kind === 'optional' && /Sunken|draw/i.test(dd.prompt ?? '')) offered = true;
    g = dd.inStep ? choose(g, dd.kind === 'optional' ? 'yes' : optionIds(g)[0]) : pass(g);
  }
  assert.equal(zone(g, d), 'trash'); assert.equal(g.battlefields[BF_A].controller, P0);
  assert.ok(offered || g.players[P0].hand.length === h0 + 1, 'Sunken Temple trigger');
  assert.equal(g.players[P0].hand.length, h0 + 1, 'drew 1');
});

test('RJ#8707 Imperial Decree, then I attack the opponent\'s Draven, Audacious (Glorious Executioner legend): the Decree kills him in the combat cleanup, before the result — I score 1 for his death, they win nothing and draw nothing', () => {
  let g = S0(); fundAll(g, P0, 10);
  legend(g, P1, 'Glorious Executioner');
  const dr = put(g, P1, 'sfd-148-221', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(2)', 'base');
  [g] = cast(g, P0, 'Imperial Decree'); g = resolveChain(g); g = toStep(g);
  const h1 = g.players[P1].hand.length, p0 = g.players[P0].points, p1 = g.players[P1].points;
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 40 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g); const o = optionIds(g);
    if (d.kind === 'optional') { g = no(g); continue; }
    g = d.inStep ? choose(g, o.includes(String(P0)) ? String(P0) : o[0]) : pass(g);
  }
  assert.equal(zone(g, dr), 'trash'); assert.equal(zone(g, a), 'trash');
  assert.equal(g.players[P0].points, p0 + 1, 'Draven\'s "die in combat" point');
  assert.equal(g.players[P1].points, p1, 'Draven never won the combat');
  assert.equal(g.players[P1].hand.length, h1, 'no Glorious Executioner draw');
});

test('RJ#8708 (MISMATCH-RJ, CR 383.3.b) Warmog\'s Armor on an unbuffed unit conquering Monastery of Hirana: Monastery\'s "you may spend a buff" is paid when it goes on the chain, so the Warmog buff comes too late — no draw', () => {
  let g = S0({ bfA: 'Monastery of Hirana' }); fundAll(g, P0, 6);
  const u = put(g, P0, 'V(3)', 'base');
  attachNow(g, put(g, P0, "Warmog's Armor", 'base'), u);
  const h0 = g.players[P0].hand.length;
  g = move(g, P0, [u], BF_A);
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) { const d = pend(g); g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : optionIds(g)[0]) : pass(g); }
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.objects[u].counters?.buff, 1, 'Warmog buffed it');
  assert.equal(g.players[P0].hand.length, h0, 'no Monastery draw');
});

test('RJ#8710 Virtuoso (legend): a countered [4]+ spell is not played — no banish trigger', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1, 6);
  legend(g, P0, 'Virtuoso');
  const sp = hand(g, P0, 'Imperial Decree');
  g = play(g, P0, sp); g = pass(g);
  g = play(g, P1, hand(g, P1, 'Wind Wall'), { targets: [[sp]] });
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) { const d = pend(g); g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : optionIds(g)[0]) : pass(g); }
  assert.equal(zone(g, sp), 'trash', 'countered, not banished by Virtuoso');
  let g2 = S0(); fundAll(g2, P0, 12); legend(g2, P0, 'Virtuoso');
  const sp2 = hand(g2, P0, 'Imperial Decree');
  g2 = play(g2, P0, sp2);
  for (let i = 0; i < 20 && g2.pending && g2.pending.kind !== 'mainAction'; i++) { const d = pend(g2); g2 = d.inStep ? choose(g2, d.kind === 'optional' ? 'yes' : optionIds(g2)[0]) : pass(g2); }
  assert.equal(zone(g2, sp2), 'banishment', 'uncountered: Virtuoso banishes it');
});

test('RJ#8711 Hidden Blade with Repeat (Temporal Portal) on the opponent\'s only unit at a battlefield: the first kill draws them 2; the repeat has no unit, so no second kill or draw (I draw 0, they draw 2)', () => {
  let g = S0(); fundAll(g, P0, 12);
  const tp = put(g, P0, 'Temporal Portal', 'base');
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === tp)!); g = toStep(g);
  const hb = hand(g, P0, 'Hidden Blade');
  const h0 = g.players[P0].hand.length - 1, h1 = g.players[P1].hand.length;
  g = act(g, { type: 'playCard', player: P0, obj: hb });
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) { const d = pend(g); const o = optionIds(g); g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : o.includes(e) ? e : o[0]) : pass(g); }
  assert.equal(zone(g, e), 'trash');
  assert.equal(g.players[P1].hand.length, h1 + 2);
  assert.equal(g.players[P0].hand.length, h0);
});

test('RJ#8713 (MISMATCH-RJ) buffed unit with Warmog\'s Armor conquers Monastery of Hirana: Monastery\'s buff is spent when it is chained (draw 1), then Warmog\'s conquer trigger resolves on an unbuffed unit and buffs it again', () => {
  let g = S0({ bfA: 'Monastery of Hirana' }); fundAll(g, P0, 6);
  const u = put(g, P0, 'V(3)', 'base', { buff: true });
  attachNow(g, put(g, P0, "Warmog's Armor", 'base'), u);
  const h0 = g.players[P0].hand.length;
  g = move(g, P0, [u], BF_A);
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) { const d = pend(g); g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : optionIds(g)[0]) : pass(g); }
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[P0].hand.length, h0 + 1, 'Monastery drew 1');
  assert.equal(g.objects[u].counters?.buff, 1, 'buffed again by Warmog\'s Armor');
});

test('RJ#8716 Ezreal, Prodigy played with no other cards in hand: discard nothing, still draw 2', () => {
  let g = S0(); fundAll(g, P0, 8);
  g.players[P0].hand = []; g.timestamp++;
  const ez = hand(g, P0, 'Ezreal, Prodigy');
  g = act(g, { type: 'playCard', player: P0, obj: ez });
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) { const d = pend(g); const o = optionIds(g); g = d.inStep ? choose(g, o.includes('base') ? 'base' : d.kind === 'optional' ? 'yes' : o[0]) : pass(g); }
  assert.equal(zone(g, ez), 'base');
  assert.equal(g.players[P0].hand.length, 2);
});

test('RJ#8717 an exhausted Irelia, Fervent readied in my Ready/Awaken step gets +1 (5 this turn); an already-ready one stays 4', () => {
  const run = (exhausted: boolean) => {
    let g = S0({ tp: P1 });
    const ir = put(g, P0, 'Irelia, Fervent', 'base', { ready: !exhausted });
    g = act(g, { type: 'endTurn', player: P1 });
    for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) { const d = pend(g); g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : optionIds(g)[0]) : pass(g); }
    assert.equal(g.activePlayer, P0);
    return mightOf(g, ir);
  };
  assert.equal(run(true), 5);
  assert.equal(run(false), 4);
});

test('RJ#8721 Alpha Strike splitting damage onto an enemy Deflect unit owes its Deflect cost (chosen when played); the friendly unit owes none', () => {
  const run = (enemy: string) => {
    let g = S0(); fundAll(g, P0, 10);
    const f = put(g, P0, 'V(3)', 'base');
    const e = put(g, P1, enemy, BF_A); control(g, BF_A, P1);
    const n = g.log.length;
    g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Alpha Strike') });
    for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
      const d = pend(g); const o = optionIds(g);
      if (d.kind === 'optional') { g = yes(g); continue; }
      g = d.inStep ? choose(g, o.includes(f) ? f : o.includes(e) ? e : o[0]) : pass(g);
    }
    assert.equal(zone(g, e), 'trash');
    return g.log.slice(n).filter(l => /^P0 pays/.test(l.text)).map(l => l.text).join(' ');
  };
  assert.notEqual(run('Deflect(3,1)'), run('V(3)'), 'Deflect tax paid for the enemy Deflect unit');
});

test('RJ#8725 Grandmaster at Arms moves Brutalizer from one unit to another: the new unit gets the "attached this turn" +2; the old one loses it', () => {
  let g = S0();
  legend(g, P0, 'Grandmaster at Arms');
  const a = put(g, P0, 'V(2)', 'base'), b = put(g, P0, 'V(2)', 'base');
  const br = put(g, P0, 'Brutalizer', 'base'); attachNow(g, br, a);
  const ma = mightOf(g, a), mb = mightOf(g, b);
  const lg = g.players[P0].legend;
  const acts = legal(g, P0, 'activate').filter(x => x.type === 'activate' && x.obj === lg);
  let done = false;
  for (const x of acts) {
    let h = act(g, x);
    for (let i = 0; i < 20 && h.pending && h.pending.kind !== 'mainAction'; i++) { const d = pend(h); const o = optionIds(h); h = d.inStep ? choose(h, o.includes(br) ? br : o.includes(b) ? b : o[0]) : pass(h); }
    if (h.objects[br].attachedTo !== b) continue;
    done = true;
    assert.equal(mightOf(h, a), 2, 'the first unit lost Brutalizer');
    const eqM = g.cards[g.objects[br].cardId].might ?? 0;
    assert.equal(mightOf(h, b), mb + eqM + 2, `new unit: Equipment Might ${eqM} and the +2 (${mb} -> ${mightOf(h, b)})`);
    void ma;
  }
  assert.ok(done, 'moved by the [T] ability');
});

test('RJ#8730 Confront, then Maduli the Gatekeeper ("I can\'t be readied") enters ready: entering ready isn\'t readying', () => {
  let g = S0(); fundAll(g, P0, 10);
  [g] = cast(g, P0, 'Confront'); g = resolveChain(g); g = toStep(g);
  const m = hand(g, P0, 'Maduli the Gatekeeper');
  g = act(g, { type: 'playCard', player: P0, obj: m });
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) { const d = pend(g); const o = optionIds(g); g = d.inStep ? choose(g, o.includes('base') ? 'base' : o[0]) : pass(g); }
  assert.equal(zone(g, m), 'base');
  assert.equal(g.objects[m].exhausted, false, 'entered ready');
});

test('RJ#8739 my defending Glasc Mixologist dies in combat: its Deathknell may play Xin Zhao from my trash to that battlefield (I still control it); a new combat is staged', () => {
  let { g, def } = attackSetup(['V(12)'], ['Glasc Mixologist'], { runes: [6, 6] });
  const xz = put(g, P1, 'Xin Zhao', 'trash');
  for (let i = 0; i < 40 && zone(g, def[0]) !== 'trash'; i++) { const d = pend(g); g = d.kind === 'assignDamage' ? act(g, legal(g, d.player)[0]) : pass(g); }
  assert.equal(zone(g, def[0]), 'trash');
  for (let i = 0; i < 30 && zone(g, xz) === 'trash' && g.pending; i++) {
    const d = pend(g); const o = optionIds(g);
    if (d.kind === 'chooseDestination') { g = choose(g, o.includes(String(BF_A)) ? String(BF_A) : o[0]); continue; }
    if (d.kind === 'optional') { g = yes(g); continue; }
    g = d.inStep ? choose(g, o.includes(xz) ? xz : o[0]) : pass(g);
  }
  assert.equal(locOf(g, xz), BF_A, 'Xin Zhao played to the battlefield');
  for (let i = 0; i < 10 && g.chain.length; i++) g = pass(g);
  assert.ok(g.showdown?.isCombat && g.showdown.battlefieldIndex === BF_A, 'new combat at BF-A');
  assert.equal(g.showdown!.attacker, P0); assert.equal(g.showdown!.defender, P1);
});

test('RJ#8741 my defending Draven, Audacious killed by the attacker\'s spell during the combat showdown dies "in combat": the attacker scores 1', () => {
  let { g, def } = attackSetup(['V(3)'], ['sfd-148-221'], { runes: [8, 8] });
  const p0 = g.players[P0].points;
  expectPending(g, 'showdownAction', P0);
  g = play(g, P0, hand(g, P0, 'KillA'), { targets: [[def[0]]] });
  for (let i = 0; i < 20 && zone(g, def[0]) !== 'trash'; i++) { const d = pend(g); g = d.inStep ? choose(g, optionIds(g).includes(String(P0)) ? String(P0) : optionIds(g)[0]) : pass(g); }
  for (let i = 0; i < 20 && g.chain.length; i++) { const d = pend(g); g = d.inStep ? choose(g, optionIds(g).includes(String(P0)) ? String(P0) : optionIds(g)[0]) : pass(g); }
  assert.equal(zone(g, def[0]), 'trash');
  assert.notEqual(g.battlefields[BF_A].controller, P0, 'not conquered yet');
  assert.equal(g.players[P0].points, p0 + 1, 'Draven\'s "When I die in combat" point');
});

test('RJ#8742 Diana (unl-149) gets +2 for each spell played; a spell with Repeat counts once', () => {
  let g = S0(); fundAll(g, P0, 20);
  const d = put(g, P0, 'unl-149-219', 'base');
  const m0 = mightOf(g, d);
  const t = put(g, P1, 'V(9)', 'base');
  for (let k = 0; k < 2; k++) {
    g = play(g, P0, hand(g, P0, 'ZapM'), { targets: [[t]] });
    for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) { const dd = pend(g); g = dd.inStep ? choose(g, dd.kind === 'optional' ? 'yes' : optionIds(g)[0]) : pass(g); }
  }
  assert.equal(mightOf(g, d), m0 + 4, 'two spells: +4');
  const tp = put(g, P0, 'Temporal Portal', 'base');
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === tp)!); g = toStep(g);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Meditation') });
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) { const dd = pend(g); g = dd.inStep ? choose(g, dd.kind === 'optional' ? 'yes' : optionIds(g)[0]) : pass(g); }
  assert.equal(mightOf(g, d), m0 + 6, 'repeated spell: one more +2');
});

test('RJ#8748 three Altars of Memories and one friendly unit dies: each triggers separately and may be used (all three exhaust)', () => {
  let g = S0(); fundAll(g, P0, 4);
  const al = [0, 1, 2].map(() => put(g, P0, 'Altar of Memories', 'base'));
  const u = put(g, P0, 'V(2)', 'base');
  g = play(g, P0, hand(g, P0, 'ZapM'), { targets: [[u]] });
  let opts = 0;
  for (let i = 0; i < 40 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'optional') { opts++; g = yes(g); continue; }
    g = d.inStep ? choose(g, optionIds(g)[0]) : pass(g);
  }
  assert.equal(zone(g, u), 'trash');
  assert.deepEqual(al.map(a => g.objects[a].exhausted), [true, true, true], `all three used (${opts} prompts)`);
});

test('RJ#8749 two Guardian Angels on one unit: only one replaces the death and is killed; the other stays attached', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1, 6);
  const u = put(g, P0, 'V(2)', BF_A, { damage: 5 }); control(g, BF_A, P0);
  const ga1 = put(g, P0, 'Guardian Angel', BF_A), ga2 = put(g, P0, 'Guardian Angel', BF_A);
  attachNow(g, ga1, u); attachNow(g, ga2, u);
  g = play(g, P1, hand(g, P1, 'ZapM'), { targets: [[u]] });
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) { const d = pend(g); g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : optionIds(g)[0]) : pass(g); }
  assert.equal(locOf(g, u), 'base');
  const z = [zone(g, ga1), zone(g, ga2)].sort();
  assert.deepEqual(z, ['base', 'trash']);
  assert.equal([ga1, ga2].filter(x => g.objects[x].attachedTo === u).length, 1, 'the other still attached');
});

test('RJ#8754 Daughter of the Void\'s [A] floats in the pool while I conquer Hall of Legends, pay [1] to ready her, and add a second [A]: both pay for Falling Star', () => {
  let g = S0({ bfA: 'Hall of Legends' }); fundAll(g, P0, 4);
  setLegend(g, P0, 'Daughter of the Void');
  const lg = g.players[P0].legend;
  const amt = (h: GameState) => Object.values(h.players[0].pool.power).reduce((s, n) => s + (n as number), 0) + (h.players[0].poolRestricted ?? []).length;
  const use = () => { g = activate(g, P0, lg, 0); if (pend(g).kind === 'chooseMode') g = choose(g, pend(g).options![0].id); g = passAll(g); };
  use();
  assert.equal(amt(g), 1);
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_A);
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) { const d = pend(g); g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : optionIds(g)[0]) : pass(g); }
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.objects[lg].exhausted, false, 'Hall readied the legend');
  assert.equal(amt(g), 1, 'the first [A] still floats');
  use();
  assert.equal(amt(g), 2);
  const t1 = put(g, P1, 'V(3)', 'base'), t2 = put(g, P1, 'V(3)', 'base');
  const fs = hand(g, P0, 'Falling Star');
  assert.ok(canPlayNow(g, P0, fs));
  g = play(g, P0, fs, { targets: [[t1], [t2]] }); g = passAll(g);
  assert.deepEqual([zone(g, t1), zone(g, t2)], ['trash', 'trash']);
  assert.equal(amt(g), 0, 'both floating [A] spent');
});

test('RJ#8759 a Reflection token that becomes a copy of a unit has that unit\'s Energy cost (cost is a copied trait)', async () => {
  const { chars } = await import('../../src/engine/chars.ts');
  let g = withTokens(S0({ tp: P1 }));
  legend(g, P0, 'Deceiver');
  const src = put(g, P0, 'Dunebreaker', BF_A); control(g, BF_A, P0);
  g.players[P0].hand = []; g.timestamp++; hand(g, P0, 'V(1)');
  g = act(g, { type: 'endTurn', player: P1 });
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) { const d = pend(g); const o = optionIds(g); g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : o.includes(src) ? src : o[0]) : pass(g); }
  const refl = Object.keys(g.objects).filter(id => g.objects[id].isToken && ['base', 'battlefield'].includes(g.objects[id].zone) && id !== src && chars(g, id).name === 'Dunebreaker');
  assert.equal(refl.length, 1, 'Reflection copying Dunebreaker');
  assert.equal(chars(g, refl[0]).energy, g.cards[g.objects[src].cardId].energy);
});

test('RJ#8760 during my non-combat showdown at one battlefield, playing Rengar (Reaction) elsewhere is "playing a unit during a showdown": Fresh Beans may draw', () => {
  let g = S0(); fundAll(g, P0, 8);
  put(g, P0, 'Fresh Beans', 'base');
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_A);
  expectPending(g, 'showdownAction', P0);
  const r = hand(g, P0, 'sfd-025-221');
  const h0 = g.players[P0].hand.length - 1;
  assert.ok(canPlayNow(g, P0, r));
  g = play(g, P0, r, { dest: 'base' });
  let asked = false;
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) { const d = pend(g); if (d.kind === 'optional') { asked = true; g = yes(g); continue; } g = d.inStep ? choose(g, optionIds(g)[0]) : pass(g); }
  assert.ok(asked, 'Fresh Beans offered');
  assert.equal(g.players[P0].hand.length, h0 + 1);
});

test('RJ#8765 I hide a card at a battlefield and later that turn act there again: I can still see my hidden card (private to me), the opponent can\'t; it isn\'t playable this turn', () => {
  let g = S0(); fundAll(g, P0, 6);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const hc = hand(g, P0, 'HidU(2)');
  g = act(g, legal(g, P0, 'hide').find(a => a.type === 'hide' && a.obj === hc)!);
  for (let i = 0; i < 10 && g.pending && g.pending.kind !== 'mainAction'; i++) { const d = pend(g); const o = optionIds(g); g = d.inStep ? choose(g, o.includes(String(BF_A)) ? String(BF_A) : o[0]) : pass(g); }
  assert.equal(zone(g, hc), 'facedown');
  put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  const u = put(g, P0, 'V(3)', 'base');
  g = move(g, P0, [u], BF_A);
  assert.equal(getView(g, P0).state.objects[hc]?.cardId, g.objects[hc].cardId, 'controller sees it');
  assert.notEqual(getView(g, P1).state.objects[hc]?.cardId, g.objects[hc].cardId, 'opponent does not');
  assert.ok(!canPlayNow(g, P0, hc), 'not playable the turn it was hidden');
});

test('RJ#8769 Virtuoso (legend) and Time Warp: the play trigger comes after Time Warp has resolved and banished itself — nothing for Virtuoso to banish', () => {
  let g = S0(); fundAll(g, P0, 12); addRunes(g, P0, 10, 'mind');
  legend(g, P0, 'Virtuoso');
  const tw = hand(g, P0, 'Time Warp');
  g = play(g, P0, tw);
  let offered = false;
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) { const d = pend(g); if (d.kind === 'optional' && /Virtuoso|banish/i.test(d.prompt ?? '')) offered = true; g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : optionIds(g)[0]) : pass(g); }
  assert.equal(zone(g, tw), 'banishment', 'banished by its own text');
  assert.ok(!offered, 'Virtuoso has nothing to banish');
  g = nextTurn(g); assert.equal(g.activePlayer, P0, 'extra turn still taken');
});

test('RJ#8773 Ornn\'s Forge also discounts the first friendly gear I play on the opponent\'s turn (Quick-Draw Spinning Axe as a Reaction)', () => {
  const pay = (forge: boolean) => {
    let g = S0({ tp: P1, ...(forge ? { bfA: "Ornn's Forge" } : {}) }); fundAll(g, P0, 6);
    const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
    const ax = hand(g, P0, 'Spinning Axe');
    const v = put(g, P1, 'V(1)', 'base');
    g = move(g, P1, [v], BF_B);
    for (let i = 0; i < 6 && !(pend(g).player === P0 && canPlayNow(g, P0, ax)); i++) g = pass(g);
    assert.ok(canPlayNow(g, P0, ax), 'Reaction timing on the opponent\'s turn');
    const n = g.log.length;
    g = act(g, { type: 'playCard', player: P0, obj: ax });
    for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) { const d = pend(g); const o = optionIds(g); g = d.inStep ? choose(g, o.includes(u) ? u : o[0]) : pass(g); }
    return g.log.slice(n).find(l => /^P0 pays/.test(l.text))?.text ?? '';
  };
  const withF = pay(true), without = pay(false);
  assert.notEqual(withF, without, `discounted (${withF} vs ${without})`);
});

test('RJ#8774 Detonate ("Kill a gear") can\'t be played with no gear on the board', () => {
  const g = S0(); fundAll(g, P0, 6);
  const d = hand(g, P0, 'Detonate');
  assert.ok(!canPlayNow(g, P0, d));
  put(g, P1, 'Spinning Axe', 'base');
  assert.ok(canPlayNow(g, P0, d));
});

test('RJ#8778 Adaptatron kills Honest Broker in combat and conquers: the Broker\'s Deathknell Gold exists by then, so Adaptatron may kill it and gets buffed', () => {
  let g = withTokens(S0());
  const ad = put(g, P0, 'Adaptatron', 'base');
  const hb = put(g, P1, 'Honest Broker', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [ad], BF_A);
  for (let i = 0; i < 40 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g); const o = optionIds(g);
    const gold = o.find(id => g.objects[id] && g.cards[g.objects[id].cardId]?.name === 'Gold');
    g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : gold ?? o[0]) : pass(g);
  }
  assert.equal(zone(g, hb), 'trash');
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(Object.values(g.objects).filter(o => o.isToken && g.cards[o.cardId]?.name === 'Gold' && ['base', 'battlefield'].includes(o.zone)).length, 0, 'the Gold was killed');
  assert.equal(g.objects[ad].counters?.buff, 1, 'Adaptatron buffed');
});

test('RJ#8781 En Garde on my unit at The Dreaming Tree, the opponent Defies it: the Dreaming Tree trigger (already on the chain) still draws; En Garde is countered', () => {
  let g = S0({ bfA: 'The Dreaming Tree' }); fundAll(g, P0, 6); fundAll(g, P1, 6);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const eg = hand(g, P0, 'En Garde');
  const h0 = g.players[P0].hand.length - 1;
  g = play(g, P0, eg, { targets: [[u]] });
  for (let i = 0; i < 6 && !(pend(g).player === P1 && !pend(g).inStep); i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  expectPending(g, 'chainResponse', P1);
  g = play(g, P1, hand(g, P1, 'Defy'), { targets: [[eg]] });
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) { const d = pend(g); g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : optionIds(g)[0]) : pass(g); }
  assert.equal(zone(g, eg), 'trash');
  assert.equal(mightOf(g, u), 2, 'countered');
  assert.equal(g.players[P0].hand.length, h0 + 1, 'Dreaming Tree drew 1');
});

test('RJ#8782 Falling Star choosing the same Deflect 2 unit for both instructions pays Deflect twice (2 per choice)', () => {
  const pays = (enemy: string, twice: boolean) => {
    let g = S0(); fundAll(g, P0, 12);
    const e = put(g, P1, enemy, 'base'); const o = put(g, P1, 'V(9)', 'base');
    g = play(g, P0, hand(g, P0, 'Falling Star'), { targets: [[e], [twice ? e : o]] });
    return g.log.filter(l => /^P0 pays/.test(l.text)).map(l => l.text).join(' ');
  };
  const plain = pays('V(9)', true), once = pays('Deflect(9,2)', false), both = pays('Deflect(9,2)', true);
  const extra = (t: string) => t.split(' ').filter(x => x === 'A').length - plain.split(' ').filter(x => x === 'A').length;
  assert.equal(extra(once), 2, once); assert.equal(extra(both), 4, both);
});

test('RJ#8784 a unit I took with Hostile Takeover is friendly: Deathgrip can kill it and give its Might to another friendly unit', () => {
  let g = S0(); fundAll(g, P0, 12);
  const e = put(g, P1, 'V(4)', BF_A); control(g, BF_A, P1);
  const mine = put(g, P0, 'V(2)', 'base');
  g = play(g, P0, hand(g, P0, 'Hostile Takeover'), { targets: [[e]] });
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(g.objects[e].controller, P0);
  const dg = hand(g, P0, 'Deathgrip');
  g = act(g, { type: 'playCard', player: P0, obj: dg });
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) { const d = pend(g); const o = optionIds(g); g = d.inStep ? choose(g, o.includes(e) ? e : o.includes(mine) ? mine : o[0]) : pass(g); }
  assert.equal(zone(g, e), 'trash');
  assert.equal(mightOf(g, mine), 6, '2 + 4');
});

test('RJ#8785 a battlefield scored earlier this turn can be retaken, but that is not a conquer: no "When I conquer" trigger (Adaptatron), no point', () => {
  let g = S0(); fundAll(g, P0, 8);
  const a = put(g, P0, 'V(3)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(g.battlefields[BF_A].controller, P0); const pts = g.players[P0].points;
  g = play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[a]], locations: ['base'] });
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) { const d = pend(g); const o = optionIds(g); g = d.inStep ? choose(g, o.includes('base') ? 'base' : o[0]) : pass(g); }
  assert.equal(locOf(g, a), 'base');
  g.battlefields[BF_A].controller = P1; g.timestamp++;
  put(g, P1, 'V(1)', BF_A);
  put(g, P0, "Warmog's Armor", 'base');
  const ad = put(g, P0, 'Adaptatron', 'base');
  const n = g.log.length;
  g = move(g, P0, [ad], BF_A);
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) { const d = pend(g); g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : optionIds(g)[0]) : pass(g); }
  assert.equal(g.battlefields[BF_A].controller, P0, 'retaken');
  assert.equal(g.players[P0].points, pts, 'no second score');
  assert.ok(!g.log.slice(n).some(l => /Trigger: Adaptatron/.test(l.text)), 'no conquer trigger');
  assert.equal(g.objects[ad].counters?.buff ?? 0, 0);
});

// ---------------------------------------------------------------------------------------------
// cycle resuming at 8786
/** Drive decisions until main phase: optional → yes (or `opt`), in-step choices → first preferred id offered, else pass. */
function drive(g: GameState, prefer: (string | number)[] = [], opt: 'yes' | 'no' = 'yes', limit = 40): GameState {
  for (let i = 0; i < limit && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g); const o = optionIds(g);
    if (d.kind === 'optional') g = choose(g, o.includes(opt) ? opt : o[0]);
    else if (d.inStep) g = choose(g, prefer.map(String).find(x => o.includes(x)) ?? o[0]);
    else g = pass(g);
  }
  return g;
}

test('RJ#8786 Glorious Executioner (Draven legend): Ride the Wind my unit into the opponent\'s showdown at an open battlefield, I defend and win the combat → draw 1', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0);
  setLegend(g, P0, 'Glorious Executioner');
  const e = put(g, P1, 'V(2)', 'base');
  const mine = put(g, P0, 'V(3)', 'base');
  const rtw = hand(g, P0, 'Ride the Wind');
  g = move(g, P1, [e], BF_A);
  for (let i = 0; i < 4 && !(pend(g).kind === 'showdownAction' && pend(g).player === P0); i++) g = pass(g);
  expectPending(g, 'showdownAction', P0);
  const h0 = g.players[P0].hand.length - 1;
  const n = g.log.length;
  g = play(g, P0, rtw, { targets: [[mine]], locations: [BF_A] });
  g = drive(g, [BF_A]);
  assert.equal(zone(g, e), 'trash');
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.ok(g.log.slice(n).some(l => /^Trigger: Glorious Executioner/.test(l.text)), 'the legend triggers for the defender\'s win');
  assert.equal(g.players[P0].hand.length, h0 + 1);
});

test('RJ#8787 Defiant Dance -2 leaves a Recruit at 0 Might; under Imperial Decree it deals no combat damage (the enemy lives) but it dies to the damage it takes', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const rec = put(g, P1, 'Recruit', BF_A); control(g, BF_A, P1);
  const helper = put(g, P1, 'V(1)', BF_B);
  const mine = put(g, P0, 'V(2)', 'base');
  g = drive(play(g, P0, hand(g, P0, 'Imperial Decree')));
  g = drive(play(g, P0, hand(g, P0, 'Defiant Dance'), { targets: [[helper], [rec]] }));
  assert.ok(mightOf(g, rec) <= 0, 'no Might left');
  assert.equal(locOf(g, rec), BF_A, '0 Might does not kill it');
  g = drive(move(g, P0, [mine], BF_A));
  assert.equal(locOf(g, mine), BF_A, 'the 0-Might Recruit dealt no damage: no Decree kill');
  assert.equal(g.objects[mine].damage ?? 0, 0);
  assert.ok(['trash', 'gone'].includes(zone(g, rec)), 'the Recruit (token) died to the Decree');
});

test('RJ#8788 Hard Bargain paid by the opponent: I may play a second Hard Bargain on the same spell (separate payment each)', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const zap = hand(g, P0, 'Hextech Ray');
  g = pass(act(g, { type: 'playCard', player: P0, obj: zap }));
  const hb1 = hand(g, P1, 'Hard Bargain'), hb2 = hand(g, P1, 'Hard Bargain');
  const playHB = (h: GameState, hb: ObjId) => {
    h = act(h, { type: 'playCard', player: P1, obj: hb });
    for (let i = 0; i < 4 && pend(h).inStep; i++) h = pend(h).kind === 'optional' ? no(h) : choose(h, optionIds(h).includes(zap) ? zap : optionIds(h)[0]);
    return h;
  };
  g = playHB(g, hb1);
  assert.equal(g.chain.length, 2);
  // resolve the first Hard Bargain: P0 pays [2]
  for (let i = 0; i < 6 && !pend(g).inStep; i++) g = pass(g);
  assert.equal(pend(g).player, P0, 'P0 is asked to pay');
  g = pend(g).kind === 'optional' ? yes(g) : choose(g, optionIds(g).find(x => /yes|pay/i.test(x)) ?? optionIds(g)[0]);
  assert.equal(zone(g, zap), 'chain', 'paid: the spell survives the first Hard Bargain');
  assert.equal(g.chain.length, 1);
  if (pend(g).player !== P1) g = pass(g);
  assert.equal(pend(g).player, P1);
  assert.ok(canPlayNow(g, P1, hb2), 'a second Hard Bargain may target the same spell');
  g = playHB(g, hb2);
  assert.equal(g.chain.length, 2);
  for (let i = 0; i < 6 && !pend(g).inStep; i++) g = pass(g);
  assert.equal(pend(g).player, P0, 'a separate payment is asked for');
  void e;
});

test('RJ#8789 Grandmaster at Arms: Brutalizer attached on an earlier turn, re-attached to the same unit → no +2 (correction); moved to another unit → +1 and +2', () => {
  let g = S0(); fundAll(g, P0);
  legend(g, P0, 'Grandmaster at Arms');
  const u = put(g, P0, 'V(2)', 'base'), w = put(g, P0, 'V(2)', 'base');
  const b = put(g, P0, 'Brutalizer', 'base');
  g = drive(act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === b)!), [u]);
  assert.equal(g.objects[b].attachedTo, u);
  g = drive(nextTurn(g)); g = drive(nextTurn(g)); fundAll(g, P0);
  assert.equal(g.activePlayer, P0);
  assert.equal(mightOf(g, u), 3, 'an earlier turn: only +1');
  const leg = g.players[P0].legend;
  const mvs = legal(g, P0, 'activate').filter(a => a.type === 'activate' && a.obj === leg);
  assert.ok(mvs.length > 0);
  let same: GameState | null = null, other: GameState | null = null;
  for (const mv of mvs) {
    for (const tgt of [u, w]) {
      try {
        const h = drive(act(g, mv), [b, tgt]);
        if (h.objects[b].attachedTo !== tgt || h === g) continue;
        if (tgt === u && !same) same = h;
        if (tgt === w && !other) other = h;
      } catch { /* not this ability */ }
    }
  }
  assert.ok(other, 'it can be moved to another unit');
  assert.equal(mightOf(other!, w), 5, 'new unit: +1 and +2 (attached this turn)');
  assert.equal(mightOf(other!, u), 2);
  assert.ok(same, 'the same unit may be chosen');
  assert.equal(mightOf(same!, u), 3, 're-attached to the same unit: no +2');
});

test('RJ#8791 Battle Mistress (Sivir legend) readies when an enemy unit dies on the opponent\'s turn', () => {
  let g = S0({ tp: P1 });
  const leg = setLegend(g, P0, 'Battle Mistress');
  g.objects[leg].exhausted = true; g.timestamp++;
  put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(1)', 'base');
  g = drive(move(g, P1, [e], BF_A));
  assert.equal(zone(g, e), 'trash');
  assert.equal(g.objects[leg].exhausted, false, 'readied on the opponent\'s turn');
});

test('RJ#8794 playing Undertitan from hand is not revealing it: no [Add] [2]', () => {
  let g = S0(); fundAll(g, P0, 12);
  const ut = hand(g, P0, 'Undertitan');
  const n = g.log.length;
  g = drive(act(g, { type: 'playCard', player: P0, obj: ut }), ['base']);
  assert.equal(zone(g, ut), 'base');
  assert.ok(!g.log.slice(n).some(l => /revealed/i.test(l.text) && /Undertitan/.test(l.text)), 'no reveal');
  assert.equal(g.players[P0].pool?.energy ?? 0, 0, 'no Energy added');
});

test('RJ#8796 Emperor\'s Divide chooses its units: The Dreaming Tree draws for the friendly unit chosen there', () => {
  let g = S0({ bfA: 'The Dreaming Tree' }); fundAll(g, P0, 6);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const h0 = g.players[P0].hand.length;
  g = drive(play(g, P0, hand(g, P0, "Emperor's Divide"), { targets: [[u]] }), [u]);
  assert.equal(locOf(g, u), 'base');
  assert.equal(g.players[P0].hand.length, h0 + 1, 'Dreaming Tree: a friendly unit there was chosen with a spell');
});

test('RJ#8798 Overzealous Fan moves my attacker to base: the combat showdown goes on and I may Ride the Wind it back', () => {
  let g = S0(); fundAll(g, P0);
  const a = put(g, P0, 'V(3)', 'base');
  const fan = put(g, P1, 'Overzealous Fan', BF_A); control(g, BF_A, P1);
  const d = put(g, P1, 'V(1)', BF_A);
  const rtw = hand(g, P0, 'Ride the Wind');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 20 && !(locOf(g, a) === 'base' && g.chain.length === 0 && pend(g).kind === 'showdownAction' && pend(g).player === P0); i++) {
    const p = pend(g);
    if (p.kind === 'optional') g = yes(g);
    else if (p.inStep) g = choose(g, optionIds(g).includes(a) ? a : optionIds(g)[0]);
    else g = pass(g);
  }
  assert.equal(zone(g, fan), 'trash');
  assert.equal(locOf(g, a), 'base');
  expectPending(g, 'showdownAction', P0);
  assert.ok(canPlayNow(g, P0, rtw), 'the showdown is still on');
  g = drive(play(g, P0, rtw, { targets: [[a]], locations: [BF_A] }), [BF_A]);
  assert.equal(zone(g, d), 'trash', 'back in the combat: it kills the defender');
  assert.equal(g.battlefields[BF_A].controller, P0);
});

test('RJ#8799 (MISMATCH-RJ, principle 11) two Draven, Vanquisher in a combat: each decides/pays as its trigger goes on the chain — the attacker\'s first; the defender\'s (on top) resolves first', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const dd = put(g, P1, 'sfd-020-221', BF_A); control(g, BF_A, P1);
  const da = put(g, P0, 'sfd-020-221', 'base');
  g = move(g, P0, [da], BF_A);
  const askers: PlayerId[] = [];
  for (let i = 0; i < 16 && askers.length < 2; i++) {
    const d = pend(g);
    if (d.kind === 'optional' && /pay/i.test(d.prompt ?? '')) {
      askers.push(d.player);
      g = choose(g, 'yes');
      for (let j = 0; j < 4 && pend(g).inStep && pend(g).kind !== 'optional'; j++) g = act(g, legal(g, pend(g).player)[0]);
      continue;
    }
    g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  assert.deepEqual(askers, [P0, P1], 'attacker decides first, at finalization');
  assert.equal(g.chain.length, 2, 'both paid while on the chain, neither resolved');
  assert.equal(g.chain[g.chain.length - 1].source, dd, 'the defender\'s trigger is on top');
  assert.equal(mightOf(g, dd), 4); assert.equal(mightOf(g, da), 4);
});

test('RJ#8802 Malzahar may kill an exhausted Gold to pay his ability\'s cost', () => {
  let g = withTokens(S0());
  const m = put(g, P0, 'Malzahar', 'base');
  const gold = put(g, P0, 'Gold', 'base', { token: true, ready: false });
  assert.equal(g.objects[gold].exhausted, true);
  const ac = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === m);
  assert.ok(ac);
  g = act(g, ac!);
  let offered = false;
  for (let i = 0; i < 4 && g.pending?.inStep; i++) { if (optionIds(g).includes(gold)) { offered = true; g = choose(g, gold); } else g = act(g, legal(g, P0)[0]); }
  assert.ok(offered, 'the exhausted Gold is a choice for the kill cost');
  assert.notEqual(zone(g, gold), 'base');
  assert.equal(zone(g, m), 'base');
  assert.equal(g.objects[m].exhausted, true);
});

test('RJ#8807 Beast Below returns my Yordle Explorer: Explorer\'s draw (Power cost [A][A] played) still resolves', () => {
  let g = S0(); fundAll(g, P0, 12);
  const ye = put(g, P0, 'Yordle Explorer', 'base');
  const e = put(g, P1, 'V(2)', 'base');
  const bb = hand(g, P0, 'Beast Below');
  const h0 = g.players[P0].hand.length - 1;
  const n = g.log.length;
  g = drive(act(g, { type: 'playCard', player: P0, obj: bb }), [ye, e, 'base']);
  assert.equal(zone(g, bb), 'base');
  assert.equal(zone(g, ye), 'hand');
  assert.equal(zone(g, e), 'hand');
  assert.ok(g.log.slice(n).some(l => /^Trigger: Yordle Explorer/.test(l.text)), 'Explorer triggered');
  assert.equal(g.players[P0].hand.length, h0 + 1 + 1, 'Explorer back in hand + 1 card drawn');
});

test('RJ#8808 Hostile Takeover an enemy unit, then Hidden Blade it: I am its controller, so I draw 2', () => {
  let g = S0(); fundAll(g, P0, 12);
  const e = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
  g = drive(play(g, P0, hand(g, P0, 'Hostile Takeover'), { targets: [[e]] }), [e]);
  assert.equal(g.objects[e].controller, P0);
  const hb = hand(g, P0, 'Hidden Blade');
  const h0 = g.players[P0].hand.length - 1, h1 = g.players[P1].hand.length;
  g = drive(play(g, P0, hb, { targets: [[e]] }), [e]);
  assert.equal(zone(g, e), 'trash');
  assert.equal(g.players[P0].hand.length, h0 + 2, 'I draw 2');
  assert.equal(g.players[P1].hand.length, h1, 'the owner draws nothing');
});

test('RJ#8812 Yordle Explorer checks the printed Power cost: Called Shot ([A]) with its Repeat [C] paid does not trigger it', () => {
  let g = S0(); fundAll(g, P0, 12);
  put(g, P0, 'Yordle Explorer', 'base');
  for (let i = 0; i < 6; i++) put(g, P0, 'V(1)', 'deckTop');
  const cs = hand(g, P0, 'Called Shot');
  const n = g.log.length;
  g = act(g, { type: 'playCard', player: P0, obj: cs });
  let repeat = false;
  for (let i = 0; i < 4 && pend(g).inStep; i++) { if (pend(g).kind === 'optional' && /Repeat/i.test(pend(g).prompt ?? '')) { repeat = true; g = yes(g); } else g = act(g, legal(g, P0)[0]); }
  assert.ok(repeat, 'Repeat paid');
  g = drive(g);
  assert.ok(!g.log.slice(n).some(l => /^Trigger: Yordle Explorer/.test(l.text)), 'no Explorer trigger');
});

test('RJ#8814 Carnivorous Snapvine\'s play trigger is mandatory: with an enemy unit at a battlefield it must be chosen', () => {
  let g = S0(); fundAll(g, P0, 12);
  const e = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const sv = hand(g, P0, 'Carnivorous Snapvine');
  g = act(g, { type: 'playCard', player: P0, obj: sv });
  let declinable = false;
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g); const o = optionIds(g);
    if (d.kind === 'optional' && /Snapvine/i.test(d.prompt ?? '')) declinable = true;
    if (d.inStep && o.includes(e) && (d.min ?? 1) === 0) declinable = true;
    g = d.kind === 'optional' ? no(g) : d.inStep ? choose(g, o.includes(e) ? e : o.includes('base') ? 'base' : o[0]) : pass(g);
  }
  assert.equal(declinable, false, 'no way to decline');
  assert.equal(zone(g, e), 'trash', 'the fight happened');
});

test('RJ#8815 Minotaur Reckoner doesn\'t stop Reaver\'s Row from triggering; the move to base just doesn\'t happen', () => {
  let g = S0({ bfA: "Reaver's Row", tp: P1 });
  const mine = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  put(g, P0, 'Minotaur Reckoner', 'base');
  const e = put(g, P1, 'V(4)', 'base');
  const n = g.log.length;
  g = move(g, P1, [e], BF_A);
  let onChain = false;
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    if (chainLabels(g).some(l => /Reaver/.test(l))) { onChain = true; assert.equal(locOf(g, mine), BF_A); }
    const d = pend(g); const o = optionIds(g);
    g = d.kind === 'optional' ? (d.player === P0 ? yes(g) : choose(g, o[0])) : d.inStep ? choose(g, o.includes(mine) ? mine : o[0]) : pass(g);
  }
  assert.ok(onChain || g.log.slice(n).some(l => /Reaver/.test(l.text)), 'the trigger happened');
  assert.ok(onChain, 'it went on the chain');
  assert.notEqual(locOf(g, mine), 'base', 'not moved to base');
});

test('RJ#8818 Thwonk! can\'t be played on a unit that moved to an empty battlefield (non-combat showdown: no attacking unit)', () => {
  let g = S0(); fundAll(g, P1, 8);
  const a = put(g, P0, 'V(2)', 'base');
  const th = hand(g, P1, 'Thwonk!');
  g = move(g, P0, [a], BF_A);
  let sawP1 = false;
  for (let i = 0; i < 6 && g.pending && g.pending.kind === 'showdownAction'; i++) {
    if (pend(g).player === P1) { sawP1 = true; assert.ok(!canPlayNow(g, P1, th), 'no attacking unit to stun'); }
    g = pass(g);
  }
  assert.ok(sawP1, 'P1 had focus in the showdown');
});

test('RJ#8826 Draven, Audacious conquers an empty battlefield (6 → 7), then I Charm an enemy unit there and he wins the combat: his point is not a conquer/hold point → 8, win', () => {
  let g = S0(); fundAll(g, P0, 8);
  g.players[P0].points = 6;
  const dv = put(g, P0, 'sfd-148-221', 'base');
  const e = put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  g = drive(move(g, P0, [dv], BF_A));
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[P0].points, 7, 'conquered the empty battlefield');
  g = drive(play(g, P0, hand(g, P0, 'Charm'), { targets: [[e]], locations: [BF_A] }), [BF_A]);
  assert.equal(zone(g, e), 'trash', 'Draven won the combat');
  assert.ok(g.players[P0].points >= 8, `points ${g.players[P0].points}`);
  assert.equal(g.winner, P0);
});

test('RJ#8831 Vanguard Armory\'s Recruits are "played" friendly units: Rally the Troops buffs each of them', () => {
  let g = withTokens(S0()); fundAll(g, P0, 12);
  const va = put(g, P0, 'Vanguard Armory', 'base');
  g = drive(play(g, P0, hand(g, P0, 'Rally the Troops')));
  const before = new Set(Object.keys(g.objects));
  g = drive(act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === va)!), ['base']);
  const recs = Object.keys(g.objects).filter(id => !before.has(id) && g.cards[g.objects[id].cardId]?.name === 'Recruit' && zone(g, id) !== 'gone');
  assert.equal(recs.length, 3);
  for (const r of recs) assert.equal(g.objects[r].counters?.buff ?? 0, 1, 'buffed');
});

test('RJ#8832 (MISMATCH-RJ partial) hidden Edge of Night: not playable the turn it was hidden, but on a later turn it can be played from face down in response to the opponent\'s spell (Reaction timing)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const fresh = put(g, P0, 'Edge of Night', { facedown: BF_A, hiddenTurn: g.turn });
  const en = put(g, P0, 'Edge of Night', { facedown: BF_A });
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'DrawR') });
  if (pend(g).player !== P0) g = pass(g);
  expectPending(g, 'chainResponse', P0);
  assert.ok(!canPlayNow(g, P0, fresh), 'hidden this turn: not yet');
  assert.ok(canPlayNow(g, P0, en), 'hidden on an earlier turn: playable in response');
  g = act(g, { type: 'playCard', player: P0, obj: en } as never);
  g = drive(g, [u]);
  assert.equal(g.objects[en].attachedTo, u);
});

test('RJ#8833 Defy can\'t counter First Mate: the unit is not a spell on the chain, and its play trigger is an ability', () => {
  let g = S0(); fundAll(g, P0, 6); fundAll(g, P1, 6);
  put(g, P0, 'V(2)', 'base', { ready: false });
  const df = hand(g, P1, 'Defy');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'First Mate') });
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = choose(g, optionIds(g).includes('base') ? 'base' : optionIds(g)[0]);
  assert.ok(g.chain.length >= 1, 'First Mate\'s play trigger on the chain');
  assert.ok(g.chain.every(c => c.kind !== 'spell'), 'no spell on the chain');
  if (pend(g).player !== P1) g = pass(g);
  assert.equal(pend(g).player, P1);
  assert.ok(!canPlayNow(g, P1, df), 'nothing for Defy to counter');
});

test('RJ#8834 at 5 points, hold two battlefields (7), then Power Nexus\'s paid point → 8: win (not a conquer/hold point)', () => {
  let g = S0({ tp: P1, bfA: 'Power Nexus' });
  put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  put(g, P0, 'V(2)', BF_B); control(g, BF_B, P0);
  setRunes(g, P0, 8, 'fury');
  g.players[P0].points = 5;
  g = act(g, { type: 'endTurn', player: P1 });
  for (let i = 0; i < 30 && g.phase !== 'gameOver'; i++) {
    const d = g.pending!;
    if (!d || (d.kind === 'mainAction' && d.player === P0)) break;
    g = d.kind === 'optional' ? yes(g) : d.inStep ? choose(g, d.options![0].id) : pass(g);
  }
  assert.equal(g.players[P0].points, 8);
  assert.equal(g.winner, P0);
});

test('RJ#8835 Challenge is not a combat: Draven, Audacious killing an enemy with it scores no point', () => {
  let g = S0(); fundAll(g, P0, 6);
  const dv = put(g, P0, 'sfd-148-221', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  const pts = g.players[P0].points;
  g = drive(play(g, P0, hand(g, P0, 'Challenge'), { targets: [[dv], [e]] }), [dv, e]);
  assert.equal(zone(g, e), 'trash');
  assert.equal(g.players[P0].points, pts, 'no "win a combat" point');
});

test('RJ#8836 (MISMATCH-RJ, CR 812.1.b.1) Void Rush plays a revealed Trifarian Gloryseeker: Void Rush was played this turn, so Legion is active and it buffs itself', () => {
  let g = S0(); fundAll(g, P0, 8);
  const tg = put(g, P0, 'Trifarian Gloryseeker', 'deckTop');
  put(g, P0, 'V(1)', 'deckTop');
  g = drive(play(g, P0, hand(g, P0, 'Void Rush')), [tg, 'base']);
  assert.equal(zone(g, tg), 'base', 'played');
  assert.equal(g.objects[tg].counters?.buff ?? 0, 1, 'Legion: buffed');
});

test('RJ#8838 my lone defender Arcane Shifted in the combat showdown is replayed to the same battlefield: I keep control, it is a new object and defends (Draven, Vanquisher\'s defend trigger fires again)', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1, 12);
  const a = put(g, P0, 'V(6)', 'base');
  const dv = put(g, P1, 'sfd-020-221', BF_A); control(g, BF_A, P1);
  const as = hand(g, P1, 'Arcane Shift');
  g = move(g, P0, [a], BF_A);
  let defendAsks = 0;
  const step = (h: GameState) => {
    const d = pend(h);
    if (d.kind === 'optional') { if (d.player === P1 && /pay/i.test(d.prompt ?? '')) defendAsks++; return no(h); }
    return d.inStep ? choose(h, optionIds(h).includes(dv) ? dv : optionIds(h).includes(a) ? a : optionIds(h).includes(String(BF_A)) ? String(BF_A) : optionIds(h)[0]) : pass(h);
  };
  for (let i = 0; i < 20 && !(g.chain.length === 0 && pend(g).kind === 'showdownAction' && pend(g).player === P1); i++) g = step(g);
  expectPending(g, 'showdownAction', P1);
  assert.equal(defendAsks, 1);
  g = act(g, { type: 'playCard', player: P1, obj: as });
  for (let i = 0; i < 6 && pend(g).inStep; i++) g = step(g);
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction' && !(g.chain.length === 0 && pend(g).kind === 'showdownAction'); i++) {
    if (g.chain.length === 0 && pend(g).kind === 'showdownAction') break;
    g = step(g);
  }
  const replayed = Object.keys(g.objects).find(id => g.objects[id].cardId === g.objects[dv].cardId && locOf(g, id) === BF_A);
  assert.ok(replayed, 'replayed to the same battlefield');
  assert.equal(g.battlefields[BF_A].controller, P1, 'control kept');
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) g = step(g);
  assert.equal(defendAsks, 2, 'the new object\'s "When I defend" triggered');
});

test('RJ#8837 a champion unit may be in the sideboard; copy limits count the main deck and sideboard together', () => {
  const d = legalDeck();
  d.sideboard = ['cf-champ', 'cf-champ2'];
  assert.deepEqual(validateDeck(d, fixtureDb(), { battlefields: 3 }), [], 'champion units in the sideboard are legal');
  const d4 = legalDeck();
  d4.main = d4.main.slice(0, 37).concat(['cf-champ2', 'cf-champ2', 'cf-champ2']);
  d4.sideboard = ['cf-champ2'];
  assert.deepEqual(validateDeck(d4, fixtureDb(), { battlefields: 3 }).map(p => p.code), ['copies'], '3 in the main deck + 1 in the sideboard = 4 copies: illegal');
});

test('RJ#8843 Salvage kills a Svellsongur attached to Ornn (Deflect 2) without paying Deflect: the gear is chosen, not the unit', () => {
  let g = S0(); setRunes(g, P0, 2, 'order');
  const orn = put(g, P1, 'sfd-085-221', 'base');
  const sv = put(g, P1, 'Svellsongur', 'base'); attachNow(g, sv, orn);
  assert.ok(kwv(g, orn, 'Deflect') >= 2);
  const sal = hand(g, P0, 'Salvage');
  assert.ok(canPlayNow(g, P0, sal));
  g = act(g, { type: 'playCard', player: P0, obj: sal });
  g = drive(g, [sv]);
  assert.equal(zone(g, sv), 'trash', 'killed with only Salvage\'s own cost paid');
  assert.equal(zone(g, orn), 'base');
});

test('RJ#8848 (MISMATCH-RJ, principle 1) Imperial Decree in combat: the Decree kills (from combat damage) resolve before the combat result — both units die, the Draven-legend defender wins nothing and draws nothing', () => {
  let g = S0(); fundAll(g, P0, 6);
  setLegend(g, P1, 'Glorious Executioner');
  const d = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(2)', 'base');
  g = drive(play(g, P0, hand(g, P0, 'Imperial Decree')));
  const h1 = g.players[P1].hand.length;
  const n = g.log.length;
  g = drive(move(g, P0, [a], BF_A));
  assert.equal(zone(g, a), 'trash');
  assert.equal(zone(g, d), 'trash', 'the Decree killed the damaged defender before the result');
  assert.ok(!g.log.slice(n).some(l => /^Trigger: Glorious Executioner/.test(l.text)), 'no combat win');
  assert.equal(g.players[P1].hand.length, h1);
});

test('RJ#8849 Xin Zhao counts token units: with a Recruit token and one other unit in base he enters ready', () => {
  let g = withTokens(S0()); fundAll(g, P0, 8);
  put(g, P0, 'Recruit', 'base', { token: true });
  put(g, P0, 'V(1)', 'base');
  const xz = hand(g, P0, 'Xin Zhao');
  g = drive(act(g, { type: 'playCard', player: P0, obj: xz }), ['base']);
  assert.equal(zone(g, xz), 'base');
  assert.equal(g.objects[xz].exhausted, false, 'entered ready');
});

test('RJ#8851 two Akshans take the same gear in turn: when the second (the opponent\'s) dies, the gear returns to me (my Akshan\'s effect still applies)', () => {
  let g = S0(); fundAll(g, P0, 8);
  const sd = put(g, P1, 'Sun Disc', 'base');
  const ak0 = hand(g, P0, 'Akshan, Mischievous');
  g = drive(act(g, { type: 'playCard', player: P0, obj: ak0, destination: 'base' } as never), [sd]);
  assert.equal(g.objects[sd].controller, P0, 'I took it');
  g = drive(nextTurn(g)); fundAll(g, P1, 8);
  const ak1 = hand(g, P1, 'Akshan, Mischievous');
  g = drive(act(g, { type: 'playCard', player: P1, obj: ak1, destination: 'base' } as never), [sd]);
  assert.equal(g.objects[sd].controller, P1, 'the opponent took it from me');
  g = drive(nextTurn(g)); fundAll(g, P0, 8);
  g = drive(play(g, P0, hand(g, P0, 'KillDraw'), { targets: [[ak1]] }), [ak1]);
  assert.equal(zone(g, ak1), 'trash');
  assert.equal(zone(g, ak0), 'base');
  assert.equal(g.objects[sd].controller, P0, 'back to me');
});

test('RJ#8853 Unchecked Power doesn\'t choose: no Deflect to pay for enemy Deflect units', () => {
  let g = S0(); setRunes(g, P0, 7, 'mind');
  const orn = put(g, P1, 'sfd-085-221', BF_A); control(g, BF_A, P1);
  const up = hand(g, P0, 'Unchecked Power');
  assert.ok(canPlayNow(g, P0, up), 'payable with exactly [7][A][A] (no Deflect)');
  g = drive(play(g, P0, up));
  assert.equal(zone(g, orn), 'trash');
});

test('RJ#8854 Ezreal, Dashing with Svellsongur attacks: two "When I attack" triggers, each may choose a different enemy unit', () => {
  let g = S0(); fundAll(g, P0, 6);
  const ez = put(g, P0, 'sfd-082-221', 'base');
  const sv = put(g, P0, 'Svellsongur', 'base'); attachNow(g, sv, ez);
  const e1 = put(g, P1, 'V(9)', BF_A), e2 = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const m = mightOf(g, ez);
  g = move(g, P0, [ez], BF_A);
  const picks: ObjId[] = [];
  let dmg: number[] | null = null;
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g); const o = optionIds(g);
    if (picks.length === 2 && g.chain.length === 0 && !dmg) dmg = [g.objects[e1].damage ?? 0, g.objects[e2].damage ?? 0];
    if (d.inStep && o.includes(e1) && o.includes(e2)) { const t = picks.includes(e1) ? e2 : e1; picks.push(t); g = choose(g, t); continue; }
    g = d.kind === 'optional' ? no(g) : d.inStep ? choose(g, o[0]) : pass(g);
  }
  assert.deepEqual(picks.sort(), [e1, e2].sort(), 'two triggers, two different targets');
  assert.deepEqual(dmg, [m, m], 'each took damage equal to his Might');
  void m;
});

test('RJ#8869 Altar of Memories triggers when a friendly token unit dies', () => {
  let g = withTokens(S0({ tp: P1 })); fundAll(g, P1);
  const alt = put(g, P0, 'Altar of Memories', 'base');
  const r = put(g, P0, 'Recruit', BF_A, { token: true }); control(g, BF_A, P0);
  g = play(g, P1, hand(g, P1, 'KillA'), { targets: [[r]] });
  let asked = false;
  for (let i = 0; i < 16 && g.pending && (g.chain.length || g.pending.inStep); i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    if (d.kind === 'optional') { if (d.player === P0 && /Altar/i.test(d.prompt ?? '')) asked = true; g = yes(g); continue; }
    g = act(g, legal(g, d.player)[0]);
  }
  assert.ok(['trash', 'gone'].includes(zone(g, r)), 'the token died');
  assert.ok(asked, 'Altar offered for the token');
  assert.equal(g.objects[alt].exhausted, true);
});

test('RJ#8873 Tryndamere, Barbarian\'s point can be the final point: at 7, conquering one battlefield (the other not scored) with 5+ excess → the conquer point is a draw, his point wins', () => {
  let g = S0(); g.players[P0].points = 7;
  const t = put(g, P0, 'ogn-034-298', 'base');
  const d = put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  g = drive(move(g, P0, [t], BF_A), [d]);
  assert.equal(zone(g, d), 'trash');
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[P0].points, 8);
  assert.equal(g.winner, P0);
});

test('RJ#8874 Vex (sfd-146) sent to base by Overzealous Fan: while the Fan\'s trigger is on the chain only Reactions can be played (discounted, she is still in combat); after it resolves no discount', () => {
  let g = S0(); fundAll(g, P0, 12);
  const vx = put(g, P0, 'sfd-146-221', 'base');
  const fan = put(g, P1, 'Overzealous Fan', BF_A); control(g, BF_A, P1);
  put(g, P1, 'V(1)', BF_A);
  const zr = hand(g, P0, 'Discipline'), za = hand(g, P0, 'ZapA');
  const base = playCostOf(g, P0, zr)!.energy;
  assert.equal(base, 2);
  g = move(g, P0, [vx], BF_A);
  let checked = false;
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!checked && !d.inStep && d.player === P0 && g.chain.some(c => c.source === fan)) {
      checked = true;
      assert.equal(locOf(g, vx), BF_A);
      assert.ok(!canPlayNow(g, P0, za), 'no Action while the chain exists');
      assert.equal(playCostOf(g, P0, zr)!.energy, 1, 'a Reaction (Discipline) is discounted while she is in combat');
    }
    g = d.kind === 'optional' ? yes(g) : d.inStep ? choose(g, optionIds(g).includes(vx) ? vx : optionIds(g)[0]) : pass(g);
    if (checked && locOf(g, vx) === 'base' && g.chain.length === 0) break;
  }
  assert.ok(checked);
  assert.equal(locOf(g, vx), 'base');
  assert.equal(playCostOf(g, P0, zr)?.energy ?? base, base, 'back in base: no discount');
});

test('RJ#8876 Reaver\'s Row chooses Irelia, Fervent: both her +1 and Blade Dancer (legend, "When you choose a friendly unit") trigger above the Row\'s ability', () => {
  const g0 = S0({ bfA: "Reaver's Row" }); fundAll(g0, P1);
  setLegend(g0, P1, 'Blade Dancer');
  const ir = put(g0, P1, 'Irelia, Fervent', BF_A); control(g0, BF_A, P1);
  const a = put(g0, P0, 'V(3)', 'base');
  let g = move(g0, P0, [a], BF_A);
  expectPending(g, 'chooseTargets', P1);
  g = choose(g, ir);
  let ordered = false;
  for (let i = 0; i < 6 && pend(g).inStep && pend(g).player === P1; i++) {
    if (pend(g).kind === 'orderTriggers') ordered = true;
    g = pend(g).kind === 'optional' ? yes(g) : choose(g, optionIds(g)[0]);
  }
  const labels = chainLabels(g);
  const row = labels.findIndex(l => !/Irelia|Blade Dancer/.test(l));
  const ire = labels.findIndex(l => /Irelia/.test(l)), bd = labels.findIndex(l => /Blade Dancer/.test(l));
  assert.ok(ire >= 0 && bd >= 0, `both triggered: ${labels}`);
  assert.ok(row >= 0 && row < ire && row < bd, `both above the Row's ability: ${labels}`);
  void ordered;
});

test('RJ#8880 Yasuo, Windrider: a standard move back to base counts toward his three moves', () => {
  let g = S0(); fundAll(g, P0, 20);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const y = put(g, P0, 'Yasuo, Windrider', 'base');
  const p0 = g.players[0].points;
  const rtw = (to: number | 'base') => {
    g = play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[y]], locations: [to] });
    for (let i = 0; i < 10 && g.pending && g.pending.kind !== 'mainAction'; i++) { const d = pend(g); g = d.kind === 'chooseDestination' ? choose(g, String(to)) : d.inStep ? choose(g, optionIds(g)[0]) : pass(g); }
  };
  rtw(BF_A); assert.equal(locOf(g, y), BF_A);            // move 1 (readied by Ride the Wind)
  g = drive(move(g, P0, [y], 'base')); assert.equal(locOf(g, y), 'base');   // move 2: standard move to base
  assert.equal(g.players[0].points - p0, 0);
  rtw(BF_A); assert.equal(locOf(g, y), BF_A);            // move 3
  assert.equal(g.players[0].points - p0, 1, 'the base move counted');
});

test('RJ#8884 a chosen champion in the Champion Zone can\'t activate its ability (Vi, Destructive); once played it can', () => {
  let g = S0(); fundAll(g, P0, 8);
  const ch = g.players[P0].championZone[0];
  const c = cid('Vi, Destructive');
  if (!g.cards[c]) g.cards = { ...g.cards, [c]: realCard(c) };
  g.objects[ch].cardId = c; g.ex.dirty = true; g.timestamp++;
  for (let i = 0; i < 3; i++) put(g, P0, 'V(1)', 'trash');
  assert.equal(legal(g, P0, 'activate').filter(a => a.type === 'activate' && a.obj === ch).length, 0, 'not from the Champion Zone');
  g = drive(play(g, P0, ch, { dest: 'base' }), ['base']);
  assert.equal(zone(g, ch), 'base');
  assert.ok(legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === ch), 'on the board: yes');
});

test('RJ#8886 En Garde on my lone attacker at the opponent\'s battlefield: it is the only unit I control there → +2', () => {
  let g = S0(); fundAll(g, P0, 6);
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 6 && !(pend(g).kind === 'showdownAction' && pend(g).player === P0 && g.chain.length === 0); i++) g = pass(g);
  g = play(g, P0, hand(g, P0, 'En Garde'), { targets: [[a]] });
  for (let i = 0; i < 6 && g.chain.length; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(mightOf(g, a), 4, '+1 and the extra +1');
});

test('RJ#8889 a unit with both Guardian Angel and Zhonya\'s Hourglass available: its controller chooses which replacement applies', () => {
  const run = (pick: 'z' | 'ga') => {
    let g = S0({ tp: P1 }); fundAll(g, P1);
    const z = put(g, P0, "Zhonya's Hourglass", 'base');
    const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
    const ga = put(g, P0, 'Guardian Angel', BF_A); attachNow(g, ga, u);
    g = play(g, P1, hand(g, P1, 'KillA'), { targets: [[u]] });
    let offered: string[] = [];
    for (let i = 0; i < 20 && g.pending && (g.chain.length || g.pending.inStep); i++) {
      const d = pend(g);
      if (!d.inStep) { g = pass(g); continue; }
      const opts = d.options ?? [];
      const oz = opts.find(o => o.id === z || /Zhonya/.test(o.label ?? '')), og = opts.find(o => o.id === ga || /Guardian Angel/.test(o.label ?? ''));
      if (d.player === P0 && oz && og) { offered = [oz.id, og.id]; g = choose(g, pick === 'z' ? oz.id : og.id); continue; }
      g = d.kind === 'optional' ? yes(g) : choose(g, opts[0].id);
    }
    return { g, z, ga, u, offered };
  };
  const a = run('z');
  assert.equal(a.offered.length, 2, 'P0 is asked which replacement to apply');
  assert.equal(zone(a.g, a.z), 'trash'); assert.equal(zone(a.g, a.ga), 'base'); assert.equal(a.g.objects[a.ga].attachedTo, a.u);
  const b = run('ga');
  assert.equal(zone(b.g, b.ga), 'trash'); assert.equal(zone(b.g, b.z), 'base');
  assert.equal(locOf(b.g, b.u), 'base');
});

test('RJ#8895 Lecturing Yordle Gusted in response to its play trigger: the draw still resolves', () => {
  let g = S0(); fundAll(g, P0, 6); fundAll(g, P1, 6);
  for (let i = 0; i < 3; i++) put(g, P0, 'V(1)', 'deckTop');
  const card = hand(g, P0, 'Lecturing Yordle');
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  g = act(g, { type: 'playCard', player: P0, obj: card, destination: BF_A } as never);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = choose(g, optionIds(g).includes(String(BF_A)) ? String(BF_A) : optionIds(g)[0]);
  assert.ok(g.chain.some(c => c.source === card), 'play trigger on the chain');
  if (pend(g).player !== P1) g = pass(g);
  const h0 = g.players[P0].hand.length;
  g = play(g, P1, hand(g, P1, 'Gust'), { targets: [[card]] });
  for (let i = 0; i < 10 && g.chain.length; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(zone(g, card), 'hand', 'returned');
  assert.equal(g.players[P0].hand.length, h0 + 2, 'Yordle back + 1 drawn');
});

test('RJ#8898 Aphelios, Exalted may buff himself with the "Buff a friendly unit" mode', () => {
  let g = S0(); fundAll(g, P0, 4);
  const ap = put(g, P0, 'Aphelios, Exalted', 'base');
  const ls = put(g, P0, 'Long Sword', 'base');
  const other = put(g, P0, 'V(1)', 'base');
  g = act(g, legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === ls)!);
  let offeredSelf = false;
  for (let i = 0; i < 16 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g); const o = optionIds(g);
    if (d.kind === 'chooseMode') { g = choose(g, d.options!.find(x => /^Buff/i.test(x.label ?? ''))!.id); continue; }
    if (d.inStep && o.includes(ap)) { offeredSelf = true; g = choose(g, ap); continue; }
    g = d.inStep ? choose(g, o[0]) : pass(g);
  }
  assert.equal(g.objects[ls].attachedTo, ap);
  assert.ok(offeredSelf);
  assert.equal(g.objects[ap].counters?.buff ?? 0, 1, 'buffed himself');
  assert.equal(g.objects[other].counters?.buff ?? 0, 0);
});

test('RJ#8903 Ezreal, Dashing attacks Reaver\'s Row: the defender\'s Row trigger is on top and resolves first; the unit it moves to base is no longer "here" — Ezreal\'s damage does nothing', () => {
  let g = S0({ bfA: "Reaver's Row" }); fundAll(g, P0, 6);
  const ez = put(g, P0, 'sfd-082-221', 'base');
  const d1 = put(g, P1, 'V(9)', BF_A), d2 = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [ez], BF_A);
  let order: string[] = [];
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    if (g.chain.length >= 2 && !order.length) order = chainLabels(g);
    const d = pend(g); const o = optionIds(g);
    g = d.kind === 'optional' ? (d.player === P1 ? yes(g) : no(g)) : d.inStep ? choose(g, o.includes(d1) ? d1 : o[0]) : pass(g);
    if (locOf(g, d1) === 'base' && g.chain.length === 0) break;
  }
  assert.ok(order.some(l => /Ezreal/.test(l)) && !/Ezreal/.test(order[order.length - 1]), `Row's trigger above Ezreal's: ${order}`);
  assert.equal(locOf(g, d1), 'base', 'moved to base by the Row');
  assert.equal(g.objects[d1].damage ?? 0, 0, 'Ezreal\'s trigger did nothing to it');
  void d2;
});

test('RJ#8906 (MISMATCH-RJ, Temporary reminder text "before scoring") a lone Temporary Sprite at my battlefield dies at the start of my Beginning Phase before the hold: no hold point', () => {
  let g = withTokens(S0({ tp: P1 }));
  const sp = put(g, P0, 'Sprite', BF_A, { token: true }); control(g, BF_A, P0);
  const pts = g.players[P0].points;
  g = act(g, { type: 'endTurn', player: P1 });
  g = drive(g);
  assert.notEqual(locOf(g, sp), BF_A, 'killed by Temporary');
  assert.equal(g.players[P0].points, pts, 'no hold point');
});

test('RJ#8908 hidden Facebreaker when the opponent attacks my battlefield: both units stunned, no combat damage; both survive → the attacker is recalled, I keep it', () => {
  let g = S0({ tp: P1 });
  const mine = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const fb = put(g, P0, 'Facebreaker', { facedown: BF_A });
  const e = put(g, P1, 'V(3)', 'base');
  g = move(g, P1, [e], BF_A);
  let played = false;
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!played && d.player === P0 && !d.inStep && canPlayNow(g, P0, fb)) { g = play(g, P0, fb, { targets: [[mine], [e]] }); played = true; continue; }
    g = d.kind === 'optional' ? no(g) : d.inStep ? choose(g, optionIds(g).includes(mine) ? mine : optionIds(g).includes(e) ? e : optionIds(g)[0]) : pass(g);
  }
  assert.ok(played);
  assert.equal(g.objects[mine].damage ?? 0, 0); assert.equal(g.objects[e].damage ?? 0, 0);
  assert.equal(locOf(g, e), 'base', 'attacker recalled');
  assert.equal(locOf(g, mine), BF_A);
  assert.equal(g.battlefields[BF_A].controller, P0);
});

test('RJ#8912 Azir, Ascendant in base swapping with my unit at Vilemaw\'s Lair: Azir moves to the Lair, the unit can\'t move to base and stays', () => {
  let g = S0({ bfA: "Vilemaw's Lair" }); fundAll(g, P0);
  const az = put(g, P0, 'Azir, Ascendant', 'base');
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  g = drive(act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === az)!), [u], 'no');
  assert.equal(locOf(g, az), BF_A);
  assert.equal(locOf(g, u), BF_A, 'blocked by the Lair');
});

test('RJ#8913 Signature cards share one limit of 3 per deck, whatever their names (3 + 3 illegal; 2 + 1 legal)', () => {
  const d6 = legalDeck();
  d6.main = d6.main.slice(0, 33).concat(['cf-sig1', 'cf-sig1', 'cf-sig1', 'cf-sig2', 'cf-sig2', 'cf-sig2']);
  assert.ok(validateDeck(d6, fixtureDb(), { battlefields: 3 }).some(p => p.code === 'signature.count'));
  const d3 = legalDeck();
  d3.main = d3.main.slice(0, 36).concat(['cf-sig1', 'cf-sig1', 'cf-sig2']);
  assert.deepEqual(validateDeck(d3, fixtureDb(), { battlefields: 3 }), []);
});

test('RJ#8914 an unattached Spinning Axe\'s Temporary trigger is on the chain; Angle Shot attaches it in response: the trigger still kills it', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 6);
  const ax = put(g, P0, 'Spinning Axe', 'base');
  const u = put(g, P0, 'V(2)', 'base');
  const as = hand(g, P0, 'Angle Shot');
  g = act(g, { type: 'endTurn', player: P1 });
  for (let i = 0; i < 10 && !(g.chain.some(c => c.source === ax) && pend(g).player === P0 && !pend(g).inStep); i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.ok(g.chain.some(c => c.source === ax), 'Temporary trigger on the chain');
  fundAll(g, P0, 6);
  g = play(g, P0, as, { targets: [[u], [ax]] });
  for (let i = 0; i < 10 && g.chain.some(c => c.source === as); i++) g = pend(g).inStep ? choose(g, optionIds(g).find(x => /attach/i.test(x)) ?? optionIds(g)[0]) : pass(g);
  assert.equal(g.objects[ax].attachedTo, u, 'attached by Angle Shot');
  g = drive(g);
  assert.equal(zone(g, ax), 'trash', 'the pending Temporary trigger still kills it');
});

/** RJ#8921: damage left on a V(9) after Falling Star (both instructions on it) with n Counter Strikes on it. */
const rj8921 = (n: number) => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const e = put(g, P1, 'V(9)', 'base');
  g = play(g, P0, hand(g, P0, 'Falling Star'), { targets: [[e], [e]] });
  for (let k = 0; k < n; k++) {
    if (pend(g).player !== P1) g = pass(g);
    g = play(g, P1, hand(g, P1, 'Counter Strike'), { targets: [[e]] });
    for (let i = 0; i < 4 && g.chain.length > 1; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  }
  for (let i = 0; i < 8 && g.chain.length; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  return g.objects[e].damage ?? 0;
};
test('RJ#8921 Falling Star choosing one unit for both instructions: one Counter Strike prevents only one of the two 3s', () => {
  assert.equal(rj8921(0), 6);
  assert.equal(rj8921(1), 3, 'one Counter Strike: the first instance prevented');
});

test('RJ#8921b Falling Star (both on one unit) vs two Counter Strikes: each prevents one damage event → 0', () => {
  assert.equal(rj8921(2), 0, 'two: both prevented');
});

test('RJ#8922 playing a unit is not choosing it: Irelia, Fervent played from hand gets no +1 and Blade Dancer doesn\'t trigger', () => {
  let g = S0(); fundAll(g, P0, 12);
  setLegend(g, P0, 'Blade Dancer');
  const ir = hand(g, P0, 'Irelia, Fervent');
  const n = g.log.length;
  g = drive(act(g, { type: 'playCard', player: P0, obj: ir }), ['base'], 'no');
  assert.equal(zone(g, ir), 'base');
  assert.ok(!g.log.slice(n).some(l => /^Trigger: (Irelia|Blade Dancer)/.test(l.text)), 'no "choose" triggers');
  assert.equal(mightOf(g, ir), g.cards[g.objects[ir].cardId].might);
});

test('RJ#8925 Vex (sfd-146) attacks Draven, Vanquisher: in response to Draven\'s defend trigger the hidden Fight or Flight can be played, but costs [1][A] (hidden 0 + Vex\'s increase)', () => {
  let g = S0(); fundAll(g, P0, 6); fundAll(g, P1, 6);
  const vx = put(g, P0, 'sfd-146-221', 'base');
  const dr = put(g, P1, 'Draven, Vanquisher', BF_A); control(g, BF_A, P1);
  const fof = put(g, P1, 'Fight or Flight', { facedown: BF_A });
  assert.equal(playCostOf(g, P1, fof)?.energy ?? 0, 0, 'hidden: free while Vex is not in combat');
  g = move(g, P0, [vx], BF_A);
  let checked = false;
  for (let i = 0; i < 12 && !checked; i++) {
    const d = pend(g);
    if (!d.inStep && d.player === P1 && g.chain.some(c => c.source === dr)) {
      checked = true;
      assert.ok(canPlayNow(g, P1, fof), 'hidden Fight or Flight may respond to the trigger');
      const c = playCostOf(g, P1, fof)!;
      assert.equal(c.energy, 1, 'Vex: +[1]');
      assert.equal(c.power.length, 1, 'Vex: +[A]');
      break;
    }
    g = d.kind === 'optional' ? yes(g) : d.inStep ? choose(g, optionIds(g)[0]) : pass(g);
  }
  assert.ok(checked, 'Draven\'s defend trigger reached the chain with P1 to act');
});

test('RJ#8926 Retreat in response to my Temporary unit\'s Beginning-Phase trigger: the unit returns to hand; the rune channeled exhausted stays exhausted this turn (Awaken already passed)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 2);
  const u = put(g, P0, 'Keeper of Masks', 'base');
  const r = hand(g, P0, 'Retreat');
  const runes0 = g.players[P0].runesInPlay.length;
  g = endTurn(g, P1);
  for (let i = 0; i < 10 && !(g.chain.some(c => c.source === u) && pend(g).player === P0 && !pend(g).inStep); i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.ok(g.chain.some(c => c.source === u), 'Temporary trigger on the chain');
  assert.equal(exhaustedRunes(g, P0), 0, 'all runes readied in Awaken');
  g = play(g, P0, r, { targets: [[u]] });
  const paid = exhaustedRunes(g, P0);
  assert.ok(paid >= 1, 'Retreat paid');
  for (let i = 0; i < 6 && g.chain.some(c => c.source === r); i++) g = pend(g).inStep ? choose(g, optionIds(g).includes(u) ? u : optionIds(g)[0]) : pass(g);
  assert.equal(zone(g, u), 'hand', 'returned to hand');
  assert.equal(exhaustedRunes(g, P0), paid + 1, 'channeled 1 exhausted');
  g = drive(g);
  expectPending(g, 'mainAction', P0);
  assert.ok(g.players[P0].runesInPlay.length >= runes0 + 1, 'channeled 1');
  assert.equal(exhaustedRunes(g, P0), paid + 1, 'the channeled rune is still exhausted in my main phase');
});

test('RJ#8927 Heimerdinger, Inventor with several copied [T] abilities: one exhaust activates exactly one of them; then none is usable', () => {
  let g = S0(); fundAll(g, P0);
  const hm = put(g, P0, 'Heimerdinger, Inventor', 'base');
  put(g, P0, 'Lux, Crownguard', 'base');
  put(g, P0, 'Iron Ballista', 'base');
  put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const abs = legal(g, P0, 'activate').filter(a => a.type === 'activate' && a.obj === hm);
  assert.ok(abs.length >= 2, `two copied abilities offered (${abs.length})`);
  g = drive(act(g, abs[0]));
  assert.equal(g.objects[hm].exhausted, true);
  assert.ok(!legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === hm), 'no other copied ability usable');
});

test('RJ#8928 holding both battlefields during the opponent\'s turn scores nothing (hold scores only in my own Beginning Phase)', () => {
  let g = S0(); g.players[P1].points = 6;
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  put(g, P1, 'V(2)', BF_B); control(g, BF_B, P1);
  g = drive(g);
  expectPending(g, 'mainAction', P0);
  assert.equal(g.players[P1].points, 6, 'nothing on my opponent\'s turn');
  assert.equal(g.winner, null);
  g = endTurn(g, P0);
  for (let i = 0; i < 20 && g.winner === null && g.pending; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(g.winner, P1, 'both held at the start of P1\'s own turn → 8, wins');
});

test('RJ#8929 Ravenbloom Student + a spell played with Repeat (Called Shot): one spell played → one trigger, +1 only', () => {
  let g = S0(); fundAll(g, P0, 3);
  const st = put(g, P0, 'Ravenbloom Student', 'base');
  const m0 = mightOf(g, st);
  const n = g.log.length;
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Called Shot') });
  g = answer(g, { may: [true] }, P0);
  g = drive(g);
  assert.equal(mightOf(g, st), m0 + 1, 'one +1');
  assert.equal(g.log.slice(n).filter(l => /^Trigger: Ravenbloom/.test(l.text)).length <= 1, true);
});

test('RJ#8930 Imperial Decree active; Bellows Breath + Repeat both on an Irelia with Guardian Angel: two damage events → two kill triggers; GA replaces the first, the second kills her', () => {
  let g = S0(); fundAll(g, P0, 8);
  const ir = put(g, P1, 'sfd-057-221', BF_A); control(g, BF_A, P1);
  const ga = put(g, P1, 'Guardian Angel', BF_A); attachNow(g, ga, ir);
  g = drive(play(g, P0, hand(g, P0, 'Imperial Decree')));
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Bellows Breath') });
  for (let i = 0; i < 8 && pend(g).inStep && pend(g).player === P0; i++) {
    const d = pend(g);
    g = d.kind === 'chooseTargets' ? act(g, { type: 'choose', player: P0, optionIds: [ir] }) : choose(g, d.kind === 'optional' ? 'yes' : optionIds(g)[0]);
  }
  assert.ok(g.chain.length >= 1, 'Bellows Breath on the chain');
  g = drive(g);
  assert.equal(zone(g, ga), 'trash', 'Guardian Angel used up');
  assert.equal(zone(g, ir), 'trash', 'the second Decree kill has no protection left');
});

test('RJ#8932 hidden Emperor\'s Divide in response to Blitzcrank\'s hold trigger moves him to base, but he still returns to hand (the point is scored)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0);
  const b = put(g, P0, 'ogn-067-298', BF_A); control(g, BF_A, P0);
  const ed = put(g, P0, "Emperor's Divide", { facedown: BF_A, hiddenTurn: 1 });
  g = endTurn(g, P1);
  for (let i = 0; i < 20 && !(g.chain.some(c => c.source === b) && pend(g).player === P0 && !pend(g).inStep); i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.ok(g.chain.some(c => c.source === b), 'hold trigger on the chain');
  assert.equal(g.players[P0].points, 1, 'hold point already scored');
  assert.ok(canPlayNow(g, P0, ed));
  g = play(g, P0, ed, { targets: [[b]] });
  for (let i = 0; i < 6 && g.chain.some(c => c.source === ed); i++) g = pend(g).inStep ? choose(g, optionIds(g).includes(b) ? b : optionIds(g)[0]) : pass(g);
  assert.equal(locOf(g, b), 'base', 'moved to base');
  g = drive(g);
  assert.equal(zone(g, b), 'hand', 'still returned to hand');
});

test('RJ#8933 Emperor\'s Divide on my units at Vilemaw\'s Lair: they can\'t move from there to base and stay', () => {
  let g = S0({ bfA: "Vilemaw's Lair" }); fundAll(g, P0);
  const u = put(g, P0, 'V(2)', BF_A), w = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const ed = hand(g, P0, "Emperor's Divide");
  if (canPlayNow(g, P0, ed)) g = drive(play(g, P0, ed, { targets: [[u, w]], battlefields: [BF_A] }), [u, w, BF_A]);
  assert.equal(locOf(g, u), BF_A); assert.equal(locOf(g, w), BF_A, 'blocked by the Lair');
});

test('RJ#8934 Bellows Breath + Repeat: the repeat may choose units at a different location (BF_A first, BF_B second)', () => {
  let g = S0(); fundAll(g, P0, 8);
  const e1 = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const e2 = put(g, P1, 'V(3)', BF_B); control(g, BF_B, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Bellows Breath') });
  let k = 0;
  for (let i = 0; i < 10 && pend(g).inStep && pend(g).player === P0; i++) {
    const d = pend(g);
    if (d.kind === 'chooseTargets') { const t = k++ === 0 ? e1 : e2; assert.ok(optionIds(g).includes(t), `target ${k} offered`); g = act(g, { type: 'choose', player: P0, optionIds: [t] }); }
    else g = choose(g, d.kind === 'optional' ? 'yes' : optionIds(g)[0]);
  }
  assert.equal(k, 2, 'two sets of choices');
  g = drive(g);
  assert.equal(g.objects[e1].damage, 1); assert.equal(g.objects[e2].damage, 1);
});

test('RJ#8940 Zhonya\'s Hourglass saves a Temporary unit from its Beginning-Phase kill once; it keeps Temporary and dies at my next Beginning Phase', () => {
  let g = S0({ tp: P1 });
  const u = put(g, P0, 'Keeper of Masks', 'base');
  const z = put(g, P0, "Zhonya's Hourglass", 'base');
  g = endTurn(g, P1);
  g = drive(g, [], 'yes');
  expectPending(g, 'mainAction', P0);
  assert.equal(zone(g, z), 'trash', 'Zhonya\'s used');
  assert.equal(zone(g, u), 'base', 'saved this time');
  assert.ok(hasKeyword(g, u, 'Temporary'), 'still Temporary');
  g = endTurn(g, P0); g = drive(g); g = endTurn(g, P1); g = drive(g);
  expectPending(g, 'mainAction', P0);
  assert.equal(zone(g, u), 'trash', 'killed at the next Beginning Phase');
});

test('RJ#8944 Relentless Pursuit can move a unit from one battlefield to another (no Ganking needed)', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  assert.ok(!hasKeyword(g, u, 'Ganking'));
  [g] = cast(g, P0, 'Relentless Pursuit', { targets: [[u]], locations: [BF_B], battlefields: [BF_B] });
  g = drive(g, [String(BF_B)], 'no');
  assert.equal(locOf(g, u), BF_B);
});

test('RJ#8947 King\'s Edict doesn\'t choose units when played (opponents choose on resolution): Not So Fast can\'t counter it', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0); put(g, P1, 'V(1)', 'base');
  const nsf = hand(g, P0, 'Not So Fast');
  g = play(g, P1, hand(g, P1, "King's Edict"));
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  assert.ok(g.chain.length > 0 && pend(g).player === P0);
  assert.equal(canPlayNow(g, P0, nsf), false, 'nothing chosen → Not So Fast has no legal target');
});

test('RJ#8950 Hidden Blade kills my own Immortal Phoenix at a battlefield: after Hidden Blade resolves its trigger lets me pay to play it from the trash (and I draw 2)', () => {
  let g = S0(); fundAll(g, P0);
  const ph = put(g, P0, 'Immortal Phoenix', BF_A); control(g, BF_A, P0);
  const h0 = g.players[P0].hand.length;
  const hb = hand(g, P0, 'Hidden Blade');
  g = play(g, P0, hb, { targets: [[ph]] });
  g = drive(g, [ph, 'base'], 'yes');
  assert.ok(g.players[P0].hand.length >= h0 + 2, 'its controller (me) drew 2');
  assert.ok(zone(g, ph) === 'base' || locOf(g, ph) === BF_A, `Phoenix played from the trash (${zone(g, ph)})`);
});

test('RJ#8951 Rocket Barrage + Repeat: one execution kills their Zhonya\'s Hourglass, the other deals 4 to their 4-Might base unit — in either order the Hourglass is gone before the unit dies (after the spell), so it dies', () => {
  for (const order of ['unitFirst', 'gearFirst']) {
    let g = S0(); fundAll(g, P0, 8);
    const u = put(g, P1, 'V(4)', 'base'); const z = put(g, P1, "Zhonya's Hourglass", 'base');
    const picks = order === 'unitFirst' ? [u, z] : [z, u];
    g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Rocket Barrage') });
    let k = 0;
    for (let i = 0; i < 8 && pend(g).inStep && pend(g).player === P0; i++) {
      const d = pend(g);
      if (d.kind === 'chooseTargets') g = choose(g, picks[k++]);
      else g = choose(g, d.kind === 'optional' ? 'yes' : optionIds(g)[0]);
    }
    assert.equal(k, 2, `${order}: both executions chose`);
    g = drive(g, [], 'yes');
    assert.equal(zone(g, z), 'trash', `${order}: Hourglass killed`);
    assert.equal(zone(g, u), 'trash', `${order}: unit not saved`);
  }
});

test('RJ#8960 Swift Scout\'s "[1], [T]: put a Teemo unit into your hand" has no Reaction: not usable in response on the opponent\'s turn, only in my open state', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const l = setLegend(g, P0, 'Swift Scout');
  const tm = put(g, P0, 'Teemo, Scout', 'base');
  const canUse = (gg: GameState) => legal(gg, P0, 'activate').some(a => a.type === 'activate' && a.obj === l);
  const v = put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  g = play(g, P1, hand(g, P1, 'Gust'), { targets: [[v]] });
  for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
  assert.ok(g.chain.length > 0 && pend(g).player === P0, 'P0 may respond to the chain');
  assert.equal(canUse(g), false, 'not at reaction speed');
  g = drive(g); g = endTurn(g, P1); g = drive(g);
  expectPending(g, 'mainAction', P0);
  assert.equal(zone(g, tm), 'base');
  assert.equal(canUse(g), true, 'my open main phase');
});

test('RJ#8962 a buffed unit that dies loses its buff: Immortal Phoenix (buffed) killed by my Hidden Blade and played back from the trash has no buff', () => {
  let g = S0(); fundAll(g, P0);
  const ph = put(g, P0, 'Immortal Phoenix', BF_A, { buff: true }); control(g, BF_A, P0);
  assert.equal(g.objects[ph].counters?.buff ?? 0, 1);
  g = drive(play(g, P0, hand(g, P0, 'Hidden Blade'), { targets: [[ph]] }), [ph, 'base'], 'yes');
  assert.notEqual(zone(g, ph), 'trash', 'played back');
  assert.equal(g.objects[ph].counters?.buff ?? 0, 0, 'no buff');
});

test('RJ#8966 attacking Reaver\'s Row: the defender moves its only unit to base with the Row trigger, but the showdown goes on and the defender still gets an action window (may play an Action)', () => {
  let g = S0({ bfA: "Reaver's Row" }); fundAll(g, P1);
  const a = put(g, P0, 'V(3)', 'base');
  const d1 = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const fof = hand(g, P1, 'Fight or Flight');
  g = move(g, P0, [a], BF_A);
  let window = false;
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'showdownAction' && d.player === P1 && !g.chain.length && locOf(g, d1) === 'base') { window = canPlayNow(g, P1, fof); break; }
    g = d.kind === 'optional' ? yes(g) : d.inStep ? choose(g, optionIds(g).includes(d1) ? d1 : optionIds(g)[0]) : pass(g);
  }
  assert.equal(locOf(g, d1), 'base', 'moved away by the Row');
  assert.ok(window, 'P1 got a showdown action window and may play an Action');
});

test('RJ#8973 B.F. Sword stolen by Akshan, then moved onto Lucian by Weaponmaster; Akshan dies: control reverts to its owner but the Sword stays attached to Lucian', () => {
  let g = S0(); fundAll(g, P0, 12);
  control(g, BF_A, P0);
  const bf = put(g, P1, 'B.F. Sword', 'base');
  const ak = hand(g, P0, 'sfd-109-221');
  g = act(g, { type: 'playCard', player: P0, obj: ak, destination: BF_A } as never);
  g = drive(g, [bf], 'yes');
  assert.equal(g.objects[bf].controller, P0, 'stolen'); assert.equal(g.objects[bf].attachedTo, ak);
  const lu = hand(g, P0, 'sfd-113-221');
  g = act(g, { type: 'playCard', player: P0, obj: lu, destination: 'base' } as never);
  g = drive(g, [bf], 'yes');
  assert.equal(g.objects[bf].attachedTo, lu, 'Weaponmaster moved it to Lucian');
  g = drive(play(g, P0, hand(g, P0, 'Hidden Blade'), { targets: [[ak]] }), [ak]);
  assert.equal(zone(g, ak), 'trash');
  assert.equal(g.objects[bf].controller, P1, 'control reverts');
  assert.equal(g.objects[bf].attachedTo, lu, 'still attached to Lucian');
});

test('RJ#8976 Piercing Light + Repeat on two units at different battlefields: both executions choose the same pair → 4 damage each', () => {
  let g = S0(); fundAll(g, P0, 8);
  const e1 = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const e2 = put(g, P1, 'V(5)', BF_B); control(g, BF_B, P1);
  const picks = [e1, e2, e1, e2];
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Piercing Light') });
  let k = 0;
  for (let i = 0; i < 10 && pend(g).inStep && pend(g).player === P0; i++) {
    const d = pend(g);
    if (d.kind === 'chooseTargets') g = choose(g, picks[k++]);
    else g = choose(g, d.kind === 'optional' ? 'yes' : optionIds(g)[0]);
  }
  assert.equal(k, 4, 'four choices (two per execution)');
  g = drive(g);
  assert.equal(g.objects[e1].damage, 4); assert.equal(g.objects[e2].damage, 4);
});

test('RJ#8977 Irelia, Fervent wearing Boots of Swiftness ganks to another battlefield: a move is not choosing her → no +1', () => {
  let g = S0(); fundAll(g, P0);
  const ir = put(g, P0, 'Irelia, Fervent', BF_A); control(g, BF_A, P0);
  attachNow(g, put(g, P0, 'Boots of Swiftness', 'base'), ir);
  assert.ok(hasKeyword(g, ir, 'Ganking'));
  const m0 = mightOf(g, ir), n = g.log.length;
  g = drive(move(g, P0, [ir], BF_B));
  assert.equal(locOf(g, ir), BF_B);
  assert.ok(!g.log.slice(n).some(l => /^Trigger: Irelia/.test(l.text)), 'no Irelia trigger');
  assert.equal(mightOf(g, ir), m0);
});

test('RJ#8984 Rumble, Hotheaded ("Your Mechs each have [Assault]") killed by Hidden Blade: my other Mech loses Assault at once', () => {
  let g = S0(); fundAll(g, P0);
  const r = put(g, P0, 'sfd-026-221', BF_A); control(g, BF_A, P0);
  const m = put(g, P0, 'Incorrigible Construct', BF_A);
  assert.ok(hasKeyword(g, m, 'Assault'), 'granted while Rumble is on the board');
  g = drive(play(g, P0, hand(g, P0, 'Hidden Blade'), { targets: [[r]] }), [r]);
  assert.equal(zone(g, r), 'trash');
  assert.ok(!hasKeyword(g, m, 'Assault'), 'lost');
});

test('RJ#8985 Akshan steals the opponent\'s Guardian Angel (attached to him) and would die: Guardian Angel is killed instead (to its owner\'s trash), Akshan is recalled', () => {
  let g = S0(); fundAll(g, P0, 12);
  control(g, BF_A, P0);
  const ga = put(g, P1, 'Guardian Angel', 'base');
  const ak = hand(g, P0, 'sfd-109-221');
  g = drive(act(g, { type: 'playCard', player: P0, obj: ak, destination: BF_A } as never), [ga], 'yes');
  assert.equal(g.objects[ga].attachedTo, ak);
  g = drive(play(g, P0, hand(g, P0, 'Hidden Blade'), { targets: [[ak]] }), [ak]);
  assert.equal(zone(g, ga), 'trash', 'Guardian Angel killed');
  assert.ok(g.players[P1].trash.includes(ga), 'in its owner\'s trash');
  assert.equal(locOf(g, ak), 'base', 'Akshan saved and recalled');
});

test('RJ#8987 King\'s Edict: the opponent chooses their Deflect unit on resolution — no Deflect cost is paid', () => {
  let g = S0(); fundAll(g, P0, 4);
  const p = put(g, P1, 'Pouty Poro', BF_A); control(g, BF_A, P1);
  assert.ok(hasKeyword(g, p, 'Deflect'));
  const ke = hand(g, P0, "King's Edict");
  const c = playCostOf(g, P0, ke)!;
  const r0 = g.players[P0].runesInPlay.length;
  g = drive(play(g, P0, ke), [p]);
  assert.equal(zone(g, p), 'trash', 'killed');
  assert.equal(r0 - g.players[P0].runesInPlay.length, c.power.length, 'only the printed power was recycled (no Deflect)');
});

test('RJ#8989 Relentless Pursuit on a unit already wearing an Equipment may attach a second one: both stay attached', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const ls = put(g, P0, 'Long Sword', 'base'); attachNow(g, ls, u);
  const bf = put(g, P0, 'B.F. Sword', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Relentless Pursuit') });
  const seen: string[] = [];
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g); const o = optionIds(g);
    if (d.inStep) seen.push(`${d.kind}:${d.prompt}:${o.join(',')}`);
    if (d.kind === 'optional') g = choose(g, /attach/i.test(d.prompt ?? '') ? 'yes' : 'no');
    else if (d.inStep) g = choose(g, [u, bf, String(BF_B)].map(String).find(x => o.includes(x)) ?? o[0]);
    else g = pass(g);
  }
  assert.equal(g.objects[bf].attachedTo, u, `second Equipment attached ${seen.join(' | ')}`);
  assert.equal(g.objects[ls].attachedTo, u, 'first one still attached');
});

test('RJ#8990 Adaptatron\'s conquer trigger choosing the opponent\'s gear can be countered by their Not So Fast: the gear survives, no buff', () => {
  let g = S0(); fundAll(g, P1);
  const ad = put(g, P0, 'Adaptatron', 'base');
  const gear = put(g, P1, 'Long Sword', 'base');
  const nsf = hand(g, P1, 'Not So Fast');
  g = move(g, P0, [ad], BF_A);
  let answered = false;
  for (let i = 0; i < 40 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g); const o = optionIds(g);
    if (!answered && !d.inStep && d.player === P1 && g.chain.some(c => c.source === ad)) {
      assert.ok(canPlayNow(g, P1, nsf), 'Not So Fast can answer the trigger');
      g = play(g, P1, nsf); answered = true; continue;
    }
    g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : o.includes(gear) ? gear : o.includes(ad) && d.player === P1 ? ad : o[0]) : pass(g);
  }
  assert.ok(answered);
  assert.equal(zone(g, gear), 'base', 'gear not killed');
  assert.equal(g.objects[ad].counters?.buff ?? 0, 0, 'no buff');
});

test('RJ#8997 Yone (sfd-116) played to an open battlefield (Miss Fortune, Buccaneer): Weaponmaster attaches first; his conquer trigger comes after the showdown and deals his equipped Might to an enemy base unit', () => {
  let g = S0(); fundAll(g, P0, 12);
  put(g, P0, 'ogn-193-298', 'base');
  const ls = put(g, P0, 'Long Sword', 'base');
  const e = put(g, P1, 'V(9)', 'base');
  const y = hand(g, P0, 'sfd-116-221');
  g = act(g, { type: 'playCard', player: P0, obj: y, destination: BF_A } as never);
  g = drive(g, [ls, e], 'yes');
  assert.equal(locOf(g, y), BF_A);
  assert.equal(g.objects[ls].attachedTo, y, 'Weaponmaster attached');
  assert.equal(g.battlefields[BF_A].controller, P0, 'conquered');
  assert.equal(g.objects[e].damage, mightOf(g, y), 'damage = Might including the Equipment');
});

test('RJ#9007 a stunned attacker recalled, readied and sent in again the same turn is still stunned: it deals no combat damage', () => {
  let g = S0();
  const a = put(g, P0, 'V(4)', 'base', { ready: true });
  g.objects[a].stunned = true; g.timestamp++;
  const d = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  g = drive(move(g, P0, [a], BF_A));
  assert.equal(locOf(g, a), 'base', 'recalled');
  assert.equal(locOf(g, d), BF_A, 'the 3-Might defender survives: the stunned 4 dealt no combat damage');
  assert.equal(g.objects[a].stunned, true, 'still stunned this turn');
});

test('RJ#9009 Draven, Audacious would die in combat but Zhonya\'s Hourglass replaces it: he never dies, so the opponent scores no point', () => {
  let g = S0();
  const dr = put(g, P0, 'Draven, Audacious', 'base');
  const z = put(g, P0, "Zhonya's Hourglass", 'base');
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  g = drive(move(g, P0, [dr], BF_A), [], 'yes');
  assert.equal(zone(g, z), 'trash', 'Hourglass used');
  assert.equal(locOf(g, dr), 'base', 'Draven saved and recalled');
  assert.equal(g.players[P1].points, 0, 'no "when I die in combat" point');
});

test('RJ#9010 a hidden Zhonya\'s Hourglass can be played from hidden with no unit dying: it ends up in my base as a normal Hourglass', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const z = put(g, P0, "Zhonya's Hourglass", { facedown: BF_A, hiddenTurn: 0 });
  assert.ok(canPlayNow(g, P0, z), 'playable from hidden');
  g = drive(act(g, { type: 'playCard', player: P0, obj: z, destination: BF_A } as never));
  assert.equal(locOf(g, z), 'base', 'gear ends in base');
  assert.ok(!g.objects[z].faceDown);
});

test('RJ#9022 Arcane Shift needs an enemy unit at a battlefield to be played (a friendly unit alone is not enough)', () => {
  const g = S0(); fundAll(g, P0);
  put(g, P0, 'V(2)', 'base'); put(g, P1, 'V(2)', 'base');
  const as = hand(g, P0, 'Arcane Shift');
  assert.equal(canPlayNow(g, P0, as), false, 'no enemy at a battlefield');
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  assert.equal(canPlayNow(g, P0, as), true);
});

test('RJ#9033 (MISMATCH-RJ premise, card text ogn-181 "to its owner\'s hand") Pack of Wonders on the gear my Akshan stole returns it to its OWNER\'s hand, not mine — I can\'t play it', () => {
  let g = S0(); fundAll(g, P0, 12);
  control(g, BF_A, P0);
  const pk = put(g, P0, 'Pack of Wonders', 'base');
  const ls = put(g, P1, 'Long Sword', 'base');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'sfd-109-221'), destination: BF_A } as never), [ls], 'yes');
  assert.equal(g.objects[ls].controller, P0, 'stolen');
  g = drive(act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === pk)!), [ls]);
  assert.equal(zone(g, ls), 'hand');
  assert.ok(g.players[P1].hand.includes(ls), 'owner\'s hand');
  assert.ok(!g.players[P0].hand.includes(ls), 'not mine');
});

test('RJ#9039 Nocturne (4) attacks a Ravenbloom Student (2); in the showdown the Student\'s side plays Wages of Pain (3 to Nocturne) and Called Shot: Student 4, Nocturne 4 with 3 damage → both die', () => {
  let g = withTokens(S0()); fundAll(g, P1, 6);
  const n = put(g, P0, 'ogn-194-298', 'base');
  const st = put(g, P1, 'Ravenbloom Student', BF_A); control(g, BF_A, P1);
  const wp = hand(g, P1, 'Wages of Pain'), cs = hand(g, P1, 'Called Shot');
  g = move(g, P0, [n], BF_A);
  const todo = [wp, cs];
  for (let i = 0; i < 60 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'showdownAction' && d.player === P1 && !g.chain.length && todo.length) {
      const c = todo.shift()!;
      g = c === wp ? play(g, P1, c, { targets: [[n]] }) : act(g, { type: 'playCard', player: P1, obj: c });
      continue;
    }
    g = d.kind === 'optional' ? no(g) : d.inStep ? choose(g, optionIds(g)[0]) : pass(g);
  }
  assert.equal(todo.length, 0, 'both spells played');
  assert.equal(zone(g, n), 'trash', 'Nocturne dies');
  assert.equal(zone(g, st), 'trash', 'Student (4) dies');
});

test('RJ#9041 a Chosen Champion with [Reaction] (Janna) can be played from the Champion Zone in response on the opponent\'s turn; one without (Sett, Brawler) can\'t', () => {
  const run = (name: string) => {
    let g = S0({ tp: P1 }); fundAll(g, P0, 6); fundAll(g, P1, 6);
    const cz = g.players[P0].championZone[0];
    const d = realCard(name); g.cards = { ...g.cards, [d.id]: d }; g.objects[cz].cardId = d.id; g.timestamp++;
    const v = put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
    g = play(g, P1, hand(g, P1, 'Gust'), { targets: [[v]] });
    for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
    assert.ok(g.chain.length > 0 && pend(g).player === P0);
    return canPlayNow(g, P0, cz);
  };
  assert.equal(run('sfd-053-221'), true, 'Janna (Reaction) from the Champion Zone');
  assert.equal(run('Sett, Brawler'), false, 'no Reaction: not in a closed state');
});

test('RJ#9048 Ride the Wind moves a unit from one battlefield to another (only the Standard Move is restricted)', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  g = drive(play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[u]], locations: [BF_B] }), [String(BF_B)]);
  assert.equal(locOf(g, u), BF_B);
});

test('RJ#9059 Not So Fast on Beast Below\'s play trigger counters the whole ability: neither my other unit nor the enemy unit is returned; Beast Below stays', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1, 6);
  const f = put(g, P0, 'V(2)', 'base'); const e = put(g, P1, 'V(2)', 'base');
  const bb = hand(g, P0, 'Beast Below'); const nsf = hand(g, P1, 'Not So Fast');
  g = act(g, { type: 'playCard', player: P0, obj: bb, destination: 'base' } as never);
  let countered = false;
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g); const o = optionIds(g);
    if (!countered && !d.inStep && d.player === P1 && g.chain.some(c => c.source === bb)) {
      assert.ok(canPlayNow(g, P1, nsf)); g = play(g, P1, nsf); countered = true; continue;
    }
    g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : [f, e, bb].find(x => o.includes(x) && (d.player === P0 ? x !== bb : true)) ?? o[0]) : pass(g);
  }
  assert.ok(countered);
  assert.equal(zone(g, f), 'base'); assert.equal(zone(g, e), 'base', 'nothing returned');
  assert.equal(zone(g, bb), 'base', 'Beast Below stays');
});

test('RJ#9062 Bellows Breath on a unit in its owner\'s base; a hidden Tideturner swaps that unit to the battlefield in response: it is still dealt 1 (a lone target still satisfies "at the same location")', () => {
  let g = S0(); fundAll(g, P0, 6);
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const x = put(g, P1, 'V(3)', 'base');
  const tt = put(g, P1, 'Tideturner', { facedown: BF_A });
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Bellows Breath') });
  for (let i = 0; i < 8 && pend(g).inStep; i++) {
    const d = pend(g); const o = optionIds(g);
    g = d.kind === 'optional' ? choose(g, 'no') : o.includes(x) ? choose(g, x) : act(g, legal(g, d.player)[0]);
  }
  for (let i = 0; i < 4 && pend(g).player !== P1; i++) g = pass(g);
  expectPending(g, 'chainResponse', P1);
  g = play(g, P1, tt, { dest: BF_A });
  g = answer(g, { may: [true], targets: [[x]] }, P1);
  g = toStep(g); g = answer(g, { may: [true], targets: [[x]] }, P1);
  for (let i = 0; i < 30 && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g); if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    g = d.kind === 'optional' ? choose(g, d.player === P1 ? 'yes' : 'no') : o.includes(x) ? choose(g, x) : act(g, legal(g, d.player)[0]);
  }
  assert.equal(locOf(g, x), BF_A, 'swapped to the battlefield');
  assert.equal(locOf(g, tt), 'base');
  assert.equal(g.objects[x].damage, 1, 'still dealt 1');
});

test('RJ#9072 Leona, Determined\'s attack trigger may choose an enemy unit that is already stunned (RJ\'s "can\'t be targeted" aside → MISMATCH-RJ; cf. RJ#7700)', () => {
  let g = S0();
  const st = put(g, P1, 'V(2)', BF_A, { stunned: true }); put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const le = put(g, P0, 'ogn-238-298', 'base');
  g = move(g, P0, [le], BF_A);
  const seen: string[] = [];
  for (let i = 0; i < 10 && !g.chain.some(c => c.source === le); i++) {
    const d = pend(g); if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g); seen.push(...o);
    g = o.includes(st) ? choose(g, st) : act(g, legal(g, d.player)[0]);
  }
  assert.ok(seen.includes(st), `the stunned unit is a legal choice (${seen.join(',')})`);
});

test('RJ#9080 a Guardian Angel save is a replacement, not a choice: Blade Dancer (Irelia legend) is not triggered when it saves my unit', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const leg = legend(g, P0, 'Blade Dancer');
  const u = put(g, P0, 'V(2)', BF_A, { ready: false }); control(g, BF_A, P0);
  const ga = put(g, P0, 'Guardian Angel', 'base'); attachNow(g, ga, u);
  g = nextTurn(g); fundAll(g, P0); fundAll(g, P1);
  g = play(g, P1, hand(g, P1, 'KillA'), { targets: [[u]] });
  const p0Prompts: string[] = [];
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g); if (!d.inStep) { g = pass(g); continue; }
    if (d.player === P0) p0Prompts.push(`${d.kind}:${d.prompt}`);
    g = d.kind === 'optional' ? choose(g, 'no') : act(g, legal(g, d.player)[0]);
  }
  assert.equal(locOf(g, u), 'base', 'saved and recalled');
  assert.ok(!p0Prompts.some(p => /Blade Dancer|ready/i.test(p)), `no Blade Dancer offer (${p0Prompts.join(' | ')})`);
  assert.ok(!chainLabels(g).some(l => /Blade Dancer/.test(l)));
  assert.equal(g.objects[leg].exhausted, false);
});

test('RJ#9085 Jax, Unmatched (Quick-Draw) does not make an Equipment\'s Equip ability a Reaction: on the opponent\'s turn, with priority, it can\'t be used', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  put(g, P0, 'sfd-054-221', 'base');
  const ls = put(g, P0, 'Long Sword', 'base');
  const dr = hand(g, P0, 'DrawR');
  g = play(g, P1, hand(g, P1, 'DrawR'));
  for (let i = 0; i < 2 && pend(g).player !== P0; i++) g = pass(g);
  assert.equal(pend(g).player, P0);
  assert.ok(canPlayNow(g, P0, dr), 'P0 has priority (a Reaction is playable)');
  assert.ok(!legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === ls), 'Equip not usable');
});

test('RJ#9094 (MISMATCH-RJ, principle 1) Imperial Decree; the opponent attacks my Draven (sfd-148) with a 1-Might unit: the Decree kills resolve before the combat result — Draven dies in combat (the opponent scores 1 from his death trigger) and never wins (no point for me)', () => {
  let g = S0(); fundAll(g, P0, 6);
  const dv = put(g, P1, 'sfd-148-221', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(1)', 'base');
  g = drive(play(g, P0, hand(g, P0, 'Imperial Decree')));
  const p0 = g.players[P0].points, p1 = g.players[P1].points;
  g = drive(move(g, P0, [a], BF_A));
  assert.equal(zone(g, a), 'trash');
  assert.equal(zone(g, dv), 'trash', 'Draven killed by the Decree before the result');
  assert.equal(g.players[P1].points, p1, 'Draven never won a combat');
  assert.equal(g.players[P0].points, p0 + 1, 'his "die in combat" trigger: the opponent scores 1');
});

test('RJ#9099 Vex, Cheerless (enemy spells +[1][A] while in combat) vs the opponent\'s Eager Apprentice at a battlefield (-[1], min [1]): Hextech Ray ([1] + 1 power) costs [1] energy + 2 power', () => {
  const g0 = S0({ tp: P0 }); fundAll(g0, P1);
  put(g0, P1, 'Eager Apprentice', BF_A); control(g0, BF_A, P1);
  const ray = hand(g0, P1, 'Hextech Ray');
  const vex = put(g0, P0, 'Vex, Cheerless', 'base');
  let g = move(g0, P0, [vex], BF_A);
  for (let i = 0; i < 8 && pend(g).player !== P1; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(g.showdown?.isCombat && pend(g).player === P1);
  const c = playCostOf(g, P1, ray)!;
  assert.equal(c.energy, 1, '1 + 1 (Vex) - 1 (Apprentice)');
  assert.equal(c.power.length, 2, 'power 1 + 1 (Vex), not reduced');
});

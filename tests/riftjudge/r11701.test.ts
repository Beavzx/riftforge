// Rift Judge verification, range r11701 (question ids 11701-13100). Log: docs/riftjudge/r11701.md
import { test } from 'node:test';
import {
  assert, S0, put, hand, control, move, act, P0, P1, BF_A, BF_B, pend, chainLabels, fundAll, canPlayNow, fillTrash, locOf, zone,
  validateAction, getView, moveDests, chainSources, attackSetup, pass, expectPending, hasKeyword, mightOf, setBattlefieldCard, legal, nextTurn, setRunes, play, passN, answer, mod, kwValue, endTurn, rejects, clearDeck, addRunes,
} from '../conformance/harness.ts';
import { setXp, playCostOf, place, attachNow } from '../../src/engine/testkit.ts';
import { chars } from '../../src/engine/chars.ts';
import { drive, ans, opt, withTokens, unitsNamed, setLegend, nameOf } from './r11701.helpers.ts';
import { createGame } from '../../src/engine/index.ts';
import { fixtureDb } from '../fixtures/conformance/cards.ts';
import { legalDeck } from '../conformance/harness.ts';
import { newObject } from '../../src/engine/state.ts';
import { realCard } from '../conformance/harness.ts';

test("RJ#11703 Diana, Lunari's showdown-start trigger goes on the chain before Kha'Zix's attack trigger (attack resolves first)", () => {
  let g = S0();
  put(g, P1, 'Diana, Lunari', BF_A); control(g, BF_A, P1);
  const k = put(g, P0, "Kha'Zix, Evolving Hunter", 'base');
  setXp(g, P0, 3);
  g = move(g, P0, [k], BF_A);
  expectPending(g, 'optional', P1);           // Diana's start-of-showdown trigger first
  g = ans(g, 'yes');
  expectPending(g, 'optional', P0);           // then the attack trigger
  g = ans(g, 'yes');
  assert.deepEqual(chainLabels(g), ['trigger:Diana', "trigger:Kha'Zix"], "Kha'Zix (newest) resolves first");
});

test('RJ#11704 after a chain resolves in a combat showdown, focus passes and the defender may still play an Action (Punch First) before damage', () => {
  let { g, def } = attackSetup(['V(3)'], ['V(3)']);
  fundAll(g, P0); fundAll(g, P1);
  const pf = hand(g, P1, 'Punch First');
  expectPending(g, 'showdownAction', P0);
  const [g1] = [act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Guttural Roar') })];
  g = drive(g1, ['first'], x => x.pending?.kind === 'showdownAction');
  expectPending(g, 'showdownAction', P1, 'focus passed to the defender after the chain');
  assert.ok(canPlayNow(g, P1, pf), 'Punch First (Action) is playable');
  assert.equal(zone(g, def[0]), 'battlefield', 'no combat damage yet');
});

test('RJ#11705 Call to Battle cannot move a unit to a battlefield the opponent controls', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'V(2)', 'base'); put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  put(g, P0, 'V(2)', BF_B); control(g, BF_B, P0);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Call to Battle') });
  // R-2: u is the only unit with a valid destination, so it and its destination are chosen automatically
  g = drive(g, [], x => x.chain.length === 0 && x.pending?.kind !== 'chainResponse');
  assert.notEqual(locOf(g, u), BF_A);
  assert.equal(locOf(g, u), BF_B, 'only the controlled battlefield is a legal destination');
});

test('RJ#11706 Call to Battle moves a unit from B to A (controlled by you) even if the opponent has no unit to move', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'V(2)', BF_B); control(g, BF_A, P0); put(g, P0, 'V(1)', BF_A);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Call to Battle') });
  // R-2: u is the only unit with a valid destination, so it and its destination are chosen automatically
  g = drive(g);
  assert.equal(locOf(g, u), BF_A);
});

test("RJ#11708 Emperor's Dais can return a token (Reflection) to hand: it ceases to exist, the Sand Soldier is still played", () => {
  let g = S0(); fundAll(g, P0);
  setBattlefieldCard(g, BF_A, "Emperor's Dais");
  const t = put(g, P0, 'V(2)', 'base', { token: true });
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [t, u], BF_A);
  g = drive(g, [], x => x.pending?.kind === 'optional');
  expectPending(g, 'optional', P0);
  g = drive(g, ['yes', [t]]);
  assert.ok(!g.players[0].hand.includes(t), 'token not in hand');
  assert.ok(zone(g, t) === 'gone' || zone(g, t) !== 'hand');
  const soldiers = Object.values(g.objects).filter(o => g.cards[o.cardId]?.name === 'Sand Soldier' && o.zone === 'battlefield' && o.battlefieldIndex === BF_A);
  assert.equal(soldiers.length, 1);
});

test('RJ#11709 a Mirror Image Reflection keeps its granted Temporary after Shady Spectacles makes it copy another unit', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  const x = put(g, P0, 'V(3)', 'base');
  const y = put(g, P0, 'V(4)', 'base');
  const before = new Set(Object.keys(g.objects));
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Mirror Image') });
  g = drive(g, [[x]]);
  const refl = Object.keys(g.objects).find(id => !before.has(id) && g.objects[id].isToken && g.objects[id].zone === 'base')!;
  assert.ok(refl, 'Reflection created');
  assert.ok(hasKeyword(g, refl, 'Temporary'));
  const sp = put(g, P0, 'Shady Spectacles', 'base');
  const eq = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === sp);
  assert.ok(eq, 'Equip is activatable');
  g = drive(act(g, eq!), [[refl], [y]]);
  assert.equal(g.objects[sp].attachedTo, refl, 'equipped');
  assert.equal(mightOf(g, refl), 4, 'now a copy of the 4-Might unit');
  assert.ok(hasKeyword(g, refl, 'Temporary'), 'granted Temporary is kept');
});

test('RJ#11710 Darius, Trifarian does not ready when the second card (Cleave) is taken over by Rebuttal and resolves as the opponent\'s spell', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const d = hand(g, P0, 'Darius, Trifarian');
  g = act(g, { type: 'playCard', player: P0, obj: d, destination: 'base' });
  g = drive(g, [], x => x.pending?.kind === 'mainAction');
  assert.equal(g.objects[d].exhausted, true, 'Darius entered exhausted');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Cleave') });
  g = drive(g, [[d]], x => x.pending?.kind === 'chainResponse');
  g = pass(g);
  expectPending(g, 'chainResponse', P1);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Rebuttal') });
  g = drive(g, ['first', 'yes', 'no']);
  assert.equal(g.objects[d].exhausted, true, 'Darius not readied');
  assert.equal(mightOf(g, d), 5, 'no +2');
});

test('RJ#11711 Rhasa the Sunderer played from the trash (Endless Riches) does not count itself: 7 other cards -> 3 energy + 1 Chaos', () => {
  const g = S0(); fundAll(g, P0);
  put(g, P0, 'Endless Riches', 'base');
  const r = put(g, P0, 'Rhasa the Sunderer', 'trash'); fillTrash(g, P0, 7);
  const c = playCostOf(g, P0, r)!;
  assert.equal(c.energy, 3);
});

test("RJ#11712 Ripper's Bay triggers when a token unit here is returned to hand", () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  setBattlefieldCard(g, BF_A, "Ripper's Bay");
  put(g, P1, 'V(2)', BF_A, { token: true }); control(g, BF_A, P1);
  const n = g.players[1].runesInPlay.length;
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Gust') });
  g = drive(g, [], x => x.pending?.kind === 'optional');
  expectPending(g, 'optional', P1, "the token's owner may pay [1]");
  g = drive(g, ['yes']);
  assert.equal(g.players[1].runesInPlay.length, n + 1, 'channelled 1 rune');
});

test('RJ#11713 Astral Heron discount ("this turn") does not carry into the next turn', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'Astral Heron', BF_A); control(g, BF_A, P0);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'V(1)'), destination: 'base' }));
  const c = hand(g, P0, 'Astral Heron');
  assert.equal(playCostOf(g, P0, c)!.energy, 5, 'discounted this turn');
  g = nextTurn(g); g = nextTurn(g); fundAll(g, P0);
  assert.equal(g.activePlayer, P0);
  assert.equal(playCostOf(g, P0, c)!.energy, 7, 'no discount next turn');
});

test('RJ#11714 Vex, Apathetic stuns an opponent\'s Sprite token played by Lillia', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  put(g, P1, 'Vex, Apathetic', BF_B); control(g, BF_B, P1);
  const l = put(g, P0, 'Lillia, Fae Fawn', 'base');
  g = drive(move(g, P0, [l], BF_A));
  const sp = unitsNamed(g, 'Sprite');
  assert.equal(sp.length, 1);
  assert.equal(g.objects[sp[0]].stunned, true);
});

test('RJ#11715 Rebuttal on Star-Crossed: new choices follow the new controller (friendly = yours), so two enemy units cannot be chosen', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const a = put(g, P1, 'V(2)', 'base'), b = put(g, P1, 'V(2)', 'base');
  const c = put(g, P0, 'V(2)', 'base'), d = put(g, P0, 'V(2)', 'base');
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Star-Crossed') });
  g = ans(g, [a], [c]);
  g = drive(g, [], x => x.pending?.kind === 'chainResponse');
  g = pass(g);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Rebuttal') });
  g = drive(g, ['first', 'yes', 'yes'], x => x.pending?.kind === 'chooseTargets');
  expectPending(g, 'chooseTargets', P0);
  const ids = (g.pending!.options ?? []).map(o => o.id).sort();
  assert.ok(/friendly/i.test(g.pending!.prompt) ? ids.every(i => [c, d].includes(i)) : ids.every(i => [a, b].includes(i)), `first new choice is restricted by the new controller: ${g.pending!.prompt}`);
});

test('RJ#11718 Mask of Foresight: a Sprite swapped in (Smoke and Mirrors) defends alone and gets +1 before Lillia\'s Sprite is created', () => {
  let g = withTokens(S0({ tp: P1 })); fundAll(g, P0); fundAll(g, P1);
  const l = put(g, P0, 'Lillia, Fae Fawn', BF_A); control(g, BF_A, P0);
  const s1 = put(g, P0, 'Sprite', 'base', { token: true });
  put(g, P0, 'Mask of Foresight', 'base');
  const sm = hand(g, P0, 'Smoke and Mirrors');
  const atk = put(g, P1, 'V(6)', 'base');
  g = move(g, P1, [atk], BF_A);
  g = drive(g, [], x => x.pending?.kind === 'showdownAction' && x.pending.player === P0 && x.chain.length === 0);
  assert.equal(mightOf(g, l), 4, 'Lillia defended alone: +1');
  g = act(g, { type: 'playCard', player: P0, obj: sm });
  g = drive(g, [[l], [s1]], x => x.pending?.kind === 'showdownAction' && x.chain.length === 0);
  assert.equal(locOf(g, s1), BF_A); assert.equal(locOf(g, l), 'base');
  assert.equal(unitsNamed(g, 'Sprite').filter(id => locOf(g, id) === BF_A).length, 2, "Lillia's Sprite was played at BF-A");
  assert.equal(mightOf(g, s1), 4, 'the swapped-in Sprite got +1 (it was alone when it became a defender)');
});

test('RJ#11719 Flurry of Feathers Birds can still enter a battlefield whose only unit was bounced by Gust in response', () => {
  let g = withTokens(S0()); fundAll(g, P0); fundAll(g, P1);
  put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Flurry of Feathers') });
  g = pass(g);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Gust') });
  g = drive(g, [], x => x.pending?.kind === 'chooseDestination');
  assert.ok(optionIdsOf(g).includes(String(BF_A)), 'BF-A offered (still controlled)');
  g = drive(g, [String(BF_A), String(BF_A), String(BF_A), String(BF_A)]);
  assert.equal(unitsNamed(g, 'Bird').filter(id => locOf(g, id) === BF_A).length, 4);
});
const optionIdsOf = (g: import('../conformance/harness.ts').GameState) => (g.pending?.options ?? []).map(o => o.id);

test('RJ#11720 Vex, Apathetic (at any battlefield) still stuns Rengar played in response to the Faefolk trigger that would move her (RJ said no stun: card says "while I\'m at a battlefield")', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const vex = put(g, P1, 'Vex, Apathetic', BF_B);
  const f = put(g, P0, 'Irresistible Faefolk', 'base');
  const r = hand(g, P0, 'Rengar, Trophy Hunter');
  g = move(g, P0, [f], BF_A);
  g = drive(g, [[vex], 'yes'], x => x.pending?.kind === 'chainResponse' && x.chain.some(c => /Faefolk/.test(chainLabels(x).join())));
  expectPending(g, 'chainResponse', P0);
  g = act(g, { type: 'playCard', player: P0, obj: r, destination: BF_A });
  g = drive(g, [], x => x.chain.length === 0 || x.pending?.kind !== 'chainResponse');
  g = drive(g, [], x => !x.chain.some(c => /Vex/.test(g.objects[c.source] ? g.cards[g.objects[c.source].cardId].name : '')) && x.objects[r].stunned === true);
  assert.equal(g.objects[r].stunned, true, 'Rengar stunned');
});

test('RJ#11721 Rengar, Trophy Hunter ambushed in response to your own Faefolk trigger (Vex at a battlefield) is stunned', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const vex = put(g, P1, 'Vex, Apathetic', BF_B);
  const f = put(g, P0, 'Irresistible Faefolk', 'base');
  const r = hand(g, P0, 'Rengar, Trophy Hunter');
  g = move(g, P0, [f], BF_A);
  g = drive(g, [[vex], 'yes'], x => x.pending?.kind === 'chainResponse');
  assert.ok(canPlayNow(g, P0, r, BF_A), 'legal Ambush play to BF-A');
  g = act(g, { type: 'playCard', player: P0, obj: r, destination: BF_A });
  g = drive(g, [], x => x.objects[r].stunned === true || x.pending?.kind === 'assignDamage' || x.pending?.kind === 'mainAction');
  assert.equal(g.objects[r].stunned, true);
});

function melDefy(tp = P1) {
  const g = S0({ tp }); fundAll(g, P0); fundAll(g, P1);
  put(g, P1, 'Mel, Newly Awakened', 'base');
  const mel = g.players[1].base[g.players[1].base.length - 1]; g.objects[mel].empowered = 3;
  return { g, mel };
}
test('RJ#11722 Defy can be played against an empowered Mel player\'s spell but does not counter it', () => {
  let { g } = melDefy();
  const u = put(g, P1, 'V(2)', 'base');
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Cleave') });
  g = drive(g, [[u]], x => x.pending?.kind === 'chainResponse'); g = pass(g);
  const defy = hand(g, P0, 'Defy');
  assert.ok(canPlayNow(g, P0, defy), 'Defy is playable');
  g = drive(act(g, { type: 'playCard', player: P0, obj: defy }), ['first']);
  assert.ok(hasKeyword(g, u, 'Assault'), 'Cleave resolved (not countered)');
});

test('RJ#11723 a Defy that did nothing (empowered Mel) still counts as a played spell for Abandoned Hall', () => {
  let { g } = melDefy();
  setBattlefieldCard(g, BF_A, 'Abandoned Hall');
  const mine = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const u = put(g, P1, 'V(2)', 'base');
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Cleave') });
  g = drive(g, [[u]], x => x.pending?.kind === 'chainResponse'); g = pass(g);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Defy') });
  g = drive(g, ['first', 'yes', [mine]], x => x.pending?.kind === 'mainAction');
  assert.ok(g.log.some(l => /Resolving Abandoned Hall/.test(l.text)), 'Abandoned Hall triggered for Defy');
  assert.equal(mightOf(g, mine), 3, '+1 from Abandoned Hall');
});

test('RJ#11724 Minefield conquer trigger still trashes 2 even if Green Father replaces it with a Brush', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  setBattlefieldCard(g, BF_A, 'Minefield');
  setLegend(g, P0, 'Green Father');
  const u = put(g, P0, 'V(2)', 'base');
  const n = g.players[0].trash.length;
  g = move(g, P0, [u], BF_A);
  g = drive(g, [/Green Father|Minefield/, 'yes', 'yes', 'yes'], x => x.pending?.kind === 'mainAction');
  assert.equal(g.cards[g.objects[g.battlefields[BF_A].objId].cardId].name, 'Brush', 'replaced by Brush');
  assert.equal(g.players[0].trash.length, n + 2, 'top 2 trashed');
});

test('RJ#11725 Not So Fast can counter Janna, Savior\'s play trigger only if it chose a friendly unit', () => {
  const run = (choose: boolean) => {
    let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
    const mine = put(g, P0, 'V(2)', BF_A); put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
    const nsf = hand(g, P0, 'Not So Fast');
    g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Janna, Savior'), destination: BF_A });
    g = drive(g, choose ? [[mine]] : [[]], x => x.pending?.kind === 'chainResponse' && x.chain.length > 0);
    if (g.pending?.player === P1) g = pass(g);
    return canPlayNow(g, P0, nsf);
  };
  assert.equal(run(true), true, 'chose my unit: Not So Fast legal');
  assert.equal(run(false), false, 'chose zero units: no legal target');
});

test('RJ#11726 Mirror Image whose target is Retreated still plays a 0-Might Reflection', () => {
  let g = withTokens(S0({ tp: P1 })); fundAll(g, P0); fundAll(g, P1);
  const mine = put(g, P0, 'V(3)', 'base');
  const before = new Set(Object.keys(g.objects));
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Mirror Image') });
  g = drive(g, [[mine]], x => x.pending?.kind === 'chainResponse'); g = pass(g);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Retreat') }), [[mine]]);
  assert.equal(zone(g, mine), 'hand');
  const refl = Object.keys(g.objects).filter(id => !before.has(id) && g.objects[id].isToken && g.objects[id].zone === 'base' && g.objects[id].controller === P1);
  assert.equal(refl.length, 1, 'Reflection token entered P1 base');
  assert.equal(mightOf(g, refl[0]), 0);
});

test('RJ#11727 Jhin legend (Virtuoso) does not trigger for a 4-cost spell reduced to 3 by Applied Researchers', () => {
  const run = (empowered: boolean) => {
    let g = S0(); fundAll(g, P0);
    setLegend(g, P0, 'Virtuoso');
    const ar = put(g, P0, 'Applied Researchers', 'base'); if (empowered) g.objects[ar].empowered = 3;
    const u = put(g, P0, 'V(2)', 'base');
    g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Onslaught') });
    return drive(g, [[u]], x => x.pending?.kind === 'optional' || x.pending?.kind === 'mainAction');
  };
  assert.equal(run(false).pending?.kind, 'optional', 'control: spent 4 -> Virtuoso offers banish');
  assert.equal(run(true).pending?.kind, 'mainAction', 'spent 3 -> no Virtuoso trigger');
});

test('RJ#11728 Ruined Rex Deathknell choosing a Deflect unit: if the Deflect [A] is not paid the ability does nothing', () => {
  let g = S0(); setRunes(g, P0, 0);
  put(g, P0, 'Ruined Rex', BF_A, { damage: 6 }); control(g, BF_A, P0);
  put(g, P0, 'V(1)', BF_A);
  const v = put(g, P1, 'Vex, Apathetic', 'base');
  const m = put(g, P0, 'V(1)', 'base');
  g = drive(move(g, P0, [m], BF_B));
  assert.equal(zone(g, v), 'base');
  assert.equal(g.objects[v].damage, 0, 'no damage: Deflect cost unpaid');
});

test('RJ#11729 Astral Heron\'s "if I\'m at a battlefield" is checked when the first card is played: Star Spring moving Heron to base first does not cancel the discount', () => {
  let g = S0(); fundAll(g, P0);
  setBattlefieldCard(g, BF_A, 'Star Spring');
  const h = put(g, P0, 'Astral Heron', BF_A); control(g, BF_A, P0);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'V(2)'), destination: BF_A });
  g = drive(g, [/Astral Heron/, [h]]);    // Heron's trigger first (resolves last); Star Spring moves Heron to base
  assert.equal(locOf(g, h), 'base');
  const c = hand(g, P0, 'Astral Heron');
  assert.equal(playCostOf(g, P0, c)!.energy, 5, 'discount still granted');
});

test('RJ#11730 Viktor, Leader dying at the same time as other friendly units does not make Recruits', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  const vk = put(g, P0, 'Viktor, Leader', BF_A, { damage: 3 }); put(g, P0, 'V(1)', BF_A); put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Flurry of Blades') }));
  assert.equal(zone(g, vk), 'trash');
  assert.equal(unitsNamed(g, 'Recruit').length, 0);
});

test('RJ#11731 Temporal Breach on your only unit at a battlefield keeps control; an enemy Rengar, Trophy Hunter can ambush there (Pouncing cannot)', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const rt = hand(g, P1, 'Rengar, Trophy Hunter'), rp = hand(g, P1, 'Rengar, Pouncing');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Temporal Breach') }), [[u]]);
  assert.equal(locOf(g, u), BF_A); assert.equal(g.battlefields[BF_A].controller, P0, 'control kept');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Cleave') });
  g = drive(g, [[u]], x => x.pending?.kind === 'chainResponse'); g = pass(g);
  expectPending(g, 'chainResponse', P1);
  assert.equal(canPlayNow(g, P1, rp, BF_A), false, 'Pouncing: P1 is not attacking BF-A');
  assert.equal(canPlayNow(g, P1, rt, BF_A), true, 'Trophy Hunter ambushes (enemy units there)');
  g = drive(act(g, { type: 'playCard', player: P1, obj: rt, destination: BF_A }), [], x => !!x.showdown?.isCombat);
  assert.equal(g.showdown!.attacker, P1, 'Rengar\'s controller is the attacker');
});

test('RJ#11732 Star-Crossed in response to Baited Hook returns the unit to be killed: no kill, no unit played', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const hook = put(g, P1, 'Baited Hook', 'base');
  const f = put(g, P1, 'V(2)', 'base');
  const mine = put(g, P0, 'V(1)', 'base');
  for (let i = 0; i < 5; i++) put(g, P1, 'V(3)', 'deckTop');
  const a = legal(g, P1, 'activate').find(x => x.type === 'activate' && x.obj === hook)!;
  assert.ok(a, 'Baited Hook can be activated');
  g = drive(act(g, a), [[f]], x => x.pending?.kind === 'chainResponse'); if (g.pending?.player === P1) g = pass(g);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Star-Crossed') }), [[mine], [f]], x => x.pending?.kind === 'mainAction' || (x.pending?.inStep === true && x.pending.player === P1));
  g = drive(g, ['first', 'first', 'first']);
  assert.equal(zone(g, f), 'hand', 'returned, not killed');
  assert.equal(g.players[1].base.filter(id => g.cards[g.objects[id].cardId]?.name === 'V(3)').length, 0, 'no unit played');
});

test('RJ#11733 Irresistible Faefolk bounced by Gust in response: its trigger still moves the enemy unit to that battlefield', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const e = put(g, P1, 'V(2)', 'base');
  const f = put(g, P0, 'Irresistible Faefolk', 'base');
  g = move(g, P0, [f], BF_A);
  g = drive(g, [[e]], x => x.pending?.kind === 'chainResponse' && x.pending.player === P1);
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Gust') }), [[f]], x => x.chain.length === 1 && x.pending?.kind === 'chainResponse');
  assert.equal(zone(g, f), 'hand');
  g = drive(g, [], x => x.chain.length === 0);
  assert.equal(locOf(g, e), BF_A, 'enemy moved to the locked-in battlefield');
});

function nashorMighty() {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'Baron Nashor', 'base');
  put(g, P0, 'MightyWatch', 'base');
  const h0 = g.players[0].hand.length;
  const u = hand(g, P0, 'V(3)');
  g = drive(act(g, { type: 'playCard', player: P0, obj: u, destination: 'base' }));
  return { g, u, drew: g.players[0].hand.length - h0 };
}
test('RJ#11734 a 3-Might unit played while you control Baron Nashor enters at 5 and never "becomes Mighty"', () => {
  const { g, u, drew } = nashorMighty();
  assert.equal(mightOf(g, u), 5); assert.equal(drew, 0);
});
test('RJ#11735 (dup of 11734) Baron Nashor: unit enters Mighty, no "becomes Mighty" trigger', () => {
  const { drew } = nashorMighty(); assert.equal(drew, 0);
});

test('RJ#11736 a battlefield held on a previous turn does not count for the final point when you conquer on the opponent\'s turn: draw instead', () => {
  let g = S0({ tp: P1 });
  g.players[0].points = 7;
  put(g, P0, 'V(2)', BF_B); control(g, BF_B, P0);
  const v4 = hand(g, P0, 'V(4)');
  const dr = hand(g, P0, 'DropR');
  const atk = put(g, P1, 'V(2)', 'base');
  g = move(g, P1, [atk], BF_A);
  g = pass(g);
  g = play(g, P0, dr);
  g = passN(g, 2);
  g = answer(g, { cards: [[v4]], battlefields: [BF_A] }, P0);
  const h0 = g.players[0].hand.length;
  g = drive(g, [], x => x.pending?.kind === 'mainAction');
  assert.equal(g.battlefields[BF_A].controller, P0, 'P0 conquered BF-A');
  assert.equal(g.players[0].points, 7, 'no 8th point');
  assert.equal(g.players[0].hand.length, h0 + 1, 'drew instead');
  assert.equal(g.winner, null);
});

// SCRIPT-FIX: answers fixed — the battlefield (only one where P0 has units) is auto-chosen, then the enemy unit to move
function melMoonfall() {
  let g = S0(); fundAll(g, P0);
  const mel = put(g, P0, 'Mel, Newly Awakened', BF_A); g.objects[mel].empowered = 3; control(g, BF_A, P0);
  const moved = put(g, P1, 'V(5)', 'base');
  const other = put(g, P1, 'V(5)', BF_A, { controller: P1 });
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Moonfall') }), [[moved]], x => x.pending?.kind === 'mainAction' || x.pending?.kind === 'assignDamage');
  return { g, moved, other };
}
const MEL_TODO = 'empowered Mel, Newly Awakened\'s extra -1 [S] is not implemented (see tests/cards/B1/empower.test.ts ven-069 todo)';
test('RJ#11737 Moonfall with empowered Mel: the chosen (moved) unit gets -3, other enemy units there -2', () => {
  const { g, moved, other } = melMoonfall();
  assert.equal(mightOf(g, moved), 2); assert.equal(mightOf(g, other), 3);
});
test('RJ#11740 (dup of 11737) Moonfall + empowered Mel: chosen unit -3, others -2', () => {
  const { g, moved } = melMoonfall(); assert.equal(mightOf(g, moved), 2);
});
test('RJ#11741 Stupefy with empowered Mel: -2 instead of -1 but still to a minimum of 1 (2-Might unit -> 1)', () => {
  let g = S0(); fundAll(g, P0);
  const mel = put(g, P0, 'Mel, Newly Awakened', 'base'); g.objects[mel].empowered = 3;
  const a = put(g, P1, 'V(2)', 'base'), b = put(g, P1, 'V(4)', 'base');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Stupefy') }), [[a]]);
  assert.equal(mightOf(g, a), 1, 'minimum 1');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Stupefy') }), [[b]]);
  assert.equal(mightOf(g, b), 2, '-2 with Mel');
});

test('RJ#11742 Abandon on a spell of an empowered Mel player: it cannot counter, the spell resolves and goes to the trash (not to hand)', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const mel = put(g, P0, 'Mel, Newly Awakened', 'base'); g.objects[mel].empowered = 3;
  const u = put(g, P0, 'V(2)', 'base');
  const cl = hand(g, P0, 'Cleave');
  g = drive(act(g, { type: 'playCard', player: P0, obj: cl }), [[u]], x => x.pending?.kind === 'chainResponse'); g = pass(g);
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Abandon') }), ['first', 'no', 'no']);
  assert.ok(hasKeyword(g, u, 'Assault'), 'Cleave resolved');
  assert.equal(zone(g, cl), 'trash');
});

test('RJ#11743 Rebuttal on an empowered Mel player\'s Abandon: paying [A] still gains control (not a counter); not paying does not counter it', () => {
  const run = (pay: boolean) => {
    let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
    const mel = put(g, P0, 'Mel, Newly Awakened', 'base'); g.objects[mel].empowered = 3;
    const u = put(g, P1, 'V(2)', 'base');
    const cl = hand(g, P1, 'Cleave');
    g = drive(act(g, { type: 'playCard', player: P1, obj: cl }), [[u]], x => x.pending?.kind === 'chainResponse'); g = pass(g);
    const ab = hand(g, P0, 'Abandon');
    g = drive(act(g, { type: 'playCard', player: P0, obj: ab }), [], x => x.pending?.kind === 'chainResponse'); if (g.pending?.player === P0) g = pass(g);
    g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Rebuttal') });
    if (g.pending?.kind === 'chooseTargets') g = ans(g, /Abandon/);
    g = drive(g, [], x => x.pending?.kind === 'optional' && /Rebuttal/.test(x.pending.prompt));
    g = drive(g, pay ? ['yes', 'no'] : ['no'], x => x.chain.length <= 2);
    return { g, ab };
  };
  const paid = run(true);
  assert.equal(paid.g.chain.find(c => c.source === paid.ab)?.controller, P1, 'paid: P1 controls Abandon');
  const unpaid = run(false);
  assert.ok(unpaid.g.chain.some(c => c.source === unpaid.ab), 'unpaid: Abandon not countered');
});

const EQUIP = 900;
test('RJ#11745 Shady Spectacles copying an Empowered unit: the equipped (unempowered) unit is not Empowered', () => {
  let g = S0(); fundAll(g, P0);
  const bh = put(g, P0, 'Brutal Hunter', 'base'); g.objects[bh].empowered = 1;
  const u = put(g, P0, 'V(1)', 'base');
  const sp = put(g, P0, 'Shady Spectacles', 'base');
  g = drive(act(g, { type: 'activate', player: P0, obj: sp, abilityIndex: EQUIP }), [[u], [bh]]);
  assert.equal(g.objects[sp].attachedTo, u);
  assert.equal(nameOf(g, u) ?? '', 'V(1)', 'card name of the object is unchanged in state');
  assert.equal(mightOf(g, bh), 6, 'real Brutal Hunter: 4 +2 empowered');
  assert.equal(mightOf(g, u), 4, 'copy: 4 Might, no Empowered bonus');
  assert.equal(hasKeyword(g, u, 'Ganking'), false);
});

test('RJ#11749 Hwei discards Patched Porobot (Unit Gear): both the Gear and the Unit instructions happen', () => {
  let g = S0(); fundAll(g, P0);
  const h = put(g, P0, 'Hwei, Brooding Painter', 'base');
  const pb = put(g, P0, 'Patched Porobot', 'deckTop');
  const ex = g.players[0].runesInPlay.slice(0, 2);
  for (const r of ex) g.objects[r].exhausted = true;
  g = move(g, P0, [h], BF_A);
  // SCRIPT-FIX: answer the Gear branch's "ready up to 2 runes" choice (both exhausted runes)
  g = drive(g, [ex], x => x.pending?.kind === 'mainAction' || x.pending?.kind === 'showdownAction');
  assert.equal(zone(g, pb), 'trash', 'Porobot discarded');
  assert.equal(mightOf(g, h), 8, 'Unit: +3');
  assert.equal(g.players[0].runesInPlay.filter(r => g.objects[r].exhausted).length, 0, 'Gear: readied up to 2 runes');
});

test('RJ#11750 Crumbling Sands can counter the first of two spells an opponent played in succession', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P0, 'V(2)', 'base');
  const cl = hand(g, P0, 'Cleave');
  g = drive(act(g, { type: 'playCard', player: P0, obj: cl }), [[u]], x => x.pending?.kind === 'chainResponse');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Stupefy') }), [[u]], x => x.pending?.kind === 'chainResponse');
  g = pass(g);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Crumbling Sands') });
  if (g.pending?.kind === 'chooseTargets') g = ans(g, /Cleave/);
  g = drive(g);
  assert.equal(hasKeyword(g, u, 'Assault'), false, 'Cleave countered');
  assert.equal(zone(g, cl), 'trash');
});

test('RJ#11751 Fallen Feline: opponents may respond before the name is chosen; afterwards spells with that name cannot be played', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const ff = hand(g, P0, 'Fallen Feline');
  const st1 = hand(g, P1, 'Stupefy'), st2 = hand(g, P1, 'Stupefy');
  g = drive(act(g, { type: 'playCard', player: P0, obj: ff, destination: BF_A }), [], x => x.pending?.kind === 'chainResponse' && x.pending.player === P1);
  assert.ok(canPlayNow(g, P1, st1), 'Stupefy playable in response to the play trigger');
  g = pass(g);
  g = drive(g, [/Stupefy/], x => x.chain.length === 0);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Cleave') });
  g = drive(g, ['first'], x => x.pending?.kind === 'chainResponse' && x.pending.player === P1);
  assert.equal(canPlayNow(g, P1, st2), false, 'named spell cannot be played');
});

test('RJ#11755 Rebuttal (paid) on an opponent\'s Stupefy: the Rebuttal player\'s Ravenbloom Student triggers twice', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const rs = put(g, P1, 'Ravenbloom Student', 'base');
  const t = put(g, P0, 'V(4)', 'base');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Stupefy') }), [[t]], x => x.pending?.kind === 'chainResponse'); g = pass(g);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Rebuttal') });
  g = drive(g, ['yes', 'no']);
  assert.equal(mightOf(g, rs), 4, 'Student: +1 for Rebuttal, +1 for the stolen Stupefy');
});

test('RJ#11760 Akali, Deadly Weapon\'s move trigger still deals its damage after she is killed in response (Hidden Blade)', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const hb = put(g, P1, 'Hidden Blade', { facedown: BF_A });
  const ak = put(g, P0, 'Akali, Deadly Weapon', 'base');
  g = move(g, P0, [ak], BF_A);
  g = drive(g, ['yes', [e]], x => x.pending?.kind === 'chainResponse' && x.pending.player === P1 && x.chain.length > 0);
  g = act(g, { type: 'playCard', player: P1, obj: hb });
  g = drive(g, [[ak]], x => x.pending?.kind === 'chainResponse');
  g = drive(g, [], x => zone(x, ak) === 'trash' && x.chain.length === 1 && x.pending?.kind === 'chainResponse');
  assert.equal(zone(g, ak), 'trash', 'Akali killed in response');
  g = drive(g, [], x => x.chain.length === 0);
  assert.equal(g.objects[e].damage, 1, 'trigger still dealt 1');
});

test('RJ#11762 Astral Heron discounts the next card played after its ability resolves (not a card played in response)', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'Astral Heron', BF_A); control(g, BF_A, P0);
  const st = hand(g, P0, 'Stupefy');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'V(1)'), destination: 'base' });
  g = drive(g, [], x => x.pending?.kind === 'chainResponse' && x.chain.length > 0);
  assert.equal(playCostOf(g, P0, st)!.energy, 1, 'while Heron\'s trigger is on the chain: full cost');
  g = drive(g, [], x => x.chain.length === 0);
  assert.equal(playCostOf(g, P0, st)!.energy, 0, 'after it resolves: discounted');
});

test('RJ#11765 Profiteer can disempower your own legend (Matriarch of War) to empower Kayle', () => {
  let g = S0(); fundAll(g, P0);
  const leg = setLegend(g, P0, 'Matriarch of War'); g.objects[leg].empowered = 1;
  const k = put(g, P0, 'Kayle, Justified', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Profiteer'), destination: 'base' });
  g = drive(g, ['yes', [k]]);   // the disempowered object (Matriarch, the only Empowered thing) is auto-chosen
  assert.ok(g.log.some(l => /Disempower something you control: Matriarch of War/.test(l.text)), 'legend chosen and disempowered');
  // (Matriarch then re-empowers itself: "When you empower something else, empower me")
  assert.equal(g.objects[k].empowered, 1, 'Kayle empowered');
});

test('RJ#11746 Akshan, Mischievous steals an equipped Shady Spectacles: the old unit loses the copy; Akshan copies Aphelios; no Aphelios attach trigger', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const x = put(g, P1, 'V(1)', 'base'), y = put(g, P1, 'V(5)', 'base');
  const sp = put(g, P1, 'Shady Spectacles', 'base');
  g = drive(act(g, { type: 'activate', player: P1, obj: sp, abilityIndex: EQUIP }), [[x]]);   // copy target y auto-chosen
  assert.equal(mightOf(g, x), 5, 'x is a copy of the 5-Might unit');
  g = nextTurn(g); fundAll(g, P0);
  const aph = put(g, P0, 'Aphelios, Exalted', 'base');
  const ak = hand(g, P0, 'Akshan, Mischievous');
  const runes0 = g.players[0].runesInPlay.length;
  g = act(g, { type: 'playCard', player: P0, obj: ak, destination: 'base' });
  g = drive(g, ['yes', /take an enemy gear/], x2 => x2.pending?.kind === 'mainAction');
  assert.equal(g.objects[sp].controller, P0, 'Akshan controls the Spectacles');
  assert.equal(g.objects[sp].attachedTo, ak, 'attached to Akshan');
  assert.equal(mightOf(g, x), 1, 'old unit lost the copy effect');
  assert.equal(chars(g, ak).name, 'Aphelios', 'Akshan is a copy of Aphelios');
  assert.ok(!g.log.some(l => /Resolving Aphelios/.test(l.text)), 'no Aphelios attach trigger');
  void runes0;
});

test('RJ#11747 a token copying Azir, Ascendant via Shady Spectacles can use the copied once-per-turn ability again after the Spectacles is detached and re-attached (new instance)', () => {
  let g = S0(); fundAll(g, P0);
  const s = put(g, P0, 'V(2)', 'base', { token: true });
  const a = put(g, P0, 'Azir, Ascendant', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(9)', 'base');
  const sp = put(g, P0, 'Shady Spectacles', 'base');
  g = drive(act(g, { type: 'activate', player: P0, obj: sp, abilityIndex: EQUIP }), [[s]]);
  const ab = legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === s);
  assert.ok(ab, 'copied Azir ability available');
  g = drive(act(g, ab!), [[a]]);
  assert.equal(locOf(g, s), BF_A, 'swapped');
  assert.ok(!legal(g, P0, 'activate').some(x => x.type === 'activate' && x.obj === s), 'once per turn');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Strike Down') }), [[s], [e]]);
  assert.equal(g.objects[sp].attachedTo, undefined, 'detached');
  const eq = legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === sp)!;
  g = drive(act(g, eq), [[s]]);
  assert.equal(g.objects[sp].attachedTo, s, 're-attached as a new Azir copy');
  assert.ok(legal(g, P0, 'activate').some(x => x.type === 'activate' && x.obj === s), 'new instance: usable again');
});

test('RJ#11768 Renekton, Brute at 11 Might changed by Stupefy/Profiteer does not "become 10 or more"', () => {
  // covered by T183 — Renekton, Brute needs a change to 10+ (VEN-FAQ #30); real-card check with Stupefy:
  let g = S0(); fundAll(g, P0);
  const r = put(g, P0, 'Renekton, Brute', 'base'); mod(g, r, { might: 11 - (mightOf(g, r) ?? 0) });
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Stupefy') }), [[r]]);
  assert.equal(mightOf(g, r), 10);
  assert.ok(!g.objects[r].empowered, 'not empowered');
  assert.ok(!g.log.some(l => /Trigger: Renekton/.test(l.text)), 'no Renekton trigger');
});

test('RJ#11769 Heisho: a spell choosing a unit here ignores Deflect entirely, also for its other choices (Icathian Rain on Irelia, Fervent in base)', () => {
  let g = S0(); fundAll(g, P0);
  setBattlefieldCard(g, BF_A, 'Heisho, Shell of the World');
  const r = put(g, P1, 'V(1)', BF_A, { token: true }); control(g, BF_A, P1);
  const ir = put(g, P1, 'Irelia, Fervent', 'base');
  const n0 = g.players[0].runesInPlay.length;
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, "Icathian Rain, Kai'Sa") });
  g = ans(g, [r], [ir], [ir], [ir], [ir], [ir]);
  assert.equal(n0 - g.players[0].runesInPlay.length, 3, 'only the printed 3 power paid (no Deflect)');
});

test('RJ#11770 Imperial Decree\'s delayed kill counts as killing with a spell: Immortal Phoenix may be played from the trash', () => {
  let g = S0(); fundAll(g, P0);
  const ed = put(g, P1, 'Elder Dragon', BF_A); control(g, BF_A, P1);
  const ph = put(g, P0, 'Immortal Phoenix', 'trash');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Imperial Decree') }));
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Hextech Ray') }), [[ed]], x => x.pending?.kind === 'optional' || x.pending?.kind === 'mainAction');
  assert.equal(zone(g, ed), 'trash', 'Elder Dragon killed by the Decree');
  expectPending(g, 'optional', P0, 'Phoenix offers to be played');
  g = drive(g, ['yes', 'base']);
  assert.equal(zone(g, ph), 'base');
});

test('RJ#11772 Sigil of the Storm: the conquer recycle neither costs nor adds Power', () => {
  let g = S0();
  setBattlefieldCard(g, BF_A, 'Sigil of the Storm');
  const u = put(g, P0, 'V(1)', 'base');
  const n0 = g.players[0].runesInPlay.length;
  g = drive(move(g, P0, [u], BF_A), ['first']);
  assert.equal(g.players[0].runesInPlay.length, n0 - 1, 'one rune recycled');
  const pool = g.players[0].pool;
  assert.equal(Object.values(pool.power ?? {}).reduce((s: number, v) => s + Number(v), 0), 0, 'no Power added to the pool');
});

test('RJ#11773 Temporal Breach on Thousand-Tailed Watcher in response to Harnessed Dragon\'s kill: Dragon gets -3, the kill mistargets the replayed Watcher', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const w = put(g, P0, 'Thousand-Tailed Watcher', BF_A); control(g, BF_A, P0);
  const tb = put(g, P0, 'Temporal Breach', { facedown: BF_A });
  const hd = hand(g, P1, 'Harnessed Dragon');
  g = act(g, { type: 'playCard', player: P1, obj: hd, destination: 'base' });
  g = drive(g, [], x => x.pending?.kind === 'chainResponse' && x.pending.player === P0);   // kill target auto (only enemy unit)
  g = act(g, { type: 'playCard', player: P0, obj: tb });
  g = drive(g, ['no'], x => x.pending?.kind === 'mainAction');                              // decline Accelerate on the replay
  assert.equal(locOf(g, w), BF_A, 'Watcher survives (old target gone)');
  assert.equal(mightOf(g, hd), 3, 'Harnessed Dragon 6 -3');
});

test('RJ#11775 Elder Dragon entering kills an enemy unit already damaged by its controller (any amount of your damage is lethal)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1);
  const u = put(g, P0, 'V(5)', BF_A); control(g, BF_A, P0);
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Hextech Ray') }), [[u]]);
  assert.equal(g.objects[u].damage, 3); assert.equal(zone(g, u), 'battlefield');
  fundAll(g, P1);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Elder Dragon'), destination: 'base' });
  assert.equal(zone(g, u), 'trash', 'dies as soon as the Dragon is on the board (before its play trigger)');
});

test('RJ#11777 Brynhir replayed by Temporal Breach: opponents may still Ambush Vi while its play trigger is on the chain, not after it resolves', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const b = put(g, P1, 'Brynhir Thundersong', 'base');
  const mine = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const vi = hand(g, P0, 'Vi, Peacekeeper');
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Temporal Breach') });
  g = drive(g, [[b]], x => x.chain.some(c => c.kind === 'trigger') && x.pending?.kind === 'chainResponse' && x.pending.player === P0);
  assert.ok(canPlayNow(g, P0, vi, BF_A), 'trigger on the chain: Vi can be ambushed');
  g = drive(g, [], x => x.chain.length === 0);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Cleave') });
  g = drive(g, [[b]], x => x.pending?.kind === 'chainResponse' && x.pending.player === P0);
  assert.equal(canPlayNow(g, P0, vi, BF_A), false, 'after it resolved: opponents can\'t play cards');
  void mine;
});

test('RJ#11779 leaving a held battlefield then moving a unit back in starts a non-combat showdown but scores nothing again', () => {
  let g = S0();
  const a = put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  g.battlefields[BF_A].scoredThisTurnBy = [P0]; g.players[0].points = 1;   // held this turn
  const b = put(g, P0, 'V(1)', 'base');
  g = drive(move(g, P0, [a], 'base'));
  assert.equal(g.battlefields[BF_A].controller, null, 'control lost');
  g = move(g, P0, [b], BF_A);
  assert.ok(g.showdown && !g.showdown.isCombat, 'non-combat showdown');
  g = drive(g);
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[0].points, 1, 'no second score');
});

test('RJ#11780 Stellacorn Herder moved into a battlefield you just left (showdown), then moved back by the Rogue Assassin legend: draws twice', () => {
  let g = S0(); fundAll(g, P0);
  const leg = setLegend(g, P0, 'Rogue Assassin');
  const a = put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const h = put(g, P0, 'Stellacorn Herder', 'base');
  g = drive(move(g, P0, [a], 'base'));
  const h0 = g.players[0].hand.length;
  g = drive(move(g, P0, [h], BF_A), [], x => x.pending?.kind === 'showdownAction' && x.chain.length === 0);
  assert.equal(g.players[0].hand.length, h0 + 1, 'first draw');
  const ab = legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === leg);
  assert.ok(ab, 'legend Action ability usable in the showdown');
  g = drive(act(g, ab!), [[h]]);
  assert.equal(locOf(g, h), 'base');
  assert.equal(g.players[0].hand.length, h0 + 2, 'second draw');
  assert.equal(g.battlefields[BF_A].controller, null, 'battlefield left uncontrolled');
});

test('RJ#11781 Albus Ferros can spend the buff Cithria of Cloudfield gets from Albus being played (order Cithria to resolve first)', () => {
  let g = S0(); fundAll(g, P0);
  const c = put(g, P0, 'Cithria of Cloudfield', 'base');
  const n0 = g.players[0].runesInPlay.length;
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Albus Ferros'), destination: 'base' });
  g = drive(g, [/Albus/], x => x.pending?.kind === 'mainAction' || (x.pending?.inStep === true && x.pending.kind !== 'orderTriggers' && x.chain.length === 1));
  g = drive(g, [[c], 'yes', '1', 'first']);
  assert.equal(g.objects[c].counters.buff ?? 0, 0, 'buff spent');
  assert.equal(g.players[0].runesInPlay.length, n0 + 1, 'channelled 1 rune');
});

test('RJ#11782 Shadow Clone attacking twice in a turn (banishing each time) has Assault 8 on the second attack', () => {
  let g = S0();
  const c = place(g, P0, 'tok-shadow-clone', 'base', { token: true });
  fillTrash(g, P0, 2, 'V(1)');
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  g = drive(move(g, P0, [c], BF_A), ['yes', 'first'], x => x.pending?.kind === 'showdownAction' && x.chain.length === 0);
  assert.equal(kwValue(g, c, 'Assault'), 4, 'first combat: Assault 4');
  g = drive(g);
  assert.equal(locOf(g, c), BF_A, 'Clone won the first combat');
  g.objects[c].exhausted = false; g.timestamp++;          // setup: ready it, walk it home, ready again
  g = drive(move(g, P0, [c], 'base'));
  g.objects[c].exhausted = false; g.timestamp++;
  g = drive(move(g, P0, [c], BF_B), ['yes', 'first'], x => x.pending?.kind === 'showdownAction' && x.chain.length === 0);
  assert.equal(kwValue(g, c, 'Assault'), 8, 'second attack: Assault 4 + 4');
});

test('RJ#11783 Star-Crossed choosing your own unit at Heisho ignores Deflect on the enemy unit in its base', () => {
  let g = S0(); fundAll(g, P0);
  setBattlefieldCard(g, BF_A, 'Heisho, Shell of the World');
  const mine = put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const ir = put(g, P1, 'Irelia, Fervent', 'base');
  const n0 = g.players[0].runesInPlay.length;
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Star-Crossed') });
  g = drive(g, [[mine], [ir], 'yes'], x => x.pending?.kind === 'chainResponse');
  assert.equal(n0 - g.players[0].runesInPlay.length, 1, 'only the printed 1 power (no Deflect [A])');
});

test('RJ#11784 Profiteer can empower the same unit it disempowered', () => {
  let g = S0(); fundAll(g, P0);
  const bh = put(g, P0, 'Brutal Hunter', 'base'); g.objects[bh].empowered = 1;
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Profiteer'), destination: 'base' });
  g = drive(g, ['yes', [bh]]);
  assert.ok(g.log.some(l => /Disempower something you control: Brutal Hunter/.test(l.text)), 'disempowered Brutal Hunter');
  assert.equal(g.objects[bh].empowered, 1, 'and empowered it again');
});

test('RJ#11785 Blighted Battleaxe: no end-of-turn damage/unattach if the equipped unit conquered earlier this turn', () => {
  const run = (conquer: boolean) => {
    let g = S0();
    const u = put(g, P0, 'V(2)', 'base');
    const ax = put(g, P0, 'Blighted Battleaxe', 'base');
    attachNow(g, ax, u);
    if (conquer) { g = drive(move(g, P0, [u], BF_A)); assert.equal(g.battlefields[BF_A].controller, P0); }
    g = endTurn(g);
    g = drive(g, [], x => x.activePlayer === P1);
    return { g, ax, u };
  };
  const a = run(true);
  assert.equal(a.g.objects[a.ax].attachedTo, a.u, 'conquered: still attached');
  const b = run(false);
  assert.equal(b.g.objects[b.ax].attachedTo, undefined, 'control: did not conquer -> unattached');
});

test('RJ#11786 Shuriken Flip moves a friendly unit battlefield-to-battlefield without Ganking', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Shuriken Flip') });
  g = drive(g, [[u], String(BF_B)]);   // no enemy unit: the damage choice is skipped
  assert.equal(locOf(g, u), BF_B);
});

test('RJ#11787 moving Lillia alone off a battlefield with your hidden card: her Sprite arrives before control is lost, the hidden card stays', () => {
  let g = withTokens(S0());
  const l = put(g, P0, 'Lillia, Fae Fawn', BF_A); control(g, BF_A, P0);
  const fd = put(g, P0, 'V(1)', { facedown: BF_A });
  g = drive(move(g, P0, [l], 'base'));
  assert.equal(g.battlefields[BF_A].controller, P0, 'control kept');
  assert.equal(unitsNamed(g, 'Sprite').filter(id => locOf(g, id) === BF_A).length, 1);
  assert.equal(zone(g, fd), 'facedown', 'hidden card kept');
});

test('RJ#11788 Diana, Lunari\'s showdown trigger still resolves after she is returned to hand by Gust', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const d = put(g, P0, 'Diana, Lunari', BF_A); control(g, BF_A, P0);
  put(g, P0, 'Stupefy', 'deckTop');
  const atk = put(g, P1, 'V(1)', 'base');
  g = move(g, P1, [atk], BF_A);
  g = drive(g, ['yes'], x => x.pending?.kind === 'chainResponse' && x.pending.player === P1);
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Gust') }), [[d]], x => x.chain.length === 1 && x.pending?.kind === 'chainResponse');
  assert.equal(zone(g, d), 'hand');
  const h0 = g.players[0].hand.length;
  g = drive(g, [[]], x => x.chain.length === 0);   // Predict: keep the card on top
  assert.ok(g.log.some(l => /Resolving Diana/.test(l.text)), 'trigger resolved');
  assert.equal(g.players[0].hand.length, h0 + 1, 'revealed spell drawn');
});

test('RJ#11789 Yasuo, Remorseful\'s attack damage stands after Rogue Assassin pulls him back to base mid-showdown (no retrigger)', () => {
  let g = S0(); fundAll(g, P0);
  const leg = setLegend(g, P0, 'Rogue Assassin');
  const e = put(g, P1, 'V(8)', BF_A); control(g, BF_A, P1);
  const y = put(g, P0, 'Yasuo, Remorseful', 'base');
  g = drive(move(g, P0, [y], BF_A), [], x => x.pending?.kind === 'showdownAction' && x.chain.length === 0);
  assert.equal(g.objects[e].damage, 6, 'attack trigger: 6 damage');
  const ab = legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === leg)!;
  g = drive(act(g, ab), [[y]], x => x.chain.length === 0);
  assert.equal(locOf(g, y), 'base');
  assert.equal(g.objects[e].damage, 6, 'damage stands; nothing retriggered');
  assert.equal(g.log.filter(l => /^Trigger: Yasuo/.test(l.text)).length, 1);
});

test('RJ#11790 Nocturne, Horrifying milled from the top of the deck (Minefield) is not looked at/revealed: goes to trash, no play option', () => {
  let g = S0(); fundAll(g, P0);
  setBattlefieldCard(g, BF_A, 'Minefield');
  const n = put(g, P0, 'Nocturne, Horrifying', 'deckTop');
  const u = put(g, P0, 'V(1)', 'base');
  g = drive(move(g, P0, [u], BF_A), [], x => x.pending?.kind === 'mainAction' || x.pending?.kind === 'optional');
  assert.equal(g.pending?.kind, 'mainAction', 'no Nocturne prompt');
  assert.equal(zone(g, n), 'trash');
});

test('RJ#11791 Zhonya\'s Hourglass revealed from hiding in response to Singularity ends in the trash (it replaces the death), not in base', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const z = put(g, P0, "Zhonya's Hourglass", { facedown: BF_A });
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Singularity') });
  g = drive(g, [[u]], x => x.pending?.kind === 'chainResponse' && x.pending.player === P0);
  g = drive(act(g, { type: 'playCard', player: P0, obj: z }), [], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, z), 'trash', 'Zhonya\'s killed itself instead');
  assert.equal(locOf(g, u), 'base', 'unit healed and recalled');
});

test('RJ#11792 Astral Heron\'s discount survives Heron dying after the first card was played', () => {
  let g = S0(); fundAll(g, P0);
  const h = put(g, P0, 'Astral Heron', BF_A); control(g, BF_A, P0);
  put(g, P0, 'V(1)', BF_A);
  const m = put(g, P0, 'V(1)', 'base');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'V(1)'), destination: 'base' }));
  g.objects[h].damage = 7; g.timestamp++;                 // Heron now has lethal damage
  g = drive(move(g, P0, [m], BF_B));                       // any action -> cleanup kills Heron
  assert.equal(zone(g, h), 'trash');
  const st = hand(g, P0, 'Stupefy');
  assert.equal(playCostOf(g, P0, st)!.energy, 0, 'next card still discounted');
});

test('RJ#11793 Promising Future: Acceptable Losses (played first by the next player) kills the Dazzling Aurora the opponent plays after it', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1);
  const au = put(g, P1, 'Dazzling Aurora', 'deckTop');
  const al = put(g, P0, 'Acceptable Losses', 'deckTop');
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Promising Future') });
  g = drive(g, [[au], [al]]);
  assert.ok(g.log.some(l => /P1 plays Dazzling Aurora/.test(l.text)), 'Aurora was played');
  assert.equal(zone(g, au), 'trash', 'killed by Acceptable Losses');
  assert.equal(zone(g, al), 'trash');
});

test('RJ#11794 Shady Spectacles can copy a unit that itself has Shady Spectacles attached (the gear is not copied)', () => {
  let g = S0(); fundAll(g, P0);
  const a = put(g, P0, 'V(1)', 'base'), b = put(g, P0, 'V(5)', 'base'), c = put(g, P0, 'V(2)', 'base');
  const s1 = put(g, P0, 'Shady Spectacles', 'base'), s2 = put(g, P0, 'Shady Spectacles', 'base');
  g = drive(act(g, { type: 'activate', player: P0, obj: s1, abilityIndex: EQUIP }), [[a], [b]]);
  assert.equal(mightOf(g, a), 5);
  g = drive(act(g, { type: 'activate', player: P0, obj: s2, abilityIndex: EQUIP }), [[c], [a]]);
  assert.equal(g.objects[s2].attachedTo, c);
  assert.equal(mightOf(g, c), 5, 'c copies a (which looks like the 5-Might unit)');
  assert.equal(g.objects[s1].attachedTo, a, 'the first Spectacles stays on a; nothing attached to c besides s2');
});

test('RJ#11795 a second Shady Spectacles copying a Baron Nashor copy also becomes Baron Nashor, without adding a Baron Pit', () => {
  let g = S0(); fundAll(g, P0);
  const a = put(g, P0, 'V(1)', 'base'), c = put(g, P0, 'V(2)', 'base');
  const bn = put(g, P0, 'Baron Nashor', 'base');
  const s1 = put(g, P0, 'Shady Spectacles', 'base'), s2 = put(g, P0, 'Shady Spectacles', 'base');
  const bfs = g.battlefields.length;
  g = drive(act(g, { type: 'activate', player: P0, obj: s1, abilityIndex: EQUIP }), [[a], [bn]]);
  g = drive(act(g, { type: 'activate', player: P0, obj: s2, abilityIndex: EQUIP }), [[c], [a]]);
  assert.equal(chars(g, a).name, 'Baron Nashor');
  assert.equal(chars(g, c).name, 'Baron Nashor');
  assert.equal(g.battlefields.length, bfs, 'no Baron Pit token added');
});

test('RJ#11796 Vi, Hotheaded doubles her current Might, including Might from Pendulum Blade', () => {
  let g = S0(); fundAll(g, P0);
  const vi = put(g, P0, 'Vi, Hotheaded', 'base');
  const pb = put(g, P0, 'Pendulum Blade', 'base');
  attachNow(g, pb, vi);
  g = drive(move(g, P0, [vi], BF_A));             // +2 this turn from the Blade's move trigger
  const before = mightOf(g, vi)!;
  assert.ok(before >= 5, `Vi boosted by the Blade (${before})`);
  const ab = legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === vi && x.abilityIndex < 900)!;
  g = drive(act(g, ab));
  assert.equal(mightOf(g, vi), before * 2);
});

test('RJ#11797 Minotaur Reckoner: Flash can be played but its move to base is negated; Ride the Wind still readies', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P1, 'Minotaur Reckoner', BF_B); control(g, BF_B, P1);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const fl = hand(g, P0, 'Flash');
  assert.ok(canPlayNow(g, P0, fl), 'Flash is playable');
  g = drive(act(g, { type: 'playCard', player: P0, obj: fl }), [[u]]);
  assert.equal(locOf(g, u), BF_A, 'move to base negated');
  g.objects[u].exhausted = true; g.timestamp++;
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Ride the Wind') }), ['base']);   // target auto (only friendly unit)
  assert.equal(locOf(g, u), BF_A, 'still not moved');
  assert.equal(g.objects[u].exhausted, false, 'but readied');
});

test('RJ#11798 Disposal Order in response to the Last Rites conquer trigger recycles Rhasa before it can be played from the trash', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P1, 'V(2)', 'base');
  const lr = put(g, P1, 'Last Rites', 'base'); attachNow(g, lr, u);
  const rh = put(g, P1, 'Rhasa the Sunderer', 'trash');
  g = move(g, P1, [u], BF_A);
  g = drive(g, [[rh]], x => x.pending?.kind === 'chainResponse' && x.pending.player === P0 && x.chain.some(c => c.kind === 'trigger'));
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Disposal Order') });
  g = drive(g, [/recycle|trash/i, [rh]], x => x.chain.length === 1 && x.pending?.kind === 'chainResponse');
  assert.equal(zone(g, rh), 'mainDeck', 'Rhasa recycled');
  g = drive(g, ['yes'], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, rh), 'mainDeck', 'Rhasa never played');
});

test('RJ#11802 Disposal Order in response to Spectral Matron\'s trigger recycles Xin Zhao: nothing is played', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const x = put(g, P1, 'Xin Zhao, Vigilant', 'trash');
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Spectral Matron'), destination: 'base' });
  g = drive(g, [[x]], x2 => x2.pending?.kind === 'chainResponse' && x2.pending.player === P0 && x2.chain.some(c => c.kind === 'trigger'));
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Disposal Order') });
  g = drive(g, [/recycle|trash/i, [x]], x2 => x2.chain.length === 1 && x2.pending?.kind === 'chainResponse');
  g = drive(g, ['yes'], x2 => x2.pending?.kind === 'mainAction');
  assert.equal(zone(g, x), 'mainDeck', 'recycled, not played');
});

test('RJ#11804 playing a unit from hand is not a move ("when I move" does not trigger)', () => {
  let g = S0(); fundAll(g, P0);
  const h = hand(g, P0, 'Stellacorn Herder');
  const h0 = g.players[0].hand.length;
  g = drive(act(g, { type: 'playCard', player: P0, obj: h, destination: 'base' }));
  assert.equal(g.players[0].hand.length, h0 - 1, 'no Herder draw');
});

test('RJ#11805 Eclipse Dragon counts exhausted runes: with 5 runes (some exhausted) it does not draw', () => {
  let g = S0(); setRunes(g, P0, 5);
  for (const r of g.players[0].runesInPlay.slice(0, 3)) g.objects[r].exhausted = true;
  const d = put(g, P0, 'Eclipse Dragon', 'base');
  const h0 = g.players[0].hand.length;
  g = drive(move(g, P0, [d], BF_A));
  assert.equal(g.players[0].hand.length, h0, 'no draw');
});

test('RJ#11808 moving Whiteflame Protector into a showdown does not trigger its "when you play me"', () => {
  let g = S0();
  const w = put(g, P0, 'Whiteflame Protector', 'base');
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  g = drive(move(g, P0, [w], BF_A), [], x => x.pending?.kind === 'showdownAction' && x.chain.length === 0);
  assert.equal(mightOf(g, w), 8);
  assert.ok(!g.log.some(l => /Trigger: Whiteflame/.test(l.text)));
});

test('RJ#11809 Switcheroo swaps totals that already include an Equipment bonus (not added again)', () => {
  let g = S0(); fundAll(g, P0);
  const a = put(g, P0, 'V(2)', BF_A), b = put(g, P0, 'V(5)', BF_A); control(g, BF_A, P0);
  const pb = put(g, P0, 'Pendulum Blade', 'base'); attachNow(g, pb, a);
  const ma = mightOf(g, a)!, mb = mightOf(g, b)!;
  assert.ok(ma > 2, 'Equipment bonus applies');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Switcheroo') }), [[a, b]]);
  assert.equal(mightOf(g, a), mb); assert.equal(mightOf(g, b), ma);
});

test('RJ#11810 Overzealous Fan cannot choose an attacking Baron Nashor (can\'t be chosen by enemy abilities)', () => {
  let g = S0();
  const bn = put(g, P0, 'Baron Nashor', 'base');
  const fan = put(g, P1, 'Overzealous Fan', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [bn], BF_A);
  g = drive(g, ['yes', [bn]], x => x.pending?.kind === 'showdownAction' && x.chain.length === 0);
  assert.equal(locOf(g, bn), BF_A, 'Baron not moved');
  assert.notEqual(zone(g, fan), 'trash', 'Fan did not kill itself for nothing');
});

test('RJ#11811 an opponent\'s Back Off cannot choose Baron Nashor', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1);
  const bn = put(g, P0, 'Baron Nashor', BF_A); control(g, BF_A, P0);
  const bo = hand(g, P1, 'Back Off');
  assert.equal(canPlayNow(g, P1, bo), false, 'Baron (the only unit) is not a legal choice, so Back Off has no target');
  void bn;
});

test('RJ#11812 Zaun Punk played via an opponent\'s Promising Future: its kill target is chosen after Dazzling Aurora enters (cost paid on play)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1); fundAll(g, P0);
  const au = put(g, P1, 'Dazzling Aurora', 'deckTop');
  const zp = put(g, P0, 'Zaun Punk', 'deckTop');
  const gear = put(g, P0, 'Pendulum Blade', 'base');
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Promising Future') });
  g = drive(g, [[au], [zp], 'yes']);
  assert.equal(zone(g, gear), 'trash', 'additional cost paid when Zaun Punk was played');
  assert.equal(zone(g, au), 'trash', 'Dazzling Aurora (played after Punk) was the kill target');
});

test('RJ#11814 hidden Evelynn, Entrancing played during an attack elsewhere pulls an enemy unit from the attacked battlefield', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
  const ev = put(g, P0, 'Evelynn, Entrancing', { facedown: BF_B });
  const e1 = put(g, P1, 'V(2)', BF_A), e2 = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(5)', 'base');
  g = drive(move(g, P0, [a], BF_A), [], x => x.pending?.kind === 'showdownAction' && x.pending.player === P0 && x.chain.length === 0);
  assert.ok(canPlayNow(g, P0, ev), 'playable from face down during the showdown');
  g = drive(act(g, { type: 'playCard', player: P0, obj: ev }), [[e1]], x => x.chain.length === 0 && x.pending?.kind === 'showdownAction');
  assert.equal(locOf(g, ev), BF_B);
  assert.equal(locOf(g, e1), BF_B, 'enemy pulled to Evelynn\'s battlefield');
  void e2;
});

test('RJ#11815 Hidden Blade on Rift Herald: its controller draws 2 first, then the Deathknell can play one of the drawn units', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1);
  const rh = put(g, P0, 'Rift Herald', BF_A); control(g, BF_A, P0);
  const top = put(g, P0, 'V(4)', 'deckTop');
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Hidden Blade') }), [[rh]], x => x.pending?.inStep === true && x.pending.player === P0 || x.pending?.kind === 'mainAction');
  assert.equal(zone(g, rh), 'trash');
  assert.ok(g.players[0].hand.includes(top), 'drew 2 before the Deathknell resolved');
  g = drive(g, [[top]]);
  assert.equal(locOf(g, top), 'base', 'drawn unit played by the Deathknell');
});

test('RJ#11816 Falling Comet in a non-combat showdown can be played but cannot choose Akali, Silent (not in combat)', () => {
  let g = S0(); fundAll(g, P0);
  const ak = put(g, P1, 'Akali, Silent', BF_A); control(g, BF_A, P1);
  const u = put(g, P0, 'V(2)', 'base');
  g = drive(move(g, P0, [u], BF_B), [], x => x.pending?.kind === 'showdownAction' && x.pending.player === P0);
  assert.ok(g.showdown && !g.showdown.isCombat);
  const fc = hand(g, P0, 'Falling Comet');
  assert.ok(canPlayNow(g, P0, fc), 'playable (own unit is a legal target)');
  g = act(g, { type: 'playCard', player: P0, obj: fc });
  if (g.pending?.kind === 'chooseTargets') assert.ok(!(g.pending.options ?? []).some(o => o.id === ak), 'Akali not offered');
  else assert.ok(!g.chain.some(c => c.targets.flat().includes(ak)), 'Akali not auto-chosen');
});

test('RJ#11817 Bellows Breath (Action) on the opponent\'s turn: possible after their unit moves into an empty battlefield (showdown), not when it is just played', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const bb = hand(g, P0, 'Bellows Breath');
  const u = put(g, P1, 'V(2)', 'base');
  g = move(g, P1, [u], BF_A);
  expectPending(g, 'showdownAction', P1);
  g = pass(g);
  expectPending(g, 'showdownAction', P0);
  assert.ok(canPlayNow(g, P0, bb), 'focus passed: Action playable');
  let h = S0({ tp: P1 }); fundAll(h, P0); fundAll(h, P1);
  const bb2 = hand(h, P0, 'Bellows Breath');
  put(h, P1, 'V(1)', BF_A); control(h, BF_A, P1);
  h = drive(act(h, { type: 'playCard', player: P1, obj: hand(h, P1, 'V(2)'), destination: BF_A }), [], x => x.pending?.player === P0 || x.pending?.kind === 'mainAction');
  assert.equal(canPlayNow(h, P0, bb2), false, 'played from hand: no showdown, no Action window');
});

test('RJ#11818 The List naming The Void cannot choose an enemy Baron Nashor', () => {
  let g = S0(); fundAll(g, P0);
  const bn = put(g, P1, 'Baron Nashor', 'base');
  const kz = put(g, P0, "Kha'Zix, Evolving Hunter", 'base');
  const tl = hand(g, P0, 'The List');
  g = act(g, { type: 'playCard', player: P0, obj: tl });
  g = drive(g, [/The Void/]);
  g.objects[tl].exhausted = false; g.timestamp++;
  const ab = legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === tl);
  assert.ok(ab, 'The List can be activated (a friendly Void unit exists)');
  g = act(g, ab!);
  const opts = g.pending?.kind === 'chooseTargets' ? (g.pending.options ?? []).map(o => o.id) : g.chain.flatMap(c => c.targets.flat());
  assert.ok(!opts.includes(bn), 'Baron not choosable');
  assert.ok(opts.includes(kz));
});

test('RJ#11819 Otterpus only replaces the early-turn point while it is on the board (dead Otterpus does nothing)', () => {
  const run = (where: 'base' | 'trash') => {
    let g = S0();
    put(g, P1, 'Otterpus', where);
    const u = put(g, P0, 'V(1)', 'base');
    g = drive(move(g, P0, [u], BF_A));
    return g.players[0].points;
  };
  assert.equal(run('base'), 0, 'control: Otterpus on the board -> draw instead (P0\'s 2nd turn)');
  assert.equal(run('trash'), 1, 'Otterpus in the trash: point scored normally');
});

test('RJ#11820 Temporal Breach on an opponent\'s solo unit at a battlefield: control is never lost, their hidden card stays face down', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const fd = put(g, P1, 'V(1)', { facedown: BF_A });
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Temporal Breach') }), [[u]]);
  assert.equal(locOf(g, u), BF_A);
  assert.equal(g.battlefields[BF_A].controller, P1);
  assert.equal(zone(g, fd), 'facedown');
});

test('RJ#11823 Forge of the Fluft re-attaching Shady Spectacles to the unit it is already on does nothing (no new copy choice)', () => {
  let g = S0(); fundAll(g, P0);
  setBattlefieldCard(g, BF_A, 'Forge of the Fluft');
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const a = put(g, P0, 'V(1)', 'base'), b = put(g, P0, 'V(5)', 'base'); put(g, P0, 'V(3)', 'base');
  const sp = put(g, P0, 'Shady Spectacles', 'base');
  g = drive(act(g, { type: 'activate', player: P0, obj: sp, abilityIndex: EQUIP }), [[a], [b]]);
  assert.equal(mightOf(g, a), 5);
  const leg = g.players[0].legend;
  const ab = legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === leg);
  assert.ok(ab, 'legend has the Forge ability');
  g = act(g, ab!);
  g = drive(g, [[a]], x => x.pending?.kind === 'mainAction' || (x.pending?.inStep === true && /cop/i.test(x.pending.prompt)));
  assert.notEqual(g.pending?.kind === 'chooseTargets' && /cop/i.test(g.pending.prompt), true, 'no new copy choice');
  assert.equal(g.objects[sp].attachedTo, a);
  assert.equal(mightOf(g, a), 5, 'still a copy of the same unit');
});

test('RJ#11824 Hostile Takeover from hidden in response to empowered Ambessa\'s attack trigger resolves first; the trigger still kills its target', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const am = put(g, P1, 'Ambessa, Respected and Feared', 'base'); g.objects[am].empowered = 1;
  const v = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const ht = put(g, P0, 'Hostile Takeover', { facedown: BF_A });
  g = drive(move(g, P1, [am], BF_A), [], x => x.pending?.player === P0);
  assert.deepEqual(chainLabels(g), ['trigger:Ambessa']);
  assert.ok(canPlayNow(g, P0, ht));
  g = drive(act(g, { type: 'playCard', player: P0, obj: ht }), [[am]], x => x.chain.length === 1 && x.pending?.kind === 'chainResponse');
  assert.equal(g.objects[am].controller, P0, 'Hostile Takeover resolved first');
  assert.equal(zone(g, v), 'battlefield');
  g = drive(g, [], x => x.chain.length === 0);
  assert.equal(zone(g, v), 'trash', 'the trigger resolves with its original target');
});

test('RJ#11826 Thousand-Tailed Watcher\'s -3 (no choosing) applies to an enemy Baron Nashor', () => {
  let g = S0(); fundAll(g, P0);
  const bn = put(g, P1, 'Baron Nashor', 'base');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Thousand-Tailed Watcher') }), ['no']);
  assert.equal(mightOf(g, bn), 9);
});

test('RJ#11827 a hidden spell (base cost 0) costs [1] more under an opponent\'s Helm of Suppression, [1][A] more if it is Empowered', () => {
  for (const emp of [0, 1]) {
    const g = S0(); fundAll(g, P0);
    const helm = put(g, P1, 'Helm of Suppression', 'base'); g.objects[helm].empowered = emp;
    put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
    put(g, P1, 'V(2)', BF_B); control(g, BF_B, P1);
    const ht = put(g, P0, 'Hostile Takeover', { facedown: BF_A });
    const c = playCostOf(g, P0, ht)!;
    assert.equal(c.energy, 1);
    assert.equal(c.power.length, emp ? 1 : 0);
  }
});

// RJ#11828 DECIDED (docs/riftjudge/DECISIONS.md): CR 811.1.d.2/811.1.d.4 (Smoke and Mirrors pattern): the first target ("a battlefield you
// control") can be chosen at the battlefield it was played from, so it must be (B); the second ("a unit … at a different location")
// can't be, so it may come from anywhere. So only <elsewhere> → B; RJ's B→A is MISMATCH-RJ.
test('RJ#11828 hidden Resonating Strike at B (you control A and B): the battlefield must be B, the unit comes from elsewhere (CR 811.1.d.4); B→A (RJ) is not allowed', () => {
  const setup = () => {
    const g = S0(); fundAll(g, P0);
    put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
    const b = put(g, P0, 'V(2)', BF_B); control(g, BF_B, P0);
    const c = put(g, P0, 'V(3)', 'base');
    const rs = put(g, P0, 'Resonating Strike', { facedown: BF_B });
    return { g, b, c, rs };
  };
  let { g, c, rs } = setup();
  assert.ok(canPlayNow(g, P0, rs), 'playable from facedown');
  const bfA = g.battlefields[BF_A].objId, bfB = g.battlefields[BF_B].objId;
  g = act(g, { type: 'playCard', player: P0, obj: rs });
  // the battlefield group's only legal choice (B) is chosen automatically; battlefield A is never offered
  assert.ok(!(g.pending?.options ?? []).some(o => o.id === bfA), 'battlefield A (not "here") is not a legal first target');
  if ((g.pending?.options ?? []).some(o => o.id === bfB)) g = act(g, { type: 'choose', player: P0, optionIds: [bfB] });
  assert.ok((g.pending?.options ?? []).some(o => o.id === c), 'a unit in base (another location) may be chosen');
  g = drive(g, [[c]]);
  assert.equal(locOf(g, c), BF_B, 'official: battlefield here, unit from another location (811.1.d.4)');
});

test('RJ#11830 moving into an empty battlefield is a non-combat showdown: no attacker, Twilight Reveler\'s "When I attack" does not trigger', () => {
  let g = S0();
  const tr = put(g, P0, 'Twilight Reveler', 'base');
  const other = put(g, P0, 'V(2)', 'base', { ready: false });
  g = move(g, P0, [tr], BF_A);
  assert.equal(g.chain.length, 0, 'no attack trigger');
  assert.ok(!g.showdown || !g.showdown.isCombat);
  assert.equal(g.objects[tr].combatRole ?? null, null);
  assert.equal(g.objects[other].exhausted, true);
});

test('RJ#11832 Tornado Warrior from face down can empower a vanilla unit; it is still disempowered at end of turn after the Warrior died', () => {
  let g = S0(); fundAll(g, P0);
  const v = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const tw = put(g, P0, 'Tornado Warrior', { facedown: BF_A });
  g = drive(act(g, { type: 'playCard', player: P0, obj: tw }), ['yes', [v]]);
  assert.equal(g.objects[v].empowered, 1, 'a unit without Empower can be empowered');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'KillDraw') }), [[tw]]);
  assert.equal(zone(g, tw), 'trash');
  g = drive(endTurn(g), [], x => x.activePlayer === P1 && x.pending?.kind === 'mainAction');
  assert.equal(g.objects[v].empowered, 0, 'delayed disempower still happens');
});

test('RJ#11833 Last Rites: the "you may play a unit from your trash" can be declined; its cost can\'t be skipped (unpayable → not played)', () => {
  const setup = (runes: boolean) => {
    let g = S0(); if (!runes) setRunes(g, P0, 0);
    const u = put(g, P0, 'V(2)', 'base');
    const lr = put(g, P0, 'Last Rites', 'base'); attachNow(g, lr, u);
    const t = put(g, P0, 'V(3)', 'trash');
    g = drive(move(g, P0, [u], BF_A));
    return { g, t };
  };
  let { g, t } = setup(true);
  assert.equal(g.pending?.kind, 'chooseTargets');
  g = drive(act(g, { type: 'choose', player: P0, optionIds: [] }));
  assert.equal(zone(g, t), 'trash', 'declined: nothing played');
  const s = setup(false);
  g = drive(s.g, [[s.t], 'base']);
  assert.equal(zone(g, s.t), 'trash', 'cost unpayable: the unit stays in the trash');
});

test('RJ#11834 Janna, Savior played to base on the opponent\'s turn (Reaction): her play trigger resolves and heals units at base', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const d = put(g, P0, 'V(4)', 'base', { damage: 2 });
  const j = hand(g, P0, 'Janna, Savior');
  const pu = put(g, P1, 'V(3)', 'base');
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'ZapM') }), [[pu]], x => x.pending?.player === P0);
  assert.ok(canPlayNow(g, P0, j, 'base'));
  g = act(g, { type: 'playCard', player: P0, obj: j, destination: 'base' });
  g = drive(g, [], x => x.chain.length > 0 && chainLabels(g).includes('trigger:Janna'));
  assert.ok(chainLabels(g).includes('trigger:Janna'), 'play trigger on the chain');
  g = drive(g, [], x => !chainLabels(x).includes('trigger:Janna'));
  assert.equal(locOf(g, j), 'base');
  assert.equal(g.objects[d].damage, 0, 'healed');
});

test('RJ#11835 a unit saved by The Boss (replacement) never dies: Altar of Memories does not trigger', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  setLegend(g, P0, 'The Boss');
  const al = put(g, P0, 'Altar of Memories', 'base');
  const u = put(g, P0, 'V(2)', BF_A, { buff: true }); control(g, BF_A, P0);
  const h0 = g.players[0].hand.length;
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'KillA') }), [[u]], x => x.pending?.inStep === true && x.pending.player === P0);
  assert.match(g.pending!.prompt, /Boss/);
  g = ans(g, 'yes');
  g = drive(g, [], x => x.pending?.kind === 'mainAction' || (x.pending?.inStep === true && /Altar/i.test(x.pending.prompt)));
  assert.equal(locOf(g, u), 'base', 'saved');
  assert.equal(g.pending?.kind, 'mainAction', 'no Altar prompt');
  assert.equal(g.objects[al].exhausted, false);
  assert.equal(g.players[0].hand.length, h0);
});

test('RJ#11836 Irelia at Abandoned Hall plays Flash to base: the Hall\'s trigger comes after Flash resolves, so she can\'t get its +1', () => {
  let g = S0(); fundAll(g, P0);
  setBattlefieldCard(g, BF_A, 'Abandoned Hall');
  const ir = put(g, P0, 'Irelia, Fervent', BF_A); const v = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Flash') }), [[ir]], x => x.pending?.inStep === true && /here/.test(x.pending.prompt));
  assert.deepEqual(g.pending!.options!.map(o => o.id), [v], 'only the unit still at the Hall can be chosen');
  g = drive(g, [[v]]);
  assert.equal(locOf(g, ir), 'base');
  assert.equal(mightOf(g, ir), 5, '+1 only from being chosen by Flash');
  assert.equal(mightOf(g, v), 3);
});

test('RJ#11837 Abandoned Hall choosing Irelia, Fervent triggers Blade Dancer: +1 Hall, +1 chosen, +1 readied, and she is ready', () => {
  let g = S0(); fundAll(g, P0);
  setLegend(g, P0, 'Blade Dancer');
  setBattlefieldCard(g, BF_A, 'Abandoned Hall');
  const ir = put(g, P0, 'Irelia, Fervent', BF_A, { ready: false }); control(g, BF_A, P0);
  const e = put(g, P1, 'V(5)', 'base');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'ZapM') }), [[e], [ir], '0', 'yes']);
  assert.equal(mightOf(g, ir), 7);
  assert.equal(g.objects[ir].exhausted, false);
});

test('RJ#11838 after Brynhir Thundersong\'s trigger resolved, Lillia (moved by the opponent\'s Charm) still plays her Sprite token (tokens aren\'t cards)', () => {
  let g = withTokens(S0({ tp: P1 })); fundAll(g, P0); fundAll(g, P1);
  const l = put(g, P0, 'Lillia, Fae Fawn', BF_A); control(g, BF_A, P0);
  const zr = hand(g, P0, 'ZapR');
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Brynhir Thundersong'), destination: 'base' }));
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Charm') }), [], x => x.pending?.player === P0);
  assert.equal(canPlayNow(g, P0, zr), false, 'Brynhir: P0 can\'t play cards');
  g = drive(g, ['base']);
  assert.equal(locOf(g, l), 'base');
  const sp = unitsNamed(g, 'Sprite');
  assert.equal(sp.length, 1);
  assert.equal(locOf(g, sp[0]), BF_A);
});

test('RJ#11839 Divine Judgment\'s [A][A] is paid (runes recycled) when it is played, before the opponent can respond', () => {
  let g = S0(); setRunes(g, P0, 10, 'order');
  const deck0 = g.players[0].runeDeck.length;
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Divine Judgment') }), [], x => x.pending?.player === P1);
  assert.equal(g.pending?.kind, 'chainResponse');
  assert.deepEqual(chainLabels(g), ['spell:Divine Judgment']);
  assert.equal(g.players[0].runesInPlay.length, 8, 'two runes already recycled');
  assert.equal(g.players[0].runeDeck.length, deck0 + 2);
});

test('RJ#11840 after playing Divine Judgment you keep priority and can recycle runes for power first; the floated power survives its resolution', () => {
  let g = S0(); setRunes(g, P0, 10, 'order');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Divine Judgment') });
  expectPending(g, 'chainResponse', P0, 'priority to the player who played it');
  for (let i = 0; i < 2; i++) g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.abilityIndex === 951 && g.players[0].runesInPlay.includes(a.obj))!);
  assert.equal(g.players[0].pool.power.Order, 2, 'power floated');
  expectPending(g, 'chainResponse', P0, 'still my priority');
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: d.options!.slice(0, d.min ?? 1).map(o => o.id) }) : act(g, { type: 'pass', player: d.player });
  }
  assert.equal(g.players[0].pool.power.Order, 2, 'power kept after Divine Judgment resolved');
  assert.equal(g.players[0].runesInPlay.length, 2);
});

test('RJ#11842 "Kill a gear" (Detonate) can choose Patched Porobot (Unit and Gear)', () => {
  let g = S0(); fundAll(g, P0);
  const pp = put(g, P1, 'Patched Porobot', 'base');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Detonate') }), [[pp]]);
  assert.equal(zone(g, pp), 'trash');
});

test('RJ#11844 Shadows of the Past returns up to 2 units from any trashes, each to its owner\'s hand', () => {
  let g = S0(); fundAll(g, P0);
  const a = put(g, P0, 'V(2)', 'trash'), b = put(g, P1, 'V(3)', 'trash');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Shadows of the Past') });
  assert.equal(g.pending?.min, 0, 'up to 2: zero allowed');
  g = drive(g, [[a, b]]);
  assert.ok(g.players[0].hand.includes(a));
  assert.ok(g.players[1].hand.includes(b), 'opponent\'s unit goes to the opponent\'s hand');
});

test('RJ#11845 Shuriken Flip: the unit and its destination are both chosen when it is played (before anyone can respond)', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Shuriken Flip') });
  g = ans(g, [u]);
  expectPending(g, 'chooseDestination', P0, 'destination chosen during play');
  g = ans(g, String(BF_B));
  expectPending(g, 'chainResponse', P0);
  g = drive(g);
  assert.equal(locOf(g, u), BF_B);
});

test('RJ#11846 Sandswept Tomb\'s [A] discount covers Rampage\'s optional [C]: no power spent, the +2 still applies', () => {
  let g = S0(); fundAll(g, P0);
  setBattlefieldCard(g, BF_A, 'Sandswept Tomb');
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(5)', BF_B);
  const n0 = g.players[0].runesInPlay.length;
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Rampage') }), ['yes']);
  assert.equal(g.players[0].runesInPlay.length, n0, 'no rune recycled for power');
  assert.equal(g.players[0].runesInPlay.filter(x => g.objects[x].exhausted).length, 3, 'only the 3 energy');
  assert.equal(g.objects[e].damage, 4, 'friendly unit got +2');
});

test('RJ#11847 Sacrifice (killing the unit Hidden Blade targets) in response: draw 2 + channel 1; Hidden Blade fizzles, no extra draw', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P0, 'V(5)', BF_A); control(g, BF_A, P0);
  const s = hand(g, P0, 'Sacrifice');
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Hidden Blade') }), [[u]], x => x.pending?.player === P0);
  const h0 = g.players[0].hand.length, r0 = g.players[0].runesInPlay.length;
  g = drive(act(g, { type: 'playCard', player: P0, obj: s }), ['first']);
  assert.equal(zone(g, u), 'trash');
  assert.equal(g.players[0].hand.length - h0, 1, '-Sacrifice +2 (no draw from Hidden Blade)');
  assert.equal(g.players[0].runesInPlay.length - r0, 1);
});

test('RJ#11848 Astral Heron\'s [2][A][A] discount covers Bellows Breath plus its Repeat cost: pays 0 and it repeats', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'Astral Heron', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(5)', BF_B);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'ZapM') }), [[e]]);
  const d0 = g.objects[e].damage;
  const n0 = g.players[0].runesInPlay.length, x0 = g.players[0].runesInPlay.filter(x => g.objects[x].exhausted).length;
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Bellows Breath') }), [[e], 'yes', [e]]);
  assert.equal(g.players[0].runesInPlay.length, n0, 'no power paid');
  assert.equal(g.players[0].runesInPlay.filter(x => g.objects[x].exhausted).length, x0, 'no energy paid');
  assert.equal(g.objects[e].damage - d0, 2, 'repeated');
});

test('RJ#11850 conquering Zaun Warrens with a Last Rites unit: the unit discarded by the Warrens can\'t be chosen by Last Rites (chosen when chained)', () => {
  let g = S0(); fundAll(g, P0);
  setBattlefieldCard(g, BF_A, 'Zaun Warrens');
  const u = put(g, P0, 'V(2)', 'base');
  const lr = put(g, P0, 'Last Rites', 'base'); attachNow(g, lr, u);
  const t = put(g, P0, 'V(3)', 'trash');
  const h = hand(g, P0, 'V(4)');
  g = drive(move(g, P0, [u], BF_A), ['1'], x => x.pending?.kind === 'chooseTargets');
  assert.match(g.pending!.prompt, /Last Rites/);
  assert.deepEqual(g.pending!.options!.map(o => o.id), [t], 'the card still in hand is not a choice');
  g = drive(g, [[t], 'base']);   // the Warrens' discard of the only card in hand is automatic
  assert.equal(zone(g, h), 'trash', 'discarded by the Warrens');
  assert.equal(locOf(g, t), 'base', 'Last Rites played the unit chosen earlier');
});

test('RJ#11851 Star-Crossed whose enemy target was Retreated in response still returns the friendly unit', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const mine = put(g, P0, 'V(2)', 'base'), theirs = put(g, P1, 'V(3)', 'base');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Star-Crossed') }), [[mine], [theirs]], x => x.pending?.player === P1);
  const r1 = g.players[1].runesInPlay.length;
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Retreat') }), [[theirs]]);
  assert.ok(g.players[1].hand.includes(theirs));
  assert.equal(g.players[1].runesInPlay.length, r1 + 1, 'Retreat channelled');
  assert.ok(g.players[0].hand.includes(mine), 'friendly unit still returned');
});

test('RJ#11852 Fizz, Trickster plays Star-Crossed from the trash: it can return Fizz himself (as the friendly unit), then is recycled', () => {
  let g = S0(); fundAll(g, P0);
  const e = put(g, P1, 'V(4)', 'base');
  const sc = put(g, P0, 'Star-Crossed', 'trash');
  const fz = hand(g, P0, 'Fizz, Trickster');
  g = drive(act(g, { type: 'playCard', player: P0, obj: fz, destination: 'base' }), [[sc], [fz], [e]]);
  assert.ok(g.players[0].hand.includes(fz), 'Fizz returned');
  assert.ok(g.players[1].hand.includes(e));
  assert.equal(zone(g, sc), 'mainDeck', 'recycled');
});

test('RJ#11853 Mystic Vortex does not add [A] to the Scorn of the Moon (Diana legend) Reaction ability (not a card play)', () => {
  let g = S0(); fundAll(g, P0);
  setBattlefieldCard(g, BF_A, 'Mystic Vortex');
  const leg = setLegend(g, P0, 'Scorn of the Moon');
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_A);
  assert.ok(g.showdown);
  const n0 = g.players[0].runesInPlay.length;
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === leg)!);
  assert.equal(g.players[0].pool.energy, 1);
  assert.equal(g.players[0].runesInPlay.length, n0, 'no power paid');
});

test('RJ#11854 Tactical Retreat on an attacker: it deals its full combat damage, is then recalled instead of dying, and does not conquer', () => {
  let { g, atk, def } = attackSetup(['V(4)'], ['V(4)']);
  fundAll(g, P0);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Tactical Retreat') }), [[atk[0]]], x => x.chain.length === 0 && x.pending?.kind === 'showdownAction');
  g = drive(g);
  assert.equal(zone(g, def[0]), 'trash', 'its full damage killed the defender');
  assert.equal(locOf(g, atk[0]), 'base');
  assert.equal(g.objects[atk[0]].damage, 0);
  assert.equal(g.objects[atk[0]].exhausted, true);
  assert.notEqual(g.battlefields[BF_A].controller, P0, 'no conquer');
  assert.equal(g.players[0].points, 0);
});

test('RJ#11855 Astral Heron\'s pending [2][A][A] discount covers Irelia\'s Deflect on Back Off: pay 1 Energy, no Power', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'Astral Heron', BF_B); control(g, BF_B, P0);
  const ir = put(g, P1, 'Irelia, Fervent', BF_A); control(g, BF_A, P1);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'V(1)'), destination: 'base' }));
  const n0 = g.players[0].runesInPlay.length, x0 = g.players[0].runesInPlay.filter(x => g.objects[x].exhausted).length;
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Back Off') }), [[ir]]);
  assert.equal(g.objects[ir].stunned, true);
  assert.equal(g.players[0].runesInPlay.length, n0, 'Deflect [A] covered');
  assert.equal(g.players[0].runesInPlay.filter(x => g.objects[x].exhausted).length - x0, 1, '3 - 2 = 1 Energy');
});

test('RJ#11856 Astral Heron\'s discount also covers Accelerate\'s [1][C]: Accel(3) costs 2 Energy, no Power, and enters ready', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'Astral Heron', BF_B); control(g, BF_B, P0);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'V(1)'), destination: 'base' }));
  const n0 = g.players[0].runesInPlay.length, x0 = g.players[0].runesInPlay.filter(x => g.objects[x].exhausted).length;
  const a = hand(g, P0, 'Accel(3)');
  g = drive(act(g, { type: 'playCard', player: P0, obj: a, destination: 'base' }), ['yes']);
  assert.equal(g.players[0].runesInPlay.length, n0);
  assert.equal(g.players[0].runesInPlay.filter(x => g.objects[x].exhausted).length - x0, 2);
  assert.equal(g.objects[a].exhausted, false, 'Accelerate paid (enters ready)');
});

test('RJ#11859 Flash countered by Crumbling Sands was never played: no Abandoned Hall +1 for its player', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  setBattlefieldCard(g, BF_A, 'Abandoned Hall');
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(5)', BF_B); control(g, BF_B, P1);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'ZapM') }), [[e], []]);   // first spell (decline the Hall's +1)
  const fl = hand(g, P0, 'Flash');
  g = drive(act(g, { type: 'playCard', player: P0, obj: fl }), [[]], x => x.pending?.player === P1);
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Crumbling Sands') }), ['first'], x => x.pending?.kind === 'mainAction' || (x.pending?.inStep === true && x.pending.player === P0));
  assert.equal(g.pending?.kind, 'mainAction', 'no Hall prompt for the countered Flash');
  assert.equal(zone(g, fl), 'trash');
  assert.equal(mightOf(g, u), 2);
});

test('RJ#11860 Irelia, Fervent chosen by Flash gets +1 even though Crumbling Sands counters Flash', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const ir = put(g, P0, 'Irelia, Fervent', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(5)', BF_B); control(g, BF_B, P1);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'ZapM') }), [[e]]);
  const fl = hand(g, P0, 'Flash');
  g = drive(act(g, { type: 'playCard', player: P0, obj: fl }), [[ir]], x => x.pending?.player === P1);
  assert.ok(chainLabels(g).includes('trigger:Irelia'), 'chosen trigger on the chain above Flash');
  const cs = hand(g, P1, 'Crumbling Sands');
  g = act(g, { type: 'playCard', player: P1, obj: cs });
  if (g.pending?.kind === 'chooseTargets') g = ans(g, /Flash/);
  g = drive(g);
  assert.equal(zone(g, fl), 'trash');
  assert.equal(locOf(g, ir), BF_A, 'Flash countered');
  assert.equal(mightOf(g, ir), 5, '+1 from being chosen');
});

test('RJ#11861 Switcheroo on Irelia, Fervent (4) and Tasty Faefolk (6): her +1 resolves first, then the swap → Irelia 6, Faefolk 5', () => {
  let { g, atk, def } = attackSetup(['Irelia, Fervent'], ['Tasty Faefolk']);
  fundAll(g, P0);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Switcheroo') }), [], x => x.pending?.kind === 'showdownAction' && x.chain.length === 0);
  assert.equal(mightOf(g, atk[0]), 6);
  assert.equal(mightOf(g, def[0]), 5);
});

test('RJ#11862 during a showdown at Mystic Vortex an Ambush unit being played (has [Reaction], CR 822.1.b) costs [A] more', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  setBattlefieldCard(g, BF_A, 'Mystic Vortex');
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(3)', 'base');
  const amb = hand(g, P1, 'Ambusher(2)');
  const zr = hand(g, P1, 'ZapR');
  g = pass(move(g, P0, [a], BF_A));
  expectPending(g, 'showdownAction', P1);
  assert.equal(playCostOf(g, P1, zr)!.power.length, 1, 'control: a Reaction spell costs [A] more');
  assert.equal(playCostOf(g, P1, amb, { dest: BF_A })!.power.length, 1, 'Ambush unit: [A] more');
});

test('RJ#11863 a unit stunned during the non-combat showdown at an open battlefield still conquers it', () => {
  let g = S0(); fundAll(g, P1);
  const u = put(g, P0, 'V(2)', 'base');
  g = pass(move(g, P0, [u], BF_A));
  expectPending(g, 'showdownAction', P1);
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Back Off') }), [[u]]);
  assert.equal(g.objects[u].stunned, true);
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[0].points, 1, 'conquered');
});

test('RJ#11864 Void Burrower\'s conquer play is not restricted to "here": the unit can be played to another battlefield you control (no showdown there)', () => {
  let g = S0(); fundAll(g, P0);
  setLegend(g, P0, 'Void Burrower');
  const v2 = put(g, P0, 'V(2)', 'deckTop');
  put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
  const u = put(g, P0, 'V(1)', 'base');
  g = drive(move(g, P0, [u], BF_A), ['yes', [v2]], x => x.pending?.kind === 'chooseDestination');
  assert.ok(g.pending!.options!.some(o => o.id === String(BF_B)), 'other controlled battlefield offered');
  g = drive(g, [String(BF_B)]);
  assert.equal(locOf(g, v2), BF_B);
  assert.equal(g.battlefields[BF_B].controller, P0);
  assert.equal(g.showdown, null);
});

test('RJ#11865 Kennen, Keeper of Balance played from hiding: his play stun may only choose units at that battlefield', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const here = put(g, P1, 'V(2)', BF_A);
  const b = put(g, P1, 'V(2)', 'base'), o = put(g, P1, 'V(2)', BF_B);
  const k = put(g, P0, 'Kennen, Keeper of Balance', { facedown: BF_A });
  g = drive(act(g, { type: 'playCard', player: P0, obj: k }), ['yes'], x => x.pending?.kind === 'chooseTargets');
  const ids = g.pending!.options!.map(x => x.id);
  assert.ok(ids.includes(here));
  assert.ok(!ids.includes(b) && !ids.includes(o), 'base / other battlefield excluded');
});

test('RJ#11866 in response to an enemy Cull the Weak you may play a hidden unit and then kill it to Cull (choice on resolution)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const m = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const hu = put(g, P0, 'HidU(2)', { facedown: BF_A });
  put(g, P1, 'V(1)', 'base');
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Cull the Weak') }), [], x => x.pending?.player === P0);
  assert.ok(canPlayNow(g, P0, hu));
  g = drive(act(g, { type: 'playCard', player: P0, obj: hu }), [], x => x.pending?.kind === 'chooseCards');
  assert.equal(locOf(g, hu), BF_A, 'entered where it was hidden');
  g = drive(g, [[hu]]);
  assert.equal(zone(g, hu), 'trash');
  assert.equal(locOf(g, m), BF_A);
});

test('RJ#11868 hidden Pyke, Dockside Butcher with the additional cost paid can be Gusted (2 Might) while his trigger is on the chain', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const py = put(g, P0, 'Pyke, Dockside Butcher', { facedown: BF_A });
  const n0 = g.players[0].runesInPlay.length;
  g = drive(act(g, { type: 'playCard', player: P0, obj: py }), ['yes'], x => x.pending?.player === P1);
  assert.deepEqual(chainLabels(g), ['trigger:Pyke']);
  assert.equal(mightOf(g, py), 2);
  const gu = hand(g, P1, 'Gust');
  assert.ok(canPlayNow(g, P1, gu));
  g = drive(act(g, { type: 'playCard', player: P1, obj: gu }), [[py]]);
  assert.ok(g.players[0].hand.includes(py));
  assert.equal(g.players[0].runesInPlay.length, n0 - 1, '[C] stays paid');
});

test('RJ#11870 Promising Future: Brynhir (played first) does not stop the opponent\'s Dazzling Aurora played by the same Promising Future', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1); fundAll(g, P0);
  const au = put(g, P1, 'Dazzling Aurora', 'deckTop');
  const br = put(g, P0, 'Brynhir Thundersong', 'deckTop');
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Promising Future') }), [[au], [br]]);
  assert.equal(locOf(g, br), 'base');
  assert.equal(locOf(g, au), 'base', 'Aurora still played');
});

test('RJ#11871 combat cleanup heals every unit there, incl. earlier spell damage on a defender, even if the attacker was stunned', () => {
  let { g, atk, def } = attackSetup(['V(5)'], ['V(6)'], { defOpts: [{ damage: 2 }] });
  fundAll(g, P0); fundAll(g, P1);
  g = pass(g);
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Back Off') }), [[atk[0]]], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, def[0]), 'battlefield');
  assert.equal(g.objects[def[0]].damage, 0, 'healed in combat cleanup');
});

test('RJ#11872 a 2-Might attacker may assign all its damage to Astral Heron and none to Scuttle Crab (no unit must be killed)', () => {
  let { g, def } = attackSetup(['V(2)'], ['Astral Heron', 'Scuttle Crab']);
  for (let i = 0; i < 30 && g.pending && !g.pending.inStep && g.pending.kind !== 'assignDamage'; i++) g = pass(g);
  expectPending(g, 'assignDamage', P0);
  const [heron, crab] = def;
  assert.equal(validateAction(g, { type: 'assignDamage', player: P0, assignment: { [heron]: 2, [crab]: 0 } }), null);
});

test('RJ#11873 hidden Tideturner at B swapping with your unit at A (you control both): the hidden card at A stays, no Contested/showdown', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const bn = put(g, P0, 'V(5)', BF_A); control(g, BF_A, P0);
  const hb = put(g, P0, 'Hidden Blade', { facedown: BF_A });
  put(g, P0, 'V(2)', BF_B); control(g, BF_B, P0);
  const tt = put(g, P0, 'Tideturner', { facedown: BF_B });
  const pu = put(g, P1, 'V(3)', 'base');
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'ZapM') }), [[pu]], x => x.pending?.player === P0);
  g = drive(act(g, { type: 'playCard', player: P0, obj: tt }), [[bn]]);
  assert.equal(locOf(g, tt), BF_A);
  assert.equal(locOf(g, bn), BF_B);
  assert.equal(zone(g, hb), 'facedown');
  assert.deepEqual(g.battlefields.slice(0, 2).map(b => b.controller), [P0, P0]);
  assert.equal(g.showdown, null);
});

test('RJ#11874 Defy counters a Rebuttal that is trying to steal your Discipline; Discipline resolves normally for you', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P0, 'V(2)', 'base');
  const di = hand(g, P0, 'Discipline'), de = hand(g, P0, 'Defy');
  g = drive(act(g, { type: 'playCard', player: P0, obj: di }), [[u]], x => x.pending?.player === P1);
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Rebuttal') }), [], x => x.pending?.player === P0 && x.pending.kind === 'chainResponse');
  assert.ok(canPlayNow(g, P0, de));
  const h0 = g.players[0].hand.length;
  g = drive(act(g, { type: 'playCard', player: P0, obj: de }), [/Rebuttal/]);
  assert.equal(mightOf(g, u), 4);
  assert.equal(g.players[0].hand.length, h0, '-Defy +1 draw');
});

test('RJ#11877 Forbidding Waste\'s -2 stops as soon as a second unit joins the lone defender (continuous "while")', () => {
  const g0 = S0(); setBattlefieldCard(g0, BF_A, 'Forbidding Waste'); fundAll(g0, P1);
  const d = put(g0, P1, 'V(4)', BF_A); control(g0, BF_A, P1);
  const a = put(g0, P0, 'V(3)', 'base');
  const amb = hand(g0, P1, 'Ambusher(1)');
  let g = move(g0, P0, [a], BF_A);
  assert.equal(mightOf(g, d), 2, 'defending alone');
  g = pass(g);
  g = drive(act(g, { type: 'playCard', player: P1, obj: amb, destination: BF_A }), [], x => x.pending?.kind === 'showdownAction' && x.chain.length === 0);
  assert.equal(mightOf(g, d), 4);
});

test('RJ#11879 Virtuoso (Jhin legend) with 12 runes already in play: "channel 4" does nothing (no Power), the rest still happens', () => {
  let g = S0(); setRunes(g, P0, 12, 'body');
  for (const id of g.players[0].runeDeck) delete g.objects[id];
  g.players[0].runeDeck = [];
  const leg = setLegend(g, P0, 'Virtuoso');
  const bs = [0, 1, 2].map(() => put(g, P0, 'ZapM', 'banishment'));
  for (const b of bs) g.ex.links[b] = { by: leg, epoch: g.objects[leg].epoch ?? 0 };
  put(g, P0, 'V(2)', 'base');
  const sp = hand(g, P0, 'Onslaught');
  const h0 = g.players[0].hand.length;
  g = drive(act(g, { type: 'playCard', player: P0, obj: sp }), ['yes']);
  assert.deepEqual([...bs, sp].map(b => zone(g, b)), ['trash', 'trash', 'trash', 'trash'], 'four spells put in the trash');
  assert.equal(g.players[0].runesInPlay.length, 12);
  assert.equal(g.players[0].pool.energy, 0);
  assert.equal(Object.values(g.players[0].pool.power).reduce((a, b) => a + (b ?? 0), 0), 0, 'no Power floated');
  assert.equal(g.players[0].hand.length, h0, '-Onslaught +1 draw');
});

test('RJ#11880 gear stolen by Akshan, Mischievous (Shady Spectacles making him a copy) still returns to its owner when he leaves the board', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const x = put(g, P1, 'V(1)', 'base'); put(g, P1, 'V(5)', 'base');
  const sp = put(g, P1, 'Shady Spectacles', 'base');
  g = drive(act(g, { type: 'activate', player: P1, obj: sp, abilityIndex: EQUIP }), [[x]]);
  g = nextTurn(g); fundAll(g, P0);
  put(g, P0, 'V(6)', 'base');
  const ak = hand(g, P0, 'Akshan, Mischievous');
  g = drive(act(g, { type: 'playCard', player: P0, obj: ak, destination: 'base' }), ['yes', /take an enemy gear/], x2 => x2.pending?.kind === 'mainAction');
  assert.equal(g.objects[sp].controller, P0);
  assert.equal(mightOf(g, ak), 6, 'Akshan is a copy');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'KillDraw') }), [[ak]]);
  assert.equal(zone(g, ak), 'trash');
  assert.equal(g.objects[sp].controller, P1, 'control returned');
  assert.equal(g.objects[sp].attachedTo ?? null, null);
});

test('RJ#11881 Yone, Blademaster moves into an open battlefield, Rengar ambushes in, Yone wins and conquers: it "was uncontrolled", so Yone triggers', () => {
  let g = S0(); fundAll(g, P1);
  const y = put(g, P0, 'Yone, Blademaster', 'base'), v = put(g, P0, 'V(3)', 'base');
  const big = put(g, P1, 'V(9)', 'base');
  const rg = hand(g, P1, 'Rengar, Trophy Hunter');
  g = pass(move(g, P0, [y, v], BF_A));
  assert.ok(canPlayNow(g, P1, rg, BF_A));
  g = drive(act(g, { type: 'playCard', player: P1, obj: rg, destination: BF_A }), [[big]]);
  assert.equal(zone(g, rg), 'trash');
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.objects[big].damage, 5, 'Yone dealt his Might to the unit in base');
});

test('RJ#11882 Shuriken Flip can\'t be played without a friendly unit to move (the move is a required choice)', () => {
  const g = S0(); fundAll(g, P0);
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const sf = hand(g, P0, 'Shuriken Flip');
  assert.equal(canPlayNow(g, P0, sf), false);
  put(g, P0, 'V(1)', 'base');
  assert.equal(canPlayNow(g, P0, sf), true, 'control');
});

test('RJ#11884 Blood Money on your own unit, then hidden Hidden Blade on it in response: Blade kills (draw 2), Blood Money fizzles (no Gold)', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const hb = put(g, P0, 'Hidden Blade', { facedown: BF_A });
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Blood Money') }), [[u]], x => x.pending?.kind === 'chainResponse');
  assert.ok(canPlayNow(g, P0, hb));
  const h0 = g.players[0].hand.length;
  g = drive(act(g, { type: 'playCard', player: P0, obj: hb }), [[u]]);
  assert.equal(zone(g, u), 'trash');
  assert.equal(g.players[0].hand.length - h0, 2, 'Hidden Blade draw');
  assert.equal(Object.values(g.objects).filter(o => g.cards[o.cardId]?.name === 'Gold' && o.zone === 'base').length, 0, 'no Gold tokens');
});

test('RJ#11887 after Scuttle Crab\'s Deathknell you can look at a card the opponent hides later that same turn (not on the next turn)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1);
  const sc = put(g, P0, 'Scuttle Crab', BF_A); control(g, BF_A, P0);
  put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Hidden Blade') }), [[sc], 'first']);
  assert.equal(zone(g, sc), 'trash');
  const later = hand(g, P1, 'HidU(2)');
  g = drive(act(g, legal(g, P1, 'hide').find(a => a.type === 'hide' && a.obj === later)!));
  assert.equal(zone(g, later), 'facedown');
  assert.equal(getView(g, P0).state.objects[later]?.cardId, g.objects[later].cardId, 'visible to P0 this turn');
  g = drive(endTurn(g), [], x => x.activePlayer === P0 && x.pending?.kind === 'mainAction');
  assert.notEqual(getView(g, P0).state.objects[later]?.cardId, g.objects[later].cardId, 'hidden again next turn');
});

test('RJ#11888 Shuriken Flip kills the last enemy unit and moves a unit in: the enemy hidden card is trashed in the cleanup before any showdown window', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const e = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const hb = put(g, P1, 'Hidden Blade', { facedown: BF_A });
  const u = put(g, P0, 'V(3)', 'base');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Shuriken Flip') }), [[e], String(BF_A)], x => x.chain.length === 0 && x.pending?.kind === 'showdownAction');   // the only friendly unit is auto-chosen
  assert.equal(zone(g, e), 'trash');
  assert.equal(locOf(g, u), BF_A);
  assert.equal(zone(g, hb), 'trash', 'hidden card already gone when the showdown opens');
  assert.ok(g.showdown && !g.showdown.isCombat, 'RJ#11889: the kill happens before staging, so a non-combat showdown');
  g = drive(g);
  assert.equal(g.battlefields[BF_A].controller, P0, 'conquered');
});

test('RJ#11890 after your only attacker is Gusted away the showdown goes on: with focus you may still play an Action', () => {
  let { g, atk } = attackSetup(['V(2)'], ['V(3)']);
  fundAll(g, P0); fundAll(g, P1);
  const za = hand(g, P0, 'ZapA');
  g = pass(g);
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Gust') }), [[atk[0]]], x => x.chain.length === 0 && x.pending?.kind === 'showdownAction');
  assert.ok(g.players[0].hand.includes(atk[0]));
  assert.ok(g.showdown, 'showdown continues');
  expectPending(g, 'showdownAction', P0);
  assert.ok(canPlayNow(g, P0, za));
});

test('RJ#11893 Blighted Battleaxe\'s end-of-turn trigger: Punch First (Action) can\'t be played in response, only Reactions', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'V(6)', 'base');
  const ax = put(g, P0, 'Blighted Battleaxe', 'base'); attachNow(g, ax, u);
  const pf = hand(g, P0, 'Punch First'), zr = hand(g, P0, 'ZapR');
  g = endTurn(g);
  expectPending(g, 'chainResponse', P0);
  assert.equal(g.chain.length, 1, 'axe trigger on the chain');
  assert.equal(canPlayNow(g, P0, pf), false, 'Action not playable (Closed state)');
  assert.equal(canPlayNow(g, P0, zr), true, 'control: a Reaction is');
});

test('RJ#11894 Blighted Battleaxe on a 4-Might unit that got Punch First: after unattach + 4 damage it survives (9 Might); without Punch First it dies', () => {
  const run = (punch: boolean) => {
    let g = S0(); fundAll(g, P0);
    const u = put(g, P0, 'V(4)', 'base');
    const ax = put(g, P0, 'Blighted Battleaxe', 'base'); attachNow(g, ax, u);
    if (punch) g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Punch First') }), [[u]]);
    g = drive(endTurn(g), [], x => x.activePlayer === P1);
    return zone(g, u);
  };
  assert.equal(run(true), 'base');
  assert.equal(run(false), 'trash');
});

test('RJ#11895 Shadow Clone moving into an empty battlefield (non-combat showdown): no attack trigger, stays 0 Might', () => {
  let g = S0();
  const c = place(g, P0, 'tok-shadow-clone', 'base', { token: true });
  fillTrash(g, P0, 2, 'V(1)');
  g = move(g, P0, [c], BF_A);
  assert.equal(g.chain.length, 0, 'no "when I attack" trigger');
  assert.equal(g.pending?.kind === 'optional', false);
  assert.equal(mightOf(g, c), 0);
});

test('RJ#11896 Spoils of War: the discount is a flat [2] once an enemy unit died (not per death), and applies to every copy played that turn', () => {
  let g = S0(); fundAll(g, P0);
  const a = put(g, P1, 'V(1)', 'base'), b = put(g, P1, 'V(1)', 'base');
  const sw = hand(g, P0, 'Spoils of War');
  assert.equal(playCostOf(g, P0, sw)!.energy, 4);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'KillDraw') }), [[a]]);
  assert.equal(playCostOf(g, P0, sw)!.energy, 2);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'KillDraw') }), [[b]]);
  assert.equal(playCostOf(g, P0, sw)!.energy, 2, 'two deaths: still [2] less');
  g = drive(act(g, { type: 'playCard', player: P0, obj: sw }));
  assert.equal(playCostOf(g, P0, hand(g, P0, 'Spoils of War'))!.energy, 2, 'second copy also discounted');
});

test('RJ#11897 Temporal Breach on Fizz, Trickster: Fizz\'s play trigger can replay that same Temporal Breach from the trash (then it is recycled)', () => {
  let g = S0(); fundAll(g, P0);
  const fz = put(g, P0, 'Fizz, Trickster', 'base');
  const tb = hand(g, P0, 'Temporal Breach');
  g = drive(act(g, { type: 'playCard', player: P0, obj: tb }), [], x => x.pending?.kind === 'chooseCards');
  assert.deepEqual(g.pending!.options!.map(o => o.id), [tb], 'Temporal Breach is in the trash and offered');
  g = drive(g, [[tb]]);
  assert.equal(g.log.filter(l => /P0 plays Temporal Breach/.test(l.text)).length, 2);
  assert.equal(zone(g, tb), 'mainDeck', 'recycled');
  assert.equal(locOf(g, fz), 'base');
});

test('RJ#11899 Akali, Deadly Weapon pulled back (and readied) by an Empowered Rogue Assassin can\'t make a standard move back during the showdown', () => {
  let g = S0(); fundAll(g, P0);
  const leg = setLegend(g, P0, 'Rogue Assassin'); g.objects[leg].empowered = 1;
  const ak = put(g, P0, 'Akali, Deadly Weapon', 'base');
  const v = put(g, P0, 'V(1)', 'base');
  g = drive(move(g, P0, [ak, v], BF_A), ['no'], x => x.pending?.kind === 'showdownAction' && x.pending.player === P0 && x.chain.length === 0);
  const ab = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === leg);
  g = drive(act(g, ab!), [[ak], 'no'], x => x.pending?.kind === 'showdownAction' && x.chain.length === 0);
  assert.equal(locOf(g, ak), 'base');
  assert.equal(g.objects[ak].exhausted, false, 'readied (Empowered legend)');
  assert.ok(g.showdown);
  assert.deepEqual(moveDests(g, P0, ak), [], 'no standard move during a showdown');
});

test('RJ#11901 Ride the Wind readies a stunned Irelia, Fervent but she stays stunned (readying doesn\'t clear Stunned)', () => {
  let g = S0(); fundAll(g, P0);
  const ir = put(g, P0, 'Irelia, Fervent', BF_A, { stunned: true, ready: false }); control(g, BF_A, P0);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Ride the Wind') }), ['base']);   // the only friendly unit is auto-chosen
  assert.equal(locOf(g, ir), 'base');
  assert.equal(g.objects[ir].exhausted, false);
  assert.equal(g.objects[ir].stunned, true);
  assert.equal(mightOf(g, ir), 6, '+1 chosen, +1 readied');
});

test('RJ#11902 Flash in response to Vi, Peacekeeper\'s attack trigger moves its target to base: the stun ("here") does nothing', () => {
  let g = S0(); fundAll(g, P1);
  const e = put(g, P1, 'V(3)', BF_A), e2 = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const vi = put(g, P0, 'Vi, Peacekeeper', 'base');
  g = drive(move(g, P0, [vi], BF_A), [[e]], x => x.pending?.player === P1 && x.chain.length > 0);
  assert.deepEqual(chainLabels(g), ['trigger:Vi']);
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Flash') }), [[e]], x => x.chain.length === 0);
  assert.equal(locOf(g, e), 'base');
  assert.ok(!g.objects[e].stunned, 'not stunned');
  assert.ok(!g.objects[e2].stunned);
});

test('RJ#11903 Pendulum Blade moved off Kai\'Sa, Survivor (Veteran Poro\'s Weaponmaster): she loses the +1 but keeps the resolved +2 → 6', () => {
  let g = S0(); fundAll(g, P0);
  const k = put(g, P0, "Kai'Sa, Survivor", 'base');
  const pb = put(g, P0, 'Pendulum Blade', 'base'); attachNow(g, pb, k);
  g = drive(move(g, P0, [k], BF_A));
  assert.equal(mightOf(g, k), 7);
  const vp = hand(g, P0, 'Veteran Poro');
  g = drive(act(g, { type: 'playCard', player: P0, obj: vp, destination: 'base' }), [[pb]]);
  assert.equal(g.objects[pb].attachedTo, vp);
  assert.equal(mightOf(g, k), 6);
});

test('RJ#11905 an Empowered unit that becomes a copy (Shady Spectacles) of an unempowered Empower unit keeps its Empowered status', () => {
  let g = S0(); fundAll(g, P0);
  const a = put(g, P0, 'V(2)', 'base'); g.objects[a].empowered = 1;
  const b = put(g, P0, 'Ambessa, Respected and Feared', 'base');
  const sp = put(g, P0, 'Shady Spectacles', 'base');
  g = drive(act(g, { type: 'activate', player: P0, obj: sp, abilityIndex: EQUIP }), [[a], [b]]);
  assert.equal(chars(g, a).name, 'Ambessa');
  assert.equal(g.objects[a].empowered, 1, 'still Empowered');
  assert.equal(hasKeyword(g, a, 'Assault'), true, 'the copied [Empowered] static sees its Empowered status');
  assert.equal(g.objects[b].empowered ?? 0, 0);
});

test('RJ#11906 Astral Heron in base when the first card is played gives no discount, even if moved to a battlefield afterwards', () => {
  let g = S0(); fundAll(g, P0);
  const h = put(g, P0, 'Astral Heron', 'base');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'V(1)'), destination: 'base' }));
  g = drive(move(g, P0, [h], BF_A));
  assert.equal(locOf(g, h), BF_A);
  assert.equal(playCostOf(g, P0, hand(g, P0, 'Astral Heron'))!.energy, 7, 'no discount');
});

test('RJ#11907 Vex, Apathetic stuns an opponent\'s Deflect unit (Irelia, Fervent) without paying Deflect — it doesn\'t choose', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1); fundAll(g, P0);
  put(g, P0, 'Vex, Apathetic', BF_A); control(g, BF_A, P0);
  const ir = hand(g, P1, 'Irelia, Fervent');
  const n0 = g.players[0].runesInPlay.length;
  g = drive(act(g, { type: 'playCard', player: P1, obj: ir, destination: 'base' }));
  assert.equal(g.objects[ir].stunned, true);
  assert.equal(g.players[0].runesInPlay.length, n0, 'no Deflect paid');
  assert.equal(mightOf(g, ir), 4, 'not "chosen" (no Irelia +1)');
});

test('RJ#11908 combat cleanup heals damage but keeps "this turn" Might effects (Punch First)', () => {
  let { g, atk, def } = attackSetup(['V(3)'], ['V(3)']);
  fundAll(g, P0);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Punch First') }), [[atk[0]]], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, def[0]), 'trash');
  assert.equal(locOf(g, atk[0]), BF_A);
  assert.equal(g.objects[atk[0]].damage, 0, 'healed');
  assert.equal(mightOf(g, atk[0]), 8, '+5 this turn kept');
});

test('RJ#11910 with 7 runes, Thousand-Tailed Watcher can\'t use Curator of the Sands\' readied runes for its Accelerate (cost paid before the trigger)', () => {
  let g = S0();
  const w = hand(g, P0, 'Thousand-Tailed Watcher');
  setRunes(g, P0, 7, 'mind');
  setLegend(g, P0, 'Curator of the Sands');
  g = act(g, { type: 'playCard', player: P0, obj: w, destination: 'base' });
  assert.ok(!(g.pending?.kind === 'optional' && /Accelerate/.test(g.pending.prompt)), 'Accelerate not payable');
  g = drive(g, ['0', 'yes', [g.players[0].runesInPlay[0], g.players[0].runesInPlay[1]]]);
  assert.equal(g.objects[w].exhausted, true, 'entered exhausted');
  assert.equal(g.players[0].runesInPlay.filter(r => !g.objects[r].exhausted).length, 2, 'runes readied only afterwards');
});

test('RJ#11911 Blade Dancer triggers when Discipline chooses an exhausted unit: it goes on the chain above Discipline and readies it first', () => {
  let g = S0(); fundAll(g, P0);
  setLegend(g, P0, 'Blade Dancer');
  const u = put(g, P0, 'V(2)', 'base', { ready: false });
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Discipline') }), ['yes'], x => x.pending?.kind === 'chainResponse');   // the only unit is auto-chosen
  assert.deepEqual(chainLabels(g), ['spell:Discipline', 'trigger:Blade Dancer']);
  g = drive(g, [], x => x.chain.length === 1);
  assert.equal(g.objects[u].exhausted, false, 'readied before Discipline resolves');
  assert.equal(mightOf(g, u), 2);
  g = drive(g);
  assert.equal(mightOf(g, u), 4);
});

test('RJ#11912 attacking Baron Nashor: Nine-Tailed Fox\'s -1 (no choosing) applies; Ahri, Inquisitive can\'t choose him', () => {
  let g = S0();
  setLegend(g, P1, 'Nine-Tailed Fox');
  put(g, P1, 'Ahri, Inquisitive', BF_A); control(g, BF_A, P1);
  const bn = put(g, P0, 'Baron Nashor', 'base');
  g = drive(move(g, P0, [bn], BF_A), ['0'], x => x.pending?.kind === 'showdownAction' && x.chain.length === 0);
  assert.equal(mightOf(g, bn), 11, 'only the Fox\'s -1');
});

test('RJ#11915 Temporal Breach replaying Thousand-Tailed Watcher ignores its cost but Accelerate is still an optional cost paid in full', () => {
  let g = S0(); fundAll(g, P0);
  const w = put(g, P0, 'Thousand-Tailed Watcher', 'base');
  const n0 = g.players[0].runesInPlay.length;
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Temporal Breach') }), [], x => x.pending?.kind === 'optional');
  assert.match(g.pending!.prompt, /Accelerate/);
  g = drive(g, ['yes', 'no']);
  assert.equal(locOf(g, w), 'base');
  assert.equal(g.objects[w].exhausted, false, 'entered ready');
  const used = (n0 - g.players[0].runesInPlay.length) + g.players[0].runesInPlay.filter(r => g.objects[r].exhausted).length;
  assert.equal(n0 - g.players[0].runesInPlay.length, 2, 'two Power: Temporal Breach [A] + Accelerate [C]');
  assert.equal(used, 3, 'three Energy: Temporal Breach [2] + Accelerate [1] (Watcher\'s [7] ignored)');
});

test('RJ#11918 Diana, Lunari attacks a battlefield with an enemy Diana: the attacker\'s showdown trigger goes on the chain first, the defender\'s resolves first', () => {
  let g = S0();
  const d1 = put(g, P1, 'Diana, Lunari', BF_A); control(g, BF_A, P1);
  const d0 = put(g, P0, 'Diana, Lunari', 'base');
  g = drive(move(g, P0, [d0], BF_A), ['yes', 'yes'], x => x.pending?.kind === 'chainResponse');
  assert.deepEqual(chainSources(g), [d0, d1]);
});

test('RJ#11920 Forge of the Future\'s "Kill this" ability has no Reaction: usable in your open main phase, not on a chain or in a showdown', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  const f = put(g, P0, 'Forge of the Future', 'base');
  const forge = (s: typeof g) => legal(s, P0, 'activate').some(a => a.type === 'activate' && a.obj === f);
  assert.ok(forge(g), 'main phase, open state');
  const e = put(g, P1, 'V(5)', 'base');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'ZapM') }), [[e]], x => x.pending?.kind === 'chainResponse');
  assert.equal(forge(g), false, 'not in response');
  g = drive(g);
  g = move(g, P0, [put(g, P0, 'V(1)', 'base')], BF_A);
  assert.ok(g.showdown);
  assert.equal(forge(g), false, 'not during a showdown');
});

test('RJ#11921 Tornado Warrior empowers Tail-Cloaked Matriarch, which plays Shen, Kinkou from the trash: Shen enters at base (Reaction doesn\'t change the destination)', () => {
  let g = S0(); fundAll(g, P0);
  const m = put(g, P0, 'Tail-Cloaked Matriarch', BF_A); control(g, BF_A, P0);
  const sh = put(g, P0, 'Shen, Kinkou', 'trash');
  const tw = put(g, P0, 'Tornado Warrior', { facedown: BF_A });
  g = drive(act(g, { type: 'playCard', player: P0, obj: tw }), ['yes', [m], 'yes'], x => x.pending?.kind === 'mainAction' || x.pending?.kind === 'chooseDestination');
  assert.notEqual(g.pending?.kind, 'chooseDestination', 'no destination choice');
  assert.equal(g.objects[m].empowered, 1);
  assert.equal(locOf(g, sh), 'base');
});

test('RJ#11922 Riposte can counter Bone Skewer (any spell; no target requirement on the countered spell)', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  for (const id of g.players[1].hand) delete g.objects[id];
  g.players[1].hand = [];
  const pu = put(g, P1, 'V(7)', 'base');
  const bs = hand(g, P0, 'Bone Skewer');
  g = drive(act(g, { type: 'playCard', player: P0, obj: bs }), ['first'], x => x.pending?.player === P1);
  const rp = hand(g, P1, 'Riposte');
  assert.ok(canPlayNow(g, P1, rp));
  g = drive(act(g, { type: 'playCard', player: P1, obj: rp }), [[pu], /Bone/]);
  assert.equal(zone(g, bs), 'trash');
  assert.equal(mightOf(g, pu), 7 + g.cards[g.objects[bs].cardId].energy!, '+Might equal to its Energy cost');
});

test('RJ#11923 Riposte needs a friendly unit as well as a spell: with no friendly unit it can\'t be played', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const mine = put(g, P0, 'V(3)', 'base');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'ZapM') }), [[mine]], x => x.pending?.player === P1);
  const rp = hand(g, P1, 'Riposte');
  assert.equal(canPlayNow(g, P1, rp), false, 'no friendly unit');
  put(g, P1, 'V(1)', 'base');
  assert.equal(canPlayNow(g, P1, rp), true, 'control');
});

test('RJ#11925 the card Sabotage chooses is recycled at once (no window to play it); it could only be played while Sabotage was on the chain', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const zr = hand(g, P1, 'ZapR');
  put(g, P0, 'V(5)', 'base');   // a target for ZapR
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Sabotage') }), [], x => x.pending?.player === P1);
  assert.ok(canPlayNow(g, P1, zr), 'playable while Sabotage is on the chain');
  g = drive(g, [[zr]], x => x.pending?.player === P1 && x.chain.length === 0 || x.pending?.kind === 'mainAction');
  assert.equal(zone(g, zr), 'mainDeck', 'recycled during resolution');
});

test('RJ#11926 Switcheroo chooses its units: an enemy unit under Twilight Shroud can\'t be chosen (no legal pair → unplayable)', () => {
  const run = (shroud: boolean) => {
    let g = S0(); fundAll(g, P0); fundAll(g, P1);
    const a = put(g, P0, 'V(6)', 'base');
    put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
    if (shroud) g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Twilight Shroud') }), [[a]]);
    const sw = hand(g, P1, 'Switcheroo');
    g = pass(move(g, P0, [a], BF_A));
    expectPending(g, 'showdownAction', P1);
    return canPlayNow(g, P1, sw);
  };
  assert.equal(run(true), false);
  assert.equal(run(false), true, 'control');
});

test('RJ#11927 Pickpocket can kill Seal of Discord (Energy cost 0; its Power cost is irrelevant)', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  const s = put(g, P1, 'Seal of Discord', 'base');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Pickpocket'), destination: 'base' }), ['yes', [s]]);
  assert.equal(zone(g, s), 'trash');
});

test('RJ#11928 a Reflection made by Deceiver that becomes a copy of Lecturing Yordle does not draw (copy applies after it entered)', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  setLegend(g, P0, 'Deceiver');
  const y = put(g, P0, 'Lecturing Yordle', 'base');
  const d = hand(g, P0, 'V(1)');
  const h0 = g.players[0].hand.length;
  g = drive(move(g, P0, [y], BF_A), ['yes', [d]]);
  const refl = Object.keys(g.objects).filter(id => g.objects[id].zone === 'battlefield' && g.objects[id].isToken);
  assert.equal(refl.length, 1);
  assert.equal(chars(g, refl[0]).name, 'Lecturing Yordle', 'Reflection copies the Yordle');
  assert.equal(g.players[0].hand.length - h0, -1, 'discarded 1, drew nothing');
});

test('RJ#11929 a 5-Might unit debuffed this turn returns to 5 when the debuff expires: that is "becoming Mighty" (Grand Duelist triggers)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1);
  setLegend(g, P0, 'Grand Duelist');
  const u = put(g, P0, 'V(5)', 'base');
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Stupefy') }), [[u]]);
  assert.ok(mightOf(g, u)! < 5);
  g = drive(endTurn(g), [], x => x.pending?.kind === 'optional' || (x.activePlayer === P0 && x.pending?.kind === 'mainAction'));
  assert.equal(g.pending?.kind, 'optional');
  assert.match(g.pending!.prompt, /Grand Duelist/);
  g = drive(g, ['yes'], x => x.activePlayer === P0 && x.pending?.kind === 'mainAction');
  assert.ok(g.log.some(l => /Resolving Grand Duelist/.test(l.text)));
});

test('RJ#11930 (MISMATCH-RJ) Dragon Form\'s "base Might becomes 5" (layer 2) beats a later Shady Spectacles copy (layer 1): 5 while attached and after it is killed', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  const t = put(g, P0, 'Recruit', 'base');
  const big = put(g, P0, 'V(10)', 'base');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Dragon Form') }), [[t]]);
  assert.equal(mightOf(g, t), 5);
  const sp = put(g, P0, 'Shady Spectacles', 'base');
  g = drive(act(g, { type: 'activate', player: P0, obj: sp, abilityIndex: EQUIP }), [[t], [big]]);
  assert.equal(g.objects[sp].attachedTo, t);
  assert.equal(mightOf(g, t), 5, 'CR 479.1 copy (layer 1) then 479.2 base Might (layer 2): 5, not RJ\'s 10');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'KillGearM') }), [[sp]]);
  assert.equal(zone(g, sp), 'trash');
  assert.equal(mightOf(g, t), 5);
});

test('RJ#11932 a hidden card (hidden on an earlier turn) can be played in response to a "when I move" trigger, not one hidden this turn', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const old = put(g, P1, 'HidU(2)', { facedown: BF_A });
  const fresh = put(g, P1, 'HidU(2)', { facedown: BF_A, hiddenTurn: g.turn });
  const u = put(g, P0, 'V(2)', 'base');
  const pb = put(g, P0, 'Pendulum Blade', 'base'); attachNow(g, pb, u);
  g = drive(move(g, P0, [u], BF_B), [], x => x.pending?.player === P1 && x.chain.length > 0);
  assert.equal(g.chain.length, 1, '"when I move" trigger on the chain');
  assert.ok(canPlayNow(g, P1, old, BF_A));
  assert.equal(canPlayNow(g, P1, fresh, BF_A), false, 'hidden this turn');
});

test('RJ#11934 Equip uses the chain: the opponent may respond only with Reactions (Salvage, an Action, can\'t)', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P0, 'V(2)', 'base');
  const bt = put(g, P0, 'Boots of Swiftness', 'base');
  const sv = hand(g, P1, 'Salvage'), kr = hand(g, P1, 'KillGearR');
  g = drive(act(g, { type: 'activate', player: P0, obj: bt, abilityIndex: EQUIP }), [], x => x.pending?.player === P1);
  assert.equal(g.chain.length, 1, 'equip on the chain');
  assert.equal(canPlayNow(g, P1, sv), false, 'Action: no');
  assert.equal(canPlayNow(g, P1, kr), true, 'Reaction: yes');
  void u;
});

test('RJ#11936 Gust Monk\'s [1] additional cost can be paid with empty trashes; the banish-for-Assault trigger then can\'t be paid and does nothing', () => {
  let g = S0(); fundAll(g, P0);
  assert.equal(g.players[0].trash.length + g.players[1].trash.length, 0);
  const gm = hand(g, P0, 'Gust Monk');
  const ex0 = g.players[0].runesInPlay.filter(r => g.objects[r].exhausted).length;
  g = act(g, { type: 'playCard', player: P0, obj: gm, destination: 'base' });
  expectPending(g, 'optional', P0, 'additional cost offered');
  g = drive(g, ['yes']);
  assert.equal(locOf(g, gm), 'base');
  assert.equal(g.players[0].runesInPlay.filter(r => g.objects[r].exhausted).length - ex0, 3, '2 + the [1]');
  assert.equal(g.chain.length, 0);
  assert.ok(!Object.keys(g.objects).some(id => ['base', 'battlefield'].includes(g.objects[id].zone) && hasKeyword(g, id, 'Assault')), 'no Assault given');
});

test('RJ#11938 Hostile Takeover (first card) stealing an Astral Heron at a battlefield: Heron sees the play complete and discounts the next card', () => {
  let g = S0(); fundAll(g, P0);
  const h = put(g, P1, 'Astral Heron', BF_A); control(g, BF_A, P1);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Hostile Takeover') }), [[h]]);
  assert.equal(g.objects[h].controller, P0);
  assert.equal(playCostOf(g, P0, hand(g, P0, 'Astral Heron'))!.energy, 5, '7 - 2');
});

test('RJ#11939 defending Glasc Mixologist dies; its Deathknell plays Galio there before the combat result: new combat, Galio deals nothing, the attacker is recalled', () => {
  let g = S0();
  const ga = put(g, P1, 'Galio, Indefatigable', 'trash');
  put(g, P1, 'Glasc Mixologist', BF_A); control(g, BF_A, P1);
  const a = [put(g, P0, 'Stellacorn Herder', 'base'), put(g, P0, 'Stellacorn Herder', 'base')];
  g = drive(move(g, P0, a, BF_A), ['0', [ga], String(BF_A)]);
  assert.equal(locOf(g, ga), BF_A);
  assert.deepEqual(a.map(x => zone(g, x)).sort(), ['base', 'trash'], 'one Herder died, the other was recalled');
  assert.equal(g.battlefields[BF_A].controller, P1, 'defender keeps the battlefield');
});

test('RJ#11940 conquering Emperor\'s Dais with a Last Rites unit: the Dais cost (return a unit here) is paid on finalization, before Last Rites can bring Tideturner there', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  setBattlefieldCard(g, BF_A, "Emperor's Dais");
  const tt = put(g, P0, 'Tideturner', 'trash');
  const u = put(g, P0, 'V(2)', 'base');
  const lr = put(g, P0, 'Last Rites', 'base'); attachNow(g, lr, u);
  g = drive(move(g, P0, [u], BF_A), ['1', [tt]], x => x.pending?.kind === 'optional' && /Dais/.test(x.pending.prompt));
  assert.equal(zone(g, tt), 'trash', 'Tideturner not yet on the board when the Dais trigger finalizes');
  g = drive(g, ['yes', 'base', []]);
  assert.ok(g.players[0].hand.includes(u), 'the unit at the Dais paid the cost');
  assert.equal(locOf(g, tt), 'base');
});

test('RJ#11946 the Sand Soldier played by Emperor\'s Dais (after returning your only unit there) triggers Pridestalker; the +1 may go to any unit', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  setBattlefieldCard(g, BF_A, "Emperor's Dais");
  setLegend(g, P0, 'Pridestalker');
  const u = put(g, P0, 'V(2)', 'base');
  const o = put(g, P0, 'V(3)', 'base');
  g = drive(move(g, P0, [u], BF_A), ['yes', [o]]);
  assert.ok(g.players[0].hand.includes(u));
  assert.deepEqual(unitsNamed(g, 'Sand Soldier').map(s => locOf(g, s)), [BF_A]);
  assert.equal(mightOf(g, o), 4, 'Pridestalker +1 on a unit in base');
});

test('RJ#11948 Kennen, Storm of Shuriken conquering Zaun Warrens: his trash spell is chosen when the trigger is chained, so a spell the Warrens discards can\'t be chosen', () => {
  let g = S0(); fundAll(g, P0);
  setBattlefieldCard(g, BF_A, 'Zaun Warrens');
  const t = put(g, P0, 'ZapM', 'trash');
  const k = put(g, P0, 'Kennen, Storm of Shuriken', 'base');
  const h = hand(g, P0, 'ZapA');
  g = drive(move(g, P0, [k], BF_A), ['1'], x => x.pending?.kind === 'mainAction');   // Kennen resolves last
  assert.equal(zone(g, h), 'trash', 'discarded by the Warrens');
  put(g, P1, 'V(5)', 'base');   // a target for the Zaps
  assert.ok(canPlayNow(g, P0, t), 'the spell chosen at chaining got Flow');
  assert.equal(canPlayNow(g, P0, h), false, 'the later-discarded spell did not');
});

test('RJ#11949 a 5-Might attacker vs Zed, Without a Sound + Shadow Clone: all 5 to Zed is legal; Zed and the attacker die, the Clone keeps the battlefield (no conquer: already controlled)', () => {
  let g = S0();
  const z = put(g, P1, 'Zed, Without a Sound', BF_A); control(g, BF_A, P1);
  const c = place(g, P1, 'tok-shadow-clone', BF_A, { token: true });
  const a = put(g, P0, 'V(5)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 10 && g.pending?.kind !== 'assignDamage'; i++) g = pass(g);
  expectPending(g, 'assignDamage', P0);
  g = drive(act(g, { type: 'assignDamage', player: P0, assignment: { [z]: 5, [c]: 0 } }));
  assert.equal(zone(g, a), 'trash');
  assert.equal(zone(g, z), 'trash');
  assert.equal(zone(g, c), 'battlefield');
  assert.equal(g.battlefields[BF_A].controller, P1);
  assert.equal(g.players[1].points, 0, 'keeping control is not a conquer');
});

test('RJ#11952 Void Rush banishing neither revealed card draws both', () => {
  let g = S0(); fundAll(g, P0);
  const a = put(g, P0, 'V(2)', 'deckTop'), b = put(g, P0, 'V(3)', 'deckTop');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Void Rush') }), [[]]);
  assert.ok(g.players[0].hand.includes(a) && g.players[0].hand.includes(b));
});

test('RJ#11953 Fortified Position\'s Shield 2 lasts "this combat": a second combat the same turn gives Shield 2 again, not 4', () => {
  let g = S0();
  setBattlefieldCard(g, BF_A, 'Fortified Position');
  const d = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const a1 = put(g, P0, 'V(1)', 'base'), a2 = put(g, P0, 'V(1)', 'base');
  g = drive(move(g, P0, [a1], BF_A), ['first'], x => x.pending?.kind === 'showdownAction' && x.chain.length === 0);
  assert.equal(kwValue(g, d, 'Shield'), 2);
  g = drive(g);
  assert.equal(kwValue(g, d, 'Shield'), 0, 'ended with the combat');
  g = drive(move(g, P0, [a2], BF_A), ['first'], x => x.pending?.kind === 'showdownAction' && x.chain.length === 0);
  assert.equal(kwValue(g, d, 'Shield'), 2, 'second combat: Shield 2 again');
});

test('RJ#11954 Kennen, Keeper of Balance Gusted in response to his paid attack stun: the stun still happens (no "here")', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const k = put(g, P0, 'Kennen, Keeper of Balance', 'base');
  g = drive(move(g, P0, [k], BF_A), ['yes', [e]], x => x.pending?.player === P1 && x.chain.length > 0);
  assert.deepEqual(chainLabels(g), ['trigger:Kennen']);
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Gust') }), [[k]], x => x.chain.length === 0);
  assert.ok(g.players[0].hand.includes(k));
  assert.equal(g.objects[e].stunned, true);
});

test('RJ#11955 a repeated Bellows Breath at Void Gate deals 2 per execution (bonus per instance): 4 total to a unit chosen both times', () => {
  let g = S0(); fundAll(g, P0);
  setBattlefieldCard(g, BF_A, 'Void Gate');
  const e = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Bellows Breath') }), [[e], 'yes', [e]]);
  assert.equal(g.objects[e].damage, 4);
});

test('RJ#11956 Stupefy on a 1-Might unit does nothing (minimum 1, snapshotted); a later +2 makes it 3', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P1, 'V(1)', 'base');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Stupefy') }), [[u]]);
  assert.equal(mightOf(g, u), 1);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Discipline') }), [[u]]);
  assert.equal(mightOf(g, u), 3);
});

test('RJ#11957 Shady Spectacles\' copy choice is made as it attaches: a unit Star-Crossed in response can\'t be copied (another friendly unit can; none → plain attach)', () => {
  const run = (third: boolean) => {
    let g = S0(); fundAll(g, P0); fundAll(g, P1);
    const s = put(g, P0, 'V(1)', 'base'), tg = put(g, P0, 'V(6)', 'base');
    const x = third ? put(g, P0, 'V(3)', 'base') : undefined;
    const sp = put(g, P0, 'Shady Spectacles', 'base');
    put(g, P1, 'V(2)', 'base');
    g = drive(act(g, { type: 'activate', player: P0, obj: sp, abilityIndex: EQUIP }), [[s]], d => d.pending?.player === P1 && d.pending.kind === 'chainResponse');
    g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Star-Crossed') }), [[tg]]);
    assert.ok(g.players[0].hand.includes(tg));
    assert.equal(g.objects[sp].attachedTo, s, 'attach still happens');
    return { name: chars(g, s).name, might: mightOf(g, s), x };
  };
  const a = run(true);
  assert.equal(a.might, 3, 'copies the remaining friendly unit');
  const b = run(false);
  assert.equal(b.might, 1, 'no unit to copy: stays itself');
});

test('RJ#11958 choosing a unit for an Equip ability triggers Blade Dancer (it may ready that unit)', () => {
  let g = S0(); fundAll(g, P0);
  setLegend(g, P0, 'Blade Dancer');
  const u = put(g, P0, 'V(2)', 'base', { ready: false });
  const pb = put(g, P0, 'Pendulum Blade', 'base');
  g = drive(act(g, { type: 'activate', player: P0, obj: pb, abilityIndex: EQUIP }), ['yes']);   // the only unit is auto-chosen
  assert.equal(g.objects[pb].attachedTo, u);
  assert.equal(g.objects[u].exhausted, false, 'readied by Blade Dancer');
});

test('RJ#11960 Soul\'s Reflection (Mel legend) activated ability has no Reaction: not usable on the opponent\'s turn (even with priority)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const leg = setLegend(g, P0, "Soul's Reflection"); g.objects[leg].empowered = 1;
  put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const pu = put(g, P1, 'V(3)', 'base');
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'ZapM') }), [[pu]], x => x.pending?.player === P0);
  assert.equal(legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === leg), false);
  let h = S0(); fundAll(h, P0);
  const l2 = setLegend(h, P0, "Soul's Reflection"); h.objects[l2].empowered = 1;
  put(h, P1, 'V(3)', BF_A); control(h, BF_A, P1);
  assert.ok(legal(h, P0, 'activate').some(a => a.type === 'activate' && a.obj === l2), 'control: own main phase');
});

test('RJ#11961 a Bird token played by Carrion Dredger\'s Deathknell is not a card played: Legion (Noxus Hopeful) stays off', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  const cd = put(g, P0, 'Carrion Dredger', 'base');
  const nh = hand(g, P0, 'Noxus Hopeful');
  assert.equal(playCostOf(g, P0, nh)!.energy, 4);
  put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  g = drive(move(g, P0, [cd], BF_A));
  assert.equal(zone(g, cd), 'trash');
  assert.equal(unitsNamed(g, 'Bird').length, 1);
  assert.equal(playCostOf(g, P0, nh)!.energy, 4, 'no Legion discount');
});

test('RJ#11962 Baited Hook\'s unit can be played to base or any battlefield you control (also where the killed unit was)', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
  const top = put(g, P0, 'V(2)', 'deckTop');
  const bh = put(g, P0, 'Baited Hook', 'base');
  g = drive(act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === bh)!), [[u], [top]], x => x.pending?.kind === 'chooseDestination');
  assert.deepEqual(g.pending!.options!.map(o => o.id).sort(), ['0', '1', 'base']);
  g = drive(g, [String(BF_B)]);
  assert.equal(locOf(g, top), BF_B);
});

test('RJ#11964 paying with three Gold tokens (each "Kill this, [T]: [Add] [A]" is a gear activated ability) gives Prize of Progress +3', () => {
  const run = (gear: string) => {
    let g = withTokens(S0()); setRunes(g, P0, 4, 'mind');
    const pp = put(g, P0, 'Prize of Progress', BF_A); control(g, BF_A, P0);
    const gs = [0, 1, 2].map(() => put(g, P0, gear, 'base'));
    for (const gd of gs) g = drive(act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === gd)!), [], x => x.chain.length === 0);
    g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Premonition') }));
    return mightOf(g, pp);
  };
  assert.equal(run('Seal of Discord'), 6, 'control: a gear that stays on the board');
  assert.equal(run('Gold'), 6, 'Gold tokens killed as their own cost still count');
});

test('RJ#11965 Moonfall pulls your only unit from a battlefield with your hidden Tideturner: it is trashed in the cleanup; with another unit there, you can play it in the showdown', () => {
  const run = (second: boolean) => {
    let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
    const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
    if (second) put(g, P0, 'V(1)', BF_A);
    const tt = put(g, P0, 'Tideturner', { facedown: BF_A });
    put(g, P1, 'V(9)', BF_B); control(g, BF_B, P1);
    g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Moonfall') }), [[u]], x => x.pending?.kind === 'showdownAction');
    assert.equal(locOf(g, u), BF_B);
    expectPending(g, 'showdownAction', P0, 'the pulled unit\'s controller is the attacker and has focus');
    return { z: zone(g, tt), can: canPlayNow(g, P0, tt) };
  };
  assert.deepEqual(run(false), { z: 'trash', can: false });
  assert.deepEqual(run(true), { z: 'facedown', can: true });
});

test('RJ#11966 repeated Frigid Touch with an empowered Mel, Newly Awakened: -3 per execution on one unit (total -6)', () => {
  let g = S0(); fundAll(g, P0);
  const mel = put(g, P0, 'Mel, Newly Awakened', 'base'); g.objects[mel].empowered = 3;
  const a = put(g, P1, 'V(9)', 'base');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Frigid Touch') }), [[a], 'yes', [a]]);
  assert.equal(mightOf(g, a), 3);
});

test('RJ#11967 Mirror Image gives Temporary to the Reflection token, not to the chosen unit', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  const u = put(g, P0, 'V(3)', 'base');
  const before = new Set(Object.keys(g.objects));
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Mirror Image') }), [[u]]);
  const refl = Object.keys(g.objects).filter(id => !before.has(id) && g.objects[id].isToken && g.objects[id].zone === 'base');
  assert.equal(refl.length, 1);
  assert.equal(hasKeyword(g, refl[0], 'Temporary'), true);
  assert.equal(hasKeyword(g, u, 'Temporary'), false);
});

test('RJ#11968 Virtuoso\'s "channel 4 runes" channels them ready', () => {
  let g = S0(); setRunes(g, P0, 4, 'body');
  const leg = setLegend(g, P0, 'Virtuoso');
  const bs = [0, 1, 2].map(() => put(g, P0, 'ZapM', 'banishment'));
  for (const b of bs) g.ex.links[b] = { by: leg, epoch: g.objects[leg].epoch ?? 0 };
  put(g, P0, 'V(2)', 'base');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Onslaught') }), ['yes']);
  assert.equal(g.players[0].runesInPlay.length, 8);
  assert.equal(g.players[0].runesInPlay.filter(r => !g.objects[r].exhausted).length, 4, 'the 4 new runes are ready (the 4 old ones paid)');
});

test('RJ#11969 Ruined Rex dies defending vs Akali, Silent with Karthus: two Deathknells may choose Akali (still in combat during cleanup), 4+4 kills her', () => {
  let g = S0();
  const rex = put(g, P1, 'Ruined Rex', BF_A); control(g, BF_A, P1);
  put(g, P1, 'Karthus, Eternal', 'base');
  const ak = put(g, P0, 'Akali, Silent', 'base', { buff: true });
  put(g, P0, 'V(1)', 'base');
  g = drive(move(g, P0, [ak], BF_A), [], x => x.pending?.kind === 'chooseTargets');
  assert.equal(zone(g, rex), 'trash');
  assert.ok(g.pending!.options!.some(o => o.id === ak), 'Akali (in combat) can be chosen');
  g = drive(g, [[ak], [ak]]);
  assert.equal(zone(g, ak), 'trash');
});

test('RJ#11972 an opponent\'s Helm of Suppression does not raise the cost of playing a hidden unit (only spells)', () => {
  const g = S0(); fundAll(g, P0);
  put(g, P1, 'Helm of Suppression', 'base');
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const hu = put(g, P0, 'HidU(2)', { facedown: BF_A });
  const c = playCostOf(g, P0, hu)!;
  assert.equal(c.energy, 0);
  assert.equal(c.power.length, 0);
});

test('RJ#11974 defending Ahri, Inquisitive replayed by hidden Temporal Breach is a new object: her "When I defend" triggers again', () => {
  let g = S0(); fundAll(g, P1);
  const ah = put(g, P1, 'Ahri, Inquisitive', BF_A); control(g, BF_A, P1);
  const tb = put(g, P1, 'Temporal Breach', { facedown: BF_A });
  const a = put(g, P0, 'V(9)', 'base');
  g = drive(move(g, P0, [a], BF_A), [], x => x.pending?.kind === 'showdownAction' && x.pending.player === P1 && x.chain.length === 0);
  assert.equal(mightOf(g, a), 7, 'first defend trigger');
  g = drive(act(g, { type: 'playCard', player: P1, obj: tb }), [[ah]], x => x.pending?.kind === 'showdownAction' && x.chain.length === 0);
  assert.equal(mightOf(g, a), 5, 'the new Ahri defends and triggers again');
});

test('RJ#11976 Rek\'Sai, Breacher gives a Shadow Clone token (Zed, From the Shadows) Accelerate: paid → enters ready (domainless token: [1][A]); declined → exhausted', () => {
  const run = (pay: boolean) => {
    let g = withTokens(S0()); fundAll(g, P0);
    put(g, P0, "Rek'Sai, Breacher", 'base');
    hand(g, P0, 'V(1)');
    let asked = false;
    g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Zed, From the Shadows'), destination: 'base' }), [], x => x.pending?.kind === 'optional');
    g = ans(g, 'yes');                                   // discard 1 (additional cost)
    g = drive(g, [], x => x.pending?.kind === 'optional');
    if (/Accelerate/.test(g.pending?.prompt ?? '')) asked = true;
    g = drive(g, [pay ? 'yes' : 'no']);
    const c = unitsNamed(g, 'Shadow Clone');
    assert.equal(c.length, 1);
    return { asked, ready: !g.objects[c[0]].exhausted };
  };
  assert.deepEqual(run(true), { asked: true, ready: true });
  assert.deepEqual(run(false), { asked: true, ready: false });
});

test('RJ#11977 Cursed Sarcophagus can only play units it banished itself, not a unit banished by a Shadow Clone\'s attack trigger', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  const x = put(g, P0, 'V(2)', 'trash');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Cursed Sarcophagus') }));
  const sar = Object.keys(g.objects).find(id => nameOf(g, id) === 'Cursed Sarcophagus' && g.objects[id].zone === 'base')!;
  assert.equal(zone(g, x), 'banishment', 'banished with the Sarcophagus');
  const y = put(g, P0, 'V(3)', 'trash');
  const c = place(g, P0, 'tok-shadow-clone', 'base', { token: true });
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  g = drive(move(g, P0, [c], BF_A), ['yes', [y]]);
  assert.equal(zone(g, y), 'banishment', 'banished by the Clone');
  const a = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === sar)!;
  g = drive(act(g, a), [], x2 => x2.pending?.kind === 'chooseDestination');
  assert.match(g.pending!.prompt ?? '', /V\(2\)/, 'only the Sarcophagus\' own unit is offered');
  g = drive(g, ['base']);
  assert.equal(zone(g, x), 'base');
  assert.equal(zone(g, y), 'banishment');
});

test('RJ#11978 Master of Shadows (Zed legend): "Discard 1, then draw 1" can be activated with an empty hand — nothing discarded, still draw 1', () => {
  let g = S0();
  const leg = setLegend(g, P0, 'Master of Shadows'); g.objects[leg].empowered = 1; g.timestamp++;
  assert.equal(g.players[P0].hand.length, 0);
  const a = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === leg);
  assert.ok(a, 'activatable with an empty hand');
  g = drive(act(g, a!));
  assert.equal(g.players[P0].hand.length, 1, 'drew 1');
});

test('RJ#11981 moving your last unit out of a battlefield you control loses control and trashes your hidden card there', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const h = put(g, P0, 'HidU(2)', { facedown: BF_A });
  g = drive(move(g, P0, [u], 'base'));
  assert.equal(g.battlefields[BF_A].controller, null);
  assert.equal(zone(g, h), 'trash');
});

test('RJ#11982 Smoke Screen in response to Baited Hook lowers the killed unit\'s Might first: the Hook can then only find a unit with Might up to 2', () => {
  const run = (smoke: boolean) => {
    let g = S0(); fundAll(g, P0); fundAll(g, P1);
    const u = put(g, P0, 'V(4)', 'base');
    const top = put(g, P0, 'V(5)', 'deckTop');
    const bh = put(g, P0, 'Baited Hook', 'base');
    g = drive(act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === bh)!), [[u]], x => x.pending?.kind === 'chainResponse' && x.pending.player === P1);
    if (smoke) g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Smoke Screen') }), [[u]], x => x.chain.length === 1 && x.pending?.kind === 'chainResponse');
    g = drive(g, [], x => x.pending?.kind === 'chooseCards');
    assert.equal(zone(g, u), 'trash');
    return g.pending!.options!.some(o => o.id === top);
  };
  assert.equal(run(false), true, 'control: a 4-Might unit finds a 5');
  assert.equal(run(true), false, 'after Smoke Screen (Might 1) a 5-Might unit cannot be chosen');
});

test('RJ#11983 Discipline\'s target Gusted in response: the +2 is lost but you still draw 1', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Discipline') }), [[u]], x => x.pending?.kind === 'chainResponse' && x.pending.player === P1);
  const h0 = g.players[P0].hand.length;
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Gust') }), [[u]]);
  assert.equal(zone(g, u), 'hand');
  assert.equal(g.players[P0].hand.length, h0 + 1 + 1, 'the Gusted unit + 1 drawn card');
});

test('RJ#11985 a Shadow Clone moved to an empty battlefield doesn\'t attack; if the opponent moves a unit in during the showdown, combat follows and its attack trigger fires', () => {
  let g = withTokens(S0()); fundAll(g, P1);
  const c = place(g, P0, 'tok-shadow-clone', 'base', { token: true });
  const t = fillTrash(g, P0, 1, 'V(1)')[0];
  const e = put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  g = drive(move(g, P0, [c], BF_A), [], x => x.pending?.kind === 'showdownAction' && x.pending.player === P1);
  assert.ok(!g.log.some(l => /Trigger: Shadow Clone/.test(l.text)), 'no attack trigger in the non-combat showdown');
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Ride the Wind') }), [String(BF_A), 'yes', [t]]);   // e is the only friendly unit (auto-chosen)
  assert.equal(zone(g, e), 'trash', 'combat happened: the Assault 4 Clone killed the 1-Might unit');
  assert.equal(zone(g, t), 'banishment', 'attack trigger fired once combat began');
});

test('RJ#11987 a unit that moved into an empty battlefield is not an attacking unit: Existential Dread can\'t target it during the non-combat showdown', () => {
  let g = S0(); fundAll(g, P1);
  const u = put(g, P0, 'V(2)', 'base');
  const ed = hand(g, P1, 'Existential Dread');
  g = drive(move(g, P0, [u], BF_A), [], x => x.pending?.kind === 'showdownAction' && x.pending.player === P1);
  assert.equal(canPlayNow(g, P1, ed), false);
});

test('RJ#11988 Temporal Breach on a token (Reflection with Temporary): the banished token ceases to exist and is not played back', () => {
  let g = S0(); fundAll(g, P0);
  const t = put(g, P0, 'V(3)', 'base', { token: true });
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Temporal Breach') }), [[t]]);
  assert.ok(!['base', 'battlefield'].includes(zone(g, t)), 'not played back');
});

test('RJ#11989 Astral Heron played to a battlefield as your first card counts itself: the next (2nd) card is discounted, Heron itself was not', () => {
  let g = S0(); fundAll(g, P0, 8);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const h = hand(g, P0, 'Astral Heron');
  assert.equal(playCostOf(g, P0, h)!.energy, 7);
  const n = hand(g, P0, 'V(3)');
  g = drive(act(g, { type: 'playCard', player: P0, obj: h, destination: BF_A }));
  assert.equal(locOf(g, h), BF_A);
  assert.equal(playCostOf(g, P0, n)!.energy, 1, '3 - 2');
});

test('RJ#11990 Defy can counter Public Execution played from the trash with Flow (printed cost [2][A] is checked); the countered Flow spell is banished (VEN-FAQ)', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  put(g, P0, 'V(3)', 'base'); const e = put(g, P1, 'V(2)', 'base');
  const pe = put(g, P0, 'Public Execution', 'trash');
  assert.equal(playCostOf(g, P0, pe)!.energy, 5, 'Flow cost [5][A][A] from the trash');
  g = drive(act(g, { type: 'playCard', player: P0, obj: pe }), [], x => x.pending?.kind === 'chainResponse' && x.pending.player === P1);
  const df = hand(g, P1, 'Defy');
  assert.ok(canPlayNow(g, P1, df), 'Defy has a legal target');
  g = drive(act(g, { type: 'playCard', player: P1, obj: df }));
  assert.equal(zone(g, e), 'base', 'countered');
  assert.equal(zone(g, pe), 'banishment', 'Flow: banished instead of going to the trash');
});

test('RJ#11991 Tideturner\'s "you may" declined: the trigger is removed, no chain item and no reaction window', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  let p1Window = false;
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Tideturner'), destination: 'base' }), [], x => x.pending?.kind === 'chooseTargets');
  expectPending(g, 'chooseTargets', P0);       // "you may choose": 0..1 targets, before the trigger is finalized
  assert.equal(g.pending!.min, 0);
  assert.equal(g.chain.length, 0);
  g = ans(g, []);
  for (let i = 0; i < 10 && g.pending && g.pending.kind !== 'mainAction'; i++) { if (g.pending.kind === 'chainResponse' && g.pending.player === P1) p1Window = true; g = act(g, { type: 'pass', player: g.pending.player }); }
  assert.equal(g.chain.length, 0);
  assert.equal(p1Window, false, 'no reaction window for the declined trigger');
});

test('RJ#11992 a Mirror Image copy of a Watchful Sentry under Dragon Form has Might 1 (the "base Might becomes 5" change is not copiable)', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  const ws = put(g, P0, 'Watchful Sentry', 'base');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Dragon Form') }), [[ws]]);
  assert.equal(mightOf(g, ws), 5);
  const before = new Set(Object.keys(g.objects));
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Mirror Image') }), [[ws]]);
  const refl = Object.keys(g.objects).find(id => !before.has(id) && g.objects[id].isToken && g.objects[id].zone === 'base')!;
  assert.equal((chars(g, refl) as { name?: string }).name, 'Watchful Sentry');
  assert.equal(mightOf(g, refl), 1);
});

test('RJ#11993 activating Empower uses the chain: the opponent may react before the unit is Empowered', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const sf = put(g, P0, 'Shadow Fiend', 'base');
  const a = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === sf);
  assert.ok(a);
  g = drive(act(g, a!), [], x => x.pending?.kind === 'chainResponse' && x.pending.player === P1);
  expectPending(g, 'chainResponse', P1);
  assert.equal(g.chain.length, 1);
  assert.ok(!g.objects[sf].empowered, 'not Empowered while the opponent responds');
  assert.equal(kwValue(g, sf, 'Assault'), 0);
  g = drive(g);
  assert.ok(g.objects[sf].empowered);
  assert.equal(kwValue(g, sf, 'Assault'), 3);
});

test('RJ#11994 Rampage (additional cost paid) whose enemy target is Gusted in response still gives the friendly unit +2; no damage is exchanged', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const f = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(2)', BF_B); control(g, BF_B, P1);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Rampage') }), [], x => x.pending?.kind === 'chainResponse' && x.pending.player === P1 || x.pending?.kind === 'optional');
  if (g.pending?.kind === 'optional') g = drive(g, ['yes'], x => x.pending?.kind === 'chainResponse' && x.pending.player === P1);
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Gust') }), [[e]]);
  assert.equal(zone(g, e), 'hand');
  assert.equal(mightOf(g, f), 5, '+2 still applied');
  assert.equal(g.objects[f].damage ?? 0, 0, 'no damage dealt');
});

test('RJ#11996 an Alpha Strike target saved by the opponent\'s hidden Temporal Breach is a new object: it takes no damage, the damage goes to the remaining original target', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  put(g, P0, 'V(4)', 'base');
  const e1 = put(g, P1, 'V(2)', BF_A), e2 = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const tb = put(g, P1, 'Temporal Breach', { facedown: BF_A });
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Alpha Strike') }), [[e1, e2]], x => x.pending?.kind === 'chainResponse' && x.pending.player === P1);
  g = drive(act(g, { type: 'playCard', player: P1, obj: tb }), [[e1], 'first', 'first']);
  assert.equal(zone(g, e1), 'battlefield', 'the replayed unit survives');
  assert.equal(g.objects[e1].damage ?? 0, 0, 'and was dealt no damage');
  assert.equal(zone(g, e2), 'trash', 'all 4 damage to the remaining original target');
});

test('RJ#11998 a hidden Back Off (Reaction while hidden) played in response can only stun a unit at its battlefield, not the opponent\'s unit in base', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const j = put(g, P0, 'V(2)', 'base');
  const mine = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const bo = put(g, P1, 'Back Off', { facedown: BF_A });
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Discipline') }), [[j]], x => x.pending?.kind === 'chainResponse' && x.pending.player === P1);
  assert.ok(canPlayNow(g, P1, bo), 'playable from hiding as a Reaction');
  g = act(g, { type: 'playCard', player: P1, obj: bo });
  if (g.pending?.kind === 'chooseTargets') {
    const ids = g.pending.options!.map(o => o.id);
    assert.ok(!ids.includes(j), 'the unit in base is not a legal target');
    assert.ok(ids.includes(mine));
  } else assert.ok(chainSources(g).includes(bo) && !g.log.some(l => /Back Off.*V\\(2\\) \\(base\\)/.test(l.text)));
});

test('RJ#11999 Shadowblade Lurker played from the trash (Last Rites) doesn\'t count itself: one other copy in the trash → costs 3', () => {
  let g = S0(); setRunes(g, P0, 5, 'chaos');
  const l1 = put(g, P0, 'Shadowblade Lurker', 'trash');
  put(g, P0, 'Shadowblade Lurker', 'trash');
  const u = put(g, P0, 'V(2)', 'base');
  const lr = put(g, P0, 'Last Rites', 'base'); attachNow(g, lr, u);
  g = drive(move(g, P0, [u], BF_A), [[l1], 'base']);
  assert.equal(locOf(g, l1), 'base');
  assert.equal(g.players[P0].runesInPlay.filter(r => !g.objects[r].exhausted).length, 2, 'paid 3 (5 - 2 for the other copy; not 1)');
});

test('RJ#11999b with exactly 3 runes the Lurker (cost 3 from the trash) can be chosen by Last Rites', () => {
  let g = S0(); setRunes(g, P0, 3, 'chaos');
  const l1 = put(g, P0, 'Shadowblade Lurker', 'trash');
  put(g, P0, 'Shadowblade Lurker', 'trash');
  const u = put(g, P0, 'V(2)', 'base');
  const lr = put(g, P0, 'Last Rites', 'base'); attachNow(g, lr, u);
  g = drive(move(g, P0, [u], BF_A), [[l1], 'base']);
  assert.equal(locOf(g, l1), 'base');
});

test('RJ#12000 Emperor of the Sands: an Equipment played then banished by the opponent\'s Ravenbloom Prefect still counts as "played this turn"', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  const leg = setLegend(g, P0, 'Emperor of the Sands');
  const pf = put(g, P1, 'Ravenbloom Prefect', 'base');
  assert.ok(!legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === leg), 'control: no Equipment played yet');
  const lr = hand(g, P0, 'Last Rites');
  g = drive(act(g, { type: 'playCard', player: P0, obj: lr }), ['yes']);
  assert.equal(zone(g, lr), 'banishment', 'Prefect banished the gear');
  assert.equal(zone(g, pf), 'banishment');
  const a = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === leg);
  assert.ok(a, 'Azir legend usable');
  g = drive(act(g, a!));
  assert.equal(unitsNamed(g, 'Sand Soldier').length, 1);
});

test('RJ#12001 at the start of the turn a start-of-Beginning-Phase trigger (Sprite Queen) resolves before the hold point; the "When I hold" draw (Vilemaw) after it', () => {
  let g = withTokens(S0({ tp: P1 }));
  put(g, P0, 'Vilemaw', BF_A); control(g, BF_A, P0);
  put(g, P0, 'Sprite Queen', 'base');
  g = drive(endTurn(g, P1), ['first', 'first', 'first']);
  const t = g.log.map(l => l.text);
  const start = t.lastIndexOf('--- Turn 4: P0 ---');
  const iSprite = t.findIndex((x, i) => i > start && /creates a Sprite/.test(x));
  const iHold = t.findIndex((x, i) => i > start && /gains 1 point \(hold\)/.test(x));
  const iDraw = t.findIndex((x, i) => i > start && /Resolving Vilemaw/.test(x));
  assert.ok(start >= 0 && iSprite > start && iHold > iSprite && iDraw > iHold, JSON.stringify({ start, iSprite, iHold, iDraw }));
});

test('RJ#12003 Rogue Assassin (Akali legend) in the non-combat showdown at an empty battlefield: move the unit back to base → no conquer', () => {
  let g = S0(); fundAll(g, P0);
  const leg = setLegend(g, P0, 'Rogue Assassin');
  const u = put(g, P0, 'V(2)', 'base');
  g = drive(move(g, P0, [u], BF_A), [], x => x.pending?.kind === 'showdownAction' && x.pending.player === P0);
  const a = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === leg);
  assert.ok(a, 'Action ability usable in the showdown');
  g = drive(act(g, a!), [[u]]);
  assert.equal(locOf(g, u), 'base');
  assert.equal(g.battlefields[BF_A].controller, null);
  assert.equal(g.players[P0].points, 0, 'no conquer');
});

test('RJ#12004 Wuju Bladesman\'s +2 for a lone defender ends with the combat (continuous condition)', () => {
  let g = S0();
  setLegend(g, P1, 'Wuju Bladesman');
  const d = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(4)', 'base');
  g = drive(move(g, P0, [a], BF_A), [], x => x.pending?.kind === 'showdownAction');
  assert.equal(mightOf(g, d), 5, 'defending alone: +2');
  g = drive(g);
  assert.equal(zone(g, a), 'trash');
  assert.equal(zone(g, d), 'battlefield');
  assert.equal(mightOf(g, d), 3, 'after combat: back to 3');
});

test('RJ#12005 Switcheroo with Baron Nashor\'s +2 on my unit: totals swapped once (mine 5↔4 → 4); if Baron leaves later, mine drops by 2', () => {
  let g = S0(); fundAll(g, P0);
  const bn = put(g, P0, 'Baron Nashor', 'base');
  const m = put(g, P0, 'V(3)', 'base');
  const e = put(g, P1, 'V(4)', BF_A); control(g, BF_A, P1);
  assert.equal(mightOf(g, m), 5);
  const sd = (x: Parameters<typeof drive>[0]) => x.pending?.kind === 'showdownAction' && x.pending.player === P0 && x.chain.length === 0;
  g = drive(move(g, P0, [m], BF_A), [], sd);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Switcheroo') }), [[m, e]], x => x.chain.length === 0 && x.pending?.kind === 'showdownAction');
  assert.equal(mightOf(g, m), 4, 'mine: the enemy\'s 4 (Baron\'s +2 not added again)');
  assert.equal(mightOf(g, e), 5);
  expectPending(g, 'showdownAction', P1);
  g = act(g, { type: 'pass', player: P1 });
  expectPending(g, 'showdownAction', P0);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Retreat') }), [[bn]], x => x.chain.length === 0 && x.pending?.kind === 'showdownAction');
  assert.equal(zone(g, bn), 'hand');
  assert.equal(mightOf(g, m), 2, 'Baron gone: -2');
});

test('RJ#12006 Heedless Resurrection killing Baron Nashor plays Soulgorger; Soulgorger\'s trigger can then play that Baron back (paying its Power)', () => {
  let g = S0(); fundAll(g, P0);
  const bn = put(g, P0, 'Baron Nashor', 'base');
  const sg = put(g, P0, 'Soulgorger', 'trash');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Heedless Resurrection') }), [], x => x.pending?.kind === 'chooseTargets');
  assert.equal(zone(g, sg), 'base');
  assert.equal(zone(g, bn), 'trash');
  assert.ok(g.pending!.options!.some(o => o.id === bn), 'the killed Baron is a legal choice for Soulgorger');
  g = drive(g, [[bn], 'first', 'first']);
  assert.equal(zone(g, bn), 'battlefield');
  assert.ok(g.log.some(l => /P0 pays C C C$/.test(l.text)), 'Baron\'s 3 Power still paid');
});

test('RJ#12007 Flash in response to Cull the Weak moves Hwei: his "When I move" trigger resolves before Cull the Weak', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const hw = put(g, P0, 'Hwei, Brooding Painter', BF_A); control(g, BF_A, P0);
  put(g, P1, 'V(2)', 'base');
  put(g, P0, 'V(1)', 'deckTop');
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Cull the Weak') }), [], x => x.pending?.kind === 'chainResponse' && x.pending.player === P0);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Flash') }), [[hw], 'first', 'first', 'first', 'first']);
  const t = g.log.map(l => l.text);
  const iH = t.findIndex(x => /^Resolving Hwei/.test(x)), iC = t.findIndex(x => /^Resolving Cull the Weak/.test(x));
  assert.ok(iH >= 0 && iC > iH, JSON.stringify({ iH, iC }));
  assert.equal(locOf(g, hw) === 'base' || zone(g, hw) === 'trash', true);
});

test('RJ#12008 Baited Hook\'s kill replaced by Soraka, Wanderer: no unit was killed, so no unit can be played from the top 5', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'Soraka, Wanderer', BF_A); control(g, BF_A, P0);
  const u = put(g, P0, 'V(2)', BF_A);
  const top = put(g, P0, 'V(1)', 'deckTop');
  const bh = put(g, P0, 'Baited Hook', 'base');
  g = drive(act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === bh)!), [[u]], x => x.pending?.kind === 'chooseCards' || x.pending?.kind === 'mainAction');
  assert.equal(locOf(g, u), 'base', 'Soraka recalled it instead');
  if (g.pending?.kind === 'chooseCards') assert.ok(!g.pending.options!.some(o => o.id === top), 'no unit playable');
  g = drive(g, [[]]);
  assert.notEqual(zone(g, top), 'base');
  assert.notEqual(zone(g, top), 'battlefield');
});

test('RJ#12010 Star-Crossed played from the trash by Fizz, Trickster and Defied: Heart of the Tempest (Kennen legend) is not empowered; the spell is still recycled. Control: resolves → empowered', () => {
  const run = (defy: boolean) => {
    let g = S0(); fundAll(g, P0); fundAll(g, P1);
    const leg = setLegend(g, P0, 'Heart of the Tempest');
    const f = put(g, P0, 'V(2)', 'base'); put(g, P1, 'V(2)', 'base');
    const sc = put(g, P0, 'Star-Crossed', 'trash');
    g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Fizz, Trickster'), destination: 'base' }), [[sc], [f]],
      x => x.pending?.kind === 'chainResponse' && x.pending.player === P1 && x.chain.some(c => c.source === sc));
    if (defy) g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Defy') });
    g = drive(g);
    return { emp: !!g.objects[leg].empowered, recycled: g.players[P0].mainDeck.includes(sc) };
  };
  assert.deepEqual(run(true), { emp: false, recycled: true });
  assert.deepEqual(run(false), { emp: true, recycled: true });
});

test('RJ#12012 Unyielding Spirit in response to Glowstone\'s end-of-turn trigger prevents the 5 damage (ability damage); Glowstone still dies', () => {
  let g = S0(); fundAll(g, P0);
  const gs = put(g, P0, 'Glowstone', 'base');
  const u = put(g, P0, 'V(3)', 'base');
  g = drive(endTurn(g, P0), [], x => x.pending?.kind === 'chainResponse' && x.pending.player === P0 && x.chain.length > 0);
  expectPending(g, 'chainResponse', P0);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Unyielding Spirit') }), [], x => x.chain.length === 0);
  assert.equal(zone(g, gs), 'trash');
  assert.equal(zone(g, u), 'base');
  assert.equal(g.objects[u].damage ?? 0, 0);
});

test('RJ#12013 Master of Shadows (Zed legend) is empowered only by a card effect that banishes (Shadow Clone); its own discard/draw ability doesn\'t empower it', () => {
  let g = withTokens(S0());
  const leg = setLegend(g, P0, 'Master of Shadows'); g.objects[leg].empowered = 1; g.timestamp++;
  hand(g, P0, 'V(1)');
  g = drive(act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === leg)!), ['first']);
  assert.ok(!g.objects[leg].empowered, 'disempowered; discarding is not banishing');
  const t = put(g, P0, 'V(1)', 'trash');
  const c = place(g, P0, 'tok-shadow-clone', 'base', { token: true });
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  g = drive(move(g, P0, [c], BF_A), ['yes', [t]]);
  assert.equal(zone(g, t), 'banishment');
  assert.ok(g.objects[leg].empowered, 'empowered by the Clone\'s banish');
});

test('RJ#12014 in a showdown, with a Reaction spell choosing an enemy (2nd choice this turn) on the chain, Prodigal Explorer\'s [Reaction] ability is usable; Vi, Destructive\'s plain activated ability is not', () => {
  let g = S0(); fundAll(g, P0);
  const leg = setLegend(g, P0, 'Prodigal Explorer');
  const vi = put(g, P0, 'Vi, Destructive', 'base');
  fillTrash(g, P0, 2, 'V(1)');
  const e = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const canLeg = (x: typeof g) => legal(x, P0, 'activate').some(a => a.type === 'activate' && a.obj === leg);
  const canVi = (x: typeof g) => legal(x, P0, 'activate').some(a => a.type === 'activate' && a.obj === vi);
  assert.ok(canVi(g), 'control: Vi usable in the main phase (open)');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Smoke Screen') }), [[e]]);
  assert.equal(canLeg(g), false, 'only one choice so far');
  g = drive(move(g, P0, [vi], BF_A), [], x => x.pending?.kind === 'showdownAction' && x.pending.player === P0 && x.chain.length === 0);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Smoke Screen') });
  g = drive(g, [[e]], x => x.pending?.kind === 'chainResponse' && x.pending.player === P0);
  assert.equal(g.chain.length, 1);
  assert.ok(canLeg(g), 'Prodigal Explorer usable while the spell is on the chain');
  assert.equal(canVi(g), false, 'Vi\'s ability has no Reaction/Action');
});

test('RJ#12015 empowered Ambessa, Respected and Feared: her attack trigger uses the chain (opponent may react) and counts her Assault 2 (7 Might kills a 6)', () => {
  let g = S0();
  const am = put(g, P0, 'Ambessa, Respected and Feared', 'base'); g.objects[am].empowered = 1; g.timestamp++;
  const e = put(g, P1, 'V(6)', BF_A); control(g, BF_A, P1);
  let p1Window = false;
  g = drive(move(g, P0, [am], BF_A), [], x => { if (x.pending?.kind === 'chainResponse' && x.pending.player === P1 && x.chain.some(c => c.source === am)) p1Window = true; return p1Window; });
  assert.ok(p1Window, 'opponent gets priority with the trigger on the chain');
  assert.equal(mightOf(g, am), 7);
  g = drive(g, [[e]], x => !x.chain.some(c => c.source === am));
  assert.equal(zone(g, e), 'trash');
});

test('RJ#12017 Cannon Barrage during the non-combat showdown at an empty battlefield: playable, deals nothing; the mover still conquers', () => {
  let g = S0(); fundAll(g, P1);
  const u = put(g, P0, 'V(2)', 'base');
  const cb = hand(g, P1, 'Cannon Barrage');
  g = drive(move(g, P0, [u], BF_A), [], x => x.pending?.kind === 'showdownAction' && x.pending.player === P1);
  assert.ok(canPlayNow(g, P1, cb));
  g = drive(act(g, { type: 'playCard', player: P1, obj: cb }));
  assert.equal(g.objects[u].damage ?? 0, 0);
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[P0].points, 1, 'conquered');
});

test('RJ#12018 a Seal given Temporary can be tapped in response to its Temporary trigger (power added), but the pool empties before the main phase', () => {
  let g = S0({ tp: P1 });
  const s = put(g, P0, 'Seal of Discord', 'base');
  mod(g, s, { addKeywords: ['Temporary'], duration: 'permanent' });
  g = drive(endTurn(g, P1), [], x => x.pending?.kind === 'chainResponse' && x.pending.player === P0 && x.chain.length > 0);
  const a = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === s);
  assert.ok(a, 'Reaction ability usable with the Temporary trigger on the chain');
  g = act(g, a!);
  assert.equal(g.players[P0].pool.power.Chaos, 1, 'power added at once');
  g = drive(g);
  expectPending(g, 'mainAction', P0);
  assert.equal(zone(g, s), 'trash');
  assert.equal(g.players[P0].pool.power.Chaos ?? 0, 0, 'pool emptied before the main phase');
});

test('RJ#12019 Swain, Visionary\'s conquer point needs the unit, gear and spell played before he conquers; playing the gear and spell afterwards gives nothing', () => {
  const run = (before: boolean) => {
    let g = S0(); fundAll(g, P0, 8);
    const sw = put(g, P0, 'Swain, Visionary', 'base');
    g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'V(1)'), destination: 'base' }));
    const gearAndSpell = (x: typeof g) => {
      x = drive(act(x, { type: 'playCard', player: P0, obj: hand(x, P0, 'Seal of Discord') }));
      return drive(act(x, { type: 'playCard', player: P0, obj: hand(x, P0, 'Discipline') }), [[sw]]);
    };
    if (before) g = gearAndSpell(g);
    g = drive(move(g, P0, [sw], BF_A));
    if (!before) g = gearAndSpell(g);
    return g.players[P0].points;
  };
  assert.equal(run(true), 2, 'control: conquer + Swain');
  assert.equal(run(false), 1, 'conquer only');
});

test('RJ#12020 Sacrifice\'s mandatory additional cost (kill a friendly Mighty unit) can\'t be paid without one: it can\'t be played and stays in hand', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'V(4)', 'base');
  const sc = hand(g, P0, 'Sacrifice');
  assert.equal(canPlayNow(g, P0, sc), false);
  assert.ok(validateAction(g, { type: 'playCard', player: P0, obj: sc }), 'rejected');
  assert.ok(g.players[P0].hand.includes(sc));
  put(g, P0, 'V(5)', 'base');
  assert.equal(canPlayNow(g, P0, sc), true, 'control: with a Mighty unit');
});

test('RJ#12022 in the non-combat showdown after the opponent moves into an empty battlefield, you may play Action spells (Wages of Pain) on their unit with no units of your own', () => {
  let g = S0(); fundAll(g, P1);
  const u = put(g, P0, 'V(4)', 'base');
  const wp = hand(g, P1, 'Wages of Pain');
  g = drive(move(g, P0, [u], BF_A), [], x => x.pending?.kind === 'showdownAction' && x.pending.player === P1);
  assert.ok(canPlayNow(g, P1, wp));
  g = drive(act(g, { type: 'playCard', player: P1, obj: wp }), [[u]], x => x.chain.length === 0);
  assert.equal(g.objects[u].damage, 3);
});

test('RJ#12023 Shock Blast with an empowered Applied Researchers: [3][A] - [1][A] (min [1]) - [2] = free', () => {
  let g = S0(); fundAll(g, P0);
  const ar = put(g, P0, 'Applied Researchers', 'base'); g.objects[ar].empowered = 1; g.timestamp++;
  const c = playCostOf(g, P0, hand(g, P0, 'Shock Blast'))!;
  assert.equal(c.energy, 0);
  assert.equal(c.power.length, 0);
});

test('RJ#12024 Altar of Blood on the opponent\'s turn: my defender dying in combat there may be saved for [A][A][A] (healed, exhausted, recalled)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0);
  setBattlefieldCard(g, BF_A, 'Altar of Blood');
  const d = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const a = put(g, P1, 'V(5)', 'base');
  g = drive(move(g, P1, [a], BF_A), [], x => x.pending?.kind === 'optional' && x.pending.player === P0);
  expectPending(g, 'optional', P0);
  g = drive(g, ['yes', 'first', 'first']);
  assert.equal(locOf(g, d), 'base');
  assert.equal(g.objects[d].exhausted, true);
  assert.equal(g.objects[d].damage ?? 0, 0);
});

test('RJ#12025 Retreat (my first card this turn) returning my Astral Heron from a battlefield: no discount — Heron is no longer at a battlefield when the play completes', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0);
  const h = put(g, P0, 'Astral Heron', BF_A); control(g, BF_A, P0);
  const a = put(g, P1, 'V(2)', 'base');
  const dc = hand(g, P0, 'Discipline');
  g = drive(move(g, P1, [a], BF_A), [], x => x.pending?.kind === 'showdownAction' && x.pending.player === P0 || x.pending?.kind === 'chainResponse' && x.pending.player === P0);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Retreat') }), [[h]], x => x.chain.length === 0);
  assert.equal(zone(g, h), 'hand');
  assert.equal(playCostOf(g, P0, dc)!.energy, 2, 'full cost');
});

test('RJ#12029 Decree of Strength can choose a Mind–Order card (Mirror Image) from the revealed hand; it is recycled (bottom of the deck), not discarded', () => {
  let g = S0(); fundAll(g, P0);
  const mi = hand(g, P1, 'Mirror Image');
  hand(g, P1, 'Gust');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Decree of Strength') }), ['first', [mi]]);
  assert.equal(g.players[P1].mainDeck.at(-1), mi, 'bottom of the Main Deck');
  assert.ok(!g.players[P1].trash.includes(mi));
});

test('RJ#12030 Patched Porobot needs 3 OTHER gear: with 2 gear it draws nothing (it doesn\'t count itself); with 3 it draws', () => {
  const run = (n: number) => {
    let g = S0(); fundAll(g, P0);
    for (let i = 0; i < n; i++) put(g, P0, 'Seal of Discord', 'base');
    const pb = hand(g, P0, 'Patched Porobot');
    const h0 = g.players[P0].hand.length;
    g = drive(act(g, { type: 'playCard', player: P0, obj: pb, destination: 'base' }), ['yes']);
    return g.players[P0].hand.length - (h0 - 1);
  };
  assert.equal(run(2), 0);
  assert.equal(run(3), 1);
});

test('RJ#12031 Piltover Enforcer (Vi legend): conquering an empty battlefield assigns no excess damage — no trigger', () => {
  let g = S0();
  const leg = setLegend(g, P0, 'Piltover Enforcer');
  const u = put(g, P0, 'V(9)', 'base');
  g = drive(move(g, P0, [u], BF_A));
  assert.equal(g.players[P0].points, 1, 'conquered');
  assert.ok(!g.log.some(l => /Trigger: Piltover Enforcer/.test(l.text)));
  assert.ok(!g.objects[leg].exhausted);
});

test('RJ#12032 Mask of Foresight triggers again when empowered Rogue Assassin pulls the lone attacker out (combat ends), readies it, and it attacks again', () => {
  let g = S0(); fundAll(g, P0);
  const leg = setLegend(g, P0, 'Rogue Assassin'); g.objects[leg].empowered = 1; g.timestamp++;
  put(g, P0, 'Mask of Foresight', 'base');
  const u = put(g, P0, 'V(3)', 'base');
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const sd = (x: typeof g) => x.pending?.kind === 'showdownAction' && x.pending.player === P0 && x.chain.length === 0;
  g = drive(move(g, P0, [u], BF_A), [], sd);
  assert.equal(mightOf(g, u), 4, 'first attack alone: +1');
  g = drive(act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === leg)!), [[u]]);
  assert.equal(locOf(g, u), 'base');
  assert.equal(g.objects[u].exhausted, false, 'readied (empowered legend)');
  expectPending(g, 'mainAction', P0);
  g = drive(move(g, P0, [u], BF_A), [], sd);
  assert.equal(mightOf(g, u), 5, 'new combat: Mask triggers again');
});

test('RJ#12033 hidden Mischievous Marai revealed in response to an attack trigger joins the same chain; her play trigger goes on top of it', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const mm = put(g, P0, 'Mischievous Marai', { facedown: BF_A });
  const am = put(g, P1, 'Ambessa, Respected and Feared', 'base'); g.objects[am].empowered = 1; g.timestamp++;
  g = drive(move(g, P1, [am], BF_A), [], x => x.pending?.kind === 'chainResponse' && x.pending.player === P0 && x.chain.some(c => c.source === am));
  const n = g.chain.length;
  g = drive(act(g, { type: 'playCard', player: P0, obj: mm }), [], x => x.chain.some(c => c.source === mm) || x.chain.length > n);
  assert.ok(g.chain.length > n, 'added to the existing chain');
  assert.equal(g.chain[0].source, am, 'the attack trigger is still at the bottom');
  assert.equal(g.chain.at(-1)!.source, mm, 'Marai\'s play trigger on top');
});

test('RJ#12034 Temporal Breach on my Fizz in response to Ride the Wind: Fizz\'s play trigger and the Hard Bargain it plays join the same chain and counter Ride the Wind', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const fz = put(g, P0, 'Fizz, Trickster', BF_A); control(g, BF_A, P0);
  const tb = put(g, P0, 'Temporal Breach', { facedown: BF_A });
  const hb = put(g, P0, 'Hard Bargain', 'trash');
  const r = put(g, P1, 'V(2)', BF_B, { ready: false }); control(g, BF_B, P1);
  const rw = hand(g, P1, 'Ride the Wind');
  g = drive(act(g, { type: 'playCard', player: P1, obj: rw }), ['base'], x => x.pending?.kind === 'chainResponse' && x.pending.player === P0);
  g = drive(act(g, { type: 'playCard', player: P0, obj: tb }), [[fz]], x => x.pending?.kind === 'chooseCards' || x.pending?.kind === 'chooseTargets' && x.pending.player === P0 && x.pending.options!.some(o => o.id === hb));
  assert.ok(g.chain.some(c => c.source === rw), 'Ride the Wind still waiting on the same chain');
  g = drive(g, [[hb], 'first', 'no', 'no'], x => x.chain.length === 0);
  assert.equal(locOf(g, r), BF_B, 'Ride the Wind countered (not paid)');
  assert.equal(g.players[P1].trash.includes(rw), true);
});

test('RJ#12035 a gear played while Ravenbloom Prefect is still in the trash is never banished by it once Soulgorger plays the Prefect (no retroactive trigger)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1);
  const pf = put(g, P0, 'Ravenbloom Prefect', 'trash');
  const seal = hand(g, P1, 'Seal of Discord');
  g = drive(act(g, { type: 'playCard', player: P1, obj: seal }));
  g = drive(endTurn(g, P1), ['first', 'first'], x => x.pending?.kind === 'mainAction' && x.pending.player === P0);
  fundAll(g, P0, 8);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Soulgorger'), destination: 'base' }), [[pf], 'base']);
  assert.equal(zone(g, pf), 'base');
  assert.equal(zone(g, seal), 'base', 'the earlier gear stays');
});

test('RJ#12037 Diana, Lunari Gusted in response to her showdown-start trigger: the trigger still resolves (Predict, reveal, draw the spell)', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const di = put(g, P0, 'Diana, Lunari', 'base');
  const sp = put(g, P0, 'Gust', 'deckTop');
  g = drive(move(g, P0, [di], BF_A), ['yes'], x => x.pending?.kind === 'chainResponse' && x.pending.player === P1 && x.chain.length === 1);
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Gust') }), [], x => x.pending?.kind === 'chooseCards' || x.pending?.kind === 'mainAction');
  assert.equal(zone(g, di), 'hand', 'Diana Gusted');
  g = drive(g, [[]]);                                  // Predict: keep the top card
  assert.equal(zone(g, sp), 'hand', 'revealed spell drawn');
});

test('RJ#12039 Sacrifice (killing Glasc Mixologist) enables Legion: Vanguard Captain played by the Deathknell makes two Recruits', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  const gm = put(g, P0, 'Glasc Mixologist', 'base');
  const vc = put(g, P0, 'Vanguard Captain', 'trash');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Sacrifice') }), [[vc]]);   // the Mixologist is the only Mighty unit (auto-killed)
  assert.equal(zone(g, gm), 'trash');
  assert.equal(zone(g, vc), 'base');
  assert.equal(unitsNamed(g, 'Recruit').length, 2);
});

test('RJ#12040 Temporal Breach on the opponent\'s only unit at their battlefield with a hidden card: control never lapses, the hidden card stays, nobody scores', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const h = put(g, P1, 'HidU(2)', { facedown: BF_A });
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Temporal Breach') }), [[u]]);
  assert.equal(locOf(g, u), BF_A, 'played back to the same battlefield');
  assert.equal(g.battlefields[BF_A].controller, P1);
  assert.equal(zone(g, h), 'facedown');
  assert.equal(g.players[P0].points + g.players[P1].points, 0);
});

test('RJ#12041 Switcheroo on Ornn, Forge God (4 + 7 gear + Sterak\'s Gage 3 + Guardian Angel 1 = 15) and a 1-Might Tentacle: Ornn 1, Tentacle 15', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  const o = put(g, P0, 'Ornn, Forge God', BF_A); control(g, BF_A, P0);
  attachNow(g, put(g, P0, "Sterak's Gage", 'base'), o);
  attachNow(g, put(g, P0, 'Guardian Angel', 'base'), o);
  for (let i = 0; i < 5; i++) put(g, P0, 'Seal of Discord', 'base');
  const t = place(g, P0, 'tok-tentacle', BF_A, { token: true });
  assert.equal(mightOf(g, o), 15);
  assert.equal(mightOf(g, t), 1);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Switcheroo') }), [[o, t]]);
  assert.equal(mightOf(g, o), 1);
  assert.equal(mightOf(g, t), 15);
});

test('RJ#12044 once both players pass in a combat showdown, combat damage follows at once: no window to play a Quick-Draw gear', () => {
  let { g, atk, def } = attackSetup(['V(3)'], ['V(5)']);
  fundAll(g, P0);
  hand(g, P0, "Sterak's Gage");
  expectPending(g, 'showdownAction', P0);
  g = act(g, { type: 'pass', player: P0 });
  expectPending(g, 'showdownAction', P1);
  g = act(g, { type: 'pass', player: P1 });
  if (g.pending?.kind === 'assignDamage') g = drive(g, [], x => x.pending?.kind !== 'assignDamage');
  assert.ok(!(g.pending?.kind === 'showdownAction' && g.pending.player === P0 && zone(g, atk[0]) === 'battlefield' && (g.objects[def[0]].damage ?? 0) === 0), 'no window before damage');
  assert.equal(zone(g, atk[0]), 'trash', 'damage dealt');
});

test('RJ#12049 Nasus, Guardian of Knowledge dying in the same combat cleanup as the enemy unit: no rune channelled; control: Nasus survives → channels', () => {
  const run = (nasusDies: boolean) => {
    let g = S0();
    const n = put(g, P1, 'Nasus, Guardian of Knowledge', BF_A); control(g, BF_A, P1);
    const a = put(g, P0, nasusDies ? 'V(6)' : 'V(2)', 'base');
    const r0 = g.players[P1].runesInPlay.length;
    g = drive(move(g, P0, [a], BF_A), ['first']);
    assert.equal(zone(g, a), 'trash');
    assert.equal(zone(g, n), nasusDies ? 'trash' : 'battlefield');
    return g.players[P1].runesInPlay.length - r0;
  };
  assert.equal(run(false), 1, 'control');
  assert.equal(run(true), 0);
});

test('RJ#12050 Fizz, Trickster\'s trash spell is chosen when his trigger is chained: Disposal Order recycling that Hidden Blade in response leaves Fizz nothing to play (no other spell instead)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const k = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const hb = put(g, P1, 'Hidden Blade', 'trash');
  const other = put(g, P1, 'Gust', 'trash');
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Fizz, Trickster'), destination: 'base' }), [[hb]],
    x => x.pending?.kind === 'chainResponse' && x.pending.player === P0 && x.chain.some(c => c.kind === 'trigger'));
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Disposal Order') }), [/recycle|trash/i, [hb]], x => x.chain.length === 1 && x.pending?.kind === 'chainResponse');
  assert.equal(zone(g, hb), 'mainDeck');
  g = drive(g, [[k], 'yes'], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, k), 'battlefield', 'Kayle (the unit) is not killed');
  assert.equal(zone(g, other), 'trash', 'Fizz does not pick another spell instead');
});

test('RJ#12051 Lightning Rush only looks: an Undertitan among the top 3 adds no Energy', () => {
  let g = S0(); fundAll(g, P0);
  const ut = put(g, P0, 'Undertitan', 'deckTop');
  const e0 = g.players[P0].pool.energy;
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Lightning Rush') }), [[ut]]);
  assert.equal(zone(g, ut), 'hand');
  assert.equal(g.players[P0].pool.energy, e0, 'no [Add] [2]');
});

test('RJ#12053 Divine Judgment leaves cards in the trash, in banishment and hidden cards alone', () => {
  let g = S0(); fundAll(g, P0);
  const tr = put(g, P1, 'V(1)', 'trash');
  const bn = put(g, P1, 'V(1)', 'banishment');
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const hd = put(g, P1, 'HidU(2)', { facedown: BF_A });
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Divine Judgment') });
  for (let i = 0; i < 60 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    if (d.inStep) g = act(g, { type: 'choose', player: d.player, optionIds: (d.options ?? []).slice(0, Math.max(d.min ?? 1, Math.min(d.max ?? 1, 2))).map(o => o.id) });
    else g = act(g, { type: 'pass', player: d.player });
  }
  assert.ok(g.log.some(l => /Resolving Divine Judgment/.test(l.text)));
  assert.equal(zone(g, tr), 'trash');
  assert.equal(zone(g, bn), 'banishment');
  assert.equal(zone(g, hd), 'facedown');
});

test('RJ#12054 a unit can\'t just be exhausted: the only generic exhaust is a Standard Move, which must actually move it', () => {
  const g = S0();
  const ir = put(g, P0, 'Irelia, Fervent', 'base');
  const acts = legal(g, P0).filter(a => (a as { obj?: string; units?: string[] }).obj === ir || ((a as { units?: string[] }).units ?? []).includes(ir));
  assert.ok(acts.length > 0 && acts.every(a => a.type === 'move'), JSON.stringify(acts.map(a => a.type)));
  assert.ok(!moveDests(g, P0, ir).includes('base'), 'no "move" to where it already is');
});

test('RJ#12055 Rogue Assassin (Akali legend) moving Akali, Deadly Weapon out of a showdown: her "When I move" deals 1 to a unit at the battlefield she left (marked damage)', () => {
  let g = S0(); fundAll(g, P0);
  const leg = setLegend(g, P0, 'Rogue Assassin');
  const ak = put(g, P0, 'Akali, Deadly Weapon', 'base');
  const e = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  g = drive(move(g, P0, [ak], BF_A), ['no'], x => x.pending?.kind === 'showdownAction' && x.pending.player === P0 && x.chain.length === 0);
  assert.equal(g.objects[e].damage ?? 0, 0);
  g = drive(act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === leg)!), ['yes'], x => x.chain.length === 0 && x.pending?.kind !== 'chooseTargets' && x.pending?.kind !== 'optional');
  assert.equal(locOf(g, ak), 'base');
  assert.equal(g.objects[e].damage, 1);
});

test('RJ#12056 a unit moved by Shuriken Flip keeps its ready state (spell moves don\'t exhaust)', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'V(2)', 'base');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Shuriken Flip') }), [String(BF_A)]);   // no enemy unit; u is the only friendly unit
  assert.equal(locOf(g, u), BF_A);
  assert.equal(g.objects[u].exhausted, false);
});

test('RJ#12057 Twilight Reveler pulled back to base by Rogue Assassin is no longer an attacker; its attack trigger still resolved; the combat ends', () => {
  let g = S0(); fundAll(g, P0);
  const leg = setLegend(g, P0, 'Rogue Assassin');
  const tr = put(g, P0, 'Twilight Reveler', 'base');
  const other = put(g, P0, 'V(1)', 'base', { ready: false });
  const e = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  g = drive(move(g, P0, [tr], BF_A), [[other]], x => x.pending?.kind === 'showdownAction' && x.pending.player === P0 && x.chain.length === 0);
  assert.equal(g.objects[other].exhausted, false, 'attack trigger readied the other unit');
  g = drive(act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === leg)!), []);
  assert.equal(locOf(g, tr), 'base');
  assert.ok(!g.objects[tr].combatRole, 'no Attacker designation');
  expectPending(g, 'mainAction', P0);
  assert.equal(zone(g, tr), 'base', 'no combat damage: combat ended');
  assert.equal(g.objects[e].damage ?? 0, 0);
});

test('RJ#12058 Rogue Assassin pulling the lone attacking Mournful Witness to base ends the combat: Witness empowers', () => {
  let g = S0(); fundAll(g, P0);
  const leg = setLegend(g, P0, 'Rogue Assassin');
  const mw = put(g, P0, 'Mournful Witness', 'base');
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  g = drive(move(g, P0, [mw], BF_A), [], x => x.pending?.kind === 'showdownAction' && x.pending.player === P0 && x.chain.length === 0);
  assert.ok(!g.objects[mw].empowered);
  g = drive(act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === leg)!), []);
  assert.equal(locOf(g, mw), 'base');
  assert.ok(g.objects[mw].empowered, 'combat it was in ended');
  assert.equal(mightOf(g, mw), 4);
});

test('RJ#12060 Overzealous Fan kills itself to move my lone attacker to base: no units remain, "No Result" — Glorious Executioner (Draven legend) draws nothing', () => {
  let g = S0();
  setLegend(g, P0, 'Glorious Executioner');
  const a = put(g, P0, 'V(3)', 'base');
  const fan = put(g, P1, 'Overzealous Fan', BF_A); control(g, BF_A, P1);
  const h0 = g.players[P0].hand.length;
  g = drive(move(g, P0, [a], BF_A), ['yes']);
  assert.equal(zone(g, fan), 'trash');
  assert.equal(locOf(g, a), 'base');
  assert.equal(g.battlefields[BF_A].controller, null);
  assert.equal(g.players[P0].hand.length, h0, 'no draw');
});

test('RJ#12061 King\'s Edict: the opponent\'s choice is not an enemy spell choosing — their Baron Nashor (only unit) is chosen and killed', () => {
  let g = S0(); fundAll(g, P0);
  const bn = put(g, P1, 'Baron Nashor', 'base');
  put(g, P0, 'V(2)', 'base');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, "King's Edict") }), [[bn]]);
  assert.equal(zone(g, bn), 'trash');
});

test('RJ#12063 Matriarch of War\'s "when you empower something else" triggers only after the unit\'s Empower resolves (new chain), not on top of it', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const leg = setLegend(g, P0, 'Matriarch of War');
  const sf = put(g, P0, 'Shadow Fiend', 'base');
  g = drive(act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === sf)!), [], x => x.pending?.kind === 'chainResponse' && x.pending.player === P1);
  assert.equal(g.chain.length, 1, 'only the Empower ability on the chain');
  assert.ok(!g.chain.some(c => c.source === leg));
  g = drive(g, [], x => x.chain.some(c => c.source === leg) || x.pending?.kind === 'mainAction');
  assert.ok(g.objects[sf].empowered, 'the unit\'s Empower resolved first');
  assert.equal(g.chain.length, 1, 'legend trigger alone on a new chain');
  g = drive(g);
  assert.ok(g.objects[leg].empowered);
});

test('RJ#12064 an exhausted Deceiver (LeBlanc legend) conquering Hall of Legends: Hall readies her, but Deceiver\'s trigger (cost: exhaust me) never finalized — no Reflection', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  setBattlefieldCard(g, BF_A, 'Hall of Legends');
  const leg = setLegend(g, P0, 'Deceiver'); g.objects[leg].exhausted = true; g.timestamp++;
  hand(g, P0, 'V(1)');
  const u = put(g, P0, 'V(2)', 'base');
  g = drive(move(g, P0, [u], BF_A), ['yes', 'yes', 'first', 'first']);
  assert.equal(g.objects[leg].exhausted, false, 'Hall of Legends readied her');
  assert.equal(unitsNamed(g, 'Reflection').length, 0, 'no Reflection');
  assert.equal(Object.values(g.objects).filter(o => o.isToken && o.controller === P0 && ['base', 'battlefield'].includes(o.zone)).length, 0);
});

test('RJ#12065 Bottled Constellation: Patched Porobot (unit and gear) is one object — Porobot + one gear can\'t pay "kill 3 other"; with a second gear it scores', () => {
  const run = (gears: number) => {
    let g = S0({ tp: P1 });
    put(g, P0, 'Bottled Constellation', 'base');
    put(g, P0, 'Patched Porobot', 'base');
    for (let i = 0; i < gears; i++) put(g, P0, 'Seal of Discord', 'base');
    g = drive(endTurn(g, P1), ['yes', 'first', 'first', 'first'], x => x.pending?.kind === 'mainAction' && x.pending.player === P0);
    return g.players[P0].points;
  };
  assert.equal(run(1), 0);
  assert.equal(run(2), 1);
});

test('RJ#12067 joining combat at an uncontrolled Ravenbloom Conservatory with Ride the Wind: "When you defend here" doesn\'t trigger (no controller)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0);
  setBattlefieldCard(g, BF_A, 'Ravenbloom Conservatory');
  put(g, P0, 'V(2)', BF_B); control(g, BF_B, P0);
  const a = put(g, P1, 'V(3)', 'base');
  const sp = put(g, P0, 'Gust', 'deckTop');
  g = drive(move(g, P1, [a], BF_A), [], x => x.pending?.kind === 'showdownAction' && x.pending.player === P0);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Ride the Wind') }), [String(BF_A)]);
  assert.ok(g.log.some(l => /P0 defends/.test(l.text)), 'combat happened with P0 defending');
  assert.equal(zone(g, sp), 'mainDeck', 'no reveal / no spell put into hand');
  assert.ok(!g.log.some(l => /Trigger: Ravenbloom Conservatory/.test(l.text)));
});

test('RJ#12070 empowered Gangplank, Naval chosen by Star-Crossed stays and gets +3 Might instead; the other unit still returns to hand', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1);
  const gp = put(g, P0, 'Gangplank, Naval', 'base'); g.objects[gp].empowered = 1; g.timestamp++;
  const mine = put(g, P1, 'V(2)', 'base');
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Star-Crossed') }), [[mine], [gp]]);
  assert.equal(zone(g, gp), 'base');
  assert.equal(mightOf(g, gp), 9);
  assert.equal(zone(g, mine), 'hand');
});

test('RJ#12071 two Ki Barriers on one unit stack: 14 damage prevented', () => {
  const run = (n: number) => {
    let g = S0(); fundAll(g, P0);
    const u = put(g, P0, 'V(1)', 'base');
    const e = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1); mod(g, e, { might: 5 });
    for (let i = 0; i < n; i++) g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Ki Barrier') }), [[u]]);
    g = drive(move(g, P0, [u], BF_A));
    return zone(g, u);
  };
  assert.equal(run(1), 'trash', 'control: 7 prevented, dies');
  assert.notEqual(run(2), 'trash', 'two barriers: all 14 prevented');
});

test('RJ#12072 Decree of Unity can only kill an enemy Chaos gear (Seal of Discord yes, Seal of Unity no)', () => {
  let g = S0(); fundAll(g, P0);
  const ch = put(g, P1, 'Seal of Discord', 'base');
  const ord = put(g, P1, 'Seal of Unity', 'base');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Decree of Unity') }), [], x => x.pending?.kind === 'chooseTargets');
  const ids = g.pending?.kind === 'chooseTargets' ? g.pending.options!.map(o => o.id) : [];
  if (ids.length) { assert.ok(ids.includes(ch)); assert.ok(!ids.includes(ord)); g = drive(g, [[ch]]); }
  else g = drive(g);
  assert.equal(zone(g, ch), 'trash');
  assert.equal(zone(g, ord), 'base');
});

test('RJ#12073 buffed Rengar, Trophy Hunter (7): Singularity marks 6, then Stupefy (-1) makes it lethal → dies', () => {
  let g = S0(); fundAll(g, P0, 8);
  const r = put(g, P1, 'Rengar, Trophy Hunter', BF_A, { buff: true }); control(g, BF_A, P1);
  assert.equal(mightOf(g, r), 7);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Singularity') }), [[r]]);
  assert.equal(g.objects[r].damage, 6);
  assert.equal(zone(g, r), 'battlefield');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Stupefy') }), [[r]]);
  assert.equal(zone(g, r), 'trash');
});

test('RJ#12074 Irresistible Faefolk moves into an open battlefield and pulls in Fiora, Peerless: one on one, her defend trigger doubles her Might (3 → 6)', () => {
  let g = S0();
  const f = put(g, P0, 'Irresistible Faefolk', 'base');
  const fi = put(g, P1, 'Fiora, Peerless', 'base');
  g = drive(move(g, P0, [f], BF_A), [[fi], 'yes'], x => x.pending?.kind === 'showdownAction' && x.chain.length === 0);
  assert.equal(locOf(g, fi), BF_A);
  assert.equal(mightOf(g, fi), 6);
});

test('RJ#12075 Spinning Axe\'s Equip (no Reaction) can\'t be used on the opponent\'s turn', () => {
  const g = S0({ tp: P1 }); fundAll(g, P0);
  const ax = put(g, P0, 'Spinning Axe', 'base');
  put(g, P0, 'V(2)', 'base');
  assert.ok(!legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === ax));
  const h = S0(); fundAll(h, P0);
  const ax2 = put(h, P0, 'Spinning Axe', 'base'); put(h, P0, 'V(2)', 'base');
  assert.ok(legal(h, P0, 'activate').some(a => a.type === 'activate' && a.obj === ax2), 'control: own turn, open state');
});

test('RJ#12079 a spell without Action/Reaction (Singularity) can\'t be played on the opponent\'s turn, not even in a showdown or in response; a Reaction can', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 8); fundAll(g, P1);
  const sg = hand(g, P0, 'Singularity');
  const ss = hand(g, P0, 'Smoke Screen');
  const a = put(g, P1, 'V(3)', 'base');
  g = drive(move(g, P1, [a], BF_A), [], x => x.pending?.kind === 'showdownAction' && x.pending.player === P0);
  assert.equal(canPlayNow(g, P0, sg), false, 'showdown on the opponent\'s turn');
  assert.equal(canPlayNow(g, P0, ss), true, 'control: a Reaction');
});

test('RJ#12080 Flow doesn\'t change timing: Perfect Execution in the trash can\'t be played on the opponent\'s turn (showdown), but can on my own turn', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const pe = put(g, P0, 'Perfect Execution', 'trash');
  put(g, P0, 'V(2)', 'base');
  const a = put(g, P1, 'V(3)', 'base');
  g = drive(move(g, P1, [a], BF_A), [], x => x.pending?.kind === 'showdownAction' && x.pending.player === P0);
  assert.equal(canPlayNow(g, P0, pe), false);
  const h = S0(); fundAll(h, P0);
  const pe2 = put(h, P0, 'Perfect Execution', 'trash'); put(h, P0, 'V(2)', 'base');
  assert.equal(canPlayNow(h, P0, pe2), true, 'control: own main phase');
});

test('RJ#12081 Akali, Deadly Weapon\'s move trigger is on the chain (Closed): no Action window before the showdown opens; the mover then gets focus', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const ak = put(g, P0, 'Akali, Deadly Weapon', 'base');
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const wp = hand(g, P1, 'Wages of Pain');
  g = drive(move(g, P0, [ak], BF_A), ['yes', 'first'], x => x.pending?.kind === 'chainResponse' && x.pending.player === P1);
  assert.ok(g.chain.length > 0);
  assert.equal(canPlayNow(g, P1, wp), false, 'Action not playable while the trigger is on the chain');
  g = drive(g, [], x => x.pending?.kind === 'showdownAction');
  expectPending(g, 'showdownAction', P0, 'mover (Contested) gets focus first');
});

test('RJ#12082 a damaged unit that moves into an empty battlefield (non-combat showdown) is not healed afterwards', () => {
  let g = S0();
  const u = put(g, P0, 'V(4)', 'base', { damage: 2 });
  g = drive(move(g, P0, [u], BF_A));
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.objects[u].damage, 2);
});

test('RJ#12086 a spell whose only target became invalid still resolves and counts as played: Ravenbloom Student gets +1; a countered one would not', () => {
  const run = (how: 'gust' | 'defy') => {
    let g = S0(); fundAll(g, P0); fundAll(g, P1);
    const rs = put(g, P0, 'Ravenbloom Student', 'base');
    const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
    g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Smoke Screen') }), [[e]], x => x.pending?.kind === 'chainResponse' && x.pending.player === P1);
    g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, how === 'gust' ? 'Gust' : 'Defy') }), how === 'gust' ? [[e]] : []);
    return mightOf(g, rs);
  };
  assert.equal(run('gust'), 3, 'target gone: still played');
  assert.equal(run('defy'), 2, 'countered: not played (trigger)');
});

test('RJ#12087 Battering Ram counts a spell I played that was countered (finalized): costs 4', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const ram = hand(g, P0, 'Battering Ram');
  const e = put(g, P1, 'V(3)', 'base');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Stupefy') }), [[e]], x => x.pending?.kind === 'chainResponse' && x.pending.player === P1);
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Defy') }));
  assert.ok(g.log.some(l => /Stupefy is countered/.test(l.text)));
  assert.equal(playCostOf(g, P0, ram)!.energy, 4);
});

test('RJ#12088 an 8-Might attacker\'s Bellows Breath (1) on my 9-Might defender during the showdown stays marked: combat damage 8 then kills it', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1);
  const d = put(g, P0, 'V(9)', BF_A); control(g, BF_A, P0);
  const a = put(g, P1, 'V(9)', 'base'); mod(g, a, { might: -1 });
  g = drive(move(g, P1, [a], BF_A), [], x => x.pending?.kind === 'showdownAction' && x.pending.player === P1 && x.chain.length === 0);
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Bellows Breath') }), [[d], 'no'], x => x.chain.length === 0 && x.pending?.kind === 'showdownAction');
  assert.equal(g.objects[d].damage, 1);
  g = drive(g);
  assert.equal(zone(g, d), 'trash');
});

test('RJ#12090 the opponent may respond to my Lilting Lullaby with a Reaction: their Abandon counters it, so the "can\'t play spells" restriction never applies', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P0, 'V(3)', 'base');
  const st = hand(g, P1, 'Stupefy');
  g = drive(act(g, { type: 'playCard', player: P1, obj: st }), [], x => x.pending?.kind === 'chainResponse' && x.pending.player === P0);
  const ll = hand(g, P0, 'Lilting Lullaby');
  g = drive(act(g, { type: 'playCard', player: P0, obj: ll }), [], x => x.pending?.kind === 'chainResponse' && x.pending.player === P1);   // only spell: auto-targeted
  const ab = hand(g, P1, 'Abandon');
  assert.ok(canPlayNow(g, P1, ab), 'Reaction playable with Lullaby on the chain');
  g = drive(act(g, { type: 'playCard', player: P1, obj: ab }), [/Lilting Lullaby/, []]);   // spell targets are chain items; then Predict: keep
  assert.equal(zone(g, ll), 'hand', 'Lullaby countered (returned by Abandon)');
  assert.equal(mightOf(g, u), 2, 'Stupefy resolved');
  assert.ok(canPlayNow(g, P1, hand(g, P1, 'Smoke Screen')), 'P1 may still play spells');
});

test('RJ#12092 in response to Soul Harvest on their lone unit, the opponent may Ambush a unit (Rengar) to that battlefield; it stays after the kill', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const e = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const r = hand(g, P1, 'Rengar, Trophy Hunter');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Soul Harvest') }), [], x => x.pending?.kind === 'chainResponse' && x.pending.player === P1);
  assert.ok(canPlayNow(g, P1, r, BF_A), 'Ambush play allowed');
  g = drive(act(g, { type: 'playCard', player: P1, obj: r, destination: BF_A }), ['no', 'no'], x => x.chain.length === 0);
  assert.equal(zone(g, e), 'trash');
  assert.equal(locOf(g, r), BF_A);
  assert.equal(g.battlefields[BF_A].controller, P1);
});

test('RJ#12094 Akali, Deadly Weapon moving onto Teemo, Strategist: her move trigger first, then Teemo\'s defend trigger is chained with no window; the Rogue Assassin ability only after it resolves', () => {
  let g = S0(); fundAll(g, P0);
  const leg = setLegend(g, P0, 'Rogue Assassin');
  const ak = put(g, P0, 'Akali, Deadly Weapon', 'base');
  const tm = put(g, P1, 'Teemo, Strategist', BF_A); control(g, BF_A, P1);
  const canLeg = (x: typeof g) => legal(x, P0, 'activate').some(a => a.type === 'activate' && a.obj === leg);
  g = drive(move(g, P0, [ak], BF_A), ['no'], x => x.chain.some(c => c.source === tm));
  assert.equal(zone(g, tm), 'battlefield');
  assert.equal(canLeg(g), false, 'Closed: the Action ability can\'t respond to the defend trigger');
  g = drive(g, [], x => x.pending?.kind === 'showdownAction' && x.chain.length === 0);
  expectPending(g, 'showdownAction', P0);
  assert.ok(canLeg(g), 'usable in the open showdown');
});

test('RJ#12095 Akali, Deadly Weapon\'s move trigger kills the 2-Might Ravenbloom Student at Fortified Position before combat is staged: no defend trigger, no Shield', () => {
  let g = S0(); fundAll(g, P0);
  setBattlefieldCard(g, BF_A, 'Fortified Position');
  const ak = put(g, P0, 'Akali, Deadly Weapon', 'base'); g.objects[ak].empowered = 1; g.timestamp++;
  const rs = put(g, P1, 'Ravenbloom Student', BF_A); control(g, BF_A, P1);
  g = drive(move(g, P0, [ak], BF_A), ['yes', [rs]]);
  assert.equal(zone(g, rs), 'trash');
  assert.ok(!g.log.some(l => /Trigger: Fortified Position/.test(l.text)));
  assert.equal(g.battlefields[BF_A].controller, P0, 'no combat: Akali conquers');
});

test('RJ#12097 Temporal Breach on my unit at a battlefield I control: replayed there, no Contested/showdown, no conquer', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Temporal Breach') }), [[u]]);
  assert.equal(locOf(g, u), BF_A);
  assert.ok(!g.log.some(l => /Showdown at BF-A/.test(l.text)));
  assert.equal(g.players[P0].points, 0);
});

test('RJ#12098 empowered Applied Researchers discounts the total including Repeat: Bellows Breath + Repeat pays [1] + 1 power instead of [2] + 2', () => {
  const run = (emp: boolean) => {
    let g = S0(); setRunes(g, P0, 6, 'mind');
    const ar = put(g, P0, 'Applied Researchers', 'base'); if (emp) { g.objects[ar].empowered = 1; g.timestamp++; }
    const e = put(g, P1, 'V(9)', 'base');
    g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Bellows Breath') }), [[e], 'yes', [e]]);
    return g.log.filter(l => /^P0 pays/.test(l.text)).map(l => l.text);
  };
  assert.deepEqual(run(false), ['P0 pays 2 M M']);
  assert.deepEqual(run(true), ['P0 pays 1 M']);
});

test('RJ#12100 Imperial Decree + my 2-Might attacker vs a 4-Might unit and a 2-Might Backline unit: the 2 damage must go to the 4-Might unit (killed by Decree); the Backline unit survives', () => {
  let g = S0(); fundAll(g, P0);
  const big = put(g, P1, 'V(4)', BF_A); control(g, BF_A, P1);
  const bl = put(g, P1, 'Enthusiastic Promoter', BF_A);
  const a = put(g, P0, 'V(2)', 'base');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Imperial Decree') }));
  g = drive(move(g, P0, [a], BF_A), [], x => x.pending?.kind === 'assignDamage' && x.pending.player === P0);
  if (g.pending?.kind === 'assignDamage') {
    const sug = (g.pending.data as { suggested: Record<string, number> }).suggested;
    assert.equal(sug[bl] ?? 0, 0, 'Backline gets nothing');
    assert.ok(rejects(g, { type: 'assignDamage', player: P0, assignment: { [bl]: 2 } }), 'illegal to assign to the Backline unit');
  }
  g = drive(g);
  assert.equal(zone(g, big), 'trash');
  assert.equal(zone(g, bl), 'battlefield');
  assert.equal(zone(g, a), 'trash');
});

test('RJ#12101 Flame Chompers burned from the top of the deck (Death Mark\'s [Burn 3]) is not discarded: no trigger, it stays in the trash', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  const fc = put(g, P0, 'Flame Chompers', 'deckTop');
  put(g, P1, 'V(5)', 'base');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Death Mark') }), ['first', 'first', 'first']);
  assert.equal(zone(g, fc), 'trash');
  assert.ok(!g.log.some(l => /Trigger: Flame Chompers/.test(l.text)));
});

test('RJ#12103 my Stupefy (with my empowered Mel, Newly Awakened) on my empowered Gangplank, Naval: the whole -Might is replaced, he gets +3 (9) whichever replacement applies first', () => {
  for (const first of [/^Mel/, /^Gangplank/]) {
    let g = S0(); fundAll(g, P0);
    const mel = put(g, P0, 'Mel, Newly Awakened', 'base'); g.objects[mel].empowered = 3;
    const gp = put(g, P0, 'Gangplank, Naval', 'base'); g.objects[gp].empowered = 1; g.timestamp++;
    g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Stupefy') }), [[gp]], x => x.pending?.kind === 'chooseOrder' || x.pending?.kind === 'mainAction');
    if (g.pending?.kind === 'chooseOrder') g = drive(g, [first]);
    assert.equal(mightOf(g, gp), 9, String(first));
  }
});

test('RJ#12104 The List: the tag is named as it is played (no window); its [T] ability uses the chain and can be responded to', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const rs = put(g, P1, 'Ravenbloom Student', 'base');
  const tl = hand(g, P0, 'The List');
  let p1Window = false;
  g = drive(act(g, { type: 'playCard', player: P0, obj: tl }), [], x => { if (x.pending?.player === P1) p1Window = true; return x.pending?.kind === 'chooseMode'; });
  assert.equal(p1Window, false, 'no window before the tag is named');
  g = drive(g, ['Noxus'], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, tl), 'base');
  const a = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === tl);
  assert.ok(a);
  g = drive(act(g, a!), [], x => x.pending?.kind === 'chainResponse' && x.pending.player === P1);
  expectPending(g, 'chainResponse', P1);
  assert.ok(g.chain.some(c => c.source === tl));
});

test('RJ#12105 Wuju Bladesman + Fiora, Peerless defending one on one: +2 first (5), doubled to 10; Punch First (Action) only after the trigger resolves → 15', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0);
  setLegend(g, P0, 'Wuju Bladesman');
  const fi = put(g, P0, 'Fiora, Peerless', BF_A); control(g, BF_A, P0);
  const a = put(g, P1, 'V(1)', 'base');
  const pf = hand(g, P0, 'Punch First');
  g = drive(move(g, P1, [a], BF_A), [], x => x.chain.some(c => c.source === fi) && x.pending?.player === P0 && !x.pending.inStep);
  assert.equal(mightOf(g, fi), 5, 'lone defender +2 before the doubling resolves');
  assert.equal(canPlayNow(g, P0, pf), false, 'Action not playable with the trigger on the chain');
  g = drive(g, [], x => x.pending?.kind === 'showdownAction' && x.pending.player === P0 && x.chain.length === 0);
  assert.equal(mightOf(g, fi), 10);
  g = drive(act(g, { type: 'playCard', player: P0, obj: pf }), [[fi]], x => x.chain.length === 0 && x.pending?.kind === 'showdownAction');
  assert.equal(mightOf(g, fi), 15);
});

test('RJ#12106 hidden Switcheroo as the defender\'s second card: the swap uses Darius\' 5 (his second-card +2 comes after) → attacker 5, Darius 7 then 9', () => {
  let g = S0(); fundAll(g, P1);
  const a = put(g, P0, 'V(7)', 'base');
  const b = put(g, P0, 'V(2)', 'base');
  const d = put(g, P1, 'Darius, Trifarian', BF_A); control(g, BF_A, P1);
  const sw = put(g, P1, 'Switcheroo', { facedown: BF_A });
  g = drive(move(g, P0, [a], BF_A), [], x => x.pending?.kind === 'showdownAction' && x.pending.player === P1 && x.chain.length === 0);
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Smoke Screen') }), [[b]], x => x.chain.length === 0 && x.pending?.kind === 'showdownAction' && x.pending.player === P1);
  g = drive(act(g, { type: 'playCard', player: P1, obj: sw }), [[a, d]], x => x.chain.length === 0 && x.pending?.kind === 'showdownAction');
  assert.equal(mightOf(g, a), 5);
  assert.equal(mightOf(g, d), 9, 'swapped to 7, then +2 from his second-card trigger');
});

test('RJ#12107 Kayle, Justified can be empowered a 2nd and 3rd time; Matriarch of War triggers each time but is just Empowered once', () => {
  let g = S0(); fundAll(g, P0, 8);
  const leg = setLegend(g, P0, 'Matriarch of War');
  const k = put(g, P0, 'Kayle, Justified', 'base');
  for (let i = 0; i < 3; i++) {
    const a = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === k);
    assert.ok(a, `activation ${i + 1} legal`);
    g = drive(act(g, a!));
  }
  assert.equal(mightOf(g, k), 9);
  assert.ok(g.objects[leg].empowered);
  assert.ok(Number(g.objects[leg].empowered) <= 1, 'legend Empowered once (binary)');
});

test('RJ#12110 Ivern, Friend to All counts Bird/Cat/Dog/Poro tags among all my units, wherever they are (base units count)', () => {
  const run = (withDog: boolean) => {
    let g = S0();
    const iv = put(g, P0, 'Ivern, Friend to All', 'base');
    for (const n of ['Iridescent Avian', 'Fretful Feline', 'Punching Poro']) put(g, P0, n, 'base');
    if (withDog) put(g, P0, 'Hunting Dog', 'base');
    g = drive(move(g, P0, [iv], BF_A));
    return g.players[P0].points;
  };
  assert.equal(run(false), 1, 'control: missing Dog → conquer point only');
  assert.equal(run(true), 2, 'Dog at base counts');
});

test('RJ#12112 a unit played from the opponent\'s trash by Kharox\'s empower trigger is mine to control but still theirs: when it dies it goes to their trash', () => {
  let g = S0(); fundAll(g, P0, 8);
  const kh = put(g, P0, 'Kharox', 'base');
  const t = put(g, P1, 'V(2)', 'trash');
  g = drive(act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === kh)!), ['yes', [t]]);   // opponent auto-chosen; destination base (only option)
  assert.equal(zone(g, t), 'base');
  assert.equal(g.objects[t].controller, P0);
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  g.objects[t].exhausted = false; g.timestamp++;          // setup: ready it to attack and die
  g = drive(move(g, P0, [t], BF_A));
  assert.equal(zone(g, t), 'trash');
  assert.ok(g.players[P1].trash.includes(t), "in its owner's trash");
});

test('RJ#12116 hidden Zhonya\'s Hourglass played in response to Lonely Poro\'s Deathknell: legal, but the Poro is already dead (no replacement); the Deathknell still draws', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const lp = put(g, P0, 'Lonely Poro', BF_A); control(g, BF_A, P0);
  const zh = put(g, P0, "Zhonya's Hourglass", { facedown: BF_A });
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Soul Harvest') }), [], x => x.pending?.kind === 'chainResponse' && x.pending.player === P0 && x.chain.some(c => c.source === lp));
  assert.equal(zone(g, lp), 'trash');
  assert.ok(canPlayNow(g, P0, zh), 'Zhonya\'s playable from hiding in response to the Deathknell');
  const h0 = g.players[P0].hand.length;
  g = drive(act(g, { type: 'playCard', player: P0, obj: zh }));
  assert.equal(zone(g, lp), 'trash', 'not saved');
  assert.equal(zone(g, zh), 'base');
  assert.equal(g.players[P0].hand.length, h0 + 1, 'Deathknell: died alone → draw 1');
});

test('RJ#12118 hidden Zhonya\'s Hourglass flipped in response to the kill spell (Soul Harvest) itself replaces the Poro\'s death: healed, exhausted, recalled, no Deathknell', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const lp = put(g, P0, 'Lonely Poro', BF_A); control(g, BF_A, P0);
  const zh = put(g, P0, "Zhonya's Hourglass", { facedown: BF_A });
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Soul Harvest') }), [], x => x.pending?.kind === 'chainResponse' && x.pending.player === P0);
  const h0 = g.players[P0].hand.length;
  g = drive(act(g, { type: 'playCard', player: P0, obj: zh }));
  assert.equal(locOf(g, lp), 'base', 'recalled instead of dying');
  assert.equal(g.objects[lp].exhausted, true);
  assert.equal(zone(g, zh), 'trash', 'Zhonya\'s killed instead');
  assert.equal(g.players[P0].hand.length, h0, 'no Deathknell draw');
});

test('RJ#12120 my lone defender killed during the combat showdown: I keep control while contested, the hidden card stays (playable); with no units after the combat it is trashed', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const d = put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const h = put(g, P0, 'HidU(2)', { facedown: BF_A });
  const a = put(g, P1, 'V(9)', 'base');
  g = drive(move(g, P1, [a], BF_A), [], x => x.pending?.kind === 'showdownAction' && x.pending.player === P1 && x.chain.length === 0);
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Wages of Pain') }), [[d]], x => x.chain.length === 0 && x.pending?.kind === 'showdownAction');
  assert.equal(zone(g, d), 'trash');
  assert.equal(zone(g, h), 'facedown', 'still hidden during the showdown');
  assert.ok(canPlayNow(g, P0, h), 'can still be played from hiding');
  g = drive(g);
  assert.equal(zone(g, h), 'trash', 'trashed once the showdown ends with no units');
});

test('RJ#12124 Renekton, Brute\'s "[1]: +1 Might" is a plain activated ability: not usable on the opponent\'s turn (chain window), usable in my own main phase', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const r = put(g, P0, 'Renekton, Brute', 'base');
  const v = put(g, P0, 'V(3)', 'base');
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'ZapM') }), [[v]], x => x.pending?.kind === 'chainResponse' && x.pending.player === P0);
  expectPending(g, 'chainResponse', P0);
  assert.equal(legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === r), false, 'no activation on the enemy turn');
  g = drive(g);
  g = nextTurn(g);
  fundAll(g, P0);
  assert.equal(g.activePlayer, P0);
  assert.ok(legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === r), 'own main phase: legal');
});

test('RJ#12125 a Reaction (Siren\'s Song) moves the attacker away while its move trigger (Traveling Merchant) is on the chain: no combat, the defender keeps the battlefield', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  hand(g, P0, 'V(1)');
  const tm = put(g, P0, 'Traveling Merchant', 'base');
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  g = drive(move(g, P0, [tm], BF_A), [], x => x.pending?.kind === 'chainResponse' && x.pending.player === P1);
  assert.ok(g.chain.some(c => c.source === tm), 'move trigger on the chain');
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, "Siren's Song") });
  g = drive(g, ['base', 'first', 'first'], x => x.pending?.kind === 'mainAction');
  assert.notEqual(locOf(g, tm), BF_A, 'moved away');
  assert.equal(zone(g, tm), 'base');
  assert.equal(zone(g, e), 'battlefield');
  assert.equal(g.objects[e].damage ?? 0, 0, 'no combat damage');
  assert.equal(g.battlefields[BF_A].controller, P1);
});

test('RJ#12129 Kennen, Storm of Shuriken conquering Minefield: his trash spell is chosen when chained, so a spell Minefield puts into the trash gets no Flow', () => {
  let g = S0(); fundAll(g, P0);
  setBattlefieldCard(g, BF_A, 'Minefield');
  const m1 = put(g, P0, 'ZapM', 'deckTop'); const m2 = put(g, P0, 'ZapM', 'deckTop');
  const k = put(g, P0, 'Kennen, Storm of Shuriken', 'base');
  g = drive(move(g, P0, [k], BF_A), ['first', 'first', 'first'], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, m1), 'trash'); assert.equal(zone(g, m2), 'trash');
  put(g, P1, 'V(5)', 'base');
  assert.equal(canPlayNow(g, P0, m1), false, 'milled spell: no Flow');
  assert.equal(canPlayNow(g, P0, m2), false);
});

test('RJ#12130 Rebuttal\'s counter branch on a spell played with Flow: banished (not trashed)', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const du = put(g, P0, 'Dredge Up', 'trash');
  g = drive(act(g, { type: 'playCard', player: P0, obj: du }), [], x => x.pending?.kind === 'chainResponse' && x.pending.player === P1);
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Rebuttal') }), ['first', 'no', 'no'], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, du), 'banishment');
});

test('RJ#12130 (MISMATCH-RJ aside) Rebuttal steals a Flow-played spell: it resolves for the stealer and is still banished (DECISIONS #11990: banished, countered or not)', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const du = put(g, P0, 'Dredge Up', 'trash');
  g = drive(act(g, { type: 'playCard', player: P0, obj: du }), [], x => x.pending?.kind === 'chainResponse' && x.pending.player === P1);
  const rb = hand(g, P1, 'Rebuttal');
  const h1 = g.players[P1].hand.length;
  g = drive(act(g, { type: 'playCard', player: P1, obj: rb }), ['first', 'yes', 'no', 'no'], x => x.pending?.kind === 'mainAction');
  assert.equal(g.players[P1].hand.length, h1, 'stealer drew 1 (Rebuttal left the hand, +1 draw)');
  assert.equal(zone(g, du), 'banishment');
});

test('RJ#12131 Lotus Trap on Mystic Poro: Lonely Poro (2) vs Mystic + Sinister Poro: 1 to each attacker is lethal; everyone dies, Lonely Poro draws, nobody scores, the battlefield is uncontrolled', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const lp = put(g, P0, 'Lonely Poro', BF_A); control(g, BF_A, P0);
  const lt = put(g, P0, 'Lotus Trap', { facedown: BF_A });
  const mp = put(g, P1, 'Mystic Poro', 'base'); const sp = put(g, P1, 'Sinister Poro', 'base');
  g = drive(move(g, P1, [mp, sp], BF_A), ['no'], x => x.pending?.kind === 'showdownAction' && x.pending.player === P0 && x.chain.length === 0);
  g = drive(act(g, { type: 'playCard', player: P0, obj: lt }), [[mp]], x => x.chain.length === 0 && x.pending?.kind === 'showdownAction');
  const h0 = g.players[P0].hand.length; const pts = [g.players[P0].points, g.players[P1].points];
  for (let i = 0; i < 20 && !(g.pending?.kind === 'assignDamage' && g.pending.player === P0); i++) g = pass(g);
  expectPending(g, 'assignDamage', P0);
  g = drive(act(g, { type: 'assignDamage', player: P0, assignment: { [mp]: 1, [sp]: 1 } }), [], x => x.pending?.kind === 'mainAction');
  for (const u of [lp, mp, sp]) assert.equal(zone(g, u), 'trash', nameOf(g, u));
  assert.equal(g.players[P0].hand.length, h0 + 1, 'Lonely Poro died alone: draw 1');
  assert.deepEqual([g.players[P0].points, g.players[P1].points], pts, 'no score');
  assert.equal(g.battlefields[BF_A].controller ?? null, null);
});

test('RJ#12133 Lucian, Gunslinger attacks a lone Deflect unit: the trigger is mandatory and must choose it, but Lucian may refuse the Deflect cost → trigger removed, no damage', () => {
  let g = S0(); fundAll(g, P0);
  const l = put(g, P0, 'Lucian, Gunslinger', 'base');
  const r = put(g, P1, 'Storm Raptor', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [l], BF_A);
  const kinds: string[] = [];
  for (let i = 0; i < 6 && g.pending?.inStep && g.pending.player === P0; i++) {
    kinds.push(g.pending.kind);
    const o = g.pending.options!.find(x => /no|decline|refuse|don't/i.test(x.label) || /^no$/.test(x.id));
    assert.ok(o, `no decline option in ${g.pending.kind}: ${JSON.stringify(g.pending.options!.map(x => x.label))}`);
    g = ans(g, o!.id);
  }
  assert.ok(kinds.length >= 1, 'asked about the Deflect cost');
  assert.equal(g.chain.some(c => c.source === l), false, 'trigger removed');
  g = drive(g, [], x => x.pending?.kind === 'assignDamage' || x.pending?.kind === 'showdownAction');
  assert.equal(g.objects[r].damage ?? 0, 0, 'no trigger damage');
});

test('RJ#12137 Zed, Without a Sound\'s swap is an Action ability: not usable in response to a spell targeting him (chain), usable in the open state', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const z = put(g, P0, 'Zed, Without a Sound', BF_A); control(g, BF_A, P0);
  const c = place(g, P0, 'tok-shadow-clone', 'base', { token: true });
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'ZapM') }), [[z]], x => x.pending?.kind === 'chainResponse' && x.pending.player === P0);
  assert.equal(legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === z), false, 'no swap with a spell on the chain');
  g = drive(g);
  assert.equal(g.objects[z].damage, 2, 'the spell hit Zed');
  g = nextTurn(g); fundAll(g, P0);
  assert.ok(legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === z), 'open state: legal');
  assert.ok(c);
});

test('RJ#12138 an enemy-controlled Amateur Recital\'s hold trigger can\'t choose my Baron Nashor (enemy ability "moves a unit" = chooses)', () => {
  const g0 = S0({ tp: P1 }); setBattlefieldCard(g0, BF_A, 'Amateur Recital');
  put(g0, P0, 'V(2)', BF_A); control(g0, BF_A, P0);
  const bn = put(g0, P1, 'Baron Nashor', BF_B); control(g0, BF_B, P1);
  const v = put(g0, P1, 'V(1)', BF_B);
  let g = endTurn(g0, P1);
  let offeredBaron = false, offeredOther = false;
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.inStep && d.options!.some(o => o.id === bn)) offeredBaron = true;
    if (d.inStep && d.options!.some(o => o.id === v)) offeredOther = true;
    g = d.inStep ? ans(g, d.options!.find(o => o.id === v)?.id ?? (d.kind === 'optional' ? 'yes' : d.options![0].id)) : pass(g);
  }
  assert.equal(offeredOther, true, 'control: a normal enemy unit is choosable');
  assert.equal(offeredBaron, false, 'Baron not choosable');
  assert.equal(locOf(g, bn), BF_B);
});

test('RJ#12139 Ezreal, Prodigy doesn\'t reduce Mask Mother\'s "you may pay [1]" trigger cost (not an optional additional cost to play a card)', () => {
  let g = S0(); setRunes(g, P0, 1);
  put(g, P0, 'Ezreal, Prodigy', 'base');
  const tm = put(g, P0, 'Traveling Merchant', 'base');
  const mm = hand(g, P0, 'Mask Mother');
  g = drive(move(g, P0, [tm], BF_A), ['yes', [tm]], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, mm), 'trash');
  assert.equal(g.players[P0].runesInPlay.filter(r => g.objects[r].exhausted).length, 1, 'the full [1] was paid');
  assert.equal(mightOf(g, tm), 4, '+2');
});

test('RJ#12140 Overzealous Fan moves the attacker to base: its "when I attack" trigger still resolves; "here" parts do nothing (Lucian, Gunslinger deals no damage)', () => {
  let g = S0(); fundAll(g, P1);
  const l = put(g, P0, 'Lucian, Gunslinger', 'base');
  const f = put(g, P1, 'Overzealous Fan', BF_A); const e = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  g = drive(move(g, P0, [l], BF_A), [[e], 'yes', [l], 'first', 'first'], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, f), 'trash', 'Fan killed itself');
  assert.equal(locOf(g, l), 'base');
  assert.equal(g.objects[e].damage ?? 0, 0, '"an enemy unit here": nothing');
});

test('RJ#12142 Shuriken Flip: the enemy target Retreats in response; the damage part fizzles but my unit still moves to the chosen destination', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(3)', BF_B); control(g, BF_B, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Shuriken Flip') });
  g = ans(g, [e], 'base');
  g = drive(g, [], x => x.pending?.kind === 'chainResponse' && x.pending.player === P1);
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Retreat') }), [[e]], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, e), 'hand');
  assert.equal(locOf(g, u), 'base', 'the move still happened');
});

test('RJ#12144 Rebuttal takes Star-Crossed: my own Ruin Runner can be the new friendly choice (returned to hand); the opponent\'s Ruin Runner can\'t be chosen', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const a = put(g, P1, 'V(2)', 'base'), rrOpp = put(g, P1, 'Ruin Runner', 'base'), b = put(g, P1, 'V(3)', 'base');
  const c = put(g, P0, 'V(2)', 'base'), rrMine = put(g, P0, 'Ruin Runner', 'base');
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Star-Crossed') });
  g = ans(g, [a]);   // the enemy unit c is the only choosable one (their Ruin Runner view: mine can't be chosen)
  g = drive(g, [], x => x.pending?.kind === 'chainResponse');
  g = pass(g);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Rebuttal') });
  g = drive(g, ['first', 'yes', 'yes'], x => x.pending?.kind === 'chooseTargets');
  const seen: string[][] = [];
  for (let i = 0; i < 4 && g.pending?.kind === 'chooseTargets'; i++) {
    const ids = g.pending.options!.map(o => o.id); seen.push(ids);
    g = ans(g, [ids.includes(rrMine) ? rrMine : ids.includes(b) ? b : ids[0]]);
  }
  assert.ok(seen.some(s => s.includes(rrMine)), 'my Ruin Runner offered as the friendly unit');
  assert.ok(seen.every(s => !s.includes(rrOpp)), 'their Ruin Runner never offered');
  g = drive(g);
  assert.equal(zone(g, rrMine), 'hand');
  assert.equal(zone(g, b), 'hand');
  assert.equal(zone(g, rrOpp), 'base');
});

test('RJ#12143 Existential Dread + Repeat stuns two different attacking enemy units', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  put(g, P0, 'V(9)', BF_A); control(g, BF_A, P0);
  const x1 = put(g, P1, 'V(2)', 'base'), x2 = put(g, P1, 'V(3)', 'base');
  g = drive(move(g, P1, [x1, x2], BF_A), [], x => x.pending?.kind === 'showdownAction' && x.pending.player === P0 && x.chain.length === 0);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Existential Dread') });
  const picks = [x1, x2];
  for (let i = 0; i < 6 && g.pending?.inStep; i++) {
    const d = g.pending;
    if (d.kind === 'optional') { g = ans(g, 'yes'); continue; }
    const p = d.options!.find(o => o.id === picks[0]);
    if (p) { picks.shift(); g = ans(g, [p.id]); continue; }
    g = ans(g, d.options!.find(o => /repeat|yes/i.test(o.label))?.id ?? d.options![0].id);
  }
  g = drive(g, [], x => x.chain.length === 0 && x.pending?.kind === 'showdownAction');
  assert.ok(g.objects[x1].stunned, 'first stunned');
  assert.ok(g.objects[x2].stunned, 'second stunned');
});

test('RJ#12145 Threshold of the Gray: conquering it empty is not a combat — no Energy added', () => {
  let g = S0();
  setBattlefieldCard(g, BF_A, 'Threshold of the Gray');
  const u = put(g, P0, 'V(2)', 'base');
  g = drive(move(g, P0, [u], BF_A), [], x => x.pending?.kind === 'mainAction');
  assert.equal(g.battlefields[BF_A].controller, P0, 'conquered');
  assert.equal(g.players[P0].pool.energy, 0);
  assert.equal(g.players[P1].pool.energy, 0);
});

test('RJ#12146 Sunken Temple: the conqueror declines the [1]-to-draw → the trigger never reaches the chain, no reaction window', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  setBattlefieldCard(g, BF_A, 'Sunken Temple');
  const u = put(g, P0, 'V(5)', 'base');
  g = move(g, P0, [u], BF_A);
  let p1Window = false, asked = false;
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    if (d.kind === 'optional' && d.player === P0) { asked = true; g = ans(g, 'no'); continue; }
    if (d.player === P1 && d.kind === 'chainResponse' && g.chain.length) p1Window = true;
    g = d.inStep ? ans(g, 'first') : pass(g);
  }
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.ok(asked, 'Sunken Temple asked');
  assert.equal(p1Window, false, 'no window for a declined Sunken Temple');
});

test('RJ#12147 Atakhan\'s attack trigger: a lone defending Ruin Runner must be killed by its controller (the defender chooses; nothing is chosen by the enemy ability)', () => {
  let g = S0();
  const at = put(g, P0, 'Atakhan', 'base');
  const rr = put(g, P1, 'Ruin Runner', BF_A); control(g, BF_A, P1);
  g = drive(move(g, P0, [at], BF_A), ['first', 'first'], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, rr), 'trash');
  assert.equal(g.battlefields[BF_A].controller, P0, 'no defender left: Atakhan conquers');
});

test('RJ#12154 Rebuttal paying [A] but declining new choices: the stolen spell keeps its choices (my Zap still hits my own unit)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const mine = put(g, P0, 'V(3)', 'base'); const theirs = put(g, P1, 'V(3)', 'base');
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'ZapR') }), [[mine]], x => x.pending?.kind === 'chainResponse' && x.pending.player === P0);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Rebuttal') });
  g = drive(g, ['yes', 'no'], x => x.pending?.kind === 'mainAction');
  assert.equal(g.objects[mine].damage, 2, 'original target kept');
  assert.equal(g.objects[theirs].damage ?? 0, 0);
});

test('RJ#12158 Ki Barrier + Lotus Trap on my 4-Might attacker vs a 4-Might defender: I order the replacements — Ki Barrier first → 0 damage; Lotus Trap first → 8 - 7 = 1 damage', () => {
  const run = (first: RegExp) => {
    let g = S0(); fundAll(g, P0); fundAll(g, P1);
    const u = put(g, P0, 'V(4)', 'base'); const d = put(g, P1, 'Tank(4)', BF_A); control(g, BF_A, P1);
    g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Ki Barrier') }), [[u]], x => x.pending?.kind === 'mainAction');
    g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Lotus Trap') }), [[u]], x => x.pending?.kind === 'mainAction');
    let asked = false; const l0 = g.log.length;
    g = drive(move(g, P0, [u], BF_A), [], x => x.pending?.kind === 'chooseOrder');
    if (g.pending?.kind === 'chooseOrder') { asked = true; assert.equal(g.pending.player, P0); g = ans(g, first); }
    g = drive(g, [], x => x.pending?.kind === 'mainAction');
    assert.ok(asked, 'order asked');
    assert.equal(zone(g, d), 'trash');
    assert.equal(zone(g, u), 'battlefield');
    return g.log.slice(l0).map(l => /deals (\d+) to V\(4\)/.exec(l.text)).filter(Boolean).reduce((s, m) => s + Number(m![1]), 0);   // healed after combat: read the log
  };
  assert.equal(run(/Ki Barrier/), 0);
  assert.equal(run(/Lotus Trap/), 1);
});

test('RJ#12162 disempowering a Kayle, Justified empowered three times removes one stack (9 → 7 Might)', () => {
  let g = S0(); fundAll(g, P0, 8);
  const k = put(g, P0, 'Kayle, Justified', 'base');
  for (let i = 0; i < 3; i++) g = drive(act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === k)!));
  assert.equal(mightOf(g, k), 9);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Sanction') }), ['disempower', [k]], x => x.pending?.kind === 'mainAction');
  assert.equal(mightOf(g, k), 7, 'one stack removed');
  assert.ok(g.objects[k].empowered, 'still Empowered');
});

test('RJ#12163 Kayle, Justified\'s Empower can be activated while already Empowered three times; it then does nothing', () => {
  let g = S0(); fundAll(g, P0, 8);
  const k = put(g, P0, 'Kayle, Justified', 'base');
  for (let i = 0; i < 3; i++) g = drive(act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === k)!));
  const a = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === k);
  assert.ok(a, '4th activation legal');
  g = drive(act(g, a!));
  assert.equal(mightOf(g, k), 9, 'no 4th stack');
});

test('RJ#12164 Star-Crossed chooses my unit and a defending Akali, Silent; Flash moves her to base (out of combat) in response: she is no longer choosable → unaffected; my unit still returns', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const x = put(g, P0, 'V(2)', 'base'), y = put(g, P0, 'V(2)', 'base');
  const ak = put(g, P1, 'Akali, Silent', BF_A); control(g, BF_A, P1);
  g = drive(move(g, P0, [x, y], BF_A), [], x2 => x2.pending?.kind === 'showdownAction' && x2.pending.player === P0 && x2.chain.length === 0);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Star-Crossed') });
  for (let i = 0; i < 3 && g.pending?.kind === 'chooseTargets'; i++) g = ans(g, [g.pending.options!.some(o => o.id === ak) ? ak : x]);
  g = drive(g, [], x2 => x2.pending?.kind === 'chainResponse' && x2.pending.player === P1);
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Flash') }), [[ak]], x2 => x2.chain.length === 1 && x2.pending?.kind === 'chainResponse');
  assert.equal(locOf(g, ak), 'base');
  g = drive(g, [], x2 => x2.chain.length === 0);
  assert.equal(zone(g, x), 'hand', 'my unit returned');
  assert.equal(zone(g, ak), 'base', 'Akali unaffected (not in combat any more)');
});

test('RJ#12166 Swain, Visionary: having played only Patched Porobot (a unit and a gear) and Stupefy satisfies "a non-token unit, a non-token gear and a spell" → 2 points', () => {
  let g = S0(); fundAll(g, P0, 8);
  const sw = put(g, P0, 'Swain, Visionary', 'base');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Patched Porobot'), destination: 'base' }));
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Stupefy') }), [[sw]]);
  g = drive(move(g, P0, [sw], BF_A));
  assert.equal(g.players[P0].points, 2);
});

test('RJ#12167 opponent\'s Switcheroo on their 2-Might unit and my empowered Gangplank, Naval (6): their unit 6, Gangplank\'s decrease replaced by +3 → 9', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1);
  const gp = put(g, P0, 'Gangplank, Naval', BF_A); g.objects[gp].empowered = 1; g.timestamp++;
  control(g, BF_A, P0);
  const a = put(g, P1, 'V(2)', 'base');
  g = drive(move(g, P1, [a], BF_A), [], x => x.pending?.kind === 'showdownAction' && x.pending.player === P1 && x.chain.length === 0);
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Switcheroo') }), [[a, gp]], x => x.chain.length === 0 && x.pending?.kind === 'showdownAction');
  assert.equal(mightOf(g, a), 6);
  assert.equal(mightOf(g, gp), 9);
});

test('RJ#12168 Blast Cone\'s move-then-stun doesn\'t choose empowered Gangplank, Naval: he is stunned (no +3); Back Off on the already-stunned Gangplank gives no +3 either', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1);
  const gp = put(g, P0, 'Gangplank, Naval', BF_A); g.objects[gp].empowered = 1; g.timestamp++;
  control(g, BF_A, P0);
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Blast Cone') }), [[gp], 'loc:base', 'yes'], x => x.pending?.kind === 'mainAction');
  assert.equal(locOf(g, gp), 'base', 'moved');
  assert.ok(g.objects[gp].stunned, 'stunned');
  assert.equal(mightOf(g, gp), 6, 'no +3');
  // part 2 (own turn): Back Off chooses the already-stunned Gangplank
  let h = S0(); fundAll(h, P0);
  const gp2 = put(h, P0, 'Gangplank, Naval', 'base'); h.objects[gp2].empowered = 1; h.objects[gp2].stunned = true; h.timestamp++;
  h = drive(act(h, { type: 'playCard', player: P0, obj: hand(h, P0, 'Back Off') }), [[gp2]], x => x.pending?.kind === 'mainAction');
  assert.equal(mightOf(h, gp2), 6, 'stun not performed again → no replacement');
});

test('RJ#12169 Stupefy on my 1-Might empowered Gangplank, Naval gives no -Might (minimum 1), so there is nothing to replace: no +3', () => {
  let g = S0(); fundAll(g, P0);
  const gp = put(g, P0, 'Gangplank, Naval', 'base'); g.objects[gp].empowered = 1; g.timestamp++;
  mod(g, gp, { might: -5 });
  assert.equal(mightOf(g, gp), 1);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Stupefy') }), [[gp]], x => x.pending?.kind === 'mainAction');
  assert.equal(mightOf(g, gp), 1, 'no +3');
});

test('RJ#12171 Heimerdinger, Inventor gains the legend\'s "[Empowered] [1], [T]: Ready 2 gear": usable iff Heimerdinger himself is Empowered (Jayce legend not Empowered)', () => {
  const setup = (emp: boolean) => {
    let g = S0(); fundAll(g, P0);
    const leg = setLegend(g, P0, 'Defender of Tomorrow');
    const h = put(g, P0, 'Heimerdinger, Inventor', 'base');
    const gs = [put(g, P0, 'Seal of Discord', 'base'), put(g, P0, 'Seal of Discord', 'base')];
    for (const x of gs) g.objects[x].exhausted = true;
    if (emp) g.objects[h].empowered = 1;
    g.timestamp++;
    return { g, h, gs, leg };
  };
  const n = (s: ReturnType<typeof setup>) => legal(s.g, P0, 'activate').filter(a => a.type === 'activate' && a.obj === s.h).length;
  const off = setup(false), on = setup(true);
  assert.equal(off.g.objects[off.leg].empowered ? 1 : 0, 0, 'legend not Empowered');
  assert.equal(n(on), n(off) + 1, 'the Empowered line is usable only when Heimerdinger is Empowered');
  const extra = legal(on.g, P0, 'activate').filter(a => a.type === 'activate' && a.obj === on.h)
    .find(a => !legal(off.g, P0, 'activate').some(b => b.type === 'activate' && b.obj === off.h && (b as { abilityIndex?: number }).abilityIndex === (a as { abilityIndex?: number }).abilityIndex));
  let g = drive(act(on.g, extra!), [on.gs, 'first'], x => x.pending?.kind === 'mainAction');
  assert.ok(on.gs.every(x => !g.objects[x].exhausted), 'both gear readied');
  assert.ok(g.objects[on.h].exhausted, 'Heimerdinger exhausted');
});

test('RJ#12173 Temporal Breach on my Elder Dragon in base with Dragon Roost in play: I may pay Roost\'s [A][A] and choose to play it to the Roost instead of base (VEN-FAQ)', () => {
  let g = S0(); fundAll(g, P0, 8);
  setBattlefieldCard(g, BF_A, 'Dragon Roost');
  const ed = put(g, P0, 'Elder Dragon', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Temporal Breach') });
  let offered = false;
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    const roost = d.options!.find(o => o.id === String(BF_A) || /Roost/i.test(o.label) || (d.kind === 'optional' && /Roost|\[A\]\[A\]/i.test(d.prompt ?? '')));
    if (roost) { offered = true; g = ans(g, d.kind === 'optional' ? 'yes' : roost.id); continue; }
    g = ans(g, d.options!.find(o => o.id === ed)?.id ?? d.options![0].id);
  }
  assert.ok(offered, 'Roost option offered');
  assert.equal(locOf(g, ed), BF_A);
});

test('RJ#12174 Perched Grimwyrm can\'t be played to Dragon Roost unless I conquered the Roost this turn; having conquered another battlefield only allows that one', () => {
  const dests = (conquer: number | null) => {
    let g = S0(); fundAll(g, P0, 8);
    setBattlefieldCard(g, BF_A, 'Dragon Roost');
    const pg = hand(g, P0, 'Perched Grimwyrm');
    if (conquer !== null) { const u = put(g, P0, 'V(1)', 'base'); g = drive(move(g, P0, [u], conquer)); assert.equal(g.battlefields[conquer].controller, P0); }
    return legal(g, P0, 'playCard').filter(a => a.type === 'playCard' && a.obj === pg).map(a => (a as { destination?: unknown }).destination);
  };
  assert.deepEqual(dests(null), [], 'nothing conquered: not playable at all');
  assert.deepEqual(dests(BF_B), [BF_B], 'only the conquered battlefield, not the Roost');
  assert.deepEqual(dests(BF_A), [BF_A], 'conquered Roost: playable there');
});

test('RJ#12176 Dragon Form on a unit with Stupefy\'s -1: it goes straight to 4 (layers), never "becomes Mighty" → Grand Duelist doesn\'t trigger', () => {
  let g = S0(); fundAll(g, P0);
  setLegend(g, P0, 'Grand Duelist');
  const u = put(g, P0, 'V(3)', 'base');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Stupefy') }), [[u]], x => x.pending?.kind === 'mainAction');
  assert.equal(mightOf(g, u), 2);
  let asked = false;
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Dragon Form') }), [[u]], x => { if (x.pending?.kind === 'optional' || x.chain.some(c => /Grand Duelist/.test(String(c.label ?? '')))) asked = true; return x.pending?.kind === 'mainAction'; });
  assert.equal(mightOf(g, u), 4);
  assert.equal(asked, false, 'no Grand Duelist trigger');
  assert.equal(g.log.some(l => /Trigger: Grand Duelist/.test(l.text)), false);
  let c = S0(); fundAll(c, P0); setLegend(c, P0, 'Grand Duelist');
  const v = put(c, P0, 'V(3)', 'base');
  c = drive(act(c, { type: 'playCard', player: P0, obj: hand(c, P0, 'Dragon Form') }), [[v]], x => x.pending?.kind === 'optional' || x.pending?.kind === 'mainAction');
  assert.equal(c.pending?.kind, 'optional', 'control: 3 → 5 does become Mighty (Grand Duelist asks)');
});

test('RJ#12178 Renekton, Brute at 11 using his own [1]: +1 (→ 12) does not "become 10 or more": no empower trigger', () => {
  let g = S0(); fundAll(g, P0);
  const r = put(g, P0, 'Renekton, Brute', 'base'); mod(g, r, { might: 11 - (mightOf(g, r) ?? 0) });
  g = drive(act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === r)!));
  assert.equal(mightOf(g, r), 12);
  assert.ok(!g.objects[r].empowered);
  assert.ok(!g.log.some(l => /Trigger: Renekton/.test(l.text)));
});

test('RJ#12177 Hostile Takeover an enemy unit, move it to my base, Temporal Breach it: its owner can\'t play it to my base → it stays banished', () => {
  let g = S0(); fundAll(g, P0, 8);
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  put(g, P0, 'V(1)', BF_B);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Hostile Takeover') }), [[e]], x => x.pending?.kind === 'mainAction');
  assert.equal(g.objects[e].controller, P0);
  g = drive(move(g, P0, [e], 'base'), [], x => x.pending?.kind === 'mainAction');
  assert.equal(locOf(g, e), 'base');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Temporal Breach') }), [[e], 'first', 'first'], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, e), 'banishment');
});

test('RJ#12182 killing a Mirror Image Reflection copying Noxus Hopeful for Atakhan\'s additional cost discounts by the copied cost ([4]): Atakhan is played with 6 runes', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  const nh = put(g, P0, 'Noxus Hopeful', 'base');
  const before = new Set(Object.keys(g.objects));
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Mirror Image') }), [[nh]]);
  const refl = Object.keys(g.objects).find(id => !before.has(id) && g.objects[id].isToken && g.objects[id].zone === 'base')!;
  assert.ok(refl);
  setRunes(g, P0, 6, 'order');
  const at = hand(g, P0, 'Atakhan');
  g = drive(act(g, { type: 'playCard', player: P0, obj: at, destination: 'base' }), [[refl]], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, at), 'base', 'affordable: 10 - 4 Energy');
  assert.ok(!g.objects[refl] || !['base', 'battlefield'].includes(g.objects[refl].zone), 'Reflection killed');
  assert.equal(zone(g, nh), 'base', 'the real Hopeful untouched');
});

test('RJ#12183 hidden Tideturner played in response to Vex, Apathetic\'s stun on my new unit: the unit is swapped but still stunned (Vex targets the unit); Tideturner is stunned too', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P1, 'Vex, Apathetic', BF_A); control(g, BF_A, P1);
  control(g, BF_B, P0); put(g, P0, 'V(1)', BF_B);
  const tt = put(g, P0, 'Tideturner', { facedown: BF_B });
  const x = hand(g, P0, 'V(2)');
  g = drive(act(g, { type: 'playCard', player: P0, obj: x, destination: 'base' }), [], y => y.chain.some(c => /Vex/.test(String(c.label ?? nameOf(y, c.source)))) && y.pending?.kind === 'chainResponse' && y.pending.player === P0);
  assert.ok(canPlayNow(g, P0, tt), 'hidden Tideturner playable as a Reaction');
  g = drive(act(g, { type: 'playCard', player: P0, obj: tt, destination: BF_B }), [[x], 'first'], y => y.pending?.kind === 'mainAction');
  assert.equal(locOf(g, x), BF_B, 'my unit swapped to the battlefield');
  assert.ok(g.objects[x].stunned, 'still stunned');
  assert.ok(g.objects[tt].stunned, 'Tideturner stunned by Vex too');
});

test('RJ#12184 a stunned unit can be chosen by Rampage and deals its full Might (not combat damage)', () => {
  let g = S0(); fundAll(g, P0);
  const f = put(g, P0, 'V(3)', 'base'); g.objects[f].stunned = true; g.timestamp++;
  const e = put(g, P1, 'V(6)', 'base');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Rampage') }), ['yes', [f], [e], 'first'], y => y.pending?.kind === 'mainAction');
  assert.equal(g.objects[e].damage, 5, 'stunned unit (3 +2) deals 5');
});

test('RJ#12187 Rampage (additional [C] paid) hit by Hard Bargain: I pay [2], Rampage resolves with its +2', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const f = put(g, P0, 'V(3)', 'base');
  const e = put(g, P1, 'V(6)', 'base');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Rampage') }), ['yes', [f], [e]], y => y.pending?.kind === 'chainResponse' && y.pending.player === P1);
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Hard Bargain') }), ['no', 'yes', 'yes'], y => y.pending?.kind === 'mainAction');
  assert.equal(g.objects[e].damage, 5, 'Rampage resolved with +2 (3 + 2)');
});

test('RJ#12188 opponent plays Spinning Axe (Quick-Draw) onto their 3-Might unit at a battlefield; my Gust in response returns the unit: the Axe enters unattached', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const ax = hand(g, P1, 'Spinning Axe');
  g = drive(act(g, { type: 'playCard', player: P1, obj: ax }), [[u], 'first'], y => y.pending?.kind === 'chainResponse' && y.pending.player === P0);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Gust') }), [[u]], y => y.pending?.kind === 'mainAction');
  assert.equal(zone(g, u), 'hand');
  assert.ok(['base', 'battlefield'].includes(zone(g, ax)), `Axe on the board (${zone(g, ax)})`);
  assert.ok(!g.objects[ax].attachedTo, 'unattached');
});

test('RJ#12191 Rengar, Pouncing played (Reaction) to a battlefield the opponent is attacking: no window to Rebuke (Action) in response; once the showdown is open again I may Rebuke him', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  put(g, P0, 'V(5)', BF_A); control(g, BF_A, P0);
  const a = put(g, P1, 'V(2)', 'base');
  const rb = hand(g, P0, 'Rebuke');
  g = drive(move(g, P1, [a], BF_A), [], y => y.pending?.kind === 'showdownAction' && y.pending.player === P1 && y.chain.length === 0);
  const rg = hand(g, P1, 'Rengar, Pouncing');
  g = act(g, { type: 'playCard', player: P1, obj: rg, destination: BF_A });
  assert.equal(locOf(g, rg), BF_A, 'a unit resolves at once (CR 359.2): nothing to respond to');
  assert.notEqual(g.pending?.kind, 'chainResponse');
  g = drive(g, [], y => y.chain.length === 0 && y.pending?.kind === 'showdownAction' && y.pending.player === P0);
  assert.ok(canPlayNow(g, P0, rb), 'Rebuke playable in the open showdown');
  g = drive(act(g, { type: 'playCard', player: P0, obj: rb }), [[rg]], y => y.chain.length === 0);
  assert.equal(zone(g, rg), 'hand');
});

test('RJ#12192 conquering Seat of Power with my lone Lonely Poro: Shuriken Flip (no Reaction) can\'t be played while the conquer trigger is on the chain; the trigger draws 0 (no other battlefield controlled)', () => {
  let g = S0(); fundAll(g, P0);
  setBattlefieldCard(g, BF_A, 'Seat of Power'); setBattlefieldCard(g, BF_B, 'Seat of Power');
  const lp = put(g, P0, 'Lonely Poro', 'base');
  const sf = hand(g, P0, 'Shuriken Flip');
  g = drive(move(g, P0, [lp], BF_A), [], y => y.chain.length > 0 && y.pending?.kind === 'chainResponse' && y.pending.player === P0);
  assert.ok(g.chain.length > 0, 'Seat of Power trigger on the chain');
  assert.equal(canPlayNow(g, P0, sf), false, 'Shuriken Flip has no Reaction');
  const h0 = g.players[P0].hand.length;
  g = drive(g, [], y => y.pending?.kind === 'mainAction');
  assert.equal(g.players[P0].hand.length, h0, 'draws 0');
  assert.equal(g.battlefields[BF_A].controller, P0);
});

test('RJ#12194 Akali, Deadly Weapon\'s move trigger kills the lone 1-Might defender at Threshold of the Gray before combat is staged: no combat, nobody adds Energy', () => {
  let g = S0();
  setBattlefieldCard(g, BF_A, 'Threshold of the Gray');
  const ak = put(g, P0, 'Akali, Deadly Weapon', 'base');
  const t = put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  g = drive(move(g, P0, [ak], BF_A), ['yes', [t]], y => y.pending?.kind === 'mainAction');
  assert.equal(zone(g, t), 'trash');
  assert.equal(g.players[P0].pool.energy, 0);
  assert.equal(g.players[P1].pool.energy, 0);
  assert.equal(g.battlefields[BF_A].controller, P0, 'conquered without combat');
  assert.ok(!g.log.some(l => /Trigger: Threshold|^Combat at/.test(l.text)), 'no combat, no Threshold trigger');
});

test('RJ#12196 Rengar, Trophy Hunter ambushed in response to my defending Lonely Poro\'s Deathknell (Poro killed mid-showdown): Rengar is a Defender, the opponent stays the Attacker', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const lp = put(g, P0, 'Lonely Poro', BF_A); control(g, BF_A, P0);
  const a = put(g, P1, 'V(3)', 'base');
  const rg = hand(g, P0, 'Rengar, Trophy Hunter');
  g = drive(move(g, P1, [a], BF_A), [], y => y.pending?.kind === 'showdownAction' && y.pending.player === P1 && y.chain.length === 0);
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'ZapA') }), [[lp]], y => y.pending?.kind === 'chainResponse' && y.pending.player === P0 && y.chain.some(c => c.source === lp));
  assert.equal(zone(g, lp), 'trash');
  assert.ok(canPlayNow(g, P0, rg, BF_A), 'Ambush in response to the Deathknell');
  g = drive(act(g, { type: 'playCard', player: P0, obj: rg, destination: BF_A }), [], y => y.chain.length === 0);
  assert.equal(g.showdown?.attacker, P1);
  assert.equal(g.showdown?.defender, P0);
  assert.equal(g.objects[rg].combatRole, 'defender');
});

test('RJ#12197 empowered Akali, Deadly Weapon\'s move trigger aims 2 at Tideturner; the defender Star-Crosses both in response: both return to hand, the damage does nothing', () => {
  let g = S0(); fundAll(g, P1);
  const ak = put(g, P0, 'Akali, Deadly Weapon', 'base'); g.objects[ak].empowered = 1; g.timestamp++;
  const tt = put(g, P1, 'Tideturner', BF_A); control(g, BF_A, P1);
  g = drive(move(g, P0, [ak], BF_A), ['yes', [tt]], y => y.pending?.kind === 'chainResponse' && y.pending.player === P1);
  assert.ok(g.chain.some(c => c.source === ak));
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Star-Crossed') }), [[tt], [ak]], y => y.pending?.kind === 'mainAction');
  assert.equal(zone(g, tt), 'hand');
  assert.equal(zone(g, ak), 'hand');
});

test('RJ#12199 Public Execution chooses both units when played ("with less Might" is a target restriction); a +2 in response makes the enemy no longer smaller → it survives', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const f = put(g, P0, 'V(3)', 'base');
  const e = put(g, P1, 'V(2)', 'base'); const big = put(g, P1, 'V(3)', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Public Execution') });
  const offered: string[] = [];
  for (let i = 0; i < 3 && g.pending?.kind === 'chooseTargets'; i++) { offered.push(...g.pending.options!.map(o => o.id)); g = ans(g, [g.pending.options!.some(o => o.id === e) ? e : f]); }
  assert.ok(!offered.includes(big), 'an equal-Might enemy can\'t be chosen');
  g = drive(g, [], y => y.pending?.kind === 'chainResponse' && y.pending.player === P1);
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Battle Preparations') }), [[e], 'first', 'first'], y => y.pending?.kind === 'mainAction');
  assert.equal(mightOf(g, e), 4);
  assert.equal(zone(g, e), 'base', 'no longer less Might → unaffected');
});

test('RJ#12200 hidden Tideturner at B played during the opponent\'s combat showdown at A swaps with my defender at A: Tideturner defends at A, my unit goes to B (no new showdown there)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const d = put(g, P0, 'V(4)', BF_A); control(g, BF_A, P0);
  put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
  const tt = put(g, P0, 'Tideturner', { facedown: BF_B });
  const a = put(g, P1, 'V(1)', 'base');
  g = drive(move(g, P1, [a], BF_A), [], y => y.pending?.kind === 'showdownAction' && y.pending.player === P0 && y.chain.length === 0);
  assert.ok(canPlayNow(g, P0, tt, BF_B), 'Reaction from hiding');
  g = drive(act(g, { type: 'playCard', player: P0, obj: tt, destination: BF_B }), [[d]], y => y.chain.length === 0 && y.pending?.kind === 'showdownAction');
  assert.equal(locOf(g, tt), BF_A);
  assert.equal(locOf(g, d), BF_B);
  assert.equal(g.objects[tt].combatRole, 'defender', 'combat at A continues with Tideturner');
  assert.equal(g.battlefields[BF_B].controller, P0);
});

test('RJ#12201 Flurry of Blades deals 1 to an enemy Baron Nashor (it chooses nothing); he survives', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1);
  const bn = put(g, P0, 'Baron Nashor', BF_A); control(g, BF_A, P0);
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Flurry of Blades') }), [], y => y.pending?.kind === 'mainAction');
  assert.equal(g.objects[bn].damage, 1);
  assert.equal(zone(g, bn), 'battlefield');
});

test('RJ#12202 the opponent\'s Flurry of Blades with their Elder Dragon in base kills my Baron Nashor (no choosing; any amount of their damage is lethal)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1);
  const bn = put(g, P0, 'Baron Nashor', BF_A); control(g, BF_A, P0);
  put(g, P1, 'Elder Dragon', 'base');
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Flurry of Blades') }), [], y => y.pending?.kind === 'mainAction');
  assert.equal(zone(g, bn), 'trash');
});

test('RJ#12203 Back Off countered by Defy: nothing resolves, no stun and no draw', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const e = put(g, P1, 'V(3)', 'base');
  const bo = hand(g, P0, 'Back Off');
  const h0 = g.players[P0].hand.length;
  g = drive(act(g, { type: 'playCard', player: P0, obj: bo }), [[e]], y => y.pending?.kind === 'chainResponse' && y.pending.player === P1);
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Defy') }), ['first'], y => y.pending?.kind === 'mainAction');
  assert.equal(zone(g, bo), 'trash');
  assert.ok(!g.objects[e].stunned);
  assert.equal(g.players[P0].hand.length, h0 - 1, 'no draw');
});

test('RJ#12208 with Jax, Unmatched in base, Trinity Force is played from hand (Quick-Draw = Reaction) in response to Jayce, Hammer in Hand\'s ready trigger and attached to my unit at a battlefield: it holds for 2', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0);
  const j = put(g, P0, 'Jayce, Hammer in Hand', 'base'); g.objects[j].exhausted = true;
  put(g, P0, 'Jax, Unmatched', 'base');
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const tf = hand(g, P0, 'Trinity Force');
  g.timestamp++;
  g = endTurn(g, P1);
  let played = false;
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    if (!played && d.player === P0 && !d.inStep && canPlayNow(g, P0, tf)) { assert.equal(g.phase, 'awaken'); played = true; g = act(g, { type: 'playCard', player: P0, obj: tf }); continue; }
    g = d.inStep ? ans(g, d.options!.find(o => o.id === u)?.id ?? d.options![0].id) : pass(g);
  }
  assert.ok(played, 'playable in response to the ready trigger');
  assert.equal(g.objects[tf].attachedTo, u);
  assert.equal(g.players[P0].points, 2, 'hold + Trinity Force');
});

test('RJ#12209 defending Diana, Lunari at Ravenbloom Conservatory: Diana\'s showdown-start trigger is chained first, the Conservatory\'s defend trigger on top resolves first', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0);
  setBattlefieldCard(g, BF_A, 'Ravenbloom Conservatory');
  put(g, P0, 'Diana, Lunari', BF_A); control(g, BF_A, P0);
  const a = put(g, P1, 'V(1)', 'base');
  g = move(g, P1, [a], BF_A);
  g = ans(g, 'yes');
  assert.deepEqual(chainLabels(g), ['trigger:Diana', 'trigger:Ravenbloom Conservatory'], 'Conservatory (newest) resolves first');
});

test('RJ#12210 a standard move out of my battlefield opens no chain; moving another unit back in starts a non-combat showdown: mover gets focus, then the opponent may play an Action', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const x = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const y = put(g, P0, 'V(2)', 'base');
  const zp = hand(g, P1, 'ZapA');
  g = move(g, P0, [x], 'base');
  expectPending(g, 'mainAction', P0, 'no window after a standard move');
  g = move(g, P0, [y], BF_A);
  expectPending(g, 'showdownAction', P0, 'mover has focus first');
  g = pass(g);
  expectPending(g, 'showdownAction', P1);
  assert.ok(canPlayNow(g, P1, zp), 'Action playable in the showdown');
});

test('RJ#12212 Resonating Strike as my first card moves Astral Heron from base to a battlefield: a spell\'s "play" completes when it resolves (rules-decisions #12), Heron is at a battlefield then → the next card is discounted', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const h = put(g, P0, 'Astral Heron', 'base');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Resonating Strike') }), [String(BF_A), [h], 'first'], y => y.pending?.kind === 'mainAction');
  assert.equal(locOf(g, h), BF_A, 'Heron moved by the first card');
  assert.equal(playCostOf(g, P0, hand(g, P0, 'Astral Heron'))!.energy, 5, '[2][A][A] less');
});

test('RJ#12213 Deceiver\'s Reflection copying a unit equipped with Long Sword copies only the unit (printed Might), not the Equipment', () => {
  let g = withTokens(S0()); fundAll(g, P0); setLegend(g, P0, 'Deceiver');
  const u = put(g, P0, 'V(3)', 'base');
  const ls = put(g, P0, 'Long Sword', 'base'); attachNow(g, ls, u);
  assert.equal(mightOf(g, u), 5);
  hand(g, P0, 'V(1)');
  const before = new Set(Object.keys(g.objects));
  g = drive(move(g, P0, [u], BF_A), ['yes', 'first', [u], 'first'], y => y.pending?.kind === 'mainAction');
  const r = Object.keys(g.objects).find(id => !before.has(id) && g.objects[id].isToken && g.objects[id].zone === 'battlefield');
  assert.ok(r, 'Reflection played');
  assert.equal(mightOf(g, r!), 3, 'printed Might only');
  assert.equal(g.objects[ls].attachedTo, u, 'the original keeps its gear');
});

test('RJ#12214 a Recruit made a copy of a 4-Might unit by Shady Spectacles conquers; Deceiver\'s Reflection copying it is the 4-Might unit (copied traits are copiable), without the Spectacles', () => {
  let g = withTokens(S0()); fundAll(g, P0); setLegend(g, P0, 'Deceiver');
  const rc = put(g, P0, 'Recruit', 'base', { token: true });
  const y = put(g, P0, 'V(4)', 'base');
  const sp = put(g, P0, 'Shady Spectacles', 'base');
  g = drive(act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === sp)!), [[rc], [y]]);
  assert.equal(mightOf(g, rc), 4);
  g.objects[rc].exhausted = false; g.timestamp++;
  hand(g, P0, 'V(1)');
  const before = new Set(Object.keys(g.objects));
  g = drive(move(g, P0, [rc], BF_A), ['yes', 'first', [rc], 'first'], x => x.pending?.kind === 'mainAction');
  const r = Object.keys(g.objects).find(id => !before.has(id) && g.objects[id].isToken && g.objects[id].zone === 'battlefield');
  assert.ok(r, 'Reflection played');
  assert.equal(mightOf(g, r!), 4, 'a copy of the 4-Might unit, not a 1-Might Recruit');
  assert.ok(!Object.values(g.objects).some(o => o.attachedTo === r), 'no Spectacles copied');
});

test('RJ#12215 Vex, Apathetic stuns an enemy Baron Nashor when it is played ("stun it" doesn\'t choose)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1, 12);
  put(g, P0, 'Vex, Apathetic', BF_A); control(g, BF_A, P0);
  const bn = hand(g, P1, 'Baron Nashor');
  const a = legal(g, P1, 'playCard').find(x => x.type === 'playCard' && x.obj === bn);
  assert.ok(a, 'Baron playable');
  g = drive(act(g, a!), ['first', 'first'], y => y.pending?.kind === 'mainAction');
  assert.ok(['base', 'battlefield'].includes(zone(g, bn)), 'Baron on the board');
  assert.ok(g.objects[bn].stunned, 'stunned by Vex');
});

test('RJ#12217 Temporal Breach on an equipped unit at a battlefield: it returns as a new object without the Equipment; the gear is recalled to base', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const ls = put(g, P0, 'Long Sword', 'base'); attachNow(g, ls, u);
  assert.equal(mightOf(g, u), 5);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Temporal Breach') }), [[u], 'first'], y => y.pending?.kind === 'mainAction');
  const back = unitsNamed(g, 'V(3)');
  assert.equal(back.length, 1);
  assert.equal(locOf(g, back[0]), BF_A);
  assert.equal(mightOf(g, back[0]), 3, 'unequipped');
  assert.ok(!g.objects[ls].attachedTo, 'detached');
  assert.equal(locOf(g, ls), 'base', 'gear recalled to base');
});

test('RJ#12218 the opponent\'s Star-Crossed on their unit and mine: I Gust their unit in response; Star-Crossed still returns my unit', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const theirs = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const mine = put(g, P0, 'V(2)', 'base');
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Star-Crossed') });
  for (let i = 0; i < 3 && g.pending?.kind === 'chooseTargets'; i++) g = ans(g, [g.pending.options!.some(o => o.id === theirs) ? theirs : mine]);
  g = drive(g, [], y => y.pending?.kind === 'chainResponse' && y.pending.player === P0);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Gust') }), [[theirs]], y => y.pending?.kind === 'mainAction');
  assert.equal(zone(g, theirs), 'hand');
  assert.equal(zone(g, mine), 'hand', 'Star-Crossed resolved as far as possible');
});

test('RJ#12220 Star Spring: my unit played there is Gusted in response to the trigger; the trigger still moves my other unit to base, and replaying the unit there doesn\'t trigger again', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  setBattlefieldCard(g, BF_A, 'Star Spring');
  const y = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const x = hand(g, P0, 'V(1)');
  g = drive(act(g, { type: 'playCard', player: P0, obj: x, destination: BF_A }), [[y]], z => z.pending?.kind === 'chainResponse' && z.pending.player === P1);
  assert.ok(g.chain.length > 0, 'Star Spring trigger on the chain');
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Gust') }), [[x]], z => z.pending?.kind === 'mainAction');
  assert.equal(zone(g, x), 'hand');
  assert.equal(locOf(g, y), 'base', 'trigger still resolved');
  const y2 = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);   // setup: control was lost when both units left
  let asked = false;
  g = drive(act(g, { type: 'playCard', player: P0, obj: x, destination: BF_A }), [], z => { if (z.pending?.kind === 'optional' || z.chain.length) asked = true; return z.pending?.kind === 'mainAction'; });
  assert.equal(asked, false, 'no second Star Spring trigger this turn');
  assert.equal(locOf(g, y2), BF_A);
});

test('RJ#12221 two Otterpus: conquering in an early turn draws 1 (not 2) — the point is replaced only once', () => {
  let g = S0();
  put(g, P0, 'Otterpus', 'base'); put(g, P0, 'Otterpus', 'base');
  const u = put(g, P0, 'V(1)', 'base');
  const h0 = g.players[P0].hand.length;
  g = drive(move(g, P0, [u], BF_A), ['first', 'first']);
  assert.equal(g.players[P0].points, 0);
  assert.equal(g.players[P0].hand.length, h0 + 1);
});

test('RJ#12222 after Brynhir Thundersong\'s lockdown the opponent can\'t play cards but can still use abilities on the board (Gold [Add])', () => {
  let g = withTokens(S0()); fundAll(g, P0, 8); fundAll(g, P1);
  const gold = put(g, P1, 'Gold', 'base', { token: true });
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Brynhir Thundersong'), destination: 'base' }), [], y => y.pending?.kind === 'mainAction');
  const zr = hand(g, P1, 'ZapR');
  const e = put(g, P1, 'V(2)', 'base');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'ZapM') }), [[e]], y => y.pending?.kind === 'chainResponse' && y.pending.player === P1);
  assert.equal(canPlayNow(g, P1, zr), false, 'no cards');
  assert.ok(legal(g, P1, 'activate').some(a => a.type === 'activate' && a.obj === gold), 'board abilities still usable');
});

test('RJ#12223 Tail-Cloaked Matriarch\'s empower trigger plays Gust Monk from the trash ignoring its cost; his optional [1] may be declined (offered, not required)', () => {
  let g = S0(); fundAll(g, P0);
  const m = put(g, P0, 'Tail-Cloaked Matriarch', 'base');
  const gm = put(g, P0, 'Gust Monk', 'trash');
  let offered = false;
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === m)!);
  for (let i = 0; i < 12 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    if (d.kind === 'optional' && /additional cost/i.test(d.prompt ?? '')) { offered = true; g = ans(g, 'no'); continue; }
    g = d.inStep ? ans(g, d.options!.find(o => o.id === 'yes' || o.id === gm)?.id ?? d.options![0].id) : pass(g);
  }
  assert.ok(offered, 'the optional [1] is offered');
  assert.equal(locOf(g, gm), 'base');
});

test('RJ#12224 Bellows Breath marks 1 on an enemy Stellacorn Herder (3); Thousand-Tailed Watcher\'s -3 (min 1) then makes it lethal → it dies', () => {
  let g = S0(); fundAll(g, P0, 8);
  const sh = put(g, P1, 'Stellacorn Herder', BF_A); control(g, BF_A, P1);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Bellows Breath') }), [[sh], 'no'], y => y.pending?.kind === 'mainAction');
  assert.equal(g.objects[sh].damage, 1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Thousand-Tailed Watcher'), destination: 'base' });
  for (let i = 0; i < 12 && g.pending && g.pending.kind !== 'mainAction'; i++) g = g.pending.inStep ? ans(g, g.pending.kind === 'optional' ? 'no' : 'first') : pass(g);
  assert.equal(zone(g, sh), 'trash');
});

test('RJ#12228 enemy Elder Dragon\'s play trigger chooses my unit at BF-A and my unit in base; hidden Tideturner swaps the base unit to BF-A in response: it left its chosen location → no damage, survives; the other dies', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1, 12);
  const x = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const z = put(g, P0, 'V(4)', 'base');
  const tt = put(g, P0, 'Tideturner', { facedown: BF_A });
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Elder Dragon'), destination: 'base' }), [[x], [z]], y => y.pending?.kind === 'chainResponse' && y.pending.player === P0);
  g = drive(act(g, { type: 'playCard', player: P0, obj: tt, destination: BF_A }), [[z]], y => y.pending?.kind === 'mainAction');
  assert.equal(locOf(g, z), BF_A, 'swapped');
  assert.equal(zone(g, z), 'battlefield', 'survives (not at its chosen location)');
  assert.equal(g.objects[z].damage ?? 0, 0);
  assert.equal(zone(g, x), 'trash', 'the unit still at its chosen battlefield dies (Elder Dragon)');
});

test('RJ#12232 two Ekko, Recurrent die at once: two Deathknells; after the first readies my runes I float their Energy, then the second readies them again', () => {
  let g = S0({ tp: P1 });
  const rs = setRunes(g, P0, 3, 'fury');
  for (const r of rs) g.objects[r].exhausted = true;
  const e1 = put(g, P0, 'Ekko, Recurrent', BF_A), e2 = put(g, P0, 'Ekko, Recurrent', BF_A); control(g, BF_A, P0);
  const a = put(g, P1, 'V(10)', 'base');
  g = drive(move(g, P1, [a], BF_A), ['first'], y => y.pending?.kind === 'assignDamage' && y.pending.player === P1);
  g = act(g, { type: 'assignDamage', player: P1, assignment: { [e1]: 5, [e2]: 5 } });
  g = drive(g, ['first', 'yes', 'yes'], y => y.chain.length === 2 && y.pending?.kind === 'chainResponse');
  assert.equal(g.chain.length, 2, 'two Deathknells');
  g = drive(g, [], y => y.chain.length === 1 && y.pending?.kind === 'chainResponse' && y.pending.player === P0);
  assert.equal(rs.filter(r => !g.objects[r].exhausted).length, 3, 'runes readied by the first');
  for (const r of rs) {
    for (const ab of legal(g, P0, 'activate').filter(x => x.type === 'activate' && x.obj === r)) {
      const t = act(g, ab);
      if (t.players[P0].runesInPlay.includes(r)) { g = t; break; }   // exhaust for Energy (not recycle)
    }
  }
  assert.equal(g.players[P0].pool.energy, 3, 'floated');
  g = drive(g, [], y => y.chain.length === 0);
  assert.equal(zone(g, e1), 'mainDeck'); assert.equal(zone(g, e2), 'mainDeck');
  assert.equal(rs.filter(r => !g.objects[r].exhausted).length, 3, 'readied again by the second');
  assert.equal(g.players[P0].pool.energy, 3, 'floated Energy kept');
});

test('RJ#12233 hidden Zhonya\'s Hourglass at a battlefield, played in response to Public Execution, saves my unit in base (replacement isn\'t limited to its battlefield)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const zh = put(g, P0, "Zhonya's Hourglass", { facedown: BF_A });
  const v = put(g, P0, 'V(2)', 'base');
  const big = put(g, P1, 'V(5)', 'base');
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Public Execution') });
  for (let i = 0; i < 3 && g.pending?.kind === 'chooseTargets'; i++) g = ans(g, [g.pending.options!.some(o => o.id === v) ? v : big]);
  g = drive(g, [], y => y.pending?.kind === 'chainResponse' && y.pending.player === P0);
  assert.ok(canPlayNow(g, P0, zh));
  g = drive(act(g, { type: 'playCard', player: P0, obj: zh }), [], y => y.pending?.kind === 'mainAction');
  assert.equal(zone(g, v), 'base', 'saved');
  assert.equal(zone(g, zh), 'trash', 'Zhonya\'s used');
});

test('RJ#12234 Confront: units entering ready don\'t "become ready" — Pirate\'s Haven gives no +1', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, "Pirate's Haven", 'base');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Confront') }), [], y => y.pending?.kind === 'mainAction');
  const u = hand(g, P0, 'V(2)');
  g = drive(act(g, { type: 'playCard', player: P0, obj: u, destination: 'base' }), [], y => y.pending?.kind === 'mainAction');
  assert.equal(g.objects[u].exhausted, false, 'entered ready');
  assert.equal(mightOf(g, u), 2, 'no Pirate\'s Haven +1');
});

test('RJ#12235 defending on the enemy turn: Heedless Resurrection (Reaction) kills my lone defender as its cost; I keep the battlefield while it is on the chain and play the trash unit there — it defends', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const x = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const y = put(g, P0, 'V(2)', 'trash');
  const a = put(g, P1, 'V(4)', 'base');
  g = drive(move(g, P1, [a], BF_A), [], z => z.pending?.kind === 'showdownAction' && z.pending.player === P0 && z.chain.length === 0);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Heedless Resurrection') }), [String(BF_A)], z => z.chain.length === 0 && z.pending?.kind === 'showdownAction');
  assert.equal(zone(g, x), 'trash', 'killed for the cost');
  assert.equal(locOf(g, y), BF_A, 'played to the battlefield in combat');
  assert.equal(g.objects[y].combatRole, 'defender');
  assert.equal(g.battlefields[BF_A].controller, P0);
});

test('RJ#12238 Decree of Focus on my unit in combat with an enemy Fury unit; the opponent Thrills of the Hunt that unit to another battlefield in response: the condition fails on resolution → no +4', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const mine = put(g, P0, 'V(4)', BF_A); control(g, BF_A, P0);
  const fu = put(g, P1, 'Bilgewater Tracker', 'base');
  g = drive(move(g, P1, [fu], BF_A), [], y => y.pending?.kind === 'showdownAction' && y.pending.player === P0 && y.chain.length === 0);
  const df = hand(g, P0, 'Decree of Focus');
  assert.ok(canPlayNow(g, P0, df), 'legal: my unit is in combat with an enemy Fury unit');
  g = drive(act(g, { type: 'playCard', player: P0, obj: df }), [[mine]], y => y.pending?.kind === 'chainResponse' && y.pending.player === P1);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Thrill of the Hunt') });
  for (let i = 0; i < 10 && g.chain.length > 0 || (i < 10 && g.pending?.inStep); i++) {
    const d = g.pending!;
    g = d.inStep ? ans(g, d.options!.find(o => o.id === fu || o.id === String(BF_B))?.id ?? d.options![0].id) : pass(g);
  }
  const back = unitsNamed(g, 'Bilgewater Tracker');
  assert.equal(back.length, 1); assert.equal(locOf(g, back[0]), BF_B);
  assert.equal(mightOf(g, mine), 4, 'no +4');
});

test('RJ#12239 a 6-Might attacker vs Ferrous Forerunner (6) + Scuttle Crab (0): it can\'t kill both (the Crab needs 1); no conquer', () => {
  let g = withTokens(S0());
  const ff = put(g, P1, 'Ferrous Forerunner', BF_A); const sc = put(g, P1, 'Scuttle Crab', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(6)', 'base');
  g = drive(move(g, P0, [a], BF_A), ['first', 'first', 'first'], y => y.pending?.kind === 'mainAction');
  assert.ok(!(zone(g, ff) === 'trash' && zone(g, sc) === 'trash'), 'not both');
  assert.notEqual(g.battlefields[BF_A].controller, P0, 'no conquer');
  let h = withTokens(S0());
  const ff2 = put(h, P1, 'Ferrous Forerunner', BF_A); const sc2 = put(h, P1, 'Scuttle Crab', BF_A); control(h, BF_A, P1);
  const b = put(h, P0, 'V(7)', 'base');
  h = move(h, P0, [b], BF_A);
  for (let i = 0; i < 12 && h.pending?.kind !== 'assignDamage'; i++) h = h.pending!.inStep ? ans(h, 'first') : pass(h);
  h = act(h, { type: 'assignDamage', player: P0, assignment: { [ff2]: 6, [sc2]: 1 } });
  assert.equal(zone(h, ff2), 'trash'); assert.equal(zone(h, sc2), 'trash', '7 kills both');
});

test('RJ#12240 Mel, Newly Awakened\'s Empower can be activated with no enemy units around (it needs no target)', () => {
  let g = S0(); fundAll(g, P0);
  const m = put(g, P0, 'Mel, Newly Awakened', 'base');
  const a = legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === m);
  assert.ok(a, 'Empower activatable');
  g = drive(act(g, a!));
  assert.ok(g.objects[m].empowered);
});

test('RJ#12241 Mel, Defiant Soul\'s Empower (discard a spell) works with no enemy unit at a battlefield; her banish trigger then does nothing', () => {
  let g = S0(); fundAll(g, P0);
  const m = put(g, P0, 'Mel, Defiant Soul', 'base');
  const sp = hand(g, P0, 'ZapM');
  const e = put(g, P1, 'V(2)', 'base');
  const a = legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === m);
  assert.ok(a, 'Empower activatable');
  g = drive(act(g, a!), [[sp], 'first'], y => y.pending?.kind === 'mainAction');
  assert.ok(g.objects[m].empowered);
  assert.equal(zone(g, sp), 'trash', 'spell discarded');
  assert.equal(zone(g, e), 'base', 'nothing banished (no enemy unit at a battlefield)');
});

test('RJ#12258 The Harrowing chooses its trash unit when played; Disposal Order in response recycles it → The Harrowing plays nothing', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1, 8);
  const u = put(g, P1, 'V(3)', 'trash'); put(g, P1, 'V(2)', 'trash');
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'The Harrowing') });
  for (let i = 0; i < 4 && g.pending?.inStep && g.pending.player === P1; i++) g = ans(g, g.pending.options!.find(o => o.id === u)?.id ?? g.pending.options![0].id);
  g = drive(g, [], y => y.pending?.kind === 'chainResponse' && y.pending.player === P0);
  assert.equal(g.chain.length, 1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Disposal Order') });
  for (let i = 0; i < 6 && g.pending?.inStep; i++) { const d = g.pending; g = ans(g, d.kind === 'chooseMode' ? d.options![0].id : (d.options!.some(o => o.id === u) ? [u] : d.options![0].id)); }
  g = drive(g, [], y => y.pending?.kind === 'mainAction');
  assert.equal(zone(g, u), 'mainDeck', 'recycled');
  assert.equal(Object.values(g.objects).filter(o => o.owner === P1 && o.zone === 'base' && g.cards[o.cardId]?.type === 'Unit').length, 0, 'The Harrowing played nothing');
});

test('RJ#12261 Alpha Strike on four 1-Might enemies; the opponent Flashes two of them to base: those two take nothing, the other two die (no subgroup re-selection)', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  put(g, P0, 'V(4)', 'base');
  const es = [0, 1, 2, 3].map(() => put(g, P1, 'V(1)', BF_A)); control(g, BF_A, P1);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Alpha Strike') }), [es], x => x.pending?.kind === 'chainResponse' && x.pending.player === P1);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Flash') });
  for (let i = 0; i < 4 && g.pending?.inStep && g.pending.player === P1; i++) g = ans(g, [es[0], es[1]]);
  g = drive(g, ['first', 'first', 'first', 'first'], x => x.pending?.kind === 'mainAction');
  assert.equal(locOf(g, es[0]), 'base'); assert.equal(locOf(g, es[1]), 'base');
  assert.equal(g.objects[es[0]].damage ?? 0, 0, 'moved away: no damage');
  assert.equal(g.objects[es[1]].damage ?? 0, 0);
  assert.equal(zone(g, es[2]), 'trash'); assert.equal(zone(g, es[3]), 'trash', 'damage split among the remaining targets');
});

test('RJ#12262 Hostile Takeover readies the stolen unit; at end of turn it is recalled to its owner\'s base in the same (ready) state', () => {
  let g = S0(); fundAll(g, P0);
  const e = put(g, P1, 'V(3)', BF_A, { ready: false }); control(g, BF_A, P1);
  assert.equal(g.objects[e].exhausted, true);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Hostile Takeover') }), [[e]], x => x.pending?.kind === 'mainAction');
  assert.equal(g.objects[e].controller, P0); assert.equal(g.objects[e].exhausted, false, 'readied');
  g = endTurn(g, P0);
  g = drive(g, [], x => x.activePlayer === P1 && x.pending?.kind === 'mainAction' || x.objects[e].controller === P1 && !x.chain.length && x.pending?.kind === 'mainAction');
  assert.equal(g.objects[e].controller, P1); assert.equal(locOf(g, e), 'base');
  assert.equal(g.objects[e].exhausted, false, 'still ready');
});

test('RJ#12265 Hand Hammer + Eye of the Herald unit moving next to one friendly unit: the Recruit makes two other friendly units → no +2 (static, rechecked)', () => {
  let g = withTokens(S0());
  const u = put(g, P0, 'V(2)', 'base');
  attachNow(g, put(g, P0, 'Hand Hammer', 'base'), u);
  attachNow(g, put(g, P0, 'Eye of the Herald', 'base'), u);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const base = mightOf(g, u);
  let h = S0(); const v = put(h, P0, 'V(2)', 'base'); attachNow(h, put(h, P0, 'Hand Hammer', 'base'), v); put(h, P0, 'V(1)', BF_A); control(h, BF_A, P0);
  h = drive(move(h, P0, [v], BF_A), ['first'], x => x.pending?.kind === 'mainAction');
  assert.equal(mightOf(h, v), base + 2, 'control: without the Eye the +2 applies');
  g = drive(move(g, P0, [u], BF_A), ['first', 'first'], x => x.pending?.kind === 'mainAction');
  assert.equal(unitsNamed(g, 'Recruit').length, 1, 'Recruit played here');
  assert.equal(mightOf(g, u), base, 'no Hand Hammer +2 (three friendly units here)');
});

test('RJ#12268 empowered Ambessa attacks into a lone defender with the Wuju Bladesman legend: Yi\'s +2 counts (4 → 6 dies to 7; 5 → 7 survives)', () => {
  for (const [m, dies] of [[4, true], [5, false]] as const) {
    let g = S0(); setLegend(g, P1, 'Wuju Bladesman, Starter');
    const am = put(g, P0, 'Ambessa, Respected and Feared', 'base'); g.objects[am].empowered = 1; g.timestamp++;
    const e = put(g, P1, `V(${m})`, BF_A); control(g, BF_A, P1);
    g = move(g, P0, [am], BF_A);
    assert.equal(mightOf(g, am), 7); assert.equal(mightOf(g, e), m + 2, 'Yi +2 on the lone defender');
    if (dies) {
      assert.ok(g.chain.some(c => c.source === am), 'attack trigger on the chain');
      g = drive(g, [[e]], x => !x.chain.some(c => c.source === am) && !x.pending?.inStep);
      assert.equal(zone(g, e), 'trash', `${m}+2 < 7`);
    } else {
      assert.ok(!g.chain.some(c => c.source === am), 'no legal target (7 is not less than 7)');
      assert.equal(zone(g, e), 'battlefield');
    }
  }
});

test('RJ#12269 Tail-Cloaked Matriarch plays Sneaky Deckhand from the trash "to your base": base is forced, his open-battlefield permission doesn\'t apply', () => {
  let g = S0(); fundAll(g, P0);
  const m = put(g, P0, 'Tail-Cloaked Matriarch', 'base');
  const sd = put(g, P0, 'Sneaky Deckhand', 'trash');
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === m)!);
  for (let i = 0; i < 12 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    if (d.inStep && d.options!.some(o => o.id === String(BF_B) || o.id === String(BF_A))) assert.fail('offered a battlefield destination');
    g = d.inStep ? ans(g, d.options!.find(o => o.id === 'yes' || o.id === sd)?.id ?? d.options![0].id) : pass(g);
  }
  assert.equal(locOf(g, sd), 'base');
});

test('RJ#12270 Decree of Focus on the defender; the attacker Ambushes Nidalee in at Star Spring and its trigger moves the Fury attacker to base: Decree mistargets → no +4', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  setBattlefieldCard(g, BF_A, 'Star Spring');
  const mine = put(g, P1, 'V(4)', BF_A); control(g, BF_A, P1);
  const fu = put(g, P0, 'Bilgewater Tracker', 'base');
  g = drive(move(g, P0, [fu], BF_A), [], y => y.pending?.kind === 'showdownAction' && y.pending.player === P1 && y.chain.length === 0);
  const df = hand(g, P1, 'Decree of Focus');
  assert.ok(canPlayNow(g, P1, df));
  g = drive(act(g, { type: 'playCard', player: P1, obj: df }), [[mine]], y => y.pending?.kind === 'chainResponse' && y.pending.player === P0);
  const ni = hand(g, P0, 'Nidalee');
  g = act(g, { type: 'playCard', player: P0, obj: ni, destination: BF_A });
  for (let i = 0; i < 12 && (g.chain.length > 0 || g.pending?.inStep); i++) {
    const d = g.pending!;
    g = d.inStep ? ans(g, d.options!.find(o => o.id === 'yes' || o.id === fu)?.id ?? (d.options!.some(o => o.id === fu) ? [fu] : d.options![0].id)) : pass(g);
  }
  assert.notEqual(zone(g, ni), 'hand', 'Nidalee ambushed in');
  assert.equal(locOf(g, fu), 'base', 'Fury unit moved out of combat');
  assert.equal(mightOf(g, mine), 4, 'no +4');
});

test('RJ#12271 my unit has damage from the opponent; they play Elder Dragon: it dies at once in the cleanup — no window for my hidden Temporal Breach first', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1, 10);
  const u = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  put(g, P0, 'Temporal Breach', { facedown: BF_A });
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'ZapM') }), [[u]], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, u), 'battlefield'); assert.ok((g.objects[u].damage ?? 0) > 0, 'damaged by the opponent, alive');
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Elder Dragon'), destination: 'base' });
  assert.equal(zone(g, u), 'trash', 'dead before anyone gets priority (only the play trigger is on the chain)');
});

test('RJ#12273 Deceiver (LeBlanc legend): the copy instruction waits on the chain — Star-Crossed can bounce the copy target in response; normally the Reflection gets Temporary', () => {
  for (const respond of [true, false]) {
    let g = withTokens(S0()); fundAll(g, P0); fundAll(g, P1); setLegend(g, P0, 'Deceiver');
    const x = put(g, P0, 'V(3)', 'base'); hand(g, P0, 'V(1)');
    const mine = put(g, P1, 'V(2)', 'base');
    g = move(g, P0, [x], BF_A);
    let refl: string | undefined;
    for (let i = 0; i < 20 && !refl; i++) {
      const d = g.pending!; if (d.kind === 'mainAction') break;
      g = d.inStep ? ans(g, d.kind === 'optional' ? 'yes' : d.options![0].id) : pass(g);
      refl = Object.keys(g.objects).find(id => g.objects[id].isToken && g.objects[id].zone === 'battlefield');
    }
    assert.ok(refl, 'Reflection entered'); assert.ok(g.chain.length > 0, 'copy instruction pending');
    if (respond) {
      if (g.pending!.player !== P1) g = pass(g);
      const sc = hand(g, P1, 'Star-Crossed');
      assert.ok(canPlayNow(g, P1, sc));
      g = act(g, { type: 'playCard', player: P1, obj: sc });
      for (let i = 0; i < 6 && g.pending?.inStep; i++) { const d = g.pending; g = ans(g, d.options!.some(o => o.id === x) ? [x] : d.options!.some(o => o.id === mine) ? [mine] : d.options![0].id); }
      g = drive(g, [], y => y.pending?.kind === 'mainAction');
      assert.equal(zone(g, x), 'hand', 'copy target bounced');
      assert.notEqual(chars(g, refl!).name, 'V(3)', 'no copy of the bounced unit');
    } else {
      g = drive(g, ['first'], y => y.pending?.kind === 'mainAction');
      assert.equal(chars(g, refl!).name, 'V(3)', 'copy'); assert.ok(hasKeyword(g, refl!, 'Temporary'), 'Temporary granted');
    }
  }
});

test('RJ#12274 my 2-Might token at Frozen Fortress; the opponent Stupefies it in response to the Beginning-Phase trigger: 1 Might + 1 damage → dies', () => {
  let g = withTokens(S0()); fundAll(g, P1);
  setBattlefieldCard(g, BF_A, 'Frozen Fortress');
  const t = put(g, P0, 'V(2)', BF_A, { token: true }); control(g, BF_A, P0);
  g = endTurn(g, P0);
  g = drive(g, [], y => y.chain.some(c => /Frozen Fortress/.test(String(c.label))) && y.pending?.kind === 'chainResponse' && y.pending.player === P1 || y.pending?.kind === 'mainAction');
  assert.ok(g.chain.length > 0, 'Fortress trigger on the chain');
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Stupefy') });
  g = drive(g, [[t]], y => y.chain.length === 0 && !y.pending?.inStep);
  assert.ok(zone(g, t) !== 'battlefield', 'token died');
});

test('RJ#12275 Astral Heron works on the opponent\'s turn: my first card there (a Reaction) discounts my next card that turn; the discount is gone on my turn', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  put(g, P0, 'Astral Heron', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(3)', 'base');
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Discipline') }), [[e]], x => x.pending?.kind === 'chainResponse' && x.pending.player === P0);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Stupefy') });
  g = drive(g, [[e]], x => x.chain.length === 0 && x.pending?.kind === 'mainAction');
  const h = hand(g, P0, 'Astral Heron');
  assert.equal(playCostOf(g, P0, h)!.energy, 5, '7 - 2 on the opponent\'s turn');
  g = nextTurn(g);
  assert.equal(g.activePlayer, P0);
  assert.equal(playCostOf(g, P0, h)!.energy, 7, 'expired at end of that turn');
});

test('RJ#12277 Teemo, Strategist defends alone with Mask of Foresight; hidden Temporal Breach in response: on Teemo → new object, defend trigger fires again (twice); on the attacker → once', () => {
  for (const onTeemo of [true, false]) {
    let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
    const t = put(g, P0, 'Teemo, Strategist', BF_A); control(g, BF_A, P0);
    put(g, P0, 'Mask of Foresight', 'base');
    const tb = put(g, P0, 'Temporal Breach', { facedown: BF_A });
    const a = put(g, P1, 'V(5)', 'base');
    g = move(g, P1, [a], BF_A);
    for (let i = 0; i < 10 && g.pending?.inStep; i++) g = ans(g, g.pending.kind === 'optional' ? 'yes' : g.pending.options![0].id);
    if (g.pending?.player !== P0) g = pass(g);
    g = ans(act(g, { type: 'playCard', player: P0, obj: tb }), [onTeemo ? t : a]);
    g = drive(g, ['first', 'first', 'first', 'first', 'first'], x => x.pending?.kind === 'assignDamage' || x.pending?.kind === 'mainAction');
    const n = g.log.filter(l => /^Trigger: Teemo: When I defend/.test(l.text)).length;
    assert.equal(n, onTeemo ? 2 : 1, onTeemo ? 'new Teemo becomes a Defender → triggers again' : 'combat not restarted');
  }
});

test('RJ#12280 a unit killed by Falling Star at a battlefield goes to the trash (not base); Falling Star can also target a unit in base', () => {
  let g = S0(); fundAll(g, P0);
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const b = put(g, P1, 'V(3)', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Falling Star') });
  const ids = g.pending?.options?.map(o => o.id) ?? [];
  assert.ok(ids.includes(b) && ids.includes(e), 'base and battlefield units are legal targets');
  g = drive(g, [[e], [b]], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, e), 'trash'); assert.equal(zone(g, b), 'trash');
});

test('RJ#12281 Astral Heron\'s pending discount doesn\'t pay Kennen, Keeper of Balance\'s [2] stun (an ability cost, not a card): full [2], the discount stays for the next card', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'Astral Heron', BF_B); control(g, BF_B, P0);
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const k = put(g, P0, 'Kennen, Keeper of Balance', 'base');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'V(1)'), destination: 'base' }), [], x => x.chain.length === 0 && x.pending?.kind === 'mainAction');
  const h = hand(g, P0, 'Astral Heron');
  assert.equal(playCostOf(g, P0, h)!.energy, 5, 'discount pending');
  const ready = () => g.players[P0].runesInPlay.filter(r => !g.objects[r].exhausted).length + g.players[P0].pool.energy;
  const before = ready();
  g = drive(move(g, P0, [k], BF_A), ['yes', [e]], x => x.chain.some(c => c.source === k) && !x.pending?.inStep);
  assert.equal(before - ready(), 2, 'paid the full [2]');
  g = drive(g, [], x => x.chain.length === 0);
  assert.equal(g.objects[e].stunned, true);
  assert.equal(playCostOf(g, P0, h)!.energy, 5, 'discount still there for the next card');
});

test('RJ#12282 Deceiver\'s copy target is Star-Crossed away (no other unit there): the copy does nothing but the Reflection still gets Temporary (0-Might Reflection)', () => {
  let g = withTokens(S0()); fundAll(g, P0); fundAll(g, P1); setLegend(g, P0, 'Deceiver');
  const x = put(g, P0, 'V(3)', 'base'); hand(g, P0, 'V(1)');
  const mine = put(g, P1, 'V(2)', 'base');
  g = move(g, P0, [x], BF_A);
  let refl: string | undefined;
  for (let i = 0; i < 20 && !refl; i++) {
    const d = g.pending!; if (d.kind === 'mainAction') break;
    g = d.inStep ? ans(g, d.kind === 'optional' ? 'yes' : d.options![0].id) : pass(g);
    refl = Object.keys(g.objects).find(id => g.objects[id].isToken && g.objects[id].zone === 'battlefield');
  }
  assert.ok(refl && g.chain.length > 0);
  if (g.pending!.player !== P1) g = pass(g);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Star-Crossed') });
  for (let i = 0; i < 6 && g.pending?.inStep; i++) { const d = g.pending; g = ans(g, d.options!.some(o => o.id === x) ? [x] : d.options!.some(o => o.id === mine) ? [mine] : d.options![0].id); }
  g = drive(g, [], y => y.pending?.kind === 'mainAction');
  assert.equal(zone(g, x), 'hand');
  assert.equal(zone(g, refl!), 'battlefield');
  assert.equal(chars(g, refl!).name, 'Reflection', 'not a copy');
  assert.ok(hasKeyword(g, refl!, 'Temporary'), 'Temporary still granted');
});

test('RJ#12284 Lonely Poro alone at a battlefield killed as Stalking Wolf\'s additional cost (Wolf ambushed there): it died alone → draw 1', () => {
  let g = S0(); fundAll(g, P0);
  const po = put(g, P0, 'Lonely Poro', BF_A); control(g, BF_A, P0);
  const w = hand(g, P0, 'Stalking Wolf');
  const h0 = g.players[P0].hand.length;
  g = act(g, { type: 'playCard', player: P0, obj: w, destination: BF_A });
  g = drive(g, [[po], [po], 'yes', 'yes'], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, po), 'trash');
  assert.equal(locOf(g, w), BF_A, 'Wolf ambushed to its battlefield');
  assert.equal(g.players[P0].hand.length, h0 - 1 + 1, 'Wolf left the hand, Poro drew 1');
});

test('RJ#12285 Void Assault + Sandswept Tomb: discount only if the chosen friendly unit is already at the Tomb when played (not when it moves there)', () => {
  for (const atTomb of [true, false]) {
    let g = S0(); fundAll(g, P0);
    setBattlefieldCard(g, BF_A, 'Sandswept Tomb');
    const u = put(g, P0, 'V(2)', atTomb ? BF_A : 'base'); control(g, BF_A, P0);
    const e = put(g, P1, 'V(2)', 'base');
    const n0 = g.players[P0].runesInPlay.length;
    g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Void Assault') });
    for (let i = 0; i < 8 && g.pending?.inStep; i++) {
      const d = g.pending; const ids = d.options!.map(o => o.id);
      g = ans(g, ids.includes(u) ? [u] : ids.includes(e) ? [e] : ids.includes(String(atTomb ? BF_B : BF_A)) ? String(atTomb ? BF_B : BF_A) : ids.includes('base') ? 'base' : d.options![0].id);
    }
    assert.equal(n0 - g.players[P0].runesInPlay.length, atTomb ? 0 : 1, atTomb ? 'no power paid' : '1 power paid');
  }
});

test('RJ#12286 Frozen Fortress triggers at the start of the Beginning Phase even with no units there: it goes on the chain (players may respond), then does nothing', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  setBattlefieldCard(g, BF_A, 'Frozen Fortress');
  put(g, P0, 'V(2)', 'base'); put(g, P1, 'V(2)', 'base');   // targets for a Reaction; none at the Fortress
  g = endTurn(g, P0);
  let window = false;
  g = drive(g, [], y => { if (y.chain.some(c => /Frozen Fortress/.test(String(c.label))) && y.pending?.kind === 'chainResponse') window = true; return window || y.pending?.kind === 'mainAction'; });
  assert.ok(window, 'trigger on the chain with a response window');
  assert.ok(canPlayNow(g, g.pending!.player, hand(g, g.pending!.player, 'Stupefy')), 'Reactions playable');
});

test('RJ#12288 opponent\'s Sprite (Temporary) alone at a battlefield: I Ambush Rengar, Trophy Hunter in response to its Beginning-Phase kill; he enters, it dies, non-combat showdown → I conquer on their turn', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  const sp = put(g, P1, 'Sprite', BF_A, { token: true }); control(g, BF_A, P1);
  const r = hand(g, P0, 'Rengar, Trophy Hunter');
  g = endTurn(g, P0);
  g = drive(g, [], y => y.chain.some(c => c.source === sp) && y.pending?.kind === 'chainResponse' && y.pending.player === P0 || y.pending?.kind === 'mainAction');
  assert.ok(g.chain.some(c => c.source === sp), 'Temporary kill on the chain');
  assert.ok(canPlayNow(g, P0, r, BF_A), 'Rengar can ambush there (enemy unit still present)');
  const pts = g.players[P0].points;
  g = drive(act(g, { type: 'playCard', player: P0, obj: r, destination: BF_A }), ['first', 'first'], y => y.pending?.kind === 'mainAction');
  assert.ok(zone(g, sp) !== 'battlefield', 'Sprite died');
  assert.equal(locOf(g, r), BF_A);
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[P0].points, pts + 1, 'conquered on the opponent\'s turn');
});

test('RJ#12289 Astral Heron played to a battlefield as the second card of the turn: its trigger missed the first card → no discount', () => {
  let g = S0(); fundAll(g, P0, 8);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'V(1)'), destination: 'base' }), [], x => x.pending?.kind === 'mainAction');
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Astral Heron'), destination: BF_A }), [], x => x.pending?.kind === 'mainAction');
  assert.equal(playCostOf(g, P0, hand(g, P0, 'Astral Heron'))!.energy, 7, 'no discount');
});

test('RJ#12290 I held BF A this turn; Bone Skewer makes the opponent play a unit there and I win the combat: no second score there, but Draven, Audacious gives 1 point', () => {
  let g = S0(); fundAll(g, P0);
  const d = put(g, P0, 'Draven, Audacious', BF_A); control(g, BF_A, P0);
  g.battlefields[BF_A].scoredThisTurnBy = [P0];
  const e = hand(g, P1, 'V(2)');
  const pts = g.players[P0].points;
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Bone Skewer') });
  for (let i = 0; i < 40 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const p = g.pending;
    if (p.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: p.player, assignment: (p.data as { suggested: Record<string, number> }).suggested }); continue; }
    g = p.inStep ? ans(g, p.options!.find(o => o.id === String(BF_A) || o.id === e || o.id === 'yes')?.id ?? p.options![0].id) : pass(g);
  }
  assert.ok(g.log.some(l => /Combat at BF-A/.test(l.text)), 'combat happened');
  assert.equal(zone(g, e), 'trash'); assert.equal(locOf(g, d), BF_A);
  assert.equal(g.players[P0].points, pts + 1, 'only Draven\'s point');
});

test('RJ#12291 Shady Spectacles copies the printed Might of a unit, not the Might its attached gear gives', () => {
  let g = S0(); fundAll(g, P0);
  const a = put(g, P0, 'V(1)', 'base'), b = put(g, P0, 'V(3)', 'base');
  attachNow(g, put(g, P0, 'Hand Hammer', 'base'), b);
  const sp = put(g, P0, 'Shady Spectacles', 'base');
  assert.ok(mightOf(g, b) > 3, 'the gear raises b');
  g = drive(act(g, { type: 'activate', player: P0, obj: sp, abilityIndex: EQUIP }), [[a], [b]]);
  assert.equal(g.objects[sp].attachedTo, a);
  assert.equal(mightOf(g, a), 3, 'copy of the 3-Might unit only');
});

test('RJ#12293 Pickpocket\'s play trigger uses the chain (the opponent may respond with Reactions); Equip is not Reaction-speed, so it can\'t be used in response', () => {
  let g = withTokens(S0()); fundAll(g, P0); fundAll(g, P1);
  const eye = put(g, P1, 'Eye of the Herald', 'base'); put(g, P1, 'V(2)', 'base');
  const st = hand(g, P1, 'Stupefy');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Pickpocket'), destination: 'base' }), ['yes', [eye]], x => x.pending?.kind === 'chainResponse' && x.pending.player === P1);
  assert.equal(g.chain.length, 1, 'trigger on the chain');
  assert.ok(canPlayNow(g, P1, st), 'Reactions allowed');
  assert.ok(!legal(g, P1, 'activate').some(a => a.type === 'activate' && a.obj === eye), 'no Equip in response');
  g = drive(g, [], x => x.chain.length === 0);
  assert.equal(zone(g, eye), 'trash');
  assert.ok(Object.values(g.objects).some(o => g.cards[o.cardId]?.name === 'Gold' && o.zone === 'base' && o.controller === P0), 'Gold played');
});

test('RJ#12294 Star-Crossed returning Pickpocket in response to its play trigger: the trigger still resolves (kill the gear, Gold token)', () => {
  let g = withTokens(S0()); fundAll(g, P0); fundAll(g, P1);
  const eye = put(g, P1, 'Eye of the Herald', 'base'); put(g, P1, 'V(2)', 'base');
  const pp = hand(g, P0, 'Pickpocket');
  g = drive(act(g, { type: 'playCard', player: P0, obj: pp, destination: 'base' }), ['yes', [eye]], x => x.pending?.kind === 'chainResponse' && x.pending.player === P1);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Star-Crossed') });
  for (let i = 0; i < 6 && g.pending?.inStep; i++) { const d = g.pending; g = ans(g, d.options!.some(o => o.id === pp) ? [pp] : [d.options![0].id]); }
  g = drive(g, [], x => x.chain.length === 0);
  assert.equal(zone(g, pp), 'hand', 'Pickpocket bounced');
  assert.equal(zone(g, eye), 'trash', 'gear still killed');
  assert.ok(Object.values(g.objects).some(o => g.cards[o.cardId]?.name === 'Gold' && o.zone === 'base' && o.controller === P0), 'Gold played');
});

test('RJ#12295 my equipment attached to a unit I took with Hostile Takeover stays mine (still attached) when the unit returns to its owner at end of turn', () => {
  let g = S0(); fundAll(g, P0);
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const hh = put(g, P0, 'Hand Hammer', 'base');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Hostile Takeover') }), [[e]], x => x.pending?.kind === 'mainAction');
  g = drive(act(g, { type: 'activate', player: P0, obj: hh, abilityIndex: EQUIP }), [[e]], x => x.pending?.kind === 'mainAction');
  assert.equal(g.objects[hh].attachedTo, e);
  g = endTurn(g, P0);
  g = drive(g, [], x => x.objects[e].controller === P1 && !x.chain.length && x.pending?.kind === 'mainAction');
  assert.equal(g.objects[e].controller, P1); assert.equal(locOf(g, e), 'base');
  assert.equal(g.objects[hh].controller, P0, 'equipment control unchanged');
  assert.equal(g.objects[hh].attachedTo, e, 'still attached');
});

test('RJ#12296 Lillia, Fae Fawn played to Star Spring: the trigger can only move ANOTHER unit — Lillia can\'t send herself to base for a Sprite', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  setBattlefieldCard(g, BF_A, 'Star Spring');
  const y = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const li = hand(g, P0, 'Lillia, Fae Fawn');
  g = act(g, { type: 'playCard', player: P0, obj: li, destination: BF_A });
  let offeredLillia = false;
  for (let i = 0; i < 12 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    if (d.inStep && d.options!.some(o => o.id === li)) offeredLillia = true;
    g = d.inStep ? ans(g, d.options!.find(o => o.id === 'yes' || o.id === y)?.id ?? d.options![0].id) : pass(g);
  }
  assert.equal(offeredLillia, false);
  assert.equal(locOf(g, li), BF_A); assert.equal(locOf(g, y), 'base');
  assert.equal(unitsNamed(g, 'Sprite').length, 0, 'Lillia never moved → no Sprite');
});

test('RJ#12298 Glowstone killed before my end of turn: its end-of-turn trigger doesn\'t happen (no 5 damage)', () => {
  let g = S0(); fundAll(g, P0);
  const gs = put(g, P0, 'Glowstone', 'base');
  const u = put(g, P0, 'V(6)', 'base');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Stalwart Goatherd'), destination: 'base' }), ['yes', [gs]], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, gs), 'trash');
  g = endTurn(g, P0);
  g = drive(g, [], x => x.activePlayer === P1 && x.pending?.kind === 'mainAction');
  assert.equal(g.objects[u].damage ?? 0, 0); assert.equal(zone(g, u), 'base');
});

test('RJ#12299 Unchecked Power (no choosing) kills Akali (ven-038, can\'t be chosen) at a battlefield; Empowered Ambessa (ven-084) outside combat is dealt no damage', () => {
  let g = S0(); fundAll(g, P0, 8);
  const ak = put(g, P1, 'ven-038-166', BF_A); control(g, BF_A, P1);
  const am = put(g, P1, 'ven-084-166', BF_B); g.objects[am].empowered = 1; control(g, BF_B, P1); g.timestamp++;
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Unchecked Power') }), [], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, ak), 'trash', 'Akali dealt 12');
  assert.equal(zone(g, am), 'battlefield'); assert.equal(g.objects[am].damage ?? 0, 0, 'Ambessa not dealt damage');
});

test('RJ#12297 opponent Charms my Lillia, Fae Fawn from A to B: Sprite at A, I keep A; then hidden Smoke and Mirrors swaps that Sprite and Lillia → second Sprite at B (two Sprites at B), draw 1', () => {
  let g = withTokens(S0({ tp: P1 })); fundAll(g, P0); fundAll(g, P1);
  const li = put(g, P0, 'Lillia, Fae Fawn', BF_A); control(g, BF_A, P0);
  const sm = put(g, P0, 'Smoke and Mirrors', { facedown: BF_A });
  put(g, P1, 'V(2)', BF_B); control(g, BF_B, P1);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Charm') });
  for (let i = 0; i < 30; i++) {
    const d = g.pending!;
    if (d.kind === 'mainAction' || d.player === P0 && unitsNamed(g, 'Sprite').length === 1 && g.chain.length === 0 && canPlayNow(g, P0, sm)) break;
    g = d.inStep ? ans(g, d.options!.find(o => o.id === li || o.id === String(BF_B))?.id ?? d.options![0].id) : pass(g);
  }
  const [s1] = unitsNamed(g, 'Sprite');
  assert.equal(locOf(g, li), BF_B); assert.equal(locOf(g, s1), BF_A, 'Sprite where she moved from');
  assert.equal(g.battlefields[BF_A].controller, P0, 'A kept');
  assert.ok(canPlayNow(g, P0, sm), 'Smoke and Mirrors playable from hiding in the showdown');
  const h0 = g.players[P0].hand.length;
  g = act(g, { type: 'playCard', player: P0, obj: sm });
  for (let i = 0; i < 6 && g.pending?.inStep && g.pending.player === P0; i++) { const d = g.pending; g = ans(g, d.options!.some(o => o.id === s1) ? [s1] : d.options!.some(o => o.id === li) ? [li] : [d.options![0].id]); }
  g = drive(g, ['first', 'first'], x => x.chain.length === 0 && !x.pending?.inStep);
  assert.equal(locOf(g, li), BF_A, 'Lillia back at A');
  assert.equal(unitsNamed(g, 'Sprite').filter(s => locOf(g, s) === BF_B).length, 2, 'two Sprites at B');
  assert.equal(g.players[P0].hand.length, h0 + 1, 'drew 1');
});

test('RJ#12302 Challenge damage stays after it resolves; a later combat cleanup heals every unit (including the one damaged by Challenge in base)', () => {
  let g = S0(); fundAll(g, P0);
  const f = put(g, P0, 'V(5)', 'base'); const e = put(g, P1, 'V(2)', 'base');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Challenge') }), [[f], [e]], x => x.pending?.kind === 'mainAction');
  assert.equal(g.objects[f].damage, 2, 'not healed after Challenge');
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(3)', 'base');
  g = drive(move(g, P0, [a], BF_A), [], x => x.pending?.kind === 'mainAction');
  assert.equal(g.objects[f].damage ?? 0, 0, 'healed in the combat cleanup');
});

test('RJ#12303 Reinforce (first card) with Astral Heron at a battlefield: the unit it plays gets no Heron discount; my next card gets it', () => {
  let g = S0(); fundAll(g, P0, 8);
  put(g, P0, 'Astral Heron', BF_A); control(g, BF_A, P0);
  const u = put(g, P0, 'V(6)', 'deckTop');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Reinforce') });
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    g = d.inStep ? ans(g, d.options!.find(o => o.id === u || o.id === 'yes' || o.id === 'base')?.id ?? d.options![0].id) : pass(g);
  }
  assert.ok(['base', 'battlefield'].includes(zone(g, u)), 'unit played');
  assert.equal(playCostOf(g, P0, hand(g, P0, 'Astral Heron'))!.energy, 5, 'discount still pending for the next card');
});

test('RJ#12305 Rebuttal can take control of the opponent\'s Rebuttal (paying [A]); the stolen Rebuttal then resolves under my control with my choice to pay [A] or counter', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P1, 'V(3)', 'base');
  const st = hand(g, P0, 'Stupefy');
  g = drive(act(g, { type: 'playCard', player: P0, obj: st }), [[u]], x => x.pending?.kind === 'chainResponse' && x.pending.player === P1);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Rebuttal') });
  for (let i = 0; i < 6 && g.pending?.inStep; i++) g = ans(g, g.pending.options!.find(o => /Stupefy/.test(o.label))?.id ?? g.pending.options![0].id);
  g = drive(g, [], x => x.pending?.kind === 'chainResponse' && x.pending.player === P0);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Rebuttal') });
  assert.ok(g.pending?.options?.some(o => /Rebuttal/.test(o.label)), 'the opposing Rebuttal (Energy 1) is a legal choice');
  g = ans(g, opt(g, /Rebuttal/));
  const asked: number[] = [];
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    if (d.inStep) { if (/pay \[A\]/.test(d.prompt ?? '')) asked.push(d.player); g = ans(g, 'yes'); } else g = pass(g);
  }
  assert.deepEqual(asked, [P0, P0], 'both Rebuttals resolve under my control');
  assert.equal(g.objects[st].controller, P0);
  assert.equal(zone(g, st), 'trash', 'Stupefy resolved');
});

test('RJ#12304 Bone Skewer can choose Baron Nashor from the revealed hand: he enters the new Baron Pit (not the chosen battlefield), is still stunned, and the opponent conquers the Pit', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  const b = hand(g, P1, 'Baron Nashor');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Bone Skewer') });
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    g = d.inStep ? ans(g, d.options!.find(o => o.id === b || o.id === 'yes')?.id ?? d.options![0].id) : pass(g);
  }
  assert.equal(zone(g, b), 'battlefield');
  assert.equal(g.battlefields.length, 3, 'Baron Pit added'); assert.equal(g.objects[b].battlefieldIndex, 2, 'entered the Pit');
  assert.equal(g.objects[b].stunned, true, 'stunned despite "can\'t be chosen"');
  assert.equal(g.battlefields[2].controller, P1); assert.equal(g.players[P1].points, 1);
});

test('RJ#12306 my 4-Might defender stuns the 6-Might attacker (Existential Dread): no unit dies → No Result, attacker recalled, not a "win"', () => {
  let { g, atk, def } = attackSetup(['V(6)'], ['V(4)']);
  for (let i = 0; i < 6 && g.pending?.inStep; i++) g = ans(g, g.pending.options![0].id);
  g.objects[atk[0]].stunned = true; g.timestamp++;   // stand-in for Existential Dread's stun
  g = drive(g, [], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, def[0]), 'battlefield'); assert.equal(locOf(g, atk[0]), 'base', 'attacker recalled');
  assert.equal(g.battlefields[BF_A].controller, P1, 'defender keeps it');
  assert.ok(!g.log.some(l => /wins? (the )?combat/i.test(l.text) && /P1/.test(l.text)), 'no combat win');
});

test('RJ#12307 Switcheroo on a lone defender with the Wuju Bladesman +2 (4) and a 6-Might attacker: swap from current Mights (defender 6, attacker 4); Yi\'s +2 stays active', () => {
  let g = S0(); fundAll(g, P1); setLegend(g, P1, 'Wuju Bladesman, Starter');
  const d = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(6)', 'base');
  g = drive(move(g, P0, [a], BF_A), [], x => x.pending?.kind === 'showdownAction' && x.pending.player === P1 && x.chain.length === 0);
  assert.equal(mightOf(g, d), 4);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Switcheroo') });
  for (let i = 0; i < 4 && g.pending?.inStep; i++) g = ans(g, [i === 0 ? d : a]);
  g = drive(g, [], x => x.chain.length === 0 && x.pending?.kind !== 'chainResponse');
  assert.equal(mightOf(g, d), 6); assert.equal(mightOf(g, a), 4);
  g = drive(g, [], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, a), 'trash'); assert.equal(zone(g, d), 'battlefield', 'defender wins');
});

test('RJ#12309 opponent\'s Promising Future: my Time Warp is played first, then their Elder Dragon enters; its play trigger resolves before my Time Warp (I still take the extra turn)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 6); fundAll(g, P1, 6);
  for (let i = 0; i < 5; i++) put(g, P0, 'Time Warp', 'deckTop');
  for (let i = 0; i < 5; i++) put(g, P1, 'Elder Dragon', 'deckTop');
  put(g, P0, 'V(3)', 'base');
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Promising Future') });
  let order: string[] | undefined;
  for (let i = 0; i < 60 && g.pending?.kind !== 'mainAction'; i++) {
    const d = g.pending!;
    if (!order && g.chain.length >= 2 && !d.inStep) order = chainLabels(g);
    g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  assert.ok(order, 'both on the chain');
  const tw = order!.findIndex(l => /Time Warp/.test(l)), ed = order!.findIndex(l => /Elder Dragon/.test(l));
  assert.ok(tw >= 0 && ed > tw, `Elder Dragon's trigger above Time Warp: ${order}`);
  assert.deepEqual(g.ex.extraTurns, [P0]);
});

test('RJ#12310 opponent\'s Promising Future: my Thousand-Tailed Watcher, then their Elder Dragon; the Dragon\'s 1 damage kills the Watcher; the Watcher\'s trigger still makes the Dragon 7', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 6); fundAll(g, P1, 6);
  for (let i = 0; i < 5; i++) put(g, P0, 'Thousand-Tailed Watcher', 'deckTop');
  for (let i = 0; i < 5; i++) put(g, P1, 'Elder Dragon', 'deckTop');
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Promising Future') });
  for (let i = 0; i < 60 && g.pending?.kind !== 'mainAction'; i++) {
    const d = g.pending!;
    const wo = d.kind === 'chooseTargets' && d.options!.find(o => /Watcher/.test(o.label));
    g = wo ? ans(g, [wo.id]) : d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  const [w] = Object.keys(g.objects).filter(id => nameOf(g, id) === 'Thousand-Tailed Watcher' && g.objects[id].zone === 'trash');
  assert.ok(w, 'Watcher died to the Dragon\'s 1 damage');
  const [ed] = unitsNamed(g, 'Elder Dragon');
  assert.equal(mightOf(g, ed), 7, 'Watcher\'s -3 still resolved');
});

test('RJ#12311 two Ruined Rex Deathknells (Karthus) both finalize with their targets before I get priority: revealing hidden Evelynn then can\'t make the second one target her', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1, 12);
  put(g, P1, 'Karthus, Eternal', 'base');
  const rex = put(g, P1, 'Ruined Rex', BF_B); control(g, BF_B, P1);
  const vex = put(g, P0, 'Vex, Apathetic', BF_A); control(g, BF_A, P0);
  const ev = put(g, P0, 'unl-141-219', { facedown: BF_A });
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Hidden Blade') });
  for (let i = 0; i < 16 && !(g.chain.some(c => c.source === rex) && g.pending?.player === P0 && !g.pending.inStep); i++) {
    const d = g.pending!;
    g = d.inStep ? ans(g, d.options!.some(o => o.id === rex) ? [rex] : d.options!.some(o => o.id === vex) ? [vex] : d.kind === 'optional' ? 'yes' : d.options![0].id) : pass(g);
  }
  const rexItems = g.chain.filter(c => c.source === rex);
  assert.equal(rexItems.length, 2, 'both Deathknells on the chain when I first get priority');
  assert.ok(canPlayNow(g, P0, ev), 'Evelynn can be revealed now');
  g = act(g, { type: 'playCard', player: P0, obj: ev });
  g = drive(g, ['no', 'no'], x => x.chain.length === 0 && !x.pending?.inStep);
  assert.ok(zone(g, ev) === 'battlefield' && (g.objects[ev].damage ?? 0) === 0, 'Evelynn untouched');
});

test('RJ#12314 Repulse on my unit chosen by the opponent\'s Star-Crossed (their own unit + mine): the whole spell is countered — neither unit returns', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const theirs = put(g, P1, 'V(2)', 'base');
  const mine = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Star-Crossed') });
  for (let i = 0; i < 4 && g.pending?.inStep; i++) { const d = g.pending; g = ans(g, [d.options!.some(o => o.id === theirs) ? theirs : mine]); }
  g = drive(g, [], x => x.pending?.kind === 'chainResponse' && x.pending.player === P0);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Repulse') });
  for (let i = 0; i < 4 && g.pending?.inStep; i++) { const d = g.pending; g = ans(g, d.options!.some(o => o.id === mine) ? [mine] : d.options!.find(o => /Star-Crossed/.test(o.label))?.id ?? d.options![0].id); }
  g = drive(g, [], x => x.chain.length === 0 && x.pending?.kind === 'mainAction');
  assert.equal(locOf(g, mine), BF_A, 'my unit stays');
  assert.equal(locOf(g, theirs), 'base', 'their unit stays too (countered)');
});

test('RJ#12315 Ride the Wind moving my unit out of Abandoned Hall: the Hall\'s spell trigger comes after it resolves, so that unit is no longer "here" to get +1', () => {
  let g = S0(); fundAll(g, P0);
  setBattlefieldCard(g, BF_A, 'Abandoned Hall');
  const u = put(g, P0, 'V(2)', BF_A, { ready: false }); control(g, BF_A, P0);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Ride the Wind') });
  let offered = false;
  for (let i = 0; i < 16 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    if (d.inStep && /Abandoned Hall|\+1/.test(d.prompt ?? '') && d.options!.some(o => o.id === u)) offered = true;
    g = d.inStep ? ans(g, d.options!.some(o => o.id === u) ? (d.kind === 'chooseTargets' ? [u] : u) : d.options!.find(o => o.id === 'base')?.id ?? d.options!.find(o => o.id === 'yes')?.id ?? d.options![0].id) : pass(g);
  }
  assert.equal(locOf(g, u), 'base');
  assert.equal(offered, false, 'the moved unit can\'t be chosen');
  assert.equal(mightOf(g, u), 2);
});

test('RJ#12316 Shen (ven-138) holds with exactly one other unit carrying three Trinity Forces: 1 hold + 1 Shen + 3 Trinity = 5 points', () => {
  let g = S0({ tp: P1 });
  const sh = put(g, P0, 'ven-138-166', BF_A); control(g, BF_A, P0);
  const o = put(g, P0, 'V(2)', BF_A);
  for (let i = 0; i < 3; i++) attachNow(g, put(g, P0, 'Trinity Force', 'base'), o);
  const pts = g.players[P0].points;
  g = nextTurn(g);
  assert.equal(g.activePlayer, P0);
  assert.equal(g.players[P0].points, pts + 5);
  void sh;
});

test('RJ#12317 Kharox: the "Then you may do this" unit is chosen after the Burn 3, so a unit just burned from the opponent\'s deck can be played', () => {
  let g = S0(); fundAll(g, P0, 8);
  const kh = put(g, P0, 'Kharox', 'base');
  const b = put(g, P1, 'V(4)', 'deckTop'); put(g, P1, 'V(1)', 'deckTop'); put(g, P1, 'V(1)', 'deckTop');
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === kh)!);
  let offered = false;
  for (let i = 0; i < 16 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    if (d.inStep && d.options!.some(o => o.id === b)) { offered = true; g = ans(g, [b]); continue; }
    g = d.inStep ? ans(g, d.options!.find(o => o.id === 'yes' || o.id === 'base')?.id ?? d.options![0].id) : pass(g);
  }
  assert.ok(offered, 'burned unit choosable');
  assert.equal(zone(g, b), 'base'); assert.equal(g.objects[b].controller, P0);
});

test('RJ#12318 Counter Strike on my lone defender vs two attackers: prevents the whole combat-damage event (both attackers\' damage)', () => {
  let { g, atk, def } = attackSetup(['V(2)', 'V(2)'], ['V(3)']);
  fundAll(g, P1);
  g = drive(g, [], x => x.pending?.kind === 'showdownAction' && x.chain.length === 0);
  if (g.pending!.player !== P1) g = pass(g);
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Counter Strike') }), [[def[0]]], x => x.chain.length === 0 && x.pending?.kind !== 'chainResponse');
  g = drive(g, [], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, def[0]), 'battlefield', 'defender survives 4 combat damage');
  assert.equal(g.battlefields[BF_A].controller, P1);
  void atk;
});

test('RJ#12321 Diana, Lunari\'s [1] is paid when her showdown trigger is finalized (errata), before it resolves', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 1); fundAll(g, P1);
  put(g, P0, 'Diana, Lunari', BF_A); control(g, BF_A, P0);
  put(g, P0, 'Stupefy', 'deckTop');
  const ready = () => g.players[P0].runesInPlay.filter(r => !g.objects[r].exhausted).length + g.players[P0].pool.energy;
  const r0 = ready();
  g = move(g, P1, [put(g, P1, 'V(1)', 'base')], BF_A);
  g = drive(g, ['yes'], x => x.chain.some(c => /Diana/.test(String(c.label))) && !x.pending?.inStep);
  assert.equal(r0 - ready(), 1, 'paid while the trigger is on the chain (not yet resolved)');
  assert.ok(!g.log.some(l => /Resolving Diana/.test(l.text)));
});

test('RJ#12322 declining Diana, Lunari\'s [1]: no Predict, no reveal, no draw (the trigger is removed)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  put(g, P0, 'Diana, Lunari', BF_A); control(g, BF_A, P0);
  const top = put(g, P0, 'Stupefy', 'deckTop');
  const h0 = g.players[P0].hand.length;
  g = move(g, P1, [put(g, P1, 'V(1)', 'base')], BF_A);
  g = drive(g, ['no'], x => x.pending?.kind === 'mainAction');
  assert.equal(g.players[P0].hand.length, h0, 'no draw');
  assert.equal(zone(g, top), 'mainDeck');
  assert.ok(!g.log.some(l => /Resolving Diana|reveals?/i.test(l.text) && /Diana|Stupefy/.test(l.text)), 'no reveal');
});

test('RJ#12323 under an opponent\'s Helm of Suppression, a hidden spell (cost 0 + [1]) can\'t be played with no Energy available', () => {
  let g = S0({ tp: P1 }); setRunes(g, P0, 0); fundAll(g, P1);
  put(g, P1, 'Helm of Suppression', 'base');
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const hb = put(g, P0, 'Hidden Blade', { facedown: BF_A });
  const e = put(g, P1, 'V(2)', BF_A);
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Stupefy') }), [[e]], x => x.pending?.kind === 'chainResponse' && x.pending.player === P0);
  assert.equal(canPlayNow(g, P0, hb), false, 'not affordable');
  let h = S0({ tp: P1 }); setRunes(h, P0, 0); fundAll(h, P1);
  put(h, P0, 'V(1)', BF_A); control(h, BF_A, P0);
  const hb2 = put(h, P0, 'Hidden Blade', { facedown: BF_A });
  const e2 = put(h, P1, 'V(2)', BF_A);
  h = drive(act(h, { type: 'playCard', player: P1, obj: hand(h, P1, 'Stupefy') }), [[e2]], x => x.pending?.kind === 'chainResponse' && x.pending.player === P0);
  assert.equal(canPlayNow(h, P0, hb2), true, 'control: free without the Helm');
});

test('RJ#12324 Assault counts at the conquer: a 4-Might Assault 2 attacker (6) conquering Sunken Temple is Mighty → the Temple triggers', () => {
  let g = S0({ bfA: 'Sunken Temple' }); fundAll(g, P0);
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const r = put(g, P0, 'unl-024-219', 'base');
  g = move(g, P0, [r], BF_A);
  let temple = false;
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    if (/Sunken Temple|draw 1/i.test(d.prompt ?? '') || chainLabels(g).some(l => /Sunken Temple/.test(l))) temple = true;
    if (d.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: d.player, assignment: (d.data as { suggested: Record<string, number> }).suggested }); continue; }
    g = d.inStep ? ans(g, d.options!.find(o => o.id === 'yes')?.id ?? d.options![0].id) : pass(g);
  }
  assert.equal(g.battlefields[BF_A].controller, P0, 'conquered');
  assert.ok(temple || g.log.some(l => /^Trigger: Sunken Temple/.test(l.text)), 'Sunken Temple triggered');
});

test('RJ#12325 Commander Ledros\'s additional cost can only kill friendly units, not gear', () => {
  let g = S0(); fundAll(g, P0, 8);
  const u = put(g, P0, 'V(1)', 'base');
  const gear = put(g, P0, 'Hand Hammer', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Commander Ledros'), destination: 'base' });
  let sawUnit = false;
  for (let i = 0; i < 6 && g.pending?.inStep; i++) {
    const d = g.pending; const ids = d.options!.map(o => o.id);
    assert.ok(!ids.includes(gear), 'gear never offered');
    if (ids.includes(u)) { sawUnit = true; g = ans(g, [u]); } else g = ans(g, d.options!.find(o => o.id === 'yes')?.id ?? d.options![0].id);
  }
  assert.ok(sawUnit, 'friendly unit offered');
  assert.equal(zone(g, gear), 'base');
});

test('RJ#12328 Lillia, Fae Fawn at Rockfall Path swapped away (Smoke and Mirrors): her move trigger can\'t play the Sprite at Rockfall Path → no token', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  setBattlefieldCard(g, BF_A, 'Rockfall Path');
  const li = put(g, P0, 'Lillia, Fae Fawn', BF_A); control(g, BF_A, P0);
  const s1 = put(g, P0, 'Sprite', 'base', { token: true });
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Smoke and Mirrors') });
  for (let i = 0; i < 6 && g.pending?.inStep; i++) { const d = g.pending; g = ans(g, d.options!.some(o => o.id === li) ? [li] : d.options!.some(o => o.id === s1) ? [s1] : [d.options![0].id]); }
  g = drive(g, ['first', 'first'], x => x.pending?.kind === 'mainAction');
  assert.equal(locOf(g, li), 'base'); assert.equal(locOf(g, s1), BF_A, 'swapped');
  assert.equal(unitsNamed(g, 'Sprite').length, 1, 'no new Sprite');
});

test('RJ#12330 a Temporal Breach played from hiding can only banish a unit at its own battlefield (not one at another battlefield or in base)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const here = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const there = put(g, P0, 'V(3)', BF_B); control(g, BF_B, P0);
  const inBase = put(g, P0, 'V(4)', 'base');
  const tb = put(g, P0, 'Temporal Breach', { facedown: BF_A });
  const e = put(g, P1, 'V(2)', 'base');
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Stupefy') }), [[e]], x => x.pending?.kind === 'chainResponse' && x.pending.player === P0);
  g = act(g, { type: 'playCard', player: P0, obj: tb });
  if (g.pending?.kind === 'chooseTargets') {
    const ids = g.pending.options!.map(o => o.id);
    assert.ok(ids.includes(here) && !ids.includes(there) && !ids.includes(inBase), 'only the unit here');
  } else assert.ok(g.log.some(l => /^\(auto\) Banish a unit.*V\(2\) @BF-A/.test(l.text)), 'the only legal target (the unit here) was auto-chosen');
  g = drive(g, [], x => x.chain.length === 0 && x.pending?.kind === 'mainAction');
  assert.equal(locOf(g, there), BF_B); assert.equal(locOf(g, inBase), 'base');
});

test('RJ#12331 / RJ#12332 Akali, Deadly Weapon\'s move damage resolves before combat is staged: empowered 2 kills a Stalwart Poro (2, Shield not yet active) → no combat, Akali conquers', () => {
  let g = S0(); fundAll(g, P0);
  const ak = put(g, P0, 'Akali, Deadly Weapon', 'base'); g.objects[ak].empowered = 1; g.timestamp++;
  const po = put(g, P1, 'Stalwart Poro', BF_A); control(g, BF_A, P1);
  g = drive(move(g, P0, [ak], BF_A), ['yes', [po]]);
  assert.equal(zone(g, po), 'trash', 'no defender Shield against the trigger damage');
  assert.ok(!g.log.some(l => /^Combat at BF-A/.test(l.text)), 'no combat');
  assert.equal(g.battlefields[BF_A].controller, P0);
});

test('RJ#12333 Kayle, Justified\'s Empower uses the chain: the opponent may play a Reaction before it resolves; the next Empower only after that chain resolves', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const k = put(g, P0, 'Kayle, Justified', 'base');
  put(g, P1, 'V(2)', 'base');
  const emp = () => legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === k);
  g = act(g, emp()!);
  g = drive(g, [], x => x.pending?.kind === 'chainResponse' && x.pending.player === P1);
  assert.ok(g.chain.length > 0, 'Empower on the chain');
  assert.ok(canPlayNow(g, P1, hand(g, P1, 'Stupefy')), 'opponent may react');
  g = drive(g, [], x => x.chain.length === 0 && x.pending?.kind === 'mainAction');
  assert.equal(g.objects[k].empowered, 1);
  assert.ok(emp(), 'second Empower available afterwards');
  g = drive(act(g, emp()!), [], x => x.chain.length === 0 && x.pending?.kind === 'mainAction');
  assert.equal(g.objects[k].empowered, 2); assert.equal(mightOf(g, k), 7);
});

test('RJ#12334 Sett, Brawler enters at 4; his "buff me" play trigger waits on the chain, so the opponent can react before he is buffed', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const s = hand(g, P0, 'Sett, Brawler');
  g = drive(act(g, { type: 'playCard', player: P0, obj: s, destination: 'base' }), [], x => x.pending?.kind === 'chainResponse' && x.pending.player === P1);
  assert.equal(zone(g, s), 'base'); assert.equal(mightOf(g, s), 4, 'not yet buffed');
  assert.ok(g.chain.some(c => c.source === s));
  assert.ok(canPlayNow(g, P1, hand(g, P1, 'Stupefy')));
  g = drive(g, [], x => x.chain.length === 0);
  assert.equal(mightOf(g, s), 5, 'buffed');
});

test('RJ#12337 Astral Heron: Discipline (first card) → opponent\'s Hard Bargain → my Defy: Discipline was paid in full; the discount is there for my next card after the chain', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  put(g, P0, 'Astral Heron', BF_A); control(g, BF_A, P0);
  const u = put(g, P0, 'V(2)', 'base');
  const ready = () => g.players[P0].runesInPlay.filter(r => !g.objects[r].exhausted).length;
  const r0 = ready();
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Discipline') }), [[u]], x => x.pending?.kind === 'chainResponse' && x.pending.player === P1);
  assert.equal(r0 - ready(), 2, 'Discipline: full 2 Energy');
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Hard Bargain') });
  for (let i = 0; i < 4 && g.pending?.inStep && g.pending.player === P1; i++) g = ans(g, g.pending.options!.find(o => /Discipline/.test(o.label))?.id ?? (g.pending.kind === 'optional' ? 'no' : g.pending.options![0].id));
  g = drive(g, [], x => x.pending?.kind === 'chainResponse' && x.pending.player === P0);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Defy') });
  for (let i = 0; i < 4 && g.pending?.inStep && g.pending.player === P0; i++) g = ans(g, g.pending.options!.find(o => /Hard Bargain/.test(o.label))?.id ?? g.pending.options![0].id);
  g = drive(g, [], x => x.chain.length === 0 && x.pending?.kind === 'mainAction');
  assert.equal(mightOf(g, u), 4, 'Discipline resolved');
  assert.equal(playCostOf(g, P0, hand(g, P0, 'Astral Heron'))!.energy, 5, 'next card discounted');
});

test('RJ#12338 a unit moves to an open battlefield (non-combat showdown): Frigid Touch it to 3, then (after it resolves) Gust it', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0);
  const e = put(g, P1, 'V(5)', 'base');
  g = drive(move(g, P1, [e], BF_A), [], x => x.pending?.kind === 'showdownAction' && x.pending.player === P0 && x.chain.length === 0 || x.pending?.kind === 'chainResponse' && x.pending.player === P0);
  const gu = hand(g, P0, 'Gust');
  assert.ok(!canPlayNow(g, P0, gu) || !(g.pending?.options ?? []).length, 'Gust needs ≤3 Might');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Frigid Touch') });
  for (let i = 0; i < 4 && g.pending?.inStep; i++) { const d = g.pending; g = ans(g, d.options!.some(o => o.id === e) ? [e] : d.options!.find(o => o.id === 'no')?.id ?? d.options![0].id); }
  g = drive(g, [], x => x.chain.length === 0 && !x.pending?.inStep);
  assert.equal(mightOf(g, e), 3);
  g = drive(g, [], x => x.pending?.player === P0 && !x.pending.inStep);
  g = drive(act(g, { type: 'playCard', player: P0, obj: gu }), [[e]], x => x.chain.length === 0 && !x.pending?.inStep);
  assert.equal(zone(g, e), 'hand');
});

test('RJ#12339 Emperor\'s Divide (from hiding, my main phase) moves my units to base without exhausting them', () => {
  let g = S0(); fundAll(g, P0);
  const a = put(g, P0, 'V(2)', BF_A); const b = put(g, P0, 'V(2)', BF_A, { ready: false }); control(g, BF_A, P0);
  const ed = put(g, P0, "Emperor's Divide", { facedown: BF_A });
  g = act(g, { type: 'playCard', player: P0, obj: ed });
  for (let i = 0; i < 6 && g.pending?.inStep; i++) { const d = g.pending; g = ans(g, d.options!.some(o => o.id === a) ? [a, b].filter(x => d.options!.some(o => o.id === x)) : d.options![0].id); }
  g = drive(g, [], x => x.pending?.kind === 'mainAction');
  assert.equal(locOf(g, a), 'base'); assert.equal(locOf(g, b), 'base');
  assert.equal(g.objects[a].exhausted, false, 'ready stays ready'); assert.equal(g.objects[b].exhausted, true, 'exhausted stays exhausted');
});

test('RJ#12340 Janna, Savior played as a Reaction where my opponent attacks: her trigger moves the lone attacker to base (state unchanged — still exhausted from its move); no combat damage', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0);
  const d = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const a = put(g, P1, 'V(4)', 'base');
  g = drive(move(g, P1, [a], BF_A), [], x => x.pending?.player === P0 && !x.pending.inStep);
  assert.equal(g.objects[a].exhausted, true, 'exhausted by its standard move');
  const j = hand(g, P0, 'Janna, Savior');
  g = act(g, { type: 'playCard', player: P0, obj: j, destination: BF_A });
  g = drive(g, [[a], 'first'], x => x.pending?.kind === 'mainAction');
  assert.equal(locOf(g, a), 'base'); assert.equal(g.objects[a].exhausted, true, 'the move neither exhausts nor readies');
  assert.equal(g.objects[d].damage ?? 0, 0); assert.equal(zone(g, d), 'battlefield', 'no combat damage');
  assert.equal(g.battlefields[BF_A].controller, P0);
});

test('RJ#12341 Astral Heron\'s discount covers Svellsongur\'s play cost (3+[A] → 1) but not its Equip [1][C] (separate activated ability)', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'Astral Heron', BF_A); control(g, BF_A, P0);
  const u = put(g, P0, 'V(2)', 'base');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'V(1)'), destination: 'base' }), [], x => x.chain.length === 0 && x.pending?.kind === 'mainAction');
  const sv = hand(g, P0, 'Svellsongur');
  const c = playCostOf(g, P0, sv)!;
  assert.equal(c.energy, 1); assert.equal(c.power.length, 0, 'play cost discounted');
  g = drive(act(g, { type: 'playCard', player: P0, obj: sv }), [], x => x.chain.length === 0 && x.pending?.kind === 'mainAction');
  const res = () => g.players[P0].runesInPlay.filter(r => !g.objects[r].exhausted).length + g.players[P0].runesInPlay.length;
  const r0 = res();
  g = drive(act(g, { type: 'activate', player: P0, obj: sv, abilityIndex: EQUIP }), [[u]], x => x.chain.length === 0 && x.pending?.kind === 'mainAction');
  assert.equal(g.objects[sv].attachedTo, u);
  assert.equal(r0 - res(), 2, 'Equip paid in full: 1 Energy (exhaust) + [C] (recycle)');
});

test('RJ#12342 Steel Paws\' Empower [7] with Curator of the Sands: Nasus can still ready 2 runes even if the opponent Star-Crosses Steel Paws in response (the paid ability stays on the chain)', () => {
  let g = S0(); setRunes(g, P0, 8, 'calm'); fundAll(g, P1); setLegend(g, P0, 'Curator of the Sands');
  const sp = put(g, P0, 'Steel Paws', 'base');
  put(g, P1, 'V(2)', 'base');
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === sp)!);
  let curator = false;
  for (let i = 0; i < 12 && !(g.pending?.kind === 'chainResponse' && g.pending.player === P1); i++) {
    const d = g.pending!;
    if (d.inStep && /Curator/.test(d.prompt ?? '')) curator = true;
    g = d.inStep ? ans(g, d.kind === 'optional' ? 'yes' : d.options!.slice(0, 2).map(o => o.id)) : pass(g);
  }
  assert.ok(g.chain.some(c => c.source === sp), 'Empower still on the chain');
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Star-Crossed') });
  for (let i = 0; i < 6 && g.pending?.inStep && g.pending.player === P1; i++) { const d = g.pending; g = ans(g, d.options!.some(o => o.id === sp) ? [sp] : [d.options![0].id]); }
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    if (d.inStep && /Curator/.test(d.prompt ?? '')) curator = true;
    g = d.inStep ? ans(g, d.kind === 'optional' ? 'yes' : d.options!.slice(0, 2).map(o => o.id)) : pass(g);
  }
  assert.equal(zone(g, sp), 'hand', 'Steel Paws bounced (not Empowered)');
  assert.ok(curator, 'Curator of the Sands offered');
  assert.ok(g.log.some(l => /Resolving Curator of the Sands/.test(l.text)), 'Curator resolved');
});

test('RJ#12343 Helm of Suppression adds its [1] once to a repeated spell\'s total cost (not per Repeat)', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P1, 'Helm of Suppression', 'base');
  const e = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Bellows Breath') }), [[e], 'yes', [e]], x => x.chain.length === 0 && x.pending?.kind === 'mainAction');
  assert.equal(g.objects[e].damage, 2, 'repeated');
  assert.ok(g.log.some(l => /^P0 pays 3 \S+ \S+$/.test(l.text)), `Energy 1 + Repeat 1 + Helm 1 (once), two Power: ${g.log.filter(l => /pays/.test(l.text)).map(l => l.text)}`);
});

test('RJ#12344 2nd turn: moving onto Forgotten Monument gives control but no conquer; conquering Seat of Power then still draws 1 for the controlled Monument', () => {
  let g = S0({ bfA: 'Forgotten Monument' }); setBattlefieldCard(g, BF_B, 'Seat of Power');
  g.players[P0].turnsTaken = 1; g.timestamp++;
  const u = put(g, P0, 'V(2)', 'base'), v = put(g, P0, 'V(2)', 'base');
  g = drive(move(g, P0, [u], BF_A), [], x => x.pending?.kind === 'mainAction');
  assert.equal(g.battlefields[BF_A].controller, P0); assert.equal(g.players[P0].points, 0, 'no conquer');
  const h0 = g.players[P0].hand.length;
  g = drive(move(g, P0, [v], BF_B), ['first'], x => x.pending?.kind === 'mainAction');
  assert.equal(g.players[P0].points, 1, 'Seat of Power conquered');
  assert.equal(g.players[P0].hand.length, h0 + 1, 'drew 1 (the Monument)');
});

test('RJ#12345 Empowered Akali, Deadly Weapon\'s move damage (2) kills a lone 2-Might unit despite the Wuju Bladesman legend: it isn\'t defending yet', () => {
  let g = S0(); fundAll(g, P0); setLegend(g, P1, 'Wuju Bladesman, Starter');
  const ak = put(g, P0, 'Akali, Deadly Weapon', 'base'); g.objects[ak].empowered = 1; g.timestamp++;
  const e = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  g = drive(move(g, P0, [ak], BF_A), ['yes', [e]]);
  assert.equal(zone(g, e), 'trash');
  assert.equal(g.battlefields[BF_A].controller, P0);
});

test('RJ#12348 Irelia, Fervent chosen by my Discipline: her +1 trigger (already on the chain) resolves even though Discipline is countered by Defy', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const ir = put(g, P0, 'Irelia, Fervent', 'base');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Discipline') }), [[ir]], x => x.pending?.kind === 'chainResponse' && x.pending.player === P1);
  assert.ok(g.chain.some(c => c.source === ir), 'Irelia\'s trigger on the chain');
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Defy') });
  for (let i = 0; i < 4 && g.pending?.inStep && g.pending.player === P1; i++) g = ans(g, g.pending.options!.find(o => /Discipline/.test(o.label))?.id ?? g.pending.options![0].id);
  g = drive(g, [], x => x.chain.length === 0 && x.pending?.kind === 'mainAction');
  assert.ok(g.log.some(l => /Discipline/.test(l.text) && /counter/i.test(l.text)), 'Discipline countered');
  assert.equal(mightOf(g, ir), 5, '+1 only (no +2)');
});

test('RJ#12349 Blade Dancer\'s ready trigger (I chose my exhausted unit with Discipline) still resolves after the opponent Defies Discipline', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  setLegend(g, P0, 'Blade Dancer');
  const u = put(g, P0, 'V(2)', 'base', { ready: false });
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Discipline') }), ['yes'], x => x.pending?.kind === 'chainResponse' && x.pending.player === P1);
  assert.equal(g.chain.length, 2, 'Discipline + Blade Dancer trigger');
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Defy') });
  for (let i = 0; i < 4 && g.pending?.inStep && g.pending.player === P1; i++) g = ans(g, g.pending.options!.find(o => /Discipline/.test(o.label))?.id ?? g.pending.options![0].id);
  g = drive(g, [], x => x.chain.length === 0 && x.pending?.kind === 'mainAction');
  assert.equal(g.objects[u].exhausted, false, 'readied');
  assert.equal(mightOf(g, u), 2, 'Discipline countered');
});

test('RJ#12351 Astral Heron: my first card (Discipline) is countered by Defy → it never completes, no discount for the next card', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  put(g, P0, 'Astral Heron', BF_A); control(g, BF_A, P0);
  const u = put(g, P0, 'V(2)', 'base');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Discipline') }), [[u]], x => x.pending?.kind === 'chainResponse' && x.pending.player === P1);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Defy') });
  for (let i = 0; i < 4 && g.pending?.inStep && g.pending.player === P1; i++) g = ans(g, g.pending.options!.find(o => /Discipline/.test(o.label))?.id ?? g.pending.options![0].id);
  g = drive(g, [], x => x.chain.length === 0 && x.pending?.kind === 'mainAction');
  assert.equal(mightOf(g, u), 2, 'countered');
  assert.equal(playCostOf(g, P0, hand(g, P0, 'Astral Heron'))!.energy, 7, 'no discount');
});

test('RJ#12352 Shuriken Flip: 2 damage kills the 2-Might enemy and moves my Mournful Witness there in one resolution → non-combat showdown, conquer, Witness not empowered', () => {
  let g = S0(); fundAll(g, P0);
  const w = put(g, P0, 'Mournful Witness', 'base');
  const e = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Shuriken Flip') });
  for (let i = 0; i < 6 && g.pending?.inStep; i++) { const d = g.pending; g = ans(g, d.options!.some(o => o.id === e) ? [e] : d.options!.some(o => o.id === w) ? [w] : d.options!.find(o => o.id === String(BF_A))?.id ?? d.options![0].id); }
  g = drive(g, [], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, e), 'trash'); assert.equal(locOf(g, w), BF_A);
  assert.ok(!g.log.some(l => /^Combat at BF-A/.test(l.text)), 'non-combat showdown');
  assert.equal(g.battlefields[BF_A].controller, P0, 'conquered');
  assert.ok(!g.objects[w].empowered, 'no combat ended for the Witness');
});

test('RJ#12356 Siphoning Strike on Vex, Apathetic (Deflect): runes are counted on resolution — with exactly 7, paying Deflect (recycle) leaves 6 → 4 damage; with 8 → 7 damage', () => {
  for (const [n, dmg] of [[7, 4], [8, 7]] as const) {
    let g = S0(); setRunes(g, P0, n, 'calm');
    const vx = put(g, P1, 'Vex, Apathetic', BF_A); control(g, BF_A, P1);
    g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Siphoning Strike') }), [[vx], 'yes', 'first'], x => x.chain.length === 0 && x.pending?.kind === 'mainAction');
    assert.ok(g.log.some(l => new RegExp(`Siphoning Strike deals ${dmg} to Vex`).test(l.text)), `${n} runes → ${dmg}: ${g.log.filter(l => /deals/.test(l.text)).map(l => l.text)}`);
  }
});

function heraldDies(unit: string, runes: (g: ReturnType<typeof S0>) => void) {
  let g = withTokens(S0({ tp: P1 })); fundAll(g, P1);
  const rh = put(g, P0, 'Rift Herald', BF_A); control(g, BF_A, P0);
  put(g, P0, 'V(1)', BF_A);
  runes(g);
  const u = hand(g, P0, unit);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Hidden Blade') });
  let dests: string[] = [];
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    if (d.inStep && d.kind === 'chooseDestination') dests = d.options!.map(o => o.id);
    g = d.inStep ? ans(g, d.options!.some(o => o.id === rh) ? [rh] : d.options!.some(o => o.id === u) ? [u] : d.options!.find(o => o.id === 'yes')?.id ?? d.options![0].id) : pass(g);
  }
  return { g, rh, u, dests };
}

test('RJ#12361 Rift Herald\'s Deathknell plays an Ambush unit "to your base": Ambush can\'t send it to my battlefield', () => {
  const { g, rh, u, dests } = heraldDies('Rengar, Trophy Hunter', h => fundAll(h, P0));
  assert.equal(zone(g, rh), 'trash');
  assert.ok(!dests.includes(String(BF_A)), 'no battlefield destination offered');
  assert.equal(locOf(g, u), 'base');
});

test('RJ#12362 Rift Herald\'s Deathknell plays Baron Nashor: his replacement puts him in the Baron Pit (not base); Energy ignored, his [A][A][A] still paid', () => {
  const { g, u } = heraldDies('Baron Nashor', h => { setRunes(h, P0, 3, 'chaos'); });
  assert.equal(zone(g, u), 'battlefield');
  assert.equal(g.objects[u].battlefieldIndex, 2, 'entered the Baron Pit');
  assert.equal(g.players[P0].runesInPlay.length, 0, '3 runes recycled for his Power cost');
});

test('RJ#12365 attacker and surprise defender (Ambush into an uncontrolled battlefield) both stunned, equal Might: no damage, attacker recalled, defender conquers on the attacker\'s turn', () => {
  let g = S0(); fundAll(g, P1);
  const a = put(g, P0, 'V(6)', 'base');
  const r = hand(g, P1, 'Rengar, Trophy Hunter');
  g = move(g, P0, [a], BF_A);
  g = pass(g);
  g = drive(act(g, { type: 'playCard', player: P1, obj: r, destination: BF_A }), [], x => x.chain.length === 0 && x.pending?.kind === 'showdownAction');
  assert.equal(g.objects[r].combatRole, 'defender');
  g.objects[a].stunned = true; g.objects[r].stunned = true; g.timestamp++;   // stand-ins for two stun effects
  const pts = g.players[P1].points;
  g = drive(g, [], x => x.pending?.kind === 'mainAction');
  assert.equal(g.objects[a].damage ?? 0, 0); assert.equal(zone(g, r), 'battlefield');
  assert.equal(locOf(g, a), 'base', 'attacker recalled');
  assert.equal(g.battlefields[BF_A].controller, P1); assert.equal(g.players[P1].points, pts + 1, 'defender conquers');
});

test('RJ#12366 Sett, Brawler (4 + buff = 5) Stupefied to 4: when Stupefy expires at end of turn he becomes Mighty → Grand Duelist triggers', () => {
  let g = S0(); fundAll(g, P0);
  setLegend(g, P0, 'Grand Duelist');
  const s = put(g, P0, 'Sett, Brawler', 'base', { buff: true });
  assert.equal(mightOf(g, s), 5);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Stupefy') }), [[s]], x => x.chain.length === 0 && x.pending?.kind === 'mainAction');
  assert.equal(mightOf(g, s), 4);
  g = endTurn(g, P0);
  let duel = false;
  for (let i = 0; i < 30 && g.activePlayer === P0; i++) {
    const d = g.pending; if (!d) break;
    if (g.chain.some(c => /Grand Duelist/.test(String(c.label))) || /Grand Duelist/.test(d.prompt ?? '')) duel = true;
    g = d.inStep ? ans(g, d.kind === 'optional' ? 'yes' : d.options![0].id) : pass(g);
  }
  assert.ok(duel || g.log.some(l => /Trigger: Grand Duelist/.test(l.text)), 'Grand Duelist triggered');
});

test('RJ#12375 / RJ#12376 a Mirror Image copy of Rumble, Scrapper stacks with the original: each Rumble is 4 +1 +1 = 6', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  const r = put(g, P0, 'Rumble, Scrapper', 'base');
  assert.equal(mightOf(g, r), 5, 'his own +1');
  const before = new Set(Object.keys(g.objects));
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Mirror Image') }), [[r]], x => x.chain.length === 0 && x.pending?.kind === 'mainAction');
  const refl = Object.keys(g.objects).find(id => !before.has(id) && g.objects[id].isToken && g.objects[id].zone === 'base')!;
  assert.equal(chars(g, refl).name, 'Rumble');
  assert.equal(mightOf(g, r), 6); assert.equal(mightOf(g, refl), 6);
});

test('RJ#12378 Switcheroo between Rumble, Scrapper (5 with his own +1) and a 2-Might unit: Rumble\'s +1 is already in the swapped values (Rumble 2, other 5), not added again', () => {
  let g = S0(); fundAll(g, P0);
  const r = put(g, P0, 'Rumble, Scrapper', BF_A); control(g, BF_A, P0);
  const v = put(g, P0, 'V(2)', BF_A);
  assert.equal(mightOf(g, r), 5);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Switcheroo') });
  for (let i = 0; i < 4 && g.pending?.inStep; i++) g = ans(g, [i === 0 ? r : v]);
  g = drive(g, [], x => x.chain.length === 0 && x.pending?.kind === 'mainAction');
  assert.equal(mightOf(g, r), 2); assert.equal(mightOf(g, v), 5);
});

test('RJ#12384 Repulse can\'t be played without an enemy spell/ability choosing my unit (its counter is mandatory) — e.g. just to trigger "when you play a spell"', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const rp = hand(g, P0, 'Repulse');
  const e = put(g, P1, 'V(2)', 'base');
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Stupefy') }), [[e]], x => x.pending?.kind === 'chainResponse' && x.pending.player === P0);
  assert.equal(canPlayNow(g, P0, rp), false, 'the only enemy spell doesn\'t choose my unit');
});

test('RJ#12386 opponent moves to an empty battlefield (non-combat showdown): I Gust the mover with my runes → no conquer', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0);
  const e = put(g, P1, 'V(2)', 'base');
  g = drive(move(g, P1, [e], BF_A), [], x => x.pending?.player === P0 && !x.pending.inStep);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Gust') }), [[e]], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, e), 'hand');
  assert.notEqual(g.battlefields[BF_A].controller, P1); assert.equal(g.players[P1].points, 0, 'no conquer');
});

test('RJ#12387 Scorn of the Moon\'s showdown-only Energy works in the opponent\'s showdown: it alone pays for Gust on their conquering unit', () => {
  let g = S0({ tp: P1 }); setRunes(g, P0, 0);
  const leg = setLegend(g, P0, 'Scorn of the Moon');
  const e = put(g, P1, 'V(2)', 'base');
  g = drive(move(g, P1, [e], BF_A), [], x => x.pending?.player === P0 && !x.pending.inStep);
  const gu = hand(g, P0, 'Gust');
  const ab = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === leg);
  assert.ok(ab, 'legend [Add] usable in the opponent\'s showdown');
  g = act(g, ab!);
  assert.equal(g.players[P0].pool.energy, 1);
  assert.ok(canPlayNow(g, P0, gu));
  g = drive(act(g, { type: 'playCard', player: P0, obj: gu }), [[e]], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, e), 'hand'); assert.equal(g.players[P1].points, 0);
});

test('RJ#12391 Rumble, Scrapper makes Ferrous Forerunner 7; the opponent Switcheroos it with their 1-Might unit: Forerunner 1, their unit 7', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1);
  put(g, P0, 'Rumble, Scrapper', 'base');
  const ff = put(g, P0, 'Ferrous Forerunner', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(1)', BF_A);
  assert.equal(mightOf(g, ff), 7);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Switcheroo') });
  for (let i = 0; i < 4 && g.pending?.inStep; i++) g = ans(g, [i === 0 ? ff : e]);
  g = drive(g, [], x => x.chain.length === 0 && !x.pending?.inStep);
  assert.equal(mightOf(g, ff), 1); assert.equal(mightOf(g, e), 7);
});

test('RJ#12396 Switcheroo at Trifarian War Camp (4 and 3 → 5 and 4): swap modifier ±1 → 4 and 5; leaving the camp removes only its +1', () => {
  let g = S0(); fundAll(g, P0);
  setBattlefieldCard(g, BF_A, 'Trifarian War Camp');
  const a = put(g, P0, 'V(4)', BF_A), b = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  assert.equal(mightOf(g, a), 5); assert.equal(mightOf(g, b), 4);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Switcheroo') });
  for (let i = 0; i < 4 && g.pending?.inStep; i++) g = ans(g, [i === 0 ? a : b]);
  g = drive(g, [], x => x.chain.length === 0 && x.pending?.kind === 'mainAction');
  assert.equal(mightOf(g, a), 4); assert.equal(mightOf(g, b), 5);
  g = drive(move(g, P0, [b], 'base'), [], x => x.pending?.kind === 'mainAction');
  assert.equal(mightOf(g, b), 4, 'keeps the +1 swap modifier, loses the camp\'s +1');
});

test('RJ#12397 Fiora, Victorious at Trifarian War Camp is 5 (Mighty → Deflect): Falling Star choosing her twice pays Deflect twice, 6 damage kills her', () => {
  let g = S0(); fundAll(g, P0, 6);
  setBattlefieldCard(g, BF_A, 'Trifarian War Camp');
  const f = put(g, P1, 'Fiora, Victorious', BF_A); control(g, BF_A, P1);
  assert.equal(mightOf(g, f), 5); assert.ok(hasKeyword(g, f, 'Deflect'));
  const n0 = g.players[P0].runesInPlay.length;
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Falling Star') });
  for (let i = 0; i < 8 && g.pending?.inStep; i++) { const d = g.pending; g = ans(g, d.options!.some(o => o.id === f) ? [f] : d.options!.find(o => o.id === 'yes')?.id ?? d.options![0].id); }
  const spentPower = n0 - g.players[P0].runesInPlay.length;
  g = drive(g, [], x => x.chain.length === 0 && x.pending?.kind === 'mainAction');
  assert.equal(zone(g, f), 'trash', '6 damage ≥ 5');
  const fsPower = Number(Object.values(g.cards).find(c => c.name === 'Falling Star')!.power ?? 0);
  assert.equal(spentPower, fsPower + 2, 'Deflect paid for each choice');
});

test('RJ#12399 Blade Dancer (Irelia legend) already ready: "When you conquer, you may pay [1] to ready me" is still offered and may be paid (does nothing)', () => {
  let g = S0(); fundAll(g, P0);
  setLegend(g, P0, 'Blade Dancer');
  const u = put(g, P0, 'V(2)', 'base');
  let offered = false;
  g = move(g, P0, [u], BF_A);
  for (let i = 0; i < 12 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    if (d.kind === 'optional' && /\[1\]|ready me|Blade Dancer/i.test(d.prompt ?? '')) offered = true;
    g = d.inStep ? ans(g, d.kind === 'optional' ? 'yes' : d.options![0].id) : pass(g);
  }
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.ok(offered, 'conquer trigger offered while the legend is ready');
});

test('RJ#12401 Riposte on my own spell while my Mel is empowered: the counter fails (Mel) but the friendly unit still gets +[S] equal to the spell\'s Energy cost', () => {
  let g = S0(); fundAll(g, P0);
  const mel = put(g, P0, 'Mel, Newly Awakened', 'base'); g.objects[mel].empowered = 3;
  const u = put(g, P0, 'V(2)', 'base'), w = put(g, P0, 'V(2)', 'base');
  const cl = hand(g, P0, 'Cleave');
  g = drive(act(g, { type: 'playCard', player: P0, obj: cl }), [[u]], x => x.pending?.kind === 'chainResponse');
  expectPending(g, 'chainResponse', P0);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Riposte') });
  for (let i = 0; i < 4 && g.pending?.inStep; i++) { const d = g.pending; g = ans(g, d.options!.some(o => o.id === w) ? [w] : d.options!.some(o => o.id === cl) ? [cl] : d.options![0].id); }
  g = drive(g, [], x => x.pending?.kind === 'mainAction');
  assert.ok(hasKeyword(g, u, 'Assault'), 'Cleave was not countered');
  assert.equal(mightOf(g, w), 2 + 1, '+1 (Cleave\'s Energy cost)');
});

test('RJ#12402 Rengar, Trophy Hunter ambushed in response to Emperor\'s Divide enters at once (enemy units still there); the Divide then moves only its controller\'s units → Rengar stays alone', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const a = put(g, P1, 'V(2)', BF_A), b = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const r = hand(g, P0, 'Rengar, Trophy Hunter');
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, "Emperor's Divide") });
  for (let i = 0; i < 6 && g.pending?.inStep && g.pending.player === P1; i++) { const d = g.pending; g = ans(g, d.options!.some(o => o.id === a) ? [a, b].filter(x => d.options!.some(o => o.id === x)) : d.options![0].id); }
  g = drive(g, [], x => x.pending?.player === P0 && !x.pending.inStep);
  assert.ok(canPlayNow(g, P0, r, BF_A), 'Ambush: enemy units are still at BF-A');
  g = act(g, { type: 'playCard', player: P0, obj: r, destination: BF_A });
  assert.equal(locOf(g, r), BF_A, 'Rengar entered before the Divide resolved');
  g = drive(g, [], x => x.chain.length === 0 && (x.pending?.kind === 'mainAction' || !!x.showdown));
  assert.equal(locOf(g, a), 'base'); assert.equal(locOf(g, b), 'base');
  assert.equal(locOf(g, r), BF_A, 'not a friendly unit for the Divide');
});

test('RJ#12403 Valley of Idols: the [1] is paid when the trigger goes on the chain; the opponent may Gust the unit in response → no buff, [1] not refunded', () => {
  let g = S0(); setRunes(g, P0, 3); fundAll(g, P1);
  setBattlefieldCard(g, BF_A, 'Valley of Idols');
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const u = hand(g, P0, 'V(2)');
  g = act(g, { type: 'playCard', player: P0, obj: u, destination: BF_A });
  g = drive(g, ['yes', 'first', 'first'], x => x.pending?.kind === 'chainResponse' && x.pending.player === P1 || x.pending?.kind === 'mainAction');
  expectPending(g, 'chainResponse', P1, 'opponent may respond to the buff trigger');
  const spentBefore = g.players[0].runesInPlay.filter(x => g.objects[x].exhausted).length;
  assert.ok(spentBefore >= 3, 'unit cost + the [1] already paid');
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Gust') }), [[u]], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, u), 'hand');
  assert.equal(g.objects[u].counters.buff ?? 0, 0, 'no buff');
  assert.equal(g.players[0].runesInPlay.filter(x => g.objects[x].exhausted).length, spentBefore, '[1] not refunded');
});

test('RJ#12406 Vex, Apathetic in base when the opponent ambushes Rengar: no stun; swapping Vex to the battlefield afterwards with hidden Tideturner doesn\'t stun him retroactively', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  put(g, P1, 'V(2)', BF_B); control(g, BF_B, P1);
  const vex = put(g, P1, 'Vex, Apathetic', 'base');
  const tt = put(g, P1, 'Tideturner', { facedown: BF_B });
  const r = hand(g, P0, 'Rengar, Trophy Hunter');
  g = act(g, { type: 'playCard', player: P0, obj: r, destination: BF_B });
  assert.equal(locOf(g, r), BF_B);
  g = drive(g, [], x => x.pending?.player === P1 && !x.pending.inStep && canPlayNow(x, P1, tt));
  assert.notEqual(g.objects[r].stunned, true, 'Vex was in base: no stun');
  g = act(g, { type: 'playCard', player: P1, obj: tt });
  for (let i = 0; i < 6 && g.pending?.inStep && g.pending.player === P1; i++) { const d = g.pending; g = ans(g, d.options!.some(o => o.id === vex) ? [vex] : d.options!.some(o => o.id === 'yes') ? 'yes' : d.options![0].id); }
  g = drive(g, [], x => locOf(x, vex) === BF_B && x.chain.length === 0);
  assert.equal(locOf(g, vex), BF_B, 'Vex swapped to the battlefield');
  assert.notEqual(g.objects[r].stunned, true, 'still not stunned');
});

test('RJ#12408 Void Assault takes the opponent\'s only unit out of a battlefield with their hidden Tideturner: they must play it in response, otherwise control is lost and the hidden card trashed in the cleanup', () => {
  const setup = () => {
    const g = S0(); fundAll(g, P0); fundAll(g, P1);
    const m = put(g, P0, 'V(2)', 'base');
    const e = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
    const tt = put(g, P1, 'Tideturner', { facedown: BF_A });
    return { g, m, e, tt };
  };
  let { g, m, e, tt } = setup();
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Void Assault') });
  for (let i = 0; i < 8 && g.pending?.inStep && g.pending.player === P0; i++) g = answer(g, { targets: [[m], [e]], locations: [BF_A, 'base'] });
  g = drive(g, [], x => x.pending?.player === P1 && !x.pending.inStep);
  expectPending(g, 'chainResponse', P1);
  assert.ok(canPlayNow(g, P1, tt), 'hidden Tideturner can be played in response');
  g = drive(g, [], x => x.chain.length === 0 && x.objects[tt]?.zone !== 'facedown' || x.pending?.kind === 'mainAction');
  assert.equal(locOf(g, e), 'base');
  assert.equal(zone(g, tt), 'trash', 'hidden card trashed after control was lost');
  assert.notEqual(g.battlefields[BF_A].controller, P1);
});

test('RJ#12409 Soraka, Wanderer in base dying at the same time (Avalanche) as a smaller friendly unit there still saves it (base is her location)', () => {
  let g = S0(); fundAll(g, P0);
  const s = put(g, P0, 'Soraka, Wanderer', 'base', { damage: 1 });
  const x = put(g, P0, 'V(2)', 'base');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Avalanche') }), [], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, s), 'trash', 'Soraka dies');
  assert.equal(zone(g, x), 'base', 'the smaller unit is saved'); assert.equal(g.objects[x].damage ?? 0, 0, 'healed');
});

test('RJ#12410 Retreat can\'t be played with no friendly unit (an enemy unit is not a legal target)', () => {
  const g = S0(); fundAll(g, P0);
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const r = hand(g, P0, 'Retreat');
  assert.equal(canPlayNow(g, P0, r), false);
  put(g, P0, 'V(1)', 'base'); g.timestamp++;
  assert.equal(canPlayNow(g, P0, r), true, 'playable once there is a friendly unit');
});

test('RJ#12411 Rogue Assassin (empowered): the opponent moves the chosen unit to base in response (Siren\'s Song) → no longer in a showdown, the ability does nothing (not readied)', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const leg = setLegend(g, P0, 'Rogue Assassin'); g.objects[leg].empowered = 3;
  const u = put(g, P0, 'V(2)', 'base');
  g = drive(move(g, P0, [u], BF_A), [], x => x.pending?.kind === 'showdownAction' && x.chain.length === 0);
  assert.equal(g.objects[u].exhausted, true);
  const ab = legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === leg)!;
  assert.ok(ab, 'legend ability usable in the showdown');
  g = drive(act(g, ab), [[u]], x => x.pending?.player === P1 && !x.pending.inStep);
  expectPending(g, 'chainResponse', P1);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, "Siren's Song") });
  for (let i = 0; i < 6 && g.pending?.inStep && g.pending.player === P1; i++) g = answer(g, { targets: [[u]], locations: ['base'] });
  g = drive(g, [], x => x.chain.length === 0 && !x.pending?.inStep);
  assert.equal(locOf(g, u), 'base', 'moved by Siren\'s Song');
  assert.equal(g.objects[u].exhausted, true, 'the legend\'s "ready it" did not happen');
});

test('RJ#12412 a unit stunned by Vex, Apathetic still can\'t be moved this turn after Vex dies', () => {
  let g = S0(); fundAll(g, P0, 8);
  const vex = put(g, P1, 'Vex, Apathetic', BF_B); control(g, BF_B, P1);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const u = hand(g, P0, 'V(2)');
  g = drive(act(g, { type: 'playCard', player: P0, obj: u, destination: 'base' }), [], x => x.pending?.kind === 'mainAction');
  assert.equal(g.objects[u].stunned, true);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Falling Comet') });
  g = drive(g, [[vex], 'yes', 'yes'], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, vex), 'trash', 'Vex died');
  assert.deepEqual(moveDests(g, P0, u), [], 'still can\'t move this turn');
});

test('RJ#12415 Mirror Image copying a unit whose Might Switcheroo lowered: the Reflection has the printed Might (6), the original stays 2', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  const big = put(g, P0, 'V(6)', BF_A), small = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Switcheroo') }), [[big, small]], x => x.pending?.kind === 'mainAction');
  assert.equal(mightOf(g, big), 2);
  const before = new Set(Object.keys(g.objects));
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Mirror Image') }), [[big]], x => x.pending?.kind === 'mainAction');
  const refl = Object.keys(g.objects).find(id => !before.has(id) && g.objects[id].isToken && g.objects[id].zone === 'base')!;
  assert.ok(refl, 'Reflection created');
  assert.equal(mightOf(g, refl), 6, 'printed Might copied');
  assert.equal(mightOf(g, big), 2, 'original still swapped');
});

test('RJ#12416 The List\'s -2 on my unit, then my hidden Temporal Breach on it: it comes back as a new object at full Might', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const d = put(g, P0, 'Mega-Mech', BF_A); control(g, BF_A, P0);
  const tb = put(g, P0, 'Temporal Breach', { facedown: BF_A });
  const full = mightOf(g, d);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'The List') });
  for (let i = 0; i < 10 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const p = g.pending; const o = p.options?.find(x => /^Mech$/i.test(x.label));
    g = p.inStep ? ans(g, o ? o.id : p.options![0].id) : act(g, { type: 'pass', player: p.player });
  }
  const tl = g.players[P1].base.find(id => g.cards[g.objects[id].cardId].name === 'The List')!;
  g = drive(act(g, legal(g, P1, 'activate').find(a => a.type === 'activate' && a.obj === tl)!), [[d]], x => x.pending?.kind === 'mainAction');
  assert.equal(mightOf(g, d), full - 2);
  const w = put(g, P1, 'V(1)', 'base');
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Cleave') }), [[w]], x => x.pending?.player === P0 && !x.pending.inStep);
  g = act(g, { type: 'playCard', player: P0, obj: tb });
  g = drive(g, [[d], 'first', 'first'], x => x.pending?.kind === 'mainAction');
  const nd = Object.keys(g.objects).find(id => g.cards[g.objects[id].cardId]?.name === 'Mega-Mech' && g.objects[id].zone === 'battlefield')!;
  assert.ok(nd, 'played back to the battlefield');
  assert.equal(mightOf(g, nd), full, 'the -2 did not follow the new object');
});

test('RJ#12417 Tornado Warrior played from hidden in response to Unchecked Power is on the board when it resolves: takes 12 and dies', () => {
  let g = S0(); fundAll(g, P0, 14); fundAll(g, P1);
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const tw = put(g, P1, 'Tornado Warrior', { facedown: BF_A });
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Unchecked Power') }), [], x => x.pending?.player === P1 && !x.pending.inStep);
  assert.ok(canPlayNow(g, P1, tw), 'can be revealed in response');
  g = act(g, { type: 'playCard', player: P1, obj: tw });
  g = drive(g, ['no', 'no'], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, tw), 'trash', 'no survivor');
});

test('RJ#12418 (MISMATCH-RJ) hidden Temporal Breach on Ravenbloom Student: she is banished and played back only after the Breach finishes resolving → doesn\'t see it played, no +1', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const st = put(g, P0, 'Ravenbloom Student', BF_A); control(g, BF_A, P0);
  const tb = put(g, P0, 'Temporal Breach', { facedown: BF_A });
  g = act(g, { type: 'playCard', player: P0, obj: tb });
  g = drive(g, [[st], 'first', 'first'], x => x.pending?.kind === 'mainAction');
  const ns = Object.keys(g.objects).find(id => g.cards[g.objects[id].cardId]?.name === 'Ravenbloom Student' && g.objects[id].zone === 'battlefield')!;
  assert.ok(ns, 'played back to BF-A');
  assert.equal(mightOf(g, ns), 2, 'no +1: not on the board when the Breach\'s play was completed (CR 354.4, 420.4.a; DECISIONS principle 5, #231)');
});

test('RJ#12419 Shadow\'s Call gives Temporary; at my next Beginning Phase I respond to the Temporary kill with a hidden Temporal Breach (hidden earlier) at that battlefield → the new object survives', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const tb = put(g, P0, 'Temporal Breach', { facedown: BF_A });
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, "Shadow's Call") }), [[u]], x => x.pending?.kind === 'mainAction');
  assert.ok(hasKeyword(g, u, 'Temporary'));
  g = endTurn(g, P0); g = drive(g, [], x => x.pending?.kind === 'mainAction'); g = endTurn(g, P1);
  let played = false;
  for (let i = 0; i < 40 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    if (!played && d.player === P0 && !d.inStep && canPlayNow(g, P0, tb)) { g = act(g, { type: 'playCard', player: P0, obj: tb }); played = true; continue; }
    if (d.inStep) { g = ans(g, d.options!.some(o => o.id === u) ? [u] : d.options![0].id); continue; }
    g = act(g, { type: 'pass', player: d.player });
  }
  assert.ok(played, 'Temporal Breach playable in response to the Temporary trigger');
  const nu = Object.keys(g.objects).find(id => g.cards[g.objects[id].cardId]?.name === 'V(3)' && g.objects[id].zone === 'battlefield' && g.objects[id].controller === P0);
  assert.ok(nu, 'the unit survives as a new object');
  assert.equal(hasKeyword(g, nu!, 'Temporary'), false);
});

test('RJ#12421 Zed, Without a Sound at Vilemaw\'s Lair swapping with a Shadow Clone in base: Zed can\'t move to base and stays, the Clone still moves to the Lair', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  setBattlefieldCard(g, BF_A, "Vilemaw's Lair");
  const z = put(g, P0, 'ven-112-166', BF_A); control(g, BF_A, P0);
  const c = place(g, P0, 'tok-shadow-clone', 'base', { token: true });
  const ab = legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === z);
  assert.ok(ab, 'the swap ability can be activated at the Lair');
  g = drive(act(g, ab!), [[c], 'first'], x => x.pending?.kind === 'mainAction');
  assert.equal(locOf(g, z), BF_A, 'Zed stays');
  assert.equal(locOf(g, c), BF_A, 'the Clone moved to the Lair');
});

test('RJ#12425 two Dazzling Auroras each play a Deadbloom Predator to the same enemy-occupied battlefield: one combat, both Predators attack', () => {
  let g = S0();
  put(g, P0, 'Dazzling Aurora', 'base'); put(g, P0, 'Dazzling Aurora', 'base');
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const d2 = put(g, P0, 'Deadbloom Predator', 'deckTop');
  const d1 = put(g, P0, 'Deadbloom Predator', 'deckTop');
  g = act(g, { type: 'endTurn', player: P0 });
  let both = false;
  for (let i = 0; i < 60; i++) {
    const d = g.pending!;
    if (d.kind === 'mainAction' || d.kind === 'assignDamage') break;
    if (g.showdown?.isCombat) { both = [d1, d2].every(x => locOf(g, x) === BF_A) && g.showdown.attacker === P0; break; }
    if (d.inStep) g = ans(g, d.options!.find(o => o.id === String(BF_A) || o.id === g.battlefields[BF_A].objId)?.id ?? d.options![0].id);
    else g = act(g, { type: 'pass', player: d.player });
  }
  assert.ok(both, 'a single combat at BF-A with both Predators, P0 attacking');
});

test('RJ#12427 Bellows Breath has one Repeat: it can be paid only once (a unit chosen by both executions takes 2)', () => {
  let g = S0(); fundAll(g, P0, 10);
  const a = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Bellows Breath') });
  let offers = 0;
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending; if (!d.inStep) { g = act(g, { type: 'pass', player: d.player }); continue; }
    if (d.kind === 'optional') { offers++; g = ans(g, 'yes'); continue; }
    g = ans(g, d.options!.some(o => o.id === a) ? [a] : d.options![0].id);
  }
  assert.ok(offers <= 1, 'Repeat offered at most once');
  assert.equal(g.objects[a].damage, 2, 'two executions in total');
});

test('RJ#12428 Twilight Step can move Diana, No Longer Human (3 Might when chosen and on resolution); her +2 comes after it resolves', () => {
  let g = S0(); fundAll(g, P0);
  const di = put(g, P0, 'Diana, No Longer Human', 'base');
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Twilight Step') });
  for (let i = 0; i < 8 && g.pending?.inStep; i++) g = answer(g, { targets: [[di]], locations: [BF_A] });
  g = drive(g, ['no', 'no'], x => x.pending?.kind === 'mainAction');
  assert.equal(locOf(g, di), BF_A, 'moved');
  assert.equal(mightOf(g, di), 5, '+2 from playing the spell, applied after it resolved');
});

test('RJ#12430 Azir, Sovereign\'s attack trigger moves exhausted token units (Recruit standing in for a Sand Soldier) from base too; they arrive still exhausted', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const t = put(g, P0, 'Recruit', 'base', { token: true, ready: false });
  const az = put(g, P0, 'Azir, Sovereign', 'base');
  g = move(g, P0, [az], BF_A);
  for (let i = 0; i < 12 && locOf(g, t) !== BF_A; i++) {
    const d = g.pending!;
    if (!d.inStep) { if (d.kind === 'chainResponse') { g = act(g, { type: 'pass', player: d.player }); continue; } break; }
    g = ans(g, d.kind === 'optional' ? 'yes' : d.options!.some(o => o.id === t) ? [t] : d.options![0].id);
  }
  assert.equal(locOf(g, t), BF_A, 'exhausted token moved');
  assert.equal(g.objects[t].exhausted, true, 'still exhausted');
});

test('RJ#12432 attacking Ruined Rex trades with an equal defender protected by Zhonya\'s Hourglass: the Hourglass replaces its death (recalled, healed); Rex\'s Deathknell then deals 4 to it, and that damage stays (after the combat heal)', () => {
  let g = S0(); fundAll(g, P1);
  const d = put(g, P1, 'V(6)', BF_A); control(g, BF_A, P1);
  const zh = put(g, P1, "Zhonya's Hourglass", 'base');
  const rex = put(g, P0, 'Ruined Rex', 'base');
  g = move(g, P0, [rex], BF_A);
  for (let i = 0; i < 60 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const p = g.pending;
    if (p.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: p.player, assignment: (p.data as { suggested: Record<string, number> }).suggested }); continue; }
    if (p.inStep) { g = ans(g, p.options!.some(o => o.id === d) ? [d] : p.kind === 'optional' ? 'yes' : p.options![0].id); continue; }
    g = act(g, { type: 'pass', player: p.player });
  }
  assert.equal(zone(g, rex), 'trash', 'Rex died');
  assert.equal(zone(g, zh), 'trash', 'Hourglass killed instead');
  assert.equal(locOf(g, d), 'base', 'defender recalled');
  assert.equal(g.objects[d].damage ?? 0, 4, 'Deathknell damage remains');
});

test('RJ#12433 Bone Skewer\'s "ignoring any and all costs" also waives a mandatory additional cost: Cruel Patron enters without killing a friendly unit', () => {
  let g = S0(); fundAll(g, P0, 6);
  const f = put(g, P1, 'V(2)', 'base');
  const cp = hand(g, P1, 'Cruel Patron');
  const bf = g.battlefields[BF_A].objId;
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Bone Skewer') });
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending; const o = (d.options ?? []).map(x => x.id);
    g = d.inStep ? ans(g, d.kind === 'optional' ? 'yes' : o.includes(cp) ? cp : o.includes(bf) ? bf : o.includes(String(BF_A)) ? String(BF_A) : o[0]) : act(g, { type: 'pass', player: d.player });
  }
  assert.equal(locOf(g, cp), BF_A, 'Cruel Patron played');
  assert.equal(zone(g, f), 'base', 'no friendly unit killed for it');
});

test('RJ#12435 Siphoning Strike\'s "when it dies this turn, channel 1 rune" doesn\'t fire when Zhonya\'s Hourglass saves the unit', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const zh = put(g, P1, "Zhonya's Hourglass", 'base');
  const runes0 = g.players[0].runesInPlay.length;
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Siphoning Strike') });
  g = drive(g, [[e], 'yes', 'first'], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, zh), 'trash'); assert.equal(locOf(g, e), 'base', 'saved and recalled');
  assert.equal(g.players[0].runesInPlay.length, runes0, 'no rune channelled');
});

test('RJ#12436 the opponent Charms my Azir, Sovereign into their battlefield: I applied Contested, so I am the Attacker and his "When I attack" may move my token units there', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1);
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const az = put(g, P0, 'Azir, Sovereign', 'base');
  const t = put(g, P0, 'Recruit', 'base', { token: true });
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Charm') });
  for (let i = 0; i < 6 && g.pending?.inStep && g.pending.player === P1; i++) g = answer(g, { targets: [[az]], locations: [BF_A] });
  for (let i = 0; i < 30 && locOf(g, t) !== BF_A; i++) {
    const d = g.pending!;
    if (d.kind === 'mainAction' || d.kind === 'assignDamage') break;
    if (!d.inStep) { g = act(g, { type: 'pass', player: d.player }); continue; }
    g = ans(g, d.kind === 'optional' ? 'yes' : d.options!.some(o => o.id === t) ? [t] : d.options![0].id);
  }
  assert.equal(locOf(g, az), BF_A);
  assert.equal(g.showdown?.attacker, P0, 'Azir\'s controller is the Attacker');
  assert.equal(locOf(g, t), BF_A, 'token moved by the attack trigger');
});

test('RJ#12437 Svellsongur on Jayce, Brilliant Inventor: the first non-token gear each turn triggers both instances → ready two exhausted things', () => {
  let g = S0(); fundAll(g, P0, 6);
  const j = put(g, P0, 'Jayce, Brilliant Inventor', 'base');
  attachNow(g, put(g, P0, 'Svellsongur', 'base'), j);
  const a = put(g, P0, 'V(2)', 'base', { ready: false }), b = put(g, P0, 'V(2)', 'base', { ready: false });
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Long Sword') });
  let picks = 0;
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending; if (!d.inStep) { g = act(g, { type: 'pass', player: d.player }); continue; }
    const o = (d.options ?? []).map(x => x.id);
    const pick = d.kind === 'chooseTargets' ? (picks++ === 0 ? a : b) : null;
    g = ans(g, d.kind === 'optional' ? 'yes' : pick && o.includes(pick) ? pick : o[0]);
  }
  assert.equal(g.objects[a].exhausted, false); assert.equal(g.objects[b].exhausted, false, 'two things readied');
});

test('RJ#12438 Ride the Wind moves Ravenbloom Student to Abandoned Hall: after it resolves both "when you play a spell" effects apply → 4 Might', () => {
  let g = S0(); fundAll(g, P0);
  setBattlefieldCard(g, BF_A, 'Abandoned Hall');
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const st = put(g, P0, 'Ravenbloom Student', 'base', { ready: false });
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Ride the Wind') });
  for (let i = 0; i < 8 && g.pending?.inStep; i++) g = answer(g, { targets: [[st]], locations: [BF_A] });
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending; if (!d.inStep) { g = act(g, { type: 'pass', player: d.player }); continue; }
    g = ans(g, d.kind === 'optional' ? 'yes' : d.options!.some(o => o.id === st) ? [st] : d.options![0].id);
  }
  assert.equal(locOf(g, st), BF_A); assert.equal(g.objects[st].exhausted, false);
  assert.equal(mightOf(g, st), 4, 'own +1 and the Hall\'s +1');
});

test('RJ#12439 Star Spring\'s "first time a player plays a non-token unit here" is per player: the opponent\'s earlier Inferna doesn\'t use up mine', () => {
  const g = starSpring12439();
  assert.ok(g.pending?.inStep && /move another unit/i.test(g.pending.prompt ?? ''), 'Star Spring triggered for my Inferna');
});
test('RJ#12439b Star Spring: for my play, I ("they") choose whether to move another unit I control there to base', () => {
  const g = starSpring12439();
  assert.equal(g.pending?.player, P0);
});
function starSpring12439() {
  let { g } = attackSetup(['V(3)', 'V(2)'], ['V(3)'], { bfA: 'Star Spring' });
  fundAll(g, P0); fundAll(g, P1);
  const i1 = hand(g, P1, 'Inferna'), i0 = hand(g, P0, 'Inferna');
  for (let k = 0; k < 10 && !(g.pending?.player === P1 && !g.pending.inStep && g.pending.kind === 'showdownAction'); k++) g = act(g, { type: 'pass', player: g.pending!.player });
  g = act(g, { type: 'playCard', player: P1, obj: i1, destination: BF_A });
  expectPending(g, 'chooseTargets', P1, 'the opponent\'s own Star Spring trigger');
  g = drive(g, [[]], x => x.pending?.player === P0 && !x.pending.inStep && x.chain.length === 0);
  assert.equal(locOf(g, i1), BF_A);
  g = act(g, { type: 'playCard', player: P0, obj: i0, destination: BF_A });
  return drive(g, [], x => x.pending?.inStep === true || x.pending?.kind === 'assignDamage');
}

test('RJ#12440 a unit with two Eye of the Herald moving to a battlefield plays two Recruit tokens there', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  const u = put(g, P0, 'V(2)', 'base');
  attachNow(g, put(g, P0, 'Eye of the Herald', 'base'), u);
  attachNow(g, put(g, P0, 'Eye of the Herald', 'base'), u);
  g = drive(move(g, P0, [u], BF_A), ['first', 'first', 'first', 'first'], x => x.pending?.kind === 'mainAction');
  assert.equal(unitsNamed(g, 'Recruit').filter(id => locOf(g, id) === BF_A).length, 2);
});

test('RJ#12443 a spell can\'t choose a Deflect unit if the Deflect cost can\'t be paid (it never reaches the chain that way)', () => {
  let g = S0(); setRunes(g, P0, 1);
  const r = put(g, P1, 'unl-024-219', BF_A); control(g, BF_A, P1);
  const hr = hand(g, P0, 'Hextech Ray');
  assert.equal(canPlayNow(g, P0, hr), false, 'the only target has Deflect and the [A] can\'t be paid: not playable');
  fundAll(g, P0);
  assert.equal(canPlayNow(g, P0, hr), true, 'playable once the Deflect cost can be paid');
});

test('RJ#12445 two Dazzling Auroras: Deadbloom Predator played into enemies, then Whiteflame Protector to base gives it +8 before the (staged) combat starts', () => {
  let g = S0();
  put(g, P0, 'Dazzling Aurora', 'base'); put(g, P0, 'Dazzling Aurora', 'base');
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const wf = put(g, P0, 'Whiteflame Protector', 'deckTop');
  const db = put(g, P0, 'Deadbloom Predator', 'deckTop');
  g = act(g, { type: 'endTurn', player: P0 });
  let mightAtCombat = -1;
  for (let i = 0; i < 60; i++) {
    const d = g.pending!;
    if (d.kind === 'mainAction' || d.kind === 'assignDamage') break;
    if (g.showdown?.isCombat) { mightAtCombat = mightOf(g, db); break; }
    const o = (d.options ?? []).map(x => x.id);
    if (d.inStep) g = ans(g, zone(g, wf) !== 'base' && zone(g, db) === 'battlefield' && o.includes('base') ? 'base' : o.includes(db) ? db : o.includes(String(BF_A)) ? String(BF_A) : o.includes(g.battlefields[BF_A].objId) ? g.battlefields[BF_A].objId : o[0]);
    else g = act(g, { type: 'pass', player: d.player });
  }
  assert.equal(locOf(g, wf), 'base');
  assert.equal(mightAtCombat, 16, 'Predator 8 + 8 when the combat starts');
});

test('RJ#12449 after the showdown ends and I conquer, the Rogue Assassin legend can no longer move that unit back (not in a showdown)', () => {
  let g = S0(); fundAll(g, P0);
  const leg = setLegend(g, P0, 'Rogue Assassin');
  const u = put(g, P0, 'V(2)', 'base');
  g = drive(move(g, P0, [u], BF_A), [], x => x.pending?.kind === 'mainAction');
  assert.equal(g.battlefields[BF_A].controller, P0, 'conquered');
  const ab = legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === leg);
  if (ab) g = drive(act(g, ab), ['first'], x => x.pending?.kind === 'mainAction');
  assert.equal(locOf(g, u), BF_A, 'no unit in a showdown: the unit is not moved back');
  assert.equal(g.battlefields[BF_A].controller, P0);
});

test('RJ#12450 Shuriken Flip (no Action/Reaction) can\'t be played during a showdown, even on my turn', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'V(2)', 'base');
  const sf = hand(g, P0, 'Shuriken Flip');
  g = drive(move(g, P0, [u], BF_A), [], x => x.pending?.kind === 'showdownAction' && x.pending.player === P0 && x.chain.length === 0);
  assert.equal(canPlayNow(g, P0, sf), false);
});

test('RJ#12451 Tornado Warrior played from hidden in a combat chooses Steel Paws to empower; Gust returns the Warrior in response → "here" is gone, Steel Paws is not empowered', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const sp = put(g, P1, 'Steel Paws', BF_A); put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const tw = put(g, P1, 'Tornado Warrior', { facedown: BF_A });
  const a = put(g, P0, 'V(5)', 'base');
  g = drive(move(g, P0, [a], BF_A), [], x => x.pending?.player === P1 && !x.pending.inStep && canPlayNow(x, P1, tw));
  g = act(g, { type: 'playCard', player: P1, obj: tw });
  for (let i = 0; i < 6 && g.pending?.inStep && g.pending.player === P1; i++) { const d = g.pending; g = ans(g, d.kind === 'optional' ? 'yes' : d.options!.some(o => o.id === sp) ? [sp] : d.options![0].id); }
  g = drive(g, [], x => x.pending?.player === P0 && !x.pending.inStep);
  assert.ok(g.chain.some(c => g.objects[c.source] && g.cards[g.objects[c.source].cardId]?.name === 'Tornado Warrior'), 'the empower trigger is on the chain');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Gust') });
  g = drive(g, [[tw]], x => x.chain.length === 0 || x.pending?.kind === 'assignDamage');
  assert.equal(zone(g, tw), 'hand');
  assert.ok(!g.objects[sp].empowered, 'Steel Paws not empowered');
});

test('RJ#12452 Rengar, Trophy Hunter can be ambushed in response to the opponent\'s Bashful Bloom (Lillia legend) activation, to a battlefield with their units', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const leg = setLegend(g, P1, 'Bashful Bloom');
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const r = hand(g, P0, 'Rengar, Trophy Hunter');
  const ab = legal(g, P1, 'activate').find(x => x.type === 'activate' && x.obj === leg)!;
  assert.ok(ab);
  g = drive(act(g, ab), [], x => x.pending?.player === P0 && !x.pending.inStep);
  expectPending(g, 'chainResponse', P0);
  assert.ok(canPlayNow(g, P0, r, BF_A), 'Ambush in response');
  assert.ok(!canPlayNow(g, P0, r, BF_B), 'not to a battlefield without units (the Sprite doesn\'t exist yet)');
});

test('RJ#12455 empowered Applied Researchers\' [1][A] discount also covers a Deflect surcharge: Hextech Ray ([1][F]) on a Deflect unit pays [1][F], not [1][F][A]', () => {
  const run = (emp: boolean) => {
    let g = S0(); setRunes(g, P0, 6, 'fury');
    const ar = put(g, P0, 'Applied Researchers', 'base'); if (emp) { g.objects[ar].empowered = 1; g.timestamp++; }
    const r = put(g, P1, 'unl-024-219', BF_A); control(g, BF_A, P1);
    g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Hextech Ray') }), [[r], 'yes']);
    return g.log.filter(l => /^P0 pays/.test(l.text)).map(l => l.text);
  };
  assert.deepEqual(run(false), ['P0 pays 1 F A'], 'Deflect adds one power');
  assert.deepEqual(run(true), ['P0 pays 1 F'], 'discount removes the Deflect power; energy stays at the minimum [1]');
});

test('RJ#12457 / RJ#12458 empowered Mel doesn\'t add -1 to Nine-Tailed Fox (it doesn\'t choose); it does to Ahri, Inquisitive\'s -2 (chooses an enemy unit): -3', () => {
  let g = S0({ tp: P1 });
  setLegend(g, P0, 'Nine-Tailed Fox');
  const mel = put(g, P0, 'Mel, Newly Awakened', 'base'); g.objects[mel].empowered = 3; g.timestamp++;
  put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const a = put(g, P1, 'V(4)', 'base');
  g = drive(move(g, P1, [a], BF_A), ['first', 'first'], x => x.pending?.kind === 'showdownAction' && x.chain.length === 0 || x.pending?.kind === 'assignDamage');
  assert.equal(mightOf(g, a), 3, 'Nine-Tailed Fox: -1 only');
  let h = S0(); fundAll(h, P0);
  const mel2 = put(h, P0, 'Mel, Newly Awakened', 'base'); h.objects[mel2].empowered = 3; h.timestamp++;
  const e = put(h, P1, 'V(5)', BF_A); control(h, BF_A, P1);
  const ah = put(h, P0, 'Ahri, Inquisitive', 'base');
  h = drive(move(h, P0, [ah], BF_A), ['first', 'yes', [e], 'first'], x => x.pending?.kind === 'showdownAction' && x.chain.length === 0 || x.pending?.kind === 'assignDamage');
  assert.equal(mightOf(h, e), 2, 'Ahri, Inquisitive: -2 -1 = -3');
});

test('RJ#12460 Morgana, Vindictive\'s play trigger can\'t choose an enemy Baron Nashor ("can\'t be chosen by enemy spells and abilities"), even with damage marked', () => {
  let g = S0(); fundAll(g, P0, 8);
  const b = put(g, P1, 'Baron Nashor', BF_A, { damage: 3 }); control(g, BF_A, P1);
  const o = put(g, P1, 'V(5)', BF_A, { damage: 2 });
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Morgana, Vindictive'), destination: 'base' });
  g = drive(g, [], x => x.pending?.inStep === true || x.pending?.kind === 'mainAction');
  const opts = (g.pending?.options ?? []).map(x => x.id);
  assert.ok(!opts.includes(b), 'Baron not choosable');
  assert.ok(opts.includes(o) || g.pending?.kind === 'mainAction', 'other damaged enemy is');
});

test('RJ#12462 / RJ#12463 / RJ#12464 Star-Crossed after an Ambush play bounces the pre-Ambush units only; the Ambush unit stays and keeps its side\'s role', () => {
  const run = (ambusher: typeof P0 | typeof P1) => {
    let { g, atk, def } = attackSetup(['V(3)'], ['V(2)']);
    fundAll(g, P0); fundAll(g, P1);
    const inf = hand(g, ambusher, 'Inferna');
    const sc = hand(g, P1, 'Star-Crossed');
    for (let k = 0; k < 10 && !(g.pending?.player === ambusher && !g.pending.inStep); k++) g = act(g, { type: 'pass', player: g.pending!.player });
    g = act(g, { type: 'playCard', player: ambusher, obj: inf, destination: BF_A });
    assert.equal(locOf(g, inf), BF_A, 'Ambush unit entered at once');
    for (let k = 0; k < 10 && !(g.pending?.player === P1 && !g.pending.inStep && canPlayNow(g, P1, sc)); k++) g = g.pending!.inStep ? ans(g, 'first') : act(g, { type: 'pass', player: g.pending!.player });
    g = act(g, { type: 'playCard', player: P1, obj: sc });
    for (let i = 0; i < 6 && g.pending?.inStep && g.pending.player === P1; i++) { const d = g.pending; g = ans(g, d.options!.some(o => o.id === def[0]) ? [def[0]] : d.options!.some(o => o.id === atk[0]) ? [atk[0]] : d.options![0].id); }
    g = drive(g, [], x => x.pending?.kind === 'mainAction');
    assert.equal(zone(g, def[0]), 'hand'); assert.equal(zone(g, atk[0]), 'hand');
    assert.equal(locOf(g, inf), BF_A, 'the Ambush unit stays');
    return g;
  };
  const d = run(P1);
  assert.equal(d.battlefields[BF_A].controller, P1, 'defender\'s Ambush unit keeps the battlefield (no combat damage)');
  const a = run(P0);
  assert.equal(a.battlefields[BF_A].controller, P0, 'attacker\'s Ambush unit alone: the attacker wins and conquers');
});

test('RJ#12465 a spell played from the trash with Flow and countered by Defy is banished (not trashed)', () => {
  let g = S0(); fundAll(g, P0, 8); fundAll(g, P1);
  const gear = put(g, P1, 'Long Sword', 'base');
  const bs = put(g, P0, 'Brittle Steel', 'trash');
  assert.ok(canPlayNow(g, P0, bs), 'Flow: playable from the trash');
  g = drive(act(g, { type: 'playCard', player: P0, obj: bs }), [[gear]], x => x.pending?.player === P1 && !x.pending.inStep);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Defy') });
  g = drive(g, ['first'], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, bs), 'banishment');
  assert.equal(zone(g, gear), 'base', 'countered');
});

test('RJ#12466 Zenith Blade can\'t choose Akali, Silent sitting at a battlefield (not in combat); moving a unit there doesn\'t make her choosable in time', () => {
  let g = S0(); fundAll(g, P0);
  const ak = put(g, P1, 'Akali, Silent', BF_A); control(g, BF_A, P1);
  const v = put(g, P1, 'V(2)', BF_B); control(g, BF_B, P1);
  put(g, P0, 'V(3)', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Zenith Blade') });
  const opts = (g.pending?.options ?? []).map(o => o.id);
  assert.ok(!opts.includes(ak), 'Akali not choosable');
  assert.ok(opts.includes(v) || g.chain.length > 0, 'another enemy unit is');
});

test('RJ#12467 Zilean at a battlefield + Keeper of Masks played from hidden there: Zilean doubles one Reflection (3), all become Keeper copies → 4 Keepers', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  put(g, P0, 'Zilean, Time Mage', BF_A); control(g, BF_A, P0);
  const k = put(g, P0, 'Keeper of Masks', { facedown: BF_A });
  g = act(g, { type: 'playCard', player: P0, obj: k });
  g = drive(g, ['yes', 'yes', 'first', 'first', 'first'], x => x.pending?.kind === 'mainAction');
  const here = Object.keys(g.objects).filter(id => g.objects[id].zone === 'battlefield' && locOf(g, id) === BF_A);
  assert.equal(here.filter(id => chars(g, id).name === 'Keeper of Masks').length, 4, 'original + 3 Reflection copies');
});

test('RJ#12470 two Sanctions on one unit (empower, then disempower): both delayed end-of-turn effects still trigger', () => {
  let g = S0(); fundAll(g, P0, 8);
  const sp = put(g, P0, 'Steel Paws', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Sanction') });
  g = drive(g, [/^Empower/i, [sp]], x => x.pending?.kind === 'mainAction');
  assert.ok(g.objects[sp].empowered, 'empowered by the first');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Sanction') });
  g = drive(g, [/^Disempower/i, [sp]], x => x.pending?.kind === 'mainAction');
  assert.ok(!g.objects[sp].empowered, 'disempowered by the second');
  const n = g.log.length;
  g = endTurn(g, P0);
  g = drive(g, ['first', 'first', 'first'], x => x.activePlayer === P1 && x.pending?.kind === 'mainAction');
  const res = g.log.slice(n).filter(l => /Sanction/.test(l.text) && /Resolving|Trigger/.test(l.text));
  assert.ok(res.filter(l => /^Resolving/.test(l.text)).length >= 2, `both delayed effects resolve: ${res.map(l => l.text).join(' | ')}`);
});

test('RJ#12471 hidden Tideturner at a battlefield can swap with a friendly unit in my base (base is another location)', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const tt = put(g, P0, 'Tideturner', { facedown: BF_A });
  const b = put(g, P0, 'V(3)', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: tt });
  for (let i = 0; i < 6 && g.pending?.inStep; i++) { const d = g.pending; g = ans(g, d.options!.some(o => o.id === b) ? [b] : d.kind === 'optional' ? 'yes' : d.options![0].id); }
  g = drive(g, [], x => x.pending?.kind === 'mainAction');
  assert.equal(locOf(g, tt), 'base'); assert.equal(locOf(g, b), BF_A);
});

test('RJ#12472 Jayce, Brilliant Inventor triggers when played and again on the first non-token gear that turn (a unit play doesn\'t use up the gear clause)', () => {
  let g = S0(); fundAll(g, P0, 8);
  const a = put(g, P0, 'V(2)', 'base', { ready: false }), b = put(g, P0, 'V(2)', 'base', { ready: false });
  let picks = 0;
  const step = (x: import('../conformance/harness.ts').GameState) => {
    for (let i = 0; i < 20 && x.pending && x.pending.kind !== 'mainAction'; i++) {
      const d = x.pending; if (!d.inStep) { x = act(x, { type: 'pass', player: d.player }); continue; }
      const o = (d.options ?? []).map(y => y.id);
      const pick = d.kind === 'chooseTargets' && /ready/i.test(d.prompt ?? '') ? (picks++ === 0 ? a : b) : null;
      x = ans(x, d.kind === 'optional' ? 'yes' : pick && o.includes(pick) ? pick : o[0]);
    }
    return x;
  };
  g = step(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Jayce, Brilliant Inventor'), destination: 'base' }));
  assert.equal(g.objects[a].exhausted, false, 'readied by "when you play me"');
  g = step(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Long Sword') }));
  assert.equal(g.objects[b].exhausted, false, 'readied by the first-gear clause');
});

test('RJ#12473 a 0-Might Shadow Clone alone at an open battlefield conquers it (Might doesn\'t matter for control/scoring)', () => {
  let g = withTokens(S0());
  const c = place(g, P0, 'tok-shadow-clone', 'base', { token: true });
  assert.equal(mightOf(g, c), 0);
  const pts = g.players[0].points;
  g = drive(move(g, P0, [c], BF_A), [], x => x.pending?.kind === 'mainAction');
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[0].points, pts + 1, 'conquer point');
});

test('RJ#12474 a unit that copies LeBlanc, Everywhere at Once (Shady Spectacles) at a battlefield is protected from its own granted Temporary', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'LeBlanc, Everywhere at Once', 'base');
  const x = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, "Shadow's Call") }), [[x]], y => y.pending?.kind === 'mainAction');
  attachNow(g, put(g, P0, 'Shady Spectacles', 'base'), x);
  g.timestamp++;
  assert.equal(chars(g, x).name, 'LeBlanc', 'copy of LeBlanc');
  assert.ok(hasKeyword(g, x, 'Temporary'), 'keeps the granted Temporary');
  g = endTurn(g, P0); g = drive(g, [], y => y.pending?.kind === 'mainAction'); g = endTurn(g, P1);
  g = drive(g, ['first', 'first'], y => y.activePlayer === P0 && y.pending?.kind === 'mainAction');
  assert.equal(locOf(g, x), BF_A, 'its own passive stops the Temporary trigger');
});

test('RJ#12475 Wild Claw playing Kayle, Justified and empowering her gives one Empowered status (+2), not three (no Deflect 3)', () => {
  let g = S0(); fundAll(g, P0, 8);
  const k = put(g, P0, 'Kayle, Justified', 'deckTop');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Wild Claw') });
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending; if (!d.inStep) { g = act(g, { type: 'pass', player: d.player }); continue; }
    const o = (d.options ?? []).map(y => y.id);
    g = ans(g, d.kind === 'optional' ? 'yes' : o.includes(k) ? [k] : o.includes('base') ? 'base' : o[0]);
  }
  assert.equal(locOf(g, k), 'base', 'Kayle played');
  assert.equal(g.objects[k].empowered, 1, 'one status');
  assert.equal(mightOf(g, k), 5);
  assert.equal(hasKeyword(g, k, 'Ganking'), false);
});

test('RJ#12476 a Bird defending alone at Forbidding Waste given Discipline: 1 + 2 - 2 = 1 (the passive -2 applies last)', () => {
  let g = withTokens(S0({ tp: P0 })); fundAll(g, P1);
  setBattlefieldCard(g, BF_A, 'Forbidding Waste');
  const b = put(g, P1, 'Bird', BF_A, { token: true }); control(g, BF_A, P1);
  const a = put(g, P0, 'V(5)', 'base');
  g = move(g, P0, [a], BF_A);
  g = drive(g, [], x => x.pending?.player === P1 && !x.pending.inStep);
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Discipline') }), [[b]], x => x.chain.length === 0 && x.pending?.kind !== 'chainResponse');
  assert.equal(mightOf(g, b), 1);
});

test('RJ#12478 Gutter Palace\'s "exactly 4 cards in hand" is checked when the trigger would go on the chain: with 5 cards no trigger (no win); exactly 4 + 4 units wins', () => {
  const run = (cards: number) => {
    let g = S0({ tp: P1 });
    put(g, P0, 'Gutter Palace', 'base');
    for (let i = 0; i < 4; i++) put(g, P0, 'V(1)', BF_A);
    control(g, BF_A, P0);
    for (let i = 0; i < cards; i++) hand(g, P0, 'V(1)');
    g = endTurn(g, P1);
    g = drive(g, ['first', 'first'], x => x.phase === 'gameOver' || x.activePlayer === P0 && x.pending?.kind === 'mainAction');
    return g;
  };
  assert.equal(run(5).winner, null, '5 cards: no win');
  assert.equal(run(4).winner, P0, 'exactly 4 cards and 4 units: win');
});

test('RJ#12479 Akali, Silent played while the opponent\'s Vex, Apathetic is at a battlefield is stunned (Vex doesn\'t choose her)', () => {
  let g = S0(); fundAll(g, P0, 8);
  put(g, P1, 'Vex, Apathetic', BF_B); control(g, BF_B, P1);
  const ak = hand(g, P0, 'Akali, Silent');
  g = drive(act(g, { type: 'playCard', player: P0, obj: ak, destination: 'base' }), [], x => x.pending?.kind === 'mainAction');
  assert.equal(g.objects[ak].stunned, true);
});

test('RJ#12481 / RJ#12482 / RJ#12483 defending Trusty Ramhound (3 with an ally) takes 2 while its ally takes lethal: the kill check sees 3 Might, then the combat heal clears it → Ramhound lives', () => {
  let g = S0();
  const rh = put(g, P1, 'Trusty Ramhound', BF_A), al = put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  assert.equal(mightOf(g, rh), 3);
  const a = put(g, P0, 'V(3)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 10 && g.pending?.kind !== 'assignDamage'; i++) g = act(g, { type: 'pass', player: g.pending!.player });
  expectPending(g, 'assignDamage', P0);
  g = drive(act(g, { type: 'assignDamage', player: P0, assignment: { [al]: 1, [rh]: 2 } }), [], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, al), 'trash');
  assert.equal(zone(g, rh), 'battlefield', 'Ramhound survives');
  assert.equal(g.objects[rh].damage ?? 0, 0, 'healed');
});

test('RJ#12485 Ezreal, Prodigy also reduces the Repeat granted by Temporal Portal (an optional additional cost) by [1] or [A]', () => {
  const run = (ez: boolean) => {
    let g = S0(); fundAll(g, P0, 6);
    const tp = put(g, P0, 'Temporal Portal', 'base');
    if (ez) put(g, P0, 'Ezreal, Prodigy', 'base');
    const e = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
    g = drive(act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === tp)!), [], x => x.pending?.kind === 'mainAction');
    const n = g.log.length;
    g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Void Seeker') });
    for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
      const d = g.pending; if (!d.inStep) { g = act(g, { type: 'pass', player: d.player }); continue; }
      const o = (d.options ?? []).map(y => y.id);
      g = ans(g, d.kind === 'optional' ? 'yes' : o.includes(e) ? [e] : o.includes('yes') ? 'yes' : o[0]);
    }
    const pays = g.log.slice(n).filter(l => /^P0 pays/.test(l.text)).map(l => l.text);
    const total = pays.reduce((s, t) => { const p = t.replace(/^P0 pays /, '').split(' '); return s + Number(p[0]) + p.slice(1).length; }, 0);
    return { total, dmg: g.objects[e].damage ?? 0 };
  };
  const no = run(false), yes = run(true);
  assert.equal(no.dmg, 8, 'repeated (4 + 4)'); assert.equal(yes.dmg, 8);
  assert.equal(yes.total, no.total - 1, 'Ezreal reduces the granted Repeat by one resource');
});

test('RJ#12487 a non-token unit copying Ekko, Recurrent (Shady Spectacles) dies: "Recycle me" is paid with the real card → runes readied', () => {
  let g = S0(); fundAll(g, P0, 3);
  put(g, P0, 'Ekko, Recurrent', 'base');
  const x = put(g, P0, 'Soaring Scout', BF_A); control(g, BF_A, P0);
  attachNow(g, put(g, P0, 'Shady Spectacles', 'base'), x); g.timestamp++;
  assert.equal(chars(g, x).name, 'Ekko');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Falling Comet') });
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending; if (!d.inStep) { g = act(g, { type: 'pass', player: d.player }); continue; }
    const o = (d.options ?? []).map(y => y.id);
    g = ans(g, d.kind === 'optional' ? 'yes' : o.includes(x) ? [x] : o.includes('yes') ? 'yes' : o[0]);
  }
  assert.ok(g.objects[x].zone !== 'battlefield', 'died');
  assert.equal(g.objects[x].zone, 'mainDeck', 'recycled');
  assert.equal(g.players[P0].runesInPlay.filter(id => g.objects[id].exhausted).length, 0, 'runes readied');
});

test('RJ#12490 Public Execution played from the trash for its Flow cost can still be Defied (printed cost [2][A]) and is then banished', () => {
  let g = S0(); fundAll(g, P0, 8); fundAll(g, P1);
  const f = put(g, P0, 'V(4)', 'base'); const e = put(g, P1, 'V(2)', 'base');
  const pe = put(g, P0, 'Public Execution', 'trash');
  assert.ok(canPlayNow(g, P0, pe), 'Flow');
  g = drive(act(g, { type: 'playCard', player: P0, obj: pe }), [[f], [e]], x => x.pending?.player === P1 && !x.pending.inStep);
  const df = hand(g, P1, 'Defy');
  assert.ok(canPlayNow(g, P1, df), 'Defy checks the printed cost, not the Flow cost paid');
  g = drive(act(g, { type: 'playCard', player: P1, obj: df }), ['first'], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, pe), 'banishment'); assert.equal(zone(g, e), 'base');
});

test('RJ#12491 Field Musicians may give its own "When you play me" +3 to itself', () => {
  let g = S0(); fundAll(g, P0);
  const fm = hand(g, P0, 'Field Musicians');
  g = act(g, { type: 'playCard', player: P0, obj: fm, destination: 'base' });
  g = drive(g, [[fm]], x => x.pending?.kind === 'mainAction');
  assert.equal(mightOf(g, fm), 6);
});

test('RJ#12492 Morgana, Vindictive can be ambushed in response to the Rogue Assassin activation (empowered Akali, Deadly Weapon still there), not in response to Akali\'s move trigger after she left', () => {
  const setup = () => {
    let g = S0(); fundAll(g, P0, 8);
    const leg = setLegend(g, P0, 'Rogue Assassin');
    const e = put(g, P1, 'V(6)', BF_A); control(g, BF_A, P1);
    const ak = put(g, P0, 'Akali, Deadly Weapon', 'base'); g.objects[ak].empowered = 1; g.timestamp++;
    const mo = hand(g, P0, 'Morgana, Vindictive');
    g = move(g, P0, [ak], BF_A);
    g = drive(g, ['yes', [e], 'first'], x => x.pending?.kind === 'showdownAction' && x.pending.player === P0 && x.chain.length === 0);
    return { g, leg, ak, mo, e };
  };
  let { g, leg, ak, mo, e } = setup();
  assert.equal(g.objects[e].damage, 2, 'first move trigger: 2');
  g = drive(act(g, legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === leg)!), [[ak]], x => !x.pending?.inStep);
  assert.ok(canPlayNow(g, P0, mo, BF_A), 'in response to the legend\'s ability: Akali still there');
  ({ g, leg, ak, mo, e } = setup());
  g = drive(act(g, legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === leg)!), [[ak]], x => x.pending?.player === P1 && !x.pending.inStep);
  g = drive(g, ['yes', [e]], x => locOf(x, ak) === 'base' && !x.pending?.inStep && x.chain.length > 0);
  assert.equal(locOf(g, ak), 'base');
  if (g.pending?.player !== P0) g = act(g, { type: 'pass', player: g.pending!.player });
  assert.ok(g.chain.length > 0 && g.pending?.player === P0 && !g.pending.inStep, 'I have priority with Akali\'s move trigger on the chain');
  assert.ok(!canPlayNow(g, P0, mo, BF_A), 'after Akali left: no unit of mine there, no Ambush');
});

test('RJ#12493 / RJ#12494 / RJ#12495 / RJ#12496 Shady Spectacles makes a 1-Might unit a copy of a 5-Might unit: it becomes Mighty (Grand Duelist triggers; channel 1)', () => {
  let g = S0(); fundAll(g, P0);
  setLegend(g, P0, 'Grand Duelist');
  const u = put(g, P0, 'V(1)', 'base'); const big = put(g, P0, 'V(5)', 'base');
  const sp = put(g, P0, 'Shady Spectacles', 'base');
  g = act(g, { type: 'activate', player: P0, obj: sp, abilityIndex: EQUIP });
  g = drive(g, [[u], [big]], x => x.pending?.kind === 'optional' || x.pending?.kind === 'mainAction');
  assert.equal(mightOf(g, u), 5, 'copied 5 Might');
  assert.equal(g.pending?.kind, 'optional', 'Grand Duelist offered');
  assert.match(g.pending!.prompt, /Grand Duelist/);
  const runes0 = g.players[P0].runesInPlay.length;
  g = drive(g, ['yes'], x => x.pending?.kind === 'mainAction');
  assert.equal(g.players[P0].runesInPlay.length, runes0 + 1, 'channelled 1');
});

test('RJ#12497 / RJ#12498 a Reflection token played by Mirror Image is not a card: Mirror Image (first card) triggers Astral Heron, the token neither triggers nor uses up the discount', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  put(g, P0, 'Astral Heron', BF_A); control(g, BF_A, P0);
  const x = put(g, P0, 'V(3)', 'base');
  const st = hand(g, P0, 'Stupefy');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Mirror Image') }), [[x]], y => y.pending?.kind === 'mainAction');
  assert.equal(unitsNamed(g, 'Reflection').length, 1, 'Reflection played');
  assert.equal(g.log.filter(l => /^Trigger: Astral Heron/.test(l.text)).length, 1, 'one Heron trigger (Mirror Image only)');
  assert.equal(playCostOf(g, P0, st)!.energy, 0, 'discount still available for the next real card');
});

test('RJ#12500 conquering an empty battlefield is not winning a combat: Draven, Vanquisher\'s "When I win a combat" doesn\'t trigger', () => {
  let g = withTokens(S0());
  const d = put(g, P0, 'Draven, Vanquisher', 'base');
  g = drive(move(g, P0, [d], BF_A), ['no', 'no'], x => x.pending?.kind === 'mainAction');
  assert.equal(g.battlefields[BF_A].controller, P0, 'conquered');
  assert.equal(unitsNamed(g, 'Gold').length, 0, 'no Gold token');
  assert.ok(!g.log.some(l => /Trigger: Draven/.test(l.text) && /win/i.test(l.text)));
});

test('RJ#12501 En Garde in response to Azir, Sovereign\'s attack trigger resolves first: Azir is alone there → +2; then the chosen tokens move in', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const t = put(g, P0, 'Recruit', 'base', { token: true });
  const az = put(g, P0, 'Azir, Sovereign', 'base');
  g = move(g, P0, [az], BF_A);
  for (let i = 0; i < 12 && !(g.pending?.player === P0 && !g.pending.inStep && g.chain.some(c => g.objects[c.source]?.cardId && g.cards[g.objects[c.source].cardId].name === 'Azir')); i++) {
    const d = g.pending!;
    if (!d.inStep) { g = act(g, { type: 'pass', player: d.player }); continue; }
    g = ans(g, d.kind === 'optional' ? 'yes' : d.options!.some(o => o.id === t) ? [t] : d.options![0].id);
  }
  assert.equal(locOf(g, t), 'base', 'tokens not yet moved');
  const m0 = mightOf(g, az);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'En Garde') });
  g = drive(g, [[az]], x => locOf(x, t) === BF_A || x.pending?.kind === 'assignDamage');
  assert.equal(mightOf(g, az), m0 + 2, 'alone when En Garde resolved: +1 +1');
  assert.equal(locOf(g, t), BF_A, 'then the token moved in');
});

test('RJ#12503 Jhin, Meticulous Killer ("you may play me for [C]") has no Reaction/Ambush: not playable on the opponent\'s turn even when the condition is met', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 8); fundAll(g, P1);
  const j = hand(g, P0, 'Jhin, Meticulous Killer');
  const u = put(g, P1, 'V(1)', 'base');
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Cleave') }), [[u]], x => x.pending?.player === P0 && !x.pending.inStep);
  assert.equal(canPlayNow(g, P0, j), false);
});

test('RJ#12507 Katarina, Reckless\'s "When you play a card from face down, deal 2 to an enemy unit" isn\'t limited to the hidden card\'s battlefield (an enemy in base can be chosen)', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'Katarina, Reckless', 'base');
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const h = put(g, P0, 'Sudden Storm', { facedown: BF_A });
  const eb = put(g, P1, 'V(3)', 'base'); const ef = put(g, P1, 'V(5)', BF_B); control(g, BF_B, P1);
  g = act(g, { type: 'playCard', player: P0, obj: h });
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending; if (!d.inStep) { g = act(g, { type: 'pass', player: d.player }); continue; }
    const o = (d.options ?? []).map(y => y.id);
    // Sudden Storm can only choose a unit at a battlefield (ef); Katarina's trigger may choose the unit in base (eb)
    g = ans(g, d.kind === 'optional' ? 'yes' : o.includes(eb) ? [eb] : o.includes(ef) ? [ef] : o[0]);
  }
  assert.equal(g.objects[eb].damage ?? 0, 2, 'Katarina hit the unit in base');
});

test('RJ#12509 Hostile Takeover on an enemy unit at a battlefield where they still have units: the combat opens in the cleanup right after it resolves — no main-phase window to move more units in', () => {
  let g = S0(); fundAll(g, P0, 8);
  const e1 = put(g, P1, 'V(2)', BF_A); put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const mine = put(g, P0, 'V(3)', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Hostile Takeover') });
  g = drive(g, [[e1]], x => x.chain.length === 0 && !x.pending?.inStep);
  assert.equal(g.objects[e1].controller, P0);
  assert.ok(g.showdown?.isCombat, 'combat already open');
  assert.notEqual(g.pending?.kind, 'mainAction');
  assert.deepEqual(moveDests(g, P0, mine), [], 'no standard move into it');
});

test('RJ#12510 (MISMATCH-RJ) Flurry of Blades kills all my units at Moonfall\'s chosen battlefield in response: the battlefield no longer meets "where you have units" → illegal target, no -2 (CR 359.3.e.2)', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(5)', BF_A);
  const pulled = put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Moonfall') });
  for (let i = 0; i < 6 && g.pending?.inStep && g.pending.player === P0; i++) { const d = g.pending; const o = (d.options ?? []).map(y => y.id); g = ans(g, o.includes(pulled) ? [pulled] : o.includes(String(BF_A)) ? String(BF_A) : o.includes(g.battlefields[BF_A].objId) ? g.battlefields[BF_A].objId : o[0]); }
  g = drive(g, [], x => x.pending?.player === P1 && !x.pending.inStep);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Flurry of Blades') });
  g = drive(g, [], x => x.chain.length === 0 && !x.pending?.inStep);
  assert.equal(zone(g, pulled), 'trash', 'the chosen 1-Might enemy died to Flurry: no move');
  assert.equal(mightOf(g, e), 5, 'no -2: "there" refers to an illegal target (CR 359.3.e.2, 359.3.e.12); RJ said -2 still applies');
});

test('RJ#12511 a Sprite token (printed Temporary) that becomes a copy via Shady Spectacles loses Temporary (granted Temporary would stay: RJ#12414)', () => {
  let g = withTokens(S0());
  const sp = put(g, P0, 'Sprite', 'base', { token: true });
  const v = put(g, P0, 'V(4)', 'base');
  assert.ok(hasKeyword(g, sp, 'Temporary'));
  attachNow(g, put(g, P0, 'Shady Spectacles', 'base'), sp); g.timestamp++;
  assert.equal(mightOf(g, sp), mightOf(g, v), 'copy of the V(4)');
  assert.equal(hasKeyword(g, sp, 'Temporary'), false, 'printed Temporary replaced by the copy');
});

test('RJ#12512 Rek\'Sai, Breacher gives Accelerate to a unit played from face down (not from a hand)', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, "Rek'Sai, Breacher", 'base');
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const tw = put(g, P0, 'Tornado Warrior', { facedown: BF_A });
  g = act(g, { type: 'playCard', player: P0, obj: tw });
  g = drive(g, [], x => x.pending?.kind === 'optional' && /Accelerate/.test(x.pending.prompt ?? '') || x.pending?.kind === 'mainAction');
  assert.match(g.pending?.prompt ?? '', /Accelerate/, 'Accelerate offered');
  g = drive(g, ['yes', 'no', 'no'], x => x.pending?.kind === 'mainAction');
  assert.equal(g.objects[tw].exhausted, false, 'paid → enters ready');
});

test('RJ#12513 Temporal Breach on my unit controlled by the opponent at a battlefield they control: I (owner) play it back to that battlefield → contested, showdown', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const u = put(g, P0, 'V(3)', BF_A, { controller: P1 });
  assert.equal(g.objects[u].controller, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Temporal Breach') });
  g = drive(g, [[u], 'first'], x => x.chain.length === 0 && !x.pending?.inStep || x.pending?.kind === 'assignDamage');
  const nu = Object.keys(g.objects).find(id => g.cards[g.objects[id].cardId]?.name === 'V(3)' && g.objects[id].zone === 'battlefield')!;
  assert.ok(nu, 'played back to the battlefield');
  assert.equal(g.objects[nu].controller, P0); assert.equal(locOf(g, nu), BF_A);
  assert.ok(g.showdown?.isCombat || g.pending?.kind === 'assignDamage', 'combat with the opponent\'s unit there');
});

test('RJ#12514 Sanction (disempower) played in response to an end-of-turn trigger: its "Empower it at end of turn" is created after that moment → never happens', () => {
  let g = S0(); fundAll(g, P0, 8);
  const sp = put(g, P0, 'Steel Paws', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Sanction') });
  g = drive(g, [/^Empower/i, [sp]], x => x.pending?.kind === 'mainAction');
  assert.ok(g.objects[sp].empowered);
  const s2 = hand(g, P0, 'Sanction');
  g = endTurn(g, P0);
  let played = false;
  for (let i = 0; i < 40 && !(g.activePlayer === P1 && g.pending?.kind === 'mainAction'); i++) {
    const d = g.pending!;
    if (!played && d.player === P0 && !d.inStep && g.chain.length > 0 && canPlayNow(g, P0, s2)) { g = act(g, { type: 'playCard', player: P0, obj: s2 }); g = drive(g, [/^Disempower/i, [sp]], x => !x.pending?.inStep); played = true; continue; }
    if (d.inStep) { g = ans(g, d.options![0].id); continue; }
    g = act(g, { type: 'pass', player: d.player });
  }
  assert.ok(played, 'second Sanction played in response to the end-of-turn disempower');
  assert.ok(!g.objects[sp].empowered, 'stays disempowered (the delayed empower was never generated)');
  g = endTurn(g, P1); g = drive(g, [], x => x.activePlayer === P0 && x.pending?.kind === 'mainAction');
  assert.ok(!g.objects[sp].empowered, 'no empower at the opponent\'s end of turn either');
});

test('RJ#12518 The Harrowing (first card) plays Darius, Trifarian from my trash: he is my second card and on the board when it completes → +2 and readied', () => {
  let g = S0(); fundAll(g, P0, 8);
  const d = put(g, P0, 'ogn-027-298', 'trash');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'The Harrowing') });
  g = drive(g, [[d], 'base', 'first', 'first'], x => x.pending?.kind === 'mainAction');
  assert.equal(locOf(g, d), 'base');
  assert.equal(g.objects[d].exhausted, false, 'readied');
  assert.equal(mightOf(g, d), 7);
});

test('RJ#12520 empowered Mel + my Switcheroo (5 ↔ 2): the higher unit\'s decrease gets an extra -1 (5 → 1), the increase is unchanged (2 → 5)', () => {
  let g = S0(); fundAll(g, P0);
  const mel = put(g, P0, 'Mel, Newly Awakened', 'base'); g.objects[mel].empowered = 3; g.timestamp++;
  const a = put(g, P0, 'V(5)', BF_A), b = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P0);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Switcheroo') }), [[a, b]], x => x.pending?.kind === 'mainAction' || x.pending?.kind === 'assignDamage' || !!x.showdown);
  assert.equal(mightOf(g, b), 5, 'increase unchanged');
  assert.equal(mightOf(g, a), 1, '-3 -1');
});

test('RJ#12521 Shady Spectacles copies tags and text: Plaza Guardian copying Breakneck Mech gives my Mechs a second Deflect + Ganking; Breakneck Mech copying Plaza Guardian loses its Mech aura', () => {
  const run = (equipped: string, copied: string) => {
    let g = S0(); fundAll(g, P0);
    const ids: Record<string, string> = { bm: put(g, P0, 'Breakneck Mech', 'base'), pg: put(g, P0, 'Plaza Guardian', 'base') };
    const other = put(g, P0, 'Mega-Mech', 'base');
    const sp = put(g, P0, 'Shady Spectacles', 'base');
    g = drive(act(g, { type: 'activate', player: P0, obj: sp, abilityIndex: EQUIP }), [[ids[equipped]], [ids[copied]]], x => x.pending?.kind === 'mainAction');
    return { g, other, eq: ids[equipped] };
  };
  const a = run('pg', 'bm');
  assert.equal(chars(a.g, a.eq).name, 'Breakneck Mech');
  assert.equal(kwValue(a.g, a.other, 'Deflect'), 2, 'two auras: Deflect 2');
  assert.ok(hasKeyword(a.g, a.other, 'Ganking'));
  const b = run('bm', 'pg');
  assert.equal(chars(b.g, b.eq).name, 'Plaza Guardian');
  assert.ok(chars(b.g, b.eq).tags.includes('Mech'), 'still a Mech (copied tags)');
  assert.equal(hasKeyword(b.g, b.other, 'Ganking'), false, 'Breakneck\'s aura is gone');
});

test('RJ#12523 Teemo, Strategist\'s defend trigger chooses the enemy unit when it goes on the chain; the attacker may respond with Discipline before it resolves', () => {
  let g = S0(); fundAll(g, P0);
  const tm = put(g, P1, 'Teemo, Strategist', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(3)', 'base');
  g = move(g, P0, [a], BF_A);
  g = drive(g, [[a], 'first'], x => x.pending?.player === P0 && !x.pending.inStep && x.chain.some(c => c.source === tm));
  expectPending(g, 'chainResponse', P0);
  const di = hand(g, P0, 'Discipline');
  assert.ok(canPlayNow(g, P0, di), 'Discipline in response to the trigger');
  g = drive(act(g, { type: 'playCard', player: P0, obj: di }), [[a]], x => !x.chain.some(c => c.source === tm) || x.pending?.kind === 'assignDamage');
  assert.equal(mightOf(g, a), 5, 'buffed before Teemo\'s damage');
});

test('RJ#12524 empowered Akali, Deadly Weapon moving onto a lone Overzealous Fan: her 2 kills it in the cleanup before the showdown → no combat, no Fan trigger, conquer', () => {
  let g = S0();
  const f = put(g, P1, 'Overzealous Fan', BF_A); control(g, BF_A, P1);
  const ak = put(g, P0, 'Akali, Deadly Weapon', 'base'); g.objects[ak].empowered = 1; g.timestamp++;
  g = move(g, P0, [ak], BF_A);
  g = drive(g, ['yes', [f]], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, f), 'trash');
  assert.equal(locOf(g, ak), BF_A, 'Akali not moved back by the Fan');
  assert.equal(g.battlefields[BF_A].controller, P0);
});

test('RJ#12526 Bullet Time (all enemy units at a chosen battlefield) damages Baron Nashor there: the battlefield is chosen, not Baron', () => {
  let g = S0(); fundAll(g, P0);
  const b = put(g, P1, 'Baron Nashor', BF_A); control(g, BF_A, P1);
  put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Bullet Time') });
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending; if (!d.inStep) { g = act(g, { type: 'pass', player: d.player }); continue; }
    const o = (d.options ?? []).map(y => y.id);
    g = ans(g, d.kind === 'chooseNumber' ? '2' : o.includes(g.battlefields[BF_A].objId) ? g.battlefields[BF_A].objId : o[0]);
  }
  assert.equal(g.objects[b].damage ?? 0, 2, 'Baron took 2');
});

test('RJ#12530 / RJ#12532 Switcheroo at Forbidding Waste: lone defender 3-2 = 1 vs attacker 5 → swapped current Mights 5 / 1; the -2 is counted once (keeps applying, swap modifier sized for it)', () => {
  let g = S0(); fundAll(g, P0);
  setBattlefieldCard(g, BF_A, 'Forbidding Waste');
  const d = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(5)', 'base');
  g = move(g, P0, [a], BF_A);
  g = drive(g, [], x => x.pending?.kind === 'showdownAction' && x.pending.player === P0 && x.chain.length === 0);
  assert.equal(mightOf(g, d), 1, 'defending alone: -2');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Switcheroo') }), [[a, d]], x => x.chain.length === 0 && x.pending?.kind !== 'chainResponse');
  assert.equal(mightOf(g, a), 1);
  assert.equal(mightOf(g, d), 5, 'not 3: the Waste\'s -2 is already in the swapped value');
});

test('RJ#12535 the opponent\'s Temporal Breach on my token unit with Soul Sword attached: the token ceases to exist (not played back); the Sword stays mine and is recalled to my base', () => {
  let g = withTokens(S0({ tp: P1 })); fundAll(g, P1);
  const t = put(g, P0, 'Recruit', BF_A, { token: true }); put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const sw = put(g, P0, 'Soul Sword', 'base'); attachNow(g, sw, t);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Temporal Breach') });
  g = drive(g, [[t], 'first'], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, t), 'gone', 'token gone for good');
  assert.equal(unitsNamed(g, 'Recruit').length, 0);
  assert.equal(zone(g, sw), 'base'); assert.equal(g.objects[sw].controller ?? g.objects[sw].owner, P0);
  assert.ok(!g.objects[sw].attachedTo, 'unattached');
});

test('RJ#12536 Emperor of the Sands: only the Sand Soldier being played gets a Weaponmaster trigger; Sand Soldiers already on the board don\'t', () => {
  let g = withTokens(S0()); fundAll(g, P0, 6);
  const leg = setLegend(g, P0, 'Emperor of the Sands');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Soul Sword') }), [], x => x.pending?.kind === 'mainAction');
  const wmCount = (x: import('../conformance/harness.ts').GameState, from: number) => x.log.slice(from).filter(l => /Weaponmaster/i.test(l.text)).length;
  const activateLegend = (x: import('../conformance/harness.ts').GameState) => {
    const ab = legal(x, P0, 'activate').find(a => a.type === 'activate' && a.obj === leg);
    assert.ok(ab, 'legend usable after playing an Equipment');
    x = act(x, ab!);
    for (let i = 0; i < 20 && x.pending && x.pending.kind !== 'mainAction'; i++) {
      const d = x.pending; if (!d.inStep) { x = act(x, { type: 'pass', player: d.player }); continue; }
      x = ans(x, d.kind === 'optional' ? 'no' : d.options!.some(o => o.id === 'no') ? 'no' : d.options![0].id);
    }
    return x;
  };
  const n1 = g.log.length;
  g = activateLegend(g);
  assert.equal(unitsNamed(g, 'Sand Soldier').length, 1);
  const first = wmCount(g, n1);
  assert.ok(first >= 1, 'the played Sand Soldier\'s Weaponmaster');
  g.objects[leg].exhausted = false; g.timestamp++;
  const n2 = g.log.length;
  g = activateLegend(g);
  assert.equal(unitsNamed(g, 'Sand Soldier').length, 2);
  assert.equal(wmCount(g, n2), first, 'same amount as for one Sand Soldier: the one already on the board didn\'t trigger');
});

function jayceKills(killGold: boolean) {
  let g = withTokens(S0()); fundAll(g, P0);
  const gold = put(g, P0, 'unl-t05', 'base', { token: true });
  const other = put(g, P0, 'Vanguard Armory', 'base');
  const va = put(g, P0, 'Vanguard Armory', 'hand');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'sfd-084-221'), destination: 'base' });
  g = drive(g, [[killGold ? gold : other]], x => x.pending?.kind === 'mainAction');
  setRunes(g, P0, 0);
  return { g, gold, va };
}
test('RJ#12537 Jayce, Man of Progress killing a Gold token gives no Power; with another gear killed, the Gold\'s [Add] pays Vanguard Armory\'s Power (Energy ignored)', () => {
  let { g, gold, va } = jayceKills(true);
  assert.equal(zone(g, gold), 'gone');
  assert.deepEqual(g.players[P0].pool.power, {}, 'no Power from the killed Gold');
  assert.ok(validateAction(g, { type: 'playCard', player: P0, obj: va }), 'Armory unpayable without Power');
  ({ g, gold, va } = jayceKills(false));
  g = drive(act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === gold)!), ['first'], x => x.pending?.kind === 'mainAction');
  assert.equal(Object.values(g.players[P0].pool.power).reduce((s, n) => s + (n ?? 0), 0), 1, 'Gold added 1 Power');
  assert.equal(validateAction(g, { type: 'playCard', player: P0, obj: va }), null);
  g = drive(act(g, { type: 'playCard', player: P0, obj: va }), [], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, va), 'base');
});

test('RJ#12540 attacker\'s Hidden Blade kills my only defender in the combat showdown: after it resolves I get focus and may Ambush Rengar, Trophy Hunter there (enemy units present)', () => {
  let { g, def } = attackSetup(['V(3)'], ['V(2)']);
  fundAll(g, P0); fundAll(g, P1);
  const r = put(g, P1, 'unl-120-219', 'hand');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Hidden Blade') }), [[def[0]]], x => x.chain.length === 0 && !x.pending?.inStep);
  assert.equal(zone(g, def[0]), 'trash');
  expectPending(g, 'showdownAction', P1);
  assert.ok(g.showdown, 'the showdown goes on');
  assert.equal(validateAction(g, { type: 'playCard', player: P1, obj: r, destination: BF_A }), null, 'Rengar playable to the battlefield');
  g = drive(act(g, { type: 'playCard', player: P1, obj: r, destination: BF_A }), [], x => x.pending?.kind === 'assignDamage' || x.pending?.kind === 'mainAction');
  assert.equal(locOf(g, r), BF_A);
});

test('RJ#12543 attacking the opponent\'s Elder Dragon; they react with Flurry of Blades: their 1 damage kills my attacker in the cleanup, before any combat damage is assigned', () => {
  let { g, atk, def } = attackSetup(['V(5)'], ['unl-118-219']);
  fundAll(g, P0); fundAll(g, P1);
  g = act(g, { type: 'pass', player: P0 });
  expectPending(g, 'showdownAction', P1);
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Flurry of Blades') }), [], x => x.pending?.kind === 'assignDamage' || x.pending?.kind === 'mainAction');
  assert.notEqual(g.pending?.kind, 'assignDamage', 'no combat damage step');
  assert.equal(zone(g, atk[0]), 'trash', 'killed by the Flurry (Elder Dragon\'s controller\'s damage)');
  assert.equal(zone(g, def[0]), 'battlefield');
  assert.equal(g.battlefields[BF_A].controller, P1);
});

test('RJ#12544 Ezreal, Dashing attacks a lone Scuttle Crab: Rengar, Trophy Hunter may Ambush in (in response to the trigger or after the Crab dies); the trigger keeps its Crab target and doesn\'t fire again', () => {
  const setup = () => {
    let g = S0(); fundAll(g, P1);
    const c = put(g, P1, 'Scuttle Crab', BF_A); control(g, BF_A, P1);
    const ez = put(g, P0, 'sfd-082-221', 'base');
    const r = put(g, P1, 'unl-120-219', 'hand');
    g = move(g, P0, [ez], BF_A);
    return { g, c, ez, r };
  };
  // in response to the attack trigger
  let { g, c, r } = setup();
  g = drive(g, [], x => x.pending?.player === P1 && !x.pending.inStep && x.chain.length > 0);
  assert.deepEqual(chainLabels(g), ['trigger:Ezreal']);
  g = act(g, { type: 'playCard', player: P1, obj: r, destination: BF_A });
  g = drive(g, [], x => x.pending?.kind === 'assignDamage' || x.pending?.kind === 'mainAction' || (x.chain.length === 0 && x.pending?.kind === 'showdownAction'));
  assert.equal(zone(g, c), 'trash', 'locked target: the Crab');
  assert.equal(g.objects[r].damage ?? 0, 0, 'Rengar not dealt the trigger damage');
  // after the Crab died
  ({ g, c, r } = setup());
  g = drive(g, [], x => x.pending?.kind === 'showdownAction' && x.pending.player === P1 && x.chain.length === 0);
  assert.equal(zone(g, c), 'trash');
  const n = g.log.length;
  g = drive(act(g, { type: 'playCard', player: P1, obj: r, destination: BF_A }), [], x => x.pending?.kind === 'assignDamage' || x.pending?.kind === 'mainAction');
  assert.equal(locOf(g, r), BF_A);
  assert.equal(g.objects[r].damage ?? 0, 0, 'no second Ezreal trigger');
  assert.ok(!g.log.slice(n).some(l => /Ezreal/.test(l.text) && /trigger/i.test(l.text) && /deal/i.test(l.text)), 'no new attack trigger');
});

test('RJ#12545 Star-Crossed (friendly + enemy) with the enemy target Temporal Breached in response: it still returns my unit; the replayed enemy is a new object and stays', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const tb = put(g, P1, 'Temporal Breach', { facedown: BF_A });
  const a = put(g, P0, 'V(2)', BF_B); control(g, BF_B, P0);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Star-Crossed') });
  g = drive(g, [[a], [e]], x => x.pending?.player === P1 && !x.pending.inStep);
  g = drive(act(g, { type: 'playCard', player: P1, obj: tb }), [[e]], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, a), 'hand', 'remaining legal target returned');
  assert.equal(unitsNamed(g, 'V(3)').length, 1, 'replayed enemy unit still on the board');
  assert.equal(locOf(g, unitsNamed(g, 'V(3)')[0]), BF_A);
  assert.equal(g.players[P1].hand.length, 0);
});

test('RJ#12548 empowered Akali, Deadly Weapon attacks (2 damage), then Rogue Assassin moves her to base in the showdown (2 more): the 5-Might defender survives and is healed by the combat cleanup', () => {
  let g = S0(); fundAll(g, P0);
  const leg = setLegend(g, P0, 'Rogue Assassin');
  const d = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const ak = put(g, P0, 'Akali, Deadly Weapon', 'base'); g.objects[ak].empowered = 1; g.timestamp++;
  g = move(g, P0, [ak], BF_A);
  g = drive(g, ['yes', [d]], x => x.pending?.kind === 'showdownAction' && x.pending.player === P0 && x.chain.length === 0);
  assert.equal(g.objects[d].damage, 2);
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === leg)!);
  g = drive(g, ['yes', [d]], x => x.pending?.kind === 'showdownAction' && x.chain.length === 0);
  assert.equal(locOf(g, ak), 'base');
  assert.equal(g.objects[d].damage, 4, '2 + 2 marked');
  g = drive(g, [], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, d), 'battlefield');
  assert.equal(g.objects[d].damage, 0, 'healed by the combat cleanup');
});

test('RJ#12549 Akali, Deadly Weapon moves in (1 damage trigger on the chain), Flash moves her back out in response (1 more): no combat ever opens, so the 2 damage stays marked', () => {
  let g = S0(); fundAll(g, P0);
  const d = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const ak = put(g, P0, 'Akali, Deadly Weapon', 'base');
  g = move(g, P0, [ak], BF_A);
  g = drive(g, ['yes', [d]], x => x.pending?.player === P0 && !x.pending.inStep && x.chain.length > 0);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Flash') }), [[ak], 'yes', [d]], x => x.pending?.kind === 'mainAction');
  assert.equal(locOf(g, ak), 'base');
  assert.ok(!g.showdown);
  assert.equal(g.objects[d].damage, 2, 'not healed (no combat cleanup)');
});

test('RJ#12551 Fiora, Worthy\'s trigger works in a showdown: my exhausted 3-Might attacker made Mighty by Discipline → pay [C], it readies', () => {
  let { g, atk } = attackSetup(['V(3)'], ['V(2)']);
  fundAll(g, P0);
  put(g, P0, 'sfd-180-221', 'base');
  assert.ok(g.objects[atk[0]].exhausted);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Discipline') }), [[atk[0]], 'yes'], x => x.pending?.kind === 'showdownAction' && x.chain.length === 0);
  assert.ok(g.showdown, 'still in the showdown');
  assert.equal(mightOf(g, atk[0]), 5);
  assert.equal(g.objects[atk[0]].exhausted, false, 'readied by Fiora, Worthy');
});

test('RJ#12554 Fiora, Worthy has no per-turn limit: two units becoming Mighty one after the other each trigger it (pay [C] each, both ready); a unit entering at 5 doesn\'t', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'sfd-180-221', 'base');
  const a = put(g, P0, 'V(3)', 'base'), b = put(g, P0, 'V(3)', 'base');
  g.objects[a].exhausted = true; g.objects[b].exhausted = true; g.timestamp++;
  for (const u of [a, b]) g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Discipline') }), [[u], 'yes'], x => x.pending?.kind === 'mainAction');
  assert.equal(g.objects[a].exhausted, false);
  assert.equal(g.objects[b].exhausted, false);
  const n = g.log.length;
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'V(5)'), destination: 'base' }), [], x => x.pending?.kind === 'mainAction' || x.pending?.kind === 'optional');
  assert.notEqual(g.pending?.kind, 'optional', 'no Fiora trigger for a unit entering Mighty');
  assert.ok(!g.log.slice(n).some(l => /Fiora/.test(l.text)));
});

test('RJ#12555 opponent kills my lone defender at Zaun Warrens and conquers; I Ambush Rengar, Trophy Hunter in response to the conquer trigger: Defender designation + Mask of Foresight (7), then he attacks alone in the new combat (8)', () => {
  let g = S0(); fundAll(g, P1);
  setBattlefieldCard(g, BF_A, 'Zaun Warrens');
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  put(g, P1, 'Mask of Foresight', 'base');
  const r = put(g, P1, 'unl-120-219', 'hand');
  put(g, P1, 'V(1)', 'hand');
  const a = put(g, P0, 'V(4)', 'base');
  g = move(g, P0, [a], BF_A);
  g = drive(g, [], x => x.pending?.player === P1 && !x.pending.inStep && chainLabels(x).includes('trigger:Zaun Warrens'));
  assert.equal(g.battlefields[BF_A].controller, P0, 'conquered');
  g = act(g, { type: 'playCard', player: P1, obj: r, destination: BF_A });
  g = drive(g, ['first'], x => !chainLabels(x).includes('trigger:Zaun Warrens'));
  assert.equal(mightOf(g, r), 7, 'defended alone: +1');
  g = drive(g, ['first'], x => x.pending?.kind === 'showdownAction');
  assert.equal(mightOf(g, r), 8, 'attacks alone in the new combat: +1 more');
});

test('RJ#12556 my Irresistible Faefolk pulls an enemy Akali, Deadly Weapon in; with her damage trigger (targeting the Faefolk) on the chain I may Ambush Soulspinner there; the Faefolk still dies', () => {
  let g = S0(); fundAll(g, P0);
  const ff = put(g, P0, 'Irresistible Faefolk', 'base');
  const ak = put(g, P1, 'Akali, Deadly Weapon', 'base');
  const ss = put(g, P0, 'Soulspinner', 'hand');
  g = move(g, P0, [ff], BF_A);
  g = drive(g, [[ak], 'yes', [ff]], x => x.pending?.player === P0 && !x.pending.inStep && chainLabels(x).includes('trigger:Akali'));
  assert.equal(validateAction(g, { type: 'playCard', player: P0, obj: ss, destination: BF_A }), null, 'Ambush window before the damage');
  g = drive(act(g, { type: 'playCard', player: P0, obj: ss, destination: BF_A }), [], x => x.chain.length === 0 && !x.pending?.inStep);
  assert.equal(locOf(g, ss), BF_A);
  assert.equal(zone(g, ff), 'trash', 'locked target: the Faefolk dies in the cleanup');
});

test('RJ#12557 my 4 attacks a 2 with a hidden card; the opponent reveals Switcheroo in the combat showdown; after it resolves I get focus and Rogue Assassin pulls my unit to base: no combat damage, they keep the battlefield', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const leg = setLegend(g, P0, 'Rogue Assassin');
  const d = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const sw = put(g, P1, 'Switcheroo', { facedown: BF_A });
  const a = put(g, P0, 'V(4)', 'base');
  g = move(g, P0, [a], BF_A);
  g = drive(g, [], x => x.pending?.kind === 'showdownAction' && x.pending.player === P0);
  g = act(g, { type: 'pass', player: P0 });
  g = drive(act(g, { type: 'playCard', player: P1, obj: sw }), [[a, d]], x => x.pending?.kind === 'showdownAction' && x.chain.length === 0);
  expectPending(g, 'showdownAction', P0);
  assert.equal(mightOf(g, a), 2);
  g = drive(act(g, legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === leg)!), [], x => x.pending?.kind === 'mainAction');
  assert.equal(locOf(g, a), 'base');
  assert.equal(g.objects[d].damage ?? 0, 0);
  assert.equal(g.battlefields[BF_A].controller, P1);
});

test('RJ#12559 (AMBIGUOUS, RJ adopted) Void Hatchling applies to Double Trouble\'s "reveal a unit from among them" (a reveal from the deck): I may recycle the top card first, then it can\'t be the revealed unit', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'Void Hatchling', 'base');
  clearDeck(g, P0);
  for (const c of ['V(7)', 'V(8)', 'V(9)', 'V(6)']) put(g, P0, c, 'deckTop');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Double Trouble') });
  const prompts: string[] = [];
  let revealOpts: string[] = [];
  for (let i = 0; i < 30 && g.pending?.kind !== 'mainAction'; i++) {
    const p = g.pending!;
    if (!p.inStep) { g = act(g, { type: 'pass', player: p.player }); continue; }
    prompts.push(p.prompt ?? '');
    if (p.kind === 'chooseCards') revealOpts = p.options!.map(o => o.label);
    g = ans(g, p.kind === 'optional' ? (/repeat/i.test(p.prompt ?? '') ? 'no' : 'yes') : 'first');
  }
  assert.ok(prompts.some(p => /Hatchling|recycle it|top card/i.test(p)), 'Hatchling look/recycle offered');
  assert.ok(!revealOpts.includes('V(6)'), 'the recycled top card is gone before the reveal');
});

test('RJ#12560 Warwick, Hunter attacks: with his kill trigger on the chain, Emperor\'s Divide from hand (Action) can\'t be played; a hidden one at that battlefield can and saves my damaged unit', () => {
  const setup = () => {
    let g = S0({ tp: P1 }); fundAll(g, P0);
    const u = put(g, P0, 'V(4)', BF_A); control(g, BF_A, P0); g.objects[u].damage = 1;
    const fd = put(g, P0, "Emperor's Divide", { facedown: BF_A });
    const fromHand = put(g, P0, "Emperor's Divide", 'hand');
    const w = put(g, P1, 'ogn-159-298', 'base');
    g = move(g, P1, [w], BF_A);
    g = drive(g, [], x => x.pending?.player === P0 && !x.pending.inStep && chainLabels(x).includes('trigger:Warwick'));
    return { g, u, fd, fromHand };
  };
  let { g, u, fd, fromHand } = setup();
  assert.ok(validateAction(g, { type: 'playCard', player: P0, obj: fromHand }), 'Action from hand: not in a Closed state');
  g = drive(act(g, { type: 'playCard', player: P0, obj: fd }), [[u]], x => !chainLabels(x).includes('trigger:Warwick'));
  assert.equal(locOf(g, u), 'base', 'moved to base before the trigger resolves');
  assert.equal(zone(g, u), 'base');
  void fromHand;
});

test('RJ#12561 Akali, Deadly Weapon moving onto a lone Akali, Silent can\'t choose her (not in combat yet); pulled out by Rogue Assassin during the combat showdown, her trigger can (1), and the combat cleanup heals it', () => {
  let g = S0(); fundAll(g, P0);
  const leg = setLegend(g, P0, 'Rogue Assassin');
  const s = put(g, P1, 'ven-038-166', BF_A); control(g, BF_A, P1);
  const ak = put(g, P0, 'Akali, Deadly Weapon', 'base');
  g = move(g, P0, [ak], BF_A);
  assert.equal(g.pending?.kind, 'optional');
  g = ans(g, 'yes');
  if (g.pending?.kind === 'chooseTargets') assert.ok(!g.pending.options!.some(o => o.id === s), 'Akali, Silent not choosable');
  g = drive(g, ['first'], x => x.pending?.kind === 'showdownAction' && x.pending.player === P0 && x.chain.length === 0);
  assert.equal(g.objects[s].damage ?? 0, 0, 'no damage on arrival');
  g = act(g, legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === leg)!);
  g = drive(g, ['yes', [s]], x => x.pending?.kind === 'showdownAction' && x.chain.length === 0);
  assert.equal(locOf(g, ak), 'base');
  assert.equal(g.objects[s].damage, 1, 'in combat now: chosen');
  g = drive(g, [], x => x.pending?.kind === 'mainAction');
  assert.equal(g.objects[s].damage ?? 0, 0, 'healed');
});

test('RJ#12562 The Harrowing plays a unit from the trash without banishing it: Master of Shadows (Zed legend, "when you banish a card") is not empowered', () => {
  let g = S0(); fundAll(g, P0, 8);
  const leg = setLegend(g, P0, 'Master of Shadows');
  const u = put(g, P0, 'V(3)', 'trash');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'The Harrowing') }), [[u], 'base', 'first'], x => x.pending?.kind === 'mainAction');
  assert.equal(locOf(g, u), 'base');
  assert.ok(!g.objects[leg].empowered, 'no banish → no empower');
});

test('RJ#12563 Kennen, Storm of Shuriken conquers: a Flow spell in my trash (Brittle Steel, printed Flow [4][C]) may use Kennen\'s cheaper granted Flow ([2][A]); it is banished after resolving', () => {
  let g = S0(); fundAll(g, P0);
  const bs = put(g, P0, 'Brittle Steel', 'trash');
  const k = put(g, P0, 'Kennen, Storm of Shuriken', 'base');
  const sw = put(g, P1, 'Soul Sword', 'base');
  g = drive(move(g, P0, [k], BF_A), ['first'], x => x.pending?.kind === 'mainAction');
  setRunes(g, P0, 3, 'fury');   // enough for [2][A], not for [4][C]
  assert.equal(validateAction(g, { type: 'playCard', player: P0, obj: bs }), null);
  g = drive(act(g, { type: 'playCard', player: P0, obj: bs }), [[sw]], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, bs), 'banishment');
  assert.equal(zone(g, sw), 'trash');
});

test('RJ#12564 Kennen, Keeper of Balance played by Ava Achiever\'s attack trigger into her combat: both his play trigger and his attack trigger fire (two separate [2] stuns)', () => {
  let g = S0(); fundAll(g, P0);
  const e = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const ava = put(g, P0, 'Ava Achiever', 'base');
  const k = put(g, P0, 'Kennen, Keeper of Balance', 'hand');
  g = move(g, P0, [ava], BF_A);
  g = drive(g, ['yes', 'yes', [e], 'yes', [e]], x => chainLabels(x).filter(l => l === 'trigger:Kennen').length === 2 && !x.pending?.inStep);
  assert.equal(locOf(g, k), BF_A);
  assert.deepEqual(chainLabels(g), ['trigger:Kennen', 'trigger:Kennen'], 'play + attack instances');
});

test('RJ#12565 Jayce, Man of Progress kills my Patched Porobot (a unit and a gear) as the friendly gear: Viktor, Leader sees a non-Recruit unit die → Recruit token', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  put(g, P0, 'ogn-246-298', 'base');
  const pb = put(g, P0, 'Patched Porobot', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'sfd-084-221'), destination: 'base' });
  g = drive(g, [[pb], 'first'], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, pb), 'trash');
  assert.equal(unitsNamed(g, 'Recruit').length, 1);
});

test('RJ#12566 killing a Gold token triggers neither Battle Mistress ability: my Gold\'s own kill-cost isn\'t a rune recycle; an enemy Gold killed isn\'t an enemy unit dying', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  const leg = setLegend(g, P0, 'Battle Mistress');
  g.objects[leg].exhausted = true; g.timestamp++;
  const mine = put(g, P0, 'unl-t05', 'base', { token: true });
  const theirs = put(g, P1, 'unl-t05', 'base', { token: true });
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === mine)!);
  assert.notEqual(g.pending?.kind, 'optional', 'no recycle trigger');
  g = drive(g, ['first'], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, mine), 'gone');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Brittle Steel') }), [[theirs]], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, theirs), 'gone');
  assert.equal(g.objects[leg].exhausted, true, 'not readied');
});

test('RJ#12568 (AMBIGUOUS, house: last-known characteristics) a Recruit token copying a non-Recruit unit via Shady Spectacles dies: Viktor, Leader sees a non-Recruit unit die → new Recruit', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  put(g, P0, 'ogn-246-298', 'base');
  const t = put(g, P0, 'Recruit', BF_A, { token: true }); control(g, BF_A, P0);
  const big = put(g, P0, 'V(4)', 'base');
  const sp = put(g, P0, 'Shady Spectacles', 'base');
  g = drive(act(g, { type: 'activate', player: P0, obj: sp, abilityIndex: EQUIP }), [[t], [big]], x => x.pending?.kind === 'mainAction');
  assert.equal(chars(g, t).name, 'V(4)');
  assert.ok(!chars(g, t).tags.includes('Recruit'));
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'KillA') }), [[t]], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, t), 'gone');
  assert.equal(unitsNamed(g, 'Recruit').length, 1, 'Viktor made a Recruit');
});

test('RJ#12570 Star-Crossed in response to my Sprite token\'s Temporary trigger in my Beginning Phase: the Sprite goes to hand and ceases to exist, the enemy unit returns, the trigger does nothing', () => {
  let g = withTokens(S0({ tp: P1 })); fundAll(g, P0);
  const sp = put(g, P0, 'Sprite', 'base', { token: true });
  const e = put(g, P1, 'V(3)', 'base');
  g = endTurn(g, P1);
  g = drive(g, [], x => x.activePlayer === P0 && x.chain.length > 0 && x.pending?.player === P0 && !x.pending.inStep);
  assert.ok(chainLabels(g).some(l => /Sprite|Temporary/.test(l)), 'Temporary trigger on the chain');
  const sc = hand(g, P0, 'Star-Crossed'); fundAll(g, P0);
  g = drive(act(g, { type: 'playCard', player: P0, obj: sc }), [[sp], [e]], x => x.chain.length === 0 && !x.pending?.inStep);
  assert.equal(zone(g, sp), 'gone');
  assert.equal(zone(g, e), 'hand');
});

test('RJ#12573 Hostile Takeover on an exhausted enemy Irelia, Fervent: I control her when she is readied → +1 (one trigger); being chosen while the opponent controlled her gives nothing (house, RJ\'s "+2" aside not adopted)', () => {
  let g = S0(); fundAll(g, P0);
  const ir = put(g, P1, 'sfd-057-221', BF_A); control(g, BF_A, P1); g.objects[ir].exhausted = true; g.timestamp++;
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Hostile Takeover') }), [[ir]], x => x.pending?.kind === 'showdownAction' || x.pending?.kind === 'mainAction');
  assert.equal(g.objects[ir].controller, P0);
  assert.equal(g.objects[ir].exhausted, false);
  assert.equal(mightOf(g, ir), 5, '4 + 1 (readied by her new controller)');
});

test('RJ#12574 Wuju Bladesman: my lone defending Pouty Poro (2+2) → Smoke Screen resolves (-4 to min 1 snapshots -3) → Discipline +2 → Stupefy -1 = 2', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  setLegend(g, P0, 'Wuju Bladesman');
  const poro = put(g, P0, 'Pouty Poro', BF_A); control(g, BF_A, P0);
  const a = put(g, P1, 'V(3)', 'base');
  g = move(g, P1, [a], BF_A);
  g = drive(g, [], x => x.pending?.kind === 'showdownAction' && x.pending.player === P1 && x.chain.length === 0);
  assert.equal(mightOf(g, poro), 4, 'defending alone: +2');
  const cast1 = (p: typeof P0, card: string) => { g = drive(act(g, { type: 'playCard', player: p, obj: hand(g, p, card) }), [[poro], 'yes'], x => x.pending?.kind === 'showdownAction' && x.chain.length === 0); };
  cast1(P1, 'Smoke Screen');
  assert.equal(mightOf(g, poro), 1);
  if (g.pending?.player !== P0) g = act(g, { type: 'pass', player: g.pending!.player });
  cast1(P0, 'Discipline');
  assert.equal(mightOf(g, poro), 3);
  if (g.pending?.player !== P1) g = act(g, { type: 'pass', player: g.pending!.player });
  cast1(P1, 'Stupefy');
  assert.equal(mightOf(g, poro), 2);
});

test('RJ#12575 Wuju Bladesman + lone defending Stalwart Poro (2+2+1): chain Smoke Screen → Discipline → Stupefy resolves at full values (-4, +2, -1); after the combat it is -1, and 2 when it defends alone again', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  setLegend(g, P0, 'Wuju Bladesman');
  const poro = put(g, P0, 'Stalwart Poro', BF_A); control(g, BF_A, P0);
  const a = put(g, P1, 'V(3)', 'base'), st = put(g, P1, 'Ravenbloom Student', 'base');
  g = move(g, P1, [a], BF_A);
  g = drive(g, [], x => x.pending?.kind === 'showdownAction' && x.pending.player === P1 && x.chain.length === 0);
  assert.equal(mightOf(g, poro), 5);
  const chainOn = (p: typeof P0, card: string) => { g = drive(act(g, { type: 'playCard', player: p, obj: hand(g, p, card) }), [[poro]], x => !x.pending?.inStep); g = act(g, { type: 'pass', player: p }); };
  chainOn(P1, 'Smoke Screen'); chainOn(P0, 'Discipline');
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Stupefy') }), [[poro]], x => !x.pending?.inStep);
  assert.deepEqual(chainLabels(g), ['spell:Smoke Screen', 'spell:Discipline', 'spell:Stupefy']);
  g = drive(g, [], x => x.chain.length === 0 && x.pending?.kind === 'showdownAction');
  assert.equal(mightOf(g, poro), 2, '5 - 1 + 2 - 4');
  g.objects[a].stunned = true; g.timestamp++;   // Rune Prison on the Apprentice
  g = drive(g, [], x => x.pending?.kind === 'mainAction');
  assert.equal(locOf(g, a), 'base', 'both survive: attacker recalled');
  assert.equal(mightOf(g, poro), -1, 'designation bonuses gone: 2 + 2 - 4 - 1');
  g = drive(move(g, P1, [st], BF_A), [], x => x.pending?.kind === 'showdownAction');
  assert.equal(mightOf(g, poro), 2, 'defending alone again: +2 +1');
});

test('RJ#12580 Switcheroo between my defender and the equal attacker at Abandoned Hall: the Hall\'s trigger comes after it resolves and my unit (still mine, still there) gets +1', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0);
  setBattlefieldCard(g, BF_A, 'Abandoned Hall');
  const d = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const a = put(g, P1, 'V(3)', 'base');
  g = move(g, P1, [a], BF_A);
  g = drive(g, [], x => x.pending?.kind === 'showdownAction' && x.pending.player === P1 && x.chain.length === 0);
  g = act(g, { type: 'pass', player: P1 });
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Switcheroo') }), [[d]], x => x.pending?.kind === 'showdownAction' && x.chain.length === 0);
  assert.equal(g.objects[d].controller ?? g.objects[d].owner, P0);
  assert.equal(mightOf(g, d), 4);
  assert.equal(mightOf(g, a), 3);
});

test('RJ#12583 Shen, Leader of the Kinkou Order\'s hold trigger is respondable; its "exactly one other unit" condition was checked on triggering, so Flashing that unit away in response still scores the point', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0);
  put(g, P0, 'ven-138-166', BF_A); const o = put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const f = hand(g, P0, 'Flash');
  g = endTurn(g, P1);
  g = drive(g, ['first'], x => x.pending?.player === P0 && !x.pending.inStep && chainLabels(x).includes('trigger:Shen'));
  g = drive(act(g, { type: 'playCard', player: P0, obj: f }), [[o], 'first'], x => x.activePlayer === P0 && x.pending?.kind === 'mainAction');
  assert.equal(locOf(g, o), 'base');
  assert.equal(g.players[P0].points, 2, 'hold + Shen\'s point');
});

test('RJ#12585 Fiora, Peerless defends against two attackers (no trigger); Star-Crossed bouncing one attacker later doesn\'t create the "one on one" doubling', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0);
  const f = put(g, P0, 'sfd-110-221', BF_A); control(g, BF_A, P0);
  const mine = put(g, P0, 'V(1)', 'base');
  const a1 = put(g, P1, 'V(2)', 'base'), a2 = put(g, P1, 'V(2)', 'base');
  g = move(g, P1, [a1, a2], BF_A);
  g = drive(g, [], x => x.pending?.kind === 'showdownAction' && x.pending.player === P1 && x.chain.length === 0);
  assert.equal(mightOf(g, f), 3);
  g = act(g, { type: 'pass', player: P1 });
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Star-Crossed') }), [[mine], [a1]], x => x.chain.length === 0 && !x.pending?.inStep);
  assert.equal(zone(g, a1), 'hand');
  assert.equal(mightOf(g, f), 3, 'not doubled');
});

test('RJ#12590 defending my battlefield in a showdown: Guards! from hand (no Action/Reaction) can\'t be played; a hidden Guards! there can, its Sand Soldier joins at that battlefield', () => {
  let g = withTokens(S0({ tp: P1 })); fundAll(g, P0);
  put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const fd = put(g, P0, 'Guards!', { facedown: BF_A });
  const h = put(g, P0, 'Guards!', 'hand');
  const a = put(g, P1, 'V(3)', 'base');
  g = move(g, P1, [a], BF_A);
  g = drive(g, [], x => x.pending?.kind === 'showdownAction' && x.pending.player === P1 && x.chain.length === 0);
  g = act(g, { type: 'pass', player: P1 });
  expectPending(g, 'showdownAction', P0);
  assert.ok(validateAction(g, { type: 'playCard', player: P0, obj: h }), 'from hand: not in a showdown');
  g = drive(act(g, { type: 'playCard', player: P0, obj: fd }), ['no'], x => x.chain.length === 0 && !x.pending?.inStep);
  const ss = unitsNamed(g, 'Sand Soldier');
  assert.equal(ss.length, 1);
  assert.equal(locOf(g, ss[0]), BF_A);
});

test('RJ#12592 a Glasc Mixologist I control but the opponent owns (Kharox) dies: I control its Deathknell and play a unit from MY trash; the Mixologist goes to its owner\'s trash', () => {
  let g = S0(); fundAll(g, P0);
  const m = put(g, P1, 'Glasc Mixologist', BF_A, { controller: P0 }); control(g, BF_A, P0);
  const mine = put(g, P0, 'V(2)', 'trash');
  const theirs = put(g, P1, 'V(1)', 'trash');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'KillA') }), [], x => x.pending?.kind === 'chooseTargets');
  expectPending(g, 'chooseTargets', P0);
  assert.deepEqual(g.pending!.options!.map(o => o.id), [mine], 'only my trash');
  g = drive(g, [[mine], 'base'], x => x.pending?.kind === 'mainAction');
  assert.ok(g.players[P1].trash.includes(m), 'owner\'s trash');
  assert.equal(locOf(g, mine), 'base');
  assert.equal(zone(g, theirs), 'trash');
});

test('RJ#12593 Dusk Rose Lab\'s kill is decided at finalization (decline); hidden Smoke and Mirrors in response to the base Sprite\'s Temporary trigger swaps it with Lillia, Fae Fawn: new Sprite at the Lab, draw 1, old Sprite dies, the Lab is held', () => {
  let g = withTokens(S0({ tp: P1 })); fundAll(g, P0);
  setBattlefieldCard(g, BF_A, 'Dusk Rose Lab');
  const li = put(g, P0, 'unl-082-219', BF_A); control(g, BF_A, P0);
  const sp = put(g, P0, 'Sprite', 'base', { token: true });
  const sm = put(g, P0, 'Smoke and Mirrors', { facedown: BF_A });
  g = endTurn(g, P1);
  g = drive(g, ['first', 'no'], x => x.pending?.player === P0 && !x.pending.inStep && x.chain.length > 0);
  assert.ok(!chainLabels(g).includes('trigger:Dusk Rose Lab'), 'Lab declined at finalization');
  g = drive(act(g, { type: 'playCard', player: P0, obj: sm }), [[sp, li]], x => x.activePlayer === P0 && x.pending?.kind === 'mainAction');
  assert.equal(locOf(g, li), 'base');
  assert.equal(zone(g, sp), 'gone', 'old Sprite killed by its Temporary trigger');
  assert.deepEqual(unitsNamed(g, 'Sprite').map(id => locOf(g, id)), [BF_A], 'Lillia\'s new Sprite at the Lab');
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[P0].points, 1, 'held');
});

test('RJ#12596 conquering Veiled Temple with Last Rites attached: the Temple (on top) readies and detaches Last Rites, its conquer trigger still resolves (unit from my trash); the loose gear is recalled to base', () => {
  let g = S0(); fundAll(g, P0);
  setBattlefieldCard(g, BF_A, 'Veiled Temple');
  const u = put(g, P0, 'V(2)', 'base');
  const lr = put(g, P0, 'Last Rites', 'base'); attachNow(g, lr, u);
  const t = put(g, P0, 'V(3)', 'trash');
  g = move(g, P0, [u], BF_A);
  g = drive(g, [/play a unit from your trash/, [t], [lr], 'yes', 'base'], x => x.pending?.kind === 'mainAction');
  assert.equal(locOf(g, t), 'base', 'Last Rites\' trigger resolved after the detach');
  assert.equal(g.objects[lr].attachedTo ?? null, null, 'detached');
  assert.equal(locOf(g, lr), 'base', 'recalled');
});

test('RJ#12598 Astral Heron at a battlefield; Temporal Breach (first card) replays my other unit: the replayed unit is not the discounted card — the discount is waiting for my next card', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'Astral Heron', BF_A); control(g, BF_A, P0);
  const u = put(g, P0, 'V(3)', BF_B); control(g, BF_B, P0);
  const st = hand(g, P0, 'Stupefy');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Temporal Breach') }), [[u]], x => x.pending?.kind === 'mainAction');
  assert.equal(locOf(g, unitsNamed(g, 'V(3)')[0]), BF_B, 'replayed');
  assert.equal(playCostOf(g, P0, st)!.energy, 0, 'next card discounted');
});

test('RJ#12599 my lone Sprite at a battlefield with a hidden Smoke and Mirrors: in response to its Temporary trigger I swap it with my base unit; the Sprite dies in base and my unit holds the battlefield', () => {
  let g = withTokens(S0({ tp: P1 })); fundAll(g, P0);
  const sp = put(g, P0, 'Sprite', BF_A, { token: true }); control(g, BF_A, P0);
  const u = put(g, P0, 'V(2)', 'base');
  const sm = put(g, P0, 'Smoke and Mirrors', { facedown: BF_A });
  g = endTurn(g, P1);
  g = drive(g, [], x => x.pending?.player === P0 && !x.pending.inStep && x.chain.length > 0);
  g = drive(act(g, { type: 'playCard', player: P0, obj: sm }), [[sp, u]], x => x.activePlayer === P0 && x.pending?.kind === 'mainAction');
  assert.equal(locOf(g, u), BF_A);
  assert.equal(zone(g, sp), 'gone');
  assert.equal(g.players[P0].points, 1, 'held');
});

test('RJ#12600 Rift Herald moves onto the opponent\'s battlefield; their hidden Hidden Blade kills it in response to its move trigger: the trigger still resolves (look at 3, draw a unit)', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const hb = put(g, P1, 'Hidden Blade', { facedown: BF_A });
  const rh = put(g, P0, 'Rift Herald', 'base');
  clearDeck(g, P0);
  for (const c of ['V(8)', 'V(7)', 'ZapA', 'V(9)', 'V(6)']) put(g, P0, c, 'deckTop');
  g = move(g, P0, [rh], BF_A);
  g = drive(g, [], x => x.pending?.player === P1 && !x.pending.inStep && chainLabels(x).includes('trigger:Rift Herald'));
  g = act(g, { type: 'playCard', player: P1, obj: hb });
  let revealed = false;
  for (let i = 0; i < 40 && g.pending && g.pending.kind !== 'mainAction' && g.pending.kind !== 'showdownAction'; i++) {
    const d = g.pending;
    if (!d.inStep) { g = act(g, { type: 'pass', player: d.player }); continue; }
    if (/reveal a unit/i.test(d.prompt ?? '')) revealed = true;
    g = ans(g, d.options!.some(o => o.id === rh) ? [rh] : d.kind === 'optional' ? 'no' : d.options![0].id);
  }
  assert.equal(zone(g, rh), 'trash');
  assert.ok(revealed, 'the move trigger still let me look and reveal');
});

test('RJ#12603 Temporal Breach hidden at battlefield B can only choose a unit at B (not at A)', () => {
  let g = S0(); fundAll(g, P0);
  const a = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const b = put(g, P0, 'V(3)', BF_B); control(g, BF_B, P0);
  const tb = put(g, P0, 'Temporal Breach', { facedown: BF_B });
  g = act(g, { type: 'playCard', player: P0, obj: tb });
  if (g.pending?.kind === 'chooseTargets') {
    const o = g.pending.options!.map(x => x.id);
    assert.ok(!o.includes(a), 'unit at A not offered');
    assert.ok(o.includes(b));
    g = ans(g, [b]);
  }
  g = drive(g, [], x => x.pending?.kind === 'mainAction');
  assert.equal(locOf(g, a), BF_A);
  assert.ok(g.log.some(l => /Banished V\(3\)/.test(l.text)));
});

test('RJ#12605 in response to Brynhir Thundersong\'s trigger the opponent reveals Tornado Warrior and empowers Kharox: Kharox\'s triggers resolve first, so they play a unit from my trash before the "can\'t play cards" applies', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1);
  const kx = put(g, P1, 'Kharox', BF_A); control(g, BF_A, P1);
  const tw = put(g, P1, 'Tornado Warrior', { facedown: BF_A });
  const t = put(g, P0, 'V(4)', 'trash');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Brynhir Thundersong'), destination: 'base' });
  g = drive(g, [], x => x.pending?.player === P1 && !x.pending.inStep);
  g = drive(act(g, { type: 'playCard', player: P1, obj: tw }), ['yes', [kx], 'yes', [t], 'base'], x => x.pending?.kind === 'mainAction');
  assert.ok(g.objects[kx].empowered);
  assert.equal(locOf(g, t), 'base');
  assert.equal(g.objects[t].controller, P1, 'played by the Kharox player from my trash');
});

test('RJ#12606 Cull the Weak: I choose my Recruit token in base next to Soraka, Wanderer → she replaces the death (healed, exhausted, stays in base)', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  const so = put(g, P0, 'sfd-173-221', 'base');
  const r = put(g, P0, 'Recruit', 'base', { token: true });
  const e = put(g, P1, 'V(2)', 'base');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Cull the Weak') }), [[r], [e]], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, r), 'base', 'saved');
  assert.equal(g.objects[r].exhausted, true);
  assert.equal(zone(g, so), 'base');
  assert.equal(zone(g, e), 'trash');
});

test('RJ#12609 a 3-Might unit with +5 this turn equips Shady Spectacles copying a 5-Might unit: copy at 10 (its own +5 stays); the copied unit\'s buff is not copied', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'V(3)', 'base');
  const t = put(g, P0, 'V(5)', 'base');
  mod(g, u, { might: 5 }); mod(g, t, { might: 2 });
  const sp = put(g, P0, 'Shady Spectacles', 'base');
  g = drive(act(g, { type: 'activate', player: P0, obj: sp, abilityIndex: EQUIP }), [[u], [t]], x => x.pending?.kind === 'mainAction');
  assert.equal(chars(g, u).name, 'V(5)');
  assert.equal(mightOf(g, u), 10, '5 (copied printed) + its own +5; the target\'s +2 not copied');
});

test('RJ#12610 hidden Here to Help plays Baron Nashor (cost -3): his replacement puts him in the Baron Pit, not the hidden battlefield', () => {
  let g = S0(); fundAll(g, P0, 6);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const hh = put(g, P0, 'Here to Help', { facedown: BF_A });
  const b = put(g, P0, 'Baron Nashor', 'hand');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hh }), [[b]], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, b), 'battlefield');
  assert.equal(g.objects[b].battlefieldIndex, 2, 'entered the Baron Pit');
});

test('RJ#12613 Kayle, Justified already Empowered three times: a 4th Empower does nothing, so Matriarch of War is not empowered by it', () => {
  let g = S0(); fundAll(g, P0, 8);
  const leg = setLegend(g, P0, 'Matriarch of War');
  const k = put(g, P0, 'Kayle, Justified', 'base'); g.objects[k].empowered = 3; g.timestamp++;
  const a = legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === k);
  if (a) g = drive(act(g, a), [], x => x.pending?.kind === 'mainAction');
  assert.equal(g.objects[k].empowered, 3);
  assert.ok(!g.objects[leg].empowered, 'no "empower something else" happened');
});

test('RJ#12614 Scuttle Crab conquers Star Spring; First Mate played there readies it and Star Spring moves it to base (no exhaust): it can standard-move again and conquer the other battlefield', () => {
  let g = S0(); fundAll(g, P0);
  setBattlefieldCard(g, BF_A, 'Star Spring');
  const sc = put(g, P0, 'Scuttle Crab', 'base');
  g = drive(move(g, P0, [sc], BF_A), [], x => x.pending?.kind === 'mainAction');
  assert.equal(g.players[P0].points, 1);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'First Mate'), destination: BF_A }), ['first', [sc], [sc]], x => x.pending?.kind === 'mainAction');
  assert.equal(locOf(g, sc), 'base');
  assert.equal(g.objects[sc].exhausted, false, 'the effect move doesn\'t exhaust');
  g = drive(move(g, P0, [sc], BF_B), [], x => x.pending?.kind === 'mainAction');
  assert.equal(locOf(g, sc), BF_B);
  assert.equal(g.players[P0].points, 2);
});

test('RJ#12616 opponent\'s Promising Future reveals my Riposte and their Flurry of Blades: Riposte can\'t counter the Flurry (house: mine is played first with no spell to choose, so it isn\'t played and stays banished, DECISIONS #6901)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const rp = put(g, P0, 'Riposte', 'deckTop');
  const fl = put(g, P1, 'Flurry of Blades', 'deckTop');
  const mine = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  put(g, P1, 'V(3)', BF_B); control(g, BF_B, P1);
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Promising Future') }), [[fl], [rp]], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, fl), 'trash', 'Flurry resolved');
  assert.equal(g.objects[mine].damage, 1, 'not countered');
  assert.equal(zone(g, rp), 'banishment');
});

test('RJ#12617 Pit Rookie (2) attacks a lone Tideturner (2 - 2 = 0) at Forbidding Waste; the defender\'s hidden Switcheroo swaps → Rookie 0, Tideturner 2 (the Waste\'s -2 counted once)', () => {
  let g = S0(); fundAll(g, P1);
  setBattlefieldCard(g, BF_A, 'Forbidding Waste');
  const t = put(g, P1, 'Tideturner', BF_A); control(g, BF_A, P1);
  const sw = put(g, P1, 'Switcheroo', { facedown: BF_A });
  const r = put(g, P0, 'Pit Rookie', 'base');
  g = move(g, P0, [r], BF_A);
  g = drive(g, [], x => x.pending?.kind === 'showdownAction' && x.pending.player === P0 && x.chain.length === 0);
  assert.equal(mightOf(g, t), 0);
  g = act(g, { type: 'pass', player: P0 });
  g = drive(act(g, { type: 'playCard', player: P1, obj: sw }), [[r, t]], x => x.chain.length === 0 && !x.pending?.inStep);
  assert.equal(mightOf(g, r), 0);
  assert.equal(mightOf(g, t), 2);
});

test('RJ#12618 Shuriken Flip (2 to an enemy, move my unit); the opponent Flashes the enemy to base: no damage, but my unit still moves', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const e = put(g, P1, 'V(3)', BF_B); control(g, BF_B, P1);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  put(g, P0, 'V(1)', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Shuriken Flip') });
  for (let i = 0; i < 6 && g.pending?.inStep; i++) {
    const o = g.pending.options!.map(x => x.id);
    g = ans(g, o.includes(e) ? [e] : o.includes(u) ? [u] : o.includes('base') ? 'base' : o[0]);
  }
  g = drive(g, [], x => x.pending?.player === P1 && !x.pending.inStep);
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Flash') }), [[e]], x => x.pending?.kind === 'mainAction');
  assert.equal(locOf(g, e), 'base');
  assert.equal(g.objects[e].damage ?? 0, 0, 'damage instruction mistargets');
  assert.equal(locOf(g, u), 'base', 'move still happens');
});

test('RJ#12619 Yasuo, Remorseful attacks a battlefield with Akali, Silent: she is in combat when his attack trigger chooses, so he can deal 6 to her', () => {
  let g = S0();
  const s = put(g, P1, 'ven-038-166', BF_A); control(g, BF_A, P1);
  const y = put(g, P0, 'ogn-076-298', 'base');
  g = move(g, P0, [y], BF_A);
  g = drive(g, [[s]], x => x.pending?.kind === 'showdownAction' || x.pending?.kind === 'assignDamage' || x.pending?.kind === 'mainAction');
  assert.equal(zone(g, s), 'trash', '6 damage killed her (4 Might)');
});

test('RJ#12620 a Champion Legend is never played: it starts in the Legend Zone and a play action on it is rejected', () => {
  let g = S0(); fundAll(g, P0);
  const leg = g.players[P0].legend;
  assert.ok(leg && g.objects[leg], 'legend in its zone from setup');
  assert.ok(validateAction(g, { type: 'playCard', player: P0, obj: leg }), 'cannot be played');
  assert.ok(!legal(g, P0, 'playCard').some(a => a.type === 'playCard' && a.obj === leg));
});

test('RJ#12622 two Astral Heron triggers: no window between them going on the chain; between their resolutions I may play a Reaction (Stupefy), which uses the first discount — the second goes to the card after it', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'Astral Heron', BF_A); put(g, P0, 'Astral Heron', BF_A); control(g, BF_A, P0);
  const st = hand(g, P0, 'Stupefy'), di = hand(g, P0, 'Discipline');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'V(1)'), destination: 'base' });
  g = drive(g, ['first'], x => !x.pending?.inStep);
  assert.deepEqual(chainLabels(g), ['trigger:Astral Heron', 'trigger:Astral Heron'], 'both on the chain before anyone gets priority');
  g = act(g, { type: 'pass', player: P0 }); g = act(g, { type: 'pass', player: P1 });
  assert.equal(g.chain.length, 1);
  const ready = () => g.players[P0].runesInPlay.filter(r => !g.objects[r].exhausted).length;
  const before = ready();
  g = drive(act(g, { type: 'playCard', player: P0, obj: st }), ['first'], x => !x.pending?.inStep);
  assert.equal(ready(), before, 'Stupefy free (first discount)');
  g = drive(g, [], x => x.chain.length === 0 && x.pending?.kind === 'mainAction');
  assert.equal(playCostOf(g, P0, di)!.energy, 0, 'second discount for the next card');
});

test('RJ#12623 two Astral Heron triggers both resolved before my next card: both discounts apply to that one card (V(4): 4 - 2 - 2 = 0)', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'Astral Heron', BF_A); put(g, P0, 'Astral Heron', BF_A); control(g, BF_A, P0);
  const v = hand(g, P0, 'V(4)');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'V(1)'), destination: 'base' });
  g = drive(g, ['first'], x => x.chain.length === 0 && x.pending?.kind === 'mainAction');
  assert.equal(playCostOf(g, P0, v)!.energy, 0);
});

test('RJ#12627 the opponent plays a 3-Might unit to a battlefield and targets it with Pridestalker\'s +1: Gust in response returns it (still 3); after the +1 resolves (4) Gust can\'t choose it', () => {
  const setup = () => {
    let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
    setLegend(g, P1, 'Pridestalker');
    put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
    const u = hand(g, P1, 'V(3)');
    g = act(g, { type: 'playCard', player: P1, obj: u, destination: BF_B });
    g = drive(g, [[u]], x => x.pending?.player === P0 && !x.pending.inStep);
    return { g, u };
  };
  let { g, u } = setup();
  assert.ok(g.chain.length > 0, 'Pridestalker trigger on the chain');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Gust') }), [[u]], x => x.chain.length === 0 && !x.pending?.inStep);
  assert.equal(zone(g, u), 'hand');
  ({ g, u } = setup());
  g = drive(g, [], x => x.chain.length === 0 && x.pending?.kind === 'mainAction');
  assert.equal(mightOf(g, u), 4);
  // give me priority (respond to a spell of theirs) and check Gust's targets
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'ZapA') }), ['first'], x => x.pending?.player === P0 && !x.pending.inStep);
  const gu = hand(g, P0, 'Gust');
  g = act(g, { type: 'playCard', player: P0, obj: gu });
  if (g.pending?.kind === 'chooseTargets') assert.ok(!g.pending.options!.some(o => o.id === u), '4 Might: not a legal Gust target');
});

test('RJ#12632 the opponent Rebuttals my Falling Star (pays [A], retargets my unit): it is now an enemy spell choosing my unit, so my Not So Fast can counter it', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const mine = put(g, P0, 'V(5)', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(5)', BF_B); control(g, BF_B, P1);
  const fs = hand(g, P0, 'Falling Star'), nsf = hand(g, P0, 'Not So Fast');
  g = drive(act(g, { type: 'playCard', player: P0, obj: fs }), [[e], [e]], x => x.pending?.player === P1 && !x.pending.inStep);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Rebuttal') });
  g = drive(g, ['yes', 'yes', [mine], [mine]], x => x.chain.length === 1 && x.pending?.player === P0 && !x.pending.inStep);
  assert.equal(g.chain[0].controller, P1, 'Falling Star now controlled by the opponent');
  assert.equal(validateAction(g, { type: 'playCard', player: P0, obj: nsf }), null, 'Not So Fast legal');
  g = drive(act(g, { type: 'playCard', player: P0, obj: nsf }), [], x => x.pending?.kind === 'mainAction');
  assert.equal(g.objects[mine].damage ?? 0, 0, 'countered');
  assert.equal(zone(g, fs), 'trash');
});

test('RJ#12633 Soraka, Wanderer replaces my smaller unit\'s death at her battlefield: it never dies, so Viktor, Leader makes no Recruit', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  put(g, P0, 'ogn-246-298', 'base');
  put(g, P0, 'sfd-173-221', BF_A); const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'KillA') }), [[u]], x => x.pending?.kind === 'mainAction');
  assert.equal(locOf(g, u), 'base', 'saved and recalled');
  assert.equal(unitsNamed(g, 'Recruit').length, 0, 'no death → no Viktor trigger');
});

test('RJ#12634 Deceiver\'s ready Reflection copying Rengar, Unseen (Ganking) can standard-move battlefield to battlefield', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  setLegend(g, P0, 'Deceiver');
  const r = put(g, P0, 'unl-024-219', 'base');
  hand(g, P0, 'V(1)');
  const before = new Set(Object.keys(g.objects));
  g = drive(move(g, P0, [r], BF_A), ['yes', 'first'], x => x.pending?.kind === 'mainAction');
  const refl = Object.keys(g.objects).find(id => !before.has(id) && g.objects[id].isToken && g.objects[id].zone === 'battlefield')!;
  assert.ok(refl, 'Reflection played');
  assert.equal(chars(g, refl).name, 'Rengar');
  assert.ok(hasKeyword(g, refl, 'Ganking'));
  assert.ok(moveDests(g, P0, refl).includes(BF_B), 'battlefield-to-battlefield move available');
});

test('RJ#12636 Vi, Peacekeeper moves into an empty battlefield (non-combat showdown); the opponent Ambushes Rengar, Trophy Hunter there: Vi\'s side applied Contested → she attacks and her stun triggers', () => {
  let g = S0(); fundAll(g, P1);
  const vi = put(g, P0, 'unl-176-219', 'base');
  const r = put(g, P1, 'unl-120-219', 'hand');
  g = move(g, P0, [vi], BF_A);
  g = drive(g, [], x => x.pending?.kind === 'showdownAction' && x.pending.player === P1);
  g = act(g, { type: 'playCard', player: P1, obj: r, destination: BF_A });
  g = drive(g, [], x => chainLabels(x).includes('trigger:Vi'));
  assert.ok(g.showdown?.isCombat, 'now a combat');
  g = drive(g, [], x => x.chain.length === 0 && x.pending?.kind === 'showdownAction');
  assert.equal(g.objects[r].stunned, true, 'Rengar stunned');
  void vi;
});

test('RJ#12639 (continuing RJ#12636) stunned Rengar, Trophy Hunter (6) survives Vi\'s damage; both sides survive → Vi recalled, Rengar\'s controller keeps the battlefield and conquers', () => {
  let g = S0(); fundAll(g, P1);
  const vi = put(g, P0, 'unl-176-219', 'base');
  const r = put(g, P1, 'unl-120-219', 'hand');
  g = move(g, P0, [vi], BF_A);
  g = drive(g, [], x => x.pending?.kind === 'showdownAction' && x.pending.player === P1);
  g = drive(act(g, { type: 'playCard', player: P1, obj: r, destination: BF_A }), [], x => x.pending?.kind === 'mainAction');
  assert.ok(mightOf(g, vi) < 6, 'Vi can\'t kill him');
  assert.equal(locOf(g, vi), 'base', 'attacker recalled');
  assert.equal(locOf(g, r), BF_A);
  assert.equal(g.objects[r].damage ?? 0, 0, 'healed');
  assert.equal(g.battlefields[BF_A].controller, P1);
  assert.equal(g.players[P1].points, 1, 'Rengar\'s controller conquers');
});

test('RJ#12640 empowered Ambessa, The Wolf ("can\'t be dealt damage unless in combat") can still be chosen and killed by a kill spell', () => {
  let g = S0(); fundAll(g, P0);
  const am = put(g, P1, 'ven-084-166', BF_A); control(g, BF_A, P1); g.objects[am].empowered = 1; g.timestamp++;
  assert.equal(mightOf(g, am), 7);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'KillA') }), [[am]], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, am), 'trash');
});

test('RJ#12641 Forge of the Fluft\'s legend ability attaches Blade of the Ruined King without paying its Equip cost (no friendly unit killed)', () => {
  let g = S0({ bfA: 'Forge of the Fluft' }); fundAll(g, P0);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const u = put(g, P0, 'V(2)', 'base'), other = put(g, P0, 'V(3)', 'base');
  const bl = put(g, P0, 'Blade of the Ruined King', 'base');
  const l = g.players[P0].legend;
  const a = legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === l);
  assert.ok(a, 'granted [T] ability');
  g = act(g, a!);
  for (let i = 0; i < 10 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    if (!d.inStep) { g = act(g, { type: 'pass', player: d.player }); continue; }
    const o = d.options!.map(x => x.id);
    g = ans(g, o.includes(bl) ? bl : o.includes(u) ? u : o[0]);
  }
  assert.equal(g.objects[bl].attachedTo, u);
  assert.equal(zone(g, other), 'base', 'nothing killed');
  assert.equal(zone(g, u), 'base');
});

test('RJ#12642 my Rampage between my 12-Might unit and the opponent\'s Elder Dragon: the Dragon\'s damage is its controller\'s, so any amount kills my unit; my 12 kills the Dragon too', () => {
  let g = S0(); fundAll(g, P0);
  const ed = put(g, P1, 'unl-118-219', BF_A); control(g, BF_A, P1);
  const u = put(g, P0, 'V(12)', BF_B); control(g, BF_B, P0);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Rampage') }), ['no', [u], [ed], [u, ed], 'first'], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, u), 'trash', 'killed by Elder Dragon\'s 10 (any amount is lethal)');
  assert.equal(zone(g, ed), 'trash');
});

test('RJ#12643 The List\'s -2 "this turn" stays after it leaves; a replayed List (new object, ready, names again) adds a separate -2 → -4 (second copy stands in for the replay)', () => {
  let g = S0(); fundAll(g, P0, 8);
  const d = put(g, P1, 'ogn-027-298', BF_A); control(g, BF_A, P1);
  const useList = () => {
    g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'The List') });
    g = drive(g, [/^Noxus$/i], x => x.pending?.kind === 'mainAction');
    const tl = g.players[P0].base.filter(id => g.cards[g.objects[id].cardId].name === 'The List' && !g.objects[id].exhausted)[0];
    g = drive(act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === tl)!), [[d]], x => x.pending?.kind === 'mainAction');
    return tl;
  };
  const first = useList();
  assert.equal(mightOf(g, d), 3);
  g.objects[first].zone = 'trash'; g.players[P0].base = g.players[P0].base.filter(id => id !== first); g.players[P0].trash.push(first); g.ex.dirty = true; g.timestamp++;
  assert.equal(mightOf(g, d), 3, 'first -2 survives The List leaving');
  useList();
  assert.equal(mightOf(g, d), 1, 'stacked: -4');
});

test('RJ#12647 at 7 points, my lone Sprite holds a battlefield: Janna, Savior (Reaction) played there in response to its Temporary trigger keeps control → hold point wins', () => {
  let g = withTokens(S0({ tp: P1 })); fundAll(g, P0);
  const sp = put(g, P0, 'Sprite', BF_A, { token: true }); control(g, BF_A, P0);
  g.players[P0].points = 7;
  const j = put(g, P0, 'sfd-053-221', 'hand');
  g = endTurn(g, P1);
  g = drive(g, [], x => x.pending?.player === P0 && !x.pending.inStep && x.chain.length > 0);
  g = drive(act(g, { type: 'playCard', player: P0, obj: j, destination: BF_A }), ['first'], x => x.phase === 'gameOver' || (x.activePlayer === P0 && x.pending?.kind === 'mainAction'));
  assert.equal(zone(g, sp), 'gone');
  assert.equal(locOf(g, j), BF_A);
  assert.equal(g.winner, P0, 'hold point = 8th point');
});

test('RJ#12649 Hand of Noxus can\'t add before any card is played; after hidden Kennen, Keeper of Balance is played (Legion on), its [Add] [1] plus my 1 rune pays his [2] stun', () => {
  let g = S0(); setRunes(g, P0, 1, 'order');
  const leg = setLegend(g, P0, 'Hand of Noxus');
  const mine = put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const k = put(g, P0, 'Kennen, Keeper of Balance', { facedown: BF_A });
  assert.ok(!legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === leg), 'Legion not active yet');
  g = act(g, { type: 'playCard', player: P0, obj: k });
  expectPending(g, 'optional', P0);
  g = drive(g, ['yes', [mine]], x => x.pending?.kind === 'mainAction');
  assert.equal(g.objects[mine].stunned, true, '[2] paid');
  assert.equal(g.objects[leg].exhausted, true, 'Hand of Noxus used for 1 of it');
});

test('RJ#12651 in response to my Baited Hook the opponent Thrill of the Hunts their Brynhir Thundersong: his trigger resolves before the Hook, so I can\'t play the revealed unit (my unit is still killed)', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1, 8);
  const v = put(g, P0, 'V(2)', 'base');
  const hook = put(g, P0, 'Baited Hook', 'base');
  const br = put(g, P1, 'Brynhir Thundersong', BF_B); control(g, BF_B, P1);
  const top = put(g, P0, 'V(3)', 'deckTop');
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === hook)!);
  g = drive(g, [], x => x.pending?.player === P1 && !x.pending.inStep);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Thrill of the Hunt') });
  for (let i = 0; i < 6 && g.pending?.inStep; i++) { const o = g.pending.options!.map(x => x.id); g = ans(g, o.includes(br) ? [br] : o[0]); }
  g = drive(g, [], x => x.chain.length === 1 && !x.pending?.inStep);
  assert.ok(chainLabels(g)[0].includes('Baited Hook'), 'Brynhir\'s trigger resolved first');
  g = drive(g, ['first'], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, v), 'trash');
  assert.ok(!['base', 'battlefield'].includes(zone(g, top)), 'revealed unit not played');
});

test('RJ#12652 Baited Hook kills my only unit at a battlefield: control isn\'t lost mid-resolution, so the found unit can be played there', () => {
  let g = S0(); fundAll(g, P0);
  const v = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const hook = put(g, P0, 'Baited Hook', 'base');
  const top = put(g, P0, 'V(3)', 'deckTop');
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === hook)!);
  let dests: string[] = [];
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    if (!d.inStep) { g = act(g, { type: 'pass', player: d.player }); continue; }
    const o = d.options!.map(x => x.id);
    if (d.kind === 'chooseDestination' || d.kind === 'chooseBattlefield') dests = o;
    g = ans(g, o.includes(v) ? [v] : o.includes(top) ? [top] : o.includes(String(BF_A)) ? String(BF_A) : o[0]);
  }
  assert.equal(zone(g, v), 'trash');
  assert.ok(dests.includes(String(BF_A)), 'BF-A offered');
  assert.equal(locOf(g, top), BF_A);
  assert.equal(g.battlefields[BF_A].controller, P0);
});

test('RJ#12656 Kennen, Keeper of Balance (+2 while a stunned enemy is here) takes 3 combat damage while the stunned Astral Heron dies in the same combat: lethal is checked with the Heron still there → Kennen (4) survives', () => {
  let g = S0();
  const h = put(g, P1, 'Astral Heron', BF_A); const tw = put(g, P1, 'Tornado Warrior', BF_A); control(g, BF_A, P1);
  g.objects[h].stunned = true; g.timestamp++;
  const k = put(g, P0, 'Kennen, Keeper of Balance', 'base'); const v = put(g, P0, 'V(8)', 'base');
  g = move(g, P0, [k, v], BF_A);
  assert.equal(mightOf(g, k), 4);
  for (let i = 0; i < 40 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    if (d.kind === 'assignDamage') { const s = (d.data as { suggested: Record<string, number> }).suggested; g = act(g, { type: 'assignDamage', player: d.player, assignment: d.player === P1 ? { [k]: 3 } : s }); continue; }
    if (d.inStep) { g = ans(g, d.options!.some(o => o.id === 'no') ? 'no' : 'first'); continue; }
    g = act(g, { type: 'pass', player: d.player });
  }
  assert.equal(zone(g, h), 'trash'); assert.equal(zone(g, tw), 'trash');
  assert.equal(zone(g, k), 'battlefield', 'Kennen survives');
});

test('RJ#12657 Baron Nashor leaves the board: other friendly units lose his +2 at once; a unit whose marked damage now equals its Might dies', () => {
  let g = S0(); fundAll(g, P0);
  const bn = put(g, P0, 'Baron Nashor', BF_A); control(g, BF_A, P0);
  const a = put(g, P0, 'V(3)', 'base'), b = put(g, P0, 'V(3)', 'base');
  assert.equal(mightOf(g, a), 5);
  g.objects[b].damage = 3; g.timestamp++;
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'KillA') }), [[bn]], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, bn), 'trash');
  assert.equal(mightOf(g, a), 3);
  assert.equal(zone(g, b), 'trash', '3 damage on a 3-Might unit');
});

test('RJ#12659 Blue Sentinel equipped with Skyfall of Areion conquers: its "When I hold" fires once as a conquer effect — the "additional time" is only for holding', () => {
  let g = S0();
  const bs = put(g, P0, 'Blue Sentinel', 'base');
  const sk = put(g, P0, 'Skyfall of Areion', 'base'); attachNow(g, sk, bs);
  g = move(g, P0, [bs], BF_A);
  let most = 0;
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    most = Math.max(most, chainLabels(g).filter(l => l === 'trigger:Blue Sentinel').length);
    const d = g.pending;
    if (d.inStep) { g = ans(g, 'first'); continue; }
    g = act(g, { type: 'pass', player: d.player });
  }
  assert.equal(g.battlefields[BF_A].controller, P0, 'conquered');
  assert.equal(most, 1, 'one Blue Sentinel trigger');
});

test('RJ#12660 Rumble, Scrapper with Skyfall of Areion conquers together with Blue Sentinel: one Mech (Sentinel doubles only hold effects for holding)', () => {
  let g = withTokens(S0());
  const bs = put(g, P0, 'Blue Sentinel', 'base'); const ru = put(g, P0, 'Rumble, Scrapper', 'base');
  const sk = put(g, P0, 'Skyfall of Areion', 'base'); attachNow(g, sk, ru);
  g = move(g, P0, [bs, ru], BF_A);
  g = drive(g, ['first', 'first', 'first', 'first'], x => x.pending?.kind === 'mainAction');
  assert.equal(g.battlefields[BF_A].controller, P0, 'conquered');
  assert.equal(unitsNamed(g, 'Mech').length, 1, 'one Mech token');
});

test('RJ#12661 Decree of Unity can kill an enemy Spinning Axe attached to a unit (Chaos gear), not my own', () => {
  let g = S0(); fundAll(g, P0, 8);
  const du = put(g, P0, 'Decree of Unity', 'hand');
  const u = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const ax = put(g, P1, 'Spinning Axe', 'base'); attachNow(g, ax, u);
  const mu = put(g, P0, 'V(3)', BF_B); control(g, BF_B, P0);
  const myAx = put(g, P0, 'Spinning Axe', 'base'); attachNow(g, myAx, mu);
  g = act(g, { type: 'playCard', player: P0, obj: du });
  g = drive(g, [[ax]], x => x.pending?.kind === 'mainAction');   // the enemy Axe is the only legal choice (chosen automatically)
  assert.equal(zone(g, ax), 'trash');
  assert.equal(g.objects[myAx].attachedTo, mu, 'own Axe untouched');
});

test('RJ#12666 Angle Shot moves the enemy Guardian Angel from an enemy Akali (can\'t be chosen outside combat) to the enemy Scuttle Crab: Akali is never chosen', () => {
  let g = S0(); fundAll(g, P0);
  const ak = put(g, P1, 'ven-038-166', 'base'), sc = put(g, P1, 'Scuttle Crab', 'base');
  const ga = put(g, P1, 'Guardian Angel', 'base'); attachNow(g, ga, ak);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Angle Shot') });
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    if (!d.inStep) { g = act(g, { type: 'pass', player: d.player }); continue; }
    const o = d.options!.map(x => x.id);
    assert.ok(!o.includes(ak) || o.includes('attach'), 'Akali never offered as the unit');
    g = ans(g, o.includes('attach') ? 'attach' : o.includes(sc) ? sc : o.includes(ga) ? ga : o[0]);
  }
  assert.equal(g.objects[ga].attachedTo, sc);
});

test('RJ#12669 Watchful Sentry copying Rift Herald (Shady Spectacles) with The Zero Drive dies: Rift Herald\'s Deathknell triggers, and the banished card — later played back by Zero Drive — is Watchful Sentry', () => {
  let g = S0(); fundAll(g, P0, 12);
  const ws = put(g, P0, 'Watchful Sentry', BF_A); control(g, BF_A, P0);
  const rh = put(g, P0, 'Rift Herald', 'base');
  const sp = put(g, P0, 'Shady Spectacles', 'base'); const zd = put(g, P0, 'The Zero Drive', 'base');
  g = drive(act(g, { type: 'activate', player: P0, obj: sp, abilityIndex: EQUIP }), [[ws], [rh]]);
  assert.equal(chars(g, ws).name, 'Rift Herald');
  attachNow(g, zd, ws);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'KillA') });
  const trig: string[] = [];
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    trig.push(...chainLabels(g));
    if (d.kind === 'orderTriggers') trig.push(...d.options!.map(o => o.label));
    if (!d.inStep) { g = act(g, { type: 'pass', player: d.player }); continue; }
    const o = d.options!.map(x => x.id);
    g = ans(g, o.includes(ws) ? [ws] : d.kind === 'optional' ? 'no' : o[0]);
  }
  assert.ok(trig.some(l => /Rift Herald|Play a unit from your hand/.test(l)), `Rift Herald Deathknell triggered: ${JSON.stringify([...new Set(trig)])}`);
  assert.equal(zone(g, ws), 'banishment');
  assert.equal(chars(g, ws).name, 'Watchful Sentry', 'the banished card is Watchful Sentry');
  const zdAb = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === zd);
  assert.ok(zdAb, 'Zero Drive ability');
  g = drive(act(g, zdAb!), ['first', 'first'], x => x.pending?.kind === 'mainAction');
  const back = unitsNamed(g, 'Watchful Sentry');
  assert.equal(back.length, 1, 'Watchful Sentry played back');
  assert.equal(unitsNamed(g, 'Rift Herald').length, 1, 'only the original Rift Herald');
});

test('RJ#12673 in response to my Dazzling Aurora\'s end-of-turn trigger, my hidden Temporal Breach replays my Disarming Rake, which kills the Aurora: the trigger still resolves and plays the revealed unit', () => {
  let g = S0(); fundAll(g, P0, 8);
  const au = put(g, P0, 'Dazzling Aurora', 'base');
  const rk = put(g, P0, 'Disarming Rake', BF_A); control(g, BF_A, P0);
  const tb = put(g, P0, 'Temporal Breach', { facedown: BF_A });
  const top = put(g, P0, 'V(3)', 'deckTop');
  g = endTurn(g, P0);
  g = drive(g, [], x => x.chain.length > 0 && x.pending?.player === P0 && !x.pending.inStep);
  assert.ok(chainLabels(g).some(l => /Aurora/.test(l)), 'Aurora trigger on the chain');
  g = act(g, { type: 'playCard', player: P0, obj: tb });
  for (let i = 0; i < 30 && g.pending && g.activePlayer === P0 && g.phase !== 'gameOver' && !(g.chain.length === 0 && zone(g, top) !== 'deck'); i++) {
    const d = g.pending;
    if (!d.inStep) { g = act(g, { type: 'pass', player: d.player }); continue; }
    const o = d.options!.map(x => x.id);
    g = ans(g, o.includes(rk) ? [rk] : o.includes(au) ? [au] : d.kind === 'optional' ? 'yes' : o[0]);
  }
  assert.equal(zone(g, au), 'trash', 'Aurora killed by the Rake');
  assert.ok(['base', 'battlefield'].includes(zone(g, top)), 'the trigger still played the revealed unit');
});

test('RJ#12674 the Deceiver (LeBlanc legend) trigger works on the opponent\'s turn: their Charm moves my unit into an empty battlefield → I conquer, may discard 1 + exhaust the legend for a Reflection', () => {
  let g = withTokens(S0({ tp: P1 })); fundAll(g, P1);
  const leg = setLegend(g, P0, 'Deceiver');
  const u = put(g, P0, 'V(3)', 'base');
  put(g, P0, 'V(1)', 'hand');
  const ch = put(g, P1, 'ogn-043-298', 'hand');
  g = act(g, { type: 'playCard', player: P1, obj: ch });
  let offered = false;
  for (let i = 0; i < 30 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0 && i > 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = act(g, { type: 'pass', player: d.player }); continue; }
    const o = d.options!.map(x => x.id);
    if (d.player === P0 && d.kind === 'optional') { offered = true; g = ans(g, 'yes'); continue; }
    g = ans(g, o.includes(u) ? [u] : o.includes(String(BF_A)) ? String(BF_A) : o[0]);
  }
  assert.equal(g.battlefields[BF_A].controller, P0, 'I conquered on their turn');
  assert.ok(offered, 'Deceiver trigger offered to me');
  assert.equal(g.objects[leg].exhausted, true, 'legend exhausted as its cost');
  const there = Object.keys(g.objects).filter(id => g.objects[id].zone === 'battlefield' && g.objects[id].battlefieldIndex === BF_A);
  assert.equal(there.filter(id => chars(g, id).name === 'V(3)').length, 2, 'Reflection copy of my unit there');
});

test('RJ#12676 Repulse counters Harnessed Dragon\'s play trigger choosing my unit at a battlefield; with my unit in base, Repulse can\'t be played', () => {
  for (const where of ['bf', 'base'] as const) {
    let g = S0({ tp: P1 }); fundAll(g, P1, 8); fundAll(g, P0);
    const u = where === 'bf' ? put(g, P0, 'V(3)', BF_A) : put(g, P0, 'V(3)', 'base'); if (where === 'bf') control(g, BF_A, P0);
    const rp = put(g, P0, 'Repulse', 'hand');
    const hd = put(g, P1, 'Harnessed Dragon', 'hand');
    g = act(g, { type: 'playCard', player: P1, obj: hd });
    g = drive(g, [[u]], x => x.pending?.player === P0 && !x.pending.inStep && x.chain.length > 0);
    assert.ok(chainLabels(g).some(l => /Harnessed Dragon/.test(l)), 'kill trigger on the chain');
    if (where === 'base') { assert.ok(!canPlayNow(g, P0, rp), 'no friendly unit at a battlefield → Repulse unplayable'); continue; }
    assert.ok(canPlayNow(g, P0, rp));
    g = drive(act(g, { type: 'playCard', player: P0, obj: rp }), [[u], 'first'], x => x.chain.length === 0 && x.pending?.kind === 'mainAction');
    assert.equal(zone(g, u), 'battlefield', 'the trigger was countered');
  }
});

test('RJ#12677 Thousand-Tailed Watcher\'s play effect (all enemy units, no choice) doesn\'t count for Prodigal Explorer: Watcher + one spell choosing an enemy is not "twice"', () => {
  let g = S0(); fundAll(g, P0, 14);
  const l = setLegend(g, P0, 'Prodigal Explorer');
  const e = put(g, P1, 'V(10)', BF_A); control(g, BF_A, P1);
  const canUse = (h: typeof g) => legal(h, P0, 'activate').some(a => a.type === 'activate' && a.obj === l);
  g = drive(act(g, { type: 'playCard', player: P0, obj: put(g, P0, 'Thousand-Tailed Watcher', 'hand'), destination: 'base' }), ['no', 'no'], x => x.pending?.kind === 'mainAction');
  assert.equal(mightOf(g, e), 7, 'Watcher affected the enemy');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Hextech Ray') }), [[e]], x => x.pending?.kind === 'mainAction');
  assert.ok(!canUse(g), 'only one qualifying choice');
  g = drive(act(g, { type: 'playCard', player: P0, obj: put(g, P0, 'Hextech Ray', 'hand') }), [[e]], x => x.pending?.kind === 'mainAction');
  assert.ok(canUse(g), 'a second choosing spell makes it twice');
});

test('RJ#12679 my hidden Zhonya\'s Hourglass played in response to the opponent\'s Bellows Breath saves my unit (recalled); their Elder Dragon may then choose it in base and kill it', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1, 12);
  const u = put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const z = put(g, P0, "Zhonya's Hourglass", { facedown: BF_A });
  g = act(g, { type: 'playCard', player: P1, obj: put(g, P1, 'Bellows Breath', 'hand') });
  for (let i = 0; i < 10 && g.pending?.inStep; i++) { const d = g.pending; const o = d.options!.map(x => x.id); g = ans(g, o.includes(u) ? [u] : o.includes('no') ? 'no' : o[0]); }
  g = drive(g, [], x => x.pending?.player === P0 && !x.pending.inStep && x.chain.length > 0);
  assert.ok(canPlayNow(g, P0, z), 'window to play the hidden Zhonya\'s');
  g = drive(act(g, { type: 'playCard', player: P0, obj: z }), ['first'], x => x.chain.length === 0 && x.pending?.kind === 'mainAction');
  assert.equal(zone(g, z), 'trash', 'Zhonya\'s killed instead');
  assert.equal(locOf(g, u), 'base', 'saved and recalled');
  g = act(g, { type: 'playCard', player: P1, obj: put(g, P1, 'Elder Dragon', 'hand'), destination: 'base' });
  let offered = false;
  for (let i = 0; i < 20 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = act(g, { type: 'pass', player: d.player }); continue; }
    const o = d.options!.map(x => x.id);
    if (o.includes(u)) offered = true;
    g = ans(g, o.includes(u) ? [u] : o[0]);
  }
  assert.ok(offered, 'the saved unit in base can be chosen');
  assert.equal(zone(g, u), 'trash', 'any amount of the Dragon controller\'s damage kills it');
});

test('RJ#12680 Turn to Dust on the Shady Spectacles worn by my Sprite (copying a non-Temporary unit): the Spectacles die in my Beginning Phase, the Sprite (Temporary again) survives until the next one', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  const sp = put(g, P0, 'Sprite', 'base', { token: true });
  const v = put(g, P0, 'V(4)', 'base');
  const sh = put(g, P0, 'Shady Spectacles', 'base');
  g = drive(act(g, { type: 'activate', player: P0, obj: sh, abilityIndex: EQUIP }), [[sp], [v]]);
  assert.equal(chars(g, sp).name, 'V(4)');
  g = nextTurn(g); assert.equal(g.activePlayer, P1); fundAll(g, P1);
  g = drive(act(g, { type: 'playCard', player: P1, obj: put(g, P1, 'Turn to Dust', 'hand') }), [[sh]], x => x.pending?.kind === 'mainAction');
  g = nextTurn(g); assert.equal(g.activePlayer, P0);
  assert.equal(zone(g, sh), 'trash', 'Spectacles died to Temporary');
  assert.equal(zone(g, sp), 'base', 'Sprite survives this Beginning Phase');
  assert.ok(hasKeyword(g, sp, 'Temporary'), 'a Sprite with Temporary again');
  g = nextTurn(g); g = nextTurn(g);
  assert.equal(zone(g, sp), 'gone', 'dies at the next one');
});

test('RJ#12685 the opponent\'s Rampage (additional cost paid) stolen by my Rebuttal with new choices: my unit is the friendly one and gets the +2', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const f = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(4)', BF_B); control(g, BF_B, P1);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Rampage') }), [], x => x.pending?.kind === 'chainResponse' && x.pending.player === P1 || x.pending?.kind === 'optional');
  if (g.pending?.kind === 'optional') g = drive(g, ['yes'], x => x.pending?.kind === 'chainResponse' && x.pending.player === P1);
  g = act(g, { type: 'playCard', player: P1, obj: put(g, P1, 'Rebuttal', 'hand') });
  for (let i = 0; i < 30 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = act(g, { type: 'pass', player: d.player }); continue; }
    const o = d.options!.map(x => x.id);
    g = ans(g, d.kind === 'optional' ? 'yes' : o[0]);   // pay [A], make new choices (friendly = my only unit, enemy = theirs)
  }
  assert.equal(mightOf(g, e), 6, 'my unit got the +2 (cost already paid)');
  assert.equal(g.objects[e].damage, 3);
  assert.equal(zone(g, f), 'trash', 'their unit took 6');
});

test('RJ#12687 Bottled Constellation\'s "kill 3 other friendly units" cost fully replaced by Soraka (units saved) still scores the point', () => {
  for (const withSoraka of [false, true]) {
    let g = S0({ tp: P1 });
    put(g, P0, 'Bottled Constellation', 'base');
    if (withSoraka) put(g, P0, 'Soraka', 'base');
    const us = [put(g, P0, 'V(1)', 'base'), put(g, P0, 'V(2)', 'base'), put(g, P0, 'V(3)', 'base')];
    g = endTurn(g, P1);
    for (let i = 0; i < 40 && g.pending && !(g.pending.kind === 'mainAction' && g.activePlayer === P0 && g.chain.length === 0); i++) {
      const d = g.pending;
      if (!d.inStep) { g = act(g, { type: 'pass', player: d.player }); continue; }
      const o = d.options!.map(x => x.id);
      g = ans(g, d.kind === 'optional' ? 'yes' : us.every(u => o.includes(u)) && (d.max ?? 1) >= 3 ? us : o[0]);
    }
    if (withSoraka) assert.ok(us.every(u => zone(g, u) === 'base'), 'all three saved by Soraka');
    else assert.ok(us.every(u => zone(g, u) === 'trash'));
    assert.equal(g.players[P0].points, 1, `scored (${withSoraka ? 'with' : 'without'} Soraka)`);
  }
});

test('RJ#12692 FFA: drawing from an empty deck burns out — the trash is recycled and the player chooses which opponent gains the point', () => {
  let g = createGame({ seed: 3, cardDb: fixtureDb(), mode: 'ffa', firstPlayer: P0, skipMulligan: true, battlefieldSelection: 'random', includeAllCards: true,
    players: [0, 1, 2].map(i => ({ name: `P${i}`, deck: legalDeck({}, [`cf-bf-${'abc'[i]}`, `cf-bf-${'def'[i]}`, `cf-bf-${'abc'[(i + 1) % 3]}`]) })) } as never);
  for (let i = 0; i < 10 && !(g.pending?.kind === 'mainAction' && g.pending.player === P0); i++) g = g.pending!.inStep ? act(g, legal(g, g.pending!.player)[0]) : act(g, { type: 'pass', player: g.pending!.player });
  fundAll(g, P0);
  clearDeck(g, P0); fillTrash(g, P0, 4);
  const h0 = g.players[P0].hand.length;
  let asked: string[] = [];
  g = act(g, { type: 'playCard', player: P0, obj: put(g, P0, 'Draw1M', 'hand') });
  for (let i = 0; i < 20 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = act(g, { type: 'pass', player: d.player }); continue; }
    if (d.kind === 'chooseOpponent') { asked = d.options!.map(o => o.id); g = ans(g, '2'); continue; }
    g = ans(g, 'first');
  }
  assert.deepEqual(asked.sort(), ['1', '2'], 'P0 chooses among both opponents');
  assert.equal(g.players[2].points, 1); assert.equal(g.players[P1].points, 0);
  assert.equal(g.players[P0].hand.length, h0 + 1, 'the draw finishes after the recycle');
});

test('RJ#12694 Vi, Peacekeeper kills the defending Glasc Mixologist; its Deathknell plays a unit there → No Result, a new combat: Vi attacks again and her stun triggers again on the new unit', () => {
  let g = S0();
  const gm = put(g, P1, 'Glasc Mixologist', BF_A); control(g, BF_A, P1);
  const nu = put(g, P1, 'V(2)', 'trash');
  const vi = put(g, P0, 'unl-176-219', 'base');
  g = move(g, P0, [vi], BF_A);
  for (let i = 0; i < 60 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    if (d.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: d.player, assignment: (d.data as { suggested: Record<string, number> }).suggested }); continue; }
    if (!d.inStep) { g = act(g, { type: 'pass', player: d.player }); continue; }
    const o = d.options!.map(x => x.id);
    g = ans(g, d.kind === 'optional' ? 'yes' : o.includes(nu) ? [nu] : o.includes(gm) ? [gm] : o.includes(String(BF_A)) ? String(BF_A) : o[0]);
  }
  const txt = g.log.map(l => l.text);
  assert.equal(txt.filter(t => /^Trigger: Vi: Stun/.test(t)).length, 2, 'attack trigger in each combat');
  assert.ok(txt.includes('V(2) is stunned'), 'the new unit is stunned in the second combat');
  assert.equal(g.battlefields[BF_A].controller, P0);
});

test('RJ#12696 Ezreal, Prodigy ("optional additional costs cost [1] less") doesn\'t reduce Kennen, Keeper of Balance\'s attack-stun [2] (a trigger\'s own cost): full [2]', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'sfd-149-221', 'base');
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const k = put(g, P0, 'Kennen, Keeper of Balance', 'base');
  const ready = () => g.players[P0].runesInPlay.filter(r => !g.objects[r].exhausted).length + g.players[P0].pool.energy;
  const before = ready();
  g = drive(move(g, P0, [k], BF_A), ['yes', [e]], x => x.chain.some(c => c.source === k) && !x.pending?.inStep);
  assert.equal(before - ready(), 2, 'paid the full [2]');
  g = drive(g, [], x => x.chain.length === 0);
  assert.equal(g.objects[e].stunned, true);
});

test('RJ#12697 Deceiver: the opponent Gusts my only other unit there in response to the conquer trigger → the reflexive copy has no unit to copy and is removed: a plain Reflection without Temporary', () => {
  let g = withTokens(S0()); fundAll(g, P0); fundAll(g, P1); setLegend(g, P0, 'Deceiver');
  const x = put(g, P0, 'V(3)', 'base'); hand(g, P0, 'V(1)');
  g = move(g, P0, [x], BF_A);
  for (let i = 0; i < 20 && !(g.chain.length > 0 && !g.pending?.inStep); i++) { const d = g.pending!; g = d.inStep ? ans(g, d.kind === 'optional' ? 'yes' : d.options![0].id) : pass(g); }
  assert.ok(chainLabels(g).some(l => /Deceiver/.test(l)), JSON.stringify(chainLabels(g)));
  if (g.pending!.player !== P1) g = pass(g);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Gust') });
  for (let i = 0; i < 6 && g.pending?.inStep; i++) { const d = g.pending; g = ans(g, d.options!.some(o => o.id === x) ? [x] : d.options![0].id); }
  g = drive(g, [], y => y.pending?.kind === 'mainAction');
  const refl = Object.keys(g.objects).find(id => g.objects[id].isToken && ['battlefield', 'base'].includes(g.objects[id].zone));
  assert.equal(zone(g, x), 'hand');
  assert.ok(refl, 'the Reflection was still played');
  assert.equal(chars(g, refl!).name, 'Reflection', 'not a copy');
  assert.ok(!hasKeyword(g, refl!, 'Temporary'), 'no Temporary (reflexive trigger removed)');
});

test('RJ#12712 Thousand-Tailed Watcher\'s play effect (doesn\'t choose) gives an empowered Gangplank, Naval -3 (6 → 3), not +3', () => {
  let g = S0(); fundAll(g, P0, 8);
  const gp = put(g, P1, 'Gangplank, Naval', BF_A); control(g, BF_A, P1);
  g.objects[gp].empowered = 1; g.timestamp++;
  assert.equal(mightOf(g, gp), 6);
  g = drive(act(g, { type: 'playCard', player: P0, obj: put(g, P0, 'Thousand-Tailed Watcher', 'hand'), destination: 'base' }), ['no', 'no'], x => x.pending?.kind === 'mainAction');
  assert.equal(mightOf(g, gp), 3);
});

test('RJ#12718 Star-Crossed in response to Elder Dragon\'s play trigger (my chosen unit + the Dragon): my returned unit is spared, the other target still takes 1 — not lethal now that the Dragon is gone', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1);
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const m = put(g, P1, 'V(2)', 'base');
  const sc = put(g, P1, 'Star-Crossed', 'hand');
  const ed = put(g, P0, 'Elder Dragon', 'hand');
  g = act(g, { type: 'playCard', player: P0, obj: ed, destination: 'base' });
  for (let i = 0; i < 10 && !(g.chain.some(c => c.source === ed) && !g.pending?.inStep); i++) {
    const d = g.pending!;
    if (!d.inStep) { g = act(g, { type: 'pass', player: d.player }); continue; }
    const o = d.options!.map(x => x.id);
    g = ans(g, o.includes(e) ? [e] : o.includes(m) ? [m] : o[0]);
  }
  if (g.pending!.player !== P1) g = pass(g);
  g = act(g, { type: 'playCard', player: P1, obj: sc });
  for (let i = 0; i < 4 && g.pending?.inStep; i++) { const d = g.pending; const o = d.options!.map(x => x.id); g = ans(g, o.includes(m) ? [m] : [ed]); }
  g = drive(g, [], x => x.chain.length === 0 && x.pending?.kind === 'mainAction');
  assert.equal(zone(g, ed), 'hand'); assert.equal(zone(g, m), 'hand');
  assert.equal(zone(g, e), 'battlefield', '1 damage is not lethal any more');
  assert.equal(g.objects[e].damage, 1);
});

test('RJ#12719 my damaged Diana, Lunari is killed by an empowered Akali, Deadly Weapon\'s move trigger as Akali moves in: she dies in the cleanup before the showdown begins — no Diana trigger', () => {
  let g = S0(); fundAll(g, P1);
  const di = put(g, P1, 'unl-079-219', BF_A); control(g, BF_A, P1);
  g.objects[di].damage = mightOf(g, di) - 2; g.timestamp++;
  const ak = put(g, P0, 'ven-021-166', 'base'); g.objects[ak].empowered = 1; g.timestamp++;
  g = move(g, P0, [ak], BF_A);
  let dianaAsked = false;
  for (let i = 0; i < 30 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    if (chainLabels(g).some(l => /Diana/.test(l))) dianaAsked = true;
    if (!d.inStep) { g = act(g, { type: 'pass', player: d.player }); continue; }
    if (d.player === P1) dianaAsked = true;
    const o = d.options!.map(x => x.id);
    g = ans(g, d.kind === 'optional' ? 'yes' : o.includes(di) ? [di] : o[0]);
  }
  assert.equal(zone(g, di), 'trash');
  assert.ok(!dianaAsked, 'Diana\'s showdown trigger never placed');
  assert.equal(g.battlefields[BF_A].controller, P0, 'Akali conquers');
});

test('RJ#12720 Janna, Savior Gusted in response to her play trigger: the trigger resolves but "here" is gone — no heal, no move', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const f = put(g, P0, 'V(4)', BF_A); control(g, BF_A, P0); g.objects[f].damage = 2;
  const en = put(g, P1, 'V(2)', BF_A);
  const j = put(g, P0, 'sfd-053-221', 'hand');
  g = act(g, { type: 'playCard', player: P0, obj: j, destination: BF_A });
  for (let i = 0; i < 10 && !(g.chain.some(c => c.source === j) && !g.pending?.inStep); i++) {
    const d = g.pending!;
    if (!d.inStep) { g = act(g, { type: 'pass', player: d.player }); continue; }
    const o = d.options!.map(x => x.id);
    g = ans(g, o.includes(en) ? [en] : d.kind === 'optional' ? 'yes' : o[0]);
  }
  if (g.pending!.player !== P1) g = pass(g);
  g = act(g, { type: 'playCard', player: P1, obj: put(g, P1, 'Gust', 'hand') });
  for (let i = 0; i < 4 && g.pending?.inStep; i++) g = ans(g, [j]);
  g = drive(g, [], x => x.chain.length === 0);
  assert.equal(zone(g, j), 'hand');
  assert.equal(g.objects[f].damage, 2, 'no heal');
  assert.equal(locOf(g, en), BF_A, 'no move');
});

test('RJ#12727 Atakhan attacks Overzealous Fan\'s battlefield: both triggers go on the chain; the Fan\'s (on top) kills itself and moves Atakhan to base, then Atakhan\'s "kill one of their units here" does nothing', () => {
  let g = S0();
  const fan = put(g, P1, 'Overzealous Fan', BF_A); const o2 = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const at = put(g, P0, 'Atakhan', 'base');
  g = move(g, P0, [at], BF_A);
  let both = false;
  for (let i = 0; i < 40 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    const ls = chainLabels(g);
    if (ls.some(l => /Atakhan/.test(l)) && ls.some(l => /Overzealous Fan/.test(l))) both = true;
    if (d.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: d.player, assignment: (d.data as { suggested: Record<string, number> }).suggested }); continue; }
    if (!d.inStep) { g = act(g, { type: 'pass', player: d.player }); continue; }
    const o = d.options!.map(x => x.id);
    g = ans(g, d.kind === 'optional' ? 'yes' : o.includes(at) ? [at] : o.includes(o2) && d.player === P1 && !o.includes(fan) ? [o2] : o.includes(fan) ? [fan] : o[0]);
  }
  assert.ok(both, 'both triggers on the chain together');
  assert.equal(zone(g, fan), 'trash', 'Fan killed as its cost');
  assert.equal(locOf(g, at), 'base', 'Atakhan moved to base');
  assert.equal(locOf(g, o2), BF_A, 'Atakhan\'s trigger killed nothing');
});

test('RJ#12735 Baited Hook destroyed after its ability is activated: the ability still resolves (my unit dies, I may play a unit from the top 5)', () => {
  let g = S0(); fundAll(g, P0);
  const v = put(g, P0, 'V(2)', 'base');
  const hook = put(g, P0, 'Baited Hook', 'base');
  const top = put(g, P0, 'V(3)', 'deckTop');
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === hook)!);
  for (let i = 0; i < 6 && g.pending?.inStep; i++) { const o = g.pending.options!.map(x => x.id); g = ans(g, o.includes(v) ? [v] : o[0]); }
  assert.ok(g.chain.length > 0, 'ability on the chain');
  // the gear is destroyed in response (stand-in for an opponent's Reaction gear removal)
  g.objects[hook].zone = 'trash'; g.players[P0].base = g.players[P0].base.filter(id => id !== hook); g.players[P0].trash.push(hook); g.ex.dirty = true; g.timestamp++;
  for (let i = 0; i < 20 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = act(g, { type: 'pass', player: d.player }); continue; }
    const o = d.options!.map(x => x.id);
    g = ans(g, o.includes(top) ? [top] : d.kind === 'optional' ? 'yes' : o[0]);
  }
  assert.equal(zone(g, v), 'trash', 'chosen unit killed');
  assert.ok(['base', 'battlefield'].includes(zone(g, top)), 'unit played from the top 5');
});

test('RJ#12757 Lady of Clockwork (Orianna legend) makes an unattached Warmog\'s Armor a unit gear: its Equipment effect text ("When I conquer, buff me") is inactive — conquering doesn\'t buff it', () => {
  let g = S0({ tp: P1 }); setLegend(g, P0, 'Lady of Clockwork');
  const wa = put(g, P0, "Warmog's Armor", 'base');
  g = endTurn(g, P1);
  for (let i = 0; i < 30 && g.pending && !(g.pending.kind === 'mainAction' && g.activePlayer === P0 && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = act(g, { type: 'pass', player: d.player }); continue; }
    const o = d.options!.map(x => x.id);
    g = ans(g, d.kind === 'optional' ? 'yes' : o.includes(wa) ? [wa] : o[0]);
  }
  assert.equal(mightOf(g, wa), 1, 'unit gear with Might = Energy cost');
  g.objects[wa].exhausted = false; g.timestamp++;
  g = drive(move(g, P0, [wa], BF_A), ['first', 'first'], x => x.pending?.kind === 'mainAction');
  assert.equal(g.battlefields[BF_A].controller, P0, 'conquered');
  assert.equal(g.objects[wa].counters?.buff ?? 0, 0, 'no buff');
});

test('RJ#12760 Mournful Witness (4 with Long Sword) takes 2 from an empowered Akali, Deadly Weapon moving in and 2 more as Rogue Assassin moves her out: she dies in that cleanup, before the combat ends — no empower', () => {
  let g = S0(); fundAll(g, P0);
  const leg = setLegend(g, P0, 'Rogue Assassin');
  const mw = put(g, P1, 'Mournful Witness', BF_A); control(g, BF_A, P1);
  const ls = put(g, P1, 'Long Sword', 'base'); attachNow(g, ls, mw);
  assert.equal(mightOf(g, mw), 4);
  const ak = put(g, P0, 'Akali, Deadly Weapon', 'base'); g.objects[ak].empowered = 1; g.timestamp++;
  g = move(g, P0, [ak], BF_A);
  g = drive(g, ['yes', [mw]], x => x.pending?.kind === 'showdownAction' && x.pending.player === P0 && x.chain.length === 0);
  assert.equal(g.objects[mw].damage, 2);
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === leg)!);
  g = drive(g, ['yes', [mw]], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, mw), 'trash', 'dies to 4');
  assert.ok(!g.log.some(l => /Mournful Witness/.test(l.text) && /^Trigger/.test(l.text)), 'her combat-end trigger never fires');
});

test('RJ#12762 unempowered Akali, Deadly Weapon moves in (1) and Rogue Assassin moves her out (1) against a lone 2-Might defender with Wuju Bladesman (+2 defending alone): 2 of 4 → it survives and is healed', () => {
  let g = S0(); fundAll(g, P0);
  const leg = setLegend(g, P0, 'Rogue Assassin');
  setLegend(g, P1, 'Wuju Bladesman');
  const d = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const ak = put(g, P0, 'Akali, Deadly Weapon', 'base');
  g = move(g, P0, [ak], BF_A);
  g = drive(g, ['yes', [d]], x => x.pending?.kind === 'showdownAction' && x.pending.player === P0 && x.chain.length === 0);
  assert.equal(g.objects[d].damage, 1);
  assert.equal(mightOf(g, d), 4, 'defending alone: +2');
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === leg)!);
  g = drive(g, ['yes', [d]], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, d), 'battlefield', 'survives');
  assert.equal(g.objects[d].damage, 0, 'healed by the combat cleanup');
});

test('RJ#12766 Svellsongur on Riven (ven-041): two "when I attack" triggers, each dealing 2 per attached Equipment (Svellsongur counts) → 4 total', () => {
  let g = S0();
  const e = put(g, P1, 'V(6)', BF_A); control(g, BF_A, P1);
  const rv = put(g, P0, 'ven-041-166', 'base');
  const sv = put(g, P0, 'Svellsongur', 'base'); attachNow(g, sv, rv);
  g = move(g, P0, [rv], BF_A);
  let most = 0;
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'assignDamage' && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    most = Math.max(most, g.chain.filter(c => c.source === rv || c.source === sv).length);
    if (!d.inStep) { if (g.chain.length === 0 && d.kind === 'showdownAction') break; g = act(g, { type: 'pass', player: d.player }); continue; }
    const o = d.options!.map(x => x.id);
    g = ans(g, o.includes(e) ? [e] : o[0]);
  }
  assert.equal(most, 2, 'two attack triggers');
  assert.equal(g.objects[e].damage, 4);
});

test('RJ#12770 K\'Sante, Dauntless doubling a Shield 2 unit: +2 (Shield 4); a second doubling trigger adds the current 4 → Shield 8', () => {
  let g = S0({ tp: P1 });
  put(g, P0, "K'Sante, Dauntless", BF_A); put(g, P0, "K'Sante, Dauntless", BF_A);
  const bs = put(g, P0, 'Blue Sentinel', BF_A); control(g, BF_A, P0);
  const a = put(g, P1, 'V(1)', 'base');
  assert.equal(kwValue(g, bs, 'Shield'), 2);
  g = move(g, P1, [a], BF_A);
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'assignDamage' && !(g.chain.length === 0 && g.pending.kind === 'showdownAction'); i++) {
    const d = g.pending;
    if (!d.inStep) { g = act(g, { type: 'pass', player: d.player }); continue; }
    const o = d.options!.map(x => x.id);
    g = ans(g, o.includes(bs) ? [bs] : o[0]);
  }
  assert.equal(kwValue(g, bs, 'Shield'), 8, '2 → 4 → 8');
});

test('RJ#12771 hidden Elnuk Herd\'s play effect on my unit; I Thrill of the Hunt the Herd in response: the hidden play effect mistargets (source gone), only the replayed Herd\'s +3 applies and it isn\'t recycled', () => {
  let g = S0(); fundAll(g, P0, 8);
  const f = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const el = put(g, P0, 'Elnuk Herd', { facedown: BF_A });
  g = act(g, { type: 'playCard', player: P0, obj: el });
  for (let i = 0; i < 6 && g.pending?.inStep; i++) { const o = g.pending.options!.map(x => x.id); g = ans(g, o.includes(f) ? [f] : o[0]); }
  assert.ok(g.chain.some(c => c.source === el), 'play effect on the chain');
  g = act(g, { type: 'playCard', player: P0, obj: put(g, P0, 'Thrill of the Hunt', 'hand') });
  let thrillTarget = true;
  for (let i = 0; i < 30 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = act(g, { type: 'pass', player: d.player }); continue; }
    const o = d.options!.map(x => x.id);
    if (thrillTarget && o.includes(el)) { thrillTarget = false; g = ans(g, [el]); continue; }   // Thrill banishes the Herd
    g = ans(g, o.includes(f) ? [f] : o.includes(String(BF_A)) ? String(BF_A) : o[0]);    // the replayed Herd's +3 on my unit
  }
  assert.equal(mightOf(g, f), 5, 'only one +3');
  const herd = unitsNamed(g, 'Elnuk Herd');
  assert.equal(herd.length, 1, 'the replayed Herd stays on the board (not recycled)');
});

test('RJ#12775 attacker at 5 thanks to Assault 2 (Laurent Duelist) takes 4 from Void Seeker, then the lone defender is Gusted: the combat cleanup heals it before designations end — it survives', () => {
  let g = S0({ tp: P0 }); fundAll(g, P1, 8);
  const d = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'Laurent Duelist', 'base');
  g = move(g, P0, [a], BF_A);
  g = drive(g, [], x => x.pending?.kind === 'showdownAction' && x.chain.length === 0);
  assert.equal(mightOf(g, a), 5, '3 + Assault 2');
  if (g.pending!.player !== P1) g = pass(g);
  g = drive(act(g, { type: 'playCard', player: P1, obj: put(g, P1, 'Void Seeker', 'hand') }), [[a]], x => x.chain.length === 0 && x.pending?.kind === 'showdownAction');
  assert.equal(g.objects[a].damage, 4);
  if (g.pending!.player !== P1) g = pass(g);
  g = drive(act(g, { type: 'playCard', player: P1, obj: put(g, P1, 'Gust', 'hand') }), [[d]], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, d), 'hand');
  assert.equal(zone(g, a), 'battlefield', 'survives');
  assert.equal(g.objects[a].damage, 0, 'healed by the combat cleanup');
});

test('RJ#12782 Deceiver (LeBlanc legend): once the copy has resolved, the copied unit dying doesn\'t revert the Reflection', () => {
  let g = withTokens(S0()); fundAll(g, P0); setLegend(g, P0, 'Deceiver');
  const x = put(g, P0, 'V(3)', 'base'); hand(g, P0, 'V(1)');
  g = move(g, P0, [x], BF_A);
  g = drive(g, ['yes', 'first', 'first', 'first', 'first'], y => y.pending?.kind === 'mainAction');
  const refl = Object.keys(g.objects).find(id => g.objects[id].isToken && g.objects[id].zone === 'battlefield')!;
  assert.ok(refl, 'Reflection entered');
  assert.equal(chars(g, refl).name, 'V(3)', 'copied');
  g = drive(play(g, P0, hand(g, P0, 'Void Seeker'), { targets: [[x]] }), [[x]], y => y.pending?.kind === 'mainAction');
  assert.equal(zone(g, x), 'trash', 'original dead');
  assert.equal(chars(g, refl).name, 'V(3)', 'still a copy');
  assert.equal(mightOf(g, refl), 3);
});

test('RJ#12783 Svellsongur on Yasuo, Windrider: two "third time I move" triggers → 2 points on the third move (none on the first two)', () => {
  let g = S0(); fundAll(g, P0, 12);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const y = put(g, P0, 'Yasuo, Windrider', 'base');
  const sv = put(g, P0, 'Svellsongur', 'base'); attachNow(g, sv, y);
  for (const dest of [BF_A, 'base'] as const) {
    g = play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[y]] });
    g = drive(g, [String(dest), String(dest)], x => x.pending?.kind === 'mainAction');
    assert.equal(locOf(g, y), dest);
  }
  assert.equal(g.players[P0].points, 0, 'two moves: nothing yet');
  g = drive(move(g, P0, [y], BF_A), ['first', 'first'], x => x.pending?.kind === 'mainAction');
  assert.equal(g.players[P0].points, 2, 'two instances, 1 point each');
});

test('RJ#12785 Virtuoso (Jhin legend): Dredge Up played with Flow [2] doesn\'t trigger it; a [4]-energy Flow spell (Brittle Steel) still ends in banishment either way', () => {
  let g = S0(); fundAll(g, P0, 12); setLegend(g, P0, 'Virtuoso');
  const du = put(g, P0, 'Dredge Up', 'trash');
  g = act(g, { type: 'playCard', player: P0, obj: du });
  let offered = false;
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    if (d.kind === 'optional') offered = true;
    g = d.inStep ? ans(g, d.kind === 'optional' ? 'yes' : 'first') : pass(g);
  }
  assert.ok(!offered, 'spent only 2: no Virtuoso trigger');
  assert.equal(zone(g, du), 'banishment', 'Flow banishes it');
  const gear = put(g, P1, 'Long Sword', 'base');
  const bs = put(g, P0, 'Brittle Steel', 'trash');
  g = act(g, { type: 'playCard', player: P0, obj: bs });
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    g = d.inStep ? ans(g, d.kind === 'optional' ? 'yes' : d.options!.some(o => o.id === gear) ? [gear] : 'first') : pass(g);
  }
  assert.equal(zone(g, gear), 'trash');
  assert.equal(zone(g, bs), 'banishment');
});

test('RJ#12787 Imperial Decree active, I attack, then Cannon Barrage in the showdown: the damaged defenders are killed by the Decree before combat damage — my attackers take nothing', () => {
  let g = S0(); fundAll(g, P0, 12);
  const def = [put(g, P1, 'V(5)', BF_A), put(g, P1, 'V(5)', BF_A)]; control(g, BF_A, P1);
  const a = put(g, P0, 'V(3)', 'base');
  g = drive(play(g, P0, hand(g, P0, 'Imperial Decree')), [], x => x.pending?.kind === 'mainAction');
  g = drive(move(g, P0, [a], BF_A), [], x => x.pending?.kind === 'showdownAction' && x.chain.length === 0);
  if (g.pending!.player !== P0) g = pass(g);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Cannon Barrage') }), [], x => x.pending?.kind === 'mainAction');
  for (const d of def) assert.equal(zone(g, d), 'trash', 'killed by the Decree');
  assert.equal(zone(g, a), 'battlefield');
  assert.equal(g.objects[a].damage, 0, 'no combat damage');
});

test('RJ#12788 Decree of Strength can choose a Signature spell that is a Mind card (Fox-Fire, Calm–Mind) from the revealed hand', () => {
  let g = S0(); fundAll(g, P0);
  const ff = hand(g, P1, 'Fox-Fire');
  hand(g, P1, 'Gust');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Decree of Strength') }), ['first', [ff]]);
  assert.equal(g.players[P1].mainDeck.at(-1), ff, 'recycled');
});

test('RJ#12793 The Harrowing choosing Baron Nashor is countered: only The Harrowing\'s [2] Chaos power is spent (Baron\'s [3] never paid); resolved → 5 in total', () => {
  for (const counter of [true, false]) {
    let g = S0(); setRunes(g, P0, 12, 'chaos'); fundAll(g, P1);
    const baron = put(g, P0, 'Baron Nashor', 'trash');
    const hr = hand(g, P0, 'The Harrowing');
    const before = g.players[P0].runesInPlay.length;
    g = act(g, { type: 'playCard', player: P0, obj: hr });
    for (let i = 0; i < 6 && g.pending?.inStep; i++) { const o = g.pending.options!.map(x => x.id); g = ans(g, o.includes(baron) ? [baron] : o[0]); }
    if (counter) {
      if (g.pending!.player !== P1) g = pass(g);
      g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Wind Wall') });
      for (let i = 0; i < 6 && g.pending?.inStep; i++) { const o = g.pending.options!.map(x => x.id); g = ans(g, o.includes(hr) ? [hr] : o[0]); }
    }
    g = drive(g, ['first', 'first'], x => x.pending?.kind === 'mainAction');
    const spent = before - g.players[P0].runesInPlay.length;
    if (counter) { assert.equal(zone(g, baron), 'trash'); assert.equal(spent, 2, 'lose 2 power'); }
    else { assert.notEqual(zone(g, baron), 'trash', 'Baron played'); assert.equal(spent, 5, '2 + 3'); }
  }
});

test('RJ#12796 Virtuoso (Jhin legend): Consult the Past played from facedown spends no Energy → no banish trigger; from hand (4 Energy) → offered', () => {
  for (const hidden of [true, false]) {
    let g = S0(); fundAll(g, P0, 12); setLegend(g, P0, 'Virtuoso');
    put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
    const cp = hidden ? put(g, P0, 'Consult the Past', { facedown: BF_A }) : hand(g, P0, 'Consult the Past');
    g = act(g, { type: 'playCard', player: P0, obj: cp });
    let offered = false;
    for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) {
      const d = g.pending;
      if (d.kind === 'optional' && /Virtuoso|banish/i.test(d.prompt ?? '')) offered = true;
      g = d.inStep ? ans(g, d.kind === 'optional' ? 'no' : 'first') : pass(g);
    }
    assert.equal(offered, !hidden, hidden ? 'hidden: 0 Energy spent' : 'from hand: 4 spent');
  }
});

test('RJ#12800 Sprite Mother (1st card) plays a Sprite token — not a card; Darius, Trifarian next is the second card → readied, +2', () => {
  let g = withTokens(S0()); fundAll(g, P0, 8);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Sprite Mother'), destination: 'base' }), ['first', 'first'], x => x.pending?.kind === 'mainAction');
  assert.equal(unitsNamed(g, 'Sprite').length, 1, 'Sprite token played');
  const d = hand(g, P0, 'ogn-027-298');
  g = drive(act(g, { type: 'playCard', player: P0, obj: d, destination: 'base' }), ['first', 'first'], x => x.pending?.kind === 'mainAction');
  assert.equal(g.objects[d].exhausted, false, 'readied');
  assert.equal(mightOf(g, d), 7);
});

test('RJ#12803 Arise! with 4 Equipment each attached to a unit (+ a Gold token, not Equipment): 4 Sand Soldiers', () => {
  let g = withTokens(S0()); fundAll(g, P0, 8);
  for (let i = 0; i < 4; i++) attachNow(g, put(g, P0, 'Long Sword', 'base'), put(g, P0, 'V(1)', 'base'));
  put(g, P0, 'Gold', 'base');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Arise!') }), Array(12).fill('first'), x => x.pending?.kind === 'mainAction');
  assert.equal(unitsNamed(g, 'Sand Soldier').length, 4);
});

test('RJ#12805 an already exhausted unit can\'t pay an "exhaust a friendly unit" cost: Ki Burst isn\'t playable with only an exhausted friendly unit (ready one → playable)', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'V(2)', 'base'); g.objects[u].exhausted = true;
  put(g, P1, 'V(2)', 'base');
  const kb = hand(g, P0, 'Ki Burst');
  assert.ok(!canPlayNow(g, P0, kb), 'no ready friendly unit to exhaust');
  g.objects[u].exhausted = false; g.timestamp++;
  assert.ok(canPlayNow(g, P0, kb));
});

test('RJ#12809 Thrill of the Hunt on my only unit at a battlefield with my hidden card: replayed there → control never lapses, the hidden card stays; replayed elsewhere → it is trashed', () => {
  for (const same of [true, false]) {
    let g = S0(); fundAll(g, P0);
    const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
    const fd = put(g, P0, 'Consult the Past', { facedown: BF_A });
    const dest = String(same ? BF_A : BF_B);
    g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Thrill of the Hunt') });
    for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
      const d = g.pending;
      if (!d.inStep) { g = pass(g); continue; }
      const o = d.options!.map(x => x.id);
      g = ans(g, o.includes(u) ? [u] : o.includes(dest) ? dest : o[0]);
    }
    const nu = unitsNamed(g, 'V(2)')[0];
    assert.equal(locOf(g, nu), same ? BF_A : BF_B);
    assert.equal(zone(g, fd), same ? 'facedown' : 'trash', same ? 'hidden card stays' : 'lost control → trashed');
  }
});

test('RJ#12813 Wages of Pain kills Ravenbloom Prefect (3 damage) and plays a Gold token: the Prefect dies in the cleanup before its trigger finalizes — no banish, the Gold stays', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  const pr = put(g, P1, 'Ravenbloom Prefect', BF_A); control(g, BF_A, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Wages of Pain') });
  let offered = false;
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    if (d.player === P1 && d.kind === 'optional') { offered = true; g = ans(g, 'yes'); continue; }
    const o = d.options!.map(x => x.id);
    g = ans(g, o.includes(pr) ? [pr] : o[0]);
  }
  assert.equal(zone(g, pr), 'trash', 'Prefect died');
  assert.ok(!offered, 'its trigger could not be finalized');
  assert.ok(Object.keys(g.objects).some(id => g.cards[g.objects[id].cardId]?.name === 'Gold' && g.objects[id].zone === 'base'), 'Gold token stays');
});

test('RJ#12819 Stalwart Goatherd may kill an attached Blade of the Exile (cost 3): it goes to the trash, the unit survives without Ganking', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P1, 'V(2)', 'base');
  const bl = put(g, P1, 'Blade of the Exile', 'base'); attachNow(g, bl, u);
  assert.ok(hasKeyword(g, u, 'Ganking'));
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Stalwart Goatherd'), destination: 'base' }), ['yes', [bl], [bl]], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, bl), 'trash');
  assert.equal(zone(g, u), 'base');
  assert.ok(!hasKeyword(g, u, 'Ganking'));
});

test('RJ#12821 (AMBIGUOUS, RJ adopted) a Bomb token dying at Void Gate deals 2 + 1 Bonus Damage = 3 to the enemy unit there (one instance)', () => {
  let g = withTokens(S0()); fundAll(g, P0, 8);
  setBattlefieldCard(g, BF_A, 'Void Gate');
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Amateur Demolitionist'), destination: 'base' }), ['first', String(BF_A), String(BF_A)], x => x.pending?.kind === 'mainAction');
  const bomb = Object.keys(g.objects).find(id => g.cards[g.objects[id].cardId]?.name === 'Bomb' && g.objects[id].zone === 'battlefield');
  assert.ok(bomb, 'Bomb at Void Gate');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'rad-142-167') }), [[bomb!], [e], 'first'], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, e), 'trash', 'took 3');
});

test('RJ#12825 Lady of Clockwork turning my gear into a unit gear isn\'t playing a unit: an enemy Vex, Apathetic at a battlefield doesn\'t stun it', () => {
  let g = S0({ tp: P1 }); setLegend(g, P0, 'Lady of Clockwork');
  put(g, P1, 'Vex, Apathetic', BF_B); control(g, BF_B, P1);
  const ls = put(g, P0, 'Long Sword', 'base');
  g = endTurn(g, P1);
  for (let i = 0; i < 30 && g.pending && !(g.pending.kind === 'mainAction' && g.activePlayer === P0 && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = act(g, { type: 'pass', player: d.player }); continue; }
    const o = d.options!.map(x => x.id);
    g = ans(g, d.kind === 'optional' ? 'yes' : o.includes(ls) ? [ls] : o[0]);
  }
  assert.ok(mightOf(g, ls) > 0, 'now a unit gear');
  assert.ok(!g.objects[ls].stunned, 'not stunned');
  assert.ok(!g.log.some(l => /Resolving Vex/.test(l.text)), 'Vex didn\'t trigger');
});

test('RJ#12828 Sett, Brawler: spend the buff (+4), get a new buff from Pit Rookie, spend it again (+4) → +8 this turn', () => {
  let g = S0(); fundAll(g, P0, 8);
  const st = hand(g, P0, 'ogn-164-298');
  g = drive(act(g, { type: 'playCard', player: P0, obj: st, destination: 'base' }), ['first'], x => x.pending?.kind === 'mainAction');
  const base = mightOf(g, st);   // 4 + buff 1
  const spend = (g: ReturnType<typeof S0>) => drive(act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === st)!), ['first'], x => x.pending?.kind === 'mainAction');
  g = spend(g);
  assert.equal(mightOf(g, st), base - 1 + 4);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Pit Rookie'), destination: 'base' }), [[st], 'first'], x => x.pending?.kind === 'mainAction');
  assert.equal(mightOf(g, st), base + 4, 'buffed again');
  g = spend(g);
  assert.equal(mightOf(g, st), base - 1 + 8);
});

test('RJ#12829 Nidalee, Cat Form trading in combat draws nothing — both sides dead (no result) or a friendly survivor wins without her', () => {
  for (const withFriend of [false, true]) {
    const { g: g0, atk } = attackSetup(withFriend ? ['unl-114-219', 'V(5)'] : ['unl-114-219'], ['V(4)']);
    const h = g0.players[P0].hand.length;
    let g = g0;
    for (let i = 0; i < 60 && g.pending && !(g.pending.kind === 'mainAction'); i++) {
      const d = g.pending;
      if (d.kind === 'assignDamage') {   // the defender's 4 all on Nidalee
        const asg: Record<string, number> = { ...(d.data as { suggested: Record<string, number> }).suggested };
        if (d.player === P1) { for (const k of Object.keys(asg)) asg[k] = 0; asg[atk[0]] = 4; }
        g = act(g, { type: 'assignDamage', player: d.player, assignment: asg }); continue;
      }
      g = d.inStep ? ans(g, 'first') : pass(g);
    }
    assert.equal(zone(g, atk[0]), 'trash', 'Nidalee died');
    assert.equal(g.players[P0].hand.length, h, 'no draw');
  }
});

test('RJ#12830 Nidalee, Cat Form trading in combat but saved by Zhonya\'s Hourglass: recalled to base, didn\'t win the combat → no draw', () => {
  const { g: g0, atk } = attackSetup(['unl-114-219'], ['V(4)']);
  put(g0, P0, "Zhonya's Hourglass", 'base');
  const h = g0.players[P0].hand.length;
  let g = g0;
  for (let i = 0; i < 60 && g.pending && !(g.pending.kind === 'mainAction'); i++) {
    const d = g.pending;
    if (d.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: d.player, assignment: (d.data as { suggested: Record<string, number> }).suggested }); continue; }
    g = d.inStep ? ans(g, d.kind === 'optional' ? 'yes' : 'first') : pass(g);
  }
  assert.equal(locOf(g, atk[0]), 'base', 'saved and recalled');
  assert.equal(g.players[P0].hand.length, h, 'no draw');
});

test('RJ#12833 Not So Fast can\'t counter Ziggs, Explosive\'s defend trigger (it chooses none of my units/gear — the killed gear is his own)', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const z = put(g, P1, 'rad-112-167', BF_A); control(g, BF_A, P1);
  put(g, P1, 'Long Sword', 'base');
  const a = put(g, P0, 'V(3)', 'base');
  const nsf = hand(g, P0, 'Not So Fast');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 10 && g.pending?.inStep; i++) g = ans(g, g.pending.kind === 'optional' ? 'yes' : 'first');
  assert.ok(g.chain.some(c => c.source === z), 'Ziggs\'s trigger on the chain');
  if (g.pending!.player !== P0) g = pass(g);
  assert.equal(g.pending!.player, P0, 'I have priority');
  assert.ok(canPlayNow(g, P0, hand(g, P0, 'Stupefy')), 'Reactions are playable now');
  assert.ok(!canPlayNow(g, P0, nsf), 'no legal target for Not So Fast');
});

test('RJ#12834 (AMBIGUOUS, RJ adopted) Not So Fast can\'t stop a Bomb being played (no unit/gear chosen) but can counter its death trigger choosing my unit: no damage', () => {
  let g = withTokens(S0({ tp: P1 })); fundAll(g, P0); fundAll(g, P1, 8);
  const mine = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const nsf = hand(g, P0, 'Not So Fast');
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Amateur Demolitionist'), destination: 'base' });
  g = drive(g, [], x => x.chain.some(c => c.kind === 'trigger') && x.pending?.player === P0 && !x.pending.inStep);
  assert.ok(!canPlayNow(g, P0, nsf), 'the Bomb-playing trigger chooses no unit/gear');
  g = drive(g, ['first', String(BF_A), String(BF_A)], x => x.pending?.kind === 'mainAction');
  const bomb = Object.keys(g.objects).find(id => g.cards[g.objects[id].cardId]?.name === 'Bomb' && g.objects[id].zone === 'battlefield')!;
  assert.ok(bomb);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'rad-142-167') });
  for (let i = 0; i < 6 && g.pending?.inStep; i++) g = ans(g, [bomb]);
  g = drive(g, [[mine]], x => x.chain.some(c => c.source === bomb) && x.pending?.player === P0 && !x.pending.inStep);
  assert.ok(canPlayNow(g, P0, nsf), 'the death trigger chose my unit');
  g = act(g, { type: 'playCard', player: P0, obj: nsf });
  g = drive(g, ['first', 'first'], x => x.pending?.kind === 'mainAction');
  assert.equal(g.objects[mine].damage, 0, 'countered');
  assert.equal(zone(g, bomb) === 'battlefield', false, 'the Bomb still died');
});

test('RJ#12835 Grand Duelist (Fiora legend) triggers on the opponent\'s turn: my defender pumped to Mighty in their combat showdown', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0);
  setLegend(g, P0, 'Grand Duelist');
  const d0 = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const a = put(g, P1, 'V(1)', 'base');
  g = drive(move(g, P1, [a], BF_A), [], x => x.pending?.kind === 'showdownAction' && x.chain.length === 0);
  if (g.pending!.player !== P0) g = pass(g);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Battle Preparations') });
  for (let i = 0; i < 6 && g.pending?.inStep; i++) { const o = g.pending.options!.map(x => x.id); g = ans(g, o.includes(d0) ? [d0] : g.pending.kind === 'optional' ? 'no' : o[0]); }
  let duel = false;
  for (let i = 0; i < 30 && g.pending && g.chain.length + (g.pending.inStep ? 1 : 0) > 0; i++) {
    const d = g.pending;
    if (g.chain.some(c => /Grand Duelist/.test(String(c.label))) || /Grand Duelist/.test(d.prompt ?? '')) duel = true;
    g = d.inStep ? ans(g, d.kind === 'optional' ? 'yes' : d.options![0].id) : pass(g);
  }
  assert.equal(mightOf(g, d0), 5, 'Mighty');
  assert.ok(duel || g.log.some(l => /Trigger: Grand Duelist/.test(l.text)), 'Grand Duelist triggered on the opponent\'s turn');
});

test('RJ#12839 Decree of Focus in response to the opponent\'s Realm of Death (Fury) choosing my unit: +4 first, then -2 and the damage exchange uses the boosted Might', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const mine = put(g, P0, 'V(3)', 'base'), theirs = put(g, P1, 'V(2)', 'base');
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Realm of Death') });
  for (let i = 0; i < 6 && g.pending?.inStep; i++) { const o = g.pending.options!.map(x => x.id); g = ans(g, o.includes(mine) ? [mine] : o.includes(theirs) ? [theirs] : o[0]); }
  if (g.pending!.player !== P0) g = pass(g);
  const df = hand(g, P0, 'Decree of Focus');
  assert.ok(canPlayNow(g, P0, df), 'my unit is being chosen by an enemy Fury spell');
  g = drive(act(g, { type: 'playCard', player: P0, obj: df }), [[mine]], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, theirs), 'trash', 'took 3 + 4 - 2 = 5');
  assert.equal(zone(g, mine), 'base', '5 Might, took 4');
  assert.equal(g.objects[mine].damage, 4);
});

test('RJ#12841 (AMBIGUOUS, RJ adopted) Primordial Roar\'s Show Off can\'t pick the Chosen Champion in the Champion Zone (not a unit on the board, not in hand)', () => {
  let g = S0(); fundAll(g, P0);
  const champ = g.players[P0].championZone[0];
  assert.ok(champ);
  const fr = put(g, P0, 'V(2)', 'base');
  put(g, P1, 'V(1)', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Primordial Roar') });
  const seen = new Set<string>();
  for (let i = 0; i < 6 && g.pending?.inStep; i++) {
    for (const o of g.pending.options!) { seen.add(o.id); for (const id of (o as { objIds?: string[] }).objIds ?? []) seen.add(id); }
    g = ans(g, g.pending.options!.some(o => o.id === fr) ? [fr] : 'first');
  }
  assert.ok(seen.has(fr), 'a friendly unit can be picked');
  assert.ok(!seen.has(champ), 'the champion in the Champion Zone is never offered');
});

test('RJ#12846 (house principle 17 / rules-decisions #64) empowered Ambessa, Respected and Feared attacks; the defender Temporal Breaches her (hidden) in response to her attack trigger: her trigger refers to its source, now a new object → the kill is ignored', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const e = put(g, P1, 'V(4)', BF_A), big = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const tb = put(g, P1, 'Temporal Breach', { facedown: BF_A });
  const am = put(g, P0, 'ven-136-166', 'base'); g.objects[am].empowered = 1; g.timestamp++;
  g = move(g, P0, [am], BF_A);
  let played = false;
  for (let i = 0; i < 60 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    if (d.kind === 'assignDamage') {   // all combat damage onto the 9-Might unit, so only the trigger could kill V(4)
      const asg: Record<string, number> = { ...(d.data as { suggested: Record<string, number> }).suggested };
      if (d.player === P0) { const tot = Object.values(asg).reduce((a, b) => a + b, 0); for (const k of Object.keys(asg)) asg[k] = 0; asg[big] = tot; }
      g = act(g, { type: 'assignDamage', player: d.player, assignment: asg }); continue;
    }
    if (!played && d.player === P1 && !d.inStep && g.chain.some(c => c.source === am) && canPlayNow(g, P1, tb)) { g = act(g, { type: 'playCard', player: P1, obj: tb }); played = true; continue; }
    if (d.inStep) { const o = d.options!.map(x => x.id); g = ans(g, played && o.includes(am) ? [am] : o.includes(e) ? [e] : o.includes(am) ? [am] : d.kind === 'optional' ? 'yes' : o[0]); continue; }
    g = pass(g);
  }
  assert.ok(played, 'Breach played in response to the attack trigger');
  assert.notEqual(zone(g, e), 'trash', 'the old trigger did not kill V(4)');
});

test('RJ#12847 Sanction\'s "Empower a unit" mode can choose an enemy unit (any unit); an already Empowered unit is still a legal choice', () => {
  let g = S0(); fundAll(g, P0, 8);
  const en = put(g, P1, 'Steel Paws', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Sanction') });
  g = drive(g, [/^Empower/i, [en]], x => x.pending?.kind === 'mainAction');
  assert.ok(g.objects[en].empowered, 'enemy unit empowered');
  put(g, P0, 'V(1)', 'base');   // a second candidate, so the choice is shown
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Sanction') });
  g = ans(g, /^Empower/i);
  assert.ok(g.pending?.options?.some(o => o.id === en), 'already Empowered unit still choosable');
});

test('RJ#12850 (AMBIGUOUS, RJ adopted) the opponent kills my Dockside Lock-Up: no trigger (no Deathknell) — the banished card stays banished', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(5)', BF_A);
  const dl = hand(g, P0, 'Dockside Lock-Up');
  g = drive(act(g, { type: 'playCard', player: P0, obj: dl, destination: BF_A }), [[e], [e]], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, e), 'banishment');
  g = endTurn(g, P0); g = drive(g, [], x => x.pending?.kind === 'mainAction' && x.activePlayer === P1);
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Brittle Steel') }), [[dl]], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, dl), 'trash', 'Lock-Up killed');
  assert.equal(zone(g, e), 'banishment', 'nothing played back');
});

test('RJ#12851 (AMBIGUOUS, RJ adopted) Baron Nashor played "to" Star Spring enters the Baron Pit instead: no unit is played there, Star Spring doesn\'t trigger', () => {
  let g = S0(); fundAll(g, P0, 12);
  setBattlefieldCard(g, BF_A, 'Star Spring');
  const u = put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const b = hand(g, P0, 'Baron Nashor');
  g = act(g, { type: 'playCard', player: P0, obj: b, destination: BF_A });
  let spring = false;
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    if (/Star Spring/.test(d.prompt ?? '') || g.chain.some(c => /Star Spring/.test(String(c.label)))) spring = true;
    g = d.inStep ? ans(g, d.kind === 'optional' ? 'yes' : 'first') : pass(g);
  }
  assert.notEqual(locOf(g, b), BF_A, 'Baron is in the Pit');
  assert.ok(!spring && !g.log.some(l => /Star Spring/.test(l.text) && /Trigger|Resolving/.test(l.text)), 'no Star Spring trigger');
  assert.equal(locOf(g, u), BF_A);
});

test('RJ#12852 with the Baron Pit already on the board, a second Baron Nashor played to Star Spring enters there → Star Spring triggers', () => {
  let g = S0(); fundAll(g, P0, 12); addRunes(g, P0, 12, 'chaos');
  setBattlefieldCard(g, BF_A, 'Star Spring');
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const b1 = hand(g, P0, 'Baron Nashor');
  g = drive(act(g, { type: 'playCard', player: P0, obj: b1, destination: 'base' }), ['first', 'first'], x => x.pending?.kind === 'mainAction');
  assert.notEqual(locOf(g, b1), 'base', 'first Baron in the Pit');
  const b2 = hand(g, P0, 'Baron Nashor');
  g = act(g, { type: 'playCard', player: P0, obj: b2, destination: BF_A });
  let spring = false;
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    if (/Star Spring/.test(d.prompt ?? '') || g.chain.some(c => /Star Spring/.test(String(c.label)))) spring = true;
    g = d.inStep ? ans(g, d.kind === 'optional' ? 'no' : 'first') : pass(g);
  }
  assert.equal(locOf(g, b2), BF_A, 'entered Star Spring');
  assert.ok(spring || g.log.some(l => /Star Spring/.test(l.text) && /Trigger/.test(l.text)), 'Star Spring triggered');
});

test('RJ#12853 (AMBIGUOUS, RJ adopted) Baron Nashor played to my Hunters\' Circle gets its [1] discount even though he enters the Baron Pit (cost uses the chosen play location)', () => {
  let g = S0(); fundAll(g, P0, 12);
  setBattlefieldCard(g, BF_A, "Hunters' Circle");
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const b = hand(g, P0, 'Baron Nashor');
  assert.equal(playCostOf(g, P0, b, { dest: BF_A })!.energy, 9, '10 - 1');
  assert.equal(playCostOf(g, P0, b, { dest: 'base' })!.energy, 10);
});

test('RJ#12858 (AMBIGUOUS, RJ adopted) the opponent holds a battlefield with my Bomb token: they score first, then Deploy kills the Bomb and its 2 damage kills their unit — the point stays', () => {
  let g = withTokens(S0({ tp: P1 })); fundAll(g, P1, 8);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Amateur Demolitionist'), destination: 'base' }), ['first', String(BF_A), String(BF_A)], x => x.pending?.kind === 'mainAction');
  const bomb = Object.keys(g.objects).find(id => g.cards[g.objects[id].cardId]?.name === 'Bomb' && g.objects[id].zone === 'battlefield');
  assert.ok(bomb && locOf(g, bomb) === BF_A, 'Bomb at my battlefield');
  const pts = g.players[P0].points;
  g = endTurn(g, P1);
  g = drive(g, ['first', 'first', [u], 'first'], x => x.pending?.kind === 'mainAction' && x.activePlayer === P0);
  assert.equal(g.players[P0].points, pts + 1, 'hold scored');
  assert.notEqual(zone(g, bomb!), 'battlefield', 'Deploy killed the Bomb');
  assert.equal(zone(g, u), 'trash', 'Bomb dealt 2');
});

test('RJ#12859 Pillaged Armory deployed to a battlefield may buff a friendly unit in my base ("a friendly unit" has no "here")', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const b = put(g, P0, 'V(1)', 'base');
  const pa = hand(g, P0, 'Pillaged Armory');
  g = act(g, { type: 'playCard', player: P0, obj: pa, destination: BF_A });
  let offered = false;
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    const o = d.options!.map(x => x.id);
    if (o.includes(b)) { offered = true; g = ans(g, [b]); continue; }
    g = ans(g, o.includes(String(BF_A)) ? String(BF_A) : o[0]);
  }
  assert.ok(offered, 'base unit choosable');
  assert.equal(locOf(g, pa), BF_A);
  assert.equal(mightOf(g, b), 2, 'buffed');
});

test('RJ#12863 my unit already chosen by an enemy damage spell becomes "can\'t be chosen" (Twilight Shroud with Reaction from Kai\'Sa, Rebel in the showdown): the spell does nothing to it', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const ks = put(g, P0, 'rad-063-167', 'base'), v = put(g, P0, 'V(3)', 'base');
  g = drive(move(g, P0, [ks, v], BF_A), ['first', 'first', 'first'], x => x.pending?.kind === 'showdownAction' && x.chain.length === 0);
  if (g.pending!.player !== P1) g = pass(g);
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Void Seeker') }), [[v]], x => x.pending?.player === P0 && !x.pending.inStep && x.chain.length > 0);
  const ts = hand(g, P0, 'Twilight Shroud');
  assert.ok(canPlayNow(g, P0, ts), 'Reaction thanks to Kai\'Sa');
  g = act(g, { type: 'playCard', player: P0, obj: ts });
  for (let i = 0; i < 4 && g.pending?.inStep; i++) g = ans(g, g.pending.options!.some(o => o.id === v) ? [v] : 'first');
  g = drive(g, [], x => x.chain.length === 0);
  assert.equal(g.objects[v].damage, 0, 'no damage from the spell that had chosen it');
});

test('RJ#12864 (AMBIGUOUS, RJ adopted) Transpositionist on my empowered Gangplank, Naval: he stays (+3 → 9) and I may play a unit with less than 9 Might (V(8) yes, V(9) no)', () => {
  let g = S0(); fundAll(g, P0);
  const tp = put(g, P0, 'Transpositionist', 'base');
  const gp = put(g, P0, 'ven-086-166', 'base'); g.objects[gp].empowered = 1; g.timestamp++;
  put(g, P0, 'V(1)', 'base');   // a second friendly unit so the choice is shown
  const v8 = hand(g, P0, 'V(8)'), v9 = hand(g, P0, 'V(9)');
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === tp)!);
  let seen: string[] = [];
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    const o = d.options!.map(x => x.id);
    if (o.includes(gp)) { g = ans(g, [gp]); continue; }
    if (o.includes(v8) || o.includes(v9)) { seen = o; g = ans(g, o.includes(v8) ? [v8] : o[0]); continue; }
    g = ans(g, d.kind === 'optional' ? 'yes' : o.includes('base') ? 'base' : o[0]);
  }
  assert.equal(locOf(g, gp), 'base', 'Gangplank stays');
  assert.equal(mightOf(g, gp), 9);
  assert.ok(seen.includes(v8) && !seen.includes(v9), `less than 9: ${seen}`);
});

test('RJ#12865 Fanfare: each of the next three unit plays draws 1 (two units → 2 cards; a fourth unit draws nothing)', () => {
  let g = S0(); fundAll(g, P0, 8);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Fanfare') }), [], x => x.pending?.kind === 'mainAction');
  const counts: number[] = [];
  for (let i = 0; i < 4; i++) {
    const h = g.players[P0].hand.length;
    g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'V(1)'), destination: 'base' }), ['first'], x => x.pending?.kind === 'mainAction');
    counts.push(g.players[P0].hand.length - h);
  }
  assert.deepEqual(counts, [1, 1, 1, 0]);
});

test('RJ#12871 Azir, Sovereign (Order) Accelerate costs [1] + an Order power: 5 Body runes can\'t pay it (enters exhausted); 5 Order runes → 5 exhausted, 1 recycled, enters ready', () => {
  for (const dom of ['body', 'order'] as const) {
    let g = S0(); setRunes(g, P0, 5, dom);
    const az = hand(g, P0, 'sfd-177-221');
    g = act(g, { type: 'playCard', player: P0, obj: az, destination: 'base' });
    let offered = false;
    for (let i = 0; i < 10 && g.pending && g.pending.kind !== 'mainAction'; i++) {
      const d = g.pending;
      if (d.kind === 'optional' && /Accelerate/i.test(d.prompt ?? '')) offered = true;
      g = d.inStep ? ans(g, d.kind === 'optional' ? 'yes' : 'first') : pass(g);
    }
    assert.equal(zone(g, az), 'base');
    if (dom === 'body') { assert.equal(g.objects[az].exhausted, true, 'no Order power: no Accelerate'); assert.ok(!offered); }
    else { assert.equal(g.objects[az].exhausted, false, 'accelerated'); assert.equal(g.players[P0].runesInPlay.length, 4, 'one Order rune recycled'); }
  }
});

test('RJ#12873 Rampage on the opponent\'s Lillia; they swap her with their Sprite (hidden Smoke and Mirrors): Rampage still hits Lillia in base (no location requirement), the Sprites take nothing', () => {
  let g = withTokens(S0()); fundAll(g, P0); fundAll(g, P1);
  const li = put(g, P1, 'unl-082-219', BF_A); control(g, BF_A, P1);
  const sp = put(g, P1, 'Sprite', 'base', { token: true });
  const sm = put(g, P1, 'Smoke and Mirrors', { facedown: BF_A });
  const mine = put(g, P0, 'V(6)', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Rampage') });
  for (let i = 0; i < 6 && g.pending?.inStep; i++) g = ans(g, g.pending.kind === 'optional' ? 'no' : g.pending.options!.some(o => o.id === li) ? [mine, li].filter(x => g.pending!.options!.some(o => o.id === x)) : 'first');
  if (g.pending!.player !== P1) g = pass(g);
  g = drive(act(g, { type: 'playCard', player: P1, obj: sm }), [[sp, li], 'first', 'first'], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, li), 'trash', 'Lillia took 6 in base');
  for (const s of unitsNamed(g, 'Sprite')) assert.equal(g.objects[s].damage, 0);
  assert.ok(g.objects[mine].damage > 0, 'Lillia dealt her Might back');
});

test('RJ#12875 Temporal Breach on a gear Lady of Clockwork made a unit: it is a new object and returns as a plain gear (no longer a unit)', () => {
  let g = S0({ tp: P1 }); setLegend(g, P0, 'Lady of Clockwork');
  const ls = put(g, P0, 'Long Sword', 'base');
  g = endTurn(g, P1);
  for (let i = 0; i < 30 && g.pending && !(g.pending.kind === 'mainAction' && g.activePlayer === P0 && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = act(g, { type: 'pass', player: d.player }); continue; }
    const o = d.options!.map(x => x.id);
    g = ans(g, d.kind === 'optional' ? 'yes' : o.includes(ls) ? [ls] : o[0]);
  }
  assert.equal(chars(g, ls).type, 'Unit', 'unit gear');
  fundAll(g, P0);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Temporal Breach') }), [[ls], 'first', 'first'], x => x.pending?.kind === 'mainAction' && x.chain.length === 0);
  const nl = Object.keys(g.objects).find(id => g.cards[g.objects[id].cardId]?.name === 'Long Sword' && ['base', 'battlefield'].includes(g.objects[id].zone))!;
  assert.ok(nl, 'Long Sword back on the board');
  assert.equal(locOf(g, nl), 'base');
  // (a plain Long Sword's card Might is its +2 bonus, so check the type — ENGINE-9: the engine was already right)
  assert.equal(chars(g, nl).type, 'Gear', 'not a unit any more');
});

test('RJ#12883 (AMBIGUOUS, RJ adopted) The Ball made a unit gear by Lady of Clockwork can be equipped with Guardian Angel; when it would die, Guardian Angel dies instead', () => {
  let g = S0({ tp: P1 }); setLegend(g, P0, 'Lady of Clockwork');
  const ball = put(g, P0, 'The Ball', 'base');
  const ga = put(g, P0, 'Guardian Angel', 'base');
  g = endTurn(g, P1);
  for (let i = 0; i < 30 && g.pending && !(g.pending.kind === 'mainAction' && g.activePlayer === P0 && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = act(g, { type: 'pass', player: d.player }); continue; }
    const o = d.options!.map(x => x.id);
    g = ans(g, d.kind === 'optional' ? 'yes' : o.includes(ball) ? [ball] : o[0]);
  }
  assert.ok(mightOf(g, ball) > 0, 'The Ball is a unit gear');
  fundAll(g, P0);
  const eq = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === ga);
  assert.ok(eq, 'Equip available');
  g = drive(act(g, eq!), [[ball], [ball]], x => x.pending?.kind === 'mainAction');
  assert.equal(g.objects[ga].attachedTo, ball, 'attached to The Ball');
  g.objects[ball].damage = mightOf(g, ball) - 1; g.timestamp++;
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'ZapM') }), [[ball], [ball]], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, ga), 'trash', 'Guardian Angel died instead');
  assert.equal(locOf(g, ball), 'base', 'The Ball survives');
});

test('RJ#12884 Hunker Down on an already ready unit: legal; the ready does nothing, it can\'t move this turn, and I draw 1', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'V(2)', 'base');
  const h = g.players[P0].hand.length;
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Hunker Down') }), [[u]], x => x.pending?.kind === 'mainAction');
  assert.equal(g.players[P0].hand.length, h + 1, 'drew 1');
  assert.equal(g.objects[u].exhausted, false);
  assert.deepEqual(moveDests(g, P0, u), [], 'can\'t move');
});

test('RJ#12885 Ambush in response to Graves, Blasting Through\'s defend trigger: the ambusher is there when it resolves and takes his 4 (dies)', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  put(g, P1, 'rad-085-167', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(9)', 'base');
  const nd = hand(g, P0, 'unl-114-219');
  g = move(g, P0, [a], BF_A);
  g = drive(g, [], x => x.chain.some(c => /Graves/.test(String(c.label))) && x.pending?.player === P0 && !x.pending.inStep);
  assert.ok(canPlayNow(g, P0, nd, BF_A), 'Ambush in response');
  g = act(g, { type: 'playCard', player: P0, obj: nd, destination: BF_A });
  g = drive(g, [], x => x.chain.length === 0 || (x.pending?.kind === 'showdownAction'));
  assert.equal(zone(g, nd), 'trash', 'took 4');
  assert.equal(g.objects[a].damage, 4);
});

test('RJ#12893 Blade Dancer (ready) conquer trigger paid and on the chain; En Garde on my exhausted unit → choose trigger exhausts the legend to ready the unit; then the conquer trigger readies the legend', () => {
  let g = S0(); fundAll(g, P0);
  const leg = setLegend(g, P0, 'Blade Dancer');
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_A);
  g = drive(g, ['yes'], x => x.chain.some(c => c.source === leg) && x.pending?.player === P0 && !x.pending.inStep);
  assert.equal(g.objects[u].exhausted, true, 'moved → exhausted');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'En Garde') });
  for (let i = 0; i < 40 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    const o = d.options!.map(x => x.id);
    g = ans(g, o.includes(u) ? [u] : d.kind === 'optional' ? 'yes' : o[0]);
  }
  assert.equal(g.objects[u].exhausted, false, 'unit readied by the choose trigger');
  assert.equal(g.objects[leg].exhausted, false, 'legend readied again by the conquer trigger');
  assert.equal(mightOf(g, u), 4, 'En Garde +1 +1 (only unit there)');
});

test('RJ#12896 (AMBIGUOUS, RJ adopted) Mordekaiser, Twice Slain and my other unit both take lethal combat damage: his replacement may kill that other dying unit as its cost → he is healed and recalled', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0);
  const mk = put(g, P0, 'rad-020-167', BF_A), v = put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const a = put(g, P1, 'V(9)', 'base');
  g = move(g, P1, [a], BF_A);
  let chose = false;
  for (let i = 0; i < 60 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    if (d.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: d.player, assignment: d.player === P1 ? { [mk]: 5, [v]: 4 } : (d.data as { suggested: Record<string, number> }).suggested }); continue; }
    if (!d.inStep) { g = pass(g); continue; }
    const o = d.options!.map(x => x.id);
    if (o.includes(v) && d.player === P0) { chose = true; g = ans(g, [v]); continue; }
    g = ans(g, d.kind === 'optional' ? 'yes' : o[0]);
  }
  assert.ok(chose || g.log.some(l => /Mordekaiser: kill a friendly unit to save me: V\(1\)/.test(l.text)), 'the other dying unit paid the cost');
  assert.equal(locOf(g, mk), 'base', 'Mordekaiser recalled');
  assert.equal(g.objects[mk].damage, 0, 'healed');
  assert.equal(zone(g, v), 'trash');
});

test('RJ#12899 Gutter Palace given Temporary: both trigger at the start of the Beginning Phase; Temporary kills it, but the win trigger already on the chain still wins', () => {
  let g = S0({ tp: P1 });
  const gp = put(g, P0, 'Gutter Palace', 'base');
  mod(g, gp, { addKeywords: ['Temporary'], duration: 'permanent', layer: 2 });
  for (let i = 0; i < 4; i++) put(g, P0, 'V(1)', BF_A);
  control(g, BF_A, P0);
  for (let i = 0; i < 4; i++) hand(g, P0, 'V(1)');
  g = endTurn(g, P1);
  // order the two triggers so Temporary resolves first (kills the Palace), then the win trigger
  for (let i = 0; i < 40 && g.phase !== 'gameOver' && !(g.activePlayer === P0 && g.pending?.kind === 'mainAction'); i++) {
    const d = g.pending!;
    if (!d.inStep) { g = pass(g); continue; }
    const o = d.options!;
    const pal = o.find(x => /Gutter Palace/.test(x.label) && !/Temporary/.test(x.label));
    g = ans(g, d.kind === 'optional' ? 'yes' : pal ? [pal.id] : o[0].id);
  }
  assert.equal(g.winner, P0, 'still wins');
});

test('RJ#12900 a Deploy gear alone at an open battlefield: no control, no showdown, no score', () => {
  let g = S0(); fundAll(g, P0, 6);
  const s = hand(g, P0, 'rad-156-167');
  const pts = g.players[P0].points;
  g = drive(act(g, { type: 'playCard', player: P0, obj: s, destination: BF_A }), [], x => x.pending?.kind === 'mainAction');
  assert.equal(locOf(g, s), BF_A);
  assert.equal(g.battlefields[BF_A].controller, null, 'not controlled');
  assert.equal(g.battlefields[BF_A].contested, false, 'no showdown');
  assert.equal(g.players[P0].points, pts, 'no conquer');
});

test('RJ#12902 Amateur Recital\'s hold trigger may move an enemy unit at ANOTHER battlefield; it goes to its own base', () => {
  const g0 = S0({ tp: P1 }); setBattlefieldCard(g0, BF_A, 'Amateur Recital');
  put(g0, P0, 'V(2)', BF_A); control(g0, BF_A, P0);
  const e = put(g0, P1, 'V(2)', BF_B); control(g0, BF_B, P1);
  let g = endTurn(g0, P1);
  let offered = false;
  for (let i = 0; i < 30 && !(g.activePlayer === P0 && g.pending?.kind === 'mainAction'); i++) {
    const d = g.pending!;
    if (!d.inStep) { g = pass(g); continue; }
    const o = d.options!.map(x => x.id);
    if (o.includes(e)) { offered = true; g = ans(g, [e]); continue; }
    g = ans(g, d.kind === 'optional' ? 'yes' : o[0]);
  }
  assert.ok(offered, 'enemy unit at the other battlefield is choosable');
  assert.equal(locOf(g, e), 'base');
  assert.equal(g.objects[e].controller, P1, "its controller's base");
});

test('RJ#12903 Threshold of the Gray\'s combat [1] stays in the pool after the showdown, usable later in the Main Phase', () => {
  let g = S0(); setBattlefieldCard(g, BF_A, 'Threshold of the Gray');
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(3)', 'base');
  g = move(g, P0, [a], BF_A);
  g = drive(g, [], x => x.pending?.kind === 'mainAction');
  assert.equal(g.pending?.kind, 'mainAction'); assert.equal(g.activePlayer, P0);
  assert.equal(g.players[P0].pool.energy, 1, 'the Energy is still in the pool');
});

test('RJ#12904 (AMBIGUOUS, RJ adopted) The Exile legend + Baron Nashor played to a battlefield I control: Baron enters the Baron Pit ready', () => {
  let g = S0(); fundAll(g, P0, 12); addRunes(g, P0, 12, 'chaos');
  setLegend(g, P0, 'rad-149-167');
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
  const b = hand(g, P0, 'Baron Nashor');
  g = drive(act(g, { type: 'playCard', player: P0, obj: b, destination: BF_A }), ['first', 'first', 'first'], x => x.pending?.kind === 'mainAction');
  assert.ok(![BF_A, BF_B, 'base'].includes(locOf(g, b) as never), 'in the Baron Pit');
  assert.equal(g.objects[b].exhausted, false, 'entered ready');
});

test('RJ#12906 (AMBIGUOUS, RJ adopted) empowered Mel, Newly Awakened + Siphon Power (chooses a battlefield, not units): enemy units there get only the normal -1', () => {
  let g = S0(); fundAll(g, P0, 6);
  const mel = put(g, P0, 'Mel, Newly Awakened', 'base'); g.objects[mel].empowered = 3;
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(4)', BF_A);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Siphon Power') }), [String(g.battlefields[BF_A].objId), 'first'], x => x.pending?.kind === 'mainAction');
  assert.equal(mightOf(g, e), 3, '-1 only');
});

test('RJ#12907 (AMBIGUOUS, RJ adopted) The Exile legend: Sneaky Deckhand played to an open (uncontrolled) battlefield enters exhausted', () => {
  let g = S0(); fundAll(g, P0, 8);
  setLegend(g, P0, 'rad-149-167');
  const dh = hand(g, P0, 'Sneaky Deckhand');
  assert.ok(canPlayNow(g, P0, dh, BF_A), 'may be played to the open battlefield');
  g = drive(act(g, { type: 'playCard', player: P0, obj: dh, destination: BF_A }), ['first', 'first'], x => x.pending?.kind === 'mainAction');
  assert.equal(locOf(g, dh), BF_A);
  assert.equal(g.objects[dh].exhausted, true, 'the battlefield was not controlled when he entered');
});

test('RJ#12910 Astral Heron played by Here to Help (the first card): Heron gets the [3] reduction, never triggers (Here to Help was the first card) → the next card is not discounted', () => {
  let g = S0(); fundAll(g, P0, 12);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const h = hand(g, P0, 'Astral Heron');
  const n = hand(g, P0, 'V(3)');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Here to Help') });
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    const o = d.options!.map(x => x.id);
    g = ans(g, o.includes(h) ? [h] : o.includes(String(BF_A)) ? String(BF_A) : d.kind === 'optional' ? 'yes' : o[0]);
  }
  assert.equal(locOf(g, h), BF_A, 'Heron played');
  assert.ok(!g.log.some(l => /Trigger: Astral Heron/.test(l.text)), 'no Heron trigger');
  assert.equal(playCostOf(g, P0, n)!.energy, 3, 'no discount');
});

test('RJ#12914 my Deathknell unit dies at Black Rose Sanctum: both triggers are simultaneous and I order them (either may resolve first)', () => {
  const run = (sanctumFirst: boolean) => {
    let g = withTokens(S0()); fundAll(g, P0);
    setBattlefieldCard(g, BF_A, 'Black Rose Sanctum');
    const p = put(g, P0, 'Lonely Poro', BF_A); control(g, BF_A, P0);
    put(g, P0, 'V(1)', 'base');
    g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'ZapM') });
    let ordered = false;
    for (let i = 0; i < 40 && g.pending && g.pending.kind !== 'mainAction'; i++) {
      const d = g.pending;
      if (!d.inStep) { g = pass(g); continue; }
      const o = d.options!;
      if (o.some(x => /Black Rose Sanctum/.test(x.label)) && o.some(x => /Lonely Poro/.test(x.label))) {
        ordered = true;
        const pick = o.find(x => (sanctumFirst ? /Lonely Poro/ : /Black Rose Sanctum/).test(x.label))!; // the first chosen goes on the chain first → resolves last
        g = ans(g, [pick.id]); continue;
      }
      g = ans(g, o.some(x => x.id === p) ? [p] : d.kind === 'optional' ? 'yes' : o[0].id);
    }
    return { g, ordered };
  };
  const a = run(true), b = run(false);
  assert.ok(a.ordered && b.ordered, 'controller orders the two simultaneous triggers');
  const i1 = (g: typeof a.g, re: RegExp) => g.log.findIndex(l => re.test(l.text) && /Resolving/.test(l.text));
  assert.ok(i1(a.g, /Black Rose Sanctum/) < i1(a.g, /Lonely Poro/), 'Sanctum first');
  assert.ok(i1(b.g, /Lonely Poro/) < i1(b.g, /Black Rose Sanctum/), 'Deathknell first');
});

test('RJ#12916 the opponent Ambushes Rengar, Trophy Hunter to my Bird\'s battlefield; I then Ambush Stalking Wolf there killing the Bird: Rengar already entered and stays', () => {
  let g = withTokens(S0()); fundAll(g, P0); fundAll(g, P1, 8);
  const bird = put(g, P0, 'Bird', BF_A, { token: true }); control(g, BF_A, P0);
  const u = put(g, P0, 'V(2)', 'base');
  const r = hand(g, P1, 'Rengar, Trophy Hunter');
  const w = hand(g, P0, 'Stalking Wolf');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Hunker Down') });
  g = drive(g, [[u]], x => x.pending?.player === P1 && !x.pending.inStep);
  assert.ok(canPlayNow(g, P1, r, BF_A), 'Rengar may Ambush to the Bird\'s battlefield');
  g = act(g, { type: 'playCard', player: P1, obj: r, destination: BF_A });
  g = drive(g, ['first'], x => x.pending?.player === P0 && !x.pending.inStep);
  assert.equal(locOf(g, r), BF_A, 'Rengar entered at once (permanents resolve when finalized)');
  assert.ok(canPlayNow(g, P0, w, BF_A), 'Stalking Wolf may Ambush to its Bird\'s battlefield (its own text)');
  g = act(g, { type: 'playCard', player: P0, obj: w, destination: BF_A });
  g = drive(g, [[bird], [bird], 'yes', 'yes'], x => x.chain.length === 0 || x.pending?.kind === 'showdownAction');
  assert.notEqual(zone(g, bird), 'battlefield', 'Bird killed');
  assert.equal(locOf(g, w), BF_A);
  assert.equal(locOf(g, r), BF_A, 'Rengar stays');
});

test('RJ#12917 Seraphine, Inspiring: one Standard Move of 3 units exhausts them at the same time → her trigger, draw 1 (not 3)', () => {
  let g = S0();
  put(g, P0, 'rad-065-167', 'base');
  const us = [put(g, P0, 'V(1)', 'base'), put(g, P0, 'V(1)', 'base'), put(g, P0, 'V(1)', 'base')];
  const h = g.players[P0].hand.length;
  g = move(g, P0, us, BF_A);
  g = drive(g, ['yes', 'yes', 'yes'], x => x.pending?.kind === 'mainAction');
  assert.equal(g.players[P0].hand.length, h + 1, 'one draw');
});

test('RJ#12918 Riven, Broken Blade already buffed: the Buff mode may still be chosen and does nothing (no second buff)', () => {
  let g = S0();
  const r = put(g, P0, 'rad-043-167', 'base', { buff: true });
  g = move(g, P0, [r], BF_A);
  for (let i = 0; i < 10 && !(g.pending?.inStep && g.pending.options?.some(o => /Buff/i.test(o.label))); i++) g = g.pending!.inStep ? ans(g, 'first') : pass(g);
  const o = g.pending!.options!.find(x => /Buff/i.test(x.label));
  assert.ok(o, 'Buff mode offered although she is buffed');
  const m0 = mightOf(g, r);
  g = drive(ans(g, o!.id), [], x => x.pending?.kind === 'mainAction');
  assert.equal(mightOf(g, r), m0, 'no second buff');
});

test('RJ#12920 Bedeviling Stranger played to a battlefield with 4 units; Gusted in response to its play trigger: only 3 remain → no enemy unit returned', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const e1 = put(g, P1, 'V(1)', BF_A), e2 = put(g, P1, 'V(1)', BF_A);
  const s = hand(g, P0, 'Bedeviling Stranger');
  g = act(g, { type: 'playCard', player: P0, obj: s, destination: BF_A });
  for (let i = 0; i < 10 && !(x => x.chain.some(c => c.source === s) && x.pending?.player === P1 && !x.pending.inStep)(g); i++) {
    const d = g.pending!;
    if (!d.inStep) { g = pass(g); continue; }
    const bo = d.options!.find(o => o.id === g.battlefields[BF_A].objId || o.id === String(BF_A));
    g = ans(g, bo ? bo.id : 'first');
  }
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Gust') });
  let resolvedTrigger = false;
  for (let i = 0; i < 30 && g.pending && g.chain.length > 0; i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    const o = d.options!.map(x => x.id);
    if (zone(g, s) === 'hand' && (o.includes(e1) || o.includes(e2) || d.kind === 'optional')) resolvedTrigger = true;
    g = ans(g, o.includes(s) ? [s] : d.kind === 'optional' ? 'yes' : o[0]);
  }
  assert.ok(!resolvedTrigger, 'no enemy unit offered: the 4-unit condition fails');
  assert.equal(zone(g, s), 'hand', 'Stranger Gusted');
  assert.equal(locOf(g, e1), BF_A); assert.equal(locOf(g, e2), BF_A);
});

test('RJ#12923 a unit Ambushed to Frozen Fortress in response to its Beginning-Phase trigger is there on resolution and takes the 1', () => {
  let g = S0(); fundAll(g, P1, 8);
  setBattlefieldCard(g, BF_A, 'Frozen Fortress');
  put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const nd = hand(g, P1, 'unl-114-219');
  g = endTurn(g, P0);
  g = drive(g, [], y => (y.chain.some(c => /Frozen Fortress/.test(String(c.label))) && y.pending?.player === P1 && !y.pending.inStep) || y.pending?.kind === 'mainAction');
  assert.ok(canPlayNow(g, P1, nd, BF_A), 'Ambush in response');
  g = act(g, { type: 'playCard', player: P1, obj: nd, destination: BF_A });
  g = drive(g, ['first', 'first'], x => x.chain.length === 0);
  assert.equal(g.objects[nd].damage, 1, 'took 1');
});

test('RJ#12930 Zhonya\'s Hourglass saves a ready Riven, Broken Blade: the replacement exhausts her → her "when I become exhausted" trigger', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1);
  const r = put(g, P0, 'rad-043-167', BF_A); control(g, BF_A, P0);
  const z = put(g, P0, "Zhonya's Hourglass", 'base');
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'KillDraw') });
  for (let i = 0; i < 20 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    const o = d.options?.map(x => x.id) ?? [];
    g = ans(g, o.includes(r) ? [r] : d.kind === 'optional' ? 'yes' : 'first');
  }
  assert.equal(zone(g, z), 'trash', 'Hourglass used');
  assert.equal(locOf(g, r), 'base', 'Riven recalled');
  assert.ok(g.log.some(l => /Trigger: Riven/.test(l.text)), 'exhaust trigger');
});

test('RJ#12931 Steel Paws empowered by Tornado Warrior with damage marked: the end-of-turn disempower (Ending Step) makes it 0 Might before the heal → it dies', () => {
  for (const dmg of [1, 0]) {
    let g = S0(); fundAll(g, P0);
    const sp = put(g, P0, 'Steel Paws', BF_A); control(g, BF_A, P0);
    const tw = put(g, P0, 'Tornado Warrior', { facedown: BF_A });
    g = drive(act(g, { type: 'playCard', player: P0, obj: tw }), ['yes', [sp]]);
    assert.equal(mightOf(g, sp), 7);
    g.objects[sp].damage = dmg; g.timestamp++;
    g = drive(endTurn(g), [], x => x.activePlayer === P1 && x.pending?.kind === 'mainAction');
    assert.equal(zone(g, sp), dmg ? 'trash' : 'battlefield', dmg ? 'dies' : 'survives at 0 Might');
  }
});

test('RJ#12932 Boy Who Shattered Time\'s [2][A] reduction also comes off the next unit\'s Accelerate cost: 7 Fury runes pay an accelerated Mordekaiser, Twice Slain (7+[1] energy, [Fury]+[Fury] → 6 + 1 power)', () => {
  let g = S0(); setRunes(g, P0, 7, 'fury');
  const l = setLegend(g, P0, 'rad-139-167');
  g.objects[l].empowered = 1; g.timestamp++;
  const u = hand(g, P0, 'Mordekaiser, Twice Slain');
  const act0 = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === l)!;
  assert.ok(act0, 'legend ability available');
  g = drive(act(g, act0), ['first'], x => x.pending?.kind === 'mainAction');
  g = act(g, { type: 'playCard', player: P0, obj: u, destination: 'base' });
  let offered = false;
  for (let i = 0; i < 10 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    if (d.kind === 'optional' && /Accelerate/i.test(d.prompt ?? '')) offered = true;
    g = d.inStep ? ans(g, d.kind === 'optional' ? 'yes' : 'first') : pass(g);
  }
  assert.equal(zone(g, u), 'base');
  assert.ok(offered, 'Accelerate affordable only with the reduction');
  assert.equal(g.objects[u].exhausted, false, 'accelerated');
});

test('RJ#12935 (AMBIGUOUS, RJ adopted) the unit chosen by Shady Spectacles dies: the equipped unit stays a copy (the copy lasts while the gear is attached)', () => {
  let g = S0(); fundAll(g, P0);
  const a = put(g, P0, 'V(1)', 'base'), b = put(g, P0, 'V(5)', 'base');
  const s1 = put(g, P0, 'Shady Spectacles', 'base');
  g = drive(act(g, { type: 'activate', player: P0, obj: s1, abilityIndex: EQUIP }), [[a], [b]]);
  assert.equal(mightOf(g, a), 5);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'KillDraw') }), [[b]], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, b), 'trash');
  assert.equal(g.objects[s1].attachedTo, a, 'still attached');
  assert.equal(mightOf(g, a), 5, 'still a copy');
});

test('RJ#12937 (AMBIGUOUS, RJ adopted) Deceiver legend\'s Reflection copying a gear made a unit (Lady of Clockwork effect) becomes a plain gear (granted unit type/Might aren\'t copiable) and is recalled to base', () => {
  let g = withTokens(S0({ tp: P1 }));
  setLegend(g, P0, 'unl-199-219');
  const ls = put(g, P0, 'Long Sword', BF_A); control(g, BF_A, P0);
  mod(g, ls, { becomeType: 'Unit' as never, setMight: 2, layer: 1, duration: 'permanent' });
  assert.equal(mightOf(g, ls), 2, 'gear is a 2-Might unit gear');
  for (let i = 0; i < 3; i++) hand(g, P0, 'V(1)');
  g = endTurn(g, P1);
  for (let i = 0; i < 40 && !(g.activePlayer === P0 && g.pending?.kind === 'mainAction'); i++) {
    const d = g.pending!;
    if (!d.inStep) { g = pass(g); continue; }
    const o = d.options!.map(x => x.id);
    g = ans(g, o.includes(ls) ? [ls] : d.kind === 'optional' ? 'yes' : o[0]);
  }
  const copy = Object.keys(g.objects).find(id => id !== ls && chars(g, id)?.name === 'Long Sword');
  assert.ok(copy, 'a Reflection was played');
  assert.equal(chars(g, copy!).type, 'Gear', 'the copy is a gear');
  assert.equal(locOf(g, copy!), 'base', 'recalled (non-Deploy gear at a battlefield)');
});

test('RJ#12938 Meticulous Restorationist killed as Dune Devourer\'s additional cost ([2] less): Devourer still has Energy cost 7 → Restorationist may be played from the trash', () => {
  let g = S0(); fundAll(g, P0, 10); addRunes(g, P0, 4, 'calm'); addRunes(g, P0, 4, 'mind');
  const mr = put(g, P0, 'rad-120-167', 'base');
  const dd = hand(g, P0, 'Dune Devourer');
  g = act(g, { type: 'playCard', player: P0, obj: dd, destination: 'base' });
  for (let i = 0; i < 30 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    const o = d.options?.map(x => x.id) ?? [];
    g = ans(g, o.includes(mr) ? [mr] : d.kind === 'optional' ? 'yes' : 'first');
  }
  assert.equal(zone(g, dd), 'base');
  assert.ok(g.log.some(l => /Trigger: Meticulous Restorationist/.test(l.text)), 'its trigger from the trash');
  assert.equal(locOf(g, mr), 'base', 'Restorationist played back from the trash');
});

test('RJ#12939 Demacian Standard (gear, no Action) can\'t be played during my attack\'s showdown', () => {
  let { g } = attackSetup(['V(3)', 'V(3)'], ['V(3)']);
  fundAll(g, P0, 6);
  const s = hand(g, P0, 'rad-156-167');
  expectPending(g, 'showdownAction', P0);
  assert.ok(!canPlayNow(g, P0, s, BF_A), 'not playable in the showdown');
});

test('RJ#12942 (AMBIGUOUS, RJ adopted) Nine-Tailed Fox legend on a 1-Might attacker reduces by 0 (snapshotted minimum) → Ahri, Confident doesn\'t trigger; a 2-Might attacker → she gets +1', () => {
  for (const m of [1, 2]) {
    let g = S0({ tp: P1 });
    setLegend(g, P0, 'ogn-255-298');
    const ah = put(g, P0, 'rad-038-167', BF_A); control(g, BF_A, P0);
    const a = put(g, P1, `V(${m})`, 'base');
    g = move(g, P1, [a], BF_A);
    g = drive(g, ['first', 'first', 'first'], x => x.pending?.kind === 'showdownAction' || x.pending?.kind === 'assignDamage' || x.pending?.kind === 'mainAction');
    assert.equal(mightOf(g, a), Math.max(1, m - 1));
    assert.equal(mightOf(g, ah), m === 1 ? 4 : 5, m === 1 ? 'no trigger' : '+1');
  }
});

test('RJ#12943 The Ball\'s "deal 2 to enemy units here" doesn\'t choose: no Deflect cost, it hits an enemy Deflect unit', () => {
  let g = S0(); setRunes(g, P0, 5, 'calm'); addRunes(g, P0, 1, 'mind');
  const sr = put(g, P1, 'Storm Raptor', BF_A); control(g, BF_A, P1);
  const b = hand(g, P0, 'The Ball');
  g = act(g, { type: 'playCard', player: P0, obj: b, destination: BF_A });
  for (let i = 0; i < 20 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    const dm = d.options?.find(x => /Deal 2/i.test(x.label));
    g = ans(g, dm ? dm.id : d.kind === 'optional' ? 'yes' : 'first');
  }
  assert.equal(g.objects[sr].damage, 2, 'Deflect unit hit without paying');
});

test('RJ#12944 the attacker moves Vi, Peacekeeper in; I Temporal Breach my own defender: it returns as a defender, the opponent stays the attacker', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0);
  const d0 = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const tb = put(g, P0, 'Temporal Breach', { facedown: BF_A });
  const vi = put(g, P1, 'Vi, Peacekeeper', 'base');
  g = move(g, P1, [vi], BF_A);
  for (let i = 0; i < 10 && !(g.pending?.player === P0 && !g.pending.inStep); i++) g = g.pending!.inStep ? ans(g, g.pending!.kind === 'optional' ? 'yes' : 'first') : pass(g);
  g = act(g, { type: 'playCard', player: P0, obj: tb });
  for (let i = 0; i < 20 && g.pending && g.chain.length + (g.pending.inStep ? 1 : 0) > 0 && g.pending.kind !== 'assignDamage'; i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    const o = d.options?.map(x => x.id) ?? [];
    g = ans(g, o.includes(d0) ? [d0] : d.kind === 'optional' ? 'yes' : 'first');
  }
  assert.equal(locOf(g, d0), BF_A);
  assert.equal(g.showdown?.attacker, P1, 'still the attacker');
  assert.equal(g.battlefields[BF_A].controller, P0);
});

test('RJ#12945 (AMBIGUOUS, RJ adopted) Ahri, Confident attacking with another Disarm unit: each Disarm reduction is its own trigger → Ahri +1 per reduction (+2)', () => {
  let g = S0();
  const e = put(g, P1, 'V(6)', BF_A); control(g, BF_A, P1);
  const ah = put(g, P0, 'rad-038-167', 'base'), ev = put(g, P0, 'Evelynn, In Control', 'base');
  g = move(g, P0, [ah, ev], BF_A);
  for (let i = 0; i < 30 && g.pending?.kind !== 'showdownAction' && g.pending?.kind !== 'assignDamage'; i++) {
    const d = g.pending!;
    if (!d.inStep) { g = pass(g); continue; }
    const o = d.options?.map(x => x.id) ?? [];
    g = ans(g, o.includes(e) ? [e] : d.kind === 'optional' ? 'yes' : 'first');
  }
  assert.equal(mightOf(g, e), 4, 'two -1s');
  assert.equal(mightOf(g, ah), 6, '4 + 1 + 1');
});

test('RJ#12946 Mordekaiser, Twice Slain played with Boy Who Shattered Time ("Kill me at end of turn"): he may save himself by killing ANOTHER friendly unit, not himself', () => {
  let g = S0(); setRunes(g, P0, 8, 'fury');
  const l = setLegend(g, P0, 'rad-139-167');
  g.objects[l].empowered = 1; g.timestamp++;
  const v = put(g, P0, 'V(1)', 'base');
  const mk = hand(g, P0, 'Mordekaiser, Twice Slain');
  const a0 = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === l)!;
  g = drive(act(g, a0), ['first'], x => x.pending?.kind === 'mainAction');
  g = drive(act(g, { type: 'playCard', player: P0, obj: mk, destination: 'base' }), ['no', 'no'], x => x.pending?.kind === 'mainAction');
  assert.equal(locOf(g, mk), 'base');
  g = endTurn(g, P0);
  let selfOffered = false, chose = false;
  for (let i = 0; i < 40 && !(g.activePlayer === P1 && g.pending?.kind === 'mainAction'); i++) {
    const d = g.pending!;
    if (!d.inStep) { g = pass(g); continue; }
    const o = d.options?.map(x => x.id) ?? [];
    if (o.includes(v)) { if (o.includes(mk)) selfOffered = true; chose = true; g = ans(g, [v]); continue; }
    g = ans(g, d.kind === 'optional' ? 'yes' : 'first');
  }
  assert.ok(chose || g.log.some(l => /\(auto\) Mordekaiser: kill a friendly unit to save me: V\(1\)/.test(l.text)), 'the other friendly unit is the (only) choice — not himself');
  assert.ok(!selfOffered, 'not himself');
  assert.equal(locOf(g, mk), 'base', 'Mordekaiser survives');
  assert.equal(zone(g, v), 'trash');
});

test('RJ#12948 Reckless Innovator entering exhausted is not "becoming exhausted": no trigger on play; moving him later triggers', () => {
  let g = S0(); fundAll(g, P0, 8);
  const ri = hand(g, P0, 'Reckless Innovator');
  g = drive(act(g, { type: 'playCard', player: P0, obj: ri, destination: 'base' }), ['no'], x => x.pending?.kind === 'mainAction');
  assert.equal(g.objects[ri].exhausted, true);
  assert.ok(!g.log.some(l => /Trigger: Reckless Innovator/.test(l.text)), 'no trigger');
  g.objects[ri].exhausted = false; g.timestamp++;
  g = move(g, P0, [ri], BF_A);
  assert.ok(g.log.some(l => /Trigger: Reckless Innovator/.test(l.text)) || g.pending?.inStep, 'exhausting by moving triggers');
});

test('RJ#12955 Scorched Earth with a single unit at the battlefield: all 5 damage go to it (no lethal cap outside combat)', () => {
  let g = S0(); fundAll(g, P0, 6);
  const e = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Scorched Earth') });
  for (let i = 0; i < 20 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    if (d.kind === 'assignDamage' || /split|assign/i.test(d.kind)) { g = act(g, { type: 'assignDamage', player: d.player, assignment: { [e]: 5 } } as never); continue; }
    if (!d.inStep) { g = pass(g); continue; }
    const o = d.options?.map(x => x.id) ?? [];
    g = ans(g, o.includes(e) ? [e] : o.includes(g.battlefields[BF_A].objId) ? [g.battlefields[BF_A].objId] : d.kind === 'optional' ? 'yes' : 'first');
  }
  assert.equal(g.objects[e].damage, 5);
});

test('RJ#12958 my only unit (Stellacorn Herder) moves away from a battlefield with my hidden Evelynn, Entrancing: while its move trigger is on the chain, control is kept and she can be played from face down there', () => {
  let g = S0(); fundAll(g, P0);
  const sh = put(g, P0, 'Stellacorn Herder', BF_A); control(g, BF_A, P0);
  const ev = put(g, P0, 'Evelynn, Entrancing', { facedown: BF_A });
  g = move(g, P0, [sh], 'base');
  g = drive(g, [], x => x.chain.some(c => c.source === sh) && x.pending?.player === P0 && !x.pending.inStep);
  assert.equal(g.battlefields[BF_A].controller, P0, 'control kept while the trigger is pending');
  assert.ok(canPlayNow(g, P0, ev), 'hidden Evelynn playable (Reaction from face down)');
  g = drive(act(g, { type: 'playCard', player: P0, obj: ev }), ['no', 'no'], x => x.pending?.kind === 'mainAction');
  assert.equal(locOf(g, ev), BF_A);
  assert.equal(g.battlefields[BF_A].controller, P0);
});

test('RJ#12959 I play Thousand-Tailed Watcher while the opponent\'s damaged Vex, Apathetic (1 damage) holds a battlefield: Vex\'s stun resolves first (non-turn player), then the -3 kills Vex; the Watcher stays stunned', () => {
  let g = S0(); fundAll(g, P0, 10);
  const vx = put(g, P1, 'Vex, Apathetic', BF_B); control(g, BF_B, P1);
  g.objects[vx].damage = 1; g.timestamp++;
  const w = hand(g, P0, 'Thousand-Tailed Watcher');
  g = drive(act(g, { type: 'playCard', player: P0, obj: w, destination: 'base' }), ['first', 'first', 'first'], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, vx), 'trash', 'Vex died (1 Might, 1 damage)');
  assert.equal(g.objects[w].stunned, true, 'Watcher stunned');
  assert.equal(locOf(g, w), 'base');
});

test('RJ#12963 Last Caress lets hidden Elnuk Herd be played face down to ANOTHER battlefield: its +3 targets a friendly unit there, then it recycles itself', () => {
  let g = S0(); fundAll(g, P0, 8); addRunes(g, P0, 2, 'chaos');
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const fb = put(g, P0, 'V(2)', BF_B); control(g, BF_B, P0);
  const el = put(g, P0, 'Elnuk Herd', { facedown: BF_A });
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Last Caress') }), [], x => x.pending?.kind === 'mainAction');
  assert.ok(canPlayNow(g, P0, el, BF_B), 'face-down Herd playable to the other battlefield');
  g = act(g, { type: 'playCard', player: P0, obj: el, destination: BF_B });
  for (let i = 0; i < 20 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    const o = d.options?.map(x => x.id) ?? [];
    g = ans(g, o.includes(fb) ? [fb] : d.kind === 'optional' ? 'yes' : 'first');
  }
  assert.equal(mightOf(g, fb), 5, '+3 on the unit at the battlefield it was played to');
  assert.equal(unitsNamed(g, 'Elnuk Herd').length, 0, 'recycled');
});

test('RJ#12964 Stalwart Goatherd may kill a Bomb gear token (token cost 0 ≤ 4); its Deathknell deals 2 to an enemy there', () => {
  let g = withTokens(S0()); fundAll(g, P0, 10);
  const en = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Amateur Demolitionist'), destination: 'base' }), ['first', String(BF_A), String(BF_A)], x => x.pending?.kind === 'mainAction');
  const bomb = Object.keys(g.objects).find(id => g.cards[g.objects[id].cardId]?.name === 'Bomb' && g.objects[id].zone === 'battlefield');
  assert.ok(bomb && locOf(g, bomb) === BF_A, 'my Bomb at the enemy battlefield');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Stalwart Goatherd'), destination: 'base' });
  for (let i = 0; i < 20 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    const o = d.options?.map(x => x.id) ?? [];
    g = ans(g, o.includes(bomb!) ? [bomb!] : o.includes(en) ? [en] : d.kind === 'optional' ? 'yes' : 'first');
  }
  assert.notEqual(zone(g, bomb!), 'battlefield', 'Bomb killed');
  assert.equal(g.objects[en].damage, 2, 'Bomb Deathknell: 2 to an enemy there');
});

test('RJ#12970 Not So Fast can\'t counter Kharox\'s Empower or its trigger (neither chooses a friendly unit/gear on the board)', () => {
  let g = S0(); fundAll(g, P0, 8); fundAll(g, P1);
  const kh = put(g, P0, 'Kharox', 'base');
  put(g, P1, 'V(2)', 'base'); put(g, P1, 'V(4)', 'trash');
  for (let i = 0; i < 3; i++) put(g, P1, 'V(1)', 'deckTop');
  const nsf = hand(g, P1, 'Not So Fast');
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === kh)!);
  let windows = 0;
  for (let i = 0; i < 20 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { if (d.player === P1 && g.chain.length) { windows++; assert.ok(!canPlayNow(g, P1, nsf), 'Not So Fast has no legal target'); } g = pass(g); continue; }
    g = ans(g, d.kind === 'optional' ? 'no' : 'first');
  }
  assert.ok(windows > 0, 'P1 had a response window');
});

test('RJ#12971 Hunters\' Circle\'s [1] discount doesn\'t apply to Quick-Draw gear (played to base, attached afterwards); it does to a unit played there', () => {
  let g = S0(); fundAll(g, P0, 8);
  setBattlefieldCard(g, BF_A, "Hunters' Circle");
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  put(g, P0, 'V(2)', 'base');
  const gearId = hand(g, P0, 'Long Sword');   // Quick-Draw, Energy 2
  assert.equal(playCostOf(g, P0, gearId)!.energy, 2, 'no discount for the gear');
  const u = hand(g, P0, 'V(3)');
  assert.equal(playCostOf(g, P0, u, { dest: BF_A })!.energy, 2, 'unit played there: 3 - 1');
});

test('RJ#12972 Raucous Anthem, then Meticulous Restorationist played from the trash by its trigger: it enters exhausted at 2 Might (not on the board when Anthem resolved)', () => {
  let g = S0(); fundAll(g, P0, 12); addRunes(g, P0, 4, 'order');
  const mr = put(g, P0, 'rad-120-167', 'trash');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Raucous Anthem') });
  for (let i = 0; i < 20 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    g = ans(g, d.kind === 'optional' ? 'yes' : 'first');
  }
  assert.equal(locOf(g, mr), 'base', 'played from the trash');
  assert.equal(g.objects[mr].exhausted, true);
  assert.equal(mightOf(g, mr), 2);
});

test('RJ#12976 conquering a battlefield with the opponent\'s Deploy gear (Concert Poster): its "when you conquer here" doesn\'t trigger for me', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  const cp = put(g, P1, 'Concert Poster', BF_A);
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(3)', 'base');
  g = move(g, P0, [a], BF_A);
  g = drive(g, ['yes', 'yes'], x => x.pending?.kind === 'mainAction' && x.chain.length === 0);
  assert.equal(g.battlefields[BF_A].controller, P0, 'conquered');
  assert.ok(!g.log.some(l => /Trigger: Concert Poster/.test(l.text)), 'no Poster trigger');
  assert.equal(g.objects[cp].controller, P1, 'gear stays the opponent\'s');
});

test('RJ#12982 Relentless Storm legend + Seraphic Wyvern played: the channel (exhausted) gets +1 exhausted rune → both runes enter exhausted', () => {
  let g = S0(); fundAll(g, P0, 8); addRunes(g, P0, 2, 'body');
  setLegend(g, P0, 'Relentless Storm');
  const w = hand(g, P0, 'Seraphic Wyvern');
  g = drive(act(g, { type: 'playCard', player: P0, obj: w, destination: 'base' }), ['yes', 'yes', 'yes'], x => x.pending?.kind === 'mainAction' && x.chain.length === 0);
  const chan = g.log.filter(l => /channels? \d+ runes?/i.test(l.text));
  assert.ok(chan.length, 'channelled');
  const runes = g.players[P0].runesInPlay;
  const newest = runes.slice(-2);
  assert.ok(newest.every(r => g.objects[r].exhausted), 'both new runes exhausted');
  assert.ok(/channels 2 runes/.test(chan[chan.length - 1].text), `two runes: ${chan[chan.length - 1].text}`);
});

test('RJ#12984 Bomb killed as Shimmering Swimmer\'s additional cost: the Deathknell goes on the chain first, the Swimmer\'s play trigger above it → the Swimmer trigger resolves first', () => {
  let g = withTokens(S0()); fundAll(g, P0, 12);
  const en = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Amateur Demolitionist'), destination: 'base' }), ['first', String(BF_A), String(BF_A)], x => x.pending?.kind === 'mainAction');
  const bomb = Object.keys(g.objects).find(id => g.cards[g.objects[id].cardId]?.name === 'Bomb' && g.objects[id].zone === 'battlefield')!;
  assert.ok(bomb);
  const sw = hand(g, P0, 'Shimmering Swimmer');
  g = act(g, { type: 'playCard', player: P0, obj: sw, destination: 'base' });
  for (let i = 0; i < 30 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    const o = d.options?.map(x => x.id) ?? [];
    g = ans(g, o.includes(bomb) ? [bomb] : o.includes(en) ? [en] : d.kind === 'optional' ? 'yes' : 'first');
  }
  const iSw = g.log.findIndex(l => /Resolving Shimmering Swimmer/.test(l.text)), iB = g.log.findIndex(l => /Resolving Bomb/.test(l.text));
  assert.ok(iSw >= 0 && iB >= 0, 'both resolved');
  assert.ok(iSw < iB, 'Swimmer trigger first');
  assert.equal(g.objects[en].damage, 4, '2 (Swimmer) + 2 (Bomb)');
});

test('RJ#12994 Demacian Standard: a unit Ambushed into my attack gains the Attacker designation → "when one or more friendly units attack here" triggers again', () => {
  let g = S0(); fundAll(g, P0, 10);
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  put(g, P0, 'rad-156-167', BF_A);
  const a = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [a], BF_A);
  g = drive(g, ['first', 'first'], x => x.pending?.kind === 'showdownAction' && x.chain.length === 0);
  const count = () => g.log.filter(l => /Trigger: Demacian Standard/.test(l.text)).length;
  assert.equal(count(), 1, 'initial attack');
  const nd = hand(g, P0, 'unl-114-219');
  assert.ok(canPlayNow(g, P0, nd, BF_A), 'Ambush into my attack');
  g = act(g, { type: 'playCard', player: P0, obj: nd, destination: BF_A });
  g = drive(g, ['first', 'first', 'first'], x => x.pending?.kind === 'assignDamage');
  assert.equal(g.objects[nd].combatRole, 'attacker');
  assert.equal(count(), 2, 'Standard triggered for the new attacker');
});

test('RJ#13000 Not So Fast can\'t counter The Ball\'s "deal 2 to enemy units here" (it chooses no unit)', () => {
  let g = S0(); setRunes(g, P0, 5, 'calm'); addRunes(g, P0, 1, 'mind'); fundAll(g, P1);
  const e = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const nsf = hand(g, P1, 'Not So Fast');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'The Ball'), destination: BF_A });
  let windows = 0;
  for (let i = 0; i < 20 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { if (d.player === P1 && g.chain.length) { windows++; assert.ok(!canPlayNow(g, P1, nsf), 'no legal Not So Fast target'); } g = pass(g); continue; }
    const dm = d.options?.find(x => /Deal 2/i.test(x.label));
    g = ans(g, dm ? dm.id : d.kind === 'optional' ? 'yes' : 'first');
  }
  assert.ok(windows > 0);
  assert.equal(g.objects[e].damage, 2);
});

test('RJ#13002 Zhonya\'s Hourglass made a unit gear (Lady of Clockwork effect) is killed: its replacement can\'t save itself (killing itself is the death) → it goes to the trash', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1);
  const z = put(g, P0, "Zhonya's Hourglass", 'base');
  mod(g, z, { becomeType: 'Unit' as never, setMight: 2, layer: 1, duration: 'permanent' });
  assert.equal(mightOf(g, z), 2);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'KillDraw') });
  for (let i = 0; i < 20 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    const o = d.options?.map(x => x.id) ?? [];
    g = ans(g, o.includes(z) ? [z] : d.kind === 'optional' ? 'yes' : 'first');
  }
  assert.equal(zone(g, z), 'trash');
});

test('RJ#13011 Heimerdinger, Academy Instructor at a battlefield + Vanguard Armory: each of the three Recruit plays may be replaced by a 3-Might Mech', () => {
  let g = withTokens(S0());
  put(g, P0, 'rad-132-167', BF_A); control(g, BF_A, P0);
  const va = put(g, P0, 'Vanguard Armory', 'base');
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === va)!);
  for (let i = 0; i < 30 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    g = ans(g, d.kind === 'optional' ? 'yes' : 'first');
  }
  assert.equal(unitsNamed(g, 'Mech').length, 3, 'three Mechs');
  assert.equal(unitsNamed(g, 'Recruit').length, 0);
});

for (const [id, resp] of [['13015', 'Thrill of the Hunt'], ['13016', 'Not So Fast']] as const) {
  test(`RJ#${id} Dockside Lock-Up's banish trigger chose the opponent's unit; they respond with ${resp}: nothing is banished`, () => {
    let g = S0(); fundAll(g, P0); fundAll(g, P1, 8);
    put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
    const e = put(g, P1, 'V(5)', BF_A);
    const r = hand(g, P1, resp);
    const dl = hand(g, P0, 'Dockside Lock-Up');
    g = act(g, { type: 'playCard', player: P0, obj: dl, destination: BF_A });
    g = drive(g, [[e], [e]], x => x.chain.some(c => c.source === dl) && x.pending?.player === P1 && !x.pending.inStep);
    assert.ok(canPlayNow(g, P1, r), `${resp} playable in response`);
    g = act(g, { type: 'playCard', player: P1, obj: r });
    for (let i = 0; i < 30 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0) && g.pending.kind !== 'showdownAction'; i++) {
      const d = g.pending;
      if (!d.inStep) { g = pass(g); continue; }
      const o = d.options?.map(x => x.id) ?? [];
      const trig = d.options?.find(x => /Dockside/.test(x.label));
      g = ans(g, trig ? trig.id : o.includes(e) ? [e] : o.includes(String(BF_A)) ? String(BF_A) : d.kind === 'optional' ? 'yes' : 'first');
    }
    assert.ok(!Object.values(g.objects).some(o => o.zone === 'banishment' && g.cards[o.cardId]?.name === 'V(5)'), 'nothing banished');
    assert.ok(Object.values(g.objects).some(o => ['base', 'battlefield'].includes(o.zone) && g.cards[o.cardId]?.name === 'V(5)'), 'the unit is on the board');
    assert.equal(zone(g, dl), 'battlefield', 'Lock-Up stays');
  });
}

test('RJ#13018 Exemplar of Demacia moves my exhausted unit to the battlefield where I played Portable Portal: the Portal\'s "ready a unit here" can\'t choose it (chosen when chained, before the move)', () => {
  let g = S0(); fundAll(g, P0, 8); addRunes(g, P0, 3, 'body');
  setLegend(g, P0, 'rad-155-167');
  const u = put(g, P0, 'V(2)', 'base'); g.objects[u].exhausted = true; g.timestamp++;
  const pp = hand(g, P0, 'Portable Portal');
  g = act(g, { type: 'playCard', player: P0, obj: pp, destination: BF_A });
  let portalOffered = false;
  for (let i = 0; i < 30 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    const o = d.options?.map(x => x.id) ?? [];
    if (/Portal|ready/i.test(d.prompt ?? '') && o.includes(u)) portalOffered = true;
    g = ans(g, o.includes(u) ? [u] : o.includes(String(BF_A)) ? String(BF_A) : d.kind === 'optional' ? 'yes' : 'first');
  }
  assert.equal(locOf(g, u), BF_A, 'Exemplar moved it');
  assert.equal(g.objects[u].exhausted, true, 'not readied by the Portal');
  assert.ok(!portalOffered);
});

test('RJ#13021 attacker under Tactical Retreat is killed by the defender\'s Ntofo Strikes in the showdown: recalled before combat damage → it deals no damage to the defender', () => {
  let { g, atk, def } = attackSetup(['V(3)'], ['V(5)']);
  fundAll(g, P0); fundAll(g, P1);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Tactical Retreat') }), [[atk[0]]], x => x.chain.length === 0 && x.pending?.kind === 'showdownAction');
  expectPending(g, 'showdownAction', P1);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'rad-148-167') });
  g = drive(g, [[def[0]], [atk[0]]]);
  assert.equal(locOf(g, atk[0]), 'base', 'recalled instead of dying');
  assert.equal(g.objects[def[0]].damage, 0, 'no combat damage from the recalled attacker');
  assert.equal(zone(g, def[0]), 'battlefield');
});

test('RJ#13022 exhausting Pitiless Stalker to pay Ki Burst\'s additional cost doesn\'t activate his [T] stun: one stun only, and he can\'t activate afterwards', () => {
  let g = S0(); fundAll(g, P0);
  const s = put(g, P0, 'Pitiless Stalker', 'base');
  const e1 = put(g, P1, 'V(2)', 'base'), e2 = put(g, P1, 'V(3)', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Ki Burst') });
  for (let i = 0; i < 20 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    const o = d.options?.map(x => x.id) ?? [];
    g = ans(g, o.includes(e1) ? [e1] : o.includes(s) ? [s] : d.kind === 'optional' ? 'yes' : 'first');
  }
  assert.equal(g.objects[s].exhausted, true, 'Stalker paid the cost');
  assert.equal(g.objects[e1].stunned, true);
  assert.ok(!g.objects[e2].stunned, 'no second stun');
  assert.ok(!legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === s), 'his [T] ability needs him ready');
});

test('RJ#13024 Hwei, Brooding Painter with Svellsongur moves: two separate move triggers, each draws 1 / discards 1 / gives its own type bonus (+3 per Unit discarded), not a doubled discard', () => {
  let g = S0(); fundAll(g, P0);
  const h = put(g, P0, 'Hwei, Brooding Painter', 'base');
  const sv = put(g, P0, 'Svellsongur', 'base'); attachNow(g, sv, h);
  const m0 = mightOf(g, h);
  const u1 = put(g, P0, 'V(1)', 'deckTop'), u2 = put(g, P0, 'V(2)', 'deckTop');
  g = move(g, P0, [h], BF_A);
  let most = 0;
  for (let i = 0; i < 40 && g.pending && !(['mainAction', 'showdownAction'].includes(g.pending.kind) && g.chain.length === 0); i++) {
    const d = g.pending;
    most = Math.max(most, g.chain.filter(c => c.source === h || c.source === sv).length);
    if (!d.inStep) { g = pass(g); continue; }
    const o = d.options?.map(x => x.id) ?? [];
    g = ans(g, o.includes(u1) ? [u1] : o.includes(u2) ? [u2] : d.kind === 'optional' ? 'yes' : 'first');
  }
  assert.ok(most >= 1);
  assert.equal(zone(g, u1), 'trash'); assert.equal(zone(g, u2), 'trash');
  assert.equal(mightOf(g, h), m0 + 6, '+3 per trigger');
});

test('RJ#13027 Ekko (rad-021) activates "banish me, then play me to your base"; the opponent responds with a hidden Hostile Takeover: the ability is still mine → Ekko returns to MY base, ready', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const e = put(g, P0, 'rad-021-167', BF_A); control(g, BF_A, P1);
  put(g, P0, 'V(1)', 'hand');
  const ht = put(g, P1, 'Hostile Takeover', { facedown: BF_A });
  g = act(g, legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === e)!);
  g = drive(g, ['first'], x => x.pending?.kind === 'chainResponse' && x.pending.player === P1);
  assert.ok(canPlayNow(g, P1, ht));
  g = act(g, { type: 'playCard', player: P1, obj: ht });
  g = drive(g, [[e]], x => x.chain.length === 2 && x.pending?.kind === 'chainResponse' && x.pending.player === P0);
  g = drive(g, ['first', 'first']);
  assert.equal(zone(g, e), 'base');
  assert.equal(g.objects[e].controller, P0, 'played by the ability\'s controller');
  assert.equal(g.objects[e].exhausted, false, 'enters ready');
});

test('RJ#13028 Hall of Legends: the conquering player declines to pay [1] → the trigger leaves before finalizing; the opponent gets no Reaction window (paying → they do)', () => {
  for (const pay of [false, true]) {
    let g = S0(); fundAll(g, P0, 12); fundAll(g, P1); setBattlefieldCard(g, BF_A, 'Hall of Legends');
    const leg = g.players[P0].legend; g.objects[leg].exhausted = true;
    const u = put(g, P0, 'V(2)', 'base');
    g = move(g, P0, [u], BF_A);
    let asked = false, p1Window = false;
    for (let i = 0; i < 30 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
      const d = g.pending;
      if (d.player === P1 && g.chain.length > 0 && !d.inStep) p1Window = true;
      if (d.kind === 'optional' && /ready your legend|Hall of Legends|pay/i.test(d.prompt ?? '')) { asked = true; g = ans(g, pay ? 'yes' : 'no'); continue; }
      g = d.inStep ? ans(g, 'first') : pass(g);
    }
    assert.ok(asked);
    assert.equal(p1Window, pay, pay ? 'paid → finalized item, opponent may respond' : 'declined → no window');
    assert.equal(g.objects[leg].exhausted, !pay);
  }
});

test('RJ#13030 Runeblade Anvil killed in response to its own play trigger (KillGearR): both banish-and-may-play effects happen (leave trigger first), the play trigger still resolves', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const t1 = put(g, P0, 'V(1)', 'deckTop'), t2 = put(g, P0, 'V(2)', 'deckTop');
  const an = hand(g, P0, 'Runeblade Anvil');
  const kg = hand(g, P1, 'KillGearR');
  g = act(g, { type: 'playCard', player: P0, obj: an });
  g = drive(g, [], x => x.chain.length > 0 && x.pending?.kind === 'chainResponse' && x.pending.player === P1);
  g = act(g, { type: 'playCard', player: P1, obj: kg });
  g = drive(g, [[an], 'first', 'first'], x => x.chain.length === 0 && x.pending?.kind === 'mainAction');
  assert.equal(zone(g, an), 'trash');
  assert.equal(zone(g, t1), 'banishment'); assert.equal(zone(g, t2), 'banishment');
  assert.ok(canPlayNow(g, P0, t1) && canPlayNow(g, P0, t2), 'both banished cards are playable');
});

test('RJ#13032 Akshan, Mischievous takes the opponent\'s Dockside Lock-Up: it moves to my base under my control; its "when you hold here" can no longer return the banished card', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1, 8);
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const mine = put(g, P0, 'V(3)', BF_A);
  const dl = hand(g, P1, 'Dockside Lock-Up');
  g = act(g, { type: 'playCard', player: P1, obj: dl, destination: BF_A });
  g = drive(g, [[mine], [mine]], x => x.chain.length === 0 && x.pending?.kind === 'mainAction');
  assert.equal(zone(g, mine), 'banishment');
  g = nextTurn(g); fundAll(g, P0);
  const ak = hand(g, P0, 'Akshan, Mischievous');
  g = act(g, { type: 'playCard', player: P0, obj: ak, destination: 'base' });
  for (let i = 0; i < 30 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    const o = d.options?.map(x => x.id) ?? [];
    g = ans(g, o.includes(dl) ? [dl] : d.kind === 'optional' ? 'yes' : 'first');
  }
  assert.equal(locOf(g, dl), 'base'); assert.equal(g.objects[dl].controller, P0);
  g = nextTurn(g);                           // P1 holds BF_A
  assert.equal(g.battlefields[BF_A].controller, P1);
  assert.equal(zone(g, mine), 'banishment', 'the hold trigger no longer works from my base');
  assert.equal(zone(g, dl), 'base');
});

test('RJ#13033 Akshan, Mischievous moves the opponent\'s The Ball to my base: The Ball\'s "when you move this" triggers for neither player', () => {
  let g = S0(); fundAll(g, P0);
  control(g, BF_A, P1);
  const tb = put(g, P1, 'The Ball', BF_A);
  const h0 = g.players[0].hand.length, h1 = g.players[1].hand.length;
  const ak = hand(g, P0, 'Akshan, Mischievous');
  g = act(g, { type: 'playCard', player: P0, obj: ak, destination: 'base' });
  for (let i = 0; i < 30 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    const o = d.options?.map(x => x.id) ?? [];
    g = ans(g, o.includes(tb) ? [tb] : d.kind === 'optional' ? 'yes' : 'first');
  }
  assert.equal(locOf(g, tb), 'base'); assert.equal(g.objects[tb].controller, P0);
  assert.ok(!g.log.some(l => /Trigger: The Ball|Resolving The Ball/.test(l.text)), 'no The Ball trigger');
  assert.equal(g.players[1].hand.length, h1);
  assert.equal(g.players[0].hand.length, h0, 'no draw (Akshan was added to the hand after h0 was read, then played)');   // ENGINE-9: was h0 - 1
});

test('RJ#13035 Divining Shells\' [Action] ability can be activated in a combat showdown (open state) on the defender\'s side: Shells killed as the cost, the unit gets +2', () => {
  let { g, def } = attackSetup(['V(3)'], ['V(2)']);
  const ds = put(g, P1, 'Divining Shells', 'base');
  g = pass(g);                                         // attacker passes focus
  expectPending(g, 'showdownAction', P1);
  const a = legal(g, P1, 'activate').find(x => x.type === 'activate' && x.obj === ds);
  assert.ok(a, 'activatable in the open showdown');
  g = act(g, a!);
  g = drive(g, [[def[0]]], x => x.chain.length === 0 && x.pending?.kind !== 'chainResponse');
  assert.equal(zone(g, ds), 'trash');
  assert.equal(mightOf(g, def[0]), 4);
});

test('RJ#13045 a Gold gear token can be shown off for "[Show Off] a gear" (Battle Preparations): runes readied', () => {
  let g = S0(); setRunes(g, P0, 2, 'calm');
  const gold = put(g, P0, 'Gold', 'base', { token: true });
  const u = put(g, P0, 'V(2)', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Battle Preparations') });
  let offered = false;
  for (let i = 0; i < 30 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    const o = d.options?.map(x => x.id) ?? [];
    if (o.includes(gold)) offered = true;
    g = ans(g, o.includes(gold) ? [gold] : o.includes(u) ? [u] : d.kind === 'optional' ? 'yes' : /rune/i.test(d.prompt ?? '') ? o.filter(x => g.players[0].runesInPlay.includes(x)).slice(0, 2) : 'first');
  }
  assert.ok(offered, 'Gold token offered for Show Off');
  assert.equal(mightOf(g, u), 4);
  assert.equal(g.players[0].runesInPlay.filter(r => g.objects[r].exhausted).length, 0, 'showed off → runes readied');
});

test('RJ#13047 Repulse can counter a repeated Thwonk! whose two executions chose the same attacker (one spell, one friendly unit) → neither stun happens', () => {
  let { g, atk } = attackSetup(['V(3)'], ['V(3)']);
  fundAll(g, P0); fundAll(g, P1, 8);
  g = pass(g);
  expectPending(g, 'showdownAction', P1);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Thwonk!') });
  for (let i = 0; i < 10 && g.pending?.inStep; i++) { const d = g.pending; const o = d.options!.map(x => x.id); g = ans(g, d.kind === 'optional' ? 'yes' : o.includes(atk[0]) ? [atk[0]] : 'first'); }
  if (g.pending?.player === P1) g = pass(g);
  const rp = hand(g, P0, 'Repulse');
  assert.ok(canPlayNow(g, P0, rp), 'Repulse legal');
  g = act(g, { type: 'playCard', player: P0, obj: rp });
  g = drive(g, [[atk[0]], 'first'], x => x.chain.length === 0);
  assert.ok(g.log.some(l => /Thwonk! is countered/.test(l.text)));
  assert.ok(!g.objects[atk[0]].stunned);
});

test('RJ#13049 Temporal Breach on Ekko (rad-061, "return a friendly unit to its owner\'s hand" additional cost): ignoring his cost doesn\'t waive it — another friendly unit (anywhere) returns to hand', () => {
  let g = S0(); fundAll(g, P0);
  const ek = put(g, P0, 'rad-061-167', BF_A); control(g, BF_A, P0);
  const other = put(g, P0, 'V(2)', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Temporal Breach') });
  for (let i = 0; i < 30 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    const o = d.options?.map(x => x.id) ?? [];
    g = ans(g, /return/i.test(d.prompt ?? '') && o.includes(other) ? [other] : o.includes(ek) ? [ek] : d.kind === 'optional' ? 'yes' : 'first');
  }
  const ekNow = Object.values(g.objects).find(o => o.cardId === 'rad-061-167' && ['base', 'battlefield'].includes(o.zone));
  assert.ok(ekNow, 'Ekko replayed');
  assert.equal(zone(g, other), 'hand', 'additional cost paid');
});

test('RJ#13052 Gutter Guardian played from face down can\'t show off itself (it is a chain item, not in hand or on the board): no [A]', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const gg = put(g, P0, 'Gutter Guardian', { facedown: BF_A });
  assert.ok(canPlayNow(g, P0, gg));
  g = act(g, { type: 'playCard', player: P0, obj: gg });
  let selfOffered = false;
  for (let i = 0; i < 30 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    if (d.options?.some(x => x.id === gg) && /show/i.test(d.prompt ?? '')) selfOffered = true;
    g = ans(g, d.kind === 'optional' ? 'yes' : 'first');
  }
  assert.ok(!selfOffered, 'it can\'t be its own Show Off');
  assert.equal(zone(g, gg), 'battlefield');
  const power = (x: typeof g) => Object.values((x.players[0] as unknown as { pool: { power: Record<string, number> } }).pool.power).reduce((a, b) => a + b, 0);
  assert.equal(power(g), 0, 'no [A] added');
  // control: with another Hidden card in hand it can show that off → [A]
  let h = S0(); fundAll(h, P0);
  put(h, P0, 'V(2)', BF_A); control(h, BF_A, P0);
  const gg2 = put(h, P0, 'Gutter Guardian', { facedown: BF_A });
  const ht = hand(h, P0, 'Hostile Takeover');
  h = act(h, { type: 'playCard', player: P0, obj: gg2 });
  for (let i = 0; i < 30 && h.pending && !(h.pending.kind === 'mainAction' && h.chain.length === 0); i++) {
    const d = h.pending;
    if (!d.inStep) { h = pass(h); continue; }
    h = ans(h, d.options?.some(x => x.id === ht) ? [ht] : d.kind === 'optional' ? 'yes' : 'first');
  }
  assert.equal(power(h), 1);
});

test('RJ#13056 Shuriken Flip with an enemy unit at a battlefield: "up to one" lets me choose no damage target and still move my unit', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(3)', BF_B); control(g, BF_B, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Shuriken Flip') });
  let zeroOk = false;
  for (let i = 0; i < 30 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    const o = d.options?.map(x => x.id) ?? [];
    if (o.includes(e)) { assert.equal(d.min ?? 0, 0, 'zero targets allowed'); zeroOk = true; g = ans(g, []); continue; }
    g = ans(g, o.includes(u) ? [u] : 'first');
  }
  assert.ok(zeroOk);
  assert.equal(g.objects[e].damage, 0);
  assert.notEqual(locOf(g, u), BF_A, 'moved');
});

test('RJ#13061 lone defender Flashed to base in the combat showdown, then my hidden Resonating Strike there moves it back (+2): control is kept, it defends again', () => {
  let { g, atk, def } = attackSetup(['V(4)'], ['V(3)']);
  fundAll(g, P0); fundAll(g, P1, 10);
  const rs = put(g, P1, 'Resonating Strike', { facedown: BF_A });
  g = pass(g);
  expectPending(g, 'showdownAction', P1);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Flash') });
  g = drive(g, [[def[0]]], x => x.chain.length === 0 && x.pending?.kind === 'showdownAction');
  assert.equal(locOf(g, def[0]), 'base');
  if (g.pending!.player !== P1) g = pass(g);
  assert.equal(g.battlefields[BF_A].controller, P1, 'control kept during the showdown');
  assert.ok(canPlayNow(g, P1, rs), 'hidden Resonating Strike playable');
  g = act(g, { type: 'playCard', player: P1, obj: rs });
  g = drive(g, [String(BF_A), [def[0]]], x => x.chain.length === 0 && (x.pending?.kind === 'showdownAction' || x.pending?.kind === 'assignDamage'));
  assert.equal(locOf(g, def[0]), BF_A);
  assert.equal(mightOf(g, def[0]), 5);
  assert.equal(g.objects[def[0]].combatRole, 'defender');
  assert.equal(zone(g, atk[0]), 'battlefield');
});

test('RJ#13063 Ekko (rad-021) ability: activating it isn\'t a card play (Legion off on the chain), but Ekko played to base on resolution turns Noxus Hopeful\'s Legion on', () => {
  let g = S0(); fundAll(g, P0, 10);
  const e = put(g, P0, 'rad-021-167', 'base');
  put(g, P0, 'V(1)', 'hand');
  const nh = hand(g, P0, 'Noxus Hopeful');
  const base = playCostOf(g, P0, nh)!.energy;
  g = act(g, legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === e)!);
  g = ans(g, ...(g.pending?.inStep ? ['first' as const] : []));
  assert.ok(g.chain.length > 0, 'ability on the chain');
  assert.equal(playCostOf(g, P0, nh)!.energy, base, 'activation alone: no Legion');
  g = drive(g, ['first']);
  assert.equal(zone(g, e), 'base');
  assert.equal(zone(g, nh), 'hand');
  assert.ok(playCostOf(g, P0, nh)!.energy < base, 'Legion on after Ekko was played');
});

test('RJ#13065 The Exile (Riven legend) + Emperor\'s Dais: the Sand Soldier token played on the conquer enters ready', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  setLegend(g, P0, 'rad-149-167');
  setBattlefieldCard(g, BF_A, "Emperor's Dais");
  const t = put(g, P0, 'V(2)', 'base'), u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [t, u], BF_A);
  g = drive(g, [], x => x.pending?.kind === 'optional' && /Dais|Sand Soldier|pay/i.test(x.pending.prompt ?? ''));
  g = drive(g, ['yes', [t]]);
  const ss = unitsNamed(g, 'Sand Soldier');
  assert.equal(ss.length, 1);
  assert.equal(g.objects[ss[0]].exhausted, false, 'entered ready');
});

test('RJ#13066 Renata Glasc, Mastermind\'s [1][C]: Draw 1 can be activated repeatedly at a battlefield (no exhaust); not from base', () => {
  let g = S0(); fundAll(g, P0, 10); addRunes(g, P0, 4, 'mind');
  const r = put(g, P0, 'sfd-088-221', BF_A); control(g, BF_A, P0);
  const h0 = g.players[0].hand.length;
  for (let k = 0; k < 2; k++) {
    const a = legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === r && (x as { abilityIndex?: number }).abilityIndex === 0);
    assert.ok(a, `activation ${k + 1} available`);
    g = drive(act(g, a!));
  }
  assert.equal(g.players[0].hand.length, h0 + 2);
  assert.equal(g.objects[r].exhausted, false);
  let b = S0(); fundAll(b, P0, 10); addRunes(b, P0, 4, 'mind');
  const r2 = put(b, P0, 'sfd-088-221', 'base');
  assert.ok(!legal(b, P0, 'activate').some(x => x.type === 'activate' && x.obj === r2), 'not while in base');
});

test('RJ#13071 Bushwhack Trap killed while I still control its battlefield with two hidden cards there: the occupancy drops to 1, so I trash one of them (CR 107.3.b.2); not a kill', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const bt = put(g, P0, 'Bushwhack Trap', BF_A);
  const f1 = put(g, P0, 'V(1)', { facedown: BF_A }), f2 = put(g, P0, 'V(3)', { facedown: BF_A });
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'KillGearM') });
  for (let i = 0; i < 30 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    const o = d.options?.map(x => x.id) ?? [];
    g = ans(g, o.includes(bt) ? [bt] : o.includes(f1) ? [f1] : d.kind === 'optional' ? 'yes' : 'first');
  }
  assert.equal(zone(g, bt), 'trash');
  assert.deepEqual([zone(g, f1), zone(g, f2)].sort(), ['facedown', 'trash'], 'exactly one hidden card trashed');
});

test('RJ#13072 Svellsongur on The Ball made a unit (Lady of Clockwork effect): moving it gives two separate "play or move" triggers, each with its own choice (Draw 1 twice)', () => {
  let g = S0(); fundAll(g, P0);
  const tb = put(g, P0, 'The Ball', 'base');
  mod(g, tb, { becomeType: 'Unit' as never, setMight: 2, layer: 1, duration: 'permanent' });
  const sv = put(g, P0, 'Svellsongur', 'base'); attachNow(g, sv, tb);
  const h0 = g.players[0].hand.length;
  g = move(g, P0, [tb], BF_A);
  for (let i = 0; i < 30 && g.pending && !(['mainAction', 'showdownAction'].includes(g.pending.kind) && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    const dr = d.options?.find(x => /Draw 1/i.test(x.label));
    g = ans(g, dr ? dr.id : d.kind === 'optional' ? 'yes' : 'first');
  }
  assert.equal(g.log.filter(l => /Resolving The Ball|Resolving Svellsongur/.test(l.text)).length, 2, 'two triggers');
  assert.equal(g.players[0].hand.length, h0 + 2);
});

test('RJ#13073 Zhonya\'s Hourglass as a unit dies in combat at the same time as another friendly unit: it saves that unit (recalled, healed) and still goes to the trash itself', () => {
  let g = S0();
  const z = put(g, P1, "Zhonya's Hourglass", BF_A);
  mod(g, z, { becomeType: 'Unit' as never, setMight: 2, layer: 1, duration: 'permanent' });
  const d = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(10)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 40 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const p = g.pending;
    if (p.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: p.player, assignment: { [z]: 5, [d]: 5 } }); continue; }
    if (!p.inStep) { g = pass(g); continue; }
    const o = p.options?.map(x => x.id) ?? [];
    g = ans(g, o.includes(d) ? [d] : p.kind === 'optional' ? 'yes' : 'first');
  }
  assert.equal(zone(g, z), 'trash', 'the Hourglass dies');
  assert.equal(locOf(g, d), 'base', 'the other unit was saved');
  assert.equal(g.objects[d].damage, 0);
});

test('RJ#13075 Temporal Breach on my ready Brynhir Thundersong in base: she is replayed exhausted and her play trigger fires again', () => {
  let g = S0(); fundAll(g, P0);
  const b = put(g, P0, 'Brynhir Thundersong', 'base');
  assert.equal(g.objects[b].exhausted, false);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Temporal Breach') });
  for (let i = 0; i < 30 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    const o = d.options?.map(x => x.id) ?? [];
    g = ans(g, o.includes(b) ? [b] : d.kind === 'optional' ? 'yes' : 'first');
  }
  const nb = Object.values(g.objects).find(o => g.cards[o.cardId]?.name === 'Brynhir Thundersong' && o.zone === 'base')!;
  assert.ok(nb);
  assert.equal(nb.exhausted, true, 'replayed exhausted');
  assert.ok(g.log.some(l => /Resolving Brynhir/.test(l.text)), 'play trigger again');
});

test('RJ#13076 Iridescent Avian on an already-buffed Lee Sin, Ascetic: its "if already buffed" clause applies → +2 this turn instead of a second buff; unbuffed → a buff', () => {
  for (const pre of [true, false]) {
    let g = S0();
    const l = put(g, P0, 'Lee Sin, Ascetic', 'base', pre ? { buff: true } : {});
    const av = put(g, P0, 'Iridescent Avian', 'base');
    const m0 = mightOf(g, l), b0 = g.objects[l].counters.buff ?? 0;
    g = act(g, legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === av)!);
    g = drive(g, [[l]]);
    if (pre) { assert.equal(g.objects[l].counters.buff, b0, 'no extra buff'); assert.equal(mightOf(g, l), m0 + 2); }
    else { assert.equal(g.objects[l].counters.buff, 1); assert.equal(mightOf(g, l), m0 + 1); }
  }
});

test('RJ#13079 a gear made a unit (Lady of Clockwork effect) with The Zero Drive dies → banished as a plain gear card; The Zero Drive\'s "play all units banished with this" can\'t play it', () => {
  let g = S0(); fundAll(g, P0, 8); fundAll(g, P1);
  const z = put(g, P0, "Zhonya's Hourglass", BF_A); control(g, BF_A, P0);
  mod(g, z, { becomeType: 'Unit' as never, setMight: 2, layer: 1, duration: 'permanent' });
  const zd = put(g, P0, 'The Zero Drive', 'base'); attachNow(g, zd, z);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'KillDraw') });
  for (let i = 0; i < 20 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    const o = d.options?.map(x => x.id) ?? [];
    g = ans(g, o.includes(z) ? [z] : d.kind === 'optional' ? 'yes' : 'first');
  }
  assert.equal(zone(g, z), 'banishment', 'banished by the granted Deathknell');
  const a = legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === zd);
  assert.ok(a);
  g = drive(act(g, a!));
  assert.equal(zone(g, z), 'banishment', 'a gear card in banishment, not a unit: not played');
});

test('RJ#13080 my 3-Might unit with 1 damage; opponent plays Thousand-Tailed Watcher; I Discipline it in response (+2 → 5): the -3 leaves 2 Might > 1 damage → it survives', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 12); fundAll(g, P1, 12);
  const u = put(g, P0, 'V(3)', 'base'); g.objects[u].damage = 1; g.timestamp++;
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Thousand-Tailed Watcher'), destination: 'base' } as never);
  for (let i = 0; i < 4 && g.pending?.inStep; i++) g = ans(g, g.pending.kind === 'optional' ? 'no' : 'first');
  if (g.pending?.player === P1) g = pass(g);
  assert.ok(g.chain.length > 0, 'Watcher trigger on the chain');
  const dc = hand(g, P0, 'Discipline');
  assert.ok(canPlayNow(g, P0, dc));
  g = act(g, { type: 'playCard', player: P0, obj: dc });
  g = drive(g, [[u]]);
  assert.equal(zone(g, u), 'base', 'survives');
  assert.equal(mightOf(g, u), 2);
});

test('RJ#13081 Zero Point Inflection triggers on its own play ("when you play a card"): playing it draws 2', () => {
  let g = S0(); fundAll(g, P0, 12); addRunes(g, P0, 2, 'mind');
  const zp = hand(g, P0, 'Zero Point Inflection');
  const h0 = g.players[0].hand.length;
  g = drive(act(g, { type: 'playCard', player: P0, obj: zp }));
  assert.equal(zone(g, zp), 'base');
  assert.equal(g.players[0].hand.length, h0 - 1 + 2);
});

test('RJ#13082 Zero Point Inflection made a unit is returned to hand as Ekko (rad-061)\'s additional cost: it is gone before Ekko\'s play completes → no draw 2', () => {
  let g = S0(); fundAll(g, P0, 12);
  const zp = put(g, P0, 'Zero Point Inflection', 'base');
  mod(g, zp, { becomeType: 'Unit' as never, setMight: 2, layer: 1, duration: 'permanent' });
  const ek = hand(g, P0, 'rad-061-167');
  const h0 = g.players[0].hand.length;
  g = act(g, { type: 'playCard', player: P0, obj: ek, destination: 'base' });
  for (let i = 0; i < 30 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    const o = d.options?.map(x => x.id) ?? [];
    g = ans(g, o.includes(zp) ? [zp] : d.kind === 'optional' ? 'yes' : 'first');
  }
  assert.equal(zone(g, ek), 'base');
  assert.equal(zone(g, zp), 'hand');
  assert.equal(g.players[0].hand.length, h0 - 1 + 1, 'Ekko left, ZPI returned, no draws');
});

test('RJ#13086 opponent\'s Irresistible Faefolk move trigger on the chain: I resolve Last Caress first, then play my hidden unit to the Faefolk\'s (opponent-controlled) battlefield; the pull still happens', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 8); fundAll(g, P1);
  const mine = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const hid = put(g, P0, 'V(3)', { facedown: BF_A });
  put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  const ff = put(g, P1, 'Irresistible Faefolk', 'base');
  g = move(g, P1, [ff], BF_B);
  for (let i = 0; i < 10 && g.pending?.inStep; i++) { const d = g.pending; const o = d.options!.map(x => x.id); g = ans(g, d.kind === 'optional' ? 'yes' : o.includes(mine) ? [mine] : 'first'); }
  g = drive(g, [], x => x.chain.length > 0 && x.pending?.kind === 'chainResponse' && x.pending.player === P0);
  const lc = hand(g, P0, 'Last Caress');
  g = act(g, { type: 'playCard', player: P0, obj: lc });
  assert.ok(!canPlayNow(g, P0, hid, BF_B), 'not yet (Last Caress unresolved)');
  g = drive(g, [], x => x.chain.length === 1 && x.pending?.kind === 'chainResponse' && x.pending.player === P0);
  assert.ok(canPlayNow(g, P0, hid, BF_B), 'after Last Caress resolved: hidden unit to the opponent\'s battlefield');
  g = act(g, { type: 'playCard', player: P0, obj: hid, destination: BF_B });
  g = drive(g, ['first', 'first', 'first'], x => x.chain.length === 0);
  assert.equal(locOf(g, hid), BF_B);
  assert.equal(mightOf(g, hid), 4, 'buffed');
  assert.equal(locOf(g, mine), BF_B, 'the Faefolk pull still resolved');
});

test('RJ#13092 Edge of Night played from face down at a battlefield is a gear played to a battlefield: Hold \'Em costs [2] less; from hand (to base) it doesn\'t count', () => {
  for (const hidden of [true, false]) {
    let g = S0(); fundAll(g, P0, 10);
    put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
    const he = hand(g, P0, "Hold 'Em");
    const c0 = playCostOf(g, P0, he)!.energy;
    const en = hidden ? put(g, P0, 'Edge of Night', { facedown: BF_A }) : hand(g, P0, 'Edge of Night');
    g = act(g, { type: 'playCard', player: P0, obj: en });
    g = drive(g, ['first', 'first']);
    assert.equal(playCostOf(g, P0, he)!.energy, hidden ? c0 - 2 : c0);
  }
});

test('RJ#13098 two attackers, one with Last Rites; the other dies in the combat and I conquer: Last Rites\' conquer trigger can play the unit that just died', () => {
  let g = S0(); fundAll(g, P0, 10);
  const d = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const u = put(g, P0, 'V(4)', 'base'), w = put(g, P0, 'V(3)', 'base');
  const lr = put(g, P0, 'Last Rites', 'base'); attachNow(g, lr, u);
  g = move(g, P0, [u, w], BF_A);
  let offered = false;
  for (let i = 0; i < 40 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const p = g.pending;
    if (p.kind === 'assignDamage') {
      g = act(g, { type: 'assignDamage', player: p.player, assignment: p.player === P1 ? { [w]: 3 } : { [d]: 7 } });
      continue;
    }
    if (!p.inStep) { g = pass(g); continue; }
    const o = p.options?.map(x => x.id) ?? [];
    if (o.includes(w) && zone(g, w) === 'trash') offered = true;
    g = ans(g, o.includes(w) ? [w] : o.includes('base') ? 'base' : p.kind === 'optional' ? 'yes' : 'first');
  }
  assert.equal(g.battlefields[BF_A].controller, P0, 'conquered');
  assert.ok(offered, 'the dead unit was a legal choice');
  assert.ok(['base', 'battlefield'].includes(zone(g, w) as string), 'played from the trash');
});

test('RJ#13101 Skystrike Squadron\'s "return a friendly gear" additional cost can return an attached Shepherd\'s Heirloom: costs [2] less, the host loses it, no Heirloom play trigger', () => {
  let g = S0(); fundAll(g, P0, 10); addRunes(g, P0, 2, 'body');
  const host = put(g, P0, 'V(2)', 'base');
  const hl = put(g, P0, "Shepherd's Heirloom", 'base'); attachNow(g, hl, host);
  const ss = hand(g, P0, 'Skystrike Squadron');
  const xp0 = (g.players[0] as unknown as { xp?: number }).xp ?? 0;
  const e0 = g.players[0].runesInPlay.filter(r => !g.objects[r].exhausted).length;
  g = act(g, { type: 'playCard', player: P0, obj: ss, destination: 'base' });
  for (let i = 0; i < 30 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    const o = d.options?.map(x => x.id) ?? [];
    g = ans(g, o.includes(hl) ? [hl] : d.kind === 'optional' ? 'yes' : 'first');
  }
  assert.equal(zone(g, ss), 'base');
  assert.equal(zone(g, hl), 'hand');
  assert.equal(g.objects[hl].attachedTo, undefined, 'detached');
  assert.equal(e0 - g.players[0].runesInPlay.filter(r => !g.objects[r].exhausted).length, 3, '5 - 2 = 3 Energy');
  assert.equal((g.players[0] as unknown as { xp?: number }).xp ?? 0, xp0, 'no XP (not played)');
});

test('RJ#13105 Bilgewater Tracker\'s "deal 1 to each of up to 2 units" can\'t choose the same unit twice', () => {
  let g = S0(); fundAll(g, P0);
  const e = put(g, P1, 'V(2)', 'base'), f = put(g, P1, 'V(2)', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Bilgewater Tracker'), destination: 'base' });
  for (let i = 0; i < 10 && g.pending && !(g.pending.options ?? []).some(x => x.id === e); i++) g = g.pending.inStep ? ans(g, 'first') : pass(g);
  const d = g.pending!;
  assert.ok(d.options!.some(x => x.id === e));
  assert.ok(validateAction(g, { type: 'choose', player: d.player, optionIds: [e, e] }) !== null, 'the same unit twice is rejected');
  g = drive(g, [[e, f]]);
  assert.deepEqual([g.objects[e].damage, g.objects[f].damage], [1, 1]);
});

test('RJ#13109 Detonation Amplifier\'s play effect kills my Deathknell unit at its battlefield as the cost to draw: the Deathknell triggers twice (draw 1 + 1 + 1)', () => {
  let g = S0(); fundAll(g, P0, 8);
  const dk = put(g, P0, 'DK(2)', BF_A); control(g, BF_A, P0);
  const da = hand(g, P0, 'Detonation Amplifier');
  const h0 = g.players[0].hand.length;
  g = act(g, { type: 'playCard', player: P0, obj: da, destination: BF_A });
  for (let i = 0; i < 30 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    const o = d.options?.map(x => x.id) ?? [];
    g = ans(g, o.includes(dk) ? [dk] : d.kind === 'optional' ? 'yes' : 'first');
  }
  assert.equal(zone(g, dk), 'trash');
  assert.equal(g.players[0].hand.length, h0 - 1 + 3, 'Amplifier draw + two Deathknell draws');
});

test('RJ#13111 Temporal Breach on my unit at a battlefield while the opponent\'s Mageseeker Warden is at a battlefield: it can\'t be played back there (nor redirected to base) → stays banished', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P1, 'Mageseeker Warden', BF_B); control(g, BF_B, P1);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  put(g, P0, 'V(1)', BF_A);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Temporal Breach') });
  for (let i = 0; i < 30 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    const o = d.options?.map(x => x.id) ?? [];
    g = ans(g, o.includes(u) ? [u] : d.kind === 'optional' ? 'yes' : 'first');
  }
  assert.equal(zone(g, u), 'banishment');
});

test('RJ#13112 three 2-Might attackers each reduced by the Nine-Tailed Fox legend: Ahri, Confident triggers per reduction → +3', () => {
  let g = S0({ tp: P1 });
  setLegend(g, P0, 'ogn-255-298');
  const ah = put(g, P0, 'rad-038-167', BF_A); control(g, BF_A, P0);
  const m0 = mightOf(g, ah);
  const as = [put(g, P1, 'V(2)', 'base'), put(g, P1, 'V(2)', 'base'), put(g, P1, 'V(2)', 'base')];
  g = move(g, P1, as, BF_A);
  g = drive(g, Array(12).fill('first'), x => x.pending?.kind === 'showdownAction' && x.chain.length === 0 || x.pending?.kind === 'assignDamage' || x.pending?.kind === 'mainAction');
  for (const a of as) assert.equal(mightOf(g, a), 1);
  assert.equal(mightOf(g, ah), m0 + 3);
});

test('RJ#13117 Traveling Merchant Star-Crossed back to hand in response to its own move trigger: the trigger still resolves — it can discard the Merchant itself, then draw 1', () => {
  let g = S0(); fundAll(g, P0);
  const tm = put(g, P0, 'Traveling Merchant', 'base');
  put(g, P1, 'V(2)', 'base');
  g = move(g, P0, [tm], BF_A);
  g = drive(g, [], x => x.chain.length > 0 && x.pending?.kind === 'chainResponse' && x.pending.player === P0);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Star-Crossed') });
  let discardedSelf = false;
  for (let i = 0; i < 30 && g.pending && !(['mainAction', 'showdownAction'].includes(g.pending.kind) && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    const o = d.options?.map(x => x.id) ?? [];
    if (/discard/i.test(d.prompt ?? '') && o.includes(tm)) { discardedSelf = true; g = ans(g, [tm]); continue; }
    g = ans(g, o.includes(tm) ? [tm] : d.kind === 'optional' ? 'yes' : 'first');
  }
  assert.ok(discardedSelf || g.log.some(l => /P0 discards Traveling Merchant/.test(l.text)), 'the Merchant (now in hand) was discarded (auto when it is the only card)');
  assert.equal(zone(g, tm), 'trash');
  assert.ok(g.log.some(l => /P0 draws/.test(l.text)), 'then drew');
});

test('RJ#13119 hidden Elnuk Herd\'s +3 target is Gusted in response: the +3 is lost (no retarget) and the Herd still recycles itself', () => {
  let g = S0(); fundAll(g, P0, 8); fundAll(g, P1); addRunes(g, P0, 2, 'chaos');
  const fb = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const el = put(g, P0, 'Elnuk Herd', { facedown: BF_A });
  g = act(g, { type: 'playCard', player: P0, obj: el, destination: BF_A });
  g = drive(g, [[fb]], x => x.chain.length > 0 && x.pending?.kind === 'chainResponse' && x.pending.player === P1);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Gust') });
  for (let i = 0; i < 20 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    const o = d.options?.map(x => x.id) ?? [];
    g = ans(g, o.includes(fb) ? [fb] : d.kind === 'optional' ? 'yes' : 'first');
  }
  assert.equal(zone(g, fb), 'hand');
  assert.equal(unitsNamed(g, 'Elnuk Herd').length, 0, 'recycled');
  assert.ok(!Object.values(g.objects).some(o => g.cards[o.cardId]?.name === 'Elnuk Herd' && o.zone === 'battlefield'));
});

test('RJ#13122 Graves, Blasting Through with Cleave (Assault 3) attacks: his trigger deals his current Might incl. Assault (4 + 3 = 7)', () => {
  let g = S0(); fundAll(g, P0);
  const gr = put(g, P0, 'rad-085-167', 'base');
  const e = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Cleave') }), [[gr]]);
  g = move(g, P0, [gr], BF_A);
  g = drive(g, ['first', 'first', 'first'], x => (x.pending?.kind === 'showdownAction' && x.chain.length === 0) || x.pending?.kind === 'assignDamage');
  assert.equal(mightOf(g, gr), 7);
  assert.equal(g.objects[e].damage, 7);
});

test('RJ#13124 a Bomb\'s Deathknell ("deal 2 to an enemy unit here") can\'t choose Baron Nashor; with another enemy there it hits that one', () => {
  for (const other of [false, true]) {
    let g = withTokens(S0()); fundAll(g, P0, 10);
    const bn = put(g, P1, 'Baron Nashor', BF_A); control(g, BF_A, P1);
    const v = other ? put(g, P1, 'V(5)', BF_A) : undefined;
    g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Amateur Demolitionist'), destination: 'base' }), ['first', String(BF_A), String(BF_A)], x => x.pending?.kind === 'mainAction');
    const bomb = Object.keys(g.objects).find(id => g.cards[g.objects[id].cardId]?.name === 'Bomb' && g.objects[id].zone === 'battlefield')!;
    assert.ok(bomb);
    g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'KillGearM') });
    for (let i = 0; i < 20 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
      const d = g.pending;
      if (!d.inStep) { g = pass(g); continue; }
      const o = d.options?.map(x => x.id) ?? [];
      assert.ok(!(/deal 2|Bomb/i.test(d.prompt ?? '') && o.includes(bn)), 'Baron not choosable');
      g = ans(g, o.includes(bomb) ? [bomb] : v && o.includes(v) ? [v] : d.kind === 'optional' ? 'yes' : 'first');
    }
    assert.notEqual(zone(g, bomb), 'battlefield');
    assert.equal(g.objects[bn].damage, 0);
    if (v) assert.equal(g.objects[v].damage, 2);
  }
});

test('RJ#13127 I kill one of the opponent\'s two Bombs at a battlefield with none of my units: its Deathknell has no legal enemy target → removed, the other Bomb survives', () => {
  let g = withTokens(S0({ tp: P1 })); fundAll(g, P1, 12);
  control(g, BF_A, P1); put(g, P1, 'V(1)', BF_A);
  for (let k = 0; k < 2; k++) g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Amateur Demolitionist'), destination: 'base' }), ['first', String(BF_A), String(BF_A)], x => x.pending?.kind === 'mainAction');
  const bombs = () => Object.keys(g.objects).filter(id => g.cards[g.objects[id].cardId]?.name === 'Bomb' && g.objects[id].zone === 'battlefield');
  assert.equal(bombs().length, 2);
  g = nextTurn(g); fundAll(g, P0, 4);
  const b0 = bombs()[0];
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'KillGearM') });
  g = drive(g, [[b0]]);
  assert.equal(bombs().length, 1, 'the other Bomb is not killed');
});

test('RJ#13129 Pyke (unl-145) dies in the same combat damage as the enemy attackers: no Gold (he has left with them; as Viktor, Leader RJ#11730)', () => {
  let g = S0({ tp: P1 });
  const v = put(g, P0, 'V(3)', BF_A), pk = put(g, P0, 'unl-145-219', BF_A); control(g, BF_A, P0);
  const a1 = put(g, P1, 'V(3)', 'base'), a2 = put(g, P1, 'V(3)', 'base');
  g = move(g, P1, [a1, a2], BF_A);
  for (let i = 0; i < 40 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const p = g.pending;
    if (p.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: p.player, assignment: p.player === P1 ? { [v]: 3, [pk]: 3 } : { [a1]: 3, [a2]: 3 } }); continue; }
    g = p.inStep ? ans(g, p.kind === 'optional' ? 'yes' : 'first') : pass(g);
  }
  assert.deepEqual([zone(g, v), zone(g, pk), zone(g, a1), zone(g, a2)], ['trash', 'trash', 'trash', 'trash']);
  assert.ok(!Object.values(g.objects).some(o => g.cards[o.cardId]?.name === 'Gold' && o.controller === P0 && ['base', 'battlefield'].includes(o.zone)), 'no Gold');
});

test('RJ#13133 Call to Battle moves Armored Tusker and then an enemy unit to my battlefield: Tusker\'s move trigger (after the spell) can deal 3 (Shield) to that enemy unit before combat', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const t = put(g, P0, 'Armored Tusker', 'base');
  const e = put(g, P1, 'V(3)', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Call to Battle') });
  for (let i = 0; i < 40 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0) && g.pending.kind !== 'assignDamage' && !(g.pending.kind === 'showdownAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    const o = d.options?.map(x => x.id) ?? [];
    g = ans(g, o.includes(t) && zone(g, t) === 'base' ? [t] : o.includes(e) ? [e] : o.includes(String(BF_A)) ? String(BF_A) : d.kind === 'optional' ? 'yes' : 'first');
  }
  assert.equal(locOf(g, t), BF_A);
  assert.equal(zone(g, e), 'trash', 'killed by the 3 Shield damage before combat');
});

test('RJ#13142 K\'Sante (rad-045) with two Svellsongur and Nazuman Ntofo defends: Shield 1+1+1+2 = 5, three doubling triggers → 40 Shield, 44 Might', () => {
  let g = S0({ tp: P1 });
  const k = put(g, P0, 'rad-045-167', BF_A); control(g, BF_A, P0);
  for (const n of ['Svellsongur', 'Svellsongur', 'Nazuman Ntofo']) attachNow(g, put(g, P0, n, 'base'), k);
  assert.equal(kwValue(g, k, 'Shield'), 5);
  const a = put(g, P1, 'V(1)', 'base');
  g = move(g, P1, [a], BF_A);
  for (let i = 0; i < 40 && g.pending && g.pending.kind !== 'assignDamage' && !(g.chain.length === 0 && g.pending.kind === 'showdownAction'); i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    const o = d.options!.map(x => x.id);
    g = ans(g, o.includes(k) ? [k] : o[0]);
  }
  assert.equal(kwValue(g, k, 'Shield'), 40);
  assert.equal(mightOf(g, k), 44);
});

test('RJ#13147 Death from Below on a 2-Might unit saved by its controller\'s Zhonya\'s Hourglass: the replay from the trash is still offered (the condition checks Might, not the kill)', () => {
  let g = S0(); fundAll(g, P0, 10);
  const u = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  put(g, P1, "Zhonya's Hourglass", 'base');
  const dfb = hand(g, P0, 'Death from Below');
  g = act(g, { type: 'playCard', player: P0, obj: dfb });
  let offered = false;
  for (let i = 0; i < 30 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    if (d.kind === 'optional' && /trash/i.test(d.prompt ?? '')) { offered = true; g = ans(g, 'no'); continue; }
    const o = d.options?.map(x => x.id) ?? [];
    g = ans(g, o.includes(u) ? [u] : 'first');
  }
  assert.equal(locOf(g, u), 'base', 'saved and recalled');
  assert.ok(offered, 'the "play this from your trash for [A]" option was offered');
});

test('RJ#13148 the Iron Revenant legend\'s [A] (units/gear only) pays the Power part of Accelerate: Accel(3) (Fury) with only Chaos runes enters ready, a trash card banished', () => {
  let g = S0();
  setLegend(g, P0, 'rad-143-167');
  const a = hand(g, P0, 'Accel(3)');
  setRunes(g, P0, 4, 'chaos');
  const dead = put(g, P0, 'V(1)', 'trash');
  g = drive(act(g, { type: 'playCard', player: P0, obj: a, destination: 'base' }), ['yes']);
  assert.equal(zone(g, a), 'base');
  assert.equal(g.objects[a].exhausted, false, 'Accelerate paid → ready');
  assert.equal(zone(g, dead), 'banishment');
});

test('RJ#13149 Elnuk Herd played from hand can give its own +3 to itself (it is a friendly unit)', () => {
  let g = S0(); fundAll(g, P0, 8);
  const el = hand(g, P0, 'Elnuk Herd');
  const m0 = g.cards[g.objects[el].cardId].might!;
  g = act(g, { type: 'playCard', player: P0, obj: el, destination: 'base' });
  let self = false;
  for (let i = 0; i < 20 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    const o = d.options?.map(x => x.id) ?? [];
    if (o.includes(el)) self = true;
    g = ans(g, o.includes(el) ? [el] : d.kind === 'optional' ? 'yes' : 'first');
  }
  assert.ok(self || g.log.some(l => /Elnuk Herd/.test(l.text)), 'itself choosable (or auto-chosen as the only friendly unit)');
  assert.equal(zone(g, el), 'base');
  assert.equal(mightOf(g, el), m0 + 3);
});

test('RJ#13150 the opponent holds where my Demacian Standard is; I Ambush Rengar, Trophy Hunter in response to the Deploy kill: the Standard dies first, Rengar attacks with no +2 (deals 6)', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  const e = put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const ds = put(g, P0, 'Demacian Standard', BF_A);
  const r = hand(g, P0, 'Rengar, Trophy Hunter');
  g = endTurn(g, P0);
  g = drive(g, [], y => y.chain.some(c => c.source === ds) && y.pending?.kind === 'chainResponse' && y.pending.player === P0 || y.pending?.kind === 'mainAction');
  assert.ok(g.chain.some(c => c.source === ds), 'Deploy kill on the chain');
  assert.ok(canPlayNow(g, P0, r, BF_A));
  g = drive(act(g, { type: 'playCard', player: P0, obj: r, destination: BF_A }), Array(6).fill('first'), y => y.pending?.kind === 'mainAction');
  assert.equal(zone(g, ds), 'trash');
  assert.ok(g.log.some(l => /Combat at BF-A: P0 attacks/.test(l.text)), 'Rengar is the Attacker');
  assert.ok(g.log.some(l => /deals 6 to V\(1\)/.test(l.text)), 'no Standard +2');
  assert.equal(zone(g, e), 'trash');
});

test('RJ#13151 Imperial Decree vs Zhonya\'s Hourglass: lethal damage → Zhonya\'s saves the cleanup death, the pending Decree kill then kills it in base; non-lethal damage → the Decree kill is the death Zhonya\'s replaces (survives)', () => {
  for (const m of [1, 3]) {
    let g = S0(); fundAll(g, P0, 20);
    const u = put(g, P1, `V(${m})`, BF_A); control(g, BF_A, P1);
    const zh = put(g, P1, "Zhonya's Hourglass", 'base');
    g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Imperial Decree') }), [], x => x.pending?.kind === 'mainAction');
    g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Bellows Breath') });
    for (let i = 0; i < 30 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
      const d = g.pending;
      if (!d.inStep) { g = pass(g); continue; }
      const o = d.options?.map(x => x.id) ?? [];
      g = ans(g, o.includes(u) ? [u] : d.kind === 'optional' ? 'no' : 'first');
    }
    assert.equal(zone(g, zh), 'trash', `Zhonya's used (${m})`);
    assert.equal(zone(g, u), m === 1 ? 'trash' : 'base', `V(${m})`);
  }
});

test('RJ#13152 a Bomb token played to Hunters\' Circle by the Hexplosives Expert legend is the first gear played there: a unit played there next pays full cost', { todo: 'RJ#13152: Hunters\' Circle script ignores token plays (!ev.token), so the next unit still gets the [1] discount' }, () => {
  let g = withTokens(S0()); fundAll(g, P0, 6);
  setBattlefieldCard(g, BF_A, "Hunters' Circle");
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const lg = setLegend(g, P0, 'rad-141-167');
  const v = hand(g, P0, 'V(2)');
  g = drive(act(g, { type: 'activate', player: P0, obj: lg, abilityIndex: 0 } as never), [String(BF_A), String(BF_A)]);
  assert.equal(unitsNamed(g, 'Bomb').length + Object.values(g.objects).filter(o => g.cards[o.cardId]?.name === 'Bomb' && o.zone === 'battlefield').length > 0, true, 'Bomb played');
  setRunes(g, P0, 1, 'fury');
  assert.ok(!canPlayNow(g, P0, v, BF_A), 'V(2) costs 2 there now (discount used by the Bomb)');
});

test('RJ#13153 Heimerdinger, Inventor has a Seal\'s [T]: [Reaction] [Add] ability: exhausting him adds power while the Seal stays ready (an extra use)', () => {
  let g = S0();
  const hm = put(g, P0, 'Heimerdinger, Inventor', 'base');
  const s1 = put(g, P0, 'Seal of Discord', 'base');
  const ab = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === hm);
  assert.ok(ab, 'Heimerdinger has the Seal\'s ability');
  const p0 = Object.values(g.players[P0].pool.power).reduce((s, n) => s + (n ?? 0), 0);
  g = act(g, ab!);
  assert.equal(g.objects[hm].exhausted, true);
  assert.equal(g.objects[s1].exhausted, false);
  assert.equal(Object.values(g.players[P0].pool.power).reduce((s, n) => s + (n ?? 0), 0), p0 + 1, '+1 power');
  assert.ok(legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === s1), 'the Seal itself still usable');
});

test('RJ#13154 Chronobreak (X=2) on a Recruit token and a real unit: the token ceases to exist when banished (not played back); the real unit is played back', () => {
  let g = withTokens(S0()); fundAll(g, P0, 6);
  const t = put(g, P0, 'Recruit', BF_A, { token: true }); control(g, BF_A, P0);
  const v = put(g, P0, 'V(2)', BF_A);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Chronobreak') });
  for (let i = 0; i < 30 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    const o = d.options?.map(x => x.id) ?? [];
    g = ans(g, o.includes('2') ? '2' : o.includes(t) ? [t] : o.includes(v) ? [v] : o.includes(String(BF_A)) ? String(BF_A) : 'first');
  }
  assert.notEqual(zone(g, t), 'battlefield');
  assert.equal(unitsNamed(g, 'Recruit').length, 0, 'no Recruit played back');
  assert.equal(zone(g, v), 'battlefield');
});

test('RJ#13159 Bone Skewer choosing Rockfall Path: the chosen unit can\'t be played there → stays in the opponent\'s hand, nothing is stunned', () => {
  let g = S0(); fundAll(g, P0);
  setBattlefieldCard(g, BF_A, 'Rockfall Path');
  const u = hand(g, P1, 'V(2)');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Bone Skewer') });
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    g = ans(g, /battlefield/i.test(d.prompt ?? '') && d.kind === 'chooseTargets' ? /Rockfall/ : d.options!.find(o => o.id === u || o.id === 'yes')?.id ?? d.options![0].id);
  }
  assert.equal(zone(g, u), 'hand');
  assert.ok(!g.objects[u].stunned);
});

test('RJ#13160 Shock Blast\'s "[2] less if you control something Empowered" counts my Empowered legend (Matriarch of War)', () => {
  const g = S0(); fundAll(g, P0);
  const leg = setLegend(g, P0, 'Matriarch of War');
  const s = hand(g, P0, 'Shock Blast');
  const full = playCostOf(g, P0, s)!.energy;
  g.objects[leg].empowered = 1; g.timestamp++;
  assert.equal(playCostOf(g, P0, s)!.energy, full - 2);
});

test('RJ#13161 Hextech Ray on a 1-Might unit: all 3 damage goes to that unit, none spills onto another unit there', () => {
  let g = S0(); fundAll(g, P0);
  const a = put(g, P1, 'V(1)', BF_A), b = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Hextech Ray') });
  g = drive(g, [[a]], x => x.pending?.kind === 'mainAction');
  assert.ok(g.log.some(l => /deals 3 to V\(1\)/.test(l.text)));
  assert.equal(zone(g, a), 'trash');
  assert.equal(g.objects[b].damage, 0);
});

test('RJ#13164 a gear animated by Lady of Clockwork is not exhausted by becoming a unit: it can make a Standard Move that turn', () => {
  let g = S0({ tp: P1 }); setLegend(g, P0, 'Lady of Clockwork');
  const gear = put(g, P0, 'The Ball', 'base');
  g = endTurn(g, P1);
  for (let i = 0; i < 30 && g.pending && !(g.pending.kind === 'mainAction' && g.activePlayer === P0 && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = act(g, { type: 'pass', player: d.player }); continue; }
    const o = d.options!.map(x => x.id);
    g = ans(g, d.kind === 'optional' ? 'yes' : o.includes(gear) ? [gear] : o[0]);
  }
  assert.ok(mightOf(g, gear) > 0, 'animated');
  assert.equal(g.objects[gear].exhausted, false);
  assert.ok(moveDests(g, P0, gear).length > 0 || legal(g, P0).some(a => a.type === 'move' && (a as { units?: string[] }).units?.includes(gear)), 'can move');
});

test('RJ#13165 Temporal Breach on Neeko, Blending In: her legend leaves the Legend Zone at once (duration "while I\'m on the board"), so her replay can choose the same legend again — and it is ready', { todo: 'RJ#13165: Neeko\'s legend removal is a leave-board trigger that resolves after her replayed play trigger, so the same legend isn\'t offered (the other is auto-chosen) and the used one is then removed' }, () => {
  let g = S0(); fundAll(g, P0, 10);
  for (const id of ['ogn-267-298', 'ogn-257-298']) if (!g.cards[id]) g.cards = { ...g.cards, [id]: realCard(id) };
  const l1 = newObject(g, 'ogn-267-298', P0, 'setAside').id, l2 = newObject(g, 'ogn-257-298', P0, 'setAside').id;
  g.ex.extraLegends[P0] = [l1, l2];
  const n = hand(g, P0, 'Neeko, Blending In');
  const u = put(g, P0, 'V(1)', 'base');
  const run = (pick: (o: string[]) => string[]) => { for (let i = 0; i < 30 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) { const d = g.pending; if (!d.inStep) { g = pass(g); continue; } const o = d.options!.map(x => x.id); g = ans(g, pick(o)); } };
  g = act(g, { type: 'playCard', player: P0, obj: n, destination: 'base' });
  run(o => o.includes(l1) ? [l1] : [o[0]]);
  assert.equal(zone(g, l1), 'legendZone');
  g = act(g, legal(g, P0, 'activate').find(a => (a as { obj?: string }).obj === l1)!); run(o => o.includes(u) ? [u] : [o[0]]);
  assert.equal(g.objects[l1].exhausted, true, 'Bounty Hunter used');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Temporal Breach') });
  run(o => o.includes(n) ? [n] : o.includes(l1) ? [l1] : [o[0]]);
  assert.equal(zone(g, n), 'base');
  assert.equal(zone(g, l1), 'legendZone', 'the same legend chosen again');
  assert.equal(g.objects[l1].exhausted, false, 'ready');
  assert.equal(zone(g, l2), 'setAside');
});

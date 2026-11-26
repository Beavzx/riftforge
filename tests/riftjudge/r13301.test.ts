// Rift Judge verification, range r13301 (question ids 13301-13600). Log: docs/riftjudge/r13301.md
import { test } from 'node:test';
import {
  assert, S0, put, hand, control, move, act, P0, P1, BF_A, BF_B, pend, chainLabels, fundAll, canPlayNow, zone,
  attackSetup, expectPending, setBattlefieldCard, locOf, endTurn, hasKeyword, mightOf, legal, play, passN, answer, rejects, addRunes, cast,
} from '../conformance/harness.ts';
import { drive, ans, opt, withTokens, unitsNamed, setLegend, nameOf } from './r11701.helpers.ts';
import { officialBanlist } from '../../src/engine/banlist.ts';
import { validateDeck } from '../../src/engine/deck.ts';
import { db } from '../cards/B8/b8-util.ts';
import { attachNow } from '../../src/engine/testkit.ts';

const banProblems = (cardId: string, format: 'standard' | 'constructed2v2') => {
  const legend = Object.values(db).find(c => c.type === 'Legend')!;
  const deck = { legend: legend.id, champion: 'y', main: [cardId], runes: [], battlefields: [] };
  return validateDeck(deck as never, db, { banlist: officialBanlist(format) }).filter(p => p.code === 'banned');
};

test('RJ#13301 Draven, Vanquisher is banned in 2v2 Constructed (Master Yi, Wuju Bladesman too); Draven, Showboat is legal', () => {
  assert.ok(banProblems('sfd-020-221', 'constructed2v2').length > 0, 'Vanquisher banned in 2v2');
  assert.ok(banProblems('ogs-019-024', 'constructed2v2').length > 0, 'Wuju Bladesman banned in 2v2');
  assert.equal(banProblems('ogs-019-024', 'standard').length, 0, 'Wuju Bladesman legal in Standard');
  assert.equal(banProblems('ogn-028-298', 'constructed2v2').length, 0, 'Draven, Showboat legal');
  void S0; void put; void hand; void control; void move; void act; void P0; void P1; void BF_A; void BF_B; void pend; void chainLabels;
  void fundAll; void canPlayNow; void zone; void attackSetup; void expectPending; void hasKeyword; void mightOf; void legal; void play;
  void passN; void answer; void rejects; void addRunes; void drive; void ans; void opt; void withTokens; void unitsNamed; void setLegend; void nameOf;
});

test("RJ#13302 Siren's Song moves the only attacker away mid-showdown: no combat damage, the defender keeps the battlefield", () => {
  let { g, atk, def } = attackSetup(['V(3)'], ['V(2)']);
  fundAll(g, P1);
  g = drive(g, [], x => x.pending?.kind === 'showdownAction' && x.pending.player === P1);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, "Siren's Song") });
  for (let i = 0; i < 6 && g.pending?.inStep && g.pending.player === P1; i++) g = answer(g, { targets: [[atk[0]]], locations: ['base'] });
  g = drive(g);
  assert.equal(zone(g, atk[0]), 'base', 'attacker moved to base');
  assert.equal(g.objects[atk[0]].damage ?? 0, 0);
  assert.equal(zone(g, def[0]), 'battlefield');
  assert.equal(g.objects[def[0]].damage ?? 0, 0, 'no combat damage');
  assert.equal(g.battlefields[BF_A].controller, P1, 'defender keeps control');
});

test('RJ#13303 Starry-Eyed Songstress reduces the total cost of Bellows Breath including its Repeat cost: no Energy paid, it repeats', () => {
  let g = S0(); fundAll(g, P0);
  setLegend(g, P0, 'Starry-Eyed Songstress');
  const us = [0, 1, 2].map(() => put(g, P0, 'V(1)', 'base'));
  const e = put(g, P1, 'V(5)', BF_B);
  const x0 = g.players[0].runesInPlay.filter(x => g.objects[x].exhausted).length;
  const n0 = g.players[0].runesInPlay.length;
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Bellows Breath') });
  const seen: string[] = [];
  for (let i = 0; i < 12 && g.pending?.inStep && g.pending.player === P0; i++) {
    const d = g.pending!; seen.push(`${d.kind}:${d.prompt}`);
    if (d.kind === 'optional') g = ans(g, 'yes');
    else if (d.kind === 'chooseCards') g = ans(g, us);
    else g = ans(g, [e]);
  }
  g = drive(g);
  assert.equal(g.objects[e].damage, 2, `repeated (${seen.join(' | ')})`);
  assert.equal(g.players[0].runesInPlay.filter(x => g.objects[x].exhausted).length, x0, 'no Energy paid');
  assert.equal(n0 - g.players[0].runesInPlay.length, 2, 'Power (1 + Repeat [C]) still paid');
});

test('RJ#13305 a Bomb\'s Deathknell ("deal 2 to an enemy unit here") can\'t choose Ruin Runner; with another enemy there it hits that one', () => {
  for (const other of [false, true]) {
    let g = withTokens(S0()); fundAll(g, P0, 10);
    const rr = put(g, P1, 'Ruin Runner', BF_A); control(g, BF_A, P1);
    const v = other ? put(g, P1, 'V(5)', BF_A) : undefined;
    g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Amateur Demolitionist'), destination: 'base' }), ['first', String(BF_A), String(BF_A)], x => x.pending?.kind === 'mainAction');
    const bomb = Object.keys(g.objects).find(id => g.cards[g.objects[id].cardId]?.name === 'Bomb' && g.objects[id].zone === 'battlefield')!;
    assert.ok(bomb);
    g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'KillGearM') });
    for (let i = 0; i < 20 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
      const d = g.pending;
      if (!d.inStep) { g = act(g, { type: 'pass', player: d.player }); continue; }
      const o = d.options?.map(x => x.id) ?? [];
      assert.ok(!(/deal 2|Bomb/i.test(d.prompt ?? '') && o.includes(rr)), 'Ruin Runner not choosable');
      g = ans(g, o.includes(bomb) ? [bomb] : v && o.includes(v) ? [v] : d.kind === 'optional' ? 'yes' : 'first');
    }
    assert.notEqual(zone(g, bomb), 'battlefield');
    assert.equal(g.objects[rr].damage ?? 0, 0);
    if (v) assert.equal(g.objects[v].damage, 2);
  }
});

test('RJ#13307 Smoke and Mirrors swaps Lillia (at Abandoned Hall) with a Sprite: the Hall\'s +1 can go only on the swapped-in Sprite, not Lillia nor her new Sprite', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  setBattlefieldCard(g, BF_A, 'Abandoned Hall');
  const l = put(g, P0, 'Lillia, Fae Fawn', BF_A); control(g, BF_A, P0);
  const s1 = put(g, P0, 'Sprite', 'base', { token: true });
  const m0 = mightOf(g, s1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Smoke and Mirrors') });
  g = ans(g, [l]);   // the other unit (Sprite) is the only legal second choice
  const offers: string[][] = [];
  for (let i = 0; i < 20 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = act(g, { type: 'pass', player: d.player }); continue; }
    const o = d.options?.map(x => x.id) ?? [];
    if (/Abandoned Hall|\+1/.test(d.prompt ?? '') && d.kind !== 'optional') offers.push(o);
    g = ans(g, o.includes(s1) ? (d.kind === 'chooseTargets' ? [s1] : s1) : d.kind === 'optional' ? 'yes' : 'first');
  }
  assert.equal(locOf(g, s1), BF_A); assert.equal(locOf(g, l), 'base');
  const newSprites = unitsNamed(g, 'Sprite').filter(id => id !== s1 && locOf(g, id) === BF_A);
  assert.equal(newSprites.length, 1, "Lillia's Sprite at the Hall");
  assert.ok(offers.length > 0 && offers.every(o => !o.includes(l) && !o.includes(newSprites[0])), JSON.stringify(offers));
  assert.equal(mightOf(g, s1), m0 + 1, 'swapped-in Sprite +1');
  assert.equal(mightOf(g, newSprites[0]), 3);
});

test('RJ#13308 hidden Back Off stuns Graves, Blasting Through in response to his attack trigger: the trigger still deals 4 to each enemy unit there', () => {
  let g = S0(); fundAll(g, P1);
  const gr = put(g, P0, 'rad-085-167', 'base');
  const e = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const bo = put(g, P1, 'Back Off', { facedown: BF_A });
  g = move(g, P0, [gr], BF_A);
  g = drive(g, ['first'], x => x.pending?.kind === 'chainResponse' && x.pending.player === P1 && x.chain.some(c => c.source === gr));
  g = act(g, { type: 'playCard', player: P1, obj: bo });
  g = drive(g, [[gr]], x => (x.pending?.kind === 'showdownAction' && x.chain.length === 0) || x.pending?.kind === 'assignDamage');
  assert.equal(g.objects[gr].stunned, true, 'Graves stunned');
  assert.equal(mightOf(g, gr), 4, 'stun does not change Might');
  assert.equal(g.objects[e].damage, 4, 'trigger dealt his Might');
});

test('RJ#13310 hidden Temporal Breach on Brynhir Thundersong in response to Frozen Fortress\'s trigger: replayed there, she still takes 1 (untargeted) and her play trigger fires again', () => {
  let g = S0(); fundAll(g, P1);
  setBattlefieldCard(g, BF_A, 'Frozen Fortress');
  const b = put(g, P1, 'Brynhir Thundersong', BF_A); control(g, BF_A, P1);
  const tb = put(g, P1, 'Temporal Breach', { facedown: BF_A });
  g = endTurn(g, P0);
  g = drive(g, [], y => y.chain.some(c => /Frozen Fortress/.test(String(c.label))) && y.pending?.kind === 'chainResponse' && y.pending.player === P1 || y.pending?.kind === 'mainAction');
  assert.ok(g.chain.length > 0, 'Fortress trigger on the chain');
  g = act(g, { type: 'playCard', player: P1, obj: tb });
  g = drive(g, [[b]], y => y.chain.length === 0 && !y.pending?.inStep);
  const nb = unitsNamed(g, 'Brynhir Thundersong')[0];
  assert.ok(nb, 'Brynhir on the board');
  assert.equal(locOf(g, nb), BF_A, 'replayed at the Fortress');
  assert.equal(g.objects[nb].damage, 1, 'Fortress damage hits the replayed Brynhir');
  assert.ok(g.log.some(l => /Resolving Brynhir/.test(l.text)), 'play trigger fired again');
});

test('RJ#13313 Ezreal, Prodigy does not reduce the [A] cost of hiding a card (hiding is not playing)', () => {
  let g = S0(); fundAll(g, P0, 10);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  put(g, P0, 'Ezreal, Prodigy', 'base');
  const hid = put(g, P0, 'HidU(2)', 'hand');
  const runes = g.players[P0].runesInPlay.length;
  g = drive(act(g, { type: 'hide', player: P0, obj: hid, battlefieldIndex: BF_A } as never));
  assert.equal(zone(g, hid), 'facedown');
  assert.equal(g.players[P0].runesInPlay.length, runes - 1, 'the hide cost [A] was paid in full');
});

test('RJ#13314 combat showdown: I play an Action, it resolves, the opponent passes focus → I still get a focus window before damage (both must pass in succession)', () => {
  let { g, def } = attackSetup(['V(3)'], ['V(3)']);
  fundAll(g, P0);
  expectPending(g, 'showdownAction', P0);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Guttural Roar') }), ['first'], x => x.pending?.kind === 'showdownAction');
  expectPending(g, 'showdownAction', P1);
  g = act(g, { type: 'pass', player: P1 });
  expectPending(g, 'showdownAction', P0, 'the first player still has focus');
  assert.equal(g.objects[def[0]].damage ?? 0, 0, 'no damage yet');
});

test("RJ#13316 Kha'Zix, Mutating Horror defends against two attackers (no +2); hidden Bedeviling Stranger then bounces one: the condition isn't rechecked, still 4 Might", () => {
  let g = S0(); fundAll(g, P1);
  const k = put(g, P1, "Kha'Zix, Mutating Horror", BF_A); control(g, BF_A, P1);
  const st = put(g, P1, 'Bedeviling Stranger', { facedown: BF_A });
  const a1 = put(g, P0, 'V(2)', 'base'), a2 = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [a1, a2], BF_A);
  g = drive(g, ['first', 'first'], x => x.pending?.kind === 'showdownAction' && x.chain.length === 0);
  assert.equal(mightOf(g, k), 4, 'no +2: two enemy units');
  if (g.pending?.player === P0) g = act(g, { type: 'pass', player: P0 });
  expectPending(g, 'showdownAction', P1);
  g = act(g, { type: 'playCard', player: P1, obj: st });
  for (let i = 0; i < 10 && g.pending?.inStep && g.pending.player === P1; i++) {
    const d = g.pending!; const o = d.options!.map(x => x.id);
    g = ans(g, o.includes(a1) ? (d.kind === 'chooseTargets' ? [a1] : a1) : o.includes(String(BF_A)) ? String(BF_A) : d.kind === 'optional' ? 'yes' : 'first');
  }
  g = drive(g, [], x => x.chain.length === 0 && x.pending?.kind === 'showdownAction');
  assert.equal(zone(g, a1), 'hand', 'one attacker returned to hand');
  assert.equal(locOf(g, a2), BF_A);
  assert.equal(mightOf(g, k), 4, 'Kha\'Zix still 4');
});

test('RJ#13317 Fizz, Trickster replays Bellows Breath with Ezreal, Prodigy out: base = its Power only; Repeat [1][C] reduced by one ([1] or [A]) to a single resource', () => {
  let g = S0(); fundAll(g, P0, 10);
  const e = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  put(g, P0, 'Ezreal, Prodigy', 'base');
  const bb = put(g, P0, 'Bellows Breath', 'trash');
  const n = g.log.length;
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Fizz, Trickster'), destination: 'base' } as never);
  let repeatPrompt = '';
  for (let i = 0; i < 40 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending; if (!d.inStep) { g = act(g, { type: 'pass', player: d.player }); continue; }
    if (d.kind === 'optional' && /Repeat/.test(d.prompt ?? '')) repeatPrompt = d.prompt ?? '';
    const o = d.options!.map(x => x.id);
    g = ans(g, d.kind === 'optional' ? 'yes' : o.includes(bb) ? [bb] : [e]);
  }
  const pays = g.log.slice(n).filter(l => /^P0 pays/.test(l.text)).map(l => l.text);
  assert.match(repeatPrompt, /Pay (\[?1\]?|[A-Z]) to Repeat/, `Repeat reduced to one resource (${repeatPrompt})`);
  assert.equal(pays.length, 2, JSON.stringify(pays));
  assert.equal(pays[1].replace('P0 pays ', '').split(' ').length, 2, `Bellows: its Power + one Repeat resource (${pays[1]})`);
  assert.equal(g.objects[e].damage, 2, 'repeated');
  assert.notEqual(zone(g, bb), 'trash', 'recycled');
});

test('RJ#13319 my lone Temporary Sprite holding a battlefield with Long Sword attached dies at my Beginning Phase: gear recalled, control lost before scoring; Lady of Clockwork only triggers at the Main Phase', () => {
  let g = withTokens(S0({ tp: P1 }));
  setLegend(g, P0, 'Lady of Clockwork');
  const sp = put(g, P0, 'Sprite', BF_A, { token: true }); control(g, BF_A, P0);
  const ls = put(g, P0, 'Long Sword', 'base'); attachNow(g, ls, sp);
  const pts = g.players[0].points;
  g = endTurn(g, P1);
  g = drive(g, ['no'], x => x.pending?.kind === 'mainAction' || (x.pending?.kind === 'optional' && /Lady of Clockwork|gear/i.test(x.pending.prompt ?? '')));
  assert.notEqual(zone(g, sp), 'battlefield', 'Sprite died (Temporary)');
  assert.equal(locOf(g, ls), 'base', 'gear recalled');
  assert.notEqual(g.battlefields[BF_A].controller, P0, 'control lost');
  assert.equal(g.players[0].points, pts, 'no hold point');
});

test('RJ#13322 Riven, Deserter readies Irelia, Fervent and exhausts her for the cost: Irelia +1 (chosen) +1 (readied) = 6, Riven +1 = 6, Irelia ends ready', () => {
  let g = S0();
  const rv = put(g, P0, 'Riven, Deserter', 'base');
  const ir = put(g, P0, 'Irelia, Fervent', 'base');
  const ab = legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === rv);
  assert.ok(ab, 'Riven ability available');
  g = act(g, ab!);
  for (let i = 0; i < 40 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending; if (!d.inStep) { g = act(g, { type: 'pass', player: d.player }); continue; }
    const o = d.options!.map(x => x.id);
    g = ans(g, o.includes(ir) ? (d.kind === 'chooseTargets' || d.kind === 'chooseCards' ? [ir] : ir) : d.kind === 'optional' ? 'yes' : 'first');
  }
  assert.equal(mightOf(g, ir), 6, 'two separate Irelia triggers');
  assert.equal(mightOf(g, rv), 6, 'Riven +1 from Irelia becoming exhausted');
  assert.equal(g.objects[ir].exhausted, false, 'readied');
});

test('RJ#13324 Sacrifice killing Clocktower Guardian with Altar of Memories out: I order the two death triggers (Altar first), both resolve above the pending Sacrifice; the Deathknell banishes the card Altar put on top', () => {
  let g = S0(); fundAll(g, P0, 10);
  const cg = put(g, P0, 'Clocktower Guardian', 'base');
  put(g, P0, 'Altar of Memories', 'base');
  const top = put(g, P0, 'V(1)', 'deckTop');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Sacrifice') });
  let ordered = false;
  for (let i = 0; i < 40 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending; if (!d.inStep) { g = act(g, { type: 'pass', player: d.player }); continue; }
    const o = d.options!.map(x => x.id);
    if (d.kind === 'orderTriggers') { ordered = true; g = ans(g, d.options!.find(x => /Clocktower/.test(x.label))!.id); continue; }   // Deathknell first on the chain → resolves last
    g = ans(g, d.kind === 'optional' ? 'yes' : o.includes(cg) ? [cg] : o.includes('top') ? 'top' : 'first');
  }
  assert.ok(ordered, 'controller orders the simultaneous triggers');
  const L = g.log.map(l => l.text);
  const iAltar = L.findIndex(t => /^Resolving Altar/.test(t)), iDk = L.findIndex(t => /^Resolving Clocktower/.test(t)), iSac = L.findIndex(t => /^Resolving Sacrifice/.test(t));
  assert.ok(iAltar >= 0 && iAltar < iDk && iDk < iSac, JSON.stringify([iAltar, iDk, iSac]));
  assert.equal(locOf(g, top), 'base', 'the card put on top by Altar was banished and played by the Deathknell');
});

test('RJ#13325 Cloth Armor animated by Lady of Clockwork: it can\'t be equipped to a unit (units can\'t be attached), but other Equipment can be attached to it', () => {
  let g = S0({ tp: P1 }); setLegend(g, P0, 'Lady of Clockwork');
  const ca = put(g, P0, 'Cloth Armor', 'base');
  const u = put(g, P0, 'V(2)', 'base');
  const ls = put(g, P0, 'Long Sword', 'base');
  g = endTurn(g, P1);
  for (let i = 0; i < 30 && g.pending && !(g.pending.kind === 'mainAction' && g.activePlayer === P0 && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = act(g, { type: 'pass', player: d.player }); continue; }
    const o = d.options!.map(x => x.id);
    g = ans(g, d.kind === 'optional' ? 'yes' : o.includes(ca) ? [ca] : o[0]);
  }
  assert.equal(mightOf(g, ca), 1, 'unit gear, Might = Energy cost');
  fundAll(g, P0);
  const eqCa = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === ca);
  if (eqCa) {
    const g2 = drive(act(g, eqCa), [[u], [u]], x => x.pending?.kind === 'mainAction');
    assert.notEqual(g2.objects[ca].attachedTo, u, 'animated Cloth Armor not attached');
  }
  const eqLs = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === ls);
  assert.ok(eqLs, 'Long Sword Equip available');
  g = drive(act(g, eqLs!), [[ca], [ca]], x => x.pending?.kind === 'mainAction');
  assert.equal(g.objects[ls].attachedTo, ca, 'Long Sword attached to the animated Cloth Armor');
  assert.equal(hasKeyword(g, ca, 'Shield'), false, 'no Shield 2 while animated');
});

test('RJ#13326 Rogue Assassin (Akali legend) can\'t save my defender on the opponent\'s turn ("If it\'s your turn"): the unit stays at the battlefield', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 8);
  setLegend(g, P0, 'Rogue Assassin');
  const d0 = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const a = put(g, P1, 'V(3)', 'base');
  g = move(g, P1, [a], BF_A);
  g = drive(g, [], x => x.pending?.kind === 'showdownAction' && x.pending.player === P0 && x.chain.length === 0);
  expectPending(g, 'showdownAction', P0);
  const leg = g.players[P0].legend as string;
  const ab = legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === leg);
  if (ab) {
    g = act(g, ab);
    for (let i = 0; i < 8 && g.pending?.inStep && g.pending.player === P0; i++) g = ans(g, [d0]);
    g = drive(g, [], x => x.chain.length === 0 && x.pending?.kind === 'showdownAction');
  }
  assert.equal(locOf(g, d0), BF_A, 'not moved to base');
});

test('RJ#13327 Noxus Saboteur moves onto the opponent\'s battlefield with only their hidden card: it can\'t be played there; I conquer and the card is trashed (face up)', () => {
  let g = S0(); fundAll(g, P1);
  control(g, BF_A, P1);
  const fd = put(g, P1, 'Back Off', { facedown: BF_A });
  const s = put(g, P0, 'Noxus Saboteur', 'base');
  g = move(g, P0, [s], BF_A);
  for (let i = 0; i < 30 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    if (d.player === P1 && !d.inStep) assert.equal(canPlayNow(g, P1, fd), false, 'hidden card locked out');
    g = d.inStep ? ans(g, d.kind === 'optional' ? 'yes' : 'first') : act(g, { type: 'pass', player: d.player });
  }
  assert.equal(g.battlefields[BF_A].controller, P0, 'conquered');
  assert.equal(zone(g, fd), 'trash');
  assert.ok(!g.objects[fd].faceDown, 'revealed as it leaves');
});

test('RJ#13328 Dancing Grenade replayed for [A] never leaves the chain during the loop (same object, damage count accumulates); it reaches the trash only when the loop stops', () => {
  let g = S0(); fundAll(g, P0, 6); fundAll(g, P1, 6);
  const f = put(g, P0, 'V(9)', 'base'), e = put(g, P1, 'V(9)', 'base');
  const gr = hand(g, P0, 'Dancing Grenade');
  g = act(g, { type: 'playCard', player: P0, obj: gr });
  let replays = 0; const zones = new Set<string>();
  for (let i = 0; i < 60 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    if (replays > 0 && replays < 2) zones.add(zone(g, gr));
    if (d.kind === 'optional') { const go = replays < 2; if (go) replays++; g = ans(g, go ? 'yes' : 'no'); continue; }
    if (d.inStep) { const o = d.options!.map(x => x.id); const want = d.player === P1 ? f : e; g = ans(g, o.includes(want) ? [want] : 'first'); continue; }
    g = act(g, { type: 'pass', player: d.player });
  }
  assert.equal(replays, 2);
  assert.ok(g.objects[gr], 'same object id throughout');
  assert.ok(!zones.has('trash') && !zones.has('gone'), `during the loop: ${[...zones]}`);
  assert.equal(g.objects[e].damage, 2 + 4); assert.equal(g.objects[f].damage, 3);
  assert.equal(zone(g, gr), 'trash', 'trashed when the loop stops');
});

test('RJ#13328 guard: a spell whose own resolution puts a reflexive item on the chain (Disintegrate\'s "do this: draw 1") still goes to the trash', () => {
  let g = S0(); fundAll(g, P0, 6);
  const e = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const h = g.players[P0].hand.length;
  let d: string;
  [g, d] = cast(g, P0, 'Disintegrate', { targets: [[e]] });
  g = drive(g);
  assert.equal(zone(g, e), 'trash', 'killed');
  assert.equal(g.players[P0].hand.length, h + 1, 'drew 1 from the reflexive item');
  assert.equal(zone(g, d), 'trash', 'Disintegrate left the chain to the trash');
});

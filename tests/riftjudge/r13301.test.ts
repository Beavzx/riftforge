// Rift Judge verification, range r13301 (question ids 13301-13600). Log: docs/riftjudge/r13301.md
import { test } from 'node:test';
import {
  assert, S0, put, hand, control, move, act, P0, P1, BF_A, BF_B, pend, chainLabels, fundAll, canPlayNow, zone,
  attackSetup, expectPending, setBattlefieldCard, locOf, endTurn, nextTurn, hasKeyword, mightOf, legal, play, passN, answer, rejects, addRunes, setRunes,
} from '../conformance/harness.ts';
import { drive, ans, opt, withTokens, unitsNamed, setLegend, nameOf } from './r11701.helpers.ts';
import { officialBanlist } from '../../src/engine/banlist.ts';
import { validateDeck } from '../../src/engine/deck.ts';
import { db } from '../cards/B8/b8-util.ts';
import { attachNow, playCostOf } from '../../src/engine/testkit.ts';

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
    // DECISIONS #13375: both reductions are affordable here, so the payer is asked which one ("Which cost reduction?")
    g = ans(g, d.kind === 'optional' ? 'yes' : o.includes(bb) ? [bb] : d.kind === 'chooseMode' ? 'first' : [e]);
  }
  const pays = g.log.slice(n).filter(l => /^P0 pays/.test(l.text)).map(l => l.text);
  assert.match(repeatPrompt, /Pay (\[?1\]?|[A-Z]) or (\[?1\]?|[A-Z]) to Repeat/, `Repeat reduced to one resource, either one (${repeatPrompt})`);
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

// RJ#13328 (AMBIGUOUS, RJ adopted pending adjudication): RJ quotes a card clarification "the spell goes from resolving back to pending on the
// chain, so it never leaves the chain while the loop continues"; RJ#11581 (r10401) said it replays from the trash. Not in the UNL FAQ.
test('RJ#13328 (AMBIGUOUS, RJ adopted) Dancing Grenade replayed for [A] never leaves the chain during the loop (same object, damage count accumulates); it reaches the trash only when the loop stops', () => {
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

// CR 808.1.d: the Deathknell trigger is the permanent being killed (and sent to the trash); 808.1.d.1: "If the Permanent with the effect
// is not sent to the Trash" the triggered ability is removed from the chain (riftlens /rules/deathknell/).
test('RJ#13329 Endless Riches out: Void Seeker kills my lone Lonely Poro → it is banished instead of trashed, so its Deathknell (draw 1) is removed', () => {
  let g = S0(); fundAll(g, P0, 8);
  put(g, P0, 'Endless Riches', 'base');
  const p = put(g, P0, 'Lonely Poro', BF_A); control(g, BF_A, P0);
  for (let i = 0; i < 4; i++) put(g, P0, 'V(1)', 'deckTop');
  const vs = hand(g, P0, 'Void Seeker');
  const h0 = g.players[0].hand.length;
  g = drive(act(g, { type: 'playCard', player: P0, obj: vs }), [[p]]);
  assert.equal(zone(g, p), 'banishment');
  assert.equal(g.players[0].hand.length - h0, 0, 'Void Seeker left the hand (-1), only its own draw (+1)');
  assert.ok(!g.log.some(l => /Resolving Lonely Poro/.test(l.text)), 'no Deathknell');
});

test('RJ#13330 Exemplar of Demacia\'s "move a friendly unit to that battlefield" still moves it after the opponent\'s Ravenbloom Prefect banishes the Portable Portal', () => {
  let g = S0(); fundAll(g, P0, 8); addRunes(g, P0, 3, 'body');
  setLegend(g, P0, 'rad-155-167');
  const u = put(g, P0, 'V(2)', 'base');
  put(g, P1, 'Ravenbloom Prefect', 'base');
  const pp = hand(g, P0, 'Portable Portal');
  g = act(g, { type: 'playCard', player: P0, obj: pp, destination: BF_A });
  for (let i = 0; i < 40 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = act(g, { type: 'pass', player: d.player }); continue; }
    const o = d.options?.map(x => x.id) ?? [];
    g = ans(g, o.includes(u) ? [u] : o.includes(String(BF_A)) ? String(BF_A) : d.kind === 'optional' ? 'yes' : 'first');
  }
  assert.equal(zone(g, pp), 'banishment', 'Portal banished by the Prefect');
  assert.equal(locOf(g, u), BF_A, 'Exemplar still moved the unit to that battlefield');
});

// RJ#13331 (AMBIGUOUS, RJ adopted): the destination was chosen at play (CR 355.4); the opponent's move uses that destination, not information
// from the now-illegal unit target, so it is not Ignored (CR 359.3.e.14 read by RJ; no card FAQ).
test('RJ#13331 (AMBIGUOUS, RJ adopted) Call to Battle: I Gust my chosen unit in response — the opponent still moves a unit to the battlefield', () => {
  let g = S0(); fundAll(g, P0);
  control(g, BF_A, P0); put(g, P0, 'V(1)', BF_A);
  const u = put(g, P0, 'V(2)', BF_B);   // Gust needs a unit at a battlefield
  const e = put(g, P1, 'V(3)', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Call to Battle') });
  for (let i = 0; i < 6 && g.pending?.inStep && g.pending.player === P0; i++) {
    const o = g.pending.options!.map(x => x.id);
    g = ans(g, o.includes(u) ? [u] : o.includes(String(BF_A)) ? String(BF_A) : 'first');
  }
  expectPending(g, 'chainResponse', P0);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Gust') });
  g = drive(g, [[u], [e], String(BF_A)]);
  assert.equal(zone(g, u), 'hand', 'Gusted');
  assert.equal(locOf(g, e), BF_A, 'opponent still moved a unit there');
});

test('RJ#13332 Defy (≤[4], ≤[A]) counters Cull the Weak (2 + [C]): no unit is killed', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const a = put(g, P0, 'V(2)', 'base'), b = put(g, P1, 'V(2)', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Cull the Weak') });
  g = drive(g, [], x => x.pending?.kind === 'chainResponse' && x.pending.player === P1);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Defy') });
  g = drive(g, ['first', [a], [b]]);
  assert.equal(zone(g, a), 'base'); assert.equal(zone(g, b), 'base');
  assert.ok(g.log.some(l => /counter/i.test(l.text)), 'countered');
});

test('RJ#13333 Diana, Lunari defending at Ravenbloom Conservatory: Diana\'s showdown-start trigger is placed first, the Conservatory\'s defend trigger above it (resolves first)', () => {
  let g = S0(); fundAll(g, P1);
  setBattlefieldCard(g, BF_A, 'Ravenbloom Conservatory');
  put(g, P1, 'Diana, Lunari', BF_A); control(g, BF_A, P1);
  for (let i = 0; i < 3; i++) put(g, P1, 'V(1)', 'deckTop');
  const a = put(g, P0, 'V(3)', 'base');
  g = move(g, P0, [a], BF_A);
  let seen: string[] = [];
  for (let i = 0; i < 20 && g.pending && g.chain.length < 2; i++) {
    const d = g.pending;
    g = d.inStep ? ans(g, d.kind === 'optional' ? 'yes' : 'first') : act(g, { type: 'pass', player: d.player });
    seen = chainLabels(g);
  }
  assert.deepEqual(seen.map(s => s.replace(/^trigger:/, '')).map(s => /Diana/.test(s) ? 'Diana' : /Conservatory/.test(s) ? 'Conservatory' : s), ['Diana', 'Conservatory'], JSON.stringify(seen));
});

test('RJ#13334 a unit killed as a spell\'s additional cost (Sacrifice) counts as killing with a spell: Immortal Phoenix in my trash triggers', () => {
  let g = S0(); fundAll(g, P0, 10);
  const ph = put(g, P0, 'Immortal Phoenix', 'trash');
  const m = put(g, P0, 'V(5)', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Sacrifice') });
  let offered = false;
  for (let i = 0; i < 30 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = act(g, { type: 'pass', player: d.player }); continue; }
    if (d.kind === 'optional' && /Phoenix/.test(d.prompt ?? '')) offered = true;
    const o = d.options!.map(x => x.id);
    g = ans(g, d.kind === 'optional' ? 'yes' : o.includes(m) ? [m] : o.includes('base') ? 'base' : 'first');
  }
  assert.equal(zone(g, m), 'trash');
  assert.ok(offered || g.log.some(l => /Trigger: Immortal Phoenix/.test(l.text)), 'Phoenix triggered');
  assert.equal(locOf(g, ph), 'base', 'played from the trash');
});

test('RJ#13335 Draven, Audacious attacks; the defender Flashes its only unit to base in the showdown: Draven wins the combat (+1) and conquers (+1)', () => {
  let { g, def } = attackSetup(['sfd-148-221'], ['V(2)']);
  fundAll(g, P1);
  const p0 = g.players[0].points;
  g = drive(g, [], x => x.pending?.kind === 'showdownAction' && x.pending.player === P1);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Flash') });
  g = drive(g, [[def[0]]]);
  assert.equal(zone(g, def[0]), 'base', 'flashed out');
  assert.equal(g.battlefields[BF_A].controller, P0, 'conquered');
  assert.equal(g.players[0].points - p0, 2, 'Draven win point + conquer point');
});

test('RJ#13336 Bedeviling Stranger\'s "4 or more units there" is checked on resolution: the opponent Flashes another unit away in response (4 → 3) and the bounce doesn\'t happen', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  put(g, P0, 'V(4)', BF_A); control(g, BF_A, P0);
  const st = put(g, P0, 'Bedeviling Stranger', { facedown: BF_A });
  const a1 = put(g, P1, 'V(2)', 'base'), a2 = put(g, P1, 'V(2)', 'base');
  g = move(g, P1, [a1, a2], BF_A);
  let played = false, flashed = false;
  for (let i = 0; i < 40 && g.pending && g.pending.kind !== 'assignDamage' && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const p = g.pending;
    if (!p.inStep) {
      if (!played && p.player === P0 && p.kind === 'showdownAction') { played = true; g = act(g, { type: 'playCard', player: P0, obj: st }); continue; }
      if (played && !flashed && p.player === P1 && p.kind === 'chainResponse') { flashed = true; g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Flash') }); continue; }
      if (flashed && g.chain.length === 0) break;
      g = act(g, { type: 'pass', player: p.player }); continue;
    }
    const o = p.options!.map(x => x.id);
    g = ans(g, p.player === P1 ? [o.includes(a2) ? a2 : o[0]] : o.includes(a1) ? [a1] : p.kind === 'optional' ? 'yes' : 'first');
  }
  assert.ok(played && flashed);
  assert.equal(zone(g, a2), 'base', 'flashed away');
  assert.equal(locOf(g, a1), BF_A, 'the chosen unit is not returned (only 3 units on resolution)');
});

test('RJ#13337 Blood Money on an enemy 2-Might unit; the opponent responds with Discipline (+2): illegal target on resolution → no kill, no Gold', () => {
  let g = withTokens(S0()); fundAll(g, P0); fundAll(g, P1);
  const e = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Blood Money') });
  g = drive(g, [[e]], x => x.pending?.kind === 'chainResponse' && x.pending.player === P1);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Discipline') });
  g = drive(g, [[e]]);
  assert.equal(zone(g, e), 'battlefield', 'not killed');
  assert.equal(unitsNamed(g, 'Gold').length + Object.values(g.objects).filter(o => g.cards[o.cardId]?.name === 'Gold' && ['base', 'battlefield'].includes(o.zone)).length, 0, 'no Gold');
});

test('RJ#13339 Last Caress then Sett, Brawler: two buff triggers but a unit holds one buff (5 Might); the spend ability can\'t be used while the triggers are on the chain', () => {
  let g = S0(); fundAll(g, P0, 12);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Last Caress') }));
  const s = hand(g, P0, 'Sett, Brawler');
  g = act(g, { type: 'playCard', player: P0, obj: s, destination: 'base' } as never);
  let midChainSpend = false;
  for (let i = 0; i < 30 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    if (g.chain.length > 0 && d.player === P0 && legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === s)) midChainSpend = true;
    g = d.inStep ? ans(g, d.kind === 'optional' ? 'yes' : 'first') : act(g, { type: 'pass', player: d.player });
  }
  assert.equal(locOf(g, s), 'base');
  assert.equal(g.objects[s].counters?.buff ?? 0, 1, 'one buff');
  assert.equal(mightOf(g, s), 5);
  assert.equal(midChainSpend, false, 'no spend while the chain exists');
  assert.ok(g.log.filter(l => /^Resolving (Last Caress|Sett)/.test(l.text)).length >= 2, 'both buff triggers resolved');
});

test('RJ#13340 attacking an enemy battlefield doesn\'t give me control: Resonating Strike can\'t move another unit there (only to a battlefield I control)', () => {
  let { g } = attackSetup(['V(3)'], ['V(3)']);
  fundAll(g, P0);
  control(g, BF_B, P0); put(g, P0, 'V(1)', BF_B);
  const other = put(g, P0, 'V(2)', 'base');
  expectPending(g, 'showdownAction', P0);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Resonating Strike') });
  const offered: string[] = [];
  for (let i = 0; i < 6 && g.pending?.inStep && g.pending.player === P0; i++) {
    const o = g.pending.options!.map(x => x.id); offered.push(...o);
    g = ans(g, o.includes(other) ? [other] : 'first');
  }
  assert.ok(!offered.includes(String(BF_A)), `BF-A not a destination (${offered})`);
  g = drive(g, [], x => x.chain.length === 0 && x.pending?.kind === 'showdownAction');
  assert.notEqual(locOf(g, other), BF_A);
});

test('RJ#13341 Illaoi, Prophet of the Great Kraken holds Reckoner\'s Arena: her "when I score" triggers for the hold and again via the Arena\'s activated conquer effects → two Tentacles', () => {
  let g = withTokens(S0({ tp: P1 }));
  setBattlefieldCard(g, BF_A, "Reckoner's Arena");
  const il = put(g, P0, 'Illaoi, Prophet of the Great Kraken', BF_A); control(g, BF_A, P0);
  g = endTurn(g, P1);
  g = drive(g, ['first', 'first', 'first', 'first'], x => x.pending?.kind === 'mainAction' && x.activePlayer === P0);
  const t = unitsNamed(g, 'Tentacle');
  assert.equal(t.length, 2, `two Tentacles (${g.log.filter(l => /Illaoi|Tentacle|Arena/.test(l.text)).map(l => l.text).join(' | ')})`);
  assert.equal(mightOf(g, il), 6);
});

test('RJ#13344 Kennen, Keeper of Balance attacks: in response to his stun trigger my hidden Windsinger bounces him (still 2 Might); the stun still resolves on its chosen target', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const u1 = put(g, P0, 'V(2)', BF_A); put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const ws = put(g, P0, 'Windsinger', { facedown: BF_A });
  const k = put(g, P1, 'Kennen, Keeper of Balance', 'base');
  g = move(g, P1, [k], BF_A);
  let played = false;
  for (let i = 0; i < 40 && g.pending && g.pending.kind !== 'assignDamage' && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const p = g.pending;
    if (!p.inStep) {
      if (!played && p.player === P0 && p.kind === 'chainResponse' && g.chain.some(c => c.source === k)) { played = true; assert.equal(mightOf(g, k), 2); g = act(g, { type: 'playCard', player: P0, obj: ws }); continue; }
      if (played && g.chain.length === 0) break;
      g = act(g, { type: 'pass', player: p.player }); continue;
    }
    const o = p.options!.map(x => x.id);
    g = ans(g, p.player === P1 ? (p.kind === 'optional' ? 'yes' : o.includes(u1) ? [u1] : 'first') : p.kind === 'optional' ? 'yes' : o.includes(k) ? [k] : 'first');
  }
  assert.ok(played, 'response window before the stun resolves');
  assert.equal(zone(g, k), 'hand', 'Kennen bounced');
  assert.equal(g.objects[u1].stunned, true, 'stun still resolved');
});

test('RJ#13347 Riven, Deserter\'s +1 has no per-turn cap: each other friendly unit becoming exhausted (two standard moves) gives +1; her own exhaustion doesn\'t', () => {
  let g = S0();
  const rv = put(g, P0, 'Riven, Deserter', 'base');
  const a = put(g, P0, 'V(1)', 'base'), b = put(g, P0, 'V(1)', 'base');
  g = drive(move(g, P0, [a], BF_A), ['first', 'first']);
  g = drive(move(g, P0, [b], BF_B), ['first', 'first']);
  assert.equal(mightOf(g, rv), 7, '5 + 1 + 1');
  g = drive(move(g, P0, [rv], BF_A), ['first', 'first']);
  assert.equal(mightOf(g, rv), 7, 'her own exhaustion: no bonus');
});

test('RJ#13348 Temporal Breach (my first card this turn) replays Trifarian Gloryseeker: the Breach was finalized first, so its Legion play trigger fires (buffed)', () => {
  let g = S0(); fundAll(g, P0, 10);
  const tg = put(g, P0, 'Trifarian Gloryseeker', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Temporal Breach') });
  g = drive(g, [[tg], 'yes', 'first']);
  const nu = unitsNamed(g, 'Trifarian Gloryseeker')[0];
  assert.ok(nu, 'replayed');
  assert.equal(g.objects[nu].counters?.buff ?? 0, 1, 'Legion active → buffed');
});

test('RJ#13349 Temporal Breach on Ekko, Ingenious with no other friendly unit: his mandatory additional cost can\'t be paid → he stays banished', () => {
  let g = S0(); fundAll(g, P0);
  const ek = put(g, P0, 'rad-061-167', BF_A); control(g, BF_A, P0);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Temporal Breach') });
  for (let i = 0; i < 30 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = act(g, { type: 'pass', player: d.player }); continue; }
    const o = d.options?.map(x => x.id) ?? [];
    g = ans(g, o.includes(ek) ? [ek] : d.kind === 'optional' ? 'yes' : 'first');
  }
  const onBoard = Object.values(g.objects).filter(o => o.cardId === 'rad-061-167' && ['base', 'battlefield'].includes(o.zone));
  assert.equal(onBoard.length, 0, 'not replayed');
  assert.ok(Object.values(g.objects).some(o => o.cardId === 'rad-061-167' && o.zone === 'banishment'), 'stays banished');
});

test('RJ#13352 The Ruination vs Ferrous Forerunner + Karthus, Eternal + Mordekaiser, Twice Slain: decline → 4 Mechs; sacrifice Forerunner → Mordekaiser + 4 Mechs; sacrifice Karthus → Mordekaiser + 2 Mechs', () => {
  const run = (pick: 'no' | 'Ferrous' | 'Karthus') => {
    let g = withTokens(S0()); fundAll(g, P0, 12);
    put(g, P0, 'Ferrous Forerunner', 'base'); put(g, P0, 'Karthus, Eternal', 'base');
    const mo = put(g, P0, 'Mordekaiser, Twice Slain', 'base');
    g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'The Ruination') });
    for (let i = 0; i < 40 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
      const d = g.pending; if (!d.inStep) { g = act(g, { type: 'pass', player: d.player }); continue; }
      if (d.kind === 'optional') { g = ans(g, pick === 'no' ? 'no' : 'yes'); continue; }
      const f = d.options!.find(x => x.label.startsWith(pick));
      g = ans(g, f ? [f.id] : 'first');
    }
    return { mord: locOf(g, mo), mechs: unitsNamed(g, 'Mech').length };
  };
  assert.deepEqual(run('no'), { mord: null, mechs: 4 });
  assert.deepEqual(run('Ferrous'), { mord: 'base', mechs: 4 });
  assert.deepEqual(run('Karthus'), { mord: 'base', mechs: 2 });
});

test('RJ#13359 Vex, Apathetic stuns a Ruin Runner played by the opponent (her trigger refers to the played unit, it doesn\'t choose it)', () => {
  let g = S0(); fundAll(g, P0, 8);
  put(g, P1, 'Vex, Apathetic', BF_B); control(g, BF_B, P1);
  const rr = hand(g, P0, 'Ruin Runner');
  g = drive(act(g, { type: 'playCard', player: P0, obj: rr, destination: 'base' }), [], x => x.pending?.kind === 'mainAction');
  assert.equal(locOf(g, rr), 'base');
  assert.equal(g.objects[rr].stunned, true, 'Ruin Runner stunned');
});

test('RJ#13361 Falling Star (both instances on one unit) vs Guardian Angel: one death event, replaced — the Angel dies, the unit is healed and recalled', () => {
  let g = S0(); fundAll(g, P0, 8);
  const u = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const ga = put(g, P1, 'Guardian Angel', 'base'); attachNow(g, ga, u);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Falling Star') });
  g = drive(g, [[u], [u], 'yes', 'yes']);
  assert.equal(zone(g, ga), 'trash', 'Guardian Angel killed instead');
  assert.equal(locOf(g, u), 'base', 'unit recalled');
  assert.equal(g.objects[u].damage ?? 0, 0, 'healed');
});

test('RJ#13365 Dame the Despoiler empowered by a hidden Tornado Warrior during the combat showdown: her defend trigger was checked when she became a Defender → it doesn\'t fire', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const dm = put(g, P0, 'Dame the Despoiler', BF_A); control(g, BF_A, P0);
  const tw = put(g, P0, 'Tornado Warrior', { facedown: BF_A });
  const a = put(g, P1, 'V(8)', 'base');
  g = move(g, P1, [a], BF_A);
  g = drive(g, [], x => x.pending?.kind === 'showdownAction' && x.chain.length === 0);
  if (g.pending?.player === P1) g = act(g, { type: 'pass', player: P1 });
  expectPending(g, 'showdownAction', P0);
  g = act(g, { type: 'playCard', player: P0, obj: tw });
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'assignDamage' && !(g.pending.kind === 'showdownAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = act(g, { type: 'pass', player: d.player }); continue; }
    const o = d.options!.map(x => x.id);
    g = ans(g, d.kind === 'optional' ? 'yes' : o.includes(dm) ? [dm] : 'first');
  }
  assert.ok(g.objects[dm].empowered, 'Dame empowered');
  assert.ok(!g.log.some(l => /Resolving Dame/.test(l.text)), 'no defend trigger');
  assert.equal(mightOf(g, dm), 5);
});

test('RJ#13366 Inferna + Blood Rush (repeated: Assault 2+2) attacks; Brawl in the combat showdown gives Assault equal to her current Might (7) → 14 Might', () => {
  let g = S0(); fundAll(g, P0, 12);
  const inf = put(g, P0, 'Inferna', 'base');
  const e = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Blood Rush') }), [[inf], 'yes', [inf]]);
  assert.equal(mightOf(g, inf), 1, 'Assault inactive in base');
  g = move(g, P0, [inf], BF_A);
  g = drive(g, [], x => x.pending?.kind === 'showdownAction' && x.pending.player === P0 && x.chain.length === 0);
  assert.equal(mightOf(g, inf), 7, '1 + Assault 2 + 2 + 2');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Brawl') }), [[inf]], x => x.pending?.kind === 'showdownAction' || x.pending?.kind === 'assignDamage');
  assert.equal(mightOf(g, inf), 14);
  void e;
});

test('RJ#13368 Agony\'s Embrace: the opponent Gusts my unit played from face down in response to the draw trigger — I still draw 1', () => {
  let g = S0(); fundAll(g, P1);
  setLegend(g, P0, "Agony's Embrace");
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  for (let i = 0; i < 3; i++) put(g, P0, 'V(1)', 'deckTop');
  const fd = put(g, P0, 'HidU(2)', { facedown: BF_A });
  const h0 = g.players[0].hand.length;
  g = act(g, { type: 'playCard', player: P0, obj: fd });
  g = drive(g, [], x => x.pending?.kind === 'chainResponse' && x.pending.player === P1 && x.chain.some(c => /Agony/.test(String(c.label))) || x.pending?.kind === 'mainAction');
  assert.ok(g.chain.some(c => /Agony/.test(String(c.label))), 'Embrace trigger on the chain');
  assert.equal(locOf(g, fd), BF_A, 'unit on the board');
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Gust') });
  g = drive(g, [[fd]]);
  assert.equal(zone(g, fd), 'hand', 'Gusted');
  assert.equal(g.players[0].hand.length - h0, 2, 'Gusted unit + 1 draw');
});

test('RJ#13371 Harnessed Dragon killed by Shakedown in response to its play trigger: the kill still resolves', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1);
  const e = put(g, P1, 'V(2)', 'base');
  const hd = hand(g, P0, 'Harnessed Dragon');
  g = act(g, { type: 'playCard', player: P0, obj: hd, destination: 'base' } as never);
  g = drive(g, [[e]], x => x.pending?.kind === 'chainResponse' && x.pending.player === P1 && x.chain.some(c => c.source === hd));
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Shakedown') });
  for (let i = 0; i < 30 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = act(g, { type: 'pass', player: d.player }); continue; }
    const o = d.options!.map(x => x.id);
    g = ans(g, o.includes(hd) ? [hd] : o.includes(e) ? [e] : o.find(x => /deal|damage|no/i.test(x)) ?? 'first');
  }
  assert.equal(zone(g, hd), 'trash', 'Dragon died to Shakedown');
  assert.equal(zone(g, e), 'trash', 'its kill still resolved');
});

test('RJ#13374 three Ziggs, Explosive defending with three friendly Bombs: each defend trigger kills a different Bomb as its cost (at finalization) → each Ziggs +2', () => {
  let g = withTokens(S0()); fundAll(g, P0, 12);
  control(g, BF_A, P0);
  const zs = [0, 1, 2].map(() => put(g, P0, 'rad-112-167', BF_A));
  for (let k = 0; k < 3; k++) g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Amateur Demolitionist'), destination: 'base' }), ['first', String(BF_A), String(BF_A)], x => x.pending?.kind === 'mainAction');
  const bs = Object.keys(g.objects).filter(id => g.cards[g.objects[id].cardId]?.name === 'Bomb' && g.objects[id].zone === 'battlefield');
  assert.equal(bs.length, 3);
  g = nextTurn(g);
  const a = put(g, P1, 'V(9)', 'base');
  g = move(g, P1, [a], BF_A);
  for (let i = 0; i < 60 && g.pending && g.pending.kind !== 'assignDamage' && !(g.pending.kind === 'showdownAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = act(g, { type: 'pass', player: d.player }); continue; }
    const o = d.options!.map(x => x.id);
    const free = bs.find(b => o.includes(b));
    g = ans(g, d.kind === 'optional' ? 'yes' : free ? [free] : o.includes(a) ? [a] : 'first');
  }
  assert.deepEqual(zs.map(z => mightOf(g, z)), [6, 6, 6]);
});

// RJ#13375 (+ #13317): Ezreal, Prodigy's "Optional additional costs you pay cost [1] or [A] less" — the payer chooses which component is
// reduced. Engine (src/cards/helpers/B8.ts oneOrA) always removes the [1] when the cost has Energy.
test('RJ#13375 (AMBIGUOUS, RJ adopted) Ezreal, Prodigy: the payer may reduce the [C] of Bellows Breath\'s Repeat [1][C] instead of the [1] → 2 Energy + 1 Mind with one Mind and one Fury rune', () => {
  let g = S0();
  setRunes(g, P0, 1, 'mind'); addRunes(g, P0, 1, 'fury');
  put(g, P0, 'Ezreal, Prodigy', 'base');
  const e = put(g, P1, 'V(5)', BF_B);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Bellows Breath') });
  for (let i = 0; i < 12 && g.pending?.inStep && g.pending.player === P0; i++) {
    const d = g.pending!; const o = d.options!.map(x => x.id);
    g = ans(g, d.kind === 'optional' ? 'yes' : o.includes(e) ? [e] : o.find(x => /A|power|C/i.test(x)) ?? 'first');
  }
  g = drive(g);
  assert.equal(g.objects[e].damage, 2, 'repeated');
});

test('RJ#13376 Reluctant Leader triggers once per token: Recruit the Vanguard (four Recruits) → +8 (11 Might)', () => {
  let g = withTokens(S0()); fundAll(g, P0, 10);
  const rl = put(g, P0, 'Reluctant Leader', 'base');
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Recruit the Vanguard') }), ['first', 'first', 'first', 'first']);
  assert.equal(unitsNamed(g, 'Recruit').length, 4);
  assert.equal(mightOf(g, rl), 11);
});

test('RJ#13377 attacking BF-A, I empower Kharox at BF-B with a hidden Tornado Warrior: the Ambush unit played from the opponent\'s trash may go to BF-A and joins the attack', () => {
  let g = S0(); fundAll(g, P0, 12); fundAll(g, P1);
  const kx = put(g, P0, 'Kharox', BF_B); control(g, BF_B, P0);
  const tw = put(g, P0, 'Tornado Warrior', { facedown: BF_B });
  const nd = put(g, P1, 'Nidalee, Cat Form', 'trash');
  const d = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(3)', 'base');
  g = move(g, P0, [a], BF_A);
  g = drive(g, [], x => x.pending?.kind === 'showdownAction' && x.pending.player === P0 && x.chain.length === 0);
  g = act(g, { type: 'playCard', player: P0, obj: tw });
  const dests: string[] = [];
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'assignDamage' && !(g.pending.kind === 'showdownAction' && g.chain.length === 0); i++) {
    const p = g.pending;
    if (!p.inStep) { g = act(g, { type: 'pass', player: p.player }); continue; }
    const o = p.options!.map(x => x.id);
    if (o.includes(String(BF_A))) dests.push(...o);
    g = ans(g, p.kind === 'optional' ? 'yes' : o.includes(kx) ? [kx] : o.includes(nd) ? [nd] : o.includes(String(BF_A)) ? String(BF_A) : 'first');
  }
  assert.ok(g.objects[kx].empowered);
  assert.equal(locOf(g, nd), BF_A, `Nidalee played to the attacked battlefield (offered: ${dests})`);
  void d;
});

test('RJ#13378 the opponent kills my only unit at BF-A; in response to my Altar of Memories trigger I play my hidden unit there → I keep control', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1, 8);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  put(g, P0, 'Altar of Memories', 'base');
  for (let i = 0; i < 3; i++) put(g, P0, 'V(1)', 'deckTop');
  const fd = put(g, P0, 'HidU(2)', { facedown: BF_A });
  g = drive(act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Void Seeker') }), ['yes'], x => x.pending?.player === P0 && !x.pending.inStep && x.chain.some(c => /Altar/.test(String(c.label))) || x.pending?.kind === 'mainAction');
  assert.equal(zone(g, u), 'trash');
  assert.ok(g.chain.some(c => /Altar/.test(String(c.label))), 'Altar trigger on the chain');
  g = act(g, { type: 'playCard', player: P0, obj: fd });
  g = drive(g, ['first', 'top', 'first']);
  assert.equal(locOf(g, fd), BF_A);
  assert.equal(g.battlefields[BF_A].controller, P0, 'control kept');
});

test('RJ#13380 Riven, Deserter\'s activated ability can\'t be used on the opponent\'s turn (no timing keyword → own Main Phase, Open State)', () => {
  let g = S0({ tp: P1 });
  const rv = put(g, P0, 'Riven, Deserter', 'base');
  put(g, P0, 'V(1)', 'base');
  assert.equal(legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === rv), false);
});

test('RJ#13381 one Alpha Strike splits its damage among enemy units at both battlefields', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'V(4)', 'base');
  const a = put(g, P1, 'V(2)', BF_A), b = put(g, P1, 'V(2)', BF_B); control(g, BF_A, P1); control(g, BF_B, P1);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Alpha Strike') }), [[a, b], '2', 'first', 'first'], x => x.pending?.kind === 'mainAction');
  assert.equal(zone(g, a), 'trash'); assert.equal(zone(g, b), 'trash');
});

test('RJ#13382 Tideturner (first card) swaps Astral Heron from BF-A to base: Heron\'s trigger fired while it was at the battlefield → the next card is discounted', () => {
  let g = S0(); fundAll(g, P0, 10);
  const h = put(g, P0, 'Astral Heron', BF_A); control(g, BF_A, P0);
  const tt = hand(g, P0, 'Tideturner');
  const n = hand(g, P0, 'V(3)');
  g = act(g, { type: 'playCard', player: P0, obj: tt, destination: 'base' } as never);
  for (let i = 0; i < 20 && g.pending && !(g.pending.kind === 'mainAction' && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = act(g, { type: 'pass', player: d.player }); continue; }
    const o = d.options!.map(x => x.id);
    g = ans(g, d.kind === 'optional' ? 'yes' : o.includes(h) ? [h] : 'first');
  }
  assert.equal(locOf(g, h), 'base', 'Heron swapped to base');
  assert.equal(locOf(g, tt), BF_A);
  assert.equal(playCostOf(g, P0, n)!.energy, 1, 'next card 3 - 2');
});

test('RJ#13383 Kayle, Justified (empowered twice, buffed) saved by The Boss: she keeps both Empowered statuses; only the buff is spent', () => {
  let g = S0(); fundAll(g, P0);
  setLegend(g, P0, 'The Boss');
  const k = put(g, P0, 'Kayle, Justified', BF_A, { buff: true }); control(g, BF_A, P0);
  g.objects[k].empowered = 2; g.timestamp++;
  assert.equal(mightOf(g, k), 3 + 4 + 1);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'KillA') }), ['yes']);   // target auto-chosen (only unit at a battlefield)
  assert.equal(locOf(g, k), 'base', 'saved and recalled');
  assert.equal(g.objects[k].empowered, 2, 'still empowered twice');
  assert.equal(g.objects[k].counters?.buff ?? 0, 0, 'buff spent');
  assert.equal(mightOf(g, k), 3 + 4);
});

test('RJ#13384 Ephemeral Ward animated by Lady of Clockwork (4 + its own +2 = 6), then Sprite Burst: its "when you play a unit, kill this" still works → it dies after the spell', () => {
  let g = withTokens(S0({ tp: P1 })); setLegend(g, P0, 'Lady of Clockwork');
  const ew = put(g, P0, 'Ephemeral Ward', 'base');
  g = endTurn(g, P1);
  for (let i = 0; i < 30 && g.pending && !(g.pending.kind === 'mainAction' && g.activePlayer === P0 && g.chain.length === 0); i++) {
    const d = g.pending;
    if (!d.inStep) { g = act(g, { type: 'pass', player: d.player }); continue; }
    const o = d.options!.map(x => x.id);
    g = ans(g, d.kind === 'optional' ? 'yes' : o.includes(ew) ? [ew] : o[0]);
  }
  assert.equal(mightOf(g, ew), 6, 'unit gear 4 + its own +2');
  fundAll(g, P0, 10);
  g = drive(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Sprite Burst') }), ['first', 'first']);
  assert.equal(unitsNamed(g, 'Sprite').length, 2);
  assert.equal(zone(g, ew), 'trash', 'Ward killed itself');
});

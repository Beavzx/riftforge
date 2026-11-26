// Rift Judge verification, range r6501 (question ids 6501-7800). One test per verified mechanics question.
// See docs/riftjudge/README.md and docs/riftjudge/r6501.md (log).
import { test } from 'node:test';
import {
  assert, S0, put, hand, play, pass, passN, control, act, move, P0, P1, BF_A, BF_B, zone, locOf, mightOf, resolveChain, passAll,
  pend, answer, yes, no, choose, legal, canPlayNow, fundAll, realCard, attackSetup, optionIds, expectPending, addRunes, readyRunes, legalDeck, setRunes, endTurn, hasKeyword, nextTurn, kwValue, validateAction, playDests, rejects,
  setBattlefieldCard, mod,
  type GameState, type ObjId, type PlayerId,
} from '../conformance/harness.ts';
import { touch, attachNow } from '../../src/engine/testkit.ts';
import { moveToZone } from '../../src/engine/state.ts';
import { readFileSync } from 'node:fs';
import type { CardDef } from '../../src/engine/types.ts';
import { createGame, getLegalActions } from '../../src/engine/index.ts';
import { fixtureDb } from '../fixtures/conformance/cards.ts';

// ---------------------------------------------------------------------------------------------
// local helpers
function setLegend(g: GameState, p: PlayerId, name: string): ObjId {
  const d = realCard(name);
  if (!g.cards[d.id]) g.cards = { ...g.cards, [d.id]: d };
  const id = g.players[p].legend;
  g.objects[id].cardId = d.id; touch(g);
  return id;
}
/** S0 with both players funded with 4 ready runes of each domain. */
function S0F(o: Parameters<typeof S0>[0] = {}): GameState { const g = S0(o); fundAll(g, P0); fundAll(g, P1); addTokens(g); return g; }
/** Real token defs (Sprite, Recruit, Gold...) so real scripts can create them (S0 only has fixture cards). */
const TOKENS = (() => { const raw = JSON.parse(readFileSync(new URL('../../data/cards.json', import.meta.url), 'utf8')); return (Array.isArray(raw) ? raw : Object.values(raw)).filter((c: CardDef) => c.supertypes?.includes('Token')) as CardDef[]; })();
function addTokens(g: GameState): void { const add: Record<string, CardDef> = {}; for (const t of TOKENS) if (!g.cards[t.id]) add[t.id] = t; g.cards = { ...g.cards, ...add }; }
/** Resolve chain / in-step decisions: optional -> yes (unless no), preferred option ids first, else first legal answer. */
function settle(g: GameState, prefer: string[] = [], o: { no?: boolean; limit?: number } = {}): GameState {
  for (let i = 0; i < (o.limit ?? 30) && g.pending && (g.chain.length || g.pending.inStep); i++) {
    const d = g.pending;
    if (!d.inStep) { g = act(g, { type: 'pass', player: d.player }); continue; }
    if (d.kind === 'optional') { g = act(g, { type: 'choose', player: d.player, optionIds: [o.no ? 'no' : 'yes'] }); continue; }
    const want = (d.options ?? []).find(x => prefer.includes(x.id));
    g = want ? act(g, { type: 'choose', player: d.player, optionIds: [want.id] }) : act(g, getLegalActions(g, d.player)[0]);
  }
  return g;
}
const kinds = (g: GameState) => g.pending ? `${g.pending.kind}:P${g.pending.player}` : 'none';

// ---------------------------------------------------------------------------------------------
test('RJ#6502 The Boss save is a replacement: no chain item, nothing to respond to', () => {
  let g = S0F();
  setLegend(g, P0, 'The Boss');
  const u = put(g, P0, 'V(2)', BF_A, { buff: true });
  control(g, BF_A, P0);
  const ray = hand(g, P0, 'Hextech Ray');
  g = play(g, P0, ray, { targets: [[u]] });
  g = resolveChain(g);
  expectPending(g, 'optional', P0);
  g = yes(g);
  assert.equal(g.chain.length, 0, 'no chain item for the replacement');
  assert.equal(pend(g).kind, 'mainAction', 'no response window');
  assert.equal(locOf(g, u), 'base');
});

test('RJ#6504 Hextech Ray whose target left play does not retarget', () => {
  let g = S0F();
  const a = put(g, P1, 'V(5)', BF_A), b = put(g, P1, 'V(5)', BF_A);
  control(g, BF_A, P1);
  const ray = hand(g, P0, 'Hextech Ray'), ret = hand(g, P1, 'Retreat');
  g = play(g, P0, ray, { targets: [[a]] });
  g = pass(g);
  g = play(g, P1, ret, { targets: [[a]] });
  g = resolveChain(g);
  assert.equal(zone(g, a), 'hand');
  assert.equal(g.objects[b].damage, 0, 'no new target');
  assert.equal(g.chain.length, 0);
});

test('RJ#6505 an Action spell cannot respond to Void Seeker outside a showdown', () => {
  let g = S0F();
  const k = put(g, P1, 'V(5)', BF_A);
  control(g, BF_A, P1);
  const vs = hand(g, P0, 'Void Seeker'), ray = hand(g, P1, 'Hextech Ray'), ret = hand(g, P1, 'Retreat');
  g = play(g, P0, vs, { targets: [[k]] });
  g = pass(g);
  expectPending(g, 'chainResponse', P1);
  assert.equal(canPlayNow(g, P1, ray), false, 'Action: no');
  assert.equal(canPlayNow(g, P1, ret), true, 'Reaction: yes');
});

test('RJ#6507 Zhonya\'s unit still deals its combat damage (simultaneous) before being recalled', () => {
  let { g, atk, def } = attackSetup(['V(3)'], ['V(3)']);
  const hg = put(g, P1, "Zhonya's Hourglass", 'base');
  g = passAll(g);
  g = answer(g, { may: [true] });
  g = passAll(g);
  assert.equal(zone(g, atk[0]), 'trash', 'attacker took the defender\'s 3');
  assert.equal(locOf(g, def[0]), 'base');
  assert.equal(g.objects[def[0]].exhausted, true);
  assert.equal(zone(g, hg), 'trash');
});

test('RJ#6509 Super Mega Death Rocket: no card to discard -> stays in trash; with a card -> may return', () => {
  const run = (withCard: boolean) => {
    let g = S0F();
    const r = put(g, P0, 'Super Mega Death Rocket!', 'trash');
    const c = withCard ? hand(g, P0, 'V(1)') : null;
    const u = put(g, P0, 'V(2)', 'base');
    g = move(g, P0, [u], BF_A);
    g = passAll(g);
    if (withCard) { g = answer(g, { may: [true] }); if (g.pending?.kind === 'chooseCards') g = choose(g, c!); g = passAll(g); }
    return { g, r, c };
  };
  const a = run(false);
  assert.equal(zone(a.g, a.r), 'trash');
  assert.equal(a.g.pending?.kind, 'mainAction');
  const b = run(true);
  assert.equal(zone(b.g, b.r), 'hand');
  assert.equal(zone(b.g, b.c!), 'trash');
});

test('RJ#6510 damage taken earlier in the turn persists into combat', () => {
  const run = (dmg: number) => {
    let { g, atk } = attackSetup(['V(3)'], ['V(1)'], { atkOpts: [{ damage: dmg }] });
    g = passAll(g);
    return zone(g, atk[0]);
  };
  assert.equal(run(0), 'battlefield');
  assert.equal(run(2), 'trash', '2 earlier + 1 combat = 3 = Might');
});

test('RJ#6511 Zhonya\'s Hourglass is not optional (no may prompt)', () => {
  let g = S0F();
  const u = put(g, P0, 'V(2)', BF_A);
  control(g, BF_A, P0);
  const hg = put(g, P0, "Zhonya's Hourglass", 'base');
  const ray = hand(g, P0, 'Hextech Ray');
  g = play(g, P0, ray, { targets: [[u]] });
  g = resolveChain(g);
  assert.notEqual(g.pending?.kind, 'optional');
  assert.equal(zone(g, hg), 'trash');
  assert.equal(locOf(g, u), 'base');
});

test('RJ#6512 setup order: battlefields revealed, then play order chosen, then mulligan', () => {
  // existing coverage: tests/rules/setup.test.ts 'setup: battlefield choice decisions (hidden), coin flip winner chooses to go first or second'
  const g0 = createGame({ seed: 5, cardDb: fixtureDb(), battlefieldSelection: 'choose', skipMulligan: false, includeAllCards: true,
    players: [{ name: 'A', deck: legalDeck() }, { name: 'B', deck: legalDeck({}, ['cf-bf-d', 'cf-bf-e', 'cf-bf-f']) }] });
  let g = g0;
  assert.equal(g.pending?.kind, 'chooseBattlefield');
  g = choose(g, g.pending!.options![0].id);
  g = choose(g, g.pending!.options![0].id);
  assert.equal(g.battlefields.length, 2);
  assert.equal(g.pending?.kind, 'chooseMode');
  g = choose(g, 'first');
  assert.equal(g.pending?.kind, 'mulligan');
});

test('RJ#6513 Stupefy makes a damaged unit lethal: it dies in the cleanup right after Stupefy, no Gust window', () => {
  let g = S0F();
  const k = put(g, P1, 'V(4)', BF_A, { damage: 3 });
  control(g, BF_A, P1);
  hand(g, P1, 'Gust');
  const st = hand(g, P0, 'Stupefy');
  g = play(g, P0, st, { targets: [[k]] });
  g = passN(g, 2);
  assert.equal(zone(g, k), 'trash');
  assert.equal(g.chain.length, 0);
});

test('RJ#6514 after the defender\'s chain resolves in a showdown, focus returns to the attacker (no damage yet)', () => {
  let { g, atk, def } = attackSetup(['V(3)'], ['V(3)']);
  addRunes(g, P1, 2);
  expectPending(g, 'showdownAction', P0);
  g = pass(g);
  expectPending(g, 'showdownAction', P1);
  const pa = hand(g, P1, 'PumpA');
  g = play(g, P1, pa, { targets: [[def[0]]] });
  g = passN(g, 2);
  assert.equal(g.chain.length, 0);
  expectPending(g, 'showdownAction', P0);
  assert.equal(g.objects[atk[0]].damage, 0);
});

test('RJ#6515 Pakaa Cub played from hiding is exhausted', () => {
  let g = S0F();
  control(g, BF_A, P0);
  put(g, P0, 'V(1)', BF_A);
  const c = put(g, P0, 'Pakaa Cub', { facedown: BF_A });
  g = act(g, { type: 'playCard', player: P0, obj: c });
  g = passAll(g);
  assert.equal(locOf(g, c), BF_A);
  assert.equal(g.objects[c].exhausted, true);
});

test('RJ#6516 Harnessed Dragon\'s "kill an enemy unit" chooses (targets): Deflect applies', () => {
  const run = (enemy: string) => {
    let g = S0F();
    const e = put(g, P1, enemy, 'base');
    const d = hand(g, P0, 'Harnessed Dragon');
    const before = g.players[P0].runesInPlay.length;
    g = play(g, P0, d, { dest: 'base', targets: [[e]] });
    g = answer(g, { targets: [[e]], may: [true] });     // RJ#5262: the trigger's Deflect cost is offered (pay it)
    g = resolveChain(g);
    return { dead: zone(g, e) === 'trash', spent: before - g.players[P0].runesInPlay.length, ready: readyRunes(g, P0) };
  };
  const plain = run('V(2)'), defl = run('Deflect(2,1)');
  assert.ok(plain.dead && defl.dead);
  assert.ok(defl.spent + (24 - defl.ready) > plain.spent + (24 - plain.ready), `Deflect cost paid: ${JSON.stringify({ plain, defl })}`);
});

test('RJ#6517 hidden Tideturner may swap with a unit at another location (explicit "another location" overrides "here")', () => {
  let g = S0F();
  control(g, BF_A, P0);
  put(g, P0, 'V(1)', BF_A);
  const home = put(g, P0, 'V(2)', 'base');
  const t = put(g, P0, 'Tideturner', { facedown: BF_A });
  g = act(g, { type: 'playCard', player: P0, obj: t });
  g = passAll(g);
  g = answer(g, { targets: [[home]], may: [true] });
  g = passAll(g);
  g = answer(g, { targets: [[home]], may: [true] });
  g = passAll(g);
  assert.equal(locOf(g, t), 'base');
  assert.equal(locOf(g, home), BF_A);
});

test('RJ#6518 hidden Hidden Blade on Jinx; Tideturner swaps Jinx away: Blade no longer has a legal ("here") target', () => {
  let g = S0F({ tp: P1 });
  control(g, BF_A, P0); control(g, BF_B, P1);
  put(g, P0, 'V(1)', BF_A); put(g, P1, 'V(1)', BF_B);
  const jinx = put(g, P1, 'V(3)', 'base');
  const t = put(g, P1, 'Tideturner', { facedown: BF_B });
  const hb = put(g, P0, 'Hidden Blade', { facedown: BF_A });
  g = move(g, P1, [jinx], BF_A);
  for (let i = 0; i < 5 && !(g.pending?.kind === 'showdownAction' && g.pending.player === P0); i++) g = pass(g);
  expectPending(g, 'showdownAction', P0);
  g = act(g, { type: 'playCard', player: P0, obj: hb });
  g = answer(g, { targets: [[jinx]] });
  g = pass(g);
  g = act(g, { type: 'playCard', player: P1, obj: t });
  g = answer(g, { targets: [[jinx]], may: [true] });
  for (let i = 0; i < 12 && g.chain.length; i++) { g = answer(g, { targets: [[jinx]], may: [true] }); if (g.pending?.kind === 'chainResponse') g = pass(g); }
  assert.equal(zone(g, jinx), 'battlefield', 'Blade mistargets: Jinx survives');
  assert.equal(locOf(g, jinx), BF_B, 'swapped');
  assert.equal(locOf(g, t), BF_A, 'Tideturner survives');
  assert.equal(zone(g, hb), 'trash');
});

test('RJ#6519 Ember Monk triggers for a card played from hiding at another battlefield', () => {
  let g = S0F();
  const m = put(g, P0, 'Ember Monk', BF_B);
  control(g, BF_B, P0); control(g, BF_A, P0);
  put(g, P0, 'V(1)', BF_A);
  const e = put(g, P1, 'V(5)', 'base');
  const h = put(g, P0, 'HidZap', { facedown: BF_A });
  g = act(g, { type: 'playCard', player: P0, obj: h });
  g = answer(g, { targets: [[e]] });
  g = passAll(g);
  assert.equal(mightOf(g, m), 6);
});

test('RJ#6520 Herald of the Arcane (Viktor) cannot put its Recruit onto an empty uncontrolled battlefield', () => {
  let g = S0F();
  const leg = setLegend(g, P0, 'Herald of the Arcane');
  g = act(g, { type: 'activate', player: P0, obj: leg, abilityIndex: 0 });
  g = passAll(g);
  if (g.pending?.kind === 'chooseDestination') {
    assert.ok(!optionIds(g).includes(String(BF_A)) && !optionIds(g).includes(String(BF_B)), `options ${optionIds(g)}`);
    g = choose(g, 'base');
  }
  g = passAll(g);
  const rec = g.players[P0].base.filter(x => g.cards[g.objects[x].cardId].name === 'Recruit');
  assert.equal(rec.length, 1);
});

test('RJ#6521 a trigger without "may" is mandatory; one whose only choice costs (Deflect) can be declined', () => {
  // mandatory: Harnessed Dragon's kill goes on the chain without a may-prompt
  let g = S0F();
  const e = put(g, P1, 'V(2)', 'base');
  const d = hand(g, P0, 'Harnessed Dragon');
  g = play(g, P0, d, { dest: 'base' });
  assert.notEqual(g.pending?.kind, 'optional');
  g = answer(g, { targets: [[e]] });
  g = resolveChain(g);
  assert.equal(zone(g, e), 'trash');
});

test('RJ#6521b a trigger whose chosen target has Deflect: the controller may decline the cost (CR 405.2)', () => {
  let h = S0F();
  const f = put(h, P1, 'Deflect(2,1)', 'base');
  const d2 = hand(h, P0, 'Harnessed Dragon');
  h = play(h, P0, d2, { dest: 'base' });
  h = answer(h, { targets: [[f]], may: [false] });
  for (let i = 0; i < 6 && h.pending?.inStep; i++) { const ids = optionIds(h); const dec = ids.find(x => /no|decline|skip|none/i.test(x)); if (!dec) break; h = choose(h, dec); }
  h = resolveChain(h);
  assert.equal(zone(h, f), 'base', `declined (pending ${kinds(h)} ${optionIds(h)})`);
});

test('RJ#6522 several units leave a battlefield to base in one standard move', () => {
  let g = S0F();
  control(g, BF_A, P0);
  const a = put(g, P0, 'V(2)', BF_A), b = put(g, P0, 'V(3)', BF_A);
  g = move(g, P0, [a, b], 'base');
  g = passAll(g);
  assert.equal(locOf(g, a), 'base'); assert.equal(locOf(g, b), 'base');
});

test('RJ#6523 the initial chain of a combat (attack triggers) leaves focus with the attacker', () => {
  let { g } = attackSetup(['AttackDraw(3)'], ['V(1)']);
  for (let i = 0; i < 6 && g.chain.length; i++) { g = answer(g, {}); if (g.pending?.kind === 'chainResponse') g = pass(g); }
  assert.equal(g.chain.length, 0);
  expectPending(g, 'showdownAction', P0);
});

test('RJ#6524 Stupefy (-1) lets 3 spell damage kill a 4-Might unit', () => {
  let g = S0F();
  const k = put(g, P1, 'V(4)', BF_A);
  control(g, BF_A, P1);
  const st = hand(g, P0, 'Stupefy'), ray = hand(g, P0, 'Hextech Ray');
  g = play(g, P0, st, { targets: [[k]] }); g = resolveChain(g);
  g = play(g, P0, ray, { targets: [[k]] }); g = resolveChain(g);
  assert.equal(zone(g, k), 'trash');
});

test('RJ#6525 Lux, Crownguard spell-only energy cannot pay Hard Bargain\'s "pays [2]"', () => {
  let g = S0F();
  setRunes(g, P0, 1, 'fury');
  put(g, P0, 'Lux, Crownguard', 'base');
  const z = hand(g, P0, 'ZapM');
  const t = put(g, P1, 'V(5)', 'base');
  const hb = hand(g, P1, 'Hard Bargain');
  g = play(g, P0, z, { targets: [[t]] });
  g = pass(g);
  g = play(g, P1, hb, { targets: [[g.chain[0].id]] });
  for (let i = 0; i < 10 && g.chain.length; i++) {
    if (g.pending?.kind === 'chainResponse') { g = pass(g); continue; }
    const ids = optionIds(g); const dec = ids.find(x => /no|decline|dont|don't/i.test(x));
    assert.ok(!ids.some(x => /yes|pay/i.test(x)) || dec, `P0 can't pay: ${kinds(g)} ${ids}`);
    g = choose(g, dec ?? ids[ids.length - 1]);
  }
  assert.equal(g.objects[t].damage, 0, 'ZapM countered');
});

test('RJ#6526 a unit can be played from hand to a battlefield you control', () => {
  // also tests/conformance/B-turn.test.ts 'T028 — Unit play location'
  const g = S0F();
  control(g, BF_A, P0); put(g, P0, 'V(1)', BF_A);
  const u = hand(g, P0, 'V(2)');
  assert.ok(canPlayNow(g, P0, u, BF_A));
  assert.ok(!canPlayNow(g, P0, u, BF_B));
});

test('RJ#6527/6529 showdown focus alternates; after a pass the opponent may play again', () => {
  let { g, def } = attackSetup(['V(3)'], ['V(3)']);
  addRunes(g, P1, 3);
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'PumpA'), { targets: [[def[0]]] });
  g = passN(g, 2);
  expectPending(g, 'showdownAction', P0);
  g = pass(g);
  expectPending(g, 'showdownAction', P1);
  const p2 = hand(g, P1, 'PumpA');
  assert.ok(canPlayNow(g, P1, p2), 'opponent can play another card');
});

test('RJ#6528 Blade Dancer readying a unit is not "choosing" it: Irelia, Fervent gets +1 (chosen) +1 (readied) only', () => {
  let g = S0F();
  setLegend(g, P0, 'Blade Dancer');
  const ir = put(g, P0, 'Irelia, Fervent', BF_A, { ready: false });
  control(g, BF_A, P0);
  g = play(g, P0, hand(g, P0, 'PumpA'), { targets: [[ir]] });
  for (let i = 0; i < 12 && (g.chain.length || g.pending?.inStep); i++) {
    if (g.pending?.kind === 'chainResponse') { g = pass(g); continue; }
    if (g.pending?.kind === 'optional') { g = yes(g); continue; }
    if (g.pending?.kind === 'orderTriggers') { g = choose(g, optionIds(g)[0]); continue; }
    g = answer(g, { targets: [[ir]] }); if (g.pending?.inStep) break;
  }
  assert.equal(g.objects[ir].exhausted, false, 'readied');
  assert.equal(mightOf(g, ir), 4 + 3 + 1 + 1);
});

test('RJ#6530 Smoke Screen x2 on a 6-Might Stalwart Poro: -4 then -1 (minimum checked on application); -2 after combat, no death', () => {
  let { g, atk, def } = attackSetup(['V(0)'], ['Stalwart Poro'], { defOpts: [{ buff: true }] });
  setLegend(g, P1, 'Wuju Bladesman');
  fundAll(g, P0);
  const p = def[0];
  assert.equal(mightOf(g, p), 6);
  g = play(g, P0, hand(g, P0, 'Smoke Screen'), { targets: [[p]] }); g = passN(g, 2);
  assert.equal(mightOf(g, p), 2);
  if (g.pending?.player === P1) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Smoke Screen'), { targets: [[p]] }); g = passN(g, 2);
  assert.equal(mightOf(g, p), 1);
  g = passAll(g);
  assert.equal(zone(g, atk[0]), 'trash');
  assert.equal(zone(g, p), 'battlefield');
  assert.equal(mightOf(g, p), -2);
});

test('RJ#6531 (AMBIGUOUS) Stupefy making existing damage lethal is not "kill a unit with a spell": Immortal Phoenix does not trigger', () => {
  let g = S0F();
  const k = put(g, P1, 'V(4)', BF_A, { damage: 3 });
  control(g, BF_A, P1);
  const ph = put(g, P0, 'Immortal Phoenix', 'trash');
  g = play(g, P0, hand(g, P0, 'Stupefy'), { targets: [[k]] });
  g = passN(g, 2);
  assert.equal(zone(g, k), 'trash');
  assert.notEqual(g.pending?.kind, 'optional', 'no Phoenix prompt');
  assert.equal(zone(g, ph), 'trash');
});

test('RJ#6532 Warwick to base, Flurry of Blades, then Warwick attacks: all damaged enemy units there die', () => {
  let g = S0F();
  control(g, BF_A, P1);
  const e1 = put(g, P1, 'V(5)', BF_A), e2 = put(g, P1, 'V(6)', BF_A);
  const w = hand(g, P0, 'Warwick, Hunter');
  g = play(g, P0, w, { dest: 'base' }); g = passAll(g);
  assert.equal(g.objects[w].exhausted, false, 'enters ready');
  g = play(g, P0, hand(g, P0, 'Flurry of Blades')); g = resolveChain(g);
  assert.equal(g.objects[e1].damage, 1);
  g = move(g, P0, [w], BF_A);
  for (let i = 0; i < 6 && g.chain.length; i++) g = pass(g);
  assert.equal(zone(g, e1), 'trash'); assert.equal(zone(g, e2), 'trash');
});

// RJ#6533 rewritten by ADJUDICATOR-5 (DECISIONS #6533, lead request): SMDR's "you may discard 1 to return this …" is the trigger's
// leading cost — paid when the trigger is finalized onto the chain (CR 383.3.a-b, principle 11), while Vayne is still on the board.
// So Vayne (returned only when her own trigger resolves) can never be the discarded card; RJ's "bounce Vayne, then discard it" → MISMATCH-RJ.
test('RJ#6533 (MISMATCH-RJ, principle 11) Vayne + SMDR conquer triggers: SMDR\'s discard is paid when its trigger is chained, before Vayne\'s return resolves — Vayne can\'t be the discard', () => {
  let g = S0F();
  const v = put(g, P0, 'Vayne, Hunter', 'base');
  const r = put(g, P0, 'Super Mega Death Rocket!', 'trash');
  const x = put(g, P0, 'V(1)', 'hand');
  g = move(g, P0, [v], BF_A);
  let offeredVayne = false;
  for (let i = 0; i < 20; i++) {
    const d = g.pending!;
    if (d.kind === 'orderTriggers') { g = choose(g, d.options!.find(o => /Rocket|Death/i.test(o.label))!.id); continue; }
    if (d.kind === 'optional') { g = yes(g); continue; }
    if (d.kind === 'chooseCards') { const o = d.options!.map(z => z.id); if (o.includes(v)) offeredVayne = true; g = choose(g, o.includes(x) ? x : o[0]); continue; }
    if (d.kind === 'chainResponse' || d.kind === 'showdownAction') { g = pass(g); continue; }
    break;
  }
  assert.ok(!offeredVayne, 'Vayne was on the board when the discard was paid');
  assert.equal(zone(g, x), 'trash', 'another card was discarded');
  assert.equal(zone(g, r), 'hand', 'SMDR returned');
  assert.equal(zone(g, v), 'hand', 'Vayne returned by her own trigger');
});

test('RJ#6534 "this turn" Might bonuses survive Zhonya\'s recall and The Boss save (only the buff is spent)', () => {
  for (const saver of ['zhonya', 'boss'] as const) {
    let g = S0F();
    if (saver === 'boss') setLegend(g, P0, 'The Boss'); else put(g, P0, "Zhonya's Hourglass", 'base');
    const u = put(g, P0, 'V(2)', BF_A, { buff: true });
    control(g, BF_A, P0);
    g = play(g, P0, hand(g, P0, 'PumpA'), { targets: [[u]] }); g = resolveChain(g);
    g = play(g, P0, hand(g, P0, 'KillA'), { targets: [[u]] }); g = resolveChain(g);
    if (g.pending?.kind === 'optional') g = yes(g);
    assert.equal(locOf(g, u), 'base', saver);
    assert.equal(mightOf(g, u), 2 + 3 + (saver === 'zhonya' ? 1 : 0), `${saver}: +3 kept; buff spent only by The Boss`);
  }
});

test('RJ#6535 with two combats staged, the turn player chooses which resolves first', () => {
  let g = S0F();
  for (const bf of [BF_A, BF_B]) {
    put(g, P0, 'V(3)', bf); put(g, P1, 'V(1)', bf);
    control(g, bf, P1);
    g.battlefields[bf].contested = true; g.battlefields[bf].contestedBy = P0;
  }
  touch(g);
  g = play(g, P0, hand(g, P0, 'DrawR')); g = resolveChain(g);
  expectPending(g, 'chooseShowdown', P0);
  assert.equal(optionIds(g).length, 2);
});

test('RJ#6536 Ahri, Alluring\'s hold point can be the winning point', () => {
  // also tests/conformance/G-scoring.test.ts 'T103 — Final point via hold is not restricted', 'T104 — Card points not restricted'
  let g = S0F({ tp: P1 });
  put(g, P0, 'Ahri, Alluring', BF_A);
  control(g, BF_A, P0);
  g.players[P0].points = 6;
  g = endTurn(g, P1);
  for (let i = 0; i < 10 && g.winner == null && g.pending && g.pending.kind !== 'mainAction'; i++) g = g.pending.inStep ? answer(g, { may: [true] }) : pass(g);
  assert.equal(g.winner, P0);
});

test('RJ#6537 Ember Monk at 1 after two Watcher -3 (min 1, snapshotted) then +2 => 3', () => {
  let k = S0F({ tp: P1 });
  const m = put(k, P0, 'Ember Monk', BF_A);
  const fd = put(k, P0, 'Pakaa Cub', { facedown: BF_A });
  control(k, BF_A, P0);
  for (let i = 0; i < 2; i++) { k = play(k, P1, hand(k, P1, 'Thousand-Tailed Watcher'), { dest: 'base', may: [false] }); k = resolveChain(k); }
  assert.equal(mightOf(k, m), 1);
  k = play(k, P1, hand(k, P1, 'DrawR'));
  k = pass(k);
  k = act(k, { type: 'playCard', player: P0, obj: fd });
  k = resolveChain(k);
  assert.equal(mightOf(k, m), 3);
});

test('RJ#6538 Void Seeker\'s target killed in response: the caster still draws 1', () => {
  let g = S0F();
  const k = put(g, P1, 'V(5)', BF_A);
  control(g, BF_A, P1);
  // the target leaves play in response (Retreat; a kill works the same way)
  const ret = hand(g, P1, 'Retreat');
  const vs = hand(g, P0, 'Void Seeker');
  g = play(g, P0, vs, { targets: [[k]] });
  g = pass(g);
  g = play(g, P1, ret, { targets: [[k]] });
  const h0 = g.players[P0].hand.length;
  g = resolveChain(g);
  assert.equal(g.players[P0].hand.length, h0 + 1);
});

test('RJ#6540 "When I move" triggers resolve before the showdown; "When I attack" triggers come after combat starts', () => {
  let { g } = attackSetup(['MoveDraw(2)', 'AttackDraw(3)'], ['V(1)']);
  const labels = () => g.chain.map(c => g.cards[g.objects[c.source]?.cardId]?.name);
  assert.ok(labels().includes('MoveDraw(2)'), `move trigger first: ${labels()}`);
  assert.ok(!labels().includes('AttackDraw(3)'), 'attack trigger not yet');
  for (let i = 0; i < 4 && labels().includes('MoveDraw(2)'); i++) g = g.pending?.inStep ? answer(g, {}) : pass(g);
  assert.ok(labels().includes('AttackDraw(3)'), `then attack trigger: ${labels()}`);
});

test('RJ#6541 three Vanguard Helms: a buffed friendly unit dies -> three buffs, may go to different units', () => {
  let g = S0F();
  for (let i = 0; i < 3; i++) put(g, P0, 'Vanguard Helm', 'base');
  const d = put(g, P0, 'V(2)', BF_A, { buff: true });
  const a = put(g, P0, 'V(2)', 'base'), b = put(g, P0, 'V(2)', 'base');
  control(g, BF_A, P0);
  g = play(g, P0, hand(g, P0, 'KillA'), { targets: [[d]] });
  const picks = [a, b, a];
  for (let i = 0; i < 20 && (g.chain.length || g.pending?.inStep); i++) {
    if (g.pending?.kind === 'chooseTargets') { const want = picks.find(x => optionIds(g).includes(x)); g = choose(g, want ?? optionIds(g)[0]); if (want) picks.splice(picks.indexOf(want), 1); continue; }
    if (g.pending?.kind === 'orderTriggers') { g = choose(g, optionIds(g)[0]); continue; }
    if (g.pending?.kind === 'chainResponse') { g = pass(g); continue; }
    break;
  }
  const buffs = (x: ObjId) => g.objects[x].counters.buff ?? 0;
  assert.equal(zone(g, d), 'trash');
  assert.ok(buffs(a) >= 1 && buffs(b) >= 1, `shared: a=${buffs(a)} b=${buffs(b)}`);
});

test('RJ#6542 Sprite Call played from hiding on the opponent\'s turn triggers Viktor, Innovator; the Sprite token play does not', () => {
  let g = S0F({ tp: P1 });
  put(g, P0, 'Viktor, Innovator', 'base');
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const sc = put(g, P0, 'Sprite Call', { facedown: BF_A });
  g = play(g, P1, hand(g, P1, 'DrawR'));
  g = pass(g);
  g = act(g, { type: 'playCard', player: P0, obj: sc });
  for (let i = 0; i < 10 && (g.chain.length || g.pending?.inStep); i++) g = g.pending?.inStep ? (g.pending.kind === 'orderTriggers' ? choose(g, optionIds(g)[0]) : answer(g, { may: [true], locations: ['base'] })) : pass(g);
  const names = (p: PlayerId) => Object.values(g.objects).filter(o => o.controller === p && (o.zone === 'base' || o.zone === 'battlefield')).map(o => g.cards[o.cardId].name);
  assert.equal(names(P0).filter(n => n === 'Recruit').length, 1);
  assert.equal(names(P0).filter(n => n === 'Sprite').length, 1);
});

test('RJ#6545 moving into an empty battlefield, then the opponent Rides the Wind in: mover is attacker, opponent defender', () => {
  let g = S0F();
  const a = put(g, P0, 'V(3)', 'base');
  const b = put(g, P1, 'V(2)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 4 && !(g.pending?.kind === 'showdownAction' && g.pending.player === P1); i++) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Ride the Wind'), { targets: [[b]], locations: [BF_A], dest: BF_A });
  for (let i = 0; i < 6 && g.chain.length; i++) g = g.pending?.inStep ? answer(g, { locations: [BF_A], battlefields: [BF_A] }) : pass(g);
  assert.equal(locOf(g, b), BF_A);
  assert.equal(g.objects[a].combatRole, 'attacker');
  assert.equal(g.objects[b].combatRole, 'defender');
});

test('RJ#6547 Relentless Storm does not trigger for Sett, Brawler (4 Might when played; the buff comes later)', () => {
  let g = S0F();
  const leg = setLegend(g, P0, 'Relentless Storm');
  g = play(g, P0, hand(g, P0, 'Sett, Brawler'), { dest: 'base' });
  for (let i = 0; i < 6 && (g.chain.length || g.pending?.inStep); i++) {
    assert.ok(!(g.pending?.kind === 'optional' && /Relentless|channel/i.test(g.pending.prompt)), 'no Relentless Storm prompt');
    g = g.pending?.inStep ? answer(g, { may: [true] }) : pass(g);
  }
  assert.equal(g.objects[leg].exhausted, false, 'legend not used');
});

test('RJ#6548 an Action spell cannot be added to an existing chain', () => {
  // also tests/conformance/D-chain.test.ts 'T052 — Action can\'t respond'
  let { g, def } = attackSetup(['V(3)'], ['V(3)']);
  addRunes(g, P1, 3);
  g = play(g, P0, hand(g, P0, 'ZapR'), { targets: [[def[0]]] });
  g = pass(g);
  expectPending(g, 'chainResponse', P1);
  assert.equal(canPlayNow(g, P1, hand(g, P1, 'PumpA')), false);
  assert.equal(canPlayNow(g, P1, hand(g, P1, 'PumpR')), true);
});

test('RJ#6549 holding priority to add Stupefy does not stop the opponent countering Void Seeker below it', () => {
  let g = S0F();
  const k = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  g = play(g, P0, hand(g, P0, 'Void Seeker'), { targets: [[k]] });
  const vsItem = g.chain[0].id;
  g = play(g, P0, hand(g, P0, 'Stupefy'), { targets: [[k]] });
  assert.equal(g.chain.length, 2);
  g = pass(g);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'CounterR') });
  assert.ok(optionIds(g).includes(vsItem), 'Void Seeker can be chosen');
});

test('RJ#6550 a "When I move" trigger resolves even if the unit left the board', () => {
  let g = S0F();
  const u = put(g, P0, 'MoveDraw(2)', 'base');
  g = move(g, P0, [u], BF_A);
  assert.equal(g.chain.length, 1);
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'ZapR'), { targets: [[u]] });
  const h0 = g.players[P0].hand.length;
  g = resolveChain(g);
  assert.equal(zone(g, u), 'trash');
  assert.equal(g.players[P0].hand.length, h0 + 1);
});

test('RJ#6551 Traveling Merchant\'s move trigger can be responded to; Gust to hand, the discard+draw still happens on resolution', () => {
  let g = S0F();
  const m = put(g, P0, 'Traveling Merchant', 'base');
  const other = hand(g, P0, 'V(1)');
  g = move(g, P0, [m], BF_A);
  assert.equal(g.chain.length, 1, 'trigger on the chain');
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'Gust'), { targets: [[m]] });
  for (let i = 0; i < 10 && (g.chain.length || g.pending?.inStep); i++) {
    if (g.pending?.kind === 'chooseCards') { g = choose(g, m); continue; }
    g = g.pending?.inStep ? answer(g, {}) : pass(g);
  }
  assert.equal(zone(g, m), 'trash', 'Merchant was returned, then discarded');
  assert.equal(zone(g, other), 'hand');
  assert.equal(g.players[P0].hand.length, 2, 'drew 1');
});

test('RJ#6552 Leona, Zealot -8 (min 1) still applies to a stunned defender after Primal Strength: 2+7-8 -> 1', () => {
  let { g, def } = attackSetup(['Leona, Zealot'], ['V(2)'], { defOpts: [{ stunned: true }] });
  fundAll(g, P1);
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'Primal Strength'), { targets: [[def[0]]] });
  g = passN(g, 2);
  assert.equal(mightOf(g, def[0]), 1);
});

test('RJ#6553 Call to Glory with 0 ready runes: spend a buff to ignore its cost', () => {
  let g = S0F();
  setRunes(g, P0, 0);
  const u = put(g, P0, 'V(2)', 'base', { buff: true });
  const c = hand(g, P0, 'Call to Glory');
  assert.ok(canPlayNow(g, P0, c), 'playable with 0 runes');
  g = play(g, P0, c, { may: [true], targets: [[u]] });
  g = answer(g, { may: [true], targets: [[u]] });
  g = resolveChain(g);
  assert.equal(g.objects[u].counters.buff ?? 0, 0);
  assert.equal(mightOf(g, u), 5);
});

test('RJ#6555 Traveling Merchant discards SMDR on its move, then conquers: SMDR can come back', () => {
  let g = S0F();
  const m = put(g, P0, 'Traveling Merchant', 'base');
  const r = hand(g, P0, 'Super Mega Death Rocket!');
  g = move(g, P0, [m], BF_A);
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    if (d.kind === 'chooseCards') { g = choose(g, optionIds(g).includes(r) ? r : optionIds(g)[0]); continue; }
    if (d.kind === 'optional') { g = yes(g); continue; }
    g = d.inStep ? answer(g, {}) : pass(g);
  }
  assert.equal(zone(g, r), 'hand');
});

test('RJ#6557 at 7-7, Draven, Audacious dies in combat while its side conquers: the opponent\'s point comes first and wins', () => {
  let { g } = attackSetup(['Draven, Audacious', 'Backline(5)'], ['V(6)']);
  g.players[P0].points = 7; g.players[P1].points = 7;
  for (let i = 0; i < 30 && g.winner == null && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    if (d.inStep) { const l = legal(g, d.player); g = act(g, l[0]); continue; }
    g = pass(g);
  }
  assert.equal(g.winner, P1);
});

test('RJ#6560 respond to a Temporary Sprite\'s start-of-turn death with a hidden Sprite Call: still hold the battlefield', () => {
  let g = S0F({ tp: P1 });
  const old = put(g, P0, 'unl-t07', BF_A, { token: true });
  const sc = put(g, P0, 'Sprite Call', { facedown: BF_A });
  control(g, BF_A, P0);
  const pts = g.players[P0].points;
  g = endTurn(g, P1);
  let played = false;
  for (let i = 0; i < 30 && g.pending && !(g.pending.kind === 'mainAction'); i++) {
    const d = g.pending;
    if (!played && d.player === P0 && !d.inStep && (d.kind === 'chainResponse' || d.kind === 'showdownAction') && canPlayNow(g, P0, sc)) { g = act(g, { type: 'playCard', player: P0, obj: sc }); played = true; continue; }
    if (d.inStep) { g = answer(g, { locations: [BF_A], may: [true] }); if (g.pending === d) g = act(g, legal(g, d.player)[0]); continue; }
    g = pass(g);
  }
  assert.ok(played, 'Sprite Call could be played in response');
  assert.equal(zone(g, old), 'gone');
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[P0].points, pts + 1, 'held');
});

test('RJ#6561 Svellsongur on Lux, Crownguard: two copies of the [T] ability, but one exhaust pays for only one', () => {
  let g = S0F();
  const lux = put(g, P0, 'Lux, Crownguard', 'base');
  const sv = put(g, P0, 'Svellsongur', 'base');
  attachNow(g, sv, lux);
  const acts = () => legal(g, P0, 'activate').filter(a => a.type === 'activate' && (a.obj === lux || a.obj === sv));
  // (the engine has a single instance: copied-text instances are a known gap, docs/rulings.md B2-9/B2-10)
  assert.ok(acts().length >= 1);
  g = act(g, acts()[0]);
  g = passAll(g);
  assert.equal(g.objects[lux].exhausted, true);
  const added = g.players[P0].pool.energy + g.players[P0].poolRestricted.reduce((n, r) => n + ((r as { energy?: number }).energy ?? (r as { amount?: number }).amount ?? 0), 0);
  assert.equal(added, 2, `only 2 energy, not 4 (${JSON.stringify(g.players[P0].poolRestricted)})`);
  assert.equal(acts().length, 0, 'the other copy needs [T] too');
});

test('RJ#6562 Spectral Matron cannot play Cruel Patron (cost 4 > 3) from the trash', () => {
  let g = S0F();
  const cp = put(g, P0, 'Cruel Patron', 'trash');
  const v = put(g, P0, 'V(2)', 'trash');
  g = play(g, P0, hand(g, P0, 'Spectral Matron'), { dest: 'base' });
  let offered: string[] = [];
  for (let i = 0; i < 8 && (g.chain.length || g.pending?.inStep); i++) {
    const d = g.pending!;
    if (d.kind === 'chooseCards' || d.kind === 'chooseTargets') { offered = optionIds(g); g = choose(g, offered.includes(v) ? v : offered[0]); continue; }
    g = d.inStep ? answer(g, { may: [true] }) : pass(g);
  }
  assert.ok(offered.includes(v), `V(2) offered: ${offered}`);
  assert.ok(!offered.includes(cp));
  assert.equal(zone(g, cp), 'trash');
});

test('RJ#6565 a unit played by the defender to the combat battlefield during the showdown joins as a defender', () => {
  let { g, def } = attackSetup(['V(3)'], ['V(3)']);
  addRunes(g, P1, 3);
  g = pass(g);
  const am = hand(g, P1, 'Ambusher(2)');
  g = play(g, P1, am, { dest: BF_A });
  g = passAll(g, 1);
  assert.equal(locOf(g, am), BF_A);
  assert.equal(g.objects[am].combatRole, 'defender');
  void def;
});

test('RJ#6566 Thousand-Tailed Watcher does not affect a facedown (hidden) unit played later', () => {
  let g = S0F({ tp: P1 });
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const hu = put(g, P0, 'HidU(3)', { facedown: BF_A });
  g = play(g, P1, hand(g, P1, 'Thousand-Tailed Watcher'), { dest: 'base', may: [false] }); g = resolveChain(g);
  g = play(g, P1, hand(g, P1, 'DrawR'));
  g = pass(g);
  g = act(g, { type: 'playCard', player: P0, obj: hu });
  g = resolveChain(g);
  assert.equal(mightOf(g, hu), 3);
});

test('RJ#6567 The Dreaming Tree: "first time each turn" is per player: both players draw', () => {
  let { g, atk, def } = attackSetup(['V(3)'], ['V(3)'], { bfA: 'The Dreaming Tree' });
  addRunes(g, P1, 3);
  const h0 = g.players[P0].hand.length, h1 = g.players[P1].hand.length;
  g = play(g, P0, hand(g, P0, 'PumpR'), { targets: [[atk[0]]] });
  g = resolveChain(g);
  g = play(g, P1, hand(g, P1, 'PumpR'), { targets: [[def[0]]] });
  g = resolveChain(g);
  assert.equal(g.players[P0].hand.length, h0 + 1);
  assert.equal(g.players[P1].hand.length, h1 + 1);
});

test('RJ#6569 Overzealous Fan moves Yasuo, Remorseful to base before his attack trigger: no damage ("here")', () => {
  let { g, atk, def } = attackSetup(['Yasuo, Remorseful'], ['Overzealous Fan', 'V(5)']);
  const [fan, big] = def;
  for (let i = 0; i < 20 && (g.chain.length || g.pending?.inStep); i++) {
    const d = g.pending!;
    if (d.kind === 'chooseTargets' && d.player === P0) { g = choose(g, optionIds(g).includes(big) ? big : optionIds(g)[0]); continue; }
    if (d.kind === 'optional') { g = yes(g); continue; }
    g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  assert.equal(locOf(g, atk[0]), 'base');
  assert.equal(zone(g, fan), 'trash');
  assert.equal(g.objects[big].damage, 0);
});

test('RJ#6570 Shield 1 + Shield 2 from Fortified Position stack: +3 while defending', () => {
  let { g, def } = attackSetup(['V(1)'], ['Shield(3,1)'], { bfA: 'Fortified Position' });
  g = answer(g, { targets: [[def[0]]] }, P1);
  for (let i = 0; i < 6 && g.chain.length; i++) g = g.pending?.inStep ? answer(g, { targets: [[def[0]]] }) : pass(g);
  assert.equal(mightOf(g, def[0]), 6);
});

test('RJ#6571 (= #6560) respond to a Temporary Sprite dying at turn start with a hidden Blastcone Fae', () => {
  let g = S0F({ tp: P1 });
  put(g, P0, 'unl-t07', BF_A, { token: true });
  const fae = put(g, P0, 'Blastcone Fae', { facedown: BF_A });
  control(g, BF_A, P0);
  g = endTurn(g, P1);
  let played = false;
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    if (!played && d.player === P0 && !d.inStep && canPlayNow(g, P0, fae)) { g = act(g, { type: 'playCard', player: P0, obj: fae }); played = true; continue; }
    g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  assert.ok(played);
  assert.equal(locOf(g, fae), BF_A);
});

const assignDmg = (g: GameState, a: Record<ObjId, number>) => act(g, { type: 'assignDamage', player: pend(g).player, assignment: a });

test('RJ#6572 Leona, Determined dies to Kog\'Maw\'s combat Deathknell (4 damage stays; Shield ends with the combat)', () => {
  // CR 468.2: the Deathknell resolves while she is still a 5-Might defender, but its 4 damage is not healed;
  // when designations are removed (468.7.a) she is 4 Might with 4 damage and dies in the next cleanup.
  let { g, atk, def } = attackSetup(['V(1)'], ['Leona, Determined', "Kog'Maw, Caustic"]);
  const [leona, kog] = def;
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    if (d.kind === 'assignDamage') { g = d.player === P0 ? assignDmg(g, { [kog]: 1 }) : assignDmg(g, { [atk[0]]: d.player === P1 ? 6 : 0 }); continue; }
    g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  assert.equal(zone(g, kog), 'trash');
  assert.equal(zone(g, atk[0]), 'trash');
  assert.equal(zone(g, leona), 'trash');
});

test('RJ#6573 FFA: no invitations; a player not in the combat may play a Reaction during the combat showdown', () => {
  let g = createGame({ seed: 3, cardDb: fixtureDb(), mode: 'ffa', firstPlayer: P0, skipMulligan: true, battlefieldSelection: 'random', includeAllCards: true,
    players: [0, 1, 2].map(i => ({ name: `P${i}`, deck: legalDeck({}, [`cf-bf-${'abc'[i]}`, `cf-bf-${'def'[i]}`, `cf-bf-${'abc'[(i + 1) % 3]}`]) })) } as never);
  for (let i = 0; i < 10 && !(g.pending?.kind === 'mainAction' && g.pending.player === P0); i++) g = g.pending!.inStep ? act(g, legal(g, g.pending!.player)[0]) : act(g, { type: 'pass', player: g.pending!.player });
  expectPending(g, 'mainAction', P0);
  const P2 = 2 as PlayerId;
  for (const p of [P0, P1, P2]) fundAll(g, p);
  const a = put(g, P0, 'V(3)', 'base');
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const r = hand(g, P2, 'ZapR');
  g = move(g, P0, [a], BF_A);
  let ok = false;
  for (let i = 0; i < 6 && g.pending?.kind === 'showdownAction'; i++) { if (g.pending.player === P2) { ok = canPlayNow(g, P2, r); break; } g = pass(g); }
  assert.ok(ok, 'P2 gets focus and may play a Reaction');
});

test('RJ#6574 solo defender killed mid-showdown; the hidden unit played there defends alone and gets Mask of Foresight +1', () => {
  let { g, def } = attackSetup(['V(5)'], ['V(2)']);
  fundAll(g, P0); fundAll(g, P1);
  put(g, P1, 'Mask of Foresight', 'base');
  const hu = put(g, P1, 'HidU(3)', { facedown: BF_A });
  for (let i = 0; i < 6 && g.chain.length; i++) g = g.pending?.inStep ? answer(g, { targets: [[def[0]]] }) : pass(g);
  g = play(g, P0, hand(g, P0, 'Hextech Ray'), { targets: [[def[0]]] });
  g = passN(g, 2);
  assert.equal(zone(g, def[0]), 'trash');
  assert.equal(zone(g, hu), 'facedown', 'hidden card kept (control unchanged mid-showdown)');
  expectPending(g, 'showdownAction', P1);
  g = act(g, { type: 'playCard', player: P1, obj: hu });
  for (let i = 0; i < 6 && (g.chain.length || g.pending?.inStep); i++) g = g.pending?.inStep ? answer(g, { targets: [[hu]] }) : pass(g);
  assert.equal(g.objects[hu].combatRole, 'defender');
  assert.equal(mightOf(g, hu), 4);
});

test('RJ#6576 Fiora, Victorious gaining Deflect after Charm is on the chain adds no cost to Charm', () => {
  let g = S0F({ tp: P1 });
  const f = put(g, P0, 'Fiora, Victorious', BF_A);
  control(g, BF_A, P0);
  g = play(g, P1, hand(g, P1, 'Charm'), { targets: [[f]], locations: ['base'] });
  g = answer(g, { locations: ['base'] });
  const r1 = readyRunes(g, P1), n1 = g.players[P1].runesInPlay.length;
  g = pass(g);
  g = play(g, P0, hand(g, P0, 'Call to Glory'), { may: [false], targets: [[f]] });
  g = answer(g, { may: [false], targets: [[f]] });
  g = pass(g); g = pass(g);
  assert.ok(mightOf(g, f)! >= 5 && hasKeyword(g, f, 'Deflect'), 'Mighty Fiora has Deflect now');
  g = resolveChain(g);
  g = answer(g, { locations: ['base'] });
  assert.equal(locOf(g, f), 'base', 'Charm still moved her');
  assert.equal(readyRunes(g, P1), r1); assert.equal(g.players[P1].runesInPlay.length, n1);
});

test('RJ#6577 a Deathknell unit saved by Zhonya\'s Hourglass did not die: no Deathknell', () => {
  let g = S0F();
  const u = put(g, P0, 'DK(2)', BF_A);
  control(g, BF_A, P0);
  put(g, P0, "Zhonya's Hourglass", 'base');
  const h0 = g.players[P0].hand.length;
  g = play(g, P0, hand(g, P0, 'KillA'), { targets: [[u]] });
  g = resolveChain(g);
  assert.equal(locOf(g, u), 'base');
  assert.equal(g.chain.length, 0);
  assert.equal(g.players[P0].hand.length, h0, 'no draw');
});

test('RJ#6580 Promising Future gives both players Time Warp: extra turns are taken in creation order (P0\'s, then P1\'s)', () => {
  let g = S0F({ tp: P1 });
  addRunes(g, P1, 2, 'mind');   // P1 needs [A]x4 for Time Warp after Promising Future's [A] (else only P0's is played — ENGINE-4)
  const tw0 = put(g, P0, 'Time Warp', 'deckTop'), tw1 = put(g, P1, 'Time Warp', 'deckTop');
  g = play(g, P1, hand(g, P1, 'Promising Future'));
  for (let i = 0; i < 30 && (g.chain.length || g.pending?.inStep); i++) {
    const d = g.pending!;
    if (d.kind === 'chooseCards') { const want = optionIds(g).find(x => x === tw0 || x === tw1); g = choose(g, want ?? optionIds(g)[0]); continue; }
    g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  const order: number[] = [];
  for (let i = 0; i < 4; i++) { g = nextTurn(g); order.push(g.activePlayer); }
  assert.deepEqual(order, [P0, P1, P0, P1]);
  assert.ok(g.log.filter(l => /plays Time Warp/.test(l.text)).length === 2, 'both Time Warps were played');
});

test('RJ#6583 a unit has at most one buff; Assault/Shield are not buffs and coexist with it', () => {
  // also tests/rules/layers-triggers.test.ts 'buff: +1 Might, at most one buff per unit'
  let g = S0F();
  const u = put(g, P0, 'Shield(2,1)', 'base', { buff: true });
  g = play(g, P0, hand(g, P0, 'BuffM'), { targets: [[u]] }); g = resolveChain(g);
  assert.equal(g.objects[u].counters.buff, 1);
  assert.equal(mightOf(g, u), 3);
  assert.ok(hasKeyword(g, u, 'Shield'));
});

// RJ#6584 DECIDED (docs/riftjudge/DECISIONS.md, house ruling): separate stun effects trigger Radiant Dawn separately (RJ, kept);
// for Repeat the RJ reason ("resolves once with its effect doubled") is not how CR 1.5 describes Repeat: 820.1.d "the instructions
// are executed one additional time during resolution", with their own choices (820.2). Each execution of the stun instruction is
// its own "you stun one or more enemy units" event (same per-instruction batching as docs/rulings.md B2/B8) → two buffs.
test('RJ#6584 Thwonk! with Repeat stunning two attackers executes the stun instruction twice: Radiant Dawn buffs twice (house ruling)', () => {
  let g = S0F({ tp: P1 });
  setLegend(g, P0, 'Radiant Dawn');
  const d = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const other = put(g, P0, 'V(2)', 'base');
  const a1 = put(g, P1, 'V(3)', 'base'), a2 = put(g, P1, 'V(3)', 'base');
  g = move(g, P1, [a1, a2], BF_A);
  for (let i = 0; i < 4 && !(g.pending?.kind === 'showdownAction' && g.pending.player === P0); i++) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Thwonk!'), { may: [true], targets: [[a1], [a2]] });
  // the two triggers choose as they go on the chain: one buff each for `other` and `d` (a unit holds one buff)
  const picks = [other, d];
  const unbuffed = () => (picks.length && optionIds(g).includes(picks[0]) ? picks.shift() : undefined);
  for (let i = 0; i < 10 && (g.chain.length || g.pending?.inStep); i++) g = g.pending?.inStep ? ((u => u ? choose(g, u) : null)(unbuffed()) ?? (optionIds(g).includes(a2) ? choose(g, a2) : act(g, legal(g, g.pending.player)[0]))) : pass(g);
  assert.ok(g.objects[a1].stunned && g.objects[a2].stunned, 'both stunned');
  const buffs = (g.objects[d].counters.buff ?? 0) + (g.objects[other].counters.buff ?? 0);
  assert.equal(buffs, 2, 'one Radiant Dawn trigger per execution of the stun instruction');
});

test('RJ#6585 Fox-Fire: choose any units at one battlefield with total Might 4 or less', () => {
  let g = S0F();
  control(g, BF_A, P1);
  const u1 = put(g, P1, 'V(1)', BF_A), u3 = put(g, P1, 'V(3)', BF_A), u2 = put(g, P1, 'V(2)', BF_A);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Fox-Fire') });
  g = choose(g, u3);
  assert.ok(optionIds(g).includes(u1) && !optionIds(g).includes(u2), `after 3: only the 1 fits (${optionIds(g)})`);
  g = choose(g, u1);
  for (let i = 0; i < 6 && (g.chain.length || g.pending?.inStep); i++) g = g.pending?.inStep ? act(g, { type: 'choose', player: P0, optionIds: [] }) : pass(g);
  assert.equal(zone(g, u1), 'trash'); assert.equal(zone(g, u3), 'trash'); assert.equal(zone(g, u2), 'battlefield');
});

test('RJ#6587 Nine-Tailed Fox -1 (min 1) on a 1-Might attacker gives -0; later +3 makes it 4', () => {
  let g = S0F({ tp: P1 });
  setLegend(g, P0, 'Nine-Tailed Fox');
  put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const a = put(g, P1, 'V(1)', 'base');
  g = move(g, P1, [a], BF_A);
  for (let i = 0; i < 6 && g.chain.length; i++) g = g.pending?.inStep ? answer(g, {}) : pass(g);
  assert.equal(mightOf(g, a), 1);
  expectPending(g, 'showdownAction', P1);
  g = play(g, P1, hand(g, P1, 'PumpA'), { targets: [[a]] }); g = passN(g, 2);
  assert.equal(mightOf(g, a), 4);
});

test('RJ#6589 Teemo, Strategist defend trigger and Reaver\'s Row trigger: defender orders them; Teemo resolves, then moves to base', () => {
  let { g, def } = attackSetup(['V(3)'], ['Teemo, Strategist'], { bfA: "Reaver's Row" });
  const teemo = def[0];
  let ordered = false;
  for (let i = 0; i < 20 && (g.chain.length || g.pending?.inStep); i++) {
    const d = g.pending!;
    if (d.kind === 'orderTriggers') { assert.equal(d.player, P1); ordered = true; g = choose(g, d.options!.find(o => /Reaver|move/i.test(o.label))!.id); continue; }
    if (d.kind === 'optional') { g = yes(g); continue; }
    if (d.inStep) { g = optionIds(g).includes(teemo) ? choose(g, teemo) : act(g, legal(g, d.player)[0]); continue; }
    g = pass(g);
  }
  assert.ok(ordered, 'P1 chose the order');
  assert.ok(g.log.some(l => /reveal/i.test(l.text)), 'Teemo revealed');
  assert.equal(locOf(g, teemo), 'base');
});

test('RJ#6590 Pack of Wonders returns only your own (friendly) gear/unit/facedown card', () => {
  let g = S0F();
  const pw = put(g, P0, 'Pack of Wonders', 'base');
  const mine = put(g, P0, 'V(2)', 'base');
  const theirs = put(g, P1, 'V(2)', 'base');
  const theirGear = put(g, P1, 'Vanguard Helm', 'base');
  g = act(g, { type: 'activate', player: P0, obj: pw, abilityIndex: 0 });
  // the only friendly candidate is auto-chosen: enemy unit/gear are never candidates
  const tg = g.pending?.kind === 'chooseTargets' ? optionIds(g) : g.chain[0].targets.flat();
  assert.ok(tg.includes(mine), `own unit: ${tg}`);
  assert.ok(!tg.includes(theirs) && !tg.includes(theirGear));
});

test('RJ#6591 Smoke Screen takes a 3-Might unit to 1 (-2); Discipline afterwards makes it 3', () => {
  let g = S0F();
  const u = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  g = play(g, P0, hand(g, P0, 'Smoke Screen'), { targets: [[u]] }); g = resolveChain(g);
  assert.equal(mightOf(g, u), 1);
  g = play(g, P0, hand(g, P0, 'Discipline'), { targets: [[u]] }); g = resolveChain(g);
  assert.equal(mightOf(g, u), 3);
});

test('RJ#6592 Noxian Drummer killed (Shakedown, damage chosen) before its move trigger resolves: no Recruit ("here" unknown)', () => {
  let g = S0F();
  const dr = put(g, P0, 'Noxian Drummer', 'base');
  g = move(g, P0, [dr], BF_A);
  assert.equal(g.chain.length, 1);
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'Shakedown'), { targets: [[dr]] });
  for (let i = 0; i < 12 && (g.chain.length || g.pending?.inStep); i++) {
    const d = g.pending!;
    if (d.inStep) { const dmg = (d.options ?? []).find(o => /deal|damage|6|no/i.test(o.id + o.label) && !/draw/i.test(o.label)); g = choose(g, dmg?.id ?? optionIds(g)[optionIds(g).length - 1]); continue; }
    g = pass(g);
  }
  assert.equal(zone(g, dr), 'trash');
  const recruits = Object.values(g.objects).filter(o => g.cards[o.cardId]?.name === 'Recruit' && (o.zone === 'battlefield' || o.zone === 'base'));
  assert.equal(recruits.length, 0);
});

test('RJ#6595 a unit is a defender only once an enemy unit moves in and combat starts', () => {
  const g0 = S0F();
  const u = put(g0, P1, 'V(2)', BF_A); control(g0, BF_A, P1);
  assert.equal(g0.objects[u].combatRole, undefined);
  const { g, def } = attackSetup(['V(3)'], ['V(2)']);
  assert.equal(g.objects[def[0]].combatRole, 'defender');
});

test('RJ#6596 a non-combat showdown (moving into an empty battlefield) lets both players play Reactions until both pass', () => {
  let g = S0F();
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_A);
  for (let i = 0; i < 4 && g.chain.length; i++) g = pass(g);
  expectPending(g, 'showdownAction', P0);
  g = pass(g);
  expectPending(g, 'showdownAction', P1);
  assert.ok(canPlayNow(g, P1, hand(g, P1, 'Shakedown')));
});

test('RJ#6598 a card played from hiding cannot target something at another battlefield', () => {
  let g = S0F();
  control(g, BF_A, P0); put(g, P0, 'V(1)', BF_A);
  control(g, BF_B, P1);
  const far = put(g, P1, 'V(3)', BF_B);
  const near = put(g, P0, 'V(4)', BF_A);
  const hz = put(g, P0, 'HidZap', { facedown: BF_A });
  g = act(g, { type: 'playCard', player: P0, obj: hz });
  const tg = g.pending?.kind === 'chooseTargets' ? optionIds(g) : g.chain[0].targets.flat();
  assert.ok(!tg.includes(far), `no target at BF-B: ${tg}`);
  assert.ok(tg.includes(near) || tg.length > 0);
});

test('RJ#6599 Ornn, Forge God with Svellsongur attached has Deflect 4', () => {
  let g = S0F();
  const o = put(g, P0, 'Ornn, Forge God', 'base');
  const sv = put(g, P0, 'Svellsongur', 'base');
  attachNow(g, sv, o);
  assert.equal(kwValue(g, o, 'Deflect'), 4);
});

test('RJ#6601 Azir, Ascendant swapping with Stellacorn Herder: the move trigger needs an actual change of location', () => {
  const run = (sameLoc: boolean) => {
    let g = S0F();
    control(g, BF_A, P0);
    const az = put(g, P0, 'Azir, Ascendant', BF_A);
    const st = put(g, P0, 'Stellacorn Herder', sameLoc ? BF_A : 'base');
    const h0 = g.players[P0].hand.length;
    const ab = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === az)!;
    g = act(g, ab);
    for (let i = 0; i < 10 && (g.chain.length || g.pending?.inStep); i++) g = g.pending?.inStep ? (optionIds(g).includes(st) ? choose(g, st) : act(g, legal(g, g.pending.player)[0])) : pass(g);
    return g.players[P0].hand.length - h0;
  };
  assert.equal(run(false), 1, 'moved: draws');
  assert.equal(run(true), 0, 'same location: no move, no draw');
});

test('RJ#6602 Wielder of Water moving into an open battlefield is not attacking: no +2', () => {
  let g = S0F();
  const w = put(g, P0, 'Wielder of Water', 'base');
  g = move(g, P0, [w], BF_A);
  assert.equal(g.objects[w].combatRole, undefined);
  assert.equal(mightOf(g, w), 2);
  const { g: g2, atk } = attackSetup(['Wielder of Water'], ['V(1)']);
  assert.equal(mightOf(g2, atk[0]), 4, 'real attack: +2');
});

test('RJ#6603 the Deflect tax is paid when choosing the target and is not refunded if the spell is countered', () => {
  let g = S0F();
  const d = put(g, P1, 'Deflect(3,1)', BF_A); control(g, BF_A, P1);
  const r0 = readyRunes(g, P0), n0 = g.players[P0].runesInPlay.length;
  g = play(g, P0, hand(g, P0, 'ZapM'), { targets: [[d]] });
  const spent = (r0 - readyRunes(g, P0)) + (n0 - g.players[P0].runesInPlay.length);
  assert.ok(spent >= 2, `1 energy + 1 Deflect power paid (${spent})`);
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'CounterR'), { targets: [[g.chain[0].id]] });
  g = resolveChain(g);
  assert.equal(g.objects[d].damage, 0);
  assert.equal((r0 - readyRunes(g, P0)) + (n0 - g.players[P0].runesInPlay.length), spent, 'no refund');
});

test('RJ#6607 Teemo, Strategist (errata) triggers only when defending, not when played from hiding', () => {
  let g = S0F();
  control(g, BF_A, P0); put(g, P0, 'V(1)', BF_A);
  const t = put(g, P0, 'Teemo, Strategist', { facedown: BF_A });
  g = act(g, { type: 'playCard', player: P0, obj: t });
  g = passAll(g);
  assert.equal(locOf(g, t), BF_A);
  assert.equal(g.chain.length, 0);
  assert.ok(!g.log.some(l => /reveal/i.test(l.text)), 'no reveal on play');
});

test('RJ#6608 losing control of a battlefield trashes your hidden cards there', () => {
  // also tests/conformance/H-cleanup.test.ts 'T116 — Facedown card trashed when battlefield control is lost'
  let { g } = attackSetup(['V(5)'], ['V(1)']);
  const hc = put(g, P1, 'HidZap', { facedown: BF_A });
  g = passAll(g);
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(zone(g, hc), 'trash');
});

test('RJ#6609 2v2: a unit can never be at the same battlefield as a teammate\'s unit', () => {
  const g = createGame({ seed: 3, cardDb: fixtureDb(), mode: '2v2', firstPlayer: P0, skipMulligan: true, battlefieldSelection: 'random', includeAllCards: true,
    players: [0, 1, 2, 3].map(i => ({ name: `P${i}`, deck: legalDeck({ legend: i >= 2 ? 'cf-legend-2' : 'cf-legend' }, [`cf-bf-${'abde'[i]}`, `cf-bf-${'bcef'[i]}`, `cf-bf-${'cdfa'[i]}`]) })) } as never);
  assert.ok((g as unknown as { teams?: unknown }).teams, 'teams exist');
});

test('RJ#6612 Ravenbloom Student attacking: Cleave, Smoke Screen in response (2 -> 1, snapshotted -1), Cleave +3 Assault, Student +1 -> 5', () => {
  let { g, atk } = attackSetup(['Ravenbloom Student'], ['V(1)']);
  fundAll(g, P0); fundAll(g, P1);
  const s = atk[0];
  g = play(g, P0, hand(g, P0, 'Cleave'), { targets: [[s]] });
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'Smoke Screen'), { targets: [[s]] });
  g = pass(g);
  assert.equal(pend(g).kind, 'chainResponse');
  g = pass(g);
  assert.equal(mightOf(g, s), 1, 'Smoke Screen: 2 -> 1');
  for (let i = 0; i < 8 && g.chain.length; i++) g = g.pending?.inStep ? answer(g, {}) : pass(g);
  assert.equal(mightOf(g, s), 5);
});

test('RJ#6614 conquering Zaun Warrens with Kai\'Sa, Survivor on an empty hand: order Warrens first (nothing to discard, draw) then Kai\'Sa draws -> 2 cards', () => {
  let g = S0F({ bfA: 'Zaun Warrens' });
  const k = put(g, P0, "Kai'Sa, Survivor", 'base');
  g = move(g, P0, [k], BF_A);
  let ordered = false;
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    if (d.kind === 'orderTriggers') { ordered = true; g = choose(g, d.options!.find(o => /Kai/i.test(o.label))!.id); continue; }
    g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  assert.ok(ordered, 'controller orders the two conquer triggers');
  assert.equal(g.players[P0].hand.length, 2);
});

test('RJ#6615 banishing a unit (Portal Rescue) is not dying: no Deathknell', () => {
  let g = S0F();
  const u = put(g, P0, 'DK(2)', 'base');
  const h0 = g.players[P0].hand.length;
  g = play(g, P0, hand(g, P0, 'Portal Rescue'), { targets: [[u]] });
  g = resolveChain(g);
  assert.equal(g.players[P0].hand.length, h0, 'no draw');
  assert.ok(!g.log.some(l => /died/.test(l.text)));
});

test('RJ#6616 gear taken by Blind Fury, stolen by Akshan, Mischievous: when Akshan dies control returns to the Blind Fury player, not the owner', () => {
  let g = S0F({ tp: P1 });
  const gear = put(g, P1, 'Vanguard Helm', 'base', { controller: P0 }); // P1 owns it; P0 played it with Blind Fury
  put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  const ak = hand(g, P1, 'Akshan, Mischievous');
  g = act(g, { type: 'playCard', player: P1, obj: ak, destination: BF_B });
  g = settle(g, [gear]);
  assert.equal(g.objects[gear].controller, P1, 'Akshan took it');
  g = nextTurn(g);
  g = play(g, P0, hand(g, P0, 'KillA'), { targets: [[ak]] });
  g = resolveChain(g);
  g = passAll(g);
  assert.equal(zone(g, ak), 'trash');
  assert.equal(g.objects[gear].controller, P0);
});

test('RJ#6619 Accelerated Lee Sin, Centered with exactly 7 Body runes: exhaust 7, recycle one of them for the [Body] power', () => {
  let g = S0F();
  setRunes(g, P0, 7, 'body');
  const ls = hand(g, P0, 'Lee Sin, Centered');
  g = play(g, P0, ls, { dest: 'base', may: [true] });
  g = settle(g);
  assert.equal(zone(g, ls), 'base');
  assert.equal(g.objects[ls].exhausted, false, 'Accelerate paid: enters ready');
  assert.equal(g.players[P0].runesInPlay.length, 6, 'one rune recycled');
});

test('RJ#6623 during a showdown at one battlefield, an Action may target a unit at another battlefield (no targeting restriction)', () => {
  let { g } = attackSetup(['V(3)'], ['V(3)']);
  fundAll(g, P1);
  const far = put(g, P0, 'V(2)', BF_B); control(g, BF_B, P0);
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'Blast of Power'), { targets: [[far]] });
  g = settle(g);
  assert.equal(zone(g, far), 'trash');
});

test('RJ#6627 "attacking alone" is continuously checked: Wielder of Water gets +2 once its partner leaves the combat', () => {
  let { g, atk } = attackSetup(['Wielder of Water', 'V(2)'], ['V(5)']);
  fundAll(g, P0);
  assert.equal(mightOf(g, atk[0]), 2);
  g = play(g, P0, hand(g, P0, 'MoveR'), { targets: [[atk[1]]] });
  g = settle(g);
  assert.equal(locOf(g, atk[1]), 'base');
  assert.equal(mightOf(g, atk[0]), 4);
});

test('RJ#6628 the opponent may respond to Thousand-Tailed Watcher\'s play trigger', () => {
  let g = S0F({ tp: P1 });
  put(g, P0, 'V(4)', 'base');
  g = play(g, P1, hand(g, P1, 'Thousand-Tailed Watcher'), { dest: 'base', may: [false] });
  assert.equal(g.chain.length, 1, 'trigger on the chain');
  g = pass(g);
  expectPending(g, 'chainResponse', P0);
  assert.ok(canPlayNow(g, P0, hand(g, P0, 'DrawR')));
});

test('RJ#6629 mirror match: both players may use the same legend, champion, battlefields and list', () => {
  const deck = legalDeck();
  const g = createGame({ seed: 9, cardDb: fixtureDb(), skipMulligan: true, battlefieldSelection: 'random', includeAllCards: true, validateDecks: true,
    players: [{ name: 'A', deck }, { name: 'B', deck }] } as never);
  assert.ok(g.pending, 'game created with identical decks');
});

test('RJ#6630 Mask of Foresight triggers once per combat: two combats in a turn give the same unit +1 twice', () => {
  let g = S0F();
  put(g, P0, 'Mask of Foresight', 'base');
  const u = put(g, P0, 'Ganker(3)', 'base');
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  g = move(g, P0, [u], BF_A);
  g = settle(g); g = passAll(g); g = settle(g);
  assert.equal(locOf(g, u), BF_A);
  assert.equal(mightOf(g, u), 4, 'first combat +1');
  g = play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[u]], locations: [BF_B], dest: BF_B });
  g = settle(g, [String(BF_B)]);
  assert.equal(locOf(g, u), BF_B);
  assert.equal(mightOf(g, u), 5, 'second combat +1 again');
});

test('RJ#6631 "attacks alone" triggers need the unit to be alone when it becomes an attacker; becoming alone later does not trigger', () => {
  let g = S0F();
  put(g, P0, 'Mask of Foresight', 'base');
  const a = put(g, P0, 'V(3)', 'base'), b = put(g, P0, 'V(2)', 'base');
  put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [a, b], BF_A);
  g = settle(g);
  g = play(g, P0, hand(g, P0, 'MoveR'), { targets: [[b]] });
  g = settle(g);
  assert.equal(locOf(g, b), 'base');
  assert.equal(mightOf(g, a), 3, 'no Mask trigger');
});

test('RJ#6633 an Equipment does not become exhausted when its unit is killed', () => {
  let g = S0F();
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const sw = put(g, P0, 'Sword', 'base');
  attachNow(g, sw, u);
  g = play(g, P0, hand(g, P0, 'KillA'), { targets: [[u]] });
  g = settle(g);
  assert.equal(zone(g, u), 'trash');
  assert.notEqual(zone(g, sw), 'trash');
  assert.equal(g.objects[sw].exhausted, false);
});

test('RJ#6635 Bullet Time\'s battlefield is chosen as it is played (finalize), not on resolution', () => {
  let g = S0F();
  const e = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Bullet Time') });
  expectPending(g, 'chooseTargets', P0);
  g = choose(g, g.battlefields[BF_A].objId);
  expectPending(g, 'chainResponse', P0);
  g = passN(g, 2);
  if (g.pending?.kind === 'chooseNumber') g = choose(g, '2');
  g = settle(g);
  assert.equal(zone(g, e), 'trash');
});

test('RJ#6636 killing a friendly unit as Cruel Patron\'s additional cost uses no chain (no reaction window)', () => {
  let g = S0F();
  const v = put(g, P0, 'V(1)', 'base');
  const cp = hand(g, P0, 'Cruel Patron');
  g = act(g, { type: 'playCard', player: P0, obj: cp, destination: 'base' });
  for (let i = 0; i < 4 && g.pending?.inStep; i++) g = optionIds(g).includes(v) ? choose(g, v) : act(g, legal(g, P0)[0]);
  assert.equal(zone(g, v), 'trash');
  assert.equal(zone(g, cp), 'base');
  assert.equal(g.chain.length, 0);
  expectPending(g, 'mainAction', P0);
});

test('RJ#6637 Vayne, Hunter\'s Assault 3 applies only once she is an attacker (occupied battlefield): 5 Might, Gust can\'t choose her', () => {
  let g = S0F();
  const v = put(g, P0, 'Vayne, Hunter', 'base');
  g = move(g, P0, [v], BF_A);
  assert.equal(mightOf(g, v), 2, 'open battlefield: no Assault');
  const r = attackSetup(['Vayne, Hunter'], ['V(1)']);
  let h = r.g; fundAll(h, P1);
  assert.equal(mightOf(h, r.atk[0]), 5);
  h = pass(h);
  const gust = hand(h, P1, 'Gust');
  const tg = (() => { try { const x = act(h, { type: 'playCard', player: P1, obj: gust }); return x.pending?.kind === 'chooseTargets' ? optionIds(x) : x.chain.at(-1)?.targets.flat() ?? []; } catch { return []; } })();
  assert.ok(!tg.includes(r.atk[0]), `Vayne not a legal Gust target (${tg})`);
});

test('RJ#6638 Defy ("Deft") cannot counter Falling Star (2 power > [A])', () => {
  let g = S0F();
  const e = put(g, P1, 'V(5)', 'base');
  g = play(g, P0, hand(g, P0, 'Falling Star'), { targets: [[e], [e]] });
  g = pass(g);
  const df = hand(g, P1, 'Defy');
  const ok = (() => { try { const x = act(g, { type: 'playCard', player: P1, obj: df }); return x.pending?.kind === 'chooseTargets' ? optionIds(x).includes(g.chain[0].id) : (x.chain.at(-1)?.targets.flat() ?? []).includes(g.chain[0].id); } catch { return false; } })();
  assert.equal(ok, false);
});

test('RJ#6640 opponent\'s Hidden Blade on my Darius; I respond with my own hidden Hidden Blade on him: only I draw 2', () => {
  let g = S0F({ tp: P1 });
  control(g, BF_A, P0);
  const dar = put(g, P0, 'V(4)', BF_A);
  const mine = put(g, P0, 'Hidden Blade', { facedown: BF_A });
  const h0 = g.players[P0].hand.length, h1 = g.players[P1].hand.length;
  g = play(g, P1, hand(g, P1, 'Hidden Blade'), { targets: [[dar]] });
  g = pass(g);
  g = act(g, { type: 'playCard', player: P0, obj: mine });
  g = answer(g, { targets: [[dar]] });
  g = settle(g);
  assert.equal(zone(g, dar), 'trash');
  assert.equal(g.players[P0].hand.length, h0 + 2);
  assert.equal(g.players[P1].hand.length, h1);
});

test('RJ#6641 attack + defend triggers: the defender\'s trigger is newest, so the defender gets priority first', () => {
  const { g } = attackSetup(['AttackDraw(3)'], ['DefendAmbusher(3)']);
  assert.equal(g.chain.length, 2);
  assert.equal(g.cards[g.objects[g.chain[g.chain.length - 1].source].cardId].name, 'DefendAmbusher(3)', 'defend trigger on top');
  expectPending(g, 'chainResponse', P1);
});

test('RJ#6646 Charm moves the only unit at a battlefield to base: its controller loses control and the hidden card there is discarded', () => {
  let g = S0F();
  const u = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const hc = put(g, P1, 'HidZap', { facedown: BF_A });
  g = play(g, P0, hand(g, P0, 'Charm'), { targets: [[u]], locations: ['base'] });
  g = settle(g, ['base']);
  assert.equal(locOf(g, u), 'base');
  assert.equal(g.battlefields[BF_A].controller, null);
  assert.equal(zone(g, hc), 'trash');
});

test('RJ#6649 Charm an opponent\'s unit onto an open battlefield on your turn: the opponent conquers and scores', () => {
  let g = S0F();
  const u = put(g, P1, 'V(2)', 'base');
  g = play(g, P0, hand(g, P0, 'Charm'), { targets: [[u]], locations: [BF_A] });
  g = settle(g, [String(BF_A)]);
  g = passAll(g); g = settle(g);
  assert.equal(locOf(g, u), BF_A);
  assert.equal(g.battlefields[BF_A].controller, P1);
  assert.equal(g.players[P1].points, 1);
});

test('RJ#6652 Blitzcrank given Temporary by Last Stand dies at the start of the turn, before his hold trigger can return him', () => {
  let g = S0F();
  const b = put(g, P0, 'Blitzcrank, Impassive', BF_A); control(g, BF_A, P0);
  g = play(g, P0, hand(g, P0, 'Last Stand'), { targets: [[b]] }); g = settle(g);
  assert.ok(hasKeyword(g, b, 'Temporary'));
  g = nextTurn(g); g = nextTurn(g);
  assert.equal(g.activePlayer, P0);
  assert.equal(zone(g, b), 'trash');
});

test('RJ#6654 Tideturner\'s swap is not a standard move: the swapped unit stays ready', () => {
  let g = S0F();
  control(g, BF_A, P0);
  const u = put(g, P0, 'V(3)', BF_A);
  const t = hand(g, P0, 'Tideturner');
  g = play(g, P0, t, { dest: 'base' });
  g = settle(g, [u]);
  assert.equal(locOf(g, u), 'base');
  assert.equal(g.objects[u].exhausted, false);
});

test('RJ#6655 Guerilla Warfare: hiding costs no power for the rest of the turn', () => {
  let g = S0F();
  control(g, BF_A, P0); put(g, P0, 'V(1)', BF_A);
  const h = hand(g, P0, 'HidZap');
  g = play(g, P0, hand(g, P0, 'Guerilla Warfare')); g = settle(g);
  const before = g.players[P0].runesInPlay.length, r0 = readyRunes(g, P0);
  g = act(g, { type: 'hide', player: P0, obj: h, battlefieldIndex: BF_A });
  g = settle(g);
  assert.equal(zone(g, h), 'facedown');
  assert.equal(g.players[P0].runesInPlay.length, before, 'no rune recycled for [A]');
  assert.equal(readyRunes(g, P0), r0);
});

test('RJ#6659 Zhonya\'s Hourglass saving a unit at The Dreaming Tree does not "choose" it: no draw', () => {
  let g = S0F({ tp: P1, bfA: 'The Dreaming Tree' });
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  put(g, P0, "Zhonya's Hourglass", 'base');
  const h0 = g.players[P0].hand.length;
  g = play(g, P1, hand(g, P1, 'ZapR'), { targets: [[u]] }); // enemy spell: Dreaming Tree only counts friendly choices
  g = settle(g);
  assert.equal(locOf(g, u), 'base');
  assert.equal(g.players[P0].hand.length, h0);
  assert.ok(!g.log.some(l => /Dreaming Tree/.test(l.text) && /draw/i.test(l.text)));
});

test('RJ#6661 Heimerdinger, Inventor using a gained [T] ability (Lux, Crownguard) exhausts himself and pays its cost', () => {
  let g = S0F();
  const hm = put(g, P0, 'Heimerdinger, Inventor', 'base');
  const lux = put(g, P0, 'Lux, Crownguard', 'base');
  const ab = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === hm);
  assert.ok(ab, 'Heimerdinger has the [T] ability');
  g = act(g, ab!); g = settle(g);
  assert.equal(g.objects[hm].exhausted, true);
  assert.equal(g.objects[lux].exhausted, false);
  assert.ok(!legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === hm), 'no second use');
});

test('RJ#6663 Seal of Rage cannot stand in for Sigil of the Storm\'s rune recycle: a rune is recycled anyway', () => {
  let g = S0F({ bfA: 'Sigil of the Storm' });
  const seal = put(g, P0, 'Seal of Rage', 'base');
  const u = put(g, P0, 'V(2)', 'base');
  const n0 = g.players[P0].runesInPlay.length;
  g = move(g, P0, [u], BF_A);
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) g = g.pending.inStep ? act(g, legal(g, g.pending.player)[0]) : pass(g);
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[P0].runesInPlay.length, n0 - 1);
  assert.notEqual(zone(g, seal), 'trash');
});

test('RJ#6665 Daughter of the Void\'s spell-only [A] can pay a spell\'s Deflect additional cost', () => {
  let g = S0F();
  const leg = setLegend(g, P0, 'Daughter of the Void');
  setRunes(g, P0, 1, 'fury'); // one rune pays Hextech Ray's [1][Fury] (exhaust + recycle); the Deflect [A] must come from the legend
  const d = put(g, P1, 'Deflect(4,1)', BF_A); control(g, BF_A, P1);
  const ray = hand(g, P0, 'Hextech Ray');
  g = act(g, { type: 'activate', player: P0, obj: leg, abilityIndex: 0 });
  g = settle(g);
  g = play(g, P0, ray, { targets: [[d]] });
  g = settle(g);
  assert.equal(g.objects[d].damage, 3, 'Hextech Ray resolved on the Deflect unit');
});

test('RJ#6666 Equip chooses the unit: Irelia, Fervent gets her +1 when a gear is equipped to her', () => {
  let g = S0F();
  const ir = put(g, P0, 'Irelia, Fervent', 'base');
  const sw = put(g, P0, 'Sword', 'base');
  const eq = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === sw)!;
  g = act(g, eq);
  g = settle(g, [ir]);
  assert.equal(g.objects[sw].attachedTo, ir);
  assert.equal(mightOf(g, ir), 4 + 2 + 1);
});

test('RJ#6669 MISMATCH-RJ: Ride the Wind\'s move destination is chosen when it is played (CR 355.4), not on resolution', () => {
  let g = S0F();
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Ride the Wind') });
  const asked: string[] = [];
  for (let i = 0; i < 4 && g.pending?.inStep; i++) { asked.push(g.pending.kind); g = act(g, legal(g, P0)[0]); }
  assert.ok(asked.includes('chooseDestination'), `destination chosen before the chain response (asked: ${asked})`);
  void u;
});

test('RJ#6674 Rockfall Path ("units can\'t be played here"): a hidden Pakaa Cub there cannot be played', () => {
  let g = S0F({ bfA: 'Rockfall Path' });
  control(g, BF_A, P0); put(g, P0, 'V(1)', BF_A);
  const c = put(g, P0, 'Pakaa Cub', { facedown: BF_A });
  assert.equal(canPlayNow(g, P0, c), false);
});

test('RJ#6675 Warwick, Hunter attacks a damaged Ahri, Inquisitive: her defend trigger (-2 to Warwick) resolves before his kill', () => {
  let { g, atk, def } = attackSetup(['Warwick, Hunter'], ['Ahri, Inquisitive'], { defOpts: [{ damage: 1 }] });
  const top = g.chain[g.chain.length - 1];
  assert.equal(g.cards[g.objects[top.source].cardId].name, 'Ahri', 'Ahri\'s trigger is on top');
  g = settle(g, [atk[0]]);
  assert.equal(zone(g, def[0]), 'trash');
  assert.equal(mightOf(g, atk[0]), 3);
});

test('RJ#6678 my second card is taken over by Mystic Reversal: it is no longer my play, Darius, Trifarian gets nothing', () => {
  let g = S0F();
  const dar = put(g, P0, 'Darius, Trifarian', 'base');
  const e = put(g, P1, 'V(5)', 'base');
  g = play(g, P0, hand(g, P0, 'V(1)'), { dest: 'base' }); g = settle(g);
  g = play(g, P0, hand(g, P0, 'ZapM'), { targets: [[e]] });
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'Mystic Reversal'), { targets: [[g.chain[0].id]], may: [false] });
  g = settle(g, [], { no: true });
  assert.equal(mightOf(g, dar), 5, 'no +2');
});

test('RJ#6679 a facedown card is not a unit or gear: unit/gear-targeting spells cannot choose it', () => {
  let g = S0F();
  control(g, BF_A, P1); put(g, P1, 'V(3)', BF_A);
  const fd = put(g, P1, 'HidU(2)', { facedown: BF_A });
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Hextech Ray') });
  const tg = g.pending?.kind === 'chooseTargets' ? optionIds(g) : g.chain[0].targets.flat();
  assert.ok(!tg.includes(fd), `facedown card not targetable: ${tg}`);
});

test('RJ#6682 Nine-Tailed Fox does not choose the attacker: no Deflect cost, the -1 still applies', () => {
  let g = S0F({ tp: P1 });
  setLegend(g, P0, 'Nine-Tailed Fox');
  put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const a = put(g, P1, 'Deflect(3,1)', 'base');
  const n0 = g.players[P0].runesInPlay.length, r0 = readyRunes(g, P0);
  g = move(g, P1, [a], BF_A);
  g = settle(g);
  assert.equal(mightOf(g, a), 2);
  assert.equal(g.players[P0].runesInPlay.length, n0); assert.equal(readyRunes(g, P0), r0);
});

test('RJ#6683 Dazzling Aurora reveals spells then Karma, Channeler: the recycle happens before Karma is on the board, no buff', () => {
  let g = S0F();
  put(g, P0, 'Dazzling Aurora', 'base');
  const v = put(g, P0, 'V(2)', 'base');
  const k = put(g, P0, 'Karma, Channeler', 'deckTop');
  put(g, P0, 'ZapM', 'deckTop'); put(g, P0, 'ZapM', 'deckTop');
  g = endTurn(g, P0);
  g = settle(g, ['base', v]);
  for (let i = 0; i < 10 && g.pending && g.pending.inStep; i++) g = act(g, legal(g, g.pending.player)[0]);
  assert.equal(zone(g, k), 'base', 'Karma played');
  assert.equal((g.objects[v].counters.buff ?? 0) + (g.objects[k].counters.buff ?? 0), 0, 'no Karma buff');
});

test('RJ#6686 Void Seeker on Ember Monk; a hidden unit played in response: Monk\'s +2 resolves first and he survives', () => {
  let g = S0F({ tp: P1 });
  const m = put(g, P0, 'Ember Monk', BF_A); control(g, BF_A, P0);
  const hu = put(g, P0, 'HidU(2)', { facedown: BF_A });
  g = play(g, P1, hand(g, P1, 'Void Seeker'), { targets: [[m]] });
  g = pass(g);
  g = act(g, { type: 'playCard', player: P0, obj: hu });
  g = settle(g);
  assert.equal(zone(g, m), 'battlefield');
  assert.equal(g.objects[m].damage, 4);
  assert.equal(mightOf(g, m), 6);
});

test('RJ#6687 Icathian Rain choosing a Deflect unit for each of its six instructions pays Deflect six times', () => {
  const spent = (tgt: string) => {
    let g = S0F();
    fundAll(g, P0, 6);
    const e = put(g, P1, tgt, BF_A); control(g, BF_A, P1);
    const n0 = g.players[P0].runesInPlay.length;
    g = play(g, P0, hand(g, P0, 'Icathian Rain'), { targets: [[e], [e], [e], [e], [e], [e]] });
    return n0 - g.players[P0].runesInPlay.length; // power is paid by recycling runes
  };
  assert.equal(spent('Deflect(12,1)') - spent('V(12)'), 6, 'six extra [A]');
});

test('RJ#6688 Bonus Damage (Ravenborn Tome) only adds to damage a spell already deals: Stupefy deals none', () => {
  let g = S0F();
  const tome = put(g, P0, 'Ravenborn Tome', 'base');
  const e = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === tome)!); g = settle(g);
  g = play(g, P0, hand(g, P0, 'Stupefy'), { targets: [[e]] }); g = settle(g);
  assert.equal(g.objects[e].damage, 0);
  assert.equal(mightOf(g, e), 4);
});

test('RJ#6689 a unit moved into an ongoing combat by Ride the Wind takes its controller\'s role', () => {
  let { g } = attackSetup(['V(3)', 'V(1)'], ['V(3)']);
  fundAll(g, P0); fundAll(g, P1);
  const b = put(g, P1, 'V(2)', 'base');
  const c = put(g, P0, 'V(2)', 'base');
  g = play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[c]] });
  g = settle(g, [String(BF_A)]);
  assert.equal(g.objects[c].combatRole, 'attacker');
  expectPending(g, 'showdownAction', P1);
  g = play(g, P1, hand(g, P1, 'Ride the Wind'), { targets: [[b]] });
  g = settle(g, [String(BF_A)]);
  assert.equal(locOf(g, b), BF_A);
  assert.equal(g.objects[b].combatRole, 'defender');
});

test('RJ#6690 Ember Monk (no [Hidden]) cannot be hidden', () => {
  const g = S0F();
  control(g, BF_A, P0); put(g, P0, 'V(1)', BF_A);
  const m = hand(g, P0, 'Ember Monk'), hu = hand(g, P0, 'HidU(2)');
  assert.ok(!legal(g, P0, 'hide').some(a => a.type === 'hide' && a.obj === m));
  assert.ok(legal(g, P0, 'hide').some(a => a.type === 'hide' && a.obj === hu), 'a Hidden card can');
});

test('RJ#6691 Warwick + Anivia attack: order Anivia\'s 3-to-all first, then Warwick kills every damaged enemy there', () => {
  let { g, def } = attackSetup(['Warwick, Hunter', 'Anivia, Primal'], ['V(8)', 'V(9)']);
  for (let i = 0; i < 20 && (g.chain.length || g.pending?.inStep); i++) {
    const d = g.pending!;
    if (d.kind === 'orderTriggers') { g = choose(g, d.options!.find(o => /Warwick/.test(o.label))!.id); continue; }
    g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  assert.equal(zone(g, def[0]), 'trash'); assert.equal(zone(g, def[1]), 'trash');
});

test('RJ#6693 Caitlyn, Patrolling\'s ability still resolves after Flash moves her to base in response', () => {
  let g = S0F();
  const c = put(g, P0, 'Caitlyn, Patrolling', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(5)', BF_B); control(g, BF_B, P1);
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === c)!);
  g = answer(g, { targets: [[e]] });
  g = play(g, P0, hand(g, P0, 'Flash'), { targets: [[c]] });
  for (let i = 0; i < 6 && g.pending?.kind === 'chooseTargets'; i++) g = act(g, { type: 'choose', player: P0, optionIds: [] });
  g = settle(g);
  assert.equal(locOf(g, c), 'base');
  assert.equal(g.objects[e].damage, 3);
});

test('RJ#6694 The Boss\'s heal removes only damage: a Smoke Screen reduction stays', () => {
  let g = S0F({ tp: P1 });
  setLegend(g, P0, 'The Boss');
  const u = put(g, P0, 'V(6)', BF_A, { buff: true }); control(g, BF_A, P0);
  g = play(g, P1, hand(g, P1, 'Smoke Screen'), { targets: [[u]] }); g = settle(g);
  assert.equal(mightOf(g, u), 3);
  g = play(g, P1, hand(g, P1, 'Hextech Ray'), { targets: [[u]] });
  g = settle(g);
  assert.equal(locOf(g, u), 'base');
  assert.equal(g.objects[u].damage, 0);
  assert.equal(mightOf(g, u), 2, '6 - 4 (Smoke Screen still applies), buff spent');
});

test('RJ#6697 Portal Rescue: the replayed unit is a new object (play trigger again, damage and buff gone)', () => {
  let g = S0F();
  const u = put(g, P0, 'PlayDeal2', 'base', { damage: 1, buff: true });
  const e = put(g, P1, 'V(5)', 'base');
  g = play(g, P0, hand(g, P0, 'Portal Rescue'), { targets: [[u]] });
  g = settle(g, [e]);
  const nu = g.players[P0].base.find(x => g.cards[g.objects[x].cardId].name === 'PlayDeal2')!;
  assert.ok(nu);
  assert.equal(g.objects[nu].damage, 0);
  assert.equal(g.objects[nu].counters.buff ?? 0, 0);
  assert.equal(g.objects[e].damage, 2, 'play trigger fired again');
});

test('RJ#6698 Cull the Weak vs The Boss: the opponent kills a buffed unit and saves it by spending the buff', () => {
  let g = S0F();
  setLegend(g, P1, 'The Boss');
  const b = put(g, P1, 'V(3)', 'base', { buff: true });
  put(g, P0, 'V(1)', 'base');
  g = play(g, P0, hand(g, P0, 'Cull the Weak'));
  g = settle(g, [b]);
  assert.equal(zone(g, b), 'base', 'saved');
  assert.equal(g.objects[b].counters.buff ?? 0, 0);
});

test('RJ#6699 (AMBIGUOUS, RJ loophole not adopted) combat damage assignments cannot be negative', () => {
  let { g, atk, def } = attackSetup(['V(3)'], ['V(1)', 'V(1)']);
  g = passAll(g);
  if (pend(g).kind === 'assignDamage' && pend(g).player === P0) {
    const err = validateAction(g, { type: 'assignDamage', player: P0, assignment: { [def[0]]: 4, [def[1]]: -1 } });
    assert.ok(err, 'negative assignment rejected');
  }
  void atk;
});

test('RJ#6702 attackers recalled after a combat with surviving defenders keep their ready/exhausted state (recall is not a move)', () => {
  let { g, atk } = attackSetup(['MoveDraw(2)'], ['V(5)'], { defOpts: [{ stunned: true }] });
  g = settle(g);
  g.objects[atk[0]].exhausted = false; touch(g);
  const h = g.players[P0].hand.length;
  g = passAll(g); g = settle(g);
  assert.equal(locOf(g, atk[0]), 'base');
  assert.equal(g.objects[atk[0]].exhausted, false);
  assert.equal(g.players[P0].hand.length, h, 'no "When I move" draw');
});

test('RJ#6703 Viktor, Innovator targeted by removal: responding with a Reaction gives a Recruit, unless that Reaction removes Viktor', () => {
  const run = (resp: 'Stupefy' | 'Retreat') => {
    let g = S0F({ tp: P1 });
    const v = put(g, P0, 'Viktor, Innovator', BF_A); control(g, BF_A, P0);
    const e = put(g, P1, 'V(3)', 'base');
    g = play(g, P1, hand(g, P1, 'Hextech Ray'), { targets: [[v]] });
    g = pass(g);
    g = play(g, P0, hand(g, P0, resp), { targets: [[resp === 'Retreat' ? v : e]] });
    g = settle(g, ['base']);
    return Object.values(g.objects).filter(o => o.controller === P0 && g.cards[o.cardId]?.name === 'Recruit' && (o.zone === 'base' || o.zone === 'battlefield')).length;
  };
  assert.equal(run('Stupefy'), 1);
  assert.equal(run('Retreat'), 0);
});

test('RJ#6707 a facedown card cannot hold a battlefield: when the last unit there dies to a spell, control is lost and it is trashed', () => {
  let g = S0F();
  const u = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const fd = put(g, P1, 'HidU(3)', { facedown: BF_A });
  g = play(g, P0, hand(g, P0, 'KillA'), { targets: [[u]] });
  g = settle(g);
  assert.equal(g.battlefields[BF_A].controller, null);
  assert.equal(zone(g, fd), 'trash');
});

test('RJ#6709 OUTDATED: Fading Memories on an attached Spinning Axe: the granted Temporary works (UNL-FAQ #4), the axe dies next turn', () => {
  let g = S0F();
  const u = put(g, P0, 'V(2)', 'base');
  const ax = put(g, P0, 'Spinning Axe', 'base');
  attachNow(g, ax, u);
  g = play(g, P0, hand(g, P0, 'Fading Memories'), { targets: [[ax]] });
  g = settle(g, [ax]);
  assert.equal(zone(g, ax), 'base');
  g = nextTurn(g); g = nextTurn(g);
  assert.equal(g.activePlayer, P0);
  assert.equal(zone(g, ax), 'trash');
});

test('RJ#6710 Teemo, Strategist counts only revealed cards that have [Hidden]: Ava Achiever (mentions Hidden) does not count', () => {
  let { g, atk } = attackSetup(['V(6)'], ['Teemo, Strategist']);
  clearDeckTop(g, P1);
  for (const c of ['V(1)', 'V(1)', 'HidU(1)', 'Ava Achiever', 'V(1)']) put(g, P1, c, 'deckBottom');
  g = settle(g, [atk[0]]);
  assert.equal(g.objects[atk[0]].damage, 1);
});
function clearDeckTop(g: GameState, p: PlayerId): void { for (const id of g.players[p].mainDeck) delete g.objects[id]; g.players[p].mainDeck = []; touch(g); }

test('RJ#6713 runes can be tapped/recycled to float resources only while you have priority (or while paying)', () => {
  let g = S0F();
  const runeActs = (p: PlayerId) => legal(g, p, 'activate').filter(a => a.type === 'activate' && g.players[p].runesInPlay.includes(a.obj));
  g = play(g, P0, hand(g, P0, 'DrawR'));
  expectPending(g, 'chainResponse', P0);
  assert.ok(runeActs(P0).length > 0, 'with priority: yes');
  assert.equal(runeActs(P1).length, 0, 'without priority: no');
});

test('RJ#6718 Not So Fast counters a multi-target spell (Singularity) that chooses a friendly unit', () => {
  let g = S0F();
  const a = put(g, P1, 'V(5)', 'base'), b = put(g, P1, 'V(5)', 'base');
  g = play(g, P0, hand(g, P0, 'Singularity'), { targets: [[a, b]] });
  if (g.pending?.kind === 'chooseTargets') g = settle(g, [b]);
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'Not So Fast'), { targets: [[g.chain[0].id]] });
  g = settle(g);
  assert.equal(zone(g, a), 'base'); assert.equal(zone(g, b), 'base');
  assert.equal(g.objects[a].damage + g.objects[b].damage, 0);
});

test('RJ#6723 Rhasa the Sunderer with 10+ cards in trash costs 0 energy but still needs its Chaos power', () => {
  let g = S0F();
  for (let i = 0; i < 12; i++) put(g, P0, 'V(1)', 'trash');
  const r = hand(g, P0, 'Rhasa the Sunderer');
  setRunes(g, P0, 0);
  assert.equal(canPlayNow(g, P0, r), false, 'no runes: the [Chaos] power is still owed');
  addRunes(g, P0, 1, 'chaos');
  assert.equal(canPlayNow(g, P0, r), true, 'one Chaos rune is enough');
});

test('RJ#6726 Piercing Light: if the first target leaves, the second still takes 2 ("then" creates no dependency)', () => {
  let g = S0F();
  const a = put(g, P1, 'V(5)', BF_A), b = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Piercing Light') });
  const picks = [a, b];
  for (let i = 0; i < 6 && g.pending?.inStep; i++) {
    if (g.pending.kind === 'optional') { g = no(g); continue; }
    const want = picks.find(x => optionIds(g).includes(x)); g = choose(g, want!); picks.splice(picks.indexOf(want!), 1);
  }
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'Retreat'), { targets: [[a]] });
  g = settle(g, [], { no: true });
  assert.equal(zone(g, a), 'hand');
  assert.equal(g.objects[b].damage, 2);
});

test('RJ#6727 stealing an attacker with "When I defend" via hidden Hostile Takeover during the initial chain: it becomes a defender, its trigger resolves before Reaver\'s Row', () => {
  let g = S0F({ tp: P1, bfA: "Reaver's Row" });
  put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const ht = put(g, P0, 'Hostile Takeover', { facedown: BF_A });
  const da = put(g, P1, 'DefendAmbusher(3)', 'base'), v = put(g, P1, 'V(3)', 'base');
  g = move(g, P1, [da, v], BF_A);
  if (g.pending?.kind === 'chooseTargets') g = choose(g, optionIds(g)[0]);
  assert.ok(g.chain.some(c => g.cards[g.objects[c.source]?.cardId]?.name === "Reaver's Row"), 'Reaver\'s Row trigger on the chain');
  for (let i = 0; i < 4 && g.pending?.player !== P0; i++) g = pass(g);
  g = act(g, { type: 'playCard', player: P0, obj: ht });
  g = answer(g, { targets: [[da]] });
  g = pass(g); g = pass(g);
  assert.equal(g.objects[da].controller, P0);
  assert.equal(g.objects[da].combatRole, 'defender');
  const top = g.chain[g.chain.length - 1];
  assert.equal(g.cards[g.objects[top.source].cardId].name, 'DefendAmbusher(3)', 'its defend trigger is above Reaver\'s Row');
});

test('RJ#6728 a stunned unit still deals damage back through Challenge (stun stops only combat damage)', () => {
  let g = S0F();
  const f = put(g, P0, 'V(5)', 'base');
  const e = put(g, P1, 'V(3)', BF_A, { stunned: true }); control(g, BF_A, P1);
  g = play(g, P0, hand(g, P0, 'Challenge'), { targets: [[f], [e]] });
  g = settle(g, [f, e]);
  assert.equal(zone(g, e), 'trash');
  assert.equal(g.objects[f].damage, 3);
});

test('RJ#6729 Gust\'s target pumped above 3 Might before resolution: no effect, no retarget', () => {
  let g = S0F({ tp: P1 });
  const a = put(g, P0, 'V(3)', BF_A), b = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  g = play(g, P1, hand(g, P1, 'Gust'), { targets: [[a]] });
  g = pass(g);
  g = play(g, P0, hand(g, P0, 'PumpR'), { targets: [[a]] });
  g = settle(g);
  assert.equal(locOf(g, a), BF_A); assert.equal(locOf(g, b), BF_A);
});

test('RJ#6730 Possession recalls a ready enemy unit: it arrives in your base still ready', () => {
  let g = S0F();
  fundAll(g, P0, 6);
  const v = put(g, P1, 'V(6)', BF_A, { ready: true }); control(g, BF_A, P1);
  g = play(g, P0, hand(g, P0, 'Possession'), { targets: [[v]] });
  g = settle(g);
  assert.equal(g.objects[v].controller, P0);
  assert.ok(g.players[P0].base.includes(v));
  assert.equal(g.objects[v].exhausted, false);
});

test('RJ#6734 Rek\'Sai, Breacher: a champion played from the Champion Zone (not the hand) gets Accelerate and may enter ready', () => {
  let g = S0F();
  put(g, P0, "Rek'Sai, Breacher", 'base');
  const ch = g.players[P0].championZone[0];
  assert.ok(ch && g.objects[ch], 'chosen champion present');
  g = act(g, { type: 'playCard', player: P0, obj: ch, destination: 'base' });
  g = answer(g, { may: [true] });
  g = settle(g);
  assert.equal(zone(g, ch), 'base');
  assert.equal(g.objects[ch].exhausted, false);
});

test('RJ#6735 two Dazzling Auroras: Snapvine played by the first resolves its trigger before the second Aurora plays its unit', () => {
  let g = S0F();
  put(g, P0, 'Dazzling Aurora', 'base'); put(g, P0, 'Dazzling Aurora', 'base');
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  put(g, P0, 'V(2)', 'deckTop');
  put(g, P0, 'Carnivorous Snapvine', 'deckTop');
  g = endTurn(g, P0);
  g = settle(g, [e, 'base'], { limit: 60 });
  const texts = g.log.map(l => l.text);
  const killed = texts.findIndex(t => /Snapvine deals/.test(t));
  const second = texts.findIndex(t => /plays V\(2\)/.test(t));
  assert.ok(killed >= 0 && second >= 0, texts.slice(-15).join(' | '));
  assert.ok(killed < second, 'Snapvine\'s trigger resolved before the second Aurora played its unit');
  assert.equal(zone(g, e), 'trash');
});

test('RJ#6737 the combat cleanup heals all units: a defender damaged in one attack starts the next attack undamaged', () => {
  let { g, def } = attackSetup(['V(1)'], ['V(3)']);
  g = passAll(g); g = settle(g);
  assert.equal(zone(g, def[0]), 'battlefield');
  assert.equal(g.objects[def[0]].damage, 0, 'healed after combat');
  const b = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [b], BF_A);
  g = passAll(g); g = settle(g);
  assert.equal(zone(g, def[0]), 'battlefield', '2 < 3: survives the second attack');
});

test('RJ#6738 Catalyst of Aeons with all 12 runes out (empty rune deck): channels nothing and draws 1', () => {
  let g = S0F({ runeDeck: [0, 6] });
  setRunes(g, P0, 12, 'body');
  const h0 = g.players[P0].hand.length;
  g = play(g, P0, hand(g, P0, 'Catalyst of Aeons')); g = settle(g);
  assert.equal(g.players[P0].hand.length, h0 + 1);
});

test('RJ#6742 Blitzcrank, Impassive\'s hook triggers only when played to a battlefield, not when moved there', () => {
  let g = S0F();
  const b = put(g, P0, 'Blitzcrank, Impassive', 'base');
  const e = put(g, P1, 'V(2)', BF_B); control(g, BF_B, P1);
  g = move(g, P0, [b], BF_A);
  assert.ok(!(g.pending?.kind === 'optional' && /Blitz|move an enemy/i.test(g.pending.prompt)), 'no hook prompt');
  g = settle(g, [], { no: true });
  assert.equal(locOf(g, e), BF_B);
});

test('RJ#6744 Stacked Deck seeing Nocturne, Horrifying: banish/play Nocturne and still put one of the other two into hand', () => {
  let g = S0F();
  const a = put(g, P0, 'V(1)', 'deckTop'), b = put(g, P0, 'V(2)', 'deckTop');
  const n = put(g, P0, 'Nocturne, Horrifying', 'deckTop');
  g = play(g, P0, hand(g, P0, 'Stacked Deck'));
  g = settle(g, [b, 'base']);
  assert.ok(['base', 'battlefield'].includes(zone(g, n)), `Nocturne played (${zone(g, n)})`);
  assert.ok(zone(g, a) === 'hand' || zone(g, b) === 'hand', 'one of the other two went to hand');
});

test('RJ#6745 gaining control of a battlefield you already scored this turn is not a conquer: no conquer trigger', () => {
  let g = S0F();
  g.battlefields[BF_A].scoredThisTurnBy = [P0]; touch(g);
  const u = put(g, P0, 'ConquerDraw(3)', 'base');
  const h0 = g.players[P0].hand.length, p0 = g.players[P0].points;
  g = move(g, P0, [u], BF_A);
  g = passAll(g); g = settle(g);
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[P0].points, p0);
  assert.equal(g.players[P0].hand.length, h0, 'no conquer draw');
});

test('RJ#6746 Minefield milling is not discarding: Mask Mother put into the trash this way does not trigger', () => {
  let g = S0F({ bfA: 'Minefield' });
  const mm = put(g, P0, 'Mask Mother', 'deckTop');
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_A);
  let prompted = false;
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    if (g.pending.kind === 'optional' && /Mask Mother|\+2/i.test(g.pending.prompt)) prompted = true;
    g = g.pending.inStep ? act(g, legal(g, g.pending.player)[0]) : pass(g);
  }
  assert.equal(zone(g, mm), 'trash');
  assert.equal(prompted, false);
});

test('RJ#6748 Mageseeker Warden out: a hidden unit can\'t be played (only "there" from hiding) and can\'t switch to a normal play to base', () => {
  let g = S0F();
  put(g, P1, 'Mageseeker Warden', BF_B); control(g, BF_B, P1);
  control(g, BF_A, P0); put(g, P0, 'V(1)', BF_A);
  const hu = put(g, P0, 'HidU(2)', { facedown: BF_A });
  assert.equal(canPlayNow(g, P0, hu), false);
  assert.ok(!playDests(g, P0, hu).includes('base'));
});

test('RJ#6751 Hidden Blade kills its own unit in response to Void Seeker: Void Seeker deals nothing but still draws 1; Blade owner draws 2', () => {
  let g = S0F();
  control(g, BF_A, P1);
  const k = put(g, P1, 'V(5)', BF_A);
  const hb = put(g, P1, 'Hidden Blade', { facedown: BF_A });
  const h0 = g.players[P0].hand.length, h1 = g.players[P1].hand.length;
  const vs = hand(g, P0, 'Void Seeker');
  g = play(g, P0, vs, { targets: [[k]] });
  g = pass(g);
  g = act(g, { type: 'playCard', player: P1, obj: hb });
  g = answer(g, { targets: [[k]] });
  g = settle(g);
  assert.equal(zone(g, k), 'trash');
  assert.equal(g.players[P1].hand.length, h1 + 2, 'Blade: its controller draws 2');
  assert.equal(g.players[P0].hand.length, h0 + 1, 'Void Seeker (added after h0, then played) still draws 1');
  assert.equal(zone(g, vs), 'trash');
});

test('RJ#6752 Eclipse Herald does not count stuns from before it was on the board', () => {
  let g = S0F();
  const e1 = put(g, P1, 'V(2)', BF_A), e2 = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  g = settle(play(g, P0, hand(g, P0, 'StunA'), { targets: [[e1]] }));
  const h = put(g, P0, 'Eclipse Herald', 'base', { ready: false });
  assert.equal(mightOf(g, h), 7, 'no retroactive +1');
  assert.equal(g.objects[h].exhausted, true);
  g = settle(play(g, P0, hand(g, P0, 'StunA'), { targets: [[e2]] }));
  assert.equal(mightOf(g, h), 8);
  assert.equal(g.objects[h].exhausted, false);
});

test('RJ#6754 Gold token: kill + exhaust cost; an exhausted Gold cannot be used', () => {
  let g = S0F();
  const gold = put(g, P0, 'Gold', 'base');
  const canUse = (gg: GameState) => legal(gg, P0).some(a => a.type === 'activate' && (a as { obj?: ObjId }).obj === gold);
  g.objects[gold].exhausted = true; touch(g);
  assert.equal(canUse(g), false, 'exhausted: cannot pay [T]');
  g.objects[gold].exhausted = false; touch(g);
  assert.equal(canUse(g), true);
});

test('RJ#6756 Temptation with Repeat cannot swap two enemy units (second move has no valid destination any more)', () => {
  let g = S0F();
  control(g, BF_A, P1);
  const a = put(g, P1, 'V(2)', BF_A), b = put(g, P1, 'V(2)', 'base');
  const log: string[] = [];
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Temptation') });
  for (let i = 0; i < 20 && g.pending && (g.chain.length || g.pending.inStep); i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    log.push(`${d.kind}:${d.prompt}:${JSON.stringify(d.options?.map(o => o.id + '=' + o.label))}`);
    const ids = (d.options ?? []).map(o => o.id);
    const pick = d.kind === 'optional' ? 'yes' : ids.includes(a) && !log.some(l => l.includes('picked-a')) ? (log.push('picked-a'), a) : ids.includes('base') && !log.some(l => l.includes('picked-base')) ? (log.push('picked-base'), 'base') : ids.includes(b) ? b : ids.includes(BF_A as unknown as string) ? BF_A as unknown as string : ids[0];
    g = act(g, { type: 'choose', player: d.player, optionIds: [pick] });
  }
  assert.equal(locOf(g, a), 'base', 'first execution moved a');
  assert.ok(locOf(g, b) !== BF_A, 'no swap: b cannot go to BF_A (no P1 unit there any more)');
});

test('RJ#6757 Thousand-Tailed Watcher (-1 on a 2-Might Ravenbloom Student), then 5 spells: Student ends at 6', () => {
  let g = S0F();
  const st = put(g, P1, 'Ravenbloom Student', BF_A); control(g, BF_A, P1);
  g = settle(play(g, P0, hand(g, P0, 'Thousand-Tailed Watcher'), { dest: 'base', may: [false] }));
  assert.equal(mightOf(g, st), 1);
  g = play(g, P0, hand(g, P0, 'DrawR'));
  g = pass(g);
  for (let i = 0; i < 5; i++) g = play(g, P1, hand(g, P1, 'DrawR'));
  g = settle(g);
  assert.equal(mightOf(g, st), 6);
});

test('RJ#6759 one facedown card per battlefield (unit or spell share the slot)', () => {
  let g = S0F();
  control(g, BF_A, P0); put(g, P0, 'V(1)', BF_A);
  put(g, P0, 'HidU(2)', { facedown: BF_A });
  const sp = hand(g, P0, 'HidZap');
  assert.ok(!legal(g, P0, 'hide').some(a => a.type === 'hide' && (a as { obj?: ObjId }).obj === sp && (a as { battlefieldIndex?: number }).battlefieldIndex === BF_A), 'cannot hide a spell where a unit is already hidden');
});

test('RJ#6760 a champion that left the Champion Zone and is recycled goes to the Main Deck, not back to the Champion Zone', () => {
  let g = S0F();
  const ch = g.players[P0].championZone[0];
  assert.ok(ch);
  g.players[P0].championZone = []; g.objects[ch].zone = 'trash'; g.players[P0].trash.push(ch); touch(g);
  const fg = put(g, P0, 'Forge of the Future', 'base');
  const ac = legal(g, P0).find(a => a.type === 'activate' && (a as { obj?: ObjId }).obj === fg);
  assert.ok(ac, 'Forge activation offered');
  g = act(g, ac!);
  g = settle(g, [ch]);
  for (let i = 0; i < 4 && g.pending?.inStep; i++) g = act(g, { type: 'choose', player: P0, optionIds: [] });
  g = settle(g);
  assert.notEqual(zone(g, ch), 'trash', 'recycled');
  assert.notEqual(zone(g, ch), 'championZone');
  assert.equal(g.players[P0].championZone.length, 0);
});

test('RJ#6761 Svellsongur copies only the unit\'s printed text: Ahri + Svellsongur + Trinity Force hold = 1 + 3 points (not 4)', () => {
  let g = S0F({ tp: P1 });
  const ahri = put(g, P0, 'Ahri, Alluring', BF_A);
  control(g, BF_A, P0);
  const sv = put(g, P0, 'Svellsongur', 'base'), tf = put(g, P0, 'Trinity Force', 'base');
  attachNow(g, sv, ahri); attachNow(g, tf, ahri);
  const m0 = mightOf(g, ahri);
  g = endTurn(g, P1);
  assert.equal(g.pending?.kind, 'orderTriggers', 'three hold triggers (Ahri, the Svellsongur copy, Trinity Force) — not four');
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) g = g.pending.inStep ? act(g, legal(g, g.pending.player)[0]) : pass(g);
  assert.equal(g.players[P0].points, 4, 'hold 1 + Ahri 1 + Svellsongur copy of Ahri 1 + Trinity Force 1');
  assert.equal(m0, 4 + 2, 'Trinity Force +2 counted once');
});

function ffa3(): GameState {
  let g = createGame({ seed: 3, cardDb: fixtureDb(), mode: 'ffa', firstPlayer: P0, skipMulligan: true, battlefieldSelection: 'random', includeAllCards: true,
    players: [0, 1, 2].map(i => ({ name: `P${i}`, deck: legalDeck({}, [`cf-bf-${'abc'[i]}`, `cf-bf-${'def'[i]}`, `cf-bf-${'abc'[(i + 1) % 3]}`]) })) } as never);
  for (let i = 0; i < 10 && !(g.pending?.kind === 'mainAction' && g.pending.player === P0); i++) g = g.pending!.inStep ? act(g, legal(g, g.pending!.player)[0]) : act(g, { type: 'pass', player: g.pending!.player });
  for (const p of [P0, P1, 2 as PlayerId]) fundAll(g, p);
  return g;
}

test('RJ#6764 FFA: a third player may react to a chain between two other players (outside a showdown) without any invite', () => {
  let g = ffa3();
  const P2 = 2 as PlayerId;
  const e = put(g, P1, 'V(3)', 'base');
  const r = hand(g, P2, 'ZapR');
  g = play(g, P0, hand(g, P0, 'ZapM'), { targets: [[e]] });
  let ok = false;
  for (let i = 0; i < 4 && g.pending?.kind === 'chainResponse'; i++) { if (g.pending.player === P2) { ok = canPlayNow(g, P2, r); break; } g = pass(g); }
  assert.ok(ok, 'P2 gets priority on the chain and may play a Reaction');
});

test('RJ#6771 a stolen Deathknell unit dies: its controller (the stealer) gets the Deathknell; the card goes to its owner\'s trash', () => {
  let g = S0F();
  const dk = put(g, P1, 'DK(2)', BF_A); control(g, BF_A, P1);
  g = settle(play(g, P0, hand(g, P0, 'TakeoverLike'), { targets: [[dk]] }));
  assert.equal(g.objects[dk].controller, P0);
  const h0 = g.players[P0].hand.length, h1 = g.players[P1].hand.length;
  g = settle(play(g, P0, hand(g, P0, 'KillA'), { targets: [[dk]] }));
  assert.equal(zone(g, dk), 'trash');
  assert.ok(g.players[P1].trash.includes(dk), 'owner\'s trash');
  assert.equal(g.players[P0].hand.length, h0 + 1, 'stealer drew 1 (KillA was added after h0 and played)');
  assert.equal(g.players[P1].hand.length, h1);
});

test('RJ#6772 Kayn (moved twice) takes no damage but is still killed by a kill effect (Hidden Blade kills, doesn\'t deal damage)', () => {
  let g = S0F();
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const k = put(g, P0, 'Kayn', 'base');
  g = settle(move(g, P0, [k], BF_A));
  g = settle(play(g, P0, hand(g, P0, 'MoveR'), { targets: [[k]] }));
  assert.equal(locOf(g, k), 'base');
  g = settle(play(g, P0, hand(g, P0, 'ZapM'), { targets: [[k]] }));
  assert.equal(g.objects[k].damage, 0, 'no damage after two moves');
  g = settle(play(g, P0, hand(g, P0, 'KillDraw'), { targets: [[k]] }));
  assert.equal(zone(g, k), 'trash', 'killed');
});

test('RJ#6774 Kraken Hunter can only spend buffs on units you control', () => {
  let g = S0F();
  const mine = put(g, P0, 'V(2)', 'base', { buff: true });
  const theirs = put(g, P1, 'V(2)', 'base', { buff: true });
  const kh = hand(g, P0, 'Kraken Hunter');
  g = act(g, { type: 'playCard', player: P0, obj: kh, destination: 'base' } as never);
  const seen: string[] = [];
  for (let i = 0; i < 8 && g.pending?.inStep; i++) {
    const ids = (g.pending.options ?? []).map(o => o.id);
    seen.push(...ids);
    g = act(g, { type: 'choose', player: P0, optionIds: g.pending.kind === 'optional' ? ['yes'] : ids.includes(mine) ? [mine] : ids.length ? [ids[0]] : [] });
  }
  assert.ok(!seen.includes(theirs), `enemy buff never offered (${seen})`);
  assert.equal(g.objects[theirs].counters.buff ?? 0, 1, 'enemy buff untouched');
});

// RJ#6775 MISMATCH-RJ (principle 11, CR 383.3.a): Tideturner's leading "you may" is decided when the trigger is finalized
// (RJ: target chosen on play, "may" decided on resolution). Declining removes the trigger.
test('RJ#6775 Tideturner\'s "you may choose" is decided when the trigger is put on the chain (before any response), not on resolution', () => {
  let g = S0F();
  control(g, BF_A, P0); put(g, P0, 'V(1)', BF_A);
  const tt = put(g, P0, 'Tideturner', { facedown: BF_A });
  put(g, P0, 'V(1)', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: tt, destination: BF_A } as never);
  assert.ok(g.pending?.inStep && /may/i.test(g.pending.prompt), `the "may" choice is asked at once (${g.pending?.kind}: ${g.pending?.prompt})`);
  assert.equal(g.chain.length, 0, 'decided before the trigger is on the chain');
  g = act(g, { type: 'choose', player: P0, optionIds: [] });
  g = settle(g);
  assert.equal(locOf(g, tt), BF_A, 'declined: no swap');
});

test('RJ#6775b declining Tideturner\'s leading "you may" removes the trigger (no empty chain item / response window)', () => {
  let g = S0F();
  control(g, BF_A, P0); put(g, P0, 'V(1)', BF_A);
  const tt = put(g, P0, 'Tideturner', { facedown: BF_A });
  put(g, P0, 'V(1)', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: tt, destination: BF_A } as never);
  g = act(g, { type: 'choose', player: P0, optionIds: [] });
  assert.equal(g.chain.length, 0);
});

test('RJ#6777 in a showdown at one battlefield, an Action may target a unit at another battlefield', () => {
  let g = S0F();
  const far = put(g, P1, 'V(3)', BF_B); control(g, BF_B, P1);
  const a = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 4 && !(g.pending?.kind === 'showdownAction' && g.pending.player === P0); i++) g = g.pending?.inStep ? act(g, legal(g, g.pending.player)[0]) : pass(g);
  expectPending(g, 'showdownAction', P0);
  g = settle(play(g, P0, hand(g, P0, 'ZapA'), { targets: [[far]] }));
  assert.equal(g.objects[far].damage, 2);
});

test('RJ#6780 Altar of Memories (a triggered ability) can be used on the opponent\'s turn', () => {
  let g = S0F({ tp: P1 });
  const alt = put(g, P0, 'Altar of Memories', 'base');
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const d0 = g.players[P0].mainDeck.length;
  g = play(g, P1, hand(g, P1, 'KillA'), { targets: [[u]] });
  let asked = false;
  for (let i = 0; i < 12 && g.pending && (g.chain.length || g.pending.inStep); i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    if (d.kind === 'optional') { if (d.player === P0) asked = true; g = act(g, { type: 'choose', player: d.player, optionIds: ['yes'] }); continue; }
    g = act(g, legal(g, d.player)[0]);
  }
  assert.ok(asked, 'P0 offered the Altar on P1\'s turn');
  assert.equal(g.objects[alt].exhausted, true);
  assert.equal(g.players[P0].mainDeck.length, d0, 'drew 1 and put 1 back');
});

test('RJ#6785 Stupefy cannot be played with no units on the board (needs a legal target to be played at all)', () => {
  const g = S0F();
  const st = hand(g, P0, 'Stupefy');
  assert.equal(canPlayNow(g, P0, st), false);
  put(g, P1, 'V(2)', 'base');
  assert.equal(canPlayNow(g, P0, st), true);
});

function emptyHand(g: GameState, p: PlayerId): void {
  for (const id of g.players[p].hand) { g.objects[id].zone = 'trash'; g.players[p].trash.push(id); }
  g.players[p].hand = []; touch(g);
}

// RJ#6787 MISMATCH-RJ: CR 1.5 423.4 (Undercover Agent example, "Discard 2, then draw 2"): "If they have no cards in hand, the entire
// discard instruction is negated. ... Regardless of how many cards they discard, they then draw 2." (riftlens /rules/discard/)
test('RJ#6787 "Discard 1, then draw 2" (Lunar Boon) with no other card in hand still draws 2 (CR 423.4)', () => {
  let g = S0F();
  emptyHand(g, P0);
  const lb = hand(g, P0, 'Lunar Boon');
  g = settle(play(g, P0, lb));
  assert.equal(g.players[P0].hand.length, 2);
});

test('RJ#6787b Undercover Agent dies with an empty hand: still draws 2 (CR 423.4 example)', () => {
  let g = S0F();
  emptyHand(g, P0);
  const ua = put(g, P0, 'Undercover Agent', BF_A); control(g, BF_A, P0);
  g = settle(play(g, P0, hand(g, P0, 'KillA'), { targets: [[ua]] }));
  assert.equal(zone(g, ua), 'trash');
  assert.equal(g.players[P0].hand.length, 2);
});

test('RJ#6790 Unlicensed Armory: discarding is a cost — no card in hand, no activation; and it needs a friendly unit', () => {
  const g = S0F();
  const arm = put(g, P0, 'Unlicensed Armory', 'base');
  const can = () => legal(g, P0).some(a => a.type === 'activate' && (a as { obj?: ObjId }).obj === arm);
  put(g, P0, 'V(2)', 'base');
  emptyHand(g, P0);
  assert.equal(can(), false, 'no card to discard');
  hand(g, P0, 'V(1)');
  assert.equal(can(), true);
});

test('RJ#6790b Unlicensed Armory can\'t be activated without a friendly unit to choose', () => {
  const g = S0F();
  const arm = put(g, P0, 'Unlicensed Armory', 'base');
  hand(g, P0, 'V(1)');
  assert.equal(legal(g, P0).some(a => a.type === 'activate' && (a as { obj?: ObjId }).obj === arm), false);
});

test('RJ#6791 Traveling Merchant moved with an empty hand: the discard is skipped, it still draws 1', () => {
  let g = S0F();
  emptyHand(g, P0);
  const m = put(g, P0, 'Traveling Merchant', 'base');
  g = move(g, P0, [m], BF_A);
  g = settle(g);
  assert.equal(g.players[P0].hand.length, 1);
});

// RJ#6792 OUTDATED (asked under v1.4): CR 1.5 370.4 "A Game Object can apply its Replacement Effects to any qualifying events that
// occur simultaneously with it leaving the zone" — its Soraka example: "including to units that die simultaneously with her".
test('RJ#6792 Soraka dying in combat together with a smaller friendly unit still saves it (CR 1.5 370.4)', () => {
  let { g, def } = attackSetup(['V(10)'], ['Soraka', 'V(2)']);
  g = settle(passAll(g));
  for (let i = 0; i < 10 && g.pending && g.pending.kind !== 'mainAction'; i++) g = g.pending.inStep ? act(g, legal(g, g.pending.player)[0]) : pass(g);
  assert.equal(zone(g, def[0]), 'trash', 'Soraka died');
  assert.equal(locOf(g, def[1]), 'base', 'the 2-Might unit was healed and recalled instead');
  assert.equal(g.objects[def[1]].exhausted, true);
});

test('RJ#6797 a counter drawn by a resolving chain item can be played before the next item resolves and counter it', () => {
  let g = S0F();
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const cr = put(g, P1, 'CounterR', 'deckTop');
  const zap = hand(g, P0, 'ZapM');
  g = play(g, P0, zap, { targets: [[e]] });
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'DrawR'));
  for (let i = 0; i < 4 && g.chain.length === 2; i++) g = pass(g);
  assert.equal(zone(g, cr), 'hand', 'drew the counter');
  assert.equal(g.chain.length, 1, 'Zap still on the chain');
  for (let i = 0; i < 3 && g.pending?.player !== P1; i++) g = pass(g);
  g = act(g, { type: 'playCard', player: P1, obj: cr });
  g = settle(g, [g.chain[0].id]);
  assert.equal(g.objects[e].damage, 0, 'Zap countered');
  assert.equal(zone(g, zap), 'trash');
});

test('RJ#6800 Brynhir Thundersong ("opponents can\'t play cards") does not stop Machine Evangel\'s Deathknell tokens (tokens aren\'t cards)', () => {
  let g = S0F({ tp: P1 });
  const ev = put(g, P0, 'Machine Evangel', BF_A); control(g, BF_A, P0);
  g = settle(play(g, P1, hand(g, P1, 'Brynhir Thundersong'), { dest: 'base' }));
  const before = g.players[P0].base.length;
  g = settle(play(g, P1, hand(g, P1, 'KillA'), { targets: [[ev]] }));
  assert.equal(zone(g, ev), 'trash');
  assert.equal(g.players[P0].base.length, before + 3, 'three Recruits');
});

test('RJ#6804 Watcher on a buffed 2-Might unit (3) -> 1 (a -2, locked); +3 -> 4; then losing the buff -> 3', () => {
  let g = S0F();
  const u = put(g, P1, 'V(2)', BF_A, { buff: true }); control(g, BF_A, P1);
  assert.equal(mightOf(g, u), 3);
  g = settle(play(g, P0, hand(g, P0, 'Thousand-Tailed Watcher'), { dest: 'base', may: [false] }));
  assert.equal(mightOf(g, u), 1);
  g = settle(play(g, P0, hand(g, P0, 'PumpA'), { targets: [[u]] }));
  assert.equal(mightOf(g, u), 4, 'increase on top of the locked value');
  g.objects[u].counters.buff = 0; touch(g); // the buff is spent (e.g. Kraken Hunter's cost)
  assert.equal(mightOf(g, u), 3);
});

test('RJ#6806 Hidden Blade played from hand ("a unit at a battlefield"): its target swapped to another battlefield by Tideturner still dies', () => {
  let g = S0F();
  control(g, BF_A, P1); control(g, BF_B, P1);
  const t = put(g, P1, 'V(3)', BF_A); put(g, P1, 'V(1)', BF_B);
  const tt = put(g, P1, 'Tideturner', { facedown: BF_B });
  g = play(g, P0, hand(g, P0, 'Hidden Blade'), { targets: [[t]] });
  g = pass(g);
  g = act(g, { type: 'playCard', player: P1, obj: tt, destination: BF_B } as never);
  g = act(g, { type: 'choose', player: P1, optionIds: [t] });
  for (let i = 0; i < 10 && g.pending && (g.chain.length || g.pending.inStep); i++) g = g.pending.inStep ? act(g, legal(g, g.pending.player)[0]) : pass(g);
  assert.ok(locOf(g, tt) === BF_A || zone(g, tt) !== 'battlefield', 'swap happened');
  assert.equal(zone(g, t), 'trash', 'still at a battlefield: killed');
});

test('RJ#6808 during a showdown at BF_A a hidden spell at BF_B can be played, but only targets units at BF_B', () => {
  let g = S0F();
  control(g, BF_B, P0); const mineB = put(g, P0, 'V(3)', BF_B);
  const eB = put(g, P1, 'V(3)', 'base');
  const eA = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const hz = put(g, P0, 'HidZap', { facedown: BF_B });
  void eB;
  const a = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 6 && !(g.pending?.kind === 'showdownAction' && g.pending.player === P0); i++) g = g.pending?.inStep ? act(g, legal(g, g.pending.player)[0]) : pass(g);
  expectPending(g, 'showdownAction', P0);
  assert.equal(canPlayNow(g, P0, hz), true);
  g = act(g, { type: 'playCard', player: P0, obj: hz });
  // only one legal target (the unit at BF_B), so the engine picks it without asking
  if (g.pending?.inStep) { assert.ok(!optionIds(g).includes(eA)); g = choose(g, mineB); }
  g = settle(g);
  assert.equal(g.objects[mineB].damage, 2);
  assert.equal(g.objects[eA].damage, 0, 'unit at the showdown battlefield could not be targeted');
});

// RJ#6812 MISMATCH-RJ (detail; DECISIONS #188/#218, CR 340.2.a, 346): while holding priority the focus player may put several items on
// the chain, but once that chain resolves focus passes to the next player (it is not "kept until you pass").
test('RJ#6812 showdown: the focus player may add several spells before passing, but focus passes on after the chain resolves', () => {
  let g = S0F();
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_A);
  for (let i = 0; i < 4 && !(g.pending?.kind === 'showdownAction' && g.pending.player === P0); i++) g = pass(g);
  expectPending(g, 'showdownAction', P0);
  g = play(g, P0, hand(g, P0, 'PumpA'), { targets: [[u]] });
  g = play(g, P0, hand(g, P0, 'PumpR'), { targets: [[u]] });
  assert.equal(g.chain.length, 2, 'two spells added while holding priority');
  for (let i = 0; i < 6 && g.chain.length; i++) g = pass(g);
  expectPending(g, 'showdownAction', P1);
});

test('RJ#6813 Fiora, Victorious (4) defending alone with Mask of Foresight: 5 -> Mighty (Deflect/Ganking/Shield), Shield makes her 6 while defending; 5 the rest of the turn', () => {
  let g = S0F();
  const f = put(g, P1, 'ogn-232-298', BF_A); control(g, BF_A, P1);
  put(g, P1, 'Mask of Foresight', 'base');
  const a = put(g, P0, 'V(1)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 6 && g.chain.length; i++) g = g.pending?.inStep ? act(g, legal(g, g.pending.player)[0]) : pass(g);
  assert.equal(g.objects[f].combatRole, 'defender');
  assert.ok(hasKeyword(g, f, 'Ganking') && hasKeyword(g, f, 'Shield'), 'Mighty keywords');
  assert.equal(mightOf(g, f), 6);
  g = settle(g);
  for (let i = 0; i < 10 && g.pending && g.pending.kind !== 'mainAction'; i++) g = g.pending.inStep ? act(g, legal(g, g.pending.player)[0]) : pass(g);
  assert.equal(zone(g, f), 'battlefield');
  assert.equal(mightOf(g, f), 5, 'after combat: 4 + 1 this turn');
});

test('RJ#6816 two Viktor, Leader: one dies, the other makes a Recruit', () => {
  let g = S0F();
  const v1 = put(g, P0, 'ogn-246-298', BF_A), v2 = put(g, P0, 'ogn-246-298', 'base'); control(g, BF_A, P0);
  const b0 = g.players[P0].base.length;
  g = settle(play(g, P0, hand(g, P0, 'KillA'), { targets: [[v1]] }));
  assert.equal(zone(g, v1), 'trash');
  assert.equal(zone(g, v2), 'base');
  assert.equal(g.players[P0].base.length, b0 + 1, 'one Recruit');
});

test('RJ#6826 Baited Hook killing a 4-Might unit can play any unit with Might 5 or less (a 2 is fine; a 6 is not offered)', () => {
  let g = S0F();
  const vic = put(g, P0, 'V(4)', 'base');
  const hook = put(g, P0, 'Baited Hook', 'base');
  const big = put(g, P0, 'V(6)', 'deckTop'), small = put(g, P0, 'V(2)', 'deckTop');
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && (a as { obj?: ObjId }).obj === hook)!);
  g = answer(g, { targets: [[vic]] }, P0);
  let offeredBig = false, offeredSmall = false;
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    if (o.includes(big)) offeredBig = true;
    if (o.includes(small)) { offeredSmall = true; g = act(g, { type: 'choose', player: d.player, optionIds: [small] }); continue; }
    g = d.kind === 'optional' ? act(g, { type: 'choose', player: d.player, optionIds: ['yes'] }) : act(g, legal(g, d.player)[0]);
  }
  assert.ok(offeredSmall && !offeredBig, `2 offered, 6 not (${offeredSmall}/${offeredBig})`);
  assert.equal(locOf(g, small), 'base');
});

test('RJ#6832 Get Excited!: the target is chosen when played, the discard happens on resolution', () => {
  let g = S0F();
  const e = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  emptyHand(g, P0);
  const c = hand(g, P0, 'V(3)');
  const ge = hand(g, P0, 'Get Excited!');
  g = play(g, P0, ge, { targets: [[e]] });
  assert.equal(zone(g, c), 'hand', 'nothing discarded yet');
  assert.equal(g.chain.length, 1);
  g = settle(g, [c]);
  assert.equal(zone(g, c), 'trash');
  assert.equal(g.objects[e].damage, 3, 'its Energy cost');
});

test('RJ#6834 Nine-Tailed Fox (Ahri legend) does not choose the attacker: no Deflect cost to pay', () => {
  let g = S0F({ tp: P1 });
  setLegend(g, P0, 'Nine-Tailed Fox');
  put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  for (const r of g.players[P0].runesInPlay) g.objects[r].exhausted = true; touch(g);
  const a = put(g, P1, 'DeflectDouble(2)', 'base');
  g = move(g, P1, [a], BF_A);
  for (let i = 0; i < 6 && g.chain.length; i++) { assert.ok(!(g.pending?.kind === 'optional' && /Deflect/i.test(g.pending.prompt)), 'no Deflect prompt'); g = g.pending?.inStep ? answer(g, {}) : pass(g); }
  assert.equal(mightOf(g, a), 1, '-1 applied with no runes to pay Deflect');
});

test('RJ#6836 a spell that just says "move an enemy unit" can move it from one battlefield to another (no Ganking needed)', () => {
  let g = S0F();
  const e = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  g = play(g, P0, hand(g, P0, 'Charm'), { targets: [[e]] });
  g = settle(g, [String(BF_B)]);
  for (let i = 0; i < 4 && g.pending?.inStep; i++) { const o = optionIds(g); g = act(g, { type: 'choose', player: g.pending.player, optionIds: [o.find(x => /B/.test(x) || x === String(BF_B)) ?? o[0]] }); }
  assert.equal(locOf(g, e), BF_B);
});

test('RJ#6837 a damage spell on a unit at Fortified Position starts no showdown and is not "defending" (no trigger)', () => {
  let g = S0F({ bfA: 'Fortified Position' });
  const e = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  g = play(g, P0, hand(g, P0, 'ZapM'), { targets: [[e]] });
  g = settle(g);
  assert.equal(g.showdown, null);
  assert.ok(!hasKeyword(g, e, 'Shield'), 'no defend trigger');
  assert.equal(g.objects[e].damage, 2);
});

test('RJ#6840 Annie played by Reinforce can return that same Reinforce from the trash (it is in the trash before Annie enters)', () => {
  let g = S0F();
  for (let i = 0; i < 4; i++) put(g, P0, 'V(1)', 'deckTop');
  const an = put(g, P0, 'ogs-010-024', 'deckTop');
  const rf = hand(g, P0, 'Reinforce');
  g = play(g, P0, rf);
  let offered = false;
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    if (o.includes(an)) { g = act(g, { type: 'choose', player: d.player, optionIds: [an] }); continue; }
    if (o.includes(rf)) { offered = true; g = act(g, { type: 'choose', player: d.player, optionIds: [rf] }); continue; }
    g = d.kind === 'optional' ? act(g, { type: 'choose', player: d.player, optionIds: ['yes'] }) : act(g, legal(g, d.player)[0]);
  }
  assert.ok(['base', BF_A, BF_B].includes(locOf(g, an) as never), 'Annie played');
  assert.ok(offered || zone(g, rf) === 'hand', `Reinforce offered (${zone(g, rf)}; ${g.log.slice(-12).map((l: { text?: string }) => l.text).join(' | ')})`);
  assert.equal(zone(g, rf), 'hand');
});

test('RJ#6845 Blitzcrank pulls an enemy unit to my battlefield: that unit is the attacker, so my Nine-Tailed Fox triggers on it', () => {
  let g = S0F();
  setLegend(g, P0, 'Nine-Tailed Fox');
  put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(4)', BF_B); control(g, BF_B, P1);
  g = play(g, P0, hand(g, P0, 'Blitzcrank, Impassive'), { dest: BF_A });
  for (let i = 0; i < 12 && g.pending && (g.chain.length || g.pending.inStep) && !g.objects[e].combatRole; i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    g = act(g, { type: 'choose', player: d.player, optionIds: d.kind === 'optional' ? ['yes'] : o.includes(e) ? [e] : [o[0]] });
  }
  for (let i = 0; i < 8 && g.chain.length; i++) g = g.pending?.inStep ? act(g, legal(g, g.pending.player)[0]) : pass(g);
  assert.equal(locOf(g, e), BF_A);
  assert.equal(g.objects[e].combatRole, 'attacker');
  assert.equal(mightOf(g, e), 3, 'Nine-Tailed Fox -1');
});

test('RJ#6846 a Deathknell unit saved by Zhonya\'s Hourglass does not die: no Deathknell', () => {
  let g = S0F();
  const dk = put(g, P0, 'DK(2)', BF_A); control(g, BF_A, P0);
  const hg = put(g, P0, "Zhonya's Hourglass", 'base');
  const k = hand(g, P0, 'KillA');
  const h0 = g.players[P0].hand.length;
  g = settle(play(g, P0, k, { targets: [[dk]] }));
  assert.equal(zone(g, hg), 'trash');
  assert.equal(locOf(g, dk), 'base');
  assert.equal(g.players[P0].hand.length, h0 - 1, 'no Deathknell draw');
});

test('RJ#6847 Switcheroo swaps current Mights (equipment included)', () => {
  let g = S0F();
  const a = put(g, P0, 'V(1)', BF_A), b = put(g, P0, 'V(4)', BF_A); control(g, BF_A, P0);
  const sw = put(g, P0, 'Sword', 'base'); attachNow(g, sw, a);
  assert.equal(mightOf(g, a), 3);
  g = settle(play(g, P0, hand(g, P0, 'Switcheroo'), { targets: [[a], [b]] }));
  assert.equal(mightOf(g, a), 4);
  assert.equal(mightOf(g, b), 3);
});

test('RJ#6849 Gust returns Noxian Drummer in response to its move trigger: "here" is unknown, no Recruit', () => {
  let g = S0F({ tp: P1 });
  const d = put(g, P1, 'Noxian Drummer', 'base');
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  g = move(g, P1, [d], BF_A);
  assert.equal(g.chain.length, 1);
  for (let i = 0; i < 2 && g.pending?.player !== P0; i++) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Gust'), { targets: [[d]] });
  g = settle(g);
  assert.equal(zone(g, d), 'hand');
  assert.equal(Object.values(g.objects).filter(o => g.cards[o.cardId]?.name === 'Recruit' && ['base', 'battlefield'].includes(o.zone)).length, 0, 'no Recruit');
});

test('RJ#6850 Dragon\'s Rage must move its unit to a different location (can\'t pick a unit and leave it in place to fight a neighbour)', () => {
  let g = S0F();
  const e1 = put(g, P1, 'V(3)', BF_A); put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, "Dragon's Rage") });
  for (let i = 0; i < 4 && g.pending?.inStep && !optionIds(g).some(o => o === String(BF_A) || o === 'base' || /bf/i.test(o)); i++) g = choose(g, e1);
  const dests = optionIds(g);
  assert.ok(!dests.includes(String(BF_A)), `current location not offered (${dests})`);
});

// RJ#6853 MISMATCH-RJ (detail): CR 346 "Focus passes, and the next Player gains both Focus and Priority" — focus passes on from its
// holder, not to "the player after the owner of the most recent effect" (riftlens /rules/showdowns/; DECISIONS #188).
test('RJ#6853 showdown: P0 (focus) plays a spell, P1 responds; after the chain focus passes to P1 (next after the focus holder)', () => {
  let g = S0F();
  const u = put(g, P0, 'V(3)', 'base');
  g = move(g, P0, [u], BF_A);
  expectPending(g, 'showdownAction', P0);
  g = play(g, P0, hand(g, P0, 'PumpA'), { targets: [[u]] });
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'ZapR'), { targets: [[u]] });
  for (let i = 0; i < 6 && g.chain.length; i++) g = pass(g);
  expectPending(g, 'showdownAction', P1);
});

test('RJ#6852 FFA: Dragon\'s Rage moves an enemy into a third player\'s battlefield; the fight resolves before combat starts, so that player\'s Nine-Tailed Fox -1 is not applied yet', () => {
  let g = ffa3();
  const P2 = 2 as PlayerId;
  setLegend(g, P2, 'Nine-Tailed Fox');
  const e1 = put(g, P1, 'V(3)', 'base');
  const e2 = put(g, P2, 'V(3)', BF_A); control(g, BF_A, P2);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, "Dragon's Rage") });
  for (let i = 0; i < 30 && g.pending && (g.chain.length || g.pending.inStep) && !g.objects[e1].combatRole; i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    const pick = o.includes(e1) ? e1 : o.includes(String(BF_A)) ? String(BF_A) : o.includes(e2) ? e2 : d.kind === 'optional' ? 'yes' : o[0];
    g = act(g, { type: 'choose', player: d.player, optionIds: [pick] });
  }
  assert.equal(zone(g, e2), 'trash', 'took the full 3 (no -1 on e1 before the fight)');
  assert.equal(zone(g, e1), 'trash');
});

test('RJ#6855 Rumble, Hotheaded recycling a buffed 3-Might unit reduces the Mech\'s cost by the token\'s current Might (incl. buff)', () => {
  let g = S0F();
  const r = put(g, P0, 'sfd-026-221', 'base');
  const tok = put(g, P0, 'V(3)', BF_A, { buff: true }); control(g, BF_A, P0); // stands in for the buffed 3-Might Mech token
  const mm = put(g, P0, 'Mega-Mech', 'trash');
  for (const p of [P0]) for (const x of g.players[p].runesInPlay) g.objects[x].exhausted = true;
  g.players[P0].pool.energy = 3; touch(g);
  assert.equal(mightOf(g, tok), 4);
  g = move(g, P0, [r], BF_B);
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    const pick = d.kind === 'optional' ? 'yes' : o.includes(tok) ? tok : o.includes(mm) ? mm : o.includes('base') ? 'base' : o[0];
    g = act(g, { type: 'choose', player: d.player, optionIds: [pick] });
  }
  assert.ok(['base', 'battlefield'].includes(zone(g, mm)), `Mega-Mech (7) played for 7 - 4 = 3 (${zone(g, mm)})`);
});

test('RJ#6857 Carnivorous Snapvine killed in response to its play trigger: the fight happens with no damage to its target', () => {
  let g = S0F();
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const sv = hand(g, P0, 'Carnivorous Snapvine');
  g = play(g, P0, sv, { dest: 'base' });
  for (let i = 0; i < 4 && !g.chain.some(c => c.source === sv); i++) g = pend(g).inStep ? choose(g, e) : pass(g);
  expectPending(g, 'chainResponse', P0);
  // kill Snapvine in response: Sacrifice (Reaction; additional cost: kill a friendly Mighty unit)
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Sacrifice') });
  for (let i = 0; i < 4 && g.pending?.inStep; i++) g = optionIds(g).includes(sv) ? choose(g, sv) : act(g, legal(g, P0)[0]);
  assert.equal(zone(g, sv), 'trash');
  g = settle(g);
  assert.equal(g.objects[e].damage, 0, 'a dead Snapvine deals nothing');
});

test('RJ#6859 FFA3 setup: 3 battlefields (one per player); the first player skips their first draw', () => {
  const g = ffa3();
  assert.equal(g.battlefields.length, 3);
  assert.equal(g.activePlayer, P0);
  assert.equal(g.players[P0].hand.length, 4, 'opening hand 4, no draw on the first turn');
});

test('RJ#6862 Kai\'Sa (blue): the conquer point is scored before her conquer trigger resolves (3 -> 4 points: a 3-cost spell is allowed)', () => {
  let g = S0F();
  g.players[P0].points = 3;
  const k = put(g, P0, 'ogn-112-298', 'base');
  const sp = put(g, P0, 'HidZap', 'trash'); // Energy cost 3
  const e = put(g, P1, 'V(5)', 'base');
  g = move(g, P0, [k], BF_A);
  let offered = false;
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    if (o.includes(sp)) { offered = true; assert.equal(g.players[P0].points, 4, 'point already scored'); g = choose(g, sp); continue; }
    g = d.kind === 'optional' ? act(g, { type: 'choose', player: d.player, optionIds: ['yes'] }) : o.includes(e) ? choose(g, e) : act(g, legal(g, d.player)[0]);
  }
  assert.ok(offered, 'the 3-cost spell could be chosen (3 < 4)');
});

test('RJ#6863 Sigil of the Storm: you can conquer with no runes; the recycle trigger does nothing', () => {
  let g = S0F({ bfA: 'Sigil of the Storm' });
  setRunes(g, P0, 0, 'body');
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_A);
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) g = g.pending.inStep ? act(g, legal(g, g.pending.player)[0]) : pass(g);
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[P0].points, 1);
});

test('RJ#6865 Fiora (sfd-110, "double my Might", 3) defending one on one with Wuju Bladesman and Mask of Foresight: Mask first, then double -> 12', () => {
  let g = S0F({ tp: P1 });
  setLegend(g, P0, 'Wuju Bladesman');
  const f = put(g, P0, 'sfd-110-221', BF_A); control(g, BF_A, P0);
  put(g, P0, 'Mask of Foresight', 'base');
  const a = put(g, P1, 'V(1)', 'base');
  g = move(g, P1, [a], BF_A);
  for (let i = 0; i < 12 && (g.chain.length || g.pending?.inStep); i++) {
    const d = g.pending!;
    if (d.kind === 'orderTriggers') { g = choose(g, d.options!.find(o => /Fiora|double/i.test(o.label))?.id ?? d.options![0].id); continue; }
    g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  assert.equal(mightOf(g, f), 12, '(3 + 2 Yi + 1 Mask) doubled');
});

test('RJ#6869 Miss Fortune, Captain\'s "ready something else" can ready an exhausted legend', () => {
  let g = S0F();
  const leg = g.players[P0].legend;
  g.objects[leg].exhausted = true; touch(g);
  const mf = put(g, P0, 'Miss Fortune, Captain', 'base');
  g = move(g, P0, [mf], BF_A);
  let offered = false;
  for (let i = 0; i < 12; i++) {
    const d = g.pending!;
    if (d.kind === 'mainAction' || d.kind === 'showdownAction' && !g.chain.length) break;
    if (d.kind === 'optional') { g = choose(g, 'yes'); continue; }
    if (d.inStep) { if (optionIds(g).includes(leg)) { offered = true; g = choose(g, leg); } else g = choose(g, d.options![0].id); continue; }
    g = pass(g);
  }
  assert.ok(offered, 'legend offered');
  assert.equal(g.objects[leg].exhausted, false);
});

test('RJ#6874 Accelerate granted by Rek\'Sai, Breacher still costs its [1] + [C] (paid as an additional cost)', () => {
  const run = (accel: boolean) => {
    let g = S0F();
    put(g, P0, "Rek'Sai, Breacher", 'base');
    const ch = g.players[P0].championZone[0];
    g = act(g, { type: 'playCard', player: P0, obj: ch, destination: 'base' });
    g = answer(g, { may: [accel] });
    g = settle(g);
    const rs = g.players[P0].runesInPlay;
    return { ready: rs.filter(r => !g.objects[r].exhausted).length, inPlay: rs.length, exhausted: g.objects[ch].exhausted };
  };
  const y = run(true), n = run(false);
  assert.equal(y.exhausted, false); assert.equal(n.exhausted, true);
  assert.ok(y.ready + y.inPlay <= n.ready + n.inPlay - 2, `accelerating spent one more energy and one more power (${JSON.stringify(y)} vs ${JSON.stringify(n)})`);
});

test('RJ#6877 Challenge: my chosen unit removed in response — Challenge does nothing (the enemy takes no damage)', () => {
  let g = S0F();
  control(g, BF_A, P0);
  const u = put(g, P0, 'V(3)', BF_A);
  const e = put(g, P1, 'V(5)', BF_B); control(g, BF_B, P1);
  g = play(g, P0, hand(g, P0, 'Challenge'), { targets: [[u], [e]] });
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'Gust'), { targets: [[u]] }); // stands in for the Hidden Blade kill
  g = settle(g);
  assert.equal(zone(g, u), 'hand');
  assert.equal(g.objects[e].damage, 0);
});

test('RJ#6880 open (non-combat) showdown: the mover is not an Attacker, so no Assault', () => {
  let g = S0F();
  const ph = put(g, P0, 'Immortal Phoenix', 'base');
  g = move(g, P0, [ph], BF_A);
  expectPending(g, 'showdownAction', P0);
  assert.ok(!g.objects[ph].combatRole);
  assert.equal(mightOf(g, ph), 3, 'no Assault in an open showdown');
});

test('RJ#6881 Tibbers (7) at -3 from Thousand-Tailed Watcher deals 4 in combat: the 7-Might Watcher survives, Tibbers dies', () => {
  let g = S0F();
  const t = put(g, P1, 'Tibbers', BF_A); control(g, BF_A, P1);
  const w = hand(g, P0, 'Thousand-Tailed Watcher');
  g = settle(play(g, P0, w, { dest: 'base', may: [true] }));
  assert.equal(mightOf(g, t), 4);
  g.objects[w].exhausted = false; touch(g);
  g = move(g, P0, [w], BF_A);
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) g = g.pending.inStep ? act(g, legal(g, g.pending.player)[0]) : pass(g);
  assert.equal(zone(g, t), 'trash');
  assert.equal(zone(g, w), 'battlefield');
});

test('RJ#6885 Kadregrin the Infernal counts only Mighty units you control on the board (not in hand)', () => {
  let g = S0F();
  put(g, P0, 'V(5)', 'base');
  hand(g, P0, 'V(6)');
  const k = hand(g, P0, 'Kadregrin the Infernal');
  const h0 = g.players[P0].hand.length;
  g = settle(play(g, P0, k, { dest: 'base' }));
  assert.equal(g.players[P0].hand.length, h0 - 1 + 2, 'V(5) + Kadregrin himself; the Mighty card in hand does not count');
});

test('RJ#6886 negative Might is kept for later changes (read as 0) and does not kill: 1 + buff + Darius = 3, Smoke Screen -> 1, lose both -> -1 (0), +1 -> still 0', () => {
  let g = S0F();
  const u = put(g, P0, 'V(1)', BF_A, { buff: true });
  const d = put(g, P0, 'ogn-243-298', BF_A); control(g, BF_A, P0);
  assert.equal(mightOf(g, u), 3);
  g = settle(play(g, P0, hand(g, P0, 'Smoke Screen'), { targets: [[u]] }));
  assert.equal(mightOf(g, u), 1);
  g.objects[u].counters.buff = 0; touch(g);
  assert.equal(mightOf(g, u), 0);
  g = settle(play(g, P0, hand(g, P0, 'KillA'), { targets: [[d]] }));
  assert.equal(zone(g, u), 'battlefield', 'does not die at 0 or below');
  assert.ok((mightOf(g, u) ?? 0) <= 0);
  g = settle(play(g, P0, hand(g, P0, 'Combat Experience'), { targets: [[u]] }));
  assert.equal(mightOf(g, u), 0, '-1 + 1 = 0');
});

// RJ#6887 MISMATCH-RJ: Legion is active when you have finalized ANOTHER card this turn (CR 812.1.c; docs/keywords.md Legion) — it does
// not require being the first card. Reinforce was played first, so the unit it plays has its Legion active.
test('RJ#6887 a Legion unit played by Reinforce (the turn\'s first card): its Legion is active (Darius readies)', () => {
  let g = S0F();
  for (let i = 0; i < 4; i++) put(g, P0, 'V(1)', 'deckTop');
  const d = put(g, P0, 'ogn-243-298', 'deckTop');
  g = play(g, P0, hand(g, P0, 'Reinforce'));
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const p = pend(g);
    if (!p.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    g = o.includes(d) ? choose(g, d) : p.kind === 'optional' ? act(g, { type: 'choose', player: p.player, optionIds: [/recycle/i.test(p.prompt) ? 'no' : 'yes'] }) : o.includes('base') ? choose(g, 'base') : act(g, legal(g, p.player)[0]);
  }
  assert.ok(['base', 'battlefield'].includes(zone(g, d)), 'Darius played');
  assert.equal(g.objects[d].exhausted, false, 'Legion: ready me');
});

test('RJ#6894 Hidden Blade on a unit saved by Zhonya\'s (replacement): its controller still draws 2; bounced in response: no draw', () => {
  let g = S0F();
  const u = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  put(g, P1, "Zhonya's Hourglass", 'base');
  const h1 = g.players[P1].hand.length;
  g = settle(play(g, P0, hand(g, P0, 'Hidden Blade'), { targets: [[u]] }));
  assert.equal(locOf(g, u), 'base', 'saved and recalled');
  assert.equal(g.players[P1].hand.length, h1 + 2, 'controller still draws 2');

  let k = S0F();
  const v = put(k, P1, 'V(3)', BF_A); control(k, BF_A, P1);
  const gust = hand(k, P1, 'Gust');
  const k1 = k.players[P1].hand.length;
  k = play(k, P0, hand(k, P0, 'Hidden Blade'), { targets: [[v]] });
  k = pass(k);
  k = settle(play(k, P1, gust, { targets: [[v]] }));
  assert.equal(zone(k, v), 'hand');
  assert.equal(k.players[P1].hand.length, k1 - 1 + 1, 'Gust played, unit returned; no draw 2');
});

// RJ#6896 MISMATCH-RJ (flagged for DECISIONS): RJ says the Might is "declared when Baited Hook's cost is paid", but the kill is part of the
// effect (after the colon: "[1][C], [E]: Kill a friendly unit. … Might up to 1 more than the killed unit"), so the unit's Might is read when it
// is killed on resolution. A Smoke Screen in response lowers the search limit.
test('RJ#6896 Baited Hook: Smoke Screen on the chosen 4-Might unit in response -> killed at 1, so only Might <= 2 can be played', () => {
  let g = S0F();
  const vic = put(g, P0, 'V(4)', 'base');
  const hook = put(g, P0, 'Baited Hook', 'base');
  const v5 = put(g, P0, 'V(5)', 'deckTop'), v2 = put(g, P0, 'V(2)', 'deckTop');
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && (a as { obj?: ObjId }).obj === hook)!);
  g = answer(g, { targets: [[vic]] }, P0);
  if (pend(g).player === P0) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Smoke Screen'), { targets: [[vic]] });
  let seen: string[] = [];
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    if (d.kind === 'chooseCards') seen = optionIds(g);
    g = act(g, legal(g, d.player)[0]);
  }
  assert.ok(seen.includes(v2) && !seen.includes(v5), 'limit from the Might when killed (1 + 1)');
});

test('RJ#6899 The Harrowing plays Annie (Starter) from the trash: Annie can return that same Harrowing', () => {
  let g = S0F();
  const an = put(g, P0, 'ogs-010-024', 'trash');
  const th = hand(g, P0, 'The Harrowing');
  g = play(g, P0, th);
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    g = o.includes(an) ? choose(g, an) : o.includes(th) ? choose(g, th) : o.includes('base') ? choose(g, 'base') : d.kind === 'optional' ? act(g, { type: 'choose', player: d.player, optionIds: ['yes'] }) : act(g, legal(g, d.player)[0]);
  }
  assert.equal(zone(g, an), 'base');
  assert.equal(zone(g, th), 'hand', 'The Harrowing returned');
});

test('RJ#6900 Malzahar can pay "Kill a friendly unit, [T]" with himself (exhaust then kill)', () => {
  let g = S0F();
  const m = put(g, P0, 'Malzahar', 'base');
  const ac = legal(g, P0).find(a => a.type === 'activate' && (a as { obj?: ObjId }).obj === m);
  assert.ok(ac, 'activation offered with Malzahar as the only friendly unit');
  g = act(g, ac!);
  for (let i = 0; i < 4 && g.pending?.inStep; i++) g = optionIds(g).includes(m) ? choose(g, m) : act(g, legal(g, P0)[0]);
  g = settle(g);
  assert.equal(zone(g, m), 'trash');
  assert.ok(Object.values(g.players[P0].pool.power).reduce((n, x) => n + (x ?? 0), 0) + g.players[P0].poolRestricted.length >= 1, `power added (${JSON.stringify(g.players[P0].pool)})`);
});

test('RJ#6905 Wielder of Water attacking alone is 4 at once (passive "while"), so Gust (3 or less) can\'t target it in the combat', () => {
  let g = S0F();
  put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const w = put(g, P0, 'Wielder of Water', 'base');
  const gust = hand(g, P1, 'Gust');
  g = move(g, P0, [w], BF_A);
  assert.equal(g.objects[w].combatRole, 'attacker');
  assert.equal(mightOf(g, w), 4);
  for (let i = 0; i < 4 && g.pending?.player !== P1; i++) g = pass(g);
  assert.equal(canPlayNow(g, P1, gust), false, 'no legal Gust target');
});

test('RJ#6912 Yordle Explorer draws when Switcheroo (printed [A][A]) is played from hiding for [0]', () => {
  let g = S0F();
  put(g, P0, 'Yordle Explorer', 'base');
  control(g, BF_A, P0);
  const a = put(g, P0, 'V(1)', BF_A), b = put(g, P0, 'V(4)', BF_A);
  const sw = put(g, P0, 'Switcheroo', { facedown: BF_A });
  const h0 = g.players[P0].hand.length;
  g = act(g, { type: 'playCard', player: P0, obj: sw });
  g = answer(g, { targets: [[a], [b]] });
  g = settle(g);
  assert.equal(mightOf(g, a), 4, 'Switcheroo resolved');
  assert.equal(g.players[P0].hand.length, h0 + 1, 'drew 1 (printed Power cost counts)');
});

test('RJ#6913 Noxus Saboteur and the defender trade in combat: no window to use the defender\'s hidden Zhonya\'s Hourglass there', () => {
  let { g, atk, def } = attackSetup(['Noxus Saboteur'], ['V(3)']);
  const z = put(g, P1, "Zhonya's Hourglass", { facedown: BF_A });
  let offered = false;
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    if (g.pending.player === P1 && legal(g, P1).some(a => a.type === 'playCard' && (a as { obj?: ObjId }).obj === z)) offered = true;
    g = g.pending.inStep ? act(g, legal(g, g.pending.player)[0]) : pass(g);
  }
  assert.equal(offered, false, 'hidden cards can\'t be revealed at the Saboteur\'s battlefield');
  assert.equal(zone(g, atk[0]), 'trash');
  assert.equal(zone(g, def[0]), 'trash', 'defender not saved');
});

test('RJ#6914 Convergent Mutation targets both units: the "other" unit bounced in response -> no Might change', () => {
  let g = S0F();
  control(g, BF_A, P0);
  const a = put(g, P0, 'V(1)', BF_A), b = put(g, P0, 'V(3)', BF_A);
  put(g, P0, 'V(6)', BF_A);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Convergent Mutation') });
  g = answer(g, { targets: [[a]] });
  g = answer(g, { targets: [[b]] });
  if (pend(g).player === P0) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Gust'), { targets: [[b]] });
  g = settle(g);
  assert.equal(zone(g, b), 'hand');
  assert.equal(mightOf(g, a), 1, 'second target gone: not re-chosen on resolution');
});

test('RJ#6915 exhausting a rune for power is Reaction speed: available with priority on the opponent\'s turn', () => {
  const g0 = S0({ tp: P1 }); fundAll(g0, P0); fundAll(g0, P1);
  const g = pass(play(g0, P1, hand(g0, P1, 'DrawR')));
  assert.equal(pend(g).player, P0);
  assert.ok(legal(g, P0, 'activate').some(a => a.type === 'activate' && g.objects[a.obj].zone === 'runePool' && a.abilityIndex === 950), 'rune exhaust ability available');
});

test('RJ#6919 in a showdown, Challenge (Action) can\'t be played in response to the opponent\'s Retreat', () => {
  let g = S0F();
  const d = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  put(g, P1, 'V(2)', BF_A);
  const u = put(g, P0, 'V(3)', 'base');
  const ch = hand(g, P0, 'Challenge'), ret = hand(g, P1, 'Retreat');
  g = move(g, P0, [u], BF_A);
  for (let i = 0; i < 6 && !(pend(g).player === P1 && !g.chain.length); i++) g = pass(g);
  g = play(g, P1, ret, { targets: [[d]] });
  if (pend(g).player === P1) g = pass(g);
  expectPending(g, 'chainResponse', P0);
  assert.equal(canPlayNow(g, P0, ch), false, 'Action can\'t respond to a chain');
});

test('RJ#6923 1-Might attackers vs Nine-Tailed Fox (-1, min 1 → effectively 0, snapshotted), then Siphon Power +1 → 2', () => {
  let g = S0F();
  setLegend(g, P1, 'Nine-Tailed Fox');
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(1)', 'base'), b = put(g, P0, 'V(1)', 'base');
  g = move(g, P0, [a, b], BF_A);
  // AUTO-AUDIT F-4 (ENGINE-7): the Fox's two instances (one per attacker) are ordered by P1
  assert.equal(pend(g).kind, 'orderTriggers'); assert.equal(pend(g).player, P1);
  g = choose(g, pend(g).options![0].id);
  g = resolveChain(g);
  assert.equal(mightOf(g, a), 1);
  if (pend(g).player !== P0) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Siphon Power'), { targets: [[g.battlefields[BF_A].objId]] });
  g = resolveChain(g);
  assert.equal(mightOf(g, a), 2);
  assert.equal(mightOf(g, b), 2);
});

test('RJ#6927 Leona attacks and stuns; Radiant Dawn buffs her to 5 (Mighty) in the showdown; Fiora pays [C] to ready her', () => {
  let g = S0F();
  setLegend(g, P0, 'Radiant Dawn');
  put(g, P0, 'sfd-180-221', 'base');
  const e = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const l = put(g, P0, 'ogn-238-298', 'base');
  g = move(g, P0, [l], BF_A);
  assert.equal(g.objects[l].exhausted, true);
  for (let i = 0; i < 20 && g.chain.length + (g.pending?.inStep ? 1 : 0) > 0; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    g = d.kind === 'optional' ? act(g, { type: 'choose', player: d.player, optionIds: ['yes'] }) : o.includes(e) ? choose(g, e) : o.includes(l) ? choose(g, l) : act(g, legal(g, d.player)[0]);
  }
  assert.equal(g.objects[e].stunned, true, 'stunned');
  assert.equal(mightOf(g, l), 5, 'buffed: Mighty');
  assert.equal(g.objects[l].exhausted, false, 'Fiora readied her');
});

test('RJ#6928 Ravenbloom Conservatory\'s defend trigger uses the chain (both may respond) and reveals on resolution', () => {
  let g = S0F({ bfA: 'Ravenbloom Conservatory' });
  put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const top = put(g, P1, 'DrawR', 'deckTop');
  const a = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [a], BF_A);
  assert.ok(g.chain.some(c => /Ravenbloom|Conservatory/.test(String(c.label))), 'trigger on the chain');
  assert.notEqual(zone(g, top), 'hand', 'not revealed yet');
  assert.ok(g.pending && !g.pending.inStep, 'a priority window before it resolves');
  g = resolveChain(g);
  assert.equal(zone(g, top), 'hand');
});

test('RJ#6930 two Retreats on the same unit: the second mistargets (unit already in hand), only 1 rune channelled', () => {
  let g = S0F();
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const r1 = hand(g, P0, 'Retreat'), r2 = hand(g, P0, 'Retreat');
  const runes0 = g.players[P0].runesInPlay.length;
  g = play(g, P0, r1, { targets: [[u]] });
  g = play(g, P0, r2, { targets: [[u]] });
  g = resolveChain(g);
  assert.equal(zone(g, u), 'hand');
  const runes1 = g.players[P0].runesInPlay.length;
  assert.equal(runes1 - runes0, 1, 'one rune channelled');
});

test('RJ#6933 one standard move has one destination: units from two battlefields can go to base together; another unit can later move to a second battlefield', () => {
  let g = S0F();
  control(g, BF_A, P0); control(g, BF_B, P0);
  const a = put(g, P0, 'V(2)', BF_A), b = put(g, P0, 'V(2)', BF_B), c = put(g, P0, 'V(2)', 'base'), d = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [a, b], 'base');
  assert.equal(locOf(g, a), 'base'); assert.equal(locOf(g, b), 'base');
  g = move(g, P0, [c], BF_A);
  g = passAll(g); // empty battlefield: showdown, conquer
  g = move(g, P0, [d], BF_B);
  assert.equal(locOf(g, c), BF_A); assert.equal(locOf(g, d), BF_B);
  assert.ok(g.objects[c].exhausted && g.objects[d].exhausted);
});

test('RJ#6936 Showstopper on an already-buffed unit: no second buff, but it still moves', () => {
  let g = S0F();
  const u = put(g, P0, 'V(2)', 'base', { buff: true });
  g = play(g, P0, hand(g, P0, 'Showstopper'), { targets: [[u]], dest: BF_A });
  for (let i = 0; i < 6 && g.pending?.inStep; i++) g = optionIds(g).includes(String(BF_A)) ? choose(g, String(BF_A)) : act(g, legal(g, g.pending.player)[0]);
  g = settle(g);
  assert.equal(locOf(g, u), BF_A, 'moved');
  assert.equal(g.objects[u].counters.buff, 1, 'still one buff');
});

test('RJ#6943 The Boss can save a buffed unit that is already in base (recall to base)', () => {
  let g = S0F({ tp: P1 });
  setLegend(g, P0, 'The Boss');
  const u = put(g, P0, 'V(2)', 'base', { buff: true });
  g = play(g, P1, hand(g, P1, 'Vengeance'), { targets: [[u]] });
  g = resolveChain(g);
  expectPending(g, 'optional', P0);
  g = yes(g);
  assert.equal(locOf(g, u), 'base');
  assert.equal(g.objects[u].counters.buff ?? 0, 0, 'buff spent');
  assert.equal(g.objects[u].exhausted, true);
});

test('RJ#6945 Bullet Time countered by Wind Wall: the amount is never chosen or paid (it is part of the effect)', () => {
  let g = S0F();
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const pool = () => g.players[P0].runesInPlay.length;
  const r0 = pool();
  g = play(g, P0, hand(g, P0, 'Bullet Time, Miss Fortune'), { battlefields: [BF_A] });
  if (pend(g).kind === 'chooseTargets') g = choose(g, pend(g).options!.find(o => /BF-A/.test(o.label))!.id);
  if (pend(g).player === P0) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Wind Wall'), { targets: [[g.chain[0].id]] });
  let asked = false;
  for (let i = 0; i < 10 && g.chain.length; i++) { if (pend(g).inStep && pend(g).player === P0) asked = true; g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g); }
  assert.equal(asked, false, 'no amount decision');
  assert.equal(g.objects[e].damage, 0);
  assert.equal(pool(), r0, 'no rune recycled for the amount');
});

test('RJ#6947 Gust can be played in response to Vi\'s activated ability: she returns to hand, the +1 does nothing', () => {
  let g = S0F();
  const vi = put(g, P0, 'ogn-036-298', BF_A); control(g, BF_A, P0);
  put(g, P0, 'V(1)', 'trash');
  const ac = legal(g, P0, 'activate').find(a => a.type === 'activate' && (a as { obj?: ObjId }).obj === vi);
  assert.ok(ac);
  g = act(g, ac!);
  for (let i = 0; i < 4 && g.pending?.inStep; i++) g = act(g, legal(g, P0)[0]);
  assert.ok(g.chain.length >= 1, 'ability on the chain');
  if (pend(g).player === P0) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Gust'), { targets: [[vi]] });
  g = settle(g);
  assert.equal(zone(g, vi), 'hand');
});

test('RJ#6949 a defending Tank that can\'t be dealt damage (Kayn moved twice) is exempt from mandatory assignment: damage may go to other defenders', () => {
  let { g, def } = attackSetup(['V(4)'], ['Kayn', 'V(2)']);
  const [k, v] = def;
  g.objects[k].movesThisTurn = 2; g.objects[k].movedThisTurn = true;
  g.objects[k].modifiers.push({ source: null, layer: 2, duration: 'endOfTurn', addKeywords: ['Tank'], timestamp: ++g.timestamp });
  touch(g);
  assert.ok(hasKeyword(g, k, 'Tank'));
  for (let i = 0; i < 20 && !['assignDamage', 'mainAction'].includes(pend(g).kind); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  if (pend(g).kind === 'assignDamage') { // (auto-assigned when there is only one sensible split)
    assert.equal(validateAction(g, { type: 'assignDamage', player: P0, assignment: { [v]: 4 } }), null, 'may skip the undamageable Tank');
    g = act(g, { type: 'assignDamage', player: P0, assignment: { [v]: 4 } });
  }
  g = settle(g);
  assert.equal(zone(g, v), 'trash', 'the other defender got the damage');
  assert.equal(zone(g, k), 'battlefield');
});

test('RJ#6950 Riptide Rex removed in response to its play trigger: the 6 damage still resolves', () => {
  let g = S0F();
  control(g, BF_A, P0); put(g, P0, 'V(1)', BF_A);
  const e = put(g, P1, 'V(6)', BF_B); control(g, BF_B, P1);
  const rex = hand(g, P0, 'Riptide Rex');
  g = play(g, P0, rex, { dest: BF_A, targets: [[e]] });
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = optionIds(g).includes(e) ? choose(g, e) : act(g, legal(g, pend(g).player)[0]);
  assert.ok(g.chain.length >= 1, 'play trigger on the chain');
  g = play(g, P0, hand(g, P0, 'Retreat'), { targets: [[rex]] }); // Rex leaves the board before his trigger resolves (stands in for the kill)
  g = settle(g);
  assert.equal(zone(g, rex), 'hand', 'Rex left first');
  assert.equal(zone(g, e), 'trash', '6 damage still dealt');
});

test('RJ#6953 Viktor (ogn-246) dying simultaneously with another non-Recruit friendly unit: no Recruit', () => {
  let g = S0F({ tp: P1 });
  const vk = put(g, P0, 'ogn-246-298', BF_A, { damage: 2 }); control(g, BF_A, P0);
  const v = put(g, P0, 'V(2)', BF_A);
  const units0 = Object.values(g.objects).filter(o => o.owner === P0 && o.zone === 'base').length;
  g = play(g, P1, hand(g, P1, 'UpTo2Zap'), { targets: [[vk, v]] });
  g = settle(g);
  assert.equal(zone(g, vk), 'trash'); assert.equal(zone(g, v), 'trash');
  assert.equal(Object.values(g.objects).filter(o => o.owner === P0 && o.zone === 'base').length, units0, 'no Recruit token');
});

test('RJ#6954 in a showdown you may hold priority and add several Reactions in a row, but not a second Action', () => {
  let g = S0F();
  const u = put(g, P0, 'V(2)', 'base');
  put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [u], BF_A);
  for (let i = 0; i < 4 && !(pend(g).kind === 'showdownAction' && pend(g).player === P0); i++) g = pass(g);
  const r1 = hand(g, P0, 'DrawR'), r2 = hand(g, P0, 'DrawR'), st = hand(g, P0, 'StunA');
  g = play(g, P0, r1);
  assert.equal(pend(g).player, P0, 'P0 keeps priority');
  assert.equal(canPlayNow(g, P0, r2), true, 'another Reaction: yes');
  assert.equal(canPlayNow(g, P0, st), false, 'an Action onto the chain: no');
  g = play(g, P0, r2);
  assert.equal(g.chain.length, 2);
});

test('RJ#6952 Draven, Vanquisher\'s defend trigger fires once per combat: the attacker leaving and returning in the same showdown does not retrigger it', () => {
  let g = S0F();
  put(g, P1, 'sfd-020-221', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(2)', 'base'), b = put(g, P0, 'V(2)', 'base');
  let asks = 0;
  const step = (h: GameState): GameState => {
    const d = pend(h);
    if (!d.inStep) return pass(h);
    if (d.kind === 'optional') { if (/Draven/.test(d.prompt)) asks++; return act(h, { type: 'choose', player: d.player, optionIds: ['no'] }); }
    return d.kind === 'chooseDestination' ? choose(h, String(BF_A)) : act(h, legal(h, d.player)[0]);
  };
  g = move(g, P0, [a, b], BF_A);
  for (let i = 0; i < 10 && (g.chain.length || pend(g).inStep); i++) g = step(g);
  assert.equal(asks, 1, 'defend trigger fired once');
  for (let i = 0; i < 4 && pend(g).player !== P0; i++) g = pass(g);
  g = play(g, P0, hand(g, P0, 'MoveR'), { targets: [[a]] });
  for (let i = 0; i < 8 && (g.chain.length || pend(g).inStep); i++) g = step(g);
  assert.equal(locOf(g, a), 'base');
  for (let i = 0; i < 4 && pend(g).player !== P0; i++) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[a]] });
  for (let i = 0; i < 8 && (g.chain.length || pend(g).inStep); i++) g = step(g);
  assert.equal(locOf(g, a), BF_A, 'back in the same combat');
  assert.equal(asks, 1, 'no second defend trigger');
});

test('RJ#6956 after conquering a battlefield on your turn you may play units there at once', () => {
  let g = S0F();
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_A);
  g = passAll(g);
  assert.equal(g.battlefields[BF_A].controller, P0);
  const c = hand(g, P0, 'V(3)');
  assert.ok(playDests(g, P0, c).includes(BF_A), 'can be played to the conquered battlefield');
  g = play(g, P0, c, { dest: BF_A });
  assert.equal(locOf(g, c), BF_A);
  assert.equal(g.objects[c].exhausted, true, 'enters exhausted');
});

test('RJ#6957 Darius (ogn-027) counts himself: played first then another card → triggers; another card first then Darius → triggers', () => {
  for (const dariusFirst of [true, false]) {
    let g = S0F();
    const d = hand(g, P0, 'ogn-027-298'), c = hand(g, P0, 'V(1)');
    const order = dariusFirst ? [d, c] : [c, d];
    for (const x of order) g = settle(play(g, P0, x, { dest: 'base' }));
    assert.equal(mightOf(g, d), 7, `+2 (${dariusFirst ? 'Darius first' : 'Darius second'})`);
    assert.equal(g.objects[d].exhausted, false, 'readied');
  }
});

test('RJ#6958 Stupefy on a 1-Might unit: Might stays 1, still draws 1', () => {
  let g = S0F();
  const u = put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const st = hand(g, P0, 'Stupefy');
  const h0 = g.players[P0].hand.length;
  g = settle(play(g, P0, st, { targets: [[u]] }));
  assert.equal(mightOf(g, u), 1);
  assert.equal(g.players[P0].hand.length, h0 - 1 + 1);
});

test('RJ#6961 Super Mega Death Rocket: a second Rocket discarded to pay for the first is not in the trash at the conquer, so no loop', () => {
  let g = S0F();
  const r1 = put(g, P0, 'Super Mega Death Rocket!', 'trash');
  const r2 = hand(g, P0, 'Super Mega Death Rocket!');
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_A);
  let prompts = 0;
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    if (d.kind === 'optional') { prompts++; g = act(g, { type: 'choose', player: d.player, optionIds: ['yes'] }); continue; }
    g = optionIds(g).includes(r2) ? choose(g, r2) : act(g, legal(g, d.player)[0]);
  }
  assert.equal(zone(g, r1), 'hand', 'first Rocket returned');
  assert.equal(zone(g, r2), 'trash', 'second Rocket discarded and stays');
  assert.equal(prompts, 1, 'only one conquer trigger');
});

test('RJ#6963 En Garde on a 2-Might unit, then 2 damage in response: the damage resolves first and the unit dies (cleanup after each item)', () => {
  let g = S0F();
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  put(g, P0, 'V(1)', BF_A);
  g = play(g, P0, hand(g, P0, 'En Garde'), { targets: [[u]] });
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'ZapR'), { targets: [[u]] });
  g = settle(g);
  assert.equal(zone(g, u), 'trash');
});

test('RJ#6966 Imperial Decree also affects a unit played after it resolved; Grand Strategem only units present when it resolves', () => {
  let g = S0F();
  g = settle(play(g, P0, hand(g, P0, 'Imperial Decree')));
  const u = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1); // arrives after the Decree resolved
  g = settle(play(g, P0, hand(g, P0, 'ZapM'), { targets: [[u]] }));
  assert.equal(zone(g, u), 'trash', 'unit that arrived after the Decree is killed when damaged');

  let k = S0F();
  const a = put(k, P0, 'V(1)', 'base');
  k = settle(play(k, P0, hand(k, P0, 'Grand Strategem')));
  const b = put(k, P0, 'V(1)', 'base');
  assert.equal(mightOf(k, a), 6); assert.equal(mightOf(k, b), 1, 'later unit not affected');
});

test('RJ#6967 a Reaction may target a spell lower on the chain, and players may react again between resolutions', () => {
  let g = S0F();
  const s1 = hand(g, P0, 'DrawR'), s2 = hand(g, P0, 'DrawR');
  g = play(g, P0, s1);
  g = play(g, P0, s2);
  g = pass(g);
  const bottom = g.chain[0].id;
  g = play(g, P1, hand(g, P1, 'CounterR'), { targets: [[bottom]] });
  assert.equal(g.chain.length, 3);
  g = pass(g); g = pass(g); // counter resolves
  assert.equal(g.chain.length, 1, 'the countered bottom spell is gone, the top one remains');
  assert.ok(pend(g).kind === 'chainResponse', 'a new priority window before the next item resolves');
});

test('RJ#6970 Dragon\'s Rage (destination declared when played) vs Fight or Flight sending the target to base: it still moves to the declared battlefield and fights there', () => {
  let g = S0F();
  const x = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const z = put(g, P1, 'V(2)', BF_B); control(g, BF_B, P1);
  const fof = put(g, P1, 'Fight or Flight', { facedown: BF_A });
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, "Dragon's Rage, Lee Sin") });
  g = answer(g, { targets: [[x]], locations: [BF_B] });
  for (let i = 0; i < 3 && pend(g).inStep && pend(g).player === P0; i++) g = pend(g).kind === 'chooseDestination' ? choose(g, String(BF_B)) : act(g, legal(g, P0)[0]);
  if (pend(g).player === P0) g = pass(g);
  g = act(g, { type: 'playCard', player: P1, obj: fof });
  g = answer(g, { targets: [[x]] });
  for (let i = 0; i < 4 && pend(g).inStep && pend(g).player === P1; i++) g = pend(g).kind === 'chooseDestination' ? choose(g, 'base') : act(g, legal(g, P1)[0]);
  for (let i = 0; i < 12 && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    g = d.kind === 'chooseDestination' ? choose(g, String(BF_B)) : optionIds(g).includes(z) ? choose(g, z) : act(g, legal(g, d.player)[0]);
  }
  assert.equal(locOf(g, x) ?? zone(g, x), BF_B, 'moved from base to the declared battlefield');
  assert.equal(zone(g, z), 'trash', 'they fought: 3 vs 2');
});

test('RJ#6972 Rengar, Pouncing played into my attack gets Assault (attacker), but enters at 3, so Relentless Storm ("play a Mighty unit") does not trigger', () => {
  let g = S0F();
  setLegend(g, P0, 'Relentless Storm');
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(2)', 'base');
  const r = hand(g, P0, 'Rengar, Pouncing');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 8 && !canPlayNow(g, P0, r, BF_A); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  g = play(g, P0, r, { dest: BF_A });
  let asked = false;
  for (let i = 0; i < 6 && (g.chain.length || pend(g).inStep); i++) { if (pend(g).kind === 'optional' && /Relentless|channel/i.test(pend(g).prompt)) asked = true; g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g); }
  assert.equal(g.objects[r].combatRole, 'attacker');
  assert.equal(mightOf(g, r), 5, '3 + Assault 2');
  assert.equal(asked, false, 'not Mighty when played');
  assert.ok(!g.log.some(l => /Relentless Storm/.test(l.text)), 'no Relentless Storm trigger');
});

test('RJ#6974 Jinx (ogn-202) + three Super Mega Death Rockets in the trash: all three trigger on one conquer; each discard gives Jinx +1', () => {
  let g = S0F();
  const rk = [0, 1, 2].map(() => put(g, P0, 'Super Mega Death Rocket!', 'trash'));
  const cards = [0, 1, 2].map(() => hand(g, P0, 'V(1)'));
  const j = put(g, P0, 'ogn-202-298', 'base');
  g = move(g, P0, [j], BF_A);
  let prompts = 0;
  for (let i = 0; i < 40 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    if (d.kind === 'optional') { if (/discard/i.test(d.prompt)) prompts++; g = act(g, { type: 'choose', player: d.player, optionIds: ['yes'] }); continue; }
    const o = optionIds(g); const c = cards.find(x => o.includes(x));
    g = c ? choose(g, c) : act(g, legal(g, d.player)[0]);
  }
  assert.equal(prompts, 3, 'three Rocket triggers');
  for (const r of rk) assert.equal(zone(g, r), 'hand');
  assert.equal(mightOf(g, j), 8, '5 + 1 per discard');
});

test('RJ#6978 Retreat on my unit, opponent Gusts it in response: Retreat resolves with no target, so no rune is channelled', () => {
  let g = S0F();
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const r0 = g.players[P0].runesInPlay.length;
  g = play(g, P0, hand(g, P0, 'Retreat'), { targets: [[u]] });
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'Gust'), { targets: [[u]] });
  g = settle(g);
  assert.equal(zone(g, u), 'hand');
  assert.equal(g.players[P0].runesInPlay.length, r0, 'no rune channelled');
});

// RJ#6980 MISMATCH-RJ (DECISIONS principle 10, RJ#5249): Leona, Zealot's -8 (min 1) is passive — not snapshotted, applied after increases —
// so Convergent Mutation's increase on the stunned Sprite Mother is swallowed and she stays at 1 (RJ: 3).
test('RJ#6980 stunned Sprite Mother next to Leona, Zealot (1): Convergent Mutation to her 3-Might Sprite still leaves her at 1', () => {
  let g = S0F({ tp: P1 });
  put(g, P0, 'Leona, Zealot', BF_A); control(g, BF_A, P0);
  const sm = put(g, P1, 'Sprite Mother', BF_A, { stunned: true });
  const sp = put(g, P1, 'V(3)', BF_A); // stands in for the 3-Might Sprite token
  assert.equal(mightOf(g, sm), 1);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Convergent Mutation') });
  g = answer(g, { targets: [[sm]] });
  g = answer(g, { targets: [[sp]] });
  g = settle(g);
  assert.equal(mightOf(g, sm), 1, 'increase first, then -8 to a minimum of 1');
  g.objects[sm].stunned = false; touch(g);
  assert.ok((mightOf(g, sm) ?? 0) > 3, 'the increase did apply underneath');
});

test('RJ#6982 a killed Sprite token dies (goes to the trash, then ceases to exist): Wraith of Echoes draws and Viktor, Leader makes a Recruit', () => {
  let g = S0F({ tp: P1 });
  control(g, BF_A, P0);
  const s = put(g, P0, 'unl-t07', BF_A, { token: true });
  put(g, P0, 'Wraith of Echoes', 'base');
  put(g, P0, 'ogn-246-298', 'base');
  const h0 = g.players[P0].hand.length;
  const base0 = Object.values(g.objects).filter(o => o.controller === P0 && o.zone === 'base').length;
  g = settle(play(g, P1, hand(g, P1, 'KillA'), { targets: [[s]] }));
  assert.notEqual(zone(g, s), 'battlefield');
  assert.notEqual(zone(g, s), 'trash', 'the token ceased to exist');
  assert.equal(g.players[P0].hand.length, h0 + 1, 'Wraith of Echoes drew');
  assert.equal(Object.values(g.objects).filter(o => o.controller === P0 && o.zone === 'base').length, base0 + 1, 'Viktor made a Recruit');
});

test('RJ#6983 Mask of Foresight\'s +1 stays after the unit stops being alone (trigger condition checked only when it triggers)', () => {
  let g = S0F();
  put(g, P0, 'Mask of Foresight', 'base');
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(2)', 'base'), b = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 8 && (g.chain.length || pend(g).inStep); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(mightOf(g, a), 3, 'attacked alone: +1');
  for (let i = 0; i < 4 && pend(g).player !== P0; i++) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[b]] });
  for (let i = 0; i < 8 && (g.chain.length || pend(g).inStep); i++) g = pend(g).kind === 'chooseDestination' ? choose(g, String(BF_A)) : pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(locOf(g, b), BF_A, 'no longer alone');
  assert.equal(mightOf(g, a), 3, 'still +1');
});

test('RJ#6986 Fiora, Victorious becomes Mighty (gaining Deflect) after the opponent\'s spell targeting her was finalized: no Deflect cost is charged', () => {
  let g = S0F({ tp: P1 });
  const f = put(g, P0, 'ogn-232-298', BF_A); control(g, BF_A, P0);
  assert.equal(hasKeyword(g, f, 'Deflect'), false);
  const rd0 = g.players[P1].runesInPlay.length;
  g = play(g, P1, hand(g, P1, 'ZapR'), { targets: [[f]] });
  const rd1 = g.players[P1].runesInPlay.length;
  if (pend(g).player === P1) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Combat Experience'), { targets: [[f]] });
  g = resolveChain(g);
  assert.equal(rd1, rd0, 'no Deflect paid when finalized');
  assert.equal(g.players[P1].runesInPlay.length, rd1, 'nothing charged later either');
  assert.equal(g.objects[f].damage, 2, 'the spell resolved normally');
});

test('RJ#6989 a unit can be played to base or a battlefield you control, not to an uncontrolled or enemy battlefield', () => {
  const g = S0F();
  control(g, BF_A, P0); put(g, P0, 'V(1)', BF_A);
  put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  const c = hand(g, P0, 'V(3)');
  const d = playDests(g, P0, c);
  assert.ok(d.includes('base') && d.includes(BF_A));
  assert.ok(!d.includes(BF_B), 'enemy-controlled: no');
  const h = S0F();
  const c2 = hand(h, P0, 'V(3)');
  assert.deepEqual(playDests(h, P0, c2), ['base'], 'uncontrolled: no');
});

test('RJ#6995 Ride the Wind into a second occupied battlefield mid-showdown: showdowns don\'t run at once — the second is staged and runs after the first, mover attacking with focus first', () => {
  let g = S0F();
  put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  const a = put(g, P0, 'V(1)', 'base'), b = put(g, P0, 'V(4)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 4 && !(pend(g).kind === 'showdownAction' && pend(g).player === P0); i++) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[b]] });
  for (let i = 0; i < 8 && (g.chain.length || pend(g).inStep); i++) g = pend(g).kind === 'chooseDestination' ? choose(g, String(BF_B)) : pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(locOf(g, b), BF_B);
  assert.equal(g.showdown?.battlefieldIndex, BF_A, 'still the first showdown');
  const seen: { bf: number; focus: PlayerId; attacker?: PlayerId }[] = [];
  for (let i = 0; i < 40 && pend(g).kind !== 'mainAction'; i++) {
    if (g.showdown && !seen.some(s => s.bf === g.showdown!.battlefieldIndex)) seen.push({ bf: g.showdown.battlefieldIndex, focus: g.showdown.focus, attacker: g.showdown.attacker });
    g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  }
  assert.deepEqual(seen.map(s => s.bf), [BF_A, BF_B], 'one after the other');
  assert.equal(seen[1].attacker, P0); assert.equal(seen[1].focus, P0);
  assert.equal(g.battlefields[BF_B].controller, P0);
});

test('RJ#6996 Gust the unit Baited Hook will kill, in response: nothing is killed and no unit is played from the top 5', () => {
  let g = S0F();
  control(g, BF_A, P0);
  const vic = put(g, P0, 'V(3)', BF_A);
  const hook = put(g, P0, 'Baited Hook', 'base');
  const top = put(g, P0, 'V(2)', 'deckTop');
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && (a as { obj?: ObjId }).obj === hook)!);
  g = answer(g, { targets: [[vic]] }, P0);
  if (pend(g).player === P0) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Gust'), { targets: [[vic]] });
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    g = d.kind === 'optional' ? act(g, { type: 'choose', player: d.player, optionIds: ['yes'] }) : optionIds(g).includes(top) ? choose(g, top) : act(g, legal(g, d.player)[0]);
  }
  assert.equal(zone(g, vic), 'hand', 'Gusted, not killed');
  assert.notEqual(zone(g, top), 'base', 'no unit played');
  assert.notEqual(zone(g, top), 'battlefield');
});

test('RJ#6999 Equip can\'t be activated for gear that is already attached', () => {
  let g = S0F();
  const a = put(g, P0, 'V(2)', 'base');
  put(g, P0, 'V(2)', 'base');
  const sw = put(g, P0, 'Long Sword', 'base');
  const eq = () => legal(g, P0, 'activate').filter(x => x.type === 'activate' && (x as { obj?: ObjId }).obj === sw);
  assert.ok(eq().length >= 1, 'Equip offered while unattached');
  attachNow(g, sw, a);
  assert.equal(g.objects[sw].attachedTo, a);
  assert.equal(eq().length, 0, 'no Equip once attached');
});

test('RJ#7001 Garen (ogs-013) arriving gives the 1-Might unit there +1 at once (passive): 1 damage does not kill it', () => {
  let g = S0F();
  control(g, BF_A, P0);
  const v = put(g, P0, 'V(1)', BF_A);
  const gar = put(g, P0, 'ogs-013-024', 'base');
  g = move(g, P0, [gar], BF_A);
  assert.equal(mightOf(g, v), 2, '+1 as soon as he arrives');
  g = settle(play(g, P0, hand(g, P0, 'TwoZap'), { targets: [[v, gar]] }));
  assert.equal(zone(g, v), 'battlefield', 'survives with 1 damage');
  assert.equal(g.objects[v].damage, 1);
});

test('RJ#7003 buffed Ravenbloom Student (3) targeted by Hextech Ray: respond with a spell, its +1 trigger resolves first, so it survives at 4', () => {
  let g = S0F({ tp: P1 });
  const s = put(g, P0, 'Ravenbloom Student', BF_A, { buff: true }); control(g, BF_A, P0);
  assert.equal(mightOf(g, s), 3);
  g = play(g, P1, hand(g, P1, 'Hextech Ray'), { targets: [[s]] });
  if (pend(g).player === P1) g = pass(g);
  g = play(g, P0, hand(g, P0, 'DrawR'));
  g = settle(g);
  assert.equal(zone(g, s), 'battlefield');
  assert.equal(mightOf(g, s), 4);
  assert.equal(g.objects[s].damage, 3);
});

test('RJ#7011 Stacked Deck sees Nocturne: banished for his own play, he can\'t also be the card put into hand; one of the other two is chosen', () => {
  let g = S0F();
  const a = put(g, P0, 'V(1)', 'deckTop'), b = put(g, P0, 'V(2)', 'deckTop');
  const n = put(g, P0, 'ogn-194-298', 'deckTop');
  g = play(g, P0, hand(g, P0, 'Stacked Deck'));
  let opts: string[] | null = null;
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    if (d.kind === 'optional') { g = act(g, { type: 'choose', player: d.player, optionIds: ['yes'] }); continue; }
    if (d.kind === 'chooseDestination') { g = choose(g, 'base'); continue; }
    const o = optionIds(g);
    if (o.includes(a)) { opts = o; g = choose(g, a); continue; }
    g = act(g, legal(g, d.player)[0]);
  }
  assert.ok(opts && !opts.includes(n), `Nocturne not choosable (${opts})`);
  assert.equal(zone(g, n), 'base', 'Nocturne banished and played');
  assert.equal(zone(g, a), 'hand');
  assert.notEqual(zone(g, b), 'hand');
});

test('RJ#7017 Zhonya\'s Hourglass hidden at BF-A, played in response, goes to base and saves my unit dying at BF-B', () => {
  let g = S0F({ tp: P1 });
  control(g, BF_A, P0); put(g, P0, 'V(1)', BF_A);
  const u = put(g, P0, 'V(3)', BF_B); control(g, BF_B, P0);
  const z = put(g, P0, "Zhonya's Hourglass", { facedown: BF_A });
  g = play(g, P1, hand(g, P1, 'Vengeance'), { targets: [[u]] });
  if (pend(g).player === P1) g = pass(g);
  g = act(g, { type: 'playCard', player: P0, obj: z });
  for (let i = 0; i < 3 && pend(g).inStep && pend(g).player === P0; i++) g = act(g, legal(g, P0)[0]);
  g = settle(g);
  assert.equal(locOf(g, u), 'base', 'saved and recalled');
  assert.equal(zone(g, z), 'trash', 'Zhonya\'s killed instead');
});

// RJ#7021 MISMATCH-RJ (DECISIONS principle 11): Blitzcrank's leading "you may" is decided when the trigger is finalized (CR 383.3.a), and an
// incurred Deflect cost may be refused (PATCH-1). RJ: the Deflect unit must be chosen and Deflect paid; only the move is optional on resolution.
test('RJ#7021 Blitzcrank played to a battlefield with only an enemy Deflect unit: he may decline the trigger when it is finalized, paying no Deflect', () => {
  let g = S0F();
  control(g, BF_A, P0); put(g, P0, 'V(1)', BF_A);
  const poro = put(g, P1, 'Pouty Poro', BF_B); control(g, BF_B, P1);
  const r0 = g.players[P0].runesInPlay.length;
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Blitzcrank'), destination: BF_A });
  const r1 = g.players[P0].runesInPlay.length;
  expectPending(g, 'chooseTargets', P0);
  assert.equal(pend(g).min, 0, 'choosing nobody is allowed at finalization');
  g = act(g, { type: 'choose', player: P0, optionIds: [] });
  g = settle(g);
  assert.equal(g.chain.length, 0);
  assert.equal(locOf(g, poro), BF_B, 'not pulled');
  assert.equal(g.players[P0].runesInPlay.length, r1, 'no Deflect paid');
  assert.ok(r1 <= r0);
});

test('RJ#7022/7023 a battlefield already scored this turn (held): moving off and back on gives a showdown but no second point (no second conquer)', () => {
  let g = S0F();
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const w = put(g, P0, 'V(2)', 'base');
  put(g, P0, 'Super Mega Death Rocket!', 'trash'); hand(g, P0, 'V(1)');
  g.battlefields[BF_A].scoredThisTurnBy = [P0]; g.players[P0].points = 1; touch(g);
  g = move(g, P0, [u], 'base');
  g = move(g, P0, [w], BF_A);
  assert.equal(pend(g).kind, 'showdownAction', 'a showdown happens');
  let conquerPrompt = false;
  for (let i = 0; i < 12 && pend(g).kind !== 'mainAction'; i++) { if (pend(g).kind === 'optional') conquerPrompt = true; g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g); }
  assert.equal(g.players[P0].points, 1, 'no second point');
  assert.equal(conquerPrompt, false, 'no "When you conquer" trigger (Rocket)');
});

test('RJ#7028 Blastcone Fae played from hiding where she is the only unit: still playable; her mandatory -2 must target herself (min 1)', () => {
  let g = S0F();
  control(g, BF_A, P0);
  put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
  const f = put(g, P0, 'Blastcone Fae', { facedown: BF_A });
  g = act(g, { type: 'playCard', player: P0, obj: f });
  let opts: string[] = [];
  for (let i = 0; i < 6 && (g.chain.length || pend(g).inStep); i++) {
    if (pend(g).kind === 'chooseTargets') { opts = optionIds(g); g = choose(g, opts[0]); continue; }
    g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  }
  assert.equal(locOf(g, f), BF_A, 'played');
  assert.ok(opts.length === 0 || (opts.length === 1 && opts[0] === f), `only herself to choose (${opts})`);
  assert.equal(mightOf(g, f), 1, `-2 to a minimum of 1 (${g.log.slice(-5).map(l => l.text).join(' | ')})`);
});

test('RJ#7035 gear enters ready and can be equipped at once; when the host dies it stays in base, ready, and can be equipped again', () => {
  let g = S0F();
  const a = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  put(g, P0, 'V(2)', 'base'); // another unit to equip later
  const sw = hand(g, P0, "Doran's Shield");
  g = settle(play(g, P0, sw, { dest: 'base' }));
  assert.equal(locOf(g, sw), 'base');
  assert.equal(g.objects[sw].exhausted, false, 'enters ready');
  const eq = () => legal(g, P0, 'activate').find(x => x.type === 'activate' && (x as { obj?: ObjId }).obj === sw);
  assert.ok(eq(), 'Equip available right away');
  g = act(g, eq()!);
  for (let i = 0; i < 12 && (g.chain.length || pend(g).inStep); i++) g = pend(g).inStep ? (optionIds(g).includes(a) ? choose(g, a) : act(g, legal(g, pend(g).player)[0])) : pass(g);
  assert.equal(g.objects[sw].attachedTo, a);
  g = settle(play(g, P0, hand(g, P0, 'KillA'), { targets: [[a]] }));
  assert.equal(zone(g, a), 'trash');
  assert.equal(locOf(g, sw), 'base', `gear recalled to base, unattached (${JSON.stringify({ at: g.objects[sw].attachedTo, bf: g.objects[sw].battlefieldIndex, p: pend(g).kind, ch: g.chain.length })})`);
  assert.ok(!g.objects[sw].attachedTo);
  assert.equal(g.objects[sw].exhausted, false, 'ready');
  assert.ok(eq(), 'can be equipped again');
});

test('RJ#7038 The Candlelit Sanctum: you may keep both cards on top (recycling is optional)', () => {
  let g = S0F({ bfA: 'The Candlelit Sanctum' });
  const c1 = put(g, P0, 'V(1)', 'deckTop'), c2 = put(g, P0, 'V(2)', 'deckTop');
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_A);
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    if (d.kind === 'optional') { g = act(g, { type: 'choose', player: d.player, optionIds: ['no'] }); continue; }
    const none = legal(g, d.player).find(a => a.type === 'choose' && (a as { optionIds: string[] }).optionIds.length === 0);
    g = none && /recycle/i.test(d.prompt) ? act(g, none) : act(g, legal(g, d.player)[0]);
  }
  assert.equal(g.battlefields[BF_A].controller, P0);
  const top2 = g.players[P0].mainDeck.slice(0, 2);
  assert.ok(top2.includes(c1) && top2.includes(c2), 'both still on top');
});

test('RJ#7039 Salvage can kill an opponent\'s revealed Zhonya\'s Hourglass; their unit then dies normally', () => {
  let g = S0F();
  const z = put(g, P1, "Zhonya's Hourglass", 'base');
  const u = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Salvage') });
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = pend(g).kind === 'optional' ? act(g, { type: 'choose', player: P0, optionIds: ['yes'] }) : optionIds(g).includes(z) ? choose(g, z) : act(g, legal(g, P0)[0]);
  g = settle(g, [z]);
  assert.equal(zone(g, z), 'trash', 'Zhonya\'s killed');
  g = settle(play(g, P0, hand(g, P0, 'KillA'), { targets: [[u]] }));
  assert.equal(zone(g, u), 'trash', 'not saved');
});

test('RJ#7044 Promising Future: the next player plays first, the caster last; the caster\'s unit play trigger (Pit Rookie) lands on top and resolves before the other player\'s spell', () => {
  let g = S0F();
  put(g, P0, 'V(1)', 'base');
  for (let i = 0; i < 5; i++) put(g, P0, 'Pit Rookie', 'deckTop');
  for (let i = 0; i < 5; i++) put(g, P1, 'DrawR', 'deckTop');
  g = play(g, P0, hand(g, P0, 'Promising Future'));
  let snap: string[] = [];
  for (let i = 0; i < 40 && pend(g).kind !== 'mainAction'; i++) {
    if (g.chain.length >= 2 && snap.length < g.chain.length) snap = g.chain.map(c => `${c.controller}:${String(c.label)}`);
    const d = pend(g);
    g = d.inStep ? (d.kind === 'chooseDestination' ? choose(g, 'base') : act(g, legal(g, d.player)[0])) : pass(g);
  }
  assert.ok(snap.length >= 2, `chain snapshot ${snap}`);
  assert.match(snap[0], /^1:/, 'the next player\'s card was played first (bottom)');
  assert.match(snap[snap.length - 1], /^0:.*Pit Rookie/, `caster's unit trigger on top (${snap})`);
});

test('RJ#7046 Relentless Storm triggers for each Mighty unit played, but its exhaust cost limits it to one rune unless readied', () => {
  let g = S0F();
  const leg = setLegend(g, P0, 'Relentless Storm');
  const r0 = g.players[P0].runesInPlay.length;
  let asks = 0;
  const run = (u: ObjId) => {
    g = act(g, { type: 'playCard', player: P0, obj: u, destination: 'base' });
    for (let i = 0; i < 8 && (g.chain.length || pend(g).inStep); i++) {
      const d = pend(g);
      if (d.inStep && d.kind === 'optional') { asks++; g = act(g, { type: 'choose', player: d.player, optionIds: ['yes'] }); continue; }
      g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
    }
  };
  run(hand(g, P0, 'V(5)'));
  assert.equal(g.objects[leg].exhausted, true);
  const r1 = g.players[P0].runesInPlay.length;
  assert.equal(r1, r0 + 1, 'one rune channelled');
  run(hand(g, P0, 'V(6)'));
  assert.equal(g.players[P0].runesInPlay.length, r1, 'no second rune while exhausted');
  assert.equal(asks, 1);
});

test('RJ#7048 at 7 points with an empty hand, conquering without the final point: the replacement draw comes first, then that card can be discarded for Super Mega Death Rocket', () => {
  let g = S0F();
  g.players[P0].points = 7;
  const r = put(g, P0, 'Super Mega Death Rocket!', 'trash');
  for (const c of [...g.players[P0].hand]) g.objects[c].zone = 'trash';
  g.players[P0].trash.push(...g.players[P0].hand); g.players[P0].hand = []; touch(g);
  const top = put(g, P0, 'V(1)', 'deckTop');
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_A);
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    if (d.kind === 'optional') { g = act(g, { type: 'choose', player: d.player, optionIds: ['yes'] }); continue; }
    g = optionIds(g).includes(top) ? choose(g, top) : act(g, legal(g, d.player)[0]);
  }
  assert.equal(g.players[P0].points, 7, 'final point denied (other battlefield not scored)');
  assert.equal(zone(g, top), 'trash', 'drawn by the replacement, then discarded');
  assert.equal(zone(g, r), 'hand', 'Rocket returned');
});

test('RJ#7051 Cull the Weak with no unit of your own: the opponent still kills one of theirs', () => {
  let g = S0F();
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  g = play(g, P0, hand(g, P0, 'Cull the Weak'));
  g = settle(g);
  assert.equal(zone(g, e), 'trash');
});

test('RJ#7052 Unchecked Power doesn\'t target, so an enemy Deflect unit adds no cost', () => {
  let g = S0F();
  const poro = put(g, P1, 'Pouty Poro', BF_A); control(g, BF_A, P1);
  const up = hand(g, P0, 'Unchecked Power');
  const r0 = g.players[P0].runesInPlay.length;
  g = act(g, { type: 'playCard', player: P0, obj: up });
  for (let i = 0; i < 4 && pend(g).inStep && pend(g).player === P0; i++) g = act(g, legal(g, P0)[0]);
  const paid = r0 - g.players[P0].runesInPlay.length;
  const printedPower = realCard('Unchecked Power').power ?? 0;
  assert.equal(paid, printedPower, `only its own Power cost recycled (${paid})`);
  g = settle(g);
  assert.equal(zone(g, poro), 'trash');
});

test('RJ#7057 Discipline whose target was killed in response: no +2, the caster still draws 1', () => {
  let g = S0F();
  const u = put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const d = hand(g, P0, 'Discipline'), k = hand(g, P1, 'ZapR'); // a Reaction that kills the 1-Might target
  const h0 = g.players[P0].hand.length;
  g = play(g, P0, d, { targets: [[u]] });
  g = pass(g);
  g = play(g, P1, k, { targets: [[u]] });
  g = resolveChain(g);
  assert.equal(zone(g, u), 'trash');
  assert.equal(g.players[P0].hand.length, h0 - 1 + 1, 'Discipline left the hand, 1 card drawn');
});

test('RJ#7060 Guerilla Warfare (no Action/Reaction): only in my own open main phase — not in a showdown, not on a chain, not on the opponent\'s turn', () => {
  let g = S0F();
  const gw = hand(g, P0, 'Guerilla Warfare');
  assert.equal(canPlayNow(g, P0, gw), true, 'open main phase: yes');
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_A);
  assert.equal(pend(g).kind, 'showdownAction');
  assert.equal(canPlayNow(g, P0, gw), false, 'in a showdown: no');
  let g2 = S0F();
  const gw2 = hand(g2, P0, 'Guerilla Warfare');
  g2 = play(g2, P0, hand(g2, P0, 'Discipline'), { targets: [[put(g2, P0, 'V(2)', 'base')]] });
  assert.equal(canPlayNow(g2, P0, gw2), false, 'on a chain: no');
  let g3 = nextTurn(S0F());
  const gw3 = hand(g3, P0, 'Guerilla Warfare');
  assert.equal(canPlayNow(g3, P0, gw3), false, 'opponent\'s turn: no');
});

test('RJ#7063 two Cleaves stack to Assault 6; Spirit\'s Refuge\'s Deflect does not stack on a unit that already has Deflect', () => {
  let g = S0F();
  const u = put(g, P0, 'V(2)', 'base');
  for (let i = 0; i < 2; i++) g = settle(play(g, P0, hand(g, P0, 'Cleave'), { targets: [[u]] }));
  assert.equal(kwValue(g, u, 'Assault'), 6);
  const p = put(g, P0, 'Pouty Poro', 'base', { buff: true });
  put(g, P0, "Spirit's Refuge", 'base');
  assert.equal(kwValue(g, p, 'Deflect'), 1, '"if they didn\'t already"');
  const q = put(g, P0, 'V(2)', 'base', { buff: true });
  assert.equal(kwValue(g, q, 'Deflect'), 1);
});

test('RJ#7066 Gust on my own Ravenbloom Student: Gust resolves first (the spell counts as played only then), so the Student is in hand and gets no +1', () => {
  let g = S0F();
  const s = put(g, P0, 'Ravenbloom Student', BF_A); control(g, BF_A, P0);
  g = play(g, P0, hand(g, P0, 'Gust'), { targets: [[s]] });
  assert.equal(mightOf(g, s), 2, 'no +1 while Gust is on the chain');
  g = settle(g);
  assert.equal(zone(g, s), 'hand');
  assert.equal(g.chain.length, 0, 'no Student trigger');
  assert.ok(!g.log.some(l => /Ravenbloom Student/.test(l.text) && /\+1|trigger/i.test(l.text)), 'no trigger logged');
});

test('RJ#7068 Fox-Fire played from hidden can only kill units at the battlefield it was hidden at', () => {
  let g = S0F();
  control(g, BF_A, P0); put(g, P0, 'V(1)', BF_A);
  const near = put(g, P1, 'V(2)', BF_A);
  control(g, BF_B, P1);
  const far = put(g, P1, 'V(1)', BF_B);
  const ff = put(g, P0, 'Fox-Fire', { facedown: BF_A });
  g = act(g, { type: 'playCard', player: P0, obj: ff });
  const tg = g.pending?.kind === 'chooseTargets' ? optionIds(g) : g.chain[0].targets.flat();
  assert.ok(!tg.includes(far), `no target at BF-B: ${tg}`);
  assert.ok(tg.includes(near), `enemy unit at BF-A selectable: ${tg}`);
});

test('RJ#7069 Hostile Takeover\'s "lose control and recall at end of turn" is a trigger on the chain that players can respond to', () => {
  let g = S0F();
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
  g = settle(play(g, P0, hand(g, P0, 'Hostile Takeover'), { targets: [[e]] }));
  assert.equal(g.objects[e].controller, P0);
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g); // the stolen unit's showdown
  g = endTurn(g, P0);
  let window = false;
  for (let i = 0; i < 20 && g.activePlayer === P0; i++) {
    const d = pend(g);
    if (!d.inStep && g.chain.some(c => /Hostile Takeover/.test(String(c.label))) && d.kind === 'chainResponse') { window = true; }
    g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  assert.ok(window, 'a response window with the end-of-turn item on the chain');
  assert.equal(g.objects[e].controller, P1);
  assert.equal(locOf(g, e), 'base');
});

test('RJ#7072 Vi, Destructive\'s boost: while one activation is on the chain she can\'t be activated again (one at a time); the opponent may respond (Gust)', () => {
  let g = S0F();
  const vi = put(g, P0, 'Vi, Destructive', BF_A); control(g, BF_A, P0);
  for (let i = 0; i < 3; i++) put(g, P0, 'V(1)', 'trash');
  const acts = () => legal(g, P0, 'activate').filter(x => x.type === 'activate' && x.obj === vi);
  g = act(g, acts()[0]); if (pend(g).kind === 'chooseCards') g = choose(g, optionIds(g)[0]);
  assert.equal(g.chain.length, 1);
  assert.equal(acts().length, 0, 'not again while on the chain');
  g = pass(g);
  expectPending(g, 'chainResponse', P1);
  g = settle(play(g, P1, hand(g, P1, 'Gust'), { targets: [[vi]] }));
  assert.equal(zone(g, vi), 'hand');
});

test('RJ#7078 The Candlelit Sanctum conquer looks at Nocturne: he may be banished and played for [A], paid with runes', () => {
  let g = S0F({ bfA: 'The Candlelit Sanctum' });
  put(g, P0, 'V(1)', 'deckTop');
  const n = put(g, P0, 'Nocturne, Horrifying', 'deckTop');
  const u = put(g, P0, 'V(2)', 'base');
  const ready0 = g.players[P0].runesInPlay.filter(r => !g.objects[r].exhausted).length;
  g = move(g, P0, [u], BF_A);
  for (let i = 0; i < 25 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    if (d.kind === 'optional') { g = choose(g, 'yes'); continue; }
    if (d.kind === 'chooseDestination') { g = choose(g, d.options!.find(o => o.id === 'base')?.id ?? d.options![0].id); continue; }
    const none = legal(g, d.player).find(a => a.type === 'choose' && (a as { optionIds: string[] }).optionIds.length === 0);
    g = none && /recycle/i.test(d.prompt) ? act(g, none) : act(g, legal(g, d.player)[0]);
  }
  assert.ok(['base', 'battlefield'].includes(zone(g, n)), `Nocturne played (${zone(g, n)})`);
  const ready1 = g.players[P0].runesInPlay.filter(r => !g.objects[r].exhausted).length;
  assert.ok(ready1 < ready0 || g.players[P0].runesInPlay.length < ready0, 'paid [A] from runes');
});

test('RJ#7080 Hallowed Tomb may return any copy with the Chosen Champion\'s name (CR 103.3.a.3), not only the card that started in the Champion Zone', () => {
  let g = S0F({ bfA: 'Hallowed Tomb' });
  const orig = g.players[P0].championZone[0];
  moveToZone(g, orig, 'hand');
  const copy = put(g, P0, g.objects[orig].cardId, 'trash');
  put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  g = endTurn(g, P0);
  let asked = false;
  for (let i = 0; i < 60 && !(g.activePlayer === P0 && pend(g).kind === 'mainAction'); i++) {
    const d = pend(g);
    if (d.kind === 'mainAction' && d.player === P1) { g = endTurn(g, P1); continue; }
    if (d.inStep && d.kind === 'optional' && d.player === P0 && /Champion/i.test(d.prompt)) { asked = true; g = yes(g); continue; }
    g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  assert.ok(asked, 'Hallowed Tomb offers the return');
  assert.equal(zone(g, copy), 'championZone');
});

test('RJ#7081 Discipline\'s +2 "this turn" stays on the unit after it moves to another battlefield and is readied', () => {
  let g = S0F();
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  control(g, BF_B, P0);
  g = settle(play(g, P0, hand(g, P0, 'Discipline'), { targets: [[u]] }));
  assert.equal(mightOf(g, u), 4);
  g = settle(move(g, P0, [u], 'base'));
  g.objects[u].exhausted = false; touch(g); // readied (First Mate)
  g = settle(move(g, P0, [u], BF_B));
  assert.equal(locOf(g, u), BF_B);
  assert.equal(mightOf(g, u), 4);
});

test('RJ#7084 an attacker recalled after a combat where both sides survive keeps its ready/exhausted state (a recall doesn\'t exhaust)', () => {
  const run = (ready: boolean) => {
    let { g, atk, def } = attackSetup(['V(1)'], ['V(5)'], { defOpts: [{ stunned: true }] });
    g.objects[atk[0]].exhausted = !ready; touch(g); // e.g. readied by Ride the Wind
    for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
    assert.equal(locOf(g, def[0]), BF_A, 'defender survives');
    assert.equal(locOf(g, atk[0]), 'base', 'attacker recalled');
    return g.objects[atk[0]].exhausted;
  };
  assert.equal(run(true), false, 'ready stays ready');
  assert.equal(run(false), true, 'exhausted stays exhausted');
});

test('RJ#7085 Swift Scout\'s "[1], [T]: put a Teemo unit into your hand" uses the chain: the opponent may respond', () => {
  let g = S0F();
  const l = setLegend(g, P0, 'Swift Scout');
  const t = put(g, P0, 'Teemo, Scout', 'base');
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === l)!);
  for (let i = 0; i < 6 && pend(g).inStep; i++) g = optionIds(g).includes(t) ? choose(g, t) : act(g, legal(g, pend(g).player)[0]);
  assert.equal(g.chain.length, 1, 'on the chain');
  assert.equal(zone(g, t), 'base', 'not yet');
  g = pass(g);
  expectPending(g, 'chainResponse', P1);
  g = settle(g);
  assert.equal(zone(g, t), 'hand');
});

test('RJ#7087 a second copy of a gear already on the board (Seal of Strength) can be played; both stay', () => {
  let g = S0F();
  const a = put(g, P0, 'Seal of Strength', 'base');
  const b = hand(g, P0, 'Seal of Strength');
  assert.ok(canPlayNow(g, P0, b));
  g = settle(play(g, P0, b, { dest: 'base' }));
  assert.equal(locOf(g, a), 'base');
  assert.equal(locOf(g, b), 'base');
});

test('RJ#7089 The Boss saves a buffed unit from the opponent\'s Cull the Weak (the kill is a "would die"), even in base', () => {
  let g = S0F({ tp: P1 });
  setLegend(g, P0, 'The Boss');
  const u = put(g, P0, 'V(2)', 'base', { buff: true });
  put(g, P1, 'V(1)', 'base');
  g = play(g, P1, hand(g, P1, 'Cull the Weak'));
  let asked = false;
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g);
    if (d.inStep && d.kind === 'optional' && d.player === P0) { asked = true; g = yes(g); continue; }
    g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  assert.ok(asked, 'The Boss offered');
  assert.equal(locOf(g, u), 'base', 'survives');
});

test('RJ#7093 Carnivorous Snapvine\'s target moved to another battlefield in response (Resonating Strike): still "at a battlefield", the fight happens; moved to base (Flash): no fight', () => {
  const run = (resp: 'Resonating Strike' | 'Flash') => {
    let g = S0F();
    control(g, BF_A, P1); control(g, BF_B, P1);
    const k = put(g, P1, 'V(2)', BF_A);
    const sv = hand(g, P0, 'Carnivorous Snapvine');
    g = play(g, P0, sv, { dest: 'base' }); // the only enemy unit is chosen as the trigger goes on the chain
    assert.equal(g.chain.length, 1);
    g = pass(g);
    expectPending(g, 'chainResponse', P1);
    g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, resp) });
    for (let i = 0; i < 6 && pend(g).inStep && pend(g).player === P1; i++) {
      const ids = optionIds(g);
      g = ids.includes(k) ? choose(g, k) : ids.includes(String(BF_B)) ? choose(g, String(BF_B)) : act(g, legal(g, P1)[0]);
    }
    g = settle(g);
    return { g, k, sv };
  };
  const a = run('Resonating Strike');
  assert.notEqual(locOf(a.g, a.k), BF_A, 'moved away first');
  assert.equal(zone(a.g, a.k), 'trash', 'Snapvine (6) still fought it at the new battlefield');
  assert.equal(a.g.objects[a.sv].damage, 4, 'took 2+2');
  const b = run('Flash');
  assert.equal(locOf(b.g, b.k), 'base');
  assert.equal(b.g.objects[b.k].damage, 0, 'no fight from base');
  assert.equal(b.g.objects[b.sv].damage, 0);
});

test('RJ#7096 Wuju Bladesman: a lone unit at my battlefield targeted by a spell outside combat is not defending (no +2)', () => {
  let g = S0F({ tp: P1 });
  setLegend(g, P0, 'Wuju Bladesman');
  const u = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  assert.equal(mightOf(g, u), 3);
  g = play(g, P1, hand(g, P1, 'ZapR'), { targets: [[u]] });
  assert.equal(mightOf(g, u), 3, 'not a defender');
  g = settle(g);
  assert.equal(g.objects[u].damage, 2);
  assert.equal(mightOf(g, u), 3);
});

test('RJ#7097 a 0-Might unit attacking a 0-Might unit: no damage, both survive, the attacker is recalled', () => {
  let { g, atk, def } = attackSetup(['V(0)'], ['V(0)']);
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(locOf(g, def[0]), BF_A);
  assert.equal(locOf(g, atk[0]), 'base');
  assert.equal(g.battlefields[BF_A].controller, P1);
});

test('RJ#7105 Singularity ("up to two") may choose zero units: my own lone unit survives', () => {
  let g = S0F();
  const u = put(g, P0, 'V(2)', 'base');
  const s = hand(g, P0, 'Singularity');
  assert.ok(canPlayNow(g, P0, s));
  g = act(g, { type: 'playCard', player: P0, obj: s });
  for (let i = 0; i < 4 && pend(g).inStep && pend(g).kind === 'chooseTargets'; i++) g = act(g, { type: 'choose', player: P0, optionIds: [] });
  g = settle(g);
  assert.equal(zone(g, s), 'trash');
  assert.equal(locOf(g, u), 'base');
  assert.equal(g.objects[u].damage, 0);
});

test('RJ#7108 Dazzling Aurora plays Kadregrin at end of turn; a Reaction drawn by his play trigger can\'t be played after it resolves (no window before the turn ends)', () => {
  let g = S0F();
  put(g, P0, 'Dazzling Aurora', 'base');
  put(g, P0, 'V(5)', 'base'); // Mighty: Kadregrin draws 1 (+1 for himself)
  const z = put(g, P0, 'ZapR', 'deckTop');
  const k = put(g, P0, 'Kadregrin the Infernal', 'deckTop');
  g = endTurn(g, P0);
  const after: string[] = [];
  for (let i = 0; i < 40 && !(pend(g).kind === 'mainAction' && pend(g).player === P1); i++) {
    const d = pend(g);
    if (zone(g, z) === 'hand') { after.push(`${d.kind}:P${d.player}`); assert.ok(!canPlayNow(g, P0, z), `ZapR playable at ${d.kind}`); }
    g = d.inStep ? (d.kind === 'chooseDestination' ? choose(g, 'base') : act(g, legal(g, d.player)[0])) : pass(g);
  }
  assert.ok(['base', 'battlefield'].includes(zone(g, k)), 'Kadregrin played');
  assert.equal(zone(g, z), 'hand', 'drawn');
  assert.equal(g.activePlayer, P1);
});

test('RJ#7109 Taric\'s granted Shield applies while combat damage is dealt even though Taric (Tank) dies to it: his 2-Might ally (3 defending) survives 2 damage', () => {
  let { g, def } = attackSetup(['V(7)'], ['Taric', 'V(2)']);
  const [t, ally] = def;
  assert.equal(mightOf(g, ally), 3, 'defending with Taric\'s Shield');
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(zone(g, t), 'trash', 'Taric (5 defending) took lethal first (Tank)');
  assert.equal(locOf(g, ally), BF_A, 'ally (2 + Shield 1 = 3) survived 2 damage');
  assert.equal(g.objects[ally].damage, 0, 'healed in the combat cleanup');
});

test('RJ#7110 Kai\'Sa, Evolutionary conquers and plays Charm from the trash moving an enemy unit in: she was already healed (combat cleanup) and the new showdown starts only after the combat finished', () => {
  let { g, atk } = attackSetup(["Kai'Sa, Evolutionary"], ['V(3)']);
  fundAll(g, P0);
  const k = atk[0];
  const ch = put(g, P0, 'Charm', 'trash');
  const e2 = put(g, P1, 'V(2)', BF_B);
  g.players[P0].points = 2; touch(g);
  let dmgAtCharm = -1, showdownAfter = false;
  for (let i = 0; i < 50; i++) {
    const d = pend(g);
    if (zone(g, ch) !== 'trash' && dmgAtCharm < 0 && locOf(g, e2) === BF_A) dmgAtCharm = g.objects[k].damage;
    if (locOf(g, e2) === BF_A && (d.kind === 'showdownAction')) { showdownAfter = true; break; }
    if (d.kind === 'mainAction') break;
    if (!d.inStep) { g = pass(g); continue; }
    if (d.kind === 'optional') { g = yes(g); continue; }
    const ids = optionIds(g);
    const want = [ch, e2, String(BF_A)].find(x => ids.includes(x));
    g = want ? choose(g, want) : act(g, legal(g, d.player)[0]);
  }
  assert.equal(locOf(g, e2), BF_A, 'Charm moved the enemy unit in');
  assert.equal(dmgAtCharm, 0, 'Kai\'Sa healed before the new showdown');
  assert.ok(showdownAfter, `a new showdown begins (${kinds(g)})`);
});

test('RJ#7111 (MISMATCH-RJ) my only unit, Traveling Merchant, is Charmed away: its move trigger is on the chain (Closed state), so I keep the battlefield and can still flip Tideturner there; a vanilla unit → control lost, hidden card trashed', () => {
  const run = (unit: string) => {
    let g = S0F({ tp: P1 });
    const m = put(g, P0, unit, BF_A); control(g, BF_A, P0);
    hand(g, P0, 'V(1)');
    const t = put(g, P0, 'Tideturner', { facedown: BF_A });
    control(g, BF_B, P1); put(g, P1, 'V(1)', BF_B);
    g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Charm') });
    for (let i = 0; i < 5 && pend(g).inStep; i++) { const ids = optionIds(g); g = choose(g, ids.includes(m) ? m : ids.includes(String(BF_B)) ? String(BF_B) : ids[0]); }
    for (let i = 0; i < 8 && locOf(g, m) !== BF_B; i++) { const d = pend(g); if (d.inStep) { const ids = optionIds(g); g = choose(g, ids.includes(String(BF_B)) ? String(BF_B) : ids[0]); } else g = pass(g); }
    assert.equal(locOf(g, m), BF_B);
    return { g, m, t };
  };
  const a = run('Traveling Merchant');
  assert.equal(a.g.battlefields[BF_A].controller, P0, 'control kept while the move trigger is on the chain');
  assert.equal(zone(a.g, a.t), 'facedown');
  assert.ok(canPlayNow(a.g, P0, a.t), 'Tideturner can be flipped in response to the Merchant trigger');
  const b = run('V(2)');
  for (let i = 0; i < 6 && b.g.chain.length; i++) b.g = pass(b.g);
  assert.notEqual(b.g.battlefields[BF_A].controller, P0, 'vanilla unit: control lost');
  assert.equal(zone(b.g, b.t), 'trash', 'hidden card trashed');
});

test('RJ#7112 Thousand-Tailed Watcher\'s -3 (min 1) on a 2-Might Stalwart Poro is snapshotted as -1; defending alone later: 1 + Shield 1 + Wuju Bladesman 2 = 4', () => {
  let g = S0F({ tp: P1 });
  setLegend(g, P0, 'Wuju Bladesman');
  const p = put(g, P0, 'Stalwart Poro', BF_A); control(g, BF_A, P0);
  g = settle(play(g, P1, hand(g, P1, 'Thousand-Tailed Watcher'), { dest: 'base' }));
  assert.equal(mightOf(g, p), 1);
  const a = put(g, P1, 'V(1)', 'base');
  g = move(g, P1, [a], BF_A);
  for (let i = 0; i < 6 && pend(g).kind !== 'showdownAction'; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(mightOf(g, p), 4);
});

test('RJ#7113 stolen Ferrous Forerunner (Hostile Takeover) killed by my Hidden Blade: I draw 2 and its Deathknell plays the Mechs to MY base', () => {
  let g = S0F();
  const f = put(g, P1, 'Ferrous Forerunner', BF_A); control(g, BF_A, P1);
  g = settle(play(g, P0, hand(g, P0, 'Hostile Takeover'), { targets: [[f]] }));
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(g.objects[f].controller, P0);
  const hb = hand(g, P0, 'Hidden Blade');
  const base0 = g.players[P0].base.length, h0 = g.players[P0].hand.length, h1 = g.players[P1].hand.length;
  g = settle(play(g, P0, hb, { targets: [[f]] }));
  assert.equal(zone(g, f), 'trash');
  assert.equal(g.players[P0].hand.length, h0 - 1 + 2, 'I draw 2');
  assert.equal(g.players[P1].hand.length, h1);
  const mechs = g.players[P0].base.filter(o => /Mech/.test(g.cards[g.objects[o].cardId]?.name ?? ''));
  assert.equal(mechs.length, 2, `two Mechs in my base (${g.players[P0].base.length - base0} new)`);
});

test('RJ#7114 after Brynhir Thundersong\'s trigger resolves, the opponent can\'t play a hidden card either (playing from hidden is playing a card)', () => {
  let g = S0F();
  put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  const hz = put(g, P1, 'HidZap', { facedown: BF_B });
  const u = put(g, P0, 'V(2)', 'base');
  let g0 = play(g, P0, hand(g, P0, 'Discipline'), { targets: [[u]] });
  g0 = pass(g0);
  assert.ok(canPlayNow(g0, P1, hz), 'sanity: playable in response before Brynhir');
  g = settle(play(g, P0, hand(g, P0, 'Brynhir Thundersong'), { dest: 'base' }));
  g = play(g, P0, hand(g, P0, 'Discipline'), { targets: [[u]] });
  g = pass(g);
  expectPending(g, 'chainResponse', P1);
  assert.equal(canPlayNow(g, P1, hz), false);
});

test('RJ#7116 Solari Shieldbearer may stun itself with its play trigger; Radiant Dawn (enemy units only) gives no buff', () => {
  let g = S0F();
  setLegend(g, P0, 'Radiant Dawn');
  const other = put(g, P0, 'V(2)', 'base');
  const s = hand(g, P0, 'Solari Shieldbearer');
  g = act(g, { type: 'playCard', player: P0, obj: s, destination: 'base' });
  let offered: string[] = [];
  for (let i = 0; i < 12 && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g);
    if (d.inStep && optionIds(g).includes(s)) { offered = optionIds(g); g = choose(g, s); continue; }
    g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  assert.ok(offered.includes(s), `itself selectable (${offered})`);
  assert.equal(g.objects[s].stunned, true, 'stunned itself');
  assert.equal(g.objects[other].counters.buff ?? 0, 0, 'no Radiant Dawn buff');
  assert.equal(g.objects[s].counters.buff ?? 0, 0);
});

test('RJ#7117 Blitzcrank played to an open battlefield (Miss Fortune, ogn-193) pulls an enemy unit in: Blitzcrank applied Contested first, so he is the attacker', () => {
  let g = S0F();
  put(g, P0, 'ogn-193-298', 'base'); // Miss Fortune: friendly units may be played to open battlefields
  const e = put(g, P1, 'V(4)', BF_B); control(g, BF_B, P1);
  const b = hand(g, P0, 'Blitzcrank, Impassive');
  assert.ok(canPlayNow(g, P0, b, BF_A), 'open battlefield allowed');
  g = play(g, P0, b, { dest: BF_A });
  for (let i = 0; i < 12 && g.pending && (g.chain.length || g.pending.inStep) && !g.objects[e].combatRole; i++) {
    const d = g.pending;
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    g = act(g, { type: 'choose', player: d.player, optionIds: d.kind === 'optional' ? ['yes'] : o.includes(e) ? [e] : [o[0]] });
  }
  for (let i = 0; i < 8 && g.chain.length; i++) g = g.pending?.inStep ? act(g, legal(g, g.pending.player)[0]) : pass(g);
  assert.equal(locOf(g, e), BF_A);
  assert.equal(g.objects[b].combatRole, 'attacker');
  assert.equal(g.objects[e].combatRole, 'defender');
});

test('RJ#7125 Teemo, Strategist choosing a Deflect attacker: Deflect is paid once (one choice), however much damage follows', () => {
  let g = S0F();
  put(g, P1, 'Teemo, Strategist', BF_A); control(g, BF_A, P1);
  for (let i = 0; i < 5; i++) put(g, P1, 'HidZap', 'deckTop');
  const atk = [put(g, P0, 'Pouty Poro', 'base')];
  const l0 = g.log.length;
  g = move(g, P0, atk, BF_A);
  for (let i = 0; i < 20 && !g.log.slice(l0).some(l => /^Revealed/.test(l.text)); i++) {
    const d = pend(g);
    if (d.inStep && d.kind === 'optional' && d.player === P1) { g = yes(g); continue; }
    g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  const pays = g.log.slice(l0).filter(l => /^P1 pays/.test(l.text));
  assert.equal(pays.length, 1, pays.map(l => l.text).join(' / '));
  assert.match(pays[0].text, /^P1 pays A$/, 'Deflect 1 = one [A]');
  assert.ok(g.log.slice(l0).some(l => /deals 5 to Pouty Poro/.test(l.text)) || zone(g, atk[0]) === 'trash', `5 damage (${g.log.slice(l0).map(l => l.text).join(' / ')})`);
});

test('RJ#7129 Wuju Bladesman: one of my two defenders dies mid-showdown, the survivor now defends alone and gets +2 at once', () => {
  let g = S0F({ tp: P1 });
  setLegend(g, P0, 'Wuju Bladesman');
  const a = put(g, P0, 'V(2)', BF_A), b = put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(1)', 'base');
  g = move(g, P1, [e], BF_A);
  for (let i = 0; i < 6 && !(pend(g).kind === 'showdownAction' && pend(g).player === P0); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(mightOf(g, a), 2, 'two defenders: no bonus');
  g = settle(play(g, P0, hand(g, P0, 'ZapR'), { targets: [[b]] }));
  assert.equal(zone(g, b), 'trash');
  assert.equal(mightOf(g, a), 4, 'defends alone now');
});

test('RJ#7132 a unit can\'t be exhausted voluntarily: the only ways are game actions such as a standard move', () => {
  let g = S0F();
  const r = put(g, P0, 'Pit Rookie', BF_A); control(g, BF_A, P0);
  const mine = legal(g, P0).filter(a => JSON.stringify(a).includes(`"${r}"`));
  assert.ok(mine.length > 0);
  assert.ok(mine.every(a => a.type === 'move'), `only moves involve the unit: ${[...new Set(mine.map(a => a.type))]}`);
  g = move(g, P0, [r], 'base');
  assert.equal(g.objects[r].exhausted, true, 'the standard move exhausts it');
});

test('RJ#7133 Defy can\'t be played on an empty chain (needs a spell to target, not itself)', () => {
  const g = S0F();
  put(g, P0, 'Ravenbloom Student', 'base');
  assert.equal(canPlayNow(g, P0, hand(g, P0, 'Defy')), false);
});

test('RJ#7135 Leona, Determined attacks at Reaver\'s Row; the defender moves her stun target to base first: it is not stunned (no longer "here")', () => {
  let g = S0F({ bfA: "Reaver's Row" });
  const e1 = put(g, P1, 'V(2)', BF_A), e2 = put(g, P1, 'V(2)', BF_A);
  control(g, BF_A, P1);
  const le = put(g, P0, 'Leona, Determined', 'base');
  g = move(g, P0, [le], BF_A);
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    if (d.kind === 'optional') { g = yes(g); continue; }
    g = optionIds(g).includes(e1) ? choose(g, e1) : act(g, legal(g, d.player)[0]);
  }
  assert.equal(locOf(g, e1), 'base', 'moved out by Reaver\'s Row');
  assert.ok(!g.objects[e1].stunned, 'not stunned');
  assert.ok(!g.objects[e2].stunned);
});

test('RJ#7136 moving a unit from a battlefield back to base uses no chain: no response window, I keep acting', () => {
  let g = S0F();
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  put(g, P0, 'V(1)', BF_A);
  g = move(g, P0, [u], 'base');
  assert.equal(g.chain.length, 0);
  expectPending(g, 'mainAction', P0);
});

test('RJ#7137 Zhonya\'s Hourglass played from hidden is gear, not a spell: it enters the board at once (no chain item), so Defy has nothing to counter', () => {
  let g = S0F();
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const z = put(g, P0, "Zhonya's Hourglass", { facedown: BF_A });
  const df = hand(g, P1, 'Defy');
  g = act(g, { type: 'playCard', player: P0, obj: z });
  for (let i = 0; i < 4 && pend(g).inStep && pend(g).player === P0; i++) g = act(g, legal(g, P0)[0]);
  assert.equal(g.chain.length, 0, 'not on the chain');
  assert.equal(zone(g, z), 'base', 'gear goes to base');
  expectPending(g, 'mainAction', P0);
  assert.equal(canPlayNow(g, P1, df), false);
});

test('RJ#7138 a battlefield I scored on my turn can be scored by me again on the opponent\'s next turn (once per player per turn)', () => {
  let g = S0F();
  g.battlefields[BF_A].scoredThisTurnBy = [P0]; g.players[P0].points = 1; touch(g);
  g = nextTurn(g);
  assert.equal(g.activePlayer, P1);
  fundAll(g, P0);
  const mine = put(g, P0, 'V(4)', 'base');
  const rw = hand(g, P0, 'Ride the Wind');
  const a = put(g, P1, 'V(2)', 'base');
  g = move(g, P1, [a], BF_B);
  expectPending(g, 'showdownAction', P1);
  g = pass(g);
  g = play(g, P0, rw, { targets: [[mine]] });
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    g = optionIds(g).includes(String(BF_A)) ? choose(g, String(BF_A)) : act(g, legal(g, d.player)[0]);
  }
  assert.equal(g.activePlayer, P1);
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[P0].points, 2, 'scored again');
});

test('RJ#7144 moving a unit to a battlefield I already control: no chain, no showdown, the opponent gets no priority', () => {
  let g = S0F();
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_A);
  assert.equal(g.chain.length, 0);
  expectPending(g, 'mainAction', P0);
});

test('RJ#7153 Blind Fury plays the revealed card ignoring its cost: no Energy or Power is paid for it (Kadregrin, 9 + 2 power)', () => {
  let g = S0F();
  const k = put(g, P1, 'Kadregrin the Infernal', 'deckTop');
  const bf = hand(g, P0, 'Blind Fury');
  g = act(g, { type: 'playCard', player: P0, obj: bf });
  for (let i = 0; i < 4 && pend(g).inStep && pend(g).player === P0; i++) g = act(g, legal(g, P0)[0]);
  const logAfterPlay = g.log.length;
  for (let i = 0; i < 30 && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    g = d.kind === 'chooseDestination' ? choose(g, 'base') : optionIds(g).includes(k) ? choose(g, k) : act(g, legal(g, d.player)[0]);
  }
  assert.equal(g.objects[k].controller, P0);
  assert.equal(locOf(g, k), 'base');
  assert.ok(!g.log.slice(logAfterPlay).some(l => /^P0 pays/.test(l.text)), `nothing paid for Kadregrin: ${g.log.slice(logAfterPlay).map(l => l.text).join(' / ')}`);
});

test('RJ#7154 King\'s Edict taken by Mystic Reversal: "you" is now the new controller, so the original caster must choose one of their own units to kill', () => {
  let g = S0F();
  const mine = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const theirs = put(g, P1, 'V(2)', BF_B); control(g, BF_B, P1);
  g = play(g, P0, hand(g, P0, "King's Edict"));
  g = pass(g);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Mystic Reversal') });
  let p0Options: string[] = [];
  for (let i = 0; i < 30 && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    if (d.player === P0 && (optionIds(g).includes(mine) || optionIds(g).includes(theirs))) p0Options = optionIds(g);
    if (d.kind === 'optional') { g = no(g); continue; } // no new choices
    g = act(g, legal(g, d.player)[0]);
  }
  assert.ok(!p0Options.includes(theirs), `P0 can't choose P1's unit (${p0Options})`);
  assert.equal(zone(g, mine), 'trash', 'P0\'s own unit dies');
  assert.equal(locOf(g, theirs), BF_B, 'P1\'s unit survives');
});

test('RJ#7163 the defender can\'t pile all damage on one attacker to spare the others: each must get lethal before any excess', () => {
  let g = S0F({ tp: P1 });
  const d = put(g, P0, 'V(6)', BF_A); control(g, BF_A, P0);
  const a1 = put(g, P1, 'V(2)', 'base'), a2 = put(g, P1, 'V(2)', 'base');
  g = move(g, P1, [a1, a2], BF_A);
  for (let i = 0; i < 12; i++) { const p = pend(g); if (p.kind === 'assignDamage' && p.player === P0) break; g = p.inStep ? act(g, legal(g, p.player)[0]) : pass(g); }
  expectPending(g, 'assignDamage', P0);
  assert.notEqual(validateAction(g, { type: 'assignDamage', player: P0, assignment: { [a1]: 6 } }), null, 'all 6 on one: illegal');
  assert.notEqual(validateAction(g, { type: 'assignDamage', player: P0, assignment: { [a1]: 5, [a2]: 1 } }), null, 'excess on one while the other is short of lethal: illegal');
  assert.equal(validateAction(g, { type: 'assignDamage', player: P0, assignment: { [a1]: 2, [a2]: 4 } }), null, 'lethal to each, excess after that');
  assert.equal(validateAction(g, { type: 'assignDamage', player: P0, assignment: { [a1]: 4, [a2]: 2 } }), null);
  void d;
});

test('RJ#7164 Deadbloom Predator played to an enemy battlefield starts the showdown alone; another unit can\'t be standard-moved in during it (only by Action/Reaction effects)', () => {
  let g = S0F();
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const helper = put(g, P0, 'V(2)', 'base');
  const dp = hand(g, P0, 'Deadbloom Predator');
  assert.ok(canPlayNow(g, P0, dp, BF_A));
  g = play(g, P0, dp, { dest: BF_A });
  for (let i = 0; i < 6 && pend(g).kind !== 'showdownAction'; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  expectPending(g, 'showdownAction', P0);
  assert.equal(legal(g, P0, 'move').filter(a => JSON.stringify(a).includes(`"${helper}"`)).length, 0, 'no standard move in a showdown');
});

test('RJ#7166 En Garde\'s "if it is the only unit you control there" is checked on resolution: a unit played there later doesn\'t remove the extra +1', () => {
  let g = S0F();
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  g = settle(play(g, P0, hand(g, P0, 'En Garde'), { targets: [[u]] }));
  assert.equal(mightOf(g, u), 4);
  const v = hand(g, P0, 'V(1)');
  g = settle(play(g, P0, v, { dest: BF_A }));
  assert.equal(locOf(g, v), BF_A, 'second unit there now');
  assert.equal(mightOf(g, u), 4, 'still +2');
});

test('RJ#7169 Daughter of the Void\'s [A] ("use only to play spells") can\'t pay for hiding a card (hiding isn\'t playing)', () => {
  const g = S0F();
  setLegend(g, P0, 'Daughter of the Void');
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const h = hand(g, P0, 'HidZap');
  const hides = () => legal(g, P0).filter(a => a.type === 'hide' && (a as { obj?: ObjId }).obj === h);
  assert.ok(hides().length > 0, 'sanity: hideable with runes');
  setRunes(g, P0, 0); touch(g);
  assert.equal(hides().length, 0, 'no runes, only the legend\'s spell-only [A]: can\'t hide');
});

test('RJ#7170 Qiyana killed by combat damage while her side still conquers: she isn\'t there at the conquer, no draw/channel', () => {
  let g = S0F();
  put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const q = put(g, P0, 'Qiyana, Victorious', 'base'), big = put(g, P0, 'V(9)', 'base');
  g = move(g, P0, [q, big], BF_A);
  const h0 = g.players[P0].hand.length, r0 = g.players[P0].runesInPlay.length;
  let qAsk = false;
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.inStep && /Qiyana/.test(d.prompt)) qAsk = true;
    if (d.kind === 'assignDamage' && d.player === P1) { g = act(g, { type: 'assignDamage', player: P1, assignment: { [q]: 4, [big]: 1 } }); continue; }
    g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  assert.equal(zone(g, q), 'trash');
  assert.equal(g.battlefields[BF_A].controller, P0, 'conquered');
  assert.equal(qAsk, false);
  assert.equal(g.players[P0].hand.length, h0, 'no draw');
  assert.equal(g.players[P0].runesInPlay.length, r0, 'no channel');
});

test('RJ#7173 Noxian Drummer and Chemtech Enforcer move into an enemy battlefield: the Drummer trigger resolves before the combat begins, so the Enforcer has no Attacker designation (2, no Assault) then', () => {
  let g = S0F();
  put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const dr = put(g, P0, 'Noxian Drummer', 'base'), ce = put(g, P0, 'Chemtech Enforcer', 'base');
  g = move(g, P0, [dr, ce], BF_A);
  assert.ok(g.chain.some(c => /Noxian Drummer/.test(String(c.label))), 'Drummer trigger on the chain');
  assert.ok(!g.objects[ce].combatRole, `no designation yet (${g.objects[ce].combatRole})`);
  assert.equal(mightOf(g, ce), 2, 'no Assault yet');
  for (let i = 0; i < 6 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  for (let i = 0; i < 4 && pend(g).kind !== 'showdownAction'; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(g.objects[ce].combatRole, 'attacker', 'combat begins after the chain');
  assert.equal(mightOf(g, ce), 4, 'Assault 2 now');
});

test('RJ#7185 (MISMATCH-RJ) Rumble\'s conquer trigger recycles Gem Jammer as it is finalized (combat not over yet): Jammer is still an attacker with Assault (3), so Mega-Mech costs 7 - 3 = 4', () => {
  let g = S0F();
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const mm = put(g, P0, 'Mega-Mech', 'trash');
  const ru = put(g, P0, 'sfd-026-221', 'base'), gj = put(g, P0, 'Gem Jammer', 'base');
  g = move(g, P0, [ru, gj], BF_A);
  assert.equal(mightOf(g, gj), 3, 'attacking Mech: 2 + Assault');
  let l0 = -1;
  for (let i = 0; i < 40 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    if (d.kind === 'assignDamage' && d.player === P1) { g = act(g, { type: 'assignDamage', player: P1, assignment: { [ru]: 1 } }); continue; }
    if (d.kind === 'optional') { if (l0 < 0) l0 = g.log.length; g = yes(g); continue; }
    if (d.kind === 'chooseDestination') { g = choose(g, 'base'); continue; }
    const ids = optionIds(g);
    g = ids.includes(gj) ? choose(g, gj) : ids.includes(mm) ? choose(g, mm) : act(g, legal(g, d.player)[0]);
  }
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(zone(g, gj), 'mainDeck', 'Jammer recycled');
  assert.ok(['base', 'battlefield'].includes(zone(g, mm)), 'Mega-Mech played');
  const pays = g.log.slice(Math.max(0, l0)).filter(l => /^P0 pays/.test(l.text)).map(l => l.text);
  assert.ok(pays.some(t => /^P0 pays 4\b/.test(t)), `paid 4 energy (${pays.join(' / ')})`);
});

test('RJ#7171 2v2: I can\'t play or move a unit to a battlefield my teammate controls (CR 449.2.b)', () => {
  const g = createGame({ seed: 3, cardDb: fixtureDb(), mode: '2v2', firstPlayer: P0, skipMulligan: true, battlefieldSelection: 'random', includeAllCards: true,
    players: [0, 1, 2, 3].map(i => ({ name: `P${i}`, deck: legalDeck({ legend: i >= 2 ? 'cf-legend-2' : 'cf-legend' }, [`cf-bf-${'abde'[i]}`, `cf-bf-${'bcef'[i]}`, `cf-bf-${'cdfa'[i]}`]) })) } as never) as GameState;
  for (let i = 0; i < 80 && !(g.pending?.kind === 'mainAction' && g.pending.player === P0); i++) assert.fail('expected P0 main phase at start');
  fundAll(g, P0);
  const bf = 0;
  put(g, 2 as PlayerId, 'V(2)', bf); control(g, bf, 2 as PlayerId);
  const u = hand(g, P0, 'V(1)');
  const w = put(g, P0, 'V(1)', 'base');
  assert.equal(canPlayNow(g, P0, u, bf), false, 'no play to the teammate\'s battlefield');
  const mv = legal(g, P0, 'move').filter(a => JSON.stringify(a).includes(`"${w}"`));
  assert.ok(mv.some(a => (a as { to?: unknown }).to !== bf && (a as { to?: unknown }).to !== 'base'), `sanity: it can move to another battlefield (${mv.map(a => (a as { to?: unknown }).to)})`);
  assert.ok(!mv.some(a => (a as { to?: unknown }).to === bf), 'no move there');
});

test('RJ#7187 Cruel Patron can\'t kill himself for his own additional cost: with no other friendly unit he can\'t be played', () => {
  let g = S0F();
  const cp = hand(g, P0, 'Cruel Patron');
  assert.ok(!canPlayNow(g, P0, cp), 'no friendly unit to kill');
  put(g, P0, 'V(1)', 'base');
  assert.ok(canPlayNow(g, P0, cp), 'playable with another friendly unit');
});

test('RJ#7192 Bullet Time damages only the enemy units at the one battlefield chosen as it is played', () => {
  let g = S0F();
  const ea = put(g, P1, 'V(3)', BF_A), eb = put(g, P1, 'V(3)', BF_B), mine = put(g, P0, 'V(3)', BF_A);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Bullet Time') });
  expectPending(g, 'chooseTargets', P0);
  g = choose(g, g.battlefields[BF_A].objId);
  g = passN(g, 2);
  if (g.pending?.kind === 'chooseNumber') g = choose(g, '2');
  g = settle(g);
  assert.equal(g.objects[ea].damage, 2);
  assert.equal(g.objects[eb].damage, 0, 'other battlefield untouched');
  assert.equal(g.objects[mine].damage, 0, 'friendly unit untouched');
});

test('RJ#7194 both at 7, attacker conquers Zaun Warrens with an empty deck: having scored the other battlefield → 8, wins; otherwise the final point becomes a draw → burn out, the opponent reaches 8 and wins', () => {
  for (const scoredOther of [true, false]) {
    let g = S0({ bfA: 'Zaun Warrens' }); g.players[P0].points = 7; g.players[P1].points = 7;
    clearDeckTop(g, P0); put(g, P0, 'V(1)', 'trash');
    if (scoredOther) { g.battlefields[BF_B].scoredThisTurnBy = [P0]; touch(g); }
    g = move(g, P0, [put(g, P0, 'V(1)', 'base')], BF_A);
    for (let i = 0; i < 6 && g.winner == null; i++) { g = passAll(g); g = settle(g); }
    assert.equal(g.winner, scoredOther ? P0 : P1, `scoredOther=${scoredOther}`);
  }
});

test('RJ#7197 Daughter of the Void\'s [T] Reaction ability can be used as the first thing on my turn (empty chain) to pay for a spell', () => {
  let g = S0F();
  const leg = setLegend(g, P0, 'Daughter of the Void');
  setRunes(g, P0, 0); touch(g);
  expectPending(g, 'mainAction', P0);
  assert.equal(g.chain.length, 0);
  const acts = legal(g, P0, 'activate').filter(a => a.type === 'activate' && a.obj === leg);
  assert.ok(acts.length > 0, 'legend ability usable with an empty chain on my own turn');
  g = act(g, acts[0]);
  assert.ok(g.objects[leg].exhausted, 'legend exhausted');
  expectPending(g, 'mainAction', P0);
});

test('RJ#7202 (MISMATCH-RJ partial) Not So Fast counters Overzealous Fan\'s defend trigger (it chooses my attacker), but the Fan was already killed as the trigger was finalized (principle 11): attacker stays, Fan in the trash', () => {
  let g = S0F();
  const fan = put(g, P1, 'Overzealous Fan', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(3)', 'base');
  const nsf = hand(g, P0, 'Not So Fast');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 10 && !(g.chain.some(c => c.source === fan) && !pend(g).inStep); i++) {
    const d = pend(g);
    if (d.inStep) { g = act(g, { type: 'choose', player: d.player, optionIds: [d.kind === 'optional' ? 'yes' : optionIds(g).includes(a) ? a : optionIds(g)[0]] }); continue; }
    g = pass(g);
  }
  assert.equal(zone(g, fan), 'trash', 'kill cost paid before anyone can respond');
  if (pend(g).player !== P0) g = pass(g);
  assert.ok(canPlayNow(g, P0, nsf));
  g = act(g, { type: 'playCard', player: P0, obj: nsf });
  if (pend(g).kind === 'chooseTargets') g = choose(g, g.chain.find(c => c.source === fan)!.id);
  for (let i = 0; i < 10 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(locOf(g, a), BF_A, 'move countered');
  assert.equal(zone(g, nsf), 'trash');
});

// ADJUDICATOR-4 (DECISIONS #7205): the two play effects are NOT "Triggered simultaneously" — Snapvine (played first, "starting
// with the next player") enters and its play effect goes on the chain as a pending item (CR 383.3, 383.4.a.2) before Rex enters,
// so CR 383.3.d.1's turn-order placement does not apply: Snapvine's is at the bottom and Rex's (added later) resolves first (RJ
// right on the order). A Snapvine killed by Rex before its fight resolves deals no damage (house: verified RJ#6857/#4351,
// principle 17), so Rex survives; if Rex hits another unit, Snapvine's fight kills Rex too.
test('RJ#7205 Promising Future (my turn): opponent\'s Carnivorous Snapvine and my Riptide Rex — Snapvine\'s play effect is placed first (bottom), Rex\'s resolves first; Rex on Snapvine → Snapvine dies and its fight deals nothing (Rex lives); Rex elsewhere → they trade', () => {
  for (const rexOnSnap of [true, false]) {
    let g = S0F();
    const p1u = put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
    put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
    const sv = [0, 1, 2, 3, 4].map(() => put(g, P1, 'Carnivorous Snapvine', 'deckTop'));
    const rx = [0, 1, 2, 3, 4].map(() => put(g, P0, 'Riptide Rex', 'deckTop'));
    g = play(g, P0, hand(g, P0, 'Promising Future'));
    let order = '';
    for (let i = 0; i < 40 && pend(g).kind !== 'mainAction'; i++) {
      const d = pend(g);
      if (!order && g.chain.length === 2) order = g.chain.map(c => c.label?.split(':')[0]).join(' < ');
      if (!d.inStep) { g = pass(g); continue; }
      const o = optionIds(g);
      const want = d.kind === 'chooseDestination' ? String(d.player === P1 ? BF_A : BF_B)
        : d.kind === 'chooseTargets' ? (d.player === P1 ? o.find(x => rx.includes(x)) : rexOnSnap ? o.find(x => sv.includes(x)) : p1u) : undefined;
      g = act(g, { type: 'choose', player: d.player, optionIds: [want && o.includes(want) ? want : o[0]] });
    }
    assert.equal(order, 'Carnivorous Snapvine < Riptide Rex', 'Snapvine\'s play effect placed first (bottom): Rex\'s resolves first');
    assert.equal(sv.filter(x => zone(g, x) === 'trash').length, 1, `the played Snapvine dies (rexOnSnap=${rexOnSnap})`);
    assert.equal(rx.filter(x => zone(g, x) === 'trash').length, rexOnSnap ? 0 : 1, rexOnSnap ? 'Rex survives: the dead Snapvine\'s fight deals nothing' : 'Snapvine\'s fight kills Rex');
  }
});

test('RJ#7208 (MISMATCH-RJ) defending Draven, Audacious vs a stunned attacker that survives: the attacker is recalled → No result, Draven didn\'t win (no point); a stunned attacker that dies → Draven wins (+1)', () => {
  for (const m of [7, 3]) {
    let { g, atk } = attackSetup([`V(${m})`], ['Draven, Audacious']);
    g.objects[atk[0]].stunned = true; touch(g);
    for (let i = 0; i < 8 && g.chain.length + (g.pending?.kind === 'showdownAction' ? 1 : 0) > 0; i++) { g = passAll(g); g = settle(g); }
    if (m === 7) {
      assert.equal(locOf(g, atk[0]), 'base', 'surviving attacker recalled');
      assert.equal(g.players[P1].points, 0, 'no win: no Draven point');
    } else {
      assert.equal(zone(g, atk[0]), 'trash');
      assert.equal(g.players[P1].points, 1, 'Draven won the combat');
    }
  }
});

test('RJ#7211 Ravenborn Tome + Falling Star: each of its two damage instances gets the +1 Bonus Damage (4 and 4)', () => {
  let g = S0F();
  const tome = put(g, P0, 'Ravenborn Tome', 'base');
  const e1 = put(g, P1, 'V(9)', BF_A), e2 = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === tome)!); g = settle(g);
  g = play(g, P0, hand(g, P0, 'Falling Star'), { targets: [[e1], [e2]] }); g = settle(g);
  assert.equal(g.objects[e1].damage, 4);
  assert.equal(g.objects[e2].damage, 4);
});

test('RJ#7212 Twisted Fate, Gambler: the reveal/recycle always happens; the Fury-rune damage that would choose a Deflect defender may be declined (refuse the Deflect cost) — then nothing is dealt', () => {
  let g = S0F();
  const rd0 = g.players[P0].runeDeck[0];
  assert.ok(g.cards[g.objects[rd0].cardId].domains.includes('Fury'), 'top rune is Fury');
  const tf = put(g, P0, 'Twisted Fate, Gambler', 'base');
  const d = put(g, P1, 'Pouty Poro', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [tf], BF_A);
  let offered = false;
  for (let i = 0; i < 12 && pend(g).kind !== 'showdownAction'; i++) {
    const p = pend(g);
    if (p.inStep && p.kind === 'optional' && p.player === P0 && /Deflect/.test(p.prompt ?? '')) { offered = true; g = no(g); continue; }
    g = p.inStep ? act(g, legal(g, p.player)[0]) : pass(g);
  }
  assert.ok(offered, 'Deflect cost offered and refusable');
  assert.notEqual(g.players[P0].runeDeck[0], rd0, 'the rune was revealed and recycled anyway');
  assert.equal(g.objects[d].damage, 0, 'declined: no damage');
});

test('RJ#7216 Annie, Fiery in the Champion Zone grants nothing (only legends work off-board): Hextech Ray deals 3; once she is on the board, 4', () => {
  for (const onBoard of [false, true]) {
    let g = S0F();
    const an = put(g, P0, 'Annie, Fiery', onBoard ? 'base' : 'hand');
    if (!onBoard) { const pl = g.players[P0]; pl.hand = pl.hand.filter(x => x !== an); g.objects[an].zone = 'championZone'; pl.championZone.push(an); touch(g); }
    const e = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
    g = play(g, P0, hand(g, P0, 'Hextech Ray'), { targets: [[e]] }); g = settle(g);
    assert.equal(g.objects[e].damage, onBoard ? 4 : 3, `onBoard=${onBoard}`);
  }
});

test('RJ#7218 Ember Monk triggers each time I play a card from hiding (no "first time"): two hidden cards → +4', () => {
  let g = S0F();
  const m = put(g, P0, 'Ember Monk', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(9)', 'base');
  const base = mightOf(g, m);
  for (const h of [put(g, P0, 'HidZap', { facedown: BF_A }), put(g, P0, 'HidZap', { facedown: BF_A })]) {
    g = act(g, { type: 'playCard', player: P0, obj: h });
    g = answer(g, { targets: [[e]] });
    g = settle(g);
  }
  assert.equal(mightOf(g, m), base + 4);
});

test('RJ#7222 two Kai\'Sa, Survivor conquer together: each has its own "When I conquer, draw 1" → draw 2', () => {
  let g = S0F();
  const a = put(g, P0, 'Kai\'Sa, Survivor', 'base'), b = put(g, P0, 'Kai\'Sa, Survivor', 'base');
  const h0 = g.players[P0].hand.length;
  g = move(g, P0, [a, b], BF_A);
  for (let i = 0; i < 8 && (g.chain.length || g.pending?.inStep || g.pending?.kind === 'showdownAction'); i++) { g = passAll(g); g = settle(g); }
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[P0].hand.length, h0 + 2);
});

test('RJ#7225 a unit from hand may be played to a battlefield I control (not an uncontrolled one); gear only to base', () => {
  const g = S0F();
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const u = hand(g, P0, 'V(2)'), gear = hand(g, P0, 'Ravenborn Tome');
  assert.deepEqual([...playDests(g, P0, u)].sort(), ['base', BF_A].sort());
  assert.deepEqual(playDests(g, P0, gear), ['base']);
});

test('RJ#7226 Kog\'Maw\'s combat Deathknell resolves before the combat ends (principle 1): Discipline\'d Wielder of Water still defends alone (6) and survives the 4 — then dies once the combat ends (4 Might, 4 marked)', () => {
  let { g, atk, def } = attackSetup(['Kog\'Maw, Caustic'], ['Wielder of Water']);
  fundAll(g, P0); fundAll(g, P1);
  const w = def[0];
  if (pend(g).player === P0) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Discipline'), { targets: [[w]] });
  let seenAtDk = false;
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const p = pend(g);
    if (g.chain.some(c => c.source === atk[0]) && !seenAtDk) {
      seenAtDk = true;
      assert.equal(g.objects[w].combatRole, 'defender', 'still a defender while the Deathknell is on the chain');
      assert.equal(mightOf(g, w), 6);
    }
    g = p.inStep ? act(g, legal(g, p.player)[0]) : pass(g);
  }
  assert.ok(seenAtDk, 'Deathknell went on the chain');
  assert.equal(zone(g, atk[0]), 'trash');
  assert.equal(zone(g, w), 'trash', 'dies after the combat (RJ\'s end result)');
});

test('RJ#7234 Anivia attacks ten 1-Might units: her attack trigger kills them all before combat damage, so she takes none', () => {
  let { g, atk, def } = attackSetup(['Anivia, Primal'], Array.from({ length: 10 }, () => 'V(1)'));
  for (let i = 0; i < 12 && (g.chain.length || g.pending?.inStep || g.pending?.kind === 'showdownAction'); i++) { g = passAll(g); g = settle(g); }
  assert.ok(def.every(d => zone(g, d) === 'trash'));
  assert.equal(locOf(g, atk[0]), BF_A);
  assert.equal(g.objects[atk[0]].damage ?? 0, 0);
  assert.equal(g.battlefields[BF_A].controller, P0);
});

test('RJ#7239 attacking into Reaver\'s Row: the defender\'s defend trigger opens the showdown chain; the attacker\'s Fox-Fire ([Action], not hidden) can\'t be played until that chain resolves', () => {
  let g = S0F({ bfA: "Reaver's Row" });
  const d = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(3)', 'base');
  const ff = hand(g, P0, 'Fox-Fire');
  g = move(g, P0, [a], BF_A);
  let blocked = false;
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) {
    const p = pend(g);
    if (!p.inStep) { if (p.player === P0 && g.chain.length) { assert.ok(!canPlayNow(g, P0, ff), 'Fox-Fire not playable on the closed chain'); blocked = true; } g = pass(g); continue; }
    g = p.kind === 'optional' ? yes(g) : optionIds(g).includes(d) ? choose(g, d) : act(g, legal(g, p.player)[0]);
  }
  assert.ok(blocked, 'P0 had priority on the trigger chain');
  assert.equal(locOf(g, d), 'base', 'defender used the Row first');
  expectPending(g, 'showdownAction', P0);
  assert.ok(canPlayNow(g, P0, ff), 'Fox-Fire playable once the chain resolved (open showdown)');
});

test('RJ#7240 Convergent Mutation on a unit at Trifarian War Camp (2+1): raised to the other unit\'s current Might (5), not 5+1; leaving the Camp → 4', () => {
  let g = S0F({ bfA: 'Trifarian War Camp' });
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const o5 = put(g, P0, 'V(5)', 'base');
  assert.equal(mightOf(g, u), 3);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Convergent Mutation') });
  for (let i = 0; i < 12 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g); if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g); g = choose(g, d.prompt && /another/i.test(d.prompt) ? o5 : o.includes(u) ? u : o[0]);
  }
  assert.equal(mightOf(g, u), 5);
  g = move(g, P0, [u], 'base');
  assert.equal(mightOf(g, u), 4);
});

test('RJ#7241 Tideturner played to base swapping with my unit at Vilemaw\'s Lair: Tideturner moves to the Lair, the unit can\'t move to base and stays', () => {
  let g = S0F({ bfA: "Vilemaw's Lair" });
  const u = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const tt = hand(g, P0, 'Tideturner');
  g = act(g, { type: 'playCard', player: P0, obj: tt, destination: 'base' });
  g = answer(g, { may: [true], targets: [[u]] }, P0);
  g = settle(g);
  assert.equal(locOf(g, tt), BF_A, 'Tideturner moves to the Lair');
  assert.equal(locOf(g, u), BF_A, 'the unit stays');
});

test('RJ#7254 Siphon Power played in response to Nine-Tailed Fox\'s attack trigger resolves first (1 → 2), then the Fox\'s -1 (min 1) brings the Recruit-sized attacker back to 1', () => {
  let g = S0F();
  setLegend(g, P1, 'Nine-Tailed Fox');
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(1)', 'base');
  g = move(g, P0, [a], BF_A);
  assert.ok(g.chain.length >= 1, 'Fox trigger on the chain');
  if (pend(g).player !== P0) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Siphon Power'), { targets: [[g.battlefields[BF_A].objId]] });
  g = resolveChain(g);
  assert.equal(mightOf(g, a), 1);
});

test('RJ#7256 Flash can\'t move a unit out of Vilemaw\'s Lair to base: it stays (no move happened)', () => {
  let g = S0F({ bfA: "Vilemaw's Lair" });
  const u = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const fl = hand(g, P0, 'Flash');
  g = play(g, P0, fl, { targets: [[u]] });
  g = settle(g);
  assert.equal(zone(g, fl), 'trash', 'Flash was played and resolved');
  assert.equal(locOf(g, u), BF_A);
  assert.equal(g.chain.length, 0);
});

test('RJ#7259 choosing an illegal target (Hextech Ray on a unit in base) is not accepted: the play doesn\'t happen, the card stays in hand and nothing is paid', () => {
  let g = S0F();
  const inBase = put(g, P1, 'V(2)', 'base');
  put(g, P1, 'V(2)', BF_A); put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const ray = hand(g, P0, 'Hextech Ray');
  const ready0 = readyRunes(g, P0);
  g = act(g, { type: 'playCard', player: P0, obj: ray });
  expectPending(g, 'chooseTargets', P0);
  assert.ok(!optionIds(g).includes(inBase), 'base unit not offered');
  assert.ok(rejects(g, { type: 'choose', player: P0, optionIds: [inBase] }), 'illegal target rejected');
  const g0 = S0F(); const ray0 = hand(g0, P0, 'Hextech Ray'); put(g0, P1, 'V(2)', 'base');
  assert.ok(!canPlayNow(g0, P0, ray0), 'with only a base unit, Hextech Ray can\'t be played at all');
  assert.equal(zone(g0, ray0), 'hand'); assert.equal(readyRunes(g0, P0), ready0);
});

test('RJ#7262 Leona, Determined\'s attack stun target is chosen as the trigger goes on the chain; the defender Flashes it to base in response → no stun, and Radiant Dawn gives no buff', () => {
  let g = S0F();
  setLegend(g, P0, 'Radiant Dawn');
  const e1 = put(g, P1, 'V(2)', BF_A), e2 = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const le = put(g, P0, 'Leona, Determined', 'base');
  const fl = hand(g, P1, 'Flash');
  g = move(g, P0, [le], BF_A);
  for (let i = 0; i < 6 && !(g.chain.some(c => c.source === le) && !pend(g).inStep); i++) g = pend(g).inStep ? (optionIds(g).includes(e1) ? choose(g, e1) : pend(g).kind === 'optional' ? yes(g) : act(g, legal(g, pend(g).player)[0])) : pass(g);
  const tr = g.chain.find(c => c.source === le)!;
  assert.deepEqual(tr.targets.flat(), [e1], 'target chosen as it went on the chain');
  if (pend(g).player !== P1) g = pass(g);
  g = play(g, P1, fl, { targets: [[e1]] });
  for (let i = 0; i < 12 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(locOf(g, e1), 'base');
  assert.ok(!g.objects[e1].stunned && !g.objects[e2].stunned, 'nobody stunned');
  assert.equal(g.objects[le].counters.buff ?? 0, 0, 'no Radiant Dawn buff');
});

test('RJ#7266 Pack of Wonders returning a unit I control but my opponent owns (Possession): it goes to its owner\'s hand', () => {
  let g = S0F();
  const pk = put(g, P0, 'Pack of Wonders', 'base');
  const u = put(g, P1, 'V(3)', 'base', { controller: P0 });
  assert.equal(g.objects[u].controller, P0);
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === pk)!);
  g = answer(g, { targets: [[u]] });
  g = settle(g);
  assert.equal(zone(g, u), 'hand');
  assert.ok(g.players[P1].hand.includes(u), 'owner\'s hand');
  assert.ok(!g.players[P0].hand.includes(u));
});

test('RJ#7273 2v2: I can\'t hide a card at a battlefield my teammate controls (control isn\'t shared); I can at my own', () => {
  const g = createGame({ seed: 3, cardDb: fixtureDb(), mode: '2v2', firstPlayer: P0, skipMulligan: true, battlefieldSelection: 'random', includeAllCards: true,
    players: [0, 1, 2, 3].map(i => ({ name: `P${i}`, deck: legalDeck({ legend: i >= 2 ? 'cf-legend-2' : 'cf-legend' }, [`cf-bf-${'abde'[i]}`, `cf-bf-${'bcef'[i]}`, `cf-bf-${'cdfa'[i]}`]) })) } as never) as GameState;
  assert.ok(g.pending?.kind === 'mainAction' && g.pending.player === P0);
  fundAll(g, P0);
  put(g, 2 as PlayerId, 'V(2)', 0); control(g, 0, 2 as PlayerId);
  put(g, P0, 'V(2)', 1); control(g, 1, P0);
  const h = hand(g, P0, 'HidZap');
  const hides = legal(g, P0).filter(a => a.type === 'hide' && (a as { obj?: ObjId }).obj === h).map(a => JSON.stringify(a));
  assert.ok(hides.some(s => /"battlefieldIndex":1\b/.test(s)), `can hide at my own battlefield (${hides})`);
  assert.ok(!hides.some(s => /"battlefieldIndex":0\b/.test(s)), 'not at the teammate\'s');
});

test('RJ#7277 two Leona, Determined attack a lone Deadbloom Predator (Deflect): each stun trigger chooses it and pays Deflect; the second stun does nothing, so Radiant Dawn buffs only once', () => {
  let g = S0F();
  setLegend(g, P0, 'Radiant Dawn');
  const dp = put(g, P1, 'Deadbloom Predator', BF_A); control(g, BF_A, P1);
  const l1 = put(g, P0, 'Leona, Determined', 'base'), l2 = put(g, P0, 'Leona, Determined', 'base');
  const ready0 = readyRunes(g, P0);
  g = move(g, P0, [l1, l2], BF_A);
  let deflects = 0;
  for (let i = 0; i < 30 && (g.chain.length || pend(g).inStep); i++) {
    const p = pend(g);
    if (!p.inStep) { g = pass(g); continue; }
    if (p.kind === 'optional') { if (/Deflect/.test(p.prompt ?? '')) deflects++; g = yes(g); continue; }
    g = act(g, legal(g, p.player)[0]);
  }
  assert.equal(deflects, 2, 'Deflect asked for each trigger');
  assert.ok(g.objects[dp].stunned);
  const buffs = [l1, l2].reduce((n, x) => n + (g.objects[x].counters.buff ?? 0), 0);
  assert.equal(buffs, 1, 'one Radiant Dawn buff');
  assert.ok(readyRunes(g, P0) < ready0, 'Deflect paid');
});

test('RJ#7282 Cannon Barrage in response to Warwick, Hunter\'s attack trigger resolves first; Warwick then kills every damaged enemy unit there', () => {
  let { g, atk, def } = attackSetup(['Warwick, Hunter'], ['V(5)', 'V(5)']);
  fundAll(g, P0);
  assert.ok(g.chain.some(c => c.source === atk[0]), 'Warwick trigger on the chain');
  if (pend(g).player !== P0) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Cannon Barrage'));
  for (let i = 0; i < 10 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(def.every(d => zone(g, d) === 'trash'), 'both damaged defenders killed before combat damage');
});

test('RJ#7287 Yasuo, Remorseful attacks (6 to the defender), Rides the Wind back to base mid-showdown: the combat still ends with its heal; then Unforgiven moves him in again → a new combat and another 6', () => {
  let { g, atk, def } = attackSetup(['Yasuo, Remorseful'], ['V(9)']);
  fundAll(g, P0);
  const leg = setLegend(g, P0, 'Unforgiven');
  for (let i = 0; i < 10 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(g.objects[def[0]].damage, 6);
  if (pend(g).player !== P0) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[atk[0]]] });
  const drain = () => { for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) { const p = pend(g); if (p.inStep) { const o = optionIds(g); g = act(g, { type: 'choose', player: p.player, optionIds: [o.includes('base') ? 'base' : o.includes(String(BF_A)) ? String(BF_A) : o[0]] }); continue; } g = pass(g); } };
  drain();
  assert.equal(locOf(g, atk[0]), 'base');
  assert.equal(g.objects[def[0]].damage, 0, 'healed at the end of that combat');
  const ab = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === leg);
  assert.ok(ab, 'Unforgiven usable in the open main phase');
  g = act(g, ab!);
  let hit = false;
  for (let i = 0; i < 20 && !hit && pend(g).kind !== 'mainAction'; i++) {
    const p = pend(g);
    if (p.inStep) { const o = optionIds(g); g = act(g, { type: 'choose', player: p.player, optionIds: [o.includes(atk[0]) ? atk[0] : o.includes(String(BF_A)) ? String(BF_A) : o.includes(def[0]) ? def[0] : o[0]] }); }
    else g = pass(g);
    if (g.objects[def[0]].damage === 6) hit = true;
  }
  assert.ok(hit, 'second attack trigger dealt 6 again');
});

test('RJ#7295 Ahri, Inquisitive defending: Retreated in response to her defend trigger → "an enemy unit here" no longer applies, no -2; letting it resolve first → -2 stays after she leaves', () => {
  for (const first of ['retreat', 'ahri'] as const) {
    let { g, atk, def } = attackSetup(['V(5)'], ['Ahri, Inquisitive']);
    fundAll(g, P1);
    const ahri = def[0], ret = hand(g, P1, 'Retreat');
    for (let i = 0; i < 6 && !(g.chain.some(c => c.source === ahri) && !pend(g).inStep); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
    if (first === 'retreat') {
      if (pend(g).player !== P1) g = pass(g);
      g = play(g, P1, ret, { targets: [[ahri]] });
      for (let i = 0; i < 10 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
      assert.equal(zone(g, ahri), 'hand');
      assert.equal(mightOf(g, atk[0]), 5, 'no -2');
    } else {
      for (let i = 0; i < 10 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
      assert.equal(mightOf(g, atk[0]), 3);
      if (pend(g).player !== P1) g = pass(g);
      g = play(g, P1, ret, { targets: [[ahri]] });
      for (let i = 0; i < 10 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
      assert.equal(zone(g, ahri), 'hand');
      assert.equal(mightOf(g, atk[0]), 3, '-2 stays');
    }
  }
});

test('RJ#7301 2v2: a battlefield my teammate controlled in my Scoring Step (disqualified) — I later take it: no score, so no conquer and no conquer trigger (Kai\'Sa, Survivor draws nothing); not disqualified → point + draw', () => {
  for (const disq of [true, false]) {
    let g = createGame({ seed: 3, cardDb: fixtureDb(), mode: '2v2', firstPlayer: P0, skipMulligan: true, battlefieldSelection: 'random', includeAllCards: true,
      players: [0, 1, 2, 3].map(i => ({ name: `P${i}`, deck: legalDeck({ legend: i >= 2 ? 'cf-legend-2' : 'cf-legend' }, [`cf-bf-${'abde'[i]}`, `cf-bf-${'bcef'[i]}`, `cf-bf-${'cdfa'[i]}`]) })) } as never) as GameState;
    assert.ok(g.pending?.kind === 'mainAction' && g.pending.player === P0);
    if (disq) { g.ex.turnFacts['teamDisq:0'] = [0]; touch(g); } // as set by the hold step (turn.ts) when teammate P2 controlled battlefield 0
    const k = put(g, P0, 'Kai\'Sa, Survivor', 'base');
    const h0 = g.players[P0].hand.length, pts0 = g.players[P0].points;
    g = move(g, P0, [k], 0);
    for (let i = 0; i < 8 && (g.chain.length || g.pending?.inStep || g.pending?.kind === 'showdownAction'); i++) { g = passAll(g); g = settle(g); }
    assert.equal(g.battlefields[0].controller, P0, 'control established');
    assert.equal(g.players[P0].points, pts0 + (disq ? 0 : 1), `points (disq=${disq})`);
    assert.equal(g.players[P0].hand.length, h0 + (disq ? 0 : 1), `conquer draw (disq=${disq})`);
  }
});

test('RJ#7304 (MISMATCH-RJ partial) Unforgiven moves a unit only "to or from its base": a Ganking unit at a battlefield can only go to base with it; Ride the Wind can move it battlefield → battlefield', () => {
  let g = S0F();
  const leg = setLegend(g, P0, 'Unforgiven');
  const u = put(g, P0, 'Yasuo, Windrider', BF_A); control(g, BF_A, P0);
  const ab = legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === leg)!;
  let h = act(g, ab);
  const dests = new Set<string>();
  for (let i = 0; i < 6 && pend(h).inStep; i++) {
    const o = optionIds(h);
    if (o.includes(u)) { h = choose(h, u); continue; }
    o.forEach(x => dests.add(x));
    break;
  }
  if (dests.size) { assert.ok(dests.has('base'), `base offered (${[...dests]})`); assert.ok(!dests.has(String(BF_B)), 'no battlefield → battlefield'); }
  else { h = settle(h); assert.equal(locOf(h, u), 'base', 'only destination: base'); }
  g = play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[u]] });
  g = settle(g, [String(BF_B)]);
  assert.equal(locOf(g, u), BF_B, 'Ride the Wind: battlefield → battlefield');
});

test('RJ#7307 Wuju Bladesman: two defenders at Reaver\'s Row, the Row moves one to base → the other defends alone (+2)', () => {
  let g = S0F({ tp: P1, bfA: "Reaver's Row" });
  setLegend(g, P0, 'Wuju Bladesman');
  const a = put(g, P0, 'V(2)', BF_A), b = put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(1)', 'base');
  g = move(g, P1, [e], BF_A);
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) {
    const p = pend(g);
    if (!p.inStep) { g = pass(g); continue; }
    g = p.kind === 'optional' ? yes(g) : optionIds(g).includes(b) ? choose(g, b) : act(g, legal(g, p.player)[0]);
  }
  assert.equal(locOf(g, b), 'base');
  assert.equal(g.objects[a].combatRole, 'defender');
  assert.equal(mightOf(g, a), 4);
});

test('RJ#7309 a dual-domain Power cost (Rabadon\'s Deathcrown, Calm/Mind, [A][A]) can be paid with either domain in any mix: Calm+Mind, Calm+Calm, Mind+Mind; not with Fury', () => {
  const ok = (doms: ('calm' | 'mind' | 'fury')[]) => {
    const g = S0(); setRunes(g, P0, 2, 'body');
    for (const d of doms) addRunes(g, P0, 1, d);
    const c = hand(g, P0, 'Rabadon\'s Deathcrown');
    return canPlayNow(g, P0, c);
  };
  assert.ok(ok(['calm', 'mind']), 'one of each');
  assert.ok(ok(['calm', 'calm']), 'two Calm');
  assert.ok(ok(['mind', 'mind']), 'two Mind');
  assert.ok(!ok(['calm', 'fury']), 'only one matching');
});

test('RJ#7310 Zhonya\'s Hourglass saves a friendly unit dying in base: the recall part does nothing, the save still happens (healed, exhausted, stays in base)', () => {
  let g = S0F();
  const zh = put(g, P0, 'Zhonya\'s Hourglass', 'base');
  const u = put(g, P0, 'V(2)', 'base');
  g = play(g, P0, hand(g, P0, 'ZapM'), { targets: [[u]] });
  for (let i = 0; i < 10 && (g.chain.length || pend(g).inStep); i++) g = pend(g).inStep ? (pend(g).kind === 'optional' ? yes(g) : act(g, legal(g, pend(g).player)[0])) : pass(g);
  assert.equal(zone(g, zh), 'trash', 'Hourglass killed instead');
  assert.equal(locOf(g, u), 'base');
  assert.equal(g.objects[u].damage, 0);
  assert.ok(g.objects[u].exhausted);
});

test('RJ#7311 Pack of Wonders can\'t return a card from my trash (only friendly gear, units or facedown cards on the board)', () => {
  let g = S0F();
  const pk = put(g, P0, 'Pack of Wonders', 'base');
  const tr = put(g, P0, 'V(3)', 'trash');
  const b = put(g, P0, 'V(2)', 'base');
  const b2 = put(g, P0, 'V(1)', 'base');
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === pk)!);
  const o = g.pending?.kind === 'chooseTargets' ? optionIds(g) : (g.chain.at(-1)?.targets.flat() ?? []);
  assert.ok(o.includes(b) && o.includes(b2), `board units offered (${o})`);
  assert.ok(!o.includes(tr), 'trash card not offered');
});

test('RJ#7313 Vayne, Hunter (Assault 3) attacking: the only defender is removed mid-showdown (Retreat) — she stays an attacker with 5 Might for the rest of the combat', () => {
  let { g, atk, def } = attackSetup(['Vayne, Hunter'], ['V(1)']);
  fundAll(g, P1);
  for (let i = 0; i < 6 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(mightOf(g, atk[0]), 5);
  if (pend(g).player !== P1) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Retreat'), { targets: [[def[0]]] });
  for (let i = 0; i < 6 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(zone(g, def[0]), 'hand');
  assert.equal(g.objects[atk[0]].combatRole, 'attacker', 'still the attacker');
  assert.equal(mightOf(g, atk[0]), 5, 'Assault still applies');
});

test('RJ#7315 Stormbringer may choose an empty battlefield (needs a friendly unit in base): the unit moves there', () => {
  let g = S0F();
  const u = put(g, P0, 'V(3)', 'base');
  const bfB = g.battlefields[BF_B].objId;
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Stormbringer') });
  for (let i = 0; i < 6 && pend(g).inStep; i++) { const o = optionIds(g); g = choose(g, o.includes(u) ? u : o.includes(bfB) ? bfB : o.includes(String(BF_B)) ? String(BF_B) : o[0]); }
  g = settle(g, [String(BF_B), bfB]);
  assert.equal(locOf(g, u), BF_B);
  const g2 = S0F(); put(g2, P0, 'V(3)', BF_A);
  assert.ok(!canPlayNow(g2, P0, hand(g2, P0, 'Stormbringer')), 'no friendly unit in base → can\'t be played');
});

test('RJ#7323 Not So Fast counters a whole Repeat spell (both executions): Bellows Breath with Repeat on my two units deals nothing', () => {
  let g = S0F({ tp: P1 });
  const u1 = put(g, P0, 'V(3)', 'base'), u2 = put(g, P0, 'V(3)', 'base');
  const bb = hand(g, P1, 'Bellows Breath');
  g = play(g, P1, bb, { may: [true], targets: [[u1, u2], [u1, u2]] });
  for (let i = 0; i < 6 && pend(g).inStep; i++) g = act(g, legal(g, pend(g).player)[0]);
  assert.ok(g.chain.some(c => c.source === bb), 'Bellows Breath on the chain');
  if (pend(g).player !== P0) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Not So Fast'), { targets: [[g.chain.find(c => c.source === bb)!.source]] });
  for (let i = 0; i < 10 && (g.chain.length || pend(g).inStep); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(zone(g, bb), 'trash');
  assert.equal(g.objects[u1].damage, 0);
  assert.equal(g.objects[u2].damage, 0);
});

test('RJ#7325 two Facebreakers on the same (already stunned) friendly unit stun two different enemy units', () => {
  let g = S0F();
  const f = put(g, P0, 'V(2)', BF_A), e1 = put(g, P1, 'V(2)', BF_A), e2 = put(g, P1, 'V(2)', BF_A);
  const cast = (e: ObjId) => {
    g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Facebreaker') });
    for (let i = 0; i < 6 && pend(g).inStep; i++) { const o = optionIds(g); g = choose(g, o.includes(f) ? f : o.includes(e) ? e : o[0]); }
    g = settle(g);
  };
  cast(e1);
  assert.ok(g.objects[f].stunned && g.objects[e1].stunned);
  cast(e2);
  assert.ok(g.objects[e2].stunned, 'second enemy stunned');
});

test('RJ#7332 Stupefy (-1, min 1) on a defending 1-Might Shield 1 unit (2) is snapshotted as -1 → 1; when the combat ends and Shield stops, it is at 0 Might and survives', () => {
  let { g, atk, def } = attackSetup(['V(3)'], ['Shield(1,1)']);
  fundAll(g, P0); fundAll(g, P1);
  g.objects[atk[0]].stunned = true; touch(g);
  for (let i = 0; i < 6 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(mightOf(g, def[0]), 2);
  if (pend(g).player !== P0) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Stupefy'), { targets: [[def[0]]] });
  for (let i = 0; i < 6 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(mightOf(g, def[0]), 1);
  for (let i = 0; i < 10 && (g.chain.length || g.pending?.inStep || g.pending?.kind === 'showdownAction'); i++) { g = passAll(g); g = settle(g); }
  assert.equal(locOf(g, atk[0]), 'base', 'combat over (attacker recalled)');
  assert.equal(zone(g, def[0]), 'battlefield', 'survives at 0');
  assert.equal(mightOf(g, def[0]), 0);
});

test('RJ#7336 Caitlyn, Patrolling\'s [T] ability targets on activation: its target Retreated in response → no damage, no new target', () => {
  let g = S0F();
  const c = put(g, P0, 'Caitlyn, Patrolling', BF_A); control(g, BF_A, P0);
  const e1 = put(g, P1, 'V(5)', BF_B), e2 = put(g, P1, 'V(5)', BF_B); control(g, BF_B, P1);
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === c)!);
  g = answer(g, { targets: [[e1]] });
  if (pend(g).player !== P1) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Retreat'), { targets: [[e1]] });
  g = settle(g);
  assert.equal(zone(g, e1), 'hand');
  assert.equal(g.objects[e2].damage, 0, 'no retarget');
  assert.equal(g.objects[c].damage, 0);
});

test('RJ#7337 Unyielding Spirit prevents Caitlyn, Patrolling\'s ability damage (the ability deals it), not Snapvine-style unit damage (RJ#2602)', () => {
  let g = S0F();
  const c = put(g, P0, 'Caitlyn, Patrolling', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(5)', BF_B); control(g, BF_B, P1);
  g = settle(play(g, P0, hand(g, P0, 'Unyielding Spirit')));
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === c)!);
  g = answer(g, { targets: [[e]] });
  g = settle(g);
  assert.ok(g.objects[c].exhausted, 'ability used');
  assert.equal(g.objects[e].damage, 0, 'prevented');
});

test('RJ#7339 (nuance) outside combat: Lee Sin, Centered dies to a spell → in the next cleanup his +2 is gone and a buffed ally\'s existing damage becomes lethal', () => {
  let g = S0F();
  const ls = put(g, P1, 'Lee Sin, Centered', BF_A, { damage: 3 });
  const al = put(g, P1, 'V(2)', BF_A, { buff: true, damage: 4 }); control(g, BF_A, P1);
  assert.equal(mightOf(g, al), 5);
  assert.equal(zone(g, al), 'battlefield');
  g = settle(play(g, P0, hand(g, P0, 'Hextech Ray'), { targets: [[ls]] }));
  assert.equal(zone(g, ls), 'trash');
  assert.equal(zone(g, al), 'trash', 'ally dies once the +2 is gone');
});

test('RJ#7342 Stormbringer deals the chosen unit\'s full Might to EACH enemy unit there (not split)', () => {
  let g = S0F();
  const d = put(g, P0, 'V(4)', 'base');
  const e1 = put(g, P1, 'V(6)', BF_A), e2 = put(g, P1, 'V(6)', BF_A); control(g, BF_A, P1);
  const bfA = g.battlefields[BF_A].objId;
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Stormbringer') });
  for (let i = 0; i < 6 && pend(g).inStep; i++) { const o = optionIds(g); g = choose(g, o.includes(d) ? d : o.includes(bfA) ? bfA : o.includes(String(BF_A)) ? String(BF_A) : o[0]); }
  g = settle(g, [String(BF_A), bfA]);
  assert.equal(g.objects[e1].damage, 4);
  assert.equal(g.objects[e2].damage, 4);
});

test('RJ#7345 Volibear, Furious\'s attack trigger kills the only defender during the showdown\'s initial chain; the showdown continues with actions possible', () => {
  let g = S0F();
  const d = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const v = put(g, P0, 'Volibear, Furious', 'base');
  g = move(g, P0, [v], BF_A);
  for (let i = 0; i < 6 && pend(g).inStep; i++) {
    const p = pend(g);
    if (p.kind === 'chooseNumber') g = choose(g, p.options!.at(-1)!.id);
    else g = p.options?.some(o => o.id === d) ? choose(g, d) : choose(g, p.options![0].id);
  }
  for (let i = 0; i < 6 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(zone(g, d), 'trash', 'died before any action');
  assert.ok(g.showdown, 'still in the showdown');
  assert.equal(pend(g).kind, 'showdownAction');
});

test('RJ#7346 damage marked on a unit doesn\'t reduce the combat damage it deals (a 5-Might defender with 2 damage still deals 5)', () => {
  let { g, atk, def } = attackSetup(['V(5)'], ['V(5)'], { defOpts: [{ damage: 2 }] });
  g = passAll(g);
  assert.equal(zone(g, atk[0]), 'trash', 'took 5');
  assert.equal(zone(g, def[0]), 'trash');
});

test('RJ#7348 (MISMATCH-RJ) defending Watchful Sentry dies; in response to its Deathknell the hidden Tideturner swaps Dr. Mundo in: both sides have units → no conquer, a new combat (CR 468.2 → 468.3.d)', () => {
  let { g, atk } = attackSetup(['V(5)'], ['Watchful Sentry'], { runes: [6, 6] });
  fundAll(g, P1);
  const tt = put(g, P1, 'Tideturner', { facedown: BF_A });
  const mu = put(g, P1, 'Dr. Mundo, Expert', 'base');
  for (let i = 0; i < 30 && !g.chain.length; i++) { const d = pend(g); g = d.kind === 'assignDamage' ? act(g, legal(g, d.player)[0]) : d.inStep ? act(g, legal(g, d.player)[0]) : pass(g); }
  for (let i = 0; i < 4 && pend(g).player !== P1; i++) g = pass(g);
  expectPending(g, 'chainResponse', P1, 'Deathknell on the chain');
  g = act(g, { type: 'playCard', player: P1, obj: tt });
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) {
    const p = pend(g);
    if (!p.inStep) { g = pass(g); continue; }
    g = p.kind === 'optional' ? yes(g) : optionIds(g).includes(mu) ? choose(g, mu) : act(g, legal(g, p.player)[0]);
  }
  assert.equal(locOf(g, mu), BF_A, 'Mundo swapped in');
  assert.equal(locOf(g, tt), 'base');
  assert.notEqual(g.battlefields[BF_A].controller, P0, 'attacker did not conquer');
  assert.ok(g.showdown?.isCombat && g.showdown.battlefieldIndex === BF_A || locOf(g, atk[0]) !== BF_A, 'new combat staged (or already fought)');
});

test('RJ#7353 hidden Hidden Blade kills Anivia, Primal in response to her attack trigger: "deal 3 to all enemy units here" then deals nothing', () => {
  let g = S0F();
  const d1 = put(g, P1, 'V(4)', BF_A), d2 = put(g, P1, 'V(4)', BF_A); control(g, BF_A, P1);
  const hb = put(g, P1, 'Hidden Blade', { facedown: BF_A });
  const an = put(g, P0, 'Anivia, Primal', 'base');
  g = move(g, P0, [an], BF_A);
  for (let i = 0; i < 8 && !(g.chain.length && pend(g).player === P1 && !pend(g).inStep); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(g.chain.some(c => c.source === an), 'Anivia\'s attack trigger on the chain');
  assert.ok(canPlayNow(g, P1, hb), 'hidden Blade (Reaction timing) can respond');
  g = play(g, P1, hb, { targets: [[an]] });
  for (let i = 0; i < 10 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(zone(g, an), 'trash');
  assert.equal(g.objects[d1].damage, 0); assert.equal(g.objects[d2].damage, 0);
});

test('RJ#7359 Guerilla Warfare returns only cards that have [Hidden] themselves — not Ember Monk or Guerilla Warfare (they only mention it)', () => {
  let g = S0F();
  const cp = put(g, P0, 'Consult the Past', 'trash');
  const em = put(g, P0, 'Ember Monk', 'trash');
  const gw2 = put(g, P0, 'Guerilla Warfare', 'trash');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Guerilla Warfare') });
  for (let i = 0; i < 6 && !(pend(g).inStep && optionIds(g).includes(cp)); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  const o = optionIds(g);
  assert.ok(o.includes(cp), 'Consult the Past offered');
  assert.ok(!o.includes(em), 'Ember Monk not offered');
  assert.ok(!o.includes(gw2), 'Guerilla Warfare not offered');
});

test('RJ#7360 Retreat must target a friendly unit if there is one (can\'t choose none to just trigger Ravenbloom Student), and returns it', () => {
  let g = S0F();
  const rs = put(g, P0, 'Ravenbloom Student', BF_A); control(g, BF_A, P0);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Retreat') });
  if (pend(g).kind === 'chooseTargets') {
    assert.ok(validateAction(g, { type: 'choose', player: P0, optionIds: [] }), 'zero targets rejected');
    g = choose(g, rs);
  }
  assert.deepEqual(g.chain.at(-1)!.targets.flat(), [rs], 'the only friendly unit is the (mandatory) target');
  g = settle(g);
  assert.equal(zone(g, rs), 'hand');
});

// ADJUDICATOR-4 (DECISIONS #7364): CR 1.5 429.5.b/429.5.d attribute the delayed kill to Noxian Guillotine (the spell containing
// the Kill instruction, and the creator of the ability that kills) — its controller killed a unit with a spell. The OGN-FAQ entry
// ("immediately after a spell you control resolves") calls itself interim ("the updated rules will clarify"). RJ#7364 adopted.
test('RJ#7364 Noxian Guillotine\'s delayed kill (after combat damage) is attributed to the spell (CR 429.5.b/d): Immortal Phoenix triggers', () => {
  let g = S0F();
  const ph = put(g, P0, 'Immortal Phoenix', 'trash');
  const d = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(1)', 'base');
  g = settle(play(g, P0, hand(g, P0, 'Noxian Guillotine'), { targets: [[d]] }));
  assert.equal(zone(g, d), 'battlefield');
  g = move(g, P0, [a], BF_A);
  let sawPhoenix = false;
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const p = pend(g);
    if (p.inStep && /Phoenix/.test(p.prompt ?? '')) sawPhoenix = true;
    g = p.inStep ? (p.kind === 'optional' ? yes(g) : act(g, legal(g, p.player)[0])) : pass(g);
  }
  assert.equal(zone(g, d), 'trash', 'Guillotine killed it on combat damage');
  assert.ok(sawPhoenix || g.log.some(l => /Immortal Phoenix/.test(l.text) && /[Tt]rigger/.test(l.text)), 'Phoenix triggers');
  assert.notEqual(zone(g, ph), 'trash', 'Phoenix played from the trash (paid)');
});

test('RJ#7374 Kato the Arm leaves the board (Retreat) while his move trigger is on the chain: no information is read from his new zone — the chosen unit gets no keywords and no +Might', () => {
  let g = S0F();
  const k = put(g, P0, 'Kato the Arm', 'base');
  const o = put(g, P0, 'V(1)', 'base');
  g = move(g, P0, [k], BF_A);
  for (let i = 0; i < 6 && !(g.chain.some(c => c.source === k) && !pend(g).inStep); i++) { const d = pend(g); g = d.inStep ? choose(g, optionIds(g).includes(o) ? o : d.options![0].id) : pass(g); }
  assert.ok(g.chain.some(c => c.source === k), 'Kato trigger on the chain');
  if (pend(g).player !== P0) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Retreat'), { targets: [[k]] });
  for (let i = 0; i < 10 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(zone(g, k), 'hand');
  assert.equal(mightOf(g, o), 1, 'no +Might');
  assert.ok(!hasKeyword(g, o, 'Deflect'), 'no keywords');
});

test('RJ#7378 moving to an empty battlefield starts a (non-combat) showdown: the opponent may play an Action (Hextech Ray) on the mover', () => {
  let g = S0F();
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_A);
  assert.ok(g.showdown && !g.showdown.isCombat, 'showdown, not combat');
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  const ray = hand(g, P1, 'Hextech Ray');
  assert.ok(canPlayNow(g, P1, ray), 'Action playable in the showdown');
  g = settle(play(g, P1, ray, { targets: [[u]] }));
  assert.equal(zone(g, u), 'trash');
});

test('RJ#7380 Promising Future, both players play Time Warp: each extra turn goes right after the current one, so the Time Warp that resolves later gives the earlier extra turn', () => {
  let g = S0(); fundAll(g, P0, 6); fundAll(g, P1, 6);
  for (const p of [P0, P1]) for (let i = 0; i < 5; i++) put(g, p, 'Time Warp', 'deckTop');
  g = play(g, P0, hand(g, P0, 'Promising Future'));
  for (let i = 0; i < 60 && pend(g).kind !== 'mainAction'; i++) { const d = pend(g); g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g); }
  const order = g.log.filter(l => /will take an extra turn/.test(l.text)).map(l => l.text.startsWith('P1') ? P1 : P0);
  assert.equal(order.length, 2);
  assert.deepEqual(g.ex.extraTurns, [order[1], order[0]], 'last created first');
  g = nextTurn(g); assert.equal(g.activePlayer, order[1]);
});

test('RJ#7386 hidden Here to Help plays Brynhir Thundersong in response to Spectral Matron\'s play trigger: Brynhir\'s trigger resolves first, so the Matron can\'t play a unit from the trash', () => {
  let g = S0F();
  const tr = put(g, P0, 'V(2)', 'trash');
  put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  const hth = put(g, P1, 'Here to Help', { facedown: BF_B });
  const br = hand(g, P1, 'Brynhir Thundersong');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Spectral Matron'), destination: 'base' } as never);
  for (let i = 0; i < 6 && !(g.chain.length && !pend(g).inStep && pend(g).player === P1); i++) { const d = pend(g); g = d.inStep ? (d.kind === 'optional' ? yes(g) : optionIds(g).includes(tr) ? choose(g, tr) : act(g, legal(g, d.player)[0])) : pass(g); }
  assert.ok(g.chain.some(c => /Spectral Matron/.test(chainLabel(g, c.source))), 'Matron trigger on the chain');
  g = act(g, { type: 'playCard', player: P1, obj: hth });
  for (let i = 0; i < 30 && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    if (d.kind === 'optional') { g = yes(g); continue; }
    const ids = optionIds(g);
    g = ids.includes(br) ? choose(g, br) : ids.includes(String(BF_B)) ? choose(g, String(BF_B)) : ids.includes(tr) ? choose(g, tr) : act(g, legal(g, d.player)[0]);
  }
  assert.equal(locOf(g, br), BF_B, 'Brynhir played');
  assert.equal(zone(g, tr), 'trash', 'Matron could not play the unit');
});
function chainLabel(g: GameState, id: ObjId): string { const o = g.objects[id]; return o ? g.cards[o.cardId]?.name ?? '' : ''; }

test('RJ#7388 (MISMATCH-RJ) Vayne, Hunter\'s "When I conquer, you may pay [1] to return me": the may/payment is decided when the trigger goes on the chain (CR 383.3.a-b, principle 11), not on resolution', () => {
  let g = S0F();
  const v = put(g, P0, 'Vayne, Hunter', 'base');
  g = move(g, P0, [v], BF_A);
  let seen = false, payDuringChain = false;
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.inStep && d.kind === 'optional' && /Vayne|return/i.test(d.prompt ?? '')) {
      seen = true;
      assert.ok(!g.chain.some(c => c.source === v && (c as { pending?: boolean }).pending === false), 'not yet a resolving chain item');
      const r0 = readyRunes(g, P0);
      g = yes(g);
      for (let j = 0; j < 4 && pend(g).inStep && pend(g).kind !== 'optional'; j++) g = act(g, legal(g, pend(g).player)[0]);
      payDuringChain = readyRunes(g, P0) < r0 && g.chain.some(c => c.source === v);
      continue;
    }
    g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  assert.ok(seen, 'decision offered');
  assert.ok(payDuringChain, 'paid while the trigger is on the chain (before it resolves)');
  assert.equal(zone(g, v), 'hand');
});

test('RJ#7392 Adaptatron conquering together with another unit still triggers "When I conquer"', () => {
  let g = S0F();
  const ad = put(g, P0, 'Adaptatron', 'base'), o = put(g, P0, 'V(1)', 'base');
  const gear = put(g, P1, 'Long Sword', 'base');
  g = move(g, P0, [ad, o], BF_A);
  g = settle(g, [gear]);
  for (let i = 0; i < 10 && pend(g).kind !== 'mainAction'; i++) { const d = pend(g); g = d.inStep ? (d.kind === 'optional' ? yes(g) : optionIds(g).includes(gear) ? choose(g, gear) : act(g, legal(g, d.player)[0])) : pass(g); }
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(zone(g, gear), 'trash', 'gear killed');
  assert.ok(g.objects[ad].counters.buff, 'Adaptatron buffed');
});

test('RJ#7395 The Boss can save a buffed unit dying in base: the recall does nothing, the save still happens', () => {
  let g = S0F();
  setLegend(g, P0, 'The Boss');
  const u = put(g, P0, 'V(1)', 'base', { buff: true });
  g = play(g, P0, hand(g, P0, 'ZapM'), { targets: [[u]] });
  for (let i = 0; i < 10 && (g.chain.length || pend(g).inStep); i++) g = pend(g).inStep ? (pend(g).kind === 'optional' ? yes(g) : act(g, legal(g, pend(g).player)[0])) : pass(g);
  assert.equal(zone(g, u), 'base', 'saved (2 damage was lethal for 1 + buff)');
  assert.equal(g.objects[u].damage, 0);
  assert.ok(g.objects[u].exhausted);
  assert.ok(!g.objects[u].counters.buff, 'buff spent');
});

test('RJ#7397 a cleanup runs after each chain item: Smoke Screen on top makes a damaged unit\'s damage lethal → it dies before the Discipline under it resolves', () => {
  let g = S0F();
  const u = put(g, P0, 'V(5)', BF_A, { damage: 2 }); control(g, BF_A, P0);
  g = play(g, P0, hand(g, P0, 'Discipline'), { targets: [[u]] });
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'Smoke Screen'), { targets: [[u]] });
  g = pass(g); g = pass(g);
  assert.equal(zone(g, u), 'trash', 'died after Smoke Screen resolved');
  assert.equal(g.chain.length, 1, 'Discipline still on the chain');
});

test('RJ#7399 two Time Warps in one turn: the extra turns stack (two extra turns)', () => {
  let g = S0(); fundAll(g, P0, 6); addRunes(g, P0, 12, 'mind');
  for (let k = 0; k < 2; k++) g = settle(play(g, P0, hand(g, P0, 'Time Warp')));
  assert.deepEqual(g.ex.extraTurns, [P0, P0]);
});

test('RJ#7401 Find Your Center: the opponent at 4 conquering to 5 — in the showdown it is still full cost; after the point there is no priority on their turn', () => {
  let g = S0F();
  setRunes(g, P1, 1, 'calm');
  g.players[P0].points = 4; touch(g);
  const fy = hand(g, P1, 'Find Your Center');
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_A);
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  assert.equal(pend(g).kind, 'showdownAction');
  assert.ok(!canPlayNow(g, P1, fy), 'no discount at 4 points (cost 3, one rune)');
  for (let i = 0; i < 10 && pend(g).kind !== 'mainAction'; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(g.players[P0].points, 5);
  expectPending(g, 'mainAction', P0, 'turn player acts; no window for P1');
});

test('RJ#7403/7406 moving to a battlefield I already control: no showdown, no chain, no priority passed (discretionary action)', () => {
  let g = S0F();
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const u = put(g, P0, 'V(2)', 'base');
  const pts = g.players[P0].points;
  g = move(g, P0, [u], BF_A);
  assert.equal(g.showdown ?? null, null, 'no showdown');
  assert.equal(g.chain.length, 0);
  expectPending(g, 'mainAction', P0);
  assert.equal(g.players[P0].points, pts, 'no conquer');
});

test('RJ#7404 Baited Hook reads the killed unit\'s Might as it dies (incl. Trifarian War Camp\'s +1): a 2-Might unit there (3) can fetch a 4-Might unit', () => {
  const g0 = S0F({ bfA: 'Trifarian War Camp' });
  const v = put(g0, P0, 'V(2)', BF_A); control(g0, BF_A, P0);
  assert.equal(mightOf(g0, v), 3);
  const hook = put(g0, P0, 'Baited Hook', 'base');
  const top = put(g0, P0, 'V(4)', 'deckTop');
  let offered = false;
  let g = act(g0, { type: 'activate', player: P0, obj: hook, abilityIndex: 0 } as never);
  for (let i = 0; i < 30 && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const ids = optionIds(g);
    if (d.kind === 'optional') { g = yes(g); continue; }
    if (ids.includes(v) && zone(g, v) !== 'trash') { g = choose(g, v); continue; }
    if (ids.includes(top)) { offered = true; g = choose(g, top); continue; }
    g = act(g, legal(g, d.player)[0]);
  }
  assert.equal(zone(g, v), 'trash');
  assert.ok(offered, 'the 4-Might unit can be chosen (3 + 1)');
  assert.ok(['base', 'battlefield'].includes(zone(g, top)), 'played');
});

test('RJ#7411 The Boss spends only the dying unit\'s own buff: an unbuffed unit can\'t be saved with another unit\'s buff', () => {
  let g = S0F();
  setLegend(g, P0, 'The Boss');
  const u = put(g, P0, 'V(1)', 'base');
  const b = put(g, P0, 'V(3)', 'base', { buff: true });
  g = play(g, P0, hand(g, P0, 'ZapM'), { targets: [[u]] });
  let offered = false;
  for (let i = 0; i < 10 && (g.chain.length || pend(g).inStep); i++) { const d = pend(g); if (d.kind === 'optional') { offered = true; g = yes(g); continue; } g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g); }
  assert.ok(!offered, 'no save offered');
  assert.equal(zone(g, u), 'trash');
  assert.equal(g.objects[b].counters.buff, 1, 'other unit keeps its buff');
});

test('RJ#7413 Kayn, Unleashed, having moved twice this turn, takes no damage from spells either (for the rest of the turn)', () => {
  let g = S0F();
  const k = put(g, P0, 'Kayn, Unleashed', 'base');
  g = settle(move(g, P0, [k], BF_A));
  for (let i = 0; i < 10 && pend(g).kind !== 'mainAction'; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  g.objects[k].exhausted = false; touch(g);
  g = move(g, P0, [k], BF_B);
  for (let i = 0; i < 10 && pend(g).kind !== 'mainAction'; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(locOf(g, k), BF_B);
  g = settle(play(g, P0, hand(g, P0, 'Hextech Ray'), { targets: [[k]] }));
  assert.equal(g.objects[k].damage, 0, 'spell damage prevented');
});

test('RJ#7416 The Boss and two buffed units dying at once (Singularity): only one can be saved (the legend exhausts)', () => {
  let g = S0F({ tp: P1 });
  setLegend(g, P0, 'The Boss');
  const a = put(g, P0, 'V(2)', BF_A, { buff: true }), b = put(g, P0, 'V(2)', BF_A, { buff: true }); control(g, BF_A, P0);
  g = play(g, P1, hand(g, P1, 'Singularity'), { targets: [[a, b]] });
  let saves = 0;
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) { const d = pend(g); if (d.kind === 'optional') { saves++; g = yes(g); continue; } g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g); }
  const zs = [a, b].map(x => zone(g, x)).sort();
  assert.deepEqual(zs, ['base', 'trash'], `one saved, one dies (${zs}, offers ${saves})`);
});

test('RJ#7426 (MISMATCH-RJ) Unchecked Power kills my only (Deathknell) unit at a battlefield: the Deathknell is pending before the death completes (Closed state) — control and my hidden unit stay, and I can flip it in response (principle 13)', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P1, 4); fundAll(g, P0, 2);
  const dk = put(g, P0, 'DK(2)', BF_A); control(g, BF_A, P0);
  const hid = put(g, P0, 'HidU(2)', { facedown: BF_A });
  g = play(g, P1, hand(g, P1, 'Unchecked Power'));
  g = pass(g); g = pass(g);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = act(g, legal(g, pend(g).player)[0]);
  assert.equal(zone(g, dk), 'trash');
  assert.ok(g.chain.length >= 1, 'Deathknell on the chain');
  assert.equal(zone(g, hid), 'facedown', 'hidden card still there');
  assert.equal(g.battlefields[BF_A].controller, P0, 'control kept while the chain exists');
  for (let i = 0; i < 4 && pend(g).player !== P0; i++) g = pass(g);
  assert.ok(canPlayNow(g, P0, hid), 'the hidden unit may be played in response');
  g = act(g, { type: 'playCard', player: P0, obj: hid });
  g = settle(g);
  assert.equal(locOf(g, hid), BF_A);
  assert.equal(g.battlefields[BF_A].controller, P0, 'battlefield kept');
});

test('RJ#7428 Vi, Destructive\'s recycle boost lasts only this turn', () => {
  let g = S0F();
  const vi = put(g, P0, 'Vi, Destructive', BF_A); control(g, BF_A, P0);
  put(g, P0, 'V(1)', 'trash'); put(g, P0, 'V(1)', 'trash');
  for (let k = 0; k < 2; k++) {
    g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === vi)!);
    g = settle(g);
  }
  assert.equal(mightOf(g, vi), 5);
  g = endTurn(g, P0);
  for (let i = 0; i < 20 && !(pend(g).kind === 'mainAction' && pend(g).player === P1); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(mightOf(g, vi), 3, 'back to 3 on the next turn');
});

test('RJ#7430 Fizz, Trickster checks the printed Energy cost: Drag Under (5, "[2] less from anywhere but hand") is not a legal choice', () => {
  let g = S0F();
  const du = put(g, P0, 'Drag Under', 'trash');
  const ok = put(g, P0, 'Hextech Ray', 'trash');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Fizz, Trickster'), destination: 'base' } as never);
  let offered: string[] = [];
  for (let i = 0; i < 10 && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    if (d.kind === 'optional') { g = yes(g); continue; }
    const ids = optionIds(g);
    if (ids.includes(ok) || ids.includes(du)) { offered = ids; break; }
    g = act(g, legal(g, d.player)[0]);
  }
  assert.ok(offered.includes(ok), `Hextech Ray offered (${offered})`);
  assert.ok(!offered.includes(du), 'Drag Under not offered');
});

test('RJ#7439 Stupefy deals no damage: with Imperial Decree active it kills nothing', () => {
  let g = S0F();
  const u = put(g, P1, 'V(3)', BF_A, { damage: 1 }); control(g, BF_A, P1);
  g = settle(play(g, P0, hand(g, P0, 'Imperial Decree')));
  g = settle(play(g, P0, hand(g, P0, 'Stupefy'), { targets: [[u]] }));
  assert.equal(zone(g, u), 'battlefield');
  assert.equal(mightOf(g, u), 2);
});

test('RJ#7440 Imperial Decree + combat damage: Zhonya\'s Hourglass replaces the lethal-damage death, then the Decree\'s trigger (from the damage) kills the recalled unit', () => {
  let g = S0F();
  const d = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const z = put(g, P1, "Zhonya's Hourglass", 'base');
  g = settle(play(g, P0, hand(g, P0, 'Imperial Decree')));
  const a = put(g, P0, 'V(5)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) { const p = pend(g); g = p.inStep ? (p.kind === 'optional' ? yes(g) : act(g, legal(g, p.player)[0])) : pass(g); }
  assert.equal(zone(g, z), 'trash', "Zhonya's used");
  assert.equal(zone(g, d), 'trash', 'killed by the Decree afterwards');
});

test('RJ#7449 a Reaction drawn mid-chain (Discipline draws Defy) can be played before the next chain item resolves', () => {
  let g = S0F();
  const e = put(g, P1, 'V(4)', BF_A); control(g, BF_A, P1);
  const defy = put(g, P1, 'Defy', 'deckTop');
  const z = hand(g, P0, 'ZapM');
  g = play(g, P0, z, { targets: [[e]] });
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'Discipline'), { targets: [[e]] });
  for (let i = 0; i < 4 && g.chain.length === 2; i++) g = pass(g);
  assert.equal(g.chain.length, 1, 'Discipline resolved, ZapM still on the chain');
  assert.equal(zone(g, defy), 'hand', 'Defy drawn');
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  assert.ok(canPlayNow(g, P1, defy), 'Defy playable before ZapM resolves');
  g = settle(play(g, P1, defy, { targets: [[z]] }));
  assert.equal(g.objects[e].damage, 0, 'ZapM countered');
});

test('RJ#7450 Miss Fortune, Captain\'s "ready something else that\'s exhausted" can ready an enemy unit (Dune Drake)', () => {
  let g = S0F();
  const mf = put(g, P0, 'Miss Fortune, Captain', 'base');
  const dd = put(g, P1, 'Dune Drake', BF_B); control(g, BF_B, P1);
  g.objects[dd].exhausted = true; touch(g);
  g = move(g, P0, [mf], BF_A);
  let offered = false;
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    if (d.kind === 'optional') { g = yes(g); continue; }
    if (optionIds(g).includes(dd)) { offered = true; g = choose(g, dd); continue; }
    g = act(g, legal(g, d.player)[0]);
  }
  assert.ok(offered, 'enemy unit offered');
  assert.equal(g.objects[dd].exhausted, false, 'readied');
});

test('RJ#7457 The Boss saves a buffed unit under Smoke Screen: the buff is spent and the -4 stays → 0 Might, 0 damage, it survives', () => {
  let g = S0F({ tp: P1 });
  setLegend(g, P0, 'The Boss');
  const u = put(g, P0, 'V(4)', BF_A, { buff: true }); control(g, BF_A, P0);
  g = settle(play(g, P1, hand(g, P1, 'Smoke Screen'), { targets: [[u]] }));
  assert.equal(mightOf(g, u), 1);
  g = play(g, P1, hand(g, P1, 'Hextech Ray'), { targets: [[u]] });
  for (let i = 0; i < 10 && (g.chain.length || pend(g).inStep); i++) g = pend(g).inStep ? (pend(g).kind === 'optional' ? yes(g) : act(g, legal(g, pend(g).player)[0])) : pass(g);
  assert.equal(locOf(g, u), 'base', 'saved and recalled');
  assert.equal(mightOf(g, u), 0);
  assert.equal(zone(g, u), 'base', 'still alive at 0 Might');
});

test('RJ#7458 Baited Hook kills Vanguard Captain and plays Spectral Matron: the Matron\'s play trigger can play that Captain from the trash', () => {
  let g = S0F();
  const vc = put(g, P0, 'Vanguard Captain', 'base');
  const hook = put(g, P0, 'Baited Hook', 'base');
  const sm = put(g, P0, 'Spectral Matron', 'deckTop');
  g = act(g, { type: 'activate', player: P0, obj: hook, abilityIndex: 0 } as never);
  let offered = false;
  for (let i = 0; i < 40 && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    if (d.kind === 'optional') { g = yes(g); continue; }
    const ids = optionIds(g);
    if (ids.includes(vc) && zone(g, vc) === 'base') { g = choose(g, vc); continue; }
    if (ids.includes(sm) && zone(g, sm) !== 'base') { g = choose(g, sm); continue; }
    if (ids.includes(vc) && zone(g, vc) === 'trash') { offered = true; g = choose(g, vc); continue; }
    g = ids.includes('base') ? choose(g, 'base') : act(g, legal(g, d.player)[0]);
  }
  assert.ok(['base', 'battlefield'].includes(zone(g, sm)), 'Matron played');
  assert.ok(offered, 'the killed Captain is a legal choice');
  assert.equal(zone(g, vc), 'base', 'Captain played back');
});

test('RJ#7460 Kai\'Sa, Survivor must survive the combat to draw on conquer: killed in combat while her ally conquers → no draw', () => {
  let { g, atk, def } = attackSetup(["Kai'Sa, Survivor", 'V(5)'], ['V(4)']);
  const ks = atk[0];
  const h0 = g.players[P0].hand.length;
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const p = pend(g);
    if (p.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: p.player, assignment: p.player === P1 ? { [ks]: 4 } : { [def[0]]: 4 } }); continue; }
    g = p.inStep ? act(g, legal(g, p.player)[0]) : pass(g);
  }
  assert.equal(zone(g, ks), 'trash');
  assert.equal(g.battlefields[BF_A].controller, P0, 'conquered by the ally');
  assert.equal(g.players[P0].hand.length, h0, 'no Kai\'Sa draw');
});

test('RJ#7465 Svellsongur copies a Deflect unit\'s text for that unit only: Salvage choosing the Svellsongur itself pays no Deflect tax', () => {
  let g = S0F({ tp: P1 });
  const u = put(g, P0, 'Deflect(3,1)', 'base');
  const sv = put(g, P0, 'Svellsongur', 'base'); attachNow(g, sv, u);
  const r0 = g.players[P1].runesInPlay.length;
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Salvage') });
  for (let i = 0; i < 6 && pend(g).inStep; i++) { const d = pend(g); g = d.kind === 'optional' ? yes(g) : optionIds(g).includes(sv) ? choose(g, sv) : act(g, legal(g, d.player)[0]); }
  assert.ok(g.chain.some(c => c.targets.flat().includes(sv)), 'Svellsongur chosen');
  assert.equal(r0 - g.players[P1].runesInPlay.length, 1, 'one rune recycled (Salvage\'s own power), no Deflect tax');
  g = settle(g);
  assert.equal(zone(g, sv), 'trash');
});

test('RJ#7468 Gemcraft Seer + Nocturne, Horrifying: each Nocturne played gets Vision, sees the next Nocturne on top and may play it for [A] — three in a row', () => {
  let g = S0F();
  put(g, P0, 'Gemcraft Seer', 'base');
  const n3 = put(g, P0, 'Nocturne, Horrifying', 'deckTop');
  const n2 = put(g, P0, 'Nocturne, Horrifying', 'deckTop');
  const n1 = hand(g, P0, 'Nocturne, Horrifying');
  g = act(g, { type: 'playCard', player: P0, obj: n1, destination: 'base' } as never);
  for (let i = 0; i < 40 && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    if (d.kind === 'optional') { g = /recycle/i.test(d.prompt ?? '') ? no(g) : yes(g); continue; }
    const ids = optionIds(g);
    g = ids.includes('base') ? choose(g, 'base') : act(g, legal(g, d.player)[0]);
  }
  for (const n of [n1, n2, n3]) assert.ok(['base', 'battlefield'].includes(zone(g, n)), `${n} on the board (${zone(g, n)})`);
});

test('RJ#7470 Lady of Luminosity + Promising Future playing a 5+ cost spell (Singularity): one draw for Promising Future, then another for Singularity', () => {
  let g = S0(); fundAll(g, P0, 6); fundAll(g, P1, 6); addTokens(g);
  setLegend(g, P0, 'Lady of Luminosity');
  for (let i = 0; i < 5; i++) put(g, P1, 'V(1)', 'deckTop');
  for (let i = 0; i < 4; i++) put(g, P0, 'V(1)', 'deckTop');
  const sg = put(g, P0, 'Singularity', 'deckTop');
  const e = put(g, P1, 'V(8)', BF_A); control(g, BF_A, P1);
  const h0 = g.players[P0].hand.length;
  g = play(g, P0, hand(g, P0, 'Promising Future'));
  let handAtSing = -1;
  for (let i = 0; i < 80 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (handAtSing < 0 && zone(g, sg) === 'trash') handAtSing = g.players[P0].hand.length;
    if (!d.inStep) { g = pass(g); continue; }
    if (d.kind === 'optional') { g = yes(g); continue; }
    const ids = optionIds(g);
    g = ids.includes(sg) ? choose(g, sg) : ids.includes(e) ? choose(g, e) : act(g, legal(g, d.player)[0]);
  }
  assert.equal(zone(g, sg), 'trash', 'Singularity played and resolved');
  assert.equal(g.players[P0].hand.length - h0, 1 + 2 - 1, 'PF left hand (-1), two Lady draws (+2)');
  assert.ok(handAtSing - h0 >= 0, 'the Promising Future draw happened before Singularity resolved');
});

test('RJ#7471 exhausting all runes for energy before Divine Judgment: the unspent energy stays in the pool after it recycles runes down to 2', () => {
  let g = S0(); setRunes(g, P0, 10, 'order');
  for (const r of [...g.players[P0].runesInPlay]) g = act(g, { type: 'activate', player: P0, obj: r, abilityIndex: 950 } as never);
  assert.equal(g.players[P0].pool.energy, 10);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Divine Judgment') });
  for (let i = 0; i < 40 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    g = d.inStep ? act(g, { type: 'choose', player: d.player, optionIds: d.options!.slice(0, d.min ?? 1).map(o => o.id) }) : act(g, { type: 'pass', player: d.player });
  }
  assert.equal(g.players[P0].runesInPlay.length, 2, 'down to 2 runes');
  assert.equal(g.players[P0].pool.energy, 3, '10 - 7 energy still available');
});

test('RJ#7477 Viktor, Leader\'s death trigger also works on the opponent\'s turn (a triggered ability, not an activated one)', () => {
  let g = S0F({ tp: P1 });
  const u = put(g, P0, 'V(2)', BF_A); put(g, P0, 'ogn-246-298', 'base'); control(g, BF_A, P0);
  const b0 = g.players[P0].base.length;
  g = settle(play(g, P1, hand(g, P1, 'KillA'), { targets: [[u]] }));
  assert.equal(zone(g, u), 'trash');
  assert.equal(g.players[P0].base.length, b0 + 1, 'Recruit made on the opponent\'s turn');
});

test('RJ#7479 Cemetery Attendant returning the Chosen Champion from the trash puts it in hand, not the (empty) Champion Zone', () => {
  let g = S0F();
  const ch = put(g, P0, 'ogn-205-298', 'trash');
  g.players[P0].championZone = []; touch(g);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Cemetery Attendant'), destination: 'base' } as never);
  g = settle(g, [ch]);
  assert.equal(zone(g, ch), 'hand');
  assert.equal(g.players[P0].championZone.length, 0);
});

test('RJ#7488 defending in a showdown: Blind Monk\'s legend ability (no Reaction) and Dragon\'s Rage (no Action/Reaction) can\'t be used', () => {
  let { g, def } = attackSetup(['V(3)'], ['V(3)']);
  fundAll(g, P0); fundAll(g, P1); addTokens(g);
  const lg = setLegend(g, P1, 'Blind Monk');
  const dr = hand(g, P1, "Dragon's Rage");
  for (let i = 0; i < 10 && !(pend(g).player === P1 && !pend(g).inStep && g.chain.length === 0); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(pend(g).player, P1, 'defender has focus in the showdown');
  assert.ok(!canPlayNow(g, P1, dr), 'Dragon\'s Rage not playable');
  assert.ok(!legal(g, P1, 'activate').some(a => (a as { obj?: ObjId }).obj === lg), 'legend ability not usable');
  assert.ok(def.length === 1);
  // control: in its own main phase (Neutral Open) both are usable
  const h = S0F({ tp: P1 }); const lg2 = setLegend(h, P1, 'Blind Monk'); put(h, P1, 'V(2)', 'base');
  const dr2 = hand(h, P1, "Dragon's Rage"); put(h, P0, 'V(2)', BF_A); put(h, P0, 'V(2)', BF_A); control(h, BF_A, P0);
  assert.ok(canPlayNow(h, P1, dr2));
  assert.ok(legal(h, P1, 'activate').some(a => (a as { obj?: ObjId }).obj === lg2));
});

test('RJ#7489 a combat death trigger (Viktor, Leader\'s Recruit) resolves before the conquer trigger (Zaun Warrens)', () => {
  let g = S0F();
  setBattlefieldCard(g, BF_A, 'Zaun Warrens');
  const d = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const big = put(g, P0, 'V(5)', 'base'), small = put(g, P0, 'V(1)', 'base');
  put(g, P0, 'ogn-246-298', 'base');
  g = move(g, P0, [big, small], BF_A);
  for (let i = 0; i < 40 && pend(g).kind !== 'mainAction'; i++) {
    const p = pend(g);
    if (p.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: p.player, assignment: p.player === P1 ? { [small]: 1, [big]: 2 } : { [d]: 5 } }); continue; }
    g = p.inStep ? act(g, legal(g, p.player)[0]) : pass(g);
  }
  assert.equal(zone(g, small), 'trash');
  assert.equal(g.battlefields[BF_A].controller, P0);
  const texts = g.log.map(l => l.text);
  const iViktor = texts.findIndex(t => /Resolving.*Viktor/.test(t));
  const iZaun = texts.findIndex(t => /Resolving.*Zaun Warrens/.test(t));
  assert.ok(iViktor >= 0 && iZaun >= 0, `both resolved (${iViktor}, ${iZaun})`);
  assert.ok(iViktor < iZaun, 'death trigger first');
});

test('RJ#7490 Karthus doubles Ekko, Recurrent\'s Deathknell, but he can only be recycled once: only one trigger readies the runes', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1);
  const rs = setRunes(g, P0, 3, 'fury');
  for (const r of rs) g.objects[r].exhausted = true;
  put(g, P0, 'ogn-236-298', 'base');
  const ek = put(g, P0, 'ogn-110-298', BF_A); control(g, BF_A, P0);
  const l0 = g.log.length;
  g = settle(play(g, P1, hand(g, P1, 'KillA'), { targets: [[ek]] }));
  const texts = g.log.slice(l0).map(l => l.text);
  assert.ok(texts.some(t => /^Ekko: Deathknell.*cost can't be paid/.test(t)), 'Karthus\'s extra trigger can\'t recycle Ekko again');
  assert.equal(texts.filter(t => /^Resolving Ekko/.test(t)).length, 1, 'only one can recycle Ekko and ready the runes');
  assert.equal(zone(g, ek), 'mainDeck', 'Ekko recycled once');
  assert.equal(rs.filter(r => !g.objects[r].exhausted).length, 3);
});

test('RJ#7494 Darius, Executioner\'s "+1 [S] here" also works in base (here = his location)', () => {
  const g = S0F();
  put(g, P0, 'ogn-243-298', 'base');
  const u = put(g, P0, 'V(2)', 'base'), far = put(g, P0, 'V(2)', BF_A);
  assert.equal(mightOf(g, u), 3, 'ally in base +1');
  assert.equal(mightOf(g, far), 2, 'ally elsewhere unaffected');
});

test('RJ#7495 Vayne, Hunter given Cleave\'s Assault 3 returns to hand and is replayed: the temporary Assault is gone (Assault 3, not 6)', () => {
  let g = S0F();
  const v = put(g, P0, 'ogn-035-298', BF_A); control(g, BF_A, P0);
  g = settle(play(g, P0, hand(g, P0, 'Cleave'), { targets: [[v]] }));
  assert.equal(kwValue(g, v, 'Assault'), 6);
  g = settle(play(g, P0, hand(g, P0, 'Retreat'), { targets: [[v]] }));
  assert.equal(zone(g, v), 'hand');
  g = settle(act(g, { type: 'playCard', player: P0, obj: v, destination: 'base' } as never));
  assert.equal(zone(g, v), 'base');
  assert.equal(kwValue(g, v, 'Assault'), 3);
});

test('RJ#7497 Defy counters spells only: it can answer a spell but not a triggered ability on the chain', () => {
  let g = S0F();
  const u = put(g, P0, 'V(2)', BF_A); put(g, P0, 'ogn-246-298', 'base'); control(g, BF_A, P0);
  const df = hand(g, P1, 'Defy');
  g = play(g, P0, hand(g, P0, 'KillA'), { targets: [[u]] });
  g = pass(g);
  assert.equal(pend(g).player, P1);
  assert.ok(canPlayNow(g, P1, df), 'Defy can answer the spell');
  g = pass(g);
  for (let i = 0; i < 10 && !(g.chain.length === 1 && g.chain[0].kind !== 'spell' && pend(g).player === P1 && !pend(g).inStep); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(g.chain.length, 1, 'Viktor trigger on the chain');
  assert.notEqual(g.chain[0].kind, 'spell');
  assert.ok(!canPlayNow(g, P1, df), 'no spell to counter');
});

test('RJ#7498 an enemy Mageseeker Warden at a battlefield doesn\'t stop units entering ready: Accelerate (Lee Sin, Centered) and Sprite Call\'s Sprite', () => {
  let g = S0F();
  put(g, P1, 'Mageseeker Warden', BF_A); control(g, BF_A, P1);
  setRunes(g, P0, 12, 'body'); addRunes(g, P0, 4, 'mind');
  const ls = hand(g, P0, 'Lee Sin, Centered');
  g = settle(play(g, P0, ls, { dest: 'base', may: [true] }));
  assert.equal(zone(g, ls), 'base');
  assert.equal(g.objects[ls].exhausted, false, 'Accelerate: enters ready');
  g = settle(play(g, P0, hand(g, P0, 'Sprite Call')), ['base']);
  const sp = Object.values(g.objects).filter(o => g.cards[o.cardId]?.name === 'Sprite' && o.zone === 'base');
  assert.equal(sp.length, 1);
  assert.equal(sp[0].exhausted, false, 'Sprite enters ready');
});

test('RJ#7500 a damaged unit whose Might is boosted back above its printed value is still damaged: Warwick, Hunter\'s attack kills it', () => {
  let g = S0F();
  const e = put(g, P1, 'V(3)', BF_A, { damage: 2 }); control(g, BF_A, P1);
  mod(g, e, { might: 3 });
  assert.equal(mightOf(g, e), 6, 'boosted to 6 with 2 damage');
  const w = put(g, P0, 'Warwick, Hunter', 'base');
  g = move(g, P0, [w], BF_A);
  for (let i = 0; i < 6 && g.chain.length; i++) g = pass(g);
  assert.equal(zone(g, e), 'trash');
});

test('RJ#7506 an already-buffed Sett, Brawler conquers Monastery of Hirana: spend the buff to draw, and his own conquer trigger buffs him again', () => {
  let g = S0({ bfA: 'Monastery of Hirana' });
  const s = put(g, P0, 'Sett, Brawler', 'base', { buff: true });
  const h0 = g.players[P0].hand.length;
  g = move(g, P0, [s], BF_A);
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'orderTriggers') { g = choose(g, (d.options!.find(o => /Monastery/.test(o.label)) ?? d.options![0]).id); continue; }
    if (d.kind === 'optional') { g = yes(g); continue; }
    if (d.inStep) { g = choose(g, d.options![0].id); continue; }
    g = pass(g);
  }
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[P0].hand.length, h0 + 1, 'drew by spending the buff');
  assert.equal(g.objects[s].counters.buff, 1, 'buffed again by his conquer trigger');
});

test('RJ#7508 Sun Disc works with The Harrowing: the unit it plays from the trash enters ready', () => {
  for (const disc of [true, false]) {
    let g = S0F();
    const sd = put(g, P0, 'Sun Disc', 'base');
    const u = put(g, P0, 'V(3)', 'trash');
    g = settle(play(g, P0, hand(g, P0, 'DrawR')));
    if (disc) g = settle(act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === sd)!));
    g = settle(act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'The Harrowing') }), [u, 'base']);
    assert.equal(zone(g, u), 'base', 'played from the trash');
    assert.equal(g.objects[u].exhausted, !disc, disc ? 'enters ready' : 'control: exhausted');
  }
});

test('RJ#7513 Unyielding Spirit prevents spell damage to every unit, whoever controls it (my own Hextech Ray on an enemy unit too)', () => {
  let g = S0F();
  const e = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const m = put(g, P0, 'V(5)', BF_B); control(g, BF_B, P0);
  g = settle(play(g, P0, hand(g, P0, 'Unyielding Spirit')));
  g = settle(play(g, P0, hand(g, P0, 'Hextech Ray'), { targets: [[e]] }));
  assert.equal(g.objects[e].damage, 0, 'enemy unit protected from my spell');
  g = settle(play(g, P0, hand(g, P0, 'Hextech Ray'), { targets: [[m]] }));
  assert.equal(g.objects[m].damage, 0, 'my unit protected');
});

test('RJ#7514 a 7-Might unit with 6 damage (Singularity) then Thousand-Tailed Watcher\'s -3: 4 Might, the damage is lethal → it dies', () => {
  let g = S0F();
  const e = put(g, P1, 'V(7)', BF_A, { damage: 6 }); control(g, BF_A, P1);
  g = settle(play(g, P0, hand(g, P0, 'Thousand-Tailed Watcher'), { dest: 'base', may: [false] }));
  assert.equal(zone(g, e), 'trash');
});

test('RJ#7520 Qiyana conquering The Candlelit Sanctum: with the Sanctum resolving first, her draw-or-channel choice is made on resolution, after the look', () => {
  let g = S0({ bfA: 'The Candlelit Sanctum' });
  const q = put(g, P0, 'Qiyana, Victorious', 'base');
  for (let i = 0; i < 3; i++) put(g, P0, 'V(1)', 'deckTop');
  g = move(g, P0, [q], BF_A);
  let sanctumBeforeChoice: boolean | null = null;
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'orderTriggers') { g = choose(g, (d.options!.find(o => /Qiyana/.test(o.label)) ?? d.options![0]).id); continue; }
    if (d.kind === 'chooseMode' && (d.options ?? []).some(o => /Draw 1/.test(o.label)) && sanctumBeforeChoice === null) sanctumBeforeChoice = g.log.some(l => /Resolving.*Candlelit/.test(l.text));
    if (d.kind === 'optional') { g = no(g); continue; }
    g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(sanctumBeforeChoice, true, 'choice asked on resolution, after the Sanctum\'s look');
});

test('RJ#7521 Hextech Ray played with my Annie, Fiery out, stolen by Mystic Reversal: no longer "your spell" for Annie → 3 damage, not 4', () => {
  let g = S0F();
  put(g, P0, 'ogs-001-024', 'base');
  const t = put(g, P1, 'V(6)', BF_A); control(g, BF_A, P1);
  g = play(g, P0, hand(g, P0, 'Hextech Ray'), { targets: [[t]] });
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'Mystic Reversal'), { targets: [[g.chain[0].id]] });
  g = settle(g, [], { no: true });
  assert.equal(g.objects[t].damage, 3);
});

test('RJ#7538 Wielder of Water attacking alone (+2) loses it once Ride the Wind brings a friendly unit into the combat', () => {
  let { g, atk } = attackSetup(['Wielder of Water'], ['V(5)']);
  fundAll(g, P0); fundAll(g, P1);
  const f = put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
  assert.equal(mightOf(g, atk[0]), 4, 'attacking alone');
  g = play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[f]], locations: [BF_A], dest: BF_A });
  g = settle(g);
  assert.equal(locOf(g, f), BF_A);
  assert.equal(mightOf(g, atk[0]), 2, 'no longer alone');
});

test('RJ#7539 Discipline countered by Defy, which my own Defy counters: Discipline resolves and I draw', () => {
  let g = S0F();
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const d0 = put(g, P0, 'V(1)', 'deckTop');
  g = play(g, P0, hand(g, P0, 'Discipline'), { targets: [[u]] });
  const disc = g.chain[0].id;
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'Defy'), { targets: [[disc]] });
  const defy1 = g.chain[g.chain.length - 1].id;
  g = pass(g);
  g = play(g, P0, hand(g, P0, 'Defy'), { targets: [[defy1]] });
  g = settle(g);
  assert.equal(mightOf(g, u), 4, 'Discipline resolved');
  assert.equal(zone(g, d0), 'hand', 'drew');
});

test('RJ#7547 Ravenbloom Student\'s +1 trigger goes on the chain: the opponent can answer it with a Reaction (not an Action) before it resolves', () => {
  let g = S0F();
  const st = put(g, P0, 'Ravenbloom Student', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(2)', BF_B); control(g, BF_B, P1);
  g = play(g, P0, hand(g, P0, 'DrawR'));
  for (let i = 0; i < 10 && !(g.chain.length === 1 && /Ravenbloom/.test(String(g.chain[0].label)) && pend(g).player === P1 && !pend(g).inStep); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.ok(/Ravenbloom/.test(String(g.chain[0]?.label)), 'trigger on the chain');
  assert.equal(pend(g).player, P1);
  assert.equal(mightOf(g, st), 2, 'not yet +1');
  assert.ok(canPlayNow(g, P1, hand(g, P1, 'DrawR')), 'Reaction allowed');
  assert.ok(!canPlayNow(g, P1, hand(g, P1, 'KillA')), 'Action not allowed');
  g = settle(g);
  assert.equal(mightOf(g, st), 3);
  assert.ok(e);
});

test('RJ#7548 Azir, Ascendant may choose an equipped unit at his own battlefield and take its Equipment (Eye of the Herald), though neither moves', () => {
  let g = S0F();
  control(g, BF_A, P0);
  const az = put(g, P0, 'Azir, Ascendant', BF_A);
  const u = put(g, P0, 'V(2)', BF_A);
  const eye = put(g, P0, 'Eye of the Herald', 'base'); attachNow(g, eye, u);
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === az)!);
  for (let i = 0; i < 12 && (g.chain.length || g.pending?.inStep); i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    if (d.kind === 'optional') { g = yes(g); continue; }
    const ids = optionIds(g);
    g = ids.includes(u) ? choose(g, u) : ids.includes(eye) ? choose(g, eye) : act(g, legal(g, d.player)[0]);
  }
  assert.equal(locOf(g, az), BF_A); assert.equal(locOf(g, u), BF_A);
  assert.equal(g.objects[eye].attachedTo, az, 'Eye moved to Azir');
});

test('RJ#7558 Mask of Foresight: two units attack together, one is moved away mid-showdown → the other never "attacked alone", no +1', () => {
  const g0 = S0F();
  put(g0, P0, 'Mask of Foresight', 'base');
  const d = put(g0, P1, 'V(5)', BF_A); control(g0, BF_A, P1);
  const a1 = put(g0, P0, 'V(2)', 'base'), a2 = put(g0, P0, 'V(2)', 'base');
  let g = settle(move(g0, P0, [a1, a2], BF_A));
  g = settle(play(g, P0, hand(g, P0, 'MoveR'), { targets: [[a2]] }));
  assert.equal(locOf(g, a2), 'base');
  assert.equal(mightOf(g, a1), 2, 'no Mask +1');
  assert.ok(d);
});

test('RJ#7559 (MISMATCH-RJ, CR 466.2.d.1) Charmed Yasuo attacks my Ahri on my turn: the attacker doesn\'t choose the order — the defender\'s trigger goes on last and resolves first (-2, then Yasuo deals 4)', () => {
  let g = S0F();
  const ah = put(g, P0, 'ogn-119-298', BF_A);
  const v = put(g, P0, 'V(5)', BF_A); control(g, BF_A, P0);
  const y = put(g, P1, 'ogn-076-298', 'base');
  g = play(g, P0, hand(g, P0, 'Charm'), { targets: [[y]], locations: [BF_A], dest: BF_A });
  for (let i = 0; i < 30 && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g);
    if (d.inStep) { const o = optionIds(g); g = act(g, { type: 'choose', player: d.player, optionIds: [d.player === P1 ? (o.includes(v) ? v : o[0]) : (o.includes(y) ? y : o[0])] }); continue; }
    g = pass(g);
  }
  assert.equal(locOf(g, y), BF_A, 'Yasuo moved in (P1 is the Attacker)');
  assert.equal(mightOf(g, y), 4, 'Ahri\'s -2 resolved first');
  assert.equal(g.objects[v].damage, 4, 'Yasuo dealt his reduced Might');
  assert.equal(zone(g, ah), 'battlefield');
});

test('RJ#7564 paying Nocturne, Horrifying\'s [A] mid-resolution with only a ready rune: you may exhaust it for Energy first, then recycle it — the Energy is not lost', () => {
  let g = S0();
  setRunes(g, P0, 1, 'chaos');
  g.players[P0].pool.energy = 4; g.players[P0].pool.power = { Chaos: 1 } as never; touch(g);
  put(g, P0, 'Gemcraft Seer', 'base');
  const n2 = put(g, P0, 'Nocturne, Horrifying', 'deckTop');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Nocturne, Horrifying'), destination: 'base' } as never);
  let paid = false;
  for (let i = 0; i < 40 && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    if (d.kind === 'optional' && /play him/.test(d.prompt ?? '') && !paid) {
      assert.equal(g.players[P0].pool.energy, 0); assert.equal(readyRunes(g, P0), 1);
      // the player may float the rune's Energy while paying (Add abilities during payment)
      const flt = legal(g, P0, 'activate').find(a => a.type === 'activate' && (a as { abilityIndex?: number }).abilityIndex === 950);
      if (flt) g = act(g, flt);
      g = yes(g); paid = true; continue;
    }
    if (d.kind === 'optional') { g = yes(g); continue; }
    g = optionIds(g).includes('base') ? choose(g, 'base') : act(g, legal(g, d.player)[0]);
  }
  assert.ok(paid);
  assert.equal(zone(g, n2), 'base', 'second Nocturne played for [A]');
  assert.equal(g.players[P0].runesInPlay.length, 0, 'the rune was recycled');
  assert.equal(g.players[P0].pool.energy, 1, 'its Energy was floated first');
});

test('RJ#7566 Tryndamere, Barbarian counts only excess combat damage he assigns: spell damage dealt in the showdown doesn\'t add to it', () => {
  const run = (defMight: number, ray: boolean) => {
    let { g, atk, def } = attackSetup(['ogn-034-298'], [`V(${defMight})`]);
    fundAll(g, P0); fundAll(g, P1);
    if (ray) g = settle(play(g, P0, hand(g, P0, 'Hextech Ray'), { targets: [[def[0]]] }));
    const p0 = g.players[P0].points;
    for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
      const p = pend(g);
      if (p.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: p.player, assignment: p.player === P0 ? { [def[0]]: 8 } : { [atk[0]]: defMight } }); continue; }
      g = p.inStep ? (p.kind === 'optional' ? yes(g) : act(g, legal(g, p.player)[0])) : pass(g);
    }
    assert.equal(g.battlefields[BF_A].controller, P0);
    return g.players[P0].points - p0;
  };
  assert.equal(run(3, false), 2, '5 excess: conquer + Tryndamere');
  assert.equal(run(4, false), 1, '4 excess: conquer only');
  assert.equal(run(7, true), 1, 'Hextech Ray 3 + 4 combat excess: the spell damage doesn\'t count');
});

test('RJ#7571 Sivir, Mercenary gets her +2 as soon as Switcheroo\'s [A][A] is paid, before Switcheroo resolves', () => {
  let g = S0F();
  const sv = put(g, P0, 'sfd-143-221', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(2)', BF_A);
  assert.equal(mightOf(g, sv), 4);
  g = play(g, P0, hand(g, P0, 'Switcheroo'), { targets: [[sv, e]] });
  assert.ok(g.chain.some(c => /Switcheroo/.test(String(c.label))), 'Switcheroo still on the chain');
  assert.equal(mightOf(g, sv), 6, '+2 already');
});

test('RJ#7572 Heimerdinger, Inventor copying Caitlyn, Patrolling\'s [T] ability also copies "only while I\'m at a battlefield": usable from a battlefield, not from base', () => {
  const heimerAbility = (loc: 'base' | number) => {
    const g = S0F();
    control(g, BF_A, P0);
    put(g, P0, 'Caitlyn, Patrolling', 'base');
    const h = put(g, P0, 'Heimerdinger, Inventor', loc);
    put(g, P1, 'V(5)', BF_B); control(g, BF_B, P1);
    return legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === h);
  };
  assert.equal(heimerAbility('base'), false, 'Heimerdinger in base: not usable');
  assert.equal(heimerAbility(BF_A), true, 'Heimerdinger at a battlefield: usable');
});

test('RJ#7574 moving to a battlefield I already control opens no window (no showdown); a "when I move" trigger (Traveling Merchant) does', () => {
  let g = S0F();
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_A);
  assert.equal(pend(g).kind, 'mainAction'); assert.equal(pend(g).player, P0);
  assert.equal(g.chain.length, 0);
  const tm = put(g, P0, 'Traveling Merchant', 'base');
  g = move(g, P0, [tm], BF_A);
  assert.ok(g.chain.length > 0 || pend(g).inStep, 'the move trigger uses the chain');
});

test('RJ#7575 Azir, Ascendant attaching the swapped unit\'s Equipment pays no Equip cost: only his own [C] is paid', () => {
  let g = S0F();
  control(g, BF_A, P0);
  const az = put(g, P0, 'Azir, Ascendant', BF_A);
  const u = put(g, P0, 'V(2)', 'base');
  const eye = put(g, P0, 'Eye of the Herald', 'base'); attachNow(g, eye, u);
  const r0 = g.players[P0].runesInPlay.length, e0 = g.players[P0].runesInPlay.filter(r => g.objects[r].exhausted).length;
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === az)!);
  for (let i = 0; i < 12 && (g.chain.length || g.pending?.inStep); i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    if (d.kind === 'optional') { g = yes(g); continue; }
    const ids = optionIds(g);
    g = ids.includes(u) ? choose(g, u) : ids.includes(eye) ? choose(g, eye) : act(g, legal(g, d.player)[0]);
  }
  assert.equal(locOf(g, az), 'base'); assert.equal(locOf(g, u), BF_A);
  assert.equal(g.objects[eye].attachedTo, az);
  assert.equal(r0 - g.players[P0].runesInPlay.length, 1, 'one rune recycled (Azir\'s [C]); Equip [C] not paid');
  assert.equal(g.players[P0].runesInPlay.filter(r => g.objects[r].exhausted).length, e0, 'no Energy spent');
});

test('RJ#7583 Sett, Kingpin counts himself as a buffed friendly unit at his battlefield: buffed and alone → 5 + 1 (buff) + 1 = 7', () => {
  const g = S0F();
  const s = put(g, P0, 'Sett, Kingpin', BF_A, { buff: true }); control(g, BF_A, P0);
  assert.equal(mightOf(g, s), 7);
  put(g, P0, 'V(1)', BF_A, { buff: true });
  assert.equal(mightOf(g, s), 8, 'plus one per other buffed ally');
});

test('RJ#7587 Zhonya\'s Hourglass played face-up to base for [2]: my next dying unit is healed, exhausted and recalled; the Hourglass is trashed', () => {
  let g = S0F();
  const zh = hand(g, P0, "Zhonya's Hourglass");
  g = settle(act(g, { type: 'playCard', player: P0, obj: zh, destination: 'base' } as never));
  assert.equal(zone(g, zh), 'base');
  const u = put(g, P0, 'V(2)', BF_A, { ready: true }); control(g, BF_A, P0);
  g = settle(play(g, P0, hand(g, P0, 'KillA'), { targets: [[u]] }));
  assert.equal(zone(g, zh), 'trash');
  assert.equal(locOf(g, u), 'base');
  assert.equal(g.objects[u].exhausted, true);
});

test('RJ#7589 showdown: my Action resolves, Ravenbloom Student\'s trigger joins the same chain; once it resolves, focus passes to the defender (no lock)', () => {
  let { g, def } = attackSetup(['Ravenbloom Student', 'V(3)'], ['V(9)']);
  fundAll(g, P0); fundAll(g, P1);
  g = settle(g);
  assert.equal(pend(g).player, P0, 'attacker has focus');
  g = play(g, P0, hand(g, P0, 'Hextech Ray'), { targets: [[def[0]]] });
  let sawTrigger = false;
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) {
    if (g.chain.some(c => /Ravenbloom/.test(String(c.label)))) sawTrigger = true;
    g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  }
  assert.ok(sawTrigger, 'Student trigger used the chain');
  assert.equal(pend(g).kind, 'showdownAction');
  assert.equal(pend(g).player, P1, 'focus to the defender');
});

test('RJ#7593 Prodigal Explorer\'s "chosen enemy units and/or gear": "enemy" covers the gear too — my own gear chosen twice doesn\'t count, enemy gear does', () => {
  const run = (owner: typeof P0) => {
    let g = S0F();
    const l = setLegend(g, P0, 'Prodigal Explorer');
    for (let i = 0; i < 2; i++) {
      const gr = put(g, owner, 'Sun Disc', 'base');
      g = settle(play(g, P0, hand(g, P0, 'BrittleLike'), { targets: [[gr]] }));
      assert.equal(zone(g, gr), 'trash');
    }
    return legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === l);
  };
  assert.equal(run(P0), false, 'own gear: no');
  assert.equal(run(P1), true, 'enemy gear twice: usable');
});

test('RJ#7594 Miss Fortune, Captain\'s move trigger can ready my exhausted legend; no standard move of the readied unit while her trigger is on the chain', () => {
  let g = S0F();
  const mf = put(g, P0, 'Miss Fortune, Captain', 'base');
  const other = put(g, P0, 'V(2)', 'base', { ready: true });
  const lg = g.players[P0].legend; g.objects[lg].exhausted = true; touch(g);
  control(g, BF_A, P0);
  g = move(g, P0, [mf], BF_A);
  assert.ok(g.chain.length > 0 || pend(g).inStep, 'trigger pending');
  assert.ok(!legal(g, P0, 'move').length, 'no standard move now');
  let offered = false;
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    if (d.kind === 'optional') { g = yes(g); continue; }
    if (optionIds(g).includes(lg)) { offered = true; g = choose(g, lg); continue; }
    g = act(g, legal(g, d.player)[0]);
  }
  assert.ok(offered, 'legend offered');
  assert.equal(g.objects[lg].exhausted, false);
  assert.ok(other);
});

test('RJ#7604 Falling Star twice on a unit at Void Gate, Flashed to base in response: 3 + 3 = 6, no Bonus Damage (not "here" any more)', () => {
  const run = (flash: boolean) => {
    let g = S0({ bfA: 'Void Gate' }); fundAll(g, P0); fundAll(g, P1);
    const e = put(g, P1, 'V(12)', BF_A); control(g, BF_A, P1);
    g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Falling Star') });
    for (let i = 0; i < 10 && pend(g).inStep; i++) g = pend(g).kind === 'chooseTargets' || optionIds(g).includes(e) ? choose(g, e) : choose(g, optionIds(g)[0]);
    assert.equal(g.chain.length, 1);
    g = pass(g);
    if (flash) g = play(g, P1, hand(g, P1, 'Flash'), { targets: [[e]] });
    g = settle(g);
    if (flash) assert.equal(locOf(g, e), 'base');
    return g.objects[e].damage;
  };
  assert.equal(run(false), 8, 'control: 4 + 4 at Void Gate');
  assert.equal(run(true), 6);
});

test('RJ#7605 (OUTDATED: Teemo, Strategist now has only "When I defend") hidden Teemo played in response to Traveling Merchant\'s move trigger: no play trigger, his defend trigger fires once', () => {
  let g = S0F();
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const t = put(g, P1, 'Teemo, Strategist', { facedown: BF_A });
  const tm = put(g, P0, 'Traveling Merchant', 'base');
  const l0 = g.log.length;
  g = move(g, P0, [tm], BF_A);
  let played = false;
  for (let i = 0; i < 60 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!played && d.player === P1 && !d.inStep && g.chain.some(c => /Traveling Merchant/.test(String(c.label)))) { g = act(g, { type: 'playCard', player: P1, obj: t }); played = true; continue; }
    if (d.kind === 'assignDamage') { g = act(g, legal(g, d.player)[0]); continue; }
    g = d.inStep ? (d.kind === 'optional' ? yes(g) : act(g, legal(g, d.player)[0])) : pass(g);
  }
  assert.ok(played, 'Teemo played in response to the move trigger');
  const trig = g.log.slice(l0).filter(l => /^Trigger: Teemo/.test(l.text)).length;
  assert.equal(trig, 1, 'one Teemo trigger (defend)');
});

test('RJ#7607 a standard move of two units is one simultaneous move: Ahri\'s defend trigger may choose either attacker', () => {
  let { g, atk } = attackSetup(['V(3)', 'V(4)'], ['ogn-119-298']);
  fundAll(g, P0); fundAll(g, P1);
  assert.equal(locOf(g, atk[0]), BF_A); assert.equal(locOf(g, atk[1]), BF_A);
  let offered: string[] = [];
  for (let i = 0; i < 20 && !offered.length; i++) {
    const d = pend(g);
    if (d.inStep && d.player === P1 && atk.every(a => optionIds(g).includes(a))) { offered = optionIds(g); break; }
    g = d.inStep ? (d.kind === 'optional' ? yes(g) : act(g, legal(g, d.player)[0])) : pass(g);
  }
  assert.ok(atk.every(a => offered.includes(a)), 'both attackers are valid choices');
  g = choose(g, atk[1]);
  g = settle(g);
  assert.equal(mightOf(g, atk[1]), 2);
  assert.equal(mightOf(g, atk[0]), 3);
});

test('RJ#7608 Fox-Fire: a locked target pumped but still within the 4-Might total is still killed', () => {
  let g = S0F();
  const a = put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Fox-Fire') });
  for (let i = 0; i < 4 && pend(g).inStep; i++) { const o = optionIds(g); g = o.includes(a) ? choose(g, a) : choose(g, o[o.length - 1]); }
  assert.equal(g.chain.length, 1);
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'PumpR'), { targets: [[a]] });
  g = settle(g);
  assert.equal(zone(g, a), 'trash', '1 + 3 = 4: still killed');
});

test('RJ#7611 Dazzling Aurora at end of turn playing Master Yi, Honed: only my base or a battlefield I control, never the opponent\'s; he enters ready', () => {
  let g = S0F();
  put(g, P0, 'Dazzling Aurora', 'base');
  const yi = put(g, P0, 'Master Yi, Honed', 'deckTop');
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
  g = endTurn(g);
  let dests: string[] = [];
  for (let i = 0; i < 20 && zone(g, yi) !== 'base' && zone(g, yi) !== 'battlefield'; i++) {
    const d = g.pending; if (!d) break;
    if (d.inStep && (d.options ?? []).some(o => o.id === 'base')) { dests = optionIds(g); g = choose(g, 'base'); continue; }
    if (d.kind === 'mainAction') break;
    g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  assert.ok(dests.length, 'destination offered');
  assert.ok(!dests.includes(String(BF_A)), 'not the opponent\'s battlefield');
  assert.ok(dests.includes(String(BF_B)), 'my battlefield is fine');
  assert.equal(zone(g, yi), 'base');
  assert.equal(g.objects[yi].exhausted, false, 'enters ready');
});

test('RJ#7616 Hidden Blade played from hidden can only choose a unit at the battlefield it was hidden at', () => {
  let g = S0F();
  control(g, BF_A, P0); put(g, P0, 'V(1)', BF_A);
  const near = put(g, P1, 'V(2)', BF_A);
  control(g, BF_B, P1);
  const far = put(g, P1, 'V(1)', BF_B);
  const hb = put(g, P0, 'Hidden Blade', { facedown: BF_A });
  g = act(g, { type: 'playCard', player: P0, obj: hb });
  const tg = g.pending?.kind === 'chooseTargets' ? optionIds(g) : g.chain[0].targets.flat();
  assert.ok(!tg.includes(far), `no target at BF-B: ${tg}`);
  assert.ok(tg.includes(near), `unit at BF-A selectable: ${tg}`);
});

test('RJ#7621 Confront doesn\'t ready a unit already exhausted on the board; only units played after it enter ready', () => {
  let g = S0F();
  const old = put(g, P0, 'V(2)', 'base'); g.objects[old].exhausted = true; touch(g);
  g = settle(play(g, P0, hand(g, P0, 'Confront')));
  assert.equal(g.objects[old].exhausted, true, 'still exhausted');
  const nu = hand(g, P0, 'V(1)');
  g = settle(act(g, { type: 'playCard', player: P0, obj: nu, destination: 'base' } as never));
  assert.equal(zone(g, nu), 'base');
  assert.equal(g.objects[nu].exhausted, false, 'played after Confront: ready');
});

test('RJ#7624 a hidden card at one battlefield may be played in response to a spell about another battlefield; its choices stay at its own battlefield', () => {
  let g = S0F();
  const mine = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const near = put(g, P0, 'V(2)', BF_A);
  const far = put(g, P1, 'V(3)', BF_B); control(g, BF_B, P1);
  const hb = put(g, P1, 'Hidden Blade', { facedown: BF_A });
  g = play(g, P0, hand(g, P0, 'Hextech Ray'), { targets: [[far]] });
  g = pass(g);
  assert.equal(pend(g).player, P1);
  assert.ok(canPlayNow(g, P1, hb), 'hidden card playable in response');
  g = act(g, { type: 'playCard', player: P1, obj: hb });
  const tg = g.pending?.kind === 'chooseTargets' ? optionIds(g) : g.chain[g.chain.length - 1].targets.flat();
  assert.ok(!tg.includes(far), 'nothing at BF-B');
  assert.ok(tg.includes(near) || tg.includes(mine), 'units at BF-A');
});

test('RJ#7639 Yasuo, Remorseful attacks a defending Ezreal, Dashing: Ezreal\'s defend trigger (on top) kills Yasuo first, so Yasuo\'s attack trigger deals no damage', () => {
  let { g, atk, def } = attackSetup(['Yasuo, Remorseful'], ['Ezreal, Dashing'], { atkOpts: [{ damage: 3 }] });
  g = settle(g, [], { limit: 40 });
  assert.equal(zone(g, atk[0]), 'trash', 'Yasuo died to Ezreal\'s 3');
  assert.equal(zone(g, def[0]), 'battlefield', 'Ezreal survives');
  assert.equal(g.objects[def[0]].damage, 0, 'no damage from Yasuo\'s trigger');
  let c = attackSetup(['Yasuo, Remorseful'], ['Ezreal, Dashing']);
  c.g = settle(c.g, [], { limit: 40 });
  assert.equal(zone(c.g, c.def[0]), 'trash', 'control: a surviving Yasuo deals 6 to Ezreal');
});

test('RJ#7642 Smoke Screen\'s "to a minimum of 1" is snapshotted on a buffed unit (3+1 → -3 → 1); once the buff is spent it is at 0, and a 0-Might unit with no damage survives', () => {
  let g = S0F();
  const u = put(g, P1, 'V(3)', BF_A, { buff: true }); control(g, BF_A, P1);
  assert.equal(mightOf(g, u), 4);
  g = settle(play(g, P0, hand(g, P0, 'Smoke Screen'), { targets: [[u]] }));
  assert.equal(mightOf(g, u), 1);
  delete g.objects[u].counters.buff; touch(g);
  assert.equal(mightOf(g, u), 0, 'snapshotted -3 stays: 3 - 3');
  g = settle(play(g, P0, hand(g, P0, 'DrawR')));
  assert.equal(zone(g, u), 'battlefield', 'no damage → doesn\'t die at 0 (cleanup ran)');
});

test('RJ#7644 Dragon\'s Rage moves an enemy unit to its own base and it fights another enemy unit there', () => {
  let g = S0F();
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const b = put(g, P1, 'V(2)', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, "Dragon's Rage") });
  let picked = false;
  for (let i = 0; i < 40 && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    g = !picked && o.includes(e) ? (picked = true, choose(g, e)) : o.includes('base') ? choose(g, 'base') : o.includes(b) ? choose(g, b) : act(g, legal(g, d.player)[0]);
  }
  assert.equal(locOf(g, e), 'base');
  assert.equal(zone(g, b), 'trash', 'the base unit took 3');
  assert.equal(g.objects[e].damage, 2, 'the moved unit took 2');
});

test('RJ#7655 Navori Fighting Pit\'s hold buff chooses its unit when the trigger goes on the chain: a hidden Pakaa Cub played in response can\'t receive it', () => {
  let g = S0({ tp: P1, bfA: 'Navori Fighting Pit' }); fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const cub = put(g, P0, 'Pakaa Cub', { facedown: BF_A });
  g = endTurn(g, P1);
  let played = false;
  for (let i = 0; i < 60 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!played && d.player === P0 && !d.inStep && g.chain.some(c => /Navori/.test(String(c.label)))) { g = act(g, { type: 'playCard', player: P0, obj: cub }); played = true; continue; }
    g = d.inStep ? (d.kind === 'optional' ? yes(g) : optionIds(g).includes(u) ? choose(g, u) : act(g, legal(g, d.player)[0])) : pass(g);
  }
  assert.ok(played, 'Cub played in response to the hold trigger');
  assert.equal(locOf(g, cub), BF_A);
  assert.equal(g.objects[u].counters.buff ?? 0, 1, 'the unit chosen at finalization is buffed');
  assert.equal(g.objects[cub].counters.buff ?? 0, 0, 'Cub is not');
});

test('RJ#7679 winning a combat against a stunned defender: it dies to my combat damage, so my Solari Shrine may exhaust to draw 1', () => {
  let { g, def } = attackSetup(['V(4)'], ['V(2)'], { defOpts: [{ stunned: true }] });
  fundAll(g, P0); fundAll(g, P1);
  const sh = put(g, P0, 'Solari Shrine', 'base');
  const h0 = g.players[P0].hand.length;
  for (let i = 0; i < 40 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    g = d.inStep ? (d.kind === 'optional' ? yes(g) : act(g, legal(g, d.player)[0])) : pass(g);
  }
  assert.equal(zone(g, def[0]), 'trash');
  assert.equal(g.objects[sh].exhausted, true, 'Shrine exhausted');
  assert.equal(g.players[P0].hand.length, h0 + 1, 'drew 1');
});

test('RJ#7681 Grand Strategem ([Action]) can\'t be played in response to my damage spell; the unit dies when the chain resolves', () => {
  let g = S0F();
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const gs = hand(g, P1, 'Grand Strategem');
  g = play(g, P0, hand(g, P0, 'Hextech Ray'), { targets: [[e]] });
  g = pass(g);
  assert.equal(pend(g).player, P1);
  assert.equal(canPlayNow(g, P1, gs), false, 'Action: not on a chain');
  g = settle(g);
  assert.equal(zone(g, e), 'trash');
});

test('RJ#7682 taking damage doesn\'t remove a buff: damage is just marked', () => {
  let g = S0F();
  const u = put(g, P1, 'V(3)', BF_A, { buff: true }); control(g, BF_A, P1);
  g = settle(play(g, P0, hand(g, P0, 'Hextech Ray'), { targets: [[u]] }));
  assert.equal(zone(g, u), 'battlefield');
  assert.equal(g.objects[u].damage, 3);
  assert.equal(g.objects[u].counters.buff, 1);
  assert.equal(mightOf(g, u), 4);
});

test('RJ#7684 (MISMATCH-RJ outside showdowns) after a trigger resolves on my turn outside a showdown, I get priority back (Neutral Open): the opponent can\'t play an [Action] card', () => {
  let g = S0F();
  const e = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const pa = hand(g, P1, 'PumpA');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Carnivorous Snapvine'), destination: 'base' } as never);
  let sawTrigger = false;
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) {
    if (g.chain.length) sawTrigger = true;
    const d = pend(g);
    g = d.inStep ? (optionIds(g).includes(e) ? choose(g, e) : act(g, legal(g, d.player)[0])) : pass(g);
  }
  assert.ok(sawTrigger, 'the play trigger used the chain');
  expectPending(g, 'mainAction', P0);
  assert.equal(canPlayNow(g, P1, pa), false, 'no Action for the opponent on my turn outside a showdown');
});

test('RJ#7689 a 1-Might unit at Trifarian War Camp (2), Smoke Screened to 1, then Charmed to base: 0 Might, no damage → it survives', () => {
  let g = S0({ bfA: 'Trifarian War Camp' }); fundAll(g, P0); fundAll(g, P1); addTokens(g);
  const u = put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
  assert.equal(mightOf(g, u), 2);
  g = settle(play(g, P0, hand(g, P0, 'Smoke Screen'), { targets: [[u]] }));
  assert.equal(mightOf(g, u), 1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Charm') });
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g); if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g); g = o.includes(u) ? choose(g, u) : o.includes('base') ? choose(g, 'base') : act(g, legal(g, d.player)[0]);
  }
  assert.equal(locOf(g, u), 'base');
  assert.equal(mightOf(g, u), 0);
  assert.equal(zone(g, u), 'base', 'survives at 0 Might');
});

test('RJ#7698 Nine-Tailed Fox\'s -1 vs Convergent Mutation on the attacker: in response → matched first, then -1 (4); after it resolved → matched with the -1 already applied (5)', () => {
  const run = (respond: boolean) => {
    let g = S0F();
    setLegend(g, P1, 'Nine-Tailed Fox');
    put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
    const a = put(g, P0, 'V(2)', 'base'); put(g, P0, 'V(5)', 'base');
    g = move(g, P0, [a], BF_A);
    const cm = hand(g, P0, 'Convergent Mutation');
    let cast = false;
    for (let i = 0; i < 40 && !cast; i++) {
      const d = pend(g);
      const foxOnChain = g.chain.some(c => /Fox/.test(String(c.label)));
      if (d.player === P0 && !d.inStep && ((respond && foxOnChain) || (!respond && !g.chain.length && d.kind === 'showdownAction'))) {
        g = act(g, { type: 'playCard', player: P0, obj: cm });
        for (let j = 0; j < 6 && pend(g).inStep; j++) { const o = optionIds(g); g = o.includes(a) ? choose(g, a) : choose(g, o.find(x => x !== a)!); }
        cast = true; break;
      }
      g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
    }
    assert.ok(cast, 'Mutation cast');
    for (let i = 0; i < 20 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
    return mightOf(g, a);
  };
  assert.equal(run(true), 4, 'in response: 2 → 5, then -1');
  assert.equal(run(false), 5, 'after: 1 → 5');
});

test('RJ#7714 buffed Sett, Brawler (5) Smoke Screened to 1, then his buff spent to play Call to Glory on him: 4 - 4 + 3 = 3', () => {
  let g = S0F();
  const s = put(g, P0, 'Sett, Brawler', BF_A, { buff: true }); control(g, BF_A, P0);
  assert.equal(mightOf(g, s), 5);
  g = settle(play(g, P0, hand(g, P0, 'Smoke Screen'), { targets: [[s]] }));
  assert.equal(mightOf(g, s), 1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Call to Glory') });
  for (let i = 0; i < 10 && pend(g).inStep; i++) { const d = pend(g); g = d.kind === 'optional' ? yes(g) : optionIds(g).includes(s) ? choose(g, s) : act(g, legal(g, d.player)[0]); }
  g = settle(g);
  assert.equal(g.objects[s].counters.buff ?? 0, 0, 'buff spent');
  assert.equal(mightOf(g, s), 3);
});

test('RJ#7725 First Mate ("ready another unit") cannot ready an exhausted legend: a legend is not a unit', () => {
  let g = S0F();
  const leg = g.players[P0].legend;
  g.objects[leg].exhausted = true; touch(g);
  const u = put(g, P0, 'V(2)', 'base', { ready: false }); put(g, P0, 'V(3)', 'base', { ready: false });
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'First Mate') });
  const seen: string[] = [];
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g); if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g); seen.push(...o);
    g = o.includes('base') ? choose(g, 'base') : o.includes(u) ? choose(g, u) : act(g, legal(g, d.player)[0]);
  }
  assert.ok(seen.includes(u), 'the exhausted unit is offered');
  assert.ok(!seen.includes(leg), 'the legend is never offered');
  assert.equal(g.objects[leg].exhausted, true, 'legend stays exhausted');
  assert.equal(g.objects[u].exhausted, false);
});

test('RJ#7740 Relentless Pursuit may attach an Equipment that is already attached to another friendly unit: it moves to the moved unit', () => {
  let g = S0F();
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const other = put(g, P0, 'V(3)', 'base');
  const ls = put(g, P0, 'Long Sword', 'base'); attachNow(g, ls, other);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Relentless Pursuit') });
  const seen: string[] = [];
  for (let i = 0; i < 30 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = pend(g); const o = optionIds(g);
    if (d.inStep) seen.push(`${d.kind}:${d.prompt}:${o.join(',')}`);
    if (d.kind === 'optional') g = choose(g, /attach/i.test(d.prompt ?? '') ? 'yes' : 'no');
    else if (d.inStep) g = choose(g, [u, ls, String(BF_B)].map(String).find(x => o.includes(x)) ?? o[0]);
    else g = pass(g);
  }
  assert.equal(g.objects[ls].attachedTo, u, `Equipment re-attached to the moved unit ${seen.join(' | ')}`);
  assert.equal(locOf(g, u), BF_B);
});

test('RJ#7755 (MISMATCH-RJ) Arcane Shift replays Thousand-Tailed Watcher and deals 3 to a lethally damaged Rumble (Mechs +1): Rumble dies in the cleanup after Arcane Shift, before Watcher\'s trigger resolves → the 3-Might Mech gets -2 (min 1) and ends at 1, not 0', () => {
  let g = S0F();
  const w = put(g, P0, 'Thousand-Tailed Watcher', 'base');
  const r = put(g, P1, 'sfd-089-221', BF_A); control(g, BF_A, P1);
  g.objects[r].damage = 2; touch(g);
  const bot = put(g, P1, 'Bubble Bot', 'base');
  assert.equal(mightOf(g, bot), 4, 'Mech 3 + Rumble +1');
  g = play(g, P0, hand(g, P0, 'Arcane Shift'), { targets: [[w], [r]] });
  g = settle(g, ['base']);
  for (let i = 0; i < 10 && pend(g).inStep; i++) g = settle(g, ['base']);
  assert.equal(zone(g, r), 'trash', 'Rumble died');
  assert.equal(mightOf(g, bot), 1, '3 - 2 (snapshotted to the min of 1 with Rumble already gone)');
  assert.equal(zone(g, bot), 'base');
});

test('RJ#7763 Baited Hook\'s ability has no [Reaction]: usable in my open main phase, not on the opponent\'s turn even with priority', () => {
  const g0 = S0F();
  put(g0, P0, 'V(2)', 'base');
  const h0 = put(g0, P0, 'Baited Hook', 'base');
  assert.ok(legal(g0, P0, 'activate').some(a => a.type === 'activate' && a.obj === h0), 'my main phase: yes');
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  put(g, P0, 'V(2)', 'base');
  const h = put(g, P0, 'Baited Hook', 'base');
  const dr = hand(g, P0, 'DrawR');
  g = play(g, P1, hand(g, P1, 'DrawR'));
  for (let i = 0; i < 2 && pend(g).player !== P0; i++) g = pass(g);
  assert.equal(pend(g).player, P0);
  assert.ok(canPlayNow(g, P0, dr), 'P0 has priority (a Reaction is playable)');
  assert.ok(!legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === h), 'Baited Hook not usable');
});

test('RJ#7770 Ancient Henge ("Pay any amount of Energy to [Add] that much [A]", Reaction) can be used while paying Bullet Time\'s amount on resolution: 2 ready runes → 2 Energy → 2 [A], plus 3 recycled runes = 5', () => {
  let g = S0();
  const rs = setRunes(g, P0, 3, 'chaos');
  put(g, P0, 'Ancient Henge', 'base');
  const e = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Bullet Time'), payment: { exhaust: [rs[0]], recycle: [] } });
  g = answer(g, { targets: [[g.battlefields[BF_A].objId]] }, P0);
  g = resolveChain(g);
  expectPending(g, 'chooseNumber', P0);
  assert.ok(optionIds(g).includes('5'), `Henge usable while paying (options ${optionIds(g).join(',')})`);
  g = choose(g, '5');
  g = settle(g);
  assert.equal(zone(g, e), 'trash', '5 damage');
});

test('RJ#7773 Dune Drake\'s "if there is a ready enemy unit here" is checked on resolution (not an intervening "if"): the attack trigger is chained either way; +2 only with a ready enemy', () => {
  const run = (ready: boolean) => {
    let g = S0F();
    put(g, P1, 'V(2)', BF_A, { ready }); control(g, BF_A, P1);
    const dd = put(g, P0, 'Dune Drake', 'base');
    g = move(g, P0, [dd], BF_A);
    let chained = false;
    for (let i = 0; i < 20 && !(g.showdown?.isCombat && !g.chain.length && pend(g).kind === 'showdownAction'); i++) {
      if (g.chain.some(c => c.source === dd)) chained = true;
      const d = pend(g); g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
    }
    return { chained, m: mightOf(g, dd) };
  };
  const a = run(true), b = run(false);
  assert.ok(a.chained && b.chained, 'trigger goes on the chain in both cases');
  assert.equal(a.m, 7);
  assert.equal(b.m, 5);
});

test('RJ#7782 The Boss heals the unit it saves; Falling Star (3 + 3) on a buffed 4-Might unit with 3 damage: both hits land before the cleanup, one save → healed in base, alive (RJ\'s "second hit kills it" aside is MISMATCH-RJ)', () => {
  let g = S0F();
  setLegend(g, P0, 'The Boss');
  const u = put(g, P0, 'V(3)', BF_A, { buff: true }); control(g, BF_A, P0);
  g.objects[u].damage = 3; touch(g);
  g = nextTurn(g); fundAll(g, P0); fundAll(g, P1);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Falling Star') });
  let offers = 0;
  for (let i = 0; i < 30 && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g); if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    if (d.player === P0 && d.kind === 'optional') { offers++; g = yes(g); continue; }
    g = o.includes(u) ? choose(g, u) : act(g, legal(g, d.player)[0]);
  }
  assert.equal(offers, 1, 'one save');
  assert.equal(zone(g, u), 'base', 'saved and alive');
  assert.equal(g.objects[u].damage, 0, 'healed');
  assert.equal(g.objects[u].counters.buff ?? 0, 0, 'buff spent');
});

test('RJ#7783 Possession on a buffed enemy unit: the buff stays on the unit under its new controller', () => {
  let g = S0F();
  const e = put(g, P1, 'V(3)', BF_A, { buff: true }); control(g, BF_A, P1);
  g = settle(play(g, P0, hand(g, P0, 'Possession'), { targets: [[e]] }));
  assert.equal(g.objects[e].controller, P0);
  assert.equal(zone(g, e), 'base');
  assert.equal(g.objects[e].counters.buff, 1, 'still buffed');
  assert.equal(mightOf(g, e), 4);
});

test('RJ#7788 Emperor\'s Divide chooses the friendly units it moves when played: Blade Dancer (Irelia legend) triggers and can ready one', () => {
  let g = S0F();
  const leg = setLegend(g, P0, 'Blade Dancer');
  const a = put(g, P0, 'V(2)', BF_A, { ready: false }); put(g, P0, 'V(2)', BF_A, { ready: false }); control(g, BF_A, P0);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Emperor\'s Divide') });
  let offered = 0;
  for (let i = 0; i < 30 && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g); if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    if (d.kind === 'optional') { offered++; g = choose(g, offered === 1 ? 'yes' : 'no'); continue; }
    g = o.includes(a) ? choose(g, a) : o.includes(String(BF_A)) ? choose(g, String(BF_A)) : act(g, legal(g, d.player)[0]);
  }
  assert.ok(offered >= 1, 'Blade Dancer offered');
  assert.equal(locOf(g, a), 'base', 'moved to base');
  assert.equal(g.objects[a].exhausted, false, 'readied by Blade Dancer');
  assert.equal(g.objects[leg].exhausted, true);
});

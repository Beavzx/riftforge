import { test } from 'node:test';
import { isGear, isUnit } from '../../../src/engine/chars.ts';
import { game, mana, stack, play, drive, opt, none, hand, trash, deckTop, put, zoneOf, act, endTurn, handCard, assert, pendingIs, noInStep, setController, hasKw } from './_util.ts';

test('Chemtech Enforcer (ogn-003): play -> discard 1 (player chooses); Assault 2 keyword', () => {
  let g = game(); mana(g, 0, 2);
  const before = hand(g, 0).length;
  let r = play(g, 0, 'ogn-003-298', { dest: 'base' });
  g = r.g;
  pendingIs(g, 'chooseCards', 0);
  g = drive(g, opt('t-u3'));
  assert.equal(hand(g, 0).length, before - 1);
  assert.ok(trash(g, 0).includes('t-u3'));
  assert.ok(hasKw(g, r.id, 'Assault'));
});

test('Jinx (ogn-030): discards 2', () => {
  let g = game(); mana(g, 0, 4);
  g = play(g, 0, 'ogn-030-298', { dest: 'base' }, 'no').g;   // decline Accelerate
  pendingIs(g, 'chooseCards');
  assert.equal(g.pending!.min, 2);
  g = drive(g, g2 => [...opt('t-u1')(g2), ...opt('t-u2')(g2)]);
  assert.deepEqual(trash(g, 0).sort(), ['t-u1', 't-u2']);
});

test('draw spells and units: Consult the Past 2, Lecturing Yordle 1, Cloud Drake 1, Progress Day 4, Downstage Dramatics, Dredge Up', () => {
  for (const [id, n, isUnit, m] of [['ogn-083-298', 2, false, 4], ['ogn-087-298', 1, true, 3], ['ven-048-166', 1, true, 6], ['ogn-114-298', 4, false, 7], ['ven-049-166', 1, false, 2]] as const) {
    let g = game(); mana(g, 0, m, 'Mind');
    const before = hand(g, 0).length;
    g = play(g, 0, id, isUnit ? { dest: 'base' } : {}).g;
    noInStep(g);
    assert.equal(hand(g, 0).length, before + n, id);
  }
});

test('Downstage Dramatics (unl-061): Repeat [2] draws twice; declining draws once', () => {
  let g = game(); mana(g, 0, 4, 'Mind');
  const before = hand(g, 0).length;
  let r = play(g, 0, 'unl-061-219', {}, 'yes');
  assert.equal(hand(r.g, 0).length, before + 2);
  g = game(); mana(g, 0, 4, 'Mind');
  r = play(g, 0, 'unl-061-219', {}, 'no');
  assert.equal(hand(r.g, 0).length, before + 1);
});

test('Watchful Sentry (ogn-096): Deathknell draws 1', () => {
  let g = game();
  const s = put(g, 0, 'ogn-096-298', 'base');
  const before = hand(g, 0).length;
  g.objects[s].damage = 5; g.ex.dirty = true;
  g = endTurn(g);
  assert.equal(zoneOf(g, s), 'trash');
  assert.ok(hand(g, 0).length >= before + 1);
});

test('Undercover Agent (ogn-178): Deathknell discard 2, then draw 2', () => {
  let g = game();
  const s = put(g, 1, 'ogn-178-298', 'base');
  const before = hand(g, 1).length;
  g.objects[s].damage = 9; g.ex.dirty = true;
  g = act(g, { type: 'endTurn', player: 0 });
  g = drive(g);
  pendingIs(g, 'chooseCards', 1);
  g = drive(g, gg => gg.pending!.options!.slice(0, 2).map(o => o.id));
  assert.equal(trash(g, 1).filter(c => c !== 'ogn-178-298').length, 2);
  assert.ok(hand(g, 1).length >= before);   // -2 +2 (+1 draw phase)
});

test('Evershade Stalker (unl-123): discard 1 then draw 1', () => {
  let g = game(); mana(g, 0, 3, 'Chaos');
  stack(g, 0, 't-tank');
  g = play(g, 0, 'unl-123-219', { dest: 'base' }, opt('t-u1')).g;
  assert.ok(trash(g, 0).includes('t-u1'));
  assert.ok(hand(g, 0).includes('t-tank'));
});

test('Kadregrin (ogn-038): draws 1 per Mighty unit you control (including itself)', () => {
  let g = game(); mana(g, 0, 11, 'Fury');
  put(g, 0, 't-u5', 'base'); put(g, 0, 't-u4', 'base'); put(g, 1, 't-u5', 'base');
  const before = hand(g, 0).length;
  g = play(g, 0, 'ogn-038-298', { dest: 'base' }).g;
  assert.equal(hand(g, 0).length, before + 2);
});

test('Invert Timelines (ogn-201): each player discards their hand, then draws 4', () => {
  let g = game(); mana(g, 0, 4, 'Chaos');
  g = play(g, 0, 'ogn-201-298').g;
  assert.equal(hand(g, 0).length, 4);
  assert.equal(hand(g, 1).length, 4);
  assert.ok(trash(g, 1).length >= 4 && trash(g, 0).length >= 5);
});

test('Suave Negotiator (rad-099): you and the opponent each draw 1', () => {
  let g = game(); mana(g, 0, 3, 'Chaos');
  const a = hand(g, 0).length, b = hand(g, 1).length;
  g = play(g, 0, 'rad-099-167', { dest: 'base' }).g;
  assert.equal(hand(g, 0).length, a + 1);
  assert.equal(hand(g, 1).length, b + 1);
});

test('Bewitching Spirit (unl-121): choose a player; that player chooses the discard', () => {
  let g = game(); mana(g, 0, 3, 'Chaos');
  g = play(g, 0, 'unl-121-219', { dest: 'base' }).g;
  pendingIs(g, 'chooseOpponent', 0);
  g = drive(g, '1');
  pendingIs(g, 'chooseCards', 1);
  g = drive(g, opt('t-u2'));
  assert.deepEqual(trash(g, 1), ['t-u2']);
});

test('Kinkou Initiate (unl-097): draws only if other units total 5+ Might', () => {
  let g = game(); mana(g, 0, 3, 'Body');
  put(g, 0, 't-u3', 'base'); put(g, 0, 't-u2', 'base');
  let before = hand(g, 0).length;
  g = play(g, 0, 'unl-097-219', { dest: 'base' }).g;
  assert.equal(hand(g, 0).length, before + 1);
  g = game(); mana(g, 0, 3, 'Body');
  put(g, 0, 't-u3', 'base'); put(g, 0, 't-u1', 'base'); put(g, 1, 't-u5', 'base');
  before = hand(g, 0).length;
  g = play(g, 0, 'unl-097-219', { dest: 'base' }).g;
  assert.equal(hand(g, 0).length, before);
});

test('Patched Porobot (ven-058): draws with 3+ other gear; enters exhausted', () => {
  let g = game(); mana(g, 0, 2, 'Mind');
  for (let i = 0; i < 3; i++) put(g, 0, 'ogn-242-298', 'base');
  let before = hand(g, 0).length;
  let r = play(g, 0, 'ven-058-166', { dest: 'base' });
  assert.equal(hand(r.g, 0).length, before + 1);
  assert.equal(r.g.objects[r.id].exhausted, true);
  g = game(); mana(g, 0, 2, 'Mind');
  for (let i = 0; i < 2; i++) put(g, 0, 'ogn-242-298', 'base');
  before = hand(g, 0).length;
  r = play(g, 0, 'ven-058-166', { dest: 'base' });
  assert.equal(hand(r.g, 0).length, before);
});

test('Patched Porobot (ven-058) is a Unit and a Gear: other Porobots count as gear, itself does not', () => {
  let g = game(); mana(g, 0, 2, 'Mind');
  put(g, 0, 'ven-058-166', 'base'); put(g, 0, 'ven-058-166', 'base'); put(g, 0, 'ogn-242-298', 'base');
  put(g, 1, 'ogn-242-298', 'base');                 // enemy gear doesn't count
  const before = hand(g, 0).length;
  const r = play(g, 0, 'ven-058-166', { dest: 'base' });
  assert.equal(hand(r.g, 0).length, before + 1, 'two other Porobots + one gear = 3 other gear');
});

test('Patched Porobot: the engine treats a Gear Unit as a gear (isGear reads additionalTypes)', () => {
  const g = game();
  const p = put(g, 0, 'ven-058-166', 'base');
  assert.equal(isGear(g, p), true);
  assert.equal(isUnit(g, p), true);
});

test('LeBlanc (unl-172): Deathknell draws 1; 2 during your Beginning Phase (Temporary kill)', () => {
  let g = game();
  const l = put(g, 0, 'unl-172-219', 'base');
  g.objects[l].damage = 9; g.ex.dirty = true;
  const before = hand(g, 0).length;
  g = drive(act(g, { type: 'endTurn', player: 0 }));
  assert.equal(zoneOf(g, l), 'trash');
  assert.equal(hand(g, 0).length, before + 1);
  // Beginning phase: Temporary kills it at the start of its controller's Beginning Phase
  g = game();
  const l2 = put(g, 1, 'unl-172-219', 'base');
  g.objects[l2].modifiers.push({ source: l2, duration: 'permanent', addKeywords: ['Temporary'], timestamp: 1, layer: 3 } as never);
  const b1 = hand(g, 1).length;
  g = drive(act(g, { type: 'endTurn', player: 0 }));
  assert.equal(zoneOf(g, l2), 'trash');
  assert.equal(hand(g, 1).length, b1 + 2 + 1);   // +2 Deathknell, +1 draw phase
});

test('Unsung Hero (sfd-167): Deathknell draws 2 only if it was Mighty', () => {
  let g = game();
  const h = put(g, 0, 'sfd-167-221', 'base');
  g.objects[h].modifiers.push({ source: h, duration: 'permanent', might: 3, timestamp: 1, layer: 4 } as never);
  g.objects[h].damage = 9; g.ex.dirty = true;
  const before = hand(g, 0).length;
  g = drive(act(g, { type: 'endTurn', player: 0 }));
  assert.equal(hand(g, 0).length, before + 2);
  g = game();
  const h2 = put(g, 0, 'sfd-167-221', 'base');
  g.objects[h2].damage = 9; g.ex.dirty = true;
  g = drive(act(g, { type: 'endTurn', player: 0 }));
  assert.equal(hand(g, 0).length, before);
});

test('Tasty Faefolk (ogn-075): Deathknell channels 2 exhausted and draws 1; Accelerate', () => {
  let g = game();
  const f = put(g, 1, 'ogn-075-298', 'base');
  assert.ok(hasKw(g, f, 'Accelerate'));
  g.objects[f].damage = 99; g.ex.dirty = true;
  const b = hand(g, 1).length, rr = g.players[1].runesInPlay.length;
  g = drive(act(g, { type: 'endTurn', player: 0 }));
  assert.ok(g.players[1].runesInPlay.length >= rr + 2);
  assert.ok(hand(g, 1).length >= b + 1);
});

test('Wraith of Echoes (ogn-118): only the first friendly unit death each turn draws', () => {
  let g = game(); mana(g, 0, 10, 'Mind');
  put(g, 0, 'ogn-118-298', 'base');
  const a = put(g, 0, 't-u1', 'base'), b = put(g, 0, 't-u1', 'base');
  const before = hand(g, 0).length;
  g.objects[a].damage = 5; g.ex.dirty = true;
  g = play(g, 0, 'ogn-083-298').g;   // any action to trigger cleanup: Consult the Past (draw 2)
  assert.equal(zoneOf(g, a), 'trash');
  const mid = hand(g, 0).length;
  assert.equal(mid, before + 2 + 1);
  g.objects[b].damage = 5; g.ex.dirty = true;
  g = play(g, 0, 'ogn-083-298').g;
  assert.equal(zoneOf(g, b), 'trash');
  assert.equal(hand(g, 0).length, mid + 2);
});

test('Wraith of Echoes: a friendly death earlier this turn (before Wraith) means no draw', () => {
  let g = game(); mana(g, 0, 8, 'Mind');
  g.ex.counts['unitsDied:0'] = 1;
  put(g, 0, 'ogn-118-298', 'base');
  const a = put(g, 0, 't-u1', 'base');
  g.objects[a].damage = 5; g.ex.dirty = true;
  const before = hand(g, 0).length;
  g = play(g, 0, 'ogn-083-298').g;
  assert.equal(hand(g, 0).length, before + 2);
});

test('Wraith of Echoes: no draw for its own death, nor for friendly units dying at the same time (CR 383.2.c.2; RJ#3911, RJ#2674)', () => {
  for (const others of [0, 1, 2]) {
    let g = game(); mana(g, 0, 8, 'Mind');
    const w = put(g, 0, 'ogn-118-298', 'base');
    const os = Array.from({ length: others }, () => put(g, 0, 't-u1', 'base'));
    for (const id of [w, ...os]) g.objects[id].damage = 9;
    g.ex.dirty = true;
    const before = hand(g, 0).length;
    g = play(g, 0, 'ogn-083-298').g;   // any action: the cleanup kills them all at once
    assert.equal(zoneOf(g, w), 'trash');
    for (const id of os) assert.equal(zoneOf(g, id), 'trash');
    assert.equal(hand(g, 0).length, before + 2, `only Consult the Past's 2 (others=${others})`);
  }
});

test('Wraith of Echoes: two other friendly units dying together draw only once', () => {
  let g = game(); mana(g, 0, 8, 'Mind');
  put(g, 0, 'ogn-118-298', 'base');
  const a = put(g, 0, 't-u1', 'base'), b = put(g, 0, 't-u1', 'base');
  g.objects[a].damage = 5; g.objects[b].damage = 5; g.ex.dirty = true;
  const before = hand(g, 0).length;
  g = play(g, 0, 'ogn-083-298').g;
  // AUTO-AUDIT F-4 (ENGINE-7): the two instances (one per death) are ordered by their controller
  pendingIs(g, 'orderTriggers', 0);
  g = drive(g, '0');
  assert.equal(hand(g, 0).length, before + 2 + 1);
});

test('Storm Raptor (rad-036): a stunned enemy unit here dying draws 1; unstunned does not; Deflect', () => {
  let g = game(); mana(g, 0, 4, 'Fury');
  setController(g, 0, 0);
  const r = put(g, 0, 'rad-036-167', 0);
  assert.ok(hasKw(g, r, 'Deflect'));
  const e1 = put(g, 1, 't-u2', 0), e2 = put(g, 1, 't-u2', 0);
  g.objects[e1].stunned = true;
  g.objects[e1].damage = 5; g.objects[e2].damage = 5; g.ex.dirty = true;
  const before = hand(g, 0).length;
  g = play(g, 0, 'ogn-083-298').g;
  assert.equal(zoneOf(g, e1), 'trash'); assert.equal(zoneOf(g, e2), 'trash');
  assert.equal(hand(g, 0).length, before + 2 + 1);
});

test('Jae Medarda (sfd-142): drawing when chosen by your spell, not by an opponent\'s or by an ability', () => {
  let g = game(); mana(g, 0, 4, 'Calm');
  const j = put(g, 0, 'sfd-142-221', 'base');
  const before = hand(g, 0).length;
  put(g, 0, 't-u1', 'base');
  g = play(g, 0, 'ogn-057-298', {}, objOptFor(j)).g;   // Block: give a unit Shield/Tank
  assert.equal(hand(g, 0).length, before + 1);
  assert.ok(hasKw(g, j, 'Tank'));
  // opponent's spell choosing Jae doesn't draw for us
  g = game(); mana(g, 1, 4, 'Calm');
  const j2 = put(g, 0, 'sfd-142-221', 'base');
  g = act(g, { type: 'endTurn', player: 0 }); g = drive(g);
  const b2 = hand(g, 0).length;
  put(g, 1, 't-u1', 'base');
  g = play(g, 1, 'ogn-057-298', {}, objOptFor(j2)).g;
  assert.equal(hand(g, 0).length, b2);
});
function objOptFor(id: string) { return (g: import('./_util.ts').GameState) => { const o = g.pending!.options!.find(x => x.objIds?.[0] === id); if (!o) throw new Error('no option'); return [o.id]; }; }

test('Yordle Explorer (sfd-100): draws when you play a card with Power cost [A][A]+, not for 1 power', () => {
  let g = game(); mana(g, 0, 12, 'Fury');
  put(g, 0, 'sfd-100-221', 'base');
  let before = hand(g, 0).length;
  mana(g, 0, 2, 'Chaos');
  put(g, 0, 't-u1', 'trash');       // RULINGS: The Harrowing needs a unit in the trash to target (CR 355.17 / 358.1)
  g = play(g, 0, 'ogn-198-298').g;   // The Harrowing: P2
  assert.equal(hand(g, 0).length, before + 1);
  g = game(); mana(g, 0, 8, 'Fury');
  put(g, 0, 'sfd-100-221', 'base');
  before = hand(g, 0).length;
  g = play(g, 0, 'ogn-037-298', { dest: 'base' }).g;   // Immortal Phoenix P1
  assert.equal(hand(g, 0).length, before);
});

test('Fanfare (rad-047): the next three units you play this turn each draw 1', () => {
  let g = game(); mana(g, 0, 12, 'Fury');
  g = play(g, 0, 'rad-047-167').g;
  let n = hand(g, 0).length;
  for (let i = 0; i < 4; i++) {
    g = play(g, 0, 't-u1', { dest: 'base' }).g;
    const now = hand(g, 0).length;
    assert.equal(now, i < 3 ? n + 1 : n, `unit ${i + 1}`);
    n = now;
  }
});

test('Confront (ogn-129): units you play this turn enter ready; draws 1', () => {
  let g = game(); mana(g, 0, 6, 'Body');
  const before = hand(g, 0).length;
  g = play(g, 0, 'ogn-129-298').g;
  assert.equal(hand(g, 0).length, before + 1);
  const r = play(g, 0, 't-u2', { dest: 'base' });
  assert.equal(r.g.objects[r.id].exhausted, false);
  const r2 = play(r.g, 0, 't-u1', { dest: 'base' });
  assert.equal(r2.g.objects[r2.id].exhausted, false);
});

test('Party Favors (ogn-071): opponent chooses Cards -> both draw; Runes -> both channel 1 exhausted', () => {
  let g = game(); mana(g, 0, 3, 'Calm');
  const a = hand(g, 0).length, b = hand(g, 1).length;
  g = play(g, 0, 'ogn-071-298').g;
  pendingIs(g, 'chooseMode', 1);
  g = drive(g, 'cards');
  assert.equal(hand(g, 0).length, a + 1); assert.equal(hand(g, 1).length, b + 1);
  g = game(); mana(g, 0, 3, 'Calm');
  const r0 = g.players[0].runesInPlay.length, r1 = g.players[1].runesInPlay.length;
  g = play(g, 0, 'ogn-071-298', {}, 'runes').g;
  assert.equal(g.players[0].runesInPlay.length, r0 + 1);
  assert.equal(g.players[1].runesInPlay.length, r1 + 1);
  assert.ok(g.objects[g.players[1].runesInPlay[r1]].exhausted);
});

test('Mobilize (ogn-134) / Catalyst of Aeons (ogn-138): channel exhausted; draw only if short', () => {
  let g = game(); mana(g, 0, 2, 'Body');
  let h = hand(g, 0).length, r = g.players[0].runesInPlay.length;
  g = play(g, 0, 'ogn-134-298').g;
  assert.equal(g.players[0].runesInPlay.length, r + 1); assert.equal(hand(g, 0).length, h);
  g = game(); mana(g, 0, 2, 'Body'); g.players[0].runeDeck = [];
  h = hand(g, 0).length;
  g = play(g, 0, 'ogn-134-298').g;
  assert.equal(hand(g, 0).length, h + 1);
  g = game(); mana(g, 0, 4, 'Body'); g.players[0].runeDeck = g.players[0].runeDeck.slice(0, 1);
  h = hand(g, 0).length;
  g = play(g, 0, 'ogn-138-298').g;
  assert.equal(hand(g, 0).length, h + 1);
  g = game(); mana(g, 0, 4, 'Body');
  h = hand(g, 0).length; r = g.players[0].runesInPlay.length;
  g = play(g, 0, 'ogn-138-298').g;
  assert.equal(hand(g, 0).length, h); assert.equal(g.players[0].runesInPlay.length, r + 2);
});

test('Counter Strike (sfd-194): prevents only the next damage to the unit this turn; draws 1', () => {
  let g = game(); mana(g, 0, 3, 'Calm'); mana(g, 0, 10, 'Fury');
  const u = put(g, 0, 't-u3', 'base');
  const before = hand(g, 0).length;
  g = play(g, 0, 'sfd-194-221').g;   // single legal target: auto-chosen
  assert.equal(hand(g, 0).length, before + 1);
  g = play(g, 0, 'ogn-252-298').g;   // Super Mega Death Rocket: deal 5
  assert.equal(g.objects[u].damage, 0);
  g = play(g, 0, 'ogn-252-298').g;
  assert.equal(zoneOf(g, u), 'trash');
});

test("Shadow's Call (unl-165): gives a friendly unit without Temporary [Temporary]; draws 2", () => {
  let g = game(); mana(g, 0, 2, 'Order');
  const u = put(g, 0, 't-u2', 'base');
  put(g, 0, 't-temp', 'base');
  const before = hand(g, 0).length;
  g = play(g, 0, 'unl-165-219').g;   // only one legal target: auto
  assert.ok(hasKw(g, u, 'Temporary'));
  assert.equal(hand(g, 0).length, before + 2);
});

test('Back Off (unl-042): stun; draw only when played from hand (not from hiding)', () => {
  let g = game(); mana(g, 0, 3, 'Calm');
  const e = put(g, 1, 't-u2', 'base');
  const before = hand(g, 0).length;
  put(g, 0, 't-u1', 'base');
  g = play(g, 0, 'unl-042-219', {}, objOptFor(e)).g;
  assert.ok(g.objects[e].stunned);
  assert.equal(hand(g, 0).length, before + 1);
  // from hiding: no draw
  g = game(); mana(g, 0, 1, 'Calm'); setController(g, 0, 0);
  const e2 = put(g, 0, 't-u1', 0);   // the only unit at that battlefield (hidden plays target there)
  const card = handCard(g, 0, 'unl-042-219');
  g = act(g, { type: 'hide', player: 0, obj: card, battlefieldIndex: 0 });
  g = endTurn(g);                                  // opponent's turn
  g = endTurn(g);                                  // back to us: the facedown card can be played
  const b2 = hand(g, 0).length;
  g = act(g, { type: 'playCard', player: 0, obj: card });
  g = drive(g);
  assert.ok(g.objects[e2].stunned);
  assert.equal(hand(g, 0).length, b2);
});

test('Smoke and Mirrors (unl-083): swaps two of your units at different locations if one has Temporary; draw 1', () => {
  let g = game(); mana(g, 0, 2, 'Mind'); setController(g, 0, 0);
  const a = put(g, 0, 't-temp', 'base');
  const b = put(g, 0, 't-u2', 0);
  const c = put(g, 0, 't-u3', 'base');
  put(g, 0, 't-u1', 0);
  const before = hand(g, 0).length;
  g = play(g, 0, 'unl-083-219').g;
  pendingIs(g, 'chooseTargets');
  g = drive(g, objOptFor(a));
  // second choice excludes units at the same location (c at base)
  assert.ok(!g.pending!.options!.some(o => o.objIds?.[0] === c));
  g = drive(g, objOptFor(b));
  assert.equal(g.objects[a].zone, 'battlefield'); assert.equal(g.objects[b].zone, 'base');
  assert.equal(hand(g, 0).length, before + 1);
  // neither has Temporary: no move
  g = game(); mana(g, 0, 2, 'Mind'); setController(g, 0, 0);
  const x = put(g, 0, 't-u1', 'base'), y = put(g, 0, 't-u2', 0);
  g = play(g, 0, 'unl-083-219', {}, objOptFor(x)).g;   // y is then the only legal second choice
  assert.equal(g.objects[x].zone, 'base'); assert.equal(g.objects[y].zone, 'battlefield');
});

test('Flame Chompers (ogn-006): when discarded you may pay [C] to play it', () => {
  let g = game(); mana(g, 0, 6, 'Fury');
  const fc = handCard(g, 0, 'ogn-006-298');
  g = play(g, 0, 'ogn-003-298', { dest: 'base' }, objOptFor(fc)).g;   // Chemtech Enforcer: discard Flame Chompers
  pendingIs(g, 'optional', 0);
  g = drive(g, 'yes');
  if (g.pending?.kind === 'chooseDestination') g = drive(g, 'base');
  assert.equal(zoneOf(g, fc), 'base');
  // declined: stays in trash
  g = game(); mana(g, 0, 6, 'Fury');
  const fc2 = handCard(g, 0, 'ogn-006-298');
  g = play(g, 0, 'ogn-003-298', { dest: 'base' }, objOptFor(fc2), 'no').g;
  assert.equal(zoneOf(g, fc2), 'trash');
});

test('Flame Chompers: no trigger if [C] cannot be paid', () => {
  let g = game(); mana(g, 0, 2, 'Chaos');
  const fc = handCard(g, 0, 'ogn-006-298');
  g = play(g, 0, 'ogn-003-298', { dest: 'base' }, objOptFor(fc)).g;
  noInStep(g);
  assert.equal(zoneOf(g, fc), 'trash');
});

test('Mask Mother (ven-094): when discarded, may pay [1] to give a friendly unit +2 this turn', () => {
  let g = game(); mana(g, 0, 4, 'Fury');
  const u = put(g, 0, 't-u2', 'base');
  put(g, 0, 't-u1', 'base');
  const mm = handCard(g, 0, 'ven-094-166');
  g = play(g, 0, 'ogn-003-298', { dest: 'base' }, objOptFor(mm), 'yes', objOptFor(u)).g;
  assert.equal(g.objects[u] && (await_might(g, u)), 4);
});
import { might as mightOf } from '../../../src/engine/chars.ts';
function await_might(g: import('./_util.ts').GameState, id: string) { return mightOf(g, id); }

void none; void deckTop;

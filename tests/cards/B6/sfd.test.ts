// B6 scenario tests: Spiritforged (sfd).
import { test } from 'node:test';
import {
  game, addRunes, exhaustRunes, play, playObj, playHere, activate, moveUnits, attackInto, endTurn, drive, doAct, put, handCard, M, buffs, ready, pendingIds,
  assert, hasKw, kwVal, zoneOf, setController, legalPlay,
} from './_h.ts';

test('Against the Odds: +2 per enemy unit at its battlefield', () => {
  let g = game();
  addRunes(g, 0, 4, 'Fury');
  const a = put(g, 0, 't-u5', 'base');
  put(g, 1, 't-u1', 0); put(g, 1, 't-u1', 0);
  g = attackInto(g, 0, [a], 0);
  assert.equal(g.pending?.kind, 'showdownAction');
  ({ g } = playHere(g, 0, 'sfd-001-221', undefined));
  assert.equal(M(g, a), 9);
});

test('Against the Odds: only friendly units at a battlefield can be chosen', () => {
  let g = game();
  addRunes(g, 0, 4, 'Fury');
  put(g, 0, 't-u2', 'base');
  const s = handCard(g, 0, 'sfd-001-221');
  assert.equal(legalPlay(g, 0, s), false);
});

test('Gem Jammer: give a unit Ganking this turn', () => {
  let g = game();
  addRunes(g, 0, 3, 'Fury');
  const a = put(g, 0, 't-u2', 0);
  ({ g } = play(g, 0, 'sfd-007-221', 'base', a));
  assert.ok(hasKw(g, a, 'Ganking'));
  g = moveUnits(g, 0, [a], 1);
  assert.equal(g.objects[a].battlefieldIndex, 1, 'moved battlefield to battlefield');
});

test('Feral Strength: +2; Repeat [2] repeats with a new choice', () => {
  let g = game();
  exhaustRunes(g, 0);
  addRunes(g, 0, 4, 'Calm');
  const a = put(g, 0, 't-u2', 'base'), b = put(g, 0, 't-u2', 'base');
  const s = handCard(g, 0, 'sfd-034-221');
  assert.ok(hasKw(g, s, 'Repeat'));
  g = playObj(g, 0, s, undefined, a, 'yes', b);
  assert.equal(M(g, a), 4);
  assert.equal(M(g, b), 4);
});

test('Ribbon Dancer: moving to a battlefield gives another friendly unit +1', () => {
  let g = game();
  const r = put(g, 0, 'sfd-038-221', 'base');
  const a = put(g, 0, 't-u2', 'base');
  g = moveUnits(g, 0, [r], 0);
  assert.equal(M(g, a), 3);
  assert.equal(M(g, r), 3);
});

test('Simian Ancestor: ready me when you buff me', () => {
  let g = game();
  addRunes(g, 0, 2, 'Body');
  const s = put(g, 0, 'sfd-047-221', 'base', { ready: false });
  ({ g } = play(g, 0, 'ogn-136-298', 'base'));
  assert.equal(buffs(g, s), 1);
  assert.equal(ready(g, s), true);
});

test('Irelia, Fervent: +1 when you choose her and when you ready her; Deflect', () => {
  let g = game();
  addRunes(g, 0, 6, 'Calm');
  const i = put(g, 0, 'sfd-057-221', 'base', { ready: false });
  assert.equal(kwVal(g, i, 'Deflect'), 1);
  ({ g } = play(g, 0, 'ogn-058-298', undefined));
  assert.equal(M(g, i), 7, '4 + 2 (Discipline) + 1 (chosen)');
  ({ g } = play(g, 0, 'unl-009-219', undefined, 'no'));
  assert.equal(ready(g, i), true);
  assert.equal(M(g, i), 9, 'chosen again (+1) and readied (+1)');
});

test('Bubble Bot: ready another friendly Mech', () => {
  let g = game();
  addRunes(g, 0, 3, 'Mind');
  const m = put(g, 0, 't-b6-mech', 'base', { ready: false });
  const u = put(g, 0, 't-u2', 'base', { ready: false });
  ({ g } = play(g, 0, 'sfd-062-221', 'base'));
  assert.equal(ready(g, m), true);
  assert.equal(ready(g, u), false);
});

test('Frigid Touch: -2; Repeat targets again', () => {
  let g = game();
  exhaustRunes(g, 0);
  addRunes(g, 0, 4, 'Mind');
  const e = put(g, 1, 't-u5', 0);
  ({ g } = play(g, 0, 'sfd-066-221', undefined, 'yes'));
  assert.equal(M(g, e), 1);
});

test('Frostcoat Cub: if [C] was paid as an additional cost, a unit -2', () => {
  let g = game();
  exhaustRunes(g, 0);
  addRunes(g, 0, 4, 'Mind');
  const e = put(g, 1, 't-u5', 0);
  ({ g } = play(g, 0, 'sfd-067-221', 'base', 'yes', e));
  assert.equal(M(g, e), 3);
  addRunes(g, 0, 4, 'Mind');
  ({ g } = play(g, 0, 'sfd-067-221', 'base', 'no'));
  assert.equal(M(g, e), 3, 'not paid: no trigger');
});

test('Dropboarder: ready me if you control two or more gear', () => {
  let g = game();
  addRunes(g, 0, 8, 'Mind');
  put(g, 0, 't-b6-gear2', 'base');
  let r = play(g, 0, 'sfd-072-221', 'base');
  g = r.g;
  assert.equal(ready(g, r.id), false);
  put(g, 0, 't-b6-gear2', 'base');
  r = play(g, 0, 'sfd-072-221', 'base');
  g = r.g;
  assert.equal(ready(g, r.id), true);
});

test('Prize of Progress: +1 when you use an activated ability of a gear', () => {
  let g = game();
  const p = put(g, 0, 'sfd-075-221', 'base');
  const r = put(g, 0, 'rad-046-167', 'base');
  const lee = put(g, 0, 'ogn-078-298', 'base');
  g = activate(g, 0, lee, 0);
  assert.equal(M(g, p), 3, 'unit ability: nothing');
  g = activate(g, 0, r, 0, lee);
  assert.equal(M(g, p), 4);
});

test('Buhru Captain: may draw 1 or buff me (or neither)', () => {
  let g = game();
  addRunes(g, 0, 8, 'Body');
  const h = g.players[0].hand.length;
  let r = play(g, 0, 'sfd-091-221', 'base', '0');
  g = r.g;
  assert.equal(g.players[0].hand.length, h + 1);
  r = play(g, 0, 'sfd-091-221', 'base', '1');
  g = r.g;
  assert.equal(buffs(g, r.id), 1);
  r = play(g, 0, 'sfd-091-221', 'base', '2');
  g = r.g;
  assert.equal(buffs(g, r.id), 0);
  assert.equal(g.players[0].hand.length, h + 1);
});

test('Punch First: +5', () => {
  let g = game();
  addRunes(g, 0, 3, 'Body');
  const a = put(g, 0, 't-u1', 'base');
  ({ g } = play(g, 0, 'sfd-097-221', undefined));
  assert.equal(M(g, a), 6);
});

test('Sea Monkey: pay [1] extra to buff it', () => {
  let g = game();
  exhaustRunes(g, 0);
  addRunes(g, 0, 3, 'Body');
  let r = play(g, 0, 'sfd-098-221', 'base', 'yes');
  g = r.g;
  assert.equal(buffs(g, r.id), 1);
  addRunes(g, 0, 3, 'Body');
  r = play(g, 0, 'sfd-098-221', 'base', 'no');
  g = r.g;
  assert.equal(buffs(g, r.id), 0);
});

test('Kato the Arm: moving to a battlefield gives another friendly unit my keywords and +my Might', () => {
  let g = game();
  const k = put(g, 0, 'sfd-112-221', 'base');
  const a = put(g, 0, 't-u2', 'base');
  g = moveUnits(g, 0, [k], 0);
  assert.equal(M(g, a), 5);
  assert.ok(hasKw(g, a, 'Deflect'));
  g = endTurn(g);
  assert.ok(!hasKw(g, a, 'Deflect'));
});

test('Harpoon Squad: +2 when moving from a battlefield (not from base)', () => {
  let g = game();
  const h = put(g, 0, 'sfd-137-221', 'base');
  g = moveUnits(g, 0, [h], 0);
  assert.equal(M(g, h), 4);
  g = endTurn(g); g = endTurn(g);
  g = moveUnits(g, 0, [h], 'base');
  assert.equal(M(g, h), 6);
});

test('Switcheroo: swap the Mights of two units at the same battlefield this turn', () => {
  let g = game();
  addRunes(g, 0, 6, 'Chaos');
  const a = put(g, 0, 't-u1', 0), b = put(g, 0, 't-u5', 0), c = put(g, 0, 't-u3', 1);
  put(g, 0, 't-u2', 0);   // META-AUDIT (MS-5): a third unit there, so the pair is a real choice (c alone is never offered)
  ({ g } = play(g, 0, 'sfd-145-221', undefined, [a, b]));
  assert.deepEqual([M(g, a), M(g, b), M(g, c)], [5, 1, 3]);
  g = endTurn(g);
  assert.deepEqual([M(g, a), M(g, b)], [1, 5]);
});

test('Switcheroo: units at different battlefields are rejected', () => {
  let g = game();
  addRunes(g, 0, 6, 'Chaos');
  const a = put(g, 0, 't-u1', 0), c = put(g, 0, 't-u3', 1);
  put(g, 0, 't-u2', 0);
  g = doAct(g, { type: 'playCard', player: 0, obj: handCard(g, 0, 'sfd-145-221') });
  assert.throws(() => doAct(g, { type: 'choose', player: 0, optionIds: [a, c] }));
});

test('Bonds of Strength: two friendly units each +1; Repeat', () => {
  let g = game();
  exhaustRunes(g, 0);
  addRunes(g, 0, 4, 'Order');
  const a = put(g, 0, 't-u1', 'base'), b = put(g, 0, 't-u1', 'base'), c = put(g, 0, 't-u1', 'base');
  ({ g } = play(g, 0, 'sfd-151-221', undefined, [a, b], 'yes', [b, c]));
  assert.deepEqual([M(g, a), M(g, b), M(g, c)], [2, 3, 2]);
});

test('Rally the Troops: units you play this turn get buffed; draw 1', () => {
  let g = game();
  addRunes(g, 0, 6, 'Order');
  const h = g.players[0].hand.length;
  ({ g } = play(g, 0, 'sfd-166-221', undefined));
  assert.equal(g.players[0].hand.length, h + 1);
  let r = play(g, 0, 't-u1', 'base');
  g = r.g;
  assert.equal(buffs(g, r.id), 1);
  r = play(g, 0, 't-u1', 'base');
  g = r.g;
  assert.equal(buffs(g, r.id), 1, 'every unit this turn');
  g = endTurn(g); g = endTurn(g);
  addRunes(g, 0, 2);
  r = play(g, 0, 't-u1', 'base');
  g = r.g;
  assert.equal(buffs(g, r.id), 0, 'expired');
});

test('Undertitan: your other units +2; [Add] [2] as it is revealed from your deck', () => {
  let g = game();
  addRunes(g, 0, 8, 'Order');
  const a = put(g, 0, 't-u1', 'base'), e = put(g, 1, 't-u1', 0);
  const r = play(g, 0, 'sfd-175-221', 'base');
  g = r.g;
  assert.deepEqual([M(g, a), M(g, e), M(g, r.id)], [3, 1, 5]);
  // reveal from deck
  let h = game();
  const top = put(h, 0, 'sfd-175-221', 'deckTop');
  const before = h.players[0].pool.energy;
  h = playObj(h, 0, handCard(h, 0, 't-b6-reveal'), undefined);
  void top;
  assert.equal(h.players[0].pool.energy, before + 2);
});

test('Fiora, Worthy: when a unit you control becomes Mighty, may pay [C] to ready it', () => {
  let g = game();
  exhaustRunes(g, 0);
  addRunes(g, 0, 2, 'Calm'); addRunes(g, 0, 1, 'Order');
  put(g, 0, 'sfd-180-221', 'base');
  const a = put(g, 0, 't-u4', 'base', { ready: false });
  ({ g } = play(g, 0, 'ogn-058-298', undefined, a, 'yes'));
  assert.equal(M(g, a), 6);
  assert.equal(ready(g, a), true);
});

test('Fiora, Worthy: a unit becoming Mighty through a buff triggers', () => {
  let g = game();
  exhaustRunes(g, 0);
  addRunes(g, 0, 2, 'Body'); addRunes(g, 0, 1, 'Order');
  put(g, 0, 'sfd-180-221', 'base');
  const a = put(g, 0, 't-u4', 'base', { ready: false });
  ({ g } = play(g, 0, 'ogn-136-298', 'base', a, 'yes'));
  assert.equal(M(g, a), 5);
  assert.equal(ready(g, a), true);
});

test('Danger Zone: your Mechs +1; Repeat [1][C]', () => {
  let g = game();
  exhaustRunes(g, 0);
  addRunes(g, 0, 4, 'Fury');
  const m = put(g, 0, 't-b6-mech', 'base'), u = put(g, 0, 't-u1', 'base'), em = put(g, 1, 't-b6-mech', 0);
  ({ g } = play(g, 0, 'sfd-182-221', undefined, 'yes'));
  assert.deepEqual([M(g, m), M(g, u), M(g, em)], [5, 1, 3]);
});

test('Defiant Dance: +2 to a unit and -2 to another unit (the second must differ)', () => {
  let g = game();
  addRunes(g, 0, 3, 'Calm');
  const a = put(g, 0, 't-u2', 'base'), e = put(g, 1, 't-u3', 0);
  g = doAct(g, { type: 'playCard', player: 0, obj: handCard(g, 0, 'sfd-196-221') }, a);
  // only one other unit remains for the second choice -> chosen automatically
  assert.deepEqual([M(g, a), M(g, e)], [4, 1]);
});

test('Defiant Dance: second choice excludes the first', () => {
  let g = game();
  addRunes(g, 0, 3, 'Calm');
  const a = put(g, 0, 't-u2', 'base'), b = put(g, 0, 't-u2', 'base'), e = put(g, 1, 't-u3', 0);
  g = doAct(g, { type: 'playCard', player: 0, obj: handCard(g, 0, 'sfd-196-221') }, a);
  assert.deepEqual(pendingIds(g).sort(), [b, e].sort());
  g = drive(g, e);
  assert.deepEqual([M(g, a), M(g, b), M(g, e)], [4, 2, 1]);
});

test('On the Hunt: ready your units', () => {
  let g = game();
  addRunes(g, 0, 3, 'Body');
  const a = put(g, 0, 't-u1', 'base', { ready: false }), e = put(g, 1, 't-u1', 0, { ready: false });
  ({ g } = play(g, 0, 'sfd-204-221', undefined));
  assert.equal(ready(g, a), true);
  assert.equal(ready(g, e), false);
});

void setController;

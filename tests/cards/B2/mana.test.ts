// B2: mana rocks and Add abilities.
import { test } from 'node:test';
import {
  game, mana, run, play, playNew, activate, canActivate, canPlay, put, handCard, zoneOf, assert, expectDecision, atMain, EMPOWER, readyRunes,
} from './util.ts';
import { getLegalActions } from '../../../src/engine/game.ts';

const SEALS: [string, string][] = [
  ['ogn-040-298', 'Fury'], ['ogn-081-298', 'Calm'], ['ogn-120-298', 'Mind'], ['ogn-163-298', 'Body'], ['ogn-204-298', 'Chaos'], ['ogn-245-298', 'Order'],
];

for (const [id, dom] of SEALS) {
  test(`Seal ${id}: [T]: Add [C] (${dom}) — immediate, no chain`, () => {
    let g = game();
    const s = put(g, 0, id, 'base');
    g = activate(g, 0, s, 0);
    assert.equal(g.chain.length, 0, 'Add abilities do not use the chain');
    assert.equal(g.players[0].pool.power[dom as 'Fury'], 1);
    assert.equal(g.objects[s].exhausted, true);
    assert.ok(!canActivate(g, 0, s, 0), 'exhausted: no second use');
  });
}

test('Seal of Rage pays a [C] Fury cost via the auto-payer', () => {
  let g = game();
  mana(g, 0, 0, 'Calm', 'Calm');             // no Fury rune: the [R] must come from the Seal
  const s = put(g, 0, 'ogn-040-298', 'base');
  const sd = handCard(g, 0, 'ogn-021-298');  // Sun Disc costs [2][R]
  assert.ok(canPlay(g, 0, sd), 'Sun Disc ([2][R]) is affordable with 2 Calm runes + Seal of Rage');
  const s2 = put(g, 0, 'ogn-081-298', 'base');
  g.objects[s].exhausted = true;
  assert.ok(!canPlay(g, 0, sd), 'Seal of Focus adds Calm, not Fury');
  g.objects[s].exhausted = false;
  void s2;
  g = run(play(g, 0, sd));
  assert.equal(zoneOf(g, sd), 'base');
  assert.equal(g.objects[s].exhausted, true);
});

test('Energy Conduit / Dragonsoul Sage: [T]: Add [1]', () => {
  let g = game();
  const c = put(g, 0, 'ogn-098-298', 'base');
  const sage = put(g, 0, 'unl-093-219', 'base');
  g = activate(g, 0, c, 0);
  g = activate(g, 0, sage, 0);
  assert.equal(g.players[0].pool.energy, 2);
});

test('Lux, Crownguard: [2] only for spells', () => {
  let g = game();
  const lux = put(g, 0, 'ogs-014-024', 'base');
  const unit = handCard(g, 0, 't-u2');
  const sp = handCard(g, 0, 'ts-pump');
  assert.ok(!canPlay(g, 0, unit), 'a unit cannot be paid with spell-only energy');
  assert.ok(canPlay(g, 0, sp), 'a spell can');
  g = activate(g, 0, lux, 0);
  assert.deepEqual(g.players[0].poolRestricted.map(r => [r.kind, r.amount, r.only]), [['energy', 2, 'spell']]);
});

test('Gold token: used by the auto-payer (kill this, [T]: add [A]) to pay a power cost', () => {
  let g = game();
  mana(g, 0, 0, 'Calm', 'Calm');                 // no Fury rune: the [R] can only come from the Gold's [A]
  const gold = put(g, 0, 'unl-t05', 'base');
  g.objects[gold].isToken = true;
  const sd = handCard(g, 0, 'ogn-021-298');      // Sun Disc [2][R]
  assert.ok(canPlay(g, 0, sd));
  g = run(play(g, 0, sd));
  assert.equal(zoneOf(g, sd), 'base');
  assert.equal(zoneOf(g, gold), 'gone', 'the Gold was killed for its cost (tokens cease to exist)');
});

test('Gold token: Kill this, [T]: Add [A]', () => {
  let g = game();
  const gold = put(g, 0, 'unl-t05', 'base');
  g.objects[gold].isToken = true;
  g = activate(g, 0, gold, 0);
  assert.equal(g.players[0].pool.power.Colorless, 1);
  assert.equal(zoneOf(g, gold), 'gone', 'token ceased to exist');
});

test('Malzahar: kill a friendly unit or gear and exhaust to add [A][A]; Action timing', () => {
  let g = game();
  const mz = put(g, 0, 'ogn-113-298', 'base');
  const fodder = put(g, 0, 't-u1', 'base');
  const gear = put(g, 0, 'ogn-098-298', 'base');
  g = activate(g, 0, mz, 0);
  const opts = expectDecision(g, 'chooseCards', 0);
  // RJ#6900: Malzahar himself is a legal choice too (exhaust him, then kill him)
  assert.ok(opts.includes(fodder) && opts.includes(gear) && opts.includes(mz), 'any friendly unit or gear, incl. Malzahar himself');
  g = run(g, gear);
  assert.equal(zoneOf(g, gear), 'trash');
  assert.equal(g.players[0].pool.power.Colorless, 2);
  // not usable on the opponent's turn outside a showdown (Action timing)
  let h = game();
  const mz2 = put(h, 1, 'ogn-113-298', 'base');
  put(h, 1, 't-u1', 'base');
  assert.ok(!canActivate(h, 1, mz2, 0));
});

test('Malzahar: with no other friendly unit or gear he can pay with himself (RJ#6900)', () => {
  let g = game();
  const mz = put(g, 0, 'ogn-113-298', 'base');
  assert.ok(canActivate(g, 0, mz, 0));
  g = activate(g, 0, mz, 0);
  assert.equal(zoneOf(g, mz), 'trash');
  assert.equal(g.players[0].pool.power.Colorless, 2);
});

test('Honeyfruit: enters exhausted; [T]: Add [A]; Level 6 adds [1][A] instead option', () => {
  let g = game();
  mana(g, 0, 2);
  let h: string;
  [g, h] = playNew(g, 0, 'unl-049-219');
  g = run(g);
  assert.equal(zoneOf(g, h), 'base');
  assert.equal(g.objects[h].exhausted, true, 'This enters exhausted');
  g.objects[h].exhausted = false;
  assert.ok(canActivate(g, 0, h, 1));
  assert.ok(!canActivate(g, 0, h, 2), 'Level 6 ability inactive below 6 XP');
  g.players[0].xp = 6;
  assert.ok(canActivate(g, 0, h, 2));
  g = activate(g, 0, h, 2);
  assert.equal(g.players[0].pool.energy, 1);
  assert.equal(g.players[0].pool.power.Colorless, 1);
});

test('Platewyrm Egg: enters exhausted; Add [1], or [2] once Empowered ([Empower] — [1], [T])', () => {
  let g = game();
  mana(g, 0, 3, 'Body');
  let egg: string;
  [g, egg] = playNew(g, 0, 'ven-075-166');
  g = run(g);
  assert.equal(g.objects[egg].exhausted, true);
  g.objects[egg].exhausted = false;
  assert.ok(canActivate(g, 0, egg, 1) && !canActivate(g, 0, egg, 2));
  mana(g, 0, 1);
  g = activate(g, 0, egg, EMPOWER);
  g = run(g);
  assert.equal(g.objects[egg].empowered, 1);
  assert.equal(g.objects[egg].exhausted, true, 'Empower cost exhausted it');
  g.objects[egg].exhausted = false;
  assert.ok(!canActivate(g, 0, egg, 1) && canActivate(g, 0, egg, 2));
  g = activate(g, 0, egg, 2);
  assert.equal(g.players[0].pool.energy, 2);
});

test('Hextech Anomaly: pay any amount of [A] to add that much Energy (player picks the amount)', () => {
  let g = game();
  mana(g, 0, 0, 'Fury', 'Calm', 'Mind');
  const a = put(g, 0, 'sfd-083-221', 'base');
  g = activate(g, 0, a, 0);
  const opts = expectDecision(g, 'chooseNumber', 0);
  assert.deepEqual(opts, ['0', '1', '2', '3']);
  g = run(g, '2');
  // 2 added + the two recycled runes' [1] each (rules-decisions #65: a recycled ready rune is exhausted first, its [1] floats)
  assert.equal(g.players[0].pool.energy, 4);
  assert.equal(g.players[0].runesInPlay.length, 1, 'two runes were recycled to pay [A][A]');
});

test('Ancient Henge: pay any amount of Energy to add that much [A]', () => {
  let g = game();
  mana(g, 0, 3);
  const h = put(g, 0, 'sfd-117-221', 'base');
  g = activate(g, 0, h, 0);
  assert.deepEqual(expectDecision(g, 'chooseNumber', 0), ['0', '1', '2', '3']);
  g = run(g, '3');
  assert.equal(g.players[0].pool.power.Colorless, 3);
  assert.equal(readyRunes(g, 0), 0);
  atMain(g);
  void getLegalActions;
});

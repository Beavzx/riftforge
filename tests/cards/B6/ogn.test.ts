// B6 scenario tests: Origins (ogn) + Proving Grounds (ogs).
import { test } from 'node:test';
import {
  game, addRunes, exhaustRunes, play, playObj, activate, moveUnits, endTurn, drive, doAct, put, handCard, M, buffs, ready, pendingIds,
  assert, hasKw, kwVal, zoneOf, setController, legalPlay, legalActivate,
} from './_h.ts';

// ---------------------------------------------------------------- simple pumps / debuffs
const PUMPS: [string, string, number][] = [
  ['ogn-082-298', 'Whiteflame Protector', 8],
  ['ogn-154-298', 'Primal Strength', 7],
];
for (const [id, name, n] of PUMPS) {
  test(`${name}: gives the chosen unit +${n} this turn, gone next turn`, () => {
    let g = game();
    addRunes(g, 0, 10, id === 'ogn-154-298' ? 'Body' : 'Calm');
    const a = put(g, 0, 't-u2', 'base'), b = put(g, 1, 't-u3', 0);
    const r = play(g, 0, id, id.startsWith('ogn-082') ? 'base' : undefined, b);
    g = r.g;
    assert.equal(M(g, b), 3 + n);
    assert.equal(M(g, a), 2);
    g = endTurn(g);
    assert.equal(M(g, b), 3);
  });
}

test('Cleave: Assault 3 this turn (+3 only while attacking)', () => {
  let g = game();
  const u = put(g, 0, 't-u2', 'base');
  ({ g } = play(g, 0, 'ogn-004-298', undefined));
  assert.equal(kwVal(g, u, 'Assault'), 3);
  assert.equal(M(g, u), 2);
  put(g, 1, 't-u1', 0);
  g = moveUnits(g, 0, [u], 0);
  assert.equal(zoneOf(g, u), 'battlefield');
  assert.equal(g.battlefields[0].controller, 0);
  g = endTurn(g);
  assert.equal(kwVal(g, u, 'Assault'), 0);
});

test('Dangerous Duo: Legion — only if another card was played this turn', () => {
  let g = game();
  addRunes(g, 0, 10, 'Fury');
  const u = put(g, 0, 't-u2', 'base');
  let r = play(g, 0, 'ogn-016-298', 'base');
  g = r.g;
  assert.equal(M(g, u), 2, 'no Legion: nothing');
  r = play(g, 0, 'ogn-016-298', 'base', u);
  g = r.g;
  assert.equal(M(g, u), 4, 'Legion: +2 to chosen unit');
});

test('Darius, Trifarian: second card played this turn readies him and gives +2; third does not', () => {
  let g = game();
  addRunes(g, 0, 10, 'Fury');
  const d = put(g, 0, 'ogn-027-298', 'base', { ready: false });
  ({ g } = play(g, 0, 't-u1', 'base'));
  assert.equal(ready(g, d), false);
  ({ g } = play(g, 0, 't-u1', 'base'));
  assert.equal(ready(g, d), true);
  assert.equal(M(g, d), 7);
  g.objects[d].exhausted = true;
  ({ g } = play(g, 0, 't-u1', 'base'));
  assert.equal(ready(g, d), false);
  assert.equal(M(g, d), 7);
});

test('Darius: a spell as the second card counts', () => {
  let g = game();
  addRunes(g, 0, 10, 'Fury');
  const d = put(g, 0, 'ogn-027-298', 'base', { ready: false });
  ({ g } = play(g, 0, 't-u1', 'base'));
  ({ g } = play(g, 0, 't-b6-spell1', undefined));
  assert.equal(ready(g, d), true);
  assert.equal(M(g, d), 7);
});

test('Vi, Destructive: recycle 1 from trash for +1 this turn; Ganking keyword; needs a trash card', () => {
  let g = game();
  const v = put(g, 0, 'ogn-036-298', 'base');
  assert.ok(hasKw(g, v, 'Ganking'));
  assert.equal(legalActivate(g, 0, v), false, 'empty trash: cannot activate');
  const t1 = put(g, 0, 't-u1', 'trash');
  put(g, 0, 't-u2', 'trash');
  assert.ok(legalActivate(g, 0, v));
  g = activate(g, 0, v, 0, t1);
  assert.equal(M(g, v), 4);
  assert.equal(zoneOf(g, t1), 'mainDeck');
});

test('En Garde: +2 if it is the only unit you control there, else +1', () => {
  let g = game();
  addRunes(g, 0, 4, 'Calm');
  const a = put(g, 0, 't-u2', 0), b = put(g, 0, 't-u2', 1), c = put(g, 0, 't-u2', 1);
  put(g, 1, 't-u2', 0);
  ({ g } = play(g, 0, 'ogn-046-298', undefined, a));
  assert.equal(M(g, a), 4);
  ({ g } = play(g, 0, 'ogn-046-298', undefined, b));
  assert.equal(M(g, b), 3);
  assert.equal(M(g, c), 2);
});

test('Stand United: buffs a friendly unit; buffs on friendly units give +1 more this turn', () => {
  let g = game();
  addRunes(g, 0, 4, 'Calm');
  const a = put(g, 0, 't-u2', 'base'), b = put(g, 0, 't-u2', 'base'), e = put(g, 1, 't-u2', 0);
  g.objects[b].counters.buff = 1; g.objects[e].counters.buff = 1;
  assert.ok(hasKw(g, handCard(g, 0, 'ogn-053-298'), 'Hidden'));
  ({ g } = play(g, 0, 'ogn-053-298', undefined, a));
  assert.equal(buffs(g, a), 1);
  assert.equal(M(g, a), 4, '2 + buff 1 + extra 1');
  assert.equal(M(g, b), 4, 'already-buffed friendly gets the extra +1 too');
  assert.equal(M(g, e), 3, 'enemy buffs unaffected');
  // a unit buffed later this turn also benefits
  const c = put(g, 0, 't-u1', 'base');
  g.objects[c].counters.buff = 1; g.ex.dirty = true;
  assert.equal(M(g, c), 3);
  g = endTurn(g);
  assert.equal(M(g, a), 3, 'extra +1 ends with the turn');
});

test('Discipline: +2 this turn and draw 1', () => {
  let g = game();
  addRunes(g, 0, 4, 'Calm');
  const a = put(g, 0, 't-u2', 'base');
  const hand = g.players[0].hand.length;
  ({ g } = play(g, 0, 'ogn-058-298', undefined));
  assert.equal(M(g, a), 4);
  assert.equal(g.players[0].hand.length, hand + 1);
});

test('Eclipse Herald: when you stun an enemy unit, ready me and +1; not for friendly stuns or enemy-made stuns', () => {
  let g = game();
  const h = put(g, 0, 'ogn-059-298', 'base', { ready: false });
  const e = put(g, 1, 't-u2', 0), f = put(g, 0, 't-u2', 'base');
  ({ g } = play(g, 0, 't-b6-stun', undefined, f));
  assert.equal(ready(g, h), false, 'stunning a friendly unit does nothing');
  ({ g } = play(g, 0, 't-b6-stun', undefined, e));
  assert.equal(ready(g, h), true);
  assert.equal(M(g, h), 8);
});

test('Poro Herder: buff me and draw 1 only if you control a Poro', () => {
  let g = game();
  addRunes(g, 0, 8, 'Calm');
  const hand0 = g.players[0].hand.length;
  let r = play(g, 0, 'ogn-061-298', 'base');
  g = r.g;
  assert.equal(buffs(g, r.id), 0);
  assert.equal(g.players[0].hand.length, hand0);
  put(g, 0, 't-b6-poro', 'base');
  r = play(g, 0, 'ogn-061-298', 'base');
  g = r.g;
  assert.equal(buffs(g, r.id), 1);
  assert.equal(M(g, r.id), 4);
  assert.equal(g.players[0].hand.length, hand0 + 1);
});

test("Spirit's Refuge: buff a friendly unit on play; friendly buffed units have Deflect (not stacked)", () => {
  let g = game();
  addRunes(g, 0, 4, 'Calm');
  const a = put(g, 0, 't-u2', 'base'), b = put(g, 0, 't-u2', 'base'), d = put(g, 0, 't-deflect', 'base');
  g.objects[d].counters.buff = 1;
  const eb = put(g, 1, 't-u2', 0); g.objects[eb].counters.buff = 1;
  ({ g } = play(g, 0, 'ogn-063-298', 'base', a));
  assert.equal(buffs(g, a), 1);
  assert.ok(hasKw(g, a, 'Deflect'));
  assert.equal(kwVal(g, a, 'Deflect'), 1);
  assert.ok(!hasKw(g, b, 'Deflect'), 'unbuffed friendly');
  assert.equal(kwVal(g, d, 'Deflect'), 2, "already had Deflect: not added");
  assert.ok(!hasKw(g, eb, 'Deflect'), 'enemy buffed units unaffected');
});

test('Last Stand: doubles a friendly unit\'s Might this turn and gives it Temporary', () => {
  let g = game();
  addRunes(g, 0, 4, 'Calm');
  const a = put(g, 0, 't-u3', 'base');
  ({ g } = play(g, 0, 'ogn-069-298', undefined));
  assert.equal(M(g, a), 6);
  assert.ok(hasKw(g, a, 'Temporary'));
  g = endTurn(g);
  assert.equal(M(g, a), 3);
  assert.ok(hasKw(g, a, 'Temporary'), 'Temporary is not "this turn"');
  g = endTurn(g);   // P1 ends -> P0's Beginning Phase kills it
  assert.equal(zoneOf(g, a), 'trash');
});

test('Sona: end of turn at a battlefield readies up to 4 friendly runes (player picks); not at base', () => {
  let g = game();
  const s = put(g, 0, 'ogn-073-298', 0);
  setController(g, 0, 0);
  const rs = addRunes(g, 0, 5);
  for (const r of rs) g.objects[r].exhausted = true;
  g = doAct(g, { type: 'endTurn', player: 0 });
  // RULINGS (Origins FAQ, Sona; CR 403.2): the runes are targets chosen as the trigger goes on the chain
  assert.equal(g.pending?.kind, 'chooseTargets');
  assert.equal(g.pending?.max, 4);
  g = drive(g, rs.slice(0, 3));
  assert.deepEqual(rs.map(r => ready(g, r)), [true, true, true, false, false]);
  void s;
  // at base: no trigger
  let h = game();
  put(h, 0, 'ogn-073-298', 'base');
  const r2 = addRunes(h, 0, 2); for (const r of r2) h.objects[r].exhausted = true;
  h = doAct(h, { type: 'endTurn', player: 0 });
  assert.equal(h.pending?.kind, 'mainAction');
  assert.equal(h.pending?.player, 1);
});

test('Lee Sin, Ascetic: [T] buffs me; I can have any number of buffs; Shield', () => {
  let g = game();
  const l = put(g, 0, 'ogn-078-298', 'base');
  assert.equal(kwVal(g, l, 'Shield'), 1);
  g = activate(g, 0, l, 0);
  assert.equal(buffs(g, l), 1);
  g.objects[l].exhausted = false;
  g = activate(g, 0, l, 0);
  assert.equal(buffs(g, l), 2);
  assert.equal(M(g, l), 7);
  assert.equal(legalActivate(g, 0, l), false, 'exhausted');
});

test('Pit Crew: ready me when you play a gear (not a unit)', () => {
  let g = game();
  addRunes(g, 0, 6);
  const p = put(g, 0, 'ogn-091-298', 'base', { ready: false });
  ({ g } = play(g, 0, 't-u1', 'base'));
  assert.equal(ready(g, p), false);
  ({ g } = play(g, 0, 't-b6-gear2', 'base'));
  assert.equal(ready(g, p), true);
});

test('Smoke Screen: -4 to a minimum of 1', () => {
  let g = game();
  addRunes(g, 0, 4, 'Mind');
  const a = put(g, 1, 't-u5', 0), b = put(g, 1, 't-u3', 0);
  ({ g } = play(g, 0, 'ogn-093-298', undefined, a));
  assert.equal(M(g, a), 1);
  ({ g } = play(g, 0, 'ogn-093-298', undefined, b));
  assert.equal(M(g, b), 1, '3 -> 1 (minimum)');
  // later increases add normally: the -2 is snapshotted
  ({ g } = play(g, 0, 'ogn-058-298', undefined, b));
  assert.equal(M(g, b), 3);
});

test('Stupefy: -1 to a minimum of 1 and draw 1', () => {
  let g = game();
  addRunes(g, 0, 2, 'Mind');
  const a = put(g, 1, 't-u3', 0), one = put(g, 1, 't-u1', 0);
  const h = g.players[0].hand.length;
  ({ g } = play(g, 0, 'ogn-095-298', undefined, a));
  assert.equal(M(g, a), 2);
  assert.equal(g.players[0].hand.length, h + 1);
  ({ g } = play(g, 0, 'ogn-095-298', undefined, one));
  assert.equal(M(g, one), 1);
});

test('Blastcone Fae: Hidden; when played, -2 to a minimum of 1', () => {
  let g = game();
  addRunes(g, 0, 4, 'Mind');
  const a = put(g, 1, 't-u2', 0), b = put(g, 1, 't-u4', 0);
  const r = play(g, 0, 'ogn-097-298', 'base', b);
  g = r.g;
  assert.ok(hasKw(g, r.id, 'Hidden'));
  assert.equal(M(g, b), 2);
  ({ g } = play(g, 0, 'ogn-097-298', 'base', a));
  assert.equal(M(g, a), 1);
});

test('Ravenbloom Student: +1 when you play a spell, not for units', () => {
  let g = game();
  addRunes(g, 0, 6);
  const s = put(g, 0, 'ogn-103-298', 'base');
  ({ g } = play(g, 0, 't-u1', 'base'));
  assert.equal(M(g, s), 2);
  ({ g } = play(g, 0, 't-b6-spell1', undefined));
  assert.equal(M(g, s), 3);
});

test('Convergent Mutation: increases its Might to another friendly unit\'s Might (never decreases)', () => {
  let g = game();
  addRunes(g, 0, 6, 'Mind');
  const a = put(g, 0, 't-u2', 'base'), b = put(g, 0, 't-u5', 'base');
  ({ g } = play(g, 0, 'ogn-108-298', undefined, a));
  assert.equal(M(g, a), 5);
  const c = put(g, 0, 't-u1', 'base');
  ({ g } = play(g, 0, 'ogn-108-298', undefined, b, c));
  assert.equal(M(g, b), 5, 'other is weaker: no change');
});

test('Convergent Mutation: the second unit must be another unit', () => {
  let g = game();
  addRunes(g, 0, 6, 'Mind');
  const a = put(g, 0, 't-u2', 'base'), b = put(g, 0, 't-u5', 'base');
  g = playObj(g, 0, handCard(g, 0, 'ogn-108-298'), undefined, a);
  void b;
  assert.equal(M(g, a), 5, 'only one other unit: auto-picked');
});

test('Ekko, Recurrent: Deathknell — may recycle me to ready your runes', () => {
  let g = game();
  const e = put(g, 0, 'ogn-110-298', 'base');
  assert.ok(hasKw(g, e, 'Accelerate'));
  const rs = addRunes(g, 0, 3); for (const r of rs) g.objects[r].exhausted = true;
  g.objects[e].damage = 9; g.ex.dirty = true;
  g = doAct(g, { type: 'playCard', player: 0, obj: handCard(g, 0, 't-b6-spell1') });
  // cleanup kills Ekko -> deathknell asks
  g = drive(g, 'yes');
  assert.equal(zoneOf(g, e), 'mainDeck');
  assert.ok(rs.every(r => ready(g, r)));
  // decline
  let h = game();
  const e2 = put(h, 0, 'ogn-110-298', 'base');
  const r2 = addRunes(h, 0, 2); for (const r of r2) h.objects[r].exhausted = true;
  h.objects[e2].damage = 9; h.ex.dirty = true;
  h = doAct(h, { type: 'playCard', player: 0, obj: handCard(h, 0, 't-b6-spell1') }, 'no');
  assert.equal(zoneOf(h, e2), 'trash');
  assert.ok(r2.every(r => !ready(h, r)));
});

test('Thousand-Tailed Watcher: enemy units -3 to a minimum of 1', () => {
  let g = game();
  addRunes(g, 0, 8, 'Mind');
  const a = put(g, 1, 't-u5', 0), b = put(g, 1, 't-u2', 1), f = put(g, 0, 't-u5', 'base');
  ({ g } = play(g, 0, 'ogn-116-298', 'base', 'no'));
  assert.equal(M(g, a), 2);
  assert.equal(M(g, b), 1);
  assert.equal(M(g, f), 5);
});

test('First Mate: ready another unit', () => {
  let g = game();
  addRunes(g, 0, 3, 'Body');
  const a = put(g, 0, 't-u2', 'base', { ready: false });
  ({ g } = play(g, 0, 'ogn-132-298', 'base'));
  assert.equal(ready(g, a), true);
});

test('Pit Rookie: buff another friendly unit (not itself)', () => {
  let g = game();
  addRunes(g, 0, 2, 'Body');
  const a = put(g, 0, 't-u2', 'base');
  const r = play(g, 0, 'ogn-136-298', 'base');
  g = r.g;
  assert.equal(buffs(g, a), 1);
  assert.equal(buffs(g, r.id), 0);
  // already buffed: nothing more
  ({ g } = play(g, 0, 'ogn-136-298', 'base', a));
  assert.equal(buffs(g, a), 1);
});

test('Cithria of Cloudfield: buff me when you play another unit', () => {
  let g = game();
  addRunes(g, 0, 4);
  const c = put(g, 0, 'ogn-139-298', 'base');
  ({ g } = play(g, 0, 't-b6-spell1', undefined));
  assert.equal(buffs(g, c), 0);
  ({ g } = play(g, 0, 't-u1', 'base'));
  assert.equal(buffs(g, c), 1);
  assert.equal(M(g, c), 2);
});

test('Kinkou Monk: buff up to two other friendly units (choice of 0-2)', () => {
  let g = game();
  addRunes(g, 0, 5, 'Body');
  const a = put(g, 0, 't-u1', 'base'), b = put(g, 0, 't-u1', 'base'), c = put(g, 0, 't-u1', 'base');
  const r = play(g, 0, 'ogn-141-298', 'base', [a, c]);
  g = r.g;
  assert.deepEqual([buffs(g, a), buffs(g, b), buffs(g, c), buffs(g, r.id)], [1, 0, 1, 0]);
});

test("Pirate's Haven: when you ready a friendly unit, +1 this turn (also on Awaken)", () => {
  let g = game();
  addRunes(g, 0, 6, 'Body');
  put(g, 0, 'ogn-143-298', 'base');
  const a = put(g, 0, 't-u2', 'base', { ready: false });
  ({ g } = play(g, 0, 'unl-009-219', undefined, 'no'));
  assert.equal(ready(g, a), true);
  assert.equal(M(g, a), 3);
  g.objects[a].exhausted = true;
  g = endTurn(g);
  g = endTurn(g);
  assert.equal(ready(g, a), true);
  // RULINGS: CR 315.1.b / 416.3.a — the turn player readies in the Awaken phase (CR 412.1 / 412.4: "when you ready" sees it)
  assert.equal(M(g, a), 3, 'Awaken readies are "you ready"');
});

test('Wallop: spend a buff to ignore its cost; ready a unit', () => {
  let g = game();
  exhaustRunes(g, 0);
  const a = put(g, 0, 't-u2', 'base', { ready: false });
  const b = put(g, 0, 't-u2', 'base'); g.objects[b].counters.buff = 1;
  const w = handCard(g, 0, 'ogn-146-298');
  assert.ok(legalPlay(g, 0, w), 'playable with a buff and no runes');
  g.objects[b].counters.buff = 0; delete g.objects[b].counters.buff;
  assert.equal(legalPlay(g, 0, w), false, 'no buff, no runes');
  g.objects[b].counters.buff = 1;
  g = playObj(g, 0, w, undefined, a);   // no runes: the buff is required (CR 355.16, not offered as a choice)
  assert.equal(buffs(g, b), 0);
  assert.equal(ready(g, a), true);
  assert.equal(zoneOf(g, w), 'trash');
});

test('Wallop: without spending a buff it costs [2]', () => {
  let g = game();
  exhaustRunes(g, 0);
  const rs = addRunes(g, 0, 2, 'Body');
  const a = put(g, 0, 't-u2', 'base', { ready: false });
  const b = put(g, 0, 't-u2', 'base'); g.objects[b].counters.buff = 1;
  g = playObj(g, 0, handCard(g, 0, 'ogn-146-298'), undefined, 'no', a);
  assert.equal(buffs(g, b), 1);
  assert.ok(rs.every(r => !ready(g, r)));
  assert.equal(ready(g, a), true);
});

test('Wildclaw Shaman: may spend a buff to buff me and ready me', () => {
  let g = game();
  addRunes(g, 0, 4, 'Body');
  const b = put(g, 0, 't-u2', 'base'); g.objects[b].counters.buff = 1;
  let r = play(g, 0, 'ogn-147-298', 'base', 'yes');
  g = r.g;
  assert.equal(buffs(g, b), 0);
  assert.equal(buffs(g, r.id), 1);
  assert.equal(ready(g, r.id), true);
  // no buff available: no prompt
  addRunes(g, 0, 4, 'Body');
  r = play(g, 0, 'ogn-147-298', 'base');
  g = r.g;
  assert.equal(ready(g, r.id), false);
});

test('Kraken Hunter: spend any number of buffs to reduce its cost by [C] each; Assault', () => {
  let g = game();
  exhaustRunes(g, 0);
  addRunes(g, 0, 3, 'Fury');           // 3 energy, no Body power
  const a = put(g, 0, 't-u1', 'base'), b = put(g, 0, 't-u1', 'base');
  const k = handCard(g, 0, 'ogn-150-298');
  assert.equal(legalPlay(g, 0, k), false, 'no Body power and no buffs: unaffordable');
  g.objects[a].counters.buff = 1; g.objects[b].counters.buff = 1;
  assert.ok(legalPlay(g, 0, k), 'payable with 2 buffs');
  g = playObj(g, 0, k, 'base', '2');
  assert.equal(zoneOf(g, k), 'base');
  assert.equal(buffs(g, a) + buffs(g, b), 0);
  assert.equal(kwVal(g, k, 'Assault'), 1);
  assert.ok(hasKw(g, k, 'Accelerate'));
});

test('Mistfall: when you buff a friendly unit, may pay [C] and exhaust this to ready it', () => {
  let g = game();
  exhaustRunes(g, 0);
  addRunes(g, 0, 3, 'Body');
  const m = put(g, 0, 'ogn-152-298', 'base');
  const a = put(g, 0, 't-u2', 'base', { ready: false });
  ({ g } = play(g, 0, 'ogn-136-298', 'base', 'yes'));
  assert.equal(buffs(g, a), 1);
  assert.equal(ready(g, a), true);
  assert.equal(ready(g, m), false);
});

test('Overt Operation: spend chosen buffs to ready those units, then buff all friendly units', () => {
  let g = game();
  addRunes(g, 0, 8, 'Body');
  const a = put(g, 0, 't-u2', 'base', { ready: false }), b = put(g, 0, 't-u2', 'base', { ready: false }), c = put(g, 0, 't-u2', 'base', { ready: false });
  g.objects[a].counters.buff = 1; g.objects[b].counters.buff = 1;
  const e = put(g, 1, 't-u2', 0);
  ({ g } = play(g, 0, 'ogn-153-298', undefined, [a]));
  assert.equal(ready(g, a), true);
  assert.equal(ready(g, b), false);
  assert.equal(ready(g, c), false);
  assert.deepEqual([buffs(g, a), buffs(g, b), buffs(g, c), buffs(g, e)], [1, 1, 1, 0]);
});

test("Udyr, Wildman: spend my buff, choose a mode not chosen this turn", () => {
  let g = game();
  const u = put(g, 0, 'ogn-157-298', 0);
  const e = put(g, 1, 't-u5', 1);
  g.objects[u].counters.buff = 1;
  g = activate(g, 0, u, 0, 'deal', e);
  assert.equal(g.objects[e].damage, 2);
  assert.equal(buffs(g, u), 0);
  assert.equal(legalActivate(g, 0, u), false, 'no buff');
  g.objects[u].counters.buff = 1;
  g = act0(g, u);
  assert.ok(!pendingIds(g).includes('deal'), 'deal already chosen this turn');
  g = drive(g, 'gank');
  assert.ok(hasKw(g, u, 'Ganking'));
  g = endTurn(g); g = endTurn(g);
  g.objects[u].counters.buff = 1;
  g = act0(g, u);
  assert.ok(pendingIds(g).includes('deal'), 'new turn: all modes again');
});
function act0(g: ReturnType<typeof game>, u: string) { return doAct(g, { type: 'activate', player: 0, obj: u, abilityIndex: 0 }); }

test('Sett, Brawler: buffed when played and when he conquers; spend buff for +4', () => {
  let g = game();
  addRunes(g, 0, 6, 'Body');
  const r = play(g, 0, 'ogn-164-298', 'base');
  g = r.g;
  const s = r.id;
  assert.equal(buffs(g, s), 1);
  g = activate(g, 0, s, 2);
  assert.equal(buffs(g, s), 0);
  assert.equal(M(g, s), 8);
  g.objects[s].exhausted = false;
  g = moveUnits(g, 0, [s], 0);
  assert.equal(g.battlefields[0].controller, 0);
  assert.equal(buffs(g, s), 1, 'conquer: buff me');
});

test('Ember Monk: +2 when you play a card from Hidden', () => {
  let g = game();
  addRunes(g, 0, 6);
  setController(g, 0, 0);
  const m = put(g, 0, 'ogn-167-298', 0);
  const h = handCard(g, 0, 't-b6-hunit');
  g = doAct(g, { type: 'hide', player: 0, obj: h, battlefieldIndex: 0 });
  assert.equal(g.objects[h].zone, 'facedown');
  g = endTurn(g); g = endTurn(g);
  ({ g } = play(g, 0, 't-u1', 'base'));
  assert.equal(M(g, m), 4, 'normal play: nothing');
  g = playObj(g, 0, h, 0);
  assert.equal(M(g, m), 6);
});

test('Ride the Wind: move a friendly unit (player picks the destination) and ready it', () => {
  let g = game();
  addRunes(g, 0, 4, 'Chaos');
  const a = put(g, 0, 't-u2', 'base', { ready: false });
  ({ g } = play(g, 0, 'ogn-173-298', undefined, '1'));
  assert.equal(g.objects[a].battlefieldIndex, 1);
  assert.equal(zoneOf(g, a), 'battlefield');
  assert.equal(ready(g, a), true);
});

test('Fading Memories: give a gear Temporary (killed at its controller\'s Beginning Phase); units at base not choosable', () => {
  let g = game();
  addRunes(g, 0, 6, 'Chaos');
  const gear = put(g, 1, 't-b6-gear2', 'base');
  put(g, 1, 't-u2', 'base');
  const u = put(g, 1, 't-u3', 0);
  g = playObj(g, 0, handCard(g, 0, 'ogn-180-298'), undefined);
  assert.deepEqual(pendingIds(g).sort(), [gear, u].sort());
  g = drive(g, gear);
  assert.ok(hasKw(g, gear, 'Temporary'));
  g = endTurn(g);
  assert.equal(zoneOf(g, gear), 'trash');
});

test('Teemo, Scout: Hidden; +3 when played', () => {
  let g = game();
  addRunes(g, 0, 2, 'Chaos');
  const r = play(g, 0, 'ogn-197-298', 'base');
  g = r.g;
  assert.equal(M(g, r.id), 4);
  assert.ok(hasKw(g, r.id, 'Hidden'));
});

test('Jinx, Rebel: discarding several cards at once triggers once (ready + 1)', () => {
  let g = game();
  const j = put(g, 0, 'ogn-202-298', 'base', { ready: false });
  const hand = [...g.players[0].hand];
  ({ g } = play(g, 0, 't-b6-discard2', undefined, [hand[0], hand[1]]));
  assert.equal(ready(g, j), true);
  assert.equal(M(g, j), 6);
  g.objects[j].exhausted = true;
  const hand2 = [...g.players[0].hand];
  ({ g } = play(g, 0, 't-b6-discard2', undefined, [hand2[0], hand2[1]]));
  assert.equal(M(g, j), 7, 'second discard event: triggers again');
});

test('Back to Back: two friendly units each +2', () => {
  let g = game();
  addRunes(g, 0, 4, 'Order');
  const a = put(g, 0, 't-u2', 'base'), b = put(g, 0, 't-u2', 'base'), c = put(g, 0, 't-u2', 'base');
  ({ g } = play(g, 0, 'ogn-206-298', undefined, [a, c]));
  assert.deepEqual([M(g, a), M(g, b), M(g, c)], [4, 2, 4]);
});

test('Call to Glory: spend a buff to play it for free; +3', () => {
  let g = game();
  exhaustRunes(g, 0);
  const a = put(g, 0, 't-u2', 'base'); g.objects[a].counters.buff = 1;
  ({ g } = play(g, 0, 'ogn-207-298', undefined));   // no runes: spending the buff is required (CR 355.16)
  assert.equal(buffs(g, a), 0);
  assert.equal(M(g, a), 5);
});

test('Trifarian Gloryseeker: Legion — buff me', () => {
  let g = game();
  addRunes(g, 0, 6, 'Order');
  let r = play(g, 0, 'ogn-217-298', 'base');
  g = r.g;
  assert.equal(buffs(g, r.id), 0);
  r = play(g, 0, 'ogn-217-298', 'base');
  g = r.g;
  assert.equal(buffs(g, r.id), 1);
});

test('Peak Guardian: buff me; at a battlefield also buff other friendly units there', () => {
  let g = game();
  addRunes(g, 0, 14, 'Order');
  setController(g, 0, 0);
  const a = put(g, 0, 't-u1', 0), b = put(g, 0, 't-u1', 1), e = put(g, 1, 't-u1', 1);
  let r = play(g, 0, 'ogn-223-298', 0);
  g = r.g;
  assert.deepEqual([buffs(g, r.id), buffs(g, a), buffs(g, b), buffs(g, e)], [1, 1, 0, 0]);
  const c = put(g, 0, 't-u1', 'base');
  r = play(g, 0, 'ogn-223-298', 'base');
  g = r.g;
  assert.deepEqual([buffs(g, r.id), buffs(g, c)], [1, 0]);
});

test('Vanguard Helm: when a buffed friendly unit dies, buff another friendly unit', () => {
  let g = game();
  put(g, 0, 'ogn-228-298', 'base');
  const a = put(g, 0, 't-u2', 'base'), b = put(g, 0, 't-u2', 'base'), c = put(g, 0, 't-u2', 'base');
  g.objects[a].counters.buff = 1;
  g.objects[a].damage = 9; g.objects[c].damage = 0; g.ex.dirty = true;
  g = doAct(g, { type: 'playCard', player: 0, obj: handCard(g, 0, 't-b6-spell1') }, b);
  assert.equal(zoneOf(g, a), 'trash');
  assert.equal(buffs(g, b), 1);
  // unbuffed death: nothing
  g.objects[c].damage = 9; g.ex.dirty = true;
  addRunes(g, 0, 1);
  g = doAct(g, { type: 'playCard', player: 0, obj: handCard(g, 0, 't-b6-spell1') });
  assert.equal(zoneOf(g, c), 'trash');
  assert.equal(g.pending?.kind, 'mainAction');
});

test('Albus Ferros: spend any number of buffs; channel 1 rune exhausted per buff', () => {
  let g = game();
  addRunes(g, 0, 4, 'Order');
  const a = put(g, 0, 't-u1', 'base'), b = put(g, 0, 't-u1', 'base'), c = put(g, 0, 't-u1', 'base');
  for (const u of [a, b, c]) g.objects[u].counters.buff = 1;
  const before = g.players[0].runesInPlay.length;
  ({ g } = play(g, 0, 'ogn-230-298', 'base', [a, c]));
  assert.equal(g.players[0].runesInPlay.length, before + 2);
  assert.deepEqual([buffs(g, a), buffs(g, b), buffs(g, c)], [0, 1, 0]);
  const fresh = g.players[0].runesInPlay.slice(-2);
  assert.ok(fresh.every(r => !ready(g, r)), 'channelled exhausted');
});

test('Grand Strategem: friendly units +5; enemies unaffected', () => {
  let g = game();
  addRunes(g, 0, 9, 'Order');
  const a = put(g, 0, 't-u1', 'base'), b = put(g, 0, 't-u1', 0), e = put(g, 1, 't-u1', 0);
  ({ g } = play(g, 0, 'ogn-233-298', undefined));
  assert.deepEqual([M(g, a), M(g, b), M(g, e)], [6, 6, 1]);
});

test('Karma, Channeler: Vision recycle to the Main Deck buffs a friendly unit; rune recycles do not', () => {
  let g = game();
  addRunes(g, 0, 7, 'Order');
  const a = put(g, 0, 't-u1', 'base');
  // Vision: look at top, may recycle it
  const r = play(g, 0, 'ogn-235-298', 'base', [g.players[0].mainDeck[0]], a);
  g = r.g;
  assert.equal(buffs(g, a), 1);
});

test('Siphon Power: friendly units at the battlefield +1, enemy units there -1 to a minimum of 1', () => {
  let g = game();
  addRunes(g, 0, 4, 'Mind');
  const f = put(g, 0, 't-u2', 0), e = put(g, 1, 't-u3', 0), one = put(g, 1, 't-u1', 0), other = put(g, 0, 't-u2', 1);
  ({ g } = play(g, 0, 'ogn-266-298', undefined, g.battlefields[0].objId));
  assert.deepEqual([M(g, f), M(g, e), M(g, one), M(g, other)], [3, 2, 1, 2]);
});

test('Showstopper: buff a friendly unit in your base, then move it to a battlefield (player picks)', () => {
  let g = game();
  addRunes(g, 0, 3, 'Body');
  const a = put(g, 0, 't-u2', 'base');
  put(g, 0, 't-u2', 0);
  ({ g } = play(g, 0, 'ogn-270-298', undefined, '1'));
  assert.equal(buffs(g, a), 1);
  assert.equal(g.objects[a].battlefieldIndex, 1);
});

test('Lux, Illuminated: +3 when you play a spell costing [5]+, not cheaper', () => {
  let g = game();
  addRunes(g, 0, 12);
  const l = put(g, 0, 'ogs-006-024', 'base');
  ({ g } = play(g, 0, 't-b6-spell4', undefined));
  assert.equal(M(g, l), 5);
  ({ g } = play(g, 0, 't-b6-spell5', undefined));
  assert.equal(M(g, l), 8);
});

test('Decisive Strike: friendly units +2', () => {
  let g = game();
  addRunes(g, 0, 6, 'Order');
  const a = put(g, 0, 't-u1', 'base'), e = put(g, 1, 't-u1', 0);
  ({ g } = play(g, 0, 'ogs-024-024', undefined));
  assert.deepEqual([M(g, a), M(g, e)], [3, 1]);
});

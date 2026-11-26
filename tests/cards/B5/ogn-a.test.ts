// B5 tests: Origins, part A (damage spells, counters, unit triggers)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { game, mana, rich, run, answer, expectDecision, cast, play, canPlay, respond, toPriority, activate, canActivate, moveTo, dmg, handSize, M, put, handCard, zoneOf, setController, hasKw, noRunes, act, pass } from './util.ts';

// ---------------- Disintegrate ----------------
test('Disintegrate: deals 3 to a unit at a battlefield; draws if it kills', () => {
  let g = game(); rich(g, 0);
  const t = put(g, 1, 't-u3', 0);
  const base = put(g, 1, 't-u2', 'base');
  const h = handSize(g, 0);
  let r = cast(g, 0, 'ogn-005-298'); g = run(r.g);          // only the battlefield unit is legal: auto-chosen
  assert.equal(zoneOf(g, t), 'trash');
  assert.equal(zoneOf(g, base), 'base');
  assert.equal(handSize(g, 0), h + 1);
  assert.ok(hasKw(g, r.id, 'Action'));
});
test('Disintegrate: no draw when the unit survives', () => {
  let g = game(); rich(g, 0);
  const t = put(g, 1, 't-u4', 0);
  const h = handSize(g, 0);
  g = run(cast(g, 0, 'ogn-005-298').g);
  assert.equal(dmg(g, t), 3);
  assert.equal(handSize(g, 0), h);
});

// ---------------- Get Excited! ----------------
test('Get Excited!: discard a card and deal its Energy cost (ignoring Power)', () => {
  let g = game(); rich(g, 0);
  const t = put(g, 1, 't-u5', 0);
  for (const id of [...g.players[0].hand]) g.players[0].hand.splice(g.players[0].hand.indexOf(id), 1), delete g.objects[id];
  const four = handCard(g, 0, 't-u4');
  const calm = handCard(g, 0, 't-calm2');          // 2 energy + 1 power
  let r = cast(g, 0, 'ogn-008-298');
  g = run(r.g);
  expectDecision(g, 'chooseCards', 0);              // discard choice on resolution
  g = run(g, four);
  assert.equal(zoneOf(g, four), 'trash');
  assert.equal(dmg(g, t), 4);
  assert.equal(zoneOf(g, calm), 'hand');
});
test('Get Excited!: with an empty hand nothing is dealt', () => {
  let g = game(); rich(g, 0);
  const t = put(g, 1, 't-u5', 0);
  for (const id of [...g.players[0].hand]) g.players[0].hand.splice(g.players[0].hand.indexOf(id), 1), delete g.objects[id];
  g = run(cast(g, 0, 'ogn-008-298').g);
  assert.equal(dmg(g, t), 0);
});

// ---------------- Hextech Ray / Falling Comet / Void Seeker / Incinerate-like ----------------
for (const [id, n, draws] of [['ogn-009-298', 3, 0], ['ogn-085-298', 6, 0], ['ogn-024-298', 4, 1]] as const) {
  test(`${id}: deals ${n} to a unit at a battlefield${draws ? ' and draws 1' : ''}; base units are not legal`, () => {
    let g = game(); rich(g, 0);
    const t = put(g, 1, 't-u5', 0);
    put(g, 1, 't-u5', 'base');
    const h = handSize(g, 0);
    const r = cast(g, 0, id);
    g = run(r.g);
    if (n >= 5) assert.equal(zoneOf(g, t), 'trash'); else assert.equal(dmg(g, t), n);
    assert.equal(handSize(g, 0), h + draws);
  });
}

// ---------------- Sky Splitter ----------------
test('Sky Splitter: Energy cost reduced by the highest Might among my units', () => {
  let g = game();
  noRunes(g, 0);
  mana(g, 0, 3, 'Fury');                       // 3 energy, Fury power
  const s = handCard(g, 0, 'ogn-014-298');      // costs 8 + Fury
  const t = put(g, 1, 't-u5', 0);
  assert.equal(canPlay(g, 0, s), false);
  put(g, 0, 't-u5', 'base');                    // highest Might 5 -> costs 3
  put(g, 0, 't-u2', 'base');
  assert.equal(canPlay(g, 0, s), true);
  g = run(play(g, 0, s));
  assert.equal(zoneOf(g, t), 'trash');
});

// ---------------- Thermo Beam ----------------
test('Thermo Beam: kills all gear (both players), not units', () => {
  let g = game(); rich(g, 0);
  const g1 = put(g, 0, 'ts-sword', 'base'), g2 = put(g, 1, 'ts-gold', 'base');
  const u = put(g, 1, 't-u2', 'base');
  g = run(cast(g, 0, 'ogn-022-298').g);
  assert.equal(zoneOf(g, g1), 'trash');
  assert.equal(zoneOf(g, g2), 'trash');
  assert.equal(zoneOf(g, u), 'base');
});

// ---------------- Falling Star / Icathian Rain / Final Spark ----------------
// RULINGS (Spiritforged FAQ): Falling Star = two "Deal 3 to a unit.", Icathian Rain = six "Deal 2 to a unit."; every target is
// chosen up front and the same unit may be chosen for several instructions.
for (const [id, n, k] of [['ogn-029-298', 3, 2], ['ogn-248-298', 2, 6], ['ogs-022-024', 8, 1]] as const) {
  test(`${id}: deals ${n} to any unit (base allowed)${k > 1 ? `, ${k} times` : ''}`, () => {
    let g = game(); rich(g, 0);
    const t = put(g, 1, 't-u5', 'base'), t2 = put(g, 1, 't-u2', 'base');
    const big = put(g, 1, 't-u5', 0);
    const r = cast(g, 0, id);
    expectDecision(r.g, 'chooseTargets', 0);
    // first instruction on t, the rest on t2 (different units allowed)
    g = run(r.g, t, ...new Array(k - 1).fill(t2));
    assert.equal(n >= 5 ? zoneOf(g, t) : String(dmg(g, t)), n >= 5 ? 'trash' : String(n));
    if (k > 1) assert.equal(zoneOf(g, t2), 'trash', 'the later instructions hit the second unit');
    assert.equal(dmg(g, big), 0);
  });
}

// ---------------- Shakedown ----------------
test('Shakedown: the enemy controller decides — refuse: 6 damage', () => {
  let g = game(); rich(g, 0);
  const t = put(g, 1, 't-u5', 'base');
  const h = handSize(g, 0);
  g = run(cast(g, 0, 'ogn-033-298').g);
  expectDecision(g, 'optional', 1);
  g = run(g, 'no');
  assert.equal(zoneOf(g, t), 'trash');
  assert.equal(handSize(g, 0), h);
});
test('Shakedown: the enemy controller lets me draw 2 instead', () => {
  let g = game(); rich(g, 0);
  const t = put(g, 1, 't-u5', 'base');
  const h = handSize(g, 0);
  g = run(cast(g, 0, 'ogn-033-298').g, );
  g = run(g, 'yes');
  assert.equal(dmg(g, t), 0);
  assert.equal(handSize(g, 0), h + 2);
});
test('Shakedown: only enemy units can be chosen', () => {
  let g = game(); rich(g, 0);
  const mine = put(g, 0, 't-u5', 'base');
  const s = handCard(g, 0, 'ogn-033-298');
  assert.equal(canPlay(g, 0, s), false);
  void mine;
});

// ---------------- Volibear, Furious ----------------
test('Volibear: when he attacks, 5 damage split among enemy units here', () => {
  let g = game();
  setController(g, 0, 1);
  const v = put(g, 0, 'ogn-041-298', 'base');
  const a = put(g, 1, 't-u3', 0), b = put(g, 1, 't-u4', 0);
  const far = put(g, 1, 't-u1', 1);
  g = moveTo(g, 0, [v], 0);
  g = run(g);
  expectDecision(g, 'chooseTargets', 0);
  assert.ok(!(g.pending!.options ?? []).some(o => o.id === far));
  g = run(g, [a, b]);
  expectDecision(g, 'chooseNumber', 0);
  g = run(g, '3');                                 // 3 to a, 2 to b
  assert.equal(zoneOf(g, a), 'trash');
  assert.equal(zoneOf(g, b), 'trash');              // 2 damage + 9 combat damage
  assert.ok(hasKw(g, v, 'Deflect'));
});
test('Volibear: split onto a single unit puts all 5 there', () => {
  let g = game();
  setController(g, 0, 1);
  const v = put(g, 0, 'ogn-041-298', 'base');
  const a = put(g, 1, 't-shield', 0), b = put(g, 1, 't-u5', 0);
  g = run(moveTo(g, 0, [v], 0), [b]);
  assert.equal(zoneOf(g, b), 'trash');
  void a;
});

// ---------------- Defy / Wind Wall / Hush ----------------
test('Defy: counters a spell costing at most [4] and [A]', () => {
  let g = game(); rich(g, 0); rich(g, 1);
  const t = put(g, 1, 't-u3', 0);
  const ray = handCard(g, 0, 'ogn-009-298');      // 1 + Fury
  const defy = handCard(g, 1, 'ogn-045-298');
  g = toPriority(play(g, 0, ray), 1);
  assert.equal(canPlay(g, 1, defy), true);
  g = run(play(g, 1, defy));
  assert.equal(dmg(g, t), 0);
  assert.equal(zoneOf(g, ray), 'trash');
});
test('Defy: cannot counter a 5-energy spell or a [A][A] spell', () => {
  let g = game(); rich(g, 0); rich(g, 1);
  put(g, 1, 't-u3', 0);
  const comet = handCard(g, 0, 'ogn-085-298');    // 5 energy
  const defy = handCard(g, 1, 'ogn-045-298');
  g = toPriority(play(g, 0, comet), 1);
  assert.equal(g.pending?.player, 1);
  assert.equal(canPlay(g, 1, defy), false);
  let g2 = game(); rich(g2, 0); rich(g2, 1);
  const fs = handCard(g2, 0, 'ogn-029-298');      // 2 energy + 2 power
  put(g2, 1, 't-u3', 'base');
  const defy2 = handCard(g2, 1, 'ogn-045-298');
  g2 = play(g2, 0, fs);
  g2 = toPriority(g2, 1);
  assert.equal(canPlay(g2, 1, defy2), false);
});
test('Wind Wall: counters any spell', () => {
  let g = game(); rich(g, 0); rich(g, 1);
  const t = put(g, 1, 't-u3', 0);
  const comet = handCard(g, 0, 'ogn-085-298');
  const ww = handCard(g, 1, 'ogn-064-298');
  g = run(respond(play(g, 0, comet), 1, ww));
  assert.equal(dmg(g, t), 0);
  assert.equal(zoneOf(g, comet), 'trash');
});
test('Hush: only spells with Power cost [A][A] or more', () => {
  let g = game(); rich(g, 0); rich(g, 1);
  const t = put(g, 1, 't-u3', 0);
  const comet = handCard(g, 0, 'ogn-085-298');    // no power
  const hush = handCard(g, 1, 'rad-041-167');
  g = toPriority(play(g, 0, comet), 1);
  assert.equal(canPlay(g, 1, hush), false);
  let g2 = game(); rich(g2, 0); rich(g2, 1);
  const t2 = put(g2, 1, 't-u5', 'base');
  const fs = handCard(g2, 0, 'ogn-029-298');      // power 2
  const hush2 = handCard(g2, 1, 'rad-041-167');
  g2 = toPriority(play(g2, 0, fs), 1);
  assert.equal(canPlay(g2, 1, hush2), true);
  g2 = run(play(g2, 1, hush2));
  assert.equal(dmg(g2, t2), 0);
  void t;
});

// ---------------- Adaptatron ----------------
test('Adaptatron: when it conquers, may kill a gear; if it does, it is buffed', () => {
  let g = game();
  const a = put(g, 0, 'ogn-056-298', 'base');
  const gear = put(g, 1, 'ts-gold', 'base');
  g = moveTo(g, 0, [a], 0);
  g = run(g);
  expectDecision(g, 'optional', 0);
  g = run(g, 'yes');                              // single gear: auto-chosen
  assert.equal(zoneOf(g, gear), 'trash');
  assert.equal(M(g, a), 4);
  assert.equal(g.objects[a].counters.buff, 1);
});
test('Adaptatron: declining kills nothing and gives no buff', () => {
  let g = game();
  const a = put(g, 0, 'ogn-056-298', 'base');
  const gear = put(g, 1, 'ts-gold', 'base');
  g = run(moveTo(g, 0, [a], 0), 'no');
  assert.equal(zoneOf(g, gear), 'base');
  assert.equal(M(g, a), 3);
});

// ---------------- Caitlyn, Patrolling ----------------
test('Caitlyn: [T] deals her Might to a unit at a battlefield, only while she is at a battlefield', () => {
  let g = game();
  setController(g, 0, 0);
  const c = put(g, 0, 'ogn-068-298', 'base');
  const t = put(g, 1, 't-u5', 1);
  assert.equal(canActivate(g, 0, c), false);           // at base
  g.objects[c].zone = 'battlefield'; g.objects[c].battlefieldIndex = 0; g.players[0].base = g.players[0].base.filter(x => x !== c);
  assert.equal(canActivate(g, 0, c), true);
  g = run(activate(g, 0, c), t);           // Caitlyn herself is also a unit at a battlefield
  assert.equal(dmg(g, t), 3);
  assert.equal(g.objects[c].exhausted, true);
  assert.ok(hasKw(g, c, 'Backline'), 'must be assigned combat damage last');
});

// ---------------- Yasuo, Remorseful ----------------
test('Yasuo: when he attacks, deals damage equal to his Might to an enemy unit here', () => {
  let g = game();
  const y = put(g, 0, 'ogn-076-298', 'base');
  const e1 = put(g, 1, 't-u5', 0), e2 = put(g, 1, 't-tank', 0);
  g = run(moveTo(g, 0, [y], 0));
  expectDecision(g, 'chooseTargets', 0);
  g = run(g, e1);
  assert.equal(zoneOf(g, e1), 'trash');
  assert.equal(zoneOf(g, e2), 'trash');                // then 6 combat damage kills the tank
});

// ---------------- Mystic Reversal ----------------
test('Mystic Reversal: gain control of a spell and make new choices', () => {
  let g = game(); rich(g, 0); rich(g, 1); mana(g, 1, 2, 'Calm');
  const mine = put(g, 1, 't-u4', 'base');
  const theirs = put(g, 0, 't-u4', 'base');
  const fs = handCard(g, 0, 'ogn-029-298');
  const mr = handCard(g, 1, 'ogn-080-298');
  g = answer(play(g, 0, fs), mine, mine);          // Falling Star: two instructions (both on the same unit)
  g = run(respond(g, 1, mr));
  expectDecision(g, 'optional', 1);
  g = run(g, 'yes', theirs, theirs);
  assert.equal(dmg(g, mine), 0);
  assert.equal(zoneOf(g, theirs), 'trash', '6 damage after the new choices');
});
test('Mystic Reversal: gaining control without new choices keeps the targets', () => {
  let g = game(); rich(g, 0); rich(g, 1); mana(g, 1, 2, 'Calm');
  const a = put(g, 1, 't-u4', 'base');
  put(g, 0, 't-u4', 'base');
  const fs = handCard(g, 0, 'ogn-029-298');
  const mr = handCard(g, 1, 'ogn-080-298');
  g = answer(play(g, 0, fs), a, a);
  g = run(respond(g, 1, mr), 'no');
  assert.equal(zoneOf(g, a), 'trash', 'kept both targets: 6 damage');
});

// ---------------- Riptide Rex ----------------
test('Riptide Rex: when played, deals 6 to an enemy unit at a battlefield', () => {
  let g = game(); rich(g, 0);
  const t = put(g, 1, 't-u5', 1);
  put(g, 1, 't-u5', 'base');
  const r = cast(g, 0, 'ogn-092-298', { destination: 'base' });
  g = run(r.g);
  assert.equal(zoneOf(g, t), 'trash');
  assert.equal(zoneOf(g, r.id), 'base');
});

// ---------------- Retreat ----------------
test('Retreat: return a friendly unit; its owner channels 1 rune exhausted', () => {
  let g = game(); rich(g, 0);
  const u = put(g, 0, 't-u3', 0);
  const before = g.players[0].runesInPlay.length;
  g = run(cast(g, 0, 'ogn-104-298').g);
  assert.equal(zoneOf(g, u), 'hand');
  assert.equal(g.players[0].runesInPlay.length, before + 1);
  const newest = g.players[0].runesInPlay[g.players[0].runesInPlay.length - 1];
  assert.equal(g.objects[newest].exhausted, true);
});

// ---------------- Singularity ----------------
test('Singularity: 6 to each of up to two units (zero targets allowed)', () => {
  let g = game(); rich(g, 0);
  const a = put(g, 1, 't-u5', 'base'), b = put(g, 1, 't-u5', 0), c = put(g, 1, 't-u5', 1);
  g = run(cast(g, 0, 'ogn-105-298').g, [a, c]);
  assert.equal(zoneOf(g, a), 'trash');
  assert.equal(zoneOf(g, c), 'trash');
  assert.equal(zoneOf(g, b), 'battlefield');
  let g2 = game(); rich(g2, 0);
  const d = put(g2, 1, 't-u5', 'base');
  g2 = run(cast(g2, 0, 'ogn-105-298').g, []);
  assert.equal(dmg(g2, d), 0);
});

// ---------------- Unchecked Power ----------------
test('Unchecked Power: exhausts friendly units, then 12 to all units at battlefields', () => {
  let g = game(); rich(g, 0);
  const myBase = put(g, 0, 't-u2', 'base');
  const myBf = put(g, 0, 't-u5', 0);
  const theirBf = put(g, 1, 't-u5', 1), theirBase = put(g, 1, 't-u5', 'base');
  g = run(cast(g, 0, 'ogn-123-298').g);
  assert.equal(g.objects[myBase].exhausted, true);
  assert.equal(zoneOf(g, myBf), 'trash');
  assert.equal(zoneOf(g, theirBf), 'trash');
  assert.equal(dmg(g, theirBase), 0);
  assert.equal(g.objects[theirBase].exhausted, false);
});

// ---------------- Cannon Barrage ----------------
test('Cannon Barrage: 2 to all enemy units in combat (as a reaction during combat)', () => {
  let g = game(); rich(g, 1);
  const atk = put(g, 0, 't-u5', 'base');
  const def = put(g, 1, 't-u5', 0);
  const other = put(g, 0, 't-u2', 1);
  g = moveTo(g, 0, [atk], 0);
  // P0 has focus first in the showdown and passes; P1 plays Cannon Barrage
  assert.equal(g.pending?.kind, 'showdownAction');
  const cb = handCard(g, 1, 'ogn-127-298');
  g = run(respond(g, 1, cb));
  assert.equal(zoneOf(g, atk), 'trash');               // 2 + 5 combat damage
  assert.equal(dmg(g, other), 0);
  void def;
});

// ---------------- Challenge ----------------
test('Challenge: a friendly and an enemy unit deal their Mights to each other', () => {
  let g = game(); rich(g, 0);
  const f = put(g, 0, 't-u4', 'base'), e = put(g, 1, 't-u3', 'base');
  g = run(cast(g, 0, 'ogn-128-298').g);
  assert.equal(zoneOf(g, e), 'trash');
  assert.equal(dmg(g, f), 3);
});

// ---------------- Crackshot Corsair ----------------
test('Crackshot Corsair: when it attacks, 1 to an enemy unit here', () => {
  let g = game();
  const c = put(g, 0, 'ogn-130-298', 'base');
  const e = put(g, 1, 't-u1', 0), e2 = put(g, 1, 't-tank', 0);
  g = run(moveTo(g, 0, [c], 0), e);
  assert.equal(zoneOf(g, e), 'trash');
  void e2;
});

// ---------------- Flurry of Blades ----------------
test('Flurry of Blades: 1 to all units at battlefields (mine too), not bases', () => {
  let g = game(); rich(g, 0);
  const a = put(g, 0, 't-u1', 0), b = put(g, 1, 't-u2', 1), c = put(g, 1, 't-u1', 'base');
  g = run(cast(g, 0, 'ogn-133-298').g);
  assert.equal(zoneOf(g, a), 'trash');
  assert.equal(dmg(g, b), 1);
  assert.equal(dmg(g, c), 0);
});

// ---------------- Unyielding Spirit ----------------
test('Unyielding Spirit: spell and ability damage is prevented this turn; combat damage is not', () => {
  let g = game(); rich(g, 0); rich(g, 1);
  const t = put(g, 1, 't-u3', 0);
  const comet = handCard(g, 0, 'ogn-085-298');
  const us = handCard(g, 1, 'ogn-145-298');
  g = run(respond(play(g, 0, comet), 1, us));
  assert.equal(dmg(g, t), 0);
  assert.equal(zoneOf(g, t), 'battlefield');
  // later this turn: a second damage spell is prevented too
  const ray = handCard(g, 0, 'ogn-009-298');
  g = run(play(g, 0, ray));
  assert.equal(dmg(g, t), 0);
  // combat damage still happens
  const atk = put(g, 0, 't-u5', 'base');
  g = run(moveTo(g, 0, [atk], 0));
  assert.equal(zoneOf(g, t), 'trash');
});
test('Unyielding Spirit: the prevention ends with the turn', () => {
  let g = game(); rich(g, 0);
  const t = put(g, 1, 't-u5', 'base');
  g = run(cast(g, 0, 'ogn-145-298').g);
  g = run(act(g, { type: 'endTurn', player: 0 }));
  // now P1's turn: P1 zaps their own unit? use P1 casting Final Spark on own unit
  rich(g, 1);
  const fs = handCard(g, 1, 'ogs-022-024');
  g = run(play(g, 1, fs));
  assert.equal(zoneOf(g, t), 'trash');
});

// ---------------- Anivia ----------------
test('Anivia: when she attacks, 3 to all enemy units here', () => {
  let g = game();
  const a = put(g, 0, 'ogn-148-298', 'base');
  const e1 = put(g, 1, 't-u3', 0), e2 = put(g, 1, 't-u3', 0), far = put(g, 1, 't-u3', 1);
  g = run(moveTo(g, 0, [a], 0));
  assert.equal(zoneOf(g, e1), 'trash');
  assert.equal(zoneOf(g, e2), 'trash');
  assert.equal(dmg(g, far), 0);
  assert.equal(dmg(g, a), 0);
});

// ---------------- Carnivorous Snapvine ----------------
test('Carnivorous Snapvine: when played, fights an enemy unit at a battlefield', () => {
  let g = game(); rich(g, 0);
  const e = put(g, 1, 't-u4', 1);
  put(g, 1, 't-u2', 'base');
  const r = cast(g, 0, 'ogn-149-298', { destination: 'base' });
  g = run(r.g);
  assert.equal(zoneOf(g, e), 'trash');
  assert.equal(dmg(g, r.id), 4);
});

// ---------------- Gust / Rebuke ----------------
test('Gust: returns a unit at a battlefield with 3 Might or less', () => {
  let g = game(); rich(g, 0);
  const small = put(g, 1, 't-u3', 0);
  put(g, 1, 't-u4', 0); put(g, 1, 't-u1', 'base');
  g = run(cast(g, 0, 'ogn-169-298').g);
  assert.equal(zoneOf(g, small), 'hand');
});
test('Rebuke: returns any unit at a battlefield to its owner\'s hand', () => {
  let g = game(); rich(g, 0);
  const big = put(g, 1, 't-u5', 0);
  g = run(cast(g, 0, 'ogn-172-298').g);
  assert.equal(zoneOf(g, big), 'hand');
  assert.ok(g.players[1].hand.includes(big));
});

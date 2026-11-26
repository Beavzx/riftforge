// B5 tests: engine keywords printed on batch cards, and extra duration / timing edges.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  game, mana, rich, run, answer, expectDecision, cast, play, canPlay, respond, toPriority, moveTo, dmg, handSize, M, put, handCard,
  zoneOf, setController, hasKw, noRunes, act, getLegalActions,
} from './util.ts';

test('Deflect (Dune Devourer / Volibear): an opponent pays [A] per Deflect to choose it', () => {
  const spent = (target: string) => {
    let g = game();
    noRunes(g, 0); mana(g, 0, 4, 'Order'); mana(g, 0, 2, 'Fury');
    const t = put(g, 1, target, 'base');
    const before = g.players[0].runesInPlay.length;
    g = run(play(g, 0, handCard(g, 0, 'ogn-229-298')));   // Vengeance: 4 + Order Order
    assert.equal(zoneOf(g, t), 'trash');
    return before - g.players[0].runesInPlay.length;      // runes recycled for power
  };
  assert.equal(spent('t-u5'), 2);
  assert.equal(spent('rad-125-167'), 3);                    // Deflect: +[A]
  assert.equal(spent('ogn-041-298'), 4);                    // Deflect 2: +[A][A]
});

test('Ganking (Commander Ledros): can move from battlefield to battlefield', () => {
  const g = game();
  const l = put(g, 0, 'ogn-231-298', 0);
  const u = put(g, 0, 't-u2', 0);
  const moves = getLegalActions(g, 0).filter(a => a.type === 'move');
  assert.ok(moves.some(a => a.type === 'move' && a.units.includes(l) && a.to === 1));
  assert.ok(!moves.some(a => a.type === 'move' && a.units.includes(u) && a.to === 1));
});

test('Accelerate + Assault 3 (Mordekaiser, Twice Slain): may enter ready; +3 Might while attacking', () => {
  let g = game(); rich(g, 0);
  const m = handCard(g, 0, 'rad-020-167');
  g = play(g, 0, m, { destination: 'base' });
  expectDecision(g, 'optional', 0);                    // Accelerate?
  g = run(g, 'yes');
  assert.equal(g.objects[m].exhausted, false);
  put(g, 1, 't-u5', 0);
  g = moveTo(g, 0, [m], 0);
  assert.equal(M(g, m), 8);
});

test('Shield 3 + Tank (Armored Tusker): +3 Might while defending; must be assigned damage first', () => {
  let g = game();
  const t = put(g, 1, 'rad-078-167', 0);
  const other = put(g, 1, 't-u1', 0);
  const atk = put(g, 0, 't-u5', 'base'), atk2 = put(g, 0, 't-u4', 'base');
  g = moveTo(g, 0, [atk, atk2], 0);
  assert.equal(M(g, t), 7);
  g = run(g);
  assert.equal(zoneOf(g, t), 'trash');                // 9 damage: tank (7) first, then 2 to the other
  assert.equal(zoneOf(g, other), 'trash');
});

test('Smite: the banish replacement ends with the turn', () => {
  let g = game(); rich(g, 0);
  const t = put(g, 1, 't-u5', 0);
  g = run(cast(g, 0, 'unl-007-219').g);
  g = run(act(g, { type: 'endTurn', player: 0 }));
  rich(g, 1);
  g = run(cast(g, 1, 'ogn-229-298').g);                     // only unit: auto
  assert.equal(zoneOf(g, t), 'trash');
});

test('Siphoning Strike: a unit that survives and dies on a later turn channels nothing', () => {
  let g = game(); noRunes(g, 0); mana(g, 0, 4, 'Calm');
  const t = put(g, 1, 't-u5', 0);
  g = run(cast(g, 0, 'ven-146-166').g);
  g = run(act(g, { type: 'endTurn', player: 0 }));
  const r0 = g.players[0].runesInPlay.length;
  rich(g, 1);
  g = run(cast(g, 1, 'ogn-229-298').g);
  assert.equal(zoneOf(g, t), 'trash');
  assert.equal(g.players[0].runesInPlay.length, r0);
});

test('Lilting Lullaby: the spell lock ends with the turn', () => {
  let g = game(); rich(g, 0); rich(g, 1); mana(g, 1, 1, 'Calm', 'Mind');
  put(g, 1, 't-u3', 0);
  const comet = handCard(g, 0, 'ogn-085-298');
  const ll = handCard(g, 1, 'unl-190-219');
  g = run(respond(play(g, 0, comet), 1, ll));
  g = run(act(g, { type: 'endTurn', player: 0 }));
  g = run(act(g, { type: 'endTurn', player: 1 }));
  rich(g, 0);
  const ray = handCard(g, 0, 'ogn-133-298');
  assert.equal(canPlay(g, 0, ray), true);
});

test('Mystic Reversal on a spell without choices: no "new choices" prompt', () => {
  let g = game(); rich(g, 0); rich(g, 1); mana(g, 1, 2, 'Calm');
  const a = put(g, 0, 't-u1', 0);
  const flurry = handCard(g, 0, 'ogn-133-298');
  const mr = handCard(g, 1, 'ogn-080-298');
  g = run(respond(play(g, 0, flurry), 1, mr));
  assert.equal(zoneOf(g, a), 'trash');
  assert.equal(g.pending?.kind, 'mainAction');
});

test('Fox-Fire from hiding: choices are restricted to its battlefield', () => {
  let g = game(); rich(g, 0); setController(g, 0, 0);
  put(g, 0, 't-u3', 0);
  const ff = handCard(g, 0, 'ogn-256-298');
  g = act(g, { type: 'hide', player: 0, obj: ff, battlefieldIndex: 0 });
  g = run(act(g, { type: 'endTurn', player: 0 }));
  const atk = put(g, 1, 't-u2', 'base');
  const far = put(g, 1, 't-u1', 1);
  g = moveTo(g, 1, [atk], 0);
  g = toPriority(g, 0);
  g = play(g, 0, ff);
  const opts = expectDecision(g, 'chooseTargets', 0);
  assert.ok(opts.includes(atk) && !opts.includes(far));
  g = run(g, atk);                                           // nothing else fits (3-Might unit: 2 + 3 > 4)
  assert.equal(zoneOf(g, atk), 'trash');
  assert.equal(zoneOf(g, far), 'battlefield');
});

test('King\'s Edict needs no target: with no units the opponent chooses nothing', () => {
  let g = game(); rich(g, 0);
  g = run(cast(g, 0, 'ogn-237-298').g);
  assert.equal(g.pending?.kind, 'mainAction');
  void handSize; void dmg; void answer; void hasKw;
});

test('Disintegrate + Elder Dragon: 3 damage kills a 5-Might enemy, so "if this kills it" draws', () => {
  let g = game(); rich(g, 0);
  put(g, 0, 'unl-118-219', 'base');
  const t = put(g, 1, 't-u5', 0);
  const h = handSize(g, 0);
  g = run(cast(g, 0, 'ogn-005-298').g);
  assert.equal(zoneOf(g, t), 'trash');
  assert.equal(handSize(g, 0), h + 1);
});

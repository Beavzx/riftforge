// B8 battlefields (Origins): conquer / hold / defend triggers, statics and rule hooks.
import { test } from 'node:test';
import {
  assert, game, setBf, moveIn, endTurn, put, runes, handCard, resolveAll, zoneOf, setController, yes, no, choose, act, play,
  expectPending, optIds, might, hasKw, getLegalActions, exhaustRunes, readyCount, pendingPrompt,
} from './b8-util.ts';
import { victoryScore } from '../../../src/engine/rules.ts';
import { moveToZone } from '../../../src/engine/state.ts';
import { chosenChampion } from '../../../src/cards/helpers/B8.ts';
import type { GameState, ObjId, PlayerId } from '../../../src/engine/types.ts';

/** P0 controls bf with a unit there; play continues to P0's next turn (hold). Returns state at the first decision. */
function setupHold(cardId: string, bf = 1, unitCard = 't-u2'): { g: GameState; u: ObjId } {
  let g = game();
  setBf(g, bf, cardId);
  setController(g, bf, 0);
  const u = put(g, 0, unitCard, bf);
  g = endTurn(g);          // P1's turn
  g = endTurn(g);          // P0's turn: hold
  return { g, u };
}

test("Aspirant's Climb: the Victory Score is 9; 8 points doesn't win", () => {
  let g = game();
  assert.equal(victoryScore(g), 8);
  setBf(g, 1, 'ogn-276-298');
  assert.equal(victoryScore(g), 9);
  g.players[0].points = 8; g.ex.dirty = true;
  g = endTurn(g);
  assert.equal(g.winner, null);
  g.players[1].points = 9; g.ex.dirty = true;
  g = endTurn(g);
  assert.equal(g.winner, 1);
});

test('Back-Alley Bar: a unit moving from here gets +1 this turn; one moving here does not', () => {
  let g = game();
  setBf(g, 1, 'ogn-277-298');
  setController(g, 1, 0);
  const a = put(g, 0, 't-u2', 1);
  g = act(g, { type: 'move', player: 0, units: [a], to: 'base' });
  g = resolveAll(g);
  assert.equal(might(g, a), 3);
  const b = put(g, 0, 't-u2', 'base');
  g = act(g, { type: 'move', player: 0, units: [b], to: 1 });
  g = resolveAll(g);
  assert.equal(might(g, b), 2);
  g = endTurn(g);
  assert.equal(might(g, a), 2, 'expires at end of turn');
});

test('Bandle Tree: you may hide an additional card here (two facedown cards)', () => {
  let g = game();
  setBf(g, 1, 'ogn-278-298');
  setController(g, 1, 0); setController(g, 0, 0);
  put(g, 0, 't-u1', 1); put(g, 0, 't-u1', 0);
  runes(g, 0, 4);
  const h1 = handCard(g, 0, 't-hidden'), h2 = handCard(g, 0, 't-hidden');
  g = act(g, { type: 'hide', player: 0, obj: h1, battlefieldIndex: 1 });
  assert.ok(getLegalActions(g, 0).some(a => a.type === 'hide' && a.obj === h2 && a.battlefieldIndex === 1), 'second hide allowed here');
  g = act(g, { type: 'hide', player: 0, obj: h2, battlefieldIndex: 0 });
  const h3 = handCard(g, 0, 't-hidden');
  assert.ok(!getLegalActions(g, 0).some(a => a.type === 'hide' && a.obj === h3 && a.battlefieldIndex === 0), 'normal battlefield: one only');
  assert.ok(getLegalActions(g, 0).some(a => a.type === 'hide' && a.obj === h3 && a.battlefieldIndex === 1));
});

test('Fortified Position: the defender chooses a unit; it gains Shield 2 this combat', () => {
  let g = game({ firstPlayer: 1 });
  setBf(g, 0, 'ogn-279-298');           // owned by P0; P1 attacks it
  setController(g, 0, 0);
  const d = put(g, 0, 't-u2', 0);
  const a = put(g, 1, 't-u3', 'base');
  g = act(g, { type: 'move', player: 1, units: [a], to: 0 });
  for (let i = 0; i < 6 && g.pending?.kind !== 'chooseTargets'; i++) g = resolveAll(g.pending?.inStep ? choose(g, g.pending.options![0].id) : g);
  expectPending(g, 'chooseTargets', /Shield 2/);
  assert.equal(g.pending!.player, 0, 'the defending player chooses');
  g = choose(g, d);
  // RULINGS sweep / CR 403.2: the unit is chosen as the trigger goes on the chain; Shield 2 comes on resolution
  assert.deepEqual(g.chain.at(-1)?.targets, [[d]], 'the trigger on the chain targets the chosen unit');
  g = resolveAll(g);
  assert.equal(zoneOf(g, a), 'trash', 'attacker (3) dies to the 2+2 defender');
  assert.equal(zoneOf(g, d), 'battlefield');
  assert.equal(hasKw(g, d, 'Shield'), false, 'Shield 2 ends with the combat');
});

test('Grove of the God-Willow: holding here draws 1', () => {
  let { g } = setupHold('ogn-280-298');
  const h = g.players[0].hand.length;     // the Draw Phase comes after the hold trigger
  g = resolveAll(g);
  assert.equal(g.players[0].hand.length, h + 2);
});

test('Grove of the God-Willow: conquering does not draw', () => {
  let g = game();
  setBf(g, 1, 'ogn-280-298');
  const h = g.players[0].hand.length;
  g = moveIn(g, 0, 1).g;
  assert.equal(g.players[0].hand.length, h);
});

test('Hallowed Tomb: may return the Chosen Champion from trash to an empty Champion Zone', () => {
  for (const answer of ['yes', 'no']) {
    let g = game();
    setBf(g, 1, 'ogn-281-298');
    setController(g, 1, 0);
    put(g, 0, 't-u2', 1);
    const ch = g.players[0].championZone[0];
    assert.equal(chosenChampion({ g } as never, 0), ch);
    moveToZone(g, ch, 'trash');
    g = endTurn(g); g = endTurn(g);
    g = resolveAll(g);
    expectPending(g, 'optional', /Champion Zone/);
    g = resolveAll(answer === 'yes' ? yes(g) : no(g));   // the "you may" is decided as the trigger is chained (principle 11)
    assert.equal(zoneOf(g, ch), answer === 'yes' ? 'championZone' : 'trash');
  }
});

test('Hallowed Tomb: nothing to ask when the champion is not in the trash', () => {
  let { g } = setupHold('ogn-281-298');
  g = resolveAll(g);
  assert.equal(g.pending?.kind, 'mainAction');
});

test('Monastery of Hirana: the conquering player (not the owner) may spend a buff to draw 1', () => {
  let g = game();
  setBf(g, 1, 'ogn-282-298');            // owned by P1
  const u = put(g, 0, 't-u2', 'base');
  g.objects[u].counters.buff = 1;
  const h = g.players[0].hand.length;
  g = act(g, { type: 'move', player: 0, units: [u], to: 1 });
  g = resolveAll(g);
  expectPending(g, 'optional', /buff/);
  assert.equal(g.pending!.player, 0);
  g = yes(g);
  // RULINGS sweep / CR 383.3.b: the buff is spent as the trigger goes on the chain (base cost); the draw is on resolution
  assert.equal(g.objects[u].counters.buff ?? 0, 0, 'buff spent before resolution');
  assert.equal(g.players[0].hand.length, h);
  g = resolveAll(g);
  assert.equal(g.players[0].hand.length, h + 1);
});

test('Monastery of Hirana: no buff, no question', () => {
  let g = game();
  setBf(g, 1, 'ogn-282-298');
  g = moveIn(g, 0, 1).g;
  assert.equal(g.pending?.kind, 'mainAction');
});

test('Navori Fighting Pit: holding buffs a unit here', () => {
  let { g, u } = setupHold('ogn-283-298');
  g = resolveAll(g);
  assert.equal(g.objects[u].counters.buff, 1);
  assert.equal(might(g, u), 3);
});

test("Obelisk of Power: each player's first Beginning Phase channels 1 extra rune (only the first)", () => {
  let g = game();
  setBf(g, 1, 'ogn-284-298');
  assert.equal(g.players[1].runesInPlay.length, 0);
  g = endTurn(g);
  g = resolveAll(g);
  assert.equal(g.players[1].runesInPlay.length, 4, '1 (Obelisk) + 3 (second player channel)');
  const p0 = g.players[0].runesInPlay.length;
  g = endTurn(g); g = resolveAll(g);
  assert.equal(g.players[0].runesInPlay.length, p0 + 2, 'not on later Beginning Phases');
});

test("Reckoner's Arena: holding activates the conquer effects of your units here", () => {
  let { g } = setupHold('ogn-286-298', 1, 'b8-conq');
  const h = g.players[0].hand.length;
  g = resolveAll(g);
  assert.equal(g.players[0].hand.length, h + 2, "the unit's conquer effect resolved (+ Draw Phase)");
});

test("Reckoner's Arena: units without conquer effects do nothing", () => {
  let { g } = setupHold('ogn-286-298', 1, 't-u2');
  const h = g.players[0].hand.length;
  g = resolveAll(g);
  assert.equal(g.players[0].hand.length, h + 1, 'Draw Phase only');
});

test('Sigil of the Storm: conquering here recycles one of your runes (picked, not optional)', () => {
  let g = game();
  setBf(g, 1, 'ogn-287-298');
  const before = g.players[0].runesInPlay.length, deck = g.players[0].runeDeck.length;
  g = moveIn(g, 0, 1).g;
  expectPending(g, 'chooseCards', /Recycle one of your runes/);
  assert.equal(g.pending!.min, 1);
  g = choose(g, g.pending!.options![0].id);
  assert.equal(g.players[0].runesInPlay.length, before - 1);
  assert.equal(g.players[0].runeDeck.length, deck + 1);
});

test('Startipped Peak: holding may channel 1 rune exhausted', () => {
  for (const ans of ['yes', 'no']) {
    let { g } = setupHold('ogn-288-298');
    // RJ#1451 / CR 383.3.a: the "you may" is asked as the hold trigger goes on the chain, before any priority round
    expectPending(g, 'optional', /channel 1 rune exhausted/i);
    const n = g.players[0].runesInPlay.length;
    g = ans === 'yes' ? yes(g) : no(g);
    g = resolveAll(g);
    // the Channel Phase (2 ready runes) follows the hold trigger
    assert.equal(g.players[0].runesInPlay.length, n + 2 + (ans === 'yes' ? 1 : 0));
    assert.equal(g.players[0].runesInPlay.filter(r => g.objects[r].exhausted).length >= (ans === 'yes' ? 1 : 0), true);
  }
});

test("Targon's Peak: after conquering, up to 2 runes ready at the end of the turn", () => {
  let g = game();
  setBf(g, 1, 'ogn-289-298');
  runes(g, 0, 2);
  exhaustRunes(g, 0);
  g = moveIn(g, 0, 1).g;
  assert.equal(readyCount(g, 0), 0, 'nothing happens yet');
  g = endTurn(g);
  g = resolveAll(g);
  expectPending(g, 'chooseCards', /Ready up to 2 runes/);
  assert.equal(g.pending!.max, 2);
  g = choose(g, ...optIds(g).slice(0, 2));
  assert.equal(readyCount(g, 0), 2);
});

test("The Arena's Greatest: a player's first Beginning Phase gives them 1 point", () => {
  let g = game();
  setBf(g, 1, 'ogn-290-298');
  g = endTurn(g); g = resolveAll(g);
  assert.equal(g.players[1].points, 1);
  g = endTurn(g); g = resolveAll(g);
  assert.equal(g.players[0].points, 0, "P0's first Beginning Phase was before the battlefield existed");
});

test('The Candlelit Sanctum: look at the top 2, recycle one, the other stays on top', () => {
  let g = game();
  setBf(g, 1, 'ogn-291-298');
  const [t1, t2] = g.players[0].mainDeck;
  g = moveIn(g, 0, 1).g;
  expectPending(g, 'chooseCards', /Recycle/);
  assert.equal(g.pending!.min, 0); assert.equal(g.pending!.max, 2);
  g = choose(g, t1);
  assert.equal(g.players[0].mainDeck[0], t2);
  assert.equal(g.players[0].mainDeck.at(-1), t1);
});

test('The Candlelit Sanctum: keep both and choose their order', () => {
  let g = game();
  setBf(g, 1, 'ogn-291-298');
  const [t1, t2] = g.players[0].mainDeck;
  g = moveIn(g, 0, 1).g;
  g = choose(g);
  expectPending(g, 'chooseCards', /on top/);
  g = choose(g, t2);
  assert.deepEqual(g.players[0].mainDeck.slice(0, 2), [t2, t1]);
});

test('The Dreaming Tree: the first time a player chooses a friendly unit here with a spell each turn, they draw 1', () => {
  let g = game();
  setBf(g, 1, 'ogn-292-298');
  setController(g, 1, 0);
  const u = put(g, 0, 't-u2', 1);
  runes(g, 0, 4);
  const h0 = g.players[0].hand.length;
  g = play(g, 0, handCard(g, 0, 'b8-pump'));
  if (g.pending?.kind === 'chooseTargets') g = choose(g, u);
  g = resolveAll(g);
  assert.equal(g.players[0].hand.length, h0 + 1, 'drew 1 (the spell left the hand, the draw replaced it)');
  const h1 = g.players[0].hand.length;
  g = play(g, 0, handCard(g, 0, 'b8-pump'));
  if (g.pending?.kind === 'chooseTargets') g = choose(g, u);
  g = resolveAll(g);
  assert.equal(g.players[0].hand.length, h1, 'only the first time each turn');
});

test('The Dreaming Tree: choosing an enemy unit here does not draw', () => {
  let g = game();
  setBf(g, 1, 'ogn-292-298');
  setController(g, 1, 1);
  const e = put(g, 1, 't-u3', 1);
  runes(g, 0, 4);
  const h0 = g.players[0].hand.length;
  g = play(g, 0, handCard(g, 0, 'b8-zap'));
  if (g.pending?.kind === 'chooseTargets') g = choose(g, e);
  g = resolveAll(g);
  assert.equal(g.players[0].hand.length, h0);
});

test('The Grand Plaza: holding with 7+ units here wins the game; 6 does not', () => {
  for (const n of [7, 6]) {
    let g = game();
    setBf(g, 1, 'ogn-293-298');
    setController(g, 1, 0);
    for (let i = 0; i < n; i++) put(g, 0, 't-u1', 1);
    g = endTurn(g); g = endTurn(g);
    g = resolveAll(g);
    assert.equal(g.winner, n >= 7 ? 0 : null);
  }
});

test('Trifarian War Camp: units here (both sides) have +1; not elsewhere', () => {
  const g = game();
  setBf(g, 1, 'ogn-294-298');
  const a = put(g, 0, 't-u2', 1), b = put(g, 1, 't-u3', 1), c = put(g, 0, 't-u2', 'base');
  assert.equal(might(g, a), 3); assert.equal(might(g, b), 4); assert.equal(might(g, c), 2);
});

test("Vilemaw's Lair: units can't move from here to base (move negated); recall still works", () => {
  let g = game();
  setBf(g, 1, 'ogn-295-298');
  setController(g, 1, 0);
  const u = put(g, 0, 't-u2', 1);
  assert.ok(!getLegalActions(g, 0).some(a => a.type === 'move' && a.units.includes(u) && a.to === 'base'), 'standard move to base not offered');
  assert.throws(() => act(g, { type: 'move', player: 0, units: [u], to: 'base' }), /illegal move/);
  assert.equal(g.objects[u].battlefieldIndex, 1, 'still here');
  // a recall (not a move) still sends a unit here to base: Possession on an enemy unit here
  const e = put(g, 1, 't-u1', 1);
  runes(g, 0, 8, 'rad-r05');
  g = play(g, 0, handCard(g, 0, 'ogn-203-298'));
  if (g.pending?.kind === 'chooseTargets') g = choose(g, e);
  g = resolveAll(g);
  assert.equal(g.objects[e].zone, 'base');
  assert.equal(g.objects[e].controller, 0);
});

test("Vilemaw's Lair: units elsewhere can still move to base", () => {
  const g = game();
  setBf(g, 1, 'ogn-295-298');
  setController(g, 0, 0);
  const u = put(g, 0, 't-u2', 0);
  assert.ok(getLegalActions(g, 0).some(a => a.type === 'move' && a.units.includes(u) && a.to === 'base'));
});

test('Void Gate: spells deal 1 Bonus Damage to units here; combat damage is unchanged', () => {
  let g = game();
  setBf(g, 1, 'ogn-296-298');
  const e = put(g, 1, 't-u3', 1), f = put(g, 1, 't-u3', 'base');
  runes(g, 0, 4);
  g = play(g, 0, handCard(g, 0, 'b8-zap'));
  g = choose(g, e); g = resolveAll(g);
  assert.equal(g.objects[e].damage, 2);
  g = play(g, 0, handCard(g, 0, 'b8-zap'));
  g = choose(g, f); g = resolveAll(g);
  assert.equal(g.objects[f].damage, 1, 'not here: no bonus');
  // combat damage: 2-Might attacker vs the damaged 3-Might unit here (2 damage already): exactly 2 combat damage kills it
  const a = put(g, 0, 't-u1', 'base');
  g = act(g, { type: 'move', player: 0, units: [a], to: 1 });
  g = resolveAll(g);
  assert.equal(zoneOf(g, e), 'trash');
  assert.equal(zoneOf(g, a), 'trash');
});

test('Windswept Hillock: units here have Ganking (and can move battlefield to battlefield)', () => {
  const g = game();
  setBf(g, 1, 'ogn-297-298');
  setController(g, 1, 0);
  const u = put(g, 0, 't-u2', 1), v = put(g, 0, 't-u2', 'base');
  assert.ok(hasKw(g, u, 'Ganking'));
  assert.ok(!hasKw(g, v, 'Ganking'));
  assert.ok(getLegalActions(g, 0).some(a => a.type === 'move' && a.units.length === 1 && a.units[0] === u && a.to === 0));
});

test('Zaun Warrens: conquering here discards 1, then draws 1', () => {
  let g = game();
  setBf(g, 1, 'ogn-298-298');
  const hand = [...g.players[0].hand];
  const top = g.players[0].mainDeck[0];
  g = moveIn(g, 0, 1).g;
  expectPending(g, 'chooseCards', /Discard 1/);
  g = choose(g, hand[0]);
  assert.equal(zoneOf(g, hand[0]), 'trash');
  assert.equal(zoneOf(g, top), 'hand');
  void pendingPrompt; void (0 as unknown as PlayerId);
});

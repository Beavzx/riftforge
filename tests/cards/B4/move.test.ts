// B4: movement spells and move triggers.
import { test } from 'node:test';
import {
  assert, game, put, runes, handCard, setController, play, mightOf, hasKw, answer, pend, settle, optIds, choose, zoneOf,
  loc, domainRunes, handSize, activate, act, resolveAll, getLegalActions, move, passChain, log, combatSetup, attack, toTurnOf,
  drainRunes,
} from './_util.ts';
import type { GameState, ObjId } from './_util.ts';

/** Play a spell from hand with generous runes of a domain. */
function cast(g: GameState, cardId: string, dom: 'Fury' | 'Calm' | 'Mind' | 'Body' | 'Chaos' | 'Order', n = 6): { g: GameState; s: ObjId } {
  runes(g, 0, n); domainRunes(g, 0, 2, dom);
  const s = handCard(g, 0, cardId);
  return { g: play(g, 0, s), s };
}

// ---------------------------------------------------------------- spells

test('Charm: move an enemy unit to a location of your choice (not its current one)', () => {
  const g0 = game();
  const e = put(g0, 1, 't-u2', 'base');
  let { g } = cast(g0, 'ogn-043-298', 'Calm');
  // R-2 (CR 355.4): the destination is chosen as Charm is played
  assert.equal(pend(g).kind, 'chooseDestination');
  assert.deepEqual(optIds(g), ['0', '1'], 'its base is excluded');
  g = choose(g, '1');
  g = passChain(g);
  assert.equal(loc(g, e), 1);
  assert.equal(g.battlefields[1].contestedBy, 1, 'the moved unit contests for its controller');
});

test('Rune Prison: stun a unit (it deals no combat damage)', () => {
  const g0 = game();
  const e = put(g0, 1, 't-u2', 0);
  put(g0, 0, 't-u3', 'base');
  let { g } = cast(g0, 'ogn-050-298', 'Calm');
  g = answer(g, 'chooseTargets', e);
  g = resolveAll(g);
  assert.equal(g.objects[e].stunned, true);
});

test('Solari Shieldbearer: when played, stun a unit', () => {
  let g = game();
  runes(g, 0, 3);
  const e = put(g, 1, 't-u2', 'base');
  const s = handCard(g, 0, 'ogn-051-298');
  g = play(g, 0, s, 'base');
  g = answer(g, 'chooseTargets', e);
  g = resolveAll(g);
  assert.equal(g.objects[e].stunned, true);
});

test('Fight or Flight: move a unit from a battlefield to its base', () => {
  const g0 = game();
  const e = put(g0, 1, 't-u2', 0);
  put(g0, 1, 't-u2', 'base');
  let { g } = cast(g0, 'ogn-168-298', 'Chaos');
  g = resolveAll(g);
  assert.equal(loc(g, e), 'base');
});

test('Zenith Blade: stun an enemy unit at a battlefield and optionally move a friendly unit to its battlefield', () => {
  const g0 = game();
  const e = put(g0, 1, 't-u2', 1);
  setController(g0, 1, 1);
  const f = put(g0, 0, 't-u3', 'base');
  let { g } = cast(g0, 'ogn-262-298', 'Calm');
  if (pend(g).kind === 'chooseTargets' && optIds(g).includes(e)) g = choose(g, e);
  if (pend(g).kind === 'chooseTargets') g = answer(g, 'chooseTargets', f);   // (a sole friendly unit is auto-chosen: RJ#5998b makes it required)
  g = passChain(g);
  g = answer(g, 'optional', 'yes');                                       // the move is decided on resolution
  g = passChain(g);
  assert.equal(g.objects[e].stunned, true);
  assert.equal(loc(g, f), 1);
  // decline the move
  const h0 = game();
  const e2 = put(h0, 1, 't-u2', 1);
  const f2 = put(h0, 0, 't-u3', 'base');
  let { g: h } = cast(h0, 'ogn-262-298', 'Calm');
  if (pend(h).kind === 'chooseTargets' && optIds(h).includes(e2)) h = choose(h, e2);
  if (pend(h).kind === 'chooseTargets') h = answer(h, 'chooseTargets', f2);
  h = passChain(h);
  h = answer(h, 'optional', 'no');
  h = passChain(h);
  assert.equal(h.objects[e2].stunned, true);
  assert.equal(loc(h, f2), 'base');
});

test('Flash: move up to 2 friendly units to base', () => {
  const g0 = game();
  setController(g0, 0, 0);
  const a = put(g0, 0, 't-u1', 0), b = put(g0, 0, 't-u1', 0), c = put(g0, 0, 't-u1', 1);
  let { g } = cast(g0, 'ogs-011-024', 'Chaos');
  assert.equal(pend(g).max, 2);
  g = choose(g, a, c);
  g = resolveAll(g);
  assert.equal(loc(g, a), 'base'); assert.equal(loc(g, c), 'base'); assert.equal(loc(g, b), 0);
});

test('Cataclysm: opponents cannot play spells this turn; move a friendly unit to an occupied enemy battlefield', () => {
  const g0 = game();
  setController(g0, 1, 1);
  put(g0, 1, 't-u2', 1);
  const f = put(g0, 0, 't-u5', 'base');
  let { g } = cast(g0, 'rad-084-167', 'Body');
  if (pend(g).kind === 'chooseTargets') g = choose(g, f);
  g = passChain(g);
  assert.equal(loc(g, f), 1, 'only the occupied enemy battlefield is offered (auto)');
  assert.ok(g.ex.delayed.some(d => d.key === 'B4:opponentsNoSpells'));
  // P1 now can't play a Reaction spell in the showdown
  for (let i = 0; i < 10 && !(g.pending?.player === 1 && (g.pending.kind === 'showdownAction' || g.pending.kind === 'chainResponse')); i++) g = act(g, { type: 'pass', player: g.pending!.player });
  runes(g, 1, 3);
  const zap = handCard(g, 1, 'ts-zap');
  assert.ok(!getLegalActions(g, 1).some(a => a.type === 'playCard' && a.obj === zap));
});

test("Siren's Song: move an enemy unit that moved this turn", () => {
  const g0 = game();
  const moved = put(g0, 1, 't-u2', 0); g0.objects[moved].movedThisTurn = true;
  const still = put(g0, 1, 't-u2', 1);
  let { g } = cast(g0, 'rad-098-167', 'Chaos');
  assert.equal(pend(g).kind, 'chooseDestination');    // R-2: chosen as it is played
  g = choose(g, 'base');
  g = passChain(g);
  assert.equal(loc(g, moved), 'base');
  assert.equal(loc(g, still), 1);
});

test('Demon Shade: move a friendly unit to an open battlefield, or give it Ganking if there are none', () => {
  const g0 = game();
  const f = put(g0, 0, 't-u2', 'base');
  let { g } = cast(g0, 'rad-102-167', 'Fury');
  g = answer(g, 'chooseMode', 'move');
  g = answer(g, 'chooseDestination', '1');        // R-2: chosen as the spell is played
  g = passChain(g);
  assert.equal(loc(g, f), 1);
  // Ganking mode with open battlefields: nothing happens
  const h0 = game();
  const f2 = put(h0, 0, 't-u2', 'base');
  let { g: h } = cast(h0, 'rad-102-167', 'Fury');
  h = answer(h, 'chooseMode', 'gank');
  h = resolveAll(h);
  assert.equal(hasKw(h, f2, 'Ganking'), false);
  // no open battlefields: Ganking
  const k0 = game();
  const f3 = put(k0, 0, 't-u2', 'base');
  setController(k0, 0, 0); setController(k0, 1, 1);
  let { g: k } = cast(k0, 'rad-102-167', 'Fury');
  // R-2: the move mode has no valid destination (no open battlefield), so only the Ganking mode can be chosen (auto)
  k = resolveAll(k);
  assert.equal(hasKw(k, f3, 'Ganking'), true);
});

test("Emperor's Divide: move any number of friendly units at one battlefield to base", () => {
  const g0 = game();
  setController(g0, 0, 0); setController(g0, 1, 0);
  const a = put(g0, 0, 't-u1', 0), b = put(g0, 0, 't-u1', 0), c = put(g0, 0, 't-u1', 1);
  let { g } = cast(g0, 'sfd-043-221', 'Calm');
  assert.throws(() => act(g, { type: 'choose', player: 0, optionIds: [a, c] }), /same location/, 'units at different battlefields are rejected');
  g = choose(g, a, b);
  g = resolveAll(g);
  assert.equal(loc(g, a), 'base'); assert.equal(loc(g, b), 'base'); assert.equal(loc(g, c), 1);
});

test('Temptation: move an enemy unit to a location with another unit of the same controller; Repeat [2]', () => {
  const g0 = game();
  const e = put(g0, 1, 't-u2', 'base');
  put(g0, 1, 't-u1', 1);
  const e3 = put(g0, 1, 't-u3', 0);
  runes(g0, 0, 6); domainRunes(g0, 0, 1, 'Chaos');
  const t = handCard(g0, 0, 'sfd-129-221');
  let g = play(g0, 0, t);
  g = answer(g, 'chooseTargets', e);
  assert.deepEqual(optIds(g).sort(), ['0', '1']);  // R-2: destination chosen as the spell is played
  g = choose(g, '1');
  g = answer(g, 'optional', 'yes');               // pay Repeat
  // CR 820.2: the repeat's choices (target + destination) are made as the spell is played
  g = answer(g, 'chooseTargets', e3);
  assert.deepEqual(optIds(g).sort(), ['1', 'base'], 'e is still in base while Temptation is played');
  g = choose(g, '1');
  g = passChain(g);
  assert.equal(loc(g, e), 1);
  assert.equal(loc(g, e3), 1);
});

test('Tricksy Tentacles: move enemy units with one controller and total Might 8 or less to a single location', () => {
  let g = game();
  runes(g, 0, 6); domainRunes(g, 0, 1, 'Calm');
  const a = put(g, 1, 't-u5', 'base'), b = put(g, 1, 't-u3', 'base'), c = put(g, 1, 't-u1', 'base');
  const tt = handCard(g, 0, 'unl-054-219');
  g = play(g, 0, tt);
  g = answer(g, 'chooseTargets', a);
  assert.ok(!optIds(g).includes(a));
  g = answer(g, 'chooseTargets', b);
  // total would exceed 8 with c: no further pick is offered; R-2: the single location is chosen as the spell is played
  assert.equal(pend(g).kind, 'chooseDestination');
  g = choose(g, '0');
  g = resolveAll(g);
  assert.equal(loc(g, a), 0); assert.equal(loc(g, b), 0); assert.equal(loc(g, c), 'base');
});

test('Tricksy Tentacles: choosing nothing does nothing; stopping early is allowed', () => {
  let g = game();
  runes(g, 0, 6); domainRunes(g, 0, 1, 'Calm');
  const a = put(g, 1, 't-u2', 'base');
  put(g, 1, 't-u2', 'base');
  g = play(g, 0, handCard(g, 0, 'unl-054-219'));
  g = answer(g, 'chooseTargets', a);
  g = answer(g, 'chooseTargets');
  g = answer(g, 'chooseDestination', '1');        // R-2
  g = resolveAll(g);
  assert.equal(loc(g, a), 1);
});

test('Call to Battle: move a unit you control to a battlefield you control; the opponent moves one of theirs there', () => {
  const g0 = game();
  setController(g0, 0, 0);
  put(g0, 0, 't-u1', 0);
  const mine = put(g0, 0, 't-u3', 'base');
  const t1 = put(g0, 1, 't-u2', 'base'), t2 = put(g0, 1, 't-u2', 1);
  let { g } = cast(g0, 'unl-101-219', 'Body');
  // R-2: the unit at battlefield 0 has no destination it could move to (the only battlefield P0 controls), so `mine` and its
  // destination are chosen automatically
  g = passChain(g);
  assert.equal(loc(g, mine), 0);
  assert.equal(pend(g).player, 1);
  assert.deepEqual(optIds(g).sort(), [t1, t2].sort());
  g = choose(g, t2);
  assert.equal(loc(g, t2), 0);
});

test('Isolate: move an enemy unit from a battlefield to base, then draw 1 if an enemy unit is alone there', () => {
  const g0 = game();
  const a = put(g0, 1, 't-u2', 0), b = put(g0, 1, 't-u2', 0);
  let { g } = cast(g0, 'unl-124-219', 'Chaos');
  const n = handSize(g, 0);
  g = answer(g, 'chooseTargets', a);
  g = resolveAll(g);
  assert.equal(loc(g, a), 'base');
  assert.equal(handSize(g, 0), n + 1);
  assert.equal(loc(g, b), 0);
  const h0 = game();
  const c = put(h0, 1, 't-u2', 0);
  let { g: h } = cast(h0, 'unl-124-219', 'Chaos');
  const n2 = handSize(h, 0);
  h = resolveAll(h);
  assert.equal(loc(h, c), 'base');
  assert.equal(handSize(h, 0), n2);
});

test('Existential Dread: stun an attacking enemy unit; if already stunned, return it to hand instead', () => {
  let g = game();
  g = toTurnOf(g, 1);
  setController(g, 0, 0);
  put(g, 0, 't-u2', 0);
  const a = put(g, 1, 't-u3', 'base');
  runes(g, 0, 4); domainRunes(g, 0, 2, 'Chaos');
  g = move(g, 1, [a], 0);
  for (let i = 0; i < 10 && !(g.pending?.player === 0 && g.pending.kind === 'showdownAction'); i++) g = act(g, { type: 'pass', player: g.pending!.player });
  const d = handCard(g, 0, 'unl-134-219');
  g = play(g, 0, d);
  g = answer(g, 'optional', 'yes');               // Repeat [2]
  g = passChain(g);
  assert.equal(zoneOf(g, a), 'hand', 'stunned by the first execution, returned by the repeat');
});

test('Void Assault: move a friendly unit, then an enemy unit (you become the attacker)', () => {
  const g0 = game();
  const f = put(g0, 0, 't-u3', 'base');
  const e = put(g0, 1, 't-u2', 'base');
  let { g } = cast(g0, 'unl-202-219', 'Body');
  // R-2: both destinations are chosen as it is played (each unit group auto-picks its only candidate)
  g = answer(g, 'chooseDestination', '1');
  g = answer(g, 'chooseDestination', '1');
  g = passChain(g);
  assert.equal(loc(g, f), 1); assert.equal(loc(g, e), 1);
  assert.equal(g.battlefields[1].contestedBy, 0);
  g = passChain(g);
  assert.equal(g.showdown?.attacker, 0);
});

test('Shadow Dash: move an enemy unit to a battlefield where you have units; exactly two of yours there get +1', () => {
  const g0 = game();
  setController(g0, 0, 0);
  const a = put(g0, 0, 't-u1', 0), b = put(g0, 0, 't-u1', 0);
  put(g0, 0, 't-u1', 1); put(g0, 0, 't-u1', 1); put(g0, 0, 't-u1', 1);
  const e = put(g0, 1, 't-u2', 'base');
  let { g } = cast(g0, 'ven-148-166', 'Calm');
  assert.deepEqual(optIds(g).sort(), ['0', '1']);  // R-2: destination chosen as the spell is played
  g = choose(g, '0');
  g = passChain(g);
  assert.equal(loc(g, e), 0);
  assert.equal(mightOf(g, a), 2); assert.equal(mightOf(g, b), 2);
});

// ---------------------------------------------------------------- move triggers

test('Traveling Merchant: when it moves, discard 1 then draw 1', () => {
  let g = game();
  const m = put(g, 0, 'ogn-185-298', 'base');
  const n = handSize(g, 0);
  g = move(g, 0, [m], 1);
  g = passChain(g);
  g = answer(g, 'chooseCards', g.players[0].hand[0]);
  assert.equal(handSize(g, 0), n);
  assert.equal(g.players[0].trash.length, 1);
});

test('Stellacorn Herder: when it moves, draw 1', () => {
  let g = game();
  const m = put(g, 0, 'sfd-048-221', 'base');
  const n = handSize(g, 0);
  g = passChain(move(g, 0, [m], 1));
  assert.equal(handSize(g, 0), n + 1);
});

test('Corrupt Enforcer: moving to a battlefield discards 1 (not when moving to base)', () => {
  let g = game();
  setController(g, 0, 0);
  const m = put(g, 0, 'sfd-123-221', 0);
  const n = handSize(g, 0);
  g = passChain(move(g, 0, [m], 'base'));
  assert.equal(handSize(g, 0), n);
});

test('Eclipse Dragon: when it moves, draw 1 if you control 4 or fewer runes', () => {
  let g = game();
  const d = put(g, 0, 'ven-016-166', 'base');
  const n = handSize(g, 0);
  g = passChain(move(g, 0, [d], 1));
  assert.equal(handSize(g, 0), n + 1);
  let h = game();
  runes(h, 0, 3);
  const d2 = put(h, 0, 'ven-016-166', 'base');
  const n2 = handSize(h, 0);
  h = passChain(move(h, 0, [d2], 1));
  assert.equal(handSize(h, 0), n2);
});

test('Jhin: when he moves, add [1][A] immediately', () => {
  let g = game();
  const j = put(g, 0, 'unl-022-219', 'base');
  g = move(g, 0, [j], 1);
  assert.equal(g.players[0].pool.energy, 1);
  assert.ok(hasKw(g, j, 'Ganking') && hasKw(g, j, 'Deflect'));
});

test('Minah Swiftfoot: moving to a battlefield: choose each player discards 1 or each player draws 1', () => {
  let g = game();
  const m = put(g, 0, 'ven-111-166', 'base');
  const n0 = handSize(g, 0), n1 = handSize(g, 1);
  // R-1 (CR 403.2): the mode is chosen as the trigger goes on the chain, then it resolves after the passes
  g = move(g, 0, [m], 1);
  g = passChain(answer(g, 'chooseMode', 'draw'));
  assert.equal(handSize(g, 0), n0 + 1); assert.equal(handSize(g, 1), n1 + 1);
  let h = game();
  const m2 = put(h, 0, 'ven-111-166', 'base');
  const k0 = handSize(h, 0), k1 = handSize(h, 1);
  h = move(h, 0, [m2], 1);
  h = passChain(answer(h, 'chooseMode', 'discard'));
  h = answer(h, 'chooseCards', h.players[0].hand[0]);
  h = answer(h, 'chooseCards', h.players[1].hand[0]);
  assert.equal(handSize(h, 0), k0 - 1); assert.equal(handSize(h, 1), k1 - 1);
});

test('Yasuo, Windrider: the third time he moves in a turn, score 1', () => {
  let g = game();
  const y = put(g, 0, 'ogn-205-298', 'base');
  const step = (to: number | 'base') => { g.objects[y].exhausted = false; g = settle(move(g, 0, [y], to)); };
  step(0); step(1);
  assert.equal(g.players[0].points, 2);           // two conquers
  step('base');
  assert.equal(g.players[0].points, 3);           // third move: Yasuo
  step(0);
  assert.equal(g.players[0].points, 3);           // fourth move: nothing (battlefield already scored)
});

test('Miss Fortune, Captain: the first time she moves each turn, you may ready something else that is exhausted', () => {
  let g = game();
  const mf = put(g, 0, 'ogn-162-298', 'base');
  const tired = put(g, 0, 't-u2', 'base', { ready: false });
  const rune = g.players[0].runesInPlay[0]; g.objects[rune].exhausted = true;
  g = move(g, 0, [mf], 1);
  assert.equal(pend(g).kind, 'chooseTargets');
  assert.ok(optIds(g).includes(rune) && optIds(g).includes(tired) && !optIds(g).includes(mf));
  g = choose(g, tired);
  g = passChain(g);
  assert.equal(g.objects[tired].exhausted, false);
  // second move this turn: no trigger
  g = settle(g);
  g.objects[mf].exhausted = false;
  g = move(g, 0, [mf], 0);
  assert.notEqual(pend(g).kind, 'chooseTargets');
});

test('Stealthy Pursuer: may be moved with a friendly unit that moves from its location', () => {
  let g = game();
  const p = put(g, 0, 'ogn-177-298', 'base');
  const u = put(g, 0, 't-u2', 'base');
  g = move(g, 0, [u], 1);
  g = answer(g, 'optional', 'yes');
  g = passChain(g);
  assert.equal(loc(g, p), 1);
  let h = game();
  const p2 = put(h, 0, 'ogn-177-298', 'base');
  const u2 = put(h, 0, 't-u2', 'base');
  h = move(h, 0, [u2], 1);
  h = answer(h, 'optional', 'no');
  assert.equal(loc(h, p2), 'base');
  // an enemy unit leaving doesn't trigger it
  let k = game();
  put(k, 0, 'ogn-177-298', 0);
  const e = put(k, 1, 't-u2', 0);
  setController(k, 0, 0);
  const { g: k2 } = (() => { runes(k, 0, 4); domainRunes(k, 0, 2, 'Chaos'); return { g: play(k, 0, handCard(k, 0, 'ogn-168-298')) }; })();
  k = resolveAll(k2.pending?.kind === 'chooseTargets' ? choose(k2, e) : k2);
  assert.notEqual(pend(k).kind, 'optional');
});

test('Volibear: an opponent moving to a battlefield other than his draws 1 (once per move)', () => {
  let g = game();
  g = toTurnOf(g, 1);
  put(g, 0, 'ogn-158-298', 0);
  setController(g, 0, 0);
  const a = put(g, 1, 't-u1', 'base'), b = put(g, 1, 't-u1', 'base');
  const n = handSize(g, 0);
  g = passChain(move(g, 1, [a, b], 1));
  assert.equal(handSize(g, 0), n + 1);
  let h = game();
  h = toTurnOf(h, 1);
  put(h, 0, 'ogn-158-298', 0);
  setController(h, 0, 0);
  const c = put(h, 1, 't-u1', 'base');
  const n2 = handSize(h, 0);
  h = passChain(move(h, 1, [c], 0));             // to his battlefield: no
  assert.equal(handSize(h, 0), n2);
});

test('Tideturner: when played, may swap locations with a unit you control at another location', () => {
  let g = game();
  setController(g, 0, 0);
  const far = put(g, 0, 't-u2', 0);
  runes(g, 0, 2);
  const t = handCard(g, 0, 'ogn-199-298');
  g = play(g, 0, t, 'base');
  g = answer(g, 'chooseTargets', far);
  g = passChain(g);
  assert.equal(loc(g, t), 0); assert.equal(loc(g, far), 'base');
});

test('Maddened Marauder: when played, move a unit from a battlefield to its base', () => {
  let g = game();
  runes(g, 0, 5);
  const e = put(g, 1, 't-u2', 0);
  g = play(g, 0, handCard(g, 0, 'ogn-191-298'), 'base');
  g = resolveAll(g);
  assert.equal(loc(g, e), 'base');
});

test('Stoic Ferryman: played to a battlefield, may move another unit you control here to base', () => {
  let g = game();
  setController(g, 0, 0);
  const u = put(g, 0, 't-u2', 0);
  runes(g, 0, 4);
  g = play(g, 0, handCard(g, 0, 'rad-031-167'), 0);
  g = answer(g, 'chooseTargets', u);
  g = resolveAll(g);
  assert.equal(loc(g, u), 'base');
});

test('Janna, Savior: heal your units here, then move up to one enemy unit from here to its base', () => {
  let g = game();
  setController(g, 0, 0);
  const u = put(g, 0, 't-u5', 0, { damage: 2 });
  const e = put(g, 1, 't-u2', 0);
  runes(g, 0, 3); domainRunes(g, 0, 1, 'Calm');
  g = play(g, 0, handCard(g, 0, 'sfd-053-221'), 0);
  g = answer(g, 'chooseTargets', e);
  g = passChain(g);
  assert.equal(g.objects[u].damage, 0);
  assert.equal(loc(g, e), 'base');
});

test('Grim Apothecary: when played, may return a friendly unit at a battlefield to hand', () => {
  let g = game();
  setController(g, 0, 0);
  const u = put(g, 0, 't-u2', 0);
  runes(g, 0, 3);
  g = play(g, 0, handCard(g, 0, 'unl-021-219'), 'base');
  g = answer(g, 'chooseTargets', u);
  g = resolveAll(g);
  assert.equal(zoneOf(g, u), 'hand');
});

test('Grim Apothecary: can be played (Ambush) as a Reaction to a battlefield where you have units', () => {
  let g = game();
  g = toTurnOf(g, 1);
  setController(g, 0, 0);
  put(g, 0, 't-u2', 0);
  runes(g, 0, 3);
  const ga = handCard(g, 0, 'unl-021-219');
  const a = put(g, 1, 't-u3', 'base');
  g = move(g, 1, [a], 0);
  for (let i = 0; i < 10 && !(g.pending?.player === 0 && g.pending.kind === 'showdownAction'); i++) g = act(g, { type: 'pass', player: g.pending!.player });
  assert.ok(getLegalActions(g, 0).some(x => x.type === 'playCard' && x.obj === ga && x.destination === 0));
});

test('Chakram Dancer: when played, your other units here get Shield this turn', () => {
  let g = game();
  setController(g, 0, 0);
  const u = put(g, 0, 't-u2', 0), far = put(g, 0, 't-u2', 1);
  runes(g, 0, 3);
  const c = handCard(g, 0, 'unl-071-219');
  g = play(g, 0, c, 0);
  g = resolveAll(g);
  assert.ok(hasKw(g, u, 'Shield')); assert.ok(!hasKw(g, far, 'Shield')); assert.ok(!hasKw(g, c, 'Shield'));
});

test('Ocean Drake: when played, may return a non-Dragon unit to its owner\'s hand', () => {
  let g = game();
  runes(g, 0, 8); domainRunes(g, 0, 2, 'Chaos');
  const e = put(g, 1, 't-u3', 'base');
  const dr = put(g, 1, 'sfd-006-221', 'base');
  g = play(g, 0, handCard(g, 0, 'ven-115-166'), 'base');
  assert.ok(!optIds(g).includes(dr));
  g = answer(g, 'chooseTargets', e);
  g = resolveAll(g);
  assert.equal(zoneOf(g, e), 'hand');
});

test('Imposing Challenger: when it moves, may move a weaker enemy unit here to a different battlefield', () => {
  let g = game();
  const c = put(g, 0, 'unl-105-219', 'base');
  const weak = put(g, 1, 't-u2', 0), strong = put(g, 1, 't-u5', 0);
  setController(g, 0, 1);
  g = move(g, 0, [c], 0);
  assert.deepEqual(optIds(g), [weak]);
  g = choose(g, weak);
  g = passChain(g);
  assert.equal(loc(g, weak), 1, 'only the other battlefield is a legal destination (auto)');
  assert.equal(loc(g, strong), 0);
});

test('Irresistible Faefolk: moving to a battlefield, may move an enemy unit there', () => {
  let g = game();
  const f = put(g, 0, 'unl-112-219', 'base');
  const e = put(g, 1, 't-u1', 'base');
  g = move(g, 0, [f], 1);
  g = answer(g, 'chooseTargets', e);
  g = passChain(g);
  assert.equal(loc(g, e), 1);
});

test('Fae Porter: moving to a battlefield, may pay [C] to move a unit you control there too', () => {
  let g = game();
  domainRunes(g, 0, 1, 'Chaos');
  const p = put(g, 0, 'sfd-125-221', 'base');
  const u = put(g, 0, 't-u2', 'base', { ready: false });
  g = move(g, 0, [p], 1);
  g = answer(g, 'optional', 'yes');
  g = passChain(g);
  assert.equal(loc(g, u), 1);
  let h = game();
  drainRunes(h, 0);
  const p2 = put(h, 0, 'sfd-125-221', 'base');
  put(h, 0, 't-u2', 'base');
  h = move(h, 0, [p2], 1);
  assert.notEqual(pend(h).kind, 'optional', 'not offered when [C] cannot be paid');
});

test('Blast Cone: when played, may move an enemy unit; whenever you move an enemy unit, may exhaust it to stun that unit', () => {
  let g = game();
  runes(g, 0, 4); domainRunes(g, 0, 1, 'Chaos');
  const e = put(g, 1, 't-u2', 'base');
  const bc = handCard(g, 0, 'unl-133-219');
  g = play(g, 0, bc, 'base');
  g = answer(g, 'chooseTargets', e);
  g = answer(g, 'chooseTargets', g.battlefields[1].objId);   // R-2: "you may" destination (up to one) chosen with the target
  g = passChain(g);
  g = answer(g, 'optional', 'yes');
  g = passChain(g);
  assert.equal(loc(g, e), 1);
  assert.equal(g.objects[e].stunned, true);
  assert.equal(g.objects[bc].exhausted, true);
});

test('Vex, Mocking: when you stun an enemy unit at a battlefield, you may move her there', () => {
  let g = game();
  const v = put(g, 0, 'unl-055-219', 'base');
  const e = put(g, 1, 't-u2', 1);
  runes(g, 0, 4); domainRunes(g, 0, 1, 'Calm');
  g = play(g, 0, handCard(g, 0, 'ogn-050-298'));
  if (pend(g).kind === 'chooseTargets') g = choose(g, e);
  g = passChain(g);
  g = answer(g, 'optional', 'yes');
  g = passChain(g);
  assert.equal(loc(g, v), 1);
});

test('Vex, Apathetic: when an opponent plays a unit while she is at a battlefield, stun it; they cannot move it this turn', () => {
  let g = game();
  g = toTurnOf(g, 1);
  setController(g, 0, 0);
  put(g, 0, 'unl-150-219', 0);
  runes(g, 1, 3);
  const u = handCard(g, 1, 't-u2');
  g = play(g, 1, u, 'base');
  g = passChain(g);
  assert.equal(g.objects[u].stunned, true);
  g.objects[u].exhausted = false;
  assert.ok(!getLegalActions(g, 1).some(a => a.type === 'move' && a.units.includes(u)));
  const mod = g.objects[u].modifiers.find(m => m.grants?.includes('B4:cantMoveThisTurn'));
  assert.ok(mod, 'granted for this turn');
  assert.equal(mod!.duration, 'endOfTurn');
  // Vex at base: nothing
  let h = game();
  h = toTurnOf(h, 1);
  put(h, 0, 'unl-150-219', 'base');
  runes(h, 1, 3);
  const u2 = handCard(h, 1, 't-u2');
  h = passChain(play(h, 1, u2, 'base'));
  assert.ok(!h.objects[u2].stunned);
});

test('Evelynn, Entrancing: played from face down on your turn, may move an enemy unit at another location to her battlefield', () => {
  let g = game();
  setController(g, 0, 0);
  put(g, 0, 't-u1', 0);
  const ev = put(g, 0, 'unl-141-219', 0);
  g.objects[ev].zone = 'facedown'; g.objects[ev].faceDown = true; g.objects[ev].hiddenTurn = 0;
  g.turn = 3;
  const e = put(g, 1, 't-u2', 'base');
  g = play(g, 0, ev);
  g = passChain(g);
  g = answer(g, 'chooseTargets', e);
  g = passChain(g);
  assert.equal(loc(g, e), 0);
});

test('Tideturner: played from hiding, may still swap with a unit you control at another location', () => {
  let g = game();
  setController(g, 0, 0);
  put(g, 0, 't-u1', 0);
  const home = put(g, 0, 't-u2', 'base');
  const t = put(g, 0, 'ogn-199-298', 0);
  g.objects[t].zone = 'facedown'; g.objects[t].faceDown = true; g.objects[t].hiddenTurn = 0;
  g.turn = 3;
  g = play(g, 0, t);
  g = passChain(g);
  g = answer(g, 'chooseTargets', home);
  g = passChain(g);
  assert.equal(loc(g, t), 'base'); assert.equal(loc(g, home), 0);
});

test('Angler Wyrm: [T]: the chosen opponent must move one of their units to its battlefield', () => {
  let g = game();
  setController(g, 0, 0);
  const w = put(g, 0, 'rad-113-167', 0);
  const a = put(g, 1, 't-u2', 'base'), b = put(g, 1, 't-u3', 1);
  g = activate(g, 0, w);
  g = passChain(g);
  assert.equal(pend(g).player, 1);
  assert.deepEqual(optIds(g).sort(), [a, b].sort());
  g = choose(g, b);
  assert.equal(loc(g, b), 0);
  assert.equal(g.objects[w].exhausted, true);
});

test('Heimerdinger, Inventor: has the [T] abilities of other friendly units and gear', () => {
  let g = game();
  setController(g, 0, 0);
  const h = put(g, 0, 'ogn-111-298', 0);
  put(g, 0, 'rad-113-167', 'base');         // Angler Wyrm: [T] ability
  put(g, 1, 'ts-pinger', 'base');           // enemy [T] ability: not shared
  const acts = getLegalActions(g, 0).filter(a => a.type === 'activate' && a.obj === h);
  assert.equal(acts.length, 1);
  const e = put(g, 1, 't-u2', 'base');
  g = act(g, acts[0]);
  g = passChain(g);
  g = answer(g, 'chooseCards', e);
  assert.equal(g.objects[h].exhausted, true);
  assert.equal(loc(g, e), 0, "Heimerdinger's battlefield");
  void log; void combatSetup; void attack;
});

test('Heimerdinger, Inventor: uses another unit\'s [T] ability with himself as the source', () => {
  let g = game();
  const h = put(g, 0, 'ogn-111-298', 'base');
  put(g, 0, 'ts-pinger', 'base');
  const e = put(g, 1, 't-u1', 0);
  const acts = getLegalActions(g, 0).filter(a => a.type === 'activate' && a.obj === h);
  assert.equal(acts.length, 1);
  g = act(g, acts[0]);
  g = resolveAll(g);
  assert.equal(zoneOf(g, e), 'trash');
  assert.equal(g.objects[h].exhausted, true);
});

test("Vex, Apathetic: the opponent can't move the unit, but Vex's controller still can (by an effect)", () => {
  let g = game();
  g = toTurnOf(g, 1);
  setController(g, 0, 0);
  const vex = put(g, 0, 'unl-150-219', 0);
  runes(g, 1, 3);
  const u = handCard(g, 1, 't-u2');
  g = passChain(play(g, 1, u, 'base'));
  // P0 answers a P1 spell with a Reaction move: Siren's Song on the (moved-this-turn) unit
  runes(g, 0, 3); domainRunes(g, 0, 1, 'Chaos');
  g.objects[u].movedThisTurn = true;
  runes(g, 1, 1);
  g = play(g, 1, handCard(g, 1, 'ts-zap'));
  if (pend(g).kind === 'chooseTargets') g = choose(g, vex);
  for (let i = 0; i < 5 && g.pending?.player !== 0; i++) g = act(g, { type: 'pass', player: g.pending!.player });
  const ss = handCard(g, 0, 'rad-098-167');
  g = play(g, 0, ss);
  if (pend(g).kind === 'chooseTargets') g = choose(g, u);
  if (pend(g).kind === 'chooseDestination') g = choose(g, '1');   // R-2: chosen as Siren's Song is played
  g = passChain(g);
  assert.equal(loc(g, u), 1);
});

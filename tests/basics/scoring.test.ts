// BASICS: how the everyday showdowns and combats of the matrix end, when nobody does anything more (CR 341-348, 461-468,
// 469-474): who controls the battlefield, who scored, and the points — generated over the showdown moments × the score
// before (0, or victory score − 1: the final point rule, CR 473.1.b).
import { test } from 'node:test';
import { assert, P0, P1, BF_A, act } from '../conformance/harness.ts';
import type { GameState, PlayerId } from '../../src/engine/types.ts';
import { momentBase, BF_B, type Moment } from './matrix.ts';

interface End { bf: number; winner: PlayerId; why: string }
const ENDS: { m: Moment; end: End }[] = [
  { m: 'showdownFocus', end: { bf: BF_A, winner: P0, why: 'only P0\'s units at the end of the showdown: P0 establishes control = conquer (CR 348.2, 471)' } },
  { m: 'showdownLast', end: { bf: BF_A, winner: P0, why: 'CR 348.2' } },
  { m: 'showdownNoFocus', end: { bf: BF_A, winner: P0, why: 'CR 348.2' } },
  { m: 'oppShowdownFocus', end: { bf: BF_A, winner: P1, why: 'P1 moved there on its turn: P1 conquers' } },
  { m: 'combatAttack', end: { bf: BF_A, winner: P0, why: 'V(3) kills the V(1) defender; the attacker remains and conquers (CR 467-468)' } },
  { m: 'combatDefend', end: { bf: BF_B, winner: P1, why: 'P1\'s V(3) kills P0\'s V(1) holder at BF-B; P1 conquers (CR 467-468)' } },
];

function finish(g: GameState): GameState {
  for (let i = 0; i < 40 && g.showdown; i++) {
    const d = g.pending!;
    if (d.inStep) { g = act(g, { type: 'choose', player: d.player, optionIds: [(d.options ?? [])[0].id] }); continue; }
    if (d.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: d.player, assignment: d.data!.suggested as Record<string, number> }); continue; }
    g = act(g, { type: 'pass', player: d.player });
  }
  return g;
}

for (const { m, end } of ENDS) for (const before of [0, 7]) {
  test(`BASICS scoring: ${m}, nobody acts, winner at ${before} points — P${end.winner} ${before === 7 ? 'draws instead (final point rule)' : 'conquers +1'}`, () => {
    let g = structuredClone(momentBase(m).g);
    g.players[end.winner].points = before;
    const hand0 = g.players[end.winner].hand.length;
    const otherBf = end.bf === BF_A ? BF_B : BF_A;
    const scoredOther = g.battlefields[otherBf].scoredThisTurnBy.includes(end.winner);
    g = finish(g);
    assert.equal(g.showdown, null, 'the showdown / combat ended');
    assert.equal(g.battlefields[end.bf].controller, end.winner, end.why);
    assert.ok(g.battlefields[end.bf].scoredThisTurnBy.includes(end.winner), 'scored this turn (CR 472)');
    if (before === 0 || scoredOther) assert.equal(g.players[end.winner].points, before + 1, 'conquer: +1 point (CR 473)');
    else {
      // CR 473.1.b: at victory score − 1, a conquer gives the point only if every battlefield was scored this turn
      assert.equal(g.players[end.winner].points, before, 'final point rule: no point');
      assert.equal(g.players[end.winner].hand.length, hand0 + 1, 'final point rule: draw 1 instead');
    }
    assert.equal(g.winner, null);
    const d = g.pending!;
    assert.ok(d && !d.inStep && d.kind === 'mainAction' && d.player === g.activePlayer, `back to the turn player's Main phase, got ${d?.kind}`);
  });
}

test('BASICS scoring: the Beginning phase hold — the start-of-turn trigger resolves first (Beginning step), then P0 holds BF-B (scoring step): +1 point (CR 315.2.a-b, 471)', () => {
  let g = structuredClone(momentBase('beginningChain').g);
  assert.equal(g.players[P0].points, 0, 'the scoring step comes after the Beginning step\'s chain');
  for (let i = 0; i < 10 && g.pending?.kind === 'chainResponse'; i++) g = act(g, { type: 'pass', player: g.pending.player });
  assert.equal(g.pending?.kind, 'mainAction');
  assert.equal(g.players[P0].points, 1);
  assert.ok(g.battlefields[BF_B].scoredThisTurnBy.includes(P0));
});

// ENGINE-4: 2v2 teams (CR 491) — teams by seat parity, scoring once per team per turn and the teammate disqualification
// (CR 491.8.b, 491.8.b.1; DECISIONS #572, RJ#6609).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../../src/engine/index.ts';
import { score } from '../../src/engine/showdown.ts';
import { fixtureDb } from '../fixtures/conformance/cards.ts';
import { legalDeck, nextTurn, put, type GameState, type PlayerId } from '../conformance/harness.ts';

function game2v2(): GameState {
  return createGame({ seed: 3, cardDb: fixtureDb(), mode: '2v2', firstPlayer: 0, skipMulligan: true, battlefieldSelection: 'random', includeAllCards: true,
    players: [0, 1, 2, 3].map(i => ({ name: `P${i}`, deck: legalDeck({ legend: i >= 2 ? 'cf-legend-2' : 'cf-legend' }, [`cf-bf-${'abde'[i]}`, `cf-bf-${'bcef'[i]}`, `cf-bf-${'cdfa'[i]}`]) })) } as never);
}
const untilTurnOf = (g: GameState, p: PlayerId) => { for (let i = 0; i < 6 && g.activePlayer !== p; i++) g = nextTurn(g); assert.equal(g.activePlayer, p); return g; };

test('2v2: teams are seats 0/2 and 1/3', () => {
  const g = game2v2();
  assert.deepEqual((g as unknown as { teams: number[][] }).teams, [[0, 2], [1, 3]]);
});

test('2v2: a battlefield my teammate controls in my Scoring Step can\'t be scored by my team this turn; once per team per turn (CR 491.8.b, 491.8.b.1)', () => {
  let g = game2v2();
  g = untilTurnOf(g, 3);
  put(g, 2, 'V(1)', 0); g.battlefields[0].controller = 2;   // P0's teammate holds BF 0 going into P0's turn
  g = untilTurnOf(g, 0);
  assert.equal(score(g, 0, 0, 'conquer'), false, 'disqualified for team 0 (P0 can\'t make P2 retreat and conquer it)');
  assert.equal(score(g, 1, 0, 'conquer'), true, 'the other team may score it');
  assert.equal(score(g, 3, 0, 'conquer'), false, 'once per team per turn');
});

test('2v2: on an opponent\'s turn, conquering a battlefield my teammate controlled in that turn\'s Scoring Step scores (RJ#572)', () => {
  let g = game2v2();
  g = untilTurnOf(g, 0);
  put(g, 2, 'V(1)', 0); g.battlefields[0].controller = 2;
  g = untilTurnOf(g, 1);                                  // an opponent's turn: only team 1 is affected by 491.8.b.1
  assert.equal(score(g, 0, 0, 'conquer'), true);
});

// ENGINE-5: the remaining CR 491 pieces — shared points (491.8.d), team win / concession (491.6.a), final point (491.8.g.1),
// control not shared for Hide / Standard Move (491.8.c.1-2), "friendly" includes teammates (491.8.e).
import { gainPoints, losePoints, checkWinNow } from '../../src/engine/actions.ts';
import { hideTargets } from '../../src/engine/play.ts';
import { canMoveUnit } from '../../src/engine/legal.ts';
import { applyAction } from '../../src/engine/index.ts';
import { Ctx } from '../../src/engine/context.ts';

const pts = (g: GameState) => g.players.map(p => p.points);

test('2v2: points are shared by a team — gains and losses apply to both teammates (CR 491.8.d.1-2)', () => {
  const g = game2v2();
  gainPoints(g, 0, 2, 'test');
  assert.deepEqual(pts(g), [2, 0, 2, 0]);
  gainPoints(g, 3, 1, 'test');
  assert.deepEqual(pts(g), [2, 1, 2, 1]);
  losePoints(g, 2, 1);
  assert.deepEqual(pts(g), [1, 1, 1, 1]);
});

test('2v2: the team reaching the Victory Score (11) wins — the teammate\'s equal score doesn\'t block it (CR 491.3, 491.6, 491.8.d.1)', () => {
  const g = game2v2();
  assert.equal(g.victoryScore, 11);
  gainPoints(g, 1, 10, 'test');
  gainPoints(g, 2, 11, 'test');
  assert.ok(checkWinNow(g));
  assert.ok(g.winner === 0 || g.winner === 2, `team 0 wins (winner ${g.winner})`);
});

test('2v2: one player\'s concession ends the game for their team (CR 491.6.a)', () => {
  const g = game2v2();
  const r = applyAction(g, { type: 'concede', player: 1 }).state;
  assert.ok(r.winner === 0 || r.winner === 2, `the opposing team wins (winner ${r.winner})`);
});

test('2v2: final point by conquering — battlefields my ally occupied in this turn\'s Scoring Step are excepted (CR 491.8.g.1)', () => {
  const run = (scoreOther: boolean) => {
    let g = game2v2();
    g = untilTurnOf(g, 3);
    put(g, 2, 'V(1)', 0); g.battlefields[0].controller = 2;   // P0's ally holds BF 0 going into P0's turn
    g = untilTurnOf(g, 0);
    gainPoints(g, 0, (g.victoryScore - 1) - g.players[0].points - (scoreOther ? 1 : 0), 'test');
    if (scoreOther) assert.equal(score(g, 0, 2, 'conquer'), true);
    const hand0 = g.players[0].hand.length;
    assert.equal(score(g, 0, 1, 'conquer'), true);
    return { points: g.players[0].points, drew: g.players[0].hand.length - hand0 };
  };
  assert.deepEqual(run(true), { points: 11, drew: 0 }, 'BF 0 excepted (ally), BF 2 and BF 1 scored → final point');
  assert.deepEqual(run(false), { points: 10, drew: 1 }, 'BF 2 not scored this turn → a card instead of the final point');
});

test('2v2: control is not shared — no Hide at a teammate\'s battlefield, no Standard Move of a teammate\'s unit (CR 491.8.c.1-2)', () => {
  let g = game2v2();
  g = untilTurnOf(g, 0);
  g.battlefields[0].controller = 2; g.battlefields[1].controller = 0;
  const hs = hideTargets(g, 0);
  assert.ok(!hs.includes(0), 'not at the teammate\'s battlefield');
  assert.ok(hs.includes(1), 'sanity: my own battlefield');
  const ally = put(g, 2, 'V(1)', 'base'), mine = put(g, 0, 'V(1)', 'base');
  assert.equal(canMoveUnit(g, 0, ally, 1), false);
  assert.equal(canMoveUnit(g, 0, mine, 1), true, 'sanity');
});

test('2v2: "friendly" includes the teammate\'s objects; opponents\' are enemy (CR 491.8.e)', () => {
  const g = game2v2();
  const src = put(g, 0, 'V(1)', 'base'), ally = put(g, 2, 'V(1)', 'base'), foe = put(g, 1, 'V(1)', 'base');
  const ctx = new Ctx(g, src, 0);
  assert.equal(ctx.isFriendly(ally), true);
  assert.equal(ctx.isFriendly(foe), false);
  assert.ok(ctx.friendlyUnits().includes(ally));
});

test('2v2: teammates can\'t share a Champion Legend or a Battlefield — createGame rejects it (CR 491.8.h-i, DECISIONS #2194)', () => {
  const mk = (legend2: string, bf2: string[]) => () => createGame({ seed: 3, cardDb: fixtureDb(), mode: '2v2', firstPlayer: 0, skipMulligan: true, battlefieldSelection: 'random', includeAllCards: true,
    players: [0, 1, 2, 3].map(i => ({ name: `P${i}`, deck: i === 2 ? legalDeck({ legend: legend2 }, bf2) : legalDeck({ legend: i === 3 ? 'cf-legend-2' : 'cf-legend' }, i === 3 ? ['cf-bf-d', 'cf-bf-e', 'cf-bf-f'] : ['cf-bf-a', 'cf-bf-b', 'cf-bf-c']) })) } as never);
  assert.throws(mk('cf-legend', ['cf-bf-d', 'cf-bf-e', 'cf-bf-f']), /same Champion Legend/);
  assert.throws(mk('cf-legend-2', ['cf-bf-c', 'cf-bf-e', 'cf-bf-f']), /same Battlefields/);
  assert.doesNotThrow(mk('cf-legend-2', ['cf-bf-d', 'cf-bf-e', 'cf-bf-f']), 'opponents may share');
});

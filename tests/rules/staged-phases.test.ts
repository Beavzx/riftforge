// Staged showdowns/combats begin in any Neutral Open state, in every turn phase, inside the cleanup that staged them
// (ENGINE-7 OPEN item 3, ENGINE-8).
//
// CR 323.11 "If the current state is a Neutral Open State and one or more Showdowns are Staged at Battlefields without a Combat
// staged, the Turn Player chooses one of those Battlefields. A Showdown begins there." CR 323.12 (combats) likewise; no phase
// condition (riftlens /rules/cleanups/, read 2026-11-26). CR 322: the repeated cleanup then runs with it ongoing.
// DECISIONS #3694 (inside the cleanup), #1317 (Ending Phase), #11019 (Beginning Phase); rules-decisions #71, #75.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { S0, put, pass, act, P0, P1, BF_A, BF_B, zone, control, pend, legal, mightOf, type GameState } from '../conformance/harness.ts';
import { advance } from '../../src/engine/game.ts';

/** Put the game in the given phase with the remaining turn tasks, nothing pending, a cleanup due; then run the engine. */
function enterPhase(g: GameState, phase: 'end' | 'beginning'): GameState {
  g.phase = phase;
  g.ex.tasks = phase === 'end'
    ? [{ t: 'expiration', n: 0 }, { t: 'nextTurn' }] as never
    : [{ t: 'hold' }, { t: 'channel' }, { t: 'draw' }, { t: 'mainStart' }] as never;
  g.pending = null; g.priority = null;
  g.ex.dirty = true; g.timestamp++;
  advance(g);
  return g;
}

function driveTurn(g: GameState, onStep?: (g: GameState) => void): GameState {
  const t0 = g.turn;
  for (let i = 0; i < 60 && g.turn === t0 && g.winner === null; i++) {
    const d = pend(g);
    onStep?.(g);
    if (d.kind === 'mainAction') break;
    g = d.inStep ? act(g, legal(g, d.player)[0]) : pass(g);
  }
  return g;
}

/** RJ#3694's board: Sett, Kingpin (10 with three buffed allies; 9 damage) and the allies (lethal) vs Volibear, Furious arriving. */
function settBoard(): { g: GameState; s: string; v: string } {
  const g = S0();
  const s = put(g, P1, 'Sett, Kingpin', BF_A); control(g, BF_A, P1);
  const al = [0, 1, 2].map(() => put(g, P1, 'V(1)', BF_A));
  for (const x of [s, ...al]) g.objects[x].counters = { ...(g.objects[x].counters ?? {}), buff: 1 };
  g.timestamp++;
  assert.equal(mightOf(g, s), 10);
  const v = put(g, P0, 'Volibear, Furious', BF_A);
  g.battlefields[BF_A].contested = true; g.battlefields[BF_A].contestedBy = P0;
  for (const x of al) g.objects[x].damage = 2;
  g.objects[s].damage = 9;
  return { g, s, v };
}

test('CR 323.12 + 322 in the Ending Phase (RJ#3694 shape, RJ#1317): the combat staged in the cleanup where the allies die begins in it, so Volibear attacks; Sett dies in the repeat; conquer this turn', () => {
  let { g, s, v } = settBoard();
  const n0 = g.log.length, t0 = g.turn;
  g = enterPhase(g, 'end');
  let attackTrig = false;
  g = driveTurn(g, gg => { if (gg.chain.some(c => /Volibear/.test(String((c as { label?: string }).label ?? '')))) attackTrig = true; });
  const lt = g.log.slice(n0).map(l => l.text).join('\n');
  assert.ok(/Combat at BF-A/.test(lt), `a combat (not a plain showdown) was fought:\n${lt}`);
  assert.ok(attackTrig || /Resolving Volibear/.test(lt), 'Volibear\'s "When I attack" triggered');
  assert.equal(zone(g, s), 'trash');
  assert.equal(zone(g, v), 'battlefield');
  assert.ok(lt.indexOf('Combat at BF-A') < lt.indexOf(`--- Turn ${t0 + 1}`) || !lt.includes(`--- Turn ${t0 + 1}`), 'in this turn');
  assert.ok(/P0 conquers BF-A/.test(lt), 'conquered in the Ending Phase of this turn');
});

// DECISIONS #9254 (ENGINE-9): CR 308-310 ("At any given time …" — Neutral Open = no showdown/combat and no chain, no phase
// condition) → verified RJ#9254's "the Beginning Phase is not a Neutral Open State, starts in the Action Phase" is MISMATCH-RJ.
test('CR 323.11 in the Beginning Phase (DECISIONS #11019 / #9254: no phase condition): a showdown staged before the Hold step begins at once — before Channel and Draw', () => {
  let g = S0();
  const u = put(g, P0, 'V(2)', BF_B);
  g.battlefields[BF_B].contested = true; g.battlefields[BF_B].contestedBy = P0;
  const hand0 = g.players[P0].hand.length;
  g = enterPhase(g, 'beginning');
  assert.equal(pend(g).kind, 'showdownAction', 'the showdown is open');
  assert.equal(g.phase, 'beginning', 'still in the Beginning Phase');
  assert.equal(g.players[P0].hand.length, hand0, 'no draw yet');
  const p0 = g.players[P0].points;
  g = driveTurn(g);
  assert.equal(zone(g, u), 'battlefield');
  assert.equal(g.battlefields[BF_B].controller, P0);
  assert.equal(g.players[P0].points, p0 + 1, 'conquer point; no Hold point for the battlefield already scored this turn');
  assert.equal(g.players[P0].hand.length, hand0 + 1, 'the draw still happens afterwards');
});

// Random-playout fuzz: bots pick random (or heuristic) legal actions with fixed seeds. Games must never
// throw, deadlock or reach an illegal state, and every game must end. FUZZ_GAMES env raises the count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, getLegalActions } from '../../src/engine/game.ts';
import { chooseAction } from '../../src/engine/bot.ts';
import { makeRng } from '../../src/engine/rng.ts';
import { fullDb, deck } from '../fixtures/cards.ts';
import { checkInvariants } from '../fixtures/invariants.ts';
import type { Action, GameState } from '../../src/engine/types.ts';

const db = fullDb();
const scripted = Object.keys(db).filter(k => k.startsWith('ts-'));
function fuzzDeck(r: () => number, bfOffset: number) {
  const main: string[] = [];
  for (const id of scripted) { const n = 1 + Math.floor(r() * 2); for (let i = 0; i < n; i++) main.push(id); }
  for (const id of ['t-hidden', 't-ambush', 't-hunt', 't-disarm', 't-deflect']) main.push(id, id);
  return deck({ main }, bfOffset);
}

export function playGame(seed: number, mode: 'random' | 'mixed' | 'bots', check = true, maxSteps = 4000): { g: GameState; actions: Action[]; steps: number } {
  const r = makeRng(seed);
  let g = createGame({ seed, cardDb: db, includeAllCards: false, battlefieldSelection: r() < 0.5 ? 'choose' : 'random',
    players: [{ name: 'A', deck: fuzzDeck(r, 0) }, { name: 'B', deck: fuzzDeck(r, 3) }] });
  const actions: Action[] = [];
  let steps = 0;
  while (g.winner === null && steps < maxSteps) {
    const d = g.pending;
    if (!d) throw new Error(`seed ${seed}: no pending decision`);
    let a: Action | null;
    const useBot = mode === 'bots' || (mode === 'mixed' && d.player === 0);
    if (useBot) a = chooseAction(g, d.player, { randomness: 0.5, seed });
    else {
      const legal = getLegalActions(g, d.player);
      // random bots end their turn a bit less often so games involve combat
      const nonEnd = legal.filter(x => x.type !== 'endTurn');
      a = nonEnd.length && r() < 0.7 ? nonEnd[Math.floor(r() * nonEnd.length)] : legal[Math.floor(r() * legal.length)];
    }
    if (!a) throw new Error(`seed ${seed}: no action for ${d.kind}`);
    if (r() < 0.0005) a = { type: 'concede', player: d.player };
    try { g = applyAction(g, a).state; } catch (e) { throw new Error(`seed ${seed} step ${steps} ${d.kind} ${JSON.stringify(a)}: ${(e as Error).stack}`); }
    actions.push(a);
    steps++;
    if (check) { const errs = checkInvariants(g); if (errs.length) throw new Error(`seed ${seed} step ${steps} after ${JSON.stringify(a)}: ${errs.join('; ')}`); }
  }
  return { g, actions, steps };
}

const N = Number(process.env.FUZZ_GAMES ?? 60);

test(`fuzz: ${N} random-vs-random games end without errors`, () => {
  for (let s = 1; s <= N; s++) {
    const { g, steps } = playGame(s, 'random');
    assert.notEqual(g.winner, null, `seed ${s} did not end in ${steps} steps (turn ${g.turn})`);
  }
});

test(`fuzz: ${Math.ceil(N / 2)} heuristic-vs-random and bot-vs-bot games end`, () => {
  for (let s = 1000; s < 1000 + Math.ceil(N / 2); s++) {
    const { g } = playGame(s, s % 2 ? 'mixed' : 'bots');
    assert.notEqual(g.winner, null, `seed ${s} did not end`);
  }
});

test('determinism: replaying the same actions reproduces the same state', () => {
  for (const s of [7, 8, 9]) {
    const { g, actions } = playGame(s, 'random', false, 600);
    const r = makeRng(s);
    let h = createGame({ seed: s, cardDb: db, battlefieldSelection: r() < 0.5 ? 'choose' : 'random',
      players: [{ name: 'A', deck: fuzzDeck(r, 0) }, { name: 'B', deck: fuzzDeck(r, 3) }] });
    for (const a of actions) h = applyAction(h, a).state;
    const strip = (x: GameState) => JSON.stringify({ ...x, ex: { ...x.ex, unit: null, lastEvents: [] }, cards: null });
    assert.equal(strip(h), strip(g));
  }
});

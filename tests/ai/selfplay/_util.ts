// Shared helpers for selfplay tests.
import { createGame, applyAction, getLegalActions } from '../../../src/engine/index.ts';
import type { GameState } from '../../../src/engine/types.ts';
import { cardDb, loadMetaDecks } from '../../../tools/sim-lib.ts';
import { makeRng } from '../../../src/engine/rng.ts';

export function newGame(seed: number): GameState {
  const decks = loadMetaDecks();
  return createGame({ seed, cardDb: cardDb(), battlefieldSelection: 'random', firstPlayer: (seed % 2) as 0 | 1, enforceBanlist: false,
    players: [{ name: 'A', deck: decks[seed % decks.length].deck }, { name: 'B', deck: decks[(seed * 7 + 3) % decks.length].deck }] });
}

/** States with >= 2 legal options reached by random play (skipping mulligan), for search tests. */
export function samplePositions(seed: number, count: number, every = 7): GameState[] {
  const rng = makeRng(seed);
  let g = newGame(seed);
  const out: GameState[] = [];
  for (let step = 0; step < 2000 && out.length < count && g.winner === null; step++) {
    const legal = getLegalActions(g, g.pending!.player).filter(a => a.type !== 'concede' && a.type !== 'cancel');
    if (legal.length >= 2 && g.pending!.kind !== 'mulligan' && step % every === 0) out.push(g);
    const nonPass = legal.filter(a => a.type !== 'pass' && a.type !== 'endTurn');
    const pool = nonPass.length && rng() < 0.7 ? nonPass : legal;
    g = applyAction(g, pool[Math.floor(rng() * pool.length)]).state;
  }
  return out;
}

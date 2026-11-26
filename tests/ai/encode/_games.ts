// Shared helpers for encoder tests: random-policy games over the meta decks, yielding every visited state.
import { createGame, applyAction, getLegalActions } from '../../../src/engine/index.ts';
import type { Action, GameState } from '../../../src/engine/types.ts';
import { cardDb, loadMetaDecks } from '../../../tools/sim-lib.ts';
import { makeRng } from '../../../src/engine/rng.ts';

export function* randomGameStates(seed: number, maxSteps = 400): Generator<{ g: GameState; legal: Action[]; step: number }> {
  const decks = loadMetaDecks(); const rng = makeRng(seed * 31 + 7);
  const a = seed % decks.length, b = (seed * 7 + 3) % decks.length;
  let g = createGame({ seed, cardDb: cardDb(), battlefieldSelection: 'random', firstPlayer: (seed % 2) as 0 | 1, enforceBanlist: false,
    players: [{ name: 'A', deck: decks[a].deck }, { name: 'B', deck: decks[b].deck }] });
  for (let step = 0; step < maxSteps && g.winner === null && g.turn <= 40; step++) {
    const d = g.pending; if (!d) return;
    const legal = getLegalActions(g, d.player);
    if (!legal.length) return;
    yield { g, legal, step };
    const nonPass = legal.filter(x => x.type !== 'endTurn' && x.type !== 'pass' && x.type !== 'concede');
    const pool = nonPass.length && rng() < 0.8 ? nonPass : legal.filter(x => x.type !== 'concede');
    const act = pool[Math.floor(rng() * pool.length)] ?? legal[0];
    try { g = applyAction(g, act).state; } catch { return; }
  }
}

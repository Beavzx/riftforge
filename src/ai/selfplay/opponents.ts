// SELFPLAY: fixed opponents mixed into self-play (config `selfplay.opponents`, resolved.json `opponents`).
//
// Pure self-play (the current net on both seats) can drift into strategies that beat itself but lose to other
// opponents: on epyc-1 the net kept beating its previous checkpoints while its eval score against the rules bot fell
// 40% → 27.5% → 17.5% (AlphaStar's finding: naive self-play has high Elo but a low minimum win rate; a league fixes
// it). So a share of the training games puts the net against a fixed opponent instead:
//   best      the best checkpoint (inference slot 1), searching like the self-play net (same search config, root
//             noise and playout-cap randomisation) but recording nothing
//   bot       the engine's rules bot (src/engine/bot.ts chooseAction), as in eval
//   searchai  the hand-built SearchAI (src/ai), as in eval, with `searchAiOptions`
// In those games the net sits in one seat (chosen at random) and only its decisions are recorded, so every position's
// z (assignOutcome: from the position's actor) is from the net's side. Caps, forced moves and rollback masking are
// playGame's, exactly as in self-play.
//
// Determinism: every draw uses the worker's seeded rng. With a single weighted kind (the default, self 1.0) nothing
// extra is drawn, so the rng stream and every game are exactly what they were before opponents existed.
import type { GameState, PlayerId } from '../../engine/types.ts';
import { chooseAction } from '../../engine/index.ts';
import { SearchAI, type SearchOptions } from '../index.ts';
import { SLOT_BEST } from './client.ts';
import { OPPONENT_KINDS, opponentWeights, type CapsConfig, type OpponentKind, type OpponentsConfig, type SearchConfig } from './config.ts';
import type { SearchEnv } from './env.ts';
import type { Evaluator } from './evaluator.ts';
import type { NamedDeck } from './decks.ts';
import type { Position } from './shards.ts';
import { assignOutcome, EngineBotAgent, playGame, SearchAgent, type Agent, type GameResult } from './game.ts';

export type { OpponentKind } from './config.ts';

/** The kinds with weight > 0 (OPPONENT_KINDS order) and their cumulative probabilities. */
export interface OpponentMix { kinds: OpponentKind[]; cum: number[]; searchAiOptions: SearchOptions }

export function opponentMix(c?: OpponentsConfig | null): OpponentMix {
  const w = opponentWeights(c);
  const kinds = OPPONENT_KINDS.filter(k => w[k] > 0);
  let acc = 0;
  const cum = kinds.map(k => (acc += w[k]));
  cum[cum.length - 1] = 1;   // no rounding gap at the top
  return { kinds, cum, searchAiOptions: (c?.searchAiOptions ?? {}) as SearchOptions };
}

/** This game's opponent and, for a fixed opponent, the net's seat. Draws nothing when only one kind is weighted, and
 *  no seat for self-play. */
export function drawOpponent(m: OpponentMix, rng: () => number): { kind: OpponentKind; netSeat: PlayerId | null } {
  let kind = m.kinds[0];
  if (m.kinds.length > 1) { const x = rng(); kind = m.kinds[m.cum.findIndex(c => x < c)] ?? m.kinds[m.kinds.length - 1]; }
  return { kind, netSeat: kind === 'self' ? null : (rng() < 0.5 ? 0 : 1) };
}

/** The opponent agent for a non-self game. `seed` seeds SearchAI (unless searchAiOptions sets one). */
export function makeOpponent(kind: Exclude<OpponentKind, 'self'>, o: { env: SearchEnv<any>; ev: Evaluator; search: SearchConfig; caps: CapsConfig; rng: () => number; seed: number; searchAiOptions?: SearchOptions }): Agent<any> {
  if (kind === 'best') return new SearchAgent('best', o.env, o.ev, o.search, o.caps, { record: false, noise: true, slot: SLOT_BEST, rng: o.rng, playoutCap: true });
  if (kind === 'bot') return new EngineBotAgent('bot', (g: GameState, p) => chooseAction(g, p));
  if (kind === 'searchai') {
    const ai = new SearchAI({ seed: o.seed, ...(o.searchAiOptions ?? {}) });
    return new EngineBotAgent('searchai', (g: GameState, p) => ai.choose(g, p));
  }
  throw new Error(`unknown self-play opponent ${kind}`);
}

export interface TrainingGame {
  kind: OpponentKind;
  /** the net's seat against a fixed opponent; null in self-play (the net plays both seats) */
  netSeat: PlayerId | null;
  r: GameResult;
  /** the net's recorded positions, z filled in from each position's actor (always the net). The caller drops them
   *  for an error game. */
  positions: Position[];
  /** search simulations of this game: the net's plus a `best` opponent's */
  sims: number;
}

/** One training game: self-play, or the net against `kind` with the net in `netSeat` (from drawOpponent). */
export async function playTrainingGame(o: {
  env: SearchEnv<any>; ev: Evaluator; search: SearchConfig; caps: CapsConfig; rng: () => number;
  decks: [NamedDeck, NamedDeck]; seed: number; firstPlayer: PlayerId;
  kind: OpponentKind; netSeat: PlayerId | null; pointsShaping: number;
  searchAiOptions?: SearchOptions; shouldStop?: () => boolean;
}): Promise<TrainingGame> {
  const net = new SearchAgent('nn', o.env, o.ev, o.search, o.caps, { record: true, noise: true, rng: o.rng });
  let agents: [Agent<any>, Agent<any>] = [net, net];
  let opp: Agent<any> | null = null;
  if (o.kind !== 'self') {
    if (o.netSeat !== 0 && o.netSeat !== 1) throw new Error(`a game vs ${o.kind} needs the net's seat`);
    opp = makeOpponent(o.kind, o);
    agents = o.netSeat === 0 ? [net, opp] : [opp, net];
  }
  const r = await playGame({ env: o.env, agents, decks: o.decks, seed: o.seed, firstPlayer: o.firstPlayer, caps: o.caps, shouldStop: o.shouldStop });
  const positions = assignOutcome(net.positions, r, o.pointsShaping, o.caps.timeoutShaping);
  return { kind: o.kind, netSeat: o.kind === 'self' ? null : o.netSeat, r, positions, sims: net.sims + (opp instanceof SearchAgent ? opp.sims : 0) };
}

export type OpponentResult = 'win' | 'loss' | 'draw' | 'timeout' | 'error';

/** The net's result in a game against a fixed opponent (a timeout is reported as such, not as a draw). */
export function netResult(r: GameResult, netSeat: PlayerId): OpponentResult {
  if (r.status === 'error') return 'error';
  if (r.status === 'timeout') return 'timeout';
  if (r.winner === null) return 'draw';
  return r.winner === netSeat ? 'win' : 'loss';
}

// SELFPLAY: the resolved run configuration the Python orchestrator (python/riftzero/run.py) writes to
// runs/<name>/resolved.json from config/*.yaml. Node workers, eval and tools only ever read this JSON.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface SearchConfig {
  /** 'gumbel' (Gumbel AlphaZero root, PUCT below; strong at low sim counts) or 'puct' (classic AlphaZero) */
  algorithm: 'gumbel' | 'puct';
  /** simulations for a "full" search whose result becomes a training target */
  fullSims: number;
  /** simulations for a "fast" search (playout-cap randomisation): played but not recorded */
  fastSims: number;
  /** probability that a decision gets a full (recorded) search */
  fullProb: number;
  /** Gumbel: max root actions considered (sequential halving starts with this many) */
  maxConsidered: number;
  /** Gumbel sigma(q) constants (Danihelka et al. 2022) */
  cVisit: number;
  cScale: number;
  /** PUCT exploration constant (both algorithms use PUCT below the root) */
  cPuct: number;
  /** PUCT root noise (self-play only) */
  dirichletAlpha: number;
  dirichletFrac: number;
  /** PUCT: sample moves with temperature 1 for this many of a player's decisions, then argmax */
  temperatureMoves: number;
  /** max engine steps when auto-advancing forced moves inside the search */
  forcedStepCap: number;
}

export interface CapsConfig {
  /** turn > maxTurns ends the game ("timeout": a draw, optionally nudged by the point difference, see timeoutShaping) */
  maxTurns: number;
  /** optional annealing: maxTurns goes linearly from maxTurns to `to` over trainer steps [startStep, endStep] */
  maxTurnsAnneal?: { to: number; startStep: number; endStep: number } | null;
  /** timeout value = timeoutShaping * clip(pointDiff / victoryScore, -1, 1) for each player (0 = plain draw). Keep it
   *  well below 1 so a timeout is never worth as much as a real win. */
  timeoutShaping: number;
  /** total engine actions > maxActions ends the game as a draw */
  maxActions: number;
  /** more main-phase actions than this in one turn forces endTurn */
  maxMainPerTurn: number;
}

export interface DeckConfig {
  /** 'pool': both seats draw a deck from `pool`; 'matchup': seat A always plays `me`, seat B one of `opponents` */
  mode: 'pool' | 'matchup';
  /** deck files (relative to repo root or data/meta-decks), resolved by the orchestrator to absolute paths */
  pool: string[];
  me?: string;
  opponents?: string[];
  allowMirror: boolean;
}

/** Who the net plays in a self-play game: itself (both seats), the best checkpoint (slot 1), the engine's rules bot, or
 *  the hand-built SearchAI. */
export type OpponentKind = 'self' | 'best' | 'bot' | 'searchai';
export const OPPONENT_KINDS: readonly OpponentKind[] = ['self', 'best', 'bot', 'searchai'];

/** `selfplay.opponents` (resolved.json `opponents`): the share of training games played against each kind. */
export interface OpponentsConfig {
  /** relative weights (normalised). A missing `self` takes what the others leave of 1.0; missing others are 0.
   *  Missing / empty = { self: 1 } (pure self-play). */
  weights?: Partial<Record<OpponentKind, number>> | null;
  /** SearchAI options for `searchai` games (src/ai/search.ts SearchOptions; same shape as eval.searchAiOptions) */
  searchAiOptions?: Record<string, unknown>;
}

export interface ResolvedConfig {
  runName: string;
  runDir: string;           // absolute
  repoRoot: string;         // absolute
  seed: number;
  decks: DeckConfig;
  caps: CapsConfig;
  search: SearchConfig;
  evalSearch: SearchConfig; // search used in eval / analysis (no noise, fullProb 1)
  workers: { count: number; concurrentGames: number; gamesPerShard: number; statsEverySec: number };
  servers: { host: string; ports: number[] };
  env: { kind: 'engine' | 'factored' };
  target: { pointsShaping: number };
  eval: { gamesPerOpponent: number; opponents: ('best' | 'searchai' | 'bot')[]; searchAiOptions?: Record<string, unknown> };
  /** fixed opponents mixed into self-play; absent in runs started before it existed (= pure self-play) */
  opponents?: OpponentsConfig;
}

/** Normalised opponent weights: { self: 1 } when unset. A missing `self` is 1 − the others (they must not exceed 1).
 *  Throws on unknown kinds, negative or non-finite weights, or a zero total. Same rules as python/riftzero/config.py. */
export function opponentWeights(c?: OpponentsConfig | null): Record<OpponentKind, number> {
  const w = c?.weights ?? {};
  for (const [k, v] of Object.entries(w)) {
    if (!OPPONENT_KINDS.includes(k as OpponentKind)) throw new Error(`selfplay.opponents.weights: unknown opponent '${k}' (use ${OPPONENT_KINDS.join(', ')})`);
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error(`selfplay.opponents.weights.${k} must be a number >= 0 (got ${v})`);
  }
  const out = { self: 0, best: 0, bot: 0, searchai: 0 } as Record<OpponentKind, number>;
  for (const k of OPPONENT_KINDS) out[k] = (w as Record<string, number>)[k] ?? 0;
  if (!Object.keys(w).length) out.self = 1;
  else if (w.self === undefined) {
    const others = out.best + out.bot + out.searchai;
    if (others > 1 + 1e-9) throw new Error(`selfplay.opponents.weights: best + bot + searchai = ${others} > 1 with no 'self' weight given`);
    out.self = Math.max(0, 1 - others);
  }
  const total = OPPONENT_KINDS.reduce((a, k) => a + out[k], 0);
  if (!(total > 0)) throw new Error('selfplay.opponents.weights: all weights are 0');
  for (const k of OPPONENT_KINDS) out[k] /= total;
  return out;
}

export function loadResolved(runDir: string): ResolvedConfig {
  return JSON.parse(readFileSync(join(runDir, 'resolved.json'), 'utf8')) as ResolvedConfig;
}

export const DEFAULT_SEARCH: SearchConfig = {
  algorithm: 'gumbel', fullSims: 64, fastSims: 16, fullProb: 0.25, maxConsidered: 16, cVisit: 50, cScale: 1.0,
  cPuct: 1.5, dirichletAlpha: 0.3, dirichletFrac: 0.25, temperatureMoves: 12, forcedStepCap: 64,
};
// fuzz-agent recommendation for RL: 60 turns early (anneal to 40 once play is sensible; trained play ends ~turn 26),
// 1500 actions, 40 main-phase actions per turn
export const DEFAULT_CAPS: CapsConfig = { maxTurns: 60, maxTurnsAnneal: null, timeoutShaping: 0.2, maxActions: 1500, maxMainPerTurn: 40 };

/** maxTurns in effect at a trainer step (annealing). */
export function maxTurnsAt(c: CapsConfig, step: number): number {
  const a = c.maxTurnsAnneal;
  if (!a) return c.maxTurns;
  if (step <= a.startStep) return c.maxTurns;
  if (step >= a.endStep) return a.to;
  return Math.round(c.maxTurns + (a.to - c.maxTurns) * (step - a.startStep) / Math.max(1, a.endStep - a.startStep));
}

/** Per-player value of a capped (timed-out) game. */
export function timeoutValues(points: number[], victoryScore: number, shaping: number): number[] {
  const out = [0, 0, 0, 0];
  if (!shaping || points.length < 2) return out;
  const d = Math.max(-1, Math.min(1, (points[0] - points[1]) / Math.max(1, victoryScore)));
  out[0] = shaping * d || 0; out[1] = -shaping * d || 0;
  return out;
}

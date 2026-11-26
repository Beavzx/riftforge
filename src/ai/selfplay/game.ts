// SELFPLAY: play one game with search-based agents; record training positions for self-play.
import { createGame } from '../../engine/index.ts';
import type { Action, GameState, PlayerId } from '../../engine/types.ts';
import { cardDb } from '../../../tools/sim-lib.ts';
import type { CapsConfig, SearchConfig } from './config.ts';
import { RollbackError, type Choices, type SearchEnv } from './env.ts';
import type { Evaluator } from './evaluator.ts';
import { Mcts } from './mcts.ts';
import type { NamedDeck } from './decks.ts';
import type { Position } from './shards.ts';

/** An agent's answer: an option index into the choices, or a whole engine action (engine-level bots). */
export type Pick = number | { action: Action };

/** Something that decides for one seat. */
export interface Agent<S = any> {
  name: string;
  /** may record a training position for this decision */
  choose(env: SearchEnv<S>, s: S, actor: PlayerId, ch: Choices, moveNumber: number): Promise<Pick>;
  /** the pick from the last choose() rolled back: forget any position recorded for it */
  rolledBack?(): void;
}

/** Network + search agent. In self-play mode (record=true) it uses playout-cap randomisation and records targets. */
export class SearchAgent<S> implements Agent<S> {
  readonly mcts: Mcts<S>;
  positions: Position[] = [];
  sims = 0; searches = 0;
  constructor(public name: string, env: SearchEnv<S>, ev: Evaluator, private cfg: SearchConfig, caps: CapsConfig,
    private o: { record: boolean; noise: boolean; slot?: number; rng: () => number }) {
    this.mcts = new Mcts(env, ev, cfg, caps);
  }
  private lastRecorded = false;
  async choose(_env: SearchEnv<S>, s: S, actor: PlayerId, ch: Choices, moveNumber: number): Promise<Pick> {
    const full = !this.o.record || this.o.rng() < this.cfg.fullProb;
    const res = await this.mcts.search(s, actor, ch, { sims: full ? this.cfg.fullSims : this.cfg.fastSims, noise: this.o.noise, rng: this.o.rng, slot: this.o.slot, moveNumber });
    this.sims += res.sims; this.searches++;
    this.lastRecorded = this.o.record && full;
    if (this.lastRecorded) this.positions.push({ obs: res.obs, acts: res.acts, actor, policy: res.policy, q: res.value });
    return res.choice;
  }
  rolledBack() { if (this.lastRecorded) { this.positions.pop(); this.lastRecorded = false; } }
}

/** Wraps an engine-level bot (SearchAI, rules bot): it answers each engine decision with a whole engine action,
 *  in any env (the factored env applies it directly). Falls back to option 0 if the bot has no answer. */
export class EngineBotAgent implements Agent<any> {
  constructor(public name: string, private pickAction: (g: GameState, p: PlayerId) => Action | null) {}
  async choose(env: SearchEnv<any>, s: unknown, actor: PlayerId): Promise<Pick> {
    const a = this.pickAction(env.game(s), actor);
    return a ? { action: a } : 0;
  }
}

export interface GameResult {
  winner: PlayerId | null;
  status: 'ok' | 'timeout' | 'error';
  turns: number; actions: number; decisions: number; points: number[]; victoryScore: number; rollbacks?: number;
  decks: [string, string];
  error?: string;
  repro?: { seed: number; decks: [string, string]; firstPlayer: PlayerId };
  ms: number;
}

export class Aborted extends Error {}

export async function playGame<S>(o: {
  env: SearchEnv<S>; agents: [Agent<S>, Agent<S>]; decks: [NamedDeck, NamedDeck]; seed: number; firstPlayer: PlayerId;
  caps: CapsConfig; shouldStop?: () => boolean;
}): Promise<GameResult> {
  const t0 = performance.now();
  const names: [string, string] = [o.decks[0].name, o.decks[1].name];
  const base = { decks: names, repro: { seed: o.seed, decks: names, firstPlayer: o.firstPlayer } };
  let g: GameState;
  try {
    g = createGame({ seed: o.seed, cardDb: cardDb(), battlefieldSelection: 'random', firstPlayer: o.firstPlayer, enforceBanlist: false,
      players: [{ name: names[0], deck: o.decks[0].deck }, { name: names[1], deck: o.decks[1].deck }] });
  } catch (e) {
    return { ...base, winner: null, status: 'error', turns: 0, actions: 0, decisions: 0, points: [0, 0], victoryScore: 8, error: `createGame: ${(e as Error).message}`, ms: performance.now() - t0 };
  }
  let s = o.env.root(g);
  const moves = [0, 0];
  let decisions = 0, mainThisTurn = 0, lastTurn = -1, rollbacks = 0;
  const done = (status: GameResult['status'], error?: string): GameResult => {
    const gg = o.env.game(s);
    return { ...base, winner: gg.winner, status, turns: gg.turn, actions: gg.actionCount, decisions, rollbacks, points: gg.players.map(p => p.points), victoryScore: gg.victoryScore, error, ms: performance.now() - t0 };
  };
  try {
    for (;;) {
      if (o.shouldStop?.()) throw new Aborted('stopping');
      const gg = o.env.game(s);
      if (gg.winner !== null) return done('ok');
      if (gg.turn > o.caps.maxTurns || gg.actionCount >= o.caps.maxActions) return done('timeout');
      const actor = o.env.actor(s);
      if (actor === null) return done('error', 'no pending decision and no winner');
      if (gg.turn !== lastTurn) { lastTurn = gg.turn; mainThisTurn = 0; }
      const pd = gg.pending!;
      if (pd.kind === 'mainAction' && !pd.inStep) mainThisTurn++;
      let ch = o.env.choices(s, actor, { forceEndTurn: mainThisTurn > o.caps.maxMainPerTurn });
      const agent = o.agents[actor as 0 | 1];
      // an option the engine rolls back (e.g. a target whose payment then fails) is illegal: mask it and decide again
      for (let tries = 0; ; tries++) {
        if (ch.n === 0) return done('error', `no legal options for ${pd.kind} (all rolled back)`);
        let pick: Pick = 0;
        if (ch.n > 1) { pick = await agent.choose(o.env, s, actor, ch, moves[actor]++); decisions++; }
        try {
          s = typeof pick === 'number' ? o.env.step(s, pick, ch) : o.env.applyAction(s, pick.action);
          break;
        } catch (e) {
          if (!(e instanceof RollbackError)) throw e;
          agent.rolledBack?.(); rollbacks++;
          const bad = typeof pick === 'number' ? pick : ch.keys.indexOf(JSON.stringify(pick.action));
          ch = o.env.restrict(ch, [...Array(ch.n).keys()].filter(k => k !== (bad >= 0 ? bad : 0)));
        }
      }
    }
  } catch (e) {
    if (e instanceof Aborted) throw e;
    return done('error', (e as Error).stack?.slice(0, 600) ?? String(e));
  }
}

/** Fill z for recorded positions from the game result: +1 win / -1 loss; a timeout scores timeoutShaping × the
 *  clipped point difference (0 = plain draw); `shaping` optionally blends the point difference into every game. */
export function assignOutcome(positions: Position[], r: GameResult, shaping: number, timeoutShaping: number): Position[] {
  for (const p of positions) {
    const diff = Math.max(-1, Math.min(1, ((r.points[p.actor] ?? 0) - (r.points[1 - p.actor] ?? 0)) / Math.max(1, r.victoryScore)));
    const z = r.winner === null ? timeoutShaping * diff : (p.actor === r.winner ? 1 : -1);
    p.z = (1 - shaping) * z + shaping * diff;
  }
  return positions;
}

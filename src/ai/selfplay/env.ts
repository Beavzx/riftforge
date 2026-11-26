// SELFPLAY: the decision environment the search and the self-play loop drive.
//
// The search never calls the engine directly; it goes through a SearchEnv. The default EngineEnv exposes the engine's
// own legal-action list (getLegalActions) minus actions self-play must never take (concede, UI cancel).
// The factored env (factored-env.ts over src/ai/env/factored.ts — big decisions broken into small sub-choices with
// complete option lists) is the default (`env.kind: factored`). Its state carries the partial sub-choice, which is
// why the interface is generic over S.
import type { Action, GameState, PlayerId } from '../../engine/types.ts';
import { applyAction, getLegalActions } from '../../engine/index.ts';
import { determinize } from '../determinize.ts';
import { encodeActions, MAX_PTRS, ACTION, type EncodedActions, type Observation } from '../encode/index.ts';

/** Keep only the rows `keep` of an encoded option list. */
export function sliceEncoded(e: EncodedActions, keep: number[]): EncodedActions {
  const A = ACTION.dim, P = MAX_PTRS, n = keep.length;
  const out: EncodedActions = { n, feats: new Float32Array(n * A), ptrIdx: new Int32Array(n * P), ptrRole: new Int32Array(n * P), ptrVal: new Float32Array(n * P) };
  keep.forEach((r, j) => {
    out.feats.set(e.feats.subarray(r * A, (r + 1) * A), j * A);
    out.ptrIdx.set(e.ptrIdx.subarray(r * P, (r + 1) * P), j * P);
    out.ptrRole.set(e.ptrRole.subarray(r * P, (r + 1) * P), j * P);
    out.ptrVal.set(e.ptrVal.subarray(r * P, (r + 1) * P), j * P);
  });
  return out;
}

export interface Choices {
  /** number of options (>= 1 when not terminal) */
  n: number;
  /** stable string key per option (same option ⇒ same key across determinizations of one information set) */
  keys: string[];
  /** engine actions when each option is a full engine action (EngineEnv); undefined for sub-choices */
  actions?: Action[];
  /** encode the options for the policy head against an observation of `actor` */
  encode(obs: Observation): EncodedActions;
}

export interface SearchEnv<S = GameState> {
  readonly kind: string;
  /** wrap a game state */
  root(g: GameState): S;
  /** the game state underneath (for encoding / terminal checks) */
  game(s: S): GameState;
  /** whose decision it is (null when the game is over or nothing is pending) */
  actor(s: S): PlayerId | null;
  choices(s: S, actor: PlayerId, opts?: { forceEndTurn?: boolean }): Choices;
  /** take option i; returns the new state (never mutates s). Throws RollbackError if the engine rolled the action
   *  back (e.g. a target whose payment then fails): the caller must treat that option as illegal. */
  step(s: S, i: number, ch: Choices): S;
  /** apply a whole engine action (engine-level bots); throws RollbackError like step() */
  applyAction(s: S, a: Action): S;
  /** the same choices restricted to the options at `keep` (used to mask out rolled-back options) */
  restrict(ch: Choices, keep: number[]): Choices;
  /** a copy of s where everything `p` cannot know is resampled (src/ai/determinize.ts) */
  determinize(s: S, p: PlayerId, r: () => number): S;
}

const BANNED = new Set(['concede', 'cancel']);

/** The engine undid the action (events[0].type === 'rollback', state unchanged): the option is effectively illegal. */
export class RollbackError extends Error { constructor(public key: string) { super(`action rolled back: ${key.slice(0, 120)}`); } }
export function keyOfAction(a: Action): string { return JSON.stringify(a); }

export class EngineEnv implements SearchEnv<GameState> {
  readonly kind = 'engine';
  root(g: GameState) { return g; }
  game(s: GameState) { return s; }
  actor(s: GameState): PlayerId | null { return s.winner !== null || !s.pending ? null : s.pending.player; }
  choices(s: GameState, actor: PlayerId, opts: { forceEndTurn?: boolean } = {}): Choices {
    let legal = getLegalActions(s, actor).filter(a => !BANNED.has(a.type));
    if (opts.forceEndTurn) { const e = legal.filter(a => a.type === 'endTurn'); if (e.length) legal = e; }
    return { n: legal.length, keys: legal.map(keyOfAction), actions: legal, encode: (obs) => encodeActions(s, actor, legal, obs) };
  }
  step(s: GameState, i: number, ch: Choices): GameState {
    const r = applyAction(s, ch.actions![i]);
    if (r.events[0]?.type === 'rollback') throw new RollbackError(ch.keys[i]);
    return r.state;
  }
  restrict(ch: Choices, keep: number[]): Choices {
    const actions = keep.map(i => ch.actions![i]);
    const keys = keep.map(i => ch.keys[i]);
    return { n: keep.length, keys, actions, encode: (obs) => { const full = ch.encode(obs); return sliceEncoded(full, keep); } };
  }
  applyAction(s: GameState, a: Action): GameState {
    const r = applyAction(s, a);
    if (r.events[0]?.type === 'rollback') throw new RollbackError(keyOfAction(a));
    return r.state;
  }
  determinize(s: GameState, p: PlayerId, r: () => number): GameState { return determinize(s, p, r); }
}

/** env.kind: 'factored' (default: src/ai/env/factored.ts sub-choices, see factored-env.ts) or 'engine' (raw legal list). */
export async function makeEnv(kind: 'engine' | 'factored'): Promise<SearchEnv<any>> {
  if (kind === 'engine') return new EngineEnv();
  const mod = await import('./factored-env.ts');
  return mod.makeFactoredSearchEnv();
}

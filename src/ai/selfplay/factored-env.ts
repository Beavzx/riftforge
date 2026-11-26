// SELFPLAY: SearchEnv over the factored action layer (src/ai/env/factored.ts). Default action source for self-play.
//
// Every sub-choice is one tree level / one recorded decision: "add this unit to the move", "2 damage to X", "pay with
// these runes", or a pass-through engine action. The state carries the sub-choice in progress plus the option ids
// picked so far in this decision, so a determinisation can replay the same partial decision on the resampled state.
// Engine actions built by the layer are applied with the rollback check (an action the engine undoes is illegal).
import type { Action, GameState, PlayerId } from '../../engine/types.ts';
import { applyAction } from '../../engine/index.ts';
import { factor, isAction, type FactorOptions, type FNode, type SubChoice as FSubChoice } from '../env/factored.ts';
import { determinize } from '../determinize.ts';
import { encodeSubChoices, type EncodedActions, type Observation } from '../encode/index.ts';
import { RollbackError, sliceEncoded, type Choices, type SearchEnv } from './env.ts';

export interface FState { g: GameState; node: FNode | null; path: string[] }

interface FChoices extends Choices { node: FNode; map: number[] }

function emptyEncoded(): EncodedActions {
  return { n: 0, feats: new Float32Array(0), ptrIdx: new Int32Array(0), ptrRole: new Int32Array(0), ptrVal: new Float32Array(0) };
}

/** Encode a factored sub-choice (the encoder handles pass-through engine actions with full action rows). */
export function encodeFactored(g: GameState, actor: PlayerId, c: FSubChoice, obs: Observation): EncodedActions {
  return encodeSubChoices(g, actor, c, obs);
}

export class FactoredEnv implements SearchEnv<FState> {
  readonly kind = 'factored';
  constructor(private opts: FactorOptions = {}) {}
  root(g: GameState): FState { return { g, node: null, path: [] }; }
  game(s: FState) { return s.g; }
  private nodeOf(s: FState): FNode | null { return s.node ?? (s.node = factor(s.g, this.opts)); }
  actor(s: FState): PlayerId | null {
    if (s.g.winner !== null || !s.g.pending) return null;
    return this.nodeOf(s)?.choice.player ?? s.g.pending.player;
  }
  choices(s: FState, actor: PlayerId, opts: { forceEndTurn?: boolean } = {}): FChoices {
    const node = this.nodeOf(s);
    if (!node) return { n: 0, keys: [], node: null as unknown as FNode, map: [], encode: () => emptyEncoded() };
    const c = node.choice;
    let map = c.options.map((_, i) => i);
    if (opts.forceEndTurn) { const e = map.filter(i => c.options[i].action?.type === 'endTurn'); if (e.length) map = e; }
    const keys = map.map(i => { const o = c.options[i]; return o.action ? JSON.stringify(o.action) : `${c.kind}:${c.step}:${o.id}`; });
    const actions = map.every(i => c.options[i].action) ? map.map(i => c.options[i].action!) : undefined;
    const full = map.length === c.options.length;
    return {
      n: map.length, keys, actions, node, map,
      encode: (obs) => { const e = encodeFactored(s.g, actor, c, obs); return full ? e : sliceEncoded(e, map); },
    };
  }
  step(s: FState, i: number, ch: Choices): FState {
    const fc = ch as FChoices;
    const oi = fc.map[i];
    const id = fc.node.choice.options[oi].id;
    const r = fc.node.pick(oi);
    if (isAction(r)) return this.applyAction(s, r, ch.keys[i]);
    return { g: s.g, node: r, path: [...s.path, id] };
  }
  restrict(ch: Choices, keep: number[]): Choices {
    const fc = ch as FChoices;
    return { ...fc, n: keep.length, keys: keep.map(i => fc.keys[i]), actions: fc.actions ? keep.map(i => fc.actions![i]) : undefined,
      map: keep.map(i => fc.map[i]), encode: (obs) => sliceEncoded(fc.encode(obs), keep) } as FChoices;
  }
  /** apply a whole engine action (bots, or the end of a factored decision) */
  applyAction(s: FState, a: Action, key = JSON.stringify(a)): FState {
    const r = applyAction(s.g, a);
    if (r.events[0]?.type === 'rollback') throw new RollbackError(key);
    return { g: r.state, node: null, path: [] };
  }
  determinize(s: FState, p: PlayerId, rng: () => number): FState {
    const g = determinize(s.g, p, rng);
    let node = factor(g, this.opts);
    for (const id of s.path) {
      if (!node) throw new Error('factored replay: decision vanished');
      const k = node.choice.options.findIndex(o => o.id === id);
      if (k < 0) throw new Error(`factored replay: option ${id} missing after determinisation`);
      const r = node.pick(k);
      if (isAction(r)) throw new Error('factored replay: decision finished early');
      node = r;
    }
    return { g, node, path: s.path.slice() };
  }
}

export function makeFactoredSearchEnv(opts: FactorOptions = {}): FactoredEnv { return new FactoredEnv(opts); }

// SELFPLAY → COACH adapter: lets the coach/review tools (src/ai/coach/) use the trained network instead of the
// hand-tuned evaluation. INTEGRATION POINT (lead): wire NNCoach.analyse into the coach's analyse()/review pipeline.
//
//   const nn = await NNCoach.connect({ port: 47000 });          // an inference server running for the run
//   const a = await nn.analyse(state, player, { sims: 256 });   // ranked candidates with win% and visits
//
// Values from the network are in [-1, 1] for the player to act; winProb = (v + 1) / 2.
import type { Action, GameState, PlayerId } from '../../engine/types.ts';
import { makeRng } from '../../engine/rng.ts';
import { encodeActions, encodeObservation } from '../encode/index.ts';
import { EngineEnv } from './env.ts';
import { InferenceClient, SLOT_BEST, type ClientOptions } from './client.ts';
import type { Evaluator } from './evaluator.ts';
import { Mcts } from './mcts.ts';
import { DEFAULT_CAPS, DEFAULT_SEARCH, type CapsConfig, type SearchConfig } from './config.ts';

/** Minimal evaluator interface for the coach: a position's value and a prior per legal action. */
export interface NNEvaluator {
  evaluate(state: GameState, player: PlayerId, legal?: Action[]): Promise<{ value: number; winProb: number; legal: Action[]; priors: number[] }>;
}

export interface NNCandidate { action: Action; prior: number; visits: number; q: number | null; winProb: number | null; improvedPolicy: number }
export interface NNAnalysis { player: PlayerId; value: number; winProb: number; rootValue: number; best: Action; candidates: NNCandidate[]; sims: number }

export class NNCoach implements NNEvaluator {
  private env = new EngineEnv();
  constructor(private ev: Evaluator, private slot = SLOT_BEST, private search: SearchConfig = { ...DEFAULT_SEARCH, fullProb: 1 }, private caps: CapsConfig = DEFAULT_CAPS) {}

  static async connect(o: ClientOptions & { slot?: number; search?: Partial<SearchConfig> }): Promise<NNCoach> {
    const c = await InferenceClient.connect({ retries: 5, ...o });
    return new NNCoach(c, o.slot ?? SLOT_BEST, { ...DEFAULT_SEARCH, fullProb: 1, ...(o.search ?? {}) });
  }

  async evaluate(state: GameState, player: PlayerId, legal?: Action[]) {
    const acts = legal ?? this.env.choices(state, player).actions!;
    const obs = encodeObservation(state, player);
    const r = await this.ev.evaluate({ obs, acts: encodeActions(state, player, acts, obs) }, this.slot);
    const m = Math.max(...r.logits); const ex = Array.from(r.logits, x => Math.exp(x - m)); const s = ex.reduce((a, b) => a + b, 0);
    return { value: r.value, winProb: (r.value + 1) / 2, legal: acts, priors: ex.map(x => x / s) };
  }

  /** Search the decision with the network (no exploration noise) and rank every option. */
  async analyse(state: GameState, player: PlayerId, o: { sims?: number; seed?: number } = {}): Promise<NNAnalysis> {
    const ch = this.env.choices(state, player);
    if (ch.n === 0) throw new Error('no legal actions');
    const mcts = new Mcts(this.env, this.ev, this.search, this.caps);
    if (ch.n === 1) {
      const e = await this.evaluate(state, player);
      return { player, value: e.value, winProb: e.winProb, rootValue: e.value, best: ch.actions![0], sims: 0,
        candidates: [{ action: ch.actions![0], prior: 1, visits: 0, q: null, winProb: null, improvedPolicy: 1 }] };
    }
    const r = await mcts.search(state, player, ch, { sims: o.sims ?? 256, noise: false, rng: makeRng(o.seed ?? 1), slot: this.slot });
    const m = Math.max(...r.logits); const ex = Array.from(r.logits, x => Math.exp(x - m)); const s = ex.reduce((a, b) => a + b, 0);
    const candidates = ch.actions!.map((action, i) => ({
      action, prior: ex[i] / s, visits: r.visits[i], q: Number.isNaN(r.q[i]) ? null : r.q[i],
      winProb: Number.isNaN(r.q[i]) ? null : (r.q[i] + 1) / 2, improvedPolicy: r.policy[i],
    })).sort((a, b) => b.improvedPolicy - a.improvedPolicy);
    return { player, value: r.value, winProb: (r.value + 1) / 2, rootValue: r.rootValue, best: ch.actions![r.choice], candidates, sims: r.sims };
  }

  async close() { await this.ev.close?.(); }
}

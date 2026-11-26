// SELFPLAY: network evaluation. An Evaluator turns (observation, encoded options) into a value for the observing
// player (in [-1, 1]) and one logit per option. Implementations:
//   InferenceClient (client.ts) — the Python inference server over a socket (torch or mock backend)
//   UniformEvaluator           — in-process stand-in (uniform priors, value 0) for tests and dry runs
import type { EncodedActions, Observation } from '../encode/index.ts';

export interface EvalRequest { obs: Observation; acts: EncodedActions }
export interface EvalResult { value: number; logits: Float32Array }

export interface Evaluator {
  evaluate(req: EvalRequest, slot?: number): Promise<EvalResult>;
  /** number of evaluations served so far (stats) */
  readonly count: number;
  close?(): Promise<void> | void;
}

/** In-process evaluator with no network: uniform logits, constant value (optionally a cheap deterministic jitter). */
export class UniformEvaluator implements Evaluator {
  count = 0;
  constructor(private value = 0, private jitter = 0) {}
  async evaluate(req: EvalRequest): Promise<EvalResult> {
    this.count++;
    const logits = new Float32Array(req.acts.n);
    if (this.jitter) for (let i = 0; i < logits.length; i++) logits[i] = this.jitter * Math.sin(1 + i * 12.9898 + this.count * 78.233);
    return { value: this.value, logits };
  }
}

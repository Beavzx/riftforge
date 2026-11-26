// COACH: map the hand-tuned evaluation (src/ai/eval.ts, arbitrary units) to an estimated win probability with a
// logistic fit on self-play outcomes (tools/coach-calibrate.ts writes data/coach-calibration.json).
// p(win) = 1 / (1 + exp(-(a + b * eval)))   where eval is evaluate(g, p) from the deciding player's point of view.
// The fit is a coarse calibration of a heuristic, not a learned value network: treat differences of a few percent as noise.
import { WIN } from '../eval.ts';
import calib from '../../../data/coach-calibration.json' with { type: 'json' };

export interface Calibration {
  a: number; b: number;
  /** fit diagnostics (held-out games) */
  n?: number; games?: number; logLoss?: number; baselineLogLoss?: number; brier?: number; accuracy?: number; auc?: number;
  bins?: { lo: number; hi: number; n: number; predicted: number; observed: number }[];
  policy?: string; date?: string;
}

let C: Calibration = calib as Calibration;
export function calibration(): Calibration { return C; }
/** tests / experiments */
export function setCalibration(c: Calibration): void { C = c; }

export function winProb(evalScore: number, c: Calibration = C): number {
  if (evalScore >= WIN / 2) return 1;
  if (evalScore <= -WIN / 2) return 0;
  const z = c.a + c.b * evalScore;
  return 1 / (1 + Math.exp(-z));
}

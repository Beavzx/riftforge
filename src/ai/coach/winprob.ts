// COACH: map the hand-tuned evaluation (src/ai/eval.ts, arbitrary units) to an estimated win probability with a
// logistic fit on self-play outcomes (tools/coach-calibrate.ts writes data/coach-calibration.json).
// p(win) = 1 / (1 + exp(-(a + b * f(eval)))), f(x) = sign(x) * ln(1 + |x| / scale)   (scale = 20 by default)
// where eval is evaluate(g, p) from the deciding player's point of view. The log compression fits the tails much
// better than a linear term (large leads are less certain than a linear logistic claims; see the calibration file).
// The fit is a coarse calibration of a heuristic, not a learned value network: treat differences of a few percent as noise.
import { WIN } from '../eval.ts';
import calib from '../../../data/coach-calibration.json' with { type: 'json' };

export interface Calibration {
  a: number; b: number;
  /** feature transform: 'log1p' (default when scale is set) or 'linear' */
  transform?: 'log1p' | 'linear';
  scale?: number;
  /** fit diagnostics (held-out games) */
  n?: number; games?: number; logLoss?: number; baselineLogLoss?: number; brier?: number; accuracy?: number; auc?: number;
  bins?: { lo: number; hi: number; n: number; predicted: number; observed: number }[];
  policy?: string; date?: string;
}

let C: Calibration = calib as Calibration;
export function calibration(): Calibration { return C; }
/** tests / experiments */
export function setCalibration(c: Calibration): void { C = c; }

export function feature(x: number, c: Calibration = C): number {
  if (c.transform === 'linear' || !c.scale) return Math.max(-200, Math.min(200, x));
  return Math.sign(x) * Math.log1p(Math.abs(x) / c.scale);
}

export function winProb(evalScore: number, c: Calibration = C): number {
  if (evalScore >= WIN / 2) return 1;
  if (evalScore <= -WIN / 2) return 0;
  const z = c.a + c.b * feature(evalScore, c);
  return 1 / (1 + Math.exp(-z));
}

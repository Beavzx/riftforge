// BASICS rules oracle: what a skilled player could do with the resources on the table (independent of
// src/engine/payment.ts). Brute force over every way to use the runes, the pool and the Add sources.
//
// Resource rules used (docs/rules-spec.md §2):
// - CR 164.2: a basic rune has "[T]: Add [1]" and "Recycle this: Add [C]" (its domain); a rune may do both (exhaust, then
//   recycle), an exhausted rune can still be recycled.
// - CR 163, 135.2.e.5-6: energy pays the number, power pays domain symbols; [A] = any domain; [C] on a multi-domain card =
//   one power of any one of its domains; on a domainless card [C] = [A]. Power never pays energy and vice versa.
// - CR 165-167: pool resources are spent like produced ones; CR 357.1.a / 430.3: Reaction Add abilities can be used mid-payment.
//
// "Best" (what a skilled player ends with), compared lexicographically:
//   1. losses   — fewest resources permanently gone: runes recycled + Gold tokens killed (a recycled rune and a spent Gold
//                 token are both one permanent resource; which of the two to spend is a player call, so they tie);
//   2. energy   — most energy still available this turn: pool energy + ready runes + ready free energy Add sources;
//   3. power    — most power still available without a loss: pool power + ready free power Add sources.
// "Free" Add sources are exhaust-only Add abilities on cards with no other use (bx-legend-add1, bx-seal): using one costs
// nothing a later play could have used, so it beats recycling a rune.
import type { Domain } from '../../src/engine/types.ts';

export type Req = Domain[] | 'any';
export interface Cost { energy: number; power: Req[] }
export interface RuneR { domain: Domain; ready: boolean }
export interface AddR { kind: 'gold' | 'free'; energy: number; power: (Domain | 'any')[] }
export interface Res { poolE: number; poolP: Partial<Record<Domain, number>>; runes: RuneR[]; adds: AddR[] }
export interface Vec { losses: number; energy: number; power: number }

export const vecStr = (v: Vec | null) => (v ? `losses=${v.losses} energy=${v.energy} power=${v.power}` : 'unaffordable');
/** <0: a better than b */
export function cmpVec(a: Vec, b: Vec): number {
  if (a.losses !== b.losses) return a.losses - b.losses;
  if (a.energy !== b.energy) return b.energy - a.energy;
  return b.power - a.power;
}

type Unit = Domain | 'any';
function fits(r: Req, u: Unit): boolean { return u === 'any' || r === 'any' || r.includes(u as Domain); }
function canMatch(reqs: Req[], units: Unit[]): boolean {
  if (reqs.length > units.length) return false;
  const used = new Array(units.length).fill(false);
  const order = [...reqs].sort((a, b) => (a === 'any' ? 1 : 0) - (b === 'any' ? 1 : 0));
  const rec = (i: number): boolean => {
    if (i === order.length) return true;
    for (let k = 0; k < units.length; k++) if (!used[k] && fits(order[i], units[k])) { used[k] = true; if (rec(i + 1)) return true; used[k] = false; }
    return false;
  };
  return rec(0);
}

/** Best end vector for paying `cost` from `res`, or null if it can't be paid. */
export function bestPayment(res: Res, cost: Cost): Vec | null {
  // classes of identical runes
  const classes = new Map<string, { domain: Domain; ready: boolean; n: number }>();
  for (const r of res.runes) { const k = `${r.domain}|${r.ready}`; const c = classes.get(k) ?? { domain: r.domain, ready: r.ready, n: 0 }; c.n++; classes.set(k, c); }
  const cls = [...classes.values()];
  const poolUnits: Unit[] = [];
  for (const [d, n] of Object.entries(res.poolP)) for (let i = 0; i < (n ?? 0); i++) poolUnits.push(d === 'Colorless' ? 'any' : d as Domain);
  let best: Vec | null = null;
  // per class choice: ready → [exhaustOnly, exhaustAndRecycle, recycleOnly]; exhausted → [recycle]
  const choices: number[][][] = cls.map(c => {
    const out: number[][] = [];
    if (c.ready) { for (let a = 0; a <= c.n; a++) for (let b = 0; a + b <= c.n; b++) for (let r = 0; a + b + r <= c.n; r++) out.push([a, b, r]); }
    else for (let r = 0; r <= c.n; r++) out.push([0, 0, r]);
    return out;
  });
  const nAdds = res.adds.length;
  const rec = (ci: number, pick: number[][]) => {
    if (ci < cls.length) { for (const ch of choices[ci]) { pick.push(ch); rec(ci + 1, pick); pick.pop(); } return; }
    for (let mask = 0; mask < (1 << nAdds); mask++) {
      let energy = res.poolE, losses = 0, readyLeft = 0;
      const units: Unit[] = [...poolUnits];
      cls.forEach((c, i) => {
        const [a, b, r] = pick[i];
        energy += a + b;
        losses += b + r;
        for (let k = 0; k < b + r; k++) units.push(c.domain);
        if (c.ready) readyLeft += c.n - a - b - r;
      });
      let freeE = 0, freeP = 0;
      res.adds.forEach((ad, i) => {
        if (mask & (1 << i)) { energy += ad.energy; units.push(...ad.power); if (ad.kind === 'gold') losses++; }
        else if (ad.kind === 'free') { freeE += ad.energy; freeP += ad.power.length; }
      });
      if (energy < cost.energy || !canMatch(cost.power, units)) continue;
      const v: Vec = { losses, energy: energy - cost.energy + readyLeft + freeE, power: units.length - cost.power.length + freeP };
      if (!best || cmpVec(v, best) < 0) best = v;
    }
  };
  rec(0, []);
  return best;
}

export function affordable(res: Res, cost: Cost): boolean { return bestPayment(res, cost) !== null; }

/** Largest n such that n × [A] can be paid (the "pay any amount of [A]" choice). */
export function maxAnyPower(res: Res, cap = 12): number {
  let n = 0;
  while (n < cap && affordable(res, { energy: 0, power: new Array(n + 1).fill('any') })) n++;
  return n;
}

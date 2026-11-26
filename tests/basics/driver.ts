// BASICS test driver: one node:test test per (moment × kind) group, each running every resource-state cell of that group.
// Failures of a documented payment-choice pattern (docs/auto-decisions.md, owned by AUTO-AUDIT) mark the test todo instead of
// failing it; any other failed check fails the test.
import { test } from 'node:test';
import { assert } from '../conformance/harness.ts';
import { cells, runCell, kindLabel, FULL, RES_STATES, type Cell, type Check, type CellResult, type Kind, type Moment, type ResState } from './matrix.ts';

/** Documented payment-choice patterns (not rules bugs): flag → where it is recorded. */
export const KNOWN: Record<string, string> = {
  domain: 'docs/auto-decisions.md A-1 (BASICS B-1): which domain to recycle for [A] / multi-domain [C] is the player\'s call; auto-pay takes the first rune in play order, which can be the last rune of a domain',
};

function knownFailure(r: CellResult, c: Check): string | null {
  if (c.cat !== 'payment') return null;
  // (A-1 / B-1 'domain' is no longer a known failure: ENGINE-7 implemented the rules-decisions #66 tie-break — a lost last rune
  // of a domain now fails the test)
  void r;
  return null;
}

/** Resource states run by default for a moment (the full cross with BASICS_FULL=1). */
export const FULL_RES_MOMENTS: Moment[] = ['first', 'afterPowerPlay', 'afterFloatP', 'oppChain', 'showdownFocus'];
export const SMALL_RES: ResState[] = ['plenty', 'exact', 'short'];
export function resFor(m: Moment): ResState[] { return FULL || FULL_RES_MOMENTS.includes(m) ? RES_STATES : SMALL_RES; }

export function matrixCells(kinds: Kind[], moments: Moment[]): Cell[] {
  return moments.flatMap(m => cells(kinds, [m], resFor(m)));
}

export function defineMatrix(kinds: Kind[], moments: Moment[]): void {
  const groups = new Map<string, Cell[]>();
  for (const c of matrixCells(kinds, moments)) {
    const k = `${c.moment} | ${kindLabel(c.kind)}`;
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  for (const [name, cs] of groups) {
    test(`BASICS ${name} (${cs.length} resource states)`, t => {
      const bad: string[] = [];
      const known = new Map<string, string[]>();
      for (const c of cs) {
        const r = runCell(c);
        for (const ch of r.checks) {
          if (ch.ok) continue;
          const kf = knownFailure(r, ch);
          const line = `${c.res}: [${ch.cat}] ${ch.name}${ch.msg ? ` — ${ch.msg}` : ''}`;
          if (kf) known.set(kf, [...(known.get(kf) ?? []), line]); else bad.push(line);
        }
      }
      if (!bad.length && known.size) t.todo([...known.keys()].map(k => KNOWN[k]).join('; '));
      assert.ok(bad.length === 0 && known.size === 0, [...bad, ...[...known.values()].flat()].join('\n'));
    });
  }
}

// Combat damage assignment vs prevention / "can't be dealt damage" (lead request A-3, docs/auto-decisions.md;
// DECISIONS row "A-3 / 6949 — combat damage assignment and prevention", ADJUDICATOR-5).
//
// CR 467.2.c.3: units must receive lethal damage in full before damage goes to another unit.
// CR 467.2.c.4: no more than the minimum lethal "unless no further units remain to have damage assigned to them".
// CR 467.2.c.5: replacement effects (prevention, doubling) apply to the assignment ("prevent the first 3" on a 2-Might
//   unit → it needs 5 assigned to have lethal).
// CR 467.2.c.10: "If a unit cannot be dealt damage, then no amount of damage can be considered lethal. Such a unit is
//   exempt from any considerations of mandatory assignment." (Kayn) — but Counter Strike's unit "has a replacement effect
//   applied to it, but it still can be dealt damage. Thus, it is not exempt from considerations of mandatory assignment."
//
// Decided: (1) a unit that can't be dealt damage (Kayn) is skipped in the order, and may receive damage only as excess once
// every other unit has lethal; (2) a unit whose damage will be prevented stays in the order with lethal computed through the
// prevention — for a prevent-all / prevent-the-next-instance shield no amount is lethal, so once the assigner reaches it in
// its tier (after any same-tier units it chose to put first, 467.2.c.7) all remaining damage goes to it.
// The tests go through assignTargets so they don't depend on how the engine represents an unreachable lethal amount.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, act, put, resolveAll, setController, zoneOf } from '../fixtures/helpers.ts';
import { fullDb } from '../fixtures/cards.ts';
import { validateAssignment, assignTargets, suggestAssignment, type AssignTarget } from '../../src/engine/showdown.ts';
import { addPreventShield } from '../../src/engine/testkit.ts';
import type { GameState, ObjId } from '../../src/engine/types.ts';
import { S0, put as hput, P1, BF_A } from '../conformance/harness.ts';

const game = () => newGame({ db: fullDb() });
const ok = (ts: AssignTarget[], total: number, a: Record<string, number>) => validateAssignment(ts, total, a) === null;
// (todos removed by ENGINE-7: A-3 implemented)
const TODO_OLD = 'A-3 / DECIDED-ENGINE (FINDINGS "A-3"): engine treats a prevent-all shield as exempt (lethal null) and ignores Counter Strike; '
  + 'validator lets exempt units take damage before others have lethal';

/** Counter Strike's "The next time that unit would be dealt damage this turn, prevent it." (sfd-194-221 → B7:preventNext) */
function counterStrike(g: GameState, u: ObjId): void {
  g.ex.delayed.push({ id: `d${++g.timestamp}`, controller: g.objects[u].controller, source: null, key: 'B7:preventNext', data: { obj: u, epoch: g.objects[u].epoch ?? 0 }, expires: 'endOfTurn', turn: g.turn, timestamp: g.timestamp } as never);
}

test('467.2.c.10: a unit that can\'t be dealt damage (Kayn, moved twice) has no lethal amount — exempt', () => {
  const g = S0();
  const k = hput(g, P1, 'Kayn', BF_A);
  g.objects[k].movesThisTurn = 2; g.objects[k].movedThisTurn = true;
  assert.equal(assignTargets(g, [k], 0)[0].lethal, null);
});

test('467.2.c.3/.4 + .10: an exempt unit may receive damage only as excess, once every other unit has lethal', () => {
  const ts: AssignTarget[] = [{ obj: 'a', lethal: 3, groups: [1] }, { obj: 'k', lethal: null, groups: [1] }];
  assert.ok(ok(ts, 3, { a: 3 }), 'kill a, skip the exempt unit');
  assert.ok(ok(ts, 5, { a: 3, k: 2 }), 'excess may go to the exempt unit once a has lethal');
  assert.ok(ok(ts, 5, { a: 5 }), 'or stay on a (no further units need damage)');
  assert.ok(!ok(ts, 3, { k: 3 }), 'may not dump damage on the exempt unit to spare a');
  assert.ok(!ok(ts, 3, { a: 1, k: 2 }), 'nor split before a has lethal');
});

test('467.2.c.10: an exempt Tank is skipped — damage goes to the next unit (RJ#6949)', () => {
  const ts: AssignTarget[] = [{ obj: 'k', lethal: null, groups: [0] }, { obj: 'v', lethal: 2, groups: [1] }];
  assert.ok(ok(ts, 4, { v: 4 }));
  assert.deepEqual(suggestAssignment(ts, 4), { v: 4 });
});

test('467.2.c.5: a partial prevent shield raises lethal (3 Might + prevent 2 → 5)', () => {
  const g = game();
  const s = put(g, 1, 't-u3', 0);
  addPreventShield(g, s, 2);
  assert.equal(assignTargets(g, [s], 0)[0].lethal, 5);
});

for (const [label, shield] of [
  ['prevent-all shield', (g: GameState, u: ObjId) => addPreventShield(g, u, 'all')],
  ['Counter Strike (prevent the next damage)', counterStrike],
] as const) {
  test(`467.2.c.10 (Counter Strike example): a unit with a ${label} is NOT exempt — same tier: kill the others first, the rest stays on it`, () => {
    const g = game();
    const s = put(g, 1, 't-u3', 0), v = put(g, 1, 't-u2', 0);
    shield(g, s);
    const ts = assignTargets(g, [s, v], 0);
    assert.notEqual(ts.find(t => t.obj === s)!.lethal, null, 'it can still be dealt damage → not exempt');
    assert.ok(ok(ts, 4, { [v]: 2, [s]: 2 }), 'v lethal first, the rest on the shielded unit');
    assert.ok(ok(ts, 4, { [s]: 4 }), 'or all on the shielded unit (same tier, any order, 467.2.c.7)');
    assert.ok(!ok(ts, 4, { [v]: 4 }), 'no overkill on v while the shielded unit lacks lethal');
    assert.ok(!ok(ts, 4, { [v]: 1, [s]: 3 }), 'v partial and moving on');
    assert.deepEqual(suggestAssignment(ts, 4), { [v]: 2, [s]: 2 }, 'default: kill what can be killed in order');
  });

  test(`467.2.c.6 + .10: a Tank with a ${label} must take all the damage — nothing reaches the units behind it`, () => {
    const g = game();
    const s = put(g, 1, 't-tank', 0), v = put(g, 1, 't-u2', 0);
    shield(g, s);
    const ts = assignTargets(g, [s, v], 0);
    assert.ok(ok(ts, 4, { [s]: 4 }));
    assert.ok(!ok(ts, 4, { [s]: 3, [v]: 1 }), 'the shielded Tank can never have lethal, so the next unit gets nothing');
    assert.ok(!ok(ts, 4, { [v]: 4 }));
    assert.deepEqual(suggestAssignment(ts, 4), { [s]: 4 });
  });
}

test('game: a defending Tank with a prevent-all shield absorbs the whole attack (default assignment) — the 2-Might unit behind it survives', () => {
  let g = game();
  setController(g, 0, 1);
  const s = put(g, 1, 't-tank', 0), v = put(g, 1, 't-u2', 0);
  addPreventShield(g, s, 'all');
  const a = put(g, 0, 't-u4', 'base');
  g = act(g, { type: 'move', player: 0, units: [a], to: 0 });
  for (let i = 0; i < 40 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    if (g.pending.kind === 'assignDamage') {
      const p = g.pending.player;
      const sug = g.pending.data!.suggested as Record<string, number>;
      if (p === 0) assert.deepEqual(sug, { [s]: 4 }, 'suggested: everything on the shielded Tank');
      g = act(g, { type: 'assignDamage', player: p, assignment: sug });
    } else g = resolveAll(g, 1);
  }
  assert.equal(zoneOf(g, v), 'battlefield', 'nothing got past the Tank');
  assert.equal(zoneOf(g, s), 'battlefield', 'the damage to the Tank was prevented');
});
void TODO_OLD;

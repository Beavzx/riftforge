// Several replacement effects on one unit's combat damage (ENGINE-7 OPEN item 2, ENGINE-8).
//
// CR 373: when several replacement effects would apply to one event, the controller of the affected object chooses the order.
// CR 467.2.c.5: replacement effects apply to the combat damage assignment (lethal is computed through them).
// Engine (rules-decisions #74): if the order can change the outcome for some amount the assigner could give the unit (lethal,
// damage dealt, which shield is used up), the unit's controller chooses it before damage is assigned; that order sets the
// lethal amounts and is used when the damage is dealt. If it can't change anything, nothing is asked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, act, put, resolveAll, setController, zoneOf, choose } from '../fixtures/helpers.ts';
import { fullDb } from '../fixtures/cards.ts';
import { addPreventShield } from '../../src/engine/testkit.ts';
import '../../src/cards/scripts/index.ts';   // registers the real delayed abilities (Lotus Trap B1, Counter Strike B7)
import type { GameState, ObjId, Decision } from '../../src/engine/types.ts';
import type { AssignTarget } from '../../src/engine/showdown.ts';

const game = () => newGame({ db: fullDb() });

function delayed(g: GameState, key: string, u: ObjId): string {
  const id = `d${++g.timestamp}`;
  g.ex.delayed.push({ id, controller: g.objects[u].controller, source: null, key, data: { obj: u, epoch: g.objects[u].epoch ?? 0 }, expires: 'endOfTurn', turn: g.turn, timestamp: g.timestamp } as never);
  return 'd:' + id;
}
const lotus = (g: GameState, u: ObjId) => delayed(g, 'B1:lotusTrap', u);          // unl-013-219: double all damage dealt to it
const counterStrike = (g: GameState, u: ObjId) => delayed(g, 'B7:preventNext', u); // sfd-194-221: prevent the next damage
const shieldId = (g: GameState) => 'd:' + g.ex.delayed[g.ex.delayed.length - 1].id;

/** Attack battlefield 0 with `atk`; answer every replacement-order question with `order(decision)`; record the decisions. */
function fight(g: GameState, atk: ObjId[], order: (d: Decision) => string) {
  g = act(g, { type: 'move', player: 0, units: atk, to: 0 });
  const asked: Decision[] = [], assigns: Decision[] = [];
  for (let i = 0; i < 60 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    if (d.kind === 'chooseOrder' && /replacement effect/.test(d.prompt)) { asked.push(d); g = choose(g, order(d)); }
    else if (d.kind === 'assignDamage') { assigns.push(d); g = act(g, { type: 'assignDamage', player: d.player, assignment: d.data!.suggested as Record<string, number> }); }
    else { const n = resolveAll(g, 1); if (n === g) break; g = n; }
  }
  return { g, asked, assigns };
}

function setup() {
  const g = game();
  setController(g, 0, 1);
  return g;
}

for (const [first, survives] of [['prevent', true], ['double', false]] as const) {
  test(`CR 373: prevent 2 + Lotus Trap on a 5-Might defender — its controller chooses; ${first} first → ${survives ? 'survives (4)' : 'dies (6)'}`, () => {
    let g = setup();
    const d = put(g, 1, 't-u5', 0);
    addPreventShield(g, d, 2); const prev = shieldId(g);
    const lt = lotus(g, d);
    const a = put(g, 0, 't-u4', 'base');
    const r = fight(g, [a], () => (first === 'prevent' ? prev : lt));
    g = r.g;
    assert.equal(r.asked.length, 1, 'asked once');
    assert.equal(r.asked[0].player, 1, 'the defending unit\'s controller chooses (CR 373)');
    assert.deepEqual(new Set(r.asked[0].options!.map(o => o.id)), new Set([prev, lt]));
    assert.equal(zoneOf(g, d), survives ? 'battlefield' : 'trash');
  });
}

test('CR 467.2.c.5 + 373: the chosen order sets the lethal amount the attacker must assign (Lotus first → 3, prevent first → 4)', () => {
  for (const [first, lethal] of [['double', 3], ['prevent', 4]] as const) {
    let g = setup();
    const d1 = put(g, 1, 't-u4', 0), d2 = put(g, 1, 't-u2', 0);
    addPreventShield(g, d1, 2); const prev = shieldId(g);
    const lt = lotus(g, d1);
    const a1 = put(g, 0, 't-u5', 'base'), a2 = put(g, 0, 't-u4', 'base');
    const r = fight(g, [a1, a2], () => (first === 'prevent' ? prev : lt));
    assert.equal(r.asked.length, 1);
    const mine = r.assigns.find(x => x.player === 0)!;
    const ts = mine.data!.targets as AssignTarget[];
    assert.equal(ts.find(t => t.obj === d1)!.lethal, lethal, `${first} first`);
    assert.equal(ts.find(t => t.obj === d2)!.lethal, 2);
    g = r.g;
    assert.equal(zoneOf(g, d1), 'trash', 'killed with the suggested assignment');
    assert.equal(zoneOf(g, d2), 'trash');
  }
});

test('CR 373: Counter Strike + Lotus Trap — every order prevents everything, so nothing is asked', () => {
  let g = setup();
  const d = put(g, 1, 't-u2', 0);
  counterStrike(g, d); lotus(g, d);
  const a = put(g, 0, 't-u4', 'base');
  const r = fight(g, [a], () => { throw new Error('should not ask'); });
  g = r.g;
  assert.equal(r.asked.length, 0);
  assert.equal(zoneOf(g, d), 'battlefield', 'all damage prevented');
  assert.ok(!g.ex.delayed.some(x => x.key === 'B7:preventNext'), 'Counter Strike used up');
});

for (const first of ['all', 'counterStrike'] as const) {
  test(`CR 373: prevent-all shield + Counter Strike — same damage, but the order decides whether Counter Strike is used up (${first} first)`, () => {
    let g = setup();
    const d = put(g, 1, 't-u2', 0);
    addPreventShield(g, d, 'all'); const all = shieldId(g);
    const cs = counterStrike(g, d);
    const a = put(g, 0, 't-u4', 'base');
    const r = fight(g, [a], () => (first === 'all' ? all : cs));
    g = r.g;
    assert.equal(r.asked.length, 1);
    assert.equal(zoneOf(g, d), 'battlefield');
    assert.equal(g.ex.delayed.some(x => x.key === 'B7:preventNext'), first === 'all', 'Counter Strike kept only if the shield applied first');
  });
}

test('CR 373: one replacement only, or none that matter — no question; the order is not kept after the combat', () => {
  let g = setup();
  const d = put(g, 1, 't-u5', 0);
  lotus(g, d);
  const a = put(g, 0, 't-u4', 'base');
  const r = fight(g, [a], () => { throw new Error('should not ask'); });
  assert.equal(r.asked.length, 0);
  assert.equal(zoneOf(r.g, d), 'trash', '4 doubled to 8');
  assert.equal((r.g.ex.combat as { replOrder?: unknown } | null)?.replOrder, undefined);
});

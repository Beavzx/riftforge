// Elder Dragon (unl-118) + Soraka (sfd-173) puzzle (was tests/puzzles/elder-soraka.scenario.ts, a printing script).
// Elder Dragon: "Any amount of your damage is enough to kill enemy units. When you play me, choose up to one enemy unit at each
// location. Deal 1 to them." Soraka: "I must be assigned combat damage last. If another unit you control here would die, if it
// has less Might than me, instead heal it, exhaust it, and recall it."
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { S0, P0, P1, put, control, act, addRunes, BF_A, BF_B } from '../conformance/harness.ts';
import type { Decision, GameState, ObjId } from '../../src/engine/types.ts';

const ED = 'unl-118-219', SOR = 'sfd-173-221';
function mk(): GameState { const g = S0(); addRunes(g, P0, 12, 'body'); return g; }
const zone = (g: GameState, id: ObjId) => g.objects[id]?.zone;

/** Pass priority / showdown focus and order triggers (first option) until another kind of decision or the main phase. */
function passOn(g: GameState): GameState {
  for (let i = 0; i < 60; i++) {
    const d = g.pending;
    if (!d || d.kind === 'mainAction') return g;
    if (d.kind === 'chainResponse' || d.kind === 'showdownAction') { g = act(g, { type: 'pass', player: d.player }); continue; }
    if (d.kind === 'orderTriggers') { g = act(g, { type: 'choose', player: d.player, optionIds: [d.options![0].id] }); continue; }
    return g;
  }
  throw new Error('passOn: too many steps');
}
const expectKind = (g: GameState, kind: Decision['kind'], player = P0): Decision => {
  assert.equal(g.pending?.kind, kind, `expected ${kind}, got ${g.pending?.kind}: ${g.pending?.prompt}`);
  assert.equal(g.pending!.player, player);
  return g.pending!;
};

test('Elder Dragon: as its play trigger goes on the chain, one "up to one enemy unit" prompt per location with enemy units', () => {
  let g = mk();
  const a = put(g, P1, 'V(3)', BF_A), b = put(g, P1, 'V(6)', BF_B), c = put(g, P1, 'V(8)', 'base'), mine = put(g, P0, 'V(2)', BF_A);
  control(g, BF_A, P0); control(g, BF_B, P1);
  g = act(g, { type: 'playCard', player: P0, obj: put(g, P0, ED, 'hand'), destination: 'base' });
  g = passOn(g);
  const seen: ObjId[][] = [];
  for (const want of [a, b, c]) {
    const d = expectKind(g, 'chooseTargets');
    assert.equal(d.min, 0, 'up to one');
    const opts = d.options!.map(o => o.id);
    seen.push(opts);
    assert.deepEqual(opts, [want], `only the enemy unit at that location (${d.prompt})`);
    g = act(g, { type: 'choose', player: P0, optionIds: [want] });
  }
  assert.ok(!seen.flat().includes(mine), 'friendly units are never offered');
  g = passOn(g);
  assert.equal(g.pending?.kind, 'mainAction');
  // 1 damage is lethal for enemy units of any Might
  for (const id of [a, b, c]) assert.equal(zone(g, id), 'trash');
  assert.equal(zone(g, mine), 'battlefield');
});

test('Elder Dragon: declining a location leaves that unit alone', () => {
  let g = mk();
  const a = put(g, P1, 'V(3)', BF_A), b = put(g, P1, 'V(6)', BF_B);
  control(g, BF_A, P0); control(g, BF_B, P1);
  g = act(g, { type: 'playCard', player: P0, obj: put(g, P0, ED, 'hand'), destination: 'base' });
  g = passOn(g);
  g = act(g, { type: 'choose', player: P0, optionIds: [] });     // BF-A: none
  g = act(g, { type: 'choose', player: P0, optionIds: [b] });
  g = passOn(g);
  assert.equal(zone(g, a), 'battlefield');
  assert.equal(g.objects[a].damage, 0);
  assert.equal(zone(g, b), 'trash');
});

/** Elder Dragon on the board; P1 has Soraka (4), V(2) and V(6) at BF-B; P0 deals 2 to one of them with a spell. */
function zap(target: 'v2' | 'v6' | 'soraka') {
  let g = mk();
  put(g, P0, ED, BF_A); control(g, BF_A, P0); control(g, BF_B, P1);
  const ids = { soraka: put(g, P1, SOR, BF_B), v2: put(g, P1, 'V(2)', BF_B), v6: put(g, P1, 'V(6)', BF_B) };
  g = act(g, { type: 'playCard', player: P0, obj: put(g, P0, 'ZapA', 'hand') });
  expectKind(g, 'chooseTargets');
  g = act(g, { type: 'choose', player: P0, optionIds: [ids[target]] });
  return { g: passOn(g), ...ids };
}

test('Elder Dragon + Soraka: spell damage is lethal; Soraka saves an ally with less Might (healed, exhausted, recalled)', () => {
  const { g, v2, soraka } = zap('v2');
  assert.equal(zone(g, v2), 'base', 'recalled instead of dying');
  assert.equal(g.objects[v2].damage, 0, 'healed');
  assert.equal(g.objects[v2].exhausted, true, 'exhausted');
  assert.equal(zone(g, soraka), 'battlefield');
});

test('Elder Dragon + Soraka: an ally with more Might than Soraka is not saved', () => {
  const { g, v6 } = zap('v6');
  assert.equal(zone(g, v6), 'trash');
});

test('Elder Dragon + Soraka: Soraka does not save herself ("another unit")', () => {
  const { g, soraka, v2, v6 } = zap('soraka');
  assert.equal(zone(g, soraka), 'trash');
  assert.equal(zone(g, v2), 'battlefield');
  assert.equal(zone(g, v6), 'battlefield');
});

test('Elder Dragon attacks Soraka + V(2) + V(6): lethal is 1 for each; Soraka (Backline) must be assigned last', () => {
  let g = mk();
  const ed = put(g, P0, ED, 'base'); control(g, BF_B, P1);
  const s = put(g, P1, SOR, BF_B), v2 = put(g, P1, 'V(2)', BF_B), v6 = put(g, P1, 'V(6)', BF_B);
  g = act(g, { type: 'move', player: P0, units: [ed], to: BF_B });
  g = passOn(g);
  const d = expectKind(g, 'assignDamage');
  const data = d.data as { total: number; targets: { obj: ObjId; lethal: number; groups: number[] }[] };
  assert.equal(data.total, 10);
  for (const t of data.targets) assert.equal(t.lethal, 1, 'any amount of Elder Dragon\'s damage is lethal');
  const group = (id: ObjId) => data.targets.find(t => t.obj === id)!.groups[0];
  assert.ok(group(s) > group(v2) && group(s) > group(v6), 'Soraka is in the last group');
  const tryAssign = (assignment: Record<ObjId, number>) => act(g, { type: 'assignDamage', player: P0, assignment });
  assert.throws(() => tryAssign({ [s]: 10 }), /ordering|Backline|last/, 'all to Soraka first is illegal');
  assert.throws(() => tryAssign({ [v2]: 1, [s]: 9 }), /ordering|Backline|last/, 'V(6) must get lethal before Soraka');
  g = tryAssign({ [v2]: 1, [v6]: 1, [s]: 8 });
  // simultaneous deaths: Soraka dies at the same time as V(2) would, and still saves it (she is on the board when it would die)
  g = passOn(g);
  if (g.pending?.kind === 'assignDamage') {
    const p = g.pending;
    assert.equal(p.player, P1);
    g = passOn(act(g, { type: 'assignDamage', player: P1, assignment: { [ed]: 12 } }));
  }
  assert.equal(zone(g, s), 'trash', 'Soraka died');
  assert.equal(zone(g, v6), 'trash', 'V(6) (more Might than Soraka) died');
  assert.equal(zone(g, v2), 'base', 'V(2) was saved by the simultaneous Soraka: recalled');
  assert.equal(g.objects[v2].exhausted, true);
  assert.equal(g.objects[v2].damage, 0);
  assert.equal(zone(g, ed), 'trash', 'Elder Dragon took 12');
});

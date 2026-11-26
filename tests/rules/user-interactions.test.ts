// Interactions the user asked about directly. Each one is a permanent regression test.
import { test } from 'node:test';
import {
  assert, S0, put, hand, pass, act, P0, P1, BF_A, locOf, pend, no, choose, control, fundAll, canPlayNow,
  type GameState, type ObjId,
} from '../conformance/harness.ts';

/**
 * 2026-11-26: "I have 3 units at a battlefield and a hidden Emperor's Divide. My opponent plays Bellows Breath
 * on all three; I flip the hidden card and move 2 of them to base."
 * CR 355.11 / 355.11.b / 355.11.b.1 (Bellows Breath is the CR's own example): the targets no longer fulfil
 * "at the same location", so on resolution the CASTER chooses a legal subset of the ORIGINAL targets, and the
 * subset must be maximal: either the 1 unit still at the battlefield, or both units now in base. Never one base unit.
 */
function setup(): { g: GameState; a: ObjId; b: ObjId; c: ObjId; ed: ObjId } {
  let g = S0();
  fundAll(g, P0, 3); fundAll(g, P1, 3);
  const a = put(g, P1, 'V(3)', BF_A), b = put(g, P1, 'V(3)', BF_A), c = put(g, P1, 'V(3)', BF_A);
  control(g, BF_A, P1);
  const ed = put(g, P1, "Emperor's Divide", { facedown: BF_A });       // hidden on an earlier turn
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Bellows Breath') });
  g = choose(g, a, b, c);
  g = no(g);                                                            // no Repeat
  g = pass(g);                                                          // P1 gets priority with Bellows Breath on the chain
  assert.ok(canPlayNow(g, P1, ed), 'hidden Emperor\'s Divide can be played in response (Hidden → Reaction timing)');
  g = act(g, { type: 'playCard', player: P1, obj: ed });
  for (let i = 0; i < 6 && pend(g).inStep && pend(g).player === P1; i++) g = choose(g, a, b);   // move a and b to base
  return { g, a, b, c, ed };
}

function resolveChoosing(g: GameState, pick: 'base' | 'battlefield'): GameState {
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    assert.equal(d.player, P0, `only the caster chooses (${d.kind}: ${d.prompt})`);
    const opt = d.options!.find(o => pick === 'base' ? /base/i.test(o.label) || o.id === 'base' : !/base/i.test(o.label) && o.id !== 'base');
    assert.ok(opt, `caster can choose ${pick}; options: ${d.options!.map(o => o.label).join(', ')}`);
    g = choose(g, opt!.id);
  }
  return g;
}

test("user Q: Emperor's Divide moves 2 of 3 Bellows Breath targets to base — caster picks base → both moved units take 1", () => {
  const { g: g0, a, b, c } = setup();
  const g = resolveChoosing(g0, 'base');
  assert.deepEqual([a, b, c].map(x => locOf(g, x)), ['base', 'base', BF_A]);
  assert.deepEqual([a, b, c].map(x => g.objects[x].damage), [1, 1, 0], 'maximal subset: both base units, not just one');
});

test("user Q: Emperor's Divide moves 2 of 3 Bellows Breath targets to base — caster picks the battlefield → only the unit left there takes 1", () => {
  const { g: g0, a, b, c } = setup();
  const g = resolveChoosing(g0, 'battlefield');
  assert.deepEqual([a, b, c].map(x => g.objects[x].damage), [0, 0, 1]);
});

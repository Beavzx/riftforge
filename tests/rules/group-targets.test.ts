// ENGINE-5: groups of targets with a collective requirement (CR 355.11.b, 355.11.b.1 — "Any legal subset must include the maximum
// number of legal targets possible for that subset"; DECISIONS "9125 / 3312 re-check", principles 15 and 21).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { S0, put, hand, act, choose, pend, pass, fundAll, control, mod, zone, P0, P1, BF_A, type GameState } from '../conformance/harness.ts';

const opts = (g: GameState) => (pend(g).options ?? []).map(o => o.id);

test('CR 355.11.b Fox-Fire example: four 1-Might targets, two pumped to 2 → the caster picks a maximal subset ({2,2} or {1,1,2}), never stops at {1,2}', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const [a, b, c, d] = [0, 1, 2, 3].map(() => put(g, P1, 'V(1)', BF_A)); control(g, BF_A, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Fox-Fire, Ahri') });
  for (const u of [a, b, c, d]) g = choose(g, u);
  for (let i = 0; i < 6 && pend(g).inStep; i++) g = act(g, { type: 'choose', player: pend(g).player, optionIds: [] });
  assert.equal(g.chain.length, 1, 'Fox-Fire on the chain with four targets');
  mod(g, c, { might: 1 }); mod(g, d, { might: 1 });        // "another player gives two of them +1 Might": 1, 1, 2, 2
  const picks: string[][] = [];
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
    if (!pend(g).inStep) { g = pass(g); continue; }
    const o = opts(g);
    picks.push(o);
    assert.equal(pend(g).min, 1, 'the caster can\'t stop while another original target still fits');
    g = choose(g, o.includes(a) ? a : o.includes(c) ? c : o[0]);   // 1 (a), then 2 (c), then the forced last 1 (b)
  }
  assert.ok(picks.length >= 2, 'the caster chose the subgroup');
  // after 1 (a) + 2 (c), the other 1-Might target (b) still fits and must be added (the only option: chosen automatically)
  assert.deepEqual([a, b, c, d].map(u => zone(g, u)), ['trash', 'trash', 'trash', 'battlefield'], '{1,1,2} killed');
});

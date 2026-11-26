// ENGINE-4: Bonus Damage on split damage (CR 714, 715.3; OGN-FAQ Void Gate; rules-decisions #55; RJ#5474, RJ#8373).
import { test } from 'node:test';
import {
  assert, S0, put, hand, control, act, move, P0, P1, BF_A, BF_B, pend, choose, pass, fundAll, type GameState, type ObjId,
} from '../conformance/harness.ts';

/** answer every in-step decision: targets = `pick` (or all offered), numbers = `n`, other choices = first option */
function settle(g: GameState, pick: ObjId[] | null, n: string, stop: (g: GameState) => boolean): GameState {
  for (let i = 0; i < 30 && !stop(g); i++) {
    const d = pend(g);
    if (d.inStep && d.kind === 'chooseTargets') {
      const ids = d.options!.map(o => o.id).filter(id => !pick || pick.includes(id));
      g = act(g, { type: 'choose', player: d.player, optionIds: ids.slice(0, d.max ?? ids.length) });
      continue;
    }
    if (d.inStep && d.kind === 'chooseNumber') { g = choose(g, n); continue; }
    g = d.inStep ? choose(g, d.options![0].id) : pass(g);
  }
  return g;
}
const dmg = (g: GameState, ids: ObjId[]) => ids.map(id => g.objects[id]?.damage ?? 0);

test('Volibear, Furious with Annie: the split pool is 6 and may be split among up to 6 enemy units (CR 715.3 example)', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'ogs-001-024', 'base');           // Annie: your spells and abilities deal 1 Bonus Damage
  const es = Array.from({ length: 6 }, () => put(g, P1, 'V(9)', BF_A)); control(g, BF_A, P1);
  const v = put(g, P0, 'Volibear, Furious', 'base');
  let maxOffered = 0;
  g = move(g, P0, [v], BF_A);
  for (let i = 0; i < 40 && pend(g).kind !== 'showdownAction'; i++) {
    const d = pend(g);
    if (d.inStep && d.kind === 'chooseTargets' && d.options!.some(o => es.includes(o.id))) {
      maxOffered = Math.max(maxOffered, d.max ?? 0);
      g = act(g, { type: 'choose', player: d.player, optionIds: es }); continue;
    }
    if (d.inStep && d.kind === 'chooseNumber') { g = choose(g, '1'); continue; }
    g = d.inStep ? choose(g, d.options![0].id) : pass(g);
  }
  assert.equal(maxOffered, 6, 'up to 6 recipients (5 + 1 Bonus Damage)');
  assert.deepEqual(dmg(g, es), [1, 1, 1, 1, 1, 1], 'each part 1, no extra bonus per part');
});

test('Volibear, Furious without Bonus Damage: at most 5 recipients (CR 355.14.c)', () => {
  let g = S0(); fundAll(g, P0);
  const es = Array.from({ length: 6 }, () => put(g, P1, 'V(9)', BF_A)); control(g, BF_A, P1);
  const v = put(g, P0, 'Volibear, Furious', 'base');
  let maxOffered = 0;
  g = move(g, P0, [v], BF_A);
  for (let i = 0; i < 40 && pend(g).kind !== 'showdownAction'; i++) {
    const d = pend(g);
    if (d.inStep && d.kind === 'chooseTargets' && d.options!.some(o => es.includes(o.id))) {
      maxOffered = Math.max(maxOffered, d.max ?? 0);
      g = act(g, { type: 'choose', player: d.player, optionIds: es.slice(0, 5) }); continue;
    }
    if (d.inStep && d.kind === 'chooseNumber') { g = choose(g, '1'); continue; }
    g = d.inStep ? choose(g, d.options![0].id) : pass(g);
  }
  assert.equal(maxOffered, 5);
  assert.equal(dmg(g, es).reduce((a, b) => a + b, 0), 5);
});

test('Scorched Earth with Annie: 5 + 1 split between two units (total 6, not 7)', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'ogs-001-024', 'base');
  const e1 = put(g, P1, 'V(9)', BF_A), e2 = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Scorched Earth') });
  g = settle(g, [e1, e2], '2', x => !x.chain.length && pend(x).kind === 'mainAction' && !pend(x).inStep);
  assert.deepEqual(dmg(g, [e1, e2]), [2, 4]);
});

test('Alpha Strike split between a unit at Void Gate and one elsewhere: only the Void Gate part gets the +1 (OGN-FAQ)', () => {
  let g = S0({ bfA: 'Void Gate' }); fundAll(g, P0);
  const f = put(g, P0, 'V(3)', 'base');
  const e1 = put(g, P1, 'V(9)', BF_A), e2 = put(g, P1, 'V(9)', BF_B); control(g, BF_A, P1); control(g, BF_B, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Alpha Strike') });
  for (let i = 0; i < 30 && !(g.chain.length === 0 && pend(g).kind === 'mainAction' && !pend(g).inStep); i++) {
    const d = pend(g);
    if (d.inStep && d.kind === 'chooseTargets') {
      const ids = d.options!.map(o => o.id);
      g = act(g, { type: 'choose', player: d.player, optionIds: ids.includes(f) ? [f] : ids.filter(id => id === e1 || id === e2) }); continue;
    }
    if (d.inStep && d.kind === 'chooseNumber') { g = choose(g, '1'); continue; }
    g = d.inStep ? choose(g, d.options![0].id) : pass(g);
  }
  assert.deepEqual(dmg(g, [e1, e2]), [2, 2], 'pool 3 (no common bonus): 1 (+1 Void Gate) and 2');
});

test('Challenge at Void Gate: fight damage is dealt by the units — no Bonus Damage either way (CR 418.6.b.3; RJ#8373)', () => {
  let g = S0({ bfA: 'Void Gate' }); fundAll(g, P0);
  const f = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(6)', BF_A);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Challenge') });
  let k = 0;
  for (let i = 0; i < 20 && !(g.chain.length === 0 && pend(g).kind === 'mainAction' && !pend(g).inStep); i++) {
    const d = pend(g);
    if (d.inStep && d.kind === 'chooseTargets') { const w = k++ === 0 ? f : e; g = act(g, { type: 'choose', player: d.player, optionIds: [w] }); continue; }
    g = d.inStep ? choose(g, d.options![0].id) : pass(g);
  }
  assert.equal(g.objects[e].damage, 2, 'the friendly 2-Might unit deals 2 (not 3)');
});

void BF_B;

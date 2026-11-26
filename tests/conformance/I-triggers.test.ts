// docs/rules-tests.md §I — Triggers, replacements, layers (T119-T132)
import { test } from 'node:test';
import {
  assert, S0, put, hand, cast, play, pass, passN, expectPending, control, act, move, mod, addPrevent, nextTurn, EventLog,
  P0, P1, BF_A, zone, locOf, mightOf, hasKeyword, resolveChain, passAll, pend, answer, no, endTurn, type GameState,
} from './harness.ts';

test('T119 — "You may" trigger declined = never triggered (once-per-turn not used)', () => {
  let g = S0();
  put(g, P0, 'MaySpellDraw', 'base');
  const v = put(g, P1, 'V(9)', 'base');
  [g] = cast(g, P0, 'ZapM', { targets: [[v]] });
  g = passAll(g);
  expectPending(g, 'optional', P0, 'first spell offers the optional trigger');
  g = no(g);
  g = resolveChain(g);
  [g] = cast(g, P0, 'ZapM', { targets: [[v]] });
  g = passAll(g);
  expectPending(g, 'optional', P0, 'the second spell offers the trigger again');
});

test('T120 — Trigger with no legal target is removed', () => {
  let g = S0();
  put(g, P1, 'V(2)', 'base');                       // enemy unit, but not at a battlefield
  let u: string;
  [g, u] = cast(g, P0, 'PlayZapEnemyBF', { dest: 'base' });
  assert.equal(zone(g, u), 'base');
  assert.equal(g.chain.length, 0, 'trigger removed');
  expectPending(g, 'mainAction', P0, 'no target decision, no error');
});

test('T121 — Leave-the-board trigger sees pre-death info', () => {
  let g = S0();
  const dk = put(g, P0, 'DKMight(2)', BF_A);
  control(g, BF_A, P0);
  mod(g, dk, { might: 3 });
  const t = put(g, P1, 'V(9)', 'base');
  [g] = cast(g, P0, 'KillA', { targets: [[dk]] });
  g = passN(g, 2);
  g = answer(g, { targets: [[t]] }, P0);
  g = resolveChain(g);
  assert.equal(zone(g, dk), 'trash');
  assert.equal(g.objects[t].damage, 5, 'deals 5 (Might when it died)');
});

test('T122 — Replacement prevents death → no Deathknell', () => {
  let g = S0();
  const hg = put(g, P0, 'Hourglass', 'base');
  const dk = put(g, P0, 'DK(2)', BF_A);
  control(g, BF_A, P0);
  const h0 = g.players[0].hand.length;
  [g] = cast(g, P0, 'ZapM', { targets: [[dk]] });
  g = passN(g, 2);
  g = resolveChain(g);
  assert.equal(zone(g, hg), 'trash', 'Hourglass dies instead');
  assert.equal(locOf(g, dk), 'base', 'DK recalled');
  assert.equal(g.objects[dk].damage, 0, 'healed');
  assert.equal(g.objects[dk].exhausted, true, 'exhausted');
  assert.equal(g.players[0].hand.length, h0, 'Deathknell did NOT trigger');
});

test('T123 — Multiple replacements: affected object\'s controller orders', () => {
  let g = S0();
  const h1 = put(g, P0, 'Hourglass', 'base');
  const h2 = put(g, P0, 'Hourglass2', 'base');
  const u = put(g, P0, 'V(2)', 'base');
  [g] = cast(g, P0, 'ZapM', { targets: [[u]] });
  g = passN(g, 2);
  const d = pend(g);
  assert.ok(d.inStep, `P0 is asked which replacement applies (got ${d.kind})`);
  assert.equal(d.player, 0);
  assert.equal(d.options?.length, 2);
  const pick = d.options!.find(o => o.objIds?.includes(h2)) ?? d.options![1];
  g = act(g, { type: 'choose', player: P0, optionIds: [pick.id] });
  g = resolveChain(g);
  const dead = [h1, h2].filter(h => zone(g, h) === 'trash');
  assert.equal(dead.length, 1, 'only one replacement applies');
  assert.equal(locOf(g, u), 'base');
});

test('T124 — Prevent pool', () => {
  let g = S0();
  const u = put(g, P1, 'V(4)', 'base');
  addPrevent(g, u, 3);
  [g] = cast(g, P0, 'ZapM', { targets: [[u]] });
  g = passN(g, 2);
  assert.equal(g.objects[u].damage, 0);
  const pool = () => g.ex.delayed.find(d => d.key === 'builtin:prevent' && d.data.obj === u);
  assert.equal(pool()?.data.remaining, 1, 'pool 1 left');
  [g] = cast(g, P0, 'ZapM', { targets: [[u]] });
  g = passN(g, 2);
  assert.equal(g.objects[u].damage, 1);
  assert.equal(pool(), undefined, 'pool gone');
});

test('T125 — Fully prevented damage isn\'t dealt', () => {
  let g = S0({ tp: P1 });
  const v5 = put(g, P0, 'V(5)', 'base');
  const cs = hand(g, P0, 'CounterStrikeLike');
  [g] = cast(g, P1, 'ElderLike(6)', { dest: 'base', targets: [[v5]] });
  expectPending(g, 'chainResponse', P1);
  g = pass(g);
  g = play(g, P0, cs, { targets: [[v5]] });
  const log = new EventLog();
  g = log.passAll(g);
  assert.equal(zone(g, v5), 'base', 'V(5) survives (Elder\'s "any damage kills" needs damage to be dealt)');
  assert.equal(g.objects[v5].damage, 0);
  assert.ok(!log.of('damage').some(e => e.obj === v5), 'no damage event → no "dealt damage" triggers');
});

test('T126 — Increases before decreases', () => {
  let g = S0();
  const v = put(g, P0, 'V(2)', 'base');
  [g] = cast(g, P0, 'StupefyLike', { targets: [[v]] });
  g = resolveChain(g);
  assert.equal(mightOf(g, v), 1);
  [g] = cast(g, P0, 'PumpA', { targets: [[v]] });
  g = resolveChain(g);
  assert.equal(mightOf(g, v), 4, '2 + 3 − 1');
  let h = S0();
  const w = put(h, P0, 'V(1)', 'base');
  [h] = cast(h, P0, 'StupefyLike', { targets: [[w]] });
  h = resolveChain(h);
  assert.equal(mightOf(h, w), 1, 'minimum 1');
});

test('T127 — Base Might set + modifiers', () => {
  let g = S0();
  const v = put(g, P0, 'V(2)', 'base', { buff: true });
  assert.equal(mightOf(g, v), 3);
  [g] = cast(g, P0, 'DragonFormLike', { targets: [[v]] });
  g = resolveChain(g);
  assert.equal(mightOf(g, v), 6, 'base 5 + buff 1');
  assert.ok((mightOf(g, v) ?? 0) >= 5, 'Mighty');
});

test('T128 — No intermediate state in layers', () => {
  let g = S0();
  put(g, P0, 'MightyWatch', 'base');
  const v = put(g, P0, 'V(2)', 'base');
  [g] = cast(g, P0, 'StupefyLike', { targets: [[v]] });
  g = resolveChain(g);
  const h0 = g.players[0].hand.length;
  [g] = cast(g, P0, 'DragonFormLike', { targets: [[v]] });
  g = resolveChain(g);
  assert.equal(mightOf(g, v), 4, 'base 5 − 1');
  assert.equal(g.players[0].hand.length, h0, 'never 5 → no "becomes Mighty" trigger');
});

test('T129 — "Becomes Mighty" only on crossing', () => {
  let g = S0();
  put(g, P0, 'MightyWatch', 'base');
  const a = put(g, P0, 'V(5)', 'base');
  const b = put(g, P0, 'V(4)', 'base');
  const h0 = g.players[0].hand.length;
  mod(g, a, { might: 0 });
  [g] = cast(g, P0, 'BuffM', { targets: [[a]] });
  g = resolveChain(g);
  assert.equal(g.players[0].hand.length, h0, 'V(5) +1: no trigger');
  [g] = cast(g, P0, 'BuffM', { targets: [[b]] });
  g = resolveChain(g);
  assert.equal(g.players[0].hand.length, h0 + 1, 'V(4) +1: trigger');
});

test('T130 — Leaving the board clears modifications', () => {
  let g = S0();
  const u = put(g, P0, 'V(2)', 'base', { buff: true, damage: 1, stunned: true });
  mod(g, u, { might: 2 });
  [g] = cast(g, P0, 'BounceM', { targets: [[u]] });
  g = resolveChain(g);
  assert.equal(zone(g, u), 'hand');
  g = play(g, P0, u, { dest: 'base' });
  assert.equal(mightOf(g, u), 2, 'no buff / modifiers');
  assert.equal(g.objects[u].damage, 0);
  assert.ok(!g.objects[u].stunned);
  assert.equal(g.objects[u].exhausted, true, 'new object: enters exhausted');
});

test('T131 — Granted keyword with no duration ends on zone change', () => {
  let g = S0();
  const u = put(g, P0, 'V(2)', 'base');
  [g] = cast(g, P0, 'GiveTank', { targets: [[u]] });
  g = resolveChain(g);
  assert.ok(hasKeyword(g, u, 'Tank'));
  g = nextTurn(g);
  assert.ok(hasKeyword(g, u, 'Tank'), 'kept past end of turn');
  g = nextTurn(g);
  [g] = cast(g, P0, 'BounceM', { targets: [[u]] });
  g = resolveChain(g);
  g = play(g, P0, u, { dest: 'base' });
  assert.ok(!hasKeyword(g, u, 'Tank'), 'lost after leaving the board');
});

test('T132 — Control change contests', () => {
  let g = S0();
  const v = put(g, P1, 'V(2)', BF_A);
  control(g, BF_A, P1);
  [g] = cast(g, P0, 'TakeoverLike', { targets: [[v]] });
  g = resolveChain(g);
  assert.equal(g.objects[v].controller, 0);
  assert.equal(g.battlefields[BF_A].contested, true);
  assert.equal(g.battlefields[BF_A].contestedBy, 0, 'contested by P0');
  assert.notEqual(g.battlefields[BF_A].controller, 1, 'P1 lost control');
  assert.ok(g.showdown && !g.showdown.isCombat, 'non-combat showdown');
  assert.equal(g.showdown!.focus, 0);
  g = passN(g, 2);
  assert.equal(g.players[0].points, 1, 'P0 conquers');
  g = endTurn(g, P0);
  g = passAll(g);
  assert.equal(g.objects[v].controller, 1, 'P1 regains the unit at end of turn');
  assert.equal(locOf(g, v), 'base', 'recalled');
  assert.ok(g.players[1].base.includes(v), 'to P1\'s base');
});

void move; void S0 as unknown as GameState;

// docs/rules-tests.md §H — Cleanup and state-based behaviour (T113-T118)
import { test } from 'node:test';
import {
  assert, S0, put, cast, passN, expectPending, control, move, mod, P0, P1, BF_A, zone, locOf, resolveChain, passAll, pend, pass,
  type GameState,
} from './harness.ts';

test('T113 — Lethal damage kill in cleanup', () => {
  let g = S0();
  const v = put(g, P1, 'V(2)', 'base', { damage: 1 });
  const z = put(g, P1, 'V(0)', 'base');
  [g] = cast(g, P0, 'ZapM', { targets: [[v]] });
  g = passN(g, 2);
  assert.equal(zone(g, v), 'trash', 'damage ≥ Might → dies');
  assert.equal(zone(g, z), 'base', '0 Might, 0 damage stays');
});

test('T114 — 0-Might unit dies to 1 damage', () => {
  let g = S0();
  const v = put(g, P1, 'V(1)', 'base');
  mod(g, v, { might: -1 });
  const u = put(g, P0, 'V(1)', 'base');
  g = move(g, P0, [u], BF_A);                       // any action → cleanups run
  g = passAll(g);
  assert.equal(zone(g, v), 'base', '0 Might survives with 0 damage');
  [g] = cast(g, P0, 'ZapM', { targets: [[v]] });
  g = passN(g, 2);
  assert.equal(zone(g, v), 'trash', 'dies once dealt ≥1');
});

test('T115 — Gear stranded at a battlefield recalled', () => {
  let g = S0();
  const u = put(g, P0, 'V(2)', BF_A);
  control(g, BF_A, P0);
  const s = put(g, P0, 'Sword', BF_A);
  g.objects[s].attachedTo = u; g.ex.attachCount = (g.ex.attachCount ?? 0) + 1;
  [g] = cast(g, P0, 'KillA', { targets: [[u]] });
  g = passN(g, 2);
  assert.equal(zone(g, u), 'trash');
  assert.equal(g.objects[s].attachedTo, undefined, 'detached');
  assert.equal(locOf(g, s), 'base', 'recalled to P0\'s base');
  assert.equal(g.objects[s].exhausted, false, 'stays ready');
});

function hiddenThenLost(): GameState {
  let g = S0({ tp: P1 });
  put(g, P0, 'V(1)', BF_A);
  control(g, BF_A, P0);
  const fd = put(g, P0, 'HidU(2)', { facedown: BF_A });
  const a = put(g, P1, 'V(3)', 'base');
  g = move(g, P1, [a], BF_A);
  for (let i = 0; i < 10 && g.showdown && !pend(g).inStep; i++) g = pass(g);
  (g as unknown as { __fd: string }).__fd = fd;
  return g;
}

test('T116 — Facedown card trashed when battlefield control is lost', () => {
  const g = hiddenThenLost();
  const fd = (g as unknown as { __fd: string }).__fd;
  assert.equal(g.battlefields[BF_A].controller, 1, 'P1 conquered BF-A');
  assert.equal(zone(g, fd), 'trash', 'facedown card in P0\'s trash');
  assert.ok(g.players[0].trash.includes(fd));
  assert.equal(g.objects[fd].faceDown, false, 'revealed');
});

test('T117 — Contested removed if contesting player has no units', () => {
  let g = S0();
  put(g, P1, 'Repel', 'base');
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_A);
  g = resolveChain(g);
  assert.equal(locOf(g, u), 'base', 'the trigger moved the unit back');
  assert.equal(g.battlefields[BF_A].contested, false, 'contested removed');
  assert.equal(g.showdown, null, 'showdown unstaged');
  expectPending(g, 'mainAction', P0);
});

test('T118 — Cleanup cascade', () => {
  let g = S0();
  const x = put(g, P1, 'Aura(2)', BF_A);
  const v = put(g, P1, 'V(1)', BF_A, { damage: 1 });
  control(g, BF_A, P1);
  assert.equal(zone(g, v), 'battlefield');
  [g] = cast(g, P0, 'KillA', { targets: [[x]] });
  g = passN(g, 2);
  assert.equal(zone(g, x), 'trash');
  assert.equal(zone(g, v), 'trash', 'second unit dies in the repeated cleanup');
});

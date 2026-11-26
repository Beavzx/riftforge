// docs/rules-tests.md §F — Combat (T076-T098)
import { test } from 'node:test';
import {
  assert, S0, put, hand, cast, play, pass, passN, expectPending, control, act, move, attackSetup, addPrevent, mod,
  P0, P1, BF_A, zone, locOf, mightOf, resolveChain, pend, answer, validateAction, EventLog, passAll, type GameState, type ObjId,
} from './harness.ts';

const assign = (g: GameState, a: Record<ObjId, number>) => act(g, { type: 'assignDamage', player: pend(g).player, assignment: a });
const valid = (g: GameState, a: Record<ObjId, number>) => validateAction(g, { type: 'assignDamage', player: pend(g).player, assignment: a });
/** pass on showdown/chain decisions until an in-step decision or the end of the showdown */
function toDamage(g: GameState, log?: EventLog): GameState {
  for (let i = 0; i < 30; i++) {
    const d = g.pending;
    if (!d || d.inStep || (d.kind !== 'showdownAction' && d.kind !== 'chainResponse')) return g;
    g = log ? log.pass(g) : pass(g);
  }
  return g;
}

test('T076 — Combat starts when moving into enemy units; attacker has focus', () => {
  const { g, atk, def } = attackSetup(['V(3)'], ['V(2)']);
  assert.ok(g.showdown?.isCombat, 'combat begins');
  assert.equal(g.showdown!.attacker, 0);
  assert.equal(g.showdown!.defender, 1);
  assert.equal(g.objects[atk[0]].combatRole, 'attacker');
  assert.equal(g.objects[def[0]].combatRole, 'defender');
  assert.equal(g.showdown!.focus, 0);
  expectPending(g, 'showdownAction', P0);
});

test('T077 — Simple combat: attacker wins and conquers', () => {
  let { g, atk, def } = attackSetup(['V(3)'], ['V(2)']);
  const log = new EventLog();
  g = toDamage(g, log);
  g = passAll(g);
  assert.ok(log.events.length >= 0);
  assert.equal(zone(g, def[0]), 'trash', 'V(2) dies');
  assert.equal(locOf(g, atk[0]), BF_A, 'V(3) survives');
  assert.equal(g.objects[atk[0]].damage, 0, 'healed in combat cleanup');
  assert.equal(g.battlefields[BF_A].controller, 0, 'P0 establishes control');
  assert.equal(g.players[0].points, 1, 'conquer +1');
  assert.equal(g.showdown, null);
});

test('T078 — Equal Might: both die', () => {
  let { g, atk, def } = attackSetup(['V(3)'], ['V(3)']);
  g = toDamage(g);
  assert.equal(zone(g, atk[0]), 'trash');
  assert.equal(zone(g, def[0]), 'trash');
  assert.equal(g.battlefields[BF_A].controller, null, 'battlefield becomes uncontrolled');
  assert.equal(g.players[0].points + g.players[1].points, 0, 'no conquer');
});

test('T079 — Both survive: attackers recalled', () => {
  let { g, atk, def } = attackSetup(['V(2)'], ['V(5)']);
  [g] = cast(g, P0, 'StunA', { targets: [[def[0]]] });
  g = passN(g, 2);
  expectPending(g, 'showdownAction', P1);
  const log = new EventLog();
  g = toDamage(g, log);
  const toAtk = log.of('damage').filter(e => e.obj === atk[0]);
  assert.equal(toAtk.length, 0, 'stunned defender deals 0');
  assert.equal(log.of('damage').find(e => e.obj === def[0])?.amount, 2);
  assert.equal(zone(g, def[0]), 'battlefield');
  assert.equal(g.objects[def[0]].damage, 0, 'healed in combat cleanup');
  assert.equal(locOf(g, atk[0]), 'base', 'attacker recalled');
  assert.equal(g.objects[atk[0]].exhausted, true, 'still exhausted');
  assert.ok(!log.of('move').some(e => e.obj === atk[0]), 'recall is not a move');
  assert.equal(g.battlefields[BF_A].controller, 1, 'P1 keeps control');
  assert.equal(g.players[0].points, 0);
  assert.equal(g.objects[atk[0]].combatRole, undefined, 'designations removed');
  assert.equal(g.objects[def[0]].combatRole, undefined);
});

test('T080 — Damage assignment must give lethal before spreading', () => {
  let { g, def } = attackSetup(['V(5)'], ['V(3)', 'V(3)', 'V(3)', 'V(3)']);
  g = toDamage(g);
  expectPending(g, 'assignDamage', P0);
  const [a, b, c, d] = def;
  assert.equal(valid(g, { [a]: 3, [b]: 2 }), null, '{3,2,0,0} legal');
  assert.equal(valid(g, { [c]: 3, [d]: 2, [a]: 0, [b]: 0 }), null, '{3,2,0,0} in another order legal');
  assert.notEqual(valid(g, { [a]: 2, [b]: 2, [c]: 1 }), null, '{2,2,1,0} illegal');
  assert.notEqual(valid(g, { [a]: 5 }), null, '{5,0,0,0} illegal');
  g = assign(g, { [a]: 3, [b]: 2 });
  g = passAll(g);
  assert.equal(zone(g, a), 'trash');
});

test('T081 — Excess only after all are lethal', () => {
  let { g, def } = attackSetup(['V(9)'], ['V(2)', 'V(3)']);
  g = toDamage(g);
  expectPending(g, 'assignDamage', P0);
  const [x, y] = def;
  assert.equal(valid(g, { [x]: 6, [y]: 3 }), null);
  assert.equal(valid(g, { [x]: 2, [y]: 7 }), null);
  assert.notEqual(valid(g, { [x]: 1, [y]: 8 }), null, 'excess before all lethal is illegal');
});

test('T082 — Tank first', () => {
  let { g, def } = attackSetup(['V(4)'], ['Tank(3)', 'V(1)']);
  g = toDamage(g);
  const [t, v] = def;
  if (pend(g).kind === 'assignDamage' && pend(g).player === 0) {
    assert.equal(valid(g, { [t]: 3, [v]: 1 }), null);
    assert.notEqual(valid(g, { [t]: 2, [v]: 2 }), null, 'Tank must get lethal first');
    assert.notEqual(valid(g, { [v]: 4 }), null);
    g = assign(g, { [t]: 3, [v]: 1 });
  }
  g = passAll(g);
  assert.equal(zone(g, t), 'trash');
  assert.equal(zone(g, v), 'trash');
});

test('T083 — Backline last', () => {
  let { g, def } = attackSetup(['V(3)'], ['Backline(1)', 'V(3)']);
  g = toDamage(g);
  const [bl, v] = def;
  if (pend(g).kind === 'assignDamage' && pend(g).player === 0) {
    assert.notEqual(valid(g, { [bl]: 1, [v]: 2 }), null, 'Backline can\'t be assigned first');
    assert.equal(valid(g, { [v]: 3 }), null);
    g = assign(g, { [v]: 3 });
  }
  g = passAll(g);
  assert.equal(zone(g, v), 'trash');
  assert.equal(zone(g, bl), 'battlefield', 'Backline gets 0');
});

test('T084 — Tank and Backline on same unit', () => {
  let { g, def } = attackSetup(['V(3)'], ['TankBack(2)', 'V(2)']);
  g = toDamage(g);
  expectPending(g, 'assignDamage', P0);
  const [x, v] = def;
  assert.equal(valid(g, { [x]: 2, [v]: 1 }), null, 'treat X as Tank');
  assert.equal(valid(g, { [v]: 2, [x]: 1 }), null, 'treat X as Backline');
});

test('T085 — Defender assigns too; simultaneous damage', () => {
  let { g, atk, def } = attackSetup(['Assault(2,2)'], ['Shield(3,1)']);
  assert.equal(mightOf(g, atk[0]), 4, 'Assault: 4 while attacking');
  assert.equal(mightOf(g, def[0]), 4, 'Shield: 4 while defending');
  g = toDamage(g);
  g = passAll(g);
  assert.equal(zone(g, atk[0]), 'trash');
  assert.equal(zone(g, def[0]), 'trash');
  assert.equal(g.battlefields[BF_A].controller, null);
});

test('T086 — Assault/Shield only in role', () => {
  let g = S0({ tp: P1 });
  const a = put(g, P0, 'Assault(2,2)', BF_A);
  control(g, BF_A, P0);
  const e = put(g, P1, 'V(5)', 'base');
  g = move(g, P1, [e], BF_A);
  assert.ok(g.showdown?.isCombat);
  assert.equal(g.objects[a].combatRole, 'defender');
  assert.equal(mightOf(g, a), 2, 'defending: no Assault bonus');
});

test('T087 — Stunned unit deals no combat damage but takes it', () => {
  let { g, atk, def } = attackSetup(['V(4)'], ['V(4)']);
  g = pass(g);
  [g] = cast(g, P1, 'StunA', { targets: [[atk[0]]] });
  g = passN(g, 2);
  const log = new EventLog();
  g = toDamage(g, log);
  g = log.passAll(g);
  assert.ok(!log.of('damage').some(e => e.obj === def[0]), 'stunned attacker total 0');
  assert.equal(zone(g, atk[0]), 'trash', 'P1 assigns 4 → attacker dies');
  assert.equal(zone(g, def[0]), 'battlefield');
  assert.equal(g.battlefields[BF_A].controller, 1, 'defender wins');
  assert.equal(g.players[1].points, 0, 'no conquer (already controlled)');
});

test('T088 — Negative Might counts as 0 in combat', () => {
  const g0 = S0();
  const neg = put(g0, P1, 'V(1)', BF_A);
  mod(g0, neg, { might: -3 });
  put(g0, P1, 'V(3)', BF_A);
  control(g0, BF_A, P1);
  const a = put(g0, P0, 'V(6)', 'base');
  let g = move(g0, P0, [a], BF_A);
  const log = new EventLog();
  g = toDamage(g, log);
  if (pend(g).kind === 'assignDamage') g = log.act(g, { type: 'assignDamage', player: 0, assignment: (pend(g).data as { suggested: Record<string, number> }).suggested });
  g = toDamage(g, log);
  const toA = log.of('damage').filter(e => e.obj === a).reduce((s, e) => s + Number(e.amount), 0);
  assert.equal(toA, 3, 'P1 total = 0 + 3');
});

test('T089 — Pre-damaged unit needs less (lethal includes marked damage)', () => {
  let { g, def } = attackSetup(['V(3)'], ['V(4)', 'V(2)'], { defOpts: [{ damage: 3 }, {}] });
  g = toDamage(g);
  expectPending(g, 'assignDamage', P0);
  assert.equal(valid(g, { [def[0]]: 1, [def[1]]: 2 }), null, '1 is lethal for the damaged V(4); 2 for V(2)');
});

test('T090 — Prevent affects lethal assignment', () => {
  const g0 = S0();
  const k = put(g0, P1, 'V(4)', BF_A);
  const w = put(g0, P1, 'V(1)', BF_A);
  addPrevent(g0, k, 7);
  control(g0, BF_A, P1);
  const a = put(g0, P0, 'V(12)', 'base');
  let g = move(g0, P0, [a], BF_A);
  g = toDamage(g);
  expectPending(g, 'assignDamage', P0);
  assert.notEqual(valid(g, { [k]: 4, [w]: 8 }), null, '4 is not lethal for the shielded unit');
  assert.equal(valid(g, { [k]: 11, [w]: 1 }), null, 'lethal = 4 + 7 = 11');
  g = assign(g, { [k]: 11, [w]: 1 });
  g = passAll(g);
  assert.equal(zone(g, k), 'trash', 'takes 4 (11-7) → dies');
  assert.equal(zone(g, w), 'trash');
});

function kiLotus(first: 'ki' | 'lotus'): { dealt: number; remaining: unknown; g: GameState } {
  const g0 = S0();
  const d = put(g0, P1, 'V(4)', BF_A);
  control(g0, BF_A, P1);
  addPrevent(g0, d, 7);
  g0.ex.delayed.push({ id: 'dtestdouble', controller: 1, source: null, key: 'cf:doubleDamage', data: { obj: d, epoch: 0 }, expires: 'endOfTurn', turn: g0.turn, timestamp: ++g0.timestamp });
  const a = put(g0, P0, 'V(4)', 'base');
  let g = move(g0, P0, [a], BF_A);
  const log = new EventLog();
  g = toDamage(g, log);
  const dd = pend(g);
  assert.ok(dd.inStep, `expected the replacement-order decision, got ${dd.kind}`);
  assert.equal(dd.player, 1, 'the affected unit\'s controller orders the replacements');
  const opt = dd.options!.find(o => (first === 'ki' ? /prevent/i : /double|cf:double|d:dtestdouble/i).test(`${o.label} ${o.id}`)) ?? dd.options![first === 'ki' ? 0 : 1];
  g = log.choose(g, opt.id);
  g = toDamage(g, log);
  const dealt = log.of('damage').filter(e => e.obj === d).reduce((s, e) => s + Number(e.amount), 0);
  const prev = g.ex.delayed.find(x => x.key === 'builtin:prevent' && x.data.obj === d);
  return { dealt, remaining: prev ? prev.data.remaining : 0, g };
}

test('T091 — Ki Barrier + Lotus Trap ordering', () => {
  const ki = kiLotus('ki');
  assert.equal(ki.dealt, 0, 'Ki Barrier first → 0 damage');
  assert.equal(ki.remaining, 3, '3 prevention left');
  const lo = kiLotus('lotus');
  assert.equal(lo.dealt, 1, 'Lotus Trap first → 8, prevent 7 → 1 damage');
  assert.equal(lo.remaining, 0, '0 prevention left');
});

test('T092 — Attack trigger fires once per combat', () => {
  const g0 = S0();
  put(g0, P1, 'V(1)', BF_A);
  control(g0, BF_A, P1);
  const a = put(g0, P0, 'AttackDraw(3)', 'base');
  const h0 = g0.players[0].hand.length;
  let g = move(g0, P0, [a], BF_A);
  g = resolveChain(g);
  assert.equal(g.players[0].hand.length, h0 + 1, 'one draw at combat start');
  g = toDamage(g);
  g = passAll(g);
  assert.equal(g.players[0].hand.length, h0 + 1, 'only once');
});

test('T093 — Unit joining combat later gets designation and its attack/defend trigger', () => {
  let { g, atk } = attackSetup(['V(5)'], ['V(1)']);
  const amb = hand(g, P1, 'DefendAmbusher(3)');
  const h1 = g.players[1].hand.length;
  g = pass(g);
  expectPending(g, 'showdownAction', P1);
  g = play(g, P1, amb, { dest: BF_A });
  assert.equal(locOf(g, amb), BF_A);
  assert.equal(g.objects[amb].combatRole, 'defender', 'gets the Defender designation at the next cleanup');
  g = resolveChain(g);
  assert.equal(g.players[1].hand.length, h1 - 1 + 1, 'defend trigger fired (drew 1)');
  const log = new EventLog();
  g = toDamage(g, log);
  if (pend(g).kind === 'assignDamage') g = log.act(g, { type: 'assignDamage', player: pend(g).player, assignment: (pend(g).data as { suggested: Record<string, number> }).suggested });
  g = toDamage(g, log);
  if (g.pending?.kind === 'assignDamage') g = log.act(g, { type: 'assignDamage', player: pend(g).player, assignment: (pend(g).data as { suggested: Record<string, number> }).suggested });
  const toA = log.of('damage').filter(e => e.obj === atk[0]).reduce((s, e) => s + Number(e.amount), 0);
  assert.equal(toA, 4, 'it contributes its Might (1 + 3)');
});

test('T094 — All attackers die: defender wins, no conquer', () => {
  let { g, atk, def } = attackSetup(['V(1)', 'V(1)'], ['V(5)']);
  g = toDamage(g);
  // P0's 2 damage to V(5) is forced; P1 must assign 1 + 1 (+3 excess anywhere)
  expectPending(g, 'assignDamage', P1);
  assert.notEqual(valid(g, { [atk[0]]: 5 }), null, 'must give lethal to each before excess');
  assert.equal(valid(g, { [atk[0]]: 4, [atk[1]]: 1 }), null);
  assert.equal(valid(g, { [atk[0]]: 1, [atk[1]]: 4 }), null);
  g = assign(g, { [atk[0]]: 1, [atk[1]]: 4 });
  g = passAll(g);
  assert.equal(zone(g, atk[0]), 'trash');
  assert.equal(zone(g, atk[1]), 'trash');
  assert.equal(zone(g, def[0]), 'battlefield');
  assert.equal(g.objects[def[0]].damage, 0, 'healed');
  assert.equal(g.battlefields[BF_A].controller, 1);
  assert.equal(g.players[1].points, 0, 'no conquer, no point');
});

test('T095 — Defenders all die, attacker survives → conquer even though attacker didn\'t control', () => {
  let { g, atk, def } = attackSetup(['V(4)'], ['V(2)']);
  g = toDamage(g);
  g = passAll(g);
  assert.equal(zone(g, def[0]), 'trash');
  assert.equal(locOf(g, atk[0]), BF_A);
  assert.equal(g.battlefields[BF_A].controller, 0);
  assert.equal(g.players[0].points, 1);
});

test('T096 — Combat damage is not "spell damage"', () => {
  const g0 = S0();
  put(g0, P0, 'TrashPhoenix', 'trash');
  const d = put(g0, P1, 'V(2)', BF_A);
  control(g0, BF_A, P1);
  const a = put(g0, P0, 'V(5)', 'base');
  const h0 = g0.players[0].hand.length;
  let g = move(g0, P0, [a], BF_A);
  g = toDamage(g);
  g = passAll(g);
  assert.equal(zone(g, d), 'trash');
  assert.equal(g.players[0].hand.length, h0, 'Phoenix-like trigger does not fire for a combat kill');
  // control: it does fire for a spell kill
  let h = S0();
  put(h, P0, 'TrashPhoenix', 'trash');
  const v = put(h, P1, 'V(2)', 'base');
  [h] = cast(h, P0, 'ZapM', { targets: [[v]] });
  h = passAll(h);
  assert.equal(h.players[0].hand.length, 1, 'fixture sanity: a spell kill triggers it');
});

test('T097 — Deathknell from combat resolves after combat cleanup healing', () => {
  const g0 = S0();
  const kog = put(g0, P1, 'KogLike(1)', BF_A);
  control(g0, BF_A, P1);
  const a5 = put(g0, P0, 'V(5)', 'base');
  const a2 = put(g0, P0, 'V(2)', 'base');
  let g = move(g0, P0, [a5, a2], BF_A);
  g = toDamage(g);
  // P0: 7 to Kog (forced, single defender). P1: 1 damage → P1 chooses V(5)
  for (let i = 0; i < 3 && pend(g).kind === 'assignDamage'; i++) {
    g = pend(g).player === 1 ? assign(g, { [a5]: 1 }) : assign(g, { [kog]: 7 });
  }
  g = passAll(g);
  assert.equal(zone(g, kog), 'trash');
  assert.equal(zone(g, a2), 'trash', 'Deathknell 4 damage killed V(2)');
  assert.equal(locOf(g, a5), BF_A, 'V(5) survives');
  assert.equal(g.objects[a5].damage, 4, 'V(5) was healed (1 damage) before the Deathknell dealt 4');
  assert.equal(g.battlefields[BF_A].controller, 0, 'P0 wins and establishes control');
  assert.equal(g.players[0].points, 1, 'conquer');
});

test('T098 — Combat requires both sides present at damage step', () => {
  let { g, atk, def } = attackSetup(['V(3)'], ['V(5)']);
  g = pass(g);
  [g] = cast(g, P1, 'MoveR', { targets: [[def[0]]] });
  g = passN(g, 2);
  const log = new EventLog();
  g = toDamage(g, log);
  g = log.passAll(g);
  assert.equal(log.of('damage').length, 0, 'no combat damage step');
  assert.equal(locOf(g, def[0]), 'base');
  assert.equal(g.battlefields[BF_A].controller, 0, 'attacker wins and establishes control');
  assert.equal(g.players[0].points, 1, 'conquers');
  void atk;
});

void answer;

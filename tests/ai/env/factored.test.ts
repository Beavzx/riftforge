// ENUM (task #4): the factored action layer (src/ai/env/factored.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGame, applyAction, getLegalActions, validateAction } from '../../../src/engine/index.ts';
import type { Action, CardDef, CardId, DeckList, Decision, GameState, ObjId } from '../../../src/engine/types.ts';
import { validateAssignment, type AssignTarget } from '../../../src/engine/showdown.ts';
import { makeRng } from '../../../src/engine/rng.ts';
import { factor, isAction, decide, randomSubPolicy, enumerateAssignments, type FNode } from '../../../src/ai/env/factored.ts';
import { puzzle } from '../core/puzzle.ts';

const DB: Record<CardId, CardDef> = JSON.parse(readFileSync(new URL('../../../data/cards.json', import.meta.url), 'utf8'));
const DECKS = ['01-azir.json', '02-vex.json', '04-rek-sai.json', '06-kai-sa.json', '09-irelia.json', '11-kennen.json', '12-ezreal.json', '13-sett.json', '03-evelynn.json']
  .map(f => (JSON.parse(readFileSync(new URL(`../../../data/meta-decks/${f}`, import.meta.url), 'utf8')) as { deck: DeckList }).deck);

function newGame(seed: number, manualPay = false): GameState {
  return createGame({ seed, cardDb: DB, battlefieldSelection: 'random', firstPlayer: 0, enforceBanlist: false, manualPay: manualPay ? [true, true] : undefined,
    players: [{ name: 'A', deck: DECKS[seed % DECKS.length] }, { name: 'B', deck: DECKS[(seed * 5 + 2) % DECKS.length] }] });
}

/** Drive a whole game through the factored layer only. Returns the action log. */
function playFactored(seed: number, manualPay: boolean, maxSteps = 2500): { g: GameState; log: string[] } {
  const rng = makeRng(seed + 17);
  const base = randomSubPolicy(rng);
  let g = newGame(seed, manualPay);
  const log: string[] = [];
  let main = 0, turn = g.turn;
  while (g.winner === null && log.length < maxSteps && g.turn <= 40) {
    if (g.turn !== turn) { turn = g.turn; main = 0; }
    const top = !g.pending!.inStep;
    const a = decide(g, c => {
      // keep random games moving: mostly not pass at the top level, and end the turn after 60 main actions
      if (top && c.step === 0 && c.kind === 'engine') {
        const non = c.options.map((o, i) => [o, i] as const).filter(([o]) => !(o.action && (o.action.type === 'pass' || o.action.type === 'endTurn')));
        if (non.length && rng() < 0.8 && main < 60) return non[Math.floor(rng() * non.length)][1];
      }
      return base(c);
    });
    assert.ok(a, `no action at step ${log.length}`);
    assert.equal(validateAction(g, a!), null, `invalid action ${JSON.stringify(a)}`);
    if (top) main++;
    g = applyAction(g, a!).state;
    log.push(JSON.stringify(a));
  }
  return { g, log };
}

const norm = (a: Action): string => {
  if (a.type === 'move') return JSON.stringify({ ...a, units: [...a.units].sort() });
  if (a.type === 'choose') return JSON.stringify({ ...a, optionIds: [...a.optionIds].sort() });
  if (a.type === 'assignDamage') { const x: Record<string, number> = {}; for (const k of Object.keys(a.assignment).sort()) if (a.assignment[k] > 0) x[k] = a.assignment[k]; return JSON.stringify({ ...a, assignment: x }); }
  return JSON.stringify(a);
};

/** Walk the factored tree towards a target engine action; returns the action reached (or null if it can't be reached). */
function reach(g: GameState, target: Action): Action | null {
  let n: FNode | Action | null = factor(g);
  let guard = 0;
  while (n && !isAction(n)) {
    if (++guard > 200) return null;
    const c = n.choice;
    let idx = c.options.findIndex(o => o.action && norm(o.action) === norm(target));
    if (idx < 0 && c.kind === 'engine' && target.type === 'move') idx = c.options.findIndex(o => o.id === `move:${target.to}`);
    if (idx < 0 && c.kind === 'moveUnits' && target.type === 'move') {
      idx = c.options.findIndex(o => !o.isDone && target.units.includes(o.id));
      if (idx < 0 && (c.partial.picked?.length ?? 0) === target.units.length) idx = c.options.findIndex(o => o.isDone);
    }
    if (idx < 0 && c.kind === 'pickCards' && target.type === 'choose') {
      idx = c.options.findIndex(o => !o.isDone && target.optionIds.includes(o.id));
      if (idx < 0 && (c.partial.picked?.length ?? 0) === target.optionIds.length) idx = c.options.findIndex(o => o.isDone);
    }
    if (idx < 0 && c.kind === 'assignDamage' && c.partial.current && target.type === 'assignDamage') idx = c.options.findIndex(o => o.value === (target.assignment[c.partial.current!] ?? 0));
    if (idx < 0) return null;
    n = n.pick(idx);
  }
  return n;
}

test('full random games driven only through the factored layer finish with valid actions (auto-pay and manual pay)', () => {
  let finished = 0;
  for (let s = 0; s < 12; s++) {
    const { g } = playFactored(100 + s, s % 2 === 1);
    if (g.winner !== null) finished++;
  }
  assert.ok(finished >= 9, `most random games finish (${finished}/12)`);
});

test('determinism: same seed and same sub-choice rng give the same game', () => {
  for (const s of [3, 8]) {
    const a = playFactored(200 + s, s === 8), b = playFactored(200 + s, s === 8);
    assert.deepEqual(a.log, b.log);
    assert.equal(JSON.stringify({ ...a.g, cards: 0, log: 0 }), JSON.stringify({ ...b.g, cards: 0, log: 0 }));
  }
});

test('every action the engine lists is reachable through the factored layer', () => {
  let checked = 0;
  for (let s = 0; s < 5; s++) {
    const rng = makeRng(s + 991);
    let g = newGame(300 + s, s % 2 === 0);
    let steps = 0;
    while (g.winner === null && steps < 400 && g.turn <= 30) {
      const d = g.pending!;
      const legal = getLegalActions(g, d.player).filter(a => a.type !== 'cancel');
      for (const a of legal) {
        const r = reach(g, a);
        assert.ok(r, `unreachable ${d.kind} action ${JSON.stringify(a)}`);
        assert.equal(norm(r!), norm(a));
        checked++;
      }
      const non = legal.filter(a => a.type !== 'pass' && a.type !== 'endTurn');
      const pool = non.length && rng() < 0.8 ? non : legal;
      g = applyAction(g, pool[Math.floor(rng() * pool.length)]).state;
      steps++;
    }
  }
  assert.ok(checked > 500, `checked ${checked}`);
});

test('standard move with 7 units: factored, and every payable subset is reachable', () => {
  const z = puzzle({ me: '06-kai-sa.json', opp: '02-vex.json' });
  const units: ObjId[] = [];
  for (let i = 0; i < 7; i++) units.push(z.base(0, 'Tornado Warrior'));
  const node = factor(z.g)!;
  const moveOpt = node.choice.options.find(o => o.id === 'move:0');
  assert.ok(moveOpt, 'a "move units to battlefield 0" option');
  // the engine itself only lists singletons and "all" for 7 units
  const engineMoves = getLegalActions(z.g, 0).filter(a => a.type === 'move' && a.to === 0).length;
  assert.equal(engineMoves, 8);
  let reached = 0;
  for (let m = 1; m < 1 << units.length; m++) {
    const set = units.filter((_, i) => (m >> i) & 1);
    const target: Action = { type: 'move', player: 0, units: set, to: 0 };
    if (validateAction(z.g, target) !== null) continue;
    const r = reach(z.g, target);
    assert.ok(r, `subset of ${set.length} reachable`);
    assert.equal(norm(r!), norm(target));
    reached++;
  }
  assert.equal(reached, 127, 'all 127 subsets');
});

function synthetic(min: number, max: number, data: Record<string, unknown>): { g: GameState; ids: ObjId[] } {
  const z = puzzle({ me: '06-kai-sa.json', opp: '02-vex.json' });
  const ids: ObjId[] = [];
  const names = ['Tornado Warrior', 'Plundering Poro', 'Watchful Sentry'];
  for (let i = 0; i < 12; i++) ids.push(i % 3 === 0 ? z.at(i % 2 as 0 | 1, names[i % 3], 0) : i % 3 === 1 ? z.base(i % 2 as 0 | 1, names[i % 3]) : z.at(i % 2 as 0 | 1, names[i % 3], 1));
  const d: Decision = { kind: 'chooseCards', player: 0, prompt: 'synthetic', inStep: true, min, max, data,
    options: ids.map(id => ({ id, label: z.g.cards[z.g.objects[id].cardId].name, objIds: [id] })) };
  z.g.pending = d;
  return { g: z.g, ids };
}

for (const [name, min, max, data] of [
  ['any number (0..12)', 0, 12, {}],
  ['exactly 5', 5, 5, {}],
  ['up to 6 at the same location', 1, 6, { check: 'sameLocation' }],
  ['total Might <= 7, same controller', 0, 12, { check: 'groupRules', maxTotalMight: 7, sameController: true }],
] as [string, number, number, Record<string, unknown>][]) {
  test(`big multi-select (${name}): exactly the validator-accepted subsets are reachable, and no path gets stuck`, () => {
    const { g, ids } = synthetic(min, max, data);
    const valid = new Set<string>();
    for (let m = 0; m < 1 << ids.length; m++) {
      const set = ids.filter((_, i) => (m >> i) & 1);
      const a: Action = { type: 'choose', player: 0, optionIds: set };
      if (validateAction(g, a) === null) valid.add(norm(a));
    }
    assert.ok(valid.size > 20, `big decision (${valid.size} answers)`);
    // the engine's own list samples it
    if (data.check !== 'sameLocation') assert.ok(getLegalActions(g, 0).length < valid.size);   // (MS-5 per-location sampling can be complete)
    for (const k of valid) { const t = JSON.parse(k) as Action; const r = reach(g, t); assert.ok(r, `reachable ${k}`); assert.equal(norm(r!), k); }
    // random walks never get stuck and always end in a valid answer
    const rng = makeRng(5);
    for (let i = 0; i < 300; i++) { const a = decide(g, randomSubPolicy(rng, 0.2)); assert.ok(a && valid.has(norm(a))); }
  });
}

test('damage assignment enumeration: every valid assignment is represented (up to where the excess goes)', () => {
  const rng = makeRng(42);
  for (let trial = 0; trial < 300; trial++) {
    const n = 1 + Math.floor(rng() * 4);
    const ts: AssignTarget[] = [];
    for (let i = 0; i < n; i++) {
      const r = rng();
      const groups = r < 0.15 ? [0] : r < 0.3 ? [2] : r < 0.35 ? [0, 2] : [1];
      ts.push({ obj: `u${i}`, lethal: rng() < 0.1 ? null : 1 + Math.floor(rng() * 4), groups });
    }
    const total = 1 + Math.floor(rng() * 9);
    const rows = enumerateAssignments(ts, total);
    const key = (a: Record<string, number>) => JSON.stringify(Object.fromEntries(Object.entries(a).filter(([, v]) => v > 0).sort()));
    const have = new Set(rows.map(key));
    for (const r of rows) assert.equal(validateAssignment(ts, total, r), null, 'rows are valid');
    // brute force every integer assignment; canonicalise the excess onto one recipient
    const rec = (i: number, left: number, a: Record<string, number>) => {
      if (i === n) {
        if (left !== 0 || validateAssignment(ts, total, a) !== null) return;
        const live = ts.filter(t => t.lethal !== null);
        const allLethal = live.length > 0 && live.every(t => (a[t.obj] ?? 0) >= (t.lethal as number));
        if (!allLethal || live.length === 0) { if (live.length === 0) return; assert.ok(have.has(key(a)), `missing ${key(a)} for ${JSON.stringify({ ts, total })}`); return; }
        // excess variants: some row with the same kill set exists
        const base: Record<string, number> = {};
        for (const t of live) base[t.obj] = t.lethal as number;
        const excess = total - live.reduce((s, t) => s + (t.lethal as number), 0);
        assert.ok(excess === 0 ? have.has(key(base)) : ts.some(t => have.has(key({ ...base, [t.obj]: (base[t.obj] ?? 0) + excess }))), 'an excess row exists');
        return;
      }
      for (let v = 0; v <= left; v++) { a[ts[i].obj] = v; rec(i + 1, left - v, a); }
      delete a[ts[i].obj];
    };
    rec(0, total, {});
  }
});

test('manual payment: alternatives besides auto-pay (which domain to recycle), each one valid', () => {
  // a multi-domain card's [C] can be paid with either domain: that is a real choice
  const flex = Object.values(DB).filter(c => c.domains.length > 1 && (c.power ?? 0) > 0 && (c.type === 'Spell' || c.type === 'Gear' || c.type === 'Unit'));
  const files = ['01-azir.json', '02-vex.json', '04-rek-sai.json', '06-kai-sa.json', '09-irelia.json', '11-kennen.json', '12-ezreal.json', '13-sett.json', '03-evelynn.json'];
  let played: GameState | null = null;
  outer: for (const f of files) for (const c of flex) {
    const z = puzzle({ me: f, opp: '02-vex.json' });
    z.g.ex.manualPay = [true, true];
    z.runes(0, { [c.domains[0]]: 3, [c.domains[1]]: 3 } as Record<string, number>);
    let obj: ObjId;
    try { [obj] = z.hand(0, [c.name]); } catch { continue; }
    const a = getLegalActions(z.g, 0).find(x => x.type === 'playCard' && x.obj === obj);
    if (!a) continue;
    const g2 = applyAction(z.g, a).state;
    if (g2.pending?.kind === 'payment') { played = g2; break outer; }
  }
  assert.ok(played, 'found a playable multi-domain card');
  const node = factor(played!)!;
  assert.equal(node.choice.kind, 'payment');
  assert.equal(node.choice.options[0].id, 'auto');
  assert.ok(node.choice.options.length >= 2, `alternatives: ${node.choice.options.map(o => o.label).join(' | ')}`);
  const doms = new Set<string>();
  for (let i = 0; i < node.choice.options.length; i++) {
    const a = node.pick(i);
    assert.ok(isAction(a));
    assert.equal(validateAction(played!, a), null);
    const g3 = applyAction(played!, a).state;
    const left = g3.players[0].runesInPlay.map(r => g3.cards[g3.objects[r].cardId].domains[0]).sort().join(',');
    doms.add(left);
  }
  assert.ok(doms.size >= 2, 'the options leave different runes in play');
});

test('maxFlatMoveUnits: 0 factors every standard move (smaller top-level lists), still complete', () => {
  const z = puzzle({ me: '06-kai-sa.json', opp: '02-vex.json' });
  const units = [z.base(0, 'Tornado Warrior'), z.base(0, 'Plundering Poro'), z.base(0, 'Watchful Sentry')];
  const node = factor(z.g, { maxFlatMoveUnits: 0 })!;
  assert.ok(!node.choice.options.some(o => o.action?.type === 'move'), 'no flat move actions');
  const mv = node.choice.options.findIndex(o => o.id === 'move:0');
  assert.ok(mv >= 0);
  const seen = new Set<string>();
  const rng = makeRng(9);
  for (let i = 0; i < 200; i++) {
    let n: FNode | Action = node.pick(mv);
    while (!isAction(n)) n = n.pick(randomSubPolicy(rng, 0.4)(n.choice));
    assert.equal(validateAction(z.g, n), null);
    if (n.type === 'move') seen.add([...n.units].sort().join(','));
  }
  assert.equal(seen.size, 7, 'all 7 subsets of 3 units come up');
  void units;
});

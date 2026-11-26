// ENCODE x ENUM: drive random games ONLY through the factored layer (src/ai/env/factored.ts factor()/pick()) and encode
// every sub-choice: valid pointers, option objIds pointed at, the partial selection (picked / assigned / current) present.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction } from '../../../src/engine/index.ts';
import type { Action, GameState, ObjId } from '../../../src/engine/types.ts';
import { cardDb, loadMetaDecks } from '../../../tools/sim-lib.ts';
import { makeRng } from '../../../src/engine/rng.ts';
import { hiddenIdsFor } from '../../../src/engine/hidden-ids.ts';
import { factor, isAction, randomSubPolicy, type FNode, type SubChoice as FSubChoice } from '../../../src/ai/env/factored.ts';
import { encodeObservation, encodeSubChoices, ACTION, MAX_PTRS, PTR_ROLES, type SubChoice } from '../../../src/ai/encode/index.ts';

const ROLE = (r: string) => PTR_ROLES.indexOf(r as (typeof PTR_ROLES)[number]);
// compile-time check: the factored layer's SubChoice is accepted as-is
const _shape: (c: FSubChoice) => SubChoice = c => c; void _shape;

test('encodeSubChoices: every sub-choice of factored random games encodes with valid pointers and partial state', () => {
  const decks = loadMetaDecks();
  const kinds: Record<string, number> = {}; let choices = 0, rows = 0, withPicked = 0, withAssigned = 0, withCurrent = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const rng = makeRng(seed * 977); const pol = randomSubPolicy(rng, 0.25);
    const manualPay = seed % 2 === 0;
    let g: GameState = createGame({ seed, cardDb: cardDb(), battlefieldSelection: 'random', firstPlayer: 0, enforceBanlist: false,
      manualPay: manualPay ? [true, true] : undefined,
      players: [{ name: 'A', deck: decks[seed % decks.length].deck }, { name: 'B', deck: decks[(seed * 5 + 2) % decks.length].deck }] });
    for (let step = 0; step < 300 && g.winner === null && g.turn <= 40; step++) {
      // small flat limits force the factored paths (pickCards / moveUnits) as often as possible
      let n: FNode | Action | null = factor(g, { maxFlat: seed % 3 === 0 ? 1 : 4, maxFlatMoveUnits: 1 });
      if (!n) break;
      const p = (n as FNode).choice.player;
      const obs = encodeObservation(g, p);
      const hidden = hiddenIdsFor(g, p);
      let guard = 0;
      while (!isAction(n)) {
        assert.ok(++guard < 500);
        const c: FSubChoice = n.choice; choices++; kinds[c.kind] = (kinds[c.kind] ?? 0) + 1;
        const e = encodeSubChoices(g, p, c, obs);
        assert.equal(e.n, c.options.length);
        for (const x of e.feats) assert.ok(Number.isFinite(x));
        c.options.forEach((o, r) => {
          rows++;
          const ptr = Array.from(e.ptrIdx.subarray(r * MAX_PTRS, (r + 1) * MAX_PTRS));
          const role = Array.from(e.ptrRole.subarray(r * MAX_PTRS, (r + 1) * MAX_PTRS));
          ptr.forEach((i, k) => { if (!role[k]) assert.equal(i, -1); else { assert.ok(i < obs.nEntities); assert.ok(role[k] < PTR_ROLES.length); } });
          assert.equal(e.feats[r * ACTION.dim + ACTION.at[`sub:${c.kind}`]], 1, 'sub kind flag');
          if (o.action) {
            assert.equal(e.feats[r * ACTION.dim + ACTION.at['sub:passThrough']], 1);
            assert.equal(e.feats[r * ACTION.dim + ACTION.at[`type:${o.action.type}`]], 1);
          } else assert.equal(e.feats[r * ACTION.dim + ACTION.at['type:subChoice']], 1);
          if (o.isDone) assert.equal(e.feats[r * ACTION.dim + ACTION.at['choose:done']], 1);
          for (const id of o.objIds ?? []) {
            assert.ok(obs.entityOf.has(id) || hidden.has(id) || !g.objects[id], `${c.kind}: option object ${id} has no entity row and is not hidden`);
          }
          if (!o.action) for (const id of (o.objIds ?? []).slice(0, MAX_PTRS - 1)) {
            const row = obs.entityOf.get(id); if (row === undefined) continue;
            assert.ok(ptr.some((i, k) => i === row && role[k] === ROLE('option')), `${c.kind}: option object ${id} not pointed at`);
          }
          // the decision so far
          const part = c.partial;
          const vis = (id: ObjId) => obs.entityOf.has(id);
          const pickedVisible = (part.picked ?? []).flatMap(id => {
            const opt = g.pending?.options?.find(x => x.id === id);
            return opt?.objIds?.length ? opt.objIds : g.objects[id] ? [id] : [];
          }).filter(vis);
          const free = MAX_PTRS - role.filter(x => x && x !== ROLE('picked') && x !== ROLE('assigned') && x !== ROLE('current')).length;
          if (pickedVisible.length && free > 1) { assert.ok(role.includes(ROLE('picked')), `${c.kind}: picked cards not pointed at`); if (r === 0) withPicked++; }
          if (part.current && vis(part.current) && free > 0) { assert.ok(role.includes(ROLE('current'))); if (r === 0) withCurrent++; }
          const asg = Object.entries(part.assignment ?? {}).filter(([id, v]) => (v as number) > 0 && vis(id));
          if (asg.length && free > 2) { assert.ok(role.includes(ROLE('assigned'))); if (r === 0) withAssigned++; }
          assert.equal(e.feats[r * ACTION.dim + ACTION.at['sub:step']], Math.min(c.step, 16) / 16);
        });
        n = n.pick(pol(c));
      }
      g = applyAction(g, n).state;
    }
  }
  console.log(`# subchoice (maxFlat 1 on every 3rd seed): ${choices} sub-choices, ${rows} options, kinds ${JSON.stringify(kinds)}, with picked ${withPicked}, assigned ${withAssigned}, current ${withCurrent}`);
  for (const k of ['engine', 'pickCards', 'moveUnits', 'payment']) assert.ok((kinds[k] ?? 0) > 0, `no ${k} sub-choice reached`);
  assert.ok(withPicked > 0, 'no partial picked selection seen');
});

test('encodeSubChoices: stepwise damage assignment carries assigned / current / remaining', () => {
  const decks = loadMetaDecks(); const rng = makeRng(3);
  let g: GameState = createGame({ seed: 11, cardDb: cardDb(), battlefieldSelection: 'random', firstPlayer: 0, enforceBanlist: false,
    players: [{ name: 'A', deck: decks[0].deck }, { name: 'B', deck: decks[4].deck }] });
  // play randomly until both players have units on the board
  const units = () => Object.values(g.objects).filter(o => (o.zone === 'base' || o.zone === 'battlefield') && g.cards[o.cardId]?.type === 'Unit');
  for (let i = 0; i < 400 && units().length < 2 && g.winner === null; i++) { const a = factor(g)!; let n: FNode | Action = a; while (!isAction(n)) n = n.pick(randomSubPolicy(rng, 0.2)(n.choice)); g = applyAction(g, n).state; }
  const [u1, u2] = units(); assert.ok(u1 && u2, 'need two units');
  const p = g.pending!.player; const obs = encodeObservation(g, p);
  const sub: FSubChoice = { kind: 'assignDamage', decision: 'assignDamage', player: p, prompt: 'Assign 5 damage', step: 1,
    partial: { assignment: { [u1.id]: 2 }, current: u2.id, total: 5 },
    options: [{ id: '0', label: 'No damage', value: 0, objIds: [u2.id] }, { id: '3', label: 'Lethal (3)', value: 3, objIds: [u2.id] }] };
  const e = encodeSubChoices(g, p, sub, obs);
  for (let r = 0; r < 2; r++) {
    const ptr = Array.from(e.ptrIdx.subarray(r * MAX_PTRS, (r + 1) * MAX_PTRS)), role = Array.from(e.ptrRole.subarray(r * MAX_PTRS, (r + 1) * MAX_PTRS));
    const val = Array.from(e.ptrVal.subarray(r * MAX_PTRS, (r + 1) * MAX_PTRS));
    const at = (k: string) => e.feats[r * ACTION.dim + ACTION.at[k]];
    assert.equal(ptr[role.indexOf(ROLE('option'))], obs.entityOf.get(u2.id));
    assert.equal(ptr[role.indexOf(ROLE('current'))], obs.entityOf.get(u2.id));
    const ai = role.indexOf(ROLE('assigned')); assert.equal(ptr[ai], obs.entityOf.get(u1.id)); assert.ok(Math.abs(val[ai] - 0.2) < 1e-6);
    assert.equal(at('sub:assignDamage'), 1); assert.equal(at('type:subChoice'), 1);
    assert.ok(Math.abs(at('sub:total') - 5 / 12) < 1e-6); assert.ok(Math.abs(at('sub:assigned') - 2 / 12) < 1e-6); assert.ok(Math.abs(at('sub:remaining') - 3 / 12) < 1e-6);
    assert.ok(Math.abs(at('sub:step') - 1 / 16) < 1e-6);
  }
  assert.ok(Math.abs(e.feats[1 * ACTION.dim + ACTION.at['choose:value']] - 0.3) < 1e-6);
});

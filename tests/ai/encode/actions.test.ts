// ENCODE: every legal action list encodes, pointers are valid, sub-choices share the layout, wire round-trips,
// and the exported Python schema is current.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomGameStates } from './_games.ts';
import { encodeObservation, encodeActions, encodeSubChoices, packObs, unpackObs, packResult, unpackResult, ACTION, MAX_PTRS,
  ENTITY, GLOBAL, schema, schemaHash } from '../../../src/ai/encode/index.ts';
import { hiddenIdsFor } from '../../../src/engine/hidden-ids.ts';
import { ROOT } from '../../../src/ai/encode/cards.ts';
import type { Action, ObjId } from '../../../src/engine/types.ts';

function referenced(a: Action): ObjId[] {
  switch (a.type) {
    case 'playCard': case 'hide': return [a.obj, ...(a.payment?.exhaust ?? []), ...(a.payment?.recycle ?? [])];
    case 'activate': return [a.obj, ...(a.payment?.exhaust ?? []), ...(a.payment?.recycle ?? [])];
    case 'move': return a.units;
    case 'assignDamage': return Object.keys(a.assignment);
    default: return [];
  }
}

test('encodeActions: every legal list of random games encodes with valid pointers', () => {
  const types = new Set<string>(); let lists = 0, actions = 0, subs = 0;
  for (let seed = 1; seed <= 6; seed++) for (const { g, legal } of randomGameStates(seed + 50, 350)) {
    const p = g.pending!.player;
    const o = encodeObservation(g, p);
    const a = encodeActions(g, p, legal, o);
    assert.equal(a.n, legal.length); lists++; actions += legal.length;
    for (const x of a.feats) assert.ok(Number.isFinite(x));
    const hidden = hiddenIdsFor(g, p);
    legal.forEach((act, r) => {
      types.add(act.type);
      assert.equal(a.feats[r * ACTION.dim + ACTION.at[`type:${act.type}`]], 1);
      for (let k = 0; k < MAX_PTRS; k++) {
        const i = a.ptrIdx[r * MAX_PTRS + k], role = a.ptrRole[r * MAX_PTRS + k];
        if (!role) { assert.equal(i, -1); continue; }
        assert.ok(i < o.nEntities, 'pointer past the entity list');
      }
      for (const id of referenced(act)) assert.ok(o.entityOf.has(id) || hidden.has(id), `${act.type} references ${id} with no entity row (not hidden either)`);
      const rowPtrs = new Set(Array.from(a.ptrIdx.subarray(r * MAX_PTRS, (r + 1) * MAX_PTRS)).filter(x => x >= 0));
      for (const id of referenced(act).slice(0, MAX_PTRS)) if (o.entityOf.has(id)) assert.ok(rowPtrs.has(o.entityOf.get(id)!), `${act.type}: ${id} not pointed at`);
    });
    // sub-choices: synthesize from the pending decision's options (the shape src/ai/env/ exposes)
    const d = g.pending!;
    if (d.options?.length) {
      const sc = encodeSubChoices(g, p, { kind: d.kind, partial: [], options: [...d.options.map(x => ({ label: x.label, objIds: x.objIds })), { label: 'Done', isDone: true }] }, o);
      assert.equal(sc.n, d.options.length + 1); subs++;
      assert.equal(sc.feats[d.options.length * ACTION.dim + ACTION.at['choose:done']], 1);
      for (let k = 0; k < sc.n * MAX_PTRS; k++) assert.ok(sc.ptrIdx[k] < o.nEntities);
    }
    // wire round trip
    const f = packObs(o, a, lists);
    const u = unpackObs(f);
    assert.equal(u.tag, lists); assert.equal(u.nE, o.nEntities); assert.equal(u.nA, a.n);
    assert.deepEqual(Array.from(u.global), Array.from(o.global));
    assert.deepEqual(Array.from(u.cardIdx), Array.from(o.cardIdx));
    assert.deepEqual(Array.from(u.ptrIdx), Array.from(a.ptrIdx));
    assert.equal(u.entities.length, o.nEntities * ENTITY.dim);
  }
  for (const t of ['choose', 'playCard', 'activate', 'move', 'pass', 'endTurn']) assert.ok(types.has(t), `no ${t} seen`);
  assert.ok(lists > 500 && subs > 20, `coverage: ${lists} lists, ${subs} sub-choice lists`);
  console.log(`# actions: ${lists} lists, ${actions} actions, types ${[...types].join(',')}`);
});

test('result frame round trip', () => {
  const r = unpackResult(packResult(42, 0.25, [1, -2, 3.5], [9]));
  assert.equal(r.tag, 42); assert.equal(r.value, 0.25); assert.deepEqual(Array.from(r.logits), [1, -2, 3.5]); assert.deepEqual(Array.from(r.extra), [9]);
});

test('schema dims are consistent and python/riftnet/schema.json is current', () => {
  const s = schema();
  assert.equal(s.global.dim, GLOBAL.dim); assert.equal(s.entity.dim, ENTITY.dim); assert.equal(s.action.dim, ACTION.dim);
  const f = join(ROOT, 'python/riftnet/schema.json');
  assert.ok(existsSync(f), 'run: tsx tools/encode-schema.ts');
  assert.equal(JSON.parse(readFileSync(f, 'utf8')).schemaHash, schemaHash(), 'python/riftnet/schema.json is stale: run tsx tools/encode-schema.ts');
});

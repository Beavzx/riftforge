// BASICS: the payment oracle itself (tests/basics/oracle.ts) — it must recognise the payments a skilled player would make,
// or the matrix proves nothing. Includes the reported case: a power-only cost paid by recycling a ready rune must take the
// rune's energy first (rules-decisions #65).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestPayment, cmpVec, maxAnyPower, type Res } from './oracle.ts';

const runes = (...rs: [string, boolean][]): Res['runes'] => rs.map(([d, ready]) => ({ domain: d as never, ready }));
const res = (o: Partial<Res>): Res => ({ poolE: 0, poolP: {}, runes: [], adds: [], ...o });

test('BASICS oracle: power-only cost, one ready rune — exhaust it for [1], then recycle it (the reported case)', () => {
  const best = bestPayment(res({ runes: runes(['Fury', true]) }), { energy: 0, power: [['Fury']] })!;
  assert.deepEqual(best, { losses: 1, energy: 1, power: 0 });
  // the reported bug's end state (recycled without taking the energy) is strictly worse
  assert.ok(cmpVec({ losses: 1, energy: 0, power: 0 }, best) > 0);
});

test('BASICS oracle: an exhausted rune of the domain is recycled before a ready one', () => {
  const best = bestPayment(res({ runes: runes(['Fury', false], ['Fury', true]) }), { energy: 0, power: [['Fury']] })!;
  assert.deepEqual(best, { losses: 1, energy: 1, power: 0 });   // the ready rune stays ready
});

test('BASICS oracle: energy + power from two ready runes — exhaust both, recycle one', () => {
  assert.deepEqual(bestPayment(res({ runes: runes(['Fury', true], ['Fury', true]) }), { energy: 2, power: [['Fury']] }), { losses: 1, energy: 0, power: 0 });
  assert.equal(bestPayment(res({ runes: runes(['Fury', true]) }), { energy: 2, power: [['Fury']] }), null);
});

test('BASICS oracle: pool first — floating energy and power are spent before runes', () => {
  const best = bestPayment(res({ poolE: 1, poolP: { Fury: 1 }, runes: runes(['Fury', true]) }), { energy: 1, power: [['Fury']] })!;
  assert.deepEqual(best, { losses: 0, energy: 1, power: 0 });
});

test('BASICS oracle: wrong domain only — unaffordable; [A] accepts any domain; multi-domain [C] either domain', () => {
  assert.equal(bestPayment(res({ runes: runes(['Calm', true], ['Calm', true]) }), { energy: 0, power: [['Fury']] }), null);
  assert.ok(bestPayment(res({ runes: runes(['Calm', true]) }), { energy: 0, power: ['any'] }));
  assert.ok(bestPayment(res({ runes: runes(['Calm', true]) }), { energy: 0, power: [['Fury', 'Calm']] }));
});

test('BASICS oracle: a free exhaust-only Add beats recycling a rune; Gold and a rune tie (one permanent loss each)', () => {
  const seal = bestPayment(res({ runes: runes(['Fury', true]), adds: [{ kind: 'free', energy: 0, power: ['Fury'] }] }), { energy: 0, power: [['Fury']] })!;
  assert.deepEqual(seal, { losses: 0, energy: 1, power: 0 });
  const gold = bestPayment(res({ runes: runes(['Fury', true]), adds: [{ kind: 'gold', energy: 0, power: ['any'] }] }), { energy: 0, power: [['Fury']] })!;
  assert.equal(gold.losses, 1);
  assert.equal(bestPayment(res({ runes: runes(['Calm', true]), adds: [{ kind: 'gold', energy: 0, power: ['any'] }] }), { energy: 0, power: [['Fury']] })!.losses, 1);
});

test('BASICS oracle: "pay any amount of [A]" maximum = power reachable', () => {
  assert.equal(maxAnyPower(res({ poolP: { Calm: 1 }, runes: runes(['Fury', true], ['Order', false]) })), 3);
  assert.equal(maxAnyPower(res({ poolE: 3 })), 0);
});

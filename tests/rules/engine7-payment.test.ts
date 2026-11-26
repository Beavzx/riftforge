// ENGINE-7: the manual-payment preference everywhere a cost is paid (AUTO-AUDIT E1/E2, A-1, A-2), multi-domain Add
// validation (F-6), the rune tie-break of rules-decisions #66 and ordering one ability's instances from different events (F-4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  S0, P0, P1, BF_A, put, hand, setRunes, addRunes, act, pend, choose, yes, pass, answer, control, setBattlefieldCard, zone,
} from '../conformance/harness.ts';
import { autoPay, validatePlan, executePayment, addSources } from '../../src/engine/payment.ts';
import { makeCtx } from '../../src/engine/context.ts';
import { beginRun, Suspend } from '../../src/engine/ask.ts';
import { getView } from '../../src/engine/game.ts';
import type { GameState, ObjId, PaymentPlan, Decision } from '../../src/engine/types.ts';

const manual = (g: GameState, p = P0) => { g.ex.manualPay[p] = true; };
/** Answer in-step decisions with the first option / yes until a payment Decision (or nothing in-step) is pending. */
function toPayment(g: GameState, limit = 20): GameState {
  for (let i = 0; i < limit; i++) {
    const d = g.pending;
    if (!d || d.kind === 'payment') return g;
    if (!d.inStep) { if (d.kind === 'chainResponse' && g.chain.length) { g = pass(g); continue; } return g; }
    g = d.kind === 'optional' ? yes(g) : choose(g, d.options![0].id);
  }
  return g;
}

test('E1: the payment Decision lists every usable Add source (data.adds), not only the ones the suggestion uses', () => {
  const g0 = S0(); setRunes(g0, P0, 2, 'fury'); manual(g0);
  const seal = put(g0, P0, 'Seal of Rage', 'base');
  let g = act(g0, { type: 'playCard', player: P0, obj: hand(g0, P0, 'V(1)'), destination: 'base' });
  const d = pend(g);
  assert.equal(d.kind, 'payment');
  const sug = d.data!.suggested as PaymentPlan;
  assert.equal((sug.other?.abilities as string[] | undefined)?.length ?? 0, 0, 'the suggestion pays [1] with a rune');
  const adds = d.data!.adds as { key: string; obj: ObjId; label: string }[];
  assert.ok(adds.some(a => a.obj === seal && /Seal of Rage/.test(a.label)), `Seal listed: ${JSON.stringify(adds)}`);
  void g;
});

test('E2: a triggered ability\'s cost (Valley of Idols "they may pay [1]") asks the payment Decision with manualPay, auto-pay preselected', () => {
  const g0 = S0(); setRunes(g0, P0, 3); manual(g0);
  setBattlefieldCard(g0, BF_A, 'Valley of Idols');
  put(g0, P0, 'V(1)', BF_A); control(g0, BF_A, P0);
  const u = hand(g0, P0, 'V(2)');
  let g = act(g0, { type: 'playCard', player: P0, obj: u, destination: BF_A });
  assert.equal(pend(g).kind, 'payment', 'the unit\'s own cost');
  g = choose(g, 'auto');
  g = toPayment(g);
  const d = pend(g);
  assert.equal(d.kind, 'payment', `trigger cost asked as a payment, got ${d.kind}: ${d.prompt}`);
  assert.ok(d.data!.suggested, 'auto-pay suggestion preselected');
  const r = g.players[P0].runesInPlay.find(x => !g.objects[x].exhausted)!;
  g = act(g, { type: 'choose', player: P0, optionIds: ['manual'], data: { exhaust: [r], recycle: [] } satisfies PaymentPlan });
  assert.equal(g.objects[r].exhausted, true, 'the rune the player chose paid the [1]');
  assert.ok(g.chain.some(c => c.kind === 'trigger'), 'trigger on the chain');
});

test('E2: a trigger\'s Deflect cost, once accepted, is paid through the payment Decision with manualPay', () => {
  const g0 = S0(); manual(g0);
  setRunes(g0, P0, 2, 'fury');
  const d0 = put(g0, P1, 'Deflect(3,1)', BF_A); control(g0, BF_A, P1);
  const pd = hand(g0, P0, 'PlayDeal2');
  let g = act(g0, { type: 'playCard', player: P0, obj: pd, destination: 'base' });
  g = choose(g, 'auto');            // the unit's cost ([2])
  void d0;
  g = answer(g, { targets: [[d0]] }, P0);
  assert.equal(pend(g).kind, 'optional', 'pay Deflect?');
  g = yes(g);
  assert.equal(pend(g).kind, 'payment', `then the payment Decision, got ${pend(g).kind}`);
  g = choose(g, 'auto');
  assert.ok(g.chain.some(c => c.kind === 'trigger'), 'trigger on the chain');
});

test('E2: ctx.pay during a resolution honours manualPay (payment Decision, manual plan executed); off → auto-pay', () => {
  const mk = (on: boolean) => {
    const g = S0();
    for (const id of [...g.players[P0].runesInPlay]) { g.players[P0].runesInPlay.splice(0, 1); delete g.objects[id]; }
    const [f] = addRunes(g, P0, 1, 'fury'); const [c] = addRunes(g, P0, 1, 'calm');
    if (on) manual(g);
    return { g, f, c, src: put(g, P0, 'V(1)', 'base') };
  };
  const off = mk(false);
  beginRun([], 0);
  assert.equal(makeCtx(off.g, off.src, P0).pay({ power: ['A'] }), true, 'auto-paid, no question');
  const on = mk(true);
  beginRun([], 0);
  let d: Decision | undefined;
  try { makeCtx(on.g, on.src, P0).pay({ power: ['A'] }); } catch (e) { if (e instanceof Suspend) d = e.decision; else throw e; }
  assert.equal(d?.kind, 'payment');
  assert.ok(d?.data?.suggested, 'auto-pay preselected');
  const m = mk(true);
  beginRun([{ type: 'choose', player: P0, optionIds: ['manual'], data: { exhaust: [], recycle: [m.c] } }] as never, 0);
  assert.equal(makeCtx(m.g, m.src, P0).pay({ power: ['A'] }), true);
  assert.equal(zone(m.g, m.c), 'runeDeck', 'the chosen Calm rune was recycled');
  assert.deepEqual(m.g.players[P0].runesInPlay, [m.f]);
});

test('E2: token Accelerate payment asks the payment Decision with manualPay', () => {
  const g0 = S0(); setRunes(g0, P0, 3); manual(g0);
  const src = put(g0, P0, 'V(1)', 'base');
  g0.cards['cf-accel-tok'] = { ...g0.cards[g0.objects[src].cardId], id: 'cf-accel-tok', name: 'AccelTok', keywords: ['Accelerate'], supertypes: ['Token'] };
  const ctx = makeCtx(g0, src, P0);
  beginRun([{ type: 'choose', player: P0, optionIds: ['yes'] }] as never, 0);
  let d: Decision | undefined;
  try { ctx.createToken('cf-accel-tok', 'base'); } catch (e) { if (e instanceof Suspend) d = e.decision; else throw e; }
  assert.equal(d?.kind, 'payment', `Accelerate cost asked as a payment, got ${d?.kind}: ${d?.prompt}`);
});

test('F-6: a manual plan may use a multi-domain [C] Add for its second domain; executing it adds that domain', () => {
  const g = S0();
  for (const id of [...g.players[P0].runesInPlay]) { g.players[P0].runesInPlay.splice(0, 1); delete g.objects[id]; }
  g.players[P0].pool = { energy: 0, power: {} };
  const seal = put(g, P0, 'Seal of Rage', 'base');
  const cid = g.objects[seal].cardId;
  g.cards[cid] = { ...g.cards[cid], domains: ['Fury', 'Calm'] };
  g.timestamp++;
  const key = addSources(g, P0).find(a => a.obj === seal)!.key;
  const cost = { energy: 0, power: [['Calm']] as ['Calm'][] };
  const plan: PaymentPlan = { exhaust: [], recycle: [], other: { abilities: [key] } };
  assert.equal(validatePlan(g, P0, cost as never, 'spell', plan), null, 'accepted by its Calm domain');
  executePayment(g, P0, cost as never, 'spell', plan);
  assert.equal(g.objects[seal].exhausted, true);
  assert.deepEqual(g.players[P0].pool.power, {}, 'the Calm power paid the cost');
  const auto = autoPay(g, P0, cost as never, 'spell');
  assert.equal(auto, null, 'nothing left to pay with');
});

test('F-6b: a manual plan can\'t count an Add\'s spells-only energy for a unit', () => {
  const g = S0();
  for (const id of [...g.players[P0].runesInPlay]) { g.players[P0].runesInPlay.splice(0, 1); delete g.objects[id]; }
  g.players[P0].pool = { energy: 0, power: {} };
  const lux = put(g, P0, 'ogs-014-024', 'base');     // Lux, Crownguard: [T]: Add [2], spells only
  const a = addSources(g, P0).find(x => x.obj === lux);
  assert.ok(a && a.only, 'Lux has a restricted Add');
  const plan: PaymentPlan = { exhaust: [], recycle: [], other: { abilities: [a.key] } };
  assert.match(validatePlan(g, P0, { energy: 1, power: [] }, 'unit', plan) ?? '', /energy/);
});

test('#66 tie-break: [A] with one Fury and one Calm rune recycles the domain the hand needs less (Calm card in hand → Fury recycled)', () => {
  const mk = (handDomain: 'Calm' | 'Fury') => {
    const g = S0();
    for (const id of [...g.players[P0].runesInPlay]) { g.players[P0].runesInPlay.splice(0, 1); delete g.objects[id]; }
    g.players[P0].hand = [];
    const [c] = addRunes(g, P0, 1, 'calm'); const [f] = addRunes(g, P0, 1, 'fury');
    const h = hand(g, P0, 'V(1)');
    const cid = g.objects[h].cardId;
    g.cards[cid] = { ...g.cards[cid], domains: [handDomain], power: 2 };
    const r = autoPay(g, P0, { energy: 0, power: ['any'] }, 'spell')!;
    return { rec: r.plan.recycle, c, f };
  };
  const a = mk('Calm'); assert.deepEqual(a.rec, [a.f], 'Calm needed → Fury recycled');
  const b = mk('Fury'); assert.deepEqual(b.rec, [b.c], 'Fury needed → Calm recycled');
});

test('#66 tie-break (ENGINE-9): [C] in an activated-ability cost on the board counts as need (Vi "[2][C]: Double my Might" keeps a Fury rune)', () => {
  const mk = (withVi: boolean) => {
    const g = S0();
    for (const id of [...g.players[P0].runesInPlay]) { g.players[P0].runesInPlay.splice(0, 1); delete g.objects[id]; }
    g.players[P0].hand = [];
    const [f] = addRunes(g, P0, 1, 'fury'); const [c] = addRunes(g, P0, 1, 'calm');
    if (withVi) put(g, P0, 'unl-030-219', 'base');   // Vi "[2][C]: Double my Might"
    const r = autoPay(g, P0, { energy: 0, power: ['any'] }, 'spell')!;
    return { rec: r.plan.recycle, c, f };
  };
  const a = mk(false); assert.deepEqual(a.rec, [a.f], 'no need anywhere: the first rune (Fury) is recycled');
  const b = mk(true); assert.deepEqual(b.rec, [b.c], 'Vi\'s [C] (Fury) on the board → Calm recycled');
});

test('BX-4: PlayerView.costs gives each hand card\'s current cost after cost modifications (Herald of Scales: Eclipse Dragon 8 → 6)', () => {
  const g = S0();
  const v1 = hand(g, P0, 'V(3)');
  const d = hand(g, P0, 'Eclipse Dragon');
  let view = getView(g, P0);
  assert.equal(view.costs?.[v1]?.energy, 3);
  assert.equal(view.costs?.[d]?.energy, 8);
  put(g, P0, 'Herald of Scales', 'base');
  view = getView(g, P0);
  assert.equal(view.costs?.[d]?.energy, 6);
  assert.equal(view.costs?.[d]?.power.length, g.cards[g.objects[d].cardId].power ?? 0);
  assert.equal(getView(g, P1).costs?.[d], undefined, 'only the viewer\'s own cards');
});

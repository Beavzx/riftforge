// BASICS: the same ordinary plays with "choose runes when paying" on (GameSetup.manualPay / g.ex.manualPay, the
// payment Decision). Generated: card kind × cost shape × resource state × moment. For each legal play:
//   - a resource cost raises one `payment` decision for the payer with the cost and the suggested plan; a [0] cost raises none
//     (CR 445.1.b); the opponent sees only that P0 is paying (no options, no plan)
//   - "auto" gives exactly the auto-pay result; "manual" with the suggested plan gives the same; a plan that doesn't cover
//     the cost, or exhausts an exhausted rune, is refused (CR 357, 445.2)
import { test } from 'node:test';
import { assert, P0, P1, touch } from '../conformance/harness.ts';
import { place } from '../../src/engine/testkit.ts';
import { applyAction, validateAction, getView } from '../../src/engine/index.ts';
import type { Action, GameState, PaymentPlan } from '../../src/engine/types.ts';
import { momentBase, applyResources, BF_B, type Moment, type ResState } from './matrix.ts';
import { CARD_KINDS, PRINTED, shapesFor, cardId, type CardShape } from './cards.ts';

const MOMENTS: Moment[] = ['first', 'afterPowerPlay', 'oppChain', 'showdownFocus'];
const RES: ResState[] = ['plenty', 'someExhausted', 'exact', 'floatP'];
const SHAPES: CardShape[] = ['zero', 'energy', 'power1', 'powerMulti', 'powerAny', 'energyPower', 'reducedZero'];

const resources = (g: GameState) => JSON.stringify({ pool: g.players[P0].pool, runes: g.players[P0].runesInPlay.map(r => `${r}:${g.objects[r].exhausted}`), deck: g.players[P0].runeDeck.length });

function answerRest(g: GameState): GameState {
  for (let i = 0; i < 8 && g.pending?.inStep; i++) {
    const d = g.pending;
    const id = d.kind === 'optional' ? 'no' : (d.options ?? [])[0].id;
    g = applyAction(g, { type: 'choose', player: d.player, optionIds: [id] }).state;
  }
  return g;
}

for (const m of MOMENTS) for (const kind of CARD_KINDS) {
  const shapes = shapesFor(kind).filter(s => SHAPES.includes(s));
  test(`BASICS manual pay: ${m} | ${kind} × ${shapes.length} cost shapes × ${RES.length} resource states`, () => {
    const bad: string[] = [];
    let legalCells = 0;
    for (const shape of shapes) for (const rs of RES) {
      const g0 = structuredClone(momentBase(m).g);
      const pr = PRINTED[shape];
      if (shape === 'reducedZero') place(g0, P0, 'cf-discount2', 'base');
      const target = { energy: Math.max(0, pr.energy - (shape === 'reducedZero' ? 2 : 0)), power: new Array(pr.power).fill(0).map(() => (pr.domains[0] === 'Colorless' ? 'any' as const : [...pr.domains])) };
      applyResources(g0, rs, target);
      const id = place(g0, P0, cardId(kind, shape), 'hand');
      touch(g0);
      const dest = kind === 'unitBase' || kind === 'gear' ? 'base' : kind === 'unitBf' ? BF_B : undefined;
      const action: Action = { type: 'playCard', player: P0, obj: id, ...(dest !== undefined ? { destination: dest } : {}) };
      if (validateAction(g0, action)) continue;
      legalCells++;
      const where = `${shape}/${rs}`;
      const auto = answerRest(applyAction(g0, action).state);
      const gm = structuredClone(g0);
      gm.ex.manualPay[P0] = true;
      let s = applyAction(gm, action).state;
      // optional costs come first (Make Choices, CR 355) — none in these shapes
      const d = s.pending;
      const paysSomething = target.energy > 0 || target.power.length > 0;
      if (!paysSomething) {
        if (d?.kind === 'payment') bad.push(`${where}: a payment decision for a [0] cost (CR 445.1.b)`);
        continue;
      }
      if (d?.kind !== 'payment' || d.player !== P0 || !d.inStep) { bad.push(`${where}: expected P0's payment decision, got ${d?.kind}`); continue; }
      const cost = d.data?.cost as { energy: number; power: unknown[] };
      if (cost.energy !== target.energy || cost.power.length !== target.power.length) bad.push(`${where}: decision cost ${JSON.stringify(cost)} vs ${JSON.stringify(target)}`);
      const suggested = d.data?.suggested as PaymentPlan;
      if (!suggested) { bad.push(`${where}: no suggested plan`); continue; }
      // views: the payer sees the options and the plan; the opponent only that P0 is paying
      const v0 = getView(s, P0), v1 = getView(s, P1);
      if (!(v0.pending?.kind === 'payment' && (v0.pending.options ?? []).map(o => o.id).join() === 'auto,manual' && v0.pending.data?.suggested)) bad.push(`${where}: payer's view lacks the payment options / plan`);
      if (!(v1.pending?.kind === 'payment' && v1.pending.player === P0 && !v1.pending.options && !v1.pending.data)) bad.push(`${where}: opponent sees the payment details`);
      if (v1.legal.length) bad.push(`${where}: opponent has legal actions during P0's payment`);
      // auto → same as auto-pay
      const sa = answerRest(applyAction(s, { type: 'choose', player: P0, optionIds: ['auto'] }).state);
      if (resources(sa) !== resources(auto)) bad.push(`${where}: "auto" differs from auto-pay: ${resources(sa)} vs ${resources(auto)}`);
      // manual with the suggested plan → same
      const sm = answerRest(applyAction(s, { type: 'choose', player: P0, optionIds: ['manual'], data: suggested }).state);
      if (resources(sm) !== resources(auto)) bad.push(`${where}: manual suggested plan differs from auto-pay`);
      // a plan paying nothing is refused (unless the pool covers it); exhausting an exhausted rune is refused
      const poolCovers = s.players[P0].pool.energy >= target.energy && Object.values(s.players[P0].pool.power).reduce((a, n) => a + (n ?? 0), 0) >= target.power.length;
      const empty = validateAction(s, { type: 'choose', player: P0, optionIds: ['manual'], data: { exhaust: [], recycle: [] } });
      if (!poolCovers && empty === null) bad.push(`${where}: an empty manual plan was accepted`);
      const ex = s.players[P0].runesInPlay.find(r => s.objects[r].exhausted);
      if (ex && validateAction(s, { type: 'choose', player: P0, optionIds: ['manual'], data: { exhaust: [ex], recycle: [] } }) === null) bad.push(`${where}: a plan exhausting an exhausted rune was accepted`);
      void s; s = sa;
    }
    assert.ok(legalCells > 0 || m === 'oppChain' || m === 'showdownFocus', 'no legal cell at all');
    assert.ok(bad.length === 0, bad.join('\n'));
  });
}

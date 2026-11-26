// RULINGS agent: engine-level rulings (see docs/rulings.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, act, handCard, resolveAll } from '../fixtures/helpers.ts';
import { fullDb } from '../fixtures/cards.ts';
import { card, selfKeyword } from '../../src/cards/dsl.ts';
import type { CardDef } from '../../src/engine/types.ts';

// CR 817.2: "Multiple instances of Vision trigger separately." 817.2.a: the player decides to recycle for each instance.
const db: Record<string, CardDef> = { ...fullDb(), 't-rul-vision2': { ...fullDb()['t-vision'], id: 't-rul-vision2', name: 'Double Vision' } };
card('t-rul-vision2', '[Vision]', [selfKeyword(['Vision'], { text: 'I have [Vision].' })]);

test('RULING CR 817.2: two instances of Vision trigger separately (two predicts)', () => {
  let g = newGame({ db });
  const v = handCard(g, 0, 't-rul-vision2');
  const [t1, t2] = g.players[0].mainDeck;
  g = act(g, { type: 'playCard', player: 0, obj: v, destination: 'base' });
  g = resolveAll(g);
  if (g.pending?.kind === 'orderTriggers' || g.pending?.kind === 'chooseOrder') { g = act(g, { type: 'choose', player: 0, optionIds: [g.pending.options![0].id] }); g = resolveAll(g); }
  assert.equal(g.pending?.kind, 'chooseCards', 'first Vision');
  g = act(g, { type: 'choose', player: 0, optionIds: [t1] });
  g = resolveAll(g);
  assert.equal(g.pending?.kind, 'chooseCards', 'second Vision');
  assert.ok((g.pending!.options ?? []).some(o => o.id === t2), 'the second instance sees the new top card');
});

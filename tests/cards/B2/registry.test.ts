// B2: every card of the batch has a registered script whose text is the card's text.
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { assert, real } from './util.ts';
import { getScript } from '../../../src/cards/registry.ts';

const batch: { batches: { id: string; cards: string[] }[] } = JSON.parse(readFileSync(new URL('../../../data/card-batches.json', import.meta.url), 'utf8'));
const ids = batch.batches.find(b => b.id === 'B2-equipment-gear-activated')!.cards;

test('B2: all 124 cards are registered with their exact text', () => {
  assert.equal(ids.length, 124);
  const missing = ids.filter(id => !getScript(id));
  assert.deepEqual(missing, []);
  const wrong = ids.filter(id => getScript(id)!.text !== real[id].text);
  assert.deepEqual(wrong, []);
});

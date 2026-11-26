// Every B4 card has a script whose text equals cards.json `text`.
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { assert, real } from './_util.ts';
import { getScript } from '../../../src/cards/registry.ts';

const batches = JSON.parse(readFileSync(new URL('../../../data/card-batches.json', import.meta.url), 'utf8'));
const ids: string[] = batches.batches.find((b: { id: string }) => b.id === 'B4-combat-board').cards;

test('B4: all 132 cards are scripted with their exact cards.json text', () => {
  assert.equal(ids.length, 132);
  for (const id of ids) {
    const s = getScript(id);
    assert.ok(s, `${id} has no script`);
    assert.equal(s!.text, real[id].text, `${id} text mismatch`);
  }
});

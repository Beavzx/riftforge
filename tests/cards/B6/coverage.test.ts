// Every B6 card has a script whose text equals data/cards.json `text`.
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { assert, real } from './_h.ts';
import { getScript } from '../../../src/cards/registry.ts';

const batches = JSON.parse(readFileSync(new URL('../../../data/card-batches.json', import.meta.url), 'utf8'));
const ids: string[] = batches.batches[5].cards.map((c: string | { id: string }) => (typeof c === 'string' ? c : c.id));

test('B6: batch has 135 cards, all scripted with exact text', () => {
  assert.equal(batches.batches[5].id, 'B6-pump-ready-buff');
  assert.equal(ids.length, 135);
  for (const id of ids) {
    const s = getScript(id);
    assert.ok(s, `missing script ${id}`);
    assert.equal(s!.text, real[id].text, `text mismatch for ${id} (${real[id].name})`);
    assert.ok(s!.abilities.length > 0, `no abilities for ${id}`);
  }
});

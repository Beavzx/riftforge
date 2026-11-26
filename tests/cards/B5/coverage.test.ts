// B5 coverage: every card of the batch is scripted with the exact card text and exercised by a scenario test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { real } from './util.ts';
import { getScript } from '../../../src/cards/registry.ts';

const batches = JSON.parse(readFileSync(new URL('../../../data/card-batches.json', import.meta.url), 'utf8'));
const b5 = batches.batches.find((b: { id: string }) => b.id === 'B5-removal-spells');
const ids: string[] = b5.cards.map((c: string | { id: string }) => (typeof c === 'string' ? c : c.id));

test('B5: all 135 cards are scripted with the card text', () => {
  assert.equal(ids.length, 135);
  const missing = ids.filter(id => !getScript(id));
  assert.deepEqual(missing, []);
  const wrong = ids.filter(id => getScript(id)!.text !== real[id].text);
  assert.deepEqual(wrong, []);
});

test('B5: every card id appears in a scenario test', () => {
  const dir = new URL('./', import.meta.url);
  const src = readdirSync(dir).filter(f => f.endsWith('.test.ts') && f !== 'coverage.test.ts').map(f => readFileSync(new URL(f, dir), 'utf8')).join('\n');
  const untested = ids.filter(id => !src.includes(`'${id}'`));
  assert.deepEqual(untested, []);
});

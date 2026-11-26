import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DeckPicker, pairedDeals } from '../../../src/ai/selfplay/decks.ts';
import { makeRng } from '../../../src/engine/rng.ts';

const META = join(import.meta.dirname, '../../../data/meta-decks');
const pool = ['01-azir.json', '02-vex.json', '04-rek-sai.json', '06-kai-sa.json'].map(f => join(META, f));

test('eval deals come in identical pairs (same decks, seed, first player) and pairs differ', () => {
  const picker = new DeckPicker({ mode: 'pool', pool, allowMirror: true });
  const deals = pairedDeals(picker, makeRng(7), 16, 1000);
  assert.equal(deals.length, 16);
  for (let j = 0; j < 8; j++) {
    const [a, b] = [deals[2 * j], deals[2 * j + 1]];
    assert.equal(a, b, `pair ${j} shares one deal`);
    assert.equal(a.seed, 1000 + j);
    assert.equal(a.firstPlayer, j % 2);
  }
  assert.equal(new Set(deals.map(d => d.seed)).size, 8);
  // reproducible for the same rng seed (so every eval of a step uses the same deals)
  const again = pairedDeals(new DeckPicker({ mode: 'pool', pool, allowMirror: true }), makeRng(7), 16, 1000);
  assert.deepEqual(again.map(d => d.decks.map(x => x.name)), deals.map(d => d.decks.map(x => x.name)));
});

test('an odd number of eval games leaves only the last deal unpaired', () => {
  const deals = pairedDeals(new DeckPicker({ mode: 'pool', pool, allowMirror: true }), makeRng(1), 5, 0);
  assert.equal(deals.length, 5);
  assert.equal(deals[0], deals[1]);
  assert.equal(deals[2], deals[3]);
  assert.notEqual(deals[4].seed, deals[3].seed);
});

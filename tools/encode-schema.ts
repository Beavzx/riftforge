// ENCODE: export the encoder schema + static card table for the Python side, and persist the card index.
//   tsx tools/encode-schema.ts            -> data/encode-card-index.json, python/riftnet/schema.json, python/riftnet/card_table.f32
//   tsx tools/encode-schema.ts --frames N -> also python/tests/fixtures/frames.bin (N length-prefixed RFO1 frames)
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { schema, cardIndex, staticTable, encodeObservation, encodeActions, packObs, withLength } from '../src/ai/encode/index.ts';
import { ROOT, CARD_INDEX_FILE } from '../src/ai/encode/cards.ts';
import { randomGameStates } from '../tests/ai/encode/_games.ts';

const ix = cardIndex();
writeFileSync(CARD_INDEX_FILE, JSON.stringify({ note: 'ENCODE: append-only card order for the learned embedding (index = position + 2). Never reorder or delete.', ids: ix.ids }, null, 0) + '\n');
const py = join(ROOT, 'python/riftnet'); mkdirSync(py, { recursive: true });
const s = schema(); const st = staticTable();
writeFileSync(join(py, 'schema.json'), JSON.stringify({ ...s, cards: { ...s.cards, ids: ix.ids, tableFile: 'card_table.f32' } }, null, 1) + '\n');
writeFileSync(join(py, 'card_table.f32'), Buffer.from(st.rows.buffer, st.rows.byteOffset, st.rows.byteLength));
console.log(`schema ${s.schemaHash}: global ${s.global.dim}, entity ${s.entity.dim}, action ${s.action.dim}, ptrs ${s.maxPtrs}, cards ${st.nRows} x ${st.dim}`);

const fi = process.argv.indexOf('--frames');
if (fi > 0) {
  const want = Number(process.argv[fi + 1] ?? 8); const chunks: Uint8Array[] = []; const meta: unknown[] = [];
  outer: for (let seed = 1; ; seed++) for (const { g, legal, step } of randomGameStates(seed, 300)) {
    if (step % 37 !== 5) continue;
    const p = g.pending!.player; const o = encodeObservation(g, p); const a = encodeActions(g, p, legal, o);
    chunks.push(withLength(packObs(o, a, chunks.length)));
    meta.push({ tag: chunks.length - 1, nE: o.nEntities, nA: a.n, global0: o.global[0], cardIdx0: o.cardIdx[0], ptr0: a.ptrIdx[0], globalSum: o.global.reduce((x, y) => x + y, 0), entitySum: o.entities.reduce((x, y) => x + y, 0) });
    if (chunks.length >= want) break outer;
  }
  const dir = join(ROOT, 'python/tests/fixtures'); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'frames.bin'), Buffer.concat(chunks));
  writeFileSync(join(dir, 'frames.json'), JSON.stringify(meta, null, 1) + '\n');
  console.log(`wrote ${chunks.length} frames`);
}

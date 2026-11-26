// TRAIN: dump everything the Python side needs about the encoder into a run directory:
//   <out>/schema.json       dims, feature names, wire constants, schemaHash (python/riftzero/schema.py reads it)
//   <out>/card_static.f32   static card feature table, row-major float32 little-endian [nRows x staticDim]
//   <out>/card_index.json   card id for each embedding row (row = FIRST_CARD_IDX + position)
// Usage: node --import tsx tools/train-schema.ts --out runs/<name>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { schema, cardIndex, staticTable } from '../src/ai/encode/index.ts';

const i = process.argv.indexOf('--out');
if (i < 0) { console.error('usage: train-schema.ts --out <dir>'); process.exit(1); }
const out = process.argv[i + 1];
mkdirSync(out, { recursive: true });
const s = schema();
const st = staticTable();
writeFileSync(join(out, 'schema.json'), JSON.stringify({ ...s, cardStaticFile: 'card_static.f32' }, null, 1));
const rows = new Uint8Array(st.rows.buffer, st.rows.byteOffset, st.rows.byteLength);
writeFileSync(join(out, 'card_static.f32'), rows);
writeFileSync(join(out, 'card_index.json'), JSON.stringify({ firstCardIdx: s.cards.firstCardIdx, ids: cardIndex().ids }));
console.log(JSON.stringify({ schemaHash: s.schemaHash, global: s.global.dim, entity: s.entity.dim, action: s.action.dim, maxPtrs: s.maxPtrs, cardRows: st.nRows, staticDim: st.dim }));

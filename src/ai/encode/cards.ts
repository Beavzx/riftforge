// ENCODE: static per-card features + a stable integer card index for a learned embedding.
//
// Card index: 0 = padding, 1 = unknown (hidden card / card missing from the index), 2.. = cards.
// The index is persisted in data/encode-card-index.json (append-only), so a trained model keeps its embedding rows
// when cards.json gains new cards. Unlisted cards are appended in memory (sorted by id) and written back by
// tools/encode-schema.ts.
//
// Optional text embeddings: if data/card-text-embeddings.json exists ({ dim, vectors: { [cardId]: number[] } }),
// its vectors are appended to each static row (zeros for cards without one). No such file ships; it is a hook for
// precomputed sentence embeddings of card text.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CardDef, CardId } from '../../engine/types.ts';

/** Repo root holding data/cards.json: $RIFTFORGE_ROOT, else relative to this file (source tree), else the cwd (bundles). */
export const ROOT = (() => {
  const cands = [process.env.RIFTFORGE_ROOT, join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'), process.cwd(), join(process.cwd(), '..')];
  for (const c of cands) if (c && existsSync(join(c, 'data/cards.json'))) return c;
  return cands[1]!;
})();
export const PAD_IDX = 0, UNKNOWN_IDX = 1, FIRST_CARD_IDX = 2;

export const CARD_TYPES = ['Unit', 'Spell', 'Gear', 'Rune', 'Battlefield', 'Legend', 'Token'] as const;
export const DOMAINS = ['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order', 'Colorless'] as const;
export const SUPERTYPES = ['Champion', 'Basic', 'Signature', 'Token'] as const;
export const KEYWORDS = ['Accelerate', 'Action', 'Ambush', 'Assault', 'Backline', 'Deflect', 'Deploy', 'Disarm', 'Empower',
  'Equip', 'Flow', 'Ganking', 'Hidden', 'Hunt', 'Quick-Draw', 'Reaction', 'Repeat', 'Shield', 'Tank', 'Temporary', 'Unique',
  'Vision', 'Weaponmaster'] as const;
export const RARITIES = ['Common', 'Uncommon', 'Rare', 'Epic'] as const;
/** Regex flags over rules text: cheap semantic hints that generalise to unseen cards. */
export const TEXT_FLAGS: [string, RegExp][] = [
  ['deal', /\bdeal\b/i], ['kill', /\bkill\b/i], ['stun', /\bstun/i], ['draw', /\bdraw\b/i], ['discard', /\bdiscard/i],
  ['recall', /\brecall/i], ['ready', /\bready\b/i], ['exhaust', /\bexhaust/i], ['buff', /\bbuff/i], ['move', /\bmove\b/i],
  ['play', /\bplay\b/i], ['token', /\btoken|recruit|sprite|mech\b/i], ['banish', /\bbanish/i], ['recycle', /\brecycle/i],
  ['channel', /\bchannel/i], ['conquer', /\bconquer/i], ['hold', /\bhold\b/i], ['score', /\bscore|point/i],
  ['counter', /\bcounter\b/i], ['return', /\breturn\b/i], ['might+', /\+\d+ might|\[\+\d+\]/i], ['might-', /-\d+ might/i],
  ['whenPlay', /\bwhen (you )?play\b/i], ['whenDie', /\bwhen (i|this) (die|dies)|deathknell/i], ['attack', /\battack/i],
  ['defend', /\bdefend/i], ['hand', /\bhand\b/i], ['trash', /\btrash\b/i], ['gear', /\bgear|equip/i], ['spell', /\bspell/i],
  ['each', /\beach\b/i], ['opponent', /\bopponent|enemy/i],
];

const MIN_TAG_COUNT = 5;   // tags on >= this many cards get their own multi-hot slot; the rest count in "otherTags"

export interface CardIndex { ids: CardId[]; idx: Map<CardId, number> }
export interface StaticTable { featureNames: string[]; dim: number; rows: Float32Array; nRows: number; textDim: number }

let DB: Record<CardId, CardDef> | null = null;
export function encodeCardDb(): Record<CardId, CardDef> {
  return DB ??= JSON.parse(readFileSync(join(ROOT, 'data/cards.json'), 'utf8'));
}

export const CARD_INDEX_FILE = join(ROOT, 'data/encode-card-index.json');
let INDEX: CardIndex | null = null;
/** Stable card index: persisted ids first, then any new card ids (sorted) appended. */
export function cardIndex(): CardIndex {
  if (INDEX) return INDEX;
  const persisted: CardId[] = existsSync(CARD_INDEX_FILE) ? JSON.parse(readFileSync(CARD_INDEX_FILE, 'utf8')).ids : [];
  const seen = new Set(persisted);
  const extra = Object.keys(encodeCardDb()).filter(id => !seen.has(id)).sort();
  const ids = [...persisted, ...extra];
  const idx = new Map<CardId, number>();
  ids.forEach((id, i) => idx.set(id, i + FIRST_CARD_IDX));
  return INDEX = { ids, idx };
}

export function cardIdxOf(cardId: CardId | undefined | null): number {
  if (!cardId || cardId === 'hidden') return UNKNOWN_IDX;
  return cardIndex().idx.get(cardId) ?? UNKNOWN_IDX;
}

let TAGS: string[] | null = null;
export function tagVocab(): string[] {
  if (TAGS) return TAGS;
  const n: Record<string, number> = {};
  for (const d of Object.values(encodeCardDb())) for (const t of d.tags) n[t] = (n[t] ?? 0) + 1;
  return TAGS = Object.keys(n).filter(t => n[t] >= MIN_TAG_COUNT).sort();
}

export function kwBase(k: string): string { return k.replace(/\s+-?\d+$/, ''); }
export function kwValue(k: string): number { const m = /\s(-?\d+)$/.exec(k); return m ? Number(m[1]) : 1; }

function staticFeatureNames(textDim: number): string[] {
  return [
    ...CARD_TYPES.map(t => `type:${t}`), 'addType:Gear', 'addType:Unit',
    ...SUPERTYPES.map(s => `super:${s}`),
    ...DOMAINS.map(d => `domain:${d}`),
    'energy', 'energyNull', 'power', 'powerNull', 'might', 'mightNull',
    ...KEYWORDS.map(k => `kw:${k}`), ...KEYWORDS.map(k => `kwVal:${k}`),
    ...tagVocab().map(t => `tag:${t}`), 'otherTags',
    ...RARITIES.map(r => `rarity:${r}`),
    ...TEXT_FLAGS.map(([n]) => `text:${n}`), 'textLen', 'hasAttachedText',
    ...Array.from({ length: textDim }, (_, i) => `textEmb:${i}`),
  ];
}

/** Static row for one card (no text embedding part). */
export function staticRow(d: CardDef | undefined, out: Float32Array, off: number): void {
  if (!d) return;
  let i = off;
  for (const t of CARD_TYPES) out[i++] = d.type === t || (t === 'Token' && d.supertypes.includes('Token')) ? 1 : 0;
  out[i++] = d.additionalTypes?.includes('Gear') ? 1 : 0; out[i++] = d.additionalTypes?.includes('Unit') ? 1 : 0;
  for (const s of SUPERTYPES) out[i++] = d.supertypes.includes(s) ? 1 : 0;
  for (const dm of DOMAINS) out[i++] = d.domains.includes(dm) ? 1 : 0;
  out[i++] = (d.energy ?? 0) / 12; out[i++] = d.energy == null ? 1 : 0;
  out[i++] = (d.power ?? 0) / 4; out[i++] = d.power == null ? 1 : 0;
  out[i++] = (d.might ?? 0) / 12; out[i++] = d.might == null ? 1 : 0;
  const kws = new Map<string, number>();
  for (const k of d.keywords) kws.set(kwBase(k), Math.max(kws.get(kwBase(k)) ?? 0, kwValue(k)));
  for (const k of KEYWORDS) out[i++] = kws.has(k) ? 1 : 0;
  for (const k of KEYWORDS) out[i++] = Math.min(kws.get(k) ?? 0, 10) / 5;
  const tv = tagVocab(); const tagSet = new Set(d.tags); let other = 0;
  for (const t of tv) out[i++] = tagSet.has(t) ? 1 : 0;
  for (const t of d.tags) if (!tv.includes(t)) other++;
  out[i++] = Math.min(other, 4) / 4;
  for (const r of RARITIES) out[i++] = d.rarity === r ? 1 : 0;
  const text = `${d.text ?? ''} ${d.attachedText ?? ''}`;
  for (const [, re] of TEXT_FLAGS) out[i++] = re.test(text) ? 1 : 0;
  out[i++] = Math.min(text.length, 600) / 600;
  out[i++] = d.attachedText ? 1 : 0;
}

let TABLE: StaticTable | null = null;
/** Static feature table indexed by card index (row 0 = pad, row 1 = unknown: all zeros). */
export function staticTable(): StaticTable {
  if (TABLE) return TABLE;
  const embFile = join(ROOT, 'data/card-text-embeddings.json');
  const emb: { dim: number; vectors: Record<CardId, number[]> } | null = existsSync(embFile) ? JSON.parse(readFileSync(embFile, 'utf8')) : null;
  const textDim = emb?.dim ?? 0;
  const featureNames = staticFeatureNames(textDim);
  const dim = featureNames.length;
  const { ids } = cardIndex();
  const nRows = ids.length + FIRST_CARD_IDX;
  const rows = new Float32Array(nRows * dim);
  const db = encodeCardDb();
  ids.forEach((id, k) => {
    const off = (k + FIRST_CARD_IDX) * dim;
    staticRow(db[id], rows, off);
    const v = emb?.vectors[id];
    if (v) for (let j = 0; j < textDim; j++) rows[off + dim - textDim + j] = v[j] ?? 0;
  });
  return TABLE = { featureNames, dim, rows, nRows, textDim };
}

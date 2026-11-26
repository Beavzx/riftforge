// Riftbound deck codes (Piltover Archive "RiftboundDeckCodes" format, adapted from Riot's LoRDeckCodes):
// header byte = format<<4 | version; then varints; base32 (RFC 4648, no padding).
// Main deck: groups for copy counts 12..1, each: [#set/variant lists] then per list [#cards][set][variant][card numbers...].
// V2 sideboard, V3 chosen-champion trailer, V4 card-number flags (rune numbers), V5 sparse counts + SP, V6 extra legends.
// See docs/deck-formats.md §2.
import type { CardId, DeckList } from '../engine/types';
import type { CardDb } from './cards';
import type { ParseResult } from './decks';
import { inferChampion } from './decks';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const SET_IDS: Record<number, string> = { 0: 'ogn', 1: 'ogs', 2: 'arc', 3: 'sfd', 4: 'unl', 5: 'ven', 6: 'rad' };
const VARIANTS: Record<number, string> = { 0: '', 1: 'a', 2: 's', 3: 'b' };

export const looksLikeDeckCode = (s: string) => /^[A-Z2-7]{16,}=*$/.test(s.replace(/\s+/g, ''));

function b32decode(s: string): Uint8Array {
  const clean = s.replace(/[=\s]/g, '').toUpperCase();
  const out: number[] = []; let buf = 0, bits = 0;
  for (const ch of clean) {
    const v = B32.indexOf(ch); if (v < 0) throw new Error('bad base32');
    buf = (buf << 5) | v; bits += 5;
    if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 0xff); }
  }
  return new Uint8Array(out);
}
function b32encode(bytes: number[]): string {
  let out = '', buf = 0, bits = 0;
  for (const b of bytes) { buf = (buf << 8) | b; bits += 8; while (bits >= 5) { bits -= 5; out += B32[(buf >> bits) & 31]; } }
  if (bits > 0) out += B32[(buf << (5 - bits)) & 31];
  return out;
}

class Reader {
  i = 0; constructor(public b: Uint8Array) {}
  get done() { return this.i >= this.b.length; }
  varint(): number {
    let r = 0, shift = 0;
    for (;;) {
      if (this.i >= this.b.length) throw new Error('truncated');
      const x = this.b[this.i++]; r |= (x & 0x7f) << shift; if (!(x & 0x80)) return r >>> 0; shift += 7;
      if (shift > 28) throw new Error('varint too long');
    }
  }
}
const varint = (n: number, out: number[]) => { do { let x = n & 0x7f; n >>>= 7; if (n) x |= 0x80; out.push(x); } while (n); };

export interface RawCode { set: string; num: string; variant: string; code: string }
type Entry = { card: RawCode; count: number };
export function decodeRaw(code: string): { main: Entry[]; side: Entry[]; champion?: RawCode; legends: RawCode[]; version: number } {
  const r = new Reader(b32decode(code));
  const byte = () => { if (r.done) throw new Error('truncated'); return r.b[r.i++]; };
  const hdr = byte(); const format = hdr >> 4, version = hdr & 0xf;
  if (format !== 1 || version < 1 || version > 6) throw new Error(`Unsupported deck code format ${format} v${version}`);
  const flagged = version >= 5 ? byte() === 1 : version >= 4;
  const num = (): string => {
    if (flagged) {
      const f = byte();
      if (f === 0) return String(r.varint()).padStart(3, '0');
      if (f === 1) return 'R' + String(r.varint()).padStart(2, '0');
      if (f === 2 && version >= 5) return 'SP' + r.varint();
      throw new Error('bad card-number flag ' + f);
    }
    return String(r.varint()).padStart(3, '0');
  };
  const mk = (set: number, variant: number, n: string): RawCode => {
    const st = SET_IDS[set]; if (!st) throw new Error('Unknown set id ' + set);
    const v = VARIANTS[variant] ?? '';
    return { set: st, num: n, variant: v, code: `${st.toUpperCase()}-${n}${v}` };
  };
  const groups = (count: number, out: Entry[]) => {
    const lists = r.varint();
    for (let l = 0; l < lists; l++) {
      const n = r.varint(), set = byte(), variant = byte();
      for (let k = 0; k < n; k++) out.push({ card: mk(set, variant, num()), count });
    }
  };
  const section = (maxCount: number): Entry[] => {
    const out: Entry[] = [];
    if (version >= 5) { const nCounts = r.varint(); for (let i = 0; i < nCounts; i++) groups(r.varint(), out); }
    else for (let count = maxCount; count >= 1; count--) { if (r.done) break; groups(count, out); }
    return out;
  };
  const main = section(12);
  const side = version >= 2 && !r.done ? section(3) : [];
  let champion: RawCode | undefined;
  if (version >= 3 && !r.done && byte() === 1) { const set = byte(), variant = byte(); champion = mk(set, variant, num()); }
  const legends: RawCode[] = [];
  if (version >= 6 && !r.done) { const n = r.varint(); for (let i = 0; i < n; i++) { const set = byte(), variant = byte(); legends.push(mk(set, variant, num())); } }
  return { main, side, champion, legends, version };
}

export function decodeDeckCode(code: string, db: CardDb): ParseResult | null {
  let raw;
  try { raw = decodeRaw(code); } catch (e) { return { deck: emptyDeck(), errors: ['Deck code: ' + (e as Error).message], warnings: [] }; }
  const deck = emptyDeck(); const errors: string[] = []; const warnings: string[] = []; const printings: Record<CardId, string> = {};
  const keys = Object.keys(db.printings);
  const keyFor = (c: RawCode): string | undefined => {
    const base = `${c.set}-${c.num.toLowerCase()}`;
    const want = base + (c.variant === 's' ? '' : c.variant);
    return keys.find(k => k === want || k.startsWith(want + '-')) ?? keys.find(k => k === base || k.startsWith(base + '-'));
  };
  const lookup = (c: RawCode): CardId | undefined => { const k = keyFor(c); return k ? db.printings[k] : undefined; };
  for (const { card, count } of raw.main) {
    const id = lookup(card); if (!id) { errors.push(`Unknown card ${card.code}.`); continue; }
    // full printed code (e.g. "ogn-030a-298"): names the image file and still round-trips through encodeDeckCode
    printings[id] ??= keyFor(card) ?? card.code;
    const c = db.byId[id];
    const ids = Array(count).fill(id) as CardId[];
    if (c.type === 'Legend') deck.legend = id;
    else if (c.type === 'Battlefield') deck.battlefields.push(...ids);
    else if (c.type === 'Rune') deck.runes.push(...ids);
    else deck.main.push(...ids);
  }
  for (const { card, count } of raw.side) { const id = lookup(card); if (id) deck.sideboard!.push(...Array(count).fill(id)); else errors.push(`Unknown sideboard card ${card.code}.`); }
  if (raw.champion) {
    const id = lookup(raw.champion);
    const i = id ? deck.main.indexOf(id) : -1;
    if (id) { deck.champion = id; if (i >= 0) deck.main.splice(i, 1); }
  }
  inferChampion(deck, db, warnings);
  return { deck, errors, warnings, printings };
}

const emptyDeck = (): DeckList => ({ legend: '', champion: '', main: [], runes: [], battlefields: [], sideboard: [] });

/** Encode to a deck code (V3; V4 when rune-number cards are present; V5 for counts > 12 or SP cards). */
export function encodeDeckCode(deck: DeckList, db: CardDb, prefer?: Record<CardId, string>): { code: string; skipped: string[] } {
  const skipped: string[] = [];
  const setNum = Object.fromEntries(Object.entries(SET_IDS).map(([k, v]) => [v, +k])) as Record<string, number>;
  type P = { set: number; variant: number; kind: 0 | 1 | 2; n: number };
  const toP = (p: string): P | null => {
    const m = /^([a-z]{3})-(?:(\d{3})|r(\d+)|sp(\d+))([ab]?)(?:-|$)/.exec(p.toLowerCase());
    if (!m || setNum[m[1]] === undefined) return null;
    return { set: setNum[m[1]], variant: ({ '': 0, a: 1, b: 3 } as Record<string, number>)[m[5]] ?? 0, kind: m[2] ? 0 : m[3] ? 1 : 2, n: +(m[2] ?? m[3] ?? m[4]) };
  };
  const parse = (id: CardId): P | null => {
    const pref = prefer?.[id]; if (pref) { const p = toP(pref); if (p) return p; }
    const c = db.byId[id];
    // Prefer a plain numbered, base-art printing from the oldest set (e.g. OGN runes), as community tools do.
    const cands = [id, ...(c?.printings ?? [])].map(toP).filter((x): x is P => !!x)
      .sort((a, b) => a.kind - b.kind || a.variant - b.variant || a.set - b.set);
    if (cands.length) return cands[0];
    skipped.push(c?.name ?? id); return null;
  };
  const counts = new Map<CardId, number>();
  for (const id of [deck.legend, deck.champion, ...deck.main, ...deck.runes, ...deck.battlefields].filter(Boolean)) counts.set(id, (counts.get(id) ?? 0) + 1);
  const side = new Map<CardId, number>(); for (const id of deck.sideboard ?? []) side.set(id, (side.get(id) ?? 0) + 1);
  const parsed = new Map<CardId, P>();
  for (const id of [...counts.keys(), ...side.keys()]) { const p = parse(id); if (p) parsed.set(id, p); }
  const anyRune = [...parsed.values()].some(p => p.kind === 1), anySp = [...parsed.values()].some(p => p.kind === 2);
  const sparse = anySp || [...counts.values()].some(n => n > 12) || [...side.values()].some(n => n > 3);
  const version = sparse ? 5 : anyRune ? 4 : 3;
  const flagged = version >= 4;
  const out: number[] = [0x10 | version];
  if (version >= 5) out.push(flagged ? 1 : 0);
  const cardNum = (p: P) => { if (flagged) out.push(p.kind); varint(p.n, out); };
  const groupsFor = (m: Map<CardId, number>, count: number) => {
    const lists = new Map<string, { set: number; variant: number; cards: P[] }>();
    for (const [id, n] of m) if (n === count && parsed.has(id)) { const p = parsed.get(id)!; const k = p.set + ':' + p.variant; (lists.get(k) ?? lists.set(k, { set: p.set, variant: p.variant, cards: [] }).get(k)!).cards.push(p); }
    const arr = [...lists.values()].sort((a, b) => a.set - b.set || a.variant - b.variant);
    varint(arr.length, out);
    for (const l of arr) {
      l.cards.sort((a, b) => a.kind - b.kind || a.n - b.n);
      varint(l.cards.length, out); out.push(l.set, l.variant); for (const c of l.cards) cardNum(c);
    }
  };
  const section = (m: Map<CardId, number>, maxCount: number) => {
    if (version >= 5) { const cs = [...new Set([...m.entries()].filter(([id]) => parsed.has(id)).map(([, n]) => n))].sort((a, b) => b - a); varint(cs.length, out); for (const c of cs) { varint(c, out); groupsFor(m, c); } }
    else for (let c = maxCount; c >= 1; c--) groupsFor(m, c);
  };
  section(counts, 12);
  section(side, 3);
  const cp = deck.champion ? parsed.get(deck.champion) : undefined;
  if (cp) { out.push(1, cp.set, cp.variant); cardNum(cp); } else out.push(0);
  return { code: b32encode(out), skipped: [...new Set(skipped)] };
}

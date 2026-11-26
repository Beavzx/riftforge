// Deck import/export, local storage, starter decks.
import type { CardId, DeckList } from '../engine/types';
import type { CardDb, CardRec } from './cards';
import { store } from './dom';
import { decodeDeckCode, looksLikeDeckCode } from './deckcode';

export interface SavedDeck { id: string; name: string; deck: DeckList; updated: number; starter?: boolean; printings?: Record<CardId, string> }
export interface ParseResult { deck: DeckList; errors: string[]; warnings: string[]; name?: string; printings?: Record<CardId, string> }

type Section = 'legend' | 'champion' | 'main' | 'runes' | 'battlefields' | 'sideboard' | null;
const SECTION_RE: [RegExp, Section][] = [
  [/^(champion\s+)?legend/i, 'legend'],
  [/^(chosen\s+)?champion(\s+unit)?/i, 'champion'],
  [/^(main(\s*deck)?|deck|cards|units|spells|gear|gears)\b/i, 'main'],
  [/^runes?(\s*(deck|pool))?\b/i, 'runes'],
  [/^battle\s*fields?\b/i, 'battlefields'],
  [/^(side\s*board|sideboard|side(\s*deck)?)\b/i, 'sideboard'],
];

function sectionOf(line: string): Section | undefined {
  const t = line.replace(/^[#/*\-=\s]+/, '').replace(/[:\s]*(\(\d+\))?[:\s]*$/, '').trim();
  if (!t || /^\d/.test(t)) return undefined;
  // a header is short and has no count prefix
  for (const [re, s] of SECTION_RE) if (re.test(t) && t.split(/\s+/).length <= 3) return s;
  return undefined;
}

export function resolveCard(db: CardDb, query: string): CardRec | undefined {
  let q = query.trim().replace(/\s+/g, ' ').replace(/[’‘`]/g, "'").replace(/[–—]/g, '-');
  if (!q) return undefined;
  // "3 Cleave (OGN-004)": prefer the bracketed code
  const tail = /\(([A-Za-z]{3}-[A-Za-z0-9]+)\)\s*$/.exec(q);
  if (tail) { const c = resolveCard(db, tail[1]); if (c) return c; q = q.slice(0, tail.index).trim(); }
  // Code forms: OGN-001, ogn-001-298, OGN-001a, "OGN 001", with or without set total
  const code = /^([A-Za-z]{3})[-\s_]?(\d{1,3}[a-z*]?|r\d+[a-z]?|sp\d+[a-z]?|t\d+)(?:[-/](\d{1,3}))?\b/i.exec(q);
  if (code) {
    const set = code[1].toLowerCase(); const num = code[2].toLowerCase().replace(/[s*]$/, '');
    const exact = code[3] ? `${set}-${num.padStart(3, '0')}-${code[3]}` : '';
    if (exact && db.printings[exact]) return db.byId[db.printings[exact]];
    if (db.printings[`${set}-${num}`]) return db.byId[db.printings[`${set}-${num}`]];
    const prefix = `${set}-${/^\d/.test(num) ? num.padStart(3, '0') : num}-`;
    const hit = Object.keys(db.printings).find(k => k.startsWith(prefix) && !/[a-z]$/.test(k.split('-')[1]));
    if (hit) return db.byId[db.printings[hit]];
    // fall through: maybe "OGN-001 Name"
    const rest = q.slice(code[0].length).trim();
    if (rest) q = rest; else return undefined;
  }
  const lq = q.toLowerCase();
  const direct = db.byName.get(lq);
  if (direct?.length) return pickPrimary(direct);
  // strip parenthetical set notes: "Name (OGN)"
  const stripped = lq.replace(/\s*\([^)]*\)\s*$/, '').replace(/\s*\[[^\]]*\]\s*$/, '');
  if (db.byName.get(stripped)?.length) return pickPrimary(db.byName.get(stripped)!);
  // fuzzy: ignore punctuation
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const nq = norm(stripped);
  for (const c of db.list) if (norm(c.name) === nq || norm(`${c.name}${c.subtitle ?? ''}`) === nq) return c;
  return undefined;
}
const pickPrimary = (a: CardRec[]) => a.find(c => c.type !== 'Token') ?? a[0];

/** The full printed code (a data/printings.json key, e.g. "ogn-030a-298") named in a deck line, if any. */
export function printedKey(db: CardDb, q: string): string | undefined {
  const m = /(?:^|[\s(\[])([A-Za-z]{3})[-\s_]?(\d{1,3}[a-z]?|r\d+[a-z]?|sp\d+[a-z]?)(?:[-/](\d{1,3}))?(?=$|[\s)\]])/.exec(q);
  if (!m) return undefined;
  const set = m[1].toLowerCase();
  const raw = m[2].toLowerCase();
  const num = /^\d/.test(raw) ? raw.replace(/^(\d+)/, d => d.padStart(3, '0')) : raw;
  const base = `${set}-${num}`;
  if (m[3] && db.printings[`${base}-${m[3]}`]) return `${base}-${m[3]}`;
  if (db.printings[base]) return base;
  return Object.keys(db.printings).find(k => k.startsWith(base + '-'));
}

export function parseDeckText(text: string, db: CardDb): ParseResult {
  const errors: string[] = [], warnings: string[] = [];
  const deck: DeckList = { legend: '', champion: '', main: [], runes: [], battlefields: [], sideboard: [] };
  const printings: Record<CardId, string> = {};
  const trimmed = text.trim();
  if (looksLikeDeckCode(trimmed)) {
    const r = decodeDeckCode(trimmed, db);
    if (r) return r;
    errors.push('That looks like a deck code, but it could not be decoded.');
    return { deck, errors, warnings };
  }
  let section: Section = null; let name: string | undefined;
  // Tabletop Simulator: space-separated SET-NNN-K tokens, one per physical card
  const lines0 = /^\s*([A-Za-z]{3}-[A-Za-z0-9*]+-\d+\s+)*[A-Za-z]{3}-[A-Za-z0-9*]+-\d+\s*$/.test(trimmed) ? trimmed.split(/\s+/).map(t => t.replace(/-\d+$/, '')) : text.split(/\r?\n/);
  for (const rawLine of lines0) {
    const line = rawLine.replace(/\/\/.*$/, '').trim();
    if (!line) continue;
    const nameM = /^(?:name|deck\s*name|title)\s*[:=]\s*(.+)$/i.exec(line);
    if (nameM) { name = nameM[1].trim(); continue; }
    const sec = sectionOf(line);
    if (sec !== undefined) {
      section = sec;
      // "Legend: Name" inline form
      const inline = line.split(/:\s*/).slice(1).join(':').trim();
      if (!inline || /^\(?\d+\)?$/.test(inline)) continue;
      addLine(inline);
      continue;
    }
    addLine(line);
  }
  function addLine(line: string) {
    let count = 1; let q = line.replace(/^[-*•]\s*/, '');
    let m = /^(\d+)\s*[x×]?\s+(.+)$/i.exec(q);
    if (m) { count = +m[1]; q = m[2]; }
    else if ((m = /^(.+?)\s+[x×]\s*(\d+)$/i.exec(q)) || (m = /^(.+?)\s*\((\d+)\)$/.exec(q))) { count = +m[2]; q = m[1]; }
    else if ((m = /^[x×](\d+)\s+(.+)$/i.exec(q))) { count = +m[1]; q = m[2]; }
    if (count < 1 || count > 60) { errors.push(`Bad count in “${line}”.`); return; }
    const card = resolveCard(db, q);
    if (!card) { errors.push(`Unknown card: “${q}”.`); return; }
    // remember the exact printing (alt art) the list names, for card images and exact deck-code export
    const pk = printedKey(db, q);
    if (pk && db.printings[pk] === card.id) printings[card.id] ??= pk;
    place(card, count);
  }
  function place(card: CardRec, count: number) {
    const ids = Array(count).fill(card.id) as CardId[];
    let target = section;
    if (card.type === 'Legend') target = 'legend';
    else if (card.type === 'Battlefield') target = 'battlefields';
    else if (card.type === 'Rune') target = 'runes';
    else if (target !== 'champion' && target !== 'sideboard') target = 'main';
    switch (target) {
      case 'legend': if (deck.legend && deck.legend !== card.id) warnings.push(`Multiple legends; using ${card.name}.`); deck.legend = card.id; break;
      case 'champion':
        if (!deck.champion) { deck.champion = card.id; if (count > 1) deck.main.push(...ids.slice(1)); }
        else deck.main.push(...ids);
        break;
      case 'battlefields': deck.battlefields.push(...ids); break;
      case 'runes': deck.runes.push(...ids); break;
      case 'sideboard': deck.sideboard!.push(...ids); break;
      default: deck.main.push(...ids);
    }
  }
  // Some exporters list the champion inside the main deck as well (40 there): don't double count.
  if (deck.champion && deck.main.length >= 40 && deck.main.includes(deck.champion)) deck.main.splice(deck.main.indexOf(deck.champion), 1);
  inferChampion(deck, db, warnings);
  if (deck.main.length + (deck.champion ? 1 : 0) > 40 && !deck.sideboard?.length) warnings.push(`Main deck has ${deck.main.length + 1} cards; extra cards may be a sideboard.`);
  return { deck, errors, warnings, name, printings: Object.keys(printings).length ? printings : undefined };
}

/** If no champion section was given, choose the first Champion unit in the main deck that matches the legend. */
export function inferChampion(deck: DeckList, db: CardDb, warnings: string[] = []): void {
  if (deck.champion) return;
  const L = db.byId[deck.legend];
  const i = deck.main.findIndex(id => {
    const c = db.byId[id];
    return c?.type === 'Unit' && c.supertypes.includes('Champion') && (!L || c.tags.some(t => L.tags.includes(t)));
  });
  if (i >= 0) { deck.champion = deck.main[i]; deck.main.splice(i, 1); warnings.push(`Chosen champion: ${db.byId[deck.champion].name}.`); }
}

export function deckToText(deck: DeckList, db: CardDb, name?: string): string {
  const nm = (id: CardId) => { const c = db.byId[id]; return c ? (c.subtitle ? `${c.name}, ${c.subtitle}` : c.name) : id; };
  const group = (ids: CardId[]) => {
    const m = new Map<CardId, number>(); for (const id of ids) m.set(id, (m.get(id) ?? 0) + 1);
    return [...m].map(([id, n]) => `${n} ${nm(id)}`);
  };
  const out: string[] = [];
  if (name) out.push(`Name: ${name}`, '');
  out.push('Legend:', `1 ${nm(deck.legend)}`, '', 'Champion:', `1 ${nm(deck.champion)}`, '', 'Main Deck:', ...group(deck.main), '',
    'Battlefields:', ...group(deck.battlefields), '', 'Runes:', ...group(deck.runes));
  if (deck.sideboard?.length) out.push('', 'Sideboard:', ...group(deck.sideboard));
  return out.join('\n');
}

// ---- storage ----
const KEY = 'riftforge.decks.v1';
export function loadDecks(): SavedDeck[] { const d = store.get<SavedDeck[]>(KEY, []); return Array.isArray(d) ? d.filter(x => x && x.deck) : []; }
export function saveDecks(d: SavedDeck[]): boolean { return store.set(KEY, d.filter(x => !x.starter)); }

// ---- starters ----
const STARTER_LEGENDS: { legend: string; name: string; bfOffset: number }[] = [
  { legend: 'Dark Child', name: 'Starter: Annie — Fury/Chaos', bfOffset: 0 },
  { legend: 'Wuju Bladesman', name: 'Starter: Master Yi — Calm/Body', bfOffset: 3 },
  { legend: 'Lady of Luminosity', name: 'Starter: Lux — Mind/Order', bfOffset: 6 },
  { legend: 'Might of Demacia', name: 'Starter: Garen — Body/Order', bfOffset: 9 },
];

export function buildStarter(db: CardDb, legendName: string, bfOffset = 0, mainSize = 39): DeckList | null {
  const L = db.list.find(c => c.type === 'Legend' && c.name === legendName);
  if (!L) return null;
  const doms = L.domains;
  const inDom = (c: CardRec) => c.domains.length > 0 && c.domains.every(d => d === 'Colorless' || doms.includes(d));
  const champTag = L.tags.find(t => db.list.some(c => c.type === 'Unit' && c.supertypes.includes('Champion') && c.tags.includes(t))) ?? L.tags[0];
  const champs = db.list.filter(c => c.type === 'Unit' && c.supertypes.includes('Champion') && c.tags.includes(champTag) && inDom(c))
    .sort((a, b) => (a.energy ?? 9) - (b.energy ?? 9));
  const champion = champs[0];
  if (!champion) return null;
  const pref = (c: CardRec) => (c.set === 'ogn' || c.set === 'ogs' ? 0 : 1);
  const pool = db.list.filter(c => ['Unit', 'Spell', 'Gear'].includes(c.type) && inDom(c) && c.energy != null &&
    !c.supertypes.includes('Token') && (!c.supertypes.includes('Champion') || c.tags.includes(champTag)) &&
    (!c.supertypes.includes('Signature') || c.tags.includes(champTag)) && c.id !== champion.id)
    .sort((a, b) => pref(a) - pref(b) || (a.energy! - b.energy!) || a.id.localeCompare(b.id));
  const main: CardId[] = [champion.id, champion.id];
  const named = new Map<string, number>([[champion.name, 3]]);
  let sig = 0;
  const want = { Unit: 24, Spell: 10, Gear: 3 };
  const have = { Unit: 2, Spell: 0, Gear: 0 } as Record<string, number>;
  const curve = (e: number) => (e <= 2 ? 0 : e <= 4 ? 1 : 2);
  const curveHave = [0, 0, 0]; const curveWant = [16, 17, 6];
  for (const pass of [0, 1, 2]) {
    for (const c of pool) {
      if (main.length >= mainSize) break;
      const t = c.type as 'Unit' | 'Spell' | 'Gear';
      if (pass < 2 && have[t] >= want[t]) continue;
      if (pass === 0 && curveHave[curve(c.energy!)] >= curveWant[curve(c.energy!)]) continue;
      const n = named.get(c.name) ?? 0;
      const isSig = c.supertypes.includes('Signature');
      let k = Math.min(3 - n, mainSize - main.length, pass === 0 ? 2 : 3);
      if (isSig) k = Math.min(k, 3 - sig);
      if (k <= 0) continue;
      for (let i = 0; i < k; i++) main.push(c.id);
      named.set(c.name, n + k); have[t] += k; curveHave[curve(c.energy!)] += k; if (isSig) sig += k;
    }
  }
  const runeOf = (d: string) => db.list.find(c => c.type === 'Rune' && c.domains.includes(d as never));
  const r1 = runeOf(doms[0]), r2 = runeOf(doms[1] ?? doms[0]);
  const runes: CardId[] = [];
  for (let i = 0; i < 6; i++) { if (r1) runes.push(r1.id); if (r2) runes.push(r2.id); }
  const bfs = db.list.filter(c => c.type === 'Battlefield' && (c.set === 'ogn' || c.set === 'ogs'));
  const bfAll = bfs.length >= 3 ? bfs : db.list.filter(c => c.type === 'Battlefield');
  const battlefields = [0, 1, 2].map(i => bfAll[(bfOffset + i) % Math.max(1, bfAll.length)]?.id).filter(Boolean) as CardId[];
  return { legend: L.id, champion: champion.id, main, runes, battlefields };
}

export function starterDecks(db: CardDb, mainSize = 39): SavedDeck[] {
  const out: SavedDeck[] = [];
  for (const s of STARTER_LEGENDS) {
    const deck = buildStarter(db, s.legend, s.bfOffset, mainSize);
    if (deck) out.push({ id: 'starter-' + s.legend.replace(/\W+/g, '-').toLowerCase(), name: s.name, deck, updated: 0, starter: true });
  }
  if (!out.length) { // card data without Proving Grounds: use first legends available
    for (const L of db.list.filter(c => c.type === 'Legend').slice(0, 4)) {
      const deck = buildStarter(db, L.name, out.length * 3, mainSize);
      if (deck) out.push({ id: 'starter-' + L.id, name: 'Starter: ' + L.name, deck, updated: 0, starter: true });
    }
  }
  return out;
}

export function deckSummary(deck: DeckList, db: CardDb): string {
  const L = db.byId[deck.legend]; const C = db.byId[deck.champion];
  return `${L?.name ?? 'No legend'} · ${C?.name ?? 'no champion'} · ${deck.main.length + (deck.champion ? 1 : 0)} main · ${deck.runes.length} runes · ${deck.battlefields.length} bf`;
}

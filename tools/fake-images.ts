// DEV ONLY: generates clearly-marked placeholder card images so the image pipeline (printed code -> canonical
// -> text frame fallback, landscape battlefields, zoom, lazy loading) can be verified before the real pack exists.
// Output goes to data/images-dev/ (never data/images/, which is reserved for the real pack).
// tools/bundle.ts packs data/images-dev/ into the dist/atlas/ sprite atlases only with --dev-images (or RIFTFORGE_DEV_IMAGES=1).
//
//   npx tsx tools/fake-images.ts                 # every card in the starter decks (+ a few alt-art printings)
//   npx tsx tools/fake-images.ts --all           # every printed code in data/printings.json
//   npx tsx tools/fake-images.ts --skip 3        # leave out every 3rd card (exercise the text-frame fallback)
//   npx tsx tools/fake-images.ts ogn-030-298 ... # just these printed codes
import sharp from 'sharp';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDb, type CardRec } from '../src/ui/cards';
import { starterDecks } from '../src/ui/decks';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'data/images-dev');
const args = process.argv.slice(2);
const all = args.includes('--all');
const skipN = args.includes('--skip') ? Number(args[args.indexOf('--skip') + 1]) : 0;
const explicit = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--skip');

const db = buildDb(JSON.parse(readFileSync(join(root, 'data/cards.json'), 'utf8')));
const printings = JSON.parse(readFileSync(join(root, 'data/printings.json'), 'utf8')) as Record<string, string>;

const DOM: Record<string, [string, string]> = {
  Fury: ['#e2414b', '#5a0f16'], Calm: ['#3fb36d', '#0f3d24'], Mind: ['#3f86e0', '#0f2850'], Body: ['#ef8a2b', '#5a2a06'],
  Chaos: ['#9b55d8', '#2d0f4a'], Order: ['#e0b62a', '#4d3a05'], Colorless: ['#9aa0aa', '#2b2f36'],
};
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
function hash(s: string) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function wrap(text: string, width: number, maxLines: number): string[] {
  const words = text.replace(/\[([^\]]+)\]/g, '[$1]').split(/\s+/); const lines: string[] = []; let cur = '';
  for (const w of words) { if ((cur + ' ' + w).trim().length > width) { lines.push(cur.trim()); cur = w; } else cur += ' ' + w; if (lines.length >= maxLines) break; }
  if (cur.trim() && lines.length < maxLines) lines.push(cur.trim());
  return lines;
}

function svgFor(c: CardRec, code: string): { svg: string; w: number; h: number } {
  const land = c.type === 'Battlefield';
  const W = land ? 520 : 372, H = land ? 372 : 520;
  const doms = c.domains.filter(d => d !== 'Colorless');
  const [a, b] = DOM[doms[0] ?? 'Colorless']; const [a2] = DOM[doms[1] ?? doms[0] ?? 'Colorless'];
  const alt = /^[a-z]+-[a-z]*\d+[a-z]+(-|$)/.test(code);
  const r = hash(code);
  const shapes = Array.from({ length: 7 }, (_, i) => {
    const x = (r >> (i * 3)) % W, y = ((r >> (i * 2)) * 7 + i * 53) % (H * 0.55) + 40, rad = 20 + ((r >> i) % 70);
    return `<circle cx="${x}" cy="${y}" r="${rad}" fill="${i % 2 ? a2 : '#fff'}" opacity="${0.08 + (i % 3) * 0.05}"/>`;
  }).join('');
  const lines = wrap(c.text || '', land ? 58 : 40, land ? 4 : 7);
  const textY = land ? H - 112 : H - 178;
  const cost = c.energy != null ? `<circle cx="34" cy="36" r="22" fill="#f4f6fb" stroke="#1b2333" stroke-width="3"/><text x="34" y="45" font-size="26" font-weight="800" text-anchor="middle" fill="#172033">${c.energy}</text>` : '';
  const pips = Array.from({ length: c.power ?? 0 }, (_, i) => `<rect x="${26 + i * 0}" y="${66 + i * 18}" width="14" height="14" transform="rotate(45 ${33} ${73 + i * 18})" fill="${a}" stroke="#000" stroke-width="1.5"/>`).join('');
  const might = c.might != null ? `<path d="M${W - 52} ${H - 64} l22 -8 l22 8 v26 l-22 18 l-22 -18z" fill="#2a2f3a" stroke="#fff" stroke-width="2"/><text x="${W - 30}" y="${H - 34}" font-size="24" font-weight="800" text-anchor="middle" fill="#fff">${c.might}</text>` : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="${alt ? 0 : 1}" y2="1"><stop offset="0" stop-color="${alt ? a2 : a}"/><stop offset="1" stop-color="${b}"/></linearGradient>
  <linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset=".35" stop-color="#000" stop-opacity=".72"/></linearGradient></defs>
  <rect width="${W}" height="${H}" rx="18" fill="#111"/>
  <rect x="8" y="8" width="${W - 16}" height="${H - 16}" rx="13" fill="url(#g)"/>
  ${shapes}
  <path d="M0 ${H * 0.42} C ${W * 0.3} ${H * 0.3}, ${W * 0.6} ${H * 0.55}, ${W} ${H * 0.38}" stroke="#fff" stroke-opacity=".25" stroke-width="3" fill="none"/>
  <rect x="8" y="${textY - 56}" width="${W - 16}" height="${H - textY + 48}" rx="10" fill="url(#t)"/>
  <text x="${land ? W / 2 : 66}" y="${land ? 44 : 44}" font-family="Inter, DejaVu Sans, sans-serif" font-size="${land ? 28 : 24}" font-weight="800" fill="#fff" ${land ? 'text-anchor="middle"' : ''}>${esc(c.name.slice(0, 26))}</text>
  ${c.subtitle ? `<text x="${land ? W / 2 : 66}" y="${land ? 70 : 66}" font-family="Inter, sans-serif" font-size="15" fill="#fff" fill-opacity=".85" ${land ? 'text-anchor="middle"' : ''}>${esc(c.subtitle)}</text>` : ''}
  ${land ? '' : cost + pips}
  <text x="22" y="${textY - 22}" font-family="Inter, sans-serif" font-size="12.5" font-weight="700" fill="#fff" fill-opacity=".8" letter-spacing="1.5">${esc([c.type, ...c.tags.slice(0, 2)].join(' · ').toUpperCase())}</text>
  ${lines.map((l, i) => `<text x="22" y="${textY + i * 19}" font-family="Inter, sans-serif" font-size="14.5" fill="#fff">${esc(l)}</text>`).join('')}
  ${might}
  <text x="${W / 2}" y="${H * 0.3}" font-family="Inter, sans-serif" font-size="${land ? 30 : 26}" font-weight="900" text-anchor="middle" fill="#fff" fill-opacity=".22" transform="rotate(-18 ${W / 2} ${H * 0.3})">DEV PLACEHOLDER${alt ? ' · ALT' : ''}</text>
  <text x="${W - 16}" y="${H - 14}" font-family="Inter, sans-serif" font-size="11" text-anchor="end" fill="#fff" fill-opacity=".7">${esc(code)}</text>
</svg>`;
  return { svg, w: W, h: H };
}

let codes: string[];
if (explicit.length) codes = explicit.map(s => s.toLowerCase());
else if (all) codes = Object.keys(printings);
else {
  const ids = new Set<string>();
  for (const d of starterDecks(db, 39)) for (const id of [d.deck.legend, d.deck.champion, ...d.deck.main, ...d.deck.runes, ...d.deck.battlefields]) if (id) ids.add(id);
  codes = [...ids];
  // alt-art printings of a few of them, to verify "show the printing the player imported"
  for (const id of [...ids].slice(0, 12)) { const altCode = (db.byId[id]?.printings ?? []).find(p => /^[a-z]+-[a-z]*\d+[a-z]+(-|$)/.test(p)); if (altCode) codes.push(altCode); }
}
if (skipN > 1) codes = codes.filter((_, i) => i % skipN !== skipN - 1);

if (existsSync(out) && !explicit.length) rmSync(out, { recursive: true });
mkdirSync(out, { recursive: true });
let n = 0;
for (const code of codes) {
  const id = printings[code] ?? (db.byId[code] ? code : undefined);
  const c = id ? db.byId[id] : undefined;
  if (!c) { console.warn('unknown printed code', code); continue; }
  const { svg } = svgFor(c, code);
  await sharp(Buffer.from(svg)).webp({ quality: 62 }).toFile(join(out, `${code}.webp`));
  n++;
}
console.log(`fake-images: wrote ${n} placeholder images to data/images-dev/ (bundle with: npx tsx tools/bundle.ts --dev-images)`);

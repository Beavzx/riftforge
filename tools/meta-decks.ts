// META-SIM: builds data/meta-decks/<placing>-<legend-slug>.json + docs/meta-decks.md from data/meta-decks/_raw.txt.
//   node --import tsx tools/meta-decks.ts
// _raw.txt was scraped (2026-11-25) from the riftdecks.com deck pages of the "Demacia League Bologna - [Post-Ban Meta]"
// tournament (406 players, 2026-11-22, Radiance constructed). Each line: <deckId>= <T><qty><printed code> ...
// T: L legend, C chosen champion, U unit, G gear, S spell, B battlefield, R rune, X sideboard.
// Printed codes (e.g. sfd-177a, ogn-214a) map to card ids through data/printings.json (alt arts -> base card).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDeck } from '../src/engine/deck.ts';
import type { CardDef, CardId, DeckList } from '../src/engine/types.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOURNAMENT_URL = 'https://riftdecks.com/riftbound-tournaments/demacia-league-bologna-post-ban-meta-tournament-decks-19507';
const DECK_URL = (slug: string) => `https://riftdecks.com/riftbound-metagame/deck-${slug}`;

// Placings as listed on the tournament page (19th and 21st/22nd have no published list there; the top 20 published lists are used).
// Player names are given in plain ASCII (the site renders some letters as Cyrillic look-alikes).
export const META: { placing: number; record: string; player: string; deckName: string; slug: string }[] = [
  { placing: 1, record: '9-1-0', player: 'misseri90', deckName: 'Azir, Emperor of the Sands', slug: 'azir-emperor-of-the-sands-361455' },
  { placing: 2, record: '8-0-2', player: 'CC JustSR', deckName: 'Vex, Gloomist', slug: 'vex-gloomist-361456' },
  { placing: 3, record: '8-0-2', player: 'ECL ElSub89', deckName: "Evelynn, Agony's Embrace", slug: 'evelynn-agony-s-embrace-359617' },
  { placing: 4, record: '8-0-2', player: 'ElMambo', deckName: 'Reksai, Void Burrower', slug: 'reksai-void-burrower-361449' },
  { placing: 5, record: '8-2-0', player: 'Valdi4real', deckName: 'Reksai, Void Burrower', slug: 'reksai-void-burrower-361459' },
  { placing: 6, record: '7-1-2', player: 'darkchri99', deckName: "Kai'sa, Daughter of the Void", slug: 'kai-sa-daughter-of-the-void-361457' },
  { placing: 7, record: '7-1-2', player: 'Kokey', deckName: "Kai'sa, Daughter of the Void", slug: 'kai-sa-daughter-of-the-void-361452' },
  { placing: 8, record: '7-2-1', player: 'CC Yuston', deckName: 'Azir, Emperor of the Sands', slug: 'azir-emperor-of-the-sands-361458' },
  { placing: 9, record: '7-2-0', player: 'ECL Diabloz89', deckName: 'Irelia, Blade Dancer', slug: 'irelia-blade-dancer-361460' },
  { placing: 10, record: '6-1-2', player: 'rotoreto', deckName: 'Azir, Emperor of the Sands', slug: 'azir-emperor-of-the-sands-361461' },
  { placing: 11, record: '6-1-2', player: 'LorenzTheDoc', deckName: 'Kennen, Heart of the Tempest', slug: 'kennen-heart-of-the-tempest-361462' },
  { placing: 12, record: '6-2-1', player: 'pogrommm', deckName: 'Ezreal, Prodigal Explorer', slug: 'ezreal-prodigal-explorer-361463' },
  { placing: 13, record: '6-2-1', player: 'Jhino Insegno', deckName: 'Sett, The Boss', slug: 'sett-the-boss-359913' },
  { placing: 14, record: '6-2-1', player: 'ENNE97', deckName: 'Azir, Emperor of the Sands', slug: 'azir-emperor-of-the-sands-361464' },
  { placing: 15, record: '6-2-1', player: 'ilMilly95', deckName: "Evelynn, Agony's Embrace", slug: 'evelynn-agony-s-embrace-361465' },
  { placing: 16, record: '6-2-1', player: 'StarWOrso', deckName: 'Vex, Gloomist', slug: 'vex-gloomist-361466' },
  { placing: 17, record: '6-1-1', player: 'SH BADTRONPLAYER', deckName: 'Reksai, Void Burrower', slug: 'reksai-void-burrower-361451' },
  { placing: 18, record: '', player: 'Ganjalf', deckName: "Kai'sa post ban", slug: 'kai-sa-post-ban-362114' },
  { placing: 20, record: '6-2-0', player: 'DonCapucino', deckName: 'Irelia, Blade Dancer', slug: 'irelia-blade-dancer-359618' },
  { placing: 23, record: '6-2-0', player: 'SH Daniela Zilioli', deckName: "Kai'sa, Daughter of the Void", slug: 'kai-sa-daughter-of-the-void-361453' },
];

export interface MetaDeck {
  placing: number; record: string; player: string; deckName: string; legendName: string; source: string; tournament: string;
  deck: DeckList; printings: Record<CardId, string>; problems: string[]; unmapped: string[];
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function main(): void {
  const db = JSON.parse(readFileSync(join(ROOT, 'data/cards.json'), 'utf8')) as Record<CardId, CardDef>;
  const printings = JSON.parse(readFileSync(join(ROOT, 'data/printings.json'), 'utf8')) as Record<string, CardId>;
  const ban = JSON.parse(readFileSync(join(ROOT, 'data/banlist.json'), 'utf8')) as { standard: string[]; effective: string };
  const keys = Object.keys(printings);
  const lookup = (code: string): { id?: CardId; key?: string } => {
    const k = printings[code] ? code : keys.find(x => x.startsWith(code + '-'));
    return k ? { id: printings[k], key: k } : {};
  };
  const raw = new Map<string, string>();
  for (const line of readFileSync(join(ROOT, 'data/meta-decks/_raw.txt'), 'utf8').split('\n')) {
    const m = /^(\d+)= (.+)$/.exec(line.trim()); if (m) raw.set(m[1], m[2]);
  }
  mkdirSync(join(ROOT, 'data/meta-decks'), { recursive: true });
  const out: MetaDeck[] = [];
  for (const meta of META) {
    const id = meta.slug.split('-').pop()!;
    const line = raw.get(id); if (!line) throw new Error(`no raw list for ${meta.slug}`);
    const deck: DeckList = { legend: '', champion: '', main: [], runes: [], battlefields: [], sideboard: [] };
    const pr: Record<CardId, string> = {}; const unmapped: string[] = [];
    for (const tok of line.split(/\s+/)) {
      const m = /^([LCUGSBRX])(\d+)([a-z]+-[a-z0-9]+)$/.exec(tok); if (!m) { unmapped.push(tok); continue; }
      const [, t, q, code] = m; const n = +q;
      const { id: cid, key } = lookup(code);
      if (!cid || !db[cid]) { unmapped.push(code); continue; }
      pr[cid] ??= key!;
      const ids = Array(n).fill(cid) as CardId[];
      if (t === 'L') deck.legend = cid;
      else if (t === 'C') { deck.champion = cid; if (n > 1) deck.main.push(...ids.slice(1)); }
      else if (t === 'B') deck.battlefields.push(...ids);
      else if (t === 'R') deck.runes.push(...ids);
      else if (t === 'X') deck.sideboard!.push(...ids);
      else deck.main.push(...ids);
    }
    const problems = validateDeck(deck, db, { battlefields: 3, banlist: ban.standard, tournament: true }).map(p => `${p.code}: ${p.message}`);
    const legend = db[deck.legend];
    const champName = db[deck.champion]?.name;
    const ltag = legend ? (legend.tags.find(t => t === champName) ?? legend.tags[legend.tags.length - 1]) : undefined;
    const legendName = legend ? `${ltag ?? ''}, ${legend.subtitle ? `${legend.name}, ${legend.subtitle}` : legend.name}`.replace(/^, /, '') : '?';
    const md: MetaDeck = { placing: meta.placing, record: meta.record, player: meta.player, deckName: meta.deckName, legendName,
      source: DECK_URL(meta.slug), tournament: TOURNAMENT_URL, deck, printings: pr, problems, unmapped };
    out.push(md);
    const file = `${String(meta.placing).padStart(2, '0')}-${slugify(ltag ?? legend?.name ?? meta.deckName)}.json`;
    (md as MetaDeck & { file?: string }).file = file;
    writeFileSync(join(ROOT, 'data/meta-decks', file), JSON.stringify(md, null, 1) + '\n');
  }
  // docs
  const name = (cid: CardId) => { const c = db[cid]; return c ? (c.subtitle ? `${c.name}, ${c.subtitle}` : c.name) : cid; };
  const L: string[] = [];
  L.push('# Meta decks: Demacia League Bologna - [Post-Ban Meta]', '');
  L.push(`Source: [riftdecks.com tournament page](${TOURNAMENT_URL}) (Runes League, Italy, 2026-11-22, 406 players, Radiance constructed, after the 2026-11-23 Rules Hub ban list was announced).`);
  L.push('Scraped 2026-11-25 by META-SIM from each deck page\'s card table (printed card codes, so alt arts are exact) through a browser (riftdecks.com blocks the fetch tools);');
  L.push('every list was checksummed against the page data. Rebuild with `node --import tsx tools/meta-decks.ts` (raw lists: data/meta-decks/_raw.txt).');
  L.push('The tournament page publishes lists for placings 1-18, 20, 23, 27, ... (19, 21, 22 are missing), so the "top 20" here is the top 20 *published* lists.', '');
  L.push(`Validation: engine \`validateDeck\` with \`tournament: true\` and the standard ban list (data/banlist.json, effective ${ban.effective}).`, '');
  L.push('| # | Record | Player | Legend | Champion | Battlefields | Runes | Main | Side | Status | Source |', '|---|---|---|---|---|---|---|---|---|---|---|');
  for (const d of out) {
    const runes = Object.entries(d.deck.runes.reduce((a, r) => { a[name(r)] = (a[name(r)] ?? 0) + 1; return a; }, {} as Record<string, number>)).map(([k, v]) => `${v} ${k.replace(' Rune', '')}`).join(' / ');
    const status = d.unmapped.length ? `UNMAPPED: ${d.unmapped.join(', ')}` : d.problems.length ? `ILLEGAL: ${d.problems.join('; ')}` : 'legal';
    L.push(`| ${d.placing} | ${d.record || '-'} | ${d.player} | ${d.legendName} | ${name(d.deck.champion)} | ${d.deck.battlefields.map(name).join(', ')} | ${runes} | ${d.deck.main.length + 1} | ${d.deck.sideboard!.length} | ${status} | [deck](${d.source}) |`);
  }
  L.push('', '## Decklists', '');
  for (const d of out) {
    L.push(`### ${d.placing}. ${d.legendName} (${d.player})`, '');
    const cnt = (ids: CardId[]) => Object.entries(ids.reduce((a, r) => { a[r] = (a[r] ?? 0) + 1; return a; }, {} as Record<string, number>)).map(([k, v]) => `${v} ${name(k)}`).join(', ');
    L.push(`- Champion: ${name(d.deck.champion)}`, `- Main (${d.deck.main.length} + champion): ${cnt(d.deck.main)}`, `- Battlefields: ${d.deck.battlefields.map(name).join(', ')}`, `- Runes: ${cnt(d.deck.runes)}`, `- Sideboard: ${cnt(d.deck.sideboard!)}`, '');
  }
  writeFileSync(join(ROOT, 'docs/meta-decks.md'), L.join('\n'));
  for (const d of out) console.log(String(d.placing).padStart(2), d.legendName.padEnd(36), d.deck.main.length + 1, d.deck.runes.length, d.deck.battlefields.length, d.unmapped.length ? 'UNMAPPED ' + d.unmapped : '', d.problems.join('; '));
}
main();

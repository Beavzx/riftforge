// Normalises data/cards.raw.json (Hugging Face Wysme/riftbound-cards snapshot) into data/cards.json.
// - One canonical CardDef per distinct card (alt arts / showcase / reprints collapse onto one id).
// - data/printings.json maps every printed cardCode -> canonical id.
// Run: npx tsx tools/build-cards.ts
import { readFileSync, writeFileSync } from 'node:fs';
import type { CardDef, CardType, Domain } from '../src/engine/types.ts';

interface Raw {
  cardCode: string; name: string; subtitle?: string | null; fullName: string; setCode: string; cardSet: string;
  rarity: string; domains?: string[] | null; cardType: string; cardTypeLabels?: string[] | null; tags?: string[] | null;
  energy: number | null; power: number | null; might: number | null; abilityEffective?: string | null;
  abilityOriginal?: string | null; hasErrata?: boolean; imageUrl?: string;
}

const raw: Raw[] = JSON.parse(readFileSync('data/cards.raw.json', 'utf8'));
const SET_ORDER = ['ogs', 'ogn', 'sfd', 'unl', 'ven', 'rad'];

const clean = (t: string | null | undefined) =>
  (t ?? '').replace(/\n?▲\n?\[OLD TEXT\]\s*$/u, '').trim();
const stripReminder = (t: string) => t.replace(/\s*\([^()]*\)/g, '').replace(/[ \t]+\n/g, '\n').trim();

const groups = new Map<string, Raw[]>();
for (const r of raw) {
  const key = `${r.fullName}|${r.cardType}`;
  (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
}

const score = (r: Raw) =>
  (r.rarity === 'Showcase' ? 0 : 1000) + (/[a-z]$/.test(r.cardCode.split('-')[1] ?? '') ? 0 : 500) +
  clean(r.abilityEffective).length / 1000 + (r.hasErrata ? 2000 : 0);

const cards: Record<string, CardDef & { reminderText: string; printings: string[]; hasErrata: boolean }> = {};
const printings: Record<string, string> = {};
const warnings: string[] = [];

for (const [key, list] of groups) {
  // Canonical printing: errata'd, non-showcase, full reminder text; tie-break newest set.
  const best = [...list].sort((a, b) => score(b) - score(a) ||
    SET_ORDER.indexOf(b.setCode) - SET_ORDER.indexOf(a.setCode))[0];
  const textWithReminder = clean(best.abilityEffective);
  const rulesTexts = new Set(list.map(r => stripReminder(clean(r.abilityEffective))));
  if (rulesTexts.size > 1) warnings.push(`${key}: printings differ beyond reminder text: ${[...rulesTexts].map(t => JSON.stringify(t)).join(' VS ')}`);
  const labels = best.cardTypeLabels ?? [best.cardType];
  const kw = [...new Set([...textWithReminder.matchAll(/\[([A-Za-z][A-Za-z' -]*(?: \d+)?)\]/g)].map(m => m[1]))]
    .filter(k => !/^(S|C|A|T|M|E|R|B|Y|G|O|P|Add|OLD TEXT)$/.test(k));
  const def = {
    id: best.cardCode,
    name: best.name,
    subtitle: best.subtitle ?? undefined,
    type: (best.cardType as CardType),
    supertypes: labels.filter(l => l !== best.cardType),
    tags: best.tags ?? [],
    domains: (best.domains ?? []) as Domain[],
    energy: best.energy,
    power: best.power,
    might: best.might,
    keywords: kw,
    text: stripReminder(textWithReminder),
    reminderText: textWithReminder,
    set: best.setCode,
    rarity: best.rarity,
    printings: list.map(r => r.cardCode),
    hasErrata: list.some(r => r.hasErrata),
  };
  cards[def.id] = def;
  for (const r of list) printings[r.cardCode] = def.id;
}

// Second pass: authoritative keywords come from tools/analyze-cards.ts (intrinsic keywords only, not ones
// a card merely grants or mentions). Run order: build-cards -> analyze-cards -> build-cards.
try {
  const analysis = JSON.parse(readFileSync('data/card-analysis.json', 'utf8')) as Record<string, { intrinsicKeywords?: string[]; keywordCosts?: unknown }>;
  let fixed = 0;
  for (const [id, a] of Object.entries(analysis)) {
    const c = cards[id];
    if (c && a.intrinsicKeywords) { c.keywords = a.intrinsicKeywords; (c as any).keywordCosts = a.keywordCosts; fixed++; }
  }
  console.log(`keywords taken from card-analysis.json for ${fixed} cards`);
} catch { console.log('no data/card-analysis.json yet; keywords are raw bracket scan'); }

// Third pass: manual corrections verified against the official gallery / printed cards / errata articles
// (data/overrides.json, one { field: value, source } object per card id; every entry is listed in docs/data-audit.md).
// Overrides win over both the scrape and the keyword pass. If an override sets reminderText but not text, text is
// re-derived from it; attachedReminderText (an Equipment's bottom band, i.e. what the equipped unit has) likewise
// yields attachedText.
try {
  const overrides = JSON.parse(readFileSync('data/overrides.json', 'utf8')) as Record<string, Record<string, unknown>>;
  let applied = 0;
  for (const [id, o] of Object.entries(overrides)) {
    const c = cards[id] as unknown as Record<string, unknown>;
    if (!c) { warnings.push(`data/overrides.json: unknown card id ${id}`); continue; }
    for (const [field, value] of Object.entries(o)) if (field !== 'source') c[field] = value;
    if ('reminderText' in o && !('text' in o)) c.text = stripReminder(String(o.reminderText));
    if ('attachedReminderText' in o && !('attachedText' in o)) c.attachedText = stripReminder(String(o.attachedReminderText));
    applied++;
  }
  console.log(`overrides applied to ${applied} cards`);
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  console.log('no data/overrides.json');
}

// Rules-bearing parentheticals (e.g. "(Tokens aren't cards.)") are only in reminderText. Card scripts must
// implement reminderText semantics; `text` is for display without reminders.
writeFileSync('data/cards.json', JSON.stringify(cards));
writeFileSync('data/printings.json', JSON.stringify(printings));
writeFileSync('data/build-warnings.txt', warnings.join('\n') + '\n');
const byType: Record<string, number> = {};
for (const c of Object.values(cards)) byType[c.type] = (byType[c.type] ?? 0) + 1;
console.log(`canonical cards: ${Object.keys(cards).length}`, byType, `warnings: ${warnings.length}`);

// Deck validation (CR 101-103).
import type { CardDef, CardId, DeckList } from './types.ts';

export interface DeckProblem { code: string; message: string }

function championTag(legend: CardDef, champion: CardDef | undefined): string | null {
  if (champion) {
    const shared = legend.tags.filter(t => champion.tags.includes(t));
    if (shared.length) return shared.find(t => t === champion.name) ?? shared[shared.length - 1];
  }
  return legend.tags[legend.tags.length - 1] ?? null;
}

function fitsIdentity(card: CardDef, identity: Set<string>): boolean {
  const doms = card.domains.filter(d => d !== 'Colorless');
  return doms.every(d => identity.has(d));
}

export function validateDeck(deck: DeckList, db: Record<CardId, CardDef>, opts: { battlefields?: number; banlist?: string[]; tournament?: boolean } = {}): DeckProblem[] {
  const out: DeckProblem[] = [];
  const get = (id: CardId) => db[id];
  const legend = get(deck.legend);
  if (!legend) { out.push({ code: 'legend.missing', message: `unknown legend ${deck.legend}` }); return out; }
  if (legend.type !== 'Legend') out.push({ code: 'legend.type', message: `${legend.name} is not a Legend` });
  const identity = new Set<string>(legend.domains);
  const champ = get(deck.champion);
  const tag = championTag(legend, champ);
  // 103.2.a chosen champion
  if (!champ) out.push({ code: 'champion.missing', message: `unknown champion ${deck.champion}` });
  else {
    if (champ.type !== 'Unit' || !champ.supertypes.includes('Champion')) out.push({ code: 'champion.type', message: `${champ.name} is not a Champion unit` });
    if (tag && !champ.tags.includes(tag)) out.push({ code: 'champion.tag', message: `${champ.name} doesn't match the legend's champion tag ${tag}` });
    if (champ.supertypes.includes('Signature')) out.push({ code: 'champion.signature', message: 'Signature units cannot be the Chosen Champion' });
    if (!fitsIdentity(champ, identity)) out.push({ code: 'identity', message: `${champ.name} is outside the domain identity` });
  }
  // CR 103.3: main deck at least 40 cards including the Chosen Champion (DeckList.main excludes it)
  const total = deck.main.length + 1;
  if (total < 40) out.push({ code: 'main.size', message: `main deck has ${total} cards (min 40, champion included)` });
  if (opts.tournament && total !== 40) out.push({ code: 'main.size.warning', message: `tournament decks are usually exactly 40 cards (this one has ${total})` });
  const banned = new Set((opts.banlist ?? []).map(x => x.toLowerCase()));
  if (banned.size) for (const id of [deck.legend, deck.champion, ...deck.main, ...deck.battlefields]) {
    const c = get(id); if (!c) continue;
    const full = (c.subtitle ? `${c.name}, ${c.subtitle}` : c.name).toLowerCase();
    if (banned.has(id.toLowerCase()) || banned.has(full) || banned.has(c.name.toLowerCase())) out.push({ code: 'banned', message: `${c.name} is banned` });
  }
  const byName = new Map<string, number>();
  let signatures = 0;
  // TR 403 / 601.1.c: sideboard up to 10 valid main-deck cards, copy limits combined with the main deck
  if ((deck.sideboard ?? []).length > 10) out.push({ code: 'sideboard.size', message: `sideboard of ${deck.sideboard!.length} (max 10)` });
  for (const id of [deck.champion, ...deck.main, ...(deck.sideboard ?? [])]) {
    const c = get(id);
    if (!c) { out.push({ code: 'card.unknown', message: `unknown card ${id}` }); continue; }
    if (!['Unit', 'Gear', 'Spell'].includes(c.type)) out.push({ code: 'main.type', message: `${c.name} (${c.type}) can't be in the main deck` });
    if (c.supertypes.includes('Token')) out.push({ code: 'main.token', message: `${c.name} is a token` });
    const key = c.subtitle ? `${c.name}, ${c.subtitle}` : c.name;
    byName.set(key, (byName.get(key) ?? 0) + 1);
    if (!fitsIdentity(c, identity)) out.push({ code: 'identity', message: `${c.name} is outside the domain identity` });
    if (c.supertypes.includes('Signature')) {
      signatures++;
      if (tag && !c.tags.includes(tag)) out.push({ code: 'signature.tag', message: `${c.name} is a Signature card of another champion` });
    }
  }
  for (const [name, n] of byName) {
    const c = Object.values(db).find(x => (x.subtitle ? `${x.name}, ${x.subtitle}` : x.name) === name);
    const unique = c && (/\[Unique\]/.test(c.text) || c.keywords.includes('Unique'));
    const anyNumber = c && /Your deck can have any number of cards named/.test(c.text);
    if (n > 3 && !anyNumber) out.push({ code: 'copies', message: `${n} copies of ${name} (max 3)` });
    if (unique && n > 1) out.push({ code: 'unique', message: `${name} is Unique (max 1)` });
  }
  // B8-14 Neeko, Blending In: extra legends only with Neeko in the deck, at most 3, distinct names, not the starting legend
  if (deck.extraLegends?.length) {
    const neeko = [deck.champion, ...deck.main].some(id => get(id)?.text.includes('choose up to 3 different legends'));
    if (!neeko) out.push({ code: 'extraLegends', message: 'extra legends need Neeko, Blending In in the deck' });
    if (deck.extraLegends.length > 3) out.push({ code: 'extraLegends', message: 'at most 3 extra legends' });
    const names = deck.extraLegends.map(id => get(id)?.name);
    if (new Set(names).size !== names.length || names.includes(legend.name)) out.push({ code: 'extraLegends', message: 'extra legends must have different names (and differ from your legend)' });
    for (const id of deck.extraLegends) if (get(id)?.type !== 'Legend') out.push({ code: 'extraLegends', message: `${id} is not a legend` });
  }
  if (signatures > 3) out.push({ code: 'signature.count', message: `${signatures} Signature cards (max 3)` });
  // 103.3 runes
  if (deck.runes.length !== 12) out.push({ code: 'runes.size', message: `rune deck has ${deck.runes.length} runes (exactly 12)` });
  for (const id of deck.runes) {
    const c = get(id);
    if (!c || c.type !== 'Rune') out.push({ code: 'runes.type', message: `${c?.name ?? id} is not a rune` });
    else if (!fitsIdentity(c, identity)) out.push({ code: 'identity', message: `${c.name} is outside the domain identity` });
  }
  // 103.4 battlefields
  const nb = opts.battlefields ?? 3;
  if (deck.battlefields.length !== nb) out.push({ code: 'battlefields.size', message: `${deck.battlefields.length} battlefields (need ${nb})` });
  const bfNames = new Set<string>();
  for (const id of deck.battlefields) {
    const c = get(id);
    if (!c || c.type !== 'Battlefield') { out.push({ code: 'battlefields.type', message: `${c?.name ?? id} is not a battlefield` }); continue; }
    if (bfNames.has(c.name)) out.push({ code: 'battlefields.duplicate', message: `duplicate battlefield ${c.name}` });
    bfNames.add(c.name);
  }
  return out;
}

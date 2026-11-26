// Card database loading + card rendering: card image when an atlas has one (see art.ts), else a text frame.
import type { CardDef, CardId, Domain, GameObject } from '../engine/types';
import { h, esc } from './dom';
import { art, cardImg } from './art';

export type CardRec = CardDef & { reminderText?: string; printings?: string[] };
export interface CardDb {
  byId: Record<CardId, CardRec>;
  printings: Record<string, CardId>;     // any printed code (lowercased) -> canonical id
  byName: Map<string, CardRec[]>;        // lowercased name / "name, subtitle" -> cards
  list: CardRec[];
}

export const DOMAIN_COLORS: Record<Domain, string> = {
  Fury: '#d8343f', Calm: '#2f9e5b', Mind: '#2f74d0', Body: '#e07b1f', Chaos: '#8a45c7', Order: '#d4a915', Colorless: '#8b8f98',
};
const PIP_LETTER: Record<string, Domain | 'Any' | 'Class'> = {
  R: 'Fury', G: 'Calm', B: 'Mind', O: 'Body', P: 'Chaos', Y: 'Order', A: 'Any', C: 'Class',
};

export function buildDb(raw: unknown): CardDb {
  let list: CardRec[] = [];
  if (Array.isArray(raw)) list = raw.map(normaliseRaw).filter(Boolean) as CardRec[];
  else if (raw && typeof raw === 'object') list = Object.values(raw as Record<string, CardRec>).filter(c => c && typeof c === 'object' && 'id' in c);
  const byId: Record<CardId, CardRec> = {};
  const printings: Record<string, CardId> = {};
  const byName = new Map<string, CardRec[]>();
  for (const c of list) {
    byId[c.id] = c;
    printings[c.id.toLowerCase()] = c.id;
    for (const p of c.printings ?? []) printings[p.toLowerCase()] = c.id;
    const keys = [c.name.toLowerCase()];
    if (c.subtitle) keys.push(`${c.name}, ${c.subtitle}`.toLowerCase(), `${c.name} - ${c.subtitle}`.toLowerCase(), `${c.name} ${c.subtitle}`.toLowerCase());
    for (const k of keys) { const a = byName.get(k) ?? []; a.push(c); byName.set(k, a); }
  }
  list.sort((a, b) => a.name.localeCompare(b.name));
  return { byId, printings, byName, list };
}

// Accepts the upstream raw scrape format as a fallback.
function normaliseRaw(r: Record<string, unknown>): CardRec | null {
  if (!r || typeof r !== 'object') return null;
  if ('id' in r && 'type' in r) return r as unknown as CardRec;
  if (!('cardCode' in r)) return null;
  const labels = (r.cardTypeLabels as string[] | undefined) ?? [String(r.cardType)];
  const text = String(r.abilityEffective ?? r.abilityOriginal ?? '');
  return {
    id: String(r.cardCode), name: String(r.name), subtitle: (r.subtitle as string) ?? undefined, type: r.cardType as CardDef['type'],
    supertypes: labels.filter(l => l !== r.cardType), tags: (r.tags as string[]) ?? [], domains: (r.domains as Domain[]) ?? [],
    energy: r.energy as number | null, power: r.power as number | null, might: r.might as number | null,
    keywords: [...new Set([...text.matchAll(/\[([A-Za-z][A-Za-z' -]*(?: \d+)?)\]/g)].map(m => m[1]))].filter(k => k.length > 1 && k !== 'Add'),
    text: text.replace(/\s*\([^()]*\)/g, ''), reminderText: text, set: String(r.setCode), rarity: String(r.rarity), printings: [String(r.cardCode)],
  };
}

export async function loadCardDb(): Promise<CardDb> {
  const embedded = (globalThis as { RIFTFORGE_CARDS?: unknown }).RIFTFORGE_CARDS;
  if (embedded) return buildDb(embedded);
  for (const url of ['cards.json', './cards.json']) {
    try {
      const r = await fetch(url);
      if (r.ok) return buildDb(await r.json());
    } catch { /* try next */ }
  }
  return buildDb({});
}

export const mainDomain = (c: CardDef | undefined): Domain => (c?.domains.find(d => d !== 'Colorless') ?? 'Colorless');

// ---- Rules text with icons ----
const KEYWORD_RE = /^[A-Z][A-Za-z' -]*(?: \d+)?$/;
export function keywordReminder(card: CardRec | undefined, kw: string): string {
  const rt = card?.reminderText ?? '';
  const base = kw.replace(/ \d+$/, '');
  const m = new RegExp('\\[' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?: \\d+)?\\]\\s*\\(([^()]*)\\)').exec(rt);
  return m ? m[1] : KEYWORD_HELP[base] ?? '';
}
const KEYWORD_HELP: Record<string, string> = {
  Accelerate: 'You may pay extra to have this enter ready.', Assault: 'While attacking, +N Might.', Shield: 'While defending, +N Might.',
  Tank: 'Must be assigned combat damage first.', Deflect: 'Spells and abilities that choose this cost more.', Ganking: 'Can move from battlefield to battlefield.',
  Hidden: 'Can be hidden facedown at a battlefield you control.', Deathknell: 'Triggers when this dies.', Legion: 'Bonus if you played another card this turn.',
  Vision: 'When played, look at the top card of your Main Deck.', Reaction: 'Can be played any time, even during the chain.', Action: 'Can be played during showdowns.',
  Temporary: 'Kill this at the start of its controller\'s Beginning Phase.', Ambush: 'May be played as a Reaction to a battlefield where you have units.',
  Stun: 'A stunned unit doesn\'t deal combat damage this turn.', Buff: 'Put a +1 Might buff on a unit (max one).', Unique: 'Only one copy in a deck.',
};

export function rulesHtml(text: string, card?: CardRec): string {
  const parts = esc(text).split(/(\[[^\]]+\])/g);
  return parts.map(p => {
    const m = /^\[([^\]]+)\]$/.exec(p);
    if (!m) return p.replace(/\n/g, '<br>');
    const t = m[1];
    if (t === 'S' || t === 'M') return '<i class="ico ico-might" title="Might" aria-label="Might"></i>';
    if (t === 'T') return '<i class="ico ico-exhaust" title="Exhaust" aria-label="Exhaust"></i>';
    if (t === '&gt;') return '<i class="ico ico-sep" aria-hidden="true">▸</i>';
    if (t === '&gt;&gt;') return '<i class="ico ico-sep" aria-hidden="true">▸▸</i>';
    if (t === 'Add') return '<b class="kw-add">Add</b>';
    if (/^\d+$/.test(t)) return `<i class="ico ico-energy" title="${t} Energy">${t}</i>`;
    if (PIP_LETTER[t]) {
      const d = PIP_LETTER[t];
      return `<i class="ico ico-pip pip-${d}" title="${d === 'Any' ? 'Any Power' : d === 'Class' ? 'Power of your domains' : d + ' Power'}"></i>`;
    }
    if (KEYWORD_RE.test(t) || /^[A-Z]/.test(t)) {
      const rem = keywordReminder(card, t);
      return `<b class="kw" tabindex="0"${rem ? ` title="${esc(rem)}" data-tip="${esc(rem)}"` : ''}>${t}</b>`;
    }
    return p;
  }).join('');
}

export function costPips(card: CardDef): HTMLElement | null {
  if (card.energy == null && !card.power) return null;
  const dom = card.domains.filter(d => d !== 'Colorless');
  const pips: HTMLElement[] = [];
  for (let i = 0; i < (card.power ?? 0); i++) pips.push(h('i', { class: 'pip', style: { background: DOMAIN_COLORS[dom[i % Math.max(1, dom.length)] ?? 'Colorless'] } }));
  return h('div', { class: 'c-cost' },
    card.energy != null ? h('span', { class: 'c-energy', title: `${card.energy} Energy` }, String(card.energy)) : null,
    pips.length ? h('span', { class: 'c-pips', title: `${card.power} ${dom.join('/') || ''} Power` }, pips) : null);
}

export interface CardRenderOpts {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  obj?: GameObject;
  might?: number | null;      // derived might (incl. modifiers)
  keywords?: string[];        // derived keywords
  classes?: string[];
  showText?: boolean;
  /** Printed code the owner imported for this card (alt art); default: the canonical id's image. */
  printed?: string | null;
  /** false = text frame only. */
  image?: boolean;
  /** Load now (visible board/hand) instead of lazily (galleries, lists). */
  eager?: boolean;
}

export function objMight(o: GameObject | undefined, c: CardDef | undefined): number | null {
  if (!c || c.might == null) return null;
  if (o?.derived && 'might' in o.derived) return o.derived.might;
  const derived = (o as unknown as { might?: number; stats?: { might?: number } } | undefined);
  if (typeof derived?.might === 'number') return derived.might;
  if (typeof derived?.stats?.might === 'number') return derived.stats.might;
  return c.might + (o?.modifiers ?? []).reduce((a, m) => a + (m.might ?? 0), 0) + (o?.counters?.buff ?? 0);
}
export function objKeywords(o: GameObject | undefined, c: CardDef | undefined): string[] {
  if (Array.isArray(o?.derived?.keywords)) return o!.derived!.keywords;
  const d = (o as unknown as { keywords?: string[]; stats?: { keywords?: string[] } } | undefined);
  if (Array.isArray(d?.keywords)) return d!.keywords!;
  if (Array.isArray(d?.stats?.keywords)) return d!.stats!.keywords!;
  const k = new Set(intrinsicKeywords(c));
  for (const m of o?.modifiers ?? []) { m.addKeywords?.forEach(x => k.add(x)); m.removeKeywords?.forEach(x => k.delete(x)); }
  return [...k];
}

const SYMBOL = /^(S|C|A|T|M|E|R|B|Y|G|O|P|Add|>|>>|\d+)$/;
const intrinsicCache = new WeakMap<object, string[]>();
/** Keywords the card itself has (leading [Keyword] tokens of a line), not ones its text grants to others. */
export function intrinsicKeywords(c: CardDef | undefined): string[] {
  if (!c) return [];
  const hit = intrinsicCache.get(c); if (hit) return hit;
  const out: string[] = [];
  for (const line of c.text.split('\n')) {
    const m = /^(\s*\[[^\]]+\])+/.exec(line); if (!m) continue;
    for (const t of m[0].matchAll(/\[([^\]]+)\]/g)) { if (SYMBOL.test(t[1])) break; if (/^[A-Z]/.test(t[1]) && !out.includes(t[1])) out.push(t[1]); }
  }
  intrinsicCache.set(c, out);
  return out;
}

const TYPE_GLYPH: Record<string, string> = { Unit: '⚔', Spell: '✦', Gear: '⚙', Rune: '◆', Battlefield: '⛰', Legend: '♛', Token: '●' };

export function renderCard(card: CardRec | undefined, opts: CardRenderOpts = {}): HTMLElement {
  const size = opts.size ?? 'sm';
  if (!card) return h('div', { class: ['card', 'card-back', `size-${size}`, ...(opts.classes ?? [])], dataset: { obj: opts.obj?.id } }, h('div', { class: 'back-mark' }, 'R'));
  const dom = card.domains.filter(d => d !== 'Colorless');
  const c1 = DOMAIN_COLORS[dom[0] ?? 'Colorless'], c2 = DOMAIN_COLORS[dom[1] ?? dom[0] ?? 'Colorless'];
  const o = opts.obj;
  const might = opts.might !== undefined ? opts.might : objMight(o, card);
  const kws = opts.keywords ?? objKeywords(o, card);
  const showText = opts.showText ?? (size === 'md' || size === 'lg');
  const typeLine = [card.type === 'Token' ? 'Token' : card.type, ...card.supertypes.filter(s => s !== 'Basic'), ...card.tags.slice(0, 3)].join(' · ');
  const isBf = card.type === 'Battlefield';
  const img = opts.image === false ? null : cardImg(card, { printed: opts.printed, eager: opts.eager, landscape: isBf });
  const el = h('div', {
    class: ['card', `size-${size}`, `type-${card.type}`, isBf && 'landscape', img?.dataset.code ? 'has-img' : false, img?.dataset.code && art.loaded.has(img.dataset.code) ? 'img-ok' : false, o?.exhausted && 'exhausted', ...(opts.classes ?? [])],
    style: { '--c1': c1, '--c2': c2 },
    dataset: { obj: o?.id, card: card.id },
    'aria-label': `${card.name}${card.subtitle ? ', ' + card.subtitle : ''}. ${card.type}. ${card.energy != null ? 'Cost ' + card.energy + '. ' : ''}${might != null ? 'Might ' + might + '. ' : ''}${card.text}`,
  },
    h('div', { class: 'c-frame' },
      h('div', { class: 'c-head' },
        costPips(card),
        h('div', { class: 'c-title' },
          h('div', { class: 'c-name' }, card.name),
          card.subtitle && size !== 'xs' ? h('div', { class: 'c-sub' }, card.subtitle) : null),
      ),
      h('div', { class: 'c-art' }, h('span', { class: 'c-glyph' }, TYPE_GLYPH[card.type] ?? '◆'),
        size !== 'xs' ? h('span', { class: 'c-doms' }, dom.map(d => h('i', { class: 'dom-dot', title: d, style: { background: DOMAIN_COLORS[d] } }))) : null),
      size !== 'xs' ? h('div', { class: 'c-type' }, typeLine) : null,
      kws.length && size !== 'xs' && !showText ? h('div', { class: 'c-kws' }, kws.slice(0, 3).map(k => h('span', { class: 'kw-chip', title: keywordReminder(card, k) }, k))) : null,
      showText ? h('div', { class: 'c-text', html: rulesHtml(card.text || '', card) }) : null,
      showText && card.type !== 'Rune' ? h('div', { class: 'c-foot' }, `${card.set.toUpperCase()} · ${card.rarity}`) : null,
    ),
    img,
    might != null && (!img || (o && o.zone !== 'hand') || might !== card.might) ? h('div', { class: ['c-might', card.might != null && might > card.might && 'up', card.might != null && might < card.might && 'down'], title: 'Might' }, String(might)) : null,
    o && o.damage > 0 ? h('div', { class: 'c-dmg', title: `${o.damage} damage` }, String(o.damage)) : null,
    o && o.counters && Object.entries(o.counters).filter(([, v]) => v).length
      ? h('div', { class: 'c-counters' }, Object.entries(o.counters).filter(([, v]) => v).map(([k, v]) => h('span', { title: k }, `${k} ${v}`))) : null,
    o?.faceDown ? h('div', { class: 'c-facedown', title: 'Hidden (facedown)' }, 'Hidden') : null,
    o ? statusBadges(o) : null,
  );
  return el;
}

function statusBadges(o: GameObject): HTMLElement | null {
  const b: [string, string, string][] = [];
  if (o.stunned) b.push(['Stunned', 'st', 'Stunned: deals no combat damage this turn']);
  if (o.combatRole === 'attacker') b.push(['ATK', 'atk', 'Attacking']);
  if (o.combatRole === 'defender') b.push(['DEF', 'def', 'Defending']);
  if (o.empowered) b.push([o.empowered > 1 ? `Emp ×${o.empowered}` : 'Emp', 'emp', 'Empowered']);
  if (o.attachedTo) b.push(['Equip', 'eq', 'Attached to a unit']);
  if (!b.length) return null;
  return h('div', { class: 'c-badges' }, b.map(([t, c, title]) => h('span', { class: 'cb-' + c, title }, t)));
}

export function cardBack(id?: string, size: CardRenderOpts['size'] = 'sm', extra: string[] = []): HTMLElement {
  return h('div', { class: ['card', 'card-back', `size-${size}`, ...extra], dataset: { obj: id }, 'aria-label': 'Facedown card' }, h('div', { class: 'back-mark' }, h('span', null, 'RF')));
}

/** One-line type description, e.g. "Unit · Champion · Yordle". */
export function typeLine(card: CardRec): string {
  return [card.type, ...card.supertypes.filter(s => s !== 'Basic'), ...card.tags.slice(0, 3)].join(' · ');
}

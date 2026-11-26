// Keyword parsing (for vanilla / unscripted cards) and keyword cost parsing.
import type { CardDef, Domain } from './types.ts';
import type { CostSpec, PowerSym } from './abilities.ts';

export const SYMBOL_DOMAIN: Record<string, Domain> = {
  R: 'Fury', G: 'Calm', B: 'Mind', O: 'Body', P: 'Chaos', Y: 'Order',
};

/** Keywords the engine implements directly (CR 805-829 + Radiance). */
export const ENGINE_KEYWORDS = [
  'Accelerate', 'Action', 'Reaction', 'Assault', 'Shield', 'Deflect', 'Ganking', 'Hidden', 'Tank',
  'Backline', 'Temporary', 'Vision', 'Ambush', 'Deathknell', 'Hunt', 'Unique', 'Quick-Draw',
  'Weaponmaster', 'Equip', 'Empower', 'Repeat', 'Flow', 'Deploy', 'Disarm', 'Legion', 'Level',
  'Empowered', 'Show Off',
] as const;

/** Keywords whose numeric values add up across instances (CR 807, 809, 814, 823, Disarm). */
export const SUMMING = new Set(['Assault', 'Shield', 'Deflect', 'Hunt', 'Disarm', 'Vision']);   // Vision: value = number of instances (each triggers, CR 817)

const NUMERIC_DEFAULT_1 = new Set(['Assault', 'Shield', 'Deflect', 'Hunt', 'Disarm', 'Vision']);

/** Split "Assault 2" into ["Assault", 2]. Keywords without a value get 1 for numeric ones. */
export function splitKeyword(kw: string): [string, number] {
  const m = /^(.*?)\s+(\d+)$/.exec(kw.trim());
  if (m) return [m[1], Number(m[2])];
  return [kw.trim(), NUMERIC_DEFAULT_1.has(kw.trim()) ? 1 : 1];
}

const TOKEN_RE = /\[([^\]]+)\]/g;
const NON_KEYWORD_TOKENS = new Set(['S', 'M', 'C', 'A', 'T', 'E', 'R', 'B', 'Y', 'G', 'O', 'P', 'Add', 'ADD', '>', 'OLD TEXT']);

/**
 * Intrinsic keywords from printed text: a line made only of [Keyword] tokens (e.g. "[Tank]",
 * "[Accelerate]", "[Assault 2] [Deflect]") grants those keywords. Keyword+cost lines
 * ("[Equip] [1][C]", "[Repeat] [2]", "[Flow] [3][C]", "[Empower] [2][C]") also grant the keyword.
 */
export function parseKeywords(def: CardDef): string[] {
  const out: string[] = [];
  for (const raw of (def.text ?? '').split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('[')) continue;
    const stripped = line.replace(TOKEN_RE, '').replace(/[\s,.;]/g, '');
    const toks = [...line.matchAll(TOKEN_RE)].map(m => m[1]);
    if (stripped === '' && toks.every(t => !NON_KEYWORD_TOKENS.has(t) && !/^\d+$/.test(t))) {
      out.push(...toks);
      continue;
    }
    const first = toks[0];
    if (first && /^(Equip|Repeat|Flow|Empower)$/.test(first) && parseKeywordCost(line) !== null) out.push(first);
  }
  return out;
}

/** Parse a cost string made of tokens like "[1][C]", "[2]", "[A][A]", "[T]". Returns null if other text present. */
export function parseCost(s: string): CostSpec | null {
  const cost: CostSpec = { energy: 0, power: [] };
  const rest = s.replace(TOKEN_RE, (_m, t: string) => {
    if (/^\d+$/.test(t)) cost.energy! += Number(t);
    else if (t === 'A' || t === 'C') cost.power!.push(t as PowerSym);
    else if (SYMBOL_DOMAIN[t]) cost.power!.push(SYMBOL_DOMAIN[t]);
    else if (t === 'T' || t === 'E') cost.exhaustSelf = true;
    else return '\u0000';
    return '';
  });
  if (rest.includes('\u0000') || rest.replace(/[\s,—-]/g, '') !== '') return null;
  return cost;
}

/** For lines like "[Equip] [1][C]" returns the cost; null if the cost isn't purely resources. */
export function parseKeywordCost(line: string): CostSpec | null {
  const m = /^\[(Equip|Repeat|Flow|Empower)\]\s*(?:—\s*)?(.*)$/.exec(line.trim());
  if (!m) return null;
  return parseCost(m[2]);
}

/** Find the cost attached to a keyword in a card's text (e.g. Equip cost). */
export function keywordCostFromText(def: CardDef, kw: 'Equip' | 'Repeat' | 'Flow' | 'Empower'): CostSpec | null {
  for (const raw of (def.text ?? '').split('\n')) {
    const line = raw.trim();
    if (line.startsWith(`[${kw}]`)) return parseKeywordCost(line);
  }
  return null;
}

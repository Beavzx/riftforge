// Shared helpers for the r11701 Rift Judge verification tests (ids 11701-13100).
import assert from 'node:assert/strict';
import { act, chainLabels, getLegalActions, type GameState, type ObjId, type PlayerId } from '../conformance/harness.ts';

/** Option id whose label matches re (in the pending decision). */
export function opt(g: GameState, re: RegExp): string {
  const o = g.pending?.options?.find(x => re.test(x.label));
  assert.ok(o, `no option matching ${re} in ${g.pending?.kind}: ${JSON.stringify(g.pending?.options?.map(x => x.label))}`);
  return o!.id;
}

/**
 * Drive the game: answer in-step decisions from the queue (strings are option ids, RegExps match labels,
 * 'first' takes the first option), pass chain/showdown priority, auto-assign combat damage with the
 * engine's suggestion. Stops at a main-phase decision, or an in-step decision with no answer left,
 * or when `until` returns true.
 */
export type Ans = string | RegExp | 'first' | string[];
export function drive(g: GameState, answers: Ans[] = [], until?: (g: GameState) => boolean, limit = 200): GameState {
  const q = [...answers];
  for (let i = 0; i < limit; i++) {
    const d = g.pending;
    if (!d) return g;
    if (until && until(g)) return g;
    if (d.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: d.player, assignment: (d.data as { suggested: Record<ObjId, number> }).suggested }); continue; }
    if (d.inStep) {
      if (!q.length) return g;
      const a = q.shift()!;
      const ids = Array.isArray(a) ? a : a === 'first' ? [d.options![0].id] : a instanceof RegExp ? [opt(g, a)] : [a];
      g = act(g, { type: 'choose', player: d.player, optionIds: ids });
      continue;
    }
    if (d.kind === 'mainAction') return g;
    g = act(g, { type: 'pass', player: d.player });
  }
  throw new Error('drive: too many steps');
}

/** Answer in-step decisions only (never pass). */
export function ans(g: GameState, ...answers: Ans[]): GameState {
  for (const a of answers) {
    const d = g.pending;
    assert.ok(d && d.inStep, `expected in-step decision for ${String(a)}, got ${d?.kind}`);
    const ids = Array.isArray(a) ? a : a === 'first' ? [d.options![0].id] : a instanceof RegExp ? [opt(g, a)] : [a];
    g = act(g, { type: 'choose', player: d.player, optionIds: ids });
  }
  return g;
}

export const names = (g: GameState) => chainLabels(g);
export const canAct = (g: GameState, p: PlayerId, type: string, obj?: ObjId) =>
  getLegalActions(g, p).some(a => a.type === type && (obj === undefined || (a as { obj?: ObjId }).obj === obj));
export const nameOf = (g: GameState, id: ObjId) => g.cards[g.objects[id]?.cardId]?.name;

import { readFileSync } from 'node:fs';
import type { CardDef } from '../conformance/harness.ts';
let TOKENS: Record<string, CardDef> | null = null;
/** S0 games only carry fixture cards; add every real token card (Sprite, Bird, Reflection, Recruit...) to the pool. */
export function withTokens(g: GameState): GameState {
  if (!TOKENS) {
    const raw = JSON.parse(readFileSync(new URL('../../data/cards.json', import.meta.url), 'utf8'));
    const all = (Array.isArray(raw) ? raw : Object.values(raw)) as CardDef[];
    TOKENS = Object.fromEntries(all.filter(c => c.supertypes?.includes('Token')).map(c => [c.id, c]));
  }
  g.cards = { ...TOKENS, ...g.cards };
  g.timestamp++;
  return g;
}
export const unitsNamed = (g: GameState, name: string) => Object.keys(g.objects).filter(id => g.cards[g.objects[id].cardId]?.name === name && ['base', 'battlefield'].includes(g.objects[id].zone));

import { cid, realCard } from '../conformance/harness.ts';
/** Make p's legend a real legend card (by name/id). */
export function setLegend(g: GameState, p: PlayerId, nameOrId: string): ObjId {
  const id = cid(nameOrId);
  if (!g.cards[id]) g.cards = { ...g.cards, [id]: realCard(id) };
  const o = g.players[p].legend;
  g.objects[o].cardId = id;
  g.ex.dirty = true; g.timestamp++;
  return o;
}

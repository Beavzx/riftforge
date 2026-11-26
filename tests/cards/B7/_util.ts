// Shared fixtures for the B7 card tests (not a test file itself).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../../../src/cards/tokens.ts';
import '../../../src/cards/scripts/batch-B7.ts';
import { newGame, act, put, runes, handCard, resolveAll, zoneOf, setController, type TestGameOpts } from '../../fixtures/helpers.ts';
import { baseDb } from '../../fixtures/cards.ts';
import type { CardDef, GameState, ObjId, PlayerId, Decision } from '../../../src/engine/types.ts';
import { might, hasKw } from '../../../src/engine/chars.ts';

const real: Record<string, CardDef> = JSON.parse(readFileSync(new URL('../../../data/cards.json', import.meta.url), 'utf8'));
export const db = { ...baseDb(), ...real };

export const RUNE = { Fury: 'rad-r01', Calm: 'rad-r02', Mind: 'rad-r03', Body: 'rad-r04', Chaos: 'rad-r05', Order: 'rad-r06' } as const;
export type Dom = keyof typeof RUNE;

/** A game at player 0's main phase with all real cards available. Player 0 has no runes unless given. */
export function game(o: TestGameOpts = {}): GameState {
  const g = newGame({ db, ...o });
  for (const p of g.players) { for (const r of p.runesInPlay) delete g.objects[r]; p.runesInPlay = []; }
  return g;
}

/** Give player p n ready runes of a domain (each can pay [1] by exhausting and [C] by recycling). */
export function mana(g: GameState, p: PlayerId, n: number, dom: Dom = 'Fury'): ObjId[] { return runes(g, p, n, RUNE[dom]); }

/** Put cards on top of p's Main Deck; the first listed ends up on top. */
export function stack(g: GameState, p: PlayerId, ...cardIds: string[]): ObjId[] {
  const ids: ObjId[] = [];
  for (let i = cardIds.length - 1; i >= 0; i--) ids.unshift(put(g, p, cardIds[i], 'deckTop'));
  return ids;
}

export const cid = (g: GameState, id: ObjId) => g.objects[id]?.cardId;
export const hand = (g: GameState, p: PlayerId) => g.players[p].hand.map(id => g.objects[id].cardId);
export const handIds = (g: GameState, p: PlayerId) => [...g.players[p].hand];
export const trash = (g: GameState, p: PlayerId) => g.players[p].trash.map(id => g.objects[id].cardId);
export const deckTop = (g: GameState, p: PlayerId, n = 1) => g.players[p].mainDeck.slice(0, n).map(id => g.objects[id].cardId);
export const deckBottom = (g: GameState, p: PlayerId, n = 1) => g.players[p].mainDeck.slice(-n).map(id => g.objects[id].cardId);

/** Option ids of the pending decision whose object has this card id (or whose label matches). */
export function opt(cardIdOrLabel: string, n = 1) {
  return (g: GameState): string[] => {
    const d = g.pending!;
    const hits = (d.options ?? []).filter(o => (o.objIds?.[0] && g.objects[o.objIds[0]]?.cardId === cardIdOrLabel) || o.label === cardIdOrLabel || o.id === cardIdOrLabel);
    if (hits.length < n) throw new Error(`no option ${cardIdOrLabel} in ${d.kind} "${d.prompt}": ${(d.options ?? []).map(o => o.label).join(', ')}`);
    return hits.slice(0, n).map(o => o.id);
  };
}
export const none = (_g: GameState): string[] => [];
export const objOpt = (id: ObjId) => (g: GameState): string[] => {
  const o = (g.pending!.options ?? []).find(x => x.id === id || x.objIds?.[0] === id);
  if (!o) throw new Error(`object ${id} not offered in "${g.pending!.prompt}"`);
  return [o.id];
};

export type Ans = string | string[] | ((g: GameState) => string[]);

/** Pass priority / answer in-step decisions in order. After the last answer, resolve the chain. */
export function drive(g: GameState, ...answers: Ans[]): GameState {
  g = resolveAll(g);
  for (const a of answers) {
    const d = g.pending;
    if (!d?.inStep) throw new Error(`expected an in-step decision for ${typeof a === 'function' ? 'fn' : JSON.stringify(a)}, got ${d?.kind}`);
    const ids = typeof a === 'function' ? a(g) : Array.isArray(a) ? a : [a];
    g = act(g, { type: 'choose', player: d.player, optionIds: ids });
    g = resolveAll(g);
  }
  return g;
}

/** Play a card from p's hand (created there), then drive the decisions. */
export function play(g: GameState, p: PlayerId, cardId: string, o: { dest?: number | 'base'; obj?: ObjId } = {}, ...answers: Ans[]): { g: GameState; id: ObjId } {
  const id = o.obj ?? handCard(g, p, cardId);
  g = act(g, { type: 'playCard', player: p, obj: id, destination: o.dest });
  return { g: drive(g, ...answers), id };
}

export function pendingIs(g: GameState, kind: Decision['kind'], player?: PlayerId): void {
  assert.ok(g.pending, 'expected a pending decision');
  assert.equal(g.pending!.kind, kind, `pending ${g.pending!.kind}: ${g.pending!.prompt}`);
  if (player !== undefined) assert.equal(g.pending!.player, player);
}
export function noInStep(g: GameState): void {
  assert.ok(!g.pending?.inStep, `unexpected in-step decision ${g.pending?.kind}: ${g.pending?.prompt}`);
}

/** Pass the turn to the other player (end turn, run start-of-turn) */
export function endTurn(g: GameState, ...answers: Ans[]): GameState {
  g = resolveAll(g);
  g = act(g, { type: 'endTurn', player: g.pending!.player });
  return drive(g, ...answers);
}

export { put, runes, handCard, resolveAll, zoneOf, setController, act, might, hasKw, assert };
export type { GameState, ObjId, PlayerId };

// Shared helpers for batch B4 card tests.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../../../src/cards/tokens.ts';
import '../../../src/cards/scripts/batch-B4.ts';
import { newGame, act, choose, pass, put, runes, handCard, resolveAll, zoneOf, setController, getLegalActions } from '../../fixtures/helpers.ts';
import { baseDb } from '../../fixtures/cards.ts';
import { scriptedDefs } from '../../fixtures/scripts.ts';
import { chars } from '../../../src/engine/chars.ts';
import { newObject } from '../../../src/engine/state.ts';
import type { Action, CardDef, GameState, ObjId, PlayerId } from '../../../src/engine/types.ts';

export const real: Record<string, CardDef> = JSON.parse(readFileSync(new URL('../../../data/cards.json', import.meta.url), 'utf8'));
export const db: Record<string, CardDef> = { ...baseDb(), ...scriptedDefs(), ...real };
export const game = (o: { seed?: number } = {}): GameState => newGame({ db, seed: o.seed });

export { assert, act, choose, pass, put, runes, handCard, resolveAll, zoneOf, setController, getLegalActions };
export type { GameState, ObjId, PlayerId, Action };

export const mightOf = (g: GameState, id: ObjId) => chars(g, id).might;
export const hasKw = (g: GameState, id: ObjId, kw: string) => chars(g, id).keywords.has(kw);
export const kwVal = (g: GameState, id: ObjId, kw: string) => chars(g, id).keywords.get(kw) ?? 0;
export const tagsOf = (g: GameState, id: ObjId) => chars(g, id).tags;
export function loc(g: GameState, id: ObjId): 'base' | number | null {
  const o = g.objects[id];
  if (!o) return null;
  if (o.zone === 'base') return 'base';
  if (o.zone === 'battlefield' || o.zone === 'facedown') return o.battlefieldIndex ?? null;
  return null;
}
export const pend = (g: GameState) => { assert.ok(g.pending, 'expected a pending decision'); return g.pending!; };
export const optIds = (g: GameState) => (pend(g).options ?? []).map(o => o.id);
export const handSize = (g: GameState, p: PlayerId) => g.players[p].hand.length;

/** Play a card from hand (optionally to a destination), answering nothing else. */
export function play(g: GameState, p: PlayerId, obj: ObjId, destination?: number | 'base'): GameState {
  return act(g, { type: 'playCard', player: p, obj, destination });
}
export function activate(g: GameState, p: PlayerId, obj: ObjId, abilityIndex = 0): GameState {
  return act(g, { type: 'activate', player: p, obj, abilityIndex });
}
export function move(g: GameState, p: PlayerId, units: ObjId[], to: number | 'base'): GameState {
  return act(g, { type: 'move', player: p, units, to });
}
export const yes = (g: GameState) => choose(g, 'yes');
export const no = (g: GameState) => choose(g, 'no');

/** Answer the pending decision with `ids` if it's of `kind` (asserts the kind). */
export function answer(g: GameState, kind: string, ...ids: string[]): GameState {
  assert.equal(pend(g).kind, kind, `expected ${kind}, got ${pend(g).kind}: ${pend(g).prompt}`);
  return choose(g, ...ids);
}

/**
 * Pass everything (chain / showdown) and answer in-step decisions with the first legal answer, until
 * `p`'s main action is pending (or nothing is pending).
 */
export function settle(g: GameState, p: PlayerId = 0, limit = 80): GameState {
  for (let i = 0; i < limit; i++) {
    const d = g.pending;
    if (!d) return g;
    if (d.kind === 'mainAction' && d.player === p) return g;
    if (d.inStep) { const l = getLegalActions(g, d.player); assert.ok(l.length, `no legal answer for ${d.kind}`); g = act(g, l[0]); continue; }
    g = pass(g);
  }
  return g;
}

/** Pass chain/showdown priority until an in-step decision or main action is pending. */
export function passAll(g: GameState, limit = 60): GameState {
  for (let i = 0; i < limit; i++) {
    const d = g.pending;
    if (!d || d.inStep || d.kind === 'mainAction') return g;
    g = pass(g);
  }
  return g;
}

/** Replace battlefield i with a battlefield card (test setup; mutates). */
export function setBattlefield(g: GameState, i: number, cardId: string, owner: PlayerId = 0): ObjId {
  const o = newObject(g, cardId, owner, 'battlefield');
  o.battlefieldIndex = i;
  const old = g.battlefields[i].objId;
  delete g.objects[old];
  g.battlefields[i].objId = o.id;
  return o.id;
}

/** Exhaust all of a player's runes (so they can't pay). */
export function drainRunes(g: GameState, p: PlayerId): void { for (const r of g.players[p].runesInPlay) g.objects[r].exhausted = true; }

/** Remove every unit/gear on the board (clean slate for a test). */
export function clearBoard(g: GameState): void {
  for (const id of Object.keys(g.objects)) {
    const o = g.objects[id];
    if ((o.zone === 'base' || o.zone === 'battlefield') && !g.battlefields.some(b => b.objId === id)) {
      delete g.objects[id];
      for (const p of g.players) p.base = p.base.filter(x => x !== id);
    }
  }
}

/** Give a player n ready runes of a domain (real runes for domain power). */
export const RUNE: Record<string, string> = {};
export function domainRunes(g: GameState, p: PlayerId, n: number, domain: 'Fury' | 'Calm' | 'Mind' | 'Body' | 'Chaos' | 'Order'): ObjId[] {
  const id = Object.values(g.cards).find(c => c.type === 'Rune' && c.domains.includes(domain) && c.supertypes.includes('Basic'))?.id
    ?? Object.values(g.cards).find(c => c.type === 'Rune' && c.domains.includes(domain))!.id;
  return runes(g, p, n, id);
}

/** Make it player p's main phase on a fresh turn: end turns until p is active (settling everything). */
export function toTurnOf(g: GameState, p: PlayerId): GameState {
  for (let i = 0; i < 4 && !(g.activePlayer === p && g.pending?.kind === 'mainAction'); i++) {
    g = act(g, { type: 'endTurn', player: g.activePlayer });
    g = settle(g, p);
  }
  return g;
}

/**
 * Start a combat: P0 standard-moves `atk` (in P0's base) to battlefield `bf`, where P1's units are.
 * Returns the state after the move (attack/defend triggers may be pending).
 */
export function attack(g: GameState, atk: ObjId[], bf = 0): GameState {
  return move(g, 0, atk, bf);
}

export const log = (g: GameState) => g.log.map(l => l.text);

/**
 * Combat setup: P1 controls battlefield 0 with `def` units there; P0 has `atk` units ready in base.
 * Returns ids; call attack(g, atk) to start the combat.
 */
export function combatSetup(g: GameState, atk: string[], def: string[], bf = 0): { atk: ObjId[]; def: ObjId[] } {
  const d = def.map(c => put(g, 1, c, bf));
  if (d.length) setController(g, bf, 1);
  const a = atk.map(c => put(g, 0, c, 'base'));
  return { atk: a, def: d };
}

/** End P0's turn and P1's turn; returns at P0's next turn with hold triggers possibly pending (not settled). */
export function toNextTurn(g: GameState, p: PlayerId = 0): GameState {
  const other = (1 - p) as PlayerId;
  g = act(g, { type: 'endTurn', player: p });
  g = settle(g, other);
  return act(g, { type: 'endTurn', player: other });
}

/** Pass only while a chain is waiting for responses (stops at showdown focus / in-step / main). */
export function passChain(g: GameState, limit = 40): GameState {
  for (let i = 0; i < limit; i++) {
    const d = g.pending;
    if (!d || d.kind !== 'chainResponse') return g;
    g = pass(g);
  }
  return g;
}

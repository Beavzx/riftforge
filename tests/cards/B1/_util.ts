// Shared test utilities for batch B1 card tests (not a test file itself).
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import '../../../src/cards/scripts/index.ts';
import { newGame, act, choose, pass, put, handCard, resolveAll, zoneOf, setController, getLegalActions } from '../../fixtures/helpers.ts';
import { baseDb } from '../../fixtures/cards.ts';
import { newObject } from '../../../src/engine/state.ts';
import { might, hasKw, kwVal } from '../../../src/engine/chars.ts';
import type { CardDef, GameState, ObjId, PlayerId, Action } from '../../../src/engine/types.ts';

export { act, choose, pass, put, handCard, resolveAll, zoneOf, setController, getLegalActions, might, hasKw, kwVal, assert };
export type { GameState, ObjId, PlayerId };

const real: Record<string, CardDef> = JSON.parse(readFileSync(new URL('../../../data/cards.json', import.meta.url), 'utf8'));
export const db = { ...baseDb(), ...real };

export const RUNE: Record<string, string> = { Fury: 'rad-r01', Calm: 'rad-r02', Mind: 'rad-r03', Body: 'rad-r04', Chaos: 'rad-r05', Order: 'rad-r06' };

/** A fresh game at P0's main phase with all real cards available; both players' rune pools emptied. */
export function game(): GameState {
  const g = newGame({ db });
  for (const p of [0, 1] as PlayerId[]) setRunes(g, p, {});
  return g;
}

/** Replace a player's runes in play with ready runes of the given domains (mutates). */
export function setRunes(g: GameState, p: PlayerId, spec: Record<string, number>): ObjId[] {
  for (const id of g.players[p].runesInPlay) delete g.objects[id];
  g.players[p].runesInPlay = [];
  const out: ObjId[] = [];
  for (const [dom, n] of Object.entries(spec)) {
    for (let i = 0; i < n; i++) { const o = newObject(g, RUNE[dom], p, 'runePool'); g.players[p].runesInPlay.push(o.id); out.push(o.id); }
  }
  return out;
}

export function readyRunes(g: GameState, p: PlayerId): number {
  return g.players[p].runesInPlay.filter(id => !g.objects[id].exhausted).length;
}

/** Put a card face down at a battlefield, hidden on an earlier turn (so it can be played now). */
export function putFacedown(g: GameState, p: PlayerId, cardId: string, bf: number): ObjId {
  const o = newObject(g, cardId, p, 'facedown');
  o.battlefieldIndex = bf;
  o.hiddenTurn = g.turn - 1;
  o.faceDown = true;
  return o.id;
}

export function legend(g: GameState, p: PlayerId, cardId: string): ObjId {
  const l = g.players[p].legend;
  g.objects[l].cardId = cardId;
  g.objects[l].exhausted = false;
  return l;
}

/** Try an action; returns the new state and whether it was accepted (not rolled back / rejected). */
export function tryAct(g: GameState, a: Action): { g: GameState; ok: boolean } {
  const before = g;
  try {
    const n = act(g, a);
    const rolled = n.ex.lastEvents.some(e => e.type === 'rollback');
    return { g: n, ok: !rolled && n !== before };
  } catch {
    return { g: before, ok: false };
  }
}

export function canPlayNow(g: GameState, p: PlayerId, obj: ObjId): boolean {
  return getLegalActions(g, p).some(a => a.type === 'playCard' && a.obj === obj);
}

export function playAct(g: GameState, p: PlayerId, obj: ObjId, destination?: number | 'base'): GameState {
  return act(g, { type: 'playCard', player: p, obj, ...(destination !== undefined ? { destination } : {}) });
}

/** Activation actions currently legal for this object. */
export function abilities(g: GameState, p: PlayerId, obj: ObjId): number[] {
  return getLegalActions(g, p).filter(a => a.type === 'activate' && a.obj === obj).map(a => (a as Extract<Action, { type: 'activate' }>).abilityIndex);
}

export function activate(g: GameState, p: PlayerId, obj: ObjId, abilityIndex: number): GameState {
  return act(g, { type: 'activate', player: p, obj, abilityIndex });
}

export const EMPOWER = 901;

/** Answer the pending in-step decision (asserting its kind if given). */
export function answer(g: GameState, kind: string | null, ...ids: string[]): GameState {
  assert.ok(g.pending, 'expected a pending decision');
  if (kind) assert.equal(g.pending!.kind, kind, `pending decision is ${g.pending!.kind}: ${g.pending!.prompt}`);
  assert.ok(g.pending!.inStep, `expected an in-step decision, got ${g.pending!.kind}: ${g.pending!.prompt}`);
  return choose(g, ...ids);
}

export function isAsking(g: GameState, kind?: string): boolean {
  return !!g.pending?.inStep && (!kind || g.pending.kind === kind);
}

export function optionIds(g: GameState): string[] { return (g.pending?.options ?? []).map(o => o.id); }

/** End P's turn and pass until the next player's main phase (auto-answering nothing). */
export function nextTurn(g: GameState): GameState {
  const p = g.activePlayer;
  g = act(g, { type: 'endTurn', player: p });
  for (let i = 0; i < 60; i++) {
    const d = g.pending;
    if (!d) break;
    if (d.kind === 'mainAction' && d.player !== p) break;
    if (d.inStep) throw new Error(`nextTurn: unexpected in-step decision ${d.kind}: ${d.prompt}`);
    g = pass(g);
  }
  return g;
}

/** Move units of P to a battlefield (standard move) and pass through the showdown/combat. */
export function attack(g: GameState, p: PlayerId, units: ObjId[], bf: number): GameState {
  g = act(g, { type: 'move', player: p, units, to: bf });
  return resolveCombat(g, p);
}

export function resolveCombat(g: GameState, p: PlayerId): GameState {
  for (let i = 0; i < 40; i++) {
    const d = g.pending;
    if (!d || d.inStep) return g;
    if (d.kind === 'mainAction' && d.player === p) return g;
    g = pass(g);
  }
  return g;
}

export function hand(g: GameState, p: PlayerId): ObjId[] { return g.players[p].hand; }
export function xp(g: GameState, p: PlayerId): number { return g.players[p].xp; }
export function setXp(g: GameState, p: PlayerId, n: number): void { g.players[p].xp = n; }
export function m(g: GameState, id: ObjId): number { return might(g, id) ?? 0; }
export function dirty(g: GameState): void { g.ex.dirty = true; }

/**
 * Resolve the chain, answering only decisions that don't matter for the assertion:
 * trigger ordering (first option) and Predict (keep everything on top, first order).
 */
export function settle(g: GameState, limit = 30): GameState {
  for (let i = 0; i < limit; i++) {
    g = resolveAll(g);
    const d = g.pending;
    if (!d || !d.inStep) return g;
    if (d.kind === 'orderTriggers' || d.kind === 'chooseOrder') { g = choose(g, d.options![0].id); continue; }
    if (d.kind === 'chooseCards' && /^Predict/.test(d.prompt) && (d.min ?? 1) === 0) { g = choose(g); continue; }
    return g;
  }
  return g;
}

/** Pass priority only while the chain is non-empty (stops before showdown passes / combat damage). */
export function resolveChain(g: GameState, limit = 30): GameState {
  for (let i = 0; i < limit && g.chain.length > 0; i++) {
    const d = g.pending;
    if (!d || d.inStep) return g;
    g = pass(g);
  }
  return g;
}

// Shared helpers for batch B2 card tests (owned by scripting agent B2).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { newGame, act, pass, put, runes, handCard, zoneOf, setController } from '../../fixtures/helpers.ts';
import { fullDb } from '../../fixtures/cards.ts';
import { getLegalActions } from '../../../src/engine/game.ts';
import { might, hasKw, kwVal } from '../../../src/engine/chars.ts';
import { moveToZone } from '../../../src/engine/state.ts';
import type { Action, CardDef, GameState, ObjId, PlayerId } from '../../../src/engine/types.ts';
import '../../../src/cards/scripts/index.ts';

export const real: Record<string, CardDef> = JSON.parse(readFileSync(new URL('../../../data/cards.json', import.meta.url), 'utf8'));
export const db: Record<string, CardDef> = { ...fullDb(), ...real };
export const RUNE = { Fury: 'rad-r01', Calm: 'rad-r02', Mind: 'rad-r03', Body: 'rad-r04', Chaos: 'rad-r05', Order: 'rad-r06' } as const;
export type Dom = keyof typeof RUNE;

/** A game at player 0's first main phase with empty hands and no runes in play (tests add exactly the runes they need). */
export function game(): GameState {
  const g = newGame({ db });
  for (const p of [0, 1] as PlayerId[]) {
    for (const r of [...g.players[p].runesInPlay]) moveToZone(g, r, 'runeDeck', { position: 'top' });
    for (const c of [...g.players[p].hand]) moveToZone(g, c, 'mainDeck', { position: 'bottom' });
  }
  return g;
}

/** Give player p `energy` generic (Fury) runes plus one rune per listed domain, all ready. */
export function mana(g: GameState, p: PlayerId, energy: number, ...domains: Dom[]): void {
  if (energy > 0) runes(g, p, energy, RUNE.Fury);
  for (const d of domains) runes(g, p, 1, RUNE[d]);
}
/** Remove every rune player p has in play (back to the rune deck). */
export function clearRunes(g: GameState, p: PlayerId): void {
  for (const r of [...g.players[p].runesInPlay]) moveToZone(g, r, 'runeDeck', { position: 'top' });
}
export function readyRunes(g: GameState, p: PlayerId): number { return g.players[p].runesInPlay.filter(r => !g.objects[r].exhausted).length; }

export type Answer = string | string[];

/** Answer in-step decisions in order (combat damage: the suggested assignment); pass priority otherwise. Stops at a main action or when answers run out. */
export function run(g: GameState, ...answers: Answer[]): GameState {
  const q = [...answers];
  for (let i = 0; i < 300; i++) {
    const d = g.pending;
    if (!d) return g;
    if (d.inStep) {
      if (d.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: d.player, assignment: d.data!.suggested as Record<string, number> }); continue; }
      if (!q.length) return g;
      const a = q.shift()!;
      g = act(g, { type: 'choose', player: d.player, optionIds: Array.isArray(a) ? a : [a] });
      continue;
    }
    if (d.kind === 'mainAction') { if (q.length) throw new Error(`run: unused answers ${JSON.stringify(q)} (at main action)`); return g; }
    g = pass(g);
  }
  throw new Error('run: too many steps');
}

/** Assert the pending in-step decision kind (and player); returns its option ids. */
export function expectDecision(g: GameState, kind: string, player?: PlayerId): string[] {
  assert.ok(g.pending, `expected a ${kind} decision, nothing pending`);
  assert.equal(g.pending!.kind, kind, `expected ${kind}, got ${g.pending!.kind}: ${g.pending!.prompt}`);
  if (player !== undefined) assert.equal(g.pending!.player, player, 'decision for the wrong player');
  return (g.pending!.options ?? []).map(o => o.id);
}
export function atMain(g: GameState, p: PlayerId = 0): void {
  assert.equal(g.pending?.kind, 'mainAction', `expected main action, got ${g.pending?.kind}: ${g.pending?.prompt}`);
  assert.equal(g.pending?.player, p);
}

export function play(g: GameState, p: PlayerId, obj: ObjId, extra: Partial<Extract<Action, { type: 'playCard' }>> = {}): GameState {
  return act(g, { type: 'playCard', player: p, obj, ...extra });
}
/** Play a card from hand (created in hand first). Returns [state, objId]. */
export function playNew(g: GameState, p: PlayerId, cardId: string, extra: Partial<Extract<Action, { type: 'playCard' }>> = {}): [GameState, ObjId] {
  const id = handCard(g, p, cardId);
  return [play(g, p, id, extra), id];
}

export function activations(g: GameState, p: PlayerId, obj: ObjId): number[] {
  return getLegalActions(g, p).filter(a => a.type === 'activate' && a.obj === obj).map(a => (a as Extract<Action, { type: 'activate' }>).abilityIndex);
}
export function canActivate(g: GameState, p: PlayerId, obj: ObjId, index: number): boolean { return activations(g, p, obj).includes(index); }
export function activate(g: GameState, p: PlayerId, obj: ObjId, index: number): GameState {
  assert.ok(canActivate(g, p, obj, index), `ability #${index} of ${g.objects[obj]?.cardId} is not activatable (legal: ${activations(g, p, obj)})`);
  return act(g, { type: 'activate', player: p, obj, abilityIndex: index });
}
export const EQUIP = 900;
export const EMPOWER = 901;

export function canPlay(g: GameState, p: PlayerId, obj: ObjId, dest?: number | 'base'): boolean {
  return getLegalActions(g, p).some(a => a.type === 'playCard' && a.obj === obj && (dest === undefined || a.destination === dest));
}
export function canMove(g: GameState, p: PlayerId, unit: ObjId, to: number | 'base'): boolean {
  return getLegalActions(g, p).some(a => a.type === 'move' && a.units.length === 1 && a.units[0] === unit && a.to === to);
}

/** Put a card face down at a battlefield (hidden on an earlier turn, so it can be played now). */
export function hideAt(g: GameState, p: PlayerId, cardId: string, bf: number): ObjId {
  const id = handCard(g, p, cardId);
  moveToZone(g, id, 'facedown', { bf, controller: p });
  g.objects[id].hiddenTurn = g.turn - 1;
  return id;
}

/** Turn a battlefield slot into a given battlefield card (test setup). */
export function setBattlefieldCard(g: GameState, bf: number, cardId: string): ObjId {
  const id = g.battlefields[bf].objId;
  g.objects[id].cardId = cardId;
  return id;
}

/** Attach gear directly (test setup; mirrors engine attach without events). */
export function attachNow(g: GameState, gear: ObjId, unit: ObjId): void {
  g.objects[gear].attachedTo = unit;
  g.ex.attachCount = (g.ex.attachCount ?? 0) + 1;
  const u = g.objects[unit];
  const go = g.objects[gear];
  if (u.zone === 'battlefield') {
    g.players[go.controller].base = g.players[go.controller].base.filter(x => x !== gear);
    go.zone = 'battlefield'; go.battlefieldIndex = u.battlefieldIndex;
  }
  g.ex.dirty = true;
}

/** End player 0's turn and play through to player p's next main phase, answering nothing. */
export function endTurn(g: GameState): GameState {
  const p = g.pending!.player;
  return act(g, { type: 'endTurn', player: p });
}

export function handSize(g: GameState, p: PlayerId): number { return g.players[p].hand.length; }
export function m(g: GameState, id: ObjId): number | null { return might(g, id); }

export { act, pass, put, runes, handCard, zoneOf, setController, might, hasKw, kwVal, getLegalActions, assert };

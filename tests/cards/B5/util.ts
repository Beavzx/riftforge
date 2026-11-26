// Shared helpers for batch B5 card tests (removal / interaction).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { newGame, act, pass, put, runes, handCard, zoneOf, setController, find } from '../../fixtures/helpers.ts';
import { fullDb } from '../../fixtures/cards.ts';
import { getLegalActions } from '../../../src/engine/game.ts';
import { might, hasKw } from '../../../src/engine/chars.ts';
import type { Action, CardDef, GameState, ObjId, PlayerId } from '../../../src/engine/types.ts';
import '../../../src/cards/tokens.ts';
import '../../../src/cards/scripts/batch-B5.ts';

export const real: Record<string, CardDef> = JSON.parse(readFileSync(new URL('../../../data/cards.json', import.meta.url), 'utf8'));
/** fixtures (t-*, ts-*) + every real card */
export const db: Record<string, CardDef> = { ...fullDb(), ...real };

export const RUNE = { Fury: 'rad-r01', Calm: 'rad-r02', Mind: 'rad-r03', Body: 'rad-r04', Chaos: 'rad-r05', Order: 'rad-r06' } as const;
export type Dom = keyof typeof RUNE;

/** A fresh game at P0's main phase; both battlefields uncontrolled. */
export function game(): GameState { return newGame({ db }); }

/** Give player p `n` ready runes of each listed domain (default: Fury). */
export function mana(g: GameState, p: PlayerId, n: number, ...domains: Dom[]): void {
  const ds = domains.length ? domains : ['Fury' as Dom];
  for (const d of ds) runes(g, p, n, RUNE[d]);
}
/** Lots of mana of every domain (12 runes). */
export function rich(g: GameState, p: PlayerId): void { mana(g, p, 2, 'Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order'); }
/** Exhaust every rune a player has in play. */
export function noRunes(g: GameState, p: PlayerId): void { for (const r of g.players[p].runesInPlay) g.objects[r].exhausted = true; }

export type Answer = string | string[];

/**
 * Feed answers to in-step decisions in order; pass priority otherwise (combat damage is assigned with the
 * engine's suggestion). Stops at a main action, or at an in-step decision when no answers are left.
 */
export function run(g: GameState, ...answers: Answer[]): GameState {
  const q = [...answers];
  for (let i = 0; i < 300; i++) {
    const d = g.pending;
    if (!d) return g;
    if (d.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: d.player, assignment: (d.data as { suggested: Record<ObjId, number> }).suggested }); continue; }
    if (d.inStep) {
      if (!q.length) return g;
      const a = q.shift()!;
      g = act(g, { type: 'choose', player: d.player, optionIds: Array.isArray(a) ? a : [a] });
      continue;
    }
    if (d.kind === 'mainAction') { assert.equal(q.length, 0, `unused answers: ${JSON.stringify(q)}`); return g; }
    g = pass(g);
  }
  throw new Error('run: too many steps');
}

/** Answer in-step decisions only (no passing): useful to stop with the spell still on the chain. */
export function answer(g: GameState, ...answers: Answer[]): GameState {
  for (const a of answers) {
    const d = g.pending;
    assert.ok(d && d.inStep, `expected an in-step decision for answer ${JSON.stringify(a)}, got ${d?.kind}`);
    g = act(g, { type: 'choose', player: d!.player, optionIds: Array.isArray(a) ? a : [a] });
  }
  return g;
}

/** Assert the pending decision kind (and player); returns its option ids. */
export function expectDecision(g: GameState, kind: string, player?: PlayerId): string[] {
  assert.ok(g.pending, `expected a ${kind} decision, nothing pending`);
  assert.equal(g.pending!.kind, kind, `expected ${kind}, got ${g.pending!.kind}: ${g.pending!.prompt}`);
  if (player !== undefined) assert.equal(g.pending!.player, player, `decision for the wrong player (${g.pending!.prompt})`);
  return (g.pending!.options ?? []).map(o => o.id);
}

/** Play a card that is already in hand (or elsewhere) */
export function play(g: GameState, p: PlayerId, obj: ObjId, extra: Partial<Extract<Action, { type: 'playCard' }>> = {}): GameState {
  const r = act(g, { type: 'playCard', player: p, obj, ...extra });
  return r;
}

/** Pass priority until player p may act on the chain / in a showdown (not past a main action). */
export function toPriority(g: GameState, p: PlayerId): GameState {
  for (let i = 0; i < 20; i++) {
    const d = g.pending;
    if (!d || d.inStep) return g;
    if (d.player === p && d.kind !== 'mainAction') return g;
    if (d.kind === 'mainAction') return g;
    g = pass(g);
  }
  return g;
}

/** Player p responds by playing a card from hand (passing priority to them first). */
export function respond(g: GameState, p: PlayerId, obj: ObjId, extra: Partial<Extract<Action, { type: 'playCard' }>> = {}): GameState {
  g = toPriority(g, p);
  assert.ok(g.pending && g.pending.player === p, `player ${p} never got priority (${g.pending?.kind})`);
  return play(g, p, obj, extra);
}

/** Put a card in p's hand and play it. */
export function cast(g: GameState, p: PlayerId, cardId: string, extra: Partial<Extract<Action, { type: 'playCard' }>> = {}): { g: GameState; id: ObjId } {
  const id = handCard(g, p, cardId);
  return { g: play(g, p, id, extra), id };
}

export function canPlay(g: GameState, p: PlayerId, obj: ObjId): boolean {
  return getLegalActions(g, p).some(a => a.type === 'playCard' && a.obj === obj);
}

export function activate(g: GameState, p: PlayerId, obj: ObjId): GameState {
  const a = getLegalActions(g, p).find(x => x.type === 'activate' && x.obj === obj);
  assert.ok(a, `no legal activation of ${g.objects[obj]?.cardId}`);
  return act(g, a!);
}
export function canActivate(g: GameState, p: PlayerId, obj: ObjId): boolean {
  return getLegalActions(g, p).some(a => a.type === 'activate' && a.obj === obj);
}

/** Standard move (attack) of units to a battlefield. */
export function moveTo(g: GameState, p: PlayerId, units: ObjId[], to: number | 'base'): GameState {
  return act(g, { type: 'move', player: p, units, to });
}

/** End P0's turn and run until P1's main phase (answers are fed to decisions on the way). */
export function endTurn(g: GameState, ...answers: Answer[]): GameState {
  const p = g.activePlayer;
  g = act(g, { type: 'endTurn', player: p });
  return run(g, ...answers);
}

export const dmg = (g: GameState, id: ObjId) => g.objects[id]?.damage ?? 0;
export const handSize = (g: GameState, p: PlayerId) => g.players[p].hand.length;
export const M = (g: GameState, id: ObjId) => might(g, id);
export { act, pass, put, runes, handCard, zoneOf, setController, find, hasKw, getLegalActions };

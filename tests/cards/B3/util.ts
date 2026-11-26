// Shared helpers for batch B3 card tests.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { newGame, act, choose, pass, put, runes, handCard, zoneOf, setController, find } from '../../fixtures/helpers.ts';
import { fullDb } from '../../fixtures/cards.ts';
import { getLegalActions } from '../../../src/engine/game.ts';
import { might, hasKw } from '../../../src/engine/chars.ts';
import type { Action, CardDef, GameState, ObjId, PlayerId } from '../../../src/engine/types.ts';
import '../../../src/cards/scripts/index.ts';

export const real: Record<string, CardDef> = JSON.parse(readFileSync(new URL('../../../data/cards.json', import.meta.url), 'utf8'));
/** test fixtures (t-*, ts-* scripted helpers such as ts-zap) + every real card */
export const db: Record<string, CardDef> = { ...fullDb(), ...real };

export const RUNE = { Fury: 'rad-r01', Calm: 'rad-r02', Mind: 'rad-r03', Body: 'rad-r04', Chaos: 'rad-r05', Order: 'rad-r06' } as const;

export function game(): GameState { return newGame({ db }); }

/** Give player p `energy` generic runes plus one rune per listed domain (all ready). */
export function mana(g: GameState, p: PlayerId, energy: number, ...domains: (keyof typeof RUNE)[]): void {
  if (energy > 0) runes(g, p, energy);
  for (const d of domains) runes(g, p, 1, RUNE[d]);
}

/** Exhaust every rune a player has in play (so tests control what they can pay). */
export function noRunes(g: GameState, p: PlayerId): void {
  for (const r of g.players[p].runesInPlay) g.objects[r].exhausted = true;
}

export type Answer = string | string[] | ((g: GameState) => string[]);

/**
 * Feed answers to in-step decisions in order; pass priority otherwise; combat damage takes the suggested assignment. Stops when the main action of
 * anyone comes up and no answers are left, or when an in-step decision is pending and no answers are left.
 */
export function run(g: GameState, ...answers: Answer[]): GameState {
  const q = [...answers];
  for (let i = 0; i < 200; i++) {
    const d = g.pending;
    if (!d) return g;
    if (d.inStep && d.kind === 'assignDamage') {
      // combat damage assignment isn't what these card tests are about: take the engine's suggestion
      g = act(g, { type: 'assignDamage', player: d.player, assignment: d.data!.suggested as Record<string, number> });
      continue;
    }
    if (d.inStep) {
      if (!q.length) return g;
      const a = q.shift()!;
      const ids = typeof a === 'function' ? a(g) : Array.isArray(a) ? a : [a];
      g = act(g, { type: 'choose', player: d.player, optionIds: ids });
      continue;
    }
    if (d.kind === 'mainAction') return g;
    g = pass(g);
  }
  throw new Error('run: too many steps');
}

/** Assert the pending decision is of a kind (and optionally for a player), returning its option ids. */
export function expectDecision(g: GameState, kind: string, player?: PlayerId): string[] {
  assert.ok(g.pending, `expected a ${kind} decision, nothing pending`);
  assert.equal(g.pending!.kind, kind, `expected ${kind}, got ${g.pending!.kind}: ${g.pending!.prompt}`);
  if (player !== undefined) assert.equal(g.pending!.player, player, 'decision for the wrong player');
  return (g.pending!.options ?? []).map(o => o.id);
}

export function play(g: GameState, p: PlayerId, obj: ObjId, extra: Partial<Extract<Action, { type: 'playCard' }>> = {}): GameState {
  return act(g, { type: 'playCard', player: p, obj, ...extra });
}

/** Activate the n-th listed activated ability of obj (legal actions order). */
export function activate(g: GameState, p: PlayerId, obj: ObjId, abilityIndex?: number): GameState {
  const legal = getLegalActions(g, p).filter(a => a.type === 'activate' && a.obj === obj) as Extract<Action, { type: 'activate' }>[];
  const a = abilityIndex === undefined ? legal[0] : legal.find(x => x.abilityIndex === abilityIndex);
  assert.ok(a, `no legal activation of ${g.objects[obj]?.cardId} #${abilityIndex ?? 'any'}`);
  return act(g, a!);
}

export function canActivate(g: GameState, p: PlayerId, obj: ObjId, abilityIndex?: number): boolean {
  return getLegalActions(g, p).some(a => a.type === 'activate' && a.obj === obj && (abilityIndex === undefined || a.abilityIndex === abilityIndex));
}

export function canPlay(g: GameState, p: PlayerId, obj: ObjId): boolean {
  return getLegalActions(g, p).some(a => a.type === 'playCard' && a.obj === obj);
}

/** Token objects of a player by name (e.g. 'Recruit', 'Gold'). */
export function tokens(g: GameState, p: PlayerId, name: string): ObjId[] {
  return Object.values(g.objects).filter(o => o.isToken && o.controller === p && g.cards[o.cardId]?.name === name && (o.zone === 'base' || o.zone === 'battlefield')).map(o => o.id);
}
export function tokensAt(g: GameState, p: PlayerId, name: string, loc: 'base' | number): ObjId[] {
  return tokens(g, p, name).filter(id => (loc === 'base' ? g.objects[id].zone === 'base' : g.objects[id].zone === 'battlefield' && g.objects[id].battlefieldIndex === loc));
}

/** Put a token object directly onto the board (test setup). */
export function putToken(g: GameState, p: PlayerId, cardId: string, where: 'base' | number = 'base', opts: { ready?: boolean } = {}): ObjId {
  const id = put(g, p, cardId, where, opts);
  g.objects[id].isToken = true;
  return id;
}

/** Replace a player's legend with a real legend card. */
export function setLegend(g: GameState, p: PlayerId, cardId: string): ObjId {
  const id = g.players[p].legend;
  g.objects[id].cardId = cardId;
  g.ex.dirty = true;
  return id;
}

/** Replace battlefield bf with a real battlefield card. */
export function setBattlefield(g: GameState, bf: number, cardId: string): ObjId {
  const id = g.battlefields[bf].objId;
  g.objects[id].cardId = cardId;
  g.ex.dirty = true;
  return id;
}

/** Take control of battlefield bf for p and keep it (a vanilla unit of p stays there). */
export function controlBf(g: GameState, p: PlayerId, bf: number, unit = 't-u1'): ObjId {
  setController(g, bf, p);
  return put(g, p, unit, bf);
}

/**
 * Kill a unit "for real" (Deathknell / dies triggers): p casts Test Zap (2 damage, Reaction) at it after it was
 * given lethal damage. Returns the state with the zap resolved (triggers may be pending).
 */
export function slay(g: GameState, _p: PlayerId, id: ObjId, ...answers: Answer[]): GameState {
  const p = g.pending!.player;   // whoever may act now casts the zap (the killer doesn't matter for these tests)
  runes(g, p, 1);
  g.objects[id].damage = 99;
  const z = handCard(g, p, 'ts-zap');
  g = act(g, { type: 'playCard', player: p, obj: z });
  if (g.pending?.kind === 'chooseTargets') g = choose(g, id);
  return run(g, ...answers);
}

/** Pass priority until player p may respond, then p plays a card (chain response). */
export function respond(g: GameState, p: PlayerId, obj: ObjId, target?: ObjId): GameState {
  for (let i = 0; i < 6 && g.pending && g.pending.player !== p && !g.pending.inStep; i++) g = pass(g);
  g = act(g, { type: 'playCard', player: p, obj });
  if (target && g.pending?.kind === 'chooseTargets') g = choose(g, target);
  return g;
}

/** Standard move (player action). */
export function move(g: GameState, p: PlayerId, units: ObjId[], to: 'base' | number, ...answers: Answer[]): GameState {
  g = act(g, { type: 'move', player: p, units, to });
  return run(g, ...answers);
}

/** End the active player's turn and run to the next main action (answering in-step decisions in order). */
export function endTurn(g: GameState, ...answers: Answer[]): GameState {
  g = act(g, { type: 'endTurn', player: g.activePlayer });
  return run(g, ...answers);
}

export const M = (g: GameState, id: ObjId) => might(g, id);
export const kw = (g: GameState, id: ObjId, k: string) => hasKw(g, id, k);

export { newGame, act, choose, pass, put, runes, handCard, zoneOf, setController, find, getLegalActions, assert };

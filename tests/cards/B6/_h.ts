// Shared helpers for batch B6 card tests.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../../../src/cards/tokens.ts';
import '../../../src/cards/scripts/batch-B6.ts';
import { newGame, act, choose, pass, put, runes, handCard, resolveAll, zoneOf, setController } from '../../fixtures/helpers.ts';
import { baseDb } from '../../fixtures/cards.ts';
import { might, hasKw, kwVal } from '../../../src/engine/chars.ts';
import { getLegalActions } from '../../../src/engine/game.ts';
import { card, spell, E, T } from '../../../src/cards/dsl.ts';
import type { CardDef, GameState, ObjId, PlayerId, Action } from '../../../src/engine/types.ts';

export const real: Record<string, CardDef> = JSON.parse(readFileSync(new URL('../../../data/cards.json', import.meta.url), 'utf8'));
const def = (id: string, type: CardDef['type'], o: Partial<CardDef> = {}): CardDef =>
  ({ id, name: id, type, supertypes: [], tags: [], domains: ['Fury'], energy: 1, power: 0, might: type === 'Unit' ? 1 : null, keywords: [], text: '', set: 'test', rarity: 'Common', ...o } as CardDef);
/** Test-only cards for B6 scenarios. */
export const extra: Record<string, CardDef> = {
  't-b6-poro': def('t-b6-poro', 'Unit', { tags: ['Poro'] }),
  't-b6-bird': def('t-b6-bird', 'Unit', { tags: ['Bird'] }),
  't-b6-cat': def('t-b6-cat', 'Unit', { tags: ['Cat'] }),
  't-b6-dog': def('t-b6-dog', 'Unit', { tags: ['Dog'] }),
  't-b6-mech': def('t-b6-mech', 'Unit', { tags: ['Mech'], energy: 3, might: 3 }),
  't-b6-dragon': def('t-b6-dragon', 'Unit', { tags: ['Dragon'], energy: 2, might: 2 }),
  't-b6-fury3': def('t-b6-fury3', 'Unit', { domains: ['Fury'], energy: 3, might: 3 }),
  't-b6-body3': def('t-b6-body3', 'Unit', { domains: ['Body'], energy: 3, might: 3 }),
  't-b6-bodydeflect': def('t-b6-bodydeflect', 'Unit', { domains: ['Body'], energy: 3, might: 6, text: '[Deflect]', keywords: ['Deflect'] }),
  't-b6-unit7': def('t-b6-unit7', 'Unit', { energy: 7, might: 7 }),
  't-b6-gear2': def('t-b6-gear2', 'Gear', { energy: 2 }),
  't-b6-gear5': def('t-b6-gear5', 'Gear', { energy: 5 }),
  't-b6-spell1': def('t-b6-spell1', 'Spell', { energy: 1, text: '[Action]', keywords: ['Action'] }),
  't-b6-spell4': def('t-b6-spell4', 'Spell', { energy: 4, text: '[Action]', keywords: ['Action'] }),
  't-b6-spell5': def('t-b6-spell5', 'Spell', { energy: 5, text: '[Action]', keywords: ['Action'] }),
  't-b6-hspell': def('t-b6-hspell', 'Spell', { energy: 3, text: '[Hidden]\n[Reaction]', keywords: ['Hidden', 'Reaction'] }),
  't-b6-hunit': def('t-b6-hunit', 'Unit', { energy: 2, might: 2, text: '[Hidden]', keywords: ['Hidden'] }),
  't-b6-discard2': def('t-b6-discard2', 'Spell', { energy: 0, text: '[Action]', keywords: ['Action'] }),
  't-b6-stun': def('t-b6-stun', 'Spell', { energy: 0, text: '[Reaction]', keywords: ['Reaction'] }),
  't-b6-reveal': def('t-b6-reveal', 'Spell', { energy: 0, text: '[Action]', keywords: ['Action'] }),
  't-b6-exhaust3': def('t-b6-exhaust3', 'Spell', { energy: 0, text: '[Action]', keywords: ['Action'] }),
  't-b6-shrink': def('t-b6-shrink', 'Spell', { energy: 0, text: '[Reaction]', keywords: ['Reaction'] }),
  't-b6-fury-zap': def('t-b6-fury-zap', 'Spell', { domains: ['Fury'], energy: 0, text: '[Reaction]', keywords: ['Reaction'] }),
};
// scripted test cards
card('t-b6-discard2', '[Action]', [spell(E.discard(2))]);
card('t-b6-stun', '[Reaction]', [spell(E.stun(0), { targets: [T.unit()] })]);
card('t-b6-reveal', '[Action]', [spell(ctx => { ctx.revealTop(1); })]);
card('t-b6-exhaust3', '[Action]', [spell(ctx => { ctx.exhaust(ctx.targetsOf(0)); }, { targets: [T.anyNumber(T.unit())] })]);
card('t-b6-shrink', '[Reaction]', [spell(E.might(0, -1), { targets: [T.unit()] })]);
card('t-b6-fury-zap', '[Reaction]', [spell(E.deal(1, 0), { targets: [T.unit()] })]);
export const db: Record<string, CardDef> = { ...baseDb(), ...real, ...extra };
export const game = (o: Parameters<typeof newGame>[0] = {}): GameState => newGame({ db, ...o });

export const RUNE = { Fury: 'rad-r01', Calm: 'rad-r02', Mind: 'rad-r03', Body: 'rad-r04', Chaos: 'rad-r05', Order: 'rad-r06' } as const;
export type Dom = keyof typeof RUNE;

/** Give player p `n` ready runes of a domain (default: enough generic Fury). */
export function addRunes(g: GameState, p: PlayerId, n: number, dom: Dom = 'Fury'): ObjId[] { return runes(g, p, n, RUNE[dom]); }

/** Exhaust every rune a player has in play (so only explicitly added runes pay). */
export function exhaustRunes(g: GameState, p: PlayerId): void { for (const r of g.players[p].runesInPlay) g.objects[r].exhausted = true; }

/** Answer pending in-step decisions with the given answers (each an id or ids), passing priority otherwise, until quiet. */
export function drive(g: GameState, ...answers: (string | string[])[]): GameState {
  const q = [...answers];
  for (let i = 0; i < 200; i++) {
    const d = g.pending;
    if (!d) return g;
    if (d.inStep) {
      if (!q.length) return g;
      const a = q.shift()!;
      g = choose(g, ...(Array.isArray(a) ? a : [a]));
      continue;
    }
    if (d.kind === 'mainAction') { if (q.length) assert.fail(`unused answers: ${JSON.stringify(q)}`); return g; }
    if (d.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: d.player, assignment: ((d.data as { suggested?: Record<ObjId, number> })?.suggested) ?? {} }); continue; }
    g = pass(g);
  }
  return g;
}

/** Answer in-step decisions and pass only while the chain is non-empty (stops in an open showdown window). */
export function resolveChain(g: GameState, ...answers: (string | string[])[]): GameState {
  const q = [...answers];
  for (let i = 0; i < 100; i++) {
    const d = g.pending;
    if (!d) return g;
    if (d.inStep) { if (!q.length) return g; const a = q.shift()!; g = choose(g, ...(Array.isArray(a) ? a : [a])); continue; }
    if (g.chain.length === 0) { if (q.length) assert.fail(`unused answers: ${JSON.stringify(q)}`); return g; }
    g = pass(g);
  }
  return g;
}

/** Put a card in hand and play it without driving past the chain (for plays inside showdowns). */
export function playHere(g: GameState, p: PlayerId, cardId: string, dest: number | 'base' | undefined, ...answers: (string | string[])[]): { g: GameState; id: ObjId } {
  const id = handCard(g, p, cardId);
  g = act(g, { type: 'playCard', player: p, obj: id, ...(dest !== undefined ? { destination: dest } : {}) });
  if (g.ex.lastEvents.some(e => e.type === 'rollback')) assert.fail(`play of ${cardId} rolled back: ${JSON.stringify(g.ex.lastEvents.find(e => e.type === 'rollback'))}`);
  return { g: resolveChain(g, ...answers), id };
}

/** Standard-move units into a battlefield and stop at the first showdown/combat action window. */
export function attackInto(g: GameState, p: PlayerId, units: ObjId[], bf: number, ...answers: (string | string[])[]): GameState {
  g = act(g, { type: 'move', player: p, units, to: bf });
  return resolveChain(g, ...answers);
}

/** Apply an action then drive with answers. */
export function doAct(g: GameState, a: Action, ...answers: (string | string[])[]): GameState {
  g = act(g, a);
  return drive(g, ...answers);
}

/** Put a card in hand and play it (optionally to a destination), answering decisions. */
export function play(g: GameState, p: PlayerId, cardId: string, dest: number | 'base' | undefined, ...answers: (string | string[])[]): { g: GameState; id: ObjId } {
  const id = handCard(g, p, cardId);
  g = act(g, { type: 'playCard', player: p, obj: id, ...(dest !== undefined ? { destination: dest } : {}) });
  if (g.ex.lastEvents.some(e => e.type === 'rollback')) assert.fail(`play of ${cardId} rolled back: ${JSON.stringify(g.ex.lastEvents.find(e => e.type === 'rollback'))}`);
  return { g: drive(g, ...answers), id };
}

/** Play a card already in hand. */
export function playObj(g: GameState, p: PlayerId, id: ObjId, dest: number | 'base' | undefined, ...answers: (string | string[])[]): GameState {
  g = act(g, { type: 'playCard', player: p, obj: id, ...(dest !== undefined ? { destination: dest } : {}) });
  if (g.ex.lastEvents.some(e => e.type === 'rollback')) assert.fail(`play rolled back: ${JSON.stringify(g.ex.lastEvents.find(e => e.type === 'rollback'))}`);
  return drive(g, ...answers);
}

/** Activate the first activated ability (by index) of an object. */
export function activate(g: GameState, p: PlayerId, obj: ObjId, index: number, ...answers: (string | string[])[]): GameState {
  g = act(g, { type: 'activate', player: p, obj, abilityIndex: index });
  if (g.ex.lastEvents.some(e => e.type === 'rollback')) assert.fail(`activation rolled back: ${JSON.stringify(g.ex.lastEvents.find(e => e.type === 'rollback'))}`);
  return drive(g, ...answers);
}

/** Standard move (exhausts the units) and drive the resulting showdown/combat with passes. */
export function moveUnits(g: GameState, p: PlayerId, units: ObjId[], to: number | 'base', ...answers: (string | string[])[]): GameState {
  return doAct(g, { type: 'move', player: p, units, to }, ...answers);
}

/** End the current turn and drive until the next player's main phase (answers for in-step decisions). */
export function endTurn(g: GameState, ...answers: (string | string[])[]): GameState {
  const p = g.activePlayer;
  return doAct(g, { type: 'endTurn', player: p }, ...answers);
}

export const M = (g: GameState, id: ObjId): number => might(g, id) ?? 0;
export const buffs = (g: GameState, id: ObjId): number => g.objects[id]?.counters.buff ?? 0;
export const ready = (g: GameState, id: ObjId): boolean => !g.objects[id].exhausted;
export const pendingIds = (g: GameState): string[] => (g.pending?.options ?? []).map(o => o.id);
export const legalPlay = (g: GameState, p: PlayerId, obj: ObjId): boolean => getLegalActions(g, p).some(a => a.type === 'playCard' && a.obj === obj);
export const legalActivate = (g: GameState, p: PlayerId, obj: ObjId, index?: number): boolean =>
  getLegalActions(g, p).some(a => a.type === 'activate' && a.obj === obj && (index === undefined || a.abilityIndex === index));

export { assert, act, choose, pass, put, runes, handCard, resolveAll, zoneOf, setController, might, hasKw, kwVal, getLegalActions };
export type { GameState, ObjId, PlayerId };

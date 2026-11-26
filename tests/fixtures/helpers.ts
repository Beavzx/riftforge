// Test helpers: build games and manipulate state directly for scenario tests.
import type { Action, CardDef, CardId, GameState, ObjId, PlayerId, Decision } from '../../src/engine/types.ts';
import { createGame, applyAction, getLegalActions } from '../../src/engine/game.ts';
import { newObject, moveToZone } from '../../src/engine/state.ts';
import { baseDb, deck, type DeckOpts } from './cards.ts';

export interface TestGameOpts {
  seed?: number;
  db?: Record<CardId, CardDef>;
  p0?: DeckOpts; p1?: DeckOpts;
  firstPlayer?: PlayerId;
  mulligan?: boolean;
  shuffle?: boolean;
}

/** A game at the first player's main phase (no mulligan, decks in listed order). */
export function newGame(o: TestGameOpts = {}): GameState {
  const db = o.db ?? baseDb();
  return createGame({
    seed: o.seed ?? 1, cardDb: db, includeAllCards: true, battlefieldSelection: 'random', firstPlayer: o.firstPlayer ?? 0, skipMulligan: !o.mulligan, skipShuffle: !o.shuffle,
    players: [{ name: 'Alice', deck: deck(o.p0) }, { name: 'Bob', deck: deck(o.p1, 3) }],
  });
}

export function act(g: GameState, a: Action): GameState {
  return applyAction(g, a).state;
}

/** Answer the pending in-step decision by option ids. */
export function choose(g: GameState, ...ids: string[]): GameState {
  const d = g.pending!;
  return act(g, { type: 'choose', player: d.player, optionIds: ids });
}

export function yes(g: GameState): GameState { return choose(g, 'yes'); }
export function no(g: GameState): GameState { return choose(g, 'no'); }

export function pass(g: GameState): GameState {
  const d = g.pending!;
  if (d.kind === 'mainAction') return act(g, { type: 'endTurn', player: d.player });
  return act(g, { type: 'pass', player: d.player });
}

/** Pass until the pending decision is a main action for player p (or limit). */
export function passUntilMain(g: GameState, p: PlayerId, limit = 50): GameState {
  for (let i = 0; i < limit; i++) {
    const d = g.pending;
    if (!d) return g;
    if (d.kind === 'mainAction' && d.player === p) return g;
    if (d.inStep) { const l = getLegalActions(g, d.player); g = act(g, l[0]); continue; }
    g = pass(g);
  }
  return g;
}

/** Pass priority on the chain / showdown until nothing is pending except a main action or an in-step decision. */
export function resolveAll(g: GameState, limit = 40): GameState {
  for (let i = 0; i < limit; i++) {
    const d = g.pending;
    if (!d || d.inStep || d.kind === 'mainAction') return g;
    g = pass(g);
  }
  return g;
}

/** Put a card directly onto the board (test setup; mutates). */
export function put(g: GameState, p: PlayerId, cardId: CardId, where: 'base' | number | 'hand' | 'trash' | 'deckTop' = 'base', opts: { ready?: boolean; damage?: number } = {}): ObjId {
  if (!g.cards[cardId]) throw new Error(`card ${cardId} not in game db`);
  const zone = where === 'base' ? 'base' : typeof where === 'number' ? 'battlefield' : where === 'hand' ? 'hand' : where === 'trash' ? 'trash' : 'mainDeck';
  const o = newObject(g, cardId, p, zone);
  if (typeof where === 'number') o.battlefieldIndex = where;
  if (where === 'base') g.players[p].base.push(o.id);
  if (where === 'hand') g.players[p].hand.push(o.id);
  if (where === 'trash') g.players[p].trash.push(o.id);
  if (where === 'deckTop') g.players[p].mainDeck.unshift(o.id);
  o.exhausted = !(opts.ready ?? true);
  o.damage = opts.damage ?? 0;
  return o.id;
}

/** Give a player ready runes in play (test setup; mutates). */
export function runes(g: GameState, p: PlayerId, n: number, cardId = 't-rune-fury'): ObjId[] {
  const out: ObjId[] = [];
  for (let i = 0; i < n; i++) { const o = newObject(g, cardId, p, 'runePool'); g.players[p].runesInPlay.push(o.id); out.push(o.id); }
  return out;
}

export function setController(g: GameState, bf: number, p: PlayerId | null): void { g.battlefields[bf].controller = p; }

export function handCard(g: GameState, p: PlayerId, cardId: CardId): ObjId { return put(g, p, cardId, 'hand'); }

export function find(g: GameState, cardId: CardId, p?: PlayerId): ObjId[] {
  return Object.values(g.objects).filter(o => o.cardId === cardId && (p === undefined || o.controller === p)).map(o => o.id);
}

export function zoneOf(g: GameState, id: ObjId): string { return g.objects[id]?.zone ?? 'gone'; }

export function pendingKind(g: GameState): Decision['kind'] | undefined { return g.pending?.kind; }

export { moveToZone, getLegalActions };

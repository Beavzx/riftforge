// Supported state builders for tests (N2). They mutate a quiescent state (pending = top-level decision,
// no replay unit) and keep engine caches/bookkeeping consistent. Never use them inside card scripts.
import type { CardId, GameState, ObjId, PlayerId } from './types.ts';
import { newObject, moveToZone } from './state.ts';
import { attach as attachFn } from './actions.ts';
import { playCost, playOptions, purposeOf } from './play.ts';
import type { ResolvedCost } from './payment.ts';
import type { Destination } from './abilities.ts';

export type PlaceLoc = 'base' | number | 'hand' | 'trash' | 'banishment' | 'deckTop' | 'deckBottom' | 'runeDeck' | 'runes';

export interface PlaceOpts { ready?: boolean; damage?: number; stunned?: boolean; buff?: boolean; controller?: PlayerId; faceDownAt?: number; hiddenTurn?: number; empowered?: number; token?: boolean; tokenMight?: number }

/** Create an object for player p at a location. The card def must be in state.cards (use includeAllCards). */
export function place(g: GameState, p: PlayerId, cardId: CardId, loc: PlaceLoc, o: PlaceOpts = {}): ObjId {
  if (!g.cards[cardId]) throw new Error(`testkit.place: card ${cardId} not in this game's card pool`);
  const ctrl = o.controller ?? p;
  const ob = newObject(g, cardId, p, 'setAside', { controller: ctrl });
  if (o.token) ob.isToken = true;
  if (o.tokenMight !== undefined) ob.counters.tokenMight = o.tokenMight;
  if (o.faceDownAt !== undefined) {
    ob.zone = 'facedown'; ob.battlefieldIndex = o.faceDownAt; ob.faceDown = true; ob.hiddenTurn = o.hiddenTurn ?? g.turn - 1;
  } else if (loc === 'base') { ob.zone = 'base'; g.players[ctrl].base.push(ob.id); }
  else if (typeof loc === 'number') { ob.zone = 'battlefield'; ob.battlefieldIndex = loc; }
  else if (loc === 'runes') { ob.zone = 'runePool'; g.players[ctrl].runesInPlay.push(ob.id); }
  else if (loc === 'deckTop' || loc === 'deckBottom') { ob.zone = 'mainDeck'; if (loc === 'deckTop') g.players[p].mainDeck.unshift(ob.id); else g.players[p].mainDeck.push(ob.id); }
  else { moveToZone(g, ob.id, loc === 'runeDeck' ? 'runeDeck' : loc); }
  ob.exhausted = o.ready === false;
  ob.damage = o.damage ?? 0;
  ob.stunned = !!o.stunned;
  if (o.buff) ob.counters.buff = 1;
  if (o.empowered) ob.empowered = o.empowered;
  touch(g);
  return ob.id;
}

/** Attach gear to a unit now (keeps attachment bookkeeping right). */
export function attachNow(g: GameState, gear: ObjId, unit: ObjId): void { attachFn(g, gear, unit); g.ex.lastEvents = []; (g.triggerQueue as unknown[]).length = 0; touch(g); }

/** "Prevent the next n (or all) damage to unit this turn" shield. */
export function addPreventShield(g: GameState, unit: ObjId, n: number | 'all', controller?: PlayerId): void {
  g.ex.delayed.push({ id: `d${++g.timestamp}`, controller: controller ?? g.objects[unit].controller, source: null, key: 'builtin:prevent', data: { obj: unit, epoch: g.objects[unit].epoch ?? 0, remaining: n }, expires: 'endOfTurn', turn: g.turn, timestamp: g.timestamp });
}

/** Sets p's points (in 2v2 the team's, CR 491.8.d.1). */
export function setPoints(g: GameState, p: PlayerId, n: number): void { for (const pl of g.players) if (pl.id === p || (g.mode === '2v2' && pl.id % 2 === p % 2)) pl.points = n; }
export function setXp(g: GameState, p: PlayerId, n: number): void { g.players[p].xp = n; }
export function setBattlefieldController(g: GameState, bf: number, p: PlayerId | null): void { g.battlefields[bf].controller = p; touch(g); }

/** Invalidate engine caches after direct edits and request a cleanup on the next applyAction. */
export function touch(g: GameState): void { g.timestamp++; g.ex.dirty = true; }

/** N3: total cost to play a card now (before optional costs and Deflect), as the engine computes it. */
export function playCostOf(g: GameState, p: PlayerId, obj: ObjId, opts: { dest?: Destination } = {}): ResolvedCost | null {
  const opt = playOptions(g, p).find(o => o.obj === obj);
  if (!opt) return null;
  void purposeOf;
  return playCost(g, p, opt, undefined, undefined, { dest: opts.dest });
}


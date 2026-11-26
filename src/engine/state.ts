// Objects, zones and locations. moveToZone is the single place where objects change zones.
import type { CardId, GameObject, GameState, ObjId, PlayerId, ZoneKind } from './types.ts';
import { EngineError } from './util.ts';

export type Loc = 'base' | number;

export function newObject(g: GameState, cardId: CardId, owner: PlayerId, zone: ZoneKind, extra: Partial<GameObject> = {}): GameObject {
  const id = `o${g.nextObj++}`;
  const o: GameObject = {
    id, cardId, owner, controller: owner, zone,
    exhausted: false, faceDown: false, damage: 0, counters: {}, modifiers: [],
    enteredThisTurn: false, timestamp: ++g.timestamp, epoch: 0, ...extra,
  };
  g.objects[id] = o;
  return o;
}

function arrayFor(g: GameState, o: GameObject, zone: ZoneKind): ObjId[] | null {
  const owner = g.players[o.owner];
  const ctrl = g.players[o.controller];
  switch (zone) {
    case 'hand': return owner.hand;
    case 'mainDeck': return owner.mainDeck;
    case 'runeDeck': return owner.runeDeck;
    case 'trash': return owner.trash;
    case 'banishment': return owner.banishment;
    case 'base': return ctrl.base;
    case 'runePool': return ctrl.runesInPlay;
    case 'championZone': return owner.championZone;
    default: return null;
  }
}

function removeFrom(arr: ObjId[] | null, id: ObjId): void {
  if (!arr) return;
  const i = arr.indexOf(id);
  if (i >= 0) arr.splice(i, 1);
}

/** Remove an object from every player array it might be in (robust against controller changes). */
function detachFromArrays(g: GameState, id: ObjId): void {
  for (const p of g.players) {
    removeFrom(p.hand, id); removeFrom(p.mainDeck, id); removeFrom(p.runeDeck, id); removeFrom(p.trash, id);
    removeFrom(p.banishment, id); removeFrom(p.base, id); removeFrom(p.runesInPlay, id); removeFrom(p.championZone, id);
  }
}

let leaveHook: ((g: GameState, id: ObjId, to: ZoneKind) => void) | null = null;
/** events.ts registers a hook that emits 'leaveBoard' (before the object changes zone, so its own trigger sees it). */
export function setLeaveBoardHook(f: (g: GameState, id: ObjId, to: ZoneKind) => void): void { leaveHook = f; }

export const BOARD: ReadonlySet<ZoneKind> = new Set<ZoneKind>(['base', 'battlefield', 'facedown', 'runePool']);
export function isBoardZone(z: ZoneKind): boolean { return BOARD.has(z); }

export interface MoveOpts { bf?: number; position?: 'top' | 'bottom' | number; keepState?: boolean; controller?: PlayerId }

/**
 * Move an object to a zone. Crossing the board boundary (or moving between non-board zones)
 * makes it a new object (CR 124): damage, counters, modifiers, statuses are cleared.
 * Tokens leaving the board to a non-chain zone cease to exist (CR 179). Returns false if the
 * object ceased to exist.
 */
export function moveToZone(g: GameState, id: ObjId, zone: ZoneKind, opts: MoveOpts = {}): boolean {
  const o = g.objects[id];
  if (!o) throw new EngineError(`moveToZone: unknown ${id}`);
  const from = o.zone;
  g.timestamp++;
  if ((from === 'base' || from === 'battlefield') && !isBoardZone(zone) && zone !== 'chain' && leaveHook) leaveHook(g, id, zone);
  detachFromArrays(g, id);
  const newObj = !(isBoardZone(from) && isBoardZone(zone)) && !(from === 'chain' && isBoardZone(zone) && opts.keepState);
  if (o.isToken && !isBoardZone(zone) && zone !== 'chain') {
    // detach anything attached to it first (caller handles), then delete
    delete g.objects[id];
    g.timestamp++;
    return false;
  }
  if (newObj && !opts.keepState) {
    o.damage = 0;
    delete g.ex.damageSrc?.[id];
    const tm = o.counters.tokenMight;
    o.counters = {};
    if (tm !== undefined) o.counters.tokenMight = tm;
    o.modifiers = [];
    o.exhausted = false;
    o.stunned = false;
    o.empowered = 0;
    o.combatRole = undefined;
    if (o.attachedTo) { o.attachedTo = undefined; g.ex.attachCount = Math.max(0, (g.ex.attachCount ?? 1) - 1); }
    o.faceDown = false;
    o.hiddenTurn = undefined;
    o.epoch = (o.epoch ?? 0) + 1;
    o.timestamp = ++g.timestamp;
    o.enteredThisTurn = false;
    o.movedThisTurn = false;
    o.movesThisTurn = 0;
  }
  if (!isBoardZone(zone) && zone !== 'chain') o.controller = o.owner;
  if (opts.controller !== undefined) o.controller = opts.controller;
  o.zone = zone;
  if (zone === 'battlefield' || zone === 'facedown') o.battlefieldIndex = opts.bf;
  else delete o.battlefieldIndex;
  if (zone === 'facedown') o.faceDown = true;
  g.timestamp++;
  const arr = arrayFor(g, o, zone);
  if (arr) {
    const pos = opts.position ?? (zone === 'mainDeck' || zone === 'runeDeck' ? 'bottom' : 'bottom');
    if (pos === 'top') arr.unshift(id);
    else if (pos === 'bottom') arr.push(id);
    else arr.splice(pos, 0, id);
  }
  return true;
}

/** Change a permanent's board location (base <-> battlefield) without making it a new object. */
export function setLocation(g: GameState, id: ObjId, loc: Loc): void {
  const o = g.objects[id];
  g.timestamp++;
  detachFromArrays(g, id);
  if (loc === 'base') { o.zone = 'base'; delete o.battlefieldIndex; g.players[o.controller].base.push(id); }
  else { o.zone = 'battlefield'; o.battlefieldIndex = loc; }
}

/** Fix up player arrays after a controller change of a board object. */
export function reseat(g: GameState, id: ObjId): void {
  const o = g.objects[id];
  if (o.zone === 'base') { detachFromArrays(g, id); g.players[o.controller].base.push(id); }
  if (o.zone === 'runePool') { detachFromArrays(g, id); g.players[o.controller].runesInPlay.push(id); }
}

export function locOf(g: GameState, id: ObjId): Loc | null {
  const o = g.objects[id];
  if (!o) return null;
  if (o.zone === 'base') return 'base';
  if (o.zone === 'battlefield' || o.zone === 'facedown') return o.battlefieldIndex ?? null;
  return null;
}

export function sameLoc(g: GameState, a: ObjId, b: ObjId): boolean {
  const la = locOf(g, a), lb = locOf(g, b);
  if (la === null || lb === null) return false;
  if (la === 'base' || lb === 'base') return la === lb && g.objects[a].controller === g.objects[b].controller;
  return la === lb;
}

export function isBattlefieldCard(g: GameState, id: ObjId): boolean {
  return g.battlefields.some(b => b.objId === id);
}

export function bfIndexOfCard(g: GameState, id: ObjId): number {
  return g.battlefields.findIndex(b => b.objId === id);
}

/** Permanents (units+gear, not battlefield cards) at a battlefield index. */
export function permanentsAt(g: GameState, bf: number): ObjId[] {
  const out: ObjId[] = [];
  const bfObj = g.battlefields[bf]?.objId;
  for (const id in g.objects) {
    const o = g.objects[id];
    if (o.zone === 'battlefield' && o.battlefieldIndex === bf && id !== bfObj) out.push(id);
  }
  return out;
}

export function facedownAt(g: GameState, bf: number): ObjId | null {
  for (const id in g.objects) {
    const o = g.objects[id];
    if (o.zone === 'facedown' && o.battlefieldIndex === bf) return id;
  }
  return null;
}

export function boardPermanents(g: GameState): ObjId[] {
  const out: ObjId[] = [];
  for (const id in g.objects) {
    const o = g.objects[id];
    if ((o.zone === 'base') || (o.zone === 'battlefield' && !isBattlefieldCard(g, id))) out.push(id);
  }
  return out;
}

export function locLabel(g: GameState, loc: Loc | null, viewer?: PlayerId): string {
  if (loc === null) return 'nowhere';
  if (loc === 'base') return 'base';
  const b = g.battlefields[loc];
  return b ? (g.cards[g.objects[b.objId].cardId]?.name ?? `battlefield ${loc}`) : `battlefield ${loc}`;
}

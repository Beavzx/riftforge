// Small helpers shared by engine modules.
import type { GameState, PlayerId, GameObject, ObjId, LogEntry } from './types.ts';

export class EngineError extends Error {
  constructor(msg: string) { super(msg); this.name = 'EngineError'; }
}

export function obj(g: GameState, id: ObjId): GameObject {
  const o = g.objects[id];
  if (!o) throw new EngineError(`unknown object ${id}`);
  return o;
}

export function tryObj(g: GameState, id: ObjId | undefined | null): GameObject | undefined {
  return id ? g.objects[id] : undefined;
}

export function log(g: GameState, player: PlayerId | null, text: string, ref?: ObjId[]): void {
  const e: LogEntry = { turn: g.turn, player, text };
  if (ref && ref.length) e.ref = ref;
  g.log.push(e);
}

export function activePlayers(g: GameState): PlayerId[] {
  return g.players.filter(p => !p.conceded).map(p => p.id);
}

/** Next non-conceded player after p in turn order. */
export function nextPlayer(g: GameState, p: PlayerId): PlayerId {
  const n = g.players.length;
  for (let i = 1; i <= n; i++) {
    const q = ((p + i) % n) as PlayerId;
    if (!g.players[q].conceded) return q;
  }
  return p;
}

/** Players in turn order starting with the turn player (CR 303.2). */
export function turnOrderFrom(g: GameState, start: PlayerId = g.activePlayer): PlayerId[] {
  const out: PlayerId[] = [];
  const n = g.players.length;
  for (let i = 0; i < n; i++) {
    const q = ((start + i) % n) as PlayerId;
    if (!g.players[q].conceded) out.push(q);
  }
  return out;
}

export function opponents(g: GameState, p: PlayerId): PlayerId[] {
  if (g.mode === '2v2') return activePlayers(g).filter(q => q % 2 !== p % 2);
  return activePlayers(g).filter(q => q !== p);
}

/** p and their teammates (2v2 teams by seat parity, CR 491.2); just [p] in other modes. */
export function teamOf(g: GameState, p: PlayerId): PlayerId[] {
  if (g.mode !== '2v2') return [p];
  return g.players.map(q => q.id).filter(q => q % 2 === p % 2);
}

export function isOpponent(g: GameState, a: PlayerId, b: PlayerId): boolean {
  if (a === b) return false;
  if (g.mode === '2v2') return a % 2 !== b % 2;
  return true;
}

/** Deep copy with structuredClone's semantics for the plain JSON-like data the engine keeps in state: own enumerable
 *  keys in order (undefined-valued keys kept), and objects reachable by two paths stay shared in the copy (the state
 *  relies on that, e.g. a chain item's choices.paid and choices.playEvent.paid). Anything that is not a plain object or
 *  packed plain array (Map, Set, Date, class instances, typed arrays, sparse arrays, arrays with extra keys) goes to
 *  structuredClone, and so does anything uncloneable (functions, symbols: those throw, as before).
 *  Several times faster than structuredClone on game states (PERF, 2026-11-27; tools/perf-state-shape.ts). */
export function clone<T>(x: T): T {
  if (typeof x !== 'object' || x === null) return typeof x === 'function' || typeof x === 'symbol' ? structuredClone(x) : x;
  return cloneInner(x, new Map()) as T;
}

function cloneInner(x: object, seen: Map<object, unknown>): unknown {
  const done = seen.get(x);
  if (done !== undefined) return done;
  if (Array.isArray(x)) {
    const n = x.length;
    let keys = 0;
    for (const _k in x) keys++;          // holes or extra (non-index) keys make this differ from n
    if (keys !== n) return slowClone(x, seen);
    const out: unknown[] = [];
    seen.set(x, out);
    for (let i = 0; i < n; i++) {
      const v = x[i];
      out.push(typeof v === 'object' && v !== null ? cloneInner(v, seen) : typeof v === 'function' || typeof v === 'symbol' ? structuredClone(v) : v);
    }
    return out;
  }
  if (Object.getPrototypeOf(x) !== Object.prototype) return slowClone(x, seen);
  const out: Record<string, unknown> = {};
  seen.set(x, out);
  for (const k of Object.keys(x)) {
    const v = (x as Record<string, unknown>)[k];
    out[k] = typeof v === 'object' && v !== null ? cloneInner(v, seen) : typeof v === 'function' || typeof v === 'symbol' ? structuredClone(v) : v;
  }
  return out;
}

/** Rare shapes (never seen in real states): structuredClone that subtree. */
function slowClone(x: object, seen: Map<object, unknown>): unknown {
  const c = structuredClone(x);
  seen.set(x, c);
  return c;
}

export function cardName(g: GameState, id: ObjId): string {
  const o = g.objects[id];
  if (!o) return id;
  const d = g.cards[o.cardId];
  return d ? d.name : o.cardId;
}

export function combinations<T>(arr: T[], k: number): T[][] {
  const out: T[][] = [];
  const rec = (start: number, acc: T[]) => {
    if (acc.length === k) { out.push(acc.slice()); return; }
    for (let i = start; i < arr.length; i++) { acc.push(arr[i]); rec(i + 1, acc); acc.pop(); }
  };
  rec(0, []);
  return out;
}

export function binom(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
}

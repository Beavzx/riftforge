// Wire protocol for host-authoritative online play. Every message is absolute; anything received is untrusted.
import type { Action, CardId, DeckList, GameState, PlayerId, PlayerView } from '../engine/types';
import { type MatchOptions, type MatchState, isMatchState } from './match';

export const PROTO = 1;

export interface SeatInfo { cid: string; name: string; ready: boolean; deckName?: string; deckOk?: boolean; connected?: boolean }
export type Msg =
  | { t: 'hello'; cid: string; name: string; v: number; gid?: string }
  | { t: 'lobby'; cid: string; host: string; seats: SeatInfo[]; gid: string | null; started: boolean; opts?: MatchOptions; match?: MatchState }
  | { t: 'ready'; cid: string; ready: boolean; deck?: DeckList; deckName?: string; printings?: Record<CardId, string>; manualPay?: boolean }
  | { t: 'start'; cid: string; gid: string; seats: [string, string]; names: [string, string]; to?: string; match?: MatchState; printings?: (Record<CardId, string> | null)[] }
  | { t: 'next'; cid: string; gid: string; first: boolean }
  | { t: 'view'; cid: string; gid: string; to: string; ver: number; ack: number; view: PlayerView; match?: MatchState }
  | { t: 'act'; cid: string; gid: string; seq: number; ver: number; action: Action }
  | { t: 'err'; cid: string; gid: string; to: string; seq: number; msg: string }
  | { t: 'sync'; cid: string; gid: string; have: number }
  | { t: 'hb'; cid: string; gid: string | null; ver: number; role: 'host' | 'guest' }
  | { t: 'kick'; cid: string; to: string; reason: string }
  | { t: 'bye'; cid: string; reason?: string };

const isStr = (x: unknown, max = 200): x is string => typeof x === 'string' && x.length <= max;
const isInt = (x: unknown, lo = 0, hi = 1e9): x is number => typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi;
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const isSeat = (x: unknown): x is PlayerId => x === 0 || x === 1 || x === 2 || x === 3;
const strArr = (x: unknown, max: number, smax = 64) => Array.isArray(x) && x.length <= max && x.every(s => isStr(s, smax));

export function parseMsg(raw: Record<string, unknown>): Msg | null {
  const m = raw;
  if (!isStr(m.t, 16) || !isStr(m.cid, 64)) return null;
  switch (m.t) {
    case 'hello': return isStr(m.name, 40) && isInt(m.v) ? m as unknown as Msg : null;
    case 'lobby': return (m.match === undefined || isMatchState(m.match)) && isStr(m.host, 64) && Array.isArray(m.seats) && m.seats.length <= 8 && m.seats.every(s => isObj(s) && isStr(s.cid, 64) && isStr(s.name, 40)) && typeof m.started === 'boolean' ? m as unknown as Msg : null;
    case 'ready': return typeof m.ready === 'boolean' && (m.deck === undefined || isDeck(m.deck)) && (m.printings === undefined || isPrintMap(m.printings)) && (m.manualPay === undefined || typeof m.manualPay === 'boolean') ? m as unknown as Msg : null;
    case 'start': return isStr(m.gid, 64) && strArr(m.seats, 2) && (m.seats as unknown[]).length === 2 && strArr(m.names, 2, 40) && (m.match === undefined || isMatchState(m.match))
      && (m.printings === undefined || (Array.isArray(m.printings) && m.printings.length <= 4 && m.printings.every(p => p === null || isPrintMap(p)))) ? m as unknown as Msg : null;
    case 'next': return isStr(m.gid, 64) && typeof m.first === 'boolean' ? m as unknown as Msg : null;
    case 'view': return isStr(m.gid, 64) && isStr(m.to, 64) && isInt(m.ver) && isInt(m.ack) && isView(m.view) && (m.match === undefined || isMatchState(m.match)) ? m as unknown as Msg : null;
    case 'act': return isStr(m.gid, 64) && isInt(m.seq) && isInt(m.ver) && isAction(m.action) ? m as unknown as Msg : null;
    case 'err': return isStr(m.gid, 64) && isStr(m.to, 64) && isInt(m.seq) && isStr(m.msg, 500) ? m as unknown as Msg : null;
    case 'sync': return isStr(m.gid, 64) && isInt(m.have) ? m as unknown as Msg : null;
    case 'hb': return isInt(m.ver) && (m.role === 'host' || m.role === 'guest') ? m as unknown as Msg : null;
    case 'kick': return isStr(m.to, 64) && isStr(m.reason, 200) ? m as unknown as Msg : null;
    case 'bye': return m as unknown as Msg;
  }
  return null;
}

/** {cardId: printedCode}; both sides plain codes (they become image paths on the other client). */
export function isPrintMap(x: unknown): x is Record<CardId, string> {
  if (!isObj(x)) return false;
  const e = Object.entries(x);
  return e.length <= 120 && e.every(([k, v]) => /^[a-z0-9][a-z0-9-]{0,47}$/.test(k) && typeof v === 'string' && /^[a-z0-9][a-z0-9-]{0,47}$/.test(v));
}

export function isDeck(d: unknown): d is DeckList {
  if (!isObj(d)) return false;
  return isStr(d.legend, 64) && isStr(d.champion, 64) && strArr(d.main, 80) && strArr(d.runes, 20) && strArr(d.battlefields, 6) && (d.sideboard === undefined || strArr(d.sideboard, 20));
}

const ACTION_TYPES = new Set(['choose', 'playCard', 'activate', 'move', 'hide', 'pass', 'endTurn', 'assignDamage', 'concede', 'cancel']);   // cancel: UI-CANCEL
export function isAction(a: unknown): a is Action {
  if (!isObj(a) || !isStr(a.type, 20) || !ACTION_TYPES.has(a.type) || !isSeat(a.player)) return false;
  try { if (JSON.stringify(a).length > 20_000) return false; } catch { return false; }
  switch (a.type) {
    case 'choose': return strArr(a.optionIds, 200, 200);
    case 'playCard': case 'activate': case 'hide': return isStr(a.obj, 64);
    case 'move': return strArr(a.units, 60) && (a.to === 'base' || isInt(a.to, 0, 16));
    case 'assignDamage': return isObj(a.assignment) && Object.values(a.assignment).every(v => isInt(v, 0, 1000));
    default: return true;
  }
}

export function isView(v: unknown): v is PlayerView {
  if (!isObj(v) || !isSeat(v.you) || !Array.isArray(v.legal) || v.legal.length > 5000 || !v.legal.every(isAction)) return false;
  const s = v.state as Record<string, unknown>;
  if (!isObj(s) || !Array.isArray(s.players) || s.players.length < 2 || s.players.length > 4 || !isObj(s.objects) || !Array.isArray(s.battlefields)) return false;
  if (!isInt(s.turn) || !isStr(s.phase, 20) || !Array.isArray(s.chain) || !Array.isArray(s.log)) return false;
  for (const p of s.players as unknown[]) {
    if (!isObj(p) || !isInt(p.points, 0, 1000) || !isStr(p.name, 60) || !Array.isArray(p.hand) || !Array.isArray(p.mainDeck) || !Array.isArray(p.base)) return false;
  }
  for (const o of Object.values(s.objects as object)) if (!isObj(o) || !isStr(o.id, 64) || !isStr(o.cardId, 64) || !isStr(o.zone, 20)) return false;
  if (v.pending !== null && !(isObj(v.pending) && isStr((v.pending as Record<string, unknown>).kind, 30) && isSeat((v.pending as Record<string, unknown>).player))) return false;
  return true;
}

/** Shrink a view for the wire: card defs are re-hydrated from the local DB, log is trimmed. */
export function packView(view: PlayerView, logKeep = 120): PlayerView {
  const st = { ...view.state, cards: {} as GameState['cards'], log: view.state.log.slice(-logKeep) } as GameState;
  delete (st as Partial<GameState>).ex; // engine-internal (may embed unredacted replay state)
  return { ...view, state: st };
}
export function unpackView(view: PlayerView, db: Record<CardId, GameState['cards'][string]>): PlayerView {
  const cards: GameState['cards'] = {};
  for (const o of Object.values(view.state.objects)) if (db[o.cardId]) cards[o.cardId] = db[o.cardId];
  return { ...view, state: { ...view.state, cards, ex: {} as GameState['ex'] } };
}

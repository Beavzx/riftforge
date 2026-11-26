// Indexes PlayerView.legal so the board can highlight only legal interactions.
import type { Action, Decision, DecisionOption, GameState, ObjId, PlayerView } from '../engine/types';

export interface LegalIndex {
  play: Map<ObjId, Action[]>;        // playCard + hide, per object
  activate: Map<ObjId, Action[]>;
  moves: Extract<Action, { type: 'move' }>[];
  movable: Set<ObjId>;
  pass?: Action; endTurn?: Action; concede?: Action;
  /** UI-CANCEL: back out of the play being made (offered next to its prompt; Esc) */
  cancel?: Action;
  choose: Extract<Action, { type: 'choose' }>[];
  assign: Extract<Action, { type: 'assignDamage' }>[];
  other: Action[];
}

export function indexLegal(legal: Action[]): LegalIndex {
  const idx: LegalIndex = { play: new Map(), activate: new Map(), moves: [], movable: new Set(), choose: [], assign: [], other: [] };
  for (const a of legal) {
    switch (a.type) {
      case 'playCard': case 'hide': push(idx.play, a.obj, a); break;
      case 'activate': push(idx.activate, a.obj, a); break;
      case 'move': idx.moves.push(a); a.units.forEach(u => idx.movable.add(u)); break;
      case 'pass': idx.pass = a; break;
      case 'endTurn': idx.endTurn = a; break;
      case 'concede': idx.concede = a; break;
      case 'cancel': idx.cancel = a; break;
      case 'choose': idx.choose.push(a); break;
      case 'assignDamage': idx.assign.push(a); break;
      default: idx.other.push(a);
    }
  }
  return idx;
}
const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => { const a = m.get(k); if (a) a.push(v); else m.set(k, [v]); };

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every(x => b.includes(x));

/** Destinations reachable by moving exactly this group of units (exact enumerated move, or each unit individually). */
export function moveDestinations(idx: LegalIndex, units: ObjId[]): (number | 'base')[] {
  if (!units.length) return [];
  const out = new Set<number | 'base'>();
  for (const m of idx.moves) if (sameSet(m.units, units)) out.add(m.to);
  const tos = new Set(idx.moves.map(m => m.to));
  for (const to of tos) if (units.every(u => idx.moves.some(m => m.to === to && m.units.includes(u)))) out.add(to);
  return [...out];
}
export function findMove(idx: LegalIndex, units: ObjId[], to: number | 'base'): { action: Action; exact: boolean } | null {
  const exact = idx.moves.find(m => m.to === to && sameSet(m.units, units));
  if (exact) return { action: exact, exact: true };
  if (moveDestinations(idx, units).includes(to)) return { action: { type: 'move', player: idx.moves[0].player, units: [...units], to }, exact: false };
  return null;
}

/** Find the enumerated choose action for these option ids (order-insensitive unless ordered). */
export function findChoose(idx: LegalIndex, ids: string[], ordered = false): Action | null {
  return idx.choose.find(c => ordered ? c.optionIds.join('|') === ids.join('|') : sameSet(c.optionIds, ids)) ?? null;
}

/** Map a decision option to a battlefield index, if it refers to one. */
export function optionBattlefield(opt: DecisionOption, s: GameState): number | 'base' | null {
  const d = opt.data as Record<string, unknown> | number | string | undefined;
  if (typeof d === 'number') return d;
  if (d === 'base' || opt.id === 'base') return 'base';
  if (d && typeof d === 'object') {
    for (const k of ['battlefieldIndex', 'battlefield', 'index', 'destination', 'to']) {
      const v = d[k]; if (typeof v === 'number') return v; if (v === 'base') return 'base';
    }
  }
  const m = /^(?:bf|battlefield)[:\-_]?(\d+)$/i.exec(opt.id); if (m) return +m[1];
  if (opt.objIds?.length === 1) { const i = s.battlefields.findIndex(b => b.objId === opt.objIds![0]); if (i >= 0) return i; }
  return null;
}

export const isMine = (v: PlayerView) => !!v.pending && v.pending.player === v.you;
export const optionObjs = (d: Decision | null) => {
  const m = new Map<ObjId, string>();
  for (const o of d?.options ?? []) for (const id of o.objIds ?? []) if (!m.has(id)) m.set(id, o.id);
  return m;
};

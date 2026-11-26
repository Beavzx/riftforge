// ENCODE: candidate-action encoder for a pointer-style policy head.
//
// Each legal action becomes one feature row (ACTION.dim floats) plus up to MAX_PTRS pointers into the observation's
// entity rows. A pointer is (entity row | -1, role, value): -1 = the referenced object has no row (hidden from the
// player, e.g. a random card of an opponent's hand) — the role still tells the network something is referenced.
// The policy scores each row (row features + pooled pointed-at entity embeddings) and softmaxes over the list.
//
// encodeSubChoices() encodes the factored sub-choice options of src/ai/env/ (another agent's layer) in the same layout
// (type "subChoice"), so one head can score engine actions and sub-choices alike.
import type { Action, Decision, DecisionKind, GameState, ObjId, PlayerId } from '../../engine/types.ts';
import { abilityByIndex } from '../../engine/chars.ts';
import { DECISION_KINDS, MAX_BF, ZONES, observedState, type Observation } from './obs.ts';

export const MAX_PTRS = 12;
export const LABEL_BUCKETS = 48;
export const ACTION_TYPES = ['choose', 'playCard', 'activate', 'move', 'hide', 'pass', 'endTurn', 'assignDamage', 'concede', 'cancel', 'subChoice'] as const;
export const PTR_ROLES = ['none', 'source', 'option', 'moved', 'destination', 'payExhaust', 'payRecycle', 'damage', 'pendingSource',
  'picked', 'assigned', 'current'] as const;
export const SUB_KINDS = ['engine', 'pickCards', 'moveUnits', 'assignDamage', 'payment'] as const;
export const ABILITY_BUCKETS = ['ab0', 'ab1', 'ab2', 'ab3+', 'equip', 'empower', 'runeExhaust', 'runeRecycle', 'abOther'] as const;
const ROLE = Object.fromEntries(PTR_ROLES.map((r, i) => [r, i])) as Record<(typeof PTR_ROLES)[number], number>;

function layout(names: string[]) { const at: Record<string, number> = {}; names.forEach((n, i) => { at[n] = i; }); return { names, at, dim: names.length }; }
export const ACTION = layout([
  ...ACTION_TYPES.map(t => `type:${t}`),
  ...DECISION_KINDS.map(k => `dk:${k}`), 'dk:inStep', 'dk:min', 'dk:max', 'dk:nOptions',
  'dest:none', 'dest:base', ...Array.from({ length: MAX_BF }, (_, i) => `dest:bf${i}`),
  ...ZONES.map(z => `from:${z}`),
  'play:mode', 'play:x', 'play:hidden',
  ...ABILITY_BUCKETS.map(b => `ability:${b}`), 'ability:isAdd', 'ability:reaction',
  'move:n', 'pay:has', 'pay:exhaust', 'pay:recycle',
  'choose:n', 'choose:empty', 'choose:pos', 'choose:value', 'choose:hasValue', 'choose:yes', 'choose:no', 'choose:done',
  'choose:hasObj', 'choose:all',
  ...SUB_KINDS.map(k => `sub:${k}`), 'sub:step', 'sub:picked', 'sub:min', 'sub:max', 'sub:total', 'sub:assigned', 'sub:remaining',
  'sub:valueBase', 'sub:valueStr', 'sub:passThrough',
  'dmg:total', 'dmg:targets', 'dmg:lethalHits', 'dmg:matchesSuggested',
  'ptr:n', 'ptr:overflow', 'ptr:unknown',
  ...Array.from({ length: LABEL_BUCKETS }, (_, i) => `label:${i}`),
]);

export interface EncodedActions {
  n: number;
  feats: Float32Array;     // n * ACTION.dim
  ptrIdx: Int32Array;      // n * MAX_PTRS, entity row or -1
  ptrRole: Int32Array;     // n * MAX_PTRS, PTR_ROLES index (0 = unused slot)
  ptrVal: Float32Array;    // n * MAX_PTRS, role-specific value (damage amount / 10), else 0
}

/** Structural mirror of src/ai/env/factored.ts SubOption / SubPartial / SubChoice (kept local: no import cycle). */
export interface SubChoiceOption { id?: string; label: string; objIds?: ObjId[]; value?: number | string; isDone?: boolean; action?: Action }
export interface SubChoicePartial {
  picked?: string[]; destination?: number | 'base'; assignment?: Record<ObjId, number>; current?: ObjId; total?: number; min?: number; max?: number;
}
export interface SubChoice {
  kind: string; decision?: DecisionKind; player?: PlayerId; prompt?: string; step?: number;
  partial?: SubChoicePartial | unknown[]; options: SubChoiceOption[];
}

// FNV-1a word hashing -> averaged bag of words over LABEL_BUCKETS (labels/modes vary by card; hashing keeps them stable)
function hashWord(w: string): number { let h = 0x811c9dc5; for (let i = 0; i < w.length; i++) { h ^= w.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0) % LABEL_BUCKETS; }
const LABEL_CACHE = new Map<string, number[]>();
function labelBuckets(label: string): number[] {
  let b = LABEL_CACHE.get(label);
  if (!b) { b = (label.toLowerCase().match(/[a-z0-9+\-']+/g) ?? []).map(hashWord); if (LABEL_CACHE.size < 50000) LABEL_CACHE.set(label, b); }
  return b;
}
function addLabel(f: Float32Array, off: number, labels: string[]) {
  let n = 0; for (const l of labels) n += labelBuckets(l).length;
  if (!n) return;
  for (const l of labels) for (const k of labelBuckets(l)) f[off + ACTION.at[`label:${k}`]] += 1 / n;
}

const clip = (x: number, hi: number) => (x > hi ? hi : x < -hi ? -hi : x) / hi;

function destSlot(to: number | 'base' | undefined): string {
  if (to === undefined) return 'dest:none';
  if (to === 'base') return 'dest:base';
  return to < MAX_BF ? `dest:bf${to}` : 'dest:none';
}
function abilityBucket(i: number): string {
  if (i === 900) return 'ability:equip'; if (i === 901) return 'ability:empower';
  if (i === 950) return 'ability:runeExhaust'; if (i === 951) return 'ability:runeRecycle';
  if (i >= 900) return 'ability:abOther'; return `ability:${i >= 3 ? 'ab3+' : `ab${i}`}`;
}

class Writer {
  feats: Float32Array; ptrIdx: Int32Array; ptrRole: Int32Array; ptrVal: Float32Array;
  constructor(public n: number, private obs: Observation) {
    this.feats = new Float32Array(n * ACTION.dim); this.ptrIdx = new Int32Array(n * MAX_PTRS).fill(-1);
    this.ptrRole = new Int32Array(n * MAX_PTRS); this.ptrVal = new Float32Array(n * MAX_PTRS);
  }
  private np: number[] = []; private unk: number[] = []; private over: number[] = [];
  set(row: number, name: string, v = 1) { const k = ACTION.at[name]; if (k === undefined) throw new Error(`no action feature ${name}`); this.feats[row * ACTION.dim + k] = v; }
  ptr(row: number, role: number, entity: number, val = 0) {
    const k = this.np[row] ?? 0;
    if (entity < 0) this.unk[row] = (this.unk[row] ?? 0) + 1;
    if (k >= MAX_PTRS) { this.over[row] = (this.over[row] ?? 0) + 1; return; }
    const o = row * MAX_PTRS + k; this.ptrIdx[o] = entity; this.ptrRole[o] = role; this.ptrVal[o] = val; this.np[row] = k + 1;
  }
  obj(row: number, role: number, id: ObjId | undefined, val = 0) { if (id === undefined) return; this.ptr(row, role, this.obs.entityOf.get(id) ?? -1, val); }
  bf(row: number, to: number | 'base' | undefined) { if (typeof to === 'number' && to < MAX_BF) this.ptr(row, ROLE.destination, this.obs.bfEntity[to] ?? -1); }
  finish(): EncodedActions {
    for (let r = 0; r < this.n; r++) { this.set(r, 'ptr:n', clip(this.np[r] ?? 0, MAX_PTRS)); this.set(r, 'ptr:overflow', clip(this.over[r] ?? 0, 8)); this.set(r, 'ptr:unknown', clip(this.unk[r] ?? 0, 8)); }
    return { n: this.n, feats: this.feats, ptrIdx: this.ptrIdx, ptrRole: this.ptrRole, ptrVal: this.ptrVal };
  }
  decision(row: number, d: Decision | null) {
    if (!d) return;
    if (ACTION.at[`dk:${d.kind}`] !== undefined) this.set(row, `dk:${d.kind}`);
    this.set(row, 'dk:inStep', d.inStep ? 1 : 0); this.set(row, 'dk:min', clip(d.min ?? 0, 8)); this.set(row, 'dk:max', clip(d.max ?? 0, 8));
    this.set(row, 'dk:nOptions', clip(d.options?.length ?? 0, 16));
  }
}

interface Ctx { g: GameState; d: Decision | null; optById: Map<string, { o: NonNullable<Decision['options']>[number]; i: number }>;
  suggested?: Record<ObjId, number>; lethalOf: Map<ObjId, number> }

function ctxOf(state: GameState, player: PlayerId): Ctx {
  const { g, pending } = observedState(state, player);
  const d = pending && pending.player === player ? pending : null;
  return {
    g, d, optById: new Map((d?.options ?? []).map((o, i) => [o.id, { o, i }])),
    suggested: (d?.data as { suggested?: Record<ObjId, number> } | undefined)?.suggested,
    lethalOf: new Map(((d?.data as { targets?: { obj: ObjId; lethal: number }[] } | undefined)?.targets ?? []).map(t => [t.obj, t.lethal])),
  };
}

function writeAction(w: Writer, r: number, a: Action, c: Ctx): void {
  const { g, d, optById, suggested, lethalOf } = c;
  w.set(r, `type:${a.type}`); w.decision(r, d);
  if (d?.source) w.obj(r, ROLE.pendingSource, d.source);
  const fromZone = (id: ObjId) => { const z = g.objects[id]?.zone; if (z) w.set(r, `from:${z}`); };
  const pay = (p?: { exhaust?: ObjId[]; recycle?: ObjId[] }) => {
    if (!p) return; const ex = p.exhaust ?? [], rc = p.recycle ?? [];
    w.set(r, 'pay:has'); w.set(r, 'pay:exhaust', clip(ex.length, 8)); w.set(r, 'pay:recycle', clip(rc.length, 8));
    for (const id of ex) w.obj(r, ROLE.payExhaust, id); for (const id of rc) w.obj(r, ROLE.payRecycle, id);
  };
  switch (a.type) {
    case 'playCard':
      w.obj(r, ROLE.source, a.obj); fromZone(a.obj); w.set(r, destSlot(a.destination)); w.bf(r, a.destination);
      if (a.mode !== undefined) { w.set(r, 'play:mode'); addLabel(w.feats, r * ACTION.dim, [String(a.mode)]); }
      if (a.x !== undefined) w.set(r, 'play:x', clip(a.x, 10));
      if (a.hidden) w.set(r, 'play:hidden');
      pay(a.payment); break;
    case 'activate': {
      w.obj(r, ROLE.source, a.obj); fromZone(a.obj); w.set(r, abilityBucket(a.abilityIndex));
      try { const ab = abilityByIndex(g, a.obj, a.abilityIndex)?.ability as { isAdd?: boolean; timing?: string; label?: string } | undefined;
        if (ab?.isAdd) w.set(r, 'ability:isAdd'); if (ab?.timing === 'reaction') w.set(r, 'ability:reaction');
        if (ab?.label) addLabel(w.feats, r * ACTION.dim, [ab.label]);
      } catch { /* ignore */ }
      pay(a.payment); w.set(r, 'dest:none'); break;
    }
    case 'move':
      w.set(r, 'move:n', clip(a.units.length, 6)); w.set(r, destSlot(a.to)); w.bf(r, a.to);
      for (const u of a.units) w.obj(r, ROLE.moved, u); break;
    case 'hide':
      w.obj(r, ROLE.source, a.obj); fromZone(a.obj); w.set(r, destSlot(a.battlefieldIndex)); w.bf(r, a.battlefieldIndex); pay(a.payment); break;
    case 'assignDamage': {
      let tot = 0, kills = 0, n = 0;
      for (const [id, v] of Object.entries(a.assignment)) { if (!v) continue; tot += v; n++; const l = lethalOf.get(id); if (l !== undefined && v >= l) kills++; w.obj(r, ROLE.damage, id, clip(v, 10)); }
      w.set(r, 'dmg:total', clip(tot, 12)); w.set(r, 'dmg:targets', clip(n, 6)); w.set(r, 'dmg:lethalHits', clip(kills, 6));
      if (suggested) w.set(r, 'dmg:matchesSuggested', Object.keys({ ...suggested, ...a.assignment }).every(k => (suggested[k] ?? 0) === (a.assignment[k] ?? 0)) ? 1 : 0);
      break;
    }
    case 'choose': {
      const ids = a.optionIds; const labels: string[] = [];
      w.set(r, 'choose:n', clip(ids.length, 8)); if (!ids.length) w.set(r, 'choose:empty');
      if (d?.options && ids.length === d.options.length && ids.length > 0) w.set(r, 'choose:all');
      ids.forEach((id, k) => {
        const hit = optById.get(id);
        if (k === 0 && hit) w.set(r, 'choose:pos', clip(hit.i, 16));
        if (id === 'yes') w.set(r, 'choose:yes'); if (id === 'no') w.set(r, 'choose:no');
        const num = Number(id); if (k === 0 && id !== '' && Number.isFinite(num) && d?.kind !== 'orderTriggers' && d?.kind !== 'chooseOrder') { w.set(r, 'choose:value', clip(num, 10)); w.set(r, 'choose:hasValue'); }
        if (hit) { labels.push(hit.o.label); if (hit.o.objIds?.length) w.set(r, 'choose:hasObj'); for (const oid of hit.o.objIds ?? []) w.obj(r, ROLE.option, oid); }
        else { labels.push(id); w.obj(r, ROLE.option, g.objects[id] ? id : undefined); }
      });
      // manual payment answers carry the plan in data (src/ai/env payment sub-choices, engine 'payment' decisions)
      const plan = a.data as { exhaust?: ObjId[]; recycle?: ObjId[] } | undefined;
      if (plan && (Array.isArray(plan.exhaust) || Array.isArray(plan.recycle))) pay(plan);
      addLabel(w.feats, r * ACTION.dim, labels); w.set(r, 'dest:none'); break;
    }
    default: w.set(r, 'dest:none');
  }
}

/** Encode the legal action list of `player` (normally getLegalActions(state, player)) against `obs`. */
export function encodeActions(state: GameState, player: PlayerId, legal: Action[], obs: Observation): EncodedActions {
  const c = ctxOf(state, player);
  const w = new Writer(legal.length, obs);
  legal.forEach((a, r) => writeAction(w, r, a, c));
  return w.finish();
}

/** Encode the options of one factored sub-choice (src/ai/env/factored.ts: node.choice) in the action layout.
 *  - pass-through options (option.action) get the full engine-action row, plus the sub-choice context
 *  - other options get type "subChoice": their objIds (role option), value, isDone, label
 *  - every row also carries the decision so far: sub-choice kind + step, pointers to the cards already picked / moved
 *    (role picked), damage already assigned (role assigned, value = amount / 10) and the recipient being decided
 *    (role current), the move destination, and total / assigned / remaining damage. */
export function encodeSubChoices(state: GameState, player: PlayerId, sub: SubChoice, obs: Observation): EncodedActions {
  const c = ctxOf(state, player);
  const w = new Writer(sub.options.length, obs);
  const part: SubChoicePartial = Array.isArray(sub.partial) ? { picked: sub.partial.map(String) } : (sub.partial as SubChoicePartial | undefined) ?? {};
  const picked = part.picked ?? [];
  // picked ids are decision option ids (pickCards) or objIds (moveUnits): resolve to objects
  const pickedObjs: ObjId[] = [];
  for (const id of picked) { const hit = c.optById.get(id); if (hit?.o.objIds?.length) pickedObjs.push(...hit.o.objIds); else if (c.g.objects[id]) pickedObjs.push(id); }
  const assigned = Object.entries(part.assignment ?? {}).filter(([, v]) => v > 0);
  const assignedSum = assigned.reduce((x, [, v]) => x + v, 0);
  sub.options.forEach((o, r) => {
    if (o.action) { writeAction(w, r, o.action, c); w.set(r, 'sub:passThrough'); }
    else {
      w.set(r, 'type:subChoice'); w.decision(r, c.d);
      if (c.d?.source) w.obj(r, ROLE.pendingSource, c.d.source);
      if (o.objIds?.length) { w.set(r, 'choose:hasObj'); for (const id of o.objIds) w.obj(r, ROLE.option, id); }
      w.set(r, 'choose:pos', clip(r, 16));
      if (o.isDone) w.set(r, 'choose:done');
      // a destination: the root "move units to X" options, and every option of a moveUnits sub-choice
      const dest = sub.kind === 'moveUnits' ? part.destination : sub.kind === 'engine' && (o.id ?? '').startsWith('move:') ? o.value as number | 'base' : undefined;
      if (dest !== undefined) { w.set(r, destSlot(dest)); w.bf(r, dest); } else w.set(r, 'dest:none');
      addLabel(w.feats, r * ACTION.dim, [o.label]);
    }
    if (ACTION.at[`sub:${sub.kind}`] !== undefined) w.set(r, `sub:${sub.kind}`);
    if (sub.decision && ACTION.at[`dk:${sub.decision}`] !== undefined) w.set(r, `dk:${sub.decision}`);
    w.set(r, 'sub:step', clip(sub.step ?? 0, 16)); w.set(r, 'sub:picked', clip(picked.length, 8));
    if (part.min !== undefined) w.set(r, 'sub:min', clip(part.min, 8)); if (part.max !== undefined) w.set(r, 'sub:max', clip(part.max, 8));
    if (part.total !== undefined) { w.set(r, 'sub:total', clip(part.total, 12)); w.set(r, 'sub:remaining', clip(part.total - assignedSum, 12)); }
    w.set(r, 'sub:assigned', clip(assignedSum, 12));
    if (typeof o.value === 'number') { w.set(r, 'choose:value', clip(o.value, 10)); w.set(r, 'choose:hasValue'); }
    else if (o.value === 'base') w.set(r, 'sub:valueBase');
    else if (typeof o.value === 'string') { w.set(r, 'sub:valueStr'); addLabel(w.feats, r * ACTION.dim, [o.value]); }
    // the decision so far (after the option's own pointers, so those are never pushed out)
    if (part.current) w.obj(r, ROLE.current, part.current);
    for (const id of pickedObjs) w.obj(r, ROLE.picked, id);
    for (const [id, v] of assigned) w.obj(r, ROLE.assigned, id, clip(v, 10));
  });
  return w.finish();
}

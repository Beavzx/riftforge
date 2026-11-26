// ENUM (task #4): factored action layer for learning agents.
//
// The engine's getLegalActions is complete for small decisions but samples a few big ones (see docs/agents/enum.md):
// standard moves of 6+ units, multi-select decisions with more than 64 combinations, combat damage assignment, and
// payment (only "auto" is listed). This layer never changes engine semantics. For any pending decision it exposes a
// sequence of small SUB-CHOICES, each with a complete finite option list, builds the final engine Action, and checks it
// with validateAction. Decisions the engine already enumerates fully are passed through unchanged (one sub-choice whose
// options carry the engine Action).
//
//   const node = factor(state);                 // null when the game is over / nothing pending
//   node.choice  -> { kind, decision, player, prompt, step, partial, options: [{ id, label, objIds?, value?, isDone?, action? }] }
//   const next = node.pick(i);                  // another FNode, or a final engine Action (already validated)
//
// Completeness (documented in docs/agents/enum.md): every engine-valid answer is reachable, except that (a) combat damage
// beyond lethal on every recipient ("excess") is placed on ONE chosen recipient rather than split, (b) payment plans are
// canonicalised (which runes are recycled is chosen by domain; exhausted runes of a domain are recycled first; which ready
// runes are exhausted for energy is not a choice — it never matters) and dominated plans (recycling more than needed) are
// omitted, (c) converter payments (Ancient Henge) are reached through "auto".
import type { Action, Decision, DecisionKind, DecisionOption, GameState, ObjId, PlayerId } from '../../engine/types.ts';
import { getLegalActions, validateAction } from '../../engine/index.ts';
import { canMoveUnit, canStandardMove } from '../../engine/legal.ts';
import { chars } from '../../engine/chars.ts';
import { locOf, type Loc } from '../../engine/state.ts';
import { binom, cardName } from '../../engine/util.ts';
import { validateAssignment, type AssignTarget } from '../../engine/showdown.ts';
import type { PowerReq } from '../../engine/payment.ts';

export type SubKind = 'engine' | 'pickCards' | 'moveUnits' | 'assignDamage' | 'payment';

export interface SubOption {
  id: string;
  label: string;
  /** objects this option is about (pointer targets for a policy): the card/unit picked, the card played, ... */
  objIds?: ObjId[];
  /** a scalar the option stands for: a destination (battlefield index or 'base'), a damage amount, an option id */
  value?: number | string;
  /** "stop picking / submit what I have" */
  isDone?: boolean;
  /** pass-through options: the engine Action this option submits */
  action?: Action;
}

export interface SubPartial {
  /** option ids / objIds picked so far (pickCards, moveUnits) */
  picked?: string[];
  /** moveUnits: where the units go */
  destination?: Loc;
  /** assignDamage: amounts decided so far, and the recipient being decided now */
  assignment?: Record<ObjId, number>;
  current?: ObjId;
  total?: number;
  /** pickCards: the size range */
  min?: number; max?: number;
}

export interface SubChoice {
  kind: SubKind;
  /** the engine decision this belongs to */
  decision: DecisionKind;
  player: PlayerId;
  prompt: string;
  /** 0 for the first sub-choice of a decision, then 1, 2, ... */
  step: number;
  partial: SubPartial;
  options: SubOption[];
}

export interface FNode {
  choice: SubChoice;
  /** take options[index]: the next sub-choice of the same decision, or the final (validated) engine Action */
  pick(index: number): FNode | Action;
}

export interface FactorOptions {
  /** decisions with at most this many complete answers are listed flat (default 64, the engine's own limit) */
  maxFlat?: number;
  /** list the UI "cancel" action (default false: it only undoes your own play, a no-op loop for an agent) */
  includeCancel?: boolean;
  /** units per destination above which standard moves are factored (default 5, the engine's full-enumeration limit) */
  maxFlatMoveUnits?: number;
}

const DEF: Required<FactorOptions> = { maxFlat: 64, includeCancel: false, maxFlatMoveUnits: 5 };

export function isAction(x: FNode | Action): x is Action { return typeof (x as Action).type === 'string'; }

// ---------------------------------------------------------------- labels

export function locLabel(g: GameState, l: Loc): string {
  if (l === 'base') return 'base';
  const bf = g.battlefields[l];
  return bf ? `${cardName(g, bf.objId)} (battlefield ${l})` : `battlefield ${l}`;
}

function chooseLabel(d: Decision, ids: string[]): string {
  const byId = new Map((d.options ?? []).map(o => [o.id, o.label]));
  return ids.length ? ids.map(i => byId.get(i) ?? i).join(', ') : '(none)';
}

export function actionLabel(g: GameState, a: Action): string {
  const d = g.pending;
  switch (a.type) {
    case 'pass': return 'Pass';
    case 'endTurn': return 'End turn';
    case 'concede': return 'Concede';
    case 'cancel': return 'Cancel';
    case 'playCard': return `Play ${cardName(g, a.obj)}${a.destination !== undefined ? ` to ${locLabel(g, a.destination)}` : ''}`;
    case 'activate': return `Activate ${cardName(g, a.obj)} (ability ${a.abilityIndex})`;
    case 'hide': return `Hide ${cardName(g, a.obj)} at ${locLabel(g, a.battlefieldIndex)}`;
    case 'move': return `Move ${a.units.map(u => cardName(g, u)).join(', ')} to ${locLabel(g, a.to)}`;
    case 'assignDamage': return damageLabel(g, a.assignment);
    case 'choose':
      if (d?.kind === 'payment') return a.optionIds[0] === 'auto' ? 'Auto-pay' : paymentLabel(g, a.data as Plan);
      return d ? chooseLabel(d, a.optionIds) : a.optionIds.join(', ');
  }
}

function actionObjIds(g: GameState, a: Action): ObjId[] | undefined {
  switch (a.type) {
    case 'playCard': case 'activate': case 'hide': return [a.obj];
    case 'move': return a.units;
    case 'assignDamage': return Object.keys(a.assignment).filter(k => (a.assignment[k] ?? 0) > 0);
    case 'choose': {
      const d = g.pending;
      if (d?.kind === 'payment' && a.data) { const p = a.data as Plan; return [...p.recycle, ...p.exhaust]; }
      const byId = new Map((d?.options ?? []).map(o => [o.id, o]));
      const out: ObjId[] = [];
      for (const id of a.optionIds) { const o = byId.get(id); if (o?.objIds) out.push(...o.objIds); else if (g.objects[id]) out.push(id); }
      return out.length ? out : undefined;
    }
    default: return undefined;
  }
}

function actionValue(a: Action): number | string | undefined {
  if (a.type === 'playCard' && a.destination !== undefined) return a.destination;
  if (a.type === 'move') return a.to;
  if (a.type === 'hide') return a.battlefieldIndex;
  if (a.type === 'choose' && a.optionIds.length === 1) return a.optionIds[0];
  return undefined;
}

function engineOption(g: GameState, a: Action, i: number): SubOption {
  return { id: `a${i}`, label: actionLabel(g, a), objIds: actionObjIds(g, a), value: actionValue(a), action: a };
}

// ---------------------------------------------------------------- node builders

function finish(g: GameState, a: Action): Action {
  const err = validateAction(g, a);
  if (err) throw new Error(`factored layer built an invalid action (${err}): ${JSON.stringify(a)}`);
  return a;
}

function flatNode(g: GameState, kind: SubKind, d: Decision, options: SubOption[], step = 0, partial: SubPartial = {}): FNode {
  if (!options.length) throw new Error(`factored layer: no options for ${d.kind} (${d.prompt})`);
  return {
    choice: { kind, decision: d.kind, player: d.player, prompt: d.prompt, step, partial, options },
    pick: (i: number) => {
      const o = options[i];
      if (!o?.action) throw new Error(`factored layer: bad option index ${i}`);
      return finish(g, o.action);
    },
  };
}

/** The factored decision for the current pending decision, or null when nothing is pending / the game is over. */
export function factor(g: GameState, opts: FactorOptions = {}): FNode | null {
  const o = { ...DEF, ...opts };
  const d = g.pending;
  if (!d || g.winner !== null) return null;
  if (!d.inStep) return topLevel(g, d, o);
  if (d.kind === 'assignDamage') return damageNode(g, d, o);
  if (d.kind === 'payment') return paymentNode(g, d, o);
  const legal = getLegalActions(g, d.player).filter(a => o.includeCancel || a.type !== 'cancel');
  const opts2 = d.options ?? [];
  const min = d.min ?? 1, max = Math.min(d.max ?? 1, opts2.length);
  let total = 0;
  for (let k = min; k <= max; k++) total += binom(opts2.length, k);
  const custom = d.data?.validator as string | undefined;
  if (custom || total <= o.maxFlat) {
    // complete: the engine enumerated every combination and filtered them with the validator
    const cancel = legal.filter(a => a.type === 'cancel');
    return flatNode(g, 'engine', d, [...legal.filter(a => a.type !== 'cancel'), ...cancel].map((a, i) => engineOption(g, a, i)));
  }
  return pickNode(g, d, [], 0, o);
}

// ---------------------------------------------------------------- top level (main / chain / showdown windows)

function topLevel(g: GameState, d: Decision, o: Required<FactorOptions>): FNode {
  const p = d.player;
  const legal = getLegalActions(g, p).filter(a => o.includeCancel || a.type !== 'cancel');
  // destinations whose standard moves the engine only samples (more than maxFlatMoveUnits movable units)
  const big: Loc[] = [];
  if (legal.some(a => a.type === 'move')) {
    const dests: Loc[] = ['base', ...g.battlefields.map((_, i) => i)];
    for (const to of dests) {
      let n = 0;
      for (const id in g.objects) if (canMoveUnit(g, p, id, to)) n++;
      if (n > o.maxFlatMoveUnits) big.push(to);
    }
  }
  const options: SubOption[] = [];
  let i = 0;
  for (const a of legal) if (!(a.type === 'move' && big.includes(a.to))) options.push(engineOption(g, a, i++));
  for (const to of big) options.push({ id: `move:${to}`, label: `Move units to ${locLabel(g, to)}…`, value: to });
  const choice: SubChoice = { kind: 'engine', decision: d.kind, player: p, prompt: d.prompt, step: 0, partial: {}, options };
  return {
    choice,
    pick: (k: number) => {
      const op = options[k];
      if (!op) throw new Error(`factored layer: bad option index ${k}`);
      if (op.action) return finish(g, op.action);
      return moveNode(g, d, op.value as Loc, [], 1);
    },
  };
}

function moveNode(g: GameState, d: Decision, to: Loc, picked: ObjId[], step: number): FNode {
  const p = d.player;
  const cands: ObjId[] = [];
  for (const id in g.objects) if (!picked.includes(id) && canMoveUnit(g, p, id, to)) cands.push(id);
  cands.sort();
  const options: SubOption[] = [];
  // move costs are non-negative and additive: a set that can't be paid has no payable superset
  for (const u of cands) if (canStandardMove(g, p, [...picked, u], to)) options.push({ id: u, label: `Add ${cardName(g, u)}`, objIds: [u] });
  if (picked.length && canStandardMove(g, p, picked, to)) options.push({ id: 'done', label: `Move ${picked.map(u => cardName(g, u)).join(', ')}`, isDone: true, objIds: [...picked] });
  if (!options.length) throw new Error('factored layer: move sub-choice has no options');
  return {
    choice: { kind: 'moveUnits', decision: d.kind, player: p, prompt: `Move units to ${locLabel(g, to)}`, step, partial: { picked: [...picked], destination: to }, options },
    pick: (k: number) => {
      const op = options[k];
      if (!op) throw new Error(`factored layer: bad option index ${k}`);
      if (op.isDone) return finish(g, { type: 'move', player: p, units: [...picked], to });
      return moveNode(g, d, to, [...picked, op.id], step + 1);
    },
  };
}

// ---------------------------------------------------------------- multi-select ("choose up to N", search, ...)

const locKey = (g: GameState, id: string): string => { const l = locOf(g, id); return l === 'base' ? `b${g.objects[id]?.controller}` : String(l); };

/** Exact completion test for the engine's known checks (none, sameLocation, groupRules); a bounded search otherwise. */
export function pickCompletable(g: GameState, d: Decision, picked: string[]): boolean {
  const all = d.options ?? [];
  const min = d.min ?? 1, max = Math.min(d.max ?? 1, all.length);
  if (picked.length > max) return false;
  const check = d.data?.check as string | undefined;
  const choose = (ids: string[]): Action => ({ type: 'choose', player: d.player, optionIds: ids });
  if (check && check !== 'sameLocation' && check !== 'groupRules') return boundedComplete(g, d, picked, choose);
  const sameLoc = check === 'sameLocation';
  const sameCtl = check === 'groupRules' && !!d.data?.sameController;
  const maxMight = check === 'groupRules' ? d.data?.maxTotalMight as number | undefined : undefined;
  const might = (id: string) => (maxMight === undefined ? 0 : Math.max(0, chars(g, id).might ?? 0));
  const key = (id: string) => `${sameLoc ? locKey(g, id) : ''}|${sameCtl ? String(g.objects[id]?.controller) : ''}`;
  // the picked set itself must satisfy the (monotone) constraints
  if (picked.length) {
    if (new Set(picked.map(key)).size > 1) return false;
    if (maxMight !== undefined && picked.reduce((s, id) => s + might(id), 0) > maxMight) return false;
  }
  const need = min - picked.length;
  if (need <= 0) return true;
  const used = picked.reduce((s, id) => s + might(id), 0);
  const rest = all.map(o => o.id).filter(id => !picked.includes(id));
  const groups = new Map<string, string[]>();
  for (const id of rest) { const k = key(id); groups.set(k, [...(groups.get(k) ?? []), id]); }
  const want = picked.length ? key(picked[0]) : null;
  for (const [k, ids] of groups) {
    if (want !== null && k !== want) continue;
    if (ids.length < need) continue;
    if (maxMight === undefined) return true;
    const sm = ids.map(might).sort((a, b) => a - b).slice(0, need).reduce((s, v) => s + v, 0);
    if (used + sm <= maxMight) return true;
  }
  return false;
}

function boundedComplete(g: GameState, d: Decision, picked: string[], choose: (ids: string[]) => Action): boolean {
  const all = (d.options ?? []).map(o => o.id).filter(id => !picked.includes(id));
  const min = d.min ?? 1, max = Math.min(d.max ?? 1, (d.options ?? []).length);
  let budget = 2000;
  const cur = [...picked];
  const rec = (start: number): boolean => {
    if (budget-- <= 0) return false;
    if (cur.length >= min && cur.length <= max && validateAction(g, choose(cur)) === null) return true;
    if (cur.length >= max) return false;
    for (let i = start; i < all.length; i++) { cur.push(all[i]); const ok = rec(i + 1); cur.pop(); if (ok) return true; }
    return false;
  };
  return rec(0);
}

function pickNode(g: GameState, d: Decision, picked: string[], step: number, o: Required<FactorOptions>): FNode {
  const min = d.min ?? 1, max = Math.min(d.max ?? 1, (d.options ?? []).length);
  const options: SubOption[] = [];
  if (picked.length < max) for (const op of d.options ?? []) {
    if (picked.includes(op.id)) continue;
    if (pickCompletable(g, d, [...picked, op.id])) options.push(pickOption(g, op));
  }
  const doneAct: Action = { type: 'choose', player: d.player, optionIds: [...picked] };
  if (picked.length >= min && validateAction(g, doneAct) === null) options.push({ id: 'done', label: picked.length ? `Done (${chooseLabel(d, picked)})` : 'Done (choose none)', isDone: true });
  if (!options.length) throw new Error(`factored layer: pick sub-choice has no options (${d.prompt})`);
  void o;
  return {
    choice: { kind: 'pickCards', decision: d.kind, player: d.player, prompt: d.prompt, step, partial: { picked: [...picked], min, max }, options },
    pick: (k: number) => {
      const op = options[k];
      if (!op) throw new Error(`factored layer: bad option index ${k}`);
      if (op.isDone) return finish(g, doneAct);
      return pickNode(g, d, [...picked, op.id], step + 1, o);
    },
  };
}

function pickOption(g: GameState, op: DecisionOption): SubOption {
  const objIds = op.objIds ?? (g.objects[op.id] ? [op.id] : undefined);
  return { id: op.id, label: op.label, objIds, value: op.id };
}

// ---------------------------------------------------------------- combat damage assignment

function damageLabel(g: GameState, a: Record<ObjId, number>): string {
  const parts = Object.entries(a).filter(([, v]) => v > 0).map(([k, v]) => `${v} to ${cardName(g, k)}`);
  return parts.length ? parts.join(', ') : 'no damage';
}

/**
 * Every outcome-distinct valid assignment: each live recipient gets 0, exactly lethal, or (at most one) the partial
 * remainder; when every live recipient gets lethal, the excess goes to one chosen recipient. Checked with the engine's
 * validateAssignment (Tank first, Backline last, lethal before moving on).
 */
export function enumerateAssignments(ts: AssignTarget[], total: number, cap = 20000): Record<ObjId, number>[] {
  const out: Record<ObjId, number>[] = [];
  const seen = new Set<string>();
  const push = (a: Record<ObjId, number>) => {
    const clean: Record<ObjId, number> = {};
    for (const t of ts) if ((a[t.obj] ?? 0) > 0) clean[t.obj] = a[t.obj];
    const k = JSON.stringify(clean);
    if (seen.has(k) || validateAssignment(ts, total, clean) !== null) return;
    seen.add(k); out.push(clean);
  };
  if (total <= 0 || ts.length === 0) { push({}); return out; }
  const live = ts.filter(t => t.lethal !== null);
  if (!live.length) { for (const t of ts) push({ [t.obj]: total }); return out; }
  const killed: number[] = [];
  let work = 0;
  const rec = (i: number, used: number) => {
    if (out.length >= cap || ++work > cap * 20) return;
    if (i === live.length) {
      const left = total - used;
      const a: Record<ObjId, number> = {};
      for (const j of killed) a[live[j].obj] = live[j].lethal as number;
      if (left === 0) { push(a); return; }
      if (killed.length === live.length) { for (const t of ts) push({ ...a, [t.obj]: (a[t.obj] ?? 0) + left }); return; }
      // the remainder goes to one live recipient that isn't killed, below its lethal
      for (let j = 0; j < live.length; j++) if (!killed.includes(j) && left < (live[j].lethal as number)) push({ ...a, [live[j].obj]: left });
      return;
    }
    rec(i + 1, used);                                   // not killed
    const l = live[i].lethal as number;
    if (used + l <= total) { killed.push(i); rec(i + 1, used + l); killed.pop(); }
  };
  rec(0, 0);
  return out;
}

function damageNode(g: GameState, d: Decision, o: Required<FactorOptions>): FNode {
  const ts = d.data!.targets as AssignTarget[];
  const total = d.data!.total as number;
  const p = d.player;
  const rows = enumerateAssignments(ts, total);
  const sugg = d.data!.suggested as Record<ObjId, number>;
  if (!rows.length) rows.push(sugg);
  // suggested first (a stable default), then the rest in enumeration order
  const sk = JSON.stringify(sugg);
  rows.sort((a, b) => Number(JSON.stringify(b) === sk) - Number(JSON.stringify(a) === sk));
  const act = (a: Record<ObjId, number>): Action => ({ type: 'assignDamage', player: p, assignment: a });
  if (rows.length <= o.maxFlat) return flatNode(g, 'assignDamage', d, rows.map((a, i) => engineOption(g, act(a), i)));
  // factored: decide recipients one at a time (in the engine's target order), keeping only values some full row has
  return damageStep(g, d, rows, 0, {}, total);
}

function damageStep(g: GameState, d: Decision, rows: Record<ObjId, number>[], ti: number, sofar: Record<ObjId, number>, total: number): FNode {
  const ts = d.data!.targets as AssignTarget[];
  const p = d.player;
  // skip recipients whose amount is already forced
  let i = ti;
  let cur = rows;
  const fixed = { ...sofar };
  while (i < ts.length) {
    const vals = new Set(cur.map(r => r[ts[i].obj] ?? 0));
    if (vals.size > 1) break;
    const v = [...vals][0] ?? 0;
    if (v > 0) fixed[ts[i].obj] = v;
    i++;
  }
  if (i >= ts.length) return { choice: { kind: 'assignDamage', decision: d.kind, player: p, prompt: d.prompt, step: ti, partial: { assignment: fixed, total }, options: [] }, pick: () => finish(g, { type: 'assignDamage', player: p, assignment: cur[0] }) };
  const t = ts[i];
  const vals = [...new Set(cur.map(r => r[t.obj] ?? 0))].sort((a, b) => a - b);
  const options: SubOption[] = vals.map(v => ({
    id: String(v), value: v, objIds: [t.obj],
    label: v === 0 ? `No damage to ${cardName(g, t.obj)}` : t.lethal !== null && v === t.lethal ? `Lethal (${v}) to ${cardName(g, t.obj)}` : t.lethal !== null && v > t.lethal ? `${v} (lethal + excess) to ${cardName(g, t.obj)}` : `${v} to ${cardName(g, t.obj)}`,
  }));
  return {
    choice: { kind: 'assignDamage', decision: d.kind, player: p, prompt: d.prompt, step: i, partial: { assignment: fixed, current: t.obj, total }, options },
    pick: (k: number) => {
      const v = vals[k];
      if (v === undefined) throw new Error(`factored layer: bad option index ${k}`);
      const nextRows = cur.filter(r => (r[t.obj] ?? 0) === v);
      const nf = { ...fixed }; if (v > 0) nf[t.obj] = v;
      if (i + 1 >= ts.length || nextRows.length === 1) return finish(g, { type: 'assignDamage', player: p, assignment: nextRows[0] });
      return damageStep(g, d, nextRows, i + 1, nf, total);
    },
  };
}

// ---------------------------------------------------------------- payment (only asked when GameSetup.manualPay is on)

interface Plan { exhaust: ObjId[]; recycle: ObjId[]; other?: Record<string, unknown> }

function runeDomain(g: GameState, r: ObjId): string { const d = g.cards[g.objects[r].cardId]?.domains?.[0]; return d && d !== 'Colorless' ? d : 'Colorless'; }

function paymentLabel(g: GameState, plan: Plan | undefined): string {
  if (!plan) return 'Choose runes';
  const rc = plan.recycle.map(r => runeDomain(g, r));
  const adds = ((plan.other?.abilities as string[] | undefined) ?? []).map(k => cardName(g, k.split(':')[0]));
  const parts: string[] = [];
  parts.push(`exhaust ${plan.exhaust.length}`);
  if (rc.length) parts.push(`recycle ${rc.join(' + ')}`);
  if (adds.length) parts.push(`use ${adds.join(', ')}`);
  return `Pay: ${parts.join('; ')}`;
}

function* subsets<T>(xs: T[], maxSize: number): Generator<T[]> {
  const n = xs.length;
  const rec = function* (start: number, cur: T[]): Generator<T[]> {
    yield [...cur];
    if (cur.length >= maxSize) return;
    for (let i = start; i < n; i++) { cur.push(xs[i]); yield* rec(i + 1, cur); cur.pop(); }
  };
  yield* rec(0, []);
}

/** Domain multisets of size k drawn from the available counts. */
function domainMultisets(counts: [string, number][], k: number): string[][] {
  const out: string[][] = [];
  const cur: string[] = [];
  const rec = (i: number, left: number) => {
    if (left === 0) { out.push([...cur]); return; }
    if (i >= counts.length) return;
    const [dom, c] = counts[i];
    for (let take = Math.min(c, left); take >= 0; take--) {
      for (let t = 0; t < take; t++) cur.push(dom);
      rec(i + 1, left - take);
      for (let t = 0; t < take; t++) cur.pop();
    }
  };
  rec(0, k);
  return out;
}

/** Every canonical, non-dominated manual payment plan the engine accepts for this payment decision. */
export function enumeratePayments(g: GameState, d: Decision, maxPlans = 256): Plan[] {
  const p = d.player;
  const pl = g.players[p];
  const cost = d.data!.cost as { energy: number; power: PowerReq[] };
  const addKeys = ((d.data!.adds as { key: string }[] | undefined) ?? []).map(a => a.key);
  const runes = [...pl.runesInPlay].sort();
  const byDom = new Map<string, ObjId[]>();
  for (const r of runes) byDom.set(runeDomain(g, r), [...(byDom.get(runeDomain(g, r)) ?? []), r]);
  // within a domain: exhausted runes are recycled first (they can't make energy any more)
  for (const ids of byDom.values()) ids.sort((a, b) => Number(g.objects[b].exhausted) - Number(g.objects[a].exhausted) || (a < b ? -1 : 1));
  const counts: [string, number][] = [...byDom.entries()].map(([k, v]) => [k, v.length]).sort((a, b) => (a[0] < b[0] ? -1 : 1)) as [string, number][];
  const ready = runes.filter(r => !g.objects[r].exhausted);
  const test = (plan: Plan) => validateAction(g, { type: 'choose', player: p, optionIds: ['manual'], data: plan }) === null;
  const build = (adds: string[], recDoms: string[]): Plan | null => {
    const recycle: ObjId[] = [];
    const used = new Map<string, number>();
    for (const dom of recDoms) { const i = used.get(dom) ?? 0; recycle.push(byDom.get(dom)![i]); used.set(dom, i + 1); }
    const other = adds.length ? { abilities: adds } : undefined;
    // exhaust for energy: ready runes being recycled first (never worse, rules-decisions #65), then the others in id order
    const pref = [...ready].sort((a, b) => Number(recycle.includes(b)) - Number(recycle.includes(a)) || (a < b ? -1 : 1));
    for (let e = 0; e <= pref.length; e++) {
      const exhaust = pref.slice(0, e);
      for (const r of recycle) if (!g.objects[r].exhausted && !exhaust.includes(r)) exhaust.push(r);
      const plan: Plan = { exhaust, recycle, ...(other ? { other } : {}) };
      if (test(plan)) return plan;
      if (e > cost.energy + recycle.length + 2) break;
    }
    return null;
  };
  const plans: { adds: string[]; rec: string[]; plan: Plan }[] = [];
  const maxRec = Math.min(cost.power.length, runes.length);
  for (const adds of subsets(addKeys, Math.min(addKeys.length, 4))) {
    for (let k = 0; k <= maxRec; k++) {
      for (const rec of domainMultisets(counts, k)) {
        const plan = build(adds, rec);
        if (plan) plans.push({ adds, rec, plan });
        if (plans.length >= maxPlans * 4) break;
      }
    }
  }
  // drop dominated plans: same adds with a sub-multiset of recycles, or a subset of adds with the same recycles, also works
  const subMulti = (a: string[], b: string[]) => { const m = new Map<string, number>(); for (const x of b) m.set(x, (m.get(x) ?? 0) + 1); for (const x of a) { const c = m.get(x) ?? 0; if (!c) return false; m.set(x, c - 1); } return true; };
  const keep = plans.filter(x => !plans.some(y => y !== x &&
    ((y.adds.length === x.adds.length && y.adds.every(k => x.adds.includes(k)) && y.rec.length < x.rec.length && subMulti(y.rec, x.rec)) ||
     (y.adds.length < x.adds.length && y.adds.every(k => x.adds.includes(k)) && y.rec.length <= x.rec.length && subMulti(y.rec, x.rec)))));
  return keep.slice(0, maxPlans).map(x => x.plan);
}

function paymentNode(g: GameState, d: Decision, o: Required<FactorOptions>): FNode {
  const p = d.player;
  const opts: SubOption[] = [];
  const auto: Action = { type: 'choose', player: p, optionIds: ['auto'] };
  if (validateAction(g, auto) === null) opts.push({ id: 'auto', label: `Auto-pay (${paymentLabel(g, d.data!.suggested as Plan)})`, value: 'auto', action: auto, objIds: [...((d.data!.suggested as Plan).recycle ?? [])] });
  const sig = (pl: Plan) => JSON.stringify([[...pl.recycle].map(r => runeDomain(g, r)).sort(), [...((pl.other?.abilities as string[] | undefined) ?? [])].sort(), pl.recycle.map(r => g.objects[r].exhausted).sort()]);
  const seen = new Set<string>();
  if (d.data!.suggested) seen.add(sig(d.data!.suggested as Plan));
  for (const plan of enumeratePayments(g, d, o.maxFlat)) {
    const k = sig(plan);
    if (seen.has(k)) continue;
    seen.add(k);
    const a: Action = { type: 'choose', player: p, optionIds: ['manual'], data: plan };
    opts.push({ id: `plan${opts.length}`, label: paymentLabel(g, plan), objIds: [...plan.recycle, ...((plan.other?.abilities as string[] | undefined) ?? []).map(k2 => k2.split(':')[0])], value: 'manual', action: a });
  }
  return flatNode(g, 'payment', d, opts.map((x, i) => ({ ...x, id: x.id === 'auto' ? 'auto' : `plan${i}` })));
}

// ---------------------------------------------------------------- driving helpers

/** Drive one decision to its engine Action with a policy over sub-choices (index into choice.options). */
export function decide(g: GameState, policy: (c: SubChoice) => number, opts: FactorOptions = {}): Action | null {
  let n: FNode | Action | null = factor(g, opts);
  let guard = 0;
  while (n && !isAction(n)) {
    if (++guard > 500) throw new Error('factored layer: decision did not finish in 500 sub-choices');
    n = n.pick(policy(n.choice));
  }
  return n;
}

/** A deterministic random policy over sub-choices (for tests and baselines). */
export function randomSubPolicy(rng: () => number, doneBias = 0.3): (c: SubChoice) => number {
  return (c: SubChoice) => {
    const done = c.options.findIndex(o => o.isDone);
    if (done >= 0 && rng() < doneBias) return done;
    return Math.floor(rng() * c.options.length);
  };
}

// Legal action enumeration and validation for the pending decision.
import type { Action, Decision, GameState, ObjId, PlayerId } from './types.ts';
import { playOptions, canPlay, destinations, activatableAbilities, canActivate, hideTargets, canHide, currentWindow, canPayStandardMove, type PlayOption } from './play.ts';
import { abilityByIndex, chars, isUnit, hasKw, allAbilities, abilitySources, withCharsMemo } from './chars.ts';
import { locOf, type Loc } from './state.ts';
import { validateAnswer } from './ask.ts';
import { canEnterBattlefield } from './actions.ts';
import { makeCtx } from './context.ts';
import { getDelayed } from '../cards/registry.ts';
import { combinations, binom } from './util.ts';
import { ruleApplies } from './rules.ts';
import { cancelError } from './cancel.ts';
import { suggestAssignment, type AssignTarget } from './showdown.ts';

// ---------------- movement legality ----------------

function movePermitted(g: GameState, unit: ObjId, from: Loc, to: Loc): boolean {
  if (from === to) return false;
  if (from === 'base' || to === 'base') return true;
  if (hasKw(g, unit, 'Ganking')) return true;      // CR 810
  for (const src of abilitySources(g)) for (const r of allAbilities(g, src)) {
    if (r.ability.kind !== 'movePermission') continue;
    const ctx = makeCtx(g, r.viaHost ?? src, g.objects[r.viaHost ?? src].controller);
    if (r.ability.allows(ctx, unit, from, to)) return true;
  }
  for (const d of g.ex.delayed) { const ab = getDelayed(d.key); if (ab?.kind === 'movePermission' && ab.allows(makeCtx(g, d.source ?? '', d.controller, { data: d.data }), unit, from, to)) return true; }
  return false;
}

export function canMoveUnit(g: GameState, p: PlayerId, unit: ObjId, to: Loc): boolean {
  const o = g.objects[unit];
  if (!o || o.controller !== p || o.exhausted) return false;
  if (!(o.zone === 'base' || o.zone === 'battlefield') || !isUnit(g, unit)) return false;
  const from = locOf(g, unit);
  if (from === null) return false;
  if (typeof to === 'number') { if (!g.battlefields[to] || !canEnterBattlefield(g, to, p)) return false; }
  if (ruleApplies(g, 'cantMove', unit, from, to)) return false;
  return movePermitted(g, unit, from, to);
}

/** Standard Move (CR 144): main phase, neutral open state, own units, exhaust as cost. */
export function canStandardMove(g: GameState, p: PlayerId, units: ObjId[], to: Loc): boolean {
  if (currentWindow(g, p) !== 'main') return false;
  if (units.length === 0 || new Set(units).size !== units.length) return false;
  if (!units.every(u => canMoveUnit(g, p, u, to))) return false;
  return canPayStandardMove(g, p, units, to);      // B2-2: applied move costs must be affordable
}

export function moveOptions(g: GameState, p: PlayerId): Action[] {
  if (currentWindow(g, p) !== 'main') return [];
  const out: Action[] = [];
  const dests: Loc[] = ['base', ...g.battlefields.map((_, i) => i)];
  for (const to of dests) {
    const us: ObjId[] = [];
    for (const id in g.objects) if (canMoveUnit(g, p, id, to)) us.push(id);
    if (us.length === 0) continue;
    if (us.length <= 5) {
      for (let k = 1; k <= us.length; k++) for (const c of combinations(us, k)) if (canPayStandardMove(g, p, c, to)) out.push({ type: 'move', player: p, units: c, to });
    } else {
      for (const u of us) if (canPayStandardMove(g, p, [u], to)) out.push({ type: 'move', player: p, units: [u], to });
      if (canPayStandardMove(g, p, us, to)) out.push({ type: 'move', player: p, units: us, to });
    }
  }
  return out;
}

// ---------------- enumeration ----------------

export function topLevelActions(g: GameState, p: PlayerId): Action[] {
  const w = currentWindow(g, p);
  if (!w) return [];
  const out: Action[] = [];
  out.push(w === 'main' ? { type: 'endTurn', player: p } : { type: 'pass', player: p });
  const seen = new Set<string>();
  for (const opt of playOptions(g, p)) {
    const c = chars(g, opt.obj);
    if (c.type === 'Unit' || c.type === 'Gear') {
      for (const d of destinations(g, p, opt.obj, opt.via)) {
        const k = `${opt.obj}|${d}`;
        if (seen.has(k)) continue;
        if (canPlay(g, p, opt, d)) { seen.add(k); out.push({ type: 'playCard', player: p, obj: opt.obj, destination: d }); }
      }
    } else if (!seen.has(opt.obj) && canPlay(g, p, opt)) { seen.add(opt.obj); out.push({ type: 'playCard', player: p, obj: opt.obj }); }
  }
  for (const a of activatableAbilities(g, p)) out.push({ type: 'activate', player: p, obj: a.obj, abilityIndex: a.index });
  if (w === 'main') {
    out.push(...moveOptions(g, p));
    const bfs = hideTargets(g, p);
    for (const id of [...g.players[p].hand, ...g.players[p].championZone]) for (const bf of bfs) if (canHide(g, p, id, bf)) out.push({ type: 'hide', player: p, obj: id, battlefieldIndex: bf });
  }
  return out;
}

const MAX_COMBOS = 64;

export function inStepActions(g: GameState, d: Decision): Action[] {
  const p = d.player;
  if (d.kind === 'assignDamage') {
    const ts = d.data!.targets as AssignTarget[];
    const total = d.data!.total as number;
    const out: Action[] = [{ type: 'assignDamage', player: p, assignment: d.data!.suggested as Record<ObjId, number> }];
    // a few alternatives: rotate the priority order
    for (let r = 1; r < Math.min(ts.length, 4); r++) {
      const rot = [...ts.slice(r), ...ts.slice(0, r)].map((t, i) => ({ ...t, lethal: t.lethal, groups: t.groups.length > 1 ? t.groups : t.groups, _i: i }));
      const a = suggestAssignmentStable(rot, total);
      if (a) out.push({ type: 'assignDamage', player: p, assignment: a });
    }
    return out.filter(a => validateAnswer(g, d, a) === null);
  }
  if (d.kind === 'payment') return [{ type: 'choose', player: p, optionIds: ['auto'] }];
  const opts = d.options ?? [];
  const min = d.min ?? 1, max = Math.min(d.max ?? 1, opts.length);
  const out: Action[] = [];
  let total = 0;
  for (let k = min; k <= max; k++) total += binom(opts.length, k);
  if (total <= MAX_COMBOS) {
    for (let k = min; k <= max; k++) for (const c of combinations(opts.map(o => o.id), k)) out.push({ type: 'choose', player: p, optionIds: c });
  } else {
    // sample: all singletons/min-sized prefixes, plus "first k" for each k
    for (let k = min; k <= max; k++) out.push({ type: 'choose', player: p, optionIds: opts.slice(0, k).map(o => o.id) });
    if (min <= 1 && max >= 1) for (const o of opts) out.push({ type: 'choose', player: p, optionIds: [o.id] });
    // MS-5 (META-AUDIT): "first k" mixes locations, which the sameLocation validator rejects; sample per location instead
    if (d.data?.check === 'sameLocation') {
      const groups = new Map<string, ObjId[]>();
      for (const o of opts) { const l = locOf(g, o.id); const key = l === 'base' ? `b${g.objects[o.id]?.controller}` : String(l); groups.set(key, [...(groups.get(key) ?? []), o.id]); }
      for (const ids of groups.values()) {
        let n = 0;
        for (let k = Math.max(min, 1); k <= Math.min(max, ids.length); k++) {
          if (binom(ids.length, k) <= MAX_COMBOS - n) { for (const c of combinations(ids, k)) out.push({ type: 'choose', player: p, optionIds: c }); n += binom(ids.length, k); }
          else out.push({ type: 'choose', player: p, optionIds: ids.slice(0, k) });
        }
      }
    }
  }
  return out.filter(a => validateAnswer(g, d, a) === null);
}

function suggestAssignmentStable(ts: AssignTarget[], total: number): Record<ObjId, number> | null {
  // greedy in the given order but respecting group order
  const order = [...ts].sort((x, y) => x.groups[0] - y.groups[0]);
  const a: Record<ObjId, number> = {};
  let left = total;
  for (const t of order) { if (t.lethal === null) continue; const n = Math.min(left, t.lethal); if (n > 0) a[t.obj] = n; left -= n; if (left <= 0) break; }
  if (left > 0) { const f = order.find(t => t.lethal !== null) ?? order[0]; if (!f) return null; a[f.obj] = (a[f.obj] ?? 0) + left; }
  void suggestAssignment;
  return a;
}

export function legalActions(g: GameState, p: PlayerId): Action[] {
  if (g.winner !== null) return [];
  const d = g.pending;
  if (!d || d.player !== p) return [];
  // UI-CANCEL: listed last, so "first legal action" fallbacks never pick it (bots filter it out)
  if (d.inStep) { const out = inStepActions(g, d); if (cancelError(g, p) === null) out.push({ type: 'cancel', player: p }); return out; }
  return withCharsMemo(g, () => topLevelActions(g, p));
}

/** Validate an action against the pending decision. Returns an error message or null. */
export function validate(g: GameState, a: Action): string | null {
  if (g.winner !== null) return 'the game is over';
  if (a.type === 'concede') return g.players[a.player] && !g.players[a.player].conceded ? null : 'invalid player';
  if (a.type === 'cancel') return cancelError(g, a.player);
  return withCharsMemo(g, () => validateInner(g, a));
}

function validateInner(g: GameState, a: Action): string | null {
  const d = g.pending;
  if (!d) return 'nothing is pending';
  if (a.player !== d.player) return `waiting for player ${d.player}`;
  if (d.inStep) return validateAnswer(g, d, a);
  const p = a.player;
  const w = currentWindow(g, p);
  if (!w) return 'you cannot act now';
  switch (a.type) {
    case 'pass': return null;
    case 'endTurn': return w === 'main' ? null : 'you can only end your turn in your main phase (use pass)';
    case 'playCard': {
      const opts: PlayOption[] = playOptions(g, p).filter(o => o.obj === a.obj);
      if (!opts.length) return 'that card cannot be played from where it is';
      return opts.some(o => canPlay(g, p, o, a.destination)) ? null : 'that card cannot be played now (timing, destination, targets or cost)';
    }
    case 'activate': {
      const ref = abilityByIndex(g, a.obj, a.abilityIndex);
      if (!ref || ref.ability.kind !== 'activated') return 'no such ability';
      // F-1: exactly the enumerated set (controller, zone, timing, costs)
      return activatableAbilities(g, p).some(x => x.obj === a.obj && x.index === a.abilityIndex) ? null : 'that ability cannot be activated now';
    }
    case 'move': return canStandardMove(g, p, a.units, a.to) ? null : 'illegal move';
    case 'hide': return canHide(g, p, a.obj, a.battlefieldIndex) ? null : 'cannot hide that card there';
    default: return `unexpected action ${a.type}`;
  }
}

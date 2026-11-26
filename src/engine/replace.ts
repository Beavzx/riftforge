// Replacement effects (CR 367-375). Proposed events pass through applyReplacements before they
// happen. Each replacement applies at most once per event lineage (370.2). When several apply,
// the controller of the affected object (or the affected player) chooses the order (372).
import type { GameEvent, GameState, ObjId, PlayerId } from './types.ts';
import type { ReplacementAbility } from './abilities.ts';
import { abilitySources, allAbilities, abilityController } from './chars.ts';
import { getDelayed } from '../cards/registry.ts';
import { makeCtx } from './context.ts';
import { chooseOne, askYesNo } from './ask.ts';
import { oncePerTurnOk, markUsed } from './events.ts';
import { builtinAbility } from './builtin.ts';
import { cardName } from './util.ts';

interface Cand { id: string; ab: ReplacementAbility; src: ObjId | null; controller: PlayerId; data?: Record<string, unknown>; delayedId?: string; abSrc?: ObjId }

function handles(ab: ReplacementAbility, type: string): boolean {
  return Array.isArray(ab.event) ? ab.event.includes(type) : ab.event === type;
}

function candidates(g: GameState, ev: GameEvent): Cand[] {
  const out: Cand[] = [];
  for (const src of abilitySources(g)) {
    for (const r of allAbilities(g, src)) {
      const ab = r.ability;
      if (ab.kind !== 'replacement' || !handles(ab, ev.type)) continue;
      const self = r.viaHost ?? src;
      const ctrl = abilityController(g, self);
      out.push({ id: `${src}:${r.index}`, ab, src: self, controller: ctrl, ...(r.obj !== self ? { abSrc: r.obj } : {}) });
    }
  }
  for (const d of g.ex.delayed) {
    const ab = d.key.startsWith('builtin:') ? builtinAbility(d.key.slice(8)) : getDelayed(d.key);
    if (!ab || ab.kind !== 'replacement' || !handles(ab, ev.type)) continue;
    out.push({ id: `d:${d.id}`, ab, src: d.source, controller: d.controller, data: d.data, delayedId: d.id });
  }
  return out;
}

function affectedController(g: GameState, ev: GameEvent): PlayerId {
  const o = typeof ev.obj === 'string' ? g.objects[ev.obj] : undefined;
  if (o) return o.controller;
  if (typeof ev.player === 'number') return ev.player as PlayerId;
  return g.activePlayer;
}

/** Would any replacement effect apply to this proposed event (CR 373: used to let a player order simultaneous events)? */
export function hasReplacement(g: GameState, ev: GameEvent): boolean {
  return candidates(g, ev).some(c => {
    const ctx = makeCtx(g, c.src ?? '', c.controller, { event: ev, data: c.data }); if (c.abSrc) ctx.abilitySource = c.abSrc;
    return c.ab.match(ev, ctx) && oncePerTurnOk(g, c.src, 'repl:' + c.id, c.ab.oncePerTurn);
  });
}

/**
 * Bonus Damage that would apply to this proposed damage event (CR 714: all instances summed; 714.1-714.2: never negative).
 * Only replacements that declare `bonus` count. Used for split damage, where the bonus raises the pool (CR 715.3).
 */
export function bonusDamageFor(g: GameState, ev: GameEvent): number {
  let n = 0;
  for (const c of candidates(g, ev)) {
    if (!c.ab.bonus) continue;
    const ctx = makeCtx(g, c.src ?? '', c.controller, { event: ev, data: c.data }); if (c.abSrc) ctx.abilitySource = c.abSrc;
    if (!c.ab.match(ev, ctx) || !oncePerTurnOk(g, c.src, 'repl:' + c.id, c.ab.oncePerTurn)) continue;
    n += Number(c.ab.bonus(ev, ctx)) || 0;
  }
  return Math.max(0, n);
}

/** Would a mandatory "doesn't take damage" replacement (`noDamage`) prevent all of this proposed damage event? */
export function takesNoDamage(g: GameState, ev: GameEvent): boolean {
  return candidates(g, ev).some(c => {
    if (!c.ab.noDamage || c.ab.optional) return false;
    const ctx = makeCtx(g, c.src ?? '', c.controller, { event: ev, data: c.data }); if (c.abSrc) ctx.abilitySource = c.abSrc;
    return c.ab.match(ev, ctx) && oncePerTurnOk(g, c.src, 'repl:' + c.id, c.ab.oncePerTurn);
  });
}

/**
 * Side-effect-free run of the mandatory replacement effects on a proposed damage event: each replacement runs on a copy of its
 * data and optional ones are not applied. `prefer` is an order of candidate ids (CR 373: the affected object's controller
 * chooses); at each step the first applicable candidate in `prefer` applies, else the first applicable one in candidate order.
 * `sig` identifies the outcome: the resulting amount (or 'none' if the event no longer happens) plus each applied
 * replacement's data afterwards (a shield's remaining amount, Counter Strike consumed or not).
 */
function simulateDamage(g: GameState, ev: GameEvent, prefer?: readonly string[]): { amount: number; sig: string; applied: string[] } {
  let cur: GameEvent = ev;
  const applied: string[] = [...((ev._applied as string[] | undefined) ?? [])];   // already applied in this event's lineage (370.2)
  const datas: Record<string, unknown> = {};
  const sig = (amount: string) => `${amount}|${JSON.stringify(Object.keys(datas).sort().map(k => [k, datas[k]]))}`;
  for (let guard = 0; guard < 20; guard++) {
    if (cur.type !== 'damage') return { amount: 0, sig: sig('none'), applied };
    const avail: { c: Cand; ctx: ReturnType<typeof makeCtx> }[] = [];
    for (const c of candidates(g, cur)) {
      if (applied.includes(c.id) || c.ab.optional) continue;
      if (c.ab.bonus && cur.noBonus) continue;
      const ctx = makeCtx(g, c.src ?? '', c.controller, { event: cur, data: c.data ? structuredClone(c.data) : undefined }); if (c.abSrc) ctx.abilitySource = c.abSrc;
      if (!c.ab.match(cur, ctx) || !oncePerTurnOk(g, c.src, 'repl:' + c.id, c.ab.oncePerTurn)) continue;
      avail.push({ c, ctx });
    }
    if (avail.length === 0) break;
    const pick = prefer ? (prefer.map(id => avail.find(a => a.c.id === id)).find(a => a) ?? avail[0]) : avail[0];
    applied.push(pick.c.id);
    const next = pick.c.ab.apply({ ...cur }, pick.ctx);
    datas[pick.c.id] = pick.ctx.data ?? null;
    if (next === null) return { amount: 0, sig: sig('none'), applied };
    cur = next;
  }
  const amount = cur.type === 'damage' ? Math.max(0, Number(cur.amount ?? 0)) : 0;
  return { amount, sig: sig(String(cur.type === 'damage' ? amount : 'none')), applied };
}

/**
 * The amount a proposed damage event would deal after the mandatory replacement effects that apply to it (prevention shields,
 * Counter Strike's "prevent the next", Lotus Trap's doubling, "can't be dealt damage"), without changing the state. Several
 * apply in `prefer` order (the order the unit's controller chose, CR 373), else in candidate order.
 * Used for combat lethal amounts (CR 467.2.c.5: replacement effects apply to the assignment).
 */
export function damageAfterReplacements(g: GameState, ev: GameEvent, prefer?: readonly string[]): number {
  if (ev.type !== 'damage' || Number(ev.amount ?? 0) <= 0) return 0;
  return simulateDamage(g, ev, prefer).amount;
}

/** Mandatory replacement candidates (ids, labels) that apply to this proposed event as it stands. */
export function mandatoryReplacements(g: GameState, ev: GameEvent): { id: string; label: string; src: ObjId | null }[] {
  return candidates(g, ev).filter(c => {
    if (c.ab.optional || (c.ab.bonus && ev.noBonus)) return false;
    const ctx = makeCtx(g, c.src ?? '', c.controller, { event: ev, data: c.data ? structuredClone(c.data) : undefined }); if (c.abSrc) ctx.abilitySource = c.abSrc;
    return c.ab.match(ev, ctx) && oncePerTurnOk(g, c.src, 'repl:' + c.id, c.ab.oncePerTurn);
  }).map(c => ({ id: c.id, label: candLabel(g, c), src: c.src }));
}

function permutations<T>(xs: readonly T[]): T[][] {
  if (xs.length <= 1) return [[...xs]];
  const out: T[][] = [];
  xs.forEach((x, i) => { for (const p of permutations([...xs.slice(0, i), ...xs.slice(i + 1)])) out.push([x, ...p]); });
  return out;
}

/**
 * CR 373: does the order in which the mandatory replacements `ids` apply change the outcome of a damage event of any of these
 * amounts (`mk(n)` builds it)? `prefix` = ids already placed first. More than 5 remaining candidates → assumed to matter.
 */
export function damageOrderMatters(g: GameState, mk: (n: number) => GameEvent, amounts: readonly number[], ids: readonly string[], prefix: readonly string[] = []): boolean {
  if (ids.length < 2) return false;
  if (ids.length > 5) return true;
  const perms = permutations(ids);
  for (const n of amounts) {
    const sigs = new Set(perms.map(p => simulateDamage(g, mk(n), [...prefix, ...p]).sig));
    if (sigs.size > 1) return true;
  }
  return false;
}

function candLabel(g: GameState, c: Cand): string {
  const name = c.src && g.objects[c.src] ? cardName(g, c.src) : null;
  const text = c.ab.text ?? c.id;
  return name ? `${name}: ${text}` : text;
}

/** Returns the event that actually happens (possibly modified / of another type) or null if skipped. */
export function applyReplacements(g: GameState, ev: GameEvent): GameEvent | null {
  let cur: GameEvent = ev;
  for (let guard = 0; guard < 20; guard++) {
    const applied = (cur._applied as string[] | undefined) ?? [];
    const cands = candidates(g, cur).filter(c => {
      if (applied.includes(c.id)) return false;
      if (c.ab.bonus && cur.noBonus) return false;      // CR 715.3: already in the split pool
      const ctx = makeCtx(g, c.src ?? '', c.controller, { event: cur, data: c.data }); if (c.abSrc) ctx.abilitySource = c.abSrc;
      if (!c.ab.match(cur, ctx)) return false;
      if (!oncePerTurnOk(g, c.src, 'repl:' + c.id, c.ab.oncePerTurn)) return false;
      return true;
    });
    if (cands.length === 0) return cur;
    let pick = cands[0];
    // CR 373 for damage: an order the unit's controller already chose for this combat's damage (showdown.ts
    // chooseDamageOrders; it also set the lethal amounts) is used as is; if the mandatory replacements' order can't change
    // the outcome (same amount, same shields left), they apply silently in candidate order
    const pref = cur.type === 'damage' && cur.combat && typeof cur.obj === 'string'
      ? (g.ex.combat as { replOrder?: Record<string, string[]> } | undefined)?.replOrder?.[cur.obj] : undefined;
    const allMandatory = cands.every(c => !c.ab.optional);
    let silent = cands.length === 1;
    if (!silent && allMandatory && pref && cands.every(c => pref.includes(c.id))) {
      pick = pref.map(id => cands.find(c => c.id === id)).find(c => c)!;
      silent = true;
    } else if (!silent && allMandatory && cur.type === 'damage' && cur.combat) {   // non-combat damage still asks (OPEN, ENGINE-9)
      const base = cur;
      silent = !damageOrderMatters(g, () => base, [Number(base.amount ?? 0)], cands.map(c => c.id));
    }
    if (!silent) {
      const chooser = affectedController(g, cur);
      const id = chooseOne(g, chooser, 'chooseOrder', 'Choose which replacement effect applies first',
        cands.map(c => ({ id: c.id, label: candLabel(g, c), objIds: c.src ? [c.src] : [] })));   // CR 373 (RJ#5370)
      pick = cands.find(c => c.id === id)!;
    }
    const ctx = makeCtx(g, pick.src ?? '', pick.controller, { event: cur, data: pick.data }); if (pick.abSrc) ctx.abilitySource = pick.abSrc;
    if (pick.ab.optional) {
      const yes = askYesNo(g, pick.controller, typeof pick.ab.optional === 'string' ? pick.ab.optional : (pick.ab.text ?? 'Apply replacement effect?'), pick.src ?? undefined);
      if (!yes) { cur = { ...cur, _applied: [...applied, pick.id] }; continue; }
    }
    if (pick.ab.oncePerTurn) markUsed(g, pick.src, 'repl:' + pick.id);
    const next = pick.ab.apply({ ...cur }, ctx);
    if (pick.delayedId && ctx.data.__consume) g.ex.delayed = g.ex.delayed.filter(d => d.id !== pick.delayedId);
    if (next === null) return null;
    cur = { ...next, _applied: [...applied, pick.id] };
  }
  return cur;
}

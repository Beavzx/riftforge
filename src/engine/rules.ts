// Rule hooks (card-patterns.md section 6): static "rule" abilities that change how the engine
// applies a rule. The engine calls ruleApplies / ruleValues at the relevant points.
import type { GameState, ObjId, PlayerId } from './types.ts';
import type { RuleAbility, RuleName, CostSpec } from './abilities.ts';
import { abilitySources, allAbilities, abilityController, withCharsMemo, chars } from './chars.ts';
import { getScript, getDelayed } from '../cards/registry.ts';
import { makeCtx } from './context.ts';

interface ActiveRule { ab: RuleAbility; src: ObjId | null; controller: PlayerId; data?: Record<string, unknown>; abSrc?: ObjId }

function activeRules(g: GameState, rule: RuleName, args: unknown[] = []): ActiveRule[] {
  const out: ActiveRule[] = [];
  // rules printed on an object that isn't on the board but is the subject of the check (e.g. "Play me only to ...")
  for (const a of args) {
    if (typeof a !== 'string') continue;
    const o = g.objects[a];
    if (!o || o.zone === 'base' || o.zone === 'battlefield' || o.zone === 'legendZone') continue;
    for (const ab of getScript(o.cardId)?.abilities ?? []) if (ab.kind === 'rule' && ab.rule === rule) out.push({ ab, src: a, controller: o.controller });
  }
  for (const src of abilitySources(g)) {
    const o = g.objects[src];
    // a copy (Shady Spectacles, Mirror Image) has the copied card's rules even when its own card has no script (RJ#12474)
    if (!getScript(o.cardId) && !o.modifiers.some(m => m.grants?.length || m.copyOf) && !chars(g, src).copyOf) continue;
    for (const r of allAbilities(g, src)) {
      if (r.ability.kind !== 'rule' || r.ability.rule !== rule) continue;
      const self = r.viaHost ?? src;
      out.push({ ab: r.ability, src: self, controller: abilityController(g, self), ...(r.obj !== self ? { abSrc: r.obj } : {}) });
    }
  }
  for (const d of g.ex.delayed) {
    const ab = getDelayed(d.key);
    if (ab?.kind === 'rule' && ab.rule === rule) out.push({ ab, src: d.source, controller: d.controller, data: d.data });
  }
  return out;
}

/** True if any active rule ability of this name applies to the arguments. */
export function ruleApplies(g: GameState, rule: RuleName, ...args: unknown[]): boolean {
  // MS-2: rule checks only read the state; characteristics are memoised while they run
  return withCharsMemo(g, () => {
    for (const r of activeRules(g, rule, args)) {
      const ctx = makeCtx(g, r.src ?? '', r.controller, { data: r.data }); if (r.abSrc) ctx.abilitySource = r.abSrc;
      if (!r.ab.applies || r.ab.applies(ctx, ...args)) return true;
    }
    return false;
  });
}

/** Sum of numeric values of active rule abilities (e.g. victoryScoreDelta, extraTriggers). */
export function ruleSum(g: GameState, rule: RuleName, ...args: unknown[]): number {
  return withCharsMemo(g, () => ruleSumNow(g, rule, args));
}
/** extraTriggers for one queued trigger: (1 + copies) × (1 + additional times) − 1 (RuleAbility.copyInstance; RJ#11631). */
export function extraTriggerCount(g: GameState, qt: unknown): number {
  return withCharsMemo(g, () => {
    let copy = 0, more = 0;
    for (const r of activeRules(g, 'extraTriggers', [qt])) {
      const ctx = makeCtx(g, r.src ?? '', r.controller, { data: r.data }); if (r.abSrc) ctx.abilitySource = r.abSrc;
      if (r.ab.applies && !r.ab.applies(ctx, qt)) continue;
      const v = typeof r.ab.value === 'function' ? r.ab.value(ctx, qt) : (r.ab.value ?? 1);
      if (r.ab.copyInstance) copy += v; else more += v;
    }
    return (1 + copy) * (1 + more) - 1;
  });
}
function ruleSumNow(g: GameState, rule: RuleName, args: unknown[]): number {
  let n = 0;
  for (const r of activeRules(g, rule, args)) {
    const ctx = makeCtx(g, r.src ?? '', r.controller, { data: r.data }); if (r.abSrc) ctx.abilitySource = r.abSrc;
    if (r.ab.applies && !r.ab.applies(ctx, ...args)) continue;
    const v = typeof r.ab.value === 'function' ? r.ab.value(ctx, ...args) : (r.ab.value ?? 1);
    n += v;
  }
  return n;
}

/** Costs added by active rule abilities with a `cost` function (moveCost: player, units, to). */
export function ruleCosts(g: GameState, rule: RuleName, ...args: unknown[]): { cost: CostSpec; src: ObjId | null; controller: PlayerId; label?: string }[] {
  const out: { cost: CostSpec; src: ObjId | null; controller: PlayerId; label?: string }[] = [];
  for (const r of activeRules(g, rule, args)) {
    if (!r.ab.cost) continue;
    const ctx = makeCtx(g, r.src ?? '', r.controller, { data: r.data }); if (r.abSrc) ctx.abilitySource = r.abSrc;
    if (r.ab.applies && !r.ab.applies(ctx, ...args)) continue;
    const c = r.ab.cost(ctx, ...args);
    if (c) out.push({ cost: c, src: r.src, controller: r.controller, label: r.ab.text });
  }
  return out;
}

/** Override value (last timestamp wins), e.g. channelCount. */
export function ruleOverride(g: GameState, rule: RuleName, base: number, ...args: unknown[]): number {
  let v = base;
  for (const r of activeRules(g, rule)) {
    const ctx = makeCtx(g, r.src ?? '', r.controller, { data: r.data }); if (r.abSrc) ctx.abilitySource = r.abSrc;
    if (r.ab.applies && !r.ab.applies(ctx, ...args)) continue;
    v = typeof r.ab.value === 'function' ? r.ab.value(ctx, ...args) : (r.ab.value ?? v);
  }
  return v;
}

export function anyDamageLethal(g: GameState, unit: ObjId): boolean {
  // any damage dealt by a player this turn counts, not only the last source (Elder Dragon; damage dealt before it entered too)
  const s = g.ex.damageSrc[unit];
  if (!s || !((g.objects[unit]?.damage ?? 0) > 0)) return false;
  const dealers = s.by ? (Object.keys(s.by).map(Number).filter(p => (s.by![p as PlayerId] ?? 0) > 0) as PlayerId[]) : [s.player];
  return dealers.some(p => ruleApplies(g, 'anyDamageLethal', p, unit));
}

export function victoryScore(g: GameState): number {
  return g.victoryScore + ruleSum(g, 'victoryScoreDelta');
}

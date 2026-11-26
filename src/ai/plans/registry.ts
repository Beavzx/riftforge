// AI-CORE: deck-plan registry. Plans are looked up by the deciding player's legend (champion tag key or legend card id).
// Pilot files only `export const plan: DeckPlan`; src/ai/plans/index.ts imports and registers them (owned by AI-CORE).
import type { GameState, PlayerId } from '../../engine/types.ts';
import type { DeckPlan } from './types.ts';
import { legendKeys } from '../core/ctx.ts';

const plans = new Map<string, DeckPlan>();
let disabled = false;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]/g, '');

export function registerPlan(plan: DeckPlan | null | undefined): void {
  if (!plan) return;
  for (const l of plan.legends.length ? plan.legends : [plan.id]) plans.set(norm(l), plan);
}

/** Remove all plans (tests). */
export function clearPlans(): void { plans.clear(); }
/** Globally switch plans off (A/B benches: core without plans). */
export function setPlansEnabled(on: boolean): void { disabled = !on; }

export function planFor(g: GameState, p: PlayerId): DeckPlan | null {
  if (disabled) return null;
  const legendCard = g.objects[g.players[p].legend]?.cardId;
  const byId = legendCard ? plans.get(norm(legendCard)) : undefined;
  if (byId) return byId;
  for (const key of legendKeys(g, p)) { const pl = plans.get(key); if (pl) return pl; }
  return null;
}

export function allPlans(): DeckPlan[] { return [...new Set(plans.values())]; }

// META-SIM AI (src/ai/): search-based pilot for simulations. See src/ai/search.ts for the algorithm, docs/ai-plans.md for deck plans.
export { SearchAI, makeSearchPolicy, fastPolicy, describe, type SearchOptions, type SearchStats } from './search.ts';
export { evaluate, unitValue, DEFAULT_WEIGHTS, WIN, type EvalWeights } from './eval.ts';
export { determinize } from './determinize.ts';
export { planFor, registerPlan, clearPlans, setPlansEnabled, allPlans } from './plans/index.ts';
export type { DeckPlan, PlanCtx, CardInfo } from './plans/types.ts';

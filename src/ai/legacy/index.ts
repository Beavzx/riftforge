// AI-CORE: frozen snapshot of the pre-AI-CORE search AI (2026-11-26), the "old AI" baseline for tools/ai-bench.ts --vs legacy. Do not edit.
// META-SIM AI (src/ai/): search-based pilot for simulations. See src/ai/search.ts for the algorithm.
export { SearchAI, makeSearchPolicy, fastPolicy, type SearchOptions, type SearchStats } from './search.ts';
export { evaluate, unitValue, DEFAULT_WEIGHTS, WIN, type EvalWeights } from './eval.ts';
export { determinize } from './determinize.ts';

// AI-CORE: registers every pilot plan (one file per legend, each exporting `plan: DeckPlan`). Owned by AI-CORE;
// pilots never need to edit this file (the file names are fixed: see docs/ai-plans.md).
import { registerPlan } from './registry.ts';
import { plan as azir } from './azir.ts';
import { plan as vex } from './vex.ts';
import { plan as evelynn } from './evelynn.ts';
import { plan as reksai } from './reksai.ts';
import { plan as kaisa } from './kaisa.ts';
import { plan as irelia } from './irelia.ts';
import { plan as kennen } from './kennen.ts';
import { plan as ezreal } from './ezreal.ts';
import { plan as sett } from './sett.ts';

for (const p of [azir, vex, evelynn, reksai, kaisa, irelia, kennen, ezreal, sett]) registerPlan(p);

export { planFor, registerPlan, clearPlans, setPlansEnabled, allPlans } from './registry.ts';
export type * from './types.ts';

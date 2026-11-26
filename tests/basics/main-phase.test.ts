// BASICS matrix: the actor's own Main phase (Neutral Open) — first action of the turn, after a play (pool empty), right after
// a power-only play (the reported case: [1] floats), with floating energy / power. See matrix.ts for the checks.
import { defineMatrix } from './driver.ts';
import { syntheticKinds } from './matrix.ts';
defineMatrix(syntheticKinds(), ['first', 'afterPlay', 'afterPowerPlay', 'afterFloatE', 'afterFloatP']);

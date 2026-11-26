// BASICS matrix: closed states (a chain is open) on both players' turns and in the Beginning / Ending phases, plus the
// opponent's Main phase (no priority). See matrix.ts for the checks.
import { defineMatrix } from './driver.ts';
import { syntheticKinds } from './matrix.ts';
defineMatrix(syntheticKinds(), ['ownChain', 'oppChain', 'endingChain', 'beginningChain', 'oppMain']);

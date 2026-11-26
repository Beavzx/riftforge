// BASICS matrix: one real card per kind (data/cards.json, real scripts) at every turn moment. See matrix.ts for the checks.
import { defineMatrix } from './driver.ts';
import { REAL_KINDS, MOMENTS } from './matrix.ts';
defineMatrix(REAL_KINDS, MOMENTS);

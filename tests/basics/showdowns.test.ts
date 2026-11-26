// BASICS matrix: showdowns — with focus, without focus, a chain inside a showdown, and the last moment (the opponent has
// passed: the actor's pass would end it) on both players' turns; combat as the attacker and as the defender. See matrix.ts for the checks.
import { defineMatrix } from './driver.ts';
import { syntheticKinds } from './matrix.ts';
defineMatrix(syntheticKinds(), ['showdownFocus', 'showdownNoFocus', 'showdownChain', 'showdownLast', 'oppShowdownFocus', 'combatAttack', 'combatDefend']);

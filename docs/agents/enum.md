# ENUM (task #4): complete decision lists for learning agents

Branch `agent/enum`. New: `src/ai/env/factored.ts`, `tools/enum-audit.ts`, `tests/ai/env/factored.test.ts`.
No engine or UI changes. The audit found no engine enumeration bugs: every listed action validates, no list was ever empty,
and every engine-listed action is reachable through the factored layer (tested).

## Audit (tools/enum-audit.ts — `tsx tools/enum-audit.ts 200 6 40`, 743 s on the shared 2-core box)

Where `getLegalActions` is not complete (code): `moveOptions` (6+ movable units to one destination → only singletons + "all"),
`inStepActions` generic multi-select (> 64 combinations → prefixes + singletons; MS-5 per-location sample for `sameLocation`),
`assignDamage` (the suggestion + up to 3 rotations), `payment` (only `auto`; asked only when `GameSetup.manualPay` is on —
otherwise every payment is auto-paid with no decision at all). `sim-lib.ts fallbackAnswer` never fired (0 empty lists).

"Exact" = all distinct valid answers (damage: canonical outcome rows, see below; payment: distinct recycle-domain/Add plans).
"Matters" = the missing answers include a different outcome (damage: a different set of units killed; others: any missing answer).

| Decision | Run | Decisions | Incomplete | Matters | Max exact vs listed |
|---|---|---|---|---|---|
| Standard move (per destination) | 200 random | 8,545 | 17 (0.2%) | 17 | 255 vs 31 |
| Standard move (per destination) | 6 SearchAI | 293 | 5 (1.7%) | 5 | 127 vs 31 |
| assignDamage | 200 random | 77 | 41 (53%) | 18 (23%: a kill set unavailable) | 7 vs 4 |
| assignDamage | 6 SearchAI | 16 | 13 (81%) | 4 (25%) | 46 vs 4 |
| Multi-select > 64 (chooseTargets) | 6 SearchAI | 82 | 1 | 1 | 92 vs 37 |
| payment (manualPay on) | 40 random | 663 | 20 (3%) | 20 (recycle a different domain / use an Add) | 3 vs 1 |
| All other kinds (mulligan, chain/showdown/main windows, targets, cards, modes, order, optional, ...) | all | ~43,000 | 0 | 0 | — |

So: damage assignment is the main real gap (a quarter of combats can't kill the set of units the player wants); big moves are
rare but appear more in SearchAI games (wide boards); payment choice exists only with manualPay and matters ~3% of the time.

After (200 games driven only through the factored layer, a quarter with manualPay): 40,987 decisions, 41,007 sub-choices,
**0 invalid actions, 0 stuck**, 169/200 games finished (the rest hit the 40-turn cap with a random policy), max 71 options
in one sub-choice (main phase), max 5 sub-choices for one decision (a factored move).

## API (`src/ai/env/factored.ts`)

```ts
const node = factor(state, opts?);   // FNode | null (null = game over / nothing pending)
node.choice: SubChoice = {
  kind: 'engine' | 'pickCards' | 'moveUnits' | 'assignDamage' | 'payment',
  decision: DecisionKind,            // the engine decision it belongs to
  player, prompt,
  step: number,                      // 0 = first sub-choice of this decision
  partial: { picked?, destination?, assignment?, current?, total?, min?, max? },
  options: { id, label, objIds?, value?, isDone?, action? }[],
};
node.pick(i) -> FNode | Action       // next sub-choice, or the final engine Action (already checked with validateAction; throws if not)
decide(state, policy, opts?)         // drive one decision: policy(choice) -> option index
randomSubPolicy(rng, doneBias?)      // baseline/test policy
isAction(x), actionLabel(g, a), locLabel(g, loc)
enumerateAssignments(targets, total), enumeratePayments(g, decision), pickCompletable(g, decision, picked)
opts: { maxFlat = 64, includeCancel = false, maxFlatMoveUnits = 5 }
```

- `objIds` on every option are the pointer targets for a policy (card played/activated/hidden, units moved, the card picked,
  damage recipients, runes recycled + Add sources). `value` is a scalar (destination index or `'base'`, damage amount, option id).
- Pass-through: every option of a fully enumerated decision carries `action` (the engine Action). Encoders can encode `action`
  directly for `kind: 'engine'` and use `objIds`/`value` for the factored kinds.
- `cancel` (UI back-out) is left out by default — for an agent it's a no-op loop. `concede` is never offered.
- `maxFlatMoveUnits: 0` factors every standard move (one "Move units to X…" option per destination, then pick units / done),
  which shrinks main-phase lists (up to 92 flat options seen with SearchAI boards because of the 31 move combos per destination).

### Sub-choice kinds
- `engine`: the engine's own list (complete), plus `move:<to>` options for destinations with too many units.
- `moveUnits`: add one unit at a time, or `done`. A unit is offered only if the set stays payable (move costs are additive and
  non-negative, so this is exact); `done` only when the set is a valid move.
- `pickCards`: big multi-selects (> maxFlat combinations): pick any remaining option or `done`. An option is offered only if a
  valid completion exists — exact for the engine's checks (none / `sameLocation` / `groupRules` maxTotalMight + sameController),
  a bounded validator search for unknown future checks. `done` only when `validateAction` accepts the set.
- `assignDamage`: all outcome-distinct valid assignments (each live recipient gets 0, exactly lethal, or the single partial
  remainder; Tank/Backline order via the engine's `validateAssignment`). ≤ maxFlat → flat (the engine's suggestion first);
  otherwise one recipient at a time (`partial.current`), offering only amounts some valid assignment has.
- `payment`: `auto` first, then every canonical, non-dominated manual plan (distinct recycled domains / Add sources used).

### Canonicalisation (documented incompleteness — none of it changes the game outcome)
1. Damage beyond lethal on every recipient (excess) goes to one chosen recipient, not split. Only the total excess is recorded
   by the engine (`excess:<p>`); damage on units that die anyway doesn't change the state.
2. Payment: which ready runes are exhausted for energy is not a choice (any rune makes [1]; what's left differs only by count);
   within a domain, exhausted runes are recycled first (a ready rune kept is never worse); plans that recycle more than needed
   or use an Add they don't need are dropped; converter payments (Ancient Henge) are reached through `auto`.

## Tests (`tests/ai/env/factored.test.ts`, 11 tests, ~80 s): all pass
- full random games through the layer only (half with manualPay): valid actions, games finish
- determinism (same seed + same sub-choice rng → identical action log and final state)
- every action the engine lists (5 games, every decision) is reachable through the layer
- 7-unit standard move: the engine lists 8, the layer reaches all 127 subsets
- synthetic 12-option multi-selects (any number, exactly 5, sameLocation, groupRules Might ≤ 7 + same controller): exactly the
  validator-accepted subsets are reachable; 300 random walks never stuck, always valid
- damage enumeration vs brute force over every integer assignment (300 random target sets incl. Tank/Backline/exempt)
- manual payment on a multi-domain [C] card: alternatives beyond auto, each valid, leaving different runes in play
- `maxFlatMoveUnits: 0`

Also run: `npx tsc -p .` clean. (Full suite not run: shared CPU.)

## Notes for other agents
- Encoder (task #2): use `SubChoice.options[].objIds` for pointer indices, `value` for destinations/amounts, `kind`/`step`/
  `partial` as context features. For training, turn on `manualPay` if you want the policy to learn rune choices (adds ~1 payment
  sub-choice per paid play, single-option most of the time — skip forced (1-option) sub-choices in search).
- Runtime (task #5): drive games with `decide`/`factor` instead of `getLegalActions`; skip search on 1-option sub-choices.

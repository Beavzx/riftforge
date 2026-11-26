# Unification plan (PHASE 2) — one engine mechanism per concept

Goal: every card uses the same engine primitive for a concept; batch helpers (src/cards/helpers/B1..B8) keep only
card-text conveniences (compositions of engine calls), no reimplementations of game mechanics.

Status legend: **done** = engine primitive exists and the stand-in was migrated/deleted; **engine** = primitive exists,
some batch-local wrappers remain (thin, composition only); **open** = not unified yet.

## Stand-in -> engine primitive map

| Concept | Batch stand-ins (before) | Engine primitive (now) | Status |
|---|---|---|---|
| Acting as another player | B3/B4/B5/B7 `asPlayer`, B8 `asP` (5 variants, some lost `targets`) | `ctx.as(p)` (keeps targets, mode, x, iteration, abilitySource) | **done** (all 42 call sites codemodded, 5 helpers deleted) |
| Look / reveal from a deck | B7 `topCards`/`revealUntil` + `nocturneHook` + `hatchlingBeforeReveal` (only B7 cards saw Nocturne / Void Hatchling) | `actions.lookDeck` -> `ctx.lookTop / revealTop / revealUntil`; `lookDeck`/`revealDeck` replacement events; `lookedAt` triggers active in the Main Deck | **done** — Nocturne is a `lookedAt` trigger (+ reflexive play for [A], RJ#3918), Void Hatchling a `revealDeck` replacement; B7 `topCards`/`revealUntil` are 3-line wrappers over ctx; `lookPick` stays (composition) |
| Drawing a specific card | B7 `drawSpecific` (manual move + event) | `ctx.drawCard(id)` (draw replacement, `draws:p` ordinal, event) | **done** (helper deleted) |
| Per-object memory | B2 `memoSet/memoGet` (delayed-ability hack) | `ctx.memo(obj, key, value?)` (epoch-keyed, `g.ex.memo`) | **done** (helper deleted) |
| Per-turn history | B1 `xpGainedThisTurn`, B4 `powerSpentThisTurn`, B6 `tracker`, B8 `fact/markThisTurn`, Hungry Wolf tracker | `ctx.history(key, p)` over `g.ex.counts` (played, spells, spellEnergy, draws, unitsDied, gearDied, chose, choseEnemy, choseEnemyUnit, ...), `ctx.movesThisTurn(id)` | **engine** — Hungry Wolf migrated; B6 `tracker` / B8 `fact` remain for card-specific facts (composition over `ctx.bump/count`) |
| Event batches ("one or more") | B6 `firstOfBatch`/`batchCount`, B4 `firstOfMoveBatch` | `ev.batch` (state-backed, replay-safe), `ctx.batchOf(ev)`, `oncePerBatch` trigger option | **engine** |
| Excess combat damage | B3 `excessDamageRecorder`, B4 `recordExcess`/`excessAssigned`, B8 Piltover Enforcer listener (3 different definitions) | damage-assignment excess: `combat.excess`, conquer event `excess`, `ctx.excessDamage(p)` | **done** (Tryndamere, Sivir, Piltover Enforcer and two B3 conquer cards migrated; recorders deleted) |
| Multiple buffs | B6 `MULTI_BUFF` set + private `buff()` | `rule('multipleBuffs')` checked by `actions.buff` | **done** (Lee Sin migrated; helper deleted) |
| Optional discounted additional costs | B1 `optionalCostDiscount` + `selfCostB1` flag on `ctx.item`; B6 `spendBuffToIgnoreCost`; B8 Songstress `askOnItem` | `additionalCosts: [{ optional, discount, beforeTargets, keepsDestination }]`, play-rule `additionalCost` (+ `destination`, `discount`, `anyPlayer`) | **done** — Buccaneer, Skystrike, Poppy, Wallop, Call to Glory, Starry-Eyed Songstress, Dragon Roost migrated; legality enumerates payable combos; a cost that must be paid is not offered as optional (CR 355.16) |
| Adding a cost while playing | B1 `addPlayExtra` (removed functions from state) | `ctx.addPlayCost` (functions kept off-state) | **done** |
| Effect plays | B7 `playIt`/`banishThenPlay`/`afterChain`/`canAffordPlay` | `ctx.play(id, { cost: 'free'|'full'|'noEnergy'|{reduce}|{pay}, destinations, then: 'banish'|'recycle', noAdditional })`, `ctx.canPlayByEffect`, `ChainItem.leaveTo` | **engine** — B7 wrappers still delegate to it |
| Destinations chosen on play (R-2) | B4/B5 `moveChosen`/`chooseDest`/`moveDestinations`, resolution-time `chooseLocation` | `T.destination(F.moveDestFor(i))`, `ctx.destination(i)`, `ctx.canMoveTo`, `E.moveToChosen(u, d)`; asked as `chooseDestination` | **done** — every move-destination card migrated (ENGINE-2, see CHANGELOG); resolution-time helpers deleted; `ctx.validMoveDest` / `F.dest` |
| Standard-move applied costs | B2 Gravity Field replacement + Rollback; Mageseeker Investigator unscripted | `rule('moveCost', applies, ..., { cost })` (legality + "pay?" + payment) | **done** |
| Hide costs | B8 Swift Scout (todo), B7 `HIDE_FREE` (inert) | `hideCosts()`: [A] + play-rule `hideCost` alternatives, `costMod({scope:'hide'})` | **done** |
| Ambush-like destinations | B4 `selfDest` for Rengar | play-rule `ambush(ctx, id, bf)` (destination + Reaction timing) | **done** for Rengar; `selfDest` remains for "play me to X" rules (extraDestinations) |
| Granted keywords while played | B8 Firelights modifiers on hand cards; Syndra unscripted | play-rule `grantKeywords` / `keywordCosts`, `chars.playGrants`, granted Repeat costs (multiple Repeat costs) | **engine** — Syndra migrated; Firelights still uses hand modifiers (works) |
| "Can't be played" | Ol' Poro via a no-op spell `playIf` | `rule('cantPlay')` on the card itself (also blocks effect plays, R-13) | **done** |
| Earlier target groups in filters | B5 `priorPicks` / B6,B7 `chosenSoFar` scanning `targeted` events | engine exposes earlier groups in `ctx.targets` while choosing, in the legality search, on re-validation, in remade choices (R-14) | **done** (helpers now 1-line reads of `ctx.targets`) |
| Battlefield "you" | B4 `bfAbilityController`, B8 `bfCtl` | `abilityController` (battlefield controller), "when you attack/defend here" require a controller (CR 190.6.d) | **engine** |
| Trigger conditions | DSL `if` re-checked on resolution | `if` = trigger condition only (CR 383.2.a.1); `ifOnResolve` = effect condition | **done** (audit: Loose Cannon, Grand Plaza changed) |
| Elder Dragon "any of your damage" | last damage source only | per-player damage tally `damageSrc[unit].by` | **done** |
| Gear Units | B7 `isGearAny`, B2 `friendlyGearCount` reading `additionalTypes` | `isGear/isUnit/F.gear` read `CardDef.additionalTypes` | **engine** (helpers still exist, now redundant) |

## Engine requests implemented in phase 2

B6-11, B6-12, B4-2, B4-8, B4-11, B4-13/B1-2/B1-13, B4-15, B3-3, B3-4, B3-8, B1-8, B1-14, B8-6, B8-8/B7-7, B8-9,
B8-10, B8-11, B8-19, B8-7 (multi-domain [C]), B7-3, B7-4, B7-8, B5-5, B5-12, B2-2, B2-9, N6 (Dragon Roost), R-1..R-8,
R-10..R-16, SF-1, F-1..F-6, Rift Judge engine items A-J (see CHANGELOG milestone C).

## Still open

- (R-2 done 2026-11-26. Azir's swap and token play locations are not move destinations chosen by a player — unchanged.)
- N7 (destination = another player's base: Temporal Breach), N4 (a "would give -Might" replacement: Mel, Gangplank),
  B2-10 (Svellsongur copying a unit's whole text onto Equipment).
- Remaining thin helpers that only compose engine calls (lookPick, playUnitTokens/playGold, legion, tracker/fact) are kept on
  purpose; B7 `isGearAny` / B2 `friendlyGearCount` are now redundant with SF-1 and can be inlined.

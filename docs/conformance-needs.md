# Conformance needs (CONFORMANCE agent → ENGINE / CARDS agents)

APIs the conformance suite (`tests/conformance/`) needs but which `src/` does not offer yet. The suite never
edits `src/`; where a hook was missing, the scenario is still written and marked `{ todo }` with the id below.
Status is as of the last run (2026-11-25, see docs/conformance-report.md).

| Id | Need | Exact API wanted | Used by | Status |
|---|---|---|---|---|
| N1 | Standalone rune abilities (CR 164.2): exhaust for [1], recycle for [C], usable whenever the player has priority, without a chain item | `getLegalActions` lists `{ type: 'activate', obj: runeId, abilityIndex }` for each basic rune ability; applying it adds to the pool | T016 | **DONE** (engine added it; T016 promoted from todo, passes) |
| N2 | A supported state builder for tests, so scenario setup doesn't depend on engine internals | `src/engine/testkit.ts`: `place(g, p, cardId, loc, {ready, damage, stunned, buff, controller, faceDownAt, hiddenTurn})`, `attachNow(g, gear, unit)` (keeps `ex.attachCount` right), `addPreventShield(g, unit, n)`, `setPoints/ setXp`, `setBattlefieldController(g, bf, p)`. They should leave the state quiescent and invalidate caches. | the whole harness (today it uses `newObject`, edits `g.ex.attachCount`, pushes `builtin:prevent` into `g.ex.delayed`, and bumps `g.timestamp` to invalidate the `abilitySources` cache) | open |
| N3 | Public total-cost query, so tests can assert "costs [4]" without inferring it from rune counts | `export function playCostOf(g, p, obj, opts?: { dest?, accelerate?, repeat?, targets? }): { energy: number; power: (Domain[] \| 'any')[] }` from `src/engine/index.ts` | T031, T046, T178 (Battering Ram), T202, T203 | open |
| N4 | Replacement event for **Might reduction**, with the source spell/ability and whether it chose the object | `applyReplacements(g, { type: 'giveMight', obj, amount, source, chosen: boolean })` in `ctx.giveMight` / `addModifier` before a negative modifier is added (the event may be replaced by another event, e.g. `+3`). The `stun` and `returnToHand` replacement events also need `source` and `chosen`. | T172-T175, T180 (Gangplank, Naval; Mel, Newly Awakened) — also requested by the cards agent (comment in batch-B1.ts) | open |
| N5 | Applied cost on moves ("opponents must pay [1][A] to move units here") | — | T204 | **DONE** via card script (Gravity Field throws `Rollback` when not paid); T204 promoted, passes |
| N6 | An object granting an optional additional cost + play location to *other* cards ("any player may pay [A][A] as an additional cost to play a Dragon; if they do, they play it here") | `PlayRuleAbility.additionalCost?: { cost: CostSpec; destination: (ctx) => Destination }` offered in the Make Choices step | T182 (T181 is now a real test, see report B9) | **DONE** (ENGINE-4 RJ#12173: play-rule destination costs offered as a destination choice); T182 rewritten to VEN-FAQ #25's actual case (Temporal Breach + Elder Dragon) by ENGINE-5, passes |
| N7 | Destinations in another player's base / "its owner plays it to the same location" | `Destination = number \| 'base' \| { base: PlayerId }`, with `destinations()` rejecting another player's base (CR 358.3) | T187 (Temporal Breach on a stolen unit) | open |
| N8 | "Activate the conquer effects of units here" (CR 383.4.g) | — | T193 | **DONE** via card script (Reckoner's Arena); T193 promoted, passes |
| N9 | Per-turn "energy spent on spells" counter | — | T195 | **DONE** (T195 passes with the real Jhin / Singularity scripts; promoted) |
| N10 | Granting [Repeat] with a cost to a spell | — | T203 | **DONE** via card script (Temporal Portal); T203 promoted, passes |

Remaining todo tests whose only blocker is that my test body still has to match the prompts of the real card
scripts (not an engine gap): T173, T192, T194, T205, T207. Their reasons say so.
ENGINE-5 2026-11-26: T192, T194, T205, T207 un-todo'd (setups fixed to the FAQ scenarios; Atakhan's kill cost now counts as paid when
the death is replaced, CR 203.2) — no conformance todos remain.

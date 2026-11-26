# Riftforge conformance report

CONFORMANCE agent, 2026-11-25. Suite: `tests/conformance/*.test.ts`. There is one `node:test` per scenario of
docs/rules-tests.md (T001–T220 plus T110b = **221**). Run it with:

```
node --import tsx --test 'tests/conformance/**/*.test.ts'
```

Harness: `tests/conformance/harness.ts` (S0 builder, board setup, action drivers, event log, real-card loader).
Fixture cards: `tests/fixtures/conformance/cards.ts` (ids `cf-*`, scripts written with `src/cards/dsl.ts`).
The harness also loads `src/cards/scripts/index.ts`, so FAQ scenarios that need real cards use their real scripts.
Missing APIs are listed in docs/conformance-needs.md.

## 1. Result of the final run

| tests | pass | fail | todo |
|---|---|---|---|
| 221 | **208** | **2** | **11** |

The ENGINE agent was editing `src/` the whole time. 17 discrepancies this suite reported earlier in the session
were fixed before the final run (§3). The engine was mid-edit at one point, and T108 and T158 failed in one
run, then passed on the rerun. Both pass in the final run.

## 2. Open discrepancies (failing in the final run), ranked by severity

| # | Scenario | Expected (CR) | Actual | Verdict |
|---|---|---|---|---|
| B9 | **T181** Perched Grimwyrm + Dragon Roost (VEN-FAQ #26) | "Play me only to a battlefield you conquered this turn" is a "can't" that beats Dragon Roost's permission (CR 054). With nothing conquered this turn, Grimwyrm is not playable anywhere. | Offered to Dragon Roost **and to base**. Cause: `src/engine/rules.ts` `activeRules()` only scans `abilitySources()` (board, legend, battlefields). The script's `rule('cantPlay', …, { activeIn: ['hand'] })` is never consulted, so no hand-zone play restriction on any card works. | **Engine bug — MEDIUM** (affects every "play me only …" card) |
| S1 | **T031** Cost payment [3][R] with 4 Fury runes | Spec: "Auto-pay chooses the first" plan (exhaust 3 + recycle the 4th), leaving 3 exhausted runes. | Auto-pay exhausts 3 and recycles one of those *same* runes, leaving 2 exhausted + 1 ready (rules-decisions.md #19). Both plans named in the CR are accepted as manual plans. | **Spec error / ambiguous — LOW.** CR 164.2 / 357 allow exhausting and then recycling the same rune. The engine's plan is legal and leaves strictly more resources, and the CR doesn't mandate an auto-pay preference. Recommend fixing docs/rules-tests.md T031, then this test. |

## 3. Engine bugs found this session and fixed before the final run (now passing), ranked by severity

Each was reproduced by the named test, re-checked against the rules, and is now green.

| Sev | Scenario | Expected (CR) | Actual when found |
|---|---|---|---|
| HIGH | T053, T167 Gold token mid-payment | Gold "Kill this, [T]: [Add] [A]" usable during payment; the token ceases to exist (CR 187.5, 430.3) | **TypeError crash**: `executePayment` paid "kill this" (token deleted), then the DSL `mana()` effect called `ctx.domains(self)` on the deleted object |
| HIGH | T110 Burn out with empty deck and trash | Burn outs repeat, 1 point each, until the opponent wins (CR 432.3.a; checked on the riftlens CR mirror) | One burn out per draw (`draw()` `continue`d), so P1 got 1 point instead of winning. rules-decisions.md #7 still describes the old behaviour. |
| HIGH | T220 Battlefield ability controller | Uncontrolled battlefield: TP controls its abilities (CR 190.6.b). Controlled: its controller (190.6.a) | Controlled by the battlefield's **owner**, so "When you hold/conquer here" on an opponent-owned battlefield never fired for the player who controlled it |
| MED | T105 Tie at the victory score | The first burn-out point of a sequence is checked at the next cleanup; only later ones win immediately (CR 432.3.c) | `burnOut()` checked for a win after every point, so P1 won mid-spell at 8–7 before P0's point resolved |
| MED | T003 Mulligan order | First player mulligans first (CR 117) | Reversed: `unshift` in a loop over turn order |
| MED | T075 Vilemaw's Lair | A standard move to base from the Lair is not legal (card text, CR 054) | Offered and accepted. `canMoveUnit` ignored the `cantMove` rule, so the unit was exhausted and the move silently skipped |
| MED | T119 Declined "you may" once-per-turn trigger | Declining = never triggered; the once-per-turn use is not spent (CR 383.3.a, 386.2) | The use was marked when the trigger was queued, before the yes/no decision |
| MED | T129 "Becomes Mighty" via a buff | Crossing 4→5 by any Might change triggers (CR 709) | `buff()` emitted no `becameMighty` / `mightChanged` (only `addModifier` did) |
| MED | T143 Hidden spell with no target at its battlefield | Can't be played from facedown (CR 811.1.d) | `candidatesFor` fell back to unrestricted targets |
| MED | T159 Flow spell countered | Banished instead of trashed (CR 829, VEN-FAQ #1) | `counterItem` → trash |
| MED | T206 "Until your next Ending Phase, you may play that card" | Expires when the right Ending Phase begins (RAD-FAQ #5-7) | Play permissions never expired |
| LOW | T010 Sideboard > 10 | Reported invalid (TR 601.1.c) | Not checked |
| LOW | T060 Ordering own simultaneous triggers | Decision kind `orderTriggers` (spec §8.2, decision catalogue) | `chooseOrder` (ordering itself was correct) |
| LOW | T156(b) Ambush location lost while paying an additional cost | Play undone (CR 822.3, INFERENCE) | Play went through |
| LOW | T186 Kayle (VEN-FAQ #15) | Disempower removes one status (CR 443). A multi-Empower object can still activate Empower at max (CR 827.1.c.5, checked on the mirror) | Disempower cleared all statuses |
| LOW | T209 Riven + Stellacorn group move (RAD-FAQ #11) | The exhaust-cost trigger goes on the chain before the move triggers, with no ordering choice | Batched, so the player was asked to order them |

## 4. Todo scenarios (11)

| Scenario | Reason |
|---|---|
| T172, T174, T175, T180 | N4: no "would give −Might" replacement event, so Gangplank, Naval and Mel, Newly Awakened can't be scripted fully. T172/T175 pass, but their expected outcome is the same with or without the hook. |
| T173 | N4 (the stun replacement needs "chosen by a spell/ability" context); Back Off has no script yet |
| T182 | N6: an object granting an optional additional cost and a destination to other cards (Dragon Roost) |
| T187 | N7: `Destination` can't name another player's base. Today the real Temporal Breach puts the stolen unit into its owner's base instead of leaving it banished. |
| T192, T194, T205, T207 | The real scripts exist (or partly exist). My test bodies still have to match those scripts' prompt sequences (Alpha Strike/Flash/Repulse, Atakhan, Angler Wyrm/Hunker Down, Atakhan + Mordekaiser). |

## 5. Conflicts between docs/rules-decisions.md and the rules (no failing test)

- **#7 Burn out "at most once per draw attempt"** contradicts CR 432.3.a. The engine now repeats (T110 passes),
  so the decision text is stale.
- **#21 Empower "offered only while empowered < maxEmpower"**: CR 827.1.c.5 says objects that can be Empowered
  several times ignore the "only if not Empowered" restriction. T186 passes, so this text also looks stale.
- **#22 several Vision instances trigger once (de-duplicated)** contradicts CR 817 / keywords.md ("each instance
  triggers separately"). None of the 221 scenarios covers this. **Ambiguous / engine limitation**; suggest adding a
  scenario.

## 6. Method notes

- Scenarios use "...Like" fixtures that reproduce a real card's text when the ruling is about a rules mechanic
  (Hourglass, Ki Barrier, Lotus Trap, Hidden Blade, Rebuttal, Tianna, Forgotten Monument, ...). Where the ruling
  depends on a real card, the real card and its registered script are used (T172-T207).
- Rules re-checked against the official text where engine and spec disagreed: CR 432 burn out, 420.4 play
  triggers (T045 confirmed spec: countered spells never trigger "when you play a spell"), and 827 Empower. Source:
  the riftlens.pages.dev CR mirror (rules/burn-out, rules/play, rules/empower-827).
- Tests assert in order of rule relevance, and they isolate their rule from unrelated bugs. For example, T001/T002
  don't depend on the T003 mulligan order.
- The harness edits engine internals for setup only (see conformance-needs N2).

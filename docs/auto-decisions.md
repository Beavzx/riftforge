# Auto-decisions audit (AUTO-AUDIT, 2026-11-26)

Every place where the engine or the UI decides something for a player without asking. Each entry gives where it is,
what it decides, whether the alternatives can ever lead to a different outcome, and a verdict:

- **SAFE**: the rules force the choice, or every alternative leads to the same outcome.
- **FIX**: an alternative is at least as good in every respect and sometimes better, so the auto-choice must pick it.
- **ASK**: the alternatives are not comparable, so the player must be asked or must have a one-click override.

Owner column: `ENGINE-6` = src/engine (do not edit without coordinating), `AUTO-AUDIT` = done in this pass.

Property tests: `tests/rules/auto-decisions.test.ts`. Set `AUTO_AUDIT_N=400 AUTO_AUDIT_SHOW=60 AUTO_AUDIT_EX=20` to see
every counterexample and every ASK example.

## Summary

| Verdict | Count | Entries |
|---|---|---|
| SAFE | 22 | S-1 … S-22 |
| FIX | 6 | AP-1, AP-2, AP-3 (payment.ts): **fixed by ENGINE-6**; open: F-4 trigger-order dedupe, F-5 Repeat "either" reduction, F-6 manual-plan multi-domain Add check |
| ASK | 4 | A-1 payment choices neither side dominates (domain to keep, Gold/Seal/rune): done, preference + panel; A-2 costs paid during resolution; A-3 damage with exempt recipients; A-5 no cancel after an auto-target |

The FIX items are all in src/engine, which ENGINE-6 owns for this run, so they went to ENGINE-6 with repros. ENGINE-6
fixed AP-1..AP-3 in payment.ts (2026-11-26), and their tests now pass. The property test is clean at 400 states. Still
open for the next engine agent: F-4, F-5, F-6, E1, E2 (A-2), A-3. AUTO-AUDIT changed only the UI and net code (A-1) and
added tests.

## Auto-pay (src/engine/payment.ts `autoPay` / `planWith` / `spendFromPool`)

Used by every play, activation, hide and move cost (`play.ts payResources`), by trigger costs and Deflect
(`chain.ts` ~127/168/198), by `ctx.pay` / `payResolved` / `mayPay` during resolution (`context.ts` ~490-505), by token
Accelerate (`actions.ts` ~695), and by `canAfford` (legality of every play). It decides:

1. Which ready runes to exhaust for energy.
2. Which runes to recycle for power, and therefore which domains stay in play.
3. Whether a ready recycled rune is exhausted first. It is, per rules-decisions #65 (the user's report); a test pins it.
4. Whether floating pool energy/power is used before runes. It is, which is right because the pool empties at the end of the phase.
5. Which pool units are spent: restricted ones first, and which domain or universal.
6. Whether Add sources are used: Seals, Energy Conduit, Gold, Lux, legend Adds, and up to 3 of them.
7. Which domain a multi-domain [C] Add produces (`addDomains`).

**Method.** The property test builds random small states: 0-4 runes of Fury/Calm/Mind, ready or exhausted; floating
energy, domain and universal power; restricted pool power and energy; 0-2 Add sources from {Seal of Rage, Seal of Focus,
Energy Conduit, Gold, Lux}, ready or exhausted. It pairs them with random costs: energy plus single-domain, multi-domain
[C] and [A] symbols, for a unit, spell or gear. For each state it enumerates every legal payment: each rune unused,
exhausted, recycled, or exhausted then recycled; each Add source used or not; every way of spending the pool. It then
compares the engine's actual result (`executePayment` of `autoPay`'s plan) with all of them.

**Dominance** is a Pareto order, not a weighting, so every sensible valuation agrees with it. Result Y is at least as good
as X when all of these hold:
- Y has at least as many runes in play of every domain.
- Y still has every Add-source object X still has (a killed Gold is lost).
- A unit Add source (Lux) that is ready in X is ready in Y.
- Every cost X can still pay, Y can still pay too. This is checked by brute force over energy 0..N plus up to N power
  symbols over the relevant domains and [A], for unit and spell purposes, both now (pool included) and later (pool
  emptied, CR 316.1).

**Result before the fixes (400 states).** 153 states were unpayable, and the engine agreed on every one: it is complete. Every engine plan
passes `validatePlan`: it is sound. The model reproduces every engine result exactly. 22 engine results were
strictly dominated (AP-1..AP-3 below). After ENGINE-6's fixes there are none. In about 20% of states several tight, non-dominated payments differ: that is A-1.

| ID | Where | What goes wrong | Example (test) | Verdict / owner |
|---|---|---|---|---|
| AP-1 | `autoPay`: the runes-only `base` plan is returned before any Add source is tried | A ready Seal whose [C] fits the symbol stays ready while a rune of that domain is recycled. The rune is lost for good; using the Seal costs nothing that the rune couldn't do. 17 of the 22 counterexamples. | `AP-1`: exhausted Fury rune + ready Seal of Rage, cost [Fury]: the engine recycles the rune. `AP-1b`: power-only cost first in the turn, two ready runes + Seal. | **FIX**, fixed by ENGINE-6: when `base` recycles, free Adds (exhaust-only, no extra cost, not a unit, up to 3) are tried, and that plan is kept if it recycles fewer runes. The bot's own workaround (`src/ai/core/policy.ts` ~111) is now redundant. |
| AP-2 | `autoPay`: `sorted.slice(0, k)` | All of the first k Add sources are activated, including ones whose resources this cost can't use: a mismatched Seal, Lux's spell-only energy for a unit (exhausting a unit). 4 of 22. | `AP-2` (Lux + Conduit, cost 2 for a unit), `AP-2b` (Seal of Focus + Seal of Rage, cost [Fury]) | **FIX**, fixed by ENGINE-6: Adds whose `only` doesn't fit are dropped, and every Add plan is pruned of sources it works without. |
| AP-3 | `planWith` / `spendFromPool` unit order (`Object.entries(pool.power)`) | Universal pool power (Colorless) is spent on a single-domain symbol while matching domain power floats. 1 of 22. | `AP-3`: pool {Colorless 1, Fury 1}, cost [Fury] | **FIX**, fixed by ENGINE-6: pool power is matched and spent domain first, universal last (`poolEntries`). |
| A-1 | Everything that remains | Which domain's rune to recycle for [A] or multi-domain [C]; Gold (a token) vs a rune; a Seal vs a rune of another domain; floating [A] now vs a Seal that lasts the turn; Lux (a unit) vs a rune for energy. Neither option dominates; it depends on the player's hand and plans. | `(N real choices)` diagnostics | **ASK**, done (see below) |
| S-1 | `planWith` prefers recycling exhausted runes over ready ones (#19) and exhausts the recycled runes first | Dominant: an exhausted rune has nothing else to give this turn. | property test | SAFE |
| S-2 | Pool before runes, restricted before unrestricted | Dominant: the pool empties at the end of the phase, and unrestricted resources can do anything restricted ones can. | property test | SAFE |
| S-3 | `canAfford` = `autoPay !== null` | Complete on all 400 states, so no payable play is hidden. | property test | SAFE |

### A-1 implementation: the manual-payment override in normal play

The engine already had `GameSetup.manualPay` / `g.ex.manualPay`, a `payment` Decision with Auto-pay and Choose runes
options plus `data.suggested`, and a UI panel. Nothing in the UI or net code ever turned it on, so it was unreachable.
Now:

- **Preference.** A "Choose runes when paying" checkbox on the home screen and in the lobby (`src/ui/main.ts payPrefRow`,
  stored in `riftforge.manualPay`). Local games set `setup.manualPay` for the human seats. Online, the guest sends it in
  its `ready` message (`src/net/protocol.ts`, `src/net/online.ts setManualPay`), and the host builds
  `setup.manualPay` from both seats. A change applies from the next game.
- **One click for the common case.** With the preference on, each payment shows Auto-pay as the primary button. The
  panel (`src/ui/prompt.ts paymentPanel`) starts pre-filled with the auto-pay suggestion: those runes are highlighted
  and its Add abilities are ticked. Changing one rune is one click (exhaust → recycle → unused), then Pay with
  selected. Add sources (Seals, Gold…) appear as checkboxes. A ready rune chosen for recycling is also exhausted, so its
  [1] floats (#65). Covered by `tests/ui/payment.test.ts`.
- **With the preference off**, players can still choose runes in advance: tap runes yourself (click = exhaust, right
  click = recycle) or activate a Seal before playing. Auto-pay spends floating Energy/Power first (S-2).
- Engine follow-ups for ENGINE-6:
  - **E1**: list all usable Add sources in the payment Decision's `data.adds` (`{key, label}`). The panel already reads
    it; until then it shows only the Adds the suggestion uses.
  - **E2**: see A-2.

## Other auto-decisions

| ID | Where | What it decides | Can the alternatives differ? | Verdict |
|---|---|---|---|---|
| S-4 | `ask.ts ask()` | Auto-answers an in-step decision when `options.length === min === max` (choose all), or when there are no options and min is 0 | No. The exhaustive test (`ask(): every auto-answer is the only answer …`) checks 7 kinds × all n, min, max ≤ 4: each auto-answer is the only answer `validateAnswer` accepts. | SAFE |
| S-5 | `ask.ts chooseOptions` | Clamps max to the option count and min to max | Only when fewer candidates exist than requested, which the rules force | SAFE |
| S-6 | `ask.ts chooseNumber` | min = max → no question | Forced | SAFE |
| S-7 | `chooseOrderKind` | The last remaining item is placed without a question | Forced | SAFE |
| F-4 | `chain.ts orderTriggers` (~52) | Simultaneous triggers of one player with the same `key|source` are never ordered | Yes, if their **events** differ: one "when a friendly unit dies" source, two units dying at once. Resolution order of non-commuting effects (damage by the dead unit's Might, then a kill) can matter. Truly identical instances (same event) are SAFE. | **FIX** (low), ENGINE-6: include the event (obj/epoch) in `distinct` |
| S-8 | `chain.ts placeTrigger` `offerIf` / R-15 | A trigger with nothing to do, or whose mandatory first target group is empty, is removed without asking its "you may" | No: declining and "no legal target" both remove it (CR 403.4, 383.3.a) | SAFE |
| S-9 | `chain.ts` modes | Modes with no legal choice are not offered; `n = min(chooseModes, avail)` | Forced | SAFE |
| S-10 | `play.ts` optional additional costs / rule costs / Accelerate / Repeat | Not offered when unaffordable; "no" is not offered when declining would make the play unpayable (F-3c, #41) | Forced (CR 355.16-17) | SAFE |
| S-11 | `play.ts` "[1] or [A] less" (`h.either`) on the first pass | Asked only if both reductions are useful; otherwise the useful one is taken | No: the useless one changes nothing | SAFE |
| F-5 | `play.ts` after Repeat (~763): `if (h.either && h.either.length > 1) h.choice = 0` | Picks "[1] less" for a modifier newly applying to the Repeat executions, without the `useful` check | Yes: if no energy is left to reduce, "[A] less" would have saved a power | **FIX** (rare), ENGINE-6: reuse the `useful` filter, and ask if both are useful |
| S-12 | `play.ts` destination | A single legal destination is used without asking | Forced | SAFE |
| S-13 | `play.ts hideAction` | A single affordable hide cost is used without asking (several → `chooseMode`) | Forced | SAFE |
| S-14 | `context.ts chooseOpponent` / `chooseBattlefield` / `chooseLocation` | One opponent or one option → no question | Forced | SAFE |
| S-15 | `context.ts split` | The last recipient gets the remainder. With fewer damage than targets, which targets stay is asked. | Forced | SAFE |
| S-16 | `ctx.mayPay` | Asks only if payable | Forced | SAFE |
| A-2 | `chain.ts` trigger costs and Deflect (~127/198), `ctx.pay` / `payResolved` / `mayPay`, token Accelerate (`actions.ts` ~695) | Pay through `autoPay` directly, bypassing `manualPay`. The player can't override, and can't pre-tap either, having no priority mid-resolution. | Same space as A-1 | **ASK**, ENGINE-6 (E2): route through `payResources`' payment Decision when `manualPay` is set |
| A-3 | `showdown.ts forced()` | Auto-assigns combat damage when there is one recipient, when no recipient can be killed, or when all damage fits the first unit in order | Partly. The engine's own validator lets damage go to "exempt" recipients (`lethal === null`: a prevent-all shield, or takes no damage, RJ#6949) at any time, so with an exempt unit present the player could legally decline to kill the first unit (for example to avoid an enemy Deathknell). With no exempt recipients it is forced. | **ASK** (low), ENGINE-6: return null from `forced` when an exempt recipient exists and there is a live one (the prompt then opens pre-filled with Suggested, one click). Or decide the opposite rule and tighten `validFor`. **Needs a rules call.** |
| S-17 | `actions.ts kill` | Simultaneous deaths with replacements: asked only when one player has several (#46); otherwise pending order | Per #46 (RJ#1374); different controllers don't choose for each other | SAFE (house #46) |
| S-18 | `replace.ts applyReplacements` | One applicable replacement is applied without asking which comes first; optional ones always ask | Forced | SAFE |
| S-19 | `turn.ts` mulligan / first player / battlefield | All asked; nothing is auto-picked | — | SAFE |
| S-20 | Priority / focus | The engine never auto-passes: every window is a Decision and the UI shows Pass. Bots in `session.ts` fall back to pass only for their own seat. | — | SAFE (UX: no auto-pass option, by design) |
| A-5 | `ask()` auto-target (S-4) on a player-initiated play | With one legal target, that target is chosen, even your own unit for a harmful spell | Not a rules issue: choosing to play commits to it. But there is no cancel once a play has started, so the player can't back out. | **ASK** (UX, low): a cancel button for an in-progress play (Rollback) or a confirmation for `hint: 'harm'` on your own object. **Partly done (UI-CANCEL)**: `{type:'cancel'}` while any choice of your own play is still open (prompt Cancel button / Esc). A play whose only choice was auto-picked still finalizes at once (no confirm step added). |
| S-21 | `src/ui/board.ts` ~683/745/765 | A click with exactly one legal action does it (play, ability); with several, a menu | The player clicked that card or zone | SAFE |
| S-22 | `src/ui/prompt.ts` damage "Suggested" / payment "Auto-pay" | Pre-filled defaults only; the player submits | — | SAFE |
| F-6 | `payment.ts validatePlan` | Checks a multi-domain [C] Add's power by its first domain only (`a.power`), not by `powerDoms`/`addDomains` | A valid manual plan using such an Add for its second domain could be rejected (no such Add is scripted today: Daughter of the Void is commented as producing the first domain) | **FIX** (latent), ENGINE-6 |

## Needs a user or lead decision

1. **A-3**: may the attacker put combat damage on a prevent-all or takes-no-damage unit instead of killing the next unit
   in order? The validator says yes, `forced()` says no.
2. **A-1 default ordering, beyond Pareto**: for choices neither side dominates, a default order has to be picked. The
   proposal: floating pool → exhaust-only gear Adds (Seals) → recycle exhausted runes → exhaust-and-recycle ready runes →
   Adds that exhaust a unit/legend or kill a token (Gold) last. The override (A-1) covers disagreements.

## BASICS cross-check (BASICS agent, 2026-11-26)

`tests/basics` (docs/basics-findings.md) checks every auto-pay in a generated matrix of ordinary plays: 17 turn moments ×
133 synthetic kinds plus 15 real-card kinds × 13 resource states. It compares each one with an independent oracle
(`tests/basics/oracle.ts`): fewest runes recycled or Gold killed, then the most energy left, then the most power left;
free exhaust-only Adds count as costless. Payment-choice results only; no payment fix was made by BASICS.

| ID | Pattern | Cells | Verdict |
|---|---|---|---|
| B-1 | [A] or multi-domain [C] with ready runes of two domains: auto-pay recycles the first rune in play order, which can be the last rune of a domain while another domain has spares (matrix `plenty` / `goldSpare` cells, sole Calm rune listed first) | 220 of 14,363 (default run) | Same as **A-1** (ASK). Matrix groups are marked todo with this reference. |
| B-2 | A free Seal-shaped Add ([T]: Add [C]) left ready while a rune of its domain is recycled | 19 per Main-phase moment before AP-1 | **AP-1**, fixed by ENGINE-6 during the run. The matrix's `sealAdd` cells now pin it. |
| B-3 | Card payment starving its own "you may pay X" play trigger (unit [1] or [A], trigger [1] / [C] / [A]) | 0 | SAFE in these shapes. The check stays in the matrix. |
| B-4 | Resolution-time "pay any amount of [A]": the maximum offered equals what can be paid, and Daughter of the Void's spells-only [A] is not used for it | 0 | SAFE |
| B-5 | `manualPay`: "auto" and "manual with `data.suggested`" give exactly the auto-pay result; an empty plan or one that exhausts an exhausted rune is refused; [0] costs raise no decision | 0 | SAFE (`tests/basics/manual-pay.test.ts`) |

## ENGINE-7 status (2026-11-26)

| ID | Status |
|---|---|
| E1 | DONE: the `payment` Decision lists every usable Add source in `data.adds` (`{key, obj, label}`, payment.ts `paymentAdds`; Adds whose `only` can't pay this purpose are left out). |
| E2 / A-2 | DONE: `manualPay` is honoured by every payment (payment.ts `choosePayment`): plays, abilities, hide, moves (play.ts `payResources`), trigger costs and accepted Deflect (chain.ts), `ctx.pay` / `payResolved` / `mayPay` during a resolution (context.ts), token Accelerate (actions.ts). Effect plays (Nocturne, Void Rush) already went through `payResources`. |
| F-4 | DONE: one ability's instances from different event objects are ordered by the player (rules-decisions #69). The 5 tests answer the prompt (B2 Nasus, B7 Wraith of Echoes, B8 Nine-Tailed Fox, r1301 RJ#1327, r6501 RJ#6923). |
| F-6 | DONE: `validatePlan` matches a multi-domain [C] Add by any of its domains and `executePayment` fills a missing `addDomains`; it also no longer counts an Add's restricted (`only`) energy/power for another purpose (a manual plan could underpay before). |
| A-1 / B-1 | DONE (default ordering): rules-decisions #66 tie-break (`domainKeepScore`). The BASICS 'domain' known-failure (154 todo cells) now passes and is a hard check (tests/basics/driver.ts). |
| A-3 | DONE: rules-decisions #67 (DECISIONS A-3); `forced()` unchanged (it was right). |
| F-5 | done by ENGINE-6 (batch 5). |

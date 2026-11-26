# Riftforge Rules Spec (implementation-ready restatement of the Riftbound Core Rules)

Status: COMPLETE (v1, 2026-11-25). Every section is marked DONE. Open questions are in §23 at the end.
Keyword detail lives in docs/keywords.md; scenario tests in docs/rules-tests.md.

Source baseline: **Core Rules 1.5 ("Radiance")**, official PDF dated 2026-10-09 on the rules hub, with the
Radiance patch effective 2026-10-16. Text read via the riftboundfaq.com mirror of CR 1.5 and the official
patch notes. Rule numbers (`CR xxx`) are CR 1.5 numbers. NOTE: the hyperlinked copy at
jeff425.github.io is CR 1.4 (effective 2026-07-16) and its numbering differs from 1.5 in places (e.g.
in 1.4 "Game Actions" starts at 407; in 1.5 the game actions start at 408). Always cite 1.5.

This is a paraphrase written for engine programmers, not the official text.

Conventions used below
- **DECISION:** marks every point where a player makes a choice. The engine must raise a `Decision`
  for it (auto-resolve only if there is exactly one legal option AND the choice is not optional).
- **ENGINE:** marks implementation notes / inferred behaviour not literally stated by the CR.
- "TP" = Turn Player. "Board" = bases + battlefields (+ facedown zones). "Pool" = rune pool.

---------------------------------------------------------------------------------------------------

## 0. Golden rules (CR 000-056) — DONE

- CR 002 Golden rule: card text beats the rules when they directly contradict.
- CR 051 Silver rule: card wording is interpreted through the rules; it is not itself a rule.
- CR 052 In card text, "card" means a Main Deck card. Runes, legends and battlefields are NOT "cards"
  for card effects (they are cards only for rules purposes).
- CR 053 Self reference: units/legends say "I/me"; gear and spells say "this"; battlefields say "here".
  A card naming itself means the same thing.
- CR 054 "Can't" beats "can". If something may be done "only" under a condition, it can't be done otherwise.
- CR 055 Do as much as possible; skip impossible instructions. If all are impossible the card is still
  played and resolves, doing nothing (055.1).
- CR 056 A card can never enter another player's non-board zone (main deck, rune deck, trash, hand,
  champion zone, banishment). If it would, it goes to its OWNER's matching zone instead.

---------------------------------------------------------------------------------------------------

## 1. Turn structure (CR 300-317) — DONE

### 1.1 General
- CR 302-306: players take turns in turn order until someone wins. Within a phase, actions happen in any
  order unless specified; game actions are performed one at a time, never simultaneously (303.1-303.2).
- CR 303.2.a: when several actions/effects/triggers happen "at once", order them by turn order starting
  with the TP.
- CR 305: a phase/step ends when the chain is empty and the TP cannot or will not take any more
  discretionary actions.

### 1.2 Turn states (CR 307-310)
Two independent flags:
- **Neutral** (no showdown/combat in progress) vs **Showdown** (a showdown or combat in progress).
- **Open** (no chain exists) vs **Closed** (a chain exists).

| State            | What may be played/activated by the player with priority                          |
|------------------|------------------------------------------------------------------------------------|
| Neutral Open     | Anything legally timed, by the TP only, in their Main Phase (CR 310.1.a, 316.5.b)   |
| Neutral Closed   | Only Reaction cards/abilities                                                       |
| Showdown Open    | Only Action or Reaction cards/abilities, by the player with Focus                   |
| Showdown Closed  | Only Reaction cards/abilities                                                       |

ENGINE: Store `chain.length > 0` as Closed and `showdown != null` as Showdown; derive the state.

### 1.3 Priority and Focus (CR 311-313)
- At most one player has **Priority** (the right to take discretionary actions). With no priority holder,
  nobody may take discretionary actions; Limited actions still happen when instructed (312.1.b.1).
- A player receives priority (312.2):
  a. in Neutral Open during their own Main Phase;
  b. in a Showdown when they gain Focus;
  c. in a Closed state, after pending chain items are finalized, if they control the newest chain item;
  d. in a Closed state, when the current priority holder passes and they are next in turn order.
- At most one player has **Focus**. Focus = the right to act in Showdown Open. Gaining focus also gives
  priority; passing priority does NOT remove focus (313.2-313.3). In Neutral state nobody has focus.

### 1.4 Phases in order
1. **Awaken** (CR 315.1): TP readies everything they control that can be readied (units, gear, runes,
   legend). ENGINE: no decision.
2. **Beginning phase** (CR 315.2)
   - Beginning step: "at the start of your turn / beginning phase" effects trigger (315.2.a).
   - **Scoring step**: TP **holds** every battlefield they control (CR 315.2.b, 471.2) → each held
     battlefield scores (see §7). Hold triggers fire. In team play, battlefields held by a teammate are
     not scorable by that team this turn (315.2.b.3).
3. **Channel phase** (CR 315.3): TP channels 2 runes from the top of their rune deck (ready, CR 431.2.a).
   If fewer than 2 remain, channel as many as possible.
   - 1v1: the player going second channels **1 extra rune (3 total)** in their FIRST channel phase only
     (CR 487.7 duel / 488.7 match).
   - FFA / 2v2: the LAST player in turn order channels 1 extra on their first channel phase (489.7, 490.7, 491.7).
4. **Draw phase** (CR 315.4): TP draws 1. If the main deck is empty the TP **Burns Out** first (§9.3),
   then still draws 1 (315.4.b.2).
   - FFA / 2v2 only: the FIRST player skips their first draw (489.7 etc). 1v1: nobody skips the draw.
5. **Main phase** (CR 316)
   - Step 1: every player's rune pool empties (unspent energy/power lost) (316.3).
   - Step 2: "at the start of your main phase" effects (316.4).
   - Then open play: TP takes any number of discretionary actions in any order (316.5): play cards,
     activate abilities, Standard Move units, Hide cards, (and conquer/showdowns/combat happen as a
     consequence via cleanups). Only the TP may play/activate in Neutral Open.
   - DECISION (`mainAction`): TP chooses one of: play a card (hand / champion zone / facedown /
     other permitted zone), activate an ability, standard-move a group of units, hide a card, or **end
     turn**. Also concede (any time).
   - CR 316.9: when the TP declares end of turn, the Main phase ends.
6. **Ending phase** (CR 317)
   - Ending step: "at end of turn" / "end of this turn" effects trigger (317.1).
   - Expiration step (317.2): run an **Ending Special Cleanup** = a normal cleanup (§5) with extra steps
     inserted after step 3b: 3c heal ALL units (all players); 3d all "this turn" effects expire
     simultaneously (this also clears Stun — CR 424.1.a.2); 3e every player's rune pool empties.
     If anything went onto the chain and was processed during this, repeat the Expiration step from the
     start (317.2.f).
   - Next player in turn order becomes TP (317.3).

ENGINE: "this turn" modifiers expire at 3d of the expiration step, i.e. AFTER end-of-turn triggers
resolve. Damage is healed on every unit at the end of every player's turn (CR 143.3.b.1), not only the TP's.

### 1.5 Tasks and the HOT-FEPR loop (CR 332-336)
A **Task** = mandatory steps (cleanups, start-of-turn steps, combat steps, end-of-turn steps). The game
loop is: **H**andle **O**utstanding **T**asks, then process the chain with **F**inalize, **E**xecute,
**P**ass, **R**esolve (CR 334). New tasks that appear during FEPR: finish the current FEPR step, do the
tasks, then continue (334.2.a). With no tasks, no pending items and no showdown: TP gets priority in the
Main phase; in other phases the game advances (335). With an ongoing showdown, the Focus holder gets
priority (335.1).

---------------------------------------------------------------------------------------------------

## 2. Resources: runes, energy, power, pool (CR 160-168, 201-206, 356-357, 445) — DONE

### 2.1 Runes
- Rune deck: exactly 12 runes, kept separate (CR 103.4, 161.2.a). Runes are channeled (not played),
  stay on the board in their controller's base, and are NOT permanents (CR 133.5.a.1, 161.1).
- Each **basic rune** has two abilities (CR 164.2), both Reaction-speed "Add" abilities:
  - `[Exhaust]: Add 1 energy`.
  - `Recycle this rune: Add 1 power of this rune's domain` ([C]).
  ENGINE: a rune can be exhausted for energy AND then recycled for power in the same payment (recycling
  does not require it to be ready). Recycled runes go to the BOTTOM of their owner's rune deck (CR 161.2.b,
  417.1.b); if several go at once the owner chooses their order (417.5.a — DECISION, may be auto-ordered
  by the UI with an option to reorder; low importance).
- Runes are recalled to base during cleanup if somehow at a battlefield (CR 323.6).

### 2.2 Energy and power (CR 163)
- **Energy**: generic, domainless; pays the numeric energy cost.
- **Power**: has a domain; pays domain symbols in a power cost. **Universal power [A]** pays any domain
  (CR 135.2.e.5). [C] on a card means one power of that card's domain; on a domainless card [C] = [A];
  on a multi-domain card [C] = power of any one of its domains (135.2.e.6).
- Domains: Fury [R] red, Calm [G] green, Mind [B] blue, Body [O] orange, Chaos [P] purple, Order [Y]
  yellow (CR 134.2). (Older text used [S] for Might and [T] for Exhaust; now [M] and [E].)

### 2.3 Rune pool (CR 165-168)
- A per-player pool of energy and power. Added resources go to the adding card's controller's pool.
  Resources must be in the pool before being spent (166.2).
- **The pool empties at the start of each player's Main phase and at the end of each turn** (CR 167,
  316.3, 317.2.d). Unspent resources are lost. ENGINE: so resources added in Beginning phase (e.g.
  by a hold trigger) are lost when the Main phase starts; resources added during an opponent's turn are
  lost at the end of that turn.
- "Add" abilities (CR 430): triggered/activated abilities that Add resources finalize immediately and
  resolve immediately, even mid-task or mid-resolution; priority/focus do not pass; the current step is
  paused until they finish (430.2). Reaction "Add" abilities (runes, Gold token, etc.) may be activated
  any time a cost must be paid, including during the Pay Costs step (430.3, 445.2.c). Spells that add
  resources use normal spell timing (430.2.b).

### 2.4 Costs (CR 201-206)
- A **cost** must be paid to get the linked effect; if a player can't perform the cost's action they
  can't pay it and get nothing (203.3). A cost counts as paid even if the action was replaced (203.2).
- Kinds (CR 204):
  - **Base cost**: card's printed cost (energy number + power symbols); activated ability = everything
    before ":" (if alternatives listed, DECISION: choose one); triggered ability = a cost at the start of
    its effect (e.g. "you may pay [1] to ..."), paid when the trigger finalizes.
  - **Additional costs**: "as an additional cost ..." — mandatory unless worded with "may". Optional
    additional costs: DECISION at Make Choices step (CR 355.1) whether to pay.
  - **Costs inside instructions**: "do X to do Y" — paid during resolution (DECISION: pay or not).
  - **Applied costs**: a passive "must pay X to do Y" attached to a game action; paid as the action
    happens, no chain; if not paid the action can't be done (204.4).
- CR 205: an instruction to pay with no linked effect is not a cost.
- CR 206: when an effect asks for a card's cost, use the PRINTED cost (or copied cost), not the modified one.
  For abilities, the base cost.
- Tokens have cost 0 and no domains (CR 185.3).

### 2.5 Determining total cost (CR 356) — apply in this order
1. **Base cost modifications** (any order): "for [cost]" replaces the base cost; "ignore [its] cost"
   sets the base energy and/or power cost to 0 (separately) — later additions can still raise it.
2. **Additional costs**: mandatory ones (incl. **Deflect** tax on targeting) and chosen optional ones.
3. **Cost increases**.
4. **Discounts**: component discounts first (applied as that component is added, can't go below 0),
   then total-cost discounts; a minimum stated by a discount applies only to that discount; variable
   discounts are evaluated when applied. Additional costs can be reduced to 0 (an optional one still
   counts as paid if chosen).
5. Other total-cost modifications ("ignore any and all costs" → total 0, incl. non-standard costs).
- Energy/power costs never go below 0 (356.6).
- A [0] component is paid automatically without a Pay action (445.1.b).

### 2.6 Paying (CR 357, 445)
- Pay energy + power together, then non-standard costs (exhaust, kill, discard, recycle, spend XP...) in
  any order. Reaction Add abilities may be used mid-payment to generate resources (357.1.a).
- DECISION (`payment`): which runes to exhaust/recycle and which pool resources to spend. ENGINE: offer
  an auto-pay plan (prefer exhausting for energy, recycle only for needed power, prefer runes whose domain
  is least needed later) with manual override. A player may decline to pay → the play is undone (445.2.a,
  CR 358.5).
- Don't pay in a way that deterministically makes later required choices illegal unless unavoidable (357.3).

---------------------------------------------------------------------------------------------------

## 3. Playing cards and activating abilities (CR 349-359, 399-407, 420) — DONE

### 3.1 Who may play what, when
- Default (CR 310.1.a, 155, 381, 145.2, 151.2): cards and activated abilities are played by the TP, in
  their Main phase, in Neutral Open, while they hold priority.
- **Action** keyword (CR 159.2.a / 806): may also be played in Showdown Open (by the Focus holder),
  including on the opponent's turn during a showdown they are in.
- **Reaction** keyword (CR 159.2.b / 813): has all Action permissions AND may be played in any Closed
  state (when you have priority, on any player's turn). Resolves before items already on the chain
  (because it is added on top).
- Default play locations: from hand or from the Champion Zone (CR 420.1.a). Hidden cards from the
  facedown zone (see keyword Hidden). Other zones only when an effect permits.
- Triggered abilities go on the chain at any time on any turn (383.3.c).

### 3.2 The process of play (CR 353-359) — six steps
1. **Move to chain** (354): card (or ability / token) becomes a Pending item on the chain; the state
   becomes Closed. Finish any resolving effect and any outstanding tasks first.
2. **Make choices** (355): all choices not deferred to resolution:
   - DECISION: whether to pay each optional additional cost (incl. optional "may" costs like Accelerate).
   - DECISION (units): where the unit enters — controller's base OR a battlefield they control (unless an
     effect widens this, e.g. Ambush/Hidden/"play to a battlefield") (355.2).
   - DECISION (`chooseMode`): modes from a bulleted list (355.3).
   - DECISION: move destinations, which must differ from the current location (355.4).
   - DECISION (`chooseTargets`): specific objects/players/zones the text tells you to choose → these
     are **targets** (355.6). Criteria-picked objects ("each", "all") are not targets. Triggered and
     delayed ability choices are made when THEY go on the chain, not now.
   - DECISION (`chooseX`): value of X if any. ENGINE: CR 1.5 doesn't spell out X; treat as a Make
     Choices step choice.
   - DECISION: if a card divides damage, choose the recipients now (each must get ≥1; #targets ≤ amount);
     the split itself is decided on resolution (355.14).
   - Targeting rules (355.7-355.17):
     - "unit/gear/rune" default to board objects; "spell/ability" to chain objects; "facedown card" to
       facedown zones; "legend" to legend zones; "Champion" to champion zones.
     - Something is NOT targeted if: in a non-public zone; mentioned only as part of a restriction;
       only in a cost / trigger condition / replacement; game-selected by characteristics with no
       possible choice; chosen by another player; identified in a "must" instruction; or it is "your
       legend" (but "a friendly legend" IS targeted) (355.10).
     - A spell/ability can't target itself (355.9). "Any number"/"up to" allows zero (355.13).
     - Group targets: if the group later becomes illegal, controller picks the maximal legal subset; can't
       add new ones (355.11).
     - Choices are locked once made (355.15). You may not make choices that deterministically force an
       illegal state later unless no alternative (355.16). Mandatory requirements from effects must be
       honoured if possible; restrictions must be obeyed or the card fails to finalize (355.17).
     - Everything not chosen now is chosen on resolution (355.18).
3. **Determine total cost** (356) — §2.5.
4. **Pay costs** (357) — §2.6.
5. **Check legality** (358): choices legal, targets legal, costs paid, the effect would not create an
   illegal state (e.g. three players' units at a battlefield, a permanent played into someone else's
   base), and timing permission OK: in a Closed state the card needs Reaction (unless it is the item that
   closed the state); if it closed a Showdown-Open state it needs Action or Reaction (358.4). If any
   check fails, undo everything and cancel the play (358.5). A "prevent"-style effect does not stop a
   card instructing that action from being played (358.3.a).
6. **Finish** (359):
   - Permanents (units, gear): leave the chain and become board objects immediately — **they resolve
     immediately when finalized and cannot be responded to** (CR 337.2, 359.2). Units enter
     **exhausted** at the chosen location (unless Accelerate etc.); non-unit gear enters **ready** at
     its controller's base (149.1-149.2). Their "when you play me" triggers then go on the chain as
     pending items (383.4.a.2) — those can be responded to.
   - Spells stay on the chain as Finalized items; players may respond with Reactions; when it resolves
     its text executes top to bottom, then the card goes to its owner's trash (359.3).
   - A card counts as "played" only after the whole process completes (350.1). Play triggers ("when you
     play a spell") occur when play is completed by resolution; a countered card never counts as played
     (420.4.a.1, 426.1.b). Non-trigger checks ("if you played a card this turn") refer to finalization
     (420.4.b).

### 3.3 Resolving with illegal targets (CR 359.3.e) — "partial fizzle"
- A spell still resolves even if some/all targets are illegal. A target is illegal if it no longer meets
  requirements or changed to/from a non-board zone (that makes it a new object; it stays illegal even if
  it returns).
- If ALL targets of an instruction are illegal at resolution start, that instruction doesn't execute;
  if some are, it executes on the legal ones. Instructions that depend on an illegal target's info are
  Ignored; instructions that just can't be done are Negated (distinction matters for linked
  instructions: if the earlier is Ignored, a linked later one is Ignored too; a Negated earlier action
  doesn't stop a later one unless it directly references it) (359.3.e.14).
- If a spell leaves the chain mid-resolution it stops executing (359.3.e.15).
- "Here", "my", "its" are evaluated when the instruction executes; trigger-condition info is locked when
  the condition was met (359.3.f). "Friendly"/"enemy" in a trigger's effect are checked on execution.

### 3.4 Abilities (CR 360-407)
- Types: passive, replacement, activated, triggered, delayed (362).
- **Passive** (363-366): statements of fact; usually only work on the board; cost modifiers work in any
  zone the card can be played from (366.2).
- **Activated** (376-381): "cost: effect". On the chain like a spell with no card. Controller of the
  source decides (378); default timing = controller's Main phase, Neutral Open (381) unless Action/
  Reaction. Units and gear may have them (145, 151). An activated ability with no legal choices can't be
  activated (403.3). "Only if/at ..." conditions must hold at activation (377.2.b).
- **Triggered** — see §8.
- Process of activating (399-407): same six steps as playing a card. Abilities that Add resources resolve
  immediately on finalization (401.2).

---------------------------------------------------------------------------------------------------

## 4. The chain (CR 325-340) — DONE

- One chain at most (330.1). It exists while it has ≥1 item. Anything played while a chain exists is
  added to it. Items start **Pending** and become **Finalized** after Check Legality (329).
- **FEPR**:
  1. **Finalize** (337): the controller of the OLDEST pending item completes its play steps (choices,
     cost, pay, legality) until it is finalized or leaves the chain. Finalizing does not pass priority.
     Pending items finalize in the order added. A finalized Unit, Gear, or Add-ability resolves at once
     (go to step 4 for it). Repeat while pending items remain. Then the controller of the newest chain
     item gains priority → step 2.
  2. **Execute** (338): DECISION (`chainResponse`): the priority holder either plays a legally timed
     card/ability (Reaction, in a Closed state) → it becomes pending → back to step 1; or **passes**
     → priority goes to the next player in turn order → step 3.
     - 338.1.a.5: the first player to get priority after a chain is created may add an item "alongside"
       the starting one (i.e. the initiator can respond to their own spell first).
  3. **Pass** (339): if every player passed in sequence without adding anything → step 4; otherwise
     the next player gets priority → step 2.
  4. **Resolve** (340): the NEWEST finalized item resolves completely. Then:
     - chain empty → Open state. If in a showdown and the chain was NOT started by a triggered ability or
       Add ability, **Focus passes** to the next player in turn order (340.2.a, 346).
     - pending items exist (e.g. triggers created during resolution) → step 1.
     - otherwise the controller of the newest remaining item gets priority → step 2.
- While something is resolving, nothing else can finalize or resolve, including its own triggers; all
  of a spell's effects finish before items/tasks it created are handled (158.3).
- Cleanups never happen while an item is resolving; they queue up and run afterwards (321).

ENGINE: priority after resolution goes to the controller of the newest remaining item (not the TP).
After all pass in sequence the top item resolves — there is no "everyone passes once more" requirement
beyond the single sequence of passes since the last addition.

---------------------------------------------------------------------------------------------------

## 5. Cleanups / state-based checks (CR 318-324) — DONE

### 5.1 When a cleanup happens (319)
After: entering or leaving an Open/Closed state; any phase transition; a pending item is added to the
chain; a pending item is finalized; any chain item leaves the chain; any object enters or leaves the
board; any object's status changes; any move completes. Cleanups are not run while a chain item is
resolving (queued). During a cleanup nothing finalizes/resolves and priority/focus don't move, but new
pending items (triggers) may be added (320). If a cleanup changes anything that would cause another
cleanup, run another immediately; repeat until stable (322).

### 5.2 Steps of a cleanup, in order (CR 323)
1. **Win check**: a player with points ≥ victory score AND strictly more than every other player wins.
2. **Combat designations** (only in ongoing combat): units at the combat battlefield without a designation
   take their controller's (attacker/defender); units with the wrong designation take the controller's;
   units elsewhere lose any designation.
3. **Board state**
   - 3a. Kill every unit with lethal damage (damage ≥ Might and damage > 0) → owner's trash (deathknell
     triggers are processed before the zone change).
   - (3b reserved / used by special cleanups; 3c, 3d, 3e are inserted by Ending and Combat special cleanups.)
4. **Lose control**: in an Open state with no showdown/combat at that battlefield, a player who controls
   a battlefield where they have no units loses control (battlefield becomes uncontrolled).
5. **Recall** (unless an effect says otherwise) to the controller's base: unattached non-unit gear at
   battlefields (except Deploy gear, see §12); non-unit runes at battlefields; unattached permanents/runes
   in a base other than their controller's. 5a: facedown (Hidden) cards at battlefields not controlled
   by the card's controller go to their owner's trash.
6. **Stage showdowns**: at each Contested battlefield with no ongoing combat, mark a Showdown Staged
   (stays staged while contested and the contesting player has units there).
7. **Stage combats**: at each Contested battlefield where opposing players have units and no combat is
   ongoing, mark a Combat Staged. 7a: if the opposing units leave before it opens, unstage it.
8. **Remove Contested** from battlefields where the contesting player has no units and no showdown/combat
   is ongoing; 8a: if that leaves units at an uncontested battlefield their controller doesn't control,
   that controller now applies Contested there.
9. In Neutral Open: if showdowns are staged at battlefields WITHOUT a staged combat → DECISION
   (`chooseBattlefield`, TP): pick one; that showdown begins.
10. In Neutral Open: if combats are staged → DECISION (`chooseBattlefield`, TP): pick one; that combat
    begins (with its combat showdown).
11. (10a) In Showdown Open: if a combat is staged at the battlefield of an ongoing non-combat showdown,
    that showdown becomes a combat showdown (combat starts there).
- Special cleanups (324): Ending (§1.4) and Combat (§6.4) add steps. If a special cleanup causes another
  cleanup, that one is a normal cleanup.

ENGINE: steps 9-10 only fire in Neutral Open, i.e. after the chain is empty. In normal 1v1 play a move
creates at most one contested battlefield at a time, so the TP choice usually auto-resolves; it matters
with Ganking/multi-destination effects and spells that move enemy units.

---------------------------------------------------------------------------------------------------

## 6. Battlefield control, showdowns, combat (CR 188-192, 341-348, 459-468) — DONE

### 6.1 Battlefield control and Contested (CR 190)
- A battlefield is Controlled (by one player) or Uncontrolled. States referenced by cards: Occupied (a
  unit is there), Uncontrolled, Open (unoccupied AND uncontrolled) (170.11).
- **Contested** is a temporary status applied when a unit whose controller does NOT control the
  battlefield moves there, is played there, or changes controller while there — if not already
  contested (190.3.a). The applying player is remembered ("contesting player"). ENGINE: store
  `contestedBy: PlayerId | null` per battlefield.
- Once a showdown/combat begins there it stays contested until control is (re)established. If the
  contesting player has no units there and no showdown/combat is ongoing, it's removed at next cleanup.
- Control is established by having units there at the END of a showdown or combat (190.4). Outside combat
  a player keeps control while they have units there; control can't change mid-showdown/combat except as
  the steps say. A controller with no units there loses control at the next cleanup in an Open state.
- Battlefield abilities are controlled by the battlefield's controller; if uncontrolled, the TP puts them
  on the chain and makes their choices (190.6). "You" on an uncontrolled battlefield → that instruction is
  ignored (190.6.d).

### 6.2 Non-combat showdown (CR 341-348)
- Begins at a cleanup (step 9) when a battlefield is contested, in Neutral Open, and no units of different
  players are there (e.g. you moved to an empty, uncontrolled or enemy-controlled-but-empty battlefield).
- **The contesting player gets Focus first** (345).
- Loop, DECISION (`showdownAction`) for the Focus holder: play a legally timed Action/Reaction card or
  ability (starts a chain; when that chain is fully resolved, focus passes to the next player in turn
  order) — or **pass** (focus goes to the next player). When **all players have passed in succession**
  without doing anything, the showdown ends (347.2.a, 348).
- On end (348.2): if only one player's units remain there and that player doesn't control it, they
  **establish control**; that is a **Conquer** if they haven't scored it this turn (§7). If an opponent's
  units arrived during the showdown, it becomes a combat showdown at the next cleanup (316.8.b.1.a).
- ENGINE: focus passes after a chain resolves ONLY if that chain was started by a played card/activated
  ability, not if it was started by a triggered ability or an Add ability (346.1).

### 6.3 Combat (CR 461-467)
- Combat happens when a cleanup runs with an empty chain, a combat is staged, and no other showdown/combat
  is ongoing elsewhere (462). Only two players can ever be in a combat (464). If several are staged, the
  TP picks the order (463.1) — DECISION.
- **Step 1: Combat showdown** (466):
  - Task 1: "start of combat" effects (and "start of showdown" effects at the same time).
  - Task 2: **Attacker = the player whose units applied Contested; Defender = the other player**. Both
    players and their units there get the designation; later arrivals get it in the next cleanup. The
    attacker gets Focus (if a showdown was already ongoing, its focus holder keeps focus).
  - Task 3: triggers from attack/defend designations go on the chain: attacker's first, then other
    non-defenders in turn order, then the defender's (466.2.d.1). DECISION (`orderTriggers`) within each
    player's group. If a chain was created the showdown is Closed; resolve it normally.
  - Then the showdown loop as in §6.2 (attacker acts first). When all pass in succession → step 2.
- **Step 2: Combat damage** (467) — only if BOTH attacking and defending units are still at the battlefield:
  - Each side's total = sum of current Might of its units there (negative Might counts as 0; **Stunned
    units contribute 0** (424.1.b)).
  - **Starting with the attacker**, each player assigns damage equal to their total among the opponent's
    units there. DECISION (`assignDamage`). Assignment rules:
    - A unit must be assigned **lethal** before ANY damage goes to another unit (see the lethal note below
      for how already-marked damage counts).
    - A unit can't be assigned more than its minimum lethal amount unless every other enemy unit there
      already has lethal assigned (i.e. excess goes anywhere only once all are lethal).
    - **Tank** units must be assigned lethal first; **Backline** units last; units in the same priority
      tier in any order. A unit with both Tank and Backline: assigner picks which applies (467.2.c.8-9).
    - Prevention/doubling effects are taken into account when deciding what is "lethal" (467.2.c.5,
      438.5): e.g. a unit with "prevent next 2" needs Might+2 to be lethal; a unit with "prevent all" has
      no lethal amount. A unit that can't be dealt damage at all is exempt from the must-assign ordering
      (467.2.c.10). **SUPERSEDED in part** by docs/riftjudge/DECISIONS.md row A-3 / principle 24: the "prevent all"
      unit is NOT exempt (467.2.c.10 Counter Strike example) — it stays in the order, can't be passed once
      reached in its tier, and receives all remaining damage (a shielded Tank absorbs the whole attack);
      only the can't-be-dealt-damage unit is exempt, and it receives damage only as excess.
    - If the total is less than one unit's lethal, it all goes to the first unit that must receive it
      (attacker may still choose among same-tier units).
  - Then **all assigned damage is dealt simultaneously** (467.2.d). Sources: damage to attackers comes from
    the defenders and vice versa (418.6.c).
  - Then skip FEPR, cancel outstanding tasks, go to step 3 (467.3). ENGINE: triggers caused by the damage
    (e.g. "when I'm dealt damage") are queued and resolved in step 3 (468.2).
- **Step 3: Resolution** (468):
  - Task 1: **Combat special cleanup** = normal cleanup + 3c **heal all units** (after 3a killed lethal
    ones) + 3d **recall the attackers to base if any defenders are still there**. Then resolve any chain
    items created by combat damage / this cleanup.
  - Task 2: result: a designated player **wins** if they're the only one with units there; **loses** if
    they're the only one without. Units inherit their controller's result. **No result** if attackers were
    recalled in 3d, if both still have units, or if neither does. If no result and both still have units
    (possible via effects), a new showdown and combat are staged here. Resolve chain items.
  - Task 3/4: if nothing is staged here, the player with units remaining **establishes control** if they
    don't already: clear Contested; if nobody has units, the battlefield becomes Uncontrolled; trash Hidden
    cards here whose controller ≠ the battlefield controller; establishing control = **Conquer** if that
    player hasn't scored this battlefield this turn. (The conqueror need not be the attacker — 468.5.e.)
  - Task 5: combat ends: remove attacker/defender designations; "end of combat" effects; "this combat"
    effects expire.

ENGINE notes on lethal: CR 142.4.a-b defines lethal damage as the TOTAL marked damage that kills the unit
in a cleanup: a nonzero amount ≥ the unit's Might (example in the CR: a 5-Might unit with 3 damage
marked that drops to 3 Might now has lethal damage marked). Marked damage persists until the end of turn,
so a unit damaged earlier in the turn needs less. Implement
`lethalToAssign(u) = max(1, max(0, effectiveMight(u)) − u.damage)` (min 1 because valid damage is ≥1 —
a unit already at lethal is killed in cleanup before combat damage anyway), then adjust for prevent /
double / increase replacement effects on that unit, and `Infinity` for "prevent all". Units with 0 or
negative Might: lethal = 1. Elder Dragon-style effects ("any amount of your damage is enough to kill")
lower the threshold to 1 for the affected units. INFERENCE: CR text on assignment does not literally
mention pre-marked damage; this follows from the unified lethal definition (Vendetta patch note
"Lethal damage is unified across the document").

### 6.4 Ties, both sides dying
- If both sides' units all die, nobody has units → No result; battlefield becomes Uncontrolled (468.5.b).
  The defender loses control of it if they controlled it. Nobody conquers.
- If attacker's units all die and defenders survive: defender wins; defender keeps control (no conquer,
  they already controlled it — or if it was uncontrolled with defender units present, they establish
  control → that IS a conquer for the defender if not already scored).
- If defenders all die and attackers survive: attacker wins and conquers (if not scored this turn).
- If both survive: attackers recalled to base; no result; defender retains control.

---------------------------------------------------------------------------------------------------

## 7. Scoring: conquer, hold, points, final point (CR 193-196, 469-474) — DONE

- **Scoring** ≠ gaining points (470.1). "Score N points" in card text = gain N points. "Score" with no
  number = the scoring process.
- Two ways to score (471):
  - **Conquer**: gain control of a battlefield you haven't scored this turn (via showdown end or combat
    resolution establishing control).
  - **Hold**: during your Beginning phase scoring step, you control a battlefield you haven't scored this
    turn.
- **Each battlefield can be scored by a given player at most once per turn**, by either method (472).
  ENGINE: `scoredThisTurnBy` per battlefield; reset at turn start. A player who conquers a battlefield,
  loses it, and re-conquers it the same turn gets nothing the second time (and no conquer triggers).
- When a player scores (473): they gain 1 point (subject to the final point rule) AND that battlefield's
  score abilities trigger ("When you conquer here" / "When you hold here"), plus the player's/units'
  conquer or hold triggers (383.4.c-d). Conquer/hold triggers fire even if the point gain is replaced or
  negated (383.4.c.2.c).
- **Final point rule** (473.1.b): applies only to points from **Conquer**. If a player tries to gain a
  point by conquering while they are at (victory score − 1) or higher, they gain that point only if they
  have scored **every battlefield** this turn (counting this one); otherwise they **draw 1 card instead**.
  Points from Hold, card effects, burn out are not restricted. ENGINE (1v1, 2 battlefields, VS 8): at 7
  points, conquering battlefield B wins only if you already scored battlefield A this turn (by hold or
  conquer); else draw a card. Conquer triggers still fire.
- Points can't go below 0; losing points at 0 does nothing and doesn't trigger "lose points" effects (194.4).
- **Winning** (194.2, 323.1): checked at every cleanup (step 1): a player with ≥ victory score AND more
  points than every other player wins. If tied at or above the score, play continues until a cleanup finds
  a single leader. Default victory score 8 (1v1, FFA); 2v2 = 11.
- Also: a player wins if an effect says so, or if they are the only player left (195). Burn out chains can
  award an immediate win (432.3.c.1).

---------------------------------------------------------------------------------------------------

## 8. Triggered abilities (CR 382-398) — DONE

### 8.1 Recognition and checking
- Trigger words: "When [event]", "At [point in turn]", "The Nth time [event]" (383.1), anywhere in the
  sentence. Keyword triggers: Deathknell, Temporary, Vision, Hunt, Disarm, Quick-Draw, Weaponmaster,
  Deploy's kill trigger.
- A condition clause directly after the trigger ("When you play a spell, if it's your turn, ...") is part
  of the trigger: if false, nothing goes on the chain (383.2.a.1). If it went on the chain and the source
  later leaves, it still resolves (triggers are independent of their source, 393).
- The condition is checked AFTER the event is processed (383.2.c) — except leave-the-board triggers
  ("when I die", Deathknell, "when I leave"), which are processed immediately BEFORE the zone change, after
  replacement effects are applied; if a replacement stops the departure, they don't trigger; record the
  source's info (location, Might, controller) at that moment (383.2.c.3, 429.1.a.1.b).
- An object entering its active zone at the same moment the event happens CAN trigger; one leaving at that
  moment can't (383.2.c.1-2). Permanent triggers only work on the board unless they say otherwise (384-385).
- "Nth time" with simultaneous qualifying events: triggers once; controller picks the event (383.1.b).

### 8.2 Putting triggers on the chain
- A triggered ability goes on the chain as a pending item (like activating) at any time, in any state, on
  any turn (383.3, 383.3.c). It finalizes through the FEPR loop (choices → cost → legality).
- DECISION (`optional`): if the effect begins with "you may", the controller decides during finalization;
  declining removes it and it counts as never triggered (relevant for once-per-turn) (383.3.a). A "you may"
  later in the text is decided on resolution.
- DECISION (`payment`): a cost at the start of the effect (or right after the first "you may") is the
  trigger's base cost, paid at finalization; declining to pay removes it (not a counter) (383.3.b, 405.2).
- DECISION (`chooseTargets`): targets are chosen at finalization. If there aren't enough legal choices
  the trigger is removed (not a counter); if legal choices exist they must be made (403.4).
- **Simultaneous triggers** (383.3.d): DECISION (`orderTriggers`): each controller orders their own; across
  players, they're put on the chain in turn order starting with the TP (so the TP's go on first = resolve
  LAST, since the newest item resolves first). Combat start is a special case (attacker, others, defender —
  466.2.d.1).
- "Once each turn"/"N times each turn" (383.3.e, 386): after the limit, further events don't trigger it.
- **Play effects** ("when you play me/this"): go on the chain after the permanent is finalized and has
  entered the board (383.4.a). Triggers on OTHER cards being played ("when you play a spell") are not play
  effects; they fire when that card's play completes (spells: on resolution; countered ⇒ no trigger) (420.4).
- **Targeting effects** ("when you choose me", "when a unit is chosen"): trigger when the object becomes
  a target of a spell/ability (383.4.b).
- **Conquer effects** ("when I/you conquer"): unit ones need the unit present at the battlefield when
  control + point are gained; trigger even if the point is negated/replaced (e.g. final-point draw) (383.4.c).
- **Hold effects** ("when I/you hold"): unit at the battlefield during the scoring step when the player holds
  (383.4.d).
- **Attack/Defend triggers** ("when I attack"/"when I defend"): the FIRST time the unit (or player) gains the
  Attacker/Defender designation in a combat; checked once per combat; a unit arriving later in the combat
  gets the designation at the next cleanup and its attack trigger then fires (383.4.e-f).
- "Activate [named triggered abilities]" (383.4.g): treat the named part as satisfied, check the rest, put
  qualifying ones on the chain; no real event happened.

### 8.3 Reflexive, delayed, linked (CR 387-398)
- **Reflexive** ("Do this: ...", "Do one of the following: ...", "Do this N times"): creates new chain items
  when reached; "you may" decided at finalization (388-389).
- **Delayed** abilities have a window ("at the start of your next turn", "this turn, when ...", "the next
  time ...", "then banish it"): they exist independent of their source and fire even if the source is gone
  (391-393). A delayed ability whose window already ended is never created (359.3.e.16).
  "Then recycle/banish it" = if the card would leave the chain after finalizing (other than by its own
  execution), do that instead (391.3.a).
- **Linked** abilities on the same object (or granted by the same source) refer to each other's objects;
  "the banished card" means only the card banished by that same ability set (395-398, 428.3).

---------------------------------------------------------------------------------------------------

## 9. Replacement effects, prevention, skip, burn out (CR 367-375, 432, 438, 444) — DONE

### 9.1 Replacement effects
- Identified by "as", "would", "instead", "enters ready/exhausted", "then banish it", Prevent, Skip, Burn Out.
  They modify an event before it happens; the original event never happened (370).
- Each replacement can apply only once to a given event (incl. events that replace it) (370.2).
- DECISION (`chooseMode`/order): if several replacements apply to one event, the controller of the affected
  object (or the affected player; TP for an uncontrolled battlefield) picks the order (372). With
  simultaneous events, handle each separately; replacements controlled by the same player are ordered by
  them; different controllers in turn order (373).
- "You may" replacements: DECISION at the time of the event; declining = not applied (does not use up a
  "once each turn") (371.2, 386.2).
- Replacement effects that modify combat damage are applied during ASSIGNMENT (467.2.c.5): the assigner
  computes lethal through them. If multiple apply to a unit, its controller orders them (Vendetta FAQ: Ki
  Barrier vs Lotus Trap).

### 9.2 Prevent (CR 438)
- "Prevent the next X damage [from source] [this turn]" = a delayed replacement tracking a Prevent Value
  X on the unit. Each damage event is reduced by the remaining value (not below 0); the value decreases by
  the amount prevented; at 0 it expires. "All" never runs out (438.2-438.3).
- Fully prevented damage is not "dealt" at all: no damage triggers, no Elder-Dragon-style lethal (418.1.e.1,
  438.4).
- Bonus damage is included in the total being prevented (438.1.a.1).

### 9.3 Burn Out (CR 432, 414.4, 441.4)
- Triggered when a player tries to move more cards out of their Main Deck than it holds (draw, burn, mill,
  etc.). NOT triggered by looking at/revealing/predicting too many cards (432.1.c, 437.4).
- Procedure: do as much of the action as possible → shuffle the whole trash into the Main Deck (random) →
  **DECISION (`choosePlayer`, the burning-out player): choose an opponent; that opponent gains 1 point**
  (1v1: auto) → finish the action.
- If the deck is still empty (trash was empty) the next attempt burns out again; the 2nd+ points in a
  sequence can't be prevented/replaced, and if they bring someone to victory with the lead, they **win
  immediately** without waiting for a cleanup (432.3).
- Draw phase with empty deck: burn out, then draw 1 (315.4.b).

### 9.4 Skip (CR 444)
- "Skip X" replaces an event/procedure with nothing; nothing it would cause triggers.

---------------------------------------------------------------------------------------------------

## 10. Layers, continuous effects, timestamps (CR 473-482) — DONE

ENGINE: compute characteristics on demand (`getEffective(obj)`), never mutate printed values.

Layer order (CR 479; Radiance added the Copy layer as layer 1):
1. **Copy effects** ("becomes a copy of", "copy"): replace/add copyable traits (printed traits + printed
   rules text; NOT granted text, counters, statuses like Empowered/buffs/damage). Copying a copy copies the
   original's copiable values. Objects *created as copies* (e.g. token copies) instead get those traits as
   their printed traits (446.3).
2. **Trait-altering**: name, supertype, type, tags, controller, cost, domain, base Might, base Might bonus.
   Control-change effects live here.
3. **Ability-altering**: grant/remove keywords, abilities, rules text, effect text; attached cards' effect
   text is appended here.
4. **Arithmetic**: Might, energy cost, power cost modifications; attached Might bonuses; buffs (+1);
   Assault/Shield bonuses (while attacker/defender). **Increases apply before decreases** within this
   layer (479.4). "To a minimum of N" limits on non-passive effects are snapshotted when applied.
- Within a layer: dependency order first (if A changes whether B exists / what B applies to / B's outcome,
  apply A first; mutual dependency ⇒ ignore dependency), else **timestamp** order, earliest first (480-482).
- Timestamp = when the effect started applying. A permanent's rules text gets a new timestamp when it
  becomes active again (e.g. a detached card) (482.2).
- Objects are evaluated individually; if two objects reference each other, evaluate them simultaneously
  layer by layer (478.1).
- Effects apply instantly; there is no intermediate observable state (Vendetta FAQ: Dragon Form +
  Stupefy never shows 5 Might, so "becomes Mighty" doesn't fire).
- **Might values** (143.2): Printed (card), Base (after layer 2), Effective (after layer 4). Bare
  "Might" = Effective. Negative effective Might is treated as 0 when read by effects or when summing combat
  damage, but its true value is kept for further increases/decreases (−3 needs +4 to reach 1).
- Durations (`Modifier.duration`): permanent (until leaves zone), "this turn" (expires step 3d of
  Expiration), "this combat" (end of combat), while-source, "next turn"/"until your next X".
- A granted keyword/ability with no stated duration lasts while the object stays in its zone (801.3.a.3).
- Moving to/from a non-board zone creates a NEW object and ends all temporary modifications: damage,
  counters (buffs), granted keywords, statuses (exhausted, stunned, empowered...) (124).

---------------------------------------------------------------------------------------------------

## 11. Game actions reference (CR 408-446) — DONE

Each is a **Limited action** (only when instructed) unless noted. "Discretionary" ones are the player's
free choices in their Main phase: **play a card**, **activate an ability**, **standard move**, **hide**
(411, 420.2, 421.3, 422.2). Responsibility = the player who performs the action (412); kills are also
*attributed* to the spell/ability/unit that caused them (429.5).

| Action | CR | Behaviour summary / engine notes |
|---|---|---|
| Draw | 414 | Top of main deck to hand. Too few cards → draw what you can, Burn Out, draw rest. |
| Exhaust / Ready | 415-416 | Already exhausted can't pay an exhaust cost; re-exhausting does nothing. Awaken readies all. |
| Recycle | 417 | To bottom of owner's matching deck (main or rune). 2+ main-deck cards at once → **random order**; 2+ runes → owner orders (DECISION, low priority). As a cost must be fully payable; as an effect do as many as possible. "Recycle X from zone" = player chooses (not targeted). |
| Deal damage | 418 | Positive integer only. "Deal X for each Y" is ONE damage instance of X·count. Sources: the spell/ability, or a named unit; combat damage source = the opposing units. Controller of source is responsible. |
| Heal | 419 | Remove damage. All units heal at end of every turn and in combat cleanup. |
| Play | 420 | See §3. "Play [card] (from somewhere) for/ignoring cost" during resolution = Limited play: normal steps, with the effect's overrides; if no eligible card, nothing happens. |
| Move | 421, 447-455 | See §12. |
| Hide | 422, 811 | Discretionary. See keyword Hidden. A facedown card that changes zones (or game ends) is revealed. |
| Discard | 423 | Hand → trash without effect; player picks which (DECISION). As effect: as many as possible. "When discarded" triggers after. |
| Stun | 424 | Unit becomes Stunned (binary; can't stun a stunned unit → no "when you stun" trigger). Stunned unit contributes 0 Might to combat damage (but still needs full Might in damage to die). Clears at step 3d of end-of-turn expiration. ENGINE: reminder text "It doesn't deal combat damage this turn". |
| Reveal | 425 | Show to all; stays in zone; lasts until the effect finishes unless stated. |
| Counter | 426 | Remove a chain item; card to trash; no refund; not considered played. |
| Buff | 427, 701-705 | Put a +1 Might buff counter on a unit if it has none (max 1, unless an effect says otherwise). Already-buffed unit: can still be chosen, nothing happens, "if you buffed" fails. Spend a buff: remove it (only from units you control). Buffs lost on leaving the board. |
| Banish | 428 | Any zone → banishment. Not a kill, not a discard (no Deathknell). |
| Kill | 429 | Board permanent → owner's trash (tokens cease to exist). Active (instruction) or passive (lethal damage in cleanup). Deathknell/"when I die" processed before the move. Battlefields/legends can't be killed. |
| Add | 430 | Resources to pool; ability-Adds finalize+resolve instantly, no priority change. |
| Channel | 431 | Top runes of rune deck → base, ready by default. Too few → as many as possible. |
| Burn Out | 432 | §9.3. |
| Double | 433 | Increase a value by its current value for the stated duration; damage doubling is a replacement. |
| Swap | 434 | Two values exchange via one + and one − modifier (Might swap = an increase and a decrease). |
| Attach / Detach | 435-436 | See §15. |
| Predict N | 437 | Look at top N (default 1), recycle any of them, put the rest back on top in any order (DECISION `chooseCards` + order). Not a Burn Out if deck smaller. |
| Prevent | 438 | §9.2. |
| Replace | 439 | Swap a card/token on the board for a token without playing it; the token inherits effects/statuses and counts as the same object; the original goes to banishment as "Replaced" (a replaced token ceases to exist); some effects can swap back. |
| Create | 440 | Put a new object (usually a token) directly into a zone without the chain; created permanents go to any legal board location (DECISION if more than one), runes to base, legends to legend zone, battlefields to battlefield zone (uncontrolled). Owner = creating player. "Play a [token]" instead uses the chain (and play triggers). |
| Burn N | 441 | Top N of main deck → trash. Too few → burn out, then burn the rest. |
| Empower / Disempower | 442-443 | Binary status (stackable only where a card allows). Disempower removes one. |
| Skip | 444 | §9.4. |
| Pay | 445 | Remove resources from pool. Paying when instructed outside a cost is optional ("may") unless the card forces; declining negates. |
| Copy | 446 | §10 layer 1. |
| Gain/spend XP | 728-733 | XP is a per-player public number, not an object; not shared with teammates; spending more than you have is impossible (cost can't be paid). |
| Look | (no separate rule) | Private look; no burn out if too few. |

---------------------------------------------------------------------------------------------------

## 12. Movement and recall (CR 144, 421, 447-460) — DONE

- **Standard Move** (CR 144, discretionary): in your Main phase, Neutral Open state only (not during a
  chain, showdown or combat). Cost: exhaust each moving unit. DECISION (`chooseUnitsToMove` +
  `chooseDestination`): pick any set of your ready units (they can come from different locations) and ONE
  destination; all move simultaneously as one action.
  - Legal routes: base → battlefield; battlefield → base; battlefield → battlefield **only with Ganking**.
    A group with mixed origins: each unit must have a legal route to the destination.
  - Can't move to a battlefield that already has units of two other players, or where a combat between two
    other players is staged/ongoing (144.4.a.1, 451.2; only relevant in FFA/2v2). In team games can't move
    to a battlefield occupied by a teammate (449.2.b).
  - A destination must differ from the unit's current location (355.4).
- Moves by spells/abilities (451): don't exhaust unless the effect says so; the effect defines legal
  destinations; same 2-other-players restriction. If a move would put a unit somewhere it can't go, it is
  recalled to base instead (449.2.c).
- Moves are instantaneous, don't use the chain, can't be responded to (448.3). Changing zones isn't a move.
  An attached card going along with its host isn't a move.
- On arrival at a battlefield the mover doesn't control (and that isn't already contested) the battlefield
  becomes **Contested** by the mover (452). A cleanup follows every move (455) → may stage showdown/combat.
- ENGINE: moving into a battlefield where the enemy has units stages combat; moving into an empty
  battlefield you don't control stages a non-combat showdown; moving into a battlefield you control does
  nothing special (no contest, no showdown). Moving all your units OUT of a battlefield you control means
  you lose control at the next Open-state cleanup (it becomes uncontrolled; the opponent doesn't gain it).
- **Recall** (456-460): relocate a permanent to its controller's base; NOT a move (no move triggers,
  ignores move restrictions). Keeps damage and statuses unless the source says otherwise. Happens: in
  cleanup step 5 for stray gear/runes; for attackers in combat cleanup when defenders survive; when a move
  is illegal; by card effects.
- "Move to base" effects on a unit already in base: invalid destination (no-op / can't choose).

---------------------------------------------------------------------------------------------------

## 13. Deck construction and legality (CR 101-103, TR 601-603) — DONE

A deck (for 1v1 constructed) = 1 Champion Legend + Main Deck (incl. Chosen Champion) + Rune Deck +
battlefields (+ optional sideboard). Validator rules:

1. **Legend**: exactly 1 Legend card (Champion Legend). It determines the **Domain Identity** = the domains
   printed on the legend (usually 2) (103.2.b).
2. **Domain identity**: every card (main deck, sideboard, runes, battlefields) must fit: a single-domain card
   needs that domain in the identity; a multi-domain card needs ALL its domains in the identity; a
   domainless/Colorless card fits any identity (103.2.b.3-5). Some effects add cards that ignore this.
3. **Main deck**: at least **40** cards, including the Chosen Champion (CR 103.3; tournament constructed:
   40 cards — see open question Q2). Units, gear, spells only.
4. **Chosen Champion**: exactly 1, designated; must be a **Champion unit** (supertype Champion) whose
   champion tag matches the legend's champion tag (e.g. legend "Jinx, Loose Cannon" ⇒ a unit with tag
   Jinx and supertype Champion). Signature cards are not champion units and can't be chosen (103.3.a.2,
   103.3.d.3). Other copies of the same card in the deck are allowed (count toward the 3-copy limit) and are
   treated as the Chosen Champion for rules purposes (103.3.a.3).
5. **Copy limit**: max **3 copies per card name** across main deck (+ sideboard combined, TR 601.1.c.3),
   including the Chosen Champion. Names include subtitles ("Jinx, Rebel" ≠ "Jinx, Demolitionist").
   Different printings/alt-arts of the same name share the limit. **Unique** cards: max 1 copy.
6. **Signature cards**: max **3 Signature cards total** (any names) and each must carry the legend's
   champion tag (103.3.d).
7. **Rune deck**: exactly **12** runes, each matching the domain identity (103.4). Any split (e.g. 7/5,
   6/6, 12/0). Rune copy counts are not limited by the 3-copy rule (basic runes).
8. **Battlefields**: 1v1 constructed brings exactly **3** battlefields with **distinct names** (103.5,
   487.4, TR 601.1.b); each must fit domain identity "if applicable" (most battlefields are domainless).
9. **Sideboard** (tournament): up to **10** cards, valid main deck cards, copy limits combined with the main
   deck; swapped 1-for-1 between games of a match; legend, runes and battlefields can't be changed; the
   Chosen Champion may be changed to another legal champion unit (TR 403, 601.1.c).
10. **Format legality**: card must be in a legal set (Standard: OGS, OGN, SFD, UNL, VEN, RAD) and not
    banned (103.3.e, TR 601.2.d). Ban list effective 2026-11-23 (Standard and 2v2): Riven, Broken Blade;
    Zhonya's Hourglass; Stellacorn Herder; Nocturne, Horrifying; Rhasa the Sunderer; Brynhir
    Thundersong; Dazzling Aurora; Baited Hook; battlefields Emperor's Dais and Star Spring. Earlier bans
    (e.g. Reaver's Row, Stacked Deck, and per Piltover Archive also The Arena's Greatest, The Dreaming
    Tree, Fight or Flight, Scrapheap) appear to carry forward — ENGINE: keep the ban list as data
    (`data/banlist.json`), allow a "casual (no bans)" toggle.
11. Some cards require deck-building choices (e.g. Neeko, Blending In chooses 3 legends) (103.1, 440.3.c).
    DECISION at deck-building time; store in the DeckList.

ENGINE: the `DeckList` type stores `champion` separately from `main`. Decide whether `main` includes the
champion copy (recommended: `main` = the other 39+, champion separate; validator counts both). Tokens are
never deckable.

---------------------------------------------------------------------------------------------------

## 14. Game setup for 1v1 (CR 104-118, 487-488, TR 406-407) — DONE

1. Each player places their Champion Legend in their Legend Zone (111) and their Chosen Champion in their
   Champion Zone (112).
2. **Battlefields** (113, 487.5 / 488.5): each player selects ONE of their three battlefields; the other two
   are set aside; the chosen ones are revealed simultaneously and placed in the battlefield zone (2
   battlefields in 1v1). CR 487 (Duel, Bo1) says the selection is **random**; CR 488 (Match, Bo3) says
   players **select**. DECISION (`chooseBattlefield`, both players, hidden + simultaneous) in match mode;
   random in duel/Bo1 mode. In a Bo3, after a game that someone won, the battlefields used that game are
   removed and players pick from the remaining ones; after a drawn game the same battlefields are reused
   (488.5.a, TR 406.1.b). Each battlefield is owned by its player; it starts uncontrolled.
3. Shuffle main deck and rune deck separately (114).
4. **First player** (115, TR 407): a random method designates a player who **chooses to go first or
   second** — DECISION (`chooseMode`: "first"/"second"). In games 2-3 of a match, the **loser of the
   previous game chooses**. After a drawn game, same starting player.
5. Each player draws **4** (116).
6. **Mulligan** (117), in turn order starting with the first player: DECISION (`mulligan`): choose 0-2 cards
   to set aside; draw that many; then recycle the set-aside cards to the bottom of the main deck (random
   order if 2 — CR 417.5). ENGINE: because players act in turn order, the second player's mulligan
   decision happens after the first's; but neither sees the other's hand, so the UI may collect both at
   once and apply in order (identical result since no information passes between them). Note that the
   cards set aside can't be redrawn (they are drawn around, then recycled).
7. First player's turn begins (118). Turn 1 has no special restrictions for the first player in 1v1 (draws
   normally). Second player channels 3 runes on their first turn (487.7/488.7).
8. Victory score 8.

Match structure (TR 404, 408): best of 3; time-limit procedure (finish turn + 3 turns; a game is won only
with a ≥2-point lead, else draw) — ENGINE: optional, probably out of scope.

---------------------------------------------------------------------------------------------------

## 15. Gear, equipment, attachment (CR 147-152, 435-436, 716-725, 818-821, 830) — DONE

- Gear enters **ready** at its controller's base by default (149). Can be killed. Unattached non-unit gear
  that ends up at a battlefield is recalled at the next cleanup (unless Deploy) (149.3, 459).
- **Equipment** = gear with the Equipment tag; has an effect text box + Might bonus (150).
- **Attach** (435, 716-719): links an attached card to a top-most card (a unit). While attached:
  - the attached card's printed rules text is **inactive** (so its own Equip/Quick-Draw/activated
    abilities can't be used; but text granted to it stays active) (135.4, 718.2);
  - its **effect text** is added to the unit's rules text; its **Might bonus** modifies the unit's Might
    (arithmetic layer);
  - it keeps its types/tags, can still be chosen/targeted (e.g. "kill a gear" can kill it), can have a
    different controller than the unit, and statuses (exhausted, etc.) are independent;
  - it shares the unit's location and moves with it (not a move);
  - attaching to a new unit detaches from the old; attaching to the current host does nothing;
  - **units can never be attached** (attaching a unit does nothing; a non-unit that becomes a unit
    detaches) (143.5, 435.1.h).
- **Detach** (436): its rules text becomes active again (new timestamp), effect text and Might bonus stop
  applying; it stays where the unit is (so a detached gear at a battlefield is recalled at next cleanup).
  If the unit leaves the board (dies, bounced, banished), attached cards detach at the unit's last board
  location; DECISION: the unit's controller orders the detachments (719.5.a); they then get recalled in
  cleanup step 5.
- **Equip [cost]** (818): activated ability of Equipment (Main phase timing by default): pay the cost,
  **target** a unit you control, attach. Can't be activated while attached (text inactive). Multiple Equip
  instances = separate abilities.
- **Quick-Draw** (819): the Equipment has Reaction (can be played from hand at reaction speed) and a play
  effect "When you play this, attach it to a unit you control" (DECISION target). Doesn't change Equip timing.
- **Weaponmaster** (821): unit play effect: **you may** choose an Equipment you control (attached elsewhere
  or not) and pay its Equip cost reduced by [A] (one universal power less; if no [A] in the cost, pay it in
  full) to attach it to this unit. Not an activation of Equip (Equip discounts don't apply). If not paid,
  nothing happens. (Spiritforged FAQ: always optional.)
- **Deploy** (830): gear may be played/created to ANY battlefield (incl. enemy-occupied or open ones), is not
  recalled in cleanup step 5, and has "When an opponent holds here, kill this." (card reminder: "Play this
  only to a battlefield" — see open question Q5.)

---------------------------------------------------------------------------------------------------

## 16. Zones, visibility, ownership (CR 105-109, 125-130) — DONE

| Zone | Per player? | Ordered? | Visibility | Notes |
|---|---|---|---|---|
| Main deck | yes | yes (secret) | count public, order secret | top = index 0 |
| Rune deck | yes | yes (secret) | count public | |
| Hand | yes | no | private (owner); count public | no max hand size |
| Base | yes | — | public | location; your permanents + runes |
| Battlefield (×N) | shared | — | public | location; each has a facedown zone |
| Facedown zone (per battlefield) | — | — | zone public, card private to its controller | max 1 card; only usable while you control the battlefield; not a location |
| Legend zone | yes | — | public | Champion Legend can never leave |
| Champion zone | yes | — | public | Chosen Champion starts here; playable from here |
| Trash | yes | no | public | |
| Banishment | yes | no | public | |
| Chain | shared | yes | public | |

- Cards always go to their OWNER's non-board zones (056).
- No limit on units in a base or at a battlefield (170.6). No max hand size.
- A card moving to/from a non-board zone becomes a new object (124). The Chosen Champion is never returned
  to the champion zone by normal means; an effect that would do so only works if the zone is empty (108.3.c).
- Facedown cards: private to controller; revealed to all when they change zones or the game ends (422.4).
  A facedown card has no front characteristics for other effects (can't be "shown off", isn't "a card with
  Hidden") (811.5.a).
- Ownership (127): who brought it into the game (tokens: the player whose effect created them). Control:
  see §17.

---------------------------------------------------------------------------------------------------

## 17. Control and control changes (CR 188-192, 740) — DONE

- You control your legend, runes and permanents you played/created/hid (191). Spells: the player who played
  them. Abilities: by default the source's controller (or the owner if the source is in a non-board zone);
  an ability keeps its controller even if the source changes control later (191.5.b).
- Battlefield control: §6.1.
- **Control-change effects** ("gain control of") are layer-2 trait changes. A unit that changes controller
  while at a battlefield its new controller doesn't control applies Contested (190.3.a.2) → showdown/combat
  staged at next cleanup (Spiritforged FAQ: Hostile Takeover on the only enemy unit at their battlefield
  starts a non-combat showdown; the old controller loses control in that cleanup).
- Permanents in a base other than their controller's are recalled to their controller's base in cleanup
  step 5. A unit can never be played into another player's base (358.3).
- Taking control of a spell on the chain (e.g. Rebuttal) is not countering it; the new controller may
  remake choices as the card allows (750-755).
- Friendly = same controller or teammate; enemy = opponent (740.1). "Alone": no other friendly unit at its
  location. "One on one": it and the single enemy unit there are both alone.

---------------------------------------------------------------------------------------------------

## 18. Tokens (CR 179-187) — DONE

- Tokens are game objects created by effects; not cards; cost 0; no domains (unless granted); owner = the
  creating effect's controller; controller = same unless stated (182-185).
- Tokens exist only on the board or chain; a token put anywhere else ceases to exist (186). Recycling a
  unit/gear token sends it "to the main deck" where it vanishes (Spiritforged FAQ).
- Defined tokens (187): Recruit (unit, 1 Might, tag Recruit); Sprite (unit, 3 Might, tag Fae, Temporary);
  Sand Soldier (unit, 2 Might, Shurima); Mech (unit, 3 Might, Mech); **Gold** (gear: "Reaction — kill
  this, exhaust this: add [A]"); Reflection (unit, 0 Might); Bird (unit, 1 Might, Bird, Deflect); Brush
  (battlefield: Bird/Cat/Dog/Poro/Ivern units here +1 Might; when you score here you may replace it with
  the battlefield it replaced); Baron Pit (battlefield: units can move here from anywhere); Tentacle (unit,
  1 Might, Bilgewater); Shadow Clone (unit, 0 Might: when it attacks you may banish a unit from your trash
  to give it Assault 4 this turn); **Bomb** (gear, Deploy, Deathknell: deal 2 to an enemy unit here and kill
  your other Bombs here).
- Token units enter exhausted like any unit unless the effect says "ready". Created tokens don't use the
  chain and don't trigger "when you play" (unless the effect says "play a token").
- ENGINE: data/cards.raw.json contains token cards (cardTypeLabels includes "Token"); use them as CardDefs.

---------------------------------------------------------------------------------------------------

## 19. Misc rules: buffs, Mighty, bonus damage, XP, extra turns, counters, choices (CR 701-766) — DONE

- **Buff** (701-705): see §11. +1 Might while present; counters aren't targeted.
- **Mighty** (706-711): a unit is Mighty while its Might ≥ 5 (on board: effective Might; elsewhere: printed).
  "Becomes Mighty" = crosses from <5 to ≥5.
- **Bonus damage** (712-715): added to each Deal instance (summed if several, never negative); with multiple
  targets each gets the bonus; with split damage it increases the pool to split.
- **XP** (728-733): per-player public counter; Hunt gains it; Level checks it; spending is a cost.
- **Additional turns** (734-738): inserted right after the current turn; turn order unchanged; several are
  queued in creation order.
- **Counters** (741-749): not targeted, no controller; lost on leaving the board; only spend from objects you
  control.
- **New choices** (750-755): remake ALL of targets/modes/destinations/play location (not "as you play"
  choices or optional additional costs); must be legal; targeting triggers fire again; no extra costs.
- **Untargetable** (756-758): "can't be chosen by [enemy spells...]". If it becomes untargetable after being
  chosen, it's a mistarget on resolution.
- **Naming** (759-763): DECISION (`chooseCards` from a name list): must name a real, format-legal, non-token
  card (or existing tag).
- **Ignoring** (764-766): ignored abilities are inactive for that action.
- **Inactive** (720-725) and **dependent keywords** (726-727): see keywords.md (Legion, Level, Empowered).

---------------------------------------------------------------------------------------------------

## 20. Winning, losing, drawing, conceding (CR 193-196, 649-652) — DONE

- Win: §7. A player may **concede at any time** (650) — Action `concede`, accepted even when it isn't their
  decision. In 1v1 the opponent wins immediately.
- Draws: the CR has no "draw" outcome in normal play except via tournament time limits; ties at/above the
  victory score continue until a cleanup finds a single leader (194.2.b).
- FFA/2v2 removal of a conceding player (652): banish everything they own/control, replace their battlefield
  with a token battlefield if in use, counter their chain items, pass turn/focus/priority as needed.

---------------------------------------------------------------------------------------------------

## 21. Other modes (CR 489-491) — notes, LOWER PRIORITY

| Mode | Players | VS | Battlefields | First-turn adjustments | Special |
|---|---|---|---|---|---|
| 1v1 Duel (487) | 2 | 8 | 2 (each picks 1 of 3, random) | 2nd player +1 rune on first channel | Bo1 |
| 1v1 Match (488) | 2 | 8 | 2 (selected; used ones removed after a won game) | same | Bo3 (or Bo5) |
| FFA3 "Skirmish" (489) | 3 | 8 | 3 (each random 1 of 3) | 1st player skips first draw; last player +1 rune | Combat only between 2 players; can't move/play into a battlefield with another pair's staged/ongoing combat (449.2.a, 464) |
| FFA4 "War" (490) | 4 | 8 | 3 (first player's are removed; others random) | same | same |
| 2v2 "Magma Chamber" (491) | 4 (2 teams) | 11 | 3 (first player's removed) | same | shared points; teammates may act on each other's turn when invited; each battlefield scorable once per TEAM per turn; no hiding at / moving into a teammate's battlefield; teammates can't share legend or battlefields; final-point/eligibility only counts battlefields controlled during own/teammate's turn |

ENGINE: implement 1v1 fully; keep `mode` switches for turn order, victory score, battlefield count,
first-turn adjustments, combat-participant limits and burn-out opponent choice.

---------------------------------------------------------------------------------------------------

## 22. Decision catalogue (summary of every DECISION above)

| When | Who | Kind | Options |
|---|---|---|---|
| Deck building (Neeko etc.) | owner | chooseCards | deck-building choices |
| Setup: battlefield | each player | chooseBattlefield | 1 of own 3 (random in Bo1 Duel) |
| Setup: play order | designated player / previous loser | chooseMode | go first / go second |
| Mulligan | each, in turn order | mulligan | 0-2 cards |
| Main phase | TP | mainAction | play card / activate / standard move / hide / end turn |
| Any time | any | concede | — |
| Playing: location | controller | chooseDestination | base or controlled battlefield (+Ambush/Deploy/etc.) |
| Playing: optional costs | controller | optional | Accelerate, Repeat, other "may pay" |
| Playing: mode, X, targets, split recipients | controller | chooseMode/chooseX/chooseTargets | |
| Hidden: hide target battlefield | TP | chooseBattlefield | controlled battlefields with empty facedown zone |
| Payment | payer | payment | runes to exhaust/recycle; pool; Add reactions |
| Chain response | priority holder | chainResponse | Reaction card/ability or pass |
| Showdown | focus holder | showdownAction | Action/Reaction card/ability or pass |
| Cleanup: which showdown/combat first | TP | chooseBattlefield | staged battlefields |
| Combat damage | attacker, then defender | assignDamage | legal assignments |
| Trigger "you may" / trigger cost | controller | optional/payment | |
| Simultaneous triggers order | each controller | orderTriggers | permutations |
| Replacement order | affected object's controller | chooseMode | order |
| Burn out: who gains the point | burning player | choosePlayer | opponents (auto in 1v1) |
| Recycle multiple runes order | owner | orderCards | (auto acceptable) |
| Predict / look-and-arrange | player | chooseCards | recycle subset, order rest |
| Discard choice | discarding player | chooseCards | |
| Detach order when host leaves | host's controller | orderCards | |
| Create token location (if multiple legal) | creator | chooseDestination | |
| Resolution-time choices ("choose one", "may", split damage amounts, card effects) | as specified | various | |
| Final-point: none (automatic draw) | — | — | — |

---------------------------------------------------------------------------------------------------

## 23. Sources, ambiguities and open questions

### Sources used (all fetched 2026-11-25)
- Core Rules 1.5 (Radiance) — official PDF linked from playriftbound.com/en-us/rules-hub ("last updated
  October 9, 2026"); text read through the riftboundfaq.com mirror `rules-documents/core-rules/1.5` and its
  1.4→1.5 change log. Radiance patch notes (published 2026-10-09, effective 2026-10-16).
- Hyperlinked CR (jeff425.github.io/hyperlinked-rb-cr) — effective 2026-07-16 = CR 1.4. NOT used as
  primary; numbering differs from 1.5 after ~§400.
- Patch notes: Spiritforged (2025-12-05, eff. 2025-12-12), Unleashed (2026-03-30), Vendetta (2026-07-17,
  eff. 2026-07-24), Radiance (2026-10-09, eff. 2026-10-16).
- FAQs: Spiritforged FAQ; Unleashed Rules FAQ; Vendetta Rules FAQ; Radiance Rules FAQ (2026-10-26).
  Origins FAQ: only the questions and targeting appendix were retrievable (answers are in collapsed page
  elements), so Origins-FAQ topics are implemented from CR 1.5 reasoning and marked INFERENCE in tests.
- Tournament Rules dated 2026-10-09 (riftboundfaq.com mirror). Radiance ban list (effective 2026-11-23).

### Open questions needing a lead decision
- **Q1 Main deck size.** CR 103.3 says "at least 40". The tournament-rules summary I could read says the
  constructed main deck is 40 (wording read as "exactly 40", which may be the summariser's paraphrase).
  Proposal: validator enforces ≥ 40; show a warning above 40 in "tournament" mode.
- **Q2 Battlefield selection in 1v1.** CR 487 (Duel, Bo1) says each player picks one of their 3 at
  **random**; CR 488 (Match, Bo3) says players **select**; TR 406.1.h.2 mentions random selection as an
  optional Bo1 setup. Proposal: lobby option, default = player choice (hidden, simultaneous).
- **Q3 First player.** TR 407: a random method designates a player who then chooses first or second; later
  games the previous loser chooses. Proposal: seeded coin flip → that player gets a `chooseMode` decision.
- **Q4 Deploy to base?** CR 830 says Deploy *allows* any battlefield; the printed reminder says "Play this
  only to a battlefield." Proposal: battlefield only (follow the card's reminder; base not offered).
- **Q5 X costs.** CR 1.5 has no explicit X-cost rule in the parts read. Proposal: X chosen at Make Choices
  (step 2), before cost determination.
- **Q6 Hide timing.** CR 811 says hiding happens "on your turn during an Open state". Proposal: allow only in
  Neutral Open of your Main phase (discretionary actions, CR 411.1.a), i.e. not during a showdown.
- **Q7 Burn-out loop when points can't be gained.** CR 432.3 repeats burn outs until an opponent wins. If
  the opponent can't gain points (e.g. Tianna Crownguard), this never terminates. Proposal: if a burn out in
  a sequence produced no point gain and the deck is still empty, treat the rest of the instruction as
  impossible and stop.
- **Q8 Lethal assignment with pre-existing damage.** Implemented as lethal = Might − marked damage (min 1),
  derived from CR 142.4; no explicit ruling found.
- **Q9 VEN-FAQ #17 (Ravenbloom Student "triggers twice" in the Rebuttal scenario)** — summary unclear about
  whose Student; not encoded in tests.
- **Q10 Ban list carry-over.** The 2026-11-23 announcement lists new bans; earlier bans (Reaver's Row,
  Stacked Deck, others shown as BANNED on Piltover Archive) seem to carry forward. Proposal: maintain
  `data/banlist.json` manually with dates; default "casual" ignores it.
- **Q11 Mulligan UI.** CR says mulligans happen in turn order. Proposal: collect both players' choices in
  parallel (no information passes between them) and apply in turn order; record both in the action log in
  order for determinism.
- **Q12 Deck list shape.** `DeckList.main` — include the champion copy or not? Proposal: `main` excludes the
  chosen champion (39+), `champion` separate; validator adds them.
- **Q13 Pending items can't be targeted** (Radiance patch): "counter a spell" only sees finalized chain
  items. Since permanents resolve on finalization, units can never be countered by spells.
- **Q14 Ending-step priority.** With no chain, the non-turn player never has priority in Neutral Open, so
  "play a Reaction at the end of your opponent's turn" is only possible in response to a chain item (e.g. an
  end-of-turn trigger) — the Origins FAQ asks exactly this question but the answer couldn't be retrieved.
  Proposal: implement strictly per CR 312.2 (no free end-of-turn window); revisit if the FAQ says otherwise.

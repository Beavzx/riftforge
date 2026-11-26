# Riftforge Rules Scenario Tests

Purpose: an independent list of rules scenarios with exact expected outcomes, for the test agent to turn into
`tests/rules/*.test.ts`. Based on Core Rules 1.5 (Radiance, 2026-10-09/16) and the official FAQs:
Spiritforged FAQ (SFD-FAQ), Unleashed Rules FAQ (UNL-FAQ), Vendetta Rules FAQ (VEN-FAQ, 2026-07),
Radiance Rules FAQ (RAD-FAQ, 2026-10-26), and patch notes. `CR x` = Core Rules 1.5 rule number.
Tests marked **INFERENCE** follow from the CR text but no official ruling was found.

## Fixtures

Generic test cards (create them as CardDefs in the test helper; domain Fury unless stated, so they fit a
Fury/Chaos test legend):
- `V(n)` — vanilla unit, Might n, cost n energy, no power, no text.
- `ZapM` — spell, cost [1], no timing keyword: "Deal 2 to a unit."
- `ZapA` — spell, cost [1], [Action]: "Deal 2 to a unit."
- `ZapR` — spell, cost [1], [Reaction]: "Deal 2 to a unit."
- `DrawR` — spell, cost [1], [Reaction]: "Draw 1."
- `CounterR` — spell, cost [2], [Reaction]: "Counter a spell."
- `PumpA` — spell, cost [1], [Action]: "Give a unit +3 Might this turn."
- `StunA` — spell, cost [1], [Action]: "Stun a unit."
- `MoveR` — spell, cost [1], [Reaction]: "Move a friendly unit to base." (like Flash, single unit)
- `KillA` — spell, cost [2], [Action]: "Kill a unit at a battlefield."
- `Tank(n)`, `Backline(n)`, `Ganker(n)`, `Assault(n,x)`, `Shield(n,x)`, `Accel(n)`, `Temp(n)`, `Deflect(n,x)`,
  `Ambusher(n)` — vanilla units of Might n with that keyword.
- `DK(n)` — unit Might n: "[Deathknell] — Draw 1."
- `HidU(n)` — unit Might n, cost n, [Hidden]. `HidZap` — spell [Hidden], [Action], cost [3]: "Deal 2 to a unit."
- `Sword` — gear, Equipment tag, cost [1], Might bonus +2, "[Equip] [1]".
- `BF` — vanilla battlefield (no text).

Standard state **S0**: 1v1, victory score 8; P0 is turn player (TP) in their Main phase, turn 3, Neutral Open;
battlefields BF-A and BF-B both uncontrolled and empty; each player has 6 ready Fury runes in base and an
empty pool, 20 vanilla `V(1)` cards in their main deck, 6 runes in rune deck, 0 points, empty hand except as
stated. "P0 plays X" assumes P0 can pay. "Pass" = the player passes priority/focus.

---------------------------------------------------------------------------------------------------

## A. Setup and deck legality

**T001 — Opening hand size and mulligan of 2**
Refs: CR 116-117, 417.5. Setup: new game, seeded. Actions: after both draw 4, P0 mulligans cards c1,c2.
Expect: P0's hand has 4 cards, none of them c1/c2; P0's main deck size unchanged (= deck−4); c1 and c2 are
the bottom two cards of P0's main deck (in random order).

**T002 — Mulligan limit**
Refs: CR 117.1. Actions: P0 tries to mulligan 3 cards. Expect: action rejected (max 2). Mulligan of 0 allowed.

**T003 — Mulligan order**
Refs: CR 117. Expect: P0 (first player) resolves mulligan before P1; both mulligans complete before turn 1
Awaken. The first decision of the game after setup is the first player's mulligan (or both collected, applied
in order).

**T004 — Second player's extra rune (1v1)**
Refs: CR 487.7/488.7, 315.3. Actions: play through P0 turn 1 and P1 turn 1. Expect: after P0's channel
phase P0 has 2 runes; after P1's first channel phase P1 has 3 runes; on P0 turn 2 P0 channels exactly 2
(4 total); P1 turn 2 channels 2 (5 total).

**T005 — First player draws on turn 1 in 1v1**
Refs: CR 315.4, 487 (no skip in 1v1). Expect: P0 has 5 cards in hand at the start of their turn-1 Main
phase (4 + 1 draw), assuming no mulligan effect on count.

**T006 — Chosen champion starts in champion zone and is playable**
Refs: CR 103.3.a, 108.3.d. Expect: at game start the chosen champion object is in P0's champion zone (not
in deck, not in hand); `getLegalActions` in P0's Main phase includes playing it from the champion zone when
affordable.

**T007 — Deck validation: 3-copy limit includes champion**
Refs: CR 103.3.b. Deck: champion = Jinx, Rebel; main contains 3 more Jinx, Rebel. Expect: invalid (4 copies).

**T008 — Deck validation: domain identity**
Refs: CR 103.2.b. Legend with domains Fury+Chaos; main contains a Calm/Body spell (e.g. Counter Strike).
Expect: invalid. A domainless (Colorless) card is valid. A Fury/Chaos two-domain card is valid; a Fury/Mind
card is invalid.

**T009 — Deck validation: champion must match legend tag and be a Champion unit**
Refs: CR 103.3.a.2, 103.3.d.3. Expect: a Signature card can't be the chosen champion; a champion unit of a
different champion tag can't be chosen.

**T010 — Deck validation: rune deck exactly 12; battlefields exactly 3 distinct names; signature ≤ 3; main ≥ 40;
sideboard ≤ 10**
Refs: CR 103.3-103.5, TR 601.1. Expect: each violation reported separately.

**T011 — Deck validation: Unique**
Refs: CR 825. Deck with 2× Forgefire Cape. Expect: invalid. 1× valid.

**T012 — Battlefield selection (match mode)**
Refs: CR 488.5. Expect: each player is asked to choose 1 of their 3 battlefields; choices are hidden until
both chose; exactly 2 battlefields in play; owner recorded; both start uncontrolled.

---------------------------------------------------------------------------------------------------

## B. Turn structure, runes and pool

**T013 — Awaken readies everything**
Refs: CR 315.1. Setup: P1's units, gear, runes exhausted at end of P0's turn. Expect: at P1's Awaken all of
P1's units, gear, runes and legend are ready; P0's exhausted objects stay exhausted.

**T014 — Channel enters ready**
Refs: CR 431.2.a. Expect: runes channeled in the channel phase are ready.

**T015 — Rune deck empty**
Refs: CR 315.3.b.1. Setup: P0's rune deck has 1 rune. Expect: P0 channels 1; no error, no penalty. With 0
runes, channel does nothing.

**T016 — Rune abilities**
Refs: CR 164.2. Setup: S0, P0 has 1 ready Fury rune. Actions: exhaust it for energy, then recycle it.
Expect: pool = 1 energy + 1 Fury power; rune is at the bottom of P0's rune deck; P0 has 0 runes in base.

**T017 — Recycle an exhausted rune**
Refs: CR 164.2.b (recycle cost doesn't require ready). Expect: an exhausted rune can still be recycled for
its power.

**T018 — Pool empties at start of Main phase**
Refs: CR 167, 316.3. Setup: a hold trigger adds 1 energy to P0's pool during P0's Beginning phase.
Expect: when P0's Main phase starts, pool is empty.

**T019 — Pool empties at end of turn**
Refs: CR 317.2.d. Setup: P1 (non-turn player) adds 2 energy during P0's turn (e.g. exhausts runes in
response, then doesn't spend). Expect: after P0's expiration step, P1's pool is 0.

**T020 — Draw from empty deck in draw phase = burn out then draw**
Refs: CR 315.4.b, 432. Setup: P0's main deck empty, trash has 5 cards. Expect: P0 shuffles 5 trash cards into
deck, P1 gains 1 point, then P0 draws 1 (hand +1, deck 4).

**T021 — Damage heals at end of every turn**
Refs: CR 143.3.b.1, 317.2.b. Setup: P1's V(4) at base has 2 damage during P0's turn. Expect: after P0's
expiration step, P1's unit has 0 damage.

**T022 — "This turn" effects expire after end-of-turn triggers**
Refs: CR 317.1-317.2. Setup: P0's V(2) has +3 Might this turn; a trigger "at end of turn, deal 4 to each
unit with 5+ Might" (test fixture). Expect: the trigger sees Might 5 and deals 4; the unit (Might 5, 4
damage) survives; then healing and expiry happen; unit ends at Might 2, 0 damage.

**T023 — Stun clears at end of turn**
Refs: CR 424.1.a.2. Expect: a unit stunned on P0's turn is not stunned during P1's turn.

**T024 — Main phase ends only by declaring end of turn**
Refs: CR 316.9. Expect: with legal actions remaining, the game waits for P0's `endTurn`; it never auto-ends
P0's main phase while P0 has a possible action (unless P0 has no possible actions at all — still requires
the endTurn decision; engine may auto-pass only if configured).

**T025 — Only TP may act in Neutral Open**
Refs: CR 316.5.b. Expect: during P0's Main phase Neutral Open, P1 has no legal actions except concede (and
Reaction is not allowed because the state is Open).

**T026 — Turn order alternates; turn counter**
Expect: after P0 ends turn, P1 becomes TP; awaken/beginning/channel/draw happen for P1.

**T027 — Units enter exhausted, gear enters ready**
Refs: CR 143.4, 149.1. Expect: P0 plays V(2) to base → exhausted; plays Sword → ready at base.

**T028 — Unit play location**
Refs: CR 355.2. Setup: P0 controls BF-A (has a unit there); BF-B uncontrolled. Expect: legal destinations
for a played V(2): P0's base, BF-A. Not BF-B, not P1's base.

**T029 — Gear location**
Refs: CR 149.2. Expect: non-Deploy gear can only be played to P0's base.

**T030 — Concede any time**
Refs: CR 650. Setup: P1 has a pending decision. Actions: P0 concedes. Expect: game over, winner P1.

---------------------------------------------------------------------------------------------------

## C. Playing cards, costs, timing

**T031 — Cost payment: energy + power**
Refs: CR 357. Setup: card costs [3][R]; P0 has 4 Fury runes ready. Expect: legal plan: exhaust 3 (3 energy)
+ recycle 1 (1 Fury power) → P0 ends with 3 exhausted runes in base and 1 fewer rune; or exhaust 4 then
recycle 1 of the exhausted (leaves 1 surplus energy that's lost at end of turn). Auto-pay chooses the first.

**T032 — Can't pay → can't play**
Expect: a card costing more than available resources is not in legal actions.

**T033 — Power of the wrong domain can't pay**
Refs: CR 163.2. Setup: cost [1][G]; P0 has only Fury runes. Expect: not playable. [A] (universal, e.g. Gold
token) can pay [G].

**T034 — [C] on a multi-domain card**
Refs: CR 135.2.e.6.c. Setup: Fury/Chaos card with cost [2][C]. Expect: payable with Fury OR Chaos power;
not with Mind.

**T035 — Main-speed spell timing**
Refs: CR 310.1.a. Expect: ZapM is playable by P0 in Neutral Open Main phase; not during a showdown; not in
response on the chain; not on P1's turn.

**T036 — Action spell timing**
Refs: CR 806. Expect: ZapA playable in Neutral Open (TP) and in Showdown Open by the focus holder (either
player); not as a chain response (Closed).

**T037 — Reaction spell timing**
Refs: CR 813. Expect: ZapR playable in any state when the player has priority: as a chain response on
either player's turn; in a showdown with focus; in Neutral Open by the TP.

**T038 — Reaction in opponent's ending step**
Refs: CR 813, 312.2.c-d. Setup: P0 has an "at end of turn" trigger on the chain in P0's ending step.
Expect: P1 gets priority and may play ZapR in response. With no chain in the ending step, P1 has no
priority and cannot act (INFERENCE from 312.2 — priority in Closed states only).

**T039 — Units resolve immediately, can't be responded to**
Refs: CR 337.2, 359.2. Actions: P0 plays V(3). Expect: no `chainResponse` decision is offered to P1 for the
unit itself; the unit is on the board right after finalization.

**T040 — Play trigger of a unit can be responded to**
Refs: CR 383.4.a.2. Setup: P0 plays a unit "When you play me, deal 2 to a unit" targeting P1's V(2).
Expect: the unit is on the board; the trigger is on the chain; P1 gets priority and may respond (e.g. MoveR
the target to base — damage still dealt since base is a legal location for "a unit"; or CounterR can't
counter it because it is an ability, not a spell).

**T041 — Spell on the chain: opponent responds**
Fixture `PumpR`: Reaction spell, cost [1], "Give a unit +3 Might this turn." Setup: P1's V(2) at BF-A.
Actions: P0 plays ZapM on it; P0 passes; P1 tries PumpA (Action) → rejected (Closed state needs Reaction);
P1 plays PumpR on V(2); both pass; PumpR resolves; both pass; ZapM resolves. Expect: V(2) has Might 5 and
2 damage; survives the cleanup.

**T042 — Illegal target on resolution (all targets) → nothing**
Refs: CR 359.3.e.7. Setup: P0 plays KillA on P1's V(3) at BF-A. P1 responds MoveR moving V(3) to base.
Expect: KillA resolves, does nothing (target no longer "at a battlefield"); KillA goes to trash; it still
counts as played.

**T043 — Partial illegal targets**
Refs: CR 359.3.e.8. Setup: a spell "Deal 2 to each of up to two units" targeting X and Y; Y leaves the board
in response. Expect: X takes 2; no error.

**T044 — Target that changed zones and came back is a new object**
Refs: CR 359.3.e.4, 124. Setup: P0 targets P1's unit U with ZapM; P1 responds by returning U to hand and
replaying it (if possible via a Reaction effect). Expect: ZapM does nothing to the new U.

**T045 — Countered spell: no refund, not played**
Refs: CR 426. Setup: P0 plays ZapM (paid 1 energy); P1 counters with CounterR. Expect: ZapM in P0's trash;
P0's resources spent; "when you play a spell" triggers of P0 (e.g. Ravenbloom Student) do NOT trigger
(420.4.a.1). Legion-style "played another card this turn" checks DO count it (finalized; 420.4.b).

**T046 — Optional additional cost: Accelerate**
Refs: CR 805. Setup: Accel(3) costing [3]; P0 has 5 ready Fury runes. Actions: play with Accelerate.
Expect: total cost [4][R] (3 + 1 energy + 1 Fury power); unit enters ready. Without Accelerate: [3],
exhausted.

**T047 — Cost floor**
Refs: CR 356.6. Setup: card cost [2]; two discounts of [2] and [1]. Expect: cost [0]; playable with no runes.

**T048 — Cost of a token is 0 for "cost" checks**
Refs: CR 185.3.a, SFD-FAQ #15. Setup: Pickpocket ("you may kill a gear with Energy cost no more than [1]")
vs. a Gold token. Expect: Gold is a legal choice; after kill, P0 plays a Gold token exhausted.

---------------------------------------------------------------------------------------------------

## D. Chain and priority

**T049 — Priority after play goes to the player who played (may add alongside)**
Refs: CR 337.4, 338.1.a.5. Actions: P0 plays ZapM. Expect: after finalization, P0 has priority first and
may respond to their own spell with ZapR; if P0 passes, P1 gets priority.

**T050 — Both pass → top resolves**
Refs: CR 339-340. Chain: [ZapM(P0), ZapR(P1)]. Expect: after P1 plays ZapR, priority → P1 (controller of
newest) → P1 passes → P0 passes → ZapR resolves; then priority → P0 (controller of newest remaining) → both
pass → ZapM resolves.

**T051 — Last-in first-out**
Chain: ZapM(P0, target A), ZapR(P1, target B), ZapR(P0, target C). Expect: resolution order C, B, A.

**T052 — Action can't respond**
Expect: with a chain present, ZapA is not legal for anyone.

**T053 — Reaction abilities during payment**
Refs: CR 430.3. Expect: while paying for a spell the player may activate rune abilities and Gold tokens
mid-payment; no chain item is created for them (resolve immediately).

**T054 — Add abilities don't pass priority**
Refs: CR 430.2.a. Expect: exhausting a rune never gives the opponent priority or creates a pending chain
response.

**T055 — Cleanup between chain items**
Refs: CR 319.5, 323.4, 359.3.e.7. Setup: P1's V(2) at BF-A. P0 plays ZapM targeting it, then (holding
priority) plays ZapR targeting it too. Both pass → ZapR resolves (2 damage) → cleanup kills V(2) → both pass
→ ZapM resolves. Expect: ZapM's target is gone (new zone) → ZapM does nothing, goes to trash, still counts
as played.

**T056 — No cleanup during resolution**
Refs: CR 321. Setup: a spell "Deal 3 to a unit. Then give it +3 Might this turn" on V(3). Expect: unit
survives (the kill check happens after the spell finishes: Might 6, 3 damage).

**T057 — Triggers created during resolution wait**
Refs: CR 158.3. Setup: a spell kills a DK(1) and then draws 1. Expect: the spell finishes (draw happens)
before the Deathknell trigger is finalized/resolved.

**T058 — Priority holder in a closed state on opponent's turn**
Expect: when P1 adds a Reaction on P0's turn, after it finalizes P1 holds priority (312.2.c).

**T059 — Turn player's simultaneous triggers order**
Refs: CR 383.3.d.1. Setup: an event triggers one ability of P0 and one of P1 simultaneously during P0's
turn. Expect: P0's trigger is put on the chain first, P1's second → P1's resolves first.

**T060 — Order own simultaneous triggers**
Refs: CR 383.3.d. Setup: two P0 triggers from the same event. Expect: P0 gets an `orderTriggers` decision;
the chosen order is respected (last put = first resolved).

---------------------------------------------------------------------------------------------------

## E. Movement, contested, showdowns

**T061 — Standard move costs exhaust**
Refs: CR 144.2. Setup: P0's ready V(2) in base. Actions: move to BF-A. Expect: unit at BF-A, exhausted.
An exhausted unit can't standard-move.

**T062 — Group move with mixed origins**
Refs: CR 144.3. Setup: P0 has ready V(1) in base and ready Ganker(1) at BF-A; destination BF-B. Expect:
legal; both arrive at BF-B together (one move, one cleanup). Without Ganking the BF-A unit couldn't join.

**T063 — No battlefield-to-battlefield without Ganking**
Expect: a V(2) at BF-A has legal standard-move destinations {base} only.

**T064 — No standard move during a showdown or chain**
Refs: CR 144.1. Expect: `move` is not a legal action while a chain exists or during a showdown.

**T065 — Moving to an empty uncontrolled battlefield → non-combat showdown, mover has focus**
Refs: CR 190.3.a, 323.7, 323.11, 345. Actions: P0 moves V(2) to empty BF-A. Expect: BF-A contested by P0;
a showdown starts at BF-A; P0 has focus and priority; state Showdown Open.

**T066 — Showdown ends when both pass; conquer**
Refs: CR 347.2.a, 348.2.a. Continue T065: P0 passes, P1 passes. Expect: showdown ends; P0 controls BF-A;
P0 conquers → +1 point (P0 = 1); BF-A scored by P0 this turn.

**T067 — Focus passes after a played spell resolves**
Refs: CR 346, 347.1.b. Continue T065: P0 plays PumpA on own unit; both pass; it resolves. Expect: focus
moves to P1 (P1 has focus+priority). P1 passes → focus back to P0 → P0 passes → since all players passed
in sequence (P1 then P0), the showdown ends.

**T068 — "All passed in sequence" requires a full round after the last action**
Setup: T065. Actions: P0 passes, P1 plays ZapA (resolves), focus → P0. Expect: showdown does NOT end yet;
P0 passes, P1 passes → ends.

**T069 — Opponent responds in a non-combat showdown and removes the mover**
Setup: T065, P0 passes, P1 (focus) plays KillA on P0's unit; it resolves. Expect: P0 has no units at BF-A;
P0 passes, P1 passes → showdown ends with no units; BF-A stays uncontrolled; no conquer; contested removed.

**T070 — Moving to a battlefield you control: nothing happens**
Setup: P0 controls BF-A with a unit there; moves another unit there. Expect: no contest, no showdown.

**T071 — Leaving your battlefield loses control at next cleanup**
Setup: P0 controls BF-A with one unit; moves it to base. Expect: BF-A becomes uncontrolled at the cleanup
after the move; P1 gains nothing.

**T072 — Ambush unit joins a showdown**
Refs: CR 822. Setup: T065 (P0 at BF-A in a non-combat showdown); P1 has no units at BF-A. Expect: P1 cannot
Ambush there (needs own units there). If instead P1 had a unit at BF-A (i.e. combat), P1 could play
Ambusher(3) to BF-A as a Reaction.

**T073 — Spell moves an enemy into your battlefield → combat**
Setup: P0 controls BF-A with V(3); P0 plays Charm (move an enemy unit) moving P1's V(2) from P1's base to
BF-A. Expect: BF-A contested by **P1** (the unit's controller applies contested); combat staged; P1 is the
**attacker** (their unit applied contested), P0 defender. INFERENCE from CR 190.3.a, 466.2.c.1.

**T074 — Recall is not a move**
Refs: CR 458. Setup: a unit with "When I move, draw 1" is recalled by combat cleanup. Expect: no draw.

**T075 — Vilemaw's Lair blocks moving to base; recall ignores it**
Refs: card text, CR 458.3. Setup: P0's unit at Vilemaw's Lair ("Units can't move from here to base").
Expect: standard move to base not legal; MoveR on it does nothing (negated); but if it's recalled (e.g. combat
cleanup), it goes to base.

---------------------------------------------------------------------------------------------------

## F. Combat

**T076 — Combat starts when moving into enemy units; attacker has focus**
Refs: CR 466. Setup: P1 controls BF-A with V(2). P0 moves V(3) there. Expect: combat begins; P0 attacker,
P1 defender; designations on units; P0 has focus; combat showdown open.

**T077 — Simple combat: attacker wins and conquers**
Continue T076: both pass. Expect: damage: P0 assigns 3 to V(2); P1 assigns 2 to V(3); dealt simultaneously;
V(2) dies; V(3) survives (2 damage), healed to 0 in combat cleanup; P0 wins combat; P0 establishes control of
BF-A; conquer → P0 +1 point.

**T078 — Equal Might: both die**
Setup: V(3) attacks into V(3). Expect: both die; No result; BF-A becomes uncontrolled (P1 loses control);
no conquer for anyone.

**T079 — Both survive: attackers recalled**
Setup: P1 controls BF-A with V(5). P0 moves V(2) there (combat). In the combat showdown P0 plays StunA on
P1's V(5); then both pass. Expect: P1's total = 0 (stunned); P0 assigns 2 to V(5) → survives; combat
cleanup heals V(5) to 0 damage; P0's V(2) is recalled to P0's base (still exhausted, not a move); result =
No result; P1 keeps control of BF-A; no conquer; designations removed.

**T080 — Damage assignment must give lethal before spreading**
Refs: CR 467.2.c.3. Setup: attacker total 5 vs defenders V(3), V(3), V(3), V(3). Expect: the only legal
assignment shapes are {3,2,0,0} in some order of units; {2,2,1,0} illegal; {5,0,0,0} illegal (excess before
all lethal).

**T081 — Excess only after all are lethal**
Setup: attacker total 9 vs V(2), V(3). Expect: legal: 2+3 then remaining 4 anywhere (e.g. {6,3} or {2,7}).

**T082 — Tank first**
Refs: CR 815. Setup: attacker 4 vs Tank(3) + V(1). Expect: must assign 3 to Tank first, then 1 to V(1)
(both die). Assigning 1 to V(1) first is illegal.

**T083 — Backline last**
Refs: CR 826. Setup: attacker 3 vs Backline(1) + V(3). Expect: must assign 3 to V(3); Backline gets 0.

**T084 — Tank and Backline on same unit**
Refs: CR 467.2.c.8. Setup: defenders: unit X with both Tank and Backline (Might 2), V(2). Expect: assigner
picks: treat X as Tank (assign X first) or as Backline (assign V first); both are legal.

**T085 — Defender assigns too; simultaneous damage**
Setup: Assault(2,2) (Might 4 while attacking) vs Shield(3,1) (Might 4 while defending). Expect: both deal 4,
both die. No result, battlefield uncontrolled.

**T086 — Assault/Shield only in role**
Setup: Assault(2,2) defending. Expect: Might 2 (no bonus).

**T087 — Stunned unit deals no combat damage but takes it**
Refs: CR 424.1.b-c. Setup: P0's V(4) attacks P1's V(4); in showdown P1 plays StunA on P0's V(4).
Expect: P0 total 0; P1 assigns 4 → P0's unit dies; P1's unit undamaged; defender wins; no conquer
(P1 already controls).

**T088 — Negative Might counts as 0 in combat**
Refs: CR 143.2.c. Setup: P1's V(1) given −3 Might (Might −2) defending with V(3). Expect: P1's total = 0 + 3
= 3 (not 1).

**T089 — Pre-damaged unit needs less (lethal includes marked damage)**
Refs: CR 142.4.b. INFERENCE. Setup: P1's V(4) at BF-A has 3 damage (from ZapR-like effect earlier this turn +
1), plus V(2). Attacker total 3. Expect: legal assignment: 1 to V(4) (lethal), 2 to V(2) (lethal).

**T090 — Prevent affects lethal assignment**
Refs: CR 438.5, VEN Ki Barrier. Setup: P1's V(4) has "prevent the next 7 damage this turn" (Ki Barrier);
attacker total 12 vs that unit + V(1). Expect: lethal for the Ki Barrier unit = 11; must assign 11 there
first, then 1 to V(1); result: V(4) takes 4 (11−7) → dies; V(1) dies.

**T091 — Ki Barrier + Lotus Trap ordering**
Refs: VEN-FAQ #11. Setup: P1's 4-Might defender has Ki Barrier (prevent next 7) and Lotus Trap (double
damage); attacker 4-Might deals 4. Expect: P1 (controller of affected unit) chooses order: Ki Barrier first
→ 0 damage, 3 prevention left; Lotus Trap first → 8 then prevent 7 → 1 damage, 0 prevention left.

**T092 — Attack trigger fires once per combat**
Refs: CR 383.4.e. Setup: unit "When I attack, draw 1" attacks. Expect: one draw at combat start.

**T093 — Unit joining combat later gets designation and its attack/defend trigger**
Refs: CR 466.2.c.3.a, 383.4.f. Setup: P1 defends at BF-A; during the combat showdown P1 plays Ambusher(3)
there; it has "When I defend, draw 1" (fixture). Expect: after the cleanup following its arrival it is a
defender; its defend trigger fires; it contributes Might to damage.

**T094 — All attackers die: defender wins, no conquer**
Setup: P1 controls BF-A with V(5). P0 moves V(1) and V(1) there together. Both pass. Expect: P1 must assign
1 + 1 (lethal to each) and the 3 excess to either; both attackers die; P0 assigns 2 to V(5) → survives,
healed in cleanup; result: P1 wins the combat, P0 loses; P1 already controls BF-A → no conquer, no point.

**T095 — Defenders all die, attacker survives → conquer even though attacker didn't control**
Expect: as T077.

**T096 — Combat damage is not "spell damage"**
Refs: CR 418.6.c. Setup: P0 controls Immortal Phoenix in trash ("When you kill a unit with a spell, you may
pay..."). P0's unit kills P1's unit in combat. Expect: Phoenix does not trigger.

**T097 — Deathknell from combat resolves after combat cleanup healing**
Refs: CR 468.1-468.4, 808. INFERENCE (Origins FAQ asks this for Kog'Maw; answer text not retrievable).
Setup: P1 controls BF-A with Kog'Maw, Caustic (Might 1; "[Deathknell] — Deal 4 to all units at my
battlefield"). P0 moves V(5) and V(2) there. Both pass. P0 assigns 1 to Kog'Maw (excess 6 also to it);
P1 assigns 1 to V(5).
Expect, in order: (1) damage dealt; (2) combat cleanup step 3a kills Kog'Maw → Deathknell pending with
"my battlefield" = BF-A recorded; (3) step 3c heals V(5) to 0; (4) no defenders left → no recall;
(5) Deathknell resolves: 4 damage to V(5) and V(2) → next cleanup kills V(2); V(5) survives with 4 damage;
(6) result: P0 only player with units → P0 wins, establishes control, conquers (+1).

**T098 — Combat requires both sides present at damage step**
Refs: CR 467.1. Setup: in the combat showdown P1 plays MoveR moving their only defender to base. Expect: no
combat damage step; resolution: attacker is the only one with units → attacker wins → conquers.

---------------------------------------------------------------------------------------------------

## G. Scoring, final point, winning

**T099 — Hold at start of turn**
Refs: CR 315.2.b. Setup: P0 controls BF-A at the start of P0's turn. Expect: in the beginning-phase scoring
step P0 gains 1 point; "when you hold" triggers fire.

**T100 — Score each battlefield once per turn**
Refs: CR 472, 473.2.c. Setup: S0, P0 has two ready V(2) in base and MoveR in hand. P0 moves the first
V(2) to empty BF-A → showdown → both pass → P0 conquers (+1, P0 = 1). P0 plays MoveR returning that unit to
base; at the next cleanup P0 loses control of BF-A. P0 moves the second V(2) to BF-A → showdown → both pass
→ P0 establishes control again. Expect: the second establishment is NOT a conquer: no point (P0 stays at 1)
and no "when you conquer" triggers.

**T101 — Final point via conquer requires scoring every battlefield**
Refs: CR 473.1.b. Setup: P0 has 7 points, hasn't scored BF-B this turn; P0 conquers BF-A. Expect: P0 draws
1 card instead of the point; P0 stays at 7; conquer triggers still fire.

**T102 — Final point when both scored**
Setup: P0 at 6; holds BF-B at start of turn (→7); later conquers BF-A. Expect: P0 gains the point → 8 →
P0 wins at the next cleanup.

**T103 — Final point via hold is not restricted**
Setup: P0 at 7 controls BF-A only at start of turn. Expect: hold → 8 → win.

**T104 — Card points not restricted**
Refs: CR 473.1.a.1. Setup: P0 at 7; a card "score 1 point". Expect: P0 → 8, wins.

**T105 — Win requires strictly more points**
Refs: CR 194.2. Setup: both at 7; P0 scores to 8 while P1 is at 8 too (e.g. Burn-out points given to P1 then
P0 holds). Expect: no winner while tied; game continues until someone leads at ≥8.

**T106 — Win checked at cleanup**
Refs: CR 323.1. Expect: a player reaching 8 mid-resolution wins at the very next cleanup, not mid-spell.

**T107 — Points can't go below 0**
Refs: CR 194.4. Setup: P1 at 0; an effect "opponent loses 1 point". Expect: P1 stays at 0; "when a player
loses points" doesn't trigger.

**T108 — Hidden unit defends a battlefield on the opponent's turn**
Refs: CR 811, 190.4. Setup: P0 controls BF-A (P0's V(1) there) and hid HidU(3) at BF-A on P0's previous
turn. On P1's turn P1 moves V(2) to BF-A → combat; P1 attacker with focus. P1 passes; P0 (focus) plays
HidU(3) from facedown ignoring its cost (only to BF-A). Next cleanup gives it the Defender designation.
Both pass. Expect: P0 total 4 (exhausted units still deal damage), P1 total 2. P1's legal assignments are
exactly {V(1):1, HidU:1} and {HidU:2}; {V(1):2} is illegal (excess on a lethal unit while another unit can
still receive damage). P1's V(2) dies. Defender wins; P0 already controls BF-A → no conquer.

**T109 — Defender conquers when the battlefield was uncontrolled**
Refs: CR 468.5.d-e. INFERENCE. Fixture `DropR`: Reaction spell, "Play a unit from your hand to any
battlefield, ignoring its cost." Setup: BF-A uncontrolled and empty; P1's turn; P1 moves V(2) there →
non-combat showdown, P1 focus. P1 passes; P0 (focus) plays DropR putting V(4) at BF-A. Next cleanup: combat
staged at the showdown's battlefield → becomes a combat showdown; P1 = attacker (applied contested), P0 =
defender. Both pass. Expect: V(4) kills V(2); V(4) survives; P0 is the only player with units → P0
establishes control → conquer (P0 hasn't scored BF-A this turn) → P0 gains 1 point during P1's turn.

**T110 — Burn out with empty deck AND empty trash loses the game**
Refs: CR 432.2-432.3. Setup: P0's main deck and trash both empty; P0 at 0, P1 at 3; P0 must draw 1.
Expect: burn out → nothing to shuffle → P1 +1 (4); completing the draw attempts again on an empty deck →
burn out again → P1 +1 … repeating until P1 has 8 (> P0) → P1 wins immediately (no cleanup needed). Points
after the first in the sequence can't be prevented/replaced. Engine must not loop forever: stop as soon as
the win condition is met. (See open question Q7 for the case where the opponent can't win, e.g. Tianna.)

**T110b — Burn out with a non-empty trash**
Setup: P0's deck has 1 card, trash 4, P0 must draw 3. Expect: draw 1; burn out: trash (4) shuffled into
deck, P1 +1; draw the remaining 2 → deck 2, hand +3.

**T111 — Burn out with cards in trash**
Setup: P0 deck empty, trash 10. Actions: P0 must draw 2. Expect: draw 0, burn out (trash → deck shuffled, 10
cards; P1 +1), draw 2 → deck 8, hand +2.

**T112 — Look/reveal beyond deck size doesn't burn out**
Refs: CR 432.1.c, 437.4. Setup: P0 deck has 1 card; Predict 2. Expect: P0 looks at 1 card; no burn out.

---------------------------------------------------------------------------------------------------

## H. Cleanup and state-based behaviour

**T113 — Lethal damage kill in cleanup**
Expect: unit with damage ≥ Might (and > 0) dies at the next cleanup; unit with 0 Might and 0 damage stays
(SFD-FAQ #22).

**T114 — 0-Might unit dies to 1 damage**
Refs: CR 142.4.b. Expect: V(1) given −1 Might (0 Might) survives until dealt ≥1 damage.

**T115 — Gear stranded at a battlefield recalled**
Refs: CR 149.3, 459.1. Setup: P0's Sword attached to a unit at BF-A; the unit dies. Expect: Sword detaches at
BF-A and is recalled to P0's base in the same cleanup sequence; Sword remains ready/exhausted as it was.

**T116 — Facedown card trashed when battlefield control is lost**
Refs: CR 107.3.d, 323.6.a. Setup: P0 has HidU facedown at BF-A; P1 conquers BF-A. Expect: the facedown card
goes to P0's trash (revealed).

**T117 — Contested removed if contesting player has no units**
Refs: CR 323.10. Setup: P0 moves to empty BF-A; before the showdown starts (during the move's cleanup a
trigger on P1's side returns the unit to base — fixture). Expect: contested removed; showdown unstaged.

**T118 — Cleanup cascade**
Refs: CR 322. Setup: a unit's death triggers nothing; but a passive "+1 Might to units here while X is here"
disappears when X dies, making another unit's damage lethal. Expect: second unit also dies (in the repeated
cleanup).

---------------------------------------------------------------------------------------------------

## I. Triggers, replacements, layers

**T119 — "You may" trigger declined = never triggered (once-per-turn not used)**
Refs: CR 383.3.a, 386.2. Fixture: unit X "Once each turn, when you play a spell, you may draw 1."
Actions: P0 plays a spell, declines; plays a second spell. Expect: second spell offers the trigger again.

**T120 — Trigger with no legal target is removed**
Refs: CR 403.4. Fixture: "When you play me, deal 2 to an enemy unit at a battlefield." No enemy units at
battlefields. Expect: no target decision; trigger removed; no error.

**T121 — Leave-the-board trigger sees pre-death info**
Refs: CR 383.2.c.3, 808. DK-style fixture: "[Deathknell] — Deal damage equal to my Might to a unit." Unit
had +3 Might this turn (Might 5). Expect: deals 5.

**T122 — Replacement prevents death → no Deathknell**
Refs: CR 808.1.d.1, 383.2.c.3.a. Setup: P0 controls Zhonya's Hourglass ("If a friendly unit would die,
kill this instead. Heal that unit, exhaust it, and recall it.") and DK(2) at BF-A, which receives lethal
damage. Expect: Hourglass dies instead; DK(2) healed, exhausted, recalled to base; DK's Deathknell does NOT
trigger.

**T123 — Multiple replacements: affected object's controller orders**
Refs: CR 372. Setup: two "if a friendly unit would die" replacements controlled by P0 apply to one unit.
Expect: P0 is asked to choose which applies; only one can apply (the event is already replaced).

**T124 — Prevent pool**
Refs: CR 438. Setup: unit Might 4 with "prevent the next 3 damage this turn"; dealt 2, then 2. Expect:
after first: 0 damage, pool 1; after second: 1 damage, pool gone.

**T125 — Fully prevented damage isn't dealt**
Refs: CR 418.1.e.1, UNL-FAQ #8. Setup: P1 plays Elder Dragon ("any amount of your damage is enough to kill
enemy units"; play effect deals 1 to up to one enemy unit at each location); P0 responds with Counter
Strike (prevent the next damage to a chosen unit) on their V(5). Expect: V(5) takes 0 damage and survives;
no "dealt damage" triggers.

**T126 — Increases before decreases**
Refs: CR 479.4. Setup: V(2) gets "−1 Might, to a minimum of 1" (Stupefy) first, then +3 Might. Expect:
Might 4 (2+3−1). With Stupefy alone on a V(1): Might 1 (minimum).

**T127 — Base Might set + modifiers**
Refs: CR 143.2.a, 479.2. Setup: Dragon Form ("its base Might becomes 5 this turn") on V(2) with a +1 buff.
Expect: Might 6. Mighty status true.

**T128 — No intermediate state in layers**
Refs: VEN-FAQ #28. Setup: unit with Stupefy (−1) gets Dragon Form (base 5) → effective 4; Fiora, Worthy on P0's
side ("when a unit you control becomes Mighty, you may pay [C] to ready it"). Expect: no trigger (never 5).

**T129 — "Becomes Mighty" only on crossing**
Refs: CR 709. Setup: V(5) gets +1. Expect: no "becomes Mighty" trigger. V(4) gets +1 → trigger.

**T130 — Leaving the board clears modifications**
Refs: CR 124.1. Setup: buffed, damaged, stunned unit returned to hand and replayed. Expect: no buff, no damage,
not stunned, exhausted (new object).

**T131 — Granted keyword with no duration ends on zone change**
Refs: CR 801.3.a.3. Expect: a unit given "[Tank]" (no duration) keeps it until it leaves the board.

**T132 — Control change contests**
Refs: CR 190.3.a.2, SFD-FAQ #26. Setup: P1 controls BF-A with only V(2) there. P0 plays Hostile Takeover
("take control of an enemy unit at a battlefield, ready it; lose control and recall it at end of turn") on it.
Expect: next cleanup: BF-A contested by P0, P1 loses control, non-combat showdown at BF-A (P0 focus);
after both pass P0 conquers (+1). At end of turn, P1 regains the unit and it is recalled to P1's base.

---------------------------------------------------------------------------------------------------

## J. Keywords

**T133 — Accelerate with domainless unit**
Refs: CR 805.1.b.2. Expect: Accelerate's power can be any domain.

**T134 — Accelerate entering ready doesn't trigger "becomes ready"**
Refs: CR 805.6.a. Expect: "When a unit becomes ready" doesn't fire.

**T135 — Assault stacking**
Refs: CR 807. Setup: Assault(1,1) given Assault 2. Expect: attacking Might 4.

**T136 — Shield only while defending**
Setup: Shield(2,2) attacks. Expect: Might 2.

**T137 — Deflect tax**
Refs: CR 809. Setup: P1's Deflect(3,1) at BF-A; P0's ZapM costs [1]. Expect: targeting it costs [1] + [A]
(1 power any domain). Targeting with a spell that targets two units incl. this one: +[A] once. P1's own
spell targeting it: no tax.

**T138 — Deflect stacks; Heisho ignores**
Refs: CR 809, VEN-FAQ #31. Setup: unit with Deflect and Deflect 2 → tax [A][A][A]. At Heisho, Shell of the
World: no tax for spells choosing something there.

**T139 — Ganking route**
Refs: CR 810. Setup: Ganker(2) at BF-A, ready. Expect: legal standard-move destinations {base, BF-B}.

**T140 — Hide: cost, location, once per battlefield**
Refs: CR 811. Setup: P0 controls BF-A (empty facedown zone), not BF-B; HidU(2) in hand; 1 rune. Expect: hide
at BF-A costs [A] (1 power of any domain → recycle a rune); can't hide at BF-B; can't hide a second card at
BF-A; can't hide during a showdown.

**T141 — Hidden card can't be played the turn it was hidden**
Expect: on the same turn, the facedown card has no play action; on P1's next turn it may be played as a
Reaction (cost ignored).

**T142 — Hidden card playable on opponent's turn without a chain? (showdown)**
Refs: CR 811.1.b (gains Reaction). Setup: P0's HidU at BF-A; P1's turn, P1 moves into BF-A → combat
showdown; P1 has focus and passes. Expect: P0 (focus, Showdown Open) may play it. In P1's Neutral Open
main phase (no chain), P0 has no priority → cannot play it then.

**T143 — Hidden spell targets restricted to that battlefield**
Refs: CR 811.1.d.2-4. Setup: P0's HidZap at BF-A. Expect: legal targets only units at BF-A; a target in a
base is illegal; with no unit at BF-A it can't be played from facedown.

**T144 — Hidden permanent must be played to that battlefield**
Refs: CR 811.1.d.1. Expect: destination forced to BF-A.

**T145 — Playing a Hidden card normally from hand**
Refs: CR 811.3. Expect: pays full cost, no location/target restriction.

**T146 — Hidden card trashed if you lose control**
See T116.

**T147 — Legion**
Refs: CR 812. Fixture: unit L "[Legion] — When you play me, draw 1." Expect: first card of the turn → no
draw; after any other card finalized this turn (even if countered) → draw 1. A token played or an activated
ability doesn't enable it.

**T148 — Tank ordering among multiple Tanks**
Setup: attacker 5 vs Tank(3), Tank(3), V(1). Expect: 3 to one Tank, 2 to the other Tank; V(1) 0.

**T149 — Temporary dies before scoring**
Refs: CR 816, 323.5, 315.2. INFERENCE. Setup: P0's only unit at BF-A is Temp(3); P0 controls BF-A at the
end of P1's turn. Expect: at the start of P0's beginning phase the Temporary trigger kills Temp(3); the
cleanup after it resolves (Open state, no showdown, P0 has no units at BF-A) removes P0's control; in the
scoring step P0 controls nothing → no hold point.

**T150 — Vision**
Refs: CR 817. Expect: play effect: look at top card, may recycle it (DECISION).

**T151 — Equip**
Refs: CR 818. Setup: P0's Sword (Equip [1], +2 Might) in base, P0's V(2) at BF-A. Actions: activate Equip
targeting V(2). Expect: V(2) Might 4; Sword located at BF-A, attached; Sword's Equip no longer activatable.

**T152 — Equipped unit dies**
Refs: CR 719.5, 459.1. Expect: Sword detaches at BF-A; recalled to P0's base at the cleanup; can be equipped
again.

**T153 — Quick-Draw**
Refs: CR 819. Setup: Spinning Axe (Quick-Draw, Equip [C], +3, Temporary-if-unattached) in hand; P0's
V(2) in combat. Expect: P0 may play it as a Reaction during the combat; play effect attaches it to a chosen
friendly unit (no Equip cost) → V(2) Might 5 before damage.

**T154 — Weaponmaster cost reduction**
Refs: CR 821. Setup: Sword (Equip [1]) attached to unit A; P0 plays a Weaponmaster unit B. Expect: P0 may
pay [1] (no [A] to reduce) to move Sword onto B. With an Equipment "Equip [A]" the reattach is free. P0 may
decline.

**T155 — Repeat**
Refs: CR 820. Fixture: spell "Deal 1 to a unit. [Repeat] [1]". Expect: with Repeat paid: two separate 1-damage
instances, second target chosen anew (may differ); "when you play a spell" triggers once.

**T156 — Ambush location requirements**
Refs: CR 822.1-822.3. Expect: (a) Ambusher(3)'s legal destinations include every battlefield where P0 has
≥1 unit (controlled or not), plus P0's base and battlefields P0 controls; a battlefield where P0 has no
units is not offered for Ambush. (b) INFERENCE: if P0's only unit at the chosen battlefield leaves before the
Ambusher finalizes (e.g. it is killed as part of paying an additional cost), Check Legality fails and the
play is undone.

**T157 — Hunt and Level**
Refs: CR 823-824. Fixture: Scorchclaw ("[Hunt 2]"; "[Level 3][>] +1 Might and enters ready"). Expect: P0 at 0
XP plays Scorchclaw → exhausted, Might base; after it conquers P0 has 2 XP; second copy played at 2 XP still
exhausted; at 3+ XP enters ready and has +1 Might; dropping below 3 XP removes the bonus.

**T158 — Empower / Empowered**
Refs: CR 827-828. Fixture: Punching Poro ("[Empower] — Discard 1"; "[Empowered][>] +1 Might"). Expect:
activation in main phase discards 1, Poro is Empowered (+1 Might); can't activate again while Empowered;
returning to hand clears Empowered.

**T159 — Flow**
Refs: CR 829, VEN-FAQ #1. Fixture: Brittle Steel ("Kill a gear. [Flow] [4][C]") in P0's trash. Expect: P0
may play it from trash for [4][C]; after resolution it's banished (not trashed). If countered (e.g.
Abandon would return it to hand), it is banished instead.

**T160 — Deploy**
Refs: CR 830, card reminder. Fixture: Banner of Conquest ("[Deploy]; friendly units here have Assault").
Expect: playable to any battlefield (incl. an uncontrolled empty one or an enemy one); stays there through
cleanups; not a unit → doesn't contest; when P1 holds that battlefield, Banner dies.

**T161 — Disarm**
Refs: CR 831. Fixture: Mysterious Chronomancer ([Disarm 2]). Expect: on attack, DECISION target an enemy unit
there → −2 Might this turn. Two Disarm sources on one unit → one trigger, combined value.

**T162 — Show Off**
Refs: CR 832. Fixture: Incorrigible Construct ("[Show Off] a Mech. I enter ready if you showed off.").
Expect: as it's played P0 may reveal a Mech from hand or pick another friendly Mech on the board; if so it
enters ready. A facedown card can't be shown off.

**T163 — Buff max 1**
Refs: CR 427, 702.3. Expect: buffing a buffed unit does nothing (Might unchanged); Iridescent Avian's
"if it's already buffed, give it +2 Might this turn instead" gives +2.

**T164 — Stun can't be re-applied**
Refs: CR 424.1.a.1. Expect: stunning a stunned unit → no "when you stun" trigger.

**T165 — Predict 2**
Refs: CR 437. Expect: DECISION shows top 2; player chooses subset to recycle and order for the rest on top.

**T166 — Burn**
Refs: CR 441. Expect: Burn 2 moves top 2 to trash; with 1 card → burn 1, burn out, burn 1 more.

**T167 — Gold token**
Refs: CR 187.5. Expect: Gold: Reaction "kill this, exhaust this: add [A]" — usable mid-payment; the Gold
goes away (token ceases to exist in trash).

---------------------------------------------------------------------------------------------------

## K. Official FAQ rulings

**T168 — Ki Barrier vs Lotus Trap order (VEN-FAQ #11)** — see T091.

**T169 — Hidden Blade with "can't be killed" (VEN-FAQ #34a)**
Hidden Blade: "Kill a unit at a battlefield. Its controller draws 2." Target can't be killed. Expect: no kill,
its controller still draws 2 (instruction negated, not ignored).

**T170 — Hidden Blade target moved to base by Flash (VEN-FAQ #34b)**
Expect: target illegal (not at a battlefield) → mistarget → kill ignored AND the linked draw ignored → no draw.

**T171 — Hidden Blade vs Zhonya's Hourglass (VEN-FAQ #34c)**
Expect: Zhonya replaces the death (Hourglass dies instead, unit recalled); controller still draws 2.

**T172 — Gangplank, Naval empowered vs Stupefy at 1 Might (VEN-FAQ #21)**
Gangplank empowered: "If a spell/ability that chooses me would stun me, give me −Might, or return me to hand,
give me +3 Might this turn instead." Setup: Gangplank at 1 Might (from other effects), Stupefy (−1, minimum
1). Expect: no +3 (Might snapshot → no −Might event).

**T173 — Blast Cone stun then Back Off on empowered Gangplank (VEN-FAQ #20)**
Blast Cone: "When you move an enemy unit, you may exhaust this to stun it." Back Off: "Stun a unit."
Setup: P1's empowered Gangplank, Naval is moved by P0 and P0 uses Blast Cone; later P0 plays Back Off on
him. Expect (per FAQ): Gangplank IS stunned by Blast Cone (no +3); Back Off on the already-stunned
Gangplank gives no +3 Might because no stun is performed (CR 424.1.a.1).

**T174 — Mel empowered + Moonfall (VEN-FAQ #3)**
Expect: the chosen enemy unit gets −3, others at that battlefield −2.

**T175 — Mel empowered + Stupefy (VEN-FAQ #4)**
Expect: chosen unit −2 Might, minimum 1 (2 → 1).

**T176 — Abandon vs uncounterable spell (VEN-FAQ #5)**
Expect: Abandon resolves, only Predicts; the spell stays and resolves normally.

**T177 — Rebuttal is not a counter when paid (VEN-FAQ #6-7)**
Rebuttal: choose a spell with energy cost ≤4; may pay [A] → gain control, may make new choices; otherwise
counter it. Expect: paying gains control (new controller may remake any/no choices legally); not paying
counters it.

**T178 — Gaining control of a finalized spell doesn't make it "played" by you (VEN-FAQ #17)**
Battering Ram: "I cost [1] less for each card you've played this turn, to a minimum of [1]" (base [5]).
Setup: P0's turn. P0 plays Stupefy; P1 responds with Rebuttal paying [A] and gains control of Stupefy;
it resolves under P1's control. Expect: P0's "cards played this turn" count still includes Stupefy (P0's
Legion abilities stay active); P1's count includes only Rebuttal, not Stupefy (control was gained after
finalization), so a Battering Ram P1 plays this turn costs [4] (one [1] discount, not two).
The FAQ also states a Ravenbloom Student "triggers twice" in its scenario; the summary available did not
make clear whose Student — do NOT encode that part until verified (open question Q9).

**T179 — Swain, Visionary scoring (VEN-FAQ #18)**
Swain: "When I conquer, if you've played a non-token unit, a non-token gear, and a spell this turn, score 1
point." Setup: P0 played Patched Porobot (unit), a gear, and Stupefy, then conquers with Swain at 2 points.
Expect: +1 conquer and +1 Swain → 4.

**T180 — Switcheroo vs empowered Gangplank (VEN-FAQ #19)**
Setup: Switcheroo (swap Mights of two units at the same battlefield this turn) on opponent's 2-Might unit and
P0's empowered Gangplank (6). Expect: Gangplank's decrease is replaced by +3 → Gangplank 9; the other unit
6.

**T181 — Perched Grimwyrm + Dragon Roost (VEN-FAQ #26)**
Expect: Grimwyrm ("play me only to a battlefield you conquered this turn") can't be played to Dragon Roost
unless P0 conquered Dragon Roost this turn; "can't" beats Dragon Roost's permission; play undone.

**T182 — Dragon Roost alternative location (VEN-FAQ #25)**
Expect: when both a Dragon Roost requirement and another play-location requirement apply and don't exclude
each other, the player chooses.

**T183 — Renekton, Brute needs a change to 10+ (VEN-FAQ #30)**
Expect: "When my Might becomes 10 or more" only triggers on crossing from <10 to ≥10.

**T184 — Akali, Silent mistargeted (VEN-FAQ #16)**
Akali, Silent can't be chosen by enemy spells/abilities unless in combat. Setup: P1's Star-Crossed (return a
friendly unit and an enemy unit to hands) chose Akali during combat; P0 Flashes Akali to base. Expect: Akali
unaffected (mistarget); P1's own chosen unit still returns.

**T185 — Vilemaw's Lair vs Ride the Wind (VEN-FAQ #33)**
Ride the Wind: "Move a friendly unit and ready it." Unit at Vilemaw's Lair, destination base. Expect: move
negated, unit still readied.

**T186 — Kayle disempower (VEN-FAQ #15)**
Kayle, Justified can be Empowered up to 3 times. Expect: Disempower removes one status; activating Empower at 3
does nothing.

**T187 — Temporal Breach on a stolen unit (VEN-FAQ #29)**
Setup: P0 took control of P1's unit with Hostile Takeover, moved it to P0's base; P0 plays Temporal Breach
("banish a unit, then its owner plays it to the same location, ignoring its cost"). Expect: the owner (P1)
can't play it into P0's base → it stays banished.

**T188 — Turn to Dust on attached Equipment (UNL-FAQ #3)**
Turn to Dust gives a gear Temporary. Target: an attached Equipment. Expect: it dies at its controller's next
beginning phase (granted Temporary active though printed text inactive).

**T189 — Spinning Axe attached with granted Temporary (UNL-FAQ #4)**
Expect: printed Temporary inactive, granted one active → dies.

**T190 — Control can't be lost while items are on the chain (UNL-FAQ #5, Cruel Patron)**
Cruel Patron: additional cost kill a friendly unit. Setup: P0's only unit at BF-A (which P0 controls) is a
Recruit; P0 plays Cruel Patron to BF-A killing that Recruit as the cost. Expect: legal (control persists
while Patron is pending); Patron enters at BF-A; P0 keeps BF-A.

**T191 — No cleanup during finalization (UNL-FAQ #6)**
Expect: engine never runs cleanup steps inside the six-step play process.

**T192 — Alpha Strike targets moved by Flash remain chosen (UNL-FAQ #11)**
Repulse: counter an enemy spell that chooses a friendly unit at a battlefield and no other friendly unit.
Setup: Alpha Strike chose two of P1's units; Flash moved them to base. Expect: P1 can't use Repulse to
counter (they remain "chosen" though illegal); exception: targets that changed to a non-board zone don't count.

**T193 — Yone, Blademaster on Reckoner's Arena hold (UNL-FAQ #12)**
Reckoner's Arena: "When you hold here, activate the conquer effects of units here." Yone: "When I conquer a
battlefield that was uncontrolled, ..." Expect: Yone's ability doesn't go on the chain (it wasn't
uncontrolled).

**T194 — Atakhan with Accelerate losing Accelerate (UNL-FAQ #13)**
Expect: enters ready.

**T195 — Singularity countered; Jhin still cheap (UNL-FAQ #10)**
Jhin, Meticulous Killer: "If you've spent [4] or more to play a spell this turn, you may play me for [C]."
Expect: after a countered 6-energy Singularity, Jhin playable for [C].

**T196 — Green Father/Brush on Aspirant's Climb at 8–8 (UNL-FAQ #1)**
Aspirant's Climb increases the points needed to win by 1. Setup: both at 8, victory score 9 due to Aspirant's
Climb; P0 replaces Aspirant's Climb with a Brush. Expect: victory score returns to 8; nobody wins while tied
at 8; the next point either player gains is subject to final-point rules if from conquer.

**T197 — Draven win-combat trigger before conquer (SFD-FAQ #13-14)**
Draven, Audacious: "The first time I win a combat each turn, you score 1 point." Setup: P0 at 6, attacks
BF-A with Draven and wins, hasn't scored BF-B. Expect: Draven's +1 (→7) resolves before conquer; then conquer
at 7 is the final point → P0 hasn't scored BF-B → draws 1 instead. P0 ends at 7.

**T198 — Winning combat by default (SFD-FAQ #13)**
Expect: if defenders leave before damage (e.g. all moved to base), attacker "wins the combat" (win triggers
fire) without dealing damage.

**T199 — Tianna Crownguard (SFD-FAQ #10)**
Tianna: "While I'm at a battlefield, opponents can't gain points." Expect: opponent still conquers/holds
(triggers fire) but gains no points; the final-point draw still happens if it would have been the final point.

**T200 — Forgotten Monument (SFD-FAQ #11)**
"Players can't score here until their third turn." Expect: before a player's third turn, establishing control
there is not a conquer (no point, no conquer triggers); holding there gives nothing.

**T201 — 0 or negative Might doesn't die by itself (SFD-FAQ #21-23)**
Expect: a unit at −3 Might stays alive with 0 damage; needs +4 to reach 1; contributes 0 to combat.

**T202 — Ezreal, Prodigy reduces optional costs only (SFD-FAQ #24-25)**
"Optional additional costs you pay cost [1] or [A] less." Expect: reduces Accelerate/Repeat; not Equip, not
Deflect.

**T203 — Repeat with a cost reduction (SFD-FAQ #27)**
Setup: Find Your Center (base cost 3) given Repeat [3] by Temporal Portal, with its own 2 reduction. Expect:
total 4 (3 + 3 − 2); the reduction isn't repeated.

**T204 — Gravity Field (RAD-FAQ #12-14)**
Gravity Field: opponents must pay [1][A] to move one or more units to this battlefield. Expect: (a) a P1
standard move there with the tax declined → the whole move is undone/cancelled (no exhaust); (b) P0 playing
Charm to move P1's unit to P0's Gravity Field battlefield: P0 is the mover, P0 controls the Field → no tax;
(c) Angler Wyrm forcing P1 to move a unit to the Wyrm's battlefield with P0's Gravity Field there: P1 must
pay or the unit doesn't move.

**T205 — Angler Wyrm forced move choice (RAD-FAQ #15)**
Expect: the forced player must pick a unit that can legally move (e.g. not one under Hunker Down's "can't
move this turn").

**T206 — Runeblade Anvil duration (RAD-FAQ #5-7)**
"Until your next Ending Phase, you may play that card." Expect: killed on opponent's turn → playable until
P0's next ending phase begins; killed on P0's turn (main phase) → playable only until P0's ending phase of
THAT turn begins; killed during P0's ending phase → until P0's next turn's ending phase.

**T207 — Atakhan + Mordekaiser payment order (RAD-FAQ #4)**
Expect: energy and power are paid before the additional kill cost, so the unit being killed for the cost can't
be banished to pay Atakhan's power.

**T208 — Mobilize with Seraphic Wyvern and one rune left (RAD-FAQ #2)**
Mobilize: "Channel 1 rune exhausted. If you can't, draw 1." Wyvern: channel that many plus 1 exhausted
instead. Expect: channels the 1 remaining rune; "if you can't" refers to the original action, which happened
→ no draw.

**T209 — Riven + Stellacorn Herder group move trigger order (RAD-FAQ #11)**
Expect: Riven's "when I become exhausted" trigger goes on the chain before the move triggers.

**T210 — Possession on Ekko (RAD-FAQ #16)**
Expect: the controller may use Ekko's ability to banish and replay him, and controls him when he returns.

---------------------------------------------------------------------------------------------------

## L. Misc

**T211 — Facedown count public; card private** (getView): P1's view of P0's facedown card shows "hidden".
**T212 — Hand count public, deck count public, deck order secret** (getView).
**T213 — Determinism**: same seed + same actions ⇒ identical state hash.
**T214 — Additional turn** (CR 737): "take a turn after this one" → same player takes the next turn; then
normal order resumes.
**T215 — Concede during opponent's chain** (CR 650): accepted, game ends.
**T216 — Recycle multiple main-deck cards at once is random order** (CR 417.5): with fixed seed, order is
deterministic but not player-chosen.
**T217 — Cards go to owner's zones** (CR 056): killing P1's unit controlled by P0 puts it in P1's trash.
**T218 — Tokens vanish off-board** (CR 186.1): a killed Recruit token doesn't appear in any trash.
**T219 — Chosen champion doesn't return to champion zone** (CR 108.3.c): champion killed → owner's trash.
**T220 — Battlefield abilities of an uncontrolled battlefield are put on the chain by the TP** (CR 190.6.b).

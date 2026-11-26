# AI pilot: Vex, Gloomist (PILOT-B)

Lists: `02-vex.json` (CC JustSR, 2nd Bologna 8-0-2; 6 Calm / 6 Chaos) and `16-vex.json` (StarWOrso, 16th 6-2-1; 5 Calm /
7 Chaos, adds 2 Evelynn, Entrancing, 2 Reckless Innovator, 2 Edge of Night, 3 Discipline, Not So Fast; drops Pyke, Sneaky
Deckhand, Janna, Blitzcrank, Kharox, Back Off, Abandon). Champion: Vex, Apathetic. Battlefields: Bandle Scouts' Academy +
Startipped Peak in both, Hunters' Circle (02) / Durand Memorial (16).
Plan code: `src/ai/plans/vex.ts`; puzzles: `tests/ai/plans/vex.test.ts`.

## Sources

- riftbound.gg, "Vex Gloomist guide": <https://riftbound.gg/vex-gloomist-guide/> — hold-control: "Holding can only happen
  once we have conquered"; each hold draws (Gloomist); Vex, Apathetic (UNL-150) is the key early unit to develop and protect;
  Tornado Warrior (VEN-099) empowers Steel Paws (VEN-043) into a "sturdy holder"; Astral Heron (VEN-044) late: revealing a
  hidden card counts as playing a card; "will hide card every turn if possible"; Bandle Scouts' Academy (RAD-157) lowers
  hide costs; matchups Rek'Sai 17-83 (worst), Kennen 28% pre-ban, many 45-55%.
- ShonenTCG, "Riftbound Vex deck guide" (Oct 2026): <https://www.shonentcg.com/blog/riftbound-vex-deck-guide> — mulligan
  for a cheap holder, send back Kharox / expensive responses; "Establish the hold before exhausting Gloomist"; place Vex at
  the location the opponent must enter; "Keep Hidden cards back until the opponent commits"; Tornado Warrior's temporary
  boost "is useful for a hold threshold ... or a combat that would otherwise fail"; Deflect bodies absorb targeted removal;
  Kennen: keep one hold alive vs Assault 2 pressure; Azir: expect tokens, Scuttle Crab holds a low-Might space.
- Cards Realm, "Deck Tech - Holding Vex": <https://riftbound.cardsrealm.com/en-us/articles/riftbound-deck-tech-holding-vex> —
  "prevent your opponent from fighting for the battlefield you're dominating"; Vex, Apathetic is the main win condition, it
  punishes Ambush (Rengar), Accelerate and self-readying finishers ("pushed to hoard units in their base without scoring");
  "protecting it is a priority"; keep energy for reactions on the opponent's turn; vs removal-heavy decks mulligan for
  Defy / Not So Fast.
- riftbound.gg tier lists: Radiance week 2 <https://riftbound.gg/riftbound-meta-tier-list-best-decks-for-radiance-week-2>
  (Vex Tier 2, 53%, "unfavourable match-ups into most of the top ranked legend") and post-ban
  <https://riftbound.gg/radiance-post-ban-metagame-decks> (deck "barely touched" by the bans; competes in attrition vs Ezreal).
- Tournament: Bologna post-ban, Vex 2nd and 16th (docs/meta-decks.md).

## Win condition

Conquer one battlefield early with cheap bodies, then **hold it turn after turn** (1 point per hold + a Gloomist draw),
while Vex, Apathetic at a battlefield stuns every unit the opponent plays (they can't move it that turn, so fresh units
never attack or defend effectively the turn they land — Accelerate, Ambush, Reaction units and Sand Soldier tokens all
blank). Win the long game on cards: Gloomist draws, Scuttle Crab, Discipline, The Good Stuff (discard 1 / draw 3, returns
to hand when you hold there). Late: Astral Heron (7 Might, discounts the next card by [2][A][A] when it sits at a
battlefield), Baron Nashor (12, +2 to all others), Steel Paws empowered (7 Might for [7]).

## Key cards / roles

| Card | Role |
|---|---|
| Gloomist (legend) | When you hold: exhaust to draw 1. Always take it (the legend has no other use). |
| Vex, Apathetic (champion, 4) | Deflect; stun lock on opponent's new units while she is at a battlefield. Put her on the battlefield you hold, early (turn 3-4). Protect her (Defy, Not So Fast, Discipline). |
| Steel Paws (1) | Turn-1 body, Deflect. 0 Might but can conquer/hold an empty battlefield. Empower [7] late = 7 Might. Tornado Warrior from facedown empowers it for the turn (surprise 7-Might defender). |
| Bedeviling Stranger (2, Hidden) | Early body or hide; bounce an enemy unit when 4+ units are at a battlefield. |
| Scuttle Crab (2) | Cantrip body, holds at 0 Might; Deathknell reveals hand + their facedown cards. |
| Sneaky Deckhand (3, 02) | May be played straight to an open battlefield: conquer an empty one the same turn. |
| Tornado Warrior (3, Hidden) | Hide on the held battlefield; reveal in the opponent's attack to empower Steel Paws / defend. |
| Pyke (3, Hidden, 02) | Backline body; Gold token when enemy units die there. |
| Janna (02), Blitzcrank (02), Kharox (02), Evelynn (16) | Reaction heal+push out / pull an enemy in / late burn+reanimate / facedown pull. |
| Astral Heron (7) | Big holder; with the discount the next card is nearly free. |
| Baron Nashor (10+3) | Finisher, untargetable. |
| Defy (1+[A]) | Counter <=4-cost, <=1-power spells (removal on Vex, combat tricks). Hold up on the opponent's turn. |
| Gust (1) | Bounce a <=3-Might unit at a battlefield: reaction to break an attack or clear a defender. |
| Discipline (2) | +2 and draw, reaction; save a unit / win a combat. |
| Switcheroo (Hidden) | Swap Mights at a battlefield: Steel Paws (0) <-> their biggest attacker. Hide it. |
| Back Off (Hidden, 02), Rebuke, Star-Crossed, Abandon, Not So Fast | Removal / tempo / counters. |
| The Good Stuff | Deploy at the battlefield you hold: discard 1, draw 3; comes back when you hold. |

## Mulligan (keep 4, may send back 2)

Keep: Steel Paws, Bedeviling Stranger, Scuttle Crab, Sneaky Deckhand, Tornado Warrior, Reckless Innovator, one Defy/Gust.
Send back first: Baron Nashor, Astral Heron, Kharox, Blitzcrank, Star-Crossed, Rebuke, The Good Stuff, second+ reaction.
(Vex, Apathetic starts in the champion zone, always available.)

## Turn priorities

1. T1-2: a cheap body to a battlefield (conquer an empty one: Steel Paws / Scuttle Crab hold at 0 Might; Sneaky Deckhand to
   an open battlefield).
2. T3-4: Vex, Apathetic to the battlefield we control (or the one the opponent must contest). From then on every unit they
   play is stunned.
3. Every turn from T2: **hide one Hidden card at a battlefield we control** (Bandle Scouts' Academy refunds the [A] with a Gold
   token; Startipped Peak hold ramps a rune). Prefer Switcheroo / Tornado Warrior / Bedeviling Stranger. Never hide when it
   would leave no rune for a needed reaction.
4. Keep 1-2 runes open on the opponent's turn when holding Defy / Gust / Discipline (cards realm: save energy for reactions).
5. Hold > conquer: don't send the holders away from the held battlefield; attack the second battlefield only with spare
   units or when it wins the game.
6. Late: Astral Heron to a battlefield, then a cheap card + a discounted one; Baron when 13 runes are available.

## Reactions / hidden use

- Opponent attacks our battlefield: reveal Tornado Warrior (empower Steel Paws), Switcheroo (Steel Paws' 0 vs their biggest),
  Gust their <=3-Might attacker, Discipline our defender.
- Opponent casts removal on Vex / a holder: Defy (<=4 cost, <=1 power) or Not So Fast.
- Our attack: Switcheroo or Discipline to win the combat; Gust a <=3 defender.

## Matchups (field: Azir x4, Kai'Sa x4, Rek'Sai x3, Vex/Evelynn/Irelia x2, Kennen, Ezreal, Sett)

- Rek'Sai (worst, 17-83 per riftbound.gg): go-wide Accelerate units; Vex's stun blanks Accelerate; hold one battlefield, Gust
  / Switcheroo their biggest attacker; Defy Cull the Weak / Falling Star? (Falling Star costs 2+2 power: not Defy-able).
- Kennen: keep a hold alive; Vex stuns his Matriarch reanimations / Flow units; Defy Lightning Rush is low value, save it.
- Azir: Sand Soldiers are stunned on entry under Vex — Vex at a battlefield shuts off the turn-1 Soldier attack.
- Kai'Sa: spell-heavy removal (Hextech Ray 1+1 and Stupefy are Defy-able, Falling Star is not). Protect Vex with Deflect.
- Evelynn / mirror: information and the order of hidden reveals decide it.

## AI implementation (src/ai/plans/vex.ts)

- Mulligan table (keep Steel Paws / Bedeviling Stranger / Scuttle Crab / Sneaky Deckhand / Tornado Warrior, ship Baron /
  Heron / Kharox / Blitzcrank / Star-Crossed).
- Priors: Vex, Apathetic to a battlefield (+4; a second Vex while one already locks: -1), The Good Stuff only at a
  battlefield we control, Astral Heron to a battlefield, hide +2; combat tricks outside a fight -6 (shared `pumpPrior`).
- Targets: Gloomist "draw on hold" always yes; Startipped Peak yes; Tornado Warrior empowers Steel Paws (+7) / Kharox;
  Switcheroo swaps our lowest Might with their highest; pumps only on our units in the current fight (`pumpTarget`);
  bounce / stun / damage never on our own units (`harmTarget`); discard the least useful card.
- Responses: counters (Defy / Not So Fast / Abandon) only against a real threat (`chainThreat` >= 3: cost, power, and
  whether it chooses our champion / key unit); facedown cards revealed only in a fight at their battlefield;
  Gust / Discipline / Star-Crossed / Switcheroo only in fights or against an enemy chain item.
- Hide values (on top of the core's facedown premium): Switcheroo 3.4, Tornado Warrior 2.8 (4.2 next to Steel Paws /
  Kharox), Back Off 3, bodies 2.4-2.6, +1.2 at Bandle Scouts' Academy.
- Eval: Vex at a battlefield +3 (once), empowered Steel Paws +1, The Good Stuff at a held battlefield +1, `ctl` weight 4
  (holding is the plan; also counters the core projection issue in docs/ai-requests.md), +-12 per queued extra turn.
- Reserve: keep the cheapest *castable* reaction's energy open at end of turn (value 2).

## Competence puzzles (tests/ai/plans/vex.test.ts) — 10, all passing

- Vex T4: Vex, Apathetic goes to the battlefield we hold (stun lock), and a Hidden card is hidden there
- Vex: the Gloomist draw is always taken when we hold
- Vex: Defy counters Cull the Weak that would kill our only unit (Vex at the held battlefield)
- Vex: facedown Tornado Warrior is revealed on defence and empowers Steel Paws (7 Might) to hold
- Vex: Gust bounces the 3-Might attacker of our held battlefield
- Vex: at 7 points a ready unit conquers the empty battlefield for the win
- Vex: The Good Stuff is deployed at the battlefield we hold, never at an uncontrolled one
- Vex mulligan: keep the cheap holders, send back Baron Nashor and Astral Heron
- Vex: Switcheroo hidden at the battlefield wins the defence (swap Steel Paws 0 with the attacker)
- Vex: Rebuke clears the enemy holder (never our own Astral Heron), then a unit conquers

## Measured (2026-11-26, PILOT-B; snapshot runs, tools: /tmp bench = new SearchAI with plans vs legacy AI)

Strength = mirror match, new AI + plan vs the old (legacy) AI on the same list, both seats alternating. Field = new AI on
this list vs the legacy AI on a random Bologna list (pilot winrate vs the old bot, not vs new-AI opponents). 95% Wilson CIs. Mirror numbers pool 2 chunks of
<= 7.5 min (seeds 3-5); the earlier chunk of Vex / Evelynn / Irelia ran one plan revision before the final one (targeting
fixes only). Raw per-game JSON: /tmp/pilotb/{m1,m2,m3,f2,r1} (bench script /tmp/pilotb/bench.ts, run inside a snapshot).

| List | Strength (mirror vs legacy) | seat 0 / seat 1 | Field vs legacy (final plan) | Field vs legacy (first plan) |
|---|---|---|---|---|
| 02-vex | 49/82 = **60%** [49-70] | 71% / 48% | 28/40 = 70% [55-82] | 34/38 = 89% |
| 16-vex | 36/61 = **59%** [46-70] | 74% / 43% | 36/40 = 90% [77-96] | 30/35 = 86% |

Mechanic metrics per game (mirror games, tested side):

| List | hides | facedown plays own turn / opp turn | legend: activations / optional uses / resolves | empowers | plays on opp turn | runes by own turn 8 | avg turns |
|---|---|---|---|---|---|---|---|
| 02-vex | 2.2 | 0.8 / 0.3 | 0.0 / 4.2 / 4.2 | 0.0 | 0.7 | 10.7 | 13.8 |
| 16-vex | 2.5 | 1.0 / 0.4 | 0.0 / 4.5 / 4.5 | 0.0 | 1.5 | 11.3 | 14.9 |

Reading. Mechanics match the written plan: a hide most turns we hold a battlefield (2.2-2.5/game, one facedown slot per battlefield), the Gloomist draw taken on every hold (~4.2-4.5/game), Vex, Apathetic deployed to a battlefield (~1/game), reactions on the opponent's turn ~1/game, runes ~11 by turn 8. vs the legacy field the deck wins 75-90%. **Strength criterion (>= 70% in the mirror) is NOT met: 59-60%.** The mirror is a hold race: both sides hold one battlefield each, the first player reaches 8 first (seat 0 71-74% vs seat 1 43-48%; losses are mostly 7-8 / 8-7 at turn 15-17) and the AI almost never attacks the enemy-held battlefield (about 2 moves per game). A paired A/B with the core alone (no plan, same seeds, 45 games) gave 27 vs 25 wins: the plan does not change mirror strength — the gap is core turn planning (requested in docs/ai-requests.md: hold-race term). A +3 'behind in the race' plan bonus changed nothing in 45 paired games and was not kept. Sanity vs reality: Bologna 2nd and 16th, riftbound.gg Tier 2 / 53%; vs the legacy field our Vex is the strongest PILOT-B deck after Evelynn, consistent with a top list.

# AI pilot: Evelynn, Agony's Embrace (PILOT-B)

Lists: `03-evelynn.json` (ECL ElSub89, 3rd Bologna 8-0-2; 6 Body / 6 Chaos; Bandle Scouts' Academy, Rakelstake, Startipped
Peak) and `15-evelynn.json` (ilMilly95, 15th 6-2-1; 5 Body / 7 Chaos; Bandle Scouts' Academy, Packed Amphitheater,
Startipped Peak). Champion: Evelynn, Entrancing. 03 is the "hidden + Body tricks" build (3 Vex, 3 Rengar, 2 K'Sante, Ruin
Runner, 3 Hold 'Em, 2 Punch First, 2 Rampage); 15 adds a Tornado Warrior + Tail-Cloaked Matriarch reanimation package,
Kinkou Initiate, 2 Ezreal.
Plan code: `src/ai/plans/evelynn.ts`; puzzles: `tests/ai/plans/evelynn.test.ts`.

## Sources

- riftbound.gg, Evelynn, Agony's Embrace guide (Den): <https://riftbound.gg/?p=4673> — the opponent is put in a "lose-lose
  situation": challenge the battlefield where Evelynn has hidden cards, or let her hold it and gain the benefits of revealing
  those cards **on her own turn**; "pressure our opponent quickly, forcing them to take risks"; hidden cards are usually
  support (surprise units, Switcheroo to win a showdown); she prefers revealing on her own turn to maximise the legend and
  champion; Bandle Scouts' Academy (RAD-157) "designed for Evelynn"; Gold-token makers pay for hiding; discard-then-draw
  cards become plain draws with the legend; small rune count, plays several cards per turn; good vs big-unit decks
  (Switcheroo), spell-removal decks "a bit more annoying".
- riftbound.gg Radiance week-2 tier list (Evelynn 36% pre-ban, untiered):
  <https://riftbound.gg/riftbound-meta-tier-list-best-decks-for-radiance-week-2>.
- Vex guides (shared Hidden package): ShonenTCG <https://www.shonentcg.com/blog/riftbound-vex-deck-guide> ("Keep Hidden cards
  back until the opponent commits"; Tornado Warrior boost for "a combat that would otherwise fail").
- Tournament: Bologna post-ban, Evelynn 3rd and 15th (docs/meta-decks.md): the deck performed far above its earlier 36%.

## How the legend works (engine)

Agony's Embrace: once each turn, when you play a card **from face down**, draw 1; if it's not your turn, discard 1 after.
A hidden card costs [A] to hide (at a battlefield you control with an empty facedown slot, CR 811) and is played later for
[0] base cost. So the core loop is: **hide a card on turn N at a controlled battlefield, play it from face down on turn N+1
(our turn) = a free card + a draw**, then hide another. On the opponent's turn a reveal is still a free card but the draw is
a loot (draw, then discard) — still fine when it wins a combat.

## Win condition

Tempo-pressure with cheap Hidden units (Evelynn, Bedeviling Stranger, Gutter Guardian, Pyke, Tornado Warrior, Momentary
Companion), win combats with Body tricks (Punch First +5, Hold 'Em +3 for [1] after a unit/gear went to a battlefield,
Rampage fight), Rengar's Ambush (6 Might as a Reaction to any battlefield with enemy units), Vex, Apathetic's stun lock,
and card flow from the legend. Hold battlefields to score; Startipped Peak and K'Sante ramp on hold.

## Key cards / roles

| Card | Role |
|---|---|
| Evelynn, Entrancing (champion; 2 main in 03) | Hidden. From face down **on our turn**: move an enemy unit from a different location to her battlefield (pull a lone defender off the battlefield we attack, or pull a weak unit into our units and kill it). Backline. |
| Gutter Guardian (3, Hidden) | Show Off a Hidden card (reveal from hand / pick a friendly facedown one): [Add] [A] -> pays the next hide. |
| Bedeviling Stranger, Pyke, Tornado Warrior, Momentary Companion | Hidden bodies; reveal as Reactions in the opponent's attack (Companion is Temporary then) or on our turn for the draw. |
| Vex, Apathetic (3 in 03, 2 in 15) | Stun every unit the opponent plays while she is at a battlefield. |
| Rengar, Trophy Hunter (5+1) | Ambush: Reaction to a battlefield with enemy units even without ours: surprise 6-Might attacker/defender. |
| K'Sante (5, Shield 2) | Defender; holds = channel a rune. |
| Tail-Cloaked Matriarch (15) | Empower [2][C] (or Tornado Warrior's free empower) -> play a <=3-cost unit from trash. |
| Punch First / Hold 'Em / Rampage | Showdown tricks / removal. Hold 'Em costs [1] after a unit or gear was played to a battlefield this turn (a facedown reveal at a battlefield counts). |
| Switcheroo (Hidden), Gust, Star-Crossed, Abandon, Rebuke | Interaction. |
| Edge of Night (Hidden) | From face down it attaches to a unit there: +2 surprise. |
| The Good Stuff (03) | Card draw at a held battlefield. |

## Mulligan

Keep: Bedeviling Stranger, Gutter Guardian, Pyke, Tornado Warrior, Kinkou Initiate, Reckless Innovator, Evelynn (main-deck
copy), Ezreal (15). One cheap trick is fine. Send back first: Rengar, Ruin Runner, K'Sante, Star-Crossed, Rampage, The Good
Stuff, a second 4+ cost card.

## Turn priorities

1. T1-2: a cheap unit to a battlefield / conquer an empty battlefield.
2. Every turn we control a battlefield with an empty facedown slot: **hide a Hidden card** (Bandle Scouts' Academy refunds
   it as a Gold token). Prefer units (Evelynn, Bedeviling, Pyke, Tornado Warrior) and Switcheroo / Edge of Night.
3. Next turn: **play the facedown card first** (free + legend draw), then spend the energy from hand; hide again.
4. Evelynn from face down on our turn: pull the strongest/lone defender of the battlefield we want to conquer into our
   units, or pull a small unit into a fight it loses.
5. Attack with tricks in hand; on defence keep Rengar / facedown units / Gust as surprise blockers.
6. Do not reveal facedown cards on the opponent's turn just for value — only when it wins/prevents a combat or saves a unit
   (the draw becomes a loot and the card loses its next-turn value).

## Matchups

- Azir / Rek'Sai (go-wide): Vex stun + Rampage/Gust on key units; Bedeviling Stranger's 4-units bounce is live.
- Kai'Sa / Ezreal (removal spells): keep a facedown unit to rebuild a battlefield; don't overcommit a single big unit.
- Irelia / Vex: Abandon / Switcheroo; Evelynn pulls Irelia away from protection.
- Sett (Body buffs): Rampage before they buff; Switcheroo their buffed unit.

## AI implementation (src/ai/plans/evelynn.ts)

- Mulligan table (keep cheap Hidden bodies, Kinkou, Innovator, Ezreal; ship Ruin Runner, Rengar, K'Sante, Star-Crossed).
- Priors: playing a facedown card on our turn +5 (free card + legend draw), hide +3, Vex to a battlefield +3, combat
  tricks outside a fight -6.
- Hide value 3.4 + 0.35 x cost (+1 Evelynn, +1.5 Tornado Warrior next to Matriarch, +1.2 Bandle Scouts' Academy); a
  facedown card that is already playable on our own turn while the legend's draw is unused is worth only 0.3, so the
  search plays it instead of hoarding it.
- Targets: Gutter Guardian always shows off (+[A]); Evelynn's pull prefers a lone defender (opens a battlefield) or a
  weak unit; Matriarch reanimates the most expensive unit; pumps only in the fight; harmful effects never on own units.
- Responses: facedown reveals on the opponent's turn only in a fight at that battlefield (the legend then only loots);
  Rengar Ambush in fights; Abandon only vs real threats.
- Eval: Vex at a battlefield +2.5, `ctl` 3.

## Competence puzzles (tests/ai/plans/evelynn.test.ts) — 9, all passing

- Evelynn: on our turn the facedown card is played (free card + legend draw)
- Evelynn: with a battlefield under control and spare power, a Hidden card is hidden there
- Evelynn from face down pulls the lone defender off battlefield 1, then a unit conquers it
- Evelynn: Rengar ambushes the attacked battlefield as a Reaction and holds it
- Evelynn: Gutter Guardian shows off a Hidden card for the extra [A] and hides it with that [A]
- Evelynn: at 7 points, attack the 4-Might holder and Punch First for the winning conquer
- Evelynn: a facedown unit is NOT revealed on the opponent's turn without a fight (keeps its free play + draw)
- Evelynn mulligan: keep the cheap Hidden bodies, send back Ruin Runner and Rengar
- Evelynn: Hold 'Em goes on the defender in the fight, not on Vex at the other battlefield

## Measured (2026-11-26, PILOT-B; snapshot runs, tools: /tmp bench = new SearchAI with plans vs legacy AI)

Strength = mirror match, new AI + plan vs the old (legacy) AI on the same list, both seats alternating. Field = new AI on
this list vs the legacy AI on a random Bologna list (pilot winrate vs the old bot, not vs new-AI opponents). 95% Wilson CIs. Mirror numbers pool 2 chunks of
<= 7.5 min (seeds 3-5); the earlier chunk of Vex / Evelynn / Irelia ran one plan revision before the final one (targeting
fixes only). Raw per-game JSON: /tmp/pilotb/{m1,m2,m3,f2,r1} (bench script /tmp/pilotb/bench.ts, run inside a snapshot).

| List | Strength (mirror vs legacy) | seat 0 / seat 1 | Field vs legacy (final plan) | Field vs legacy (first plan) |
|---|---|---|---|---|
| 03-evelynn | 92/100 = **92%** [85-96] | 98% / 86% | 36/40 = 90% [77-96] | 36/40 = 90% |
| 15-evelynn | 65/75 = **87%** [77-93] | 97% / 76% | 33/40 = 82% [68-91] | 35/40 = 88% |

Mechanic metrics per game (mirror games, tested side):

| List | hides | facedown plays own turn / opp turn | legend: activations / optional uses / resolves | empowers | plays on opp turn | runes by own turn 8 | avg turns |
|---|---|---|---|---|---|---|---|
| 03-evelynn | 3.2 | 2.0 / 0.4 | 0.0 / 0.0 / 2.4 | 0.0 | 0.5 | 11.4 | 13.6 |
| 15-evelynn | 4.2 | 3.1 / 0.5 | 0.0 / 0.0 / 3.4 | 0.0 | 0.3 | 10.2 | 14.7 |

Reading. The hide -> play-from-facedown-on-our-turn loop works: 3.2-4.2 hides and 2.0-3.1 own-turn facedown plays per game, the legend's draw resolving 2.4-3.4 times per game, facedown cards revealed on the opponent's turn only ~0.4/game (in fights). Strength criterion met (87-92% in the mirror). Sanity vs reality: Bologna 3rd and 15th; riftbound.gg had Evelynn at 36% pre-ban — our numbers are vs the old AI, which handles hidden cards badly, so they overstate the deck against strong opponents.

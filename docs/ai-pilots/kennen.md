# AI pilot: Kennen, Heart of the Tempest (PILOT-B)

List: `11-kennen.json` (LorenzTheDoc, 11th Bologna 6-1-2; 9 Chaos / 3 Order; Minefield, Veiled Temple, Zaun Warrens).
Champion: Kennen, Storm of Shuriken.
Plan code: `src/ai/plans/kennen.ts`; puzzles: `tests/ai/plans/kennen.test.ts`.

## Sources

- Riftbound Guide, "Kennen Champion Deck Guide": <https://riftboundguide.com/2026/07/23/riftbound-kennen-champion-deck-guide/>
  — an **engine deck**: "Early turns fill your trash with Flow cards, and later turns play them back out for value and Empower
  triggers. Burn effects can speed this up"; the legend empowers "any time you play a card from somewhere other than your
  hand" — Flow from trash and **Hidden cards revealed from a battlefield**; then "spend an action to Disempower him and
  exhaust him" for Assault 2: "play a Flow card, Empower, spend the Empower on an attacker, and repeat"; VEN-044 key in
  multiple builds; Stacked Deck banned Sep 2026 ("reduces consistency rather than removing the archetype").
- Cards Realm, "Deck Tech - Kennen Reanimator": <https://riftbound.cardsrealm.com/en-us/articles/riftbound-deck-tech-kennen-reanimator>
  — fill the board with big units, rebuild cheaply; "Use Ride the Wind early to score two points in one turn, then return
  your attacker to base"; never discard Last Rites / Ride the Wind / Flash; use the yellow (Order) runes for Hidden cards;
  Minefield works well on the draw, Zaun Warrens blind.
- riftbound.gg Radiance week-2 tier list <https://riftbound.gg/riftbound-meta-tier-list-best-decks-for-radiance-week-2>
  (Kennen Tier 1, 59% past week, "an overall balanced legend"; ~48% vs Kai'Sa; Rengar 28% vs Kennen) and post-ban
  <https://riftbound.gg/radiance-post-ban-metagame-decks> (Kennen a main ban target; Ezreal's matchups vs Kennen 20-30%).
- Rules: docs/rulings.md — playing Kennen from the **champion zone** counts as "anywhere other than your hand"
  (empowers the legend); token plays do not.
- Tournament: Bologna post-ban, Kennen 11th.

## Engine: what empowers the legend

Any card played from: champion zone (Kennen himself), facedown (Bedeviling Stranger, Tideturner, Tornado Warrior, Edge of
Night, Switcheroo), trash (Lightning Rush Flow [2][A], Kennen's conquer Flow, Fizz's recast, Tail-Cloaked Matriarch's
reanimation, Kharox's play from the opponent's trash). Then `[Action] Disempower, [T]: a unit gets Assault 2 this turn` —
use it on our main attacker before/at the attack (+2 Might as attacker), once per turn (it exhausts).

## Win condition

Tempo midrange that scores with **Assault-boosted attacks**: fill the trash (Kennen's Burn 2, Lightning Rush's dumped cards,
Minefield), replay value from the trash/facedown to keep the legend empowered every turn, attack with Kennen / Matriarch /
Tornado Warrior + Assault 2; Ride the Wind = double conquer. Seal of Discord ([T]: add [C]) pays power without recycling
runes (Flow [A], hide [A], Matriarch's [C], Last Rites [C]).

## Key cards

| Card | Role |
|---|---|
| Kennen, Storm of Shuriken (3+1) | Play from champion zone T3-4: empowers the legend, Burn 2. When he conquers, a spell in trash gets Flow = its cost this turn (replay Lightning Rush / Star-Crossed / Switcheroo). |
| Trifarian Captain (2) | Dig a <=3 unit/gear (Seal, Tornado Warrior, Matriarch-able units). |
| Lightning Rush (1) | Pick the best of top 3, rest to trash (fuel); later Flow [2][A] from trash = draw + empower. |
| Seal of Discord (0+1) | Power ramp: [T] add [C]. Play early. |
| Tail-Cloaked Matriarch (4) | Empower [2][C]: reanimate a <=3-cost unit from trash (empowers the legend too: played from trash). |
| Tornado Warrior (Hidden) | From face down: empower something here (Matriarch -> free reanimation). |
| Bedeviling Stranger / Tideturner / Edge of Night / Switcheroo (Hidden) | Hide at a controlled battlefield, play from face down next turn = empower + free card. |
| Traveling Merchant (2) | Loot on move. |
| Fizz (3+1) | Recast a <=3 spell from trash (empowers). |
| Reckless Innovator, Kharox | Bodies; Kharox late (Burn 3 + steal a unit from their trash). |
| Last Rites (Equip [C] + recycle 2 from trash) / Edge of Night | +2 equipment. |
| Gust, Hard Bargain, Deathgrip, Star-Crossed | Reactions. |
| Ride the Wind (2+1) | Move + ready: second attack in a turn. |

## Mulligan

Keep: Trifarian Captain, Seal of Discord, Bedeviling Stranger, Tideturner, Traveling Merchant, Lightning Rush, Tornado
Warrior, Reckless Innovator. Send back: Kharox, Star-Crossed, Last Rites, 2nd Matriarch, Hard Bargain, Deathgrip.

## Turn priorities

1. T1-2: Seal of Discord / Captain / 2-drop to a battlefield; Lightning Rush early to fill the trash.
2. T2+: hide a Hidden card each turn at a controlled battlefield (Seal pays the [A]); next turn reveal it first (empower).
3. T3-4: Kennen from the champion zone (empower + Burn 2).
4. Each turn the legend is empowered: give Assault 2 to the attacker that turns a losing/even attack into a conquer.
5. Matriarch: empower when a good <=3 unit is in the trash (Tornado Warrior, Captain, Innovator).
6. Ride the Wind after a conquer for a second conquer, or return the attacker to defend.

## Matchups

- Ezreal / Kai'Sa (removal): spread threats; Hard Bargain their key spell (Time Warp, Singularity).
- Vex: stun lock hurts reanimated units (stunned on entry); attack with units already on board.
- Azir / Rek'Sai: race; Gust/Star-Crossed their biggest attacker.

## AI implementation (src/ai/plans/kennen.ts)

- Registered as `['Kennen', 'ven-155-166']`: the legend's first tag is "Yordle", so the core's legendKey never matched
  "kennen" (reported in docs/ai-requests.md) — before this fix the plan was silently unused.
- Priors: playing from facedown / trash / champion zone +3.5 when the legend is not empowered (it empowers it), Seal of
  Discord early +3, Lightning Rush +1.5; main-phase use of the legend's Assault 2 -4 (it is used in the showdown of our
  attack instead, via `respond` +5 and a target rule that only accepts our attackers).
- Targets: Lightning Rush takes the best card (cheap units early), Kennen's conquer Flow prefers Ride the Wind /
  Star-Crossed / Switcheroo, Matriarch / Fizz pick the best reanimation / recast, Tornado Warrior empowers Matriarch /
  Kharox.
- Hide value 2 + 0.3 x energy (-0.8 if another card is already facedown), 0.5 once playable on our turn with the legend
  not empowered (play it). Recycle cost 2.2 per rune while <= 5 runes (1.5 later, 0.2 when the rune deck is empty,
  Kennen 0.3): seen 5 runes on turn 10 before.
- Hard Bargain only vs threats >= 3.5 (Time Warp); eval +-12 per queued extra turn (core ignores Time Warp), empowered
  legend +4 outside combat (don't waste it), Seal on board +1.2, `ctl` 4.

## Competence puzzles (tests/ai/plans/kennen.test.ts) — 8, all passing

- Kennen: play the facedown card (empowers the legend), give Assault 2 and conquer the 4-Might battlefield
- Kennen: at 7 points the empowered legend's Assault 2 turns a 4-vs-4 attack into the winning conquer
- Kennen: Kennen, Storm of Shuriken is played from the champion zone (empowers the legend, Burn 2)
- Kennen: facedown Tornado Warrior empowers Tail-Cloaked Matriarch, which reanimates a unit from the trash
- Kennen: Hard Bargain counters a tapped-out Time Warp
- Kennen: a Hidden card is hidden at the controlled battlefield
- Kennen: Gust bounces the attacker that would take our battlefield
- Kennen mulligan: keep Captain / Seal, send back Kharox and Star-Crossed

## Measured (2026-11-26, PILOT-B; snapshot runs, tools: /tmp bench = new SearchAI with plans vs legacy AI)

Strength = mirror match, new AI + plan vs the old (legacy) AI on the same list, both seats alternating. Field = new AI on
this list vs the legacy AI on a random Bologna list (pilot winrate vs the old bot, not vs new-AI opponents). 95% Wilson CIs. Mirror numbers pool 2 chunks of
<= 7.5 min (seeds 3-5); the earlier chunk of Vex / Evelynn / Irelia ran one plan revision before the final one (targeting
fixes only). Raw per-game JSON: /tmp/pilotb/{m1,m2,m3,f2,r1} (bench script /tmp/pilotb/bench.ts, run inside a snapshot).

| List | Strength (mirror vs legacy) | seat 0 / seat 1 | Field vs legacy (final plan) | Field vs legacy (first plan) |
|---|---|---|---|---|
| 11-kennen | 46/72 = **64%** [52-74] | 78% / 50% | 20/37 = 54% [38-69] | 21.5/38 = 57% |

Mechanic metrics per game (mirror games, tested side):

| List | hides | facedown plays own turn / opp turn | legend: activations / optional uses / resolves | empowers | plays on opp turn | runes by own turn 8 | avg turns |
|---|---|---|---|---|---|---|---|
| 11-kennen | 2.1 | 1.4 / 0.1 | 0.8 / 0.0 / 6.4 | 1.7 | 0.6 | 9.8 | 16.7 |

Reading. The engine is used: the legend empowers ~1.7 times per game (champion zone, facedown and trash plays), Assault 2 is spent in our attacks (~0.8/game, no longer wasted in the main phase), ~1.4 own-turn facedown plays and 2.1 hides per game, Matriarch / Tornado Warrior / Kharox reanimation lines seen in watched games, runes ~9.8 by turn 8 (was 5 on turn 10 before the recycle cost). Important fix: the plan was not used at all before registering the legend card id (legend tags are ['Yordle','Kennen']). **Strength criterion NOT met: 64% [52-74] in the mirror**, again a hold race decided by seat (seat 0 78%, seat 1 50%, losses 8-7 at turn 17). Field vs legacy 54-57%. Sanity vs reality: 11th in Bologna, riftbound.gg Tier 1 / 59% pre-ban (now weakened by bans): our Kennen is under-performing reality, mostly through the same passive-attack issue as Vex.

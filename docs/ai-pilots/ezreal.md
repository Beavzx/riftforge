# AI pilot: Ezreal, Prodigal Explorer (PILOT-B)

List: `12-ezreal.json` (pogrommm, 12th Bologna 6-2-1; 6 Chaos / 6 Mind; Frozen Fortress, Rockfall Path, Sigil of the Storm).
Champion: Ezreal, Prodigy.
Plan code: `src/ai/plans/ezreal.ts`; puzzles: `tests/ai/plans/ezreal.test.ts`.

## Sources

- RiftMana, "Ezreal Prodigal Explorer Deck Guide": <https://riftmana.com/?p=26671> — controls the board with removal, then
  "dominates its foes with big units and outvalues them with their legend ability"; legend draws once enemy units/gear were
  chosen twice this turn, "You can activate it right after the second target"; "One Bellows Breath hitting two units is
  enough"; Ezreal, Prodigy "is central to our gameplan" (discard 1 draw 2, discounts Repeat/Accelerate); Wages of Pain +
  Stupefy = core removal pair; Watcher + Bellows Breath "is the biggest power play" (removes three units while developing a
  7-Might body); Fizz recasting Wages ≈ a 3-Might unit for [A]; Hard Bargain "stops Kai'Sa from cheesing you with Time Warp".
- Cards Realm, "Deck Tech - Watcher Ezreal Mind/Chaos": <https://riftbound.cardsrealm.com/en-us/articles/riftbound-deck-tech-watcher-ezreal-mind-chaos>
  — the deck "centers around drawing Watcher, protecting it, replaying it"; banish-and-replay Watcher (Arcane Shift there,
  **Temporal Breach** here) re-triggers its -3; Fizz replays Wages of Pain from the trash; end game: Singularity / removal on
  key threats; favourable vs Kai'Sa, poor vs green counter decks (Irelia); Hard Bargain "counters their counters".
- riftbound.gg post-ban <https://riftbound.gg/radiance-post-ban-metagame-decks> — Ezreal 41% this set, 20-30% vs Kennen /
  Riven, "Benefits from a slower pace", difficult vs Rek'Sai; expected to improve after the bans.
- Rules: docs/rulings.md — Prodigal Explorer counts **each enemy unit/gear chosen** (one spell choosing two enemies = twice).
- Tournament: Bologna post-ban, Ezreal 12th.

## Win condition

Removal-control: kill or bounce what the opponent commits (Wages of Pain 3 at a battlefield, Deadly Flourish 3, Bellows
Breath 1 to up to three units at a location (+Repeat), Stupefy -1 + draw, Singularity 6+6, Gust, Star-Crossed), draw extra
cards with the legend (two enemy choices per turn -> [T] draw 1), and win with Thousand-Tailed Watcher (7 Might, -3 to all
enemy units this turn: combined with Bellows Breath it wipes a location) and Fizz / Ezreal bodies. Temporal Breach on our
own Watcher replays it (new -3); Pack of Wonders rebuys Fizz / Bewitching Spirit / Watcher.

## Key cards

| Card | Role |
|---|---|
| Ezreal, Prodigy (3+1) | Loot 1-for-2 on play; discounts Bellows Breath's Repeat and Watcher's Accelerate. Play from champion zone T3. |
| Bewitching Spirit (3) | Body + opponent discards. |
| Fizz, Trickster (3+1) | Body + free recast of a <=3 spell from trash (Wages of Pain, Bellows Breath, Stupefy, Gust). |
| Thousand-Tailed Watcher (7+1) | Finisher / sweeper with Bellows Breath. |
| Wages of Pain (3, Hidden) | Deal 3 to a unit at a battlefield + Gold. Hide it at a controlled battlefield (free later). |
| Deadly Flourish (4) | Deal 3 to an enemy unit, Gold if it dies. |
| Bellows Breath (1+1, Repeat [1][C]) | 1 damage to up to 3 units at one location; 2 enemy choices = legend draw. |
| Stupefy (1) | Reaction -1 + draw: shrink an attacker / finish a combat; also an enemy choice for the legend. |
| Temporal Breach (2+1, Hidden) | Re-trigger our Watcher/Ezreal/Spirit; or reset an enemy buffed unit. |
| Singularity (6+2) | Kill two big units. |
| Gust / Star-Crossed / Hard Bargain | Reactions: bounce attacker, counter their key spell. |
| The List, Pack of Wonders, Treasure Trove, Sprite Fountain, The Good Stuff | Gear utility / value. |

## Legend use

Activate the legend (draw) whenever available: it requires two enemy choices this turn, so pair removal (Stupefy + Wages, one
Bellows Breath on two enemies). It is a Reaction-speed ability, so the draw can happen immediately.

## Mulligan

Keep: Stupefy, Wages of Pain, Bellows Breath, Gust, Bewitching Spirit, Fizz, one Deadly Flourish. Send back: Singularity,
second Watcher, Star-Crossed, Treasure Trove, Sprite Fountain, The List, Temporal Breach without Watcher.

## Turn priorities

1. Early: trade removal for their early units at battlefields (Wages / Stupefy+combat); Bewitching Spirit / Fizz bodies to
   contest a battlefield.
2. Hide Wages of Pain / Temporal Breach at a controlled battlefield when the [A] is affordable.
3. Keep 1-2 runes open on the opponent's turn for Stupefy / Gust / Hard Bargain.
4. T7+: Watcher (+Bellows Breath at the location with their units).
5. Use the legend draw every turn it is enabled.

## Matchups

- Kennen / Rek'Sai (bad): kill engine pieces (Matriarch, Kennen) on sight; Bellows Breath vs 1-2-Might swarms.
- Kai'Sa: Hard Bargain Time Warp; favourable per cardsrealm.
- Irelia / Vex (green counters): bait Defy with cheap spells first; Hard Bargain their counter.
- Azir: Bellows Breath kills Sand Soldiers (2 Might after -1? no: 1 damage kills only 1-Might; combine with Stupefy/Watcher).

## AI implementation (src/ai/plans/ezreal.ts)

- Mulligan table (keep Stupefy / Wages / Bellows / Gust / Spirit / Fizz; ship Singularity, 2nd Watcher, Star-Crossed).
- Legend: activating Prodigal Explorer (draw; only legal after two enemy choices) +6 in every window.
- Priors: develop bodies early (Bewitching Spirit / Fizz / Vex +2 until turn 10), Watcher when they have units, Temporal
  Breach only on our Watcher (else -5), Bellows Breath only with 2+ enemy units.
- Targets: Bellows Breath never on own units, +4 on units it kills (damage / Watcher's -3); its Repeat only once the rune
  deck is empty; Temporal Breach on our Watcher (+8); Fizz recasts Wages > Bellows > Stupefy / Gust; Pack of Wonders
  rebuys Treasure Trove / Fizz / Spirit; Bewitching Spirit makes the opponent discard; harmful effects never on own units.
- Resources: recycle cost 2.6 per rune while <= 5 runes (1.8 later; Watcher / Singularity 0.5; 0.2 once the rune deck is
  empty). Seen before: two Fizz + a hide took the deck from 4 runes to 1 on turn 9.
- Responses: Hard Bargain only vs threats >= 3.5 (Time Warp), removal in fights / vs enemy chain items; eval +-12 per
  queued extra turn.

## Competence puzzles (tests/ai/plans/ezreal.test.ts) — 8, all passing

- Ezreal: Bellows Breath finishes two damaged enemy units, then the legend draws (two enemy choices this turn)
- Ezreal: Wages of Pain clears the 3-Might holder, then Bewitching Spirit conquers the battlefield
- Ezreal: Thousand-Tailed Watcher (-3) then Bellows Breath wipes three enemy units at their base
- Ezreal: Fizz recasts Wages of Pain from the trash on the enemy holder
- Ezreal: Stupefy wins the even defence of our battlefield
- Ezreal: Hard Bargain counters a tapped-out Time Warp
- Ezreal: at 7 points, attack the 3-Might holder with Fizz and Stupefy it for the winning conquer
- Ezreal mulligan: keep cheap removal, send back Singularity and Thousand-Tailed Watcher

## Measured (2026-11-26, PILOT-B; snapshot runs, tools: /tmp bench = new SearchAI with plans vs legacy AI)

Strength = mirror match, new AI + plan vs the old (legacy) AI on the same list, both seats alternating. Field = new AI on
this list vs the legacy AI on a random Bologna list (pilot winrate vs the old bot, not vs new-AI opponents). 95% Wilson CIs. Mirror numbers pool 2 chunks of
<= 7.5 min (seeds 3-5); the earlier chunk of Vex / Evelynn / Irelia ran one plan revision before the final one (targeting
fixes only). Raw per-game JSON: /tmp/pilotb/{m1,m2,m3,f2,r1} (bench script /tmp/pilotb/bench.ts, run inside a snapshot).

| List | Strength (mirror vs legacy) | seat 0 / seat 1 | Field vs legacy (final plan) | Field vs legacy (first plan) |
|---|---|---|---|---|
| 12-ezreal | 35.5/54 = **66%** [52-77] | 61% / 70% | 20/40 = 50% [35-65] | 16.5/38 = 43% |

Mechanic metrics per game (mirror games, tested side):

| List | hides | facedown plays own turn / opp turn | legend: activations / optional uses / resolves | empowers | plays on opp turn | runes by own turn 8 | avg turns |
|---|---|---|---|---|---|---|---|
| 12-ezreal | 1.5 | 0.0 / 1.0 | 1.5 / 0.0 / 1.5 | 0.0 | 2.8 | 10.1 | 23.8 |

Reading. Legend draws ~1.5/game (two enemy choices -> draw), ~2.8 removal/reactions on the opponent's turn, Wages hidden ~1.5/game and revealed in fights, runes ~10 by turn 8 after the recycle cost (before: 4 -> 1 runes on turn 9 in watched games), games long (24 turns) as expected for removal-control. **Strength criterion NOT met on the point estimate: 66% [52-77]** (seed 4: 79% over 28 games, seed 5: 52% over 26 games — high variance in grindy mirrors). Field vs legacy 50% (43% with the first plan); losses concentrated vs Kai'Sa and Rek'Sai (go-wide/aggro), which riftbound.gg also lists as bad. Sanity vs reality: 12th in Bologna, riftbound.gg 41% before the bans: a ~45-50% deck under this AI is roughly consistent.

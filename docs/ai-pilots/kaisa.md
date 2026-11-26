# AI pilot: Kai'Sa, Daughter of the Void (PILOT-A)

Lists: `06-kai-sa.json` (darkchri99, 6th 7-1-2), `07-kai-sa.json` (Kokey, 7th), `18-kai-sa.json` (Ganjalf, 18th),
`23-kai-sa.json` (SH Daniela Zilioli, 23rd; Card Sharp, Heisho), plus the fifth Kai'Sa slot of the field (5 lists of 20 incl.
pooled). Fury/Mind 7/5, battlefields Frozen Fortress / Rockfall Path / Void Gate (23: Heisho instead of Frozen Fortress).
Plan code: `src/ai/plans/kaisa.ts`; puzzles: `tests/ai/plans/kaisa.test.ts`.

## Sources

- Hextech Analytics, Kai'Sa legend guide: <https://hextechanalytics.com/legends/kaisa> — "Trade early, build resources for
  one decisive expensive turn, then convert board control into points"; keep enough bodies on the battlefield; legend Power
  is spell-only ("saves runes you would otherwise recycle for removal"; can't pay Survivor's Accelerate or Watcher); keep
  hands with two cheap units; Stupefy first makes Noxus Hopeful cost 2; Watcher's -3 then cheap damage (Tracker, Bellows
  Breath, Hextech Ray, Falling Star) finishes units; Time Warp once a battlefield is secure; battlefields: Void Gate (+1 per
  damage instance), Rockfall Path (Temporal Breach on an enemy there = removal), Frozen Fortress (1-Might units can't hold).
- RiftMana, "Fury Mind Kai'Sa Daughter of the Void Deck Guide": <https://riftmana.com/?p=2521> — mulligan for early plays
  (Hextech Ray, Lecturing Yordle); bank energy on defensive turns for Action damage spells; avoid many high-Power spells
  early; Noxus Hopeful via Legion for 2; Survivor conquers to draw (Accelerate her for an immediate attack); Time Warp at 6-7
  points; legend is a Reaction (use it on the opponent's turn).
- CoolStuffInc, Will Sobel "Kai'Sa right out of the gate": <https://www.coolstuffinc.com/a/willsobel-seo-11252025-kaisa-right-out-of-the-gate>
  — removal early, small board; Hextech Ray with the legend costs only 1 energy; Hextech Ray + Stupefy kills a 4-Might unit
  for 2 energy; Watcher -3 then attack "can steamroll a defended battlefield".
- Anime Alley "Kai'Sa deck guide": <https://animealley.ca/blogs/the-synergy-lab/kaisa-daughter-of-the-void-riftbound-deck-guide>
  — spell control; Thousand-Tailed Watcher "wins games by itself if it sticks for two turns"; Falling Star premium removal.
- Tournament: Bologna post-ban, Kai'Sa 6th, 7th, 18th, 23rd (docs/meta-decks.md).

## Resource model

- Legend: **[T]: [Reaction] — [Add] [A], spells only.** Use it every turn cycle on a spell's power cost (Hextech Ray [1][A],
  Falling Star [2][R][R] -> one rune recycle saved, Stupefy, Smoke Screen, Bellows Breath, Temporal Breach, Void Seeker, Time
  Warp). It readies each turn: an unused legend is a wasted rune. It is a Reaction: on the opponent's turn it pays for
  Smoke Screen / Stupefy / Hextech Ray in a showdown.
- Every other power cost recycles a rune (Falling Star's second [R], Watcher [B], Forerunner [R], Accelerate [1][C]).
  Recycle early only for removal that wins a battlefield or kills a key unit.

## Win conditions

1. Board control: cheap units (Poro, Sentry, Yordle, Tracker, Hopeful) contest early points; removal (Hextech Ray 3 at a
   battlefield, Void Seeker 4 + draw, Falling Star 3+3, Bellows Breath 1x3 (Repeat), Get Excited!, Lost to the Sands,
   Singularity 6+6, Icathian Rain 6x2) clears the opponent's units so the small units hold.
2. **Thousand-Tailed Watcher** (7 + [B], 7 Might, enemy units -3 this turn) -> attack into the weakened battlefield (conquer),
   finishing survivors with cheap damage; 7-Might body holds.
3. **Kai'Sa, Survivor** conquers for a card each time. **The Empyrean** (8 Might, show off -> predict + draw 2) and
   **Ferrous Forerunner** (6 Might, two 3-Might Mechs on death) as late threats. **Sky Splitter** (5 damage, cost reduced by
   my highest Might).
4. **Time Warp** (10 + 4 power, extra turn) when at 6-7 points or holding both battlefields: the extra turn scores holds again.

## Mulligan

- Keep: 2-cost units (Plundering Poro, Watchful Sentry), Lecturing Yordle, Bilgewater Tracker, Hextech Ray, Stupefy, one
  Falling Star, Noxus Hopeful with another cheap card, Card Sharp (23).
- Send back: Time Warp, The Empyrean, a second Watcher, Singularity, Icathian Rain, Sky Splitter, Ferrous Forerunner (when
  the hand lacks cheap plays).

## Turn-by-turn

- **T1-T3:** a cheap unit each turn to a battlefield (Rockfall Path: units can't be played there — move in from base);
  keep [1] + legend for Hextech Ray / Stupefy on the opponent's attack; Hopeful after another card (Legion: 2 energy).
- **T3-T5:** Survivor (4) — Accelerate only when she conquers this turn. Trade removal for their best unit at the battlefield
  that decides the next point; Bilgewater Tracker pings 1-Might tokens (Sand Soldier Recruits, Birds).
- **T6-T8:** Watcher -> attack the enemy-held battlefield in the same turn (Watcher enters exhausted unless accelerated:
  attack with the units already there / at base); Empyrean / Forerunner as bodies; Falling Star the blockers.
- **Late:** Time Warp at 6+ points (legend pays one power); Singularity / Icathian Rain for wide boards (Azir, Rek'Sai).

## Combos & sequencing

- Hextech Ray (+1 with Void Gate) + Stupefy (-1) kills a 4-Might unit; Watcher (-3) then Bellows Breath (1 to three units,
  Repeat) wipes Soldiers/Recruits.
- Stupefy / any card first, then Noxus Hopeful for 2 (Legion).
- Temporal Breach hidden at Rockfall Path (only if controlled) = permanent removal of an enemy unit there; on own Watcher /
  Empyrean / Tracker elsewhere = replay the play effect.
- Sky Splitter after Watcher/Empyrean is on board (cost 8 - 7 = 1).

## Hiding

- Temporal Breach (Hidden) at a controlled battlefield when the opponent will contest it.
- Nothing else in the list has Hidden. Keep the legend + 1-2 runes open for Reaction/Action damage instead.

## Matchups

- **Azir:** Bellows Breath / Bilgewater Tracker / Watcher punish 2-Might Soldiers; kill Azir, Sovereign before he attacks
  (Hextech Ray when he moves to a battlefield is too late for the trigger — kill him at a battlefield earlier); their Defy
  counters Hextech Ray / Falling Star (bait with cheap spells first).
- **Rek'Sai:** wide aggro; Bellows Breath and Watcher are the swing; don't fall behind on board (race their conquers).
- **Vex:** her stun on played units hits our units too — play units when Vex is not at a battlefield or remove Vex
  (Deflect: [A] extra; Heisho ignores Deflect).
- **Evelynn / Irelia:** removal on the key champion (Irelia has Deflect); hold Smoke Screen for their combat tricks.
- **Sett:** kill Sett, Kingpin through The Boss's save only when the legend is exhausted / no power; Watcher -3 hits buffed units.
- **Mirror:** card advantage + Watcher timing; Time Warp wins long games.

## Results (PILOT-A, 2026-11-26)

Plan: `src/ai/plans/kaisa.ts` — mulligan for cheap units / Ray / Stupefy; combos "legend [A] -> spell with a power cost"
(the legend's spell-only power pays instead of a rune), Watcher -> attack, cheap card -> Noxus Hopeful (Legion), legend ->
Time Warp, Kai'Sa with / without Accelerate; damage targeting (kill > chip, Void Gate +1, a second "(2 of 2)" instance never
wasted on a unit the first already kills — `ctx.chosenThisPlay`); responses with Ray / Stupefy / Smoke Screen + legend on the
opponent's turn; Temporal Breach hidden at Rockfall Path.

- Puzzles: tests/ai/plans/kaisa.test.ts 8/8 (legend pays Ray with no recycle, Ray + Stupefy on a 4-Might unit, Watcher then
  conquer, Poro -> Hopeful, Falling Star 3+3 on two units, Bellows Breath + Repeat on three Soldiers, Ray on the attacker in
  the opponent's showdown, no Accelerate without an attack).
- Mechanic metrics (40 games vs the field): legend 4.1/game, Hextech Ray 0.9, Falling Star 1.0, Stupefy 1.0, Watcher 0.95,
  Time Warp 0.2, Temporal Breach hidden 0.3; runes at own turn 4/6/8 = 6.0 / 8.2 / 9.1.
- Strength vs the legacy AI (mirror, both seats): 43-16-1 over 60 games (72.5%) — criterion 4 met.
- Pilot winrate vs the field: 28-12 (70%, metrics run incl. mirrors) and 20-4 (ai-bench, seed 10); vs non-Kai'Sa 25/32.
- Sanity: stronger than its Bologna placings (6th/7th/18th/23rd) suggest — removal decks are easy for a search AI; see
  azir.md "Why Azir is still ~33%". Not an AI failure of this deck, but it inflates Kai'Sa in the round robin.

# AI pilot: Sett, The Boss (PILOT-A)

List: `13-sett.json` (Jhino Insegno, 13th 6-2-1). Body/Order 7/5; battlefields Hunters' Circle, Monastery of Hirana, Packed
Amphitheater. Plan code: `src/ai/plans/sett.ts`; puzzles: `tests/ai/plans/sett.test.ts`.

## Sources

- Hextech Analytics, Sett legend guide: <https://hextechanalytics.com/legends/sett> — "Sett wants a board worth keeping":
  The Boss saves a **buffed** unit that would die (pay [A], exhaust, spend its buff: heal, exhaust, recall); readies on
  conquer; works on the opponent's turn; "Keep one Power and the Legend ready when your front unit is buffed and threatened";
  Pillaged Armory to a battlefield you expect to hold (buff on play and each conquest there); Kingpin +1 per buffed friendly
  unit at his battlefield; Showstopper buffs a base unit and moves it (also an exhausted one); First Mate readies a
  recalled unit; Punch First +5 is not a buff; Call to Glory spends a buff for a free +3; "A unit holds only one buff" —
  spend buffs on units The Boss doesn't need to protect; Monastery of Hirana: spend a buff to draw on conquest; weakness:
  hands of expensive fights stall without cheap units and buff setup.
- Tournament: Bologna post-ban, Sett 13th (docs/meta-decks.md).

## Win conditions

1. A board of **buffed** units (Pit Rookie buffs another, Pillaged Armory buffs, Showstopper buffs + moves) that The Boss
   keeps alive -> trades favourably every combat.
2. **Sett, Kingpin** (4+[O], 5 Might, Tank, +1 per buffed friendly unit at his battlefield) at the key battlefield with
   2-3 buffed units: 7-8 Might Tank.
3. Combat tricks: Punch First (+5, Action, [1][B][B]), Call to Glory (+3, free by spending a buff, Reaction), Rampage
   (fight, +2 with [C]), Irresistible Faefolk (pulls an enemy unit into its battlefield: fight on our terms), Ambush units
   (Rengar 6 can ambush where enemies are; Vi stuns; Nidalee draws on win).

## Mulligan

- Keep: Pit Rookie, Trifarian Captain, Irresistible Faefolk, Pillaged Armory, Kinkou Initiate, First Mate, Showstopper,
  one trick (Punch First / Call to Glory) with 2+ units.
- Send back: Ruin Runner, second Rengar / Vi, Rampage without units, hands with no 2-cost unit.

## Turn-by-turn

- **T1-T2:** 2-drops; Pit Rookie after another unit (buff it); Pillaged Armory to a battlefield we hold/contest.
- **T3-T4:** Kinkou Initiate (draw with 5+ other Might), Fiora (Mighty at 5: Deflect/Ganking/Shield — buff her), Sett, Kingpin
  at the battlefield with buffed units; keep [A] + legend ready when a buffed unit is threatened.
- **T5+:** Showstopper the best base unit into the fight; Ambush Rengar / Vi on the opponent's attack; Call to Glory with a
  buff from a unit not at Sett's battlefield.

## Combos & sequencing

- Unit first, then Pit Rookie (buffs the other unit), then Kingpin to their battlefield.
- Conquer -> The Boss readies (save available again).
- Faefolk moves to a battlefield and pulls their weakest/most valuable unit to fight our buffed team.
- Don't spend Kingpin's battlefield-mates' buffs on Call to Glory (Kingpin loses Might); use other units' buffs.

## Hiding

- No Hidden cards. Reactions: Call to Glory, Ambush units (Vi, Rengar, Nidalee). Keep energy open on the opponent's turn
  when holding them.

## Matchups

- **Azir:** buffed units out-trade 2-Might Soldiers; Rampage / Faefolk pick off Azir, Sovereign; watch Hidden Blade on Sett.
- **Kai'Sa:** removal-heavy: keep [A] + The Boss up for the buffed carrier; Ruin Runner can't be chosen by their spells.
- **Rek'Sai:** trade on board with buffs; Kingpin Tank holds.
- **Vex:** her stun on played units — play units to base, Showstopper moves them later.

## Results (PILOT-A, 2026-11-26)

Plan: `src/ai/plans/sett.ts` — mulligan for 2-drops / Armory / Showstopper; priors (Pit Rookie when an unbuffed unit exists,
Showstopper with a base unit, Kingpin + buffed units, tricks only in combat, The Boss save always); combos unit -> Pit Rookie,
Showstopper the best base unit; buff targeting (unbuffed units, Kingpin's battlefield-mates), Call to Glory spends a buff
away from Kingpin, Faefolk pulls a valuable enemy, Rampage / Punch First / Ambush units as showdown responses; keeps [A] +
The Boss ready when a buffed unit is exposed.

- Puzzles: tests/ai/plans/sett.test.ts 8/8 (unit -> Pit Rookie buff, The Boss saves Fiora from Falling Star, Showstopper an
  exhausted base unit into a conquer, Kingpin to the buffed battlefield, Punch First wins the attack, Faefolk pull, lethal,
  Rampage with [C]).
- Mechanic metrics (40 games): buffs 3.2/game, The Boss saves (recalls on the opponent's turn) 0.7, Pit Rookie 1.4,
  Showstopper 0.9, Kingpin 1.2, Punch First 0.6; runes 5.2 / 7.2 / 9.4.
- Strength vs the legacy AI (mirror): 45-15 over 60 games (75%) — criterion 4 met.
- Pilot winrate vs the field: 25-15 (62.5%); beats Azir 4/4 and Rek'Sai 3/4, weaker vs Irelia (1/4).

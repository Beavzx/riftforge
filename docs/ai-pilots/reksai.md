# AI pilot: Rek'Sai, Void Burrower (PILOT-A)

Lists: `04-rek-sai.json` (ElMambo, 4th 8-0-2), `05-rek-sai.json` (Valdi4real, 5th; Blood Rush / Cleave, 3 Imperial Decree,
Rockfall Path), `17-rek-sai.json` (SH BADTRONPLAYER, 17th; Grim Apothecary, 3 Concert Poster). Fury/Order 7/5 (05: 6/6).
Plan code: `src/ai/plans/reksai.ts`; puzzles: `tests/ai/plans/reksai.test.ts`.

## Sources

- Hextech Analytics, Rek'Sai legend guide: <https://hextechanalytics.com/legends/reksai> — proactive midrange: "Build a board
  of small units, find the right attack, and use conquests to keep the turn going"; legend reveals 2 on conquer, banish one
  and play it **at full cost**; use it "after the first attacker has done its job, while you still have resources for the
  next threat"; Breacher gives Accelerate to units played from outside the hand (legend reveals, tokens); Undertitan adds [2]
  as it is revealed; Cull the Weak is best with a Dredger / Dog / Recruit to sacrifice; "Make your group of units before
  spending resources on pumping them"; take the first battlefield cheaply; "Count the Power you need after attacking before
  recycling runes for Accelerate"; Forbidding Waste (-2 to a lone defender), Candlelit Sanctum (top-2 filter), Rockfall Path.
- riftbound.gg "Rek'Sai best decks": <https://riftbound.gg/reksai-best-decks-cards/> — conquest-oriented, "works best with an
  early scoreboard lead", punishes overcommitting, few comeback tools; struggles vs Kai'Sa (43%).
- Tournament: Bologna post-ban, Rek'Sai 4th, 5th, 17th (docs/meta-decks.md).

## Win conditions

1. Early conquests with cheap units (Inferna 1+Assault 2 Ambush, Carrion Dredger, Trifarian Captain, Faithful Manufactor +
   Recruit, Hunting Dog, Noxus Hopeful for 2 via Legion), points lead by turn 4-5.
2. Each conquest: legend (exhaust) reveals the top 2 -> play one (Undertitan reveals add [2]; Breacher gives it Accelerate,
   so a revealed unit can attack the same turn) -> chained conquests.
3. **Undertitan** (6+[A], 5 Might, other units +2 this turn) as the alpha-strike turn; **Rengar, Pouncing** (Reaction, can be
   played to a battlefield you are attacking, Assault 2) as a combat trick; **Ferrous Forerunner** sticky body.
4. Removal: Falling Star (3+3), Shimmering Swimmer (sacrifice a token/Dredger -> 2 damage), Bilgewater Tracker (1 to two
   units), Cull the Weak (sacrifice a Recruit/Bird; they lose their only/best unit), Imperial Decree (damage = death this turn).

## Mulligan

- Keep: 2-cost units (Inferna, Carrion Dredger, Trifarian Captain), Faithful Manufactor, Noxus Hopeful with a cheap card,
  Rek'Sai, Breacher, one Falling Star / Cull the Weak, Concert Poster.
- Send back: second Undertitan, Imperial Decree, Ferrous Forerunner, hands with no 2-3 cost unit.

## Turn-by-turn

- **T1-T2:** 2-drops to the battlefield (Hunters' Circle: first unit there costs 1 less); Concert Poster at a battlefield you
  will hold (Recruit for [1]).
- **T3-T4:** Breacher (Accelerate if she attacks now), Manufactor; attack every turn the attack wins; legend on each conquest
  (keep 2-3 energy after the conquest to pay for the revealed card).
- **T5+:** Undertitan the turn the team attacks (+2 to all others: conquer both battlefields); Rengar as a reaction into an
  attack; Cull the Weak when the opponent has 1-2 units and we have a token.
- Points: Rek'Sai must close before control decks stabilise — prefer conquering over developing when both are possible.

## Combos & sequencing

- Play units first, then pump (Cleave / Blood Rush only while attacking).
- Attack -> conquer -> legend reveal -> revealed unit (Accelerate via Breacher) -> attack the second battlefield.
- Shimmering Swimmer: sacrifice a Recruit / Bird / Dredger (Dredger leaves a Bird) to deal 2.
- Noxus Hopeful after any card (Legion, 2 energy).

## Hiding

- No Hidden cards. Inferna / Rengar / Grim Apothecary are Reactions (Ambush): keep [2]-[3] open on the opponent's turn
  when holding them and a battlefield is contested.

## Matchups

- **Azir:** race; Falling Star / Tracker on equipped Soldiers; Cull the Weak when Azir has one big unit; don't attack into
  open Guards! mana with a lone unit.
- **Kai'Sa:** unfavoured (removal-heavy); spread threats, keep units at base out of Hextech Ray range when not attacking.
- **Vex:** her stun hits our played units (incl. revealed ones) — attack before Vex reaches a battlefield / kill her.
- **Sett / Evelynn / Irelia:** race and remove the champion.

## Results (PILOT-A, 2026-11-26)

Plan: `src/ai/plans/reksai.ts` — mulligan for 2-drops; priors (Hopeful after another card, Undertitan with 2+ ready units,
Cull the Weak only with a token to sacrifice and 1-2 enemy units, legend reveal always); combos Undertitan -> everyone
attacks, Cull the Weak -> attack, cheap card -> Hopeful; reveal pick (units / Undertitan first); sacrifice targeting
(Recruit / Bird / Dredger first); damage targeting shared with Kai'Sa; Inferna / Rengar / Apothecary as showdown Reactions.

- Puzzles: tests/ai/plans/reksai.test.ts 9/9 (conquer -> legend reveal -> play one, Dredger -> Hopeful, Undertitan ->
  conquer both battlefields, Cull the Weak sacrificing a Recruit, Swimmer sacrificing a Recruit, Falling Star 3+3, lethal
  conquer, no Accelerate, Inferna ambush to save a battlefield).
- Mechanic metrics (40 games vs the field): units deployed ~8/game (Manufactor 1.2, Rek'Sai 1.0, Hopeful 1.0, Tracker 0.95,
  Swimmer 0.9, Rengar 0.85, Inferna 0.8, Undertitan 0.7), Cull the Weak 0.75, Recruits 2.45; runes 5.8 / 7.6 / 8.9.
- Strength vs the legacy AI (mirror): 62-38 over 100 games (62%) — **criterion 4 NOT met** (CI ~52-71). A/B: `--noplans`
  13-7 where the plan went 11-9 on the same seed, a "deploy" nudge 34-26 — the plan is not the lever; the new core's edge
  over the 1-ply legacy search is small for this straightforward aggro deck. Request filed (docs/ai-requests.md).
- Pilot winrate vs the field: 21-19 (53%); strong vs Kennen / Ezreal / Azir, weak vs Kai'Sa (1/8) — matches riftbound.gg
  ("struggles against Kai'sa (43%)").

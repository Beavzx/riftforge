# AI pilot: Azir, Emperor of the Sands (PILOT-A)

Lists: `01-azir.json` (misseri90, 1st Bologna 9-1-0), `08-azir.json` (CC Yuston, 8th), `10-azir.json` (rotoreto, 10th),
`14-azir.json` (ENNE97, 14th). All Calm/Order, 7 Calm / 5 Order runes, 15 Equipment, 3 Guards!, 3 Arise!, 1 Azir, Sovereign.
Plan code: `src/ai/plans/azir.ts`; puzzles: `tests/ai/plans/azir.test.ts`.

## Sources

- RiftMana, "Azir Emperor of the Sands Deck Guide": <https://riftmana.com/?p=23143> — one Equipment per turn for the legend,
  lead with 1-cost Equipment, B.F. Sword later, Arise! is the strongest spell with 3+ Equipment, Guards! hidden to defend,
  Hidden Blade hidden for the discount.
- Hextech Analytics, Azir legend guide: <https://hextechanalytics.com/legends/azir> — "several separate threats",
  Equipment survives its Soldier so the next token picks it up, Sovereign's attack gathers exhausted tokens, "Weaponmaster
  ... the Equip cost is still paid in full", Hall of Legends default battlefield, count Equipment before Arise!, hold Hidden
  Blade / Back Off for the unit that would stop the attack; weakness: "Power is tight. Spending all runes on one large Soldier
  can leave the board and next turn short", Sovereign removed before his trigger resolves stops the push.
- SuperTCG, "Comment jouer Azir" (FR): <https://supertcg.club/actualites/riftbound-comment-jouer-azir-dans-spiritforged/> —
  turn-1 line going first (1-cost Equipment + legend = a 3-Might Soldier), going second keep [1] for Defy or a bigger gear,
  B.F. Sword's 5-Might breakpoint vs burn, Doran's Shield Tank best on Azir, Arise! only with 3+ gear, Guards! revealed in
  the opponent's attack + Weaponmaster picking up a heavy gear = surprise 5-Might blocker; Irelia: Hidden Blade on Irelia,
  Ezreal: Defy his draw spells.
- Tournament: Demacia League Bologna (post-ban), Azir 1st / 8th / 10th / 14th of the published top 20:
  <https://riftdecks.com/riftbound-tournaments/demacia-league-bologna-post-ban-meta-tournament-decks-19507> (docs/meta-decks.md).
- Card behaviour in this engine: tests/cards/meta-audit/azir.test.ts (every card), docs/keywords.md (Weaponmaster CR 821:
  pays the Equip cost minus one [A]; Equip [C] has no [A], so **Weaponmaster pays [C] in full** here — two guides say "free",
  the rules text and Hextech say paid in full; the engine follows the rules).

## Resource model (why this deck is hard for a generic AI)

Every **power** cost recycles a rune: Equip [C], Weaponmaster's attach [C], Guards!'s ready [C], Accelerate [1][C], hiding [A],
Defy / Hidden Blade / Arise! [A]-ish power. A recycled rune goes to the bottom of the rune deck: the deck channels 2 per turn
regardless, so each early recycle permanently delays the rune curve by one until the rune deck is empty (12 runes), after
which a recycle costs nothing long-term. Energy (exhausting runes) is free. Consequences:
- Early (rune deck not empty): pay [C] only when it buys a real board effect *this turn* (a Soldier that will attack/defend
  with the Equipment, Tank on a defender, Brutalizer's +3 on an attacker, B.F. Sword). Never pay [C] to move an Equipment
  from one unit to another at base, never Weaponmaster-take an Equipment off a unit that is already using it.
- Late (rune deck empty or nearly): recycling is nearly free; equip everything.
- Target: runes in play by own turn 8 ~= 8-10 (vs 3-7 seen with the old AI).

## Win conditions

1. A wide board of **Equipped Sand Soldiers** (2 Might + Equipment) contesting both battlefields: "several separate threats".
2. **Azir, Sovereign** attacking: when he attacks, all token units (base or elsewhere, exhausted too) may join -> one big
   conquer, often a second conquer (Hall of Legends readies the legend for another Soldier).
3. **Arise!** with 3+ Equipment: a Soldier per Equipment, 2 of them ready; each Soldier's Weaponmaster can pick up an
   *unattached* Equipment. Late-game board refill.

## Key cards

- Legend: [1],[T] Sand Soldier (base) after an Equipment was played this turn; Soldiers have Weaponmaster.
- 1-cost Equipment: Doran's Shield (+1, Tank), Soul Sword (+1, +1 more at Level 3), Eye of the Herald (+0, Recruit when its
  bearer moves). 2-cost: Brutalizer (+1, +2 more the turn it is attached), Hand Hammer (+1, +2 with exactly one other friendly
  unit at its battlefield). 4-cost: B.F. Sword (+3).
- Guards! (3, Hidden): Sand Soldier at base or a battlefield you control, may pay [C] to ready it; from facedown it is free
  (energy) and appears at that battlefield as a Reaction = defensive trick.
- Arise! (6 + power): see above. Azir, Sovereign (4, Accelerate [1][C]).
- Interaction: Defy (counter <=4-cost, <=1 power spells), Hidden Blade (kill a unit at a battlefield, its controller draws 2;
  Hidden), Back Off (stun; draws from hand; Hidden), Discipline / Battle Preparations (+2, Reaction), Deathgrip (sacrifice a
  Soldier, Azir gets its Might, draw), Kennen / Vi (stun), Orianna (4-Might Shield, needs a gear there to deal damage).

## Mulligan (keep / send back up to 2)

- Keep: 1-cost Equipment (Doran's Shield first, Soul Sword, Eye of the Herald) — the turn-1/2 legend line needs one; Defy;
  Discipline; one Guards!; Brutalizer / Hand Hammer if a 1-drop is also kept.
- Send back: a second/third Arise!, B.F. Sword without a cheap Equipment, Vi, extra Back Off / Hidden Blade when no Equipment
  is in hand, Azir only if the hand has no Equipment at all (he is fine as a turn-4 play with Equipment).
- A hand with zero Equipment sends back the two most expensive non-Equipment cards.

## Turn-by-turn priorities

- **T1 first (2 runes):** 1-cost Equipment, legend for a Soldier (Weaponmaster may attach it: Doran's Shield on a Soldier
  is a 3-Might Tank). Going second (3 runes): same, or Equipment + legend + keep [1] for Defy.
- **T2-T3:** exactly one Equipment, then the legend (Soldier), then move to contest/conquer a battlefield. Hide Guards! (or
  Hidden Blade / Back Off) at a battlefield you control when you have spare power and nothing better: next turn it is a
  free Reaction. Keep 1-2 energy open for Defy / Discipline on the opponent's turn when holding them.
- **T4-T5:** Azir, Sovereign (Accelerate only if he attacks this turn and conquers something), still one Equipment + legend per
  turn; Sovereign attacks pulling every Soldier in for the decisive conquer. Hall of Legends conquer -> pay [1] to ready the
  legend -> another Soldier (needs [1] more and an Equipment played this turn).
- **T6+:** Arise! when Equipment controlled >= 3 (best with unattached Equipment for Weaponmaster pickups); B.F. Sword on the
  attacker. Count lethal: points + battlefields you can conquer/hold this turn.
- **Never:** play 2+ Equipment in one turn when one triggers the legend and the rest could wait (unless the Might is needed
  now, e.g. lethal or to win a contested fight), spend [C] on Weaponmaster moving an attached Equipment, Accelerate Azir
  without attacking.

## Combos & sequencing

1. Equipment -> legend [1],[T] -> Weaponmaster attaches that Equipment (or a better unattached one) -> move Soldiers.
2. Azir moves to an enemy-held battlefield (attack) -> "move any number of your token units here" -> choose all Soldiers
   that help win the fight (exhausted ones too).
3. Arise! after playing an Equipment this turn with legend still ready: the legend adds one more Soldier.
4. Hidden Guards! at a battlefield the opponent attacks: Reaction, Soldier appears there, Weaponmaster grabs a heavy
   unattached Equipment (surprise blocker).
5. Deathgrip a Soldier (esp. one with Eye/Recruit already used) onto Azir in a fight he would otherwise lose; draws 1.

## When to hide what

- Guards!: at a battlefield you control (ideally the one the opponent will attack) when you have 1 spare power; it costs
  [A] now but 0 energy later. Don't hide it when the opponent can conquer that battlefield anyway (hidden card is lost).
- Hidden Blade / Back Off: hide when you hold a battlefield the opponent will contest; play from hand on your own turn to
  clear a blocker before Azir attacks.
- Facedown cards must be counted as value (they are cards + a free Reaction).

## Matchups (field: Vex x2, Evelynn x2, Rek'Sai x3, Kai'Sa x5, Irelia x2, Kennen, Ezreal, Sett, Azir x3 mirror)

- **Vex (Calm/Chaos control, Vex, Apathetic stuns every unit an opponent plays while she is at a battlefield, Deflect):**
  Soldiers made while Vex is at a battlefield are stunned and can't move this turn — make Soldiers anyway for defence,
  kill/stun Vex (Hidden Blade pays [A] for Deflect; Back Off) before going wide. Defy their Switcheroo / Gust.
- **Rek'Sai (Fury/Order go-wide aggro, Undertitan, Inferna):** race on board; Doran's Shield Tank Soldiers defend; Guards!
  as surprise blockers; Arise! is the swing. Hidden Blade the Undertitan / Rek'Sai.
- **Kai'Sa (Fury/Mind spells: Hextech Ray, Falling Star, Stupefy, Time Warp):** Defy is premium (most of their spells cost
  <= 4 with <= 1 power); B.F. Sword puts Soldiers out of burn range; don't overextend 2-Might Soldiers into Falling Star.
- **Evelynn (Body/Chaos hidden tricks):** contest early; hidden cards punish small attacks — attack with Sovereign + tokens
  in one wave.
- **Irelia:** Hidden Blade / Back Off on Irelia (Deflect: [A] extra); wide Soldiers saturate her attack lines.
- **Sett (Body/Order buffs, Sett Tank):** Hidden Blade Sett; go wide on the other battlefield.
- **Kennen / Ezreal:** Defy their key spells (Ezreal's draw), pressure early.
- **Mirror:** Equipment count and Arise! timing decide; Hidden Blade their Sovereign when he attacks.

## Results (PILOT-A, 2026-11-26)

Plan: `src/ai/plans/azir.ts` — mulligan for Equipment; priors (exactly one Equipment as the legend trigger, legend +8,
Arise! only with 3+ Equipment, Back Off never on a unit at base); combos (Equipment -> legend Soldier; + Azir attack pulling
every token; Arise!; Azir with / without Accelerate); Weaponmaster targeting (never an attached Equipment, never one already
claimed by another Weaponmaster trigger on the chain — fixed B.F. Sword being passed along four Arise! Soldiers for 4 [C]);
rune-scarcity price on every [C]/[A] spend (~0.9 x runeDeck/2 rune-turns: watched games had 3 runes on own turn 7);
hide value / `hide.defense` for Guards! / Hidden Blade / Back Off; Hidden Blade only on 4+ Might or champion targets (it
draws them 2); extra Equipment in hand valued below Equipment on the board (watched: two Eye of the Herald held all game
with 2-4 runes unused each turn — this change doubled the field winrate in a controlled A/B, 7/44 -> 14/44).

- Puzzles: tests/ai/plans/azir.test.ts 10/10 (T1 line, Equipment -> legend -> Azir attack with Soldiers, Weaponmaster pickup
  of the free Equipment, hide Guards!, hidden Guards! as a Reaction, lethal conquer, Arise! with free Equipment, no [C]
  churn, Defy on Void Seeker, no Accelerate without an attack).
- Mechanic metrics (20 games vs the field, both seats, final plan): legend activations 4.3/game, Sand Soldiers made 7.1,
  Equipment played 4.9, attaches 6.4 (Weaponmaster + Equip), Guards! 0.6 from hand + 0.35 from facedown, hides 0.4, Arise! 0.6,
  Defy 0.45, runes in play at own turn 4/6/8 = 5.9 / 7.8 / 7.0 (before the rune fix: 5.3 / 5.7 / 6.4, as low as 3 on turn 7).
- Strength vs the old (legacy) AI, same deck both sides, both seats: 71-13 over 84 games (84.5%) — criterion 4 met.
- Pilot winrate vs the field (new AI both sides, all 4 lists, random opponents): 21/64 = 33% with the final plan
  (16% for the previous version on the same frozen snapshot/seeds). Before PILOT-A: ~7% (docs/meta-sim.md).
- By opponent (small samples, all plan versions after the rune fix): Kai'Sa 2/16 (ai-bench) + 1/12 (metrics), Sett 0/6 (+0/4
  in the Sett metrics), Vex 0/6, Rek'Sai 2/6, Irelia / Kennen / Ezreal / Evelynn 1-2 of 6 each.

### Why Azir is still ~33% (watched games, tools: /tmp metrics runner with action logs)

1. **Kai'Sa (5 of 20 lists) is ~78% vs every non-Kai'Sa deck** under this AI (06-kai-sa metrics: 25/32 excluding mirrors;
   ai-bench 20-4). Its cheap targeted removal (Hextech Ray 1+legend, Void Seeker, Bellows Breath, Falling Star 3+3,
   Singularity, Sky Splitter) kills every 2-3 Might Sand Soldier one-for-one and Azir, Sovereign the turn he lands (Ray +
   Sky Splitter at Void Gate = 10 damage). Search-based removal targeting is easy for the AI; Azir's counterplay (Defy
   their <=[4]/[A] spells, keep units at base out of "at a battlefield" removal, strike in one Sovereign wave, Hidden Blade
   the Watcher) needs read-the-opponent play the planner does only partially. Azir vs Kai'Sa: 3/28.
2. **Bigger bodies:** Sett (buffed Fiora/Rengar 5-6, Kingpin 7+) and Rek'Sai (Undertitan team +2) out-size 2-Might
   Soldiers; Azir wins only when the Soldiers are equipped and attack together with Sovereign, which the turn planner finds
   (puzzles) but the opponents' instant-speed tricks (Rengar Ambush, Call to Glory, Punch First) punish.
3. **Weaponmaster pays [C] in full here** (CR 821.1.c.3, docs/rules-decisions.md #35): two of the three guides assume
   "free"; under the verified rule every Soldier that picks up an Equipment recycles a rune, so the deck is resource-tight.
4. Remaining AI-side weaknesses: no opponent-deck-specific play (vs Kai'Sa), the planner still conquers into random-reveal
   lines and values hand cards over held runes inconsistently; requests filed in docs/ai-requests.md (PILOT-A).

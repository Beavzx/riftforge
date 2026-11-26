# AI pilot: Irelia, Blade Dancer (PILOT-B)

Lists: `09-irelia.json` (ECL Diabloz89, 9th Bologna 7-2-0; 5 Calm / 7 Chaos) and `20-irelia.json` (DonCapucino, 20th
6-2-0; 6 Calm / 6 Chaos). Champion: Irelia, Fervent. Battlefields: Abandoned Hall, Sunken Temple, Targon's Peak (both).
09 = Astral Heron + Reckless Innovator + Edge of Night + Gust/Switcheroo/Rebuke tempo; 20 = En Garde, Charm, Ride the Wind,
Find Your Center, Flash, Twilight Shroud (more spells, no Heron).
Plan code: `src/ai/plans/irelia.ts`; puzzles: `tests/ai/plans/irelia.test.ts`.

## Sources

- RiftMana, "Irelia Blade Dancer Deck Guide": <https://riftmana.com/?p=21926> — "Irelia Fervent is the main win condition in
  this deck", 4 Might, +1 whenever chosen or readied; the many low-cost spells exist to protect her; legend: exhaust + pay
  1 power to ready a chosen friendly unit, pay [1] to ready the legend after a conquer; "Mostly offensive, such as attacking
  and retreating to base late game", sometimes worth it on defence for the +1; "recycling Runes is costly early";
  "Defiant Dance is our strongest combat trick"; Discipline "the card draw is what makes it valuable"; Guardian Angel often
  on Irelia; Tideturner swap rescues exhausted units; Sunken Temple game-1 battlefield; "Keep Runes Ready on defensive
  turns" (tapping out signals no defence); "Understand when to give up."
- Anime Alley, "Irelia, Blade Dancer Deck Guide": <https://animealley.ca/blogs/the-synergy-lab/irelia-blade-dancer-riftbound-deck-guide>
  — land the Deflect champion, protect it with reactions: "removing a Deflect champion becomes a three-card problem";
  Defy: "Save this for spells that actually win the game"; Hidden cards flipped later for 0 = tempo swings; weak to sweepers.
- riftbound.gg tier lists: week 2 <https://riftbound.gg/riftbound-meta-tier-list-best-decks-for-radiance-week-2> (Irelia
  Tier 2, 44%, high ceiling: "when the draws align, she moves all over the board") and post-ban
  <https://riftbound.gg/radiance-post-ban-metagame-decks> (44%; problem matchups Rek'Sai, Rengar, LeBlanc, Kha'Zix, Azir,
  Lillia; fine vs Kai'Sa).
- Tournament: Bologna post-ban, Irelia 9th and 20th.

## Engine notes

- Blade Dancer: "When you choose a friendly unit, you may exhaust me and pay [A] to ready it" — triggers on *any* choice of a
  friendly unit by our spells/abilities (Discipline, Defiant Dance, En Garde, Ride the Wind, Tideturner's swap, Equip?
  — equip chooses the unit: yes if it is an ability choosing it). [A] = one power (a rune recycle unless paid by Gold).
  "When you conquer, you may pay [1] to ready me": energy only, so after every conquer re-arm the legend for [1].
- Irelia, Fervent: +1 Might this turn whenever chosen or readied, so a spell on her = +1 (+2 with the legend's ready).

## Win condition

Irelia (Deflect, grows with every spell) plus a couple of cheap holders contest both battlefields; the legend readies an
attacker after a conquer so it can **conquer twice** (attack battlefield A, conquer, pay [1] to ready the legend, cast a
cheap spell on the attacker -> legend readies it -> move it to battlefield B / back to base to defend). Defy / Not So Fast
/ Defiant Dance protect Irelia. Card flow: Discipline, Scuttle Crab, The Good Stuff, Find Your Center (20), Sunken Temple.

## Key cards

| Card | Role |
|---|---|
| Irelia, Fervent (5) | Main threat. Play T4-5 when we can keep [A]+1 open for Defy / Defiant Dance soon after. |
| Scuttle Crab (2) | Cantrip; 0-Might holder. |
| Tideturner (2, Hidden) | Swap with a friendly unit at another location: save an exhausted / threatened unit or bring a ready one in. Chooses a friendly unit -> legend can ready it. |
| Reckless Innovator (3) | Accelerate body; Gold or draw on exhaust. |
| Vex, Apathetic (4) | Stun lock on their new units. |
| Astral Heron (7, 09) | Big holder + discount. |
| Guardian Angel (2, Equip [C]) | +1; protects the bearer (Irelia). |
| Boots of Swiftness / Edge of Night | +2 equipment (Edge hidden: surprise attach). |
| Defiant Dance (1+1) | +2 / -2 Reaction: best combat trick (and a choice of a friendly unit = legend ready). |
| Discipline (2) | +2 draw Reaction. |
| En Garde (1, 20) | +1/+2 Reaction. |
| Defy / Not So Fast | Protect Irelia from removal. |
| Gust, Rebuke, Switcheroo, Charm, Star-Crossed, Flash, Ride the Wind | Tempo, movement (Ride the Wind = move + ready: a second attack). |
| Find Your Center (20) | Draw + ramp rune; cheaper when an opponent is within 3 points of winning. |

## Mulligan

Keep: Scuttle Crab, Tideturner, Reckless Innovator, Guardian Angel, Vex, one Defy / Defiant Dance / Discipline, Find Your
Center (20). Send back first: Astral Heron, Star-Crossed, Rebuke, The Good Stuff, a 3rd reaction, Boots.
Irelia herself starts in the champion zone.

## Turn priorities

1. T1-3: cheap holders to battlefields (Scuttle Crab, Tideturner face up, Innovator), conquer an empty battlefield.
2. T4-5: Irelia (with 1-2 runes open if possible), Guardian Angel on her.
3. Attacks: attack with Irelia where we win; after a conquer pay [1] to ready the legend; a cheap spell on her (Discipline
   for value) -> legend readies her -> second attack or back to defend.
4. Early turns: don't pay [A] for the legend's ready unless it scores a point or saves Irelia (rune recycle is expensive
   before the rune deck runs out).
5. Opponent's turn: keep Defy / Not So Fast up for removal on Irelia; Defiant Dance / Discipline to win their attack.

## Matchups

- Rek'Sai / Azir (wide boards, bad per riftbound.gg): Vex stun, Gust/Switcheroo; trade Irelia carefully.
- Kai'Sa / Ezreal: Defy their removal (Hextech Ray, Stupefy, Wages of Pain cost <=1 power); Not So Fast for targeted ones.
- Vex / Evelynn: Deflect makes their bounce cost more; keep Defy for Switcheroo.
- Kennen: Defy Lightning Rush is low value; hold for his tricks.

## AI implementation (src/ai/plans/irelia.ts)

- Mulligan table (keep Crab / Tideturner / Innovator / Guardian Angel / one reaction; ship Heron / Rebuke / Star-Crossed).
- Blade Dancer: "pay [1] to ready Blade Dancer" after a conquer = yes; "pay [A] to ready the chosen unit" is valued by
  `readyWorth`: the unit (target of our top chain item) is exhausted on our turn and a battlefield we don't control is
  still open (+3), or Irelia in a fight (+1.5), minus the rune (1.8 early, 0.4 once the rune deck is empty).
- Priors: Irelia with 6+ runes (+3), Guardian Angel when Irelia is out; pumps outside fights -6 except the legend-ready
  line (Discipline / En Garde / Defiant Dance on an exhausted unit with the legend ready).
- Targets: Equipment on Irelia (+5); pumps on units in the fight (+1.5 more on Irelia); harmful effects never on own units.
- Responses: Defy / Not So Fast / Abandon only vs threats (`chainThreat`; Irelia, Heron, Vex as key units).
- Eval: Irelia on board +2 + 0.8/attachment, Guardian Angel attached +3 on Irelia (it saves her once), `ctl` 2.

## Competence puzzles (tests/ai/plans/irelia.test.ts) — 8, all passing

- Irelia: after a conquer, pay [1] to ready Blade Dancer
- Irelia: Not So Fast counters Falling Star aimed at Irelia
- Irelia: Guardian Angel is equipped on Irelia, not on Scuttle Crab
- Irelia: Defiant Dance wins the defence of the held battlefield
- Irelia: at 7 points, Irelia attacks the 5-Might holder with Discipline for the winning conquer
- Irelia: Defy is saved, not spent on the opponent's cantrip Stupefy
- Irelia T5+: Irelia, Fervent comes down from the champion zone
- Irelia mulligan: keep the cheap holders, send back Astral Heron and Rebuke

## Measured (2026-11-26, PILOT-B; snapshot runs, tools: /tmp bench = new SearchAI with plans vs legacy AI)

Strength = mirror match, new AI + plan vs the old (legacy) AI on the same list, both seats alternating. Field = new AI on
this list vs the legacy AI on a random Bologna list (pilot winrate vs the old bot, not vs new-AI opponents). 95% Wilson CIs. Mirror numbers pool 2 chunks of
<= 7.5 min (seeds 3-5); the earlier chunk of Vex / Evelynn / Irelia ran one plan revision before the final one (targeting
fixes only). Raw per-game JSON: /tmp/pilotb/{m1,m2,m3,f2,r1} (bench script /tmp/pilotb/bench.ts, run inside a snapshot).

| List | Strength (mirror vs legacy) | seat 0 / seat 1 | Field vs legacy (final plan) | Field vs legacy (first plan) |
|---|---|---|---|---|
| 09-irelia | 61/90 = **68%** [58-77] | 67% / 68% | 22/40 = 55% [40-69] | 25/40 = 62% |
| 20-irelia | 64/91 = **70%** [60-79] | 74% / 67% | 22/40 = 55% [40-69] | 27/40 = 68% |

Mechanic metrics per game (mirror games, tested side):

| List | hides | facedown plays own turn / opp turn | legend: activations / optional uses / resolves | empowers | plays on opp turn | runes by own turn 8 | avg turns |
|---|---|---|---|---|---|---|---|
| 09-irelia | 1.3 | 0.4 / 0.3 | 0.0 / 2.8 / 2.8 | 0.0 | 1.6 | 9.0 | 14.6 |
| 20-irelia | 0.3 | 0.2 / 0.0 | 0.0 / 3.3 / 3.3 | 0.0 | 3.1 | 8.6 | 14.1 |

Reading. Blade Dancer used ~2.8-3.3 times per game (after-conquer re-arm + ready on the chosen unit), reactions on the opponent's turn 1.6-3.1/game, runes ~9 by turn 8 (lower than the hold decks: the [A] readies cost runes, as the guides warn). **Strength is borderline: 68% (09) and 70% (20), CIs 58-79** — 20-irelia meets the criterion on the point estimate, 09-irelia just misses. A paired core-only A/B (43 games) gave 25 vs 27 wins (plan +2, noise level). Field vs legacy 55%: weakest matchups Kai'Sa / Rek'Sai go-wide (also the real-world problem matchups per riftbound.gg). Sanity vs reality: 9th and 20th in Bologna, riftbound.gg 44% — a mid deck, consistent.

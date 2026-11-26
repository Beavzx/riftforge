# Rulings (RULINGS agent, 2026-11-25)

Verdicts for every item in docs/rulings-queue.md. Order of authority: card text (incl. reminder text) > official FAQs > Core Rules 1.5 >
tournament rules. CR numbers are CR 1.5.

**Round 1 totals: 32 items — CONFIRMED 14, FIXED 12, NEEDS-ENGINE 5, AMBIGUOUS 1.**

## Sources

| Key | Source |
|---|---|
| CR | Core Rules 1.5, mirrors https://riftboundfaq.com/rules-documents/core-rules/1.5 and https://riftlens.pages.dev/rules/ (section pages) |
| RAD-FAQ | Radiance Rules FAQ — https://playriftbound.com/en-us/news/organizedplay/radiance-rules-faq-and-clarifications |
| VEN-FAQ | Vendetta Rules FAQ — https://playriftbound.com/en-us/news/rules-and-releases/vendetta-rules-faq-and-clarifications/ |
| UNL-FAQ | Unleashed Rules FAQ — https://playriftbound.com/en-us/news/rules-and-releases/unleashed-rules-faq-and-clarifications/ |
| SFD-FAQ | Spiritforged FAQ — https://playriftbound.com/en-us/news/rules-and-releases/riftbound-spiritforged-faq/ |
| OGN-FAQ | Origins FAQ — https://playriftbound.com/en-us/news/rules-and-releases/riftbound-origins-faq/ (answers are collapsed on the official page; the answers were read from the "Related FAQ" blocks of riftlens.pages.dev rule pages, e.g. /rules/ready/ and /rules/triggered-abilities/) |

## The general timing rule (engine-level item 1)

What is chosen **when a spell/ability is played or a trigger goes on the chain** (Make Choices, CR 355; triggers CR 403.2 "Make all
choices required for this ability, such as targets, modes, or other relevant decisions"):
- optional additional costs (355.1.a); a unit's location (355.2);
- **bulleted modes** (355.3 "For Spells and Abilities with a bulleted list of modes to choose from, make the appropriate choices now");
- **move destinations** (355.4 "choose a valid Location as the Move Destination for each Move that will be performed"; 355.4.a valid =
  other than the current location and allowed there);
- **specific game objects** — targets — even without the word "choose" (355.5: "Stun a unit at a battlefield" is a choice). Runes are
  board objects and can be targets (OGN-FAQ, Sona: "The same is true of triggered abilities with multiple targets");
- split-damage recipients (355.14.a-c), X;
- a "you may" at the start of a trigger, and a cost at its start (383.3.a-b).

What is chosen **on resolution** (355.18: choices "not outlined in this section"): non-bulleted "A or B" choices, a later "you may",
costs inside the instructions (RAD-FAQ Riven: the buff is spent on resolution because "Choose one…" is the first part), choices made by
other players, choices among looked-at / revealed cards, the split division (355.14.e), and choices of reflexive items (they get their
own finalization, CR 387-389; VEN-FAQ Hwei).

Audit result: the engine has no modes on triggered abilities and no move-destination choice; the affected cards are listed in
docs/dsl-requests.md "From RULINGS" R-1 and R-2. Battlefield-only destinations can be picked now with `T.battlefield(…, {pick:true})`.

## B1

| Card | Question | Verdict | Source | Change |
|---|---|---|---|---|
| unl-038 Skyward Strike | "Move an enemy unit": caster picks any other location; Level 6 stun optional | NEEDS-ENGINE | CR 355.4, 355.4.a, 451.1-451.2 | The destination set is right (base or any battlefield other than its location, not one with two other players' units). But the destination must be chosen when the spell is played (355.4), not on resolution → R-2. Note: with 6+ XP the stun target is mandatory if one exists (355.17); `min: 0` lets the caster skip it — harmless, left as is. |
| sfd-039 Royal Entourage | ready vs exhaust chosen on resolution | CONFIRMED | CR 355.3 (only bulleted lists are modes), 355.5 (the legend is chosen on the chain), 355.18 | none |
| ven-035 Sanction / ven-099 Tornado Warrior | "Disempower it at end of turn" even if it was already Empowered | CONFIRMED | Card text (the delayed instruction isn't conditional); reminder text "I become Empowered if I'm not already"; VEN-FAQ Kayle (disempowering removes one status) | none |
| unl-095 Grim Resolve | "it wins a combat" | FIXED | CR 468.3.a ("A Player has won a combat if they received either the attacker or defender designation and are the only Player that has units remaining at this battlefield"), 468.3.c ("Units at this battlefield inherit the same combat result as their controllers"); SFD-FAQ Draven, Audacious | The unit must also still be at that battlefield. Test: tests/cards/B1/rulings.test.ts |
| ven-143 Master of Shadows | A Flow spell banishing itself counts as "you banish" | CONFIRMED (reasoned) | CR 829.1.b-829.1.b.1 (Flow's banish is the spell's own delayed replacement effect), 412.1 / 412.5 (the controller of the spell performs and is responsible for it) | none |
| ven-155 Heart of the Tempest | Playing from the Champion Zone counts as "anywhere other than your hand" | FIXED | CR 420.1.a (hand and Champion Zone are different zones); OGN-FAQ (Legion): "Tokens are not cards" | Champion Zone / facedown / trash plays count (confirmed); token plays no longer empower it. Test: B1/rulings.test.ts |
| ven-086 Gangplank, Naval | "a spell or ability that chooses me" ≈ the resolving item targeted me | CONFIRMED | VEN-FAQ Gangplank: Blast Cone's stun "is a triggered ability that doesn't choose Gangplank" so it isn't replaced; Back Off on a stunned Gangplank does no stun → no +3; Stupefy on 1 [M] gives -0 → no +3 | Now also uses the engine's `chosen` flag and replaces the "-[M]" case (giveMight with a negative amount → +3 this turn). The todo test in tests/cards/B1/empower.test.ts is enabled. |
| unl-164 Safety Inspector | Inspector itself can be chosen; turn order; kills simultaneous | CONFIRMED | Card text ("each player must kill one of their units" — Inspector is on the board); CR 412.1 example (Cull the Weak: each player kills one of their own); 355.10 (another player's choice / "must" isn't a target) | none |
| sfd-079 Bard, Mercurial | "open battlefield" = no units and no controller | FIXED | CR 170.11 (Open = unoccupied and uncontrolled) — confirmed; CR 355.4, 355.5, 403.2 — timing | The battlefield (non-targeting pick) and "any number of your units" (targets) are now chosen as the play trigger goes on the chain; if the battlefield is no longer open on resolution the move doesn't happen. Test: tests/cards/B1/costs.test.ts (updated) |
| unl-140 Conscription | Declining the XP cost with only large enemies → resolves doing nothing | FIXED | CR 355.16 (no choices that deterministically result in illegal choices), 355.17 (mandatory requirements must be followed if possible), 358.1 / 358.5; SFD-FAQ Janna, Savior (errata to "up to one" so it works without targets) | With 5+ XP and no enemy unit of 3 Might or less at a battlefield, the 5 XP is spent without asking (declining would make the play illegal). Test: B1/rulings.test.ts |
| unl-192 Alpha Strike | Recipients may outnumber damage; extras get 0 | FIXED | CR 355.14.c (targets can't exceed the initial damage), 355.14.f-g (each target gets ≥ 1), 355.14.h-h.1 (at resolution, the damage's controller chooses which targets cease to be targets) | Recipients are capped at the unit's Might when played; on resolution, if Might fell below the number of targets, the controller picks which stay; each gets ≥ 1. Test: B1/rulings.test.ts. Engine-wide `ctx.split` gap → R-4. |

## B3

| Card | Question | Verdict | Source | Change |
|---|---|---|---|---|
| sfd-171 Renata Glasc, Industrialist | "Your tokens enter ready" overrides Gold played "exhausted" | AMBIGUOUS | CR 184.1 (the creating effect may state ready/exhausted), 370.1 (replacement effects modify the event as generated), 375 (a replacement inherits modifications made by the generating effect). No official ruling found. | none. **Best call: Renata wins** — "enter ready" is a replacement of the entering event (like Accelerate's delayed replacement, UNL-FAQ Atakhan) and applies on top of the event the Gold instruction generates, "exhausted" included. The 375 reading (the stipulation survives) is possible but less natural. |
| rad-132 Heimerdinger, Academy Instructor | Mech keeps the original token's ready/exhausted; not offered if already a Mech | CONFIRMED | CR 375 ("the Replacement Effect will inherit those modifications"); 370.2 (applied once per event) | none (replacing a Mech with an identical Mech changes nothing) |
| Recruit the Vanguard, Encore, Vanguard Armory… | Each token's location chosen separately | CONFIRMED | Card reminder text (Vanguard Armory: "(You may play them to different locations.)"; Recruit the Vanguard: "(They can be played to your base or to battlefields you control.)"); OGN-FAQ (pending items: each played token is its own play) | none |
| ven-109 Illaoi | "when I score" = when you conquer or hold a battlefield I'm at | CONFIRMED | CR 470.3 ("score" without points = the Scoring process), 471.1-471.2 (Conquer / Hold), 473.2 (score abilities trigger at the battlefield that scored) | none |
| rad-096 Satchel Charge | Move destination on resolution vs CR 355.4 | NEEDS-ENGINE | CR 355.4 — the destination is chosen when it is played | → R-2. The Bomb's battlefield is a token play's own choice and is made during resolution (correct). |
| rad-152 Encore | "draw 1" from the looked-at cards: no draw event | FIXED | Card text says "draw 1" (a Draw game action, not a move to hand); B7-10 | The chosen card is drawn with `drawSpecific` (draw event + log). Test: tests/cards/B3/radiance.test.ts |
| ven-068 Jayce, Brilliant Inventor | "ready something": any exhausted unit/gear/rune/legend incl. enemy, picked on resolution | FIXED | CR 355.5 / 403.2 (a specific object = target, chosen as the trigger goes on the chain), 383.3.a ("you may" at the start decided then) | The set of things is confirmed; it is now an up-to-1 target chosen on the chain. Test: tests/cards/B3/vendetta.test.ts (updated) |
| rad-105 Reckless Innovator | "Pay [C] to draw 1" mode offered only when payable | NEEDS-ENGINE | CR 403.2 (modes chosen as the trigger goes on the chain), 383.3.b + RAD-FAQ Riven (a cost after "choose one" is paid on resolution) | → R-1. Best call for the sub-question: offer both modes at finalization; the [C] is paid (or not) on resolution, and declining just skips the draw. |
| sfd-074 Pickpocket | "you may kill a gear" = up-to-1 target chosen on the chain | CONFIRMED | CR 383.3.a, 355.5, 355.13; SFD-FAQ (Pickpocket can kill a Gold token: a token's cost counts as 0) | none |
| ogn-187 Whirlwind | Each player's pick is non-targeting, in order from the next player | CONFIRMED | Card text ("Starting with the next player"); CR 355.10 (chosen by another player = not a target), 355.18 (made on resolution) | none |
| Bomb token | No enemy unit there → the whole trigger is removed, other Bombs aren't killed | CONFIRMED | CR 403.4 ("If a Triggered Ability on the chain has no legal options to choose from, it is removed from the chain") | none |

## B6

| Card | Question | Verdict | Source | Change |
|---|---|---|---|---|
| rad-043 Riven, Broken Blade / ven-088 Jayce, Hammer in Hand | Mode chosen on resolution; "spend my buff" modes offered only while buffed | NEEDS-ENGINE | CR 403.2, 355.3; RAD-FAQ Riven ("The first part of Riven, Broken Blade's triggered ability is 'Choose one that hasn't been chosen this turn…'"; the buff is spent on resolution, 383.3.b) | → R-1. Best call for the sub-question: offer every not-yet-chosen mode at finalization; a "spend my buff" mode with no buff on resolution does nothing (it still counts as chosen this turn). |
| ogn-110 Ekko, Recurrent | "Recycle me to ready your runes" optional | FIXED | UNL-FAQ (Ekko, Recurrent): the recycle "becomes the ability's base cost when placed on the chain"; CR 383.3.b (declining removes it) | Optional confirmed, but it is now a base cost paid as the Deathknell goes on the chain (not a "may" on resolution). Test: tests/cards/B6/rulings.test.ts |
| "Ready up to N runes" (Battle Preparations, Sona, Hwei, Gemdragon, Acceleration Gate) | Runes picked on resolution from your exhausted runes | FIXED | CR 355.5 / 403.2; OGN-FAQ Sona, Harmonious (runes are targets of the trigger; errata to "up to 4"); VEN-FAQ Hwei (type branches are reflexive triggers, CR 387.1.b) | Battle Preparations, Sona, Gentle Gemdragon and Acceleration Gate now target their runes when played / put on the chain (before costs, so runes about to be exhausted for the payment can be chosen; Acceleration Gate uses one group of up to 4 units/gear/runes). **Hwei: CONFIRMED** — its runes are chosen after the discard, when the reflexive Gear item would finalize; making that a real chain item (and multi-type discards giving several items) → R-7. Tests: B6/ogn, B6/ven (updated), B6/rulings.test.ts |
| ogn-143 Pirate's Haven; ven-071 Fretful Feline; ven-088 Jayce | Pirate's Haven doesn't trigger on Awaken; "when I become ready" does | FIXED (Haven) / CONFIRMED (Feline, Jayce) | CR 315.1.b ("The Turn Player readies all Game Objects they control"), 416.3.a ("A player Readies all non-spell Game Objects they Control during the Awakening Phase"), 412.1 (the performer is responsible), 412.4 ("you" triggers = actions you are responsible for). No official FAQ; community judges (RiftJudge #2603/#9115) agree. | Pirate's Haven now triggers on Awaken readies. Engine should pass the turn player → R-3. Test: tests/cards/B6/ogn.test.ts (updated) |
| ogn-108 Convergent Mutation | "another friendly unit" is a pick, not a target | FIXED | CR 355.5 (a specific object required by the text is chosen when played and is targeted even without "choose") | Second unit is now a target (sees "when chosen"). Test: B6/rulings.test.ts |
| ogn-146 Wallop / ogn-207 Call to Glory | With a buff available, legality treats the spell as free | CONFIRMED | Card text ("If you do, ignore this spell's cost"); CR 355.1.a (optional additional cost chosen while playing), 356 | none |
| ogn-027 Darius, Trifarian | Counts himself as the second card | CONFIRMED | OGN-FAQ (Darius, Trifarian): yes, he readies and gets +2 — "Triggers are checked right after the event, while Darius is on the board"; as the third card he doesn't trigger | none |
| rad-057 Piltovan Guidebot | Ignores its own play and tokens | FIXED | OGN-FAQ Darius (above) / CR 383.2.c.1; OGN-FAQ Legion ("Tokens are not cards") | Tokens ignored (confirmed); its own play now counts. Test: B6/rulings.test.ts. DSL note R-8 (`whenYouPlay` always skips the source). |

## Engine-level

| Item | Verdict | Source | Change |
|---|---|---|---|
| Mode/target timing in general | NEEDS-ENGINE | CR 355.1-355.18, 403.2, 383.3.a-b; RAD-FAQ Riven | Rule stated above. Requests R-1 (trigger modes), R-2 (move destinations), R-5 (mandatory target groups with no candidates must roll back), R-6 (`pick` in triggers) in docs/dsl-requests.md. Fixed in scripts where the DSL already allows it: Bard, Jayce, Convergent Mutation, rune readying, Ekko. |
| Vision: multiple instances | CONFIRMED | CR 817.2 ("Multiple instances of Vision trigger separately"), 817.2.a-b | The engine already sums Vision and queues one trigger per instance (builtin.ts); rules-decisions #22 text is stale (R-9). Test: tests/rules/rulings.test.ts |

## Genuinely ambiguous (no official answer)

- **Renata Glasc vs "play … exhausted"** — best call: tokens enter ready (current behaviour). See B3 table.
- Sub-points with no official answer, decided by reasoning (recorded above): which modes may be chosen when their cost can't be paid
  yet (Riven, Reckless Innovator — best call: all choosable, paid on resolution); Bard's destination stops being open before resolution
  (best call: no move); Pirate's Haven on Awaken (CR text is clear, but there is no FAQ).

---------------------------------------------------------------------------------------------------

# Round 2 (B2, B4, B5, B7, B8)

**Totals: 63 items — CONFIRMED 36, FIXED 16, NEEDS-ENGINE 7, AMBIGUOUS 3, NEEDS-DATA 1** (NEEDS-DATA = the printed card may differ from
data/cards.json and couldn't be verified; plus the Deathgrip addendum, AMBIGUOUS).

Extra sources: CR 821 Weaponmaster (https://riftlens.pages.dev/rules/weaponmaster/), CR 706-711 Mighty (/rules/mighty/), CR 826
Backline and CR 467.2.c (/rules/backline/, /rules/step-2-the-combat-damage-step/), CR 420.4 (/rules/play/), CR 315.3 / 487.7
(/rules/start-of-turn/, /rules/1v1-duel/), CR 429 + kill FAQ (/rules/kill/), CR 470-473 (/rules/scoring/), CR 370-375
(/rules/replacement-effects/).

## Lead's special-attention points

- **Weaponmaster with no [A]** — NEEDS-ENGINE (R-10). CR 821.1.c.3: "If the chosen card's Equip cost does not contain [A], it can
  still be paid, but will not be reduced." The engine removes another power symbol instead. Also 821.1.c.2 (Equip cost modifiers apply,
  calculated as if targeting the Weaponmaster unit) and the choice being made as the trigger goes on the chain.
- **"When you play a card/spell" timing** — CONFIRMED. CR 420.4.a: such abilities "trigger when the act of playing the card has been
  completed by the resolution of the card"; 420.4.a.1: a countered card never triggers them; 420.4.b: non-trigger checks look at
  finalization. UNL-FAQ (Darius, Trifarian / Ravenbloom Student = resolve; Battering Ram = finalize). Units and gear resolve
  immediately on finalization (CR 337.2), so the engine's `play` event (permanents at finalization, spells at resolution) is right for
  both. Cards that trigger on their own play see it (OGN-FAQ Darius) — fixed for Zero Point Inflection this round.
- **Mighty** — CR 709: a unit "becomes Mighty at the moment its Might changes from being less than 5 to being 5 or greater" (example:
  a 4-Might unit that gets +1 becomes Mighty); 711: cards off the board use printed Might, so a unit played with 5+ printed Might does
  **not** become Mighty — its Might never changed on the board from below 5 to 5 or more (docs/riftjudge/DECISIONS.md principle 9,
  #7869/#7974; it *is* Mighty for "play a Mighty unit"). Buffs crossing 5 **do** count (engine emits it); statics starting to apply
  (R-11) and "this turn" modifiers expiring in the Expiration step (RJ#358, CR 317.2.f) count too. A unit's own "while I'm Mighty"
  keywords never keep it Mighty (CR 478.4 Fiora, Victorious example; principle 8). (Reconciled with DECISIONS.md by ENGINE-3.)
- **Backline vs "I must be assigned combat damage last"** — CONFIRMED identical. CR 467.2.c.6 quotes Backline as "I must be assigned
  combat damage last"; 467.2.c.8's example treats Caitlyn's text as Backline; 826.3-826.4.b.
- **Sandstone Chimera vs the second player's extra rune** — AMBIGUOUS. CR 315.3.b (channel 2), 487.7 ("The player going second
  channels an extra Rune … during their first Channel Phase"). Best call (current behaviour, unchanged): Chimera replaces the 2-rune
  task "at the start of their Channel Phase" with 1; 487.7's extra rune is a separate mode-of-play addition, so that player channels 2.
- **"Spent [4] or more" = amount actually spent** — FIXED. Revna, Virtuoso, Forgotten Library read the play event's `paid.energy`;
  Jhin, Meticulous Killer reads the engine count `maxSpellEnergy:<p>`. Revna's todo test is enabled (tests/cards/B6/todo.test.ts).

## From B2

| Card | Question | Verdict | Source | Change |
|---|---|---|---|---|
| Weaponmaster (engine) | no [A] → [C] removed | NEEDS-ENGINE | CR 821.1.c.2-c.6 | R-10 |
| rad-069 Zero Point Inflection | own play doesn't count; one trigger per draw instruction | FIXED | OGN-FAQ Darius ("Triggers are checked right after the event, while Darius is on the board"); "1 or more cards" = one event batch | its own play now draws 2; per-instruction behaviour confirmed |
| rad-146 The Ball / sfd-049 Aphelios | mode on resolution | NEEDS-ENGINE | CR 403.2 | R-1 |
| sfd-078 Temporal Portal | Repeat offered after the play, not in Make Choices | NEEDS-ENGINE | CR 355.1.a (optional additional costs are chosen in Make Choices) | B8-18 (`grantRepeat`) |
| rad-089 Titanic Shrine | "exhaust me to draw 1" as a choice on resolution | FIXED | CR 383.3.b, 383.3.b.1 (a cost at the start of the effect is the base cost, paid to finalize) | optional + `cost('[T]')` on the trigger |
| rad-136 Dockside Lock-Up | hold "kill this to play…" on resolution; play "banish a unit here" mandatory, may hit own unit | FIXED / CONFIRMED | CR 383.3.b; card text ("a unit here") | kill is the hold trigger's base cost (banished cards remembered before it dies); on-play confirmed |
| ven-067 Bottled Constellation | "you may kill 3 … to score 1" on resolution | FIXED | CR 383.3.b ("… or immediately following the 'you may'") | base cost at finalization |
| rad-017 Detonation Amplifier | "you may kill … to draw 1" on resolution | FIXED | CR 383.3.b | base cost at finalization |
| ogn-032 Ravenborn Tome | bonus only to the spell's damage; consumed by the next spell even if it deals none | CONFIRMED | card text ("The next spell you play this turn") | none |
| ogn-023 Unlicensed Armory | "next time it would die" consumed whether or not [C] paid | FIXED | CR 371.2.b (a declined optional replacement has not been applied) | consumed only when paid |
| sfd-116 Yone, Blademaster | "was uncontrolled" tracking | CONFIRMED | SFD-FAQ (Yone keys off control before the conquest) | the engine `conquer` event now carries `prevController`, which the helper prefers |
| unl-188 Hextech Gauntlets via Weaponmaster | reduction uses the unit being played | CONFIRMED | CR 821.1.c.2 (cost computed as if targeting the Weaponmaster unit) | engine part in R-10 |
| unl-085 Sumpworks Map | "an opponent scores" = gaining points by any means | FIXED | CR 470.2-470.3 ("score" without a number = the Scoring process), 471 | triggers on an opponent's conquer / hold |
| sfd-184 Relentless Pursuit | base or any battlefield | CONFIRMED (+FIXED) | CR 451.1, 355.4.a; 355.5 | destinations confirmed (timing R-2); the Equipment is now a target chosen when played |
| sfd-107 Strike Down | damage source is the unit | CONFIRMED (+FIXED) | card text ("It deals"); 355.5 | the Equipment to detach is now chosen when played |
| sfd-090 The Zero Drive | data never banishes "with this" | NEEDS-DATA | card databases checked (cardsrealm) show only the Equip and banish abilities; printed effect text not verifiable | DATA agent to check the printed card |
| ven-137 Shady Spectacles / sfd-059 Svellsongur | copied Might; Svellsongur copies | NEEDS-ENGINE | VEN-FAQ (statuses aren't copied); SFD-FAQ Svellsongur ("three copies on one unit give four instances") | B2-9 / B2-10 |

## From B4

| Card | Question | Verdict | Source | Change |
|---|---|---|---|---|
| Charm, Siren's Song, Temptation, Void Assault, Blast Cone | "Move X" with no destination: any other location, bf→bf without Ganking | CONFIRMED | CR 451.1, 355.4.a; movement FAQ ("Ganking is an extra way to use the standard move") | timing → R-2 |
| ogn-162 Miss Fortune, Captain | "something else that's exhausted" = any exhausted unit/gear/rune/legend | CONFIRMED | card text; CR 355.5 (already a target on the chain) | none |
| ogn-158 Volibear, Imposing | once per move; only opponent-moved units | CONFIRMED (reasoned) | CR 412.1 / 412.4 (the opponent is responsible for their move) | none |
| ogn-240 Sett, Kingpin | counts himself if buffed; nothing at base | CONFIRMED | card text (no "other"; "my battlefield") | none |
| sfd-148 Draven, Audacious | "die in combat" = had a combat role | CONFIRMED (reasoned) | CR 468; SFD-FAQ Draven | none |
| sfd-173 Soraka / ogn-068 Caitlyn | "assigned combat damage last" = Backline | CONFIRMED | CR 467.2.c.6, 467.2.c.8 example, 826 | none |
| ogn-034 Tryndamere | excess = assigned − lethal, lethal = max(1, Might − damage) | CONFIRMED (reasoned) | CR 467.2.c.3; rules-decisions #10 | Sivir (B5) now uses the same bookkeeping |
| Evelynn, Entrancing / Tideturner | "a different/another location" overrides the Hidden "here" restriction | CONFIRMED | OGN-FAQ (play page): hidden targets come from that battlefield "unless the ability explicitly restricts targeting in a way that makes this impossible" | none |
| unl-054 Tricksy Tentacles | units picked one at a time when played; Deflect added | CONFIRMED | CR 355.5, 355.11 | timing of the destination → R-2 |
| unl-170 Atakhan | friendly unit killed in the as-you-play step | FIXED | Radiance FAQ / kill FAQ: "You pay Energy and Power costs before other costs, such as Atakhan's optional additional cost to kill a unit"; CR 357 | the unit is chosen while playing and killed in the payment step after Energy/Power |
| rad-113 Angler Wyrm / Heimerdinger at base | do nothing | CONFIRMED | card text ("my battlefield" / "while I'm at a battlefield") | none |
| rad-102 Demon Shade | mode chosen before the unit | CONFIRMED | CR 355.3-355.5 (both at play; modes are listed first) | none |

## From B5

| Card | Question | Verdict | Source | Change |
|---|---|---|---|---|
| ogn-029 Falling Star / ogn-248 Icathian Rain | printed text repeats the instruction | FIXED | SFD-FAQ "Falling Star, Icathian Rain, and Deflect": Falling Star has two "Deal 3 to a unit." instructions, Icathian Rain six "Deal 2 to a unit.", "(You can choose different units.)"; all targets chosen up front | data/cards.json was corrected by the DATA agent during this round; the scripts now have 2 / 6 target groups (same or different units). B5 tests updated (ogn-a, ven) |
| ogn-268 Bullet Time | "Pay any amount of [C]" on resolution, not an X cost | CONFIRMED | CR 383.3.b analogue for spells (a cost inside the instructions is paid on resolution); battlefield is a target at play | none |
| unl-186 Death from Below / unl-020 Dancing Grenade | one-time reflexive replay, not a lasting permission | CONFIRMED (reasoned) | CR 388-389 ("do this:" reflexive item; no duration given) | none |
| ogn-256 Fox-Fire / ven-107 Decree of Discord | total-Might cap re-checked on resolution | CONFIRMED | CR 359.3.e, 355.11; kill FAQ ("You can only kill units from among the ones you initially chose") | none |
| ogn-128 Challenge / unl-110 Clash of Giants | no damage at all if either unit is illegal | CONFIRMED (reasoned) | CR 359.3.e.14 (instructions depending on an illegal target's information are ignored) | none |
| sfd-077 Rocket Barrage | mode inferred from the chosen object | CONFIRMED | CR 355.3 (mode chosen at play — inferring it is equivalent: the two modes take different object types) | none |
| unl-209 Dusk Rose Lab | "your Beginning Phase" | CONFIRMED | CR 190.6 / rules-decisions #27 (battlefield abilities are controlled by the battlefield's controller) | its "you may kill … to draw 1" should be a base cost (sweep table) |
| ven-039 Crumbling Sands | "another spell" excludes itself and the target | CONFIRMED | VEN-FAQ (can counter the first spell if an opponent played a later spell) | none |
| sfd-120 Sivir, Ambitious | "excess" = dealt beyond lethal after prevention | FIXED | card text "if you assigned 5 or more excess damage" | uses the B4 excess-assignment bookkeeping (Tryndamere) |

## From B7

| Card | Question | Verdict | Source | Change |
|---|---|---|---|---|
| Morbid Return, Cemetery Attendant, Annie, Starhound | returning a card from the trash = target chosen on play | CONFIRMED | CR 355.5 (the trash is public, so the card is a choosable object) | none |
| ogn-198 The Harrowing, ogn-196 Soulgorger, ogn-226 Spectral Matron, sfd-165 Glasc Mixologist, rad-135 Remember the Fallen | the trash card picked on resolution | FIXED | CR 355.5 / 403.2 | trash cards are now targets chosen when played / put on the chain. The Harrowing with no unit in the trash can't be played (CR 355.17, 358.1). Look-and-play cards still choose on resolution (looked-at cards), offering only affordable ones — accepted approximation |
| ogn-037 Immortal Phoenix | triggers on its own death from your spell | CONFIRMED (reasoned) | CR 383.2.c.1 (an object entering its active zone at the same moment can trigger); 429.5.d | none |
| ogn-118 Wraith of Echoes | no draw if a friendly unit died earlier this turn, even before Wraith arrived | CONFIRMED (reasoned) | CR 383.1 ("The Nth time" counts the turn's events), same reading as OGN-FAQ Darius (cards played before he was on the board count) | none |
| ogn-200 Twisted Fate, Gambler | Order mode: any enemy unit | CONFIRMED | card text (no "here") | none |
| rad-107 Bedeviling Stranger / ven-105 Twilight Step | enemy unit chosen on resolution; destination on resolution | FIXED / NEEDS-ENGINE | CR 403.2, 355.5; 355.4 | Stranger's enemy unit is now an up-to-one target with the battlefield; Twilight Step → R-2 |
| rad-010 Forbidden Technique / rad-120 Meticulous Restorationist | spells trigger only after they resolve | CONFIRMED | CR 420.4.a, 420.4.a.1 | none |
| Flame Chompers, Immortal Phoenix, Mask Mother | trash triggers with a cost trigger only if affordable | CONFIRMED | CR 383.3.b.1 ("The cost must be paid in order to finalize the Triggered Ability") | none |
| unl-139 Bone Skewer | opponent still offered Accelerate despite "ignoring any and all costs" | NEEDS-ENGINE | card text — best call: no optional additional costs | B7-2 (`noAdditional`) |
| rad-111 Mechanical Bandit | tie = you revealed the lowest | CONFIRMED | card text ("a card with the lowest Energy cost") | none |
| rad-140 Chronobreak | Power payment capped by unit count | CONFIRMED | paying more than you have units changes nothing ("banish that many" = as many as possible) | none |
| rad-154 Last Caress | buffs the next unit even if played by an effect | CONFIRMED | card text ("you play" includes plays you make through effects) | none |

## From B8

| Card | Question | Verdict | Source | Change |
|---|---|---|---|---|
| ogn-227 Symbol of the Solari | tie handling | CONFIRMED | SFD-FAQ Draven (tie = both or neither have units left); CR 468.3.d | none |
| sfd-205 Grand Duelist | becameMighty only on a modifier crossing 5 | NEEDS-ENGINE | CR 709, 711 (see above) | entering with 5+ correctly doesn't count; buffs do; statics/expiry → R-11 |
| ogn-261 Radiant Dawn / sfd-199 Prodigal Explorer | Radiant Dawn: one trigger per executed stun instruction (each Repeat execution is a new execution → its own event batch, RJ#6584). Prodigal Explorer: **each enemy unit/gear chosen counts** (one spell choosing two enemies = twice; Repeat executions count separately) | SUPERSEDED by docs/riftjudge/DECISIONS.md principles 6-7 (#2744, #92a, #6584) — the earlier "one choice per spell/ability" reading is withdrawn | "one or more" = one event batch per executed instruction | done (ENGINE-3: Repeat executions start new batches; Prodigal script counts per object) |
| rad-162 Firelights' Hideout | a token doesn't use up "next unit" | FIXED | CR 185.2.d ("A token unit is a unit") | a token unit uses it up |
| ven-161 Piltovan Forge | mana abilities don't count | AMBIGUOUS | CR 401.2 (Add abilities are activated abilities); card text "the first friendly gear activated ability played each turn" | none. Best call: they count (a Gold used first would waste the discount); needs an engine count of gear activations incl. Add abilities |
| ven-036 Sandstone Chimera | second player's extra rune | AMBIGUOUS | see above | none (best call: 2) |
| ven-029 Ol' Poro | blocked only on its controller's turns 1–3; playable by an effect | NEEDS-ENGINE | card text ("your … turns"); golden rule "Can't beats Can" | first part confirmed; effect plays must be blocked too → R-13 |
| ven-053 Otterpus / sfd-209 Forgotten Monument | scoring player's own turns; each player's own turns | CONFIRMED | card text; SFD-FAQ Forgotten Monument | none |
| ogn-189 Kayn, Unleashed | prevents all damage after moving twice, but assignment treats him as killable | AMBIGUOUS | CR 467.2.c.3, 467.2.c.6; rules-decisions #10 | none. Best call: treat "don't take damage" like a prevent-'all' shield (not lethal-assignable) → R-12 |
| sfd-202 Hostile Takeover | control returns, then recall | CONFIRMED | card text order ("Lose control … and recall it") | none |
| Virtuoso / Revna / Jhin | spent = printed cost | FIXED | see above | actual Energy paid |
| rad-145 Lady of Clockwork | choice stored in counters | CONFIRMED (+FIXED) | CR 383.3.b / 403.2 | the [1] is now the trigger's base cost and the gear a target, both on the chain |
| rad-019 Firebrand Raider | sets exhausted=false directly (not readying) | CONFIRMED | "enter ready" is not "become ready" (CR 416.1: readying changes an exhausted object) | none |

Tests added/updated this round: tests/cards/B2/spells.test.ts (Relentless Pursuit), tests/cards/B6/todo.test.ts (Revna enabled),
tests/cards/B7/{draw-discard,trash,misc}.test.ts, tests/cards/B8/legends-b.test.ts (Lady of Clockwork).

## Sweep: resolution-time choices that break the general timing rule

Method: every `choose(T.…)`, `chooseCards`, `chooseMode`, `E.chooseOne`, `chooseLocation`, `chooseBattlefield`, `moveChosen`,
`moveAnywhere` in src/cards/scripts/batch-B*.ts (114 call sites, 100 cards) was checked against the card text. Legitimate
resolution-time choices (hidden or looked-at cards, other players' choices, costs inside the instructions, non-bulleted "A or B",
"as you play / as this is attached", reflexive "do this" items, the split division, "must" instructions) are not listed.

| Card(s) | Violation | Status |
|---|---|---|
| Riven, Broken Blade; Jayce, Hammer in Hand; Reckless Innovator; The Ball; Aphelios; Minah Swiftfoot | bulleted trigger mode chosen on resolution (CR 403.2) | OPEN → R-1 |
| Skyward Strike, Satchel Charge, Relentless Pursuit, Charm, Siren's Song, Temptation, Void Assault, Shadow Dash, Cataclysm, Demon Shade, Call to Battle (your move), Imposing Challenger, Blast Cone, Tricksy Tentacles, Dragon's Rage, Shuriken Flip, Ride the Wind, Showstopper, Command: Attack, Twilight Step, Unforgiven, Maduli | move destination chosen on resolution (CR 355.4) | OPEN → R-2 |
| Bard, Mercurial | destination + units | FIXED (round 1) |
| Shuriken Flip | "move a friendly unit" — the unit is picked on resolution (CR 355.5) | OPEN (fix together with R-2) |
| Profiteer; Ziggs ("you may kill a friendly gear to …"); Rumble ("you may recycle another friendly unit to …"); Emperor's Dais; Wildclaw Shaman; Dusk Rose Lab; Deceiver; Monastery of Hirana; Shadow Order Disciple ("you may [Burn 1] to …"); Gust Monk ("banish a card from any trash to …") | cost at the start of a trigger's effect handled as a "may" on resolution instead of a base cost at finalization (CR 383.3.b) | OPEN (script; pattern: `optional` + `cost(…, pay.custom(…))`, as done for Titanic Shrine) |
| Titanic Shrine, Bottled Constellation, Detonation Amplifier, Dockside Lock-Up, Lady of Clockwork, Ekko, Recurrent | same | FIXED |
| Profiteer (the thing to empower); Edge of Night (the unit to attach to); Fortified Position, Navori Fighting Pit, Durand Memorial (the unit) | specific object chosen on resolution in a trigger (CR 403.2, 355.5) | OPEN (script) |
| Pack of Wonders, Azir, Cursed Sarcophagus, Forge of the Future | specific object chosen on resolution in an activated ability (CR 355.5 via 399-407) | OPEN (script) |
| Hexplosive Minefield ("Kill any number of friendly Bomb tokens"), Chronobreak (the units to banish), Heedless Resurrection (the trash unit) | specific objects chosen on resolution in a spell (CR 355.5) | OPEN (script) |
| The Harrowing, Soulgorger, Spectral Matron, Glasc Mixologist, Remember the Fallen, Bedeviling Stranger, Jayce (Brilliant Inventor), Convergent Mutation, rune readying (Battle Preparations, Sona, Gemdragon, Acceleration Gate), Strike Down, Relentless Pursuit (Equipment) | same | FIXED |
| Gentlemen's Duel ("Then choose an enemy unit") | a sequenced "then choose" — CR 355.5 has no exception for "then"; the Origins FAQ asks this for Dragon's Rage but the answer is collapsed | AMBIGUOUS (left on resolution) |

# Round 3 — chain / trigger timing

| Question | Verdict | Source | Change |
|---|---|---|---|
| Triggers met during a chain item's resolution vs triggers met in the cleanup right after it | NEEDS-ENGINE (R-16) | CR 334.1 ("Chain Items may be added to the Chain. They will remain there until the Tasks are complete."), 334.2 ("When all Outstanding Tasks are completed, all pending Chain Items will subsequently be processed by the FEPR process."), 319 (a cleanup follows a chain item leaving the chain), 337.1.b ("Chain Items are Finalized in the order they were appended to the Chain."), 383.3.d (only triggers that trigger **simultaneously** are ordered together) | They are **not** ordered together: they trigger at different moments. Resolution-time triggers are appended first; cleanup-time triggers are appended after them (own ordering decision) and so end up on top and resolve first — the engine's placement order is right. What is wrong: the engine finalizes the resolution-time triggers (chooses targets, "you may", costs) *before* the cleanup, so they can target units that are about to die in it. Probe on the chain puzzle: when Acolyte's trigger chooses its target, Scrapper (lethal damage) is still on the board. Todo test: tests/rules/rulings-chain.test.ts |
| Simultaneous triggers of both players | CONFIRMED | CR 383.3.d.1 ("starting with the Turn Player, each player orders their own abilities on the Chain in turn order") — the turn player's go on first and resolve last | test in tests/rules/rulings-chain.test.ts (`flushTriggers` uses `turnOrderFrom`) |
| Trigger with no legal target | CONFIRMED | CR 403.4 ("If a Triggered Ability on the chain has no legal options to choose from, it is removed from the chain. This is not treated as the ability being countered.") | Being asked to order it first is correct: the order is chosen as triggers are placed, the target check is part of finalization. Test in tests/rules/rulings-chain.test.ts |

## Addendum (found while re-running the suite)

| Card | Question | Verdict | Source | Change |
|---|---|---|---|---|
| sfd-163 Deathgrip | With only one friendly unit, can it be played (kill it and draw)? The engine's new R-5 rollback says no; the B5 test said yes. | AMBIGUOUS | CR 355.5 ("another friendly unit" is a target chosen when played), 355.17, 358.1, 358.5; SFD-FAQ Janna, Savior (errata to "up to one" "so the heal works without enemies present", i.e. a missing mandatory target stops the whole card) | Best call: can't be played. tests/cards/B5/sfd.test.ts updated to that |

Note: `Firelights' Hideout: the next unit you play this turn has Accelerate` (tests/cards/B8/battlefields-more.test.ts) started failing
during the ENGINE agent's in-progress play.ts migration; it fails with or without this round's script change (verified by reverting
it), so it is left for the engine agent.

# Rulings queue

Interpretations that scripting agents were unsure about. The RULINGS agent researches each one against
official sources (card text > official FAQ/rulings > Core Rules 1.5 > tournament rules) and records a verdict.

## From B1
- unl-038 Skyward Strike: "Move an enemy unit" — caster picks any other location (base or another battlefield) per CR 451; Level 6 stun is optional target group (min 0).
- sfd-039 Royal Entourage: ready vs exhaust chosen on resolution, not when put on chain.
- ven-035 Sanction / ven-099 Tornado Warrior: "disempower it at end of turn" applies even if the unit was already Empowered before.
- unl-095 Grim Resolve: "it wins a combat" = its controller won the combat and the unit was an attacker or defender.
- ven-143 Master of Shadows: a sourceless banish (Flow spell banishing itself) counts as "you banish".
- ven-155 Heart of the Tempest: playing your champion from the champion zone counts as "anywhere other than your hand".
- ven-086 Gangplank: "a spell or ability that chooses me" approximated as "the resolving chain item targeted me".
- unl-164 Safety Inspector: Inspector itself can be chosen; choices in turn order; kills simultaneous.
- sfd-079 Bard: "open battlefield" = no units and no controller (CR 170.11.c).
- unl-140 Conscription: declining XP cost with only large enemies → spell resolves doing nothing.
- unl-192 Alpha Strike: recipients may outnumber damage; extras get 0.

## From B3
- sfd-171 Renata: "Your tokens enter ready" overrides Gold played "exhausted".
- rad-132 Heimerdinger: replacement Mech keeps original token's ready/exhausted; not offered if token already a Mech.
- "Play N tokens" with no location (Recruit the Vanguard, Encore, Vanguard Armory…): each token's location chosen separately.
- Illaoi "when I score": read as "when you conquer or hold a battlefield I'm at" (CR 471).
- Satchel Charge: move destination chosen on resolution — but CR 355.4 says move destinations are chosen when played. CHECK.
- Encore "draw 1": chosen card goes to hand directly, no draw event.
- Jayce "ready something": any exhausted unit/gear/rune/legend incl. enemy, picked on resolution.
- Reckless Innovator: "Pay [C] to draw 1" mode only offered when payable.
- Pickpocket: "you may kill a gear" = up-to-1 target chosen when trigger goes on chain.
- Whirlwind: each player's pick is non-targeting, in order starting with next player.
- Bomb token: with no enemy unit there, whole trigger removed (CR 403.4 / T120), so "kill your other Bombs there" doesn't happen.

## From B6
- Riven, Broken Blade / Jayce: mode chosen on resolution, not when put on chain. Riven offers "spend my buff" modes only while buffed.
- Ekko, Recurrent: "Recycle me to ready your runes" treated as optional.
- "Ready up to N runes" (Battle Preparations, Sona, Hwei, Gemdragon): runes picked on resolution from your exhausted runes. Acceleration Gate picks units/gear on play, runes on resolution.
- Pirate's Haven: doesn't trigger on Awaken; Fretful Feline and Jayce ("when I become ready") do.
- Convergent Mutation: "another friendly unit" is a pick, not a target (ignores Deflect / "when chosen").
- Wallop / Call to Glory: while a buff is available, legality treats the spell as free.
- Darius: counts himself if he's the second card you play.
- Piltovan Guidebot: ignores its own play and tokens.

## Engine-level
- Mode/target timing in general: CR says targets/modes chosen when played/put on chain? Establish one consistent rule and audit all scripts for it.
- Vision: multiple instances — CR 817.

## Status
- 2026-11-25 RULINGS: every item above has a verdict in docs/rulings.md (all scripting batches had finished, so fixes were made in
  place). Engine follow-ups: docs/dsl-requests.md "From RULINGS" R-1..R-9.

# Round 2 (from B2, B4, B5, B7, B8 reports) — apply the general timing rule from docs/rulings.md everywhere

## From B2
- Weaponmaster on a cost with no [A]: engine removes [C] (Equip [C] becomes free) but rules-spec §15 / CR 821 says "if no [A] in the cost, pay it in full". CHECK + fix engine/script.
- Zero Point Inflection: "When you play a card" doesn't count playing itself; triggers once per draw instruction.
- The Ball / Aphelios: mode chosen on resolution (CR 383.3 wants on chain) — tie to R-1.
- Temporal Portal: repeat payment offered right after play rather than in Make Choices step.
- "Do X to do Y" as a choice at resolution: Titanic Shrine, Dockside Lock-Up hold trigger, Bottled Constellation, Detonation Amplifier. Dockside Lock-Up on-play "banish a unit here" mandatory, may hit own unit.
- Ravenborn Tome: bonus damage only to damage whose source is the spell; consumed by next spell even if it deals none.
- Unlicensed Armory: "next time it would die" consumed whether or not [C] paid.
- Yone: "was uncontrolled" tracker fails if Yone wasn't on board when the fight started.
- Hextech Gauntlets via Weaponmaster: reduction uses the unit being played.
- Sumpworks Map: "an opponent scores" = gaining points by any means. Relentless Pursuit: base or any battlefield. Strike Down: damage source is the unit, not the spell.
- The Zero Drive (sfd-090): data text never banishes "with this" — verify printed text (DATA agent).
- Shady Spectacles copy keeps printed Might; Svellsongur doubles only triggers/stacking keywords (engine gaps B2-9/B2-10).

## From B4
- "Move X" with no destination (Charm, Siren's Song, Temptation, Void Assault, Blast Cone): any location except current, incl. bf→bf without Ganking.
- Miss Fortune, Captain: "something else that's exhausted" = any exhausted unit/gear/rune/legend either side.
- Volibear: once per move, only when an opponent moves their own units.
- Sett, Kingpin: counts himself if buffed; nothing at base.
- Draven, Audacious: "die in combat" = had attacker/defender role when died.
- Soraka / Caitlyn (B5): "must be assigned combat damage last" implemented as Backline (CR 826) — is that exact?
- Tryndamere: excess = assigned − lethal at assignment, lethal = max(1, Might − damage).
- Evelynn, Entrancing / Tideturner from hiding: text reaching "a different/another location" overrides CR 811.1.d here-restriction.
- Tricksy Tentacles: units picked one at a time as played; Deflect added.
- Atakhan: friendly unit killed in as-you-play step.
- Angler Wyrm / Heimerdinger at base do nothing.
- Demon Shade: mode chosen before unit (text says unit first).

## From B5
- Falling Star (ogn-029) / Icathian Rain (ogn-248): data says only "Deal 3/2 to a unit." — printed cards likely repeat the instruction. DATA agent to verify.
- Bullet Time: "Pay any amount of [C]" paid on resolution vs X cost.
- Death from Below / Dancing Grenade: one-time reflexive replay vs lasting permission.
- Fox-Fire / Decree of Discord: total-Might cap re-checked on resolution (CR 359.3.e)?
- Challenge / Clash fights: no damage at all if either unit illegal on resolution?
- Rocket Barrage: mode inferred from chosen object rather than asked.
- Dusk Rose Lab "your Beginning Phase"; Crumbling Sands "another spell" excludes itself and the target; Sivir "excess" = dealt beyond lethal after prevention.

## From B7
- Returning a card from the trash (Morbid Return, Cemetery Attendant, Annie, Starhound…): treated as target chosen on play.
- Play-from-zone (Remember the Fallen, Harrowing, Soulgorger…) pick on resolution; look-and-play only offers affordable cards.
- Immortal Phoenix triggers on its own death from your spell.
- Wraith of Echoes: no draw if a friendly unit already died earlier this turn, even before Wraith arrived.
- Twisted Fate Order mode: any enemy unit, not just here.
- Bedeviling Stranger: enemy unit chosen on resolution. Twilight Step destination on resolution (CR 355.4 says on play) — tie to R-2.
- "When you play a card with Energy cost [7]+" (Forbidden Technique, Meticulous Restorationist): spells trigger only after they resolve (CR 420.4.a.1)? CHECK carefully — this is "when you play" vs resolve.
- Trash triggers with a cost (Flame Chompers, Immortal Phoenix, Mask Mother) only trigger if affordable.
- Bone Skewer: opponent may still be offered Accelerate despite "any and all costs".
- Mechanical Bandit tie = yours lowest. Chronobreak power payment capped by unit count. Last Caress buffs next unit even if played by an effect.

## From B8
- Symbol of the Solari tie handling; Grand Duelist uses becameMighty only on modifier crossing 5 (units entering with 5+ / buffs don't count?) — CHECK Mighty definition.
- Radiant Dawn: one trigger per stunning instruction. Prodigal Explorer: one choice per spell/ability.
- Firelights' Hideout: token doesn't use up "next unit". Piltovan Forge: mana abilities don't count.
- Sandstone Chimera: second player still gets +1 extra rune on first Channel → 2? Should it be exactly 1?
- Ol' Poro: blocked only on controller's own turns 1–3; playable by effect.
- Otterpus: scoring player's own turn. Forgotten Monument counts each player's own turns.
- Kayn: prevents all damage after moving twice, but damage assignment treats him as killable.
- Hostile Takeover (T132): end of turn control returns, then recall.
- Virtuoso / Revna / Jhin "spent [4] or more": printed cost used, 0 from facedown — must be amount actually spent (engine now records spent per B4-5?).
- Lady of Clockwork stores choice in counters. Firebrand Raider sets exhausted=false directly (not "readying").

## Round 3 — chain/trigger timing (HIGH PRIORITY, from lead)
- Triggers that trigger DURING a chain item's resolution (e.g. Iron Sentinel killed by Last Rites) vs triggers that trigger in the CLEANUP right after it (e.g. a unit with lethal damage dying in cleanup step 3a): does the engine let the same controller order ALL of them together before any go on the chain (CR 320 pending items / "pending" vs "finalizing")? Currently the engine asks P1 to order the resolution-time triggers BEFORE the cleanup runs, so a cleanup-time Deathknell of the same controller would be ordered separately (and end up on top). Find the exact CR text; write a conformance test with a P1 unit that has lethal damage dying in that cleanup and its own Deathknell; fix the engine (file R-n) if wrong. See tests/puzzles/chain-puzzle.test.ts for the scenario harness.
- Also verify: APNAP-style order when BOTH players have simultaneous triggers (whose go on the chain first?), and that a trigger with no legal target on being put on the chain is removed (CR 403.4) — and is that player still asked to order it (currently yes; harmless but check).
- Elder Dragon + Soraka (from user question; scenarios in tests/puzzles/elder-soraka.scenario.ts — convert to asserted tests in tests/puzzles/elder-soraka.test.ts):
  (a) Simultaneous combat deaths: Soraka dies in the same cleanup as V(2); the engine still applies Soraka's "would die → heal/exhaust/recall" to V(2). Verify against the CR (do replacement effects of a unit dying simultaneously apply?).
  (b) Elder Dragon's rule is checked via g.ex.damageSrc[unit] = the LAST damage source only. "Any amount of YOUR damage" should mean: if the unit has any damage dealt by you this turn (damage persists all turn), it dies — even if the opponent damaged it afterwards, and including damage you dealt before Elder Dragon entered. Verify the rule reading; if right, file R-n for the engine (track damage per dealing player).
  (c) Soraka "must be assigned combat damage last" implemented as Backline (CR 826) — confirm equivalence incl. Tank+Backline interplay and multiple Backline units.

## Status (rounds 2-3)
- 2026-11-25 RULINGS: Round 2 and Round 3 verdicts are in docs/rulings.md; engine follow-ups R-10..R-16 in docs/dsl-requests.md.

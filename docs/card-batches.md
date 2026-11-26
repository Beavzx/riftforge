# Card scripting batches (CARD-ANALYSIS agent)

`data/card-batches.json` splits all 1051 cards that need a script (`scriptNeed === 'script'` in `data/card-analysis.json`) into 8
batches of 124 to 135 cards each. The batches are grouped by **shared mechanics**, not by set, so each scripting agent mostly needs one
corner of the DSL. Another 34 keyword-only cards (`B0`) need only keyword registration from `intrinsicKeywords`. Whoever owns keyword
plumbing can register them, or they can be appended to any batch.

How the batches are assigned (`tools/analyze-cards.ts`, `FAMILIES`): every card gets a score for each family from its pattern ids.
Cards with the clearest single family are assigned first. A card goes to its best family that still has room (cap about 1.02 × 1051/8).
Ties go to the emptier batch. About 20 cards with no strong signal fill the smallest batch, and about 45 go to their second-best family.
Hand-curated "weird" cards lean towards B8.

Ownership rules that keep overlap low:

- A batch owns the DSL helpers of its theme (listed below). Other batches use those helpers and don't fork them.
  If a helper is missing, ask the owner, or add it under `src/cards/dsl.ts` in the owning section.
- A card that touches several themes stays in its batch. Its script uses the other batches' helpers.
- Engine hooks for the weird cards (`docs/card-patterns.md` section 6) belong to the ENGINE agent. Batch agents only call them.

| batch | owns these DSL helpers |
|---|---|
| B1 empower / XP / level / costs | `empower`, `disempower`, Empower keyword cost (incl. "or" and self-reducing costs), `gainXp` / `spendXp`, Level gating and "instead" ladders, Hunt, self cost modifiers (`costsLessFor…`), optional / mandatory additional costs and "if you paid" memory, alternative costs |
| B2 equipment / gear / activated | `equip` costs, `attach` / `detach`, Weaponmaster, Quick-Draw, Deploy gear, mana abilities (`addResource`, restricted resources), activated-ability costs (kill this, recycle from trash, exhaust another unit), "use only while" restrictions |
| B3 tokens / go-wide | `playToken` with all token defs (Recruit, Gold, Mech, Bomb, Sprite, Bird, Sand Soldier, Shadow Clone, Tentacle, Reflection), Legion, anthem statics ("other friendly units have +1"), unit-count conditions |
| B4 combat / board | attack / defend / conquer / hold / move / win-combat triggers and their subject filters, `move` / `recall` / `swapLocations`, Ganking / Ambush / play-location permissions, `stun`, conditional self-Might and self-keyword statics, combat-damage rules |
| B5 removal / interaction | `dealDamage` (fixed, variable, split, bonus), `fight`, `kill` (with filters), `counter` (with filters, "unless pays"), `returnToHand`, `banish`, chain-target filters |
| B6 pump / ready / buff | `giveMight` (+/-, minimum 1, double, set base, swap), `buff` / `spendBuff`, `ready` / `exhaust`, `grantKeyword(this turn)`, become-exhausted / become-ready triggers |
| B7 card flow / zones | `draw` / `discard`, `lookAtTop` / `revealTop` + select-from-revealed, `predict`, `burn`, `recycle`, play from trash / deck / banishment (`playCardFromZone`, ignore / reduce cost), Flow, Repeat, Hidden / face-down play triggers |
| B8 legends / battlefields / rules | legend and battlefield scripts (hold / conquer here, "while you control this battlefield"), replacement effects, rules-modifying statics (victory, turn structure, cost rules, trigger multipliers), weird-card scripts that use engine hooks |

<!-- GENERATED:BATCHES -->
| batch | cards | scope |
|---|---:|---|
| B1-empower-xp-level-costs | 125 | Empower / Disempower, XP, Level, Hunt; self cost-modifiers and additional/alternative play costs |
| B2-equipment-gear-activated | 124 | Equipment & gear engines (Equip, attach/detach, Weaponmaster, Quick-Draw, Deploy gear, mana rocks) and activated abilities on units |
| B3-tokens-go-wide | 130 | Token makers & go-wide: tokens (Recruit, Gold, Mech, Bomb, Sprite, Bird, Sand Soldier, Shadow Clone, Tentacle), anthems, Legion, unit-count conditions |
| B4-combat-board | 132 | Combat, conquer/hold, attack/defend triggers, movement, Ganking, stun, Might statics |
| B5-removal-spells | 135 | Damage, kill, counter & interaction spells (incl. fight, split damage, bounce, control of spells) |
| B6-pump-ready-buff | 135 | Might pumps/debuffs, buff counters, ready/exhaust, keyword grants this turn |
| B7-cards-zones | 135 | Card flow & zones: draw/discard, look/reveal/predict/burn, play from trash/deck/banishment, Flow/Repeat, recycle, Hidden/face-down |
| B8-legends-battlefields-rules | 135 | Legends, battlefields, cost/rules-modifying statics, replacement effects, resource abilities, and bespoke weird cards |
| B0-keywords-only | 34 | Cards whose whole text is generic keywords: register keywords only, no bespoke script. |

### B1-empower-xp-level-costs (125)

Empower / Disempower, XP, Level, Hunt; self cost-modifiers and additional/alternative play costs

Types: Unit 82, Spell 26, Gear 8, Legend 9. Sets: ogn 7, rad 6, sfd 9, unl 49, ven 54.

<details><summary>cards</summary>

| id | name | key patterns |
|---|---|---|
| `ogn-002-298` | Brazen Buccaneer | play:additional-cost-optional, play:as-you-play, effect:discard |
| `ogn-012-298` | Noxus Hopeful | static:cost-mod-self |
| `ogn-044-298` | Clockwork Keeper | play:additional-cost-optional, trigger:play-self, effect:draw |
| `ogn-047-298` | Find Your Center | keyword:Action, static:cost-mod-self, effect:draw, effect:channel |
| `ogn-048-298` | Meditation | keyword:Reaction, play:additional-cost-optional, effect:draw |
| `ogn-144-298` | Spoils of War | keyword:Reaction, static:cost-mod-self, effect:draw |
| `ogn-195-298` | Rhasa the Sunderer | static:cost-mod-self |
| `rad-028-167` | Ki Burst | keyword:Action, play:additional-cost-mandatory, effect:stun |
| `rad-029-167` | Life from Stone | keyword:Reaction, play:additional-cost-mandatory, effect:draw, effect:channel |
| `rad-061-167` | Ekko, Ingenious | play:additional-cost-mandatory, effect:return-to-hand, keyword:Ganking |
| `rad-075-167` | Skystrike Squadron | play:additional-cost-optional, effect:return-to-hand, keyword:Deflect |
| `rad-080-167` | Bloodscent Swarm | static:cost-mod-self |
| `rad-122-167` | Party Crasher | static:cost-mod-self, keyword:Tank |
| `sfd-010-221` | Void Drone | static:cost-mod-self |
| `sfd-012-221` | Battering Ram | static:cost-mod-self |
| `sfd-039-221` | Royal Entourage | trigger:play-self, effect:exhaust |
| `sfd-044-221` | Legion Quartermaster | play:additional-cost-mandatory, effect:return-to-hand |
| `sfd-055-221` | Needlessly Large Yordle | keyword:Shield, keyword:Tank, static:cost-mod-self |
| `sfd-079-221` | Bard, Mercurial | play:additional-cost-optional, trigger:play-self, effect:move |
| `sfd-087-221` | Premonition | keyword:Reaction, effect:draw |
| `sfd-103-221` | Jaull-Fish | keyword:Accelerate, static:cost-mod-self |
| `sfd-106-221` | Show of Strength | keyword:Reaction, effect:draw |
| `unl-013-219` | Lotus Trap | keyword:Hidden, keyword:Reaction, replacement:would-be-dealt-damage, effect:double-damage |
| `unl-015-219` | Right of Conquest | effect:draw |
| `unl-016-219` | Scorchclaw | keyword:Hunt, static:self-might, static:enter-ready |
| `unl-017-219` | Square Up | keyword:Repeat, effect:grant-keyword |
| `unl-031-219` | Combat Experience | keyword:Reaction, effect:might-plus, replacement:instead |
| `unl-034-219` | Herald of Spring | keyword:Hunt, trigger:play-self, effect:gain-xp |
| `unl-035-219` | Monch | static:enter-ready, static:cost-mod-self, effect:enter-ready-grant |
| `unl-038-219` | Skyward Strike | effect:move, effect:stun |
| `unl-040-219` | Wuju Apprentice | keyword:Hunt, trigger:play-self, effect:draw |
| `unl-047-219` | Mosstomper | keyword:Hunt, static:self-might |
| `unl-053-219` | Scuttle Crab | trigger:play-self, effect:draw, trigger:die, trigger:deathknell, effect:reveal-hand, effect:gain-xp |
| `unl-059-219` | Master Yi, Unstoppable | static:cost-mod-self, static:cant |
| `unl-063-219` | Eclipse | keyword:Reaction, effect:might-minus, effect:predict |
| `unl-075-219` | Gustwalker | keyword:Hunt, static:self-might |
| `unl-091-219` | Concentrate | effect:draw, static:cost-mod-self |
| `unl-092-219` | Demacian Diplomat | trigger:play-self, effect:gain-xp |
| `unl-094-219` | Gemhand Hunter | keyword:Hunt, static:self-might |
| `unl-095-219` | Grim Resolve | keyword:Action, effect:might-plus, effect:gain-xp, effect:delayed-trigger |
| `unl-098-219` | Targonian Visionary | static:self-might |
| `unl-102-219` | Crowd Favorite | keyword:Hunt, effect:buff |
| `unl-103-219` | Disposal Order | keyword:Reaction, effect:draw, effect:recycle |
| `unl-107-219` | Stare Down | effect:move, effect:to-base, effect:gain-xp |
| `unl-108-219` | Wily Newtfish | static:self-might |
| `unl-109-219` | Blood Rose | trigger:play-card, effect:gain-xp, effect:ready |
| `unl-113-219` | Master Yi, Tempered | keyword:Hunt, static:self-keyword |
| `unl-115-219` | Nilah, Joyful Ascetic | keyword:Accelerate, keyword:Ganking, trigger:move, effect:gain-xp |
| `unl-116-219` | Poppy, Paragon | keyword:Deflect, trigger:play-self, effect:ready, effect:gain-xp |
| `unl-117-219` | Arachnoid Horror | keyword:Hunt, static:play-location |
| `unl-119-219` | Kha'Zix, Evolving Hunter | keyword:Hunt, trigger:attack, effect:deal-damage-variable, effect:spend-xp |
| `unl-122-219` | Crescent Guardian | play:additional-cost-optional, static:enter-ready, effect:enter-ready-grant |
| `unl-125-219` | Lunar Boon | keyword:Reaction, effect:draw, effect:discard |
| `unl-126-219` | Megatusk | effect:grant-keyword |
| `unl-127-219` | Mister Root | keyword:Accelerate, trigger:move, effect:gain-xp |
| `unl-129-219` | Vicious Snapjaws | trigger:die, effect:gain-xp |
| `unl-132-219` | Angler Beast | trigger:play-self, effect:return-to-hand |
| `unl-135-219` | Insightful Investigator | trigger:play-self, effect:draw, effect:discard, effect:reveal-hand, effect:spend-xp, effect:choose-player |
| `unl-136-219` | Scryer's Bloom | static:enter-exhausted, effect:draw, effect:predict, effect:gain-xp |
| `unl-140-219` | Conscription | play:additional-cost-optional, effect:spend-xp, effect:exhaust, effect:recall, effect:take-control, replacement:instead |
| `unl-143-219` | Kha'Zix, Mutating Horror | keyword:Ambush, trigger:attack, trigger:defend, effect:might-plus, effect:gain-xp |
| `unl-151-219` | Bandle Soldier | static:enter-ready, effect:enter-ready-grant |
| `unl-157-219` | Scrutinizing Sergeant | trigger:play-self, effect:gain-xp |
| `unl-162-219` | Enthralling Protector | keyword:Hunt, effect:buff |
| `unl-163-219` | Mageseeker Investigator | static:must |
| `unl-164-219` | Safety Inspector | play:additional-cost-optional, effect:spend-xp, trigger:play-self, effect:kill, effect:must, effect:each-player |
| `unl-178-219` | Poppy, Defender of the Meek | play:additional-cost-optional, effect:spend-xp, keyword:Ambush, keyword:Tank |
| `unl-191-219` | Wuju Master | static:anthem-might, static:enter-ready |
| `unl-192-219` | Alpha Strike | keyword:Action, effect:deal-damage-variable, effect:split-damage, effect:gain-xp |
| `unl-201-219` | Voidreaver | trigger:win-combat, effect:gain-xp, effect:buff, effect:move, effect:to-base |
| `unl-203-219` | Keeper of the Hammer | trigger:hold, effect:gain-xp, effect:draw |
| `ven-001-166` | Baccai Sandspinner | keyword:Empower, static:cost-mod-self, static:self-keyword |
| `ven-007-166` | Punching Poro | keyword:Empower, static:self-might |
| `ven-014-166` | Shadow Fiend | keyword:Empower, static:self-keyword |
| `ven-018-166` | Rage Amplifier | keyword:Empower, static:anthem-might |
| `ven-021-166` | Akali, Deadly Weapon | keyword:Empower, trigger:move, effect:deal-damage, static:self-might |
| `ven-028-166` | Mournful Witness | trigger:combat-end, effect:empower, static:self-might |
| `ven-030-166` | Serene Ascetic | keyword:Empower, static:self-keyword |
| `ven-031-166` | Twilight Shroud | effect:might-plus, effect:cant-act, keyword:Flow |
| `ven-032-166` | Frostcoat Mother | keyword:Empower, static:cost-mod-self, static:self-might |
| `ven-035-166` | Sanction | keyword:Reaction, effect:empower, effect:disempower |
| `ven-037-166` | Tomb-Raider Barbara | trigger:play-self, effect:kill, effect:disempower |
| `ven-043-166` | Steel Paws | keyword:Deflect, keyword:Empower, static:self-might |
| `ven-045-166` | Helm of Suppression | keyword:Empower, static:cost-mod-other |
| `ven-046-166` | Nasus, Ascended | keyword:Deflect, keyword:Empower, trigger:conquer, effect:score |
| `ven-047-166` | Apprentice Mage | keyword:Empower, trigger:empower, effect:predict, static:self-might |
| `ven-050-166` | Grumpy Rockbear | keyword:Empower, static:cost-mod-self, static:self-keyword |
| `ven-054-166` | Questionable Tome | keyword:Empower, effect:draw |
| `ven-055-166` | Applied Researchers | keyword:Empower, static:cost-mod-other |
| `ven-057-166` | Covert Informant | keyword:Empower, trigger:move, effect:draw |
| `ven-059-166` | Shock Blast | keyword:Action, static:cost-mod-self, effect:deal-damage |
| `ven-062-166` | Hextech Formula | static:enter-exhausted, effect:empower |
| `ven-064-166` | Plaza Guardian | static:cost-mod-self, keyword:Deflect |
| `ven-069-166` | Mel, Newly Awakened | trigger:play-self, effect:draw, keyword:Empower, replacement:would-be-affected, effect:might-minus, effect:cant-act |
| `ven-070-166` | Brutal Hunter | keyword:Empower, static:self-might |
| `ven-072-166` | Guttural Roar | keyword:Action, effect:might-plus, replacement:instead |
| `ven-074-166` | Legion Marauder | keyword:Empower, static:self-might |
| `ven-077-166` | Tools of Empire | keyword:Empower, effect:might-plus |
| `ven-078-166` | Baccai Witherclaw | keyword:Empower, static:self-might, trigger:die, trigger:deathknell, effect:channel |
| `ven-079-166` | Dame the Despoiler | keyword:Empower, trigger:attack, trigger:defend, effect:might-plus, effect:set-might-to-other |
| `ven-081-166` | Onslaught | effect:might-plus, keyword:Flow |
| `ven-082-166` | Profiteer | trigger:play-self, effect:empower, effect:disempower |
| `ven-084-166` | Ambessa, The Wolf | keyword:Empower, static:self-might, static:cant, effect:prevent-damage |
| `ven-086-166` | Gangplank, Naval | keyword:Empower, replacement:would-be-affected, replacement:instead, effect:might-plus, effect:might-minus |
| `ven-092-166` | Renekton, Brute | effect:might-plus, trigger:become-mighty, effect:empower, static:self-keyword |
| `ven-093-166` | Kinkou Lifeblade | keyword:Empower, static:self-might |
| `ven-096-166` | Shadowblade Lurker | static:cost-mod-self |
| `ven-099-166` | Tornado Warrior | keyword:Hidden, trigger:play-self, trigger:play-self-from-facedown, effect:empower, effect:disempower |
| `ven-104-166` | Tail-Cloaked Matriarch | keyword:Empower, trigger:empower, effect:to-base, effect:play-card-from-zone, effect:ignore-cost |
| `ven-110-166` | Mel, Defiant Soul | keyword:Empower, trigger:empower, effect:banish |
| `ven-119-166` | Keeper of Law | static:cost-mod-self |
| `ven-120-166` | Masa, Crashing Thunder | play:additional-cost-optional, trigger:play-self, effect:stun |
| `ven-122-166` | Solari Sunhawk | keyword:Empower, static:self-might |
| `ven-124-166` | Escaped Grayback | keyword:Empower, static:self-might |
| `ven-127-166` | Lacerate | effect:kill, effect:disempower, keyword:Flow |
| `ven-130-166` | Aurok General | keyword:Empower, static:anthem-might |
| `ven-133-166` | Glowstone | keyword:Empower, effect:recall, effect:take-control, effect:choose-player, trigger:phase-end, trigger:phase |
| `ven-134-166` | Kayle, Justified | keyword:Empower, static:empower-rule, static:self-might, static:self-keyword |
| `ven-136-166` | Ambessa, Respected and Feared | keyword:Empower, static:self-keyword, trigger:attack, effect:kill |
| `ven-139-166` | Rogue Assassin | keyword:Empower, effect:ready, effect:move |
| `ven-143-166` | Master of Shadows | trigger:banish, effect:empower, effect:draw, effect:discard |
| `ven-149-166` | Defender of Tomorrow | keyword:Empower, effect:ready |
| `ven-151-166` | Soul's Reflection | trigger:empower, effect:empower, effect:might-minus |
| `ven-153-166` | Matriarch of War | trigger:empower, effect:empower, effect:ready |
| `ven-155-166` | Heart of the Tempest | trigger:play-card, trigger:play-from-nonhand, effect:empower, effect:grant-keyword |

</details>

### B2-equipment-gear-activated (124)

Equipment & gear engines (Equip, attach/detach, Weaponmaster, Quick-Draw, Deploy gear, mana rocks) and activated abilities on units

Types: Gear 97, Unit 21, Spell 4, Legend 1, Battlefield 1. Sets: ogn 21, ogs 1, rad 22, sfd 54, unl 15, ven 11.

<details><summary>cards</summary>

| id | name | key patterns |
|---|---|---|
| `ogn-017-298` | Iron Ballista | static:enter-exhausted, effect:deal-damage |
| `ogn-021-298` | Sun Disc | effect:enter-ready-grant |
| `ogn-023-298` | Unlicensed Armory | effect:exhaust, effect:recall, effect:heal |
| `ogn-032-298` | Ravenborn Tome | effect:bonus-damage, effect:cost-modify-next |
| `ogn-040-298` | Seal of Rage | effect:add-resource |
| `ogn-072-298` | Solari Shrine | trigger:kill, effect:draw |
| `ogn-081-298` | Seal of Focus | effect:add-resource |
| `ogn-090-298` | Orb of Regret | effect:might-minus, effect:might-min-1 |
| `ogn-098-298` | Energy Conduit | effect:add-resource |
| `ogn-099-298` | Garbage Grabber | effect:draw |
| `ogn-101-298` | Mushroom Pouch | trigger:phase-beginning, trigger:phase, effect:draw |
| `ogn-113-298` | Malzahar, Fanatic | effect:add-resource |
| `ogn-120-298` | Seal of Insight | effect:add-resource |
| `ogn-124-298` | Arena Bar | effect:buff |
| `ogn-163-298` | Seal of Strength | effect:add-resource |
| `ogn-181-298` | Pack of Wonders | effect:return-to-hand |
| `ogn-182-298` | Scrapheap | trigger:play-self, trigger:die, trigger:discard, effect:draw |
| `ogn-184-298` | The Syren | effect:move, effect:to-base |
| `ogn-186-298` | Treasure Trove | trigger:leaves-board, effect:draw, effect:channel, effect:kill-self |
| `ogn-204-298` | Seal of Discord | effect:add-resource |
| `ogn-245-298` | Seal of Unity | effect:add-resource |
| `ogs-014-024` | Lux, Crownguard | effect:add-resource |
| `rad-002-167` | Banner of Conquest | keyword:Deploy, static:anthem-keyword |
| `rad-005-167` | Lingering Animus | static:enter-ready, effect:enter-ready-grant |
| `rad-012-167` | Runeblade Anvil | trigger:play-self, trigger:leaves-board, effect:banish, effect:play-card-from-zone, play:from-deck, play:from-banishment |
| `rad-017-167` | Detonation Amplifier | keyword:Deploy, trigger:play-self, effect:kill, effect:draw, static:trigger-doubling |
| `rad-021-167` | Ekko, Revolutionary | static:enter-ready, effect:enter-ready-grant, keyword:Assault, effect:to-base, effect:banish |
| `rad-024-167` | Blossoming Dreamroot | keyword:Deploy, trigger:win-combat, effect:draw |
| `rad-035-167` | Invigorating Bloom | trigger:play-self, effect:might-plus, effect:draw |
| `rad-044-167` | Hunting Blind | keyword:Deploy, trigger:play-self, effect:move, static:anthem-keyword |
| `rad-062-167` | Gravity Field | keyword:Deploy, static:must, trigger:die, trigger:deathknell, effect:draw |
| `rad-069-167` | Zero Point Inflection | trigger:play-card, effect:draw, trigger:draw, effect:kill-self, effect:discard, effect:score |
| `rad-071-167` | Nazuman Ntofo | keyword:Equip |
| `rad-073-167` | Pillaged Armory | keyword:Deploy, trigger:play-self, trigger:conquer, effect:buff |
| `rad-087-167` | Portable Portal | keyword:Deploy, trigger:play-self, effect:ready, static:anthem-keyword |
| `rad-089-167` | Titanic Shrine | trigger:play-card, effect:exhaust, effect:draw |
| `rad-104-167` | Pitiless Stalker | effect:stun |
| `rad-106-167` | The Good Stuff | keyword:Deploy, trigger:play-self, effect:draw, effect:discard, trigger:hold, effect:return-to-hand |
| `rad-108-167` | Bushwhack Trap | keyword:Deploy, static:hide-rule |
| `rad-123-167` | Protector's Shield | keyword:Quick-Draw, keyword:Equip |
| `rad-130-167` | Battlefield Armorer | trigger:die, effect:return-to-hand |
| `rad-136-167` | Dockside Lock-Up | keyword:Deploy, trigger:play-self, effect:banish, trigger:hold, effect:kill-self, effect:play-card-from-zone |
| `rad-146-167` | The Ball | keyword:Deploy, keyword:Ganking, trigger:play-self, trigger:move, effect:deal-damage, effect:draw |
| `rad-150-167` | Blade of the Exile | keyword:Equip |
| `sfd-009-221` | Serrated Dirk | keyword:Equip |
| `sfd-011-221` | Angle Shot | keyword:Reaction, effect:draw, effect:attach, effect:detach |
| `sfd-016-221` | Recurve Bow | keyword:Equip |
| `sfd-022-221` | Long Sword | keyword:Quick-Draw, keyword:Equip |
| `sfd-024-221` | Rell, Magnetic | keyword:Tank, trigger:attack, effect:play-card-from-zone, effect:ignore-cost, effect:attach |
| `sfd-030-221` | Skyfall of Areion | keyword:Equip |
| `sfd-033-221` | Doran's Shield | keyword:Equip |
| `sfd-042-221` | Brutalizer | keyword:Equip |
| `sfd-046-221` | Poro Snax | trigger:play-self, effect:draw |
| `sfd-049-221` | Aphelios, Exalted | trigger:attach, effect:buff, effect:ready, effect:channel |
| `sfd-050-221` | Azir, Ascendant | effect:move, effect:swap-locations, effect:attach |
| `sfd-051-221` | Guardian Angel | keyword:Equip |
| `sfd-052-221` | Heart of Dark Ice | effect:might-plus |
| `sfd-056-221` | Sterak's Gage | keyword:Quick-Draw, keyword:Equip |
| `sfd-059-221` | Svellsongur | keyword:Equip, static:copy, play:as-you-play, effect:copy |
| `sfd-064-221` | Cloth Armor | keyword:Quick-Draw, keyword:Equip |
| `sfd-068-221` | Gearhead | keyword:Accelerate, static:equipment-mod |
| `sfd-073-221` | Experimental Hexplate | keyword:Equip |
| `sfd-078-221` | Temporal Portal | effect:grant-keyword |
| `sfd-083-221` | Hextech Anomaly | effect:add-resource, play:x-cost |
| `sfd-085-221` | Ornn, Forge God | keyword:Deflect, keyword:Weaponmaster, static:self-might |
| `sfd-086-221` | World Atlas | keyword:Equip |
| `sfd-088-221` | Renata Glasc, Mastermind | effect:draw, effect:score, static:activation-restriction |
| `sfd-090-221` | The Zero Drive | keyword:Equip, effect:play-card-from-zone, effect:ignore-cost, play:from-banishment |
| `sfd-095-221` | Doran's Blade | keyword:Equip |
| `sfd-102-221` | Hexdrinker | keyword:Equip |
| `sfd-104-221` | Petricite Monument | keyword:Temporary, static:anthem-keyword |
| `sfd-107-221` | Strike Down | effect:deal-damage-variable, effect:detach |
| `sfd-108-221` | Warmog's Armor | keyword:Equip |
| `sfd-109-221` | Akshan, Mischievous | keyword:Weaponmaster, play:additional-cost-optional, trigger:play-self, effect:move, effect:to-base, effect:take-control |
| `sfd-113-221` | Lucian, Merciless | keyword:Weaponmaster, trigger:conquer, effect:ready |
| `sfd-115-221` | Trinity Force | keyword:Equip |
| `sfd-116-221` | Yone, Blademaster | keyword:Weaponmaster, trigger:conquer, effect:deal-damage-variable |
| `sfd-117-221` | Ancient Henge | effect:add-resource, play:x-cost |
| `sfd-118-221` | Boneshiver | keyword:Equip |
| `sfd-119-221` | Jax, Unrelenting | keyword:Weaponmaster, trigger:attach, effect:draw |
| `sfd-124-221` | Doran's Ring | keyword:Equip |
| `sfd-133-221` | Boots of Swiftness | keyword:Equip |
| `sfd-134-221` | Cull | keyword:Equip |
| `sfd-139-221` | Edge of Night | keyword:Hidden, trigger:play-self, trigger:play-self-from-facedown, effect:attach, keyword:Equip |
| `sfd-144-221` | Spirit Wheel | trigger:chosen, effect:exhaust, effect:draw |
| `sfd-150-221` | Last Rites | keyword:Equip |
| `sfd-153-221` | Eye of the Herald | keyword:Equip |
| `sfd-161-221` | B.F. Sword | keyword:Equip |
| `sfd-169-221` | Altar of Memories | trigger:die, effect:draw, effect:deck-top-bottom, play:from-deck |
| `sfd-172-221` | Sacred Shears | keyword:Equip |
| `sfd-178-221` | Blade of the Ruined King | keyword:Equip |
| `sfd-184-221` | Relentless Pursuit | keyword:Action, effect:move, effect:grant-ability, effect:attach |
| `sfd-186-221` | Spinning Axe | keyword:Quick-Draw, keyword:Equip, keyword:Temporary |
| `sfd-190-221` | Forgefire Cape | keyword:Unique, keyword:Equip |
| `sfd-191-221` | Rabadon's Deathcrown | keyword:Unique, keyword:Equip |
| `sfd-192-221` | Shurelya's Requiem | keyword:Unique, keyword:Equip, trigger:play-self, effect:ready |
| `sfd-193-221` | Grandmaster at Arms | effect:attach, effect:detach |
| `sfd-221-221` | Veiled Temple | trigger:conquer, effect:ready, effect:detach |
| `unl-011-219` | Fresh Beans | trigger:play-card, effect:draw |
| `unl-019-219` | Blighted Battleaxe | keyword:Equip |
| `unl-039-219` | Soul Sword | keyword:Equip |
| `unl-045-219` | Forgotten Signpost | effect:move |
| `unl-049-219` | Honeyfruit | static:enter-exhausted, effect:add-resource |
| `unl-074-219` | Frigid Jewel | trigger:draw, effect:might-plus |
| `unl-085-219` | Sumpworks Map | keyword:Reaction, keyword:Temporary, trigger:score, effect:draw |
| `unl-093-219` | Dragonsoul Sage | effect:add-resource |
| `unl-096-219` | Hunter's Machete | keyword:Equip |
| `unl-138-219` | The List | play:as-you-play, effect:name, effect:might-minus |
| `unl-148-219` | Cursed Sarcophagus | trigger:play-self, effect:banish, play:from-trash, effect:play-card-from-zone, play:from-banishment |
| `unl-158-219` | Shepherd's Heirloom | trigger:play-self, effect:gain-xp, keyword:Equip |
| `unl-161-219` | Divining Shells | keyword:Vision, effect:might-plus |
| `unl-188-219` | Hextech Gauntlets | keyword:Equip, static:cost-mod-self |
| `unl-t05` | Gold | effect:add-resource |
| `ven-011-166` | Pendulum Blade | keyword:Equip |
| `ven-027-166` | Hand Hammer | keyword:Equip |
| `ven-041-166` | Riven, Shattered | keyword:Weaponmaster, trigger:attack, effect:deal-damage, effect:deal-damage-variable, effect:attach |
| `ven-044-166` | Astral Heron | trigger:play-card, trigger:play-card-nth, effect:cost-modify-next |
| `ven-063-166` | Nasus, Guardian of Knowledge | trigger:die, effect:channel |
| `ven-067-166` | Bottled Constellation | trigger:phase-main, trigger:phase, effect:kill, effect:score |
| `ven-073-166` | Jagged Cutlass | keyword:Equip |
| `ven-075-166` | Platewyrm Egg | static:enter-exhausted, keyword:Empower, effect:add-resource |
| `ven-102-166` | Ravenbloom Prefect | trigger:play-card, effect:banish |
| `ven-116-166` | Dragon Form | effect:set-base-might, keyword:Flow |
| `ven-137-166` | Shady Spectacles | keyword:Equip, static:copy, play:as-you-play, effect:copy |

</details>

### B3-tokens-go-wide (130)

Token makers & go-wide: tokens (Recruit, Gold, Mech, Bomb, Sprite, Bird, Sand Soldier, Shadow Clone, Tentacle), anthems, Legion, unit-count conditions

Types: Unit 80, Spell 25, Gear 11, Legend 7, Battlefield 7. Sets: ogn 22, ogs 3, rad 30, sfd 38, unl 27, ven 10.

<details><summary>cards</summary>

| id | name | key patterns |
|---|---|---|
| `ogn-015-298` | Captain Farron | static:anthem-keyword |
| `ogn-020-298` | Scrapyard Champion | trigger:play-self, effect:draw, effect:discard |
| `ogn-031-298` | Raging Firebrand | trigger:play-self, effect:cost-modify-next |
| `ogn-055-298` | Wielder of Water | static:self-might |
| `ogn-074-298` | Taric, Protector | keyword:Shield, keyword:Tank, static:anthem-keyword |
| `ogn-079-298` | Leona, Zealot | static:enter-ready, effect:enter-ready-grant, static:anthem-might, effect:might-min-1 |
| `ogn-094-298` | Sprite Call | keyword:Hidden, keyword:Action, effect:play-token |
| `ogn-100-298` | Gemcraft Seer | keyword:Vision, static:anthem-keyword |
| `ogn-106-298` | Sprite Mother | trigger:play-self, effect:play-token |
| `ogn-117-298` | Viktor, Innovator | trigger:play-card, effect:to-base, effect:play-token |
| `ogn-151-298` | Lee Sin, Centered | keyword:Accelerate, static:anthem-might |
| `ogn-187-298` | Whirlwind | effect:return-to-hand, effect:each-player |
| `ogn-211-298` | Faithful Manufactor | trigger:play-self, effect:play-token |
| `ogn-212-298` | Forge of the Future | trigger:play-self, effect:play-token, effect:recycle, play:from-trash |
| `ogn-216-298` | Soaring Scout | trigger:die, trigger:deathknell, effect:channel |
| `ogn-218-298` | Vanguard Captain | trigger:play-self, effect:play-token |
| `ogn-222-298` | Noxian Drummer | trigger:move, effect:play-token |
| `ogn-239-298` | Machine Evangel | trigger:die, trigger:deathknell, effect:to-base, effect:play-token |
| `ogn-243-298` | Darius, Executioner | trigger:play-self, effect:ready, static:anthem-might |
| `ogn-246-298` | Viktor, Leader | trigger:die, effect:to-base, effect:play-token |
| `ogn-265-298` | Herald of the Arcane | effect:play-token |
| `ogn-275-298` | Altar to Unity | trigger:hold, effect:to-base, effect:play-token |
| `ogs-001-024` | Annie, Fiery | static:damage-mod, effect:bonus-damage |
| `ogs-013-024` | Garen, Commander | static:anthem-might |
| `ogs-015-024` | Recruit the Vanguard | keyword:Action, effect:play-token |
| `rad-001-167` | Amateur Demolitionist | trigger:play-self, effect:play-token |
| `rad-007-167` | Rally for War | effect:play-token |
| `rad-009-167` | Antagonistic Apparatus | static:enter-ready, effect:enter-ready-grant, trigger:play-self, effect:play-token |
| `rad-011-167` | Incorrigible Construct | keyword:Show Off, play:show-off, static:enter-ready, effect:enter-ready-grant |
| `rad-022-167` | Whirling Twirligig | effect:play-token |
| `rad-023-167` | Ziggs, Short-Fused | trigger:play-self, effect:play-token, static:damage-mod, effect:bonus-damage |
| `rad-037-167` | Watchful Curator | static:anthem-keyword |
| `rad-039-167` | Ephemeral Ward | static:anthem-might, trigger:play-card, effect:kill-self |
| `rad-040-167` | Heartening Soul | trigger:play-self, effect:ready, static:anthem-keyword, effect:grant-ability |
| `rad-049-167` | Industrious Mechsmith | trigger:play-self, effect:play-token |
| `rad-052-167` | Resource Extractor | keyword:Deploy, trigger:phase-end, trigger:phase, effect:play-token |
| `rad-055-167` | Clanging Sentry | static:anthem-keyword |
| `rad-063-167` | Kai'Sa, Rebel | keyword:Disarm, static:anthem-keyword |
| `rad-093-167` | Disposal Expert | static:enter-ready, effect:enter-ready-grant, keyword:Disarm |
| `rad-094-167` | Explosimian | trigger:hold, effect:play-token |
| `rad-096-167` | Satchel Charge | keyword:Action, effect:move, effect:play-token |
| `rad-100-167` | The Waters' Wage | keyword:Hidden, effect:play-token, replacement:instead |
| `rad-101-167` | An Offer You Can't Refuse | keyword:Action, effect:kill, effect:play-token |
| `rad-105-167` | Reckless Innovator | keyword:Accelerate, trigger:become-exhausted, effect:draw, effect:play-token |
| `rad-112-167` | Ziggs, Explosive | effect:play-token, trigger:defend, effect:kill, effect:might-plus |
| `rad-116-167` | Concert Poster | keyword:Deploy, trigger:play-self, trigger:conquer, effect:to-base, effect:play-token |
| `rad-119-167` | Hunting Dog | trigger:die, trigger:deathknell, effect:to-base, effect:play-token |
| `rad-127-167` | Rousing Display | keyword:Show Off, play:show-off, effect:to-base, effect:play-token, replacement:instead |
| `rad-132-167` | Heimerdinger, Academy Instructor | replacement:would-play-token, replacement:instead, effect:play-token |
| `rad-138-167` | Seraphine, Not Alone | trigger:play-self, trigger:become-exhausted, effect:to-base, effect:play-token, static:self-might |
| `rad-141-167` | Hexplosives Expert | effect:play-token |
| `rad-142-167` | Hexplosive Minefield | keyword:Action, effect:kill, effect:play-token, effect:delayed-trigger |
| `rad-152-167` | Encore | effect:deal-damage, effect:draw, effect:recycle, effect:play-token, effect:might-plus, effect:look-top |
| `rad-157-167` | Bandle Scouts' Academy | trigger:hide, effect:play-token |
| `rad-159-167` | Black Rose Sanctum | trigger:die, effect:to-base, effect:play-token |
| `sfd-004-221` | Bushwhack | keyword:Hidden, effect:play-token, effect:enter-ready-grant |
| `sfd-019-221` | Assembly Rig | effect:to-base, effect:play-token |
| `sfd-020-221` | Draven, Vanquisher | trigger:win-combat, effect:play-token, trigger:attack, trigger:defend, effect:might-plus |
| `sfd-021-221` | Ferrous Forerunner | trigger:die, trigger:deathknell, effect:to-base, effect:play-token |
| `sfd-026-221` | Rumble, Hotheaded | static:anthem-keyword, trigger:conquer, effect:recycle, effect:play-token, effect:reduce-play-cost, play:from-trash |
| `sfd-029-221` | Rek'Sai, Breacher | keyword:Accelerate, keyword:Assault, static:anthem-keyword |
| `sfd-031-221` | Desert's Call | keyword:Repeat, effect:play-token |
| `sfd-036-221` | Lonely Poro | trigger:die, trigger:deathknell, effect:draw |
| `sfd-054-221` | Jax, Unmatched | keyword:Deflect, static:anthem-keyword |
| `sfd-063-221` | Chemtech Cask | trigger:play-card, effect:play-token |
| `sfd-065-221` | Forecaster | static:anthem-keyword |
| `sfd-069-221` | Plundering Poro | trigger:conquer, effect:play-token |
| `sfd-070-221` | Wages of Pain | keyword:Hidden, keyword:Action, effect:deal-damage, effect:play-token |
| `sfd-071-221` | Breakneck Mech | static:anthem-keyword, static:enter-ready, effect:enter-ready-grant |
| `sfd-074-221` | Pickpocket | trigger:play-self, effect:kill, effect:play-token |
| `sfd-076-221` | Production Surge | static:cost-mod-self, effect:to-base, effect:play-token, effect:draw |
| `sfd-081-221` | Card Sharp | trigger:play-self, effect:play-token, effect:each-player |
| `sfd-089-221` | Rumble, Scrapper | static:anthem-might, trigger:hold, effect:to-base, effect:play-token |
| `sfd-101-221` | Fae Dragon | trigger:play-self, effect:buff, trigger:spend-buff, effect:play-token |
| `sfd-121-221` | Black Market Broker | trigger:play-card, trigger:play-from-facedown, effect:play-token |
| `sfd-130-221` | Treasure Hunter | trigger:move, effect:play-token |
| `sfd-152-221` | Eminent Benefactor | trigger:hold, effect:play-token |
| `sfd-154-221` | Guards! | keyword:Hidden, effect:ready, effect:play-token |
| `sfd-155-221` | Honest Broker | trigger:die, trigger:deathknell, effect:play-token |
| `sfd-157-221` | Royal Guard | trigger:play-self, effect:play-token |
| `sfd-159-221` | Trusty Ramhound | static:self-might |
| `sfd-162-221` | Blood Money | keyword:Action, effect:kill, effect:play-token |
| `sfd-168-221` | Vanguard Armory | effect:play-token |
| `sfd-171-221` | Renata Glasc, Industrialist | static:enter-ready |
| `sfd-174-221` | Trove Golem | trigger:play-self, effect:play-token |
| `sfd-176-221` | Xin Zhao, Vigilant | keyword:Tank, static:enter-ready, effect:to-base, effect:enter-ready-grant |
| `sfd-179-221` | Corina Veraza | keyword:Accelerate, trigger:move, effect:play-token |
| `sfd-181-221` | Mechanized Menace | static:anthem-keyword |
| `sfd-197-221` | Emperor of the Sands | static:anthem-keyword, effect:to-base, effect:play-token |
| `sfd-198-221` | Arise! | effect:ready, effect:play-token |
| `sfd-203-221` | Battle Mistress | trigger:recycle, effect:play-token, trigger:die, effect:ready |
| `sfd-207-221` | Emperor's Dais | trigger:conquer, effect:return-to-hand, effect:play-token |
| `sfd-220-221` | Treasure Hoard | trigger:conquer, effect:play-token |
| `unl-018-219` | Yeti Brawler | trigger:conquer, effect:play-token |
| `unl-033-219` | Frisky Hunter | trigger:play-self, effect:play-token |
| `unl-041-219` | Allay, Eager Admirer | keyword:Deflect, static:anthem-keyword |
| `unl-044-219` | Flurry of Feathers | keyword:Reaction, effect:play-token, effect:counter |
| `unl-048-219` | Trevor Snoozebottom | keyword:Shield, trigger:hold, effect:play-token |
| `unl-058-219` | Lillia, Protector of Dreams | trigger:play-card, effect:might-plus, static:anthem-keyword |
| `unl-069-219` | Sprite Burst | effect:play-token |
| `unl-073-219` | Deadly Flourish | effect:deal-damage, effect:play-token, effect:delayed-trigger |
| `unl-077-219` | Soul Shepherd | static:anthem-might |
| `unl-078-219` | Sprite Fountain | keyword:Temporary, trigger:play-self, effect:to-base, effect:play-token, trigger:die, trigger:deathknell |
| `unl-081-219` | Keeper of Masks | keyword:Hidden, keyword:Temporary, trigger:play-self, effect:play-token, effect:copy |
| `unl-082-219` | Lillia, Fae Fawn | keyword:Accelerate, trigger:move, effect:play-token |
| `unl-084-219` | Sprite Queen | trigger:play-self, trigger:phase-beginning, effect:to-base, effect:play-token |
| `unl-088-219` | Gutter Palace | trigger:phase-beginning, trigger:phase, effect:win-game, effect:play-token |
| `unl-130-219` | Walking Roost | keyword:Deflect, trigger:play-self, effect:play-token, effect:choose-player |
| `unl-145-219` | Pyke, Returned | keyword:Hidden, keyword:Backline, trigger:die, effect:play-token |
| `unl-146-219` | Syndra, Transcendent | static:anthem-keyword |
| `unl-147-219` | Baron Nashor | play:as-you-play, effect:add-battlefield, static:cant, static:anthem-might |
| `unl-153-219` | Carrion Dredger | trigger:die, trigger:deathknell, effect:to-base, effect:play-token |
| `unl-156-219` | Loyal Poro | trigger:die, trigger:deathknell, effect:draw |
| `unl-160-219` | Ultrasoft Poro | effect:play-token |
| `unl-185-219` | Bloodharbor Ripper | effect:return-to-hand, effect:play-token |
| `unl-189-219` | Bashful Bloom | effect:play-token |
| `unl-200-219` | Mirror Image | effect:to-base, effect:play-token, effect:grant-keyword, effect:copy |
| `unl-204-219` | Keeper's Verdict | keyword:Action, effect:deck-top-bottom, play:from-deck |
| `unl-210-219` | Forbidding Waste | static:anthem-might |
| `unl-217-219` | Trapping Grounds | trigger:conquer, effect:play-token |
| `ven-023-166` | Zed, From the Shadows | play:additional-cost-optional, effect:discard, trigger:play-self, effect:play-token |
| `ven-051-166` | Iterative Design | effect:play-token, keyword:Flow |
| `ven-068-166` | Jayce, Brilliant Inventor | trigger:play-self, trigger:play-card-nth, effect:ready |
| `ven-087-166` | Hextech Disc | keyword:Empower, effect:to-base, effect:play-token |
| `ven-100-166` | Up from the Deep | effect:play-token, keyword:Flow |
| `ven-109-166` | Illaoi, Prophet of the Great Kraken | trigger:play-self, trigger:score, effect:play-token, static:self-might |
| `ven-112-166` | Zed, Without a Sound | trigger:conquer, effect:to-base, effect:play-token, effect:move, effect:swap-locations |
| `ven-126-166` | Ki Barrier | keyword:Reaction, replacement:would-be-dealt-damage, effect:prevent-damage |
| `ven-128-166` | Noxian Emissary | keyword:Empower, trigger:die, trigger:deathknell, effect:to-base, effect:play-token |
| `ven-129-166` | Sacred Protector | static:combat-damage-rule |

</details>

### B4-combat-board (132)

Combat, conquer/hold, attack/defend triggers, movement, Ganking, stun, Might statics

Types: Unit 108, Spell 18, Gear 4, Battlefield 2. Sets: ogn 38, ogs 5, rad 18, sfd 22, unl 34, ven 15.

<details><summary>cards</summary>

| id | name | key patterns |
|---|---|---|
| `ogn-011-298` | Magma Wurm | static:enter-ready |
| `ogn-019-298` | Raging Soul | static:self-keyword |
| `ogn-028-298` | Draven, Showboat | static:self-might |
| `ogn-034-298` | Tryndamere, Barbarian | trigger:conquer, effect:score |
| `ogn-035-298` | Vayne, Hunter | keyword:Assault, static:enter-ready, effect:enter-ready-grant, trigger:conquer, effect:return-to-hand |
| `ogn-039-298` | Kai'Sa, Survivor | keyword:Accelerate, trigger:conquer, effect:draw |
| `ogn-043-298` | Charm | effect:move |
| `ogn-050-298` | Rune Prison | keyword:Action, effect:stun |
| `ogn-051-298` | Solari Shieldbearer | trigger:play-self, effect:stun |
| `ogn-060-298` | Mask of Foresight | trigger:attack, trigger:defend, effect:might-plus |
| `ogn-065-298` | Wizened Elder | static:self-might |
| `ogn-066-298` | Ahri, Alluring | trigger:hold, effect:score |
| `ogn-067-298` | Blitzcrank, Impassive | keyword:Tank, trigger:play-self, trigger:play-self-to-battlefield, effect:move, trigger:hold, effect:return-to-hand |
| `ogn-077-298` | Zhonya's Hourglass | keyword:Hidden, replacement:would-die, replacement:instead, effect:kill-self, effect:exhaust, effect:recall |
| `ogn-111-298` | Heimerdinger, Inventor | static:self-keyword, static:copy |
| `ogn-119-298` | Ahri, Inquisitive | trigger:attack, trigger:defend, effect:might-minus, effect:might-min-1 |
| `ogn-125-298` | Bilgewater Bully | static:self-keyword |
| `ogn-131-298` | Dune Drake | trigger:attack, effect:might-plus |
| `ogn-137-298` | Stormclaw Ursine | keyword:Tank, trigger:play-self, effect:channel |
| `ogn-155-298` | Qiyana, Victorious | keyword:Deflect, trigger:conquer, effect:draw, effect:channel |
| `ogn-158-298` | Volibear, Imposing | keyword:Shield, keyword:Tank, trigger:move, effect:draw |
| `ogn-159-298` | Warwick, Hunter | static:enter-ready, effect:enter-ready-grant, trigger:attack, effect:kill |
| `ogn-161-298` | Deadbloom Predator | keyword:Deflect, static:play-location |
| `ogn-162-298` | Miss Fortune, Captain | keyword:Accelerate, keyword:Ganking, trigger:move, effect:ready |
| `ogn-168-298` | Fight or Flight | keyword:Hidden, keyword:Action, effect:move, effect:to-base |
| `ogn-174-298` | Sai Scout | keyword:Vision, static:play-location |
| `ogn-176-298` | Sneaky Deckhand | static:play-location |
| `ogn-177-298` | Stealthy Pursuer | trigger:move |
| `ogn-185-298` | Traveling Merchant | trigger:move, effect:draw, effect:discard |
| `ogn-191-298` | Maddened Marauder | keyword:Tank, trigger:play-self, effect:move, effect:to-base |
| `ogn-193-298` | Miss Fortune, Buccaneer | static:play-location |
| `ogn-199-298` | Tideturner | keyword:Hidden, trigger:play-self, effect:move, effect:swap-locations |
| `ogn-205-298` | Yasuo, Windrider | keyword:Ganking, trigger:move, effect:score |
| `ogn-232-298` | Fiora, Victorious | static:self-keyword |
| `ogn-238-298` | Leona, Determined | keyword:Shield, trigger:attack, effect:stun |
| `ogn-240-298` | Sett, Kingpin | keyword:Tank, static:self-might |
| `ogn-262-298` | Zenith Blade, Leona | keyword:Action, effect:stun, effect:move |
| `ogn-285-298` | Reaver's Row | trigger:defend, effect:move |
| `ogs-004-024` | Master Yi, Meditative | static:self-might |
| `ogs-009-024` | Master Yi, Honed | keyword:Ganking, static:enter-ready, effect:enter-ready-grant |
| `ogs-011-024` | Flash | keyword:Reaction, effect:move |
| `ogs-016-024` | Vanguard Attendant | static:enter-ready, effect:enter-ready-grant |
| `ogs-020-024` | Highlander, Yi | keyword:Reaction, replacement:would-die, replacement:instead, effect:exhaust, effect:recall, effect:heal |
| `rad-026-167` | Entrenched Boar | static:enter-ready, effect:enter-ready-grant, effect:cant-act |
| `rad-031-167` | Stoic Ferryman | keyword:Shield, trigger:play-self, trigger:play-self-to-battlefield, effect:move, effect:to-base |
| `rad-042-167` | Orianna, Exquisite | keyword:Shield, static:combat-damage-rule |
| `rad-045-167` | K'Sante, Dauntless | keyword:Shield, trigger:attack, trigger:defend |
| `rad-072-167` | Overloaded Traveler | static:self-might |
| `rad-076-167` | Sneaky Zeebles | trigger:conquer, effect:add-resource |
| `rad-077-167` | Wrath of the Freljord | static:enter-ready, effect:enter-ready-grant, keyword:Shield |
| `rad-084-167` | Cataclysm | effect:cant-act, effect:move |
| `rad-085-167` | Graves, Blasting Through | trigger:attack, trigger:defend, effect:deal-damage-variable, static:combat-damage-rule |
| `rad-086-167` | K'Sante, Courageous | keyword:Accelerate, keyword:Shield, trigger:hold, effect:channel |
| `rad-091-167` | Jarvan IV, Martial Paragon | static:anthem-keyword, trigger:conquer, effect:channel |
| `rad-098-167` | Siren's Song | keyword:Reaction, effect:move |
| `rad-102-167` | Demon Shade | keyword:Hidden, effect:move, effect:grant-keyword |
| `rad-109-167` | Evelynn, In Control | keyword:Disarm, trigger:hold, effect:score |
| `rad-113-167` | Angler Wyrm | keyword:Deflect, effect:move, effect:must, effect:choose-player |
| `rad-128-167` | Steadfast Outrider | keyword:Tank, static:self-might |
| `rad-133-167` | Jarvan IV, Royal Heir | keyword:Assault, keyword:Tank, trigger:attack, effect:move |
| `rad-156-167` | Demacian Standard | keyword:Deploy, trigger:attack, effect:might-plus, trigger:hold, effect:return-to-hand |
| `sfd-006-221` | Eager Drakehound | static:enter-ready, effect:enter-ready-grant |
| `sfd-015-221` | Perched Grimwyrm | static:play-location |
| `sfd-025-221` | Rengar, Pouncing | keyword:Reaction, keyword:Assault, static:play-location |
| `sfd-027-221` | Dunebreaker | static:enter-ready, effect:enter-ready-grant, trigger:hold, effect:draw |
| `sfd-028-221` | Lucian, Gunslinger | keyword:Assault, trigger:attack, effect:deal-damage-variable |
| `sfd-043-221` | Emperor's Divide | keyword:Hidden, keyword:Action, effect:move, effect:to-base |
| `sfd-048-221` | Stellacorn Herder | trigger:move, effect:draw |
| `sfd-053-221` | Janna, Savior | keyword:Reaction, trigger:play-self, effect:move, effect:to-base, effect:heal |
| `sfd-082-221` | Ezreal, Dashing | trigger:attack, trigger:defend, effect:deal-damage-variable, static:combat-damage-rule, effect:move, effect:to-base |
| `sfd-093-221` | Dauntless Vanguard | static:play-location |
| `sfd-094-221` | Direwing | static:enter-ready, effect:enter-ready-grant |
| `sfd-110-221` | Fiora, Peerless | trigger:attack, trigger:defend, effect:double-might |
| `sfd-123-221` | Corrupt Enforcer | trigger:move, effect:discard, trigger:win-combat, effect:draw |
| `sfd-125-221` | Fae Porter | trigger:move |
| `sfd-126-221` | Loyal Pup | trigger:defend, effect:move |
| `sfd-128-221` | Overzealous Fan | trigger:defend, effect:kill-self, effect:to-base |
| `sfd-129-221` | Temptation | keyword:Repeat, effect:move |
| `sfd-131-221` | Ancient Warmonger | keyword:Accelerate, static:self-keyword |
| `sfd-143-221` | Sivir, Mercenary | keyword:Accelerate, static:self-might |
| `sfd-148-221` | Draven, Audacious | keyword:Deflect, trigger:win-combat, effect:score, trigger:die, effect:choose-player |
| `sfd-173-221` | Soraka, Wanderer | static:must, static:combat-damage-rule, replacement:would-die, replacement:instead, effect:exhaust, effect:recall |
| `sfd-177-221` | Azir, Sovereign | keyword:Accelerate, trigger:attack, effect:move |
| `unl-004-219` | Prepared Neophyte | static:self-might |
| `unl-008-219` | Towering Pairofant | keyword:Assault, static:enter-ready, effect:enter-ready-grant |
| `unl-021-219` | Grim Apothecary | keyword:Ambush, trigger:play-self, effect:return-to-hand |
| `unl-022-219` | Jhin, Murderous Artist | keyword:Deflect, keyword:Ganking, trigger:move, effect:add-resource |
| `unl-037-219` | Shadow Watcher | static:enter-ready, effect:enter-ready-grant |
| `unl-050-219` | Iascylla | trigger:hold, effect:move |
| `unl-054-219` | Tricksy Tentacles | effect:move |
| `unl-055-219` | Vex, Mocking | keyword:Shield, keyword:Tank, trigger:stun, effect:move |
| `unl-060-219` | Vilemaw | keyword:Ambush, static:combat-damage-rule, trigger:hold, effect:draw |
| `unl-065-219` | Icevale Archer | trigger:attack, effect:might-minus |
| `unl-071-219` | Chakram Dancer | keyword:Ambush, trigger:play-self, effect:grant-keyword |
| `unl-076-219` | Petal Pixie | static:self-might |
| `unl-101-219` | Call to Battle | effect:move, effect:choose-player |
| `unl-105-219` | Imposing Challenger | trigger:move, effect:move |
| `unl-112-219` | Irresistible Faefolk | trigger:move, effect:move |
| `unl-114-219` | Nidalee, Cat Form | keyword:Ambush, trigger:win-combat, effect:draw |
| `unl-120-219` | Rengar, Trophy Hunter | keyword:Ambush, static:play-location |
| `unl-124-219` | Isolate | effect:move, effect:to-base, effect:draw |
| `unl-133-219` | Blast Cone | trigger:play-self, effect:move, trigger:you-move-enemy, effect:stun |
| `unl-134-219` | Existential Dread | keyword:Action, keyword:Repeat, effect:stun, effect:return-to-hand, replacement:instead |
| `unl-137-219` | Sinister Poro | trigger:attack, effect:to-base |
| `unl-141-219` | Evelynn, Entrancing | keyword:Hidden, keyword:Backline, trigger:play-self, trigger:play-self-from-facedown, effect:move |
| `unl-150-219` | Vex, Apathetic | keyword:Deflect, trigger:play-card, effect:stun, effect:move, effect:cant-act |
| `unl-152-219` | Black Rose Dignitary | keyword:Assault, trigger:die, trigger:deathknell, effect:channel |
| `unl-154-219` | Crimson Pigeons | static:self-might |
| `unl-170-219` | Atakhan | play:additional-cost-optional, effect:kill, keyword:Ganking, trigger:attack, effect:must |
| `unl-171-219` | Galio, Indefatigable | keyword:Deflect, keyword:Tank, static:combat-damage-rule |
| `unl-175-219` | Tactical Retreat | keyword:Reaction, replacement:would-die, replacement:instead, effect:exhaust, effect:recall, effect:heal |
| `unl-176-219` | Vi, Peacekeeper | keyword:Ambush, trigger:attack, effect:stun |
| `unl-177-219` | Ivern, Friend to All | play:as-you-play, effect:name, effect:gain-tag, trigger:conquer, trigger:hold, effect:score |
| `unl-194-219` | Shadow | static:enter-ready, effect:enter-ready-grant, effect:stun |
| `unl-196-219` | Daisy! | static:enter-ready, effect:enter-ready-grant, static:cost-mod-self, trigger:attack, effect:stun |
| `unl-202-219` | Void Assault | effect:move |
| `unl-207-219` | Amateur Recital | trigger:hold, effect:move, effect:to-base |
| `ven-009-166` | Baccai Reaper | trigger:attack, effect:grant-keyword |
| `ven-013-166` | Shadow Assassin | static:enter-ready, effect:enter-ready-grant |
| `ven-016-166` | Eclipse Dragon | keyword:Accelerate, trigger:move, effect:draw |
| `ven-019-166` | Renekton, Rage Fueled | keyword:Accelerate, trigger:attack, effect:deal-damage |
| `ven-020-166` | Twilight Reveler | trigger:attack, effect:ready |
| `ven-024-166` | Affectionate Poro | trigger:combat-end, effect:draw |
| `ven-042-166` | Shen, Scourge of Shadows | trigger:hold, effect:draw |
| `ven-065-166` | Swain, Visionary | keyword:Vision, trigger:conquer, effect:score |
| `ven-076-166` | Repair Specialist | static:self-keyword |
| `ven-091-166` | Corrupted Dragon | static:enter-ready, effect:enter-ready-grant, trigger:attack, effect:move, effect:to-base |
| `ven-111-166` | Minah Swiftfoot | trigger:move, effect:draw, effect:discard, effect:each-player |
| `ven-115-166` | Ocean Drake | static:play-location, trigger:play-self, effect:return-to-hand |
| `ven-135-166` | Kennen, Keeper of Balance | keyword:Hidden, trigger:play-self, trigger:attack, effect:stun, static:self-might |
| `ven-138-166` | Shen, Leader of the Kinkou Order | keyword:Shield, trigger:hold, effect:score |
| `ven-148-166` | Shadow Dash | effect:move, effect:might-plus, keyword:Flow |

</details>

### B5-removal-spells (135)

Damage, kill, counter & interaction spells (incl. fight, split damage, bounce, control of spells)

Types: Spell 94, Unit 38, Gear 1, Battlefield 2. Sets: ogn 50, ogs 6, rad 18, sfd 20, unl 24, ven 17.

<details><summary>cards</summary>

| id | name | key patterns |
|---|---|---|
| `ogn-005-298` | Disintegrate | keyword:Action, effect:deal-damage, effect:draw |
| `ogn-008-298` | Get Excited! | keyword:Action, effect:deal-damage-variable, effect:discard |
| `ogn-009-298` | Hextech Ray | keyword:Action, effect:deal-damage |
| `ogn-014-298` | Sky Splitter | keyword:Action, static:cost-mod-self, effect:deal-damage |
| `ogn-022-298` | Thermo Beam | keyword:Action, effect:kill |
| `ogn-024-298` | Void Seeker | keyword:Action, effect:deal-damage, effect:draw |
| `ogn-029-298` | Falling Star | effect:deal-damage |
| `ogn-033-298` | Shakedown | keyword:Reaction, effect:deal-damage, effect:draw |
| `ogn-041-298` | Volibear, Furious | keyword:Deflect, trigger:attack, effect:deal-damage, effect:deal-damage-variable, effect:split-damage |
| `ogn-045-298` | Defy | keyword:Reaction, effect:counter |
| `ogn-056-298` | Adaptatron | trigger:conquer, effect:kill, effect:buff |
| `ogn-064-298` | Wind Wall | keyword:Reaction, effect:counter |
| `ogn-068-298` | Caitlyn, Patrolling | static:must, static:combat-damage-rule, effect:deal-damage-variable |
| `ogn-076-298` | Yasuo, Remorseful | trigger:attack, effect:deal-damage-variable |
| `ogn-080-298` | Mystic Reversal | keyword:Reaction, effect:gain-control-spell |
| `ogn-085-298` | Falling Comet | keyword:Action, effect:deal-damage |
| `ogn-092-298` | Riptide Rex | trigger:play-self, effect:deal-damage |
| `ogn-104-298` | Retreat | keyword:Reaction, effect:return-to-hand, effect:channel |
| `ogn-105-298` | Singularity | effect:deal-damage |
| `ogn-123-298` | Unchecked Power | effect:deal-damage, effect:exhaust |
| `ogn-127-298` | Cannon Barrage | keyword:Reaction, effect:deal-damage |
| `ogn-128-298` | Challenge | keyword:Action, effect:deal-damage-variable, effect:fight |
| `ogn-130-298` | Crackshot Corsair | trigger:attack, effect:deal-damage |
| `ogn-133-298` | Flurry of Blades | keyword:Reaction, effect:deal-damage |
| `ogn-145-298` | Unyielding Spirit | keyword:Reaction, effect:prevent-damage |
| `ogn-148-298` | Anivia, Primal | trigger:attack, effect:deal-damage |
| `ogn-149-298` | Carnivorous Snapvine | trigger:play-self, effect:deal-damage-variable, effect:fight |
| `ogn-169-298` | Gust | keyword:Reaction, effect:return-to-hand |
| `ogn-172-298` | Rebuke | keyword:Action, effect:return-to-hand |
| `ogn-179-298` | Acceptable Losses | keyword:Action, effect:kill, effect:each-player |
| `ogn-188-298` | Zaunite Bouncer | trigger:play-self, effect:return-to-hand |
| `ogn-190-298` | Kog'Maw, Caustic | trigger:die, trigger:deathknell, effect:deal-damage |
| `ogn-208-298` | Cruel Patron | play:additional-cost-mandatory, effect:kill |
| `ogn-209-298` | Cull the Weak | effect:kill, effect:each-player |
| `ogn-213-298` | Hidden Blade | keyword:Hidden, keyword:Action, effect:kill, effect:draw |
| `ogn-221-298` | Imperial Decree | keyword:Action, effect:delayed-trigger, trigger:take-damage, effect:kill |
| `ogn-224-298` | Salvage | keyword:Action, effect:kill, effect:draw |
| `ogn-225-298` | Solari Chief | trigger:play-self, effect:kill, effect:stun |
| `ogn-229-298` | Vengeance | effect:kill |
| `ogn-231-298` | Commander Ledros | play:additional-cost-optional, play:as-you-play, effect:kill, keyword:Deflect, keyword:Ganking |
| `ogn-234-298` | Harnessed Dragon | trigger:play-self, effect:kill |
| `ogn-237-298` | King's Edict | effect:kill, effect:each-player, effect:choose-player |
| `ogn-244-298` | Divine Judgment | effect:recycle, effect:each-player |
| `ogn-248-298` | Icathian Rain, Kai'Sa | effect:deal-damage |
| `ogn-250-298` | Stormbringer, Volibear | effect:deal-damage-variable, effect:move, effect:to-base |
| `ogn-254-298` | Noxian Guillotine, Darius | keyword:Action, effect:kill, replacement:instead |
| `ogn-256-298` | Fox-Fire, Ahri | keyword:Hidden, keyword:Action, effect:kill |
| `ogn-258-298` | Dragon's Rage, Lee Sin | effect:deal-damage-variable, effect:fight, effect:move |
| `ogn-260-298` | Last Breath, Yasuo | keyword:Action, effect:deal-damage-variable, effect:ready |
| `ogn-268-298` | Bullet Time, Miss Fortune | keyword:Action, effect:deal-damage-variable, play:x-cost |
| `ogs-002-024` | Firestorm | effect:deal-damage |
| `ogs-003-024` | Incinerate | keyword:Action, effect:deal-damage |
| `ogs-008-024` | Gentlemen's Duel | keyword:Action, effect:deal-damage-variable, effect:fight, effect:might-plus |
| `ogs-012-024` | Blast of Power | keyword:Action, effect:kill |
| `ogs-018-024` | Tibbers, Annie | trigger:play-self, effect:deal-damage |
| `ogs-022-024` | Final Spark, Lux | keyword:Action, effect:deal-damage |
| `rad-003-167` | Bilgewater Tracker | trigger:play-self, effect:deal-damage |
| `rad-006-167` | Scorched Earth | keyword:Action, effect:deal-damage, effect:deal-damage-variable, effect:split-damage |
| `rad-013-167` | Lost to the Sands | keyword:Action, effect:deal-damage, effect:kill |
| `rad-014-167` | Shimmering Swimmer | play:additional-cost-optional, effect:kill, trigger:play-self, effect:deal-damage |
| `rad-020-167` | Mordekaiser, Twice Slain | keyword:Accelerate, keyword:Assault, replacement:would-die, replacement:instead, effect:kill, effect:exhaust |
| `rad-041-167` | Hush | keyword:Reaction, effect:counter |
| `rad-051-167` | Parallel Convergence | play:additional-cost-mandatory, effect:return-to-hand, effect:deal-damage |
| `rad-056-167` | Improvised Projectile | keyword:Action, effect:deal-damage-variable |
| `rad-059-167` | Supernova | effect:deal-damage, effect:draw |
| `rad-078-167` | Armored Tusker | keyword:Shield, keyword:Tank, trigger:move, effect:deal-damage-variable |
| `rad-079-167` | Avalanche | effect:deal-damage |
| `rad-082-167` | Primordial Roar | keyword:Show Off, play:show-off, effect:deal-damage-variable |
| `rad-083-167` | Stalwart Goatherd | keyword:Shield, trigger:play-self, effect:kill |
| `rad-125-167` | Dune Devourer | play:additional-cost-optional, effect:kill, keyword:Deflect |
| `rad-126-167` | Mournful Spirit | trigger:die, trigger:deathknell, effect:kill |
| `rad-137-167` | Mordekaiser, Dominating | trigger:play-self, trigger:attack, effect:kill, effect:discard |
| `rad-144-167` | Realm of Death | effect:deal-damage-variable, effect:fight, effect:might-plus, effect:might-minus |
| `rad-148-167` | Ntofo Strikes | keyword:Action, effect:deal-damage-variable, effect:grant-keyword |
| `sfd-005-221` | Detonate | effect:kill, effect:draw |
| `sfd-013-221` | Blast Corps Cadet | play:additional-cost-optional, trigger:play-self, effect:deal-damage |
| `sfd-017-221` | Sudden Storm | keyword:Hidden, keyword:Action, effect:deal-damage, replacement:instead |
| `sfd-023-221` | Piercing Light | keyword:Repeat, effect:deal-damage |
| `sfd-032-221` | Disarming Rake | trigger:play-self, effect:kill |
| `sfd-045-221` | Not So Fast | keyword:Reaction, effect:counter |
| `sfd-077-221` | Rocket Barrage | keyword:Repeat, effect:deal-damage, effect:kill |
| `sfd-080-221` | Bellows Breath | keyword:Action, keyword:Repeat, effect:deal-damage |
| `sfd-114-221` | Marching Orders | keyword:Action, keyword:Repeat, effect:deal-damage-variable, effect:fight |
| `sfd-120-221` | Sivir, Ambitious | keyword:Deflect, trigger:conquer, effect:deal-damage-variable |
| `sfd-132-221` | Beast Below | trigger:play-self, effect:return-to-hand |
| `sfd-135-221` | Factory Recall | keyword:Action, effect:return-to-hand |
| `sfd-136-221` | Hard Bargain | keyword:Reaction, keyword:Repeat, effect:counter |
| `sfd-147-221` | Downwell | effect:return-to-hand |
| `sfd-158-221` | Sandshifter | trigger:play-self, effect:kill |
| `sfd-160-221` | Zaun Punk | play:additional-cost-optional, effect:kill, trigger:play-self |
| `sfd-163-221` | Deathgrip | keyword:Reaction, effect:kill, effect:might-plus, effect:draw |
| `sfd-164-221` | Drag Under | keyword:Action, static:cost-mod-self, effect:kill |
| `sfd-200-221` | Arcane Shift | keyword:Action, effect:deal-damage, effect:banish, effect:play-card-from-zone, effect:ignore-cost |
| `sfd-206-221` | Riposte | keyword:Reaction, effect:might-plus, effect:counter |
| `unl-003-219` | Mischievous Marai | keyword:Hidden, trigger:play-self, trigger:play-self-to-battlefield, effect:deal-damage |
| `unl-007-219` | Smite | keyword:Action, replacement:would-die, replacement:instead, effect:deal-damage, effect:banish |
| `unl-014-219` | Monster Harpoon | keyword:Action, effect:deal-damage, replacement:instead |
| `unl-020-219` | Dancing Grenade | effect:deal-damage, effect:bonus-damage, effect:play-card-from-zone, effect:repeat-effect |
| `unl-023-219` | Katarina, Reckless | trigger:hide, effect:ready, trigger:play-card, trigger:play-from-facedown, effect:deal-damage |
| `unl-026-219` | Xerath, Freed | effect:deal-damage |
| `unl-067-219` | Ruined Rex | trigger:die, trigger:deathknell, effect:deal-damage |
| `unl-072-219` | Crescent Strike | keyword:Action, effect:deal-damage |
| `unl-106-219` | Repulse | keyword:Reaction, effect:counter |
| `unl-110-219` | Clash of Giants | effect:deal-damage-variable, effect:fight |
| `unl-118-219` | Elder Dragon | static:combat-damage-rule, trigger:play-self, effect:deal-damage |
| `unl-128-219` | Star-Crossed | keyword:Reaction, effect:return-to-hand |
| `unl-131-219` | Abandon | keyword:Reaction, effect:return-to-hand, effect:counter, replacement:instead, effect:predict |
| `unl-142-219` | Heedless Resurrection | keyword:Reaction, play:additional-cost-mandatory, effect:kill, effect:play-card-from-zone, effect:ignore-cost, play:from-trash |
| `unl-159-219` | Soul Harvest | effect:kill |
| `unl-166-219` | Stalking Wolf | keyword:Ambush, play:additional-cost-mandatory, effect:kill |
| `unl-173-219` | Sacrifice | keyword:Reaction, play:additional-cost-mandatory, effect:kill, effect:draw, effect:channel |
| `unl-174-219` | Shard of Undoing | trigger:die, effect:kill, effect:must, effect:each-player |
| `unl-180-219` | The Ruination | effect:kill |
| `unl-182-219` | Curtain Call | keyword:Repeat, effect:deal-damage, effect:draw, effect:might-minus |
| `unl-186-219` | Death from Below | effect:kill, effect:play-card-from-zone, play:alt-cost, play:from-trash |
| `unl-190-219` | Lilting Lullaby | keyword:Reaction, effect:counter, effect:cant-act |
| `unl-209-219` | Dusk Rose Lab | trigger:phase-beginning, trigger:phase, effect:kill, effect:draw |
| `unl-212-219` | Frozen Fortress | trigger:phase-beginning, trigger:phase, effect:deal-damage |
| `ven-003-166` | Brittle Steel | effect:kill, keyword:Flow |
| `ven-008-166` | Ruthless Strike | keyword:Action, play:additional-cost-optional, effect:discard, effect:deal-damage, replacement:instead |
| `ven-010-166` | Consuming Curse | keyword:Action, effect:deal-damage, effect:bonus-damage |
| `ven-015-166` | Decree of Rage | keyword:Action, effect:cant-act, effect:deal-damage |
| `ven-017-166` | Morgana, Vindictive | keyword:Ambush, trigger:play-self, effect:deal-damage-variable |
| `ven-039-166` | Crumbling Sands | keyword:Reaction, effect:counter |
| `ven-060-166` | Sky Cruiser | effect:deal-damage |
| `ven-080-166` | Noxian Demolitionist | trigger:conquer, effect:kill |
| `ven-083-166` | Rampage | play:additional-cost-optional, play:as-you-play, effect:deal-damage-variable, effect:fight, effect:might-plus |
| `ven-090-166` | Cataclysmic Duel | effect:kill, effect:each-player, effect:choose-player |
| `ven-106-166` | Wind and Ghosts | keyword:Action, effect:return-to-hand, effect:banish |
| `ven-107-166` | Decree of Discord | effect:return-to-hand |
| `ven-131-166` | Decree of Unity | effect:kill |
| `ven-140-166` | Shuriken Flip | effect:deal-damage, effect:move, keyword:Flow |
| `ven-146-166` | Siphoning Strike | effect:deal-damage, effect:channel, effect:delayed-trigger, replacement:instead |
| `ven-152-166` | Rebuttal | keyword:Reaction, effect:counter, effect:gain-control-spell |
| `ven-154-166` | Public Execution | effect:kill, keyword:Flow |

</details>

### B6-pump-ready-buff (135)

Might pumps/debuffs, buff counters, ready/exhaust, keyword grants this turn

Types: Spell 50, Unit 80, Gear 5. Sets: ogn 50, ogs 2, rad 24, sfd 24, unl 21, ven 14.

<details><summary>cards</summary>

| id | name | key patterns |
|---|---|---|
| `ogn-004-298` | Cleave | keyword:Action, effect:grant-keyword |
| `ogn-016-298` | Dangerous Duo | trigger:play-self, effect:might-plus |
| `ogn-027-298` | Darius, Trifarian | trigger:play-card, trigger:play-card-nth, effect:ready, effect:might-plus |
| `ogn-036-298` | Vi, Destructive | keyword:Ganking, effect:might-plus |
| `ogn-046-298` | En Garde | keyword:Reaction, effect:might-plus |
| `ogn-053-298` | Stand United | keyword:Hidden, keyword:Action, effect:buff, effect:might-plus |
| `ogn-058-298` | Discipline | keyword:Reaction, effect:draw, effect:might-plus |
| `ogn-059-298` | Eclipse Herald | trigger:stun, effect:ready, effect:might-plus |
| `ogn-061-298` | Poro Herder | trigger:play-self, effect:buff, effect:draw |
| `ogn-063-298` | Spirit's Refuge | trigger:play-self, effect:buff, static:anthem-keyword |
| `ogn-069-298` | Last Stand | keyword:Action, effect:double-might, effect:grant-keyword |
| `ogn-073-298` | Sona, Harmonious | trigger:phase-end, trigger:phase, effect:ready |
| `ogn-078-298` | Lee Sin, Ascetic | keyword:Shield, effect:buff, static:buff-rule |
| `ogn-082-298` | Whiteflame Protector | trigger:play-self, effect:might-plus |
| `ogn-091-298` | Pit Crew | trigger:play-card, effect:ready |
| `ogn-093-298` | Smoke Screen | keyword:Reaction, effect:might-minus, effect:might-min-1 |
| `ogn-095-298` | Stupefy | keyword:Reaction, effect:draw, effect:might-minus, effect:might-min-1 |
| `ogn-097-298` | Blastcone Fae | keyword:Hidden, trigger:play-self, effect:might-minus, effect:might-min-1 |
| `ogn-103-298` | Ravenbloom Student | trigger:play-card, effect:might-plus |
| `ogn-108-298` | Convergent Mutation | keyword:Reaction, effect:set-might-to-other |
| `ogn-110-298` | Ekko, Recurrent | keyword:Accelerate, trigger:die, trigger:deathknell, effect:ready, effect:recycle |
| `ogn-116-298` | Thousand-Tailed Watcher | keyword:Accelerate, trigger:play-self, effect:might-minus, effect:might-min-1 |
| `ogn-132-298` | First Mate | trigger:play-self, effect:ready |
| `ogn-136-298` | Pit Rookie | trigger:play-self, effect:buff |
| `ogn-139-298` | Cithria of Cloudfield | trigger:play-card, effect:buff |
| `ogn-141-298` | Kinkou Monk | trigger:play-self, effect:buff |
| `ogn-143-298` | Pirate's Haven | trigger:become-ready, effect:might-plus |
| `ogn-146-298` | Wallop | keyword:Action, play:additional-cost-optional, play:as-you-play, effect:spend-buff, effect:ignore-cost, effect:ready |
| `ogn-147-298` | Wildclaw Shaman | trigger:play-self, effect:buff, effect:spend-buff, effect:ready |
| `ogn-150-298` | Kraken Hunter | keyword:Accelerate, keyword:Assault, play:additional-cost-optional, play:as-you-play, effect:spend-buff |
| `ogn-152-298` | Mistfall | trigger:buff, effect:ready, effect:exhaust |
| `ogn-153-298` | Overt Operation | keyword:Action, effect:buff, effect:spend-buff, effect:ready |
| `ogn-154-298` | Primal Strength | keyword:Action, effect:might-plus |
| `ogn-157-298` | Udyr, Wildman | effect:deal-damage, effect:stun, effect:ready, effect:grant-keyword |
| `ogn-164-298` | Sett, Brawler | trigger:play-self, trigger:conquer, effect:buff, effect:might-plus |
| `ogn-167-298` | Ember Monk | trigger:play-card, trigger:play-from-facedown, effect:might-plus |
| `ogn-173-298` | Ride the Wind | keyword:Action, effect:ready, effect:move |
| `ogn-180-298` | Fading Memories | effect:grant-keyword |
| `ogn-197-298` | Teemo, Scout | keyword:Hidden, trigger:play-self, effect:might-plus |
| `ogn-202-298` | Jinx, Rebel | trigger:discard, effect:ready, effect:might-plus |
| `ogn-206-298` | Back to Back | keyword:Reaction, effect:might-plus |
| `ogn-207-298` | Call to Glory | keyword:Reaction, play:additional-cost-optional, play:as-you-play, effect:spend-buff, effect:ignore-cost, effect:might-plus |
| `ogn-217-298` | Trifarian Gloryseeker | trigger:play-self, effect:buff |
| `ogn-223-298` | Peak Guardian | trigger:play-self, effect:buff |
| `ogn-228-298` | Vanguard Helm | trigger:die, effect:buff |
| `ogn-230-298` | Albus Ferros | trigger:play-self, effect:spend-buff, effect:channel |
| `ogn-233-298` | Grand Strategem | keyword:Action, effect:might-plus |
| `ogn-235-298` | Karma, Channeler | keyword:Vision, trigger:recycle, effect:buff |
| `ogn-266-298` | Siphon Power, Viktor | keyword:Reaction, effect:might-plus, effect:might-minus, effect:might-min-1 |
| `ogn-270-298` | Showstopper, Sett | effect:buff, effect:move, effect:to-base |
| `ogs-006-024` | Lux, Illuminated | trigger:play-card, effect:might-plus |
| `ogs-024-024` | Decisive Strike, Garen | keyword:Action, effect:might-plus |
| `rad-004-167` | Brawl | keyword:Action, effect:grant-keyword |
| `rad-008-167` | War Scout | keyword:Accelerate, trigger:play-self, effect:might-plus |
| `rad-027-167` | Iridescent Avian | effect:buff, effect:might-plus |
| `rad-030-167` | Sanctum Conservator | trigger:play-card, effect:ready |
| `rad-032-167` | Battle Preparations | keyword:Reaction, keyword:Show Off, play:show-off, effect:ready, effect:might-plus |
| `rad-034-167` | Hunker Down | keyword:Reaction, effect:ready, effect:draw, effect:cant-act |
| `rad-038-167` | Ahri, Confident | keyword:Disarm, trigger:might-reduced, effect:might-plus |
| `rad-043-167` | Riven, Broken Blade | trigger:become-exhausted, effect:stun, effect:buff, effect:spend-buff, effect:ready |
| `rad-046-167` | Resplendent Rostrum | effect:draw, effect:channel, trigger:become-exhausted, effect:might-plus |
| `rad-048-167` | High Note | keyword:Reaction, effect:might-minus |
| `rad-057-167` | Piltovan Guidebot | trigger:play-card, effect:set-base-might |
| `rad-058-167` | Riptide Mage | keyword:Accelerate, trigger:play-self, effect:might-minus |
| `rad-065-167` | Seraphine, Inspiring | keyword:Disarm, trigger:become-exhausted, effect:draw |
| `rad-066-167` | Spirit of the Forge | play:additional-cost-optional, effect:return-to-hand, trigger:play-self, effect:ready, effect:might-plus |
| `rad-070-167` | Hold 'Em | keyword:Action, static:cost-mod-self, effect:might-plus |
| `rad-081-167` | Elnuk Herd | keyword:Hidden, trigger:play-self, effect:recycle, effect:might-plus |
| `rad-090-167` | Evelynn, Consuming | keyword:Ambush, trigger:play-card, trigger:play-from-facedown, effect:ready, effect:might-plus |
| `rad-110-167` | Lulu, Whimsical | trigger:move, effect:set-base-might |
| `rad-114-167` | Riven, Deserter | trigger:become-exhausted, effect:might-plus, effect:ready |
| `rad-117-167` | For Demacia! | keyword:Reaction, effect:grant-keyword |
| `rad-118-167` | Herald of the Emperor | trigger:play-self, effect:set-base-might |
| `rad-121-167` | One-Two Punch | keyword:Action, effect:stun, effect:buff |
| `rad-131-167` | Demacian Illuminators | trigger:die, effect:buff |
| `rad-134-167` | Raucous Anthem | effect:ready, effect:might-plus |
| `sfd-001-221` | Against the Odds | keyword:Reaction, effect:might-plus |
| `sfd-007-221` | Gem Jammer | trigger:play-self, effect:grant-keyword |
| `sfd-034-221` | Feral Strength | keyword:Reaction, keyword:Repeat, effect:might-plus |
| `sfd-038-221` | Ribbon Dancer | trigger:move, effect:might-plus |
| `sfd-047-221` | Simian Ancestor | trigger:buff, effect:ready |
| `sfd-057-221` | Irelia, Fervent | keyword:Deflect, trigger:become-ready, effect:might-plus |
| `sfd-062-221` | Bubble Bot | trigger:play-self, effect:ready |
| `sfd-066-221` | Frigid Touch | keyword:Reaction, keyword:Repeat, effect:might-minus |
| `sfd-067-221` | Frostcoat Cub | play:additional-cost-optional, trigger:play-self, effect:might-minus |
| `sfd-072-221` | Dropboarder | trigger:play-self, effect:ready |
| `sfd-075-221` | Prize of Progress | trigger:use-gear-ability, effect:might-plus |
| `sfd-091-221` | Buhru Captain | trigger:play-self, effect:buff, effect:draw |
| `sfd-097-221` | Punch First | keyword:Action, effect:might-plus |
| `sfd-098-221` | Sea Monkey | play:additional-cost-optional, trigger:play-self, effect:buff |
| `sfd-112-221` | Kato the Arm | keyword:Deflect, trigger:move, effect:might-plus |
| `sfd-137-221` | Harpoon Squad | trigger:move, effect:might-plus |
| `sfd-145-221` | Switcheroo | keyword:Hidden, keyword:Action, effect:swap-might |
| `sfd-151-221` | Bonds of Strength | keyword:Reaction, keyword:Repeat, effect:might-plus |
| `sfd-166-221` | Rally the Troops | keyword:Action, effect:delayed-trigger, trigger:play-card, effect:buff, effect:draw |
| `sfd-175-221` | Undertitan | trigger:play-self, effect:might-plus, trigger:revealed-from-deck, effect:add-resource |
| `sfd-180-221` | Fiora, Worthy | trigger:become-mighty, effect:ready |
| `sfd-182-221` | Danger Zone | keyword:Reaction, keyword:Repeat, effect:might-plus |
| `sfd-196-221` | Defiant Dance | keyword:Reaction, effect:might-plus, effect:might-minus |
| `sfd-204-221` | On the Hunt | effect:ready |
| `unl-001-219` | Arena Kingpin | static:enter-ready, effect:enter-ready-grant, effect:might-plus |
| `unl-005-219` | Revna the Lorekeeper | keyword:Ganking, trigger:play-card, effect:ready |
| `unl-009-219` | Upstage Comedy | keyword:Repeat, effect:ready |
| `unl-010-219` | Vault Breaker | keyword:Action, effect:grant-keyword |
| `unl-012-219` | Lord Broadmane | keyword:Ambush, trigger:play-self, effect:grant-keyword |
| `unl-027-219` | Inviolus Vox | trigger:conquer, effect:might-plus |
| `unl-028-219` | Pyke, Dockside Butcher | keyword:Hidden, keyword:Ganking, play:additional-cost-optional, trigger:play-self, effect:ready, effect:might-plus |
| `unl-029-219` | Red Brambleback | keyword:Accelerate, static:trigger-doubling, trigger:conquer, effect:buff |
| `unl-030-219` | Vi, Hotheaded | keyword:Deflect, effect:double-might |
| `unl-043-219` | Enthusiastic Promoter | keyword:Backline, trigger:hold, effect:buff |
| `unl-046-219` | Friendship | keyword:Reaction, effect:might-plus |
| `unl-052-219` | Nami, Headstrong | play:additional-cost-optional, trigger:play-self, effect:stun, trigger:hold, effect:buff, effect:ready |
| `unl-056-219` | Yuumi, Magical Cat | trigger:attack, trigger:defend, effect:might-plus, effect:grant-keyword |
| `unl-066-219` | Moonlight Affliction | keyword:Reaction, effect:might-minus |
| `unl-068-219` | Spectral Centaur | trigger:die, effect:might-plus |
| `unl-070-219` | Turn to Dust | effect:grant-keyword |
| `unl-080-219` | Hwei, Brooding Painter | trigger:move, effect:ready, effect:draw, effect:discard, effect:might-plus |
| `unl-104-219` | Gentle Gemdragon | trigger:play-self, trigger:play-card, effect:ready |
| `unl-149-219` | Diana, No Longer Human | keyword:Ambush, trigger:play-card, effect:might-plus |
| `unl-155-219` | Heroic Charge | keyword:Action, effect:stun, effect:might-plus |
| `unl-198-219` | Moonfall | keyword:Action, effect:move, effect:might-minus |
| `ven-005-166` | Forsaken Baccai | trigger:phase-beginning, effect:might-plus |
| `ven-006-166` | Oasis Raider | trigger:phase-beginning, effect:might-plus, effect:grant-keyword |
| `ven-026-166` | Field Musicians | trigger:play-self, effect:might-plus |
| `ven-034-166` | Resonating Strike | keyword:Hidden, keyword:Reaction, effect:move, effect:might-plus |
| `ven-038-166` | Akali, Silent | static:cant, trigger:move, effect:might-plus |
| `ven-040-166` | Decree of Focus | keyword:Reaction, effect:might-plus |
| `ven-052-166` | Mesmerize | keyword:Reaction, effect:return-to-hand, effect:might-minus |
| `ven-061-166` | Decree of Insight | keyword:Reaction, static:cost-mod-self, effect:might-minus |
| `ven-071-166` | Fretful Feline | trigger:become-ready, effect:might-plus |
| `ven-088-166` | Jayce, Hammer in Hand | trigger:become-ready, effect:grant-keyword |
| `ven-121-166` | Reluctant Leader | trigger:play-card, effect:might-plus |
| `ven-125-166` | Hungry Wolf | effect:ready, effect:might-plus |
| `ven-142-166` | Dominus | keyword:Action, effect:double-might, effect:grant-ability |
| `ven-150-166` | Acceleration Gate | effect:ready |

</details>

### B7-cards-zones (135)

Card flow & zones: draw/discard, look/reveal/predict/burn, play from trash/deck/banishment, Flow/Repeat, recycle, Hidden/face-down

Types: Unit 73, Spell 51, Gear 6, Legend 1, Battlefield 4. Sets: ogn 41, ogs 1, rad 25, sfd 22, unl 22, ven 24.

<details><summary>cards</summary>

| id | name | key patterns |
|---|---|---|
| `ogn-003-298` | Chemtech Enforcer | keyword:Assault, trigger:play-self, effect:discard |
| `ogn-006-298` | Flame Chompers | trigger:discard |
| `ogn-025-298` | Blind Fury | keyword:Action, effect:recycle, effect:banish, effect:play-card-from-zone, effect:ignore-cost, effect:reveal-top |
| `ogn-030-298` | Jinx, Demolitionist | keyword:Accelerate, keyword:Assault, trigger:play-self, effect:discard |
| `ogn-037-298` | Immortal Phoenix | keyword:Assault, trigger:kill, effect:play-card-from-zone, play:from-trash |
| `ogn-038-298` | Kadregrin the Infernal | trigger:play-self, effect:draw |
| `ogn-057-298` | Block | keyword:Hidden, keyword:Action, effect:grant-keyword |
| `ogn-062-298` | Reinforce | effect:recycle, effect:banish, effect:play-card-from-zone, effect:reduce-play-cost, effect:look-top, effect:select-from-revealed |
| `ogn-071-298` | Party Favors | effect:draw, effect:channel, effect:each-player, effect:choose-player |
| `ogn-075-298` | Tasty Faefolk | keyword:Accelerate, trigger:die, trigger:deathknell, effect:draw, effect:channel |
| `ogn-083-298` | Consult the Past | keyword:Hidden, keyword:Reaction, effect:draw |
| `ogn-087-298` | Lecturing Yordle | keyword:Tank, trigger:play-self, effect:draw |
| `ogn-096-298` | Watchful Sentry | trigger:die, trigger:deathknell, effect:draw |
| `ogn-102-298` | Portal Rescue | keyword:Action, effect:to-base, effect:banish, effect:play-card-from-zone, effect:ignore-cost |
| `ogn-107-298` | Ava Achiever | trigger:attack, effect:play-card-from-zone, effect:ignore-cost |
| `ogn-109-298` | Dr. Mundo, Expert | static:self-might, trigger:phase-beginning, trigger:phase, effect:recycle, play:from-trash |
| `ogn-112-298` | Kai'Sa, Evolutionary | keyword:Ganking, trigger:conquer, effect:recycle, effect:play-card-from-zone, effect:ignore-cost, play:from-trash |
| `ogn-114-298` | Progress Day | effect:draw |
| `ogn-115-298` | Promising Future | effect:recycle, effect:banish, effect:play-card-from-zone, effect:ignore-cost, effect:look-top, effect:each-player |
| `ogn-118-298` | Wraith of Echoes | trigger:die, effect:draw |
| `ogn-121-298` | Teemo, Strategist | keyword:Hidden, trigger:defend, effect:deal-damage, effect:deal-damage-variable, effect:recycle, effect:reveal-top |
| `ogn-129-298` | Confront | keyword:Action, effect:draw, effect:enter-ready-grant |
| `ogn-134-298` | Mobilize | effect:draw, effect:channel |
| `ogn-138-298` | Catalyst of Aeons | effect:draw, effect:channel |
| `ogn-156-298` | Sabotage | effect:recycle, effect:reveal-hand, effect:select-from-revealed, effect:choose-player |
| `ogn-160-298` | Dazzling Aurora | trigger:phase-end, trigger:phase, effect:recycle, effect:banish, effect:play-card-from-zone, effect:ignore-cost |
| `ogn-165-298` | Cemetery Attendant | trigger:play-self, effect:return-from-trash, play:from-trash |
| `ogn-170-298` | Morbid Return | keyword:Action, effect:return-from-trash, play:from-trash |
| `ogn-178-298` | Undercover Agent | trigger:die, trigger:deathknell, effect:draw, effect:discard |
| `ogn-183-298` | Stacked Deck | keyword:Action, effect:recycle, effect:look-top, play:from-deck |
| `ogn-192-298` | Mindsplitter | trigger:play-self, effect:discard, effect:reveal-hand, effect:select-from-revealed, effect:choose-player |
| `ogn-194-298` | Nocturne, Horrifying | keyword:Ganking, trigger:revealed-from-deck, effect:banish, effect:play-card-from-zone, play:alt-cost |
| `ogn-196-298` | Soulgorger | trigger:play-self, effect:play-card-from-zone, effect:ignore-cost, play:from-trash |
| `ogn-198-298` | The Harrowing | effect:play-card-from-zone, effect:ignore-cost, play:from-trash |
| `ogn-200-298` | Twisted Fate, Gambler | trigger:attack, effect:deal-damage, effect:stun, effect:draw, effect:recycle, effect:reveal-top |
| `ogn-201-298` | Invert Timelines | effect:draw, effect:discard, effect:each-player, effect:discard-hand |
| `ogn-220-298` | Facebreaker | keyword:Hidden, keyword:Action, effect:stun |
| `ogn-226-298` | Spectral Matron | trigger:play-self, effect:play-card-from-zone, effect:ignore-cost, play:from-trash |
| `ogn-242-298` | Baited Hook | effect:kill, effect:recycle, effect:banish, effect:play-card-from-zone, effect:ignore-cost, effect:look-top |
| `ogn-252-298` | Super Mega Death Rocket!, Jinx | effect:deal-damage, trigger:conquer, effect:return-from-trash, effect:discard, play:from-trash |
| `ogn-264-298` | Guerilla Warfare, Teemo | effect:return-from-trash, effect:ignore-cost, play:from-trash |
| `ogs-010-024` | Annie, Stubborn | trigger:play-self, effect:return-from-trash, play:from-trash |
| `rad-010-167` | Forbidden Technique | effect:ready, trigger:play-card, effect:banish, effect:play-card-from-zone, play:alt-cost, play:from-trash |
| `rad-015-167` | Akali, Brash | trigger:move, effect:add-resource, effect:banish, effect:play-card-from-zone, play:from-deck, play:from-banishment |
| `rad-018-167` | Drakehound Packmaster | trigger:play-self, effect:recycle, effect:banish, effect:play-card-from-zone, effect:ignore-cost, effect:reveal-top |
| `rad-025-167` | Consult the Heavens | keyword:Reaction, effect:grant-keyword, effect:predict |
| `rad-033-167` | Command: Attack | effect:move, effect:draw, effect:recycle, effect:look-top, effect:reveal-hand, effect:select-from-revealed |
| `rad-036-167` | Storm Raptor | keyword:Deflect, trigger:die, effect:draw |
| `rad-047-167` | Fanfare | effect:draw, effect:delayed-trigger |
| `rad-050-167` | Mysterious Chronomancer | trigger:play-self, effect:predict, keyword:Disarm |
| `rad-053-167` | Strigian Oracle | trigger:become-exhausted, effect:predict |
| `rad-060-167` | The Empyrean | keyword:Show Off, play:show-off, trigger:play-self, effect:draw, effect:predict |
| `rad-064-167` | Scrutinizing Scope | effect:draw, effect:recycle, effect:reveal-top, effect:choose-player, play:from-deck |
| `rad-067-167` | Clocktower Guardian | trigger:play-self, trigger:hold, effect:predict, trigger:die, trigger:deathknell, effect:banish |
| `rad-074-167` | Raving Witness | trigger:move, effect:draw, effect:recycle, effect:reveal-top, play:from-deck |
| `rad-095-167` | Momentary Companion | keyword:Hidden, trigger:play-self, effect:grant-keyword |
| `rad-099-167` | Suave Negotiator | trigger:play-self, effect:draw, effect:choose-player |
| `rad-103-167` | Gutter Guardian | keyword:Hidden, keyword:Show Off, play:show-off, trigger:play-self, effect:add-resource |
| `rad-107-167` | Bedeviling Stranger | keyword:Hidden, trigger:play-self, effect:return-to-hand |
| `rad-111-167` | Mechanical Bandit | trigger:phase-beginning, trigger:phase, effect:draw, effect:recycle, effect:reveal-top, effect:each-player |
| `rad-115-167` | Transpositionist | effect:return-to-hand, effect:play-card-from-zone, effect:ignore-cost |
| `rad-120-167` | Meticulous Restorationist | trigger:play-card, effect:play-card-from-zone, play:alt-cost, play:from-trash |
| `rad-124-167` | Burn Away | effect:banish, effect:burn |
| `rad-129-167` | Trifarian Captain | trigger:play-self, effect:draw, effect:recycle, effect:look-top, effect:select-from-revealed, play:from-deck |
| `rad-135-167` | Remember the Fallen | effect:play-card-from-zone, effect:ignore-cost, play:from-trash |
| `rad-140-167` | Chronobreak | play:additional-cost-mandatory, play:x-cost, effect:to-base, effect:banish, effect:play-card-from-zone, effect:ignore-cost |
| `rad-154-167` | Last Caress | keyword:Reaction, effect:buff, effect:play-card-from-zone, effect:delayed-trigger |
| `sfd-003-221` | Blood Rush | keyword:Action, keyword:Repeat, effect:grant-keyword |
| `sfd-018-221` | Void Hatchling | replacement:would-reveal, effect:recycle, effect:look-top |
| `sfd-035-221` | Guardian of the Passage | trigger:hold, effect:return-from-trash, play:from-trash |
| `sfd-040-221` | Thwonk! | keyword:Action, keyword:Repeat, effect:stun |
| `sfd-041-221` | Apprentice Smith | trigger:move, effect:draw, effect:recycle, effect:reveal-top, play:from-deck |
| `sfd-058-221` | Ornn, Blacksmith | trigger:play-self, trigger:hold, effect:draw, effect:recycle, effect:look-top, effect:reveal-hand |
| `sfd-061-221` | Aspiring Engineer | trigger:play-self, effect:return-from-trash, play:from-trash |
| `sfd-084-221` | Jayce, Man of Progress | trigger:play-self, effect:kill, effect:play-card-from-zone, effect:ignore-cost |
| `sfd-100-221` | Yordle Explorer | trigger:play-card, effect:draw |
| `sfd-111-221` | Here to Help | keyword:Hidden, keyword:Action, effect:play-card-from-zone, effect:reduce-play-cost |
| `sfd-122-221` | Called Shot | keyword:Action, keyword:Repeat, effect:draw, effect:recycle, effect:look-top, play:from-deck |
| `sfd-138-221` | Windsinger | keyword:Hidden, trigger:play-self, effect:return-to-hand |
| `sfd-140-221` | Fizz, Trickster | trigger:play-self, effect:recycle, effect:play-card-from-zone, effect:ignore-cost, play:from-trash |
| `sfd-142-221` | Jae Medarda | trigger:chosen, effect:draw |
| `sfd-165-221` | Glasc Mixologist | trigger:die, trigger:deathknell, effect:play-card-from-zone, effect:ignore-cost, play:from-trash |
| `sfd-167-221` | Unsung Hero | trigger:die, trigger:deathknell, effect:draw |
| `sfd-170-221` | Rek'Sai, Swarm Queen | trigger:attack, effect:recycle, effect:banish, effect:play-card-from-zone, effect:reveal-top, play:from-deck |
| `sfd-187-221` | Void Burrower | trigger:conquer, effect:recycle, effect:banish, effect:play-card-from-zone, effect:reveal-top, play:from-deck |
| `sfd-188-221` | Void Rush | effect:draw, effect:banish, effect:play-card-from-zone, effect:reduce-play-cost, effect:reveal-top, play:from-deck |
| `sfd-194-221` | Counter Strike | keyword:Reaction, replacement:would-be-dealt-damage, effect:prevent-damage, effect:draw |
| `sfd-212-221` | Minefield | trigger:conquer, effect:mill, play:from-deck |
| `sfd-215-221` | Ravenbloom Conservatory | trigger:defend, effect:recycle, effect:reveal-top, play:from-deck |
| `unl-025-219` | Undying Legion | static:play-from-trash-permission, play:alt-cost, play:from-trash |
| `unl-032-219` | Double Trouble | keyword:Repeat, effect:draw, effect:recycle, effect:look-top, effect:reveal-hand, effect:select-from-revealed |
| `unl-042-219` | Back Off | keyword:Hidden, keyword:Action, effect:stun, effect:draw |
| `unl-051-219` | Ivern, Nurturer | trigger:play-self, trigger:hold, effect:buff, effect:draw, effect:recycle, effect:look-top |
| `unl-061-219` | Downstage Dramatics | keyword:Reaction, keyword:Repeat, effect:draw |
| `unl-062-219` | Dramatic Visionary | trigger:die, trigger:deathknell, effect:predict |
| `unl-064-219` | Fate Weaver | trigger:play-self, effect:draw, effect:recycle, effect:look-top, effect:reveal-hand, effect:select-from-revealed |
| `unl-079-219` | Diana, Lunari | trigger:combat-start, effect:draw, effect:reveal-top, effect:predict, play:from-deck |
| `unl-083-219` | Smoke and Mirrors | keyword:Hidden, keyword:Action, effect:move, effect:swap-locations, effect:draw |
| `unl-089-219` | Jhin, Meticulous Killer | keyword:Vision, play:alt-cost, effect:play-card-from-zone |
| `unl-097-219` | Kinkou Initiate | trigger:play-self, effect:draw |
| `unl-121-219` | Bewitching Spirit | trigger:play-self, effect:discard, effect:choose-player |
| `unl-123-219` | Evershade Stalker | trigger:play-self, effect:draw, effect:discard |
| `unl-139-219` | Bone Skewer | keyword:Hidden, effect:stun, effect:play-card-from-zone, effect:ignore-cost, effect:reveal-hand |
| `unl-165-219` | Shadow's Call | effect:draw, effect:grant-keyword |
| `unl-167-219` | Starhound | trigger:play-self, effect:return-from-trash, play:from-trash |
| `unl-168-219` | Undying Loyalty | static:cost-mod-self, effect:play-card-from-zone, effect:ignore-cost, play:from-trash |
| `unl-169-219` | Ashe, Focused | trigger:play-self, effect:return-to-hand, effect:banish, effect:reveal-hand, effect:select-from-revealed, effect:choose-player |
| `unl-172-219` | LeBlanc, Fragmented | keyword:Assault, trigger:die, trigger:deathknell, effect:draw |
| `unl-179-219` | Rift Herald | trigger:move, effect:draw, effect:recycle, effect:look-top, effect:reveal-hand, effect:select-from-revealed |
| `unl-184-219` | Thrill of the Hunt | keyword:Reaction, effect:banish, effect:play-card-from-zone, effect:ignore-cost |
| `unl-211-219` | Forgotten Library | trigger:play-card, effect:predict |
| `ven-002-166` | Blade Twirler | trigger:move, effect:burn, effect:choose-player |
| `ven-012-166` | Perfect Execution | effect:ready, effect:grant-keyword, keyword:Flow |
| `ven-022-166` | Endless Riches | trigger:play-self, effect:banish, effect:burn, effect:discard-hand, static:turn-structure, effect:skip-phase |
| `ven-033-166` | Pakaa Protector | trigger:move, effect:draw, effect:might-plus, effect:reveal-top, effect:mill, play:from-deck |
| `ven-048-166` | Cloud Drake | trigger:play-self, effect:draw |
| `ven-049-166` | Dredge Up | effect:draw, keyword:Flow |
| `ven-056-166` | Clairvoyance | keyword:Reaction, effect:predict, effect:draw |
| `ven-058-166` | Patched Porobot | trigger:play-self, effect:draw |
| `ven-066-166` | Temporal Breach | keyword:Hidden, effect:banish, effect:play-card-from-zone, effect:ignore-cost |
| `ven-085-166` | Decree of Strength | effect:recycle, effect:reveal-hand, effect:select-from-revealed, effect:choose-player |
| `ven-089-166` | Wild Claw | effect:recycle, effect:banish, effect:play-card-from-zone, effect:reduce-play-cost, effect:look-top, effect:select-from-revealed |
| `ven-094-166` | Mask Mother | trigger:discard, effect:might-plus |
| `ven-095-166` | Shadow Order Disciple | trigger:move, effect:might-plus, effect:burn |
| `ven-098-166` | Stargazer | static:cost-mod-other, play:from-trash |
| `ven-101-166` | Gust Monk | play:additional-cost-optional, trigger:play-self, effect:banish, effect:grant-keyword, play:from-trash |
| `ven-103-166` | Shadows of the Past | effect:return-to-hand, effect:return-from-trash, play:from-trash |
| `ven-105-166` | Twilight Step | effect:move, keyword:Flow |
| `ven-108-166` | Forgotten Relic | trigger:play-self, trigger:phase-beginning, effect:might-plus, effect:burn |
| `ven-113-166` | Kennen, Storm of Shuriken | trigger:play-self, effect:burn, trigger:conquer, effect:grant-keyword |
| `ven-114-166` | Kharox | keyword:Empower, trigger:empower, effect:play-card-from-zone, effect:ignore-cost, effect:burn, effect:choose-player |
| `ven-117-166` | Disciple of Shen | keyword:Hidden, static:self-keyword |
| `ven-144-166` | Death Mark | effect:burn, effect:play-token, keyword:Flow |
| `ven-156-166` | Lightning Rush | effect:draw, effect:look-top, effect:select-from-revealed, effect:mill, play:from-deck, keyword:Flow |
| `ven-165-166` | Shadow Temple | trigger:hold, effect:burn |

</details>

### B8-legends-battlefields-rules (135)

Legends, battlefields, cost/rules-modifying statics, replacement effects, resource abilities, and bespoke weird cards

Types: Unit 31, Spell 3, Gear 1, Legend 40, Battlefield 60. Sets: ogn 43, ogs 4, rad 21, sfd 24, unl 24, ven 19.

<details><summary>cards</summary>

| id | name | key patterns |
|---|---|---|
| `ogn-018-298` | Noxus Saboteur | static:cant, static:hide-rule |
| `ogn-026-298` | Brynhir Thundersong | trigger:play-self, effect:cant-act |
| `ogn-070-298` | Mageseeker Warden | static:cant, static:play-location |
| `ogn-084-298` | Eager Apprentice | static:cost-mod-other |
| `ogn-122-298` | Time Warp | effect:banish, effect:extra-turn |
| `ogn-140-298` | Herald of Scales | static:cost-mod-other |
| `ogn-189-298` | Kayn, Unleashed | keyword:Ganking, static:damage-mod, effect:prevent-damage |
| `ogn-203-298` | Possession | keyword:Action, effect:recall, effect:take-control |
| `ogn-227-298` | Symbol of the Solari | replacement:tie-recall, replacement:instead, effect:recall |
| `ogn-236-298` | Karthus, Eternal | static:trigger-doubling |
| `ogn-247-298` | Daughter of the Void | effect:add-resource |
| `ogn-249-298` | Relentless Storm | trigger:play-card, effect:channel |
| `ogn-251-298` | Loose Cannon | trigger:phase-beginning, trigger:phase, effect:draw |
| `ogn-253-298` | Hand of Noxus | effect:add-resource |
| `ogn-255-298` | Nine-Tailed Fox | trigger:attack, effect:might-minus, effect:might-min-1 |
| `ogn-257-298` | Blind Monk | effect:buff |
| `ogn-259-298` | Unforgiven | effect:move |
| `ogn-261-298` | Radiant Dawn | trigger:stun, effect:buff |
| `ogn-263-298` | Swift Scout | static:cost-mod-other, effect:return-to-hand |
| `ogn-267-298` | Bounty Hunter | effect:grant-keyword |
| `ogn-269-298` | The Boss | replacement:would-die, replacement:instead, effect:spend-buff, effect:exhaust, effect:recall, effect:heal |
| `ogn-276-298` | Aspirant's Climb | static:victory-rule |
| `ogn-277-298` | Back-Alley Bar | trigger:move, effect:might-plus |
| `ogn-278-298` | Bandle Tree | static:hide-rule |
| `ogn-279-298` | Fortified Position | trigger:defend, effect:grant-keyword |
| `ogn-280-298` | Grove of the God-Willow | trigger:hold, effect:draw |
| `ogn-281-298` | Hallowed Tomb | trigger:hold, effect:return-from-trash, play:from-trash |
| `ogn-282-298` | Monastery of Hirana | trigger:conquer, effect:spend-buff, effect:draw |
| `ogn-283-298` | Navori Fighting Pit | trigger:hold, effect:buff |
| `ogn-284-298` | Obelisk of Power | trigger:phase-beginning, trigger:phase, effect:channel |
| `ogn-286-298` | Reckoner's Arena | trigger:hold, effect:repeat-effect |
| `ogn-287-298` | Sigil of the Storm | trigger:conquer, effect:recycle, effect:must |
| `ogn-288-298` | Startipped Peak | trigger:hold, effect:channel |
| `ogn-289-298` | Targon's Peak | trigger:conquer, effect:ready, effect:delayed-trigger |
| `ogn-290-298` | The Arena's Greatest | trigger:phase-beginning, trigger:phase, effect:score |
| `ogn-291-298` | The Candlelit Sanctum | trigger:conquer, effect:recycle, effect:look-top, effect:deck-top-bottom, effect:shuffle-or-order, play:from-deck |
| `ogn-292-298` | The Dreaming Tree | trigger:chosen, effect:draw |
| `ogn-293-298` | The Grand Plaza | trigger:hold, effect:win-game |
| `ogn-294-298` | Trifarian War Camp | static:anthem-might |
| `ogn-295-298` | Vilemaw's Lair | static:cant |
| `ogn-296-298` | Void Gate | static:damage-mod, effect:bonus-damage |
| `ogn-297-298` | Windswept Hillock | static:anthem-keyword |
| `ogn-298-298` | Zaun Warrens | trigger:conquer, effect:draw, effect:discard |
| `ogs-017-024` | Dark Child, Starter | trigger:phase-end, trigger:phase, effect:ready |
| `ogs-019-024` | Wuju Bladesman, Starter | static:anthem-might |
| `ogs-021-024` | Lady of Luminosity, Starter | trigger:play-card, effect:draw |
| `ogs-023-024` | Might of Demacia, Starter | trigger:conquer, effect:draw |
| `rad-016-167` | Coalesced Energy | trigger:phase-end, trigger:phase, effect:channel, effect:recycle |
| `rad-019-167` | Firebrand Raider | static:enter-ready, effect:enter-ready-grant, trigger:play-self, effect:ready, static:cant, static:turn-structure |
| `rad-068-167` | Orianna, Mechanical Marvel | static:cost-mod-other |
| `rad-092-167` | Seraphic Wyvern | replacement:would-channel, replacement:instead, effect:channel |
| `rad-139-167` | Boy Who Shattered Time | keyword:Empower, effect:reduce-play-cost, effect:grant-ability, effect:cost-modify-next |
| `rad-143-167` | Iron Revenant | effect:add-resource |
| `rad-145-167` | Lady of Clockwork | trigger:phase-main, trigger:phase, effect:become-unit |
| `rad-147-167` | Pride of Nazumah | effect:grant-ability |
| `rad-149-167` | The Exile | static:enter-ready |
| `rad-151-167` | Starry-Eyed Songstress | play:additional-cost-optional |
| `rad-153-167` | Agony's Embrace | trigger:play-card, trigger:play-from-facedown, effect:draw, effect:discard |
| `rad-155-167` | Exemplar of Demacia | trigger:play-card |
| `rad-158-167` | Black Market | effect:draw, effect:each-player |
| `rad-160-167` | Cosmic Vista | trigger:hold, effect:score |
| `rad-161-167` | Durand Memorial | trigger:defend, effect:grant-keyword |
| `rad-162-167` | Firelights' Hideout | trigger:conquer |
| `rad-163-167` | Hunters' Circle | static:cost-mod-other |
| `rad-164-167` | Packed Amphitheater | static:anthem-might |
| `rad-165-167` | Rakelstake | trigger:play-card-nth, effect:predict |
| `rad-166-167` | Ruined Monastery | trigger:conquer, effect:discard, effect:channel |
| `rad-167-167` | Neeko, Blending In | trigger:play-self |
| `sfd-014-221` | Minotaur Reckoner | static:cant |
| `sfd-060-221` | Tianna Crownguard | keyword:Deflect, static:cant, static:victory-rule |
| `sfd-105-221` | Ruin Runner | static:cant |
| `sfd-141-221` | Irelia, Graceful | static:cost-mod-other |
| `sfd-146-221` | Vex, Cheerless | static:cost-mod-other |
| `sfd-149-221` | Ezreal, Prodigy | trigger:play-self, effect:draw, effect:discard, static:cost-mod-other |
| `sfd-183-221` | Purifier | static:anthem-keyword, static:equipment-mod |
| `sfd-185-221` | Glorious Executioner | trigger:win-combat, effect:draw |
| `sfd-189-221` | Fire Below the Mountain | effect:add-resource |
| `sfd-195-221` | Blade Dancer | trigger:chosen, effect:ready, trigger:conquer |
| `sfd-199-221` | Prodigal Explorer | effect:draw |
| `sfd-201-221` | Chem-Baroness | trigger:hold, effect:play-token, static:resource-mod, effect:add-resource |
| `sfd-202-221` | Hostile Takeover | keyword:Hidden, effect:ready, effect:take-control, effect:recall, effect:lose-control |
| `sfd-205-221` | Grand Duelist | trigger:become-mighty, effect:channel |
| `sfd-208-221` | Forge of the Fluft | static:anthem-keyword, effect:grant-ability |
| `sfd-209-221` | Forgotten Monument | static:cant, static:victory-rule |
| `sfd-210-221` | Hall of Legends | trigger:conquer, effect:ready |
| `sfd-211-221` | Marai Spire | static:cost-mod-other |
| `sfd-213-221` | Ornn's Forge | static:cost-mod-other |
| `sfd-214-221` | Power Nexus | trigger:hold, effect:score |
| `sfd-216-221` | Rockfall Path | static:cant, static:play-location |
| `sfd-217-221` | Seat of Power | trigger:conquer, effect:draw |
| `sfd-218-221` | Sunken Temple | trigger:conquer, effect:draw |
| `sfd-219-221` | The Papertree | trigger:hold, effect:channel, effect:each-player |
| `unl-057-219` | Alpha Wildclaw | keyword:Tank, static:cant |
| `unl-086-219` | Zilean, Time Mage | replacement:would-play-token, replacement:instead, effect:play-token, effect:copy |
| `unl-087-219` | Blue Sentinel | keyword:Shield, static:trigger-doubling, trigger:hold, effect:add-resource |
| `unl-090-219` | LeBlanc, Everywhere at Once | keyword:Backline, static:trigger-doubling |
| `unl-111-219` | Determined Sentry | static:cant |
| `unl-144-219` | Maduli the Gatekeeper | static:cant, effect:move |
| `unl-181-219` | Virtuoso | trigger:play-card, effect:draw, effect:channel, effect:banish, play:from-banishment |
| `unl-183-219` | Pridestalker | trigger:play-card, effect:might-plus |
| `unl-187-219` | Piltover Enforcer | trigger:conquer, effect:ready |
| `unl-193-219` | Gloomist | trigger:hold, effect:draw |
| `unl-195-219` | Green Father | trigger:conquer, trigger:hold, effect:replace-battlefield |
| `unl-197-219` | Scorn of the Moon | effect:add-resource |
| `unl-199-219` | Deceiver | trigger:conquer, trigger:hold, effect:exhaust, effect:discard, effect:play-token, effect:grant-keyword |
| `unl-205-219` | Abandoned Hall | trigger:play-card, effect:might-plus |
| `unl-206-219` | Altar of Blood | replacement:would-die, replacement:instead, effect:exhaust, effect:recall, effect:heal |
| `unl-208-219` | Black Flame Altar | static:anthem-keyword |
| `unl-213-219` | Gardens of Becoming | static:anthem-keyword, effect:grant-ability |
| `unl-214-219` | Ripper's Bay | trigger:returned-to-hand, effect:channel |
| `unl-215-219` | Star Spring | trigger:play-card-nth, effect:move, effect:to-base |
| `unl-216-219` | The Academy | trigger:hold, effect:to-base, effect:grant-keyword |
| `unl-218-219` | Valley of Idols | trigger:play-card, effect:buff |
| `unl-219-219` | Vaults of Helia | trigger:hold |
| `unl-t01` | Baron Pit | static:play-location |
| `unl-t03` | Brush | static:anthem-might, trigger:score, effect:replace-battlefield |
| `ven-004-166` | Dune Surfer | static:cost-mod-other, static:combat-damage-rule |
| `ven-025-166` | Esteemed Hierophant | replacement:would-be-dealt-damage, effect:prevent-damage |
| `ven-029-166` | Ol' Poro | effect:cant-act |
| `ven-036-166` | Sandstone Chimera | static:cant, static:turn-structure |
| `ven-053-166` | Otterpus | replacement:would-score, replacement:instead, effect:draw, effect:score |
| `ven-097-166` | Spiderling | keyword:Hidden, static:self-might, static:deck-rule |
| `ven-132-166` | Fallen Feline | trigger:play-self, effect:name, static:cant |
| `ven-141-166` | Butcher of the Sands | effect:add-resource |
| `ven-145-166` | Curator of the Sands | trigger:play-card, effect:ready |
| `ven-147-166` | Eye of Twilight | effect:grant-keyword |
| `ven-157-166` | Dragon Roost | static:grant-play-option |
| `ven-158-166` | Heisho, Shell of the World | static:cost-mod-other |
| `ven-159-166` | Kinkou Temple | static:anthem-might |
| `ven-160-166` | Mystic Vortex | static:cost-mod-other |
| `ven-161-166` | Piltovan Forge | static:cost-mod-other |
| `ven-162-166` | Protective Sands | trigger:conquer, effect:draw |
| `ven-163-166` | Risen Altar | keyword:Empower |
| `ven-164-166` | Sandswept Tomb | static:cost-mod-other |
| `ven-166-166` | Threshold of the Gray | trigger:combat-start, effect:add-resource |

</details>

### B0-keywords-only

`ogn-001-298` Blazing Scorcher, `ogn-010-298` Legion Rearguard, `ogn-013-298` Pouty Poro, `ogn-052-298` Stalwart Poro, `ogn-054-298` Sunlit Guardian, `ogn-086-298` Jeweled Colossus, `ogn-135-298` Pakaa Cub, `ogn-171-298` Mystic Poro, `ogn-210-298` Daring Poro, `ogn-215-298` Petty Officer, `ogn-241-298` Shen, `ogs-005-024` Zephyr Sage, `ogs-007-024` Garen, `rad-054-167` Trinket Peddler, `rad-088-167` Staunch Survivor, `rad-097-167` Siren of the Shallows, `sfd-002-221` Armed Assailant, `sfd-008-221` Sentinel Adept, `sfd-037-221` Navori Scout, `sfd-092-221` Combat Chef, `sfd-096-221` Laurent Bladekeeper, `sfd-099-221` Veteran Poro, `sfd-127-221` Master Bingwen, `sfd-156-221` Laurent Duelist, `unl-002-219` Inferna, `unl-006-219` Sharkling, `unl-024-219` Rengar, `unl-036-219` Mutated Mouser, `unl-099-219` Towering Combatant, `unl-100-219` Voracious Gromp, `unl-t02` Bird, `unl-t07` Sprite, `ven-118-166` Horns of the Dragon, `ven-123-166` Soulspinner
<!-- /GENERATED:BATCHES -->

# Card data audit (2026-11-25)

Goal: data/cards.json must match the current official (post-errata) card text and stats. Corrections live in
`data/overrides.json` (`{ cardId: { field: value, ..., source } }`), applied by `tools/build-cards.ts` after the keyword pass;
rebuild with `npx tsx tools/build-cards.ts && npx tsx tools/analyze-cards.ts && npx tsx tools/build-cards.ts`.
147 cards are overridden.

## Method

1. **Errata.** Every `hasErrata` printing (71 distinct old/new pairs) compared with the official articles:
   [Origins errata](https://playriftbound.com/en-us/news/rules-and-releases/riftbound-origins-card-errata/) (2025-10-28),
   [Spiritforged errata](https://playriftbound.com/en-us/news/rules-and-releases/riftbound-spiritforged-errata) (2026-01-14; also covers Falling Star, Icathian Rain, Reinforce),
   [Unleashed errata updates](https://playriftbound.com/en-us/news/rules-and-releases/unleashed-errata-updates/) (2026-04-03),
   [Vendetta errata updates](https://playriftbound.com/en-us/news/announcements/vendetta-errata-updates) (2026-07-23),
   [Radiance errata updates](https://playriftbound.com/en-us/news/announcements/radiance-errata-updates) (2026-10-09),
   plus the cumulative list at <https://riftbound.gg/rules/errata/>. All match except the four rows marked "errata" in table A
   (LeBlanc, Deceiver's errata was missing entirely).
2. **Bulk stats, OGN/OGS/SFD/UNL/VEN.** Name, type, Energy, Might, Power, domains and tags of every canonical card compared with the
   Riftcodex API (`https://api.riftcodex.com/cards?set_id=<set>`). Only mismatch: Whirlwind (`ogn-187-298`) Energy 3 there and on
   cardsrealm; the printed card in the official gallery shows **4**, so our data is right and was not changed. Not reached in bulk:
   `unl-022-219` Jhin, `ven-087-166` Hextech Disc, `ven-101-166` Gust Monk (Riftcodex paging skipped them).
   Riftcodex does not record an Equipment's Might bonus, so Gear Might was checked from the card images instead (section B).
3. **Radiance.** Riftcodex has no Radiance set and other databases are image-only or block fetching, so every RAD card image
   (`data/images/rad-*.webp`, the official gallery art) was read: cost, power pips, Might, domain colour, type line and the full
   rules box of all 173 cards (incl. legends and battlefields). Energy/Power/Might and rules text were all correct except
   Rousing Display; **domains were wrong on 24 cards and tags on ~80** (table C). The scrape's `Device` tag on 17 RAD gear is not
   printed on any card and no text refers to it, so it was removed.
4. **Equipment.** All 43 Equipment images read. The scrape drops the printed bottom band (the ability the equipped unit gets);
   34 cards have one (table B). The other 9 bands are flavour text or empty (Long Sword, Sterak's Gage, Svellsongur,
   Doran's Blade, Edge of Night, B.F. Sword, Blade of the Ruined King, Spinning Axe, Shepherd's Heirloom).
5. **Consistency scan** of all 1103 cards (units without Might, missing domains, unbalanced brackets, stray characters,
   unbracketed keywords), each hit checked against the card image.

## New fields (src/engine/types.ts `CardDef`)

- `additionalTypes?: CardType[]`: Patched Porobot (`ven-058-166`) is printed **UNIT GEAR** (a "Gear Unit", per
  [The Radiance Overview](https://playriftbound.com/en-us/news/announcements/the-radiance-overview/)). It stays `type: 'Unit'` with
  `additionalTypes: ['Gear']`. **Engine needs:** `isGear()` / gear counts / "other gear" checks must consult it.
- `attachedReminderText` / `attachedText` (Equipment only): the printed band. "I/me" there means the equipped unit. **UI needs:**
  show it in the card zoom panel. **Scripts need:** implement it as an ability the equipped unit has while attached.

## Not changed (checked, data already right)

- 16 printings-differ warnings (data/build-warnings.txt): the canonical text is the errata'd one for Rengar, Trophy Hunter,
  Teemo, Strategist and Karma, Channeler (the Spiritforged/Vendetta showcase reprints still print the pre-errata wording). The rest are
  punctuation or icon-vs-word differences, except three where the newest printing reworded the card. Those three now use the newest
  wording (Sett, Brawler; Lux, Crownguard; Viktor, Innovator; table A). Emperor of the Sands keeps "Your Sand Soldiers have
  [Weaponmaster]" (rare printing; the overnumbered sfd-247 says "Sand Soldiers you play have"; same effect in practice).
- The Zero Drive (`sfd-090-221`): "units banished with this" is explained by its band "[Deathknell] — Banish me." (table B).
- Risen Altar (`ven-163-166`): text is correct; "[Empower] costs" is a noun use, so the intrinsic `Empower` keyword was removed.
- Patched Porobot is **not** a Spell; its second type is Gear.
- Edge of Night (`sfd-139-221`): the errata puts "(here)" in parentheses; it stays in `reminderText`, and `text` drops it like
  every other parenthetical.

## Corrections

### A. Rules text, keywords and types

| card | field | was | now | source |
|---|---|---|---|---|
| `ogn-029-298` Falling Star | reminderText | "Deal 3 to a unit." | "Deal 3 to a unit.\nDeal 3 to a unit." | Spiritforged errata (2026-01-14) https://playriftbound.com/en-us/news/rules-and-releases/riftbound-spiritforged-errata: Falling Star new text is "Deal 3 to a unit." printed twice (scrape collapsed the duplicate line) |
| `ogn-248-298` Icathian Rain, Kai'Sa | reminderText | "Deal 2 to a unit." | "Deal 2 to a unit.\nDeal 2 to a unit.\nDeal 2 to a unit.\nDeal 2 to a unit.\nDeal 2 to a unit.\nDeal 2 to a unit." | Spiritforged errata (2026-01-14) https://playriftbound.com/en-us/news/rules-and-releases/riftbound-spiritforged-errata: Icathian Rain new text is "Deal 2 to a unit." six times (scrape collapsed duplicates) |
| `unl-199-219` Deceiver | reminderText | "When you conquer or hold, you may discard 1 and exhaust me to play a ready Reflection unit token there. It becomes a copy of another unit there. Give it [Temporary]." | "When you conquer or hold, you may discard 1 and exhaust me to play a ready Reflection unit token there. Then do this: It becomes a copy of another unit there. Give it [Temporary]." | Unleashed errata (2026-04-03) https://playriftbound.com/en-us/news/rules-and-releases/unleashed-errata-updates/: LeBlanc, Deceiver gains "Then do this:" (missing from scrape) |
| `unl-199-219` Deceiver | hasErrata | false | true | Unleashed errata (2026-04-03) https://playriftbound.com/en-us/news/rules-and-releases/unleashed-errata-updates/: LeBlanc, Deceiver gains "Then do this:" (missing from scrape) |
| `ogn-005-298` Disintegrate | reminderText | "Action (Play on your turn or in showdowns.)\nDeal 3 to a unit at a battlefield. If this kills it, do this: draw 1." | "[Action] (Play on your turn or in showdowns.)\nDeal 3 to a unit at a battlefield. If this kills it, do this: draw 1." | Origins errata https://playriftbound.com/en-us/news/rules-and-releases/riftbound-origins-card-errata/ prints the keyword without brackets (article typo); printed card official card gallery https://playriftbound.com/en-us/card-gallery/#card-gallery--ogn-005-298 (printed card image https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/a27374ac3a81f3dfefb43c3c3237c23b4883cb5a-744x1039.png) has the [Action] keyword |
| `rad-127-167` Rousing Display | reminderText | "[Show Off] a card with Energy cost [7] or more. (As you play this, you may reveal such a card from hand or pick a friendly one.)\nPlay two 1 [S] Recruit unit tokens to your base. If you showed off, play four to your base instead.disa" | "[Show Off] a card with Energy cost [7] or more. (As you play this, you may reveal such a card from hand or pick a friendly one.)\nPlay two 1 [S] Recruit unit tokens to your base. If you showed off, play four to your base instead." | official card gallery https://playriftbound.com/en-us/card-gallery/#card-gallery--rad-127-167 (printed card image https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/18aa7cab082fd0e293260bcf480a1a76d12b64d9-744x1039.png): stray "disa" after the final sentence is not on the card |
| `ven-109-166` Illaoi, Prophet of the Great Kraken | reminderText | "When you play me or when I score, play a [1] [S] Tentacle unit token from Bilgewater.\nI have +1 [S] for each token unit you control." | "When you play me or when I score, play a 1 [S] Tentacle unit token from Bilgewater.\nI have +1 [S] for each token unit you control." | official card gallery https://playriftbound.com/en-us/card-gallery/#card-gallery--ven-109-166 (printed card image https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/86fccf469e67fb89312e0c860842e2801a8b12e7-744x1039.png): token is "a 1 [S] Tentacle unit token" (Might 1), not "[1] [S]" |
| `ven-163-166` Risen Altar | keywords | ["Empower"] | [] | official card gallery https://playriftbound.com/en-us/card-gallery/#card-gallery--ven-163-166 (printed card image https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/47402ed9d5eebb9e38176315bdaf1a556845eef7-1039x744.png): "[Empower] costs" uses Empower as a noun (reduces Empower costs of your units here); the battlefield has no Empower keyword |
| `ven-163-166` Risen Altar | keywordCosts | {"Empower": "costs of your units here cost [1] or [A] less."} | {} | official card gallery https://playriftbound.com/en-us/card-gallery/#card-gallery--ven-163-166 (printed card image https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/47402ed9d5eebb9e38176315bdaf1a556845eef7-1039x744.png): "[Empower] costs" uses Empower as a noun (reduces Empower costs of your units here); the battlefield has no Empower keyword |
| `sfd-096-221` Laurent Bladekeeper | reminderText | "Ganking (I can move from battlefield to battlefield.)" | "[Ganking] (I can move from battlefield to battlefield.)" | official card gallery https://playriftbound.com/en-us/card-gallery/#card-gallery--sfd-096-221 (printed card image https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/d9dac8bbc898bfead8338ef387f2d144302e278f-744x1039.png): keyword printed as a keyword box; restore brackets |
| `sfd-138-221` Windsinger | reminderText | "Hidden (Hide now for [A] to react with later for [0].)\nWhen you play me, you may return another unit at a battlefield with 3 [S] or less to its owner's hand." | "[Hidden] (Hide now for [A] to react with later for [0].)\nWhen you play me, you may return another unit at a battlefield with 3 [S] or less to its owner's hand." | official card gallery https://playriftbound.com/en-us/card-gallery/#card-gallery--sfd-138-221 (printed card image https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/e47c9a3956f8fbb77daa5fdb2ee433dd1772f247-744x1039.png): keyword printed as a keyword box; restore brackets |
| `ven-073-166` Jagged Cutlass | reminderText | "Equip [C] ([C]: Attach this to a unit you control.)" | "[Equip] [C] ([C]: Attach this to a unit you control.)" | official card gallery https://playriftbound.com/en-us/card-gallery/#card-gallery--ven-073-166 (printed card image https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/22aae23e1ac1797beb50f3f735becfe65b51ee02-744x1039.png): keyword printed as a keyword box; restore brackets |
| `rad-071-167` Nazuman Ntofo | reminderText | "Equip [1] ([1]: Attach this to a unit you control.)" | "[Equip] [1] ([1]: Attach this to a unit you control.)" | official card gallery https://playriftbound.com/en-us/card-gallery/#card-gallery--rad-071-167 (printed card image https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/9d518a6db3ae174096b09cf80cece2997f685ede-744x1039.png): keyword printed as a keyword box; restore brackets |
| `ogn-164-298` Sett, Brawler | reminderText | "When I'm played and when I conquer, buff me. (If I don't have a buff, I get a +1 [S] buff.)\nSpend my buff: Give me +4 [S] this turn." | "When you play me or when I conquer, buff me. (If I don't have a buff, I get a +1 [S] buff.)\nSpend my buff: Give me +4 [S] this turn." | newest printing ven-sp4-006 official card gallery https://playriftbound.com/en-us/card-gallery/#card-gallery--ven-sp4-006 (printed card image https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/075f83adf06b41c42c78addd11cfc73fbdb8aabb-744x1039.png) uses the updated wording "When you play me or when I conquer" |
| `ogs-014-024` Lux, Crownguard | reminderText | "[T]: [Reaction] — [Add] [2]. Use only to play spells. (Abilities that add resources can't be reacted to.)" | "[T]: [Reaction] — [Add] [2]. Spend this Energy only to play spells. (Abilities that add resources can't be reacted to.)" | newest printing ven-sp6-006 official card gallery https://playriftbound.com/en-us/card-gallery/#card-gallery--ven-sp6-006 (printed card image https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/b9778ec229e052268ea66213ca2dbf60612b2862-744x1039.png) uses the updated wording "Spend this Energy only to play spells." |
| `ogn-117-298` Viktor, Innovator | reminderText | "When you play a card on an opponent's turn, play a 1 [S] Recruit unit token in your base." | "When you play a card on an opponent's turn, play a 1 [S] Recruit unit token to your base." | newest printing ven-176-166 official card gallery https://playriftbound.com/en-us/card-gallery/#card-gallery--ven-176-166 (printed card image https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/0416b4a447494acac41413a4511bb59ce983b4ec-744x1039.png) says "to your base" (was "in your base") |
| `ven-058-166` Patched Porobot | additionalTypes | null | ["Gear"] | official card gallery https://playriftbound.com/en-us/card-gallery/#card-gallery--ven-058-166 (printed card image https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/7667d7e0c902782c38221e9326d1bb98181ec17f-744x1039.png) type line "UNIT GEAR"; Radiance overview https://playriftbound.com/en-us/news/announcements/the-radiance-overview/ ("Gear Units ... Patched Porobot, the card that introduced them") |
| `sfd-190-221` Forgefire Cape | reminderText | "[Unique] (Your deck can have only 1 card with this name.)\n[Equip] [C] ([C]: Attach this to a unit you control.)" | "[Unique] (Your deck can have only 1 card with this name.)\n[Equip] [A] ([A]: Attach this to a unit you control.)" | official card gallery https://playriftbound.com/en-us/card-gallery/#card-gallery--sfd-190-221 (printed card image https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/9bc49433a6ec5a8f4f1b44351094523d51b6bc11-744x1039.png): on this multi-domain card the printed power icon is the rainbow "any power" symbol ([A]); the scrape wrote [C] |
| `sfd-191-221` Rabadon's Deathcrown | reminderText | "[Unique] (Your deck can have only 1 card with this name.)\n[Equip] [C] ([C]: Attach this to a unit you control.)" | "[Unique] (Your deck can have only 1 card with this name.)\n[Equip] [A] ([A]: Attach this to a unit you control.)" | official card gallery https://playriftbound.com/en-us/card-gallery/#card-gallery--sfd-191-221 (printed card image https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/e93d11bdae446762b1932f0327d2ffe489fa4481-744x1039.png): on this multi-domain card the printed power icon is the rainbow "any power" symbol ([A]); the scrape wrote [C] |
| `sfd-192-221` Shurelya's Requiem | reminderText | "[Unique] (Your deck can have only 1 card with this name.)\n[Equip] [C] ([C]: Attach this to a unit you control.)\nWhen you play this, ready your units." | "[Unique] (Your deck can have only 1 card with this name.)\n[Equip] [A] ([A]: Attach this to a unit you control.)\nWhen you play this, ready your units." | official card gallery https://playriftbound.com/en-us/card-gallery/#card-gallery--sfd-192-221 (printed card image https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/6f2f7175e61486859d7f5da804e41733d66b2254-744x1039.png): on this multi-domain card the printed power icon is the rainbow "any power" symbol ([A]); the scrape wrote [C] |
| `ogn-247-298` Daughter of the Void | reminderText | "[T]: [Reaction] — [Add] [C]. Use only to play spells. (Abilities that add resources can't be reacted to.)" | "[T]: [Reaction] — [Add] [A]. Use only to play spells. (Abilities that add resources can't be reacted to.)" | official card gallery https://playriftbound.com/en-us/card-gallery/#card-gallery--ogn-247-298 (printed card image https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/3ea826277086945a2cdfda4e41b771075aa8b15b-744x1039.png): on this multi-domain card the printed power icon is the rainbow "any power" symbol ([A]); the scrape wrote [C] |
| `ogn-263-298` Swift Scout | reminderText | "You may pay [1] to hide a card with [Hidden] instead of [C].\n[1], [T]: Put a Teemo unit you own into your hand from your Champion Zone or the board." | "You may pay [1] to hide a card with [Hidden] instead of [A].\n[1], [T]: Put a Teemo unit you own into your hand from your Champion Zone or the board." | official card gallery https://playriftbound.com/en-us/card-gallery/#card-gallery--ogn-263-298 (printed card image https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/9723181e3392bb61c2aabc804a44f7b0558cedf1-744x1039.png): on this multi-domain card the printed power icon is the rainbow "any power" symbol ([A]); the scrape wrote [C] |
| `ogn-268-298` Bullet Time, Miss Fortune | reminderText | "[Action] (Play on your turn or in showdowns.)\nPay any amount of [C] to deal that much damage to all enemy units at a battlefield." | "[Action] (Play on your turn or in showdowns.)\nPay any amount of [A] to deal that much damage to all enemy units at a battlefield." | official card gallery https://playriftbound.com/en-us/card-gallery/#card-gallery--ogn-268-298 (printed card image https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/96ed7f6b121a7f46003534393350838efe2776f0-744x1039.png): on this multi-domain card the printed power icon is the rainbow "any power" symbol ([A]); the scrape wrote [C] |
| `ogn-269-298` The Boss | reminderText | "If a buffed unit you control would die, you may pay [C], exhaust me, and spend its buff to heal it, exhaust it, and recall it instead. (Send it to base. This isn't a move.)\nWhen you conquer, ready me." | "If a buffed unit you control would die, you may pay [A], exhaust me, and spend its buff to heal it, exhaust it, and recall it instead. (Send it to base. This isn't a move.)\nWhen you conquer, ready me." | official card gallery https://playriftbound.com/en-us/card-gallery/#card-gallery--ogn-269-298 (printed card image https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/b132becb843b2cf418cb110ead64758f49f51554-744x1039.png): on this multi-domain card the printed power icon is the rainbow "any power" symbol ([A]); the scrape wrote [C] |
| `sfd-182-221` Danger Zone | reminderText | "[Reaction] (Play any time, even before spells and abilities resolve.)\n[Repeat] [1][C] (You may pay the additional cost to repeat this spell's effect.)\nGive your Mechs +1 [S] this turn." | "[Reaction] (Play any time, even before spells and abilities resolve.)\n[Repeat] [1][A] (You may pay the additional cost to repeat this spell's effect.)\nGive your Mechs +1 [S] this turn." | official card gallery https://playriftbound.com/en-us/card-gallery/#card-gallery--sfd-182-221 (printed card image https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/c4652150ba885dd346b8f3622fd0e4ada7cf767f-744x1039.png): on this multi-domain card the printed power icon is the rainbow "any power" symbol ([A]); the scrape wrote [C] |
| `sfd-186-221` Spinning Axe | reminderText | "[Quick-Draw] (This has [Reaction]. When you play it, attach it to a unit you control.)\n[Equip] [C] ([C]: Attach this to a unit you control.)\n[Temporary] (If this is unattached, kill it at the start of its controller's Beginning Phase, before scoring.)" | "[Quick-Draw] (This has [Reaction]. When you play it, attach it to a unit you control.)\n[Equip] [A] ([A]: Attach this to a unit you control.)\n[Temporary] (If this is unattached, kill it at the start of its controller's Beginning Phase, before scoring.)" | official card gallery https://playriftbound.com/en-us/card-gallery/#card-gallery--sfd-186-221 (printed card image https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/e4e0328034e605d000e23ac5e820d233f0e3b520-744x1039.png): on this multi-domain card the printed power icon is the rainbow "any power" symbol ([A]); the scrape wrote [C] |

### B. Equipment bottom band (new field `attachedReminderText` / `attachedText`)

Source for every row: the printed card image on the official gallery, `https://playriftbound.com/en-us/card-gallery/#card-gallery--<id>` (image URLs are in data/overrides.json).

| card | attachedReminderText (what the equipped unit has) |
|---|---|
| `rad-150-167` Blade of the Exile | "[Ganking] (I can move from battlefield to battlefield.)" |
| `sfd-009-221` Serrated Dirk | "[Assault 2] (+2 [S] while I'm an attacker.)" |
| `sfd-016-221` Recurve Bow | "When I attack or defend, deal 2 to an enemy unit here." |
| `sfd-030-221` Skyfall of Areion | "My hold effects are also conquer effects, and vice versa." |
| `sfd-033-221` Doran's Shield | "[Tank] (I must be assigned combat damage first.)" |
| `sfd-042-221` Brutalizer | "If this was attached to me this turn, I have an additional +2 [S]." |
| `sfd-051-221` Guardian Angel | "If I would die, kill Guardian Angel instead. Heal me, exhaust me, and recall me." |
| `sfd-064-221` Cloth Armor | "[Shield 2] (+2 [S] while I'm a defender.)" |
| `sfd-073-221` Experimental Hexplate | "I am a Mech." |
| `sfd-086-221` World Atlas | "When I hold, play two Gold gear tokens exhausted." |
| `sfd-090-221` The Zero Drive | "[Deathknell][>] Banish me. (When I die, get the effect.)" |
| `sfd-102-221` Hexdrinker | "[Deflect] (Opponents must pay [A] to choose me with a spell or ability.)" |
| `sfd-108-221` Warmog's Armor | "When I conquer, buff me. (If I don't have a buff, I get a +1 [S] buff.)" |
| `sfd-115-221` Trinity Force | "When I hold, score 1 point." |
| `sfd-118-221` Boneshiver | "When I conquer, channel 1 rune exhausted." |
| `sfd-124-221` Doran's Ring | "When I conquer, discard 1, then draw 1." |
| `sfd-133-221` Boots of Swiftness | "[Ganking] (I can move from battlefield to battlefield.)" |
| `sfd-134-221` Cull | "When I conquer, play a Gold gear token exhausted." |
| `sfd-150-221` Last Rites | "When I conquer or hold, you may play a unit from your trash. (You still pay its costs.)" |
| `sfd-153-221` Eye of the Herald | "When I move, play a 1 [S] Recruit unit token here." |
| `sfd-172-221` Sacred Shears | "[Deathknell][>] Draw 1. (When I die, get the effect.)" |
| `unl-019-219` Blighted Battleaxe | "At the end of your turn, if I didn't conquer this turn, unattach this and deal 4 to me." |
| `unl-039-219` Soul Sword | "[Level 3][>] I have an additional +1 [S]. (While you have 3+ XP, get the effect.)" |
| `unl-096-219` Hunter's Machete | "[Hunt] (When I conquer or hold, gain 1 XP.)" |
| `unl-188-219` Hextech Gauntlets | "When I conquer, if you assigned 3 or more excess damage, draw 1." |
| `ven-011-166` Pendulum Blade | "When I move to a battlefield, give me +2 [S] this turn." |
| `ven-027-166` Hand Hammer | "I have +2 [S] while I'm at a battlefield with exactly one other unit you control." |
| `ven-137-166` Shady Spectacles | "(I am a copy of the chosen unit.)" |
| `ven-073-166` Jagged Cutlass | "I can't be moved by enemy spells and abilities." |
| `rad-071-167` Nazuman Ntofo | "[Shield 2] (+2 [S] while I'm a defender.)" |
| `rad-123-167` Protector's Shield | "[Tank] (I must be assigned combat damage first.)" |
| `sfd-190-221` Forgefire Cape | "When I attack or defend, deal 2 to all enemy units here." |
| `sfd-191-221` Rabadon's Deathcrown | "Your spells and abilities deal 3 Bonus Damage (while this is attached)." |
| `sfd-192-221` Shurelya's Requiem | "Your units here have [Ganking]. (We can move from battlefield to battlefield.)" |

### C. Radiance domains / tags (scrape metadata wrong; checked against every printed RAD card)

Source for every row: printed card image on `https://playriftbound.com/en-us/card-gallery/#card-gallery--<id>` (domain = frame/pip colour; tags = type line).

| card | field | was | now |
|---|---|---|---|
| `rad-001-167` Amateur Demolitionist | domains | ["Chaos"] | ["Fury"] |
| `rad-001-167` Amateur Demolitionist | tags | [] | ["Bandle City", "Yordle"] |
| `rad-002-167` Banner of Conquest | tags | ["Device"] | [] |
| `rad-003-167` Bilgewater Tracker | domains | ["Body"] | ["Fury"] |
| `rad-003-167` Bilgewater Tracker | tags | [] | ["Bilgewater"] |
| `rad-004-167` Brawl | domains | ["Chaos"] | ["Fury"] |
| `rad-005-167` Lingering Animus | tags | [] | ["Shadow Isles", "Spirit"] |
| `rad-006-167` Scorched Earth | domains | [] | ["Fury"] |
| `rad-008-167` War Scout | tags | [] | ["Demacia", "Yordle"] |
| `rad-009-167` Antagonistic Apparatus | domains | [] | ["Fury"] |
| `rad-009-167` Antagonistic Apparatus | tags | [] | ["Bandle City", "Yordle", "Mech"] |
| `rad-011-167` Incorrigible Construct | tags | [] | ["Piltover", "Mech"] |
| `rad-012-167` Runeblade Anvil | domains | ["Chaos"] | ["Fury"] |
| `rad-014-167` Shimmering Swimmer | tags | [] | ["Bilgewater"] |
| `rad-016-167` Coalesced Energy | domains | ["Mind"] | ["Fury"] |
| `rad-016-167` Coalesced Energy | tags | [] | ["Shurima"] |
| `rad-017-167` Detonation Amplifier | domains | ["Chaos"] | ["Fury"] |
| `rad-017-167` Detonation Amplifier | tags | ["Device"] | [] |
| `rad-018-167` Drakehound Packmaster | tags | [] | ["Noxus"] |
| `rad-019-167` Firebrand Raider | tags | [] | ["Freljord"] |
| `rad-020-167` Mordekaiser | tags | ["Noxus", "Mordekaiser"] | ["Mordekaiser", "Noxus", "Spirit"] |
| `rad-022-167` Whirling Twirligig | domains | [] | ["Fury"] |
| `rad-023-167` Ziggs | tags | ["Bandle City", "Ziggs"] | ["Ziggs", "Zaun", "Yordle"] |
| `rad-024-167` Blossoming Dreamroot | domains | ["Chaos"] | ["Calm"] |
| `rad-024-167` Blossoming Dreamroot | tags | ["Device"] | [] |
| `rad-026-167` Entrenched Boar | domains | [] | ["Calm"] |
| `rad-026-167` Entrenched Boar | tags | [] | ["Freljord"] |
| `rad-027-167` Iridescent Avian | tags | [] | ["Ixtal", "Bird"] |
| `rad-030-167` Sanctum Conservator | tags | [] | ["Shurima"] |
| `rad-031-167` Stoic Ferryman | tags | [] | ["Bilgewater", "Sentinel"] |
| `rad-036-167` Storm Raptor | tags | [] | ["Freljord", "Bird"] |
| `rad-037-167` Watchful Curator | tags | [] | ["Piltover"] |
| `rad-040-167` Heartening Soul | tags | [] | ["Shadow Isles", "Spirit"] |
| `rad-041-167` Hush | domains | [] | ["Calm"] |
| `rad-043-167` Riven | tags | ["Riven"] | ["Riven", "Noxus"] |
| `rad-044-167` Hunting Blind | tags | ["Device"] | [] |
| `rad-047-167` Fanfare | domains | [] | ["Mind"] |
| `rad-049-167` Industrious Mechsmith | domains | [] | ["Mind"] |
| `rad-049-167` Industrious Mechsmith | tags | [] | ["Zaun"] |
| `rad-050-167` Mysterious Chronomancer | tags | [] | ["Shurima"] |
| `rad-052-167` Resource Extractor | tags | ["Device"] | [] |
| `rad-053-167` Strigian Oracle | tags | [] | ["Freljord", "Bird"] |
| `rad-054-167` Trinket Peddler | tags | [] | ["Bandle City", "Yordle"] |
| `rad-055-167` Clanging Sentry | tags | [] | ["Piltover", "Mech"] |
| `rad-057-167` Piltovan Guidebot | tags | [] | ["Piltover", "Mech"] |
| `rad-058-167` Riptide Mage | tags | [] | ["Bilgewater"] |
| `rad-059-167` Supernova | domains | ["Order"] | ["Mind"] |
| `rad-060-167` The Empyrean | tags | ["Dragon"] | ["Ionia", "Dragon"] |
| `rad-062-167` Gravity Field | domains | ["Calm"] | ["Mind"] |
| `rad-062-167` Gravity Field | tags | ["Device"] | [] |
| `rad-066-167` Spirit of the Forge | tags | [] | ["Freljord", "Spirit"] |
| `rad-067-167` Clocktower Guardian | domains | ["Fury"] | ["Mind"] |
| `rad-067-167` Clocktower Guardian | tags | ["Mech"] | ["Shurima"] |
| `rad-072-167` Overloaded Traveler | tags | [] | ["Bandle City", "Yordle"] |
| `rad-073-167` Pillaged Armory | domains | ["Calm"] | ["Body"] |
| `rad-073-167` Pillaged Armory | tags | ["Device"] | [] |
| `rad-074-167` Raving Witness | tags | [] | ["Freljord"] |
| `rad-075-167` Skystrike Squadron | tags | [] | ["Demacia", "Elite", "Bird"] |
| `rad-076-167` Sneaky Zeebles | tags | [] | ["Mount Targon"] |
| `rad-077-167` Wrath of the Freljord | tags | [] | ["Freljord", "Spirit"] |
| `rad-078-167` Armored Tusker | tags | [] | ["Noxus"] |
| `rad-080-167` Bloodscent Swarm | tags | [] | ["Shurima"] |
| `rad-081-167` Elnuk Herd | domains | ["Fury"] | ["Body"] |
| `rad-081-167` Elnuk Herd | tags | [] | ["Freljord"] |
| `rad-083-167` Stalwart Goatherd | tags | [] | ["Mount Targon"] |
| `rad-087-167` Portable Portal | tags | ["Device"] | [] |
| `rad-088-167` Staunch Survivor | tags | [] | ["Freljord"] |
| `rad-089-167` Titanic Shrine | tags | ["Device"] | [] |
| `rad-090-167` Evelynn | tags | ["Evelynn"] | ["Evelynn", "Demon"] |
| `rad-092-167` Seraphic Wyvern | tags | ["Dragon"] | ["Mount Targon", "Dragon"] |
| `rad-093-167` Disposal Expert | domains | ["Fury"] | ["Chaos"] |
| `rad-093-167` Disposal Expert | tags | [] | ["Bandle City", "Yordle"] |
| `rad-094-167` Explosimian | tags | [] | ["Zaun"] |
| `rad-095-167` Momentary Companion | tags | [] | ["Shadow Isles", "Demon"] |
| `rad-097-167` Siren of the Shallows | tags | [] | ["Bilgewater"] |
| `rad-099-167` Suave Negotiator | tags | [] | ["Bilgewater", "Demon"] |
| `rad-102-167` Demon Shade | domains | ["Fury"] | ["Chaos"] |
| `rad-103-167` Gutter Guardian | tags | [] | ["Zaun"] |
| `rad-104-167` Pitiless Stalker | domains | [] | ["Chaos"] |
| `rad-104-167` Pitiless Stalker | tags | [] | ["Shadow Isles", "Cat"] |
| `rad-105-167` Reckless Innovator | tags | [] | ["Piltover"] |
| `rad-106-167` The Good Stuff | domains | ["Body"] | ["Chaos"] |
| `rad-106-167` The Good Stuff | tags | ["Device"] | [] |
| `rad-107-167` Bedeviling Stranger | tags | [] | ["Shadow Isles", "Demon"] |
| `rad-108-167` Bushwhack Trap | domains | ["Fury"] | ["Chaos"] |
| `rad-108-167` Bushwhack Trap | tags | ["Device"] | [] |
| `rad-109-167` Evelynn | tags | ["Evelynn"] | ["Evelynn", "Demon"] |
| `rad-111-167` Mechanical Bandit | domains | ["Fury"] | ["Chaos"] |
| `rad-111-167` Mechanical Bandit | tags | ["Device"] | [] |
| `rad-112-167` Ziggs | tags | ["Bandle City", "Ziggs"] | ["Ziggs", "Zaun", "Yordle"] |
| `rad-113-167` Angler Wyrm | tags | [] | ["Bilgewater", "Dragon"] |
| `rad-114-167` Riven | tags | ["Riven"] | ["Riven", "Noxus"] |
| `rad-115-167` Transpositionist | tags | [] | ["Bilgewater"] |
| `rad-116-167` Concert Poster | tags | ["Device"] | [] |
| `rad-118-167` Herald of the Emperor | tags | [] | ["Shurima"] |
| `rad-119-167` Hunting Dog | tags | [] | ["Demacia", "Dog"] |
| `rad-120-167` Meticulous Restorationist | tags | ["Device"] | ["Piltover"] |
| `rad-121-167` One-Two Punch | domains | [] | ["Order"] |
| `rad-122-167` Party Crasher | tags | [] | ["Zaun"] |
| `rad-124-167` Burn Away | domains | ["Body"] | ["Order"] |
| `rad-125-167` Dune Devourer | tags | [] | ["The Void"] |
| `rad-126-167` Mournful Spirit | tags | ["Spirit"] | ["Shadow Isles", "Spirit"] |
| `rad-128-167` Steadfast Outrider | tags | [] | ["Demacia"] |
| `rad-129-167` Trifarian Captain | tags | [] | ["Noxus", "Trifarian"] |
| `rad-130-167` Battlefield Armorer | tags | [] | ["Demacia"] |
| `rad-131-167` Demacian Illuminators | tags | [] | ["Demacia"] |
| `rad-134-167` Raucous Anthem | domains | [] | ["Order"] |
| `rad-136-167` Dockside Lock-Up | tags | ["Device"] | [] |
| `rad-137-167` Mordekaiser | tags | ["Noxus", "Mordekaiser"] | ["Mordekaiser", "Noxus", "Spirit"] |
| `rad-146-167` The Ball | tags | ["Device", "Orianna"] | ["Orianna"] |
| `rad-156-167` Demacian Standard | tags | ["Device", "Jarvan IV"] | ["Jarvan IV"] |
| `rad-071-167` Nazuman Ntofo | domains | ["Order"] | ["Body"] |
| `rad-071-167` Nazuman Ntofo | tags | [] | ["Equipment"] |
| `rad-123-167` Protector's Shield | domains | [] | ["Order"] |
| `rad-123-167` Protector's Shield | tags | [] | ["Equipment"] |

## Ban list

`data/banlist.json` now matches the official Rules Hub tables "Last updated: November 23, 2026"
(<https://playriftbound.com/en-us/rules-hub/>): `standard` 15 cards + 7 battlefields, `constructed2v2` the same minus Fight or Flight plus
the legend Master Yi, Wuju Bladesman (listed by id `ogs-019-024` because our data names that legend "Wuju Bladesman"). The old file
was missing Called Shot, Draven, Vanquisher, Stealthy Pursuer, Ekko, Recurrent, Obelisk of Power and Aspirant's Climb.
No unbans so far. Sources: [first bans 2026-03-31](https://playriftbound.com/en-us/news/announcements/announcing-riftbounds-first-bans/),
[July 2026](https://playriftbound.com/en-us/news/announcements/july-ban-list-updates/),
[September 2026](https://playriftbound.com/en-us/news/announcements/september-ban-list-updates-effective-september-18-2026/),
[November 2026](https://playriftbound.com/en-us/news/announcements/radiance-ban-list-updates-effective-november-23-2026/).
Nothing in src/ loads the file yet; `validateDeck` takes the `standard` (or `constructed2v2`) array as `banlist`.

## Scripts needing update

Behavioural (the script does not do what the corrected card does):

| card | script | change |
|---|---|---|
| all 34 Equipment in table B (incl. `rad-071-167`, `rad-123-167`, `rad-150-167`) | src/cards/scripts/batch-B2.ts (`sfd-016`, `sfd-009`, `sfd-064`, `sfd-153`, `rad-071`, … are registered keyword-only) | implement the band as an ability the equipped unit has while attached (keywords like Tank/Shield 2/Assault 2/Ganking/Deflect/Hunt, triggers, statics, Deathknell). Shady Spectacles' band is reminder only. |
| `sfd-090-221` The Zero Drive | batch-B2.ts | equipped unit gets "[Deathknell] — Banish me", which feeds "units banished with this" |
| `ven-073-166` Jagged Cutlass | batch-B2.ts | band: the equipped unit can't be moved by enemy spells and abilities |
| `ven-058-166` Patched Porobot | batch-B7.ts + engine | must count as a Gear as well as a Unit (`additionalTypes`), e.g. for its own "3 or more other gear" check, Hwei, gear removal |

Text string only (update the `card(id, "…")` text argument; behaviour is already right):

| card | script |
|---|---|
| `unl-199-219` LeBlanc, Deceiver ("Then do this:" errata; the script already stops if no token is played) | batch-B8.ts |
| `ogn-005-298` Disintegrate ("[Action]" brackets) | batch-B5.ts |
| `rad-127-167` Rousing Display (no "disa") | batch-B3.ts |
| `ven-109-166` Illaoi ("a 1 [S] Tentacle") | batch-B3.ts |
| `ogn-117-298` Viktor, Innovator ("to your base") | batch-B3.ts |
| `ogn-164-298` Sett, Brawler ("When you play me or when I conquer") | batch-B6.ts |
| `ogs-014-024` Lux, Crownguard ("Spend this Energy only to play spells.") | batch-B2.ts |
| `rad-071-167` Nazuman Ntofo, `ven-073-166` Jagged Cutlass ("[Equip]" brackets) | batch-B2.ts |
| `sfd-138-221` Windsinger ("[Hidden]") | batch-B7.ts |

Already consistent: Falling Star / Icathian Rain (batch-B5.ts already deals 2× / 6×), Risen Altar (batch-B8.ts already has
`keywords: []`). Laurent Bladekeeper (`sfd-096-221`) has no script.

Tests that hard-coded the old (wrong) Radiance domains and now fail to pay costs:
`tests/cards/B7/misc.test.ts` (Burn Away is Order, not Body), `tests/cards/B7/look-reveal.test.ts` (Clocktower Guardian is
Mind, not Fury), `tests/cards/B2/deploy.test.ts` (The Good Stuff is Chaos, not Body; the generic Deploy test). Coverage tests
B2/registry, B3/tokens, B5/coverage and B6/coverage fail until the text strings above are updated.

## Unresolved

- No second bulk source exists for Radiance stats; the RAD values were verified by reading the official card images.
- Not cross-checked in bulk: `unl-022-219` Jhin, `ven-087-166` Hextech Disc, `ven-101-166` Gust Monk.
- Legend tags: our RAD legends carry extra region tags (e.g. Hexplosives Expert `["Yordle","Ziggs"]`) while the printed type
  line shows only the champion; left as is (only the champion tag is used for deck building).
- Resplendent Rostrum (`rad-046-167`) prints "When this become exhausted"; data says "When I become exhausted" (same meaning, left).
- Neeko, Blending In: printed card shows the pre-errata "choose 3 different legends"; data uses the Radiance errata "up to 3".

## Follow-up audit (Rift Judge verification, 2026-11-26)

### Full image pass
Besides the earlier passes (all 173 Radiance cards, all 43 Equipment), the rules box of every non-Radiance **gear (66), legend (49)
and battlefield (66)** was compared with its card image. So were **59 units/spells with short text for their rarity or cost**
(Rare/Epic/Showcase or Energy ≥ 5 with under 45 characters; all genuine, including the vanilla Playful Phantom, Mega-Mech and Mountain Drake).
Printed pre-errata wording (Zhonya's Hourglass, The Boss, Falling Star, Void Burrower, Unforgiven…) was expected and not
counted as a difference. New finding:

- **Rainbow power icon on multi-domain cards.** On every multi-domain card whose data used `[C]`, the printed icon is the rainbow
  "any power" symbol, which this data writes `[A]` (as in Hidden's "Hide now for [A]"). Corrected `[C]` → `[A]` (table A rows
  "multi-domain card") on Daughter of the Void (`ogn-247-298`), Swift Scout (`ogn-263-298`), Bullet Time (`ogn-268-298`),
  The Boss (`ogn-269-298`), Danger Zone (`sfd-182-221`, Repeat cost), Spinning Axe, Forgefire Cape, Rabadon's Deathcrown and
  Shurelya's Requiem (`sfd-186/190/191/192-221`, Equip costs). `keywordCosts` follow automatically. On single-domain cards `[C]`
  is the domain icon and is correct (checked on Seal of Rage, Unlicensed Armory and others).
- Trinity Force, Skyfall of Areion, Guardian Angel and Eye of the Herald: their abilities are the Equipment bands, already in
  `attachedReminderText` / `attachedText` since the first pass (table B). Nothing is missing from data; only the scripts lack them.

### Wraith of Echoes (`ogn-118-298`): not changed
riftboundfaq.com/rulings/card-text-updates and Rift Judge #3911 give "The first time **another** friendly unit dies each turn, draw 1."
But neither cites an official source. The text is absent from every official errata article (Origins 2025-10-28, Spiritforged
2026-01-14, Unleashed 2026-04-03, Vendetta 2026-07-23, Radiance 2026-10-09) and from the Radiance Core Rules patch notes. The
official gallery (scraped 2026-11-14) and the printed card still say "a friendly unit". The official
[Origins FAQ](https://playriftbound.com/en-us/news/rules-and-releases/riftbound-origins-faq/) addresses it as a **ruling**
("Does Wraith of Echoes trigger on its own death?"; the answer text could not be fetched). Rift Judge says the change
"did not change its function". **Behaviour required regardless:** Wraith does not draw for its own death or for units dying
simultaneously with it (CR 383.2.c.2; Rift Judge #3911/#2674, already in docs/riftjudge/FINDINGS.md). The same site lists two
other unsourced "updates", also only FAQ rulings in the official Origins FAQ, left as printed:
**Symbol of the Solari** (`ogn-227-298`; community text "…ends in a tie that would recall any of your units, recall all units at
that battlefield instead": behaviour = only units at that battlefield) and **Unyielding Spirit** (`ogn-145-298`; "Prevent all
damage that would be dealt this turn by spells and abilities"). If Riot publishes these as errata, add overrides.

### Cards Rift Judge names that are not in data
- **"Surprise Defense"** (RJ #4, #5202): not a card. It is community shorthand for a combat that begins at an *uncontrolled*
  battlefield during a non-combat showdown (RJ #4: "A Surprise Defense creates a Combat scenario rather than a non-combat Showdown";
  #5202: the current showdown finishes, then a new combat showdown begins). Nothing to add. The rulings are testable with
  ordinary cards.
- **"Violent Impulses"** (RJ #2686): Rift Judge says "the Violent Impulses wording discussed is only a translation, not official
  text". The described effect (an opponent's top card is revealed and that player's opponent plays it, here Nocturne) is
  **Blind Fury** (`ogn-025-298`: "Each opponent reveals the top card of their Main Deck. Choose one and banish it, then play it,
  ignoring its cost."). Use Blind Fury for that test. This is an inference: no English card of that name exists in the
  official gallery or Riftcodex.
- **"Jayce, Defender of Tomorrow"** (RJ #11761): exists as legend `ven-149-166`. Legends are stored by legend title
  (`name: "Defender of Tomorrow"`, champion in `tags`), so "Champion, Title" lookups miss them. The conformance harness's
  name lookup should also try `tags[0] + ", " + name` for Legends (the ban list uses the id for the same reason).
- RJ #9152 ("charm a Recruit into Draven") has no card behind it (the question's premise). Nothing to add.

### Scripts needing behaviour updates (follow-up)
| card | script | change |
|---|---|---|
| `ogn-118-298` Wraith of Echoes | src/cards/scripts (owner of ogn-118) / engine | must not trigger on its own death or on units dying at the same time (FAQ ruling; RJ #3911/#2674) |
| `ogn-227-298` Symbol of the Solari | owner script | tie recall applies to units at that battlefield only (Origins FAQ ruling) |
| `sfd-115-221` Trinity Force, `sfd-030-221` Skyfall of Areion, `sfd-051-221` Guardian Angel, `sfd-153-221` Eye of the Herald (and the rest of table B) | batch-B2.ts | implement `attachedText` (RJ #10436, #7840, #9139) |
| `ogn-247-298` Daughter of the Void, `ogn-263-298` Swift Scout, `ogn-269-298` The Boss | batch-B8.ts | `[C]` → `[A]` (any power); text string plus cost spec |
| `ogn-268-298` Bullet Time | batch-B5.ts | "Pay any amount of [A]" |
| `sfd-182-221` Danger Zone | batch-B6.ts | Repeat `[1][A]` |
| `sfd-186/190/191/192-221` (Spinning Axe, Forgefire Cape, Rabadon's Deathcrown, Shurelya's Requiem) | batch-B2.ts | Equip `[A]` (data `keywordCosts` already updated) |

Practical impact of `[C]` → `[A]` is small: runes in a legal deck all belong to the legend's two domains. It matters only if
the engine reads `[C]` on a two-domain card as one specific domain, or if a player controls runes from outside the deck's domains.

### Minor, not changed
- Perched Grimwyrm (`sfd-015-221`): the Radiance patch notes quote "Play me only to a battlefield you've conquered this turn."; the
  card and our data say "you conquered". Same meaning.
- Honeyfruit (`unl-049-219`): data writes the Level line as `[Level 6][>] [>>][Reaction][>] [T]: [Add] [1][A].`; the card shows
  "LEVEL 6 ▸ REACTION ▸ [T]: ADD 1 [A]". Same meaning, odd markup.

# DSL / engine requests

## B6 (pump / ready / buff) — filed by scripting agent B6

Each entry: card(s), exact need, proposed API. Local stand-ins live in `src/cards/helpers/B6.ts` (marked LOCAL).

1. **Multiple buffs** — `ogn-078-298` Lee Sin, Ascetic ("I can have any number of buffs."). `ctx.buff()` always refuses a second buff.
   Need: a rule hook so every buff source (all batches) honours it. Proposed: `rule('multipleBuffs', (ctx, unit) => unit === ctx.self)`,
   consulted by `actions.buff()` as `allowMultiple`. LOCAL: `helpers/B6.ts buff()` + `MULTI_BUFF` set (only B6 scripts use it).
2. **Delayed static abilities** — `ogn-053-298` Stand United ("Buffs give an additional +1 [S] to friendly units this turn.").
   Need: `ctx.delay(key, data, 'endOfTurn')` where the registered delayed ability is a `statik(...)`, applied by `chars()`.
   LOCAL: the static is granted to the controller's legend for the turn (`EXTRA_BUFF_MIGHT`).
3. **Earlier target groups visible to later target filters** — `sfd-196-221` Defiant Dance ("another unit"), `unl-155-219` Heroic Charge
   ("an enemy unit at its location"), `unl-198-219` Moonfall, `ven-034-166` Resonating Strike ("at a different location"), `ogn-108-298`.
   Need: `chooseTargetsFor` sets `ctx.targets[i]` as each group is chosen (and `hasLegalTargets` evaluates groups in order).
   Proposed filter helper `F.notTarget(i)` / `F.sameLocationAsTarget(i)`. LOCAL: `chosenSoFar()` reads this action's `targeted` events.
4. **`ctx.addPlayCost()` with non-resource parts breaks state cloning** — the `extra` functions are stored in `ctx.data.__extraCost`
   (= `item.choices.playData`), so `structuredClone` throws on the next action (`DOMException`). Hit by `ogn-146-298` Wallop,
   `ogn-207-298` Call to Glory, `ogn-150-298` Kraken Hunter. Proposed: keep extra costs off the state (e.g. store a cost *key* registered
   with `registerExtraCost(key, ExtraCost)`), or strip functions before storing playData. LOCAL: the buffs are spent inside the asPlay
   effect (a failed payment rolls the play back).
5. **Amount spent on a play** — `unl-005-219` Revna ("if you spent [4] or more"). Need: `play` / `spellFinalized` events carry
   `paid: { energy, power }`. LOCAL: printed Energy cost (0 when played from Hidden). Test: `tests/cards/B6/todo.test.ts`.
6. **extraTriggers for built-in keyword triggers** — `unl-029-219` Red Brambleback ("Your conquer effects for conquering here trigger an
   additional time.") doesn't double Hunt (builtinTriggers bypass `ruleSum('extraTriggers')`). Proposed: apply the same rule loop to
   `builtinTriggers()` results. Test: todo.test.ts.
7. **Per-turn "chose an enemy unit" fact** — `ven-125-166` Hungry Wolf ("Use only if you've chosen an enemy unit this turn").
   Need: engine records `targeted` events per player per turn, e.g. `ctx.choseThisTurn(p, filter)` or `g.ex.counts['choseEnemy:p']`.
   LOCAL: a silent tracker (match-only trigger, `helpers/B6.ts tracker()`) that misses choices made while the Wolf was in the deck.
8. **Per-turn "played a unit/gear to a battlefield" fact** — `rad-070-167` Hold 'Em. Need: `play` destinations recorded per turn
   (e.g. `g.ex.counts['playedToBf:p']`). LOCAL: tracker + "played this turn, at a battlefield, not moved" fallback.
9. **"When one or more …" / "at the same time" batches** — `ogn-202-298` Jinx (discard), `rad-131-167` Demacian Illuminators (die),
   `rad-065-167` Seraphine (exhaust three or more at the same time). Need: events emitted together share a batch id
   (`ev.batch`), so triggers can fire once per batch / count the batch. LOCAL: `firstOfBatch()` / `batchCount()` walk back over the
   consecutive run of same-type events in `g.ex.lastEvents`.
10. **Play data in "when you play me" triggers** — `C.paidAdditional` / `C.showedOff` read `ctx.data`, but a play trigger's ctx.data is the
    trigger's own data, not the play data (it is only on `ctx.event.playData`). Proposed: `placeTrigger` seeds `item.choices.data` with
    `event.playData` for `play` events of the trigger's source, or C.* fall back to `ctx.event?.playData`. LOCAL: `paidAdditional()`.
11. **Modes on triggered abilities** — `rad-043-167` Riven, Broken Blade and `ven-088-166` Jayce choose their mode on resolution
    (`ctx.chooseMode`), CR wants it as the trigger is put on the chain. Proposed: `when(..., { modes: [...] })` handled in `placeTrigger`.
12. **"As I'm revealed" Add timing** — `sfd-175-221` Undertitan: an `isAdd` trigger on `reveal` resolves when triggers are flushed (after
    the revealing effect), so the [2] can't help pay for something inside that same effect. Proposed: resolve isAdd triggers immediately
    in `emit()`.
13. **LKI for "activated ability of a gear"** — `sfd-075-221` Prize of Progress: when the gear is killed as part of its cost (Gold token)
    the `activated` event's object is gone, so it can't be identified as a gear. Proposed: add `cardType` / `lki` to the `activated` event.

## B4 (combat / board / movement) — filed by scripting agent B4

Local stand-ins live in `src/cards/helpers/B4.ts`. Scripts already read the proposed state keys, so they start working as soon
as the engine fills them. Todo tests: `tests/cards/B4/play-location.test.ts`.

1. **Hand-active play rules for the card being played** (same root cause as conformance T181) — `ogn-161-298` Deadbloom Predator,
   `sfd-093-221` Dauntless Vanguard ("occupied enemy battlefield"), `ogn-174-298` Sai Scout, `ogn-176-298` Sneaky Deckhand,
   `ogn-193-298` Miss Fortune, Buccaneer (first line), `ven-115-166` Ocean Drake ("open battlefield"), `sfd-025-221` Rengar, Pouncing
   ("a battlefield you're attacking"), `unl-120-219` Rengar, Trophy Hunter, and the restriction `sfd-015-221` Perched Grimwyrm.
   Need: `play.ts playRules()/destinations()` and `rules.ts activeRules('cantPlay')` also consult the abilities of the object being
   played when their `activeIn` includes its zone ('hand'). Scripted as
   `playRule((ctx, id) => id === ctx.self, { extraDestinations, activeIn: ['hand'] })` and `rule('cantPlay', …, { activeIn: ['hand'] })`.
2. **Extra Ambush destinations** — `unl-120-219` Rengar, Trophy Hunter ("I can [Ambush] to a battlefield where there are enemy units,
   even if you don't have units there"). `cardTiming()` only gives Ambush's Reaction timing where you have units. Proposed:
   `PlayRuleAbility.ambush?: (ctx, playedId, bf) => boolean` (adds the destination *and* the Ambush timing there).
3. **"Conquered this turn"** — `sfd-015-221` Perched Grimwyrm. Proposed: `showdown.ts score()` records
   `g.ex.turnFacts['conquered:<p>'] = number[]` (battlefield indexes) when `how === 'conquer'`. The script reads exactly that key.
4. **Deaths per phase** — `unl-037-219` Shadow Watcher ("a friendly unit died during your Beginning Phase this turn"). Proposed:
   `actions.kill()` also bumps `g.ex.counts['unitsDiedBeginning:<controller>']` while `g.phase === 'beginning'` (script reads it).
5. **Amounts paid this turn** (see also B6 #5) — `sfd-143-221` Sivir, Mercenary ("spent at least [A][A] this turn": any payment, incl.
   abilities and Deflect) and `unl-004-219` Prepared Neophyte ("spent [4] or more to play a spell"). Proposed: `executePayment` bumps
   `g.ex.counts['powerSpent:<p>']`, and the play process records `g.ex.counts['maxSpellEnergy:<p>']` (max Energy paid for one spell).
   LOCAL: printed Power costs / printed spell Energy costs of cards played this turn (`powerSpentThisTurn`, `maxEnergySpentOnSpell`).
6. **Mover for `cantMove`** — `unl-150-219` Vex, Apathetic ("They can't move it this turn": only its controller is restricted). Proposed:
   `moveUnits` calls `ruleApplies(g, 'cantMove', id, from, to, player)` (standard move: the unit's controller). LOCAL: the granted rule
   already takes a 4th `mover` argument; without it every move of that unit is blocked this turn.
7. **Battlefield trigger controller (CR 190.6)** — `ogn-285-298` Reaver's Row, `unl-207-219` Amateur Recital (and every B8
   `onConquerHere / onHoldHere / onDefendHere`): `events.ts collectTriggers` uses the battlefield card's *owner* as controller, so
   "you" and the trigger's choices go to the wrong player when the opponent owns the battlefield. Proposed: for battlefield cards,
   controller = `g.battlefields[i].controller ?? g.activePlayer` (in triggers, replacements and rules, like `activatableAbilities` does).
   LOCAL: match with `bfAbilityController()`, choices made on resolution through `asPlayer()`.
8. **Statics conditioned on their own source's Might** — `ogn-232-298` Fiora, Victorious ("While I'm [Mighty], I have …"). In a
   static's condition `ctx.isMighty(self)` runs inside the recursion guard of `chars()`, which drops *all* static abilities, so an
   anthem's +1 doesn't count. Proposed: in the guarded recursion, skip only the statics of the object being computed (or of the static
   being evaluated). LOCAL: `mightyFromOwnStatic()` adds the other statics' Might itself.
9. **Combat damage assignment record** — `ogn-034-298` Tryndamere ("if you assigned 5 or more excess damage"; card-patterns lists 5
   such cards). Proposed: `combatDamageTask` stores `g.ex.combat.assigned = { [player]: { [unit]: { amount, lethal } } }` (or emits
   `combatDamageAssigned`). LOCAL: a replacement ability that never applies observes proposed combat damage (`recordExcess()`).
10. **Moves per object per turn** — `ogn-205-298` Yasuo ("the third time I move in a turn"), `ogn-162-298` Miss Fortune, Captain
    ("the first time I move each turn"). Proposed: `GameObject.movesThisTurn` incremented in `moveUnits`. LOCAL: `bumpMoves()` counts
    in the trigger matcher (`g.ex.counts`).
11. **Group validator on a target spec** — `unl-054-219` Tricksy Tentacles ("any number of enemy units with the same controller and a
    total Might of 8 or less"). Proposed: `TargetSpec.check?: (ctx, ids) => string | null` wired through `data.check`. LOCAL: the units
    are chosen one at a time in an `asPlay` (each pick filtered by the running total), Deflect added with `ctx.addPlayCost`.
12. **Gain a tag permanently** — `unl-177-219` Ivern ("As you play me, choose … I gain that tag."). Proposed: `ctx.addTag(id, tag, dur)`
    (layer-1 modifier). LOCAL: the choice is copied into a counter from the `entersReady` hook and read by a self static.
13. **Optional additional cost whose choice changes the play cost** — `unl-170-219` Atakhan (kill a friendly unit; cost reduced by its
    Energy and Power). Legal-play enumeration can't know the choice, so the script assumes the best discount there (a play that then
    can't be paid is rolled back). Proposed (B1 territory): `additionalCosts[].choose` whose result is visible to cost mods, with
    playability checked over the possible choices.
14. **Unpayable "you may pay X to …" triggers** — `placeTrigger` asks the optional question before checking the cost. LOCAL: `ifCanPay()`
    in the matcher (Vayne, Icevale Archer, Sinister Poro, Fae Porter, Baccai Reaper, Kennen). Proposed: skip such triggers in
    `placeTrigger` when `!canAfford`.
15. **Granting another object's abilities** — `ogn-111-298` Heimerdinger ("I have all [T] abilities of all friendly legends, units, and
    gear"). `StaticMods.grants` only takes registered keys, so the script registers `B4:heimer:<cardId>:<index>` grants lazily while
    the static is evaluated. Proposed: `StaticMods.grantRefs?: { cardId, index }[]` resolved by the engine.

## B3 (tokens / go-wide) — filed by scripting agent B3

Local stand-ins live in `src/cards/helpers/B3.ts`. Tests marked `todo` are in `tests/cards/B3/*.test.ts`.

- **B3-1 Legion counts tokens** — all `[Legion]` cards (`ogn-020-298`, `ogn-218-298`, `ogn-243-298`, …). `A.createToken` pushes token ids into
  `g.ex.playedThisTurn`, and both `dependenciesMet` (`case 'legion'`) and `C.legion` count them; CR 812.1.c / rules-tests T147 say only
  *cards* count. Proposed: skip `isToken` objects in both checks (keep the `play` event for tokens). LOCAL: `legion()` dependency.
- **B3-2 Unit tokens ignore enter-ready play rules** — `sfd-004-221` Bushwhack ("Friendly units enter ready this turn"), `D.unitsEnterReady`,
  `sfd-171-221` Renata. `createTokenRaw` never consults `playRule.entersReady`. Proposed: in `createTokenRaw`, apply the controller's
  play rules (`applies(ctx, tokenId)` / `entersReady(ctx, tokenId, loc)`) unless the instruction says "exhausted". LOCAL: `createToken`
  replacement effects (Bushwhack: delayed; Renata: static).
- **B3-3 Statics on cards while they are being played** — `sfd-029-221` Rek'Sai ("Friendly units played from anywhere other than a player's
  hand have [Accelerate]"), `unl-146-219` Syndra ("While I'm in a showdown, your spells have [Repeat] [2][C]"), `sfd-054-221` Jax ("Your
  Equipment everywhere have [Quick-Draw]"). Statics only reach board/legend objects, but Accelerate / Repeat / Quick-Draw are read from the
  card in hand/trash/facedown/chain. Proposed: `playRule(applies, { grantKeywords: (ctx, playedId, via) => string[], keywordCosts })`
  consulted by `cardTiming` / `playProcess` (Accelerate cost = [1][C] of the played card; Syndra's Repeat cost [2][C] with C = Syndra's
  domain). TODO: Rek'Sai, Syndra. LOCAL (Jax): `playRule` granting Reaction + board anthem (the built-in Quick-Draw attach fires on play).
- **B3-4 asPlay can't choose the destination** — `unl-147-219` Baron Nashor ("add the Baron Pit … If you do, I enter there"). `playProcess`
  fixes `dest` before running asPlay. Proposed: honour `ctx.data.__destination` set by an asPlay effect (validated like `extraDestinations`),
  or run asPlay before the destination choice. TODO; the Pit is added and its index stored in `ctx.data.baronPit`.
- **B3-5 `mana()` crashes for tokens that kill themselves** — dsl.ts `mana()` effect calls `ctx.domains(abilitySource)` *after* the cost
  (Kill this) was paid; a Gold token no longer exists -> TypeError. Proposed: resolve domains only when `'C'` is in `power`, before paying,
  or fall back to the card def. LOCAL: `unl-t05` Gold overrides the effect with `ctx.add(0, ['any'])`.
- **B3-6 Damage events need source LKI** — `rad-023-167` Ziggs ("Abilities of friendly gear deal 1 Bonus Damage"): a Bomb token's death
  trigger deals damage with `source` = a deleted object id, so the gear/controller can't be checked. Proposed: `damage` events (and the
  replacement event) carry `sourceLki { type, controller, cardId, isToken }`. LOCAL: `gearDeathRecorder` (a die-event observer).
- **B3-7 Excess combat damage** — `unl-018-219` Yeti Brawler, `unl-217-219` Trapping Grounds ("if you assigned 3 or more excess damage").
  Proposed: combat damage records `g.ex.combat.excess[player]` (assigned beyond lethal, incl. prevention shields) and the `conquer` event
  carries it; `ctx.excessDamage(player)`. LOCAL: `excessDamageRecorder` (die-event observer that never triggers; damage − Might at death).
- **B3-8 Static "to a minimum of N"** — `ogn-079-298` Leona ("Stunned enemy units here have -8 [S], to a minimum of 1 [S]"). Inside a
  static `mods` function `ctx.might(id)` excludes every static (recursion guard), so other anthems are ignored for the floor. Proposed:
  `StaticMods.mightFloor` (or `{ might: -8, min: 1 }`) applied in layer 3 after all other arithmetic.
- **B3-9 Battlefield abilities are controlled by the battlefield's owner** — `g.battlefields[i].controller` is never copied to the
  battlefield object, so battlefield triggers' `ctx.controller` = owner, and `onConquerHere`/`onHoldHere` (`ev.player === ctx.controller`)
  miss scores by the other player; choices go to the owner. Proposed: battlefield triggers are controlled by the scoring / acting player
  (or `battlefieldOwnerPlayer`), and the `*Here` helpers match on `ev.bf` only. LOCAL: B3 battlefields (`ogn-275-298`, `rad-157-167`,
  `rad-159-167`, `sfd-207-221`, `sfd-220-221`, `unl-217-219`) match `ev.bf` and act through `asPlayer(ctx, ev.player)`.
- **B3-10 Play data in play triggers** — same as B6 #10 (`ven-023-166` Zed reads `ctx.event.playData.paidAdditional`).
- **B3-11 "One or more" batches** — same as B6 #9 (`sfd-203-221` Battle Mistress "When one or more enemy units die"). LOCAL: skip if a
  trigger of the same source is already queued for a `die` event.
- **B3-12 Optional trigger costs asked when unaffordable** — `optional + cost` triggers (`rad-116-167` Concert Poster, `sfd-020-221` Draven)
  ask yes/no first, then drop the trigger if the cost can't be paid. Proposed: auto-decline (no decision) when the cost can't be paid.
- **B3-13 (rules question) Bomb token with no enemy there** — `tok-bomb` targets "an enemy unit there" (min 1); with none, the whole trigger
  is removed (CR 403.4, T120), so "kill your other Bombs there" doesn't happen either. If the second instruction should still happen, make
  the target `min: 0` in `src/cards/tokens.ts`. B3 tests assume the current behaviour only where an enemy is present.
# DSL / engine requests from scripting agents

## B1 (empower / XP / level / costs) — 2026-11-25

Each entry: card id(s) · exact need · proposed API · local stand-in (if any).

- **B1-1 Zone a card is played from, visible to cost modifiers.** `sfd-010-221` Void Drone ("I cost [2] less to play from anywhere other than your hand"). During `playProcess` the card is already on the chain when `costMods` runs, so the origin zone is lost (only `fromHidden` / `viaFlow` survive). Proposed: `ChainItem.from?: ZoneKind` set before the first `playCost` call (and `ctx.playedFrom()`). Local: `playedFrom()` in batch-B1 reads `item.from` if present, so it starts working as soon as the field exists. Test marked todo.
- **B1-2 Optional additional cost with a self discount.** `ogn-002-298`, `rad-075-167`, `unl-178-219` ("you may X as an additional cost. If you do, I cost [N] less"). Proposed: `additionalCosts: [{ cost, optional: true, discount: { energy: -2 } }]`, with `canPlay` treating the discount as available when the extra cost is payable. Local: `optionalCostDiscount()` in src/cards/helpers/B1.ts (asPlay choice + selfOnly costMod keyed on `item.choices`).
- **B1-3 `ctx.addPlayCost({ extra })` makes the state uncloneable.** The ExtraCost (functions) is stored in `ctx.data.__extraCost`, which becomes `item.choices.playData` / `ev.playData`; the next `applyAction` then throws `DataCloneError` in `structuredClone` (seen with Conscription on the chain). Proposed: keep `__extraCost` out of `ctx.data` (item-local, non-state) or delete it after payment. Local: `addPlayExtra()` wraps the cost and deletes `__extraCost` when the engine pays it.
- **B1-4 "This enters exhausted." for gear.** `unl-136-219` Scryer's Bloom, `ven-062-166` Hextech Formula. Proposed: script option `entersExhausted: true` (checked in `enterBoard`). Local: an `isAdd` (resolves immediately) `enter` trigger that exhausts it — this also emits an `exhaust` event, which a true "enters exhausted" should not.
- **B1-5 Per-turn counters.** `unl-108-219` (gained XP this turn), `rad-080-167` (battlefields conquered this turn), `sfd-055-221` (points scored from holding this turn). Proposed: `g.ex.counts['xpGained:<p>']`, `['conquered:<p>']` (incl. replaced scores), `['holdPoints:<p>']`. Local: helpers read those counts if present, else parse this turn's log.
- **B1-6 `empower` event: who empowered.** `ven-151-166`, `ven-153-166` ("When you empower something else"). Proposed: `emit({ type: 'empower', obj, player })` with the acting player. Local: `empowererOf()` uses `ev.player`, else the controller of the top chain item, else the object's controller.
- **B1-7 Play rules of the card being played.** `unl-117-219` Arachnoid Horror ("I can be played to an occupied battlefield if an enemy unit is alone there"). `destinations()` only consults play rules of board objects. Proposed: also apply the card's own `playRule` abilities with `activeIn: ['hand']` (the script already declares one). Test marked todo.
- **B1-8 Standard-move cost hook.** `unl-163-219` Mageseeker Investigator ("Opponents must pay [A] for each unit beyond the first to move multiple units to my battlefield at the same time"). Proposed: rule `moveCost(player, units, to)` returning extra `[A]` count, added to the move's cost (legality + payment). No local stand-in; test marked todo.
- **B1-9 Might-change replacement.** `ven-069-166` Mel ("would give -[S] to a unit it chooses … an additional -1"), `ven-086-166` Gangplank ("would … give me -[M] … give me +3 [M] instead"). Proposed: `ctx.giveMight` goes through `applyReplacements({ type: 'giveMight', obj, n, source, item, player })`. Gangplank's stun / return-to-hand parts are scripted. Tests marked todo.
- **B1-10 "Your units enter ready" for tokens.** `unl-191-219` Wuju Master [Level 11]. `createToken` doesn't consult play rules. Proposed: `createToken` applies `playRule.entersReady` (or a general "enters ready" rule hook).
- **B1-11 Empower at max (multi-Empower cards).** `ven-134-166` Kayle: Radiance patch lets the Empower ability be activated at max (doing nothing); `canActivate` forbids it. Low priority.
- **B1-12 Split amount that depends on another target.** `unl-192-219` Alpha Strike (damage equal to the chosen friendly unit's Might, split). `splitAmount(ctx)` runs before earlier target groups are visible on ctx, so the number of recipients can't be capped at play time (CR 355.14). Proposed: populate `ctx.targets` progressively in `chooseTargetsFor`. Local: split decided on resolution with `ctx.split(1, might)`.
- **B1-13 Optional additional cost decided before targets.** `unl-140-219` Conscription (target legality depends on paying 5 XP). Proposed: `additionalCosts[].beforeTargets: true`, and roll back a play left without a required target. Local: asPlay choice.
- **B1-14 Look at an opponent's facedown cards.** `unl-053-219` Scuttle Crab. Needs a view/visibility hook. Local: records `g.ex.turnFacts['B1:peekFacedown:<p>'] = opponent`.
- **B1-15 Optional trigger with an unpayable cost.** `unl-109-219` Blood Rose ("you may pay [1]"), `unl-119-219` Kha'Zix (spend 3 XP). `placeTrigger` asks the "you may" prompt even when the cost can't be paid. Proposed: skip the prompt (and the trigger) when `cost` is unpayable. Local: `requires: [dep.custom(canPay)]`.

## B2 (equipment / gear / activated) — filed by scripting agent B2

Local stand-ins live in `src/cards/helpers/B2.ts`; todo tests in `tests/cards/B2/todo.test.ts`. Several entries repeat requests other
batches already filed; the B2 cards are listed so the fix covers them too.

- **B2-1 "This enters exhausted."** (= B1-4) — `ogn-017-298` Iron Ballista, `unl-049-219` Honeyfruit, `ven-075-166` Platewyrm Egg.
  Proposed: `ScriptOpts.entersExhausted: boolean | (ctx) => boolean`, checked in `enterBoard` after the enters-ready rules.
  LOCAL: `entersExhausted()` = an `isAdd` trigger on the card's own `enter` event (it shows up in trigger-ordering prompts).
- **B2-2 Applied cost on standard moves** (= B1-8) — `rad-062-167` Gravity Field ("Opponents must pay [1][A] to move one or more units
  to this battlefield"). Proposed: `rule('moveCost', (ctx, player, units, to) => CostSpec | null)` charged once per move action and
  checked by `canStandardMove` / `moveOptions`. LOCAL: a `move` replacement asks the mover (`mayPayFor`) once per action (keyed by
  `g.actionCount`) and throws `Rollback` if it isn't paid, so the move is offered as legal and then undone. Todo test.
- **B2-3 Earlier target groups visible to later filters** (= B6-3) — `sfd-011-221` Angle Shot ("a unit and an Equipment with the same
  controller"), `unl-045-219` Forgotten Signpost (the cost's exhausted unit must differ from the chosen unit). LOCAL: Angle Shot reads
  this action's `targeted` events; the Signpost cost reads `ctx.item.targets` (available while costs are paid).
- **B2-4 Battlefield trigger controller** (= B4-7, B3-9) — `sfd-221-221` Veiled Temple. LOCAL: matches `ev.bf` only and makes the
  choices for `ev.player` with `chooseFor` / `mayFor`.
- **B2-5 Play data in play triggers** (= B6-10) — `sfd-109-221` Akshan reads `ctx.event.playData.paidAdditional`.
- **B2-6 Modes on triggered abilities** (= B6-11) — `rad-146-167` The Ball, `sfd-049-221` Aphelios choose on resolution.
- **B2-7 Give the next spell [Repeat] with a computed cost** — `sfd-078-221` Temporal Portal ("[Repeat] equal to its cost"). Proposed: a
  delayed `playRule` field `grantRepeat?: (ctx, spellId) => CostSpec` consulted by `playProcess` next to the card's own Repeat.
  LOCAL: an `isAdd` delayed trigger on `spellFinalized` offers to pay the spell's printed cost and sets `item.repeat += 1` (the
  choice comes right after finalization instead of during the Make Choices step).
- **B2-8 Per-turn facts the engine doesn't record** —
  `rad-005-167` Lingering Animus ("a friendly unit **or gear** died this turn"): proposed `kill()` bumps `g.ex.counts['gearDied:<p>']`
  (LOCAL: falls back to the "… died" log entries for gear); `unl-074-219` Frigid Jewel ("your second card each turn"): proposed
  `draw()` bumps `g.ex.counts['draws:<p>']` before emitting each `draw` (LOCAL: `drawOrdinal()` keeps a list in `turnFacts`, seeded from
  the "draws N" log entries); `sfd-116-221` Yone ("a battlefield that was uncontrolled"): proposed `conquer` events carry
  `prevController` (LOCAL: an inert listener records the controller at `contested` / `showdownStart` / `combatStart`; the helper
  already prefers `ev.prevController`).
- **B2-9 Copy effects** — `ven-137-166` Shady Spectacles. (a) `chars()` takes Might from the *printed* card even under `copyOf`, so a copy
  keeps its own Might (todo test). (b) The `'whileSource'` modifier/delay duration is never expired by the engine. LOCAL: the copy
  modifier is tagged with the gear and removed by an `isAdd` trigger on the gear's `detach`.
- **B2-10 "Copy that unit's text to this Equipment's effect text"** — `sfd-059-221` Svellsongur. Proposed: `StaticMods.copyAbilitiesOf?: ObjId`
  (or an effect-section ability kind that mirrors another card's abilities) handled in `activeAbilities`. LOCAL: the host's own
  triggered abilities trigger an additional time (`extraTriggers`) and its summing keywords (Assault N, Shield N, …) are doubled;
  copied statics and activated abilities are not (todo test).
- **B2-11 Facedown cards as targets** — `ogn-181-298` Pack of Wonders ("another friendly gear, unit, or facedown card"). Proposed:
  `ZoneSel 'facedown'` in `targets.ts zoneObjects`. LOCAL: a second mode that picks the facedown card on resolution (not targeted).
- **B2-12 Weaponmaster (engine `builtin.ts`)** — (a) `equipCostMinusA` removes the first power symbol when there is no [A] (Equip [C]
  becomes free), while rules-spec §15 says "if no [A] in the cost, pay it in full" — please confirm which is right. (b) The Equip cost's
  extra parts are paid with a fresh ctx that doesn't know the unit, so `unl-188-219` Hextech Gauntlets ("reduced by the Might of the
  unit you choose") falls back to the most recently played unit. Proposed: pass the host in `ctx.data.equipTarget` for both Equip and
  Weaponmaster payments.
- **B2-13 Play permissions never expire** — `rad-012-167` Runeblade Anvil ("Until your next Ending Phase, you may play that card"):
  `g.ex.playPermissions` entries with `until: 'nextEnding'` / `'endOfTurn'` are never removed.
- **B2-14 Auto-payer and Add abilities with real costs** — `ogn-113-298` Malzahar ("Kill a friendly unit or gear, [T]: [Add] [A][A]"):
  `autoPay` may use it (it then asks which permanent to kill) without asking whether to use it at all, and it ignores the ability's
  Action timing (LOCAL: `if: myTurn || inShowdown`). Proposed: the auto-payer only uses Add abilities whose extra costs are self costs
  (Gold-like), or asks first. Variable Add abilities (`sfd-083-221` Hextech Anomaly, `sfd-117-221` Ancient Henge) are activate-only.
- **B2-15 `mana()` reads the source after paying** (= B3-5) — `unl-t05` Gold (also registered by B3, which loads later and wins); B2's
  copy overrides the effect the same way.

## B5 (removal / interaction) — filed by scripting agent B5

Local stand-ins live in `src/cards/helpers/B5.ts` and `src/cards/scripts/batch-B5.ts`; tests in `tests/cards/B5/`. Several entries
repeat requests other batches already filed; the B5 cards are listed so the fix covers them too.

- **B5-1 Earlier target groups visible to later filters** (= B6-3, B2-3) — `sfd-023-221` Piercing Light ("up to one other unit"),
  `sfd-163-221` Deathgrip ("another friendly unit"), `unl-072-219` Crescent Strike ("an enemy unit there"), `unl-106-219` Repulse ("a
  spell that chooses it"), `ven-154-166` Public Execution ("less Might than it"). LOCAL: `priorPicks()` reads this play's `targeted`
  events; the effects re-check the relation on resolution (needed anyway for Repeat re-choices and "new choices", see B5-3).
- **B5-2 Group validator on a target spec** (= B4-11) — `ogn-256-298` Fox-Fire ("any number of units at a battlefield with total Might 4
  or less"), `ven-107-166` Decree of Discord (total Might 5 or less). LOCAL: `totalMightGroups()` = six single-pick groups, each filtered
  by the running total (declining ends the selection); the total is re-checked on resolution with current Mights.
- **B5-3 Repeat / "make new choices" re-choices** — `chain.ts` (Repeat, CR 820) keeps the first execution's **mode**, doesn't pass
  `data.check: 'sameLocation'`, adds no Deflect cost and emits no `targeted` events; `remakeChoices` (CR 750) has the same gaps and
  doesn't remake modes. Cards: `sfd-077-221` Rocket Barrage ("may make different choices" between its two modes), `sfd-080-221` Bellows
  Breath ("at the same location"), `sfd-023-221`, `sfd-114-221`, `sfd-136-221`, `ogn-080-298` / `ven-152-166` (new choices).
  Proposed: one shared `rechoose(item, chooser)` used by Repeat and remake that asks the mode (if modal) and then targets exactly like
  `chooseTargetsFor`. LOCAL: Rocket Barrage targets "a unit in a base or a gear" in one group and derives the mode from the choice;
  Bellows Breath only damages units at the first target's location.
- **B5-4 Excess combat damage** (= B4-9, B3-7) — `sfd-120-221` Sivir, Ambitious. LOCAL: match-only observers on `combatStart` /
  `damage` keep `turnFacts['B5:sivirExcess:<id>']` (damage beyond lethal actually dealt by your combat damage to enemy units).
- **B5-5 Several Repeat costs** — `unl-182-219` Curtain Call (`[Repeat] — [1] / [A] / [1][A]`: each may be paid once; "Choose one you
  haven't already chosen"). The engine can't parse the cost (no Repeat offered) and supports one repeat. Proposed:
  `costs.Repeat: CostSpec | CostSpec[]` (each optional → `item.repeat = n`, scope 'repeat' cost mods apply) and a `spellModes(...,
  { distinctAcrossRepeats: true })` flag. LOCAL: the costs are offered in an `asPlay`; extra executions pick an unused mode and its
  target on resolution (cost mods with scope 'repeat' don't apply to them).
- **B5-6 A countered Flow spell isn't banished** — CR 391.3.a / rules-tests T159: "Then banish it" also applies when the card leaves the
  chain by being countered. `play.ts counterItem()` trashes it (or returns it to hand). Proposed: `if (item.viaFlow) banish` in
  `counterItem` (before the toHand / toTrash branch). LOCAL: only `unl-131-219` Abandon handles it (counter, then banish).
- **B5-7 Zone a card is played from** (= B1-1) — `sfd-164-221` Drag Under. LOCAL: `fromNonHand()` uses the pre-play zone, else
  `item.fromHidden` / `item.viaFlow` / a matching `g.ex.playPermissions` entry (misses scripted `playFrom` permissions).
- **B5-8 "This can't be countered" on the spell itself** — `ven-015-166` Decree of Rage. `rule()` abilities are only active on board
  sources, so a spell's own `rule('cantBeCountered')` never applies. Proposed: `ScriptOpts.uncounterable` (or rule abilities with
  `activeIn: ['chain']`). LOCAL: an `asPlay` registers a delayed `cantBeCountered` rule for that object.
- **B5-9 Play by an effect for an alternative cost** — `unl-020-219` Dancing Grenade, `unl-186-219` Death from Below ("you may play this
  … for [A]"). `ctx.play()` only supports the full cost or ignoring it. Proposed: `ctx.play(id, { cost: CostSpec })` (cost replaces the
  base cost, Deflect / additional costs still apply). LOCAL: the delayed `B5:replayForA` trigger (on `spellResolved` of that card) pays
  [A] with `ctx.pay`, then plays it ignoring its cost (so "amount spent" effects see 0 for that play).
- **B5-10 Battlefield trigger controller** (= B4-7, B3-9, B2-4) — `unl-209-219` Dusk Rose Lab ("your Beginning Phase": matched against
  `g.battlefields[i].controller`, choices via `asPlayer`), `unl-212-219` Frozen Fortress (its damage is attributed to the battlefield's
  owner; matters for `anyDamageLethal` / kill attribution).
- **B5-11 Play data in play triggers** (= B6-10) — `rad-014-167` Shimmering Swimmer, `sfd-013-221` Blast Corps Cadet, `sfd-160-221`
  Zaun Punk read `ctx.event.playData.paidAdditional` (`playData()` helper).
- **B5-12 Destination re-check after costs vs Stalking Wolf** — `unl-166-219`: `playProcess` step 5 re-validates the destination after
  paying (CR 358), so killing the only friendly unit at the Ambush battlefield as the additional cost rolls the play back, but the card
  says "You may [Ambush] me to its battlefield, even if you don't have other units there". LOCAL: the cost registers a one-off delayed
  `playRule({ extraDestinations })` for that battlefield. Proposed: `additionalCosts[].keepsDestination` or a generic way for a cost to
  extend legal destinations.
- **B5-13 Optional additional cost with a discount / variable discount** (= B1-2, B4-13) — `rad-125-167` Dune Devourer, `ogn-231-298`
  Commander Ledros. LOCAL: `selfCostDyn` assumes the best case while no chain item exists (legal-play enumeration), the real choice is
  used during the play (Dune: `additionalCosts` entry with `energy: -2`; Ledros: units chosen and killed in `asPlay`, count in
  `item.choices.ledrosN`); an unaffordable play is rolled back.
- **B5-14 `ctx.lethallyDamaged()` ignores `anyDamageLethal`** — "If this kills it" (`ogn-005-298` Disintegrate) is false for a 1-damage
  hit under `unl-118-219` Elder Dragon. Proposed: include `ruleApplies(g, 'anyDamageLethal', damageSrc.player, id)`. LOCAL: Disintegrate
  also checks `rules.anyDamageLethal()`.
- **B5-15 Optional trigger with an unpayable cost** (= B1-15, B3-12, B4-14) — `rad-137-167` Mordekaiser, Dominating ("you may discard
  1 to …"). LOCAL: `requires: [dep.custom(hand not empty)]`.

## B8 (legends / battlefields / rules) — filed by scripting agent B8

Each entry: card(s), exact need, proposed API. Local stand-ins live in `src/cards/helpers/B8.ts` or next to the card in
`src/cards/scripts/batch-B8.ts`; todo tests are in `tests/cards/B8/*.test.ts`.

- **B8-1 Battlefield ability controller** — every "When you conquer/hold/defend/score here" battlefield. DONE by the engine
  (`abilityController`). B8 still runs those effects through `asP(ctx, ev.player)` (helpers/B8.ts) because several texts name
  another player ("that player", "they", "each player"); proposed DSL helper: `ctx.as(p)` returning a Ctx for player p.
- **B8-2 Move count per object per turn** — `ogn-189-298` Kayn ("If I have moved twice this turn"). Proposed:
  `GameObject.movesThisTurn: number` next to `movedThisTurn`. LOCAL: a pass-through `move` replacement counts moves.
- **B8-3 Zone moves without a ctx API** — `ogn-281-298` Hallowed Tomb (trash → Champion Zone), `unl-181-219` Virtuoso (banishment →
  trash), `rad-167-167` Neeko (set-aside legend → Legend Zone and back). Proposed: `ctx.toZone(id, 'trash' | 'championZone' |
  'legendZone' | 'setAside')`, plus `PlayerState.chosenChampion: ObjId` (LOCAL: the object created right after the legend).
- **B8-4 "Activate the conquer effects of units here"** — `ogn-286-298` Reckoner's Arena. LOCAL: `activateConquerEffects()` queues
  the units' conquer triggers with a synthetic `conquer` event (match/condition/dependencies checked, CR 383.4.g). Proposed:
  `ctx.activateTriggers(units, eventType, event)` in the engine.
- **B8-5 Extra legends** — `rad-167-167` Neeko. Proposed: `ctx.addLegend(id, { while: 'sourceOnBoard' })` that moves a legend from
  `g.ex.extraLegends` into the Legend Zone and returns it when the source leaves the board. LOCAL: delayed `leaveBoard` trigger.
- **B8-6 Either/or discounts "[1] or [A] less"** — `sfd-141-221` Irelia, `sfd-149-221` Ezreal, `ven-163-166` Risen Altar.
  Proposed: `costMod(applies, { either: [{ energy: -1 }, { power: -1 }] })` with the payer choosing when both matter.
  LOCAL: [1] off the Energy when there is Energy, otherwise one Power (`oneOrA`).
- **B8-7 Spending restrictions the payer can't express** — `ogn-247-298` Daughter of the Void (`[Add] [C]` on a two-domain legend:
  only the first domain is produced), `sfd-189-221` Fire Below the Mountain ("gear or gear abilities": only gear), `ven-141-166`
  Butcher of the Sands ("units or activated abilities of units": only units), `unl-197-219` Scorn of the Moon ("only during
  showdowns": LOCAL usable only in showdowns). Proposed: `RestrictedResource.only` as a predicate key set
  (`'gearOrGearAbility' | 'unitOrUnitAbility' | 'showdown'`) and `power: ['C']` producing a chosen domain of the card.
- **B8-8 Hide cost modifiers / alternative hide cost** — `ogn-263-298` Swift Scout ("You may pay [1] to hide a card instead of [C]").
  `hideAction` / `canHide` use a fixed `[A]`. Proposed: `costMod(..., { scope: 'hide' })` consulted there plus an alternative
  cost list `{ energy: 1 }`. Not functional (test todo).
- **B8-9 Play rules for every player / entry rules for tokens** — `rad-019-167` Firebrand Raider ("Other units enter ready"),
  `ven-157-166` Dragon Roost ("Any player may ..."). `playRules()` only applies to the rule's controller and `createToken` ignores
  `entersReady`. Proposed: `playRule(..., { anyPlayer: true })` and honour `entersReady` rules in `createTokenRaw`.
  LOCAL (Raider): an immediate (`isAdd`) `enter` trigger readies other players' units and tokens as they enter.
- **B8-10 Optional cost modifiers ("you may pay [1][A] less")** — `rad-068-167` Orianna. LOCAL: the costMod asks while the card is
  being played (chain item known) and remembers the answer; legality checks assume "yes". Proposed: `costMod(..., { optional:
  'prompt' })` asked once in playProcess.
- **B8-11 Optional additional costs offered by other cards** — `rad-151-167` Starry-Eyed Songstress. LOCAL: asked from the costMod
  while the spell is being played (exhausting the legend + 3 units then). Missing: legality (`canPlay`) doesn't know the option,
  so a spell only affordable with it isn't offered (test todo). Proposed: `PlayRuleAbility.additionalCost` (same as CONFORMANCE N6).
- **B8-12 Replacement of Add events** — `sfd-201-221` Chem-Baroness ("your Gold [Add] an additional [1]"). Proposed:
  `applyReplacements(g, { type: 'add', player, energy, power, source })` in `addResources`. LOCAL: an immediate `add` trigger adds [1]
  right after the Gold's Add (the Gold is identified through its `die` LKI).
- **B8-13 Amount spent on a play** — `unl-181-219` Virtuoso ("if you spent [4] or more"). Same as B6-5. LOCAL: printed Energy cost,
  0 when played from face down.
- **B8-14 Neeko deck construction** — `rad-167-167`. `validateDeck` should check `DeckList.extraLegends`: only with Neeko in the deck,
  at most 3, names differ from each other and from the starting legend.
- **B8-15 cantMove in standard-move legality** — Vilemaw's Lair, Minotaur Reckoner, Determined Sentry. DONE by the engine.
- **B8-16 Keywords on the next card played** — `rad-162-167` Firelights' Hideout ("the next unit you play this turn has [Accelerate]").
  Proposed: a delayed static that applies to cards being played (`affects` evaluated for hand / chain objects).
  LOCAL: Accelerate modifiers on the player's unit cards in hand / Champion Zone / facedown (and cards drawn later this turn),
  removed when the next unit is played.
- **B8-17 Play destination in cost modifiers** — `rad-163-167` Hunters' Circle, Dragon Roost. DONE by the engine (`ctx.data.dest`).
- **B8-18 Granting [Repeat] with a cost** — `unl-216-219` The Academy. LOCAL (same approach as B2's Temporal Portal): an immediate
  `spellFinalized` delayed trigger offers to pay the spell's base cost and sets `item.repeat`. Proposed: `ctx.grantRepeat(itemId, cost)`
  offered in the Make Choices step.
- **B8-19 "Any player" battlefield play permission** — `ven-157-166` Dragon Roost: works for the battlefield's controller (or the turn
  player while uncontrolled); an opponent of its controller can't use it (test todo). See B8-9 / CONFORMANCE N6.
- **B8-20 Per-combat "excess damage assigned"** — `unl-187-219` Piltover Enforcer. Proposed: `g.ex.combat.excess[player]` filled by
  `combatDamageTask`. LOCAL: a `damage`-event tracker reset at each combat / showdown start.
- **B8-21 Batches of simultaneous events** — `ogn-261-298` Radiant Dawn ("When you stun one or more enemy units"). Same as B6-9.
  LOCAL: one trigger per stunning instruction (keyed by action + resolving chain item).
- **B8-22 Per-turn record of choices** — `sfd-199-221` Prodigal Explorer ("if you've chosen enemy units and/or gear twice this turn
  with spells or unit abilities"), `ogn-292-298` The Dreaming Tree. Same as B6-7. LOCAL: silent `targeted` trackers.

## B7 (card flow / zones) — filed by scripting agent B7

Each entry: card(s), exact need, proposed API. Local stand-ins live in `src/cards/helpers/B7.ts` (marked LOCAL); todo tests are in
`tests/cards/B7/engine-gaps.test.ts` and `tests/cards/B7/trash.test.ts`.

- **B7-1 Look / reveal hooks** — `ogn-194-298` Nocturne ("As you look at or reveal me from the top of your deck, you may banish me.
  If you do, you may play me for [A]."), `sfd-018-221` Void Hatchling ("If you would reveal cards from a deck, look at the top card
  first. You may recycle it. Then reveal those cards."). `A.lookTop` / `A.reveal` / `A.predict` / Vision / `E.lookTop` /
  `ctx.revealTop` call no hook. Proposed: route every look/reveal of deck cards through one engine function
  `lookDeck(g, { actor, deckOwner, n | until, reveal })` that (1) passes a replaceable `revealDeck` event (Hatchling = `replacement`)
  and (2) runs immediate "as you look at me" abilities of the looked-at cards (`activeIn: ['mainDeck']`, resolved inline like `isAdd`).
  LOCAL: `topCards()` / `revealUntil()` / `lookPick()` apply both for every B7 card; other batches' look/reveal effects don't (tests todo).
- **B7-2 Partial costs for effect plays** — "ignoring its Energy cost" (Power still paid: Soulgorger, The Harrowing, Kai'Sa, Fizz,
  Clocktower Guardian, Rift Herald, Promising Future), "reducing its cost by [N]" (Reinforce, Wild Claw, Void Rush, Here to Help),
  "play me for [A]" (Nocturne), "ignoring any and all costs" (Bone Skewer: no optional additional costs such as Accelerate).
  `ctx.play()` only knows full cost or free. Proposed: `ctx.play(id, { cost: 'full' | 'free' | 'noEnergy' | { reduce: N } |
  { pay: CostSpec }, noAdditional?: boolean })`, computed through `playCost` + cost modifiers and paid inside `playProcess` with the
  card's purpose. LOCAL: `playIt()` pays the remainder with `ctx.pay` first (purpose 'ability', so spell/unit-only restricted resources
  can't be used and cost modifiers of the played card are ignored), then plays it ignoring its cost.
- **B7-3 Destinations of effect plays** — "If it's a unit, play it here" (Ava Achiever, Rek'Sai), "to that battlefield" (Bone Skewer),
  "to the same location" (Temporal Breach, Chronobreak), "to any battlefield" (Thrill of the Hunt, Last Caress). Proposed:
  `ctx.play(id, { destinations: Destination[] })` bypassing `destinations()`. LOCAL: a one-shot delayed `playRule` with
  `extraDestinations` matched by object + epoch (`EXTRA_DEST`). Also: facedown plays ignore `extraDestinations` (`destinations()`
  returns early for via 'hidden'), so Last Caress's "even from face down … any battlefield" doesn't work (test todo).
- **B7-4 "Then recycle it" / "Then banish this" for spells played by effects or permissions** — Kai'Sa, Fizz (recycle),
  Forbidden Technique, Kennen's granted Flow (banish, also when countered). `item.choices.banishAfter` only covers resolution and has
  no recycle option. Proposed: `ChainItem.leaveTo: 'banish' | 'recycle'` honoured by resolveTop and counterItem, settable through
  `ctx.play(id, { then })`. LOCAL: a delayed `toTrash` replacement keyed by object + chain epoch (`AFTER_CHAIN`, `afterChain()`).
- **B7-5 Granting [Flow] with a cost (engine bug)** — `ven-113-166` Kennen ("give a spell in your trash [Flow] equal to its cost this
  turn"). Giving the keyword with `ctx.giveKeyword(id, 'Flow')` makes `playOptions` offer a 'flow' play whose `keywordCost` is null and
  `resolveCost(null)` = free. Proposed: keyword costs on modifiers (`addKeywordCosts: { Flow: CostSpec }`) and no 'flow' option without
  a cost. LOCAL: `ctx.allowPlay(spell, 'endOfTurn')` (its own cost) + banish replacement; the keyword isn't shown.
- **B7-6 Amount spent on a spell** — `unl-089-219` Jhin ("If you've spent [4] or more to play a spell this turn"), `unl-211-219`
  Forgotten Library ("if you spent [4] or more"). Same as B6-5 / B8-13. LOCAL: `estSpent()` = 0 from hiding, Flow Energy from the trash,
  otherwise printed Energy (Jhin can't see where earlier spells came from: printed Energy). Test todo.
- **B7-7 Hide cost modifiers** — `ogn-264-298` Guerilla Warfare ("You can hide ignoring costs this turn"). Same as B8-8. LOCAL: a
  delayed `costModDyn(..., { scope: 'hide' })` (`HIDE_FREE`) is registered; inert until `canHide`/`hideAction` consult it. Test todo.
- **B7-8 Target-dependent discounts in legality** — `unl-168-219` Undying Loyalty ("This costs [2] less if you choose a Bird, Cat, Dog,
  or Poro"). The discount works while playing (`selfCostDyn` reads `ctx.item.targets`), but `canPlay` checks the cost without targets,
  so the card isn't offered when only the discounted cost is affordable. Proposed: `canPlay` evaluates the cost per candidate target
  set (or the cheapest) for cost mods flagged `dependsOnTargets`. Test todo.
- **B7-9 Earlier target groups in later filters** — `ogn-220-298` Facebreaker ("a friendly unit and an enemy unit at the same
  battlefield"), `unl-083-219` Smoke and Mirrors ("another unit you control at a different location"). Same as B6-3. LOCAL:
  `chosenSoFar()` (item targets at resolution, this action's `targeted` events while choosing).
- **B7-10 Drawing a specific card** — "reveal a gear from among them and draw it", "Draw any you didn't banish" (Ornn, Double Trouble,
  Fate Weaver, Void Rush, Called Shot …). `ctx.draw()` only draws from the top. Proposed: `ctx.drawCard(id)` that applies `draw`
  replacements and emits `draw`. LOCAL: `drawSpecific()` = `toHand` + `draw` event (no replacement).
- **B7-11 Deck card to trash without burning** — "Put the rest into your trash" (Lightning Rush), Pakaa Protector. Proposed:
  `ctx.toZone(id, 'trash')` (see B8-3). LOCAL: `deckToTrash()` puts it on top and burns 1 (emits a `burn` event).
- **B7-12 Move destination chosen as the spell is played** — `ven-105-166` Twilight Step (CR 355.4). LOCAL: destination chosen on
  resolution. Proposed: a `destination` target spec kind recorded on the chain item.
- **B7-13 Move count per turn** — `rad-015-167` Akali ("The first / second time I move each turn"). Same as B8-2. LOCAL: the first
  trigger's match bumps `counts['B7:akaliMoves:<obj>#<epoch>']`, the second matches when it is 2.
- **B7-14 Acting as another player** — opponents choose / play / pay (Party Favors, Scrutinizing Scope, Promising Future, Bone Skewer,
  Portal Rescue, Chronobreak, battlefields). Same as B8-1's `ctx.as(p)`. LOCAL: `asPlayer(ctx, p)`.

## ENGINE responses (2026-11-25)

DONE = implemented in src/engine (additive). Keys in `g.ex.counts` are per turn (reset at turn start).

| Request | Status |
|---|---|
| B6-1 multiple buffs | DONE: `rule('multipleBuffs', (ctx, unit) => ...)` is consulted by every buff. |
| B6-2 delayed statics | DONE: `delayedAbility(key, statik(...))` + `ctx.delay(key, data, 'endOfTurn')` is applied by layers (ctx.data = data, ctx.controller = creator). |
| B6-3 / B1-12 earlier target groups | DONE: while group i is being chosen, `ctx.target(j<i)` / `ctx.targetsOf(j)` hold the earlier choices (filters and `splitAmount`). |
| B6-4 / B1-3 addPlayCost extras in state | DONE: only energy/power go to `ctx.data.__extraCost`. `extra` parts live in a step-local side table and never reach state. |
| B6-5 / B4-5 amounts paid | DONE: `play`/`spellFinalized` events carry `paid: {energy, power}` (also `item.choices.paid`). Counts: `energySpent:p`, `powerSpent:p` (all payments), `maxSpellEnergy:p`, `spellEnergy:p`. |
| B6-6 extraTriggers for keyword triggers | DONE: Hunt/Vision/Disarm/Deploy/... go through `suppressTrigger` / `extraTriggers`. |
| B6-7 chose an enemy unit this turn | DONE: counts `chose:p`, `choseEnemy:p`. |
| B6-8 played to a battlefield | DONE: count `playedToBf:p`. |
| B6-9 batches | DONE: every event has `ev.batch` (consecutive same-type events share it). Simultaneous triggers are ordered per batch, and batches go on the chain chronologically. |
| B6-10 / B3-10 play data in play triggers | DONE: a "when you play me" trigger's `ctx.data` is seeded with the play data (`paidAdditional`, `shownOff`, ...). |
| B6-11 modes on triggers | open (choose on resolution for now). |
| B6-12 isAdd trigger timing | open. |
| B6-13 activated event info | DONE: `activated` has `cardId`, `cardType`, `sourceType`. |
| B4-1 / B1-7 / T181 hand-active play rules | DONE: the played card's own `playRule` abilities and its own `rule(...)` abilities (e.g. `cantPlay` "Play me only to …") apply while it is being played from any zone. |
| B4-2 Ambush extra destinations | open (use `playRule extraDestinations` + `grantsTiming: 'reaction'`). |
| B4-3 conquered this turn | DONE: `g.ex.turnFacts['conquered:p']` (bf indexes), `ctx.conqueredThisTurn(p)`, count `conquered:p`. |
| B4-4 deaths in Beginning phase | DONE: count `unitsDiedBeginning:p`. |
| B4-6 mover for cantMove | DONE: `cantMove(unit, from, to, mover)`. |
| B4-7 / B3-9 battlefield controller | DONE: battlefield abilities (triggers, statics, replacements, rules, costMods, playRules) are controlled by the battlefield's controller, or the TP if it is uncontrolled. |
| B4-8 static conditioned on own Might | open. |
| B4-9 / B3-7 excess damage | DONE: `ctx.excessDamage(p)` (`g.ex.turnFacts['excess:p']`) and `g.ex.combat.assigned[p]`. |
| B4-10 moves per turn | DONE: `GameObject.movesThisTurn`. |
| B4-11 group validator | open. |
| B4-12 gain a tag | DONE: `ctx.addTag(id, tag, dur)`. |
| B4-13 / B1-2 / B1-13 choice-dependent additional costs | open. |
| B4-14 / B1-15 / B3-12 unpayable optional trigger cost | DONE: a trigger with a `cost` that can't be paid is removed without asking. |
| B4-15 granting another object's abilities | open. |
| B3-1 Legion ignores tokens | DONE. |
| B3-2 / B1-10 tokens and enter-ready play rules | DONE: unit tokens apply the controller's `entersReady` play rules unless the instruction gives `exhausted`. |
| B3-3 keyword grants to cards being played | open. |
| B3-4 asPlay chooses the destination | DONE: set `ctx.data.__destination = bfIndex \| 'base'` in an asPlay effect. |
| B3-5 mana() on self-killing tokens | DONE. |
| B3-6 damage source LKI | DONE: `damage` events carry `sourceLki {type, controller, cardId, isToken}`. |
| B3-8 static "to a minimum of N" | open. |
| B1-1 zone played from | DONE: `ChainItem.from` + `item.choices.from`. Cost modifiers see `ctx.data.from` and `ctx.data.dest` (B8-17). |
| B1-4 enters exhausted | DONE: script option `entersExhausted: true`. |
| B1-5 per-turn counters | DONE: `xpGained:p`, `conquered:p`, `holdPoints:p`. |
| B1-6 who empowered | DONE: `empower` event has `player` (`ctx.empower` passes the controller). |
| B1-8 standard-move cost hook | open. |
| B1-9 / N4 Might-change replacement | DONE: `ctx.giveMight` emits replaceable `{type:'giveMight', obj, amount, source, player, chosen, duration}`. `stun`/`returnToHand` replacement events carry `source` + `chosen`. A replacement may return `{type:'giveMight', amount}` instead of the stun/bounce. |
| B1-11 Empower at max | DONE (multi-Empower cards only). |
| B1-14 look at facedown cards | open. |
| B8-7 spending restrictions | DONE: `only` may be `'spell' \| 'unit' \| 'gear' \| 'unitOrGear' \| 'ability' \| 'unitOrUnitAbility' \| 'gearOrGearAbility' \| 'showdown'`, and several can be combined with `\|`. The multi-domain `[C]` Add choice is still open. |
| B8-15 standard move checks cantMove | DONE. |
| B8-17 destination visible to cost mods | DONE (`ctx.data.dest`). |
| N2 test state builder | DONE: `src/engine/testkit.ts` (`place`, `attachNow`, `addPreventShield`, `setPoints`, `setXp`, `setBattlefieldController`, `touch`). |
| N3 total-cost query | DONE: `playCostOf(g, p, obj, {dest})` exported from `src/engine/index.ts`. |
| N6 / B8-19 Dragon Roost, N7 another player's base | open. |
- B4 status (end of B4 session): #1 (hand-active play rules), #3 (`conquered:<p>`), #4 (`unitsDiedBeginning:<p>`), #5
  (`powerSpent:<p>` / `maxSpellEnergy:<p>`) and #6 (mover passed to `cantMove` by `moveUnits`; standard-move legality still passes
  none) are in the engine now and the B4 scripts use them. #10: `GameObject.movesThisTurn` exists but isn't reset at turn start /
  on new objects yet, so B4 keeps its own counter. Still open: #2 (only Rengar, Trophy Hunter's todo test), #7–#9, #11–#15.

## ENGINE responses — PHASE 2 unification (2026-11-26)

See docs/unification-plan.md for the stand-in -> primitive map. All DONE unless noted.

| Request | Status |
|---|---|
| B6-11 / B6-12 / B4-8 / B4-11 / B4-15 | DONE (event batches, immediate triggers, movesThisTurn, excess record, turn history). |
| B4-2 Ambush-like play rules | DONE: `playRule(applies, { ambush: (ctx, id, bf) => ... })` (Rengar migrated). |
| B4-13 / B1-2 / B1-13 optional discounted costs | DONE: `additionalCosts: [{ cost, optional, discount, beforeTargets, keepsDestination }]`; legality enumerates payable combos; a required one isn't offered as optional. |
| B3-3 / B8-16 keywords while played | DONE: `playRule(..., { grantKeywords, keywordCosts })` (Syndra migrated); several Repeat costs (B5-5). |
| B3-4 asPlay destination | DONE: `ctx.data.__destination = loc` in an asPlay (Baron Nashor). |
| B1-8 / B2-2 move costs | DONE: `rule('moveCost', applies, undefined, { cost: (ctx, p, units, to) => CostSpec })`. |
| B8-8 / B7-7 hide costs | DONE: `playRule(() => false, { hideCost: (ctx, id) => CostSpec })` + `costMod({ scope: 'hide' })`. |
| B8-9 / B8-11 / B8-19 / N6 play-rule costs | DONE: `playRule(..., { anyPlayer, additionalCost: { cost, label, key, destination?, discount? } })`; non-resource parts act for the rule's source. |
| B7-3 / B7-4 effect plays | DONE: `ctx.play(id, { cost, destinations, then, noAdditional })`, `ctx.canPlayByEffect`. |
| B7-8 target-dependent discounts | DONE (legality tries first-group candidates incl. Deflect, F-3b). |
| B8-7 multi-domain [C] | DONE. |
| R-1..R-8, R-10..R-16 | DONE (R-2: `T.destination(F.moveDestFor(i))`, `ctx.destination(i)`, `E.moveToChosen(u, d)`; 4 cards migrated, the rest listed in the plan). R-9: doc only. |
| SF-1 Gear Units | DONE: isGear / isUnit / F.gear read `additionalTypes`. |
| F-1..F-6 | DONE: validate('activate') = enumerated set; counters in state; joint target feasibility + Deflect-aware affordability + required optional costs; bot skips undone actions and validates answers; ids assigned after the shuffle, view.cards limited; units detached in cleanup. |
| Nocturne / Void Hatchling (B7 look hooks) | DONE: engine `lookedAt` trigger / `revealDeck` replacement — every look/reveal from every batch. |
| N4 "would give -Might", N7 other player's base, B2-10 Svellsongur full text | DONE (ENGINE-2 2026-11-26): N4 via the giveMight/stun replacement events (T173/T174 pass); N7 for Temporal Breach in the script (owner can't play into another player's base → stays banished, T187); B2-10 Svellsongur copies statics (`StaticAbility.refs`, `idempotent`), rules, replacements and cost mods |

## From RULINGS (2026-11-25)

Researched verdicts that need src/engine changes. Full reasoning and sources in docs/rulings.md.

- **R-1 Bulleted modes on triggered abilities are chosen when the trigger goes on the chain** (CR 403.2 "Make all choices required
  for this ability, such as targets, modes"; CR 355.3; Radiance FAQ, Riven, Broken Blade: "The first part of Riven's triggered ability
  is 'Choose one…'", and the buff is spent on resolution). Same as B6-11. Proposed: `TriggeredAbility.modes?: Mode[]` (+ `chooseModes`)
  chosen in `placeTrigger` before targets, exactly like activated abilities (`item.mode`, per-mode targets; no legal mode → removed,
  CR 403.4). A mode whose text is "Spend my buff to …" / "Pay [C] to …" is a cost inside the instructions: it is chosen at finalization
  and paid on resolution (CR 383.3.b). Needs a mode filter hook for "choose one that hasn't been chosen this turn" (`remember` at
  finalization). Cards now choosing on resolution: `rad-043-167` Riven, Broken Blade; `ven-088-166` Jayce, Hammer in Hand;
  `rad-105-167` Reckless Innovator; `rad-146-167` The Ball; `sfd-049-221` Aphelios; `ven-111-166` Minah Swiftfoot.
  (Not affected: non-bulleted "A or B" choices such as Royal Entourage "ready or exhaust" or Qiyana "draw 1 or channel 1" are made on
  resolution, CR 355.18.)
- **R-2 Move destinations are chosen when the spell/ability is played or the trigger goes on the chain** (CR 355.4 "choose a valid
  Location as the Move Destination for each Move that will be performed"; 355.4.a valid = not the current location and allowed;
  403.2 for triggers/abilities). Extends B7-12 to base destinations, activated abilities and triggers. Proposed: a `T.destination(of:
  groupIndex | 'self', allowed?)` spec kind whose options are `'base' | bfIndex` (validated against the earlier target group's
  location), stored in `item.choices`, read with `ctx.destination(i)`; at resolution an illegal destination makes that move do nothing.
  Cards choosing on resolution today: `unl-038-219` Skyward Strike, `rad-096-167` Satchel Charge, `ven-105-166` Twilight Step,
  `rad-033-167` Command: Attack, `sfd-184-221` Relentless Pursuit, `unl-054-219` Tricksy Tentacles, `ogn-259-298` Unforgiven,
  `unl-144-219` Maduli, `ven-140-166` Shuriken Flip (its "move a friendly unit" unit is also a target, CR 355.5), every
  `moveChosen()` user in batch-B4/B5 and `moveAnywhere()` in batch-B6 (`grep -n "moveChosen\|moveAnywhere\|chooseLocation" src/cards`).
  Battlefield-only destinations can already be picked at finalization with `T.battlefield(filter, { pick: true })` (done for Bard).
- **R-3 Awaken readies are performed by the turn player** (CR 315.1.b "The Turn Player readies all Game Objects they control";
  CR 416.3.a; CR 412.1 the performer is responsible; 412.4 "when you …" triggers on actions you are responsible for).
  `turn.ts awaken()` calls `ready(g, ids, null, true)`; it should pass the turn player as `by`. Pirate's Haven (`ogn-143-298`) works
  around it locally (player null + phase 'awaken' + active player).
- **R-4 Split damage with fewer damage than targets** (CR 355.14.h-h.1: the controller of the damage chooses which targets stop being
  targets; each remaining target gets ≥ 1, 355.14.f-g). `ctx.split()` assigns 1 to the earliest targets in order, so the player can't
  pick which ones drop. Alpha Strike does it locally.
- **R-5 Mandatory target groups with no candidates while playing** (CR 355.17, 358.1, 358.5: a required choice that can't be made
  fails the legality check and the play is undone). `chooseTargetsFor` continues with an empty group when candidates disappear after
  `canPlay` (e.g. an asPlay choice narrowed the filter). Proposed: throw `Rollback` when `spec.min ?? 1 > 0` and there are no
  candidates. Conscription works around it (the XP cost is forced when declining would leave no legal target).
- **R-6 `pick: true` specs in triggers** — `placeTrigger` emits `targeted` and computes Deflect for every chosen id, ignoring
  `spec.pick` (`chooseTargetsFor` honours it for spells). Bard's battlefield pick triggers a `targeted` event on the battlefield card.
- **R-7 Reflexive "do the following" items** (CR 387.1.b; Vendetta FAQ, Hwei with Patched Porobot: "Two triggers will go on the chain,
  in the order of your choosing"). Hwei (`unl-080-219`) resolves the type branches inline. Proposed: `ctx.reflexive(effect, {targets})`
  that puts a new pending trigger item on the chain. Data note: `ven-058-166` Patched Porobot is typed only `Unit` in data/cards.json
  (it is a Unit and a Gear per the FAQ), so multi-type branches can't be detected.
- **R-8 `whenYouPlay` excludes the source** — "When you play a [card/unit/…]" without "another" includes the card itself (Origins FAQ,
  Darius, Trifarian: "Triggers are checked right after the event, while Darius is on the board"; CR 383.2.c.1). `whenYouPlay` skips
  `ev.obj === ctx.self`, which is right only for "another". Piltovan Guidebot now uses `when('play', …)`. Suggest a `self: true`
  option and an audit of `whenYouPlay` users whose text lacks "another".
- **R-9 rules-decisions #22 is stale** — Vision is already a summing keyword and each instance triggers (`builtin.ts`), matching
  CR 817.2 ("Multiple instances of Vision trigger separately"). Test: tests/rules/rulings.test.ts. Only the decision text needs updating.
- **R-10 Weaponmaster with no [A] in the Equip cost** (CR 821.1.c.3: "If the chosen card's Equip cost does not contain [A], it can
  still be paid, but will not be reduced"; 821.1.c.2: the cost is computed as if Equip were activated targeting the Weaponmaster
  unit, incl. Equip cost modifiers). `builtin.ts equipCostMinusA` removes the first power symbol when there is no 'A' — drop that
  `else` branch and apply Equip cost modifiers (Hextech Gauntlets reduces by the Weaponmaster unit's Might). Also 821.1.c.1: an
  Equipment without an Equip ability may be chosen (then it can't be paid, 821.1.c.4-5); the choice is made as the trigger goes on the
  chain ("When you play me, you may choose …", CR 403.2), not on resolution. SFD-FAQ: Weaponmaster is optional.
- **R-11 "Becomes Mighty" on every Might change** (CR 709: "becomes Mighty" at the moment its Might changes from less than 5 to 5 or
  greater; 711: off-board cards use printed Might, so a unit entering with 5+ printed Might does not become Mighty). `becameMighty` is
  emitted only by `addModifier` and `buff`; it is missed when a static/anthem starts applying, a negative modifier expires, or a unit
  moves into range of a "here" bonus. Proposed: compare each unit's Might before/after every layer recompute (or in cleanup) and emit
  then. Grand Duelist (`sfd-205-221`), B6 `becameMighty` users.
- **R-12 "I don't take damage" in damage assignment** — DONE (ENGINE-4, RJ#6949: `replacement(..., { noDamage: true })` → exempt). Kayn (`ogn-189-298`, after moving twice). rules-decisions #10 makes a
  prevent-'all' shield exempt from the lethal-first requirement; a static "don't take damage" should be treated the same (best call,
  no official answer; CR 467.2.c.3/6). **SUPERSEDED (prevent-'all' half)** by docs/riftjudge/DECISIONS.md row A-3 / principle 24: CR 467.2.c.10
  answers it officially — "can't be dealt damage" (Kayn) is exempt (receives only excess), but a prevention shield is a replacement and is
  NOT exempt (Counter Strike example); prevent-all → no reachable lethal, it soaks the rest. The Kayn half stays DONE.
- **R-13 "Can't be played" applies to plays by effects** (CR golden rule "Can't beats Can"). Ol' Poro (`ven-029-166`) uses
  `spell(..., { playIf })`, which `canPlay` checks only for the player's own plays; `ctx.play` from effects ignores it, and
  `ruleApplies('cantPlay')` is skipped for permanents in `canPlay`. Proposed: check `cantPlay` rules and `playIf` in `playProcess` for
  every play (roll back if it fails).
- **R-14 Earlier target groups visible to later filters in triggers and at resolution** — B6-3 made `ctx.target(j<i)` visible while
  *playing* spells, but `placeTrigger` and the resolution-time re-validation (`ctxForItem`) evaluate group i's filter without the
  earlier groups. Scripts use `ctx.target(0) ?? ctx.item?.targets?.[0]?.[0]` as a stopgap (Bedeviling Stranger, Strike Down,
  Relentless Pursuit).
- **R-15 Optional trigger with no legal targets** — `placeTrigger` asks the "you may" question before checking targets, so a trigger
  that will be removed (CR 403.4) still prompts (Lady of Clockwork with no gear). Harmless; proposed: skip the prompt when a mandatory
  target group has no candidates.
- **R-16 Pending triggers are finalized only after the cleanup (HIGH)** — CR 334.1 "Chain Items may be added to the Chain. They will
  remain there until the Tasks are complete."; 334.2 "When all Outstanding Tasks are completed, all pending Chain Items will
  subsequently be processed by the FEPR process."; 319 (a cleanup follows a chain item leaving the chain); 337.1.b "Chain Items are
  Finalized in the order they were appended to the Chain."; 383.3.d (only simultaneous triggers are ordered together).
  `game.ts advance()` runs `flushTriggers` (ordering AND finalization: targets, "you may", costs) before `cleanupSteps`, so e.g. a
  Deathknell triggered during a spell's resolution chooses its targets while units with lethal damage are still on the board, and can
  target them. Correct sequence: (1) triggers met during the resolution are appended as pending items (order chosen per player, turn
  player first); (2) the cleanup runs — while pending items exist the state is Closed, so cleanup steps 9-10 must not start a
  showdown/combat; triggers met in the cleanup are appended after the earlier ones (their own ordering decision); (3) pending items are
  finalized oldest first. Net effect: cleanup-time triggers end up on top (resolve first) — the current placement order is right, only
  the finalization moment is wrong. Todo test: tests/rules/rulings-chain.test.ts (also covers APNAP order and CR 403.4).

## From FUZZ (2026-11-25)

Found by the interaction fuzzer (`tools/fuzz.ts`, invariants in `tools/fuzz-lib.ts`, report in docs/fuzz-report.md). Each repro is a
minimised game in `tests/fuzz-repros/<hash>.json` (seed, decks, action log, optional probe action); `tests/fuzz/regressions.test.ts` runs
the filed ones as todo tests, so they turn into regressions once fixed (set the repro's `triage.status` to `fixed`). Replay one with
`checkRepro(spec, actions, probe, { lenient: false, kind })` from tools/fuzz-lib.ts.

- **F-1 `validateAction` accepts activating abilities of objects the player doesn't control** (seen in ~90% of games). `legal.ts
  validateInner` → `canActivate(g, p, …)` has no controller check; only `activatableAbilities` filters `owner === p`. A guest can
  activate the host's legend ability, Equip/Empower (900/901), gear/unit abilities and even exhaust/recycle the host's runes (950/951)
  by sending `{type:'activate', obj:<opponent's object>}`; applyAction applies it. Fix: in `validateInner` case 'activate', require the
  same owner test as `activatableAbilities` (controller of `viaHost ?? obj`, battlefield controller / `anyPlayer`, rune controller).
  Repros: `970f013312` (enum-missing view), `6e5ee7f045` (illegal-accepted).
- **F-2 Module-level counters leak into GameState** — `play.ts newItemId` (`itemCounter`) and `events.ts` (`batchSeq`, `lastType`) are
  module state, so chain item ids and `event.batch` differ between the original run, a replay from the seed, a JSON round-tripped state
  and another tab/process (host vs guest). Batches also group events across unrelated applyAction calls (`lastType` survives). The
  fuzzer masks these two fields when comparing states (`setMaskEngineCounters(false)` in tools/fuzz-lib.ts shows the diffs in nearly
  every game). Fix: keep both counters in `g.ex` (or derive ids from `g.timestamp` alone) and reset `lastType` per run.
- **F-3 Listed plays that are then undone; the bot loops on them forever.** getLegalActions lists plays that the play process rolls
  back as illegal (`Action undone: a required target is no longer available` / `cannot pay …`):
  (a) `canPlay` checks target groups independently, so "X and another friendly unit" is listed with one friendly unit (Deathgrip,
  Convergent Mutation, Smoke and Mirrors, Angle Shot; per RULINGS R-5 and tests/cards/B5 the play must fail). The scripts' earlier-pick
  filters (helpers B5 `priorPicks`, B6/B7 `chosenSoFar`) still see the group-0 pick through `targeted` events during the
  "alone" check in `chooseTargetsFor`, which is what makes the rollback happen — the `(a group emptied only by earlier picks … is
  skipped)` comment there doesn't match what scripts do. Needs a joint feasibility check in canPlay (try each first-group candidate
  with ctx.targets set, like the alone check) so these aren't offered;
  (b) `affordablePlay` returns true from the no-target cost variants before considering that every first-group candidate carries
  Deflect (Shakedown when the only enemy unit has Deflect 2: listed, then all candidates are filtered by CR 355.16 and it rolls back);
  (c) optional additional costs (Atakhan "you may kill a friendly unit", Repeat) offer the "skip" answer even when skipping makes the play
  unaffordable (CR 355.16 says don't offer it);
  (d) `bot.ts chooseAction` has no memory of rolled-back actions: it re-picks the same play/answer forever (a vs-bot game hangs; the
  fuzzer hit 5000-action games before it started banning rolled-back actions).
  Repros: `d2d4803d9e` (Convergent Mutation / Deathgrip / Shakedown), `4cd09eb45b`, `a2c84ba076` (bot loops).
- **F-4 The heuristic bot ignores decision validators** — `bot.ts answerInStep` builds target answers from the options but never checks
  `data.check` (`sameLocation`, `groupRules`) or uses `validateAnswer`; bot-vs-bot chose units at different locations for Bellows Breath
  and `applyAction` threw `EngineError: all choices must be at the same location` (crash in a vs-bot game). Fix: filter the candidate
  answer through `validateAnswer` and fall back to `getLegalActions(…)[0]`. Repro: `7bb0e8d270`.
- **F-5 (hidden information, info)** Object ids are assigned in deck-list order before the shuffle (`createGame`) and never change, so
  copies of a card have consecutive ids; once one copy is seen face up, a client can infer the identity of hidden neighbours in the
  opponent's hand/deck. `getView` also ships `state.cards` with the opponent's whole card list (packView drops it on the wire). Suggest
  assigning main-deck object ids after shuffling (or from the RNG) so ids carry no deck-list information.
- **F-6 (low)** `ctx.becomeUnit` doesn't detach an attached gear (CR 143.5 / 435.1.h "units can never be attached"); the gear-unit could
  then move away from its host. Worked around in Lady of Clockwork (batch-B8) — the only `becomeUnit` user; a cleanup step (detach any
  attached object that is a unit) would make it general. Repro (fixed by the script change): `d09ae46bc6`.

## From SCRIPT-FIX (2026-11-25)

- **SF-1 Gear Units (`CardDef.additionalTypes`)** — Patched Porobot (`ven-058-166`) is `type: 'Unit'` + `additionalTypes: ['Gear']`
  (data audit table A). `chars.isGear()` (and so `ctx.isGear`, `ctx.gear()`, `isEquipment`, gear counts, "kill/return a gear" filters)
  only reads the type, and the DSL filter `F.gear` is `isGear && !isUnit`, so a Gear Unit is never a gear. Needed: `isGear` true when
  `additionalTypes` includes `'Gear'` (it stays a unit; it can't be attached, Radiance 718.6), and `F.gear` / the scripts' many
  `isGear(id) && !isUnit(id)` checks (meant to exclude gear that *became* units) should not exclude printed Gear Units — e.g. an
  `isGearUnit` / "printed gear" helper. Stand-ins until then: `helpers/B7.ts isGearAny / gearControlled` (Porobot's own "3 or more
  other gear"), `helpers/B2.ts friendlyGearCount` (Ornn) read `additionalTypes`. Todo test: tests/cards/B7/draw-discard.test.ts
  ("the engine treats a Gear Unit as a gear").
- **SF-2 `ctx.abilitySource` for Equipment effect text** — **DONE** (ENGINE-3 2026-11-26: QueuedTrigger/ChainItem carry `abilitySource`; set in placeTrigger, ctxForItem, statics (`ActiveStatic.abSrc`), replacements and rule hooks; `gearOn` prefers it) — — for `section: 'effect'` abilities the engine sets `abilitySource` (= the
  Equipment) only while matching triggers and for activated abilities. It is unset when the trigger is finalized / resolves
  (`chain.ts placeTrigger`, `resolveItemEffect`) and in statics, replacements and rule hooks (chars.ts `staticApplies` gets `src =
  viaHost`; replace.ts / rules.ts push `src: self`). Bands that need "this" (Blighted Battleaxe "unattach this", Guardian Angel "kill
  Guardian Angel", The Zero Drive) look the Equipment up among the host's attachments by card id (`batch-B2.ts gearOn`), which is
  wrong with two copies attached and after the Equipment was detached. Suggest carrying the ability's source object on the queued
  trigger / chain item and in the static/replacement/rule contexts.
- **SF-3 linked banishment from an effect-section ability** — **DONE** (ENGINE-3: `ctx.banish(ids, { linkTo })`, `linkTo: null` = no link; The Zero Drive migrated) — — `ctx.banish` links to `ctx.self`, which is the host for Equipment effect
  text. The Zero Drive's band "[Deathknell] — Banish me" must link the unit to the Zero Drive ("units banished with this"); the script
  rewrites `g.ex.links[unit]` after banishing. Suggest `ctx.banish(ids, { linkTo })` (or link to `abilitySource` when set, see SF-2).
- **SF-4 per-unit "conquered this turn"** — Blighted Battleaxe "if I didn't conquer this turn" needs to know whether a specific unit
  conquered this turn, including before the Battleaxe was attached. The engine only records battlefields per player
  (`turnFacts conquered:<p>`). Stand-in: the Battleaxe records conquering units with an any-zone immediate listener, which misses
  conquests while every Battleaxe was in a hidden zone (deck). Suggest recording the conquering units (object + epoch) per turn.
- **SF-5 trigger base costs can't pass data to the effect** — **DONE** (ENGINE-3: placeTrigger pays the base cost with a ctx whose `data` is the item's data; Rumble, Hotheaded migrated) — — `placeTrigger` pays `ab.cost` extra parts with a fresh
  `makeCtx(g, src, p)` (payment.ts `payNonResource`), so `pay.killFriendly`'s `ctx.data.killedForCost*` and any custom-cost data never
  reach the resolving trigger. Rumble, Hotheaded ("Reduce its Energy cost by the Might of the unit you recycled") keeps the Might in a
  turn fact keyed by the Rumble object. Suggest paying with a ctx whose `data` is the item's `choices.data` (and `event`/`item` set).
- **SF-6 `ignoreDeflect` must see the whole set of choices** — **DONE** (ENGINE-2 2026-11-26: the rule gets `(chooser, target, allChosen)`; Heisho script updated) (Heisho `ven-158-166`: "Players ignore [Deflect] while paying for spells
  and abilities choosing something here"; RJ#11769 / RJ#11783). `targets.ts deflectCost(g, chooser, ids)` asks the rule per object
  (`(chooser, target)`), so the Heisho script can only waive Deflect for the objects *at* Heisho; a spell that also chooses a Deflect unit
  elsewhere still pays for it. Triggers aren't on the chain while `placeTrigger` computes Deflect, so a script can't look the other
  choices up. Suggest passing the full chosen-id list (and the source) to the rule: `ignoreDeflect(chooser, target, allChosen, source)`;
  Heisho then waives the whole Deflect tax when any chosen object is here. Todo tests: tests/riftjudge/r11701.test.ts RJ#11769, RJ#11783.

## From META-SIM (2026-11-26)

Found while running tools/ai-bench.ts / tools/meta-sim.ts on the Bologna meta decks (data/meta-decks). Repros replay with
`createGame({ seed, cardDb, battlefieldSelection: 'random', firstPlayer: 0, players: [deck files...] })` + the action log.

- **MS-1 Deathgrip is enumerated as legal but its play rolls back** — **FIXED** (not reproducible, ENGINE-2 2026-11-26: with one friendly unit Deathgrip is not enumerated; F-3a joint target feasibility) — `getLegalActions` offers `playCard Deathgrip` (sfd-163-221,
  "Kill a friendly unit. If you do, give +[M] ... to another friendly unit") while the player controls a single unit; applying it
  returns `{type:'rollback', reason:'a required target is no longer available'}` and an unchanged state. A deterministic pilot then
  picks it forever (bot vs bot looped 4000 actions in one turn). Either `canPlay` should check the second target group, or the
  enumeration should drop it. Repro: `data/meta-sim/repros/rollback-deathgrip.json` (bot vs bot, seed 5, 01-azir vs 04-rek-sai,
  rollback at action 45, turn 5). The sim harness now bans a rolled-back action for the rest of the turn and counts it (28 such
  rollbacks in 120 bot-vs-bot pilot games, 0 with the search AI, which rejects them in lookahead).
- **MS-2 Performance: `chars.attachedTo` scans every object** — **DONE** (ENGINE-2 2026-11-26: reverse attachment index, `grantsOf`, memoised read-only scans; applyAction mean 3.4 -> 1.4 ms on bot meta games, see CHANGELOG) — `attachedTo(g, host)` loops over all of `g.objects` whenever any
  Equipment is attached (`ex.attachCount > 0`), and `computeChars` calls it for every unit, so the cost is O(units x objects) per
  characteristic lookup. In the CPU profile of AI games it is the top self-time function (~20%, plus `computeChars`/`chars` ~20%).
  Equipment decks are 3-7x slower per action than the rest: bot mirrors cost 17.6 ms/action (01-azir) and 8-10 ms (10-azir, 14-azir)
  vs 2.2-3.5 ms (Kai'Sa, Rek'Sai, Kennen). Suggest a reverse index host -> attached ids in `ex` (maintained in attach/detach/
  zone change), or memoising it per `withCharsMemo` scope. This directly sets the length of a 20-deck meta run (4 of the 20 lists are Azir).
- **MS-3 bot ignores data-only group constraints** — **FIXED** (bot answers are validated, F-4) — `src/engine/bot.ts answerInStep` picks the best-scored options of a multi-select
  decision without consulting its validator, so for decisions with the `sameLocation` validator (src/engine/play.ts) it can choose
  objects at different locations and `applyAction` throws "all choices must be at the same location" (seen with random fuzz decks:
  `genDeck` seed 8, bot vs bot). Harmless in the sim (src/ai `fastPolicy` validates and falls back to an enumerated action) but the
  vs-bot opponent in the UI would throw. Suggest the bot filter its pick with `validateAction` (or pick from `getLegalActions`).
- **MS-4 Azir lists score ~0% under both pilots (please sanity-check the Azir cards)** — in the 4-deck pilot, 01-azir (the
  tournament winner) went 5-55 with the search AI and 0-60 with the baseline bot vs Kai'Sa / Vex / Rek'Sai. Part of this is pilot
  skill (the deck needs Equipment -> legend activation -> Weaponmaster sequencing), but it is extreme enough that the scripts of
  Emperor of the Sands (Weaponmaster for Sand Soldiers, "[1], [T]: play a Sand Soldier ... only if you've played an Equipment this
  turn"), Guards! / Arise! (token + ready), Forge of the Fluft and the Equipment bands are worth a targeted test pass before the
  full meta run.
- **MS-5 Switcheroo: decisions with no (enumerated) answer** — **FIXED** (META-AUDIT: sameLocation feasibility + per-location enumeration; re-checked by ENGINE-2) — "Swap the Mights of two units at the same battlefield" (chooseTargets,
  min 2 / max 2, validator `sameLocation`). (a) The card is playable and the decision is asked when no two eligible units share a
  location: Vex @Bandle Scouts' Academy, Baron Nashor @Baron Pit, Reckless Innovator @Startipped Peak -> no valid answer exists, the
  game cannot continue. Repro: `data/meta-sim/repros/switcheroo-no-valid-pair.json` (02-vex vs 03-evelynn, seed 253963346, turn 12;
  replay the action log, then inspect `pending`). (b) With more options, `legal.ts inStepActions` exceeds MAX_COMBOS and falls back to
  "first k" + singletons, which the `sameLocation` validator rejects, so `getLegalActions` is empty although valid pairs exist
  (03-evelynn vs 01-azir, seed 659999617). Suggest: check target-group feasibility (incl. data-only validators) in `canPlay`, and
  enumerate per location (or filter combos by the validator before truncating) in `inStepActions`. The sim harness now recovers from
  (b) by brute-forcing a validated answer (reported as "enumeration gaps" in docs/meta-sim.md) and voids games hitting (a).


## From SCRIPT-FIX-2 (2026-11-26)

- **SF2-1 a precondition for reflexive items** — **DONE** (ENGINE-3: `TriggeredAbility.offerIf(ctx)` checked in placeTrigger before the "you may"; Guards! and Death from Below migrated) — — `ctx.reflexive(key, data)` queues the item without the ability's `if` (that is only
  checked by event matching), so an optional reflexive item is always offered. Scripts gate before queuing instead: Death from
  Below ("do this: You may play this from your trash for [A]") is queued only if [A] is payable as the spell resolves; Guards!
  ("You may pay [C] to ready it") only while the Sand Soldier is exhausted; Wild Claw only while the played card isn't Empowered.
  Suggest an `offerIf(ctx)` on `reflexiveAbility` evaluated in `placeTrigger` before the "you may" (like R-15 for targets).
- **SF2-2 reflexive items vs triggers met during the same resolution** — **DONE** (ENGINE-3: `ctx.reflexive` queues the item in the latest event batch, so its controller orders it with that batch's triggers, CR 383.3.d; azir tests answer the order) — — reflexive items carry no event batch (`ctx.reflexive`
  pushes `batch: undefined`), so they are never offered in the same `orderTriggers` question as triggers met during the same
  resolution: Guards! / Arise! Sand Soldiers' Weaponmaster triggers are finalized first and the reflexive "ready" item lands on top
  (resolves first). That order is defensible (the reflexive item is created after the token's play), but if CR 388 means the
  reflexive item is met together with them, it should share their batch so the controller orders them (CR 383.3.d). Tests:
  tests/cards/meta-audit/azir.test.ts (Guards!, Arise!).

## From META-AUDIT (2026-11-26)

Card audit of the 20 Bologna meta lists (159 distinct cards; Azir lists first). Tests: tests/cards/meta-audit/*.test.ts.

- **MA-1 MS-5 Switcheroo — FIXED (engine, small).** — reviewed by ENGINE-3 (kept as is: complements F-3a joint feasibility) — (a) `targets.ts candidatesFor`: a `sameLocation` group that needs 2+ objects
  only offers objects whose location holds at least `min` candidates (`sameLocationFeasible`), so `canPlay`/`hasLegalTargets`
  reject Switcheroo with no pair, and only units with a partner are offered. (b) `legal.ts inStepActions`: above MAX_COMBOS, a
  `sameLocation` decision is also enumerated per location (all combos per location while they fit the cap, else "first k" of that
  location). ENGINE agent: please review / fold into F-3a-style joint feasibility if you prefer. tests/cards/meta-audit/
  ms5-switcheroo.test.ts; tests/cards/B6/sfd.test.ts Switcheroo test now has a third unit at the battlefield (its only valid pair
  is otherwise auto-chosen, as ARCHITECTURE requires).
- **MA-2 MS-1 Deathgrip** — no longer reproducible: with a single friendly unit Deathgrip is not playable (F-3a). Test in
  meta-audit/azir.test.ts.
- **MA-3 stale repros** — **WON'T FIX** (ENGINE-3: both bugs are fixed and covered by tests — MA-1/MA-2; the next tools/meta-sim.ts run records fresh repros with the current id scheme) — — data/meta-sim/repros/*.json (rollback-deathgrip, switcheroo-no-valid-pair) no longer replay: action 1
  fails with "unknown option" since F-5 assigns object ids after the shuffle. Repros recorded before an id-scheme change need
  re-recording (or record by card id + zone index).
- **MA-4 bot answers that waste the Azir plan (src/engine/bot.ts, engine-owned; the UI vs-bot opponent still has them).** — **(a) DONE** (ENGINE-3: bot.ts attaches an unattached Equipment for Weaponmaster, else none); (b) handled per card by hints (Azir `help`); declining a leading "you may" choice now removes the trigger —
  (a) "Weaponmaster: choose an Equipment to attach (or none)" (hint help): the bot takes the most valuable Equipment even when it
  is already attached, so every new Sand Soldier pulls the B.F. Sword off the last one and pays its [C] again. Suggest: prefer
  unattached Equipment, else none. (b) min-0 "any number"/"up to" choices with hint `neutral` are answered with the minimum
  (Azir's "move any number of your token units here" moved none; Azir's hint is now `help`). src/ai wraps (a) in `fastPolicy`.
- **MA-5 RULING to re-check: Weaponmaster vs Equip [C].** — **decided: kept per CR 821.1.c.3** (DECISIONS "10503 re-check", principle 20) — The engine follows CR 821.1.c.3 literally ("If the chosen card's Equip
  cost does not contain [A], it can still be paid, but will not be reduced"; [A] = rainbow power, CR 135.2.e.5), so single-domain
  Equip [C] (26 of 43 Equipment, every Equipment in the Azir lists) is paid in full (docs/riftjudge/DECISIONS.md 10503). Community
  play disagrees: RiftJudge #10503 says the cost is reduced by "[A] (1 power)" and is free when it was exactly one power; the
  riftmana Azir guide says Weaponmaster lets the deck "bypass the Power cost". Measured impact under the search AI is small
  (pilot with "reduce one Power of any domain": Azir 3-57 vs 3-57), so this is not why Azir loses in the sim, but it is the one
  rules reading that most changes how the Azir deck plays. RULINGS: please re-check against the official Core Rules PDF.
- **MA-6 (script timing, low priority)** — **DONE** (ENGINE-3: Hall of Legends and Sunken Temple use `optional` + `cost` — decided/paid at finalization; Hall offered only while the legend is exhausted) — — Hall of Legends ("When you conquer here, you may pay [1] to ready your legend") and
  Sunken Temple ask "you may pay" on resolution, not as the trigger goes on the chain (CR 383.3.b, cf. Startipped Peak / Concert
  Poster). Same outcome unless something responds in between.

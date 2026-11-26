# Scripting cards with the Riftforge DSL

Audience: card-scripting agents. Engine: `src/engine/` (ENGINE agent). DSL: `src/cards/dsl.ts`.
Registry: `src/cards/registry.ts`. Worked examples that compile and are tested: `tests/cards/dsl-examples.ts`.

## 1. The shape of a script

```ts
import { card, spell, onPlay, E, T, F } from '../../dsl.ts';

card('ogn-005-298', 'Action\nDeal 3 to a unit at a battlefield. If this kills it, do this: draw 1.', [
  spell(ctx => { ... }, { targets: [T.unit(F.atBattlefield)] }),
]);
```

- `card(id, text, abilities, opts?)` registers a `CardScript`. `id` is the canonical id from `data/cards.json`,
  and alternate printings share it. `text` must equal the card's `text` field. `tools/coverage.ts` compares them.
- One file per set or batch under `src/cards/scripts/<set>/`. Importing the file registers its scripts. Also add the file to
  `src/cards/scripts/index.ts` (create it if missing) so the game loads it.
- **Keywords need no code.** The engine reads intrinsic keywords from `cards.json` `keywords` (`Accelerate`, `Tank`,
  `Assault 2`, `Deflect`, `Hidden`, `Ambush`, `Ganking`, `Temporary`, `Vision`, `Hunt N`, `Disarm N`, `Deploy`, `Weaponmaster`,
  `Quick-Draw`, `Equip`, `Empower`, `Repeat`, `Flow`, `Action`, `Reaction`, `Backline`, `Shield N`, `Unique`). It also reads keyword
  costs from `keywordCosts` (e.g. `{Equip: '[C]'}`). If a keyword cost isn't pure resources (`[Equip] — [C], Kill a friendly unit`,
  `[Repeat] — Discard 1`), pass `opts.costs: { Equip: cost('[C]', pay.killFriendly()) }`. Override the keyword list with
  `opts.keywords` only if the data is wrong.
- A card whose whole text is keywords needs **no script**.
- Effects must be deterministic. Use only `ctx` and game state. Don't use `Math.random`, `Date`, or module-level mutable state.
  Choices are asked synchronously (`ctx.choose…`, `ctx.may`). Under the hood the engine suspends and replays the whole step
  when the answer arrives, so **an effect may run several times before it completes.** It must not have side effects outside `ctx`.

## 2. Ability kinds (constructors in dsl.ts)

| constructor | for | notes |
|---|---|---|
| `spell(effect, {targets, playIf})` | spell resolution text | targets chosen **as the card is played** (CR 355); Deflect applies |
| `spellModes([mode(id,label,effect,targets?)], {choose})` | "Choose one —" | mode chosen on play; `choose: 2` for "choose two" |
| `when(events, match, effect, opts)` | any trigger | `match(ev, ctx)`; opts: `targets` (chosen when the trigger is put on the chain), `optional` ("you may" at the start), `cost` ("you may pay X to"), `if` (intervening if, re-checked on resolution), `oncePerTurn`, `requires` |
| `onPlay`, `onPlayToBattlefield`, `deathknell`, `onAttack`, `onDefend`, `onCombatRole`, `onConquer`, `onHold`, `onMove({toBattlefield})`, `whenYouConquer`, `whenYouHold`, `onConquerHere`, `onHoldHere`, `onDefendHere`, `onAttackHere`, `whenYouPlay(filter)`, `whenOpponentPlays(filter)`, `whenUnitDies(filter)`, `atStartOfBeginning`, `atStartOfMain`, `atEndOfTurn`, `atEndOfEachTurn` | common triggers | shorthands over `when` |
| `activated(cost, effect, {timing, targets, modes, oncePerTurn, if, label})` | `COST: EFFECT` | default timing: your turn, open state, not in a showdown (CR 381). `timing: 'action' \| 'reaction'` for `[Action][>]` / `[Reaction][>]` |
| `mana(cost, {energy, power, only})` | `…: [Add] …` | no chain, usable by the auto-payer while paying. `only`: `'spell' \| 'unit' \| 'gear' \| 'unitOrGear' \| 'ability'` |
| `statik(affects, mods, {if})`, `selfMight(n)`, `selfKeyword(kw)`, `anthem(filter, mods)` | continuous effects | `mods: {might, setMight, keywords, removeKeywords, tags, type, cantBeChosenByEnemy, grants}` or a function `(ctx, id) => mods`. Applied through layers |
| `replacement(event, match, apply)`, `wouldDie(filter, instead)` | "would … instead" | `apply` returns a modified event, another event type, or `null` (skip). Each replacement applies once per event (CR 370.2) |
| `costMod(applies, {energy, power, minEnergy}, {selfOnly, scope})`, `selfCostDyn(fn)`, `costModDyn(fn)` | cost changes | negative = discount. `scope`: `'play' \| 'additional' \| 'repeat' \| 'empower' \| 'equip' \| 'ability' \| 'hide'` |
| `playFrom(zone, {cost, if})` | "You may play me from your trash for [3][C]" | |
| `playRule(applies, {entersReady, extraDestinations, grantsTiming})` | "Units you play to battlefields you control enter ready", "your spells have [Reaction]", Dragon Roost-like destinations | |
| `movePermission(allows)` | "Units can move here from anywhere." | |
| `rule(name, applies?, value?)` | engine rule hooks (section 7) | |
| `asPlay(effect)`, `showOff(filter)` | "As you play…", Show Off, X costs (`ctx.addPlayCost`) | runs before costs are paid. Data written to `ctx.data` is visible later in the spell effect, play triggers and `entersReady` |

Every ability accepts `requires: [dep.legion() | dep.level(n) | dep.empowered(n?) | dep.mighty() | dep.custom(fn)]` for dependent
keywords (`[Legion][>]`, `[Level 6][>]`, `[Empowered][>]`, `[>>]` chains = several entries), and `text` (shown in UI/log).

Script options: `{ keywords, costs, maxEmpower, entersReady: bool | ctx => bool, additionalCosts: [{cost, optional, label, key}] }`.
When an additional cost is paid, `ctx.data[key ?? 'paidAdditional'] = true` (use `C.paidAdditional`).

**Gear effect text.** For Equipment text that applies to the equipped unit ("The equipped unit…", "When I attack" printed on
the gear and meant for the wearer), mark the ability `section: 'effect'`. It is then active only while attached, and `ctx.self`
is the host unit (`ctx.abilitySource` is the gear). Rules text (`section` omitted) is inactive while attached (CR 434.1.e).

## 3. Targets, filters and references

- `T.unit(...filters, opts)`, `T.gear`, `T.permanent`, `T.battlefield`, `T.rune`, `T.legend`, `T.chainItem` (spells/abilities on the
  chain), `T.card({zones: ['trash']}, ...)`. Opts: `{prompt, min, max, hint: 'harm'|'help', zones, pick, sameLocation, split,
  anyLocation}` — `anyLocation`: the group's text makes the Hidden "here" restriction impossible ("a unit at a different location"),
  so it may be chosen anywhere when played from facedown (CR 811.1.d.4); other groups (and play effects of hidden permanents) are
  restricted to that battlefield automatically.
  `T.upTo(n, spec)`, `T.exactly(n, spec)`, `T.anyNumber(spec)`.
- `pick: true` marks a non-targeting choice ("pick", "This doesn't choose anything"). It ignores Deflect, untargetability and
  "when chosen" triggers.
- Filters `F.*`: `enemy, friendly, youControl, other, self, unit, gear, equipment, spell, atBattlefield, atBase, here, there,
  inCombat, attacking, defending, stunned, exhausted, ready, buffed, damaged, token, nonToken, champion, mighty, empowered,
  equipped, facedown, mightAtMost(n), mightAtLeast(n), mightLessThan(fn), costAtMost(n), powerAtMost(n), tag(...), domain(d),
  keyword(kw), named(name), at(fn), notChosen(key), and(...), or(...), not(f)`. A filter is just `(ctx, id) => boolean`.
- In effects, `ctx.target(i)` is the first **still-legal** target of group `i` (or `undefined`), and `ctx.targetsOf(i)` returns
  all of them. Targets that became illegal or became new objects are filtered out (CR 359.3.e: instructions on them are ignored).
- `Ref` for `E.*`: target-group index `0/1/…`, `'self'`, `'host'`, or `ctx => ids`. `R.all(filter)`, `R.enemiesHere`, `R.eventObj`,
  `R.stored(key)`.
- Choices **made on resolution** (text like "then choose…", "look at the top 3 and choose…"): `ctx.choose(spec)`,
  `ctx.chooseCards(ids, min, max, prompt, chooser?)`, `ctx.chooseMode(options)`, `ctx.chooseNumber(min, max)`,
  `ctx.chooseBattlefield(filter?)`, `ctx.chooseLocation(locs)`, `ctx.chooseOpponent()`, `ctx.choosePlayer()`, `ctx.may(prompt)`.
  Opponent decides: `ctx.chooseFor(p, spec)`, `ctx.chooseCards(ids, 1, 1, prompt, p)`, `ctx.mayFor(p, prompt)`, `ctx.mayPayFor(p, cost, prompt)`.
- If only one legal answer exists and the choice isn't optional, the engine answers it automatically.

## 4. Effects

`E.*` builds effects: `seq, deal(n, ref), dealSplit(i), kill, banish, recycle, returnToHand, recall, draw(n, who?), discard(n, who?),
channel(n, exhausted), ready, exhaust, stun, buff, heal, might(ref, n, dur), mightMin(ref, n, floor), keyword(ref, kw, dur), grant(ref,
key, dur), move(ref, to), token(name, {count, at, ready, might}), points(n), add(energy, power[], only), predict(n), burn(n), xp(n),
empower, disempower, counter(ref), attach(gear, unit), takeControl, fight(a, b), prevent(ref, n|'all'), may(prompt, then, else),
mayPay(cost, prompt, then), when(cond, then, else), forEach(ids, f), repeat(n, e), chooseNow(spec, key), chooseOne([{label, effect, if}]),
lookTop(n, {reveal, filter, min, max, pick: 'hand'|'play'|'playFree'|'banish'|fn, rest: 'recycle'|'trash'|'top'})`.
`n` may be a number or `ctx => number`. Durations: `'endOfTurn'` (default, "this turn"), `'endOfCombat'`, `'permanent'`, `'whileSource'`.
Split damage: use `E.dealSplit(i)` / `ctx.dealSplit(i, total?, source?)` — `ctx.split` returns parts that already include Bonus
Damage (CR 715.3), so deal them yourself only with `ctx.dealEach(list, src, { noBonus: true })`. A Bonus Damage replacement written
with `replacement('damage', …)` must declare `{ bonus: (ev, ctx) => n }` (dsl `bonusDamage` does) so split pools see it; skip
`ev.unitDealt` (fight damage, CR 418.6.b.3) and `ev.combat` for "spells and abilities" bonuses.

Or write the effect imperatively. These are the important `ctx` methods (`src/engine/context.ts` has the full list):

- **Info:** `self, controller, opponent, opponents(), might(id), has(id, kw), kw(id, kw), isUnit/isGear/isEquipment/isSpell, type, tags,
  hasTag, isChampion, isToken, ctrl(id), owner(id), isEnemy/isFriendly, onBoard, loc(id), here(), isHere(id), bfIndex() (battlefield
  scripts), units(f), unitsAt(loc, f), enemyUnits, friendlyUnits, gear(f), attachments(unit), battlefields(), controls(bf),
  controlledBattlefields(), points(p), xp(p), hand(p), deck(p), trash(p), runes(p), legend(p), isMyTurn, inShowdown, inCombat,
  isAttacking/isDefending/isStunned/isBuffed/isExhausted/isEmpowered/isMighty, damage(id), lethallyDamaged(id), playedThisTurn(p),
  count(key)/bump(key), energyCost(id), powerCost(id), domains(id), chainItems(), itemTargets(itemId), cardIdOf(id)`.
- **Actions:** `deal(n, ids), dealEach([{id, amount}]), kill, banish, recycle, returnToHand, discard(n, p), discardCards(ids), draw(n, p),
  burn(n, p), channel(n, exhausted), ready, exhaust, stun, buff, spendBuff, heal, giveMight(ids, n, dur), setMight, giveKeyword,
  removeKeyword, grant(ids, key, dur), untargetable(ids), move(ids, to), recall, createToken(name, loc, {count, exhausted, might}),
  gainPoints / scorePoint(p, n), losePoints, add(energy, power, only), predict(n), lookTop(n), revealTop(n, p), revealHand(p),
  reveal(ids), toHand(id), toDeck(id, 'top'|'bottom'), counter(itemId), counterReturn(itemId), attach, detach, empower(id, max),
  disempower, gainXp, spendXp, takeControl(id, p), prevent(id, n|'all'), fight(a, b), doubleMight, swapMight, swapLocations,
  play(id, {ignoreCost, destination}), showOff(filter), pay(cost), canPay(cost), mayPay(cost, prompt)`.
- **Game hooks (section 6 of card-patterns):** `extraTurn(p)`, `winGame(p)`, `takeControlOfItem(itemId, remake)`,
  `becomeCopy(id, ofObjOrCardId, dur)`, `becomeUnit(gear, might)` / `stopBeingUnit`, `replaceBattlefield(bf, token)` /
  `swapBackBattlefield(bf)`, `addBattlefield(token)`, `nameTag()`, `nameCard(filter)`, `banishedWithThis()` (linked banishment;
  `ctx.banish` links automatically), `allowPlay(id, 'endOfTurn'|'nextEnding', {ignoreCost})`, `remember(key)` / `remembered(key)`
  (per-object, per-turn memory for "one you haven't chosen this turn"), `banishAfterResolve()` ("Banish this."),
  `eachPlayer(fn, {startWithNext, opponentsOnly, others})`, `delay(key, data, expires, uses)`.

**Costs**: `cost('[1][C]')`, `cost('[T]', pay.killSelf())`. The `pay.*` parts are `discard(n), killSelf, banishSelf, recycleSelf, spendXp(n), spendBuff('self'|'friendly'),
disempowerSelf, exhaustFriendly(filter), killFriendly(filter)` (stores `ctx.data.killedForCost*`), `recycleFromTrash(n, f),
banishFromTrash(n, f), returnFriendlyToHand(f), custom(label, canPay, pay)`. `[T]`/`[E]` = exhaust this; `[A]` = any power;
`[C]` = this card's domain (any of them on multi-domain cards; `[A]` if domainless).

**Conditions** `C.*`: `myTurn, notMyTurn, inShowdown, inCombat, atBattlefield, atBase, attacking, defending, empowered, mighty, buffed,
alone, paidAdditional, showedOff, playedFromHidden, legion, level(n), nearVictory(3), controls(filter, n), targetIs(filter, i), not,
and, or`.

**Grants and delayed abilities**: register once at module level.
```ts
const killMe = grantable('ogn-xxx:killMe', atEndOfTurn(ctx => ctx.kill(ctx.self)));     // quoted ability given to another object
ctx.grant(unitId, killMe, 'endOfTurn');
const nextUnit = delayedAbility('ogn-yyy:nextUnit', whenYouPlay(F.unit, ctx => { ctx.ready(ctx.event!.obj as string); }));
ctx.delay(nextUnit, {}, 'endOfTurn', 1);     // uses = 1: removed after triggering once
```
Ready-made delayed abilities `D.*`: `killAtEnd` (use `killAtEndOfTurn(ctx, id)`), `unitsEnterReady`, `nextUnitReady`, `nextCostsLess`
(`{energy:-2, power:0, type:'Unit'}`), `returnControlAtEnd` (`{obj, to, recall}`). In a delayed ability, `ctx.data` is the stored
data and `ctx.controller` is the player who created it.

## 5. Events (for `when`)

Each event is `{ type, ...fields }`. "LKI" is a last-known-information snapshot
`{obj, cardId, controller, owner, loc, might, tags, type, isToken, alone, name, combatRole, buffed}`.

| type | fields | when |
|---|---|---|
| `play` | obj, player, cardType, from, fromHidden, loc (permanents), item (spells), token, playData | play finalized (CR 383.4) |
| `enter` | obj, player, loc, token | permanent entered the board |
| `move` | obj, from, to, how ('standard'\|'effect'), player (who moved it) | after a move |
| `die` | obj, lki, by {player,obj,combat} | about to die (still on board), used by Deathknell/"when X dies" |
| `killed` | obj, lki, by | after it reached the trash |
| `leaveBoard` | obj, to, controller, cardId | about to leave the board for a non-board zone |
| `damage` | obj, amount, source, player, combat | damage was dealt |
| `conquer` / `hold` | player, bf, units (that player's units there), replaced? | scoring (also fires if the point was replaced) |
| `score` | player, bf, how | |
| `attack` / `defend` | obj, bf, player | unit gained the designation (first time per combat) |
| `playerAttack` / `playerDefend` | player, bf | "When you attack/defend here" |
| `combatStart` / `combatEnd` | bf (+attacker, defender) | |
| `combatResult` | bf, winner, loser, attacker, defender, recalled | after combat damage and cleanup |
| `showdownStart` / `showdownEnd` | bf (+player) | |
| `turnStart`, `beginningPhase`, `mainStart`, `endOfTurn` | player | phase triggers |
| `draw`, `discard` | player, obj | |
| `recycle` | objs | `banish`: obj, lki, by · `returnToHand`: obj, lki · `burn`: player, objs · `burnOut`: player |
| `channel` | player, obj | `predict`: player, n · `reveal`: objs |
| `buff` | obj, player · `spendBuff`: obj · `stun`: obj, player · `ready`/`exhaust`: obj, player · `heal`: obj |
| `pointsGained` | player, n, how, bf | `pointsLost`, `xpGained`, `xpSpent`: player, n |
| `empower` / `disempower` | obj | `hide`: obj, player, bf · `attach`: obj (gear), host, player · `detach`: obj, host |
| `mightReduced` | obj, by (amount), player | `becameMighty`: obj · `mightChanged`: obj, from, to |
| `targeted` | obj, player, source | an object was chosen by a spell/ability |
| `counter` | item, source, player, controller | `spellResolved`: obj, player · `activated`: obj, player, index, isAdd |
| `contested`, `controlGained`, `controlLost` | bf, player | `controlChanged`: obj, from, to · `standardMove`: player, units, to |
| `add` | player, energy, power, source | `gameOver`: winner |

## 6. Replacement events

These event types pass through replacements before they happen: `damage` (`amount`: change it for bonus/prevention/doubling),
`die` (return `null`, or `{...ev, type:'recall'}`), `move`, `draw`, `gainPoints` (`n`), `score` (return `{type:'draw', n:1}`
for "draw 1 instead"), `channelRunes` (`n`, `exhausted`, `extraExhausted`), `createToken` (`cardId`, `copies`, `loc`, `might`),
`toTrash` (return `{...ev, type:'banish'}`), `returnToHand`, `stun`. Optional replacements (`optional: 'prompt'`) ask their controller.

## 7. Rule hooks (`rule(name, applies?, value?)`)

`cantReady(id, byPlayer)`, `noAwakenReady(id)`, `cantMove(unit, from, to)`, `cantPlay(cardObj, player, dest)`,
`cantGainPoints(player)`, `cantScore(player, bf)`, `noCombatDamage(unit)`, `ignoreTank(assigner, bf)`,
`anyDamageLethal(dealingPlayer, unit)`, `skipDraw(player)`, `channelCount(player, n)` (value), `victoryScoreDelta` (value),
`extraTriggers(queuedTrigger)` (value), `suppressTrigger(queuedTrigger)`, `extraHide(player, bf)` (value),
`ignoreDeflect(chooser, target)`, `cantBeCountered(itemId)`, `noTemporary(unit)`, `canPlayFromTrash(player, card)`.
A queued trigger is `{source, key, controller, event}`. Deathknell keys are recognisable via `abilityFromKey`. The simplest approach is
to test `qt.event.type === 'die' && qt.source` is yours.

## 8. Five worked examples (from `tests/cards/dsl-examples.ts`)

**1. Disintegrate** (spell, target at a battlefield, "if this kills it"):
```ts
card('ogn-005-298', 'Action\nDeal 3 to a unit at a battlefield. If this kills it, do this: draw 1.', [
  spell(ctx => {
    const t = ctx.target(0);
    if (!t) return;                          // illegal target -> instructions on it are ignored
    ctx.deal(3, t);
    if (ctx.lethallyDamaged(t)) ctx.draw(1); // it dies in the next cleanup
  }, { targets: [T.unit(F.atBattlefield, { hint: 'harm' })] }),
]);
```
`Action` comes from the data keywords. You don't script it.

**2. Tasty Faefolk** (keyword + Deathknell):
```ts
card('ogn-075-298', '[Accelerate]\n[Deathknell] — Channel 2 runes exhausted and draw 1.', [
  deathknell(E.seq(E.channel(2, true), E.draw(1))),
]);
```

**3. Monastery of Hirana** (battlefield trigger; battlefield abilities belong to its controller):
```ts
card('ogn-282-298', 'When you conquer here, you may spend a buff to draw 1.', [
  onConquerHere(ctx => {
    const buffed = ctx.friendlyUnits(u => ctx.isBuffed(u) && ctx.ctrl(u) === ctx.controller);
    if (!buffed.length || !ctx.may('Spend a buff to draw 1?')) return;
    const u = ctx.chooseCards(buffed, 1, 1, 'Spend a buff from')[0];
    if (u && ctx.spendBuff(u)) ctx.draw(1);
  }),
]);
```

**4. Lux** (mana ability with a spending restriction; the auto-payer uses it only for spells):
```ts
card('ogs-014-024', '[T]: [Reaction] — [Add] [2]. Use only to play spells.', [
  mana('[T]', { energy: 2, only: 'spell' }),
]);
```

**5. Zhonya's Hourglass** (replacement effect):
```ts
card('ogn-077-298', '[Hidden]\nIf a friendly unit would die, kill this instead. Heal that unit, exhaust it, and recall it.', [
  wouldDie(F.and(F.friendly, F.unit), (ctx, id) => { ctx.kill(ctx.self); ctx.heal(id); ctx.exhaust(id); ctx.recall(id); }),
]);
```

Bonus examples in the same file: **Darius** (Legion-gated play trigger + `anthem(... F.here ...)`) and
**Incorrigible Construct** (`showOff(F.tag('Mech'))` + `entersReady: C.showedOff`).

## 9. Testing a script

`tests/cards/<batch>.test.ts`. Use the helpers in `tests/fixtures/helpers.ts`:
```ts
const real = JSON.parse(readFileSync(new URL('../../data/cards.json', import.meta.url), 'utf8'));
let g = newGame({ db: { ...baseDb(), ...real } });        // test decks, all cards available
runes(g, 0, 4); setController(g, 0, 1);                    // direct setup (mutates)
const t = put(g, 1, 't-u3', 0);                            // put a card at battlefield 0 / 'base' / 'hand' / 'trash'
g = act(g, { type: 'playCard', player: 0, obj: handCard(g, 0, 'ogn-005-298') });
if (g.pending?.kind === 'chooseTargets') g = choose(g, t); // single legal options are auto-chosen
g = resolveAll(g);                                          // both players pass until the chain is empty
assert.equal(zoneOf(g, t), 'trash');
```
Vanilla fixtures: `t-u1..t-u5` (N/N Fury), `t-calm2`, `t-tank`, `t-backline`, `t-assault`, `t-shield`, `t-ganker`, `t-accel`, `t-deflect`,
`t-temp`, `t-hidden`, `t-ambush`, `t-vision`, `t-hunt`, `t-disarm`. Runes: `t-rune-fury`, `t-rune-calm`, `t-rune-mind`
(real runes such as `rad-r06` Order also work when the real DB is merged in).

## 10. Gotchas

- "Choose" = targeting (Deflect, untargetability, "when chosen"). "Pick" = `pick: true`.
- Targets for spells are chosen on play. For triggers they are chosen when the trigger goes on the chain. "Then choose…" in the text
  is a resolution-time `ctx.choose`.
- Spells that move themselves (e.g. "return this to hand") should do so in the effect. The engine trashes the card only if it is still on the chain.
- A unit trigger such as "When I die" sees the unit still on the board. On resolution it's gone. Use `ctx.here()` (falls back to LKI) or
  `ctx.event.lki`.
- Tokens: `Recruit, Gold, Sprite, Bird, Reflection` come from data. `Mech, Bomb, Sand Soldier, Shadow Clone, Tentacle` are engine synthetic
  (`src/cards/tokens.ts`). Call `ctx.createToken('Recruit', loc, { might })` for "a 1 [S] Recruit". Pass `{ exhausted: false }` for "ready".
- Player-facing names: `ctx.name(id)`. Never put object ids in prompts.

## 11. Additions since the first release (engine hooks)

- `rule('multipleBuffs', (ctx, unit) => ...)`. Rules and play rules printed on the card **being played** (`cantPlay`, `extraDestinations`)
  now work from hand.
- Delayed statics: `delayedAbility('x', statik(...))` + `ctx.delay('x', data, 'endOfTurn')`.
- Replaceable Might changes: `replacement('giveMight', (ev, ctx) => ev.chosen && ..., ev => ({ ...ev, amount: Number(ev.amount) - 1 }))`.
  `ctx.chose(id)` tells whether the current spell/ability targeted `id`.
- Play facts: the `play` event has `paid {energy, power}`. Cost modifiers see `ctx.data.dest` / `ctx.data.from`; `ChainItem.from`.
- Per-turn counts (`ctx.count(key)`): `played:p`, `spells:p`, `energySpent:p`, `powerSpent:p`, `maxSpellEnergy:p`, `spellEnergy:p`,
  `playedToBf:p`, `chose:p`, `choseEnemy:p`, `unitsDied:p`, `unitsDiedBeginning:p`, `discard:p`, `xpGained:p`, `conquered:p`,
  `holdPoints:p`.
- `ctx.conqueredThisTurn(p)`, `ctx.excessDamage(p)`, `ctx.addTag(id, tag)`, `GameObject.movesThisTurn`, `ev.batch` on every event,
  `damage` events' `sourceLki`.
- Script options `entersExhausted: true`. In asPlay, `ctx.data.__destination = bf` chooses where the permanent enters.
- Spending restrictions for `mana(..., { only })`: `'spell' | 'unit' | 'gear' | 'unitOrGear' | 'ability' | 'unitOrUnitAbility' |
  'gearOrGearAbility' | 'showdown'` (combine with `|`).
- Basic runes have activatable Add abilities (`abilityIndex` 950/951). Equip = 900, Empower = 901.
- Tests: `src/engine/testkit.ts` (`place`, `attachNow`, `addPreventShield`, `setPoints`, `setXp`, `setBattlefieldController`, `touch`) and
  `playCostOf(g, p, obj, {dest})`.

## 12. Phase 2 (unification): use these engine primitives, not batch helpers

| Need | Use |
|---|---|
| act as another player | `ctx.as(p)` |
| look / reveal the top of a deck | `ctx.lookTop(n, owner?)`, `ctx.revealTop(n, owner?)`, `ctx.revealUntil(pred, owner?)` (Nocturne, Void Hatchling and other look reactions apply automatically) |
| "draw it" (a specific card) | `ctx.drawCard(id)` |
| per-object memory / per-turn history | `ctx.memo(obj, key, value?)`, `ctx.history(key, p?)` (played, spells, spellEnergy, draws, unitsDied, gearDied, choseEnemyUnit, ...), `ctx.movesThisTurn(id)` |
| "one or more" events | `ev.batch`, `ctx.batchOf(ev)`, trigger option `oncePerBatch` |
| excess combat damage | `ctx.excessDamage(p?)`, conquer event `excess` |
| "any number of buffs" | `rule('multipleBuffs', (ctx, id) => id === ctx.self)` |
| optional / discounted additional cost | script option `additionalCosts: [{ cost, optional: true, discount: { energy: -2 }, beforeTargets?, key?, label }]` |
| another card's additional cost / destination ("Dragon Roost") | `playRule(applies, { anyPlayer?, additionalCost: { cost, discount?, destination? } })` |
| keywords while being played | `playRule(applies, { grantKeywords: () => ['Repeat'], keywordCosts: { Repeat: cost('[2][C]') } })` |
| Ambush-like destination | `playRule((ctx, id) => id === ctx.self, { ambush: (ctx, id, bf) => ... })` |
| move costs / hide costs | `rule('moveCost', applies, undefined, { cost: (ctx, p, units, to) => spec })` · `playRule(() => false, { hideCost: () => ({ energy: 1 }) })` |
| "can't be played" | `rule('cantPlay', (ctx, id, p, dest) => id === ctx.self && ...)` (also blocks effect plays) |
| play by an effect | `ctx.play(id, { cost: 'free' \| 'full' \| 'noEnergy' \| { reduce } \| { pay }, destinations?, then?: 'banish' \| 'recycle', noAdditional? })`, `ctx.canPlayByEffect(id, opts)` |
| move destination ("Move an enemy unit") | targets `[T.unit(...), T.destination(F.moveDestFor(0))]` + `E.moveToChosen(0, 1)` (chosen as played, CR 355.4) |
| trigger "if" | `if:` = trigger condition (checked only when the event happens); `ifOnResolve:` = condition printed in the effect |
| additional-cost choices in asPlay | `ctx.playAffordableWith({ energy: -n })` — don't offer choices that make the play unpayable (CR 355.16) |
| earlier choice groups in filters | `ctx.targets[j]` / `ctx.target(j)` (also during legality checks, trigger placement and resolution re-checks) |
| leading "you may choose/move X" trigger | first group `T.upTo(1, ...)`: choosing nothing removes the trigger (automatic when the text/prompt starts "you may"; force with `mayChoose: true/false`) |
| reflexive item that may have nothing to do | `reflexiveAbility(key, { offerIf: ctx => ..., optional, cost, effect })` — `offerIf` is checked as it is finalized, before the "you may" |
| "Kill a friendly unit" cost that may use the source | `pay.killFriendly(filter, label, { includeSelf: true })` (Malzahar); the cost counts as paid even if the kill is replaced |
| Equipment effect text needing "this" | `ctx.abilitySource` is the Equipment in trigger matching/finalization/resolution, statics, replacements and rules (SF-2); `ctx.banish(ids, { linkTo })` (SF-3) |
| "cards with [Reaction]" while being played | `ctx.playTiming(id, player, dest)` (Ambush → Reaction to a battlefield with your units, facedown → Reaction) |
| token can't be played there | `rule('cantPlayToken', (ctx, token, p, dest) => ...)` (`cantPlay` is for cards) |

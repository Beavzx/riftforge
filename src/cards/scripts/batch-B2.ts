// Batch B2 card scripts (equipment / gear / activated abilities). Owned by scripting agent B2.
// Card text is looked up from TX (copied verbatim from data/cards.json `text`); behaviour follows the
// `reminderText` where parentheses carry rules. Keyword-only cards are registered with no abilities.
import {
  card, spell, onPlay, deathknell, onAttack, onConquer, atStartOfBeginning, atStartOfMain, whenUnitDies,
  activated, mana, statik, selfMight, anthem, rule, replacement, asPlay, grantable, delayedAbility, when, mode, cost, pay, dep,
  selfKeyword, onMove, onCombatRole, onHold, bonusDamage, wouldDie, atEndOfTurn, reflexiveAbility,
  E, T, F, C, D, R, type Effect, type Ctx, type ObjId, type PlayerId, type Ability, type ScriptOpts, type CostSpec, type GameEvent,
} from '../dsl.ts';
import {
  entersExhausted, immediate, addAbility, maxPayable, killFriendlyPermanent, anyPowerOrExhaustFriendly,
  friendlyGearCount, isEquipmentDef, baseMightBonus, friendlyPermanentDiedThisTurn, drawOrdinal, bfControllerListener,
  bfControllerBefore, ownAbilityKeyPrefix, alsoTriggerAs,
} from '../helpers/B2.ts';
import { playGold, playUnitTokens } from '../helpers/B3.ts';
import { canAffordPlay, playIt, inMyTrash, isUnitCard } from '../helpers/B7.ts';
import { addModifier } from '../../engine/actions.ts';
import { getScript } from '../registry.ts';
import type { PowerSym } from '../../engine/abilities.ts';
import type { QueuedTrigger } from '../../engine/events.ts';
import { abilityFromKey } from '../../engine/events.ts';
import { intrinsicKeywords } from '../../engine/chars.ts';
import { splitKeyword, SUMMING } from '../../engine/keywords.ts';
import { Rollback } from '../../engine/ask.ts';

type Loc = 'base' | number;

const TX: Record<string, string> = {
  "ogn-017-298": "This enters exhausted.\n[T]: Deal 2 to a unit at a battlefield.", // Iron Ballista
  "ogn-021-298": "[T]: [Legion] — The next unit you play this turn enters ready.", // Sun Disc
  "ogn-023-298": "Discard 1, [E]: Choose a friendly unit. The next time it would die this turn, you may pay [C] to heal it, exhaust it, and recall it instead.", // Unlicensed Armory
  "ogn-032-298": "[E]: The next spell you play this turn deals 1 Bonus Damage.", // Ravenborn Tome
  "ogn-040-298": "[T]: [Reaction] — [Add] [C].", // Seal of Rage
  "ogn-072-298": "When you kill a stunned enemy unit, you may exhaust this to draw 1.", // Solari Shrine
  "ogn-081-298": "[T]: [Reaction] — [Add] [C].", // Seal of Focus
  "ogn-090-298": "[T]: Give a unit -1 [S] this turn, to a minimum of 1 [S].", // Orb of Regret
  "ogn-098-298": "[T]: [Reaction] — [Add] [1].", // Energy Conduit
  "ogn-099-298": "Recycle 3 from your trash, [1], [T]: Draw 1.", // Garbage Grabber
  "ogn-101-298": "At the start of your Beginning Phase, if you control a facedown card at a battlefield, draw 1.", // Mushroom Pouch
  "ogn-113-298": "Kill a friendly unit or gear, [T]: [Action] — [Add] [A][A].", // Malzahar
  "ogn-120-298": "[T]: [Reaction] — [Add] [C].", // Seal of Insight
  "ogn-124-298": "[T]: Buff an exhausted friendly unit.", // Arena Bar
  "ogn-163-298": "[T]: [Reaction] — [Add] [C].", // Seal of Strength
  "ogn-181-298": "[E]: Return another friendly gear, unit, or facedown card to its owner's hand.", // Pack of Wonders
  "ogn-182-298": "When this is played, discarded, or killed, draw 1.", // Scrapheap
  "ogn-184-298": "[1], [E]: Move a friendly unit at a battlefield to its base.", // The Syren
  "ogn-186-298": "When this leaves the board, draw 1 and channel 1 rune exhausted.\n[C], [T]: Kill this.", // Treasure Trove
  "ogn-204-298": "[T]: [Reaction] — [Add] [C].", // Seal of Discord
  "ogn-245-298": "[T]: [Reaction] — [Add] [C].", // Seal of Unity
  "ogs-014-024": "[T]: [Reaction] — [Add] [2]. Spend this Energy only to play spells.", // Lux
  "rad-002-167": "[Deploy]\nFriendly units here have [Assault].", // Banner of Conquest
  "rad-005-167": "I enter ready if a friendly unit or gear died this turn.", // Lingering Animus
  "rad-012-167": "When you play this or when this leaves the board, banish the top card of your Main Deck. Until your next Ending Phase, you may play that card.\n[2][C], [T]: Kill this.", // Runeblade Anvil
  "rad-017-167": "[Deploy]\nWhen you play this, you may kill another friendly unit or gear to draw 1.\nFriendly [Deathknell] effects here trigger an additional time.", // Detonation Amplifier
  "rad-021-167": "I enter ready.\n[Assault]\n[Action][>] Discard 1, [1][C]: Banish me, then play me to your base, ignoring my cost.", // Ekko
  "rad-024-167": "[Deploy]\nWhen you win a combat here, draw 1.", // Blossoming Dreamroot
  "rad-035-167": "When you play this, give a friendly unit +3 [S] this turn.\nExhaust a friendly [Mighty] unit, [T]: Draw 1.", // Invigorating Bloom
  "rad-044-167": "[Deploy]\nWhen you play this, you may move an enemy unit to this battlefield.\nFriendly units here have [Shield 2].", // Hunting Blind
  "rad-062-167": "[Deploy]\nOpponents must pay [1][A] to move one or more units to this battlefield.\n[Deathknell][>] Draw 1.", // Gravity Field
  "rad-069-167": "When you play a card, draw 2.\nWhen you draw 1 or more cards with 9 or more other cards in your hand, discard your hand, kill this, and choose an opponent. They score 1 point.", // Zero Point Inflection
  "rad-071-167": "[Equip] [1]", // Nazuman Ntofo
  "rad-073-167": "[Deploy]\nWhen you play this or when you conquer here, [Buff] a friendly unit.", // Pillaged Armory
  "rad-087-167": "[Deploy]\nWhen you play this, you may pay [C] to ready a unit here.\nFriendly units here have [Ganking].", // Portable Portal
  "rad-089-167": "When you play a unit with Might greater than each other unit on the board, exhaust me to draw 1.", // Titanic Shrine
  "rad-104-167": "[T]: [Stun] an enemy unit.", // Pitiless Stalker
  "rad-106-167": "[Deploy]\nWhen you play this, discard 1, then draw 3.\nWhen you hold here, return this to its owner's hand.", // The Good Stuff
  "rad-108-167": "[Deploy]\nWhile you or an ally control this battlefield, that player may hide an additional card here.", // Bushwhack Trap
  "rad-123-167": "[Quick-Draw]\n[Equip] [1]", // Protector's Shield
  "rad-130-167": "When a friendly gear at a battlefield dies, you may pay [1] to return it to its owner's hand.", // Battlefield Armorer
  "rad-136-167": "[Deploy]\nWhen you play this, banish a unit here.\nWhen you hold here, kill this to play the banished card, ignoring its cost.", // Dockside Lock-Up
  "rad-146-167": "[Deploy]\n[Ganking]\nWhen you play or move this, choose one —\n- Draw 1.\n- Deal 2 to enemy units here.", // The Ball
  "rad-150-167": "[Equip] — [A] or exhaust a friendly unit.", // Blade of the Exile
  "sfd-009-221": "[Equip] [C]", // Serrated Dirk
  "sfd-011-221": "[Reaction]\nChoose a unit and an Equipment with the same controller. Attach that Equipment to that unit or detach that Equipment from that unit. Draw 1.", // Angle Shot
  "sfd-016-221": "[Equip] [C]", // Recurve Bow
  "sfd-022-221": "[Quick-Draw]\n[Equip] [C]", // Long Sword
  "sfd-024-221": "[Tank]\nWhen I attack, you may play an Equipment with Energy cost no more than [2], ignoring its cost. If you do, then do this: Attach it to me.", // Rell
  "sfd-030-221": "[Equip] [1][C]", // Skyfall of Areion
  "sfd-033-221": "[Equip] [C]", // Doran's Shield
  "sfd-042-221": "[Equip] [C]", // Brutalizer
  "sfd-046-221": "When you play this, draw 1.\n[1][C], [T], Kill this: Draw 1.", // Poro Snax
  "sfd-049-221": "When you attach an Equipment to me, choose one that hasn't been chosen this turn —\n- Ready 2 runes.\n- Channel 1 rune exhausted.\n- Buff a friendly unit.", // Aphelios
  "sfd-050-221": "[C]: [Action] — Choose a unit you control. Move me to its location and it to my original location. If it's equipped, you may attach one of its Equipment to me. Use only once per turn.", // Azir
  "sfd-051-221": "[Equip] [C]", // Guardian Angel
  "sfd-052-221": "[T]: Give a unit +3 [S] this turn.", // Heart of Dark Ice
  "sfd-056-221": "[Quick-Draw]\n[Equip] [C]", // Sterak's Gage
  "sfd-059-221": "[Equip] [1][C]\nAs this is attached to a unit, copy that unit's text to this Equipment's effect text for as long as this is attached to it.", // Svellsongur
  "sfd-064-221": "[Quick-Draw]\n[Equip] [C]", // Cloth Armor
  "sfd-068-221": "[Accelerate]\nEach Equipment attached to me gives double its base Might bonus.", // Gearhead
  "sfd-073-221": "[Equip] [C]", // Experimental Hexplate
  "sfd-078-221": "[A], [T]: Give the next spell you play this turn [Repeat] equal to its cost.", // Temporal Portal
  "sfd-083-221": "[T]: [Reaction] — Pay any amount of [A] to [Add] that much Energy.", // Hextech Anomaly
  "sfd-085-221": "[Deflect 2]\n[Weaponmaster]\nI have +1 [S] for each friendly gear.", // Ornn
  "sfd-086-221": "[Equip] [C]", // World Atlas
  "sfd-088-221": "[1][C]: Draw 1.\n[4][C][C][C][C], [T]: Score 1 point.\nUse my abilities only while I'm at a battlefield.", // Renata Glasc
  "sfd-090-221": "[Equip] [1][C]\n[3][C], Banish this: Play all units banished with this, ignoring their costs.", // The Zero Drive
  "sfd-095-221": "[Equip] [C]", // Doran's Blade
  "sfd-102-221": "[Equip] [C]", // Hexdrinker
  "sfd-104-221": "[Temporary]\nFriendly units have [Deflect].", // Petricite Monument
  "sfd-107-221": "Choose an equipped friendly unit. It deals damage equal to its Might to an enemy unit. Then detach an Equipment from it.", // Strike Down
  "sfd-108-221": "[Equip] [C]", // Warmog's Armor
  "sfd-109-221": "[Weaponmaster]\nYou may pay [C][C] as an additional cost to play me.\nWhen you play me, if you paid the additional cost, move an enemy gear to your base. You control it until I leave the board. If it's an Equipment, attach it to me.", // Akshan
  "sfd-113-221": "[Weaponmaster]\nThe first time I conquer each turn, ready me.", // Lucian
  "sfd-115-221": "[Equip] [C]", // Trinity Force
  "sfd-116-221": "[Weaponmaster]\nWhen I conquer a battlefield that was uncontrolled, deal damage equal to my Might to an enemy unit in a base.", // Yone
  "sfd-117-221": "[T]: [Reaction] — Pay any amount of Energy to [Add] that much [A].", // Ancient Henge
  "sfd-118-221": "[Equip] [1][C]", // Boneshiver
  "sfd-119-221": "[Weaponmaster]\nWhen you attach an Equipment to me, you may pay [1] to draw 1.", // Jax
  "sfd-124-221": "[Equip] [C]", // Doran's Ring
  "sfd-133-221": "[Equip] [C]", // Boots of Swiftness
  "sfd-134-221": "[Equip] [C]", // Cull
  "sfd-139-221": "[Hidden]\nWhen you play this from face down, attach it to a unit you control.\n[Equip] [C]", // Edge of Night
  "sfd-144-221": "When you choose a friendly unit, you may pay [1] and exhaust this to draw 1.", // Spirit Wheel
  "sfd-150-221": "[Equip] — [C], Recycle 2 cards from your trash", // Last Rites
  "sfd-153-221": "[Equip] [C]", // Eye of the Herald
  "sfd-161-221": "[Equip] [C]", // B.F. Sword
  "sfd-169-221": "When a friendly unit dies, you may exhaust me to draw 1, then put a card from your hand on the top or bottom of your Main Deck.", // Altar of Memories
  "sfd-172-221": "[Equip] [C]", // Sacred Shears
  "sfd-178-221": "[Equip] — [C], Kill a friendly unit", // Blade of the Ruined King
  "sfd-184-221": "[Action]\nMove a friendly unit. You may attach up to one Equipment with the same controller to it. This turn, that unit has \"When I conquer, you may move me to my base.\"", // Relentless Pursuit
  "sfd-186-221": "[Quick-Draw]\n[Equip] [A]\n[Temporary]", // Spinning Axe
  "sfd-190-221": "[Unique]\n[Equip] [A]", // Forgefire Cape
  "sfd-191-221": "[Unique]\n[Equip] [A]", // Rabadon's Deathcrown
  "sfd-192-221": "[Unique]\n[Equip] [A]\nWhen you play this, ready your units.", // Shurelya's Requiem
  "sfd-193-221": "[1], [T]: Attach a detached Equipment you control to a unit you control.\n[T]: Attach an attached Equipment you control to a unit you control.", // Grandmaster at Arms
  "sfd-221-221": "When you conquer here, you may ready a friendly gear. If it's an Equipment, you may detach it.", // Veiled Temple
  "unl-011-219": "When you play a unit during a showdown, you may exhaust this to draw 1.", // Fresh Beans
  "unl-019-219": "[Equip] [1][C]", // Blighted Battleaxe
  "unl-039-219": "[Equip] [C]", // Soul Sword
  "unl-045-219": "[Action][>] Exhaust a unit you control, [T]: Move a different unit you control to the location of the unit you exhausted to pay for this ability.", // Forgotten Signpost
  "unl-049-219": "This enters exhausted.\n[Reaction][>] [T]: [Add] [A].\n[Level 6][>] [>>][Reaction][>] [T]: [Add] [1][A].", // Honeyfruit
  "unl-074-219": "When you draw your second card each turn, give a friendly unit +2 [S] this turn.", // Frigid Jewel
  "unl-085-219": "[Reaction]\n[Temporary]\nWhen an opponent scores, draw 1.", // Sumpworks Map
  "unl-093-219": "[Reaction][>] [T]: [Add] [1].", // Dragonsoul Sage
  "unl-096-219": "[Equip] [C]", // Hunter's Machete
  "unl-138-219": "As you play this, name a tag.\n[T]: Give a unit with the named tag -2 [S] this turn.", // The List
  "unl-148-219": "When you play this, banish all units from your trash.\n[T]: Play a unit banished with this.", // Cursed Sarcophagus
  "unl-158-219": "When you play this, gain 1 XP.\n[Equip] — Spend 1 XP", // Shepherd's Heirloom
  "unl-161-219": "[Vision]\n[Action][>] Kill this, [T]: Give a unit +2 [S] this turn.", // Divining Shells
  "unl-188-219": "[Equip] [3][A]. This ability's Energy cost is reduced by the Might of the unit you choose.", // Hextech Gauntlets
  "unl-t05": "[Reaction][>] Kill this, [T]: [Add] [A].", // Gold
  "ven-011-166": "[Equip] [C]", // Pendulum Blade
  "ven-027-166": "[Equip] [C]", // Hand Hammer
  "ven-041-166": "[Weaponmaster]\nWhen I attack, choose an enemy unit here. Deal 2 to it for each Equipment attached to me.", // Riven
  "ven-044-166": "When you play your first card each turn, if I'm at a battlefield, the next card you play this turn costs [2][A][A] less.", // Astral Heron
  "ven-063-166": "Once each turn, when an enemy unit here dies, channel 1 rune exhausted.", // Nasus
  "ven-067-166": "At the start of your Main Phase, you may kill 3 other friendly units and/or gear to score 1 point.", // Bottled Constellation
  "ven-073-166": "[Equip] [C]", // Jagged Cutlass
  "ven-075-166": "This enters exhausted.\n[Empower] — [1], [T]\n[Reaction][>] [T]: [Add] [1]. If this is [Empowered], [Add] [2] instead.", // Platewyrm Egg
  "ven-102-166": "When an opponent plays a gear, you may banish me to banish it.", // Ravenbloom Prefect
  "ven-116-166": "Choose a unit. Its base Might becomes 5 this turn.\n[Flow] [3]", // Dragon Form
  "ven-137-166": "[Equip] [1][C]\nAs this is attached to a unit, choose another friendly unit. The equipped unit becomes a copy of that unit for as long as this is attached to it.", // Shady Spectacles
};

/** Registers TX[id]; an Equipment's printed band (BAND below) is appended to its abilities. */
function def(id: string, abilities: Ability[], opts: ScriptOpts = {}) { return card(id, TX[id], [...abilities, ...(BAND[id] ?? [])], opts); }

// ---------------- small shared pieces ----------------
const self = (ev: GameEvent, ctx: Ctx) => ev.obj === ctx.self;
const evObj = (ctx: Ctx) => ctx.event?.obj as ObjId;
/** location of this permanent (battlefield index or 'base') */
const myLoc = (ctx: Ctx): Loc | null => ctx.loc(ctx.self);
const atMyBf = (ev: GameEvent, ctx: Ctx) => { const l = myLoc(ctx); return typeof l === 'number' && ev.bf === l; };
// one object once: a Gear Unit (Patched Porobot) is both a unit and a gear (CR 178; RJ#12065)
const friendlyPermanents = (ctx: Ctx) => [...new Set([...ctx.friendlyUnits(), ...ctx.gear(g => ctx.isFriendly(g))])].filter(id => id !== ctx.self && ctx.ctrl(id) === ctx.controller);
const equipmentOn = (ctx: Ctx, unit: ObjId) => ctx.attachments(unit).filter(g => isEquipmentDef(ctx, g));
const printedCost = (ctx: Ctx, id: ObjId): CostSpec => ({ energy: ctx.energyCost(id), power: new Array(ctx.powerCost(id)).fill('C') as PowerSym[] });
const helpUnit = (prompt: string, ...f: Parameters<typeof T.unit>) => T.unit(...f, { hint: 'help', prompt });
const harmUnit = (prompt: string, ...f: Parameters<typeof T.unit>) => T.unit(...f, { hint: 'harm', prompt });
const SEAL = (id: string) => def(id, [mana('[T]', { power: ['C'] }, { text: '[T]: [Reaction] — [Add] [C].' })]);

// =====================================================================================
// Equipment bands (SCRIPT-FIX). data/cards.json `attachedText` is the printed bottom band: what the equipped unit has
// while this is attached ("I/me" = the equipped unit). `section: 'effect'`: active only while attached, ctx.self = host.
// SF-2 (ENGINE-3): ctx.abilitySource is the Equipment in every context (trigger matching, finalization, resolution, statics,
// replacements, rules); gearOn falls back to the host's attachments by card id only for items made without it.
// Shady Spectacles' band "(I am a copy of the chosen unit.)" is reminder text for its rules text (scripted below).
// =====================================================================================
const band = (text: string) => ({ section: 'effect' as const, text });
const gearOn = (ctx: Ctx, cardId: string): ObjId | undefined => {
  const src = ctx.abilitySource;
  if (src && ctx.obj(src)?.cardId === cardId) return src;
  return ctx.attachments(ctx.self).find(g => ctx.obj(g)?.cardId === cardId);
};
const iScored = (ev: GameEvent, ctx: Ctx) => ev.player === ctx.controller && ((ev.units as ObjId[] | undefined) ?? []).includes(ctx.self);
/** Blighted Battleaxe: per-turn record of each unit that conquered (also before the Battleaxe was attached / on the board) */
const CONQUERED = 'B2:conqueredThisTurn';
const recordConquerors: Effect = ctx => { for (const u of (ctx.event?.units as ObjId[] | undefined) ?? []) if (ctx.exists(u)) ctx.remember(CONQUERED, u); };
const brutalNote = (gear: ObjId) => `B2:brutalizer:${gear}`;
const ZERO_DRIVE = 'sfd-090-221';
const zeroDriveHost = (ctx: Ctx, gear: ObjId) => ctx.memo<{ obj: ObjId; epoch: number }>(gear, 'zeroDriveHost');

const BAND: Record<string, Ability[]> = {
  // Nazuman Ntofo / Cloth Armor
  'rad-071-167': [selfKeyword('Shield 2', band('[Shield 2]'))],
  'sfd-064-221': [selfKeyword('Shield 2', band('[Shield 2]'))],
  // Protector's Shield / Doran's Shield
  'rad-123-167': [selfKeyword('Tank', band('[Tank]'))],
  'sfd-033-221': [selfKeyword('Tank', band('[Tank]'))],
  // Blade of the Exile / Boots of Swiftness
  'rad-150-167': [selfKeyword('Ganking', band('[Ganking]'))],
  'sfd-133-221': [selfKeyword('Ganking', band('[Ganking]'))],
  // Serrated Dirk
  'sfd-009-221': [selfKeyword('Assault 2', band('[Assault 2]'))],
  // Hexdrinker
  'sfd-102-221': [selfKeyword('Deflect', band('[Deflect]'))],
  // Hunter's Machete
  'unl-096-219': [selfKeyword('Hunt', band('[Hunt]'))],
  // Pendulum Blade
  'ven-011-166': [onMove(E.might('self', 2), { toBattlefield: true, ...band('When I move to a battlefield, give me +2 [S] this turn.') })],
  // Hand Hammer
  'ven-027-166': [selfMight(2, {
    if: ctx => { const l = ctx.loc(ctx.self); return typeof l === 'number' && ctx.units(u => u !== ctx.self && ctx.ctrl(u) === ctx.controller && ctx.loc(u) === l).length === 1; },
    ...band("I have +2 [S] while I'm at a battlefield with exactly one other unit you control."),
  })],
  // Jagged Cutlass — moves made by an opponent's spell or ability (ctx.move passes the effect's controller as the mover)
  'ven-073-166': [rule('cantMove', (ctx, unit: ObjId, _from: unknown, _to: unknown, by?: PlayerId) => unit === ctx.self && typeof by === 'number' && ctx.isOpponent(by),
    undefined, band("I can't be moved by enemy spells and abilities."))],
  // Blighted Battleaxe
  'unl-019-219': [
    atEndOfTurn(ctx => {
      const gear = gearOn(ctx, 'unl-019-219');
      if (!gear || !ctx.onBoard(ctx.self)) return;
      ctx.detach(gear);
      ctx.deal(4, ctx.self, gear);
    }, { if: ctx => !ctx.remembered(CONQUERED, ctx.self), ...band("At the end of your turn, if I didn't conquer this turn, unattach this and deal 4 to me.") }),
    immediate(when('conquer', (ev, ctx) => ev.player === ctx.controller, recordConquerors, { activeIn: ['any'], text: '(records units that conquer this turn)' })),
    immediate(when('conquer', (ev, ctx) => ev.player === ctx.controller, recordConquerors, band('(records units that conquer this turn)'))),
  ],
  // Soul Sword
  'unl-039-219': [selfMight(1, { requires: [dep.level(3)], ...band('[Level 3][>] I have an additional +1 [S].') })],
  // Hextech Gauntlets — the conquer event carries the excess its controller assigned in that combat; only a conquest
  // after an attack (combat) can have assigned excess damage
  'unl-188-219': [when('conquer', (ev, ctx) => iScored(ev, ctx) && ctx.isAttacking(ctx.self) && Number(ev.excess ?? 0) >= 3, E.draw(1),
    band('When I conquer, if you assigned 3 or more excess damage, draw 1.'))],
  // Recurve Bow
  'sfd-016-221': [onCombatRole(E.deal(2, 0), { targets: [harmUnit('Recurve Bow: deal 2 to an enemy unit here', F.enemy, F.here)], ...band('When I attack or defend, deal 2 to an enemy unit here.') })],
  // Forgefire Cape
  'sfd-190-221': [onCombatRole(E.deal(2, R.enemiesHere), band('When I attack or defend, deal 2 to all enemy units here.'))],
  // Skyfall of Areion
  'sfd-030-221': [immediate(when(['conquer', 'hold'], (ev, ctx) => !ev.activated && iScored(ev, ctx),
    ctx => alsoTriggerAs(ctx, ctx.self, ctx.event!, ctx.event!.type === 'conquer' ? 'hold' : 'conquer'),
    band('My hold effects are also conquer effects, and vice versa.')))],
  // Brutalizer — "+2 while this was attached to me this turn": a this-turn modifier added as it is attached, removed when detached
  'sfd-042-221': [
    immediate(when('attach', (ev, ctx) => ev.obj === ctx.abilitySource && ev.host === ctx.self, ctx => {
      const gear = ctx.event!.obj as ObjId;
      if (ctx.obj(gear)?.attachedTo === ctx.self) addModifier(ctx.g, ctx.self, { source: gear, duration: 'endOfTurn', might: 2, note: brutalNote(gear) });
    }, band('If this was attached to me this turn, I have an additional +2 [S].'))),
    immediate(when('detach', self, ctx => {
      const o = ctx.obj(ctx.event!.host as ObjId);
      if (o) { o.modifiers = o.modifiers.filter(m => m.note !== brutalNote(ctx.self)); ctx.g.ex.dirty = true; }
    }, { text: 'When this is detached, its +2 [S] ends.' })),
  ],
  // Guardian Angel
  'sfd-051-221': [wouldDie((c, id) => id === c.self, (ctx, id) => {
    const ga = gearOn(ctx, 'sfd-051-221');
    if (ga) ctx.kill(ga);
    ctx.heal(id); ctx.exhaust(id); ctx.recall(id);
  }, band('If I would die, kill Guardian Angel instead. Heal me, exhaust me, and recall me.'))],
  // Experimental Hexplate
  'sfd-073-221': [statik('self', { tags: ['Mech'] }, band('I am a Mech.'))],
  // World Atlas
  'sfd-086-221': [onHold(ctx => { playGold(ctx, 2, { exhausted: true }); }, band('When I hold, play two Gold gear tokens exhausted.'))],
  // The Zero Drive — the unit is banished from the trash on resolution, linked to the Zero Drive it wore ("banished with this")
  'sfd-090-221': [
    deathknell(ctx => {
      const lk = ctx.event?.lki as { epoch?: number } | undefined;
      const o = ctx.obj(ctx.self);
      if (!o || o.zone !== 'trash' || (lk?.epoch !== undefined && (o.epoch ?? 0) !== lk.epoch + 1)) return;
      // SF-2: the Zero Drive is the ability's source (ctx.abilitySource); fallback for items made without it
      const src = ctx.abilitySource && ctx.obj(ctx.abilitySource)?.cardId === ZERO_DRIVE ? ctx.abilitySource : undefined;
      const drive = src ? [src] : ctx.gear(gid => ctx.obj(gid)?.cardId === ZERO_DRIVE && zeroDriveHost(ctx, gid)?.obj === ctx.self);
      // SF-3: linked to the Zero Drive it wore ("units banished with this"), not to the unit
      ctx.banish(ctx.self, { linkTo: drive[0] ?? null });
    }, band('[Deathknell][>] Banish me.')),
    immediate(when('detach', self, ctx => {
      const h = ctx.event!.host as ObjId;
      ctx.memo(ctx.self, 'zeroDriveHost', { obj: h, epoch: ctx.obj(h)?.epoch ?? 0 });
    }, { text: '(remembers the unit it was attached to)' })),
  ],
  // Warmog's Armor
  'sfd-108-221': [onConquer(E.buff('self'), band('When I conquer, buff me.'))],
  // Trinity Force
  'sfd-115-221': [onHold(E.points(1), band('When I hold, score 1 point.'))],
  // Boneshiver
  'sfd-118-221': [onConquer(E.channel(1, true), band('When I conquer, channel 1 rune exhausted.'))],
  // Doran's Ring
  'sfd-124-221': [onConquer(E.seq(E.discard(1), E.draw(1)), band('When I conquer, discard 1, then draw 1.'))],
  // Cull
  'sfd-134-221': [onConquer(ctx => { playGold(ctx, 1, { exhausted: true }); }, band('When I conquer, play a Gold gear token exhausted.'))],
  // Last Rites — "you may" + the trash unit are chosen as the trigger goes on the chain (up to one target); you pay its costs
  'sfd-150-221': [when(['conquer', 'hold'], iScored, ctx => {
    const t = ctx.target(0);
    if (t && ctx.obj(t)?.zone === 'trash') playIt(ctx, t, { cost: 'full' });
  }, {
    targets: [{ ...T.card({ zones: ['trash'], prompt: 'Last Rites: you may play a unit from your trash (you pay its costs)' }, inMyTrash,
      (c: Ctx, id: ObjId) => isUnitCard(c, id) && canAffordPlay(c, id, 'full')), min: 0, max: 1 }],
    ...band('When I conquer or hold, you may play a unit from your trash.'),
  })],
  // Eye of the Herald
  // "here" = where the unit is when this resolves; nothing if it left the board (CR 359.3.f; RJ#7840)
  'sfd-153-221': [onMove(ctx => { const at = ctx.onBoard(ctx.self) ? ctx.loc(ctx.self) : null; if (at !== null) playUnitTokens(ctx, 'Recruit', 1, { at }); }, band('When I move, play a 1 [S] Recruit unit token here.'))],
  // Sacred Shears
  'sfd-172-221': [deathknell(E.draw(1), band('[Deathknell][>] Draw 1.'))],
  // Rabadon's Deathcrown — damage dealt by your spells and abilities (not combat damage)
  'sfd-191-221': [{ ...bonusDamage((ctx, ev) => ev.player === ctx.controller && !ev.combat && !ev.unitDealt, 3, 'Your spells and abilities deal 3 Bonus Damage.'), section: 'effect' as const }],
  // Shurelya's Requiem
  'sfd-192-221': [anthem(F.and(F.unit, F.youControl, F.here), { keywords: ['Ganking'] }, band('Your units here have [Ganking].'))],
};

// =====================================================================================
// Equipment whose rules text is only keywords (Equip / Quick-Draw / Unique / Temporary come from data keywords +
// keywordCosts); their bands come from BAND
// =====================================================================================
for (const id of [
  'rad-071-167', 'rad-123-167', 'sfd-009-221', 'sfd-016-221', 'sfd-022-221', 'sfd-030-221', 'sfd-033-221', 'sfd-042-221',
  'sfd-051-221', 'sfd-056-221', 'sfd-064-221', 'sfd-073-221', 'sfd-086-221', 'sfd-095-221', 'sfd-102-221', 'sfd-108-221',
  'sfd-115-221', 'sfd-118-221', 'sfd-124-221', 'sfd-133-221', 'sfd-134-221', 'sfd-153-221', 'sfd-161-221', 'sfd-172-221',
  'sfd-186-221', 'sfd-190-221', 'sfd-191-221', 'unl-019-219', 'unl-039-219', 'unl-096-219', 'ven-011-166', 'ven-027-166',
  'ven-073-166',
]) def(id, []);

// =====================================================================================
// Mana rocks / Add abilities
// =====================================================================================
for (const id of ['ogn-040-298', 'ogn-081-298', 'ogn-120-298', 'ogn-163-298', 'ogn-204-298', 'ogn-245-298']) SEAL(id);

// Energy Conduit
def('ogn-098-298', [mana('[T]', { energy: 1 }, { text: '[T]: Add [1].' })]);
// Lux, Crownguard
def('ogs-014-024', [mana('[T]', { energy: 2, only: 'spell' }, { text: '[T]: Add [2]. Spend this Energy only to play spells.' })]);
// Dragonsoul Sage
def('unl-093-219', [mana('[T]', { energy: 1 }, { text: '[T]: Add [1].' })]);
// Gold (token). NOTE: batch B3 also registers unl-t05 (token definitions); both behave the same. The token no longer exists
// when the effect runs (killed as the cost), so the effect adds [A] directly instead of reading the source's domains.
def('unl-t05', [{ ...mana(cost('[T]', pay.killSelf()), { power: ['A'] }, { text: 'Kill this, [T]: Add [A].' }), effect: ctx => ctx.add(0, ['any']) }]);
// Malzahar, Fanatic — [Action] Add ability: usable on your turn or in showdowns (also by the auto-payer then)
def('ogn-113-298', [
  // RJ#6900: he may exhaust and then kill himself (non-standard costs are paid in any order)
  mana(cost('[T]', killFriendlyPermanent(undefined, { includeSelf: true })), { power: ['A', 'A'] }, {
    timing: 'action', if: ctx => ctx.isMyTurn() || ctx.inShowdown(), text: 'Kill a friendly unit or gear, [T]: Add [A][A].',
  }),
]);
// Honeyfruit
def('unl-049-219', [
  entersExhausted(),
  mana('[T]', { power: ['A'] }, { text: '[T]: Add [A].' }),
  mana('[T]', { energy: 1, power: ['A'] }, { requires: [dep.level(6)], text: 'Level 6 — [T]: Add [1][A].' }),
]);
// Platewyrm Egg (Empower cost "[1], [T]" comes from data keywordCosts)
def('ven-075-166', [
  entersExhausted(),
  mana('[T]', { energy: 1 }, { if: ctx => !ctx.isEmpowered(ctx.abilitySource ?? ctx.self), text: '[T]: Add [1].' }),
  mana('[T]', { energy: 2 }, { if: ctx => ctx.isEmpowered(ctx.abilitySource ?? ctx.self), text: '[T]: Add [2] (Empowered).' }),
]);
// Hextech Anomaly — pay any amount of [A], add that much Energy
def('sfd-083-221', [
  addAbility(cost('[T]'), ctx => {
    const max = maxPayable(ctx, 12, n => ({ energy: 0, power: new Array(n).fill('A') as PowerSym[] }));
    const n = ctx.chooseNumber(0, max, 'Pay how much [A]? (Add that much Energy)');
    if (n > 0 && ctx.pay({ energy: 0, power: new Array(n).fill('A') as PowerSym[] })) ctx.add(n, []);
  }, '[T]: Pay any amount of [A] to Add that much Energy.'),
]);
// Ancient Henge — pay any amount of Energy, add that much [A]
def('sfd-117-221', [
  // convert: the auto-payer may also use it while paying another cost, e.g. Bullet Time's amount on resolution (RJ#7770)
  { ...addAbility(cost('[T]'), ctx => {
    const max = maxPayable(ctx, 12, n => ({ energy: n, power: [] }));
    const n = ctx.chooseNumber(0, max, 'Pay how much Energy? (Add that much [A])');
    if (n > 0 && ctx.pay({ energy: n, power: [] })) ctx.add(0, new Array(n).fill('any'));
  }, '[T]: Pay any amount of Energy to Add that much [A].'), convert: 'energyToAny' },
]);

// =====================================================================================
// Gear with activated abilities
// =====================================================================================
// Iron Ballista
def('ogn-017-298', [
  entersExhausted(),
  activated('[T]', E.deal(2, 0), { targets: [harmUnit('Deal 2 to a unit at a battlefield', F.atBattlefield)], text: '[T]: Deal 2 to a unit at a battlefield.' }),
]);
// Sun Disc
def('ogn-021-298', [
  activated('[T]', ctx => ctx.delay(D.nextUnitReady, {}, 'endOfTurn', 1), { requires: [dep.legion()], text: '[T]: Legion — The next unit you play this turn enters ready.' }),
]);

// Unlicensed Armory — "the next time it would die this turn, you may pay [C] to heal, exhaust and recall it instead"
const armoryShield = delayedAbility('B2:ogn-023:shield', replacement('die',
  (ev, ctx) => ev.obj === ctx.data.obj && (ctx.obj(ev.obj as ObjId)?.epoch ?? 0) === ctx.data.epoch,
  (ev, ctx) => {
    // RULINGS: CR 371.2.b — declining an optional ("may") replacement means it wasn't applied, so it stays for the next time
    const id = ev.obj as ObjId;
    const c: CostSpec = { energy: 0, power: [ctx.data.domain as PowerSym] };
    if (ctx.mayPay(c, `Unlicensed Armory: pay [C] to heal ${ctx.name(id)}, exhaust it and recall it instead of it dying?`)) {
      ctx.data.__consume = true;
      ctx.heal(id); ctx.exhaust(id); ctx.recall(id);
      return null;
    }
    return ev;
  }, { text: 'Unlicensed Armory: pay [C] to heal, exhaust and recall instead of dying' }));
def('ogn-023-298', [
  activated(cost('[T]', pay.discard(1)), ctx => {
    const t = ctx.target(0);
    if (t) ctx.delay(armoryShield, { obj: t, epoch: ctx.obj(t).epoch ?? 0, domain: ctx.domains(ctx.self)[0] ?? 'Fury' }, 'endOfTurn');
  }, { targets: [helpUnit('Choose a friendly unit', F.friendly)], text: 'Discard 1, [T]: protect a friendly unit this turn.' }),
]);

// Ravenborn Tome — 1 Bonus Damage for each instance of damage the next spell deals
const nextSpellAfter = (ctx: Ctx, idx: number): ObjId | undefined =>
  (ctx.g.ex.playedThisTurn[ctx.controller] ?? []).slice(idx).find(id => ctx.obj(id) && ctx.g.cards[ctx.obj(id).cardId]?.type === 'Spell');
const tomeBonus = delayedAbility('B2:ogn-032:bonus', replacement('damage', (ev, ctx) => {
  const sp = nextSpellAfter(ctx, Number(ctx.data.idx ?? 0));
  // RJ#1393 DECIDED (lead, VEN-FAQ #17): the bonus stays after an opponent takes control of the spell — its original player played it
  return !!sp && ev.source === sp && ctx.obj(sp)?.zone === 'chain';
}, ev => ({ ...ev, amount: Number(ev.amount) + 1 }), { text: 'Ravenborn Tome: 1 Bonus Damage', bonus: () => 1 }));
def('ogn-032-298', [
  activated('[T]', ctx => ctx.delay(tomeBonus, { idx: (ctx.g.ex.playedThisTurn[ctx.controller] ?? []).length }, 'endOfTurn'),
    { text: '[T]: The next spell you play this turn deals 1 Bonus Damage.' }),
]);
// Orb of Regret
def('ogn-090-298', [activated('[T]', E.mightMin(0, 1, 1), { targets: [harmUnit('Give a unit -1 Might this turn (minimum 1)')], text: '[T]: Give a unit -1 [S] this turn, to a minimum of 1 [S].' })]);
// Garbage Grabber
def('ogn-099-298', [activated(cost('[1][T]', pay.recycleFromTrash(3)), E.draw(1), { text: 'Recycle 3 from your trash, [1], [T]: Draw 1.' })]);
// Arena Bar
def('ogn-124-298', [activated('[T]', E.buff(0), { targets: [helpUnit('Buff an exhausted friendly unit', F.friendly, F.exhausted)], text: '[T]: Buff an exhausted friendly unit.' })]);
// Pack of Wonders
const myFacedown = (ctx: Ctx) => Object.values(ctx.g.objects).filter(o => o.zone === 'facedown' && o.controller === ctx.controller).map(o => o.id);
def('ogn-181-298', [
  activated('[T]', E.noop, {
    text: '[T]: Return another friendly gear, unit, or facedown card to its owner\'s hand.',
    modes: [
      mode('permanent', 'Return another friendly gear or unit', E.returnToHand(0), [T.permanent(F.friendly, F.other, { prompt: 'Return another friendly gear or unit to its owner\'s hand' })]),
      // RULINGS sweep / CR 355.5: the facedown card is a target chosen as the ability is activated
      mode('facedown', 'Return a facedown card you control', E.returnToHand(0),
        [T.card({ zones: ['facedown'], prompt: 'Return a facedown card to its owner\'s hand' }, (c, id) => c.obj(id)?.controller === c.controller)],
        ctx => myFacedown(ctx).length > 0),
    ],
  }),
]);
// The Syren
def('ogn-184-298', [activated('[1][T]', E.move(0, 'base'), { targets: [helpUnit('Move a friendly unit at a battlefield to its base', F.friendly, F.atBattlefield)], text: '[1], [T]: Move a friendly unit at a battlefield to its base.' })]);
// Treasure Trove
def('ogn-186-298', [
  when('leaveBoard', self, E.seq(E.draw(1), E.channel(1, true)), { text: 'When this leaves the board, draw 1 and channel 1 rune exhausted.' }),
  activated('[C][T]', E.kill('self'), { text: '[C], [T]: Kill this.' }),
]);
// Runeblade Anvil
const anvil = (ctx: Ctx) => { const top = ctx.deck()[0]; if (top && ctx.banish(top).length) ctx.allowPlay(top, 'nextEnding'); };
def('rad-012-167', [
  onPlay(anvil, { text: 'When you play this, banish the top card of your Main Deck; you may play it until your next Ending Phase.' }),
  when('leaveBoard', self, anvil, { text: 'When this leaves the board, banish the top card of your Main Deck; you may play it until your next Ending Phase.' }),
  activated('[2][C][T]', E.kill('self'), { text: '[2][C], [T]: Kill this.' }),
]);
// Invigorating Bloom
def('rad-035-167', [
  onPlay(E.might(0, 3), { targets: [helpUnit('Give a friendly unit +3 Might this turn', F.friendly)], text: 'When you play this, give a friendly unit +3 [S] this turn.' }),
  activated(cost('[T]', pay.exhaustFriendly((c, id) => c.isUnit(id) && c.isMighty(id), 'Exhaust a friendly Mighty unit')), E.draw(1), { text: 'Exhaust a friendly Mighty unit, [T]: Draw 1.' }),
]);
// Heart of Dark Ice
def('sfd-052-221', [activated('[T]', E.might(0, 3), { targets: [helpUnit('Give a unit +3 Might this turn')], text: '[T]: Give a unit +3 [S] this turn.' })]);
// Poro Snax
def('sfd-046-221', [
  onPlay(E.draw(1), { text: 'When you play this, draw 1.' }),
  activated(cost('[1][C][T]', pay.killSelf()), E.draw(1), { text: '[1][C], [T], Kill this: Draw 1.' }),
]);
// Temporal Portal — the next spell gets [Repeat] equal to its (printed) cost: offered right after it is played
const portalRepeat = delayedAbility('B2:sfd-078:repeat', immediate(when('spellFinalized', (ev, ctx) => ev.player === ctx.controller, ctx => {
  const ev = ctx.event!;
  const sp = ev.obj as ObjId;
  const item = ctx.g.chain.find(c => c.id === ev.item);
  if (!item || !ctx.obj(sp)) return;
  const c = printedCost(ctx, sp);
  const label = `${c.energy ? `[${c.energy}]` : ''}${'[C]'.repeat(c.power!.length)}` || '[0]';
  // the granted Repeat is an optional additional cost: Repeat-cost modifications apply (Ezreal, Prodigy — RJ#3472)
  const rc = ctx.grantedRepeatCost(c, sp, item);
  const lbl = `${rc.energy ? `[${rc.energy}]` : ''}${rc.power.map(x => (x === 'any' ? '[A]' : '[C]')).join('')}` || '[0]';
  if (ctx.canPayResolved(rc, sp) && ctx.may(`Temporal Portal: pay ${lbl} to repeat ${ctx.name(sp)}?`) && ctx.payResolved(rc, sp)) item.repeat = (item.repeat ?? 0) + 1;
}, { text: 'Temporal Portal: Repeat equal to its cost' })));
def('sfd-078-221', [activated('[A][T]', ctx => ctx.delay(portalRepeat, {}, 'endOfTurn', 1), { text: '[A], [T]: Give the next spell you play this turn [Repeat] equal to its cost.' })]);
// The Zero Drive — "(Use only if unattached.)"; the linked cards are read before this is banished
def('sfd-090-221', [
  activated(cost('[3][C]', pay.custom('Banish this', ctx => ctx.onBoard(ctx.abilitySource ?? ctx.self), ctx => {
    const src = ctx.abilitySource ?? ctx.self;
    ctx.data.zeroDrive = ctx.banishedWithThis(src).filter(id => ctx.g.cards[ctx.obj(id).cardId]?.type === 'Unit');
    return ctx.banish(src).length === 1;
  })), ctx => {
    for (const id of (ctx.data.zeroDrive as ObjId[] | undefined) ?? []) if (ctx.obj(id)?.zone === 'banishment') ctx.play(id, { ignoreCost: true });
  }, { if: ctx => !ctx.obj(ctx.abilitySource ?? ctx.self)?.attachedTo, text: '[3][C], Banish this: Play all units banished with this, ignoring their costs.' }),
]);
// Forgotten Signpost — the unit exhausted for the cost must differ from the chosen unit
// (not the Signpost itself: [T] exhausts it first — FUZZ e917bb53e0, a Signpost made a unit by Lady of Clockwork)
const readyMine = (ctx: Ctx) => ctx.units(u => u !== ctx.self && ctx.ctrl(u) === ctx.controller && !ctx.isExhausted(u));
def('unl-045-219', [
  activated(cost('[T]', pay.custom('Exhaust a unit you control',
    ctx => readyMine(ctx).length > 0 && ctx.units(u => ctx.ctrl(u) === ctx.controller).length >= 2,
    ctx => {
      const chosen = ctx.item?.targets?.[0]?.[0];
      const u = ctx.chooseCards(readyMine(ctx).filter(x => x !== chosen), 1, 1, 'Exhaust a unit you control')[0];
      if (!u) return false;
      ctx.exhaust(u);
      ctx.data.signpost = u;
      return true;
    })), ctx => {
    const t = ctx.target(0), ex = ctx.data.signpost as ObjId | undefined;
    if (!t || !ex || t === ex || !ctx.onBoard(ex)) return;
    const to = ctx.loc(ex);
    if (to !== null) ctx.move(t, to);
    // FUZZ: while choosing (CR 355.16), only offer units that leave another ready unit to exhaust for the cost —
    // picking the only ready unit made the cost unpayable and the activation rolled back (the bot then looped on it)
  }, { timing: 'action', targets: [helpUnit('Move a different unit you control', F.youControl, (c, id) => (!!c.item && !c.item.pending) || readyMine(c).some(x => x !== id))], text: 'Exhaust a unit you control, [T]: Move a different unit you control to its location.' }),
]);
// The List — "As you play this, name a tag." (the name is kept on the permanent)
const listTag = (ctx: Ctx) => ctx.memo<string>(ctx.abilitySource ?? ctx.self, 'namedTag');
def('unl-138-219', [
  asPlay(ctx => { ctx.data.namedTag = ctx.nameTag('The List: name a tag'); }, { text: 'As you play this, name a tag.' }),
  activated('[T]', E.might(0, -2), { targets: [harmUnit('Give a unit with the named tag -2 Might this turn', (c, id) => { const t = listTag(c); return !!t && c.hasTag(id, t); })], text: '[T]: Give a unit with the named tag -2 [S] this turn.' }),
], { entersReady: ctx => { if (typeof ctx.data.namedTag === 'string') ctx.memo(ctx.self, 'namedTag', ctx.data.namedTag); return false; } });
// Cursed Sarcophagus — "(You must pay its costs.)"
const sarcophagusUnits = (ctx: Ctx) => ctx.banishedWithThis().filter(id => ctx.g.cards[ctx.obj(id).cardId]?.type === 'Unit');
def('unl-148-219', [
  onPlay(ctx => ctx.banish(ctx.trash().filter(id => ctx.g.cards[ctx.obj(id).cardId]?.type === 'Unit')), { text: 'When you play this, banish all units from your trash.' }),
  // RULINGS sweep / CR 355.5: the banished unit is a target chosen as the ability is activated (only affordable ones offered)
  activated('[T]', ctx => {
    const pick = ctx.target(0);
    if (pick && ctx.obj(pick)?.zone === 'banishment') ctx.play(pick, { ignoreCost: false });
  }, {
    if: ctx => sarcophagusUnits(ctx).length > 0,
    targets: [T.card({ zones: ['banishment'], prompt: 'Play a unit banished with this (you pay its costs)' },
      (c, id) => sarcophagusUnits(c).includes(id) && c.canPay(printedCost(c, id), id))],
    text: '[T]: Play a unit banished with this.',
  }),
]);
// Divining Shells ([Vision] from data)
def('unl-161-219', [activated(cost('[T]', pay.killSelf()), E.might(0, 2), { timing: 'action', targets: [helpUnit('Give a unit +2 Might this turn')], text: 'Kill this, [T]: Give a unit +2 [S] this turn.' })]);
// Pitiless Stalker
def('rad-104-167', [activated('[T]', E.stun(0), { targets: [harmUnit('Stun an enemy unit', F.enemy)], text: '[T]: Stun an enemy unit.' })]);
// Renata Glasc, Mastermind
// "Use my abilities only while I'm at a battlefield" is Renata's own passive about HER abilities: a copy of an ability on another
// unit (Heimerdinger, Inventor) isn't restricted (DECISIONS #650, house)
const renataHere = (ctx: Ctx) => !/^Renata Glasc/.test(ctx.name(ctx.self)) || C.atBattlefield(ctx);
def('sfd-088-221', [
  activated('[1][C]', E.draw(1), { if: renataHere, text: '[1][C]: Draw 1. (only while at a battlefield)' }),
  activated('[4][C][C][C][C][T]', E.points(1), { if: renataHere, text: '[4][C][C][C][C], [T]: Score 1 point. (only while at a battlefield)' }),
]);
// Azir, Ascendant
def('sfd-050-221', [
  activated('[C]', ctx => {
    const t = ctx.target(0);
    if (!t || !ctx.onBoard(ctx.self)) return;
    const mine = ctx.loc(ctx.self), theirs = ctx.loc(t);
    if (mine === null || theirs === null) return;
    if (mine !== theirs) { ctx.move(ctx.self, theirs); ctx.move(t, mine); }
    const eq = ctx.target(1);
    if (eq && ctx.obj(eq)?.attachedTo === t) ctx.attach(eq, ctx.self);
  }, {
    timing: 'action', oncePerTurn: 1,
    // RULINGS sweep / CR 355.5: the Equipment ("you may attach one of its Equipment") is an up-to-one target chosen with the unit
    targets: [
      T.unit(F.youControl, F.other, { prompt: 'Choose a unit you control to swap places with' }),
      T.upTo(1, T.gear((c, id) => isEquipmentDef(c, id) && !!c.targets?.[0]?.[0] && c.obj(id)?.attachedTo === c.targets[0][0], { prompt: 'You may attach one of its Equipment to Azir' })),
    ],
    text: '[C]: Swap locations with a unit you control; you may take one of its Equipment.',
  }),
]);
// Ekko, Revolutionary (I enter ready; [Assault] from data)
def('rad-021-167', [
  activated(cost('[1][C]', pay.discard(1)), ctx => {
    if (!ctx.onBoard(ctx.self)) return;
    ctx.banish(ctx.self);
    ctx.play(ctx.self, { ignoreCost: true, destination: 'base' });
  }, { timing: 'action', text: 'Discard 1, [1][C]: Banish me, then play me to your base, ignoring my cost.' }),
], { entersReady: true });

// =====================================================================================
// Gear / unit triggers
// =====================================================================================
// Solari Shrine
def('ogn-072-298', [
  when('die', (ev, ctx) => {
    const id = ev.obj as ObjId, by = ev.by as { player?: PlayerId } | null;
    return by?.player === ctx.controller && !!ctx.obj(id) && ctx.isUnit(id) && ctx.isEnemy(id) && ctx.isStunned(id) && !ctx.isExhausted(ctx.self);
  }, E.draw(1), { optional: 'Solari Shrine: exhaust it to draw 1?', cost: cost('[T]'), text: 'When you kill a stunned enemy unit, you may exhaust this to draw 1.' }),
]);
// Mushroom Pouch
def('ogn-101-298', [atStartOfBeginning(E.draw(1), { if: ctx => myFacedown(ctx).length > 0, text: 'At the start of your Beginning Phase, if you control a facedown card at a battlefield, draw 1.' })]);
// Scrapheap
def('ogn-182-298', [
  onPlay(E.draw(1), { text: 'When this is played, draw 1.' }),
  when('discard', self, E.draw(1), { activeIn: ['any'], text: 'When this is discarded, draw 1.' }),
  when('die', self, E.draw(1), { text: 'When this is killed, draw 1.' }),
]);
// Lingering Animus
def('rad-005-167', [], { entersReady: ctx => friendlyPermanentDiedThisTurn(ctx) });
// Titanic Shrine
def('rad-089-167', [
  when('play', (ev, ctx) => {
    const u = ev.obj as ObjId;
    if (ev.player !== ctx.controller || !ctx.obj(u) || !ctx.isUnit(u) || ctx.isExhausted(ctx.self)) return false;
    const m = ctx.might(u);
    return ctx.units(x => x !== u).every(x => ctx.might(x) < m);
  // RULINGS: CR 383.3.b — "exhaust me to …" at the start of the effect is the trigger's base cost, paid (or declined) as it
  // goes on the chain; only the draw happens on resolution
  }, E.draw(1), { optional: 'Titanic Shrine: exhaust it to draw 1?', cost: cost('[T]'), text: 'When you play a unit with Might greater than each other unit on the board, exhaust me to draw 1.' }),
]);
// Battlefield Armorer
def('rad-130-167', [
  when('die', (ev, ctx) => {
    const id = ev.obj as ObjId;
    return !!ctx.obj(id) && ctx.isGear(id) && !ctx.isUnit(id) && ctx.isFriendly(id) && typeof ctx.loc(id) === 'number' && ctx.canPay(cost('[1]'));
  }, ctx => {
    const id = evObj(ctx), o = ctx.obj(id);
    const ep = Number((ctx.event?.lki as { epoch?: number } | undefined)?.epoch ?? -1);
    if (o && o.zone === 'trash' && (o.epoch ?? 0) === ep + 1) ctx.returnToHand(id);
  }, { optional: 'Battlefield Armorer: pay [1] to return that gear to its owner\'s hand?', cost: cost('[1]'), text: 'When a friendly gear at a battlefield dies, you may pay [1] to return it to its owner\'s hand.' }),
]);
// Zero Point Inflection
def('rad-069-167', [
  // RULINGS: its own play counts — triggers are checked right after the play, with it on the board (Origins FAQ, Darius)
  when('play', (ev, ctx) => ev.player === ctx.controller && !ev.token, E.draw(2), { text: 'When you play a card, draw 2.' }),
  when('draw', (ev, ctx) => {
    if (ev.player !== ctx.controller || ctx.hand().length - 1 < 9) return false;
    // one trigger per draw instruction ("1 or more cards")
    return !(ctx.g.triggerQueue as QueuedTrigger[]).some(q => q.source === ctx.self && q.event.type === 'draw');
  }, ctx => {
    ctx.discardCards([...ctx.hand()]);
    ctx.kill(ctx.self);
    ctx.scorePoint(ctx.chooseOpponent('Zero Point Inflection: choose an opponent to score 1 point'), 1);
  }, { text: 'When you draw with 9+ other cards in hand, discard your hand, kill this, and an opponent scores 1.' }),
]);
// Ravenbloom Prefect
def('ven-102-166', [
  when('play', (ev, ctx) => {
    const g = ev.obj as ObjId;
    return typeof ev.player === 'number' && ctx.isOpponent(ev.player as PlayerId) && !!ctx.obj(g) && ctx.isGear(g) && !ctx.isUnit(g) && ctx.onBoard(ctx.self);
  }, ctx => { const g = evObj(ctx); if (ctx.onBoard(g)) ctx.banish(g); },
  { optional: 'Ravenbloom Prefect: banish it to banish that gear?', cost: cost('', pay.banishSelf()), text: 'When an opponent plays a gear, you may banish me to banish it.' }),
]);
// Nasus, Guardian of Knowledge
def('ven-063-166', [whenUnitDies(F.and(F.enemy, F.here), E.channel(1, true), { oncePerTurn: 1, text: 'Once each turn, when an enemy unit here dies, channel 1 rune exhausted.' })]);
// Bottled Constellation
def('ven-067-166', [
  // RULINGS: CR 383.3.b — a cost right after "you may" is the base cost, paid as the trigger goes on the chain
  atStartOfMain(ctx => { ctx.scorePoint(ctx.controller, 1); }, {
    optional: 'Bottled Constellation: kill 3 other friendly units and/or gear to score 1 point?',
    cost: cost('', pay.custom('Kill 3 other friendly units and/or gear', cx => friendlyPermanents(cx).length >= 3,
      // a kill paid as a cost counts as paid even if a replacement (Soraka) saves the units (principle 22; RJ#12687, ENGINE-9)
      cx => { const ch = cx.chooseCards(friendlyPermanents(cx), 3, 3, 'Kill 3 other friendly units and/or gear'); if (ch.length < 3) return false; cx.kill(ch); return true; })),
    text: 'At the start of your Main Phase, you may kill 3 other friendly units and/or gear to score 1 point.',
  }),
]);
// Altar of Memories
def('sfd-169-221', [
  when('die', (ev, ctx) => { const u = ev.obj as ObjId; return u !== ctx.self && !!ctx.obj(u) && ctx.isUnit(u) && ctx.isFriendly(u) && !ctx.isExhausted(ctx.self); }, ctx => {
    ctx.draw(1);
    const c = ctx.chooseCards(ctx.hand(), 1, 1, 'Put a card from your hand on the top or bottom of your Main Deck')[0];
    if (!c) return;
    const where = ctx.chooseMode([{ id: 'top', label: 'Top of Main Deck' }, { id: 'bottom', label: 'Bottom of Main Deck' }], `Put ${ctx.name(c)} on the top or bottom?`);
    ctx.toDeck(c, where === 'top' ? 'top' : 'bottom');
  }, { optional: 'Altar of Memories: exhaust it to draw 1?', cost: cost('[T]'), text: 'When a friendly unit dies, you may exhaust me to draw 1, then put a card from your hand on top or bottom of your Main Deck.' }),
]);
// Spirit Wheel
def('sfd-144-221', [
  when('targeted', (ev, ctx) => {
    const u = ev.obj as ObjId;
    return ev.player === ctx.controller && !!ctx.obj(u) && ctx.isUnit(u) && ctx.isFriendly(u) && !ctx.isExhausted(ctx.self) && ctx.canPay(cost('[1]'));
  }, E.draw(1), { optional: 'Spirit Wheel: pay [1] and exhaust it to draw 1?', cost: cost('[1][T]'), text: 'When you choose a friendly unit, you may pay [1] and exhaust this to draw 1.' }),
]);
// Fresh Beans
def('unl-011-219', [
  when('play', (ev, ctx) => { const u = ev.obj as ObjId; return ev.player === ctx.controller && u !== ctx.self && !!ctx.obj(u) && ctx.isUnit(u) && ctx.inShowdown() && !ctx.isExhausted(ctx.self); },
    E.draw(1), { optional: 'Fresh Beans: exhaust it to draw 1?', cost: cost('[T]'), text: 'When you play a unit during a showdown, you may exhaust this to draw 1.' }),
]);
// Frigid Jewel
def('unl-074-219', [
  when('draw', (ev, ctx) => ev.player === ctx.controller && drawOrdinal(ctx, ctx.controller, ev) === 2, E.might(0, 2),
    { targets: [helpUnit('Give a friendly unit +2 Might this turn', F.friendly)], text: 'When you draw your second card each turn, give a friendly unit +2 [S] this turn.' }),
]);
// Sumpworks Map ([Reaction], [Temporary] from data)
// RULINGS: CR 470.2-470.3 — "scores" without a number of points is the Scoring process (conquer / hold), not gaining points
def('unl-085-219', [when(['conquer', 'hold'], (ev, ctx) => typeof ev.player === 'number' && ctx.isOpponent(ev.player as PlayerId), E.draw(1), { text: 'When an opponent scores, draw 1.' })]);
// Shepherd's Heirloom
def('unl-158-219', [onPlay(E.xp(1), { text: 'When you play this, gain 1 XP.' })], { costs: { Equip: cost('', pay.spendXp(1)) } });
// Astral Heron
// RJ#6045c (DECISIONS #6045c, principle 23): "your first card" = the first completed card play this turn (engine completedIndex, as
// Darius, Trifarian) — a nested Reaction resolving before an earlier spell is the first card
const firstCardThisTurn = (ev: GameEvent) => ev.completedIndex === 1;
def('ven-044-166', [
  // its own play counts: "your first card" has no "another" (OGN-FAQ Darius, Trifarian; DSL R-8; RJ#11989)
  when('play', (ev, ctx) => ev.player === ctx.controller && !ev.token && firstCardThisTurn(ev),
    ctx => ctx.delay(D.nextCostsLess, { energy: -2, power: -2 }, 'endOfTurn', 1),
    { if: C.atBattlefield, text: 'When you play your first card each turn, if I\'m at a battlefield, the next card you play this turn costs [2][A][A] less.' }),
]);

// =====================================================================================
// Deploy gear (Deploy itself is an engine keyword from data)
// =====================================================================================
// Petricite Monument ([Temporary] from data)
def('sfd-104-221', [anthem(F.and(F.friendly, F.unit), { keywords: ['Deflect'] }, { text: 'Friendly units have [Deflect].' })]);
// Banner of Conquest
def('rad-002-167', [anthem(F.and(F.friendly, F.unit, F.here), { keywords: ['Assault'] }, { text: 'Friendly units here have [Assault].' })]);
// Detonation Amplifier
def('rad-017-167', [
  // RULINGS: CR 383.3.b — the kill is the trigger's base cost, paid as it goes on the chain
  onPlay(E.draw(1), {
    optional: 'Detonation Amplifier: kill another friendly unit or gear to draw 1?',
    cost: cost('', pay.custom('Kill another friendly unit or gear', cx => friendlyPermanents(cx).length > 0,
      cx => cx.kill(cx.chooseCards(friendlyPermanents(cx), 1, 1, 'Kill another friendly unit or gear')).length === 1)),
    text: 'When you play this, you may kill another friendly unit or gear to draw 1.',
  }),
  rule('extraTriggers', (ctx, qt: QueuedTrigger) => {
    if (qt.event.type !== 'die' || qt.controller !== ctx.controller || !qt.source) return false;
    const ab = abilityFromKey(ctx.g, qt.key);
    if (!ab || ab.kind !== 'triggered' || !ab.deathknell) return false;
    const here = myLoc(ctx);
    return typeof here === 'number' && (qt.event.lki as { loc?: unknown } | undefined)?.loc === here;
  }, 1, { text: 'Friendly Deathknell effects here trigger an additional time.' }),
]);
// Blossoming Dreamroot
def('rad-024-167', [when('combatResult', (ev, ctx) => ev.winner === ctx.controller && atMyBf(ev, ctx), E.draw(1), { text: 'When you win a combat here, draw 1.' })]);
// Hunting Blind
def('rad-044-167', [
  when('play', (ev, ctx) => ev.obj === ctx.self && ctx.enemyUnits(u => !ctx.isHere(u)).length > 0, ctx => {
    const t = ctx.target(0), here = myLoc(ctx);
    if (t && typeof here === 'number') ctx.move(t, here);
  }, { optional: 'Hunting Blind: move an enemy unit to this battlefield?', targets: [harmUnit('Move an enemy unit to this battlefield', F.enemy, F.not(F.here))], text: 'When you play this, you may move an enemy unit to this battlefield.' }),
  anthem(F.and(F.friendly, F.unit, F.here), { keywords: ['Shield 2'] }, { text: 'Friendly units here have [Shield 2].' }),
]);
// Gravity Field — applied cost on opponents' moves here; not paying undoes the move action (CR 204.4)
def('rad-062-167', [
  // engine moveCost rule: the move is legal only if affordable, and the cost is paid once per move (B2-2)
  { ...rule('moveCost', (ctx, p: PlayerId, _units: ObjId[], to: unknown) => typeof myLoc(ctx) === 'number' && to === myLoc(ctx) && ctx.isOpponent(p)),
    cost: () => cost('[1][A]'), text: 'Opponents must pay [1][A] to move one or more units to this battlefield.' },
  deathknell(E.draw(1), { text: 'Deathknell — Draw 1.' }),
]);
// Pillaged Armory
const buffFriendly = [helpUnit('Buff a friendly unit', F.friendly)];
def('rad-073-167', [
  onPlay(E.buff(0), { targets: buffFriendly, text: 'When you play this, buff a friendly unit.' }),
  when('conquer', (ev, ctx) => ev.player === ctx.controller && atMyBf(ev, ctx), E.buff(0), { targets: buffFriendly, text: 'When you conquer here, buff a friendly unit.' }),
]);
// Portable Portal
def('rad-087-167', [
  when('play', (ev, ctx) => ev.obj === ctx.self && ctx.units(u => ctx.isHere(u)).length > 0 && ctx.canPay(cost('[C]')), E.ready(0),
    { optional: 'Portable Portal: pay [C] to ready a unit here?', cost: cost('[C]'), targets: [helpUnit('Ready a unit here', F.here)], text: 'When you play this, you may pay [C] to ready a unit here.' }),
  anthem(F.and(F.friendly, F.unit, F.here), { keywords: ['Ganking'] }, { text: 'Friendly units here have [Ganking].' }),
]);
// The Good Stuff
def('rad-106-167', [
  onPlay(E.seq(E.discard(1), E.draw(3)), { text: 'When you play this, discard 1, then draw 3.' }),
  when('hold', (ev, ctx) => ev.player === ctx.controller && atMyBf(ev, ctx), E.returnToHand('self'), { text: 'When you hold here, return this to its owner\'s hand.' }),
]);
// Bushwhack Trap
def('rad-108-167', [
  rule('extraHide', (ctx, player: PlayerId, bf: number) => bf === myLoc(ctx) && ctx.bfController(bf) === player && !ctx.isOpponent(player), 1,
    { text: 'While you or an ally control this battlefield, that player may hide an additional card here.' }),
]);
// Dockside Lock-Up — "(Tokens aren't cards.)": a banished token ceased to exist and can't be played
def('rad-136-167', [
  onPlay(ctx => { const t = ctx.target(0); if (t) ctx.banish(t); }, { targets: [harmUnit('Banish a unit here', F.here)], text: 'When you play this, banish a unit here.' }),
  // RULINGS: CR 383.3.b — "kill this to …" is the hold trigger's base cost, paid as it goes on the chain (the linked cards are
  // remembered before it leaves, since the link is lost with it)
  when('hold', (ev, ctx) => ev.player === ctx.controller && atMyBf(ev, ctx) && ctx.banishedWithThis().length > 0, ctx => {
    const cards = (ctx.g.ex.turnFacts[`dockside:${ctx.self}`] as ObjId[] | undefined) ?? [];
    for (const id of cards) if (ctx.obj(id)?.zone === 'banishment') ctx.play(id, { ignoreCost: true });
  }, {
    optional: 'Dockside Lock-Up: kill it to play the banished card, ignoring its cost?',
    cost: cost('', pay.custom('Kill this', cx => cx.onBoard(cx.self), cx => { cx.g.ex.turnFacts[`dockside:${cx.self}`] = cx.banishedWithThis() as never; return cx.kill(cx.self).length === 1; })),
    text: 'When you hold here, kill this to play the banished card, ignoring its cost.',
  }),
]);
// The Ball ([Deploy], [Ganking] from data). R-1 (CR 403.2): the mode is chosen as the trigger goes on the chain.
def('rad-146-167', [
  // "When YOU play or move this": a move made by another player (Akshan, Mischievous moving it to his base) doesn't count (RJ#13033)
  when(['play', 'move'], (ev, ctx) => self(ev, ctx) && (ev.type !== 'move' || ctx.g.ex.turnFacts.__movedBeforeControl !== ctx.self), E.noop, {
    modes: [
      mode('draw', 'Draw 1', E.draw(1)),
      mode('deal', 'Deal 2 to enemy units here', ctx => ctx.deal(2, ctx.units(u => ctx.isEnemy(u) && ctx.isHere(u)))),
    ],
    text: 'When you play or move this, choose one — Draw 1; or deal 2 to enemy units here.',
  }),
]);

// =====================================================================================
// Equipment with scripted parts
// =====================================================================================
// Blade of the Exile: [Equip] — [A] or exhaust a friendly unit
def('rad-150-167', [], { costs: { Equip: cost('', anyPowerOrExhaustFriendly()) } });
// Blade of the Ruined King: [Equip] — [C], Kill a friendly unit
def('sfd-178-221', [], { costs: { Equip: cost('[C]', pay.killFriendly()) } });
// Last Rites: [Equip] — [C], Recycle 2 cards from your trash
def('sfd-150-221', [], { costs: { Equip: cost('[C]', pay.recycleFromTrash(2)) } });
// Hextech Gauntlets: [Equip] [3][A], Energy reduced by the chosen unit's Might
const gauntletsEnergy = pay.custom("[3], reduced by the chosen unit's Might", ctx => {
  const units = ctx.units(u => ctx.ctrl(u) === ctx.controller);
  if (!units.length) return false;
  const e = Math.min(...units.map(u => Math.max(0, 3 - ctx.might(u))));
  return ctx.canPay({ energy: e, power: ['A'] });
}, ctx => {
  // the Equip target; for Weaponmaster (no target) the unit being played is the one "chosen"
  let u = ctx.item?.targets?.[0]?.[0];
  if (!u) u = [...ctx.playedThisTurn()].reverse().find(x => ctx.onBoard(x) && ctx.isUnit(x));
  const e = u ? Math.max(0, 3 - ctx.might(u)) : 3;
  return e === 0 || ctx.pay({ energy: e, power: [] });
});
def('unl-188-219', [], { costs: { Equip: cost('[A]', gauntletsEnergy) } });
// Shurelya's Requiem
def('sfd-192-221', [onPlay(ctx => ctx.ready(ctx.units(u => ctx.ctrl(u) === ctx.controller)), { text: 'When you play this, ready your units.' })]);
// Edge of Night ([Hidden] from data): "attach it to a unit you control (here)" — here = where it was hidden
def('sfd-139-221', [
  // RULINGS sweep / CR 403.2, 355.5: the unit is a target chosen as the trigger goes on the chain
  when('play', (ev, ctx) => ev.obj === ctx.self && !!ev.fromHidden, ctx => {
    const u = ctx.target(0);
    if (u && ctx.onBoard(ctx.self) && ctx.onBoard(u)) ctx.attach(ctx.self, u);
  }, {
    targets: [T.unit((c, id) => c.ctrl(id) === c.controller && c.loc(id) === (c.event?.loc as Loc | undefined), { hint: 'help', prompt: 'Attach Edge of Night to a unit you control here' })],
    text: 'When you play this from face down, attach it to a unit you control here.',
  }),
]);
// Svellsongur: the equipped unit's own text is copied onto this Equipment's effect text, so it has it twice:
// its own triggered abilities trigger an additional time and its summing keywords (Assault N, Shield N, ...) double.
def('sfd-059-221', [
  { ...rule('extraTriggers', (ctx, qt: QueuedTrigger) => qt.source === ctx.self && qt.key.startsWith(ownAbilityKeyPrefix(ctx, ctx.self)), 1,
    { section: 'effect', text: "Copy of the equipped unit's text: its triggered abilities trigger an additional time" }), copyInstance: true },
  statik('self', ctx => {
    const o = ctx.obj(ctx.self);
    const d = o ? ctx.g.cards[o.cardId] : undefined;
    return { keywords: d ? intrinsicKeywords(d).filter(k => SUMMING.has(splitKeyword(k)[0])) : [] };
  }, { section: 'effect', text: "Copy of the equipped unit's text: keywords" }),
  // RJ#1325: the copied text includes its activated abilities — a second instance of each, with its own once-per-turn use
  statik('self', ctx => {
    const o = ctx.obj(ctx.self);
    const cid = o?.cardId;
    const abs = cid ? getScript(cid)?.abilities ?? [] : [];
    return { grantRefs: abs.flatMap((a, index) => (a.kind === 'activated' && !a.isAdd && (a.section ?? 'rules') === 'rules' ? [{ cardId: cid!, index }] : [])) };
  }, { section: 'effect', text: "Copy of the equipped unit's text: activated abilities" }),
  // B2-10 (ENGINE-2): the rest of the copied text — statics (applied again by the engine, `refs`), rule hooks, replacement
  // effects and cost modifications — a second instance of each
  { ...statik('self', ctx => {
    const o = ctx.obj(ctx.self);
    const cid = o?.cardId;
    const abs = cid ? getScript(cid)?.abilities ?? [] : [];
    return { grantRefs: abs.flatMap((a, index) => (['static', 'rule', 'replacement', 'costMod'].includes(a.kind) && (a.section ?? 'rules') === 'rules' ? [{ cardId: cid!, index }] : [])) };
  }, { section: 'effect', text: "Copy of the equipped unit's text: static abilities, rules and replacements" }), refs: true },
]);
// Shady Spectacles: as this is attached, the equipped unit becomes a copy of another friendly unit while attached
const spectaclesNote = (gear: ObjId) => `B2:spectacles:${gear}`;
def('ven-137-166', [
  { ...immediate(when('attach', (ev, ctx) => ev.obj === ctx.abilitySource, ctx => {
    const host = ctx.event!.host as ObjId, gear = ctx.event!.obj as ObjId;
    if (!ctx.onBoard(host) || ctx.obj(gear)?.attachedTo !== host) return;
    const of = ctx.choose(T.unit(F.friendly, (c, id) => id !== host, { prompt: `Shady Spectacles: ${ctx.name(host)} becomes a copy of another friendly unit`, hint: 'neutral' }))[0];
    if (!of) return;
    ctx.becomeCopy(host, of, 'permanent');
    const m = [...ctx.obj(host).modifiers].reverse().find(x => x.copyOf);
    if (m) { m.source = gear; m.note = spectaclesNote(gear); }
    // RJ#11747 (AMBIGUOUS, RJ adopted): each copy is a new instance of the copied abilities — once-per-turn uses of the host's
    // activated abilities start over
    const pre = `${host}#${ctx.obj(host).epoch ?? 0}#act:`;
    for (const k of Object.keys(ctx.g.ex.usage)) if (k.startsWith(pre)) delete ctx.g.ex.usage[k];
  }, { text: 'As this is attached to a unit, the unit becomes a copy of another friendly unit.' })), section: 'effect' as const },
  immediate(when('detach', self, ctx => {
    const host = ctx.event!.host as ObjId, o = ctx.obj(host);
    if (o) { o.modifiers = o.modifiers.filter(m => m.note !== spectaclesNote(ctx.self)); ctx.g.ex.dirty = true; }
  }, { text: 'When this is detached, the copy effect ends.' })),
]);

// =====================================================================================
// Equipment-matters units
// =====================================================================================
// Rell, Magnetic ([Tank] from data)
// CR 387-389: "If you do, then do this: Attach it to me" is a reflexive item (players may respond before the attach)
const rellAttach = reflexiveAbility('B2:rell:attach', {
  effect: ctx => {
    const x = ctx.data.gear as { id: ObjId; epoch: number } | undefined;
    const gear = x && ctx.onBoard(x.id) && (ctx.obj(x.id).epoch ?? 0) === x.epoch ? x.id : undefined;
    if (gear && ctx.onBoard(ctx.self) && ctx.ctrl(gear) === ctx.controller) ctx.attach(gear, ctx.self);
  },
  text: 'Rell: attach it to me',
});
def('sfd-024-221', [
  onAttack(ctx => {
    const cands = ctx.hand().filter(id => isEquipmentDef(ctx, id) && ctx.energyCost(id) <= 2);
    const pick = ctx.chooseCards(cands, 0, 1, 'Rell: you may play an Equipment with Energy cost [2] or less, ignoring its cost')[0];
    if (!pick) return;
    const ref = ctx.play(pick, { ignoreCost: true }) ? ctx.playedObj(pick) : null;   // CR 354.4: enters when this trigger finishes
    if (ref) ctx.reflexive(rellAttach, { gear: ref });
  }, { text: 'When I attack, you may play an Equipment with Energy cost no more than [2], ignoring its cost. If you do, attach it to me.' }),
]);
// Aphelios, Exalted
// R-1 (CR 403.2): the mode — and its runes / friendly unit (targets, CR 355.5 / rulings B6 rune readying) — is chosen as the
// trigger goes on the chain, among the modes not chosen this turn. "Ready 2 runes" has no "your": any exhausted runes (as RJ#239);
// approximation: offered as "up to 2" (always choosable, like the old resolution-time pick) instead of a forced 2.
def('sfd-049-221', [
  when('attach', (ev, ctx) => ev.host === ctx.self && ev.player === ctx.controller && isEquipmentDef(ctx, ev.obj as ObjId), E.noop, {
    modesOncePerTurn: true,
    modes: [
      mode('ready', 'Ready 2 runes', ctx => { ctx.ready(ctx.targetsOf(0)); }, [T.upTo(2, T.rune(F.exhausted, { hint: 'help', prompt: 'Ready 2 runes' }))]),
      mode('channel', 'Channel 1 rune exhausted', E.channel(1, true)),
      mode('buff', 'Buff a friendly unit', E.buff(0), [T.unit(F.friendly, { hint: 'help', prompt: 'Buff a friendly unit' })]),
    ],
    text: 'When you attach an Equipment to me, choose one that hasn\'t been chosen this turn.',
  }),
]);
// Gearhead ([Accelerate] from data)
// RJ#79: "gives double" is a state — a copied second instance (Svellsongur) doesn't double it again
def('sfd-068-221', [{ ...selfMight(ctx => equipmentOn(ctx, ctx.self).reduce((s, id) => s + baseMightBonus(ctx, id), 0), { text: 'Each Equipment attached to me gives double its base Might bonus.' }), idempotent: true }]);
// Ornn, Forge God ([Deflect 2], [Weaponmaster] from data)
def('sfd-085-221', [selfMight(ctx => friendlyGearCount(ctx), { text: 'I have +1 [S] for each friendly gear.' })]);
// Akshan, Mischievous ([Weaponmaster] from data)
const akshanReturn = delayedAbility('B2:sfd-109:return', immediate(when('leaveBoard', (ev, ctx) => ev.obj === ctx.data.akshan, ctx => {
  const gid = ctx.data.gear as ObjId, o = ctx.obj(gid);
  if (o && (o.epoch ?? 0) === ctx.data.gearEpoch && ctx.onBoard(gid)) ctx.takeControl(gid, ctx.data.from as PlayerId);
}, { text: 'Akshan left the board: control of the gear returns' })));
def('sfd-109-221', [
  when('play', (ev, ctx) => ev.obj === ctx.self && !!(ev.playData as Record<string, unknown> | undefined)?.paidAdditional, ctx => {
    const g = ctx.target(0);
    if (!g) return;
    // RJ#11346 (DECISIONS #11346, CR 393): with Akshan gone the move still happens — the gear comes off its unit — but "until I
    // leave the board" is already over (no control change, RJ#10576) and there is no Akshan to attach it to; the cleanup then
    // recalls the unattached gear to its controller's base
    if (!ctx.onBoard(ctx.self)) { if (ctx.obj(g).attachedTo) ctx.detach(g); if (ctx.loc(g) !== 'base') ctx.move(g, 'base'); return; }
    const from = ctx.ctrl(g);
    if (ctx.obj(g).attachedTo) ctx.detach(g);
    ctx.takeControl(g);
    // card text order (RJ#13033): the gear is moved to my base BEFORE I control it — its controller didn't move it and I didn't
    // move a gear I controlled, so "when you move this" (The Ball) triggers for neither. (Control is taken first only so the
    // engine's move puts it in my base; the marker tells such triggers the move happened under its previous controller.)
    if (ctx.loc(g) !== 'base') { ctx.g.ex.turnFacts.__movedBeforeControl = g; try { ctx.move(g, 'base'); } finally { delete ctx.g.ex.turnFacts.__movedBeforeControl; } }
    ctx.delay(akshanReturn, { akshan: ctx.self, gear: g, gearEpoch: ctx.obj(g).epoch ?? 0, from }, 'never', 1);
    if (isEquipmentDef(ctx, g)) ctx.attach(g, ctx.self);
  }, { targets: [T.gear(F.enemy, { hint: 'harm', prompt: 'Move an enemy gear to your base (you control it until Akshan leaves the board)' })], text: 'When you play me, if you paid the additional cost, take an enemy gear.' }),
], { additionalCosts: [{ cost: cost('[C][C]'), optional: true, label: 'Pay [C][C] as an additional cost (Akshan)' }] });
// Lucian, Merciless
def('sfd-113-221', [onConquer(E.ready('self'), { oncePerTurn: 1, text: 'The first time I conquer each turn, ready me.' })]);
// Yone, Blademaster
def('sfd-116-221', [
  bfControllerListener(),
  when('conquer', (ev, ctx) => ev.player === ctx.controller && ((ev.units as ObjId[] | undefined) ?? []).includes(ctx.self) && bfControllerBefore(ctx, ev) === null,
    ctx => { const t = ctx.target(0); if (t) ctx.deal(ctx.might(ctx.self), t); },
    { targets: [harmUnit('Deal damage equal to Yone\'s Might to an enemy unit in a base', F.enemy, F.atBase)], text: 'When I conquer a battlefield that was uncontrolled, deal damage equal to my Might to an enemy unit in a base.' }),
]);
// Jax, Unrelenting
def('sfd-119-221', [
  when('attach', (ev, ctx) => ev.host === ctx.self && ev.player === ctx.controller && isEquipmentDef(ctx, ev.obj as ObjId) && ctx.canPay(cost('[1]')), E.draw(1),
    { optional: 'Jax: pay [1] to draw 1?', cost: cost('[1]'), text: 'When you attach an Equipment to me, you may pay [1] to draw 1.' }),
]);
// Riven, Shattered
def('ven-041-166', [
  onAttack(ctx => { const t = ctx.target(0), n = equipmentOn(ctx, ctx.self).length; if (t && n) ctx.deal(2 * n, t); },
    { targets: [harmUnit('Choose an enemy unit here', F.enemy, F.here)], text: 'When I attack, choose an enemy unit here. Deal 2 to it for each Equipment attached to me.' }),
]);

// =====================================================================================
// Spells
// =====================================================================================
// Angle Shot — the Equipment must have the same controller as the unit chosen first
const unitChosenBy = (ctx: Ctx): ObjId | undefined => {
  const evs = ctx.g.ex.lastEvents;
  for (let i = evs.length - 1; i >= 0; i--) { const e = evs[i]; if (e.type === 'targeted' && e.source === ctx.self && ctx.obj(e.obj as ObjId) && ctx.isUnit(e.obj as ObjId)) return e.obj as ObjId; }
  return undefined;
};
def('sfd-011-221', [
  spell(ctx => {
    const u = ctx.target(0), eq = ctx.target(1);
    if (u && eq && ctx.ctrl(u) === ctx.ctrl(eq)) {
      const attached = ctx.obj(eq).attachedTo === u;
      const opts = attached ? [{ id: 'detach', label: `Detach ${ctx.name(eq)} from ${ctx.name(u)}` }] : [{ id: 'attach', label: `Attach ${ctx.name(eq)} to ${ctx.name(u)}` }];
      if (ctx.chooseMode(opts, 'Attach or detach') === 'detach') ctx.detach(eq); else ctx.attach(eq, u);
    }
    ctx.draw(1);
  }, {
    targets: [
      T.unit((c, id) => c.gear(g => c.isEquipment(g) && c.ctrl(g) === c.ctrl(id)).length > 0, { prompt: 'Choose a unit' }),
      T.gear(F.equipment, (c, id) => { const u = unitChosenBy(c); return u ? c.ctrl(u) === c.ctrl(id) : c.units(x => c.ctrl(x) === c.ctrl(id)).length > 0; }, { prompt: 'Choose an Equipment with the same controller' }),
    ],
  }),
]);
// Strike Down
def('sfd-107-221', [
  spell(ctx => {
    const u = ctx.target(0);
    if (!u) return;
    const e = ctx.target(1);
    if (e) ctx.deal(ctx.might(u), e, u);
    // RULINGS: CR 355.5 — the Equipment to detach is a specific object, chosen as the spell is played
    const d = ctx.target(2);
    if (d && ctx.obj(d)?.attachedTo === u) ctx.detach(d);
  }, { targets: [helpUnit('Choose an equipped friendly unit', F.friendly, F.equipped), harmUnit('It deals damage equal to its Might to an enemy unit', F.enemy),
    T.gear((c: Ctx, id: ObjId) => { const u0 = c.target(0) ?? c.item?.targets?.[0]?.[0]; const host = c.obj(id)?.attachedTo; return u0 ? equipmentOn(c, u0).includes(id) : !!host && isEquipmentDef(c, id) && c.ctrl(host) === c.controller; },
      { pick: true, prompt: 'Then detach which Equipment from it?' })] }),
]);
// Relentless Pursuit ([Action] from data)
const pursuitConquer = grantable('sfd-184-221:conquerHome', onConquer(E.move('self', 'base'), { optional: 'Move this unit to its base?', text: 'When I conquer, you may move me to my base.' }));
def('sfd-184-221', [
  spell(ctx => {
    const u = ctx.target(0);
    if (!u) return;
    E.moveToChosen(0, 2)(ctx);
    // RULINGS: CR 355.5 — "up to one Equipment" and (R-2, CR 355.4) the destination are chosen as the spell is played
    const e = ctx.target(1);
    if (e && ctx.onBoard(e) && ctx.isEquipment(e) && ctx.ctrl(e) === ctx.ctrl(u)) ctx.attach(e, u);
    if (ctx.onBoard(u)) ctx.grant(u, pursuitConquer, 'endOfTurn');
  }, { targets: [helpUnit('Move a friendly unit', F.friendly),
    T.upTo(1, T.gear((c: Ctx, id: ObjId) => { const u0 = c.target(0) ?? c.item?.targets?.[0]?.[0]; return !!u0 && c.isEquipment(id) && c.ctrl(id) === c.ctrl(u0) && c.obj(id).attachedTo !== u0; }, { hint: 'help', prompt: 'You may attach up to one Equipment to it' })),
    T.destination(F.moveDestFor(0), { prompt: 'Move it to' })] }),
]);
// Dragon Form ([Flow] [3] from data)
def('ven-116-166', [spell(ctx => { const t = ctx.target(0); if (t) ctx.setMight(t, 5, 'endOfTurn'); }, { targets: [T.unit({ prompt: 'Its base Might becomes 5 this turn' })] })]);

// =====================================================================================
// Legend / battlefield
// =====================================================================================
// Grandmaster at Arms
def('sfd-193-221', [
  activated('[1][T]', E.attach(0, 1), {
    targets: [T.gear(F.equipment, F.youControl, (c, id) => !c.obj(id).attachedTo, { prompt: 'Choose a detached Equipment you control' }), helpUnit('Attach it to a unit you control', F.youControl)],
    text: '[1], [T]: Attach a detached Equipment you control to a unit you control.',
  }),
  activated('[T]', E.attach(0, 1), {
    targets: [T.gear(F.equipment, F.youControl, (c, id) => !!c.obj(id).attachedTo, { prompt: 'Choose an attached Equipment you control' }), helpUnit('Attach it to a unit you control', F.youControl)],
    text: '[T]: Attach an attached Equipment you control to a unit you control.',
  }),
]);
// Veiled Temple — "you" is the conquering player
def('sfd-221-221', [
  // RJ#9387 (CR 383.3.a, 355.5): the leading "you may" and the gear are decided as the trigger goes on the chain (choosing none
  // declines it), so a Gold made by a simultaneous conquer trigger can't be chosen
  when('conquer', (ev, ctx) => ev.bf === ctx.bfIndex() && ev.player === ctx.controller, ctx => {
    const g = ctx.target(0);
    if (!g) return;
    ctx.ready(g);
    if (ctx.isEquipment(g) && ctx.obj(g).attachedTo && ctx.may(`Detach ${ctx.name(g)}?`)) ctx.detach(g);
  }, { targets: [T.upTo(1, T.gear(F.friendly, { hint: 'help', prompt: 'Veiled Temple: you may ready a friendly gear' }))], mayChoose: true,
    text: 'When you conquer here, you may ready a friendly gear. If it\'s an Equipment, you may detach it.' }),
]);

void statik;

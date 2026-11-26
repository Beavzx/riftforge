// Ability model used by card scripts (built with src/cards/dsl.ts) and interpreted by the engine.
// Effects are plain functions over an EffectCtx; they may ask players for choices (ctx.choose*),
// which suspends and replays deterministically (see ask.ts), so effects must be deterministic
// and must only use ctx / game state (no Math.random, no module state).
import type { CardId, CardType, Domain, GameEvent, ObjId, PlayerId } from './types.ts';
import type { Ctx } from './context.ts';

export type Effect = (ctx: Ctx) => void;

/** A power symbol: a Domain, 'A' (any domain), or 'C' (the card's own domain; = 'A' if domainless). */
export type PowerSym = Domain | 'A' | 'C';

export interface ExtraCost {
  label: string;
  /** a cost that only affects the source itself (kill/banish/recycle this): the auto-payer may use such Add abilities */
  self?: boolean;
  canPay: (ctx: Ctx) => boolean;
  /** Perform the cost (may ask choices). Return false if the player could not/would not pay. */
  pay: (ctx: Ctx) => boolean | void;
}

export interface CostSpec {
  energy?: number;
  power?: PowerSym[];
  exhaustSelf?: boolean;            // [T]
  extra?: ExtraCost[];              // non-resource costs ("Kill this", "Discard 1", "Spend my buff", ...)
}

export type TargetKind = 'unit' | 'gear' | 'permanent' | 'card' | 'battlefield' | 'chainItem' | 'rune' | 'legend' | 'destination' | 'any';
export type ZoneSel = 'board' | 'hand' | 'trash' | 'chain' | 'battlefields' | 'banishment' | 'mainDeck' | 'runes' | 'legends' | 'facedown';

export interface TargetSpec {
  kind: TargetKind;
  prompt?: string;
  zones?: ZoneSel[];                  // default ['board'] ('chain' for chainItem, 'battlefields' for battlefield)
  filter?: (ctx: Ctx, id: string) => boolean;
  min?: number;                       // default 1 (0 for "up to")
  max?: number;                       // default 1
  hint?: 'harm' | 'help' | 'neutral';
  /** all chosen objects must share one location ("units at a single battlefield") */
  sameLocation?: boolean;
  /** Not targeting (CR 355.10: "pick" choices): ignore Deflect / untargetability */
  pick?: boolean;
  /** For split damage ("deal 5 split among"): choose how the amount is divided at play time */
  splitAmount?: number | ((ctx: Ctx) => number);
  /** kind 'destination' (R-2): the moving object = target group index, or 'self' */
  of?: number | 'self';
  /** kind 'destination': extra restriction on the destination */
  allowed?: (ctx: Ctx, mover: ObjId, to: 'base' | number) => boolean;
  /**
   * CR 811.1.d.2-.4: this group's own text makes the Hidden "here" restriction impossible ("a unit at a different location",
   * Tideturner's "at another location"), so it may be chosen anywhere when played from facedown. Other groups stay restricted.
   */
  anyLocation?: boolean;
  /** B4-11 group constraints (data-only, validated by the engine) */
  maxTotalMight?: number;
  sameController?: boolean;
}

export interface Mode {
  id: string;
  label: string;
  targets?: TargetSpec[];
  effect: Effect;
  condition?: (ctx: Ctx) => boolean;
}

export type Dependency =
  | { kind: 'legion' }
  | { kind: 'level'; n: number }
  | { kind: 'empowered'; n?: number }
  | { kind: 'mighty' }
  | { kind: 'custom'; test: (ctx: Ctx) => boolean };

interface AbilityBase {
  /** Text shown in UI / logs for this ability */
  text?: string;
  /** Dependent-keyword gating (CR 726). Ability is inactive unless all hold. */
  requires?: Dependency[];
  /** For gear/equipment: 'effect' text is appended to the unit the gear is attached to (CR 136/434). */
  section?: 'rules' | 'effect';
  /** Zones in which the ability is active. Default: board (or legendZone/battlefield for those cards). */
  activeIn?: ('board' | 'hand' | 'trash' | 'legendZone' | 'championZone' | 'facedown' | 'mainDeck' | 'banishment' | 'chain' | 'any')[];
}

export interface SpellAbility extends AbilityBase {
  kind: 'spell';
  targets?: TargetSpec[];
  modes?: Mode[];
  /** number of modes to choose (default 1) */
  chooseModes?: number;
  /** B5-5 "Choose one you haven't already chosen" across Repeat executions */
  distinctModes?: boolean;
  effect?: Effect;
  /** extra legality check for playing the spell (e.g. "Play only if ...") */
  playIf?: (ctx: Ctx) => boolean;
}

export interface TriggerOn {
  /** event type(s), see engine/events.ts EVENT_TYPES */
  event: string | string[];
  /** extra condition, evaluated right after the event (CR 383.2.c) */
  match?: (ev: GameEvent, ctx: Ctx) => boolean;
}

export interface TriggeredAbility extends AbilityBase {
  kind: 'triggered';
  on: TriggerOn;
  /** "you may ..." at the start of the effect (decided on finalize, CR 383.3.a) */
  optional?: boolean | string;
  targets?: TargetSpec[];
  /** cost at the start of the effect, paid on finalize ("you may pay [1] to ...") */
  cost?: CostSpec;
  /**
   * The player who makes the finalize-time choices — leading `optional`, modes, targets — and pays `cost` (and Deflect), when the
   * text gives them to another player ("When a player plays a unit here, they may pay [1] to ..." — Valley of Idols, RJ#12403;
   * Star Spring, RJ#12439). The trigger itself stays the controller's. Default: the trigger's controller.
   */
  payer?: (ctx: Ctx) => PlayerId;
  effect: Effect;
  oncePerTurn?: number;
  /** Add-resource triggers resolve immediately (CR 429.2) */
  isAdd?: boolean;
  /** Deathknell-style: triggers when this permanent dies (handled specially before it leaves) */
  deathknell?: boolean;
  /** intervening "if": checked when the event happens and again on resolution (CR 383.2) */
  condition?: (ctx: Ctx) => boolean;
  /** R-1: bulleted modes, chosen when the trigger goes on the chain (CR 403.2) */
  modes?: Mode[];
  chooseModes?: number;
  /** "choose one that hasn't been chosen this turn" (per object, per turn) */
  modesOncePerTurn?: boolean;
  /** "When one or more ...": triggers at most once per batch of simultaneous events */
  oncePerBatch?: boolean;
  /** resolves immediately when its condition is met (like Add abilities, CR 430.2) */
  immediate?: boolean;
  /**
   * A leading "you may <choose/move/...> X" written as an up-to first target group: choosing nothing declines the trigger, which
   * is then removed (CR 383.3.a; RJ#6775). Default: true when the text starts with "you may" (after any "When ...,") and the
   * first group has min 0; set false to keep a no-choice trigger on the chain.
   */
  mayChoose?: boolean;
  /**
   * SF2-1: checked as the item is finalized, before any "you may" / targets / costs; false → it is removed (reflexive items whose
   * "do this" has become pointless or unpayable: Guards!'s Sand Soldier already ready, Death from Below's [A]).
   */
  offerIf?: (ctx: Ctx) => boolean;
}

export interface ActivatedAbility extends AbilityBase {
  kind: 'activated';
  cost: CostSpec;
  timing?: 'normal' | 'action' | 'reaction';
  targets?: TargetSpec[];
  modes?: Mode[];
  effect: Effect;
  isAdd?: boolean;
  /** "Use only once each turn" (per object) */
  oncePerTurn?: number;
  /** "choose one you've not chosen this turn" */
  modesOncePerTurn?: boolean;
  /** extra activation condition ("Use only if ...") */
  condition?: (ctx: Ctx) => boolean;
  /** battlefield abilities usable by any player ("Each player may use this ability once on their turn") */
  anyPlayer?: boolean;
  label?: string;
  /** what the produced resources may be spent on, for the auto-payer (Add abilities) */
  produces?: { energy?: number; power?: PowerSym[]; only?: string };
  /**
   * A variable Add that converts resources (Ancient Henge "[T]: Pay any amount of Energy to [Add] that much [A]"): the auto-payer may
   * use it while paying a cost — n Energy paid, n universal power added (payment.ts `withConverter`; RJ#7770, ENGINE-9).
   */
  convert?: 'energyToAny';
}

export interface StaticMods {
  might?: number;                  // arithmetic (+/-)
  setMight?: number;               // layer 1
  keywords?: string[];             // granted keywords, e.g. 'Tank', 'Assault 2'
  removeKeywords?: string[];
  tags?: string[];
  type?: CardType;
  cantBeChosenByEnemy?: boolean;
  grants?: string[];               // granted ability keys (registry.registerGrant)
  /** B4-15: grant abilities of other cards by reference (cardId + ability index, or all its abilities) */
  grantRefs?: { cardId: string; index?: number }[];
  /** B2-10: this object also has all abilities (and intrinsic keywords) of that object/card ("copy that unit's text") */
  copyAbilitiesOf?: string;
  /** B3-8: Might can't go below this ("-8 [M], to a minimum of 1 [M]") */
  mightFloor?: number;
}

export interface StaticAbility extends AbilityBase {
  kind: 'static';
  /** which objects it affects: 'self', or a predicate over object ids (only board objects are considered) */
  affects: 'self' | 'host' | ((ctx: Ctx, id: ObjId) => boolean);
  mods: StaticMods | ((ctx: Ctx, id: ObjId) => StaticMods);
  condition?: (ctx: Ctx) => boolean;
  /** B2-10: its mods may contain grantRefs naming *static* abilities; the engine then also applies those statics */
  refs?: boolean;
  /** a second instance on the same object changes nothing ("gives double ..." — RJ#79); copies of it are not applied again */
  idempotent?: boolean;
}

/** Replacement effect (CR 367). apply() returns the replacement event(s) or null to skip entirely. */
export interface ReplacementAbility extends AbilityBase {
  kind: 'replacement';
  event: string | string[];
  match: (ev: GameEvent, ctx: Ctx) => boolean;
  apply: (ev: GameEvent, ctx: Ctx) => GameEvent | null;
  optional?: boolean | string;
  oncePerTurn?: number;
  /**
   * Bonus Damage (CR 712-715): how much this 'damage' replacement adds when it matches. Lets the engine raise a split pool
   * before the split (CR 715.3, `bonusDamageFor`); damage events marked `noBonus` (already included) skip it.
   */
  bonus?: (ev: GameEvent, ctx: Ctx) => number;
  /** 'damage' replacement that, when it matches, leaves no damage at all ("I don't take damage"): such a unit is exempt from the
   *  lethal-first combat damage ordering (rules-spec 467.2.c.10; RJ#6949) — see replace.ts `takesNoDamage` */
  noDamage?: boolean;
}

/** Cost modification of playing cards (CR 356) */
export interface CostModAbility extends AbilityBase {
  kind: 'costMod';
  /** B8-6: "[1] or [A] less" — one of these deltas, the payer's choice */
  either?: { energy?: number; power?: number }[];
  /** B8-10: "you may pay ... less" — asked while playing (legality assumes yes) */
  optional?: string;
  /** which card being played is affected (id of the card being played) */
  applies: (ctx: Ctx, playedId: ObjId) => boolean;
  energy?: number;                 // negative = discount, positive = increase
  power?: number;                  // negative removes that many power symbols (any), positive adds [A]s
  /** 'self' = only while this card is being played (from hand etc.) */
  selfOnly?: boolean;
  /** what kind of cost it modifies (default 'play'): play costs, optional additional costs, Repeat/Empower/Equip costs, activated abilities, hiding */
  scope?: 'play' | 'additional' | 'repeat' | 'empower' | 'equip' | 'ability' | 'hide';
  /** minimum Energy after this discount ("to a minimum of [1]") */
  minEnergy?: number;
}

/** Permission to play a card from an unusual zone or in an unusual way. */
export interface PlayPermissionAbility extends AbilityBase {
  kind: 'playFrom';
  zone: 'trash' | 'hand' | 'banishment' | 'mainDeck';
  cost?: CostSpec;                 // replaces the base cost if given
  condition?: (ctx: Ctx) => boolean;
  then?: 'banish' | 'recycle' | null;  // what happens after it resolves / leaves
}

/** Movement permissions (Ganking-like or "Units can move here from anywhere.") */
export interface MovePermissionAbility extends AbilityBase {
  kind: 'movePermission';
  /** unit may move from origin to destination via standard move */
  allows: (ctx: Ctx, unit: ObjId, from: number | 'base', to: number | 'base') => boolean;
}

/** Play-destination / entry modifiers: e.g. "enters ready", "can be played to a battlefield with enemies" */
export interface PlayRuleAbility extends AbilityBase {
  kind: 'playRule';
  /** affects which cards being played */
  applies: (ctx: Ctx, playedId: ObjId) => boolean;
  entersReady?: boolean | ((ctx: Ctx, playedId: ObjId, dest: number | 'base') => boolean);
  extraDestinations?: (ctx: Ctx, playedId: ObjId) => (number | 'base')[];
  /** extraDestinations also apply to a card played from facedown ("even from face down", Last Caress); otherwise only a one-off
   *  rule for that object (data.obj) does (CR 811; RJ#5744) */
  hiddenToo?: boolean;
  grantsTiming?: 'action' | 'reaction';
  /** B8-9: also applies to other players' plays (default: only its controller's) */
  anyPlayer?: boolean;
  /** B4-2: may be played to this battlefield as if it had [Ambush] there (adds the destination and Reaction timing) */
  ambush?: (ctx: Ctx, playedId: ObjId, bf: number) => boolean;
  /** B3-3 / B8-16: keywords the card has while it is being played (e.g. "the next unit you play has [Accelerate]") */
  grantKeywords?: (ctx: Ctx, playedId: ObjId) => string[];
  /** costs for granted cost keywords (e.g. [Repeat] equal to its cost) */
  keywordCosts?: Partial<Record<'Repeat' | 'Flow' | 'Accelerate' | 'Equip' | 'Empower', CostSpec | ((ctx: Ctx, playedId: ObjId) => CostSpec)>>;
  /** N6 / B8-11 / B8-19: an additional cost the player may pay to play the card (optionally: only/also to a destination) */
  additionalCost?: { cost: CostSpec; label?: string; key?: string; destination?: (ctx: Ctx, playedId: ObjId) => number | 'base' | null; discount?: { energy?: number; power?: number } };
  /** B8-8 / B7-7: alternative costs for hiding a card ("You may pay [1] to hide ...") */
  hideCost?: (ctx: Ctx, cardId: ObjId) => CostSpec | null;
}

/**
 * Choices/actions made "as you play" this card (before costs are paid), e.g. Show Off.
 * Whatever the effect stores in ctx.data is kept on the chain item (item.choices.playData)
 * and passed as ctx.data to the spell effect, play triggers and entersReady checks.
 */
export interface AsPlayAbility extends AbilityBase {
  kind: 'asPlay';
  effect: Effect;
}

/**
 * Rule hooks consulted by the engine (see engine/rules.ts). applies(ctx, ...args) narrows when the
 * rule applies; value gives a number for numeric rules. Arguments per rule:
 *  cantReady(id)                    - spells/abilities/awaken can't ready this object
 *  noAwakenReady(id)                - object doesn't ready during the Awaken Phase
 *  cantMove(unit, from, to)         - movement prohibition ("can't move to base")
 *  cantPlay(cardId: ObjId, player, dest) - play prohibition (opponents can't play cards / units here)
 *  cantGainPoints(player)
 *  cantScore(player, bf)
 *  noCombatDamage(unit)             - unit contributes no Might to combat damage
 *  ignoreTank(assigningPlayer, bf)
 *  anyDamageLethal(dealingPlayer, unit)
 *  skipDraw(player)
 *  channelCount(player, n) value    - override number of runes channelled in the Channel Phase
 *  victoryScoreDelta value
 *  extraTriggers(trigger: {key, source, event}) value - additional times a trigger triggers
 *  suppressTrigger(trigger)         - the trigger doesn't trigger
 *  extraHide(player, bf) value      - additional facedown cards allowed at a battlefield
 *  ignoreDeflect(chooser, target)
 *  cantBeCountered(itemId)
 *  noTemporary(unit)                - Temporary doesn't kill this unit this time
 *  canPlayFromTrash(player, card)
 *  multipleBuffs(unit)              - the unit can have any number of buffs
 *  cantPlayToken(token, player, dest) - a played token can't be played there (Rockfall Path; cantPlay covers cards, RJ#10713)
 *  tieRecallAll(attacker, bf)       - a combat tie with units on both sides recalls ALL units there, not only the attackers
 *                                     (Symbol of the Solari; OGN-FAQ tie = neither OR both sides have units left, RJ#3123)
 * A rule printed on the card being checked (e.g. cantPlay on a card in hand) is consulted too.
 */
export type RuleName =
  | 'cantReady' | 'noAwakenReady' | 'cantMove' | 'cantPlay' | 'cantGainPoints' | 'cantScore' | 'noCombatDamage'
  | 'ignoreTank' | 'anyDamageLethal' | 'skipDraw' | 'channelCount' | 'victoryScoreDelta' | 'extraTriggers'
  | 'suppressTrigger' | 'extraHide' | 'ignoreDeflect' | 'cantBeCountered' | 'noTemporary' | 'canPlayFromTrash'
  | 'multipleBuffs' | 'seeFacedown' | 'moveCost' | 'cantPlayToken' | 'tieRecallAll';

export interface RuleAbility extends AbilityBase {
  kind: 'rule';
  rule: RuleName;
  applies?: (ctx: Ctx, ...args: any[]) => boolean;
  value?: number | ((ctx: Ctx, ...args: any[]) => number);
  /** moveCost(player, units, to): an applied cost for a standard move (B1-8 / B2-2) */
  cost?: (ctx: Ctx, ...args: any[]) => CostSpec | null;
  /**
   * extraTriggers: the value counts copies of the ability (Svellsongur's copied text), not "trigger an additional time": every
   * copy is triggered the additional times too — instances = (1 + copies) × (1 + additional), events.ts `extraTriggerCount`
   * (RJ#11631, ENGINE-9).
   */
  copyInstance?: boolean;
}

export type Ability =
  | RuleAbility | SpellAbility | TriggeredAbility | ActivatedAbility | StaticAbility | ReplacementAbility
  | CostModAbility | PlayPermissionAbility | MovePermissionAbility | PlayRuleAbility | AsPlayAbility;

export interface CardScript {
  id: CardId;
  /** exact effective text implemented (compared with data/cards.json by tools/coverage.ts) */
  text: string;
  /** intrinsic keywords; if omitted, parsed from the card text (see keywords.ts parseKeywords) */
  keywords?: string[];
  abilities: Ability[];
  /** "I can be Empowered up to N times" */
  maxEmpower?: number;
  /** keyword costs that can't be parsed from text (e.g. "[Repeat] — Discard 1"). Repeat may list several costs (each payable once, B5-5). */
  costs?: Partial<Record<'Equip' | 'Flow' | 'Empower' | 'Accelerate', CostSpec>> & { Repeat?: CostSpec | CostSpec[] };
  /** "This enters exhausted." (gear) */
  entersExhausted?: boolean;
  /** permanent enters ready (unconditionally or by condition evaluated with ctx.data = playData) */
  entersReady?: boolean | ((ctx: Ctx) => boolean);
  /**
   * Additional costs to play this card (CR 204.2). Optional ones are offered when affordable; when paid,
   * ctx.data[key ?? 'paidAdditional'] = true is visible to the spell effect and play triggers.
   */
  additionalCosts?: {
    cost: CostSpec; optional?: boolean; label?: string; key?: string;
    /** B1-2: "If you do, I cost [N] less" */
    discount?: { energy?: number; power?: number };
    /** B1-13: decided before targets (target legality depends on it) */
    beforeTargets?: boolean;
    /** B5-12: the chosen destination stays legal even if paying this cost removes the reason (e.g. kills the only friendly unit there) */
    keepsDestination?: boolean;
  }[];
}

export interface AbilityRef { obj: ObjId; index: number; ability: Ability; granted?: boolean; viaHost?: ObjId; key?: string }

export type Destination = number | 'base';
export type { PlayerId };

// Riftforge engine contract. Source of truth shared by engine, cards, UI and net agents.
// Extend freely (add fields / union members); avoid renaming or removing without telling the lead.

export type PlayerId = 0 | 1 | 2 | 3;
export type CardId = string;      // printed card id, e.g. "ogn-011-298" (alt arts map to base id)
export type ObjId = string;       // unique per physical object in a game, e.g. "o42"

export type Domain = 'Fury' | 'Calm' | 'Mind' | 'Body' | 'Chaos' | 'Order' | 'Colorless';
export type CardType = 'Unit' | 'Spell' | 'Gear' | 'Rune' | 'Battlefield' | 'Legend' | 'Token';

export type ZoneKind =
  | 'mainDeck' | 'runeDeck' | 'hand' | 'base' | 'battlefield' | 'trash'
  | 'banishment' | 'legendZone' | 'championZone' | 'runePool' | 'chain' | 'facedown'
  | 'setAside';                  // engine: unused battlefields, cards set aside during mulligan/effects

export interface CardDef {
  id: CardId;
  name: string;
  subtitle?: string;
  type: CardType;
  supertypes: string[];          // Champion, Signature, Token, ...
  tags: string[];                // Demacia, Yordle, Jinx, ...
  domains: Domain[];
  energy: number | null;
  power: number | null;          // domain power cost
  might: number | null;
  keywords: string[];            // parsed keywords incl. values, e.g. "Assault 2"
  text: string;                  // effective (post-errata) rules text
  set: string;
  rarity: string;
  imageKey?: string;
  /** data/cards.json: keyword costs as text, e.g. { Equip: '[C]' } */
  keywordCosts?: Record<string, string>;
  reminderText?: string;
  /** data/cards.json: further printed card types beyond `type`, e.g. Patched Porobot is a Unit and a Gear ("UNIT GEAR"). */
  additionalTypes?: CardType[];
  /** data/cards.json, Equipment only: the printed bottom band = what the equipped unit has while this is attached
   *  ("I/me" there means the equipped unit). attachedReminderText keeps the reminder parentheticals. */
  attachedText?: string;
  attachedReminderText?: string;
}

export interface GameObject {
  id: ObjId;
  cardId: CardId;
  owner: PlayerId;
  controller: PlayerId;
  zone: ZoneKind;
  battlefieldIndex?: number;     // when zone === 'battlefield' or 'facedown'
  exhausted: boolean;
  faceDown: boolean;
  damage: number;
  counters: Record<string, number>;      // buff, xp, etc.
  attachedTo?: ObjId;                     // gear equipped to unit
  modifiers: Modifier[];                  // continuous effects applied directly to this object
  enteredThisTurn: boolean;
  timestamp: number;                      // for layer ordering
  // ---- engine additions (all optional for back-compat) ----
  epoch?: number;                 // bumps every time the object becomes a "new object" (CR 124); stale refs are detected with it
  stunned?: boolean;              // CR 423
  empowered?: number;             // CR 441: 0/undefined = not Empowered; >1 only for "can be Empowered N times" cards
  combatRole?: 'attacker' | 'defender';   // CR 464.2.c
  hiddenTurn?: number;            // g.turn when the card was hidden (CR 811: playable from a later turn)
  isToken?: boolean;              // CR 179
  playedFromHidden?: boolean;     // last time it was played, it came from facedown
  movedThisTurn?: boolean;
  movesThisTurn?: number;          // B4-10
  // ---- UI addition (optional; filled by getView for visible board objects) ----
  /** Current characteristics after continuous effects (layers), so clients don't re-derive them. */
  derived?: {
    might: number | null; keywords: string[]; tags?: string[]; type?: CardType; name?: string; controller?: PlayerId;
    /** each contribution to `might` (base first): source object (null = rules/base), label, amount, duration */
    mightSources?: { source: ObjId | null; label: string; amount: number; duration: string }[];
  };
}

export interface Modifier {
  source: ObjId | null;
  layer: number;                 // see docs/rules-spec.md layer system
  duration: 'permanent' | 'endOfTurn' | 'endOfCombat' | 'whileSource' | 'nextTurn';
  might?: number;
  addKeywords?: string[];
  removeKeywords?: string[];
  timestamp: number;
  note?: string;
  // ---- engine additions ----
  id?: string;
  setMight?: number;             // layer 1 (CR 477.1.a.1)
  addTags?: string[];            // layer 1
  becomeType?: CardType;         // layer 1 (e.g. gear becomes a unit gear)
  controller?: PlayerId;         // layer 1 control change
  copyOf?: CardId;               // copy layer
  addKeywordCosts?: Record<string, { energy?: number; power?: string[] }>;   // B7-5: costs for granted cost keywords (Flow, Repeat)
  grants?: string[];             // layer 2: granted ability keys (see src/cards/registry.ts grantable abilities)
  cantBeChosenByEnemy?: boolean; // CR 756 untargetability
  data?: Record<string, unknown>;
}

export interface BattlefieldState {
  objId: ObjId;                  // the battlefield card object
  controller: PlayerId | null;
  contested: boolean;
  scoredThisTurnBy: PlayerId[];  // who has scored here this turn (conquer/hold)
  contestedBy?: PlayerId | null; // player whose unit applied Contested (CR 190.2)
  owner?: PlayerId;              // player who brought this battlefield
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  points: number;
  legend: ObjId;
  championZone: ObjId[];
  hand: ObjId[];
  mainDeck: ObjId[];             // top = index 0
  runeDeck: ObjId[];
  trash: ObjId[];
  banishment: ObjId[];
  base: ObjId[];
  runesInPlay: ObjId[];
  pool: { energy: number; power: Partial<Record<Domain, number>> };
  mulliganDone: boolean;
  conceded: boolean;
  // ---- engine additions ----
  xp: number;                    // CR 728
  /** Restricted resources in the pool (e.g. "Spend this Energy only to play spells"). */
  poolRestricted: RestrictedResource[];
  turnsTaken: number;
}

export interface RestrictedResource {
  kind: 'energy' | 'power';
  domain?: Domain | 'any';
  amount: number;
  /** what it may be spent on: 'spell' | 'unit' | 'gear' | 'unitOrGear' | 'ability' */
  only: string;
  source?: ObjId;
}

export type Phase = 'setup' | 'mulligan' | 'awaken' | 'beginning' | 'channel' | 'draw' | 'action' | 'end' | 'gameOver';

export interface ChainItem {
  id: string;
  kind: 'spell' | 'ability' | 'trigger';
  source: ObjId;
  controller: PlayerId;
  abilityIndex?: number;
  targets: ObjId[][];
  choices: Record<string, unknown>;
  pending: boolean;              // CR "pending" vs "finalized"
  // ---- engine additions ----
  abilityKey?: string;           // which ability (see engine/abilities.ts abilityKey())
  label?: string;                // human readable, for UI
  targetEpochs?: number[][];     // epochs of targets at choice time (stale = illegal)
  mode?: string;
  x?: number;
  repeat?: number;               // extra executions paid via [Repeat]
  event?: GameEvent;             // the event that triggered a triggered ability
  fromHidden?: boolean;
  viaFlow?: boolean;
  isAdd?: boolean;
  /** zone the card was played from (B1-1) */
  from?: ZoneKind;
  /** B7-4: where the card goes when it leaves the chain ("then banish it" / "then recycle it") */
  leaveTo?: 'banish' | 'recycle' | 'hand';
  /** SF-2: the object the ability is printed on when it differs from `source` (Equipment effect text acting for its host) */
  abilitySource?: ObjId;
}

export interface ShowdownState {
  battlefieldIndex: number;
  focus: PlayerId;
  passes: PlayerId[];
  isCombat: boolean;
  attacker?: PlayerId;
  defender?: PlayerId;
  /** 'open' = players act with focus; 'closing' = steps after the showdown (combat damage / resolution) */
  stage?: 'open' | 'closing';
}

export interface LogEntry { turn: number; player: PlayerId | null; text: string; ref?: ObjId[] }

export interface GameState {
  version: 1;
  seed: number;
  rng: number;                   // current RNG state
  nextObj: number;
  timestamp: number;
  cards: Record<CardId, CardDef>; // only cards used in this game
  objects: Record<ObjId, GameObject>;
  players: PlayerState[];
  battlefields: BattlefieldState[];
  turn: number;
  activePlayer: PlayerId;
  firstPlayer: PlayerId;
  phase: Phase;
  priority: PlayerId | null;
  chain: ChainItem[];
  showdown: ShowdownState | null;
  pending: Decision | null;
  triggerQueue: unknown[];
  winner: PlayerId | null;
  log: LogEntry[];
  actionCount: number;
  mode: '1v1' | 'ffa' | '2v2';
  victoryScore: number;
  ex: EngineExtra;               // engine-internal bookkeeping (typed). Treat as opaque in UI.
  [extra: string]: unknown;      // engine-internal bookkeeping allowed
}

/** Serializable engine task (FEPR "outstanding tasks", turn steps, combat steps). */
export interface Task { t: string; [k: string]: unknown }

export interface DelayedAbility {
  id: string;
  controller: PlayerId;
  source: ObjId | null;
  /** registry key of the delayed effect (see src/cards/registry.ts registerDelayed) */
  key: string;
  data: Record<string, unknown>;
  expires: 'endOfTurn' | 'endOfCombat' | 'never' | 'nextTurnEnd' | 'whileSource';
  turn: number;
  /** remaining uses; removed when it reaches 0 ("the next unit you play ...") */
  uses?: number;
  timestamp?: number;
  sourceEpoch?: number;
}

export interface EngineExtra {
  /** Replay unit: last quiescent state + actions since (see engine/ask.ts). Never sent to clients. */
  unit: { base: GameState; actions: Action[] } | null;
  tasks: Task[];
  passes: PlayerId[];                     // consecutive passes while the chain is non-empty
  chainOpener: { player: PlayerId; byTrigger: boolean } | null;
  delayed: DelayedAbility[];
  playedThisTurn: ObjId[][];              // per player: objects whose play finalized this turn (Legion)
  usage: Record<string, number>;          // once-per-turn counters, cleared each turn
  setAsideBattlefields: ObjId[][];        // per player: battlefield candidates not in use
  manualPay: boolean[];                   // per player: ask a 'payment' decision instead of auto-paying
  extraTurns: PlayerId[];                 // CR 734 additional turns queue
  staged: { bf: number; kind: 'showdown' | 'combat' }[];
  dirty: boolean;                         // a cleanup is required
  lastEvents: GameEvent[];                // events produced by the last applyAction
  stepGuard: number;
  combat: { bf: number; attackers: ObjId[]; defenders: ObjId[]; recalled: boolean } | null;
  revealed: ObjId[];                      // temporarily revealed (public) objects
  bfChoice: 'random' | 'choose';
  firstChooser?: PlayerId;
  /** who last dealt damage to a unit (kill attribution, CR 428.4) */
  /** last damage source per unit; `by` = damage dealt to it this turn per dealing player (Elder Dragon: any of your damage) */
  damageSrc: Record<ObjId, { player: PlayerId; obj?: ObjId; combat?: boolean; by?: Partial<Record<PlayerId, number>>; stale?: boolean }>;   // stale: a cleanup has run since (CR 429.5.c)
  /** units' "conquered/held this turn" bookkeeping and other per-turn facts */
  turnFacts: Record<string, unknown>;
  /** cards discarded/killed etc. this turn per player for "if you've ... this turn" conditions */
  counts: Record<string, number>;
  /** number of attached objects (fast path for layer computation) */
  attachCount: number;
  /** linked banishment: banished object -> object that banished it (+ its epoch) (CR 427.4) */
  links: Record<ObjId, { by: ObjId; epoch: number }>;
  /** temporary permissions to play specific cards ("until your next Ending Phase, you may play that card") */
  playPermissions: { obj: ObjId; epoch: number; player: PlayerId; until: 'endOfTurn' | 'nextEnding' | 'never'; turn: number; ignoreCost?: boolean; ignoreEnergy?: boolean }[];
  /** set when any static ability changes card types (disables the isUnit fast path) */
  typeStatics?: boolean;
  /** per-object memory (ctx.memo), keyed "<obj>#<epoch>:<key>" */
  memo: Record<string, unknown>;
  /** extra legend candidates (Neeko) per player */
  extraLegends: ObjId[][];
  /** UI-CANCEL (engine/cancel.ts): set on a suspended state when this player may cancel the play in progress */
  cancelFor?: PlayerId;
  /** HIDDEN-IDS (engine/hidden-ids.ts): per-game secret for view aliases of hidden objects. Host-only, never in a view. */
  viewKey?: string;
  /** HIDDEN-IDS: per viewer, per hidden zone instance: [alias counter, members at the last checkpoint]. Never in a view. */
  hid?: Record<string, Record<string, [number, string]>>;
}

// ---- Decisions (what the game is waiting on) ----
export type DecisionKind =
  | 'mulligan' | 'mainAction' | 'showdownAction' | 'chainResponse'
  | 'chooseTargets' | 'chooseMode' | 'chooseX' | 'optional' | 'payment'
  | 'orderTriggers' | 'assignDamage' | 'chooseBattlefield' | 'chooseCards'
  | 'chooseUnitsToMove' | 'chooseDestination' | 'chooseNumber' | 'confirm'
  | 'chooseOrder' | 'chooseShowdown' | 'chooseOpponent';

export interface Decision {
  kind: DecisionKind;
  player: PlayerId;
  prompt: string;                // human text, e.g. "Choose a unit to deal 3 damage to"
  source?: ObjId;
  options?: DecisionOption[];    // enumerable choices
  min?: number;                  // for multi-select
  max?: number;
  data?: Record<string, unknown>;
  /** true when the decision is part of a replay unit (answer with {type:'choose'}); false for main/chain/showdown action decisions */
  inStep?: boolean;
  /** advisory for bots/UI: is picking an option good or bad for the targeted object's controller */
  hint?: 'harm' | 'help' | 'neutral';
}

export interface DecisionOption { id: string; label: string; objIds?: ObjId[]; data?: unknown }

// ---- Actions (what players send) ----
export type Action =
  | { type: 'choose'; player: PlayerId; optionIds: string[]; data?: unknown }
  | { type: 'playCard'; player: PlayerId; obj: ObjId; payment?: PaymentPlan; mode?: string; x?: number; hidden?: boolean; destination?: number | 'base' }
  | { type: 'activate'; player: PlayerId; obj: ObjId; abilityIndex: number; payment?: PaymentPlan }
  | { type: 'move'; player: PlayerId; units: ObjId[]; to: number | 'base' }
  | { type: 'hide'; player: PlayerId; obj: ObjId; battlefieldIndex: number; payment?: PaymentPlan }
  | { type: 'pass'; player: PlayerId }
  | { type: 'endTurn'; player: PlayerId }
  | { type: 'assignDamage'; player: PlayerId; assignment: Record<ObjId, number> }
  | { type: 'concede'; player: PlayerId }
  /** UI-CANCEL: back out of your own play/activation/hide while still making its choices (before it finalizes).
   *  Restores the state from before the playCard/activate/hide action. Only listed when EngineExtra.cancelFor allows it. */
  | { type: 'cancel'; player: PlayerId };

export interface PaymentPlan { exhaust: ObjId[]; recycle: ObjId[]; other?: Record<string, unknown> }

export interface GameEvent { type: string; [k: string]: unknown }

export interface DeckList {
  legend: CardId;
  champion: CardId;
  main: CardId[];                // 40+ cards
  runes: CardId[];               // 12
  battlefields: CardId[];        // 3
  sideboard?: CardId[];
  /** Neeko, Blending In: up to 3 additional legends (set aside; scripts move one to the Legend Zone) */
  extraLegends?: CardId[];
}

export interface GameSetup {
  seed: number;
  players: { name: string; deck: DeckList }[];
  mode?: '1v1' | 'ffa' | '2v2';
  cardDb: Record<CardId, CardDef>;
  // ---- engine additions ----
  firstPlayer?: PlayerId;        // force the first player (tests); otherwise coin flip + go-first/second decision
  previousLoser?: PlayerId;      // Bo3 games 2/3: this player chooses to go first or second
  battlefieldSelection?: 'random' | 'choose';   // default 'choose' (hidden simultaneous choice); 'random' = CR 487 duel
  battlefieldChoice?: 'random' | 'choose';      // deprecated alias of battlefieldSelection
  enforceBanlist?: boolean;      // default false (casual)
  manualPay?: boolean[];         // per player: ask a 'payment' Decision (auto-pay suggested) instead of auto-paying
  banlist?: string[];            // card names (or ids) banned; see data/banlist.json
  skipShuffle?: boolean;         // tests: keep deck order as listed (top = index 0)
  skipMulligan?: boolean;        // tests
  victoryScore?: number;
  validateDecks?: boolean;       // default true; throws on illegal decks
  includeAllCards?: boolean;     // copy the whole cardDb into state.cards (tests / sandbox)
  /** HIDDEN-IDS: secret keying the opaque ids getView gives hidden objects (online hosts pass a random one; default: seed-derived). */
  viewSecret?: string;
}

export interface PlayerView {
  you: PlayerId;
  /** redacted copy: objects hidden from `you` appear under opaque per-view ids (HIDDEN-IDS) as { cardId: 'hidden' } */
  state: GameState;
  pending: Decision | null;      // only if it's this player's decision, else a summary
  legal: Action[];
  /** BASICS BX-4: the current play cost of each card in the viewer's hand and champion zone, after cost modifications
   *  (discounts, increases; no optional / destination-dependent costs). `power` lists each symbol: a domain list or 'any'. */
  costs?: Record<ObjId, { energy: number; power: (Domain[] | 'any')[] }>;
}

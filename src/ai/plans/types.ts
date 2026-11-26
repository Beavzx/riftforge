// AI-CORE: the deck-plan interface. PILOT agents implement one `DeckPlan` per legend in src/ai/plans/<key>.ts
// (key = lowercase letters of the legend's champion tag: azir, vex, evelynn, reksai, kaisa, irelia, kennen, ezreal,
// sett). The core search (src/ai/core) consults the plan of the deciding player's legend at every decision.
// Full documentation with examples: docs/ai-plans.md. Owner: AI-CORE — request changes in docs/ai-requests.md.
//
// Scales: every number a plan returns is in EVALUATION UNITS, where 10 = one point of score lead (eval `point`
// weight), ~1.3 = one Might on the board, ~1.2 = one card in hand, ~1.4 = one rune in play. Keep bonuses modest
// (|x| <= 10 for "strongly prefer", 1-3 for "nudge"); the search still checks consequences.
import type { Action, Decision, GameState, ObjId, PlayerId, ZoneKind, CardType } from '../../engine/types.ts';
import type { EvalWeights } from '../eval.ts';

/** A read-only, already-derived view of one object (current characteristics after layers). */
export interface CardInfo {
  obj: ObjId;
  cardId: string;
  name: string;            // printed name, e.g. "Sand Soldier", "Guards!", "Azir" (champion units: the champion name)
  subtitle?: string;
  type: CardType | '?';
  tags: string[];          // e.g. ['Equipment'], ['Azir'], ...
  keywords: string[];      // current keywords with values, e.g. ['Assault 2', 'Hidden']
  energy: number;
  power: number;
  might: number;           // current Might (0 if none)
  zone: ZoneKind;
  battlefield?: number;    // battlefield index when zone is 'battlefield' / 'facedown'
  controller: PlayerId;
  owner: PlayerId;
  exhausted: boolean;
  stunned: boolean;
  isToken: boolean;
  attachedTo?: ObjId;      // Equipment: the unit it is attached to
  attachments: ObjId[];    // units: Equipment attached to it
  champion: boolean;       // supertype Champion
  text: string;
}

/** Everything a plan hook gets. All helpers read only public information + the decider's own hand. */
export interface PlanCtx {
  g: GameState;
  me: PlayerId;
  opp: PlayerId;
  /** it is my turn (main phase / my combats) */
  myTurn: boolean;
  /** g.turn; my own turn count is g.players[me].turnsTaken */
  turn: number;
  /** victory score (8 in 1v1) */
  victory: number;
  myPoints: number;
  oppPoints: number;
  /** cards in my hand (I can see them) */
  hand: CardInfo[];
  /** my permanents: base + battlefields (units, gear incl. attached Equipment), and my facedown cards */
  board: CardInfo[];
  /** opponent's visible permanents (facedown cards are listed with name 'facedown') */
  oppBoard: CardInfo[];
  /** my legend */
  legend: CardInfo;
  /** runes I have in play / ready (unexhausted) */
  runes: number;
  readyRunes: number;
  /** energy + power currently in my pool (floating) */
  poolEnergy: number;
  /** cards left in my main deck / rune deck */
  deckSize: number;
  runeDeckSize: number;
  /** names of the cards I played this turn (finalized plays, in order) */
  playedThisTurn: string[];
  /** helpers */
  info(obj: ObjId): CardInfo | null;
  /** count of my cards with this name in a zone set (default: board) */
  count(name: string | ((c: CardInfo) => boolean), where?: 'hand' | 'board' | 'oppBoard'): number;
  /** units (mine or opponent's) at a battlefield; 'base' = my base */
  unitsAt(loc: number | 'base', who: 'me' | 'opp'): CardInfo[];
  /** total Might (+Shield for defence) at a battlefield */
  mightAt(loc: number, who: 'me' | 'opp'): number;
  /** battlefield controller (null = uncontrolled) */
  controllerOf(bf: number): PlayerId | null;
  /** names of battlefields in play, by index */
  battlefields: string[];
  /** objects I already chose in the current play / ability (earlier prompts of the same card, e.g. "(1 of 2)") */
  chosenThisPlay: ObjId[];
}

// ------------------------------------------------------------------------------------------------ mulligan

/**
 * Score every card of the opening hand: > 0 keep, < 0 send back (most negative first, up to the allowed number).
 * Return undefined for a card to use the core default for it.
 */
export type MulliganFn = (hand: CardInfo[], ctx: PlanCtx) => Record<ObjId, number | undefined>;

// ------------------------------------------------------------------------------------------------ priors

/**
 * Move prior: a bonus/penalty for a candidate action at a decision. Used to ORDER and PRUNE candidates (the core
 * only searches the top-K by prior) and added (x `priorWeight`, default 0.25) to the searched score as a tie-breaker
 * / soft preference. `card` is the acting card (played card, activated object, hidden card, first moved unit, or for
 * a 'choose' action the first chosen object) or null.
 */
export type PriorFn = (a: Action, card: CardInfo | null, d: Decision, ctx: PlanCtx) => number | undefined;

// ------------------------------------------------------------------------------------------------ combos

/** Matches one engine action (main-phase or response window) for a combo step. */
export interface StepMatch {
  /** action type to look for */
  do: 'play' | 'activate' | 'move' | 'hide' | 'pass' | 'endTurn';
  /** acting card: name ("Guards!"), several names, or a predicate. For 'activate', 'legend' = my legend. */
  card?: string | string[] | 'legend' | ((c: CardInfo, ctx: PlanCtx) => boolean);
  /** play: 'base' | 'battlefield' (any) | a battlefield index; move: destination ('battlefield' = core picks the best) */
  to?: 'base' | 'battlefield' | number;
  /** activate: ability index on the object (default: any non-mana ability) */
  ability?: number;
  /** move: which of my units to send ('ready' = all ready units that can move there; predicate to filter) */
  units?: 'ready' | 'all' | ((c: CardInfo, ctx: PlanCtx) => boolean);
  /** skip this step (instead of aborting the combo) when nothing matches */
  optional?: boolean;
  /** among several matching legal actions, prefer the highest-scoring (default: core prior) */
  score?: (a: Action, c: CardInfo | null, ctx: PlanCtx) => number;
}

/** How to answer in-step decisions (targets, cards, "may") that come up while a combo step resolves. */
export interface ChoiceRule {
  /** regex (string or RegExp) on the decision prompt; or a predicate */
  prompt?: string | RegExp;
  /** decision kind filter */
  kind?: Decision['kind'];
  /** score each option object; the core picks the best legal combination (respecting min/max) */
  pick?: (opt: CardInfo | null, optionId: string, d: Decision, ctx: PlanCtx) => number;
  /** choose nothing / decline (for optional choices) */
  none?: boolean;
}

/**
 * A combo line: an ordered sequence of actions the turn search tries as ONE macro move. Each step is matched against
 * the legal actions of the then-current state; in-step decisions are answered by `choices` (then by the plan's
 * `target` hook, then by the core). A non-optional step that matches nothing aborts the line (the macro is dropped).
 * The macro is scored like any other move sequence, so a combo is only played if it evaluates well.
 */
export interface ComboLine {
  name: string;
  /** only try the line when this holds (cheap check on the current quiet main-phase state) */
  when?: (ctx: PlanCtx) => boolean;
  steps: StepMatch[];
  choices?: ChoiceRule[];
  /** bonus added to the line's evaluated score (eval units); use sparingly */
  bonus?: number;
}

// ------------------------------------------------------------------------------------------------ resources

export interface ResourcePolicy {
  /**
   * Eval value of one rune in play for this deck (default ~1.4 from the core weights, plus the core's rune-economy
   * term). Decks that pay [C] a lot should not set this too high, or they never equip.
   */
  runeValue?: number;
  /**
   * Extra cost in eval units for each rune recycled THIS TURN to pay power ([C], [A], domain power), by the card it
   * paid for. Return 0 when the spend is part of the plan (e.g. Equip on the key unit), > 0 to discourage.
   */
  recycleCost?: (forCard: CardInfo | null, ctx: PlanCtx) => number;
  /**
   * Energy to keep open at the end of my turn (for Reaction/Action cards in hand), and its value. The core adds
   * `value` (eval units) to an end-of-turn state that leaves at least `energy` ready runes while a card matching
   * `forCards` is in hand (or hidden).
   */
  reserve?: (ctx: PlanCtx) => { energy: number; value: number; forCards?: string[] } | undefined;
}

// ------------------------------------------------------------------------------------------------ hide

export interface HidePolicy {
  /** value (eval units) of having this card facedown at battlefield `bf` right now; > 0 makes hiding attractive */
  hideValue?: (card: CardInfo, bf: number, ctx: PlanCtx) => number;
  /** cards never to hide (names) */
  never?: string[];
  /**
   * Might my facedown card adds to the defence of its battlefield in the evaluation's threat projection (e.g. Guards!
   * = a 2-Might Sand Soldier + Weaponmaster). Default: 2 for a facedown Unit card, 1.5 for anything else.
   */
  defense?: (card: CardInfo, bf: number, ctx: PlanCtx) => number | undefined;
}

// ------------------------------------------------------------------------------------------------ evaluation

export interface EvalAdjust {
  /** override core feature weights for this deck (see src/ai/eval.ts EvalWeights) */
  weights?: Partial<EvalWeights>;
  /**
   * Extra value of one of MY objects by card (added per object, in its zone): e.g. Equipment attached to Azir,
   * Sand Soldiers, a key engine piece in hand. Called for my hand, board and facedown objects.
   */
  cardValue?: (c: CardInfo, ctx: PlanCtx) => number | undefined;
  /** free-form extra feature for the whole position (my point of view), evaluated at leaf states */
  bonus?: (ctx: PlanCtx) => number;
}

// ------------------------------------------------------------------------------------------------ the plan

export interface DeckPlan {
  /** plan key = file name, e.g. 'azir' */
  id: string;
  /** champion tag(s) of the legend(s) this plan pilots, e.g. ['Azir']; or legend card ids */
  legends: string[];
  /** agent name + date, for the changelog */
  author?: string;
  mulligan?: MulliganFn;
  /** move priors (main phase, response windows, in-step choices) */
  prior?: PriorFn;
  /** weight of `prior` added to searched scores (default 0.25; 0 = prior only orders/prunes candidates) */
  priorWeight?: number;
  combos?: ComboLine[];
  resources?: ResourcePolicy;
  hide?: HidePolicy;
  eval?: EvalAdjust;
  /**
   * Targeting preference for in-step choices (whom to hit / buff / move / attach to). Score per option; the core
   * combines it with its own harm/help prior and the search. `d.prompt` tells you which card asks.
   */
  target?: (opt: CardInfo | null, optionId: string, d: Decision, ctx: PlanCtx) => number | undefined;
  /**
   * Reaction windows (chainResponse / showdownAction, also on the opponent's turn): bonus for responding with this
   * action vs passing. Return a positive number to make the core search the response, negative to never consider it.
   */
  respond?: (a: Action, card: CardInfo | null, d: Decision, ctx: PlanCtx) => number | undefined;
}

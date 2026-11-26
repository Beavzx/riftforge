// Batch B7 card scripts (card flow & zones). Owned by scripting agent B7.
// Helpers: src/cards/helpers/B7.ts. Tests: tests/cards/B7/*.test.ts.
import {
  card, spell, spellModes, mode, when, onPlay, deathknell, onAttack, onDefend, onConquer, onHold, onMove, onConquerHere,
  onHoldHere, onDefendHere, whenYouPlay, whenUnitDies, atStartOfBeginning, atEndOfTurn, activated, statik, selfMight,
  selfKeyword, replacement, costModDyn, selfCostDyn, playFrom, playRule, rule, asPlay, delayedAbility, reflexiveAbility, cost, pay, dep, E, T, F, C, D, on,
  type Ctx, type ObjId, type PlayerId, type GameEvent,
} from '../dsl.ts';
import type { Destination } from '../dsl.ts';
import { modeFor, playIt, banishThenPlay, canAffordPlay, afterChain, deckToTrash, trashToHand, topCards,
  revealUntil, lookPick, chosenSoFar, PREVENT_NEXT, HIDE_FREE, inMyTrash, inAnyTrash, isUnitCard, isGearCard, isSpellCard,
  hasHidden, cardMight, zone, isPet, estSpent, energyOf, def, gearControlled,
} from '../helpers/B7.ts';

// Card texts (data/cards.json `text`), generated for batch B7.
const TXT: Record<string, string> = {
  "ogn-003-298": "[Assault 2]\nWhen you play me, discard 1.", // Chemtech Enforcer
  "ogn-006-298": "When you discard me, you may pay [C] to play me.", // Flame Chompers
  "ogn-025-298": "[Action]\nEach opponent reveals the top card of their Main Deck. Choose one and banish it, then play it, ignoring its cost. Then recycle the rest.", // Blind Fury
  "ogn-030-298": "[Accelerate]\n[Assault 2]\nWhen you play me, discard 2.", // Jinx
  "ogn-037-298": "[Assault 2]\nWhen you kill a unit with a spell, you may pay [1][C] to play me from your trash.", // Immortal Phoenix
  "ogn-038-298": "When you play me, draw 1 for each of your [Mighty] units.", // Kadregrin the Infernal
  "ogn-057-298": "[Hidden]\n[Action]\nGive a unit [Shield 3] and [Tank] this turn.", // Block
  "ogn-062-298": "Look at the top 5 cards of your Main Deck. You may banish a unit from among them, then play it, reducing its cost by [5]. Recycle the remaining cards.", // Reinforce
  "ogn-071-298": "Each other player chooses Cards or Runes. For each player that chooses Cards, you and that player each draw 1. For each player that chooses Runes, you and that player each channel 1 rune exhausted.", // Party Favors
  "ogn-075-298": "[Accelerate]\n[Deathknell] — Channel 2 runes exhausted and draw 1.", // Tasty Faefolk
  "ogn-083-298": "[Hidden]\n[Reaction]\nDraw 2.", // Consult the Past
  "ogn-087-298": "[Tank]\nWhen you play me, draw 1.", // Lecturing Yordle
  "ogn-096-298": "[Deathknell] — Draw 1.", // Watchful Sentry
  "ogn-102-298": "[Action]\nBanish a friendly unit, then its owner plays it to their base, ignoring its cost.", // Portal Rescue
  "ogn-107-298": "When I attack, you may pay [C] to play a card with [Hidden] from your hand, ignoring its cost. If it's a unit, play it here.", // Ava Achiever
  "ogn-109-298": "My Might is increased by the number of cards in your trash.\nAt the start of your Beginning Phase, recycle 3 from your trash.", // Dr. Mundo
  "ogn-112-298": "[Ganking]\nWhen I conquer, you may play a spell from your trash with Energy cost less than your points without paying its Energy cost. Then recycle it.", // Kai'Sa
  "ogn-114-298": "Draw 4.", // Progress Day
  "ogn-115-298": "Each player looks at the top 5 cards of their Main Deck, banishes one of them, then recycles the rest. Starting with the next player, each player plays those cards, ignoring Energy costs.", // Promising Future
  "ogn-118-298": "The first time a friendly unit dies each turn, draw 1.", // Wraith of Echoes
  "ogn-121-298": "[Hidden]\nWhen I defend, choose an enemy unit here and reveal the top 5 cards of your Main Deck. Deal 1 to that unit for each card with [Hidden] revealed this way, then recycle the revealed cards.", // Teemo
  "ogn-129-298": "[Action]\nUnits you play this turn enter ready. Draw 1.", // Confront
  "ogn-134-298": "Channel 1 rune exhausted. If you can't, draw 1.", // Mobilize
  "ogn-138-298": "Channel 2 runes exhausted. If you couldn't channel 2 runes this way, draw 1.", // Catalyst of Aeons
  "ogn-156-298": "Choose an opponent. They reveal their hand. Choose a non-unit card from it, and recycle that card.", // Sabotage
  "ogn-160-298": "At the end of your turn, reveal cards from the top of your Main Deck until you reveal a unit and banish it. Play it, ignoring its cost, and recycle the rest.", // Dazzling Aurora
  "ogn-165-298": "When you play me, return a unit from your trash to your hand.", // Cemetery Attendant
  "ogn-170-298": "[Action]\nReturn a unit from your trash to your hand.", // Morbid Return
  "ogn-178-298": "[Deathknell] — Discard 2, then draw 2.", // Undercover Agent
  "ogn-183-298": "[Action]\nLook at the top 3 cards of your Main Deck. Put 1 into your hand and recycle the rest.", // Stacked Deck
  "ogn-192-298": "When you play me, choose an opponent. They reveal their hand. Choose a card from it, and they discard that card.", // Mindsplitter
  "ogn-194-298": "[Ganking]\nAs you look at or reveal me from the top of your deck, you may banish me. If you do, you may play me for [A].", // Nocturne
  "ogn-196-298": "When you play me, you may play a unit from your trash, ignoring its Energy cost.", // Soulgorger
  "ogn-198-298": "Play a unit from your trash, ignoring its Energy cost.", // The Harrowing
  "ogn-200-298": "When I attack, reveal the top rune of your rune deck, then recycle it. Do one of the following based on its domain:\n* [R] — Deal 2 to an enemy unit here and 1 to all other enemy units here.\n* [B] — Draw 1.\n* [Y] — Stun an enemy unit.", // Twisted Fate
  "ogn-201-298": "Each player discards their hand, then draws 4.", // Invert Timelines
  "ogn-220-298": "[Hidden]\n[Action]\nStun a friendly unit and an enemy unit at the same battlefield.", // Facebreaker
  "ogn-226-298": "When you play me, you may play a unit costing no more than [3] and no more than [A] from your trash, ignoring its cost.", // Spectral Matron
  "ogn-242-298": "[1][C], [E]: Kill a friendly unit. Look at the top 5 cards of your Main Deck. You may banish a unit from among them that has Might up to 1 more than the killed unit and play it, ignoring its cost. Then recycle the rest.", // Baited Hook
  "ogn-252-298": "Deal 5 to a unit.\nWhen you conquer, you may discard 1 to return this from your trash to your hand.", // Super Mega Death Rocket!
  "ogn-264-298": "Return up to two cards with [Hidden] from your trash to your hand. You can hide ignoring costs this turn.", // Guerilla Warfare
  "ogs-010-024": "When you play me, return a spell from your trash to your hand.", // Annie
  "rad-010-167": "Ready a unit.\nWhen you play a card with Energy cost [7] or more, you may play this from your trash for [1][C][C]. Then banish this.", // Forbidden Technique
  "rad-015-167": "The first time I move each turn, [Add] [1][A].\nThe second time I move each turn, banish the top card of your Main Deck. Until your next Ending Phase, you may play that card.", // Akali
  "rad-018-167": "When you play me, reveal the top card of each opponent's Main Deck. Choose one and banish it, then play it, ignoring its cost. Recycle the rest.", // Drakehound Packmaster
  "rad-025-167": "[Reaction]\nGive a unit [Shield 2] this turn.\n[Predict].", // Consult the Heavens
  "rad-033-167": "Choose one —\n- Move a friendly gear with [Deploy] to a battlefield.\n- Look at the top 5 cards of your Main Deck. You may reveal a gear from among them and draw it. Recycle the rest.", // Command: Attack
  "rad-036-167": "[Deflect]\nWhen a stunned enemy unit here dies, draw 1.", // Storm Raptor
  "rad-047-167": "The next three times you play a unit this turn, draw 1.", // Fanfare
  "rad-050-167": "When you play me, [Predict 2].\n[Disarm 2]", // Mysterious Chronomancer
  "rad-053-167": "When I become exhausted, [Predict].", // Strigian Oracle
  "rad-060-167": "[Show Off] a card.\nWhen you play me, if you showed off a card, [Predict] equal to its Power cost, then draw 2.", // The Empyrean
  "rad-064-167": "[1], [T]: Choose an opponent. They guess a card type. Reveal the top card of your Main Deck. If it has that type, recycle it. Otherwise, draw it.", // Scrutinizing Scope
  "rad-067-167": "When you play me or when I hold, [Predict 3].\n[Deathknell][>] Banish the top card of your Main Deck. You may play it, ignoring its Energy cost.", // Clocktower Guardian
  "rad-074-167": "When I move, reveal the top card of your Main Deck. If it's [Mighty], draw it. Otherwise, recycle it.", // Raving Witness
  "rad-095-167": "[Hidden]\nWhen you play me, if it's not your turn, give me [Temporary].", // Momentary Companion
  "rad-099-167": "When you play me, choose an opponent. You and that player each draw 1.", // Suave Negotiator
  "rad-103-167": "[Hidden]\n[Show Off] a card with [Hidden].\nWhen you play me, if you showed off, [Add] [A].", // Gutter Guardian
  "rad-107-167": "[Hidden]\nWhen you play me, choose a battlefield. If there are 4 or more units there, you may return an enemy unit there to its owner's hand.", // Bedeviling Stranger
  "rad-111-167": "At the start of your Beginning Phase, each player reveals the top card of their Main Deck. If you revealed a card with the lowest Energy cost, draw it. Recycle the rest.", // Mechanical Bandit
  "rad-115-167": "[C], [T]: Return a friendly unit to its owner's hand. You may play a unit with less Might than that unit had, ignoring its cost.", // Transpositionist
  "rad-120-167": "When you play a card with Energy cost [7] or more, you may play me from your trash for [C].", // Meticulous Restorationist
  "rad-124-167": "Banish a unit with 3 [S] or less or a gear. [Burn 2].", // Burn Away
  "rad-129-167": "When you play me, look at the top 4 cards of your Main Deck. You may reveal from among them a unit or gear with Energy cost no more than [3] and with Power cost no more than [A] and draw it. Recycle the rest.", // Trifarian Captain
  "rad-135-167": "Play up to 3 units and/or gear from your trash, each with Energy cost no more than [3] and Power cost no more than [A], ignoring their costs.", // Remember the Fallen
  "rad-140-167": "As an additional cost to play this, pay any amount of Power.\nBanish that many units you control, then for each, its owner plays that unit back to the same location or to their base, ignoring its cost.", // Chronobreak
  "rad-154-167": "[Reaction]\nThe next unit you play this turn, even from face down, can be played to any battlefield. When you play it, [Buff] it.", // Last Caress
  "sfd-003-221": "[Action]\n[Repeat] [1]\nGive a unit [Assault 2] this turn.", // Blood Rush
  "sfd-018-221": "If you would reveal cards from a deck, look at the top card first. You may recycle it. Then reveal those cards.", // Void Hatchling
  "sfd-035-221": "When I hold, you may return a unit or gear from your trash to your hand.", // Guardian of the Passage
  "sfd-040-221": "[Action]\n[Repeat] [2]\nStun an attacking unit.", // Thwonk!
  "sfd-041-221": "When I move, reveal the top card of your Main Deck. If it's a gear, draw it. Otherwise, recycle it.", // Apprentice Smith
  "sfd-058-221": "When you play me or when I hold, look at the top 4 cards of your Main Deck. You may reveal a gear from among them and draw it. Then recycle the rest.", // Ornn
  "sfd-061-221": "When you play me, return a gear from your trash to your hand.", // Aspiring Engineer
  "sfd-084-221": "When you play me, you may kill a friendly gear. If you do, you may play a gear with Energy cost no more than [7] from hand this turn, ignoring its Energy cost.", // Jayce
  "sfd-100-221": "When you play a card with Power cost [A][A] or more, draw 1.", // Yordle Explorer
  "sfd-111-221": "[Hidden]\n[Action]\nYou may play a unit from hand to a battlefield you control, reducing its cost by [3].", // Here to Help
  "sfd-122-221": "[Action]\n[Repeat] [C]\nLook at the top 2 cards of your Main Deck. Draw one and recycle the other.", // Called Shot
  "sfd-138-221": "[Hidden]\nWhen you play me, you may return another unit at a battlefield with 3 [S] or less to its owner's hand.", // Windsinger
  "sfd-140-221": "When you play me, you may play a spell from your trash with Energy cost no more than [3], ignoring its Energy cost. Then recycle it.", // Fizz
  "sfd-142-221": "When you choose me with a spell, draw 1.", // Jae Medarda
  "sfd-165-221": "[Deathknell] — You may play a unit with cost no more than [3] and no more than [A] from your trash, ignoring its cost.", // Glasc Mixologist
  "sfd-167-221": "[Deathknell] — If I was [Mighty], draw 2.", // Unsung Hero
  "sfd-170-221": "When I attack, you may reveal the top 2 cards of your Main Deck. You may banish one, then play it. If it is a unit, you may play it here. Recycle the rest.", // Rek'Sai
  "sfd-187-221": "When you conquer, you may exhaust me to reveal the top 2 cards of your Main Deck. You may banish one, then play it. Recycle the rest.", // Void Burrower
  "sfd-188-221": "Reveal the top 2 cards of your Main Deck. You may banish one, then play it, reducing its cost by [2]. Draw any you didn't banish.", // Void Rush
  "sfd-194-221": "[Reaction]\nChoose a unit. The next time that unit would be dealt damage this turn, prevent it. Draw 1.", // Counter Strike
  "sfd-212-221": "When you conquer here, put the top 2 cards of your Main Deck into your trash.", // Minefield
  "sfd-215-221": "When you defend here, reveal the top card of your Main Deck. If it's a spell, put it in your hand. Otherwise, recycle it.", // Ravenbloom Conservatory
  "unl-025-219": "[Legion][>] You may play me from your trash for [3][C].", // Undying Legion
  "unl-032-219": "[Repeat] [2]\nLook at the top 3 cards of your Main Deck. You may reveal a unit from among them and draw it. Recycle the rest.", // Double Trouble
  "unl-042-219": "[Hidden]\n[Action]\n[Stun] a unit.\nIf you played this from your hand, draw 1.", // Back Off
  "unl-051-219": "When you play me or when I hold, look at the top 3 cards of your Main Deck. You may reveal a unit from among them and draw it. Recycle the rest. Then if you revealed a Bird, Cat, Dog, or Poro, do this: [Buff] a friendly unit.", // Ivern
  "unl-061-219": "[Reaction]\n[Repeat] [2]\nDraw 1.", // Downstage Dramatics
  "unl-062-219": "[Deathknell][>] [Predict 2].", // Dramatic Visionary
  "unl-064-219": "When you play me, look at the top 4 cards of your Main Deck. You may reveal a spell with Energy cost [4] or more from among them and draw it. Recycle the rest.", // Fate Weaver
  "unl-079-219": "When a showdown begins here, you may pay [1] to [Predict], then reveal the top card of your Main Deck. If it's a spell, draw it.", // Diana
  "unl-083-219": "[Hidden]\n[Action]\nChoose a unit you control and another unit you control at a different location. If at least one of them has [Temporary], move each to the other's location. Draw 1.", // Smoke and Mirrors
  "unl-089-219": "[Vision]\nIf you've spent [4] or more to play a spell this turn, you may play me for [C].", // Jhin
  "unl-097-219": "When you play me, draw 1 if your other units have total Might 5 or more.", // Kinkou Initiate
  "unl-121-219": "When you play me, choose a player. They discard 1.", // Bewitching Spirit
  "unl-123-219": "When you play me, discard 1, then draw 1.", // Evershade Stalker
  "unl-139-219": "[Hidden]\nChoose a battlefield. An opponent reveals their hand. You may choose a unit from it. They play that unit to that battlefield, ignoring any and all costs. If they do, then do this: [Stun] it.", // Bone Skewer
  "unl-165-219": "Choose a friendly unit without [Temporary]. Give it [Temporary]. Draw 2.", // Shadow's Call
  "unl-167-219": "When you play me, return a Bird, Cat, Dog, or Poro from your trash to your hand.", // Starhound
  "unl-168-219": "This costs [2] less if you choose a Bird, Cat, Dog, or Poro.\nPlay a unit with cost no more than [2] and no more than [A] from your trash, ignoring its cost.", // Undying Loyalty
  "unl-169-219": "When you play me, choose an opponent. They reveal their hand. Choose a card revealed this way and banish it. When they hold, return it to their hand.", // Ashe
  "unl-172-219": "[Assault]\n[Deathknell][>] Draw 1. If it's your Beginning Phase, draw 2 instead.", // LeBlanc
  "unl-179-219": "When I move to a battlefield, look at the top 3 cards of your Main Deck. You may reveal a unit from among them and draw it. Recycle the rest.\n[Deathknell][>] Play a unit from your hand to your base, ignoring its Energy cost.", // Rift Herald
  "unl-184-219": "[Reaction]\nBanish a friendly unit, then its owner plays it to any battlefield, ignoring its cost.", // Thrill of the Hunt
  "unl-211-219": "While you control this battlefield, when you play a spell, if you spent [4] or more, [Predict].", // Forgotten Library
  "ven-002-166": "The first time I move each turn, choose a player. They [Burn 1].", // Blade Twirler
  "ven-012-166": "Ready a unit and give it [Assault 3] this turn.\n[Flow] [3][C]", // Perfect Execution
  "ven-022-166": "When you play this, banish your hand and trash, then [Burn 7].\nSkip your Draw Phase.\nYou may play cards from your trash.\nIf a card would go to your trash from anywhere other than your Main Deck, banish it instead.", // Endless Riches
  "ven-033-166": "When I move, reveal the top card of your Main Deck. If it's a unit, draw it. Otherwise, put it in your trash and give me +2 [S] this turn.", // Pakaa Protector
  "ven-048-166": "When you play me, draw 1.", // Cloud Drake
  "ven-049-166": "Draw 1.\n[Flow] [2]", // Dredge Up
  "ven-056-166": "[Reaction]\n[Predict 5].\nDraw 2.", // Clairvoyance
  "ven-058-166": "When you play me, if you control 3 or more other gear, draw 1.", // Patched Porobot
  "ven-066-166": "[Hidden]\nBanish a unit, then its owner plays it to the same location, ignoring its cost.", // Temporal Breach
  "ven-085-166": "Choose an opponent. They reveal their hand and you choose a Mind card from it. They recycle that card.", // Decree of Strength
  "ven-089-166": "Look at the top 5 cards of your Main Deck. You may banish a unit or gear from among them and play it, reducing its Energy cost by [5]. Recycle the rest. Then you may do this: Empower it.", // Wild Claw
  "ven-094-166": "When you discard me, you may pay [1] to give a friendly unit +2 [S] this turn.", // Mask Mother
  "ven-095-166": "When I move, you may [Burn 1] to give me +1 [S] this turn.", // Shadow Order Disciple
  "ven-098-166": "Spells with [Flow] you play from your trash cost [2] less, to a minimum of [1].", // Stargazer
  "ven-101-166": "You may pay [1] as an additional cost to play me.\nWhen you play me, if you paid the additional cost, banish a card from any trash to give a unit [Assault 2] this turn.", // Gust Monk
  "ven-103-166": "Return up to 2 units from trashes to their owners' hands.", // Shadows of the Past
  "ven-105-166": "Move a unit with 3 [S] or less.\n[Flow] [4][C]", // Twilight Step
  "ven-108-166": "When you play this or at the start of your Beginning Phase, [Burn 1]. When you burn a unit this way, do this: Give a friendly unit +[S] equal to the burned card's Might this turn.", // Forgotten Relic
  "ven-113-166": "When you play me, [Burn 2].\nWhen I conquer, give a spell in your trash [Flow] equal to its cost this turn.", // Kennen
  "ven-114-166": "[Empower] [6][C][C]\nWhen I become [Empowered], choose an opponent. They [Burn 3]. Then you may do this: Choose a unit in their trash and play it, ignoring its cost.", // Kharox
  "ven-117-166": "[Hidden]\nI have [Shield 3] while I'm at a battlefield with exactly one other unit you control.", // Disciple of Shen
  "ven-144-166": "[Burn 3].\nPlay a 0 [S] Shadow Clone unit token.\n[Flow] [1][A][A]", // Death Mark
  "ven-156-166": "Look at the top 3 cards of your Main Deck. You may choose a card from among them and draw it. Put the rest into your trash.\n[Flow] [2][A]", // Lightning Rush
  "ven-165-166": "When you hold here, [Burn 3].", // Shadow Temple
};

/** "draw it" for a looked-at card: the engine's specific-card draw (draw event, replacements) */
const drawIt = (c: Ctx, id: ObjId): void => { c.drawCard(id); };

// =====================================================================================
// local utilities
// =====================================================================================

type Rec = Record<string, unknown>;
/** "as you play" data of the permanent that triggered a play trigger (Show Off, additional costs) */
const playData = (ctx: Ctx): Rec => ((ctx.event?.playData as Rec | undefined) ?? ctx.data ?? {});
const unitOrGear = (ctx: Ctx, id: ObjId) => isUnitCard(ctx, id) || isGearCard(ctx, id);
const playable = (ctx: Ctx, id: ObjId) => isUnitCard(ctx, id) || isGearCard(ctx, id) || isSpellCard(ctx, id);
const mineUnits = (ctx: Ctx, f?: (id: ObjId) => boolean) => ctx.friendlyUnits(u => ctx.ctrl(u) === ctx.controller && (!f || f(u)));
const bfIndexOf = (ctx: Ctx, bfObj: ObjId | undefined) => (bfObj ? ctx.battlefields().find(b => ctx.bfCard(b) === bfObj) : undefined);
/** "Recycle the rest": one instruction = one recycle event ("one or more" triggers once, RJ#3319b/#4034, principle 7; CR 416.4) */
const recycleLeft = (ctx: Ctx, ids: ObjId[]) => { const left = ids.filter(id => zone(ctx, id) === 'mainDeck'); if (left.length) ctx.recycle(left); };
/** cards in my trash matching f */
const myTrash = (ctx: Ctx, f: (id: ObjId) => boolean) => ctx.trash().filter(f);
/** cost ≤ [e] and ≤ [A]-style limits */
const costAtMost = (ctx: Ctx, id: ObjId, e: number, p: number) => ctx.energyCost(id) <= e && ctx.powerCost(id) <= p;
const trashTarget = (prompt: string, f: (ctx: Ctx, id: ObjId) => boolean, o: { min?: number; max?: number; any?: boolean } = {}) =>
  ({ ...T.card({ zones: ['trash'], prompt }, o.any ? inAnyTrash : inMyTrash, f), ...(o.min !== undefined ? { min: o.min } : {}), ...(o.max !== undefined ? { max: o.max } : {}) });
/** the player of a battlefield trigger's event (battlefield objects keep their owner as controller) */
const evPlayer = (ctx: Ctx) => ctx.event?.player as PlayerId;
/**
 * SCRIPT-FIX-2 / CR 387-389: "(Then) do this:" parts are reflexive chain items (ctx.reflexive) with their own choices and a
 * response window. `keepObj` stores an object of the first part; `stillObj` returns it on resolution if it is still the same object.
 */
const keepObj = (ctx: Ctx, id: ObjId) => ({ id, epoch: ctx.obj(id)?.epoch ?? 0 });
const stillObj = (ctx: Ctx, key: string): ObjId | undefined => {
  const x = ctx.data[key] as { id: ObjId; epoch: number } | undefined;
  return x && ctx.exists(x.id) && (ctx.obj(x.id).epoch ?? 0) === x.epoch ? x.id : undefined;
};

/** Choose one of the revealed cards, banish it and play it ignoring its cost; recycle the rest (Blind Fury, Drakehound). */
function banishPlayOneRecycleRest(ctx: Ctx, revealed: ObjId[]): void {
  const pick = ctx.chooseCards(revealed, 1, 1, 'Choose one to banish and play, ignoring its cost')[0];
  if (pick) banishThenPlay(ctx, pick, { cost: 'free' });
  recycleLeft(ctx, revealed.filter(id => id !== pick));
}

/** Reveal top 2, may banish one and play it (paying its cost / reduced), recycle the rest (Rek'Sai, Void Burrower). */
function revealTwoBanishPlay(ctx: Ctx, extraHere: boolean): void {
  const seen = topCards(ctx, 2, { reveal: true });
  const cands = seen.filter(id => playable(ctx, id) && canAffordPlay(ctx, id, 'full'));
  const pick = ctx.chooseCards(cands, 0, 1, 'You may banish one and play it')[0];
  if (pick) {
    const here = ctx.here();
    banishThenPlay(ctx, pick, { cost: 'full', extraDests: extraHere && isUnitCard(ctx, pick) && typeof here === 'number' ? [here] : [] });
  }
  recycleLeft(ctx, seen.filter(id => id !== pick));
}

/** "You may reveal a <filter> from among the top N and draw it. Recycle the rest." */
const revealAndDraw = (n: number, f: (ctx: Ctx, id: ObjId) => boolean, prompt: string) => (ctx: Ctx) =>
  lookPick(ctx, n, { filter: id => f(ctx, id), max: 1, revealPicked: true, prompt, with: ids => ids.forEach(id => ctx.drawCard(id)) });

/** "Reveal the top card. If <test>, draw it / put it in hand. Otherwise, recycle it." */
const revealTopThen = (test: (ctx: Ctx, id: ObjId) => boolean, yes: (ctx: Ctx, id: ObjId) => void, no?: (ctx: Ctx, id: ObjId) => void) => (ctx: Ctx) => {
  const top = topCards(ctx, 1, { reveal: true })[0];
  if (!top) return;
  if (test(ctx, top)) yes(ctx, top); else if (no) no(ctx, top); else ctx.recycle(top);
};

/** "When you play a card with Energy cost [7] or more, you may play this from your trash for COST" */
function playFromTrashOnBigPlay(costStr: string, then?: 'banish') {
  const c = cost(costStr);
  return when('play', (ev, ctx) => ev.player === ctx.controller && ev.obj !== ctx.self && !!ctx.obj(ev.obj as ObjId) && ctx.energyCost(ev.obj as ObjId) >= 7 && ctx.canPay(c), ctx => {
    if (zone(ctx, ctx.self) !== 'trash' || !ctx.canPay(c, ctx.self)) return;
    if (!ctx.may(`Play ${ctx.name(ctx.self)} from your trash for ${costStr}?`)) return;
    playIt(ctx, ctx.self, { cost: { pay: c }, then });
  }, { activeIn: ['trash'], text: `When you play a card with Energy cost [7] or more, you may play this from your trash for ${costStr}.` });
}

// =====================================================================================
// draw / discard
// =====================================================================================

card('ogn-003-298', TXT['ogn-003-298'], [onPlay(E.discard(1), { text: 'When you play me, discard 1.' })]);
card('ogn-030-298', TXT['ogn-030-298'], [onPlay(E.discard(2), { text: 'When you play me, discard 2.' })]);
card('ogn-083-298', TXT['ogn-083-298'], [spell(E.draw(2))]);
card('ogn-087-298', TXT['ogn-087-298'], [onPlay(E.draw(1), { text: 'When you play me, draw 1.' })]);
card('ven-048-166', TXT['ven-048-166'], [onPlay(E.draw(1), { text: 'When you play me, draw 1.' })]);
card('ogn-096-298', TXT['ogn-096-298'], [deathknell(E.draw(1), { text: 'Deathknell — Draw 1.' })]);
card('ogn-114-298', TXT['ogn-114-298'], [spell(E.draw(4))]);
card('ogn-178-298', TXT['ogn-178-298'], [deathknell(E.seq(E.discard(2), E.draw(2)), { text: 'Deathknell — Discard 2, then draw 2.' })]);
card('unl-123-219', TXT['unl-123-219'], [onPlay(E.seq(E.discard(1), E.draw(1)), { text: 'When you play me, discard 1, then draw 1.' })]);
card('unl-061-219', TXT['unl-061-219'], [spell(E.draw(1))]);
card('ven-049-166', TXT['ven-049-166'], [spell(E.draw(1))]);

card('ogn-075-298', TXT['ogn-075-298'], [
  deathknell(E.seq(E.channel(2, true), E.draw(1)), { text: 'Deathknell — Channel 2 runes exhausted and draw 1.' }),
]);

card('ogn-038-298', TXT['ogn-038-298'], [
  onPlay(ctx => { ctx.draw(mineUnits(ctx, u => ctx.isMighty(u)).length); }, { text: 'When you play me, draw 1 for each of your Mighty units.' }),
]);

card('ogn-201-298', TXT['ogn-201-298'], [spell(ctx => {
  ctx.eachPlayer(p => { ctx.discardCards([...ctx.hand(p)], p); });
  ctx.eachPlayer(p => { ctx.draw(4, p); });
})]);

card('rad-099-167', TXT['rad-099-167'], [
  onPlay(ctx => { const opp = ctx.chooseOpponent(); ctx.draw(1); ctx.draw(1, opp); }, { text: 'When you play me, choose an opponent. You and that player each draw 1.' }),
]);

card('unl-121-219', TXT['unl-121-219'], [
  onPlay(ctx => { const p = ctx.choosePlayer('Choose a player to discard 1'); if (p !== undefined) ctx.discard(1, p); }, { text: 'When you play me, choose a player. They discard 1.' }),
]);

card('unl-097-219', TXT['unl-097-219'], [
  onPlay(ctx => {
    const total = mineUnits(ctx, u => u !== ctx.self).reduce((s, u) => s + ctx.might(u), 0);
    if (total >= 5) ctx.draw(1);
  }, { text: 'When you play me, draw 1 if your other units have total Might 5 or more.' }),
]);

card('ven-058-166', TXT['ven-058-166'], [
  // Patched Porobot is a Unit and a Gear (additionalTypes ['Gear']): "other" excludes itself; other Gear Units count
  onPlay(E.draw(1), { if: ctx => gearControlled(ctx, ctx.self).length >= 3, text: 'When you play me, if you control 3 or more other gear, draw 1.' }),
]);

card('unl-172-219', TXT['unl-172-219'], [
  deathknell(ctx => { ctx.draw(ctx.g.phase === 'beginning' && ctx.isMyTurn() ? 2 : 1); }, { text: 'Deathknell — Draw 1. If it\'s your Beginning Phase, draw 2 instead.' }),
]);

card('sfd-167-221', TXT['sfd-167-221'], [
  deathknell(ctx => { const lk = ctx.event?.lki as { might?: number } | undefined; if ((lk?.might ?? 0) >= 5) ctx.draw(2); }, { text: 'Deathknell — If I was Mighty, draw 2.' }),
]);

card('ogn-118-298', TXT['ogn-118-298'], [
  // "The first time ... each turn": no friendly unit may have died earlier this turn (also before I was on the board).
  // RJ#3911 / RJ#2674: not for its own death (errata "another friendly unit"; data/cards.json still has the printed text) and,
  // via the engine's CR 383.2.c.2 rule (a source dying in the same event only sees its own death), not for units dying with it.
  when('die', (ev, ctx) => {
    const id = ev.obj as ObjId;
    return id !== ctx.self && !!ctx.obj(id) && ctx.isUnit(id) && ctx.isFriendly(id) && ctx.count(`unitsDied:${ctx.controller}`) === 0;
  }, E.draw(1), { oncePerTurn: 1, text: 'The first time a friendly unit dies each turn, draw 1.' }),
]);

card('rad-036-167', TXT['rad-036-167'], [
  whenUnitDies((c, id) => c.isEnemy(id) && c.isStunned(id) && c.isHere(id), E.draw(1), { text: 'When a stunned enemy unit here dies, draw 1.' }),
]);

card('sfd-142-221', TXT['sfd-142-221'], [
  when('targeted', (ev, ctx) => ev.obj === ctx.self && ev.player === ctx.controller && typeof ev.source === 'string'
    && !!ctx.obj(ev.source) && ctx.obj(ev.source).zone === 'chain' && isSpellCard(ctx, ev.source), E.draw(1), { text: 'When you choose me with a spell, draw 1.' }),
]);

card('sfd-100-221', TXT['sfd-100-221'], [
  whenYouPlay((c, id) => c.powerCost(id) >= 2, E.draw(1), { text: 'When you play a card with Power cost [A][A] or more, draw 1.' }),
]);

const FANFARE = delayedAbility('B7:fanfare', whenYouPlay(F.unit, E.draw(1), { text: 'Fanfare: draw 1' }));
card('rad-047-167', TXT['rad-047-167'], [spell(ctx => { ctx.delay(FANFARE, {}, 'endOfTurn', 3); })]);

card('ogn-129-298', TXT['ogn-129-298'], [spell(ctx => { ctx.delay(D.unitsEnterReady, {}, 'endOfTurn'); ctx.draw(1); })]);

card('ogn-071-298', TXT['ogn-071-298'], [spell(ctx => {
  const picks: [PlayerId, string][] = [];
  ctx.eachPlayer(p => { picks.push([p, modeFor(ctx, p, [{ id: 'cards', label: 'Cards' }, { id: 'runes', label: 'Runes' }], 'Party Favors: choose Cards or Runes')]); }, { others: true });
  for (const [p, m] of picks) {
    if (m === 'cards') { ctx.draw(1); ctx.draw(1, p); }
    else { ctx.channel(1, true); ctx.channel(1, true, p); }
  }
})]);

card('ogn-134-298', TXT['ogn-134-298'], [spell(ctx => { if (ctx.channel(1, true).length === 0) ctx.draw(1); })]);
card('ogn-138-298', TXT['ogn-138-298'], [spell(ctx => { if (ctx.channel(2, true).length < 2) ctx.draw(1); })]);

card('sfd-194-221', TXT['sfd-194-221'], [spell(ctx => {
  const t = ctx.target(0);
  if (t) ctx.delay(PREVENT_NEXT, { obj: t, epoch: ctx.obj(t).epoch ?? 0 }, 'endOfTurn');
  ctx.draw(1);
}, { targets: [T.unit({ hint: 'help', prompt: 'Choose a unit: prevent the next damage to it this turn' })] })]);

card('unl-165-219', TXT['unl-165-219'], [spell(ctx => {
  const t = ctx.target(0);
  if (t) ctx.giveKeyword(t, 'Temporary', 'permanent');
  ctx.draw(2);
}, { targets: [T.unit(F.friendly, (c, id) => !c.has(id, 'Temporary'), { hint: 'neutral', prompt: 'Choose a friendly unit without [Temporary]' })] })]);

card('unl-042-219', TXT['unl-042-219'], [spell(ctx => {
  ctx.stun(ctx.targetsOf(0));
  if ((ctx.item?.choices.playEvent as GameEvent | undefined)?.from === 'hand') ctx.draw(1);
}, { targets: [T.unit({ hint: 'harm', prompt: 'Stun a unit' })] })]);

card('unl-083-219', TXT['unl-083-219'], [spell(ctx => {
  const a = ctx.target(0), b = ctx.target(1);
  if (a && b && !ctx.sameLocation(a, b) && (ctx.has(a, 'Temporary') || ctx.has(b, 'Temporary'))) ctx.swapLocations(a, b);
  ctx.draw(1);
}, { targets: [
  T.unit(F.youControl, { hint: 'help', prompt: 'Choose a unit you control' }),
  T.unit(F.youControl, (c, id) => { const f = chosenSoFar(c, 0)[0]; return !f || (f !== id && !c.sameLocation(f, id)); }, { hint: 'help', prompt: 'Choose another unit you control at a different location', anyLocation: true }),
] })]);

// =====================================================================================
// "when you discard me"
// =====================================================================================

card('ogn-006-298', TXT['ogn-006-298'], [
  when('discard', (ev, ctx) => ev.obj === ctx.self && ev.player === ctx.controller && ctx.canPay(cost('[C]')), ctx => {
    if (zone(ctx, ctx.self) === 'trash') playIt(ctx, ctx.self, { cost: 'free' });
  }, { activeIn: ['trash'], optional: 'Flame Chompers: pay [C] to play it?', cost: cost('[C]'), text: 'When you discard me, you may pay [C] to play me.' }),
]);

card('ven-094-166', TXT['ven-094-166'], [
  when('discard', (ev, ctx) => ev.obj === ctx.self && ev.player === ctx.controller && ctx.canPay(cost('[1]')), E.might(0, 2), {
    activeIn: ['trash'], optional: 'Mask Mother: pay [1] to give a friendly unit +2 [S] this turn?', cost: cost('[1]'),
    targets: [T.unit(F.friendly, { hint: 'help', prompt: 'Give a friendly unit +2 [S] this turn' })],
    text: 'When you discard me, you may pay [1] to give a friendly unit +2 [S] this turn.',
  }),
]);

// =====================================================================================
// look / reveal / predict
// =====================================================================================

card('ogn-183-298', TXT['ogn-183-298'], [spell(ctx => {
  lookPick(ctx, 3, { min: 1, max: 1, prompt: 'Put 1 into your hand (the rest are recycled)', with: ids => ids.forEach(id => ctx.toHand(id)) });
})]);

card('sfd-122-221', TXT['sfd-122-221'], [spell(ctx => {
  lookPick(ctx, 2, { min: 1, max: 1, prompt: 'Draw one (the other is recycled)', with: ids => ids.forEach(id => ctx.drawCard(id)) });
})]);

card('ven-156-166', TXT['ven-156-166'], [spell(ctx => {
  lookPick(ctx, 3, { max: 1, prompt: 'You may choose a card and draw it (the rest go to your trash)', rest: 'trash', with: ids => ids.forEach(id => ctx.drawCard(id)) });
})]);

card('unl-032-219', TXT['unl-032-219'], [spell(revealAndDraw(3, isUnitCard, 'You may reveal a unit and draw it'))]);

card('rad-129-167', TXT['rad-129-167'], [
  onPlay(revealAndDraw(4, (c, id) => unitOrGear(c, id) && costAtMost(c, id, 3, 1), 'You may reveal a unit or gear (cost ≤ [3] and ≤ [A]) and draw it'),
    { text: 'When you play me, look at the top 4 cards ... reveal a unit or gear with cost ≤ [3] / [A] and draw it.' }),
]);

card('unl-064-219', TXT['unl-064-219'], [
  onPlay(revealAndDraw(4, (c, id) => isSpellCard(c, id) && c.energyCost(id) >= 4, 'You may reveal a spell with Energy cost [4] or more and draw it'),
    { text: 'When you play me, look at the top 4 ... reveal a spell with Energy cost [4]+ and draw it.' }),
]);

const ornn = revealAndDraw(4, isGearCard, 'You may reveal a gear and draw it');
card('sfd-058-221', TXT['sfd-058-221'], [
  onPlay(ornn, { text: 'When you play me, look at the top 4 ... draw a gear.' }),
  onHold(ornn, { text: 'When I hold, look at the top 4 ... draw a gear.' }),
]);

// CR 387-389: "Then if you revealed a Bird, Cat, Dog, or Poro, do this: [Buff] a friendly unit" is a reflexive item; the unit is
// its target, chosen as it goes on the chain
const ivernBuff = reflexiveAbility('B7:ivern:buff', {
  targets: [T.unit(F.friendly, { hint: 'help', prompt: 'Buff a friendly unit' })],
  effect: ctx => { const u = ctx.target(0); if (u) ctx.buff(u); },
  text: 'Ivern: buff a friendly unit',
});
const ivern = (ctx: Ctx) => {
  const { picked } = lookPick(ctx, 3, { filter: id => isUnitCard(ctx, id), max: 1, revealPicked: true, prompt: 'You may reveal a unit and draw it', with: ids => ids.forEach(id => ctx.drawCard(id)) });
  if (picked.some(id => isPet(ctx, id))) ctx.reflexive(ivernBuff);
};
card('unl-051-219', TXT['unl-051-219'], [
  onPlay(ivern, { text: 'When you play me, look at the top 3 ... (Bird, Cat, Dog or Poro: buff a friendly unit).' }),
  onHold(ivern, { text: 'When I hold, look at the top 3 ... (Bird, Cat, Dog or Poro: buff a friendly unit).' }),
]);

card('unl-179-219', TXT['unl-179-219'], [
  onMove(revealAndDraw(3, isUnitCard, 'You may reveal a unit and draw it'), { toBattlefield: true, text: 'When I move to a battlefield, look at the top 3 ... draw a unit.' }),
  deathknell(ctx => {
    const cands = ctx.hand().filter(id => isUnitCard(ctx, id) && canAffordPlay(ctx, id, 'noEnergy'));
    const pick = ctx.chooseCards(cands, 1, 1, 'Play a unit from your hand to your base, ignoring its Energy cost')[0];
    if (pick) playIt(ctx, pick, { cost: 'noEnergy', dest: 'base' });
  }, { text: 'Deathknell — Play a unit from your hand to your base, ignoring its Energy cost.' }),
]);

card('rad-033-167', TXT['rad-033-167'], [spellModes([
  mode('move', 'Move a friendly gear with [Deploy] to a battlefield', E.moveToChosen(0, 1),
    [T.gear(F.friendly, (c, id) => c.has(id, 'Deploy'), { hint: 'help', prompt: 'Choose a friendly gear with [Deploy]' }),
      T.destination(F.moveDestFor(0), F.dest((_c, l) => typeof l === 'number'), { prompt: 'Move it to' })]),   // R-2
  mode('look', 'Look at the top 5 cards; you may reveal a gear and draw it', revealAndDraw(5, isGearCard, 'You may reveal a gear and draw it')),
])]);

card('rad-025-167', TXT['rad-025-167'], [spell(ctx => {
  const t = ctx.target(0);
  if (t) ctx.giveKeyword(t, 'Shield 2');
  ctx.predict(1);
}, { targets: [T.unit({ hint: 'help', prompt: 'Give a unit [Shield 2] this turn' })] })]);

card('rad-050-167', TXT['rad-050-167'], [onPlay(E.predict(2), { text: 'When you play me, Predict 2.' })]);
card('rad-053-167', TXT['rad-053-167'], [when('exhaust', on.self, E.predict(1), { text: 'When I become exhausted, Predict.' })]);
card('unl-062-219', TXT['unl-062-219'], [deathknell(E.predict(2), { text: 'Deathknell — Predict 2.' })]);
card('ven-056-166', TXT['ven-056-166'], [spell(E.seq(E.predict(5), E.draw(2)))]);

card('rad-060-167', TXT['rad-060-167'], [
  asPlay(ctx => { const id = ctx.showOff(() => true, 'Show off a card?'); if (id) ctx.data.shownOffPower = ctx.powerCost(id); }, { text: 'Show Off a card' }),
  onPlay(ctx => {
    const n = Number(playData(ctx).shownOffPower ?? 0);
    if (n > 0) ctx.predict(n);
    ctx.draw(2);
  }, { if: ctx => !!playData(ctx).shownOff, text: 'When you play me, if you showed off a card, Predict equal to its Power cost, then draw 2.' }),
], { keywords: ['Show Off'] });

card('rad-067-167', TXT['rad-067-167'], [
  onPlay(E.predict(3), { text: 'When you play me, Predict 3.' }),
  onHold(E.predict(3), { text: 'When I hold, Predict 3.' }),
  deathknell(ctx => {
    const top = ctx.deck()[0];
    if (!top) return;
    ctx.banish(top);
    if (zone(ctx, top) !== 'banishment' || !playable(ctx, top) || !canAffordPlay(ctx, top, 'noEnergy')) return;
    if (ctx.may(`Play ${ctx.name(top)}, ignoring its Energy cost?`)) playIt(ctx, top, { cost: 'noEnergy' });
  }, { text: 'Deathknell — Banish the top card of your Main Deck. You may play it, ignoring its Energy cost.' }),
]);

card('ogn-121-298', TXT['ogn-121-298'], [
  onDefend(ctx => {
    const u = ctx.target(0);
    const seen = topCards(ctx, 5, { reveal: true });
    const n = seen.filter(id => hasHidden(ctx, id)).length;
    if (u && n > 0) ctx.deal(n, u);
    recycleLeft(ctx, seen);
  }, { targets: [T.unit(F.enemy, F.here, { hint: 'harm', prompt: 'Teemo: choose an enemy unit here' })], text: 'When I defend, ... deal 1 for each card with [Hidden] revealed.' }),
]);

card('rad-074-167', TXT['rad-074-167'], [
  onMove(revealTopThen((c, id) => isUnitCard(c, id) && cardMight(c, id) >= 5, drawIt), { text: 'When I move, reveal the top card. If it\'s Mighty, draw it. Otherwise, recycle it.' }),
]);
card('sfd-041-221', TXT['sfd-041-221'], [
  onMove(revealTopThen(isGearCard, drawIt), { text: 'When I move, reveal the top card. If it\'s a gear, draw it. Otherwise, recycle it.' }),
]);
card('ven-033-166', TXT['ven-033-166'], [
  onMove(revealTopThen(isUnitCard, drawIt, (c, id) => { deckToTrash(c, id); c.giveMight(c.self, 2); }),
    { text: 'When I move, reveal the top card. If it\'s a unit, draw it. Otherwise, put it in your trash and give me +2 [S] this turn.' }),
]);

card('unl-079-219', TXT['unl-079-219'], [
  when('showdownStart', (ev, ctx) => { const h = ctx.here(); return typeof h === 'number' && ev.bf === h && ctx.canPay(cost('[1]')); }, ctx => {
    ctx.predict(1);
    revealTopThen(isSpellCard, drawIt, () => {})(ctx);
  }, { optional: 'Diana: pay [1] to Predict, then reveal the top card?', cost: cost('[1]'), text: 'When a showdown begins here, you may pay [1] to Predict, then reveal the top card. If it\'s a spell, draw it.' }),
]);

card('rad-064-167', TXT['rad-064-167'], [
  activated(cost('[1], [T]'), ctx => {
    const opp = ctx.chooseOpponent();
    const guess = modeFor(ctx, opp, [{ id: 'Unit', label: 'Unit' }, { id: 'Gear', label: 'Gear' }, { id: 'Spell', label: 'Spell' }], 'Scrutinizing Scope: guess a card type');
    const top = topCards(ctx, 1, { reveal: true })[0];
    if (!top) return;
    if (ctx.type(top) === guess) ctx.recycle(top); else ctx.drawCard(top);
  }, { text: '[1], [T]: Choose an opponent. They guess a card type. Reveal the top card. If it has that type, recycle it. Otherwise, draw it.' }),
]);

card('rad-111-167', TXT['rad-111-167'], [
  atStartOfBeginning(ctx => {
    const rev: [PlayerId, ObjId][] = [];
    ctx.eachPlayer(p => { const t = topCards(ctx.as(p), 1, { reveal: true, deckOwner: p, actor: p })[0]; if (t) rev.push([p, t]); });
    if (!rev.length) return;
    const low = Math.min(...rev.map(([, id]) => ctx.energyCost(id)));
    const mine = rev.find(([p, id]) => p === ctx.controller && ctx.energyCost(id) === low);
    if (mine) ctx.drawCard(mine[1]);
    recycleLeft(ctx, rev.map(([, id]) => id));
  }, { text: 'At the start of your Beginning Phase, each player reveals the top card ...' }),
]);

// CR 387 ("Do one of the following:" is reflexive, docs/rules-spec.md §8.3): the domain branch is its own chain item; its enemy
// unit is a target chosen as it goes on the chain (no legal target -> removed, CR 403.4)
const tfFury = reflexiveAbility('B7:twistedFate:fury', {
  targets: [T.unit(F.enemy, F.here, { hint: 'harm', prompt: 'Deal 2 to an enemy unit here (1 to all other enemy units here)' })],
  effect: ctx => {
    const t = ctx.target(0);
    const others = ctx.onBoard(ctx.self) ? ctx.units(u => u !== t && u !== ctx.targets[0]?.[0] && ctx.isEnemy(u) && ctx.isHere(u)) : [];
    ctx.dealEach([...(t ? [{ id: t, amount: 2 }] : []), ...others.map(id => ({ id, amount: 1 }))]);
  },
  text: 'Twisted Fate [R]: deal 2 to an enemy unit here and 1 to all other enemy units here',
});
const tfMind = reflexiveAbility('B7:twistedFate:mind', { effect: E.draw(1), text: 'Twisted Fate [B]: draw 1' });
const tfOrder = reflexiveAbility('B7:twistedFate:order', {
  targets: [T.unit(F.enemy, { hint: 'harm', prompt: 'Stun an enemy unit' })],
  effect: ctx => { const t = ctx.target(0); if (t) ctx.stun(t); },
  text: 'Twisted Fate [Y]: stun an enemy unit',
});
card('ogn-200-298', TXT['ogn-200-298'], [
  onAttack(ctx => {
    const r = ctx.g.players[ctx.controller].runeDeck[0];
    if (!r) return;
    ctx.reveal([r]);
    const doms = ctx.domains(r);
    ctx.recycle(r);
    if (doms.includes('Fury')) ctx.reflexive(tfFury);
    else if (doms.includes('Mind')) ctx.reflexive(tfMind);
    else if (doms.includes('Order')) ctx.reflexive(tfOrder);
  }, { text: 'When I attack, reveal the top rune of your rune deck, then recycle it ...' }),
]);

// Void Hatchling — a replacement of the engine's one reveal-from-deck event (lookDeck 'revealDeck'): every reveal, any batch
card('sfd-018-221', TXT['sfd-018-221'], [
  replacement('revealDeck', (ev, ctx) => ev.player === ctx.controller && ctx.onBoard(ctx.self), (ev, ctx) => {
    const top = ctx.deck(ev.owner as PlayerId)[0];
    if (top && ctx.chooseCards([top], 0, 1, 'Void Hatchling: you look at the top card first. Recycle it?').length) ctx.recycle([top]);
    return ev;
  }, { text: 'If you would reveal cards from a deck, look at the top card first. You may recycle it.' }),
]);
// Nocturne — a 'lookedAt' trigger active in the Main Deck (fires for every look/reveal: Vision, Predict, E.lookTop, ...).
// RJ#3918 (house ruling): the banish happens as he is seen; the play for [A] comes after the looking effect finishes (reflexive).
const nocturnePlay = reflexiveAbility('B7:nocturne:play', {
  text: 'Nocturne: you may play him for [A]',
  effect: ctx => {
    const forA = { cost: { pay: cost('[A]') } } as const;
    if (zone(ctx, ctx.self) === 'banishment' && ctx.canPlayByEffect(ctx.self, forA) && ctx.may('Nocturne: play him for [A]?')) ctx.play(ctx.self, forA);
  },
});
card('ogn-194-298', TXT['ogn-194-298'], [
  when('lookedAt', (ev, ctx) => ev.owner === ctx.controller && ev.player === ctx.controller, ctx => {
    ctx.banish(ctx.self);
    if (zone(ctx, ctx.self) === 'banishment') ctx.reflexive(nocturnePlay);
  }, { optional: 'Nocturne: banish him from the top of your deck?', activeIn: ['mainDeck'], text: 'As you look at or reveal me from the top of your deck, you may banish me. If you do, you may play me for [A].' }),
]);

// =====================================================================================
// reveal hands
// =====================================================================================

card('ogn-156-298', TXT['ogn-156-298'], [spell(ctx => {
  const opp = ctx.chooseOpponent();
  const hand = ctx.revealHand(opp);
  ctx.recycle(ctx.chooseCards(hand.filter(id => !isUnitCard(ctx, id)), 1, 1, 'Choose a non-unit card to recycle'));
})]);

card('ven-085-166', TXT['ven-085-166'], [spell(ctx => {
  const opp = ctx.chooseOpponent();
  const hand = ctx.revealHand(opp);
  ctx.recycle(ctx.chooseCards(hand.filter(id => ctx.domains(id).includes('Mind')), 1, 1, 'Choose a Mind card; they recycle it'));
})]);

card('ogn-192-298', TXT['ogn-192-298'], [
  onPlay(ctx => {
    const opp = ctx.chooseOpponent();
    const hand = ctx.revealHand(opp);
    ctx.discardCards(ctx.chooseCards(hand, 1, 1, 'Choose a card; they discard it'), opp);
  }, { text: 'When you play me, choose an opponent. They reveal their hand. Choose a card from it, and they discard that card.' }),
]);

const ASHE = delayedAbility('B7:asheReturn', when('hold', (ev, ctx) => ev.player === ctx.data.opp, ctx => {
  const id = ctx.data.obj as ObjId;
  if (ctx.obj(id)?.zone === 'banishment' && (ctx.obj(id).epoch ?? 0) === ctx.data.epoch) ctx.toHand(id);
}, { text: 'Ashe: return the banished card to its owner\'s hand' }));
card('unl-169-219', TXT['unl-169-219'], [
  onPlay(ctx => {
    const opp = ctx.chooseOpponent();
    const hand = ctx.revealHand(opp);
    const pick = ctx.chooseCards(hand, 1, 1, 'Choose a card to banish')[0];
    if (!pick) return;
    ctx.banish(pick);
    if (zone(ctx, pick) === 'banishment') ctx.delay(ASHE, { obj: pick, epoch: ctx.obj(pick).epoch ?? 0, opp }, 'never', 1);
  }, { text: 'When you play me, choose an opponent. They reveal their hand. Choose a card and banish it. When they hold, return it to their hand.' }),
]);

// CR 387-389: "If they do, then do this: [Stun] it" is a reflexive item (players may respond before the stun)
const boneSkewerStun = reflexiveAbility('B7:boneSkewer:stun', {
  effect: ctx => { const u = stillObj(ctx, 'unit'); if (u && ctx.onBoard(u)) ctx.stun(u); },
  text: 'Bone Skewer: stun it',
});
card('unl-139-219', TXT['unl-139-219'], [spell(ctx => {
  const bf = bfIndexOf(ctx, ctx.target(0));
  if (bf === undefined) return;
  const opp = ctx.chooseOpponent();
  const hand = ctx.revealHand(opp);
  const pick = ctx.chooseCards(hand.filter(id => isUnitCard(ctx, id)), 0, 1, 'You may choose a unit; they play it to that battlefield')[0];
  if (!pick) return;
  // CR 354.4: the unit enters when this spell finishes; the reflexive stun refers to the object it becomes
  const ref = playIt(ctx, pick, { payer: opp, cost: 'free', dest: bf, allCosts: true }) ? ctx.playedObj(pick) : null;
  if (ref) ctx.reflexive(boneSkewerStun, { unit: ref });
}, { targets: [T.battlefield({ prompt: 'Choose a battlefield' })] })]);

// =====================================================================================
// trash -> hand
// =====================================================================================

card('ogn-165-298', TXT['ogn-165-298'], [
  onPlay(ctx => trashToHand(ctx, ctx.targetsOf(0)), { targets: [trashTarget('Return a unit from your trash to your hand', isUnitCard)], text: 'When you play me, return a unit from your trash to your hand.' }),
]);
card('ogn-170-298', TXT['ogn-170-298'], [
  spell(ctx => trashToHand(ctx, ctx.targetsOf(0)), { targets: [trashTarget('Return a unit from your trash to your hand', isUnitCard)] }),
]);
card('ogs-010-024', TXT['ogs-010-024'], [
  onPlay(ctx => trashToHand(ctx, ctx.targetsOf(0)), { targets: [trashTarget('Return a spell from your trash to your hand', isSpellCard)], text: 'When you play me, return a spell from your trash to your hand.' }),
]);
card('sfd-061-221', TXT['sfd-061-221'], [
  onPlay(ctx => trashToHand(ctx, ctx.targetsOf(0)), { targets: [trashTarget('Return a gear from your trash to your hand', isGearCard)], text: 'When you play me, return a gear from your trash to your hand.' }),
]);
card('unl-167-219', TXT['unl-167-219'], [
  onPlay(ctx => trashToHand(ctx, ctx.targetsOf(0)), { targets: [trashTarget('Return a Bird, Cat, Dog, or Poro from your trash to your hand', isPet)], text: 'When you play me, return a Bird, Cat, Dog, or Poro from your trash to your hand.' }),
]);
card('sfd-035-221', TXT['sfd-035-221'], [
  onHold(ctx => trashToHand(ctx, ctx.targetsOf(0)), { targets: [trashTarget('You may return a unit or gear from your trash to your hand', unitOrGear, { min: 0 })], text: 'When I hold, you may return a unit or gear from your trash to your hand.' }),
]);
card('ogn-264-298', TXT['ogn-264-298'], [
  spell(ctx => { trashToHand(ctx, ctx.targetsOf(0)); ctx.delay(HIDE_FREE, {}, 'endOfTurn'); },
    { targets: [trashTarget('Return up to two cards with [Hidden] from your trash to your hand', hasHidden, { min: 0, max: 2 })] }),
]);
card('ven-103-166', TXT['ven-103-166'], [
  spell(ctx => trashToHand(ctx, ctx.targetsOf(0)), { targets: [trashTarget('Return up to 2 units from trashes to their owners\' hands', isUnitCard, { min: 0, max: 2, any: true })] }),
]);

card('ogn-252-298', TXT['ogn-252-298'], [
  spell(E.deal(5, 0), { targets: [T.unit({ hint: 'harm', prompt: 'Deal 5 to a unit' })] }),
  // RJ#6533 (DECISIONS #6533, principle 11; CR 383.3.a-b): "you may discard 1" is the trigger's leading cost — decided and paid as
  // the trigger is chained (declining / an empty hand removes it); on resolution SMDR returns if it is still in the trash
  when('conquer', on.mine, ctx => {
    if (zone(ctx, ctx.self) === 'trash') ctx.toHand(ctx.self);
  }, { activeIn: ['trash'], optional: 'Discard 1 to return Super Mega Death Rocket! from your trash to your hand?', cost: cost('', pay.discard(1)),
    text: 'When you conquer, you may discard 1 to return this from your trash to your hand.' }),
]);

// =====================================================================================
// play from trash
// =====================================================================================

card('ogn-037-298', TXT['ogn-037-298'], [
  when('killed', (ev, ctx) => {
    const by = ev.by as { player?: PlayerId; obj?: ObjId } | null;
    const lk = ev.lki as { type?: string } | undefined;
    // RJ#4019 DECIDED (lead, Origins FAQ): only a spell YOU control counts — not your own kill for an opponent's Cull the Weak;
    // and YOU must perform the kill — not the opponent's kill for my Cull the Weak (DECISIONS #3618 B; by.player = the performer)
    return !!by && by.player === ctx.controller && !!by.obj && !!ctx.obj(by.obj) && isSpellCard(ctx, by.obj) && ctx.ctrl(by.obj) === ctx.controller && lk?.type === 'Unit' && ctx.canPay(cost('[1][C]'));
  }, ctx => {
    if (zone(ctx, ctx.self) === 'trash') playIt(ctx, ctx.self, { cost: 'free' });
  }, { activeIn: ['trash'], optional: 'Immortal Phoenix: pay [1][C] to play it from your trash?', cost: cost('[1][C]'), text: 'When you kill a unit with a spell, you may pay [1][C] to play me from your trash.' }),
]);

card('rad-010-167', TXT['rad-010-167'], [
  spell(E.ready(0), { targets: [T.unit({ hint: 'help', prompt: 'Ready a unit' })] }),
  playFromTrashOnBigPlay('[1][C][C]', 'banish'),
]);
card('rad-120-167', TXT['rad-120-167'], [playFromTrashOnBigPlay('[C]')]);

card('unl-025-219', TXT['unl-025-219'], [
  playFrom('trash', { cost: cost('[3][C]'), requires: [dep.legion()], text: 'Legion — You may play me from your trash for [3][C].' }),
]);

card('unl-089-219', TXT['unl-089-219'], [
  playFrom('hand', {
    cost: cost('[C]'),
    // RULINGS: Energy actually paid for a spell this turn (engine count maxSpellEnergy:<p>, set as spells finalize)
    if: ctx => ctx.count(`maxSpellEnergy:${ctx.controller}`) >= 4,
    text: 'If you\'ve spent [4] or more to play a spell this turn, you may play me for [C].',
  }),
]);

// RULINGS: CR 355.5 / 403.2 — "a unit from your trash" is a specific object (the trash is public), so it is a target chosen
// as the spell is played / the trigger goes on the chain; it is played on resolution if it is still there.
const trashUnitToPlay = (f: (ctx: Ctx, id: ObjId) => boolean, mode: 'free' | 'noEnergy', min: 0 | 1, prompt: string) =>
  trashTarget(prompt, (c, id) => isUnitCard(c, id) && f(c, id) && canAffordPlay(c, id, mode), { min, max: 1 });
const playUnitFromTrash = (mode: 'free' | 'noEnergy') => (ctx: Ctx) => {
  const pick = ctx.target(0);
  if (pick && ctx.obj(pick)?.zone === 'trash') playIt(ctx, pick, { cost: mode });
};
card('ogn-196-298', TXT['ogn-196-298'], [
  onPlay(playUnitFromTrash('noEnergy'), { targets: [trashUnitToPlay(() => true, 'noEnergy', 0, 'You may play a unit from your trash, ignoring its Energy cost')], text: 'When you play me, you may play a unit from your trash, ignoring its Energy cost.' }),
]);
card('ogn-198-298', TXT['ogn-198-298'], [
  spell(playUnitFromTrash('noEnergy'), { targets: [trashUnitToPlay(() => true, 'noEnergy', 1, 'Play a unit from your trash, ignoring its Energy cost')] }),
]);
card('ogn-226-298', TXT['ogn-226-298'], [
  onPlay(playUnitFromTrash('free'), { targets: [trashUnitToPlay((c, id) => costAtMost(c, id, 3, 1), 'free', 0, 'You may play a unit (cost ≤ [3] and ≤ [A]) from your trash, ignoring its cost')],
    text: 'When you play me, you may play a unit costing no more than [3] and [A] from your trash, ignoring its cost.' }),
]);
card('sfd-165-221', TXT['sfd-165-221'], [
  deathknell(playUnitFromTrash('free'), { targets: [trashUnitToPlay((c, id) => costAtMost(c, id, 3, 1), 'free', 0, 'You may play a unit (cost ≤ [3] and ≤ [A]) from your trash, ignoring its cost')],
    text: 'Deathknell — You may play a unit with cost no more than [3] and [A] from your trash, ignoring its cost.' }),
]);

// RULINGS: CR 355.5 — the cards are targets chosen as it is played (see The Harrowing)
card('rad-135-167', TXT['rad-135-167'], [spell(ctx => {
  for (const id of ctx.targetsOf(0)) if (ctx.obj(id)?.zone === 'trash') playIt(ctx, id, { cost: 'free' });
}, { targets: [trashTarget('Play up to 3 units and/or gear (cost ≤ [3] and ≤ [A]) from your trash, ignoring their costs', (c, id) => unitOrGear(c, id) && costAtMost(c, id, 3, 1), { min: 0, max: 3 })] })]);

card('unl-168-219', TXT['unl-168-219'], [
  selfCostDyn(ctx => {
    const t = ctx.item?.source === ctx.self ? ctx.item.targets?.[0]?.[0] : undefined;
    return t && ctx.obj(t) && isPet(ctx, t) ? { energy: -2 } : {};
  }, { text: 'This costs [2] less if you choose a Bird, Cat, Dog, or Poro.' }),
  spell(ctx => { const t = ctx.target(0); if (t) playIt(ctx, t, { cost: 'free' }); },
    { targets: [trashTarget('Choose a unit with cost ≤ [2] and ≤ [A] in your trash', (c, id) => isUnitCard(c, id) && costAtMost(c, id, 2, 1))] }),
]);

// CR 355.5 / principle 4 (RJ#10771, #12050): the trash spell is a specific object, chosen as the trigger goes on the chain (a
// leading "you may" — choosing none removes the trigger); on resolution it is played only if it is still in the trash.
const spellFromTrashTarget = (limit: (ctx: Ctx, id: ObjId) => boolean, prompt: string) =>
  trashTarget(prompt, (c, id) => isSpellCard(c, id) && id !== c.self && limit(c, id) && canAffordPlay(c, id, 'noEnergy'), { min: 0, max: 1 });
const spellFromTrash = (ctx: Ctx) => {
  const pick = ctx.target(0);
  if (pick && ctx.obj(pick)?.zone === 'trash') playIt(ctx, pick, { cost: 'noEnergy', then: 'recycle' });
};
card('ogn-112-298', TXT['ogn-112-298'], [
  onConquer(spellFromTrash,
    { targets: [spellFromTrashTarget((c, id) => c.energyCost(id) < c.points(), 'You may play a spell from your trash with Energy cost less than your points, without paying its Energy cost (then recycle it)')],
      text: 'When I conquer, you may play a spell from your trash with Energy cost less than your points without paying its Energy cost. Then recycle it.' }),
]);
card('sfd-140-221', TXT['sfd-140-221'], [
  onPlay(spellFromTrash,
    { targets: [spellFromTrashTarget((c, id) => c.energyCost(id) <= 3, 'You may play a spell (Energy cost ≤ [3]) from your trash, ignoring its Energy cost (then recycle it)')],
      text: 'When you play me, you may play a spell from your trash with Energy cost no more than [3], ignoring its Energy cost. Then recycle it.' }),
]);

card('ven-113-166', TXT['ven-113-166'], [
  onPlay(E.burn(2), { text: 'When you play me, Burn 2.' }),
  onConquer(ctx => {
    const s = ctx.target(0);
    if (!s || zone(ctx, s) !== 'trash') return;
    // "[Flow] equal to its cost": playable from the trash for its own cost this turn, then banished
    ctx.allowPlay(s, 'endOfTurn');
    afterChain(ctx, s, 'banish', 1);
  }, { targets: [trashTarget('Give a spell in your trash [Flow] equal to its cost this turn', isSpellCard)], text: 'When I conquer, give a spell in your trash [Flow] equal to its cost this turn.' }),
]);

// CR 387-389: "Then you may do this: Choose a unit in their trash and play it" is a reflexive item — the "you may" and the trash
// unit (a target, CR 355.5) are decided as it goes on the chain, after the burn; opponents may respond before the play
const kharoxPlay = reflexiveAbility('B7:kharox:play', {
  optional: 'Kharox: choose a unit in their trash and play it, ignoring its cost?',
  targets: [trashTarget('Choose a unit in their trash to play, ignoring its cost', (c, id) => isUnitCard(c, id) && c.owner(id) === c.data.opp, { any: true })],
  effect: ctx => { const u = ctx.target(0); if (u) playIt(ctx, u, { cost: 'free' }); },
  text: 'Kharox: play a unit from their trash, ignoring its cost',
});
card('ven-114-166', TXT['ven-114-166'], [
  when('empower', on.self, ctx => {
    const opp = ctx.chooseOpponent();
    ctx.burn(3, opp);
    ctx.reflexive(kharoxPlay, { opp });
  }, { text: 'When I become Empowered, choose an opponent. They Burn 3. Then you may play a unit from their trash, ignoring its cost.' }),
]);

card('ven-022-166', TXT['ven-022-166'], [
  onPlay(ctx => { ctx.banish([...ctx.hand(), ...ctx.trash()]); ctx.burn(7); }, { text: 'When you play this, banish your hand and trash, then Burn 7.' }),
  rule('skipDraw', (ctx, p: PlayerId) => p === ctx.controller, undefined, { text: 'Skip your Draw Phase.' }),
  rule('canPlayFromTrash', (ctx, p: PlayerId) => p === ctx.controller, undefined, { text: 'You may play cards from your trash.' }),
  replacement('toTrash', (ev, ctx) => typeof ev.obj === 'string' && ctx.obj(ev.obj)?.owner === ctx.controller && ev.from !== 'mainDeck',
    ev => ({ ...ev, type: 'banish' }), { text: 'If a card would go to your trash from anywhere other than your Main Deck, banish it instead.' }),
]);

card('ven-098-166', TXT['ven-098-166'], [
  costModDyn((ctx, id) => {
    if (ctx.data.payer !== ctx.controller || !isSpellCard(ctx, id) || !ctx.has(id, 'Flow')) return null;
    const viaFlow = ctx.item?.source === id && !!ctx.item.viaFlow;
    if (!viaFlow && ctx.obj(id)?.zone !== 'trash') return null;
    const e = viaFlow || ctx.obj(id)?.zone === 'trash'
      ? energyOf((def(ctx, id) as unknown as { keywordCosts?: Record<string, string> }).keywordCosts?.Flow) : ctx.energyCost(id);
    return e >= 1 ? { energy: -2, minEnergy: 1 } : null;
  }, { text: 'Spells with [Flow] you play from your trash cost [2] less, to a minimum of [1].' }),
]);

// =====================================================================================
// banish & play / look & play
// =====================================================================================

card('ogn-025-298', TXT['ogn-025-298'], [spell(ctx => {
  const revealed: ObjId[] = [];
  for (const p of ctx.opponents()) revealed.push(...topCards(ctx, 1, { reveal: true, deckOwner: p, actor: p }));
  banishPlayOneRecycleRest(ctx, revealed);
})]);

card('rad-018-167', TXT['rad-018-167'], [
  onPlay(ctx => {
    const revealed: ObjId[] = [];
    for (const p of ctx.opponents()) revealed.push(...topCards(ctx, 1, { reveal: true, deckOwner: p }));
    banishPlayOneRecycleRest(ctx, revealed);
  }, { text: 'When you play me, reveal the top card of each opponent\'s Main Deck. Choose one, banish it, then play it, ignoring its cost.' }),
]);

card('ogn-062-298', TXT['ogn-062-298'], [spell(ctx => {
  lookPick(ctx, 5, { filter: id => isUnitCard(ctx, id) && canAffordPlay(ctx, id, { reduce: 5 }), max: 1, prompt: 'You may banish a unit and play it, reducing its cost by [5]',
    with: ids => ids.forEach(id => banishThenPlay(ctx, id, { cost: { reduce: 5 } })) });
})]);

// CR 387-389: "Then you may do this: Empower it" is a reflexive item; its "you may" is decided as it goes on the chain
const wildClawEmpower = reflexiveAbility('B7:wildClaw:empower', {
  optional: 'Wild Claw: empower the card you played?',
  effect: ctx => { const u = stillObj(ctx, 'played'); if (u && ctx.onBoard(u)) ctx.empower(u); },
  text: 'Wild Claw: you may empower it',
});
card('ven-089-166', TXT['ven-089-166'], [spell(ctx => {
  let played: ObjId | undefined;
  lookPick(ctx, 5, { filter: id => unitOrGear(ctx, id) && canAffordPlay(ctx, id, { reduce: 5 }), max: 1, prompt: 'You may banish a unit or gear and play it, reducing its Energy cost by [5]',
    with: ids => ids.forEach(id => { if (banishThenPlay(ctx, id, { cost: { reduce: 5 } })) played = id; }) });
  const ref = played ? ctx.playedObj(played) : null;     // CR 354.4: enters when this spell finishes
  if (ref && !ctx.isEmpowered(played!)) ctx.reflexive(wildClawEmpower, { played: ref });
})]);

card('ogn-242-298', TXT['ogn-242-298'], [
  activated(cost('[1][C], [E]'), ctx => {
    const u = ctx.target(0);
    let m: number | null = null;
    if (u) { const before = ctx.might(u); if (ctx.kill(u).length) m = before; }
    lookPick(ctx, 5, { filter: id => m !== null && isUnitCard(ctx, id) && cardMight(ctx, id) <= m + 1, max: 1,
      prompt: 'You may banish a unit with Might up to 1 more than the killed unit and play it, ignoring its cost',
      with: ids => ids.forEach(id => banishThenPlay(ctx, id, { cost: 'free' })) });
  }, { targets: [T.unit(F.youControl, { hint: 'neutral', prompt: 'Kill a friendly unit' })], text: '[1][C], [E]: Kill a friendly unit. Look at the top 5 ...' }),
]);

card('ogn-160-298', TXT['ogn-160-298'], [
  atEndOfTurn(ctx => {
    const { revealed, hit } = revealUntil(ctx, id => isUnitCard(ctx, id));
    if (hit) banishThenPlay(ctx, hit, { cost: 'free' });
    recycleLeft(ctx, revealed.filter(id => id !== hit));
  }, { text: 'At the end of your turn, reveal until a unit; banish it and play it, ignoring its cost. Recycle the rest.' }),
]);

card('sfd-170-221', TXT['sfd-170-221'], [
  onAttack(ctx => revealTwoBanishPlay(ctx, true), { optional: 'Rek\'Sai: reveal the top 2 cards of your Main Deck?', text: 'When I attack, you may reveal the top 2 ... banish one, then play it (a unit may be played here).' }),
]);
card('sfd-187-221', TXT['sfd-187-221'], [
  when('conquer', (ev, ctx) => ev.player === ctx.controller && !ctx.isExhausted(ctx.self), ctx => revealTwoBanishPlay(ctx, false), {
    optional: 'Void Burrower: exhaust me to reveal the top 2 cards of your Main Deck?', cost: { exhaustSelf: true },
    text: 'When you conquer, you may exhaust me to reveal the top 2 ... banish one, then play it. Recycle the rest.',
  }),
]);

card('sfd-188-221', TXT['sfd-188-221'], [spell(ctx => {
  const seen = topCards(ctx, 2, { reveal: true });
  const cands = seen.filter(id => playable(ctx, id) && canAffordPlay(ctx, id, { reduce: 2 }));
  const pick = ctx.chooseCards(cands, 0, 1, 'You may banish one and play it, reducing its cost by [2]')[0];
  if (pick) banishThenPlay(ctx, pick, { cost: { reduce: 2 } });
  for (const id of seen) if (id !== pick && zone(ctx, id) === 'mainDeck') ctx.drawCard(id);
})]);

card('ogn-115-298', TXT['ogn-115-298'], [spell(ctx => {
  const banished: [PlayerId, ObjId][] = [];
  ctx.eachPlayer(p => {
    const sub = ctx.as(p);
    const seen = topCards(sub, 5, { deckOwner: p, actor: p });
    const pick = sub.chooseCards(seen, 1, 1, 'Promising Future: banish one of them (you play it later, ignoring its Energy cost)')[0];
    if (pick) { sub.banish(pick); if (zone(ctx, pick) === 'banishment') banished.push([p, pick]); }
    recycleLeft(ctx, seen.filter(id => id !== pick));
  });
  ctx.eachPlayer(p => {
    for (const [q, id] of banished) if (q === p && zone(ctx, id) === 'banishment' && playable(ctx, id)) playIt(ctx, id, { payer: p, cost: 'noEnergy' });
  }, { startWithNext: true });
})]);

// =====================================================================================
// banish & replay (blink) and play-location effects
// =====================================================================================

card('ogn-102-298', TXT['ogn-102-298'], [spell(ctx => {
  const u = ctx.target(0);
  if (u) banishThenPlay(ctx, u, { payer: ctx.owner(u), cost: 'free', dest: 'base' });
}, { targets: [T.unit(F.friendly, { hint: 'help', prompt: 'Banish a friendly unit (its owner plays it to their base)' })] })]);

card('unl-184-219', TXT['unl-184-219'], [spell(ctx => {
  const u = ctx.target(0);
  if (!u) return;
  const owner = ctx.owner(u);
  ctx.banish(u);
  if (zone(ctx, u) !== 'banishment') return;
  const bf = ctx.as(owner).chooseBattlefield(undefined, `Play ${ctx.name(u)} to which battlefield?`);
  if (bf !== undefined) playIt(ctx, u, { payer: owner, cost: 'free', dest: bf });
}, { targets: [T.unit(F.friendly, { hint: 'help', prompt: 'Banish a friendly unit (its owner plays it to any battlefield)' })] })]);

card('ven-066-166', TXT['ven-066-166'], [spell(ctx => {
  const u = ctx.target(0);
  if (!u) return;
  const l = ctx.loc(u);
  if (l === null) return;
  // N7 / VEN-FAQ #29 (T187): a unit in another player's base (stolen) is banished, but its owner can't play it to someone
  // else's base, so it stays banished
  if (l === 'base' && ctx.ctrl(u) !== ctx.owner(u)) { ctx.banish(u); return; }
  banishThenPlay(ctx, u, { payer: ctx.owner(u), cost: 'free', dest: l });
}, { targets: [T.unit({ hint: 'neutral', prompt: 'Banish a unit (its owner plays it to the same location)' })] })]);

card('rad-140-167', TXT['rad-140-167'], [
  asPlay(ctx => {
    const max = mineUnits(ctx).length;
    const n = ctx.chooseNumber(0, max, 'Chronobreak: pay how much Power (any domain) as an additional cost?');
    ctx.data.x = n;
    if (n > 0) ctx.addPlayCost({ energy: 0, power: new Array(n).fill('A') });
    // RULINGS sweep / CR 355.5: "that many units you control" are chosen as the spell is played (one at a time: they return
    // in this order), right after X
    const order: ObjId[] = [];
    for (let i = 0; i < n; i++) {
      const pick = ctx.choose(T.unit(F.youControl, (c, id) => !order.includes(id), { hint: 'neutral', prompt: `Chronobreak: banish a unit you control (${i + 1} of ${n}; they return in this order)` }))[0];
      if (pick) order.push(pick);
    }
    ctx.data.chrono = order;
  }, { text: 'As an additional cost to play this, pay any amount of Power.' }),
  spell(ctx => {
    // the chosen units that are still yours and on the board (instructions on the others are ignored, CR 359.3.e)
    const order = ((ctx.data.chrono as ObjId[] | undefined) ?? []).filter(u => ctx.onBoard(u) && ctx.ctrl(u) === ctx.controller);
    const locs = new Map(order.map(u => [u, ctx.loc(u)] as const));
    ctx.banish(order);
    for (const u of order) {
      if (zone(ctx, u) !== 'banishment') continue;
      const owner = ctx.owner(u);
      const l = locs.get(u);
      const dest: Destination = typeof l === 'number' ? (ctx.as(owner).chooseLocation([l, 'base'], `Play ${ctx.name(u)} back to`) ?? 'base') : 'base';
      playIt(ctx, u, { payer: owner, cost: 'free', dest });
    }
  }),
]);

card('ogn-107-298', TXT['ogn-107-298'], [
  // the leading "you may pay [C]" is decided and paid as the trigger goes on the chain (CR 383.3.a-b, principle 11); "here" is read
  // on resolution — Ava gone → a unit can't be played (CR 359.3.f, principle 17; RJ#4262)
  onAttack(ctx => {
    const here = ctx.onBoard(ctx.self) ? ctx.here() : null;
    const cands = ctx.hand().filter(id => hasHidden(ctx, id) && playable(ctx, id) && (!isUnitCard(ctx, id) || typeof here === 'number'));
    const pick = ctx.chooseCards(cands, 1, 1, 'Ava Achiever: play a card with [Hidden] from your hand, ignoring its cost')[0];
    if (!pick) return;
    playIt(ctx, pick, { cost: 'free', dest: isUnitCard(ctx, pick) && typeof here === 'number' ? here : undefined });
  }, {
    optional: 'Ava Achiever: pay [C] to play a card with [Hidden] from your hand, ignoring its cost?',
    cost: cost('[C]'),
    offerIf: ctx => ctx.hand().some(id => hasHidden(ctx, id) && playable(ctx, id)),
    text: 'When I attack, you may pay [C] to play a card with [Hidden] from your hand, ignoring its cost. If it\'s a unit, play it here.',
  }),
]);

card('rad-115-167', TXT['rad-115-167'], [
  activated(cost('[C], [T]'), ctx => {
    const u = ctx.target(0);
    if (!u) return;
    let m = ctx.might(u);
    // the play doesn't depend on the return (no "if you do"); a return replaced so the unit stays (empowered Gangplank, Naval
    // gets +3 instead) reads the Might it has then (RJ#12864, house — RJ adopted; ENGINE-9)
    if (!ctx.returnToHand(u).length && ctx.onBoard(u)) m = ctx.might(u);
    const cands = ctx.hand().filter(id => isUnitCard(ctx, id) && cardMight(ctx, id) < m);
    const pick = ctx.chooseCards(cands, 0, 1, `You may play a unit with less than ${m} Might, ignoring its cost`)[0];
    if (pick) playIt(ctx, pick, { cost: 'free' });
  }, { targets: [T.unit(F.friendly, { hint: 'neutral', prompt: 'Return a friendly unit to its owner\'s hand' })], text: '[C], [T]: Return a friendly unit to its owner\'s hand. You may play a unit with less Might, ignoring its cost.' }),
]);

card('sfd-111-221', TXT['sfd-111-221'], [spell(ctx => {
  // played from hiding: the unit must be played at that battlefield (CR 811.1.d.5; RJ#10941)
  const hb = ctx.hiddenPlayBattlefield();
  const bfs = ctx.controlledBattlefields().filter(b => hb === undefined || b === hb);
  if (!bfs.length) return;
  // only units that can be played to one of those battlefields (Perched Grimwyrm: only where you conquered this turn; RJ#3497)
  const cands = ctx.hand().filter(id => isUnitCard(ctx, id) && canAffordPlay(ctx, id, { reduce: 3 }, ctx.controller, bfs));
  const bfsFor = (id: ObjId) => bfs.filter(b => canAffordPlay(ctx, id, { reduce: 3 }, ctx.controller, [b]));
  const pick = ctx.chooseCards(cands, 0, 1, 'You may play a unit from hand to a battlefield you control, reducing its cost by [3]')[0];
  if (!pick) return;
  const ok = bfsFor(pick);
  const bf = ok.length === 1 ? ok[0] : ctx.chooseBattlefield(b => ok.includes(b), `Play ${ctx.name(pick)} to`);
  if (bf !== undefined) playIt(ctx, pick, { cost: { reduce: 3 }, dest: bf });
})]);

const JAYCE = delayedAbility('B7:jayceGear', costModDyn((ctx, id) =>
  ctx.data.payer === ctx.controller && ctx.type(id) === 'Gear' && (def(ctx, id)?.energy ?? 0) <= 7 ? { energy: -ctx.energyCost(id) } : null,
  { text: 'Jayce: play a gear (Energy ≤ [7]) ignoring its Energy cost' }));
card('sfd-084-221', TXT['sfd-084-221'], [
  onPlay(ctx => {
    const g0 = ctx.target(0);
    if (g0 && ctx.kill(g0).length) ctx.delay(JAYCE, {}, 'endOfTurn', 1);
  }, { targets: [T.upTo(1, T.gear(F.youControl, { hint: 'neutral', prompt: 'You may kill a friendly gear' }))], text: 'When you play me, you may kill a friendly gear. If you do, you may play a gear (Energy ≤ [7]) from hand this turn, ignoring its Energy cost.' }),
]);

const LC_BUFF = delayedAbility('B7:lastCaressBuff', whenYouPlay(F.unit, ctx => { const u = ctx.event?.obj as ObjId; if (u && ctx.onBoard(u)) ctx.buff(u); }, { text: 'Last Caress: buff it' }));
const LC_DEST = delayedAbility('B7:lastCaressDest', playRule(
  (ctx, id) => ctx.type(id) === 'Unit' && ctx.g.ex.delayed.some(d => d.key === LC_BUFF && d.data.tag === ctx.data.tag),
  { extraDestinations: ctx => ctx.battlefields(), hiddenToo: true },   // "even from face down"
));
card('rad-154-167', TXT['rad-154-167'], [spell(ctx => {
  const tag = `lc${ctx.g.timestamp}`;
  ctx.delay(LC_BUFF, { tag }, 'endOfTurn', 1);
  ctx.delay(LC_DEST, { tag }, 'endOfTurn');
})]);

// =====================================================================================
// Hidden-themed
// =====================================================================================

card('ogn-057-298', TXT['ogn-057-298'], [spell(E.keyword(0, ['Shield 3', 'Tank']), { targets: [T.unit({ hint: 'help', prompt: 'Give a unit [Shield 3] and [Tank] this turn' })] })]);

card('ogn-220-298', TXT['ogn-220-298'], [spell(ctx => {
  ctx.stun([...ctx.targetsOf(0), ...ctx.targetsOf(1)]);
}, { targets: [
  T.unit(F.friendly, F.atBattlefield, (c, id) => c.units(u => c.isEnemy(u) && c.loc(u) === c.loc(id)).length > 0, { hint: 'neutral', prompt: 'Stun a friendly unit (at a battlefield with an enemy unit)' }),
  T.unit(F.enemy, F.atBattlefield, (c, id) => { const f = chosenSoFar(c, 0)[0]; return !f || c.loc(f) === c.loc(id); }, { hint: 'harm', prompt: 'Stun an enemy unit at the same battlefield' }),
] })]);

card('rad-095-167', TXT['rad-095-167'], [
  onPlay(ctx => ctx.giveKeyword(ctx.self, 'Temporary', 'permanent'), { if: C.notMyTurn, text: 'When you play me, if it\'s not your turn, give me [Temporary].' }),
]);

card('rad-103-167', TXT['rad-103-167'], [
  asPlay(ctx => { ctx.showOff(id => hasHidden(ctx, id), 'Show off a card with [Hidden]?'); }, { text: 'Show Off a card with [Hidden]' }),
  onPlay(E.add(0, ['any']), { isAdd: true, if: ctx => !!playData(ctx).shownOff, text: 'When you play me, if you showed off, [Add] [A].' }),
], { keywords: ['Hidden', 'Show Off'] });

card('rad-107-167', TXT['rad-107-167'], [
  onPlay(ctx => {
    const bf = bfIndexOf(ctx, ctx.target(0));
    if (bf === undefined || ctx.unitsAt(bf).length < 4) return;
    // RULINGS: CR 403.2 / 355.5 — the enemy unit is a target chosen with the battlefield; "you may" = up to one
    const u = ctx.target(1);
    if (u && ctx.loc(u) === bf) ctx.returnToHand(u);
  }, { targets: [T.battlefield({ prompt: 'Choose a battlefield' }),
    // (trigger target filters don't see earlier groups through ctx.target yet — R-14 — so read the item being built)
    T.upTo(1, T.unit(F.enemy, (c, id) => { const b = bfIndexOf(c, c.target(0) ?? c.item?.targets?.[0]?.[0]); return b !== undefined && c.loc(id) === b; }, { hint: 'harm', prompt: 'You may return an enemy unit there to its owner\'s hand (if 4+ units are there)' }))], text: 'When you play me, choose a battlefield. If there are 4+ units there, you may return an enemy unit there to its owner\'s hand.' }),
]);

card('sfd-138-221', TXT['sfd-138-221'], [
  onPlay(E.returnToHand(0), { targets: [T.upTo(1, T.unit(F.other, F.atBattlefield, F.mightAtMost(3), { hint: 'harm', prompt: 'You may return another unit at a battlefield with 3 [S] or less to its owner\'s hand' }))],
    text: 'When you play me, you may return another unit at a battlefield with 3 [S] or less to its owner\'s hand.' }),
], { keywords: ['Hidden'] });

card('ven-117-166', TXT['ven-117-166'], [
  selfKeyword('Shield 3', { if: ctx => { const l = ctx.loc(ctx.self); return typeof l === 'number' && ctx.unitsAt(l, u => u !== ctx.self && ctx.ctrl(u) === ctx.controller).length === 1; },
    text: 'I have [Shield 3] while I\'m at a battlefield with exactly one other unit you control.' }),
]);

// =====================================================================================
// Repeat / Flow spells and misc
// =====================================================================================

card('sfd-003-221', TXT['sfd-003-221'], [spell(E.keyword(0, 'Assault 2'), { targets: [T.unit({ hint: 'help', prompt: 'Give a unit [Assault 2] this turn' })] })]);
card('sfd-040-221', TXT['sfd-040-221'], [spell(E.stun(0), { targets: [T.unit(F.attacking, { hint: 'harm', prompt: 'Stun an attacking unit' })] })]);
card('ven-012-166', TXT['ven-012-166'], [spell(ctx => {
  const t = ctx.target(0);
  if (!t) return;
  ctx.ready(t);
  ctx.giveKeyword(t, 'Assault 3');
}, { targets: [T.unit({ hint: 'help', prompt: 'Ready a unit and give it [Assault 3] this turn' })] })]);
card('ven-105-166', TXT['ven-105-166'], [spell(E.moveToChosen(0, 1),
  { targets: [T.unit(F.mightAtMost(3), { hint: 'neutral', prompt: 'Move a unit with 3 [S] or less' }), T.destination(F.moveDestFor(0), { prompt: 'Move it to' })] })]);   // R-2
card('ven-144-166', TXT['ven-144-166'], [spell(ctx => {
  ctx.burn(3);
  ctx.createToken('Shadow Clone', 'base', { might: 0 });
})]);

card('rad-124-167', TXT['rad-124-167'], [spell(ctx => {
  ctx.banish(ctx.targetsOf(0));
  ctx.burn(2);
}, { targets: [T.permanent((c, id) => (c.isUnit(id) && c.might(id) <= 3) || (c.isGear(id) && !c.isUnit(id)), { hint: 'harm', prompt: 'Banish a unit with 3 [S] or less or a gear' })] })]);

card('ven-002-166', TXT['ven-002-166'], [
  onMove(ctx => { const p = ctx.choosePlayer('Choose a player: they Burn 1'); if (p !== undefined) ctx.burn(1, p); }, { oncePerTurn: 1, text: 'The first time I move each turn, choose a player. They Burn 1.' }),
]);

card('ven-095-166', TXT['ven-095-166'], [
  // RULINGS sweep / CR 383.3.b: [Burn 1] is the trigger's base cost, paid as it goes on the chain
  onMove(ctx => { ctx.giveMight(ctx.self, 1); }, {
    optional: 'Burn 1 to give Shadow Order Disciple +1 [S] this turn?',
    cost: cost('', pay.custom('Burn 1', () => true, c => { c.burn(1); return true; })),
    text: 'When I move, you may Burn 1 to give me +1 [S] this turn.',
  }),
]);

// CR 387-389: "When you burn a unit this way, do this: Give a friendly unit +[S] …" is a reflexive item; the friendly unit is its
// target, chosen as it goes on the chain; the burned card's Might is locked in as it is burned
const relicMight = reflexiveAbility('B7:forgottenRelic:might', {
  targets: [T.unit(F.friendly, { hint: 'help', prompt: "Give a friendly unit +[S] equal to the burned card's Might this turn" })],
  effect: ctx => { const u = ctx.target(0), m = Number(ctx.data.m ?? 0); if (u && m) ctx.giveMight(u, m); },
  text: "Forgotten Relic: give a friendly unit +[S] equal to the burned card's Might this turn",
});
const relic = (ctx: Ctx) => {
  const id = ctx.burn(1)[0];
  if (!id || !isUnitCard(ctx, id)) return;
  ctx.reflexive(relicMight, { m: cardMight(ctx, id) });
};
card('ven-108-166', TXT['ven-108-166'], [
  onPlay(relic, { text: 'When you play this, Burn 1 (a burned unit gives a friendly unit +[S] equal to its Might).' }),
  atStartOfBeginning(relic, { text: 'At the start of your Beginning Phase, Burn 1 (a burned unit gives a friendly unit +[S]).' }),
]);

card('ven-101-166', TXT['ven-101-166'], [
  // RULINGS sweep / CR 383.3.b: "banish a card from any trash to …" is the trigger's base cost, paid (or declined) as it goes on
  // the chain, after its target is chosen; the keyword is given on resolution
  onPlay(ctx => {
    const t = ctx.target(0);
    if (t) ctx.giveKeyword(t, 'Assault 2');
  }, { if: ctx => !!playData(ctx).paidAdditional, targets: [T.unit({ hint: 'help', prompt: 'Give a unit [Assault 2] this turn' })],
    optional: 'Gust Monk: banish a card from any trash to give a unit [Assault 2] this turn?',
    cost: cost('', pay.custom('Banish a card from any trash', c => c.g.players.some(p => p.trash.length > 0), c => {
      const pick = c.chooseCards(c.g.players.flatMap(p => p.trash), 1, 1, 'Banish a card from any trash')[0];
      return !!pick && c.banish(pick).length === 1;
    })),
    text: 'When you play me, if you paid the additional cost, banish a card from any trash to give a unit [Assault 2] this turn.' }),
], { additionalCosts: [{ cost: cost('[1]'), optional: true, label: 'Pay [1] as an additional cost' }] });

card('rad-015-167', TXT['rad-015-167'], [
  when('move', (ev, ctx) => ev.obj === ctx.self && ctx.bump(`B7:akaliMoves:${ctx.self}#${ctx.obj(ctx.self)?.epoch ?? 0}`) === 1, E.add(1, ['any']),
    { isAdd: true, text: 'The first time I move each turn, [Add] [1][A].' }),
  when('move', (ev, ctx) => ev.obj === ctx.self && ctx.count(`B7:akaliMoves:${ctx.self}#${ctx.obj(ctx.self)?.epoch ?? 0}`) === 2, ctx => {
    const top = ctx.deck()[0];
    if (!top) return;
    ctx.banish(top);
    if (zone(ctx, top) === 'banishment') ctx.allowPlay(top, 'nextEnding');
  }, { text: 'The second time I move each turn, banish the top card of your Main Deck. Until your next Ending Phase, you may play that card.' }),
]);

// ---- battlefields (the battlefield object keeps its owner as controller: act for the event's player) ----

card('sfd-212-221', TXT['sfd-212-221'], [
  when('conquer', (ev, ctx) => ev.bf === ctx.bfIndex(), ctx => ctx.as(evPlayer(ctx)).burn(2), { text: 'When you conquer here, put the top 2 cards of your Main Deck into your trash.' }),
]);
card('ven-165-166', TXT['ven-165-166'], [
  when('hold', (ev, ctx) => ev.bf === ctx.bfIndex(), ctx => ctx.as(evPlayer(ctx)).burn(3), { text: 'When you hold here, Burn 3.' }),
]);
card('sfd-215-221', TXT['sfd-215-221'], [
  when('playerDefend', (ev, ctx) => ev.bf === ctx.bfIndex() && ctx.g.battlefields[ctx.bfIndex()]?.controller === ev.player, ctx => {   // CR 190.6.d
    revealTopThen(isSpellCard, (c, id) => c.toHand(id))(ctx.as(evPlayer(ctx)));
  }, { text: 'When you defend here, reveal the top card. If it\'s a spell, put it in your hand. Otherwise, recycle it.' }),
]);
card('unl-211-219', TXT['unl-211-219'], [
  when('play', (ev, ctx) => {
    const bf = ctx.bfIndex();
    return bf >= 0 && ev.cardType === 'Spell' && typeof ev.player === 'number' && ctx.bfController(bf) === ev.player
      && !!ctx.obj(ev.obj as ObjId) && Number(((ev as { paid?: { energy?: number } } | undefined)?.paid?.energy) ?? 0) >= 4;   // RULINGS: Energy actually paid
  }, ctx => ctx.as(evPlayer(ctx)).predict(1), { text: 'While you control this battlefield, when you play a spell, if you spent [4] or more, Predict.' }),
]);

void onConquerHere; void onHoldHere; void onDefendHere; void selfMight; void statik; void pay; void cardMight; void PREVENT_NEXT;

card('ogn-109-298', TXT['ogn-109-298'], [
  selfMight(ctx => ctx.trash().length, { text: 'My Might is increased by the number of cards in your trash.' }),
  atStartOfBeginning(ctx => {
    const tr = ctx.trash();
    const k = Math.min(3, tr.length);
    if (k) ctx.recycle(ctx.chooseCards(tr, k, k, 'Recycle 3 from your trash'));
  }, { text: 'At the start of your Beginning Phase, recycle 3 from your trash.' }),
]);

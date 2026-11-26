// Card-text analyser (CARD-ANALYSIS agent).
// Tokenises every card's effective rules text into abilities and classifies each one with pattern ids.
// Output: data/card-analysis.json   (per card id -> parsed abilities + pattern ids)
//         data/card-patterns.json   (pattern catalogue: id -> count, example card ids)
//         data/card-batches.json    (scripting batches, see docs/card-batches.md)
// Run: npx tsx tools/analyze-cards.ts
//
// Symbol normalisation (see docs/card-patterns.md legend): [T]->[E] (exhaust), [S]->[M] (Might).
// Old-style keyword separator " — " after a keyword is normalised to "[>]".
import { readFileSync, writeFileSync } from 'node:fs';

interface Card {
  id: string; name: string; subtitle?: string; type: string; supertypes: string[]; tags: string[];
  domains: string[]; energy: number | null; power: number | null; might: number | null;
  keywords: string[]; text: string; set: string;
}

// ---------------------------------------------------------------------------------------------
// Keyword vocabulary
// ---------------------------------------------------------------------------------------------
/** Keywords that are complete abilities by themselves (engine implements them generically). */
export const ABILITY_KEYWORDS = [
  'Accelerate', 'Action', 'Ambush', 'Assault', 'Backline', 'Deflect', 'Deploy', 'Disarm', 'Ganking',
  'Hidden', 'Hunt', 'Quick-Draw', 'Reaction', 'Shield', 'Tank', 'Temporary', 'Unique', 'Vision', 'Weaponmaster',
] as const;
/** Keywords that carry a cost after them ("[Equip] [1][C]", "[Empower] — Discard 1", "[Repeat] [2]", "[Flow] [4][C]"). */
export const COST_KEYWORDS = ['Equip', 'Empower', 'Repeat', 'Flow'] as const;
/** Keywords that prefix another ability: dependent (condition), triggered, or permissive. */
export const PREFIX_KEYWORDS: Record<string, 'dependent' | 'trigger' | 'permission'> = {
  Legion: 'dependent', Level: 'dependent', Empowered: 'dependent', Mighty: 'dependent',
  Deathknell: 'trigger', Action: 'permission', Reaction: 'permission',
};
/** Keyword actions used inside effects. */
export const KEYWORD_ACTIONS = ['Buff', 'Stun', 'Predict', 'Burn', 'Add', 'Empower', 'Show Off'] as const;

export const KW_DESC: Record<string, string> = {
  Accelerate: 'Optional additional cost [1][C]: enters ready.', Action: 'Play on your turn or in showdowns.',
  Ambush: 'May be played as a [Reaction] to a battlefield where you have units.', Assault: 'Assault N: +N Might while attacking.',
  Backline: 'Must be assigned combat damage last.', Deflect: 'Deflect N: opponents pay N x [A] to choose this with a spell/ability.',
  Deploy: 'Play only to a battlefield; kill this when an opponent holds there.', Disarm: 'Disarm N: when I attack, give an enemy unit here -N Might this turn.',
  Ganking: 'Can move battlefield to battlefield.', Hidden: 'Hide face down for [A]; later play it for [0] as a reaction.',
  Hunt: 'Hunt N: when I conquer or hold, gain N XP.', 'Quick-Draw': 'Has [Reaction]; when played, attach to a unit you control.',
  Reaction: 'Play any time, even before spells/abilities resolve.', Shield: 'Shield N: +N Might while defending.',
  Tank: 'Must be assigned combat damage first.', Temporary: 'Kill at the start of its controller\'s Beginning Phase, before scoring.',
  Unique: 'Deck may contain only 1 card with this name.', Vision: 'On play, look at top card of Main Deck; may recycle it.',
  Weaponmaster: 'On play, may Equip one of your Equipment to me for [A] less, even if attached.',
  Equip: 'Equip COST: attach this Equipment to a unit you control (cost may be non-mana / reduced).',
  Empower: 'Empower COST: empower this (use only if not Empowered).', Repeat: 'Repeat COST: optional additional cost to repeat the spell\'s effect (new choices allowed).',
  Flow: 'Flow COST: may play this from your trash for its Flow cost, then banish it.', 'Show Off': 'As you play, may reveal a matching card from hand or pick a friendly one on board.',
};
export const PREFIX_DESC: Record<string, string> = {
  Legion: 'Dependent: active if you\'ve played another card this turn.', Level: 'Dependent: active while you have N+ XP.',
  Empowered: 'Dependent: active while this is Empowered.', Mighty: 'Dependent: active while Mighty (5+ Might).',
  Deathknell: 'Keyword trigger: when I die, get the effect.', Action: 'Permission: this ability may be used at Action timing.',
  Reaction: 'Permission: this ability may be used at Reaction timing.',
};
export const KIND_DESC: Record<string, string> = {
  keyword: 'Line made only of keyword abilities.', 'keyword-cost': 'Keyword followed by its cost (Equip / Empower / Repeat / Flow).',
  triggered: 'Triggered ability (When / At / The first time / [Deathknell]).', activated: 'Activated ability (COST: EFFECT).',
  static: 'Continuous ability on a permanent.', replacement: 'Replacement / prevention effect on a permanent ("would ... instead").',
  'spell-effect': 'Spell resolution text (incl. spell-created delayed triggers and shields).',
  'play-modifier': 'Affects how the card is played: additional/alt/X costs, cost changes, play location, enters ready/exhausted.',
  reminder: 'Rules-reminder pseudo-card text (no script).',
};

// ---------------------------------------------------------------------------------------------
// Pattern tables. Each entry: id, category, regex tested against the (normalised) text it applies to.
// ---------------------------------------------------------------------------------------------
type Cat = 'trigger' | 'effect' | 'condition' | 'duration' | 'cost' | 'static' | 'replacement' | 'play' | 'zone' | 'choice' | 'scaling';
interface Pat { id: string; cat: Cat; re: RegExp; desc: string }

const P = (cat: Cat, id: string, re: RegExp, desc: string): Pat => ({ id: `${cat}:${id}`, cat, re, desc });

// Trigger events, matched against the trigger clause ("When I attack or defend", "At the start of your Beginning Phase", ...)
const TRIGGERS: Pat[] = [
  P('trigger', 'play-self', /when you play or move this|\bwhen (?:you play (?:me|this)|i'm played|this is played)|when you play (?:me|this) or\b|^when you play me\b/i, 'This card is played (ETB / on-play). "When you play me/this".'),
  P('trigger', 'play-self-from-facedown', /when you play me from face ?down|when you play this from face ?down/i, 'This card is played from face down (Hidden).'),
  P('trigger', 'play-self-to-battlefield', /when you play me to a battlefield/i, 'This unit is played to a battlefield (not base).'),
  P('trigger', 'play-card', /or another dragon|when a friendly unit is played|when (?:you|a player|an opponent|you or an ally) plays? (?:a|an|your|another|one|the)? ?(?:card|spell|unit|gear|token|\[mighty\]|non-token|dragon|second|first)/i, 'A player plays a card matching a filter (spell / unit / gear / cost >= N / from face down / on opponent turn).'),
  P('trigger', 'play-card-nth', /(?:play your (?:second|first) card|first time (?:you|a player|they) plays?|the next (?:three )?times? you play|first friendly non-token gear played|first unit or gear they play)/i, 'Nth card played this turn (first/second), or the next N plays.'),
  P('trigger', 'play-from-facedown', /when you play a card from (?:face ?down|\[hidden\])|once each turn, when you play a card from face down/i, 'You play any card from face down.'),
  P('trigger', 'play-from-nonhand', /play a card from anywhere other than your hand/i, 'You play a card from a zone other than hand.'),
  P('trigger', 'attack', /\bwhen (?:i|a friendly unit|one or more friendly units|an enemy unit) attacks?\b|when i attack or defend|or i attack\b|when i attack while/i, 'A unit attacks (declares/moves as attacker).'),
  P('trigger', 'defend', /when (?:i|you) defend|attack or defend|attacks or defends/i, 'A unit / you defend at a battlefield.'),
  P('trigger', 'combat-start', /when combat starts here|when a showdown begins here/i, 'Combat or showdown begins at a battlefield.'),
  P('trigger', 'combat-end', /when a combat that i was in ends/i, 'A combat this unit was in ends.'),
  P('trigger', 'win-combat', /win(?:s)? a combat/i, 'A unit / you win a combat.'),
  P('trigger', 'conquer', /\bconquer/i, 'Conquer a battlefield (self, any friendly, or "here" on battlefields).'),
  P('trigger', 'hold', /\bhold(?:s)?\b/i, 'Hold a battlefield during Beginning Phase scoring.'),
  P('trigger', 'score', /when (?:i|an opponent|you) scores?\b|when you score here/i, 'A player (or this unit) scores a point.'),
  P('trigger', 'move', /play or move this|\b(?:when|time) (?:i|a unit|a friendly unit|an opponent) moves?\b(?! an enemy)|when i move (?:to|from)|when a unit moves from here|moves to a battlefield/i, 'A unit moves (to / from a battlefield or location).'),
  P('trigger', 'you-move-enemy', /when you move an enemy unit/i, 'You move an enemy unit.'),
  P('trigger', 'die', /\bdies?\b|\bdied\b|\[deathknell\]|or killed/i, 'A unit / gear dies (self = Deathknell, friendly, enemy, buffed, stunned, "first time each turn").'),
  P('trigger', 'kill', /when you kill/i, 'You kill a unit (with a spell / a stunned enemy).'),
  P('trigger', 'leaves-board', /leaves the board/i, 'This leaves the board.'),
  P('trigger', 'discard', /when (?:you discard|this is played, discarded)/i, 'You discard (this card / one or more cards).'),
  P('trigger', 'draw', /when you draw/i, 'You draw (e.g. your second card each turn, 1+ with 9+ in hand).'),
  P('trigger', 'stun', /when you (?:\[?stun\]?)/i, 'You stun one or more enemy units.'),
  P('trigger', 'buff', /when you buff/i, 'You buff a unit.'),
  P('trigger', 'spend-buff', /when you spend a buff/i, 'You spend a buff.'),
  P('trigger', 'become-exhausted', /becomes? exhausted|is exhausted|when you exhaust three|exhaust three or more friendly units/i, 'A unit becomes exhausted.'),
  P('trigger', 'become-ready', /when (?:i|you) (?:become ready|ready)|when you choose or ready me|when i become ready/i, 'A unit becomes ready.'),
  P('trigger', 'become-mighty', /becomes? \[mighty\]|when my might becomes/i, 'A unit becomes Mighty / reaches Might N.'),
  P('trigger', 'might-reduced', /when you reduce the might/i, 'You reduce an enemy unit\'s Might.'),
  P('trigger', 'chosen', /when (?:you|a player) chooses? (?:a friendly unit|me)|when you choose a friendly unit|when you choose me/i, 'A unit is chosen (targeted) by a spell/ability.'),
  P('trigger', 'take-damage', /takes damage/i, 'A unit takes damage.'),
  P('trigger', 'empower', /when (?:i become \[empowered\]|you empower)/i, 'Something becomes Empowered / you empower something.'),
  P('trigger', 'banish', /when you banish/i, 'You banish a card you own.'),
  P('trigger', 'hide', /when you hide/i, 'You hide a card (Hidden).'),
  P('trigger', 'attach', /when you attach/i, 'You attach an Equipment.'),
  P('trigger', 'recycle', /when you recycle/i, 'You recycle a rune / cards to your Main Deck.'),
  P('trigger', 'returned-to-hand', /is returned to a player's hand/i, 'A unit is returned to hand.'),
  P('trigger', 'use-gear-ability', /activated ability of a gear/i, 'You use a gear activated ability.'),
  P('trigger', 'gain-control', /gains? control/i, 'Control changes.'),
  P('trigger', 'phase-beginning', /at the start of your beginning phase|start of (?:each player's|your|each|my controller's)? ?(?:first )?beginning phase/i, 'Start of (your/each player\'s / first) Beginning Phase.'),
  P('trigger', 'phase-main', /start of (?:your|your next) main phase/i, 'Start of your Main Phase (incl. delayed "next Main Phase").'),
  P('trigger', 'phase-end', /(?:at the )?end of (?:your |this )?turn|at end of turn/i, 'End of your turn / end of this turn (delayed).'),
  P('trigger', 'revealed-from-deck', /as (?:i'm|you look at or reveal me)|revealed from your deck/i, 'This card is looked at / revealed from the top of a deck.'),
];

// Effect verbs, matched against effect text.
const EFFECTS: Pat[] = [
  P('effect', 'deal-damage', /\bdeals? \d+(?! bonus)|\bdeal \d+ (?:to|damage)|deal 1 to (?:that|them)|\bdeal 2 to\b/i, 'Deal N damage to target(s).'),
  P('effect', 'deal-damage-variable', /deals? damage equal to|deal (?:its|that much|that)|deal damage to a unit equal|deals? \w+ damage|deal 1 to that unit for each|deal 2 to it for each/i, 'Deal damage equal to a value (Might, Energy cost, Shield, X, excess, marked damage).'),
  P('effect', 'split-damage', /split among/i, 'Deal N damage divided among targets (player assigns).'),
  P('effect', 'fight', /damage equal to (?:their|our) mights? to each other/i, 'Two units deal damage equal to their Might to each other (fight).'),
  P('effect', 'bonus-damage', /bonus damage/i, 'Bonus Damage modifier (+N to each instance).'),
  P('effect', 'double-damage', /double all damage/i, 'Double damage dealt to a unit.'),
  P('effect', 'prevent-damage', /prevent (?:it|all|the next)|don't take damage|can't be dealt damage/i, 'Prevent damage.'),
  P('effect', 'kill', /(?<!(?:this|if this|unit this) )\bkills?\b(?! (?:this|me)\b)(?! it(?:'s| would))/i, 'Kill (destroy) a unit / gear / tokens.'),
  P('effect', 'kill-self', /\bkill (?:this|me)\b/i, 'Kill this card (self-sacrifice).'),
  P('effect', 'stun', /\[?stun\]? (?:a|an|it|the|one|that|all|enemy)\b|\bstun it\b/i, 'Stun a unit (no combat damage this turn).'),
  P('effect', 'buff', /(?<!(?:spend|spent) (?:a|its|my|any number of) )(?<!\+1 \[m\] )\[?buff\]? (?:a|an|me|it|all|up to|another|that|the|your|its|him|them)\b(?! buff)/i, 'Buff: give a +1 Might buff counter if it has none.'),
  P('effect', 'spend-buff', /spend (?:a|its|my|any number of) buffs?|spend a buff/i, 'Spend (remove) a buff as cost or effect.'),
  P('effect', 'ready', /\bready (?:a|an|it|me|him|another|up to|your|all|the|that|something|them|2|both)\b/i, 'Ready (untap) a unit / gear / rune / legend.'),
  P('effect', 'exhaust', /(?<!additional cost to play this, |may )\bexhaust (?:a|an|it|all|me|the|that|this)\b|ready or exhaust/i, 'Exhaust (tap) something as an effect.'),
  P('effect', 'move', /(?<!when (?:i|you) |time i |when a unit |when a friendly unit |opponents must pay \[1\]\[a\] to |to )\bmoves? (?:a|an|it|me|up to|any number|all|the|your|that|each|another|enemy|one)\b/i, 'Move unit(s) to a battlefield / base / location.'),
  P('effect', 'to-base', /to (?:its|their|my|your) base|in(?:to)? your base/i, 'Destination is base (play token / move / play card to base).'),
  P('effect', 'recall', /\brecall/i, 'Recall: send unit to base (not a move).'),
  P('effect', 'swap-locations', /each other's locations|move each to the other's location|move me to its location and it to my original/i, 'Swap two units\' locations.'),
  P('effect', 'return-to-hand', /return(?:s)? (?:a|an|it|me|this|another|all|up to|any number|that|the)?.*?to (?:its|their|my|your|his)? ?owners?'? ?(?:'s)? ?hands?|returns? (?:me|this|it) to (?:my|its) owner's hand|return this to its owner's hand|return me to my owner's hand|put a teemo unit .* into your hand|return it to their hand/i, 'Return a card on the board / chain to owner\'s hand (bounce).'),
  P('effect', 'return-from-trash', /return (?:a|up to|it|this|that)? ?.*?from (?:your|their)? ?trash(?:es)? to (?:your|their|its) (?:hand|owners' hands|champion zone)|from trashes to their owners' hands/i, 'Return card(s) from trash to hand.'),
  P('effect', 'draw', /\bdraws? (?:\d|one|it|that|any|a card|them|two)\b|\bdraw 1\b/i, 'Draw card(s).'),
  P('effect', 'discard', /\bdiscards? (?:\d|that|their|your|a|one)/i, 'Discard card(s) (chooser varies).'),
  P('effect', 'channel', /\bchannels? (?:\d|that|one|two|1)/i, 'Channel rune(s) from rune deck (usually exhausted).'),
  P('effect', 'recycle', /\brecycles?\b/i, 'Recycle: put a card on the bottom of its owner\'s deck (main or rune).'),
  P('effect', 'banish', /\bbanish(?:es)?\b/i, 'Banish a card (exile).'),
  P('effect', 'play-token', /play (?:a|an|two|three|four|that many|\d|one)? ?(?:ready )?(?:\[?\d\]? \[m\] )?(?:recruit|gold|mech|bomb|sprite|bird|sand soldier|shadow clone|tentacle|reflection)\b|play (?:a|two|three|four) .*tokens?|plays? a gold gear token|bomb tokens/i, 'Create a token (Recruit, Gold, Mech, Bomb, Sprite, Bird, Sand Soldier, Shadow Clone, Tentacle, Reflection).'),
  P('effect', 'play-card-from-zone', /(?<!(?:cost|costs) to )\bplays? (?:it|that card|that unit|those cards|the banished card|a unit (?:from|with|costing|banished)|a spell from|(?:me|this) (?:from|for|back)|an equipment with|all units banished|up to 3 units|a card with \[hidden\]|this spell again|them|a gear with|that unit back)\b|\bplay (?:it|them)\b/i, 'Play a card from a non-hand zone or out of turn as an effect (trash, banished, deck, hand-as-effect).'),
  P('effect', 'ignore-cost', /ignoring (?:its|their|any and all|energy)? ?(?:energy )?costs?|without paying its energy cost|ignore this spell's cost|hide ignoring costs/i, 'Play ignoring cost (or part of it).'),
  P('effect', 'reduce-play-cost', /reducing its (?:energy )?cost by|reduce its energy cost by|reduce the cost of the next/i, 'Play with an explicit cost reduction.'),
  P('effect', 'might-plus', /\+(?:\d+|\[m\]) \[m\]|\+\[m\]|additional \+1 \[m\]/i, 'Give +N Might (usually this turn).'),
  P('effect', 'might-minus', /-(?:\d+ )?\[m\]|–\[m\]/i, 'Give -N Might (usually this turn).'),
  P('effect', 'might-min-1', /to a minimum of 1 \[m\]/i, 'Might reduction floored at 1.'),
  P('effect', 'double-might', /double (?:a|my|its|a friendly) (?:unit's )?might|double my might/i, 'Double a unit\'s Might.'),
  P('effect', 'swap-might', /swap the mights/i, 'Swap Mights of two units.'),
  P('effect', 'set-base-might', /base might becomes?/i, 'Set base Might to a value.'),
  P('effect', 'set-might-to-other', /increase (?:its|my) might to/i, 'Increase Might to match another unit.'),
  P('effect', 'grant-keyword', /\bgive (?:it|me|a|an|them|your|one|friendly|another|that|units|him|the)? ?.*?\[(?:assault|ganking|tank|shield|deflect|temporary|accelerate|reaction|repeat|flow|action)\b|gains? \[shield|have \[accelerate\]|give it \[ganking\]|give it \[temporary\]/i, 'Give a keyword (usually this turn): Assault N, Ganking, Tank, Shield N, Deflect, Temporary, Repeat, Flow.'),
  P('effect', 'grant-ability', /(?:give|have|has) (?:a friendly unit |it |that unit |them )?"|this turn, that unit has "|give it "/i, 'Grant a quoted ability.'),
  P('effect', 'counter', /\bcounter (?:a|an|it|that)/i, 'Counter a spell / ability on the chain.'),
  P('effect', 'gain-control-spell', /gain control of (?:a spell|it)/i, 'Gain control of a spell on the chain.'),
  P('effect', 'take-control', /take control of|you control it until|gain control of this|they gain control of/i, 'Gain control of a unit / gear.'),
  P('effect', 'lose-control', /lose control/i, 'Lose control (end temporary control).'),
  P('effect', 'look-top', /\blook at (?:the top|that many)|looks at the top|look at the top card first/i, 'Look at top N cards of Main Deck.'),
  P('effect', 'reveal-top', /reveals? (?:the top|cards from the top|the top card)|reveal the top rune/i, 'Reveal top card(s) of a deck (main or rune).'),
  P('effect', 'reveal-hand', /reveals? (?:their|your) hand|reveal (?:a|such a) .* from (?:hand|among)|reveal it/i, 'Reveal hand / a card from hand.'),
  P('effect', 'select-from-revealed', /from among them|choose one and banish|choose a card (?:revealed|from it)|you choose a \w+ card from it|choose a non-unit card from it/i, 'Choose card(s) from a looked-at/revealed set.'),
  P('effect', 'predict', /\[predict(?: \d)?\]/i, 'Predict N: look at top N, recycle any, rest back in any order.'),
  P('effect', 'burn', /\[burn \d\]|burn 1\b|\[burn\]/i, 'Burn N: mill top N of Main Deck to trash.'),
  P('effect', 'mill', /put the top \d cards? of your main deck into your trash|put the rest into your trash|put it in your trash/i, 'Put cards from deck into trash (non-keyword).'),
  P('effect', 'add-resource', /\[add\]|add that much|add (?:an )?additional/i, 'Add Energy/Power to rune pool (resource ability, no chain).'),
  P('effect', 'score', /scores? (?:1|a) point|gain(?:s)? 1 point/i, 'Score a point (or opponent scores).'),
  P('effect', 'win-game', /win the game/i, 'Win the game immediately.'),
  P('effect', 'heal', /\bheal/i, 'Heal (remove damage).'),
  P('effect', 'gain-xp', /gains? \d+ xp|gain 1 xp|gain xp/i, 'Gain XP.'),
  P('effect', 'spend-xp', /spend \d+ xp|pay 2 xp/i, 'Spend XP (as cost or effect).'),
  P('effect', 'empower', /\bempower (?:me|it|a|another|something|this|that)/i, 'Empower something (sets Empowered state).'),
  P('effect', 'disempower', /\bdisempower/i, 'Disempower something.'),
  P('effect', 'attach', /\battach/i, 'Attach an Equipment to a unit.'),
  P('effect', 'detach', /\bdetach/i, 'Detach an Equipment.'),
  P('effect', 'copy', /becomes? (?:a )?cop(?:y|ies)|copy that unit's text|an additional copy of it/i, 'Copy a unit (become a copy) / copy text / duplicate a token.'),
  P('effect', 'extra-turn', /take a turn after this one/i, 'Take an extra turn.'),
  P('effect', 'deck-top-bottom', /top or bottom of (?:their|your) main deck|put a card from your hand on the top or bottom|put those you don't back|put the rest back/i, 'Put card(s) on top/bottom of deck.'),
  P('effect', 'replace-battlefield', /replace (?:that|this) (?:battlefield )?with|replace this with the battlefield/i, 'Replace a battlefield with a battlefield token.'),
  P('effect', 'add-battlefield', /add the baron pit battlefield token/i, 'Add a battlefield token to the board.'),
  P('effect', 'name', /\bname a (?:tag|spell)|choose bird, cat, dog, or poro\. i gain that tag/i, 'Name a card / tag as you play.'),
  P('effect', 'cost-modify-next', /the next (?:spell|card|unit) you play this turn (?:costs|deals)|next card you play this turn costs|first .* costs \[1\] less|reduce the cost of the next/i, 'Modify cost/damage of the next card you play this turn.'),
  P('effect', 'enter-ready-grant', /enters? ready|enter ready this turn/i, 'Make units enter ready (this turn / next unit).'),
  P('effect', 'cant-act', /can't (?:move|play|be readied|be chosen|be played|score|gain points|be countered|be revealed)|can only play units|don't ready|cannot/i, 'Prohibition: can\'t move / play / be chosen / ready / score.'),
  P('effect', 'must', /\bmust\b/i, 'Requirement: must kill / must move / must pay / must be assigned.'),
  P('effect', 'each-player', /each (?:other )?player|each opponent|starting with the next player|for each player/i, 'Each player / each opponent performs an action (APNAP order).'),
  P('effect', 'choose-player', /choose (?:an opponent|a player)|chooses (?:cards|a unit)|they guess/i, 'Choose a player / opponent, or an opponent makes a choice.'),
  P('effect', 'delayed-trigger', /this turn, when|when (?:it|any unit|a friendly unit) .* this turn|when it dies this turn|when it wins a combat this turn|when they hold, return|at end of turn, play|at the end of this turn|when you play it, \[buff\]|the next time you play a unit this turn|next three times/i, 'Create a delayed / this-turn trigger.'),
  P('effect', 'repeat-effect', /repeat this gear's play effect|play this spell again|trigger an additional time|activate the conquer effects/i, 'Repeat / re-trigger effects.'),
  P('effect', 'discard-hand', /discards? (?:their|your) hand|banish your hand/i, 'Discard / banish whole hand.'),
  P('effect', 'shuffle-or-order', /in any order/i, 'Put cards back in any order.'),
  P('effect', 'gain-tag', /i gain that tag/i, 'Gain a tag.'),
  P('effect', 'become-unit', /becomes a unit/i, 'Turn a gear into a unit.'),
  P('effect', 'skip-phase', /skip your draw phase/i, 'Skip a phase.'),
];

const CONDITIONS: Pat[] = [
  P('condition', 'legion', /\[legion\]/i, 'Legion: you\'ve played another card this turn.'),
  P('condition', 'level', /\[level \d+\]/i, 'Level N: you have N+ XP.'),
  P('condition', 'empowered', /\[empowered\]|if (?:this is|i'm|it's) \[empowered\]|that's \[empowered\]/i, 'Empowered state of this or another object.'),
  P('condition', 'mighty', /\[mighty\]/i, 'Mighty: 5+ Might.'),
  P('condition', 'if-paid-additional', /if you paid the additional cost|if you paid my additional cost|if you do\b|if they do\b/i, 'If an optional cost was paid / "if you do".'),
  P('condition', 'showed-off', /if you showed off/i, 'Show Off was used.'),
  P('condition', 'if-killed', /if this kills it|for each unit this kills|if it had|if it was (?:an enemy|a friendly)|if i died alone|if i didn't die alone|if i was \[mighty\]/i, 'Depends on result of the effect / the dead card\'s properties.'),
  P('condition', 'zone-origin', /if (?:you played this|i was played) from|from face ?down|if you played this from your hand/i, 'Depends on the zone the card was played from.'),
  P('condition', 'turn-owner', /if it's (?:not )?your turn|on (?:an opponent's|your) turn|on their turn|during your beginning phase|if it's your beginning phase/i, 'Whose turn / which phase.'),
  P('condition', 'score-near-victory', /within 3 points of the victory score/i, 'Score within 3 of victory.'),
  P('condition', 'count-runes', /(?:control|have) (?:\d+ or (?:more|fewer)|fewer|\d\+) runes|fewer runes than|your rune deck is empty/i, 'Number of runes controlled.'),
  P('condition', 'count-units', /\d\+ units|\d or more (?:other )?(?:friendly )?units|exactly (?:one|two|\d) (?:other )?units?|no other units|two or more other units|another unit here|alone|one on one|7\+ units|four or more units|if there are 4 or more units/i, 'Count / solitude of units at a location.'),
  P('condition', 'count-hand', /cards in (?:your )?hand|cards in your hand|exactly 4 cards in hand|two or fewer cards|one or fewer cards/i, 'Hand size.'),
  P('condition', 'control-type', /if you control (?:a|an|two|3|another|something)|if you control a (?:mech|poro|facedown)|you control a facedown|while there's a friendly gear|another dragon|another mech/i, 'You control a card with a property.'),
  P('condition', 'played-this-turn', /played a (?:unit|spell|card|non-token)|you've played|you played|if you've spent|discarded a card this turn|gained xp this turn|if you've chosen|died this turn|has died this turn|conquered this turn|played an equipment this turn/i, 'Something happened earlier this turn.'),
  P('condition', 'target-state', /if (?:it|it's|it is) (?:stunned|already|attacking|a spell|a unit|\[mighty\]|a gear|an equipment)|if it has \d|already buffed|if it's already stunned|if it has 3 \[m\]|if there is a ready enemy/i, 'State of the chosen object.'),
  P('condition', 'while-location', /while (?:i'm|this is) (?:at a battlefield|in (?:combat|a showdown))|only while i'm at a battlefield|unless i'm in combat|while you control this battlefield|while you or an ally control|if i'm at a battlefield|while a unit here/i, 'Location / combat state of this card.'),
  P('condition', 'while-attacking', /while i'm (?:an )?attack(?:ing|er)|while i'm attacking or defending|while i'm attacking with another unit|defends? alone|defending alone/i, 'While attacking/defending.'),
  P('condition', 'while-buffed', /while i'm buffed|buffed (?:friendly )?units?|a buffed unit/i, 'Buffed state.'),
  P('condition', 'tags', /bird, cat, dog,? (?:and|or) poro|all 4 tags/i, 'Tag-tribe synergy (Bird/Cat/Dog/Poro).'),
  P('condition', 'name-in-trash', /with (?:this|my) name in your trash/i, 'Cards with this name in trash.'),
  P('condition', 'xp-threshold', /\d\+ xp/i, 'XP amount.'),
  P('condition', 'unless', /\bunless\b/i, '"Unless" clause.'),
  P('condition', 'use-only', /use (?:this ability )?only|use only if|use my abilities only|use only once|each player may use this ability once/i, 'Activation restriction (only while / only if / once per turn).'),
  P('condition', 'once-per-turn', /once (?:each|per) turn|the first time .* each turn|for each player, the first time|first time each turn|only once each turn/i, 'Once per turn limit.'),
  P('condition', 'turn-number', /first, second, or third turns|until their third turn|first or second turn|first beginning phase/i, 'Turn number of the player.'),
  P('condition', 'excess-damage', /excess damage/i, 'Excess combat damage assigned.'),
  P('condition', 'domain-of-revealed', /based on its domain|based on the discarded card's type/i, 'Branch on revealed card\'s domain/type.'),
];

const DURATIONS: Pat[] = [
  P('duration', 'this-turn', /this turn/i, 'Until end of turn.'),
  P('duration', 'this-combat', /this combat/i, 'Until end of combat.'),
  P('duration', 'end-of-turn', /at (?:the )?end of (?:this )?turn/i, 'Delayed until end of turn.'),
  P('duration', 'until-next-ending', /until your next ending phase/i, 'Until your next Ending Phase.'),
  P('duration', 'while-attached', /for as long as this is attached/i, 'While attached.'),
  P('duration', 'while-source-on-board', /while i'm on the board|until i leave the board|until you choose another gear with me/i, 'While source remains on board.'),
  P('duration', 'next-main-phase', /start of your next main phase/i, 'Delayed until your next Main Phase.'),
  P('duration', 'next-time', /the next time|the next (?:spell|unit|card|three)/i, 'Until the next occurrence ("the next time it would die", "the next spell you play").'),
];

const COSTS: Pat[] = [
  P('cost', 'energy', /\[\d+\]/i, 'Generic Energy [N].'),
  P('cost', 'power-domain', /\[(?:c|r|g|b|o|p|y)\]/i, 'Power of this card\'s domain [C] or a specific domain.'),
  P('cost', 'power-any', /\[a\]/i, 'Power of any domain [A].'),
  P('cost', 'exhaust-self', /\[e\]/i, 'Exhaust this ([E]/[T]).'),
  P('cost', 'exhaust-other', /exhaust (?:a friendly|a unit you control|your legend|me and three|a friendly \[mighty\])/i, 'Exhaust another permanent you control.'),
  P('cost', 'kill-self', /kill this|banish this/i, 'Kill / banish this as cost.'),
  P('cost', 'kill-other', /kill (?:a friendly|another friendly|any number of friendly|a bird, cat)|kill 3 other friendly/i, 'Kill a friendly unit/gear as cost (sacrifice).'),
  P('cost', 'discard', /discard (?:\d|a card|a spell|a gear)/i, 'Discard as cost.'),
  P('cost', 'recycle-trash', /recycle (?:\d|a unit|2 cards) from your trash|banish a unit or gear from your trash|banish a card from any trash/i, 'Recycle / banish card(s) from your trash as cost.'),
  P('cost', 'return-friendly', /return a friendly (?:unit|gear) to its owner's hand/i, 'Return a friendly unit/gear to hand as cost.'),
  P('cost', 'spend-buff', /spend (?:my|a|its|any number of) buffs?/i, 'Spend a buff as cost.'),
  P('cost', 'spend-xp', /spend \d+ xp/i, 'Spend XP as cost.'),
  P('cost', 'disempower', /disempower (?:me|this)/i, 'Disempower this as cost.'),
  P('cost', 'pay-x', /pay any amount|that many|that much/i, 'Variable (X) payment.'),
];

const STATICS: Pat[] = [
  P('static', 'self-might', /\bi (?:have|get) (?:an additional )?[+-]\d|my might is increased|\bi have \+\d/i, 'This unit has +N Might (possibly conditional/scaling).'),
  P('static', 'self-keyword', /^(?:while .*?, )?i have \[|^if .*?, i have \[|i have \[assault\] equal|i have \[shield|i have all \[e\] abilities/i, 'This unit has keyword(s) (often conditional).'),
  P('static', 'anthem-might', /(?:units?|mechs|they|it)\b(?:(?!\bi have\b)[^.])*? (?:have|has|get|gets) [+-]\d/i, 'Other units have +N Might (anthem).'),
  P('static', 'anthem-keyword', /units played from anywhere other than a player's hand have|(?:units?|mechs|gear|equipment|sand soldiers|legends|spells|token units|units here|cards|buffed units)(?: [\w\[\]]+)* (?:have|has|each give|each have) (?:\[|")/i, 'Other cards have keyword / quoted ability.'),
  P('static', 'cost-mod-self', /^(?:i|this(?: spell)?|this ability|this spell's energy cost) (?:costs?|cost|is reduced)|i cost|this costs|this ability costs|this ability's energy cost|reduce my cost/i, 'This card\'s / ability\'s cost is modified.'),
  P('static', 'cost-mod-other', /(?:spells|units|cards|costs|abilities|gear|dragons'|equipment)(?: [\w\[\]']+)* cost (?:\[|\d)|energy costs? (?:for|are) .*reduced|cost \[a\] more|costs? \[1\] (?:less|more)|cost \[\d\] less|costs \[a\] less|pay \[1\]\[a\] less to play a gear|ignore \[deflect\]|you ignore \[tank\]|may pay \[1\] to hide/i, 'Other cards\' costs modified / cost rules changed.'),
  P('static', 'enter-ready', /enters? ready|enter ready/i, 'Enters ready (self or others, conditional).'),
  P('static', 'enter-exhausted', /this enters exhausted/i, 'Enters exhausted.'),
  P('static', 'cant', /can't|cannot|don't ready|can only|only channel 1/i, 'Prohibition (move, play, score, be chosen, be readied...).'),
  P('static', 'must', /\bmust\b/i, 'Requirement (combat damage order, payment to move/choose).'),
  P('static', 'combat-damage-rule', /combat damage|assigning combat damage|damage is enough to kill/i, 'Combat damage modification.'),
  P('static', 'trigger-doubling', /trigger an additional time|effects .* don't trigger/i, 'Triggers fire extra times / don\'t fire.'),
  P('static', 'play-location', /(?:may|can) (?:be )?play(?:ed)? (?:me )?to|play me only to|only play units to|can be played to|may be played to|can move here from anywhere|units can't be played here/i, 'Where a card may/must be played.'),
  P('static', 'play-from-trash-permission', /you may play (?:cards )?from your trash|play this from your trash|play me from your trash/i, 'Permission to play from trash.'),
  P('static', 'victory-rule', /points needed to win|win the game|can't score|can't gain points|score 1 point instead/i, 'Changes scoring / victory.'),
  P('static', 'deck-rule', /your deck can have|in your deck/i, 'Deck construction rule.'),
  P('static', 'hide-rule', /hide an additional card|can't be revealed|may hide/i, 'Hidden / facedown rule change.'),
  P('static', 'buff-rule', /any number of buffs|buffs give an additional|no more than one buff/i, 'Buff rule change.'),
  P('static', 'resource-restriction', /spend this (?:power|energy) only|use only to play/i, 'Restriction on how added resources can be spent.'),
  P('static', 'damage-mod', /bonus damage|don't take damage|prevent all damage/i, 'Damage dealt/taken modified (Bonus Damage, prevention).'),
  P('static', 'turn-structure', /skip your draw phase|don't ready during the awaken phase|only channel 1 rune/i, 'Turn structure modification.'),
  P('static', 'empower-rule', /can be \[empowered\] up to/i, 'Empower rule change.'),
  P('static', 'copy', /becomes a copy|copy that unit's text|i have all \[e\] abilities/i, 'Copy / ability-sharing static.'),
  P('static', 'activation-restriction', /use my abilities only/i, 'Restriction on activating this card\'s abilities.'),
  P('static', 'resource-mod', /\[add\] an additional/i, 'Resource production modified.'),
  P('static', 'grant-play-option', /any player may pay .* additional cost to play/i, 'Grants a play option to players.'),
  P('static', 'equipment-mod', /each equipment attached to me gives double|equipment each give/i, 'Equipment bonus modification.'),
];

const REPLACEMENTS: Pat[] = [
  P('replacement', 'would-die', /would die/i, 'If a unit would die, do X instead (heal, exhaust, recall; kill this instead; banish instead).'),
  P('replacement', 'would-channel', /would channel/i, 'Channel replacement.'),
  P('replacement', 'would-score', /would score/i, 'Score replacement.'),
  P('replacement', 'would-reveal', /would reveal/i, 'Reveal replacement.'),
  P('replacement', 'would-play-token', /would play (?:a|a token) unit|would play a token/i, 'Token creation replacement.'),
  P('replacement', 'would-go-to-trash', /would go to your trash/i, 'Zone-change replacement (trash -> banish).'),
  P('replacement', 'would-be-dealt-damage', /would be dealt damage|would deal|damage that would be dealt/i, 'Damage replacement / prevention.'),
  P('replacement', 'would-be-affected', /would stun me, give me|would give -\[m\]/i, 'Replace a hostile effect choosing this unit.'),
  P('replacement', 'tie-recall', /ends in a tie, recall/i, 'Combat result replacement.'),
  P('replacement', 'instead', /\binstead\b/i, 'Contains "instead" (replacement or upgraded mode).'),
];

const PLAYS: Pat[] = [
  P('play', 'additional-cost-optional', /you may (?:pay|kill|discard|return|spend|exhaust) .*as an additional cost|as an additional cost to play (?:a spell|this), you may|as you play (?:me|this), you may (?:discard|spend|kill)|you may pay .* as an additional cost|you may spend \d+ xp as an additional cost|you may kill a friendly unit as an additional cost/i, 'Optional additional cost to play.'),
  P('play', 'additional-cost-mandatory', /as an additional cost to play (?:me|this), (?!you may)/i, 'Mandatory additional cost to play.'),
  P('play', 'x-cost', /pay any amount of/i, 'X cost: pay any amount.'),
  P('play', 'alt-cost', /play (?:me|this) for \[|you may play me for|play this from your trash for|play me from your trash for/i, 'Alternative cost to play.'),
  P('play', 'from-trash', /from (?:your|their|any)? ?trash|from trashes/i, 'References trash zone (play/return/banish/recycle from trash).'),
  P('play', 'from-deck', /from (?:the top of )?your (?:main )?deck|of your main deck|their main deck|top rune of your rune deck/i, 'References the main/rune deck.'),
  P('play', 'from-banishment', /banished with (?:this|me)|play the banished card|until your next ending phase, you may play that card|play a unit banished/i, 'Play from banishment / linked banished cards.'),
  P('play', 'show-off', /\[show off\]/i, 'Show Off: as you play, reveal a card from hand or pick a friendly one.'),
  P('play', 'as-you-play', /^as you play (?:me|this)|^as this is attached|as you play me, add/i, 'Choice made as the card is played.'),
];

const CHOICES: Pat[] = [
  P('choice', 'choose-one', /choose one\b|choose one —|choose one that hasn't|choose one you|do one of the following/i, 'Modal: choose one.'),
  P('choice', 'choose-two', /choose two —/i, 'Modal: choose two.'),
  P('choice', 'mode-not-chosen-this-turn', /(?:hasn't been|not|haven't already) (?:been )?chosen/i, 'Modal with "not already chosen this turn" memory.'),
  P('choice', 'optional', /\byou may\b|\bthey may\b|\bmay\b/i, 'Optional ("you may").'),
  P('choice', 'up-to', /\bup to\b/i, 'Up to N targets.'),
  P('choice', 'any-number', /any number of/i, 'Any number of targets.'),
  P('choice', 'total-might', /total might/i, 'Targets constrained by total Might.'),
  P('choice', 'opponent-decides', /its controller (?:has you|may)|unless its controller|they (?:play|move|reveal|guess|choose)|each (?:other )?player chooses|they must|the defender must|chooses cards or runes|opponent reveals/i, 'An opponent makes a decision.'),
];

const SCALING: Pat[] = [
  P('scaling', 'for-each', /for each/i, 'Scales with a count ("for each").'),
  P('scaling', 'equal-to', /equal to|that many|that much|as damage/i, 'Amount equal to a value.'),
];

const ALL_PATTERNS: Pat[] = [...TRIGGERS, ...EFFECTS, ...CONDITIONS, ...DURATIONS, ...COSTS, ...STATICS, ...REPLACEMENTS, ...PLAYS, ...CHOICES, ...SCALING];

// ---------------------------------------------------------------------------------------------
// Normalisation and tokenisation
// ---------------------------------------------------------------------------------------------
export function normalise(text: string): string {
  let t = text
    .replace(/\[T\]/g, '[E]').replace(/\[S\]/g, '[M]')
    .replace(/–/g, '-')
    .replace(/disa$/, '') // stray data junk on rad-127-167
    .replace(/^(Action|Ganking|Hidden)$/gm, '[$1]')
    .replace(/^Equip \[/gm, '[Equip] [');
  // Old-style keyword separator "[Kw] — effect" -> "[Kw][>] effect" (but not "[Equip] — cost", "[Empower] — cost", "[Repeat] — cost")
  t = t.replace(/\[(Legion|Deathknell|Reaction|Action|Level \d+)\](?:, \[(Legion|Reaction|Action)\])? — /g,
    (_m, a: string, b?: string) => `[${a}][>]${b ? `[>>][${b}][>]` : ''} `);
  return t;
}

export interface ParsedAbility {
  index: number;
  raw: string;                 // normalised line(s) this ability came from
  kind: 'keyword' | 'keyword-cost' | 'triggered' | 'activated' | 'static' | 'replacement' | 'spell-effect' | 'play-modifier' | 'reminder';
  keywords?: { name: string; value?: number; cost?: string }[];
  prefixes?: { keyword: string; role: 'dependent' | 'trigger' | 'permission' }[];
  trigger?: { clause: string; events: string[]; subject: string; zone?: string };
  cost?: { raw: string; parts: string[] };
  effect?: string;
  modes?: string[];
  targets?: TargetRef[];
  patterns: string[];
}

export interface TargetRef { verb: string; phrase: string; filter: string }

const KW_RE = /^\[([A-Z][A-Za-z' -]*?)(?: (\d+))?\]/;

/** Split into ability lines; attach "- mode"/"* mode" bullets to the preceding line. */
function splitLines(t: string): { head: string; modes: string[] }[] {
  const out: { head: string; modes: string[] }[] = [];
  for (const line of t.split('\n').map(s => s.trim()).filter(Boolean)) {
    if (/^[-*] /.test(line) && out.length) out[out.length - 1].modes.push(line.replace(/^[-*] /, ''));
    else out.push({ head: line, modes: [] });
  }
  return out;
}

/** Find a top-level "COST: EFFECT" split (colon outside quotes). */
function splitActivated(line: string): { cost: string; effect: string } | null {
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQ = !inQ;
    if (ch === ':' && !inQ) {
      const cost = line.slice(0, i).trim();
      const effect = line.slice(i + 1).trim();
      const parts = cost.split(/,\s*/);
      if (parts.length && parts.every(isCostPart)) return { cost, effect };
      return null;
    }
  }
  return null;
}

const COST_PART_RE = new RegExp('^(?:' + [
  '(?:\\[(?:\\d+|[ACEMRGBOPY])\\])+',
  'Kill this', 'Kill (?:a|another) friendly (?:unit|gear|unit or gear)', 'Banish this',
  'Discard (?:\\d|a gear|a spell)', 'Recycle \\d from your trash', 'Recycle a unit from your trash',
  'Spend (?:my|its) buff', 'Spend \\d+ XP', 'Exhaust a friendly (?:\\[Mighty\\] )?unit', 'Exhaust a unit you control',
  'Disempower (?:me|this)', 'Banish a unit or gear from your trash',
].join('|') + ')$', 'i');
function isCostPart(p: string): boolean { return COST_PART_RE.test(p.trim()); }

function stripPrefixes(line: string): { rest: string; prefixes: { keyword: string; role: 'dependent' | 'trigger' | 'permission' }[] } {
  const prefixes: { keyword: string; role: 'dependent' | 'trigger' | 'permission' }[] = [];
  let rest = line;
  for (;;) {
    rest = rest.replace(/^\s*\[>>\]\s*/, '');
    const m = rest.match(/^\[(Legion|Level \d+|Empowered|Deathknell|Reaction|Action|Mighty)\]\s*\[>\]\s*/);
    if (!m) break;
    const kw = m[1];
    prefixes.push({ keyword: kw, role: PREFIX_KEYWORDS[kw.replace(/ \d+$/, '')] });
    rest = rest.slice(m[0].length);
  }
  return { rest: rest.trim(), prefixes };
}

const TRIGGER_START = /^(?:while you control this battlefield, when\b|if you control fewer runes than an opponent at the start|as (?:i'm revealed|you look at or reveal me)\b|when(?:ever)?\b|at (?:the )?(?:start|end) of\b|at start of\b|the (?:first|second|third) time\b|once each turn, (?:when|if i would)\b|for each player, the first time\b|the first time\b)/i;

function triggerClause(s0: string): string {
  const lead = /^(?:once each turn, |for each player, |while you control this battlefield, )/i.exec(s0)?.[0] ?? '';
  const s = s0.slice(lead.length);
  const re = /,\s(?!(?:gear|or|and|unit|spell|discarded|cat|dog|or killed)\b)/gi;
  const m = re.exec(s);
  if (m) return (lead + s.slice(0, m.index)).trim();
  return (lead + s.split(/[.]/)[0]).trim();
}
const EVENT_WORD: Record<string, RegExp> = {
  attack: /attack/i, defend: /defend/i, conquer: /conquer/i, hold: /\bhold/i, move: /\bmov/i, die: /\bdie|\bdied|killed|deathknell/i,
  'play-card': /\bplay|played/i, 'play-card-nth': /\bplay|played/i, score: /\bscore/i, 'become-exhausted': /exhaust/i, 'become-ready': /ready/i,
  chosen: /choose/i, stun: /stun/i, buff: /\bbuff/i, 'win-combat': /win/i, discard: /discard/i, draw: /\bdraw/i, kill: /\bkill/i,
  'become-mighty': /mighty|might becomes/i, empower: /empower/i, recycle: /recycle/i, hide: /\bhide/i, attach: /attach/i,
};

/** Who performs / undergoes the trigger event: self | you | opponent | any, plus "@here" for battlefield-scoped. */
function segmentSubject(seg: string): string | null {
  const s = seg.toLowerCase().replace(/^(?:once each turn, |for each player, |while you control this battlefield, )/, '')
    .replace(/^(?:when(?:ever)?|the (?:first|second|third) time|as|if)\s+/, '').replace(/^or\s+(?:when\s+)?/, '');
  if (/^(?:i|i'm|my|this|me)\b/.test(s) || /^you (?:play|buff|choose|discard) (?:me|this)\b|^you (?:choose or ready|play or move) (?:me|this)|^you attach .* to me|^you look at or reveal me|^i'm revealed/.test(s)) return 'self';
  if (/^(?:a|an|one or more|another|one of your)?\s*(?:stunned |buffed |non-token |non-recruit )*(?:enemy|opponent)|^an opponent|^opponents?\b/.test(s)) return 'opponent';
  if (/^(?:you|your|a friendly|another friendly|one or more friendly|one of your|a unit you control|another non-recruit unit you control|a buffed friendly|a friendly gear)/.test(s)) return 'you';
  if (/^(?:a player|each player|any unit|a unit|a combat|combat|a showdown|a non-token unit they control|they)\b/.test(s)) return 'any';
  if (/^(?:start|end|the start|the end)/.test(s)) return null;
  return null;
}

function specialiseEvents(clause: string, events: string[]): string[] {
  const segs = clause.split(/\s+or\s+(?=when\b|at the start|the first time|i\b|another\b|you\b)|\s+and\s+(?=when\b)/i);
  const subj: string[] = [];
  let last = 'you';
  for (const sg of segs) { const x = segmentSubject(sg); if (x) last = x; subj.push(last); }
  const here = (sg: string) => /\bhere\b|this battlefield/i.test(sg);
  const out: string[] = [];
  for (const e of events) {
    const base = e.replace(/^trigger:/, '');
    const re = EVENT_WORD[base];
    if (!re) { out.push(e); continue; }
    let idx = base.startsWith('play-card') ? segs.findIndex(sg => re.test(sg) && !/play (?:me|this)\b/i.test(sg)) : -1;
    if (idx < 0) idx = segs.findIndex(sg => re.test(sg));
    if (idx < 0) idx = 0;
    let who = subj[idx];
    if (base === 'die' && /\[deathknell\]/i.test(clause)) who = 'self';
    if (base.startsWith('play-card') && who === 'self') who = 'you';
    if (/on an opponent's turn/i.test(segs[idx]) && base.startsWith('play')) who = 'you';
    const v = `${e}/${who}${here(segs[idx]) ? '@here' : ''}`;
    out.push(e, v);
  }
  return [...new Set(out)];
}

// Target noun phrases following effect verbs.
const TARGET_VERBS = '(?:deal \\d+ (?:damage )?to|deals? \\d+ to|kill|stun|\\[stun\\]|buff|\\[buff\\]|ready|exhaust|move|return|give|banish|recall|counter|take control of|gain control of|choose|attach|detach|empower|disempower|heal|deal damage equal to (?:its|my|their) might to)';
const NP = '((?:up to (?:one|two|three|four|\\d)|any number of|all|each|another|a|an|one|two|three|four|that|your|its|his)?\\s*(?:other |another )?(?:(?:friendly|enemy|stunned|exhausted|ready|buffed|damaged|attacking|defending|equipped|token|non-token|non-Recruit|non-Dragon|detached|attached|facedown|\\[Mighty\\]|\\[Empowered\\]|\\[Deploy\\]|\\[Hidden\\]|\\[Temporary\\]|Champion|open|occupied|Mind|Body|Calm|Fury|Chaos|Order|Bomb|Mech|Dragon|Bird|Recruit|Gold|Sand Soldier|Shadow Clone|detached|played)\\s+)*(?:units?|gear|spells?|cards?|battlefields?|runes?|legends?|Equipment|players?|opponents?|Mechs?|Dragons?|tokens?|Bird, Cat, Dog, or Poro|something|me|it|them|that unit)\\b(?:\\s+(?:or (?:a |an )?(?:gear|unit|facedown card|ability|unit or gear)|and(?:/or)? (?:gear|runes|an enemy unit|a battlefield|a spell|an Equipment(?: with the same controller)?|another friendly unit)))*(?:\\s+(?:at (?:a |the |its |my |that |this )?(?:battlefields?|single battlefield|same (?:battlefield|location)|base|location|its location)|in (?:a |your |their )?(?:base|bases|combat|a showdown|your trash|your base)|here|there|you control(?: here| there| at [a-z ]+)?|you don\'t control|with [^,.;]+?(?= to |,|\\.|;| and | then |$)|without \\[[A-Za-z]+\\]|that [^,.;]+?(?=,|\\.|;| and |$)|from (?:a battlefield|here|your trash|its base|anywhere)|anywhere))*)';
const TARGET_RE = new RegExp(`(?<![A-Za-z])${TARGET_VERBS}\\s+${NP}`, 'gi');

function normaliseFilter(np: string): string {
  const s = np.toLowerCase();
  const NUM: Record<string, string> = { one: '1', two: '2', three: '3', four: '4' };
  const q = /^up to (one|two|three|four|\d)/.exec(s)?.[1];
  const quant = q ? `upTo${NUM[q] ?? q}` : /any number of/.test(s) ? 'any' : /^(all|each)\b/.test(s) ? 'all'
    : /^(two|three|four)\b/.test(s) ? s.split(' ')[0] : /^(me|it|them|that unit|that|its|his)\b/.test(s) ? 'ref' : 'one';
  const type = (/(units?|gear|spells?|cards?|battlefields?|runes?|legends?|equipment|players?|opponents?|mechs?|dragons?|tokens?|bird, cat, dog, or poro|something|me|it|them|that unit)\b/.exec(s)?.[1] ?? '?')
    .replace(/s$/, '').replace(/^mech$/, 'unit:Mech').replace(/^dragon$/, 'unit:Dragon').replace(/^bird, cat, dog, or poro$/, 'unit:BCDP')
    .replace(/^(me|it|them|that unit)$/, 'ref');
  const quals: string[] = [];
  for (const w of ['friendly', 'enemy', 'stunned', 'exhausted', 'ready', 'buffed', 'damaged', 'attacking', 'defending', 'equipped', 'non-token', 'token', 'facedown', 'mighty', 'empowered', 'deploy', 'hidden', 'temporary', 'champion', 'open', 'occupied', 'other'])
    if (new RegExp(`(^|[\\s\\[])(an)?${w}\\b`).test(s) && !(w === 'token' && /non-token/.test(s))) quals.push(w);
  for (const d of ['mind', 'body', 'calm', 'fury', 'chaos', 'order']) if (new RegExp(`\\b${d}\\b`).test(s)) quals.push(`domain:${d}`);
  if (/you control/.test(s) && !quals.includes('friendly')) quals.push('friendly');
  if (/or (?:a |an )?gear|and\/or gear|unit or gear/.test(s)) quals.push('+gear');
  if (/facedown card/.test(s)) quals.push('+facedown');
  let loc = '';
  if (/at (?:a |the )?battlefields?|at a single battlefield/.test(s)) loc = '@battlefield';
  else if (/\bhere\b/.test(s)) loc = '@here';
  else if (/\bthere\b|at that battlefield|at its destination/.test(s)) loc = '@there';
  else if (/in (?:a |your |their )?bases?|in your base|at (?:its|their) base/.test(s)) loc = '@base';
  else if (/same (?:battlefield|location)/.test(s)) loc = '@same-location';
  else if (/in combat/.test(s)) loc = '@combat';
  else if (/in (?:a )?showdown/.test(s)) loc = '@showdown';
  else if (/trash/.test(s)) loc = '@trash';
  else if (/anywhere/.test(s)) loc = '@anywhere';
  let mf = '';
  const m1 = /with (\d+) \[m\] or (less|more)/.exec(s); if (m1) mf = `might${m1[2] === 'less' ? '<=' : '>='}${m1[1]}`;
  if (/less might than/.test(s)) mf = 'might<ref';
  if (/total might/.test(s)) mf = 'totalMight';
  if (/energy cost (?:no more than|\[\d\] or less|up to)|cost no more than|energy cost \[?\d\]? or less/.test(s)) mf = 'cost<=N';
  if (/power cost/.test(s)) mf += (mf ? '&' : '') + 'powerCost';
  return [quant, type, quals.join('+') || 'any', loc, mf].filter(Boolean).join('|');
}

function extractTargets(effect: string): TargetRef[] {
  const out: TargetRef[] = [];
  for (const m of effect.matchAll(TARGET_RE)) {
    const verb = m[0].slice(0, m[0].length - m[1].length).trim().toLowerCase().replace(/\[|\]/g, '').replace(/ \d+ /, ' N ');
    const phrase = m[1].trim();
    if (!phrase || /^(a|an|the|that|your|its)$/i.test(phrase)) continue;
    // Compound "a friendly unit and an enemy unit" -> two targets
    const parts = phrase.split(/ and (?=(?:a|an|another) (?:friendly |enemy )?(?:unit|gear|spell|battlefield|equipment))/i);
    for (const part of parts) out.push({ verb, phrase: part, filter: normaliseFilter(part) });
  }
  return out;
}

function matchPatterns(text: string, pats: Pat[]): string[] {
  return pats.filter(p => p.re.test(text)).map(p => p.id);
}

function parseKeywordLine(line: string): { name: string; value?: number; cost?: string }[] | null {
  // Cost keyword: "[Equip] [1][C]", "[Equip] — [C], Recycle 2 cards", "[Empower] [12]. This ability costs [1] less ...", "[Repeat] — [1] / [A] / [1][A]"
  const ck = line.match(/^\[(Equip|Empower|Repeat|Flow)\]\s*(?:—\s*)?(.*)$/);
  if (ck) return [{ name: ck[1], cost: ck[2].trim() }];
  // Pure keyword list: "[Accelerate]", "[Assault 2], [Shield 2]", "[Hidden]", "[Disarm]."
  const pure = line.replace(/\.$/, '');
  if (/^(?:\[[A-Z][A-Za-z' -]*?(?: \d+)?\](?:,\s*|\s+)?)+$/.test(pure)) {
    const kws = [...pure.matchAll(/\[([A-Z][A-Za-z' -]*?)(?: (\d+))?\]/g)].map(m => ({ name: m[1], value: m[2] ? +m[2] : undefined }));
    if (kws.every(k => (ABILITY_KEYWORDS as readonly string[]).includes(k.name))) return kws;
    // [Predict] / [Burn 3] / [Stun] alone are keyword actions, not keyword abilities
    return null;
  }
  // Cost keyword: "[Equip] [1][C]", "[Equip] — [C], Recycle 2 cards", "[Empower] [12]. This ability costs [1] less ...", "[Repeat] — [1] / [A] / [1][A]"
  const m = line.match(/^\[(Equip|Empower|Repeat|Flow)\]\s*(?:—\s*)?(.*)$/);
  if (m) return [{ name: m[1], cost: m[2].trim() }];
  return null;
}

function classify(card: Card, head: string, modes: string[], index: number): ParsedAbility {
  const raw = [head, ...modes.map(m => `- ${m}`)].join('\n');
  const full = [head, ...modes].join(' ');
  const ab: ParsedAbility = { index, raw, kind: 'static', patterns: [] };
  if (modes.length) ab.modes = modes;

  // 1. Keyword-only / keyword-with-cost lines.
  const kws = parseKeywordLine(head);
  if (kws) {
    ab.keywords = kws;
    ab.kind = kws.some(k => k.cost !== undefined) ? 'keyword-cost' : 'keyword';
    for (const k of kws) ab.patterns.push(`keyword:${k.name}`);
    if (kws[0].cost !== undefined) {
      ab.cost = { raw: kws[0].cost, parts: kws[0].cost.split(/,\s*|\s*\/\s*|\.\s*/).filter(Boolean) };
      ab.patterns.push(...matchPatterns(kws[0].cost, COSTS));
      if (/this ability costs|energy cost is reduced/i.test(kws[0].cost)) ab.patterns.push('static:cost-mod-self');
      if (/equal to its (?:base )?cost/i.test(kws[0].cost)) ab.patterns.push('scaling:equal-to');
    }
    return ab;
  }
  // Token/reminder pseudo-cards
  if (/^(?:Track gained XP|Some cards|A unit may have no more than one buff)/.test(head)) {
    ab.kind = 'reminder'; ab.patterns.push('static:buff-rule'); return ab;
  }

  // 2. Prefix keywords ([Legion][>], [Level 6][>], [Empowered][>], [Deathknell][>], [Reaction][>], [Action][>])
  let { rest, prefixes } = stripPrefixes(head);
  if (prefixes.length) { ab.prefixes = prefixes; for (const p of prefixes) ab.patterns.push(`prefix:${p.keyword.replace(/ \d+$/, '')}`); }

  // Show Off line: "[Show Off] a Mech."
  if (/^\[Show Off\]/.test(rest)) {
    ab.kind = 'play-modifier'; ab.keywords = [{ name: 'Show Off' }]; ab.patterns.push('keyword:Show Off', 'play:show-off');
    ab.effect = rest; return ab;
  }

  // 3. Activated ability "COST: EFFECT"
  const act = splitActivated(rest);
  if (act) {
    ab.kind = 'activated';
    ab.cost = { raw: act.cost, parts: act.cost.split(/,\s*/) };
    let eff = act.effect;
    const inner = stripPrefixes(eff);
    if (inner.prefixes.length) { ab.prefixes = [...(ab.prefixes ?? []), ...inner.prefixes]; for (const p of inner.prefixes) ab.patterns.push(`prefix:${p.keyword.replace(/ \d+$/, '')}`); eff = inner.rest; }
    ab.effect = [eff, ...modes].join(' ');
    ab.patterns.push(...matchPatterns(act.cost, COSTS).map(id => id));
    if (/\[Add\]|Add\] that much|\[Add\] that much/i.test(eff)) ab.patterns.push('activated:mana');
    else ab.patterns.push('activated:ability');
    if (/^\[(?:Reaction|Action)\]/.test(eff)) ab.patterns.push('prefix:permission-inline');
    analyseEffect(ab, ab.effect, card);
    return ab;
  }

  // Deathknell prefix => triggered (self dies)
  if (prefixes.some(p => p.role === 'trigger')) {
    ab.kind = 'triggered';
    ab.trigger = { clause: '[Deathknell] (when I die)', events: ['trigger:die', 'trigger:die/self'], subject: 'self' };
    ab.patterns.push('trigger:die', 'trigger:die/self', 'trigger:deathknell');
    ab.effect = [rest, ...modes].join(' ');
    analyseEffect(ab, ab.effect, card);
    return ab;
  }

  // 4. Triggered abilities
  if (TRIGGER_START.test(rest) && !/^when you play (?:me|this), (?:you may )?(?:reveal|choose)/i.test('x')) {
    // Exclude "The first time ... costs" static (e.g. Hunters' Circle) and "the next time ... would" replacement
    const isCostStatic = /^(?:for each player, )?the first (?:unit|time).*?costs? \[/i.test(rest) && !/,\s*(?:they|you|draw)/i.test(rest.split('costs')[0]);
    const isReplacement = /^once each turn, if i would/i.test(rest);
    if (!isCostStatic && !isReplacement) {
      ab.kind = 'triggered';
      const clause = triggerClause(rest);
      const evs = matchPatterns(clause, TRIGGERS);
      const events = evs.length ? evs : ['trigger:other'];
      const spec = specialiseEvents(clause, events);
      const subject = (spec.find(x => x.includes('/')) ?? '/you').split('/')[1];
      ab.trigger = { clause, events: spec, subject };
      if (card.type === 'Spell' && /(?:from your trash|this from your trash|return this from your trash)/i.test(rest)) ab.trigger.zone = 'trash';
      if (card.type !== 'Spell' && /play me from your trash|when you discard me/i.test(rest)) ab.trigger.zone = /discard/.test(rest) ? 'trash(on discard)' : 'trash';
      if (card.type === 'Spell' && !ab.trigger.zone) { ab.patterns.push('effect:delayed-trigger'); ab.kind = 'spell-effect'; }
      ab.patterns.push(...ab.trigger.events);
      if (ab.trigger.zone) ab.patterns.push('zone:functions-from-trash');
      if (/^once each turn|each turn|the first time|the second time|the third time/i.test(clause)) ab.patterns.push('condition:once-per-turn');
      if (/^at (?:the )?start|^at start|^at the end/i.test(rest)) ab.patterns.push('trigger:phase');
      const condPart = rest.slice(clause.length);
      if (/^,\s*if\b/i.test(condPart) || /^,?\s*if\b/i.test(condPart)) ab.patterns.push('condition:intervening-if');
      ab.effect = [rest.slice(clause.length).replace(/^,\s*/, ''), ...modes].join(' ');
      analyseEffect(ab, ab.effect, card);
      ab.patterns.push(...matchPatterns(rest, REPLACEMENTS).filter(p => p !== 'replacement:instead'));
      return ab;
    }
  }

  // 5. Replacement effects
  const repl = matchPatterns(full, REPLACEMENTS);
  if (repl.some(r => r !== 'replacement:instead') || /^(?:if .*would|once each turn, if i would)/i.test(rest) || /ends in a tie/.test(rest)) {
    ab.kind = card.type === 'Spell' ? 'spell-effect' : 'replacement';
    ab.patterns.push(...repl);
    ab.effect = [rest, ...modes].join(' ');
    analyseEffect(ab, ab.effect, card);
    return ab;
  }

  // 6. Play modifiers (additional/alt costs, play location, as-you-play, cost reductions on self)
  const playPats = matchPatterns(full, PLAYS);
  const isPlayMod =
    /^(?:as you play (?:me|this)|as an additional cost|you may (?:pay|kill|discard|return|spend|exhaust) .* as an additional cost|you may spend \d+ xp|if you've played a spell this turn, you may pay)/i.test(rest) ||
    /^(?:if .*, you may play me for|you may play me (?:to|for)|play me only|i can be played|i can \[ambush\]|i can't be played|you may have me enter ready|if neeko is in your deck)/i.test(rest) ||
    /^(?:i|this|this spell|this spell's energy cost) (?:cost|costs|is reduced)|^this costs|^i cost|^reduce my cost|^ignore \[deflect\] while paying this|^this can't be countered|^if an? (?:opponent's score|enemy unit).*this costs|^if you've played a spell|^if an opponent controls a stunned unit, i cost/i.test(rest) ||
    (/^(?:if .*, )?i enter ready|^i enter ready|^if .*i enter ready|^this enters exhausted|^if you play me to a battlefield, i enter ready/i.test(rest));
  if (isPlayMod) {
    ab.kind = 'play-modifier';
    ab.patterns.push(...playPats);
    if (/enter ready/i.test(rest)) ab.patterns.push('static:enter-ready');
    if (/enters exhausted/i.test(rest)) ab.patterns.push('static:enter-exhausted');
    if (/cost/i.test(rest) && !/additional cost/i.test(rest)) ab.patterns.push('static:cost-mod-self');
    if (/^(?:you may play me to|i can be played|play me only|i can \[ambush\])/i.test(rest)) ab.patterns.push('static:play-location');
    ab.effect = [rest, ...modes].join(' ');
    analyseEffect(ab, ab.effect, card);
    return ab;
  }

  // 7. Spell effects (Spells: everything else is resolution text)
  if (card.type === 'Spell') {
    ab.kind = 'spell-effect';
    ab.effect = [rest, ...modes].join(' ');
    analyseEffect(ab, ab.effect, card);
    ab.patterns.push(...playPats);
    if (/instead/i.test(full)) ab.patterns.push('replacement:instead');
    return ab;
  }

  // 8. Static abilities on permanents
  ab.kind = 'static';
  ab.effect = [rest, ...modes].join(' ');
  const st = matchPatterns(rest, STATICS);
  ab.patterns.push(...(st.length ? st : ['static:other']));
  ab.patterns.push(...playPats);
  analyseEffect(ab, ab.effect, card, true);
  return ab;
}

function analyseEffect(ab: ParsedAbility, effect: string, card: Card, isStatic = false): void {
  const pats: string[] = [];
  const outer = effect.replace(/"[^"]*"/g, '"…"');
  if (!isStatic) pats.push(...matchPatterns(outer, EFFECTS));
  else pats.push(...matchPatterns(outer, EFFECTS).filter(p => ['effect:grant-ability', 'effect:copy', 'effect:prevent-damage', 'effect:might-min-1', 'effect:add-resource', 'effect:bonus-damage', 'effect:skip-phase'].includes(p)));
  pats.push(...matchPatterns(outer, CONDITIONS));
  pats.push(...matchPatterns(outer, DURATIONS));
  pats.push(...matchPatterns(outer, CHOICES));
  pats.push(...matchPatterns(outer, SCALING));
  if (!isStatic) pats.push(...matchPatterns(outer, PLAYS).filter(p => p !== 'play:as-you-play'));
  if (/^\[Equip\]|\[Equip\]/.test(effect)) pats.push('effect:equip');
  if (ab.prefixes?.length) for (const p of ab.prefixes) {
    if (p.keyword.startsWith('Level')) pats.push('condition:level');
    if (p.keyword === 'Legion') pats.push('condition:legion');
    if (p.keyword === 'Empowered') pats.push('condition:empowered');
  }
  // Grant / inner quoted abilities
  const quotes = [...effect.matchAll(/"([^"]+)"/g)].map(m => m[1]);
  if (quotes.length) pats.push('effect:grant-ability');
  ab.patterns.push(...pats);
  const targets = extractTargets(effect.replace(/"[^"]*"/g, ''));
  if (targets.length) { ab.targets = targets; for (const t of targets) ab.patterns.push(`target:${t.filter}`); }
  void card;
}

export function analyseCard(card: Card): ParsedAbility[] {
  const t = normalise(card.text);
  if (!t) return [];
  const lines = splitLines(t);
  const abilities = lines.map((l, i) => classify(card, l.head, l.modes, i));
  for (const a of abilities) a.patterns = [...new Set(a.patterns)];
  return abilities;
}

// ---------------------------------------------------------------------------------------------
// Batching: group scripted cards into ~8 batches by dominant mechanic family.
// ---------------------------------------------------------------------------------------------
export interface Family { id: string; title: string; score: (c: Card, a: ParsedAbility[], pats: Set<string>, text: string) => number }

const has = (s: Set<string>, ...ids: string[]) => ids.some(i => s.has(i));
const hasPrefix = (s: Set<string>, pre: string) => [...s].some(i => i.startsWith(pre));

export const FAMILIES: Family[] = [
  { id: 'B1-empower-xp-level-costs', title: 'Empower / Disempower, XP, Level, Hunt; self cost-modifiers and additional/alternative play costs',
    score: (_c, a, s, t) => (a.some(x => x.kind === 'play-modifier' && x.patterns.some(p => /^(static:cost-mod-self|play:additional-cost|play:alt-cost|play:x-cost)/.test(p))) ? 3 : 0) + (has(s, 'keyword:Empower', 'prefix:Empowered', 'effect:empower', 'effect:disempower', 'trigger:empower', 'condition:empowered') ? 6 : 0)
      + (has(s, 'prefix:Level', 'condition:level', 'effect:gain-xp', 'effect:spend-xp', 'cost:spend-xp', 'keyword:Hunt') ? 6 : 0) + (/\bXP\b/.test(t) ? 2 : 0) },
  { id: 'B2-equipment-gear-activated', title: 'Equipment & gear engines (Equip, attach/detach, Weaponmaster, Quick-Draw, Deploy gear, mana rocks) and activated abilities on units',
    score: (c, a, s, t) => (a.some(x => x.kind === 'activated') ? 2 : 0) + (has(s, 'keyword:Equip', 'effect:attach', 'effect:detach', 'trigger:attach', 'keyword:Weaponmaster', 'keyword:Quick-Draw', 'effect:equip') ? 6 : 0)
      + (c.type === 'Gear' ? 3 : 0) + (/Equipment|\bgear\b/i.test(t) ? 1 : 0) + (has(s, 'keyword:Deploy') ? 2 : 0) + (has(s, 'activated:mana') ? 3 : 0) },
  { id: 'B3-tokens-go-wide', title: 'Token makers & go-wide: tokens (Recruit, Gold, Mech, Bomb, Sprite, Bird, Sand Soldier, Shadow Clone, Tentacle), anthems, Legion, unit-count conditions',
    score: (_c, _a, s, t) => (has(s, 'static:anthem-might', 'static:anthem-keyword') ? 3 : 0) + (has(s, 'condition:legion', 'prefix:Legion', 'condition:count-units') ? 2 : 0) + (has(s, 'effect:play-token') ? 5 : 0) + (/\btokens?\b|\bMechs?\b|Sand Soldier|Gold\b/.test(t) ? 2 : 0) },
  { id: 'B4-combat-board', title: 'Combat, conquer/hold, attack/defend triggers, movement, Ganking, stun, Might statics',
    score: (_c, _a, s) => (has(s, 'trigger:attack', 'trigger:defend', 'trigger:attack-any', 'trigger:combat-start', 'trigger:combat-end', 'trigger:win-combat') ? 4 : 0)
      + (hasPrefix(s, 'trigger:conquer') || hasPrefix(s, 'trigger:hold') ? 3 : 0) + (has(s, 'effect:move', 'trigger:move', 'trigger:move-any', 'effect:swap-locations', 'effect:recall') ? 3 : 0)
      + (has(s, 'effect:stun') ? 2 : 0) + (has(s, 'static:self-might', 'static:anthem-might', 'static:self-keyword', 'static:anthem-keyword', 'static:combat-damage-rule') ? 2 : 0)
      + (has(s, 'static:enter-ready', 'static:play-location', 'keyword:Ganking', 'keyword:Ambush', 'keyword:Assault', 'keyword:Shield', 'keyword:Tank') ? 1 : 0) },
  { id: 'B5-removal-spells', title: 'Damage, kill, counter & interaction spells (incl. fight, split damage, bounce, control of spells)',
    score: (c, _a, s) => (c.type === 'Spell' ? 2 : 0) + (has(s, 'effect:deal-damage', 'effect:deal-damage-variable', 'effect:split-damage', 'effect:fight', 'effect:kill', 'effect:counter', 'effect:gain-control-spell') ? 5 : 0)
      + (has(s, 'effect:return-to-hand', 'effect:banish') ? 1 : 0) },
  { id: 'B6-pump-ready-buff', title: 'Might pumps/debuffs, buff counters, ready/exhaust, keyword grants this turn',
    score: (c, _a, s) => (has(s, 'effect:might-plus', 'effect:might-minus', 'effect:double-might', 'effect:set-base-might', 'effect:swap-might', 'effect:set-might-to-other') ? 4 : 0)
      + (has(s, 'effect:buff', 'effect:spend-buff', 'trigger:buff', 'trigger:spend-buff', 'cost:spend-buff') ? 4 : 0) + (has(s, 'effect:ready', 'trigger:become-exhausted', 'trigger:become-ready') ? 3 : 0)
      + (has(s, 'effect:grant-keyword') ? 2 : 0) + (c.type === 'Spell' ? 1 : 0) },
  { id: 'B7-cards-zones', title: 'Card flow & zones: draw/discard, look/reveal/predict/burn, play from trash/deck/banishment, Flow/Repeat, recycle, Hidden/face-down',
    score: (_c, _a, s) => (has(s, 'effect:look-top', 'effect:reveal-top', 'effect:predict', 'effect:burn', 'effect:mill', 'effect:select-from-revealed') ? 5 : 0)
      + (has(s, 'play:from-trash', 'play:from-banishment', 'effect:play-card-from-zone', 'effect:return-from-trash', 'zone:functions-from-trash', 'keyword:Flow') ? 5 : 0)
      + (has(s, 'effect:draw', 'effect:discard', 'trigger:discard', 'trigger:draw') ? 2 : 0) + (has(s, 'keyword:Repeat') ? 3 : 0)
      + (has(s, 'keyword:Hidden', 'trigger:play-from-facedown', 'trigger:hide', 'trigger:play-self-from-facedown', 'condition:zone-origin') ? 3 : 0) },
  { id: 'B8-legends-battlefields-rules', title: 'Legends, battlefields, cost/rules-modifying statics, replacement effects, resource abilities, and bespoke weird cards',
    score: (c, a, s) => (c.type === 'Legend' ? 7 : 0) + (c.type === 'Battlefield' ? 7 : 0) + (WEIRD.some(w => w.ids.includes(c.id)) ? 3 : 0)
      + (a.some(x => x.kind === 'replacement') ? 4 : 0) + (has(s, 'static:cost-mod-other', 'static:victory-rule', 'static:trigger-doubling', 'static:cant', 'static:hide-rule', 'static:deck-rule', 'static:resource-restriction') ? 3 : 0)
      + (has(s, 'activated:mana', 'effect:add-resource') ? 2 : 0) + (has(s, 'effect:copy', 'effect:take-control', 'effect:extra-turn', 'effect:win-game', 'effect:replace-battlefield') ? 4 : 0) },
];


// ---------------------------------------------------------------------------------------------
// Hand-curated cards needing bespoke engine hooks (beyond the generic DSL primitives).
// ---------------------------------------------------------------------------------------------
export const WEIRD: { hook: string; ids: string[]; note: string }[] = [
  { hook: 'extra-legends (deckbuilding + legend zone)', ids: ['rad-167-167'], note: 'Neeko: deck may register up to 3 extra legends (distinct names); on play choose one and it occupies your Legend Zone while Neeko is on the board (its abilities become active, exhaust state, etc.). Needs DeckList.extraLegends and a second legend object.' },
  { hook: 'extra-turn', ids: ['ogn-122-298'], note: 'Time Warp: take a turn after this one (rules 734 Additional Turns); then banish this.' },
  { hook: 'control-change: spells on chain', ids: ['ogn-080-298', 'ven-152-166'], note: 'Gain control of a spell on the chain and optionally make new choices (rule 750).' },
  { hook: 'control-change: permanents', ids: ['ogn-203-298', 'sfd-202-221', 'unl-140-219', 'sfd-109-221', 'ven-133-166'], note: 'Take control (+ recall / ready), temporary control with "lose control at end of turn", control "until I leave the board" with attach, give control of this to a chosen player.' },
  { hook: 'copy effects', ids: ['sfd-059-221', 'ven-137-166', 'unl-200-219', 'unl-199-219', 'unl-081-219', 'unl-t06'], note: 'Become a copy of a unit (Reflection tokens, Shady Spectacles while attached), copy a unit\'s text onto an Equipment (Svellsongur). Copies do not get play effects (unl-t06 reminder).' },
  { hook: 'ability sharing / granting to other card types', ids: ['ogn-111-298', 'sfd-112-221', 'sfd-208-221', 'rad-040-167', 'rad-147-167', 'ven-142-166', 'sfd-184-221', 'rad-139-167'], note: 'Heimerdinger has all [E] abilities of friendly legends/units/gear; Kato gives its keywords; battlefields/units grant quoted abilities to legends; spells grant quoted abilities this turn.' },
  { hook: 'token duplication / replacement', ids: ['unl-086-219', 'rad-132-167'], note: 'Zilean: play a token and an additional copy; Heimerdinger (AI): replace any unit-token creation with a 3 Might Mech.' },
  { hook: 'alternate win / scoring rules', ids: ['ogn-293-298', 'unl-088-219', 'ogn-276-298', 'sfd-060-221', 'sfd-209-221', 'ven-053-166', 'rad-069-167', 'sfd-148-221', 'ogs-011-024'], note: 'Win the game outright, change Victory Score, prohibit gaining points / scoring before turn 3, replace a score with a draw, make an opponent score.' },
  { hook: 'turn-structure modifications', ids: ['rad-019-167', 'ven-022-166', 'ven-036-166', 'ogn-284-298', 'ogn-290-298', 'rad-092-167'], note: 'Units don\'t ready in Awaken; skip Draw Phase; channel only 1 rune; first-Beginning-Phase effects; channel replacement (+1 rune).' },
  { hook: 'zone-change replacement', ids: ['ven-022-166', 'unl-007-219', 'sfd-018-221', 'unl-131-219'], note: 'Cards going to trash are banished instead; "if it would die this turn, banish it instead"; reveal replacement (look first, may recycle); countered spell returns to hand instead of trash.' },
  { hook: 'combat damage rules', ids: ['unl-118-219', 'ven-004-166', 'ogn-227-298', 'ogn-189-298', 'sfd-110-221', 'unl-013-219', 'unl-060-219', 'rad-042-167', 'ven-129-166', 'rad-085-167', 'sfd-082-221', 'unl-171-219', 'ogn-068-298', 'sfd-173-221', 'ven-084-166', 'ven-126-166'], note: 'Any damage is lethal; ignore Tank; tie => recall all; don\'t take damage / can\'t be dealt damage unless in combat; double Might this combat; double damage; conditional "doesn\'t deal combat damage"; "must be assigned combat damage last" (Backline-like in plain text); damage prevention shields.' },
  { hook: 'deck-construction exceptions', ids: ['ven-097-166', 'rad-167-167', 'sfd-190-221', 'sfd-191-221', 'sfd-192-221'], note: 'Any number of Spiderling; Neeko extra legends; [Unique] (max 1 copy).' },
  { hook: 'battlefield tokens / replacing battlefields', ids: ['unl-195-219', 'unl-t03', 'unl-147-219', 'unl-t01'], note: 'Replace a battlefield with a Brush token (and swap back when scored); Baron Nashor adds the Baron Pit battlefield token to the board and enters there; Baron Pit lets units move there from anywhere.' },
  { hook: 'naming cards / tags, gaining tags', ids: ['unl-138-219', 'ven-132-166', 'unl-177-219'], note: 'As you play: name a tag / name a spell (opponents can\'t play it); Ivern gains a chosen tag.' },
  { hook: 'type change (gear becomes unit)', ids: ['rad-145-167'], note: 'Lady of Clockwork: a gear becomes a unit gear with Might = Energy cost until another is chosen.' },
  { hook: 'multi-empower', ids: ['ven-134-166'], note: 'Kayle can be Empowered up to three times (counter, not boolean).' },
  { hook: 'trigger multipliers / suppressors', ids: ['ogn-236-298', 'rad-017-167', 'unl-029-219', 'unl-087-219', 'ogn-286-298', 'unl-090-219'], note: 'Deathknell triggers twice; conquer/hold effects for this battlefield trigger an additional time; "activate the conquer effects of units here"; [Temporary] effects at a battlefield don\'t trigger.' },
  { hook: 'hidden-card rule changes', ids: ['ogn-018-298', 'ogn-278-298', 'rad-108-167', 'ogn-263-298', 'ogn-264-298', 'unl-053-219', 'ven-160-166'], note: 'Hidden cards can\'t be revealed here; hide an additional card per battlefield; alternate hide cost; hide ignoring costs; look at opponents\' facedown cards; Reaction cards cost more in showdowns here.' },
  { hook: 'opponent decisions inside effects', ids: ['ogn-033-298', 'sfd-136-221', 'rad-064-167', 'ogn-071-298', 'ogn-237-298', 'ogn-244-298', 'ven-090-166', 'ogn-187-298', 'ogn-115-298', 'unl-020-219', 'sfd-081-221', 'unl-139-219', 'ogn-209-298', 'ogn-179-298', 'unl-164-219', 'unl-170-219', 'unl-174-219', 'rad-113-167', 'unl-101-219'], note: 'Decision goes to a non-controller: punisher ("unless its controller..."), guess a card type, Cards-or-Runes, each player chooses/kills, opponent may replay Dancing Grenade, opponent picks a unit to move/kill.' },
  { hook: 'reveal-from-deck self triggers', ids: ['ogn-194-298', 'sfd-175-221'], note: 'Abilities that work while the card is being looked at / revealed from the top of a deck.' },
  { hook: 'linked banishment ("banished with this")', ids: ['sfd-090-221', 'unl-148-219', 'unl-181-219', 'rad-136-167', 'unl-169-219', 'rad-140-167'], note: 'Track which cards a source banished; play them later; Ashe returns the card when that player holds. NOTE sfd-090 The Zero Drive text references units banished with it but nothing in its effective text banishes; reminder adds "(Use only if unattached.)". Check printed card.' },
  { hook: 'play permission from banishment / trash', ids: ['rad-012-167', 'rad-015-167', 'ven-022-166', 'ven-113-166'], note: '"Until your next Ending Phase, you may play that card" (you still pay its costs); "You may play cards from your trash"; give a spell [Flow] equal to its cost.' },
  { hook: 'restricted resources', ids: ['ogn-247-298', 'ogs-014-024', 'sfd-189-221', 'rad-143-167', 'unl-197-219', 'ven-141-166', 'sfd-201-221'], note: 'Added Power/Energy that can only be spent on spells / gear / units / during showdowns; Gold adds an additional [1].' },
  { hook: 'cost-rule modifiers', ids: ['sfd-149-221', 'rad-151-167', 'ven-160-166', 'ven-164-166', 'ven-158-166', 'ven-157-166', 'sfd-146-221', 'ogn-014-298', 'ven-163-166', 'sfd-211-221', 'unl-196-219', 'unl-168-219'], note: 'Optional additional costs cost less; exhaust 4 permanents as extra cost to reduce a spell; spells choosing units here cost less; ignore Deflect for things here; any player may pay to play a Dragon to this battlefield; costs reduced by highest Might / tags / Repeat costs.' },
  { hook: 'rune-deck interaction', ids: ['ogn-200-298', 'rad-160-167', 'rad-016-167', 'ogn-287-298'], note: 'Reveal top rune and branch on its domain; Rune Deck empty condition; recycle all runes then channel 4; recycle one of your runes.' },
  { hook: 'Repeat / Flow granting and multi-mode Repeat', ids: ['unl-182-219', 'unl-216-219', 'sfd-078-221', 'unl-146-219', 'ven-113-166', 'unl-017-219'], note: 'Repeat with a list of escalating costs and "choose one you haven\'t already chosen"; give next spell Repeat equal to its cost; your spells have Repeat [2][C] in showdowns; Repeat with a discard cost.' },
  { hook: 'timing permission granted to other cards', ids: ['rad-063-167', 'rad-091-167', 'sfd-054-221', 'ogn-129-298'], note: 'Your spells have [Reaction] while in a showdown; Deploy gear have [Action]; Equipment have [Quick-Draw].' },
  { hook: 'prohibitions on ready / choose / play', ids: ['ogn-070-298', 'unl-144-219', 'sfd-105-221', 'ven-038-166', 'unl-057-219', 'ogn-026-298', 'rad-084-167', 'unl-190-219', 'sfd-216-221', 'sfd-015-221', 'ven-029-166', 'ogn-295-298', 'sfd-014-221', 'unl-111-219'], note: 'Spells/abilities can\'t ready enemy units; can\'t be readied; can\'t be chosen by enemy spells (conditionally); opponents can\'t play cards/spells this turn; can\'t be played here / except to a conquered battlefield / before turn 4; can\'t move to base.' },
  { hook: 'delayed triggers & "next time" memory', ids: ['unl-050-219', 'ogn-289-298', 'rad-142-167', 'ogn-254-298', 'ogn-221-298', 'sfd-194-221', 'rad-047-167', 'unl-052-219', 'unl-087-219', 'ogn-023-298'], note: 'At the start of your next Main Phase; at end of turn; "kill it the next time it takes damage"; "the next three times you play a unit"; "the next time it would die".' },
  { hook: 'chain-aware targeting', ids: ['sfd-045-221', 'unl-106-219', 'ven-040-166', 'ogn-292-298', 'ven-086-166', 'sfd-141-221', 'sfd-206-221', 'ven-069-166'], note: 'Counter an enemy spell that chooses a friendly unit (and no other); "being chosen by an enemy Fury spell"; first time a player chooses a friendly unit here; replace effects of spells that choose me; your spells can\'t be countered.' },
  { hook: 'mode memory ("one you haven\'t chosen this turn")', ids: ['ogn-157-298', 'rad-043-167', 'sfd-049-221', 'unl-182-219'], note: 'Per-object per-turn record of modes already chosen.' },
  { hook: 'pseudo-cards (no script)', ids: ['unl-t04', 'unl-t08'], note: 'Buff and XP Tracker tokens are rules reminders (one buff per unit; XP tracking). Engine-level concepts.' },
];


const KW_REMINDER_START = /^(Play on your turn|Play any time, even before|You may pay|\+\d|Opponents must pay|I can move|While this is a unit, it can|I must be assigned|Hide now|You may play me as|This has \[Reaction\]|\[\d|\[C\]|\[A\]|When you play me, you may \[Equip\]|You may play this from your trash for|Pay the cost|When you play (?:me|this), look|When I conquer or hold|Kill (?:me|this) at|You may pay the additional|Your deck can have only|Get the effect|When I die|While you have|Look at the top|Put the top|To Burn|They put|They look|It doesn.t deal|A stunned|To buff|Give (?:me|it|the friendly)|As you play|A unit is Mighty|I.m Mighty|When I attack, give|Play this only to a battlefield|Neutral cards|Abilities that add resources|It has|Gold tokens have|Use this ability only while you have|Send it to base|Each instance of damage|If (?:I|it) (?:don't|doesn't) have a buff|Each one that doesn't have a buff|Give each a \+1|I get a \+1|Kill (?:it|each|them) at the start|To Predict|\[[RGBOPY]\]$|I become Empowered|It becomes Empowered|It can move|They can move|We can move|It must be assigned|They must be assigned|When this dies|When you play us|Play them any time|When each of us attacks|They have)/;

function replaceBlock(file: string, tag: string, body: string): void {
  let doc: string;
  try { doc = readFileSync(file, 'utf8'); } catch { return; }
  const start = `<!-- GENERATED:${tag} -->`, end = `<!-- /GENERATED:${tag} -->`;
  const i = doc.indexOf(start), j = doc.indexOf(end);
  if (i < 0 || j < 0) return;
  writeFileSync(file, doc.slice(0, i + start.length) + '\n' + body.trim() + '\n' + doc.slice(j));
}

const CAT_TITLES: [string, string][] = [
  ['kind', 'Ability kinds'], ['keyword', 'Keyword abilities (whole-line keywords)'], ['prefix', 'Keyword prefixes ([Kw][>] ...)'],
  ['trigger', 'Trigger events (base event, then /subject[@here] variants)'], ['activated', 'Activated abilities'],
  ['effect', 'Effect verbs'], ['target', 'Target filters (quantity|type|qualifiers|location|value-filter)'],
  ['condition', 'Conditions'], ['duration', 'Durations'], ['cost', 'Cost components (activated, keyword and additional costs)'],
  ['static', 'Static / continuous modifications'], ['replacement', 'Replacement effects'], ['play', 'Play-time modifiers & zones'],
  ['zone', 'Zone functionality'], ['choice', 'Choices / modality'], ['scaling', 'Scaling'],
];

function generateDocs(cards: Record<string, Card>, analysis: Record<string, { abilities: ParsedAbility[] }>,
  catalogue: { id: string; count: number; desc: string; examples: string[] }[], batchJson: { keywordsOnly: string[]; batches: { id: string; title: string; count: number; cards: string[] }[] }): void {
  const lines: string[] = [];
  for (const [cat, title] of CAT_TITLES) {
    const rows = catalogue.filter(c => c.id.split(':')[0] === cat).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
    if (!rows.length) continue;
    lines.push(`### ${title}`, '', `${rows.length} distinct. Count = number of cards.`, '', '| pattern | cards | meaning | examples |', '|---|---:|---|---|');
    for (const r of rows) lines.push(`| \`${r.id.replace(/\|/g, '\\|')}\` | ${r.count} | ${r.desc.replace(/\|/g, '/')} | ${r.examples.join(', ')} |`);
    lines.push('');
  }
  replaceBlock('docs/card-patterns.md', 'CATALOGUE', lines.join('\n'));

  const w: string[] = [];
  for (const g of WEIRD) {
    w.push(`#### ${g.hook}`, '', g.note, '');
    for (const id of g.ids) {
      const c = cards[id];
      if (!c) { w.push(`- \`${id}\` (missing from cards.json)`); continue; }
      w.push(`- \`${id}\` **${c.name}${c.subtitle ? ', ' + c.subtitle : ''}** (${c.type}): ${c.text.replace(/\n/g, ' / ')}`);
    }
    w.push('');
  }
  replaceBlock('docs/card-patterns.md', 'WEIRD', w.join('\n'));

  // Rules-relevant parentheticals that tools/build-cards.ts strips from `text`.
  const par: string[] = ['| card | parenthetical (only in reminderText) |', '|---|---|'];
  for (const c of Object.values(cards) as (Card & { reminderText?: string })[]) {
    for (const m of (c.reminderText ?? '').matchAll(/\(([^()]*)\)/g)) {
      if (KW_REMINDER_START.test(m[1].trim())) continue;
      par.push(`| \`${c.id}\` ${c.name} | ${m[1].replace(/\|/g, '/')} |`);
    }
  }
  replaceBlock('docs/card-patterns.md', 'PARENTHETICALS', par.join('\n'));

  const b: string[] = [];
  const fam = (id: string) => {
    const pats = new Set(analysis[id].abilities.flatMap(a => a.patterns));
    return [...pats].filter(p => /^(keyword|trigger|effect|static|replacement|play):/.test(p) && !p.includes('/')).slice(0, 6).join(', ');
  };
  b.push('| batch | cards | scope |', '|---|---:|---|');
  for (const x of batchJson.batches) b.push(`| ${x.id} | ${x.count} | ${x.title} |`);
  b.push(`| B0-keywords-only | ${batchJson.keywordsOnly.length} | Cards whose whole text is generic keywords: register keywords only, no bespoke script. |`, '');
  for (const x of batchJson.batches) {
    const bySet: Record<string, number> = {}; const byType: Record<string, number> = {};
    for (const id of x.cards) { bySet[cards[id].set] = (bySet[cards[id].set] ?? 0) + 1; byType[cards[id].type] = (byType[cards[id].type] ?? 0) + 1; }
    b.push(`### ${x.id} (${x.count})`, '', x.title, '', `Types: ${Object.entries(byType).map(([k, v]) => `${k} ${v}`).join(', ')}. Sets: ${Object.entries(bySet).map(([k, v]) => `${k} ${v}`).join(', ')}.`, '',
      '<details><summary>cards</summary>', '', '| id | name | key patterns |', '|---|---|---|');
    for (const id of x.cards) b.push(`| \`${id}\` | ${cards[id].name}${cards[id].subtitle ? ', ' + cards[id].subtitle : ''} | ${fam(id)} |`);
    b.push('', '</details>', '');
  }
  b.push('### B0-keywords-only', '', batchJson.keywordsOnly.map(id => `\`${id}\` ${cards[id].name}`).join(', '), '');
  replaceBlock('docs/card-batches.md', 'BATCHES', b.join('\n'));
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------
function main(): void {
  const cards: Record<string, Card> = JSON.parse(readFileSync('data/cards.json', 'utf8'));
  const analysis: Record<string, { name: string; type: string; set: string; text: string; scriptNeed: string; intrinsicKeywords: string[]; keywordCosts: Record<string, string>; abilities: ParsedAbility[] }> = {};
  const counts = new Map<string, Set<string>>();
  const unclassified: string[] = [];

  for (const c of Object.values(cards)) {
    const abilities = analyseCard(c);
    const need = !c.text ? 'none' : abilities.every(a => a.kind === 'keyword' || a.kind === 'reminder')
      ? (abilities.some(a => a.kind === 'reminder') ? 'reminder-only' : 'keywords-only') : 'script';
    const weird = WEIRD.filter(w => w.ids.includes(c.id)).map(w => w.hook);
    if (weird.length && abilities.length) abilities[0].patterns.push(...weird.map(h => `weird:${h.replace(/\s*\(.*$/, '').replace(/[^a-z0-9]+/gi, '-').replace(/-+$/, '').toLowerCase()}`));
    // Keywords the card itself has (CardDef.keywords also lists keywords merely mentioned / granted / in token reminders).
    const intrinsicKeywords: string[] = []; const keywordCosts: Record<string, string> = {};
    for (const a of abilities) if (a.kind === 'keyword' || a.kind === 'keyword-cost') for (const k of a.keywords ?? []) {
      intrinsicKeywords.push(k.value !== undefined ? `${k.name} ${k.value}` : k.name);
      if (k.cost !== undefined) keywordCosts[k.name] = k.cost;
    }
    analysis[c.id] = { name: c.subtitle ? `${c.name}, ${c.subtitle}` : c.name, type: c.type, set: c.set, text: c.text, scriptNeed: need, intrinsicKeywords, keywordCosts, abilities };
    for (const a of abilities) {
      for (const p of [...a.patterns, `kind:${a.kind}`]) { if (!counts.has(p)) counts.set(p, new Set()); counts.get(p)!.add(c.id); }
      if (a.patterns.includes('static:other') || a.patterns.includes('trigger:other')) unclassified.push(`${c.id} | ${a.raw}`);
    }
  }

  const desc = new Map<string, string>(ALL_PATTERNS.map(p => [p.id, p.desc]));
  for (const [k, v] of Object.entries(KW_DESC)) desc.set(`keyword:${k}`, v);
  for (const [k, v] of Object.entries(PREFIX_DESC)) desc.set(`prefix:${k}`, v);
  for (const [k, v] of Object.entries(KIND_DESC)) desc.set(`kind:${k}`, v);
  desc.set('activated:ability', 'COST: EFFECT activated ability (uses the chain).');
  desc.set('activated:mana', 'Activated ability that [Add]s resources (no chain, can\'t be reacted to).');
  desc.set('zone:functions-from-trash', 'Triggered ability that works while the card is in the trash (or as it is discarded).');
  desc.set('trigger:deathknell', '[Deathknell][>]: when I die, get the effect.');
  desc.set('trigger:phase', 'Any phase-timed trigger (start/end of phase or turn).');
  desc.set('trigger:other', 'Unrecognised trigger clause (should be 0).');
  desc.set('static:other', 'Unrecognised static (should be 0).');
  desc.set('condition:intervening-if', 'Trigger with an intervening "if" right after the trigger clause (check on trigger and on resolution).');
  const verbsByFilter = new Map<string, Map<string, number>>();
  for (const v of Object.values(analysis)) for (const a of v.abilities) for (const t of a.targets ?? []) {
    const m = verbsByFilter.get(t.filter) ?? new Map<string, number>(); m.set(t.verb, (m.get(t.verb) ?? 0) + 1); verbsByFilter.set(t.filter, m);
  }
  for (const [f, m] of verbsByFilter) desc.set(`target:${f}`, 'verbs: ' + [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => `${k} (${n})`).join(', '));
  for (const id of counts.keys()) if (!desc.has(id) && id.includes('/')) {
    const [base, v] = id.split('/');
    desc.set(id, `${base} where the actor is ${v.replace('@here', '')}${v.includes('@here') ? ', at this battlefield / my battlefield' : ''}.`);
  }
  const catalogue = [...counts.entries()].map(([id, set]) => ({ id, count: set.size, desc: desc.get(id) ?? '', examples: [...set].sort().slice(0, 3) }))
    .sort((a, b) => a.id.localeCompare(b.id));

  // Batches
  const scripted = Object.entries(analysis).filter(([, v]) => v.scriptNeed === 'script').map(([id]) => id).sort();
  const keywordOnly = Object.entries(analysis).filter(([, v]) => v.scriptNeed === 'keywords-only').map(([id]) => id).sort();
  const target = Math.ceil(scripted.length / FAMILIES.length);
  const cap = Math.ceil(target * 1.02);
  const scoresOf = (id: string) => {
    const c = cards[id]; const a = analysis[id].abilities; const s = new Set(a.flatMap(x => x.patterns));
    return FAMILIES.map(f => f.score(c, a, s, c.text));
  };
  const scored = scripted.map(id => ({ id, sc: scoresOf(id) }));
  // Most decisive cards first (largest gap between best and second-best family).
  scored.sort((x, y) => {
    const gap = (v: number[]) => { const s = [...v].sort((a, b) => b - a); return s[0] - s[1]; };
    return gap(y.sc) - gap(x.sc) || x.id.localeCompare(y.id);
  });
  const batches: string[][] = FAMILIES.map(() => []);
  for (const { id, sc } of scored) {
    // Best-scoring family with room; ties -> emptier batch. Zero-score fallback -> emptiest batch.
    const order = sc.map((v, i) => ({ v, i })).filter(o => o.v > 0)
      .sort((a, b) => b.v - a.v || batches[a.i].length - batches[b.i].length || a.i - b.i);
    const pick = order.find(o => batches[o.i].length < cap)
      ?? { i: batches.map((b, i) => ({ n: b.length, i })).sort((a, b) => a.n - b.n)[0].i };
    batches[pick.i].push(id);
  }
  const batchJson = {
    generatedBy: 'tools/analyze-cards.ts',
    note: 'Scripted cards (scriptNeed=script) split into mechanic-family batches. keywordsOnly cards need no bespoke script beyond keyword registration (assign to whichever agent owns keyword plumbing, or batch B0).',
    keywordsOnly: keywordOnly,
    batches: FAMILIES.map((f, i) => ({ id: f.id, title: f.title, count: batches[i].length, cards: batches[i].sort() })),
  };

  writeFileSync('data/card-analysis.json', JSON.stringify(analysis, null, 1));
  writeFileSync('data/card-patterns.json', JSON.stringify(catalogue, null, 1));
  writeFileSync('data/card-batches.json', JSON.stringify(batchJson, null, 1));
  try { writeFileSync('/tmp/rf/unclassified.txt', unclassified.join('\n')); } catch { /* scratch output only */ }
  generateDocs(cards, analysis, catalogue, batchJson);
  const kinds: Record<string, number> = {};
  for (const v of Object.values(analysis)) for (const a of v.abilities) kinds[a.kind] = (kinds[a.kind] ?? 0) + 1;
  console.log(`cards: ${Object.keys(analysis).length}, scripted: ${scripted.length}, keywords-only: ${keywordOnly.length}, abilities by kind:`, kinds);
  console.log('batches:', batchJson.batches.map(b => `${b.id}=${b.count}`).join(', '));
  console.log(`unclassified abilities: ${unclassified.length} (see /tmp/rf/unclassified.txt)`);
}

if (process.argv[1] && /analyze-cards\.ts$/.test(process.argv[1])) main();

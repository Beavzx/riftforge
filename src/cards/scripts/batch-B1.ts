// Batch B1 card scripts (empower / XP / level / costs). Owned by scripting agent B1.
// Card texts (cards.json `text`) are kept in TX so the registered text always matches the data.
import {
  card, spell, spellModes, mode, onPlay, deathknell, onAttack, onCombatRole, onConquer, onMove, whenYouPlay, whenYouHold,
  whenUnitDies, atEndOfTurn, activated, statik, selfMight, selfKeyword, anthem, replacement, costMod, costModDyn, playRule, rule,
  asPlay, when, grantable, delayedAbility, reflexiveAbility, E, T, F, C, dep, on, pay, cost, type Ctx, type ObjId, type PlayerId,
} from '../dsl.ts';
import {
  selfCostB1, payB1, paidB1, empowerB1, empowererOf, empoweredThingsOf, xpGainedThisTurn,
  conqueredThisTurn, holdPointsThisTurn, oppNearVictory, isOpenBattlefield, inCurrentCombat,
  chosenByResolvingItem,
} from '../helpers/B1.ts';

void grantable; void costMod; void C;

export const TX: Record<string, string> = {
  "ogn-002-298": "As you play me, you may discard a card as an additional cost. If you do, reduce my cost by [2].", // Brazen Buccaneer
  "ogn-012-298": "[Legion] — I cost [2] less.", // Noxus Hopeful
  "ogn-044-298": "You may pay [C] as an additional cost to play me.\nWhen you play me, if you paid the additional cost, draw 1.", // Clockwork Keeper
  "ogn-047-298": "[Action]\nIf an opponent's score is within 3 points of the Victory Score, this costs [2] less.\nDraw 1 and channel 1 rune exhausted.", // Find Your Center
  "ogn-048-298": "[Reaction]\nAs an additional cost to play this, you may exhaust a friendly unit. If you do, draw 2. Otherwise, draw 1.", // Meditation
  "ogn-144-298": "[Reaction]\nIf an enemy unit has died this turn, this costs [2] less.\nDraw 2.", // Spoils of War
  "ogn-195-298": "I cost [1] less for each card in your trash.", // Rhasa the Sunderer
  "rad-028-167": "[Action]\nAs an additional cost to play this, exhaust a friendly unit.\n[Stun] a unit.", // Ki Burst
  "rad-029-167": "[Reaction]\nAs an additional cost to play this, exhaust a friendly unit.\nDraw 1 and channel 1 rune exhausted.", // Life from Stone
  "rad-061-167": "As an additional cost to play me, return a friendly unit to its owner's hand.\n[Ganking]", // Ekko
  "rad-075-167": "You may return a friendly gear to its owner's hand as an additional cost to play me. If you do, I cost [2] less.\n[Deflect]", // Skystrike Squadron
  "rad-080-167": "I cost [2] less for each battlefield you've conquered this turn.", // Bloodscent Swarm
  "rad-122-167": "I cost [1] less for each exhausted unit you control.\n[Tank]", // Party Crasher
  "sfd-010-221": "I cost [2] less to play from anywhere other than your hand.", // Void Drone
  "sfd-012-221": "I cost [1] less for each card you've played this turn, to a minimum of [1].", // Battering Ram
  "sfd-039-221": "When you play me, ready or exhaust a legend.", // Royal Entourage
  "sfd-044-221": "As an additional cost to play me, return a friendly gear to its owner's hand.", // Legion Quartermaster
  "sfd-055-221": "[Shield 5]\n[Tank]\nI cost [2][C] less for each point you scored from holding this turn.", // Needlessly Large Yordle
  "sfd-079-221": "You may exhaust your legend as an additional cost to play me.\nWhen you play me, if you paid the additional cost, move any number of your units to an open battlefield.", // Bard
  "sfd-087-221": "[Reaction]\nDraw 3.", // Premonition
  "sfd-103-221": "[Accelerate]\nI cost [2] less for each of your [Mighty] units.", // Jaull-Fish
  "sfd-106-221": "[Reaction]\nDraw 1 for each of your [Mighty] units.", // Show of Strength
  "unl-013-219": "[Hidden]\n[Reaction]\nChoose a unit. Double all damage that would be dealt to it this turn.", // Lotus Trap
  "unl-015-219": "Draw 1, then draw 1 for each battlefield you or allies control.", // Right of Conquest
  "unl-016-219": "[Hunt 2]\n[Level 3][>] I have +1 [S] and enter ready.", // Scorchclaw
  "unl-017-219": "[Repeat] — Discard 1\nGive a unit [Assault 4] this turn.", // Square Up
  "unl-031-219": "[Reaction]\nGive a unit +1 [S] this turn.\n[Level 6][>] Give it +3 [S] this turn instead.", // Combat Experience
  "unl-034-219": "[Hunt]\nWhen you play me, gain 2 XP.", // Herald of Spring
  "unl-035-219": "If an opponent controls a stunned unit, I cost [2] less and enter ready.", // Monch
  "unl-038-219": "Move an enemy unit.\n[Level 6][>] [Stun] an enemy unit.", // Skyward Strike
  "unl-040-219": "[Hunt]\n[Level 6][>] When you play me, draw 1.", // Wuju Apprentice
  "unl-047-219": "[Hunt 2]\n[Level 3][>] I have +1 [S] and [Deflect].", // Mosstomper
  "unl-053-219": "When you play me, draw 1.\n[Deathknell][>] Choose an opponent. They reveal their hand. You can look at their facedown cards this turn. Gain 1 XP.", // Scuttle Crab
  "unl-059-219": "[Level 3][>] I cost [2][C] less.\n[Level 6][>] I cost [4][C][C] less instead.\n[Level 11][>] I cost [6][C][C][C] less instead.\n[Level 16][>] I can't be chosen by enemy spells and abilities.", // Master Yi
  "unl-063-219": "[Reaction]\nGive a unit -4 [S] this turn.\n[Predict].", // Eclipse
  "unl-075-219": "[Hunt 2]\n[Level 3][>] I have +1 [S] and [Ganking].", // Gustwalker
  "unl-091-219": "Draw 2.\n[Level 6][>] This costs [2] less.\n[Level 11][>] This costs [4] less instead.", // Concentrate
  "unl-092-219": "When you play me, gain 1 XP.", // Demacian Diplomat
  "unl-094-219": "[Hunt]\n[Level 6][>] I have +1 [S].", // Gemhand Hunter
  "unl-095-219": "[Action]\nGive a friendly unit +3 [S] this turn. When it wins a combat this turn, gain 2 XP.", // Grim Resolve
  "unl-098-219": "[Level 11][>] I have +4 [S].", // Targonian Visionary
  "unl-102-219": "[Hunt]\nSpend 2 XP: [Buff] me.", // Crowd Favorite
  "unl-103-219": "[Reaction]\nChoose one —\n- Choose up to 3 cards from opponents' trashes. Their owners recycle them.\n- Draw 1.", // Disposal Order
  "unl-107-219": "Choose a friendly unit and a battlefield. Move all enemy units at that battlefield with less Might than the chosen unit to their base. Gain 1 XP.", // Stare Down
  "unl-108-219": "If you've gained XP this turn, I have +1 [S] and [Ganking].", // Wily Newtfish
  "unl-109-219": "When you play a unit, you may pay [1] to gain 1 XP.\nSpend 3 XP, [T]: Ready a unit.", // Blood Rose
  "unl-113-219": "[Hunt 2]\n[Level 6][>] I have [Deflect] and [Ganking].", // Master Yi
  "unl-115-219": "[Accelerate]\n[Ganking]\nWhen I move, gain 1 XP.", // Nilah
  "unl-116-219": "[Deflect]\nWhen you play me, if an opponent's score is within 3 points of the Victory Score, ready me and gain 3 XP.", // Poppy
  "unl-117-219": "[Hunt 2]\nI can be played to an occupied battlefield if an enemy unit is alone there.\nFriendly units can be played to an occupied battlefield if an enemy unit is alone there.", // Arachnoid Horror
  "unl-119-219": "[Hunt]\nWhen I attack, you may spend 3 XP to deal damage equal to my Might to an enemy unit here.", // Kha'Zix
  "unl-122-219": "If you've played a spell this turn, you may pay [C] as an additional cost to play me. If you do, I enter ready.", // Crescent Guardian
  "unl-125-219": "[Reaction]\nDiscard 1, then draw 2.", // Lunar Boon
  "unl-126-219": "Spend 3 XP: Give your units here [Ganking] this turn.", // Megatusk
  "unl-127-219": "[Accelerate]\nWhen I move to a battlefield, gain 2 XP.", // Mister Root
  "unl-129-219": "When another friendly unit dies, gain 1 XP.", // Vicious Snapjaws
  "unl-132-219": "When you play me, return all units with 2 [S] or less to their owners' hands.", // Angler Beast
  "unl-135-219": "When you play me, choose an opponent. They reveal their hand. You may pay 2 XP to choose a card from their hand. If you do, they discard that card and draw 1.", // Insightful Investigator
  "unl-136-219": "This enters exhausted.\nKill this, [1], [T]: [Predict 2], then draw 1. Gain 1 XP.", // Scryer's Bloom
  "unl-140-219": "You may spend 5 XP as an additional cost to play this.\nChoose an enemy unit at a battlefield with 3 [S] or less. If you paid the additional cost, choose any enemy unit at a battlefield instead. Take control of it, exhaust it, and recall it.", // Conscription
  "unl-143-219": "[Ambush]\nWhen I attack or defend, if an enemy unit is alone here, give me +2 [S] this turn and gain 2 XP.", // Kha'Zix
  "unl-151-219": "[Level 3][>] I enter ready.", // Bandle Soldier
  "unl-157-219": "When you play me, gain 1 XP for each friendly unit.", // Scrutinizing Sergeant
  "unl-162-219": "[Hunt]\nSpend 2 XP: [Buff] me.", // Enthralling Protector
  "unl-163-219": "Opponents must pay [A] for each unit beyond the first to move multiple units to my battlefield at the same time.", // Mageseeker Investigator
  "unl-164-219": "You may spend 3 XP as an additional cost to play me.\nWhen you play me, each player must kill one of their units. If you paid my additional cost, you don't kill a unit this way.", // Safety Inspector
  "unl-178-219": "You may spend 3 XP as an additional cost to play me. If you do, I cost [3] less.\n[Ambush]\n[Tank]", // Poppy
  "unl-191-219": "[Level 6][>] Your units have +1 [S].\n[Level 11][>] Your units enter ready.", // Wuju Master
  "unl-192-219": "[Action]\nChoose a friendly unit. It deals damage equal to its Might split among enemy units at battlefields. Then for each unit this kills, do this: Gain 1 XP.", // Alpha Strike
  "unl-201-219": "When you win a combat, gain 1 XP.\nSpend 1 XP, [T]: [Buff] a unit.\nSpend 2 XP, [T]: Move an exhausted friendly unit from a battlefield to its base.", // Voidreaver
  "unl-203-219": "When you hold, gain 1 XP.\nSpend 3 XP, [T]: Draw 1.", // Keeper of the Hammer
  "ven-001-166": "[Empower] [5]. This ability costs [3] less if you control 4 or fewer runes.\n[Empowered][>] I have [Deflect] and [Assault 2].", // Baccai Sandspinner
  "ven-007-166": "[Empower] — Discard 1\n[Empowered][>] I have +1 [S].", // Punching Poro
  "ven-014-166": "[Empower] [2][C]\n[Empowered][>] I have [Assault 3].", // Shadow Fiend
  "ven-018-166": "[Empower] [6][C]\nYour units have +1 [S]. If I'm [Empowered], they have +2 [S] instead.", // Rage Amplifier
  "ven-021-166": "[Empower] [2][C]\nWhen I move, you may deal 1 to a unit at a battlefield I moved to or from. If I'm [Empowered], deal 2 instead.\n[Empowered][>] I have +1 [S].", // Akali
  "ven-028-166": "When a combat that I was in ends, empower me.\n[Empowered][>] I have +2 [S].", // Mournful Witness
  "ven-030-166": "[Empower] [3]\n[Empowered][>] I have [Deflect] and [Shield 3].", // Serene Ascetic
  "ven-031-166": "Give a friendly unit +1 [S] this turn. It can't be chosen by enemy spells and abilities this turn.\n[Flow] [2]", // Twilight Shroud
  "ven-032-166": "[Empower] [12]. This ability costs [1] less for each rune you control.\n[Empowered][>] I have +3 [S].", // Frostcoat Mother
  "ven-035-166": "[Reaction]\nChoose one —\n- Empower a unit. Disempower it at end of turn.\n- Disempower a unit that's [Empowered]. Empower it at end of turn.", // Sanction
  "ven-037-166": "When you play me, if you control 7 or more runes, choose an enemy gear. If it's [Empowered], disempower it. Otherwise, kill it.", // Tomb-Raider Barbara
  "ven-043-166": "[Deflect]\n[Empower] [7]\n[Empowered][>] I have +7 [S].", // Steel Paws
  "ven-045-166": "[Empower] [4][C]\nOpponents' spells cost [1] more. If this is [Empowered], they cost [1][A] more instead.", // Helm of Suppression
  "ven-046-166": "[Deflect 2]\n[Empower] [8]\n[Empowered][>] When I conquer, you score 1 point.", // Nasus
  "ven-047-166": "[Empower] [2]\nWhen I become [Empowered], [Predict 2].\n[Empowered][>] I have +1 [S].", // Apprentice Mage
  "ven-050-166": "[Empower] [12]. This ability costs [1] less for each rune you control.\n[Empowered][>] I have [Deflect] and [Shield 3].", // Grumpy Rockbear
  "ven-054-166": "[Empower] — [T]\nDisempower this, [1], [T]: Draw 1.", // Questionable Tome
  "ven-055-166": "[Empower] [3]\n[Empowered][>] Your spells cost [1][A] less, to a minimum of [1].", // Applied Researchers
  "ven-057-166": "[Empower] [3]\n[Empowered][>] When I move, draw 1.", // Covert Informant
  "ven-059-166": "[Action]\nThis costs [2] less if you control something that's [Empowered].\nDeal 4 to a unit at a battlefield.", // Shock Blast
  "ven-062-166": "This enters exhausted.\n[T]: Empower another gear.", // Hextech Formula
  "ven-064-166": "I cost [1] less for each gear you control.\n[Deflect]", // Plaza Guardian
  "ven-069-166": "When you play me, draw 1.\n[Empower] [3]\n[Empowered][>] Your spells and abilities can't be countered. If a spell or ability you control would give -[S] to a unit it chooses, it gives an additional -1 [S].", // Mel
  "ven-070-166": "[Empower] [3]\n[Empowered][>] I have +2 [S] and [Ganking].", // Brutal Hunter
  "ven-072-166": "[Action]\nGive a unit +2 [S] this turn. If it's [Empowered], give it +4 [S] this turn instead.", // Guttural Roar
  "ven-074-166": "[Empower] — [1] or [C]\n[Empowered][>] I have +1 [S].", // Legion Marauder
  "ven-077-166": "[Empower] [2]\n[T]: Give a unit +2 [S] this turn. If this is [Empowered], give that unit +4 [S] this turn instead.", // Tools of Empire
  "ven-078-166": "[Empower] [1][A][A]\n[Empowered][>] I have +2 [S].\n[Empowered][>][>>][Deathknell][>] Channel 2 runes exhausted.", // Baccai Witherclaw
  "ven-079-166": "[Empower] [5][C]\n[Empowered][>] When I attack or defend, choose a unit here. Increase my Might to its Might this turn, then give me +1 [S] this turn.", // Dame the Despoiler
  "ven-081-166": "Give a unit +6 [S] this turn.\n[Flow] [4]", // Onslaught
  "ven-082-166": "When you play me, you may disempower something you control to empower a legend, unit, or gear.", // Profiteer
  "ven-084-166": "[Empower] [3][C]\n[Empowered][>] I have +3 [S] and can't be dealt damage unless I'm in combat.", // Ambessa
  "ven-086-166": "[Empower] [C][C]\n[Empowered][>] If a spell or ability that chooses me would stun me, give me -[M], or return me to hand, give me +3 [M] this turn instead.", // Gangplank
  "ven-092-166": "[1]: Give me +1 [S] this turn.\nWhen my Might becomes 10 or more, empower me.\n[Empowered][>] I have [Deflect] and [Ganking].", // Renekton
  "ven-093-166": "[Empower] [2]\n[Empowered][>] I have +1 [S] and [Ganking].", // Kinkou Lifeblade
  "ven-096-166": "I cost [2] less for each card with my name in your trash.", // Shadowblade Lurker
  "ven-099-166": "[Hidden]\nWhen you play me from face down, you may empower something here. Disempower it at end of turn.", // Tornado Warrior
  "ven-104-166": "[Empower] [2][C]\nWhen I become [Empowered], you may choose a unit in your trash with Energy cost no more than [3] and Power cost no more than [A]. Play it to your base, ignoring its cost.", // Tail-Cloaked Matriarch
  "ven-110-166": "[Empower] — Discard a spell\nWhen I become [Empowered], banish an enemy unit at a battlefield with 3 [S] or less.", // Mel
  "ven-119-166": "I cost [2][C] less if you control a battlefield with exactly two units there.", // Keeper of Law
  "ven-120-166": "You may pay [C] as an additional cost to play me.\nWhen you play me, if you paid the additional cost, [Stun] an enemy unit at a battlefield.", // Masa
  "ven-122-166": "[Empower] [2]\n[Empowered][>] I have +1 [S] and [Deflect 2].", // Solari Sunhawk
  "ven-124-166": "[Empower] — Kill a friendly unit\n[Empowered][>] I have +2 [S].", // Escaped Grayback
  "ven-127-166": "Choose a unit. If it's [Empowered], disempower it. Then kill it if it has 3 [S] or less.\n[Flow] [4][C][C]", // Lacerate
  "ven-130-166": "[Empower] [3][C]\n[Empowered][>] Your units that are [Empowered] have +2 [S].", // Aurok General
  "ven-133-166": "[Empower] [A][A]\nDisempower this, [T]: Choose a player. They gain control of this and recall it.\nAt the end of your turn, kill this and deal 5 to all units you control.", // Glowstone
  "ven-134-166": "[Empower] [3]\nI can be [Empowered] up to three times.\nI have +2 [S] for each time I'm [Empowered].\nWhile I'm [Empowered] three times, I have [Deflect 3] and [Ganking].", // Kayle
  "ven-136-166": "[Empower] [1][C][C]\n[Empowered][>] I have [Assault 2].\n[Empowered][>] When I attack, kill an enemy unit here with less Might than me.", // Ambessa
  "ven-139-166": "[Empower] [3][A]\n[Action][>] [T]: If it's your turn, move a friendly unit in a showdown to base and if I'm [Empowered], ready it.", // Rogue Assassin
  "ven-143-166": "When you banish a card you own, empower me.\n[Action][>] Disempower me, [T]: Discard 1, then draw 1.", // Master of Shadows
  "ven-149-166": "[Empower] [2][A][A]\n[1], [T]: Ready a gear.\n[Empowered][>] [1], [T]: Ready 2 gear.", // Defender of Tomorrow
  "ven-151-166": "When you empower something else, empower me.\nDisempower me, [T]: Give a unit at a battlefield -2 [S] this turn.", // Soul's Reflection
  "ven-153-166": "When you empower something else, empower me.\nDisempower me, [A], [T]: Ready a unit.", // Matriarch of War
  "ven-155-166": "When you play a card from anywhere other than your hand, empower me.\n[Action][>] Disempower me, [T]: Give a unit [Assault 2] this turn.", // Heart of the Tempest
};

const c = (id: string, abilities: Parameters<typeof card>[2], opts: Parameters<typeof card>[3] = {}) => {
  if (TX[id] === undefined) throw new Error(`B1: no text for ${id}`);
  return card(id, TX[id], abilities, opts);
};

// ---------------------------------------------------------------- shared bits
const lvl = (n: number) => [dep.level(n)];
const emp = (n?: number) => [dep.empowered(n)];
const mine = (ctx: Ctx, id: ObjId) => ctx.obj(id)?.controller === ctx.controller;
const myUnits = (ctx: Ctx, f?: (id: ObjId) => boolean) => ctx.units(u => mine(ctx, u) && (!f || f(u)));
const epochOf = (ctx: Ctx, id: ObjId) => ctx.obj(id)?.epoch ?? 0;
const sameObj = (ctx: Ctx, id: unknown, epoch: unknown) => typeof id === 'string' && ctx.exists(id) && ctx.onBoard(id) && epochOf(ctx, id) === epoch;
const exhaustFriendlyUnit = () => pay.exhaustFriendly((cx, id) => cx.isUnit(id), 'Exhaust a friendly unit');
const notEmpoweredSelf = (ctx: Ctx) => !ctx.isEmpowered(ctx.self);

// delayed: "disempower it at end of turn" / "empower it at end of turn"
const DISEMPOWER_AT_END = delayedAbility('B1:disempowerAtEnd', when('endOfTurn', null, ctx => {
  if (sameObj(ctx, ctx.data.obj, ctx.data.epoch)) ctx.disempower(ctx.data.obj as ObjId);
}, { text: 'Disempower it at end of turn.' }));
const EMPOWER_AT_END = delayedAbility('B1:empowerAtEnd', when('endOfTurn', null, ctx => {
  if (sameObj(ctx, ctx.data.obj, ctx.data.epoch)) empowerB1(ctx, ctx.data.obj as ObjId);
}, { text: 'Empower it at end of turn.' }));

/** "This enters exhausted." Local stand-in: an immediate (Add-speed, no chain) trigger on entering. */
const entersExhausted = () => when('enter', on.self, ctx => { if (!ctx.isExhausted(ctx.self)) ctx.exhaust(ctx.self); }, { isAdd: true, text: 'This enters exhausted.' });

// =====================================================================================
// Origins / Radiance / Spiritforged: additional costs & self cost modifiers
// =====================================================================================

// Brazen Buccaneer — optional discard as an additional cost, cost reduced by [2]
c('ogn-002-298', [], { additionalCosts: [{ cost: cost('', pay.discard(1)), optional: true, discount: { energy: -2 }, label: 'Discard a card as an additional cost to reduce my cost by [2]' }] });

// Noxus Hopeful — [Legion] — I cost [2] less.
c('ogn-012-298', [
  selfCostB1(() => ({ energy: -2 }), { requires: [dep.legion()], text: '[Legion] — I cost [2] less.' }),
]);

// Clockwork Keeper — optional [C]; play trigger if paid
c('ogn-044-298', [
  onPlay(E.draw(1), { if: paidB1(), text: 'When you play me, if you paid the additional cost, draw 1.' }),
], { additionalCosts: [{ cost: cost('[C]'), optional: true, label: 'Pay [C] as an additional cost to play Clockwork Keeper' }] });

// Find Your Center
c('ogn-047-298', [
  selfCostB1(ctx => (oppNearVictory(ctx) ? { energy: -2 } : {}), { text: 'If an opponent is within 3 points of the Victory Score, this costs [2] less.' }),
  spell(E.seq(E.draw(1), E.channel(1, true))),
]);

// Meditation — optional "exhaust a friendly unit" additional cost
c('ogn-048-298', [
  spell(ctx => ctx.draw(ctx.data.paidAdditional ? 2 : 1)),
], { additionalCosts: [{ cost: cost('', exhaustFriendlyUnit()), optional: true, label: 'Exhaust a friendly unit as an additional cost (draw 2 instead of 1)' }] });

// Spoils of War
c('ogn-144-298', [
  selfCostB1(ctx => (ctx.opponents().some(p => ctx.count(`unitsDied:${p}`) > 0) ? { energy: -2 } : {}), { text: 'If an enemy unit has died this turn, this costs [2] less.' }),
  spell(E.draw(2)),
]);

// Rhasa the Sunderer
c('ogn-195-298', [
  // CR 354/356: the card is on the chain when its cost is determined, so it never counts itself (RJ#11711, played from trash)
  selfCostB1(ctx => ({ energy: -ctx.trash().filter(id => id !== ctx.self).length }), { text: 'I cost [1] less for each card in your trash.' }),
]);

// Ki Burst — mandatory exhaust a friendly unit
c('rad-028-167', [
  spell(E.stun(0), { targets: [T.unit({ hint: 'harm', prompt: 'Stun a unit' })] }),
], { additionalCosts: [{ cost: cost('', exhaustFriendlyUnit()), label: 'Exhaust a friendly unit' }] });

// Life from Stone — mandatory exhaust a friendly unit
c('rad-029-167', [
  spell(E.seq(E.draw(1), E.channel(1, true))),
], { additionalCosts: [{ cost: cost('', exhaustFriendlyUnit()), label: 'Exhaust a friendly unit' }] });

// Ekko, Ingenious — mandatory: return a friendly unit to its owner's hand
c('rad-061-167', [], { additionalCosts: [{ cost: cost('', pay.returnFriendlyToHand()), label: "Return a friendly unit to its owner's hand" }] });

// Skystrike Squadron — optional: return a friendly gear, cost [2] less
c('rad-075-167', [], { additionalCosts: [{ cost: cost('', payB1.returnFriendlyGear()), optional: true, discount: { energy: -2 }, label: "Return a friendly gear to its owner's hand to reduce my cost by [2]" }] });

// Bloodscent Swarm
c('rad-080-167', [
  selfCostB1(ctx => ({ energy: -2 * conqueredThisTurn(ctx) }), { text: "I cost [2] less for each battlefield you've conquered this turn." }),
]);

// Party Crasher
c('rad-122-167', [
  selfCostB1(ctx => ({ energy: -myUnits(ctx, u => ctx.isExhausted(u)).length }), { text: 'I cost [1] less for each exhausted unit you control.' }),
]);

// Void Drone — [2] less when played from anywhere other than hand. While being played the origin zone is read from the
// chain item (`from`, requested in docs/dsl-requests.md); hidden/Flow origins are known already.
function playedFrom(ctx: Ctx): string | undefined {
  const it = ctx.item as (typeof ctx.item & { from?: string }) | undefined;
  if (!it) return ctx.obj(ctx.self)?.zone;
  if (it.from) return it.from;
  if (it.fromHidden) return 'facedown';
  if (it.viaFlow) return 'trash';
  return (it.choices?.from as string | undefined) ?? undefined;
}
c('sfd-010-221', [
  selfCostB1(ctx => { const z = playedFrom(ctx); return z && z !== 'hand' ? { energy: -2 } : {}; }, { text: 'I cost [2] less to play from anywhere other than your hand.' }),
]);

// Battering Ram
c('sfd-012-221', [
  selfCostB1(ctx => ({ energy: -ctx.playedThisTurn().filter(id => id !== ctx.self).length }), { minEnergy: 1, text: "I cost [1] less for each card you've played this turn, to a minimum of [1]." }),
]);

// Royal Entourage — ready or exhaust a legend
c('sfd-039-221', [
  onPlay(ctx => {
    const l = ctx.target(0);
    if (!l) return;
    const m = ctx.chooseMode([{ id: 'ready', label: `Ready ${ctx.name(l)}` }, { id: 'exhaust', label: `Exhaust ${ctx.name(l)}` }], 'Ready or exhaust the legend');
    if (m === 'ready') ctx.ready(l); else ctx.exhaust(l);
  }, { targets: [T.legend({ prompt: 'Ready or exhaust a legend' })], text: 'When you play me, ready or exhaust a legend.' }),
]);

// Legion Quartermaster — mandatory: return a friendly gear
c('sfd-044-221', [], { additionalCosts: [{ cost: cost('', payB1.returnFriendlyGear()), label: "Return a friendly gear to its owner's hand" }] });

// Needlessly Large Yordle
c('sfd-055-221', [
  selfCostB1(ctx => { const n = holdPointsThisTurn(ctx); return { energy: -2 * n, power: -n }; }, { text: 'I cost [2][C] less for each point you scored from holding this turn.' }),
]);

// Bard, Mercurial — optional: exhaust your legend; then move any number of your units to an open battlefield
c('sfd-079-221', [
  // RULINGS: CR 355.4 / 355.5 / 403.2 — the destination and the units are chosen as the trigger goes on the chain.
  // The destination is a non-targeting pick of a battlefield; "any number of your units" are targets.
  onPlay(ctx => {
    const bfObj = ctx.target(0);
    const bf = bfObj === undefined ? -1 : ctx.g.battlefields.findIndex(b => b.objId === bfObj);
    if (bf < 0 || !isOpenBattlefield(ctx, bf)) return;     // destination no longer open: the move can't be done
    const picked = ctx.targetsOf(1).filter(u => ctx.onBoard(u) && mine(ctx, u) && ctx.loc(u) !== bf);
    if (picked.length) ctx.move(picked, bf);
  }, {
    if: paidB1(),
    targets: [
      T.battlefield((cx: Ctx, id: ObjId) => { const i = cx.g.battlefields.findIndex(b => b.objId === id); return i >= 0 && isOpenBattlefield(cx, i); }, { pick: true, prompt: 'Move your units to which open battlefield?' }),
      T.anyNumber(T.unit((cx: Ctx, id: ObjId) => mine(cx, id), { hint: 'help', prompt: 'Choose any number of your units to move there' })),
    ],
    text: 'When you play me, if you paid the additional cost, move any number of your units to an open battlefield.',
  }),
], { additionalCosts: [{ cost: cost('', payB1.exhaustLegend()), optional: true, label: 'Exhaust your legend as an additional cost to play Bard' }] });

// Premonition
c('sfd-087-221', [spell(E.draw(3))]);

// Jaull-Fish
c('sfd-103-221', [
  selfCostB1(ctx => ({ energy: -2 * myUnits(ctx, u => ctx.isMighty(u)).length }), { text: 'I cost [2] less for each of your [Mighty] units.' }),
]);

// Show of Strength
c('sfd-106-221', [spell(ctx => ctx.draw(myUnits(ctx, u => ctx.isMighty(u)).length))]);

// =====================================================================================
// Unleashed: XP, Hunt, Level
// =====================================================================================

// Lotus Trap — double all damage dealt to the chosen unit this turn
const LOTUS = delayedAbility('B1:lotusTrap', replacement('damage', (ev, ctx) => ev.obj === ctx.data.obj && epochOf(ctx, ev.obj as ObjId) === ctx.data.epoch,
  ev => ({ ...ev, amount: Number(ev.amount) * 2 }), { text: 'Lotus Trap: double damage' }));
c('unl-013-219', [
  spell(ctx => { const t = ctx.target(0); if (t) ctx.delay(LOTUS, { obj: t, epoch: epochOf(ctx, t) }, 'endOfTurn'); },
    { targets: [T.unit({ hint: 'harm', prompt: 'Choose a unit: double all damage dealt to it this turn' })] }),
]);

// Right of Conquest — (1v1: allies are not a thing; teammates' battlefields count in 2v2)
c('unl-015-219', [
  spell(ctx => {
    const allies = ctx.g.players.map(p => p.id).filter(p => p !== ctx.controller && !ctx.isOpponent(p));
    const n = ctx.battlefields().filter(b => { const k = ctx.bfController(b); return k !== null && (k === ctx.controller || allies.includes(k)); }).length;
    ctx.draw(1); if (n > 0) ctx.draw(n);
  }),
]);

// Scorchclaw — [Hunt 2]; [Level 3] +1 [S] and enters ready
c('unl-016-219', [
  selfMight(1, { requires: lvl(3), text: '[Level 3][>] I have +1 [S].' }),
], { entersReady: ctx => ctx.xp() >= 3 });

// Square Up — [Repeat] — Discard 1
c('unl-017-219', [
  spell(E.keyword(0, 'Assault 4'), { targets: [T.unit({ hint: 'help', prompt: 'Give a unit [Assault 4] this turn' })] }),
], { costs: { Repeat: cost('', pay.discard(1)) } });

// Combat Experience
c('unl-031-219', [
  spell(ctx => ctx.giveMight(ctx.target(0), ctx.xp() >= 6 ? 3 : 1), { targets: [T.unit({ hint: 'help', prompt: 'Give a unit +1 [S] this turn' })] }),
]);

// Herald of Spring
c('unl-034-219', [onPlay(E.xp(2), { text: 'When you play me, gain 2 XP.' })]);

// Monch
const oppHasStunned = (ctx: Ctx) => ctx.units(u => ctx.isEnemy(u) && ctx.isStunned(u)).length > 0;
c('unl-035-219', [
  selfCostB1(ctx => (oppHasStunned(ctx) ? { energy: -2 } : {}), { text: 'If an opponent controls a stunned unit, I cost [2] less.' }),
], { entersReady: oppHasStunned });

// Skyward Strike — move an enemy unit; [Level 6] stun an enemy unit (second choice offered only at Level 6)
c('unl-038-219', [
  spell(ctx => {
    E.moveToChosen(0, 1)(ctx);
    const s = ctx.target(2);
    if (s && ctx.xp() >= 6) ctx.stun(s);
  }, {
    targets: [
      T.unit(F.enemy, { hint: 'harm', prompt: 'Move an enemy unit' }),
      T.destination(F.moveDestFor(0), { prompt: 'Move it to' }),   // R-2 (CR 355.4)
      T.unit(F.enemy, (cx: Ctx) => cx.xp() >= 6, { hint: 'harm', min: 0, max: 1, prompt: '[Level 6] Stun an enemy unit' }),
    ],
  }),
]);

// Wuju Apprentice
c('unl-040-219', [onPlay(E.draw(1), { requires: lvl(6), text: '[Level 6][>] When you play me, draw 1.' })]);

// Mosstomper
c('unl-047-219', [statik('self', { might: 1, keywords: ['Deflect'] }, { requires: lvl(3), text: '[Level 3][>] I have +1 [S] and [Deflect].' })]);

// Scuttle Crab
const SCUTTLE_PEEK = delayedAbility('B1:scuttle:peek', rule('seeFacedown', (ctx, viewer: PlayerId, id: ObjId) => viewer === ctx.controller && ctx.obj(id)?.controller === ctx.data.opp,
  undefined, { text: 'Scuttle Crab: you can look at their facedown cards this turn' }));
c('unl-053-219', [
  onPlay(E.draw(1), { text: 'When you play me, draw 1.' }),
  deathknell(ctx => {
    const opp = ctx.chooseOpponent();
    ctx.revealHand(opp);
    // "You can look at their facedown cards this turn": the engine's seeFacedown rule (getView), as a delayed rule (RJ#10488)
    ctx.g.ex.turnFacts[`B1:peekFacedown:${ctx.controller}`] = opp;
    ctx.delay(SCUTTLE_PEEK, { opp }, 'endOfTurn');
    ctx.gainXp(1);
  }, { text: '[Deathknell][>] Choose an opponent. They reveal their hand. You can look at their facedown cards this turn. Gain 1 XP.' }),
]);

// Master Yi, Unstoppable — Level cost ladder
c('unl-059-219', [
  selfCostB1(ctx => { const x = ctx.xp(); return x >= 11 ? { energy: -6, power: -3 } : x >= 6 ? { energy: -4, power: -2 } : x >= 3 ? { energy: -2, power: -1 } : {}; }, { text: '[Level 3/6/11] cost reductions' }),
  statik('self', { cantBeChosenByEnemy: true }, { requires: lvl(16), text: "[Level 16][>] I can't be chosen by enemy spells and abilities." }),
]);

// Eclipse
c('unl-063-219', [spell(E.seq(E.might(0, -4), E.predict(1)), { targets: [T.unit({ hint: 'harm', prompt: 'Give a unit -4 [S] this turn' })] })]);

// Gustwalker
c('unl-075-219', [statik('self', { might: 1, keywords: ['Ganking'] }, { requires: lvl(3), text: '[Level 3][>] I have +1 [S] and [Ganking].' })]);

// Concentrate
c('unl-091-219', [
  spell(E.draw(2)),
  selfCostB1(ctx => (ctx.xp() >= 11 ? { energy: -4 } : ctx.xp() >= 6 ? { energy: -2 } : {}), { text: '[Level 6] [2] less / [Level 11] [4] less instead' }),
]);

// Demacian Diplomat
c('unl-092-219', [onPlay(E.xp(1), { text: 'When you play me, gain 1 XP.' })]);

// Gemhand Hunter
c('unl-094-219', [selfMight(1, { requires: lvl(6), text: '[Level 6][>] I have +1 [S].' })]);

// Grim Resolve — +3 and "when it wins a combat this turn, gain 2 XP"
const GRIM = delayedAbility('B1:grimResolve', when('combatResult', (ev, ctx) => {
  const id = ctx.data.obj as ObjId;
  // RULINGS: CR 468.3.c — only units still at that battlefield inherit their controller's combat result
  return sameObj(ctx, id, ctx.data.epoch) && ev.winner !== null && ev.winner === ctx.obj(id).controller && inCurrentCombat(ctx, id) && ctx.loc(id) === ev.bf;
}, E.xp(2), { text: 'Grim Resolve: it won a combat — gain 2 XP' }));
c('unl-095-219', [
  spell(ctx => { const t = ctx.target(0); if (!t) return; ctx.giveMight(t, 3); ctx.delay(GRIM, { obj: t, epoch: epochOf(ctx, t) }, 'endOfTurn'); },
    { targets: [T.unit(F.friendly, { hint: 'help', prompt: 'Give a friendly unit +3 [S] this turn' })] }),
]);

// Targonian Visionary
c('unl-098-219', [selfMight(4, { requires: lvl(11), text: '[Level 11][>] I have +4 [S].' })]);

// Crowd Favorite
c('unl-102-219', [activated(cost('', pay.spendXp(2)), E.buff('self'), { label: 'Spend 2 XP: Buff me', text: 'Spend 2 XP: [Buff] me.' })]);

// Disposal Order
c('unl-103-219', [
  spellModes([
    mode('recycle', "Choose up to 3 cards from opponents' trashes. Their owners recycle them.", E.recycle(0),
      [T.upTo(3, T.card({ zones: ['trash'], prompt: "Choose up to 3 cards from opponents' trashes" }, (cx: Ctx, id: ObjId) => cx.isOpponent(cx.owner(id))))]),
    mode('draw', 'Draw 1.', E.draw(1)),
  ]),
]);

// Stare Down
c('unl-107-219', [
  spell(ctx => {
    const u = ctx.target(0), bfObj = ctx.target(1);
    const bf = bfObj ? ctx.battlefields().find(b => ctx.bfCard(b) === bfObj) : undefined;
    if (u && bf !== undefined) {
      const m = ctx.might(u);
      const movers = ctx.unitsAt(bf, x => ctx.isEnemy(x) && ctx.might(x) < m);
      if (movers.length) ctx.move(movers, 'base');
    }
    ctx.gainXp(1);
  }, { targets: [T.unit(F.friendly, { hint: 'help', prompt: 'Choose a friendly unit' }), T.battlefield({ prompt: 'Choose a battlefield' })] }),
]);

// Wily Newtfish
c('unl-108-219', [statik('self', { might: 1, keywords: ['Ganking'] }, { if: ctx => xpGainedThisTurn(ctx), text: "If you've gained XP this turn, I have +1 [S] and [Ganking]." })]);

// Blood Rose
c('unl-109-219', [
  // FUZZ: no `requires: canPay` here — dependenciesMet runs inside autoPay's source scan (infinite recursion);
  // placeTrigger already drops the trigger when its cost can't be paid (chain.ts).
  whenYouPlay(F.unit, E.xp(1), { optional: 'Blood Rose: pay [1] to gain 1 XP?', cost: cost('[1]'), text: 'When you play a unit, you may pay [1] to gain 1 XP.' }),
  activated(cost('[T]', pay.spendXp(3)), E.ready(0), { targets: [T.unit({ hint: 'help', prompt: 'Ready a unit' })], label: 'Spend 3 XP, [T]: Ready a unit', text: 'Spend 3 XP, [T]: Ready a unit.' }),
]);

// Master Yi, Tempered
c('unl-113-219', [selfKeyword(['Deflect', 'Ganking'], { requires: lvl(6), text: '[Level 6][>] I have [Deflect] and [Ganking].' })]);

// Nilah
c('unl-115-219', [onMove(E.xp(1), { text: 'When I move, gain 1 XP.' })]);

// Poppy (Body)
c('unl-116-219', [
  onPlay(E.seq(E.ready('self'), E.xp(3)), { if: ctx => oppNearVictory(ctx), text: "When you play me, if an opponent's score is within 3 points of the Victory Score, ready me and gain 3 XP." }),
]);

// Arachnoid Horror — friendly units may be played to a battlefield where a single enemy unit is alone.
// The first ability ("I can be played ...") works from hand and needs a self play-rule (docs/dsl-requests.md).
// "an enemy unit is alone there" = no other unit friendly to it (CR 740; rules-spec 'Alone'): my own units there don't count, so more
// friendly units may follow the first (RJ#11322); every other enemy unit is friendly to it (its controller's or a teammate's)
const loneEnemyBfs = (ctx: Ctx) => ctx.battlefields().filter(b => ctx.unitsAt(b).filter(u => ctx.isEnemy(u)).length === 1);
c('unl-117-219', [
  playRule((ctx, id) => ctx.isUnit(id), { extraDestinations: ctx => loneEnemyBfs(ctx), text: 'Friendly units can be played to an occupied battlefield if an enemy unit is alone there.' }),
  playRule((ctx, id) => id === ctx.self, { extraDestinations: ctx => loneEnemyBfs(ctx), activeIn: ['hand'], text: 'I can be played to an occupied battlefield if an enemy unit is alone there.' }),
]);

// Kha'Zix (Body)
c('unl-119-219', [
  onAttack(ctx => { const t = ctx.target(0); if (t) ctx.deal(ctx.might(ctx.self), t); }, {
    requires: [dep.custom(ctx => ctx.xp() >= 3)], optional: "Kha'Zix: spend 3 XP to deal damage equal to my Might to an enemy unit here?",
    cost: cost('', pay.spendXp(3)), targets: [T.unit(F.enemy, F.here, { hint: 'harm', prompt: 'Deal damage equal to my Might to an enemy unit here' })],
    text: 'When I attack, you may spend 3 XP to deal damage equal to my Might to an enemy unit here.',
  }),
]);

// Crescent Guardian — optional [C] (only if you've played a spell this turn): enters ready
c('unl-122-219', [], {
  additionalCosts: [{ cost: cost('[C]', payB1.onlyIf("You've played a spell this turn", ctx => ctx.count(`spells:${ctx.controller}`) > 0)), optional: true, key: 'entersReady', label: 'Pay [C] as an additional cost to have Crescent Guardian enter ready' }],
});

// Lunar Boon
c('unl-125-219', [spell(E.seq(E.discard(1), E.draw(2)))]);

// Megatusk
c('unl-126-219', [
  activated(cost('', pay.spendXp(3)), ctx => { ctx.giveKeyword(myUnits(ctx, u => ctx.isHere(u)), 'Ganking'); }, { label: 'Spend 3 XP: your units here gain Ganking', text: 'Spend 3 XP: Give your units here [Ganking] this turn.' }),
]);

// Mister Root
c('unl-127-219', [onMove(E.xp(2), { toBattlefield: true, text: 'When I move to a battlefield, gain 2 XP.' })]);

// Vicious Snapjaws
c('unl-129-219', [whenUnitDies(F.friendly, E.xp(1), { text: 'When another friendly unit dies, gain 1 XP.' })]);

// Angler Beast
c('unl-132-219', [onPlay(ctx => { ctx.returnToHand(ctx.units(u => ctx.might(u) <= 2)); }, { text: "When you play me, return all units with 2 [S] or less to their owners' hands." })]);

// Insightful Investigator
c('unl-135-219', [
  onPlay(ctx => {
    const opp = ctx.chooseOpponent();
    const hand = ctx.revealHand(opp);
    if (!hand.length || ctx.xp() < 2) return;
    if (!ctx.may('Spend 2 XP to choose a card from their hand? (They discard it and draw 1.)')) return;
    if (!ctx.spendXp(2)) return;
    const pick = ctx.chooseCards(ctx.hand(opp), 1, 1, 'Choose a card from their hand')[0];
    if (!pick) return;
    ctx.discardCards([pick], opp);
    ctx.draw(1, opp);
  }, { text: 'When you play me, choose an opponent. They reveal their hand. You may pay 2 XP to choose a card from their hand. If you do, they discard that card and draw 1.' }),
]);

// Scryer's Bloom
c('unl-136-219', [
  entersExhausted(),
  activated(cost('[1][T]', pay.killSelf()), ctx => { ctx.predict(2); ctx.draw(1); ctx.gainXp(1); }, { label: 'Kill this, [1], [T]: Predict 2, draw 1, gain 1 XP', text: 'Kill this, [1], [T]: [Predict 2], then draw 1. Gain 1 XP.' }),
]);

// Conscription — optional "spend 5 XP" decided as you play (before choosing the target)
const conscriptionTarget = (ctx: Ctx, id: ObjId) => ctx.might(id) <= 3 || !!ctx.data.paidAdditional || (!ctx.item && ctx.xp() >= 5);
const conscriptionSmall = (ctx: Ctx) => ctx.units(u => ctx.isEnemy(u) && typeof ctx.loc(u) === 'number' && ctx.might(u) <= 3).length > 0;
c('unl-140-219', [
  asPlay(ctx => {
    if (ctx.xp() < 5) return;
    // RULINGS: CR 355.16 / 355.17 / 358.1 — declining the XP cost when no enemy unit at a battlefield has 3 Might or
    // less would leave the mandatory "Choose an enemy unit" without a legal choice, so the cost must be paid.
    if (conscriptionSmall(ctx) && !ctx.may('Spend 5 XP as an additional cost? (Then choose any enemy unit at a battlefield.)')) return;
    ctx.addPlayCost({ extra: [pay.spendXp(5)] });
    ctx.data.paidAdditional = true;
  }, { text: 'You may spend 5 XP as an additional cost to play this.' }),
  spell(ctx => { const t = ctx.target(0); if (!t) return; ctx.takeControl(t); ctx.exhaust(t); ctx.recall(t); },
    { targets: [T.unit(F.enemy, F.atBattlefield, conscriptionTarget, { hint: 'harm', prompt: 'Choose an enemy unit at a battlefield to take control of' })] }),
]);

// Kha'Zix (Chaos)
const enemyAloneHere = (ctx: Ctx) => { const h = ctx.here(); return typeof h === 'number' && ctx.unitsAt(h, u => ctx.isEnemy(u)).length === 1; };
c('unl-143-219', [
  onCombatRole(ctx => { ctx.giveMight(ctx.self, 2); ctx.gainXp(2); }, { if: enemyAloneHere, text: 'When I attack or defend, if an enemy unit is alone here, give me +2 [S] this turn and gain 2 XP.' }),
]);

// Bandle Soldier
c('unl-151-219', [], { entersReady: ctx => ctx.xp() >= 3 });

// Scrutinizing Sergeant
c('unl-157-219', [onPlay(ctx => ctx.gainXp(myUnits(ctx).length), { text: 'When you play me, gain 1 XP for each friendly unit.' })]);

// Enthralling Protector
c('unl-162-219', [activated(cost('', pay.spendXp(2)), E.buff('self'), { label: 'Spend 2 XP: Buff me', text: 'Spend 2 XP: [Buff] me.' })]);

// Mageseeker Investigator — needs an engine movement tax hook (docs/dsl-requests.md); no script effect yet.
c('unl-163-219', [
  // engine moveCost rule (B1-8): [A] per unit beyond the first, for opponents moving several units here at once
  { ...rule('moveCost', (ctx, p: PlayerId, units: ObjId[], to: unknown) => ctx.isOpponent(p) && units.length > 1 && typeof to === 'number' && to === ctx.loc(ctx.self)),
    cost: (_ctx: Ctx, _p: PlayerId, units: ObjId[]) => ({ power: new Array(units.length - 1).fill('A') }),
    text: 'Opponents must pay [A] for each unit beyond the first to move multiple units to my battlefield at the same time.' },
]);

// Safety Inspector
c('unl-164-219', [
  onPlay(ctx => {
    const skipMe = paidB1()(ctx);
    const chosen: ObjId[] = [];
    ctx.eachPlayer(p => {
      if (p === ctx.controller && skipMe) return;
      const units = ctx.units(u => ctx.ctrl(u) === p);
      const k = ctx.chooseCards(units, 1, 1, 'Safety Inspector: kill one of your units', p)[0];
      if (k) chosen.push(k);
    });
    if (chosen.length) ctx.kill(chosen);
  }, { text: "When you play me, each player must kill one of their units. If you paid my additional cost, you don't kill a unit this way." }),
], { additionalCosts: [{ cost: cost('', pay.spendXp(3)), optional: true, label: 'Spend 3 XP as an additional cost to play Safety Inspector' }] });

// Poppy (Order)
c('unl-178-219', [], { additionalCosts: [{ cost: cost('', pay.spendXp(3)), optional: true, discount: { energy: -3 }, label: 'Spend 3 XP as an additional cost to reduce my cost by [3]' }] });

// Wuju Master (legend)
c('unl-191-219', [
  anthem(F.and(F.unit, F.youControl), { might: 1 }, { requires: lvl(6), text: '[Level 6][>] Your units have +1 [S].' }),
  playRule((ctx, id) => ctx.isUnit(id), { entersReady: true, requires: lvl(11), text: '[Level 11][>] Your units enter ready.' }),
]);

// Alpha Strike — the friendly unit deals damage equal to its Might split among the chosen enemy units.
// CR 387-389: "Then for each unit this kills, do this: Gain 1 XP" puts one reflexive item per killed unit on the chain.
// "for each unit this kills": its lethally damaged recipients die in the cleanup after it resolves; a death that is replaced
// (Guardian Angel heals and recalls it) is no kill (RJ#9887, CR 373; DECISIONS principle 3) — one-shot delayed "when it dies".
const alphaStrikeXp = delayedAbility('B1:alphaStrike:xp', when('die', (ev, ctx) => ev.obj === ctx.data.obj && ((ev.lki as { epoch?: number } | undefined)?.epoch ?? 0) === ctx.data.epoch,
  E.xp(1), { text: 'Alpha Strike: gain 1 XP' }));
c('unl-192-219', [
  spell(ctx => {
    const src = ctx.target(0);
    if (!src) return;
    const recips = ctx.targetsOf(1).filter(id => ctx.onBoard(id));
    const amount = ctx.might(src);
    if (!recips.length || amount <= 0) return;
    // CR 355.14.f-h (fewer damage than targets: the controller picks which stay; each gets at least 1) and CR 715.3 (Bonus
    // Damage raises the pool) are handled by ctx.split / dealSplit; the unit is the source
    ctx.dealSplit(1, amount, src);
    for (const id of recips.filter(x => ctx.lethallyDamaged(x))) ctx.delay(alphaStrikeXp, { obj: id, epoch: ctx.obj(id)?.epoch ?? 0 }, 'endOfTurn', 1);
  }, { targets: [T.unit(F.friendly, { hint: 'help', prompt: 'Choose a friendly unit' }),
    // CR 355.14.c: no more recipients than the damage available as it is played (the chosen unit's Might)
    T.unit(F.enemy, F.atBattlefield, { min: 1, max: 99, split: (cx: Ctx) => { const s = cx.target(0); return s ? Math.max(0, cx.might(s)) : 0; }, hint: 'harm', prompt: 'Choose enemy units at battlefields to split the damage among' })] }),
]);

// Voidreaver (legend)
c('unl-201-219', [
  when('combatResult', (ev, ctx) => ev.winner === ctx.controller, E.xp(1), { text: 'When you win a combat, gain 1 XP.' }),
  activated(cost('[T]', pay.spendXp(1)), E.buff(0), { targets: [T.unit({ hint: 'help', prompt: 'Buff a unit' })], label: 'Spend 1 XP, [T]: Buff a unit', text: 'Spend 1 XP, [T]: [Buff] a unit.' }),
  activated(cost('[T]', pay.spendXp(2)), E.move(0, 'base'), { targets: [T.unit(F.friendly, F.exhausted, { prompt: 'Move an exhausted friendly unit to its base' })]   /* principle 25 (RJ#1127): one already in base is a valid choice */, label: 'Spend 2 XP, [T]: Move an exhausted friendly unit to base', text: 'Spend 2 XP, [T]: Move an exhausted friendly unit from a battlefield to its base.' }),
]);

// Keeper of the Hammer (legend)
c('unl-203-219', [
  whenYouHold(E.xp(1), { text: 'When you hold, gain 1 XP.' }),
  activated(cost('[T]', pay.spendXp(3)), E.draw(1), { label: 'Spend 3 XP, [T]: Draw 1', text: 'Spend 3 XP, [T]: Draw 1.' }),
]);

// =====================================================================================
// Vendetta: Empower
// =====================================================================================

// Baccai Sandspinner
c('ven-001-166', [
  selfCostB1(ctx => (ctx.runes().length <= 4 ? { energy: -3 } : {}), { scope: 'empower', text: 'This ability costs [3] less if you control 4 or fewer runes.' }),
  selfKeyword(['Deflect', 'Assault 2'], { requires: emp(), text: '[Empowered][>] I have [Deflect] and [Assault 2].' }),
], { costs: { Empower: cost('[5]') } });

// Punching Poro
c('ven-007-166', [selfMight(1, { requires: emp(), text: '[Empowered][>] I have +1 [S].' })], { costs: { Empower: cost('', pay.discard(1)) } });

// Shadow Fiend
c('ven-014-166', [selfKeyword('Assault 3', { requires: emp(), text: '[Empowered][>] I have [Assault 3].' })]);

// Rage Amplifier
c('ven-018-166', [
  anthem(F.and(F.unit, F.youControl), ctx => ({ might: ctx.isEmpowered(ctx.self) ? 2 : 1 }), { text: "Your units have +1 [S]. If I'm [Empowered], they have +2 [S] instead." }),
]);

// Akali, Rogue
c('ven-021-166', [
  onMove(ctx => { const t = ctx.target(0); if (t) ctx.deal(ctx.isEmpowered(ctx.self) ? 2 : 1, t); }, {
    optional: 'Akali: deal damage to a unit at a battlefield she moved to or from?',
    targets: [T.unit((cx: Ctx, id: ObjId) => { const l = cx.loc(id); const ev = cx.event; return typeof l === 'number' && !!ev && (l === ev.from || l === ev.to); }, { hint: 'harm', prompt: 'Deal damage to a unit at a battlefield Akali moved to or from' })],
    text: "When I move, you may deal 1 to a unit at a battlefield I moved to or from. If I'm [Empowered], deal 2 instead.",
  }),
  selfMight(1, { requires: emp(), text: '[Empowered][>] I have +1 [S].' }),
]);

// Mournful Witness
c('ven-028-166', [
  when('combatEnd', (_ev, ctx) => inCurrentCombat(ctx, ctx.self), ctx => { empowerB1(ctx, ctx.self); }, { text: 'When a combat that I was in ends, empower me.' }),
  selfMight(2, { requires: emp(), text: '[Empowered][>] I have +2 [S].' }),
]);

// Serene Ascetic
c('ven-030-166', [selfKeyword(['Deflect', 'Shield 3'], { requires: emp(), text: '[Empowered][>] I have [Deflect] and [Shield 3].' })]);

// Twilight Shroud — [Flow] [2] (engine)
c('ven-031-166', [
  spell(ctx => { const t = ctx.target(0); if (!t) return; ctx.giveMight(t, 1); ctx.untargetable(t); }, { targets: [T.unit(F.friendly, { hint: 'help', prompt: 'Give a friendly unit +1 [S] and protection this turn' })] }),
]);

// Frostcoat Mother
c('ven-032-166', [
  selfCostB1(ctx => ({ energy: -ctx.runes().length }), { scope: 'empower', text: 'This ability costs [1] less for each rune you control.' }),
  selfMight(3, { requires: emp(), text: '[Empowered][>] I have +3 [S].' }),
], { costs: { Empower: cost('[12]') } });

// Sanction
c('ven-035-166', [
  spellModes([
    mode('empower', 'Empower a unit. Disempower it at end of turn.', ctx => {
      const t = ctx.target(0); if (!t) return;
      empowerB1(ctx, t);
      ctx.delay(DISEMPOWER_AT_END, { obj: t, epoch: epochOf(ctx, t) }, 'endOfTurn');
    }, [T.unit({ prompt: 'Empower a unit (disempower it at end of turn)' })]),
    mode('disempower', "Disempower a unit that's [Empowered]. Empower it at end of turn.", ctx => {
      const t = ctx.target(0); if (!t) return;
      ctx.disempower(t);
      ctx.delay(EMPOWER_AT_END, { obj: t, epoch: epochOf(ctx, t) }, 'endOfTurn');
    }, [T.unit(F.empowered, { prompt: "Disempower a unit that's Empowered (empower it at end of turn)" })]),
  ]),
]);

// Tomb-Raider Barbara
c('ven-037-166', [
  onPlay(ctx => { const t = ctx.target(0); if (!t) return; if (ctx.isEmpowered(t)) ctx.disempower(t); else ctx.kill(t); }, {
    if: ctx => ctx.runes().length >= 7, targets: [T.gear(F.enemy, { hint: 'harm', prompt: 'Choose an enemy gear' })],
    text: "When you play me, if you control 7 or more runes, choose an enemy gear. If it's [Empowered], disempower it. Otherwise, kill it.",
  }),
]);

// Steel Paws
c('ven-043-166', [selfMight(7, { requires: emp(), text: '[Empowered][>] I have +7 [S].' })]);

// Helm of Suppression
c('ven-045-166', [
  costModDyn((ctx, id) => (ctx.type(id) === 'Spell' && typeof ctx.data.payer === 'number' && ctx.isOpponent(ctx.data.payer as PlayerId))
    ? { energy: 1, power: ctx.isEmpowered(ctx.self) ? 1 : 0 } : null, { text: "Opponents' spells cost [1] more. If this is [Empowered], they cost [1][A] more instead." }),
]);

// Nasus
c('ven-046-166', [onConquer(E.points(1), { requires: emp(), text: '[Empowered][>] When I conquer, you score 1 point.' })]);

// Apprentice Mage
c('ven-047-166', [
  when('empower', on.self, E.predict(2), { text: 'When I become [Empowered], [Predict 2].' }),
  selfMight(1, { requires: emp(), text: '[Empowered][>] I have +1 [S].' }),
]);

// Grumpy Rockbear
c('ven-050-166', [
  selfCostB1(ctx => ({ energy: -ctx.runes().length }), { scope: 'empower', text: 'This ability costs [1] less for each rune you control.' }),
  selfKeyword(['Deflect', 'Shield 3'], { requires: emp(), text: '[Empowered][>] I have [Deflect] and [Shield 3].' }),
], { costs: { Empower: cost('[12]') } });

// Questionable Tome — [Empower] — [T]
c('ven-054-166', [
  activated(cost('[1][T]', pay.disempowerSelf()), E.draw(1), { label: 'Disempower this, [1], [T]: Draw 1', text: 'Disempower this, [1], [T]: Draw 1.' }),
], { costs: { Empower: cost('[T]') } });

// Applied Researchers
c('ven-055-166', [
  costModDyn((ctx, id) => (ctx.type(id) === 'Spell' && ctx.data.payer === ctx.controller ? { energy: -1, power: -1, minEnergy: 1 } : null),
    { requires: emp(), text: '[Empowered][>] Your spells cost [1][A] less, to a minimum of [1].' }),
]);

// Covert Informant
c('ven-057-166', [onMove(E.draw(1), { requires: emp(), text: '[Empowered][>] When I move, draw 1.' })]);

// Shock Blast
c('ven-059-166', [
  selfCostB1(ctx => (empoweredThingsOf(ctx).length > 0 ? { energy: -2 } : {}), { text: "This costs [2] less if you control something that's [Empowered]." }),
  spell(E.deal(4, 0), { targets: [T.unit(F.atBattlefield, { hint: 'harm', prompt: 'Deal 4 to a unit at a battlefield' })] }),
]);

// Hextech Formula
c('ven-062-166', [
  entersExhausted(),
  activated('[T]', ctx => { empowerB1(ctx, ctx.target(0)); }, { targets: [T.gear(F.other, { hint: 'help', prompt: 'Empower another gear' })], label: '[T]: Empower another gear', text: '[T]: Empower another gear.' }),
]);

// Plaza Guardian
c('ven-064-166', [selfCostB1(ctx => ({ energy: -ctx.gear(g => mine(ctx, g)).length }), { text: 'I cost [1] less for each gear you control.' })]);

// Mel, Trailblazer — the "-[S] gives an additional -1 [S]" part needs a might-modification replacement hook (docs/dsl-requests.md)
c('ven-069-166', [
  onPlay(E.draw(1), { text: 'When you play me, draw 1.' }),
  rule('cantBeCountered', (ctx, itemId: string) => ctx.g.chain.find(x => x.id === itemId)?.controller === ctx.controller, undefined, { requires: emp(), text: "[Empowered][>] Your spells and abilities can't be countered." }),
  // SCRIPT-FIX (RJ#11737/11740/11741): -[S] that your spell/ability gives to a unit it chose gets an additional -1 (N4 giveMight
  // replacement). "…to a minimum of N [S]" on the source still holds (Stupefy on a 2-Might unit -> 1): the floor is read from its text.
  replacement('giveMight', (ev, ctx) => Number(ev.amount) < 0 && !!ev.chosen && ev.player === ctx.controller && typeof ev.obj === 'string' && ctx.onBoard(ev.obj), (ev, ctx) => {
    let amt = Number(ev.amount) - 1;
    const src = typeof ev.source === 'string' ? ctx.obj(ev.source) : undefined;
    const m = /to a minimum of (\d+) \[S\]/.exec(src ? ctx.g.cards[src.cardId]?.text ?? '' : '');
    if (m) amt = Math.min(Number(ev.amount), Math.max(amt, Number(m[1]) - ctx.might(ev.obj as ObjId)));
    return { ...ev, amount: amt };
  }, { requires: emp(), text: '[Empowered][>] -[S] your spells and abilities give to a unit they choose is 1 more.' }),
]);

// Brutal Hunter
c('ven-070-166', [statik('self', { might: 2, keywords: ['Ganking'] }, { requires: emp(), text: '[Empowered][>] I have +2 [S] and [Ganking].' })]);

// Guttural Roar
c('ven-072-166', [
  spell(ctx => { const t = ctx.target(0); if (t) ctx.giveMight(t, ctx.isEmpowered(t) ? 4 : 2); }, { targets: [T.unit({ hint: 'help', prompt: 'Give a unit +2 [S] this turn' })] }),
]);

// Legion Marauder — [Empower] — [1] or [C]: the keyword ability pays [1]; a second Empower ability pays [C]
c('ven-074-166', [
  activated(cost('[C]'), ctx => { empowerB1(ctx, ctx.self); }, { if: notEmpoweredSelf, label: 'Empower ([C])', text: '[Empower] — [C]' }),
  selfMight(1, { requires: emp(), text: '[Empowered][>] I have +1 [S].' }),
], { costs: { Empower: cost('[1]') } });

// Tools of Empire
c('ven-077-166', [
  activated('[T]', ctx => { const t = ctx.target(0); if (t) ctx.giveMight(t, ctx.isEmpowered(ctx.abilitySource ?? ctx.self) ? 4 : 2); }, { targets: [T.unit({ hint: 'help', prompt: 'Give a unit +2 [S] this turn' })], label: '[T]: Give a unit +2 [S]', text: '[T]: Give a unit +2 [S] this turn. If this is [Empowered], give that unit +4 [S] this turn instead.' }),
]);

// Baccai Witherclaw
c('ven-078-166', [
  selfMight(2, { requires: emp(), text: '[Empowered][>] I have +2 [S].' }),
  deathknell(E.channel(2, true), { requires: emp(), text: '[Empowered][>][>>][Deathknell][>] Channel 2 runes exhausted.' }),
]);

// Dame the Despoiler
c('ven-079-166', [
  onCombatRole(ctx => {
    const t = ctx.target(0);
    if (t && ctx.onBoard(t)) { const d = ctx.might(t) - ctx.might(ctx.self); if (d > 0) ctx.giveMight(ctx.self, d); }
    ctx.giveMight(ctx.self, 1);
  }, { requires: emp(), targets: [T.unit(F.here, { prompt: 'Choose a unit here (increase my Might to its Might)' })], text: '[Empowered][>] When I attack or defend, choose a unit here. Increase my Might to its Might this turn, then give me +1 [S] this turn.' }),
]);

// Onslaught — [Flow] [4] (engine)
c('ven-081-166', [spell(E.might(0, 6), { targets: [T.unit({ hint: 'help', prompt: 'Give a unit +6 [S] this turn' })] })]);

// Profiteer
c('ven-082-166', [
  // RULINGS sweep / CR 383.3.b, 403.2: the disempower is the trigger's base cost and the thing to empower its target, both
  // decided as it goes on the chain
  onPlay(ctx => { empowerB1(ctx, ctx.target(0)); }, {
    optional: 'Disempower something you control to empower a legend, unit, or gear?',
    targets: [{ kind: 'any', zones: ['board', 'legends'], prompt: 'Empower a legend, unit, or gear', hint: 'help', filter: (cx, id) => cx.isUnit(id) || cx.isGear(id) || cx.obj(id)?.zone === 'legendZone' }],
    cost: cost('', pay.custom('Disempower something you control', c => empoweredThingsOf(c).length > 0, c => {
      const d = c.chooseCards(empoweredThingsOf(c), 1, 1, 'Disempower something you control')[0];
      return !!d && c.disempower(d);
    })),
    text: 'When you play me, you may disempower something you control to empower a legend, unit, or gear.',
  }),
]);

// Ambessa (Body)
c('ven-084-166', [
  selfMight(3, { requires: emp(), text: '[Empowered][>] I have +3 [S].' }),
  replacement('damage', (ev, ctx) => ev.obj === ctx.self && !ctx.obj(ctx.self)?.combatRole, () => null, { requires: emp(), text: "[Empowered][>] I can't be dealt damage unless I'm in combat." }),
]);

// Gangplank — "a spell or ability that chooses me" = one that targeted him (Vendetta FAQ: Blast Cone's stun trigger doesn't
// choose him, so it isn't replaced; Back Off on an already-stunned Gangplank does no stun, so no +3; Stupefy on a 1 [M]
// Gangplank gives -0, so no +3). The replacement events carry `chosen` (the resolving item targeted him).
c('ven-086-166', [
  replacement(['stun', 'returnToHand', 'giveMight'],
    (ev, ctx) => ev.obj === ctx.self && (ev.chosen === true || chosenByResolvingItem(ctx, ctx.self)) && (ev.type !== 'giveMight' || Number(ev.amount) < 0),
    (ev, ctx) => { if (ev.type === 'giveMight') return { ...ev, amount: 3, duration: 'endOfTurn' }; ctx.giveMight(ctx.self, 3); return null; },
    { requires: emp(), text: '[Empowered][>] If a spell or ability that chooses me would stun me, give me -[M], or return me to hand, give me +3 [M] this turn instead.' }),
]);

// Renekton
c('ven-092-166', [
  activated('[1]', E.might('self', 1), { label: '[1]: +1 [S] this turn', text: '[1]: Give me +1 [S] this turn.' }),
  when('mightChanged', (ev, ctx) => ev.obj === ctx.self && Number(ev.from) < 10 && Number(ev.to) >= 10, ctx => { empowerB1(ctx, ctx.self); }, { text: 'When my Might becomes 10 or more, empower me.' }),
  selfKeyword(['Deflect', 'Ganking'], { requires: emp(), text: '[Empowered][>] I have [Deflect] and [Ganking].' }),
]);

// Kinkou Lifeblade
c('ven-093-166', [statik('self', { might: 1, keywords: ['Ganking'] }, { requires: emp(), text: '[Empowered][>] I have +1 [S] and [Ganking].' })]);

// Shadowblade Lurker
// CR 354/356: on the chain when its cost is determined — never counts itself (as Rhasa, RJ#11711; RJ#11999)
c('ven-096-166', [selfCostB1(ctx => ({ energy: -2 * ctx.trash().filter(id => id !== ctx.self && ctx.name(id) === ctx.name(ctx.self)).length }), { text: 'I cost [2] less for each card with my name in your trash.' })]);

// Tornado Warrior — [Hidden]
c('ven-099-166', [
  when('play', (ev, ctx) => ev.obj === ctx.self && !!ev.fromHidden, ctx => {
    const t = ctx.target(0); if (!t) return;
    empowerB1(ctx, t);
    ctx.delay(DISEMPOWER_AT_END, { obj: t, epoch: epochOf(ctx, t) }, 'endOfTurn');
  }, { optional: 'Tornado Warrior: empower something here (disempower it at end of turn)?', targets: [T.permanent(F.here, { hint: 'help', prompt: 'Empower something here' })], text: 'When you play me from face down, you may empower something here. Disempower it at end of turn.' }),
]);

// Tail-Cloaked Matriarch
c('ven-104-166', [
  when('empower', on.self, ctx => { const t = ctx.target(0); if (t && ctx.obj(t)?.zone === 'trash') ctx.play(t, { ignoreCost: true, destination: 'base' }); }, {
    optional: 'Tail-Cloaked Matriarch: play a unit from your trash?',
    targets: [T.card({ zones: ['trash'], prompt: 'Choose a unit in your trash (Energy [3] or less, Power [A] or less)' }, (cx: Ctx, id: ObjId) => cx.owner(id) === cx.controller && cx.obj(id)?.zone === 'trash' && cx.type(id) === 'Unit' && cx.energyCost(id) <= 3 && cx.powerCost(id) <= 1)],
    text: 'When I become [Empowered], you may choose a unit in your trash with Energy cost no more than [3] and Power cost no more than [A]. Play it to your base, ignoring its cost.',
  }),
]);

// Mel, Cutthroat — [Empower] — Discard a spell
c('ven-110-166', [
  when('empower', on.self, E.banish(0), { targets: [T.unit(F.enemy, F.atBattlefield, F.mightAtMost(3), { hint: 'harm', prompt: 'Banish an enemy unit at a battlefield with 3 [S] or less' })], text: 'When I become [Empowered], banish an enemy unit at a battlefield with 3 [S] or less.' }),
], { costs: { Empower: cost('', payB1.discardSpell()) } });

// Keeper of Law
c('ven-119-166', [
  selfCostB1(ctx => (ctx.controlledBattlefields().some(b => ctx.unitsAt(b).length === 2) ? { energy: -2, power: -1 } : {}), { text: 'I cost [2][C] less if you control a battlefield with exactly two units there.' }),
]);

// Masa
c('ven-120-166', [
  onPlay(E.stun(0), { if: paidB1(), targets: [T.unit(F.enemy, F.atBattlefield, { hint: 'harm', prompt: 'Stun an enemy unit at a battlefield' })], text: 'When you play me, if you paid the additional cost, [Stun] an enemy unit at a battlefield.' }),
], { additionalCosts: [{ cost: cost('[C]'), optional: true, label: 'Pay [C] as an additional cost to play Masa' }] });

// Solari Sunhawk
c('ven-122-166', [statik('self', { might: 1, keywords: ['Deflect 2'] }, { requires: emp(), text: '[Empowered][>] I have +1 [S] and [Deflect 2].' })]);

// Escaped Grayback — [Empower] — Kill a friendly unit
c('ven-124-166', [selfMight(2, { requires: emp(), text: '[Empowered][>] I have +2 [S].' })], { costs: { Empower: cost('', pay.killFriendly()) } });

// Lacerate — [Flow] (engine)
c('ven-127-166', [
  spell(ctx => { const t = ctx.target(0); if (!t) return; if (ctx.isEmpowered(t)) ctx.disempower(t); if (ctx.might(t) <= 3) ctx.kill(t); }, { targets: [T.unit({ hint: 'harm', prompt: 'Choose a unit' })] }),
]);

// Aurok General
c('ven-130-166', [anthem(F.and(F.unit, F.youControl, F.empowered), { might: 2 }, { requires: emp(), text: '[Empowered][>] Your units that are [Empowered] have +2 [S].' })]);

// Glowstone
c('ven-133-166', [
  activated(cost('[T]', pay.disempowerSelf()), ctx => {
    const p = ctx.choosePlayer('Choose a player: they gain control of Glowstone and recall it');
    if (p === undefined) return;
    ctx.takeControl(ctx.self, p);
    ctx.recall(ctx.self);
  }, { label: 'Disempower this, [T]: give control of this to a player', text: 'Disempower this, [T]: Choose a player. They gain control of this and recall it.' }),
  atEndOfTurn(ctx => { ctx.kill(ctx.self); ctx.deal(5, myUnits(ctx)); }, { text: 'At the end of your turn, kill this and deal 5 to all units you control.' }),
]);

// Kayle — up to three Empowered statuses
c('ven-134-166', [
  selfMight(ctx => 2 * (ctx.obj(ctx.self)?.empowered ?? 0), { text: "I have +2 [S] for each time I'm [Empowered]." }),
  selfKeyword(['Deflect 3', 'Ganking'], { requires: emp(3), text: "While I'm [Empowered] three times, I have [Deflect 3] and [Ganking]." }),
], { maxEmpower: 3 });

// Ambessa (Order)
c('ven-136-166', [
  selfKeyword('Assault 2', { requires: emp(), text: '[Empowered][>] I have [Assault 2].' }),
  // "me" / "here": nothing if Ambessa became a new object while it was pending (principle 17; RJ#12846)
  onAttack(ctx => { const t = ctx.target(0); if (t && ctx.sourceSame() && ctx.might(t) < ctx.might(ctx.self)) ctx.kill(t); }, {
    requires: emp(), targets: [T.unit(F.enemy, F.here, (cx: Ctx, id: ObjId) => cx.might(id) < cx.might(cx.self), { hint: 'harm', prompt: 'Kill an enemy unit here with less Might than me' })],
    text: '[Empowered][>] When I attack, kill an enemy unit here with less Might than me.',
  }),
]);

// Rogue Assassin (legend)
const inShowdownBf = (cx: Ctx, id: ObjId) => !!cx.g.showdown && cx.loc(id) === cx.g.showdown.battlefieldIndex;
c('ven-139-166', [
  activated('[T]', ctx => {
    if (!ctx.isMyTurn()) return;
    const t = ctx.target(0); if (!t) return;
    ctx.move(t, 'base');
    if (ctx.isEmpowered(ctx.abilitySource ?? ctx.self)) ctx.ready(t);
  }, { timing: 'action', targets: [T.unit(F.friendly, inShowdownBf, { hint: 'help', prompt: 'Move a friendly unit in a showdown to base' })], label: '[T]: Move a friendly unit in a showdown to base', text: "[Action][>] [T]: If it's your turn, move a friendly unit in a showdown to base and if I'm [Empowered], ready it." }),
]);

// Master of Shadows (legend)
c('ven-143-166', [
  when('banish', (ev, ctx) => {
    const id = ev.obj as ObjId;
    if (!ctx.exists(id) || ctx.owner(id) !== ctx.controller) return false;
    const by = ev.by as ObjId | undefined;
    const lk = ev.lki as { controller?: PlayerId } | undefined;
    const banisher = by && ctx.exists(by) ? ctx.ctrl(by) : lk?.controller;
    return banisher === ctx.controller;
  }, ctx => { empowerB1(ctx, ctx.self); }, { text: 'When you banish a card you own, empower me.' }),
  activated(cost('[T]', pay.disempowerSelf()), E.seq(E.discard(1), E.draw(1)), { timing: 'action', label: 'Disempower me, [T]: Discard 1, then draw 1', text: '[Action][>] Disempower me, [T]: Discard 1, then draw 1.' }),
]);

// Defender of Tomorrow (legend)
c('ven-149-166', [
  activated('[1][T]', E.ready(0), { targets: [T.gear({ hint: 'help', prompt: 'Ready a gear' })], label: '[1], [T]: Ready a gear', text: '[1], [T]: Ready a gear.' }),
  activated('[1][T]', E.ready(0), { requires: emp(), targets: [T.gear({ min: 1, max: 2, hint: 'help', prompt: 'Ready 2 gear' })], label: '[1], [T]: Ready 2 gear', text: '[Empowered][>] [1], [T]: Ready 2 gear.' }),
]);

// "When you empower something else, empower me."
const whenYouEmpowerElse = () => when('empower', (ev, ctx) => ev.obj !== ctx.self && empowererOf(ctx, ev) === ctx.controller, ctx => { empowerB1(ctx, ctx.self); }, { text: 'When you empower something else, empower me.' });

// Soul's Reflection (legend)
c('ven-151-166', [
  whenYouEmpowerElse(),
  activated(cost('[T]', pay.disempowerSelf()), E.might(0, -2), { targets: [T.unit(F.atBattlefield, { hint: 'harm', prompt: 'Give a unit at a battlefield -2 [S] this turn' })], label: 'Disempower me, [T]: -2 [S]', text: 'Disempower me, [T]: Give a unit at a battlefield -2 [S] this turn.' }),
]);

// Matriarch of War (legend)
c('ven-153-166', [
  whenYouEmpowerElse(),
  activated(cost('[A][T]', pay.disempowerSelf()), E.ready(0), { targets: [T.unit({ hint: 'help', prompt: 'Ready a unit' })], label: 'Disempower me, [A], [T]: Ready a unit', text: 'Disempower me, [A], [T]: Ready a unit.' }),
]);

// Heart of the Tempest (legend)
c('ven-155-166', [
  // RULINGS: tokens are not cards (Origins FAQ, Legion), so token plays don't count; Champion Zone / facedown / trash plays do
  when('play', (ev, ctx) => ev.player === ctx.controller && !ev.token && ev.from !== 'hand', ctx => { empowerB1(ctx, ctx.self); }, { text: 'When you play a card from anywhere other than your hand, empower me.' }),
  activated(cost('[T]', pay.disempowerSelf()), E.keyword(0, 'Assault 2'), { timing: 'action', targets: [T.unit({ hint: 'help', prompt: 'Give a unit [Assault 2] this turn' })], label: 'Disempower me, [T]: Assault 2', text: '[Action][>] Disempower me, [T]: Give a unit [Assault 2] this turn.' }),
]);

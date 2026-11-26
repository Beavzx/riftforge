// Batch B3 card scripts (tokens / go-wide). Owned by scripting agent B3.
// Helpers: src/cards/helpers/B3.ts. Tests: tests/cards/B3/*.test.ts.
import {
  card, spell, spellModes, mode, onPlay, deathknell, onDefend, onCombatRole, onConquer, onHold, onMove, whenYouPlay,
  whenUnitDies, atStartOfBeginning, atEndOfTurn, activated, mana, statik, selfMight, anthem, replacement, costModDyn,
  selfCostDyn, playRule, rule, asPlay, showOff, grantable, delayedAbility, reflexiveAbility, D, E, T, F, C, cost, pay, when, dep, on,
  type Ctx, type ObjId, type PlayerId, type GameEvent,
} from '../dsl.ts';
import { victoryScore } from '../../engine/rules.ts';
import {
  playUnitTokens, playGold, playBombs, legion, tokenId, isTokenNamed, unitsOfAt, isAlone, bonusDamage,
  gearDeathRecorder, sourceIsGearOf, exhaustedThings, inShowdownHere,
  type Loc,
} from '../helpers/B3.ts';

// ---------------------------------------------------------------------------------------------
// shared bits
// ---------------------------------------------------------------------------------------------

const mine = (ctx: Ctx, id: ObjId) => ctx.exists(id) && ctx.ctrl(id) === ctx.controller;
/** "your units" / "friendly units": units you control */
const yourUnit = F.and(F.unit, (c, id) => mine(c, id));
const yourMech = F.and(yourUnit, F.tag('Mech'));
const yourTokenUnit = F.and(yourUnit, F.token);
const isRealGear = (ctx: Ctx, id: ObjId) => ctx.isGear(id) && !ctx.isUnit(id);
/** the battlefield index of a battlefield object chosen as a target */
const bfOf = (ctx: Ctx, bfObj: ObjId | undefined) => (bfObj === undefined ? -1 : ctx.g.battlefields.findIndex(b => b.objId === bfObj));
/** "here" for a resolving trigger: where I am now; null if I left the board (CR 359.3.f; RJ#7840 / RJ#6592) */
const hereNow = (ctx: Ctx): Loc | null => (ctx.onBoard(ctx.self) ? ctx.loc(ctx.self) : null);
/**
 * SCRIPT-FIX-2 / CR 387-389: "Then do this:" parts are reflexive chain items (ctx.reflexive). They refer back to objects of the
 * first part through ctx.data; `still(ctx, key)` = those objects that are still on the board as the same objects.
 */
const keepObjs = (ctx: Ctx, ids: ObjId[]) => ids.filter(id => ctx.exists(id)).map(id => ({ id, epoch: ctx.obj(id).epoch ?? 0 }));
const still = (ctx: Ctx, key: string): ObjId[] => ((ctx.data[key] as { id: ObjId; epoch: number }[] | undefined) ?? [])
  .filter(x => ctx.onBoard(x.id) && (ctx.obj(x.id).epoch ?? 0) === x.epoch).map(x => x.id);
/** "becomes a copy of X": X as it is now if still on the board, else its last known card (stored as data[key + 'Card']) */
const copySource = (ctx: Ctx, key: string): ObjId | string | undefined => still(ctx, key)[0] ?? (ctx.data[`${key}Card`] as string | undefined);
/** units of the battlefield-trigger's scoring player (battlefield abilities act for the player who scored) */
const scorer = (ctx: Ctx) => (typeof ctx.event?.player === 'number' ? ctx.event.player as PlayerId : ctx.controller);
const atThisBf = (ev: GameEvent, ctx: Ctx) => ev.bf === ctx.bfIndex();
const unitTokenCard = (ctx: Ctx, cardId: unknown) => typeof cardId === 'string' && !!ctx.g.cards[cardId] && (ctx.g.cards[cardId].type === 'Unit' || ctx.g.cards[cardId].might !== null);

// =============================================================================================
// Token definitions owned by B3
// =============================================================================================

// Gold (CR 187.5): "[Reaction][>] Kill this, [T]: [Add] [A]." Usable mid-payment by the auto-payer.
card('unl-t05', '[Reaction][>] Kill this, [T]: [Add] [A].', [
  // (the DSL's mana() reads the source's domains after paying; a killed token no longer exists, so add [A] directly)
  { ...mana(cost('[T]', pay.killSelf()), { power: ['A'] }, { text: 'Kill this, [T]: Add [A].' }), effect: ctx => ctx.add(0, ['any']) },
]);

// =============================================================================================
// Origins
// =============================================================================================

card('ogn-015-298', 'Other friendly units here have [Assault].', [
  anthem(F.and(F.unit, F.friendly, F.other, F.here), { keywords: ['Assault'] }, { text: 'Other friendly units here have Assault.' }),
]);

card('ogn-020-298', '[Legion] — When you play me, discard 2, then draw 2.', [
  onPlay(ctx => { ctx.discard(2); ctx.draw(2); }, { requires: [legion()], text: 'Legion — When you play me, discard 2, then draw 2.' }),
]);

card('ogn-031-298', 'When you play me, the next spell you play this turn costs [5] less.', [
  onPlay(ctx => ctx.delay(D.nextCostsLess, { energy: -5, power: 0, type: 'Spell' }, 'endOfTurn', 1), { text: 'The next spell you play this turn costs [5] less.' }),
]);

card('ogn-055-298', "While I'm attacking or defending alone, I have +2 [S].", [
  selfMight(2, { if: ctx => (C.attacking(ctx) || C.defending(ctx)) && isAlone(ctx, ctx.self), text: '+2 while attacking or defending alone' }),
]);

card('ogn-074-298', '[Shield]\n[Tank]\nOther friendly units here have [Shield].', [
  anthem(F.and(F.unit, F.friendly, F.other, F.here), { keywords: ['Shield'] }, { text: 'Other friendly units here have Shield.' }),
]);

card('ogn-079-298', "If an opponent's score is within 3 points of the Victory Score, I enter ready.\nStunned enemy units here have -8 [S], to a minimum of 1 [S].", [
  // -8 to a minimum of 1 (CR 477.3.b). The Might it starts from leaves out other static abilities (see dsl-requests).
  // several Leonas: their -8s are limited together over the total (chars.ts floored statics; RJ#1292, ENGINE-9)
  anthem(F.and(F.unit, F.enemy, F.stunned, F.here), { might: -8, mightFloor: 1 }, { text: 'Stunned enemy units here have -8, to a minimum of 1.' }),
], { entersReady: ctx => ctx.opponents().some(p => victoryScore(ctx.g) - ctx.points(p) <= 3) });

card('ogn-094-298', '[Hidden]\n[Action]\nPlay a ready 3 [S] Sprite unit token with [Temporary].', [
  spell(ctx => { playUnitTokens(ctx, 'Sprite', 1, { ready: true }); }),
]);

card('ogn-100-298', '[Vision]\nOther friendly units have [Vision].', [
  anthem(F.and(F.unit, F.friendly, F.other), { keywords: ['Vision'] }, { text: 'Other friendly units have Vision.' }),
]);

card('ogn-106-298', 'When you play me, play a ready 3 [S] Sprite unit token with [Temporary] here.', [
  onPlay(ctx => { playUnitTokens(ctx, 'Sprite', 1, { ready: true, at: 'here' }); }, { text: 'Play a ready Sprite here.' }),
]);

card('ogn-117-298', "When you play a card on an opponent's turn, play a 1 [S] Recruit unit token to your base.", [
  // RJ#231 DECIDED (OGN-FAQ Darius, Trifarian): he sees himself played (CR 383.2.c.1)
  whenYouPlay(F.nonToken, ctx => { playUnitTokens(ctx, 'Recruit', 1, { at: 'base' }); }, { self: true, if: C.notMyTurn, text: "Played a card on an opponent's turn: play a Recruit." }),
]);

card('ogn-151-298', '[Accelerate]\nOther buffed friendly units at my battlefield have +2 [S].', [
  anthem(F.and(F.unit, F.friendly, F.other, F.buffed, F.here), { might: 2 }, { if: C.atBattlefield, text: 'Other buffed friendly units at my battlefield have +2.' }),
]);

card('ogn-187-298', "Starting with the next player, each player may return a unit to its owner's hand.", [
  spell(ctx => {
    ctx.eachPlayer(p => {
      const sub = ctx.as(p);
      const picked = sub.choose(T.unit({ min: 0, max: 1, pick: true, prompt: "Whirlwind: you may return a unit to its owner's hand" }));
      ctx.returnToHand(picked);
    }, { startWithNext: true });
  }),
]);

card('ogn-211-298', 'When you play me, play a 1 [S] Recruit unit token here.', [
  onPlay(ctx => { playUnitTokens(ctx, 'Recruit', 1, { at: 'here' }); }, { text: 'Play a Recruit here.' }),
]);

card('ogn-212-298', 'When you play this, play a 1 [S] Recruit unit token at your base.\nKill this: Recycle up to 4 cards from trashes.', [
  onPlay(ctx => { playUnitTokens(ctx, 'Recruit', 1, { at: 'base' }); }, { text: 'Play a Recruit at your base.' }),
  // RULINGS sweep / CR 355.5: the cards are chosen as the ability is activated (targets), not on resolution
  activated(cost('', pay.killSelf()), ctx => {
    const picked = ctx.targetsOf(0).filter(id => ctx.obj(id)?.zone === 'trash');
    for (const pl of ctx.g.players) ctx.recycle(picked.filter(id => ctx.owner(id) === pl.id));
  }, { targets: [T.upTo(4, T.card({ zones: ['trash'], prompt: 'Recycle up to 4 cards from trashes' }))], text: 'Kill this: Recycle up to 4 cards from trashes.' }),
]);

card('ogn-216-298', '[Deathknell] — Channel 1 rune exhausted.', [
  deathknell(E.channel(1, true), { text: 'Deathknell — Channel 1 rune exhausted.' }),
]);

card('ogn-218-298', '[Legion] — When you play me, play two 1 [S] Recruit unit tokens here.', [
  onPlay(ctx => { playUnitTokens(ctx, 'Recruit', 2, { at: 'here' }); }, { requires: [legion()], text: 'Legion — play two Recruits here.' }),
]);

card('ogn-222-298', 'When I move to a battlefield, play a 1 [S] Recruit unit token here.', [
  onMove(ctx => { const at = hereNow(ctx); if (at !== null) playUnitTokens(ctx, 'Recruit', 1, { at }); }, { toBattlefield: true, text: 'When I move to a battlefield, play a Recruit here.' }),
]);

card('ogn-239-298', '[Deathknell] — Play three 1 [S] Recruit unit tokens into your base.', [
  deathknell(ctx => { playUnitTokens(ctx, 'Recruit', 3, { at: 'base' }); }, { text: 'Deathknell — Play three Recruits into your base.' }),
]);

card('ogn-243-298', '[Legion] — When you play me, ready me.\nOther friendly units have +1 [S] here.', [
  onPlay(E.ready('self'), { requires: [legion()], text: 'Legion — When you play me, ready me.' }),
  anthem(F.and(F.unit, F.friendly, F.other, F.here), { might: 1 }, { text: 'Other friendly units have +1 here.' }),
]);

card('ogn-246-298', 'When another non-Recruit unit you control dies, play a 1 [S] Recruit unit token into your base.', [
  whenUnitDies((ctx, id) => mine(ctx, id) && !ctx.hasTag(id, 'Recruit'), ctx => { playUnitTokens(ctx, 'Recruit', 1, { at: 'base' }); }, { text: 'Another non-Recruit unit you control died: play a Recruit.' }),
]);

card('ogn-265-298', '[1], [T]: Play a 1 [S] Recruit unit token.', [
  activated('[1], [T]', ctx => { playUnitTokens(ctx, 'Recruit', 1); }, { text: '[1], [T]: Play a Recruit.' }),
]);

card('ogn-275-298', 'When you hold here, play a 1 [S] Recruit unit token in your base.', [
  when('hold', atThisBf, ctx => { playUnitTokens(ctx, 'Recruit', 1, { at: 'base', player: scorer(ctx) }); }, { text: 'When you hold here, play a Recruit in your base.' }),
]);

// =============================================================================================
// Origins: Proving Grounds
// =============================================================================================

card('ogs-001-024', 'Your spells and abilities deal 1 Bonus Damage.', [
  // spells and abilities only: not combat damage or unit-dealt (fight) damage (CR 418.6.b.3)
  bonusDamage((ctx, ev) => ev.player === ctx.controller && !ev.combat && !ev.unitDealt, 1, 'Annie: your spells and abilities deal 1 Bonus Damage'),
]);

card('ogs-013-024', 'Other friendly units have +1 [S] here.', [
  anthem(F.and(F.unit, F.friendly, F.other, F.here), { might: 1 }, { text: 'Other friendly units have +1 here.' }),
]);

card('ogs-015-024', '[Action]\nPlay four 1 [S] Recruit unit tokens.', [
  spell(ctx => { playUnitTokens(ctx, 'Recruit', 4); }),
]);

// =============================================================================================
// Radiance
// =============================================================================================

card('rad-001-167', 'When you play me, play a Bomb gear token to a battlefield.', [
  onPlay(ctx => { playBombs(ctx, 1); }, { text: 'Play a Bomb to a battlefield.' }),
]);

card('rad-007-167', 'Choose an occupied enemy battlefield. Play three 1 [S] Recruit unit tokens there.', [
  spell(ctx => {
    const bf = bfOf(ctx, ctx.target(0));
    if (bf < 0) return;
    playUnitTokens(ctx, 'Recruit', 3, { at: bf });
  }, { targets: [T.battlefield((ctx, id) => { const i = bfOf(ctx, id); const c = ctx.bfController(i); return c !== null && ctx.isOpponent(c) && ctx.unitsAt(i).length > 0; }, { prompt: 'Choose an occupied enemy battlefield', hint: 'harm' })] }),
]);

card('rad-009-167', 'I enter ready.\nWhen you play me, play a ready 3 [S] Mech unit token here.', [
  onPlay(ctx => { playUnitTokens(ctx, 'Mech', 1, { at: 'here', ready: true }); }, { text: 'Play a ready Mech here.' }),
], { entersReady: true });

card('rad-011-167', '[Show Off] a Mech.\nI enter ready if you showed off.', [
  showOff(F.tag('Mech'), 'Show off a Mech?'),
], { entersReady: C.showedOff, keywords: ['Show Off'] });

card('rad-022-167', '[T]: Play a Gold gear token exhausted.\nKill a friendly gear, [T]: Play a 1 [S] Recruit unit token.\nKill a friendly unit, [T]: Play a 3 [S] Mech unit token.', [
  activated('[T]', ctx => { playGold(ctx, 1); }, { text: '[T]: Play a Gold exhausted.' }),
  activated(cost('[T]', pay.killFriendly((c, id) => isRealGear(c, id), 'Kill a friendly gear')), ctx => { playUnitTokens(ctx, 'Recruit', 1); }, { text: 'Kill a friendly gear, [T]: Play a Recruit.' }),
  activated(cost('[T]', pay.killFriendly((c, id) => c.isUnit(id), 'Kill a friendly unit')), ctx => { playUnitTokens(ctx, 'Mech', 1); }, { text: 'Kill a friendly unit, [T]: Play a Mech.' }),
]);

card('rad-023-167', 'When you play me, play a Bomb gear token to a battlefield.\nAbilities of friendly gear deal 1 Bonus Damage.', [
  onPlay(ctx => { playBombs(ctx, 1); }, { text: 'Play a Bomb to a battlefield.' }),
  bonusDamage((ctx, ev) => sourceIsGearOf(ctx, ev.source, ctx.controller), 1, 'Ziggs: abilities of friendly gear deal 1 Bonus Damage'),
  gearDeathRecorder,
]);

card('rad-037-167', 'Your gear have [Deflect].', [
  anthem((ctx, id) => isRealGear(ctx, id) && mine(ctx, id), { keywords: ['Deflect'] }, { text: 'Your gear have Deflect.' }),
]);

card('rad-039-167', 'Your units have +2 [S].\nWhen you play a unit, kill this.', [
  anthem(yourUnit, { might: 2 }, { text: 'Your units have +2.' }),
  whenYouPlay(F.unit, ctx => { if (ctx.onBoard(ctx.self)) ctx.kill(ctx.self); }, { text: 'When you play a unit, kill this.' }),
]);

const heartenGrant = grantable('rad-040-167:legendPump', activated('[T]', E.might(0, 3), { targets: [T.unit({ hint: 'help', prompt: 'Give a unit +3 [S] this turn' })], text: '[T]: Give a unit +3 [S] this turn.' }));
card('rad-040-167', 'When you play me, ready a friendly legend.\nFriendly legends have "[T]: Give a unit +3 [S] this turn."', [
  onPlay(E.ready(0), { targets: [T.legend(F.friendly, { hint: 'help', prompt: 'Ready a friendly legend' })], text: 'Ready a friendly legend.' }),
  statik((ctx, id) => ctx.obj(id)?.zone === 'legendZone' && ctx.isFriendly(id), { grants: [heartenGrant] }, { text: 'Friendly legends have "[T]: Give a unit +3 this turn."' }),
]);

card('rad-049-167', 'When you play me, play a 3 [S] Mech unit token here.', [
  onPlay(ctx => { playUnitTokens(ctx, 'Mech', 1, { at: 'here' }); }, { text: 'Play a Mech here.' }),
]);

card('rad-052-167', '[Deploy]\nAt the end of your turn, if you control this battlefield, play a Gold gear token exhausted.', [
  atEndOfTurn(ctx => { playGold(ctx, 1); }, { if: ctx => { const h = ctx.here(); return typeof h === 'number' && ctx.controls(h); }, text: 'End of turn, if you control this battlefield: play a Gold exhausted.' }),
]);

card('rad-055-167', 'Your Mechs have [Disarm].', [
  anthem(yourMech, { keywords: ['Disarm'] }, { text: 'Your Mechs have Disarm.' }),
]);

card('rad-063-167', "[Disarm].\nWhile I'm in a showdown, your spells have [Reaction].", [
  playRule((ctx, id) => ctx.isSpell(id) && inShowdownHere(ctx), { grantsTiming: 'reaction', text: "While I'm in a showdown, your spells have Reaction." }),
]);

card('rad-093-167', 'I enter ready if you control no other units.\n[Disarm 2]', [], {
  entersReady: ctx => ctx.units(u => u !== ctx.self && ctx.ctrl(u) === ctx.controller).length === 0,
});

card('rad-094-167', 'When I hold, play three Bomb gear tokens to a single battlefield.', [
  onHold(ctx => { playBombs(ctx, 3); }, { text: 'When I hold, play three Bombs to a single battlefield.' }),
]);

card('rad-096-167', '[Action]\nMove a friendly unit, then play a Bomb gear token to a battlefield.', [
  spell(ctx => {
    E.moveToChosen(0, 1)(ctx);
    playBombs(ctx, 1);
  }, { targets: [T.unit(F.friendly, { hint: 'help', prompt: 'Move a friendly unit' }), T.destination(F.moveDestFor(0), { prompt: 'Move it to' })] }),   // R-2
]);

card('rad-100-167', "[Hidden]\nPlay a Gold gear token exhausted. If it's your turn and you played this from face down, play three ready Gold gear tokens instead.", [
  spell(ctx => {
    if (ctx.isMyTurn() && C.playedFromHidden(ctx)) playGold(ctx, 3, { exhausted: false });
    else playGold(ctx, 1);
  }),
]);

card('rad-101-167', "[Action]\nKill a gear. Its controller plays a Gold gear token exhausted.", [
  spell(ctx => {
    const t = ctx.target(0);
    if (!t) return;
    const p = ctx.ctrl(t);
    ctx.kill(t);
    playGold(ctx, 1, { player: p });
  }, { targets: [T.gear({ hint: 'harm', prompt: 'Kill a gear' })] }),
]);

const payC = cost('[C]');
card('rad-105-167', '[Accelerate]\nWhen I become exhausted, choose one —\n- Play a Gold gear token exhausted.\n- Pay [C] to draw 1.', [
  // R-1 (CR 403.2, rulings B3): the mode is chosen as the trigger goes on the chain — both are offered; the [C] is a cost inside
  // the instruction, paid (or declined, skipping the draw) on resolution
  when('exhaust', on.self, E.noop, {
    modes: [
      mode('gold', 'Play a Gold gear token exhausted', ctx => { playGold(ctx, 1); }),
      mode('draw', 'Pay [C] to draw 1', ctx => { if (ctx.mayPay(payC, 'Reckless Innovator: pay [C] to draw 1?')) ctx.draw(1); }),
    ],
    text: 'When I become exhausted, choose one: Gold, or pay [C] to draw 1.',
  }),
]);

card('rad-112-167', '[1], [T]: Play a Bomb gear token to a battlefield.\nWhen I defend, you may kill a friendly gear to give me +2 [S] this turn.', [
  activated('[1], [T]', ctx => { playBombs(ctx, 1); }, { text: '[1], [T]: Play a Bomb to a battlefield.' }),
  // RULINGS sweep / CR 383.3.b: "you may kill a friendly gear to …" is the trigger's base cost, paid as it goes on the chain
  onDefend(ctx => { ctx.giveMight(ctx.self, 2, 'endOfTurn'); }, {
    optional: 'Ziggs: kill a friendly gear to give him +2 [S] this turn?',
    cost: cost('', pay.killFriendly((c, id) => isRealGear(c, id), 'Kill a friendly gear')),
    text: 'When I defend, you may kill a friendly gear to give me +2 this turn.',
  }),
]);

const recruitToBase = (ctx: Ctx) => { playUnitTokens(ctx, 'Recruit', 1, { at: 'base' }); };
card('rad-116-167', '[Deploy]\nWhen you play this or when you conquer here, you may pay [1] to play a 1 [S] Recruit unit token to your base.', [
  // "you may pay [1] to ...": decided and paid as the trigger goes on the chain (CR 383.3.a-b)
  onPlay(recruitToBase, { optional: 'Concert Poster: pay [1] to play a Recruit to your base?', cost: cost('[1]'), text: 'You may pay [1] to play a Recruit to your base.' }),
  when('conquer', (ev, ctx) => ev.player === ctx.controller && typeof ctx.here() === 'number' && ev.bf === ctx.here(), recruitToBase, { optional: 'Concert Poster: pay [1] to play a Recruit to your base?', cost: cost('[1]'), text: 'When you conquer here, you may pay [1] to play a Recruit to your base.' }),
]);

card('rad-119-167', '[Deathknell][>] Play a 1 [S] Bird unit token with [Deflect] to your base.', [
  deathknell(ctx => { playUnitTokens(ctx, 'Bird', 1, { at: 'base' }); }, { text: 'Deathknell — Play a Bird to your base.' }),
]);

card('rad-127-167', '[Show Off] a card with Energy cost [7] or more.\nPlay two 1 [S] Recruit unit tokens to your base. If you showed off, play four to your base instead.', [
  showOff((ctx, id) => ctx.energyCost(id) >= 7, 'Show off a card with Energy cost [7] or more?'),
  spell(ctx => { playUnitTokens(ctx, 'Recruit', ctx.data.shownOff ? 4 : 2, { at: 'base' }); }),
], { keywords: ['Show Off'] });

card('rad-132-167', "If you would play a unit token to a location while I'm at a battlefield, you may play a 3 [S] Mech unit token to that same location instead.", [
  replacement('createToken',
    (ev, ctx) => ev.player === ctx.controller && ctx.atBattlefield(ctx.self) && unitTokenCard(ctx, ev.cardId) && ev.cardId !== tokenId(ctx, 'Mech'),
    (ev, ctx) => ({ ...ev, cardId: tokenId(ctx, 'Mech'), might: null }),
    { optional: 'Heimerdinger: play a 3 [S] Mech unit token instead?', text: 'Heimerdinger: play a Mech instead' }),
]);

card('rad-138-167', 'When you play me or when I become exhausted, play a 1 [S] Recruit unit token to your base.\nI have +1 [S] for each other exhausted unit you control.', [
  onPlay(recruitToBase, { text: 'Play a Recruit to your base.' }),
  when('exhaust', on.self, recruitToBase, { text: 'When I become exhausted, play a Recruit to your base.' }),
  selfMight(ctx => ctx.units(u => u !== ctx.self && mine(ctx, u) && ctx.isExhausted(u)).length, { text: '+1 for each other exhausted unit you control' }),
]);

card('rad-141-167', '[1][A], [T]: Play a Bomb gear token to a battlefield.', [
  activated('[1][A], [T]', ctx => { playBombs(ctx, 1); }, { text: '[1][A], [T]: Play a Bomb to a battlefield.' }),
]);

const minefieldLater = delayedAbility('rad-142-167:atEnd', when('endOfTurn', null, ctx => { playBombs(ctx, Number(ctx.data.n ?? 0)); }, { text: 'Hexplosive Minefield: play the Bombs' }));
card('rad-142-167', '[Action]\nKill any number of friendly Bomb tokens. At end of turn, play that many Bomb tokens to a single battlefield.', [
  // RULINGS sweep / CR 355.5: the Bombs are chosen as the spell is played (targets)
  spell(ctx => {
    const n = ctx.kill(ctx.targetsOf(0)).length;
    if (n > 0) ctx.delay(minefieldLater, { n }, 'endOfTurn', 1);
  }, { targets: [T.anyNumber(T.gear((c, id) => mine(c, id) && isTokenNamed(c, id, 'Bomb'), { prompt: 'Kill any number of friendly Bomb tokens' }))] }),
]);

card('rad-152-167', 'Choose two —\n- Deal 2 to a unit.\n- Play two 1 [S] Recruit unit tokens.\n- Give up to two units each +1 [S] this turn.\n- Look at the top 2 cards of your Main Deck, draw 1 and recycle the other.', [
  spellModes([
    mode('deal', 'Deal 2 to a unit', E.deal(2, 0), [T.unit({ hint: 'harm', prompt: 'Deal 2 to a unit' })]),
    mode('recruits', 'Play two 1 [S] Recruit unit tokens', ctx => { playUnitTokens(ctx, 'Recruit', 2); }),
    mode('pump', 'Give up to two units each +1 [S] this turn', E.might(0, 1), [T.upTo(2, T.unit({ hint: 'help', prompt: 'Give up to two units +1 [S]' }))]),
    mode('look', 'Look at the top 2, draw 1 and recycle the other', ctx => {
      const top = ctx.lookTop(2);
      const keep = ctx.chooseCards(top, 1, 1, 'Draw which card?');
      // RULINGS: the text says "draw 1" — the chosen card is drawn (draw event / "when you draw" triggers), not just moved
      for (const id of keep) ctx.drawCard(id);
      ctx.recycle(top.filter(id => !keep.includes(id)));
    }),
  ], { choose: 2 }),
]);

card('rad-157-167', 'When you hide a card here, play a Gold gear token exhausted.', [
  when('hide', atThisBf, ctx => { playGold(ctx, 1, { player: scorer(ctx) }); }, { text: 'When you hide a card here, play a Gold exhausted.' }),
]);

card('rad-159-167', 'For each player, the first time each turn a non-token unit they control dies here, they play a 1 [S] Recruit unit token to their base.', [
  when('die', (ev, ctx) => {
    const lki = ev.lki as { loc?: Loc; controller?: PlayerId; isToken?: boolean; type?: string } | undefined;
    if (!lki || lki.type !== 'Unit' || lki.isToken || lki.loc !== ctx.bfIndex() || lki.controller === undefined) return false;
    const key = `b3:roseSanctum:${ctx.self}:${ctx.turn()}:${lki.controller}`;
    if (ctx.count(key) > 0) return false;
    ctx.bump(key);
    return true;
  }, ctx => {
    const p = (ctx.event?.lki as { controller: PlayerId }).controller;
    playUnitTokens(ctx, 'Recruit', 1, { at: 'base', player: p });
  }, { text: 'First non-token unit of a player to die here this turn: they play a Recruit.' }),
]);

// =============================================================================================
// Spiritforged
// =============================================================================================

/** Bushwhack: friendly unit *tokens* enter ready this turn too (the engine's playRule covers cards only). */
const tokensEnterReady = delayedAbility('sfd-004-221:tokensReady', replacement('createToken', (ev, ctx) => ev.player === ctx.controller && unitTokenCard(ctx, ev.cardId) && ev.exhausted !== false, ev => ({ ...ev, exhausted: false }), { text: 'Friendly units enter ready this turn' }));
card('sfd-004-221', '[Hidden]\nFriendly units enter ready this turn. Play a Gold gear token exhausted.', [
  spell(ctx => {
    ctx.delay(D.unitsEnterReady, {}, 'endOfTurn');
    ctx.delay(tokensEnterReady, {}, 'endOfTurn');
    playGold(ctx, 1);
  }),
]);

card('sfd-019-221', '[1][C], Recycle a unit from your trash, [T]: Play a 3 [S] Mech unit token to your base.', [
  activated(cost('[1][C], [T]', pay.recycleFromTrash(1, (c, id) => c.type(id) === 'Unit')), ctx => { playUnitTokens(ctx, 'Mech', 1, { at: 'base' }); }, { text: '[1][C], recycle a unit from your trash, [T]: Play a Mech to your base.' }),
]);

card('sfd-020-221', 'When I win a combat, play a Gold gear token exhausted.\nWhen I attack or defend, you may pay [C] to give me +2 [M] this turn.', [
  when('combatResult', (ev, ctx) => ev.winner === ctx.controller && ctx.onBoard(ctx.self) && ctx.loc(ctx.self) === ev.bf && !!ctx.obj(ctx.self).combatRole, ctx => { playGold(ctx, 1); }, { text: 'When I win a combat, play a Gold exhausted.' }),
  onCombatRole(E.might('self', 2), { optional: 'Draven: pay [C] to give him +2 [M] this turn?', cost: cost('[C]'), text: 'When I attack or defend, you may pay [C] to give me +2 this turn.' }),
]);

card('sfd-021-221', '[Deathknell] — Play two 3 [S] Mech unit tokens to your base.', [
  deathknell(ctx => { playUnitTokens(ctx, 'Mech', 2, { at: 'base' }); }, { text: 'Deathknell — Play two Mechs to your base.' }),
]);

const rumbleDiscount = delayedAbility('sfd-026-221:discount', costModDyn((ctx, id) => (id === ctx.data.obj ? { energy: -Number(ctx.data.n ?? 0), power: 0 } : null)));
const rumbleOthers = (ctx: Ctx) => ctx.friendlyUnits(u => u !== ctx.self && mine(ctx, u));
const rumbleMechs = (ctx: Ctx) => ctx.trash().filter(id => ctx.type(id) === 'Unit' && ctx.hasTag(id, 'Mech'));
card('sfd-026-221', 'Your Mechs each have [Assault].\nWhen I conquer, you may recycle another friendly unit to play a Mech from your trash. Reduce its Energy cost by the Might of the unit you recycled.', [
  anthem(yourMech, { keywords: ['Assault'] }, { text: 'Your Mechs each have Assault.' }),
  // RULINGS sweep / CR 383.3.b: the recycle is the trigger's base cost, paid as it goes on the chain; the cost writes the recycled
  // unit's Might into the item's data (SF-5)
  onConquer(ctx => {
    const m = Number(ctx.data.rumbleMight ?? 0);
    const mech = ctx.chooseCards(rumbleMechs(ctx), 1, 1, 'Play which Mech from your trash?')[0];
    if (!mech) return;
    ctx.delay(rumbleDiscount, { obj: mech, n: m }, 'endOfTurn', 1);
    ctx.play(mech, { ignoreCost: false });
  }, {
    optional: 'Rumble: recycle another friendly unit to play a Mech from your trash?',
    cost: cost('', pay.custom('Recycle another friendly unit', c => rumbleOthers(c).length > 0 && rumbleMechs(c).length > 0, c => {
      const u = c.chooseCards(rumbleOthers(c), 1, 1, 'Recycle another friendly unit')[0];
      if (!u) return false;
      c.data.rumbleMight = c.might(u);
      c.recycle(u);
      return true;          // RJ#3009: a token recycled for the cost ceases to exist, but the cost was paid
    })),
    text: 'When I conquer, you may recycle another friendly unit to play a Mech from your trash for less.',
  }),
]);

card('sfd-029-221', "[Accelerate]\n[Assault]\nFriendly units played from anywhere other than a player's hand have [Accelerate].", [
  // RJ#6734 / RJ#10570: engine play rule grantKeywords (keywords a card has while being played / in a non-board zone)
  playRule((ctx, id) => {
    if (!ctx.exists(id) || ctx.type(id) !== 'Unit' || ctx.owner(id) !== ctx.controller && ctx.ctrl(id) !== ctx.controller) return false;
    const z = ctx.obj(id).zone;
    if (z === 'chain') return (ctx.g.chain.find(c => c.source === id)?.from ?? 'hand') !== 'hand';
    return z !== 'hand' && z !== 'base' && z !== 'battlefield';
  }, { grantKeywords: () => ['Accelerate'], text: "Friendly units played from anywhere other than a player's hand have [Accelerate]." }),
]);

card('sfd-031-221', '[Repeat] [2]\nPlay a 2 [S] Sand Soldier unit token.', [
  spell(ctx => { playUnitTokens(ctx, 'Sand Soldier', 1); }),
]);

card('sfd-036-221', '[Deathknell] — If I died alone, draw 1.', [
  deathknell(ctx => { if ((ctx.event?.lki as { alone?: boolean } | undefined)?.alone) ctx.draw(1); }, { text: 'Deathknell — If I died alone, draw 1.' }),
]);

card('sfd-054-221', '[Deflect]\nYour Equipment everywhere have [Quick-Draw].', [
  anthem((ctx, id) => mine(ctx, id) && ctx.isEquipment(id), { keywords: ['Quick-Draw'] }, { text: 'Your Equipment have Quick-Draw.' }),
  // Quick-Draw in hand: Reaction timing (CR 819). The attach-on-play part comes from the board keyword above.
  playRule((ctx, id) => ctx.isEquipment(id), { grantsTiming: 'reaction', text: 'Your Equipment have Quick-Draw (Reaction).' }),
]);

card('sfd-063-221', "When you play a spell on an opponent's turn, you may exhaust me to play a Gold gear token exhausted.", [
  whenYouPlay(F.spell, ctx => playGold(ctx, 1), {
    // principle 11 (CR 383.3.a-b): the leading "you may" (and its cost) is decided as the trigger is chained (ENGINE-6)
    if: C.notMyTurn, optional: 'Chemtech Cask: exhaust it to play a Gold gear token exhausted?', cost: { exhaustSelf: true },
    text: "Spell on an opponent's turn: you may exhaust me to play a Gold.",
  }),
]);

card('sfd-065-221', 'Your Mechs have [Vision].', [
  anthem(yourMech, { keywords: ['Vision'] }, { text: 'Your Mechs have Vision.' }),
]);

card('sfd-069-221', 'When I conquer, play a Gold gear token exhausted.', [
  onConquer(ctx => { playGold(ctx, 1); }, { text: 'When I conquer, play a Gold exhausted.' }),
]);

card('sfd-070-221', '[Hidden]\n[Action]\nDeal 3 to a unit at a battlefield. Play a Gold gear token exhausted.', [
  spell(ctx => { const t = ctx.target(0); if (t) ctx.deal(3, t); playGold(ctx, 1); }, { targets: [T.unit(F.atBattlefield, { hint: 'harm', prompt: 'Deal 3 to a unit at a battlefield' })] }),
]);

card('sfd-071-221', 'Your Mechs have [Deflect] and [Ganking].\nI enter ready if you control another Mech.', [
  anthem(yourMech, { keywords: ['Deflect', 'Ganking'] }, { text: 'Your Mechs have Deflect and Ganking.' }),
], { entersReady: ctx => ctx.units(u => u !== ctx.self && mine(ctx, u) && ctx.hasTag(u, 'Mech')).length > 0 });

card('sfd-074-221', 'When you play me, you may kill a gear with Energy cost no more than [1]. If you do, play a Gold gear token exhausted.', [
  onPlay(ctx => {
    const t = ctx.target(0);
    if (t && ctx.kill(t).length) playGold(ctx, 1);
  }, { targets: [T.upTo(1, T.gear(F.costAtMost(1), { hint: 'harm', prompt: 'You may kill a gear with Energy cost [1] or less' }))], text: 'You may kill a gear costing [1] or less. If you do, play a Gold.' }),
]);

card('sfd-076-221', 'This costs [2] less if you control a Mech.\nPlay a 3 [S] Mech unit token to your base.\nDraw 1.', [
  selfCostDyn(ctx => (ctx.units(u => mine(ctx, u) && ctx.hasTag(u, 'Mech')).length ? { energy: -2 } : {})),
  spell(ctx => { playUnitTokens(ctx, 'Mech', 1, { at: 'base' }); ctx.draw(1); }),
]);

card('sfd-081-221', 'When you play me, you and each opponent may play a Gold gear token exhausted. For each opponent who did, you play a Gold gear token exhausted.', [
  onPlay(ctx => {
    if (ctx.may('Play a Gold gear token exhausted?')) playGold(ctx, 1);
    let did = 0;
    for (const p of ctx.opponents()) if (ctx.mayFor(p, 'Card Sharp: play a Gold gear token exhausted? (Its controller will also get one.)')) { playGold(ctx, 1, { player: p }); did++; }
    if (did) playGold(ctx, did);
  }, { text: 'You and each opponent may play a Gold; you get one more for each opponent who did.' }),
]);

card('sfd-089-221', 'Your Mechs have +1 [S].\nWhen I hold, play a 3 [S] Mech unit token to your base.', [
  anthem(yourMech, { might: 1 }, { text: 'Your Mechs have +1 (including me).' }),
  onHold(ctx => { playUnitTokens(ctx, 'Mech', 1, { at: 'base' }); }, { text: 'When I hold, play a Mech to your base.' }),
]);

card('sfd-101-221', 'When you play me, buff up to four friendly units.\nWhen you spend a buff, play a Gold gear token exhausted.', [
  onPlay(E.buff(0), { targets: [T.upTo(4, T.unit(F.friendly, { hint: 'help', prompt: 'Buff up to four friendly units' }))], text: 'Buff up to four friendly units.' }),
  when('spendBuff', (ev, ctx) => typeof ev.obj === 'string' && mine(ctx, ev.obj), ctx => { playGold(ctx, 1); }, { text: 'When you spend a buff, play a Gold exhausted.' }),
]);

card('sfd-121-221', 'When you play a card from face down, play a Gold gear token exhausted.', [
  when('play', (ev, ctx) => ev.player === ctx.controller && !!ev.fromHidden && !ev.token, ctx => { playGold(ctx, 1); }, { text: 'When you play a card from face down, play a Gold exhausted.' }),
]);

card('sfd-130-221', 'When I move, play a Gold gear token exhausted.', [
  onMove(ctx => { playGold(ctx, 1); }, { text: 'When I move, play a Gold exhausted.' }),
]);

card('sfd-152-221', 'When I hold, play two Gold gear tokens exhausted.', [
  onHold(ctx => { playGold(ctx, 2); }, { text: 'When I hold, play two Gold exhausted.' }),
]);

// CR 387-389 / 383.3.b: "Then do this: You may pay [C] to ready it" is a reflexive item; its "you may pay" is decided and paid as
// it goes on the chain (not offered when [C] can't be paid), opponents may respond before the ready
const guardsReady = reflexiveAbility('B3:guards:ready', {
  // SF2-1: offered only while the Sand Soldier is still on the board and exhausted (a token that entered ready gives nothing to do)
  offerIf: ctx => still(ctx, 'tok').some(s => ctx.onBoard(s) && ctx.isExhausted(s)),
  optional: 'Guards!: pay [C] to ready the Sand Soldier?', cost: payC,
  effect: ctx => { ctx.ready(still(ctx, 'tok')); },
  text: 'Guards!: you may pay [C] to ready it',
});
card('sfd-154-221', '[Hidden]\nPlay a 2 [M] Sand Soldier unit token. Then do this: You may pay [C] to ready it.', [
  spell(ctx => {
    const [s] = playUnitTokens(ctx, 'Sand Soldier', 1);
    if (s && ctx.onBoard(s)) ctx.reflexive(guardsReady, { tok: keepObjs(ctx, [s]) });
  }),
]);

card('sfd-155-221', '[Deathknell] — Play a Gold gear token exhausted.', [
  deathknell(ctx => { playGold(ctx, 1); }, { text: 'Deathknell — Play a Gold exhausted.' }),
]);

card('sfd-157-221', 'When you play me, play a 2 [S] Sand Soldier unit token here.', [
  onPlay(ctx => { playUnitTokens(ctx, 'Sand Soldier', 1, { at: 'here' }); }, { text: 'Play a Sand Soldier here.' }),
]);

card('sfd-159-221', 'While you have another unit here, I have +1 [S].', [
  selfMight(1, { if: ctx => { const h = ctx.here(); return h !== null && unitsOfAt(ctx, h).some(u => u !== ctx.self); }, text: '+1 while you have another unit here' }),
]);

card('sfd-162-221', '[Action]\nKill a unit at a battlefield with 2 [S] or less. If it was an enemy unit, play a Gold gear token exhausted. If it was a friendly unit, play two Gold gear tokens exhausted.', [
  spell(ctx => {
    const t = ctx.target(0);
    if (!t) return;
    const enemy = ctx.isEnemy(t);
    if (!ctx.kill(t).length) return;
    playGold(ctx, enemy ? 1 : 2);
  }, { targets: [T.unit(F.atBattlefield, F.mightAtMost(2), { hint: 'harm', prompt: 'Kill a unit at a battlefield with 2 [S] or less' })] }),
]);

card('sfd-168-221', '[T]: Play three 1 [S] Recruit unit tokens.', [
  activated('[T]', ctx => { playUnitTokens(ctx, 'Recruit', 3); }, { text: '[T]: Play three Recruits.' }),
]);

card('sfd-171-221', 'Your tokens enter ready.', [
  replacement('createToken', (ev, ctx) => ev.player === ctx.controller && ev.exhausted !== false, ev => ({ ...ev, exhausted: false }), { text: 'Renata: your tokens enter ready' }),
]);

card('sfd-174-221', 'When you play me, play four Gold gear tokens exhausted.', [
  onPlay(ctx => { playGold(ctx, 4); }, { text: 'Play four Gold exhausted.' }),
]);

card('sfd-176-221', '[Tank]\nI enter ready if you have two or more other units in your base.', [], {
  entersReady: ctx => unitsOfAt(ctx, 'base').filter(u => u !== ctx.self).length >= 2,
});

card('sfd-179-221', '[Accelerate]\nWhen I move to a battlefield, play three 1 [S] Recruit unit tokens here.', [
  onMove(ctx => { const at = hereNow(ctx); if (at !== null) playUnitTokens(ctx, 'Recruit', 3, { at }); }, { toBattlefield: true, text: 'When I move to a battlefield, play three Recruits here.' }),
]);

card('sfd-181-221', 'Your Mechs have [Shield].', [
  anthem(yourMech, { keywords: ['Shield'] }, { text: 'Your Mechs have Shield.' }),
]);

card('sfd-197-221', "Your Sand Soldiers have [Weaponmaster].\n[1], [T]: Play a 2 [S] Sand Soldier unit token to your base. Use only if you've played an Equipment this turn.", [
  anthem(F.and(yourUnit, F.tag('Sand Soldier')), { keywords: ['Weaponmaster'] }, { text: 'Your Sand Soldiers have Weaponmaster.' }),
  activated('[1], [T]', ctx => { playUnitTokens(ctx, 'Sand Soldier', 1, { at: 'base' }); }, {
    if: ctx => ctx.playedThisTurn().some(id => ctx.exists(id) && !ctx.isToken(id) && ctx.isEquipment(id)),
    text: "[1], [T]: Play a Sand Soldier to your base (only if you've played an Equipment this turn).",
  }),
]);

// CR 387-389: "Then do this: Ready up to two of them" is a reflexive item; the two Sand Soldiers are its targets, chosen as it
// goes on the chain (CR 355.5 / 388), and opponents may respond before they ready
const ariseReady = reflexiveAbility('B3:arise:ready', {
  targets: [T.upTo(2, T.unit((c, id) => still(c, 'toks').includes(id) && c.isExhausted(id), { hint: 'help', prompt: 'Ready up to two of the Sand Soldiers' }))],
  effect: ctx => { ctx.ready(ctx.targetsOf(0)); },
  text: 'Arise!: ready up to two of them',
});
card('sfd-198-221', 'Play a 2 [M] Sand Soldier unit token for each Equipment you control. Then do this: Ready up to two of them.', [
  spell(ctx => {
    const n = ctx.gear(id => mine(ctx, id) && ctx.isEquipment(id)).length;
    const made = playUnitTokens(ctx, 'Sand Soldier', n).filter(id => ctx.onBoard(id));
    if (made.some(id => ctx.isExhausted(id))) ctx.reflexive(ariseReady, { toks: keepObjs(ctx, made) });
  }),
]);

card('sfd-203-221', 'When you recycle a rune, you may exhaust me to play a Gold gear token exhausted.\nWhen one or more enemy units die, ready me.', [
  // RJ#8067 / CR 383.3.a-b: the "you may" and the exhaust cost are decided / paid as the trigger goes on the chain
  when('recycle', (ev, ctx) => ((ev.objs as ObjId[] | undefined) ?? []).some(id => ctx.exists(id) && ctx.type(id) === 'Rune' && ctx.owner(id) === ctx.controller), ctx => {
    playGold(ctx, 1);
  }, { optional: 'Exhaust Battle Mistress to play a Gold gear token exhausted?', cost: cost('[T]'), text: 'When you recycle a rune, you may exhaust me to play a Gold.' }),
  // "one or more": one trigger per batch of simultaneous deaths
  when('die', (ev, ctx) => {
    if (typeof ev.obj !== 'string' || !ctx.exists(ev.obj) || !ctx.isUnit(ev.obj) || !ctx.isEnemy(ev.obj)) return false;
    return !(ctx.g.triggerQueue as { source?: ObjId; event?: { type?: string } }[]).some(q => q.source === ctx.self && q.event?.type === 'die');
  }, E.ready('self'), { text: 'When one or more enemy units die, ready me.' }),
]);

card('sfd-207-221', 'When you conquer here, you may pay [1] and return a unit you control here to its owner\'s hand to play a 2 [M] Sand Soldier unit token here.', [
  // RULINGS sweep / CR 383.3.b: "[1] and return a unit you control here" is the base cost, paid as the trigger goes on the chain
  // (the conqueror controls the battlefield by then, so the trigger is theirs)
  when('conquer', (ev, ctx) => atThisBf(ev, ctx) && ev.player === ctx.controller, ctx => {
    playUnitTokens(ctx.as(scorer(ctx)), 'Sand Soldier', 1, { at: ctx.bfIndex() });
  }, {
    optional: "Emperor's Dais: pay [1] and return a unit you control here to its owner's hand to play a Sand Soldier here?",
    cost: cost('[1]', pay.custom('Return a unit you control here to its owner\'s hand', c => unitsOfAt(c, c.bfIndex()).length > 0, c => {
      const u = c.chooseCards(unitsOfAt(c, c.bfIndex()), 1, 1, "Return a unit you control here to its owner's hand")[0];
      return !!u && c.returnToHand(u).length === 1;
    })),
    text: 'When you conquer here, you may pay [1] and return a unit here to play a Sand Soldier here.',
  }),
]);

card('sfd-220-221', 'When you conquer here, you may pay [1] to play a Gold gear token exhausted.', [
  when('conquer', atThisBf, ctx => playGold(ctx.as(scorer(ctx)), 1), {
    // principle 11 (CR 383.3.a-b): the leading "may pay" is decided and paid as the trigger is chained (ENGINE-6, as RJ#12403)
    payer: scorer, optional: 'Treasure Hoard: pay [1] to play a Gold gear token exhausted?', cost: cost('[1]'),
    text: 'When you conquer here, you may pay [1] to play a Gold.',
  }),
]);

// =============================================================================================
// Unleashed
// =============================================================================================

card('unl-018-219', 'When I conquer, if you assigned 3 or more excess damage, play two Gold gear tokens exhausted.', [
  onConquer(ctx => { playGold(ctx, 2); }, { if: ctx => typeof ctx.event?.bf === 'number' && ctx.excessDamage() >= 3, text: 'When I conquer with 3+ excess damage, play two Gold.' }),
]);

card('unl-033-219', 'When you play me, play a 1 [S] Bird unit token with [Deflect] here.', [
  onPlay(ctx => { playUnitTokens(ctx, 'Bird', 1, { at: 'here' }); }, { text: 'Play a Bird here.' }),
]);

card('unl-041-219', "[Deflect]\nWhile I'm at a battlefield, your other units here have [Deflect].", [
  anthem(F.and(yourUnit, F.other, F.here), { keywords: ['Deflect'] }, { if: C.atBattlefield, text: 'Your other units here have Deflect.' }),
]);

card('unl-044-219', '[Reaction]\nChoose one —\n- Counter a spell.\n- Play four 1 [S] Bird unit tokens with [Deflect].', [
  spellModes([
    mode('counter', 'Counter a spell', E.counter(0), [T.chainItem((ctx, id) => ctx.g.chain.find(c => c.id === id)?.kind === 'spell', { prompt: 'Counter a spell', hint: 'harm' })]),
    mode('birds', 'Play four 1 [S] Bird unit tokens with [Deflect]', ctx => { playUnitTokens(ctx, 'Bird', 4); }),
  ]),
]);

card('unl-048-219', '[Shield]\nWhen I hold, play a ready 3 [S] Sprite unit token with [Temporary] here.', [
  onHold(ctx => { playUnitTokens(ctx, 'Sprite', 1, { at: 'here', ready: true }); }, { text: 'When I hold, play a ready Sprite here.' }),
]);

card('unl-058-219', 'When you play a token unit, give me +1 [S] this turn.\nYour token units have [Tank].', [
  whenYouPlay(F.and(F.token, F.unit), E.might('self', 1), { text: 'When you play a token unit, give me +1 this turn.' }),
  anthem(yourTokenUnit, { keywords: ['Tank'] }, { text: 'Your token units have Tank.' }),
]);

card('unl-069-219', 'Play two ready 3 [S] Sprite unit tokens with [Temporary].', [
  spell(ctx => { playUnitTokens(ctx, 'Sprite', 2, { ready: true }); }),
]);

const flourishGold = delayedAbility('unl-073-219:gold', when('die', (ev, ctx) => ev.obj === ctx.data.obj && (ctx.obj(ev.obj as ObjId)?.epoch ?? 0) === ctx.data.epoch, ctx => { playGold(ctx, 1); }, { text: 'Deadly Flourish: it died, play a Gold' }));
card('unl-073-219', 'Deal 3 to an enemy unit. When it dies this turn, play a Gold gear token exhausted.', [
  spell(ctx => {
    const t = ctx.target(0);
    if (!t) return;
    ctx.delay(flourishGold, { obj: t, epoch: ctx.obj(t).epoch ?? 0 }, 'endOfTurn', 1);
    ctx.deal(3, t);
  }, { targets: [T.unit(F.enemy, { hint: 'harm', prompt: 'Deal 3 to an enemy unit' })] }),
]);

card('unl-077-219', 'Your token units have +1 [S].', [
  anthem(yourTokenUnit, { might: 1 }, { text: 'Your token units have +1.' }),
]);

const fountainSprite = (ctx: Ctx) => { playUnitTokens(ctx, 'Sprite', 1, { at: 'base', ready: true }); };
card('unl-078-219', "[Temporary]\nWhen you play this, play a ready 3 [S] Sprite unit token with [Temporary] to your base.\n[Deathknell][>] Repeat this gear's play effect.", [
  onPlay(fountainSprite, { text: 'Play a ready Sprite to your base.' }),
  deathknell(fountainSprite, { text: "Deathknell — Repeat this gear's play effect." }),
]);

// CR 387-389 (as Deceiver, RJ#10484): "Then do this: They become copies of me" is a reflexive item — players may respond while
// the Reflections are still 0 Might; if Keeper left the board meanwhile they copy its last known card
const keeperCopies = reflexiveAbility('B3:keeperOfMasks:copy', {
  effect: ctx => {
    const of = copySource(ctx, 'me');
    if (!of) return;
    for (const r of still(ctx, 'toks')) ctx.becomeCopy(r, of, 'permanent');
  },
  text: 'Keeper of Masks: they become copies of me',
});
card('unl-081-219', '[Hidden]\n[Temporary]\nWhen you play me, play two Reflection unit tokens here. Then do this: They become copies of me.', [
  onPlay(ctx => {
    const refl = playUnitTokens(ctx, 'Reflection', 2, { at: 'here' }).filter(r => ctx.onBoard(r));
    if (!refl.length || !ctx.exists(ctx.self)) return;
    ctx.reflexive(keeperCopies, { toks: keepObjs(ctx, refl), me: keepObjs(ctx, [ctx.self]), meCard: ctx.cardIdOf(ctx.self) });
  }, { text: 'Play two Reflections here; then they become copies of me.' }),
]);

card('unl-082-219', '[Accelerate]\nWhen I move from a location, play a 3 [S] Sprite unit token with [Temporary] there.', [
  onMove(ctx => {
    const from = ctx.event?.from as Loc | undefined;
    playUnitTokens(ctx, 'Sprite', 1, { at: typeof from === 'number' ? from : 'base' });
  }, { text: 'When I move from a location, play a Sprite there.' }),
]);

card('unl-084-219', 'When you play me or at the start of your Beginning Phase, play a ready 3 [S] Sprite unit token with [Temporary] to your base.', [
  onPlay(fountainSprite, { text: 'Play a ready Sprite to your base.' }),
  atStartOfBeginning(fountainSprite, { text: 'At the start of your Beginning Phase, play a ready Sprite to your base.' }),
]);

card('unl-088-219', 'At the start of your Beginning Phase, if you have exactly 4 cards in hand and exactly 4 units at battlefields, you win the game.\nDiscard 1, [T]: Play a 1 [S] Bird unit token with [Deflect].', [
  atStartOfBeginning(ctx => ctx.winGame(ctx.controller, 'Gutter Palace'), {
    if: ctx => ctx.hand().length === 4 && ctx.units(u => mine(ctx, u) && ctx.atBattlefield(u)).length === 4,
    text: 'Exactly 4 cards in hand and 4 units at battlefields: you win the game.',
  }),
  activated(cost('[T]', pay.discard(1)), ctx => { playUnitTokens(ctx, 'Bird', 1); }, { text: 'Discard 1, [T]: Play a Bird.' }),
]);

card('unl-130-219', '[Deflect]\nWhen you play me, choose an opponent. They play a 1 [S] Bird unit token with [Deflect].', [
  onPlay(ctx => { const p = ctx.chooseOpponent(); playUnitTokens(ctx, 'Bird', 1, { player: p }); }, { text: 'Choose an opponent. They play a Bird.' }),
]);

card('unl-145-219', "[Hidden]\n[Backline]\nOnce each turn, when an enemy unit dies while I'm at a battlefield, play a Gold gear token exhausted.", [
  when('die', (ev, ctx) => typeof ev.obj === 'string' && ev.obj !== ctx.self && ctx.exists(ev.obj) && ctx.isUnit(ev.obj) && ctx.isEnemy(ev.obj) && ctx.atBattlefield(ctx.self),
    ctx => { playGold(ctx, 1); }, { oncePerTurn: 1, text: "Once each turn, when an enemy unit dies while I'm at a battlefield, play a Gold." }),
]);

card('unl-146-219', "While I'm in a showdown, your spells have [Repeat] [2][C].", [
  // engine play grant (B3-3): keywords/costs a card has while being played
  playRule((ctx, id) => ctx.isSpell(id) && !!ctx.g.showdown && ctx.loc(ctx.self) === ctx.g.showdown.battlefieldIndex,
    { grantKeywords: () => ['Repeat'], keywordCosts: { Repeat: cost('[2][C]') }, text: "While I'm in a showdown, your spells have [Repeat] [2][C]." }),
]);

card('unl-147-219', "As you play me, add the Baron Pit battlefield token to the board if it's not there already. If you do, I enter there.\nI can't be chosen by enemy spells and abilities.\nOther friendly units have +2 [S].", [
  // B3-4: an asPlay effect may set the destination (ctx.data.__destination) — "If you do, I enter there"
  asPlay(ctx => { const i = ctx.addBattlefield('Baron Pit'); if (i !== null) { ctx.data.baronPit = i; ctx.data.__destination = i; } }, { text: 'Add the Baron Pit battlefield token. If you do, I enter there.' }),
  statik('self', { cantBeChosenByEnemy: true }, { text: "I can't be chosen by enemy spells and abilities." }),
  anthem(F.and(F.unit, F.friendly, F.other), { might: 2 }, { text: 'Other friendly units have +2.' }),
]);

card('unl-153-219', '[Deathknell][>] Play a 1 [S] Bird unit token with [Deflect] to your base.', [
  deathknell(ctx => { playUnitTokens(ctx, 'Bird', 1, { at: 'base' }); }, { text: 'Deathknell — Play a Bird to your base.' }),
]);

card('unl-156-219', "[Deathknell][>] If I didn't die alone, draw 1.", [
  deathknell(ctx => { const l = ctx.event?.lki as { alone?: boolean } | undefined; if (l && !l.alone) ctx.draw(1); }, { text: "Deathknell — If I didn't die alone, draw 1." }),
]);

card('unl-160-219', "[T]: Play two 1 [S] Bird unit tokens with [Deflect]. Use this ability only while I'm at a battlefield.", [
  activated('[T]', ctx => { playUnitTokens(ctx, 'Bird', 2); }, { if: C.atBattlefield, text: '[T]: Play two Birds (only while at a battlefield).' }),
]);

card('unl-185-219', "[1], [T]: Return a friendly unit at a battlefield to its owner's hand. Play a Gold gear token exhausted.", [
  activated('[1], [T]', ctx => { const t = ctx.target(0); if (t) ctx.returnToHand(t); playGold(ctx, 1); }, {
    targets: [T.unit(F.friendly, F.atBattlefield, { hint: 'help', prompt: "Return a friendly unit at a battlefield to its owner's hand" })],
    text: "[1], [T]: Return a friendly unit at a battlefield to its owner's hand. Play a Gold.",
  }),
]);

card('unl-189-219', '[4], [T]: Play a ready 3 [S] Sprite unit token with [Temporary]. This ability costs [1] less for each friendly unit with [Temporary].', [
  activated('[4], [T]', ctx => { playUnitTokens(ctx, 'Sprite', 1, { ready: true }); }, { text: '[4], [T]: Play a ready Sprite.' }),
  costModDyn((ctx, id) => (id === ctx.self ? { energy: -ctx.units(u => ctx.isFriendly(u) && ctx.has(u, 'Temporary')).length, power: 0 } : null), { scope: 'ability' }),
]);

const mirrorImageCopy = reflexiveAbility('B3:mirrorImage:copy', {
  effect: ctx => {
    // "It" = every token the (replacement-modified) play produced: Zilean, Time Mage's additional copy too (as Deceiver,
    // DECISIONS #9917; RJ#11565, ENGINE-9)
    const rs = still(ctx, 'tok');
    if (!rs.length) return;
    const of = copySource(ctx, 'of');
    for (const r of rs) {
      if (of) ctx.becomeCopy(r, of, 'permanent');
      ctx.giveKeyword(r, 'Temporary', 'permanent');
    }
  },
  text: 'Mirror Image: it becomes a copy of that unit; give it [Temporary]',
});
card('unl-200-219', 'Choose a unit. Play a ready Reflection unit token to your base. Then do this: It becomes a copy of that unit. Give it [Temporary].', [
  spell(ctx => {
    const t = ctx.target(0);
    const rs = playUnitTokens(ctx, 'Reflection', 1, { at: 'base', ready: true }).filter(r => ctx.onBoard(r));
    if (!rs.length) return;
    // CR 387-389: the copy + [Temporary] part is a reflexive item (opponents may respond first); an illegal target on resolution
    // copies nothing (CR 359.3.e), a unit that left the board afterwards is copied as last known
    ctx.reflexive(mirrorImageCopy, { tok: keepObjs(ctx, rs), of: t ? keepObjs(ctx, [t]) : [], ofCard: t ? ctx.cardIdOf(t) : undefined });
  }, { targets: [T.unit({ prompt: 'Choose a unit to copy', hint: 'neutral' })] }),
]);

card('unl-204-219', '[Action]\nChoose an enemy unit at a battlefield. Its owner places it on the top or bottom of their Main Deck.', [
  spell(ctx => {
    const t = ctx.target(0);
    if (!t) return;
    const owner = ctx.as(ctx.owner(t));
    const where = owner.chooseMode([{ id: 'top', label: 'Top of your Main Deck' }, { id: 'bottom', label: 'Bottom of your Main Deck' }], `Place ${ctx.name(t)} on the top or bottom of your Main Deck`);
    ctx.toDeck(t, where === 'bottom' ? 'bottom' : 'top');
  }, { targets: [T.unit(F.enemy, F.atBattlefield, { hint: 'harm', prompt: 'Choose an enemy unit at a battlefield' })] }),
]);

card('unl-210-219', 'While a unit here is defending alone, it has -2 [S].', [
  anthem((ctx, id) => ctx.isUnit(id) && ctx.loc(id) === ctx.bfIndex() && ctx.isDefending(id) && isAlone(ctx, id), { might: -2 }, { text: 'A unit defending alone here has -2.' }),
]);

card('unl-217-219', 'When you conquer here, if you assigned 3 or more excess damage, play a 1 [S] Bird unit token with [Deflect].', [
  when('conquer', (ev, ctx) => atThisBf(ev, ctx) && ctx.excessDamage(ev.player as PlayerId) >= 3, ctx => { playUnitTokens(ctx, 'Bird', 1, { player: scorer(ctx) }); }, { text: 'When you conquer here with 3+ excess damage, play a Bird.' }),
]);

// =============================================================================================
// Vendetta
// =============================================================================================

card('ven-023-166', 'You may discard 1 as an additional cost to play me.\nWhen you play me, if you paid the additional cost, play a 0 [S] Shadow Clone unit token.', [
  // play triggers see the play's choices on the event (ev.playData), not in ctx.data
  onPlay(ctx => { playUnitTokens(ctx, 'Shadow Clone', 1); }, { if: ctx => C.paidAdditional(ctx) || !!(ctx.event?.playData as { paidAdditional?: boolean } | undefined)?.paidAdditional, text: 'If you paid the additional cost, play a Shadow Clone.' }),
], { additionalCosts: [{ cost: cost('', pay.discard(1)), optional: true, label: 'Discard 1 as an additional cost' }] });

card('ven-051-166', 'Play a 3 [S] Mech unit token.\n[Flow] [2][C]', [
  spell(ctx => { playUnitTokens(ctx, 'Mech', 1); }),
]);

// RULINGS: CR 355.5 / 403.2 — "something besides me that's exhausted" is a specific object, so it is a target chosen as the
// trigger goes on the chain ("you may" = up to one; choosing nothing declines). Any exhausted unit, gear, rune or legend.
const jayceReady = (ctx: Ctx) => { const t = ctx.target(0); if (t && ctx.isExhausted(t)) ctx.ready(t); };
const jayceTarget = () => [T.upTo(1, T.card({ zones: ['board', 'runes', 'legends'], hint: 'help', prompt: "You may ready something besides Jayce that's exhausted" },
  (cx: Ctx, id: ObjId) => exhaustedThings(cx, [cx.self]).includes(id)))];
card('ven-068-166', "When you play me or the first time you play a non-token gear each turn, you may ready something besides me that's exhausted.", [
  onPlay(jayceReady, { targets: jayceTarget(), text: "You may ready something that's exhausted." }),
  // RJ#6045c (principle 23): the first non-token gear play completed this turn (engine completedGearIndex)
  whenYouPlay((ctx, id) => isRealGear(ctx, id) && !ctx.isToken(id) && ctx.event?.completedGearIndex === 1,
    jayceReady, { targets: jayceTarget(), text: "First non-token gear each turn: you may ready something that's exhausted." }),
]);

card('ven-087-166', '[Empower] — [T]\nDisempower this, [1], [T]: Play a 3 [S] Mech unit token to your base.', [
  activated(cost('[1], [T]', pay.disempowerSelf()), ctx => { playUnitTokens(ctx, 'Mech', 1, { at: 'base' }); }, { text: 'Disempower this, [1], [T]: Play a Mech to your base.' }),
]);

card('ven-100-166', 'Play two 1 [S] Tentacle unit tokens from Bilgewater.\n[Flow] [3]', [
  spell(ctx => { playUnitTokens(ctx, 'Tentacle', 2); }),
]);

const illaoiTentacle = (ctx: Ctx) => { playUnitTokens(ctx, 'Tentacle', 1); };
card('ven-109-166', 'When you play me or when I score, play a 1 [S] Tentacle unit token from Bilgewater.\nI have +1 [S] for each token unit you control.', [
  onPlay(illaoiTentacle, { text: 'Play a Tentacle.' }),
  // "when I score": when you conquer or hold a battlefield I'm at
  when(['conquer', 'hold'], (ev, ctx) => ev.player === ctx.controller && ((ev.units as ObjId[] | undefined) ?? []).includes(ctx.self), illaoiTentacle, { text: 'When I score, play a Tentacle.' }),
  selfMight(ctx => ctx.units(u => mine(ctx, u) && ctx.isToken(u)).length, { text: '+1 for each token unit you control' }),
]);

card('ven-112-166', "When I conquer, play a 0 [S] Shadow Clone unit token to your base.\n[Action][>] [1][C]: Move me and a Shadow Clone you control to each other's locations.", [
  onConquer(ctx => { playUnitTokens(ctx, 'Shadow Clone', 1, { at: 'base' }); }, { text: 'When I conquer, play a Shadow Clone to your base.' }),
  activated('[1][C]', ctx => { const c = ctx.target(0); if (c && ctx.onBoard(ctx.self)) ctx.swapLocations(ctx.self, c); }, {
    timing: 'action',
    targets: [T.unit((ctx, id) => mine(ctx, id) && isTokenNamed(ctx, id, 'Shadow Clone'), { hint: 'help', prompt: 'Choose a Shadow Clone you control' })],
    text: "[1][C]: Move me and a Shadow Clone you control to each other's locations.",
  }),
]);

card('ven-126-166', '[Reaction]\nChoose a unit. Prevent the next 7 damage that would be dealt to it this turn.', [
  spell(ctx => { const t = ctx.target(0); if (t) ctx.prevent(t, 7, 'endOfTurn'); }, { targets: [T.unit({ hint: 'help', prompt: 'Prevent the next 7 damage to a unit' })] }),
]);

card('ven-128-166', '[Empower] [1][C]\n[Empowered][>][>>][Deathknell][>] Play two 1 [S] Recruit unit tokens to your base.', [
  deathknell(ctx => { playUnitTokens(ctx, 'Recruit', 2, { at: 'base' }); }, { requires: [dep.empowered()], text: 'Empowered + Deathknell — Play two Recruits to your base.' }),
]);

card('ven-129-166', "I don't deal combat damage unless I'm at a battlefield with exactly one other unit you control.", [
  rule('noCombatDamage', (ctx, unit: ObjId) => unit === ctx.self && !(ctx.atBattlefield(ctx.self) && unitsOfAt(ctx, ctx.loc(ctx.self)!).filter(u => u !== ctx.self).length === 1), undefined, { text: "I don't deal combat damage unless exactly one other unit you control is with me at a battlefield." }),
]);


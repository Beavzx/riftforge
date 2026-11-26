// Batch B6 card scripts (pump / ready / buff). Owned by scripting agent B6.
// Helpers: src/cards/helpers/B6.ts. Tests: tests/cards/B6/*.test.ts.
import {
  card, spell, spellModes, mode, onPlay, onConquer, onHold, onMove, onCombatRole, deathknell, when, whenYouPlay,
  whenUnitDies, atEndOfTurn, atStartOfBeginning, activated, statik, anthem, rule, asPlay, showOff, selfCostDyn,
  grantable, delayedAbility, reflexiveAbility, E, T, F, C, R, cost, pay, dep,
} from '../dsl.ts';
import type { Ctx, ObjId, GameEvent } from '../dsl.ts';
import { intrinsicKeywords } from '../../engine/chars.ts';
import { makeCtx } from '../../engine/context.ts';
import { getScript } from '../registry.ts';
import {
  buffsOn, myBuffed, myUnits, myBuffCount, spendAnyNumberOfBuffs,
  readyRunesUpTo, bfIndexOf, keywordStrings, playData, paidAdditional, chosenSoFar, chosenBattlefield,
  chosenUnit, firstOfBatch, batchCount, tracker, cantMoveThisTurn, EXTRA_BUFF_MIGHT,
} from '../helpers/B6.ts';

// ---------------------------------------------------------------- small local helpers
const t0 = (ctx: Ctx) => ctx.target(0);
const self = (ctx: Ctx) => ctx.self;
const evObj = (ctx: Ctx) => ctx.event?.obj as ObjId | undefined;
/** Give the first target of group i +n this turn */
const pump = (n: number, i = 0) => E.might(i, n);
/** a unit you control (CR "your units" / "units you control") */
const mine = ((c: Ctx, id: ObjId) => c.ctrl(id) === c.controller) as (c: Ctx, id: ObjId) => boolean;
const UNIT = (o: Record<string, unknown> = {}) => T.unit({ hint: 'help', ...o });
const ENEMY = (o: Record<string, unknown> = {}) => T.unit(F.enemy, { hint: 'harm', ...o });
const fewerRunesThanAnOpponent = (ctx: Ctx) => ctx.opponents().some(p => ctx.runes(ctx.controller).length < ctx.runes(p).length);
const unitOf = (ctx: Ctx, id: unknown): id is ObjId => typeof id === 'string' && ctx.exists(id) && ctx.isUnit(id);
/** RULINGS: "ready up to N (friendly) runes" — runes are targets (CR 355.5 / 403.2; Origins FAQ on Sona, Harmonious) */
const runeTargets = (n: number, friendly = false, cond?: (ctx: Ctx) => boolean) =>
  T.upTo(n, T.rune((cx: Ctx, id: ObjId) => (!friendly || cx.ctrl(id) === cx.controller) && (!cond || cond(cx)), { hint: 'help', prompt: `Ready up to ${n} ${friendly ? 'friendly ' : ''}rune${n > 1 ? 's' : ''}` }));

// ================================================================= OGN

card('ogn-004-298', "[Action]\nGive a unit [Assault 3] this turn.", [
  spell(E.keyword(0, 'Assault 3'), { targets: [UNIT({ prompt: 'Give a unit [Assault 3] this turn' })] }),
]);

card('ogn-016-298', "[Legion] — When you play me, give a unit +2 [S] this turn.", [
  onPlay(pump(2), { requires: [dep.legion()], targets: [UNIT({ prompt: 'Give a unit +2 Might this turn' })], text: 'Legion — When you play me, give a unit +2 [S] this turn.' }),
]);

card('ogn-027-298', "When you play your second card in a turn, give me +2 [S] this turn and ready me.", [
  // "second card" = second completed play this turn (RJ#6045 adopted: a nested Reaction resolving first is the second card)
  when('play', (ev, ctx) => ev.player === ctx.controller && typeof ev.obj === 'string' && ev.completedIndex === 2,
    E.seq(E.might('self', 2), E.ready('self')), { text: 'When you play your second card in a turn, give me +2 [S] this turn and ready me.' }),
]);

card('ogn-036-298', "[Ganking]\nRecycle 1 from your trash: Give me +1 [S] this turn.", [
  activated(cost('', pay.recycleFromTrash(1)), E.might('self', 1), { text: 'Recycle 1 from your trash: Give me +1 [S] this turn.' }),
]);

card('ogn-046-298', "[Reaction]\nGive a friendly unit +1 [S] this turn, then an additional +1 [S] this turn if it is the only unit you control there.", [
  spell(ctx => {
    const t = t0(ctx); if (!t) return;
    ctx.giveMight(t, 1);
    const l = ctx.loc(t);
    if (l !== null && ctx.unitsAt(l, u => ctx.ctrl(u) === ctx.controller).length === 1) ctx.giveMight(t, 1);
  }, { targets: [T.unit(F.friendly, { hint: 'help', prompt: 'Give a friendly unit +1 Might this turn' })] }),
]);

card('ogn-053-298', "[Hidden]\n[Action]\nBuff a friendly unit. Buffs give an additional +1 [S] to friendly units this turn.", [
  spell(ctx => {
    ctx.buff(t0(ctx));
    const leg = ctx.legend(ctx.controller);
    if (leg && ctx.exists(leg)) ctx.grant(leg, EXTRA_BUFF_MIGHT, 'endOfTurn');
  }, { targets: [T.unit(F.friendly, { hint: 'help', prompt: 'Buff a friendly unit' })] }),
]);

card('ogn-058-298', "[Reaction]\nGive a unit +2 [S] this turn. Draw 1.", [
  spell(E.seq(pump(2), E.draw(1)), { targets: [UNIT({ prompt: 'Give a unit +2 Might this turn' })] }),
]);

card('ogn-059-298', "When you stun an enemy unit, ready me and give me +1 [S] this turn.", [
  when('stun', (ev, ctx) => ev.player === ctx.controller && typeof ev.obj === 'string' && ctx.isEnemy(ev.obj),
    E.seq(E.ready('self'), E.might('self', 1)), { text: 'When you stun an enemy unit, ready me and give me +1 [S] this turn.' }),
]);

card('ogn-061-298', "When you play me, if you control a Poro, buff me and draw 1.", [
  onPlay(ctx => { ctx.buff(ctx.self); ctx.draw(1); }, { if: C.controls(F.tag('Poro')), text: 'When you play me, if you control a Poro, buff me and draw 1.' }),
]);

// Spirit's Refuge "if they didn't already": Deflect printed on the unit or from its own (conditional) static — Fiora, Victorious
// "While I'm [Mighty], I have [Deflect]" (dependent effect applies after the one it depends on; RJ#2332, as RJ#3971)
function hasOwnDeflect(ctx: Ctx, id: ObjId): boolean {
  const cid = ctx.cardIdOf(id);
  const d = ctx.g.cards[cid];
  if (d && intrinsicKeywords(d).some(k => k.startsWith('Deflect'))) return true;
  const own = makeCtx(ctx.g, id, ctx.ctrl(id));
  return (getScript(cid)?.abilities ?? []).some(ab => ab.kind === 'static' && ab.affects === 'self' && typeof ab.mods === 'object'
    && (ab.mods.keywords ?? []).some(k => k.startsWith('Deflect')) && (!ab.condition || ab.condition(own)));
}
card('ogn-063-298', "When you play this, buff a friendly unit.\nFriendly buffed units have [Deflect] if they didn't already.", [
  onPlay(ctx => { ctx.buff(t0(ctx)); }, { targets: [T.unit(F.friendly, { hint: 'help', prompt: 'Buff a friendly unit' })], text: 'When you play this, buff a friendly unit.' }),
  // RJ#3971: "if they didn't already" — no Deflect from this if the unit has it printed, and several Spirit's Refuge of one player
  // grant it once (only the first one applies). (ctx.has can't see the unit's other statics from inside a static.)
  anthem(F.and(F.unit, F.friendly, F.buffed), (ctx, id) => {
    if (hasOwnDeflect(ctx, id)) return {};
    const first = ctx.gear(x => ctx.obj(x)?.cardId === 'ogn-063-298' && ctx.ctrl(x) === ctx.controller).sort()[0];
    return first === undefined || first === ctx.self ? { keywords: ['Deflect'] } : {};
  }, { text: "Friendly buffed units have [Deflect] if they didn't already." }),
]);

card('ogn-069-298', "[Action]\nDouble a friendly unit's Might this turn. Give it [Temporary].", [
  spell(ctx => { const t = t0(ctx); if (!t) return; ctx.doubleMight(t); ctx.giveKeyword(t, 'Temporary', 'permanent'); },
    { targets: [T.unit(F.friendly, { hint: 'help', prompt: "Double a friendly unit's Might this turn" })] }),
]);

card('ogn-073-298', "At the end of your turn, if I'm at a battlefield, ready up to 4 friendly runes.", [
  // RULINGS: Origins FAQ (Sona, Harmonious) / CR 403.2 — the runes are targets chosen as the trigger goes on the chain
  atEndOfTurn(ctx => { ctx.ready(ctx.targetsOf(0)); }, { if: C.atBattlefield, targets: [runeTargets(4, true)], text: "At the end of your turn, if I'm at a battlefield, ready up to 4 friendly runes." }),
]);

card('ogn-078-298', "[Shield]\n[T]: Buff me.\nI can have any number of buffs.", [
  activated('[T]', ctx => { ctx.buff(ctx.self); }, { text: '[T]: Buff me.' }),
  rule('multipleBuffs', (ctx, id: ObjId) => id === ctx.self, undefined, { text: 'I can have any number of buffs.' }),   // engine rule (CR 426.2)
]);

card('ogn-082-298', "When you play me, give a unit +8 [S] this turn.", [
  onPlay(pump(8), { targets: [UNIT({ prompt: 'Give a unit +8 Might this turn' })], text: 'When you play me, give a unit +8 [S] this turn.' }),
]);

card('ogn-091-298', "When you play a gear, ready me.", [
  whenYouPlay(F.gear, E.ready('self'), { text: 'When you play a gear, ready me.' }),
]);

card('ogn-093-298', "[Reaction]\nGive a unit -4 [S] this turn, to a minimum of 1 [S].", [
  spell(E.mightMin(0, 4, 1), { targets: [T.unit({ hint: 'harm', prompt: 'Give a unit -4 Might this turn (minimum 1)' })] }),
]);

card('ogn-095-298', "[Reaction]\nGive a unit -1 [S] this turn, to a minimum of 1 [S]. Draw 1.", [
  spell(E.seq(E.mightMin(0, 1, 1), E.draw(1)), { targets: [T.unit({ hint: 'harm', prompt: 'Give a unit -1 Might this turn (minimum 1)' })] }),
]);

card('ogn-097-298', "[Hidden]\nWhen you play me, give a unit -2 [S] this turn, to a minimum of 1 [S].", [
  onPlay(E.mightMin(0, 2, 1), { targets: [T.unit({ hint: 'harm', prompt: 'Give a unit -2 Might this turn (minimum 1)' })], text: 'When you play me, give a unit -2 [S] this turn, to a minimum of 1 [S].' }),
]);

card('ogn-103-298', "When you play a spell, give me +1 [S] this turn.", [
  whenYouPlay(F.spell, E.might('self', 1), { text: 'When you play a spell, give me +1 [S] this turn.' }),
]);

card('ogn-108-298', "[Reaction]\nChoose a friendly unit. This turn, increase its Might to the Might of another friendly unit.", [
  spell(ctx => {
    const t = ctx.target(0), o = ctx.target(1);
    if (!t || !o || t === o) return;
    const d = ctx.might(o) - ctx.might(t);
    if (d > 0) ctx.giveMight(t, d);
  }, {
    targets: [
      T.unit(F.friendly, { hint: 'help', prompt: 'Choose a friendly unit' }),
      // RULINGS: CR 355.5 — "another friendly unit" is a specific object chosen as the spell is played, so it is a target
      T.unit(F.friendly, (c, id) => !chosenSoFar(c).includes(id), { prompt: 'Increase its Might to the Might of which other friendly unit?' }),
    ],
  }),
]);

card('ogn-110-298', "[Accelerate]\n[Deathknell] — Recycle me to ready your runes.", [
  // RULINGS: Unleashed Rules FAQ (Ekko, Recurrent) / CR 383.3.b — "Recycle me" is the trigger's base cost, paid as it goes on
  // the chain; declining (or being unable) to pay removes it. Only the readying happens on resolution.
  deathknell(ctx => { ctx.ready(ctx.runes()); }, {
    optional: 'Ekko: recycle him from your trash to ready your runes?',
    cost: cost('', { label: 'Recycle Ekko from your trash', canPay: (cx: Ctx) => cx.exists(cx.self) && cx.obj(cx.self).zone === 'trash', pay: (cx: Ctx) => cx.recycle(cx.self).length === 1 }),
    text: 'Deathknell — Recycle me to ready your runes.',
  }),
]);

card('ogn-116-298', "[Accelerate]\nWhen you play me, give enemy units -3 [S] this turn, to a minimum of 1 [S].", [
  onPlay(E.mightMin(R.all(F.enemy), 3, 1), { text: 'When you play me, give enemy units -3 [S] this turn, to a minimum of 1 [S].' }),
]);

card('ogn-132-298', "When you play me, ready another unit.", [
  onPlay(E.ready(0), { targets: [T.unit(F.other, { hint: 'help', prompt: 'Ready another unit' })], text: 'When you play me, ready another unit.' }),
]);

card('ogn-136-298', "When you play me, buff another friendly unit.", [
  onPlay(ctx => { ctx.buff(t0(ctx)); }, { targets: [T.unit(F.friendly, F.other, { hint: 'help', prompt: 'Buff another friendly unit' })], text: 'When you play me, buff another friendly unit.' }),
]);

card('ogn-139-298', "When you play another unit, buff me.", [
  whenYouPlay(F.unit, ctx => { ctx.buff(ctx.self); }, { text: 'When you play another unit, buff me.' }),
]);

card('ogn-141-298', "When you play me, buff up to two other friendly units.", [
  onPlay(ctx => { for (const u of ctx.targetsOf(0)) ctx.buff(u); }, { targets: [T.upTo(2, T.unit(F.friendly, F.other, { hint: 'help', prompt: 'Buff up to two other friendly units' }))], text: 'When you play me, buff up to two other friendly units.' }),
]);

card('ogn-143-298', "When you ready a friendly unit, give it +1 [S] this turn.", [
  // RULINGS: CR 315.1.b / 416.3.a — the turn player readies their objects in the Awaken phase, so they are responsible for it
  // (CR 412.1, 412.4) and "when you ready" sees it. The engine emits awaken readies with player null (docs/dsl-requests.md).
  when('ready', (ev, ctx) => (ev.player === ctx.controller || (ev.player === null && ctx.g.phase === 'awaken' && ctx.g.activePlayer === ctx.controller))
      && unitOf(ctx, ev.obj) && ctx.isFriendly(ev.obj as ObjId),
    E.might(R.eventObj, 1), { text: 'When you ready a friendly unit, give it +1 [S] this turn.' }),
]);

// engine optional additional cost (B1-2 discount): "you may spend a buff as an additional cost. If you do, ignore this spell's cost"
const IGNORE_COST_FOR_BUFF = { cost: cost('', pay.spendBuff('friendly')), optional: true, beforeTargets: true, key: 'spentBuffForCost',
  discount: { energy: -999, power: -999 }, label: "Spend a buff as an additional cost to ignore this spell's cost" };
card('ogn-146-298', "[Action]\nAs you play this, you may spend a buff as an additional cost. If you do, ignore this spell's cost.\nReady a unit.", [
  spell(E.ready(0), { targets: [UNIT({ prompt: 'Ready a unit' })] }),
], { additionalCosts: [IGNORE_COST_FOR_BUFF] });

card('ogn-147-298', "When you play me, you may spend a buff to buff me and ready me.", [
  // RULINGS sweep / CR 383.3.b: spending the buff is the trigger's base cost, paid as it goes on the chain
  onPlay(ctx => { ctx.buff(ctx.self); ctx.ready(ctx.self); }, {
    optional: 'Spend a buff to buff Wildclaw Shaman and ready it?',
    cost: cost('', pay.custom('Spend a buff', c => myBuffed(c).length > 0, c => {
      const u = c.chooseCards(myBuffed(c), 1, 1, 'Spend a buff from')[0];
      return !!u && c.spendBuff(u);
    })),
    text: 'When you play me, you may spend a buff to buff me and ready me.',
  }),
]);

const krakenKey = (ctx: Ctx) => `B6:krakenBuffs:${ctx.self}#${ctx.obj(ctx.self)?.epoch ?? 0}`;
card('ogn-150-298', "[Accelerate]\n[Assault]\nAs you play me, you may spend any number of buffs as an additional cost. Reduce my cost by [C] for each buff you spend.", [
  asPlay(ctx => {
    const have = myBuffCount(ctx);
    if (!have) return;
    const n = ctx.chooseNumber(0, have, 'Spend how many buffs to reduce Kraken Hunter\'s cost by [C] each?');
    if (!n) return;
    const spent = spendAnyNumberOfBuffs(ctx, `Spend ${n} buff${n > 1 ? 's' : ''} from which units?`, n);
    ctx.data.buffsSpentForCost = spent;
    if (ctx.item) ctx.item.choices.b6KrakenBuffs = spent;
    ctx.g.ex.turnFacts[krakenKey(ctx)] = spent;
  }, { text: 'As you play me, you may spend any number of buffs as an additional cost.' }),
  selfCostDyn(ctx => {
    const n = ctx.item ? Number(ctx.item.choices.b6KrakenBuffs ?? 0) : Math.min(myBuffCount(ctx), ctx.powerCost(ctx.self));
    return n ? { power: -n } : {};
  }),
  // RJ#5340 / CR 356: the discount applies to the total cost — buffs beyond the printed [C] reduce the Accelerate [C] too.
  // (the Accelerate cost's modifiers are computed without the chain item, so the count is passed in a turn fact)
  selfCostDyn(ctx => {
    const excess = Number(ctx.g.ex.turnFacts[krakenKey(ctx)] ?? 0) - ctx.powerCost(ctx.self);
    return excess > 0 ? { power: -excess } : {};
  }, { scope: 'additional' } as never),
]);

card('ogn-152-298', "When you buff a friendly unit, you may pay [C] and exhaust this to ready it.", [
  when('buff', (ev, ctx) => ev.player === ctx.controller && unitOf(ctx, ev.obj) && ctx.isFriendly(ev.obj as ObjId), ctx => {
    const u = evObj(ctx);
    if (u && ctx.onBoard(u)) ctx.ready(u);
  }, {
    // principle 11 (CR 383.3.a-b): the leading "may pay" is decided and paid as the trigger is chained (ENGINE-6, as RJ#12403)
    optional: 'Mistfall: pay [C] and exhaust Mistfall to ready the buffed unit?', cost: { ...cost('[C]'), exhaustSelf: true },
    offerIf: ctx => { const u = evObj(ctx); return !!u && ctx.onBoard(u); },
    text: 'When you buff a friendly unit, you may pay [C] and exhaust this to ready it.',
  }),
]);

card('ogn-153-298', "[Action]\nFor each friendly unit, you may spend its buff to ready it. Then buff all friendly units.", [
  spell(ctx => {
    const cands = myBuffed(ctx);
    const picked = ctx.chooseCards(cands, 0, cands.length, 'Spend the buff of which units to ready them?');
    for (const u of picked) if (ctx.spendBuff(u)) ctx.ready(u);
    for (const u of ctx.friendlyUnits()) ctx.buff(u);
  }),
]);

card('ogn-154-298', "[Action]\nGive a unit +7 [S] this turn.", [
  spell(pump(7), { targets: [UNIT({ prompt: 'Give a unit +7 Might this turn' })] }),
]);

const udyrKey = (m: string) => `udyr:${m}`;
card('ogn-157-298', "Spend my buff: Choose one you've not chosen this turn —\n* Deal 2 to a unit at a battlefield.\n* Stun a unit at a battlefield.\n* Ready me.\n* Give me [Ganking] this turn.", [
  activated(cost('', pay.custom('Spend my buff', ctx => ctx.isBuffed(ctx.self), ctx => {
    if (!ctx.spendBuff(ctx.self)) return false;
    if (ctx.item?.mode) ctx.remember(udyrKey(ctx.item.mode));
    return true;
  })), E.noop, {
    text: "Spend my buff: Choose one you've not chosen this turn.",
    modes: [
      mode('deal', 'Deal 2 to a unit at a battlefield', E.deal(2, 0), [T.unit(F.atBattlefield, { hint: 'harm', prompt: 'Deal 2 to a unit at a battlefield' })], ctx => !ctx.remembered(udyrKey('deal'))),
      mode('stun', 'Stun a unit at a battlefield', E.stun(0), [T.unit(F.atBattlefield, { hint: 'harm', prompt: 'Stun a unit at a battlefield' })], ctx => !ctx.remembered(udyrKey('stun'))),
      mode('ready', 'Ready me', E.ready('self'), undefined, ctx => !ctx.remembered(udyrKey('ready'))),
      mode('gank', 'Give me [Ganking] this turn', E.keyword('self', 'Ganking'), undefined, ctx => !ctx.remembered(udyrKey('gank'))),
    ],
  }),
]);

card('ogn-164-298', "When you play me or when I conquer, buff me.\nSpend my buff: Give me +4 [S] this turn.", [
  onPlay(ctx => { ctx.buff(ctx.self); }, { text: "When I'm played, buff me." }),
  onConquer(ctx => { ctx.buff(ctx.self); }, { text: 'When I conquer, buff me.' }),
  activated(cost('', pay.spendBuff('self')), E.might('self', 4), { text: 'Spend my buff: Give me +4 [S] this turn.' }),
]);

card('ogn-167-298', "When you play a card from [Hidden], give me +2 [S] this turn.", [
  when('play', (ev, ctx) => ev.player === ctx.controller && !!ev.fromHidden, E.might('self', 2), { text: 'When you play a card from [Hidden], give me +2 [S] this turn.' }),
]);

card('ogn-173-298', "[Action]\nMove a friendly unit and ready it.", [
  // R-2 (CR 355.4, RJ#6669): the destination is chosen as the spell is played
  spell(ctx => { const t = t0(ctx); if (!t) return; E.moveToChosen(0, 1)(ctx); if (ctx.onBoard(t)) ctx.ready(t); },
    { targets: [T.unit(F.friendly, { hint: 'help', prompt: 'Move a friendly unit and ready it' }), T.destination(F.moveDestFor(0), { prompt: 'Move it to' })] }),
]);

card('ogn-180-298', "Give a unit at a battlefield or a gear [Temporary].", [
  spell(E.keyword(0, 'Temporary', 'permanent'), { targets: [T.permanent(F.or(F.and(F.unit, F.atBattlefield), F.gear), { hint: 'harm', prompt: 'Give a unit at a battlefield or a gear [Temporary]' })] }),
]);

card('ogn-197-298', "[Hidden]\nWhen you play me, give me +3 [S] this turn.", [
  onPlay(E.might('self', 3), { text: 'When you play me, give me +3 [S] this turn.' }),
]);

card('ogn-202-298', "When you discard one or more cards, ready me and give me +1 [S] this turn.", [
  when('discard', (ev, ctx) => ev.player === ctx.controller && firstOfBatch(ctx, ev, e => e.type === 'discard', e => e.player === ev.player),
    E.seq(E.ready('self'), E.might('self', 1)), { text: 'When you discard one or more cards, ready me and give me +1 [S] this turn.' }),
]);

card('ogn-206-298', "[Reaction]\nGive two friendly units each +2 [S] this turn.", [
  spell(E.might(0, 2), { targets: [T.exactly(2, T.unit(F.friendly, { hint: 'help', prompt: 'Give two friendly units each +2 Might this turn' }))] }),
]);

card('ogn-207-298', "[Reaction]\nAs you play this, you may spend a buff as an additional cost. If you do, ignore this spell's cost.\nGive a unit +3 [S] this turn.", [
  spell(pump(3), { targets: [UNIT({ prompt: 'Give a unit +3 Might this turn' })] }),
], { additionalCosts: [IGNORE_COST_FOR_BUFF] });

card('ogn-217-298', "[Legion] — When you play me, buff me.", [
  onPlay(ctx => { ctx.buff(ctx.self); }, { requires: [dep.legion()], text: 'Legion — When you play me, buff me.' }),
]);

card('ogn-223-298', "When you play me, buff me. Then, if I am at a battlefield, buff all other friendly units there.", [
  onPlay(ctx => {
    ctx.buff(ctx.self);
    const l = ctx.loc(ctx.self);
    if (typeof l === 'number') for (const u of ctx.unitsAt(l, u => u !== ctx.self && ctx.isFriendly(u))) ctx.buff(u);
  }, { text: 'When you play me, buff me. Then, if I am at a battlefield, buff all other friendly units there.' }),
]);

card('ogn-228-298', "When a buffed friendly unit dies, buff another friendly unit.", [
  whenUnitDies(F.and(F.friendly, F.buffed), ctx => { ctx.buff(t0(ctx)); }, {
    targets: [T.unit(F.friendly, (c, id) => id !== c.event?.obj, { hint: 'help', prompt: 'Buff another friendly unit' })],
    text: 'When a buffed friendly unit dies, buff another friendly unit.',
  }),
]);

card('ogn-230-298', "When you play me, spend any number of buffs. For each buff spent, channel 1 rune exhausted.", [
  onPlay(ctx => { const n = spendAnyNumberOfBuffs(ctx, 'Spend buffs from which units? (channel 1 rune exhausted each)'); if (n) ctx.channel(n, true); },
    { text: 'When you play me, spend any number of buffs. For each buff spent, channel 1 rune exhausted.' }),
]);

card('ogn-233-298', "[Action]\nGive friendly units +5 [S] this turn.", [
  spell(E.might(R.all(F.friendly), 5)),
]);

card('ogn-235-298', "[Vision]\nWhen you recycle one or more cards to your Main Deck, buff a friendly unit.", [
  when('recycle', (ev, ctx) => ((ev.objs as ObjId[] | undefined) ?? []).some(id => ctx.exists(id) && ctx.owner(id) === ctx.controller && ctx.obj(id).zone === 'mainDeck'),
    ctx => { ctx.buff(t0(ctx)); }, { targets: [T.unit(F.friendly, { hint: 'help', prompt: 'Buff a friendly unit' })], text: 'When you recycle one or more cards to your Main Deck, buff a friendly unit.' }),
]);

card('ogn-266-298', "[Reaction]\nChoose a battlefield. Give friendly units there +1 [S] this turn and enemy units there -1 [S] this turn, to a minimum of 1 [S].", [
  spell(ctx => {
    const bf = bfIndexOf(ctx, t0(ctx)); if (bf === undefined) return;
    ctx.giveMight(ctx.unitsAt(bf, u => ctx.isFriendly(u)), 1);
    E.mightMin(c => c.unitsAt(bf, u => c.isEnemy(u)), 1, 1)(ctx);
  }, { targets: [T.battlefield({ prompt: 'Choose a battlefield' })] }),
]);

card('ogn-270-298', "Buff a friendly unit in your base, then move it to a battlefield.", [
  spell(ctx => {
    const t = t0(ctx); if (!t) return;
    ctx.buff(t);
    E.moveToChosen(0, 1)(ctx);
  }, { targets: [T.unit(F.friendly, F.atBase, mine, { hint: 'help', prompt: 'Buff a friendly unit in your base' }),
    T.destination(F.moveDestFor(0), F.dest((_c, l) => typeof l === 'number'), { prompt: 'Then move it to which battlefield?' })] }),   // R-2
]);

// ================================================================= OGS

card('ogs-006-024', "When you play a spell that costs [5] or more, give me +3 [S] this turn.", [
  whenYouPlay(F.and(F.spell, (c, id) => c.energyCost(id) >= 5), E.might('self', 3), { text: 'When you play a spell that costs [5] or more, give me +3 [S] this turn.' }),
]);

card('ogs-024-024', "[Action]\nGive friendly units +2 [S] this turn.", [
  spell(E.might(R.all(F.friendly), 2)),
]);

// ================================================================= RAD

card('rad-004-167', "[Action]\nGive a unit [Assault] this turn equal to its Might.", [
  spell(ctx => { const t = t0(ctx); if (!t) return; const m = ctx.might(t); if (m > 0) ctx.giveKeyword(t, `Assault ${m}`); },
    { targets: [UNIT({ prompt: 'Give a unit [Assault] equal to its Might this turn' })] }),
]);

card('rad-008-167', "[Accelerate]\nWhen you play me, give a unit +2 [S] this turn.", [
  onPlay(pump(2), { targets: [UNIT({ prompt: 'Give a unit +2 Might this turn' })], text: 'When you play me, give a unit +2 [S] this turn.' }),
]);

card('rad-027-167', "[T]: [Buff] a unit. If it's already buffed, give it +2 [S] this turn instead.", [
  activated('[T]', ctx => { const t = t0(ctx); if (!t) return; if (ctx.isBuffed(t)) ctx.giveMight(t, 2); else ctx.buff(t); },
    { targets: [UNIT({ prompt: 'Buff a unit (+2 Might this turn instead if already buffed)' })], text: "[T]: Buff a unit. If it's already buffed, give it +2 [S] this turn instead." }),
]);

card('rad-030-167', "When you play a card with Energy cost [7] or more, ready me.", [
  whenYouPlay((c, id) => !c.isToken(id) && c.energyCost(id) >= 7, E.ready('self'), { text: 'When you play a card with Energy cost [7] or more, ready me.' }),
]);

card('rad-032-167', "[Reaction]\n[Show Off] a gear.\nGive a unit +2 [S] this turn. If you showed off, ready up to 2 runes.", [
  showOff(F.gear, 'Show off a gear?'),
  // RULINGS: CR 355.5 — the runes are targets chosen as it is played (before costs are paid, so runes about to be exhausted
  // to pay for it can be chosen); offered only if you showed off.
  spell(ctx => { pump(2)(ctx); if (ctx.data.shownOff) ctx.ready(ctx.targetsOf(1)); }, { targets: [UNIT({ prompt: 'Give a unit +2 Might this turn' }), runeTargets(2, false, (cx: Ctx) => !!cx.data.shownOff)] }),
], { keywords: ['Reaction', 'Show Off'] });

card('rad-034-167', "[Reaction]\nReady a friendly unit. It can't move this turn. Draw 1.", [
  spell(ctx => { const t = t0(ctx); if (t) { ctx.ready(t); cantMoveThisTurn(ctx, t); } ctx.draw(1); },
    { targets: [T.unit(F.friendly, { hint: 'help', prompt: "Ready a friendly unit (it can't move this turn)" })] }),
]);

card('rad-038-167', "[Disarm]\nWhen you reduce the Might of an enemy unit here by 1 or more, give me +1 [S] this turn.", [
  when('mightReduced', (ev, ctx) => ev.player === ctx.controller && Number(ev.by) >= 1 && unitOf(ctx, ev.obj) && ctx.isEnemy(ev.obj as ObjId) && ctx.isHere(ev.obj as ObjId),
    E.might('self', 1), { text: 'When you reduce the Might of an enemy unit here by 1 or more, give me +1 [S] this turn.' }),
]);

card('rad-043-167', "When I become exhausted, choose one that hasn't been chosen this turn —\n- [Buff] me.\n- Spend my buff to [Stun] an enemy unit.\n- Spend my buff to ready me.", [
  // R-1 (CR 403.2; RAD-FAQ Riven; rulings B6): the mode (and the stun's enemy unit) is chosen as the trigger goes on the chain,
  // among the modes not chosen this turn; "spend my buff" is a cost inside the instruction, paid on resolution — with no buff
  // then, that mode does nothing (it still counts as chosen this turn)
  when('exhaust', (ev, ctx) => ev.obj === ctx.self, E.noop, {
    modesOncePerTurn: true,
    modes: [
      mode('buff', 'Buff me', ctx => { if (ctx.onBoard(ctx.self)) ctx.buff(ctx.self); }),
      mode('stun', 'Spend my buff to stun an enemy unit', ctx => { const e = ctx.target(0); if (ctx.onBoard(ctx.self) && ctx.spendBuff(ctx.self) && e) ctx.stun(e); },
        [T.unit(F.enemy, { hint: 'harm', prompt: 'Spend my buff to stun an enemy unit' })]),
      mode('ready', 'Spend my buff to ready me', ctx => { if (ctx.onBoard(ctx.self) && ctx.spendBuff(ctx.self)) ctx.ready(ctx.self); }),
    ],
    text: "When I become exhausted, choose one that hasn't been chosen this turn.",
  }),
]);

card('rad-046-167', "[T]: Draw 1 and channel 1 rune exhausted.\nWhen I become exhausted, give a friendly unit +3 [S] this turn.", [
  activated('[T]', E.seq(E.draw(1), E.channel(1, true)), { text: '[T]: Draw 1 and channel 1 rune exhausted.' }),
  when('exhaust', (ev, ctx) => ev.obj === ctx.self, pump(3), { targets: [T.unit(F.friendly, { hint: 'help', prompt: 'Give a friendly unit +3 Might this turn' })], text: 'When I become exhausted, give a friendly unit +3 [S] this turn.' }),
]);

card('rad-048-167', "[Reaction]\nGive a unit –[S] this turn equal to the number of exhausted units you control.", [
  spell(E.might(0, ctx => -myUnits(ctx, u => ctx.isExhausted(u)).length), { targets: [T.unit({ hint: 'harm', prompt: 'Give a unit -Might equal to your exhausted units' })] }),
]);

card('rad-057-167', "When you play a card, you may have my base Might become equal to that card's Energy cost this turn.", [
  // RULINGS: "a card" includes Guidebot itself — triggers are checked right after the play, when it is on the board (Origins FAQ,
  // Darius, Trifarian; CR 383.2.c.1). Tokens aren't cards.
  when('play', (ev, ctx) => ev.player === ctx.controller && !ev.token && typeof ev.obj === 'string' && !!ctx.obj(ev.obj) && !ctx.isToken(ev.obj),
    ctx => { const id = evObj(ctx); if (id && ctx.exists(id)) ctx.setMight(ctx.self, ctx.energyCost(id)); },
    { optional: "Piltovan Guidebot: make its base Might equal to that card's Energy cost this turn?", text: "When you play a card, you may have my base Might become equal to that card's Energy cost this turn." }),
]);

card('rad-058-167', "[Accelerate]\nWhen you play me, give an enemy unit -3 [S] this turn.", [
  onPlay(E.might(0, -3), { targets: [ENEMY({ prompt: 'Give an enemy unit -3 Might this turn' })], text: 'When you play me, give an enemy unit -3 [S] this turn.' }),
]);

card('rad-065-167', "[Disarm 2]\nOnce each turn, when you exhaust three or more friendly units at the same time, you may draw 1.", [
  when('exhaust', (ev, ctx) => {
    if (ev.player !== ctx.controller) return false;
    const counts = (e: GameEvent) => e.player === ctx.controller && unitOf(ctx, e.obj) && ctx.isFriendly(e.obj as ObjId);
    return counts(ev) && batchCount(ctx, ev, e => e.type === 'exhaust' && e.player === ev.player, counts) === 3;
  }, E.draw(1), { oncePerTurn: 1, optional: 'Seraphine: draw 1?', text: 'Once each turn, when you exhaust three or more friendly units at the same time, you may draw 1.' }),
]);

card('rad-066-167', "You may return a friendly gear to its owner's hand as an additional cost to play me.\nWhen you play me, if you paid the additional cost, ready me and give me +[S] this turn equal to the Energy cost of the gear you returned.", [
  onPlay(ctx => { ctx.ready(ctx.self); const n = Number(playData(ctx).returnedGearCost ?? 0); if (n > 0) ctx.giveMight(ctx.self, n); },
    { if: paidAdditional, text: 'When you play me, if you paid the additional cost, ready me and give me +[S] this turn equal to the Energy cost of the gear you returned.' }),
], {
  additionalCosts: [{
    optional: true, label: "Return a friendly gear to its owner's hand as an additional cost",
    cost: cost('', pay.custom("Return a friendly gear to its owner's hand",
      ctx => ctx.gear(id => ctx.ctrl(id) === ctx.controller).length > 0,
      ctx => {
        const gs = ctx.gear(id => ctx.ctrl(id) === ctx.controller);
        const gid = ctx.chooseCards(gs, 1, 1, "Return which gear to its owner's hand?")[0];
        if (!gid) return false;
        ctx.data.returnedGearCost = ctx.energyCost(gid);
        return ctx.returnToHand(gid).length === 1;
      })),
  }],
});

const playedUnitOrGearToBf = (ctx: Ctx) => ctx.count(`b6:playedPermToBf:${ctx.controller}`) > 0
  || ctx.playedThisTurn().some(id => ctx.exists(id) && (ctx.isUnit(id) || ctx.isGear(id)) && ctx.atBattlefield(id) && !ctx.obj(id).movedThisTurn);
card('rad-070-167', "[Action]\nThis costs [2] less if you've played a unit or gear to a battlefield this turn.\nGive a unit +3 [S] this turn.", [
  selfCostDyn(ctx => (playedUnitOrGearToBf(ctx) ? { energy: -2 } : {}), { text: "This costs [2] less if you've played a unit or gear to a battlefield this turn." }),
  tracker('play', (ev, ctx) => (ev.player === ctx.controller && typeof ev.loc === 'number' && (ev.cardType === 'Unit' || ev.cardType === 'Gear') && !ev.token ? `b6:playedPermToBf:${ctx.controller}` : null)),
  spell(pump(3), { targets: [UNIT({ prompt: 'Give a unit +3 Might this turn' })] }),
]);

card('rad-081-167', "[Hidden]\nWhen you play me, give a friendly unit +3 [M] this turn, then recycle me if I was played from face down.", [
  onPlay(ctx => { pump(3)(ctx); if (C.playedFromHidden(ctx) && ctx.onBoard(ctx.self)) ctx.recycle(ctx.self); },
    { targets: [T.unit(F.friendly, { hint: 'help', prompt: 'Give a friendly unit +3 Might this turn' })], text: 'When you play me, give a friendly unit +3 [M] this turn, then recycle me if I was played from face down.' }),
]);

card('rad-090-167', "[Ambush]\nWhen you play a card from face down, ready me and give me +1 [S] this turn.", [
  when('play', (ev, ctx) => ev.player === ctx.controller && !!ev.fromHidden, E.seq(E.ready('self'), E.might('self', 1)), { text: 'When you play a card from face down, ready me and give me +1 [S] this turn.' }),
]);

card('rad-110-167', "When I move, you may have another unit's base Might become 4 this turn.", [
  onMove(ctx => { const t = t0(ctx); if (t) ctx.setMight(t, 4); }, {
    optional: "Lulu: have another unit's base Might become 4 this turn?",
    targets: [T.unit(F.other, { prompt: "Another unit's base Might becomes 4 this turn" })],
    text: "When I move, you may have another unit's base Might become 4 this turn.",
  }),
]);

card('rad-114-167', "When another friendly unit becomes exhausted, give me +1 [S] this turn.\nExhaust a friendly unit: Ready a unit. Use this ability only once each turn.", [
  when('exhaust', (ev, ctx) => ev.obj !== ctx.self && unitOf(ctx, ev.obj) && ctx.isFriendly(ev.obj as ObjId), E.might('self', 1), { text: 'When another friendly unit becomes exhausted, give me +1 [S] this turn.' }),
  activated(cost('', pay.custom('Exhaust a friendly unit',
    ctx => myUnits(ctx, u => !ctx.isExhausted(u)).length > 0,
    ctx => { const u = ctx.chooseCards(myUnits(ctx, x => !ctx.isExhausted(x)), 1, 1, 'Exhaust a friendly unit')[0]; if (!u) return false; ctx.exhaust(u); return true; })),
  E.ready(0), { oncePerTurn: 1, targets: [UNIT({ prompt: 'Ready a unit' })], text: 'Exhaust a friendly unit: Ready a unit. Use this ability only once each turn.' }),
]);

card('rad-117-167', "[Reaction]\nChoose a battlefield. Give friendly units there [Shield 2] this turn.", [
  spell(ctx => { const bf = bfIndexOf(ctx, t0(ctx)); if (bf !== undefined) ctx.giveKeyword(ctx.unitsAt(bf, u => ctx.isFriendly(u)), 'Shield 2'); },
    { targets: [T.battlefield({ prompt: 'Choose a battlefield' })] }),
]);

card('rad-118-167', "When you play me, choose a friendly unit. Its base Might becomes 5 this turn.", [
  onPlay(ctx => { const t = t0(ctx); if (t) ctx.setMight(t, 5); }, { targets: [T.unit(F.friendly, { hint: 'help', prompt: 'Choose a friendly unit: its base Might becomes 5 this turn' })], text: 'When you play me, choose a friendly unit. Its base Might becomes 5 this turn.' }),
]);

card('rad-121-167', "[Action]\n[Buff] a friendly unit and [Stun] an enemy unit.", [
  spell(ctx => { ctx.buff(ctx.target(0)); ctx.stun(ctx.target(1)); }, {
    targets: [T.unit(F.friendly, { hint: 'help', prompt: 'Buff a friendly unit' }), ENEMY({ prompt: 'Stun an enemy unit' })],
  }),
]);

card('rad-131-167', "When one or more friendly units die, [Buff] a friendly unit.", [
  when('die', (ev, ctx) => {
    const fr = (e: GameEvent) => { const l = e.lki as { controller?: number; type?: string } | undefined; return !!l && l.type === 'Unit' && typeof l.controller === 'number' && !ctx.isOpponent(l.controller as never); };
    return fr(ev) && firstOfBatch(ctx, ev, e => e.type === 'die', fr);
  }, ctx => { ctx.buff(t0(ctx)); }, { targets: [T.unit(F.friendly, { hint: 'help', prompt: 'Buff a friendly unit' })], text: 'When one or more friendly units die, buff a friendly unit.' }),
]);

card('rad-134-167', "Ready your units and give them +3 [S] this turn.", [
  spell(ctx => { const us = myUnits(ctx); ctx.ready(us); ctx.giveMight(us, 3); }),
]);

// ================================================================= SFD

card('sfd-001-221', "[Reaction]\nGive a friendly unit at a battlefield +2 [S] this turn for each enemy unit there.", [
  spell(ctx => { const t = t0(ctx); if (!t) return; const l = ctx.loc(t); if (typeof l !== 'number') return; const n = ctx.unitsAt(l, u => ctx.isEnemy(u)).length; if (n) ctx.giveMight(t, 2 * n); },
    { targets: [T.unit(F.friendly, F.atBattlefield, { hint: 'help', prompt: 'Give a friendly unit at a battlefield +2 Might per enemy unit there' })] }),
]);

card('sfd-007-221', "When you play me, give a unit [Ganking] this turn.", [
  onPlay(E.keyword(0, 'Ganking'), { targets: [UNIT({ prompt: 'Give a unit [Ganking] this turn' })], text: 'When you play me, give a unit [Ganking] this turn.' }),
]);

card('sfd-034-221', "[Reaction]\n[Repeat] [2]\nGive a unit +2 [S] this turn.", [
  spell(pump(2), { targets: [UNIT({ prompt: 'Give a unit +2 Might this turn' })] }),
]);

card('sfd-038-221', "When I move to a battlefield, give another friendly unit +1 [S] this turn.", [
  onMove(pump(1), { toBattlefield: true, targets: [T.unit(F.friendly, F.other, { hint: 'help', prompt: 'Give another friendly unit +1 Might this turn' })], text: 'When I move to a battlefield, give another friendly unit +1 [S] this turn.' }),
]);

card('sfd-047-221', "When you buff me, ready me.", [
  when('buff', (ev, ctx) => ev.obj === ctx.self && ev.player === ctx.controller, E.ready('self'), { text: 'When you buff me, ready me.' }),
]);

card('sfd-057-221', "[Deflect]\nWhen you choose or ready me, give me +1 [S] this turn.", [
  when(['targeted', 'ready'], (ev, ctx) => ev.obj === ctx.self && ev.player === ctx.controller, E.might('self', 1), { text: 'When you choose or ready me, give me +1 [S] this turn.' }),
]);

card('sfd-062-221', "When you play me, ready another friendly Mech.", [
  onPlay(E.ready(0), { targets: [T.unit(F.friendly, F.other, F.tag('Mech'), { hint: 'help', prompt: 'Ready another friendly Mech' })], text: 'When you play me, ready another friendly Mech.' }),
]);

card('sfd-066-221', "[Reaction]\n[Repeat] [2]\nGive a unit -2 [S] this turn.", [
  spell(E.might(0, -2), { targets: [T.unit({ hint: 'harm', prompt: 'Give a unit -2 Might this turn' })] }),
]);

card('sfd-067-221', "You may pay [C] as an additional cost to play me.\nWhen you play me, if you paid the additional cost, give a unit -2 [S] this turn.", [
  onPlay(E.might(0, -2), { if: paidAdditional, targets: [T.unit({ hint: 'harm', prompt: 'Give a unit -2 Might this turn' })], text: 'When you play me, if you paid the additional cost, give a unit -2 [S] this turn.' }),
], { additionalCosts: [{ cost: cost('[C]'), optional: true, label: 'Pay [C] as an additional cost' }] });

card('sfd-072-221', "When you play me, if you control two or more gear, ready me.", [
  onPlay(E.ready('self'), { if: C.controls(F.gear, 2), text: 'When you play me, if you control two or more gear, ready me.' }),
]);

card('sfd-075-221', "When you use an activated ability of a gear, give me +1 [S] this turn.", [
  // RJ#11964: a gear killed as its own ability's cost (Gold: "Kill this, [T]: [Add] [A]") was still used — read its type from the event
  when('activated', (ev, ctx) => ev.player === ctx.controller && typeof ev.obj === 'string'
    && (ctx.exists(ev.obj) ? ctx.isGear(ev.obj) && !ctx.isUnit(ev.obj) : ev.cardType === 'Gear'),
    E.might('self', 1), { text: 'When you use an activated ability of a gear, give me +1 [S] this turn.' }),
]);

card('sfd-091-221', "When you play me, you may draw 1 or buff me.", [
  onPlay(E.chooseOne([
    { label: 'Draw 1', effect: E.draw(1) },
    { label: 'Buff me', effect: ctx => { ctx.buff(ctx.self); } },
    { label: 'Do nothing', effect: E.noop },
  ]), { text: 'When you play me, you may draw 1 or buff me.' }),
]);

card('sfd-097-221', "[Action]\nGive a unit +5 [S] this turn.", [
  spell(pump(5), { targets: [UNIT({ prompt: 'Give a unit +5 Might this turn' })] }),
]);

card('sfd-098-221', "You may pay [1] as an additional cost to play me.\nWhen you play me, if you paid the additional cost, buff me.", [
  onPlay(ctx => { ctx.buff(ctx.self); }, { if: paidAdditional, text: 'When you play me, if you paid the additional cost, buff me.' }),
], { additionalCosts: [{ cost: cost('[1]'), optional: true, label: 'Pay [1] as an additional cost' }] });

card('sfd-112-221', "[Deflect]\nWhen I move to a battlefield, give another friendly unit my keywords and +[M] equal to my Might this turn.", [
  onMove(ctx => {
    const t = t0(ctx); if (!t) return;
    // "my keywords / my Might" are read from Kato on the board; gone (Retreat to hand) → nothing (RJ#7374, principle 17)
    if (!ctx.onBoard(ctx.self)) return;
    const kws = keywordStrings(ctx, ctx.self); if (kws.length) ctx.giveKeyword(t, kws);
    const m = ctx.might(ctx.self);
    if (m > 0) ctx.giveMight(t, m);
  }, { toBattlefield: true, targets: [T.unit(F.friendly, F.other, { hint: 'help', prompt: 'Give another friendly unit my keywords and +Might equal to my Might' })], text: 'When I move to a battlefield, give another friendly unit my keywords and +[M] equal to my Might this turn.' }),
]);

card('sfd-137-221', "When I move from a battlefield, give me +2 [S] this turn.", [
  when('move', (ev, ctx) => ev.obj === ctx.self && typeof ev.from === 'number', E.might('self', 2), { text: 'When I move from a battlefield, give me +2 [S] this turn.' }),
]);

card('sfd-145-221', "[Hidden]\n[Action]\nSwap the Mights of two units at the same battlefield this turn.", [
  spell(ctx => {
    const [a, b] = ctx.targetsOf(0);
    if (!a || !b) return;
    const la = ctx.loc(a), lb = ctx.loc(b);
    if (typeof la !== 'number' || la !== lb) return;
    ctx.swapMight(a, b);
  }, { targets: [T.exactly(2, T.unit(F.atBattlefield, { sameLocation: true, prompt: 'Swap the Mights of two units at the same battlefield' }))] }),
]);

card('sfd-151-221', "[Reaction]\n[Repeat] [2]\nGive two friendly units each +1 [S] this turn.", [
  spell(E.might(0, 1), { targets: [T.exactly(2, T.unit(F.friendly, { hint: 'help', prompt: 'Give two friendly units each +1 Might this turn' }))] }),
]);

const RALLY = delayedAbility('sfd-166-221:buffPlayedUnit', when('play', (ev, ctx) => ev.player === ctx.controller && unitOf(ctx, ev.obj) && ctx.isFriendly(ev.obj as ObjId),
  ctx => { ctx.buff(evObj(ctx)); }, { text: 'Rally the Troops: buff the played unit' }));
card('sfd-166-221', "[Action]\nWhen a friendly unit is played this turn, buff it.\nDraw 1.", [
  spell(ctx => { ctx.delay(RALLY, {}, 'endOfTurn'); ctx.draw(1); }),
]);

card('sfd-175-221', "When you play me, give your other units +2 [S] this turn.\nAs I'm revealed from your deck, [Add] [2].", [
  onPlay(ctx => { ctx.giveMight(myUnits(ctx, u => u !== ctx.self), 2); }, { text: 'When you play me, give your other units +2 [S] this turn.' }),
  when('reveal', (ev, ctx) => ((ev.objs as ObjId[] | undefined) ?? []).includes(ctx.self) && ctx.obj(ctx.self)?.zone === 'mainDeck',
    E.add(2), { isAdd: true, activeIn: ['any'], text: "As I'm revealed from your deck, [Add] [2]." }),
]);

card('sfd-180-221', "When a unit you control becomes [Mighty], you may pay [C] to ready it.", [
  when('becameMighty', (ev, ctx) => unitOf(ctx, ev.obj) && ctx.ctrl(ev.obj as ObjId) === ctx.controller, ctx => {
    const u = evObj(ctx);
    if (u && ctx.onBoard(u)) ctx.ready(u);
  }, {
    // principle 11 (CR 383.3.a-b): the leading "may pay" is decided and paid as the trigger is chained (ENGINE-6, as RJ#12403)
    optional: 'Fiora, Worthy: pay [C] to ready the unit that became Mighty?', cost: cost('[C]'),
    offerIf: ctx => { const u = evObj(ctx); return !!u && ctx.onBoard(u); },
    text: 'When a unit you control becomes [Mighty], you may pay [C] to ready it.',
  }),
]);

card('sfd-182-221', "[Reaction]\n[Repeat] [1][A]\nGive your Mechs +1 [S] this turn.", [
  spell(ctx => { ctx.giveMight(myUnits(ctx, u => ctx.hasTag(u, 'Mech')), 1); }),
]);

card('sfd-196-221', "[Reaction]\nGive a unit +2 [S] this turn and another unit -2 [S] this turn.", [
  spell(ctx => {
    const a = ctx.target(0), b = ctx.target(1);
    if (a) ctx.giveMight(a, 2);
    if (b && b !== a) ctx.giveMight(b, -2);
  }, {
    targets: [
      UNIT({ prompt: 'Give a unit +2 Might this turn' }),
      T.unit((c, id) => !chosenSoFar(c).includes(id), { hint: 'harm', prompt: 'Give another unit -2 Might this turn' }),
    ],
  }),
]);

card('sfd-204-221', "Ready your units.", [
  spell(ctx => { ctx.ready(myUnits(ctx)); }),
]);

// ================================================================= UNL

card('unl-001-219', "I enter ready.\n[T]: Give a unit +3 [S] this turn.", [
  activated('[T]', pump(3), { targets: [UNIT({ prompt: 'Give a unit +3 Might this turn' })], text: '[T]: Give a unit +3 [S] this turn.' }),
], { entersReady: true });

card('unl-005-219', "[Ganking]\nWhen you play a spell, if you spent [4] or more, ready me.", [
  // RULINGS: "spent [4] or more" = Energy actually paid for that play (play event `paid`, B6-5), not the printed cost
  whenYouPlay(F.spell, E.ready('self'), { if: ctx => { const ev = ctx.event; return Number(((ev as { paid?: { energy?: number } } | undefined)?.paid?.energy) ?? 0) >= 4; }, text: 'When you play a spell, if you spent [4] or more, ready me.' }),
]);

card('unl-009-219', "[Repeat] [2]\nReady a unit.", [
  spell(E.ready(0), { targets: [UNIT({ prompt: 'Ready a unit' })] }),
]);

card('unl-010-219', "[Action]\nGive a unit [Assault 2] and [Ganking] this turn.", [
  spell(E.keyword(0, ['Assault 2', 'Ganking']), { targets: [UNIT({ prompt: 'Give a unit [Assault 2] and [Ganking] this turn' })] }),
]);

card('unl-012-219', "[Ambush]\nWhen you play me, give your other units here [Assault] this turn.", [
  onPlay(ctx => { const l = ctx.loc(ctx.self); if (l === null) return; ctx.giveKeyword(ctx.unitsAt(l, u => u !== ctx.self && ctx.ctrl(u) === ctx.controller), 'Assault'); },
    { text: 'When you play me, give your other units here [Assault] this turn.' }),
]);

card('unl-027-219', "When I conquer, give a friendly unit +8 [S] this turn.", [
  onConquer(pump(8), { targets: [T.unit(F.friendly, { hint: 'help', prompt: 'Give a friendly unit +8 Might this turn' })], text: 'When I conquer, give a friendly unit +8 [S] this turn.' }),
]);

card('unl-028-219', "[Hidden]\n[Ganking]\nYou may pay [C] as an additional cost to play me.\nWhen you play me, if you paid the additional cost, ready me and give me +2 [S] this turn.", [
  onPlay(E.seq(E.ready('self'), E.might('self', 2)), { if: paidAdditional, text: 'When you play me, if you paid the additional cost, ready me and give me +2 [S] this turn.' }),
], { additionalCosts: [{ cost: cost('[C]'), optional: true, label: 'Pay [C] as an additional cost' }] });

card('unl-029-219', "[Accelerate]\nYour conquer effects for conquering here trigger an additional time.\nWhen I conquer, [Buff] a friendly unit.", [
  rule('extraTriggers', (ctx, qt: { controller: number; event: GameEvent }) => {
    const h = ctx.here();
    // a conquer effect for conquering here: a conquer trigger of a real conquest, or a hold effect made a conquer effect by Skyfall
    // of Areion for that conquest (event fromType 'conquer'; RJ#9537) — not a conquer effect Skyfall activated for a hold
    const conquering = qt.event?.fromType !== undefined ? qt.event.fromType === 'conquer' : qt.event?.type === 'conquer';
    return qt.controller === ctx.controller && conquering && qt.event.player === ctx.controller && typeof h === 'number' && qt.event.bf === h;
  }, 1, { text: 'Your conquer effects for conquering here trigger an additional time.' }),
  onConquer(ctx => { ctx.buff(t0(ctx)); }, { targets: [T.unit(F.friendly, { hint: 'help', prompt: 'Buff a friendly unit' })], text: 'When I conquer, buff a friendly unit.' }),
]);

card('unl-030-219', "[Deflect]\n[2][C]: Double my Might this turn.", [
  activated('[2][C]', ctx => { if (ctx.onBoard(ctx.self)) ctx.doubleMight(ctx.self); }, { text: '[2][C]: Double my Might this turn.' }),
]);

card('unl-043-219', "[Backline]\nWhen I hold, [Buff] all units here.", [
  onHold(ctx => { const l = ctx.here(); if (typeof l !== 'number') return; for (const u of ctx.unitsAt(l)) ctx.buff(u); }, { text: 'When I hold, buff all units here.' }),
]);

card('unl-046-219', "[Reaction]\nChoose a unit. Give it +1 [S] this turn for each of the following tags among your units — Bird, Cat, Dog, and Poro.", [
  spell(ctx => {
    const t = t0(ctx); if (!t) return;
    const us = myUnits(ctx);
    const n = ['Bird', 'Cat', 'Dog', 'Poro'].filter(tag => us.some(u => ctx.hasTag(u, tag))).length;
    if (n) ctx.giveMight(t, n);
  }, { targets: [UNIT({ prompt: 'Choose a unit' })] }),
]);

const NAMI_NEXT = delayedAbility('unl-052-219:nextUnit', when('play', (ev, ctx) => ev.player === ctx.controller && unitOf(ctx, ev.obj),
  ctx => { const u = evObj(ctx); if (u && ctx.onBoard(u)) { ctx.ready(u); ctx.buff(u); } }, { text: 'Nami: ready and buff the unit' }));
card('unl-052-219', "You may pay [C] as an additional cost to play me.\nWhen you play me, if you paid the additional cost, [Stun] an enemy unit.\nWhen I hold, the next time you play a unit this turn, ready it and [Buff] it.", [
  onPlay(E.stun(0), { if: paidAdditional, targets: [ENEMY({ prompt: 'Stun an enemy unit' })], text: 'When you play me, if you paid the additional cost, stun an enemy unit.' }),
  onHold(ctx => { ctx.delay(NAMI_NEXT, {}, 'endOfTurn', 1); }, { text: 'When I hold, the next time you play a unit this turn, ready it and buff it.' }),
], { additionalCosts: [{ cost: cost('[C]'), optional: true, label: 'Pay [C] as an additional cost' }] });

card('unl-056-219', "When I attack or defend, give one of your other units here +3 [S] and [Tank] this turn.", [
  onCombatRole(E.seq(pump(3), E.keyword(0, 'Tank')), { targets: [T.unit(F.other, F.here, mine, { hint: 'help', prompt: 'Give one of your other units here +3 Might and [Tank] this turn' })], text: 'When I attack or defend, give one of your other units here +3 [S] and [Tank] this turn.' }),
]);

card('unl-066-219', "[Reaction]\nGive a unit -10 [S] this turn.", [
  spell(E.might(0, -10), { targets: [T.unit({ hint: 'harm', prompt: 'Give a unit -10 Might this turn' })] }),
]);

card('unl-068-219', "When another friendly unit dies, give me +2 [S] this turn.", [
  whenUnitDies(F.friendly, E.might('self', 2), { text: 'When another friendly unit dies, give me +2 [S] this turn.' }),
]);

card('unl-070-219', "Give a gear [Temporary].", [
  spell(E.keyword(0, 'Temporary', 'permanent'), { targets: [T.gear({ hint: 'harm', prompt: 'Give a gear [Temporary]' })] }),
]);

// VEN-FAQ Hwei / CR 387.1.b (rulings B6, R-7): each type branch is its own reflexive chain item, put on the chain after the
// discard; the Gear branch's runes are its targets, chosen as that item goes on the chain. One ability for all branches
// (data.branch), so a Unit Gear's two items (RJ#11749) need no ordering question.
const hweiBranch = reflexiveAbility('B6:hwei:branch', {
  targets: [runeTargets(2, false, cx => cx.data.branch === 'Gear')],
  effect: ctx => {
    const b = ctx.data.branch;
    if (b === 'Spell') ctx.draw(1);
    else if (b === 'Gear') ctx.ready(ctx.targetsOf(0));
    else if (b === 'Unit' && ctx.onBoard(ctx.self)) ctx.giveMight(ctx.self, 3);
  },
  text: "Hwei: the discarded card's type branch",
});
card('unl-080-219', "When I move, draw 1, then discard 1. Then, do the following based on the discarded card's type:\n* Spell — Draw 1.\n* Gear — Ready up to 2 runes.\n* Unit — Give me +3 [S] this turn.", [
  onMove(ctx => {
    ctx.draw(1);
    const d = ctx.discard(1)[0];
    if (!d || !ctx.exists(d)) return;
    // RJ#11749: one branch per matching type — a Unit Gear (Patched Porobot, additionalTypes) gets both
    const types = [ctx.type(d), ...(ctx.g.cards[ctx.cardIdOf(d)]?.additionalTypes ?? [])];
    for (const branch of ['Spell', 'Gear', 'Unit'] as const) if (types.includes(branch)) ctx.reflexive(hweiBranch, { branch });
  }, { text: "When I move, draw 1, then discard 1. Then, based on the discarded card's type: Spell — Draw 1; Gear — Ready up to 2 runes; Unit — Give me +3 [S] this turn." }),
]);

card('unl-104-219', "When you play me or another Dragon, ready up to 2 runes.", [
  when('play', (ev, ctx) => ev.player === ctx.controller && typeof ev.obj === 'string' && (ev.obj === ctx.self || (ctx.exists(ev.obj) && ctx.hasTag(ev.obj, 'Dragon'))),
    ctx => { ctx.ready(ctx.targetsOf(0)); }, { targets: [runeTargets(2)], text: 'When you play me or another Dragon, ready up to 2 runes.' }),
]);

card('unl-149-219', "[Ambush]\nWhen you play a spell, give me +2 [S] this turn.", [
  whenYouPlay(F.spell, E.might('self', 2), { text: 'When you play a spell, give me +2 [S] this turn.' }),
]);

card('unl-155-219', "[Action]\nGive a friendly unit +1 [S] this turn and [Stun] an enemy unit at its location.", [
  spell(ctx => {
    const a = ctx.target(0), b = ctx.target(1);
    if (a) ctx.giveMight(a, 1);
    if (b && (!a || ctx.sameLocation(a, b))) ctx.stun(b);
  }, {
    targets: [
      T.unit(F.friendly, { hint: 'help', prompt: 'Give a friendly unit +1 Might this turn' }),
      T.unit(F.enemy, (c, id) => { const a = chosenUnit(c); return !a || c.sameLocation(a, id); }, { hint: 'harm', prompt: 'Stun an enemy unit at its location' }),
    ],
  }),
]);

card('unl-198-219', "[Action]\nChoose a battlefield where you have units. You may move up to one enemy unit to that battlefield. Then give enemy units there -2 [S] this turn.", [
  spell(ctx => {
    const bf = bfIndexOf(ctx, ctx.target(0)); if (bf === undefined) return;
    const e = ctx.target(1);
    if (e && ctx.loc(e) !== bf) ctx.move(e, bf);
    ctx.giveMight(ctx.unitsAt(bf, u => ctx.isEnemy(u)), -2);
  }, {
    targets: [
      T.battlefield((c, id) => { const i = bfIndexOf(c, id); return i !== undefined && c.unitsAt(i, u => c.ctrl(u) === c.controller).length > 0; }, { prompt: 'Choose a battlefield where you have units' }),
      T.upTo(1, T.unit(F.enemy, (c, id) => { const i = chosenBattlefield(c); return i === undefined || c.loc(id) !== i; }, { hint: 'harm', prompt: 'You may move up to one enemy unit to that battlefield' })),
    ],
  }),
]);

// ================================================================= VEN

card('ven-005-166', "If you control fewer runes than an opponent at the start of your Beginning Phase, give me +1 [S] this turn.", [
  atStartOfBeginning(E.might('self', 1), { if: fewerRunesThanAnOpponent, text: 'If you control fewer runes than an opponent at the start of your Beginning Phase, give me +1 [S] this turn.' }),
]);

card('ven-006-166', "If you control fewer runes than an opponent at the start of your Beginning Phase, give me +2 [S] and [Ganking] this turn.", [
  atStartOfBeginning(E.seq(E.might('self', 2), E.keyword('self', 'Ganking')), { if: fewerRunesThanAnOpponent, text: 'If you control fewer runes than an opponent at the start of your Beginning Phase, give me +2 [S] and [Ganking] this turn.' }),
]);

card('ven-026-166', "When you play me, give a unit +3 [S] this turn.", [
  onPlay(pump(3), { targets: [UNIT({ prompt: 'Give a unit +3 Might this turn' })], text: 'When you play me, give a unit +3 [S] this turn.' }),
]);

card('ven-034-166', "[Hidden]\n[Reaction]\nChoose a battlefield you control and a unit you control at a different location. Move that unit to that battlefield and give it +2 [S] this turn.", [
  spell(ctx => {
    const bf = bfIndexOf(ctx, ctx.target(0)), u = ctx.target(1);
    if (bf === undefined || !u) return;
    if (ctx.loc(u) !== bf) ctx.move(u, bf);
    ctx.giveMight(u, 2);
  }, {
    targets: [
      T.battlefield((c, id) => { const i = bfIndexOf(c, id); return i !== undefined && c.controls(i); }, { prompt: 'Choose a battlefield you control' }),
      T.unit(mine, (c, id) => { const i = chosenBattlefield(c); return i === undefined || c.loc(id) !== i; }, { hint: 'help', prompt: 'Choose a unit you control at a different location', anyLocation: true }),
    ],
  }),
]);

card('ven-038-166', "I can't be chosen by enemy spells and abilities unless I'm in combat.\nWhen I move to a battlefield, give me +2 [S] this turn.", [
  statik('self', ctx => (C.inCombat(ctx) ? {} : { cantBeChosenByEnemy: true }), { text: "I can't be chosen by enemy spells and abilities unless I'm in combat." }),
  onMove(E.might('self', 2), { toBattlefield: true, text: 'When I move to a battlefield, give me +2 [S] this turn.' }),
]);

const inCombatWithEnemyFury = (c: Ctx, id: ObjId) => {
  if (!c.obj(id)?.combatRole) return false;
  const l = c.loc(id);
  return c.units(u => c.isEnemy(u) && !!c.obj(u).combatRole && c.loc(u) === l && c.domains(u).includes('Fury')).length > 0;
};
const chosenByEnemyFurySpell = (c: Ctx, id: ObjId) => c.chainItems().some(it => it.kind === 'spell' && it.id !== c.item?.id && c.isOpponent(it.controller)
  && c.exists(it.source) && c.domains(it.source).includes('Fury') && it.targets.flat().includes(id));
card('ven-040-166', "[Reaction]\nChoose a friendly unit that's in combat with an enemy Fury unit or that's being chosen by an enemy Fury spell. Give it +4 [S] this turn.", [
  spell(pump(4), { targets: [T.unit(F.friendly, (c, id) => inCombatWithEnemyFury(c, id) || chosenByEnemyFurySpell(c, id), { hint: 'help', prompt: 'Choose a friendly unit in combat with an enemy Fury unit or chosen by an enemy Fury spell' })] }),
]);

card('ven-052-166', "[Reaction]\nChoose one —\n- Return a friendly unit to its owner's hand.\n- Give an enemy unit -2 [S] this turn.", [
  spellModes([
    mode('return', "Return a friendly unit to its owner's hand", E.returnToHand(0), [T.unit(F.friendly, { prompt: "Return a friendly unit to its owner's hand" })]),
    mode('shrink', 'Give an enemy unit -2 [S] this turn', E.might(0, -2), [ENEMY({ prompt: 'Give an enemy unit -2 Might this turn' })]),
  ]),
]);

const IGNORE_DEFLECT_WHILE_PAYING = delayedAbility('ven-061-166:ignoreDeflect', rule('ignoreDeflect', (ctx, chooser: number) =>
  chooser === ctx.controller && ctx.g.chain.some(c => c.source === ctx.data.spell && c.pending)));
card('ven-061-166', "[Reaction]\nIgnore [Deflect] while paying this spell's cost.\nGive an enemy Body unit -5 [S] this turn.", [
  asPlay(ctx => { ctx.delay(IGNORE_DEFLECT_WHILE_PAYING, { spell: ctx.self }, 'endOfTurn'); }, { text: "Ignore [Deflect] while paying this spell's cost." }),
  spell(E.might(0, -5), { targets: [T.unit(F.enemy, F.domain('Body'), { hint: 'harm', prompt: 'Give an enemy Body unit -5 Might this turn' })] }),
]);

card('ven-071-166', "When I become ready, give me +2 [S] this turn.", [
  when('ready', (ev, ctx) => ev.obj === ctx.self, E.might('self', 2), { text: 'When I become ready, give me +2 [S] this turn.' }),
]);

card('ven-088-166', "When I become ready, choose one to give me this turn —\n- [Assault 2]\n- [Deflect 2]\n- [Ganking]", [
  // R-1 (CR 403.2): the keyword is chosen as the trigger goes on the chain
  when('ready', (ev, ctx) => ev.obj === ctx.self, E.noop, {
    modes: ['Assault 2', 'Deflect 2', 'Ganking'].map(kw => mode(kw, `[${kw}]`, ctx => { if (ctx.onBoard(ctx.self)) ctx.giveKeyword(ctx.self, kw); })),
    text: 'When I become ready, choose one to give me this turn — Assault 2 / Deflect 2 / Ganking.',
  }),
]);

card('ven-121-166', "When you play another unit, give me +2 [S] this turn.", [
  whenYouPlay(F.unit, E.might('self', 2), { text: 'When you play another unit, give me +2 [S] this turn.' }),
]);

card('ven-125-166', "[C]: Ready me and give me +1 [S] this turn. Use only if you've chosen an enemy unit this turn and only once each turn.", [
  // engine turn history (targets.ts emitTargeted): counts choices made before I left the deck too
  activated('[C]', E.seq(E.ready('self'), E.might('self', 1)), { oncePerTurn: 1, if: ctx => ctx.history('choseEnemyUnit') > 0, text: "[C]: Ready me and give me +1 [S] this turn. Use only if you've chosen an enemy unit this turn and only once each turn." }),
]);

const DOMINUS_READY = grantable('ven-142-166:readyMe', activated('[A][A]', E.ready('self'), { text: '[A][A]: Ready me.' }));
card('ven-142-166', "[Action]\nThis turn, double a unit's Might and give it \"[A][A]: Ready me.\"", [
  spell(ctx => { const t = t0(ctx); if (!t) return; ctx.doubleMight(t); ctx.grant(t, DOMINUS_READY, 'endOfTurn'); },
    { targets: [UNIT({ prompt: "Double a unit's Might and give it \"[A][A]: Ready me.\" this turn" })] }),
]);

card('ven-150-166', "Ready up to 4 units, gear, and/or runes.", [
  // RULINGS: CR 355.5 — all of them (units, gear and runes) are targets of one group, chosen as it is played
  spell(ctx => { ctx.ready(ctx.targetsOf(0)); }, {
    targets: [T.upTo(4, T.card({ zones: ['board', 'runes'], hint: 'help', prompt: 'Ready up to 4 units, gear, and/or runes' },
      (cx: Ctx, id: ObjId) => cx.obj(id)?.zone === 'runePool' || cx.isUnit(id) || cx.isGear(id)))],
  }),
]);

void self; void buffsOn;

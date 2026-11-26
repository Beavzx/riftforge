// The worked examples from docs/dsl-guide.md (kept compiling and tested here).
import { card, spell, onPlay, deathknell, onConquerHere, mana, wouldDie, showOff, E, T, F, C, pay, cost, when, dep, anthem } from '../../src/cards/dsl.ts';

// 1. Disintegrate — spell with a target and a conditional follow-up
card('ogn-005-298', '[Action]\nDeal 3 to a unit at a battlefield. If this kills it, do this: draw 1.', [
  spell(ctx => {
    const t = ctx.target(0);
    if (!t) return;                       // target became illegal: instructions on it are ignored
    ctx.deal(3, t);
    if (ctx.lethallyDamaged(t)) ctx.draw(1);
  }, { targets: [T.unit(F.atBattlefield, { hint: 'harm', prompt: 'Deal 3 to a unit at a battlefield' })] }),
]);

// 2. Tasty Faefolk — keyword (Accelerate, parsed from data) + Deathknell
card('ogn-075-298', '[Accelerate]\n[Deathknell] — Channel 2 runes exhausted and draw 1.', [
  deathknell(E.seq(E.channel(2, true), E.draw(1)), { text: 'Deathknell — Channel 2 runes exhausted and draw 1.' }),
]);

// 3. Monastery of Hirana — battlefield conquer trigger with an optional cost
card('ogn-282-298', 'When you conquer here, you may spend a buff to draw 1.', [
  onConquerHere(ctx => {
    const buffed = ctx.friendlyUnits(u => ctx.isBuffed(u) && ctx.ctrl(u) === ctx.controller);
    if (!buffed.length || !ctx.may('Spend a buff to draw 1?')) return;
    const u = ctx.chooseCards(buffed, 1, 1, 'Spend a buff from')[0];
    if (u && ctx.spendBuff(u)) ctx.draw(1);
  }),
]);

// 4. Lux — mana ability with a spending restriction
card('ogs-014-024', '[T]: [Reaction] — [Add] [2]. Spend this Energy only to play spells.', [
  mana('[T]', { energy: 2, only: 'spell' }, { text: '[T]: Add [2]. Use only to play spells.' }),
]);

// 5. Zhonya's Hourglass — replacement effect that kills its source instead
card('ogn-077-298', "[Hidden]\nIf a friendly unit would die, kill this instead. Heal that unit, exhaust it, and recall it.", [
  wouldDie(F.and(F.friendly, F.unit), (ctx, id) => {
    ctx.kill(ctx.self);
    ctx.heal(id); ctx.exhaust(id); ctx.recall(id);
  }, { text: 'If a friendly unit would die, kill this instead...' }),
]);

// 6. Darius — Legion-gated trigger + conditional anthem "here"
card('ogn-243-298', '[Legion] — When you play me, ready me.\nOther friendly units have +1 [S] here.', [
  onPlay(E.ready('self'), { requires: [dep.legion()] }),
  anthem(F.and(F.friendly, F.unit, F.other, F.here), { might: 1 }),
]);

// 7. Incorrigible Construct — Show Off + conditional enters ready
card('rad-011-167', '[Show Off] a Mech.\nI enter ready if you showed off.', [
  showOff(F.tag('Mech'), 'Show off a Mech?'),
], { entersReady: C.showedOff, keywords: ['Show Off'] });

void pay; void cost; void when;

// Hand-made scripted test cards exercising the DSL. Ids prefixed "ts-".
import type { CardDef, CardId } from '../../src/engine/types.ts';
import { card, spell, spellModes, mode, onPlay, deathknell, onConquer, activated, mana, anthem, selfMight, wouldDie, E, T, F, C, R, cost, pay, when, dep, whenYouPlay, killAtEndOfTurn, statik, replacement, rule, atEndOfTurn } from '../../src/cards/dsl.ts';
import { unit, spell as spellDef, gear } from './cards.ts';

export function scriptedDefs(): Record<CardId, CardDef> {
  const list: CardDef[] = [
    spellDef('ts-bolt', 1, { name: 'Test Bolt', text: '[Action]\nDeal 3 to a unit at a battlefield.' }),
    spellDef('ts-zap', 1, { name: 'Test Zap', text: '[Reaction]\nDeal 2 to a unit.' }),
    spellDef('ts-counter', 2, { name: 'Test Counter', text: '[Reaction]\nCounter a spell.' }),
    spellDef('ts-pump', 1, { name: 'Test Pump', text: '[Action]\nGive a unit +2 [S] this turn.' }),
    spellDef('ts-modal', 1, { name: 'Test Modal', text: 'Choose one —\n- Draw 1.\n- Deal 1 to a unit.' }),
    spellDef('ts-split', 2, { name: 'Test Split', text: 'Deal 4 damage split among up to two units.' }),
    spellDef('ts-repeat', 1, { name: 'Test Repeat', text: '[Repeat] [1]\nDeal 1 to a unit.' }),
    spellDef('ts-flow', 1, { name: 'Test Flow', text: 'Draw 1.\n[Flow] [2]' }),
    spellDef('ts-wipe', 3, { name: 'Test Wipe', text: 'Deal 2 to all units at battlefields.' }),
    spellDef('ts-stun', 1, { name: 'Test Stun', text: '[Action]\nStun a unit.' }),
    unit('ts-drawer', 2, 2, { name: 'Test Drawer', text: 'When you play me, draw 1.' }),
    unit('ts-dk', 2, 2, { name: 'Test Deathknell', text: '[Deathknell][>] Draw 1.' }),
    unit('ts-anthem', 3, 2, { name: 'Test Captain', text: 'Other friendly units have +1 [S].' }),
    unit('ts-conq', 2, 2, { name: 'Test Conqueror', text: 'When I conquer, draw 1.' }),
    unit('ts-recruiter', 2, 1, { name: 'Test Recruiter', text: 'When you play me, play a 1 [S] Recruit unit token to your base.' }),
    unit('ts-guard', 3, 2, { name: 'Test Guardian', text: 'If another friendly unit would die, instead heal it, exhaust it, and recall it.' }),
    unit('ts-legion', 2, 2, { name: 'Test Legion', text: '[Legion][>] I have +2 [S].' }),
    unit('ts-pinger', 2, 1, { name: 'Test Pinger', text: '[T]: Deal 1 to a unit at a battlefield.' }),
    unit('ts-spellwatch', 2, 1, { name: 'Test Spellwatcher', text: 'When you play a spell, give me +1 [S] this turn.' }),
    unit('ts-shield-all', 2, 2, { name: 'Test Warden', text: 'Opponents can\'t gain points.' }),
    gear('ts-sword', 1, { name: 'Test Sword', might: 2, tags: ['Equipment'], text: '[Equip] [1]' }),
    gear('ts-gold', 0, { name: 'Test Gold', text: '[Reaction][>] Kill this, [T]: [Add] [A].' }),
    gear('ts-bomb-maker', 1, { name: 'Test Bomb Maker', text: 'When you play this, play a Bomb gear token to a battlefield.' }),
    spellDef('ts-kill-later', 1, { name: 'Test Doom', text: 'Choose a unit. Kill it at end of turn.' }),
    unit('ts-endturn', 1, 1, { name: 'Test Ender', text: 'At the end of your turn, draw 1.' }),
  ];
  return Object.fromEntries(list.map(d => [d.id, d]));
}

card('ts-bolt', '[Action]\nDeal 3 to a unit at a battlefield.', [spell(E.deal(3, 0), { targets: [T.unit(F.atBattlefield, { hint: 'harm' })] })]);
card('ts-zap', '[Reaction]\nDeal 2 to a unit.', [spell(E.deal(2, 0), { targets: [T.unit({ hint: 'harm' })] })]);
card('ts-counter', '[Reaction]\nCounter a spell.', [spell(E.counter(0), { targets: [T.chainItem((ctx, id) => ctx.g.chain.find(c => c.id === id)?.kind === 'spell')] })]);
card('ts-pump', '[Action]\nGive a unit +2 [S] this turn.', [spell(E.might(0, 2), { targets: [T.unit({ hint: 'help' })] })]);
card('ts-modal', 'Choose one —\n- Draw 1.\n- Deal 1 to a unit.', [spellModes([
  mode('draw', 'Draw 1', E.draw(1)),
  mode('ping', 'Deal 1 to a unit', E.deal(1, 0), [T.unit()]),
])]);
card('ts-split', 'Deal 4 damage split among up to two units.', [spell(E.dealSplit(0), { targets: [T.unit({ min: 1, max: 2, split: 4 })] })]);
card('ts-repeat', '[Repeat] [1]\nDeal 1 to a unit.', [spell(E.deal(1, 0), { targets: [T.unit()] })]);
card('ts-flow', 'Draw 1.\n[Flow] [2]', [spell(E.draw(1))]);
card('ts-wipe', 'Deal 2 to all units at battlefields.', [spell(E.deal(2, R.all(F.atBattlefield)))]);
card('ts-stun', '[Action]\nStun a unit.', [spell(E.stun(0), { targets: [T.unit()] })]);
card('ts-drawer', 'When you play me, draw 1.', [onPlay(E.draw(1))]);
card('ts-dk', '[Deathknell][>] Draw 1.', [deathknell(E.draw(1))]);
card('ts-anthem', 'Other friendly units have +1 [S].', [anthem(F.and(F.unit, F.friendly, F.other), { might: 1 })]);
card('ts-conq', 'When I conquer, draw 1.', [onConquer(E.draw(1))]);
card('ts-recruiter', 'When you play me, play a 1 [S] Recruit unit token to your base.', [onPlay(E.token('Recruit', { at: 'base' }))]);
card('ts-guard', 'If another friendly unit would die, instead heal it, exhaust it, and recall it.', [wouldDie(F.and(F.friendly, F.other, F.unit), (ctx, id) => { ctx.heal(id); ctx.exhaust(id); ctx.recall(id); })]);
card('ts-legion', '[Legion][>] I have +2 [S].', [selfMight(2, { requires: [dep.legion()] })]);
card('ts-pinger', '[T]: Deal 1 to a unit at a battlefield.', [activated('[T]', E.deal(1, 0), { targets: [T.unit(F.atBattlefield)] })]);
card('ts-spellwatch', 'When you play a spell, give me +1 [S] this turn.', [whenYouPlay(F.spell, E.might('self', 1))]);
card('ts-shield-all', "Opponents can't gain points.", [rule('cantGainPoints', (ctx, p) => ctx.isOpponent(p))]);
card('ts-sword', '[Equip] [1]', []);
card('ts-gold', '[Reaction][>] Kill this, [T]: [Add] [A].', [mana(cost('[T]', pay.killSelf()), { power: ['A'] })]);
card('ts-bomb-maker', 'When you play this, play a Bomb gear token to a battlefield.', [onPlay(ctx => { const bf = ctx.chooseBattlefield(); if (bf !== undefined) ctx.createToken('Bomb', bf); })]);
card('ts-kill-later', 'Choose a unit. Kill it at end of turn.', [spell(ctx => { const t = ctx.target(0); if (t) killAtEndOfTurn(ctx, t); }, { targets: [T.unit()] })]);
card('ts-endturn', 'At the end of your turn, draw 1.', [atEndOfTurn(E.draw(1))]);

void C; void when; void statik; void replacement;

// Conformance fixture cards (ids prefixed "cf-"). Generic test cards from docs/rules-tests.md
// (V(n), ZapR, Tank(n), ...) plus scenario-specific fixtures. Scripts are written with the engine
// DSL (src/cards/dsl.ts) and registered in the card registry on import.
//
// Owned by the CONFORMANCE agent. Not real cards.
import type { CardDef, CardId, CardType, Domain, GameEvent, ObjId, PlayerId } from '../../../src/engine/types.ts';
import {
  card, spell, T, F, E, C, onPlay, deathknell, when, on, anthem, wouldDie, costMod, rule, activated, mana, dep, cost, pay,
  delayedAbility, playRule, replacement, showOff, onAttack, onDefend, onMove, atEndOfTurn, atEndOfEachTurn, whenYouPlay,
  whenUnitDies, selfMight, statik, selfCostDyn, D, type Ctx,
} from '../../../src/cards/dsl.ts';

// ------------------------------------------------------------------------------------------------
// CardDef helpers
// ------------------------------------------------------------------------------------------------

const DB: Record<CardId, CardDef> = {};
const BY_NAME: Record<string, CardId> = {};

function def(id: string, name: string, type: CardType, o: Partial<CardDef> = {}): CardDef {
  const d: CardDef = {
    id, name, type, supertypes: [], tags: [], domains: ['Fury'], energy: null, power: null, might: null,
    keywords: [], text: '', set: 'cf', rarity: 'Common', ...o,
  };
  DB[id] = d;
  BY_NAME[name] = id;
  return d;
}
const unitDef = (id: string, name: string, energy: number, might: number, text = '', o: Partial<CardDef> = {}) =>
  def(id, name, 'Unit', { energy, power: 0, might, text, ...o });
const spellDef = (id: string, name: string, energy: number, text: string, o: Partial<CardDef> = {}) =>
  def(id, name, 'Spell', { energy, power: 0, text, ...o });
const gearDef = (id: string, name: string, energy: number, text: string, o: Partial<CardDef> = {}) =>
  def(id, name, 'Gear', { energy, power: 0, text, ...o });
const bfDef = (id: string, name: string, text = '') => def(id, name, 'Battlefield', { domains: ['Colorless'], text });

// ------------------------------------------------------------------------------------------------
// Core: legend, champion, runes, battlefields
// ------------------------------------------------------------------------------------------------

def('cf-legend', 'Conformance Legend', 'Legend', { domains: ['Fury', 'Chaos'], tags: ['Tester'] });
// a second legend for 2v2 teammates (CR 491.8.h: teammates can't use the same Champion Legend)
def('cf-legend-2', 'Conformance Legend II', 'Legend', { domains: ['Fury', 'Chaos'], tags: ['Tester'] });
unitDef('cf-champ', 'Tester, Champion', 3, 3, '', { supertypes: ['Champion'], tags: ['Tester'] });
unitDef('cf-champ2', 'Tester, Second', 2, 2, '', { supertypes: ['Champion'], tags: ['Tester'] });
unitDef('cf-other-champ', 'Other, Champion', 3, 3, '', { supertypes: ['Champion'], tags: ['Other'] });
unitDef('cf-signature', 'Tester Signature Unit', 3, 3, '', { supertypes: ['Signature'], tags: ['Tester'] });
for (let i = 1; i <= 4; i++) spellDef(`cf-sig${i}`, `Tester Signature ${i}`, 1, '', { supertypes: ['Signature'], tags: ['Tester'] });

const RUNE_DOMAINS: Domain[] = ['Fury', 'Chaos', 'Mind', 'Calm', 'Body', 'Order'];
for (const d of RUNE_DOMAINS) def(`cf-rune-${d.toLowerCase()}`, `${d} Rune`, 'Rune', { domains: [d], supertypes: ['Basic'] });

for (const l of ['A', 'B', 'C', 'D', 'E', 'F']) bfDef(`cf-bf-${l.toLowerCase()}`, `BF-${l}`);

// ------------------------------------------------------------------------------------------------
// Generic units: V(n), Tank(n), Backline(n), Ganker(n), Accel(n), Temp(n), Ambusher(n), HidU(n), DK(n),
// Assault(n,x), Shield(n,x), Deflect(n,x)
// ------------------------------------------------------------------------------------------------

for (let n = 0; n <= 12; n++) {
  unitDef(`cf-v${n}`, `V(${n})`, n, n);
  unitDef(`cf-tank${n}`, `Tank(${n})`, n, n, '[Tank]');
  unitDef(`cf-backline${n}`, `Backline(${n})`, n, n, '[Backline]');
  unitDef(`cf-ganker${n}`, `Ganker(${n})`, n, n, '[Ganking]');
  unitDef(`cf-accel${n}`, `Accel(${n})`, n, n, '[Accelerate]');
  unitDef(`cf-temp${n}`, `Temp(${n})`, n, n, '[Temporary]');
  unitDef(`cf-ambusher${n}`, `Ambusher(${n})`, n, n, '[Ambush]');
  unitDef(`cf-hidu${n}`, `HidU(${n})`, n, n, '[Hidden]');
  unitDef(`cf-dk${n}`, `DK(${n})`, n, n, '[Deathknell] — Draw 1.');
  card(`cf-dk${n}`, '[Deathknell] — Draw 1.', [deathknell(E.draw(1))], { keywords: ['Deathknell'] });
  unitDef(`cf-vision${n}`, `Vision(${n})`, n, n, '[Vision]');
  unitDef(`cf-wm${n}`, `Weaponmaster(${n})`, n, n, '[Weaponmaster]');
  for (let x = 1; x <= 3; x++) {
    unitDef(`cf-assault${n}-${x}`, `Assault(${n},${x})`, n, n, `[Assault ${x}]`);
    unitDef(`cf-shield${n}-${x}`, `Shield(${n},${x})`, n, n, `[Shield ${x}]`);
    unitDef(`cf-deflect${n}-${x}`, `Deflect(${n},${x})`, n, n, `[Deflect ${x}]`);
  }
}
unitDef('cf-tankback2', 'TankBack(2)', 2, 2, '[Tank]\n[Backline]');
unitDef('cf-mech2', 'Mech(2)', 2, 2, '', { tags: ['Mech'] });
unitDef('cf-calm2', 'CalmUnit(2)', 2, 2, '', { domains: ['Calm'] });
unitDef('cf-accel-colorless', 'AccelColorless(2)', 2, 2, '[Accelerate]', { domains: ['Colorless'] });
unitDef('cf-deflect-double', 'DeflectDouble(2)', 2, 2, '[Deflect]\n[Deflect 2]');

// tokens
def('cf-recruit', 'Recruit', 'Unit', { supertypes: ['Token'], tags: ['Recruit'], domains: ['Colorless'], might: 1 });
def('cf-gold', 'Gold', 'Gear', { supertypes: ['Token'], domains: ['Colorless'], text: '[Reaction][>] Kill this, [T]: [Add] [A].' });
card('cf-gold', '[Reaction][>] Kill this, [T]: [Add] [A].', [mana(cost('[T]', pay.killSelf()), { power: ['A'] })]);
def('cf-brush', 'Brush', 'Battlefield', { supertypes: ['Token'], domains: ['Colorless'], text: '' });

// ------------------------------------------------------------------------------------------------
// Generic spells
// ------------------------------------------------------------------------------------------------

const zap = (id: string, name: string, kw: string | null, energy = 1) => {
  const text = `${kw ? `[${kw}]\n` : ''}Deal 2 to a unit.`;
  spellDef(id, name, energy, text);
  card(id, text, [spell(E.deal(2, 0), { targets: [T.unit({ hint: 'harm' })] })], { keywords: kw ? [kw] : [] });
};
zap('cf-zapm', 'ZapM', null);
zap('cf-zapa', 'ZapA', 'Action');
zap('cf-zapr', 'ZapR', 'Reaction');

spellDef('cf-drawr', 'DrawR', 1, '[Reaction]\nDraw 1.');
card('cf-drawr', '[Reaction]\nDraw 1.', [spell(E.draw(1))], { keywords: ['Reaction'] });

spellDef('cf-counterr', 'CounterR', 2, '[Reaction]\nCounter a spell.');
card('cf-counterr', '[Reaction]\nCounter a spell.', [spell(E.counter(0), { targets: [T.chainItem((c, id) => c.g.chain.find(x => x.id === id)?.kind === 'spell')] })], { keywords: ['Reaction'] });

const pump = (id: string, name: string, kw: string) => {
  const text = `[${kw}]\nGive a unit +3 Might this turn.`;
  spellDef(id, name, 1, text);
  card(id, text, [spell(E.might(0, 3), { targets: [T.unit({ hint: 'help' })] })], { keywords: [kw] });
};
pump('cf-pumpa', 'PumpA', 'Action');
pump('cf-pumpr', 'PumpR', 'Reaction');

spellDef('cf-stuna', 'StunA', 1, '[Action]\nStun a unit.');
card('cf-stuna', '[Action]\nStun a unit.', [spell(E.stun(0), { targets: [T.unit()] })], { keywords: ['Action'] });

spellDef('cf-mover', 'MoveR', 1, '[Reaction]\nMove a friendly unit to base.');
card('cf-mover', '[Reaction]\nMove a friendly unit to base.', [spell(E.move(0, 'base'), { targets: [T.unit(F.friendly, F.atBattlefield)] })], { keywords: ['Reaction'] });

spellDef('cf-killa', 'KillA', 2, '[Action]\nKill a unit at a battlefield.');
card('cf-killa', '[Action]\nKill a unit at a battlefield.', [spell(E.kill(0), { targets: [T.unit(F.atBattlefield, { hint: 'harm' })] })], { keywords: ['Action'] });

spellDef('cf-hidzap', 'HidZap', 3, '[Hidden]\n[Action]\nDeal 2 to a unit.');
card('cf-hidzap', '[Hidden]\n[Action]\nDeal 2 to a unit.', [spell(E.deal(2, 0), { targets: [T.unit()] })], { keywords: ['Hidden', 'Action'] });

gearDef('cf-sword', 'Sword', 1, '[Equip] [1]', { tags: ['Equipment'], might: 2 });
gearDef('cf-sword-a', 'SwordA', 1, '[Equip] [A]', { tags: ['Equipment'], might: 2 });

// ------------------------------------------------------------------------------------------------
// Scenario-specific fixtures
// ------------------------------------------------------------------------------------------------

// T040 play trigger
unitDef('cf-playdeal2', 'PlayDeal2', 2, 2, 'When you play me, deal 2 to a unit.');
card('cf-playdeal2', 'When you play me, deal 2 to a unit.', [onPlay(E.deal(2, 0), { targets: [T.unit({ hint: 'harm' })] })]);

// T022 end-of-turn trigger
gearDef('cf-eotburn', 'EOTBurn', 1, 'At end of turn, deal 4 to each unit with 5 or more Might.');
card('cf-eotburn', 'At end of turn, deal 4 to each unit with 5 or more Might.', [atEndOfEachTurn(ctx => ctx.deal(4, ctx.units(u => ctx.might(u) >= 5)))]);

// T038 "at the end of your turn" trigger
gearDef('cf-eotdraw', 'EOTDraw', 1, 'At the end of your turn, draw 1.');
card('cf-eotdraw', 'At the end of your turn, draw 1.', [atEndOfTurn(E.draw(1))]);

// T018 hold trigger that adds energy
bfDef('cf-bf-holdadd', 'HoldAdd', 'When you hold here, [Add] [1].');
card('cf-bf-holdadd', 'When you hold here, [Add] [1].', [when('hold', (ev, ctx) => ev.player === ctx.controller && ev.bf === ctx.bfIndex(), E.add(1), { isAdd: true })]);

// T019 resource-adding reaction spell
spellDef('cf-addr', 'AddR', 0, '[Reaction]\n[Add] [2].');
card('cf-addr', '[Reaction]\n[Add] [2].', [spell(E.add(2))], { keywords: ['Reaction'] });

// T043
spellDef('cf-upto2zap', 'UpTo2Zap', 1, 'Deal 2 to each of up to two units.');
card('cf-upto2zap', 'Deal 2 to each of up to two units.', [spell(E.deal(2, 0), { targets: [T.upTo(2, T.unit())] })]);

// T044 return a unit and replay it
spellDef('cf-bouncereplay', 'BounceReplay', 1, '[Reaction]\nReturn a friendly unit to its owner\'s hand, then play it to your base, ignoring its cost.');
card('cf-bouncereplay', '[Reaction]\nReturn a friendly unit to its owner\'s hand, then play it to your base, ignoring its cost.', [spell(ctx => {
  const t = ctx.target(0);
  if (!t) return;
  ctx.returnToHand(t);
  if (ctx.obj(t)?.zone === 'hand') ctx.play(t, { ignoreCost: true, destination: 'base' });
}, { targets: [T.unit(F.friendly)] })], { keywords: ['Reaction'] });

// T045 "when you play a spell" (Ravenbloom-Student-like)
unitDef('cf-spellwatch', 'SpellWatcher', 1, 1, 'When you play a spell, draw 1.');
card('cf-spellwatch', 'When you play a spell, draw 1.', [whenYouPlay(F.spell, E.draw(1))]);

// T147 Legion
unitDef('cf-legion', 'LegionDraw', 1, 1, '[Legion] — When you play me, draw 1.');
card('cf-legion', '[Legion] — When you play me, draw 1.', [onPlay(E.draw(1), { requires: [dep.legion()] })], { keywords: ['Legion'] });

// T047 discounts
gearDef('cf-discount2', 'Discount2', 0, 'Cards you play cost [2] less.');
card('cf-discount2', 'Cards you play cost [2] less.', [costMod((ctx, id) => ctx.obj(id)?.controller === ctx.controller || ctx.g.objects[id]?.owner === ctx.controller, { energy: -2 })]);
gearDef('cf-discount1', 'Discount1', 0, 'Cards you play cost [1] less.');
card('cf-discount1', 'Cards you play cost [1] less.', [costMod((ctx, id) => ctx.obj(id)?.controller === ctx.controller || ctx.g.objects[id]?.owner === ctx.controller, { energy: -1 })]);

// T031 [3][R] unit, T033 [1][G] spell, T034 Fury/Chaos [2][C]
unitDef('cf-cost3r', 'Cost3R', 3, 3, '', { power: 1 });
spellDef('cf-calmdraw', 'CalmDraw', 1, 'Draw 1.', { domains: ['Calm'], power: 1 });
card('cf-calmdraw', 'Draw 1.', [spell(E.draw(1))]);
spellDef('cf-furychaos', 'FuryChaosDraw', 2, 'Draw 1.', { domains: ['Fury', 'Chaos'], power: 1 });
card('cf-furychaos', 'Draw 1.', [spell(E.draw(1))]);
spellDef('cf-colorless', 'ColorlessDraw', 1, 'Draw 1.', { domains: ['Colorless'] });
card('cf-colorless', 'Draw 1.', [spell(E.draw(1))]);
spellDef('cf-calmbody', 'CalmBodySpell', 1, 'Draw 1.', { domains: ['Calm', 'Body'] });
spellDef('cf-furymind', 'FuryMindSpell', 1, 'Draw 1.', { domains: ['Fury', 'Mind'] });
gearDef('cf-unique', 'UniqueCape', 1, '[Unique]\n[Equip] [C]', { tags: ['Equipment'], might: 1 });

// T048 Pickpocket
unitDef('cf-pickpocket', 'Pickpocket', 2, 2, 'When you play me, you may kill a gear with Energy cost no more than [1]. If you do, play a Gold gear token exhausted.');
card('cf-pickpocket', 'When you play me, you may kill a gear with Energy cost no more than [1]. If you do, play a Gold gear token exhausted.', [onPlay(ctx => {
  const t = ctx.target(0);
  if (t && ctx.kill(t).length) ctx.createToken('Gold', 'base', { exhausted: true });
}, { optional: true, targets: [T.gear(F.costAtMost(1))] })]);

// T056
spellDef('cf-zap3pump3', 'Zap3Pump3', 1, 'Deal 3 to a unit. Then give it +3 Might this turn.');
card('cf-zap3pump3', 'Deal 3 to a unit. Then give it +3 Might this turn.', [spell(E.seq(E.deal(3, 0), E.might(0, 3)), { targets: [T.unit()] })]);

// T057
spellDef('cf-killdraw', 'KillDraw', 1, 'Kill a unit. Draw 1.');
card('cf-killdraw', 'Kill a unit. Draw 1.', [spell(E.seq(E.kill(0), E.draw(1)), { targets: [T.unit()] })]);

// T059 / T060 "when a unit dies, draw 1"
unitDef('cf-deathwatch', 'DeathWatch', 1, 1, 'When a unit dies, draw 1.');
card('cf-deathwatch', 'When a unit dies, draw 1.', [whenUnitDies(F.any, E.draw(1))]);
unitDef('cf-deathwatch2', 'DeathWatch2', 1, 1, 'When a unit dies, draw 1.');
card('cf-deathwatch2', 'When a unit dies, draw 1.', [whenUnitDies(F.any, E.draw(1))]);

// T073 Charm
spellDef('cf-charm', 'Charm', 1, 'Move an enemy unit.');
card('cf-charm', 'Move an enemy unit.', [spell(ctx => {
  const t = ctx.target(0);
  if (!t) return;
  const here = ctx.loc(t);
  const opts = (['base', ...ctx.battlefields()] as ('base' | number)[]).filter(l => l !== here);
  const to = ctx.chooseLocation(opts, 'Charm: move it to');
  if (to !== undefined) ctx.move(t, to);
}, { targets: [T.unit(F.enemy)] })]);

// T074 "When I move, draw 1"
unitDef('cf-movedraw', 'MoveDraw(2)', 2, 2, 'When I move, draw 1.');
card('cf-movedraw', 'When I move, draw 1.', [onMove(E.draw(1))]);

// T075 Vilemaw's Lair
bfDef('cf-bf-lair', 'Lair', 'Units can\'t move from here to base.');
card('cf-bf-lair', 'Units can\'t move from here to base.', [rule('cantMove', (ctx, _unit, from, to) => from === ctx.bfIndex() && to === 'base')]);

// T092 / T093
unitDef('cf-attackdraw', 'AttackDraw(3)', 3, 3, 'When I attack, draw 1.');
card('cf-attackdraw', 'When I attack, draw 1.', [onAttack(E.draw(1))]);
unitDef('cf-defendambush', 'DefendAmbusher(3)', 3, 3, '[Ambush]\nWhen I defend, draw 1.');
card('cf-defendambush', '[Ambush]\nWhen I defend, draw 1.', [onDefend(E.draw(1))], { keywords: ['Ambush'] });

// T096 Immortal-Phoenix-like (active in trash)
unitDef('cf-phoenix', 'TrashPhoenix', 3, 3, 'When you kill a unit with a spell, draw 1.');
card('cf-phoenix', 'When you kill a unit with a spell, draw 1.', [when('killed', (ev, ctx) => {
  const by = ev.by as { player?: PlayerId; obj?: ObjId; combat?: boolean } | null;
  return !!by && by.player === ctx.controller && !by.combat && !!by.obj && !!ctx.obj(by.obj) && ctx.type(by.obj) === 'Spell';
}, E.draw(1), { activeIn: ['trash'] })]);

// T097 Kog'Maw-like
unitDef('cf-kog', 'KogLike(1)', 1, 1, '[Deathknell] — Deal 4 to all units at my battlefield.');
card('cf-kog', '[Deathknell] — Deal 4 to all units at my battlefield.', [deathknell(ctx => {
  const l = (ctx.event?.lki as { loc?: 'base' | number } | undefined)?.loc;
  if (typeof l === 'number') ctx.deal(4, ctx.unitsAt(l));
})], { keywords: ['Deathknell'] });

// T104 / T107
spellDef('cf-score1', 'Score1', 1, 'Score 1 point.');
card('cf-score1', 'Score 1 point.', [spell(E.points(1))]);
spellDef('cf-opplose1', 'OppLose1', 1, 'Your opponent loses 1 point.');
card('cf-opplose1', 'Your opponent loses 1 point.', [spell(ctx => { ctx.losePoints(1, ctx.opponent); })]);
unitDef('cf-losewatch', 'LoseWatch', 1, 1, 'When a player loses points, draw 1.');
card('cf-losewatch', 'When a player loses points, draw 1.', [when('pointsLost', null, E.draw(1))]);

// T109 DropR
const ANY_BF = delayedAbility('cf:anyBattlefield', playRule((ctx, id) => id === ctx.data.obj, { extraDestinations: ctx => ctx.battlefields() }));
spellDef('cf-dropr', 'DropR', 0, '[Reaction]\nPlay a unit from your hand to any battlefield, ignoring its cost.');
card('cf-dropr', '[Reaction]\nPlay a unit from your hand to any battlefield, ignoring its cost.', [spell(ctx => {
  const u = ctx.chooseCards(ctx.hand().filter(id => ctx.isUnit(id)), 1, 1, 'DropR: choose a unit')[0];
  if (!u) return;
  const bf = ctx.chooseBattlefield(undefined, 'DropR: choose a battlefield');
  if (bf === undefined) return;
  ctx.delay(ANY_BF, { obj: u }, 'endOfTurn');
  ctx.play(u, { ignoreCost: true, destination: bf });
})], { keywords: ['Reaction'] });

// draws / predict / burn
for (const n of [1, 2, 3]) {
  spellDef(`cf-draw${n}m`, `Draw${n}M`, 1, `Draw ${n}.`);
  card(`cf-draw${n}m`, `Draw ${n}.`, [spell(E.draw(n))]);
}
spellDef('cf-predict2', 'Predict2M', 1, '[Predict 2].');
card('cf-predict2', '[Predict 2].', [spell(E.predict(2))]);
spellDef('cf-burn2', 'Burn2M', 1, '[Burn 2].');
card('cf-burn2', '[Burn 2].', [spell(E.burn(2))]);

// T117 trigger that returns a moving enemy unit to base
gearDef('cf-repel', 'Repel', 1, 'When an enemy unit moves to a battlefield, move it to its controller\'s base.');
card('cf-repel', 'When an enemy unit moves to a battlefield, move it to its controller\'s base.', [when('move', (ev, ctx) => typeof ev.to === 'number' && on.enemyObj(ev, ctx), ctx => { const u = ctx.event?.obj as ObjId; if (ctx.exists(u) && ctx.atBattlefield(u)) ctx.move(u, 'base'); })]);

// T118 aura
unitDef('cf-aura', 'Aura(2)', 2, 2, 'Other friendly units here have +1 Might.');
card('cf-aura', 'Other friendly units here have +1 Might.', [anthem((ctx, id) => id !== ctx.self && ctx.isFriendly(id) && ctx.isUnit(id) && ctx.isHere(id), { might: 1 })]);

// T119
unitDef('cf-mayspelldraw', 'MaySpellDraw', 1, 1, 'Once each turn, when you play a spell, you may draw 1.');
card('cf-mayspelldraw', 'Once each turn, when you play a spell, you may draw 1.', [whenYouPlay(F.spell, E.draw(1), { optional: true, oncePerTurn: 1 })]);

// T120
unitDef('cf-playzapenemybf', 'PlayZapEnemyBF', 2, 2, 'When you play me, deal 2 to an enemy unit at a battlefield.');
card('cf-playzapenemybf', 'When you play me, deal 2 to an enemy unit at a battlefield.', [onPlay(E.deal(2, 0), { targets: [T.unit(F.enemy, F.atBattlefield)] })]);

// T121
unitDef('cf-dkmight', 'DKMight(2)', 2, 2, '[Deathknell] — Deal damage equal to my Might to a unit.');
card('cf-dkmight', '[Deathknell] — Deal damage equal to my Might to a unit.', [deathknell(ctx => {
  const m = Number((ctx.event?.lki as { might?: number } | undefined)?.might ?? 0);
  E.deal(m, 0)(ctx);
}, { targets: [T.unit()] })], { keywords: ['Deathknell'] });

// T122 / T123 Zhonya-like
const hourglass = (id: string, name: string) => {
  const text = 'If a friendly unit would die, kill this instead. Heal that unit, exhaust it, and recall it.';
  gearDef(id, name, 2, text);
  card(id, text, [wouldDie(F.and(F.friendly, F.unit), (ctx, u) => { ctx.kill(ctx.self); ctx.heal(u); ctx.exhaust(u); ctx.recall(u); })]);
};
hourglass('cf-hourglass', 'Hourglass');
hourglass('cf-hourglass2', 'Hourglass2');

// T125 Elder Dragon + Counter Strike
unitDef('cf-elder', 'ElderLike(6)', 6, 6, 'Any amount of your damage is enough to kill enemy units.\nWhen you play me, deal 1 to up to one enemy unit.');
card('cf-elder', 'Any amount of your damage is enough to kill enemy units.\nWhen you play me, deal 1 to up to one enemy unit.', [
  rule('anyDamageLethal', (ctx, dealer: PlayerId, unit: ObjId) => dealer === ctx.controller && ctx.isEnemy(unit)),
  onPlay(E.deal(1, 0), { targets: [T.upTo(1, T.unit(F.enemy))] }),
]);
const PREVENT_NEXT = delayedAbility('cf:preventNext', replacement('damage',
  (ev, ctx) => ev.obj === ctx.data.obj && (ctx.obj(ev.obj as ObjId)?.epoch ?? 0) === ctx.data.epoch && !ctx.data.used,
  (ev, ctx) => { ctx.data.used = true; ctx.data.__consume = true; return { ...ev, amount: 0 }; }));
spellDef('cf-counterstrike', 'CounterStrikeLike', 1, '[Reaction]\nChoose a unit. The next time that unit would be dealt damage this turn, prevent it. Draw 1.');
card('cf-counterstrike', '[Reaction]\nChoose a unit. The next time that unit would be dealt damage this turn, prevent it. Draw 1.', [spell(ctx => {
  const t = ctx.target(0);
  if (t) ctx.delay(PREVENT_NEXT, { obj: t, epoch: ctx.obj(t).epoch ?? 0 }, 'endOfTurn');
  ctx.draw(1);
}, { targets: [T.unit()] })], { keywords: ['Reaction'] });
unitDef('cf-damagewatch', 'DamageWatch', 1, 1, 'When a unit is dealt damage, draw 1.');
card('cf-damagewatch', 'When a unit is dealt damage, draw 1.', [when('damage', null, E.draw(1))]);

// T126-T129 layers
spellDef('cf-stupefy', 'StupefyLike', 1, '[Reaction]\nGive a unit -1 Might this turn, to a minimum of 1 Might. Draw 1.');
card('cf-stupefy', '[Reaction]\nGive a unit -1 Might this turn, to a minimum of 1 Might. Draw 1.', [spell(E.seq(E.mightMin(0, 1, 1), E.draw(1)), { targets: [T.unit()] })], { keywords: ['Reaction'] });
spellDef('cf-dragonform', 'DragonFormLike', 1, '[Reaction]\nChoose a unit. Its base Might becomes 5 this turn.');
card('cf-dragonform', '[Reaction]\nChoose a unit. Its base Might becomes 5 this turn.', [spell(ctx => ctx.setMight(ctx.target(0), 5), { targets: [T.unit()] })], { keywords: ['Reaction'] });
unitDef('cf-mightywatch', 'MightyWatch', 1, 1, 'When a unit you control becomes [Mighty], draw 1.');
card('cf-mightywatch', 'When a unit you control becomes [Mighty], draw 1.', [when('becameMighty', (ev, ctx) => typeof ev.obj === 'string' && ctx.obj(ev.obj)?.controller === ctx.controller, E.draw(1))]);

// T130 / T131 / T132
spellDef('cf-bouncem', 'BounceM', 1, 'Return a unit to its owner\'s hand.');
card('cf-bouncem', 'Return a unit to its owner\'s hand.', [spell(E.returnToHand(0), { targets: [T.unit()] })]);
spellDef('cf-givetank', 'GiveTank', 1, 'Give a unit [Tank].');
card('cf-givetank', 'Give a unit [Tank].', [spell(E.keyword(0, 'Tank', 'permanent'), { targets: [T.unit()] })]);
spellDef('cf-takeover', 'TakeoverLike', 1, 'Take control of an enemy unit at a battlefield. Ready it.\nLose control of that unit and recall it at end of turn.');
card('cf-takeover', 'Take control of an enemy unit at a battlefield. Ready it.\nLose control of that unit and recall it at end of turn.', [spell(ctx => {
  const t = ctx.target(0);
  if (!t) return;
  const prev = ctx.ctrl(t);
  ctx.takeControl(t);
  ctx.ready(t);
  ctx.delay(D.returnControlAtEnd, { obj: t, to: prev, recall: true }, 'endOfTurn');
}, { targets: [T.unit(F.enemy, F.atBattlefield)] })]);
spellDef('cf-givemight', 'GiveMinus3', 1, 'Give a unit -3 Might this turn.');
card('cf-givemight', 'Give a unit -3 Might this turn.', [spell(E.might(0, -3), { targets: [T.unit()] })]);

// T134
unitDef('cf-readywatch', 'ReadyWatch', 1, 1, 'When a unit becomes ready, draw 1.');
card('cf-readywatch', 'When a unit becomes ready, draw 1.', [when('ready', (ev, ctx) => typeof ev.obj === 'string' && ctx.isUnit(ev.obj), E.draw(1))]);

// T137 two-target spell
spellDef('cf-twozap', 'TwoZap', 1, 'Deal 1 to each of two units.');
card('cf-twozap', 'Deal 1 to each of two units.', [spell(E.deal(1, 0), { targets: [T.exactly(2, T.unit())] })]);

// T138 Heisho-like
bfDef('cf-bf-heisho', 'HeishoLike', 'Players ignore [Deflect] while paying for spells and abilities choosing something here.');
card('cf-bf-heisho', 'Players ignore [Deflect] while paying for spells and abilities choosing something here.', [rule('ignoreDeflect', (ctx, _chooser, target: ObjId) => ctx.loc(target) === ctx.bfIndex())]);

// T153 Spinning Axe-like
gearDef('cf-spinaxe', 'SpinAxe', 1, '[Quick-Draw]\n[Equip] [C]\n[Temporary]', { tags: ['Equipment'], might: 3 });

// T155 Repeat
spellDef('cf-repeatzap', 'RepeatZap', 1, 'Deal 1 to a unit.\n[Repeat] [1]');
card('cf-repeatzap', 'Deal 1 to a unit.\n[Repeat] [1]', [spell(E.deal(1, 0), { targets: [T.unit()] })], { keywords: ['Repeat'] });

// T156(b) Ambusher with "kill a friendly unit" additional cost
unitDef('cf-ambushpatron', 'AmbushPatron(3)', 1, 3, '[Ambush]\nAs an additional cost to play me, kill a friendly unit.');
card('cf-ambushpatron', '[Ambush]\nAs an additional cost to play me, kill a friendly unit.', [], { keywords: ['Ambush'], additionalCosts: [{ cost: cost('', pay.killFriendly()) }] });

// T157 Scorchclaw-like
unitDef('cf-scorchclaw', 'ScorchLike(2)', 2, 2, '[Hunt 2]\n[Level 3][>] I have +1 Might and enter ready.');
card('cf-scorchclaw', '[Hunt 2]\n[Level 3][>] I have +1 Might and enter ready.', [selfMight(1, { requires: [dep.level(3)] })], { keywords: ['Hunt 2'], entersReady: ctx => ctx.xp() >= 3 });

// T158 Punching Poro-like
unitDef('cf-poro', 'PoroLike(2)', 2, 2, '[Empower] — Discard 1\n[Empowered][>] I have +1 Might.');
card('cf-poro', '[Empower] — Discard 1\n[Empowered][>] I have +1 Might.', [selfMight(1, { requires: [dep.empowered()] })], { keywords: ['Empower'], costs: { Empower: cost('', pay.discard(1)) } });

// T159 Brittle Steel-like
spellDef('cf-brittle', 'BrittleLike', 2, 'Kill a gear.\n[Flow] [4][C]');
card('cf-brittle', 'Kill a gear.\n[Flow] [4][C]', [spell(E.kill(0), { targets: [T.gear()] })], { keywords: ['Flow'], costs: { Flow: cost('[4][C]') } });

// T160 Banner of Conquest-like
gearDef('cf-banner', 'BannerLike', 1, '[Deploy]\nFriendly units here have [Assault].');
card('cf-banner', '[Deploy]\nFriendly units here have [Assault].', [anthem((ctx, id) => ctx.isFriendly(id) && ctx.isUnit(id) && ctx.isHere(id), { keywords: ['Assault'] })], { keywords: ['Deploy'] });

// T161 Chronomancer-like
unitDef('cf-chrono', 'ChronoLike(3)', 3, 3, 'When you play me, [Predict 2].\n[Disarm 2]');
card('cf-chrono', 'When you play me, [Predict 2].\n[Disarm 2]', [onPlay(E.predict(2))], { keywords: ['Disarm 2'] });

// T162 Show Off
unitDef('cf-construct', 'ConstructLike(3)', 3, 3, '[Show Off] a Mech.\nI enter ready if you showed off.');
card('cf-construct', '[Show Off] a Mech.\nI enter ready if you showed off.', [showOff(F.tag('Mech'))], { keywords: ['Show Off'], entersReady: C.showedOff });

// T163 buff
spellDef('cf-buffm', 'BuffM', 1, '[Buff] a unit.');
card('cf-buffm', '[Buff] a unit.', [spell(E.buff(0), { targets: [T.unit()] })]);
unitDef('cf-avian', 'AvianLike(2)', 2, 2, '[T]: [Buff] a unit. If it\'s already buffed, give it +2 Might this turn instead.');
card('cf-avian', '[T]: [Buff] a unit. If it\'s already buffed, give it +2 Might this turn instead.', [activated('[T]', ctx => {
  const t = ctx.target(0);
  if (!t) return;
  if (ctx.isBuffed(t)) ctx.giveMight(t, 2); else ctx.buff(t);
}, { targets: [T.unit()] })]);

// T164
unitDef('cf-stunwatch', 'StunWatch', 1, 1, 'When you stun a unit, draw 1.');
card('cf-stunwatch', 'When you stun a unit, draw 1.', [when('stun', (ev, ctx) => ev.player === ctx.controller, E.draw(1))]);

// ---- FAQ fixtures ----
spellDef('cf-kibarrier', 'KiBarrierLike', 1, '[Reaction]\nChoose a unit. Prevent the next 7 damage that would be dealt to it this turn.');
card('cf-kibarrier', '[Reaction]\nChoose a unit. Prevent the next 7 damage that would be dealt to it this turn.', [spell(E.prevent(0, 7), { targets: [T.unit()] })], { keywords: ['Reaction'] });
const DOUBLE = delayedAbility('cf:doubleDamage', replacement('damage',
  (ev, ctx) => ev.obj === ctx.data.obj && (ctx.obj(ev.obj as ObjId)?.epoch ?? 0) === ctx.data.epoch,
  ev => ({ ...ev, amount: Number(ev.amount) * 2 })));
spellDef('cf-lotustrap', 'LotusTrapLike', 1, '[Reaction]\nChoose a unit. Double all damage that would be dealt to it this turn.');
card('cf-lotustrap', '[Reaction]\nChoose a unit. Double all damage that would be dealt to it this turn.', [spell(ctx => {
  const t = ctx.target(0);
  if (t) ctx.delay(DOUBLE, { obj: t, epoch: ctx.obj(t).epoch ?? 0 }, 'endOfTurn');
}, { targets: [T.unit()] })], { keywords: ['Reaction'] });

spellDef('cf-hiddenblade', 'HiddenBladeLike', 2, '[Action]\nKill a unit at a battlefield. Its controller draws 2.');
card('cf-hiddenblade', '[Action]\nKill a unit at a battlefield. Its controller draws 2.', [spell(ctx => {
  const t = ctx.target(0);
  if (!t) return;                       // mistarget: the kill AND the linked draw are ignored
  const who = ctx.ctrl(t);
  ctx.kill(t);                          // may be negated ("can't be killed") or replaced
  ctx.draw(2, who);
}, { targets: [T.unit(F.atBattlefield)] })], { keywords: ['Action'] });
unitDef('cf-unkillable', 'Unkillable(3)', 3, 3, 'I can\'t be killed.');
card('cf-unkillable', 'I can\'t be killed.', [replacement('die', (ev, ctx) => ev.obj === ctx.self, () => null)]);

spellDef('cf-rebuttal', 'RebuttalLike', 1, '[Reaction]\nChoose a spell with Energy cost no more than [4]. You may pay [A]. If you do, gain control of it and you may make new choices for it. Otherwise, counter it.');
card('cf-rebuttal', '[Reaction]\nChoose a spell with Energy cost no more than [4]. You may pay [A]. If you do, gain control of it and you may make new choices for it. Otherwise, counter it.', [spell(ctx => {
  const it = ctx.target(0);
  if (!it) return;
  if (ctx.mayPay(cost('[A]'), 'Pay [A] to gain control of it?')) {
    const remake = ctx.may('Make new choices for it?');
    ctx.takeControlOfItem(it, remake);
  } else ctx.counter(it);
}, { targets: [T.chainItem((c, id) => { const x = c.g.chain.find(i => i.id === id); return !!x && x.kind === 'spell' && (c.g.objects[x.source] ? c.energyCost(x.source) <= 4 : false); })] })], { keywords: ['Reaction'] });
unitDef('cf-ram', 'RamLike(5)', 5, 5, 'I cost [1] less for each card you\'ve played this turn, to a minimum of [1].');
card('cf-ram', 'I cost [1] less for each card you\'ve played this turn, to a minimum of [1].', [selfCostDyn(ctx => ({ energy: -Math.min(4, ctx.playedThisTurn().length) }))]);

unitDef('cf-swain', 'SwainLike(3)', 3, 3, 'When I conquer, if you\'ve played a non-token unit, a non-token gear, and a spell this turn, you score 1 point.');
card('cf-swain', 'When I conquer, if you\'ve played a non-token unit, a non-token gear, and a spell this turn, you score 1 point.', [when('conquer', (ev, ctx) => ev.player === ctx.controller && ((ev.units as ObjId[] | undefined) ?? []).includes(ctx.self), E.points(1), {
  if: ctx => {
    const ids = ctx.playedThisTurn().filter(id => ctx.exists(id) && !ctx.isToken(id));
    const ty = (id: ObjId) => ctx.g.cards[ctx.g.objects[id].cardId]?.type;
    return ids.some(id => ty(id) === 'Unit') && ids.some(id => ty(id) === 'Gear') && ids.some(id => ty(id) === 'Spell');
  },
})]);

unitDef('cf-renekton', 'RenektonLike(9)', 9, 9, 'When my Might becomes 10 or more, draw 1.');
card('cf-renekton', 'When my Might becomes 10 or more, draw 1.', [when('mightChanged', (ev, ctx) => ev.obj === ctx.self && Number(ev.from) < 10 && Number(ev.to) >= 10, E.draw(1))]);

unitDef('cf-akali', 'AkaliLike(3)', 3, 3, 'I can\'t be chosen by enemy spells and abilities unless I\'m in combat.');
card('cf-akali', 'I can\'t be chosen by enemy spells and abilities unless I\'m in combat.', [statik('self', { cantBeChosenByEnemy: true }, { if: ctx => !ctx.obj(ctx.self)?.combatRole })]);
spellDef('cf-starcrossed', 'StarCrossedLike', 1, '[Reaction]\nReturn a friendly unit and an enemy unit to their owners\' hands.');
card('cf-starcrossed', '[Reaction]\nReturn a friendly unit and an enemy unit to their owners\' hands.', [spell(E.seq(E.returnToHand(0), E.returnToHand(1)), { targets: [T.unit(F.friendly), T.unit(F.enemy)] })], { keywords: ['Reaction'] });

spellDef('cf-ridethewind', 'RideTheWindLike', 1, '[Action]\nMove a friendly unit to base and ready it.');
card('cf-ridethewind', '[Action]\nMove a friendly unit to base and ready it.', [spell(E.seq(E.move(0, 'base'), E.ready(0)), { targets: [T.unit(F.friendly)] })], { keywords: ['Action'] });

unitDef('cf-kayle', 'KayleLike(2)', 2, 2, '[Empower] [1]\nI can be [Empowered] up to three times.');
card('cf-kayle', '[Empower] [1]\nI can be [Empowered] up to three times.', [], { keywords: ['Empower'], costs: { Empower: cost('[1]') }, maxEmpower: 3 });
spellDef('cf-disempower', 'DisempowerM', 1, 'Disempower a unit.');
card('cf-disempower', 'Disempower a unit.', [spell(E.disempower(0), { targets: [T.unit()] })]);

spellDef('cf-turntodust', 'TurnToDustLike', 1, 'Give a gear [Temporary].');
card('cf-turntodust', 'Give a gear [Temporary].', [spell(E.keyword(0, 'Temporary', 'permanent'), { targets: [T.gear()] })]);

unitDef('cf-patron', 'PatronLike(4)', 1, 4, 'As an additional cost to play me, kill a friendly unit.');
card('cf-patron', 'As an additional cost to play me, kill a friendly unit.', [], { additionalCosts: [{ cost: cost('', pay.killFriendly()) }] });

bfDef('cf-bf-aspirant', 'AspirantLike', 'Increase the points needed to win the game by 1.');
card('cf-bf-aspirant', 'Increase the points needed to win the game by 1.', [rule('victoryScoreDelta', undefined, 1)]);
spellDef('cf-replacebf', 'ReplaceWithBrush', 1, 'Replace a battlefield with a Brush.');
card('cf-replacebf', 'Replace a battlefield with a Brush.', [spell(ctx => {
  const bf = ctx.chooseBattlefield(undefined, 'Replace which battlefield?');
  if (bf !== undefined) ctx.replaceBattlefield(bf, 'Brush');
})]);

unitDef('cf-draven', 'DravenLike(4)', 4, 4, 'The first time I win a combat each turn, you score 1 point.');
card('cf-draven', 'The first time I win a combat each turn, you score 1 point.', [when('combatResult', (ev, ctx) => ev.winner === ctx.controller && ctx.loc(ctx.self) === ev.bf, E.points(1), { oncePerTurn: 1 })]);
unitDef('cf-windraw', 'WinDraw(3)', 3, 3, 'When I win a combat, draw 1.');
card('cf-windraw', 'When I win a combat, draw 1.', [when('combatResult', (ev, ctx) => ev.winner === ctx.controller && ctx.loc(ctx.self) === ev.bf, E.draw(1))]);

unitDef('cf-tianna', 'TiannaLike(3)', 3, 3, 'While I\'m at a battlefield, opponents can\'t gain points.');
card('cf-tianna', 'While I\'m at a battlefield, opponents can\'t gain points.', [rule('cantGainPoints', (ctx, p: PlayerId) => ctx.atBattlefield(ctx.self) && ctx.isOpponent(p))]);
unitDef('cf-conquerdraw', 'ConquerDraw(3)', 3, 3, 'When I conquer, draw 1.');
card('cf-conquerdraw', 'When I conquer, draw 1.', [when('conquer', (ev, ctx) => ev.player === ctx.controller && ((ev.units as ObjId[] | undefined) ?? []).includes(ctx.self), E.draw(1))]);

bfDef('cf-bf-monument', 'MonumentLike', 'Players can\'t score here until their third turn.');
card('cf-bf-monument', 'Players can\'t score here until their third turn.', [rule('cantScore', (ctx, p: PlayerId, bf: number) => bf === ctx.bfIndex() && (ctx.g.players[p].turnsTaken + (ctx.g.activePlayer === p ? 1 : 0)) < 3)]);

unitDef('cf-ezreal', 'EzrealLike(2)', 2, 2, 'Optional additional costs you pay cost [1] or [A] less.');
card('cf-ezreal', 'Optional additional costs you pay cost [1] or [A] less.', [
  costMod((ctx, id) => ctx.g.objects[id]?.controller === ctx.controller || ctx.g.objects[id]?.owner === ctx.controller, { energy: -1 }, { scope: 'additional' }),
  costMod((ctx, id) => ctx.g.objects[id]?.controller === ctx.controller || ctx.g.objects[id]?.owner === ctx.controller, { energy: -1 }, { scope: 'repeat' }),
]);

spellDef('cf-mobilize', 'MobilizeLike', 1, 'Channel 1 rune exhausted. If you can\'t, draw 1.');
card('cf-mobilize', 'Channel 1 rune exhausted. If you can\'t, draw 1.', [spell(ctx => { const got = ctx.channel(1, true); if (got.length === 0) ctx.draw(1); })]);
unitDef('cf-wyvern', 'WyvernLike(3)', 3, 3, 'If you would channel runes, channel that many runes plus 1 exhausted rune instead.');
card('cf-wyvern', 'If you would channel runes, channel that many runes plus 1 exhausted rune instead.', [replacement('channelRunes', (ev, ctx) => ev.player === ctx.controller, ev => ({ ...ev, extraExhausted: Number(ev.extraExhausted ?? 0) + 1 }))]);

unitDef('cf-riven', 'RivenLike(2)', 2, 2, 'When I become exhausted, draw 1.');
card('cf-riven', 'When I become exhausted, draw 1.', [when('exhaust', (ev, ctx) => ev.obj === ctx.self, E.draw(1))]);

spellDef('cf-possession', 'PossessionLike', 1, '[Action]\nChoose an enemy unit at a battlefield. Take control of it and recall it.');
card('cf-possession', '[Action]\nChoose an enemy unit at a battlefield. Take control of it and recall it.', [spell(ctx => { const t = ctx.target(0); if (t) { ctx.takeControl(t); ctx.recall(t); } }, { targets: [T.unit(F.enemy, F.atBattlefield)] })], { keywords: ['Action'] });
unitDef('cf-ekko', 'EkkoLike(3)', 3, 3, '[Action][>] [1]: Banish me, then play me to your base, ignoring my cost.');
card('cf-ekko', '[Action][>] [1]: Banish me, then play me to your base, ignoring my cost.', [activated('[1]', ctx => {
  const me = ctx.self;
  ctx.banish(me);
  if (ctx.obj(me)?.zone === 'banishment') ctx.play(me, { ignoreCost: true, destination: 'base' });
}, { timing: 'action' })]);

gearDef('cf-anvil', 'AnvilLike', 1, 'When this leaves the board, banish the top card of your Main Deck. Until your next Ending Phase, you may play that card.');
card('cf-anvil', 'When this leaves the board, banish the top card of your Main Deck. Until your next Ending Phase, you may play that card.', [when('leaveBoard', (ev, ctx) => ev.obj === ctx.self, ctx => {
  const top = ctx.deck()[0];
  if (!top) return;
  ctx.banish(top);
  ctx.allowPlay(top, 'nextEnding');
})]);
spellDef('cf-killgear', 'KillGearM', 1, 'Kill a gear.');
card('cf-killgear', 'Kill a gear.', [spell(E.kill(0), { targets: [T.gear()] })]);
spellDef('cf-killgearr', 'KillGearR', 1, '[Reaction]\nKill a gear.');
card('cf-killgearr', '[Reaction]\nKill a gear.', [spell(E.kill(0), { targets: [T.gear()] })], { keywords: ['Reaction'] });

spellDef('cf-extraturn', 'ExtraTurnM', 1, 'Take a turn after this one.');
card('cf-extraturn', 'Take a turn after this one.', [spell(ctx => ctx.extraTurn())]);

// T220 battlefield trigger
bfDef('cf-bf-movedraw', 'MoveDrawField', 'When a unit moves here, draw 1.');
card('cf-bf-movedraw', 'When a unit moves here, draw 1.', [when('move', (ev, ctx) => ev.to === ctx.bfIndex(), E.draw(1))]);

// T209 Stellacorn-like
unitDef('cf-stellacorn', 'StellacornLike(2)', 2, 2, 'When I move, draw 1.');
card('cf-stellacorn', 'When I move, draw 1.', [onMove(E.draw(1))]);


// T019 observation point: optional trigger at the start of the Beginning Phase
unitDef('cf-beginmay', 'BeginMay', 1, 1, 'At the start of your Beginning Phase, you may draw 1.');
card('cf-beginmay', 'At the start of your Beginning Phase, you may draw 1.', [when('beginningPhase', (ev, ctx) => ev.player === ctx.controller, E.draw(1), { optional: true })]);

// T105 / T106
spellDef('cf-drawscore', 'DrawThenScore', 1, 'Draw 1. Then score 1 point.');
card('cf-drawscore', 'Draw 1. Then score 1 point.', [spell(E.seq(E.draw(1), E.points(1)))]);
spellDef('cf-scoredraw', 'ScoreThenDraw', 1, 'Score 1 point. Then draw 1.');
card('cf-scoredraw', 'Score 1 point. Then draw 1.', [spell(E.seq(E.points(1), E.draw(1)))]);

// T176 uncounterable + Abandon
gearDef('cf-uncounter', 'NoCounterAura', 1, 'Your spells can\'t be countered.');
card('cf-uncounter', 'Your spells can\'t be countered.', [rule('cantBeCountered', (ctx, itemId: string) => ctx.g.chain.find(c => c.id === itemId)?.controller === ctx.controller)]);
spellDef('cf-abandon', 'AbandonLike', 2, '[Reaction]\nCounter a spell. Return it to its owner\'s hand instead of putting it in their trash.\n[Predict].');
card('cf-abandon', '[Reaction]\nCounter a spell. Return it to its owner\'s hand instead of putting it in their trash.\n[Predict].', [spell(ctx => { const t = ctx.target(0); if (t) ctx.counterReturn(t); ctx.predict(1); }, { targets: [T.chainItem((c, id) => c.g.chain.find(x => x.id === id)?.kind === 'spell')] })], { keywords: ['Reaction'] });

// T099 hold trigger on a unit
unitDef('cf-holddraw', 'HoldDraw(2)', 2, 2, 'When I hold, draw 1.');
card('cf-holddraw', 'When I hold, draw 1.', [when('hold', (ev, ctx) => ev.player === ctx.controller && ((ev.units as ObjId[] | undefined) ?? []).includes(ctx.self), E.draw(1))]);

// ------------------------------------------------------------------------------------------------
// exports
// ------------------------------------------------------------------------------------------------

/** All conformance fixture card definitions (fresh copy). */
export function fixtureDb(): Record<CardId, CardDef> { return { ...DB }; }

/** Card id for a fixture name ("V(3)", "ZapR", "Tank(2)", ...) or an id ("cf-v3"). */
export function cid(nameOrId: string): CardId {
  if (DB[nameOrId]) return nameOrId;
  const id = BY_NAME[nameOrId];
  if (!id) throw new Error(`unknown conformance fixture card "${nameOrId}"`);
  return id;
}

export type { Ctx, GameEvent };

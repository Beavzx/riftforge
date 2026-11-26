// BASICS synthetic cards (ids prefixed "bx-"). Small, effect-neutral cards for the everyday-play matrix
// (tests/basics/matrix.ts): one card per (card kind × cost shape), activated-ability sources per cost shape,
// free Add sources, and the turn-moment helpers (0-cost spells, start/end-of-turn triggers).
//
// Owned by the BASICS agent. Not real cards. Scripts register on import.
import type { CardDef, CardId, CardType, Domain } from '../../src/engine/types.ts';
import { card, spell, activated, mana, cost, E, T, when, atEndOfTurn, onPlay, type Ctx } from '../../src/cards/dsl.ts';
import type { PowerSym } from '../../src/engine/abilities.ts';

export const BX: Record<CardId, CardDef> = {};

function def(id: string, name: string, type: CardType, o: Partial<CardDef> = {}): CardDef {
  const d: CardDef = { id, name, type, supertypes: [], tags: [], domains: ['Fury'], energy: null, power: null, might: null, keywords: [], text: '', set: 'bx', rarity: 'Common', ...o };
  BX[id] = d;
  return d;
}

// ------------------------------------------------------------------------------------------------
// cost shapes (printed costs) — expected totals are computed by matrix.ts from the rules, not here
// ------------------------------------------------------------------------------------------------

export type CardShape =
  | 'zero' | 'energy' | 'power1' | 'power2' | 'powerMulti' | 'powerAny' | 'energyPower'
  | 'reducedZero' | 'reducedPart' | 'accelYes' | 'accelNo' | 'repeatYes' | 'repeatNo' | 'variable';

export const PRINTED: Record<CardShape, { energy: number; power: number; domains: Domain[] }> = {
  zero: { energy: 0, power: 0, domains: ['Fury'] },
  energy: { energy: 2, power: 0, domains: ['Fury'] },
  power1: { energy: 0, power: 1, domains: ['Fury'] },
  power2: { energy: 0, power: 2, domains: ['Fury'] },
  powerMulti: { energy: 0, power: 1, domains: ['Fury', 'Calm'] },
  powerAny: { energy: 0, power: 1, domains: ['Colorless'] },
  energyPower: { energy: 2, power: 1, domains: ['Fury'] },
  reducedZero: { energy: 2, power: 0, domains: ['Fury'] },
  reducedPart: { energy: 3, power: 1, domains: ['Fury'] },
  accelYes: { energy: 2, power: 0, domains: ['Fury'] },
  accelNo: { energy: 2, power: 0, domains: ['Fury'] },
  repeatYes: { energy: 1, power: 0, domains: ['Fury'] },
  repeatNo: { energy: 1, power: 0, domains: ['Fury'] },
  variable: { energy: 0, power: 0, domains: ['Fury'] },
};

export type CardKind = 'unitBase' | 'unitBf' | 'spellNormal' | 'spellAction' | 'spellReaction' | 'gear';
export const CARD_KINDS: CardKind[] = ['unitBase', 'unitBf', 'spellNormal', 'spellAction', 'spellReaction', 'gear'];

export function shapesFor(k: CardKind): CardShape[] {
  const common: CardShape[] = ['zero', 'energy', 'power1', 'power2', 'powerMulti', 'powerAny', 'energyPower', 'reducedZero', 'reducedPart'];
  if (k === 'unitBase' || k === 'unitBf') return [...common, 'accelYes', 'accelNo'];
  if (k.startsWith('spell')) return [...common, 'repeatYes', 'repeatNo', 'variable'];
  return common;
}

const kwOf = (k: CardKind): string[] => (k === 'spellAction' ? ['Action'] : k === 'spellReaction' ? ['Reaction'] : []);

/** "Pay any amount of [A] to draw that many." (resolution-time variable cost: the X-like case of CR 1.5) */
function payAnyDraw(ctx: Ctx): void {
  let max = 0;
  while (max < 12 && ctx.canPay({ energy: 0, power: new Array(max + 1).fill('A') as PowerSym[] })) max++;
  const n = max > 0 ? ctx.chooseNumber(0, max, 'Pay how much [A]? (draw that many)') : 0;
  if (n > 0 && ctx.pay({ energy: 0, power: new Array(n).fill('A') as PowerSym[] })) ctx.draw(n);
}

export function cardId(k: CardKind, s: CardShape): CardId { return `bx-${k}-${s}`; }

for (const k of CARD_KINDS) for (const s of shapesFor(k)) {
  const pr = PRINTED[s];
  const id = cardId(k, s);
  const kws = [...kwOf(k), ...(s.startsWith('accel') ? ['Accelerate'] : []), ...(s.startsWith('repeat') ? ['Repeat'] : [])];
  const kwText = kws.map(x => (x === 'Repeat' ? '[Repeat] [1]' : `[${x}]`)).join('\n');
  if (k === 'unitBase' || k === 'unitBf') {
    def(id, `BX ${k} ${s}`, 'Unit', { energy: pr.energy, power: pr.power, domains: pr.domains, might: 2, keywords: kws, text: kwText });
    if (kws.length) card(id, kwText, [], { keywords: kws as never });
  } else if (k === 'gear') {
    def(id, `BX gear ${s}`, 'Gear', { energy: pr.energy, power: pr.power, domains: pr.domains });
  } else {
    const body = s === 'variable' ? 'Pay any amount of [A] to draw that many.' : 'Draw 1.';
    const text = [kwText, body].filter(Boolean).join('\n');
    def(id, `BX ${k} ${s}`, 'Spell', { energy: pr.energy, power: pr.power, domains: pr.domains, keywords: kws, text, ...(s.startsWith('repeat') ? { keywordCosts: { Repeat: '[1]' } } : {}) });
    card(id, text, [spell(s === 'variable' ? payAnyDraw : E.draw(1))], { keywords: kws as never });
  }
}

// ------------------------------------------------------------------------------------------------
// activated-ability sources: unit abilities, legend abilities, equipment (Equip costs)
// ------------------------------------------------------------------------------------------------

export type AbilityShape = 'T' | 'E' | 'P' | 'PA' | 'EP' | 'ET' | 'PT';
export const ABILITY_COST: Record<AbilityShape, string> = { T: '[T]', E: '[2]', P: '[C]', PA: '[A]', EP: '[1][C]', ET: '[1], [T]', PT: '[C], [T]' };
export const ABILITY_SHAPES: AbilityShape[] = ['T', 'E', 'P', 'PA', 'EP', 'ET', 'PT'];

for (const s of ABILITY_SHAPES) {
  const txt = `${ABILITY_COST[s]}: Draw 1.`;
  def(`bx-actu-${s}`, `BX ability unit ${s}`, 'Unit', { energy: 1, power: 0, might: 2, text: txt });
  card(`bx-actu-${s}`, txt, [activated(cost(ABILITY_COST[s]), E.draw(1))]);
  const rtxt = `[Reaction][>] ${ABILITY_COST[s]}: Draw 1.`;
  def(`bx-actr-${s}`, `BX reaction ability unit ${s}`, 'Unit', { energy: 1, power: 0, might: 2, text: rtxt });
  card(`bx-actr-${s}`, rtxt, [activated(cost(ABILITY_COST[s]), E.draw(1), { timing: 'reaction' })]);
  def(`bx-legend-${s}`, `BX Legend ${s}`, 'Legend', { domains: ['Fury', 'Chaos'], tags: ['Tester'], text: txt });
  card(`bx-legend-${s}`, txt, [activated(cost(ABILITY_COST[s]), E.draw(1))]);
}

export type EquipShape = 'E' | 'P' | 'PA' | 'EP';
export const EQUIP_COST: Record<EquipShape, string> = { E: '[1]', P: '[C]', PA: '[A]', EP: '[1][C]' };
export const EQUIP_SHAPES: EquipShape[] = ['E', 'P', 'PA', 'EP'];
for (const s of EQUIP_SHAPES) {
  def(`bx-equip-${s}`, `BX Equipment ${s}`, 'Gear', { energy: 1, power: 0, might: 1, tags: ['Equipment'], keywords: ['Equip'], keywordCosts: { Equip: EQUIP_COST[s] }, text: `[Equip] ${EQUIP_COST[s]}` });
}

// ------------------------------------------------------------------------------------------------
// hidden cards (hide for [A], flip later ignoring the base cost; additional costs still apply)
// ------------------------------------------------------------------------------------------------

export type HiddenShape = 'energy' | 'power1' | 'energyPower' | 'accel';
export const HIDDEN_SHAPES: HiddenShape[] = ['energy', 'power1', 'energyPower', 'accel'];
const HP: Record<HiddenShape, { energy: number; power: number }> = { energy: { energy: 3, power: 0 }, power1: { energy: 0, power: 1 }, energyPower: { energy: 2, power: 1 }, accel: { energy: 2, power: 0 } };
for (const s of HIDDEN_SHAPES) {
  const ukw = s === 'accel' ? ['Hidden', 'Accelerate'] : ['Hidden'];
  const ut = ukw.map(k => `[${k}]`).join('\n');
  def(`bx-hidu-${s}`, `BX hidden unit ${s}`, 'Unit', { ...HP[s], might: 2, keywords: ukw, text: ut });
  card(`bx-hidu-${s}`, ut, [], { keywords: ukw as never });
  if (s !== 'accel') {
    const st = '[Hidden]\nDraw 1.';
    def(`bx-hids-${s}`, `BX hidden spell ${s}`, 'Spell', { ...HP[s], keywords: ['Hidden'], text: st });
    card(`bx-hids-${s}`, st, [spell(E.draw(1))], { keywords: ['Hidden'] as never });
  }
}

// ------------------------------------------------------------------------------------------------
// Add sources: a free legend Add (exhaust only), a free gear Add [C] (Seal of Rage shape). Gold is cf-gold.
// ------------------------------------------------------------------------------------------------

def('bx-legend-add1', 'BX Legend Add1', 'Legend', { domains: ['Fury', 'Chaos'], tags: ['Tester'], text: '[Reaction][>] [T]: [Add] [1].' });
card('bx-legend-add1', '[Reaction][>] [T]: [Add] [1].', [mana(cost('[T]'), { energy: 1 })]);
def('bx-seal', 'BX Seal', 'Gear', { energy: 0, power: 1, domains: ['Fury'], text: '[T]: [Reaction] — [Add] [C].' });
card('bx-seal', '[T]: [Reaction] — [Add] [C].', [mana(cost('[T]'), { power: ['C'] })]);

// ------------------------------------------------------------------------------------------------
// moment helpers
// ------------------------------------------------------------------------------------------------

def('bx-spell0', 'BX Spell0', 'Spell', { energy: 0, power: 0, text: 'Draw 1.' });
card('bx-spell0', 'Draw 1.', [spell(E.draw(1))]);
def('bx-action0', 'BX Action0', 'Spell', { energy: 0, power: 0, keywords: ['Action'], text: '[Action]\nDraw 1.' });
card('bx-action0', '[Action]\nDraw 1.', [spell(E.draw(1))], { keywords: ['Action'] as never });
def('bx-eot', 'BX EOT', 'Gear', { energy: 0, power: 0, text: 'At the end of your turn, draw 1.' });
card('bx-eot', 'At the end of your turn, draw 1.', [atEndOfTurn(E.draw(1))]);
def('bx-begin', 'BX Begin', 'Gear', { energy: 0, power: 0, text: 'At the start of your Beginning Phase, draw 1.' });
card('bx-begin', 'At the start of your Beginning Phase, draw 1.', [when('beginningPhase', (ev, ctx) => ev.player === ctx.controller, E.draw(1))]);
void T;

// ------------------------------------------------------------------------------------------------
// trigger costs: "When you play me, you may pay X to draw 1." (paid as the trigger goes on the chain, CR 383.3.b)
// ------------------------------------------------------------------------------------------------

export type TrigUnit = 'energy' | 'powerAny';
export type TrigCost = 'E' | 'P' | 'A';
export const TRIG_UNITS: TrigUnit[] = ['energy', 'powerAny'];
export const TRIG_COSTS: TrigCost[] = ['E', 'P', 'A'];
export const TRIG_COST_STR: Record<TrigCost, string> = { E: '[1]', P: '[C]', A: '[A]' };
for (const u of TRIG_UNITS) for (const t of TRIG_COSTS) {
  const txt = `When you play me, you may pay ${TRIG_COST_STR[t]} to draw 1.`;
  def(`bx-trigpay-${u}-${t}`, `BX trigger-cost unit ${u} ${t}`, 'Unit', { energy: u === 'energy' ? 1 : 0, power: u === 'powerAny' ? 1 : 0, domains: u === 'powerAny' ? ['Colorless'] : ['Fury'], might: 2, text: txt });
  card(`bx-trigpay-${u}-${t}`, txt, [onPlay(E.draw(1), { optional: `Pay ${TRIG_COST_STR[t]} to draw 1?`, cost: cost(TRIG_COST_STR[t]) })]);
}

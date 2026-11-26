// BASICS: systematic matrix of ordinary play. Generated, not hand-picked: every cell is
//   turn moment × card kind × cost shape × resource state
// and every cell is checked against the Core Rules (docs/rules-spec.md, CR numbers below) through the public API only
// (createGame / getLegalActions / validateAction / applyAction / getView). Board setup uses the conformance harness.
//
// Checks per cell (see runCell):
//   legality  — validateAction, getLegalActions and the rules oracle agree (timing CR 307-313 / 310.1.a / 159.2 / 811;
//               cost CR 356-357; destination CR 355.2); an illegal action is refused by applyAction
//   payment   — the state after auto-pay is the best a skilled player could get (oracle.ts: fewest recycles / Gold, then the
//               most energy and power left; pool used before runes); the cost is paid in full (never less)
//   optional  — an optional additional cost (Accelerate CR 805, Repeat CR 820) is offered iff it is affordable (CR 355.1, 355.16)
//   priority  — who acts next: permanents resolve at once (CR 337.2, 359.2), spells/abilities wait on the chain with their
//               controller holding priority (CR 338.1.a.5), Add abilities don't use the chain (CR 430.2), focus passes after
//               a played card's chain in a showdown (CR 340.2.a, 346), priority after resolution goes to the controller of
//               the newest remaining item (CR 340)
//   effect    — the card ended where the rules put it (units exhausted unless Accelerate CR 359.2/805, gear ready at base
//               CR 149, facedown at the battlefield CR 811, equipment attached CR 818) and its text happened
//   view      — getView: legal list = getLegalActions, pending details only for the deciding player, pool / runes / chain
//               public, hand and facedown cards hidden from the opponent (CR 125-130, 811.5)
import { assert, S0, P0, P1, BF_A, act, touch, setRunes, addRunes, control, realCard, type RuneDomain } from '../conformance/harness.ts';
import { place } from '../../src/engine/testkit.ts';
import { applyAction, getLegalActions, validateAction, getView } from '../../src/engine/index.ts';
import type { Action, CardDef, Domain, GameState, ObjId, PlayerId } from '../../src/engine/types.ts';
import { BX, PRINTED, CARD_KINDS, shapesFor, cardId, ABILITY_COST, ABILITY_SHAPES, EQUIP_COST, EQUIP_SHAPES, HIDDEN_SHAPES, TRIG_UNITS, TRIG_COSTS, TRIG_COST_STR, type CardKind, type CardShape, type AbilityShape, type EquipShape, type HiddenShape, type TrigUnit, type TrigCost } from './cards.ts';
import { bestPayment, cmpVec, vecStr, maxAnyPower, type Cost, type Req, type Res, type Vec, type AddR } from './oracle.ts';

export const BF_B = 1;
const opp = (p: PlayerId): PlayerId => (p === P0 ? P1 : P0);

// ------------------------------------------------------------------------------------------------
// axes
// ------------------------------------------------------------------------------------------------

export type Moment =
  | 'first' | 'afterPlay' | 'afterFloatE' | 'afterFloatP' | 'ownChain' | 'oppChain' | 'showdownFocus' | 'showdownNoFocus'
  | 'showdownChain' | 'showdownLast' | 'oppShowdownFocus' | 'endingChain' | 'beginningChain' | 'oppMain' | 'afterPowerPlay' | 'combatAttack' | 'combatDefend';
export const MOMENTS: Moment[] = ['first', 'afterPlay', 'afterPowerPlay', 'afterFloatE', 'afterFloatP', 'ownChain', 'oppChain', 'showdownFocus', 'showdownNoFocus', 'showdownChain', 'showdownLast', 'oppShowdownFocus', 'endingChain', 'beginningChain', 'oppMain', 'combatAttack', 'combatDefend'];
type Window = 'main' | 'chain' | 'showdown' | null;
/** What the actor (P0) may do at each moment (CR 307-313 turn states; 312.2 priority; 313 focus). */
export const WINDOW: Record<Moment, Window> = {
  first: 'main', afterPlay: 'main', afterPowerPlay: 'main', afterFloatE: 'main', afterFloatP: 'main',
  ownChain: 'chain', oppChain: 'chain', showdownChain: 'chain', endingChain: 'chain', beginningChain: 'chain',
  showdownFocus: 'showdown', showdownLast: 'showdown', oppShowdownFocus: 'showdown', showdownNoFocus: null, oppMain: null, combatAttack: 'showdown', combatDefend: 'showdown',
};

export type ResState = 'plenty' | 'someExhausted' | 'exact' | 'short' | 'wrongDomain' | 'floatE' | 'floatP' | 'goldNeeded' | 'goldSpare' | 'legendAdd' | 'sealAdd' | 'legendSpellsA' | 'legendShowdownE';
export const RES_STATES: ResState[] = ['plenty', 'someExhausted', 'exact', 'short', 'wrongDomain', 'floatE', 'floatP', 'goldNeeded', 'goldSpare', 'legendAdd', 'sealAdd', 'legendSpellsA', 'legendShowdownE'];
/** real restricted legend Add abilities: Daughter of the Void "[T]: Add [A]. Use only to play spells.", Scorn of the Moon "[T]: Add [1]. Spend this Energy only during showdowns." */
const LEGEND_SPELLS_A = 'Daughter of the Void', LEGEND_SHOWDOWN_E = 'Scorn of the Moon';

export type Timing = 'normal' | 'action' | 'reaction' | 'mainOnly';
export type Purpose = 'spell' | 'unit' | 'gear' | 'ability' | 'hide' | 'other';
function purposeOf(k: Kind): Purpose {
  switch (k.k) {
    case 'card': return k.kind.startsWith('spell') ? 'spell' : k.kind === 'gear' ? 'gear' : 'unit';
    case 'flip': return k.spell ? 'spell' : 'unit';
    case 'hide': return 'hide';
    case 'trigpay': return 'unit';
    case 'move': return 'other';
    case 'abilityUnit': case 'abilityLegend': case 'equip': return 'ability';
    case 'rune': return 'other';
    case 'real': { if (k.via === 'activate' || k.via === 'equip') return 'ability'; if (k.via === 'hide') return 'hide'; const t = realCard(k.name).type; return t === 'Spell' ? 'spell' : t === 'Gear' ? 'gear' : 'unit'; }
  }
}
export type Kind =
  | { k: 'card'; kind: CardKind; shape: CardShape; openBf?: boolean }
  | { k: 'abilityUnit'; shape: AbilityShape; reaction: boolean; exhausted?: boolean }
  | { k: 'abilityLegend'; shape: AbilityShape; exhausted?: boolean }
  | { k: 'equip'; shape: EquipShape }
  | { k: 'hide'; shape: HiddenShape; spell: boolean; where?: 'open' | 'occupied' }
  | { k: 'flip'; shape: HiddenShape; spell: boolean; accel?: 'yes' | 'no'; sameTurn?: boolean }
  | { k: 'trigpay'; unit: TrigUnit; trig: TrigCost }
  | { k: 'move'; route: 'baseToOpen' | 'baseToOwn' | 'bfToBase' | 'exhaustedUnit' | 'bfToBf' }
  | { k: 'rune'; ability: 950 | 951 }
  | { k: 'real'; name: string; role: string; dest?: 'base' | 'bf'; via?: 'play' | 'activate' | 'equip' | 'hide' | 'flip'; answer?: 'yes' | 'no'; abilityIndex?: number };

export interface Cell { id: string; moment: Moment; kind: Kind; res: ResState }

export function kindLabel(k: Kind): string {
  switch (k.k) {
    case 'card': return `${k.openBf ? 'unitToOpenBf' : k.kind}/${k.shape}`;
    case 'abilityUnit': return `ability${k.reaction ? 'R' : ''}/${k.shape}${k.exhausted ? '-sourceExhausted' : ''}`;
    case 'abilityLegend': return `legend/${k.shape}${k.exhausted ? '-exhausted' : ''}`;
    case 'equip': return `equip/${k.shape}`;
    case 'hide': return `hide${k.spell ? 'Spell' : 'Unit'}/${k.shape}${k.where ? `-${k.where}Bf` : ''}`;
    case 'flip': return `flip${k.spell ? 'Spell' : 'Unit'}/${k.shape}${k.accel ? `-accel${k.accel}` : ''}${k.sameTurn ? '-sameTurn' : ''}`;
    case 'trigpay': return `playTriggerCost/${k.unit}+${k.trig}`;
    case 'move': return `standardMove/${k.route}`;
    case 'rune': return `rune/${k.ability === 950 ? 'exhaust' : 'recycle'}`;
    case 'real': return `real/${k.role}:${k.name}${k.answer ? `-${k.answer}` : ''}`;
  }
}

/** Every synthetic kind (cards × their shapes, abilities × shapes, equip, hide, flip, runes). */
export function syntheticKinds(): Kind[] {
  const out: Kind[] = [];
  for (const kind of CARD_KINDS) for (const shape of shapesFor(kind)) out.push({ k: 'card', kind, shape });
  for (const shape of ['zero', 'energy', 'power1'] as CardShape[]) out.push({ k: 'card', kind: 'unitBf', shape, openBf: true });   // CR 355.2
  for (const shape of ABILITY_SHAPES) { out.push({ k: 'abilityUnit', shape, reaction: false }); out.push({ k: 'abilityUnit', shape, reaction: true }); out.push({ k: 'abilityLegend', shape }); }
  // an exhausted source can't pay [T] (CR 203.3); a unit played this turn is exhausted (CR 359.2)
  for (const shape of ['T', 'ET', 'E'] as AbilityShape[]) { out.push({ k: 'abilityUnit', shape, reaction: true, exhausted: true }); out.push({ k: 'abilityLegend', shape, exhausted: true }); }
  for (const shape of EQUIP_SHAPES) out.push({ k: 'equip', shape });
  for (const shape of HIDDEN_SHAPES) {
    out.push({ k: 'hide', shape, spell: false });
    if (shape !== 'accel') { out.push({ k: 'hide', shape, spell: true }); out.push({ k: 'flip', shape, spell: true }); out.push({ k: 'flip', shape, spell: false }); }
    else { out.push({ k: 'flip', shape, spell: false, accel: 'yes' }); out.push({ k: 'flip', shape, spell: false, accel: 'no' }); }
  }
  out.push({ k: 'hide', shape: 'energy', spell: false, where: 'open' }, { k: 'hide', shape: 'energy', spell: false, where: 'occupied' });   // CR 811.1: a battlefield you control, empty facedown zone
  out.push({ k: 'flip', shape: 'energy', spell: false, sameTurn: true }, { k: 'flip', shape: 'energy', spell: true, sameTurn: true });   // CR 811: never the turn it was hidden
  for (const unit of TRIG_UNITS) for (const trig of TRIG_COSTS) out.push({ k: 'trigpay', unit, trig });
  out.push({ k: 'rune', ability: 950 }, { k: 'rune', ability: 951 });
  for (const route of ['baseToOpen', 'baseToOwn', 'bfToBase', 'exhaustedUnit', 'bfToBf'] as const) out.push({ k: 'move', route });
  return out;
}

/** One real card per kind (data/cards.json), resource-neutral ones. */
export const REAL_KINDS: Kind[] = [
  { k: 'real', name: 'Staunch Survivor', role: 'unit', dest: 'base' },             // Unit Body 2 + [C]
  { k: 'real', name: 'Staunch Survivor', role: 'unitBf', dest: 'bf' },
  { k: 'real', name: 'Seal of Rage', role: 'gear' },                               // Gear Fury [0][C] — the reported case
  { k: 'real', name: 'Fanfare', role: 'spell' },                                   // Spell Mind 3
  { k: 'real', name: 'Brawl', role: 'action' },                                    // [Action] Fury 3 + [C], targets a unit
  { k: 'real', name: 'Hunker Down', role: 'reaction' },                            // [Reaction] Calm 1, targets a friendly unit
  { k: 'real', name: 'Called Shot', role: 'actionRepeat', answer: 'yes' },        // [Action] Chaos [0][C], [Repeat] [C]
  { k: 'real', name: 'Called Shot', role: 'actionRepeat', answer: 'no' },
  { k: 'real', name: 'War Scout', role: 'accelerate', dest: 'base', answer: 'yes' },  // Fury 3, [Accelerate]
  { k: 'real', name: 'War Scout', role: 'accelerate', dest: 'base', answer: 'no' },
  { k: 'real', name: 'Pendulum Blade', role: 'equip', via: 'equip' },             // Gear Fury, [Equip] [C]
  { k: 'real', name: 'Momentary Companion', role: 'hide', via: 'hide' },          // Unit Chaos 4, [Hidden]
  { k: 'real', name: 'Momentary Companion', role: 'flip', via: 'flip' },
  { k: 'real', name: 'rad-112-167', role: 'unitAbility', via: 'activate', abilityIndex: 0 },  // Ziggs, Explosive: [1], [T]: play a Bomb token to a battlefield
  { k: 'real', name: 'Pride of Nazumah', role: 'legendAbility', via: 'activate', abilityIndex: 0 }, // legend [1], [T]
];

// ------------------------------------------------------------------------------------------------
// rules: timing and expected costs (independent of src/engine)
// ------------------------------------------------------------------------------------------------

function timingOf(k: Kind): Timing {
  switch (k.k) {
    case 'card': return k.kind === 'spellAction' ? 'action' : k.kind === 'spellReaction' ? 'reaction' : 'normal';   // CR 159.2, 310.1.a
    case 'abilityUnit': return k.reaction ? 'reaction' : 'normal';   // CR 381: activated abilities default to normal timing
    case 'abilityLegend': return 'normal';
    case 'equip': return 'normal';        // CR 818 (keywords.md): Equip = Main phase, Neutral Open
    case 'hide': return 'mainOnly';       // CR 811: hiding is a Neutral Open, own-turn action
    case 'flip': return 'reaction';       // CR 811: a facedown card has Reaction from the next turn on
    case 'rune': return 'reaction';       // CR 164.2 / 430.3: rune Add abilities are Reaction-speed
    case 'trigpay': return 'normal';
    case 'move': return 'mainOnly';      // CR 144: Main phase, Neutral Open
    case 'real': {
      const d = realCard(k.name);
      if (k.via === 'hide') return 'mainOnly';
      if (k.via === 'flip') return 'reaction';
      if (k.via === 'activate' || k.via === 'equip') return 'normal';
      return d.keywords.includes('Reaction') ? 'reaction' : d.keywords.includes('Action') ? 'action' : 'normal';
    }
  }
}
export function timingAllows(t: Timing, w: Window): boolean {
  if (w === null) return false;
  if (w === 'main') return true;                                      // own Main phase, Neutral Open: anything (CR 310.1.a)
  if (t === 'mainOnly' || t === 'normal') return false;
  if (w === 'showdown') return t === 'action' || t === 'reaction';    // Showdown Open: Action / Reaction (CR 159.2.a)
  return t === 'reaction';                                            // Closed: Reaction only (CR 159.2.b, 358.4)
}

const reqOf = (domains: Domain[]): Req => { const d = domains.filter(x => x !== 'Colorless'); return d.length ? d : 'any'; };   // CR 135.2.e.6
const printedCost = (energy: number, power: number, domains: Domain[]): Cost => ({ energy, power: new Array(power).fill(0).map(() => reqOf(domains)) });
const plus = (a: Cost, b: Cost): Cost => ({ energy: a.energy + b.energy, power: [...a.power, ...b.power] });
function parseCostStr(s: string, domains: Domain[]): Cost {
  const c: Cost = { energy: 0, power: [] };
  for (const m of s.matchAll(/\[(\d+|C|A)\]/g)) {
    if (m[1] === 'C') c.power.push(reqOf(domains)); else if (m[1] === 'A') c.power.push('any'); else c.energy += Number(m[1]);
  }
  return c;
}

export interface Expect {
  /** resource cost paid as the action is taken (energy + power) */
  cost: Cost;
  /** cost the builder sizes resources for (incl. an optional cost, so "exact" can afford it) */
  target: Cost;
  /** optional additional cost: its resources, and whether the player answers yes */
  optional?: { extra: Cost; answer: boolean };
  exhaustSelf?: boolean;
  /** what the action is */
  cls: 'permanent' | 'chainItem' | 'add' | 'hide' | 'move';
  /** "pay any amount of [A]" on resolution */
  variable?: boolean;
  /** draws on resolution */
  draws?: number;
  /** the optional cost belongs to a play trigger (paid as it goes on the chain, after the card) */
  trigger?: boolean;
}

function expectFor(k: Kind): Expect {
  switch (k.k) {
    case 'card': {
      const pr = PRINTED[k.shape];
      let c = printedCost(pr.energy, pr.power, pr.domains);
      if (k.shape === 'reducedZero' || k.shape === 'reducedPart') c = { ...c, energy: Math.max(0, c.energy - 2) };   // CR 356.4, 356.6
      const perm = k.kind === 'unitBase' || k.kind === 'unitBf' || k.kind === 'gear';
      const e: Expect = { cost: c, target: c, cls: perm ? 'permanent' : 'chainItem', draws: perm ? 0 : 1 };
      if (k.shape === 'accelYes' || k.shape === 'accelNo') e.optional = { extra: printedCost(1, 1, pr.domains), answer: k.shape === 'accelYes' };   // CR 805: [1][C]
      if (k.shape === 'repeatYes' || k.shape === 'repeatNo') e.optional = { extra: { energy: 1, power: [] }, answer: k.shape === 'repeatYes' };   // CR 820
      if (e.optional) e.target = plus(c, e.optional.extra);
      if (k.shape === 'variable') { e.variable = true; e.target = { energy: 0, power: ['any', 'any'] }; e.draws = undefined; }
      return e;
    }
    case 'abilityUnit': case 'abilityLegend': {
      const doms: Domain[] = k.k === 'abilityLegend' ? ['Fury', 'Chaos'] : ['Fury'];
      const c = parseCostStr(ABILITY_COST[k.shape], doms);
      return { cost: c, target: c, cls: 'chainItem', exhaustSelf: ABILITY_COST[k.shape].includes('[T]'), draws: 1 };
    }
    case 'equip': { const c = parseCostStr(EQUIP_COST[k.shape], ['Fury']); return { cost: c, target: c, cls: 'chainItem', draws: 0 }; }
    case 'hide': return { cost: { energy: 0, power: ['any'] }, target: { energy: 0, power: ['any'] }, cls: 'hide' };   // CR 811: hide for [A]
    case 'flip': {
      const e: Expect = { cost: { energy: 0, power: [] }, target: { energy: 0, power: [] }, cls: k.spell ? 'chainItem' : 'permanent', draws: k.spell ? 1 : 0 };   // ignoring its base cost
      if (k.accel) { e.optional = { extra: printedCost(1, 1, ['Fury']), answer: k.accel === 'yes' }; e.target = e.optional.extra; }   // additional costs still apply
      return e;
    }
    case 'rune': return { cost: { energy: 0, power: [] }, target: { energy: 0, power: [] }, cls: 'add' };
    case 'move': return { cost: { energy: 0, power: [] }, target: { energy: 0, power: [] }, cls: 'move' };
    case 'trigpay': {
      const c = k.unit === 'energy' ? { energy: 1, power: [] } : { energy: 0, power: ['any' as Req] };
      const extra = parseCostStr(TRIG_COST_STR[k.trig], k.unit === 'powerAny' ? ['Colorless'] : ['Fury']);   // [C] on a domainless card = [A] (CR 135.2.e.6)
      return { cost: c, target: plus(c, extra), optional: { extra, answer: true }, cls: 'permanent', trigger: true };
    }
    case 'real': {
      const d = realCard(k.name);
      if (k.via === 'hide') return { cost: { energy: 0, power: ['any'] }, target: { energy: 0, power: ['any'] }, cls: 'hide' };
      if (k.via === 'flip') return { cost: { energy: 0, power: [] }, target: { energy: 0, power: [] }, cls: 'permanent' };
      if (k.via === 'equip') { const c = parseCostStr(d.keywordCosts?.Equip ?? '', d.domains); return { cost: c, target: c, cls: 'chainItem' }; }
      if (k.via === 'activate') { const c = parseCostStr(d.text.split(':')[0], d.domains); return { cost: c, target: c, cls: 'chainItem', exhaustSelf: /\[T\]/.test(d.text.split(':')[0]) }; }
      const c = printedCost(d.energy ?? 0, d.power ?? 0, d.domains);
      const e: Expect = { cost: c, target: c, cls: d.type === 'Spell' ? 'chainItem' : 'permanent' };
      if (k.role === 'accelerate') e.optional = { extra: printedCost(1, 1, d.domains), answer: k.answer === 'yes' };
      if (k.role === 'actionRepeat') e.optional = { extra: parseCostStr(d.keywordCosts?.Repeat ?? '[C]', d.domains), answer: k.answer === 'yes' };
      if (e.optional) e.target = plus(c, e.optional.extra);
      return e;
    }
  }
}

// ------------------------------------------------------------------------------------------------
// moments (built through the public API, cached)
// ------------------------------------------------------------------------------------------------

interface Base { g: GameState; u0: ObjId; holder: ObjId; enemy: ObjId }
const BASES = new Map<Moment, Base>();

function withDefs(g: GameState, extra: CardDef[] = []): void {
  g.cards = { ...g.cards, ...BX };
  for (const d of extra) g.cards[d.id] = d;
}
const REAL_DEFS = () => [...new Set([...REAL_KINDS.map(k => (k as { name: string }).name), LEGEND_SPELLS_A, LEGEND_SHOWDOWN_E])].map(n => realCard(n));

function freshBase(tp: PlayerId): Base {
  const g = S0({ tp });
  withDefs(g, REAL_DEFS());
  const u0 = place(g, P0, 'cf-v2', 'base');                 // a friendly unit (equip / ability targets)
  const holder = place(g, P0, 'cf-v1', BF_B);                // P0 controls BF-B (unit-to-battlefield, hide, flip)
  control(g, BF_B, P0);
  const enemy = place(g, P1, 'cf-v1', 'base');
  touch(g);
  return { g, u0, holder, enemy };
}
const playNow = (g: GameState, p: PlayerId, card: string, dest?: 'base'): GameState => {
  const id = place(g, p, card, 'hand');
  return act(g, { type: 'playCard', player: p, obj: id, ...(dest ? { destination: dest } : {}) });
};
const pass = (g: GameState): GameState => act(g, { type: 'pass', player: g.pending!.player });

export function momentBase(m: Moment): Base {
  const hit = BASES.get(m);
  if (hit) return hit;
  const tp = ['oppChain', 'oppShowdownFocus', 'beginningChain', 'oppMain', 'combatDefend'].includes(m) ? P1 : P0;
  const b = freshBase(tp);
  let g = b.g;
  const firstRune = () => g.players[P0].runesInPlay[0];
  switch (m) {
    case 'first': case 'oppMain': break;
    case 'afterPlay': g = playNow(g, P0, 'cf-v0', 'base'); break;
    // the reported case: first play of the turn costs only power — auto-pay exhausts the ready rune it recycles, so [1] floats (#65)
    case 'afterPowerPlay': setRunes(g, P0, 2, 'fury'); g = playNow(g, P0, cardId('gear', 'power1'), 'base'); break;
    case 'afterFloatE': g = playNow(g, P0, 'cf-v0', 'base'); g = act(g, { type: 'activate', player: P0, obj: firstRune(), abilityIndex: 950 }); break;
    case 'afterFloatP': g = playNow(g, P0, 'cf-v0', 'base'); g = act(g, { type: 'activate', player: P0, obj: firstRune(), abilityIndex: 951 }); break;
    case 'ownChain': g = playNow(g, P0, 'bx-spell0'); break;
    case 'oppChain': g = playNow(g, P1, 'bx-spell0'); g = pass(g); break;
    case 'showdownFocus': case 'showdownNoFocus': case 'showdownChain': case 'showdownLast': {
      const mover = place(g, P0, 'cf-v1', 'base');
      g = act(g, { type: 'move', player: P0, units: [mover], to: BF_A });
      if (m === 'showdownNoFocus' || m === 'showdownChain') g = pass(g);
      if (m === 'showdownChain') { g = playNow(g, P1, 'bx-action0'); g = pass(g); }
      if (m === 'showdownLast') { g = playNow(g, P0, 'bx-action0'); g = pass(g); g = pass(g); g = pass(g); }
      break;
    }
    case 'oppShowdownFocus': { const mv = place(g, P1, 'cf-v1', 'base'); g = act(g, { type: 'move', player: P1, units: [mv], to: BF_A }); g = pass(g); break; }
    // combat (CR 461-466): the attacker has focus first; the defender gets it when the attacker passes
    case 'combatAttack': { place(g, P1, 'cf-v1', BF_A); control(g, BF_A, P1); const a = place(g, P0, 'cf-v3', 'base'); g = act(g, { type: 'move', player: P0, units: [a], to: BF_A }); break; }
    case 'combatDefend': { const a = place(g, P1, 'cf-v3', 'base'); g = act(g, { type: 'move', player: P1, units: [a], to: BF_B }); g = pass(g); break; }
    case 'endingChain': place(g, P0, 'bx-eot', 'base'); g = act(g, { type: 'endTurn', player: P0 }); break;
    case 'beginningChain': place(g, P0, 'bx-begin', 'base'); g = act(g, { type: 'endTurn', player: P1 }); break;
  }
  // sanity: the moment is what it claims (else every cell of it would be meaningless)
  const d = g.pending!;
  const w = WINDOW[m];
  assert.ok(d && !d.inStep && !g.ex.unit, `moment ${m}: quiescent top-level decision expected, got ${d?.kind}`);
  if (w === 'main') assert.equal(d.kind, 'mainAction');
  if (w === 'chain') assert.ok(d.kind === 'chainResponse' && d.player === P0 && g.priority === P0, `moment ${m}: P0 priority on a chain`);
  if (w === 'showdown') assert.ok(d.kind === 'showdownAction' && d.player === P0 && g.showdown?.focus === P0, `moment ${m}: P0 focus`);
  if (m === 'showdownLast' || m === 'oppShowdownFocus') assert.deepEqual(g.showdown!.passes, [P1], `moment ${m}: P0's pass would end the showdown`);
  if (w === null) assert.ok(d.player === P1 && (m === 'oppMain' ? d.kind === 'mainAction' : g.showdown?.focus === P1), `moment ${m}: P1 acts`);
  if (m === 'endingChain') assert.equal(g.phase, 'end');
  if (m === 'combatAttack' || m === 'combatDefend') assert.ok(g.showdown?.isCombat && g.showdown.attacker === (m === 'combatAttack' ? P0 : P1), `${m}: combat`);
  if (m === 'afterPowerPlay') assert.ok(g.players[P0].pool.energy === 1 && g.players[P0].runesInPlay.length === 1 && !g.objects[g.players[P0].runesInPlay[0]].exhausted, 'afterPowerPlay: [1] floats, one ready rune left (rules-decisions #65)');
  if (m === 'beginningChain') assert.equal(g.phase, 'beginning');
  const out = { ...b, g };
  BASES.set(m, out);
  return out;
}

// ------------------------------------------------------------------------------------------------
// resources
// ------------------------------------------------------------------------------------------------

const lower = (d: Domain): RuneDomain => (d === 'Colorless' ? 'fury' : d.toLowerCase()) as RuneDomain;
const reqDomain = (r: Req): Domain => (r === 'any' ? 'Fury' : r[0]);

/** The part of `c` the pool doesn't cover (pool spent first). */
function afterPool(g: GameState, p: PlayerId, c: Cost): Cost {
  const pool = g.players[p].pool;
  const left = { ...pool.power };
  const power: Req[] = [];
  for (const r of c.power) {
    const d = Object.keys(left).find(x => (left[x as Domain] ?? 0) > 0 && (r === 'any' || r.includes(x as Domain))) as Domain | undefined;
    if (d) left[d]! -= 1; else power.push(r);
  }
  return { energy: Math.max(0, c.energy - pool.energy), power };
}

function exactRunes(g: GameState, p: PlayerId, energy: number, reqs: Req[]): void {
  const k = Math.max(energy, reqs.length);
  for (let i = 0; i < k; i++) addRunes(g, p, 1, i < reqs.length ? lower(reqDomain(reqs[i])) : 'fury');
}

/** Set P0's runes / pool / Add sources for a resource state, sized against the target cost. */
export function applyResources(g: GameState, rs: ResState, target: Cost): void {
  const p = P0;
  setRunes(g, p, 0);
  if (rs === 'floatE') g.players[p].pool.energy += 1;
  if (rs === 'floatP') { const d = target.power.length ? reqDomain(target.power[0]) : 'Fury'; g.players[p].pool.power[d] = (g.players[p].pool.power[d] ?? 0) + 1; }
  const t = afterPool(g, p, target);
  switch (rs) {
    case 'plenty': case 'goldSpare':
      addRunes(g, p, 1, 'calm');                                           // listed first: the trap for "first rune in the list"
      for (const r of t.power) addRunes(g, p, 1, lower(reqDomain(r)));
      addRunes(g, p, t.energy + 1, 'fury');
      if (rs === 'goldSpare') place(g, p, 'cf-gold', 'base', { token: true });
      break;
    case 'someExhausted':
      addRunes(g, p, 2, 'fury', false);
      for (const r of t.power) { addRunes(g, p, 1, lower(reqDomain(r)), false); addRunes(g, p, 1, lower(reqDomain(r))); }
      addRunes(g, p, t.energy, 'fury');
      break;
    case 'exact': case 'floatE': case 'floatP': exactRunes(g, p, t.energy, t.power); break;
    case 'short': {
      // one rune fewer than the minimum: energy-heavy costs lose an energy rune, power-heavy ones a power rune
      const E = t.energy, P = t.power.length;
      if (Math.max(E, P) === 0) break;
      if (E > P) exactRunes(g, p, E - 1, t.power);
      else exactRunes(g, p, Math.min(E, P - 1), t.power.slice(0, -1));
      break;
    }
    case 'wrongDomain': addRunes(g, p, t.power.length + t.energy + 2, 'order'); break;
    case 'goldNeeded': exactRunes(g, p, t.energy, t.power.slice(0, -1)); place(g, p, 'cf-gold', 'base', { token: true }); break;
    case 'legendAdd': exactRunes(g, p, Math.max(0, t.energy - 1), t.power); g.objects[g.players[p].legend].cardId = 'bx-legend-add1'; break;
    case 'legendSpellsA': exactRunes(g, p, t.energy, t.power.slice(0, -1)); g.objects[g.players[p].legend].cardId = realCard(LEGEND_SPELLS_A).id; break;
    case 'legendShowdownE': exactRunes(g, p, Math.max(0, t.energy - 1), t.power); g.objects[g.players[p].legend].cardId = realCard(LEGEND_SHOWDOWN_E).id; break;
    case 'sealAdd': {
      const i = t.power.findIndex(r => r === 'any' || r.includes('Fury'));
      exactRunes(g, p, t.energy, i >= 0 ? t.power.filter((_, j) => j !== i) : t.power);
      place(g, p, 'bx-seal', 'base');
      break;
    }
  }
  touch(g);
}

/** The oracle's view of P0's resources. */
export interface SpendCtx { purpose: Purpose; showdown: boolean }
export function resourcesOf(g: GameState, p: PlayerId, exclude?: ObjId, sc: SpendCtx = { purpose: 'other', showdown: false }): Res {
  const pl = g.players[p];
  const adds: AddR[] = [];
  for (const o of Object.values(g.objects)) {
    if (o.controller !== p || o.exhausted || o.id === exclude || !['base', 'battlefield', 'legendZone'].includes(o.zone)) continue;
    if (o.cardId === 'cf-gold') adds.push({ kind: 'gold', energy: 0, power: ['any'] });
    if (o.cardId === 'bx-legend-add1') adds.push({ kind: 'free', energy: 1, power: [] });
    if (o.cardId === 'bx-seal') adds.push({ kind: 'free', energy: 0, power: ['Fury'] });
    // restricted Adds count only where they may be spent (CR 430: "Use only to ..." / "Spend this ... only ...")
    if (g.cards[o.cardId]?.name === LEGEND_SPELLS_A && sc.purpose === 'spell') adds.push({ kind: 'free', energy: 0, power: ['any'] });
    if (g.cards[o.cardId]?.name === LEGEND_SHOWDOWN_E && sc.showdown) adds.push({ kind: 'free', energy: 1, power: [] });
  }
  return {
    poolE: pl.pool.energy, poolP: { ...pl.pool.power },
    runes: pl.runesInPlay.map(r => ({ domain: g.cards[g.objects[r].cardId].domains[0], ready: !g.objects[r].exhausted })),
    adds,
  };
}
interface Measure { runes: number; ready: number; poolE: number; poolP: number; gold: number; freeE: number; freeP: number; runeIds: ObjId[] }
function measure(g: GameState, p: PlayerId, exclude?: ObjId, sc?: SpendCtx): Measure {
  const pl = g.players[p];
  const r = resourcesOf(g, p, exclude, sc);
  let gold = 0;
  for (const o of Object.values(g.objects)) if (o.controller === p && o.cardId === 'cf-gold' && ['base', 'battlefield'].includes(o.zone)) gold++;
  return {
    runes: pl.runesInPlay.length, ready: r.runes.filter(x => x.ready).length, poolE: pl.pool.energy,
    poolP: Object.values(pl.pool.power).reduce((s, n) => s + (n ?? 0), 0), gold,
    freeE: r.adds.filter(a => a.kind === 'free').reduce((s, a) => s + a.energy, 0), freeP: r.adds.filter(a => a.kind === 'free').reduce((s, a) => s + a.power.length, 0),
    runeIds: [...pl.runesInPlay],
  };
}
function endVec(before: Measure, after: Measure): Vec {
  return { losses: before.runes - after.runes + before.gold - after.gold, energy: after.poolE + after.ready + after.freeE, power: after.poolP + after.freeP };
}

// ------------------------------------------------------------------------------------------------
// cells
// ------------------------------------------------------------------------------------------------

export function cells(kinds: Kind[], moments: Moment[] = MOMENTS, res: ResState[] = RES_STATES): Cell[] {
  const out: Cell[] = [];
  for (const moment of moments) for (const kind of kinds) for (const r of res) {
    // the legend slot is either the ability under test or the free Add legend, not both
    if ((r === 'legendAdd' || r === 'legendSpellsA' || r === 'legendShowdownE') && (kind.k === 'abilityLegend' || (kind.k === 'real' && kind.role === 'legendAbility'))) continue;
    if (kind.k === 'move' && r !== res[0]) continue;   // no cost: one resource state is enough
    out.push({ id: `${moment} | ${kindLabel(kind)} | ${r}`, moment, kind, res: r });
  }
  return out;
}

export interface Check { name: string; cat: 'legality' | 'payment' | 'optional' | 'priority' | 'effect' | 'view' | 'setup'; ok: boolean; msg: string }
export interface CellResult { cell: Cell; legal: boolean; checks: Check[]; flags: Set<string> }

interface Built { g: GameState; action: Action; src: ObjId; expect: Expect; structural: boolean; actor: PlayerId; hiddenAt?: number }

function build(cell: Cell): Built {
  const base = momentBase(cell.moment);
  const g = structuredClone(base.g);
  const k = cell.kind;
  const ex = expectFor(k);
  const p = P0;
  if (k.k === 'card' && (k.shape === 'reducedZero' || k.shape === 'reducedPart')) place(g, p, 'cf-discount2', 'base');
  // resources first (some sources are placed relative to them)
  applyResources(g, cell.res, ex.target);
  let action: Action, src: ObjId, structural = true, hiddenAt: number | undefined;
  switch (k.k) {
    case 'card': {
      src = place(g, p, cardId(k.kind, k.shape), 'hand');
      const dest = k.kind === 'unitBase' || k.kind === 'gear' ? 'base' : k.kind === 'unitBf' ? (k.openBf ? BF_A : BF_B) : undefined;
      if (k.openBf) structural = false;   // CR 355.2: base or a battlefield you control (BF-A is uncontrolled / contested)
      action = { type: 'playCard', player: p, obj: src, ...(dest !== undefined ? { destination: dest } : {}) };
      break;
    }
    case 'abilityUnit': src = place(g, p, `bx-act${k.reaction ? 'r' : 'u'}-${k.shape}`, 'base', { ready: !k.exhausted }); action = { type: 'activate', player: p, obj: src, abilityIndex: 0 }; break;
    case 'abilityLegend': src = g.players[p].legend; g.objects[src].cardId = `bx-legend-${k.shape}`; if (k.exhausted) g.objects[src].exhausted = true; action = { type: 'activate', player: p, obj: src, abilityIndex: 0 }; break;
    case 'equip': src = place(g, p, `bx-equip-${k.shape}`, 'base'); action = { type: 'activate', player: p, obj: src, abilityIndex: 900 }; break;
    case 'hide': {
      src = place(g, p, `bx-hid${k.spell ? 's' : 'u'}-${k.shape}`, 'hand');
      if (k.where === 'occupied') place(g, p, 'bx-hidu-energy', 'base', { faceDownAt: BF_B, hiddenTurn: g.turn - 1 });
      if (k.where) structural = false;
      action = { type: 'hide', player: p, obj: src, battlefieldIndex: k.where === 'open' ? BF_A : BF_B };
      break;
    }
    case 'flip': src = place(g, p, `bx-hid${k.spell ? 's' : 'u'}-${k.shape}`, 'base', { faceDownAt: BF_B, hiddenTurn: k.sameTurn ? g.turn : g.turn - 1 }); hiddenAt = BF_B; if (k.sameTurn) structural = false; action = { type: 'playCard', player: p, obj: src, ...(k.spell ? {} : { destination: BF_B }) }; break;
    case 'move': {
      // CR 144: base ↔ battlefield; battlefield → battlefield only with Ganking; the units must be ready (exhaust is the cost)
      const ex2 = k.route === 'exhaustedUnit' ? place(g, p, 'cf-v1', 'base', { ready: false }) : undefined;
      src = k.route === 'bfToBase' || k.route === 'bfToBf' ? base.holder : ex2 ?? base.u0;
      const to = k.route === 'baseToOpen' || k.route === 'bfToBf' ? BF_A : k.route === 'bfToBase' ? 'base' : BF_B;
      if (k.route === 'exhaustedUnit' || k.route === 'bfToBf') structural = false;
      action = { type: 'move', player: p, units: [src], to };
      break;
    }
    case 'trigpay': src = place(g, p, `bx-trigpay-${k.unit}-${k.trig}`, 'hand'); action = { type: 'playCard', player: p, obj: src, destination: 'base' }; break;
    case 'rune': {
      const rs = g.players[p].runesInPlay;
      src = (k.ability === 950 ? rs.find(r => !g.objects[r].exhausted) : undefined) ?? rs[0] ?? 'none';
      structural = !!g.objects[src] && (k.ability === 951 || !g.objects[src].exhausted);
      action = { type: 'activate', player: p, obj: src, abilityIndex: k.ability };
      break;
    }
    case 'real': {
      const d = realCard(k.name);
      if (k.via === 'activate') {
        if (d.type === 'Legend') { src = g.players[p].legend; g.objects[src].cardId = d.id; }
        else src = place(g, p, d.id, 'base');
        action = { type: 'activate', player: p, obj: src, abilityIndex: k.abilityIndex ?? 0 };
      } else if (k.via === 'equip') { src = place(g, p, d.id, 'base'); action = { type: 'activate', player: p, obj: src, abilityIndex: 900 }; }
      else if (k.via === 'hide') { src = place(g, p, d.id, 'hand'); action = { type: 'hide', player: p, obj: src, battlefieldIndex: BF_B }; }
      else if (k.via === 'flip') { src = place(g, p, d.id, 'base', { faceDownAt: BF_B, hiddenTurn: g.turn - 1 }); hiddenAt = BF_B; action = { type: 'playCard', player: p, obj: src, destination: BF_B }; }
      else {
        src = place(g, p, d.id, 'hand');
        const dest = d.type === 'Unit' ? (k.dest === 'bf' ? BF_B : 'base') : d.type === 'Gear' ? 'base' : undefined;
        action = { type: 'playCard', player: p, obj: src, ...(dest !== undefined ? { destination: dest } : {}) };
      }
      break;
    }
  }
  touch(g);
  return { g, action, src, expect: ex, structural, actor: p, hiddenAt };
}

const sameAction = (a: Action, b: Action): boolean => {
  if (a.type !== b.type || a.player !== b.player) return false;
  if (a.type === 'playCard' && b.type === 'playCard') return a.obj === b.obj && (a.destination ?? null) === (b.destination ?? null);
  if (a.type === 'activate' && b.type === 'activate') return a.obj === b.obj && a.abilityIndex === b.abilityIndex;
  if (a.type === 'hide' && b.type === 'hide') return a.obj === b.obj && a.battlefieldIndex === b.battlefieldIndex;
  if (a.type === 'move' && b.type === 'move') return a.to === b.to && a.units.join() === b.units.join();
  return false;
};

function checkView(g: GameState, actor: PlayerId, checks: Check[], when: string, facedown?: ObjId): void {
  const add = (name: string, ok: boolean, msg = '') => checks.push({ name: `view ${when}: ${name}`, cat: 'view', ok, msg });
  for (const p of [P0, P1] as PlayerId[]) {
    const v = getView(g, p);
    const d = g.pending;
    // UI-CANCEL (game.ts getView): while a player can still cancel a play, everyone else sees the board as it was before the
    // play began — the card being played, its choices and partial payment stay private until it finalizes
    const cf = (g.ex as { cancelFor?: PlayerId }).cancelFor;
    if (d?.inStep && cf !== undefined && cf !== p && g.ex.unit) {
      add(`P${p} sees only that P${cf} is making choices, has no legal actions`, !!v.pending && v.pending.player === d.player && !v.pending.options && v.legal.length === 0);
      const inPlay = g.chain.filter(c => c.pending && c.controller === cf).map(c => c.source);
      add(`P${p} doesn't see the card P${cf} is still playing`, inPlay.every(id => v.state.objects[id]?.cardId === 'hidden' || v.state.objects[id]?.zone !== 'chain'), inPlay.join());
      continue;
    }
    // only the player with the pending decision has legal actions (CR 312: at most one player has priority)
    if (d && d.player !== p) add(`P${p} (not deciding) has no legal actions`, v.legal.length === 0, `${v.legal.length}`);
    if (d && d.player === p) add(`P${p} sees its own decision`, !!v.pending && v.pending.kind === d.kind && JSON.stringify(v.pending.options ?? []) === JSON.stringify(d.options ?? []), `${v.pending?.kind}`);
    else if (d) add(`P${p} sees only a summary of P${d.player}'s decision`, !!v.pending && v.pending.kind === d.kind && v.pending.player === d.player && !v.pending.options, JSON.stringify(v.pending));
    const pl = g.players[actor], vp = v.state.players[actor];
    add(`P${p} sees P${actor}'s pool`, JSON.stringify(vp.pool) === JSON.stringify(pl.pool), `${JSON.stringify(vp.pool)} vs ${JSON.stringify(pl.pool)}`);
    add(`P${p} sees P${actor}'s runes and their state`, JSON.stringify(vp.runesInPlay) === JSON.stringify(pl.runesInPlay) && pl.runesInPlay.every(r => v.state.objects[r]?.exhausted === g.objects[r].exhausted && v.state.objects[r]?.cardId === g.objects[r].cardId));
    add(`P${p} sees P${actor}'s rune deck size only`, vp.runeDeck.length === pl.runeDeck.length && vp.runeDeck.every(r => v.state.objects[r]?.cardId === 'hidden'));
    // UI-CANCEL: while the actor may still cancel the play in progress, others see the chain as it was before the play began
    const chainNow = g.ex.cancelFor !== undefined && g.ex.cancelFor !== p && g.ex.unit ? g.ex.unit.base.chain : g.chain;
    add(`P${p} sees the chain`, v.state.chain.length === chainNow.length && chainNow.every((c, i) => v.state.chain[i].id === c.id && v.state.objects[c.source]?.cardId === g.objects[c.source]?.cardId));
    // HIDDEN-IDS: others get the hand as opaque aliases (same count, no engine ids)
    const handOk = p === actor ? pl.hand.every(h => v.state.objects[h]?.cardId === g.objects[h].cardId)
      : vp.hand.length === pl.hand.length && pl.hand.every(h => !v.state.objects[h] || g.ex.revealed.includes(h)) && vp.hand.every(h => v.state.objects[h]?.cardId === 'hidden' || g.ex.revealed.includes(h));
    add(`P${p} ${p === actor ? 'sees' : "doesn't see"} P${actor}'s hand`, handOk);
    const boardOk = Object.values(g.objects).filter(o => o.zone === 'base' || o.zone === 'battlefield').every(o => v.state.objects[o.id]?.cardId === o.cardId);
    add(`P${p} sees the board`, boardOk);
    if (facedown && g.objects[facedown]?.zone === 'facedown') add(`P${p} ${p === actor ? 'sees' : "doesn't see"} the facedown card`, p === actor ? v.state.objects[facedown]?.cardId === g.objects[facedown].cardId
      : !v.state.objects[facedown] && Object.values(v.state.objects).some(o => o.zone === 'facedown' && o.battlefieldIndex === g.objects[facedown].battlefieldIndex && o.cardId === 'hidden'));
  }
}

/** Answer P0's in-step decisions after the action. Returns the state and what was asked. */
function answerSteps(g: GameState, ex: Expect, checks: Check[], viewCheck = false): { g: GameState; askedOptional: boolean; numberMax: number | null } {
  let askedOptional = false, numberMax: number | null = null;
  for (let i = 0; i < 12; i++) {
    const d = g.pending;
    if (!d || !d.inStep) break;
    if (viewCheck && i === 0) checkView(g, d.player, checks, `while P${d.player} answers ${d.kind}`);
    let ids: string[];
    if (d.kind === 'optional') { askedOptional = true; ids = [ex.optional?.answer ? 'yes' : 'no']; }
    else if (d.kind === 'chooseNumber') { const ns = (d.options ?? []).map(o => Number(o.id)); numberMax = Math.max(...ns); ids = [String(numberMax)]; }
    else if (d.kind === 'chooseTargets' || d.kind === 'chooseCards' || d.kind === 'chooseMode') ids = (d.options ?? []).slice(0, Math.max(1, d.min ?? 1)).map(o => o.id);
    else if (d.kind === 'chooseBattlefield' || d.kind === 'chooseDestination') ids = [(d.options ?? [])[0].id];
    else { checks.push({ name: `unexpected decision ${d.kind}`, cat: 'legality', ok: false, msg: d.prompt }); break; }
    g = applyAction(g, { type: 'choose', player: d.player, optionIds: ids }).state;
  }
  return { g, askedOptional, numberMax };
}

/** Pass on the chain until it is back to `len` items (or something else is pending). */
function resolveTo(g: GameState, len: number): GameState {
  for (let i = 0; i < 20 && g.chain.length > len; i++) {
    const d = g.pending;
    if (!d || d.inStep || d.kind !== 'chainResponse') return g;
    g = applyAction(g, { type: 'pass', player: d.player }).state;
  }
  return g;
}

/** BASICS_FULL=1: every view check on every cell; default: views on the plenty / exact / short cells (views don't depend on the rest). */
export const FULL = !!process.env.BASICS_FULL;
const SAMPLE_VIEW = (c: Cell) => FULL || c.res === 'plenty' || c.res === 'exact' || c.res === 'short';

export function runCell(cell: Cell): CellResult {
  const checks: Check[] = [];
  const flags = new Set<string>();
  const add = (name: string, cat: Check['cat'], ok: boolean, msg = '') => checks.push({ name, cat, ok, msg });
  const b = build(cell);
  let g = b.g;
  const { action, expect: ex, actor } = b;
  const w = WINDOW[cell.moment];
  const timing = timingOf(cell.kind);
  const sc: SpendCtx = { purpose: purposeOf(cell.kind), showdown: !!g.showdown };
  const res0 = resourcesOf(g, actor, b.src, sc);
  const pay0 = bestPayment(res0, ex.cost);
  const selfReady = !ex.exhaustSelf || (!!g.objects[b.src] && !g.objects[b.src].exhausted);
  const expectedLegal = timingAllows(timing, w) && b.structural && pay0 !== null && selfReady;

  // ---- legality (validateAction / getLegalActions / oracle agree)
  const v = validateAction(g, action);
  const listed = getLegalActions(g, actor).some(a => sameAction(a, action));
  add('validateAction agrees with getLegalActions', 'legality', (v === null) === listed, `validate=${v ?? 'ok'} listed=${listed}`);
  if (cell.res === 'plenty') {
    const types = new Set(getLegalActions(g, actor).map(a => a.type));
    if (w === 'main') add('main phase: endTurn offered, no pass (CR 316.9)', 'legality', types.has('endTurn') && !types.has('pass'));
    else if (w) add(`${w}: pass offered, no endTurn (CR 338, 347)`, 'legality', types.has('pass') && !types.has('endTurn'));
    else add('no priority / focus: nothing to do (CR 312.1)', 'legality', types.size === 0, [...types].join());
  }
  add(`legal = ${expectedLegal} (timing ${timing} in ${w ?? 'no window'}, ${pay0 ? 'affordable' : 'unaffordable'})`, 'legality', (v === null) === expectedLegal, `validate: ${v ?? 'ok'}`);
  // the state before the action differs between resource states only in runes: its view is checked on two of them
  if (FULL || cell.res === 'plenty' || cell.res === 'short') checkView(g, actor, checks, 'before', b.hiddenAt !== undefined ? b.src : undefined);
  if (v !== null || !expectedLegal) {
    if (v !== null) { let threw = false; try { applyAction(g, action); } catch { threw = true; } add('applyAction refuses the illegal action', 'legality', threw); }
    return { cell, legal: false, checks, flags };
  }

  // ---- apply
  const before = measure(g, actor, b.src, sc);
  const chainLen0 = g.chain.length;
  const hand0 = g.players[actor].hand.length;
  const focus0 = g.showdown?.focus ?? null;
  const pend0 = g.pending!;
  const r = applyAction(g, action);
  if (r.events.some(e => e.type === 'rollback')) { add('the legal action is not rolled back', 'legality', false, String(r.events.find(e => e.type === 'rollback')!.reason)); return { cell, legal: true, checks, flags }; }
  const mid = resourcesOf(r.state, actor, b.src, sc);     // after the card's own payment (a play trigger's cost comes next)
  const st = answerSteps(r.state, ex, checks, SAMPLE_VIEW(cell));
  g = st.g;

  // ---- optional additional costs (CR 355.1 / 355.16): offered iff affordable
  let cost = ex.cost;
  if (ex.optional && ex.trigger) {
    // CR 383.3.b: a trigger's "you may pay" is offered iff it can be paid with what is left after the card's payment
    const canNow = bestPayment(mid, ex.optional.extra) !== null;
    const canTogether = bestPayment(res0, plus(ex.cost, ex.optional.extra)) !== null;
    add(`play trigger's optional cost offered iff affordable now (${canNow})`, 'optional', st.askedOptional === canNow, `asked=${st.askedOptional}`);
    add('the card was paid so that the play trigger\'s cost stays affordable', 'payment', canNow || !canTogether, 'affordable together, not after the card\'s auto-pay');
    if (!canNow && canTogether) flags.add('triggerStarved');
    if (st.askedOptional && ex.optional.answer) cost = plus(ex.cost, ex.optional.extra);
  } else if (ex.optional) {
    const canWith = bestPayment(res0, plus(ex.cost, ex.optional.extra)) !== null;
    add(`optional cost offered iff affordable (${canWith})`, 'optional', st.askedOptional === canWith, `asked=${st.askedOptional}`);
    if (canWith && ex.optional.answer) cost = plus(ex.cost, ex.optional.extra);
  } else add('no unexpected yes/no question', 'optional', !st.askedOptional);

  // ---- payment: best end state, cost paid in full (not for Add abilities: the action itself is the resource change)
  const after = measure(g, actor, b.src, sc);
  if (ex.cls !== 'add') {
  const best = bestPayment(res0, cost)!;
  const got = endVec(before, after);
  const cmp = cmpVec(got, best);
  if (cmp > 0) flags.add('suboptimal');
  add(`cost paid in full (CR 357): end state no better than the best payment (${vecStr(best)})`, 'legality', cmp >= 0, `got ${vecStr(got)}`);
  add(`auto-pay end state is the best (${vecStr(best)})`, 'payment', cmp <= 0, `got ${vecStr(got)}; runes ${before.runes}->${after.runes}, ready ${before.ready}->${after.ready}, pool ${before.poolE}E/${before.poolP}P -> ${after.poolE}E/${after.poolP}P, gold ${before.gold}->${after.gold}`);
  // pool before runes: no rune exhausted just for energy while pool energy is left over
  const exhaustedForEnergy = before.runeIds.filter(id => g.objects[id]?.zone === 'runePool' && g.objects[id].exhausted && !b.g.objects[id].exhausted).length;
  const poolFirst = !(before.poolE > 0 && exhaustedForEnergy > 0 && after.poolE > 0);
  add('pool energy spent before exhausting runes', 'payment', poolFirst, `exhausted ${exhaustedForEnergy}, pool ${before.poolE} -> ${after.poolE}`);
  if (!poolFirst) flags.add('poolFirst');
  // domain retention (rules-spec §2.6 "prefer runes whose domain is least needed later"): with a choice of domain for an
  // [A] / multi-domain power, don't recycle the last rune of a domain while another domain has spares
  const recycled = before.runeIds.filter(id => g.objects[id]?.zone !== 'runePool');
  const domCount = (ids: ObjId[], gg: GameState) => { const m = new Map<string, number>(); for (const id of ids) { const dd = gg.cards[gg.objects[id].cardId].domains[0]; m.set(dd, (m.get(dd) ?? 0) + 1); } return m; };
  if (recycled.length && cost.power.some(q => q === 'any' || q.length > 1)) {
    const had = domCount(before.runeIds, b.g);
    const lostLast = recycled.some(id => had.get(b.g.cards[b.g.objects[id].cardId].domains[0]) === 1 && [...had.values()].some(n => n > 1));
    add('keeps the last rune of a domain when a spare one could pay', 'payment', !lostLast);
    if (lostLast) flags.add('domain');
  }

  }

  // ---- priority / focus and where things went
  const opponent = opp(actor);
  const top = g.chain[g.chain.length - 1];
  if (ex.cls === 'add') {
    add('Add: no chain item, same decision, priority/focus unchanged (CR 430.2)', 'priority', g.chain.length === chainLen0 && g.pending?.kind === pend0.kind && g.pending?.player === actor && (g.showdown?.focus ?? null) === focus0);
    if (w === 'showdown') add('Add in a showdown: the passes in succession start over (CR 337.2, 339.1, 347.2.a; rules-decisions #56)', 'priority', g.showdown!.passes.length === 0, `passes ${JSON.stringify(g.showdown!.passes)}`);
    const rune = g.objects[b.src];
    if ((action as { abilityIndex: number }).abilityIndex === 950) add('rune exhausted, +1 energy (CR 164.2)', 'effect', rune.exhausted && after.poolE === before.poolE + 1);
    else add('rune recycled to the bottom of the rune deck, +1 power (CR 164.2, 161.2.b)', 'effect', rune.zone === 'runeDeck' && g.players[actor].runeDeck[g.players[actor].runeDeck.length - 1] === b.src && after.poolP === before.poolP + 1);
  } else if (ex.cls === 'move') {
    const mv = action as Extract<Action, { type: 'move' }>;
    const o = g.objects[b.src];
    add('moved unit is at the destination, exhausted (CR 144: exhaust is the cost)', 'effect', (mv.to === 'base' ? o.zone === 'base' : o.zone === 'battlefield' && o.battlefieldIndex === mv.to) && o.exhausted);
    if (mv.to === BF_A) add('moved to an open battlefield: a showdown starts, the mover has focus (CR 341, 345)', 'priority', g.showdown?.battlefieldIndex === BF_A && g.showdown.focus === actor && g.pending?.kind === 'showdownAction' && g.pending.player === actor);
    else add('no showdown: back to the main-phase decision', 'priority', !g.showdown && g.pending?.kind === 'mainAction' && g.pending.player === actor);
    if (mv.to === 'base') add('the last unit left BF-B: it becomes uncontrolled at the cleanup (CR 190.4)', 'effect', g.battlefields[BF_B].controller === null);
    if (mv.to === BF_B) add('moving to a battlefield you control changes nothing (no contest)', 'effect', g.battlefields[BF_B].controller === actor && !g.battlefields[BF_B].contested);
    if (SAMPLE_VIEW(cell)) checkView(g, actor, checks, 'after');
  } else if (ex.cls === 'hide') {
    add('hide: back to the main-phase decision (CR 811)', 'priority', g.pending?.kind === 'mainAction' && g.pending.player === actor && g.chain.length === 0);
    add('hidden card is facedown at the battlefield, hidden this turn', 'effect', g.objects[b.src].zone === 'facedown' && g.objects[b.src].battlefieldIndex === BF_B && g.objects[b.src].hiddenTurn === g.turn);
    if (SAMPLE_VIEW(cell)) checkView(g, actor, checks, 'after', b.src);
  } else if (ex.cls === 'permanent') {
    // a "when you play me" trigger goes on the chain after the permanent resolved (CR 383.4.a.2): resolve it first
    if (g.chain.length > chainLen0) {
      add('play trigger waits on the chain, its controller holds priority (CR 383.4.a.2)', 'priority', g.chain[g.chain.length - 1].kind === 'trigger' && g.pending?.kind === 'chainResponse' && g.pending.player === actor);
      g = resolveTo(g, chainLen0);
      if (g.pending?.inStep) { g = answerSteps(g, ex, checks).g; g = resolveTo(g, chainLen0); }
      // a trigger's chain doesn't pass focus (CR 346.1): in a showdown the focus already went to the opponent when the unit resolved
    }
    if (w === 'main') add('permanent resolves at once; TP back in the main phase (CR 337.2, 359.2)', 'priority', g.chain.length === 0 && g.pending?.kind === 'mainAction' && g.pending.player === actor);
    else if (w === 'chain') add('permanent resolves at once; priority to the newest chain item\'s controller (CR 337)', 'priority', g.chain.length === chainLen0 && g.pending?.kind === 'chainResponse' && g.priority === g.chain[g.chain.length - 1]?.controller && g.pending.player === g.priority);
    else add('permanent played in a showdown: focus passes (CR 337.2, 346.1; RJ#11052)', 'priority', g.showdown?.focus === opponent && g.pending?.kind === 'showdownAction' && g.pending.player === opponent && g.showdown.passes.length === 0);
    const o = g.objects[b.src];
    const isUnit = g.cards[o.cardId].type === 'Unit';
    const accelerated = !!ex.optional && !ex.trigger && ex.optional.answer && st.askedOptional && (cell.kind.k !== 'real' || cell.kind.role === 'accelerate');
    const wantLoc = (action as { destination?: number | 'base' }).destination ?? 'base';
    const loc = o.zone === 'base' ? 'base' : o.zone === 'battlefield' ? o.battlefieldIndex : o.zone;
    add(`permanent on the board at ${wantLoc}`, 'effect', loc === wantLoc, `at ${String(loc)}`);
    if (isUnit) add(`unit enters ${accelerated ? 'ready (Accelerate, CR 805)' : 'exhausted (CR 359.2)'}`, 'effect', o.exhausted === !accelerated);
    else add('gear enters ready (CR 149.2)', 'effect', !o.exhausted);
    if (ex.trigger) add(`play trigger ${st.askedOptional ? 'paid: drew 1' : 'not paid: drew 0'}`, 'effect', g.players[actor].hand.length - (hand0 - 1) === (st.askedOptional ? 1 : 0), `drew ${g.players[actor].hand.length - (hand0 - 1)}`);
    if (SAMPLE_VIEW(cell)) checkView(g, actor, checks, 'after');
  } else {
    add('item waits on the chain, its controller holds priority (CR 338.1.a.5)', 'priority', g.chain.length === chainLen0 + 1 && top?.controller === actor && g.priority === actor && g.pending?.kind === 'chainResponse' && g.pending.player === actor);
    if (ex.exhaustSelf) add('exhaust cost paid (source exhausted)', 'effect', !!g.objects[b.src]?.exhausted);
    if (SAMPLE_VIEW(cell)) checkView(g, actor, checks, 'on chain');
    // resolve it: both pass
    const handBefore = g.players[actor].hand.length;
    // a cost paid while the spell resolves is not paid "to play a spell" (restricted Adds such as Daughter of the Void don't apply)
    const scRes: SpendCtx = { purpose: 'other', showdown: !!g.showdown };
    const preRes = measure(g, actor, b.src, scRes);
    const resPre = resourcesOf(g, actor, b.src, scRes);
    g = resolveTo(g, chainLen0);
    let numberMax: number | null = null;
    if (g.pending?.inStep) { const s2 = answerSteps(g, ex, checks); g = s2.g; numberMax = s2.numberMax; }
    g = resolveTo(g, chainLen0);
    add('the item resolved', 'priority', g.chain.length === chainLen0, `chain ${g.chain.length}`);
    if (w === 'main') add('after resolution: TP back in the main phase (CR 340)', 'priority', g.pending?.kind === 'mainAction' && g.pending.player === actor);
    else if (w === 'chain') add('after resolution: priority to the newest remaining item\'s controller (CR 340)', 'priority', g.chain.length > 0 && g.pending?.kind === 'chainResponse' && g.pending.player === g.chain[g.chain.length - 1].controller);
    else add('after resolution in a showdown: focus passes to the opponent, passes start over (CR 340.2.a, 346, 347.2.a)', 'priority', g.showdown?.focus === opponent && g.pending?.kind === 'showdownAction' && g.pending.player === opponent && g.showdown.passes.length === 0);
    if (ex.draws !== undefined && ex.draws > 0) {
      const repeated = !!ex.optional && st.askedOptional && ex.optional.answer && cell.kind.k === 'card';
      const draws = ex.draws + (repeated ? 1 : 0);
      add(`effect: drew ${draws}`, 'effect', g.players[actor].hand.length - handBefore === draws, `drew ${g.players[actor].hand.length - handBefore}`);
    }
    if (cell.kind.k === 'equip' || (cell.kind.k === 'real' && cell.kind.via === 'equip')) add('equipment attached (CR 818)', 'effect', g.objects[b.src].attachedTo !== undefined);
    if (ex.variable) {
      const max = maxAnyPower(resPre);
      add(`"pay any amount": the largest amount offered is what can be paid (${max})`, 'optional', (numberMax ?? 0) === max, `offered ${numberMax}`);
      const postRes = measure(g, actor, b.src, scRes);
      const bestV = bestPayment(resPre, { energy: 0, power: new Array(max).fill('any') });
      const gotV = endVec(preRes, postRes);
      const c2 = cmpVec(gotV, bestV!);
      if (c2 > 0) flags.add('suboptimal');
      add(`resolution payment paid in full (${vecStr(bestV)})`, 'legality', c2 >= 0, `got ${vecStr(gotV)}`);
      add(`resolution payment is the best (${vecStr(bestV)})`, 'payment', c2 <= 0, `got ${vecStr(gotV)}`);
      add(`effect: drew ${max}`, 'effect', g.players[actor].hand.length - handBefore === max);
    }
    if (SAMPLE_VIEW(cell)) checkView(g, actor, checks, 'after resolution');
  }
  void hand0;
  return { cell, legal: true, checks, flags };
}

/** Assert a cell's checks (all categories except `skip`). */
export function assertCell(r: CellResult, skip: Check['cat'][] = []): void {
  const bad = r.checks.filter(c => !c.ok && !skip.includes(c.cat));
  assert.ok(bad.length === 0, `${r.cell.id}\n` + bad.map(c => `  [${c.cat}] ${c.name}${c.msg ? ` — ${c.msg}` : ''}`).join('\n'));
}

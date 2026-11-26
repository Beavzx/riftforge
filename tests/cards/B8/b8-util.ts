// Shared setup for batch B8 card tests (not a test file itself).
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import '../../../src/cards/scripts/index.ts';
import { newGame, act, choose, pass, put, runes, handCard, resolveAll, zoneOf, setController, yes, no, find } from '../../fixtures/helpers.ts';
import { baseDb } from '../../fixtures/cards.ts';
import type { CardDef, GameState, ObjId, PlayerId, Action } from '../../../src/engine/types.ts';
import { getLegalActions } from '../../../src/engine/game.ts';
import { might, hasKw, kwVal, chars } from '../../../src/engine/chars.ts';
import { newObject } from '../../../src/engine/state.ts';
import { card, spell, onConquer, onHold, deathknell, activated, onPlay, cost, T } from '../../../src/cards/dsl.ts';

export const real: Record<string, CardDef> = JSON.parse(readFileSync(new URL('../../../data/cards.json', import.meta.url), 'utf8'));
export const db: Record<string, CardDef> = { ...baseDb(), ...real };

// extra vanilla fixtures for B8 tests
function u(id: string, energy: number, m: number, o: Partial<CardDef> = {}): CardDef {
  return { id, name: o.name ?? id, type: 'Unit', supertypes: [], tags: [], domains: ['Fury'], energy, power: 0, might: m, keywords: [], text: '', set: 'test', rarity: 'Common', ...o };
}
db['b8-dragon'] = u('b8-dragon', 5, 5, { name: 'Test Dragon', tags: ['Dragon'] });
db['b8-u6'] = u('b8-u6', 6, 6);
db['b8-u7'] = u('b8-u7', 7, 7);
db['b8-cat'] = u('b8-cat', 2, 2, { name: 'Test Cat', tags: ['Cat'] });
db['b8-champ'] = u('b8-champ', 3, 3, { name: 'Test Champ', supertypes: ['Champion'] });
db['b8-teemo'] = u('b8-teemo', 2, 2, { name: 'Teemo Test', tags: ['Teemo'] });
db['b8-gear'] = { id: 'b8-gear', name: 'Test Gear', type: 'Gear', supertypes: [], tags: [], domains: ['Fury'], energy: 2, power: 0, might: null, keywords: [], text: '', set: 'test', rarity: 'Common' };
db['b8-gear7'] = { ...db['b8-gear'], id: 'b8-gear7', name: 'Big Gear', energy: 7 };
db['b8-sword'] = { ...db['b8-gear'], id: 'b8-sword', name: 'Test Sword', tags: ['Equipment'], might: 2, keywords: ['Equip'], text: '[Equip] [1]' } as CardDef;
db['b8-deploy'] = { ...db['b8-gear'], id: 'b8-deploy', name: 'Test Deploy', keywords: ['Deploy'], text: '[Deploy]' } as CardDef;
function sp(id: string, energy: number, o: Partial<CardDef> = {}): CardDef {
  return { id, name: o.name ?? id, type: 'Spell', supertypes: [], tags: [], domains: ['Fury'], energy, power: 0, might: null, keywords: [], text: '', set: 'test', rarity: 'Common', ...o };
}
db['b8-s1'] = sp('b8-s1', 1, { name: 'Small Spell' });
db['b8-s2'] = sp('b8-s2', 2, { name: 'Two Spell' });
db['b8-s5'] = sp('b8-s5', 5, { name: 'Big Spell' });
db['b8-react'] = sp('b8-react', 1, { name: 'Quick Spell', keywords: ['Reaction'], text: '[Reaction]' });
db['b8-action'] = sp('b8-action', 1, { name: 'Action Spell', keywords: ['Action'], text: '[Action]' });

// test-only scripted fixtures (ids prefixed b8-)
db['b8-zap'] = sp('b8-zap', 1, { name: 'Zap' });
card('b8-zap', '', [spell(ctx => { const t = ctx.target(0); if (t) ctx.deal(1, t); }, { targets: [T.unit({ hint: 'harm' })] })]);
db['b8-zap-action'] = sp('b8-zap-action', 1, { name: 'Zap Action', keywords: ['Action'], text: '[Action]' });
card('b8-zap-action', '[Action]', [spell(ctx => { const t = ctx.target(0); if (t) ctx.deal(1, t); }, { targets: [T.unit({ hint: 'harm' })] })]);
db['b8-pump'] = sp('b8-pump', 1, { name: 'Pump' });
card('b8-pump', '', [spell(ctx => { const t = ctx.target(0); if (t) ctx.giveMight(t, 1); }, { targets: [T.unit({ hint: 'help' })] })]);
db['b8-pump5'] = sp('b8-pump5', 5, { name: 'Big Pump' });
card('b8-pump5', '', [spell(ctx => { const t = ctx.target(0); if (t) ctx.giveMight(t, 1); }, { targets: [T.unit({ hint: 'help' })] })]);
db['b8-pumpA'] = sp('b8-pumpA', 1, { name: 'Power Pump', power: 1 });
card('b8-pumpA', '', [spell(ctx => { const t = ctx.target(0); if (t) ctx.giveMight(t, 1); }, { targets: [T.unit({ hint: 'help' })] })]);
db['b8-s-pow'] = sp('b8-s-pow', 0, { name: 'Power Spell', power: 1 });
card('b8-s-pow', '', [spell(ctx => { ctx.draw(1); })]);
db['b8-u-pow'] = u('b8-u-pow', 0, 1, { name: 'Power Unit', power: 1 });
db['b8-g-pow'] = { ...db['b8-gear'], id: 'b8-g-pow', name: 'Power Gear', energy: 0, power: 1 };
db['b8-action2'] = sp('b8-action2', 2, { name: 'Action Two', keywords: ['Action'], text: '[Action]' });
db['b8-cheapdragon'] = u('b8-cheapdragon', 2, 2, { name: 'Small Dragon', tags: ['Dragon'] });
db['b8-s0'] = sp('b8-s0', 0, { name: 'Free Spell' });
db['b8-stun2'] = sp('b8-stun2', 1, { name: 'Double Stun' });
card('b8-stun2', '', [spell(ctx => ctx.stun(ctx.targetsOf(0)), { targets: [T.upTo(2, T.unit({ hint: 'harm' }))] })]);
db['b8-readyall'] = sp('b8-readyall', 1, { name: 'Ready All' });
card('b8-readyall', '', [spell(ctx => ctx.ready(ctx.units()))]);
db['b8-bounce'] = sp('b8-bounce', 1, { name: 'Bounce' });
card('b8-bounce', '', [spell(ctx => { const t = ctx.target(0); if (t) ctx.returnToHand(t); }, { targets: [T.unit()] })]);
db['b8-recruits'] = sp('b8-recruits', 1, { name: 'Recruit Call' });
card('b8-recruits', '', [spell(ctx => { ctx.createToken('Recruit', 'base'); })]);
db['b8-repeat'] = sp('b8-repeat', 1, { name: 'Repeat Draw', keywords: ['Repeat'], text: '[Repeat] [2]' });
card('b8-repeat', '[Repeat] [2]', [spell(ctx => { ctx.draw(1); })]);
db['b8-conq'] = u('b8-conq', 2, 2, { name: 'Conqueror' });
card('b8-conq', '', [onConquer(ctx => ctx.draw(1))]);
db['b8-holder'] = u('b8-holder', 2, 2, { name: 'Holder' });
card('b8-holder', '', [onHold(ctx => ctx.draw(1))]);
db['b8-dk'] = u('b8-dk', 1, 1, { name: 'Knell' });
card('b8-dk', '', [deathknell(ctx => ctx.draw(1))]);
db['b8-gearab'] = { ...db['b8-gear'], id: 'b8-gearab', name: 'Gadget' };
card('b8-gearab', '', [activated('[2], [T]', ctx => ctx.draw(1))]);
db['b8-gearab7'] = { ...db['b8-gear'], id: 'b8-gearab7', name: 'Huge Gadget' };
card('b8-gearab7', '', [activated('[7], [T]', ctx => ctx.draw(1))]);
db['b8-emp'] = u('b8-emp', 2, 2, { name: 'Empowerable', keywords: ['Empower'], text: '[Empower] [2]' });
db['b8-hideable'] = sp('b8-hideable', 1, { name: 'Hidden Draw', keywords: ['Hidden'], text: '[Hidden]' });
card('b8-hideable', '[Hidden]', [spell(ctx => { ctx.draw(1); })]);
db['b8-optcost'] = u('b8-optcost', 2, 2, { name: 'Optional Cost Unit' });
card('b8-optcost', '', [onPlay(ctx => { if (ctx.data.paidAdditional) ctx.draw(1); })], { additionalCosts: [{ cost: cost('[1]'), optional: true, label: 'Pay [1] to draw on play' }] });

export function game(o: { firstPlayer?: PlayerId } = {}): GameState {
  return newGame({ db, firstPlayer: o.firstPlayer });
}

/** Replace battlefield i's card (keeps the object; for tests). */
export function setBf(g: GameState, i: number, cardId: string): ObjId {
  const id = g.battlefields[i].objId;
  g.objects[id].cardId = cardId;
  return id;
}
export function setLegend(g: GameState, p: PlayerId, cardId: string): ObjId {
  const id = g.players[p].legend;
  g.objects[id].cardId = cardId;
  return id;
}
export function exhaustRunes(g: GameState, p: PlayerId): void { for (const r of g.players[p].runesInPlay) g.objects[r].exhausted = true; }
/** Replace p's runes in play with exactly n fresh ready runes. */
export function onlyRunes(g: GameState, p: PlayerId, n: number, cardId = 't-rune-fury'): ObjId[] {
  for (const r of g.players[p].runesInPlay) { g.objects[r].zone = 'runeDeck'; g.players[p].runeDeck.push(r); }
  g.players[p].runesInPlay = [];
  return runes(g, p, n, cardId);
}
export function readyCount(g: GameState, p: PlayerId): number { return g.players[p].runesInPlay.filter(r => !g.objects[r].exhausted).length; }

/** End turns (no other decisions) until it is p's main phase or something else is pending. */
export function toMain(g: GameState, p: PlayerId, limit = 6): GameState {
  for (let i = 0; i < limit; i++) {
    const d = g.pending;
    if (!d) return g;
    if (d.kind === 'mainAction' && d.player === p && i > 0) return g;
    if (d.kind !== 'mainAction') return g;
    g = act(g, { type: 'endTurn', player: d.player });
  }
  return g;
}
/** End the current turn and stop at the first decision of the next turn (or the next main phase). */
export function endTurn(g: GameState): GameState {
  const d = g.pending!;
  assert.equal(d.kind, 'mainAction', `expected a main action, got ${d.kind}: ${d.prompt}`);
  return act(g, { type: 'endTurn', player: d.player });
}

/** Put a ready unit in p's base and standard-move it to bf; resolve the showdown (passes). */
export function moveIn(g: GameState, p: PlayerId, bf: number, cardId = 't-u2'): { g: GameState; u: ObjId } {
  const u = put(g, p, cardId, 'base');
  g = act(g, { type: 'move', player: p, units: [u], to: bf });
  g = resolveAll(g);
  return { g, u };
}

export function pendingPrompt(g: GameState): string { return g.pending ? `${g.pending.kind}: ${g.pending.prompt}` : 'none'; }
export function expectPending(g: GameState, kind: string, re?: RegExp): void {
  assert.equal(g.pending?.kind, kind, `pending: ${pendingPrompt(g)}`);
  if (re) assert.match(g.pending!.prompt, re);
}
export function optIds(g: GameState): string[] { return (g.pending?.options ?? []).map(o => o.id); }
export function hasAction(g: GameState, p: PlayerId, f: (a: Action) => boolean): boolean { return getLegalActions(g, p).some(f); }

export function play(g: GameState, p: PlayerId, obj: ObjId, destination?: number | 'base'): GameState {
  return act(g, { type: 'playCard', player: p, obj, ...(destination !== undefined ? { destination } : {}) });
}
export function activate(g: GameState, p: PlayerId, obj: ObjId, abilityIndex = 0): GameState {
  return act(g, { type: 'activate', player: p, obj, abilityIndex });
}
export function mkObj(g: GameState, cardId: string, p: PlayerId, zone: Parameters<typeof newObject>[3]): ObjId {
  return newObject(g, cardId, p, zone).id;
}

export { newGame, act, choose, pass, put, runes, handCard, resolveAll, zoneOf, setController, yes, no, find, getLegalActions, might, hasKw, kwVal, chars, assert };

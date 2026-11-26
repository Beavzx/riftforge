// Hand-made test cards (ids prefixed "t-") used by engine tests. Not real cards.
import type { CardDef, CardId, DeckList, Domain, CardType } from '../../src/engine/types.ts';

function def(id: string, name: string, type: CardType, o: Partial<CardDef> = {}): CardDef {
  return { id, name, type, supertypes: [], tags: [], domains: [], energy: null, power: null, might: null, keywords: [], text: '', set: 'test', rarity: 'Common', ...o };
}

export function unit(id: string, energy: number, might: number, o: Partial<CardDef> = {}): CardDef {
  return def(id, o.name ?? id, 'Unit', { domains: ['Fury'], energy, power: 0, might, ...o });
}
export function spell(id: string, energy: number, o: Partial<CardDef> = {}): CardDef {
  return def(id, o.name ?? id, 'Spell', { domains: ['Fury'], energy, power: 0, ...o });
}
export function gear(id: string, energy: number, o: Partial<CardDef> = {}): CardDef {
  return def(id, o.name ?? id, 'Gear', { domains: ['Fury'], energy, power: 0, ...o });
}

const RUNES: Record<string, Domain> = { 't-rune-fury': 'Fury', 't-rune-calm': 'Calm', 't-rune-mind': 'Mind' };

export function baseDb(): Record<CardId, CardDef> {
  const db: Record<CardId, CardDef> = {};
  const add = (d: CardDef) => { db[d.id] = d; };
  add(def('t-legend', 'Test Legend', 'Legend', { domains: ['Fury', 'Calm'], tags: ['Tester'] }));
  add(unit('t-champ', 3, 3, { name: 'Tester', supertypes: ['Champion'], tags: ['Tester'] }));
  for (const [id, d] of Object.entries(RUNES)) add(def(id, `${d} Rune`, 'Rune', { domains: [d], supertypes: ['Basic'] }));
  for (let i = 1; i <= 6; i++) add(def(`t-bf${i}`, `Field ${i}`, 'Battlefield'));
  // vanilla units
  add(unit('t-u1', 1, 1));
  add(unit('t-u2', 2, 2));
  add(unit('t-u3', 3, 3));
  add(unit('t-u4', 4, 4));
  add(unit('t-u5', 5, 5));
  add(unit('t-calm2', 2, 2, { domains: ['Calm'], power: 1 }));
  // keyword units (vanilla scripts: keywords parsed from text)
  add(unit('t-tank', 2, 3, { text: '[Tank]' }));
  add(unit('t-backline', 2, 2, { text: '[Backline]' }));
  add(unit('t-assault', 2, 2, { text: '[Assault 2]' }));
  add(unit('t-shield', 2, 2, { text: '[Shield 2]' }));
  add(unit('t-ganker', 2, 2, { text: '[Ganking]' }));
  add(unit('t-accel', 2, 2, { text: '[Accelerate]', power: 0 }));
  add(unit('t-deflect', 2, 2, { text: '[Deflect 2]' }));
  add(unit('t-temp', 1, 3, { text: '[Temporary]' }));
  add(unit('t-hidden', 2, 2, { text: '[Hidden]' }));
  add(unit('t-ambush', 2, 2, { text: '[Ambush]' }));
  add(unit('t-vision', 1, 1, { text: '[Vision]' }));
  add(unit('t-hunt', 2, 2, { text: '[Hunt 2]' }));
  add(unit('t-disarm', 2, 3, { text: '[Disarm 2]' }));
  // tokens (synthetic)
  add(def('t-recruit', 'Recruit', 'Unit', { supertypes: ['Token'], domains: ['Colorless'], might: 1 }));
  add(def('t-gold', 'Gold', 'Gear', { supertypes: ['Token'], domains: ['Colorless'], text: '[Reaction][>] Kill this, [T]: [Add] [A].' }));
  return db;
}

export interface DeckOpts { main?: CardId[]; filler?: CardId; runes?: CardId[]; battlefields?: CardId[] }

export function deck(o: DeckOpts = {}, bfOffset = 0): DeckList {
  const main = [...(o.main ?? [])];
  // fill to 39 (+ champion = 40) with up to 3 copies of distinct vanilla names
  const fillers = ['t-u1', 't-u2', 't-u3', 't-u4', 't-u5', 't-calm2', 't-tank', 't-backline', 't-assault', 't-shield', 't-ganker', 't-accel', 't-temp', 't-vision'];
  let i = 0;
  const count = (id: string) => main.filter(x => x === id).length;
  while (main.length < 39) {
    const id = o.filler ?? fillers[i % fillers.length];
    if (o.filler || count(id) < 3) main.push(id);
    i++;
    if (i > 500) break;
  }
  return {
    legend: 't-legend', champion: 't-champ', main,
    runes: o.runes ?? [...new Array(6).fill('t-rune-fury'), ...new Array(6).fill('t-rune-calm')],
    battlefields: o.battlefields ?? [`t-bf${1 + bfOffset}`, `t-bf${2 + bfOffset}`, `t-bf${3 + bfOffset}`],
  };
}

import { scriptedDefs } from './scripts.ts';
/** baseDb + scripted test cards */
export function fullDb(): Record<CardId, CardDef> { return { ...baseDb(), ...scriptedDefs() }; }

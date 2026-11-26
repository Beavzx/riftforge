// Fixture cards for the user's "Grey Docks / Shimmer Vats" chain puzzle (not real cards).
import type { CardDef } from '../../src/engine/types.ts';
import { card, spell, T, F, E, deathknell, whenUnitDies } from '../../src/cards/dsl.ts';

const base = { supertypes: [], tags: [], domains: ['Fury'], power: 0, rarity: 'Common', set: 'pz' } as const;
const u = (id: string, name: string, might: number, text = '', keywords: string[] = []): CardDef =>
  ({ ...base, id, name, type: 'Unit', energy: might, might, text, keywords, domains: ['Fury'], supertypes: [], tags: [] });
const s = (id: string, name: string, energy: number, text: string, keywords: string[]): CardDef =>
  ({ ...base, id, name, type: 'Spell', energy, might: null, text, keywords, domains: ['Fury'], supertypes: [], tags: [] });

export const PZ: Record<string, CardDef> = {};
for (const d of [
  u('pz-scrapper', 'Scrapper', 3),
  u('pz-poro', 'Poro Pal', 1, '[Deathknell] — Choose a friendly unit. It gets +2 Might this turn.', ['Deathknell']),
  u('pz-sumprat', 'Sump Rat', 2, '[Deathknell] — Deal 2 to an enemy unit.', ['Deathknell']),
  u('pz-sentinel', 'Iron Sentinel', 4, '[Deathknell] — Deal 2 to each enemy unit.', ['Deathknell']),
  u('pz-acolyte', 'Glimmer Acolyte', 2, 'When another friendly unit dies, choose a friendly unit. It gets +1 Might this turn.'),
  u('pz-hound', 'Rust Hound', 3),
  s('pz-arc', 'Arc Surge', 2, '[Action]\nDeal 2 to each of up to three units.', ['Action']),
  s('pz-hymn', 'Bulwark Hymn', 1, '[Reaction]\nUp to two friendly units each get +2 Might this turn.', ['Reaction']),
  s('pz-sap', 'Sap', 1, '[Reaction]\nA unit gets -2 Might this turn.', ['Reaction']),
  s('pz-rites', 'Last Rites', 2, '[Reaction]\nKill a friendly unit. Deal damage equal to its Might to an enemy unit.', ['Reaction']),
]) PZ[d.id] = d;

card('pz-poro', PZ['pz-poro'].text, [deathknell(E.might(0, 2), { targets: [T.unit(F.friendly, { hint: 'help' })] })]);
card('pz-sumprat', PZ['pz-sumprat'].text, [deathknell(E.deal(2, 0), { targets: [T.unit(F.enemy, { hint: 'harm' })] })]);
card('pz-sentinel', PZ['pz-sentinel'].text, [deathknell(ctx => { const ids = ctx.enemyUnits(); if (ids.length) ctx.deal(2, ids); })]);
card('pz-acolyte', PZ['pz-acolyte'].text, [whenUnitDies(F.friendly, E.might(0, 1), { targets: [T.unit(F.friendly, { hint: 'help' })] })]);
card('pz-arc', PZ['pz-arc'].text, [spell(ctx => { const ids = ctx.targetsOf(0); if (ids.length) ctx.deal(2, ids); }, { targets: [T.upTo(3, T.unit({ hint: 'harm' }))] })]);
card('pz-hymn', PZ['pz-hymn'].text, [spell(ctx => { const ids = ctx.targetsOf(0); if (ids.length) ctx.giveMight(ids, 2, 'endOfTurn'); }, { targets: [T.upTo(2, T.unit(F.friendly, { hint: 'help' }))] })]);
card('pz-sap', PZ['pz-sap'].text, [spell(E.might(0, -2), { targets: [T.unit({ hint: 'harm' })] })]);
card('pz-rites', PZ['pz-rites'].text, [spell(ctx => {
  const victim = ctx.target(0); const hit = ctx.target(1);
  if (!victim) return;
  const m = ctx.might(victim);
  ctx.kill([victim]);
  if (hit) ctx.deal(m, [hit]);
}, { targets: [T.unit(F.friendly, { hint: 'harm' }), T.unit(F.enemy, { hint: 'harm' })] })]);

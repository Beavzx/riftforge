// Synthetic token definitions missing from data/cards.json (card-patterns.md section 4).
// createGame adds these to every game's card pool if a card with the same name isn't present.
import type { CardDef } from '../engine/types.ts';
import { registerScript } from './registry.ts';

function tok(id: string, name: string, type: 'Unit' | 'Gear', might: number | null, text = '', tags: string[] = []): CardDef {
  return { id, name, type, supertypes: ['Token'], tags, domains: ['Colorless'], energy: null, power: null, might, keywords: [], text, set: 'tok', rarity: 'Token' };
}

export const SYNTHETIC_TOKENS: CardDef[] = [
  tok('tok-mech', 'Mech', 'Unit', 3, '', ['Mech']),
  tok('tok-bomb', 'Bomb', 'Gear', null, '[Deploy]\nWhen this dies, deal 2 to an enemy unit there and kill your other Bombs there.', ['Bomb']),
  tok('tok-sand-soldier', 'Sand Soldier', 'Unit', 2, '', ['Sand Soldier']),
  tok('tok-shadow-clone', 'Shadow Clone', 'Unit', 0, 'When I attack, you may banish a unit from your trash. If you do, give me [Assault 4] this turn.'),
  tok('tok-tentacle', 'Tentacle', 'Unit', 1, '', ['Bilgewater']),
];

registerScript({
  id: 'tok-shadow-clone',
  text: 'When I attack, you may banish a unit from your trash. If you do, give me [Assault 4] this turn.',
  keywords: [],
  abilities: [{
    kind: 'triggered', text: 'When I attack, you may banish a unit from your trash to give me Assault 4 this turn.',
    on: { event: 'attack', match: (ev, ctx) => ev.obj === ctx.self },
    effect: ctx => {
      const units = ctx.trash().filter(id => ctx.g.cards[ctx.obj(id).cardId]?.type === 'Unit');
      if (!units.length || !ctx.may('Banish a unit from your trash to give Shadow Clone [Assault 4]?')) return;
      const u = ctx.chooseCards(units, 1, 1, 'Banish a unit from your trash')[0];
      if (u && ctx.banish(u).length) ctx.giveKeyword(ctx.self, 'Assault 4', 'endOfTurn');
    },
  }],
});

registerScript({
  id: 'tok-bomb',
  text: '[Deploy]\nWhen this dies, deal 2 to an enemy unit there and kill your other Bombs there.',
  keywords: ['Deploy'],
  abilities: [{
    kind: 'triggered', text: 'When this dies, deal 2 to an enemy there and kill your other Bombs there.',
    on: { event: 'die', match: (ev, ctx) => ev.obj === ctx.self },
    targets: [{ kind: 'unit', prompt: 'Bomb: deal 2 to an enemy unit there', hint: 'harm', filter: (ctx, id) => ctx.isEnemy(id) && ctx.isHere(id) }],
    effect: ctx => {
      const here = ctx.here();
      ctx.deal(2, ctx.target(0));
      if (here === null) return;
      const others = ctx.gear(id => id !== ctx.self && ctx.ctrl(id) === ctx.controller && ctx.name(id) === 'Bomb' && ctx.loc(id) === here);
      ctx.kill(others);
    },
  }],
});

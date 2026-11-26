// RJ r2601 local fixture cards (ids prefixed "rjf-"). Generic test cards for Rift Judge questions
// r2601 (ids 2601-3900) that name only ability text, not real cards. Owned by the r2601 agent.
import type { CardDef, CardId, CardType, GameState, ObjId, PlayerId } from '../../src/engine/types.ts';
import { card, E, F, T, onPlay, whenYouPlay, spell } from '../../src/cards/dsl.ts';
import { place, type PlaceLoc, type PlaceOpts } from '../../src/engine/testkit.ts';
import { act, legal, pass, put, cid, realCard } from '../conformance/harness.ts';

export const RJF: Record<CardId, CardDef> = {};
function def(id: string, name: string, type: CardType, o: Partial<CardDef> = {}): CardDef {
  const d: CardDef = { id, name, type, supertypes: [], tags: [], domains: ['Fury'], energy: null, power: null, might: null, keywords: [], text: '', set: 'cf', rarity: 'Common', ...o };
  RJF[id] = d;
  return d;
}
const unit = (id: string, name: string, energy: number, might: number, text = '', o: Partial<CardDef> = {}) => def(id, name, 'Unit', { energy, power: 0, might, text, ...o });

// RJ#2601: "When you play me" + "When you play another unit"
unit('rjf-selfplay', 'SelfPlayDraw', 1, 1, 'When you play me, draw 1.');
card('rjf-selfplay', 'When you play me, draw 1.', [onPlay(E.draw(1))]);
unit('rjf-otherplay', 'OtherUnitPlayDraw', 1, 1, 'When you play another unit, draw 1.');
card('rjf-otherplay', 'When you play another unit, draw 1.', [whenYouPlay(F.unit, E.draw(1))]);

// RJ#2635: a spell that makes its controller discard 1
def('rjf-discard1', 'Discard1', 'Spell', { energy: 0, power: 0, text: 'Discard 1.' });
card('rjf-discard1', 'Discard 1.', [spell(E.discard(1))]);

// generic Reaction kill
def('rjf-killr', 'KillR', 'Spell', { energy: 1, power: 0, text: '[Reaction]\nKill a unit.', keywords: ['Reaction'] });
card('rjf-killr', '[Reaction]\nKill a unit.', [spell(E.kill(0), { targets: [T.unit()] })], { keywords: ['Reaction'] });

/** Add the r2601 fixtures to a game's card pool. */
export function rjf(g: GameState): void { g.cards = { ...g.cards, ...RJF }; }
/** place() an r2601 fixture (adds the pool first). */
export function putF(g: GameState, p: PlayerId, id: string, loc: PlaceLoc, o: PlaceOpts = {}): ObjId { rjf(g); return place(g, p, id, loc, o); }

// ---- helpers --------------------------------------------------------------------------------
/** Pass on chain/showdown until something else is pending; answers assignDamage with the first legal option. */
export function settle(g: GameState, limit = 60): GameState {
  for (let i = 0; i < limit; i++) {
    const d = g.pending;
    if (!d) return g;
    if (d.kind === 'assignDamage') { g = act(g, legal(g, d.player)[0]); continue; }
    if (d.inStep || (d.kind !== 'chainResponse' && d.kind !== 'showdownAction')) return g;
    g = pass(g);
  }
  return g;
}
export function setLegend(g: GameState, p: PlayerId, name: string): ObjId {
  const id = cid(name);
  if (!g.cards[id]) g.cards = { ...g.cards, [id]: realCard(id) };
  const lg = g.players[p].legend;
  g.objects[lg].cardId = id;
  g.timestamp++;
  return lg;
}
/** Stack real/fixture cards on top of p's main deck (first = top). */
export function stackTop(g: GameState, p: PlayerId, ...cards: string[]): ObjId[] {
  const ids: ObjId[] = [];
  for (const c of [...cards].reverse()) ids.unshift(put(g, p, c, 'deckTop'));
  return ids;
}
/**
 * Drive to the next main-phase decision: answers in-step decisions via `pick` (or the first legal action),
 * passes on chain/showdown decisions.
 */
export function drive(g: GameState, pick: (g: GameState) => string[] | null = () => null, limit = 60): GameState {
  for (let i = 0; i < limit; i++) {
    const d = g.pending;
    if (!d || d.kind === 'mainAction') return g;
    if (d.inStep || d.kind === 'assignDamage') {
      const ids = d.kind === 'assignDamage' ? null : pick(g);
      g = ids ? act(g, { type: 'choose', player: d.player, optionIds: ids }) : act(g, legal(g, d.player)[0]);
      continue;
    }
    g = pass(g);
  }
  return g;
}

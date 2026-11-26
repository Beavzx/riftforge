// META-SIM: src/ai smoke tests (determinization hides only what it should; the search AI only answers validly).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGame, applyAction, validateAction } from '../../src/engine/index.ts';
import type { CardDef, CardId, DeckList, GameState } from '../../src/engine/types.ts';
import { SearchAI, determinize, evaluate } from '../../src/ai/index.ts';
import { makeRng } from '../../src/engine/rng.ts';

const db = JSON.parse(readFileSync(new URL('../../data/cards.json', import.meta.url), 'utf8')) as Record<CardId, CardDef>;
const deck = (f: string) => (JSON.parse(readFileSync(new URL(`../../data/meta-decks/${f}`, import.meta.url), 'utf8')) as { deck: DeckList }).deck;
const newGame = (seed: number): GameState => createGame({ seed, cardDb: db, battlefieldSelection: 'random', firstPlayer: 0,
  players: [{ name: 'A', deck: deck('06-kai-sa.json') }, { name: 'B', deck: deck('04-rek-sai.json') }] });

test('determinize keeps public info and own hand, resamples hidden cards', () => {
  let g = newGame(3);
  for (let i = 0; i < 6 && g.pending; i++) g = applyAction(g, new SearchAI({ seed: i }).choose(g, g.pending.player)!).state;
  const d = determinize(g, 0, makeRng(7));
  assert.deepEqual(d.players.map(p => p.hand.length), g.players.map(p => p.hand.length));
  for (const id of g.players[0].hand) assert.equal(d.objects[id].cardId, g.objects[id].cardId, 'own hand unchanged');
  for (const o of Object.values(g.objects)) if (['base', 'battlefield', 'trash', 'legendZone', 'championZone'].includes(o.zone)) assert.equal(d.objects[o.id].cardId, o.cardId);
  // the multiset of the opponent's hidden cards is preserved
  const pool = (s: GameState) => [...s.players[1].hand, ...s.players[1].mainDeck].map(id => s.objects[id].cardId).sort();
  assert.deepEqual(pool(d), pool(g));
  assert.equal(evaluate(d, 0), evaluate(g, 0), 'evaluation only reads public information');
});

test('search AI answers every decision with a valid action', () => {
  let g = newGame(11);
  const ais = [new SearchAI({ seed: 1, maxNodes: 12 }), new SearchAI({ seed: 2, maxNodes: 12 })];
  for (let i = 0; i < 60 && g.winner === null; i++) {
    const p = g.pending!.player;
    const a = ais[p].choose(g, p);
    assert.ok(a, 'an action');
    assert.equal(validateAction(g, a!), null);
    g = applyAction(g, a!).state;
  }
});

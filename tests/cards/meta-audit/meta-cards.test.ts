// META-AUDIT: cards of the Bologna meta lists that had no test of their own.
import { test } from 'node:test';
import { game, mana, play, canPlay, put, handCard, assert, M, act, getLegalActions, noRunes } from '../B3/util.ts';

test('Inferna (unl-002, keyword-only): Ambush into a combat at a battlefield where you have units; Assault 2 while attacking', () => {
  let g = game();
  noRunes(g, 0);
  mana(g, 0, 2, 'Fury');
  const a = put(g, 0, 't-u3', 'base');
  put(g, 1, 't-u4', 1);
  const inf = handCard(g, 0, 'unl-002-219');
  g = act(g, { type: 'move', player: 0, units: [a], to: 1 });
  // the attacker's showdown priority: Inferna can be played as a [Reaction] to battlefield 1 (P0 has a unit there)
  for (let i = 0; i < 6 && g.pending && !(g.pending.player === 0 && !g.pending.inStep && getLegalActions(g, 0).some(x => x.type === 'playCard' && x.obj === inf)); i++) {
    const d = g.pending;
    g = act(g, getLegalActions(g, d.player).find(x => x.type === 'pass') ?? getLegalActions(g, d.player)[0]);
  }
  assert.ok(canPlay(g, 0, inf), 'Ambush: playable in the showdown');
  const dests = getLegalActions(g, 0).filter(x => x.type === 'playCard' && x.obj === inf).map(x => (x as { destination?: unknown }).destination);
  assert.ok(dests.includes(1), `to the battlefield (got ${JSON.stringify(dests)})`);
  g = play(g, 0, inf, { destination: 1 });
  for (let i = 0; i < 6 && g.pending && g.pending.kind === 'chainResponse'; i++) g = act(g, { type: 'pass', player: g.pending.player });
  assert.equal(g.objects[inf].zone, 'battlefield');
  assert.equal(M(g, inf), 3, '1 + Assault 2 as an attacker');
});

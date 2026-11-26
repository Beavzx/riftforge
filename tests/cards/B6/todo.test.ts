// B6 edges that need engine/DSL support (see docs/dsl-requests.md, "B6" entries). Marked todo.
import { test } from 'node:test';
import { game, addRunes, exhaustRunes, play, playObj, put, ready, assert, moveUnits, drive, legalActivate } from './_h.ts';
import { card, costModDyn } from '../../../src/cards/dsl.ts';
import { extra } from './_h.ts';

// a test gear: "Spells you play cost [2] less."
extra['t-b6-discounter'] = { ...extra['t-b6-gear2'], id: 't-b6-discounter', name: 't-b6-discounter' };
card('t-b6-discounter', '', [costModDyn((ctx, id) => (ctx.type(id) === 'Spell' && ctx.ctrl(ctx.self) === ctx.data.payer ? { energy: -2 } : null))]);

// RULINGS: "spent [4] or more" is the Energy actually paid (play event `paid`)
test('Revna: a [4]+ spell played for less than [4] does not ready her', () => {
  let g = game({ });
  g.cards['t-b6-discounter'] = extra['t-b6-discounter'];
  addRunes(g, 0, 6);
  const rv = put(g, 0, 'unl-005-219', 'base', { ready: false });
  put(g, 0, 't-b6-discounter', 'base');
  ({ g } = play(g, 0, 't-b6-spell4', undefined));   // pays [2]
  assert.equal(ready(g, rv), false);
});

test('Red Brambleback: Hunt (a conquer effect) also triggers an additional time', () => {
  let g = game();
  const rb = put(g, 0, 'unl-029-219', 'base');
  const h = put(g, 0, 't-hunt', 'base');
  g = moveUnits(g, 0, [rb, h], 0);
  // the conquer triggers (Brambleback's buff twice, Hunt 2 twice) are ordered, then the buff targets chosen
  for (let i = 0; i < 12 && g.pending?.inStep; i++) g = drive(g, g.pending.kind === 'chooseTargets' ? rb : g.pending.options![0].id);
  g = drive(g);
  assert.equal(g.players[0].xp, 4, 'Hunt 2 twice');
});

test("Hungry Wolf: enemy choices made before it left the deck count", () => {
  let g = game();
  exhaustRunes(g, 0);
  addRunes(g, 0, 10, 'Order');
  const e = put(g, 1, 't-u2', 0);
  const f = put(g, 0, 't-u1', 'base');
  const w = put(g, 0, 'ven-125-166', 'deckTop');
  ({ g } = play(g, 0, 't-b6-shrink', undefined, e));
  ({ g } = play(g, 0, 'ogn-058-298', undefined, f));      // Discipline: draws the Wolf
  assert.equal(g.objects[w].zone, 'hand');
  g = playObj(g, 0, w, 'base');
  assert.ok(legalActivate(g, 0, w), 'an enemy unit was chosen this turn');
});

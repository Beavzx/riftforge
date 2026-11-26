// RULINGS agent: tests encoding researched rulings for B6 cards (see docs/rulings.md).
import { test } from 'node:test';
import { game, addRunes, exhaustRunes, play, doAct, put, handCard, M, ready, pendingIds, assert, zoneOf, act, drive } from './_h.ts';

// Unleashed Rules FAQ (Ekko, Recurrent): "Recycle me" is the Deathknell's base cost, paid as the trigger goes on the chain.
test('RULING ogn-110 Ekko, Recurrent: recycled when the Deathknell goes on the chain, runes readied on resolution', () => {
  let g = game();
  const e = put(g, 0, 'ogn-110-298', 'base');
  const rs = addRunes(g, 0, 3); for (const r of rs) g.objects[r].exhausted = true;
  g.objects[e].damage = 9; g.ex.dirty = true;
  g = act(g, { type: 'playCard', player: 0, obj: handCard(g, 0, 't-b6-spell1') });
  for (let i = 0; i < 20 && !(g.pending?.inStep && g.pending.kind === 'optional'); i++) g = drive(g);
  assert.equal(g.pending?.kind, 'optional');
  g = act(g, { type: 'choose', player: 0, optionIds: ['yes'] } as never);
  assert.equal(zoneOf(g, e), 'mainDeck', 'cost already paid');
  assert.ok(g.chain.some(c => c.kind === 'trigger'), 'trigger still on the chain');
  assert.ok(rs.every(r => !ready(g, r)), 'runes not readied yet');
  g = drive(g);
  assert.ok(rs.every(r => ready(g, r)));
});

// Origins FAQ (Sona) / CR 355.5: "ready up to N runes" chooses its runes as targets when played — before costs are paid.
test('RULING rad-032 Battle Preparations: runes are chosen as it is played (a rune used to pay for it can be chosen)', () => {
  let g = game();
  exhaustRunes(g, 0);
  const rs = addRunes(g, 0, 2, 'Calm');
  const gear = put(g, 0, 't-b6-gear2', 'base');
  const a = put(g, 0, 't-u2', 'base');
  g = act(g, { type: 'playCard', player: 0, obj: handCard(g, 0, 'rad-032-167') });
  g = drive(g, [gear]);                 // Show Off the gear; the only unit is auto-targeted
  assert.equal(g.pending?.kind, 'chooseTargets', 'rune targets are chosen while playing, before payment');
  assert.ok(rs.every(r => pendingIds(g).includes(r) && ready(g, r)), 'still-ready runes are offered');
  g = drive(g, rs);
  assert.equal(M(g, a), 4);
  assert.ok(rs.every(r => ready(g, r)));
});

test('RULING unl-104 Gentle Gemdragon: runes are targets chosen as the play trigger goes on the chain', () => {
  let g = game();
  exhaustRunes(g, 0);
  const rs = addRunes(g, 0, 8, 'Body');
  g = act(g, { type: 'playCard', player: 0, obj: handCard(g, 0, 'unl-104-219'), destination: 'base' } as never);
  for (let i = 0; i < 10 && !g.pending?.inStep; i++) g = drive(g);
  assert.equal(g.pending?.kind, 'chooseTargets');
  g = drive(g, rs.slice(0, 2));
  assert.equal(rs.filter(r => ready(g, r)).length >= 2, true);
});

// CR 355.5: "another friendly unit" is a specific object chosen on play, so it is targeted (emits a targeted event).
test('RULING ogn-108 Convergent Mutation: the other friendly unit is a target', () => {
  let g = game();
  addRunes(g, 0, 6, 'Mind');
  const a = put(g, 0, 't-u2', 'base'), b = put(g, 0, 't-u5', 'base'), c = put(g, 0, 't-u1', 'base');
  g = act(g, { type: 'playCard', player: 0, obj: handCard(g, 0, 'ogn-108-298') });
  g = drive(g, a);
  assert.equal(g.pending?.kind, 'chooseTargets');
  g = act(g, { type: 'choose', player: 0, optionIds: [b] } as never);
  assert.ok(g.ex.lastEvents.some(ev => ev.type === 'targeted' && ev.obj === b), 'b became a target ("when chosen" sees it)');
  g = drive(g);
  assert.equal(M(g, a), 5);
  void c;
});

// Origins FAQ (Darius, Trifarian): play triggers are checked right after the play, with the played unit on the board —
// so "When you play a card" sees Guidebot's own play.
test('RULING rad-057 Piltovan Guidebot: its own play counts as "you play a card"', () => {
  let g = game();
  addRunes(g, 0, 8);
  ({ g } = play(g, 0, 'rad-057-167', 'base', 'yes'));
  const id = g.players[0].base.find(x => g.objects[x].cardId === 'rad-057-167') ?? Object.keys(g.objects).find(x => g.objects[x].cardId === 'rad-057-167')!;
  assert.equal(M(g, id), g.cards['rad-057-167'].energy, 'base Might became its own Energy cost');
});
void doAct;

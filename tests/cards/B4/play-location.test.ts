// B4: play-location permissions ("you may play me to ...") and other hand-zone rules.
// Self play locations are play rules active in hand (activeIn: ['hand']). Rengar, Trophy Hunter still needs an
// engine hook for Ambush timing at extra destinations (docs/dsl-requests.md B4 #2): marked todo.
import { test } from 'node:test';
import {
  assert, game, put, runes, handCard, setController, play, settle, domainRunes, getLegalActions, act, move, loc, toTurnOf,
  zoneOf, pend,
} from './_util.ts';
import type { GameState, ObjId, PlayerId } from './_util.ts';

const dests = (g: GameState, p: PlayerId, obj: ObjId) =>
  getLegalActions(g, p).filter(a => a.type === 'playCard' && a.obj === obj).map(a => (a as { destination?: number | 'base' }).destination);

test('Miss Fortune, Buccaneer: friendly units may be played to open battlefields while she is on the board', () => {
  const g = game();
  runes(g, 0, 2);
  const u = handCard(g, 0, 't-u2');
  assert.deepEqual(dests(g, 0, u), ['base']);
  put(g, 0, 'ogn-193-298', 'base');
  assert.deepEqual(dests(g, 0, u).sort(), [0, 1, 'base'].sort());
  // occupied / controlled battlefields are not open
  put(g, 1, 't-u1', 1);
  assert.deepEqual(dests(g, 0, u).sort(), [0, 'base'].sort());
  // the opponent's units don't get the permission
  runes(g, 1, 2);
  const v = handCard(g, 1, 't-u2');
  assert.ok(!getLegalActions(g, 1).length || !dests(g, 1, v).includes(0));
});

test('Miss Fortune, Buccaneer: a unit played to an open battlefield contests and conquers it', () => {
  let g = game();
  runes(g, 0, 2);
  put(g, 0, 'ogn-193-298', 'base');
  const u = handCard(g, 0, 't-u2');
  g = settle(play(g, 0, u, 1));
  assert.equal(loc(g, u), 1);
  assert.equal(g.battlefields[1].controller, 0);
  assert.equal(g.players[0].points, 1);
});

for (const [id, name, dom] of [['ogn-174-298', 'Sai Scout', 'Chaos'], ['ogn-176-298', 'Sneaky Deckhand', 'Chaos'], ['ogn-193-298', 'Miss Fortune, Buccaneer', 'Chaos'], ['ven-115-166', 'Ocean Drake', 'Chaos']] as const) {
  test(`${name}: may be played to an open battlefield`, () => {
    const g = game();
    runes(g, 0, 8); domainRunes(g, 0, 2, dom);
    const c = handCard(g, 0, id);
    assert.ok(dests(g, 0, c).includes(1));
    put(g, 1, 't-u1', 1);
    assert.ok(!dests(g, 0, c).includes(1), 'occupied: not open');
  });
}

for (const [id, name, dom] of [['ogn-161-298', 'Deadbloom Predator', 'Body'], ['sfd-093-221', 'Dauntless Vanguard', 'Body']] as const) {
  test(`${name}: may be played to an occupied enemy battlefield`, () => {
    const g = game();
    runes(g, 0, 8); domainRunes(g, 0, 2, dom);
    const c = handCard(g, 0, id);
    setController(g, 1, 1);
    assert.ok(!dests(g, 0, c).includes(1), 'enemy battlefield without units is not occupied');
    put(g, 1, 't-u1', 1);
    assert.ok(dests(g, 0, c).includes(1));
  });
}

test('Rengar, Pouncing: can be played to a battlefield you are attacking (Reaction)', () => {
  let g = game();
  const a = put(g, 0, 't-u3', 'base');
  put(g, 1, 't-u5', 0); setController(g, 0, 1);
  runes(g, 0, 3); domainRunes(g, 0, 1, 'Fury');
  const r = handCard(g, 0, 'sfd-025-221');
  g = move(g, 0, [a], 0);
  assert.ok(dests(g, 0, r).includes(0));
});

test('Rengar, Trophy Hunter: can Ambush to a battlefield with enemy units even without your units there', () => {
  let g = game();
  g = toTurnOf(g, 1);
  put(g, 1, 't-u2', 0); setController(g, 0, 1);
  runes(g, 0, 5); domainRunes(g, 0, 1, 'Body');
  const r = handCard(g, 0, 'unl-120-219');
  const atk = put(g, 1, 't-u2', 'base');
  setController(g, 1, 0); put(g, 0, 't-u1', 1);
  g = move(g, 1, [atk], 1);
  for (let i = 0; i < 10 && !(g.pending?.player === 0 && g.pending.kind === 'showdownAction'); i++) g = act(g, { type: 'pass', player: g.pending!.player });
  assert.ok(dests(g, 0, r).includes(0), 'enemy units at battlefield 0, none of yours');
});

test('Perched Grimwyrm: can only be played to a battlefield you conquered this turn', () => {
  let g = game();
  runes(g, 0, 5); domainRunes(g, 0, 1, 'Fury');
  setController(g, 0, 0); put(g, 0, 't-u1', 0);
  const w = handCard(g, 0, 'sfd-015-221');
  assert.deepEqual(dests(g, 0, w), [], 'nothing conquered yet');
  const u = put(g, 0, 't-u1', 'base');
  g = settle(move(g, 0, [u], 1));
  assert.deepEqual(dests(g, 0, w), [1]);
});

test('Shadow Watcher: enters ready if a friendly unit died during your Beginning Phase this turn', () => {
  let g = game();
  put(g, 0, 't-temp', 'base');               // Temporary: dies at the start of your Beginning Phase
  g = act(g, { type: 'endTurn', player: 0 });
  g = settle(g, 1);
  g = act(g, { type: 'endTurn', player: 1 });
  g = settle(g, 0);
  runes(g, 0, 4); domainRunes(g, 0, 1, 'Calm');
  const w = handCard(g, 0, 'unl-037-219');
  g = play(g, 0, w, 'base');
  assert.equal(g.objects[w].exhausted, false);
});

test('Shadow Watcher: enters exhausted when no friendly unit died this turn', () => {
  let g = game();
  runes(g, 0, 4); domainRunes(g, 0, 1, 'Calm');
  const w = handCard(g, 0, 'unl-037-219');
  g = play(g, 0, w, 'base');
  assert.equal(g.objects[w].exhausted, true);
  void zoneOf; void pend;
});

test('Rengar, Trophy Hunter: in your Main Phase he can be played to a battlefield with only enemy units', () => {
  const g = game();
  runes(g, 0, 5); domainRunes(g, 0, 1, 'Body');
  const r = handCard(g, 0, 'unl-120-219');
  assert.ok(!dests(g, 0, r).includes(0));
  put(g, 1, 't-u2', 0); setController(g, 0, 1);
  assert.ok(dests(g, 0, r).includes(0));
});

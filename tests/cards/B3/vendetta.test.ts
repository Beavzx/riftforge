// B3: Vendetta (ven) cards.
import { test } from 'node:test';
import {
  game, mana, run, expectDecision, play, activate, canPlay, canActivate, tokens, tokensAt, put, putToken, handCard, zoneOf, setController, assert, M, kw,
  controlBf, slay, move, endTurn, act, choose, noRunes, getLegalActions,
} from './util.ts';

test('Zed, From the Shadows (ven-023): optional discard 1 as additional cost -> a 0 Might Shadow Clone', () => {
  let g = game();
  mana(g, 0, 3, 'Fury');
  const z = handCard(g, 0, 'ven-023-166');
  const fodder = handCard(g, 0, 't-u1');
  g = play(g, 0, z, { destination: 'base' });
  expectDecision(g, 'optional', 0);
  g = run(g, 'yes', [fodder]);
  assert.equal(zoneOf(g, fodder), 'trash');
  const [c] = tokens(g, 0, 'Shadow Clone');
  assert.ok(c);
  assert.equal(M(g, c), 0);
  let h = game();
  mana(h, 0, 3, 'Fury');
  const z2 = handCard(h, 0, 'ven-023-166');
  h = play(h, 0, z2, { destination: 'base' });
  h = run(h, 'no');
  assert.equal(tokens(h, 0, 'Shadow Clone').length, 0);
});

test('Shadow Clone token: when it attacks, may banish a unit from your trash for Assault 4', () => {
  let g = game();
  const c = putToken(g, 0, 'tok-shadow-clone', 'base');
  const dead = put(g, 0, 't-u1', 'trash');
  controlBf(g, 1, 0, 't-u3');
  g = act(g, { type: 'move', player: 0, units: [c], to: 0 });
  g = run(g, 'yes');
  assert.equal(zoneOf(g, dead), 'banishment');
});

test('Iterative Design (ven-051): a Mech; Flow [2][C] from the trash, then banished', () => {
  let g = game();
  mana(g, 0, 2);
  const s = handCard(g, 0, 'ven-051-166');
  g = play(g, 0, s);
  g = run(g);
  assert.equal(tokens(g, 0, 'Mech').length, 1);
  assert.equal(zoneOf(g, s), 'trash');
  mana(g, 0, 2, 'Mind');
  assert.ok(canPlay(g, 0, s), 'Flow from trash');
  g = play(g, 0, s);
  g = run(g);
  assert.equal(tokens(g, 0, 'Mech').length, 2);
  assert.equal(zoneOf(g, s), 'banishment');
});

test('Jayce (ven-068): on play, may ready something exhausted (a rune); also the first non-token gear each turn', () => {
  let g = game();
  noRunes(g, 0);
  mana(g, 0, 6, 'Mind');
  const j = handCard(g, 0, 'ven-068-166');
  g = play(g, 0, j, { destination: 'base' });
  g = run(g);
  // RULINGS (CR 355.5 / 403.2): the exhausted thing is a target chosen as the trigger goes on the chain
  const opts = expectDecision(g, 'chooseTargets', 0);
  assert.ok(!opts.includes(j), 'besides me');
  assert.equal(g.pending!.min, 0);
  const r = g.players[0].runesInPlay[0];
  assert.ok(g.objects[r].exhausted);
  assert.ok(opts.includes(r), 'runes can be chosen');
  g = run(g, [r]);
  assert.equal(g.objects[r].exhausted, false);
  // first non-token gear: triggers; second: doesn't; a gear token doesn't count
  mana(g, 0, 2);
  g = play(g, 0, handCard(g, 0, 'rad-100-167'));    // Gold token (gear token): not a trigger
  g = run(g);
  g = play(g, 0, handCard(g, 0, 'ts-sword'));
  g = run(g);
  expectDecision(g, 'chooseTargets', 0);
  g = run(g, []);
  mana(g, 0, 1);
  g = play(g, 0, handCard(g, 0, 'ts-sword'));
  g = run(g);
  assert.equal(g.pending?.kind, 'mainAction', 'second gear: no trigger');
});

test('Hextech Disc (ven-087): disempower, [1], [T]: a Mech to your base (needs to be Empowered)', () => {
  let g = game();
  const d = put(g, 0, 'ven-087-166', 'base');
  assert.ok(kw(g, d, 'Empower'));
  assert.ok(!getLegalActions(g, 0).some(a => a.type === 'activate' && a.obj === d && a.abilityIndex === 0), 'not Empowered');
  g.objects[d].empowered = 1; g.ex.dirty = true;
  g = activate(g, 0, d, 0);
  g = run(g);
  assert.equal(tokensAt(g, 0, 'Mech', 'base').length, 1);
  assert.ok(!g.objects[d].empowered);
});

test('Up from the Deep (ven-100): two 1 Might Tentacles from Bilgewater', () => {
  let g = game();
  mana(g, 0, 1);
  g = play(g, 0, handCard(g, 0, 'ven-100-166'));
  g = run(g);
  const ts = tokens(g, 0, 'Tentacle');
  assert.equal(ts.length, 2);
  assert.equal(M(g, ts[0]), 1);
  assert.ok(g.objects[ts[0]] && g.cards[g.objects[ts[0]].cardId].tags.includes('Bilgewater'));
});

test('Illaoi (ven-109): Tentacle on play and when she scores; +1 per token unit you control', () => {
  let g = game();
  mana(g, 0, 4);
  const i = handCard(g, 0, 'ven-109-166');
  g = play(g, 0, i, { destination: 'base' });
  g = run(g);
  assert.equal(tokens(g, 0, 'Tentacle').length, 1);
  assert.equal(M(g, i), 5);
  putToken(g, 1, 'ven-t04', 'base');
  assert.equal(M(g, i), 5, 'enemy tokens do not count');
  g.objects[i].exhausted = false;
  g = move(g, 0, [i], 0, 'base');
  assert.equal(g.battlefields[0].controller, 0);
  assert.equal(tokens(g, 0, 'Tentacle').length, 2, 'scored (conquer)');
});

test('Zed, Without a Sound (ven-112): conquer -> Shadow Clone; [Action] [1][C]: swap places with a Shadow Clone', () => {
  let g = game();
  const z = put(g, 0, 'ven-112-166', 'base');
  g = move(g, 0, [z], 0);
  const [c] = tokensAt(g, 0, 'Shadow Clone', 'base');
  assert.ok(c);
  assert.ok(!canActivate(g, 0, z), 'no Chaos power');
  mana(g, 0, 1, 'Chaos');
  g = activate(g, 0, z);
  g = run(g);
  assert.equal(zoneOf(g, z), 'base');
  assert.equal(g.objects[c].battlefieldIndex, 0);
});

test('Ki Barrier (ven-126): prevent the next 7 damage to a unit this turn', () => {
  let g = game();
  mana(g, 0, 1, 'Order');
  const u = put(g, 0, 't-u3', 'base');
  g = play(g, 0, handCard(g, 0, 'ven-126-166'));
  if (g.pending?.kind === 'chooseTargets') g = choose(g, u);
  g = run(g);
  for (let i = 0; i < 4; i++) {
    mana(g, 0, 1);
    g = play(g, 0, handCard(g, 0, 'ts-zap'));
    if (g.pending?.kind === 'chooseTargets') g = choose(g, u);
    g = run(g);
  }
  assert.equal(zoneOf(g, u), 'base');
  assert.equal(g.objects[u].damage, 1, '8 dealt, 7 prevented');
});

test('Noxian Emissary (ven-128): only while Empowered, Deathknell — two Recruits to your base', () => {
  let g = game();
  const e = put(g, 1, 'ven-128-166', 'base');
  g.objects[e].empowered = 1;
  g = slay(g, 0, e);
  assert.equal(tokensAt(g, 1, 'Recruit', 'base').length, 2);
  let h = game();
  const e2 = put(h, 1, 'ven-128-166', 'base');
  h = slay(h, 0, e2);
  assert.equal(tokens(h, 1, 'Recruit').length, 0);
});

test('Sacred Protector (ven-129): deals combat damage only with exactly one other unit you control there', () => {
  let g = game();
  controlBf(g, 1, 0, 't-u3');
  const sp = put(g, 0, 'ven-129-166', 'base');
  g = move(g, 0, [sp], 0);
  assert.equal(g.battlefields[0].controller, 1, 'no damage dealt alone: defender survives');
  let h = game();
  const d = controlBf(h, 1, 0, 't-u3');
  const sp2 = put(h, 0, 'ven-129-166', 'base'), buddy = put(h, 0, 't-u1', 'base');
  h = move(h, 0, [sp2, buddy], 0);
  assert.equal(zoneOf(h, d), 'trash');
});

void setController; void endTurn; void noRunes;

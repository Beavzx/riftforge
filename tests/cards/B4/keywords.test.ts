// B4: engine keywords on batch cards (no script needed, but each must work on these cards).
import { test } from 'node:test';
import {
  assert, game, put, runes, handCard, setController, play, mightOf, kwVal, hasKw, answer, pend, settle, optIds, choose,
  zoneOf, loc, domainRunes, drainRunes, act, resolveAll, getLegalActions, move, passChain, combatSetup, attack, toTurnOf,
} from './_util.ts';

test('Stormclaw Ursine: Tank must be assigned lethal first; when played, channel 1 rune exhausted', () => {
  let g = game();
  runes(g, 0, 7); domainRunes(g, 0, 1, 'Body');
  const n = g.players[0].runesInPlay.length;
  const s = handCard(g, 0, 'ogn-137-298');
  g = resolveAll(play(g, 0, s, 'base'));
  assert.equal(g.players[0].runesInPlay.length, n + 1);
  assert.equal(g.objects[g.players[0].runesInPlay.at(-1)!].exhausted, true);
  let h = game();
  const { atk, def } = combatSetup(h, ['t-u3'], ['ogn-137-298', 't-u1']);
  h = settle(attack(h, atk));
  assert.equal(zoneOf(h, def[1]), 'battlefield', 'the 1-Might unit is protected by the Tank');
});

test("Kai'Sa, Survivor: Accelerate — pay [1][C] more to enter ready", () => {
  let g = game();
  runes(g, 0, 5); domainRunes(g, 0, 1, 'Fury');
  const k = handCard(g, 0, 'ogn-039-298');
  g = play(g, 0, k, 'base');
  g = answer(g, 'optional', 'yes');
  assert.equal(g.objects[k].exhausted, false);
});

test('Sai Scout: Vision — look at the top card when played, may recycle it', () => {
  let g = game();
  runes(g, 0, 6);
  const top = g.players[0].mainDeck[0];
  g = play(g, 0, handCard(g, 0, 'ogn-174-298'), 'base');
  g = passChain(g);
  assert.equal(pend(g).kind, 'chooseCards');
  g = choose(g, top);
  assert.equal(g.players[0].mainDeck.at(-1), top);
});

test('Evelynn, In Control: Disarm — attacking gives an enemy unit here -1 this turn', () => {
  let g = game();
  const { atk, def } = combatSetup(g, ['rad-109-167'], ['t-u5']);
  g = passChain(attack(g, atk));
  assert.equal(mightOf(g, def[0]), 4);
});

test('Qiyana: Deflect — opponents pay [A] more to choose her', () => {
  let g = game();
  drainRunes(g, 0);
  domainRunes(g, 0, 3, 'Calm');
  const q = put(g, 1, 'ogn-155-298', 'base');
  const other = put(g, 1, 't-u2', 'base');
  g = play(g, 0, handCard(g, 0, 'ogn-050-298'));
  g = answer(g, 'chooseTargets', q);
  g = resolveAll(g);
  assert.equal(g.objects[q].stunned, true);
  assert.equal(g.players[0].runesInPlay.length, 3, '2 power recycled (C + Deflect A)');
  let h = game();
  drainRunes(h, 0);
  domainRunes(h, 0, 3, 'Calm');
  put(h, 1, 'ogn-155-298', 'base');
  const o2 = put(h, 1, 't-u2', 'base');
  h = play(h, 0, handCard(h, 0, 'ogn-050-298'));
  h = answer(h, 'chooseTargets', o2);
  h = resolveAll(h);
  assert.equal(h.players[0].runesInPlay.length, 4);
  void other;
});

test('Fight or Flight: Hidden — hide for [A], then play it from face down for free at Reaction speed later', () => {
  let g = game();
  setController(g, 0, 0);
  put(g, 0, 't-u2', 0);
  runes(g, 0, 2);
  const f = handCard(g, 0, 'ogn-168-298');
  g = act(g, { type: 'hide', player: 0, obj: f, battlefieldIndex: 0 });
  assert.equal(zoneOf(g, f), 'facedown');
  g = toTurnOf(g, 1);
  const e = put(g, 1, 't-u3', 'base');
  g = move(g, 1, [e], 0);
  for (let i = 0; i < 10 && !(g.pending?.player === 0 && (g.pending.kind === 'showdownAction' || g.pending.kind === 'chainResponse')); i++) g = act(g, { type: 'pass', player: g.pending!.player });
  drainRunes(g, 0);
  assert.ok(getLegalActions(g, 0).some(a => a.type === 'playCard' && a.obj === f), 'free from hiding');
  g = play(g, 0, f);
  g = answer(g, 'chooseTargets', e);
  g = passChain(g);
  assert.equal(loc(g, e), 'base');
});

test('Shadow Dash: Flow — playable from the trash for [5][A][A], then banished', () => {
  let g = game();
  runes(g, 0, 5); domainRunes(g, 0, 2, 'Calm');
  setController(g, 0, 0); put(g, 0, 't-u1', 0);
  const e = put(g, 1, 't-u2', 'base');
  const s = put(g, 0, 'ven-148-166', 'trash');
  assert.ok(getLegalActions(g, 0).some(a => a.type === 'playCard' && a.obj === s));
  g = play(g, 0, s);
  g = resolveAll(g);
  assert.equal(loc(g, e), 0);
  assert.equal(zoneOf(g, s), 'banishment');
});

test('Demacian Standard: Deploy — played only to battlefields (even uncontrolled); killed when an opponent holds there', () => {
  let g = game();
  runes(g, 0, 2); domainRunes(g, 0, 1, 'Body');
  const s = handCard(g, 0, 'rad-156-167');
  const ds = getLegalActions(g, 0).filter(a => a.type === 'playCard' && a.obj === s).map(a => (a as { destination?: unknown }).destination);
  assert.ok(!ds.includes('base'));
  assert.ok(ds.includes(1));
  g = play(g, 0, s, 1);
  assert.equal(loc(g, s), 1);
  setController(g, 1, 1); put(g, 1, 't-u1', 1);
  g = act(g, { type: 'endTurn', player: 0 });
  g = passChain(g);
  g = settle(g, 1);
  assert.equal(zoneOf(g, s), 'trash');
});

test('Volibear: Shield 3 while defending, Tank', () => {
  let g = game();
  const { atk, def } = combatSetup(g, ['t-u1'], ['ogn-158-298']);
  g = passChain(attack(g, atk));
  assert.equal(mightOf(g, def[0]), 13);
  assert.ok(hasKw(g, def[0], 'Tank'));
});

test('Evelynn, Entrancing: Backline — must be assigned combat damage last', () => {
  let g = game();
  const { atk, def } = combatSetup(g, ['t-u2'], ['unl-141-219', 't-u5']);
  g = settle(attack(g, atk));
  assert.equal(zoneOf(g, def[0]), 'battlefield', 'all damage went to the non-Backline unit');
});

test('Flash: Reaction — can be played in response on the opponent\'s turn', () => {
  let g = game();
  g = toTurnOf(g, 1);
  setController(g, 0, 0);
  const u = put(g, 0, 't-u3', 0);
  runes(g, 0, 2); domainRunes(g, 0, 1, 'Chaos');
  const f = handCard(g, 0, 'ogs-011-024');
  runes(g, 1, 1);
  g = play(g, 1, handCard(g, 1, 'ts-zap'));
  if (pend(g).kind === 'chooseTargets') g = choose(g, u);
  for (let i = 0; i < 5 && !(g.pending?.player === 0); i++) g = act(g, { type: 'pass', player: g.pending!.player });
  assert.ok(getLegalActions(g, 0).some(a => a.type === 'playCard' && a.obj === f));
  g = play(g, 0, f);
  g = answer(g, 'chooseTargets', u);
  g = resolveAll(g);
  assert.equal(loc(g, u), 'base');
});

test('Master Yi, Honed: Ganking — standard move from battlefield to battlefield', () => {
  const g = game();
  setController(g, 0, 0);
  const y = put(g, 0, 'ogs-009-024', 0);
  const plain = put(g, 0, 't-u2', 0);
  const moves = getLegalActions(g, 0).filter(a => a.type === 'move');
  assert.ok(moves.some(a => a.type === 'move' && a.units.length === 1 && a.units[0] === y && a.to === 1));
  assert.ok(!moves.some(a => a.type === 'move' && a.units.includes(plain) && a.to === 1));
});

test('Vayne: Assault 3 adds +3 while attacking', () => {
  let g = game();
  const { atk } = combatSetup(g, ['ogn-035-298'], ['t-u5']);
  g = passChain(attack(g, atk));
  assert.equal(mightOf(g, atk[0]), 5);
  assert.equal(kwVal(g, atk[0], 'Assault'), 3);
});

test('Rune Prison: Action — playable in a showdown', () => {
  let g = game();
  const u = put(g, 0, 't-u1', 'base');
  runes(g, 0, 2); domainRunes(g, 0, 1, 'Calm');
  put(g, 1, 't-u2', 'base');
  const rp = handCard(g, 0, 'ogn-050-298');
  g = move(g, 0, [u], 1);
  assert.equal(pend(g).kind, 'showdownAction');
  assert.ok(getLegalActions(g, 0).some(a => a.type === 'playCard' && a.obj === rp));
});

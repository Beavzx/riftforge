// B3: engine keywords on B3 cards exercised in play, plus extra edge cases.
import { test } from 'node:test';
import { deflectCost } from '../../../src/engine/targets.ts';
import {
  game, mana, run, expectDecision, play, activate, tokens, tokensAt, put, putToken, handCard, zoneOf, assert, M, kw,
  controlBf, move, endTurn, act, getLegalActions, setLegend,
} from './util.ts';

test('Accelerate (Corina Veraza): pay [1][C] to enter ready', () => {
  let g = game();
  mana(g, 0, 7, 'Order', 'Order');
  const c = handCard(g, 0, 'sfd-179-221');
  g = play(g, 0, c, { destination: 'base' });
  expectDecision(g, 'optional', 0);
  g = run(g, 'yes');
  assert.equal(g.objects[c].exhausted, false);
});

test('Deflect (Bird token): opponents pay [A] to choose it', () => {
  const g = game();
  const b = putToken(g, 0, 'unl-t02', 'base');
  assert.equal(deflectCost(g, 1, [b]), 1);
  assert.equal(deflectCost(g, 0, [b]), 0);
});

test('Disarm (Clanging Sentry grants it to a Mech): attacking gives an enemy unit there -1 this turn', () => {
  let g = game();
  put(g, 0, 'rad-055-167', 'base');
  const m = putToken(g, 0, 'tok-mech', 'base');
  const e = controlBf(g, 1, 0, 't-u5');
  g = act(g, { type: 'move', player: 0, units: [m], to: 0 });
  g = run(g);
  // 3 (Mech) vs 5-1 = 4: the Mech dies, the enemy survives with 3 damage before healing
  assert.equal(zoneOf(g, m), 'gone');
  assert.equal(zoneOf(g, e), 'battlefield');
  assert.equal(M(g, e), 4, '-1 this turn');
  g = endTurn(g);
  assert.equal(M(g, e), 5, 'expired at end of turn');
});

test('Weaponmaster (Emperor of the Sands grants it): a Sand Soldier played may attach an Equipment', () => {
  let g = game();
  const leg = setLegend(g, 0, 'sfd-197-221');
  mana(g, 0, 4);
  const sw = handCard(g, 0, 'ts-sword');
  g = play(g, 0, sw);
  g = run(g);
  g = activate(g, 0, leg);
  g = run(g);
  expectDecision(g, 'chooseTargets', 0);          // R-10: chosen as the Weaponmaster trigger goes on the chain
  g = run(g, [sw]);
  const [s] = tokens(g, 0, 'Sand Soldier');
  assert.equal(g.objects[sw].attachedTo, s);
  assert.equal(M(g, s), 4);
});

test('Empower (Noxian Emissary): [1][C] empowers it, enabling the Deathknell', () => {
  let g = game();
  const e = put(g, 0, 'ven-128-166', 'base');
  mana(g, 0, 1, 'Order');
  const a = getLegalActions(g, 0).find(x => x.type === 'activate' && x.obj === e);
  assert.ok(a, 'Empower ability available');
  g = act(g, a!);
  g = run(g);
  assert.ok((g.objects[e].empowered ?? 0) > 0);
});

test('Lillia (unl-058): the +1 lasts this turn only', () => {
  let g = game();
  const l = put(g, 0, 'unl-058-219', 'base');
  mana(g, 0, 3);
  g = play(g, 0, handCard(g, 0, 'ogn-211-298'), { destination: 'base' });
  g = run(g);
  assert.equal(M(g, l), 5);
  g = endTurn(g);
  assert.equal(M(g, l), 4);
});

test('Draven (sfd-020): declining the [C] payment keeps him at 4', () => {
  let g = game();
  mana(g, 0, 0, 'Fury');
  controlBf(g, 1, 0, 't-u5');
  const d = put(g, 0, 'sfd-020-221', 'base');
  g = act(g, { type: 'move', player: 0, units: [d], to: 0 });
  g = run(g, 'no');
  assert.equal(zoneOf(g, d), 'trash', '4 into a 5: Draven dies');
  assert.equal(tokens(g, 0, 'Gold').length, 0, 'no combat won');
});

test('Ziggs, Explosive (rad-112): the +2 from killing a gear saves him on defence', () => {
  let g = game();
  controlBf(g, 1, 0);
  const z = put(g, 1, 'rad-112-167', 0);
  put(g, 1, 'ogn-212-298', 'base');
  const atk = put(g, 0, 't-u5', 'base');
  g = move(g, 0, [atk], 0, 'yes');
  assert.equal(zoneOf(g, z), 'battlefield', '6 Might survives 5 damage');
  assert.equal(g.battlefields[0].controller, 1);
  let h = game();
  controlBf(h, 1, 0);
  const z2 = put(h, 1, 'rad-112-167', 0);
  put(h, 1, 'ogn-212-298', 'base');
  const atk2 = put(h, 0, 't-u5', 'base');
  h = move(h, 0, [atk2], 0, 'no');
  assert.equal(zoneOf(h, z2), 'trash');
});

test('Hexplosive Minefield (rad-142): killing no Bombs makes nothing at end of turn', () => {
  let g = game();
  mana(g, 0, 1, 'Chaos');
  putToken(g, 0, 'tok-bomb', 0);
  g = play(g, 0, handCard(g, 0, 'rad-142-167'));
  g = run(g, []);
  g = endTurn(g);
  assert.equal(tokens(g, 0, 'Bomb').length, 1);
  assert.equal(g.pending?.kind, 'mainAction');
});

test('Heimerdinger + Renata: both replacements apply to a token (order chosen, Mech enters ready)', () => {
  let g = game();
  controlBf(g, 0, 0);
  put(g, 0, 'rad-132-167', 0);
  put(g, 0, 'sfd-171-221', 'base');
  mana(g, 0, 3);
  g = play(g, 0, handCard(g, 0, 'ogn-211-298'), { destination: 'base' });
  g = run(g);
  // first the order of replacement effects, then Heimerdinger's "may"
  const answers: string[] = [];
  for (let i = 0; i < 4 && g.pending?.inStep; i++) {
    const d = g.pending!;
    const pick = d.kind === 'optional' ? 'yes' : d.options![0].id;
    answers.push(d.kind);
    g = run(g, pick);
  }
  const [m] = tokensAt(g, 0, 'Mech', 'base');
  assert.ok(m, `Mech made (${answers.join(',')})`);
  assert.equal(g.objects[m].exhausted, false);
});

// B8 legends (Radiance, Spiritforged, Unleashed, Vengeance).
import { test } from 'node:test';
import {
  assert, game, setLegend, moveIn, endTurn, put, runes, onlyRunes, handCard, resolveAll, zoneOf, setController, yes, no, choose, act, play,
  activate, expectPending, optIds, might, hasKw, kwVal, getLegalActions, exhaustRunes, readyCount, mkObj, find,
} from './b8-util.ts';
import { card, mana, cost, pay } from '../../../src/cards/dsl.ts';
import { moveToZone } from '../../../src/engine/state.ts';
import { chars } from '../../../src/engine/chars.ts';
import type { GameState, ObjId, PlayerId } from '../../../src/engine/types.ts';

// test-only: the Gold token's mana ability (scripted by another batch in the real game)
card('t-gold', '[Reaction][>] Kill this, [T]: [Add] [A].', [mana(cost('[T]', pay.killSelf()), { power: ['A'] })]);

const canPlay = (g: GameState, p: PlayerId, obj: ObjId) => getLegalActions(g, p).some(a => a.type === 'playCard' && a.obj === obj);
const canAct = (g: GameState, p: PlayerId, obj: ObjId, idx?: number) => getLegalActions(g, p).some(a => a.type === 'activate' && a.obj === obj && (idx === undefined || a.abilityIndex === idx));
const legendOf = (g: GameState, p: PlayerId) => g.players[p].legend;

test('Boy Who Shattered Time: Empower [1],[T]; then Disempower,[T]: next unit costs [2][A] less and dies at end of turn', () => {
  let g = game();
  const l = setLegend(g, 0, 'rad-139-167');
  runes(g, 0, 1);
  assert.ok(canAct(g, 0, l, 901), 'Empower available');
  assert.equal(canAct(g, 0, l, 0), false, 'needs to be Empowered');
  g = activate(g, 0, l, 901);
  g = resolveAll(g);
  assert.equal(g.objects[l].empowered, 1);
  g.objects[l].exhausted = false;
  assert.equal(canAct(g, 0, l, 901), false, 'use only if not Empowered');
  g = activate(g, 0, l, 0);
  g = resolveAll(g);
  assert.equal(g.objects[l].empowered ?? 0, 0);
  onlyRunes(g, 0, 1);
  const u = handCard(g, 0, 't-u3');
  assert.ok(canPlay(g, 0, u), '3-cost unit for [1]');
  g = play(g, 0, u, 'base');
  g = resolveAll(g);
  const u2 = handCard(g, 0, 't-u1');
  runes(g, 0, 1);
  g = play(g, 0, u2, 'base');
  g = resolveAll(g);
  g = endTurn(g);
  g = resolveAll(g);
  assert.equal(zoneOf(g, u), 'trash', 'killed at end of turn');
  assert.equal(zoneOf(g, u2), 'base', 'only the next unit');
});

test('Iron Revenant: banish a unit/gear from trash, [T]: Add [A] for units or gear only', () => {
  let g = game();
  setLegend(g, 0, 'rad-143-167');
  onlyRunes(g, 0, 0);
  const dead = put(g, 0, 't-u2', 'trash');
  const u = handCard(g, 0, 'b8-u-pow'), s = handCard(g, 0, 'b8-s-pow');
  assert.ok(canPlay(g, 0, u));
  assert.equal(canPlay(g, 0, s), false, 'not for spells');
  g = play(g, 0, u, 'base');
  g = resolveAll(g);
  assert.equal(zoneOf(g, u), 'base');
  assert.equal(zoneOf(g, dead), 'banishment');
});

test('Iron Revenant: no unit or gear in trash, no mana', () => {
  const g = game();
  setLegend(g, 0, 'rad-143-167');
  onlyRunes(g, 0, 0);
  put(g, 0, 'b8-s1', 'trash');
  assert.equal(canPlay(g, 0, handCard(g, 0, 'b8-u-pow')), false);
});

test('Lady of Clockwork: at the start of your Main Phase, pay [1] to make a friendly gear a unit (Might = Energy cost) until you choose another', () => {
  let g = game();
  setLegend(g, 0, 'rad-145-167');
  const g1 = put(g, 0, 'b8-gear', 'base');
  g = endTurn(g); g = endTurn(g);
  g = resolveAll(g);
  expectPending(g, 'optional', /Lady of Clockwork/);
  g = yes(g);
  g = resolveAll(g);
  assert.equal(chars(g, g1).type, 'Unit');
  assert.equal(might(g, g1), 2);
  const g2 = put(g, 0, 'b8-gear7', 'base');
  g = endTurn(g); g = endTurn(g);
  g = resolveAll(g);
  g = yes(g);          // the current unit gear is not offered again, so the only choice (g2) is made automatically
  g = resolveAll(g);
  assert.equal(chars(g, g1).type, 'Gear', 'the previous gear stops being a unit');
  assert.equal(might(g, g2), 7);
});

test('Lady of Clockwork: declining does nothing; no gear, no question', () => {
  let g = game();
  setLegend(g, 0, 'rad-145-167');
  g = endTurn(g); g = endTurn(g); g = resolveAll(g);
  // RULINGS: the "you may pay [1]" is decided as the trigger goes on the chain (CR 383.3); the engine may still ask before
  // finding no gear to target (R-15), after which the trigger is removed (CR 403.4)
  if (g.pending?.kind === 'optional') { g = no(g); g = resolveAll(g); }
  assert.equal(g.pending?.kind, 'mainAction');
  const g1 = put(g, 0, 'b8-gear', 'base');
  g = endTurn(g); g = endTurn(g); g = resolveAll(g);
  g = no(g);
  assert.equal(chars(g, g1).type, 'Gear');
});

test('Pride of Nazumah: [1],[T]: a friendly unit gets "I have Assault equal to my Shield" this turn', () => {
  let g = game();
  setLegend(g, 0, 'rad-147-167');
  const u = put(g, 0, 't-shield', 'base');
  g = activate(g, 0, legendOf(g, 0));
  g = resolveAll(g);
  assert.equal(kwVal(g, u, 'Assault'), 2);
  g = endTurn(g);
  assert.equal(kwVal(g, u, 'Assault'), 0);
});

test('The Exile: units you play to battlefields you control enter ready; to base they enter exhausted', () => {
  let g = game();
  setLegend(g, 0, 'rad-149-167');
  setController(g, 1, 0);
  put(g, 0, 't-u1', 1);
  runes(g, 0, 4);
  const a = handCard(g, 0, 't-u2'), b = handCard(g, 0, 't-u2');
  g = play(g, 0, a, 1); g = resolveAll(g);
  g = play(g, 0, b, 'base'); g = resolveAll(g);
  assert.equal(g.objects[a].exhausted, false);
  assert.equal(g.objects[b].exhausted, true);
});

test('Starry-Eyed Songstress: exhaust it and three friendly units to play a spell for [2] less', () => {
  let g = game();
  const l = setLegend(g, 0, 'rad-151-167');
  const us = [0, 1, 2, 3].map(() => put(g, 0, 't-u1', 'base'));
  onlyRunes(g, 0, 2);
  g = play(g, 0, handCard(g, 0, 'b8-s2'));
  expectPending(g, 'optional', /Songstress/);
  g = yes(g);
  expectPending(g, 'chooseCards', /three/);
  g = choose(g, us[0], us[1], us[2]);
  g = resolveAll(g);
  assert.equal(readyCount(g, 0), 2, 'the spell cost [0]');
  assert.ok(g.objects[l].exhausted && us.slice(0, 3).every(u => g.objects[u].exhausted));
  assert.equal(g.objects[us[3]].exhausted, false);
});

test('Starry-Eyed Songstress: declining pays full; not offered without three ready units', () => {
  let g = game();
  setLegend(g, 0, 'rad-151-167');
  [0, 1, 2].map(() => put(g, 0, 't-u1', 'base'));
  onlyRunes(g, 0, 2);
  g = play(g, 0, handCard(g, 0, 'b8-s2'));
  g = resolveAll(no(g));
  assert.equal(readyCount(g, 0), 0);
  let h = game();
  setLegend(h, 0, 'rad-151-167');
  put(h, 0, 't-u1', 'base'); put(h, 0, 't-u1', 'base');
  onlyRunes(h, 0, 2);
  h = play(h, 0, handCard(h, 0, 'b8-s2'));
  assert.notEqual(h.pending?.kind, 'optional');
});

test('Starry-Eyed Songstress: a spell only affordable with the reduction', () => {
  const g = game();
  setLegend(g, 0, 'rad-151-167');
  [0, 1, 2].map(() => put(g, 0, 't-u1', 'base'));
  onlyRunes(g, 0, 0);
  assert.ok(canPlay(g, 0, handCard(g, 0, 'b8-s2')));
});

test("Agony's Embrace: once each turn, playing a card from face down draws 1 (and discards 1 if not your turn)", () => {
  let g = game();
  setLegend(g, 0, 'rad-153-167');
  setController(g, 1, 0);
  put(g, 0, 't-u1', 1);
  const fd = handCard(g, 0, 'b8-hideable');
  moveToZone(g, fd, 'facedown', { bf: 1, controller: 0 });
  g.objects[fd].hiddenTurn = 0;
  const h = g.players[0].hand.length;
  g = play(g, 0, fd);
  g = resolveAll(g);
  assert.equal(g.players[0].hand.length, h + 2, "spell's draw + Agony's draw, no discard on your turn");
});

test("Agony's Embrace: on the opponent's turn it also discards 1", () => {
  let g = game({ firstPlayer: 1 });
  setLegend(g, 0, 'rad-153-167');
  setController(g, 1, 0);
  put(g, 0, 't-u1', 1);
  const fd = handCard(g, 0, 'b8-hideable');
  moveToZone(g, fd, 'facedown', { bf: 1, controller: 0 });
  g.objects[fd].hiddenTurn = 0;
  // P1 plays a spell; P0 responds from face down (Hidden cards have Reaction)
  runes(g, 1, 2);
  g = play(g, 1, handCard(g, 1, 'b8-s1'));
  g = act(g, { type: 'pass', player: 1 });
  assert.equal(g.pending?.player, 0);
  const h = g.players[0].hand.length;
  g = play(g, 0, fd);
  g = resolveAll(g);
  expectPending(g, 'chooseCards', /Discard 1/);
  g = choose(g, g.pending!.options![0].id);
  g = resolveAll(g);
  assert.equal(g.players[0].hand.length, h + 1);
});

test('Exemplar of Demacia: playing a Deploy gear may exhaust it and pay [A] to move a friendly unit there', () => {
  let g = game();
  setLegend(g, 0, 'rad-155-167');
  const u = put(g, 0, 't-u2', 'base');
  runes(g, 0, 4);
  g = play(g, 0, handCard(g, 0, 'b8-deploy'), 1);
  g = resolveAll(g);
  expectPending(g, 'optional', /Exemplar/);
  g = yes(g);
  g = resolveAll(g);
  assert.equal(g.objects[u].battlefieldIndex, 1);
  assert.equal(g.objects[legendOf(g, 0)].exhausted, true);
});

test('Purifier: each of your Equipment gives the equipped unit Assault', () => {
  const g = game();
  setLegend(g, 0, 'sfd-183-221');
  const u = put(g, 0, 't-u2', 'base');
  const s1 = put(g, 0, 'b8-sword', 'base'), s2 = put(g, 0, 'b8-sword', 'base');
  g.objects[s1].attachedTo = u; g.ex.attachCount = 1;
  assert.equal(kwVal(g, u, 'Assault'), 1);
  g.objects[s2].attachedTo = u; g.ex.attachCount = 2;
  assert.equal(kwVal(g, u, 'Assault'), 2);
  const e = put(g, 1, 't-u2', 'base'), s3 = put(g, 1, 'b8-sword', 'base');
  g.objects[s3].attachedTo = e; g.ex.attachCount = 3;
  assert.equal(kwVal(g, e, 'Assault'), 0, "opponents' Equipment don't");
});

test('Glorious Executioner: winning a combat draws 1', () => {
  let g = game();
  setLegend(g, 0, 'sfd-185-221');
  setController(g, 1, 1);
  put(g, 1, 't-u1', 1);
  const h = g.players[0].hand.length;
  g = moveIn(g, 0, 1, 't-u5').g;
  g = resolveAll(g);
  assert.equal(g.players[0].hand.length, h + 1);
});

test('Fire Below the Mountain: [T]: Add [A] only for gear', () => {
  const g = game();
  setLegend(g, 0, 'sfd-189-221');
  onlyRunes(g, 0, 0);
  assert.ok(canPlay(g, 0, handCard(g, 0, 'b8-g-pow')));
  assert.equal(canPlay(g, 0, handCard(g, 0, 'b8-u-pow')), false);
});

test('Blade Dancer: when you choose a friendly unit, you may exhaust it and pay [A] to ready that unit', () => {
  let g = game();
  setLegend(g, 0, 'sfd-195-221');
  const u = put(g, 0, 't-u2', 'base', { ready: false });
  runes(g, 0, 3);
  g = play(g, 0, handCard(g, 0, 'b8-pump'));
  g = resolveAll(g);
  expectPending(g, 'optional', /Blade Dancer/);
  g = yes(g);
  g = resolveAll(g);
  assert.equal(g.objects[u].exhausted, false);
  assert.equal(might(g, u), 3);
  assert.equal(g.objects[legendOf(g, 0)].exhausted, true);
});

test('Blade Dancer: when you conquer, you may pay [1] to ready me', () => {
  let g = game();
  setLegend(g, 0, 'sfd-195-221');
  g.objects[legendOf(g, 0)].exhausted = true;
  g = moveIn(g, 0, 1).g;
  expectPending(g, 'optional', /ready Blade Dancer/);
  g = resolveAll(yes(g));
  assert.equal(g.objects[legendOf(g, 0)].exhausted, false);
});

test("Prodigal Explorer: [T] Draw 1, only after choosing enemy units/gear twice this turn", () => {
  let g = game();
  const l = setLegend(g, 0, 'sfd-199-221');
  const e = put(g, 1, 't-u5', 'base');
  runes(g, 0, 4);
  assert.equal(canAct(g, 0, l), false);
  g = play(g, 0, handCard(g, 0, 'b8-zap')); g = resolveAll(g);
  assert.equal(canAct(g, 0, l), false, 'once is not enough');
  g = play(g, 0, handCard(g, 0, 'b8-zap')); g = resolveAll(g);
  assert.equal(g.objects[e].damage, 2);
  assert.ok(canAct(g, 0, l));
  const h = g.players[0].hand.length;
  g = activate(g, 0, l); g = resolveAll(g);
  assert.equal(g.players[0].hand.length, h + 1);
});

test('Chem-Baroness: when you hold, may exhaust it to play a Gold token exhausted', () => {
  let g = game();
  setLegend(g, 0, 'sfd-201-221');
  setController(g, 1, 0);
  put(g, 0, 't-u2', 1);
  g = endTurn(g); g = endTurn(g);
  g = resolveAll(g);
  expectPending(g, 'optional', /Gold/);
  g = resolveAll(yes(g));
  const gold = find(g, 't-gold', 0);
  assert.equal(gold.length, 1);
  assert.equal(g.objects[gold[0]].exhausted, true);
});

test('Chem-Baroness: within 3 points of the Victory Score, your Gold adds an additional [1]', () => {
  for (const pts of [5, 4]) {
    let g = game();
    setLegend(g, 0, 'sfd-201-221');
    g.players[0].points = pts;
    onlyRunes(g, 0, 0);
    const gold = put(g, 0, 't-gold', 'base');
    g.objects[gold].isToken = true;
    g = play(g, 0, handCard(g, 0, 'b8-s-pow'));     // the auto-payer uses the Gold for the [C]
    assert.equal(g.objects[gold], undefined, 'the Gold was used (killed)');
    g = resolveAll(g);
    assert.equal(g.players[0].pool.energy, pts === 5 ? 1 : 0, 'the additional [1] (only near victory)');
  }
});

test('Chem-Baroness: activating a Gold token directly', () => {
  let g = game();
  setLegend(g, 0, 'sfd-201-221');
  g.players[0].points = 5;
  const gold = put(g, 0, 't-gold', 'base');
  g.objects[gold].isToken = true;
  g = resolveAll(activate(g, 0, gold));
  assert.equal(g.players[0].pool.energy, 1);
});

test('Grand Duelist: when one of your units becomes Mighty, may exhaust it to channel 1 rune exhausted', () => {
  let g = game();
  setLegend(g, 0, 'sfd-205-221');
  const u = put(g, 0, 't-u4', 'base');
  runes(g, 0, 2);
  const n = g.players[0].runesInPlay.length;
  g = play(g, 0, handCard(g, 0, 'b8-pump'));
  if (g.pending?.kind === 'chooseTargets') g = choose(g, u);
  g = resolveAll(g);
  expectPending(g, 'optional', /Grand Duelist/);
  g = resolveAll(yes(g));
  assert.equal(g.players[0].runesInPlay.length, n + 1);
});

test('Virtuoso: a spell you spent [4]+ on may be banished; at four, they go to the trash, channel 4 and draw 1', () => {
  let g = game();
  const l = setLegend(g, 0, 'unl-181-219');
  for (let i = 0; i < 3; i++) {
    const s = put(g, 0, 'b8-s5', 'trash');
    moveToZone(g, s, 'banishment');
    g.ex.links[s] = { by: l, epoch: g.objects[l].epoch ?? 0 };
  }
  runes(g, 0, 6);
  put(g, 0, 't-u1', 'base');
  const n = g.players[0].runesInPlay.length;
  const sp = handCard(g, 0, 'b8-pump5');
  g = play(g, 0, sp);
  g = resolveAll(g);
  expectPending(g, 'optional', /Virtuoso/);
  const h = g.players[0].hand.length;
  g = yes(g);
  g = resolveAll(g);
  assert.equal(zoneOf(g, sp), 'trash');
  assert.equal(g.players[0].trash.filter(id => g.objects[id].cardId === 'b8-s5').length, 3);
  assert.equal(g.players[0].runesInPlay.length, n + 4);
  assert.equal(g.players[0].hand.length, h + 1);
});

test('Virtuoso: cheap spells are not offered; banishing one keeps it linked', () => {
  let g = game();
  const l = setLegend(g, 0, 'unl-181-219');
  runes(g, 0, 8);
  put(g, 0, 't-u1', 'base');
  g = play(g, 0, handCard(g, 0, 'b8-pump')); g = resolveAll(g);
  assert.equal(g.pending?.kind, 'mainAction');
  const sp = handCard(g, 0, 'b8-pump5');
  g = play(g, 0, sp); g = resolveAll(g);
  g = yes(g); g = resolveAll(g);
  assert.equal(zoneOf(g, sp), 'banishment');
  assert.equal(g.ex.links[sp]?.by, l);
});

test('Pridestalker: when you play a unit, give a unit +1 this turn', () => {
  let g = game();
  setLegend(g, 0, 'unl-183-219');
  const other = put(g, 1, 't-u3', 'base');
  runes(g, 0, 2);
  const u = handCard(g, 0, 't-u2');
  g = play(g, 0, u, 'base');
  expectPending(g, 'chooseTargets', /\+1/);
  g = choose(g, other);
  g = resolveAll(g);
  assert.equal(might(g, other), 4);
});

test('Piltover Enforcer: conquering after assigning 3+ excess damage may exhaust it to ready a unit', () => {
  let g = game();
  setLegend(g, 0, 'unl-187-219');
  setController(g, 1, 1);
  put(g, 1, 't-u1', 1);
  const { g: g2, u } = moveIn(g, 0, 1, 't-u5');
  g = resolveAll(g2);
  expectPending(g, 'optional', /Piltover Enforcer/);
  g = yes(g);
  g = resolveAll(g);
  assert.equal(g.objects[u].exhausted, false);
});

test('Piltover Enforcer: a conquer without excess damage does nothing', () => {
  let g = game();
  setLegend(g, 0, 'unl-187-219');
  g = moveIn(g, 0, 1, 't-u5').g;
  g = resolveAll(g);
  assert.equal(g.pending?.kind, 'mainAction');
});

test('Gloomist: when you hold, may exhaust it to draw 1', () => {
  let g = game();
  setLegend(g, 0, 'unl-193-219');
  setController(g, 1, 0);
  put(g, 0, 't-u2', 1);
  g = endTurn(g); g = endTurn(g);
  g = resolveAll(g);
  expectPending(g, 'optional', /Gloomist/);
  const h = g.players[0].hand.length;
  g = resolveAll(yes(g));
  assert.equal(g.players[0].hand.length, h + 2, 'Gloomist + Draw Phase');
});

test('Green Father: declining keeps the battlefield', () => {
  let g = game();
  setLegend(g, 0, 'unl-195-219');
  const bf = g.battlefields[1].objId;
  g = moveIn(g, 0, 1).g;
  expectPending(g, 'optional', /Brush/);
  g = resolveAll(no(g));
  assert.equal(g.battlefields[1].objId, bf);
});

test('Scorn of the Moon: [T]: Add [1], usable only during showdowns', () => {
  let g = game();
  setLegend(g, 0, 'unl-197-219');
  onlyRunes(g, 0, 0);
  const s = handCard(g, 0, 'b8-action');
  assert.equal(canPlay(g, 0, s), false, 'not outside showdowns');
  const u = put(g, 0, 't-u2', 'base');
  g = act(g, { type: 'move', player: 0, units: [u], to: 1 });
  expectPending(g, 'showdownAction');
  assert.ok(canPlay(g, 0, s));
});

test('Deceiver: when you conquer, may discard 1 and exhaust it to play a ready Reflection copy of another unit there, with Temporary', () => {
  let g = game();
  const leg = setLegend(g, 0, 'unl-199-219');
  const h = g.players[0].hand.length;
  g = moveIn(g, 0, 1, 't-u3').g;
  expectPending(g, 'optional', /Reflection/);
  g = yes(g);
  expectPending(g, 'chooseCards', /Discard 1/);
  g = choose(g, g.pending!.options![0].id);
  // RULINGS sweep / CR 383.3.b: discard + exhaust are the trigger's base cost, paid as it goes on the chain
  assert.equal(g.objects[leg].exhausted, true, 'exhausted as the cost');
  assert.ok(!Object.values(g.objects).some(o => o.isToken && o.battlefieldIndex === 1), 'the Reflection comes on resolution');
  g = resolveAll(g);
  const refl = Object.values(g.objects).find(o => o.isToken && o.battlefieldIndex === 1)!;
  assert.ok(refl, 'a token was played there');
  assert.equal(chars(g, refl.id).name, 't-u3');
  assert.equal(might(g, refl.id), 3);
  assert.equal(refl.exhausted, false);
  assert.ok(hasKw(g, refl.id, 'Temporary'));
  assert.equal(g.players[0].hand.length, h - 1);
});

test('Butcher of the Sands: [A][A],[T]: Add [2] for units only', () => {
  let g = game();
  const l = setLegend(g, 0, 'ven-141-166');
  onlyRunes(g, 0, 2, 'rad-r01');
  g = activate(g, 0, l);
  g = resolveAll(g);
  assert.equal(g.players[0].runesInPlay.length, 0, 'both runes recycled for [A][A]');
  // rules-decisions #65: a recycled ready rune is exhausted first, its [1] floats: 2 unrestricted Energy floats, plus the [2] for units only
  assert.equal(g.players[0].pool.energy, 2);
  assert.equal(canPlay(g, 0, handCard(g, 0, 'b8-s5')), false, 'the [2] is not for spells (only the floating 2 would be)');
  assert.ok(canPlay(g, 0, handCard(g, 0, 'b8-s2')), 'a [2] spell uses the floating Energy');
  const u = handCard(g, 0, 't-u4');
  assert.ok(canPlay(g, 0, u));
  g = play(g, 0, u, 'base');
  assert.equal(zoneOf(g, u), 'base');
});

test('Curator of the Sands: playing a unit with Energy cost 7+ may exhaust it to ready up to 2 runes', () => {
  let g = game();
  setLegend(g, 0, 'ven-145-166');
  runes(g, 0, 6);
  g = play(g, 0, handCard(g, 0, 'b8-u7'), 'base');
  g = resolveAll(g);
  expectPending(g, 'optional', /Curator/);
  const before = readyCount(g, 0);
  g = resolveAll(yes(g));
  expectPending(g, 'chooseCards', /Ready up to 2 runes/);
  g = choose(g, ...optIds(g).slice(0, 2));
  assert.equal(readyCount(g, 0), before + 2);
});

test('Curator of the Sands: also for activated abilities with Energy cost 7+', () => {
  let g = game();
  setLegend(g, 0, 'ven-145-166');
  const gadget = put(g, 0, 'b8-gearab7', 'base');
  runes(g, 0, 6);
  g = activate(g, 0, gadget);
  g = resolveAll(g);
  expectPending(g, 'optional', /Curator/);
  const before = readyCount(g, 0);
  g = resolveAll(yes(g));
  expectPending(g, 'chooseCards', /Ready up to 2 runes/);
  g = choose(g, ...optIds(g).slice(0, 2));
  assert.equal(readyCount(g, 0), before + 2);
});

test('Eye of Twilight: [Action] [T]: give a friendly unit Tank this turn (usable in showdowns)', () => {
  let g = game();
  const l = setLegend(g, 0, 'ven-147-166');
  const u = put(g, 0, 't-u2', 'base');
  g = act(g, { type: 'move', player: 0, units: [u], to: 1 });
  expectPending(g, 'showdownAction');
  assert.ok(canAct(g, 0, l));
  g = activate(g, 0, l);
  g = resolveAll(g);
  assert.ok(hasKw(g, u, 'Tank'));
  void mkObj; void exhaustRunes;
});

test("Agony's Embrace: only once each turn", () => {
  let g = game();
  setLegend(g, 0, 'rad-153-167');
  setController(g, 1, 0); setController(g, 0, 0);
  put(g, 0, 't-u1', 1); put(g, 0, 't-u1', 0);
  const a = handCard(g, 0, 'b8-hideable'), b = handCard(g, 0, 'b8-hideable');
  moveToZone(g, a, 'facedown', { bf: 1, controller: 0 }); g.objects[a].hiddenTurn = 0;
  moveToZone(g, b, 'facedown', { bf: 0, controller: 0 }); g.objects[b].hiddenTurn = 0;
  g = resolveAll(play(g, 0, a));
  const h = g.players[0].hand.length;
  g = resolveAll(play(g, 0, b));
  assert.equal(g.players[0].hand.length, h + 1, "only the spell's own draw the second time");
});

test('Grand Duelist: declining keeps it ready; enemy units becoming Mighty do nothing', () => {
  let g = game();
  setLegend(g, 0, 'sfd-205-221');
  const u = put(g, 0, 't-u4', 'base'), e = put(g, 1, 't-u4', 'base');
  runes(g, 0, 4);
  g = play(g, 0, handCard(g, 0, 'b8-pump')); g = choose(g, e); g = resolveAll(g);
  assert.equal(g.pending?.kind, 'mainAction');
  g = play(g, 0, handCard(g, 0, 'b8-pump')); g = choose(g, u); g = resolveAll(g);
  g = resolveAll(no(g));
  assert.equal(g.objects[legendOf(g, 0)].exhausted, false);
});

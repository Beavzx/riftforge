// B2: gear and units with triggered abilities.
import { test } from 'node:test';
import {
  game, mana, run, play, playNew, activate, canActivate, canPlay, put, handCard, zoneOf, assert, expectDecision, atMain, setController,
  hideAt, handSize, m, act, EQUIP,
} from './util.ts';
import type { GameState, ObjId } from '../../../src/engine/types.ts';

const endTurn = (g: GameState) => run(act(g, { type: 'endTurn', player: g.pending!.player }));

test('Solari Shrine: when you kill a stunned enemy unit, you may exhaust it to draw 1', () => {
  let g = game();
  mana(g, 0, 3);
  setController(g, 1, 1);
  const sh = put(g, 0, 'ogn-072-298', 'base');
  const e = put(g, 1, 't-u3', 1);
  g = run(play(g, 0, handCard(g, 0, 'ts-stun')));
  assert.equal(g.objects[e].stunned, true);
  const hand = handSize(g, 0);
  g = run(play(g, 0, handCard(g, 0, 'ts-bolt')));
  expectDecision(g, 'optional', 0);
  g = run(g, 'yes');
  assert.equal(zoneOf(g, e), 'trash');
  assert.equal(g.objects[sh].exhausted, true);
  assert.equal(handSize(g, 0), hand + 1);
});

test('Solari Shrine: no trigger for a non-stunned enemy', () => {
  let g = game();
  mana(g, 0, 1);
  setController(g, 1, 1);
  put(g, 0, 'ogn-072-298', 'base');
  const e = put(g, 1, 't-u3', 1);
  g = run(play(g, 0, handCard(g, 0, 'ts-bolt')));
  assert.equal(zoneOf(g, e), 'trash');
  atMain(g);
});

test('Mushroom Pouch: draws at the start of your Beginning Phase only if you control a facedown card at a battlefield', () => {
  let g = game();
  setController(g, 0, 0);
  put(g, 0, 'ogn-101-298', 'base');
  put(g, 0, 't-u2', 0);
  let h = structuredClone(g);
  hideAt(g, 0, 't-hidden', 0);
  g = endTurn(endTurn(g));
  h = endTurn(endTurn(h));
  atMain(g); atMain(h);
  assert.equal(handSize(g, 0), handSize(h, 0) + 1, 'one extra card with a facedown card');
});

test('Scrapheap: draw 1 when played, when discarded, and when killed', () => {
  let g = game();
  mana(g, 0, 2);
  let s: ObjId;
  let hand = handSize(g, 0);
  [g, s] = playNew(g, 0, 'ogn-182-298');
  g = run(g);
  assert.equal(handSize(g, 0), hand + 1, 'played: draw 1');
  // killed (as Malzahar's cost)
  const mz = put(g, 0, 'ogn-113-298', 'base');
  hand = handSize(g, 0);
  g = activate(g, 0, mz, 0);
  g = run(g, s);   // Scrapheap (Malzahar may also pay with himself, RJ#6900)
  assert.equal(zoneOf(g, s), 'trash');
  assert.equal(handSize(g, 0), hand + 1, 'killed: draw 1');
  // discarded (as Unlicensed Armory's cost)
  const a = put(g, 0, 'ogn-023-298', 'base');
  put(g, 0, 't-u1', 'base');
  for (const c of [...g.players[0].hand]) { g.players[0].hand = g.players[0].hand.filter(x => x !== c); g.objects[c].zone = 'trash'; g.players[0].trash.push(c); }
  const s2 = handCard(g, 0, 'ogn-182-298');
  const target = g.players[0].base.find(x => g.objects[x].cardId === 't-u1')!;
  g = run(activate(g, 0, a, 0), target);
  assert.equal(zoneOf(g, s2), 'trash');
  assert.equal(handSize(g, 0), 1, 'discarded: draw 1');
});

test('Lingering Animus: enters ready only if a friendly unit or gear died this turn', () => {
  let g = game();
  mana(g, 0, 6);
  let a: ObjId;
  [g, a] = playNew(g, 0, 'rad-005-167');
  g = run(g);
  assert.equal(g.objects[a].exhausted, true);
  // a friendly gear dies (Gold token killed for its cost)
  const gold = put(g, 0, 'unl-t05', 'base');
  g.objects[gold].isToken = true;
  const t = put(g, 0, 'ogn-186-298', 'base');   // Treasure Trove: gear, kill it with its own ability
  mana(g, 0, 0, 'Chaos');
  g = run(activate(g, 0, t, 1));
  assert.equal(zoneOf(g, t), 'trash');
  [g, a] = playNew(g, 0, 'rad-005-167');
  g = run(g);
  assert.equal(g.objects[a].exhausted, false, 'a friendly gear died this turn');
});

test('Lingering Animus: a friendly unit died this turn', () => {
  let g = game();
  mana(g, 0, 3);
  setController(g, 0, 0);
  const u = put(g, 0, 't-u2', 0);
  g = run(play(g, 0, handCard(g, 0, 'ts-bolt')));
  assert.equal(zoneOf(g, u), 'trash');
  let a: ObjId;
  [g, a] = playNew(g, 0, 'rad-005-167');
  g = run(g);
  assert.equal(g.objects[a].exhausted, false);
});

test('Titanic Shrine: playing the biggest unit lets you exhaust it to draw 1 (decision); smaller units do not trigger', () => {
  let g = game();
  mana(g, 0, 7);
  const ts = put(g, 0, 'rad-089-167', 'base');
  put(g, 1, 't-u3', 'base');
  g = run(playNew(g, 0, 't-u2')[0]);
  atMain(g);
  const hand = handSize(g, 0);
  g = run(playNew(g, 0, 't-u5')[0]);
  expectDecision(g, 'optional', 0);
  g = run(g, 'yes');
  assert.equal(handSize(g, 0), hand + 1);
  assert.equal(g.objects[ts].exhausted, true);
});

test('Titanic Shrine: may decline', () => {
  let g = game();
  mana(g, 0, 5);
  const ts = put(g, 0, 'rad-089-167', 'base');
  g = run(playNew(g, 0, 't-u5')[0], 'no');
  assert.equal(g.objects[ts].exhausted, false);
});

test('Battlefield Armorer: a friendly gear at a battlefield dies -> may pay [1] to return it to hand', () => {
  let g = game();
  mana(g, 0, 1);
  put(g, 0, 'rad-130-167', 'base');
  const banner = put(g, 0, 'rad-002-167', 1);   // Deploy gear at a battlefield
  const mz = put(g, 0, 'ogn-113-298', 'base');
  g = activate(g, 0, mz, 0);
  g = run(g, banner);
  expectDecision(g, 'optional', 0);
  g = run(g, 'yes');
  assert.equal(zoneOf(g, banner), 'hand');
  assert.equal(g.players[0].runesInPlay.filter(r => !g.objects[r].exhausted).length, 0, '[1] paid');
});

test('Battlefield Armorer: gear at base does not trigger; no prompt without [1]', () => {
  let g = game();
  put(g, 0, 'rad-130-167', 'base');
  const gear = put(g, 0, 'ogn-098-298', 'base');
  const mz = put(g, 0, 'ogn-113-298', 'base');
  g = run(activate(g, 0, mz, 0), gear);
  assert.equal(zoneOf(g, gear), 'trash');
  atMain(g);
});

test('Zero Point Inflection: when you play a card, draw 2', () => {
  let g = game();
  mana(g, 0, 1);
  put(g, 0, 'rad-069-167', 'base');
  const hand = handSize(g, 0);
  g = run(playNew(g, 0, 't-u1')[0]);
  assert.equal(handSize(g, 0), hand - 1 + 1 + 2);
});

test('Zero Point Inflection: drawing with 9+ other cards in hand -> discard hand, kill this, an opponent scores 1', () => {
  let g = game();
  mana(g, 0, 1);
  const z = put(g, 0, 'rad-069-167', 'base');
  for (let i = 0; i < 9; i++) handCard(g, 0, 't-u2');
  const u = handCard(g, 0, 't-u1');
  g = run(play(g, 0, u));      // hand 9, play -> draw 2 -> first draw has 9 others
  assert.equal(zoneOf(g, z), 'trash');
  assert.equal(handSize(g, 0), 0);
  assert.equal(g.players[1].points, 1, 'scored exactly once for the draw instruction');
});

test('Ravenbloom Prefect: when an opponent plays a gear, may banish itself to banish it', () => {
  let g = game();
  const pf = put(g, 0, 'ven-102-166', 'base');
  g = endTurn(g);
  atMain(g, 1);
  mana(g, 1, 3);
  let c: ObjId;
  [g, c] = playNew(g, 1, 'ogn-098-298');
  g = run(g);
  expectDecision(g, 'optional', 0);
  g = run(g, 'yes');
  assert.equal(zoneOf(g, pf), 'banishment');
  assert.equal(zoneOf(g, c), 'banishment');
});

test('Ravenbloom Prefect: own gear does not trigger; declining keeps both', () => {
  let g = game();
  mana(g, 0, 3);
  const pf = put(g, 0, 'ven-102-166', 'base');
  g = run(playNew(g, 0, 'ogn-098-298')[0]);
  atMain(g);
  g = endTurn(g);
  mana(g, 1, 3);
  let c: ObjId;
  [g, c] = playNew(g, 1, 'ogn-098-298');
  g = run(g, 'no');
  assert.equal(zoneOf(g, pf), 'base');
  assert.equal(zoneOf(g, c), 'base');
});

test('Nasus: once each turn, when an enemy unit here dies, channel 1 rune exhausted', () => {
  let g = game();
  mana(g, 0, 3);
  const n = put(g, 0, 'ven-063-166', 0);
  put(g, 1, 't-u1', 0); put(g, 1, 't-u2', 0);
  put(g, 1, 't-u1', 1);
  const runes = g.players[0].runesInPlay.length;
  g = run(play(g, 0, handCard(g, 0, 'ts-wipe')));
  // AUTO-AUDIT F-4 (ENGINE-7): two instances triggered by different deaths are ordered by their controller
  expectDecision(g, 'orderTriggers', 0);
  g = run(g, '0');
  assert.equal(g.players[0].runesInPlay.length, runes + 1, 'two enemies died here, channelled only once');
  const ch = g.players[0].runesInPlay[g.players[0].runesInPlay.length - 1];
  assert.equal(g.objects[ch].exhausted, true);
  void n;
});

test('Bottled Constellation: at the start of your Main Phase, may kill 3 other friendly units/gear to score 1', () => {
  let g = game();
  const bc = put(g, 0, 'ven-067-166', 'base');
  const a = put(g, 0, 't-u1', 'base'), b = put(g, 0, 't-u2', 'base'), c = put(g, 0, 'ogn-098-298', 'base'), d = put(g, 0, 't-u3', 'base');
  g = run(act(g, { type: 'endTurn', player: 0 }));
  g = run(act(g, { type: 'endTurn', player: 1 }));
  expectDecision(g, 'optional', 0);
  g = run(g, 'yes');
  const opts = expectDecision(g, 'chooseCards', 0);
  assert.ok(!opts.includes(bc) && [a, b, c, d].every(x => opts.includes(x)));
  g = run(g, [a, b, c]);
  assert.deepEqual([a, b, c].map(x => zoneOf(g, x)), ['trash', 'trash', 'trash']);
  assert.equal(zoneOf(g, d), 'base');
  assert.equal(g.players[0].points, 1);
});

test('Altar of Memories: friendly unit dies -> may exhaust it to draw 1, then put a card from hand on top or bottom', () => {
  let g = game();
  mana(g, 0, 1);
  setController(g, 0, 0);
  const al = put(g, 0, 'sfd-169-221', 'base');
  const u = put(g, 0, 't-u2', 0);
  const keep = handCard(g, 0, 't-u5');
  g = run(play(g, 0, handCard(g, 0, 'ts-bolt')));
  assert.equal(zoneOf(g, u), 'trash');
  expectDecision(g, 'optional', 0);
  g = run(g, 'yes');
  assert.equal(g.objects[al].exhausted, true);
  const opts = expectDecision(g, 'chooseCards', 0);
  assert.equal(opts.length, 2, 'kept card + drawn card');
  g = run(g, keep, 'top');
  assert.equal(g.players[0].mainDeck[0], keep);
});

test('Spirit Wheel: when you choose a friendly unit, may pay [1] and exhaust it to draw 1', () => {
  let g = game();
  mana(g, 0, 2);
  const sw = put(g, 0, 'sfd-144-221', 'base');
  const u = put(g, 0, 't-u2', 'base');
  const hand = handSize(g, 0);
  g = play(g, 0, handCard(g, 0, 'ts-pump'));
  expectDecision(g, 'optional', 0);
  g = run(g, 'yes');
  assert.equal(g.objects[sw].exhausted, true);
  assert.equal(handSize(g, 0), hand + 1, 'drew 1 (the pump was created in hand and played)');
  assert.equal(m(g, u), 4);
});

test('Spirit Wheel: choosing an enemy unit does not trigger', () => {
  let g = game();
  mana(g, 0, 2);
  put(g, 0, 'sfd-144-221', 'base');
  put(g, 1, 't-u2', 'base');
  g = run(play(g, 0, handCard(g, 0, 'ts-pump')));
  atMain(g);
});

test('Fresh Beans: playing a unit during a showdown -> may exhaust it to draw 1', () => {
  let g = game();
  mana(g, 0, 2);
  const fb = put(g, 0, 'unl-011-219', 'base');
  const u = put(g, 0, 't-u2', 'base');
  g = act(g, { type: 'move', player: 0, units: [u], to: 0 });   // uncontrolled battlefield: showdown
  assert.ok(g.showdown, 'a showdown is open');
  const amb = handCard(g, 0, 't-ambush');
  const hand = handSize(g, 0);
  g = play(g, 0, amb, { destination: 0 });
  g = run(g);
  expectDecision(g, 'optional', 0);
  g = run(g, 'yes');
  assert.equal(g.objects[fb].exhausted, true);
  assert.equal(handSize(g, 0), hand);
});

test('Fresh Beans: not outside a showdown', () => {
  let g = game();
  mana(g, 0, 1);
  put(g, 0, 'unl-011-219', 'base');
  g = run(playNew(g, 0, 't-u1')[0]);
  atMain(g);
});

test('Frigid Jewel: the second card you draw this turn (the Draw Phase card was the first) gives +2; the third does not', () => {
  let g = game();
  mana(g, 0, 0, 'Calm');
  put(g, 0, 'unl-074-219', 'base');           // entered after this turn's Draw Phase draw
  const u = put(g, 0, 't-u2', 'base');
  g = run(playNew(g, 0, 'sfd-046-221')[0]);    // Poro Snax: draw 1 -> second card this turn
  assert.equal(m(g, u), 4);
  mana(g, 0, 1, 'Calm');
  const ps = g.players[0].base.find(x => g.objects[x].cardId === 'sfd-046-221')!;
  g = run(activate(g, 0, ps, 1));             // third card: no trigger
  assert.equal(m(g, u), 4);
});

test('Frigid Jewel: on board during the Draw Phase -> that card is the first, the next draw is the second', () => {
  let g = game();
  put(g, 0, 'unl-074-219', 'base');
  const u = put(g, 0, 't-u2', 'base');
  g = endTurn(g);
  g = endTurn(g);                               // player 0's turn 3: drew 1 in the Draw Phase
  assert.equal(m(g, u), 2, 'the first card does not trigger');
  mana(g, 0, 0, 'Calm');
  g = run(playNew(g, 0, 'sfd-046-221')[0]);
  assert.equal(m(g, u), 4);
});

test('Sumpworks Map: when an opponent scores, draw 1', () => {
  let g = game();
  put(g, 0, 'unl-085-219', 'base');
  g = endTurn(g);
  const hand = handSize(g, 0);
  const u = put(g, 1, 't-u2', 'base');
  g = run(act(g, { type: 'move', player: 1, units: [u], to: 1 }));
  assert.equal(g.players[1].points, 1, 'conquered');
  assert.equal(handSize(g, 0), hand + 1);
});

test('Shepherd\'s Heirloom: gain 1 XP on play; [Equip] — spend 1 XP', () => {
  let g = game();
  mana(g, 0, 2);
  let h: ObjId;
  [g, h] = playNew(g, 0, 'unl-158-219');
  g = run(g);
  assert.equal(g.players[0].xp, 1);
  const u = put(g, 0, 't-u1', 'base');
  g = run(activate(g, 0, h, EQUIP));
  assert.equal(g.objects[h].attachedTo, u);
  assert.equal(g.players[0].xp, 0);
  assert.equal(m(g, u), 3);
  g.objects[h].attachedTo = undefined; g.ex.attachCount--;
  assert.ok(!canActivate(g, 0, h, EQUIP), 'no XP left');
});

test('Astral Heron: at a battlefield, your first card each turn makes the next card cost [2][A][A] less', () => {
  let g = game();
  mana(g, 0, 2);
  setController(g, 0, 0);
  put(g, 0, 'ven-044-166', 0);
  g = run(playNew(g, 0, 't-u1', { destination: 'base' })[0]);
  const sg = handCard(g, 0, 'sfd-056-221');    // Sterak's Gage [3][G][G] -> [1]
  assert.ok(canPlay(g, 0, sg), 'costs [1] now');
  g = run(play(g, 0, sg));
  assert.equal(zoneOf(g, sg), 'base');
  const sg2 = handCard(g, 0, 'sfd-033-221');   // Doran's Shield [1] (only the next card is discounted)
  assert.ok(!canPlay(g, 0, sg2));
});

test('Astral Heron: not at a battlefield -> no discount', () => {
  let g = game();
  mana(g, 0, 2);
  put(g, 0, 'ven-044-166', 'base');
  g = run(playNew(g, 0, 't-u1')[0]);
  assert.ok(!canPlay(g, 0, handCard(g, 0, 'sfd-056-221')));
});

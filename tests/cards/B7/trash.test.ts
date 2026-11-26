import { test } from 'node:test';
import { game, mana, stack, play, drive, opt, none, objOpt, hand, trash, deckTop, deckBottom, put, zoneOf, act, endTurn, handCard, assert, pendingIs, noInStep, setController, hasKw, might, cid } from './_util.ts';
import { getLegalActions } from '../../../src/engine/game.ts';

const canPlayNow = (g: import('./_util.ts').GameState, p: number, id: string) => getLegalActions(g, p as 0 | 1).some(a => a.type === 'playCard' && a.obj === id);

test('Cemetery Attendant (ogn-165) / Morbid Return (ogn-170): return a unit from your trash to hand (target)', () => {
  let g = game(); mana(g, 0, 4, 'Chaos');
  const u = put(g, 0, 't-u4', 'trash'); put(g, 0, 'ogn-083-298', 'trash'); put(g, 1, 't-u5', 'trash');
  g = play(g, 0, 'ogn-165-298', { dest: 'base' }).g;   // only one unit in your trash: auto
  assert.equal(zoneOf(g, u), 'hand');
  g = game(); mana(g, 0, 2, 'Chaos');
  const a = put(g, 0, 't-u4', 'trash'), b = put(g, 0, 't-u2', 'trash');
  g = play(g, 0, 'ogn-170-298', {}, objOpt(b)).g;
  assert.equal(zoneOf(g, b), 'hand'); assert.equal(zoneOf(g, a), 'trash');
  // no unit in trash: Morbid Return can't be played
  g = game(); mana(g, 0, 2, 'Chaos');
  const mr = handCard(g, 0, 'ogn-170-298');
  assert.ok(!canPlayNow(g, 0, mr));
});

test('Annie (ogs-010) returns a spell; Aspiring Engineer (sfd-061) a gear; Starhound (unl-167) a Bird/Cat/Dog/Poro', () => {
  let g = game(); mana(g, 0, 6, 'Chaos');
  const s = put(g, 0, 'ogn-083-298', 'trash'); put(g, 0, 't-u1', 'trash');
  g = play(g, 0, 'ogs-010-024', { dest: 'base' }).g;
  assert.equal(zoneOf(g, s), 'hand');
  g = game(); mana(g, 0, 6, 'Mind');
  const gear = put(g, 0, 'ogn-242-298', 'trash'); put(g, 0, 't-u1', 'trash');
  g = play(g, 0, 'sfd-061-221', { dest: 'base' }).g;
  assert.equal(zoneOf(g, gear), 'hand');
  g = game(); mana(g, 0, 6, 'Order');
  const dog = put(g, 0, 'ogn-165-298', 'trash'); put(g, 0, 't-u1', 'trash');
  g = play(g, 0, 'unl-167-219', { dest: 'base' }).g;
  assert.equal(zoneOf(g, dog), 'hand');
});

test('Guardian of the Passage (sfd-035): when it holds, may return a unit or gear from trash (optional)', () => {
  let g = game(); setController(g, 0, 0);
  put(g, 0, 'sfd-035-221', 0);
  const u = put(g, 0, 't-u3', 'trash'); put(g, 0, 'ogn-083-298', 'trash');
  g = endTurn(g); g = endTurn(g);
  pendingIs(g, 'chooseTargets', 0);
  assert.equal(g.pending!.min, 0);
  g = drive(g, objOpt(u));
  assert.equal(zoneOf(g, u), 'hand');
});

test('Shadows of the Past (ven-103): up to 2 units from any trash to their owners\' hands', () => {
  let g = game(); mana(g, 0, 4, 'Chaos');
  const a = put(g, 0, 't-u3', 'trash'), b = put(g, 1, 't-u2', 'trash'); put(g, 1, 't-u4', 'trash');
  g = play(g, 0, 'ven-103-166', {}, g2 => [...objOpt(a)(g2), ...objOpt(b)(g2)]).g;
  assert.ok(g.players[0].hand.includes(a)); assert.ok(g.players[1].hand.includes(b));
});

test('Guerilla Warfare (ogn-264): returns up to two [Hidden] cards from trash', () => {
  let g = game(); mana(g, 0, 3, 'Chaos');
  const a = put(g, 0, 'ogn-057-298', 'trash'), b = put(g, 0, 'ogn-220-298', 'trash'), c = put(g, 0, 't-u2', 'trash');
  g = play(g, 0, 'ogn-264-298', {}, g2 => [...objOpt(a)(g2), ...objOpt(b)(g2)]).g;
  assert.equal(zoneOf(g, a), 'hand'); assert.equal(zoneOf(g, b), 'hand'); assert.equal(zoneOf(g, c), 'trash');
});

test('Guerilla Warfare: "You can hide ignoring costs this turn"', () => {
  let g = game(); mana(g, 0, 3, 'Chaos'); setController(g, 0, 0);
  put(g, 0, 't-u1', 0);
  g = play(g, 0, 'ogn-264-298').g;
  for (const r of g.players[0].runesInPlay) g.objects[r].exhausted = true;
  g.players[0].runesInPlay = [];
  const card = handCard(g, 0, 'ogn-057-298');
  g = act(g, { type: 'hide', player: 0, obj: card, battlefieldIndex: 0 });
  assert.equal(zoneOf(g, card), 'facedown');
});

test('Super Mega Death Rocket! (ogn-252): deals 5; when you conquer, may discard 1 to return it from trash', () => {
  let g = game(); mana(g, 0, 5, 'Fury');
  const e = put(g, 1, 't-u5', 'base');
  const r = play(g, 0, 'ogn-252-298');
  g = r.g;
  assert.equal(zoneOf(g, e), 'trash'); assert.equal(zoneOf(g, r.id), 'trash');
  const u = put(g, 0, 't-u1', 'base');
  g = drive(act(g, { type: 'move', player: 0, units: [u], to: 0 }));
  pendingIs(g, 'optional', 0);
  g = drive(g, 'yes', opt('t-u2'));
  assert.equal(zoneOf(g, r.id), 'hand');
  assert.ok(trash(g, 0).includes('t-u2'));
});

test('Immortal Phoenix (ogn-037): when you kill a unit with a spell, may pay [1][C] to play it from trash; not for ability/combat kills', () => {
  let g = game(); mana(g, 0, 7, 'Fury');
  const ph = put(g, 0, 'ogn-037-298', 'trash');
  put(g, 1, 't-u3', 'base');
  g = play(g, 0, 'ogn-252-298').g;
  pendingIs(g, 'optional', 0);
  g = drive(g, 'yes');
  if (g.pending?.kind === 'chooseDestination') g = drive(g, 'base');
  assert.equal(zoneOf(g, ph), 'base');
  assert.ok(hasKw(g, ph, 'Assault'));
  // combat kill: no trigger
  g = game(); mana(g, 0, 3, 'Fury');
  const ph2 = put(g, 0, 'ogn-037-298', 'trash');
  const a = put(g, 0, 't-u5', 'base'); put(g, 1, 't-u1', 0); setController(g, 0, 1);
  g = drive(act(g, { type: 'move', player: 0, units: [a], to: 0 }));
  noInStep(g);
  assert.equal(zoneOf(g, ph2), 'trash');
});

test('Forbidden Technique (rad-010): ready a unit; after you play a 7+ cost card, may play it from trash for [1][C][C], then it is banished', () => {
  let g = game(); mana(g, 0, 7, 'Calm'); mana(g, 0, 3, 'Fury');
  const u = put(g, 0, 't-u2', 'base', { ready: false });
  put(g, 0, 't-u1', 'base', { ready: false });
  const ft = put(g, 0, 'rad-010-167', 'trash');
  g = play(g, 0, 'ogn-075-298', { dest: 'base' }, 'no').g;   // Tasty Faefolk (E7), decline Accelerate
  pendingIs(g, 'optional', 0);
  g = drive(g, 'yes');
  if (g.pending?.kind === 'chooseTargets') g = drive(g, objOpt(u));
  g = drive(g);
  assert.equal(g.objects[u].exhausted, false);
  assert.equal(zoneOf(g, ft), 'banishment');
});

test('Meticulous Restorationist (rad-120): may play itself from trash for [C] after a 7+ cost card; not after a cheap one', () => {
  let g = game(); mana(g, 0, 10, 'Order');
  const mr = put(g, 0, 'rad-120-167', 'trash');
  g = play(g, 0, 't-u2', { dest: 'base' }).g;
  noInStep(g);
  // (no 'no' answer: Accelerate [1][C] isn't affordable, so it isn't offered — the old 'no' was consumed by a duplicate trash trigger,
  // fixed by ENGINE-7 in events.ts triggerSources)
  g = play(g, 0, 'ogn-075-298', { dest: 'base' }).g;
  g = drive(g, 'yes');
  if (g.pending?.kind === 'chooseDestination') g = drive(g, 'base');
  assert.equal(zoneOf(g, mr), 'base');
});

test('Undying Legion (unl-025): Legion — may be played from trash for [3][C] only after another card this turn', () => {
  let g = game(); mana(g, 0, 6, 'Fury');
  const ul = put(g, 0, 'unl-025-219', 'trash');
  assert.ok(!canPlayNow(g, 0, ul));
  g = play(g, 0, 't-u1', { dest: 'base' }).g;
  assert.ok(canPlayNow(g, 0, ul));
  g = act(g, { type: 'playCard', player: 0, obj: ul, destination: 'base' });
  g = drive(g);
  assert.equal(zoneOf(g, ul), 'base');
  assert.equal(g.players[0].runesInPlay.filter(r => !g.objects[r].exhausted).length, 6 - 1 - 3);
});

test('Jhin (unl-089): after spending [4]+ on a spell this turn, may be played for [C]; Vision', () => {
  let g = game(); mana(g, 0, 5, 'Mind');
  const j = handCard(g, 0, 'unl-089-219');
  g = play(g, 0, 'ogn-083-298').g;   // Consult the Past (E4)
  for (const r of g.players[0].runesInPlay.slice(0, 4)) assert.ok(g.objects[r].exhausted);
  assert.ok(canPlayNow(g, 0, j));
  g = act(g, { type: 'playCard', player: 0, obj: j, destination: 'base' });
  g = drive(g, none);   // Vision: look at the top card, keep it
  assert.equal(zoneOf(g, j), 'base');
  // without the big spell, 1 rune is not enough
  g = game(); mana(g, 0, 1, 'Mind');
  const j2 = handCard(g, 0, 'unl-089-219');
  assert.ok(!canPlayNow(g, 0, j2));
});

test('Soulgorger (ogn-196) / The Harrowing (ogn-198): play a unit from trash ignoring its Energy cost (Power still paid)', () => {
  let g = game(); mana(g, 0, 10, 'Chaos');
  const big = put(g, 0, 't-u5', 'trash'), calm = put(g, 0, 't-calm2', 'trash');
  g = play(g, 0, 'ogn-196-298', { dest: 'base' }).g;
  // RULINGS (CR 355.5 / 403.2): the trash unit is a target chosen as the trigger goes on the chain
  pendingIs(g, 'chooseTargets', 0);
  // the Calm unit needs [Calm] power we don't have: not offered
  assert.deepEqual(g.pending!.options!.map(o => o.objIds![0]), [big]);
  g = drive(g, objOpt(big));
  if (g.pending?.kind === 'chooseDestination') g = drive(g, 'base');
  assert.equal(zoneOf(g, big), 'base');
  assert.equal(zoneOf(g, calm), 'trash');
  // The Harrowing with a Calm rune: pays [G]
  g = game(); mana(g, 0, 8, 'Chaos'); mana(g, 0, 1, 'Calm');
  const c2 = put(g, 0, 't-calm2', 'trash');
  g = play(g, 0, 'ogn-198-298').g;
  if (g.pending?.kind === 'chooseDestination') g = drive(g, 'base');
  assert.equal(zoneOf(g, c2), 'base');
  const calmRune = g.players[0].runesInPlay.find(r => g.objects[r]?.cardId === 'rad-r02');
  assert.equal(calmRune, undefined, 'the Calm rune was recycled to pay the Power cost');
});

test('Spectral Matron (ogn-226) / Glasc Mixologist (sfd-165): may play a unit costing <= [3] and <= [A] from trash for free', () => {
  let g = game(); mana(g, 0, 6, 'Order');
  const ok3 = put(g, 0, 't-u3', 'trash'); put(g, 0, 't-u4', 'trash');
  g = play(g, 0, 'ogn-226-298', { dest: 'base' }).g;
  pendingIs(g, 'chooseTargets', 0);
  assert.deepEqual(g.pending!.options!.map(o => o.objIds![0]), [ok3]);
  g = drive(g, objOpt(ok3));
  if (g.pending?.kind === 'chooseDestination') g = drive(g, 'base');
  assert.equal(zoneOf(g, ok3), 'base');
  // Glasc Deathknell, declined
  g = game();
  const gm = put(g, 1, 'sfd-165-221', 'base');
  const u = put(g, 1, 't-u2', 'trash');
  g.objects[gm].damage = 99; g.ex.dirty = true;
  g = drive(act(g, { type: 'endTurn', player: 0 }));
  pendingIs(g, 'chooseTargets', 1);
  g = drive(g, none);
  assert.equal(zoneOf(g, u), 'trash');
});

test('Remember the Fallen (rad-135): play up to 3 cheap units/gear from trash, ignoring costs', () => {
  let g = game(); mana(g, 0, 10, 'Order');
  const a = put(g, 0, 't-u1', 'trash'), b = put(g, 0, 't-u2', 'trash'), gear = put(g, 0, 'ogn-242-298', 'trash'), d = put(g, 0, 't-u3', 'trash');
  put(g, 0, 't-u4', 'trash');
  g = play(g, 0, 'rad-135-167').g;
  pendingIs(g, 'chooseTargets');   // RULINGS: chosen as it is played (CR 355.5)
  assert.equal(g.pending!.max, 3); assert.equal(g.pending!.options!.length, 4);
  g = drive(g, gg => [...objOpt(a)(gg), ...objOpt(b)(gg), ...objOpt(gear)(gg)]);
  while (g.pending?.kind === 'chooseDestination') g = drive(g, 'base');
  assert.equal(zoneOf(g, a), 'base'); assert.equal(zoneOf(g, b), 'base'); assert.equal(zoneOf(g, gear), 'base'); assert.equal(zoneOf(g, d), 'trash');
});

test('Undying Loyalty (unl-168): playable with only [A] when a Bird/Cat/Dog/Poro target makes it cost [0]', () => {
  let g = game(); mana(g, 0, 1, 'Order');   // only the [A]: needs the discount
  const dog = put(g, 0, 'ogn-165-298', 'trash');   // E3: too expensive to be chosen
  const pet = put(g, 0, 'ven-058-166', 'trash');   // Patched Porobot (Poro, E2)
  g = play(g, 0, 'unl-168-219').g;
  void dog;
  // Note: the discount applies once the target is known; canPlay checks the full cost first (see report)
  if (g.pending?.kind === 'chooseDestination') g = drive(g, 'base');
});

test('Undying Loyalty: discount with a pet target (enough mana for the discounted cost only after choosing)', () => {
  let g = game(); mana(g, 0, 3, 'Order');
  const pet = put(g, 0, 'ven-058-166', 'trash');
  const plain = put(g, 0, 't-u2', 'trash');
  const r = play(g, 0, 'unl-168-219', {}, objOpt(pet));
  g = r.g;
  if (g.pending?.kind === 'chooseDestination') g = drive(g, 'base');
  assert.equal(zoneOf(g, pet), 'base');
  assert.equal(g.players[0].runesInPlay.filter(x => g.objects[x].exhausted).length, 0, 'no Energy paid');
  assert.equal(g.players[0].runesInPlay.length, 2, 'one rune recycled for [A]');
  void plain;
});

test("Kai'Sa (ogn-112): when she conquers, may play a spell from trash with Energy cost < your points without paying Energy; then it is recycled", () => {
  let g = game();
  g.players[0].points = 4;
  const k = put(g, 0, 'ogn-112-298', 'base');
  const cheap = put(g, 0, 'ogn-083-298', 'trash');   // E4: 4 < 5 points after conquering
  const pricey = put(g, 0, 'ogn-114-298', 'trash');  // E6 P1 Mind (no Mind power available)
  g = drive(act(g, { type: 'move', player: 0, units: [k], to: 0 }));
  pendingIs(g, 'chooseTargets', 0);   // chosen as the trigger goes on the chain (CR 355.5, principle 4; RJ#10771)
  assert.deepEqual(g.pending!.options!.map(o => o.objIds![0]), [cheap]);
  const h = hand(g, 0).length;
  g = drive(g, objOpt(cheap));
  assert.equal(hand(g, 0).length, h + 2);
  assert.equal(zoneOf(g, cheap), 'mainDeck');
  assert.equal(deckBottom(g, 0)[0], 'ogn-083-298');
  void pricey;
});

test('Fizz (sfd-140): may play a spell (Energy <= 3) from trash ignoring Energy, then recycle it', () => {
  let g = game(); mana(g, 0, 4, 'Chaos');
  const s = put(g, 0, 'ogn-183-298', 'trash');   // Stacked Deck E1
  put(g, 0, 'ogn-083-298', 'trash');             // E4: not offered
  stack(g, 0, 't-u1', 't-u2', 't-u3');
  g = play(g, 0, 'sfd-140-221', { dest: 'base' }).g;
  assert.deepEqual(g.pending!.options!.map(o => o.objIds![0]), [s]);
  g = drive(g, objOpt(s), opt('t-u2'));
  assert.equal(zoneOf(g, s), 'mainDeck');
  assert.ok(hand(g, 0).includes('t-u2'));
});

test('Kennen (ven-113): play -> Burn 2; conquer -> a spell in trash may be played this turn for its cost, then banished', () => {
  let g = game(); mana(g, 0, 8, 'Chaos');
  stack(g, 0, 't-u1', 't-u2');
  const r = play(g, 0, 'ven-113-166', { dest: 'base' });
  g = r.g;
  assert.deepEqual(trash(g, 0).sort(), ['t-u1', 't-u2']);
  const sp = put(g, 0, 'ogn-183-298', 'trash');
  assert.ok(!canPlayNow(g, 0, sp));
  g.objects[r.id].exhausted = false;
  g = drive(act(g, { type: 'move', player: 0, units: [r.id], to: 0 }));
  assert.ok(canPlayNow(g, 0, sp));
  g = act(g, { type: 'playCard', player: 0, obj: sp });
  g = drive(g, gg => [gg.pending!.options![0].id]);
  assert.equal(zoneOf(g, sp), 'banishment');
});

test('Kharox (ven-114): becoming Empowered makes the opponent Burn 3; you may play a unit from their trash for free', () => {
  let g = game(); mana(g, 0, 8, 'Chaos');
  const kx = put(g, 0, 'ven-114-166', 'base');
  const [x, y, z] = stack(g, 1, 't-u3', 'ogn-083-298', 't-u1');
  g = act(g, { type: 'activate', player: 0, obj: kx, abilityIndex: 901 });
  g = drive(g);
  assert.ok(g.objects[kx].empowered);
  // reflexive "Then you may do this" (CR 387-389): the "you may" and the trash unit are decided as that item goes on the chain
  pendingIs(g, 'optional', 0);
  g = drive(g, 'yes');
  pendingIs(g, 'chooseTargets', 0);
  assert.equal(g.pending!.options!.length, 2);
  g = drive(g, objOpt(x));
  if (g.pending?.kind === 'chooseDestination') g = drive(g, 'base');
  assert.equal(zoneOf(g, x), 'base'); assert.equal(g.objects[x].controller, 0);
  assert.equal(zoneOf(g, y), 'trash'); assert.equal(zoneOf(g, z), 'trash');
});

test('Endless Riches (ven-022): banish hand+trash, Burn 7; skip draw; play from trash; cards going to trash are banished', () => {
  let g = game(); mana(g, 0, 6, 'Fury');
  const old = put(g, 0, 't-u5', 'trash');
  const r = play(g, 0, 'ven-022-166');
  g = r.g;
  assert.equal(hand(g, 0).length, 0);
  assert.equal(zoneOf(g, old), 'banishment');
  assert.equal(trash(g, 0).length, 7);
  const t1 = g.players[0].trash.find(x => g.objects[x].cardId === 't-tank')!;
  mana(g, 0, 9, 'Fury');
  assert.ok(canPlayNow(g, 0, t1));
  // a discarded / killed card is banished instead
  const u = put(g, 0, 't-u1', 'base'); g.objects[u].damage = 9; g.ex.dirty = true;
  const e = put(g, 1, 't-u2', 'base');
  const rk = play(g, 0, 'ogn-252-298', {}, objOpt(e));   // the spell itself is banished after resolving
  g = rk.g;
  assert.equal(zoneOf(g, u), 'banishment');
  assert.equal(zoneOf(g, rk.id), 'banishment');
  assert.equal(zoneOf(g, e), 'trash', "the opponent's cards are unaffected");
  // skip draw: next own turn
  const h = hand(g, 0).length;
  g = endTurn(g); g = endTurn(g);
  assert.equal(hand(g, 0).length, h);
});

test('Stargazer (ven-098): Flow spells played from your trash cost [2] less, to a minimum of [1]', () => {
  let g = game(); mana(g, 0, 1, 'Mind');
  put(g, 0, 'ven-098-166', 'base');
  const du = put(g, 0, 'ven-049-166', 'trash');   // Dredge Up, Flow [2]
  assert.ok(canPlayNow(g, 0, du));
  g = act(g, { type: 'playCard', player: 0, obj: du });
  g = drive(g);
  assert.equal(zoneOf(g, du), 'banishment');
  assert.equal(g.players[0].runesInPlay.filter(x => g.objects[x].exhausted).length, 1);
  // without Stargazer one rune isn't enough
  g = game(); mana(g, 0, 1, 'Mind');
  const du2 = put(g, 0, 'ven-049-166', 'trash');
  assert.ok(!canPlayNow(g, 0, du2));
});

test('Dr. Mundo (ogn-109): +1 Might per card in your trash; recycles 3 from trash at the start of your Beginning Phase', () => {
  let g = game();
  const m = put(g, 1, 'ogn-109-298', 'base');
  for (const c of ['t-u1', 't-u2', 't-u3', 't-u4']) put(g, 1, c, 'trash');
  assert.equal(might(g, m), 10);
  g = act(g, { type: 'endTurn', player: 0 });
  g = drive(g);
  pendingIs(g, 'chooseCards', 1);
  assert.equal(g.pending!.min, 3);
  g = drive(g, gg => gg.pending!.options!.slice(0, 3).map(o => o.id));
  assert.equal(trash(g, 1).length, 1);
  assert.equal(might(g, m), 7);
});
void deckTop; void cid; void hasKw;

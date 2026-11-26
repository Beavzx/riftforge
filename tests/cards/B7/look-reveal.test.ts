import { test } from 'node:test';
import { game, mana, stack, play, drive, opt, none, objOpt, hand, trash, deckTop, deckBottom, put, zoneOf, act, endTurn, handCard, assert, pendingIs, noInStep, setController, hasKw, might, cid } from './_util.ts';

test('Stacked Deck (ogn-183): look at 3, put exactly 1 into hand, recycle the rest', () => {
  let g = game(); mana(g, 0, 1, 'Chaos');
  const [a, b, c] = stack(g, 0, 't-tank', 't-ganker', 't-shield');
  g = play(g, 0, 'ogn-183-298').g;
  pendingIs(g, 'chooseCards', 0);
  assert.equal(g.pending!.min, 1); assert.equal(g.pending!.options!.length, 3);
  g = drive(g, objOpt(b));
  assert.equal(zoneOf(g, b), 'hand');
  assert.deepEqual(deckBottom(g, 0, 2).sort(), ['t-shield', 't-tank']);
  void a; void c;
});

test('Called Shot (sfd-122): look at 2, draw one, recycle the other; Repeat [C] does it twice', () => {
  let g = game(); mana(g, 0, 2, 'Chaos');
  const [a, b, c, d] = stack(g, 0, 't-tank', 't-ganker', 't-shield', 't-backline');
  g = play(g, 0, 'sfd-122-221', {}, 'yes', objOpt(a), objOpt(c)).g;
  assert.equal(zoneOf(g, a), 'hand'); assert.equal(zoneOf(g, c), 'hand');
  assert.equal(zoneOf(g, b), 'mainDeck'); assert.equal(zoneOf(g, d), 'mainDeck');
  assert.deepEqual(deckBottom(g, 0, 2).sort(), ['t-backline', 't-ganker']);
});

test('Lightning Rush (ven-156): may draw one of the top 3, rest to trash; Flow from trash then banished', () => {
  let g = game(); mana(g, 0, 1, 'Order');
  const [a, b, c] = stack(g, 0, 't-tank', 't-ganker', 't-shield');
  let r = play(g, 0, 'ven-156-166', {}, objOpt(b));
  g = r.g;
  assert.equal(zoneOf(g, b), 'hand');
  assert.equal(zoneOf(g, a), 'trash'); assert.equal(zoneOf(g, c), 'trash');
  assert.equal(zoneOf(g, r.id), 'trash');
  // Flow [2][A] from the trash, then banished
  mana(g, 0, 3, 'Chaos');
  const [x] = stack(g, 0, 't-u4');
  g = act(g, { type: 'playCard', player: 0, obj: r.id });
  g = drive(g, none);
  assert.equal(zoneOf(g, r.id), 'banishment');
  assert.equal(zoneOf(g, x), 'trash');
});

test('Double Trouble (unl-032): may reveal a unit among 3 and draw it; non-units not offered', () => {
  let g = game(); mana(g, 0, 2, 'Calm');
  const [s1, u, s2] = stack(g, 0, 'ogn-083-298', 't-u4', 'ogn-114-298');
  g = play(g, 0, 'unl-032-219').g;    // Repeat [2] not affordable: not offered
  pendingIs(g, 'chooseCards');
  assert.deepEqual(g.pending!.options!.map(o => o.objIds![0]), [u]);
  g = drive(g, objOpt(u));
  assert.equal(zoneOf(g, u), 'hand');
  assert.equal(zoneOf(g, s1), 'mainDeck'); assert.ok(deckBottom(g, 0, 2).includes('ogn-114-298'));
  void s2;
});

test('Trifarian Captain (rad-129): only units/gear costing <= [3] and <= [A] are offered; may decline', () => {
  let g = game(); mana(g, 0, 2, 'Order');
  const [big, small, gear, spellc] = stack(g, 0, 't-u4', 't-u3', 'ogn-242-298', 'ogn-083-298');
  g = play(g, 0, 'rad-129-167', { dest: 'base' }).g;
  pendingIs(g, 'chooseCards');
  assert.deepEqual(g.pending!.options!.map(o => o.objIds![0]).sort(), [small, gear].sort());
  g = drive(g, none);
  assert.equal(zoneOf(g, small), 'mainDeck');
  assert.ok(!deckTop(g, 0, 4).includes('t-u4'));
  void big; void spellc;
});

test('Fate Weaver (unl-064): reveal a spell with Energy cost [4]+ and draw it', () => {
  let g = game(); mana(g, 0, 5, 'Mind');
  const [cheap, big] = stack(g, 0, 'ogn-183-298', 'ogn-114-298', 't-u1', 't-u2');
  g = play(g, 0, 'unl-064-219', { dest: 'base' }).g;
  assert.deepEqual(g.pending!.options!.map(o => o.objIds![0]), [big]);
  g = drive(g, objOpt(big));
  assert.equal(zoneOf(g, big), 'hand');
  assert.equal(zoneOf(g, cheap), 'mainDeck');
});

test('Ornn (sfd-058): play and hold -> look at 4, may draw a gear', () => {
  let g = game(); mana(g, 0, 6, 'Calm');
  const [x, gear] = stack(g, 0, 't-u1', 'ogn-242-298', 't-u2', 't-u3');
  setController(g, 0, 0);
  put(g, 0, 't-u1', 0);
  const r = play(g, 0, 'sfd-058-221', { dest: 0 }, objOpt(gear));
  g = r.g;
  assert.equal(zoneOf(g, gear), 'hand');
  // hold on our next turn
  const [gear2] = stack(g, 0, 'ogn-160-298', 't-u1', 't-u1', 't-u1');
  g = endTurn(g);
  g = endTurn(g);
  pendingIs(g, 'chooseCards', 0);
  g = drive(g, objOpt(gear2));
  assert.equal(zoneOf(g, gear2), 'hand');
  void x;
});

test('Ivern (unl-051): drawing a Bird/Cat/Dog/Poro lets you buff a friendly unit; other units do not', () => {
  let g = game(); mana(g, 0, 6, 'Calm');
  const ally = put(g, 0, 't-u2', 'base');
  const [pet] = stack(g, 0, 'ogn-165-298', 't-u1', 't-u2');   // Cemetery Attendant is a Dog
  let r = play(g, 0, 'unl-051-219', { dest: 'base' }, objOpt(pet));
  g = r.g;
  assert.equal(zoneOf(g, pet), 'hand');
  pendingIs(g, 'chooseTargets', 0);
  g = drive(g, objOpt(ally));
  assert.ok(g.objects[ally].counters.buff);
  g = game(); mana(g, 0, 6, 'Calm');
  const [plain] = stack(g, 0, 't-u4', 't-u1', 't-u2');
  r = play(g, 0, 'unl-051-219', { dest: 'base' }, objOpt(plain));
  noInStep(r.g);
  assert.equal(zoneOf(r.g, plain), 'hand');
});

test('Rift Herald (unl-179): moving to a battlefield looks at 3; Deathknell plays a unit from hand to base ignoring Energy', () => {
  let g = game(); mana(g, 0, 1, 'Fury');
  const h = put(g, 0, 'unl-179-219', 'base');
  const [u] = stack(g, 0, 't-u4', 't-u1', 't-u2');
  g = act(g, { type: 'move', player: 0, units: [h], to: 0 });
  g = drive(g, objOpt(u));
  assert.equal(zoneOf(g, u), 'hand');
});

test('Rift Herald Deathknell: the unit is played to base paying only its Power cost', () => {
  let g = game(); mana(g, 0, 1, 'Calm');
  const h = put(g, 1, 'unl-179-219', 'base');
  const calm = handCard(g, 1, 't-calm2');
  mana(g, 1, 1, 'Calm');
  g.objects[h].damage = 99; g.ex.dirty = true;
  g = act(g, { type: 'endTurn', player: 0 });
  g = drive(g);
  pendingIs(g, 'chooseCards', 1);
  g = drive(g, objOpt(calm));
  assert.equal(zoneOf(g, calm), 'base');
});

test('Command: Attack (rad-033): move a friendly Deploy gear to a battlefield, or look at 5 for a gear', () => {
  let g = game(); mana(g, 0, 2, 'Calm');
  const [x, gear] = stack(g, 0, 't-u1', 'ogn-160-298', 't-u2', 't-u3', 't-u4');
  g = act(g, { type: 'playCard', player: 0, obj: handCard(g, 0, 'rad-033-167') });
  g = drive(g);
  // no friendly Deploy gear: only the look mode is available (auto-chosen)
  pendingIs(g, 'chooseCards');
  g = drive(g, objOpt(gear));
  assert.equal(zoneOf(g, gear), 'hand');
  void x;
  // move mode
  g = game(); mana(g, 0, 2, 'Calm');
  const bomb = put(g, 0, 'tok-bomb', 'base');
  g = act(g, { type: 'playCard', player: 0, obj: handCard(g, 0, 'rad-033-167'), mode: 'move' });
  g = drive(g);
  pendingIs(g, 'chooseDestination', 0);          // R-2: the destination is chosen as the spell is played
  g = drive(g, '1');
  assert.equal(g.objects[bomb].zone, 'battlefield'); assert.equal(g.objects[bomb].battlefieldIndex, 1);
});

test('Consult the Heavens (rad-025): Shield 2 this turn and Predict (may recycle the top card)', () => {
  let g = game(); mana(g, 0, 1, 'Calm');
  const u = put(g, 0, 't-u2', 'base');
  const [top] = stack(g, 0, 't-u5');
  g = play(g, 0, 'rad-025-167').g;
  assert.ok(hasKw(g, u, 'Shield'));
  pendingIs(g, 'chooseCards');
  g = drive(g, objOpt(top));
  assert.equal(deckBottom(g, 0)[0], 't-u5');
  g = endTurn(g);
  assert.ok(!hasKw(g, u, 'Shield'));
});

test('Mysterious Chronomancer (rad-050): Predict 2 (recycle any, order the rest); Disarm keyword', () => {
  let g = game(); mana(g, 0, 5, 'Mind');
  const [a, b] = stack(g, 0, 't-u4', 't-u5', 't-u1');
  const r = play(g, 0, 'rad-050-167', { dest: 'base' });
  g = r.g;
  assert.ok(hasKw(g, r.id, 'Disarm'));
  pendingIs(g, 'chooseCards');
  g = drive(g, none);
  pendingIs(g, 'chooseOrder');
  g = drive(g, objOpt(b));
  assert.deepEqual(g.players[0].mainDeck.slice(0, 2), [b, a]);
});

test('Strigian Oracle (rad-053): when it becomes exhausted (standard move), Predict', () => {
  let g = game();
  const o = put(g, 0, 'rad-053-167', 'base');
  const [top] = stack(g, 0, 't-u5');
  g = act(g, { type: 'move', player: 0, units: [o], to: 0 });
  g = drive(g);
  pendingIs(g, 'chooseCards', 0);
  g = drive(g, objOpt(top));
  assert.equal(deckBottom(g, 0)[0], 't-u5');
});

test('Dramatic Visionary (unl-062): Deathknell Predict 2', () => {
  let g = game();
  const v = put(g, 1, 'unl-062-219', 'base');
  stack(g, 1, 't-u4', 't-u5');
  g.objects[v].damage = 99; g.ex.dirty = true;
  g = act(g, { type: 'endTurn', player: 0 });
  g = drive(g);
  pendingIs(g, 'chooseCards', 1);
  assert.equal(g.pending!.options!.length, 2);
});

test('Clairvoyance (ven-056): Predict 5 then draw 2', () => {
  let g = game(); mana(g, 0, 7, 'Mind');
  const ids = stack(g, 0, 't-u1', 't-u2', 't-u3', 't-u4', 't-u5');
  const before = hand(g, 0).length;
  g = play(g, 0, 'ven-056-166', {}, g2 => [g2.pending!.options!.find(o => o.objIds![0] === ids[0])!.id]).g;
  // 4 left to order: answer each order prompt with its first option
  while (g.pending?.kind === 'chooseOrder') g = drive(g, gg => [gg.pending!.options![0].id]);
  assert.equal(hand(g, 0).length, before + 2);
  assert.equal(zoneOf(g, ids[0]), 'mainDeck');
});

test('The Empyrean (rad-060): if it showed off a card, Predict equal to its Power cost, then draw 2', () => {
  let g = game(); mana(g, 0, 8, 'Mind');
  const shown = handCard(g, 0, 'ogn-115-298');   // Promising Future: Power cost 1
  stack(g, 0, 't-u5', 't-u4');
  const before = hand(g, 0).length;
  g = play(g, 0, 'rad-060-167', { dest: 'base' }, objOpt(shown)).g;
  pendingIs(g, 'chooseCards');
  assert.equal(g.pending!.options!.length, 1);   // Predict 1
  g = drive(g, none);
  assert.equal(hand(g, 0).length, before + 2);
  // no show off: no predict, no draw
  g = game(); mana(g, 0, 8, 'Mind');
  const b2 = hand(g, 0).length;
  g = play(g, 0, 'rad-060-167', { dest: 'base' }, none).g;
  noInStep(g);
  assert.equal(hand(g, 0).length, b2);
});

test('Clocktower Guardian (rad-067): play / hold Predict 3; Deathknell banishes the top card and may play it ignoring Energy', () => {
  let g = game(); mana(g, 0, 10, 'Mind');   // Clocktower Guardian is Mind (data audit table C)
  stack(g, 0, 't-u1', 't-u2', 't-u3');
  const r = play(g, 0, 'rad-067-167', { dest: 'base' });
  g = r.g;
  pendingIs(g, 'chooseCards');
  assert.equal(g.pending!.options!.length, 3);
  g = drive(g, gg => gg.pending!.options!.map(o => o.id));   // recycle all
  // deathknell
  g = game(); mana(g, 1, 1, 'Calm');
  const cg = put(g, 1, 'rad-067-167', 'base');
  const [top] = stack(g, 1, 't-calm2');
  g.objects[cg].damage = 99; g.ex.dirty = true;
  g = act(g, { type: 'endTurn', player: 0 });
  g = drive(g);
  assert.equal(zoneOf(g, top), 'banishment');
  pendingIs(g, 'optional', 1);
  g = drive(g, 'yes');
  if (g.pending?.kind === 'chooseDestination') g = drive(g, 'base');
  assert.equal(zoneOf(g, top), 'base');
});

test('Teemo (ogn-121): when defending, deal 1 to a chosen enemy here per [Hidden] card among the top 5; recycle them; Hidden keyword', () => {
  let g = game();
  const t = put(g, 1, 'ogn-121-298', 0); setController(g, 0, 1);
  assert.ok(hasKw(g, t, 'Hidden'));
  const atk = put(g, 0, 't-u5', 'base');
  stack(g, 1, 'ogn-057-298', 'ogn-083-298', 't-u1', 'ogn-220-298', 't-u2');   // 3 with Hidden
  g = act(g, { type: 'move', player: 0, units: [atk], to: 0 });
  g = drive(g);
  assert.ok(g.log.some(l => /deals 3 to t-u5/.test(l.text)), g.log.slice(-10).map(l => l.text).join('\n'));
  assert.ok(deckBottom(g, 1, 5).includes('ogn-057-298'));
});

test('Raving Witness (rad-074) / Apprentice Smith (sfd-041) / Pakaa Protector (ven-033): move -> reveal top card', () => {
  // Raving Witness: Mighty unit drawn
  let g = game();
  let u = put(g, 0, 'rad-074-167', 'base');
  let [top] = stack(g, 0, 't-u5');
  g = drive(act(g, { type: 'move', player: 0, units: [u], to: 0 }));
  assert.equal(zoneOf(g, top), 'hand');
  g = game(); u = put(g, 0, 'rad-074-167', 'base'); [top] = stack(g, 0, 't-u4');
  g = drive(act(g, { type: 'move', player: 0, units: [u], to: 0 }));
  assert.equal(deckBottom(g, 0)[0], 't-u4');
  // Apprentice Smith: gear drawn
  g = game(); u = put(g, 0, 'sfd-041-221', 'base'); [top] = stack(g, 0, 'ogn-242-298');
  g = drive(act(g, { type: 'move', player: 0, units: [u], to: 0 }));
  assert.equal(zoneOf(g, top), 'hand');
  g = game(); u = put(g, 0, 'sfd-041-221', 'base'); [top] = stack(g, 0, 't-u1');
  g = drive(act(g, { type: 'move', player: 0, units: [u], to: 0 }));
  assert.equal(deckBottom(g, 0)[0], 't-u1');
  // Pakaa Protector: unit drawn; otherwise trashed and +2
  g = game(); u = put(g, 0, 'ven-033-166', 'base'); [top] = stack(g, 0, 't-u1');
  g = drive(act(g, { type: 'move', player: 0, units: [u], to: 0 }));
  assert.equal(zoneOf(g, top), 'hand'); assert.equal(might(g, u), 4);
  g = game(); u = put(g, 0, 'ven-033-166', 'base'); [top] = stack(g, 0, 'ogn-083-298');
  g = drive(act(g, { type: 'move', player: 0, units: [u], to: 0 }));
  assert.equal(zoneOf(g, top), 'trash'); assert.equal(might(g, u), 6);
});

test('Diana (unl-079): when a showdown begins here, may pay [1] to Predict then reveal; a spell on top is drawn', () => {
  let g = game(); mana(g, 0, 1, 'Mind');
  put(g, 0, 'unl-079-219', 0);
  const u = put(g, 0, 't-u1', 'base');
  const [sp] = stack(g, 0, 'ogn-083-298');
  g = act(g, { type: 'move', player: 0, units: [u], to: 0 });
  g = drive(g);
  pendingIs(g, 'optional', 0);
  g = drive(g, 'yes', none);
  assert.equal(zoneOf(g, sp), 'hand');
  // no [1] available: no trigger
  g = game();
  put(g, 0, 'unl-079-219', 0);
  const u2 = put(g, 0, 't-u1', 'base');
  g = drive(act(g, { type: 'move', player: 0, units: [u2], to: 0 }));
  noInStep(g);
});

test('Scrutinizing Scope (rad-064): the opponent guesses a type; a right guess recycles the top card, a wrong one draws it', () => {
  let g = game(); mana(g, 0, 2, 'Mind');
  const sc = put(g, 0, 'rad-064-167', 'base');
  let [top] = stack(g, 0, 't-u3');
  const idx = (gg: typeof g) => gg.ex ? 0 : 0;
  void idx;
  g = act(g, { type: 'activate', player: 0, obj: sc, abilityIndex: 0 });
  g = drive(g);
  pendingIs(g, 'chooseMode', 1);
  g = drive(g, 'Unit');
  assert.equal(deckBottom(g, 0)[0], 't-u3');
  assert.ok(g.objects[sc].exhausted);
  g = game(); mana(g, 0, 2, 'Mind');
  const sc2 = put(g, 0, 'rad-064-167', 'base');
  [top] = stack(g, 0, 't-u3');
  g = drive(act(g, { type: 'activate', player: 0, obj: sc2, abilityIndex: 0 }), 'Spell');
  assert.equal(zoneOf(g, top), 'hand');
});

test('Mechanical Bandit (rad-111): each player reveals; if yours has the lowest Energy cost (ties count) you draw it; recycle the rest', () => {
  let g = game();
  put(g, 1, 'rad-111-167', 'base');
  const [mine] = stack(g, 1, 't-u2');
  const [theirs] = stack(g, 0, 't-u4');
  g = endTurn(g);
  assert.equal(zoneOf(g, mine), 'hand');
  assert.equal(zoneOf(g, theirs), 'mainDeck'); assert.equal(deckBottom(g, 0)[0], 't-u4');
  // higher: recycled
  g = game();
  put(g, 1, 'rad-111-167', 'base');
  const [m2] = stack(g, 1, 't-u4');
  stack(g, 0, 't-u4');
  g = endTurn(g);
  assert.equal(zoneOf(g, m2), 'hand');   // tie counts
  g = game();
  put(g, 1, 'rad-111-167', 'base');
  const [m3] = stack(g, 1, 't-u5');
  stack(g, 0, 't-u1');
  g = endTurn(g);
  assert.notEqual(g.objects[m3].zone === 'hand' && g.players[1].hand.includes(m3) && g.log.some(l => /draws t-u5/.test(l.text)), true);
  assert.equal(deckBottom(g, 1).length, 1);
});

test('Twisted Fate (ogn-200): attacking reveals the top rune; Fury deals 2/1 here, Mind draws, Order stuns', () => {
  const setup = (rune: string) => {
    let g = game();
    const tf = put(g, 0, 'ogn-200-298', 'base');
    const e1 = put(g, 1, 't-u3', 0), e2 = put(g, 1, 't-u2', 0); setController(g, 0, 1);
    const r = put(g, 0, rune, 'base'); g.players[0].base = g.players[0].base.filter(x => x !== r);
    g.objects[r].zone = 'runeDeck'; g.players[0].runeDeck.unshift(r);
    const h0 = g.players[0].hand.length;
    g = act(g, { type: 'move', player: 0, units: [tf], to: 0 });
    return { g: drive(g), tf, e1, e2, r, h0 };
  };
  let s = setup('rad-r01');
  pendingIs(s.g, 'chooseTargets', 0);
  let g = drive(s.g, objOpt(s.e1));
  assert.ok(g.log.some(l => /deals 2 to t-u3, 1 to t-u2|deals 1 to t-u2, 2 to t-u3/.test(l.text)), g.log.slice(-12).map(l => l.text).join('\n'));
  assert.equal(g.players[0].runeDeck[g.players[0].runeDeck.length - 1], s.r);
  s = setup('rad-r03');
  assert.equal(s.g.players[0].hand.length, s.h0 + 1);
  s = setup('rad-r06');
  pendingIs(s.g, 'chooseTargets', 0);
  g = drive(s.g, objOpt(s.e2));
  assert.ok(g.objects[s.e2].stunned);
});

test('Void Hatchling (sfd-018): before you reveal, look at the top card and may recycle it', () => {
  let g = game();
  put(g, 0, 'sfd-018-221', 'base');
  const u = put(g, 0, 'sfd-041-221', 'base');   // Apprentice Smith reveals on move
  const [junk, gear] = stack(g, 0, 't-u1', 'ogn-242-298');
  g = act(g, { type: 'move', player: 0, units: [u], to: 0 });
  g = drive(g);
  pendingIs(g, 'chooseCards', 0);
  g = drive(g, objOpt(junk));
  assert.equal(deckBottom(g, 0)[0], 't-u1');
  assert.equal(zoneOf(g, gear), 'hand');
});

test('Nocturne (ogn-194): when you look at him on top of your deck you may banish him and play him for [A]', () => {
  let g = game(); mana(g, 0, 2, 'Chaos');
  const [n, x, y] = stack(g, 0, 'ogn-194-298', 't-u1', 't-u2');
  g = play(g, 0, 'ogn-183-298').g;   // Stacked Deck: look at 3
  pendingIs(g, 'optional', 0);
  g = drive(g, 'yes');                  // banish him as he is seen
  assert.equal(zoneOf(g, n), 'banishment');
  // RJ#3918: Stacked Deck finishes first (Nocturne is no longer among the looked-at cards) ...
  pendingIs(g, 'chooseCards');
  assert.equal(g.pending!.options!.length, 2);
  g = drive(g, objOpt(x));
  assert.equal(zoneOf(g, x), 'hand'); assert.equal(zoneOf(g, y), 'mainDeck');
  // ... then he may be played for [A]
  g = drive(g, 'yes');
  if (g.pending?.kind === 'chooseDestination') g = drive(g, 'base');
  assert.equal(zoneOf(g, n), 'base');
  assert.ok(hasKw(g, n, 'Ganking'));
});

test('Nocturne: banished but not played stays banished; declining keeps him among the looked-at cards', () => {
  let g = game(); mana(g, 0, 1, 'Chaos');
  const [n] = stack(g, 0, 'ogn-194-298', 't-u1', 't-u2');
  g = play(g, 0, 'ogn-183-298', {}, 'yes', (h: { pending: { options?: { id: string }[] } | null }) => [h.pending!.options![0].id], 'no').g;
  assert.equal(zoneOf(g, n), 'banishment');
  g = game(); mana(g, 0, 1, 'Chaos');
  const [n2] = stack(g, 0, 'ogn-194-298', 't-u1', 't-u2');
  g = play(g, 0, 'ogn-183-298', {}, 'no', objOpt(n2)).g;
  assert.equal(zoneOf(g, n2), 'hand');
});
void cid; void trash; void opt;

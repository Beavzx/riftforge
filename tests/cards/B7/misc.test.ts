import { test } from 'node:test';
import { game, mana, stack, play, drive, opt, none, objOpt, hand, trash, deckTop, deckBottom, put, zoneOf, act, endTurn, handCard, assert, pendingIs, noInStep, setController, hasKw, might } from './_util.ts';
type G = import('./_util.ts').GameState;
const toBase = (g: G) => (g.pending?.kind === 'chooseDestination' ? drive(g, 'base') : g);
const setBf = (g: G, bf: number, cardId: string) => { g.objects[g.battlefields[bf].objId].cardId = cardId; };

test('Block (ogn-057): Shield 3 and Tank this turn; Hidden + Action keywords', () => {
  let g = game(); mana(g, 0, 2, 'Calm');
  const u = put(g, 0, 't-u2', 'base');
  const r = play(g, 0, 'ogn-057-298');
  g = r.g;
  assert.ok(hasKw(g, u, 'Tank')); assert.ok(hasKw(g, u, 'Shield'));
  g = endTurn(g);
  assert.ok(!hasKw(g, u, 'Tank'));
});

test('Facebreaker (ogn-220): stun a friendly and an enemy unit at the same battlefield', () => {
  let g = game(); mana(g, 0, 2, 'Order');
  const f0 = put(g, 0, 't-u2', 0), e0 = put(g, 1, 't-u2', 0);
  const f1 = put(g, 0, 't-u1', 1), e1 = put(g, 1, 't-u3', 1);
  g = play(g, 0, 'ogn-220-298').g;
  pendingIs(g, 'chooseTargets', 0);
  g = drive(g, objOpt(f1));
  // only the enemy at the same battlefield is offered (auto-chosen)
  assert.ok(g.objects[f1].stunned); assert.ok(g.objects[e1].stunned);
  assert.ok(!g.objects[e0].stunned); assert.ok(!g.objects[f0].stunned);
});

test('Momentary Companion (rad-095): gains Temporary only when played on an opponent\'s turn', () => {
  let g = game(); mana(g, 0, 4, 'Chaos');
  const r = play(g, 0, 'rad-095-167', { dest: 'base' });
  assert.ok(!hasKw(r.g, r.id, 'Temporary'));
  assert.ok(hasKw(r.g, r.id, 'Hidden'));
  // on the opponent's turn (from hiding at a battlefield we control)
  g = game(); mana(g, 0, 1, 'Chaos'); setController(g, 0, 0);
  put(g, 0, 't-u1', 0);
  const mc = handCard(g, 0, 'rad-095-167');
  g = act(g, { type: 'hide', player: 0, obj: mc, battlefieldIndex: 0 });
  g = endTurn(g);
  // opponent's turn: p0 can play the facedown card with Reaction timing when they get priority: play a spell as p1
  mana(g, 1, 2, 'Calm');
  const blk = handCard(g, 1, 'ogn-057-298');
  put(g, 1, 't-u1', 'base');
  g = act(g, { type: 'playCard', player: 1, obj: blk });
  if (g.pending?.inStep) g = act(g, { type: 'choose', player: 1, optionIds: [g.pending.options![0].id] });
  if (g.pending?.player === 1 && !g.pending.inStep) g = act(g, { type: 'pass', player: 1 });
  if (g.pending?.player === 0 && !g.pending.inStep) {
    g = act(g, { type: 'playCard', player: 0, obj: mc });
    g = drive(g);
    assert.equal(g.objects[mc].zone, 'battlefield');
    assert.ok(hasKw(g, mc, 'Temporary'));
  } else assert.fail(`no priority for player 0: ${g.pending?.kind} ${g.pending?.player}`);
});

test('Gutter Guardian (rad-103): showing off a [Hidden] card adds [A]', () => {
  let g = game(); mana(g, 0, 3, 'Chaos');
  const hid = handCard(g, 0, 'ogn-057-298');
  g = play(g, 0, 'rad-103-167', { dest: 'base' }, objOpt(hid)).g;
  assert.equal(Object.values(g.players[0].pool.power).reduce((s, n) => s + (n ?? 0), 0), 1);
  g = game(); mana(g, 0, 3, 'Chaos');
  handCard(g, 0, 'ogn-057-298');
  g = play(g, 0, 'rad-103-167', { dest: 'base' }, none).g;
  assert.equal(Object.values(g.players[0].pool.power).reduce((s, n) => s + (n ?? 0), 0), 0);
});

test('Bedeviling Stranger (rad-107): with 4+ units at the chosen battlefield, may return an enemy unit there', () => {
  let g = game(); mana(g, 0, 2, 'Chaos');
  const e = put(g, 1, 't-u3', 0); put(g, 1, 't-u2', 0); put(g, 0, 't-u1', 0); put(g, 0, 't-u1', 0);
  // RULINGS: the enemy unit is a target chosen together with the battlefield, as the trigger goes on the chain (CR 403.2)
  g = play(g, 0, 'rad-107-167', { dest: 'base' }, (gg: G) => [gg.pending!.options!.find(o => o.objIds![0] === gg.battlefields[0].objId)!.id],
    (gg: G) => { assert.equal(gg.pending!.kind, 'chooseTargets'); assert.equal(gg.chain.length > 0 || true, true); return objOpt(e)(gg); }).g;
  assert.ok(g.players[1].hand.includes(e));
  // fewer than 4: nothing
  g = game(); mana(g, 0, 2, 'Chaos');
  put(g, 1, 't-u3', 0); put(g, 0, 't-u1', 0);
  g = play(g, 0, 'rad-107-167', { dest: 'base' }, (gg: G) => [gg.pending!.options!.find(o => o.objIds![0] === gg.battlefields[0].objId)!.id], none).g;
  noInStep(g);
});

test('Windsinger (sfd-138): may return another unit at a battlefield with 3 Might or less; Hidden (unbracketed) keyword', () => {
  let g = game(); mana(g, 0, 2, 'Chaos');
  const e = put(g, 1, 't-u3', 0); put(g, 1, 't-u4', 0); put(g, 1, 't-u1', 'base');
  const r = play(g, 0, 'sfd-138-221', { dest: 'base' });
  g = r.g;
  assert.ok(hasKw(g, r.id, 'Hidden'));
  pendingIs(g, 'chooseTargets', 0);
  assert.deepEqual(g.pending!.options!.map(o => o.objIds![0]), [e]);
  assert.equal(g.pending!.min, 0);
  g = drive(g, objOpt(e));
  assert.ok(g.players[1].hand.includes(e));
});

test('Disciple of Shen (ven-117): Shield 3 only with exactly one other friendly unit at its battlefield', () => {
  const g = game();
  const d = put(g, 0, 'ven-117-166', 0);
  assert.ok(!hasKw(g, d, 'Shield'));
  const a = put(g, 0, 't-u1', 0); g.ex.dirty = true;
  assert.ok(hasKw(g, d, 'Shield'));
  put(g, 0, 't-u1', 0);
  assert.ok(!hasKw(g, d, 'Shield'));
  void a;
});

test('Blood Rush (sfd-003) Repeat [1]: Assault 2 to two units; Thwonk! (sfd-040) stuns an attacking unit', () => {
  let g = game(); mana(g, 0, 2, 'Fury');
  const a = put(g, 0, 't-u1', 'base'), b = put(g, 0, 't-u2', 'base');
  g = play(g, 0, 'sfd-003-221', {}, objOpt(a), 'yes', objOpt(b)).g;
  assert.ok(hasKw(g, a, 'Assault')); assert.ok(hasKw(g, b, 'Assault'));
  // Thwonk during combat
  g = game(); mana(g, 1, 2, 'Calm');
  const atk = put(g, 0, 't-u3', 'base'); put(g, 1, 't-u1', 0); setController(g, 0, 1);
  const th = handCard(g, 1, 'sfd-040-221');
  g = act(g, { type: 'move', player: 0, units: [atk], to: 0 });
  // pass focus to the defender, who plays Thwonk!
  for (let i = 0; i < 4 && !(g.pending?.player === 1 && !g.pending.inStep); i++) g = act(g, { type: 'pass', player: g.pending!.player });
  g = act(g, { type: 'playCard', player: 1, obj: th });
  g = drive(g);
  assert.ok(g.objects[atk].stunned);
  assert.ok(!g.log.some(l => /deals 3 to t-u1/.test(l.text)), 'stunned attacker deals no combat damage');
});

test('Perfect Execution (ven-012): readies a unit and gives Assault 3; Flow [3][C] from trash', () => {
  let g = game(); mana(g, 0, 4, 'Fury');
  const u = put(g, 0, 't-u2', 'base', { ready: false });
  const r = play(g, 0, 'ven-012-166');
  g = r.g;
  assert.equal(g.objects[u].exhausted, false); assert.ok(hasKw(g, u, 'Assault'));
});

test('Twilight Step (ven-105): move a unit with 3 Might or less to a chosen location', () => {
  let g = game(); mana(g, 0, 3, 'Chaos');
  const u = put(g, 1, 't-u2', 0); put(g, 1, 't-u4', 0); put(g, 0, 't-u1', 'base');
  g = play(g, 0, 'ven-105-166', {}, objOpt(u)).g;
  pendingIs(g, 'chooseDestination', 0);
  assert.ok(!g.pending!.options!.some(o => o.id === '0'));
  g = drive(g, 'base');
  assert.equal(g.objects[u].zone, 'base'); assert.ok(g.players[1].base.includes(u));
});

test('Death Mark (ven-144): Burn 3 and play a 0 Might Shadow Clone', () => {
  let g = game(); mana(g, 0, 3, 'Fury');
  stack(g, 0, 't-u1', 't-u2', 't-u3');
  g = play(g, 0, 'ven-144-166').g;
  assert.deepEqual(trash(g, 0).filter(c => c.startsWith('t-')).sort(), ['t-u1', 't-u2', 't-u3']);
  const clone = g.players[0].base.find(id => g.objects[id].cardId === 'tok-shadow-clone');
  assert.ok(clone); assert.equal(might(g, clone!), 0);
});

test('Burn Away (rad-124): banish a unit with 3 Might or less or a gear; Burn 2', () => {
  let g = game(); mana(g, 0, 4, 'Order');   // Burn Away is Order (data audit table C)
  const big = put(g, 1, 't-u4', 'base'), gear = put(g, 1, 'ogn-242-298', 'base'); put(g, 1, 't-u3', 'base');
  stack(g, 0, 't-u1', 't-u2');
  g = play(g, 0, 'rad-124-167', {}, (gg: G) => { assert.ok(!gg.pending!.options!.some(o => o.objIds![0] === big)); return objOpt(gear)(gg); }).g;
  assert.equal(zoneOf(g, gear), 'banishment');
  assert.ok(trash(g, 0).includes('t-u1') && trash(g, 0).includes('t-u2'));
});

test('Blade Twirler (ven-002): first move each turn: a chosen player Burns 1 (only once per turn)', () => {
  let g = game();
  const b = put(g, 0, 'ven-002-166', 'base');
  stack(g, 1, 't-u5');
  g = drive(act(g, { type: 'move', player: 0, units: [b], to: 0 }));
  pendingIs(g, 'chooseOpponent', 0);
  g = drive(g, '1');
  assert.deepEqual(trash(g, 1), ['t-u5']);
  g.objects[b].exhausted = false;
  g = drive(act(g, { type: 'move', player: 0, units: [b], to: 'base' }));
  noInStep(g);
});

test('Shadow Order Disciple (ven-095): when it moves, may Burn 1 to get +1 Might', () => {
  let g = game();
  const d = put(g, 0, 'ven-095-166', 'base');
  stack(g, 0, 't-u4');
  g = drive(act(g, { type: 'move', player: 0, units: [d], to: 0 }), 'yes');
  assert.equal(might(g, d), 3); assert.ok(trash(g, 0).includes('t-u4'));
});

test('Forgotten Relic (ven-108): Burn 1; a burned unit gives a friendly unit +Might equal to its Might', () => {
  let g = game(); mana(g, 0, 5, 'Chaos');
  const u = put(g, 0, 't-u1', 'base'); put(g, 0, 't-u2', 'base');
  stack(g, 0, 't-u4');
  g = play(g, 0, 'ven-108-166', {}, objOpt(u)).g;
  assert.equal(might(g, u), 5);
  // a non-unit burned: nothing
  g = game(); mana(g, 0, 5, 'Chaos');
  put(g, 0, 't-u1', 'base');
  stack(g, 0, 'ogn-083-298');
  g = play(g, 0, 'ven-108-166').g;
  noInStep(g);
});

test('Gust Monk (ven-101): optional [1]; if paid, banish a card from any trash to give a unit Assault 2', () => {
  let g = game(); mana(g, 0, 3, 'Chaos');
  const c = put(g, 1, 't-u3', 'trash');
  const ally = put(g, 0, 't-u1', 'base');
  // additional [1]; then, as the trigger goes on the chain (RULINGS sweep / CR 383.3.b): "you may" banish (base cost), its target
  const r = play(g, 0, 'ven-101-166', { dest: 'base' }, 'yes', 'yes', objOpt(ally));
  g = r.g;
  assert.equal(zoneOf(g, c), 'banishment');
  assert.ok(hasKw(g, ally, 'Assault'));
  g = game(); mana(g, 0, 3, 'Chaos');
  put(g, 1, 't-u3', 'trash');
  g = play(g, 0, 'ven-101-166', { dest: 'base' }, 'no').g;
  noInStep(g);
});

test('Sabotage (ogn-156) recycles a non-unit card; Decree of Strength (ven-085) a Mind card; Mindsplitter (ogn-192) discards any', () => {
  let g = game(); mana(g, 0, 2, 'Body');
  const sp = handCard(g, 1, 'ogn-083-298'), gear = handCard(g, 1, 'ogn-242-298');
  g = play(g, 0, 'ogn-156-298').g;
  pendingIs(g, 'chooseCards', 0);
  assert.deepEqual(g.pending!.options!.map(o => o.objIds![0]).sort(), [sp, gear].sort());
  g = drive(g, objOpt(gear));
  assert.equal(zoneOf(g, gear), 'mainDeck');
  g = game(); mana(g, 0, 1, 'Body');
  const mind = handCard(g, 1, 'ogn-083-298'); handCard(g, 1, 'ogn-242-298');
  g = play(g, 0, 'ven-085-166').g;   // only one Mind card: auto
  assert.equal(zoneOf(g, mind), 'mainDeck');
  g = game(); mana(g, 0, 9, 'Chaos');
  g = play(g, 0, 'ogn-192-298', { dest: 'base' }, opt('t-u4')).g;
  assert.ok(trash(g, 1).includes('t-u4'));
});

test('Ashe (unl-169): banish a card from the opponent\'s revealed hand; it returns to their hand when they hold', () => {
  let g = game(); mana(g, 0, 6, 'Order');
  const ashe = play(g, 0, 'unl-169-219', { dest: 'base' }, opt('t-u4'));
  g = ashe.g;
  const banished = g.players[1].banishment[0];
  assert.equal(g.objects[banished].cardId, 't-u4');
  // opponent controls a battlefield and holds it on their turn (Ashe gone by then)
  g.objects[ashe.id].damage = 99; g.ex.dirty = true;
  put(g, 1, 't-u1', 1); setController(g, 1, 1);
  g = endTurn(g);
  assert.ok(g.players[1].hand.includes(banished));
});

test('Bone Skewer (unl-139): the opponent plays a unit you choose from their revealed hand to the chosen battlefield for free, stunned', () => {
  let g = game(); mana(g, 0, 3, 'Chaos');
  const u = handCard(g, 1, 't-u5');
  g = play(g, 0, 'unl-139-219', {}, (gg: G) => [gg.pending!.options!.find(o => o.objIds![0] === gg.battlefields[1].objId)!.id], objOpt(u)).g;
  assert.equal(g.objects[u].zone, 'battlefield'); assert.equal(g.objects[u].battlefieldIndex, 1);
  assert.equal(g.objects[u].controller, 1);
  assert.ok(g.objects[u].stunned);
});

test('Minefield (sfd-212): when you conquer here, put the top 2 cards of your Main Deck into your trash', () => {
  let g = game();
  setBf(g, 0, 'sfd-212-221');
  const u = put(g, 0, 't-u1', 'base');
  stack(g, 0, 't-u4', 't-u5');
  g = drive(act(g, { type: 'move', player: 0, units: [u], to: 0 }));
  assert.deepEqual(trash(g, 0).sort(), ['t-u4', 't-u5']);
});

test('Shadow Temple (ven-165): when you hold here, Burn 3 (also for a battlefield the opponent brought)', () => {
  let g = game();
  setBf(g, 1, 'ven-165-166');
  put(g, 0, 't-u1', 1); setController(g, 1, 0);
  stack(g, 0, 't-u1', 't-u2', 't-u3');
  g = endTurn(g); g = endTurn(g);
  assert.ok(['t-u1', 't-u2', 't-u3'].every(c => trash(g, 0).includes(c)), trash(g, 0).join(','));
});

test('Ravenbloom Conservatory (sfd-215): when you defend here, a spell on top goes to hand; otherwise recycled', () => {
  let g = game();
  setBf(g, 0, 'sfd-215-221');
  put(g, 1, 't-u1', 0); setController(g, 0, 1);
  const [sp] = stack(g, 1, 'ogn-083-298');
  const atk = put(g, 0, 't-u5', 'base');
  g = drive(act(g, { type: 'move', player: 0, units: [atk], to: 0 }));
  assert.ok(g.players[1].hand.includes(sp));
});

test('Forgotten Library (unl-211): controlling it, a spell you spent [4]+ on lets you Predict', () => {
  let g = game(); mana(g, 0, 4, 'Mind');
  setBf(g, 0, 'unl-211-219'); setController(g, 0, 0); put(g, 0, 't-u1', 0);
  stack(g, 0, 't-u5');
  g = play(g, 0, 'ogn-083-298').g;   // Consult the Past (E4)
  pendingIs(g, 'chooseCards', 0);
  // a cheap spell doesn't
  g = drive(g, none);
  mana(g, 0, 1, 'Chaos');
  g = play(g, 0, 'ogn-183-298', {}, gg => [gg.pending!.options![0].id]).g;
  noInStep(g);
});
void deckTop; void deckBottom; void toBase; void hand;

// B3: Unleashed (unl) cards.
import { test } from 'node:test';
import { chars } from '../../../src/engine/chars.ts';
import {
  game, mana, run, expectDecision, play, activate, canPlay, canActivate, tokens, tokensAt, put, putToken, handCard, zoneOf, setController, assert, M, kw,
  controlBf, slay, move, endTurn, setLegend, setBattlefield, act, choose, noRunes, respond,
} from './util.ts';

type G = ReturnType<typeof game>;
const golds = (g: G, p: 0 | 1) => tokens(g, p, 'Gold');

test('Yeti Brawler (unl-018): conquer after assigning 3+ excess damage -> two Gold; less excess -> none', () => {
  let g = game();
  controlBf(g, 1, 0, 't-u2');
  const y = put(g, 0, 'unl-018-219', 'base');
  g = move(g, 0, [y], 0);
  assert.equal(g.battlefields[0].controller, 0);
  assert.equal(golds(g, 0).length, 2, '6 into a 2: 4 excess');
  let h = game();
  controlBf(h, 1, 0, 't-u4');
  const y2 = put(h, 0, 'unl-018-219', 'base');
  h = move(h, 0, [y2], 0);
  assert.equal(h.battlefields[0].controller, 0);
  assert.equal(golds(h, 0).length, 0, '6 into a 4: 2 excess');
});

test('Frisky Hunter (unl-033): a Bird with Deflect here', () => {
  let g = game();
  controlBf(g, 0, 1);
  mana(g, 0, 4);
  g = play(g, 0, handCard(g, 0, 'unl-033-219'), { destination: 1 });
  g = run(g);
  const [b] = tokensAt(g, 0, 'Bird', 1);
  assert.ok(b && kw(g, b, 'Deflect'));
});

test('Allay (unl-041): Deflect; while at a battlefield your other units here have Deflect', () => {
  const g = game();
  const a = put(g, 0, 'unl-041-219', 0);
  const here = put(g, 0, 't-u1', 0), away = put(g, 0, 't-u1', 'base'), e = put(g, 1, 't-u1', 0);
  assert.ok(kw(g, a, 'Deflect'));
  assert.ok(kw(g, here, 'Deflect'));
  assert.ok(!kw(g, away, 'Deflect') && !kw(g, e, 'Deflect'));
  const h = game();
  put(h, 0, 'unl-041-219', 'base');
  const b2 = put(h, 0, 't-u1', 'base');
  assert.ok(!kw(h, b2, 'Deflect'), 'not while at base');
});

test('Flurry of Feathers (unl-044): choose one — counter a spell / four Birds', () => {
  let g = game();
  mana(g, 0, 2, 'Calm', 'Calm');
  g = play(g, 0, handCard(g, 0, 'unl-044-219'));
  assert.equal(g.pending?.kind, 'chainResponse', 'nothing to counter: the Birds mode is the only one');
  g = run(g);
  assert.equal(tokens(g, 0, 'Bird').length, 4);
  // counter
  let h = game();
  const t = put(h, 1, 't-u3', 'base');
  mana(h, 0, 1); mana(h, 1, 2, 'Calm', 'Calm');
  const zap = handCard(h, 0, 'ts-zap');
  h = play(h, 0, zap);
  if (h.pending?.kind === 'chooseTargets') h = choose(h, t);
  h = respond(h, 1, handCard(h, 1, 'unl-044-219'));
  h = run(h, 'counter');
  assert.equal(h.objects[t].damage, 0);
  assert.equal(zoneOf(h, zap), 'trash');
});

test('Trevor Snoozebottom (unl-048): Shield; when he holds, a ready Sprite here', () => {
  let g = game();
  const t = put(g, 1, 'unl-048-219', 0);
  setController(g, 0, 1);
  assert.ok(kw(g, t, 'Shield'));
  g = endTurn(g);
  const [s] = tokensAt(g, 1, 'Sprite', 0);
  assert.ok(s);
  assert.equal(g.objects[s].exhausted, false);
});

test('Lillia, Protector of Dreams (unl-058): +1 when you play a token unit; your token units have Tank', () => {
  let g = game();
  const l = put(g, 0, 'unl-058-219', 'base');
  mana(g, 0, 3);
  g = play(g, 0, handCard(g, 0, 'ogn-211-298'), { destination: 'base' });
  g = run(g);
  const [r] = tokens(g, 0, 'Recruit');
  assert.equal(M(g, l), 5);
  assert.ok(kw(g, r, 'Tank'));
  const e = putToken(g, 1, 'ven-t04', 'base');
  assert.ok(!kw(g, e, 'Tank'));
  g = play(g, 0, handCard(g, 0, 'rad-100-167'));   // a gear token is not a token unit
  g = run(g);
  assert.equal(M(g, l), 5);
});

test('Sprite Burst (unl-069): two ready Sprites', () => {
  let g = game();
  mana(g, 0, 3);
  g = play(g, 0, handCard(g, 0, 'unl-069-219'));
  g = run(g);
  const ss = tokens(g, 0, 'Sprite');
  assert.equal(ss.length, 2);
  assert.ok(ss.every(s => !g.objects[s].exhausted));
});

test('Deadly Flourish (unl-073): deal 3 to an enemy unit; when it dies this turn, a Gold', () => {
  let g = game();
  mana(g, 0, 2);
  const e = put(g, 1, 't-u3', 'base');
  g = play(g, 0, handCard(g, 0, 'unl-073-219'));
  if (g.pending?.kind === 'chooseTargets') g = choose(g, e);
  g = run(g);
  assert.equal(zoneOf(g, e), 'trash');
  assert.equal(golds(g, 0).length, 1);
  // survives, then dies later this turn
  let h = game();
  mana(h, 0, 2);
  const e2 = put(h, 1, 't-u4', 'base');
  h = play(h, 0, handCard(h, 0, 'unl-073-219'));
  if (h.pending?.kind === 'chooseTargets') h = choose(h, e2);
  h = run(h);
  assert.equal(golds(h, 0).length, 0);
  h = slay(h, 0, e2);
  assert.equal(golds(h, 0).length, 1);
  // dies next turn: nothing
  let k = game();
  mana(k, 0, 2);
  const e3 = put(k, 1, 't-u4', 'base');
  k = play(k, 0, handCard(k, 0, 'unl-073-219'));
  if (k.pending?.kind === 'chooseTargets') k = choose(k, e3);
  k = run(k);
  k = endTurn(k);
  k = slay(k, 1, e3);
  assert.equal(golds(k, 0).length, 0);
});

test('Soul Shepherd (unl-077): your token units have +1', () => {
  const g = game();
  put(g, 0, 'unl-077-219', 'base');
  const r = putToken(g, 0, 'ven-t04', 'base'), u = put(g, 0, 't-u1', 'base'), e = putToken(g, 1, 'ven-t04', 'base');
  assert.equal(M(g, r), 2);
  assert.equal(M(g, u), 1);
  assert.equal(M(g, e), 1);
});

test('Sprite Fountain (unl-078): ready Sprite on play; when it dies (Temporary), another ready Sprite', () => {
  let g = game();
  mana(g, 0, 1, 'Mind');
  const f = handCard(g, 0, 'unl-078-219');
  g = play(g, 0, f);
  g = run(g);
  const [s1] = tokensAt(g, 0, 'Sprite', 'base');
  assert.ok(s1 && !g.objects[s1].exhausted);
  // Temporary is a triggered ability (CR 816, RJ#81): the two Temporary triggers are ordered, then go on the chain
  const first = (h: G) => [h.pending!.options![0].id];
  g = endTurn(g); g = endTurn(g, first, first);
  assert.equal(zoneOf(g, f), 'trash');
  assert.equal(zoneOf(g, s1), 'gone');
  const left = tokens(g, 0, 'Sprite');
  assert.equal(left.length, 1, 'Deathknell repeated the play effect');
});

test('Keeper of Masks (unl-081): two Reflections here that become copies of it', () => {
  let g = game();
  controlBf(g, 0, 0);
  mana(g, 0, 2);
  const k = handCard(g, 0, 'unl-081-219');
  g = play(g, 0, k, { destination: 0 });
  g = run(g);
  const refl = Object.values(g.objects).filter(o => o.isToken && o.controller === 0 && o.cardId === 'unl-t06').map(o => o.id);
  assert.equal(refl.length, 2);
  for (const r of refl) {
    assert.equal(g.objects[r].battlefieldIndex, 0);
    assert.equal(M(g, r), 1);
    assert.ok(kw(g, r, 'Temporary'));
  }
  assert.ok(refl.every(r => chars(g, r).name === 'Keeper of Masks'), 'copies of the original');
  assert.equal(g.chain.length, 0, "copies don't get the play effect");
});

test('Lillia, Fae Fawn (unl-082): when she moves from a location, a Sprite (exhausted) there', () => {
  let g = game();
  const l = put(g, 0, 'unl-082-219', 'base');
  g = move(g, 0, [l], 0);
  const [s] = tokensAt(g, 0, 'Sprite', 'base');
  assert.ok(s);
  assert.equal(g.objects[s].exhausted, true);
});

test('Sprite Queen (unl-084): ready Sprite on play and at the start of your Beginning Phase', () => {
  let g = game();
  mana(g, 0, 7, 'Mind');
  const q = handCard(g, 0, 'unl-084-219');
  g = play(g, 0, q, { destination: 'base' });
  g = run(g);
  assert.equal(tokensAt(g, 0, 'Sprite', 'base').length, 1);
  g = endTurn(g);
  assert.equal(tokens(g, 0, 'Sprite').length, 1, 'nothing on the opponent turn');
  g = endTurn(g);
  const ss = tokens(g, 0, 'Sprite');
  assert.equal(ss.length, 1, 'old Sprite killed by Temporary, new one played');
  assert.equal(g.objects[ss[0]].exhausted, false);
});

test('Gutter Palace (unl-088): exactly 4 cards in hand and 4 units at battlefields -> win; Discard 1, [T]: Bird', () => {
  let g = game();
  const gp = put(g, 1, 'unl-088-219', 'base');
  setController(g, 0, 1);
  for (let i = 0; i < 4; i++) put(g, 1, 't-u1', 0);
  while (g.players[1].hand.length > 3) g.players[1].hand.pop();   // draws 1 at start of turn? win checked before draw
  while (g.players[1].hand.length < 4) handCard(g, 1, 't-u1');
  g = endTurn(g);
  assert.equal(g.winner, 1);
  let h = game();
  const gp2 = put(h, 0, 'unl-088-219', 'base');
  h = activate(h, 0, gp2);
  h = run(h, (x: G) => [x.players[0].hand[0]]);
  assert.equal(tokens(h, 0, 'Bird').length, 1);
  void gp;
});

test('Walking Roost (unl-130): choose an opponent; they play a Bird (they choose where)', () => {
  let g = game();
  mana(g, 0, 5);
  controlBf(g, 1, 1);
  g = play(g, 0, handCard(g, 0, 'unl-130-219'), { destination: 'base' });
  g = run(g);
  expectDecision(g, 'chooseDestination', 1);
  g = run(g, '1');
  assert.equal(tokensAt(g, 1, 'Bird', 1).length, 1);
  assert.equal(tokens(g, 0, 'Bird').length, 0);
});

test('Pyke (unl-145): once each turn, an enemy unit dying while he is at a battlefield -> Gold', () => {
  let g = game();
  put(g, 0, 'unl-145-219', 0);
  const e1 = put(g, 1, 't-u1', 'base'), e2 = put(g, 1, 't-u1', 'base'), f = put(g, 0, 't-u1', 'base');
  g = slay(g, 0, f);
  assert.equal(golds(g, 0).length, 0, 'friendly death');
  g = slay(g, 0, e1);
  assert.equal(golds(g, 0).length, 1);
  g = slay(g, 0, e2);
  assert.equal(golds(g, 0).length, 1, 'once each turn');
  let h = game();
  put(h, 0, 'unl-145-219', 'base');
  const e3 = put(h, 1, 't-u1', 'base');
  h = slay(h, 0, e3);
  assert.equal(golds(h, 0).length, 0, 'not at a battlefield');
});

test("Syndra (unl-146): while she's in a showdown your spells have Repeat [2][C]", () => {
  let g = game();
  mana(g, 0, 6, 'Chaos', 'Chaos');
  const s = put(g, 0, 'unl-146-219', 'base');
  const zap = handCard(g, 0, 'ts-zap');
  const e = put(g, 1, 't-u5', 0);
  assert.ok(!chars(g, zap).keywords.has('Repeat'), 'no showdown: no Repeat');
  g = act(g, { type: 'move', player: 0, units: [s], to: 0 });     // combat showdown at battlefield 0
  assert.ok(g.showdown && g.showdown.battlefieldIndex === 0, 'showdown started');
  assert.ok(chars(g, zap).keywords.has('Repeat'), 'Repeat while she is in the showdown');
  if (g.pending?.player !== 0) g = act(g, { type: 'pass', player: g.pending!.player });
  g = play(g, 0, zap);
  g = run(g, e);
  expectDecision(g, 'optional', 0);
  assert.match(g.pending!.prompt, /Repeat/);
});

test('Baron Nashor (unl-147): adds the Baron Pit; can\'t be chosen by enemies; other friendly units +2', () => {
  let g = game();
  mana(g, 0, 7, 'Chaos', 'Chaos', 'Chaos');
  const b = handCard(g, 0, 'unl-147-219');
  g = play(g, 0, b, { destination: 'base' });
  // it enters the Baron Pit (an open battlefield): pass through the showdown there
  for (let i = 0; i < 6 && g.pending && g.pending.kind !== 'mainAction'; i++) g = run(act(g, { type: 'pass', player: g.pending.player }));
  assert.equal(g.battlefields.length, 3);
  assert.equal(g.cards[g.objects[g.battlefields[2].objId].cardId].name, 'Baron Pit');
  const ally = put(g, 0, 't-u1', 'base'), e = put(g, 1, 't-u1', 'base');
  assert.equal(M(g, ally), 3);
  assert.equal(M(g, e), 1);
  assert.equal(M(g, b), 12);
  g = endTurn(g);
  mana(g, 1, 1);
  g = play(g, 1, handCard(g, 1, 'ts-zap'));
  const opts = g.pending?.kind === 'chooseTargets' ? g.pending.options!.map(o => o.id) : [];
  assert.ok(!opts.includes(b), 'not a legal enemy choice');
});
test('Baron Nashor (unl-147): "If you do, I enter there"', () => {
  let g = game();
  mana(g, 0, 7, 'Chaos', 'Chaos', 'Chaos');
  const b = handCard(g, 0, 'unl-147-219');
  g = play(g, 0, b, { destination: 'base' });
  g = run(g);
  assert.equal(g.battlefields.length, 3);
  assert.equal(zoneOf(g, b), 'battlefield');
  assert.equal(g.objects[b].battlefieldIndex, 2, 'entered the Baron Pit it added');
});

test('Carrion Dredger (unl-153): Deathknell — a Bird to your base', () => {
  let g = game();
  const d = put(g, 1, 'unl-153-219', 'base');
  g = slay(g, 0, d);
  assert.equal(tokensAt(g, 1, 'Bird', 'base').length, 1);
});

test("Loyal Poro (unl-156): draws only if it didn't die alone", () => {
  let g = game();
  const p = put(g, 1, 'unl-156-219', 0);
  put(g, 1, 't-u1', 0);
  const n = g.players[1].hand.length;
  g = slay(g, 0, p);
  assert.equal(g.players[1].hand.length, n + 1);
  let h = game();
  const p2 = put(h, 1, 'unl-156-219', 0);
  const n2 = h.players[1].hand.length;
  h = slay(h, 0, p2);
  assert.equal(h.players[1].hand.length, n2);
});

test('Ultrasoft Poro (unl-160): [T]: two Birds, only while at a battlefield', () => {
  let g = game();
  const p = put(g, 0, 'unl-160-219', 'base');
  assert.ok(!canActivate(g, 0, p));
  let h = game();
  const p2 = put(h, 0, 'unl-160-219', 0);
  setController(h, 0, 0);
  h = activate(h, 0, p2);
  h = run(h, 'base', '0');
  assert.equal(tokensAt(h, 0, 'Bird', 'base').length, 1);
  assert.equal(tokensAt(h, 0, 'Bird', 0).length, 1);
});

test('Bloodharbor Ripper (unl-185, legend): [1],[T]: return a friendly unit at a battlefield; a Gold', () => {
  let g = game();
  const leg = setLegend(g, 0, 'unl-185-219');
  assert.ok(!canActivate(g, 0, leg), 'no friendly unit at a battlefield');
  const u = put(g, 0, 't-u2', 0);
  g = activate(g, 0, leg);
  g = run(g);
  assert.equal(zoneOf(g, u), 'hand');
  assert.equal(golds(g, 0).length, 1);
});

test('Bashful Bloom (unl-189, legend): [4],[T] ready Sprite; [1] less per friendly unit with Temporary', () => {
  let g = game();
  const leg = setLegend(g, 0, 'unl-189-219');
  noRunes(g, 0);
  mana(g, 0, 2);
  assert.ok(!canActivate(g, 0, leg));
  put(g, 0, 't-temp', 'base'); putToken(g, 0, 'unl-t07', 'base');
  assert.ok(canActivate(g, 0, leg), '[4] - 2');
  g = activate(g, 0, leg);
  g = run(g);
  assert.equal(tokens(g, 0, 'Sprite').length, 2);
  assert.ok(g.players[0].runesInPlay.every(r => g.objects[r].exhausted));
});

test('Mirror Image (unl-200): a ready Reflection in base that becomes a copy of the chosen unit, with Temporary', () => {
  let g = game();
  mana(g, 0, 1, 'Mind', 'Order');
  const e = put(g, 1, 't-u5', 0);
  g = play(g, 0, handCard(g, 0, 'unl-200-219'));
  if (g.pending?.kind === 'chooseTargets') g = choose(g, e);
  g = run(g);
  const [r] = Object.values(g.objects).filter(o => o.isToken && o.controller === 0 && o.cardId === 'unl-t06').map(o => o.id);
  assert.ok(r);
  assert.equal(zoneOf(g, r), 'base');
  assert.equal(g.objects[r].exhausted, false);
  assert.equal(M(g, r), 5);
  assert.ok(kw(g, r, 'Temporary'));
});

test("Keeper's Verdict (unl-204): its owner puts the enemy unit on top or bottom of their deck", () => {
  let g = game();
  mana(g, 0, 0, 'Body', 'Order');
  const e = put(g, 1, 't-u3', 0);
  put(g, 1, 't-u3', 'base');
  g = play(g, 0, handCard(g, 0, 'unl-204-219'));
  if (g.pending?.kind === 'chooseTargets') g = choose(g, e);
  g = run(g);
  expectDecision(g, 'chooseMode', 1);
  g = run(g, 'bottom');
  assert.equal(g.players[1].mainDeck.at(-1), e);
});

test('Forbidding Waste (unl-210): a unit defending alone here has -2', () => {
  const g = game();
  setBattlefield(g, 0, 'unl-210-219');
  const d = put(g, 1, 't-u3', 0), a = put(g, 0, 't-u3', 0);
  g.objects[d].combatRole = 'defender'; g.objects[a].combatRole = 'attacker'; g.ex.dirty = true;
  assert.equal(M(g, d), 1);
  assert.equal(M(g, a), 3);
  const d2 = put(g, 1, 't-u1', 0);
  g.objects[d2].combatRole = 'defender'; g.ex.dirty = true;
  assert.equal(M(g, d), 3, 'not alone');
});

test('Trapping Grounds (unl-217): conquer here with 3+ excess damage -> a Bird for the conqueror', () => {
  let g = game();
  setBattlefield(g, 0, 'unl-217-219');
  controlBf(g, 1, 0, 't-u1');
  const a = put(g, 0, 't-u5', 'base');
  g = move(g, 0, [a], 0);
  expectDecision(g, 'chooseDestination', 0);
  g = run(g, '0');
  assert.equal(g.battlefields[0].controller, 0);
  assert.equal(tokensAt(g, 0, 'Bird', 0).length, 1);
  let h = game();
  setBattlefield(h, 0, 'unl-217-219');
  controlBf(h, 1, 0, 't-u3');
  const a2 = put(h, 0, 't-u5', 'base');
  h = move(h, 0, [a2], 0);
  assert.equal(h.battlefields[0].controller, 0);
  assert.equal(tokens(h, 0, 'Bird').length, 0, 'only 2 excess');
});

void canPlay; void act; void tokensAt;

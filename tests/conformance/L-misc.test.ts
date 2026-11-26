// docs/rules-tests.md §L — Misc (T211-T220)
import { test } from 'node:test';
import {
  assert, S0, put, hand, cast, play, pass, passN, expectPending, control, act, move, nextTurn, newGame, choose, getView,
  P0, P1, BF_A, BF_B, zone, resolveChain, pend, actEv, type GameState,
} from './harness.ts';

test('T211 — Facedown count public; card private (getView)', () => {
  const g = S0();
  put(g, P0, 'V(1)', BF_A);
  control(g, BF_A, P0);
  const fd = put(g, P0, 'HidU(2)', { facedown: BF_A });
  const v1 = getView(g, P1);
  // HIDDEN-IDS: P1 gets it under an opaque alias, not its engine id
  const seen = Object.values(v1.state.objects).filter(o => o.zone === 'facedown' && o.battlefieldIndex === BF_A);
  assert.equal(seen.length, 1, 'P1 sees that a facedown card exists');
  assert.equal(seen[0].cardId, 'hidden', 'but not which card');
  assert.equal(v1.state.objects[fd], undefined, 'nor its id');
  assert.equal(getView(g, P0).state.objects[fd].cardId, 'cf-hidu2', 'its controller sees it');
});

test('T212 — Hand count public, deck count public, deck order secret (getView)', () => {
  const g = S0();
  hand(g, P0, 'ZapM'); hand(g, P0, 'V(3)');
  const v = getView(g, P1);
  assert.equal(v.state.players[0].hand.length, 2, 'hand count public');
  assert.ok(v.state.players[0].hand.every(id => v.state.objects[id].cardId === 'hidden'), 'hand cards private');
  assert.equal(v.state.players[0].mainDeck.length, g.players[0].mainDeck.length, 'deck count public');
  assert.ok(v.state.players[0].mainDeck.every(id => v.state.objects[id].cardId === 'hidden'), 'deck contents secret');
  const own = getView(g, P0);
  assert.ok(own.state.players[0].mainDeck.every(id => own.state.objects[id].cardId === 'hidden'), 'deck order/contents secret to the owner too');
});

test('T213 — Determinism: same seed + same actions ⇒ identical state', () => {
  const run = () => {
    let g = newGame({ seed: 99, firstPlayer: P0, mulligan: true, shuffle: true });
    g = choose(g, ...(pend(g).options ?? []).slice(0, 2).map(o => o.id));
    g = choose(g, ...(pend(g).options ?? []).slice(0, 1).map(o => o.id));
    g = nextTurn(g);
    g = nextTurn(g);
    return g;
  };
  const strip = (g: GameState) => JSON.stringify({ ...g, cards: undefined, ex: { ...g.ex, unit: null, lastEvents: [] } });
  assert.equal(strip(run()), strip(run()));
});

test('T214 — Additional turn (CR 737)', () => {
  let g = S0();
  [g] = cast(g, P0, 'ExtraTurnM');
  g = resolveChain(g);
  g = nextTurn(g);
  expectPending(g, 'mainAction', P0, 'same player takes the next turn');
  assert.equal(g.activePlayer, 0);
  g = nextTurn(g);
  expectPending(g, 'mainAction', P1, 'then normal order resumes');
});

test('T215 — Concede during opponent\'s chain (CR 650)', () => {
  let g = S0();
  const v = put(g, P1, 'V(5)', 'base');
  [g] = cast(g, P0, 'ZapM', { targets: [[v]] });
  expectPending(g, 'chainResponse', P0);
  g = act(g, { type: 'concede', player: P1 });
  assert.equal(g.winner, 0, 'accepted, game ends');
});

test('T216 — Recycle multiple main-deck cards at once is random order (CR 417.5)', () => {
  const run = (seed: number) => {
    let g = newGame({ seed, firstPlayer: P1, mulligan: true, shuffle: false });
    if (pend(g).player === P1) g = choose(g);
    const pick = g.players[0].hand.slice(0, 2);
    g = choose(g, ...pick);
    return { g, pick };
  };
  const a = run(5), b = run(5);
  assert.deepEqual(a.g.players[0].mainDeck.slice(-2), b.g.players[0].mainDeck.slice(-2), 'deterministic with a fixed seed');
  assert.ok(!(a.g.pending?.inStep && a.g.pending.player === P0 && /order/i.test(a.g.pending.kind)), 'not player-chosen');
  const orders = new Set<string>();
  for (let s = 1; s <= 12; s++) { const r = run(s); orders.add(r.g.players[0].mainDeck.slice(-2).map(id => r.pick.indexOf(id)).join(',')); }
  assert.equal(orders.size, 2, 'both orders occur across seeds (randomized)');
});

test('T217 — Cards go to owner\'s zones (CR 056)', () => {
  let g = S0();
  const v = put(g, P1, 'V(2)', BF_A);
  control(g, BF_A, P1);
  [g] = cast(g, P0, 'TakeoverLike', { targets: [[v]] });
  g = resolveChain(g);
  assert.equal(g.objects[v].controller, 0);
  [g] = cast(g, P0, 'ZapR', { targets: [[v]] });
  g = resolveChain(g);
  assert.ok(g.players[1].trash.includes(v), 'P1\'s trash');
  assert.ok(!g.players[0].trash.includes(v));
});

test('T218 — Tokens vanish off-board (CR 186.1)', () => {
  let g = S0();
  const r = put(g, P1, 'Recruit', 'base');
  [g] = cast(g, P0, 'ZapM', { targets: [[r]] });
  g = resolveChain(g);
  assert.ok(!g.objects[r], 'token ceased to exist');
  assert.ok(!g.players.some(p => p.trash.includes(r)), 'not in any trash');
});

test('T219 — Chosen champion doesn\'t return to champion zone (CR 108.3.c)', () => {
  let g = S0();
  const ch = g.players[0].championZone[0];
  g = play(g, P0, ch, { dest: 'base' });
  assert.equal(zone(g, ch), 'base');
  [g] = cast(g, P0, 'ZapM', { targets: [[ch]] });
  g = resolveChain(g);
  [g] = cast(g, P0, 'ZapM', { targets: [[ch]] });
  g = resolveChain(g);
  assert.equal(zone(g, ch), 'trash', 'owner\'s trash');
  assert.equal(g.players[0].championZone.length, 0, 'champion zone stays empty');
});

test('T220 — Battlefield abilities of an uncontrolled battlefield are put on the chain by the TP (CR 190.6.b)', () => {
  let g = S0({ bfB: 'cf-bf-movedraw' });          // BF-B is owned by P1, uncontrolled
  const u = put(g, P0, 'V(1)', 'base');
  const h0 = g.players[0].hand.length, h1 = g.players[1].hand.length;
  g = move(g, P0, [u], BF_B);
  assert.equal(g.chain[0]?.controller, 0, 'the TP controls the battlefield\'s triggered ability');
  g = resolveChain(g);
  assert.equal(g.players[0].hand.length, h0 + 1, 'TP draws');
  assert.equal(g.players[1].hand.length, h1);
  // CR 190.6.a: a controlled battlefield's abilities are controlled by its controller (not its owner)
  const k = S0({ tp: P1, bfB: 'cf-bf-holdadd' });     // BF-B owned by P1, controlled by P0
  put(k, P0, 'V(1)', BF_B);
  control(k, BF_B, P0);
  const r = actEv(k, { type: 'endTurn', player: P1 });
  assert.ok(r.events.some(e => e.type === 'add' && e.player === 0 && e.energy === 1), '"When you hold here" fires for the battlefield\'s controller');
});

void passN; void pass; void BF_A;

test('harness: realCard finds legends by "<champion>, <title>" as well as by title or id', async () => {
  const { realCard } = await import('./harness.ts');
  assert.equal(realCard('Jayce, Defender of Tomorrow').id, 'ven-149-166');
  assert.equal(realCard('Defender of Tomorrow').id, 'ven-149-166');
  assert.equal(realCard('ven-149-166').name, 'Defender of Tomorrow');
});

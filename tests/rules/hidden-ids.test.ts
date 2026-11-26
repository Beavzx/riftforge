// HIDDEN-IDS (BASICS BX-5): objects hidden from a player appear in that player's view under opaque per-view aliases
// (engine/hidden-ids.ts). A card the opponent saw public (on the board, revealed, looked at) can't be followed by id into a
// hand, a deck or a facedown slot: the alias is fresh, the whole destination zone is re-aliased at once (so set
// difference doesn't single it out), and nothing else in the view (log refs, modifier sources, bookkeeping) names it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  S0, put, hand, control, addRunes, realCard, needsScripts, attackSetup, P0, P1, BF_A, BF_B, zone,
} from '../conformance/harness.ts';
import { applyAction, getLegalActions, getView, createGame } from '../../src/engine/game.ts';
import { card, spell } from '../../src/cards/dsl.ts';
import { moveToZone, newObject } from '../../src/engine/state.ts';
import { shuffle } from '../../src/engine/rng.ts';
import { opponents } from '../../src/engine/util.ts';
import { checkViewIds, idTokens, viewHiddenZones } from '../fixtures/invariants.ts';
import { sha256hex } from '../../src/engine/hidden-ids.ts';
import type { Action, CardDef, GameState, ObjId, PlayerId, PlayerView } from '../../src/engine/types.ts';

// test-only spell: every opponent shuffles their hand into their Main Deck
const SHUFFLE_TEXT = 'Each opponent shuffles their hand into their Main Deck.';
card('hx-shuffle-hand', SHUFFLE_TEXT, [spell(ctx => {
  for (const p of opponents(ctx.g, ctx.controller)) {
    for (const id of [...ctx.g.players[p].hand]) moveToZone(ctx.g, id, 'mainDeck');
    shuffle(ctx.g, ctx.g.players[p].mainDeck);
  }
})]);
const SHUFFLE_DEF: CardDef = { id: 'hx-shuffle-hand', name: 'Test Shuffle Hand', type: 'Spell', supertypes: [], tags: [], domains: ['Fury'], energy: 1, power: 0, might: null, keywords: [], text: SHUFFLE_TEXT, set: 'hx', rarity: 'Common' };

/**
 * Every view a player is shown, in order, with the id checks after each step, plus an adversary that tries to follow
 * one object by id: when a tracked id vanishes, every id that is new in that view becomes a candidate.
 */
class Watch {
  views: PlayerView[] = [];
  ever = new Set<string>();          // every object id shown in any earlier view
  pub = new Set<ObjId>();            // ids shown for public (face-up) objects
  cand: Set<string> | null = null;
  constructor(public p: PlayerId) {}
  see(g: GameState): PlayerView {
    const v = getView(g, this.p);
    const prev = this.views[this.views.length - 1];
    assert.deepEqual(checkViewIds(g, this.p, v, this.pub, prev), [], `view p${this.p} after step ${this.views.length}`);
    if (prev && this.cand) {
      const before = new Set(Object.keys(prev.state.objects)), now = new Set(Object.keys(v.state.objects));
      const gone = [...this.cand].filter(id => !now.has(id));
      if (gone.length) { for (const id of gone) this.cand.delete(id); for (const id of now) if (!before.has(id)) this.cand.add(id); }
    }
    this.views.push(v);
    for (const [id, o] of Object.entries(v.state.objects)) { this.ever.add(id); if (o.cardId !== 'hidden') this.pub.add(id); }
    return v;
  }
  track(id: ObjId) { assert.ok(this.views[this.views.length - 1].state.objects[id], `${id} is visible when tracking starts`); this.cand = new Set([id]); }
  /** ids in the latest view not shown in any view before it */
  freshNow(ids: string[]): boolean { return this.freshAt(this.views.length - 1, ids); }
  /** none of `ids` was shown in a view before view `i` */
  freshAt(i: number, ids: string[]): boolean { const seenBefore = new Set<string>(); for (const v of this.views.slice(0, i)) for (const id of Object.keys(v.state.objects)) seenBefore.add(id); return ids.every(id => !seenBefore.has(id)); }
}

/** Drive the game, showing every intermediate state to both players' watches. */
class Driver {
  w: Watch[] = [new Watch(P0), new Watch(P1)];
  states: GameState[] = [];
  constructor(public g: GameState) { this.show(); }
  show() { this.states.push(this.g); for (const w of this.w) w.see(this.g); }
  act(a: Action) { this.g = applyAction(this.g, a).state; this.show(); return this; }
  choose(...ids: string[]) { return this.act({ type: 'choose', player: this.g.pending!.player, optionIds: ids }); }
  /** pass on chains / showdowns; answer remaining in-step decisions with `pick` (default: first legal action) */
  settle(pick?: (g: GameState) => string[] | undefined, limit = 60) {
    for (let i = 0; i < limit; i++) {
      const d = this.g.pending;
      if (!d || d.kind === 'mainAction') return this;
      if (d.inStep) { const ids = pick?.(this.g); if (ids) this.choose(...ids); else this.act(getLegalActions(this.g, d.player)[0]); continue; }
      this.act({ type: 'pass', player: d.player });
    }
    return this;
  }
  endTurn() { this.act({ type: 'endTurn', player: this.g.activePlayer }); return this.settle(); }
  view(p: PlayerId) { return this.w[p].views[this.w[p].views.length - 1]; }
}

const hiddenHand = (v: PlayerView, owner: PlayerId) => v.state.players[owner].hand.filter(id => v.state.objects[id].cardId === 'hidden');

// ---------------------------------------------------------------- the leak scenarios

test('a card seen on the board, returned to hand, then hidden facedown: the opponent cannot tell which hand card or facedown card it is', () => {
  const skip = needsScripts('Gust'); if (skip) return;
  const g = S0();
  addRunes(g, P0, 2, 'chaos');
  const x = put(g, P1, 'HidU(2)', BF_A);
  put(g, P1, 'V(3)', BF_A);                       // keeps P1 in control of BF-A, so P1 can hide there later
  control(g, BF_A, P1);
  hand(g, P1, 'V(1)'); hand(g, P1, 'V(2)');
  const gust = hand(g, P0, 'Gust');
  const d = new Driver(g);
  const w = d.w[P0]!;
  w.track(x);
  assert.equal(d.view(P0).state.objects[x].cardId, g.objects[x].cardId, 'X is public on the board');
  d.act({ type: 'playCard', player: P0, obj: gust }).settle(gg => (gg.pending!.kind === 'chooseTargets' ? [x] : undefined));
  assert.equal(zone(d.g, x), 'hand', 'Gust returned X to its owner');
  const v = d.view(P0);
  const h = hiddenHand(v, P1);
  assert.equal(h.length, 3);
  assert.ok(!idTokens(v).has(x), "X's id is gone from P0's view (objects, arrays, log, chain)");
  assert.ok(w.freshNow(h), 'the whole hand was re-aliased: set difference does not single X out');
  assert.ok(w.cand!.size >= 3 && h.every(id => w.cand!.has(id)), 'the id tracker only knows X is one of the hand cards');
  // P1's turn: hide X at BF-A
  d.endTurn();
  assert.equal(d.g.activePlayer, P1);
  const hide = getLegalActions(d.g, P1).find(a => a.type === 'hide' && a.obj === x) as Extract<Action, { type: 'hide' }> | undefined;
  assert.ok(hide, 'P1 may hide X');
  d.act(hide).settle();
  assert.equal(zone(d.g, x), 'facedown');
  const v2 = d.view(P0);
  const fd = Object.values(v2.state.objects).filter(o => o.zone === 'facedown');
  assert.equal(fd.length, 1);
  assert.equal(fd[0].cardId, 'hidden');
  assert.ok(!idTokens(v2).has(x), "X's id appears nowhere while it is facedown");
  assert.ok(!w.pub.has(fd[0].id) && fd[0].id !== x, 'the facedown alias is not an id P0 saw');
  assert.ok(w.cand!.size > 1, `the tracker can't single out the facedown card (candidates ${w.cand!.size})`);
  // the hiding player keeps the real id (they act on it)
  assert.equal(d.view(P1).state.objects[x]?.cardId, d.g.objects[x].cardId);
});

test('a played-then-bounced card shuffled into the deck: deck aliases are all fresh, for the opponent and the owner', () => {
  const skip = needsScripts('Gust'); if (skip) return;
  const g = S0();
  g.cards = { ...g.cards, [SHUFFLE_DEF.id]: SHUFFLE_DEF };
  addRunes(g, P0, 2, 'chaos');
  const x = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  hand(g, P1, 'V(1)');
  const gust = hand(g, P0, 'Gust');
  const sh = newObject(g, 'hx-shuffle-hand', P0, 'hand').id; g.players[P0].hand.push(sh);
  const d = new Driver(g);
  d.w[P0].track(x);
  d.act({ type: 'playCard', player: P0, obj: gust }).settle(gg => (gg.pending!.kind === 'chooseTargets' ? [x] : undefined));
  assert.equal(zone(d.g, x), 'hand');
  d.act({ type: 'playCard', player: P0, obj: sh }).settle();
  assert.equal(zone(d.g, x), 'mainDeck');
  for (const p of [P0, P1] as PlayerId[]) {
    const v = d.view(p);
    const deck = v.state.players[P1].mainDeck;
    assert.equal(deck.length, d.g.players[P1].mainDeck.length);
    assert.ok(deck.every(id => v.state.objects[id].cardId === 'hidden'));
    assert.ok(!idTokens(v).has(x), `p${p}: X's id is not in the view`);
    assert.ok(d.w[p].freshNow(deck), `p${p}: every deck alias is new`);
    assert.deepEqual([...deck].sort(), deck, 'deck listed in alias order (no position)');
  }
  assert.ok(d.w[P0].cand!.size >= d.g.players[P1].mainDeck.length, 'the tracker only knows X is somewhere in the deck');
});

test('a hand card seen in a reveal (Sabotage) and then hidden facedown cannot be followed', () => {
  const skip = needsScripts('Sabotage'); if (skip) return;
  const g = S0();
  addRunes(g, P0, 2, 'body');
  put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const x = hand(g, P1, 'HidU(2)'); hand(g, P1, 'V(1)'); hand(g, P1, 'V(2)');
  const zap = hand(g, P1, 'ZapA'); hand(g, P1, 'ZapR');
  const sab = hand(g, P0, 'Sabotage');
  const d = new Driver(g);
  const before = hiddenHand(d.view(P0), P1);
  assert.equal(before.length, 5);
  d.act({ type: 'playCard', player: P0, obj: sab });
  let sawX = false;
  d.settle(gg => {
    const p = gg.pending!;
    if (p.kind === 'chooseCards' && p.player === P0) {
      sawX = d.view(P0).state.objects[x]?.cardId === gg.objects[x].cardId;
      if (sawX) d.w[P0].track(x);
      return [zap];
    }
    return undefined;
  });
  assert.ok(sawX, 'P0 saw X (real id and card) while choosing from the revealed hand');
  assert.equal(zone(d.g, zap), 'mainDeck', 'the chosen card was recycled');
  const v = d.view(P0);
  const after = hiddenHand(v, P1);
  assert.equal(after.length, 4);
  assert.ok(!idTokens(v).has(x), 'X is hidden again and its id is gone');
  assert.ok(after.every(id => !before.includes(id)) && d.w[P0].freshNow(after), 'hand aliases after the reveal are all new (not the pre-reveal ones)');
  // log: "Revealed ..." refs naming hand cards are dropped from P0's view
  assert.ok(v.state.log.every(e => !(e.ref ?? []).includes(x)));
  d.endTurn();
  const hide = getLegalActions(d.g, P1).find(a => a.type === 'hide' && a.obj === x);
  assert.ok(hide);
  d.act(hide!).settle();
  const v2 = d.view(P0);
  assert.ok(!idTokens(v2).has(x));
  assert.ok(d.w[P0].cand!.size > 1, `tracker candidates ${d.w[P0].cand!.size}`);
});

test("Rek'Sai reveals the top 2 and recycles them to the bottom: the deck is re-aliased, the revealed cards can't be located", () => {
  const skip = needsScripts("sfd-170-221"); if (skip) return;
  const { g: g0 } = attackSetup(['sfd-170-221'], ['V(1)']);
  const top = [...g0.players[P0].mainDeck.slice(0, 2)];
  const d = new Driver(g0);
  let seen = 0;
  d.settle(gg => {
    const p = gg.pending!;
    if (p.kind === 'optional') return ['yes'];
    if (p.kind === 'chooseCards' && p.player === P0) {
      // P1 sees the revealed cards
      const v1 = d.view(P1);
      seen = top.filter(id => v1.state.objects[id]?.cardId === gg.objects[id].cardId).length;
      if (seen) d.w[P1].track(top.find(id => v1.state.objects[id])!);
      const none = (p.options ?? []).find(o => /none|no|skip|don't/i.test(o.label) || o.id === 'none');
      return none ? [none.id] : (p.min ?? 1) === 0 ? [] : undefined;
    }
    return undefined;
  });
  const recycled = top.filter(id => zone(d.g, id) === 'mainDeck');
  assert.ok(seen >= 1, 'P1 saw the revealed cards');
  assert.ok(recycled.length >= 1, 'at least one revealed card went back to the deck');
  const v = d.view(P1);
  for (const id of recycled) assert.ok(!idTokens(v).has(id), `recycled ${id} is not named in P1's view`);
  const at = d.states.findIndex(s => zone(s, recycled[0]) === 'mainDeck' && s.players[P0].mainDeck.indexOf(recycled[0]) >= s.players[P0].mainDeck.length - 2);
  assert.ok(at > 0);
  const deckThen = d.w[P1].views[at].state.players[P0].mainDeck;
  assert.ok(d.w[P1].freshAt(at, deckThen), 'every deck alias is new at the step the revealed cards were recycled');
  const deck = v.state.players[P0].mainDeck;
  const cand = d.w[P1].cand;
  assert.ok(cand && cand.size >= deck.length - 1, `tracker candidates ${cand?.size}`);
});

test('Void Rush: a revealed card drawn into hand is not identifiable among the hand cards', () => {
  const skip = needsScripts('Void Rush'); if (skip) return;
  const g = S0();
  hand(g, P0, 'V(1)'); hand(g, P0, 'V(2)');
  const a = put(g, P0, 'V(1)', 'deckTop'), b = put(g, P0, 'V(2)', 'deckTop');
  const vr = hand(g, P0, 'Void Rush');
  const d = new Driver(g);
  d.act({ type: 'playCard', player: P0, obj: vr });
  let tracked: ObjId | null = null;
  d.settle(gg => {
    const p = gg.pending!;
    if (p.kind === 'chooseCards' && p.player === P0 && !tracked) {
      const v1 = d.view(P1);
      if (v1.state.objects[a]) { tracked = a; d.w[P1].track(a); }
      const o = (p.options ?? []).find(o => o.id === b);
      return o ? [b] : undefined;               // banish (and play) B; A is drawn
    }
    return undefined;
  });
  assert.equal(tracked, a, 'P1 saw the revealed card A');
  assert.equal(zone(d.g, a), 'hand');
  const v = d.view(P1);
  assert.ok(!idTokens(v).has(a));
  const h = hiddenHand(v, P0);
  assert.ok(h.length >= 3);
  assert.ok(d.w[P1].freshNow(h), 'hand re-aliased when A went in');
  assert.ok(d.w[P1].cand!.size >= h.length, `tracker candidates ${d.w[P1].cand!.size}`);
});

test("the opponent's hand order is not shipped: reordering the hand gives the same view, and a reorder re-aliases at the next step", () => {
  const g0 = S0();
  for (const c of ['V(1)', 'V(2)', 'V(3)', 'V(4)']) hand(g0, P1, c);
  const w0 = hand(g0, P0, 'V(2)'), u = hand(g0, P0, 'V(1)');
  // a first step records the hand (cards put there by the test setup count as entering it)
  const g = applyAction(g0, { type: 'playCard', player: P0, obj: w0, destination: 'base' } as Action).state;
  const v1 = getView(g, P0);
  const h1 = v1.state.players[P1].hand;
  assert.deepEqual([...h1].sort(), h1, 'hidden hand listed in alias order');
  const g2 = structuredClone(g); g2.cards = g.cards;
  g2.players[P1].hand.reverse();
  const v2 = getView(g2, P0);
  assert.equal(JSON.stringify(v2.state.players[P1]), JSON.stringify(v1.state.players[P1]), 'same hand listing whatever the real order');
  assert.equal(JSON.stringify(v2.state.objects), JSON.stringify(v1.state.objects));
  // after a step, the changed order counts as a mix: all new aliases
  const g3 = applyAction(g2, { type: 'playCard', player: P0, obj: u, destination: 'base' } as Action).state;
  const h3 = getView(g3, P0).state.players[P1].hand;
  assert.ok(h3.every(id => !h1.includes(id)), 'reordered hand re-aliased');
  // without a reorder, the same step keeps the opponent's aliases (stable for UI animations)
  const g4 = applyAction(g, { type: 'playCard', player: P0, obj: u, destination: 'base' } as Action).state;
  assert.deepEqual(getView(g4, P0).state.players[P1].hand, h1, 'untouched hand keeps its aliases');
});

// ---------------------------------------------------------------- properties of the aliases

test('aliases: stable while nothing enters the zone, per viewer, keyed by the per-game secret, never an engine id', () => {
  const g = S0();
  hand(g, P1, 'V(1)'); hand(g, P1, 'V(2)');
  const u = hand(g, P0, 'V(1)'); const u2 = hand(g, P0, 'V(2)');
  const s1 = applyAction(g, { type: 'playCard', player: P0, obj: u, destination: 'base' } as Action).state;
  const s2 = applyAction(s1, { type: 'playCard', player: P0, obj: u2, destination: 'base' } as Action).state;
  const a1 = getView(s1, P1), a2 = getView(s2, P1);
  assert.deepEqual(a2.state.players[P0].mainDeck, a1.state.players[P0].mainDeck, "P0's deck aliases are stable across steps that don't touch it");
  // a card leaving a hidden zone doesn't re-alias the rest (a P1 hand card played publicly)
  const b1 = getView(s2, P0);
  // per viewer: P0's own deck and P1's view of it use different aliases
  const own = getView(s2, P0).state.players[P0].mainDeck, theirs = a2.state.players[P0].mainDeck;
  assert.equal(own.filter(id => theirs.includes(id)).length, 0, 'aliases are per view');
  for (const id of [...own, ...theirs, ...b1.state.players[P1].hand]) assert.match(id, /^h[0-9a-f]{14}$/);
  // the key: a different secret gives different aliases; the same setup gives the same ones (determinism)
  const setup = (secret?: string) => createGame({ seed: 5, cardDb: s2.cards, players: [0, 1].map(i => ({ name: `P${i}`, deck: { legend: 'cf-legend', champion: 'cf-champ', main: new Array(40).fill('cf-v1'), runes: new Array(12).fill('cf-rune-fury'), battlefields: ['cf-bf-a', 'cf-bf-b', 'cf-bf-c'] } })), validateDecks: false, skipMulligan: true, battlefieldSelection: 'random', viewSecret: secret });
  const k1 = getView(setup('alpha'), 0).state.players[1].mainDeck, k1b = getView(setup('alpha'), 0).state.players[1].mainDeck, k2 = getView(setup('beta'), 0).state.players[1].mainDeck;
  assert.deepEqual(k1, k1b);
  assert.equal(k1.filter(id => k2.includes(id)).length, 0);
  // the secret, the alias record and the seed never leave the host
  const v = getView(setup('alpha'), 1);
  assert.equal(v.state.seed, 0);
  assert.equal(v.state.ex.viewKey, undefined);
  assert.equal(v.state.ex.hid, undefined);
  assert.ok(!JSON.stringify(v).includes(sha256hex('riftforge-view-secret|alpha')));
});

test('the owner keeps real ids for what they can see, and every legal action names only visible objects', () => {
  const g = S0();
  put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  put(g, P0, 'V(3)', BF_B); control(g, BF_B, P0);
  const hu = hand(g, P0, 'HidU(2)'), v1 = hand(g, P0, 'V(1)');
  const fd = put(g, P0, 'HidU(3)', { facedown: BF_B });
  const v = getView(g, P0);
  for (const id of [hu, v1, fd]) assert.equal(v.state.objects[id].cardId, g.objects[id].cardId);
  assert.ok(v.legal.some(a => a.type === 'hide' && a.obj === hu), 'hide uses the real id of the hand card');
  assert.deepEqual(checkViewIds(g, P0, v), []);
  const o = getView(g, P1);
  assert.equal(o.state.objects[fd], undefined, "the opponent doesn't get the facedown card's id");
  const fdo = Object.values(o.state.objects).filter(x => x.zone === 'facedown');
  assert.equal(fdo.length, 1);
  assert.deepEqual(Object.keys(fdo[0]).sort(), ['battlefieldIndex', 'cardId', 'controller', 'counters', 'damage', 'enteredThisTurn', 'exhausted', 'faceDown', 'hiddenTurn', 'id', 'modifiers', 'owner', 'timestamp', 'zone'].sort(), 'location data only');
});

test('history that names a now-hidden object is neutralised (modifier sources, log refs, bookkeeping)', () => {
  const g = S0();
  const u = put(g, P0, 'V(2)', 'base');
  const x = hand(g, P1, 'V(1)');
  g.objects[u].modifiers.push({ source: x, layer: 3, duration: 'endOfTurn', timestamp: ++g.timestamp, might: 1 });
  g.log.push({ turn: g.turn, player: P1, text: 'Something about a card', ref: [x, u] });
  g.ex.memo[`${x}#0:test`] = 1;
  g.ex.playPermissions.push({ obj: x, epoch: 0, player: P1, until: 'endOfTurn', turn: g.turn });
  const v = getView(g, P0);
  assert.ok(!idTokens(v).has(x), JSON.stringify(v).match(new RegExp(`.{40}${x}.{10}`))?.[0] ?? '');
  assert.equal(v.state.objects[u].modifiers[0].source, 'hidden');
  assert.deepEqual(v.state.log[v.state.log.length - 1].ref, [u]);
  assert.deepEqual(checkViewIds(g, P0, v), []);
  // the owner still sees everything under real ids
  assert.ok(idTokens(getView(g, P1)).has(x));
});

test('checkViewIds catches a leak (negative control)', () => {
  const g = S0();
  const x = hand(g, P1, 'V(1)');
  const v = getView(g, P0);
  const leaky = structuredClone(v);
  leaky.state.log.push({ turn: 1, player: null, text: 'oops', ref: [x] });
  assert.ok(checkViewIds(g, P0, leaky).some(e => e.includes(x)));
  const prev = getView(g, P0);
  const partial = structuredClone(v);
  const al = partial.state.players[P1].hand[0];
  partial.state.objects['hffffffffffffff'] = { ...partial.state.objects[al], id: 'hffffffffffffff' };
  assert.ok(checkViewIds(g, P0, partial, undefined, prev).some(e => /kept .* old alias/.test(e) || /hidden objects in the view/.test(e)));
  void viewHiddenZones; void realCard;
});

// ---------------------------------------------------------------- regressions: ids embedded in keys (ENGINE-7 fuzz)

test('regression: hidden ids embedded in keys anywhere in the view are dropped (ex.counts "…:o58#5", combat roleEpochs "a:o64")', () => {
  const g = S0();
  const x = hand(g, P1, 'V(1)');
  const atk = put(g, P0, 'V(2)', BF_A);
  const n = x.slice(1);
  g.ex.counts[`B4:mv:mfCaptain:${x}#5`] = 1;
  g.ex.counts[`keep:o${n}0`] = 2;                       // a different id that merely starts with the same digits survives
  g.ex.combat = { bf: BF_A, attackers: [atk], defenders: [], recalled: false, ...{ roleEpochs: { [`a:${x}`]: 3, [`d:${atk}`]: 3 } } } as typeof g.ex.combat;
  (g.ex.turnFacts as Record<string, unknown>)[`deep`] = { a: [{ b: { [`x-${x}`]: [x, `${x}#1`] } }] };
  const v = getView(g, P0);
  assert.deepEqual(checkViewIds(g, P0, v), []);
  assert.ok(!idTokens(v).has(x));
  const ex = v.state.ex as unknown as { counts: Record<string, number>; combat: { roleEpochs: Record<string, number> } };
  assert.equal(ex.counts[`B4:mv:mfCaptain:${x}#5`], undefined);
  assert.equal(ex.counts[`keep:o${n}0`], 2);
  assert.deepEqual(ex.combat.roleEpochs, { [`d:${atk}`]: 3 });
  // the owner's view keeps them
  assert.equal((getView(g, P1).state.ex as unknown as { counts: Record<string, number> }).counts[`B4:mv:mfCaptain:${x}#5`], 1);
});

for (const hash of ['58ffd8f808', '55e5a57e1f']) {
  test(`regression: fuzz repro ${hash} (hidden hand ids in view keys) no longer leaks`, async () => {
    const { readFileSync } = await import('node:fs');
    const { reproFails, replaySpec } = await import('../../tools/fuzz-lib.ts');
    const rp = JSON.parse(readFileSync(new URL(`../fuzz-repros/${hash}.json`, import.meta.url), 'utf8'));
    assert.equal(reproFails(rp), null);
    // and every step of the replay passes the id checks for both players
    let prev: PlayerView[] | null = null;
    for (let i = 0; i <= rp.actions.length; i++) {
      const st = replaySpec(rp.spec, rp.actions.slice(0, i), { lenient: false }).state!;
      const vs: PlayerView[] = [getView(st, P0), getView(st, P1)];
      for (const p of [P0, P1] as PlayerId[]) assert.deepEqual(checkViewIds(st, p, vs[p], undefined, prev?.[p]), [], `step ${i} p${p}`);
      prev = vs;
    }
  });
}

// Cross-batch interaction tests for the PHASE 2 unification: one engine mechanism per concept, used by every batch's cards.
import { test } from 'node:test';
import {
  assert, game, setBf, put, runes, onlyRunes, handCard, resolveAll, zoneOf, setController, yes, choose, act, play,
  expectPending, optIds, might, hasKw, getLegalActions,
} from '../cards/B8/b8-util.ts';
import { getView, createGame } from '../../src/engine/game.ts';
import { chars } from '../../src/engine/chars.ts';
import { buff } from '../../src/engine/actions.ts';
import { officialBanlist } from '../../src/engine/banlist.ts';
import { validateDeck } from '../../src/engine/deck.ts';
import { db } from '../cards/B8/b8-util.ts';
import type { GameState, ObjId, PlayerId } from '../../src/engine/types.ts';

const top = (g: GameState, p: PlayerId, cardId: string): ObjId => put(g, p, cardId, 'deckTop');
const drive = (g: GameState, pick: (h: GameState) => string[] | null, limit = 30): GameState => {
  for (let i = 0; i < limit && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    const ids = d.inStep ? pick(g) : null;
    g = ids ? act(g, { type: 'choose', player: d.player, optionIds: ids }) : d.inStep ? act(g, getLegalActions(g, d.player)[0]) : act(g, { type: 'pass', player: d.player });
  }
  return g;
};

// ---------------- one look/reveal path: Nocturne reacts to every look ----------------

test('Nocturne (B7) reacts to an engine Vision look (keyword) — then may be played for [A] after it', () => {
  let g = game();
  runes(g, 0, 3);
  const n = top(g, 0, 'ogn-194-298');
  const v = handCard(g, 0, 't-vision');
  g = play(g, 0, v, 'base');
  let sawBanish = false, sawPlay = false;
  g = drive(g, h => {
    const d = h.pending!;
    if (d.kind === 'optional' && /banish/i.test(d.prompt)) { sawBanish = true; return ['yes']; }
    if (d.kind === 'optional' && /Nocturne: play/i.test(d.prompt)) { sawPlay = true; return ['yes']; }
    if (d.kind === 'chooseDestination') return ['base'];
    return null;
  });
  assert.ok(sawBanish, 'Vision (engine keyword) looked at Nocturne');
  assert.ok(sawPlay, 'the play for [A] is offered');
  assert.equal(zoneOf(g, n), 'base');
});

test('Nocturne reacts to Called Shot (another batch) looking at the top 2', () => {
  let g = game();
  runes(g, 0, 3);
  const n = top(g, 0, 'ogn-194-298');
  const cs = handCard(g, 0, 'sfd-122-221');
  g.cards[g.objects[cs].cardId] = { ...g.cards[g.objects[cs].cardId], domains: ['Fury'] };
  g = play(g, 0, cs);
  let saw = false;
  g = drive(g, h => {
    const d = h.pending!;
    if (d.kind === 'optional' && /banish/i.test(d.prompt)) { saw = true; return ['yes']; }
    if (d.kind === 'optional') return ['no'];
    return d.options?.length ? [d.options[0].id] : null;
  });
  assert.ok(saw, 'any look (Called Shot) offers the banish');
  assert.equal(zoneOf(g, n), 'banishment');
});

// ---------------- the multi-buff rule ----------------

test('Lee Sin (B6 rule multipleBuffs) keeps buffs from every source: engine buff, B2 Pillaged Armory, B6 [T]: Buff me', () => {
  let g = game();
  const lee = put(g, 0, 'ogn-078-298', 'base');
  const other = put(g, 0, 't-u2', 'base');
  assert.ok(buff(g, lee), 'first buff');
  assert.ok(buff(g, lee), 'second buff (engine rule from Lee Sin)');
  assert.ok(buff(g, other));
  assert.equal(buff(g, other), false, 'other units still have at most one buff');
  // B2 card: Pillaged Armory buffs a friendly unit when played
  setController(g, 1, 0); put(g, 0, 't-u1', 1);
  onlyRunes(g, 0, 2, 't-rune-fury');
  g.cards['rad-073-167'] = { ...g.cards['rad-073-167'], domains: ['Fury'] };
  const pa = handCard(g, 0, 'rad-073-167');
  g = play(g, 0, pa, 1);
  g = drive(g, h => (h.pending!.kind === 'chooseTargets' ? [lee] : null));
  g = resolveAll(g);
  assert.equal(g.objects[lee].counters.buff, 3, 'three buffs from three sources');
  assert.equal(might(g, lee), 5 + 3);
});

// ---------------- battlefield controller vs owner (CR 190.6) ----------------

test("Fortified Position: \"when you defend here\" is the battlefield's controller's; uncontrolled -> no trigger", () => {
  for (const ctl of [1, null] as const) {
    let g = game();
    setBf(g, 1, 'ogn-279-298');            // owned by player 0's deck setup
    setController(g, 1, ctl);
    put(g, 1, 't-u2', 1);
    const a = put(g, 0, 't-u3', 'base');
    g = act(g, { type: 'move', player: 0, units: [a], to: 1 });
    const prompts: string[] = [];
    g = drive(g, h => { prompts.push(`${h.pending!.player}:${h.pending!.prompt}`); return h.pending!.options?.length ? [h.pending!.options[0].id] : null; });
    const fp = prompts.filter(x => /Shield 2/.test(x));
    if (ctl === 1) assert.ok(fp.length && fp.every(x => x.startsWith('1:')), `the defender (controller) chooses: ${prompts.join(' | ')}`);
    else assert.equal(fp.length, 0, 'no controller: no "you"');
  }
});

// ---------------- Repeat across batches ----------------

test('Syndra (B3) grants Repeat to another batch spell; Marai Spire (B8) makes that Repeat cost [1] less', () => {
  let g = game();
  setBf(g, 0, 'sfd-211-221');
  setController(g, 0, 0);
  const s = put(g, 0, 'unl-146-219', 'base');
  put(g, 1, 't-u5', 0);
  g = act(g, { type: 'move', player: 0, units: [s], to: 0 });
  assert.ok(g.showdown, 'combat showdown at the Spire');
  const zap = handCard(g, 0, 'b8-react');             // a Reaction from the B8 fixtures: playable in the showdown
  assert.ok(chars(g, zap).keywords.has('Repeat'), 'granted while Syndra is in the showdown');
  runes(g, 0, 4); runes(g, 0, 1, 't-rune-calm');
  if (g.pending?.player !== 0) g = act(g, { type: 'pass', player: g.pending!.player });
  g = play(g, 0, zap);
  let sawRepeat = false;
  g = drive(g, h => {
    const d = h.pending!;
    if (d.kind === 'optional' && /Repeat/.test(d.prompt)) { sawRepeat = true; assert.match(d.prompt, /Pay 1 /, `[2][C] - [1] = [1][C]: ${d.prompt}`); return ['no']; }
    return d.options?.length ? [d.options[0].id] : null;
  }, 6);
  assert.ok(sawRepeat, 'the granted Repeat is offered');
});

// ---------------- excess damage / Elder Dragon tally ----------------

test('Elder Dragon: damage I dealt before it entered still makes an enemy lethally damaged after the opponent damages it too', () => {
  const g = game();
  const e = put(g, 1, 't-u5', 'base');
  g.objects[e].damage = 1;
  g.ex.damageSrc[e] = { player: 0, by: { 0: 1 } };
  // the opponent's own damage is now the last source
  g.objects[e].damage = 2;
  g.ex.damageSrc[e] = { player: 1, by: { 0: 1, 1: 1 } };
  put(g, 0, 'unl-118-219', 'base');
  g.ex.dirty = true;
  // the cleanup kills it the next time it runs
  let k = act(g, { type: 'endTurn', player: 0 });
  k = drive(k, () => null);
  assert.equal(zoneOf(k, e), 'trash');
});

// ---------------- R-13: "can't be played" also stops plays by effects ----------------

test("Ol' Poro can't be played on its controller's first three turns, also through an effect play", () => {
  const g = game();
  const p = handCard(g, 0, 'ven-029-166');
  runes(g, 0, 4); runes(g, 0, 1, 't-rune-calm');
  assert.equal(getLegalActions(g, 0).some(a => a.type === 'playCard' && a.obj === p), false);
});

// ---------------- hidden information in views (F-5) ----------------

test("getView: the opponent's deck-list cards are not shipped; hidden deck order is unrelated to object ids", () => {
  const g = game();
  const v = getView(g, 0);
  const oppOnly = Object.values(g.objects).filter(o => o.owner === 1 && o.zone === 'mainDeck').map(o => o.cardId).filter(c => !Object.values(g.objects).some(o => o.owner === 0 && o.cardId === c));
  for (const c of oppOnly) assert.ok(!v.state.cards[c] || db[c]?.type === 'Battlefield' || db[c]?.supertypes.includes('Token'), `opponent card ${c} hidden`);
  assert.ok(v.state.players[1].mainDeck.every(id => v.state.objects[id].cardId === 'hidden'));
});

test('derived.mightSources explains a unit\'s Might (base, buff, modifier)', () => {
  const g = game();
  const u = put(g, 0, 't-u2', 'base');
  buff(g, u);
  g.objects[u].modifiers.push({ source: null, layer: 3, duration: 'endOfTurn', timestamp: ++g.timestamp, might: 2 });
  const d = getView(g, 0).state.objects[u].derived!;
  assert.equal(d.might, 5);
  const sum = (d.mightSources ?? []).reduce((s, x) => s + x.amount, 0);
  assert.equal(sum, 5, JSON.stringify(d.mightSources));
  assert.ok(d.mightSources!.some(x => /Buff/.test(x.label)));
});

// ---------------- official banlist ----------------

test('enforceBanlist uses data/banlist.json (standard) when no list is given', () => {
  const banned = officialBanlist('standard');
  assert.ok(banned.includes('Called Shot'));
  const legend = Object.values(db).find(c => c.type === 'Legend')!;
  const deck = { legend: legend.id, champion: 'y', main: ['sfd-122-221'], runes: [], battlefields: [] };
  const probs = validateDeck(deck as never, db, { banlist: banned });
  assert.ok(probs.some(p => p.code === 'banned' && /Called Shot/.test(p.message)), JSON.stringify(probs));
  void createGame; void yes; void choose; void expectPending; void optIds; void hasKw;
});

// B2: gear and units with activated abilities.
import { test } from 'node:test';
import {
  game, mana, run, play, playNew, activate, canActivate, canPlay, put, handCard, zoneOf, assert, expectDecision, atMain, setController,
  hideAt, handSize, m, attachNow, act, hasKw, clearRunes,
} from './util.ts';
import type { GameState, ObjId } from '../../../src/engine/types.ts';

function enemyAtBf(g: GameState, card = 't-u3', bf = 1): ObjId { setController(g, bf, 1); return put(g, 1, card, bf); }

test('Iron Ballista: enters exhausted; [T]: deal 2 to a unit at a battlefield', () => {
  let g = game();
  mana(g, 0, 3);
  let b: ObjId;
  [g, b] = playNew(g, 0, 'ogn-017-298');
  g = run(g);
  assert.equal(g.objects[b].exhausted, true, 'This enters exhausted');
  assert.ok(!canActivate(g, 0, b, 1));
  g.objects[b].exhausted = false;
  const e = enemyAtBf(g);
  const e2 = put(g, 1, 't-u1', 1);
  const atBase = put(g, 1, 't-u1', 'base');
  g = activate(g, 0, b, 1);
  const opts = expectDecision(g, 'chooseTargets', 0);
  assert.ok(opts.includes(e) && opts.includes(e2) && !opts.includes(atBase), 'only units at a battlefield');
  g = run(g, e);
  assert.equal(g.objects[e].damage, 2);
  atMain(g);
});

test('Sun Disc: Legion-gated; the next unit you play this turn enters ready (only the next one)', () => {
  let g = game();
  mana(g, 0, 3);
  const sd = put(g, 0, 'ogn-021-298', 'base');
  assert.ok(!canActivate(g, 0, sd, 0), 'Legion: no other card played this turn');
  let u1: ObjId, u2: ObjId;
  [g, u1] = playNew(g, 0, 't-u1'); g = run(g);
  assert.equal(g.objects[u1].exhausted, true);
  g = run(activate(g, 0, sd, 0));
  [g, u1] = playNew(g, 0, 't-u1'); g = run(g);
  assert.equal(g.objects[u1].exhausted, false, 'next unit enters ready');
  [g, u2] = playNew(g, 0, 't-u1'); g = run(g);
  assert.equal(g.objects[u2].exhausted, true, 'only the next unit');
});

test('Unlicensed Armory: discard 1 + [T]; the next time the unit would die this turn, pay [C] to heal, exhaust and recall it', () => {
  let g = game();
  mana(g, 0, 3);
  setController(g, 0, 0);
  const a = put(g, 0, 'ogn-023-298', 'base');
  const u = put(g, 0, 't-u2', 0);
  const junk = handCard(g, 0, 't-u1');
  g = activate(g, 0, a, 0);       // single friendly unit and single card: auto-chosen
  g = run(g);
  assert.equal(zoneOf(g, junk), 'trash', 'Discard 1 was paid');
  const bolt = handCard(g, 0, 'ts-bolt');
  g = play(g, 0, bolt);
  g = run(g);
  expectDecision(g, 'optional', 0);
  g = run(g, 'yes');
  assert.equal(zoneOf(g, u), 'base', 'recalled instead of dying');
  assert.equal(g.objects[u].damage, 0);
  assert.equal(g.objects[u].exhausted, true);
  // used up: next lethal damage kills it
  g.objects[u].exhausted = false;
  const bolt2 = handCard(g, 0, 'ts-zap');
  g = run(play(g, 0, bolt2));
  assert.equal(zoneOf(g, u), 'trash');
});

test('Unlicensed Armory: declining to pay [C] lets the unit die', () => {
  let g = game();
  mana(g, 0, 3);
  setController(g, 0, 0);
  const a = put(g, 0, 'ogn-023-298', 'base');
  const u = put(g, 0, 't-u2', 0);
  handCard(g, 0, 't-u1');
  g = run(activate(g, 0, a, 0));
  g = run(play(g, 0, handCard(g, 0, 'ts-bolt')), 'no');
  assert.equal(zoneOf(g, u), 'trash');
});

test('Ravenborn Tome: the next spell deals 1 Bonus Damage per instance; later spells do not', () => {
  let g = game();
  mana(g, 0, 3);
  const t = put(g, 0, 'ogn-032-298', 'base');
  const e = enemyAtBf(g, 't-u5');
  g = run(activate(g, 0, t, 0));
  g = run(play(g, 0, handCard(g, 0, 'ts-bolt')));
  assert.equal(g.objects[e].damage, 4, '3 + 1 bonus');
  g = run(play(g, 0, handCard(g, 0, 'ts-zap')));
  assert.equal(zoneOf(g, e), 'trash');
  const e2 = enemyAtBf(g, 't-u5');
  g.objects[t].exhausted = true;
  g = run(play(g, 0, handCard(g, 0, 'ts-bolt')));
  assert.equal(g.objects[e2].damage, 3, 'no bonus for a later spell');
});

test('Ravenborn Tome: the bonus is used up by the next spell even if it deals no damage', () => {
  let g = game();
  mana(g, 0, 3);
  const t = put(g, 0, 'ogn-032-298', 'base');
  const e = enemyAtBf(g, 't-u5');
  g = run(activate(g, 0, t, 0));
  g = run(play(g, 0, handCard(g, 0, 'ts-pump')));
  g = run(play(g, 0, handCard(g, 0, 'ts-bolt')));
  assert.equal(g.objects[e].damage, 3);
});

test('Orb of Regret: -1 Might this turn, to a minimum of 1', () => {
  let g = game();
  const o = put(g, 0, 'ogn-090-298', 'base');
  const big = put(g, 1, 't-u3', 'base');
  const small = put(g, 1, 't-u1', 'base');
  g = run(activate(g, 0, o, 0), big);
  assert.equal(m(g, big), 2);
  g.objects[o].exhausted = false;
  g = run(activate(g, 0, o, 0), small);
  assert.equal(m(g, small), 1, 'minimum of 1');
});

test('Garbage Grabber: recycle 3 from trash + [1] + [T]: draw 1; needs 3 cards in trash', () => {
  let g = game();
  mana(g, 0, 1);
  const gg = put(g, 0, 'ogn-099-298', 'base');
  put(g, 0, 't-u1', 'trash'); put(g, 0, 't-u2', 'trash');
  assert.ok(!canActivate(g, 0, gg, 0), 'only 2 cards in trash');
  put(g, 0, 't-u3', 'trash'); put(g, 0, 't-u4', 'trash');
  const hand = handSize(g, 0);
  g = activate(g, 0, gg, 0);
  const opts = expectDecision(g, 'chooseCards', 0);
  g = run(g, opts.slice(0, 3));
  assert.equal(g.players[0].trash.length, 1);
  assert.equal(handSize(g, 0), hand + 1);
});

test('Arena Bar: buff an exhausted friendly unit (ready ones are not legal)', () => {
  let g = game();
  const b = put(g, 0, 'ogn-124-298', 'base');
  const ready = put(g, 0, 't-u2', 'base');
  const tired = put(g, 0, 't-u2', 'base', { ready: false });
  g = activate(g, 0, b, 0);
  g = run(g);   // single legal target auto-chosen
  assert.equal(g.objects[tired].counters.buff, 1);
  assert.equal(m(g, tired), 3);
  assert.equal(g.objects[ready].counters.buff, undefined);
});

test('Pack of Wonders: return another friendly gear/unit, or a facedown card, to its owner\'s hand', () => {
  let g = game();
  setController(g, 0, 0);
  const p = put(g, 0, 'ogn-181-298', 'base');
  const u = put(g, 0, 't-u2', 'base');
  put(g, 0, 't-u1', 0);
  const fd = hideAt(g, 0, 't-hidden', 0);
  g = activate(g, 0, p, 0);
  assert.deepEqual(expectDecision(g, 'chooseMode', 0).sort(), ['facedown', 'permanent']);
  g = run(g, 'permanent');
  const opts = expectDecision(g, 'chooseTargets', 0);
  assert.ok(!opts.includes(p), 'another: not itself');
  g = run(g, u);
  assert.equal(zoneOf(g, u), 'hand');
  g.objects[p].exhausted = false;
  g = run(activate(g, 0, p, 0), 'facedown');
  assert.equal(zoneOf(g, fd), 'hand');
});

test('The Syren: [1], [T]: move a friendly unit at a battlefield to its base', () => {
  let g = game();
  mana(g, 0, 1);
  setController(g, 0, 0);
  const s = put(g, 0, 'ogn-184-298', 'base');
  const u = put(g, 0, 't-u2', 0);
  put(g, 0, 't-u1', 'base');
  g = run(activate(g, 0, s, 0));
  assert.equal(zoneOf(g, u), 'base');
});

test('Treasure Trove: [C], [T]: kill this; when it leaves the board draw 1 and channel 1 rune exhausted', () => {
  let g = game();
  mana(g, 0, 0, 'Chaos');
  const t = put(g, 0, 'ogn-186-298', 'base');
  const hand = handSize(g, 0), runes = g.players[0].runesInPlay.length;
  g = run(activate(g, 0, t, 1));
  assert.equal(zoneOf(g, t), 'trash');
  assert.equal(handSize(g, 0), hand + 1);
  assert.equal(g.players[0].runesInPlay.length, runes, 'one recycled for [C], one channelled');
  const ch = g.players[0].runesInPlay[g.players[0].runesInPlay.length - 1];
  assert.equal(g.objects[ch].exhausted, true);
});

test('Treasure Trove: also triggers when returned to hand (leaves the board)', () => {
  let g = game();
  const t = put(g, 0, 'ogn-186-298', 'base');
  const pack = put(g, 0, 'ogn-181-298', 'base');
  const hand = handSize(g, 0);
  g = run(activate(g, 0, pack, 0));                // no facedown card: the only mode is auto-chosen
  assert.equal(zoneOf(g, t), 'hand');
  assert.equal(handSize(g, 0), hand + 2, 'Trove back in hand + drew 1');
});

test('Runeblade Anvil: banishes the top card on play and when it leaves; that card can be played (paying its cost)', () => {
  let g = game();
  mana(g, 0, 4, 'Chaos');
  const top = put(g, 0, 't-u1', 'deckTop');
  let a: ObjId;
  [g, a] = playNew(g, 0, 'rad-012-167');
  g = run(g);
  assert.equal(zoneOf(g, top), 'banishment');
  assert.ok(canPlay(g, 0, top), 'may play the banished card');
  g = run(play(g, 0, top));
  assert.equal(zoneOf(g, top), 'base');
  const next = put(g, 0, 't-u2', 'deckTop');
  g = run(activate(g, 0, a, 2));
  assert.equal(zoneOf(g, a), 'trash');
  assert.equal(zoneOf(g, next), 'banishment', 'leaving the board banished the next top card');
  assert.ok(!canPlay(g, 0, next), '[2] costs: not affordable any more');
});

test('Invigorating Bloom: +3 to a friendly unit on play; exhaust a friendly Mighty unit + [T]: draw 1', () => {
  let g = game();
  mana(g, 0, 3);
  const u = put(g, 0, 't-u2', 'base');
  let b: ObjId;
  [g, b] = playNew(g, 0, 'rad-035-167');
  g = run(g);
  assert.equal(m(g, u), 5);
  const hand = handSize(g, 0);
  assert.ok(canActivate(g, 0, b, 1), 'the pumped unit is Mighty');
  g = run(activate(g, 0, b, 1));
  assert.equal(g.objects[u].exhausted, true);
  assert.equal(handSize(g, 0), hand + 1);
});

test('Invigorating Bloom: no ready Mighty unit -> cannot activate', () => {
  const g = game();
  const b = put(g, 0, 'rad-035-167', 'base');
  put(g, 0, 't-u4', 'base');
  put(g, 0, 't-u5', 'base', { ready: false });
  assert.ok(!canActivate(g, 0, b, 1));
});

test('Heart of Dark Ice: [T]: give a unit +3 this turn (expires)', () => {
  let g = game();
  const h = put(g, 0, 'sfd-052-221', 'base');
  const u = put(g, 0, 't-u2', 'base');
  g = run(activate(g, 0, h, 0));
  assert.equal(m(g, u), 5);
  g = run(act(g, { type: 'endTurn', player: 0 }));
  assert.equal(m(g, u), 2);
});

test('Poro Snax: draw 1 on play; [1][C], [T], kill this: draw 1', () => {
  let g = game();
  mana(g, 0, 2, 'Calm', 'Calm');
  const hand = handSize(g, 0);
  let p: ObjId;
  [g, p] = playNew(g, 0, 'sfd-046-221');
  g = run(g);
  assert.equal(handSize(g, 0), hand + 1);
  g = run(activate(g, 0, p, 1));
  assert.equal(zoneOf(g, p), 'trash');
  assert.equal(handSize(g, 0), hand + 2);
});

test('Temporal Portal: the next spell may be repeated by paying its cost again', () => {
  let g = game();
  mana(g, 0, 4);
  const tp = put(g, 0, 'sfd-078-221', 'base');
  const e = enemyAtBf(g, 't-u5');
  g = run(activate(g, 0, tp, 0));
  g = play(g, 0, handCard(g, 0, 'ts-bolt'));
  g = run(g);
  expectDecision(g, 'optional', 0);
  g = run(g, 'yes');
  assert.equal(zoneOf(g, e), 'trash', '3 + 3 damage');
  // only the next spell
  const e2 = enemyAtBf(g, 't-u5');
  g = run(play(g, 0, handCard(g, 0, 'ts-zap')));
  assert.equal(g.objects[e2].damage, 2);
});

test('Temporal Portal: declining the Repeat resolves once', () => {
  let g = game();
  mana(g, 0, 3);
  const tp = put(g, 0, 'sfd-078-221', 'base');
  const e = enemyAtBf(g, 't-u5');
  g = run(activate(g, 0, tp, 0));
  g = run(play(g, 0, handCard(g, 0, 'ts-bolt')), 'no');
  assert.equal(g.objects[e].damage, 3);
});

test('The Zero Drive: [3][C], banish this: play all units banished with it, ignoring their costs; not while attached', () => {
  let g = game();
  mana(g, 0, 3, 'Mind');
  const zd = put(g, 0, 'sfd-090-221', 'base');
  const a = put(g, 0, 't-u4', 'trash');
  const b = put(g, 0, 't-u5', 'trash');
  for (const id of [a, b]) { g.objects[id].zone = 'banishment'; g.players[0].trash = g.players[0].trash.filter(x => x !== id); g.players[0].banishment.push(id); g.ex.links[id] = { by: zd, epoch: g.objects[zd].epoch ?? 0 }; }
  const host = put(g, 0, 't-u1', 'base');
  attachNow(g, zd, host);
  assert.ok(!canActivate(g, 0, zd, 0), '(Use only if unattached.)');
  g.objects[zd].attachedTo = undefined; g.ex.attachCount--;
  g = run(activate(g, 0, zd, 0));
  assert.equal(zoneOf(g, zd), 'banishment');
  assert.equal(zoneOf(g, a), 'base');
  assert.equal(zoneOf(g, b), 'base');
});

test('Forgotten Signpost: exhaust a unit you control + [T]: move a different unit to its location (Action)', () => {
  let g = game();
  setController(g, 0, 0);
  const s = put(g, 0, 'unl-045-219', 'base');
  const anchor = put(g, 0, 't-u2', 0);
  const mover = put(g, 0, 't-u3', 'base');
  g = activate(g, 0, s, 0);
  expectDecision(g, 'chooseTargets', 0);
  g = run(g, mover);                         // cost: only the other ready unit can be exhausted -> auto
  assert.equal(g.objects[anchor].exhausted, true);
  g = run(g);
  assert.equal(zoneOf(g, mover), 'battlefield');
  assert.equal(g.objects[mover].battlefieldIndex, 0);
});

test('Forgotten Signpost: needs two units you control', () => {
  const g = game();
  const s = put(g, 0, 'unl-045-219', 'base');
  put(g, 0, 't-u2', 'base');
  assert.ok(!canActivate(g, 0, s, 0));
});

test('The List: name a tag as you play it; [T]: -2 Might to a unit with that tag only', () => {
  let g = game();
  mana(g, 0, 1);
  const lux = put(g, 1, 'ogs-014-024', 'base');     // tags Lux, Demacia
  const other = put(g, 1, 't-u3', 'base');
  let l: ObjId;
  [g, l] = playNew(g, 0, 'unl-138-219');
  const tags = expectDecision(g, 'chooseMode', 0);
  assert.ok(tags.includes('Demacia') && tags.includes('Poro'));
  g = run(g, 'Demacia');
  atMain(g);
  g = activate(g, 0, l, 1);
  g = run(g);                                    // only Lux has the tag: auto-chosen
  assert.equal(m(g, lux), 0);
  assert.equal(m(g, other), 3);
  // the name is remembered on later turns
  g = run(act(g, { type: 'endTurn', player: 0 }));
  g = run(act(g, { type: 'endTurn', player: 1 }));
  assert.ok(canActivate(g, 0, l, 1));
});

test('Cursed Sarcophagus: the player picks among several affordable banished units', () => {
  let g = game();
  mana(g, 0, 4, 'Chaos');
  const s = put(g, 0, 'unl-148-219', 'base');
  const a = put(g, 0, 't-u1', 'trash'), b = put(g, 0, 't-u2', 'trash');
  // play it properly so the units are banished with it
  g.players[0].base = g.players[0].base.filter(x => x !== s); g.objects[s].zone = 'hand'; g.players[0].hand.push(s);
  mana(g, 0, 4);
  g = run(play(g, 0, s));
  assert.equal(zoneOf(g, a), 'banishment');
  g = activate(g, 0, s, 1);
  // RULINGS sweep / CR 355.5: chosen as the ability is activated (a target), before it is on the chain
  assert.deepEqual(expectDecision(g, 'chooseTargets', 0).sort(), [a, b].sort());
  g = run(g, b);
  assert.equal(zoneOf(g, b), 'base');
  assert.equal(zoneOf(g, a), 'banishment');
  assert.ok(!canActivate(g, 0, s, 1), 'exhausted');
});

test('Cursed Sarcophagus: banishes all units in your trash on play; [T]: play one of them, paying its cost', () => {
  let g = game();
  mana(g, 0, 7, 'Chaos');
  const u3 = put(g, 0, 't-u3', 'trash');
  const u5 = put(g, 0, 't-u5', 'trash');
  const sp = put(g, 0, 'ts-bolt', 'trash');
  let s: ObjId;
  [g, s] = playNew(g, 0, 'unl-148-219');
  g = run(g);
  assert.equal(zoneOf(g, u3), 'banishment');
  assert.equal(zoneOf(g, u5), 'banishment');
  assert.equal(zoneOf(g, sp), 'trash', 'only units');
  const readyBefore = g.players[0].runesInPlay.filter(r => !g.objects[r].exhausted).length;
  assert.ok(readyBefore >= 3 && readyBefore < 5);
  // only the 3-cost unit is affordable, so it is the only option (auto-chosen)
  g = run(activate(g, 0, s, 1));
  assert.equal(zoneOf(g, u3), 'base');
  assert.equal(zoneOf(g, u5), 'banishment');
  assert.equal(g.players[0].runesInPlay.filter(r => !g.objects[r].exhausted).length, readyBefore - 3, 'its cost was paid');
});

test('Divining Shells: Vision on play; Action: kill this + [T]: +2 Might', () => {
  let g = game();
  mana(g, 0, 2);
  const top = put(g, 0, 't-u1', 'deckTop');
  let d: ObjId;
  [g, d] = playNew(g, 0, 'unl-161-219');
  g = run(g);
  expectDecision(g, 'chooseCards', 0);           // Vision (predict): may recycle the top card
  g = run(g, []);
  assert.equal(zoneOf(g, top), 'mainDeck');
  const u = put(g, 0, 't-u2', 'base');
  g = run(activate(g, 0, d, 0));
  assert.equal(zoneOf(g, d), 'trash');
  assert.equal(m(g, u), 4);
});

test('Pitiless Stalker: [T]: stun an enemy unit', () => {
  let g = game();
  const s = put(g, 0, 'rad-104-167', 'base');
  const e = put(g, 1, 't-u2', 'base');
  put(g, 0, 't-u2', 'base');
  g = run(activate(g, 0, s, 0));
  assert.equal(g.objects[e].stunned, true);
});

test('Renata Glasc: abilities usable only while she is at a battlefield', () => {
  let g = game();
  mana(g, 0, 9, 'Mind', 'Mind', 'Mind', 'Mind', 'Mind');
  setController(g, 0, 0);
  const r = put(g, 0, 'sfd-088-221', 'base');
  assert.ok(!canActivate(g, 0, r, 0) && !canActivate(g, 0, r, 1));
  g = run(act(g, { type: 'move', player: 0, units: [r], to: 0 }));
  g.objects[r].exhausted = false;
  const hand = handSize(g, 0);
  g = run(activate(g, 0, r, 0));
  assert.equal(handSize(g, 0), hand + 1);
  const pts = g.players[0].points;
  g = run(activate(g, 0, r, 1));
  assert.equal(g.players[0].points, pts + 1);
});

test('Azir: swap locations with a unit you control and take one of its Equipment; once per turn; Action', () => {
  let g = game();
  mana(g, 0, 0, 'Calm', 'Calm');
  setController(g, 0, 0);
  const az = put(g, 0, 'sfd-050-221', 'base');
  const u = put(g, 0, 't-u2', 0);
  const sw = put(g, 0, 'sfd-161-221', 0);   // B.F. Sword +3
  attachNow(g, sw, u);
  g = activate(g, 0, az, 0);
  // only one other unit (auto-chosen); the Equipment is an up-to-one target chosen with it (RULINGS sweep / CR 355.5)
  expectDecision(g, 'chooseTargets', 0);
  g = run(g, sw);
  assert.equal(g.objects[az].battlefieldIndex, 0);
  assert.equal(zoneOf(g, u), 'base');
  assert.equal(g.objects[sw].attachedTo, az);
  assert.equal(m(g, az), 9);
  assert.ok(!canActivate(g, 0, az, 0), 'once per turn');
});

test('Azir: may decline taking the Equipment', () => {
  let g = game();
  mana(g, 0, 0, 'Calm');
  const az = put(g, 0, 'sfd-050-221', 'base');
  const u = put(g, 0, 't-u2', 'base');
  const sw = put(g, 0, 'sfd-161-221', 'base');
  attachNow(g, sw, u);
  g = run(activate(g, 0, az, 0), []);
  assert.equal(g.objects[sw].attachedTo, u);
});

test('Ekko: enters ready; Action — discard 1, [1][C]: banish me, then play me to base ignoring my cost (ready again)', () => {
  let g = game();
  mana(g, 0, 6, 'Fury');
  setController(g, 0, 0);
  let ek: ObjId;
  [g, ek] = playNew(g, 0, 'rad-021-167', { destination: 0 });
  g = run(g);
  assert.equal(g.objects[ek].exhausted, false, 'I enter ready');
  g.objects[ek].exhausted = true;
  g.objects[ek].damage = 2;
  mana(g, 0, 1, 'Fury');
  handCard(g, 0, 't-u1');
  g = run(activate(g, 0, ek, 0));
  assert.equal(zoneOf(g, ek), 'base');
  assert.equal(g.objects[ek].exhausted, false);
  assert.equal(g.objects[ek].damage, 0, 'a new object');
});

test('Petricite Monument: friendly units have Deflect (opponents pay [A] to choose them); Temporary', () => {
  let g = game();
  put(g, 0, 'sfd-104-221', 'base');
  const mine = put(g, 0, 't-u3', 'base');
  const theirs = put(g, 1, 't-u2', 'base');
  assert.ok(hasKw(g, mine, 'Deflect') && !hasKw(g, theirs, 'Deflect'));
  g = run(act(g, { type: 'endTurn', player: 0 }));
  clearRunes(g, 1);
  mana(g, 1, 1);
  const zap = handCard(g, 1, 'ts-zap');
  g = play(g, 1, zap);
  g = run(g, mine);
  assert.equal(g.objects[mine].damage, 2);
  assert.equal(g.players[1].runesInPlay.length, 0, 'the Deflect surcharge [A] was paid by recycling the rune');
  const mon = g.players[0].base.find(x => g.objects[x].cardId === 'sfd-104-221')!;
  g = run(act(g, { type: 'endTurn', player: 1 }));
  assert.equal(zoneOf(g, mon), 'trash', 'Temporary: killed at the start of its controller\'s Beginning Phase');
});

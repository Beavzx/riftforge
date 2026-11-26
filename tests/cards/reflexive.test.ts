// SCRIPT-FIX-2: "Do this:" / "Then do this:" / "Do one of the following" parts are reflexive chain items (CR 387-389; VEN-FAQ Hwei;
// docs/rules-spec.md §8.3; RJ#8002). Each test stops when the reflexive item is the newest item on the chain and the opponent holds
// priority over it (the response window between the two parts), checks that its own choices were made as it went on the chain and
// that its effect hasn't happened yet, and then lets it resolve (or has the opponent respond first).
// Dragon's Rage, Deceiver and Disintegrate (the first three conversions) are covered in tests/riftjudge (RJ#3961/#10484/#8002).
import { test } from 'node:test';
import { game, mana, run, playNew, put, handCard, zoneOf, assert, act, pass, setController, m, hasKw, expectDecision } from './B2/util.ts';
import { moveToZone } from '../../src/engine/state.ts';
import { chars } from '../../src/engine/chars.ts';
import type { GameState, ObjId, PlayerId } from '../../src/engine/types.ts';

type Ans = string | string[] | ((g: GameState) => string[]);

/**
 * Answer in-step decisions in order and pass priority otherwise, until the newest item on the chain is the reflexive item whose
 * label matches `re` and the opponent (player 1) may respond to it. Fails if the main phase comes back first.
 */
function toWindow(g: GameState, re: RegExp, ...answers: Ans[]): GameState {
  const q = [...answers];
  for (let i = 0; i < 150; i++) {
    const d = g.pending;
    assert.ok(d, 'nothing pending');
    const top = g.chain.filter(c => !c.pending).at(-1);
    if (d.kind === 'chainResponse' && d.player === 1 && top && re.test(top.label ?? '')) {
      assert.equal(q.length, 0, `unused answers before the window: ${JSON.stringify(q.filter(a => typeof a !== 'function'))}`);
      return g;
    }
    assert.notEqual(d.kind, 'mainAction', `no response window for ${re} (chain: ${g.chain.map(c => c.label).join(' | ')})`);
    if (d.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: d.player, assignment: d.data!.suggested as Record<string, number> }); continue; }
    if (d.inStep) {
      assert.ok(q.length, `unanswered ${d.kind}: ${d.prompt}`);
      const a = q.shift()!;
      g = act(g, { type: 'choose', player: d.player, optionIds: typeof a === 'function' ? a(g) : Array.isArray(a) ? a : [a] });
      continue;
    }
    g = pass(g);
  }
  throw new Error('toWindow: too many steps');
}
/** option of the pending decision for an object */
const o = (id: ObjId) => (g: GameState): string[] => {
  const x = (g.pending!.options ?? []).find(op => op.id === id || op.objIds?.[0] === id);
  assert.ok(x, `${id} not offered in "${g.pending!.prompt}"`);
  return [x!.id];
};
/** the opponent responds to the reflexive item with Test Zap (Reaction: deal 2 to a unit) */
function zap(g: GameState, target: ObjId): GameState {
  const z = handCard(g, 1, 'ts-zap');
  g = act(g, { type: 'playCard', player: 1, obj: z });
  if (g.pending?.kind === 'chooseTargets') g = act(g, { type: 'choose', player: 1, optionIds: o(target)(g) });
  return g;
}
const name = (g: GameState, id: ObjId) => chars(g, id).name;
const deckTop = (g: GameState, p: PlayerId, cardId: string) => put(g, p, cardId, 'deckTop');
const sandSoldiers = (g: GameState) => Object.values(g.objects).filter(x => x.isToken && x.controller === 0 && (x.zone === 'base' || x.zone === 'battlefield') && g.cards[x.cardId]?.name === 'Sand Soldier').map(x => x.id);
const reflections = (g: GameState) => Object.values(g.objects).filter(x => x.isToken && x.controller === 0 && x.cardId === 'unl-t06' && (x.zone === 'base' || x.zone === 'battlefield')).map(x => x.id);

test('Guards!: "you may pay [C] to ready it" is decided and paid as the reflexive item goes on the chain; the opponent may respond (kill it)', () => {
  let g = game(); mana(g, 0, 3, 'Order'); mana(g, 1, 1);
  [g] = playNew(g, 0, 'sfd-154-221');
  g = toWindow(g, /Guards!: you may pay \[C\]/, 'yes');
  const [s] = sandSoldiers(g);
  assert.equal(g.objects[s].exhausted, true, 'not ready yet');
  assert.ok(!g.players[0].runesInPlay.some(r => g.objects[r].cardId === 'rad-r06'), '[C] (the Order rune) already paid');
  g = run(zap(g, s));
  assert.ok(!sandSoldiers(g).length, 'the opponent killed the Soldier in the window; nothing to ready');
  // without a response it is readied
  let h = game(); mana(h, 0, 3, 'Order');
  [h] = playNew(h, 0, 'sfd-154-221');
  h = toWindow(h, /Guards!: you may pay/, 'yes');
  h = run(h);
  assert.equal(h.objects[sandSoldiers(h)[0]].exhausted, false);
});

test('Arise!: "ready up to two of them" — the Soldiers are targets chosen as the reflexive item goes on the chain', () => {
  let g = game(); mana(g, 0, 6, 'Order');
  put(g, 0, 'ts-sword', 'base'); put(g, 0, 'ts-sword', 'base'); put(g, 0, 'ts-sword', 'base');
  [g] = playNew(g, 0, 'sfd-198-221');
  g = run(g);
  expectDecision(g, 'chooseTargets', 0);
  const ss = sandSoldiers(g);
  assert.equal(ss.length, 3);
  g = toWindow(g, /Arise!: ready up to two/, [ss[0], ss[2]]);
  assert.ok(ss.every(s => g.objects[s].exhausted), 'chosen, not ready yet');
  g = run(g);
  assert.deepEqual(ss.map(s => g.objects[s].exhausted), [false, true, false]);
});

test('Keeper of Masks: the Reflections become copies in a separate reflexive item; Keeper killed in the window -> copies of its last known card', () => {
  let g = game(); mana(g, 0, 2); mana(g, 1, 1);
  [g] = playNew(g, 0, 'unl-081-219', { destination: 'base' });
  g = toWindow(g, /Keeper of Masks: they become copies/);
  const rs = reflections(g);
  assert.equal(rs.length, 2);
  assert.ok(rs.every(r => name(g, r) === 'Reflection' && m(g, r) === 0), 'still 0-Might Reflections in the window');
  const keeper = Object.values(g.objects).find(x => x.cardId === 'unl-081-219')!.id;
  g = run(zap(g, keeper));
  assert.equal(zoneOf(g, keeper), 'trash');
  assert.ok(rs.every(r => name(g, r) === 'Keeper of Masks' && m(g, r) === 1), 'copies of the Keeper as it last existed');
});

test('Mirror Image: "It becomes a copy of that unit. Give it [Temporary]" waits on the chain while the token is a 0-Might Reflection', () => {
  let g = game(); mana(g, 0, 3, 'Mind', 'Order');
  const e = put(g, 1, 't-u5', 0);
  [g] = playNew(g, 0, 'unl-200-219');
  g = toWindow(g, /Mirror Image: it becomes a copy/);
  const [r] = reflections(g);
  assert.equal(name(g, r), 'Reflection'); assert.equal(m(g, r), 0);
  assert.ok(!hasKw(g, r, 'Temporary'));
  g = run(g);
  assert.equal(m(g, r), 5); assert.ok(hasKw(g, r, 'Temporary'));
  void e;
});

test('Ivern: after revealing a Dog, "[Buff] a friendly unit" is a reflexive item whose unit is chosen as it goes on the chain', () => {
  let g = game(); mana(g, 0, 5, 'Calm');
  const ally = put(g, 0, 't-u2', 'base');
  deckTop(g, 0, 't-u2'); deckTop(g, 0, 't-u1'); const pet = deckTop(g, 0, 'ogn-165-298');   // Cemetery Attendant (Dog) on top
  [g] = playNew(g, 0, 'unl-051-219', { destination: 'base' });
  g = toWindow(g, /Ivern: buff a friendly unit/, o(pet), o(ally));
  assert.equal(zoneOf(g, pet), 'hand');
  assert.ok(!g.objects[ally].counters.buff, 'not buffed yet');
  g = run(g);
  assert.equal(g.objects[ally].counters.buff, 1);
});

test('Twisted Fate: "Do one of the following" — the Order branch is its own chain item; the enemy unit is chosen as it goes on the chain', () => {
  let g = game();
  const tf = put(g, 0, 'ogn-200-298', 'base');
  put(g, 1, 't-u3', 0); const e2 = put(g, 1, 't-u2', 0); setController(g, 0, 1);
  const r = put(g, 0, 'rad-r06', 'base'); moveToZone(g, r, 'runeDeck', { position: 'top' });
  g = act(g, { type: 'move', player: 0, units: [tf], to: 0 });
  g = toWindow(g, /Twisted Fate \[Y\]: stun/, o(e2));
  assert.ok(!g.objects[e2].stunned, 'not stunned yet');
  assert.equal(g.chain.at(-1)!.targets[0][0], e2, 'its target was chosen as it went on the chain');
  g = pass(g);                                                // the opponent passes: the branch resolves (before combat damage)
  assert.ok(g.objects[e2].stunned);
});

test('Bone Skewer: "If they do, then do this: [Stun] it" — the opponent gets a window with the played unit not yet stunned', () => {
  let g = game(); mana(g, 0, 2, 'Chaos');
  const u = handCard(g, 1, 't-u5');
  [g] = playNew(g, 0, 'unl-139-219');
  g = toWindow(g, /Bone Skewer: stun it/, (gg: GameState) => o(gg.battlefields[1].objId)(gg), o(u));
  assert.equal(g.objects[u].battlefieldIndex, 1); assert.equal(g.objects[u].controller, 1);
  assert.ok(!g.objects[u].stunned);
  g = run(g);
  assert.ok(g.objects[u].stunned);
});

test('Kharox: "Then you may do this" — the "you may" and the unit in their trash are decided after the Burn 3, as the item goes on the chain', () => {
  let g = game(); mana(g, 0, 6, 'Chaos', 'Chaos');
  const kx = put(g, 0, 'ven-114-166', 'base');
  deckTop(g, 1, 't-u1'); deckTop(g, 1, 'ogn-083-298'); const x = deckTop(g, 1, 't-u3');
  g = act(g, { type: 'activate', player: 0, obj: kx, abilityIndex: 901 });
  g = toWindow(g, /Kharox: play a unit from their trash/, 'yes', o(x));
  assert.equal(zoneOf(g, x), 'trash', 'chosen in the trash, not played yet');
  g = run(g);
  assert.equal(zoneOf(g, x), 'base'); assert.equal(g.objects[x].controller, 0);
});

test('Wild Claw: "Then you may do this: Empower it" — decided as the reflexive item goes on the chain, empowered on resolution', () => {
  let g = game(); mana(g, 0, 8, 'Body');
  deckTop(g, 0, 't-u4'); deckTop(g, 0, 't-u3'); deckTop(g, 0, 't-u2'); const kx = deckTop(g, 0, 'ven-114-166'); deckTop(g, 0, 't-u1');
  [g] = playNew(g, 0, 'ven-089-166');
  g = toWindow(g, /Wild Claw: you may empower it/, o(kx), 'yes');
  assert.equal(zoneOf(g, kx), 'base');
  assert.ok(!g.objects[kx].empowered, 'not empowered yet');
  g = run(g);
  assert.ok(g.objects[kx].empowered);
});

test('Forgotten Relic: burning a unit puts a reflexive item on the chain; the friendly unit is chosen then; a zap in the window can kill it', () => {
  let g = game(); mana(g, 0, 5); mana(g, 1, 1);
  const u = put(g, 0, 't-u1', 'base'); put(g, 0, 't-u2', 'base');
  deckTop(g, 0, 't-u4');
  [g] = playNew(g, 0, 'ven-108-166');
  g = toWindow(g, /Forgotten Relic: give a friendly unit/, o(u));
  assert.equal(m(g, u), 1, 'no +4 yet');
  g = run(zap(g, u));
  assert.equal(zoneOf(g, u), 'trash', 'killed in the window: the +4 does nothing');
  let h = game(); mana(h, 0, 5);
  const v = put(h, 0, 't-u1', 'base'); put(h, 0, 't-u2', 'base');
  deckTop(h, 0, 't-u4');
  [h] = playNew(h, 0, 'ven-108-166');
  h = run(toWindow(h, /Forgotten Relic: give a friendly unit/, o(v)));
  assert.equal(m(h, v), 5);
});

test('Death from Below: the replay is a reflexive item after the spell reached the trash; the opponent may respond before it is played', () => {
  let g = game(); mana(g, 0, 4, 'Fury', 'Chaos');
  const a = put(g, 1, 't-u3', 0), b = put(g, 1, 't-u2', 1);
  const dfb = handCard(g, 0, 'unl-186-219');
  g = act(g, { type: 'playCard', player: 0, obj: dfb });
  g = toWindow(g, /Death from Below: you may play this/, o(a), 'yes');
  assert.equal(zoneOf(g, a), 'trash');
  assert.equal(zoneOf(g, dfb), 'trash', 'in the trash during the window');
  g = run(g, 'no');                                           // replayed (b is the only target), then declines the second replay
  assert.equal(zoneOf(g, b), 'trash');
  assert.equal(zoneOf(g, dfb), 'trash');
});

test('Alpha Strike: "for each unit this kills, do this: Gain 1 XP" — one reflexive item per kill, after the damage', () => {
  let g = game(); mana(g, 0, 3, 'Calm');
  const f = put(g, 0, 't-u5', 'base');
  const e1 = put(g, 1, 't-u2', 0), e2 = put(g, 1, 't-u3', 1);
  [g] = playNew(g, 0, 'unl-192-219');
  g = toWindow(g, /Alpha Strike: gain 1 XP/, [e1, e2], '2');
  assert.equal(zoneOf(g, e1), 'trash'); assert.equal(zoneOf(g, e2), 'trash');
  assert.equal(g.players[0].xp, 0, 'no XP yet');
  assert.equal(g.chain.filter(c => /Alpha Strike: gain 1 XP/.test(c.label ?? '')).length, 2, 'one item per kill');
  g = run(g);
  assert.equal(g.players[0].xp, 2);
  void f;
});

test('Rell: "If you do, then do this: Attach it to me" — the opponent gets a window with the Equipment played but not attached', () => {
  let g = game();
  setController(g, 1, 1);
  put(g, 1, 't-u1', 1);
  const rell = put(g, 0, 'sfd-024-221', 'base');
  const blade = handCard(g, 0, 'sfd-095-221');                // Doran's Blade [2]
  g = act(g, { type: 'move', player: 0, units: [rell], to: 1 });
  g = toWindow(g, /Rell: attach it to me/, blade);
  assert.equal(zoneOf(g, blade), 'base');
  assert.equal(g.objects[blade].attachedTo, undefined);
  g = run(g);
  assert.equal(g.objects[blade].attachedTo, rell);
});

test('Hwei: each type branch is a reflexive item; the Gear branch\'s runes are chosen as it goes on the chain; a Unit gives +3 after a window', () => {
  let g = game();
  const h = put(g, 0, 'unl-080-219', 'base');
  const gear = handCard(g, 0, 'sfd-033-221');                 // Doran's Shield (Gear)
  deckTop(g, 0, 't-u2');
  mana(g, 0, 2);
  const rs = [...g.players[0].runesInPlay];
  for (const r of rs) g.objects[r].exhausted = true;
  g = act(g, { type: 'move', player: 0, units: [h], to: 0 });
  g = toWindow(g, /Hwei: the discarded card's type branch/, o(gear), rs);
  assert.equal(zoneOf(g, gear), 'trash');
  assert.ok(rs.every(r => g.objects[r].exhausted), 'chosen, not readied yet');
  g = run(g);
  assert.ok(rs.every(r => !g.objects[r].exhausted));
  let k = game();
  const h2 = put(k, 0, 'unl-080-219', 'base');
  const unit = handCard(k, 0, 't-u1');
  deckTop(k, 0, 't-u2');
  k = act(k, { type: 'move', player: 0, units: [h2], to: 0 });
  k = toWindow(k, /Hwei: the discarded card's type branch/, o(unit));
  assert.equal(m(k, h2), 5, 'no +3 yet');
  k = run(k);
  assert.equal(m(k, h2), 8);
});

// VIDEO-CHECK: HyBriiD, "5 Riftbound Interactions That Make No Sense" — one test per interaction, built from real cards
// (data/cards.json) and driven through the engine's normal actions/decisions. Only board setup is direct
// (put / control / fundAll); Kayle is empowered through her real activation and the Bombs are made by the real
// Amateur Demolitionist play trigger.
import { test } from 'node:test';
import {
  assert, S0, put, hand, control, act, move, endTurn, fundAll, legal, validateAction, attackSetup,
  P0, P1, BF_A, zone, locOf, mightOf, kwValue, readyRunes, pend,
  type GameState, type ObjId,
} from '../conformance/harness.ts';
import { withTokens, unitsNamed } from '../riftjudge/r11701.helpers.ts';

type Pick = (g: GameState) => string[] | undefined;
/** Drive: in-step decisions via `pick` (default: 'yes' for optional, else first option), chain/showdown priority passes,
 *  combat damage uses the engine's suggestion. Stops at a main-phase decision or when `until` holds. */
function run(g: GameState, pick: Pick = () => undefined, until?: (g: GameState) => boolean, limit = 300): GameState {
  for (let i = 0; i < limit; i++) {
    const d = g.pending;
    if (!d) return g;
    if (until && until(g)) return g;
    if (d.kind === 'mainAction') return g;
    if (d.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: d.player, assignment: (d.data as { suggested: Record<ObjId, number> }).suggested }); continue; }
    if (d.inStep) {
      const ids = pick(g) ?? (d.kind === 'optional' ? ['yes'] : [d.options![0].id]);
      g = act(g, { type: 'choose', player: d.player, optionIds: ids });
      continue;
    }
    g = act(g, { type: 'pass', player: d.player });
  }
  throw new Error('run: too many steps');
}
const has = (g: GameState, id: string) => !!g.pending?.options?.some(o => o.id === id);

// ------------------------------------------------------------------------------------------------
// 1. Soraka, Wanderer + Unchecked Power
// ------------------------------------------------------------------------------------------------
test('VIDEO-1 Unchecked Power kills Soraka, Wanderer and four 2-Might units at once: Soraka dies, the four are healed, exhausted and recalled (CR 370.4)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1);
  const sor = put(g, P0, 'Soraka, Wanderer', BF_A);
  const small = ['Legion Rearguard', 'Legion Rearguard', 'Daring Poro', 'Daring Poro'].map(n => put(g, P0, n, BF_A));
  control(g, BF_A, P0);
  assert.equal(mightOf(g, sor), 4);
  for (const u of small) assert.equal(mightOf(g, u), 2);
  const up = hand(g, P1, 'Unchecked Power');
  g = run(act(g, { type: 'playCard', player: P1, obj: up }));
  assert.equal(zone(g, sor), 'trash', 'Soraka dies (12 damage, nothing replaces her own death)');
  for (const u of small) {
    assert.equal(locOf(g, u), 'base', 'recalled to base instead of dying');
    assert.equal(g.objects[u].damage, 0, 'healed');
    assert.equal(g.objects[u].exhausted, true, 'exhausted');
  }
});

// ------------------------------------------------------------------------------------------------
// 2. Bomb tokens vs fully empowered Kayle, Justified (Deflect 3)
// ------------------------------------------------------------------------------------------------
/** P1: Kayle, Justified at BF_A empowered 3 times (real activation); P0: four Bombs at BF_A (four Amateur Demolitionists),
 *  12 ready runes; P0 ends the turn so P1's next Beginning Phase holds BF_A. Returns the state right after P0's endTurn. */
function bombSetup(): { g: GameState; kayle: ObjId; bombs: ObjId[] } {
  let g = withTokens(S0({ tp: P1 })); fundAll(g, P1, 2);
  const kayle = put(g, P1, 'Kayle, Justified', BF_A); control(g, BF_A, P1);
  for (let i = 0; i < 3; i++) {
    const a = legal(g, P1, 'activate').find(x => x.type === 'activate' && x.obj === kayle);
    assert.ok(a, `Kayle empower activation ${i + 1} legal`);
    g = run(act(g, a!));
  }
  assert.equal(mightOf(g, kayle), 9, '3 + 2*3');
  assert.equal(kwValue(g, kayle, 'Deflect'), 3, 'Deflect 3 while empowered three times');
  g = endTurn(g, P1);
  g = run(g);
  assert.equal(pend(g).kind, 'mainAction'); assert.equal(pend(g).player, P0);
  fundAll(g, P0, 4);
  for (let i = 0; i < 4; i++) {
    const d = hand(g, P0, 'Amateur Demolitionist');
    g = run(act(g, { type: 'playCard', player: P0, obj: d, destination: 'base' }), x => (x.pending?.kind === 'chooseBattlefield' ? [String(BF_A)] : undefined));
  }
  const bombs = unitsNamed(g, 'Bomb').length ? unitsNamed(g, 'Bomb') : Object.keys(g.objects).filter(id => g.cards[g.objects[id].cardId]?.name === 'Bomb' && g.objects[id].zone === 'battlefield');
  assert.equal(bombs.length, 4, 'four Bombs');
  for (const b of bombs) assert.equal(locOf(g, b), BF_A);
  fundAll(g, P0, 2);       // setup: 12 ready runes — enough to pay Deflect 3 four times
  assert.equal(readyRunes(g, P0), 12);
  g = endTurn(g, P0);
  return { g, kayle, bombs };
}

test('VIDEO-2a Bombs killed by Deploy vs a lone Deflect 3 Kayle: the Bomb owner is offered the Deflect payment and may decline each (PATCH-1); Kayle takes nothing, no runes spent', () => {
  let { g, kayle, bombs } = bombSetup();
  let offered = 0;
  g = run(g, x => {
    const d = x.pending!;
    if (d.kind === 'optional' && /Deflect/.test(d.prompt)) { assert.equal(d.player, P0, 'Bomb owner decides'); offered++; return ['no']; }
    return undefined;
  }, x => x.pending?.kind === 'mainAction' && x.activePlayer === P1);
  assert.equal(offered, 4, 'each Bomb death trigger offered the Deflect 3 payment');
  const logT = g.log.map(l => l.text);
  assert.ok(!logT.some(t => /^Trigger: Bomb: When this dies/.test(t)), 'a declined Bomb trigger never finalizes onto the chain (no reaction window)');
  assert.equal(logT.filter(t => /Deflect cost declined, removed/.test(t)).length, 4);
  for (const b of bombs) assert.notEqual(zone(g, b), 'battlefield', 'Deploy killed every Bomb');
  assert.equal(g.objects[kayle].damage, 0, 'Kayle took no damage');
  assert.equal(zone(g, kayle), 'battlefield');
  assert.equal(readyRunes(g, P0), 12, 'Bomb owner spent nothing');
});

test('VIDEO-2b same board, the Bomb owner pays Deflect 3 once: Kayle takes 2 and 3 runes are spent', () => {
  let { g, kayle } = bombSetup();
  let offered = 0;
  g = run(g, x => {
    const d = x.pending!;
    if (d.kind === 'optional' && /Deflect/.test(d.prompt)) { offered++; return [offered === 1 ? 'yes' : 'no']; }
    return undefined;
  }, x => x.pending?.kind === 'mainAction' && x.activePlayer === P1);
  assert.ok(offered >= 1);
  assert.equal(g.objects[kayle].damage, 2, 'one Bomb resolved: 2 damage');
  assert.equal(readyRunes(g, P0), 9, 'paid 3 power');
});

// ------------------------------------------------------------------------------------------------
// 3. Kha'Zix, Mutating Horror vs Fiora, Peerless — conditions checked when triggered
// ------------------------------------------------------------------------------------------------
test("VIDEO-3 Kha'Zix, Mutating Horror attacks a lone Fiora, Peerless; both sides add a unit in response: both triggers still resolve fully (CR 383.2.a.1)", () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const fi = put(g, P1, 'Fiora, Peerless', BF_A); control(g, BF_A, P1);
  const kz = put(g, P0, "Kha'Zix, Mutating Horror", 'base');
  const nid = hand(g, P0, 'Nidalee, Cat Form');
  const ren = hand(g, P1, 'Rengar, Trophy Hunter');
  const xp0 = g.players[P0].xp;
  g = move(g, P0, [kz], BF_A);
  // get both combat triggers onto the chain
  g = run(g, undefined, x => x.chain.length >= 2 && x.pending?.kind === 'chainResponse');
  assert.equal(g.chain.length, 2, 'attack + defend triggers on the chain');
  let nPlayed = false, rPlayed = false, bothInBeforeTriggers = false;
  for (let i = 0; i < 60 && g.chain.length > 0; i++) {
    const d = pend(g);
    // the conditions are false by the time the triggers resolve: both extra units are at BF_A while only the two triggers remain
    if (nPlayed && rPlayed && g.chain.length === 2 && g.chain.every(c => c.kind === 'trigger') && locOf(g, nid) === BF_A && locOf(g, ren) === BF_A) bothInBeforeTriggers = true;
    if (d.inStep) { g = act(g, { type: 'choose', player: d.player, optionIds: d.kind === 'optional' ? ['yes'] : [d.options![0].id] }); continue; }
    if (d.kind === 'chainResponse' && d.player === P0 && !nPlayed) { g = act(g, { type: 'playCard', player: P0, obj: nid, destination: BF_A }); nPlayed = true; continue; }
    if (d.kind === 'chainResponse' && d.player === P1 && nPlayed && !rPlayed) { g = act(g, { type: 'playCard', player: P1, obj: ren, destination: BF_A }); rPlayed = true; continue; }
    g = act(g, { type: 'pass', player: d.player });
  }
  assert.ok(nPlayed && rPlayed, 'both Ambush units played in response');
  assert.ok(bothInBeforeTriggers, 'Nidalee and Rengar were at BF_A (no one-on-one, no lone enemy) before either trigger resolved');
  assert.equal(locOf(g, nid), BF_A); assert.equal(locOf(g, ren), BF_A);
  assert.equal(mightOf(g, fi), 6, 'Fiora still doubled her Might (3 → 6)');
  assert.equal(mightOf(g, kz), 6, "Kha'Zix still got +2 (4 → 6)");
  assert.equal(g.players[P0].xp, xp0 + 2, "Kha'Zix's controller gained 2 XP");
});

// ------------------------------------------------------------------------------------------------
// 4. Elder Dragon defending alone vs 12 Might of attackers
// ------------------------------------------------------------------------------------------------
test('VIDEO-4 Elder Dragon defends alone vs four attackers totalling 12 Might: it may assign 1/1/1/7, all four die and the Dragon dies — full trade', () => {
  let { g, atk, def } = attackSetup(['Reckless Innovator', 'First Mate', 'Overloaded Traveler', 'Nidalee, Cat Form'], ['Elder Dragon']);
  const dragon = def[0];
  const pts = g.players[P0].points;
  g = run(g, undefined, x => x.pending?.kind === 'assignDamage');
  assert.equal(atk.reduce((s, u) => s + mightOf(g, u), 0), 12, 'attackers total 12 Might');
  for (let i = 0; i < 20 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    if (d.kind === 'assignDamage' && d.player === P1) {
      const split = { [atk[0]]: 1, [atk[1]]: 1, [atk[2]]: 1, [atk[3]]: 7 };
      assert.equal(validateAction(g, { type: 'assignDamage', player: P1, assignment: split }), null, 'Elder Dragon: 1 is lethal, so 1/1/1/7 is a legal assignment');
      g = act(g, { type: 'assignDamage', player: P1, assignment: split });
      continue;
    }
    g = run(g, undefined, x => x.pending?.kind === 'assignDamage' && x.pending.player === P1);
  }
  for (const u of atk) assert.equal(zone(g, u), 'trash', `${g.cards[g.objects[u].cardId].name} dies`);
  assert.equal(zone(g, dragon), 'trash', 'Elder Dragon dies to 12');
  assert.equal(g.players[P0].points, pts, 'no conquer');
  assert.notEqual(g.battlefields[BF_A].controller, P0);
});

// ------------------------------------------------------------------------------------------------
// 5. Akali, Silent + Star-Crossed + Flash
// ------------------------------------------------------------------------------------------------
test('VIDEO-5 Star-Crossed chooses my Ferrous Forerunner and an in-combat Akali, Silent; Flash moves Akali to base: only the Forerunner returns (CR 359.3.e)', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const fr = put(g, P0, 'Ferrous Forerunner', BF_A); control(g, BF_A, P0);
  const ak = put(g, P1, 'Akali, Silent', 'base');
  const sc = hand(g, P0, 'Star-Crossed');
  const fl = hand(g, P1, 'Flash');
  g = move(g, P1, [ak], BF_A);
  g = run(g, undefined, x => x.pending?.kind === 'showdownAction' && x.pending.player === P0 && x.chain.length === 0);
  assert.ok(g.showdown?.isCombat, 'combat');
  g = act(g, { type: 'playCard', player: P0, obj: sc });
  g = run(g, x => (has(x, fr) ? [fr] : has(x, ak) ? [ak] : undefined), x => !x.pending?.inStep);
  const item = g.chain.find(c => c.source === sc);
  assert.ok(item, 'Star-Crossed on the chain');
  assert.ok(item!.targets.flat().includes(ak) && item!.targets.flat().includes(fr), 'Akali (in combat) and Forerunner chosen');
  // P1 responds with Flash on Akali
  for (let i = 0; i < 5 && !(g.pending?.kind === 'chainResponse' && g.pending.player === P1); i++) g = act(g, { type: 'pass', player: pend(g).player });
  g = act(g, { type: 'playCard', player: P1, obj: fl });
  g = run(g, x => (has(x, ak) ? [ak] : undefined), x => !x.pending?.inStep);
  g = run(g, undefined, x => x.chain.length === 0);
  assert.equal(locOf(g, ak), 'base', 'Akali moved to base and stays there');
  assert.equal(zone(g, fr), 'hand', 'Forerunner returned to hand');
  assert.ok(g.players[P0].hand.includes(fr));
  assert.ok(!g.players[P1].hand.includes(ak), 'Akali not returned');
});

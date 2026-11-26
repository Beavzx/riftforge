// META-AUDIT: the Azir lists of the Bologna meta (data/meta-decks/01/08/10/14-azir.json), played the way a real
// player sequences them, with the real cards (no test stand-ins for the Azir cards themselves).
import { test } from 'node:test';
import {
  game, mana, run, expectDecision, play, activate, canActivate, canPlay, tokens, tokensAt, put, putToken, handCard, zoneOf,
  setController, assert, M, kw, move, endTurn, setLegend, setBattlefield, act, choose, noRunes, getLegalActions, respond,
} from '../B3/util.ts';
import type { GameState, ObjId } from '../../../src/engine/types.ts';
import { attachNow, setXp } from '../../../src/engine/testkit.ts';

const ID = {
  legend: 'sfd-197-221', azir: 'sfd-177-221', kennen: 'ven-135-166', vi: 'unl-176-219', orianna: 'rad-042-167',
  doran: 'sfd-033-221', eye: 'sfd-153-221', soul: 'unl-039-219', brutal: 'sfd-042-221', hammer: 'ven-027-166', bf: 'sfd-161-221',
  defy: 'ogn-045-298', prep: 'rad-032-167', deathgrip: 'sfd-163-221', discipline: 'ogn-058-298', blade: 'ogn-213-298',
  salvage: 'ogn-224-298', backOff: 'unl-042-219', guards: 'sfd-154-221', arise: 'sfd-198-221', charm: 'ogn-043-298',
  fluft: 'sfd-208-221', hall: 'sfd-210-221', camp: 'ogn-294-298', seat: 'sfd-217-221',
} as const;

const soldiers = (g: GameState, p: 0 | 1 = 0) => tokens(g, 0 + p as 0 | 1, 'Sand Soldier');
const ready = (g: GameState, p: 0 | 1) => g.players[p].runesInPlay.filter(r => !g.objects[r].exhausted).length;
const legendOf = (g: GameState, p: 0 | 1) => g.players[p].legend;
/** pass priority / take suggested damage until a main action or an in-step decision */
const settle = (g: GameState) => run(g);
/**
 * SF2-2: a reflexive "Then do this" item is met with the token play's batch, so its controller orders it with the Sand Soldiers'
 * Weaponmaster triggers (CR 383.3.d). Put the Weaponmaster triggers on the chain first (the reflexive item resolves first).
 */
function orderWeaponmasterFirst(g: GameState): GameState {
  for (let i = 0; i < 8 && g.pending?.kind === 'orderTriggers'; i++) {
    const o = g.pending.options ?? [];
    g = settle(choose(g, (o.find(x => /Weaponmaster/i.test(x.label)) ?? o[0]).id));
  }
  return g;
}

function azirGame(): GameState {
  const g = game();
  setLegend(g, 0, ID.legend);
  noRunes(g, 0);
  return g;
}

test('Emperor of the Sands: Equipment -> [1],[T] Sand Soldier -> Weaponmaster attaches it for [C] (turn-1 line)', () => {
  let g = azirGame();
  mana(g, 0, 1, 'Calm', 'Calm');                         // 3 runes: 1 generic + 2 Calm
  const runes0 = g.players[0].runesInPlay.length;
  const leg = legendOf(g, 0);
  assert.ok(!canActivate(g, 0, leg), 'no Equipment played yet');
  const ds = handCard(g, 0, ID.doran);
  g = settle(play(g, 0, ds));
  assert.equal(zoneOf(g, ds), 'base');
  assert.ok(canActivate(g, 0, leg));
  g = activate(g, 0, leg);
  g = settle(g);
  expectDecision(g, 'chooseTargets', 0);                 // Weaponmaster: the Equipment is chosen as the trigger goes on the chain
  g = settle(choose(g, ds));
  const [s] = soldiers(g);
  assert.ok(s, 'a Sand Soldier token');
  assert.equal(zoneOf(g, s), 'base');
  assert.ok(kw(g, s, 'Weaponmaster'));
  assert.equal(g.objects[ds].attachedTo, s, 'Doran\'s Shield attached');
  assert.equal(M(g, s), 3);
  assert.ok(kw(g, s, 'Tank'));
  assert.equal(g.objects[leg].exhausted, true);
  assert.equal(g.players[0].runesInPlay.length, runes0 - 1, '[C] recycled a Calm rune (the exhausted one)');
  assert.equal(ready(g, 0), 1);
});

test('Emperor of the Sands: an Equipment that left the board still counts as played this turn; non-Equipment gear does not', () => {
  let g = azirGame();
  mana(g, 0, 4, 'Order');
  const leg = legendOf(g, 0);
  const eye = handCard(g, 0, ID.eye);
  g = settle(play(g, 0, eye));
  // Salvage (kill up to one gear, draw 1) kills it
  g = settle(play(g, 0, handCard(g, 0, ID.salvage)));
  if (g.pending?.kind === 'chooseTargets') g = settle(choose(g, eye));
  assert.equal(zoneOf(g, eye), 'trash');
  assert.ok(canActivate(g, 0, leg), 'the Equipment was played this turn');
  // a fresh turn with only a non-Equipment gear played
  let h = azirGame();
  mana(h, 0, 3);
  h = settle(play(h, 0, handCard(h, 0, 'ogn-040-298')));
  assert.ok(!canActivate(h, 0, legendOf(h, 0)));
});

test('Sand Soldiers have Weaponmaster only while they are yours (anthem) and the legend has no effect on other tokens', () => {
  const g = azirGame();
  const mine = putToken(g, 0, 'tok-sand-soldier', 'base');
  const theirs = putToken(g, 1, 'tok-sand-soldier', 'base');
  const rec = putToken(g, 0, 'ven-t04', 'base');
  assert.ok(kw(g, mine, 'Weaponmaster'));
  assert.ok(!kw(g, theirs, 'Weaponmaster'));
  assert.ok(!kw(g, rec, 'Weaponmaster'));
  assert.equal(M(g, mine), 2);
});

test('Weaponmaster on a Sand Soldier can take an Equipment off another unit (paying its [C]); declining keeps it', () => {
  let g = azirGame();
  mana(g, 0, 1, 'Order', 'Order', 'Order');
  const leg = legendOf(g, 0);
  const azir = put(g, 0, ID.azir, 'base');
  const sword = put(g, 0, ID.bf, 'base');
  g = settle(act(g, getLegalActions(g, 0).find(a => a.type === 'activate' && a.obj === sword && a.abilityIndex === 900)!));
  if (g.pending?.kind === 'chooseTargets') g = settle(choose(g, azir));
  assert.equal(g.objects[sword].attachedTo, azir);
  assert.equal(M(g, azir), 7);
  // an Equipment must be played this turn for the legend
  g = settle(play(g, 0, handCard(g, 0, ID.soul)));
  g = settle(activate(g, 0, leg));
  const opts = expectDecision(g, 'chooseTargets', 0);
  assert.ok(opts.includes(sword), 'an attached Equipment can be chosen');
  g = settle(choose(g, sword));
  const [s] = soldiers(g);
  assert.equal(g.objects[sword].attachedTo, s);
  assert.equal(M(g, s), 5);
  assert.equal(M(g, azir), 4);
});

test('Guards!: a Sand Soldier (base or a battlefield you control), may pay [C] to ready it; Weaponmaster triggers', () => {
  let g = azirGame();
  mana(g, 0, 3, 'Order', 'Calm');                        // Guards! is Order: [C] = Order; Doran's Equip [C] = Calm
  setController(g, 0, 0);
  put(g, 0, 't-u1', 0);
  const ds = put(g, 0, ID.doran, 'base');
  g = settle(play(g, 0, handCard(g, 0, ID.guards)));
  expectDecision(g, 'chooseDestination', 0);
  g = settle(choose(g, '0'));
  // the Soldier's Weaponmaster trigger and the reflexive "Then do this" item are both pending, met together (SF2-2): the player
  // orders them; Weaponmaster first → it is finalized first and the reflexive ready resolves first (CR 383.3.d, 387-389)
  expectDecision(g, 'orderTriggers', 0);
  g = orderWeaponmasterFirst(g);
  expectDecision(g, 'chooseTargets', 0);                 // Weaponmaster
  g = settle(choose(g, ds));
  expectDecision(g, 'optional', 0);                      // Then do this: you may pay [C] to ready it
  g = settle(choose(g, 'yes'));
  const [s] = soldiers(g);
  assert.equal(g.objects[s].battlefieldIndex, 0);
  assert.equal(g.objects[s].exhausted, false);
  assert.equal(g.objects[ds].attachedTo, s);
});

test('Guards! hidden at a battlefield and played face down in the opponent\'s turn: the Soldier appears there', () => {
  let g = azirGame();
  mana(g, 0, 2, 'Calm');
  setController(g, 0, 0);
  put(g, 0, 't-u2', 0);
  const gd = handCard(g, 0, ID.guards);
  g = act(g, { type: 'hide', player: 0, obj: gd, battlefieldIndex: 0 });
  assert.equal(zoneOf(g, gd), 'facedown');
  g = endTurn(g);
  const atk = put(g, 1, 't-u3', 'base');
  g = act(g, { type: 'move', player: 1, units: [atk], to: 0 });
  for (let i = 0; i < 6 && g.pending && g.pending.player !== 0; i++) g = act(g, { type: 'pass', player: g.pending.player });
  assert.ok(canPlay(g, 0, gd), 'a hidden card can be played for [0] at Reaction speed');
  g = play(g, 0, gd);
  for (let i = 0; i < 10 && g.pending && soldiers(g).length === 0; i++) {
    const d = g.pending;
    if (d.inStep) g = act(g, getLegalActions(g, d.player)[0]); else g = act(g, { type: 'pass', player: d.player });
  }
  const [s] = soldiers(g);
  assert.ok(s);
  assert.equal(g.objects[s].battlefieldIndex, 0, 'played at the battlefield it was hidden at');
});

test('Arise!: one Sand Soldier per Equipment you control, ready two; each Soldier\'s Weaponmaster may re-equip', () => {
  let g = azirGame();
  mana(g, 0, 6, 'Order', 'Calm', 'Calm');
  const u = put(g, 0, 't-u2', 'base');
  const ds = put(g, 0, ID.doran, 'base');
  const ss = put(g, 0, ID.soul, 'base');
  const hh = put(g, 0, ID.hammer, 'base');
  put(g, 0, 'ogn-040-298', 'base');                             // not an Equipment
  put(g, 1, ID.bf, 'base');                                // not yours
  attachNow(g, ds, u);         // attached Equipment still counts
  g = settle(play(g, 0, handCard(g, 0, ID.arise)));
  // locations: base only (no battlefield controlled) -> auto
  const made = soldiers(g);
  assert.equal(made.length, 3);
  // three Weaponmaster triggers (CR 821: each Soldier was played) and the reflexive "Ready up to two of them" item
  let wm = 0, readied = false;
  for (let i = 0; i < 12 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    if (g.pending.kind === 'orderTriggers') g = orderWeaponmasterFirst(g);
    else if (g.pending.kind === 'chooseTargets' && /Weaponmaster/.test(g.pending.prompt)) {
      wm++;
      const opt = (g.pending.options ?? []).map(o => o.id);
      g = run(choose(g, wm === 1 ? ss : wm === 2 ? hh : opt[0] === ds ? ds : ds));
    } else if (g.pending.kind === 'chooseTargets' && /Ready up to two/.test(g.pending.prompt)) {
      readied = true;
      g = run(choose(g, made[0], made[1]));
    } else g = run(g);
  }
  assert.ok(readied, 'the reflexive ready item was put on the chain');
  assert.deepEqual(made.map(s => g.objects[s].exhausted), [false, false, true]);
  assert.equal(wm, 3);
  const attached = [ds, ss, hh].filter(x => made.includes(g.objects[x].attachedTo as ObjId));
  assert.ok(attached.length >= 2, `Weaponmaster moved Equipment onto the new Soldiers (${attached.length})`);
});

test('Azir, Sovereign: Accelerate; when he attacks, token units (base or elsewhere) may join; they fight as attackers', () => {
  let g = azirGame();
  mana(g, 0, 5, 'Order');                                        // Azir is Order: Accelerate [1][C] = [1] + Order
  const az = handCard(g, 0, ID.azir);
  g = play(g, 0, az, { destination: 'base' });
  if (g.pending?.kind === 'optional') g = choose(g, 'yes');     // Accelerate [1][C]
  g = settle(g);
  assert.equal(g.objects[az].exhausted, false, 'Accelerate: enters ready');
  const s1 = putToken(g, 0, 'tok-sand-soldier', 'base');
  const s2 = putToken(g, 0, 'tok-sand-soldier', 'base', { ready: false });
  const nt = put(g, 0, 't-u1', 'base');
  const e = put(g, 1, 't-u5', 1);
  setBattlefield(g, 1, ID.camp);                                 // Trifarian War Camp: units here +1
  g = act(g, { type: 'move', player: 0, units: [az], to: 1 });
  const opts = expectDecision(g, 'chooseTargets', 0);
  assert.ok(opts.includes(s1) && opts.includes(s2) && !opts.includes(nt), 'only token units, exhausted ones too');
  g = settle(choose(g, s1, s2));
  assert.equal(zoneOf(g, e), 'trash', 'Azir 5 + Soldiers 3 + 3 beat a 6');
  assert.equal(g.battlefields[1].controller, 0);
  assert.equal(g.players[0].points, 1);
});

test('Hall of Legends: conquering it may pay [1] to ready the legend, which can then make another Sand Soldier', () => {
  let g = azirGame();
  mana(g, 0, 4);
  const leg = legendOf(g, 0);
  setBattlefield(g, 1, ID.hall);
  g = settle(play(g, 0, handCard(g, 0, ID.eye)));
  g = settle(activate(g, 0, leg));
  if (g.pending?.kind === 'chooseTargets') g = settle(choose(g));   // Weaponmaster: attach nothing
  assert.equal(g.objects[leg].exhausted, true);
  const u = put(g, 0, 't-u2', 'base');
  g = act(g, { type: 'move', player: 0, units: [u], to: 1 });
  for (let i = 0; i < 6 && g.pending?.kind !== 'optional'; i++) g = act(g, getLegalActions(g, g.pending!.player).find(a => a.type === 'pass' || a.type === 'choose') ?? getLegalActions(g, g.pending!.player)[0]);
  expectDecision(g, 'optional', 0);
  g = settle(choose(g, 'yes'));
  assert.equal(g.objects[leg].exhausted, false);
  assert.ok(canActivate(g, 0, leg), 'second Soldier this turn');
});

test('Forge of the Fluft: the legend gets "[T]: attach an Equipment you control to a unit you control" (Brutalizer gets +2 that turn)', () => {
  let g = azirGame();
  setBattlefield(g, 1, ID.fluft);
  setController(g, 1, 0);
  put(g, 0, 't-u1', 1);
  const leg = legendOf(g, 0);
  const a = put(g, 0, 't-u2', 'base'), b = put(g, 0, 't-u2', 'base');
  const br = put(g, 0, ID.brutal, 'base');
  attachNow(g, br, a);
  const acts = getLegalActions(g, 0).filter(x => x.type === 'activate' && x.obj === leg);
  assert.equal(acts.length, 1, 'the granted ability (no Equipment played: the Sand Soldier ability is not offered)');
  g = act(g, acts[0]);
  expectDecision(g, 'chooseTargets', 0);
  if (/Equipment/.test(g.pending!.prompt)) g = choose(g, br);   // (the only Equipment is chosen automatically)
  g = choose(g, b);
  g = settle(g);
  assert.equal(g.objects[br].attachedTo, b);
  assert.equal(M(g, b), 2 + 1 + 2, 'Brutalizer: +1, and +2 more the turn it was attached');
  assert.equal(M(g, a), 2);
  g = endTurn(g);
  assert.equal(M(g, b), 3, 'only the turn it was attached');
});

test('Seat of Power: conquering it draws 1 for each other battlefield you control', () => {
  let g = azirGame();
  setBattlefield(g, 1, ID.seat);
  setController(g, 0, 0);
  put(g, 0, 't-u1', 0);
  const h = g.players[0].hand.length;
  const u = put(g, 0, 't-u2', 'base');
  g = settle(act(g, { type: 'move', player: 0, units: [u], to: 1 }));
  assert.equal(g.players[0].hand.length, h + 1);
});

test('Deathgrip: kill a Sand Soldier, Azir gets its Might this turn, draw 1; not playable without a second friendly unit', () => {
  let g = azirGame();
  mana(g, 0, 4);
  const az = put(g, 0, ID.azir, 'base');
  const s = putToken(g, 0, 'tok-sand-soldier', 'base');
  attachNow(g, put(g, 0, ID.bf, 'base'), s);
  assert.equal(M(g, s), 5);
  const h = g.players[0].hand.length;
  g = play(g, 0, handCard(g, 0, ID.deathgrip));
  g = choose(g, s);
  if (g.pending?.kind === 'chooseTargets') g = choose(g, az);
  g = settle(g);
  assert.equal(zoneOf(g, s), 'gone', 'a token ceases to exist');
  assert.equal(M(g, az), 9);
  assert.equal(g.players[0].hand.length, h + 1);
  const k = azirGame();
  mana(k, 0, 2);
  put(k, 0, ID.azir, 'base');
  assert.equal(canPlay(k, 0, handCard(k, 0, ID.deathgrip)), false);
});

test('Orianna deals combat damage only with a friendly gear here (an attached Equipment counts)', () => {
  for (const withGear of [false, true]) {
    let g = azirGame();
    const o = put(g, 0, ID.orianna, 'base');
    if (withGear) { const ds = put(g, 0, ID.doran, 'base'); attachNow(g, ds, o); }
    const e = put(g, 1, 't-u4', 1);
    g = settle(act(g, { type: 'move', player: 0, units: [o], to: 1 }));
    assert.equal(g.objects[e].zone === 'trash', withGear, `gear=${withGear}`);
  }
});

test('Hand Hammer / Soul Sword / Eye of the Herald on a Sand Soldier', () => {
  let g = azirGame();
  const s = putToken(g, 0, 'tok-sand-soldier', 'base');
  const hh = put(g, 0, ID.hammer, 'base');
  attachNow(g, hh, s);
  assert.equal(M(g, s), 3, 'at base: only +1');
  g = settle(act(g, { type: 'move', player: 0, units: [s], to: 1 }));
  assert.equal(M(g, s), 3, 'alone at the battlefield');
  put(g, 0, 't-u1', 1);
  assert.equal(M(g, s), 5, 'exactly one other unit you control here');
  put(g, 0, 't-u1', 1);
  assert.equal(M(g, s), 3);
  const x = putToken(g, 0, 'tok-sand-soldier', 'base');
  const sw = put(g, 0, ID.soul, 'base');
  attachNow(g, sw, x);
  assert.equal(M(g, x), 3);
  setXp(g, 0, 3); g.ex.dirty = true;
  assert.equal(M(g, x), 4, 'Level 3: +1 more');
  const y = putToken(g, 0, 'tok-sand-soldier', 'base');
  const eye = put(g, 0, ID.eye, 'base');
  attachNow(g, eye, y);
  g = settle(act(g, { type: 'move', player: 0, units: [y], to: 0 }));
  assert.equal(tokensAt(g, 0, 'Recruit', 0).length, 1, 'Eye of the Herald: a Recruit where it moved');
});

test('Battle Preparations: +2 Might; showing off a gear readies up to 2 runes', () => {
  let g = azirGame();
  mana(g, 0, 2);
  const mine = g.players[0].runesInPlay.filter(r => !g.objects[r].exhausted);
  const u = put(g, 0, 't-u2', 'base');
  const ds = put(g, 0, ID.doran, 'base');
  g = play(g, 0, handCard(g, 0, ID.prep));
  const seen: string[] = [];
  for (let i = 0; i < 8 && g.pending && g.pending.inStep; i++) {
    const d = g.pending;
    seen.push(d.kind + ':' + d.prompt);
    if (d.kind === 'optional') g = choose(g, 'yes');
    else if (d.kind === 'chooseCards' && /Show off/.test(d.prompt)) g = choose(g, ds);
    else if (d.kind === 'chooseTargets' && /Might/.test(d.prompt)) g = choose(g, u);
    else if (d.kind === 'chooseTargets' && /rune/i.test(d.prompt)) g = choose(g, ...mine);   // the runes that will pay for it
    else g = act(g, getLegalActions(g, d.player)[0]);
  }
  g = settle(g);
  assert.equal(M(g, u), 4, seen.join(' | '));
  assert.equal(ready(g, 0), 2, 'the two runes that paid for it were readied');
});

test('Back Off: stun; draws only when played from hand. Hidden Blade: kill at a battlefield, its controller draws 2', () => {
  let g = azirGame();
  mana(g, 0, 5);
  const e = put(g, 1, 't-u3', 1);
  const bo = handCard(g, 0, ID.backOff);
  const h0 = g.players[0].hand.length;
  g = settle(play(g, 0, bo));
  if (g.pending?.kind === 'chooseTargets') g = settle(choose(g, e));
  assert.equal(g.objects[e].stunned, true);
  assert.equal(g.players[0].hand.length, h0, 'played from hand: drew 1 (card left, card drawn)');
  mana(g, 0, 0, 'Order');
  const h1 = g.players[1].hand.length;
  g = settle(play(g, 0, handCard(g, 0, ID.blade)));
  if (g.pending?.kind === 'chooseTargets') g = settle(choose(g, e));
  assert.equal(zoneOf(g, e), 'trash');
  assert.equal(g.players[1].hand.length, h1 + 2);
});

test('Defy counters a spell costing at most [4] and [A]; not one costing [A][A]', () => {
  for (const [spell, countered] of [['ogn-058-298', true], ['sfd-145-221', false]] as const) {
    let g = azirGame();
    noRunes(g, 1);
    mana(g, 1, 4, 'Calm', 'Chaos', 'Chaos');
    mana(g, 0, 1, 'Calm');
    put(g, 1, 't-u2', 0); put(g, 1, 't-u3', 0);
    g = endTurn(g);
    noRunes(g, 1);
    mana(g, 1, 4, 'Calm', 'Chaos', 'Chaos');
    const sp = handCard(g, 1, spell);
    g = play(g, 1, sp);
    while (g.pending?.inStep) g = act(g, getLegalActions(g, g.pending.player)[0]);
    const defy = handCard(g, 0, ID.defy);
    for (let i = 0; i < 4 && g.pending && g.pending.player !== 0; i++) g = act(g, { type: 'pass', player: g.pending.player });
    assert.equal(canPlay(g, 0, defy), countered, spell);
  }
});

test('Kennen: may pay [2] to stun when played; +2 while a stunned enemy is here. Vi: Ambush, attacking stuns an enemy here', () => {
  let g = azirGame();
  mana(g, 0, 5, 'Calm');
  setController(g, 0, 0);
  put(g, 0, 't-u1', 0);
  const e = put(g, 1, 't-u3', 1);
  const k = handCard(g, 0, ID.kennen);
  g = play(g, 0, k, { destination: 0 });
  for (let i = 0; i < 6 && g.pending?.inStep; i++) {
    const d = g.pending;
    if (d.kind === 'optional') g = choose(g, 'yes'); else if (d.kind === 'chooseTargets') g = choose(g, e); else g = act(g, getLegalActions(g, d.player)[0]);
  }
  g = settle(g);
  assert.equal(g.objects[e].stunned, true);
  assert.equal(M(g, k), 2, 'the stunned enemy is elsewhere');
  g.objects[e].battlefieldIndex = 0; g.ex.dirty = true;
  assert.equal(M(g, k), 4);
});

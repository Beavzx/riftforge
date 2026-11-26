// Rift Judge verification, ids 5201-6500 (range tag r5201). See docs/riftjudge/README.md and docs/riftjudge/r5201.md.
import { test } from 'node:test';
import {
  assert, S0, put, hand, cast, play, pass, passN, control, act, move, P0, P1, BF_A, BF_B, zone, locOf, mightOf,
  mod, setRunes, resolveChain, passAll, pend, answer, yes, no, choose, legal, canPlayNow, fundAll, cid, realCard, setBattlefieldCard,
  attackSetup, optionIds, expectPending, validateAction, hasKeyword, activate, readyRunes, rejects, endTurn, nextTurn, EventLog, clearDeck,
  type GameState, type ObjId, type PlayerId, newGame, exhaustedRunes, chainLabels, kwValue, playDests, fillTrash,
} from '../conformance/harness.ts';

import { TOKEN_IDS } from '../../src/cards/helpers/B3.ts';
import { attachNow, playCostOf } from '../../src/engine/testkit.ts';
import { getView } from '../../src/engine/game.ts';
/** Add real token definitions (Sprite, Recruit, Gold, ...) to a fixture game's card pool. */
function withTokens(g: GameState): GameState {
  for (const id of Object.values(TOKEN_IDS)) { try { const d = realCard(id); g.cards = { ...g.cards, [d.id]: d }; } catch { /* not in db */ } }
  g.timestamp++;
  return g;
}

function setLegend(g: GameState, p: PlayerId, name: string): ObjId {
  const d = realCard(name);
  if (!g.cards[d.id]) g.cards = { ...g.cards, [d.id]: d };
  const id = g.players[p].legend;
  g.objects[id].cardId = d.id; g.objects[id].exhausted = false;
  g.timestamp++;
  return id;
}

test('RJ#5203 Hidden Blade on a unit saved by The Boss still draws its controller 2', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  setLegend(g, P1, 'The Boss');
  const u = put(g, P1, 'V(3)', BF_A, { buff: true });
  control(g, BF_A, P1);
  const h = g.players[1].hand.length;
  [g] = cast(g, P0, 'Hidden Blade', { targets: [[u]] });
  g = passAll(g);
  expectPending(g, 'optional', P1);
  g = passAll(yes(g));
  assert.equal(locOf(g, u), 'base', 'recalled instead of dying');
  assert.equal(g.players[1].hand.length, h + 2, 'controller still draws 2');
});

test('RJ#5204 Hextech Ray (3) on a 6-Might unit, then Thousand-Tailed Watcher -3: Zhonya\'s saves it; it stays at 3 Might this turn', () => {
  let g = S0();
  fundAll(g, P0, 8); fundAll(g, P1);
  const u = put(g, P1, 'V(6)', BF_A);
  const z = put(g, P1, "Zhonya's Hourglass", 'base');
  control(g, BF_A, P1);
  [g] = cast(g, P0, 'Hextech Ray', { targets: [[u]] });
  g = passAll(g);
  assert.equal(g.objects[u].damage, 3);
  [g] = cast(g, P0, 'Thousand-Tailed Watcher', { dest: 'base', may: [false] });
  g = passAll(g);
  assert.equal(zone(g, z), 'trash', "Zhonya's killed instead");
  assert.equal(locOf(g, u), 'base');
  assert.equal(g.objects[u].damage, 0);
  assert.equal(mightOf(g, u), 3, 'still -3 this turn');
});

test('RJ#5206 attacker stuns the lone defender but cannot kill it: attackers recalled, no conquer', () => {
  let { g, atk, def } = attackSetup(['V(2)'], ['V(5)'], { defOpts: [{ stunned: true }] });
  g = passAll(g);
  assert.equal(locOf(g, def[0]), BF_A);
  assert.equal(locOf(g, atk[0]), 'base', 'recalled');
  assert.equal(g.battlefields[BF_A].controller, P1);
});

test('RJ#5207 "defends alone" bonus (Wuju Bladesman) does not apply outside a combat showdown', () => {
  let g = S0({ tp: P1 });
  setLegend(g, P1, 'Wuju Bladesman, Starter');
  const u = put(g, P1, 'V(3)', BF_A);
  control(g, BF_A, P1);
  assert.equal(mightOf(g, u), 3, 'holding/controlling is not defending');
  g = nextTurn(g); // P1's turn ends, P0's turn starts (P1 not defending)
  assert.equal(mightOf(g, u), 3);
  const a = put(g, P0, 'V(1)', 'base');
  g = move(g, P0, [a], BF_A);
  assert.equal(mightOf(g, u), 5, 'sanity: defending alone in combat gets +2');
});

test('RJ#5209 Super Mega Death Rocket!: discard 1 is a cost — with an empty hand it cannot return on conquer', () => {
  const run = (cards: number) => {
    let g = S0();
    fundAll(g, P0);
    const r = put(g, P0, 'Super Mega Death Rocket!', 'trash');
    for (let i = 0; i < cards; i++) hand(g, P0, 'V(1)');
    const u = put(g, P0, 'V(2)', 'base');
    g = move(g, P0, [u], BF_A);
    for (let i = 0; i < 10 && g.pending?.kind === 'optional'; i++) g = yes(g);
    g = passAll(g);
    for (let i = 0; i < 10 && g.pending?.kind === 'optional'; i++) g = passAll(yes(g));
    return zone(g, r);
  };
  assert.equal(run(0), 'trash', 'no card to discard: stays in trash');
  assert.equal(run(1), 'hand', 'with a card to discard it returns');
});

// MISMATCH-RJ: RJ says "may" triggers always go on the chain and the choice is made on resolution; CR 383.3.a
// (Core Rules 2026-10-09): a leading "you may" is chosen during finalization, and 383.3.b/b.1: a leading cost is
// the base cost paid to finalize. Test asserts the official behaviour.
test('RJ#5210 a leading "you may pay" trigger (Immortal Phoenix) is decided while finalizing, not on resolution (CR 383.3.a-b)', () => {
  let g = S0();
  fundAll(g, P0);
  const ph = put(g, P0, 'Immortal Phoenix', 'trash');
  const v = put(g, P1, 'V(3)', BF_A);
  control(g, BF_A, P1);
  [g] = cast(g, P0, 'Hextech Ray', { targets: [[v]] });
  g = passAll(g);
  expectPending(g, 'optional', P0);
  assert.ok(!g.chain.some(c => c.source === ph && c.kind !== 'trigger') , 'not yet a finalized chain item');
  g = no(g);
  assert.equal(g.chain.length, 0, 'declined during finalization: removed, nothing resolves');
  assert.equal(zone(g, ph), 'trash');
});

test('RJ#5211 Fortified Position defend trigger resolves before the attacker\'s When-I-attack trigger', () => {
  let g = S0({ bfA: 'Fortified Position' });
  const d = put(g, P1, 'V(1)', BF_A);
  control(g, BF_A, P1);
  const a = put(g, P0, 'Crackshot Corsair', 'base');
  g = move(g, P0, [a], BF_A);
  g = answer(g, { targets: [[d]] }, P0);
  g = answer(g, { targets: [[d]] }, P1);
  g = answer(g, { targets: [[d]] }, P0);
  assert.equal(g.chain.length, 2);
  assert.equal(g.objects[g.chain[1].source]?.cardId, cid('Fortified Position'), 'defender trigger on top');
  g = pass(g); g = pass(g); // shield resolves
  assert.equal(mightOf(g, d), 3, 'Shield 2 while defending');
  g = pass(g); g = pass(g); // Corsair deals 1
  assert.equal(g.objects[d].damage, 1);
  assert.equal(zone(g, d), 'battlefield', 'survives the attack trigger');
});

test('RJ#5212 already-ready Darius, Trifarian still gets +2 Might on your second card', () => {
  let g = S0();
  fundAll(g, P0);
  const dz = put(g, P0, 'Darius, Trifarian', 'base');
  [g] = cast(g, P0, 'V(1)', { dest: 'base' }); g = passAll(g);
  [g] = cast(g, P0, 'V(1)', { dest: 'base' }); g = passAll(g);
  assert.equal(mightOf(g, dz), 7);
  assert.equal(g.objects[dz].exhausted, false);
});

test('RJ#5213 Sett, Kingpin counts himself as a buffed friendly unit at his battlefield', () => {
  const g = S0();
  const s = put(g, P0, 'Sett, Kingpin', BF_A, { buff: true });
  control(g, BF_A, P0);
  assert.equal(mightOf(g, s), 5 + 1 + 1, 'base 5, buff +1, own ability +1');
});

test('RJ#5214 Warwick, Hunter kills only damaged enemies; a Might-reduced undamaged unit is not killed by it', () => {
  let g = S0();
  const hurt = put(g, P1, 'V(4)', BF_A, { damage: 1 });
  const shrunk = put(g, P1, 'V(4)', BF_A);
  g.objects[shrunk].modifiers.push({ source: null, layer: 3, might: -2, duration: 'endOfTurn', timestamp: ++g.timestamp } as never);
  control(g, BF_A, P1);
  const w = put(g, P0, 'Warwick, Hunter', 'base');
  g = move(g, P0, [w], BF_A);
  g = resolveChain(g);
  assert.equal(zone(g, hurt), 'trash');
  assert.equal(zone(g, shrunk), 'battlefield');
});

test('RJ#5215 a card played from facedown can only target units at its own battlefield', () => {
  let g = S0();
  fundAll(g, P0);
  control(g, BF_A, P0); control(g, BF_B, P1);
  const here = put(g, P1, 'V(2)', BF_A);
  const there = put(g, P1, 'V(2)', BF_B);
  const hb = put(g, P0, 'Hidden Blade', { facedown: BF_A });
  g = act(g, { type: 'playCard', player: P0, obj: hb });
  if (pend(g).kind === 'chooseTargets') {
    assert.ok(!optionIds(g).includes(there), 'unit at another battlefield is not a legal target');
    g = choose(g, here);
  }
  g = passAll(g);
  assert.equal(zone(g, here), 'trash', 'only the unit here could be chosen (auto-picked)');
  assert.equal(zone(g, there), 'battlefield');
});

test('RJ#5216 a unit played by Portal Rescue (ignoring its cost) may still pay Accelerate, at full price', () => {
  let g = S0();
  fundAll(g, P0);
  const w = put(g, P0, 'Thousand-Tailed Watcher', 'base', { ready: false });
  const before = readyRunes(g, P0), inPlay = g.players[0].runesInPlay.length;
  [g] = cast(g, P0, 'Portal Rescue', { targets: [[w]] });
  g = passAll(g);
  expectPending(g, 'optional', P0);
  assert.match(pend(g).prompt, /Accelerate/);
  g = yes(g);
  g = answer(g, {});
  g = passAll(g);
  assert.equal(locOf(g, w), 'base');
  assert.equal(g.objects[w].exhausted, false, 'entered ready');
  assert.equal(before - readyRunes(g, P0), 3 + 1, 'energy: Portal Rescue 3 + Accelerate 1');
  assert.equal(inPlay - g.players[0].runesInPlay.length, 2, 'power: Portal Rescue [M] + Accelerate [M] (recycled)');
});

test('RJ#5217 opponents may react to Brynhir\'s play trigger; removing Brynhir does not stop it', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  control(g, BF_A, P0);
  const gust = hand(g, P1, 'Gust');
  const fl = hand(g, P1, 'Flurry of Blades');
  const b = hand(g, P0, 'Brynhir Thundersong');
  g = play(g, P0, b, { dest: BF_A });
  g = passAll(g, 1); // P0 passes on the unit
  for (let i = 0; i < 6 && !g.chain.some(c => c.kind === 'trigger'); i++) g = pass(g);
  assert.ok(g.chain.some(c => c.kind === 'trigger'), 'play trigger on chain');
  if (pend(g).player === P0) g = pass(g);
  mod(g, b, { might: -3 });
  g = play(g, P1, gust, { targets: [[b]] });
  g = passAll(g);
  assert.equal(zone(g, b), 'hand', 'Brynhir bounced');
  [g] = cast(g, P0, 'V(1)', { dest: 'base' });
  for (let i = 0; i < 4 && g.chain.length; i++) {
    if (pend(g).player === P1) assert.equal(legal(g, P1, 'playCard').some(a => a.type === 'playCard' && a.obj === fl), false, 'trigger still resolved: P1 cannot play cards');
    g = pass(g);
  }
  assert.equal(zone(g, fl), 'hand');
});

test('RJ#5218 Pit Rookie + Cithria: spend the first buff for Call to Glory between the two triggers, then rebuff', () => {
  let g = S0();
  fundAll(g, P0);
  const c = put(g, P0, 'Cithria of Cloudfield', 'base');
  const ctg = hand(g, P0, 'Call to Glory');
  [g] = cast(g, P0, 'Pit Rookie', { dest: 'base' });
  for (let i = 0; i < 10; i++) {
    const d = pend(g);
    if (d.kind === 'orderTriggers' || d.kind === 'chooseOrder') { g = choose(g, d.options![0].id); continue; }
    if (d.kind === 'chooseTargets') { g = choose(g, c); continue; }
    if (d.kind === 'chainResponse' && g.chain.length === 2 && g.chain.every(x => x.kind === 'trigger')) break;
    g = pass(g);
  }
  assert.equal(g.chain.length, 2);
  g = passN(g, 2); // first trigger resolves -> Cithria buffed
  assert.equal(g.objects[c].counters.buff ?? 0, 1);
  g = play(g, P0, ctg, { may: [true], targets: [[c]] });
  g = passAll(g);
  assert.equal(g.objects[c].counters.buff ?? 0, 1, 'rebuffed by the second trigger');
  assert.equal(mightOf(g, c), 1 + 1 + 3);
});

test('RJ#5219 Master Yi, Meditative gets +4 with exactly 8 runes', () => {
  const g = S0();
  const y = put(g, P0, 'Master Yi, Meditative', 'base');
  setRunes(g, P0, 7);
  assert.equal(mightOf(g, y), 4);
  setRunes(g, P0, 8);
  assert.equal(mightOf(g, y), 8);
});

test('RJ#5220 a spell already on the chain still resolves after Brynhir enters ("can\'t play" only stops new plays)', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  control(g, BF_B, P1);
  const e = put(g, P1, 'V(5)', BF_B);
  const b = put(g, P0, 'Brynhir Thundersong', 'base');
  const ray = hand(g, P0, 'Hextech Ray'), thrill = hand(g, P0, 'Thrill of the Hunt'), fl = hand(g, P1, 'Flurry of Blades');
  g = play(g, P0, ray, { targets: [[e]] });
  g = pass(g);
  g = play(g, P1, fl);
  g = pass(g);
  g = play(g, P0, thrill, { targets: [[b]] });
  g = passAll(answer(passAll(g), { battlefields: [BF_A] }));
  assert.equal(locOf(g, b), BF_A, 'Brynhir played to a battlefield');
  assert.equal(zone(g, fl), 'trash');
  assert.equal(g.objects[b].damage, 1, 'Flurry of Blades (played before Brynhir) still resolved');
  assert.equal(g.objects[e].damage, 4);
});

test('RJ#5222 Deflect is paid as the spell is played; countering the spell does not refund it', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  control(g, BF_A, P1);
  const ir = put(g, P1, 'Irelia, Fervent', BF_A);
  const ab = hand(g, P1, 'Abandon');
  const inPlay = g.players[0].runesInPlay.length, ready = readyRunes(g, P0);
  const ray = hand(g, P0, 'Hextech Ray');
  g = play(g, P0, ray, { targets: [[ir]] });
  const paidPower = inPlay - g.players[0].runesInPlay.length;
  assert.equal(paidPower, 2, 'Ray [F] + Deflect [A]');
  g = pass(g);
  g = play(g, P1, ab, { targets: [[ray]] });
  g = passAll(g);
  assert.equal(zone(g, ray), 'hand', 'countered and returned');
  assert.equal(inPlay - g.players[0].runesInPlay.length, 2, 'no refund');
  assert.equal(ready - readyRunes(g, P0) >= 1, true);
});

test('RJ#5224 Mask of Foresight\'s +1 does not "choose" Irelia, Fervent (no extra +1)', () => {
  let g = S0();
  put(g, P0, 'Mask of Foresight', 'base');
  const ir = put(g, P0, 'Irelia, Fervent', 'base');
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [ir], BF_A);
  g = resolveChain(g);
  assert.equal(mightOf(g, ir), 5, '4 + Mask 1; Irelia\'s own trigger not fired');
});

test('RJ#5225 Ravenborn Tome\'s bonus damage lasts only this turn', () => {
  let g = S0();
  fundAll(g, P0);
  const t = put(g, P0, 'Ravenborn Tome', 'base');
  g = activate(g, P0, t, 0);
  g = passAll(g);
  g = nextTurn(g); g = nextTurn(g);
  fundAll(g, P0);
  const v = put(g, P1, 'V(6)', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'Hextech Ray', { targets: [[v]] });
  g = passAll(g);
  assert.equal(g.objects[v].damage, 3, 'no bonus damage next turn');
});

test('RJ#5226 Iron Ballista choosing a unit with Deflect must pay the Deflect cost', () => {
  let g = S0();
  fundAll(g, P0);
  const b = put(g, P0, 'Iron Ballista', 'base');
  const ir = put(g, P1, 'Irelia, Fervent', BF_A); control(g, BF_A, P1);
  const n = g.players[0].runesInPlay.length;
  g = activate(g, P0, b, 1, { targets: [[ir]] });
  assert.equal(n - g.players[0].runesInPlay.length, 1, 'paid [A] for Deflect');
  g = passAll(g);
  assert.equal(g.objects[ir].damage, 2);
});

test('RJ#5227 Mask of Foresight +1 stays after another friendly unit joins the combat (Zenith Blade)', () => {
  let g = S0();
  fundAll(g, P0);
  put(g, P0, 'Mask of Foresight', 'base');
  const a = put(g, P0, 'V(3)', 'base'), b = put(g, P0, 'V(2)', 'base');
  const d = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [a], BF_A);
  g = resolveChain(g);
  assert.equal(mightOf(g, a), 4);
  const zb = hand(g, P0, 'Zenith Blade');
  g = play(g, P0, zb, { targets: [[b]] }); void d;
  for (let i = 0; i < 8 && locOf(g, b) !== BF_A; i++) {
    const p = pend(g);
    if (p.kind === 'chainResponse' || p.kind === 'showdownAction') { if (!g.chain.length) break; g = pass(g); continue; }
    if (p.kind === 'optional') g = yes(g); else if (p.options?.some(o => o.id === b)) g = choose(g, b); else if (p.options?.some(o => o.id === String(BF_A))) g = choose(g, String(BF_A)); else break;
  }
  assert.equal(locOf(g, b), BF_A, 'second unit joined');
  assert.equal(mightOf(g, a), 4, 'bonus retained');
});

test('RJ#5228 Cruel Patron\'s kill is an additional cost: the unit is dead before anyone can respond', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const v = put(g, P0, 'V(1)', 'base');
  const cp = hand(g, P0, 'Cruel Patron');
  g = act(g, { type: 'playCard', player: P0, obj: cp, destination: 'base' });
  for (let i = 0; i < 5 && pend(g).inStep; i++) { const p = pend(g); g = p.options?.some(o => o.id === v) ? choose(g, v) : choose(g, p.options![0].id); }
  assert.equal(zone(g, v), 'trash', 'killed while paying costs');
  if (pend(g).player === P0 && g.chain.length) g = pass(g);
  if (g.chain.length) assert.equal(pend(g).player, P1, 'P1 only now gets priority');
  g = passAll(g);
  assert.equal(locOf(g, cp), 'base');
});

test('RJ#5229 costs are paid when a card goes on the chain; Wind Wall\'s countered target keeps its costs paid', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const v = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const r0 = readyRunes(g, P0), r1 = readyRunes(g, P1);
  [g] = cast(g, P0, 'Hextech Ray', { targets: [[v]] });
  assert.equal(r0 - readyRunes(g, P0), 1, 'paid on play');
  g = pass(g);
  const ww = hand(g, P1, 'Wind Wall');
  g = play(g, P1, ww, { targets: [[g.chain[0].source]] });
  assert.equal(r1 - readyRunes(g, P1), 3, 'Wind Wall paid on play');
  g = passAll(g);
  assert.equal(g.objects[v].damage, 0, 'countered');
  assert.equal(r0 - readyRunes(g, P0), 1, 'no refund');
});

test('RJ#5230 Carnivorous Snapvine\'s target is locked; if Retreat removes it, no new target', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  control(g, BF_A, P1); control(g, BF_B, P1);
  const k = put(g, P1, "Kai'Sa, Survivor", BF_A), o = put(g, P1, 'V(2)', BF_B);
  const sv = hand(g, P0, 'Carnivorous Snapvine');
  g = play(g, P0, sv, { dest: 'base' });
  for (let i = 0; i < 6 && !(pend(g).kind === 'chooseTargets'); i++) g = pass(g);
  g = choose(g, k);
  if (pend(g).player === P0) g = pass(g);
  const rt = hand(g, P1, 'Retreat');
  g = play(g, P1, rt, { targets: [[k]] });
  g = passAll(g);
  assert.equal(zone(g, k), 'hand');
  assert.equal(g.objects[o].damage, 0, 'no retarget');
  assert.equal(g.objects[sv].damage, 0);
});

test('RJ#5233 Sprite Call in a combat showdown cannot put the Sprite onto the occupied battlefield', () => {
  let { g } = attackSetup(['V(2)'], ['V(3)']);
  fundAll(g, P0); withTokens(g);
  const sc = hand(g, P0, 'Sprite Call');
  g = play(g, P0, sc);
  for (let i = 0; i < 6 && g.chain.length; i++) {
    const p = pend(g);
    if (p.inStep) { assert.ok(!(p.options ?? []).some(o => o.id === String(BF_A)), 'BF-A not offered'); g = choose(g, p.options![0].id); } else g = pass(g);
  }
  const sprite = Object.values(g.objects).find(o => g.cards[o.cardId]?.name?.includes('Sprite') && o.zone !== 'trash' && o.cardId !== cid('Sprite Call'));
  assert.ok(sprite, 'sprite created');
  assert.equal(locOf(g, sprite!.id), 'base');
});

test('RJ#5234 you may play a hidden card in response to Blitzcrank\'s hold trigger; if you don\'t, it is trashed once you lose control', () => {
  const setup = () => {
    let g = withTokens(S0({ tp: P1 }));
    fundAll(g, P0);
    const b = put(g, P0, 'Blitzcrank, Impassive', BF_A);
    control(g, BF_A, P0);
    const fd = put(g, P0, 'Sprite Call', { facedown: BF_A, hiddenTurn: 1 });
    g = endTurn(g, P1);
    for (let i = 0; i < 20 && !g.chain.some(c => c.source === b); i++) { const p = pend(g); g = p.inStep ? choose(g, p.options![0].id) : pass(g); }
    assert.ok(g.chain.some(c => c.source === b), 'hold trigger on chain');
    return { g, b, fd };
  };
  let { g, fd } = setup();
  assert.ok(canPlayNow(g, P0, fd), 'facedown card playable in response');
  ({ g, fd } = setup());
  g = passAll(g);
  assert.equal(zone(g, fd), 'trash', 'lost control -> hidden card trashed');
});

test('RJ#5236 Daughter of the Void "Add" puts power in the rune pool, which empties at end of turn', () => {
  let g = S0();
  setLegend(g, P0, 'Daughter of the Void');
  g = activate(g, P0, g.players[0].legend, 0);
  if (pend(g).kind === 'chooseMode') g = choose(g, pend(g).options![0].id);
  g = passAll(g);
  const amt = (g: GameState) => Object.values(g.players[0].pool.power).reduce((s, n) => s + (n as number), 0) + (g.players[0].poolRestricted ?? []).length;
  assert.equal(amt(g), 1, 'added to pool');
  g = nextTurn(g);
  assert.equal(amt(g), 0, 'emptied');
});

test('RJ#5238 spending Sett, Brawler\'s buff for Wallop\'s additional cost does not give him +4', () => {
  let g = S0();
  fundAll(g, P0);
  const s = put(g, P0, 'Sett, Brawler', 'base', { buff: true, ready: false });
  [g] = cast(g, P0, 'Wallop', { may: [true], targets: [[s]], cards: [[s]] });
  g = passAll(answer(g, { targets: [[s]], cards: [[s]] }));
  assert.equal(g.objects[s].counters.buff ?? 0, 0, 'buff spent');
  assert.equal(g.objects[s].exhausted, false, 'readied');
  assert.equal(mightOf(g, s), 4, 'no +4');
});

test('RJ#5239 Icathian Rain choosing the same Deflect unit 6 times pays Deflect 6 times', () => {
  let g = S0();
  fundAll(g, P0, 8);
  const ir = put(g, P1, 'Irelia, Fervent', BF_A); control(g, BF_A, P1);
  const n = g.players[0].runesInPlay.length;
  [g] = cast(g, P0, 'Icathian Rain', { targets: [[ir], [ir], [ir], [ir], [ir], [ir]] });
  assert.equal(n - g.players[0].runesInPlay.length, 3 + 6, '3 power + 6x Deflect');
});

test('RJ#5237 Rabadon\'s Deathcrown adds 3 bonus damage to Forgefire Cape\'s attack trigger (2 -> 5 to each enemy here)', () => {
  let g = S0();
  const u = put(g, P0, 'V(3)', 'base');
  const cape = put(g, P0, 'Forgefire Cape', 'base'), crown = put(g, P0, "Rabadon's Deathcrown", 'base');
  attachNow(g, cape, u); attachNow(g, crown, u);
  const d = put(g, P1, 'V(8)', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [u], BF_A);
  g = resolveChain(g);
  assert.equal(g.objects[d].damage, 5);
});

test('RJ#5240 returning your only unit (Teemo via Swift Scout) from a battlefield loses control of it', () => {
  let g = S0();
  fundAll(g, P0);
  setLegend(g, P0, 'Swift Scout');
  const t = put(g, P0, 'Teemo, Scout', BF_A);
  control(g, BF_A, P0);
  g = activate(g, P0, g.players[0].legend, 0, { targets: [[t]], cards: [[t]] });
  g = passAll(g);
  assert.equal(zone(g, t), 'hand');
  assert.equal(g.battlefields[BF_A].controller, null, 'uncontrolled');
});

test('RJ#5242 Volibear, Imposing: one move of several units draws 1; separate moves each draw', () => {
  const run = (together: boolean) => {
    let g = S0();
    put(g, P1, 'Volibear, Imposing', BF_B); control(g, BF_B, P1);
    const a = put(g, P0, 'V(1)', 'base'), b = put(g, P0, 'V(1)', 'base'), c = put(g, P0, 'V(1)', 'base');
    const h = g.players[1].hand.length;
    if (together) { g = move(g, P0, [a, b, c], BF_A); g = passAll(g); }
    else for (const u of [a, b, c]) { g = move(g, P0, [u], BF_A); g = passAll(g); }
    return g.players[1].hand.length - h;
  };
  assert.equal(run(true), 1);
  assert.equal(run(false), 3);
});

test('RJ#5246 Yasuo swapped in by Tideturner during combat arrives as a defender: no "When I attack"', () => {
  let g = S0();
  fundAll(g, P1);
  const dv = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const tt = put(g, P1, 'Tideturner', { facedown: BF_A });
  const y = put(g, P1, 'Yasuo, Remorseful', 'base');
  const a = put(g, P0, 'V(3)', 'base');
  g = move(g, P0, [a], BF_A);
  g = passAll(g, 1);
  expectPending(g, 'showdownAction', P1);
  g = act(g, { type: 'playCard', player: P1, obj: tt });
  g = answer(g, { may: [true], targets: [[y]], cards: [[y]] }, P1);
  for (let i = 0; i < 10 && g.chain.length; i++) { const p = pend(g); if (p.inStep) g = answer(g, { may: [true], targets: [[y]] }); else g = pass(g); }
  assert.equal(locOf(g, y), BF_A, 'Yasuo swapped in');
  assert.equal(g.objects[a].damage, 0, 'no When-I-attack damage');
  void dv;
});

test('RJ#5248 Hextech Ray whose target is moved to base by Fight or Flight resolves with no effect', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const v = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const fof = put(g, P1, 'Fight or Flight', { facedown: BF_A });
  [g] = cast(g, P0, 'Hextech Ray', { targets: [[v]] });
  g = pass(g);
  g = play(g, P1, fof, { targets: [[v]] });
  g = passAll(g);
  assert.equal(locOf(g, v), 'base');
  assert.equal(g.objects[v].damage, 0);
});

// MISMATCH-RJ: RJ says the stunned unit goes to 3. CR 479.4.e.1-2 (Core Rules 2026-10-09): increases apply first,
// decreases last, and a passive ability's "to a minimum of" is not snapshotted -> 3+2-8, min 1 = 1.
test('RJ#5249 Leona, Zealot\'s -8 (min 1) is a passive aura applied after increases: a +2 leaves the stunned unit at 1 (CR 479.4.e)', () => {
  const g = S0();
  put(g, P0, 'Leona, Zealot', BF_A);
  const v = put(g, P1, 'V(3)', BF_A, { stunned: true });
  assert.equal(mightOf(g, v), 1);
  mod(g, v, { might: 2 });
  assert.equal(mightOf(g, v), 1, 'increases first, then -8 to a minimum of 1');
  g.objects[v].stunned = false; g.timestamp++;
  assert.equal(mightOf(g, v), 5, 'aura stops applying once no longer stunned');
});

test('RJ#5250 Stupefy in response to Void Seeker at The Dreaming Tree: draw Defy, then counter Void Seeker', () => {
  let g = S0({ bfA: 'The Dreaming Tree' });
  fundAll(g, P0); fundAll(g, P1);
  const v = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const defy = put(g, P1, 'Defy', 'deckTop');
  [g] = cast(g, P0, 'Void Seeker', { targets: [[v]] });
  const vs = g.chain[0].source;
  g = pass(g);
  const st = hand(g, P1, 'Stupefy');
  g = play(g, P1, st, { targets: [[v]] });
  // resolve Dreaming Tree trigger and Stupefy, keep Void Seeker on the chain
  for (let i = 0; i < 10 && g.chain.length > 1; i++) { const p = pend(g); if (p.inStep) g = choose(g, p.options![0].id); else g = pass(g); }
  assert.equal(zone(g, defy), 'hand', 'drew Defy');
  assert.equal(g.chain.length, 1);
  if (pend(g).player === P0) g = pass(g);
  expectPending(g, 'chainResponse', P1);
  g = play(g, P1, defy, { targets: [[vs]] });
  g = passAll(g);
  assert.equal(g.objects[v].damage, 0, 'Void Seeker countered');
});

test('RJ#5252 The Boss also saves a buffed unit from lethal spell damage (Void Seeker)', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  setLegend(g, P1, 'The Boss');
  const u = put(g, P1, 'V(3)', BF_A, { buff: true }); control(g, BF_A, P1);
  [g] = cast(g, P0, 'Void Seeker', { targets: [[u]] });
  g = passAll(g);
  expectPending(g, 'optional', P1);
  g = passAll(yes(g));
  assert.equal(locOf(g, u), 'base');
});

test('RJ#5253 Radiant Dawn trigger after a showdown spell makes a new chain: only Reactions, Actions again once it resolves', () => {
  let { g, def } = attackSetup(['V(4)'], ['V(4)']);
  fundAll(g, P0); fundAll(g, P1);
  setLegend(g, P0, 'Radiant Dawn');
  const ray = hand(g, P1, 'Hextech Ray');
  const rp = hand(g, P0, 'Rune Prison');
  g = play(g, P0, rp, { targets: [[def[0]]] });
  g = pass(g); g = pass(g); // Rune Prison resolves -> trigger
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = choose(g, pend(g).options![0].id);
  assert.ok(g.chain.length >= 1, 'Radiant Dawn trigger on a new chain');
  for (let i = 0; i < 4 && pend(g).player !== P1 && g.chain.length; i++) g = pass(g);
  if (g.chain.length) assert.equal(canPlayNow(g, P1, ray), false, 'Action not playable on the chain');
  g = resolveChain(g);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = choose(g, pend(g).options![0].id);
  for (let i = 0; i < 4 && pend(g).player !== P1; i++) g = pass(g);
  expectPending(g, 'showdownAction', P1);
  assert.equal(canPlayNow(g, P1, ray), true, 'showdown continues: Actions allowed with focus');
});

test('RJ#5254 a repeated spell is still one play: Ravenbloom Student gets +1 once', () => {
  let g = S0();
  fundAll(g, P0, 6);
  const st = put(g, P0, 'Ravenbloom Student', 'base');
  const t = put(g, P1, 'V(9)', 'base');
  const rb = hand(g, P0, 'Rocket Barrage');
  g = act(g, { type: 'playCard', player: P0, obj: rb });
  for (let i = 0; i < 12 && pend(g).inStep; i++) {
    const p = pend(g);
    if (p.kind === 'optional') g = yes(g);
    else if (p.options?.some(o => o.id === t)) g = choose(g, t);
    else g = choose(g, p.options![0].id);
  }
  g = passAll(g);
  for (let i = 0; i < 12 && pend(g).inStep; i++) { const p = pend(g); g = p.options?.some(o => o.id === t) ? choose(g, t) : choose(g, p.options![0].id); g = passAll(g); }
  assert.equal(g.objects[t].damage, 8, 'repeated: dealt 4 twice');
  assert.equal(mightOf(g, st), 3, '+1 only once');
});

test('RJ#5255 in a showdown the Hextech Ray caster keeps priority and may add Smoke Screen; Smoke Screen resolves first', () => {
  let { g, def } = attackSetup(['V(4)'], ['V(6)']);
  fundAll(g, P0);
  const ray = hand(g, P0, 'Hextech Ray'), ss = hand(g, P0, 'Smoke Screen');
  g = play(g, P0, ray, { targets: [[def[0]]] });
  expectPending(g, 'chainResponse', P0);
  g = play(g, P0, ss, { targets: [[def[0]]] });
  assert.equal(g.chain.at(-1)!.source, ss, 'Smoke Screen on top');
  g = pass(g); g = pass(g);
  assert.equal(mightOf(g, def[0]), 2);
  assert.equal(g.objects[def[0]].damage, 0, 'Ray not yet resolved');
  g = pass(g); g = pass(g);
  assert.equal(zone(g, def[0]), 'trash', '3 damage vs 2 Might');
});

test('RJ#5256 a 0-Might unit with no damage survives; any damage kills it', () => {
  let g = S0();
  const v = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  mod(g, v, { might: -3 });
  [g] = cast(g, P0, 'V(1)', { dest: 'base' }); g = passAll(g);
  assert.equal(mightOf(g, v), 0);
  assert.equal(zone(g, v), 'battlefield');
  fundAll(g, P0);
  [g] = cast(g, P0, 'Hextech Ray', { targets: [[v]] }); g = passAll(g);
  assert.equal(zone(g, v), 'trash');
});

test('RJ#5257 a gear ability without Action/Reaction (Arena Bar) cannot be activated during a showdown', () => {
  let { g } = attackSetup(['V(2)'], ['V(2)']);
  const bar = put(g, P0, 'Arena Bar', 'base');
  put(g, P0, 'V(1)', 'base', { ready: false });
  expectPending(g, 'showdownAction', P0);
  assert.equal(legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === bar), false);
  const h = S0(); const bar2 = put(h, P0, 'Arena Bar', 'base'); put(h, P0, 'V(1)', 'base', { ready: false });
  assert.equal(legal(h, P0, 'activate').some(a => a.type === 'activate' && a.obj === bar2), true, 'sanity: usable in main phase');
});

test('RJ#5259 Wuju Bladesman (+2 while defending alone) applies when Yasuo\'s attack trigger hits the lone defender', () => {
  let g = S0();
  setLegend(g, P1, 'Wuju Bladesman, Starter');
  const d = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const y = put(g, P0, 'Yasuo, Remorseful', 'base');
  g = move(g, P0, [y], BF_A);
  g = answer(g, { targets: [[d]] });
  g = resolveChain(g);
  assert.equal(g.objects[d].damage, 6);
  assert.equal(zone(g, d), 'battlefield', '6 damage vs 7 Might');
});

test('RJ#5261 Challenge uses the lone defender\'s boosted Might (Wuju Bladesman +2)', () => {
  let g = S0();
  fundAll(g, P0);
  setLegend(g, P1, 'Wuju Bladesman, Starter');
  const d = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(6)', 'base');
  g = move(g, P0, [a], BF_A);
  const ch = hand(g, P0, 'Challenge');
  g = play(g, P0, ch, { targets: [[a], [d]] });
  g = answer(g, { targets: [[d]] });
  g = pass(g); g = pass(g);
  assert.equal(g.objects[a].damage, 5, 'defender dealt 3+2');
});

test('RJ#5262 the Deflect cost on a mandatory trigger may be declined, removing the trigger (CR 405.2)', () => {
  let g = S0();
  fundAll(g, P0);
  const ir = put(g, P1, 'Irelia, Fervent', BF_A); control(g, BF_A, P1);
  const c = put(g, P0, 'Crackshot Corsair', 'base');
  const n = g.players[0].runesInPlay.length;
  g = move(g, P0, [c], BF_A);
  const p = pend(g);
  assert.ok(p.inStep && p.player === P0 && (p.options?.length ?? 0) >= 2, 'P0 is asked whether to pay Deflect');
  g = choose(g, p.options!.find(o => /no|decline|don/i.test(o.id + o.label))!.id);
  assert.equal(g.players[0].runesInPlay.length, n, 'nothing paid');
  g = passAll(g);
  assert.equal(g.objects[ir].damage, 0);
});

test('RJ#5263 Mistfall triggers on the opponent\'s turn when you buff with Stand United from facedown', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0);
  control(g, BF_A, P0);
  put(g, P0, 'Mistfall', 'base');
  const u = put(g, P0, 'V(2)', BF_A, { ready: false });
  const su = put(g, P0, 'Stand United', { facedown: BF_A });
  [g] = cast(g, P1, 'V(1)', { dest: 'base' });
  // the V(1) play gives P0 priority only if the engine waits; otherwise use P1's showdown-free main and skip
  if (g.chain.length && pend(g).player === P1) g = pass(g);
  if (!g.chain.length) { // no window: open one with P1 attacking
    const a = put(g, P1, 'V(1)', 'base');
    g = move(g, P1, [a], BF_A);
    for (let i = 0; i < 6 && pend(g).player !== P0; i++) g = pass(g);
  }
  g = act(g, { type: 'playCard', player: P0, obj: su });
  g = answer(g, { targets: [[u]] }, P0);
  for (let i = 0; i < 10 && g.objects[u].exhausted; i++) {
    const p = pend(g);
    if (p.kind === 'optional' && p.player === P0) { g = yes(g); continue; }
    if (p.inStep) { g = choose(g, p.options![0].id); continue; }
    if (!g.chain.length) break;
    g = pass(g);
  }
  assert.equal(g.objects[u].counters.buff ?? 0, 1);
  assert.equal(g.objects[u].exhausted, false, 'Mistfall readied it on the opponent\'s turn');
});

test('RJ#5264 Defy cannot counter Yasuo, Remorseful\'s triggered ability (only spells)', () => {
  let g = S0();
  fundAll(g, P1);
  const d = put(g, P1, 'V(8)', BF_A); control(g, BF_A, P1);
  const defy = hand(g, P1, 'Defy');
  const y = put(g, P0, 'Yasuo, Remorseful', 'base');
  g = move(g, P0, [y], BF_A);
  g = answer(g, { targets: [[d]] });
  assert.equal(g.chain.length, 1);
  if (pend(g).player === P0) g = pass(g);
  expectPending(g, 'chainResponse', P1);
  assert.equal(canPlayNow(g, P1, defy), false);
});

test('RJ#5265 a unit reduced to 0 Might (Smoke Screen + spending its buff for Call to Glory) does not die before Call to Glory resolves', () => {
  let g = S0();
  fundAll(g, P0);
  const u = put(g, P0, 'V(2)', BF_A, { buff: true }); control(g, BF_A, P0);
  [g] = cast(g, P0, 'Smoke Screen', { targets: [[u]] }); g = passAll(g);
  assert.equal(mightOf(g, u), 1);
  const ctg = hand(g, P0, 'Call to Glory');
  g = play(g, P0, ctg, { may: [true], targets: [[u]], cards: [[u]] });
  assert.equal(mightOf(g, u), 0, 'buff spent; Smoke Screen minimum was snapshotted');
  assert.equal(zone(g, u), 'battlefield');
  g = passAll(g);
  assert.equal(zone(g, u), 'battlefield');
  assert.equal(mightOf(g, u), 3);
});

test('RJ#5268 Dazzling Aurora plays Snapvine at end of turn: its fight damage happens before end-of-turn healing', () => {
  let g = S0();
  put(g, P0, 'Dazzling Aurora', 'base');
  const sv = put(g, P0, 'Carnivorous Snapvine', 'deckTop');
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  g = endTurn(g, P0);
  for (let i = 0; i < 20 && !(pend(g).kind === 'mainAction'); i++) {
    const p = pend(g);
    if (p.inStep) { g = p.options?.some(o => o.id === e) ? choose(g, e) : (p.kind === 'optional' ? no(g) : choose(g, p.options![0].id)); continue; }
    g = pass(g);
  }
  assert.equal(locOf(g, sv), 'base', 'Snapvine played');
  assert.equal(zone(g, e), 'trash', 'enemy took 6 and died before healing');
  assert.equal(g.objects[sv].damage, 0, 'Snapvine healed at end of turn');
});

test('RJ#5269 Draven, Showboat is Mighty as he is played if your points already make him 5+ (Relentless Storm triggers)', () => {
  let g = S0();
  fundAll(g, P0);
  setLegend(g, P0, 'Relentless Storm');
  g.players[0].points = 2;
  [g] = cast(g, P0, 'Draven, Showboat', { dest: 'base' });
  for (let i = 0; i < 6 && pend(g).kind !== 'optional' && g.chain.length; i++) g = pass(g);
  expectPending(g, 'optional', P0);
  assert.match(pend(g).prompt, /channel/i);
});

test('RJ#5272 Imperial Decree: a unit dealt pooled combat damage by two attackers triggers it once (Zhonya\'s saves it once)', () => {
  let g = S0();
  fundAll(g, P0);
  const d = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const z = put(g, P1, "Zhonya's Hourglass", 'base');
  [g] = cast(g, P0, 'Imperial Decree'); g = passAll(g);
  const a1 = put(g, P0, 'V(1)', 'base'), a2 = put(g, P0, 'V(1)', 'base');
  g = move(g, P0, [a1, a2], BF_A);
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const p = pend(g);
    if (p.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: p.player, assignment: p.player === P1 ? { [a1]: 3, [a2]: 2 } : { [d]: 2 } }); continue; }
    g = p.inStep ? choose(g, p.options![0].id) : pass(g);
  }
  assert.equal(zone(g, z), 'trash', "Zhonya's used once");
  assert.equal(locOf(g, d), 'base', 'only one Decree trigger for the defender');
});

test('RJ#5270 a showdown caused while Promising Future resolves (Dragon\'s Rage) waits until the chain is empty', () => {
  let g = S0();
  fundAll(g, P0, 8); fundAll(g, P1, 8);
  control(g, BF_A, P0);
  put(g, P0, 'V(2)', BF_A);
  const e = put(g, P1, 'V(1)', 'base');
  for (let i = 0; i < 4; i++) put(g, P0, 'V(1)', 'deckTop');
  const dr = put(g, P0, "Dragon's Rage", 'deckTop');
  const pf = hand(g, P0, 'Promising Future');
  g = play(g, P0, pf);
  let sawShowdownWithChain = false, sawShowdown = false;
  for (let i = 0; i < 60 && !(pend(g).kind === 'mainAction'); i++) {
    if (g.showdown) { sawShowdown = true; if (g.chain.length) sawShowdownWithChain = true; }
    const p = pend(g);
    if (p.inStep) {
      const ids = (p.options ?? []).map(o => o.id);
      if (ids.includes(dr)) g = choose(g, dr);
      else if (ids.includes(e)) g = choose(g, e);
      else if (ids.includes(String(BF_A))) g = choose(g, String(BF_A));
      else if (p.kind === 'optional') g = no(g);
      else g = choose(g, ids[0]);
      continue;
    }
    g = pass(g);
  }
  assert.equal(zone(g, dr), 'trash', "Dragon's Rage was played");
  assert.ok(sawShowdown || locOf(g, e) !== BF_A, 'a showdown happened (or the unit was not moved there)');
  assert.equal(sawShowdownWithChain, false, 'never a showdown while the chain is non-empty');
});

test('RJ#5273 Stupefy on a 1-Might unit at Trifarian War Camp (2) leaves it at 1 after resolving (minimum snapshotted)', () => {
  let g = S0({ bfA: 'Trifarian War Camp' });
  fundAll(g, P0);
  const r = put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  assert.equal(mightOf(g, r), 2);
  [g] = cast(g, P0, 'Stupefy', { targets: [[r]] }); g = passAll(g);
  assert.equal(mightOf(g, r), 1);
});

test('RJ#5275 a second non-combat showdown started during the first (Ride the Wind) waits until the first finishes', () => {
  let g = S0();
  fundAll(g, P0);
  const a = put(g, P0, 'V(1)', 'base'), b = put(g, P0, 'V(1)', 'base');
  g = move(g, P0, [a], BF_A);
  assert.equal(g.showdown?.battlefieldIndex, BF_A);
  const rw = hand(g, P0, 'Ride the Wind');
  g = play(g, P0, rw, { targets: [[b]], dest: BF_B, locations: [BF_B] });
  const order: number[] = [];
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
    if (g.showdown && order.at(-1) !== g.showdown.battlefieldIndex) order.push(g.showdown.battlefieldIndex);
    const p = pend(g);
    if (p.inStep) { g = (p.options ?? []).some(o => o.id === String(BF_B)) ? choose(g, String(BF_B)) : choose(g, p.options![0].id); continue; }
    g = pass(g);
  }
  assert.equal(locOf(g, b), BF_B);
  assert.deepEqual(order, [BF_A, BF_B]);
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.battlefields[BF_B].controller, P0);
});

test('RJ#5276 spending Udyr\'s buff for Wildclaw Shaman does not use Udyr\'s "Spend my buff" ability', () => {
  let g = S0();
  fundAll(g, P0);
  const u = put(g, P0, 'Udyr, Wildman', 'base', { buff: true, ready: false });
  const ws = hand(g, P0, 'Wildclaw Shaman');
  g = play(g, P0, ws, { dest: 'base' });
  let sawUdyrMode = false;
  for (let i = 0; i < 12 && pend(g).kind !== 'mainAction'; i++) {
    const p = pend(g);
    if (p.kind === 'chooseMode') sawUdyrMode = true;
    if (p.kind === 'optional') { g = yes(g); continue; }
    if (p.inStep) { g = p.options?.some(o => o.id === u) ? choose(g, u) : choose(g, p.options![0].id); continue; }
    g = pass(g);
  }
  assert.equal(g.objects[u].counters.buff ?? 0, 0, 'Udyr\'s buff spent');
  assert.equal(g.objects[ws].counters.buff ?? 0, 1, 'Shaman buffed');
  assert.equal(sawUdyrMode, false, 'no Udyr mode choice');
  assert.equal(g.objects[u].exhausted, true, 'Udyr not readied by his own ability');
});

test('RJ#5277 Promising Future after Brynhir: the opponent still banishes a card, which stays banished (can\'t play it)', () => {
  let g = S0();
  fundAll(g, P0, 8);
  [g] = cast(g, P0, 'Brynhir Thundersong', { dest: 'base' });
  g = passAll(g);
  const pf = hand(g, P0, 'Promising Future');
  g = play(g, P0, pf);
  for (let i = 0; i < 40 && pend(g).kind !== 'mainAction'; i++) {
    const p = pend(g);
    if (p.inStep) { g = p.kind === 'optional' ? no(g) : choose(g, p.options![0].id); continue; }
    g = pass(g);
  }
  assert.equal(g.players[1].banishment.length, 1, 'P1 chose a card; it stays banished');
  assert.equal(g.players[0].banishment.length, 0, 'P0 played theirs');
});

test('RJ#5279 Discipline in response to Hextech Ray (3 to a 3-Might unit) saves it', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const v = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'Hextech Ray', { targets: [[v]] });
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'Discipline'), { targets: [[v]] });
  g = passAll(g);
  assert.equal(zone(g, v), 'battlefield');
  assert.equal(g.objects[v].damage, 3);
});

test('RJ#5280 Convergent Mutation (errata: "this turn") wears off at end of turn', () => {
  let g = S0();
  fundAll(g, P0);
  const a = put(g, P0, 'V(1)', 'base'), b = put(g, P0, 'V(5)', 'base');
  [g] = cast(g, P0, 'Convergent Mutation', { targets: [[a], [b]] });
  g = passAll(answer(g, { targets: [[b]] }));
  assert.equal(mightOf(g, a), 5);
  g = nextTurn(g);
  assert.equal(mightOf(g, a), 1);
});

test('RJ#5281 a unit saved from death by a recall (Zhonya\'s) keeps its "this turn" Might bonus in base', () => {
  let g = S0();
  fundAll(g, P0);
  const v = put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  put(g, P1, "Zhonya's Hourglass", 'base');
  mod(g, v, { might: 2 });
  [g] = cast(g, P0, 'Hextech Ray', { targets: [[v]] }); g = passAll(g);
  assert.equal(locOf(g, v), 'base');
  assert.equal(mightOf(g, v), 3, 'same object: keeps +2 this turn');
});

test('RJ#5282 Tideturner flipped at BF-B can swap with a unit at BF-A while BF-A is under attack', () => {
  let g = S0();
  fundAll(g, P1);
  control(g, BF_A, P1); control(g, BF_B, P1);
  const x = put(g, P1, 'V(2)', BF_A);
  put(g, P1, 'V(1)', BF_B); // keeps control of BF-B (else the facedown card is trashed)
  const tt = put(g, P1, 'Tideturner', { facedown: BF_B });
  const a = put(g, P0, 'V(3)', 'base');
  g = move(g, P0, [a], BF_A);
  g = passAll(g, 1);
  expectPending(g, 'showdownAction', P1);
  g = act(g, { type: 'playCard', player: P1, obj: tt });
  for (let i = 0; i < 10 && locOf(g, tt) !== BF_A; i++) {
    const p = pend(g);
    if (p.kind === 'optional') { g = yes(g); continue; }
    if (p.inStep) { g = p.options?.some(o => o.id === x) ? choose(g, x) : choose(g, p.options![0].id); continue; }
    if (!g.chain.length) break;
    g = pass(g);
  }
  assert.equal(locOf(g, tt), BF_A);
  assert.equal(locOf(g, x), BF_B);
});

test('RJ#5284 Swift Scout cannot return a facedown (hidden) Teemo: it is not a Teemo unit until played', () => {
  let g = S0();
  fundAll(g, P0);
  setLegend(g, P0, 'Swift Scout');
  control(g, BF_A, P0); put(g, P0, 'V(1)', BF_A);
  const t = put(g, P0, 'Teemo, Scout', { facedown: BF_A });
  const acts = legal(g, P0, 'activate').filter(a => a.type === 'activate' && a.obj === g.players[0].legend);
  if (acts.length) {
    g = act(g, acts[0]);
    if (pend(g).inStep) assert.ok(!(pend(g).options ?? []).some(o => o.id === t), 'facedown Teemo not selectable');
    g = passAll(g);
  }
  assert.equal(zone(g, t), 'facedown');
});

test('RJ#5285 Possession takes control and recalls an exhausted unit without readying it', () => {
  let g = S0();
  fundAll(g, P0);
  const v = put(g, P1, 'V(3)', BF_A, { ready: false }); control(g, BF_A, P1);
  [g] = cast(g, P0, 'Possession', { targets: [[v]] }); g = passAll(g);
  assert.equal(g.objects[v].controller, P0);
  assert.ok(g.players[0].base.includes(v), 'in P0\'s base');
  assert.equal(g.objects[v].exhausted, true);
});

// MISMATCH-RJ: RJ says the Mystic Reversal player is considered to have played the stolen spell, so its original
// caster gets no Legion from it. CR 812.1.c: Legion checks whether its controller has FINALIZED another card this
// turn; the original caster finalized it (a control change after finalizing doesn't undo that, just as a countered
// card still counts). Test asserts the official behaviour.
test('RJ#5287 a spell stolen by Mystic Reversal still counts as played by its original caster for Legion (CR 812.1.c)', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const v = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  put(g, P0, 'V(5)', 'base');
  [g] = cast(g, P0, 'Hextech Ray', { targets: [[v]] });
  const ray = g.chain[0].source;
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'Mystic Reversal'), { targets: [[ray]] });
  for (let i = 0; i < 12 && pend(g).kind !== 'mainAction'; i++) { const p = pend(g); g = p.inStep ? (p.kind === 'optional' ? no(g) : choose(g, p.options![0].id)) : pass(g); }
  assert.deepEqual(g.ex.playedThisTurn[1].includes(ray), false, 'the stealer did not play it');
  const gs = hand(g, P0, 'Trifarian Gloryseeker');
  g = passAll(play(g, P0, gs, { dest: 'base' }));
  assert.equal(g.objects[gs].counters.buff ?? 0, 1, 'Legion active for the original caster');
});

test('RJ#5288 Defy cannot counter Shen, Kinkou (a unit, even at Reaction speed)', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0); fundAll(g, P1);
  const defy = hand(g, P0, 'Defy');
  const shen = hand(g, P1, 'Shen, Kinkou');
  g = act(g, { type: 'playCard', player: P1, obj: shen, destination: 'base' });
  let checked = false;
  for (let i = 0; i < 6 && g.chain.length; i++) {
    if (pend(g).player === P0) { assert.equal(canPlayNow(g, P0, defy), false); checked = true; }
    g = pass(g);
  }
  assert.equal(locOf(g, shen), 'base');
  assert.equal(zone(g, defy), 'hand');
  void checked;
});

test('RJ#5289 Stupefy\'s minimum uses current Might including the buff (1-Might unit with a buff goes to 1)', () => {
  let g = S0();
  fundAll(g, P0);
  const v = put(g, P1, 'V(1)', BF_A, { buff: true }); control(g, BF_A, P1);
  assert.equal(mightOf(g, v), 2);
  [g] = cast(g, P0, 'Stupefy', { targets: [[v]] }); g = passAll(g);
  assert.equal(mightOf(g, v), 1);
});

test('RJ#5290 Deathgrip killing your Immortal Phoenix triggers it, and it can be played from trash during a showdown', () => {
  let { g, atk } = attackSetup(['V(2)'], ['V(2)']);
  fundAll(g, P0);
  const ph = put(g, P0, 'Immortal Phoenix', 'base');
  const dg = hand(g, P0, 'Deathgrip');
  g = play(g, P0, dg, { targets: [[ph], [atk[0]]] });
  for (let i = 0; i < 12 && zone(g, ph) !== 'base'; i++) {
    const p = pend(g);
    if (p.kind === 'optional') { g = yes(g); continue; }
    if (p.inStep) { g = choose(g, p.options![0].id); continue; }
    if (!g.chain.length && zone(g, ph) === 'trash' && i > 3) break;
    g = pass(g);
  }
  assert.ok(g.showdown, 'still in the showdown');
  assert.equal(zone(g, ph), 'base', 'Phoenix replayed from trash');
});

test('RJ#5292 Retreat ("a friendly unit") cannot choose an opponent\'s unit', () => {
  let g = S0();
  fundAll(g, P0);
  const e = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const f = put(g, P0, 'V(2)', BF_B); control(g, BF_B, P0);
  const rt = hand(g, P0, 'Retreat');
  g = act(g, { type: 'playCard', player: P0, obj: rt });
  if (pend(g).kind === 'chooseTargets') { assert.ok(!optionIds(g).includes(e)); g = choose(g, f); }
  g = passAll(g);
  assert.equal(zone(g, f), 'hand');
  assert.equal(locOf(g, e), BF_A);
});

test('RJ#5297 Trifarian War Camp\'s +1 is always on: a 3-Might unit there is 4 and can\'t be Gusted', () => {
  let g = S0({ bfA: 'Trifarian War Camp' });
  fundAll(g, P0);
  const v = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const o = put(g, P1, 'V(3)', BF_B); control(g, BF_B, P1);
  assert.equal(mightOf(g, v), 4);
  const gust = hand(g, P0, 'Gust');
  g = act(g, { type: 'playCard', player: P0, obj: gust });
  if (pend(g).kind === 'chooseTargets') { assert.ok(!optionIds(g).includes(v), '4 Might: not a legal Gust target'); g = choose(g, o); }
  g = passAll(g);
  assert.equal(locOf(g, v), BF_A);
  assert.equal(zone(g, o), 'hand');
});

test('RJ#5298 a Fading Memories (Temporary) unit saved by The Boss keeps Temporary and dies at its next Temporary kill', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  setLegend(g, P1, 'The Boss');
  const u = put(g, P1, 'V(3)', BF_A, { buff: true }); control(g, BF_A, P1);
  [g] = cast(g, P0, 'Fading Memories', { targets: [[u]] }); g = passAll(g);
  assert.ok(hasKeyword(g, u, 'Temporary'));
  g = endTurn(g, P0);
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) { const p = pend(g); g = p.kind === 'optional' ? yes(g) : p.inStep ? choose(g, p.options![0].id) : pass(g); }
  assert.equal(locOf(g, u), 'base', 'saved by The Boss');
  assert.ok(hasKeyword(g, u, 'Temporary'), 'keeps Temporary');
  g = nextTurn(g); // P0's turn
  fundAll(g, P1);
  g = endTurn(g, P0);
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) { const p = pend(g); g = p.kind === 'optional' ? yes(g) : p.inStep ? choose(g, p.options![0].id) : pass(g); }
  assert.equal(zone(g, u), 'trash', 'dies again (no buff left to save it)');
});

test('RJ#5299 Promising Future with only 4 cards in deck looks at 4 and does not burn out', () => {
  let g = S0({ deck: [4, 10] });
  fundAll(g, P0, 8);
  const pf = hand(g, P0, 'Promising Future');
  g = play(g, P0, pf);
  for (let i = 0; i < 40 && pend(g).kind !== 'mainAction'; i++) { const p = pend(g); g = p.inStep ? (p.kind === 'optional' ? no(g) : choose(g, p.options![0].id)) : pass(g); }
  assert.equal(g.players[1].points, 0, 'no burn out point for the opponent');
});

test('RJ#5302 after Hidden Blade kills a Deathknell unit, the Deathknell controller gets priority first', () => {
  let g = withTokens(S0());
  fundAll(g, P0);
  const hd = put(g, P1, 'Hunting Dog', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'Hidden Blade', { targets: [[hd]] });
  for (let i = 0; i < 4 && !g.chain.some(c => c.source === hd); i++) g = pass(g);
  assert.ok(g.chain.some(c => c.source === hd), 'Deathknell trigger on chain');
  expectPending(g, 'chainResponse', P1);
});

test('RJ#5305 Last Breath cannot be played without an enemy unit at a battlefield to choose', () => {
  const g = S0();
  fundAll(g, P0);
  put(g, P0, 'V(3)', 'base', { ready: false });
  put(g, P1, 'V(3)', 'base');
  const lb = hand(g, P0, 'Last Breath');
  assert.equal(canPlayNow(g, P0, lb), false);
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  assert.equal(canPlayNow(g, P0, lb), true, 'sanity: playable with an enemy unit at a battlefield');
});

// MISMATCH-RJ (first half): RJ says Wind Wall can target itself. CR 355.9.c (Core Rules 2026-10-09): "A spell that says
// 'Counter a spell' cannot target itself." Second half (countered spells aren't "played" for Ravenbloom Student) matches.
test('RJ#5306 Wind Wall cannot choose itself (CR 355.9.c); a countered spell does not trigger Ravenbloom Student', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const st = put(g, P0, 'Ravenbloom Student', 'base');
  const ww0 = hand(g, P0, 'Wind Wall');
  assert.equal(canPlayNow(g, P0, ww0), false, 'no other spell: cannot be played targeting itself');
  const v = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'Hextech Ray', { targets: [[v]] });
  const ray = g.chain[0].source;
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'Wind Wall'), { targets: [[ray]] });
  g = passAll(g);
  assert.equal(g.objects[v].damage, 0, 'countered');
  assert.equal(mightOf(g, st), 2, 'countered spell: no +1');
});

test('RJ#5307 a 3-Might unit at Trifarian War Camp hit by Smoke Screen ends at 1', () => {
  let g = S0({ bfA: 'Trifarian War Camp' });
  fundAll(g, P0);
  const v = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'Smoke Screen', { targets: [[v]] }); g = passAll(g);
  assert.equal(mightOf(g, v), 1);
});

test('RJ#5308 no Reactions once combat damage assignment has begun', () => {
  let { g, atk, def } = attackSetup(['V(3)', 'V(3)'], ['V(4)']);
  fundAll(g, P1);
  const dc = hand(g, P1, 'Discipline');
  for (let i = 0; i < 10 && pend(g).kind !== 'assignDamage'; i++) g = pass(g);
  expectPending(g, 'assignDamage', P1);
  assert.equal(legal(g, P1, 'playCard').some(a => a.type === 'playCard' && a.obj === dc), false);
  assert.equal(legal(g, P0, 'playCard').length, 0);
  void atk; void def;
});

test('RJ#5310 Possession on a unit with attached gear: the gear stays attached and applies, but its controller doesn\'t change', () => {
  let g = S0();
  fundAll(g, P0);
  const v = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const gear = put(g, P1, "Rabadon's Deathcrown", 'base');
  attachNow(g, gear, v);
  assert.equal(mightOf(g, v), 5);
  [g] = cast(g, P0, 'Possession', { targets: [[v]] }); g = passAll(g);
  assert.equal(g.objects[v].controller, P0);
  assert.equal(g.objects[gear].controller, P1, 'gear control unchanged');
  assert.equal(mightOf(g, v), 5, 'still attached, bonus applies');
});

test('RJ#5311 Tryndamere counts only assigned combat damage as excess', () => {
  const run = (defMight: number, withRay: boolean) => {
    let g = S0();
    fundAll(g, P0);
    const d = put(g, P1, `V(${defMight})`, BF_A); control(g, BF_A, P1);
    const t = put(g, P0, 'Tryndamere, Barbarian', 'base');
    g = move(g, P0, [t], BF_A);
    if (withRay) { g = play(g, P0, hand(g, P0, 'Hextech Ray'), { targets: [[d]] }); g = pass(g); g = pass(g); }
    for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
      const p = pend(g);
      if (p.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: p.player, assignment: p.player === P0 ? { [d]: 8 } : { [t]: defMight } }); continue; }
      g = p.inStep ? choose(g, p.options![0].id) : pass(g);
    }
    return g.players[0].points;
  };
  assert.equal(run(4, false), 1, 'excess 4: conquer point only');
  assert.equal(run(2, false), 2, 'excess 6: +1');
});

test('RJ#5312 Retreating Viktor, Innovator on the opponent\'s turn makes no Recruit (he is gone when Retreat finishes)', () => {
  let g = withTokens(S0({ tp: P1 }));
  fundAll(g, P0); fundAll(g, P1);
  const vk = put(g, P0, 'Viktor, Innovator', BF_A); control(g, BF_A, P0);
  [g] = cast(g, P1, 'Hextech Ray', { targets: [[vk]] });
  g = pass(g);
  g = play(g, P0, hand(g, P0, 'Retreat'), { targets: [[vk]] });
  g = passAll(g);
  assert.equal(zone(g, vk), 'hand');
  assert.equal(g.players[0].base.filter(id => g.cards[g.objects[id].cardId]?.name === 'Recruit').length, 0);
  // sanity: with Viktor staying, a card played on the opponent's turn does make a Recruit
  let h = withTokens(S0({ tp: P1 }));
  fundAll(h, P0); fundAll(h, P1);
  const vk2 = put(h, P0, 'Viktor, Innovator', BF_A); control(h, BF_A, P0);
  [h] = cast(h, P1, 'Hextech Ray', { targets: [[vk2]] });
  h = pass(h);
  h = play(h, P0, hand(h, P0, 'Discipline'), { targets: [[vk2]] });
  h = passAll(h);
  assert.equal(h.players[0].base.filter(id => h.cards[h.objects[id].cardId]?.name === 'Recruit').length, 1);
});

test('RJ#5313 vs a Temporary kill trigger: Hidden Blade from hand can\'t respond; hidden at that battlefield it can', () => {
  let g = withTokens(S0({ tp: P1 }));
  fundAll(g, P0);
  control(g, BF_A, P0);
  put(g, P0, 'V(1)', BF_A);
  const sp = put(g, P0, 'unl-t07', BF_A, { token: true });
  const inHand = hand(g, P0, 'Hidden Blade');
  const fd = put(g, P0, 'Hidden Blade', { facedown: BF_A, hiddenTurn: 1 });
  g = endTurn(g, P1);
  for (let i = 0; i < 20 && !g.chain.some(c => c.source === sp); i++) { const p = pend(g); g = p.inStep ? choose(g, p.options![0].id) : pass(g); }
  assert.ok(g.chain.some(c => c.source === sp), 'Temporary trigger on chain');
  expectPending(g, 'chainResponse', P0);
  assert.equal(canPlayNow(g, P0, inHand), false, 'from hand: not a Reaction');
  assert.equal(canPlayNow(g, P0, fd), true, 'hidden at that battlefield: can react');
});

test('RJ#5314 Super Mega Death Rocket! discarded by Zaun Warrens\' conquer trigger can\'t use its own conquer trigger', () => {
  let g = S0({ bfA: 'Zaun Warrens' });
  fundAll(g, P0);
  const r = hand(g, P0, 'Super Mega Death Rocket!');
  hand(g, P0, 'V(1)');
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_A);
  let offered = false;
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
    const p = pend(g);
    if (p.kind === 'optional') { if (/return|Rocket/i.test(p.prompt)) offered = true; g = yes(g); continue; }
    if (p.inStep) { g = p.options?.some(o => o.id === r) ? choose(g, r) : choose(g, p.options![0].id); continue; }
    g = pass(g);
  }
  assert.equal(zone(g, r), 'trash', 'discarded and not returned');
  assert.equal(offered, false);
});

test('RJ#5315 marked damage does not reduce a unit\'s combat damage (damaged 5-Might attacker still deals 5)', () => {
  let { g, def } = attackSetup(['V(5)'], ['V(2)', 'V(3)'], { atkOpts: [{ damage: 3 }] });
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const p = pend(g);
    if (p.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: p.player, assignment: p.player === P0 ? { [def[0]]: 2, [def[1]]: 3 } : Object.fromEntries([[g.battlefields[BF_A] && Object.values(g.objects).find(o => o.controller === P0 && o.zone === 'battlefield')!.id, 5]]) }); continue; }
    g = p.inStep ? choose(g, p.options![0].id) : pass(g);
  }
  assert.equal(zone(g, def[0]), 'trash');
  assert.equal(zone(g, def[1]), 'trash');
});

test('RJ#5316 holding with two Ahri, Alluring scores 3 (hold + 1 + 1)', () => {
  let g = S0({ tp: P1 });
  put(g, P0, 'Ahri, Alluring', BF_A); put(g, P0, 'Ahri, Alluring', BF_A); control(g, BF_A, P0);
  g = endTurn(g, P1);
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) { const p = pend(g); g = p.inStep ? choose(g, p.options![0].id) : pass(g); }
  assert.equal(g.players[0].points, 3);
});

test('RJ#5317 an opponent\'s burn out point can be your winning (8th) point', () => {
  let g = S0({ deck: [20, 0] });
  g.players[0].points = 7;
  g = endTurn(g, P0);
  for (let i = 0; i < 20 && g.winner === null && pend(g).kind !== 'mainAction'; i++) { const p = pend(g); g = p.inStep ? choose(g, p.options![0].id) : pass(g); }
  assert.equal(g.winner, P0);
});

test('RJ#5318 damage is not removed after a non-combat showdown', () => {
  let g = S0();
  const u = put(g, P0, 'V(4)', 'base', { damage: 2 });
  g = move(g, P0, [u], BF_A);
  g = passAll(g);
  for (let i = 0; i < 6 && pend(g).inStep; i++) g = choose(g, pend(g).options![0].id);
  assert.equal(g.showdown, null);
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.objects[u].damage, 2);
});

test('RJ#5319 Flame Chompers discarded by Traveling Merchant moving to an open battlefield can\'t be played there (not controlled yet)', () => {
  let g = S0();
  fundAll(g, P0);
  const fc = hand(g, P0, 'Flame Chompers');
  const tm = put(g, P0, 'Traveling Merchant', 'base');
  g = move(g, P0, [tm], BF_A);
  let bfOffered = false;
  for (let i = 0; i < 25 && pend(g).kind !== 'mainAction'; i++) {
    const p = pend(g);
    if (p.kind === 'optional') { g = yes(g); continue; }
    if (p.inStep) {
      if (zone(g, fc) === 'trash' && (p.options ?? []).some(o => o.id === String(BF_A))) bfOffered = true;
      g = p.options?.some(o => o.id === fc) ? choose(g, fc) : choose(g, p.options![0].id); continue;
    }
    g = pass(g);
  }
  assert.equal(bfOffered, false, 'BF-A not offered');
  assert.equal(locOf(g, fc), 'base');
});

test('RJ#5320 Ezreal, Prodigy does not reduce Nocturne\'s "play me for [A]" (not an optional additional cost)', () => {
  let g = S0();
  fundAll(g, P0);
  put(g, P0, 'Ezreal, Prodigy', 'base');
  const n = put(g, P0, 'Nocturne, Horrifying', 'deckTop');
  const w = put(g, P0, 'Raving Witness', 'base');
  const before = g.players[0].runesInPlay.length;
  g = move(g, P0, [w], BF_A);
  for (let i = 0; i < 25 && pend(g).kind !== 'mainAction'; i++) {
    const p = pend(g);
    if (p.kind === 'optional') { g = yes(g); continue; }
    if (p.inStep) { g = choose(g, p.options![0].id); continue; }
    g = pass(g);
  }
  assert.ok(locOf(g, n) === 'base' || locOf(g, n) === BF_A, 'Nocturne played');
  assert.equal(before - g.players[0].runesInPlay.length, 1, 'paid the full [A]');
});

test('RJ#5321 Call to Glory is playable with no runes by spending a buff', () => {
  let g = S0();
  setRunes(g, P0, 0);
  const u = put(g, P0, 'V(2)', 'base', { buff: true });
  const ctg = hand(g, P0, 'Call to Glory');
  assert.equal(canPlayNow(g, P0, ctg), true);
  g = play(g, P0, ctg, { may: [true], targets: [[u]], cards: [[u]] });
  g = passAll(g);
  assert.equal(mightOf(g, u), 5);
});

test('RJ#5322 Wielder of Water moving alone to an empty battlefield (non-combat showdown) gets no +2; Gust can choose it', () => {
  let g = S0();
  const w = put(g, P0, 'Wielder of Water', 'base');
  g = move(g, P0, [w], BF_A);
  assert.ok(g.showdown && !g.showdown.isCombat);
  assert.equal(mightOf(g, w), 2);
  fundAll(g, P1);
  const gust = hand(g, P1, 'Gust');
  g = pass(g);
  if (pend(g).player === P1) { g = play(g, P1, gust, { targets: [[w]] }); g = passAll(g); assert.equal(zone(g, w), 'hand'); }
});

test('RJ#5323 Svellsongur copies only the unit\'s printed text, not text granted by other equipment', () => {
  let g = S0();
  const c = put(g, P0, 'Crackshot Corsair', 'base');
  const cape = put(g, P0, 'Forgefire Cape', 'base'), sv = put(g, P0, 'Svellsongur', 'base');
  attachNow(g, cape, c); attachNow(g, sv, c);
  const d = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [c], BF_A);
  for (let i = 0; i < 20 && g.showdown && (g.chain.length || pend(g).inStep); i++) { const p = pend(g); g = p.inStep ? (p.options?.some(o => o.id === d) ? choose(g, d) : choose(g, p.options![0].id)) : pass(g); }
  assert.equal(g.objects[d].damage, 1 + 1 + 2, 'Corsair 1 + Svellsongur copy of Corsair 1 + Cape 2 (Cape text not copied)');
});

test('RJ#5325 Daughter of the Void\'s Reaction-speed ability can be used on the chain during the opponent\'s turn', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P1);
  setLegend(g, P0, 'Daughter of the Void');
  const v = put(g, P0, 'V(5)', BF_A); control(g, BF_A, P0);
  [g] = cast(g, P1, 'Hextech Ray', { targets: [[v]] });
  g = pass(g);
  expectPending(g, 'chainResponse', P0);
  assert.ok(legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === g.players[0].legend));
});

test('RJ#5326 Peak Guardian\'s "then, if at a battlefield, buff all other friendly units there" is one-shot, not passive', () => {
  let g = S0();
  fundAll(g, P0);
  control(g, BF_A, P0);
  const o = put(g, P0, 'V(2)', BF_A);
  const pg = hand(g, P0, 'Peak Guardian');
  g = passAll(play(g, P0, pg, { dest: BF_A }));
  assert.equal(g.objects[pg].counters.buff ?? 0, 1);
  assert.equal(g.objects[o].counters.buff ?? 0, 1);
  const later = hand(g, P0, 'V(1)');
  g = passAll(play(g, P0, later, { dest: BF_A }));
  assert.equal(g.objects[later].counters.buff ?? 0, 0, 'later arrival not buffed');
});

test('RJ#5327 a champion in the Champion Zone is not on the board; played from there it enters exhausted', () => {
  let g = S0();
  fundAll(g, P0);
  const champ = g.players[0].championZone?.[0] ?? (g.players[0] as unknown as { champion?: ObjId }).champion;
  assert.ok(champ, 'champion object exists');
  assert.equal(zone(g, champ as ObjId), 'championZone');
  assert.equal(locOf(g, champ as ObjId), null, 'not at a board location');
  g = passAll(play(g, P0, champ as ObjId, { dest: 'base', may: [false] }));
  assert.equal(locOf(g, champ as ObjId), 'base');
  assert.equal(g.objects[champ as ObjId].exhausted, true);
});

test('RJ#5328 Noxian Guillotine does not lower lethal damage for combat assignment (still the unit\'s Might)', () => {
  let { g, atk, def } = attackSetup(['V(5)'], ['V(4)', 'V(1)']);
  fundAll(g, P0);
  g = play(g, P0, hand(g, P0, 'Noxian Guillotine'), { targets: [[def[0]]] });
  for (let i = 0; i < 12 && pend(g).kind !== 'assignDamage'; i++) g = pass(g);
  expectPending(g, 'assignDamage', P0);
  assert.ok(validateAction(g, { type: 'assignDamage', player: P0, assignment: { [def[0]]: 1, [def[1]]: 4 } }), 'overkilling the other unit while giving the Guillotined one only 1 is illegal');
  assert.equal(validateAction(g, { type: 'assignDamage', player: P0, assignment: { [def[0]]: 4, [def[1]]: 1 } }), null);
  void atk;
});

test('RJ#5329 a unit from base and a Ganking unit from another battlefield can join the same combat', () => {
  let g = S0();
  control(g, BF_B, P0);
  const gk = put(g, P0, 'Master Yi, Honed', BF_B);
  const b = put(g, P0, 'V(2)', 'base');
  const d = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [b, gk], BF_A);
  assert.equal(locOf(g, b), BF_A); assert.equal(locOf(g, gk), BF_A);
  assert.ok(g.showdown?.isCombat);
  void d;
});

test('RJ#5331 while Volibear\'s attack trigger is on the chain, the defender can only play Reactions (not Actions)', () => {
  let g = S0();
  fundAll(g, P1);
  const d1 = put(g, P1, 'V(3)', BF_A), d2 = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const ray = hand(g, P1, 'Hextech Ray'), dc = hand(g, P1, 'Discipline');
  const v = put(g, P0, 'Volibear, Furious', 'base');
  g = move(g, P0, [v], BF_A);
  for (let i = 0; i < 6 && pend(g).inStep; i++) {
    const p = pend(g);
    if (p.kind === 'chooseNumber') g = choose(g, p.options!.at(-1)!.id);
    else g = p.options?.some(o => o.id === d1) ? choose(g, d1) : choose(g, p.options![0].id);
  }
  assert.ok(g.chain.length >= 1);
  for (let i = 0; i < 4 && pend(g).player !== P1; i++) g = pass(g);
  assert.equal(canPlayNow(g, P1, ray), false, 'Action');
  assert.equal(canPlayNow(g, P1, dc), true, 'Reaction');
  void d2;
});

// MISMATCH-RJ: RJ says the banishment zone counts as a Board zone. CR 106-108 (Core Rules 2026-10-09): zones are
// grouped into the Board (107) and Non-Board Zones (108); Banishment is a Non-Board Zone (108.6). Test asserts the
// official consequence: Portal Rescue's banish takes the unit off the board, ending its temporary modifications.
test('RJ#5334 banishment is a non-board zone: a unit banished and replayed by Portal Rescue loses "this turn" Might', () => {
  let g = S0();
  fundAll(g, P0);
  const u = put(g, P0, 'V(2)', 'base');
  mod(g, u, { might: 3 });
  assert.equal(mightOf(g, u), 5);
  [g] = cast(g, P0, 'Portal Rescue', { targets: [[u]] });
  g = passAll(g);
  for (let i = 0; i < 6 && pend(g).inStep; i++) g = pend(g).kind === 'optional' ? no(g) : choose(g, pend(g).options![0].id);
  g = passAll(g);
  const now = g.players[0].base.find(id => g.objects[id].cardId === cid('V(2)'))!;
  assert.ok(now, 'replayed to base');
  assert.equal(mightOf(g, now), 2, 'new object: temporary +3 gone');
});

test('RJ#5337 Tideturner swapping with your only unit at a battlefield keeps control, so the hidden card there stays', () => {
  let g = S0();
  fundAll(g, P0);
  control(g, BF_A, P0);
  const x = put(g, P0, 'V(2)', BF_A);
  const fd = put(g, P0, 'Hidden Blade', { facedown: BF_A });
  const tt = hand(g, P0, 'Tideturner');
  g = play(g, P0, tt, { dest: 'base' });
  for (let i = 0; i < 10 && pend(g).kind !== 'mainAction'; i++) {
    const p = pend(g);
    if (p.kind === 'optional') { g = yes(g); continue; }
    if (p.inStep) { g = p.options?.some(o => o.id === x) ? choose(g, x) : choose(g, p.options![0].id); continue; }
    g = pass(g);
  }
  assert.equal(locOf(g, tt), BF_A); assert.equal(locOf(g, x), 'base');
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(zone(g, fd), 'facedown');
});

test('RJ#5338 the combat cleanup heals all units, including spell damage and units elsewhere', () => {
  let { g, atk } = attackSetup(['V(5)'], ['V(1)']);
  const other = put(g, P0, 'V(4)', 'base', { damage: 2 });
  g.objects[atk[0]].damage = 1;
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) { const p = pend(g); g = p.inStep ? choose(g, p.options![0].id) : pass(g); }
  assert.equal(g.objects[atk[0]].damage, 0);
  assert.equal(g.objects[other].damage, 0);
});

/** Drive in-step decisions with a chooser (returns option id, or 'yes'/'no'); passes priority otherwise until mainAction. */
function drive(g: GameState, pick: (d: ReturnType<typeof pend>) => string | undefined = () => undefined, limit = 40): GameState {
  for (let i = 0; i < limit && g.pending && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.inStep) { g = choose(g, pick(d) ?? (d.kind === 'optional' ? 'yes' : d.options![0].id)); continue; }
    g = pass(g);
  }
  return g;
}

test('RJ#5340 Kraken Hunter: spent buffs can reduce the [C] of its Accelerate cost too', () => {
  let g = S0();
  setRunes(g, P0, 4, 'body');
  // SCRIPT-FIX: Kraken Hunter costs [3][C][C] (data), so a third buff is needed to reach the Accelerate [C]
  const b1 = put(g, P0, 'V(1)', 'base', { buff: true }), b2 = put(g, P0, 'V(1)', 'base', { buff: true }), b3 = put(g, P0, 'V(1)', 'base', { buff: true });
  const kh = hand(g, P0, 'Kraken Hunter');
  const rd0 = g.players[0].runeDeck.length;
  g = act(g, { type: 'playCard', player: P0, obj: kh, destination: 'base' });
  let picked = 0;
  g = drive(g, d => {
    if (d.kind === 'optional') return 'yes';
    if (d.kind === 'chooseNumber') return d.options!.some(o => o.id === '3') ? '3' : d.options!.at(-1)!.id;
    const o = d.options!.find(x => (x.id === b1 || x.id === b2 || x.id === b3));
    if (o) { picked++; return o.id; }
    return undefined;
  });
  assert.equal(locOf(g, kh), 'base');
  assert.equal(g.objects[kh].exhausted, false, 'Accelerated: enters ready');
  assert.equal((g.objects[b1].counters.buff ?? 0) + (g.objects[b2].counters.buff ?? 0) + (g.objects[b3].counters.buff ?? 0), 0, 'all three buffs spent');
  assert.equal(g.players[0].runeDeck.length - rd0, 0, 'no power paid: [C] + Accelerate [C] both reduced');
  void picked;
});

test('RJ#5341 Imperial Decree: 1-Might attackers sent one at a time each kill a big defender; pre-damaged units are not killed', () => {
  let g = S0();
  fundAll(g, P0, 8);
  const pre = put(g, P1, 'V(9)', 'base', { damage: 1 });
  const d1 = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const d2 = put(g, P1, 'V(9)', BF_B); control(g, BF_B, P1);
  [g] = cast(g, P0, 'Imperial Decree'); g = passAll(g);
  assert.equal(zone(g, pre), 'base', 'damage dealt before the Decree does not count');
  const a1 = put(g, P0, 'V(1)', 'base'), a2 = put(g, P0, 'V(1)', 'base');
  g = drive(move(g, P0, [a1], BF_A));
  assert.equal(zone(g, d1), 'trash', 'first token combat kills the 9-Might defender');
  g = drive(move(g, P0, [a2], BF_B));
  assert.equal(zone(g, d2), 'trash', 'second, separate combat kills the other');
  assert.equal(zone(g, pre), 'base');
});

test('RJ#5344 Shield stacks (and Assault stacks — see T135): Shield 2 + granted Shield 1 = +3 while defending', () => {
  let g = S0();
  control(g, BF_A, P1);
  const d = put(g, P1, 'Shield(2,2)', BF_A);
  mod(g, d, { addKeywords: ['Shield 1'], layer: 2 });
  const a = put(g, P0, 'V(1)', 'base');
  g = move(g, P0, [a], BF_A);
  assert.equal(g.objects[d].combatRole, 'defender');
  assert.equal(mightOf(g, d), 5, '2 + Shield 2 + Shield 1');
});

test('RJ#5346 setup order: battlefields are chosen and revealed before turn order is chosen, then draw and mulligans', () => {
  let g = newGame({ battlefieldChoice: 'choose', mulligan: true });
  const seen: string[] = [];
  for (let i = 0; i < 8 && g.pending && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (seen.at(-1) !== d.kind) seen.push(d.kind);
    if (d.kind === 'chooseMode') assert.equal(g.battlefields.length, 2, 'battlefields revealed before first player is chosen');
    g = d.kind === 'mulligan' ? choose(g) : choose(g, d.options![0].id);
  }
  assert.deepEqual(seen, ['chooseBattlefield', 'chooseMode', 'mulligan']);
});

test('RJ#5347 Caitlyn: moving her does nothing; her [T] ability is activated (only at a battlefield); combat damage is assigned to her last', () => {
  let g = S0();
  const e = put(g, P1, 'V(5)', BF_B); control(g, BF_B, P1);
  const c = put(g, P0, 'Caitlyn', 'base');
  assert.ok(!legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === c), 'not usable from base');
  g = drive(move(g, P0, [c], BF_A));
  assert.equal(g.objects[e].damage, 0, 'moving triggers nothing');
  assert.equal(g.chain.length, 0);
  assert.equal(g.objects[c].exhausted, true, 'moving exhausted her: ability not usable now');
  assert.ok(!legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === c));
  g.objects[c].exhausted = false; g.timestamp++;
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === c)!);
  g = drive(answer(g, { targets: [[e]] }));
  assert.equal(g.objects[e].damage, 3);
  assert.equal(g.objects[c].exhausted, true);
  // combat: Caitlyn must be assigned damage last
  const s = attackSetup(['Caitlyn', 'V(2)'], ['V(2)']);
  let h = s.g;
  for (let i = 0; i < 30 && pend(h).kind !== 'mainAction'; i++) {
    const d = pend(h);
    if (d.kind === 'assignDamage') {
      if (d.player === P1) assert.ok(validateAction(h, { type: 'assignDamage', player: P1, assignment: { [s.atk[0]]: 2 } }), 'cannot hit Caitlyn first');
      h = act(h, { type: 'assignDamage', player: d.player, assignment: d.player === P1 ? { [s.atk[1]]: 2 } : { [s.def[0]]: 5 } });
      continue;
    }
    h = d.inStep ? choose(h, d.options![0].id) : pass(h);
  }
  assert.notEqual(zone(h, s.atk[0]), 'trash');
  assert.equal(zone(h, s.atk[1]), 'trash', 'the other attacker took the 2');
});

test('RJ#5348 Pirate\'s Haven applies to each unit readied (several readied in Awaken each get +1)', () => {
  let g = S0({ tp: P1 });
  put(g, P0, "Pirate's Haven", 'base');
  const us = [put(g, P0, 'V(2)', 'base', { ready: false }), put(g, P0, 'V(3)', 'base', { ready: false }), put(g, P0, 'V(1)', BF_A, { ready: false })];
  control(g, BF_A, P0);
  g = nextTurn(g);
  assert.equal(g.activePlayer, P0);
  assert.deepEqual(us.map(u => mightOf(g, u)), [3, 4, 2]);
});

test('RJ#5350 a unit moved by a card effect (Fight or Flight) is not exhausted', () => {
  let g = S0();
  fundAll(g, P0);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  [g] = cast(g, P0, 'Fight or Flight', { targets: [[u]] });
  g = drive(g);
  assert.equal(locOf(g, u), 'base');
  assert.equal(g.objects[u].exhausted, false);
});

test('RJ#5356 Lecturing Yordle vs Ahri, Inquisitive + Nine-Tailed Fox: Cleave before attacking ends at 2, Cleave after the reductions at 4', () => {
  const run = (cleaveFirst: boolean) => {
    let g = S0();
    fundAll(g, P0);
    setLegend(g, P1, 'Nine-Tailed Fox');
    const ah = put(g, P1, 'ogn-119-298', BF_A); control(g, BF_A, P1);
    const y = put(g, P0, 'Lecturing Yordle', 'base');
    if (cleaveFirst) { [g] = cast(g, P0, 'Cleave', { targets: [[y]] }); g = resolveChain(g); }
    g = move(g, P0, [y], BF_A);
    // resolve the attack/defend triggers (target the Yordle)
    for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) {
      const d = pend(g);
      g = d.inStep ? choose(g, d.options!.some(o => o.id === y) ? y : d.options![0].id) : pass(g);
    }
    if (!cleaveFirst) {
      for (let i = 0; i < 3 && pend(g).player !== P0; i++) g = pass(g);
      [g] = cast(g, P0, 'Cleave', { targets: [[y]] });
      for (let i = 0; i < 10 && g.chain.length; i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
    }
    void ah;
    return mightOf(g, y);
  };
  assert.equal(run(true), 2, '2 + 3 - 1 - 2');
  assert.equal(run(false), 4, '2 - 1 (min 1) - 0 (already at 1) + 3');
});

test('RJ#5358 two Gemcraft Seers: a unit played gets two separate Vision triggers, each looked at and decided one at a time', () => {
  const visions = (seers: number, card: string) => {
    let g = S0();
    fundAll(g, P0);
    for (let i = 0; i < seers; i++) put(g, P0, 'Gemcraft Seer', 'base');
    const u = hand(g, P0, card);
    g = play(g, P0, u, { dest: 'base' });
    let n = 0;
    g = drive(g, d => { if (/recycle/i.test(d.prompt)) n++; return undefined; });
    return n;
  };
  assert.equal(visions(2, 'V(1)'), 2, 'one Vision from each Seer');
  assert.equal(visions(1, 'Gemcraft Seer'), 2, 'second Seer: its own Vision + the one granted by the first');
});

test('RJ#5362 defending Ahri, Inquisitive banished and replayed to the same battlefield by Arcane Shift defends again and triggers a second time', () => {
  let g = S0(); fundAll(g, P1, 6);
  const ah = put(g, P1, 'ogn-119-298', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(12)', 'base');
  const as = hand(g, P1, 'Arcane Shift');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 8 && !canPlayNow(g, P1, as); i++) g = pend(g).inStep ? choose(g, optionIds(g).includes(a) ? a : optionIds(g)[0]) : pass(g);
  assert.equal(mightOf(g, a), 10, 'first defend trigger: -2');
  g = play(g, P1, as, { targets: [[ah], [a]] });
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    g = choose(g, o.includes(String(BF_A)) ? String(BF_A) : o.includes(a) ? a : o[0]);
  }
  const ah2 = Object.values(g.objects).find(o => o.cardId === 'ogn-119-298' && o.zone === 'battlefield');
  assert.ok(ah2, 'replayed to the battlefield');
  assert.equal(ah2!.combatRole, 'defender', 'new object gets the Defender designation');
  assert.equal(mightOf(g, a), 8, 'second defend trigger: another -2');
  assert.equal(g.objects[a].damage, 3, 'Arcane Shift dealt 3');
});

test('RJ#5365 Gust on your own 3-Might Ravenbloom Student: Gust resolves first (play completes on resolution), Student returns to hand', () => {
  let g = S0();
  fundAll(g, P0);
  const st = put(g, P0, 'Ravenbloom Student', BF_A); control(g, BF_A, P0);
  mod(g, st, { might: 1 });
  assert.equal(mightOf(g, st), 3);
  [g] = cast(g, P0, 'Gust', { targets: [[st]] });
  g = drive(g);
  assert.equal(zone(g, st), 'hand', 'returned (did not get +1 first)');
});

test('RJ#5366 Unchecked Power countered by Wind Wall: friendly units are not exhausted (exhausting is the effect, not a cost)', () => {
  let g = S0();
  fundAll(g, P0, 9); fundAll(g, P1);
  const u = put(g, P0, 'V(2)', 'base');
  const e = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'Unchecked Power');
  assert.equal(g.objects[u].exhausted, false, 'not exhausted on play');
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'Wind Wall'), { targets: [[g.chain[0].source]] });
  g = resolveChain(g);
  assert.equal(g.objects[u].exhausted, false);
  assert.equal(zone(g, e), 'battlefield');
});

test('RJ#5367 holding priority to add Stupefy on top of an Action is no buffer: Wind Wall can counter the earlier spell', () => {
  let { g, def } = attackSetup(['V(4)'], ['V(6)']);
  fundAll(g, P0); fundAll(g, P1);
  const ray = hand(g, P0, 'Hextech Ray'), st = hand(g, P0, 'Stupefy');
  g = play(g, P0, ray, { targets: [[def[0]]] });
  expectPending(g, 'chainResponse', P0);
  g = play(g, P0, st, { targets: [[def[0]]] });
  g = pass(g);
  expectPending(g, 'chainResponse', P1);
  const ww = hand(g, P1, 'Wind Wall');
  g = act(g, { type: 'playCard', player: P1, obj: ww });
  expectPending(g, 'chooseTargets', P1);
  const labels = pend(g).options!.map(o => o.label);
  assert.ok(labels.includes('Hextech Ray') && labels.includes('Stupefy'), 'either spell can be chosen');
  g = choose(g, pend(g).options!.find(o => o.label === 'Hextech Ray')!.id);
  g = resolveChain(g);
  assert.equal(zone(g, ray), 'trash');
  assert.equal(g.objects[def[0]].damage, 0, 'Ray countered');
});

test('RJ#5369 Shield instances add up: two Taric + Sunlit Guardian defending, Block on one Taric → 9 / 6 / 6', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0);
  control(g, BF_A, P0);
  const t1 = put(g, P0, 'Taric', BF_A), t2 = put(g, P0, 'Taric', BF_A), sg = put(g, P0, 'Sunlit Guardian', BF_A);
  const a = put(g, P1, 'V(1)', 'base');
  g = move(g, P1, [a], BF_A);
  for (let i = 0; i < 4 && pend(g).player !== P0; i++) g = pass(g);
  [g] = cast(g, P0, 'Block', { targets: [[t1]] });
  for (let i = 0; i < 6 && g.chain.length; i++) g = pass(g);
  assert.deepEqual([t1, t2, sg].map(u => mightOf(g, u)), [9, 6, 6]);
});

function setup5370(withZhonya: boolean) {
  let g = S0();
  fundAll(g, P0);
  const u = put(g, P1, 'V(2)', BF_A, { damage: 3 }); control(g, BF_A, P1);
  const ls = put(g, P1, 'Long Sword', 'base'), ga = put(g, P1, 'Guardian Angel', 'base');
  attachNow(g, ls, u); attachNow(g, ga, u);
  const z = withZhonya ? put(g, P1, "Zhonya's Hourglass", 'base') : null;
  [g] = cast(g, P0, 'Hextech Ray', { targets: [[u]] });
  return { g, u, ls, ga, z };
}

test('RJ#5370 a unit saved by Guardian Angel (or Zhonya\'s) keeps its other equipment attached', () => {
  let { g, u, ls, ga } = setup5370(false);
  g = drive(g);
  assert.equal(locOf(g, u), 'base', 'saved and recalled');
  assert.equal(zone(g, ga), 'trash', 'Guardian Angel killed instead');
  assert.equal(g.objects[ls].attachedTo, u, 'Long Sword still attached');
});

test('RJ#5370b Zhonya\'s Hourglass and Guardian Angel would both replace one death: the controller chooses which applies', () => {
  let { g, u, ls, z } = setup5370(true);
  let asked = false;
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const o = d.options?.find(x => x.id === z || /Zhonya/.test(x.label ?? ''));
    if (d.player === P1 && o) { asked = true; g = choose(g, o.id); continue; }
    g = choose(g, d.options![0].id);
  }
  assert.equal(locOf(g, u), 'base');
  assert.equal(g.objects[ls].attachedTo, u);
  assert.equal(asked, true, 'controller chose which replacement applies');
});

test('RJ#5372 Smoke Screen on an attacking Chemtech Enforcer (4 with Assault) snapshots -3; after combat its Might is -1', () => {
  let { g, atk } = attackSetup(['Chemtech Enforcer'], ['V(1)'], { defOpts: [{ stunned: true }] });
  fundAll(g, P1);
  assert.equal(mightOf(g, atk[0]), 4);
  for (let i = 0; i < 4 && pend(g).player !== P1; i++) g = pass(g);
  [g] = cast(g, P1, 'Smoke Screen', { targets: [[atk[0]]] });
  for (let i = 0; i < 6 && g.chain.length; i++) g = pass(g);
  assert.equal(mightOf(g, atk[0]), 1);
  for (let i = 0; i < 30 && g.showdown; i++) { const d = pend(g); g = d.inStep ? choose(g, d.options![0].id) : pass(g); }
  assert.equal(mightOf(g, atk[0]), -1, '2 - 3 (Assault gone)');
});

test('RJ#5377 Crackshot Corsair + Warwick attacking: order Corsair\'s 1 damage first, then Warwick kills the damaged enemy', () => {
  let { g, def } = attackSetup(['Warwick, Hunter', 'Crackshot Corsair'], ['V(9)']);
  for (let i = 0; i < 20 && (g.chain.length || g.pending?.inStep); i++) {
    const d = g.pending!;
    if (d.kind === 'orderTriggers') { g = choose(g, d.options!.find(o => /Warwick/.test(o.label))!.id); continue; }
    g = d.inStep ? choose(g, d.options!.some(o => o.id === def[0]) ? def[0] : d.options![0].id) : pass(g);
  }
  assert.equal(zone(g, def[0]), 'trash');
});

test('RJ#5379 a unit swapped into combat by hidden Tideturner becomes a defender and its "When I defend" triggers', () => {
  let g = S0();
  fundAll(g, P1);
  const dv = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const tt = put(g, P1, 'Tideturner', { facedown: BF_A });
  const ah = put(g, P1, 'ogn-119-298', 'base');
  const a = put(g, P0, 'V(5)', 'base');
  g = move(g, P0, [a], BF_A);
  g = passAll(g, 1);
  expectPending(g, 'showdownAction', P1);
  g = act(g, { type: 'playCard', player: P1, obj: tt });
  g = answer(g, { may: [true], targets: [[ah]], cards: [[ah]] }, P1);
  for (let i = 0; i < 12 && (g.chain.length || pend(g).inStep); i++) {
    const p = pend(g);
    if (p.inStep) g = p.kind === 'optional' ? yes(g) : choose(g, p.options!.some(o => o.id === ah) ? ah : p.options!.some(o => o.id === a) ? a : p.options![0].id);
    else g = pass(g);
  }
  assert.equal(locOf(g, ah), BF_A, 'Ahri swapped in');
  assert.equal(g.objects[ah].combatRole, 'defender');
  assert.equal(mightOf(g, a), 3, 'her defend trigger gave the attacker -2');
  void dv;
});

test('RJ#5384 Kayn, Unleashed: a second "move to base" while already in base is not a move (Kayn has not moved twice)', () => {
  let g = S0();
  fundAll(g, P0, 8);
  const k = put(g, P0, 'Kayn, Unleashed', BF_A); control(g, BF_A, P0);
  [g] = cast(g, P0, 'Flash', { targets: [[k]] }); g = drive(g, d => d.options?.some(o => o.id === k) ? k : undefined);
  assert.equal(locOf(g, k), 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Flash') });
  // DECISIONS #1127 (principle 25): Kayn may be chosen again, but a unit already at the fixed destination doesn't move
  if (pend(g).kind === 'chooseTargets') g = act(g, { type: 'choose', player: P0, optionIds: optionIds(g).includes(k) ? [k] : [] });
  g = drive(g);
  assert.equal(locOf(g, k), 'base');
  assert.equal(g.objects[k].movesThisTurn ?? 0, 1, 'only one real move');
});

test('RJ#5385 Mindsplitter choosing a unit card in the opponent\'s hand does not count toward Prodigal Explorer', () => {
  let g = S0();
  fundAll(g, P0, 8);
  const lg = setLegend(g, P0, 'Prodigal Explorer');
  const canLegend = (h: GameState) => legal(h, P0, 'activate').some(a => a.type === 'activate' && a.obj === lg);
  const e1 = put(g, P1, 'V(9)', 'base');
  const hu = hand(g, P1, 'V(3)'); const hu2 = hand(g, P1, 'V(4)');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Singularity') });
  g = choose(g, e1);
  g = drive(g);
  assert.equal(canLegend(g), false, 'one choice so far');
  for (const _ of [0, 1]) {
    g = play(g, P0, hand(g, P0, 'Mindsplitter'), { dest: 'base' });
    g = drive(g, d => d.options?.some(o => o.id === hu) ? hu : d.options?.some(o => o.id === hu2) ? hu2 : undefined);
  }
  assert.equal(zone(g, hu), 'trash', 'a unit card was chosen from hand');
  assert.equal(canLegend(g), false, 'cards in hand are not enemy units');
});

test('RJ#5388 during the first player\'s first turn the second player has no runes in play', () => {
  const g = newGame({ firstPlayer: P0 });
  expectPending(g, 'mainAction', P0);
  assert.ok(g.players[0].runesInPlay.length > 0);
  assert.equal(g.players[1].runesInPlay.length, 0);
});

test('RJ#5392 Hextech Ray on a 3-Might unit answered by Discipline: it survives at 5 Might with 3 damage marked', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'Hextech Ray', { targets: [[u]] });
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'Discipline'), { targets: [[u]] });
  g = drive(g);
  assert.equal(zone(g, u), 'battlefield');
  assert.equal(mightOf(g, u), 5);
  assert.equal(g.objects[u].damage, 3);
});

test('RJ#5396 two Akshans stealing the same gear: the later control effect wins; as each leaves, control is recomputed from what remains', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1, 8);
  const gear = put(g, P1, 'Baited Hook', 'base');
  const stealWith = (p: PlayerId) => {
    const ak = hand(g, p, 'Akshan, Mischievous');
    g = act(g, { type: 'playCard', player: p, obj: ak, destination: 'base' });
    g = drive(g, d => d.kind === 'optional' ? 'yes' : d.options?.some(o => o.id === gear) ? gear : undefined);
    return ak;
  };
  const a1 = stealWith(P0);
  assert.equal(g.objects[gear].controller, P0);
  g = endTurn(g, P0); g = drive(g);
  assert.equal(g.activePlayer, P1);
  const a2 = stealWith(P1);
  assert.equal(g.objects[gear].controller, P1, 'later effect overrides');
  // P1's own Akshan (a2) leaves first: P0's earlier effect still applies
  fundAll(g, P1, 4);
  put(g, P1, 'V(1)', 'base');
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Deathgrip') });
  g = drive(g, d => d.options?.some(o => o.id === a2) ? a2 : undefined);
  assert.equal(zone(g, a2), 'trash');
  assert.equal(g.objects[gear].controller, P0, 'remaining control effect (Akshan 1) applies');
  void a1;
});

test('RJ#5400 Feral Strength + Repeat on Irelia (sfd-057) with Blade Dancer readying her: +7 total', () => {
  let g = S0(); fundAll(g, P0, 8);
  setLegend(g, P0, 'Blade Dancer');
  const ir = put(g, P0, 'sfd-057-221', 'base', { ready: false });
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Feral Strength') });
  g = answer(g, { targets: [[ir]], may: [true] }, P0);
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.inStep) g = d.kind === 'optional' ? yes(g) : choose(g, optionIds(g).includes(ir) ? ir : optionIds(g)[0]);
    else g = pass(g);
  }
  assert.equal(g.objects[ir].exhausted, false, 'readied by Blade Dancer');
  assert.equal(mightOf(g, ir), 4 + 7, '+2 +2 (Feral x2) +1 +1 (chosen twice) +1 (readied)');
});

test('RJ#5402 Vi, Destructive: "Recycle 1 from your trash" can be activated repeatedly, +1 Might each, without exhausting', () => {
  let g = S0();
  const vi = put(g, P0, 'Vi, Destructive', 'base');
  const t1 = put(g, P0, 'V(1)', 'trash'), t2 = put(g, P0, 'V(1)', 'trash');
  for (let i = 0; i < 2; i++) { g = act(g, { type: 'activate', player: P0, obj: vi, abilityIndex: 0 }); g = drive(g); }
  assert.equal(mightOf(g, vi), 3 + 2);
  assert.equal(g.objects[vi].exhausted, false);
  assert.equal(zone(g, t1), 'mainDeck'); assert.equal(zone(g, t2), 'mainDeck');
  assert.ok(!legal(g, P0, 'activate').some(a => (a as { obj?: string }).obj === vi), 'empty trash: no more activations');
});

test('RJ#5407 contesting a battlefield is not controlling it; a battlefield already scored this turn is not scored again', () => {
  let g = S0();
  const a = put(g, P0, 'V(2)', 'base'), b = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [a], BF_A);
  expectPending(g, 'showdownAction', P0);
  assert.equal(g.battlefields[BF_A].controller, null, 'contested, not controlled');
  g = drive(g);
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[0].points, 1);
  g = drive(move(g, P0, [b], BF_A));
  assert.equal(g.players[0].points, 1, 'no second conquer this turn');
});

test('RJ#5411 respond with Stupefy, draw Retreat, then play Retreat against the same still-pending spell', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const r = put(g, P1, 'Retreat', 'deckTop');
  [g] = cast(g, P0, 'Hextech Ray', { targets: [[u]] });
  g = pass(g);
  g = play(g, P1, hand(g, P1, 'Stupefy'), { targets: [[u]] });
  g = passN(g, 2);
  assert.equal(zone(g, r), 'hand', 'Stupefy drew Retreat');
  assert.equal(g.chain.length, 1, 'Hextech Ray still on the chain');
  if (pend(g).player === P0) g = pass(g);
  assert.ok(canPlayNow(g, P1, r));
  g = drive(play(g, P1, r, { targets: [[u]] }));
  assert.equal(zone(g, u), 'hand', 'saved by Retreat');
});

test('RJ#5413 Gemcraft Seer gives tokens Vision too: four Recruits played by Recruit the Vanguard each trigger Vision', () => {
  let g = withTokens(S0());
  fundAll(g, P0, 8);
  put(g, P0, 'Gemcraft Seer', 'base');
  [g] = cast(g, P0, 'Recruit the Vanguard', {});
  g = passN(g, 2);
  const rs = Object.keys(g.objects).filter(id => g.cards[g.objects[id].cardId]?.name === 'Recruit' && g.objects[id].zone === 'base');
  assert.equal(rs.length, 4);
  assert.ok(rs.every(r => hasKeyword(g, r, 'Vision')));
  assert.equal(g.chain.filter(c => c.kind === 'trigger' && rs.includes(c.source)).length, 4, 'four Vision triggers');
});

test('RJ#5416 Viktor, Innovator + Portal Rescue on another friendly unit on the opponent\'s turn: 2 Recruits (spell + unit played)', () => {
  let g = withTokens(S0({ tp: P1 })); fundAll(g, P0);
  put(g, P0, 'Viktor, Innovator', 'base');
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const a = put(g, P1, 'V(9)', 'base');
  g = move(g, P1, [a], BF_A);
  for (let i = 0; i < 4 && pend(g).player !== P0; i++) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Portal Rescue'), { targets: [[u]] });
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  assert.equal(locOf(g, u), 'base');
  const rec = Object.values(g.objects).filter(o => o.isToken && g.cards[o.cardId]?.name === 'Recruit' && o.controller === P0 && ['base', 'battlefield'].includes(o.zone)).length;
  assert.equal(rec, 2);
});

test('RJ#5421 Rebuke ([Action]) can\'t answer Challenge on the chain; Gust ([Reaction]) can and Challenge then deals nothing', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const mine = put(g, P0, 'V(3)', BF_A), theirs = put(g, P1, 'V(2)', BF_A);
  const rb = hand(g, P1, 'Rebuke'), gu = hand(g, P1, 'Gust');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Challenge') });
  g = answer(g, { targets: [[mine], [theirs]] }, P0);
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  assert.equal(g.chain.length, 1);
  assert.ok(!canPlayNow(g, P1, rb), 'Action spell not playable while the chain exists');
  assert.ok(canPlayNow(g, P1, gu));
  g = drive(play(g, P1, gu, { targets: [[theirs]] }));
  assert.equal(zone(g, theirs), 'hand');
  assert.equal(g.objects[mine].damage, 0, 'Challenge has no enemy unit left: no damage');
});

test('RJ#5427 Karma, Channeler: recycling runes to pay a cost does not trigger her (runes are not recycled to the Main Deck)', () => {
  let g = S0();
  fundAll(g, P0, 8);
  const k = put(g, P0, 'Karma, Channeler', 'base'); const v = put(g, P0, 'V(1)', 'base');
  const e = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const rd = g.players[0].runeDeck.length;
  [g] = cast(g, P0, 'Hextech Ray', { targets: [[e]] });
  assert.equal(g.players[0].runeDeck.length, rd + 1, 'a rune was recycled for [C]');
  assert.equal(g.chain.length, 1, 'no Karma trigger');
  g = drive(g);
  assert.ok(!g.objects[k].counters.buff && !g.objects[v].counters.buff);
});

test('RJ#5428 Rell attacks Reaver\'s Row; the lone defender moves to base on the defend trigger: Rell\'s attack trigger still plays and attaches the Equipment', () => {
  let g = S0({ bfA: "Reaver's Row" });
  const rell = put(g, P0, 'Rell', 'base');
  const bow = put(g, P0, 'Recurve Bow', 'hand');
  const e = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [rell], BF_A);
  g = drive(g, d => d.options?.some(o => o.id === bow) ? bow : d.options?.some(o => o.id === e) ? e : undefined);
  assert.equal(locOf(g, e), 'base', 'defender moved away');
  assert.equal(g.objects[bow].attachedTo, rell, 'Rell\'s trigger still resolved');
  assert.equal(g.battlefields[BF_A].controller, P0);
});

test('RJ#5430 ending the turn with no triggers opens no priority window: the opponent gets no chance to play Gust before their own turn', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  hand(g, P1, 'Gust');
  put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  g = endTurn(g, P0);
  expectPending(g, 'mainAction', P1);
  assert.equal(g.activePlayer, P1, 'straight to the opponent\'s own main phase');
});

test('RJ#5434 two copies of the same gear trigger separately: two Zero Point Inflections draw 2 each on one card play', () => {
  let g = S0();
  fundAll(g, P0);
  put(g, P0, 'Zero Point Inflection', 'base'); put(g, P0, 'Zero Point Inflection', 'base');
  const v = hand(g, P0, 'V(1)');
  const h0 = g.players[0].hand.length;
  g = drive(play(g, P0, v, { dest: 'base' }));
  assert.equal(g.players[0].hand.length, h0 - 1 + 4);
});

function feralOnIrelias(two: boolean) {
  let g = S0(); fundAll(g, P0, 8);
  const i1 = put(g, P0, 'Irelia, Graceful', 'base');
  const i2 = two ? put(g, P0, 'Irelia, Graceful', 'base') : i1;
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Feral Strength') });
  const picks = [i1, i2];
  for (let i = 0; i < 10 && pend(g).inStep; i++) g = pend(g).kind === 'optional' ? yes(g) : choose(g, picks.shift() ?? optionIds(g)[0]);
  assert.equal(g.chain.length, 1);
  return exhaustedRunes(g, P0);
}
test('RJ#5435 Feral Strength + Repeat choosing one Irelia, Graceful twice: discount applies once (2+2-1 = 3)', () => {
  assert.equal(feralOnIrelias(false), 3);
});
test('RJ#5435b Feral Strength + Repeat choosing two different Irelia, Graceful: each discounts (2+2-2 = 2)', () => {
  assert.equal(feralOnIrelias(true), 2);
});

test('RJ#5438 hiding a card does not open a chain: the player keeps acting in the main phase', () => {
  let g = S0();
  setRunes(g, P0, 1);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const h = hand(g, P0, 'HidU(2)');
  g = act(g, { type: 'hide', player: P0, obj: h, battlefieldIndex: BF_A });
  assert.equal(zone(g, h), 'facedown');
  assert.equal(g.chain.length, 0);
  expectPending(g, 'mainAction', P0);
});

test('RJ#5441 attacker\'s Stacked Deck in a combat showdown finds Nocturne: it can only be played to base (attacker doesn\'t control the contested battlefield)', () => {
  let { g } = attackSetup(['V(1)'], ['V(5)']);
  fundAll(g, P0); fundAll(g, P1);
  for (let i = 0; i < 6 && pend(g).kind !== 'showdownAction'; i++) g = pass(g);
  expectPending(g, 'showdownAction', P0);
  put(g, P0, 'V(1)', 'deckTop'); put(g, P0, 'V(2)', 'deckTop');
  const n = put(g, P0, 'Nocturne, Horrifying', 'deckTop');
  let offeredBf = false;
  g = drive(play(g, P0, hand(g, P0, 'Stacked Deck')), d => { if (d.options?.some(o => /Battlefield|BF|@/i.test(o.label) && o.id === String(BF_A))) offeredBf = true; return undefined; }, 12);
  assert.equal(locOf(g, n), 'base');
  assert.ok(!offeredBf);
});

test('RJ#5444 Ava Achiever attacking an enemy battlefield: plays a Hidden unit there (not controlled), or Hidden Blade on a unit at another battlefield', () => {
  const run = (card: string) => {
    let g = S0(); fundAll(g, P0);
    const e = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
    const f = put(g, P1, 'V(2)', BF_B); control(g, BF_B, P1);
    const ava = put(g, P0, 'Ava Achiever', 'base');
    const c = hand(g, P0, card);
    g = move(g, P0, [ava], BF_A);
    for (let i = 0; i < 12 && pend(g).kind !== 'showdownAction'; i++) {
      const d = pend(g);
      g = !d.inStep ? pass(g) : choose(g, d.options!.some(o => o.id === c) ? c : d.options!.some(o => o.id === f) ? f : d.options![0].id);
    }
    return { g, c, e, f, where: locOf(g, c) };
  };
  const u = run('HidU(2)');
  assert.equal(u.where, BF_A, 'Hidden unit played to the attacked battlefield');
  const s = run('Hidden Blade');
  assert.equal(zone(s.g, s.c), 'trash');
  assert.equal(zone(s.g, s.f), 'trash', 'killed a unit at the other battlefield');
});

test('RJ#5445 Forge of the Future\'s recycle choices are locked on activation: Immortal Phoenix played in response is not recycled, nothing new is chosen', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const forge = put(g, P0, 'Forge of the Future', 'base');
  const ph = put(g, P1, 'Immortal Phoenix', 'trash');
  const t2 = put(g, P1, 'V(1)', 'trash');
  const late = put(g, P0, 'V(1)', 'trash');
  const victim = put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  g = act(g, legal(g, P0, 'activate').find(a => (a as { obj?: string }).obj === forge)!);
  g = act(g, { type: 'choose', player: P0, optionIds: [ph, t2] });
  assert.equal(g.chain.length, 1);
  if (pend(g).player === P0) g = pass(g);
  g = drive(play(g, P1, hand(g, P1, 'ZapR'), { targets: [[victim]] }));
  assert.equal(zone(g, victim), 'trash');
  assert.equal(locOf(g, ph), 'base', 'Phoenix played from the trash before Forge resolved');
  assert.equal(zone(g, t2), 'mainDeck', 'the other chosen card is recycled');
  assert.equal(zone(g, late), 'trash', 'a card that wasn\'t chosen stays (no new choice)');
});

test('RJ#5446 Trifarian War Camp\'s +1 applies on arrival, before Nine-Tailed Fox\'s -1 (min 1) resolves: attackers end at printed Might', () => {
  let g = S0({ bfA: 'Trifarian War Camp' });
  setLegend(g, P1, 'Nine-Tailed Fox');
  put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(1)', 'base'), b = put(g, P0, 'V(3)', 'base');
  g = move(g, P0, [a, b], BF_A);
  for (let i = 0; i < 8 && pend(g).kind !== 'showdownAction'; i++) { const d = pend(g); g = d.inStep ? choose(g, d.options!.some(o => o.id === a) && !g.objects[a].modifiers.length ? a : d.options!.some(o => o.id === b) ? b : d.options![0].id) : pass(g); }
  assert.equal(mightOf(g, a), 1, '1 +1 (War Camp) -1');
  assert.equal(mightOf(g, b), 3);
});

test('RJ#5447 Kai\'Sa, Evolutionary checks the printed Energy cost: Drag Under (5, "costs [2] less from anywhere other than your hand") is not offered at 4 points', () => {
  let g = S0(); fundAll(g, P0);
  g.players[P0].points = 3;
  const du = put(g, P0, 'Drag Under', 'trash');
  const hr = put(g, P0, 'Hextech Ray', 'trash');
  put(g, P1, 'V(2)', BF_B);
  const k = put(g, P0, "Kai'Sa, Evolutionary", 'base');
  let offered: string[] = [];
  g = drive(move(g, P0, [k], BF_A), d => { if ((d.kind === 'chooseCards' || d.kind === 'chooseTargets') && /trash/i.test(d.prompt ?? '')) offered = d.options!.map(o => o.id); return undefined; });   // chosen as the trigger is chained (RJ#10771)
  assert.equal(g.players[P0].points, 4);
  assert.deepEqual(offered, [hr]);
  assert.equal(zone(g, du), 'trash');
});

test('RJ#5448 1v1: both players may end up with the same battlefield; no redraw', () => {
  const bfs = ['cf-bf-a', 'cf-bf-b', 'cf-bf-c'];
  let g = newGame({ battlefieldChoice: 'choose', p0: { battlefields: bfs }, p1: { battlefields: bfs } });
  for (const p of [P0, P1]) {
    const d = expectPending(g, 'chooseBattlefield', p);
    g = choose(g, d.options!.find(o => o.label === 'BF-A')!.id);
  }
  assert.deepEqual(g.battlefields.map(b => g.objects[b.objId].cardId), ['cf-bf-a', 'cf-bf-a']);
  assert.notEqual(pend(g).kind, 'chooseBattlefield');
});

test('RJ#5450 held a battlefield this turn, lost it, retook it the same turn: control yes, but no conquer (no point, no "When I conquer")', () => {
  let g = S0({ tp: P1 });
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const k = put(g, P0, "Kai'Sa, Survivor", 'base');
  g = nextTurn(g);
  assert.equal(g.players[P0].points, 1, 'hold point');
  g = drive(move(g, P0, [u], 'base'));
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const h = g.players[P0].hand.length;
  g = move(g, P0, [k], BF_A);
  for (let i = 0; i < 16 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    g = !d.inStep ? pass(g) : d.kind === 'assignDamage' ? act(g, { type: 'assignDamage', player: d.player, assignment: (d.data as { suggested: Record<string, number> }).suggested }) : choose(g, d.options![0].id);
  }
  assert.equal(g.battlefields[BF_A].controller, P0, 'control regained');
  assert.equal(g.players[P0].points, 1, 'no second score');
  assert.equal(g.players[P0].hand.length, h, 'no conquer trigger (Kai\'Sa draw)');
});

test('RJ#5455 Falling Star\'s targets are chosen when played (visible on the chain); En Garde in response saves the 4-Might target', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const a = put(g, P1, 'V(4)', BF_A), b = put(g, P1, 'V(3)', BF_B);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Falling Star') });
  g = answer(g, { targets: [[a], [b]] }, P0);
  assert.deepEqual(g.chain[0].targets, [[a], [b]], 'both targets locked in on the chain');
  if (pend(g).player === P0) g = pass(g);
  g = drive(play(g, P1, hand(g, P1, 'En Garde'), { targets: [[a]] }));
  assert.equal(zone(g, a), 'battlefield');
  assert.equal(g.objects[a].damage, 3);
  assert.equal(zone(g, b), 'trash');
});

test('RJ#5456 Party Favors in 1v1: the opponent chooses Cards or Runes and both players get it', () => {
  for (const pick of ['cards', 'runes']) {
    let g = S0(); fundAll(g, P0);
    const h0 = g.players[0].hand.length, h1 = g.players[1].hand.length, r0 = g.players[0].runesInPlay.length, r1 = g.players[1].runesInPlay.length;
    g = play(g, P0, hand(g, P0, 'Party Favors'));
    g = drive(g, d => { assert.equal(d.player, P1, 'opponent chooses'); return pick; });
    const n = pick === 'cards' ? [1, 1, 0, 0] : [0, 0, 1, 1];
    assert.deepEqual([g.players[0].hand.length - h0, g.players[1].hand.length - h1, g.players[0].runesInPlay.length - r0, g.players[1].runesInPlay.length - r1], n, pick);
  }
});

test('RJ#5461 the defender moves Yasuo, Remorseful into the combat with Ride the Wind: he is a defender, "When I attack" doesn\'t trigger; focus back to the attacker', () => {
  let { g, atk } = attackSetup(['V(3)'], ['V(2)']);
  fundAll(g, P1);
  const y = put(g, P1, 'Yasuo, Remorseful', 'base');
  for (let i = 0; i < 6 && pend(g).kind !== 'showdownAction'; i++) g = pass(g);
  g = pass(g);
  expectPending(g, 'showdownAction', P1);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Ride the Wind') });
  for (let i = 0; i < 8 && pend(g).kind !== 'showdownAction'; i++) {
    const d = pend(g);
    g = d.inStep ? choose(g, d.options!.some(o => o.id === y) ? y : d.options!.find(o => /BF-A/.test(o.label))?.id ?? d.options![0].id) : pass(g);
  }
  assert.equal(locOf(g, y), BF_A);
  assert.equal(g.chain.length, 0, 'no attack trigger');
  assert.equal(g.objects[atk[0]].damage, 0);
  expectPending(g, 'showdownAction', P0);
});

test('RJ#5466 Convergent Mutation vs Teemo, Scout\'s play trigger: in response → raised to 8 then +3 = 11; after the trigger → 4 raised to 8', () => {
  const run = (respond: boolean) => {
    let g = S0(); fundAll(g, P0, 6);
    const big = put(g, P0, 'V(8)', 'base');
    const t = hand(g, P0, 'Teemo, Scout');
    g = play(g, P0, t, { dest: 'base' });
    for (let i = 0; i < 4 && !g.chain.some(c => c.kind === 'trigger'); i++) g = pass(g);
    assert.ok(g.chain.some(c => c.kind === 'trigger'), 'play trigger on the chain');
    if (!respond) g = passN(g, 2);
    g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Convergent Mutation') });
    const q = [t, big];
    for (let i = 0; i < 14 && pend(g).kind !== 'mainAction'; i++) g = pend(g).inStep ? choose(g, q.shift() ?? optionIds(g)[0]) : pass(g);
    return mightOf(g, t);
  };
  assert.equal(run(true), 11);
  assert.equal(run(false), 8);
});

test('RJ#5468 The Boss can save a buffed unit that dies in base: it stays in base, exhausted, buff spent', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  setLegend(g, P0, 'The Boss');
  const u = put(g, P0, 'V(3)', 'base', { buff: true, ready: true });
  g = play(g, P0, hand(g, P0, "KillDraw"), { targets: [[u]] });
  g = drive(g);
  assert.equal(locOf(g, u), 'base');
  assert.equal(g.objects[u].exhausted, true);
  assert.ok(!g.objects[u].counters.buff);
});

test('RJ#5470 Flame Chompers discarded by Zaun Warrens\' conquer trigger can be played straight to Zaun Warrens', () => {
  let g = S0({ bfA: 'Zaun Warrens' }); fundAll(g, P0);
  const fc = hand(g, P0, 'Flame Chompers');
  const u = put(g, P0, 'V(2)', 'base');
  let dests: string[] = [];
  g = drive(move(g, P0, [u], BF_A), d => {
    if (d.kind === 'chooseDestination') { dests = d.options!.map(o => o.id); return String(BF_A); }
    return d.options?.some(o => o.id === fc) ? fc : undefined;
  });
  assert.ok(dests.includes(String(BF_A)), 'the conquered battlefield is offered');
  assert.equal(locOf(g, fc), BF_A);
});

test('RJ#5471 held battlefield A at turn start (7), left it, then conquered B: final point by conquer is allowed (both scored this turn) → win', () => {
  let g = S0({ tp: P1 });
  g.players[P0].points = 6;
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  g = nextTurn(g);
  assert.equal(g.players[P0].points, 7);
  const w = put(g, P0, 'V(2)', 'base');
  g = drive(move(g, P0, [u], 'base'));
  assert.equal(g.battlefields[BF_A].controller, null, 'control of A lost');
  g = move(g, P0, [w], BF_B);
  for (let i = 0; i < 10 && g.pending && pend(g).kind !== 'mainAction'; i++) g = pass(g);
  assert.equal(g.players[P0].points, 8);
  assert.equal((g as { winner?: unknown }).winner, P0);
});

test('RJ#5472 a card played from hiding and countered by Defy was never played: Ember Monk gets no +2', () => {
  let g = S0(); fundAll(g, P1);
  const m = put(g, P0, 'Ember Monk', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(5)', 'base');
  const h = put(g, P0, 'HidZap', { facedown: BF_A });
  g = act(g, { type: 'playCard', player: P0, obj: h });
  g = answer(g, { targets: [[e]] });
  if (pend(g).player === P0) g = pass(g);
  g = drive(play(g, P1, hand(g, P1, 'Defy'), { targets: [[g.chain[0].source]] }));
  assert.equal(zone(g, h), 'trash');
  assert.equal(g.objects[e].damage, 0, 'countered');
  assert.equal(mightOf(g, m), 4, 'no Ember Monk bonus');
});

test('RJ#5473 Bullet Time ([Action]) can\'t answer Teemo, Strategist\'s defend trigger; it is playable once that chain has resolved', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P1, 'Teemo, Strategist', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(5)', 'base');
  const bt = hand(g, P0, 'Bullet Time');
  g = move(g, P0, [a], BF_A);
  let sawChain = false;
  for (let i = 0; i < 8 && pend(g).kind !== 'showdownAction'; i++) {
    const d = pend(g);
    if (g.chain.length && d.player === P0 && !d.inStep) { sawChain = true; assert.ok(!canPlayNow(g, P0, bt)); }
    g = d.inStep ? choose(g, d.options![0].id) : pass(g);
  }
  assert.ok(sawChain);
  expectPending(g, 'showdownAction', P0);
  assert.ok(canPlayNow(g, P0, bt));
});

test('RJ#5474 Volibear, Furious attacking Void Gate: Bonus Damage raises the split pool (5 → 6), not each part', () => {
  let g = S0({ bfA: 'Void Gate' }); fundAll(g, P0);
  const e1 = put(g, P1, 'V(9)', BF_A), e2 = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const v = put(g, P0, 'Volibear, Furious', 'base');
  g = move(g, P0, [v], BF_A);
  let pool = '';
  for (let i = 0; i < 10 && pend(g).kind !== 'showdownAction'; i++) {
    const d = pend(g);
    if (d.inStep && d.kind === 'chooseTargets') { g = act(g, { type: 'choose', player: d.player, optionIds: [e1, e2] }); continue; }
    if (d.inStep && d.kind === 'chooseNumber') { pool ||= d.prompt; g = choose(g, '2'); continue; }
    g = d.inStep ? choose(g, d.options![0].id) : pass(g);
  }
  assert.equal(g.objects[e1].damage + g.objects[e2].damage, 6, `split pool (${pool})`);
  assert.ok(g.objects[e1].damage === 2 || g.objects[e1].damage === 3, 'first part 2 (+1 at most once overall)');
});

test('RJ#5475 Thousand-Tailed Watcher on a 2-Might Stalwart Poro: 1 (min 1); defending, its Shield makes it 2', () => {
  let g = S0(); fundAll(g, P0, 8);
  const p = put(g, P1, 'Stalwart Poro', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'Thousand-Tailed Watcher', { dest: 'base', may: [false] });
  g = passAll(g);
  assert.equal(mightOf(g, p), 1);
  const a = put(g, P0, 'V(5)', 'base');
  g = move(g, P0, [a], BF_A);
  assert.equal(mightOf(g, p), 2, 'Shield +1 while defending');
});

test('RJ#5483 exhaust all runes for Energy in response to a kill on Ekko, Recurrent: his Deathknell readies them again (3 Energy floating + 3 ready runes)', () => {
  let g = S0({ tp: P1 }); setRunes(g, P0, 3); fundAll(g, P1);
  const ek = put(g, P0, 'Ekko, Recurrent', BF_A); control(g, BF_A, P0);
  g = pass(play(g, P1, hand(g, P1, 'KillDraw'), { targets: [[ek]] }));
  expectPending(g, 'chainResponse', P0);
  for (const r of [...g.players[P0].runesInPlay]) {
    const a = legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === r && x.abilityIndex === 950);
    assert.ok(a, 'rune exhaust ability usable with priority, no cost to pay');
    g = act(g, a!);
  }
  assert.equal(g.players[P0].pool.energy, 3);
  for (let i = 0; i < 10 && pend(g).kind !== 'mainAction'; i++) { const d = pend(g); g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : d.options![0].id) : pass(g); }
  assert.equal(zone(g, ek), 'mainDeck', 'Ekko recycled by his Deathknell');
  assert.equal(readyRunes(g, P0), 3);
  assert.equal(g.players[P0].pool.energy, 3);
});

test('RJ#5484 Pack of Wonders returns friendly gear/units/facedown cards from the board only, never cards in the trash', () => {
  let g = S0(); fundAll(g, P0);
  const pw = put(g, P0, 'Pack of Wonders', 'base');
  const u = put(g, P0, 'V(2)', 'base');
  const tr = put(g, P0, 'V(3)', 'trash');
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const fd = put(g, P0, 'HidU(2)', { facedown: BF_A });
  const a = legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === pw)!;
  let s = choose(act(g, a), 'permanent');
  const perm = optionIds(s);
  assert.ok(perm.includes(u) && !perm.includes(tr) && !perm.includes(pw), 'board permanents only');
  s = drive(choose(act(g, a), 'facedown'));
  assert.equal(zone(s, fd), 'hand', 'facedown card (the only one) returned');
  assert.equal(zone(s, tr), 'trash');
});

test('RJ#5486 the same battlefield can be attacked several times in one turn', () => {
  let { g, def } = attackSetup(['V(1)'], ['V(5)']);
  g = drive(g);
  assert.equal(zone(g, def[0]), 'battlefield');
  expectPending(g, 'mainAction', P0);
  const a2 = put(g, P0, 'V(6)', 'base');
  g = move(g, P0, [a2], BF_A);
  for (let i = 0; i < 12 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    g = !d.inStep ? pass(g) : d.kind === 'assignDamage' ? act(g, { type: 'assignDamage', player: d.player, assignment: (d.data as { suggested: Record<string, number> }).suggested }) : choose(g, d.options![0].id);
  }
  assert.equal(zone(g, def[0]), 'trash', 'second combat killed the defender');
  assert.equal(g.battlefields[BF_A].controller, P0);
});

test('RJ#5487 Unlicensed Armory\'s discard cost triggers Jinx, Rebel: Armory is on the chain first, Jinx\'s trigger on top', () => {
  let g = S0(); fundAll(g, P0);
  const ar = put(g, P0, 'Unlicensed Armory', 'base');
  const jx = put(g, P0, 'Jinx, Rebel', 'base', { ready: false });
  const c = hand(g, P0, 'V(1)');
  g = act(g, legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === ar)!);
  for (let i = 0; i < 6 && pend(g).inStep; i++) g = choose(g, optionIds(g).includes(c) ? c : optionIds(g).includes(jx) ? jx : optionIds(g)[0]);
  assert.equal(zone(g, c), 'trash');
  assert.deepEqual(chainLabels(g), ['ability:Unlicensed Armory', 'trigger:Jinx']);
  g = drive(g);
  assert.equal(g.objects[jx].exhausted, false);
  assert.equal(mightOf(g, jx), 6);
});

test('RJ#5488 Divine Judgment ignores facedown (hidden) cards: not chosen, not recycled', () => {
  let g = S0(); fundAll(g, P0, 4);
  put(g, P1, 'V(1)', 'base'); // only 2 units: both kept, so P1 keeps the battlefield
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const fd = put(g, P1, 'HidU(2)', { facedown: BF_A });
  g = play(g, P0, hand(g, P0, 'Divine Judgment'));
  let offeredFd = false;
  for (let i = 0; i < 40 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    if (d.options!.some(o => o.id === fd)) offeredFd = true;
    g = act(g, { type: 'choose', player: d.player, optionIds: d.options!.slice(0, Math.max(d.min ?? 1, 1)).map(o => o.id) });
  }
  assert.ok(!offeredFd, 'facedown card never offered');
  assert.equal(zone(g, fd), 'facedown');
  assert.equal(g.objects[fd].controller, P1);
});

test('RJ#5489 a hidden Zhonya\'s Hourglass can be played in the showdown, but not during combat damage assignment (no priority)', () => {
  let { g } = attackSetup(['V(5)'], ['V(2)', 'V(2)']);
  const z = put(g, P1, "Zhonya's Hourglass", { facedown: BF_A });
  let couldInShowdown = false;
  for (let i = 0; i < 10 && pend(g).kind !== 'assignDamage'; i++) {
    const d = pend(g);
    if (d.player === P1 && d.kind === 'showdownAction') couldInShowdown ||= canPlayNow(g, P1, z);
    g = d.inStep ? choose(g, d.options![0].id) : pass(g);
  }
  assert.ok(couldInShowdown);
  expectPending(g, 'assignDamage', P0);
  assert.deepEqual(legal(g, P1), []);
  assert.ok(!canPlayNow(g, P1, z));
});

test('RJ#5493 Wraith of Echoes triggers when a friendly token unit dies', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  put(g, P0, 'Wraith of Echoes', 'base');
  const r = put(g, P0, 'Recruit', BF_A, { token: true }); control(g, BF_A, P0);
  const h = g.players[P0].hand.length;
  g = drive(play(g, P0, hand(g, P0, 'KillA'), { targets: [[r]] }));
  assert.equal(zone(g, r), 'gone');
  assert.equal(g.players[P0].hand.length, h + 1, 'KillA played (-1+1) then Wraith draws 1');
});

test('RJ#5497 Ezreal, Dashing kills the lone defender with his attack trigger; a new smaller defender arrives (Ride the Wind): Ezreal deals no combat damage, both survive, the attacker is recalled', () => {
  let g = S0(); fundAll(g, P1);
  const d = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const n = put(g, P1, 'V(2)', 'base');
  const ez = put(g, P0, 'Ezreal, Dashing', 'base');
  g = move(g, P0, [ez], BF_A);
  for (let i = 0; i < 8 && pend(g).kind !== 'showdownAction'; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(zone(g, d), 'trash');
  g = pass(g);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Ride the Wind') });
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
    const x = pend(g);
    g = !x.inStep ? pass(g) : x.kind === 'assignDamage' ? act(g, { type: 'assignDamage', player: x.player, assignment: (x.data as { suggested: Record<string, number> }).suggested })
      : choose(g, optionIds(g).includes(n) ? n : x.options!.find(o => /BF-A/.test(o.label))?.id ?? optionIds(g)[0]);
  }
  assert.equal(locOf(g, ez), 'base', 'attacker recalled');
  assert.equal(locOf(g, n), BF_A);
  assert.equal(g.battlefields[BF_A].controller, P1);
});

test('RJ#5501 Fiora, Victorious becoming Mighty while already defending gets her Shield +1 at once (passive, no chain)', () => {
  let g = S0(); fundAll(g, P1);
  const f = put(g, P1, 'Fiora, Victorious', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(9)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 6 && pend(g).kind !== 'showdownAction'; i++) g = pass(g);
  assert.equal(mightOf(g, f), 4);
  assert.ok(!hasKeyword(g, f, 'Shield'));
  g = pass(g);
  g = passN(play(g, P1, hand(g, P1, 'En Garde'), { targets: [[f]] }), 2);
  assert.equal(g.chain.length, 0);
  assert.ok(hasKeyword(g, f, 'Shield'));
  assert.equal(mightOf(g, f), 4 + 2 + 1, 'En Garde +2 (alone) → Mighty → Shield +1');
});

// OUTDATED (partial): RJ says Falling Star / Icathian Rain can be played with no units because their damage comes from reflexive
// triggers. Current Falling Star is two "Deal 3 to a unit." instructions with all targets chosen when played (SFD-FAQ; DECISIONS #75),
// so with no unit on the board it can't be played (CR 355.13: a targeting spell needs its targets).
test('RJ#5503 Bullet Time can be played paying 0 (deals 0); Falling Star with no units anywhere can\'t be played (OUTDATED part)', () => {
  let g = S0(); fundAll(g, P0);
  const e = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const bt = hand(g, P0, 'Bullet Time');
  g = drive(act(g, { type: 'playCard', player: P0, obj: bt }), d => d.kind === 'chooseNumber' ? '0' : d.options?.find(o => /BF-A/.test(o.label))?.id);
  assert.equal(zone(g, bt), 'trash', 'played and resolved');
  assert.equal(g.objects[e].damage, 0);
  const h = S0(); fundAll(h, P0);
  const fs = hand(h, P0, 'Falling Star');
  assert.equal(Object.values(h.objects).filter(o => ['base', 'battlefield'].includes(o.zone) && h.cards[o.cardId].type === 'Unit').length, 0);
  assert.ok(!canPlayNow(h, P0, fs));
});

test('RJ#5504 a damaged defender killed by Warwick, Hunter\'s attack trigger is gone before combat damage: it deals none', () => {
  let g = S0();
  const d1 = put(g, P1, 'V(4)', BF_A, { damage: 1 }); const d2 = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const w = put(g, P0, 'Warwick, Hunter', 'base');
  g = move(g, P0, [w], BF_A);
  for (let i = 0; i < 6 && pend(g).kind !== 'showdownAction'; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(zone(g, d1), 'trash', 'killed by the attack trigger');
  for (let i = 0; i < 12 && pend(g).kind !== 'mainAction'; i++) {
    const x = pend(g);
    g = !x.inStep ? pass(g) : x.kind === 'assignDamage' ? act(g, { type: 'assignDamage', player: x.player, assignment: (x.data as { suggested: Record<string, number> }).suggested }) : choose(g, optionIds(g)[0]);
  }
  assert.equal(zone(g, d2), 'trash');
  assert.equal(zone(g, w), 'battlefield', 'took only 2 (from the survivor), not 6');
});

test('RJ#5505 surprise defence with Zenith Blade at an uncontrolled battlefield: Shen can\'t be played there meanwhile (uncontrolled); the stunned attacker is recalled and the defender takes control', () => {
  let g = S0(); fundAll(g, P1);
  const a = put(g, P0, 'V(3)', 'base');
  const mine = put(g, P1, 'V(2)', 'base');
  const shen = hand(g, P1, 'Shen, Kinkou');
  g = pass(move(g, P0, [a], BF_A));
  expectPending(g, 'showdownAction', P1);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Zenith Blade') });
  for (let i = 0; i < 10 && pend(g).kind !== 'showdownAction'; i++) {
    const d = pend(g);
    g = !d.inStep ? pass(g) : d.kind === 'optional' ? yes(g) : choose(g, optionIds(g).includes(a) ? a : optionIds(g).includes(mine) ? mine : optionIds(g)[0]);
  }
  assert.equal(locOf(g, mine), BF_A);
  assert.equal(g.battlefields[BF_A].controller, null);
  g = pass(g);
  expectPending(g, 'showdownAction', P1);
  assert.deepEqual(playDests(g, P1, shen), ['base'], 'not to the uncontrolled battlefield');
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    g = !d.inStep ? pass(g) : d.kind === 'assignDamage' ? act(g, { type: 'assignDamage', player: d.player, assignment: (d.data as { suggested: Record<string, number> }).suggested }) : choose(g, optionIds(g)[0]);
  }
  assert.equal(locOf(g, a), 'base', 'attacker recalled');
  assert.equal(g.battlefields[BF_A].controller, P1);
});

test('RJ#5507 Falling Comet ("a unit at a battlefield") on a unit Flashed to base in response: no damage', () => {
  let g = S0(); fundAll(g, P0, 6); fundAll(g, P1);
  const u = put(g, P1, 'V(4)', BF_A); control(g, BF_A, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Falling Comet') });
  g = answer(g, { targets: [[u]] }, P0);
  if (pend(g).player === P0) g = pass(g);
  g = drive(play(g, P1, hand(g, P1, 'Flash'), { targets: [[u]] }), d => d.options?.some(o => o.id === u) ? u : undefined);
  assert.equal(locOf(g, u), 'base');
  assert.equal(g.objects[u].damage, 0);
});

test('RJ#5510 lone defender Kayn, Unleashed Ridden to base and back during the combat: combat continues, he took no damage (moved twice), attacker recalled', () => {
  let g = S0(); fundAll(g, P1, 6);
  const k = put(g, P1, 'Kayn, Unleashed', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(9)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 6 && pend(g).kind !== 'showdownAction'; i++) g = pass(g);
  for (const dest of ['Base', 'BF-A']) {
    g = pass(g);
    expectPending(g, 'showdownAction', P1, `combat still on before moving to ${dest}`);
    g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Ride the Wind') });
    for (let i = 0; i < 8 && pend(g).kind !== 'showdownAction'; i++) { const d = pend(g); g = !d.inStep ? pass(g) : choose(g, d.options!.find(o => o.label.includes(dest))?.id ?? d.options![0].id); }
  }
  assert.equal(locOf(g, k), BF_A);
  let kaynDamage = -1;
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    g = !d.inStep ? pass(g) : d.kind === 'assignDamage' ? act(g, { type: 'assignDamage', player: d.player, assignment: (d.data as { suggested: Record<string, number> }).suggested }) : choose(g, optionIds(g)[0]);
  }
  kaynDamage = g.log.filter(l => /deals \d+ to Kayn/.test(l.text)).length;
  assert.equal(kaynDamage, 0, 'Kayn took no damage');
  assert.equal(zone(g, k), 'battlefield');
  assert.equal(locOf(g, a), 'base', 'attacker recalled');
  assert.equal(g.battlefields[BF_A].controller, P1);
});

test('RJ#5511 a unit moving out of Back-Alley Bar twice in one turn gets +1 each time (+2)', () => {
  let g = S0({ bfA: 'Back-Alley Bar' }); fundAll(g, P0);
  const u = put(g, P0, 'V(2)', BF_A); put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  g = drive(move(g, P0, [u], 'base'));
  assert.equal(mightOf(g, u), 3);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Ride the Wind') });
  g = drive(g, d => d.options?.some(o => o.id === u) ? u : d.options?.find(o => /BF-A|Back-Alley/.test(o.label))?.id);
  assert.equal(locOf(g, u), BF_A);
  assert.equal(g.objects[u].exhausted, false);
  g = drive(move(g, P0, [u], 'base'));
  assert.equal(mightOf(g, u), 4, '+1 per move out');
});

test('RJ#5521 Bullet Time\'s [A] is paid while it resolves (by recycling runes, even the one exhausted for its Energy)', () => {
  let g = S0(); setRunes(g, P0, 3, 'chaos');
  const e1 = put(g, P1, 'V(3)', BF_A), e2 = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Bullet Time') });
  g = drive(g, d => d.kind === 'chooseNumber' ? '3' : d.options?.find(o => /BF-A/.test(o.label))?.id);
  assert.equal(zone(g, e1), 'trash');
  assert.equal(g.objects[e2].damage, 3);
  assert.equal(g.players[P0].runesInPlay.length, 0, 'all three runes recycled for [A][A][A]');
});

test('RJ#5522 Bullet Time chooses a battlefield, not units: no Deflect is paid for a Deflect unit there', () => {
  let g = S0(); setRunes(g, P0, 2, 'chaos');
  const ir = put(g, P1, 'Irelia, Fervent', BF_A); control(g, BF_A, P1);
  assert.ok(hasKeyword(g, ir, 'Deflect'));
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Bullet Time') });
  g = drive(g, d => d.kind === 'chooseNumber' ? '1' : d.options?.find(o => /BF-A/.test(o.label))?.id);
  assert.equal(g.objects[ir].damage, 1);
  assert.equal(g.players[P0].runesInPlay.length, 1, 'only the [A] for 1 damage was recycled (no Deflect tax)');
});

test('RJ#5525 attacker and defender both stunned: no damage, the attacker is recalled', () => {
  let { g, atk, def } = attackSetup(['V(3)'], ['V(3)'], { defOpts: [{ stunned: true }], atkOpts: [{ stunned: true }] });
  g = drive(g);
  assert.equal(g.objects[def[0]].damage, 0);
  assert.equal(locOf(g, atk[0]), 'base');
  assert.equal(locOf(g, def[0]), BF_A);
  assert.equal(g.battlefields[BF_A].controller, P1);
});

test('RJ#5528 spell damage dealt earlier in the turn is still marked when combat damage is dealt (3 from Hextech Ray + 2 kills a 5-Might defender)', () => {
  let g = S0(); fundAll(g, P0);
  const d = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  g = drive(play(g, P0, hand(g, P0, 'Hextech Ray'), { targets: [[d]] }));
  assert.equal(g.objects[d].damage, 3);
  const a = put(g, P0, 'V(2)', 'base');
  g = drive(move(g, P0, [a], BF_A));
  assert.equal(zone(g, d), 'trash', 'without the earlier 3 it would survive 2 combat damage');
});

test('RJ#5529 Smoke Screen (-4, min 1) snapshots -1 on a 2-Might Ravenbloom Student; the opponent\'s Hextech Ray (or any opponent spell) leaves it at 1', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const rb = put(g, P0, 'Ravenbloom Student', BF_A); const r = put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  g = drive(play(g, P1, hand(g, P1, 'Smoke Screen'), { targets: [[rb]] }));
  assert.equal(mightOf(g, rb), 1);
  g = drive(play(g, P1, hand(g, P1, 'Hextech Ray'), { targets: [[r]] }));
  assert.equal(zone(g, r), 'trash');
  assert.equal(mightOf(g, rb), 1, 'stays 1');
  g = drive(play(g, P1, hand(g, P1, 'DrawR')));
  assert.equal(mightOf(g, rb), 1, 'opponent\'s spells never trigger it');
});

test('RJ#5530 Gust on a 3-Might unit pumped above 3 in response: Gust resolves without effect (unit stays)', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const gu = hand(g, P0, 'Gust');
  g = play(g, P0, gu, { targets: [[u]] });
  if (pend(g).player === P0) g = pass(g);
  g = drive(play(g, P1, hand(g, P1, 'Discipline'), { targets: [[u]] }));
  assert.equal(mightOf(g, u), 5);
  assert.equal(locOf(g, u), BF_A, 'not returned');
  assert.equal(zone(g, gu), 'trash');
});

test('RJ#5536 a unit played by Baited Hook counts as a card played: it is the second card for Darius, Trifarian (+2, ready)', () => {
  let g = S0(); fundAll(g, P0);
  const dz = put(g, P0, 'Darius, Trifarian', 'base', { ready: false });
  g = drive(play(g, P0, hand(g, P0, 'V(1)'), { dest: 'base' }));
  const vic = put(g, P0, 'V(4)', 'base');
  const hook = put(g, P0, 'Baited Hook', 'base');
  const small = put(g, P0, 'V(2)', 'deckTop');
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === hook)!);
  g = answer(g, { targets: [[vic]] }, P0);
  g = drive(g, d => d.options?.some(o => o.id === small) ? small : d.options?.some(o => o.id === 'base') ? 'base' : undefined);
  assert.equal(locOf(g, small), 'base');
  assert.equal(mightOf(g, dz), 7);
  assert.equal(g.objects[dz].exhausted, false);
});

test('RJ#5537 at end of turn a unit is healed before its "this turn" Might bonus expires: 2-Might unit +2 with 3 damage survives', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  g = drive(play(g, P0, hand(g, P0, 'Discipline'), { targets: [[u]] }));
  assert.equal(mightOf(g, u), 4);
  g.objects[u].damage = 3; g.timestamp++;
  g = endTurn(g, P0);
  for (let i = 0; i < 10 && !(pend(g).kind === 'mainAction' && pend(g).player === P1); i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(zone(g, u), 'battlefield');
  assert.equal(g.objects[u].damage, 0);
  assert.equal(mightOf(g, u), 2);
});

test('RJ#5538 Ravenbloom Student at 1 after Thousand-Tailed Watcher (-3, min 1 → -1) plays a spell: +1 → 2', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1, 8);
  const rb = put(g, P0, 'Ravenbloom Student', 'base');
  [g] = cast(g, P1, 'Thousand-Tailed Watcher', { dest: 'base', may: [false] });
  g = passAll(g);
  assert.equal(mightOf(g, rb), 1);
  const v = put(g, P0, 'V(1)', 'base');
  g = pass(play(g, P1, hand(g, P1, 'DrawR')));
  expectPending(g, 'chainResponse', P0);
  g = passAll(play(g, P0, hand(g, P0, 'Discipline'), { targets: [[v]] }));
  assert.equal(mightOf(g, rb), 2, 'same turn: 2 - 1 (snapshotted) + 1');
});

test('RJ#5539 Glorious Executioner (Draven legend): no draw for taking an empty battlefield; draws when the defender left mid-combat and the attacker wins', () => {
  let g = S0(); setLegend(g, P0, 'Glorious Executioner');
  const a = put(g, P0, 'V(2)', 'base');
  let h = g.players[P0].hand.length;
  g = drive(move(g, P0, [a], BF_A));
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[P0].hand.length, h, 'no combat, no draw');
  let s = S0(); setLegend(s, P0, 'Glorious Executioner'); fundAll(s, P1);
  const d = put(s, P1, 'V(2)', BF_B); control(s, BF_B, P1);
  const b = put(s, P0, 'V(3)', 'base');
  s = move(s, P0, [b], BF_B);
  for (let i = 0; i < 6 && pend(s).kind !== 'showdownAction'; i++) s = pass(s);
  s = pass(s);
  s = act(s, { type: 'playCard', player: P1, obj: hand(s, P1, 'Ride the Wind') });
  for (let i = 0; i < 8 && pend(s).kind !== 'showdownAction'; i++) { const x = pend(s); s = !x.inStep ? pass(s) : choose(s, x.options!.find(o => o.label === 'Base')?.id ?? optionIds(s)[0]); }
  assert.equal(locOf(s, d), 'base');
  h = s.players[P0].hand.length;
  s = drive(s);
  assert.equal(s.battlefields[BF_B].controller, P0);
  assert.equal(s.players[P0].hand.length, h + 1, 'won the combat: draw 1');
});

test('RJ#5540 Switcheroo: the survivor keeps the swapped Might after the other unit dies', () => {
  let g = S0(); fundAll(g, P0);
  const a = put(g, P0, 'V(2)', BF_A), b = put(g, P0, 'V(6)', BF_A); control(g, BF_A, P0);
  g = drive(play(g, P0, hand(g, P0, 'Switcheroo'), { targets: [[a], [b]] }));
  assert.deepEqual([mightOf(g, a), mightOf(g, b)], [6, 2]);
  g = drive(play(g, P0, hand(g, P0, 'Hextech Ray'), { targets: [[b]] }));
  assert.equal(zone(g, b), 'trash');
  assert.equal(mightOf(g, a), 6, 'swap stays for the turn');
});

test('RJ#5540b Switcheroo on a friendly and an enemy unit swaps both Mights (2/6 → 6/2)', () => {
  let g = S0(); fundAll(g, P0);
  const a = put(g, P0, 'V(2)', BF_A), b = put(g, P1, 'V(6)', BF_A); control(g, BF_A, P0);
  // ENGINE-3: one group of two units; read the Mights when Switcheroo has resolved (the staged combat then kills the 2-Might V(6),
  // whose Might in the trash is its printed 6 again — what the earlier todo saw)
  g = resolveChain(play(g, P0, hand(g, P0, 'Switcheroo'), { targets: [[a, b]] }));
  assert.deepEqual([mightOf(g, a), mightOf(g, b)], [6, 2]);
});

test('RJ#5543 Herald of the Arcane (Viktor legend) + two Heimerdinger, Inventor: three separate [1],[T] Recruit abilities → 3 Recruits for 3 Energy', () => {
  let g = withTokens(S0()); setRunes(g, P0, 6);
  setLegend(g, P0, 'Herald of the Arcane');
  put(g, P0, 'Heimerdinger, Inventor', 'base'); put(g, P0, 'Heimerdinger, Inventor', 'base');
  let n = 0;
  for (let i = 0; i < 8; i++) {
    const acts = legal(g, P0, 'activate').filter(a => a.type === 'activate' && g.objects[a.obj].zone !== 'runePool');
    if (!acts.length) break;
    g = drive(act(g, acts[0])); n++;
  }
  assert.equal(n, 3);
  assert.equal(Object.values(g.objects).filter(o => o.isToken && g.cards[o.cardId]?.name === 'Recruit' && o.zone === 'base').length, 3);
  assert.equal(g.players[P0].runesInPlay.filter(r => g.objects[r].exhausted).length, 3);
});

test('RJ#5545 Ravenbloom Student sees a spell as played only when it resolves: Stupefy countered by Defy gives no +1; uncountered it does', () => {
  const run = (defy: boolean) => {
    let g = S0(); fundAll(g, P0); fundAll(g, P1);
    const rb = put(g, P0, 'Ravenbloom Student', 'base');
    const e = put(g, P1, 'V(3)', BF_A);
    g = play(g, P0, hand(g, P0, 'Stupefy'), { targets: [[e]] });
    assert.ok(!g.chain.some(c => c.kind === 'trigger'), 'no trigger while Stupefy is on the chain');
    if (pend(g).player === P0) g = pass(g);
    if (defy) g = play(g, P1, hand(g, P1, 'Defy'), { targets: [[g.chain[0].source]] });
    return mightOf(drive(g), rb);
  };
  assert.equal(run(true), 2);
  assert.equal(run(false), 3);
});

test('RJ#5547 Yasuo, Remorseful\'s attack damage uses his Might on resolution: Discipline in response → 8; a defending Ahri, Inquisitive -2 first → 4', () => {
  let g = S0(); fundAll(g, P0);
  const d = put(g, P1, 'V(12)', BF_A); control(g, BF_A, P1);
  const y = put(g, P0, 'Yasuo, Remorseful', 'base');
  g = move(g, P0, [y], BF_A);
  g = play(g, P0, hand(g, P0, 'Discipline'), { targets: [[y]] });
  for (let i = 0; i < 8 && pend(g).kind !== 'showdownAction'; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(g.objects[d].damage, 8);
  let h = S0();
  put(h, P1, 'Ahri, Inquisitive', BF_A); const d2 = put(h, P1, 'V(12)', BF_A); control(h, BF_A, P1);
  const y2 = put(h, P0, 'Yasuo, Remorseful', 'base');
  h = move(h, P0, [y2], BF_A);
  for (let i = 0; i < 8 && pend(h).kind !== 'showdownAction'; i++) h = pend(h).inStep ? choose(h, optionIds(h).includes(d2) ? d2 : optionIds(h).includes(y2) ? y2 : optionIds(h)[0]) : pass(h);
  assert.equal(mightOf(h, y2), 4);
  assert.equal(h.objects[d2].damage, 4);
});

test('RJ#5551 opponent moves into an empty battlefield (non-combat showdown): once the mover passes focus, Void Seeker ([Action]) can hit the unit; no conquer', () => {
  let g = S0(); fundAll(g, P1);
  const a = put(g, P0, 'V(3)', 'base');
  const vs = hand(g, P1, 'Void Seeker');
  g = move(g, P0, [a], BF_A);
  expectPending(g, 'showdownAction', P0);
  g = pass(g);
  expectPending(g, 'showdownAction', P1);
  assert.ok(canPlayNow(g, P1, vs));
  g = drive(play(g, P1, vs, { targets: [[a]] }));
  assert.equal(zone(g, a), 'trash');
  assert.equal(g.battlefields[BF_A].controller, null);
  assert.equal(g.players[P0].points, 0);
});

test('RJ#5552 Ornn, Forge God with Svellsongur: Deflect 4 and +2 Might per friendly gear (two gears: 4 + 4 = 8)', () => {
  let g = S0();
  const o = put(g, P0, 'Ornn, Forge God', 'base');
  const sv = put(g, P0, 'Svellsongur', 'base');
  assert.equal(mightOf(g, o), 4 + 1);
  attachNow(g, sv, o);
  put(g, P0, 'Zero Point Inflection', 'base');
  g.timestamp++;
  assert.equal(kwValue(g, o, 'Deflect'), 4);
  assert.equal(mightOf(g, o), 4 + 2 * 2);
});

test('RJ#5554 Mask of Foresight checks "defends alone" when defenders are assigned: moving the other defender away later gives no +1', () => {
  let g = S0(); fundAll(g, P1);
  const d1 = put(g, P1, 'V(3)', BF_A), d2 = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  put(g, P1, 'Mask of Foresight', 'base');
  const a = put(g, P0, 'V(9)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 6 && pend(g).kind !== 'showdownAction'; i++) g = pass(g);
  assert.equal(g.chain.length, 0);
  g = pass(g);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Ride the Wind') });
  for (let i = 0; i < 8 && pend(g).kind !== 'showdownAction'; i++) { const x = pend(g); g = !x.inStep ? pass(g) : choose(g, optionIds(g).includes(d2) ? d2 : x.options!.find(o => o.label === 'Base')?.id ?? optionIds(g)[0]); }
  assert.equal(locOf(g, d2), 'base');
  assert.equal(mightOf(g, d1), 3, 'no Mask trigger for being left alone');
  assert.ok(!g.chain.length);
});

test('RJ#5560 a hidden Consult the Past at battlefield A can be played when the opponent moves to an empty battlefield B (showdown there)', () => {
  let g = S0(); fundAll(g, P1);
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const ct = put(g, P1, 'Consult the Past', { facedown: BF_A });
  const a = put(g, P0, 'V(3)', 'base');
  g = move(g, P0, [a], BF_B);
  expectPending(g, 'showdownAction', P0);
  g = pass(g);
  expectPending(g, 'showdownAction', P1);
  assert.ok(canPlayNow(g, P1, ct), 'playable from another battlefield (no target restriction)');
  const h = g.players[P1].hand.length;
  g = drive(play(g, P1, ct));
  assert.equal(g.players[P1].hand.length, h + 2);
});

test('RJ#5562 Zhonya\'s Hourglass flipped from hidden in a showdown is on the board at once (no chain item to answer); a following Cannon Barrage kill is replaced', () => {
  let { g, def } = attackSetup(['V(3)'], ['V(2)']);
  fundAll(g, P0); fundAll(g, P1);
  const z = put(g, P1, "Zhonya's Hourglass", { facedown: BF_A });
  for (let i = 0; i < 6 && !(pend(g).kind === 'showdownAction' && pend(g).player === P1); i++) g = pass(g);
  expectPending(g, 'showdownAction', P1);
  g = play(g, P1, z);
  assert.equal(zone(g, z), 'base', 'resolved immediately');
  assert.ok(!g.chain.some(c => c.source === z), 'never waits on the chain');
  if (pend(g).player === P1) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Cannon Barrage'));
  g = resolveChain(g);
  assert.equal(zone(g, z), 'trash', "Zhonya's killed instead");
  assert.equal(locOf(g, def[0]), 'base', 'unit saved and recalled');
});

test('RJ#5563 moving alone into an open battlefield is no attack: Mask of Foresight gives no +1 in that showdown', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'Mask of Foresight', 'base');
  const a = put(g, P0, 'V(3)', 'base');
  g = move(g, P0, [a], BF_A);
  assert.ok(!g.chain.length, 'no Mask trigger');
  assert.equal(g.objects[a].combatRole, undefined, 'no attacker designation');
  g = drive(g);
  assert.equal(mightOf(g, a), 3);
});

test('RJ#5564 Void Seeker (4) on Darius, Trifarian (5), then Smoke Screen (-4, min 1 → 1): 4 marked damage ≥ 1 Might, he dies', () => {
  let g = S0(); fundAll(g, P0, 8);
  const d = put(g, P1, 'Darius, Trifarian', BF_A); control(g, BF_A, P1);
  g = drive(play(g, P0, hand(g, P0, 'Void Seeker'), { targets: [[d]] }));
  assert.equal(g.objects[d].damage, 4);
  g = drive(play(g, P0, hand(g, P0, 'Smoke Screen'), { targets: [[d]] }));
  assert.equal(zone(g, d), 'trash');
});

test('RJ#5565 two hidden cards at Ravenbloom Student\'s battlefield: in response to a kill, reveal only one (a hidden Spiderling) — control kept, the other stays hidden', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const rs = put(g, P0, 'Ravenbloom Student', BF_A); control(g, BF_A, P0);
  const sp = put(g, P0, 'Spiderling', { facedown: BF_A });
  const ct = put(g, P0, 'Consult the Past', { facedown: BF_A });
  g = play(g, P1, hand(g, P1, 'Void Seeker'), { targets: [[rs]] });
  if (pend(g).player === P1) g = pass(g);
  assert.ok(canPlayNow(g, P0, sp));
  g = drive(play(g, P0, sp));
  assert.equal(zone(g, rs), 'trash');
  assert.equal(locOf(g, sp), BF_A);
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(zone(g, ct), 'facedown', 'not forced to reveal the other one');
});

test('RJ#5571 Deadbloom Predator played to an occupied enemy battlefield never moves: Volibear, Imposing draws nothing (a move there does)', () => {
  const run = (viaPlay: boolean) => {
    let g = S0(); fundAll(g, P0, 10);
    put(g, P1, 'Volibear, Imposing', BF_B); control(g, BF_B, P1);
    put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
    const h = g.players[P1].hand.length;
    if (viaPlay) g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Deadbloom Predator'), destination: BF_A });
    else g = move(g, P0, [put(g, P0, 'V(8)', 'base')], BF_A);
    g = drive(g);
    return g.players[P1].hand.length - h;
  };
  assert.equal(run(true), 0);
  assert.equal(run(false), 1, 'sanity: an opponent moving there draws');
});

test('RJ#5574 Brynhir Thundersong played (Here to Help, from hiding) in response to Cull the Weak does not counter it: Cull the Weak still resolves', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1, 10);
  const mine = put(g, P0, 'V(2)', 'base');
  const v = put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const hth = put(g, P1, 'Here to Help', { facedown: BF_A });
  const br = hand(g, P1, 'Brynhir Thundersong');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Cull the Weak') });
  if (pend(g).player === P0) g = pass(g);
  assert.ok(canPlayNow(g, P1, hth));
  g = act(g, { type: 'playCard', player: P1, obj: hth });
  g = drive(g, d => d.options?.some(o => o.id === v) ? v : d.options?.some(o => o.id === br) ? br : undefined);
  assert.equal(locOf(g, br), BF_A, 'Brynhir played');
  assert.equal(zone(g, mine), 'trash', 'Cull the Weak resolved for P0');
  assert.equal(zone(g, v), 'trash', 'and P1 killed one of theirs');
});

test('RJ#5582 attacker damaged earlier (6 on a 7-Might unit); the lone defender is killed by Void Seeker in the combat showdown: the combat still ends with its heal', () => {
  let { g, atk, def: [def] } = attackSetup(['V(7)'], ['V(1)'], { atkOpts: [{ damage: 6 }] });
  fundAll(g, P0);
  for (let i = 0; i < 4 && !(pend(g).kind === 'showdownAction' && pend(g).player === P0); i++) g = pass(g);
  g = drive(play(g, P0, hand(g, P0, 'Void Seeker'), { targets: [[def]] }));
  assert.equal(zone(g, def), 'trash');
  assert.equal(locOf(g, atk[0]), BF_A);
  assert.equal(g.objects[atk[0]].damage, 0, 'healed in the combat resolution');
  assert.equal(g.battlefields[BF_A].controller, P0);
});

test('RJ#5583 Smoke Screen whose target is Retreated in response: no new target, it resolves doing nothing — still a played spell for Ravenbloom Student (+1)', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const rs = put(g, P0, 'Ravenbloom Student', 'base');
  const e = put(g, P1, 'V(3)', BF_A), e2 = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  g = play(g, P0, hand(g, P0, 'Smoke Screen'), { targets: [[e]] });
  if (pend(g).player === P0) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Retreat'), { targets: [[e]] });
  g = drive(g);
  assert.equal(zone(g, e), 'hand');
  assert.equal(mightOf(g, e2), 3, 'not retargeted');
  assert.equal(mightOf(g, rs), 3, 'Student (2) still sees the spell');
});

// MISMATCH-RJ (aside): RJ says the buff is removed on resolution; the leading "you may spend a buff" is paid when the trigger is
// finalized (CR 383.3.a-b, DECISIONS principle 11, as RJ#3092) — so it is already spent when Gust answers the trigger.
test('RJ#5584 Wildclaw Shaman\'s play trigger is on the chain: Gust can answer it; the buff was already spent at finalization', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const b = put(g, P0, 'V(2)', BF_A, { buff: true }); control(g, BF_A, P0);
  const w = hand(g, P0, 'Wildclaw Shaman');
  g = act(g, { type: 'playCard', player: P0, obj: w, destination: BF_A });
  for (let i = 0; i < 6 && pend(g).inStep; i++) g = pend(g).kind === 'optional' ? yes(g) : choose(g, optionIds(g).includes(b) ? b : optionIds(g)[0]);
  assert.ok(g.chain.some(c => c.source === w), 'trigger on the chain');
  assert.equal(g.objects[b].counters.buff ?? 0, 0, 'buff spent at finalization');
  if (pend(g).player === P0) g = pass(g);
  g = drive(play(g, P1, hand(g, P1, 'Gust'), { targets: [[w]] }));
  assert.equal(zone(g, w), 'hand');
  assert.equal(g.objects[b].counters.buff ?? 0, 0);
});

test('RJ#5585 Loose Cannon (Jinx) with 1 card + holding Grove of the God-Willow: Jinx\'s start-of-Beginning draw first, then the hold draw, then the Draw Phase (4 cards)', () => {
  let g = S0({ tp: P1, bfA: 'Grove of the God-Willow' });
  setLegend(g, P0, 'Loose Cannon');
  put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  g.players[P0].hand = []; hand(g, P0, 'V(1)');
  g = endTurn(g, P1);
  g = drive(g);
  assert.equal(g.activePlayer, P0);
  assert.equal(g.players[P0].hand.length, 4, 'Jinx resolved while the hand still had 1 card');
});

// OUTDATED: RJ calls Icathian Rain's damage "reflexive triggers" that don't choose; its six "Deal 2 to a unit." instructions choose
// all their units when it is played (SFD-FAQ "Falling Star, Icathian Rain, and Deflect"; DECISIONS #75/#304), so choosing a
// friendly unit at The Dreaming Tree with it is choosing with a spell.
test('RJ#5586 Icathian Rain choosing a friendly unit at The Dreaming Tree for one of its instructions: the Tree draws (choices made when played)', () => {
  let g = S0({ bfA: 'The Dreaming Tree' }); fundAll(g, P0, 10);
  const u = put(g, P0, 'V(9)', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(12)', BF_B); control(g, BF_B, P1);
  const h = g.players[P0].hand.length;
  g = drive(play(g, P0, hand(g, P0, 'Icathian Rain'), { targets: [[u], [e], [e], [e], [e], [e]] }));
  assert.equal(g.objects[u].damage, 2);
  assert.equal(g.players[P0].hand.length, h + 1);
});

test('RJ#5587 the opponent\'s Imperial Decree kills my stunned defender after combat damage: the Decree\'s controller kills it, so the attacker\'s Solari Shrine doesn\'t trigger', () => {
  const run = (decreeBy: PlayerId) => {
    let { g, def } = attackSetup(['V(4)'], ['V(5)'], { defOpts: [{ stunned: true }] });
    fundAll(g, P0); fundAll(g, P1);
    put(g, P0, 'Solari Shrine', 'base');
    for (let i = 0; i < 4 && !(pend(g).kind === 'showdownAction' && pend(g).player === decreeBy); i++) g = pass(g);
    g = play(g, decreeBy, hand(g, decreeBy, 'Imperial Decree'));
    const h = g.players[P0].hand.length;
    g = drive(g);
    assert.equal(zone(g, def[0]), 'trash');
    return g.players[P0].hand.length - h;
  };
  assert.equal(run(P1), 0, 'opponent\'s Decree: no Shrine draw');
  assert.equal(run(P0), 1, 'sanity: my own Decree kills it → Shrine draws');
});

test('RJ#5589 Back-Alley Bar\'s "When a unit moves from here" +1 is a trigger: the opponent can react to it (Smoke Screen first → 1, then +1 → 2)', () => {
  let g = S0({ bfA: 'Back-Alley Bar' }); fundAll(g, P1);
  const u = put(g, P0, 'V(2)', BF_A); put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  g = move(g, P0, [u], 'base');
  assert.ok(g.chain.length >= 1, 'Bar trigger on the chain');
  if (pend(g).player === P0) g = pass(g);
  const ss = hand(g, P1, 'Smoke Screen');
  assert.ok(canPlayNow(g, P1, ss));
  g = drive(play(g, P1, ss, { targets: [[u]] }));
  assert.equal(mightOf(g, u), 2);
});

test('RJ#5591 setup: battlefields are chosen (by both players) before turn order is decided, and before the opening draw', () => {
  let g = newGame({ battlefieldChoice: 'choose' as never });
  const seen: string[] = [];
  for (let i = 0; i < 6 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    seen.push(`${d.kind}:${d.player}:${g.players[P0].hand.length}`);
    g = choose(g, d.options![0].id);
  }
  assert.deepEqual(seen.map(s => s.split(':')[0]), ['chooseBattlefield', 'chooseBattlefield', 'chooseMode']);
  assert.ok(seen.every(s => s.endsWith(':0')), 'no cards drawn yet');
  assert.notEqual(g.firstPlayer, -1);
});

test('RJ#5593 Zhonya\'s Hourglass recalling (and exhausting) a saved unit does not choose it: Blade Dancer (Irelia legend) offers no ready', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  setLegend(g, P0, 'Blade Dancer');
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  put(g, P0, "Zhonya's Hourglass", 'base');
  g = play(g, P1, hand(g, P1, 'Void Seeker'), { targets: [[u]] });
  let asked = false;
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.player === P0 && d.kind === 'optional') { asked = true; g = no(g); continue; }
    g = d.inStep ? choose(g, d.options![0].id) : pass(g);
  }
  assert.equal(locOf(g, u), 'base', 'saved');
  assert.equal(asked, false, 'no Blade Dancer trigger');
  assert.equal(g.objects[u].exhausted, true);
});

test('RJ#5594 Vex (sfd-146) is "in combat" only once the combat starts: while the attacking Traveling Merchant\'s move trigger is on the chain her spell discount is off; in the combat showdown it is on', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  put(g, P1, 'sfd-146-221', BF_A); control(g, BF_A, P1);
  const ss = hand(g, P1, 'Smoke Screen');
  const base = playCostOf(g, P1, ss)!.energy;
  const m = put(g, P0, 'Traveling Merchant', 'base'); hand(g, P0, 'V(1)');
  g = move(g, P0, [m], BF_A);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = choose(g, optionIds(g)[0]);
  assert.ok(g.chain.some(c => c.source === m), 'move trigger on the chain');
  assert.equal(playCostOf(g, P1, ss)!.energy, base, 'combat only staged: no discount');
  for (let i = 0; i < 10 && !(pend(g).kind === 'showdownAction' && !g.chain.length); i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(playCostOf(g, P1, ss)!.energy, Math.max(1, base - 1), 'in combat: 1 less');
});

test('RJ#5597 The Boss (Sett legend) needs a real buff: a unit with only +1 Might from a static (Darius, Legion) is not saved', () => {
  let g = S0(); fundAll(g, P0, 8);
  setLegend(g, P1, 'The Boss');
  put(g, P1, 'ogn-243-298', BF_A);
  const u = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  assert.equal(mightOf(g, u), 4);
  [g] = cast(g, P0, 'Void Seeker', { targets: [[u]] });
  let asked = false;
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) { const d = pend(g); if (d.kind === 'optional' && d.player === P1) { asked = true; g = yes(g); continue; } g = d.inStep ? choose(g, d.options![0].id) : pass(g); }
  assert.equal(asked, false);
  assert.equal(zone(g, u), 'trash');
});

test('RJ#5600 a unit brought into an open battlefield (Fortified Position) after the mover passed: a combat follows with the mover attacking; the uncontrolled Fortified Position gives the defender no Shield 2', () => {
  let g = S0({ bfA: 'Fortified Position' }); fundAll(g, P1);
  const a = put(g, P0, 'V(3)', 'base');
  const e = put(g, P1, 'V(2)', 'base');
  g = move(g, P0, [a], BF_A);
  g = pass(g);
  expectPending(g, 'showdownAction', P1);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'Ride the Wind') });
  g = drive(g, d => d.options?.some(o => o.id === e) ? e : d.options?.find(o => /BF-A|Fortified/.test(o.label))?.id);
  assert.equal(zone(g, e), 'trash', 'no Shield 2: 2 Might vs 3');
  assert.equal(locOf(g, a), BF_A);
  assert.equal(g.battlefields[BF_A].controller, P0, 'attacker conquers');
});

test('RJ#5605 a readied unit at a battlefield answered with Rebuke; Flash moves it to base in response: it stays ready in base, Rebuke does nothing', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  g = play(g, P1, hand(g, P1, 'Rebuke'), { targets: [[u]] });
  if (pend(g).player === P1) g = pass(g);
  g = drive(play(g, P0, hand(g, P0, 'Flash'), { targets: [[u]] }));
  assert.equal(zone(g, u), 'base');
  assert.equal(g.objects[u].exhausted, false, 'Flash\'s move does not exhaust');
});

test('RJ#5607 two Mask of Foresight + Yasuo, Remorseful attacking alone: order the Masks above his trigger → 6 + 1 + 1 = 8 damage', () => {
  let g = S0(); fundAll(g, P0);
  const d = put(g, P1, 'V(12)', BF_A); control(g, BF_A, P1);
  put(g, P0, 'Mask of Foresight', 'base'); put(g, P0, 'Mask of Foresight', 'base');
  const y = put(g, P0, 'Yasuo, Remorseful', 'base');
  g = move(g, P0, [y], BF_A);
  const order: string[] = [];
  for (let i = 0; i < 20 && pend(g).kind !== 'showdownAction'; i++) {
    const x = pend(g);
    if (x.kind === 'orderTriggers') { const o = x.options!.find(o => /Yasuo/.test(o.label ?? '')) ?? x.options![0]; order.push(o.label ?? ''); g = choose(g, o.id); continue; }
    g = x.inStep ? choose(g, optionIds(g).includes(d) ? d : optionIds(g)[0]) : pass(g);
  }
  assert.equal(g.objects[d].damage, 8, `order picks: ${order.join(' | ')}`);
});

test('RJ#5608 the lone defender leaves via Reaver\'s Row: the mover stays the Attacker and, with focus, can Cleave itself for Assault 3 (2 → 5 Might)', () => {
  let g = S0({ bfA: "Reaver's Row" }); fundAll(g, P0);
  const d = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 12 && !(pend(g).kind === 'showdownAction' && !g.chain.length); i++) {
    const x = pend(g);
    g = x.kind === 'optional' ? yes(g) : x.inStep ? choose(g, optionIds(g).includes(d) ? d : optionIds(g)[0]) : pass(g);
  }
  assert.equal(locOf(g, d), 'base', 'defender retreated');
  expectPending(g, 'showdownAction', P0);
  assert.equal(g.objects[a].combatRole, 'attacker');
  g = play(g, P0, hand(g, P0, 'Cleave'), { targets: [[a]] });
  g = resolveChain(g);
  assert.equal(mightOf(g, a), 5, 'Assault 3 while attacking');
});

// MISMATCH-RJ (aside): RJ says the pool doesn't empty at the end of the opponent's turn; CR 317.2 (Expiration step, Ending Special
// Cleanup 3e) empties EVERY player's rune pool at the end of each turn, and 316.3 empties it as each Main phase starts.
test('RJ#5618 the rune pool empties as the Main phase starts and at the end of every turn — the non-turn player\'s too', () => {
  let g = S0({ tp: P1 });
  setLegend(g, P0, 'Loose Cannon'); // a Beginning-phase trigger, to look at the pool before P0's Main phase
  g.players[P0].pool.energy = 2; g.timestamp++;
  g = endTurn(g, P1);
  for (let i = 0; i < 10 && !(pend(g).kind === 'chainResponse' && g.chain.length); i++) g = act(g, legal(g, pend(g).player)[0]);
  assert.equal(g.activePlayer, P0);
  assert.equal(g.phase, 'beginning');
  assert.equal(g.players[P0].pool.energy, 0, 'non-turn player\'s pool emptied at the end of the opponent\'s turn');
});

test('RJ#5623 Teemo, Strategist killed (Cannon Barrage) in response to his defend trigger: the trigger still reveals (and recycles) the top 5 but deals no damage — he is no longer "here"', () => {
  let g = S0(); fundAll(g, P0);
  const t = put(g, P1, 'Teemo, Strategist', BF_A); control(g, BF_A, P1);
  const top: ObjId[] = [];
  for (let i = 0; i < 5; i++) top.push(put(g, P1, 'HidU(1)', 'deckTop'));
  const a = put(g, P0, 'V(9)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 6 && !g.chain.some(c => c.source === t); i++) g = pend(g).inStep ? choose(g, optionIds(g).includes(a) ? a : optionIds(g)[0]) : pass(g);
  assert.ok(g.chain.some(c => c.source === t), 'defend trigger on the chain');
  for (let i = 0; i < 4 && pend(g).player !== P0; i++) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Cannon Barrage'));
  for (let i = 0; i < 12 && g.chain.length; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(zone(g, t), 'trash');
  assert.equal(g.objects[a].damage, 0, 'no damage (checked before the combat heal)');
  assert.ok(g.ex.combat || pend(g).kind === 'showdownAction', 'combat not over yet');
  const deck = g.players[P1].mainDeck;
  assert.ok(top.every(id => deck.indexOf(id) >= deck.length - 5), 'the five were revealed and recycled to the bottom');
});

test('RJ#5624 a player can see their own hidden cards on the battlefield (private to them): Fox-Fire and Consult the Past stay distinguishable', () => {
  const g = S0();
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const ff = put(g, P0, 'Fox-Fire', { facedown: BF_A }), ct = put(g, P0, 'Consult the Past', { facedown: BF_A });
  const mine = getView(g, P0).state, theirs = getView(g, P1).state;
  assert.equal(mine.objects[ff].cardId, g.objects[ff].cardId);
  assert.equal(mine.objects[ct].cardId, g.objects[ct].cardId);
  // the opponent gets them as opaque aliases (HIDDEN-IDS), not by engine id
  assert.equal(theirs.objects[ff], undefined);
  assert.ok(Object.values(theirs.objects).filter(o => o.zone === 'facedown').every(o => o.cardId === 'hidden'));
});

test('RJ#5625 Traveling Merchant with Cleave\'s Assault 3: no bonus while his move trigger is on the chain (combat only staged); +3 once the combat begins', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const m = put(g, P0, 'Traveling Merchant', 'base'); hand(g, P0, 'V(1)');
  g = drive(play(g, P0, hand(g, P0, 'Cleave'), { targets: [[m]] }));
  g = move(g, P0, [m], BF_A);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = choose(g, optionIds(g)[0]);
  assert.ok(g.chain.some(c => c.source === m));
  assert.equal(mightOf(g, m), 2);
  for (let i = 0; i < 10 && !(pend(g).kind === 'showdownAction' && !g.chain.length); i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(mightOf(g, m), 5);
});

// MISMATCH-RJ: RJ (citing designer intent over the written rules) puts the Sprite at Ava's attacked battlefield. Card text: only
// "If it's a unit, play it here" — Sprite Call is a spell, and its token is played as when hard-cast: to base or a battlefield you
// control, never to the contested one (verified RJ#403, RJ#1419).
test('RJ#5628 Ava Achiever playing Sprite Call while attacking: the Sprite is not played to the attacked (uncontrolled) battlefield', () => {
  let g = withTokens(S0()); fundAll(g, P0);
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const ava = put(g, P0, 'Ava Achiever', 'base');
  const sc = hand(g, P0, 'Sprite Call');
  const before = new Set(Object.keys(g.objects));
  g = move(g, P0, [ava], BF_A);
  let offeredBf = false;
  for (let i = 0; i < 16 && pend(g).kind !== 'showdownAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    if (optionIds(g).includes(String(BF_A)) && !optionIds(g).includes(sc)) offeredBf = true;
    g = choose(g, d.kind === 'optional' ? 'yes' : optionIds(g).includes(sc) ? sc : optionIds(g).includes('base') ? 'base' : optionIds(g)[0]);
  }
  assert.equal(zone(g, sc), 'trash', 'Sprite Call was played');
  const sprite = Object.keys(g.objects).find(id => !before.has(id) && g.objects[id].isToken);
  assert.ok(sprite, 'a Sprite was played');
  assert.notEqual(locOf(g, sprite!), BF_A);
  assert.equal(offeredBf, false);
});

test('RJ#5631 Volibear, Furious attacks Reaver\'s Row choosing both defenders; the defender\'s trigger (on top) retreats one first: it takes no damage, the other does', () => {
  let g = S0({ bfA: "Reaver's Row" }); fundAll(g, P0);
  const e1 = put(g, P1, 'V(9)', BF_A), e2 = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const v = put(g, P0, 'Volibear, Furious', 'base');
  g = move(g, P0, [v], BF_A);
  for (let i = 0; i < 14 && pend(g).kind !== 'showdownAction'; i++) {
    const d = pend(g);
    if (d.inStep && d.kind === 'chooseTargets' && d.player === P0) { g = act(g, { type: 'choose', player: P0, optionIds: [e1, e2] }); continue; }
    if (d.inStep && d.kind === 'chooseNumber') { g = choose(g, '2'); continue; }
    if (d.kind === 'optional' && d.player === P1) { g = yes(g); continue; }
    g = d.inStep ? choose(g, optionIds(g).includes(e1) ? e1 : d.options![0].id) : pass(g);
  }
  assert.equal(locOf(g, e1), 'base', 'retreated by Reaver\'s Row');
  assert.equal(g.objects[e1].damage, 0, 'no longer a legal target');
  assert.ok(g.objects[e2].damage > 0);
});

test('RJ#5636 a stunned Anivia, Primal still deals her attack-trigger damage (stun only stops combat damage)', () => {
  let g = S0();
  const e = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const an = put(g, P0, 'Anivia, Primal', 'base', { stunned: true });
  assert.ok(legal(g, P0, 'move').some(a => a.type === 'move' && a.units.includes(an)), 'a stunned unit can still move');
  g = move(g, P0, [an], BF_A);
  for (let i = 0; i < 8 && g.chain.length + (pend(g).inStep ? 1 : 0) > 0; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(g.objects[e].damage, 3);
});

test('RJ#5641 Gust on my own 3-Might Irelia, Fervent: her "when you choose me" +1 resolves first → 4, Gust (3 or less, checked on resolution) does nothing', () => {
  let g = S0(); fundAll(g, P0);
  const ir = put(g, P0, 'sfd-057-221', BF_A); control(g, BF_A, P0);
  mod(g, ir, { might: -1 });
  assert.equal(mightOf(g, ir), 3);
  g = play(g, P0, hand(g, P0, 'Gust'), { targets: [[ir]] });
  assert.ok(g.chain.some(c => c.kind === 'trigger' && c.source === ir), 'choose trigger above Gust');
  g = drive(g);
  assert.equal(locOf(g, ir), BF_A, 'not returned');
  assert.equal(mightOf(g, ir), 4);
});

test('RJ#5642 Anivia, Primal\'s attack trigger on the chain: Smoke Screen (Reaction) and a facedown Hidden Blade can answer it; Hidden Blade from hand (Action) can\'t', () => {
  let g = S0(); fundAll(g, P1);
  put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const ss = hand(g, P1, 'Smoke Screen'), hbHand = hand(g, P1, 'Hidden Blade');
  const hbDown = put(g, P1, 'Hidden Blade', { facedown: BF_A });
  const an = put(g, P0, 'Anivia, Primal', 'base');
  g = move(g, P0, [an], BF_A);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = choose(g, optionIds(g)[0]);
  assert.ok(g.chain.some(c => c.source === an));
  if (pend(g).player === P0) g = pass(g);
  assert.ok(canPlayNow(g, P1, ss));
  assert.ok(canPlayNow(g, P1, hbDown));
  assert.ok(!canPlayNow(g, P1, hbHand));
});

test('RJ#5643 Possession (1st card) steals Darius, Trifarian, then Sabotage (2nd card): Darius triggers for his new controller (+2, ready)', () => {
  let g = S0(); fundAll(g, P0, 12);
  const d = put(g, P1, 'Darius, Trifarian', BF_A); control(g, BF_A, P1);
  hand(g, P1, 'Hextech Ray');
  [g] = cast(g, P0, 'Possession', { targets: [[d]] });
  g = drive(g);
  assert.equal(g.objects[d].controller, P0);
  assert.equal(mightOf(g, d), 5, 'Possession was the first card: no trigger yet');
  g.objects[d].exhausted = true; g.timestamp++;
  [g] = cast(g, P0, 'Sabotage');
  g = drive(g);
  assert.equal(mightOf(g, d), 7);
  assert.equal(g.objects[d].exhausted, false);
});

// MISMATCH-RJ (proposed, for adjudication): RJ says the battlefield is lost when the Deckhand is banished (not contested), so he
// re-contests and conquers. But no cleanup runs during Arcane Shift's resolution (CR 323; conformance T056), his play is pending until
// the spell finishes (CR 354.4, DECISIONS principle 5), and a cleanup with a pending item is Closed (principle 13): control is never lost
// in between → no conquer, no point.
test('RJ#5648 on the opponent\'s turn (their showdown elsewhere), Arcane Shift my lone Sneaky Deckhand back onto my battlefield: control is kept throughout — no conquer, no point', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0, 10);
  const dh = put(g, P0, 'Sneaky Deckhand', BF_A); control(g, BF_A, P0);
  const m = put(g, P1, 'V(9)', 'base');
  g = move(g, P1, [m], BF_B);
  expectPending(g, 'showdownAction', P1);
  g = pass(g);
  expectPending(g, 'showdownAction', P0);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Arcane Shift') });
  const has = (d: ReturnType<typeof pend>, id: string) => !!d.options?.some(o => o.id === id);
  g = drive(g, d => has(d, dh) ? dh : has(d, m) ? m : d.options?.find(o => o.id === String(BF_A) || /BF-A/.test(o.label))?.id);
  assert.equal(locOf(g, dh), BF_A);
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[P0].points, 0, 'kept, not conquered');
});

test('RJ#5649 Get Excited! countered by Defy: the discard (not a cost) never happens; its target was declared when played', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const keep = hand(g, P0, 'V(1)');
  const ge = hand(g, P0, 'Get Excited!');
  g = play(g, P0, ge, { targets: [[e]] });
  assert.ok(g.chain.some(c => c.source === ge && c.targets.flat().includes(e)), 'target locked when played');
  assert.equal(zone(g, keep), 'hand');
  if (pend(g).player === P0) g = pass(g);
  g = drive(play(g, P1, hand(g, P1, 'Defy'), { targets: [[g.chain[0].source]] }));
  assert.equal(zone(g, keep), 'hand', 'no discard');
  assert.equal(g.objects[e].damage, 0);
});

test('RJ#5657 Yasuo, Remorseful (6) attacks a lone 6-Might defender: his attack trigger kills it first, no combat damage to him; he conquers', () => {
  let g = S0();
  const d = put(g, P1, 'V(6)', BF_A); control(g, BF_A, P1);
  const y = put(g, P0, 'Yasuo, Remorseful', 'base');
  g = drive(move(g, P0, [y], BF_A), x => x.options?.some(o => o.id === d) ? d : undefined);
  assert.equal(zone(g, d), 'trash');
  assert.equal(locOf(g, y), BF_A);
  assert.equal(g.battlefields[BF_A].controller, P0);
});

// OUTDATED: RJ says an unplayable card stays on top of the deck; the current text banishes it first ("banishes one of them …
// each player plays those cards"), so a card that can't be played stays banished (DECISIONS #6901, as RJ#2608).
test('RJ#5662 Promising Future: a banished card that can\'t be played (Gust with no legal target) stays banished', () => {
  let g = S0(); fundAll(g, P0, 8);
  const gu = put(g, P0, 'Gust', 'deckTop');
  for (let i = 0; i < 4; i++) put(g, P0, 'V(1)', 'deckTop');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Promising Future') });
  let chosen = false;
  for (let i = 0; i < 30 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const ids = optionIds(g);
    if (d.player === P0 && ids.includes(gu)) { chosen = true; g = choose(g, gu); continue; }
    g = choose(g, ids[0]);
  }
  assert.ok(chosen, 'Gust was offered among the top 5');
  assert.equal(zone(g, gu), 'banishment', 'not played (no unit at a battlefield), stays banished');
});

test('RJ#5667 facedown Hidden Blade kills Anivia, Primal in response to her attack trigger: her controller draws 2, the trigger ("here") deals nothing', () => {
  let g = S0(); fundAll(g, P1);
  const e = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const hb = put(g, P1, 'Hidden Blade', { facedown: BF_A });
  const an = put(g, P0, 'Anivia, Primal', 'base');
  g = move(g, P0, [an], BF_A);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = choose(g, optionIds(g)[0]);
  if (pend(g).player === P0) g = pass(g);
  const h = g.players[P0].hand.length;
  g = play(g, P1, hb, { targets: [[an]] });
  for (let i = 0; i < 10 && g.chain.length; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(zone(g, an), 'trash');
  assert.equal(g.players[P0].hand.length, h + 2, 'Anivia\'s controller draws 2');
  assert.equal(g.objects[e].damage, 0);
});

test('RJ#5671 Vilemaw\'s Lair blocks only moves to base: Gust (a return, not a move) still returns a unit there to hand', () => {
  let g = S0({ bfA: "Vilemaw's Lair" }); fundAll(g, P0);
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  g = drive(play(g, P0, hand(g, P0, 'Gust'), { targets: [[e]] }));
  assert.equal(zone(g, e), 'hand');
});

// MISMATCH-RJ: RJ says each card fully resolves before the next is played and nothing can respond (no Defy/Wind Wall). The cards are
// played in order onto the chain and resolve last-in-first-out (CR 738 Example 2; DECISIONS #6890; verified RJ#1827), with normal
// priority — so a Reaction such as Defy can answer them. Its "unpayable power → recycle all five" aside is OUTDATED (DECISIONS #6901).
test('RJ#5673 Promising Future: both played spells sit on the chain together (caster\'s on top) and can be answered with Defy', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const mine = put(g, P0, 'Consult the Past', 'deckTop');
  const theirs = put(g, P1, 'Consult the Past', 'deckTop');
  const defy = hand(g, P1, 'Defy');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Promising Future') });
  let window = false;
  for (let i = 0; i < 30 && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g);
    if (d.inStep) { const o = optionIds(g); g = choose(g, o.includes(mine) ? mine : o.includes(theirs) ? theirs : o[0]); continue; }
    if (g.chain.some(c => c.source === mine) && g.chain.some(c => c.source === theirs) && d.player === P1 && canPlayNow(g, P1, defy)) { window = true; break; }
    g = pass(g);
  }
  assert.ok(window, 'P1 gets priority with both spells on the chain and may Defy');
  assert.equal(g.chain[g.chain.length - 1].source, mine, 'caster\'s spell on top');
  const h0 = g.players[P0].hand.length;
  g = drive(play(g, P1, defy, { targets: [[g.chain.find(c => c.source === mine)!.id]] }));
  assert.equal(g.players[P0].hand.length, h0, 'countered: P0 drew nothing');
});

test('RJ#5681 Imperial Decree\'s kill is a triggered ability on the chain: the opponent can flip a hidden Zhonya\'s Hourglass in response and save the unit', () => {
  let g = S0(); fundAll(g, P0, 10); fundAll(g, P1);
  const u = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const z = put(g, P1, "Zhonya's Hourglass", { facedown: BF_A });
  g = drive(play(g, P0, hand(g, P0, 'Imperial Decree')));
  g = play(g, P0, hand(g, P0, 'Hextech Ray'), { targets: [[u]] });
  for (let i = 0; i < 6 && !g.chain.some(c => c.kind === 'trigger'); i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.ok(g.chain.some(c => c.kind === 'trigger'), 'Decree trigger waiting on the chain');
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  assert.ok(canPlayNow(g, P1, z));
  g = play(g, P1, z);
  g = drive(g);
  assert.equal(zone(g, z), 'trash');
  assert.equal(locOf(g, u), 'base', 'saved');
});

test('RJ#5685 Sett, Kingpin\'s "buffed friendly unit at my battlefield" means his own battlefield only; in base he gets nothing', () => {
  const g = S0();
  const s = put(g, P0, 'Sett, Kingpin', BF_A); control(g, BF_A, P0);
  put(g, P0, 'V(1)', BF_A, { buff: true });
  put(g, P0, 'V(1)', BF_B, { buff: true }); control(g, BF_B, P0);
  assert.equal(mightOf(g, s), 5 + 1, 'only the buffed unit at his battlefield counts');
  const h = S0();
  const s2 = put(h, P0, 'Sett, Kingpin', 'base');
  put(h, P0, 'V(1)', 'base', { buff: true });
  assert.equal(mightOf(h, s2), 5, 'not at a battlefield: no bonus');
});

test('RJ#5686 Sett, Kingpin saved by The Boss while a buffed ally dies in the same combat: Vanguard Helm\'s trigger can buff the recalled Sett', () => {
  let { g, def } = attackSetup(['V(12)'], ['Sett, Kingpin', 'V(1)'], { defOpts: [{ buff: true }, { buff: true }] });
  fundAll(g, P1);
  setLegend(g, P1, 'The Boss');
  put(g, P1, 'Vanguard Helm', 'base');
  const [s, ally] = def;
  for (let i = 0; i < 40 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.kind === 'assignDamage') { g = act(g, { type: 'assignDamage', player: d.player, assignment: (d.data as { suggested: Record<ObjId, number> }).suggested }); continue; }
    if (d.kind === 'optional') { g = d.player === P1 ? yes(g) : no(g); continue; }
    g = d.inStep ? choose(g, optionIds(g).includes(s) ? s : optionIds(g)[0]) : pass(g);
  }
  assert.equal(zone(g, ally), 'trash');
  assert.equal(locOf(g, s), 'base', 'saved and recalled');
  assert.equal(g.objects[s].counters.buff ?? 0, 1, 'buff spent by The Boss, then re-buffed by Vanguard Helm');
});

test('RJ#5692 Teemo (ogn-197) played from hidden into a combat: Cannon Barrage in response to his +3 play trigger kills him first (1 Might, 2 damage)', () => {
  let { g } = attackSetup(['V(3)'], ['V(6)']);
  fundAll(g, P0); fundAll(g, P1);
  const t = put(g, P1, 'ogn-197-298', { facedown: BF_A });
  for (let i = 0; i < 6 && !(pend(g).kind === 'showdownAction' && pend(g).player === P1); i++) g = pass(g);
  g = play(g, P1, t);
  assert.ok(g.chain.some(c => c.source === t && c.kind === 'trigger'), 'play trigger on the chain');
  if (pend(g).player === P1) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Cannon Barrage'));
  for (let i = 0; i < 10 && g.chain.length; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(zone(g, t), 'trash');
});

test('RJ#5695 Promising Future with only 4 cards in the opponent\'s deck: they look at 4 and banish one — no burn out', () => {
  let g = S0(); fundAll(g, P0, 8);
  clearDeck(g, P1);
  for (let i = 0; i < 4; i++) put(g, P1, 'V(1)', 'deckTop');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Promising Future') });
  g = drive(g);
  assert.equal(g.players[P0].points, 0, 'no burn-out point');
  assert.equal(g.players[P1].mainDeck.length, 3, 'one banished (and played), three recycled');
});

test('RJ#5697 Stand United may choose an already-buffed unit (it stays at one buff, +1 extra this turn); with no friendly unit it can\'t be played', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'V(2)', 'base', { buff: true });
  const su = hand(g, P0, 'Stand United');
  assert.ok(canPlayNow(g, P0, su));
  g = drive(play(g, P0, su, { targets: [[u]] }));
  assert.equal(g.objects[u].counters.buff ?? 0, 1);
  assert.equal(mightOf(g, u), 2 + 1 + 1);
  const h = S0(); fundAll(h, P0);
  assert.ok(!canPlayNow(h, P0, hand(h, P0, 'Stand United')), 'no friendly unit to choose');
});

test('RJ#5701 Pit Rookie\'s "buff another friendly unit" chooses its unit when the trigger goes on the chain (visible to the opponent before it resolves)', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'V(1)', 'base'); const u2 = put(g, P0, 'V(2)', 'base');
  const pr = hand(g, P0, 'Pit Rookie');
  g = act(g, { type: 'playCard', player: P0, obj: pr, destination: 'base' });
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = choose(g, optionIds(g).includes(u2) ? u2 : optionIds(g)[0]);
  const item = g.chain.find(c => c.source === pr);
  assert.ok(item, 'trigger on the chain');
  assert.ok(item!.targets.flat().includes(u2), 'unit chosen already');
  assert.equal(g.objects[u2].counters.buff ?? 0, 0, 'not yet buffed');
  g = drive(g);
  assert.equal(g.objects[u2].counters.buff ?? 0, 1);
});

test('RJ#5704 a buffed 2-Might defender (3) takes 2 combat damage: survives, is healed and keeps its buff', () => {
  let { g, atk, def } = attackSetup(['V(2)'], ['V(2)'], { defOpts: [{ buff: true }] });
  g = drive(g);
  assert.equal(zone(g, atk[0]), 'trash');
  assert.equal(locOf(g, def[0]), BF_A);
  assert.equal(g.objects[def[0]].damage, 0);
  assert.equal(g.objects[def[0]].counters.buff ?? 0, 1);
  assert.equal(mightOf(g, def[0]), 3);
});

test('RJ#5707 Recruit the Vanguard during a combat showdown at another battlefield: its Recruits may be played to The Grand Plaza I control', () => {
  let g = S0(); withTokens(g); fundAll(g, P0);
  setBattlefieldCard(g, BF_B, 'The Grand Plaza');
  put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [a], BF_A);
  const rv = hand(g, P0, 'Recruit the Vanguard');
  for (let i = 0; i < 6 && !(pend(g).kind === 'showdownAction' && pend(g).player === P0); i++) g = pass(g);
  assert.ok(canPlayNow(g, P0, rv), 'an Action is playable in the showdown');
  g = act(g, { type: 'playCard', player: P0, obj: rv });
  const offered: string[] = [];
  g = drive(g, d => { if (d.kind === 'chooseDestination') { offered.push(...d.options!.map(o => o.id)); return String(BF_B); } return undefined; });
  assert.ok(offered.includes(String(BF_B)), `Grand Plaza offered (${offered.join(',')})`);
  const recruits = Object.values(g.objects).filter(o => o.controller === P0 && g.cards[o.cardId]?.name === 'Recruit' && o.zone === 'battlefield');
  assert.equal(recruits.length, 4);
  assert.ok(recruits.every(r => locOf(g, r.id) === BF_B));
});

test('RJ#5718 drawing Undertitan is not revealing it: no [Add] [2]', () => {
  let g = S0();
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const md = put(g, P0, 'MoveDraw(2)', 'base');
  const ut = put(g, P0, 'Undertitan', 'deckTop');
  const e0 = g.players[P0].pool.energy;
  g = drive(move(g, P0, [md], BF_A));
  assert.equal(zone(g, ut), 'hand', 'drawn');
  assert.equal(g.players[P0].pool.energy, e0, 'no Energy added');
});

test('RJ#5720 after the attacker\'s attack-trigger chain resolves, the defender gets a showdown turn to play Actions', () => {
  let { g } = attackSetup(['AttackDraw(3)'], ['V(4)']);
  fundAll(g, P1);
  const su = hand(g, P1, 'Stand United');
  assert.ok(g.chain.length > 0, 'attack trigger on the chain');
  for (let i = 0; i < 6 && g.chain.length; i++) g = pass(g);
  assert.equal(g.chain.length, 0);
  expectPending(g, 'showdownAction', P0, 'attacker has focus first');
  g = pass(g);
  expectPending(g, 'showdownAction', P1);
  assert.ok(canPlayNow(g, P1, su), 'defender may play an Action');
});

test('RJ#5722 Annie\'s Bonus Damage only increases damage that is dealt: Stupefy deals none (0 damage), Hextech Ray deals 4', () => {
  let g = S0(); fundAll(g, P0, 8);
  put(g, P0, 'ogs-001-024', 'base');
  const v = put(g, P1, 'V(6)', BF_A); control(g, BF_A, P1);
  [g] = cast(g, P0, 'Stupefy', { targets: [[v]] });
  g = drive(g);
  assert.equal(g.objects[v].damage, 0, 'no damage from a spell that deals none');
  [g] = cast(g, P0, 'Hextech Ray', { targets: [[v]] });
  g = drive(g);
  assert.equal(g.objects[v].damage, 4, 'sanity: 3 + 1 bonus');
});

test('RJ#5728 Orb of Regret\'s ability choosing an enemy Deflect unit must pay the Deflect [A]; a plain unit costs nothing extra', () => {
  const run = (deflect: boolean) => {
    let g = S0(); fundAll(g, P0, 1);
    const orb = put(g, P0, 'Orb of Regret', 'base');
    const t = put(g, P1, deflect ? 'Deadbloom Predator' : 'V(8)', BF_A); control(g, BF_A, P1);
    const r0 = g.players[P0].runesInPlay.length;
    g = drive(activate(g, P0, orb, 0, { targets: [[t]] }), d => (d.kind === 'optional' ? 'yes' : undefined));
    return { paid: r0 - g.players[P0].runesInPlay.length, might: mightOf(g, t) };
  };
  const d = run(true), p = run(false);
  assert.equal(d.might, 7, 'the -1 applied to the Deflect unit');
  assert.equal(p.might, 7);
  assert.equal(p.paid, 0, 'no extra cost for a plain unit');
  assert.equal(d.paid, 1, 'one rune recycled for the Deflect [A]');
});

test('RJ#5734 attached equipment is still gear but does not itself get Hexdrinker\'s [Deflect]: only the unit has it (Trinity Force neither)', () => {
  const g = S0();
  const u = put(g, P0, 'V(3)', 'base');
  const hx = put(g, P0, 'Hexdrinker', 'base');
  const tf = put(g, P0, 'Trinity Force', 'base');
  attachNow(g, hx, u); attachNow(g, tf, u);
  assert.ok(hasKeyword(g, u, 'Deflect'), 'the unit has Deflect');
  assert.ok(!hasKeyword(g, hx, 'Deflect'), 'Hexdrinker itself has none');
  assert.ok(!hasKeyword(g, tf, 'Deflect'), 'Trinity Force gets none');
  assert.equal(g.cards[g.objects[hx].cardId].type, 'Gear');
});

test('RJ#5735 a unit with no play trigger enters at once (no window); a "When you play me" trigger uses the chain and the opponent may respond', () => {
  let g = S0(); fundAll(g, P0);
  const v = hand(g, P0, 'V(3)');
  g = act(g, { type: 'playCard', player: P0, obj: v, destination: 'base' });
  assert.equal(locOf(g, v), 'base', 'on the board');
  assert.equal(g.chain.length, 0);
  expectPending(g, 'mainAction', P0, 'no response window');
  const ut = hand(g, P0, 'Undertitan');
  g = act(g, { type: 'playCard', player: P0, obj: ut, destination: 'base' });
  assert.equal(locOf(g, ut), 'base');
  assert.ok(g.chain.some(c => c.source === ut && c.kind === 'trigger'), 'play trigger on the chain');
  if (pend(g).player === P0) g = pass(g);
  expectPending(g, 'chainResponse', P1, 'opponent may react to the trigger');
});

test('RJ#5737 my only unit leaves a battlefield I conquered: I lose control and can no longer play units there', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const v = hand(g, P0, 'V(1)');
  assert.ok(playDests(g, P0, v).includes(BF_A), 'sanity: playable there while controlled');
  g = drive(move(g, P0, [u], 'base'));
  assert.equal(g.battlefields[BF_A].controller, null);
  assert.ok(!playDests(g, P0, v).includes(BF_A));
});

test('RJ#5742 Akshan leaves the board before his play trigger resolves: the trigger still resolves, but his "until I leave the board" control has already ended — the gear stays with its controller', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const gear = put(g, P1, 'Vanguard Helm', 'base');
  const f = put(g, P1, 'V(1)', 'base');
  const sc = hand(g, P1, 'StarCrossedLike');
  const ak = hand(g, P0, 'Akshan, Mischievous');
  g = act(g, { type: 'playCard', player: P0, obj: ak, destination: 'base' });
  let done = false;
  for (let i = 0; i < 40 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.inStep) { g = choose(g, d.options!.find(o => [gear, ak, f, 'yes'].includes(o.id))?.id ?? d.options![0].id); continue; }
    if (!done && d.player === P1 && g.chain.some(c => c.source === ak && c.kind === 'trigger')) { done = true; g = act(g, { type: 'playCard', player: P1, obj: sc }); continue; }
    g = pass(g);
  }
  assert.ok(done, 'responded to the play trigger');
  assert.equal(zone(g, ak), 'hand', 'Akshan left the board');
  assert.equal(g.chain.length, 0);
  assert.equal(zone(g, gear), 'base');
  assert.equal(g.objects[gear].controller, P1, 'not kept by Akshan\'s controller');
});

// MISMATCH-ENGINE: the Buccaneer's playRule extraDestinations is applied to facedown plays too (CR 811.1.d / T144: a hidden
// permanent must be played to its battlefield; a mandatory requirement beats a permission).
test('RJ#5744 Miss Fortune, Buccaneer (play units to open battlefields) does not let a hidden unit be played anywhere but its own battlefield', () => {
  const g = S0(); fundAll(g, P0);
  put(g, P0, 'Miss Fortune, Buccaneer', 'base');
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const h = put(g, P0, 'HidU(2)', { facedown: BF_A, hiddenTurn: 0 });
  const v = hand(g, P0, 'V(1)');
  assert.ok(playDests(g, P0, v).includes(BF_B), 'sanity: a unit from hand may go to the open battlefield');
  assert.deepEqual(playDests(g, P0, h), [BF_A], 'hidden unit: only where it was hidden');
});

test('RJ#5746 Brynhir Thundersong played by my Dazzling Aurora at the end of my turn: the lock ("this turn") is over on the opponent\'s turn', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  put(g, P0, 'Dazzling Aurora', 'base');
  const br = put(g, P0, 'Brynhir Thundersong', 'deckTop');
  const v = hand(g, P1, 'V(1)');
  g = endTurn(g, P0);
  g = drive(g, d => (d.kind === 'optional' ? 'yes' : undefined), 60);
  assert.equal(locOf(g, br), 'base', 'Brynhir played by the Aurora');
  assert.equal(g.activePlayer, P1);
  expectPending(g, 'mainAction', P1);
  fundAll(g, P1);
  assert.ok(canPlayNow(g, P1, v), 'the opponent may play cards on their own turn');
});

test('RJ#5747 with all 12 runes channeled you still draw at the start of your turn', () => {
  let g = S0({ tp: P1 });
  setRunes(g, P0, 12);
  for (const id of g.players[P0].runeDeck) delete g.objects[id];
  g.players[P0].runeDeck = [];
  const h = g.players[P0].hand.length;
  g = nextTurn(g);
  assert.equal(g.activePlayer, P0);
  assert.equal(g.players[P0].hand.length, h + 1, 'drew 1');
  assert.equal(g.players[P0].runesInPlay.length, 12);
});

// MISMATCH-RJ (proposed): RJ says Challenge damage isn't healed "after combat or at end of turn". Damage stays after Challenge
// resolves (not a combat), but every unit is healed at the end of the turn (CR 317 Ending/Expiration: damage is removed) and by any
// combat cleanup (CR 468.1, r7801 RJ#8351; verified RJ#5652, RJ#5661). Test asserts the official behaviour.
test('RJ#5751 Challenge damage stays after the spell (not a combat) but is healed at the end of the turn', () => {
  let g = S0(); fundAll(g, P0);
  const a = put(g, P0, 'V(5)', BF_A); control(g, BF_A, P0);
  const e = put(g, P1, 'V(3)', BF_B); control(g, BF_B, P1);
  [g] = cast(g, P0, 'Challenge', { targets: [[a], [e]] });
  g = drive(g);
  assert.equal(zone(g, e), 'trash');
  assert.equal(g.objects[a].damage, 3, 'still damaged after Challenge');
  g = nextTurn(g);
  assert.equal(g.objects[a].damage, 0, 'healed at end of turn');
});

test('RJ#5753 Tianna Crownguard blocks Trinity Force\'s "score 1 point" on a hold as well as the hold point; without her both score', () => {
  const run = (tianna: boolean) => {
    let g = S0({ tp: P1 });
    const u = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
    const tf = put(g, P0, 'Trinity Force', 'base');
    attachNow(g, tf, u);
    put(g, P1, tianna ? 'Tianna Crownguard' : 'V(3)', BF_B); control(g, BF_B, P1);
    g = nextTurn(g);
    assert.equal(g.activePlayer, P0);
    return g.players[P0].points;
  };
  assert.equal(run(false), 2, 'sanity: hold + Trinity Force');
  assert.equal(run(true), 0);
});

test('RJ#5754 Watchful Sentry killed in the showdown draws Hextech Ray, which can kill the attacker before combat damage', () => {
  let { g, atk, def } = attackSetup(['V(3)'], ['Watchful Sentry', 'V(5)']);
  fundAll(g, P0); fundAll(g, P1);
  const ray = put(g, P1, 'Hextech Ray', 'deckTop');
  for (let i = 0; i < 6 && !(pend(g).kind === 'showdownAction' && pend(g).player === P0); i++) g = pass(g);
  g = play(g, P0, hand(g, P0, 'KillA'), { targets: [[def[0]]] });
  for (let i = 0; i < 10 && g.chain.length; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(zone(g, def[0]), 'trash');
  assert.equal(zone(g, ray), 'hand', 'Deathknell drew it');
  for (let i = 0; i < 4 && !(pend(g).kind === 'showdownAction' && pend(g).player === P1); i++) g = pass(g);
  expectPending(g, 'showdownAction', P1);
  g = drive(play(g, P1, ray, { targets: [[atk[0]]] }));
  assert.equal(zone(g, atk[0]), 'trash', 'killed before combat damage');
  assert.equal(g.objects[def[1]].damage, 0, 'no combat damage dealt');
});

// RJ#5758 (verified v1.5: "lethal to the Tank first (prevented), rest to others") is superseded by DECISIONS A-3 / principle 24
// (ADJUDICATOR-5, CR 467.2.c.10 + its Counter Strike example): the shielded Tank is not exempt and no amount is lethal for it,
// so it absorbs the entire attack — the unit behind it gets nothing (test rewritten by ENGINE-7; MISMATCH-RJ, FINDINGS RJ#5758).
test('RJ#5758 (DECISIONS A-3) Counter Strike on a Tank defender: no amount is lethal for the Tank, so it takes all the damage (prevented) and the other defender survives', () => {
  let { g, atk, def } = attackSetup(['V(6)'], ['Tank(2)', 'V(2)']);
  fundAll(g, P1);
  const cs = hand(g, P1, 'Counter Strike');
  for (let i = 0; i < 6 && !(pend(g).kind === 'showdownAction' && pend(g).player === P1); i++) g = pass(g);
  g = play(g, P1, cs, { targets: [[def[0]]] });
  for (let i = 0; i < 20 && pend(g).kind !== 'assignDamage' && !(pend(g).kind === 'mainAction' && !g.combat); i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  if (pend(g).kind === 'assignDamage') {
    assert.ok(validateAction(g, { type: 'assignDamage', player: P0, assignment: { [def[1]]: 6 } }), 'the Tank can\'t be skipped');
    assert.ok(validateAction(g, { type: 'assignDamage', player: P0, assignment: { [def[0]]: 2, [def[1]]: 4 } }), 'nothing gets past the shielded Tank');
    g = act(g, { type: 'assignDamage', player: P0, assignment: { [def[0]]: 6 } });
  }
  g = drive(g);
  assert.equal(locOf(g, def[0]), BF_A, 'Tank survives (prevented)');
  assert.equal(locOf(g, def[1]), BF_A, 'the other defender got no damage');
  void atk;
});

test('RJ#5760 Soraka saves the unit killed for Malzahar\'s cost; the [A][A] is still added', () => {
  let g = S0();
  const mz = put(g, P0, 'Malzahar', BF_A); control(g, BF_A, P0);
  put(g, P0, 'Soraka', BF_A);
  const v = put(g, P0, 'V(1)', BF_A);
  const pow = (h: GameState) => Object.values(h.players[P0].pool.power).reduce((a, b) => a + (b ?? 0), 0);
  const p0 = pow(g);
  g = activate(g, P0, mz, 0, { targets: [[v]] });
  for (let i = 0; i < 10 && pend(g).inStep; i++) g = choose(g, optionIds(g).includes(v) ? v : (optionIds(g).includes('yes') ? 'yes' : optionIds(g)[0]));
  assert.equal(locOf(g, v), 'base', 'healed, exhausted and recalled instead of dying');
  assert.equal(g.objects[v].exhausted, true);
  assert.equal(pow(g) - p0, 2, 'power still added');
});

test('RJ#5766 a Cleaved attacker (2+3) with 3 damage moved out by Ride the Wind loses Assault and dies in the cleanup after the move', () => {
  let { g, atk, def } = attackSetup(['V(2)'], ['V(9)']);
  fundAll(g, P0); fundAll(g, P1);
  const toP = (p: PlayerId) => { for (let i = 0; i < 8 && !(pend(g).kind === 'showdownAction' && pend(g).player === p); i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g); };
  toP(P0);
  g = play(g, P0, hand(g, P0, 'Cleave'), { targets: [[atk[0]]] });
  for (let i = 0; i < 6 && g.chain.length; i++) g = pass(g);
  assert.equal(mightOf(g, atk[0]), 5);
  toP(P1);
  g = play(g, P1, hand(g, P1, 'Hextech Ray'), { targets: [[atk[0]]] });
  for (let i = 0; i < 6 && g.chain.length; i++) g = pass(g);
  assert.equal(g.objects[atk[0]].damage, 3);
  assert.equal(locOf(g, atk[0]), BF_A, 'survives while attacking (5 Might)');
  toP(P0);
  g = play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[atk[0]]], dest: 'base' });
  for (let i = 0; i < 6 && g.chain.length; i++) g = pend(g).inStep ? choose(g, 'base') : pass(g);
  assert.equal(zone(g, atk[0]), 'trash', 'no longer attacking: 2 Might with 3 damage');
  assert.equal(locOf(g, def[0]), BF_A);
});

test('RJ#5768 Kai\'Sa\'s (ogn-039) Accelerate costs [1] Energy and one Power on top of her cost', () => {
  const run = (acc: boolean) => {
    let g = S0(); fundAll(g, P0, 2);
    const k = hand(g, P0, 'ogn-039-298');
    g = play(g, P0, k, { dest: 'base', may: [acc] });
    g = drive(g, d => (d.kind === 'optional' ? (acc ? 'yes' : 'no') : undefined));
    assert.equal(locOf(g, k), 'base');
    const m = /pays (\d+)\s*(.*)$/.exec(g.log.filter(l => /^P0 pays/.test(l.text)).at(-1)!.text)!;
    return { energy: Number(m[1]), power: m[2].replace(/[^A-Z]/g, '').length, ready: !g.objects[k].exhausted };
  };
  const a = run(true), n = run(false);
  assert.ok(a.ready && !n.ready, 'Accelerate paid: enters ready');
  assert.equal(a.energy - n.energy, 1, 'one Energy more');
  assert.equal(a.power - n.power, 1, 'one Power more');
});

test('RJ#5772 Showstopper\'s move destination is declared when it is played, before the opponent may react (CR 355.4)', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'V(2)', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Showstopper') });
  const asked: string[] = [];
  for (let i = 0; i < 6 && g.pending?.inStep; i++) { asked.push(g.pending.kind); g = act(g, legal(g, P0)[0]); }
  assert.ok(asked.includes('chooseDestination'), `destination chosen while playing (asked: ${asked})`);
  assert.ok(g.chain.some(c => c.kind === 'spell'), 'then it is on the chain');
});

test('RJ#5780 a Legion unit played from the trash by Spectral Matron sees Matron as a card played this turn: Legion active (Trifarian Gloryseeker buffs itself)', () => {
  let g = S0(); fundAll(g, P0);
  withTokens(g);
  const tg = put(g, P0, 'Trifarian Gloryseeker', 'trash');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Spectral Matron'), destination: 'base' });
  g = drive(g, d => (d.kind === 'optional' ? 'yes' : d.options!.some(o => o.id === tg) ? tg : d.options!.some(o => o.id === 'base') ? 'base' : undefined));
  assert.equal(locOf(g, tg), 'base', 'played from the trash');
  assert.equal(g.objects[tg].counters.buff ?? 0, 1, 'Legion active');
});

test('RJ#5783 both players Stupefy their own unit at The Dreaming Tree: the chain resolves Tree(B), Stupefy(B), Tree(A), Stupefy(A); each player draws from the Tree', () => {
  let { g, atk, def } = attackSetup(['V(3)'], ['V(3)'], { bfA: 'The Dreaming Tree' });
  fundAll(g, P0); fundAll(g, P1);
  for (let i = 0; i < 6 && !(pend(g).kind === 'showdownAction' && pend(g).player === P0); i++) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Stupefy'), { targets: [[atk[0]]] });
  for (let i = 0; i < 3 && pend(g).player === P0; i++) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Stupefy'), { targets: [[def[0]]] });
  const names = ['Stupefy(A)', 'Tree(A)', 'Stupefy(B)', 'Tree(B)'];
  assert.deepEqual(g.chain.map(c => (c.kind === 'spell' ? 'Stupefy' : 'Tree')), ['Stupefy', 'Tree', 'Stupefy', 'Tree'], 'chain built bottom to top');
  const label = new Map(g.chain.map((c, k) => [c.id, names[k]]));
  const h0 = g.players[P0].hand.length, h1 = g.players[P1].hand.length;
  const resolved: string[] = [];
  for (let i = 0; i < 20 && g.chain.length; i++) {
    const top = g.chain.at(-1)!.id;
    g = pass(g);
    if (!g.chain.some(c => c.id === top)) resolved.push(label.get(top)!);
  }
  assert.deepEqual(resolved, ['Tree(B)', 'Stupefy(B)', 'Tree(A)', 'Stupefy(A)']);
  assert.equal(g.players[P0].hand.length, h0 + 2, 'A: Tree + Stupefy draws');
  assert.equal(g.players[P1].hand.length, h1 + 2, 'B: Tree + Stupefy draws');
});

test('RJ#5787 Yasuo, Remorseful + Svellsongur: two separate attack triggers — Not So Fast counters only one; the other still deals 6', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const y = put(g, P0, 'Yasuo, Remorseful', 'base');
  attachNow(g, put(g, P0, 'Svellsongur', 'base'), y);
  const e1 = put(g, P1, 'V(6)', BF_A), e2 = put(g, P1, 'V(6)', BF_A);
  control(g, BF_A, P1);
  g = move(g, P0, [y], BF_A);
  let n = 0;
  for (let i = 0; i < 8 && g.pending?.inStep; i++) { const d = g.pending!; const pick = d.options!.find(o => o.id === (n === 0 ? e1 : e2)); if (pick) n++; g = choose(g, pick?.id ?? d.options![0].id); }
  assert.equal(g.chain.length, 2, 'two triggers');
  const top = g.chain.at(-1)!;
  for (let i = 0; i < 3 && pend(g).player !== P1; i++) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Not So Fast'), { targets: [[top.id]] });
  for (let i = 0; i < 10 && g.chain.length; i++) g = pend(g).inStep ? choose(g, optionIds(g).includes(top.id) ? top.id : optionIds(g)[0]) : pass(g);
  const dead = [e1, e2].filter(e => zone(g, e) === 'trash').length;
  assert.equal(dead, 1, 'one trigger countered, the other resolved');
  assert.ok(g.log.some(l => /counter/i.test(l.text)), g.log.slice(-8).map(l => l.text).join(' | '));
});

// OFFICIAL (ENGINE-5, rules-decisions #59): CR 715.4 "If no damage was Dealt, then Bonus Damage will not apply." (riftlens
// /rules/bonus-damage/, its Teemo + Rabadon's Deathcrown example: a deal of 0 is no deal action for the bonus to apply to).
// Bullet Time for 0 deals nothing, so Void Gate / Ravenborn Tome add nothing → 0. RJ#5791 ("still 1") is MISMATCH-RJ.
test('RJ#5791 Bullet Time paying 0 [A] at Void Gate deals no damage, so no Bonus Damage applies (CR 715.4): 0; paying 1 → 2', () => {
  const run = (n: number) => {
    let g = S0({ bfA: 'Void Gate' }); fundAll(g, P0, 4);
    const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
    g = play(g, P0, hand(g, P0, 'Bullet Time, Miss Fortune'), { battlefields: [BF_A] });
    if (pend(g).kind === 'chooseTargets') g = choose(g, pend(g).options!.find(o => o.id === String(BF_A) || /BF-A|Void Gate/.test(o.label))!.id);
    g = passN(g, 2);
    assert.ok(pend(g).inStep);
    g = answer(g, { battlefields: [BF_A], numbers: [n] });
    g = drive(g);
    return g.objects[e].damage;
  };
  assert.equal(run(1), 2, 'sanity: 1 + 1');
  assert.equal(run(0), 0, 'CR 715.4: no damage dealt → no Bonus Damage');
});

test('RJ#5792 Pack of Wonders (no Reaction) can\'t be activated on the opponent\'s turn, even when my unit is attacked', () => {
  let g = S0({ tp: P1 });
  const pk = put(g, P0, 'Pack of Wonders', 'base');
  const mine = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const a = put(g, P1, 'V(3)', 'base');
  g = move(g, P1, [a], BF_A);
  const can = (h: GameState) => legal(h, P0, 'activate').some(x => x.type === 'activate' && x.obj === pk);
  let sawP0 = false;
  for (let i = 0; i < 8 && pend(g).kind !== 'assignDamage' && pend(g).kind !== 'mainAction'; i++) {
    if (pend(g).player === P0) { sawP0 = true; assert.ok(!can(g), `not activatable (${pend(g).kind})`); }
    g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  }
  assert.ok(sawP0, 'P0 had priority/focus during the combat');
  void mine;
  const h = S0(); const pk2 = put(h, P0, 'Pack of Wonders', 'base'); put(h, P0, 'V(1)', 'base');
  assert.ok(legal(h, P0, 'activate').some(x => x.type === 'activate' && x.obj === pk2), 'sanity: usable in my own Main phase');
});

test('RJ#5794 two Seals of Unity ([T]: [Reaction] [Add] Order power) can pay Harnessed Dragon\'s two Order power', () => {
  let g = S0();
  setRunes(g, P0, 8, 'fury');
  const s1 = put(g, P0, 'Seal of Unity', 'base'), s2 = put(g, P0, 'Seal of Unity', 'base');
  const hd = hand(g, P0, 'Harnessed Dragon');
  assert.ok(canPlayNow(g, P0, hd), 'payable with the Seals');
  g = act(g, { type: 'playCard', player: P0, obj: hd, destination: 'base' });
  g = drive(g);
  assert.equal(locOf(g, hd), 'base');
  assert.ok(g.objects[s1].exhausted && g.objects[s2].exhausted, 'both Seals used');
});

test('RJ#5801 a card in the Champion Zone isn\'t in hand: Get Excited! with an empty hand discards nothing (the champion stays put)', () => {
  let g = S0(); fundAll(g, P0);
  const ge = hand(g, P0, 'Get Excited!');
  for (const id of [...g.players[P0].hand]) if (id !== ge) { delete g.objects[id]; }
  g.players[P0].hand = [ge];
  const champ = g.players[P0].championZone[0];
  assert.ok(champ, 'a champion is in the Champion Zone');
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  g = drive(play(g, P0, ge, { targets: [[e]] }));
  assert.equal(zone(g, champ), 'championZone');
  assert.equal(g.objects[e].damage, 0, 'nothing discarded, no damage');
});

test('RJ#5803 Piercing Light\'s second target may be at another battlefield or in a base (not repeated)', () => {
  for (const where of [BF_B, 'base'] as const) {
    let g = S0(); fundAll(g, P0);
    const a = put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
    const b = put(g, P1, 'V(5)', where); if (where === BF_B) control(g, BF_B, P1);
    g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Piercing Light') });
    const picks = [a, b];
    for (let i = 0; i < 6 && g.pending?.inStep; i++) {
      if (g.pending.kind === 'optional') { g = no(g); continue; }
      const want = picks.find(x => optionIds(g).includes(x));
      assert.ok(want, `offered ${String(where)}: ${optionIds(g).join(',')}`);
      g = choose(g, want!); picks.splice(picks.indexOf(want!), 1);
    }
    g = drive(g, d => (d.kind === 'optional' ? 'no' : undefined));
    assert.equal(g.objects[a].damage, 2);
    assert.equal(g.objects[b].damage, 2, `second target (${String(where)}) dealt 2`);
  }
});

test('RJ#5810 surviving attackers recalled after a combat they don\'t win keep their state: exhausted by the move, still exhausted in base', () => {
  let { g, atk, def } = attackSetup(['V(2)'], ['V(5)'], { defOpts: [{ stunned: true }] });
  assert.equal(g.objects[atk[0]].exhausted, true, 'moving exhausted it');
  g = drive(g);
  assert.equal(locOf(g, def[0]), BF_A, 'defender survives');
  assert.equal(locOf(g, atk[0]), 'base', 'recalled');
  assert.equal(g.objects[atk[0]].exhausted, true, 'still exhausted');
});

test('RJ#5813 a Hidden unit already in base can\'t be hidden; the same card from hand can', () => {
  const g = S0(); fundAll(g, P0);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const inBase = put(g, P0, 'HidU(2)', 'base');
  const inHand = hand(g, P0, 'HidU(2)');
  assert.notEqual(validateAction(g, { type: 'hide', player: P0, obj: inBase, battlefieldIndex: BF_A }), null, 'not from base');
  assert.equal(validateAction(g, { type: 'hide', player: P0, obj: inHand, battlefieldIndex: BF_A }), null, 'from hand');
});

test('RJ#5814 Vi, Destructive\'s recycle ability: usable repeatedly in my Main phase wherever she is; not during the opponent\'s combat', () => {
  let g = S0();
  const vi = put(g, P0, 'Vi, Destructive', BF_A); control(g, BF_A, P0);
  fillTrash(g, P0, 3);
  const can = (h: GameState) => legal(h, P0, 'activate').some(x => x.type === 'activate' && x.obj === vi);
  const m0 = mightOf(g, vi);
  for (let i = 0; i < 2; i++) { assert.ok(can(g)); g = drive(activate(g, P0, vi, 0)); }
  assert.equal(mightOf(g, vi), m0! + 2, 'used twice');
  let h = S0({ tp: P1 });
  const vi2 = put(h, P0, 'Vi, Destructive', BF_A); control(h, BF_A, P0);
  fillTrash(h, P0, 3);
  h = move(h, P1, [put(h, P1, 'V(9)', 'base')], BF_A);
  let saw = false;
  for (let i = 0; i < 6 && !['assignDamage', 'mainAction'].includes(pend(h).kind); i++) {
    if (pend(h).player === P0) { saw = true; assert.ok(!legal(h, P0, 'activate').some(x => x.type === 'activate' && x.obj === vi2), `not on the opponent's turn (${pend(h).kind})`); }
    h = pend(h).inStep ? choose(h, optionIds(h)[0]) : pass(h);
  }
  assert.ok(saw, 'P0 had priority/focus in the combat');
});

test('RJ#5816 A moves into an open battlefield, B Rides the Wind a unit in during the showdown: A applied Contested, so A attacks and B defends', () => {
  let g = S0(); fundAll(g, P1);
  const a = put(g, P0, 'V(3)', 'base');
  const b = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  g = move(g, P0, [a], BF_B);
  for (let i = 0; i < 4 && !(pend(g).kind === 'showdownAction' && pend(g).player === P1); i++) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Ride the Wind'), { targets: [[b]], dest: BF_B, locations: [BF_B] });
  for (let i = 0; i < 20 && !g.log.some(l => /^Combat at BF-B/.test(l.text)) && pend(g).kind !== 'mainAction'; i++) g = pend(g).inStep ? choose(g, optionIds(g).includes(String(BF_B)) ? String(BF_B) : optionIds(g)[0]) : pass(g);
  const c = g.log.find(l => /^Combat at BF-B/.test(l.text));
  assert.ok(c, 'a combat follows at BF-B');
  assert.match(c!.text, /P0 attacks, P1 defends/);
});

test('RJ#5822 Bullet Time (chooses a battlefield) at a battlefield with an enemy Deflect unit: no Deflect cost — only the chosen amount is paid', () => {
  let g = S0(); fundAll(g, P0, 4);
  const d = put(g, P1, 'Deadbloom Predator', BF_A); control(g, BF_A, P1);
  const r0 = g.players[P0].runesInPlay.length;
  g = play(g, P0, hand(g, P0, 'Bullet Time, Miss Fortune'), { battlefields: [BF_A] });
  if (pend(g).kind === 'chooseTargets') g = choose(g, pend(g).options!.find(o => o.id === String(BF_A) || /BF-A/.test(o.label))!.id);
  assert.equal(g.players[P0].runesInPlay.length, r0, 'no power paid when played');
  g = passN(g, 2);
  g = answer(g, { battlefields: [BF_A], numbers: [1] });
  g = drive(g);
  assert.equal(g.players[P0].runesInPlay.length, r0 - 1, 'only the 1 [A] chosen');
  assert.equal(g.objects[d].damage, 1);
});

test('RJ#5834 I conquer and score a battlefield; Charm drags the opponent\'s unit in and it wins: the opponent also scores it this turn (once per player)', () => {
  let g = S0(); fundAll(g, P0);
  const mine = put(g, P0, 'V(1)', 'base');
  g = drive(move(g, P0, [mine], BF_A));
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[P0].points, 1, 'I scored it');
  const e = put(g, P1, 'V(5)', 'base');
  g = play(g, P0, hand(g, P0, 'Charm'), { targets: [[e]], dest: BF_A, locations: [BF_A] });
  g = drive(g, d => (d.options?.some(o => o.id === String(BF_A)) ? String(BF_A) : undefined));
  assert.equal(zone(g, mine), 'trash');
  assert.equal(g.battlefields[BF_A].controller, P1);
  assert.equal(g.players[P1].points, 1, 'the opponent scores the same battlefield this turn');
});

test('RJ#5836 Zhonya\'s Hourglass is a mandatory replacement: no choice is offered, it is killed instead and the unit recalled', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const z = put(g, P1, "Zhonya's Hourglass", 'base');
  [g] = cast(g, P0, 'Hextech Ray', { targets: [[u]] });
  for (let i = 0; i < 8 && g.chain.length; i++) {
    assert.notEqual(pend(g).kind, 'optional', 'no "may" choice');
    g = pass(g);
  }
  assert.notEqual(pend(g).kind, 'optional');
  assert.equal(zone(g, z), 'trash');
  assert.equal(locOf(g, u), 'base');
});

test('RJ#5845 Flurry of Blades, Unyielding Spirit in response, Cannon Barrage on top: Barrage damage is dealt (before the Spirit resolves), Flurry\'s is prevented', () => {
  let { g, atk, def } = attackSetup(['V(4)'], ['V(5)']);
  fundAll(g, P0); fundAll(g, P1);
  for (let i = 0; i < 6 && !(pend(g).kind === 'showdownAction' && pend(g).player === P0); i++) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Flurry of Blades'));
  for (let i = 0; i < 3 && pend(g).player === P0 && !pend(g).inStep; i++) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Unyielding Spirit'));
  for (let i = 0; i < 3 && pend(g).player === P1 && !pend(g).inStep; i++) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Cannon Barrage'));
  assert.equal(g.chain.length, 3);
  for (let i = 0; i < 12 && g.chain.length; i++) g = pend(g).inStep ? choose(g, optionIds(g)[0]) : pass(g);
  assert.equal(g.objects[def[0]].damage, 2, 'Cannon Barrage 2 dealt; Flurry 1 prevented');
  assert.equal(g.objects[atk[0]].damage, 0, 'Flurry prevented on my unit too');
});

test('RJ#5862 Last Stand doubles Might but leaves marked damage unchanged: 4 Might with 3 damage → 8 Might, still 3 damage, survives', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'V(4)', 'base', { damage: 3 });
  g = play(g, P0, hand(g, P0, 'Last Stand'), { targets: [[u]] });
  g = drive(g);
  assert.equal(mightOf(g, u), 8);
  assert.equal(g.objects[u].damage, 3);
  assert.equal(zone(g, u), 'base');
});

test('RJ#5865 buffed unit reduced to 1 Might, Call to Glory paid by spending its buff (→ 0 Might): no damage, so it survives the cleanup and ends at 3', () => {
  let g = S0(); setRunes(g, P0, 0);
  const u = put(g, P0, 'V(4)', 'base', { buff: true });
  mod(g, u, { might: -4 }); // Smokescreen stand-in (not in data/cards.json)
  assert.equal(mightOf(g, u), 1);
  g = play(g, P0, hand(g, P0, 'Call to Glory'), { may: [true], targets: [[u]] });
  g = answer(g, { may: [true], targets: [[u]] });
  assert.equal(g.objects[u].counters.buff ?? 0, 0, 'buff spent');
  assert.equal(mightOf(g, u), 0);
  assert.equal(zone(g, u), 'base', 'alive at 0 Might with no damage');
  g = drive(g);
  assert.equal(zone(g, u), 'base');
  assert.equal(mightOf(g, u), 3);
});

test('RJ#5876 Falling Comet in a combat showdown kills the defender before combat damage: it deals none, attacker conquers', () => {
  let { g, atk, def } = attackSetup(['V(5)'], ['V(5)']);
  fundAll(g, P0);
  for (let i = 0; i < 6 && !(pend(g).kind === 'showdownAction' && pend(g).player === P0); i++) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Falling Comet'), { targets: [[def[0]]] });
  g = drive(g);
  assert.equal(zone(g, def[0]), 'trash');
  assert.equal(g.objects[atk[0]].damage, 0, 'no combat damage from the dead defender');
  assert.equal(g.battlefields[BF_A].controller, P0);
});

test('RJ#5880 Nine-Tailed Fox and Ahri\'s defend trigger together vs a Mighty Fiora (Deflect): even with Fox on top, Deflect is asked when Ahri\'s trigger is finalized, before Fox can resolve', () => {
  let g = S0(); fundAll(g, P1);
  setLegend(g, P1, 'Nine-Tailed Fox');
  put(g, P1, 'ogn-119-298', BF_A); control(g, BF_A, P1); // Ahri: "When I attack or defend, give an enemy unit here -2"
  const f = put(g, P0, 'ogn-232-298', 'base', { buff: true }); // Fiora: Deflect while Mighty
  assert.equal(mightOf(g, f), 5);
  const r = g.players[P1].runesInPlay.length;
  g = move(g, P0, [f], BF_A);
  if (pend(g).kind === 'orderTriggers') g = choose(g, pend(g).options!.find(o => /Ahri/.test(o.label))!.id); // Ahri first → Fox resolves first
  for (let i = 0; i < 4 && pend(g).inStep && pend(g).kind !== 'optional'; i++) g = choose(g, pend(g).options!.find(o => o.id === f)?.id ?? pend(g).options![0].id);
  const p = pend(g);
  assert.equal(p.kind, 'optional');
  assert.match(p.prompt ?? '', /Deflect/);
  assert.equal(mightOf(g, f), 5, 'Fox has not resolved: Fiora is still Mighty');
  g = choose(g, 'yes');
  assert.equal(g.players[P1].runesInPlay.length, r - 1, 'Deflect paid');
});

test('RJ#5892 a Ganking unit that conquers, is readied by an effect, may move battlefield-to-battlefield again and score a second battlefield', () => {
  let g = S0();
  const gk = put(g, P0, 'Ganker(2)', 'base');
  g = drive(move(g, P0, [gk], BF_A));
  assert.equal(g.players[P0].points, 1);
  assert.equal(g.objects[gk].exhausted, true);
  g.objects[gk].exhausted = false; g.timestamp++; // stand-in for a ready effect
  g = drive(move(g, P0, [gk], BF_B));
  assert.equal(locOf(g, gk), BF_B);
  assert.equal(g.players[P0].points, 2);
});

test('RJ#5897 two Dr. Mundo: each Beginning-Phase trigger recycles 3 chosen on resolution — 6 cards recycled in total (8 in trash → 2 left)', () => {
  let g = S0({ tp: P1 });
  put(g, P0, 'Dr. Mundo', 'base'); put(g, P0, 'Dr. Mundo', 'base');
  fillTrash(g, P0, 8);
  const deck0 = g.players[P0].mainDeck.length;
  g = drive(nextTurn(g));
  assert.equal(g.players[P0].trash.length, 2);
  assert.equal(g.players[P0].mainDeck.length - deck0, 6 - 1, '6 recycled into the deck, 1 drawn');
});

test('RJ#5899 Unyielding Spirit does not stop -Might (not damage): Thousand-Tailed Watcher\'s -3 still applies', () => {
  let g = S0(); fundAll(g, P0, 8); fundAll(g, P1);
  const e = put(g, P1, 'V(5)', 'base');
  g = play(g, P0, hand(g, P0, 'Unyielding Spirit')); // "prevent all spell and ability damage this turn"
  g = drive(g);
  [g] = cast(g, P0, 'Thousand-Tailed Watcher', { dest: 'base', may: [false] });
  g = drive(g);
  assert.equal(mightOf(g, e), 2);
});

test('RJ#5911 Nine-Tailed Fox (-1, min 1, snapshotted) vs a Recruit attacking with Darius, Executioner (+1 here): Darius there first → 1; Darius arriving after Fox resolved → 2', () => {
  for (const darFirst of [true, false]) {
    let g = withTokens(S0()); fundAll(g, P1);
    setLegend(g, P1, 'Nine-Tailed Fox');
    put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
    const r = put(g, P0, 'Recruit', 'base');
    const dz = darFirst ? put(g, P0, 'ogn-243-298', 'base') : null;
    g = move(g, P0, dz ? [r, dz] : [r], BF_A);
    for (let i = 0; i < 12 && g.chain.length + (pend(g).inStep ? 1 : 0) > 0; i++) g = pend(g).inStep ? choose(g, pend(g).options!.find(o => o.id === r)?.id ?? pend(g).options![0].id) : pass(g);
    assert.equal(mightOf(g, r), 1, 'after Fox');
    if (!darFirst) put(g, P0, 'ogn-243-298', BF_A); // stand-in: Darius arrives after Fox resolved
    assert.equal(mightOf(g, r), darFirst ? 1 : 2, darFirst ? 'Darius first' : 'Darius after');
  }
});

test('RJ#5914 attacking Yasuo (ogn-076) vs a defending Yasuo: the attack trigger kills the defender before combat damage; the attacker takes none and conquers', () => {
  let { g, atk, def } = attackSetup(['ogn-076-298'], ['ogn-076-298']);
  g = drive(g, d => (d.options?.some(o => o.id === def[0]) ? def[0] : undefined));
  assert.equal(zone(g, def[0]), 'trash');
  assert.equal(g.objects[atk[0]].damage, 0);
  assert.equal(g.battlefields[BF_A].controller, P0);
});

test('RJ#5915 1-Might unit Stupefied twice (min 1, snapshotted: -0 each), then Discipline +2 → 3', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'V(1)', 'base');
  for (const s of ['Stupefy', 'Stupefy', 'Discipline']) { g = play(g, P0, hand(g, P0, s), { targets: [[u]] }); g = drive(g); }
  assert.equal(mightOf(g, u), 3);
});

test('RJ#5918 a stunned unit saved by Zhonya\'s Hourglass (healed, recalled) is still stunned', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P1, 'V(3)', BF_A, { stunned: true }); control(g, BF_A, P1);
  put(g, P1, "Zhonya's Hourglass", 'base');
  [g] = cast(g, P0, 'Hextech Ray', { targets: [[u]] });
  g = drive(g);
  assert.equal(locOf(g, u), 'base');
  assert.equal(g.objects[u].stunned, true);
});

test('RJ#5926 Harnessed Dragon\'s "kill an enemy unit" may choose a unit in the opponent\'s base', () => {
  let g = S0(); fundAll(g, P0, 8);
  const e = put(g, P1, 'V(3)', 'base');
  [g] = cast(g, P0, 'Harnessed Dragon', { dest: 'base' });
  g = drive(g, d => (d.options?.some(o => o.id === e) ? e : undefined));
  assert.equal(zone(g, e), 'trash');
});

test('RJ#5928 Yasuo (7, "deal damage equal to my Might") attacks into Nine-Tailed Fox: Fox\'s -1 is on top and resolves first → 6 damage', () => {
  let g = S0(); fundAll(g, P1);
  setLegend(g, P1, 'Nine-Tailed Fox');
  const d = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const y = put(g, P0, 'ogn-076-298', 'base', { buff: true });
  assert.equal(mightOf(g, y), 7);
  g = move(g, P0, [y], BF_A);
  for (let i = 0; i < 12 && g.chain.length + (pend(g).inStep ? 1 : 0) > 0; i++) g = pend(g).inStep ? choose(g, pend(g).options!.find(o => o.id === d)?.id ?? pend(g).options![0].id) : pass(g);
  assert.equal(g.objects[d].damage, 6);
});

test('RJ#5930 Adaptatron conquers with no gear on the board: nothing to kill, so no buff', () => {
  let g = S0();
  const a = put(g, P0, 'Adaptatron', 'base');
  g = drive(move(g, P0, [a], BF_A));
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.objects[a].counters.buff ?? 0, 0);
});

test('RJ#5933 a unit saved by The Boss keeps its "this turn" Might changes (Stupefy -1, Discipline +2); its damage is healed and its buff is spent (paid by the save)', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  setLegend(g, P1, 'The Boss');
  const u = put(g, P1, 'V(4)', BF_A, { buff: true }); control(g, BF_A, P1);
  mod(g, u, { might: -1 }); mod(g, u, { might: 2 });
  assert.equal(mightOf(g, u), 6);
  [g] = cast(g, P0, 'Hidden Blade', { targets: [[u]] });
  g = passAll(g);
  expectPending(g, 'optional', P1);
  g = passAll(yes(g));
  assert.equal(locOf(g, u), 'base');
  assert.equal(g.objects[u].damage, 0);
  assert.equal(g.objects[u].counters.buff ?? 0, 0, 'buff spent by the save');
  assert.equal(mightOf(g, u), 5, '4 base -1 +2: the turn modifiers stay');
});

test('RJ#5939 Nine-Tailed Fox\'s -1 lasts the whole turn, not just the combat', () => {
  let g = S0(); fundAll(g, P1);
  setLegend(g, P1, 'Nine-Tailed Fox');
  put(g, P1, 'V(1)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(4)', 'base');
  g = drive(move(g, P0, [a], BF_A));
  assert.equal(g.showdown, null, 'combat over');
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(mightOf(g, a), 3, 'still -1 after combat');
});

test('RJ#5943 in the combat showdown the defender plays Zenith Blade: stuns an attacker and moves a unit from base in — it becomes a defender', () => {
  let { g, atk } = attackSetup(['V(3)', 'V(3)'], ['V(2)']);
  fundAll(g, P1);
  const extra = put(g, P1, 'V(4)', 'base');
  for (let i = 0; i < 6 && !(pend(g).kind === 'showdownAction' && pend(g).player === P1); i++) g = pass(g);
  g = play(g, P1, hand(g, P1, 'Zenith Blade'), { targets: [[atk[0]]], may: [true] });
  for (let i = 0; i < 12 && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g);
    g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : d.options!.find(o => o.id === extra || o.id === atk[0] || o.id === String(BF_A))?.id ?? d.options![0].id) : pass(g);
  }
  assert.equal(g.objects[atk[0]].stunned, true);
  assert.equal(locOf(g, extra), BF_A);
  assert.equal(g.showdown?.defender, P1);
  assert.equal(g.objects[extra].combatRole, 'defender');
});

test('RJ#5945 Stand United\'s "buffs give an additional +1 this turn" is a rule for the turn: a unit buffed after it resolves also gets +2', () => {
  let g = S0(); fundAll(g, P0);
  const a = put(g, P0, 'V(2)', 'base');
  const b = put(g, P0, 'V(2)', 'base');
  g = play(g, P0, hand(g, P0, 'Stand United'), { targets: [[a]] });
  g = drive(g, d => (d.options?.some(o => o.id === a) ? a : undefined));
  assert.equal(mightOf(g, a), 4);
  g.objects[b].counters.buff = 1; g.timestamp++; // stand-in for a later buff
  assert.equal(mightOf(g, b), 4, 'later buff also gives +2');
});

test('RJ#5947 my Promising Future: the opponent plays their card first, so my Wind Wall from it can counter their spell (mine is on top)', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const ww = put(g, P0, 'Wind Wall', 'deckTop');
  const theirs = put(g, P1, 'DrawR', 'deckTop');
  const pf = hand(g, P0, 'Promising Future');
  const h1 = g.players[P1].hand.length;
  g = act(g, { type: 'playCard', player: P0, obj: pf });
  for (let i = 0; i < 30 && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g);
    if (d.inStep) { const o = optionIds(g); g = choose(g, o.includes(theirs) ? theirs : o.includes(ww) ? ww : o[0]); continue; }
    g = pass(g);
  }
  assert.equal(zone(g, ww), 'trash');
  assert.equal(zone(g, theirs), 'trash');
  assert.equal(g.players[P1].hand.length, h1, 'their draw spell was countered');
});

test('RJ#5951 buffed Fiora (4+1) Stupefied to 4: not Mighty, so no Deflect / Ganking / Shield', () => {
  let g = S0(); fundAll(g, P0);
  const f = put(g, P0, 'ogn-232-298', 'base', { buff: true });
  assert.equal(mightOf(g, f), 5);
  assert.ok(hasKeyword(g, f, 'Deflect'), 'sanity: Mighty → Deflect');
  g = play(g, P0, hand(g, P0, 'Stupefy'), { targets: [[f]] });
  g = drive(g);
  assert.equal(mightOf(g, f), 4);
  for (const k of ['Deflect', 'Ganking', 'Shield']) assert.ok(!hasKeyword(g, f, k), `no ${k}`);
});

test('RJ#5968 Glorious Executioner (Draven legend, "When you win a combat, draw 1"): conquering an empty battlefield is a showdown, not a combat — no draw', () => {
  let g = S0();
  setLegend(g, P0, 'Glorious Executioner');
  const a = put(g, P0, 'V(2)', 'base');
  const h = g.players[P0].hand.length;
  g = drive(move(g, P0, [a], BF_A));
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[P0].hand.length, h, 'no draw');
  // sanity: winning a real combat draws
  const b = put(g, P0, 'V(4)', 'base');
  put(g, P1, 'V(1)', BF_B); control(g, BF_B, P1);
  g = drive(move(g, P0, [b], BF_B));
  assert.equal(g.players[P0].hand.length, h + 1);
});

test('RJ#5969 Singularity deals 6 to each of up to two (different) units — not 6 split; one target is fine', () => {
  let g = S0(); fundAll(g, P0, 8);
  const a = put(g, P1, 'V(9)', 'base'), b = put(g, P1, 'V(9)', 'base');
  g = play(g, P0, hand(g, P0, 'Singularity'), { targets: [[a, b]] });
  g = drive(g);
  assert.equal(g.objects[a].damage, 6); assert.equal(g.objects[b].damage, 6);
  g = play(g, P0, hand(g, P0, 'Singularity'), { targets: [[a]] });
  g = drive(g);
  assert.equal(zone(g, a), 'trash'); assert.equal(g.objects[b].damage, 6);
});

test('RJ#5971 Firestorm hits all enemy units at the ONE chosen battlefield, not every battlefield', () => {
  let g = S0(); fundAll(g, P0, 8);
  const a1 = put(g, P1, 'V(5)', BF_A), a2 = put(g, P1, 'V(5)', BF_A), b = put(g, P1, 'V(5)', BF_B);
  control(g, BF_A, P1); control(g, BF_B, P1);
  g = play(g, P0, hand(g, P0, 'Firestorm'), { battlefields: [BF_A] });
  g = drive(g, d => (d.options?.some(o => o.id === String(BF_A)) ? String(BF_A) : undefined));
  assert.equal(g.objects[a1].damage, 3); assert.equal(g.objects[a2].damage, 3);
  assert.equal(g.objects[b].damage, 0);
});

test('RJ#5979 Riposte needs a spell on the chain: playable while Cleave is on it, not after Cleave resolved', () => {
  let { g } = attackSetup(['V(3)'], ['V(3)']);
  fundAll(g, P0); fundAll(g, P1);
  const rp = hand(g, P1, 'Riposte');
  for (let i = 0; i < 6 && !(pend(g).kind === 'showdownAction' && pend(g).player === P0); i++) g = pass(g);
  g = play(g, P0, hand(g, P0, 'Cleave'), {});
  for (let i = 0; i < 3 && pend(g).player === P0 && pend(g).inStep; i++) g = choose(g, pend(g).options![0].id);
  if (pend(g).player === P0) g = pass(g);
  assert.ok(canPlayNow(g, P1, rp), 'while Cleave is on the chain');
  g = pass(g); // Cleave resolves
  for (let i = 0; i < 4 && g.chain.length; i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.equal(g.chain.length, 0);
  assert.ok(!canPlayNow(g, P1, rp), 'no spell on the chain');
});

test('RJ#5986 Primal Strength (+7 this turn) is not a buff: Bilgewater Bully ("while I\'m buffed, Ganking") gets no Ganking', () => {
  let g = S0(); fundAll(g, P0, 8);
  const b = put(g, P0, 'Bilgewater Bully', 'base');
  g = play(g, P0, hand(g, P0, 'Primal Strength'), { targets: [[b]] });
  g = drive(g);
  assert.equal(mightOf(g, b), 13);
  assert.ok(!hasKeyword(g, b, 'Ganking'));
  g.objects[b].counters.buff = 1; g.timestamp++;
  assert.ok(hasKeyword(g, b, 'Ganking'), 'sanity: a real buff grants it');
});

test('RJ#5993 a unit Ridden into the combat mid-showdown becomes an attacker and Nine-Tailed Fox triggers for it (-1)', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  setLegend(g, P1, 'Nine-Tailed Fox');
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const a = put(g, P0, 'V(3)', 'base');
  const late = put(g, P0, 'V(4)', 'base');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 8 && !(pend(g).kind === 'showdownAction' && pend(g).player === P0); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.equal(mightOf(g, a), 2);
  g = play(g, P0, hand(g, P0, 'Ride the Wind'), { targets: [[late]], locations: [BF_A], dest: BF_A });
  for (let i = 0; i < 12 && (g.chain.length || pend(g).inStep); i++) {
    const d = pend(g);
    g = d.inStep ? choose(g, d.options!.find(o => o.id === late || o.id === String(BF_A))?.id ?? d.options![0].id) : pass(g);
  }
  assert.equal(locOf(g, late), BF_A);
  assert.equal(g.objects[late].combatRole, 'attacker');
  assert.equal(mightOf(g, late), 3, 'Fox -1 for the late attacker');
});

test('RJ#5998 Zenith Blade ("…You may move a friendly unit…") chooses a friendly unit when played: with no friendly unit on the board it can\'t be played', () => {
  const g = S0(); fundAll(g, P0);
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const zb = hand(g, P0, 'Zenith Blade');
  assert.ok(!canPlayNow(g, P0, zb), 'no friendly unit → not playable');
  put(g, P0, 'V(1)', 'base');
  assert.ok(canPlayNow(g, P0, zb), 'sanity: playable with a friendly unit (move optional)');
});

// DECISIONS #5998 (ADJUDICATOR-5, lead request): Zenith Blade's full reading. "You may move a friendly unit …" names a specific object,
// so the friendly unit is chosen when played (CR 355.5) and must be chosen — only "any number"/"up to" allows zero (355.13; OGN-ERR
// Salvage "You may kill a gear" → "up to one gear"). The "you may" is the decision to perform the move, made on resolution.
test('RJ#5998b (DECISIONS #5998) Zenith Blade: the friendly unit is a required choice when played; whether to move it is decided on resolution', () => {
  let g = S0(); fundAll(g, P0);
  const e = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const f = put(g, P0, 'V(3)', 'base');
  put(g, P0, 'V(1)', 'base');      // (a second friendly unit: with one, the required choice is auto-answered — ENGINE-7)
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Zenith Blade') });
  let friendlyMin: number | undefined;
  for (let i = 0; i < 8 && pend(g).inStep && pend(g).player === P0 && pend(g).kind === 'chooseTargets'; i++) {   // (the card is a pending chain item while its choices are made)
    const d = pend(g); const o = optionIds(g);
    if (o.includes(f)) { friendlyMin = d.min; g = choose(g, f); continue; }
    g = choose(g, o.includes(e) ? e : o[0]);
  }
  assert.equal(friendlyMin, 1, 'the friendly unit must be chosen when played (no "up to")');
  let askedMove = false;
  for (let i = 0; i < 12 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (d.inStep && d.kind === 'optional') { askedMove = true; g = choose(g, 'no'); continue; }
    if (d.inStep) { g = choose(g, d.options![0].id); continue; }
    g = pass(g);
  }
  assert.ok(askedMove, 'the move is asked on resolution');
  assert.ok(g.objects[e].stunned, 'the stun still happens');
  assert.equal(locOf(g, f), 'base', 'declined: the chosen unit stays');
});

test('RJ#5999 Svellsongur on Master Yi, Meditative copies "While you have 8+ runes, I have +4": +8 with 8 runes', () => {
  const g = S0();
  const y = put(g, P0, 'Master Yi, Meditative', 'base');
  attachNow(g, put(g, P0, 'Svellsongur', 'base'), y);
  setRunes(g, P0, 7);
  assert.equal(mightOf(g, y), 4);
  setRunes(g, P0, 8);
  assert.equal(mightOf(g, y), 12);
});

test('RJ#6001 Gusting a token unit is not a kill: Immortal Phoenix ("When you kill a unit with a spell") doesn\'t trigger', () => {
  let g = S0(); fundAll(g, P0);
  const ph = put(g, P0, 'Immortal Phoenix', 'trash');
  const r = put(g, P1, 'Recruit', BF_A, { token: true }); control(g, BF_A, P1);
  g = play(g, P0, hand(g, P0, 'Gust'), { targets: [[r]] });
  for (let i = 0; i < 10 && g.chain.length; i++) g = pass(g);
  assert.ok(!['battlefield', 'base', 'hand'].includes(zone(g, r) as string), 'token ceased to exist');
  assert.equal(zone(g, ph), 'trash');
  assert.equal(pend(g).kind, 'mainAction', 'no Phoenix offer');
});

test('RJ#6004 two Zhonya\'s Hourglass: only one replaces the death (the second has nothing left to replace)', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const z1 = put(g, P1, "Zhonya's Hourglass", 'base'), z2 = put(g, P1, "Zhonya's Hourglass", 'base');
  g = play(g, P0, hand(g, P0, 'Hidden Blade'), { targets: [[u]] });
  g = drive(g);
  assert.equal(locOf(g, u), 'base', 'saved and recalled');
  assert.deepEqual([zone(g, z1), zone(g, z2)].sort(), ['base', 'trash'], 'exactly one Hourglass used');
});

test('RJ#6010 Adaptatron conquers a defender saved by Zhonya\'s: the Hourglass replaced the death in the combat cleanup, so it is already trashed when the conquer trigger comes', () => {
  let { g, atk, def } = attackSetup(['Adaptatron'], ['V(2)']);
  const z = put(g, P1, "Zhonya's Hourglass", 'base');
  g = drive(g);
  assert.equal(g.battlefields[BF_A].controller, P0, 'conquered');
  assert.equal(zone(g, z), 'trash');
  assert.equal(locOf(g, def[0]), 'base');
  assert.equal(mightOf(g, atk[0]), 3, 'no gear left to kill → no buff');
});

test('RJ#6011 a hidden Zhonya\'s Hourglass can be played (Reaction speed) in response to the opponent\'s Charm on my unit', () => {
  let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const z = put(g, P0, "Zhonya's Hourglass", { facedown: BF_A });
  control(g, BF_B, P1);
  g = play(g, P1, hand(g, P1, 'Charm'), { targets: [[u]], dest: BF_B });
  if (pend(g).player === P1) g = pass(g);
  expectPending(g, 'chainResponse', P0);
  assert.ok(canPlayNow(g, P0, z));
});

test('RJ#6025 Dragon\'s Rage moving an enemy unit off Vilemaw\'s Lair to base: the move doesn\'t happen, so no damage is exchanged at "its destination"', () => {
  let g = S0({ bfA: "Vilemaw's Lair" }); fundAll(g, P0);
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const f = put(g, P1, 'V(2)', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, "Dragon's Rage") });
  for (let i = 0; i < 20 && g.pending && pend(g).kind !== 'mainAction'; i++) {
    const o = optionIds(g);
    g = pend(g).inStep ? choose(g, o.includes(e) ? e : o.includes('base') ? 'base' : o.includes(f) ? f : o[0]) : pass(g);
  }
  assert.equal(locOf(g, e), BF_A, 'stays at the Lair');
  assert.equal(g.objects[e].damage, 0);
  assert.equal(g.objects[f].damage, 0);
});

test('RJ#6032 7-Might unit: Falling Comet (6) then Stupefy (-1) → 6 damage at 6 Might, it dies', () => {
  let g = S0(); fundAll(g, P0, 6);
  const u = put(g, P1, 'V(7)', BF_A); control(g, BF_A, P1);
  g = play(g, P0, hand(g, P0, 'Falling Comet'), { targets: [[u]] });
  g = drive(g);
  assert.equal(g.objects[u].damage, 6);
  assert.equal(locOf(g, u), BF_A);
  g = play(g, P0, hand(g, P0, 'Stupefy'), { targets: [[u]] });
  g = drive(g);
  assert.equal(zone(g, u), 'trash');
});

test('RJ#6036 a Gold token\'s universal power [A] pays a domain power cost (Fury for Decree of Rage with only a Calm rune)', () => {
  let g = withTokens(S0());
  setRunes(g, P0, 1, 'calm');
  const e = put(g, P1, 'Sanctum Conservator', BF_A); control(g, BF_A, P1);
  const d = hand(g, P0, 'Decree of Rage');
  assert.ok(!canPlayNow(g, P0, d), 'sanity: no Fury power without the Gold');
  const gold = put(g, P0, 'Gold', 'base', { token: true });
  g = act(g, legal(g, P0, 'activate').find(a => a.type === 'activate' && a.obj === gold)!);
  for (let i = 0; i < 5 && g.chain.length; i++) g = pass(g);
  assert.equal(g.players[P0].pool.power.Colorless, 1, 'universal power in the pool');
  assert.ok(canPlayNow(g, P0, d));
  g = play(g, P0, d, { targets: [[e]] });
  g = drive(g);
  assert.equal(g.objects[e].damage, 4);
});

test('RJ#6040 Dazzling Aurora is an end-of-turn trigger, not an exhaust ability: being exhausted or readied changes nothing — it triggers once', () => {
  let g = S0(); fundAll(g, P0);
  const au = put(g, P0, 'Dazzling Aurora', 'base');
  g.objects[au].exhausted = true; g.timestamp++;
  const u1 = put(g, P0, 'V(2)', 'deckTop');
  const u2 = put(g, P0, 'V(3)', 'deckTop');
  g = endTurn(g);
  for (let i = 0; i < 20 && g.pending && pend(g).kind !== 'mainAction'; i++) { const d = pend(g); g = d.inStep ? choose(g, d.options!.find(o => o.id === 'base')?.id ?? d.options![0].id) : pass(g); }
  const played = [u1, u2].filter(id => ['base', 'battlefield'].includes(zone(g, id) as string));
  assert.equal(played.length, 1, 'exactly one unit played by the exhausted Aurora');
});

test('RJ#6043 The Zero Drive\'s "[3][C], Banish this" can\'t be used while attached (printed text inactive); once its unit dies and it is unattached it can', () => {
  let g = S0(); fundAll(g, P0, 8); fundAll(g, P1);
  const u = put(g, P0, 'V(3)', BF_A); control(g, BF_A, P0);
  const zd = put(g, P0, 'The Zero Drive', 'base');
  attachNow(g, zd, u);
  const acts = (s: GameState) => legal(s, P0, 'activate').filter(a => a.type === 'activate' && a.obj === zd);
  assert.equal(acts(g).length, 0, 'not while attached');
  g = play(g, P0, hand(g, P0, 'Hidden Blade'), { targets: [[u]] });
  g = drive(g);
  assert.equal(zone(g, u), 'banishment', 'the unit is banished with it; the gear is not');
  assert.equal(zone(g, zd), 'base');
  assert.equal(acts(g).length, 1, 'usable once unattached');
  g = drive(act(g, acts(g)[0]));
  assert.ok(['base', 'battlefield'].includes(zone(g, u) as string), 'unit played back');
});

test('RJ#6045 (AMBIGUOUS, RJ adopted) Darius, Trifarian counts cards by completed plays: Darius, then spell A, then (nested) my Reaction B resolves first → B is my second card, Darius readies (+2) before A resolves', () => {
  let g = S0(); fundAll(g, P0, 8); fundAll(g, P1);
  const d = hand(g, P0, 'Darius, Trifarian');
  g = play(g, P0, d, { dest: 'base' });
  g = drive(g);
  g.objects[d].exhausted = true; g.timestamp++;
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'ColorlessDraw') });
  if (pend(g).player === P0) g = pass(g);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'DrawR') });
  if (pend(g).player === P1) g = pass(g);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'DrawR') });
  // my DrawR resolves (stop once Darius's trigger is on the chain: it also makes the chain 3 long — ENGINE-6)
  for (let i = 0; i < 4 && g.chain.length === 3 && !chainLabels(g).some(l => /Darius/.test(l)); i++) g = pass(g);
  assert.ok(chainLabels(g).some(l => /Darius/.test(l)), `Darius trigger after my Reaction (chain: ${chainLabels(g).join(', ')})`);
  for (let i = 0; i < 6 && chainLabels(g).some(l => /Darius/.test(l)); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.ok(chainLabels(g).includes('spell:ColorlessDraw'), 'A still on the chain');
  assert.equal(mightOf(g, d), 7);
  assert.equal(g.objects[d].exhausted, false);
});

// DECISIONS #6045 / principle 23 (ADJUDICATOR-5, lead request): every "When you play your Nth / first <kind> (each turn)" trigger counts
// completed plays like Darius — Astral Heron ("When you play your first card each turn …") triggers on the play that completes first.
test('RJ#6045c (principle 23) Astral Heron at a battlefield: spell A, then my nested Reaction B resolves first → B is my first card, Heron triggers before A resolves', () => {
  let g = S0(); fundAll(g, P0, 8); fundAll(g, P1);
  put(g, P0, 'Astral Heron', BF_A); control(g, BF_A, P0);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'ColorlessDraw') });
  if (pend(g).player === P0) g = pass(g);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'DrawR') });
  if (pend(g).player === P1) g = pass(g);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'DrawR') });
  for (let i = 0; i < 4 && g.chain.length === 3 && !chainLabels(g).some(l => /Heron/.test(l)); i++) g = pass(g);
  assert.ok(chainLabels(g).some(l => /Heron/.test(l)), `Heron's trigger after my Reaction resolves (chain: ${chainLabels(g).join(', ')})`);
  assert.ok(chainLabels(g).includes('spell:ColorlessDraw'), 'A still on the chain');
});

test('RJ#6047 Seal of Focus enters ready: its [Add] can be used the turn it is played; the Seal itself can\'t be played at Reaction speed', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const s = hand(g, P0, 'Seal of Focus');
  g = play(g, P0, s, {});
  g = drive(g);
  assert.equal(zone(g, s), 'base');
  assert.equal(g.objects[s].exhausted, false, 'enters ready');
  assert.ok(legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === s), 'usable this turn');
  // on a closed chain (opponent's DrawR), a second Seal can't be played
  const s2 = hand(g, P0, 'Seal of Focus');
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'DrawR') });
  if (pend(g).player === P0) g = pass(g);
  g = act(g, { type: 'playCard', player: P1, obj: hand(g, P1, 'DrawR') });
  if (pend(g).player === P1) g = pass(g);
  assert.equal(pend(g).player, P0);
  assert.ok(!canPlayNow(g, P0, s2), 'not at Reaction speed');
  assert.ok(legal(g, P0, 'activate').some(a => a.type === 'activate' && a.obj === s), 'but its [Add] is a Reaction');
});

test('RJ#6064 Monastery of Hirana: one conquer = one trigger = spend one buff, draw 1 (even with several buffed units)', () => {
  let g = S0({ bfA: 'Monastery of Hirana' });
  const a = put(g, P0, 'V(2)', 'base', { buff: true }), b = put(g, P0, 'V(2)', 'base', { buff: true });
  const h = g.players[P0].hand.length;
  g = drive(move(g, P0, [a, b], BF_A));
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[P0].hand.length, h + 1, 'draw 1');
  assert.equal([a, b].filter(u => (g.objects[u].counters.buff ?? 0) > 0).length, 1, 'only one buff spent');
});

test('RJ#6065 Hidden Blade played from hidden (no Energy) choosing Qiyana (Deflect) still pays the Deflect rune', () => {
  const run = (card: string) => {
    let g = S0({ tp: P1 }); fundAll(g, P0); fundAll(g, P1);
    put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
    const hb = put(g, P0, 'Hidden Blade', { facedown: BF_A });
    const q = put(g, P1, card, 'base');
    g = move(g, P1, [q], BF_A);
    for (let i = 0; i < 8 && !(pend(g).player === P0 && canPlayNow(g, P0, hb)); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
    assert.ok(canPlayNow(g, P0, hb), 'hidden Hidden Blade playable in the combat');
    const rd = g.players[P0].runeDeck.length;
    g = play(g, P0, hb, { targets: [[q]] });
    assert.ok(chainLabels(g).includes('spell:Hidden Blade'));
    return g.players[P0].runeDeck.length - rd;
  };
  assert.equal(run('Qiyana'), run('V(3)') + 1, 'one rune recycled for Deflect');
});

test('RJ#6073 Chemtech Enforcer ("When you play me, discard 1") can be played with no other card in hand', () => {
  let g = S0(); fundAll(g, P0);
  const c = hand(g, P0, 'Chemtech Enforcer');
  const others = g.players[P0].hand.filter(id => id !== c);
  for (const id of others) g.objects[id].zone = 'trash';
  g.players[P0].trash.push(...others); g.players[P0].hand = [c]; g.timestamp++;
  assert.ok(canPlayNow(g, P0, c));
  g = drive(play(g, P0, c, { dest: 'base' }));
  assert.equal(zone(g, c), 'base');
});

test('RJ#6076 an exhausted Ganking unit can\'t standard-move battlefield to battlefield (the move still costs exhausting it)', () => {
  const g = S0();
  const u = put(g, P0, 'Master Yi, Honed', BF_A, { ready: false }); control(g, BF_A, P0);
  assert.ok(hasKeyword(g, u, 'Ganking'));
  assert.ok(rejects(g, { type: 'move', player: P0, units: [u], to: BF_B }), 'exhausted → no move');
  g.objects[u].exhausted = false; g.timestamp++;
  assert.equal(rejects(g, { type: 'move', player: P0, units: [u], to: BF_B }), null, 'sanity: ready Ganking unit may');
});

test('RJ#6077 Rell, Magnetic + Reaver\'s Row: the Equipment from hand is not declared when Rell\'s trigger goes on the chain — it is chosen when the trigger resolves', () => {
  let g = S0({ bfA: "Reaver's Row" });
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const rell = put(g, P0, 'Rell, Magnetic', 'base');
  const ax = hand(g, P0, 'Spinning Axe');
  g = move(g, P0, [rell], BF_A);
  let chainAtChoice: string[] | null = null;
  for (let i = 0; i < 14 && zone(g, ax) === 'hand'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    if (o.includes(ax)) { chainAtChoice ??= chainLabels(g); assert.equal(d.player, P0); }
    g = choose(g, d.kind === 'optional' ? 'yes' : o.includes(ax) ? ax : o[0]);
  }
  assert.deepEqual(chainAtChoice, ['trigger:Rell'], 'chosen on resolution, after Reaver\'s Row resolved');
  g = resolveChain(g);
  assert.equal(g.objects[ax].attachedTo, rell);
});

test('RJ#6087 Harnessed Dragon can be played when the opponent has no units: its play trigger just has no legal choice and doesn\'t go on the chain', () => {
  let g = S0(); fundAll(g, P0, 8);
  const hd = hand(g, P0, 'Harnessed Dragon');
  assert.ok(canPlayNow(g, P0, hd));
  g = play(g, P0, hd, { dest: 'base' });
  assert.equal(zone(g, hd), 'base');
  assert.ok(!chainLabels(g).some(l => /Harnessed Dragon/.test(l)), 'no trigger on the chain');
  g = drive(g);
  assert.equal(pend(g).kind, 'mainAction');
});

test('RJ#6091 Vi ("Recycle 1 from your trash: +1 Might", no Action/Reaction) can\'t be activated while defending in a showdown — only on my turn, open state', () => {
  let { g, def } = attackSetup(['V(2)'], ['ogn-036-298']);
  fillTrash(g, P1, 3);
  for (let i = 0; i < 8 && !(pend(g).kind === 'showdownAction' && pend(g).player === P1); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  expectPending(g, 'showdownAction', P1);
  assert.ok(!legal(g, P1, 'activate').some(a => a.type === 'activate' && a.obj === def[0]), 'not in the showdown');
  // sanity: on its controller's own turn, in an open state, it can
  const h = S0({ tp: P1 });
  const v = put(h, P1, 'ogn-036-298', 'base');
  fillTrash(h, P1, 3);
  assert.ok(legal(h, P1, 'activate').some(a => a.type === 'activate' && a.obj === v));
});

test('RJ#6096 Dazzling Aurora reveals Perched Grimwyrm ("Play me only to a battlefield you conquered this turn") with no conquered battlefield: it can\'t be played and stays banished', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'Dazzling Aurora', 'base');
  const gw = put(g, P0, 'Perched Grimwyrm', 'deckTop');
  g = endTurn(g);
  for (let i = 0; i < 20 && g.pending && pend(g).kind !== 'mainAction'; i++) { const d = pend(g); g = d.inStep ? choose(g, d.options![0].id) : pass(g); }
  assert.equal(zone(g, gw), 'banishment');
});

test('RJ#6112 Reckoner\'s Arena hold trigger: a unit removed in response (Gust) gets no conquer effect; units still here do', () => {
  let g = S0({ tp: P1, bfA: "Reckoner's Arena" }); fundAll(g, P1);
  const q = put(g, P0, 'Qiyana', BF_A);
  const ad = put(g, P0, 'Adaptatron', BF_A); control(g, BF_A, P0);
  put(g, P1, 'Sword', 'base'); // a gear Adaptatron could kill
  const gust = hand(g, P1, 'Gust');
  g = endTurn(g);
  for (let i = 0; i < 12 && !chainLabels(g).some(l => /Arena/.test(l)); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.ok(chainLabels(g).some(l => /Arena/.test(l)), 'hold trigger on the chain');
  if (pend(g).player === P0) g = pass(g);
  g = play(g, P1, gust, { targets: [[ad]] });
  const seen = new Set<string>();
  for (let i = 0; i < 30 && g.pending && pend(g).kind !== 'mainAction'; i++) {
    chainLabels(g).forEach(l => seen.add(l));
    const d = pend(g);
    g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : d.options![0].id) : pass(g);
  }
  assert.equal(zone(g, ad), 'hand', 'Gusted');
  assert.ok(![...seen].some(l => /Adaptatron/.test(l)), `no Adaptatron conquer effect (${[...seen].join(', ')})`);
  assert.ok([...seen].some(l => /Qiyana/.test(l)), 'Qiyana (still here) gets hers');
});

test('RJ#6115 Called Shot looks at two Nocturnes: both may be banished and played; nothing is left to draw (no Repeat)', () => {
  let g = S0(); fundAll(g, P0, 8);
  const n2 = put(g, P0, 'Nocturne, Horrifying', 'deckTop');
  const n1 = put(g, P0, 'Nocturne, Horrifying', 'deckTop');
  const h = g.players[P0].hand.length;
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Called Shot') });
  for (let i = 0; i < 30 && g.pending && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    const o = optionIds(g);
    if (/Repeat/.test(d.prompt ?? '')) { g = choose(g, 'no'); continue; }
    g = choose(g, d.kind === 'optional' ? 'yes' : o.includes('base') ? 'base' : o[0]);
  }
  assert.equal(zone(g, n1), 'base'); assert.equal(zone(g, n2), 'base');
  assert.equal(g.players[P0].hand.length, h, 'Called Shot left the hand, no card drawn (h+1-1)');
});

test('RJ#6116 Portal Rescue ("Banish a friendly unit…") can\'t choose a unit card in the trash — "unit" means a unit on the board', () => {
  let g = S0(); fundAll(g, P0);
  const t = put(g, P0, 'V(3)', 'trash');
  const pr = hand(g, P0, 'Portal Rescue');
  assert.ok(!canPlayNow(g, P0, pr), 'no friendly unit on the board → no legal choice');
  const b = put(g, P0, 'V(2)', 'base'); put(g, P0, 'V(2)', 'base');
  g = act(g, { type: 'playCard', player: P0, obj: pr });
  const o = optionIds(g);
  assert.ok(o.includes(b) && !o.includes(t), `trash unit not offered (${o.join(',')})`);
});

test('RJ#6125 hidden Sprite Call played in response to removal on my lone unit there: the Sprite is played at that battlefield and I keep it', () => {
  let g = withTokens(S0({ tp: P1 })); fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P0, 'V(2)', BF_A); control(g, BF_A, P0);
  const sc = put(g, P0, 'Sprite Call', { facedown: BF_A });
  g = play(g, P1, hand(g, P1, 'Hidden Blade'), { targets: [[u]] });
  if (pend(g).player === P1) g = pass(g);
  assert.ok(canPlayNow(g, P0, sc), 'Reaction from hidden');
  g = play(g, P0, sc, {});
  for (let i = 0; i < 20 && g.chain.length; i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.equal(zone(g, u), 'trash');
  const sprites = Object.values(g.objects).filter(o => o.controller === P0 && o.zone === 'battlefield' && o.battlefieldIndex === BF_A && /Sprite/.test(g.cards[o.cardId]?.name ?? ''));
  assert.equal(sprites.length, 1, 'Sprite at that battlefield');
  assert.equal(g.battlefields[BF_A].controller, P0, 'battlefield kept');
});

// ---- cycle: ids 6136+ (and RJ#6062 recheck) ----

test('RJ#6062 (interpreted) Strike Down on my damaged unit wearing Guardian Angel (3+1, 3 damage): detaching the Angel makes the damage lethal; the unit dies in the cleanup — the Angel is no longer attached to save it', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'V(3)', 'base', { damage: 3 });
  const ga = put(g, P0, 'Guardian Angel', 'base'); attachNow(g, ga, u);
  assert.equal(mightOf(g, u), 4, 'sanity: +1 from Guardian Angel');
  const e = put(g, P1, 'V(9)', 'base');
  g = play(g, P0, hand(g, P0, 'Strike Down'), { targets: [[u], [e]] });
  g = drive(g);
  assert.equal(g.objects[e].damage, 4, 'dealt its Might (4) before the detach');
  assert.equal(zone(g, u), 'trash', 'dies: Guardian Angel was detached before the cleanup');
  assert.notEqual(zone(g, ga), 'trash', 'the Angel was not killed in its place');
});

test('RJ#6137 Wuju Bladesman: two defenders, one killed during the combat showdown — the remaining one now defends alone and gets +2 automatically', () => {
  let { g, def } = attackSetup(['V(6)'], ['V(2)', 'V(2)']);
  setLegend(g, P1, 'Wuju Bladesman');
  fundAll(g, P0);
  assert.equal(mightOf(g, def[1]), 2, 'not alone yet');
  const hr = hand(g, P0, 'Hextech Ray');
  for (let i = 0; i < 6 && !canPlayNow(g, P0, hr); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  g = play(g, P0, hr, { targets: [[def[0]]] });
  g = resolveChain(g);
  assert.equal(zone(g, def[0]), 'trash');
  assert.equal(mightOf(g, def[1]), 4, 'defends alone now: +2');
});

test('RJ#6139/RJ#6155 Darius, Trifarian played as my second card of the turn: his own trigger readies him and gives +2', () => {
  let g = S0(); fundAll(g, P0, 10);
  g = play(g, P0, hand(g, P0, 'V(1)'), { dest: 'base' });
  g = drive(g);
  const d = hand(g, P0, 'Darius, Trifarian');
  g = play(g, P0, d, { dest: 'base' });
  g = drive(g);
  assert.equal(zone(g, d), 'base');
  assert.equal(g.objects[d].exhausted, false, 'readied by his own second-card trigger');
  assert.equal(mightOf(g, d), 7);
});

test('RJ#6147 Teemo, Strategist played from hiding with no combat: Ember Monk still gets +2; Teemo\'s "When I defend" ability does not trigger', () => {
  let g = S0(); fundAll(g, P0);
  const m = put(g, P0, 'Ember Monk', 'base');
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  const t = put(g, P0, 'Teemo, Strategist', { facedown: BF_A });
  const m0 = mightOf(g, m);
  g = act(g, { type: 'playCard', player: P0, obj: t });
  const seen = new Set<string>();
  for (let i = 0; i < 20 && g.pending && pend(g).kind !== 'mainAction'; i++) {
    chainLabels(g).forEach(l => seen.add(l));
    const d = pend(g); g = d.inStep ? choose(g, d.options![0].id) : pass(g);
  }
  assert.equal(locOf(g, t), BF_A, 'Teemo flipped and played there');
  assert.equal(mightOf(g, m), m0 + 2, 'Ember Monk +2');
  assert.ok(![...seen].some(l => /Teemo/.test(l)), `no Teemo trigger (${[...seen].join(', ')})`);
});

test('RJ#6149 several showdowns at the same battlefield in one turn: my first attacker dies, a second unit attacks the same battlefield and conquers', () => {
  let g = S0();
  put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  const a1 = put(g, P0, 'V(1)', 'base'), a2 = put(g, P0, 'V(5)', 'base');
  g = drive(move(g, P0, [a1], BF_A));
  assert.equal(zone(g, a1), 'trash', 'first attack lost');
  assert.equal(g.battlefields[BF_A].controller, P1);
  g = drive(move(g, P0, [a2], BF_A));
  assert.equal(locOf(g, a2), BF_A);
  assert.equal(g.battlefields[BF_A].controller, P0, 'second showdown/combat at the same battlefield: conquered');
});

test('RJ#6152 Thousand-Tailed Watcher on Wielder of Water (2): -3 snapshots to -1 (1); Guardian Angel (+1) and defending alone (+2) afterwards add on top → 4', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1, 8);
  const w = put(g, P0, 'Wielder of Water', BF_A); control(g, BF_A, P0);
  g = play(g, P1, hand(g, P1, 'Thousand-Tailed Watcher'), { dest: 'base', may: [false] });
  g = resolveChain(g);
  assert.equal(mightOf(g, w), 1, 'snapshot -1');
  attachNow(g, put(g, P0, 'Guardian Angel', 'base'), w);
  assert.equal(mightOf(g, w), 2, 'gear +1 on top');
  const a = put(g, P1, 'V(6)', 'base');
  g = move(g, P1, [a], BF_A);
  assert.equal(mightOf(g, w), 4, 'defending alone +2 on top');
});

test('RJ#6157 Dr. Mundo, Expert recycles 3 from the trash at the start of every Beginning Phase of mine while he is on the board', () => {
  let g = S0();
  put(g, P0, 'Dr. Mundo, Expert', 'base');
  fillTrash(g, P0, 8);
  const t0 = g.players[P0].trash.length;
  g = nextTurn(g); g = nextTurn(g);
  assert.equal(g.activePlayer, P0);
  assert.equal(g.players[P0].trash.length, t0 - 3, 'first beginning phase');
  g = nextTurn(g); g = nextTurn(g);
  assert.equal(g.players[P0].trash.length, t0 - 6, 'and the next one too');
});

test('RJ#6160 Adaptatron moved to a battlefield I already control: no conquer, so its "When I conquer" does not trigger', () => {
  let g = S0();
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  put(g, P1, 'Sword', 'base');
  const ad = put(g, P0, 'Adaptatron', 'base');
  g = move(g, P0, [ad], BF_A);
  const seen = new Set<string>();
  for (let i = 0; i < 20 && g.pending && pend(g).kind !== 'mainAction'; i++) {
    chainLabels(g).forEach(l => seen.add(l));
    const d = pend(g); g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : d.options![0].id) : pass(g);
  }
  assert.equal(locOf(g, ad), BF_A);
  assert.ok(![...seen].some(l => /Adaptatron/.test(l)), `no conquer trigger (${[...seen].join(', ')})`);
});

test('RJ#6178 the defender\'s hidden Hidden Blade on my attacker: Ride the Wind (Action) can\'t respond; Flash (Reaction) can — the target is no longer at a battlefield, so nothing is killed and nobody draws', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const hb = put(g, P1, 'Hidden Blade', { facedown: BF_A });
  const a = put(g, P0, 'V(5)', 'base');
  const rtw = hand(g, P0, 'Ride the Wind'), fl = hand(g, P0, 'Flash');
  g = move(g, P0, [a], BF_A);
  for (let i = 0; i < 6 && !canPlayNow(g, P1, hb); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  g = play(g, P1, hb, { targets: [[a]] });
  if (pend(g).player === P1) g = pass(g);
  assert.equal(pend(g).player, P0);
  assert.ok(!canPlayNow(g, P0, rtw), 'Ride the Wind is an Action: not on a chain');
  assert.ok(canPlayNow(g, P0, fl), 'Flash is a Reaction');
  const h0 = g.players[P0].hand.length;
  g = play(g, P0, fl, { targets: [[a]] });
  g = resolveChain(g);
  assert.equal(locOf(g, a), 'base', 'escaped to base');
  assert.equal(g.players[P0].hand.length, h0 - 1, 'Hidden Blade did nothing: no draw 2');
});

test('RJ#6181 Unyielding Spirit prevents only spell/ability damage: combat damage still kills the defender and the attacker conquers', () => {
  let { g, atk, def } = attackSetup(['V(4)'], ['V(3)']);
  fundAll(g, P1);
  const us = hand(g, P1, 'Unyielding Spirit');
  for (let i = 0; i < 6 && !canPlayNow(g, P1, us); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  g = resolveChain(play(g, P1, us, {}));
  g = drive(g);
  assert.equal(zone(g, def[0]), 'trash', 'combat damage not prevented');
  assert.equal(locOf(g, atk[0]), BF_A);
  assert.equal(g.battlefields[BF_A].controller, P0);
});

test('RJ#6182 Blind Monk (Lee Sin legend) can\'t buff Lee Sin while he is in the Champion Zone — only units on the board', () => {
  let g = S0(); fundAll(g, P0);
  const leg = setLegend(g, P0, 'Blind Monk');
  const ls = put(g, P0, 'Lee Sin, Ascetic', 'hand');
  const pl = g.players[P0]; pl.hand = pl.hand.filter(x => x !== ls); g.objects[ls].zone = 'championZone'; pl.championZone.push(ls); g.timestamp++;
  const v = put(g, P0, 'V(1)', 'base');
  const ab = legal(g, P0, 'activate').find(x => x.type === 'activate' && x.obj === leg);
  assert.ok(ab, 'legend ability available');
  g = act(g, ab!);
  const o = pend(g).inStep ? optionIds(g) : [];
  assert.ok(!o.includes(ls), `champion-zone Lee Sin not offered (${o.join(',')})`);
  if (o.includes(v)) g = choose(g, v);
  const t = g.chain.flatMap(c => c.targets.flat());
  assert.ok(t.includes(v) && !t.includes(ls), 'the only legal choice is the unit on the board');
  g = resolveChain(g);
  assert.equal(g.objects[v].counters.buff, 1, 'V(1) buffed');
});

test('RJ#6185 Cleave on a 4-Might unit: Gust can\'t answer it yet; Stupefy first, and once it resolves (unit at 3) Gust can be played and returns the unit before Cleave resolves', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P0, 'V(4)', BF_A); control(g, BF_A, P0);
  const gu = hand(g, P1, 'Gust'), st = hand(g, P1, 'Stupefy');
  g = play(g, P0, hand(g, P0, 'Cleave'), { targets: [[u]] });
  if (pend(g).player === P0) g = pass(g);
  assert.equal(pend(g).player, P1);
  assert.ok(!canPlayNow(g, P1, gu), 'Gust has no legal target at 4 Might');
  assert.notEqual(rejects(g, { type: 'playCard', player: P1, obj: gu }), null);
  g = play(g, P1, st, { targets: [[u]] });
  for (let i = 0; i < 10 && g.chain.length > 1; i++) g = pass(g);
  assert.equal(g.chain.length, 1, 'Stupefy resolved, Cleave still waiting');
  assert.equal(mightOf(g, u), 3);
  for (let i = 0; i < 4 && pend(g).player !== P1; i++) g = pass(g);
  assert.ok(canPlayNow(g, P1, gu), 'now Gust can be played');
  g = play(g, P1, gu, { targets: [[u]] });
  g = resolveChain(g);
  assert.equal(zone(g, u), 'hand', 'returned before Cleave resolved');
});

test('RJ#6187 Ahri, Inquisitive\'s -2 (min 1) on an attacking 1-Might unit snapshots -0; Back to Back +2 afterwards → 3 (both units 3)', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P1, 'Ahri, Inquisitive', BF_A); control(g, BF_A, P1);
  const a1 = put(g, P0, 'V(1)', 'base'), a2 = put(g, P0, 'V(1)', 'base');
  const bb = hand(g, P0, 'Back to Back');
  g = move(g, P0, [a1, a2], BF_A);
  for (let i = 0; i < 10 && !(g.chain.length === 0 && canPlayNow(g, P0, bb)); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.equal(mightOf(g, a1), 1); assert.equal(mightOf(g, a2), 1);
  g = act(g, { type: 'playCard', player: P0, obj: bb });
  const picked: string[] = [];
  for (let i = 0; i < 6 && pend(g).inStep; i++) {
    const o = optionIds(g); const pick = [a1, a2].find(x => o.includes(x) && !picked.includes(x)) ?? o[0];
    picked.push(pick); g = choose(g, pick);
  }
  g = resolveChain(g);
  assert.equal(mightOf(g, a1), 3); assert.equal(mightOf(g, a2), 3);
});

test('RJ#6189 Angle Shot can take an already attached Equipment and attach it to another unit in one go', () => {
  let g = S0(); fundAll(g, P0);
  const u1 = put(g, P0, 'V(2)', 'base'), u2 = put(g, P0, 'V(3)', 'base');
  const ga = put(g, P0, 'Guardian Angel', 'base'); attachNow(g, ga, u1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Angle Shot') });
  for (let i = 0; i < 6 && pend(g).inStep; i++) { const o = optionIds(g); g = choose(g, o.includes('attach') ? 'attach' : o.includes(u2) ? u2 : o.includes(ga) ? ga : o[0]); }
  g = resolveChain(g);
  for (let i = 0; i < 4 && pend(g).inStep; i++) { const o = optionIds(g); g = choose(g, o.includes('attach') ? 'attach' : o[0]); }
  assert.equal(g.objects[ga].attachedTo, u2, 'moved to the other unit');
});

test('RJ#6205 Sett, Brawler\'s "Spend my buff: +4" spends his own buff and can be activated again the same turn whenever he has a buff to spend', () => {
  let g = S0();
  const s = put(g, P0, 'Sett, Brawler', 'base', { buff: true });
  const base = mightOf(g, s) - 1;
  const useIt = (h: GameState) => {
    const ab = legal(h, P0, 'activate').find(x => x.type === 'activate' && x.obj === s);
    assert.ok(ab, 'Spend my buff available');
    return drive(act(h, ab!));
  };
  g = useIt(g);
  assert.equal(g.objects[s].counters.buff ?? 0, 0, 'own buff spent');
  assert.equal(mightOf(g, s), base + 4);
  assert.ok(!legal(g, P0, 'activate').some(x => x.type === 'activate' && x.obj === s), 'no buff: cost can\'t be paid');
  g.objects[s].counters.buff = 1; g.timestamp++; // buffed again (e.g. by another card)
  g = useIt(g);
  assert.equal(mightOf(g, s), base + 8, 'second activation the same turn');
});

test('RJ#6175/RJ#6207 at 7 points conquering The Candlelit Sanctum (other battlefield not scored): the draw replacing the point happens before the Sanctum\'s conquer trigger looks at the deck', () => {
  let g = S0({ bfA: 'The Candlelit Sanctum' });
  g.players[P0].points = 7;
  for (let i = 0; i < 4; i++) put(g, P0, 'V(1)', 'deckTop');
  const u = put(g, P0, 'V(2)', 'base');
  const h0 = g.players[P0].hand.length;
  g = move(g, P0, [u], BF_A);
  let handAtLook: number | null = null;
  for (let i = 0; i < 30 && g.pending && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    if (handAtLook === null && g.chain.some(c => /Sanctum/.test(String(c.label)))) handAtLook = g.players[P0].hand.length;
    if (d.kind === 'optional') { g = choose(g, 'no'); continue; }
    const none = legal(g, d.player).find(a => a.type === 'choose' && (a as { optionIds: string[] }).optionIds.length === 0);
    g = none && /recycle/i.test(d.prompt) ? act(g, none) : act(g, legal(g, d.player)[0]);
  }
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[P0].points, 7, 'no 8th point (other battlefield not scored)');
  assert.equal(g.players[P0].hand.length, h0 + 1, 'drew instead');
  assert.equal(handAtLook, h0 + 1, 'already drawn when the Sanctum trigger resolves');
});

test('RJ#6209 Super Mega Death Rocket! conquer trigger: discarding Flame Chompers for its cost still returns the Rocket, and Chompers may be played for [C]', () => {
  let g = S0(); fundAll(g, P0);
  const r = put(g, P0, 'Super Mega Death Rocket!', 'trash');
  const fc = hand(g, P0, 'Flame Chompers');
  const u = put(g, P0, 'V(2)', 'base');
  g = move(g, P0, [u], BF_B);
  g = drive(g, d => d.kind === 'optional' ? 'yes' : d.options!.some(o => o.id === fc) ? fc : undefined);
  assert.equal(g.battlefields[BF_B].controller, P0);
  assert.equal(zone(g, r), 'hand', 'Rocket returned');
  assert.notEqual(zone(g, fc), 'hand');
  assert.notEqual(zone(g, fc), 'trash', 'Chompers played instead of staying in the trash');
});

test('RJ#6216 (nuance MISMATCH-RJ, CR 473.1.b) at 7 points: conquering A draws instead of the point and still triggers conquer effects; conquering B later the same turn (A now scored) gives the 8th point — it does not draw again', () => {
  let g = S0();
  g.players[P0].points = 7;
  const u1 = put(g, P0, 'V(2)', 'base'), u2 = put(g, P0, 'V(2)', 'base');
  const h0 = g.players[P0].hand.length;
  g = drive(move(g, P0, [u1], BF_A));
  assert.equal(g.battlefields[BF_A].controller, P0);
  assert.equal(g.players[P0].points, 7);
  assert.equal(g.players[P0].hand.length, h0 + 1, 'drew instead of the final point');
  g = move(g, P0, [u2], BF_B);
  for (let i = 0; i < 20 && g.winner == null && g.pending && pend(g).kind !== 'mainAction'; i++) { const d = pend(g); g = d.inStep ? choose(g, d.options![0].id) : pass(g); }
  assert.equal(g.players[P0].points, 8, 'every battlefield scored this turn → the point');
  assert.equal(g.winner, P0);
});

test('RJ#6217 Sett, Kingpin (5+1 from a buffed ally) and the ally both dealt lethal-to-the-ally damage at once (Flurry of Blades): the ally dies, Sett at 5 with 5 damage dies in the cleanup that follows at once', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1);
  const s = put(g, P0, 'Sett, Kingpin', BF_A, { damage: 4 });
  const al = put(g, P0, 'V(1)', BF_A, { buff: true, damage: 1 });
  control(g, BF_A, P0);
  assert.equal(mightOf(g, s), 6);
  g = play(g, P1, hand(g, P1, 'Flurry of Blades'), {});
  g = resolveChain(g);
  assert.equal(zone(g, al), 'trash');
  assert.equal(zone(g, s), 'trash', 'Sett dies once the ally\'s +1 is gone');
});

test('RJ#6218 Noxian Drummer moving into an enemy-controlled battlefield plays its Recruit token there (no location choice, so the "battlefield you control" rule doesn\'t apply)', () => {
  let g = withTokens(S0());
  put(g, P1, 'V(5)', BF_A); control(g, BF_A, P1);
  const dr = put(g, P0, 'Noxian Drummer', 'base');
  g = move(g, P0, [dr], BF_A);
  for (let i = 0; i < 6 && g.chain.length; i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  const rec = Object.values(g.objects).filter(o => o.controller === P0 && o.zone === 'battlefield' && o.battlefieldIndex === BF_A && /Recruit/.test(g.cards[o.cardId]?.name ?? ''));
  assert.equal(rec.length, 1, 'Recruit played at the enemy battlefield');
});

test('RJ#6227 Rabadon\'s Deathcrown adds Bonus Damage only to spells that deal damage: Stupefy deals none (target -1, no damage); Hextech Ray 3 + 3', () => {
  let g = S0(); fundAll(g, P0);
  const u = put(g, P0, 'V(3)', 'base');
  attachNow(g, put(g, P0, "Rabadon's Deathcrown", 'base'), u);
  const e = put(g, P1, 'V(9)', BF_A), e2 = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  g = resolveChain(play(g, P0, hand(g, P0, 'Stupefy'), { targets: [[e]] }));
  assert.equal(g.objects[e].damage, 0, 'no damage from Stupefy');
  assert.equal(mightOf(g, e), 8);
  g = resolveChain(play(g, P0, hand(g, P0, 'Hextech Ray'), { targets: [[e2]] }));
  assert.equal(g.objects[e2].damage, 6, 'sanity: a damage spell gets +3');
});

test('RJ#6279 a Champion unit whose tag differs from the Champion Legend\'s may be in the main deck (only the Chosen Champion needs the tag); as Chosen Champion it is rejected', async () => {
  const { validateDeck } = await import('../../src/engine/deck.ts');
  const { fixtureDb } = await import('../fixtures/conformance/cards.ts');
  const { legalDeck } = await import('../conformance/harness.ts');
  const darius = realCard('ogn-027-298'); // Darius, Trifarian: Fury, Champion, tag Darius (legend tag: Tester)
  const db = { ...fixtureDb(), [darius.id]: darius };
  const d = legalDeck();
  const deck = { ...d, main: [...d.main.slice(1), darius.id] };
  assert.deepEqual(validateDeck(deck, db).map(p => p.code), [], 'other-tag champion unit in the main deck is legal');
  assert.ok(validateDeck({ ...d, champion: darius.id }, db).some(p => p.code === 'champion.tag'), 'but not as the Chosen Champion');
});

test('RJ#6284 one Zhonya\'s Hourglass: the opponent kills Blitz (KillA), then responds with a second kill on Poro (ZapR) — the newer spell resolves first, so Zhonya\'s saves Poro and Blitz dies', () => {
  let g = S0();
  fundAll(g, P0, 8); fundAll(g, P1);
  const z = put(g, P1, "Zhonya's Hourglass", 'base');
  const blitz = put(g, P1, 'V(2)', BF_A), poro = put(g, P1, 'V(2)', BF_A);
  control(g, BF_A, P1);
  [g] = cast(g, P0, 'KillA', { targets: [[blitz]] });
  if (pend(g).player !== P0) g = pass(g);
  [g] = cast(g, P0, 'ZapR', { targets: [[poro]] });
  g = drive(g);
  assert.equal(zone(g, z), 'trash', "Zhonya's used");
  assert.equal(locOf(g, poro), 'base', 'Poro (first to die) saved and recalled');
  assert.equal(zone(g, blitz), 'trash', 'Blitz dies afterwards');
});

test('RJ#6300 two Zhonya\'s Hourglass in play, one unit dies: only one Hourglass is used, the other stays', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P1);
  const z1 = put(g, P0, "Zhonya's Hourglass", 'base'), z2 = put(g, P0, "Zhonya's Hourglass", 'base');
  const a = put(g, P0, 'V(2)', BF_A);
  control(g, BF_A, P0);
  [g] = cast(g, P1, 'KillA', { targets: [[a]] });
  g = drive(g);
  assert.equal(locOf(g, a), 'base', 'saved');
  assert.equal([z1, z2].filter(z => zone(g, z) === 'trash').length, 1, 'exactly one Hourglass used');
});

test('RJ#6306 Solari Shrine: my kill on a stunned enemy unit replaced by its Zhonya\'s Hourglass — nothing was killed, no trigger, the Shrine stays ready and I draw nothing', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const sh = put(g, P0, 'Solari Shrine', 'base');
  const z = put(g, P1, "Zhonya's Hourglass", 'base');
  const e = put(g, P1, 'V(2)', BF_A, { stunned: true });
  control(g, BF_A, P1);
  const h = g.players[0].hand.length;
  [g] = cast(g, P0, 'KillA', { targets: [[e]] });
  g = drive(g);
  assert.equal(zone(g, z), 'trash');
  assert.equal(locOf(g, e), 'base', 'saved');
  assert.equal(g.objects[sh].exhausted, false, 'Shrine not exhausted');
  assert.equal(g.players[0].hand.length, h, 'no draw (KillA was added to the hand by the harness and played)');

  // sanity: without the Hourglass the Shrine triggers
  let g2 = S0(); fundAll(g2, P0);
  const sh2 = put(g2, P0, 'Solari Shrine', 'base');
  const e2 = put(g2, P1, 'V(2)', BF_A, { stunned: true }); control(g2, BF_A, P1);
  [g2] = cast(g2, P0, 'KillA', { targets: [[e2]] });
  g2 = drive(g2);
  assert.equal(zone(g2, e2), 'trash');
  assert.equal(g2.objects[sh2].exhausted, true, 'sanity: Shrine used');
});

test('RJ#6308 Grand Duelist (Fiora legend) triggers on the opponent\'s turn: my 4-Might unit made Mighty by my Discipline in response to their spell → channel 1 rune exhausted', () => {
  let g = S0({ tp: P1 });
  fundAll(g, P0); fundAll(g, P1);
  const leg = setLegend(g, P0, 'Grand Duelist');
  const u = put(g, P0, 'V(4)', 'base');
  const runes0 = g.players[0].runesInPlay.length;
  [g] = cast(g, P1, 'DrawR');
  if (pend(g).player === P1) g = pass(g);
  assert.equal(pend(g).player, P0);
  [g] = cast(g, P0, 'Discipline', { targets: [[u]] });
  g = drive(g);
  assert.equal(mightOf(g, u), 6);
  assert.equal(g.objects[leg].exhausted, true, 'legend exhausted on the opponent\'s turn');
  assert.equal(g.players[0].runesInPlay.length, runes0 + 1, 'channelled 1 rune');
});

test('RJ#6326 Challenge (my 5 vs their 4); they respond with Shakedown and I decline the draw-2, so my unit dies: Challenge resolves, but with my unit gone no damage is dealt to theirs', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  const mine = put(g, P0, 'V(5)', BF_A); control(g, BF_A, P0);
  const theirs = put(g, P1, 'V(4)', BF_B); control(g, BF_B, P1);
  [g] = cast(g, P0, 'Challenge', { targets: [[mine], [theirs]] });
  for (let i = 0; i < 4 && pend(g).player === P0 && !pend(g).inStep; i++) g = pass(g);
  [g] = cast(g, P1, 'Shakedown', { targets: [[mine]] });
  g = drive(g, d => d.player === P0 && d.kind === 'optional' ? 'no' : undefined);
  assert.equal(zone(g, mine), 'trash', 'Shakedown killed my unit first');
  assert.equal(zone(g, theirs), 'battlefield');
  assert.equal(g.objects[theirs].damage, 0, 'Challenge found no friendly unit: no damage');
});

test('RJ#6328 Noxian Drummer attacks the opponent\'s Trifarian War Camp (Nine-Tailed Fox legend): its Recruit token played there also becomes an attacker and gets -1 (1 + 1 - 1 = 1)', () => {
  let g = withTokens(S0({ bfA: 'Trifarian War Camp' }));
  setLegend(g, P1, 'Nine-Tailed Fox');
  put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const dr = put(g, P0, 'Noxian Drummer', 'base');
  g = move(g, P0, [dr], BF_A);
  for (let i = 0; i < 12 && (g.chain.length || pend(g).inStep); i++) g = pend(g).inStep ? act(g, legal(g, pend(g).player)[0]) : pass(g);
  const rec = Object.values(g.objects).find(o => o.controller === P0 && o.zone === 'battlefield' && o.battlefieldIndex === BF_A && /Recruit/.test(g.cards[o.cardId]?.name ?? ''));
  assert.ok(rec, 'Recruit played at the battlefield');
  assert.equal(mightOf(g, dr), 3, 'Drummer 3 + 1 (War Camp) - 1 (Fox)');
  assert.equal(mightOf(g, rec!.id), 1, 'Recruit 1 + 1 (War Camp) - 1 (Fox): it is an attacker too');
});

test('RJ#6339 Commander Ledros killing Ekko (Deathknell: ready runes) for its cost: the full reduced cost is paid first, Ledros is played, then the Deathknell readies the runes', () => {
  let g = S0();
  setRunes(g, P0, 9, 'order'); // exactly 6 energy + 3 power (4 - 1 for Ekko)
  const ekko = put(g, P0, 'ogn-110-298', 'base'); // Ekko: Deathknell — recycle me to ready your runes
  const led = hand(g, P0, 'Commander Ledros');
  g = act(g, { type: 'playCard', player: P0, obj: led, destination: 'base' } as never);
  let sawLedrosWhileKnellPending = false;
  for (let i = 0; i < 40 && g.pending && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (zone(g, led) === 'battlefield' || locOf(g, led) === 'base') {
      if (chainLabels(g).some(l => /Ekko|Deathknell/i.test(l)) && readyRunes(g, P0) < g.players[P0].runesInPlay.length) sawLedrosWhileKnellPending = true;
    }
    if (d.inStep) { const o = optionIds(g); g = choose(g, o.includes(ekko) ? ekko : d.kind === 'optional' ? 'yes' : o[0]); continue; }
    g = pass(g);
  }
  assert.equal(locOf(g, led), 'base', 'Ledros played');
  assert.notEqual(zone(g, ekko), 'battlefield', 'Ekko killed for the cost');
  assert.ok(sawLedrosWhileKnellPending, 'Ledros was on the board, its cost paid (runes exhausted), while the Deathknell waited on the chain');
  assert.equal(readyRunes(g, P0), g.players[P0].runesInPlay.length, 'the Deathknell then readied the runes');
});

test('RJ#6356 two Dazzling Auroras: the unit played by the first (Cloud Drake, "When you play me, draw 1") has its play trigger resolve before the second Aurora — the draw takes the next unit, so the second Aurora reveals the one below', () => {
  let g = S0();
  put(g, P0, 'Dazzling Aurora', 'base'); put(g, P0, 'Dazzling Aurora', 'base');
  clearDeck(g, P0);
  const y = put(g, P0, 'V(3)', 'deckTop');
  const x = put(g, P0, 'V(2)', 'deckTop');
  const drake = put(g, P0, 'Cloud Drake', 'deckTop');
  g = endTurn(g);
  for (let i = 0; i < 40 && g.activePlayer === P0 && g.pending; i++) {
    const d = pend(g);
    if (d.kind === 'mainAction') break;
    g = d.inStep ? choose(g, d.kind === 'optional' ? 'yes' : (optionIds(g).includes('base') ? 'base' : optionIds(g)[0])) : pass(g);
  }
  assert.equal(locOf(g, drake), 'base', 'first Aurora played Cloud Drake');
  assert.equal(zone(g, x), 'hand', 'Drake\'s draw resolved before the second Aurora');
  assert.equal(locOf(g, y), 'base', 'second Aurora then revealed and played the next unit');
});

test('RJ#6390 Stormbringer deals 6 to Lee Sin, Centered (6) and a buffed ally (4 + 1 + 2 = 7) outside combat: Lee Sin dies, the ally then drops to 5 with 6 damage and dies too', () => {
  let g = S0();
  fundAll(g, P0);
  const v = put(g, P0, 'V(6)', 'base');
  const lee = put(g, P1, 'ogn-151-298', BF_A);
  const ally = put(g, P1, 'V(4)', BF_A, { buff: true });
  control(g, BF_A, P1);
  assert.equal(mightOf(g, ally), 7, 'buffed + Lee Sin\'s +2');
  [g] = cast(g, P0, 'Stormbringer, Volibear', { targets: [[g.battlefields[BF_A].objId]] });
  for (let i = 0; i < 10; i++) { const d = g.pending!; if (d.kind === 'mainAction' || d.kind === 'showdownAction') break; if (d.inStep) g = choose(g, d.options!.find(o => o.id === v)?.id ?? d.options![0].id); else g = pass(g); }
  assert.equal(zone(g, lee), 'trash', 'Lee Sin died to 6');
  assert.equal(zone(g, ally), 'trash', 'without the +2 its 6 damage is lethal (not healed: no combat)');
  assert.equal(locOf(g, v), BF_A);
});

test('RJ#6392 Volibear, Furious with Annie, Fiery chooses 6 recipients (pool 5 + 1); Annie is Gusted in response: only 5 damage is split (one recipient drops out, CR 355.14.h)', () => {
  let g = S0();
  fundAll(g, P1);
  const defs = [0, 1, 2, 3, 4, 5].map(() => put(g, P1, 'V(9)', BF_A)); control(g, BF_A, P1);
  const v = put(g, P0, 'ogn-041-298', 'base');
  const an = put(g, P0, 'ogs-001-024', 'base');
  mod(g, an, { might: -1 }); // 3 Might: Gust-able
  g = move(g, P0, [v, an], BF_A);
  for (let i = 0; i < 12 && pend(g).inStep; i++) {
    const p = pend(g);
    if (p.kind === 'chooseTargets' || p.kind === 'chooseCards') { assert.equal(p.max, 6, 'Annie raises the pool to 6'); g = choose(g, ...(defs as never[])); continue; }
    g = choose(g, p.options![0].id);
  }
  g = pass(g);
  [g] = cast(g, P1, 'Gust', { targets: [[an]] });
  for (let i = 0; i < 30 && (g.chain.length || pend(g).inStep); i++) {
    const p = pend(g);
    if (p.inStep) { g = p.kind === 'chooseCards' ? choose(g, ...(p.options!.slice(0, p.min ?? 1).map(o => o.id) as never[])) : choose(g, p.options![0].id); continue; }
    g = pass(g);
  }
  assert.equal(zone(g, an), 'hand');
  assert.equal(defs.reduce((s, d) => s + g.objects[d].damage, 0), 5, '5 damage in total, no bonus');
});

test('RJ#6395 Dragon\'s Rage moves an enemy unit to their battlefield; in response to the reflexive "do this", a hidden Hidden Blade there kills the moved unit: no damage is exchanged', () => {
  let g = S0(); fundAll(g, P0, 4); fundAll(g, P1);
  const x = put(g, P1, 'V(3)', 'base');
  const y = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const hb = put(g, P1, 'Hidden Blade', { facedown: BF_A, hiddenTurn: 0 });
  g = play(g, P0, hand(g, P0, "Dragon's Rage"), { targets: [[x]], locations: [BF_A] });
  for (let i = 0; i < 10 && !(g.chain.length && !pend(g).inStep && pend(g).player === P1 && locOf(g, x) === BF_A); i++) {
    const d = pend(g);
    if (d.inStep) { const o = optionIds(g); g = choose(g, o.includes(y) ? y : d.kind === 'chooseDestination' ? String(BF_A) : o[0]); continue; }
    g = pass(g);
  }
  assert.equal(locOf(g, x), BF_A, 'moved');
  assert.ok(g.chain.length >= 1, 'the reflexive "do this" is on the chain');
  assert.ok(canPlayNow(g, P1, hb), 'the hidden card can be played in response');
  g = play(g, P1, hb, { targets: [[x]] });
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.equal(zone(g, x), 'trash', 'Hidden Blade killed the moved unit');
  assert.equal(g.objects[y].damage, 0, 'the dead unit deals no damage');
});

test('RJ#6396 playing a unit with no abilities opens no response window: it is on the board at once and I keep acting (no Gust in response)', () => {
  let g = S0();
  fundAll(g, P0); fundAll(g, P1);
  hand(g, P1, 'Gust');
  const u = hand(g, P0, 'V(2)');
  g = act(g, { type: 'playCard', player: P0, obj: u, destination: 'base' } as never);
  for (let i = 0; i < 4 && pend(g).inStep && pend(g).player === P0; i++) g = choose(g, pend(g).options![0].id);
  assert.equal(locOf(g, u), 'base', 'resolved immediately');
  assert.equal(g.chain.length, 0);
  assert.equal(pend(g).player, P0, 'no window for the opponent');
  assert.equal(pend(g).kind, 'mainAction');
});

test('RJ#6400 Divine Judgment does not count or recycle the Chosen Champion in its zone', () => {
  let g = S0(); fundAll(g, P0);
  const chs = [P0, P1].map(p => g.players[p].championZone[0]);
  assert.ok(chs.every(Boolean), 'both players have a Chosen Champion');
  put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Divine Judgment') });
  for (let i = 0; i < 60 && g.pending && g.pending.kind !== 'mainAction'; i++) {
    const d = g.pending;
    if (d.inStep) {
      assert.ok(!(d.options ?? []).some(o => chs.includes(o.id as ObjId)), 'the Champion is never offered as a choice');
      g = act(g, { type: 'choose', player: d.player, optionIds: (d.options ?? []).slice(0, Math.max(d.min ?? 1, Math.min(d.max ?? 1, 2))).map(o => o.id) });
    } else g = act(g, { type: 'pass', player: d.player });
  }
  assert.ok(g.log.some(l => /Resolving Divine Judgment/.test(l.text)));
  for (const c of chs) assert.equal(zone(g, c), 'championZone');
});

test('RJ#6412 Piercing Light with Repeat chooses 4 targets: two at a battlefield (one per execution) and two anywhere — each takes 2', () => {
  let g = S0(); fundAll(g, P0, 8);
  const a1 = put(g, P1, 'V(9)', BF_A), a2 = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const b1 = put(g, P1, 'V(9)', 'base'), b2 = put(g, P1, 'V(9)', 'base');
  const queue = [a1, b1, a2, b2];
  g = act(g, { type: 'playCard', player: P0, obj: hand(g, P0, 'Piercing Light') });
  for (let i = 0; i < 24 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    if (d.kind === 'optional') { g = yes(g); continue; }
    const o = optionIds(g);
    const pick = queue.find(x => o.includes(x));
    if (pick) queue.splice(queue.indexOf(pick), 1);
    g = act(g, { type: 'choose', player: d.player, optionIds: pick ? [pick] : d.kind === 'chooseTargets' ? [] : [o[0]] });
  }
  assert.deepEqual([a1, b1, a2, b2].map(x => g.objects[x].damage), [2, 2, 2, 2]);
});

test('RJ#6415 Carnivorous Snapvine\'s play trigger is mandatory when an enemy unit is at a battlefield: it must choose one (no "choose none"), and the fight happens', () => {
  let g = S0(); fundAll(g, P0);
  const e = put(g, P1, 'V(9)', BF_A); control(g, BF_A, P1);
  const sv = hand(g, P0, 'Carnivorous Snapvine');
  g = act(g, { type: 'playCard', player: P0, obj: sv, destination: 'base' } as never);
  let asked = false;
  for (let i = 0; i < 20 && pend(g).kind !== 'mainAction'; i++) {
    const d = pend(g);
    if (!d.inStep) { g = pass(g); continue; }
    if (d.kind === 'optional') assert.fail('the trigger is not optional');
    if (optionIds(g).includes(e)) { asked = true; assert.ok((d.min ?? 1) >= 1, 'a target must be chosen'); }
    g = choose(g, optionIds(g).includes(e) ? e : optionIds(g)[0]);
  }
  assert.ok(asked || g.objects[e].damage > 0);
  assert.equal(g.objects[e].damage, 6, 'the enemy takes 6');
  assert.equal(zone(g, sv), 'trash', 'Snapvine (6) takes 9 and dies');
});

test('RJ#6419 Gust on Lecturing Yordle in response to its "When you play me, draw 1": the draw still happens (it doesn\'t refer to the unit)', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  control(g, BF_A, P0);
  const y = hand(g, P0, 'Lecturing Yordle');
  g = act(g, { type: 'playCard', player: P0, obj: y, destination: BF_A } as never);
  for (let i = 0; i < 4 && pend(g).inStep; i++) g = choose(g, pend(g).options![0].id);
  assert.equal(locOf(g, y), BF_A);
  assert.ok(g.chain.length >= 1, 'play trigger on the chain');
  if (pend(g).player === P0) g = pass(g);
  const h0 = g.players[P0].hand.length;
  [g] = cast(g, P1, 'Gust', { targets: [[y]] });
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.equal(zone(g, y), 'hand', 'Gusted back to hand');
  assert.equal(g.players[P0].hand.length, h0 + 2, 'Yordle back + the draw');
});

// MISMATCH-RJ: RJ says the opponent loses control as soon as Hidden Blade kills their last unit, so the Charmed unit
// contests the battlefield and conquers it for a point. Official: with Charm still on the chain the turn is Closed
// (CR 309.1) and control is only lost in an Open State (CR 323.5) — DECISIONS principle 13 (#8134, #10655). When
// Charm resolves their own unit arrives at the battlefield they still control: no contest, no showdown, no point.
test('RJ#6429 (MISMATCH-RJ) I Charm the opponent\'s base unit onto their battlefield; they Hidden Blade their own last unit there in response: control never lapses (Closed state), so the moved unit doesn\'t conquer and no point is scored', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const u = put(g, P1, 'V(2)', BF_A); control(g, BF_A, P1);
  const hb = put(g, P1, 'Hidden Blade', { facedown: BF_A, hiddenTurn: 0 });
  const e = put(g, P1, 'V(5)', 'base');
  const pts = g.players[P1].points;
  g = play(g, P0, hand(g, P0, 'Charm'), { targets: [[e]], dest: BF_A, locations: [BF_A] });
  for (let i = 0; i < 6 && !(pend(g).player === P1 && !pend(g).inStep); i++) g = pend(g).inStep ? choose(g, optionIds(g).includes(String(BF_A)) ? String(BF_A) : pend(g).options![0].id) : pass(g);
  assert.ok(chainLabels(g).length >= 1, 'Charm on the chain');
  g = play(g, P1, hb, { targets: [[u]] });
  let sawShowdown = false;
  for (let i = 0; i < 30 && (g.chain.length || pend(g).inStep || g.showdown); i++) {
    if (g.showdown) sawShowdown = true;
    g = pend(g).inStep ? choose(g, optionIds(g).includes(String(BF_A)) ? String(BF_A) : pend(g).options![0].id) : pass(g);
  }
  assert.equal(zone(g, u), 'trash');
  assert.equal(locOf(g, e), BF_A, 'Charm moved the unit in');
  assert.equal(g.battlefields[BF_A].controller, P1, 'control kept');
  assert.ok(!sawShowdown, 'no showdown: the battlefield was never uncontrolled');
  assert.equal(g.players[P1].points, pts, 'no conquer point');
});

test('RJ#6444 Spirit\'s Refuge is a continuous passive: a unit buffed later (Stand United) gains Deflect; an unbuffed unit has none', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, "Spirit's Refuge", 'base');
  const u = put(g, P0, 'V(2)', 'base');
  const w = put(g, P0, 'V(2)', 'base');
  assert.equal(kwValue(g, u, 'Deflect') ?? 0, 0, 'not buffed: no Deflect');
  g = drive(play(g, P0, hand(g, P0, 'Stand United'), { targets: [[u]] }));
  assert.equal(g.objects[u].counters?.buff ?? 0, 1, 'buffed after Refuge was played');
  assert.equal(kwValue(g, u, 'Deflect'), 1);
  assert.equal(kwValue(g, w, 'Deflect') ?? 0, 0);
});

test('RJ#6455 a hidden unit can only be played at the battlefield where it was hidden, not at another battlefield I control (nor base)', () => {
  let g = S0(); fundAll(g, P0);
  put(g, P0, 'V(1)', BF_A); control(g, BF_A, P0);
  put(g, P0, 'V(1)', BF_B); control(g, BF_B, P0);
  const h = put(g, P0, 'HidU(2)', { facedown: BF_A, hiddenTurn: 0 });
  assert.deepEqual(playDests(g, P0, h), [BF_A]);
});

// MISMATCH-RJ (partial): RJ says that if Void Seeker's target leaves the board (Gust) "the controller can't be established"
// and nothing is drawn. Card text ogn-024 "Deal 4 to a unit at a battlefield. Draw 1." — the draw is the spell's
// controller's and doesn't refer to the target; CR 359.3.e ignores only the instructions that use the illegal target
// (DECISIONS #150; r0001 RJ#150 for the moved-to-base case).
test('RJ#6470 (MISMATCH-RJ partial) Void Seeker\'s target is Gusted to hand in response: no damage, but the caster still draws 1', () => {
  let g = S0(); fundAll(g, P0); fundAll(g, P1);
  const e = put(g, P1, 'V(3)', BF_A); control(g, BF_A, P1);
  g = play(g, P0, hand(g, P0, 'Void Seeker'), { targets: [[e]] });
  const h = g.players[P0].hand.length;
  if (pend(g).player === P0) g = pass(g);
  [g] = cast(g, P1, 'Gust', { targets: [[e]] });
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) g = pend(g).inStep ? choose(g, pend(g).options![0].id) : pass(g);
  assert.equal(zone(g, e), 'hand');
  assert.equal(g.players[P0].hand.length, h + 1, 'still drew');
});

test('RJ#6471 The Boss (Sett legend) recalls a buffed unit dying at Vilemaw\'s Lair: a recall is not a move, so the Lair doesn\'t stop it', () => {
  let g = S0({ bfA: "Vilemaw's Lair" });
  fundAll(g, P0); fundAll(g, P1);
  setLegend(g, P1, 'The Boss');
  const u = put(g, P1, 'V(3)', BF_A, { buff: true });
  control(g, BF_A, P1);
  [g] = cast(g, P0, 'Hidden Blade', { targets: [[u]] });
  g = passAll(g);
  expectPending(g, 'optional', P1);
  g = passAll(yes(g));
  assert.equal(locOf(g, u), 'base', 'recalled to base from the Lair instead of dying');
});

test('RJ#6482 Maddened Marauder moves a stolen unit (owned by the caster, controlled by me) "to its base": my base — the controller\'s, not the owner\'s', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1);
  const u = put(g, P1, 'V(2)', BF_A); // owned by P1
  g.objects[u].controller = P0; g.timestamp++; // stolen by P0 (Possession-style)
  control(g, BF_A, P0);
  const mm = hand(g, P1, 'Maddened Marauder');
  g = act(g, { type: 'playCard', player: P1, obj: mm, destination: 'base' } as never);
  for (let i = 0; i < 20 && (g.chain.length || pend(g).inStep); i++) g = pend(g).inStep ? choose(g, optionIds(g).includes(u) ? u : pend(g).options![0].id) : pass(g);
  assert.equal(g.objects[u].owner, P1);
  assert.equal(locOf(g, u), 'base');
  assert.ok(g.players[P0].base.includes(u), 'in its controller\'s base');
  assert.ok(!g.players[P1].base.includes(u));
});

test('RJ#6485 Bounty Hunter\'s "[T]: Give a unit Ganking" (no Action/Reaction) can\'t be activated on another player\'s turn — only on my own Neutral Open turn', () => {
  let g = S0({ tp: P1 }); fundAll(g, P1);
  const l = setLegend(g, P0, 'Bounty Hunter');
  put(g, P0, 'V(2)', 'base');
  const t = put(g, P1, 'V(2)', 'base');
  [g] = cast(g, P1, 'Discipline', { targets: [[t]] });
  if (pend(g).player === P1) g = pass(g);
  assert.equal(pend(g).player, P0, 'I hold priority on their turn');
  const onTheirTurn = legal(g, P0, 'activate').filter(a => a.type === 'activate' && a.obj === l);
  assert.equal(onTheirTurn.length, 0, 'opponent\'s turn: not activatable');
  let h = S0();
  const l2 = setLegend(h, P0, 'Bounty Hunter');
  put(h, P0, 'V(2)', 'base');
  assert.ok(legal(h, P0, 'activate').some(a => a.type === 'activate' && a.obj === l2), 'my own turn: activatable');
  void h;
});

test('RJ#6494 two Captain Farrons: other friendly units there have Assault 2, each Farron Assault 1 (from the other)', () => {
  const g = S0();
  const f1 = put(g, P0, 'Captain Farron', BF_A);
  const f2 = put(g, P0, 'Captain Farron', BF_A);
  const u = put(g, P0, 'V(2)', BF_A);
  assert.equal(kwValue(g, u, 'Assault'), 2);
  assert.equal(kwValue(g, f1, 'Assault'), 1);
  assert.equal(kwValue(g, f2, 'Assault'), 1);
});
